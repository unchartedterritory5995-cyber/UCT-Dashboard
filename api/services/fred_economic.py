"""FRED (St. Louis Fed) -- RETIRED. Kept only as a compatibility stub.

FRED is NOT a licensed production source for UCT (owner ruling #10, 2026-09-28).
Phase 0 read the controlling terms at https://fred.stlouisfed.org/legal/ :
"Store, cache, or archive any portion of the FRED(R) Services or FRED(R) Content
... or incorporate any FRED(R) Content in any database, compilation, archive,
cache, or other medium" is prohibited, commercial use needs the Bank's prior
written consent, and "wholesale downloading" is barred. A member-facing
subscription product that stores and serves history cannot satisfy that. See
docs/economic-data/PHASE1-DESIGN.md and the Phase 0 licensing audit.

WHY A STUB AND NOT A DELETE: the voice tools `get_economic_series` /
`list_economic_series` import these two names and degrade on an error dict to an
honest "unavailable" answer, so returning the structured error keeps every
caller working while making FRED ingestion impossible. (The other historical
caller, `options_chain._risk_free_rate`, was deleted with the yfinance options
leg on master, term-069 c3f28cad8.)

WHY NO ENV ESCAPE HATCH: previously the ONLY thing between production and live
FRED calls was `FRED_API_KEY` being unset -- one Railway variable. There is now
no variable, key or flag that re-arms it: `FRED_API_KEY` is ignored, no HTTP
client is imported, no cache exists. Licensed economic data comes from the
primary agencies via `api.services.econ` (BLS, BEA, Census, Fed Board, NY Fed,
Treasury, EIA, DOL, FHFA). Re-introducing FRED is a licensing decision that must
change this file, `api/services/econ/licensing.py` and
tests/econ/test_fred_retired.py together.
"""
from __future__ import annotations

from typing import Any

RETIRED_ERROR = "FRED retired: not a licensed production source (see docs/economic-data)"
RETIRED = True


def list_series_catalog() -> list[dict[str, str]]:
    """No FRED catalog is offered any more. Returns an empty list (callers
    render "no series available" rather than advertising unusable FRED ids)."""
    return []


def get_series(name_or_id: str = "", periods: int = 6) -> dict[str, Any]:
    """Always refuses, whatever the environment (FRED_API_KEY included).

    Returns the same error-dict shape callers already handle."""
    return {
        "error": RETIRED_ERROR,
        "retired": True,
        "series_id": (name_or_id or "").strip().upper(),
    }
