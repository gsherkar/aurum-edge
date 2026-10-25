from __future__ import annotations

import hashlib
import json
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from datetime import date
from typing import Any, Literal

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
from render import Render
from sqlalchemy import exists, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db, init_db
from .engine import build_walk_forward_backtest, calculate_consensus
from .models import ContractSpec, ImportBatch, MarketAlert, MarketObservation
from .schemas import ContractSpecCreate, ContractSpecRead, MarketObservationRead
from .services.pipeline import run_local_pipeline

@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None, None]:
    init_db()
    yield


app = FastAPI(title=settings.app_name, version="0.2.0", lifespan=lifespan)


def _start_render_workflow(import_id: str) -> str:
    if not settings.render_api_key or not settings.render_workflow_task_slug:
        raise HTTPException(
            status_code=503,
            detail="API-triggered Render runs require RENDER_API_KEY and RENDER_WORKFLOW_TASK_SLUG.",
        )
    result = Render(token=settings.render_api_key).workflows.start_task(
        settings.render_workflow_task_slug,
        [import_id],
        idempotency_key=f"aurum-edge-{import_id}",
    )
    return result.id


@app.get("/")
def root() -> dict[str, str]:
    return {"service": settings.app_name, "status": "online"}


@app.get("/health")
def health(db: Session = Depends(get_db)) -> dict[str, Any]:
    db.execute(text("SELECT 1"))
    return {"status": "ok", "app": settings.app_name, "database": "connected"}


@app.get("/api/v1/contracts", response_model=list[ContractSpecRead])
def list_contracts(
    data_mode: Literal["historical_file", "synthetic"] | None = None,
    db: Session = Depends(get_db),
) -> list[ContractSpec]:
    query = db.query(ContractSpec)
    if data_mode:
        query = query.filter(ContractSpec.data_mode == data_mode)
    return query.order_by(ContractSpec.symbol, ContractSpec.effective_start.desc()).all()


@app.post("/api/v1/contracts", response_model=ContractSpecRead, status_code=201)
def create_contract_spec(
    spec_data: ContractSpecCreate,
    db: Session = Depends(get_db),
) -> ContractSpec:
    spec = ContractSpec(**spec_data.model_dump())
    duplicate_query = db.query(ContractSpec).filter(
        ContractSpec.symbol == spec.symbol,
        ContractSpec.data_mode == spec.data_mode,
        ContractSpec.effective_start == spec.effective_start,
    )
    duplicate_query = (
        duplicate_query.filter(ContractSpec.expiry_date.is_(None))
        if spec.expiry_date is None
        else duplicate_query.filter(ContractSpec.expiry_date == spec.expiry_date)
    )
    if duplicate_query.first() is not None:
        raise HTTPException(status_code=409, detail="A specification with this symbol/version/expiry already exists")
    db.add(spec)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A specification with this symbol/version/expiry already exists") from exc
    db.refresh(spec)
    return spec


