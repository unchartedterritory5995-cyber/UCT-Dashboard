"""Trade Exchange News archive by calendar day: POST /day and GET /days.

Synthetic headlines only. A day is one America/New_York calendar day by receipt
time, filtered ON THE SERVER over the whole day, newest first by
(received_at_ms, seq), fetched in keyset steps from a cursor (archive.py).
"""
from __future__ import annotations

import asyncio
import time
from datetime import date, datetime
from zoneinfo import ZoneInfo

import httpx
import pytest
from fastapi import FastAPI

from api.middleware import auth_middleware
from api.routers import trade_exchange_news as route
from api.services.trade_exchange_news import archive as arc
from api.services.trade_exchange_news import pipeline as pl
from api.services.trade_exchange_news import reconcile as rc
from tests.support.txn_fakes import load_receiver

rx = load_receiver()["txn_receiver"]
ET = ZoneInfo("America/New_York")
ADMIN = {"id": "admin-1", "role": "admin", "email": "a@test"}
MEMBER = {"id": "member-1", "role": "user", "email": "m@test"}
DAY = date(2026, 10, 28)


def et_ms(d: date, h: int, m: int = 0, s: int = 0) -> int:
    return int(datetime(d.year, d.month, d.day, h, m, s, tzinfo=ET).timestamp() * 1000)


@pytest.fixture(autouse=True)
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("TXN_ENABLED", "1")
    monkeypatch.setenv("TXN_DB_PATH", str(tmp_path / "txn.db"))
    monkeypatch.setenv("TXN_HISTORY_MAX_AGE_HOURS", str(24 * 365 * 100))
    monkeypatch.setenv("TXN_DEDUPE_WINDOW_S", "0")
    monkeypatch.setenv("TXN_SOURCE_ALLOWLIST", "TXNews1,TX-PressRelease")
    monkeypatch.setattr(arc, "WARM_ENABLED", False)          # tests that want the warmer turn it on
    route._streams.clear()
    arc.clear_cache()
    arc.clear_index()
    yield
    rc.stop()
    pl.stop()
    route._streams.clear()


def rec(content, ms, source="TXNews1"):
    return rx.build_record(source, content, {}, rx.delivery_meta({}, 1, None), rx.Config({}), now_ms=ms)


def _app(user):
    app = FastAPI()
    app.include_router(route.router)
    if user is not None:
        app.dependency_overrides[auth_middleware.get_current_user] = lambda: user
    return app


async def _call(user, method, path, body=None, raw=None):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=_app(user)), base_url="http://web.test") as c:
        if method == "GET":
            return await c.get(path)
        if raw is not None:
            return await c.post(path, content=raw)
        return await c.post(path, json=body)


async def _day(body):
    r = await _call(ADMIN, "POST", route.DAY_PATH, body)
    assert r.status_code == 200, r.text
    return r.json()


#: A mix the filters can tell apart: tickers (NVDA / AAPL), categories (Macro,
#: Earnings, News, Press Release), search words, and graphic-only placeholders.
def _content(i: int) -> tuple[str, str]:
    k = i % 6
    if k == 0:
        return f"SYNTHETIC NVDA SHARES RISE IN TEST {i}", "TXNews1"
    if k == 1:
        return f"SYNTHETIC FED HOLDS INTEREST RATES STEADY TEST {i}", "TXNews1"
    if k == 2:
        return f"SYNTHETIC AAPL REPORTS THIRD QUARTER RESULTS TEST {i}", "TXNews1"
    if k == 3:
        return f"Synthetic Corp (NASDAQ: AAPL) announces product test {i}", "TX-PressRelease"
    if k == 4:
        return "CRYPTO", "TXNews1"
    return f"SYNTHETIC MARKET WRAP WITHOUT A SYMBOL TEST {i}", "TXNews1"


async def _fill_day(d: date = DAY, n: int = 120, start_h: int = 4, step_s: int = 300, offset: int = 0):
    """n headlines on day d from start_h ET, step_s apart."""
    p = pl.start(asyncio.get_running_loop())
    base = et_ms(d, start_h)
    for i in range(n):
        content, source = _content(i + offset)
        await p.submit(rec(content, base + i * step_s * 1000, source), "push")
    return p


