from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, Date, DateTime, Float, Integer, LargeBinary, String, Text, UniqueConstraint

from .db import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ContractSpec(Base):
    __tablename__ = "contract_specs"

    id = Column(Integer, primary_key=True)
    symbol = Column(String, nullable=False, index=True)
    data_mode = Column(String, nullable=False, default="historical_file")
    contract_quantity = Column(Float, nullable=False)
    quotation_unit = Column(String, nullable=False)
    quotation_basis = Column(String, nullable=False)
    purity = Column(Float, nullable=True)
    conversion_factor = Column(Float, nullable=False)
    delivery_location = Column(String, nullable=True)
    effective_start = Column(Date, nullable=False)
    effective_end = Column(Date, nullable=True)
    expiry_date = Column(Date, nullable=True)
    settlement_info = Column(String, nullable=True)
    specification_source = Column(String, nullable=False)
    verification_status = Column(String, nullable=False, default="unverified")
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (UniqueConstraint("symbol", "data_mode", "effective_start", "expiry_date", name="uq_contract_spec_version"),)


class ImportBatch(Base):
    __tablename__ = "import_batches"

    id = Column(String, primary_key=True)
    file_name = Column(String, nullable=False)
    source_name = Column(String, nullable=False)
    data_mode = Column(String, nullable=False)
    fallback_data_date = Column(Date, nullable=True)
    column_mapping = Column(Text, nullable=True)
    content = Column(LargeBinary, nullable=True)
    status = Column(String, nullable=False, default="uploaded")
    parsed_records = Column(Text, nullable=True)
    valid_records = Column(Text, nullable=True)
    analysis_results = Column(Text, nullable=True)
    summary = Column(Text, nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)


class MarketObservation(Base):
    __tablename__ = "market_observations"

    id = Column(Integer, primary_key=True)
    symbol = Column(String, nullable=False, index=True)
    expiry_date = Column(Date, nullable=True, index=True)
    source_name = Column(String, nullable=False)
    source_timestamp = Column(DateTime, nullable=True)
    fetched_at = Column(DateTime, default=utc_now, nullable=False)
    data_date = Column(Date, nullable=False, index=True)
    data_mode = Column(String, nullable=False, index=True)
    import_id = Column(String, nullable=False, index=True)
    open = Column(Float, nullable=True)
    high = Column(Float, nullable=True)
    low = Column(Float, nullable=True)
    close = Column(Float, nullable=True)
    settlement = Column(Float, nullable=True)
    volume = Column(Float, nullable=True)
    traded_value = Column(Float, nullable=True)
    open_interest = Column(Float, nullable=True)
    normalized_close = Column(Float, nullable=True)
    provenance = Column(String, nullable=True)

    __table_args__ = (
        UniqueConstraint("symbol", "expiry_date", "data_date", "source_name", "import_id", name="uq_market_observation"),
    )


class AnalysisResult(Base):
    __tablename__ = "analysis_results"

    id = Column(Integer, primary_key=True)
    import_id = Column(String, nullable=False, index=True)
    data_date = Column(Date, nullable=False, index=True)
    data_mode = Column(String, nullable=False, index=True)
    equal_weight_consensus = Column(Float, nullable=True)
    liquidity_weighted_consensus = Column(Float, nullable=True)
    contracts_included = Column(Integer, nullable=False)
    eligible_for_alerts = Column(Boolean, nullable=False)
    details = Column(Text, nullable=False)
    created_at = Column(DateTime, default=utc_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("import_id", "data_date", name="uq_analysis_batch_date"),
    )


class MarketAlert(Base):
    __tablename__ = "market_alerts"

    id = Column(Integer, primary_key=True)
    import_id = Column(String, nullable=False, index=True)
    symbol = Column(String, nullable=False, index=True)
    data_date = Column(Date, nullable=False, index=True)
    consensus_price = Column(Float, nullable=False)
    normalized_price = Column(Float, nullable=False)
    residual_pct = Column(Float, nullable=False)
    z_score = Column(Float, nullable=True)
    liquidity_score = Column(Float, nullable=False)
    liquidity_guard = Column(Boolean, nullable=False)
    expiry_guard = Column(Boolean, nullable=False)
    stale_data_guard = Column(Boolean, nullable=False)
    data_quality_guard = Column(Boolean, nullable=False)
    anomaly_band = Column(String, nullable=False)
    alert_type = Column(String, nullable=False)
    explanation = Column(Text, nullable=False)
    created_at = Column(DateTime, default=utc_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("import_id", "symbol", "data_date", name="uq_alert_import_symbol_date"),
    )
