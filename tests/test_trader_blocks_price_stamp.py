"""P2a Task 10, price-stamped lines (spec §P2 item 4): the server half.

A stamp is ONE j2_fact_observations row carrying the price, its real source and its real as-of: a live
price during the regular session, outside it the frozen close stored as "last close" and dated by THAT
session's close (trader_blocks' R-T3 logic: _quote_window / _frozen_close / _last_close), never the
capture time standing in for an observation time. The route is a trader-blocks route, not a note URL,
and writes no note. Expected values are HARD-CODED, never derived from the calendar under test."""
from __future__ import annotations

import importlib
import json
import os
import tempfile
import types
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

_ET = ZoneInfo("America/New_York")
MID = datetime(2026, 10, 13, 17, 26, tzinfo=timezone.utc)          # Tue 1:26 PM ET, regular session
TUE_POST = datetime(2026, 10, 13, 17, 30, tzinfo=_ET)              # Tue post-market: last session Tue
SATURDAY = datetime(2026, 10, 17, 14, 0, tzinfo=timezone.utc)      # Sat 10:00 ET
URL = "/api/j2/trader-blocks/price-stamp"


def _frozen(price, day_close, prev_close, change_pct, observed_at, ext_session):
    """A row shaped as live_prices._fetch_snapshots writes it outside the regular session."""
    return {"price": price, "change_pct": change_pct, "change": 1.0, "volume": 1, "day_open": 0.0,
            "day_high": 0.0, "day_low": 0.0, "prev_close": prev_close, "day_close": day_close,
            "ext_price": price + 0.6, "ext_session": ext_session, "observed_at": observed_at,
            "prev_change": 3.0, "prev_change_pct": 0.5042}


@pytest.fixture
def market(monkeypatch):
    """A cold quote cache and bar store. `get_live_prices` (the stamp's one bounded read) is replaced
    by a fake that writes `rows` into the shared per-ticker cache, as the real fetch does; the vendor
    doors under it RECORD a call (they must never be reached past the fake)."""
    from api.routers import live_prices
    from api.services import bars_sqlite
    from api.services.cache import TTLCache
    ns = types.SimpleNamespace(rows={}, reads=[], calls=[], live_prices=live_prices, bars_sqlite=bars_sqlite)

    def door(name):
        def reached(*a, **k):
            ns.calls.append(name)
            raise AssertionError(f"the stamp reached {name}")
        return reached

    monkeypatch.setattr(live_prices, "cache", TTLCache(max_size=100))

    def fake_get_live_prices(tickers, user=None):
        ns.reads.append(tickers)
        out = {}
        for tk in tickers.split(","):
            if tk in ns.rows:
                live_prices.cache.set(live_prices._px_key(tk), dict(ns.rows[tk]), ttl=60)
                out[tk] = dict(ns.rows[tk])
        return out

    monkeypatch.setattr(live_prices, "get_live_prices", fake_get_live_prices)
    for name in ("_fetch_snapshots", "_get_client", "_session_closes"):
        monkeypatch.setattr(live_prices, name, door(f"live_prices.{name}"))
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda ticker, tf, n: [])
    return ns


def _quote(sym, now):
    from api.services.journal_two import trader_blocks as tb
    return tb.price_stamp_quote(sym, now=now)


# ── the quote a stamp stores ─────────────────────────────────────────────────────────────────────

def test_in_the_session_a_live_row_is_a_live_price_dated_by_the_vendor(market):
    market.rows["NVDA"] = {"price": 142.5, "change_pct": 1.2, "observed_at": 1791912360, "market_closed": False}
    assert _quote("NVDA", MID) == {"price": 142.5, "changePct": 1.2, "source": "live price",
                                   "asOf": "2026-10-13T17:26:00Z"}
    assert market.reads == ["NVDA"] and market.calls == []


def test_after_the_close_the_frozen_row_is_the_last_close_dated_by_its_session(market):
    market.rows["NVDA"] = _frozen(601.25, 601.25, 598.0, 0.5435, 1791926970, "post")
    for now in (TUE_POST, TUE_POST.astimezone(timezone.utc)):
        assert _quote("NVDA", now) == {"price": 601.25, "changePct": 0.5435, "source": "last close",
                                       "asOf": "2026-10-13T20:00:00Z"}
    assert market.calls == []


def test_a_closed_row_that_proves_no_change_stores_none_never_zero(market):
    """A dated closed row with no prior close: its change_pct 0.0 is fabricated (R-T3-4 n1), so the stamp
    stores no change (the client says "change unavailable"), and with no held bar there is none to take."""
    market.rows["NVDA"] = {"price": 598.0, "change_pct": 0.0, "prev_close": 0.0, "observed_at": None,
                           "session_close_at": 1791489600, "market_closed": True}
    got = _quote("NVDA", SATURDAY)
    assert got["changePct"] is None and got["source"] == "last close" and got["asOf"] == "2026-10-08T20:00:00Z"


