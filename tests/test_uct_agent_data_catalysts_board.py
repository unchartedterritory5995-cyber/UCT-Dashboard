"""MD-1 kind `catalysts.board` (Phase 2 market-moving news + catalysts) — UCT's catalyst board for the Agent.

No network, no provider, no production database: a throwaway SQLite file with the catalyst store's own schema, the
ET clock pinned. Pins: the read is READ-ONLY and side-effect-free (no file / table creation, no byte written, the
store's writing helpers and the engine's refresh are never called), ABSENT vs UNREADABLE are different answers,
only the board's displayed rows are served, headlines are quoted as stored (AI search answers and tweets never are;
redacted text is said, not rebuilt), freshness / stale / today-missing, the symbol / sector / days filters, the
gateway's dark + isolation gates, and ACCESS: anonymous / free / paid non-admin callers get nothing through any door.
"""
from __future__ import annotations

import contextlib
import hashlib
import json
import os
import sqlite3
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services.catalyst import store as cat_store
from api.services.uct_agent.marketdata import catalysts_board as cb
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw

ET = cb._ET
# Friday 2026-11-13, 10:00 ET — a trading day, inside the engine's window, after the open
NOW = datetime(2026, 11, 13, 10, 0, tzinfo=ET)
TODAY = "2026-11-13"


def _ts(y, mo, d, h, mi=0) -> int:
    return int(datetime(y, mo, d, h, mi, tzinfo=ET).timestamp())


def _row(ticker, md=TODAY, rank=1, **o):
    sig = o.pop("signals", {"rss": [{"source": "Wire A", "title": f"{ticker} headline one", "url": "https://a.example/1",
                                     "time_published": _ts(2026, 11, 13, 7, 5)}],
                            "tweets": [{"text": "a social post that is never quoted", "created_at": _ts(2026, 11, 13, 6)}]})
    base = {"market_date": md, "ticker": ticker, "rank": rank, "score": 1.0, "tag": "Catalyst", "price": 10.0,
            "gap_pct": 4.25, "vol_x": 2.0, "market_cap": 1e9, "sector": "Technology",
            "thesis_text": f"{ticker} engine write-up text", "thesis_model": "m", "thesis_at": _ts(2026, 11, 13, 7, 30),
            "thesis_sources": json.dumps(["https://www.a.example/story", "https://b.example/x"]), "signals_hash": "h",
            "catalyst_at": _ts(2026, 11, 13, 7, 5), "raw_signals": json.dumps(sig), "grade": "A",
            "catalyst_type": "Earnings", "is_new": 1, "refreshed_at": _ts(2026, 11, 13, 9, 15), "pre_move": 0,
            "rating_change": None, "thesis_status": "ok"}
    base.update(o)
    return base


def _make_db(path, rows):
    with contextlib.closing(sqlite3.connect(path)) as c:       # rollback journal: a read-only open needs no sidecar
        c.executescript(cat_store._SCHEMA)
        for col in ("rating_change TEXT", "thesis_status TEXT"):
            c.execute(f"ALTER TABLE catalysts ADD COLUMN {col}")
        for r in rows:
            cols = ",".join(r)
            c.execute(f"INSERT INTO catalysts ({cols}) VALUES ({','.join('?' * len(r))})", tuple(r.values()))
        c.commit()


def _digest(path) -> str:
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.ISOLATED_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, cb.KIND)
    gw._reset_for_test(None)
    monkeypatch.setattr(cb, "now_et", lambda: NOW)
    # the store's WRITING helpers and the engine's refresh must never run on an Agent read
    def boom(*a, **k):
        raise AssertionError("a write path ran")
    monkeypatch.setattr(cat_store, "_connect", boom)
    monkeypatch.setattr(cat_store, "_init_db", boom)
    from api.services.catalyst import engine
    monkeypatch.setattr(engine, "run_refresh", boom)
    yield
    gw._reset_for_test(None)


@pytest.fixture()
def db(tmp_path, monkeypatch):
    path = str(tmp_path / "catalysts.db")
    monkeypatch.setattr(cat_store, "_DB_PATH", path)

    def make(rows):
        _make_db(path, rows)
        return path
    return make


def _read(params, turn="t1", purpose="answer"):
    return gw.read(cb.KIND, params, user_id=1, turn_id=turn, purpose=purpose)


