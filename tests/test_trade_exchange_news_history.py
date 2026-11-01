"""UCT News "All history" (Linked to chart): every archived day, newest first.

archive.history_slice walks the days that hold archived rows, newest first, through
the same bounded day reader and filter as one day (day_slice), in keyset pages with a
per-request budget -- no date cutoff, never the whole archive at once. Synthetic only.
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from api.routers import trade_exchange_news as route
from api.services.trade_exchange_news import archive as arc
from api.services.trade_exchange_news import pipeline as pl
from tests.test_trade_exchange_news_archive import _call, _content, _day, env, et_ms, rec, MEMBER  # noqa: F401 -- env is the autouse fixture

import asyncio

D0 = date(2026, 10, 28)
DAYS = [D0 - timedelta(days=k) for k in (0, 1, 3)]          # three archived days, a gap between two
FAR = D0 - timedelta(days=400)                               # a day more than a year back
NOW = et_ms(D0, 20)


async def _fill(days=DAYS, n=30, far=False):
    """n headlines a day (the six-way mix: NVDA every 6th), and optionally one on FAR."""
    p = pl.start(asyncio.get_running_loop())
    i = 0
    for d in days:
        base = et_ms(d, 6)
        for k in range(n):
            content, source = _content(i)
            await p.submit(rec(content, base + k * 600_000, source), "push")
            i += 1
    if far:
        await p.submit(rec("SYNTHETIC NVDA SHARES RISE IN TEST 9999", et_ms(FAR, 10)), "push")
    return p


def _all_nvda(store):
    rows = store._conn().execute("SELECT seq, content, received_at_ms FROM headlines").fetchall()
    out = [(r[2], r[0]) for r in rows if "NVDA" in r[1]]
    return sorted(out, reverse=True)


def _walk(store, **kw):
    """Every page until has_older is false: (all keys in order, the pages)."""
    keys, pages, cursor = [], [], None
    for _ in range(200):
        out = arc.history_slice(store, cursor=cursor, now_ms=NOW, **kw)
        pages.append(out)
        keys += [(r[3], r[0]) for r in out["_rows"]]
        if not out["has_older"]:
            return keys, pages
        cursor = out["older_cursor"]
    raise AssertionError("never finished")


async def test_linked_history_is_every_archived_match_newest_first_across_days_in_pages():
    p = await _fill()
    first = arc.history_slice(p.store, symbol="NVDA", limit=4, now_ms=NOW)
    assert first["history"] is True and first["total"] is None and first["has_newer"] is False
    assert len(first["_rows"]) == 4 and first["has_older"] is True
    keys, pages = _walk(p.store, symbol="NVDA", limit=4)
    assert keys == _all_nvda(p.store)                                  # every match, once, newest first
    assert {arc.day_of(k[0]) for k in keys} == set(DAYS)               # across days, across the gap
    assert pages[-1]["reached_start"] is True and pages[-1]["has_older"] is False
    assert all(len(pg["_rows"]) <= 4 for pg in pages)


async def test_no_date_cutoff_the_walk_reaches_the_first_archived_day():
    p = await _fill(far=True)
    keys, pages = _walk(p.store, symbol="NVDA", limit=50)
    assert arc.day_of(keys[-1][0]) == FAR                              # 400 days back, still found
    assert pages[-1]["searched_to"] == FAR.isoformat()


async def test_a_budget_stop_answers_a_cursor_and_the_next_page_continues_without_gaps_or_repeats():
    p = await _fill()
    out = arc.history_slice(p.store, symbol="NVDA", limit=200, budget_rows=1, now_ms=NOW)
    # one day read, then the row budget stops the walk: the day's matches, and a cursor at its start
    assert out["has_older"] is True and out["scanned_rows"] == 30
    assert out["older_cursor"] == [arc.day_bounds(D0)[0], 0]
    keys, pages = _walk(p.store, symbol="NVDA", limit=200, budget_rows=1)
    assert keys == _all_nvda(p.store)
    assert max(pg["scanned_rows"] for pg in pages) <= 30               # never more than a day past the budget
    empty = arc.history_slice(p.store, symbol="NVDA", limit=200, budget_rows=1, now_ms=NOW,
                              cursor=[arc.day_bounds(D0)[0], 0])
    assert all(arc.day_of(r[3]) < D0 for r in empty["_rows"])          # the searched day is not read again


async def test_filters_combine_with_history_exactly_as_with_one_day():
    p = await _fill()
    keys, _ = _walk(p.store, symbol="AAPL", categories=["Earnings"], limit=500)
    for d in DAYS:
        day = arc.day_slice(p.store, day=d, limit=200, symbol="AAPL", categories=["Earnings"])
        assert [(r[3], r[0]) for r in day["_rows"]] == [k for k in keys if arc.day_of(k[0]) == d]
    q, _ = _walk(p.store, symbol="AAPL", query="product", limit=500)
    rows = {r[0]: r[1] for r in p.store._conn().execute("SELECT seq, content FROM headlines").fetchall()}
    assert q and all("product" in rows[s].lower() for _, s in q)


async def test_no_match_anywhere_is_an_honest_empty_answer():
    p = await _fill()
    out = arc.history_slice(p.store, symbol="ZZZZ", now_ms=NOW)
    assert out["_rows"] == [] and out["has_older"] is False and out["reached_start"] is True
    assert out["searched_to"] == DAYS[-1].isoformat()


async def test_the_route_serves_history_to_members_and_refuses_anonymous():
    p = await _fill()
    body = {"history": True, "symbol": "NVDA", "limit": 3}
    r = await _call(MEMBER, "POST", route.DAY_PATH, body)
    assert r.status_code == 200
    out = r.json()
    assert out["history"] is True and out["date"] is None and len(out["items"]) == 3
    assert all("NVDA" in it["content"] for it in out["items"]) and "_rows" not in out and "seqs" not in out
    nxt = await _day({**body, "cursor": out["older_cursor"]})
    assert nxt["items"][0]["seq"] not in {it["seq"] for it in out["items"]}
    assert (await _call(None, "POST", route.DAY_PATH, body)).status_code == 401
