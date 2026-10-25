from __future__ import annotations

from collections import defaultdict
from datetime import date
from statistics import mean
from typing import Any

import numpy as np


_GRAMS_PER_QUOTE_UNIT = {
    "1g": 1.0,
    "gram": 1.0,
    "grams": 1.0,
    "10g": 10.0,
    "100g": 100.0,
    "1kg": 1000.0,
    "kg": 1000.0,
    "kilogram": 1000.0,
}

_LIQUIDITY_WEIGHTING_METHOD = "experimental_raw_volume"
_LIQUIDITY_WEIGHTING_NOTE = (
    "Experimental only: source volume units and contract-size adjustment are not represented "
    "in the observation metadata; weights may not be comparable across contracts."
)


def normalize_price(spec: Any, raw_price: float) -> float:
    unit = str(spec["quotation_unit"] if isinstance(spec, dict) else spec.quotation_unit)
    cleaned_unit = unit.strip().lower().replace(" ", "")
    if cleaned_unit not in _GRAMS_PER_QUOTE_UNIT:
        raise ValueError(f"Unsupported quotation unit: {unit}")
    conversion_factor = float(spec["conversion_factor"] if isinstance(spec, dict) else spec.conversion_factor)
    if raw_price <= 0 or conversion_factor <= 0:
        raise ValueError("raw_price and conversion_factor must be positive")
    return raw_price / _GRAMS_PER_QUOTE_UNIT[cleaned_unit] * conversion_factor


def calculate_consensus(observations: list[dict]) -> dict:
    prices = [float(row["normalized_close"]) for row in observations if row.get("normalized_close") is not None]
    if not prices:
        return {
            "equal_weight_consensus": None,
            "liquidity_weighted_consensus": None,
            "market_n": 0,
            "liquidity_weighting_method": _LIQUIDITY_WEIGHTING_METHOD,
            "liquidity_weighting_note": _LIQUIDITY_WEIGHTING_NOTE,
        }
    weights = [
        max(float(row.get("volume") or 0.0), 0.0)
        for row in observations
        if row.get("normalized_close") is not None
    ]
    weight_sum = sum(weights)
    weighted = (
        float(np.average(np.asarray(prices, dtype=float), weights=np.asarray(weights, dtype=float)))
        if weight_sum > 0
        else None
    )
    return {
        "equal_weight_consensus": float(mean(prices)),
        "liquidity_weighted_consensus": weighted,
        "market_n": len(prices),
        "liquidity_weighting_method": _LIQUIDITY_WEIGHTING_METHOD,
        "liquidity_weighting_note": _LIQUIDITY_WEIGHTING_NOTE,
    }


def walk_forward_analyze(
    observations: list[dict[str, Any]],
    *,
    minimum_history: int = 20,
    zscore_threshold: float = 2.5,
) -> list[dict[str, Any]]:
    """Calculate each date using only that date and residuals from earlier dates."""
    by_date: dict[date, list[dict[str, Any]]] = defaultdict(list)
    for row in observations:
        data_date = row.get("data_date")
        if isinstance(data_date, str):
            data_date = date.fromisoformat(data_date)
        if data_date is not None and row.get("normalized_close") is not None:
            by_date[data_date].append({**row, "data_date": data_date})

    past_residuals: dict[tuple[str, date | None], list[float]] = defaultdict(list)
    results: list[dict[str, Any]] = []
    for data_date in sorted(by_date):
        day_rows = by_date[data_date]
        consensus = calculate_consensus(day_rows)
        equal_mean = consensus["equal_weight_consensus"]
        if equal_mean is None or equal_mean <= 0:
            continue
        contract_results: list[dict[str, Any]] = []
        for row in day_rows:
            price = float(row["normalized_close"])
            residual_pct = (price - equal_mean) / equal_mean * 100.0
            contract_key = (str(row["symbol"]), row.get("expiry_date"))
            history = past_residuals[contract_key]
            z_score: float | None = None
            if len(history) >= minimum_history:
                historical_std = float(np.std(np.asarray(history, dtype=float), ddof=1))
                if historical_std > 0:
                    z_score = (residual_pct - float(np.mean(history))) / historical_std
            contract_results.append(
                {
                    "symbol": row["symbol"],
                    "expiry_date": row.get("expiry_date"),
                    "data_date": data_date,
                    "normalized_price": price,
                    "consensus_price": equal_mean,
                    "liquidity_weighted_consensus": consensus["liquidity_weighted_consensus"],
                    "residual_pct": residual_pct,
                    "z_score": z_score,
                    "volume": row.get("volume"),
                    "open": row.get("open"),
                    "high": row.get("high"),
                    "low": row.get("low"),
                    "close": row.get("close"),
                    "settlement": row.get("settlement"),
                    "days_to_expiry": (
                        (row["expiry_date"] - data_date).days
                        if isinstance(row.get("expiry_date"), date)
                        else None
                    ),
                }
            )
        results.append(
            {
                "data_date": data_date,
                "equal_weight_consensus": equal_mean,
                "liquidity_weighted_consensus": consensus["liquidity_weighted_consensus"],
                "liquidity_weighting_method": consensus["liquidity_weighting_method"],
                "liquidity_weighting_note": consensus["liquidity_weighting_note"],
                "contracts_included": len(contract_results),
                "contracts": contract_results,
                "candidates": [
                    row
                    for row in contract_results
                    if row["z_score"] is not None and abs(row["z_score"]) >= zscore_threshold
                ],
            }
        )
        for result in contract_results:
            past_residuals[(result["symbol"], result["expiry_date"])].append(result["residual_pct"])
    return results


