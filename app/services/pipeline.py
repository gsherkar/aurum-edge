from __future__ import annotations

import json
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from ..config import settings
from ..db import SessionLocal
from ..engine import evaluate_risk_guards, normalize_price, walk_forward_analyze
from ..models import AnalysisResult, ContractSpec, ImportBatch, MarketAlert, MarketObservation, utc_now
from ..providers import DemoDataProvider, MCXFileProvider


def _get_batch(db: Session, import_id: str) -> ImportBatch:
    batch = db.get(ImportBatch, import_id)
    if batch is None:
        raise ValueError(f"Import batch {import_id} was not found")
    return batch


def _as_date(value: Any) -> date | None:
    if value is None:
        return None
    return date.fromisoformat(value) if isinstance(value, str) else value


def _serialize(value: Any) -> str:
    return json.dumps(value, default=lambda item: item.isoformat() if hasattr(item, "isoformat") else str(item))


def record_import_failure(import_id: str, error: Exception) -> bool:
    with SessionLocal() as db:
        batch = db.get(ImportBatch, import_id)
        if batch is None:
            return False
        detail = (
            str(error)
            if isinstance(error, ValueError)
            else f"{type(error).__name__}; see workflow task logs for details"
        )
        batch.status = "failed"
        batch.error = detail
        batch.updated_at = utc_now()
        db.commit()
        return True


def ingest_market_data(import_id: str) -> dict[str, Any]:
    with SessionLocal() as db:
        batch = _get_batch(db, import_id)
        if batch.data_mode == "synthetic":
            for symbol, quantity, unit, basis in DemoDataProvider.contracts:
                exists = (
                    db.query(ContractSpec)
                    .filter_by(symbol=symbol, data_mode="synthetic", effective_start=date(2000, 1, 1))
                    .first()
                )
                if exists is None:
                    db.add(
                        ContractSpec(
                            symbol=symbol,
                            data_mode="synthetic",
                            contract_quantity=quantity,
                            quotation_unit=unit,
                            quotation_basis=basis,
                            purity=1.0,
                            conversion_factor=1.0,
                            effective_start=date(2000, 1, 1),
                            specification_source="synthetic demo fixture; not an MCX specification",
                            verification_status="demo-only",
                        )
                    )
            db.flush()
            records = DemoDataProvider().records(days=60)
        else:
            if batch.content is None:
                raise ValueError("Uploaded file content is unavailable for this import")
            parsed = MCXFileProvider().parse(
                batch.content,
                batch.file_name,
                data_date=batch.fallback_data_date,
                column_mapping=json.loads(batch.column_mapping) if batch.column_mapping else None,
            )
            records = parsed.records
            batch.summary = _serialize(
                {
                    "total_rows": parsed.total_rows,
                    "parse_invalid_rows": parsed.invalid_rows,
                    "duplicate_rows_in_file": parsed.duplicate_rows,
                    "source_columns": parsed.source_columns,
                }
            )
            if not records:
                batch.status = "failed"
                batch.error = "No valid market-data rows were found in the file"
                db.commit()
                raise ValueError(batch.error)
        batch.parsed_records = _serialize(records)
        batch.status = "ingested"
        batch.error = None
        db.commit()
        return {"import_id": import_id, "records_parsed": len(records)}


