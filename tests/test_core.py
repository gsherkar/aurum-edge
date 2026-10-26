import asyncio
import re
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.engine import (
    build_walk_forward_backtest,
    calculate_consensus,
    evaluate_risk_guards,
    normalize_price,
    walk_forward_analyze,
)
from app.main import app
from app.providers import DemoDataProvider, MCXCSVProvider, MCXFileProvider
from app.workflow import workflow


def test_csv_provider_parses_columns_and_deduplicates():
    content = (
        "SYMBOL,EXPIRY_DT,TRADE_DATE,OPEN,HIGH,LOW,CLOSE,SETTLE_PR,CONTRACTS,VAL_INLAKH,OPEN_INT\n"
        "GOLDM,2026-12-05,2026-10-20,70000,71000,69000,70500,70400,15,10.5,100\n"
        "GOLDM,2026-12-05,2026-10-20,70000,71000,69000,70500,70400,15,10.5,100\n"
        "GOLDPETAL,2026-12-05,2026-10-20,7000,7100,6900,,7040,10,7.2,50\n"
    ).encode()
    parsed = MCXCSVProvider().parse(content, "bhavcopy.csv")
    assert len(parsed.records) == 2
    assert parsed.duplicate_rows == 1
    assert parsed.records[0]["settlement"] == 70400
    assert parsed.records[0]["volume"] == 15
    assert parsed.records[1]["close"] is None


def test_file_provider_accepts_xlsx_and_configured_column_names():
    import io
    import pandas as pd

    content = io.BytesIO()
    pd.DataFrame(
        [{"Contract Code": "TEST", "Trading Day": "2026-10-20", "Last": 7000}]
    ).to_excel(content, index=False)
    parsed = MCXFileProvider().parse(
        content.getvalue(),
        "data.xlsx",
        column_mapping={"symbol": "Contract Code", "date": "Trading Day", "close": "Last"},
    )
    assert parsed.records[0]["symbol"] == "TEST"
    assert parsed.records[0]["close"] == 7000


def test_csv_provider_rejects_missing_price_and_needs_date():
    with_price_missing = b"SYMBOL,TRADE_DATE,CLOSE\nGOLDM,2026-10-20,\n"
    parsed = MCXCSVProvider().parse(with_price_missing, "file.csv")
    assert parsed.records == []
    assert "price" in parsed.invalid_rows[0]["reason"]

    missing_date = b"SYMBOL,CLOSE\nGOLDM,70000\n"
    try:
        MCXCSVProvider().parse(missing_date, "file.csv")
    except ValueError as exc:
        assert "data_date" in str(exc)
    else:
        raise AssertionError("missing date should be rejected")


def test_normalization_requires_explicit_quote_unit_and_conversion():
    spec = {"quotation_unit": "10g", "conversion_factor": 1.0}
    assert normalize_price(spec, 7500.0) == 750.0
    assert normalize_price({"quotation_unit": "8g", "conversion_factor": 1.0}, 6000.0) == 750.0
    try:
        normalize_price({"quotation_unit": "contract", "conversion_factor": 1.0}, 7500.0)
    except ValueError as exc:
        assert "Unsupported quotation unit" in str(exc)
    else:
        raise AssertionError("unknown quotation units should be rejected")


def test_consensus_reports_equal_and_liquidity_weighted_prices():
    summary = calculate_consensus(
        [
            {"normalized_close": 100.0, "volume": 1},
            {"normalized_close": 200.0, "volume": 3},
        ]
    )
    assert summary["equal_weight_consensus"] == 150.0
    assert summary["liquidity_weighted_consensus"] == 175.0
    assert summary["liquidity_weighting_method"] == "experimental_raw_volume"
    assert "not represented" in summary["liquidity_weighting_note"]


def test_consensus_labels_raw_volume_weighting_experimental_for_mixed_contracts():
    summary = calculate_consensus(
        [
            {"normalized_close": 7000.0, "volume": 1000.0, "contract_quantity": 1.0},
            {"normalized_close": 7100.0, "volume": 900.0, "contract_quantity": 1000.0},
        ]
    )
    assert summary["liquidity_weighted_consensus"] == (
        (7000.0 * 1000.0 + 7100.0 * 900.0) / 1900.0
    )
    assert summary["liquidity_weighting_method"] == "experimental_raw_volume"
    assert "may not be comparable across contracts" in summary["liquidity_weighting_note"]