# ── read-only, side-effect-free ──────────────────────────────────────────────────────────────────────────────────────
def test_the_read_writes_nothing_and_creates_no_file(db, tmp_path):
    path = db([_row("AAA"), _row("BBB", rank=2)])
    before, listing = _digest(path), sorted(os.listdir(tmp_path))
    out = _read({})
    assert env.validate_envelope(out) == [] and out["status"] == "ok" and out["provider_calls"] == 0
    assert _digest(path) == before and sorted(os.listdir(tmp_path)) == listing


def test_ABSENT_no_file_is_an_honest_empty_board_and_no_file_is_created(tmp_path, monkeypatch):
    path = str(tmp_path / "nope" / "catalysts.db")
    monkeypatch.setattr(cat_store, "_DB_PATH", path)
    out = _read({"symbols": ["NVDA"]})
    assert env.validate_envelope(out) == [] and out["status"] == "ok" and out["as_of"] is None
    assert out["data"]["state"] == cb.ABSENT and out["data"]["rows"] == [] and out["data"]["not_on_board"] == ["NVDA"]
    assert cb.NOTE_ABSENT in out["notes"]
    assert not os.path.exists(path) and not os.path.exists(os.path.dirname(path))


def test_ABSENT_a_file_without_the_table_is_absent_too_and_stays_untouched(tmp_path, monkeypatch):
    path = str(tmp_path / "catalysts.db")
    with contextlib.closing(sqlite3.connect(path)) as c:
        c.execute("CREATE TABLE other (x)")
        c.commit()
    before = _digest(path)
    monkeypatch.setattr(cat_store, "_DB_PATH", path)
    out = _read({})
    assert out["data"]["state"] == cb.ABSENT and _digest(path) == before


def test_UNREADABLE_is_unavailable_never_an_empty_board(tmp_path, monkeypatch):
    path = str(tmp_path / "catalysts.db")
    open(path, "wb").write(b"this is not a sqlite database at all" * 40)
    monkeypatch.setattr(cat_store, "_DB_PATH", path)
    out = _read({})
    assert env.validate_envelope(out) == [] and out["status"] == "unavailable" and out["data"] is None
    assert out["notes"] == [cb.NOTE_UNREADABLE]


# ── the board ────────────────────────────────────────────────────────────────────────────────────────────────────────
def test_today_board_displayed_rows_only_in_rank_order_with_source_time_and_freshness(db):
    db([_row("BBB", rank=2), _row("AAA", rank=1), _row("HID", rank=None)])
    out = _read({})
    d = out["data"]
    assert out["freshness"] == "periodic" and out["stale"] is False
    assert out["as_of"] == env.utc_iso(datetime.fromtimestamp(_ts(2026, 11, 13, 9, 15), tz=timezone.utc))
    assert [r["symbol"] for r in d["rows"]] == ["AAA", "BBB"]            # the hidden (rank NULL) row is never served
    assert d["dates"] == [TODAY] and d["boards"][0]["flagged"] == 2 and d["requested_missing"] is False
    r = d["rows"][0]
    assert r["as_of"] == r["catalyst_at"] and r["catalyst_type"] == "Earnings" and r["grade"] == "A" and r["gap_pct"] == 4.25
    assert r["headlines"] == [{"title": "AAA headline one", "source": "Wire A", "url": "https://a.example/1",
                               "published_at": r["catalyst_at"], "isolated": True}]   # the gateway stamps every row
    assert r["social_posts"] == 1 and "social post" not in json.dumps(out)    # counted, never quoted
    assert r["writeup"] == "AAA engine write-up text" and r["writeup_sources"] == ["a.example", "b.example"]
    for n in (cb.NOTE_COOCCUR, cb.NOTE_WRITEUP, cb.NOTE_ROW_ASOF):
        assert n in out["notes"]
    assert not {"price", "score", "market_cap", "raw_signals", "thesis_model", "signals_hash"} & set(r)


def test_ai_search_answers_are_never_headlines_and_redacted_text_is_said(db):
    db([_row("AAA", signals={"rss": [{"source": "Perplexity (deep context)", "title": "an AI answer", "url": "u",
                                      "time_published": 1},
                                     {"source": "Wire B", "time_published": _ts(2026, 11, 13, 6)}]})])
    r = _read({})["data"]["rows"][0]
    assert r["headlines"] == [] and r["headline_count"] == 1 and r["headlines_redacted"] is True


