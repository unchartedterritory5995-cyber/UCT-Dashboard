"""D-10 (Lane R) -- Personalization UC-3: "a member sees why a surface is ordered
the way it is" (``05-product-strategy/prds/personalization-prd.md`` UC-3: legible and
reversible).

The calendar's Feed and Week views rank reporters with ONE comparator
(``app/src/pages/calendar/importance.js::rankEntries``): the member's own stocks
first, then an importance score plus a PERSONAL BOOST from the member-interest
weight registry (``member_interest.SOURCE_BUCKETS``, served as
``weight_buckets`` on ``/api/calendar/my-sets``). The boost was silent. Behind this
flag the calendar shows the rule, each boosted name with the sources and weights that
moved it, and a switch that turns the boost off (and back on).

Client-only: this module exists so the flag has ONE reader, the auth payload
(``calendar_order_explain_enabled``, present only when on). No route reads it.

DARK behind CALENDAR_ORDER_EXPLAIN_ENABLED.
"""
from __future__ import annotations

import os

ENABLED_ENV = "CALENDAR_ORDER_EXPLAIN_ENABLED"


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get(ENABLED_ENV, "").strip() == "1"
