"""D-9 (Personalization PRD UC-1) -- a consumer of `GET /api/member/interest` on
the Screener results (one line over the loaded rows).

UC-1: *"A member's signal reaches a surface that did not compute it."* One line names
the tickers on this surface the member already follows and WHY, from the route's own
`because[]` (the same words as the Research page's member-interest line), never
re-derived on the client.

PRESENCE ONLY: the resolver folds a failing source into an empty set, so the line never
says "not on your watchlist"; it renders nothing when no ticker matches or the read
failed. NO NEW ROUTE, NO RE-ORDERING: the existing route (paid, 15s per-member cache)
is read as it is and nothing on the surface moves.

DARK behind MEMBER_INTEREST_SCREENER_ENABLED (read per call, unset = OFF). Client-only gate:
it rides the auth payload as `member_interest_screener_enabled` only when on; unset = the line is absent and
the surface never requests /api/member/interest for it.
"""
from __future__ import annotations

import os

ENABLED_ENV = "MEMBER_INTEREST_SCREENER_ENABLED"


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get(ENABLED_ENV, "0").strip().lower() in ("1", "true", "yes", "on")
