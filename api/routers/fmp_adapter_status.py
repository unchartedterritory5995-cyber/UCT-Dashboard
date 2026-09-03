"""Read-only status endpoint for the FMP D1 adapter (provider-abstraction-
spec.md §7.3, PRD acceptance criterion 7 — ships from first commit).

Mirrors `GET /api/admin/provider-coverage`'s existing shape exactly:
intentionally NO auth, per the documented convention for read-only ops
dashboards (`api/middleware/admin_guard.py`'s module docstring already names
`reconciliation-status`/`fundamentals-health`/`provider-coverage` as this
class of surface).
"""
from __future__ import annotations

import os

from fastapi import APIRouter

router = APIRouter()


@router.get("/api/admin/fmp-adapter-status")
def fmp_adapter_status():
    """Current state of the FMP D1 adapter (no auth — read-only, never
    exposes the key value itself, only whether it is present).

    `budget` — the rate limiter's live state (§7.1/§9.4).
    `evidence_ladder` — spec §18.2's KP/CR/OC/CA state: KP (key present in
    env) and OC (observed-called, `served_total` has moved off zero since
    process start) are both derivable and computed here; CA
    (contract-active) is explicitly NOT derivable from any signal this
    system has access to (§18.2's own finding) and stays a manually-set,
    admin-only flag with no automated promotion path — reported here as
    `null` rather than guessed.
    `coverage_db_registered` — spec §18.1's field-registration work
    (extending `provider_coverage_monitor.py` with FMP-specific field
    specs) is separate, NOT-yet-done work, named honestly here rather than
    fabricated.
    """
    from api.services import fmp_client

    key_present = bool(os.environ.get("FMP_API_KEY", "").strip())
    b = fmp_client.budget()
    return {
        "vendor": "fmp",
        "budget": b,
        "evidence_ladder": {
            "KP": key_present,
            "CR": True,   # this endpoint importing the module IS the code-reference
            "OC": b["served_total"] > 0,
            "CA": None,   # not derivable — manual, admin-only promotion, spec §18.2
        },
        "coverage_db_registered": False,  # spec §18.1 — deferred, not part of this build
        "typed_functions": [
            "get_quote", "get_key_metrics_ttm", "get_ratios_ttm", "get_analyst_grades",
            "get_grades_consensus", "get_grades_historical", "get_price_target_consensus",
            "get_price_target_summary", "get_earnings", "get_transcript_dates",
            "get_transcript_latest_page", "get_transcript_content", "get_insider_trading",
            "get_income_statement", "get_balance_sheet_statement", "get_cash_flow_statement",
            "get_earnings_calendar",
        ],
    }