def _oracle(p, d: date, *, query="", categories=(), symbol=None, symbols=None, hide=True):
    """The widget's own rule (visibleItems) over the EVENTS the server builds, for
    one ET day, newest first by (received_at_ms, seq)."""
    start, end = arc.day_bounds(d)
    evs = [pl.headline_event(r, p.store.epoch) for r in p.store.recent(100_000)]
    evs = [e for e in evs if start <= e["received_at_ms"] < end]
    evs.sort(key=lambda e: (e["received_at_ms"], e["seq"]), reverse=True)
    q = query.strip().lower()
    cats = set(categories) if categories and len(set(categories)) < 8 else None
    out = []
    for ev in evs:
        if hide and ev["placeholder"] == "graphic":
            continue
        if cats and (ev["category"] or "Other") not in cats:
            continue
        if symbol and symbol not in ev["tickers"]:
            continue
        if symbols is not None and not set(ev["tickers"]) & set(symbols):
            continue
        if q and q not in ev["content"].lower() and q.lstrip("$").upper() not in ev["tickers"]:
            continue
        out.append(ev["seq"])
    return out


async def _walk(body, limit=7):
    """Scroll a whole day: the first slice, then older steps until the end."""
    first = await _day({**body, "limit": limit})
    seqs = [it["seq"] for it in first["items"]]
    cur, more = first["older_cursor"], first["has_older"]
    while more:
        r = await _day({**body, "limit": limit, "cursor": cur, "direction": "older"})
        seqs += [it["seq"] for it in r["items"]]
        cur, more = r["older_cursor"], r["has_older"]
    return first, seqs


# ── authorization and validation ─────────────────────────────────────────────

@pytest.mark.parametrize("method,path", [("POST", route.DAY_PATH), ("GET", route.DAYS_PATH)])
async def test_signed_out_visitors_get_nothing_and_members_get_the_archive(method, path):
    await _fill_day(n=3)
    anon, member = await _call(None, method, path, {}), await _call(MEMBER, method, path, {"date": DAY.isoformat()})
    assert anon.status_code == 401 and "SYNTHETIC" not in anon.text
    assert member.status_code == 200


async def test_dark_when_the_flag_is_off(monkeypatch):
    await _fill_day(n=1)
    monkeypatch.setenv("TXN_ENABLED", "")
    assert (await _call(ADMIN, "POST", route.DAY_PATH, {})).status_code == 404
    assert (await _call(ADMIN, "GET", route.DAYS_PATH)).status_code == 404


async def test_503_before_the_pipeline_starts():
    assert (await _call(ADMIN, "POST", route.DAY_PATH, {})).status_code == 503
    assert (await _call(ADMIN, "GET", route.DAYS_PATH)).status_code == 503


async def test_bad_bodies_are_refused_not_guessed():
    await _fill_day(n=2)
    for raw, code in ((b"not json", 400), (b"[1]", 422), (b"{" + b" " * (route.MAX_DAY_BODY + 1) + b"}", 413)):
        assert (await _call(ADMIN, "POST", route.DAY_PATH, raw=raw)).status_code == code
    for body in ({"date": "10/28/2026"}, {"date": "2026-02-30"}, {"categories": "News"},
                 {"date": "2026-10-28", "at": "25:00"}, {"date": "2026-10-28", "at": "9.30"}):
        assert (await _call(ADMIN, "POST", route.DAY_PATH, body)).status_code == 422, body


# ── calendar days ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("d,hours", [(date(2026, 10, 28), 24), (date(2026, 11, 1), 25), (date(2026, 3, 8), 23)])
def test_a_day_is_the_new_york_calendar_day_including_dst(d, hours):
    start, end = arc.day_bounds(d)
    assert (end - start) == hours * 3_600_000
    assert datetime.fromtimestamp(start / 1000, ET).strftime("%Y-%m-%d %H:%M") == f"{d.isoformat()} 00:00"
    assert arc.day_of(start) == d and arc.day_of(end - 1) == d and arc.day_of(end) != d


async def test_midnight_boundaries_put_each_headline_on_its_new_york_date():
    p = pl.start(asyncio.get_running_loop())
    edges = [et_ms(DAY, 0, 0, 0), et_ms(DAY, 23, 59, 59) + 999, et_ms(date(2026, 10, 29), 0, 0, 0) - 1,
             et_ms(date(2026, 10, 29), 0, 0, 0), et_ms(DAY, 0, 0, 0) - 1]
    for i, ms in enumerate(edges):
        await p.submit(rec(f"SYNTHETIC EDGE {i}", ms), "push")
    a = await _day({"date": "2026-10-28", "hide_placeholders": False, "limit": 50})
    b = await _day({"date": "2026-10-29", "hide_placeholders": False, "limit": 50})
    c = await _day({"date": "2026-10-27", "hide_placeholders": False, "limit": 50})
    assert sorted(x["seq"] for x in a["items"]) == [1, 2, 3]
    assert [x["seq"] for x in b["items"]] == [4] and [x["seq"] for x in c["items"]] == [5]