def evaluate_risk_guards(
    row: dict[str, Any],
    *,
    latest_data_date: date,
    as_of_date: date,
    minimum_daily_volume: float,
    stale_after_days: int,
    expiry_guard_days: int,
) -> dict[str, Any]:
    volume = row.get("volume")
    liquidity_ok = volume is not None and float(volume) >= minimum_daily_volume
    expiry = row.get("expiry_date")
    if isinstance(expiry, str):
        expiry = date.fromisoformat(expiry)
    expiry_ok = expiry is not None and (expiry - as_of_date).days > expiry_guard_days
    stale_ok = (as_of_date - latest_data_date).days <= stale_after_days
    low, high = row.get("low"), row.get("high")
    price = row.get("close") or row.get("settlement")
    quality_ok = (
        price is not None
        and float(price) > 0
        and (low is None or float(low) >= 0)
        and (high is None or float(high) >= 0)
        and (low is None or high is None or float(low) <= float(high))
        and (low is None or float(price) >= float(low))
        and (high is None or float(price) <= float(high))
    )
    explanations = []
    if not liquidity_ok:
        explanations.append("volume is missing or below the configured minimum")
    if not expiry_ok:
        explanations.append("expiry is unknown or within the expiry guard window")
    if not stale_ok:
        explanations.append("latest imported market data is stale")
    if not quality_ok:
        explanations.append("price or OHLC data failed quality checks")
    return {
        "liquidity_guard": liquidity_ok,
        "expiry_guard": expiry_ok,
        "stale_data_guard": stale_ok,
        "data_quality_guard": quality_ok,
        "eligible": liquidity_ok and expiry_ok and stale_ok and quality_ok,
        "explanations": explanations,
    }


def build_walk_forward_backtest(
    observations: list[dict[str, Any]],
    *,
    start_date: date | None = None,
    end_date: date | None = None,
    minimum_history: int = 20,
    zscore_threshold: float = 2.5,
) -> dict[str, Any]:
    results = walk_forward_analyze(
        observations,
        minimum_history=minimum_history,
        zscore_threshold=zscore_threshold,
    )
    selected_days = [
        day
        for day in results
        if (start_date is None or day["data_date"] >= start_date)
        and (end_date is None or day["data_date"] <= end_date)
    ]
    candidate_count = sum(len(day["candidates"]) for day in selected_days)
    return {
        "method": "walk-forward residual z-score; each observation uses only earlier dates for its historical baseline",
        "liquidity_weighting_method": _LIQUIDITY_WEIGHTING_METHOD,
        "liquidity_weighting_note": _LIQUIDITY_WEIGHTING_NOTE,
        "start_date": selected_days[0]["data_date"] if selected_days else None,
        "end_date": selected_days[-1]["data_date"] if selected_days else None,
        "days_evaluated": len(selected_days),
        "candidate_count": candidate_count,
        "trading_performance_claimed": False,
        "daily_results": selected_days,
    }