def validate_market_data(import_id: str) -> dict[str, Any]:
    with SessionLocal() as db:
        batch = _get_batch(db, import_id)
        if batch.parsed_records is None:
            raise ValueError("Import batch has no parsed records")
        records: list[dict[str, Any]] = json.loads(batch.parsed_records)
        valid: list[dict[str, Any]] = []
        invalid: list[dict[str, Any]] = []
        seen: set[tuple[str, str, str | None]] = set()
        for index, row in enumerate(records, start=1):
            symbol = str(row.get("symbol", "")).strip().upper()
            data_date = _as_date(row.get("data_date"))
            expiry_date = _as_date(row.get("expiry_date"))
            price = row.get("close") or row.get("settlement")
            reason = None
            if not symbol:
                reason = "symbol is required"
            elif data_date is None:
                reason = "data_date is required"
            elif price is None or float(price) <= 0:
                reason = "positive close or settlement price is required"
            elif row.get("low") is not None and row.get("high") is not None and float(row["low"]) > float(row["high"]):
                reason = "low exceeds high"
            elif expiry_date is not None and expiry_date < data_date:
                reason = "expiry date precedes observation date"
            else:
                key = (symbol, data_date.isoformat(), expiry_date.isoformat() if expiry_date else None)
                if key in seen:
                    reason = "duplicate contract/date/expiry in file"
                seen.add(key)
            if reason:
                invalid.append({"row": index, "symbol": symbol or None, "reason": reason})
                continue
            valid.append(
                {
                    **row,
                    "symbol": symbol,
                    "data_date": data_date.isoformat(),
                    "expiry_date": expiry_date.isoformat() if expiry_date else None,
                }
            )
        batch.valid_records = _serialize(valid)
        batch.summary = _serialize(
            {
                **(json.loads(batch.summary) if batch.summary else {}),
                "valid_rows": len(valid),
                "validation_invalid_rows": invalid,
                "records_skipped": len(invalid)
                + len((json.loads(batch.summary) if batch.summary else {}).get("parse_invalid_rows", [])),
            }
        )
        batch.status = "validated"
        if not valid:
            batch.status = "failed"
            batch.error = "No valid rows remain after validation"
        db.commit()
        if not valid:
            raise ValueError(batch.error)
        return {"import_id": import_id, "valid_rows": len(valid), "invalid_rows": len(invalid)}


def persist_market_data(import_id: str) -> dict[str, Any]:
    with SessionLocal() as db:
        batch = _get_batch(db, import_id)
        if batch.valid_records is None:
            raise ValueError("Import batch has not been validated")
        records: list[dict[str, Any]] = json.loads(batch.valid_records)
        existing = {
            (row.symbol, row.data_date.isoformat(), row.expiry_date.isoformat() if row.expiry_date else None)
            for row in db.query(MarketObservation)
            .filter(MarketObservation.data_mode == batch.data_mode)
            .all()
        }
        inserted = 0
        duplicates = 0
        for row in records:
            key = (row["symbol"], row["data_date"], row.get("expiry_date"))
            if key in existing:
                duplicates += 1
                continue
            db.add(
                MarketObservation(
                    symbol=row["symbol"],
                    expiry_date=_as_date(row.get("expiry_date")),
                    source_name=batch.source_name,
                    fetched_at=utc_now(),
                    data_date=_as_date(row["data_date"]),
                    data_mode=batch.data_mode,
                    import_id=batch.id,
                    open=row.get("open"),
                    high=row.get("high"),
                    low=row.get("low"),
                    close=row.get("close"),
                    settlement=row.get("settlement"),
                    volume=row.get("volume"),
                    traded_value=row.get("traded_value"),
                    open_interest=row.get("open_interest"),
                    provenance=batch.file_name,
                )
            )
            existing.add(key)
            inserted += 1
        batch.summary = _serialize(
            {
                **(json.loads(batch.summary) if batch.summary else {}),
                "records_persisted": inserted,
                "records_deduplicated": duplicates,
            }
        )
        db.commit()
        return {"import_id": import_id, "records_persisted": inserted, "records_deduplicated": duplicates}


def _matching_spec(
    db: Session,
    observation: MarketObservation,
) -> ContractSpec | None:
    specs = (
        db.query(ContractSpec)
        .filter(
            ContractSpec.symbol == observation.symbol,
            ContractSpec.data_mode == observation.data_mode,
            ContractSpec.verification_status == (
                "demo-only" if observation.data_mode == "synthetic" else "verified"
            ),
            ContractSpec.effective_start <= observation.data_date,
        )
        .all()
    )
    eligible = [
        spec
        for spec in specs
        if spec.effective_end is None or spec.effective_end >= observation.data_date
    ]
    exact = [spec for spec in eligible if spec.expiry_date == observation.expiry_date]
    wildcard = [spec for spec in eligible if spec.expiry_date is None]
    return (exact or wildcard or [None])[0]


def refresh_normalized_observations(
    db: Session,
    data_mode: str | None = None,
) -> list[MarketObservation]:
    query = db.query(MarketObservation)
    if data_mode is not None:
        query = query.filter(MarketObservation.data_mode == data_mode)
    observations = query.order_by(MarketObservation.data_date, MarketObservation.symbol).all()
    eligible: list[MarketObservation] = []
    for observation in observations:
        spec = _matching_spec(db, observation)
        raw_price = observation.close or observation.settlement
        if spec is None or raw_price is None:
            observation.normalized_close = None
            continue
        observation.normalized_close = normalize_price(spec, float(raw_price))
        eligible.append(observation)
    db.flush()
    return eligible


