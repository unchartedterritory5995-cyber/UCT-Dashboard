"""One RS Rating everywhere (RS split unit U5a, 2026-11-09).

The chart's UCT RS prints the nightly IBD-style rating (``rs_rating_history.ibd``);
the badge, the screener's ``rs_rank`` and the groups gate read the hourly fast rank.
Behind ``RS_RANK_IBD_ENABLED`` the producers hand back the nightly rating as
``rs_rank`` and fall back to the fast rank only for a name without a row.

Every case runs against a ``screener.db`` in ``tmp_path`` (``SCREENER_DB_PATH``),
seeds the hourly cache directly and flips the flag through the environment: no
network, no scheduler, no production path.
"""
from __future__ import annotations

import sqlite3
from contextlib import closing

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import rs_ranking as route
from api.services import groups_gates
from api.services import rs_ranking as svc
from api.services.screener import methodology as M
from api.services.screener import rs_history as rh
from api.services.screener import snapshot_builder as b
from api.services.screener import snapshot_db

FAST = [
    {"ticker": "NVDA", "rs_score": 41.2, "rs_rank": 97, "returns": {"3m": 30.0, "6m": 50.0}},
    {"ticker": "AAPL", "rs_score": 12.5, "rs_rank": 88, "returns": {"3m": 10.0}},
    {"ticker": "ONLYFAST", "rs_score": 3.0, "rs_rank": 55, "returns": {}},
    {"ticker": "INTC", "rs_score": -8.0, "rs_rank": 4, "returns": {}},
]

#: Nightly rows for two sessions: the NEWEST session is the one that must win.
OLDER = {"NVDA": 60, "AAPL": 61, "INTC": 62}
NEWEST = {"NVDA": 94, "AAPL": 71, "INTC": 9, "SPY": 66}


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    path = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    assert snapshot_db.get_db_path() == str(path)
    svc.invalidate_ibd_cache()
    yield path
    svc.invalidate_ibd_cache()


@pytest.fixture
def fast_cache():
    svc._rs_cache.set(svc._CACHE_KEY, [dict(r) for r in FAST], ttl=60)
    yield
    svc._rs_cache.invalidate(svc._CACHE_KEY)


def _rate(by_ticker: dict) -> dict:
    return {t: {"ibd": v, "m1": 1, "m3": 1, "m6": 1, "m9": 1, "m12": 1, "score": 1.0, "bars": 253}
            for t, v in by_ticker.items()}


def _store_two_sessions():
    rh.store_rows("2026-11-05", _rate(OLDER))
    rh.store_rows("2026-11-06", _rate(NEWEST))


def _client(monkeypatch):
    app = FastAPI()
    app.include_router(route.router)
    app.dependency_overrides[route.require_paid] = lambda: {"id": "u1"}
    monkeypatch.setattr(route, "kick_background_warm", lambda: True)
    return TestClient(app)


# ───────────────────────────── flag off ─────────────────────────────────────

def test_flag_is_off_by_default_and_read_per_call(monkeypatch):
    monkeypatch.delenv("RS_RANK_IBD_ENABLED", raising=False)
    assert svc.rs_rank_ibd_enabled() is False
    monkeypatch.setenv("RS_RANK_IBD_ENABLED", "1")
    assert svc.rs_rank_ibd_enabled() is True
    monkeypatch.setenv("RS_RANK_IBD_ENABLED", "true")
    assert svc.rs_rank_ibd_enabled() is False, "only the literal 1 arms it"


def test_flag_off_every_reader_is_the_fast_rank_byte_for_byte(tmp_db, fast_cache, monkeypatch):
    """Even with nightly rows present: the flag, not the table, decides."""
    monkeypatch.delenv("RS_RANK_IBD_ENABLED", raising=False)
    _store_two_sessions()
    fast = svc.fast_rank_map()
    unified = svc.cached_rank_map()
    assert unified == fast
    assert unified["NVDA"] is fast["NVDA"], "the very cache objects, not copies"
    assert unified["NVDA"]["rs_rank"] == 97
    assert "rs_rank_source" not in unified["NVDA"]
    assert "SPY" not in unified, "no nightly-only name is appended when the flag is off"
    rows = svc.cached_rankings()
    assert svc.unified_rankings(rows) is rows
    assert svc.get_rs_for_ticker("aapl") is fast["AAPL"]
    m = groups_gates.swing_metrics(["NOROW"], rs={}, today={})
    assert set(m["NOROW"]) == {"rs_rank", "dollar_vol", "adr_pct", "price"}, "the gate shape is unchanged"


def test_flag_off_the_methodology_describes_the_hourly_weighting(monkeypatch):
    monkeypatch.delenv("RS_RANK_IBD_ENABLED", raising=False)
    how = M.for_column("rs_rank")["how"]
    assert "weighted return" in how and "nightly" not in how.lower()


# ───────────────────────────── flag on ──────────────────────────────────────

