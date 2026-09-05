"""Read-only status endpoint for the Massive D1 adapter (provider-abstraction-
spec.md §7.3). Mirrors `fmp_adapter_status.py` exactly — see that module's
docstring for the shared rationale (no auth, evidence-ladder shape,
coverage_db_registered honesty note).
"""
from __future__ import annotations

import os

from fastapi import APIRouter

router = APIRouter()


@router.get("/api/admin/massive-adapter-status")
def massive_adapter_status():
    """Current state of the Massive D1 adapter (no auth — read-only, never
    exposes the key value itself, only whether it is present).

    Unlike FMP, Massive's index-quote capability is a LIVE-CONFIRMED
    entitlement gap (v3/snapshot/indices returns 403, not a symbol-format
    issue — see checkpoint findings) — reported here as a named limitation
    rather than a typed function, since none was built for it.
    """
    from api.services import massive as m

    key_present = bool(os.environ.get("MASSIVE_API_KEY", "").strip())
    b = m.budget()
    return {
        "vendor": "massive",
        "budget": b,
        "evidence_ladder": {
            "KP": key_present,
            "CR": True,
            "OC": b["served_total"] > 0,
            "CA": None,   # not derivable — manual, admin-only promotion, spec §18.2
        },
        "coverage_db_registered": False,  # spec §18.1 — deferred, not part of this build
        "typed_functions": ["get_quote", "get_batch_quotes"],
        "known_limitations": [
            "index quotes: entitlement gap (v3/snapshot/indices -> 403 for this "
            "key/plan), not a symbol-format issue — no typed index capability built",
        ],
    }
