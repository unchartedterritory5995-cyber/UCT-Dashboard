"""Wisdom Loop outcomes, context snapshots, CALL-REPLAY and metrics (stream S-E).

Contract: docs/wisdom/CONTRACTS.md §6.5. Methodology: docs/wisdom/methodology/metrics-v1.md.

Public step functions (names fixed; other streams call them):
  run_daily(ctx)                         context -> outcomes -> replay -> metrics
  latest_metrics(conn) -> list[dict]     latest run of every metric, with n in every row
  run_grounding(ctx, *, with_wisdom)     the 6.4 grounding eval

Imports are deferred so the registry's discovery import of evals.jobs stays cheap.
"""
from __future__ import annotations


def run_daily(ctx, **overrides) -> dict:
    from api.services.wisdom.evals import pipeline

    return pipeline.run_daily(ctx, **overrides)


def latest_metrics(conn) -> list:
    from api.services.wisdom.evals import metrics

    return metrics.latest_metrics(conn)


def run_grounding(ctx, *, with_wisdom: bool, **kwargs) -> dict:
    from api.services.wisdom.evals import grounding

    return grounding.run_grounding(ctx, with_wisdom=with_wisdom, **kwargs)
