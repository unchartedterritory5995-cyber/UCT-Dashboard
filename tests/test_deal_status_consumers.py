"""Deal status in every consumer that PICKS names to show (DEAL_STATUS_ENABLED).

For each consumer: with the flag ON a pending acquisition (ZZZ) is left out (or, for a grade,
answered with "Pending acquisition" instead of a letter) and every other name is untouched;
with the flag OFF the output is identical to flag-ON-with-nothing-pending AND the pending set
is never consulted (`pending_deal_symbols` raises if called). Synthetic symbols only; no
network, no bars.db, nothing under C:/data.
"""
from __future__ import annotations

import json
import logging

import pytest

from api.services import deal_status

PEND = frozenset({"ZZZ"})
CONSULTED: list = []   # every call made to the pending set while the flag is off


def _boom(*a, **k):
    CONSULTED.append(1)
    raise AssertionError("pending set consulted with DEAL_STATUS_ENABLED off")


@pytest.fixture
def deal(monkeypatch):
    """deal("off") | deal("on") | deal("on_empty") | deal("on", {"X"})."""
    deal_status.reset_cache()

    def set_(state, pend=PEND):
        if state == "off":
            CONSULTED.clear()
            monkeypatch.delenv("DEAL_STATUS_ENABLED", raising=False)
            monkeypatch.setattr(deal_status, "pending_deal_symbols", _boom)
        else:
            monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
            got = frozenset(pend) if state == "on" else frozenset()
            monkeypatch.setattr(deal_status, "pending_deal_symbols", lambda: got)
    return set_


class _NoCache:
    def get(self, *a, **k):
        return None

    def set(self, *a, **k):
        return None


def _three_ways(deal, run):
    """(off, on_empty, on) outputs of `run()`."""
    deal("off")
    off = run()
    assert CONSULTED == [], "the pending set was consulted with the flag off"
    deal("on_empty")
    empty = run()
    deal("on")
    on = run()
    return off, empty, on


# ── the shared helper ────────────────────────────────────────────────────────

def test_consumer_pending_is_empty_and_unconsulted_with_the_flag_off(deal):
    deal("off")
    assert deal_status.consumer_pending() == frozenset()
    assert deal_status.is_pending("ZZZ") is False
    assert CONSULTED == []


def test_consumer_pending_normalises_class_shares(deal):
    deal("on", {"BRK.B"})
    assert deal_status.is_pending("BRK-B") and deal_status.is_pending("brk.b")
    assert not deal_status.is_pending("BRK-A")


def test_an_error_in_the_pending_set_excludes_nothing(deal, monkeypatch):
    deal("on")
    def broken():
        raise RuntimeError("store exploded")
    monkeypatch.setattr(deal_status, "pending_deal_symbols", broken)
    assert deal_status.consumer_pending() == frozenset()
    assert deal_status.is_pending("ZZZ") is False


@pytest.mark.parametrize("title,want", [
    ("ZZZ to be acquired by Bigco for $12.50 per share in cash", True),
    ("ZZZ explores sale after takeover interest", False),
    ("Bigco in talks to acquire ZZZ", False),
    ("ZZZ agrees to acquire Smallco for $3 per share", False),   # ZZZ is the ACQUIRER
])
def test_definitive_target_reads_only_an_agreed_buyout_of_the_ticker(title, want):
    assert deal_status.definitive_target("ZZZ", title) is want


# ── pattern scan universe + pattern_vision candidates (api/main.py) ─────────

def test_pattern_scan_skips_a_pending_name_inside_the_loop(deal, monkeypatch):
    import api.main as m
    from api.services import bars_sqlite
    fetched = []
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda s, tf, n: fetched.append(s) or [])
    progress = []

    def run():
        fetched.clear()
        progress.clear()
        m._scan_patterns_daily(["AAA", "ZZZ", "BBB"], set(), logging.getLogger("t"),
                               on_progress=lambda i, last: progress.append(i))
        return list(fetched), list(progress)

    off, empty, on = _three_ways(deal, run)
    assert off == empty == (["AAA", "ZZZ", "BBB"], [0, 1, 2])
    # skipped, but the checkpoint still advances over the SAME list (resume offsets hold)
    assert on == (["AAA", "BBB"], [0, 1, 2])


