"""Read-only admin door onto the Wednesday measurement window (TERM-007 / TERM-017 / X-15).

`api/services/measurement_window.py` takes the readings and writes one result per
window; this serves them. Nothing here measures, writes or arms anything.

  GET /api/admin/measurement-window/latest          the newest result + live status
  GET /api/admin/measurement-window/{YYYY-MM-DD}    one window's result

A result's `rows` carries one verdict per ledger row: `valid` (bool), `reason`,
`bar` (the row's pass bar) and `numbers` (what was measured). A window that has
not been finalized yet answers `result: null` with `status` saying how many
samples are on disk.
"""
from __future__ import annotations

import datetime as _dt

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import require_admin

router = APIRouter()


@router.get("/api/admin/measurement-window/latest")
def measurement_window_latest(_admin: dict = Depends(require_admin)):
    from api.services import measurement_window as mw
    return {"result": mw.latest_result(), "status": mw.status()}


@router.get("/api/admin/measurement-window/{window_date}")
def measurement_window_for(window_date: str, _admin: dict = Depends(require_admin)):
    from api.services import measurement_window as mw
    try:
        day = _dt.date.fromisoformat(window_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="window_date must be YYYY-MM-DD")
    rows = mw.read_rows(day.isoformat())
    return {"result": mw.get_result(day.isoformat()),
            "samples": sum(1 for r in rows if r["kind"] == "sample"),
            "gate_runs": sum(1 for r in rows if r["kind"] == "bars_gate")}