@app.post("/api/v1/data/files")
async def import_historical_file(
    file: UploadFile = File(...),
    data_date: date | None = Query(default=None, description="Required only if the file has no date column"),
    column_mapping: str | None = Query(
        default=None,
        description='Optional JSON map from canonical field to exact file header, e.g. {"symbol":"INSTRUMENT_CODE","date":"Trade Day"}',
    ),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    file_name = file.filename or "market-data"
    if not file_name.lower().endswith((".csv", ".txt", ".xls", ".xlsx")):
        raise HTTPException(status_code=415, detail="Supported file types: CSV, TXT, XLS, XLSX")
    content = await file.read(settings.max_upload_bytes + 1)
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail=f"File exceeds the {settings.max_upload_bytes}-byte upload limit")
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    mapping: dict[str, str] | None = None
    if column_mapping:
        try:
            parsed_mapping = json.loads(column_mapping)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=422, detail="column_mapping must be valid JSON") from exc
        if not isinstance(parsed_mapping, dict) or not all(
            isinstance(key, str) and isinstance(value, str) for key, value in parsed_mapping.items()
        ):
            raise HTTPException(status_code=422, detail="column_mapping must be a JSON object of string fields")
        mapping = parsed_mapping

    import_id = hashlib.sha256(file_name.encode("utf-8") + b"\0" + content).hexdigest()
    existing = db.get(ImportBatch, import_id)
    if existing is not None:
        return {
            "import_id": import_id,
            "status": existing.status,
            "data_mode": existing.data_mode,
            "source_name": existing.source_name,
            "summary": json.loads(existing.summary) if existing.summary else {},
            "duplicate_upload": True,
        }

    batch = ImportBatch(
        id=import_id,
        file_name=file_name,
        source_name="manual-historical-file",
        data_mode="historical_file",
        fallback_data_date=data_date,
        column_mapping=json.dumps(mapping) if mapping else None,
        content=content,
        status="uploaded",
    )
    db.add(batch)
    db.commit()
    if settings.render_api_key and settings.render_workflow_task_slug:
        task_run_id = _start_render_workflow(import_id)
        return {
            "import_id": import_id,
            "status": "submitted",
            "task_run_id": task_run_id,
            "task_slug": settings.render_workflow_task_slug,
            "source_name": batch.source_name,
            "data_mode": batch.data_mode,
            "duplicate_upload": False,
            "provenance_note": "Uploaded file provenance is recorded, but the backend cannot independently authenticate its origin.",
        }
    try:
        summary = run_local_pipeline(import_id)
    except ValueError as exc:
        batch = db.get(ImportBatch, import_id)
        if batch is not None and batch.status != "failed":
            batch.status = "failed"
            batch.error = str(exc)
            db.commit()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "import_id": import_id,
        "status": "completed",
        "source_name": batch.source_name,
        "data_mode": batch.data_mode,
        "summary": summary,
        "duplicate_upload": False,
        "provenance_note": "Uploaded file provenance is recorded, but the backend cannot independently authenticate its origin.",
    }


@app.post("/api/v1/data/demo")
def import_demo_data(db: Session = Depends(get_db)) -> dict[str, Any]:
    import_id = f"synthetic-demo-{date.today().isoformat()}"
    batch = db.get(ImportBatch, import_id)
    if batch is None:
        batch = ImportBatch(
            id=import_id,
            file_name="generated-synthetic-demo",
            source_name="synthetic-demo-provider",
            data_mode="synthetic",
            status="uploaded",
        )
        db.add(batch)
        db.commit()
    if batch.status == "completed":
        return {
            "import_id": import_id,
            "status": "completed",
            "data_mode": "synthetic",
            "duplicate_upload": True,
            "summary": json.loads(batch.summary or "{}"),
        }
    summary = run_local_pipeline(import_id)
    return {
        "import_id": import_id,
        "status": "completed",
        "data_mode": "synthetic",
        "duplicate_upload": False,
        "summary": summary,
    }