async def test_a_dst_day_holds_all_25_hours():
    d = date(2026, 11, 1)
    p = await _fill_day(d, n=50, start_h=0, step_s=1800)             # 50 x 30 min = 25 h, all on Nov 1
    _, seqs = await _walk({"date": d.isoformat(), "hide_placeholders": False}, limit=9)
    assert seqs == _oracle(p, d, hide=False) and len(seqs) == 50
    assert (await _day({"date": "2026-11-02", "hide_placeholders": False}))["total"] == 0


async def test_days_reports_counts_retention_and_today(monkeypatch):
    p = await _fill_day(DAY, n=20)
    await _fill_day(date(2026, 10, 30), n=7, offset=20)
    now = et_ms(date(2026, 10, 30), 12)
    out = arc.days(p.store, now_ms=now)
    assert out["today"] == "2026-10-30" and out["first_day"] == "2026-10-28"
    assert out["days"] == [{"date": "2026-10-28", "count": 20}, {"date": "2026-10-30", "count": 7}]
    assert out["first_day_partial"] is False
    assert out["retention"]["max_items"] == 5000
    monkeypatch.setenv("TXN_HISTORY_MAX_AGE_HOURS", "54")                 # the age cut falls inside Oct 28
    assert arc.days(p.store, now_ms=now)["first_day_partial"] is True
    r = (await _call(ADMIN, "GET", route.DAYS_PATH)).json()
    assert r["epoch"] == p.store.epoch and sum(x["count"] for x in r["days"]) == 27


# ── one day, scrolled ────────────────────────────────────────────────────────

async def test_a_whole_day_scrolls_newest_first_without_gaps_or_duplicates():
    p = await _fill_day(n=120)
    first, seqs = await _walk({"date": DAY.isoformat()})
    want = _oracle(p, DAY)
    assert seqs == want and first["total"] == len(want) and first["day_total"] == 120
    assert first["has_newer"] is False and first["date"] == DAY.isoformat()
    assert {"category", "tickers", "mentions", "placeholder"} <= set(first["items"][0])


@pytest.mark.parametrize("filters", [
    {"query": "fed"}, {"query": "$NVDA"}, {"query": "nvda"}, {"categories": ["Macro"]},
    {"categories": ["Earnings", "Press Release"]}, {"symbol": "AAPL"}, {"symbols": ["NVDA", "MSFT"]},
    {"symbols": []}, {"symbol": "AAPL", "categories": ["Press Release"], "query": "product"},
    {"hide_placeholders": False},
])
async def test_filters_run_over_the_whole_day_and_match_the_widget_rules(filters):
    p = await _fill_day(n=90)
    first, seqs = await _walk({**filters, "date": DAY.isoformat()}, limit=8)
    want = _oracle(p, DAY, query=filters.get("query", ""), categories=filters.get("categories", ()),
                   symbol=filters.get("symbol"), symbols=filters.get("symbols"),
                   hide=filters.get("hide_placeholders", True))
    assert seqs == want and first["total"] == len(want)


async def test_other_days_never_leak_into_a_day():
    p = await _fill_day(DAY, n=30)
    await _fill_day(date(2026, 10, 27), n=30, offset=30)
    await _fill_day(date(2026, 10, 29), n=30, offset=60)
    _, seqs = await _walk({"date": DAY.isoformat()})
    assert seqs == _oracle(p, DAY) and all(1 <= s <= 30 for s in seqs)


async def test_an_empty_day_is_empty_not_an_error():
    await _fill_day(DAY, n=10)
    r = await _day({"date": "2026-10-20"})
    assert (r["total"], r["items"], r["has_older"], r["has_newer"]) == (0, [], False, False)


async def test_the_default_day_is_today_in_new_york(monkeypatch):
    p = await _fill_day(DAY, n=5)
    monkeypatch.setattr(arc, "today", lambda now_ms=None: DAY)
    r = await _day({})
    assert r["date"] == DAY.isoformat() and r["total"] == len(_oracle(p, DAY))


# ── jump to a time ───────────────────────────────────────────────────────────

