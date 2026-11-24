"""Held-store Screener columns (`api/services/screener/store_columns.py`, and `short_columns`' change since the prior
FINRA report).

Every symbol, figure and date here is invented. Each reader is fed its store through the store's own read-only accessor
(or, for the estimate snapshots, a scratch copy of the store's own file), never a vendor and never a store's build, and
each column is held to the rule it reuses: OSCR's map for the IV pair, GRPS's place and change for the group trio,
SHINT's change for the short column, DVD MARKET's window for the ex-dividend pair, EEHSC's classification for the
revision trio. No test compares a fixed date with the real today.
"""
from __future__ import annotations

import datetime as dt
import importlib
import os
import sqlite3
from zoneinfo import ZoneInfo

import pytest

from api.services.screener import store_columns as SC

ET = ZoneInfo("America/New_York")
SESSION = dt.date(2026, 11, 20)                               # a Friday
SAT_3AM = dt.datetime(2026, 11, 21, 3, 0, tzinfo=ET)            # the nightly build after it


# ── IV rank and percentile: OSCR's full map ───────────────────────────────────────────────────

@pytest.fixture
def iv_disk(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    os.makedirs(tmp_path / "data", exist_ok=True)
    from api.services.research import iv_rank_leaders as IVR

    def write(session, built, symbols, cut=0):
        IVR._save_map({"v": IVR.MAP_VERSION, "session": session,
                       "built_at": built.astimezone(dt.timezone.utc).isoformat(timespec="seconds"),
                       "symbols": symbols, "counts": {"ranked": len(symbols), "kept": len(symbols), "cut": cut}})
    return write


def test_the_iv_pair_is_the_maps_own_numbers_matched_across_share_class_spellings(iv_disk):
    iv_disk("2026-11-20", dt.datetime(2026, 11, 20, 20, 50, tzinfo=ET),
            {"ZZQA": [87.5, 91.2, 252], "ZZQ.B": [12.0, 4.5, 40], "ZZQC": [0.0, 0.0, 30], "ZZQD": [55.0, 50.0, 19]})
    receipt = {}
    got = SC.read_iv_fields(["ZZQA", "ZZQ-B", "ZZQC", "ZZQD", "ZZQE"], session=SESSION, now=SAT_3AM, receipt=receipt)
    assert got == {"ZZQA": {"iv_rank": 87.5, "iv_percentile": 91.2}, "ZZQ-B": {"iv_rank": 12.0, "iv_percentile": 4.5},
                   "ZZQC": {"iv_rank": 0.0, "iv_percentile": 0.0}}, "a real 0 is a 0; too few sessions is blank"
    assert receipt["state"] == "served" and receipt["map_session"] == "2026-11-20" and receipt["in_map"] == 4
    assert receipt["matched"] == 3 and receipt["cut"] == 0


def test_the_iv_map_is_withheld_by_the_iv_rank_modules_own_stale_rule(iv_disk):
    from api.services.research import iv_rank_leaders as IVR
    # Thursday's evening map read at Saturday 03:00: Friday's 20:45 build should have read Friday
    iv_disk("2026-11-19", dt.datetime(2026, 11, 19, 20, 50, tzinfo=ET), {"ZZQA": [87.5, 91.2, 252]})
    receipt = {}
    assert SC.read_iv_fields(["ZZQA"], session=SESSION, now=SAT_3AM, receipt=receipt) == {}
    assert receipt["state"] == "stale"
    assert IVR.behind({"session": "2026-11-19", "built_at": receipt["map_built_at"]}, SAT_3AM) is True
    # the same Thursday session built AFTER Friday's slot is that slot's build (the log held nothing newer)
    iv_disk("2026-11-19", dt.datetime(2026, 11, 20, 20, 50, tzinfo=ET), {"ZZQA": [87.5, 91.2, 252]})
    assert SC.read_iv_fields(["ZZQA"], session=SESSION, now=SAT_3AM) == {"ZZQA": {"iv_rank": 87.5,
                                                                                  "iv_percentile": 91.2}}


def test_the_iv_map_is_never_read_ahead_of_the_builds_session_and_blank_when_not_held(iv_disk, tmp_path):
    failures, receipt = {}, {}
    assert SC.read_iv_fields(["ZZQA"], session=SESSION, now=SAT_3AM, receipt=receipt) == {}
    assert receipt["state"] == "not_held"
    iv_disk("2026-11-23", dt.datetime(2026, 11, 23, 20, 50, tzinfo=ET), {"ZZQA": [87.5, 91.2, 252]})
    assert SC.read_iv_fields(["ZZQA"], failures=failures, session=SESSION, now=SAT_3AM, receipt=receipt) == {}
    assert receipt["state"] == "ahead" and failures == {"iv_rank": {"ahead": 1}}
    iv_disk(None, dt.datetime(2026, 11, 20, 20, 50, tzinfo=ET), {})
    assert SC.read_iv_fields(["ZZQA"], session=SESSION, now=SAT_3AM, receipt=receipt) == {}
    assert receipt["state"] == "empty"
    assert SC.read_iv_fields(["ZZQA"], session=None, receipt=receipt) == {} and receipt["state"] == "no_session"


# ── industry group rank: GRPS's held answer ───────────────────────────────────────────────────

def _grps(session="2026-11-20", blocks=None, rank_state="ok"):
    blocks = blocks if blocks is not None else {
        "Widget Makers": {"rank": {"m6": {"now": {"position": 3, "of": 40}, "w4": {"position": 9, "change": 6}}}},
        "Gadget Shops": {"rank": {"m6": {"now": {"position": 31, "of": 40}, "w4": {"position": 28, "change": -3}}}},
        "Tiny Group": {"rank": {"m6": {"now": {"position": None, "of": 40}, "w4": None}}},
        "New Group": {"rank": {"m6": {"now": {"position": 12, "of": 40}, "w4": None}}},
    }
    return {"status": "ok", "session": session, "built_for": session, "rank": {"state": rank_state},
            "kinds": {"industry": blocks, "sector": {"Widget Makers": {"rank": {"m6": {"now": {"position": 1,
                                                                                               "of": 11}}}}}}}


@pytest.fixture
def grps(monkeypatch):
    from api.services import group_stats as GS
    state = {"answer": _grps(), "map": {
        "ZZQA": {"sector": "Tech", "industry": "  Widget   Makers "},      # GRPS cleans the spacing: the same group
        "ZZQ.B": {"sector": "Retail", "industry": "Gadget Shops"},
        "ZZQC": {"sector": "Tech", "industry": "Tiny Group"},
        "ZZQD": {"sector": "Tech", "industry": None},
        "ZZQE": {"sector": "Tech", "industry": "New Group"}}}
    monkeypatch.setattr(GS, "held_answer", lambda: (state["answer"], "held" if state["answer"] else "not_held"))
    monkeypatch.setattr(GS, "_group_map", lambda: dict(state["map"]))
    return state


def test_group_rank_is_grps_place_out_of_how_many_and_its_own_4_week_change(grps):
    from api.services import group_stats_calc as GC
    receipt = {}
    got = SC.read_group_fields(["ZZQA", "ZZQ-B", "ZZQC", "ZZQD", "ZZQE", "ZZQF"], session=SESSION, receipt=receipt)
    assert got == {"ZZQA": {"group_rank": 3, "group_rank_of": 40, "group_rank_chg_4w": 6},
                   "ZZQ-B": {"group_rank": 31, "group_rank_of": 40, "group_rank_chg_4w": -3},
                   "ZZQE": {"group_rank": 12, "group_rank_of": 40}}, "no 4-week point: the change is blank"
    assert SC.GROUP_KIND == "industry" and receipt["measure"] == GC.RANK_PRIMARY
    assert receipt["state"] == "served" and receipt["groups"] == 4 and receipt["ranked_groups"] == 3
    assert receipt["mapped"] == 4 and receipt["matched"] == 3
    assert {"w4": 4} == {label: weeks for label, weeks in GC.RANK_BACK if weeks == SC.GROUP_CHANGE_WEEKS}


def test_group_rank_is_withheld_when_grps_is_behind_ahead_or_has_no_rank(grps):
    failures, receipt = {}, {}
    grps["answer"] = _grps(session="2026-11-13")                  # five sessions behind Friday
    assert SC.read_group_fields(["ZZQA"], failures=failures, session=SESSION, receipt=receipt) == {}
    assert receipt["state"] == "stale" and receipt["lag_sessions"] > 3
    grps["answer"] = _grps(session="2026-11-17")                  # three behind: served
    assert SC.read_group_fields(["ZZQA"], session=SESSION)["ZZQA"]["group_rank"] == 3
    grps["answer"] = _grps(session="2026-11-23")
    assert SC.read_group_fields(["ZZQA"], session=SESSION, receipt=receipt) == {} and receipt["state"] == "ahead"
    grps["answer"] = _grps(rank_state="unavailable")
    assert SC.read_group_fields(["ZZQA"], session=SESSION, receipt=receipt) == {} and receipt["state"] == "no_rank"
    grps["answer"] = None
    assert SC.read_group_fields(["ZZQA"], session=SESSION, receipt=receipt) == {} and receipt["state"] == "not_held"


# ── the short interest change: SHINT's figure from the one read of the FINRA list ──────────────

@pytest.fixture
def finra(monkeypatch):
    from api.services import short_data as sd
    from api.services.screener import finviz_universe as fv
    now = [{"ticker": t, "settlement_date": "2026-11-14", "short_interest": s, "avg_daily_volume": 1_000_000,
            "days_to_cover": 2.0} for t, s in (("ZZQA", 3_000_000), ("ZZQ.B", 400_000), ("ZZQC", 250_000),
                                                ("ZZQD", 1_000_000))]
    before = [{"ticker": t, "settlement_date": "2026-10-31", "short_interest": s, "avg_daily_volume": 1_000_000,
               "days_to_cover": 2.0} for t, s in (("ZZQA", 2_000_000), ("ZZQ.B", 500_000), ("ZZQC", 0))]
    held = sd.assemble_market("2026-11-14", now, "2026-10-31", before, frozenset({"ZZQA", "ZZQ-B", "ZZQC", "ZZQD"}),
                              {}, "missing", vendor_rows=4, read_at="2026-11-18T08:00:00+00:00")
    rows = {r["sym"]: r for r in held["rows"]}
    monkeypatch.setattr(sd, "held_market_rows", lambda: ({
        "rows": rows, "count": len(rows), "settlement_date": "2026-11-14", "previous_settlement_date": "2026-10-31",
        "publication_estimate": "2026-11-25", "read_at": held["read_at"], "source": sd.SOURCE, "float_source": None},
        "held"))
    monkeypatch.setattr(fv, "read_short_export", lambda names, failures=None: {})
    return rows


def test_the_short_interest_change_is_the_lists_own_figure_and_blank_without_two_reports(finra):
    from api.services import short_data as sd
    from api.services.screener import short_columns
    receipt = {}
    got = short_columns.read_short_columns(["ZZQA", "ZZQ-B", "ZZQC", "ZZQD", "ZZQE"], receipt=receipt)
    assert got["ZZQA"]["short_interest_chg_pct"] == 50.0 == sd.change_of(3_000_000, 2_000_000)[1]
    assert got["ZZQ-B"]["short_interest_chg_pct"] == -20.0, "a fall is negative"
    assert "short_interest_chg_pct" not in got["ZZQC"], "a change from 0 shares has no percent"
    assert "short_interest_chg_pct" not in got["ZZQD"], "no previous report"
    assert got["ZZQE"] == {}, "not in the list: blank, never 0"
    assert receipt["short_interest_chg_pct"] == {"list": 2, "none": 3}
    assert (receipt["settlement_date"], receipt["previous_settlement_date"]) == ("2026-11-14", "2026-10-31")


# ── the next ex-dividend date: DVD MARKET's held list ─────────────────────────────────────────

def _dvd(window=("2026-11-16", "2026-11-29"), rows=None, cut=False, leg="ok"):
    rows = rows if rows is not None else [
        {"sym": "ZZQA", "ex_date": "2026-11-19"},                   # before the session's next day: past
        {"sym": "ZZQA", "ex_date": "2026-11-27"},
        {"sym": "ZZQA", "ex_date": "2026-11-24"},                   # the soonest ahead
        {"sym": "ZZQ.B", "ex_date": "2026-11-23"},
        {"sym": "ZZQC", "ex_date": "2026-12-02"},                   # past the window's end: never counted
        {"sym": "ZZQX", "ex_date": "2026-11-25"}]                   # not a target
    return {"status": "ok", "window": {"from": window[0], "to": window[1]}, "read_at": "2026-11-20T15:00:00+00:00",
            "legs": {"dividends": leg, "splits": "ok"}, "cut": {"dividends": cut, "splits": False}, "dividends": rows}


@pytest.fixture
def dvd(monkeypatch):
    from api.services import dividends_market as DM
    state = {"held": _dvd()}
    monkeypatch.setattr(DM, "peek", lambda: state["held"])
    monkeypatch.setattr(DM, "universe", lambda: frozenset({"ZZQA", "ZZQ-B", "ZZQC", "ZZQX"}))
    return state


def test_the_next_ex_dividend_date_is_the_soonest_inside_the_window_from_the_rows_date(dvd):
    receipt = {}
    today = dt.date(2026, 11, 21)
    got = SC.read_ex_div_fields(["ZZQA", "ZZQ-B", "ZZQC", "ZZQD"], session=SESSION, today=today, receipt=receipt)
    assert got == {"ZZQA": {"next_ex_div_date": "2026-11-24", "days_to_ex_div": 3},
                   "ZZQ-B": {"next_ex_div_date": "2026-11-23", "days_to_ex_div": 2}}
    assert (receipt["cover_from"], receipt["cover_to"], receipt["days_ahead"]) == ("2026-11-21", "2026-11-29", 8)
    assert receipt["state"] == "served" and receipt["followed_targets"] == 3 and receipt["in_cover"] == 4
    # an ex-date on the row's own date is 0 days away
    dvd["held"] = _dvd(rows=[{"sym": "ZZQA", "ex_date": "2026-11-23"}])
    assert SC.read_ex_div_fields(["ZZQA"], session=SESSION, today=dt.date(2026, 11, 23)) == {
        "ZZQA": {"next_ex_div_date": "2026-11-23", "days_to_ex_div": 0}}


def test_the_ex_dividend_list_is_withheld_when_its_window_does_not_reach_past_the_session(dvd):
    failures, receipt = {}, {}
    dvd["held"] = _dvd(window=("2026-11-02", "2026-11-15"))       # a list read two weeks ago
    assert SC.read_ex_div_fields(["ZZQA"], failures=failures, session=SESSION, receipt=receipt) == {}
    assert receipt["state"] == "window_not_held" and failures == {"ex_dividend": {"window_not_held": 1}}
    dvd["held"] = _dvd(leg="failed")
    assert SC.read_ex_div_fields(["ZZQA"], session=SESSION, receipt=receipt) == {} and receipt["state"] == "leg_failed"
    dvd["held"] = None
    assert SC.read_ex_div_fields(["ZZQA"], session=SESSION, receipt=receipt) == {} and receipt["state"] == "not_held"


def test_a_list_cut_at_its_cap_covers_only_the_days_before_its_latest(dvd):
    dvd["held"] = _dvd(cut=True, rows=[{"sym": "ZZQA", "ex_date": "2026-11-24"}, {"sym": "ZZQ.B", "ex_date": "2026-11-27"}])
    receipt = {}
    got = SC.read_ex_div_fields(["ZZQA", "ZZQ-B"], session=SESSION, today=dt.date(2026, 11, 21), receipt=receipt)
    assert got == {"ZZQA": {"next_ex_div_date": "2026-11-24", "days_to_ex_div": 3}}
    assert receipt["cover_to"] == "2026-11-26" and receipt["cut"] is True


# ── estimate revisions: EEHSC's classification over a scratch copy of the store ───────────────

def _seed_estimates(path, tracked, snaps):
    c = sqlite3.connect(path)
    try:
        from api.services import estimate_history as EH
        c.executescript(EH._SCHEMA)
        for i, sym in enumerate(tracked):
            c.execute("INSERT INTO estimate_tracked VALUES (?,?,?)", (sym, 1000 + i, "sp500"))
        for sym, day, pe, eps in snaps:
            c.execute("INSERT INTO estimate_snapshot VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                      (sym, day, pe, eps, None, None, 1e9, None, None, 10, 10, 1))
        c.commit()
    finally:
        c.close()


@pytest.fixture
def estimates(tmp_path, monkeypatch):
    path = tmp_path / "estimate_history.db"
    monkeypatch.setenv("ESTIMATE_HISTORY_DB_PATH", str(path))
    q = "2026-12-31"
    _seed_estimates(str(path), ["ZZQA", "ZZQ.B", "ZZQC", "ZZQD"], [
        ("ZZQA", "2026-10-20", q, 1.00), ("ZZQA", "2026-11-20", q, 1.10),          # +10%: raised
        ("ZZQ.B", "2026-10-20", q, 1.00), ("ZZQ.B", "2026-11-20", q, 0.90),        # -10%: cut
        ("ZZQC", "2026-10-20", q, 1.00), ("ZZQC", "2026-11-20", q, 1.003),         # +0.3%: held
        ("ZZQD", "2026-11-10", q, 1.00), ("ZZQD", "2026-11-20", q, 1.20)])         # begins inside the window
    return path


def test_the_revision_trio_is_eehscs_per_stock_classification(estimates):
    from api.services import estimate_revisions as ER
    receipt = {}
    got = SC.read_eps_revision_fields(["ZZQA", "ZZQ-B", "ZZQC", "ZZQD", "ZZQE"], session=SESSION, receipt=receipt)
    assert got == {"ZZQA": {"eps_rev_up_30d": 1, "eps_rev_down_30d": 0, "eps_rev_net_30d": 1},
                   "ZZQ-B": {"eps_rev_up_30d": 0, "eps_rev_down_30d": 1, "eps_rev_net_30d": -1},
                   "ZZQC": {"eps_rev_up_30d": 0, "eps_rev_down_30d": 0, "eps_rev_net_30d": 0}}
    assert "ZZQD" not in got, "still collecting: blank, never 0"
    assert "ZZQE" not in got, "not tracked: blank"
    assert receipt["state"] == "served" and receipt["asof"] == "2026-11-20" and receipt["tracked"] == 4
    assert receipt["states"]["collecting"] == 1 and receipt["states"]["up"] == 1
    assert SC.EPS_REV_WINDOW in ER.WINDOWS and SC.EPS_REV_METRIC in ER.METRICS


def test_the_revision_trio_reuses_eehscs_classify_never_a_second_rule(estimates, monkeypatch):
    from api.services import estimate_revisions as ER
    real = ER.classify
    def every_one_cut(*a, **k):
        r = real(*a, **k)
        return {**r, "state": "down", "pct": r["pct"] if r["pct"] is not None else -1.0}
    monkeypatch.setattr(ER, "classify", every_one_cut)
    got = SC.read_eps_revision_fields(["ZZQA", "ZZQC"], session=SESSION)
    assert got["ZZQA"] == got["ZZQC"] == {"eps_rev_up_30d": 0, "eps_rev_down_30d": 1, "eps_rev_net_30d": -1}


def test_the_revision_trio_is_withheld_when_the_store_is_behind_ahead_or_absent(estimates, tmp_path, monkeypatch):
    receipt = {}
    assert SC.read_eps_revision_fields(["ZZQA"], session=dt.date(2026, 11, 30), receipt=receipt) == {}
    assert receipt["state"] == "stale" and receipt["lag_sessions"] > 3
    assert SC.read_eps_revision_fields(["ZZQA"], session=dt.date(2026, 11, 19), receipt=receipt) == {}
    assert receipt["state"] == "ahead"
    missing = tmp_path / "nope" / "estimate_history.db"
    monkeypatch.setenv("ESTIMATE_HISTORY_DB_PATH", str(missing))
    assert SC.read_eps_revision_fields(["ZZQA"], session=SESSION, receipt=receipt) == {}
    assert receipt["state"] == "not_held" and not missing.exists(), "a read never creates the store"


# ── the build: each store read once, the columns land; the filters screen them ────────────────

def test_the_build_reads_each_store_once_and_writes_the_eleven_columns(tmp_path, monkeypatch, iv_disk, grps, dvd,
                                                                       estimates):
    from api.services import estimate_revisions as ER, group_stats as GS, dividends_market as DM
    from api.services.research import iv_rank_leaders as IVR
    from api.services.screener import snapshot_builder as sb, snapshot_db, volume_volatility as VV
    from api.services.screener import (finviz_universe, earnings_dates, earnings_context, analyst_pass,
                                       insider_capture, short_columns, fund_trends, beats_insiders_funds as BIF,
                                       context_joins as cj)
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    snapshot_db.init_db()
    d, rows = dt.date(2026, 9, 1), []
    while len(rows) < 60:
        if d.weekday() < 5:
            rows.append((int(d.strftime("%Y%m%d")), 20.0, 20.2, 19.8, 20.0, 1000))
        d += dt.timedelta(days=1)
    monkeypatch.setattr(sb, "_load_universe", lambda: ["ZZQA", "ZZQ-B", "ZZQC"])
    import api.services.bars_sqlite as bs
    monkeypatch.setattr(bs, "get_bars", lambda t, tf, n: rows)
    monkeypatch.setattr(sb, "_read_rs_map", lambda: {})
    monkeypatch.setattr(sb, "_read_bulk_fundamentals", lambda t, failures=None: {})
    monkeypatch.setattr(sb, "_read_ratings", lambda t, failures=None: {})
    monkeypatch.setattr(sb, "_read_fundamentals", lambda t, price=None, failures=None: {})
    monkeypatch.setattr(sb, "settled_session", lambda now=None: SESSION)
    monkeypatch.setattr(sb, "_read_settled_bars", lambda d: {"error": "not in this test"})
    for fn in ("read_breadth_flags", "read_uct20", "read_index_flags", "read_etf_flags"):
        monkeypatch.setattr(cj, fn, lambda targets, failures=None: {})
    for mod, fn in ((finviz_universe, "read_finviz_fields"), (earnings_dates, "read_earnings_dates"),
                    (earnings_context, "read_last_report_move"), (earnings_context, "read_implied_context"),
                    (analyst_pass, "read_analyst_fields"), (insider_capture, "read_insider_fields")):
        monkeypatch.setattr(mod, fn, lambda targets, failures=None: {})
    monkeypatch.setattr(short_columns, "read_short_columns",
                        lambda t, failures=None, receipt=None: {"ZZQC": {"short_interest_chg_pct": 12.5}})
    monkeypatch.setattr(fund_trends, "read_fields", lambda t, failures=None, settled=None, receipt=None: {})
    for fn in ("read_earnings_fields", "read_insider_fields"):
        monkeypatch.setattr(BIF, fn, lambda t, failures=None, session=None, receipt=None: {})
    monkeypatch.setattr(BIF, "read_fund_fields", lambda t, failures=None, receipt=None: {})
    monkeypatch.setattr(VV, "index_context", lambda now=None: {"state": "not_held", "rows": 0, "ms": 0.0,
                                                               "seam_withheld": 0})
    iv_disk("2026-11-20", dt.datetime(2026, 11, 20, 20, 50, tzinfo=ET), {"ZZQA": [87.5, 91.2, 252]})
    monkeypatch.setattr(IVR, "behind", lambda held, now=None: False)        # the real clock is not this test's
    calls = {"iv": 0, "grps": 0, "dvd": 0, "eps": 0}

    def counted(key, fn):
        def wrapper(*a, **k):
            calls[key] += 1
            return fn(*a, **k)
        return wrapper
    monkeypatch.setattr(IVR, "read_rank_map", counted("iv", IVR.read_rank_map))
    monkeypatch.setattr(GS, "held_answer", counted("grps", GS.held_answer))
    monkeypatch.setattr(DM, "peek", counted("dvd", DM.peek))
    monkeypatch.setattr(ER, "build", counted("eps", ER.build))
    dvd["held"] = _dvd(window=("2026-11-16", "2099-12-31"), rows=[{"sym": "ZZQ.B", "ex_date": "2099-12-30"}])

    out = sb.run_build(max_tickers=3)
    assert out["built"] == 3 and calls == {"iv": 1, "grps": 1, "dvd": 1, "eps": 1}, \
        "one read of each store per build, never one per ticker"
    rec = out["store_columns"]
    assert {rec[k]["state"] for k in ("iv", "groups", "ex_div", "eps_rev")} == {"served"}
    assert all("seconds" in rec[k] for k in rec)
    a, b, c = (snapshot_db.get_row(t) for t in ("ZZQA", "ZZQ-B", "ZZQC"))
    assert (a["iv_rank"], a["iv_percentile"]) == (87.5, 91.2) and b["iv_rank"] is None
    assert (a["group_rank"], a["group_rank_of"], a["group_rank_chg_4w"]) == (3, 40, 6)
    assert c["group_rank"] is None, "an industry GRPS could not rank: NULL, never 0"
    assert b["next_ex_div_date"] == "2099-12-30" and isinstance(b["days_to_ex_div"], int)
    assert a["next_ex_div_date"] is None and a["days_to_ex_div"] is None
    assert (a["eps_rev_up_30d"], a["eps_rev_net_30d"]) == (1, 1) and (b["eps_rev_down_30d"], b["eps_rev_net_30d"]) == (1, -1)
    assert c["short_interest_chg_pct"] == 12.5 and a["short_interest_chg_pct"] is None


def test_the_filters_screen_the_eleven_columns_end_to_end(tmp_path, monkeypatch):
    from tests.test_screener_filters import _snapshot
    day = SESSION.isoformat()
    _snapshot(tmp_path, monkeypatch, [
        {"ticker": "ZZQA", "iv_rank": 92.0, "iv_percentile": 95.0, "group_rank": 3, "group_rank_of": 40,
         "group_rank_chg_4w": 6, "short_interest_chg_pct": 50.0, "next_ex_div_date": "2026-11-24",
         "days_to_ex_div": 3, "eps_rev_up_30d": 1, "eps_rev_down_30d": 0, "eps_rev_net_30d": 1,
         "snapshot_date": day, "built_at": 1},
        {"ticker": "ZZQB", "iv_rank": 8.0, "iv_percentile": 4.0, "group_rank": 31, "group_rank_of": 40,
         "group_rank_chg_4w": -3, "short_interest_chg_pct": -20.0, "eps_rev_up_30d": 0, "eps_rev_down_30d": 1,
         "eps_rev_net_30d": -1, "snapshot_date": day, "built_at": 1},
        {"ticker": "ZZQC", "snapshot_date": day, "built_at": 1},     # NULL: inside no range
    ])
    from api.services.screener import query
    importlib.reload(query)

    def tickers(*fs):
        return sorted(r["ticker"] for r in query.run_scan({"filters": list(fs)})["rows"])

    assert tickers({"key": "iv_rank", "op": "gte", "min": 80}) == ["ZZQA"]
    assert tickers({"key": "iv_percentile", "op": "lte", "max": 10}) == ["ZZQB"]
    assert tickers({"key": "group_rank", "op": "lte", "max": 10}) == ["ZZQA"]
    assert tickers({"key": "group_rank_chg_4w", "op": "lt", "max": 0}) == ["ZZQB"]
    assert tickers({"key": "group_rank_of", "op": "gte", "min": 1}) == ["ZZQA", "ZZQB"]
    assert tickers({"key": "short_interest_chg_pct", "op": "gte", "min": 25}) == ["ZZQA"]
    assert tickers({"key": "days_to_ex_div", "op": "between", "min": 0, "max": 5}) == ["ZZQA"]
    assert tickers({"key": "eps_rev_up_30d", "op": "eq", "value": 1}) == ["ZZQA"]
    assert tickers({"key": "eps_rev_down_30d", "op": "gte", "min": 1}) == ["ZZQB"]
    assert tickers({"key": "eps_rev_net_30d", "op": "gt", "min": 0}) == ["ZZQA"]
    assert tickers({"key": "eps_rev_net_30d", "op": "lte", "max": 0}) == ["ZZQB"]


# ── the registry, the client text, the methodology ────────────────────────────────────────────

ALL = SC.COLUMNS + ("short_interest_chg_pct",)


def test_each_column_is_a_bare_member_control_in_the_family_a_member_looks_in_with_a_seat_in_its_view():
    from api.services.screener import filters, short_columns, snapshot_db
    assert short_columns.CHANGE_COLUMN == "short_interest_chg_pct"
    catalog = {f["key"]: f for f in filters.field_catalog()}
    category = {**SC.CATEGORY, "short_interest_chg_pct": "ownership"}
    view_of = {"volume_volatility": "volume_volatility", "context": "context", "ownership": "ownership",
               "events": "events"}
    for c in ALL:
        f = filters.FILTERS[c]
        assert f["column"] == c and f["type"] == "range" and f["allow_custom"] is True, c
        assert [p["label"] for p in f["presets"]] == ["Any"] and f["presets_deferred"] is True, c
        assert f.get("agent_omit") is True and catalog[c].get("agent_omit") is True, c
        assert f["category"] == category[c], c
        assert c in filters.VIEWS[view_of[category[c]]]["columns"] and c in snapshot_db.COLUMNS, c
        words = (c + " " + f["label"]).lower()
        assert not any(w in words for w in ("accum", "distrib", "a/d", "acc/dis", "accdis")), c
    assert set(SC.INT_COLUMNS) <= snapshot_db._INT and "next_ex_div_date" in snapshot_db._TEXT
    assert not ({"iv_rank", "iv_percentile", "short_interest_chg_pct"} & (snapshot_db._INT | snapshot_db._TEXT))
    assert {"short_float_pct", "short_ratio"} <= set(filters.VIEWS["ownership"]["columns"])
    assert {"next_earnings_date", "upgrades_30d", "downgrades_30d"} <= set(filters.VIEWS["events"]["columns"])
    assert {"hv_20", "hv_60"} <= set(filters.VIEWS["volume_volatility"]["columns"])


def test_the_client_text_states_the_owners_numbers():
    from api.services import estimate_history as EH, estimate_revisions as ER, group_stats_calc as GC
    from api.services import short_data as sd
    from api.services.research import iv_history as IVH
    from tests.test_screener_filters import _column_def_block as block
    for c in SC.IV_COLUMNS:
        assert f"fewer than {IVH.RANK_MIN_SESSIONS} logged sessions" in block(c)
        assert f"up to {IVH.RANK_WINDOW})" in block(c) or f"(up to {IVH.RANK_WINDOW})" in block(c)
        assert f"under {IVH.IV_FLOOR * 100:g}% a year" in block(c)
    assert f"at least {GC.MIN_MEMBERS} members" in block("group_rank")
    assert f"last {SC.GROUP_CHANGE_WEEKS} weeks" in block("group_rank_chg_4w")
    assert f"at least {sd.FLOOR_SHARES:,} shares" in block("short_interest_chg_pct")
    for c in SC.EPS_REV_COLUMNS:
        assert f"more than {ER.HELD_TOLERANCE_PCT:g}%" in block(c) and f"last {SC.EPS_REV_WINDOW} days" in block(c)
        assert f"at most {EH.MAX_SYMBOLS}" in block(c)


def test_every_column_publishes_a_method_with_its_source_and_rule():
    from api.services import dividends_market as DM, short_data as sd
    from api.services.research import iv_rank_leaders as IVR
    from api.services.screener import methodology as M
    doc = M.all_methods()
    published = {m["column"]: m for m in doc["methods"]}
    for c in ALL:
        m = published.get(c)
        assert m is not None, f"{c} ships without a method"
        assert m["family"] == M.STORE_FAMILY and m["one_line"] and m["scale"] and m["how"] and m["caveat"], c
        assert "never 0" in m["caveat"], c
    for c in SC.IV_COLUMNS:
        assert IVR.RANK_METHOD in published[c]["how"] and IVR.SOURCE in published[c]["how"]
    assert "never by this row's own industry label" in published["group_rank"]["how"]
    assert sd.SOURCE in published["short_interest_chg_pct"]["how"]
    assert "settlement date before it" in published["short_interest_chg_pct"]["how"]
    assert DM.SOURCE in published["next_ex_div_date"]["how"]
    assert "never no dividend" in published["next_ex_div_date"]["caveat"]
    assert "S&P 500" in published["eps_rev_net_30d"]["caveat"]
    assert doc["held_store_columns"]["columns"] == list(ALL)


def test_the_store_methods_are_read_from_the_owners(monkeypatch):
    from api.services import estimate_history as EH, estimate_revisions as ER, group_stats_calc as GC
    from api.services import short_data as sd
    from api.services.research import iv_history as IVH
    from api.services.screener import methodology as M
    monkeypatch.setattr(IVH, "RANK_MIN_SESSIONS", 30)
    monkeypatch.setattr(GC, "MIN_MEMBERS", 7)
    monkeypatch.setattr(sd, "FLOOR_SHARES", 750_000)
    monkeypatch.setattr(ER, "HELD_TOLERANCE_PCT", 1.0)
    monkeypatch.setattr(EH, "MAX_SYMBOLS", 900)
    monkeypatch.setattr(SC, "GROUP_CHANGE_WEEKS", 13)
    monkeypatch.setattr(SC, "EPS_REV_WINDOW", 7)
    by = {m["column"]: m for m in M._store_methods()}
    assert "fewer than 30 logged sessions" in by["iv_rank"]["caveat"]
    assert "at least 7 members" in by["group_rank"]["how"]
    assert by["group_rank_chg_4w"]["label"] == "Industry Group Rank Change, 13 Weeks"
    assert "at least 750,000 shares" in by["short_interest_chg_pct"]["caveat"]
    assert "more than 1% either way" in by["eps_rev_up_30d"]["how"] and "at most 900" in by["eps_rev_up_30d"]["caveat"]
    assert by["eps_rev_net_30d"]["label"] == "EPS Estimate Revision, Net, 7 Days"