def test_pattern_vision_active_set_drops_a_pending_name_and_names_it(deal, monkeypatch):
    import api.main as m
    from api.services import bars_sqlite
    monkeypatch.setattr(bars_sqlite, "nth_recent_trading_date",
                        lambda *a: (_ for _ in ()).throw(RuntimeError("no store")))
    deal("off")
    d_off: dict = {}
    off = m._resolve_active_set_for_patterns(diagnostics=d_off)
    assert len(off) >= 2
    victim = off[1]
    deal("on_empty")
    d_empty: dict = {}
    assert m._resolve_active_set_for_patterns(diagnostics=d_empty) == off and d_empty == d_off
    deal("on", {victim})
    d_on: dict = {}
    on = m._resolve_active_set_for_patterns(diagnostics=d_on)
    assert on == [s for s in off if s != victim]
    assert d_on["dropped_pending_deal"] == [victim]
    assert "dropped_pending_deal" not in d_off


# ── live scans ───────────────────────────────────────────────────────────────

def _snap():
    return {s: {"last_price": 20.0, "prev_close": 10.0, "today_vol": 5000, "prev_vol": 10}
            for s in ("AAA", "ZZZ", "BBB")}


def test_highest_volume_scan_excludes_a_pending_name(deal, monkeypatch):
    from api.services import scan_volume as sv
    monkeypatch.setattr(sv, "cache", _NoCache())
    monkeypatch.setattr(sv, "_ensure_reference", lambda *a: {"AAA": 100, "ZZZ": 100, "BBB": 100})
    monkeypatch.setattr(sv, "full_market_snapshot", _snap)
    monkeypatch.setattr(sv, "_avg_dollar_volume", lambda: {})
    monkeypatch.setattr(sv, "_tradable", lambda *a: True)

    def run():
        out = sv._run_scan("1y", 252)
        return [r["sym"] for r in out["results"]], out["coverage"]

    off, empty, on = _three_ways(deal, run)
    assert off == empty and sorted(off[0]) == ["AAA", "BBB", "ZZZ"]
    assert sorted(on[0]) == ["AAA", "BBB"] and on[1] == off[1]


def test_top_gainers_scan_excludes_a_pending_name(deal, monkeypatch):
    from api.services import scan_gainers as sg
    monkeypatch.setattr(sg, "cache", _NoCache())
    monkeypatch.setattr(sg, "_ensure_reference", lambda *a: {"AAA": 10.0, "ZZZ": 10.0, "BBB": 10.0})
    monkeypatch.setattr(sg, "full_market_snapshot", _snap)
    monkeypatch.setattr(sg, "_TOP_FRACTION", 1.0)

    def run():
        return sorted(r["sym"] for r in sg._run_gainers("30d", 30)["results"])

    off, empty, on = _three_ways(deal, run)
    assert off == empty == ["AAA", "BBB", "ZZZ"]
    assert on == ["AAA", "BBB"]


def test_recent_ipo_scan_excludes_a_pending_name(deal, monkeypatch):
    from api.services import scan_ipo as si
    monkeypatch.setattr(si, "cache", _NoCache())
    monkeypatch.setattr(si, "_ensure_ipo_set",
                        lambda: {"AAA": 20260101, "ZZZ": 20260102, "BBB": 20260103})
    monkeypatch.setattr(si, "full_market_snapshot", _snap)
    monkeypatch.setattr(si, "_etf_symbols", lambda: set())
    monkeypatch.setattr(si, "_avg_dollar_volume", lambda: {})
    monkeypatch.setattr(si, "_tradable", lambda *a: True)

    def run():
        return [r["sym"] for r in si.get_ipo_last_1y()["results"]]

    off, empty, on = _three_ways(deal, run)
    assert off == empty == ["BBB", "ZZZ", "AAA"]
    assert on == ["BBB", "AAA"]


# ── RS leaders (displayed list only; ranks unchanged) ───────────────────────

def test_rs_rankings_hide_a_pending_name_and_keep_every_other_rank(deal, monkeypatch):
    from api.routers import rs_ranking as r
    rows = [{"ticker": "ZZZ", "rs_rank": 99}, {"ticker": "AAA", "rs_rank": 50},
            {"ticker": "BBB", "rs_rank": 1}]
    monkeypatch.setattr(r, "cached_rankings", lambda: [dict(x) for x in rows])

    def run():
        return json.loads(r.rs_rankings(_user={}).body)

    off, empty, on = _three_ways(deal, run)
    assert off == empty == rows
    assert on == rows[1:]


# ── UCT20 leadership read ────────────────────────────────────────────────────

def test_uct20_leadership_read_drops_a_pending_name(deal, monkeypatch):
    from api.services import engine
    rows = [{"ticker": "AAA"}, {"sym": "ZZZ"}, {"ticker": "BBB"}]
    monkeypatch.setattr(engine, "_leadership_as_pushed", lambda: list(rows))
    off, empty, on = _three_ways(deal, engine.get_leadership)
    assert off == empty == rows
    assert on == [rows[0], rows[2]]


