"""Admin diagnostics for the pattern engine.

Phase 0.5 surfaces engine health as JSON. Phase 5+ will add AuthGuard
admin-only enforcement once the UI lands.
"""
from __future__ import annotations

from fastapi import APIRouter

from api.services.pattern_engine.diagnostics import collect_health


router = APIRouter(prefix="/api/admin/patterns", tags=["admin-patterns"])


@router.get("/health")
def health():
    return collect_health()
