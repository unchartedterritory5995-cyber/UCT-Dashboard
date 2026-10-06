"""FT-080 -- a per-ticker social series from the /buzz mention store, as a
research panel (Research > Depth > "Room attention"). NOT a chart overlay.

What it can say. For each ET day: how many times #main-chat named this ticker,
how many different people did, and what share of ALL ticker mentions in the
room that was. The share is the honest normaliser: a busy day in the room
raises every ticker's count, and the share removes that.

What it cannot say, and says so. The store keeps NO message text, by design
(`buzz_store.py`: a jump link stays true when a member edits or deletes; a
stored copy would not). A positive/negative ratio therefore cannot be computed
from it, and the payload returns `polarity: unavailable` with that reason
rather than inventing one.

Honesty rules, railed in tests/test_mention_series.py:
  * a day before the store's first mention, or a day the whole room was silent
    (a holiday, an ingest outage), is NULL, never 0 -- the same rule
    `buzz_store.total_in` exists for;
  * the window actually covered is returned with the series;
  * every number names the store it came from.

Request path: one local SQLite read. DARK behind MENTION_SERIES_ENABLED.
"""
from __future__ import annotations

import os
import time
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

ENABLED_ENV = "MENTION_SERIES_ENABLED"
DEFAULT_DAYS = 90
MAX_DAYS = 365
_ET = ZoneInfo("America/New_York")
SOURCE = "#main-chat ticker-mention store (buzz.db), one row per message x ticker"
POLARITY_REASON = ("the mention store keeps no message text by design, so a positive/negative "
                   "ratio cannot be computed from it")


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get(ENABLED_ENV, "").strip() == "1"


def _et_day(ts: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).astimezone(_ET).date().isoformat()


# S9 (terminal backend fixes, 2026-10-05): the room's per-day totals are the same for
# every ticker, and a finished ET day's total only moves when a backfill adds history.
# Reading them meant walking EVERY mention in the window in Python on each request
# (tens of thousands of rows for 90 days), so the finished days are kept for
# _ROOM_TTL_S and only today's count is read live. A backfill shows up within the TTL.
_ROOM_TTL_S = 600
_ROOM_CACHE: dict[tuple, tuple[float, dict]] = {}
_ROOM_CACHE_MAX = 64


def _count_by_et_day(c, lo_ts: int, hi_ts: int) -> dict[str, int]:
    out: dict[str, int] = {}
    for r in c.execute("SELECT ts FROM mentions WHERE ts >= ? AND ts < ?", (lo_ts, hi_ts)):
        d = _et_day(r["ts"])
        out[d] = out.get(d, 0) + 1
    return out


def _room_by_day(c, db: str, start_day: date, end_day: date, start_ts: int, end_ts: int) -> dict[str, int]:
    today_ts = int(datetime(end_day.year, end_day.month, end_day.day, tzinfo=_ET).timestamp())
    key = (db, start_day.isoformat(), end_day.isoformat())
    hit = _ROOM_CACHE.get(key)
    now_m = time.monotonic()
    if hit and hit[0] > now_m:
        closed = hit[1]
    else:
        closed = _count_by_et_day(c, start_ts, today_ts)
        if len(_ROOM_CACHE) >= _ROOM_CACHE_MAX:
            _ROOM_CACHE.clear()
        _ROOM_CACHE[key] = (now_m + _ROOM_TTL_S, closed)
    room = dict(closed)
    room.update(_count_by_et_day(c, today_ts, end_ts))
    return room


def series(sym: str, days: int = DEFAULT_DAYS, now: Optional[datetime] = None) -> dict:
    from api.services import buzz_store
    sym = (sym or "").upper().strip()
    days = max(7, min(int(days or DEFAULT_DAYS), MAX_DAYS))
    base = {"ticker": sym, "source": SOURCE,
            "polarity": {"state": "unavailable", "reason": POLARITY_REASON}}
    if not os.path.exists(buzz_store.db_path()):
        return {**base, "state": "no_store", "reason": "the mention store has not been created on this server"}
    now = now or datetime.now(timezone.utc)
    end_day = now.astimezone(_ET).date()
    start_day = end_day - timedelta(days=days - 1)
    start_ts = int(datetime(start_day.year, start_day.month, start_day.day, tzinfo=_ET).timestamp())
    end_ts = int(now.timestamp()) + 1
    c = buzz_store.connect()
    first = c.execute("SELECT MIN(ts) AS t FROM mentions").fetchone()["t"]
    if first is None:
        return {**base, "state": "no_store", "reason": "the mention store holds no mentions yet"}
    store_from = _et_day(first)

    mine: dict[str, list] = {}
    for r in c.execute("SELECT ts, author_id FROM mentions WHERE ticker=? AND ts >= ? AND ts < ?",
                       (sym, start_ts, end_ts)):
        d = _et_day(r["ts"])
        slot = mine.setdefault(d, [0, set()])
        slot[0] += 1
        slot[1].add(r["author_id"])
    room = _room_by_day(c, buzz_store.db_path(), start_day, end_day, start_ts, end_ts)

    points, d = [], start_day
    while d <= end_day:
        iso = d.isoformat()
        total = room.get(iso, 0)
        if iso < store_from:
            points.append({"date": iso, "state": "before_store", "mentions": None, "people": None,
                           "room_mentions": None, "share_pct": None})
        elif total == 0:
            points.append({"date": iso, "state": "room_silent", "mentions": None, "people": None,
                           "room_mentions": 0, "share_pct": None})
        else:
            n, ppl = mine.get(iso, [0, set()])
            points.append({"date": iso, "state": "ok", "mentions": n, "people": len(ppl),
                           "room_mentions": total, "share_pct": round(100 * n / total, 2)})
        d += timedelta(days=1)

    measured = [p for p in points if p["state"] == "ok"]
    last7 = measured[-7:]
    prior = measured[-37:-7]

    def avg(ps, k):
        return round(sum(p[k] for p in ps) / len(ps), 2) if ps else None
    summary = {"days_measured": len(measured), "mentions_total": sum(p["mentions"] for p in measured),
               "last7_avg_mentions": avg(last7, "mentions"), "prior30_avg_mentions": avg(prior, "mentions"),
               "last7_avg_share_pct": avg(last7, "share_pct"), "prior30_avg_share_pct": avg(prior, "share_pct"),
               "last7_days": len(last7), "prior30_days": len(prior)}
    return {**base, "state": "ok", "window": {"from": start_day.isoformat(), "through": end_day.isoformat(),
                                               "store_from": store_from, "timezone": "America/New_York"},
            "points": points, "summary": summary}