def test_the_engines_failure_sentence_is_never_a_writeup(db):
    db([_row("AAA", thesis_text="Synthesis temporarily unavailable (rate limit)")])
    assert _read({})["data"]["rows"][0]["writeup"] is None


def test_stale_when_todays_board_was_last_refreshed_over_two_hours_ago(db, monkeypatch):
    db([_row("AAA", refreshed_at=_ts(2026, 11, 13, 7, 0))])
    out = _read({})
    assert out["stale"] is True and cb.NOTE_STALE in out["notes"]
    monkeypatch.setattr(cb, "now_et", lambda: NOW.replace(hour=8, minute=59))
    assert _read({}, turn="t2")["stale"] is False                          # 1 h 59 min: not stale


def test_todays_board_missing_after_the_open_is_stale_and_names_the_newest_stored_board(db, monkeypatch):
    db([_row("AAA", md="2026-11-12", refreshed_at=_ts(2026, 11, 12, 15))])
    out = _read({})
    d = out["data"]
    assert out["freshness"] == "historical" and out["stale"] is True and d["requested_missing"] is True
    assert d["dates"] == ["2026-11-12"]
    assert cb.NOTE_TODAY_MISSING.format(d=TODAY, latest="2026-11-12") in out["notes"]
    monkeypatch.setattr(cb, "now_et", lambda: NOW.replace(hour=8))           # before the open: not expected yet
    assert _read({}, turn="t2")["stale"] is False


def test_a_weekend_is_never_stale_for_a_missing_board(db, monkeypatch):
    db([_row("AAA", refreshed_at=_ts(2026, 11, 13, 9))])
    monkeypatch.setattr(cb, "now_et", lambda: datetime(2026, 11, 14, 12, 0, tzinfo=ET))
    out = _read({})
    assert out["stale"] is False and out["data"]["requested_missing"] is True and out["data"]["dates"] == [TODAY]


def test_a_past_date_is_historical(db):
    db([_row("AAA", md="2026-11-10"), _row("AAA", md=TODAY)])
    out = _read({"date": "2026-11-10"})
    assert out["freshness"] == "historical" and out["stale"] is False and out["data"]["dates"] == ["2026-11-10"]


def test_no_board_in_the_window_is_ok_with_a_note_and_no_as_of(db):
    db([_row("AAA", md="2026-10-01")])
    out = _read({"date": "2026-09-01"})
    assert env.validate_envelope(out) == [] and out["as_of"] is None and out["data"]["rows"] == []
    assert cb.NOTE_NO_BOARD.format(d="2026-09-01", n=0) in out["notes"]


# ── filters ──────────────────────────────────────────────────────────────────────────────────────────────────────────
def test_symbols_over_days_with_not_on_board_and_a_dual_class_spelling(db):
    db([_row("AAA", md="2026-11-11"), _row("BRK-B", md="2026-11-12"), _row("CCC", md=TODAY), _row("AAA", md=TODAY, rank=2),
        _row("OLD", md="2026-11-01")])
    out = _read({"symbols": ["aaa", "BRK.B", "ZZZ"], "days": 3})
    d = out["data"]
    assert d["dates"] == [TODAY, "2026-11-12", "2026-11-11"]
    assert [(r["symbol"], r["market_date"]) for r in d["rows"]] == [("AAA", TODAY), ("BRK-B", "2026-11-12"), ("AAA", "2026-11-11")]
    assert d["not_on_board"] == ["ZZZ"] and out["coverage"] == {"requested": 3, "answered": 2}


def test_limit_applies_per_board_without_symbols(db):
    db([_row(f"T{i:02d}", rank=i) for i in range(1, 15)])
    assert len(_read({"limit": 5})["data"]["rows"]) == 5
    assert len(_read({}, turn="t2")["data"]["rows"]) == cb.DEFAULT_LIMIT


def test_sector_filter_is_the_boards_own_sector_and_lists_the_sectors(db):
    db([_row("AAA", sector="Technology"), _row("BBB", rank=2, sector="Healthcare")])
    out = _read({"sector": "healthcare"})
    assert [r["symbol"] for r in out["data"]["rows"]] == ["BBB"] and out["data"]["sectors"] == ["Healthcare", "Technology"]
    assert _read({"sector": "semis"}, turn="t2")["data"]["rows"] == []


