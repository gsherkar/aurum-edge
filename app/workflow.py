from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from typing import Any

from render import TaskContext, Workflows

from .services import pipeline

workflow = Workflows()
logger = logging.getLogger(__name__)


async def _execute_stage(
    context: TaskContext | None,
    import_id: str,
    operation: Callable[[str], dict[str, Any]],
    next_task: Any = None,
) -> dict[str, Any]:
    try:
        result = await asyncio.to_thread(operation, import_id)
        if next_task is None:
            return result
        if context is None:
            raise RuntimeError("A task context is required to chain the next workflow stage")
        return await context.run(next_task, import_id)
    except Exception as error:
        try:
            await asyncio.to_thread(pipeline.record_import_failure, import_id, error)
        except Exception:
            logger.exception("Could not persist workflow failure for import %s", import_id)
        raise


@workflow.task
async def ingest_market_data(context: TaskContext, import_id: str):
    return await _execute_stage(context, import_id, pipeline.ingest_market_data, validate_market_data)


@workflow.task
async def validate_market_data(context: TaskContext, import_id: str):
    return await _execute_stage(context, import_id, pipeline.validate_market_data, persist_market_data)


@workflow.task
async def persist_market_data(context: TaskContext, import_id: str):
    return await _execute_stage(context, import_id, pipeline.persist_market_data, normalize_contracts)


@workflow.task
async def normalize_contracts(context: TaskContext, import_id: str):
    return await _execute_stage(context, import_id, pipeline.normalize_contracts, calculate_consensus)


@workflow.task
async def calculate_consensus(context: TaskContext, import_id: str):
    return await _execute_stage(context, import_id, pipeline.calculate_consensus, detect_anomalies)


@workflow.task
async def detect_anomalies(context: TaskContext, import_id: str):
    return await _execute_stage(context, import_id, pipeline.detect_anomalies, apply_risk_guards)


@workflow.task
async def apply_risk_guards(context: TaskContext, import_id: str):
    return await _execute_stage(context, import_id, pipeline.apply_risk_guards, persist_analysis_results)


@workflow.task
async def persist_analysis_results(context: TaskContext, import_id: str):
    return await _execute_stage(context, import_id, pipeline.persist_analysis_results, produce_run_summary)


@workflow.task
async def produce_run_summary(_: TaskContext, import_id: str):
    return await _execute_stage(None, import_id, pipeline.produce_run_summary)
