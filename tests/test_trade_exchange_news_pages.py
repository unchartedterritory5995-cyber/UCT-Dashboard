"""Trade Exchange News historical pages: POST /api/trade-exchange-news/pages.

Synthetic headlines only. The page is filtered ON THE SERVER over the whole
retained archive and cut from a stable ``seq <= top`` snapshot (pages.py).
"""
from __future__ import annotations

import asyncio
import time

import httpx
import pytest
from fastapi import FastAPI

from api.middleware import auth_middleware
from api.routers import trade_exchange_news as route
from api.services.trade_exchange_news import pages as txn_pages
from api.services.trade_exchange_news import pipeline as pl
from api.services.trade_exchange_news import reconcile as rc
from tests.support.txn_fakes import load_receiver

rx = load_receiver()["txn_receiver"]
BASE_MS = 1_800_000_000_000
ADMIN = {"id": "admin-1", "role": "admin", "email": "a@test"}
MEMBER = {"id": "member-1", "role": "user", "email": "m@test"}


@pytest.fixture(autouse=True)
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("TXN_ENABLED", "1")
    monkeypatch.setenv("TXN_DB_PATH", str(tmp_path / "txn.db"))
    monkeypatch.setenv("TXN_HISTORY_MAX_AGE_HOURS", str(24 * 365 * 100))
    monkeypatch.setenv("TXN_DEDUPE_WINDOW_S", "0")
    monkeypatch.setenv("TXN_SOURCE_ALLOWLIST", "TXNews1,TX-PressRelease")
    route._streams.clear()
    txn_pages.clear_cache()
    yield
    rc.stop()
    pl.stop()
    route._streams.clear()


def rec(content, i=0, source="TXNews1"):
    cfg = rx.Config({})
    return rx.build_record(source, content, {}, rx.delivery_meta({}, 1, None), cfg,
                           now_ms=BASE_MS + i * 1000)


def _app(user):
    app = FastAPI()
    app.include_router(route.router)
    if user is not None:
        app.dependency_overrides[auth_middleware.get_current_user] = lambda: user
    return app


async def _post(user, body, raw=None):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=_app(user)),
                                 base_url="http://web.test") as c:
        if raw is not None:
            return await c.post(route.PAGES_PATH, content=raw)
        return await c.post(route.PAGES_PATH, json=body)


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


async def _fill(n: int):
    p = pl.start(asyncio.get_running_loop())
    for i in range(n):
        content, source = _content(i)
        await p.submit(rec(content, i, source), "push")
    return p


def _oracle(p, *, query="", categories=(), symbol=None, symbols=None, hide=True, top=None):
    """The widget's own rule (tradeExchangeNewsModel.visibleItems) over the EVENTS the
    server builds -- what the page must agree with, row for row."""
    rows = p.store.recent(10_000)
    evs = [pl.headline_event(r, p.store.epoch) for r in rows]
    q = query.strip().lower()
    cats = set(categories) if categories and len(set(categories)) < 8 else None
    out = []
    for ev in reversed(evs):
        if top is not None and ev["seq"] > top:
            continue
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


async def _all_pages(body):
    first = (await _post(ADMIN, {**body, "page": 1})).json()
    seqs = [it["seq"] for it in first["items"]]
    for n in range(2, first["pages"] + 1):
        r = (await _post(ADMIN, {**body, "page": n, "top": first["top"]})).json()
        assert r["page"] == n
        seqs += [it["seq"] for it in r["items"]]
    return first, seqs


# ── authorization ────────────────────────────────────────────────────────────

async def test_signed_out_and_non_admin_members_get_nothing():
    await _fill(3)
    anon, member = await _post(None, {}), await _post(MEMBER, {})
    assert anon.status_code == 401 and member.status_code == 403
    assert "SYNTHETIC" not in anon.text + member.text


async def test_dark_when_the_flag_is_off(monkeypatch):
    await _fill(1)
    monkeypatch.setenv("TXN_ENABLED", "")
    assert (await _post(ADMIN, {})).status_code == 404


async def test_503_before_the_pipeline_starts():
    assert (await _post(ADMIN, {})).status_code == 503


async def test_bad_bodies_are_refused_not_guessed():
    await _fill(2)
    assert (await _post(ADMIN, None, raw=b"not json")).status_code == 400
    assert (await _post(ADMIN, None, raw=b"[1,2]")).status_code == 422
    assert (await _post(ADMIN, {"categories": "News"})).status_code == 422
    assert (await _post(ADMIN, None, raw=b"{" + b" " * (route.MAX_PAGES_BODY + 1) + b"}")).status_code == 413