def test_walk_forward_never_uses_future_values_for_past_dates():
    start = date(2026, 1, 1)
    rows = [
        {
            "symbol": f"TEST_{symbol_index}",
            "data_date": start + timedelta(days=day),
            "normalized_close": 100.0 + symbol_index * 5 + day % 4,
            "volume": 100,
        }
        for day in range(25)
        for symbol_index in range(3)
    ]
    original = walk_forward_analyze(rows, minimum_history=10)
    changed_future = [dict(row) for row in rows]
    changed_future[-1]["normalized_close"] = 10_000_000.0
    updated = walk_forward_analyze(changed_future, minimum_history=10)
    assert original[:-1] == updated[:-1]
    assert all(row["z_score"] is None for row in original[0]["contracts"])
    report = build_walk_forward_backtest(rows, minimum_history=10)
    assert report["trading_performance_claimed"] is False
    assert report["days_evaluated"] == 25


def test_risk_guards_explain_missing_liquidity_expiry_and_staleness():
    result = evaluate_risk_guards(
        {"volume": 0, "expiry_date": None, "close": 0, "low": None, "high": None},
        latest_data_date=date(2026, 1, 1),
        as_of_date=date(2026, 1, 20),
        minimum_daily_volume=1,
        stale_after_days=5,
        expiry_guard_days=3,
    )
    assert not result["eligible"]
    assert not result["liquidity_guard"]
    assert not result["expiry_guard"]
    assert not result["stale_data_guard"]
    assert not result["data_quality_guard"]
    assert len(result["explanations"]) == 4


def test_demo_provider_only_uses_explicit_synthetic_symbols():
    records = DemoDataProvider().records(days=2, end_date=date(2026, 10, 20))
    assert len(records) == 8
    assert {row["symbol"] for row in records} == set(DemoDataProvider.symbols)
    specs = {
        symbol: {"contract_quantity": quantity, "quotation_unit": unit, "conversion_factor": 1.0}
        for symbol, quantity, unit, _ in DemoDataProvider.contracts
    }
    assert specs == {
        "DEMO_GOLD_100G": {"contract_quantity": 100.0, "quotation_unit": "100g", "conversion_factor": 1.0},
        "DEMO_GOLD_10G": {"contract_quantity": 10.0, "quotation_unit": "10g", "conversion_factor": 1.0},
        "DEMO_GOLD_8G": {"contract_quantity": 8.0, "quotation_unit": "8g", "conversion_factor": 1.0},
        "DEMO_GOLD_1G": {"contract_quantity": 1.0, "quotation_unit": "1g", "conversion_factor": 1.0},
    }
    for row in records:
        spec = specs[row["symbol"]]
        assert normalize_price(spec, row["close"]) == pytest.approx(
            row["close"] / spec["contract_quantity"]
        )


def test_render_workflow_registers_all_pipeline_stages():
    expected = {
        "ingest_market_data",
        "validate_market_data",
        "persist_market_data",
        "normalize_contracts",
        "calculate_consensus",
        "detect_anomalies",
        "apply_risk_guards",
        "persist_analysis_results",
        "produce_run_summary",
    }
    assert set(workflow._registry.get_task_names()) == expected


def test_workflow_failure_marks_batch_failed_and_preserves_task_error():
    from app.db import SessionLocal, init_db
    from app.models import ImportBatch
    from app.workflow import _execute_stage

    init_db()
    import_id = "workflow-failure-regression"
    with SessionLocal() as db:
        db.add(
            ImportBatch(
                id=import_id,
                file_name="failure-test.csv",
                source_name="automated test",
                data_mode="historical_file",
                status="uploaded",
            )
        )
        db.commit()

    def fail_stage(_: str) -> dict[str, object]:
        raise RuntimeError("stage failure")

    with pytest.raises(RuntimeError, match="stage failure"):
        asyncio.run(_execute_stage(None, import_id, fail_stage))

    with SessionLocal() as db:
        batch = db.get(ImportBatch, import_id)
        assert batch.status == "failed"
        assert batch.error == "RuntimeError; see workflow task logs for details"


def test_api_contract_paths_match_registered_openapi_routes():
    documented = Path(__file__).resolve().parents[1] / "API_CONTRACT.md"
    documented_routes = set(
        re.findall(r"^### `(GET|POST|PUT|PATCH|DELETE) (.+)`$", documented.read_text(), re.MULTILINE)
    )
    registered_routes = {
        (method.upper(), path)
        for path, methods in app.openapi()["paths"].items()
        for method in methods
    }
    assert documented_routes == registered_routes


