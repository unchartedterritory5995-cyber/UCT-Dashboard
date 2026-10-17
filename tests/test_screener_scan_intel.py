"""Scanner intelligence, 2026-10-15: the starters, presets and live-only flag the Focus
screen relies on, each asserted by RUNNING it over a small snapshot rather than by
reading its literals back.

Calibration (what the numbers in saved_screens.py / filters.py were measured on) is
production, read-only, as the synthetic admin account; the counts are recorded beside
each definition. These tests pin behaviour, not counts.
"""
import pytest

from api.services.screener import filters as F
from api.services.screener import logic
from api.services.screener import query as Q
from api.services.screener import saved_screens as SS
from api.services.screener import snapshot_db as db

DATE = "2026-10-14"


def _row(t, **kw):
    return {"ticker": t, "snapshot_date": DATE, "price": 50.0, **kw}


@pytest.fixture
def snap(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    monkeypatch.setenv(logic.FLAG, "1")
    db.init_db()
    return tmp_path


def _tickers(spec):
    return sorted(r["ticker"] for r in Q.run_scan({**spec, "page_size": 500})["rows"])


def _by_id(i):
    return next(s for s in SS.starters() if s["id"] == i)


# ── 1. stocks only = exclude funds, and an UNKNOWN type is not a fund ─────────

def test_the_stocks_only_clause_excludes_funds_and_keeps_an_unknown_type(snap):
    db.upsert_rows([_row("STK", security_type="Stock"), _row("ADR1", security_type="ADR"),
                    _row("FUND", security_type="ETF"), _row("UNK", security_type=None)])
    spec = {"filters": [dict(SS.STOCKS_ONLY)]}
    assert _tickers(spec) == ["ADR1", "STK", "UNK"]
    # the include form this replaced dropped the unknown row: the defect, reproduced
    old = {"filters": [{"key": "security_type", "op": "in", "values": ["Stock", "ADR"]}]}
    assert _tickers(old) == ["ADR1", "STK"]


def test_every_starter_carries_the_exclude_form():
    for s in SS.starters():
        st = [f for f in s["spec"]["filters"] if f["key"] == "security_type"]
        assert st == [{"key": "security_type", "op": "not_in", "values": ["ETF"]}], s["id"]


# ── 2. live volume in the session, last session's volume otherwise ──────────

def test_live_or_nightly_volume_reads_today_when_today_exists(snap):
    db.upsert_rows([
        _row("LIVE_HEAVY", rvol_live=3.5, vol_ratio=0.4),   # today heavy, yesterday light
        _row("LIVE_LIGHT", rvol_live=0.6, vol_ratio=5.0),   # today light, yesterday heavy
        _row("NIGHT_HEAVY", rvol_live=None, vol_ratio=4.0),  # no live value: nightly decides
        _row("NIGHT_LIGHT", rvol_live=None, vol_ratio=1.0),
    ])
    spec = {"filters": [], "logic": SS._live_volume_or_nightly(3)}
    # ⛔ LIVE_LIGHT is the defect: yesterday's volume must not vouch for today's.
    assert _tickers(spec) == ["LIVE_HEAVY", "NIGHT_HEAVY"]


@pytest.mark.parametrize("sid,floor", [("starter_gap_movers", 3), ("starter_52w_breakout", 1.5)])
def test_the_live_event_starters_use_the_live_or_nightly_group(sid, floor):
    spec = _by_id(sid)["spec"]
    assert spec["logic"] == SS._live_volume_or_nightly(floor)
    assert not [f for f in spec["filters"] if f["key"] in ("vol_ratio", "rvol_live")], (
        "a flat volume clause beside the group would AND last night's volume back in")
    logic.validate(spec["logic"])


# ── 3. every starter runs, logic groups included ────────────────────────────

def test_every_starter_runs_on_a_snapshot_and_its_count_matches_its_rows(snap):
    db.upsert_rows([_row("AAA", security_type="Stock", rs_rank=95, adr_pct=5.0, adr_pct_1w=3.0,
                         dollar_vol_30d=6e7, ma_stack="full-bull", dist_52w_high_pct=-2.0,
                         dist_52w_low_pct=80.0, above_50sma=1, ema20_rising=1, pct_vs_ema20=-1.0,
                         close_cv_pct=1.0, rvol_live=2.5, chg_from_open_pct=1.0,
                         dist_20d_high_pct=-1.0, gap_pct=9.0, vol_ratio=3.5,
                         market_cap=5e9, new_52w_high=1)])
    seen = 0
    for s in SS.starters():
        if s["id"].startswith("starter_pattern_"):
            continue
        spec = s["spec"]
        n = Q.preview_count(spec)["count"]
        rows = Q.run_scan({**spec, "page_size": 500})["rows"]
        top = (spec.get("rank") or {}).get("top_n")
        assert (min(n, top) if top else n) == len(rows), s["id"]
        seen += 1
    assert seen >= 15


def test_the_new_live_starters_match_the_row_they_describe(snap):
    db.upsert_rows([
        _row("HIT", security_type="Stock", rvol_live=2.5, chg_from_open_pct=1.0, above_50sma=1,
             dollar_vol_30d=3e7, gap_pct=4.0, dist_20d_high_pct=-1.0),
        _row("NOLIVE", security_type="Stock", rvol_live=None, vol_ratio=9.0, chg_from_open_pct=1.0,
             above_50sma=1, dollar_vol_30d=3e7, gap_pct=4.0, dist_20d_high_pct=-1.0),
        # live volume present and LOW: yesterday's heavy volume must not vouch for today
        _row("LIVELOW", security_type="Stock", rvol_live=1.0, vol_ratio=9.0, chg_from_open_pct=1.0,
             above_50sma=1, dollar_vol_30d=3e7, gap_pct=4.0, dist_20d_high_pct=-1.0),
    ])
    for sid in ("starter_volume_surge_now", "starter_gap_up_volume", "starter_near_20d_high_volume"):
        # 2026-10-17: after hours and on weekends (no rvol_live) they read the LAST
        # SESSION'S full-day volume, so they still answer when members scan; in the
        # session a live value always decides.
        assert _tickers(_by_id(sid)["spec"]) == ["HIT", "NOLIVE"], sid


def test_volume_by_now_sorts_on_last_sessions_volume_when_blank(snap):
    """Off-hours rvol_live is blank everywhere; ticker order is not an answer."""
    db.upsert_rows([_row("AAA", rvol_live=None, vol_ratio=2.0), _row("BBB", rvol_live=None, vol_ratio=5.0),
                    _row("CCC", rvol_live=None, vol_ratio=3.0)])
    rows = Q.run_scan({"filters": [], "sort": {"key": "rvol_live", "dir": "desc"}, "page_size": 10})["rows"]
    assert [r["ticker"] for r in rows] == ["BBB", "CCC", "AAA"]


def test_CONTROL_a_live_value_still_wins_the_sort(snap):
    db.upsert_rows([_row("AAA", rvol_live=4.0, vol_ratio=1.0), _row("BBB", rvol_live=1.0, vol_ratio=9.0)])
    rows = Q.run_scan({"filters": [], "sort": {"key": "rvol_live", "dir": "desc"}, "page_size": 10})["rows"]
    assert [r["ticker"] for r in rows] == ["AAA", "BBB"]


def test_gapping_up_on_volume_starts_at_a_2_pct_gap(snap):
    """Recalibrated 2026-10-16 (6 matches at 3% in two in-session readings, 14 at 2%)."""
    common = dict(security_type="Stock", rvol_live=2.0, dollar_vol_30d=3e7, price=20.0)
    db.upsert_rows([_row("GAP2", gap_pct=2.0, **common), _row("GAP19", gap_pct=1.9, **common)])
    assert _tickers(_by_id("starter_gap_up_volume")["spec"]) == ["GAP2"]


def test_the_tight_base_compares_this_weeks_range_to_the_monthly_one(snap):
    common = dict(security_type="Stock", dist_52w_high_pct=-3.0, close_cv_pct=1.0, above_50sma=1,
                  dollar_vol_30d=3e7, rs_rank=80, adr_pct=4.0)
    db.upsert_rows([_row("CONTRACT", adr_pct_1w=2.0, **common),
                    _row("WIDENING", adr_pct_1w=6.0, **common)])
    assert _tickers(_by_id("starter_tight_base")["spec"]) == ["CONTRACT"]


def test_the_retired_candidates_are_still_populated_so_they_stay():
    """Cheap quality compounders and Earnings Momentum were candidates for retirement
    if their columns were empty. Measured on production 2026-10-15: 386 and 41
    matches, so both stay and neither filters a column known to be empty."""
    ids = {s["id"] for s in SS.starters()}
    assert {"starter_value_quality", "starter_earnings_momentum"} <= ids


# ── 4. presets: measured cuts, published floors ─────────────────────────────

def _preset(key, label):
    return next(p for p in F.FILTERS[key]["presets"] if p["label"] == label)


def test_the_tightened_presets():
    assert _preset("close_cv_pct", "Clustered (<1.2%)") == {"label": "Clustered (<1.2%)", "op": "lt", "max": 1.2}
    assert _preset("close_cv_pct", "Tight band (<2%)") == {"label": "Tight band (<2%)", "op": "lt", "max": 2}
    assert _preset("pullback_depth_pct", "Shallow (<5%)") == {"label": "Shallow (<5%)", "op": "lte", "max": 5}
    assert _preset("pct_vs_ema20", "Within 1%") == {"label": "Within 1%", "op": "between", "min": -1, "max": 1}
    assert _preset("candle_score", "Strong (65+)") == {"label": "Strong (65+)", "op": "gte", "min": 65}
    labels = [p["label"] for p in F.FILTERS["close_cv_pct"]["presets"]]
    assert "Clustered (<2.5%)" not in labels and "Tight band (<4%)" not in labels


def test_the_dollar_volume_floors_are_the_ones_the_starters_publish():
    f = F.FILTERS["dollar_vol_30d"]
    assert [p["label"] for p in f["presets"]] == ["Any", "$10M+", "$20M+", "$50M+"]
    assert [p.get("min") for p in f["presets"][1:]] == [10_000_000, 20_000_000, 50_000_000]
    assert not f.get("presets_deferred"), "a control with presets is not preset-free"
    published = {c["min"] for s in SS.starters() for c in s["spec"]["filters"]
                 if c["key"] == "dollar_vol_30d"}
    assert {10_000_000, 20_000_000, 50_000_000} <= published, (
        "every floor offered as a preset is one a starter already ships")
    for p in f["presets"][1:]:
        assert F.is_valid_op("dollar_vol_30d", p["op"])


def test_a_preset_change_does_not_touch_a_saved_spec(snap):
    """A preset is what a BUTTON selects. A saved screen stores the operator and the
    number, so a screen saved on the old "Clustered (<2.5%)" still runs < 2.5."""
    db.upsert_rows([_row("A", close_cv_pct=2.2), _row("B", close_cv_pct=1.0)])
    saved = {"filters": [{"key": "close_cv_pct", "op": "lt", "max": 2.5}]}
    assert _tickers(saved) == ["A", "B"]


# ── 5. live-only columns are declared on meta, derived from the snapshot ────

def test_meta_marks_live_only_columns_from_the_snapshots_own_declaration(snap):
    out = F._build_shared_filters({"columns": {}})
    marked = {e["key"] for e in out if e.get("live_only")}
    want = {k for k, f in F.FILTERS.items() if f["column"] in db.LIVE_ONLY_COLUMNS}
    assert want, "nothing is live-only: the rail is vacuous"
    assert marked == want
    assert "rvol_live" in marked and "vol_ratio" not in marked


# ── 6. a concept may quote a starter's grouped criteria ─────────────────────

def test_a_starter_citation_reads_the_logic_group_too():
    from api.services import concept_vocabulary as cv
    got = cv._resolve_starter_screen({"screen": "starter_52w_breakout"})
    assert "vol_ratio" in got["keys"] and 1.5 in got["values"]


# ── 4. the coverage note does not count a blank the screen itself decides ───

def test_coverage_does_not_count_a_blank_live_volume_the_fallback_decides(snap):
    """Off-hours every rvol_live is blank and the group reads vol_ratio instead, so
    those rows were decided, not lost. Member walk 2026-10-17: '11,179 stocks have
    no value for one of these filters' over a screen that answered 12."""
    db.upsert_rows([_row("AAA", rvol_live=None, vol_ratio=3.0), _row("BBB", rvol_live=None, vol_ratio=0.5),
                    _row("NONE", rvol_live=None, vol_ratio=None)])
    cov = Q.coverage_for({"filters": [], "logic": SS._live_volume_or_nightly(2)})
    # only NONE has no volume at all: nothing in the group can decide it
    assert cov["not_computable"] == 1
    assert [d["ticker"] for d in cov["dropped_symbols"]] == ["NONE"]


def test_CONTROL_a_blank_the_screen_does_not_handle_is_still_counted(snap):
    db.upsert_rows([_row("AAA", rvol_live=None, vol_ratio=3.0), _row("BBB", rvol_live=2.5, vol_ratio=3.0)])
    cov = Q.coverage_for({"filters": [], "logic": {"all": [{"key": "rvol_live", "op": "gte", "min": 2}]}})
    assert cov["not_computable"] == 1
    # and a flat filter on the column is counted even when the tree guards it
    spec = {"filters": [{"key": "rvol_live", "op": "gte", "min": 2}], "logic": SS._live_volume_or_nightly(2)}
    assert Q.coverage_for(spec)["not_computable"] == 1
