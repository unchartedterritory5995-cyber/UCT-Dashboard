"""READ ONLY: one stock's SEC fails-to-deliver series (FTD) as this server already holds it.

The FTD route (`GET /api/research/ftd/{sym}`) answers `ftd_dataset.series(sym)`, which reads the local store only, but
opens it through `ftd_dataset._conn()`: that creates the data directory and the store file when they are missing, sets the
journal mode and creates the tables. A reader that must never cause work (the UCT Agent's `stock.failsToDeliver` data
kind, MD-1 §4.21) reads through `held_series()` instead: with no store file on this server it answers `not_held` before
anything is opened or created; with one, it is the route's own answer (`series(sym)`, whose table creation is then a
no-op). It never asks the SEC (the files are read by the scheduled ingest alone) and never writes a row.

It lives beside the service and not inside it, so the service's own calls are unchanged. A rail stores invented files
through the service's own ingest and checks this reader gives the route's own answer, and that no store is created when
there is none.
"""
from __future__ import annotations

import os
from typing import Optional


def held_series(sym: str) -> tuple[Optional[dict], str]:
    """READ ONLY: `(answer, how)` for one stock. `how` is `held` (the route's own answer: `ok`, `none_reported` or
    `not_ingested` in its `state`) or `not_held` (no store on this server). Never builds, never creates the store."""
    from api.services import ftd_dataset as svc
    s = (sym or "").upper().strip()
    if not s or not os.path.isfile(svc.db_path()):
        return None, "not_held"
    got = svc.series(s)
    return (dict(got), "held") if isinstance(got, dict) else (None, "not_held")