def test_a_row_that_cannot_prove_its_session_is_no_stamp(market):
    # post-market with no day bar: prevDay.c is MONDAY's close, not the session that just closed
    market.rows["NVDA"] = _frozen(598.0, None, 598.0, 0.2, 1791926970, "post")
    assert _quote("NVDA", TUE_POST) is None
    assert market.calls == []


def test_nothing_read_and_nothing_held_is_no_stamp(market):
    assert _quote("NVDA", MID) is None
    assert market.reads == ["NVDA"]


def test_a_failed_read_still_answers_from_a_warm_cache(market, monkeypatch):
    lp = market.live_prices
    lp.cache.set(lp._px_key("NVDA"), {"price": 142.5, "change_pct": 1.2, "observed_at": 1791912360,
                                      "market_closed": False}, ttl=60)

    def boom(tickers, user=None):
        raise RuntimeError("valve timeout")

    monkeypatch.setattr(lp, "get_live_prices", boom)
    assert _quote("NVDA", MID)["price"] == 142.5


def test_the_last_completed_session_from_a_held_bar_when_the_read_finds_nothing(market, monkeypatch):
    rows = [(20261015, 0, 0, 0, 595.0, 1), (20261016, 0, 0, 0, 598.0, 1)]
    monkeypatch.setattr(market.bars_sqlite, "get_bars",
                        lambda ticker, tf, n: list(rows)[-n:] if (ticker, tf) == ("NVDA", "D") else [])
    assert _quote("NVDA", SATURDAY) == {"price": 598.0, "changePct": 0.5042, "source": "last close",
                                        "asOf": "2026-10-16T20:00:00Z"}


# ── the route ────────────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


@pytest.fixture
def client(db_path, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    from api.routers import notebook_journal_styles as r
    app = FastAPI()
    app.include_router(r.router)
    c = TestClient(app)
    c.app_ref = app
    yield c
    app.dependency_overrides.clear()


def _as(client, uid="u1", plan="pro"):
    user = {"id": uid, "role": "member", "plan": plan}
    client.app_ref.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    client.app_ref.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)


@pytest.fixture
def quote(monkeypatch):
    from api.services.journal_two import trader_blocks as tb
    q = {"value": {"price": 601.25, "changePct": 0.5435, "source": "last close", "asOf": "2026-10-13T20:00:00Z"},
         "asked": []}

    def fake(sym, now=None):
        q["asked"].append(sym)
        return q["value"]

    monkeypatch.setattr(tb, "price_stamp_quote", fake)
    return q


def test_gate_off_404_signed_out_401_free_402(client, monkeypatch, quote):
    monkeypatch.delenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", raising=False)
    assert client.post(URL, json={"noteId": "n1", "ticker": "NVDA"}).status_code == 404
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    assert client.post(URL, json={"noteId": "n1", "ticker": "NVDA"}).status_code == 401
    _as(client, plan="free")
    assert client.post(URL, json={"noteId": "n1", "ticker": "NVDA"}).status_code == 402
    assert quote["asked"] == []


def _note(uid="u1", trashed=False):
    """A real note row for `uid` (the route answers 404 for any other)."""
    from api.services.journal_two import notes
    nid = notes.create_note(uid, {"title": "NVDA thesis"})["id"]
    if trashed:
        assert notes.delete_note(uid, nid)
    return nid


def _rows(db_path):
    import sqlite3
    with sqlite3.connect(db_path) as conn:
        return conn.execute("SELECT COUNT(*) FROM j2_fact_observations").fetchone()[0]


def _note_row(db_path, nid):
    import sqlite3
    with sqlite3.connect(db_path) as conn:
        return conn.execute("SELECT updated_at, body_json, deleted_at FROM j2_notes WHERE id = ?", (nid,)).fetchone()


# ── I-1 (review): the note must be the caller's own, live note, or nothing is read or written ──────

@pytest.mark.parametrize("whose", ["foreign", "trashed", "missing"])
def test_a_note_that_is_not_the_callers_live_note_is_404_before_any_read_or_row(client, quote, db_path, whose):
    _as(client)
    nid = {"foreign": lambda: _note("u2"), "trashed": lambda: _note("u1", trashed=True),
           "missing": lambda: "no-such-note"}[whose]()
    r = client.post(URL, json={"noteId": nid, "ticker": "NVDA"})
    assert r.status_code == 404 and r.json()["detail"] == "Not found"
    assert quote["asked"] == []                                       # no vendor read
    assert _rows(db_path) == 0                                        # no row


def test_the_callers_own_note_is_stamped(client, quote, db_path):
    _as(client)
    r = client.post(URL, json={"noteId": _note("u1"), "ticker": "NVDA"})
    assert r.status_code == 200 and quote["asked"] == ["NVDA"] and _rows(db_path) == 1