@app.get("/api/v1/data/imports")
def list_imports(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    batches = db.query(ImportBatch).order_by(ImportBatch.created_at.desc()).limit(limit).all()
    return [
        {
            "import_id": batch.id,
            "file_name": batch.file_name,
            "source_name": batch.source_name,
            "data_mode": batch.data_mode,
            "status": batch.status,
            "summary": json.loads(batch.summary) if batch.summary else {},
            "error": batch.error,
            "last_updated": batch.updated_at,
        }
        for batch in batches
    ]


@app.get("/api/v1/market/observations", response_model=list[MarketObservationRead])
def market_observations(
    data_mode: Literal["historical_file", "synthetic"] | None = None,
    symbol: str | None = None,
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
) -> list[MarketObservation]:
    query = db.query(MarketObservation)
    if data_mode:
        query = query.filter(MarketObservation.data_mode == data_mode)
    if symbol:
        query = query.filter(MarketObservation.symbol == symbol.upper())
    return query.order_by(MarketObservation.data_date.desc(), MarketObservation.symbol).limit(limit).all()


@app.get("/api/v1/market/summary")
def market_summary(db: Session = Depends(get_db)) -> dict[str, Any]:
    observations = db.query(MarketObservation).order_by(MarketObservation.data_date.desc()).all()
    eligible_ids = {
        item.id
        for item in observations
        if item.normalized_close is not None
    }
    data_sets: dict[str, list[MarketObservation]] = {}
    for item in observations:
        data_sets.setdefault(item.data_mode, []).append(item)
    results = []
    for data_mode, rows in sorted(data_sets.items()):
        latest_date = max(item.data_date for item in rows)
        latest_rows = [item for item in rows if item.data_date == latest_date]
        normalized_rows = [item for item in latest_rows if item.id in eligible_ids]
        consensus = calculate_consensus(
            [
                {"normalized_close": item.normalized_close, "volume": item.volume}
                for item in normalized_rows
            ]
        )
        results.append(
            {
                "data_mode": data_mode,
                "source_name": ", ".join(sorted({item.source_name for item in rows})),
                "data_date": latest_date,
                "last_updated": max(item.fetched_at for item in rows),
                "freshness": (
                    "stale"
                    if (date.today() - latest_date).days > settings.stale_after_days
                    else "current"
                ),
                "contracts": [
                    {
                        "symbol": item.symbol,
                        "expiry_date": item.expiry_date,
                        "close": item.close,
                        "settlement": item.settlement,
                        "normalized_price_per_gram": item.normalized_close,
                        "volume": item.volume,
                    }
                    for item in latest_rows
                ],
                "contracts_excluded_from_consensus": sum(
                    1 for item in latest_rows if item.id not in eligible_ids
                ),
                "consensus": consensus,
                "normalization_note": "Contracts without a verified specification are excluded from consensus.",
                "liquidity_weighting_method": consensus["liquidity_weighting_method"],
                "liquidity_weighting_note": consensus["liquidity_weighting_note"],
            }
        )
    return {"data_sets": results}


@app.get("/api/v1/alerts")
def list_alerts(
    data_mode: Literal["historical_file", "synthetic"] | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    query = db.query(MarketAlert, ImportBatch.data_mode).join(
        ImportBatch, ImportBatch.id == MarketAlert.import_id
    )
    if data_mode:
        query = query.filter(ImportBatch.data_mode == data_mode)
    eligible_observation = exists().where(
        MarketObservation.import_id == MarketAlert.import_id,
        MarketObservation.symbol == MarketAlert.symbol,
        MarketObservation.data_date == MarketAlert.data_date,
        MarketObservation.data_mode == ImportBatch.data_mode,
        MarketObservation.normalized_close.is_not(None),
    ).correlate(MarketAlert, ImportBatch)
    rows = (
        query.filter(eligible_observation)
        .order_by(MarketAlert.data_date.desc(), MarketAlert.id.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": alert.id,
            "import_id": alert.import_id,
            "data_mode": mode,
            "symbol": alert.symbol,
            "data_date": alert.data_date,
            "consensus_price_per_gram": alert.consensus_price,
            "normalized_price_per_gram": alert.normalized_price,
            "residual_pct": alert.residual_pct,
            "historical_z_score": alert.z_score,
            "liquidity_volume": alert.liquidity_score,
            "guards": {
                "liquidity": alert.liquidity_guard,
                "expiry": alert.expiry_guard,
                "stale_data": alert.stale_data_guard,
                "data_quality": alert.data_quality_guard,
            },
            "anomaly_band": alert.anomaly_band,
            "explanation": json.loads(alert.explanation),
            "created_at": alert.created_at,
            "notice": "Research alert only; not a trade recommendation or assertion of arbitrage profit.",
        }
        for alert, mode in rows
    ]


@app.get("/api/v1/analysis/backtest")
def backtest(
    data_mode: Literal["historical_file", "synthetic"] = "historical_file",
    start_date: date | None = None,
    end_date: date | None = None,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=422, detail="start_date must be on or before end_date")
    observations = (
        db.query(MarketObservation)
        .filter(
            MarketObservation.data_mode == data_mode,
            MarketObservation.normalized_close.is_not(None),
        )
        .order_by(MarketObservation.data_date, MarketObservation.symbol)
        .all()
    )
    rows = [
        {
            "symbol": row.symbol,
            "expiry_date": row.expiry_date,
            "data_date": row.data_date,
            "normalized_close": row.normalized_close,
            "volume": row.volume,
            "open": row.open,
            "high": row.high,
            "low": row.low,
            "close": row.close,
            "settlement": row.settlement,
        }
        for row in observations
    ]
    return build_walk_forward_backtest(
        rows,
        start_date=start_date,
        end_date=end_date,
        minimum_history=settings.minimum_zscore_history,
        zscore_threshold=settings.anomaly_zscore_threshold,
    )


@app.post("/api/v1/workflows/imports/{import_id}/run", status_code=202)
def trigger_render_workflow(import_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    if db.get(ImportBatch, import_id) is None:
        raise HTTPException(status_code=404, detail="Import batch not found")
    task_run_id = _start_render_workflow(import_id)
    return {
        "status": "submitted",
        "import_id": import_id,
        "task_run_id": task_run_id,
        "task_slug": settings.render_workflow_task_slug,
    }