def normalize_contracts(import_id: str) -> dict[str, Any]:
    with SessionLocal() as db:
        batch = _get_batch(db, import_id)
        rows = (
            db.query(MarketObservation)
            .filter(MarketObservation.import_id == import_id)
            .all()
        )
        normalized = 0
        excluded: dict[str, int] = {}
        for row in rows:
            spec = _matching_spec(db, row)
            raw_price = row.close or row.settlement
            if spec is None:
                row.normalized_close = None
                excluded[row.symbol] = excluded.get(row.symbol, 0) + 1
                continue
            if raw_price is None:
                row.normalized_close = None
                excluded[row.symbol] = excluded.get(row.symbol, 0) + 1
                continue
            row.normalized_close = normalize_price(spec, float(raw_price))
            normalized += 1
        batch.summary = _serialize(
            {
                **(json.loads(batch.summary) if batch.summary else {}),
                "normalized_records": normalized,
                "excluded_unverified_or_unconfigured": excluded,
            }
        )
        db.commit()
        return {"import_id": import_id, "normalized_records": normalized, "excluded": excluded}


def calculate_consensus(import_id: str) -> dict[str, Any]:
    with SessionLocal() as db:
        batch = _get_batch(db, import_id)
        observations = refresh_normalized_observations(db, batch.data_mode)
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
                "import_id": row.import_id,
            }
            for row in observations
        ]
        walk_forward = walk_forward_analyze(
            rows,
            minimum_history=settings.minimum_zscore_history,
            zscore_threshold=settings.anomaly_zscore_threshold,
        )
        imported_dates = {
            row.data_date
            for row in db.query(MarketObservation.data_date)
            .filter(MarketObservation.import_id == import_id)
            .distinct()
            .all()
        }
        batch_results = [day for day in walk_forward if day["data_date"] in imported_dates]
        packed = [
            {
                **day,
                "data_date": day["data_date"].isoformat(),
                "contracts": [
                    {
                        **row,
                        "data_date": row["data_date"].isoformat(),
                        "expiry_date": row["expiry_date"].isoformat() if row["expiry_date"] else None,
                    }
                    for row in day["contracts"]
                ],
                "candidates": [
                    {
                        **row,
                        "data_date": row["data_date"].isoformat(),
                        "expiry_date": row["expiry_date"].isoformat() if row["expiry_date"] else None,
                    }
                    for row in day["candidates"]
                ],
            }
            for day in batch_results
        ]
        batch.analysis_results = _serialize(packed)
        db.commit()
        return {"import_id": import_id, "dates_analyzed": len(batch_results)}


def detect_anomalies(import_id: str) -> dict[str, Any]:
    with SessionLocal() as db:
        batch = _get_batch(db, import_id)
        if batch.analysis_results is None:
            raise ValueError("Consensus results are unavailable")
        data = json.loads(batch.analysis_results)
        candidates = [
            candidate
            for day in data
            for candidate in day["candidates"]
        ]
        batch.summary = _serialize(
            {
                **(json.loads(batch.summary) if batch.summary else {}),
                "anomaly_candidates": len(candidates),
            }
        )
        db.commit()
        return {"import_id": import_id, "anomaly_candidates": len(candidates)}


def apply_risk_guards(import_id: str) -> dict[str, Any]:
    with SessionLocal() as db:
        batch = _get_batch(db, import_id)
        data = json.loads(batch.analysis_results or "[]")
        latest_data_date = (
            db.query(MarketObservation.data_date)
            .filter(MarketObservation.data_mode == batch.data_mode)
            .order_by(MarketObservation.data_date.desc())
            .first()
        )
        latest = latest_data_date[0] if latest_data_date else date.min
        guarded: list[dict[str, Any]] = []
        for day in data:
            as_of = date.fromisoformat(day["data_date"])
            for candidate in day["candidates"]:
                observation = (
                    db.query(MarketObservation)
                    .filter(
                        MarketObservation.symbol == candidate["symbol"],
                        MarketObservation.data_date == as_of,
                        MarketObservation.data_mode == batch.data_mode,
                    )
                    .first()
                )
                if observation is None:
                    continue
                assessed = evaluate_risk_guards(
                    candidate,
                    latest_data_date=latest,
                    as_of_date=date.today(),
                    minimum_daily_volume=settings.minimum_daily_volume,
                    stale_after_days=settings.stale_after_days,
                    expiry_guard_days=settings.expiry_guard_days,
                )
                guarded.append(
                    {
                        **candidate,
                        "liquidity_guard": assessed["liquidity_guard"],
                        "expiry_guard": assessed["expiry_guard"],
                        "stale_data_guard": assessed["stale_data_guard"],
                        "data_quality_guard": assessed["data_quality_guard"],
                        "eligible": assessed["eligible"],
                        "explanations": assessed["explanations"],
                    }
                )
        batch.analysis_results = _serialize(
            {
                "days": data,
                "guarded_candidates": guarded,
            }
        )
        batch.summary = _serialize(
            {
                **(json.loads(batch.summary) if batch.summary else {}),
                "guarded_candidates": len(guarded),
                "eligible_alerts": sum(1 for row in guarded if row["eligible"]),
            }
        )
        db.commit()
        return {
            "import_id": import_id,
            "guarded_candidates": len(guarded),
            "eligible_alerts": sum(1 for row in guarded if row["eligible"]),
        }