def test_a_stamp_is_one_fact_row_with_its_source_and_as_of_and_writes_no_note(client, quote, db_path):
    import sqlite3
    _as(client)
    nid = _note("u1")
    before = _note_row(db_path, nid)
    r = client.post(URL, json={"noteId": nid, "ticker": "nvda"})
    assert r.status_code == 200, r.text
    fact = r.json()["fact"]
    assert fact["ticker"] == "NVDA" and fact["factType"] == "price" and fact["value"] == 601.25
    assert fact["unit"] == "usd_per_share" and fact["temporalMode"] == "live_and_snapshot"
    assert fact["sourceRef"] == "last close"
    assert fact["sourceAsOf"] == "2026-10-13T20:00:00Z"
    assert fact["observedAt"] != fact["sourceAsOf"]                   # the capture is not the as-of
    assert quote["asked"] == ["NVDA"]
    with sqlite3.connect(db_path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM j2_fact_observations").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM j2_notes").fetchone()[0] == 1
    assert _note_row(db_path, nid) == before                          # the note itself is untouched


def test_no_quote_is_409_with_a_sentence_and_no_row(client, quote, db_path):
    import sqlite3
    _as(client)
    quote["value"] = None
    r = client.post(URL, json={"noteId": _note("u1"), "ticker": "NVDA"})
    assert r.status_code == 409 and r.json()["detail"] == "No NVDA price could be read just now."
    with sqlite3.connect(db_path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM j2_fact_observations").fetchone()[0] == 0


@pytest.mark.parametrize("body", [{}, {"noteId": "n1"}, {"ticker": "NVDA"}, {"noteId": 3, "ticker": "NVDA"},
                                  {"noteId": "n1", "ticker": "NV DA"}, {"noteId": "n1", "ticker": "$$$"},
                                  {"noteId": "n1", "ticker": "TOOLONGTICKER"}])
def test_a_bad_body_is_400_before_any_read(client, quote, body):
    _as(client)
    assert client.post(URL, json=body).status_code == 400
    assert quote["asked"] == []


def test_a_class_share_keeps_its_spelling(client, quote):
    _as(client)
    r = client.post(URL, json={"noteId": _note("u1"), "ticker": "BRK-B"})
    assert r.status_code == 200 and r.json()["fact"]["ticker"] == "BRK-B" and quote["asked"] == ["BRK-B"]


def test_the_route_is_not_a_note_url():
    from api.routers import notebook_journal_styles as r
    paths = {rt.path for rt in r.router.routes if "POST" in rt.methods}
    assert URL in paths
    assert not URL.startswith("/api/j2/notes")


def test_create_fact_observation_stores_a_given_source_as_of_and_none_by_default(db_path):
    from api.services.journal_two import note_facts
    a = note_facts.create_fact_observation("u1", "n1", ticker="NVDA", fact_type="price", value=1.0)
    assert a["sourceAsOf"] is None
    b = note_facts.create_fact_observation("u1", "n1", ticker="NVDA", fact_type="price", value=1.0,
                                           source_as_of="2026-10-13T20:00:00Z", source_ref="last close")
    assert b["sourceAsOf"] == "2026-10-13T20:00:00Z" and b["sourceRef"] == "last close"


# ── the words the card shows: worded on the server, in ET (no client works out a session or a zone) ──

_WORDING = Path(__file__).resolve().parents[1] / "app/src/pages/charts/widgets/priceAsOfWording.fixture.json"
_ROWS = json.loads(_WORDING.read_text(encoding="utf-8"))["rows"]


@pytest.mark.parametrize("row", _ROWS, ids=[r["want"] for r in _ROWS])
def test_the_as_of_label_is_the_market_context_wording(row):
    """M-1: the SAME words the market context stamp shows (marketContextModel.test.js reads this table)."""
    from api.services.journal_two import note_facts
    assert note_facts._as_of_label("price", row["source"], row["asOf"]) == row["want"]


def test_the_shared_wording_table_is_not_empty_and_covers_both_bases():
    assert len(_ROWS) >= 4 and {r["source"] for r in _ROWS} == {"last close", "live price"}


@pytest.mark.parametrize("ref,as_of", [(None, "2026-10-13T20:00:00Z"), ("trade-123", "2026-10-13T20:00:00Z"),
                                       ("last close", None), ("last close", "not a time")])
def test_no_basis_or_no_as_of_is_no_label(ref, as_of):
    from api.services.journal_two import note_facts
    assert note_facts._as_of_label("price", ref, as_of) is None


def test_only_a_price_fact_carries_an_as_of_label():
    from api.services.journal_two import note_facts
    assert note_facts._as_of_label("analyst_price_target_consensus", "last close", "2026-10-13T20:00:00Z") is None


def test_the_route_returns_the_label_with_the_fact(client, quote):
    _as(client)
    fact = client.post(URL, json={"noteId": _note("u1"), "ticker": "NVDA"}).json()["fact"]
    assert fact["asOfLabel"] == "Last close, Oct 13, 2026, 4:00 PM ET"
