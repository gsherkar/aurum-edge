from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ContractSpecCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    symbol: str = Field(min_length=1, max_length=40)
    data_mode: Literal["historical_file", "synthetic"] = "historical_file"
    contract_quantity: float = Field(gt=0)
    quotation_unit: str = Field(min_length=1, max_length=30)
    quotation_basis: str = Field(min_length=1, max_length=100)
    purity: float | None = Field(default=None, gt=0, le=1)
    conversion_factor: float = Field(gt=0)
    delivery_location: str | None = None
    effective_start: date
    effective_end: date | None = None
    expiry_date: date | None = None
    settlement_info: str | None = None
    specification_source: str = Field(min_length=1, max_length=500)
    verification_status: Literal["verified", "unverified", "demo-only"] = "unverified"

    @field_validator("symbol")
    @classmethod
    def normalize_symbol(cls, value: str) -> str:
        return value.upper()

    @model_validator(mode="after")
    def validate_spec_mode(self) -> "ContractSpecCreate":
        if self.data_mode == "synthetic" and self.verification_status != "demo-only":
            raise ValueError("Synthetic specifications must use verification_status='demo-only'")
        if self.data_mode == "historical_file" and self.verification_status == "demo-only":
            raise ValueError("demo-only specifications cannot be used for historical files")
        if self.effective_end is not None and self.effective_end < self.effective_start:
            raise ValueError("effective_end cannot precede effective_start")
        return self


class ContractSpecRead(ContractSpecCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime


class MarketObservationRead(BaseModel):
    id: int
    symbol: str
    expiry_date: date | None
    source_name: str
    source_timestamp: datetime | None
    fetched_at: datetime
    data_date: date
    data_mode: str
    import_id: str
    open: float | None
    high: float | None
    low: float | None
    close: float | None
    settlement: float | None
    volume: float | None
    traded_value: float | None
    open_interest: float | None
    normalized_close: float | None

    model_config = ConfigDict(from_attributes=True)