def test_cors_allows_frontend_origins_without_wildcard():
    client = TestClient(app)

    response = client.options(
        "/api/v1/data/demo",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "access-control-allow-credentials" not in response.headers

    rejected = client.options(
        "/api/v1/data/demo",
        headers={
            "Origin": "https://untrusted.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert rejected.status_code == 400
    assert "access-control-allow-origin" not in rejected.headers


def test_api_imports_historical_file_and_keeps_demo_separate(monkeypatch):
    from types import SimpleNamespace

    import app.main as main_module

    client = TestClient(app)
    with client:
        assert client.get("/health").json()["status"] == "ok"
        assert client.get("/api/v1/market/summary").json() == {"data_sets": []}
        assert client.get("/api/v1/alerts").json() == []
        empty_backtest = client.get("/api/v1/analysis/backtest").json()
        assert empty_backtest["days_evaluated"] == 0
        assert empty_backtest["daily_results"] == []
        spec_response = client.post(
            "/api/v1/contracts",
            json={
                "symbol": "TEST_AURUM",
                "data_mode": "historical_file",
                "contract_quantity": 1,
                "quotation_unit": "1g",
                "quotation_basis": "test quote per gram",
                "conversion_factor": 1,
                "effective_start": "2020-01-01",
                "specification_source": "automated test fixture",
                "verification_status": "verified",
            },
        )
        assert spec_response.status_code in {201, 409}

        rows = ["SYMBOL,TRADE_DATE,EXPIRY_DT,CLOSE,SETTLE_PR,VOLUME"]
        for day_offset in range(24):
            observed = date(2026, 9, 20) + timedelta(days=day_offset)
            rows.append(
                f"TEST_AURUM,{observed.isoformat()},2026-12-25,{7000 + day_offset},,{100 + day_offset}"
            )
            rows.append(
                f"UNVERIFIED_TEST,{observed.isoformat()},2026-12-25,{7100 + day_offset},,{80 + day_offset}"
            )
        file_body = ("\n".join(rows) + "\n").encode()
        import_response = client.post(
            "/api/v1/data/files",
            files={"file": ("historical.csv", file_body, "text/csv")},
        )
        assert import_response.status_code == 200, import_response.text
        payload = import_response.json()
        assert payload["data_mode"] == "historical_file"
        assert payload["summary"]["valid_rows"] == 48
        assert payload["summary"]["normalized_records"] == 24
        assert payload["summary"]["excluded_unverified_or_unconfigured"] == {
            "UNVERIFIED_TEST": 24
        }
        assert client.get("/api/v1/market/summary").json()["data_sets"]
        assert client.get("/api/v1/analysis/backtest").json()["trading_performance_claimed"] is False

        class FakeWorkflows:
            def start_task(self, task_slug, input_data, *, idempotency_key):
                assert task_slug == "test-workflow/ingest_market_data"
                assert input_data == [payload["import_id"]]
                assert idempotency_key == f"aurum-edge-{payload['import_id']}"
                return SimpleNamespace(id="task-run-test")

        class FakeRender:
            def __init__(self, *, token):
                assert token == "test-render-key"
                self.workflows = FakeWorkflows()

        monkeypatch.setattr(main_module, "Render", FakeRender)
        monkeypatch.setattr(main_module.settings, "render_api_key", "test-render-key")
        monkeypatch.setattr(
            main_module.settings,
            "render_workflow_task_slug",
            "test-workflow/ingest_market_data",
        )
        triggered = client.post(f"/api/v1/workflows/imports/{payload['import_id']}/run")
        assert triggered.status_code == 202
        assert triggered.json()["task_run_id"] == "task-run-test"

        duplicate = client.post(
            "/api/v1/data/files",
            files={"file": ("historical.csv", file_body, "text/csv")},
        )
        assert duplicate.status_code == 200
        assert duplicate.json()["duplicate_upload"] is True

        demo_response = client.post("/api/v1/data/demo")
        assert demo_response.status_code == 200
        assert demo_response.json()["data_mode"] == "synthetic"
        assert demo_response.json()["summary"]["normalized_records"] == 240
        demo_contracts = client.get("/api/v1/contracts?data_mode=synthetic").json()
        assert {
            contract["symbol"]: (contract["contract_quantity"], contract["quotation_unit"], contract["verification_status"])
            for contract in demo_contracts
        } == {
            "DEMO_GOLD_100G": (100.0, "100g", "demo-only"),
            "DEMO_GOLD_10G": (10.0, "10g", "demo-only"),
            "DEMO_GOLD_8G": (8.0, "8g", "demo-only"),
            "DEMO_GOLD_1G": (1.0, "1g", "demo-only"),
        }
        data_modes = {item["data_mode"] for item in client.get("/api/v1/market/summary").json()["data_sets"]}
        assert data_modes == {"historical_file", "synthetic"}
        demo_alerts = client.get("/api/v1/alerts?data_mode=synthetic").json()
        assert any(alert["anomaly_band"] == "research-watch" for alert in demo_alerts)

        from app.db import SessionLocal
        from app.models import AnalysisResult, ContractSpec, ImportBatch, MarketAlert, MarketObservation

        tables = (
            ContractSpec.__table__,
            ImportBatch.__table__,
            MarketObservation.__table__,
            AnalysisResult.__table__,
            MarketAlert.__table__,
        )

        def database_snapshot():
            with SessionLocal() as session:
                return {
                    table.name: [
                        tuple(row)
                        for row in session.execute(
                            table.select().order_by(*table.primary_key.columns)
                        ).all()
                    ]
                    for table in tables
                }

        before_gets = database_snapshot()
        get_paths = (
            "/",
            "/health",
            "/api/v1/contracts",
            "/api/v1/data/imports",
            "/api/v1/market/observations",
            "/api/v1/market/summary",
            "/api/v1/alerts",
            "/api/v1/analysis/backtest",
        )
        for path in get_paths:
            assert client.get(path).status_code == 200, path
        assert database_snapshot() == before_gets


def test_alert_limit_applies_after_eligibility_and_preserves_order():
    from app.db import SessionLocal
    from app.models import ImportBatch, MarketAlert, MarketObservation

    import_id = "alert-pagination-regression"
    eligible_dates = [date(2030, 1, 1) + timedelta(days=offset) for offset in range(4)]
    ineligible_dates = [date(2035, 1, 1) + timedelta(days=offset) for offset in range(5)]

    with SessionLocal() as session:
        session.add(
            ImportBatch(
                id=import_id,
                file_name="test-fixture",
                source_name="automated-test-fixture",
                data_mode="historical_file",
                status="completed",
            )
        )
        for offset, data_date in enumerate(eligible_dates):
            symbol = f"ELIGIBLE_{offset}"
            session.add(
                MarketObservation(
                    symbol=symbol,
                    source_name="automated-test-fixture",
                    data_date=data_date,
                    data_mode="historical_file",
                    import_id=import_id,
                    close=7000.0 + offset,
                    normalized_close=7000.0 + offset,
                )
            )
            session.add(
                MarketAlert(
                    import_id=import_id,
                    symbol=symbol,
                    data_date=data_date,
                    consensus_price=7000.0,
                    normalized_price=7000.0 + offset,
                    residual_pct=float(offset),
                    z_score=float(offset),
                    liquidity_score=10.0,
                    liquidity_guard=True,
                    expiry_guard=True,
                    stale_data_guard=True,
                    data_quality_guard=True,
                    anomaly_band="research-watch",
                    alert_type="test",
                    explanation="{}",
                )
            )
        for offset, data_date in enumerate(ineligible_dates):
            symbol = f"INELIGIBLE_{offset}"
            session.add(
                MarketObservation(
                    symbol=symbol,
                    source_name="automated-test-fixture",
                    data_date=data_date,
                    data_mode="historical_file",
                    import_id=import_id,
                    close=7100.0 + offset,
                    normalized_close=None,
                )
            )
            session.add(
                MarketAlert(
                    import_id=import_id,
                    symbol=symbol,
                    data_date=data_date,
                    consensus_price=7100.0,
                    normalized_price=7100.0 + offset,
                    residual_pct=float(offset),
                    z_score=float(offset),
                    liquidity_score=10.0,
                    liquidity_guard=True,
                    expiry_guard=True,
                    stale_data_guard=True,
                    data_quality_guard=True,
                    anomaly_band="guarded",
                    alert_type="test",
                    explanation="{}",
                )
            )
        session.commit()

    with TestClient(app) as client:
        response = client.get(
            "/api/v1/alerts?data_mode=historical_file&limit=3"
        )

    assert response.status_code == 200
    alerts = response.json()
    assert len(alerts) == 3
    assert [alert["symbol"] for alert in alerts] == [
        "ELIGIBLE_3",
        "ELIGIBLE_2",
        "ELIGIBLE_1",
    ]
    assert [alert["data_date"] for alert in alerts] == [
        data_date.isoformat() for data_date in reversed(eligible_dates[1:])
    ]