def test_flag_on_a_row_in_the_newest_session_replaces_the_fast_rank(tmp_db, fast_cache, monkeypatch):
    monkeypatch.setenv("RS_RANK_IBD_ENABLED", "1")
    _store_two_sessions()
    out = svc.cached_rank_map()
    for sym, rating in (("NVDA", 94), ("AAPL", 71), ("INTC", 9)):
        e = out[sym]
        assert e["rs_rank"] == rating, "the NEWEST session, not the older one"
        assert e["rs_rank_source"] == "ibd"
        assert e["rs_rank_asof"] == "2026-11-06"
    assert out["NVDA"]["rs_rank_fast"] == 97, "the hourly value is kept, never removed"
    assert out["NVDA"]["rs_score"] == 41.2 and out["NVDA"]["returns"] == {"3m": 30.0, "6m": 50.0}
    # The cache's own objects are never mutated: a flag flip back is a clean rollback.
    assert svc.fast_rank_map()["NVDA"]["rs_rank"] == 97
    assert "rs_rank_source" not in svc.fast_rank_map()["NVDA"]


def test_flag_on_a_name_without_a_row_keeps_the_fast_rank_and_says_so(tmp_db, fast_cache, monkeypatch):
    monkeypatch.setenv("RS_RANK_IBD_ENABLED", "1")
    _store_two_sessions()
    e = svc.cached_rank_map()["ONLYFAST"]
    assert e["rs_rank"] == 55
    assert e["rs_rank_source"] == "fast"
    assert "rs_rank_asof" not in e and "rs_rank_fast" not in e


def test_flag_on_a_nightly_only_name_is_served_so_the_badge_matches_the_chart(tmp_db, fast_cache, monkeypatch):
    """SPY is rated by interpolation in the nightly and absent from the hourly list;
    the chart shows its rating, so the badge must too."""
    monkeypatch.setenv("RS_RANK_IBD_ENABLED", "1")
    _store_two_sessions()
    e = svc.get_rs_for_ticker("SPY")
    assert e == {"ticker": "SPY", "rs_score": None, "rs_rank": 66, "returns": {},
                 "rs_rank_source": "ibd", "rs_rank_asof": "2026-11-06"}


def test_flag_on_a_null_rating_falls_back_like_a_missing_row(tmp_db, fast_cache, monkeypatch):
    monkeypatch.setenv("RS_RANK_IBD_ENABLED", "1")
    ratings = _rate(NEWEST)
    ratings["AAPL"]["ibd"] = None                      # rated short: a row, no number
    rh.store_rows("2026-11-06", ratings)
    e = svc.cached_rank_map()["AAPL"]
    assert e["rs_rank"] == 88 and e["rs_rank_source"] == "fast"


def test_flag_on_without_a_table_falls_back_creates_nothing_and_never_raises(tmp_db, fast_cache, monkeypatch):
    monkeypatch.setenv("RS_RANK_IBD_ENABLED", "1")
    out = svc.cached_rank_map()
    assert out["NVDA"]["rs_rank"] == 97 and out["NVDA"]["rs_rank_source"] == "fast"
    assert svc.get_rs_for_ticker("NVDA")["rs_rank"] == 97
    with closing(sqlite3.connect(str(tmp_db))) as conn:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert rh.TABLE not in tables, "a read never creates the rating table"


def test_flag_on_a_failed_read_is_the_fast_rank_not_an_exception(tmp_db, fast_cache, monkeypatch):
    monkeypatch.setenv("RS_RANK_IBD_ENABLED", "1")

    def boom():
        raise RuntimeError("disk gone")
    monkeypatch.setattr(rh, "newest_ibd_ratings", boom)
    assert svc.cached_rank_map()["NVDA"]["rs_rank"] == 97
    assert svc.unified_rankings(svc.cached_rankings())[0]["rs_rank_source"] == "fast"


def test_flag_on_the_list_is_overlaid_and_sorted_best_first(tmp_db, fast_cache, monkeypatch):
    monkeypatch.setenv("RS_RANK_IBD_ENABLED", "1")
    _store_two_sessions()
    rows = svc.unified_rankings(svc.cached_rankings())
    # F3 (2026-11-10): SPY, nightly-only, is no longer in the LIST (it was a blank
    # row in the RS leaders panel); the single-ticker lookup below still serves it.
    assert [r["ticker"] for r in rows] == ["NVDA", "AAPL", "ONLYFAST", "INTC"]
    assert [r["rs_rank"] for r in rows] == [94, 71, 55, 9]
    assert svc.cached_rankings()[0]["rs_rank"] == 97, "the cached list itself is untouched"


def test_flag_on_the_list_holds_hourly_names_only_and_the_map_still_holds_the_rest(tmp_db, fast_cache, monkeypatch):
    """A nightly-only name (an ETF) has no score and no returns: a blank row in the
    RS leaders panel. The list leaves it out; the badge's by-symbol map keeps it,
    so the chart and the badge still agree on it (F3, 2026-11-10)."""
    monkeypatch.setenv("RS_RANK_IBD_ENABLED", "1")
    _store_two_sessions()
    rows = svc.unified_rankings(svc.cached_rankings())
    assert all(r["rs_score"] is not None for r in rows), "no blank row in the list"
    assert {r["ticker"] for r in rows} == {r["ticker"] for r in FAST}
    assert "SPY" in svc.cached_rank_map()
    assert svc.get_rs_for_ticker("SPY")["rs_rank"] == 66