# ── theme/industry leaders & peers (groups) ─────────────────────────────────

def test_theme_leaders_never_fill_a_cell_with_a_pending_name(deal, monkeypatch):
    from api.services import groups, groups_gates
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"AAA", "ZZZ", "BBB"})
    monkeypatch.setattr(groups, "_today_map", lambda syms: {})
    monkeypatch.setattr(groups, "_rs_map", lambda: {})
    monkeypatch.setattr(groups_gates, "gates_enabled", lambda: False)
    holdings = [{"sym": s, "tier": "core"} for s in ("ZZZ", "AAA", "BBB")]
    off, empty, on = _three_ways(deal, lambda: groups.rank_holdings(holdings))
    assert off == empty == ["ZZZ", "AAA", "BBB"]
    assert on == ["AAA", "BBB"]


def test_ai_peers_never_return_a_pending_name(deal, monkeypatch):
    from api.services import groups, ticker_meta
    monkeypatch.setattr(groups, "cache", _NoCache())
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"AAA", "ZZZ", "BBB"})
    monkeypatch.setattr(ticker_meta, "get_ticker_meta",
                        lambda s: {"name": s, "sector": "Tech", "industry": "Chips"})
    monkeypatch.setattr(groups, "_ai_peer_raw", lambda seed, n, meta: ["ZZZ", "AAA", "BBB"])
    off, empty, on = _three_ways(deal, lambda: groups._ai_peers("SEED", 5))
    assert off == empty == ["ZZZ", "AAA", "BBB"]
    assert on == ["AAA", "BBB"]


# ── live NH/NL and volume leaderboards ──────────────────────────────────────

def test_new_high_leaderboard_drops_a_pending_name_but_not_from_breadth(deal, monkeypatch):
    from api.services import nhnl_live as nh
    syms = {s: {"nh": 3, "nl": 0, "last": 20.0, "hi_ts": "10:00", "lo_ts": None, "prev": 19.0}
            for s in ("AAA", "ZZZ", "BBB")}
    monkeypatch.setitem(nh._state, "syms", syms)
    monkeypatch.setattr(nh, "_etf_set", lambda: set())
    monkeypatch.setattr(nh, "_group_map", lambda: {s: {"sector": "Tech"} for s in syms})

    def run():
        flat = nh.get_live()
        grouped = nh.get_live(group="sector")
        return (sorted(r["sym"] for r in flat["highs"]), flat["highs_total"],
                grouped["highs"], grouped["categories"])

    off, empty, on = _three_ways(deal, run)
    assert off == empty and off[0] == ["AAA", "BBB", "ZZZ"]
    assert on[0] == ["AAA", "BBB"] and on[1] == 2
    assert on[2] == off[2] and on[3] == off[3]       # group breadth untouched
    # a member's own scope is shown as-is
    deal("on")
    assert "ZZZ" in {r["sym"] for r in nh.get_live(restrict={"ZZZ", "AAA"})["highs"]}


def test_volume_leaderboard_drops_a_pending_name_from_the_default_board(deal, monkeypatch):
    from api.services import volume_live as vl
    m = {"price": 20.0, "pct": 1.0, "rvol": 3.0, "move": 1.0, "held": True}
    monkeypatch.setitem(vl._state, "syms", {s: {"m": dict(m), "prev_vol": 1e6}
                                            for s in ("AAA", "ZZZ", "BBB")})
    monkeypatch.setattr(vl, "_tradable_floor", lambda *a: True)
    monkeypatch.setattr(vl, "_signal", lambda m: False)
    monkeypatch.setattr(vl, "_eff", lambda m: 1.0)
    monkeypatch.setattr(vl, "_tier", lambda m: 1)
    monkeypatch.setattr(vl, "register_custom_syms", lambda s: None)

    def run():
        return sorted(r["sym"] for r in vl.get_live(show_all=True)["rows"])

    off, empty, on = _three_ways(deal, run)
    assert off == empty == ["AAA", "BBB", "ZZZ"]
    assert on == ["AAA", "BBB"]
    deal("on")
    assert "ZZZ" in {r["sym"] for r in vl.get_live(syms=["ZZZ"], show_all=True)["rows"]}


# ── earnings wire detector ───────────────────────────────────────────────────

