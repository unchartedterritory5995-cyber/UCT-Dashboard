"""Read-only status endpoint for the provider-coverage monitor (Task 22/23,
2026-08-05 data-dependability migration).

Mirrors `GET /api/admin/fundamentals-health` — intentionally NO auth, per the
documented convention for read-only ops dashboards (see
`api/middleware/admin_guard.py`'s module docstring, which names
`reconciliation-status` and `fundamentals-health` as deliberately anonymous;
this endpoint is the same class of surface).
"""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/api/admin/provider-coverage")
def provider_coverage_status():
    """Current state of the provider-coverage monitor (no auth — read-only).

    Per-field observed fill rate vs its floor (`fields`), and any field
    currently in defect (`defects_current` — `kind` is one of `blank`
    [sample>0 but observed==0, the class that hid for months undetected],
    `floor_breach`, or `drop` [a sharp fall vs the field's own recent
    history]). An empty `defects_current` is the healthy state. `observed`/
    `sample` of `null`/`0` means "not measured yet this cycle", never a
    fabricated 0% reading."""
    from api.services import provider_coverage_monitor
    return provider_coverage_monitor.get_state()
