"""D12 family: Stock Catalysts output — kept indefinitely, but re-ranked through the day.

The session's full table after the 17:00 ET final hunt, ``ranked_only=False``,
so names that dropped out of the top list (rank NULL) are archived too.
``catalysts.market_date`` is the ET calendar date. The store's own connect()
would create an empty file where none exists, so absence is checked first.
"""
from __future__ import annotations

import os

from api.services.wisdom.capture.families._base import result, safe_reader, session_of, to_date, unavailable

FAMILY = "catalysts"
SOURCE = "api.services.catalyst.store.get_for_date(ranked_only=False)"


@safe_reader(FAMILY, SOURCE)
def read(*, as_of=None, now_et, state=None, **_) -> dict:
    from api.services.catalyst import store as catalyst_store

    session = to_date(as_of) or session_of(now_et)
    path = catalyst_store._DB_PATH
    if not os.path.exists(path):
        return unavailable(FAMILY, as_of=session, source=SOURCE, gap="catalysts_db",
                           reason=f"catalysts store not found at {path}")
    rows = catalyst_store.get_for_date(session.isoformat(), ranked_only=False)
    gaps: dict = {}
    meta: dict = {"ranked": sum(1 for r in rows if r.get("rank") is not None)}
    try:
        meta["last_refresh"] = catalyst_store.last_refresh_for_date(session.isoformat())
    except Exception as exc:  # noqa: BLE001
        gaps["last_refresh"] = f"{type(exc).__name__}: {exc}"[:200]
    ordered = order(rows)
    return result(FAMILY, as_of=session, source=SOURCE, rows=len(ordered), payload=ordered, gaps=gaps, meta=meta)


def order(rows: list) -> list:
    """Ranked rows by rank, then the dropped (rank NULL) rows, ticker as the tie-break — shared with the backfill."""
    return sorted(rows, key=lambda r: (r.get("rank") is None, r.get("rank") or 0, str(r.get("ticker"))))