async def test_jump_to_a_time_starts_at_or_before_it_and_scrolls_both_ways():
    p = await _fill_day(n=120, start_h=4, step_s=300)                  # 04:00 .. 13:55, every 5 min
    want = _oracle(p, DAY, hide=False)
    r = await _day({"date": DAY.isoformat(), "at": "09:32", "hide_placeholders": False, "limit": 10})
    first = r["items"][0]
    assert datetime.fromtimestamp(first["received_at_ms"] / 1000, ET).strftime("%H:%M") == "09:30"
    assert r["at_match"] == "at_or_before" and r["has_newer"] and r["has_older"]
    seqs = [x["seq"] for x in r["items"]]
    cur, more = r["newer_cursor"], r["has_newer"]
    while more:                                                       # scroll up to the newest
        u = await _day({"date": DAY.isoformat(), "cursor": cur, "direction": "newer", "hide_placeholders": False, "limit": 10})
        seqs = [x["seq"] for x in u["items"]] + seqs
        cur, more = u["newer_cursor"], u["has_newer"]
    cur, more = r["older_cursor"], r["has_older"]
    while more:                                                       # and down to the day's first
        o = await _day({"date": DAY.isoformat(), "cursor": cur, "hide_placeholders": False, "limit": 10})
        seqs += [x["seq"] for x in o["items"]]
        cur, more = o["older_cursor"], o["has_older"]
    assert seqs == want


async def test_the_jump_minute_is_inclusive():
    await _fill_day(n=10, start_h=9, step_s=60)                        # 09:00:00 .. 09:09:00
    r = await _day({"date": DAY.isoformat(), "at": "09:05", "hide_placeholders": False})
    assert datetime.fromtimestamp(r["items"][0]["received_at_ms"] / 1000, ET).strftime("%H:%M") == "09:05"


async def test_a_time_before_the_first_headline_lands_on_the_earliest_and_says_so():
    p = await _fill_day(n=20, start_h=10)
    r = await _day({"date": DAY.isoformat(), "at": "08:00", "hide_placeholders": False, "limit": 5})
    assert r["at_match"] == "after" and r["items"][-1]["seq"] == _oracle(p, DAY, hide=False)[-1]
    assert r["has_older"] is False and r["has_newer"] is True


async def test_jump_keeps_the_filters():
    p = await _fill_day(n=120)
    r = await _day({"date": DAY.isoformat(), "at": "09:00", "categories": ["Macro"], "limit": 5})
    assert all(x["category"] == "Macro" for x in r["items"])
    assert r["total"] == len(_oracle(p, DAY, categories=["Macro"]))


# ── live arrivals, recovery, retention ───────────────────────────────────────

async def test_arrivals_while_scrolling_never_shift_duplicate_or_skip():
    p = await _fill_day(n=60)
    first = await _day({"date": DAY.isoformat(), "limit": 10, "hide_placeholders": False})
    loaded = [x["seq"] for x in first["items"]]
    # news arrives at the top of the day, and a recovered headline lands lower down
    for i in range(5):
        await p.submit(rec(f"SYNTHETIC LIVE {i}", et_ms(DAY, 23, i)), "push")
    await p.submit(rec("SYNTHETIC RECOVERED LOW", et_ms(DAY, 4, 2)), "reconcile")
    cur, more = first["older_cursor"], first["has_older"]
    while more:
        r = await _day({"date": DAY.isoformat(), "limit": 10, "cursor": cur, "hide_placeholders": False})
        loaded += [x["seq"] for x in r["items"]]
        cur, more = r["older_cursor"], r["has_older"]
    assert len(loaded) == len(set(loaded))                              # nothing twice
    assert set(_oracle(p, DAY, hide=False)) - set(loaded) == {61, 62, 63, 64, 65}   # only the newer arrivals
    assert 66 in loaded                                                 # the recovered one, in its place
    up = await _day({"date": DAY.isoformat(), "cursor": first["newer_cursor"], "direction": "newer", "hide_placeholders": False})
    assert [x["seq"] for x in up["items"]] == [65, 64, 63, 62, 61]      # scrolling up finds them