@pytest.mark.parametrize("params", [{"symbols": "NVDA"}, {"symbols": ["<x>"]}, {"symbols": [f"S{i}" for i in range(51)]},
                                    {"date": "2026-13-01"}, {"date": "today"}, {"days": 0}, {"days": 6}, {"days": True},
                                    {"limit": 0}, {"limit": 26}, {"sector": ""}, {"sector": 5}])
def test_bad_requests_are_refused_before_any_read(db, params, monkeypatch):
    db([_row("AAA")])
    opened = []
    monkeypatch.setattr(cb, "_ro_query", lambda *a: opened.append(a))
    out = _read(params)
    assert out["status"] == "refused" and opened == []


# ── gates ────────────────────────────────────────────────────────────────────────────────────────────────────────────
def test_dark_unless_named_and_dormant_unless_isolation_is_on(db, monkeypatch):
    db([_row("AAA")])
    opened = []
    real = cb._ro_query
    monkeypatch.setattr(cb, "_ro_query", lambda *a: (opened.append(1), real(*a))[1])
    monkeypatch.setenv(gw.KINDS_ENV, "quote,news.company")
    assert _read({})["status"] == "refused"
    monkeypatch.setenv(gw.KINDS_ENV, cb.KIND)
    monkeypatch.delenv(gw.ISOLATED_ENV)
    assert _read({}, turn="t2")["status"] == "refused"
    monkeypatch.setenv(gw.ISOLATED_ENV, "1")
    for purpose in ("research", "scan"):
        assert _read({}, turn=f"t-{purpose}", purpose=purpose)["status"] == "refused"
    assert opened == []
    out = _read({}, turn="t3")
    assert out["status"] == "ok" and out["isolated"] is True and out["data"]["rows"][0]["isolated"] is True
    assert out["data"]["rows"][0]["headlines"][0]["isolated"] is True and opened == [1]


def test_registered_model_isolated_periodic_with_the_symbol_bound():
    k = gw.registry().get(cb.KIND)
    assert k.model_isolated is True and k.freshness == "periodic" and k.max_symbols == cb.MAX_SYMBOLS == gw.MAX_SYMBOLS_PER_READ


# ── ACCESS: the Agent's real doors give anonymous, unpaid and non-admin callers nothing ────────────────────────────
ASK = "what's moving the market today?"


def _app(user=None):
    from api.middleware.auth_middleware import get_current_user_with_plan
    from api.routers import uct_agent as rx
    app = FastAPI()
    app.include_router(rx.router)
    if user is not None:                       # identity only; the paid / admin gates stay the real dependencies
        app.dependency_overrides[get_current_user_with_plan] = lambda: user
    return TestClient(app)


@pytest.fixture()
def spied(db, monkeypatch):
    db([_row("AAA")])
    opened = []
    real = cb._ro_query
    monkeypatch.setattr(cb, "_ro_query", lambda *a: (opened.append(1), real(*a))[1])
    return opened


@pytest.mark.parametrize("user,code", [(None, 401), ({"id": "u-free", "plan": "free", "role": "user"}, 402),
                                       ({"id": "u-paid", "plan": "pro", "role": "user"}, 403)])
def test_anonymous_free_and_paid_non_admin_get_nothing_through_any_agent_door(spied, user, code):
    c = _app(user)
    r = c.post("/api/agent/data", json={"kind": cb.KIND, "params": {}, "turn_id": "t-x"})
    assert r.status_code == code and "headline" not in r.text and "rows" not in r.text
    for path in ("/api/agent/turn", "/api/agent/turn/stream", "/api/agent/turn/resume"):
        r = c.post(path, json={"message": ASK, "context": {}, "capabilities": []})
        assert r.status_code == code, path
    assert spied == []                         # the catalyst store was never opened


def test_an_admin_reads_it_through_the_gateway(spied):
    r = _app({"id": "u-admin", "plan": "pro", "role": "admin"}).post(
        "/api/agent/data", json={"kind": cb.KIND, "params": {}, "turn_id": "t-a"})
    assert r.status_code == 200 and r.json()["data"]["rows"][0]["symbol"] == "AAA" and spied == [1]
