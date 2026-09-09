"""S8 continuation (owner authorization, 2026-09-02) — the minimal backend
surface for `<Cited row=…>`'s narrow interim form (SPEC-S8 §4.5), mirroring
`provenance_quote.py`'s shape exactly: a thin JSON passthrough over an
already-built, already-tested read function
(`api/services/bar_provenance.py::get`), no new business logic, no auth
(matching every other quote/bar-shaped read in this app).
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

router = APIRouter()


@router.get("/api/provenance/bar")
def get_provenance_bar(
    ticker: str = Query(...),
    tf: str = Query(...),
    bar_time: int = Query(..., description="Unix epoch seconds for the bar's own time"),
):
    """One bar's provenance row, or 404 when nothing has been recorded for
    it yet — a genuinely absent record, per `<Cited>`'s own honest
    "citation unavailable" state, not a server error."""
    from api.services import bar_provenance

    row = bar_provenance.get(ticker.strip().upper(), tf, bar_time)
    if row is None:
        raise HTTPException(status_code=404, detail="no provenance recorded for this bar")
    return row
