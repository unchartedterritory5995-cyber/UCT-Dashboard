"""Wisdom Loop segmentation, extraction, golden gate and budget (stream S-D). Contract: docs/wisdom/CONTRACTS.md §6.4.

Public step functions other streams call (names and signatures are the contract):
    extract.run_daily(ctx)   daily chain: segment new sources, extract NEW segments (flag + golden gate + budget)
    extract.reap(ctx)        advance and reap open batches (also the wisdom_extract_reap job)
    extract.gate_status(conn) the golden-gate reading for the configured extractor_version and model
    extract.run_audit(ctx)   weekly chain: the 50-segment second-pass audit

Submodules load lazily so importing the package (the registry imports extract.jobs)
costs nothing.
"""
from __future__ import annotations


def run_daily(ctx) -> dict:
    from api.services.wisdom.extract import batch

    return batch.run_daily(ctx)


def reap(ctx) -> dict:
    from api.services.wisdom.extract import batch

    return batch.reap(ctx)


def gate_status(conn) -> dict:
    from api.services.wisdom.extract import golden

    return golden.gate_status(conn)


def run_audit(ctx) -> dict:
    from api.services.wisdom.extract import audit

    return audit.run_audit(ctx)