async def test_a_recovered_headline_pruned_from_the_middle_leaves_the_index():
    await _fill_day(n=30)
    p = pl.get()
    await p.submit(rec("SYNTHETIC LATE RECOVERED", et_ms(date(2026, 10, 20), 9)), "reconcile")   # new seq, old time
    late = p.store.last_seq()
    assert (await _day({"date": "2026-10-20", "hide_placeholders": False}))["total"] == 1
    gone = p.store.prune(max_age_ms=et_ms(DAY, 23) - et_ms(DAY, 0), max_items=10_000, now_ms=et_ms(DAY, 23))
    assert gone["by_age"] == 1
    assert (await _day({"date": "2026-10-20", "hide_placeholders": False}))["total"] == 0
    d = await _day({"date": DAY.isoformat(), "limit": 200, "hide_placeholders": False})
    assert late not in [x["seq"] for x in d["items"]] and d["total"] == 30
    assert arc.cache_stats()["index_rows"] == 30


async def test_the_count_bound_drops_the_oldest_from_the_index():
    p = await _fill_day(n=40)
    await _day({"date": DAY.isoformat()})
    p.store.prune(max_age_ms=10**15, max_items=25)
    d = await _day({"date": DAY.isoformat(), "limit": 200, "hide_placeholders": False})
    assert d["day_total"] == 25 and min(x["seq"] for x in d["items"]) == 16


async def test_a_restart_or_another_process_rebuilds_the_same_answer():
    await _fill_day(n=40)
    body = {"date": DAY.isoformat(), "categories": ["Macro", "News"], "limit": 7}
    warm = await _day(body)
    arc.clear_index()                                                   # a fresh process: nothing held
    arc.clear_cache()
    cold = await _day(body)
    for k in ("total", "day_total", "items", "older_cursor", "has_older"):
        assert cold[k] == warm[k]
    assert arc.cache_stats()["index_rows"] == 40


async def test_a_new_epoch_discards_the_index(tmp_path, monkeypatch):
    await _fill_day(n=10)
    assert (await _day({"date": DAY.isoformat()}))["day_total"] == 10
    pl.stop()
    monkeypatch.setenv("TXN_DB_PATH", str(tmp_path / "other.db"))
    await _fill_day(n=4)
    assert (await _day({"date": DAY.isoformat()}))["day_total"] == 4


# ── cost ─────────────────────────────────────────────────────────────────────

async def test_an_unfiltered_day_resolves_only_the_rows_it_returns():
    await _fill_day(n=200)
    r = await _day({"date": DAY.isoformat(), "limit": 30})
    distinct = len({(x["source"], x["content"]) for x in r["items"]})
    assert r["timing_ms"]["derived"] == distinct                       # not the whole day
    again = await _day({"date": DAY.isoformat(), "limit": 30})
    assert again["timing_ms"]["derived"] == 0


async def test_events_equal_the_stream_build():
    p = await _fill_day(n=40)
    r = await _day({"date": DAY.isoformat(), "limit": 40, "hide_placeholders": False})
    fresh = {row["seq"]: pl.headline_event(row, p.store.epoch) for row in p.store.recent(100)}
    assert all(ev == fresh[ev["seq"]] for ev in r["items"])


async def test_the_warmer_derives_the_archive_in_the_background_and_never_raises(monkeypatch):
    monkeypatch.setattr(arc, "WARM_ENABLED", True)
    monkeypatch.setattr(arc, "WARM_PAUSE_S", 0)
    await _fill_day(n=60)
    await _day({"date": DAY.isoformat(), "limit": 5})
    assert arc.warm_wait(10)
    assert arc.cache_stats()["derived_full"] == len({_content(i) for i in range(60)})
    r = await _day({"date": DAY.isoformat(), "symbol": "NVDA", "limit": 50})
    assert r["timing_ms"]["derived"] == 0


async def test_a_derivation_fault_never_costs_a_headline(monkeypatch):
    await _fill_day(n=6)
    from api.services.trade_exchange_news import categories

    def boom(*_a, **_k):
        raise RuntimeError("resolver down")
    monkeypatch.setattr(categories, "tickers_for", boom)
    monkeypatch.setattr(categories, "category_for", boom)
    r = await _day({"date": DAY.isoformat(), "hide_placeholders": False})
    assert r["total"] == 6


async def test_requests_are_admitted_a_few_at_a_time(monkeypatch):
    await _fill_day(n=5)
    running, peak = 0, 0
    real = arc.day_slice

    def slow(*a, **k):
        nonlocal running, peak
        running += 1
        peak = max(peak, running)
        time.sleep(0.05)
        running -= 1
        return real(*a, **k)
    monkeypatch.setattr(arc, "day_slice", slow)
    monkeypatch.setattr(route, "_archive_slots", None)
    rs = await asyncio.gather(*[_call(ADMIN, "POST", route.DAY_PATH, {"date": DAY.isoformat()}) for _ in range(6)])
    assert all(r.status_code == 200 for r in rs) and peak <= arc.CONCURRENT


