"""Wisdom Loop capture & archive (stream S-A, D12). Contract: docs/wisdom/CONTRACTS.md §6.1.

The daily archive of everything the product overwrites or purges, to R2 under
``wisdom/context/<as_of>/<dataset>.json.gz``, with one ``wisdom_capture_runs`` row
per (run, dataset) and a health verdict against the trailing median.

Public step functions other streams call (names and signatures are contract):

    run_family(name, *, as_of=None, dry_run=False) -> dict
    run_all(ctx) -> dict                      # the daily chain's capture step
    health_table(conn, days=10) -> list[dict] # the admin dashboard and weekly report

Methodology: docs/wisdom/methodology/capture-v1.md.
"""
from api.services.wisdom.capture.health import health_table
from api.services.wisdom.capture.runner import run_all, run_family

__all__ = ["health_table", "run_all", "run_family"]