def test_wire_detector_writes_no_row_for_a_pending_reporter(deal, monkeypatch):
    from api.services.wire import detector
    seen = []
    monkeypatch.setattr(detector, "todays_reporters",
                        lambda md: [{"sym": s, "timing": "bmo"} for s in ("AAA", "ZZZ")])
    monkeypatch.setattr(detector, "_market_snapshot", lambda: {})
    monkeypatch.setattr(detector.store, "get_prints", lambda md: [])
    monkeypatch.setattr(detector.store, "upsert_print", lambda row: None)
    monkeypatch.setattr(detector.detect, "detect_rows",
                        lambda reps, *a: seen.append([r["sym"] for r in reps]) or [])

    def run():
        seen.clear()
        res = detector.run_wire_tick(now_ts=0)
        return seen[-1], res["scanned"]

    off, empty, on = _three_ways(deal, run)
    assert off == empty == (["AAA", "ZZZ"], 2)
    assert on == (["AAA"], 1)


# ── catalyst engine ──────────────────────────────────────────────────────────

def test_a_definitive_buyout_earns_no_hunter_bonus_but_a_rumour_does():
    from api.services.catalyst import scoring
    base = {"ticker": "ZZZ", "gap_pct": 0.0, "price": 50.0, "hunter_confirmed": True,
            "catalyst_type": "M&A"}
    plain = dict(base, hunter_confirmed=False)
    assert scoring.score(base) == scoring.score(plain) + 35.0
    assert scoring.score(dict(base, deal_definitive=True)) == scoring.score(plain)
    assert scoring.score(dict(base, deal_definitive=False)) == scoring.score(base)


@pytest.fixture
def cat_store(monkeypatch, tmp_path):
    from api.services.catalyst import store
    monkeypatch.setenv("CATALYST_IGNORE_MARKET_CALENDAR", "1")
    monkeypatch.setattr(store, "_DB_PATH", str(tmp_path / "catalysts.db"))
    store._init_db()
    return store


def _cand(t, **kw):
    c = {"ticker": t, "company": t, "price": 50.0, "gap_pct": 12.0, "vol_x": 4.0,
         "market_cap": 2_000_000_000, "sector": "Tech", "tweets": [], "rss": [],
         "earnings_meta": None, "earnings_reported_recently": False,
         "earnings_just_reported": False, "tweet_mention_count": 0, "rss_headline_count": 0,
         "scanner_setup": None, "sector_momentum_count": 0}
    c.update(kw)
    return c


def test_catalyst_engine_rejects_a_pending_name_at_the_gate(deal, cat_store, monkeypatch):
    from api.services.catalyst import engine, filters, scoring, synthesize, sources
    scored = []
    real_score = scoring.score
    monkeypatch.setattr(filters, "quality_gate", lambda c: (True, None))
    monkeypatch.setattr(filters, "is_real_catalyst", lambda c: (True, None))
    monkeypatch.setattr(scoring, "score", lambda c: scored.append(dict(c)) or real_score(c))
    thesis = {"thesis_text": "t", "thesis_model": "m", "thesis_at": 1000, "thesis_sources": "[]",
              "signals_hash": "h", "was_cached": False, "input_tokens": 1, "output_tokens": 1}
    monkeypatch.setattr(synthesize, "synthesize_ticker", lambda *a, **k: dict(thesis))
    monkeypatch.setattr(sources, "collect_all",
                        lambda **k: [_cand("AAA"), _cand("ZZZ"),
                                     _cand("YYY", hunter_confirmed=True, catalyst_type="M&A",
                                           hunter_headline="YYY to be acquired by Bigco for "
                                                           "$60 per share")])

    def run():
        scored.clear()
        engine._EXCLUDED_BY_DATE.clear()
        engine.run_refresh()
        md = engine._today_market_date()
        return ({c["ticker"]: c.get("deal_definitive") for c in scored},
                dict(engine._EXCLUDED_BY_DATE.get(md, {})))

    off, empty, on = _three_ways(deal, run)
    assert off[0] == {"AAA": None, "ZZZ": None, "YYY": None} and off[1] == {}
    # flag on: same-day definitive headline is marked (no bonus); nothing else changes
    assert empty[0] == {"AAA": None, "ZZZ": None, "YYY": True} and empty[1] == {}
    assert on[0] == {"AAA": None, "YYY": True}
    assert on[1] == {"ZZZ": "pending acquisition"}


# ── grades ───────────────────────────────────────────────────────────────────

def _grade(sym):
    from api.services.grade_ticker import grade_ticker
    det = [{"pattern_name": "VCP", "confidence": 90,
            "levels": {"entry": 10.0, "stop": 9.5, "target_primary": 12.0}}]
    return grade_ticker(sym, 100000, regime_fn=lambda: {"regime": "GREEN"},
                        quote_fn=lambda s: {"last": 10.0}, patterns_fn=lambda s: det,
                        playbook_fn=lambda s: {}, size_fn=lambda *a: {"ok": False},
                        archive_fn=lambda *a: None)