async def test_cache_sizes_are_bounded_and_reported(monkeypatch):
    await _fill_day(n=30)
    await _day({"date": DAY.isoformat()})
    monkeypatch.setattr(arc, "_cache_max", lambda: 5)
    for i in range(10):
        arc._light_of("TXNews1", f"SYNTHETIC unique {i}")
    assert arc.cache_stats()["derived_light"] == 5
    status = (await _call(ADMIN, "GET", route.STATUS_PATH)).json()
    assert set(status["archive_cache"]) == {"index_rows", "derived_light", "derived_full", "rebuilds"}


async def test_recent_events_equal_a_fresh_build():
    p = await _fill_day(n=12)
    body = (await _call(ADMIN, "GET", route.RECENT_PATH + "?limit=12")).json()
    fresh = {r["seq"]: pl.headline_event(r, p.store.epoch) for r in p.store.recent(100)}
    assert all(ev == fresh[ev["seq"]] for ev in body["items"])


async def test_events_are_built_from_the_index_with_current_repeat_counts(monkeypatch):
    """No per-row database read: rows come from the in-memory index, and only the
    repeat counts (the one column that changes) are read -- in one small query."""
    monkeypatch.setenv("TXN_DEDUPE_WINDOW_S", "60")
    p = await _fill_day(n=20)
    content, source = _content(7)
    await p.submit(rec(content, et_ms(DAY, 4) + 7 * 300_000 + 5_000, source), "push")    # a resend: a repeat
    assert p.store.repeats() == {8: 1}
    reads = []
    real = p.store._conn
    monkeypatch.setattr(p.store, "_conn", lambda: reads.append(1) or real())
    r = await _day({"date": DAY.isoformat(), "limit": 50, "hide_placeholders": False})
    fresh = {row["seq"]: pl.headline_event(row, p.store.epoch) for row in p.store.recent(100)}
    assert all(ev == fresh[ev["seq"]] for ev in r["items"]) and len(r["items"]) == 20
    assert next(ev for ev in r["items"] if ev["seq"] == 8)["repeat_count"] == 1
    assert len(reads) < 12                                              # a handful of statements, not one per row


async def test_recent_reads_the_index_including_before():
    p = await _fill_day(n=30)
    fresh = {row["seq"]: pl.headline_event(row, p.store.epoch) for row in p.store.recent(100)}
    newest = (await _call(ADMIN, "GET", route.RECENT_PATH + "?limit=5")).json()
    assert [x["seq"] for x in newest["items"]] == [26, 27, 28, 29, 30]
    assert (newest["first_seq"], newest["last_seq"]) == (1, 30)
    older = (await _call(ADMIN, "GET", route.RECENT_PATH + "?limit=5&before=26")).json()
    assert [x["seq"] for x in older["items"]] == [21, 22, 23, 24, 25]
    assert all(ev == fresh[ev["seq"]] for ev in newest["items"] + older["items"])


def test_category_names_match_the_classifier():
    from api.services.trade_exchange_news import categories
    assert set(arc.CATEGORIES) == set(categories.CATEGORIES)


async def test_a_large_day_is_quick_cold_and_warm():
    """5,000 headlines on one day (the archive's count bound): cold = the index is
    read and LIGHT derivations made; warm = in memory. Generous bounds for CI."""
    p = pl.start(asyncio.get_running_loop())
    base = et_ms(DAY, 0)
    for i in range(5000):
        content, source = _content(i)
        await p.submit(rec(content, base + i * 17_000, source), "push")
    t0 = time.perf_counter()
    cold = await _day({"date": DAY.isoformat(), "limit": 60})
    t1 = time.perf_counter()
    warm = await _day({"date": DAY.isoformat(), "limit": 60, "cursor": cold["older_cursor"], "categories": ["Macro"]})
    t2 = time.perf_counter()
    jump = await _day({"date": DAY.isoformat(), "limit": 60, "at": "12:00"})
    t3 = time.perf_counter()
    assert cold["day_total"] == 5000 and len(warm["items"]) == 60 and jump["items"]
    assert t1 - t0 < 8.0 and t2 - t1 < 1.0 and t3 - t2 < 1.0, (t1 - t0, t2 - t1, t3 - t2)
