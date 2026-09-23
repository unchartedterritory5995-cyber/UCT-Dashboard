"""Opening a watchlist must never warm the whole list.

⛔ THE LANDMINE THIS PINS. `warm_bars_async`'s own docstring says "Caller should
pass a SHORT list (≤30) to avoid swamping the upstream API" and its pool is
`max_workers=4` — but `GET /api/watchlists/{wl_id}` and `/flagged` both passed the
ENTIRE list. That was survivable only because nothing routed a large list through
them. The 2026-09-20 directory/membership split makes `/{wl_id}` exactly how a
prebuilt index list is opened, so without this bound, clicking "Russell 2000" queues
**1,872 symbols × 8,000 daily bars** on the web pod — the shape of the OOM and
SQLite write-lock incidents this repo has already paid for twice.

A member's own list (a few dozen names) is warmed exactly as before.
"""
from __future__ import annotations

import json


class _Req:
    def __init__(self, headers=None):
        self.headers = headers or {}


def _russell(n=1872):
    return {
        "id": "r2k", "name": "Russell 2000", "user_id": "admin", "is_public": 1,
        "items": [{"id": f"i{i}", "watchlist_id": "r2k", "sym": f"S{i}",
                   "notes": "", "sort_order": i, "added_at": "2026-01-01"}
                  for i in range(n)],
    }


def _patch(monkeypatch, wl_row):
    """Returns the list of ticker batches handed to warm_bars_async."""
    from api.routers import watchlists as r
    from api.routers import bars
    from api.services import watchlist_service as wl

    warmed = []
    monkeypatch.setattr(bars, "warm_bars_async",
                        lambda tickers, tf="D", bars=8000: warmed.append(list(tickers)))
    monkeypatch.setattr(wl, "get_watchlist", lambda wl_id, user_id=None: wl_row)
    return r, warmed


def test_opening_russell_2000_does_not_warm_1872_symbols(monkeypatch):
    r, warmed = _patch(monkeypatch, _russell())

    r.get_watchlist(_Req(), "r2k", user={"id": "u"})

    assert len(warmed) == 1
    assert len(warmed[0]) == r._WARM_MAX, (
        f"list-open warmed {len(warmed[0])} symbols; the documented ceiling is {r._WARM_MAX}"
    )
    assert warmed[0] == [f"S{i}" for i in range(r._WARM_MAX)]


def test_a_small_member_list_is_warmed_exactly_as_before(monkeypatch):
    small = {**_russell(8), "name": "My List"}
    r, warmed = _patch(monkeypatch, small)

    r.get_watchlist(_Req(), "r2k", user={"id": "u"})

    assert warmed == [[f"S{i}" for i in range(8)]], "bounding must not change small lists"


def test_flagged_list_is_bounded_too(monkeypatch):
    """The same uncapped call sat on the flagged route, which is on the app-shell path."""
    from api.routers import watchlists as r
    from api.routers import bars
    from api.services import watchlist_service as wl

    warmed = []
    monkeypatch.setattr(bars, "warm_bars_async",
                        lambda tickers, tf="D", bars=8000: warmed.append(list(tickers)))
    monkeypatch.setattr(wl, "get_or_create_flagged_list", lambda uid: _russell(500))

    r.get_flagged(user={"id": "u"})
    assert len(warmed[0]) == r._WARM_MAX


def test_slim_membership_drops_only_fields_no_client_reads(monkeypatch):
    """`?slim=1` trims the wire shape. `id` is the row's React key and the handle for
    note/delete; `notes` is rendered. `watchlist_id` (repeated once per row — 1,872
    times for Russell 2000), `added_at` and `sort_order` are read by nothing."""
    r, _ = _patch(monkeypatch, _russell(3))

    full = json.loads(r.get_watchlist(_Req(), "r2k", user={"id": "u"}).body)
    slim = json.loads(r.get_watchlist(_Req(), "r2k", slim=True, user={"id": "u"}).body)

    assert set(full["items"][0]) == {"id", "watchlist_id", "sym", "notes", "sort_order", "added_at"}
    assert set(slim["items"][0]) == {"id", "sym", "notes"}
    # Ordering is unchanged — sort_order still drives the SQL, it just leaves the wire.
    assert [i["sym"] for i in slim["items"]] == [i["sym"] for i in full["items"]]
    assert slim["name"] == full["name"]