def persist_analysis_results(import_id: str) -> dict[str, Any]:
    with SessionLocal() as db:
        batch = _get_batch(db, import_id)
        payload = json.loads(batch.analysis_results or "{}")
        days = payload.get("days", [])
        db.query(AnalysisResult).filter(AnalysisResult.import_id == import_id).delete()
        db.query(MarketAlert).filter(MarketAlert.import_id == import_id).delete()
        for day in days:
            data_date = date.fromisoformat(day["data_date"])
            db.add(
                AnalysisResult(
                    import_id=import_id,
                    data_date=data_date,
                    data_mode=batch.data_mode,
                    equal_weight_consensus=day["equal_weight_consensus"],
                    liquidity_weighted_consensus=day["liquidity_weighted_consensus"],
                    contracts_included=day["contracts_included"],
                    eligible_for_alerts=any(
                        row["data_date"] == day["data_date"] and row["eligible"]
                        for row in payload.get("guarded_candidates", [])
                    ),
                    details=_serialize(day),
                )
            )
        for row in payload.get("guarded_candidates", []):
            data_date = date.fromisoformat(row["data_date"])
            db.add(
                MarketAlert(
                    import_id=import_id,
                    symbol=row["symbol"],
                    data_date=data_date,
                    consensus_price=row["consensus_price"],
                    normalized_price=row["normalized_price"],
                    residual_pct=row["residual_pct"],
                    z_score=row["z_score"],
                    liquidity_score=float(row["volume"] or 0.0),
                    liquidity_guard=row["liquidity_guard"],
                    expiry_guard=row["expiry_guard"],
                    stale_data_guard=row["stale_data_guard"],
                    data_quality_guard=row["data_quality_guard"],
                    anomaly_band="research-watch" if row["eligible"] else "guarded",
                    alert_type="cross-contract-relative-deviation",
                    explanation=_serialize(
                        {
                            "residual_pct": row["residual_pct"],
                            "historical_z_score": row["z_score"],
                            "risk_guard_reasons": row["explanations"],
                            "not_a_trade_recommendation": True,
                        }
                    ),
                )
            )
        batch.status = "analysis_persisted"
        db.commit()
        return {
            "import_id": import_id,
            "analysis_days_persisted": len(days),
            "alerts_persisted": len(payload.get("guarded_candidates", [])),
        }


def produce_run_summary(import_id: str) -> dict[str, Any]:
    with SessionLocal() as db:
        batch = _get_batch(db, import_id)
        summary = json.loads(batch.summary or "{}")
        summary.update(
            {
                "import_id": batch.id,
                "file_name": batch.file_name,
                "source_name": batch.source_name,
                "data_mode": batch.data_mode,
                "status": "completed",
                "last_updated": utc_now().isoformat(),
            }
        )
        batch.summary = _serialize(summary)
        batch.status = "completed"
        batch.error = None
        batch.updated_at = utc_now()
        db.commit()
        return summary


def run_local_pipeline(import_id: str) -> dict[str, Any]:
    ingest_market_data(import_id)
    validate_market_data(import_id)
    persist_market_data(import_id)
    normalize_contracts(import_id)
    calculate_consensus(import_id)
    detect_anomalies(import_id)
    apply_risk_guards(import_id)
    persist_analysis_results(import_id)
    return produce_run_summary(import_id)
