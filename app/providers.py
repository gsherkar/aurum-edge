from __future__ import annotations

import csv
import io
import math
import re
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Protocol

import pandas as pd


class MarketDataProvider(Protocol):
    name: str

    def parse(self, content: bytes, file_name: str, data_date: date | None = None) -> "ParsedFile":
        ...


@dataclass
class ParsedFile:
    records: list[dict[str, Any]]
    total_rows: int
    duplicate_rows: int
    invalid_rows: list[dict[str, Any]]
    source_columns: list[str]


class MCXCSVProvider:
    name = "mcx-historical-file"
    aliases = {
        "date": {"date", "tradedate", "tradingdate", "timestamp", "businessdate"},
        "symbol": {"symbol", "contract", "contractsymbol", "instrumentname"},
        "expiry_date": {"expiry", "expirydate", "expiry_dt", "maturitydate"},
        "open": {"open", "openprice", "openingprice"},
        "high": {"high", "highprice"},
        "low": {"low", "lowprice"},
        "close": {"close", "closeprice", "closingprice"},
        "settlement": {"settlement", "settlementprice", "settleprice", "settle_pr", "settlepr"},
        "volume": {"volume", "contractsvolume", "noofcontracts", "contracts"},
        "traded_value": {"value", "tradedvalue", "turnover", "valinlakh"},
        "open_interest": {"oi", "openinterest", "open_int", "openint"},
    }

    def parse(
        self,
        content: bytes,
        file_name: str,
        data_date: date | None = None,
        column_mapping: dict[str, str] | None = None,
    ) -> ParsedFile:
        if Path(file_name).suffix.lower() not in {".csv", ".txt"}:
            raise ValueError("MCXCSVProvider accepts only .csv or .txt files")
        try:
            frame = self._read_csv(content)
        except Exception as exc:
            raise ValueError(f"Could not parse CSV file: {exc}") from exc
        return self._parse_frame(frame, data_date, column_mapping)

    @staticmethod
    def _read_csv(content: bytes) -> pd.DataFrame:
        text: str | None = None
        for encoding in ("utf-8-sig", "cp1252", "latin-1"):
            try:
                text = content.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        if text is None:
            raise ValueError("File encoding is unsupported")
        try:
            delimiter = csv.Sniffer().sniff(text[:8192], delimiters=",;\t|").delimiter
        except csv.Error:
            delimiter = ","
        return pd.read_csv(io.StringIO(text), sep=delimiter, dtype=object)

    @staticmethod
    def _canonical_header(value: Any) -> str:
        return re.sub(r"[^a-z0-9]", "", str(value).strip().lower())

    def _column_map(
        self,
        columns: list[Any],
        data_date: date | None,
        column_mapping: dict[str, str] | None,
    ) -> dict[str, str]:
        alias_lookup = {
            self._canonical_header(alias): canonical
            for canonical, aliases in self.aliases.items()
            for alias in aliases
        }
        mapped: dict[str, str] = {}
        for column in columns:
            key = self._canonical_header(column)
            canonical = alias_lookup.get(key)
            if canonical:
                mapped.setdefault(canonical, str(column))
        for canonical, column_name in (column_mapping or {}).items():
            if canonical not in self.aliases:
                raise ValueError(f"Unsupported canonical column name: {canonical}")
            if column_name not in columns:
                raise ValueError(f"Mapped source column not found: {column_name}")
            mapped[canonical] = column_name
        if "symbol" not in mapped:
            raise ValueError("CSV is missing a recognizable contract symbol column")
        if not any(field in mapped for field in ("date",)) and data_date is None:
            raise ValueError("CSV needs a trade date column or an explicit data_date")
        if not any(field in mapped for field in ("close", "settlement")):
            raise ValueError("CSV must contain a close or settlement-price column")
        return mapped

    def _parse_frame(
        self,
        frame: pd.DataFrame,
        data_date: date | None,
        column_mapping: dict[str, str] | None = None,
    ) -> ParsedFile:
        mapping = self._column_map(list(frame.columns), data_date, column_mapping)
        records: list[dict[str, Any]] = []
        invalid: list[dict[str, Any]] = []
        seen: set[tuple[str, date, date | None]] = set()
        duplicate_rows = 0
        for row_number, row in enumerate(frame.to_dict(orient="records"), start=2):
            try:
                symbol = self._text(row.get(mapping["symbol"])).upper()
                if not symbol:
                    raise ValueError("missing symbol")
                row_date = self._date(row.get(mapping["date"])) if "date" in mapping else data_date
                if row_date is None:
                    raise ValueError("missing trade date")
                expiry = self._date(row.get(mapping["expiry_date"])) if "expiry_date" in mapping else None
                values = {
                    key: self._number(row.get(column))
                    for key, column in mapping.items()
                    if key in {"open", "high", "low", "close", "settlement", "volume", "traded_value", "open_interest"}
                }
                if not any(values.get(field) is not None and values[field] > 0 for field in ("close", "settlement")):
                    raise ValueError("close and settlement prices are missing or non-positive")
                if any(values.get(field) is not None and values[field] < 0 for field in ("open", "high", "low", "volume", "traded_value", "open_interest")):
                    raise ValueError("OHLC/volume/value/open-interest values cannot be negative")
                key = (symbol, row_date, expiry)
                if key in seen:
                    duplicate_rows += 1
                    continue
                seen.add(key)
                records.append(
                    {
                        "symbol": symbol,
                        "data_date": row_date.isoformat(),
                        "expiry_date": expiry.isoformat() if expiry else None,
                        "open": values.get("open"),
                        "high": values.get("high"),
                        "low": values.get("low"),
                        "close": values.get("close"),
                        "settlement": values.get("settlement"),
                        "volume": values.get("volume"),
                        "traded_value": values.get("traded_value"),
                        "open_interest": values.get("open_interest"),
                    }
                )
            except (ValueError, TypeError, OverflowError) as exc:
                invalid.append({"row": row_number, "reason": str(exc)})
        return ParsedFile(
            records=records,
            total_rows=len(frame.index),
            duplicate_rows=duplicate_rows,
            invalid_rows=invalid,
            source_columns=[str(column) for column in frame.columns],
        )

    @staticmethod
    def _text(value: Any) -> str:
        if value is None or pd.isna(value):
            return ""
        return str(value).strip()

    @staticmethod
    def _number(value: Any) -> float | None:
        if value is None or pd.isna(value):
            return None
        text = str(value).strip().replace(",", "").replace("₹", "")
        if not text or text.upper() in {"-", "NA", "N/A", "NULL"}:
            return None
        number = float(text)
        if not math.isfinite(number):
            return None
        return number

    @staticmethod
    def _date(value: Any) -> date | None:
        if value is None or pd.isna(value) or not str(value).strip():
            return None
        cleaned = str(value).strip()
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", cleaned):
            return date.fromisoformat(cleaned)
        parsed = pd.to_datetime(value, errors="coerce", dayfirst=True)
        if pd.isna(parsed):
            raise ValueError(f"unparseable date: {value}")
        return parsed.date()