def test_the_nightly_read_is_memoised_and_invalidation_re_reads(tmp_db, fast_cache, monkeypatch):
    monkeypatch.setenv("RS_RANK_IBD_ENABLED", "1")
    _store_two_sessions()
    calls = []
    real = rh.newest_ibd_ratings

    def counted():
        calls.append(1)
        return real()
    monkeypatch.setattr(rh, "newest_ibd_ratings", counted)
    svc.cached_rank_map()
    svc.cached_rank_map()
    svc.get_rs_for_ticker("NVDA")
    assert calls == [1], "one table read per TTL, not one per badge request"
    svc.invalidate_ibd_cache()
    svc.cached_rank_map()
    assert calls == [1, 1]


def test_a_cold_hourly_cache_still_answers_empty_under_the_flag(tmp_db, monkeypatch):
    """The build's compute-on-cold path keys on `{}` meaning cold; the nightly
    table must not make a cold cache look warm."""
    monkeypatch.setenv("RS_RANK_IBD_ENABLED", "1")
    _store_two_sessions()
    svc._rs_cache.invalidate(svc._CACHE_KEY)
    assert svc.cached_rank_map() == {}
    assert svc.get_rs_for_ticker("NVDA") is None


# ───────────────────── the three producers agree ────────────────────────────

def test_the_badge_the_screener_column_and_the_groups_gate_print_one_number(tmp_db, fast_cache, monkeypatch):
    monkeypatch.setenv("RS_RANK_IBD_ENABLED", "1")
    _store_two_sessions()
    rs_map = svc.cached_rank_map()
    # the badge route
    client = _client(monkeypatch)
    badge = client.get("/api/rs-rankings/NVDA").json()
    assert badge["rs_rank"] == 94 and badge["rs_rank_source"] == "ibd" and badge["rs_rank_asof"] == "2026-11-06"
    assert badge["rs_rank_fast"] == 97
    # the screener column (the builder's one mapping from the authority's entry)
    col = b.rs_fields(rs_map["NVDA"])
    assert col["rs_rank"] == 94 and col["rs_return"] == 41.2
    assert set(col) == {"rs_rank", "rs_return", "chg_pct_3m", "chg_pct_6m"}, "the row shape is unchanged"
    # the groups gate
    monkeypatch.setattr(groups_gates.snapshot_db, "get_rows", lambda tks: {})
    groups_gates._ROWS_CACHE.clear()
    gate = groups_gates.swing_metrics(["NVDA", "ONLYFAST"], rs_map, {})
    assert gate["NVDA"]["rs_rank"] == 94 and gate["NVDA"]["rs_rank_source"] == "ibd"
    assert gate["ONLYFAST"]["rs_rank"] == 55 and gate["ONLYFAST"]["rs_rank_source"] == "fast"
    # and the list the RS leaders panel reads (F3: without the nightly-only SPY,
    # which the badge route above still answers by symbol)
    listed = {r["ticker"]: r["rs_rank"] for r in client.get("/api/rs-rankings").json()}
    assert listed["NVDA"] == 94 and listed["ONLYFAST"] == 55 and "SPY" not in listed
    assert client.get("/api/rs-rankings/SPY").json()["rs_rank"] == 66


def test_the_badge_route_still_never_computes(tmp_db, monkeypatch):
    monkeypatch.setenv("RS_RANK_IBD_ENABLED", "1")
    _store_two_sessions()
    svc._rs_cache.invalidate(svc._CACHE_KEY)
    calls = []
    monkeypatch.setattr(svc, "_get_universe", lambda: calls.append(1) or [])
    assert _client(monkeypatch).get("/api/rs-rankings/NVDA").status_code == 404
    assert calls == []


def test_the_rating_table_never_stores_its_own_rating_as_fast(tmp_db, fast_cache, monkeypatch):
    """The nightly's `fast` column records the OTHER formula; under the flag the
    unified map would hand it its own number back."""
    monkeypatch.setenv("RS_RANK_IBD_ENABLED", "1")
    _store_two_sessions()
    fast_map = rh.default_fast_map()
    assert rh._fast_for(fast_map, "NVDA") == 97
    assert rh._fast_for(svc.cached_rank_map(), "NVDA") == 97, "even a unified entry yields the hourly value"


def test_flag_on_the_methodology_says_which_rating_and_that_it_is_nightly(tmp_db, monkeypatch):
    monkeypatch.setenv("RS_RANK_IBD_ENABLED", "1")
    m = M.for_column("rs_rank")
    assert "IBD-style" in m["one_line"] and "RS Rating" in m["one_line"]
    assert "once a night" in m["how"] and "04:15 ET" in m["how"]
    assert "40% of the close over the close 63 sessions earlier" in m["how"]
    assert "hourly" in m["how"], "the fallback is stated"
    assert m["caveat"]