# ── pages ────────────────────────────────────────────────────────────────────

async def test_page_one_is_the_newest_and_pages_walk_back_without_gaps_or_duplicates():
    p = await _fill(60)
    first, seqs = await _all_pages({"size": 7})
    want = _oracle(p)
    assert seqs == want                                   # every match once, newest first
    assert first["total"] == len(want) and first["pages"] == -(-len(want) // 7)
    assert first["items"][0]["seq"] == want[0] and first["page"] == 1
    assert first["epoch"] == p.store.epoch and first["first_seq"] == 1 and first["last_seq"] == 60
    assert first["oldest_ms"] == BASE_MS and first["archive_total"] == 60
    # rows are full events: the same build /recent and the stream use
    assert {"category", "tickers", "impact", "mentions", "placeholder"} <= set(first["items"][0])


async def test_default_page_size_is_25():
    await _fill(60)
    r = (await _post(ADMIN, {})).json()
    assert r["size"] == 25 and len(r["items"]) == 25


@pytest.mark.parametrize("filters", [
    {"query": "fed"},
    {"query": "$NVDA"},
    {"query": "nvda"},
    {"categories": ["Macro"]},
    {"categories": ["Earnings", "Press Release"]},
    {"symbol": "AAPL"},
    {"symbols": ["NVDA", "MSFT"]},
    {"symbols": []},
    {"symbol": "AAPL", "categories": ["Press Release"], "query": "product"},
    {"hide_placeholders": False},
])
async def test_filters_run_over_the_whole_archive_and_match_the_widget_rules(filters):
    p = await _fill(90)
    _, seqs = await _all_pages({**filters, "size": 10})
    want = _oracle(p, query=filters.get("query", ""), categories=filters.get("categories", ()),
                   symbol=filters.get("symbol"), symbols=filters.get("symbols"),
                   hide=filters.get("hide_placeholders", True))
    assert seqs == want


async def test_all_categories_selected_is_no_category_filter():
    p = await _fill(30)
    allc = ["News", "Macro", "Options", "Earnings", "Price", "Press Release", "Filing", "Other"]
    _, seqs = await _all_pages({"categories": allc, "size": 50})
    assert seqs == _oracle(p)


async def test_live_arrivals_never_shift_a_snapshot():
    p = await _fill(50)
    first = (await _post(ADMIN, {"size": 10})).json()
    top = first["top"]
    p2_before = (await _post(ADMIN, {"page": 2, "size": 10, "top": top})).json()
    for i in range(50, 63):                                # 13 new headlines arrive meanwhile
        content, source = _content(i)
        await p.submit(rec(content, i, source), "push")
    p2_after = (await _post(ADMIN, {"page": 2, "size": 10, "top": top})).json()
    assert [x["seq"] for x in p2_after["items"]] == [x["seq"] for x in p2_before["items"]]
    assert p2_after["top"] == top and p2_after["total"] == first["total"]
    assert p2_after["last_seq"] == 63                       # the archive moved on; the snapshot did not
    fresh = (await _post(ADMIN, {"size": 10})).json()       # page 1 without a snapshot is the newest
    assert fresh["top"] == 63 and fresh["total"] > first["total"]


async def test_a_page_past_the_end_is_clamped_and_says_so():
    await _fill(30)
    r = (await _post(ADMIN, {"page": 999, "size": 10})).json()
    assert r["page"] == r["pages"] and len(r["items"]) == r["total"] - (r["pages"] - 1) * 10


async def test_no_matches_is_page_one_of_one():
    await _fill(12)
    r = (await _post(ADMIN, {"query": "nothing matches this"})).json()
    assert (r["page"], r["pages"], r["total"], r["items"]) == (1, 1, 0, [])


async def test_bounds_are_enforced():
    await _fill(5)
    r = (await _post(ADMIN, {"size": 10_000, "page": -4, "top": 10**9})).json()
    assert r["size"] == txn_pages.MAX_SIZE and r["page"] == 1 and r["top"] == 5


async def test_a_snapshot_from_another_epoch_is_reset_to_the_newest():
    p = await _fill(20)
    r = (await _post(ADMIN, {"page": 2, "size": 5, "top": 7, "epoch": "not-this-one"})).json()
    assert r["reset"] is True and r["top"] == 20 and r["epoch"] == p.store.epoch
    same = (await _post(ADMIN, {"page": 2, "size": 5, "top": 7, "epoch": p.store.epoch})).json()
    assert same["reset"] is False and same["top"] == 7


async def test_graphic_placeholders_are_counted_not_lost():
    p = await _fill(30)
    r = (await _post(ADMIN, {"size": 100})).json()
    shown = (await _post(ADMIN, {"size": 100, "hide_placeholders": False})).json()
    graphic = sum(1 for s in shown["items"] if s["placeholder"] == "graphic")
    assert graphic == 5 and r["hidden_placeholders"] == 5 and r["total"] + 5 == shown["total"]
    assert shown["hidden_placeholders"] == 0
    assert len(p.store.recent(100)) == 30                   # nothing dropped from storage


async def test_pruned_history_only_shortens_the_last_page():
    p = await _fill(40)
    first = (await _post(ADMIN, {"size": 10, "hide_placeholders": False})).json()
    p2 = (await _post(ADMIN, {"page": 2, "size": 10, "top": first["top"], "hide_placeholders": False})).json()
    p.store.prune(max_age_ms=10**15, max_items=25)          # the oldest 15 age out
    p2_after = (await _post(ADMIN, {"page": 2, "size": 10, "top": first["top"], "hide_placeholders": False})).json()
    assert [x["seq"] for x in p2_after["items"]] == [x["seq"] for x in p2["items"]]
    assert p2_after["total"] == 25 and p2_after["pages"] == 3 and p2_after["first_seq"] == 16


async def test_a_derivation_fault_never_costs_a_headline(monkeypatch):
    await _fill(6)

    def boom(*_a, **_k):
        raise RuntimeError("resolver down")
    from api.services.trade_exchange_news import categories
    monkeypatch.setattr(categories, "tickers_for", boom)
    monkeypatch.setattr(categories, "category_for", boom)
    txn_pages.clear_cache()
    r = (await _post(ADMIN, {"size": 50, "hide_placeholders": False})).json()
    assert r["total"] == 6


async def test_a_warm_page_derives_nothing_and_its_events_match_the_stream_build():
    p = await _fill(40)
    cold = (await _post(ADMIN, {"size": 10, "hide_placeholders": False})).json()
    warm = (await _post(ADMIN, {"page": 3, "size": 10, "top": cold["top"], "hide_placeholders": False})).json()
    distinct = len({(r["source"], r["content"]) for r in p.store.recent(100)})   # repeats share one derivation
    assert cold["timing_ms"]["derived"] == distinct and warm["timing_ms"]["derived"] == 0
    assert set(warm["timing_ms"]) == {"wait", "scan", "events", "derived"}
    fresh = {r["seq"]: pl.headline_event(r, p.store.epoch) for r in p.store.recent(100)}
    for ev in cold["items"] + warm["items"]:
        assert ev == fresh[ev["seq"]]                       # the cached build IS the stream's build


async def test_page_builds_are_admitted_a_few_at_a_time(monkeypatch):
    await _fill(5)
    running, peak = 0, 0
    real = txn_pages.page

    def slow(*a, **k):
        nonlocal running, peak
        running += 1
        peak = max(peak, running)
        time.sleep(0.05)
        running -= 1
        return real(*a, **k)
    monkeypatch.setattr(txn_pages, "page", slow)
    monkeypatch.setattr(route, "_page_slots", None)
    rs = await asyncio.gather(*[_post(ADMIN, {}) for _ in range(6)])
    assert all(r.status_code == 200 for r in rs) and peak <= txn_pages.CONCURRENT


def test_category_names_match_the_classifier():
    from api.services.trade_exchange_news import categories
    assert set(txn_pages.CATEGORIES) == set(categories.CATEGORIES)


async def test_the_whole_retained_archive_pages_quickly():
    """5,000 headlines (the count bound): a cold scan derives every row once; a warm
    page is a key-ordered read plus set lookups. Generous bounds for slow CI."""
    p = pl.start(asyncio.get_running_loop())
    rows = []
    for i in range(5000):
        content, source = _content(i)
        rows.append(rec(content, i, source))
    for r in rows:
        await p.submit(r, "push")
    t0 = time.perf_counter()
    cold = (await _post(ADMIN, {"query": "rates", "page": 3})).json()
    t1 = time.perf_counter()
    warm = (await _post(ADMIN, {"categories": ["Macro"], "page": 30, "top": cold["top"]})).json()
    t2 = time.perf_counter()
    assert cold["total"] == len(_oracle(p, query="rates"))
    assert warm["page"] == 30 and len(warm["items"]) == 25
    assert t1 - t0 < 8.0 and t2 - t1 < 1.0, (t1 - t0, t2 - t1)
