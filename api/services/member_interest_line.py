"""D-9 (Personalization PRD UC-1) -- the first consumer of `GET /api/member/interest`.

UC-1: *"A member's signal reaches a surface that did not compute it."* The resolver
(`member_interest.interest_for`) and its route have been on master with no caller.
This surface is the first: the Research page says, under the header, that the member
already has a view on this ticker and WHY -- "In your open positions · On your
watchlists" -- from the route's own `because[]`, never re-derived on the client.

⛔ PRESENCE ONLY. The resolver folds a failing source into an empty set (its own
stated contract), so "not in your lists" cannot be told apart from "a source could
not be read". The line therefore says only what IS true and renders nothing
otherwise; it never says "not on your watchlist".

⛔ NO NEW ROUTE, NO RANKING. The existing route (paid, 15s per-member cache) is read
as it is. Nothing is re-ordered by this surface.

DARK behind MEMBER_INTEREST_LINE_ENABLED (read per call, unset = OFF). The flag is
client-only: it rides the auth payload as `member_interest_line_enabled` only when on.
"""
from __future__ import annotations

import os

ENABLED_ENV = "MEMBER_INTEREST_LINE_ENABLED"


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get(ENABLED_ENV, "0").strip().lower() in ("1", "true", "yes", "on")