def test_grade_ticker_says_pending_acquisition_instead_of_a_grade(deal):
    off, empty, on = _three_ways(deal, lambda: _grade("ZZZ"))
    assert off == empty and off["setup"] == "VCP"
    assert on["verdict"] == "SKIP" and on["grade"] is None and on["setup"] is None
    assert on["hard_flags"] == ["pending_acquisition"]
    assert on["basis"].startswith(deal_status.PENDING_LABEL)
    deal("on")
    assert _grade("AAA")["setup"] == "VCP"


def test_setup_grade_returns_the_pending_label_not_a_letter(deal, monkeypatch):
    from api.services import setup_grade as sg
    monkeypatch.setattr(sg, "gather_inputs", lambda sym, live_move=None: {})
    monkeypatch.setattr(sg, "compute_grade", lambda scored: {"letter": "A", "score": 90.0})
    monkeypatch.setattr(sg, "_GRADE_CACHE", _NoCache())
    monkeypatch.setattr(sg._GRADE_STALE, "serve", lambda key, fresh, build, good: build())
    off, empty, on = _three_ways(deal, lambda: sg.get_setup_grade("ZZZ"))
    assert off == empty == {"letter": "A", "score": 90.0}
    assert on["pending_acquisition"] is True and on["letter"] is None
    assert on["label"] == deal_status.PENDING_LABEL


def test_the_daily_grade_snapshot_records_no_grade_for_a_pending_name(deal, monkeypatch):
    from api.services import setup_grade as sg
    recorded = []
    monkeypatch.setattr(sg.implied_store, "upcoming_reporters",
                        lambda days, now: [{"sym": "ZZZ", "report_date": "2026-10-30"},
                                           {"sym": "AAA", "report_date": "2026-10-30"}])
    monkeypatch.setattr(sg.implied_move, "get_expected_move", lambda *a: None)
    monkeypatch.setattr(sg.implied_store, "record_grade", lambda **k: recorded.append(k["sym"]))
    monkeypatch.setattr(sg, "gather_inputs", lambda sym, live_move=None: {})
    monkeypatch.setattr(sg, "compute_grade", lambda scored: {"letter": "A", "inputs": []})
    monkeypatch.setattr(sg, "_GRADE_CACHE", _NoCache())
    monkeypatch.setattr(sg._GRADE_STALE, "serve", lambda key, fresh, build, good: build())

    def run():
        recorded.clear()
        return sg.run_daily_grade_snapshot(), list(recorded)

    off, empty, on = _three_ways(deal, run)
    assert off == empty and off[1] == ["ZZZ", "AAA"]
    assert on[1] == ["AAA"] and on[0]["skipped"] == 1


# ── theme engine admission (orphans + improve share one gate) ───────────────

def test_theme_engine_never_admits_a_pending_name(deal, monkeypatch):
    from api.services.theme_engine import orphans
    monkeypatch.setattr(orphans, "_is_liquid", lambda s: False)
    monkeypatch.setattr(orphans, "_theme_roster", lambda t: set())
    monkeypatch.setattr(orphans, "_industry_cohort", lambda s: set())
    monkeypatch.setattr(orphans, "_industry_matches_theme", lambda s, t: True)
    monkeypatch.setattr(orphans, "_theme_exists", lambda t: True)
    monkeypatch.setattr(orphans, "_in_cap", lambda s: True)

    def run():
        return [orphans.passes_add_gate(s, "ai", 0.9) for s in ("AAA", "ZZZ")]

    off, empty, on = _three_ways(deal, run)
    assert off == empty == [True, True]
    assert on == [True, False]


# ── server-to-server feed for the PC pipelines ──────────────────────────────

def test_pending_deals_internal_needs_the_push_secret_and_serves_the_set(deal, monkeypatch):
    from fastapi import HTTPException
    from api.routers import catalysts as r
    monkeypatch.setenv("PUSH_SECRET", "s3")
    monkeypatch.setattr(r, "_today", lambda: "2026-10-23")
    with pytest.raises(HTTPException):
        r.pending_deals_internal(authorization="Bearer nope")
    deal("off")
    assert r.pending_deals_internal(authorization="Bearer s3") == {
        "enabled": False, "symbols": [], "as_of": "2026-10-23"}
    deal("on", {"ZZZ", "BRK.B"})
    assert r.pending_deals_internal(authorization="Bearer s3")["symbols"] == ["BRK-B", "ZZZ"]