class MCXFileProvider(MCXCSVProvider):
    name = "mcx-compatible-file"

    def parse(
        self,
        content: bytes,
        file_name: str,
        data_date: date | None = None,
        column_mapping: dict[str, str] | None = None,
    ) -> ParsedFile:
        suffix = Path(file_name).suffix.lower()
        if suffix in {".csv", ".txt"}:
            return super().parse(content, file_name, data_date, column_mapping)
        if suffix not in {".xls", ".xlsx"}:
            raise ValueError("Supported files are CSV, TXT, XLS, and XLSX")
        try:
            frame = pd.read_excel(io.BytesIO(content), dtype=object)
        except Exception as exc:
            raise ValueError(f"Could not parse spreadsheet: {exc}") from exc
        return self._parse_frame(frame, data_date, column_mapping)


class DemoDataProvider:
    name = "synthetic-demo"
    symbols = ("DEMO_GOLD_1G", "DEMO_GOLD_10G", "DEMO_GOLD_1KG")

    def records(self, days: int = 60, end_date: date | None = None) -> list[dict[str, Any]]:
        if days < 1 or days > 1000:
            raise ValueError("days must be between 1 and 1000")
        final_date = end_date or date.today()
        rows: list[dict[str, Any]] = []
        for day_offset in range(days):
            observed_date = final_date - timedelta(days=days - day_offset - 1)
            for idx, symbol in enumerate(self.symbols):
                synthetic_per_gram = 7000 + day_offset * 1.5 + (day_offset % 7) * 2.0
                synthetic_per_gram *= 1 + ((day_offset * (idx + 1) % 5) - 2) * 0.0008
                if day_offset == days - 1 and idx == 2:
                    synthetic_per_gram *= 1.04
                quote = synthetic_per_gram * (1 if idx == 0 else 10 if idx == 1 else 1000)
                rows.append(
                    {
                        "symbol": symbol,
                        "data_date": observed_date.isoformat(),
                        "expiry_date": (final_date + timedelta(days=45)).isoformat(),
                        "open": round(quote * 0.999, 4),
                        "high": round(quote * 1.003, 4),
                        "low": round(quote * 0.997, 4),
                        "close": round(quote, 4),
                        "settlement": round(quote, 4),
                        "volume": float(1000 - idx * 100),
                        "traded_value": float(quote * (1000 - idx * 100)),
                        "open_interest": float(500 + day_offset),
                    }
                )
        return rows
