"""ERNSC: earnings season by sector (`api/services/sector_earnings_calc.py` pure, `api/services/sector_earnings.py` held,
the read on `api/routers/group_stats.py`).

Rails:
  * the season is the reports dated in one calendar quarter, named for the quarter before it; the one that holds today
    (through today), the one before, the same one a year earlier; across a year's turn;
  * beat / in line / miss around the stated tolerance from the copy's OWN surprise (`earnings_intel._surprise`); an EPS
    estimate under 5 cents by the difference; no consensus is `none`, never a miss;
  * the reaction counts only when the copy was read after the last session that could have traded the result closed
    (weekends and holidays walked); no move held is `not_measured`;
  * one stock: its newest report inside each season; still to report and awaiting from the copy's next report date;
  * a sector: counts, shares and medians with the floor of 5 (fewer gives counts and no figure), the share that rose, the
    order (EPS beat share, then below the floor, then no sector on file), the biggest beats and misses first;
  * the build: every stock read once through the held reader (the REAL snapshot store in one test), coverage said
    (held, not held, no sector, the copies' ages), sectors spelled as GRPS spells them, never a vendor call;
  * held: a request never reads a copy (one background read, then the held answer; `computing` while the first runs;
    the disk copy after a restart); the refresh rule (30 minutes, or another day);
  * the route: 401 signed out, 402 free, 200 paid, 422 on a word it does not take, a plain def; one sector by its name.
Every ticker, figure and date here is INVENTED (the tickers are checked against the site's universe).
"""
from __future__ import annotations

import inspect
import json
import threading
import time
from datetime import date, datetime
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.services import earnings_intel as EI
from api.services import group_stats as GS
from api.services import sector_earnings as SE
from api.services import sector_earnings_calc as C

ROOT = Path(__file__).resolve().parents[1]
FREE_USER = {"id": "ses-free", "email": "free@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "ses-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}
TODAY = date(2031, 11, 20)                       # a Thursday inside the Q3 2031 season
HOLIDAYS = {date(2031, 11, 27)}                  # an invented market holiday (a Thursday)


def _trading(d: date) -> bool:
    return d.weekday() < 5 and d not in HOLIDAYS


def _ts(day: str, hour: int = 20) -> float:
    y, m, d = (int(x) for x in day.split("-"))
    return datetime(y, m, d, hour, 0, tzinfo=C.ET).timestamp()


def _q(rd, eps=(1.10, 1.00), rev=(1.004e9, 1.0e9), *, basis="consensus_comparable", label="FY2031 Q3", reported=True):
    """One reported quarter as `earnings_intel` holds it: the surprise worked out by its own function."""
    q = {"report_date": rd, "reported": reported, "label": label, "eps_basis": basis,
         "eps_actual": eps[0], "eps_estimate": eps[1], "revenue_actual": rev[0], "revenue_estimate": rev[1]}
    if basis == "consensus_comparable":
        q["eps_surprise_pct"], q["eps_surprise_abs"], _n = EI._surprise(eps[0], eps[1], eps=True)
        q["rev_surprise_pct"], q["rev_surprise_abs"], _n = EI._surprise(rev[0], rev[1], eps=False)
    else:
        q["eps_surprise_pct"] = q["eps_surprise_abs"] = q["rev_surprise_pct"] = q["rev_surprise_abs"] = None
    return q


def _copy(quarters, moves=None, *, read="2031-11-19", nxt=None, where="top"):
    events = [{"quarter": "x", "report_date": d, "reaction_pct": p, "eps_actual": None, "eps_estimate": None}
              for d, p in (moves or {}).items()]
    out = {"ticker": "x", "quarters": quarters, "reaction": {"events": events, "avg_abs_move_pct": 1.0} if events else None,
           "summary": {}, "meta": {"retrieved_at": _ts(read) if read else None}}
    if where == "top":
        out["next_report_date"] = nxt
    else:
        out["summary"]["next_report_date"] = nxt
    return out


SPANS = C.seasons(TODAY)


# ── the seasons ──────────────────────────────────────────────────────────────────────────────

class TestSeasons:
    def test_the_season_that_holds_today_the_one_before_and_a_year_earlier(self):
        assert SPANS == {
            "current": {"label": "Q3 2031", "quarter": "2031-Q3", "from": "2031-10-01", "to": "2031-12-31",
                        "through": "2031-11-20", "complete": False},
            "previous": {"label": "Q2 2031", "quarter": "2031-Q2", "from": "2031-07-01", "to": "2031-09-30",
                         "through": "2031-09-30", "complete": True},
            "year_ago": {"label": "Q3 2030", "quarter": "2030-Q3", "from": "2030-10-01", "to": "2030-12-31",
                         "through": "2030-12-31", "complete": True},
        }
        assert C.SEASON_IDS == ("current", "previous", "year_ago")

    def test_across_the_turn_of_a_year_and_on_the_last_day_of_a_quarter(self):
        s = C.seasons(date(2031, 1, 2))
        assert (s["current"]["label"], s["current"]["from"], s["current"]["to"]) == ("Q4 2030", "2031-01-01", "2031-03-31")
        assert (s["previous"]["label"], s["previous"]["from"], s["previous"]["to"]) == ("Q3 2030", "2030-10-01", "2030-12-31")
        assert (s["year_ago"]["label"], s["year_ago"]["from"], s["year_ago"]["to"]) == ("Q4 2029", "2030-01-01", "2030-03-31")
        assert C.seasons(date(2031, 12, 31))["current"]["label"] == "Q3 2031"
        assert C.seasons(date(2032, 1, 1))["current"]["label"] == "Q4 2031"
        assert C.seasons(date(2032, 2, 29))["current"]["to"] == "2032-03-31"          # a leap year


# ── beat, in line, miss ──────────────────────────────────────────────────────────────────────

class TestClassify:
    def test_the_tolerance_either_way(self):
        assert C.IN_LINE_PCT == 0.5 and C.IN_LINE_ABS == 0.005
        for pct, want in ((0.51, "beat"), (0.5, "in_line"), (0.0, "in_line"), (-0.5, "in_line"), (-0.51, "miss"), (12.0, "beat")):
            assert (pct, C.classify(pct)) == (pct, want)

    def test_an_estimate_under_five_cents_is_by_the_difference_and_no_consensus_is_none(self):
        _p, diff, note = EI._surprise(0.04, 0.03, eps=True)                 # the model's own: no percent near zero
        assert note == "near_zero_estimate" and C.classify(None, diff) == "beat"
        _p, diff, _n = EI._surprise(0.03, 0.03, eps=True)
        assert C.classify(None, diff) == "in_line"
        assert C.classify(None, -0.02) == "miss" and C.classify(None, 0.005) == "in_line"
        assert C.classify(None, None) == "none" and C.classify(None) == "none"


class TestSettled:
    def test_both_sessions_that_could_trade_the_result_must_have_closed(self):
        # Friday's report: Friday (before the open) or Monday (after the close); a copy read on Monday is too early
        assert C.settled("2031-10-03", "2031-10-06", _trading) is False
        assert C.settled("2031-10-03", "2031-10-07", _trading) is True
        # a report dated on a Saturday is first traded on Monday
        assert C.settled("2031-10-04", "2031-10-07", _trading) is False
        assert C.settled("2031-10-04", "2031-10-08", _trading) is True
        # the day before a holiday: the next session is the Friday after it
        assert C.settled("2031-11-26", "2031-11-28", _trading) is False
        assert C.settled("2031-11-26", "2031-12-01", _trading) is True
        assert C.settled("2031-10-03", None, _trading) is False and C.settled(None, "2031-12-01", _trading) is False

    def test_the_day_a_copy_was_read_is_new_york_time(self):
        assert C.built_day({"meta": {"retrieved_at": _ts("2031-10-06", hour=23)}}) == "2031-10-06"
        assert C.built_day({"meta": {}}) is None and C.built_day({}) is None and C.built_day({"meta": {"retrieved_at": True}}) is None


# ── one stock ────────────────────────────────────────────────────────────────────────────────

class TestOneStock:
    def test_its_newest_report_in_each_season_with_the_copys_surprise_and_move(self):
        copy = _copy([_q("2031-10-21"), _q("2031-07-22", eps=(0.90, 1.00), rev=(9.0e8, 1.0e9), label="FY2031 Q2"),
                      _q("2030-10-20", eps=(1.002, 1.00), label="FY2030 Q3"), _q("2030-07-21")],
                     {"2031-10-21": 4.2, "2031-07-22": -3.1, "2030-10-20": 0.4})
        got = C.stock_seasons("ZQA0", copy, SPANS, TODAY, _trading)
        kind, row = got["current"]
        assert kind == "reported"
        assert C.row_dict(row) == {"symbol": "ZQA0", "date": "2031-10-21", "label": "FY2031 Q3", "eps_act": 1.10,
                                   "eps_est": 1.00, "eps_pct": 10.0, "eps_abs": 0.1, "eps_state": "beat",
                                   "rev_act": 1.004e9, "rev_est": 1.0e9, "rev_pct": 0.4, "rev_state": "in_line",
                                   "move": 4.2, "move_state": "ok"}
        prev = C.row_dict(got["previous"][1])
        assert (prev["date"], prev["eps_state"], prev["eps_pct"], prev["rev_state"], prev["move"]) == ("2031-07-22", "miss", -10.0, "miss", -3.1)
        ago = C.row_dict(got["year_ago"][1])
        assert (ago["date"], ago["eps_state"], ago["eps_pct"], ago["move"]) == ("2030-10-20", "in_line", 0.2, 0.4)

    def test_two_reports_in_one_season_the_newest_counts(self):
        copy = _copy([_q("2031-10-02", eps=(0.5, 1.0)), _q("2031-11-12", eps=(1.5, 1.0))], read="2031-11-19")
        assert C.row_dict(C.stock_seasons("ZQA1", copy, SPANS, TODAY, _trading)["current"][1])["date"] == "2031-11-12"

    def test_no_consensus_a_quarter_with_no_date_and_one_not_reported_are_not_scored_or_not_placed(self):
        copy = _copy([_q("2031-10-21", basis="gaap_diluted"), {**_q(None), "report_date": None},
                      _q("2031-07-22", reported=False)])
        got = C.stock_seasons("ZQA2", copy, SPANS, TODAY, _trading)
        row = C.row_dict(got["current"][1])
        assert (row["eps_state"], row["eps_pct"], row["rev_state"], row["rev_pct"]) == ("none", None, "none", None)
        assert "previous" not in got and "year_ago" not in got

    def test_an_eps_estimate_under_five_cents_is_scored_by_the_difference(self):
        row = C.row_dict(C.stock_seasons("ZQA3", _copy([_q("2031-10-21", eps=(0.04, 0.02))]), SPANS, TODAY, _trading)["current"][1])
        assert (row["eps_pct"], row["eps_abs"], row["eps_state"]) == (None, 0.02, "beat")

    def test_a_move_not_held_or_read_too_early_is_said_never_zero(self):
        got = C.stock_seasons("ZQA4", _copy([_q("2031-10-21")]), SPANS, TODAY, _trading)
        assert C.row_dict(got["current"][1])["move_state"] == "not_measured"
        early = _copy([_q("2031-11-18")], {"2031-11-18": 2.5}, read="2031-11-19")    # Tuesday's report, read Wednesday
        row = C.row_dict(C.stock_seasons("ZQA4", early, SPANS, TODAY, _trading)["current"][1])
        assert (row["move"], row["move_state"]) == (None, "not_settled")
        late = _copy([_q("2031-11-18")], {"2031-11-18": 2.5}, read="2031-11-20")
        assert C.row_dict(C.stock_seasons("ZQA4", late, SPANS, TODAY, _trading)["current"][1])["move"] == 2.5

    def test_still_to_report_and_awaiting_from_the_copys_next_report_date(self):
        q2 = [_q("2031-07-22")]
        assert C.stock_seasons("ZQA5", _copy(q2, nxt="2031-12-04"), SPANS, TODAY, _trading)["current"] == ("to_report", ("ZQA5", "2031-12-04"))
        assert C.stock_seasons("ZQA5", _copy(q2, nxt="2031-11-20"), SPANS, TODAY, _trading)["current"] == ("to_report", ("ZQA5", "2031-11-20"))
        assert C.stock_seasons("ZQA5", _copy(q2, nxt="2031-11-10"), SPANS, TODAY, _trading)["current"] == ("awaiting", ("ZQA5", "2031-11-10"))
        assert C.stock_seasons("ZQA5", _copy(q2, nxt="2031-11-10", where="summary"), SPANS, TODAY, _trading)["current"][0] == "awaiting"
        assert "current" not in C.stock_seasons("ZQA5", _copy(q2, nxt="2032-01-20"), SPANS, TODAY, _trading)
        assert "current" not in C.stock_seasons("ZQA5", _copy(q2, nxt=None), SPANS, TODAY, _trading)
        # a season already over never says "to report"
        got = C.stock_seasons("ZQA5", _copy([], nxt="2031-08-01"), SPANS, TODAY, _trading)
        assert got == {}
        # once the report is in the copy, it is reported, whatever the next date says
        assert C.stock_seasons("ZQA5", _copy([_q("2031-10-21")], nxt="2031-12-30"), SPANS, TODAY, _trading)["current"][0] == "reported"


# ── a sector ─────────────────────────────────────────────────────────────────────────────────

def _row(sym, eps_pct, rev_pct=None, move=None, move_state="ok", eps_abs=None):
    eps_state = C.classify(eps_pct, eps_abs if eps_pct is None else None)
    return (sym, "2031-10-21", "FY2031 Q3", 1.0, 1.0, eps_pct, eps_abs, eps_state, 2.0e9, 2.0e9, rev_pct,
            C.classify(rev_pct), move if move_state == "ok" else None, move_state)


def _stock(sym, sector, *rows_or_kind, sid="current"):
    return {"symbol": sym, "sector": sector, "seasons": {sid: rows_or_kind[0]}}


class TestSlice:
    def _stocks(self):
        alpha = [_row("ZQB0", 12.0, 3.0, 4.0), _row("ZQB1", -8.0, -1.0, -2.0), _row("ZQB2", 0.3, 0.2, 1.0),
                 _row("ZQB3", 5.0, 2.0, 0.0), _row("ZQB4", 2.0, None, 3.0), _row("ZQB5", -1.0, 1.0, None, "not_measured"),
                 _row("ZQB6", None, None, None, "not_settled", eps_abs=0.01), _row("ZQB7", None, None, 1.5)]
        gamma = [_row(f"ZQC{i}", 3.0 + i, 1.0, 1.0) for i in range(4)] + [_row("ZQC4", -2.0, -2.0, -1.0)]
        beta = [_row(f"ZQD{i}", 1.0 + i, None, 2.0) for i in range(4)]
        out = [_stock(r[0], "Alpha", ("reported", r)) for r in alpha]
        out += [_stock(r[0], "Gamma", ("reported", r)) for r in gamma]
        out += [_stock(r[0], "Beta", ("reported", r)) for r in beta]
        out += [_stock("ZQE0", "Delta", ("to_report", ("ZQE0", "2031-12-02"))),
                _stock("ZQE1", "Delta", ("awaiting", ("ZQE1", "2031-11-12"))),
                _stock("ZQE2", "Alpha", ("to_report", ("ZQE2", "2031-11-25"))),
                _stock("ZQE3", "Alpha", ("to_report", ("ZQE3", "2031-11-21"))),
                _stock("ZQF0", None, ("reported", _row("ZQF0", 50.0, 5.0, 9.0)))]
        out.append(_stock("ZQF1", "Alpha", ("reported", _row("ZQF1", 1.0)), sid="year_ago"))   # another season
        return out

    def test_counts_shares_medians_the_floor_and_the_share_that_rose(self):
        sl = C.season_slice(self._stocks(), "current")
        by = {s["name"]: s for s in sl["sectors"]}
        a = by["Alpha"]
        assert (a["reported"], a["to_report"], a["awaiting"]) == (8, 2, 0)
        # EPS: 6 with a percent surprise and one under five cents (scored by the difference); one with no consensus
        assert a["eps"] == {"n": 7, "beat": 4, "in_line": 1, "miss": 2, "none": 1, "beat_pct": 57.1, "in_line_pct": 14.3,
                            "miss_pct": 28.6, "median": 1.15, "median_n": 6}
        # moves: 4, -2, 1, 0, 3, 1.5 measured; one not measured, one too early
        assert a["move"] == {"n": 6, "median": 1.25, "rose": 4, "rose_pct": 66.7, "not_settled": 1, "not_measured": 1}
        b = by["Beta"]
        assert b["reported"] == 4 and b["eps"]["n"] == 4 and b["eps"]["beat"] == 4
        assert (b["eps"]["beat_pct"], b["eps"]["median"], b["move"]["median"], b["move"]["rose_pct"]) == (None, None, None, None)
        d = by["Delta"]
        assert (d["reported"], d["to_report"], d["awaiting"], d["eps"]["n"], d["eps"]["beat_pct"]) == (0, 1, 1, 0, None)
        assert d["upcoming"] == [("ZQE0", "2031-12-02")] and d["late"] == [("ZQE1", "2031-11-12")]
        assert by["Alpha"]["upcoming"] == [("ZQE3", "2031-11-21"), ("ZQE2", "2031-11-25")]

    def test_revenue_is_its_own_count(self):
        a = {s["name"]: s for s in C.season_slice(self._stocks(), "current")["sectors"]}["Alpha"]
        # revenue: 3.0, -1.0, 0.2, 2.0, 1.0 with a percent; three with none
        assert (a["rev"]["n"], a["rev"]["beat"], a["rev"]["in_line"], a["rev"]["miss"], a["rev"]["none"]) == (5, 3, 1, 1, 3)
        assert (a["rev"]["beat_pct"], a["rev"]["median"], a["rev"]["median_n"]) == (60.0, 1.0, 5)

    def test_the_order_the_total_and_the_biggest_beats_and_misses_first(self):
        sl = C.season_slice(self._stocks(), "current")
        assert [s["name"] for s in sl["sectors"]] == ["Gamma", "Alpha", "Beta", "Delta", C.NO_SECTOR]
        assert sl["sectors"][-1]["on_file"] is False
        alpha = sl["sectors"][1]
        assert [r[C.SYM] for r in alpha["reporters"]] == ["ZQB0", "ZQB1", "ZQB3", "ZQB4", "ZQB5", "ZQB2", "ZQB6", "ZQB7"]
        assert [r[C.SYM] for r in sorted(alpha["reporters"], key=lambda r: C.row_order(r, "rev"))][:3] == ["ZQB0", "ZQB3", "ZQB1"]
        t = sl["total"]
        assert (t["reported"], t["to_report"], t["awaiting"]) == (8 + 5 + 4 + 1, 3, 1)
        assert t["eps"]["n"] == sum(s["eps"]["n"] for s in sl["sectors"])
        assert t["eps"]["beat"] == sum(s["eps"]["beat"] for s in sl["sectors"]) and t["eps"]["beat_pct"] is not None
        # every reported stock is in exactly one sector, and the other season's report is not here
        assert sum(len(s["reporters"]) for s in sl["sectors"]) == 18
        assert "ZQF1" not in {r[C.SYM] for s in sl["sectors"] for r in s["reporters"]}

    def test_an_empty_season(self):
        sl = C.season_slice([], "previous")
        assert sl["sectors"] == [] and sl["total"]["reported"] == 0 and sl["total"]["eps"]["beat_pct"] is None
        assert sl["total"]["move"]["median"] is None


# ── the build ────────────────────────────────────────────────────────────────────────────────

SYMS = ["ZQT0", "ZQT1", "ZQT2", "ZQT3", "ZQT4", "ZQN0", "ZQN1", "ZQX0", "ZQX1"]
GROUPS = {f"ZQT{i}": {"sector": "  Technology  ", "industry": "Invented Chips"} for i in range(5)}
GROUPS.update({"ZQN0": {"sector": "Energy", "industry": "Invented Oil"}, "ZQN1": {"sector": "Energy"}})


def _copies():
    out = {f"ZQT{i}": _copy([_q("2031-10-21", eps=(1.0 + 0.1 * i, 1.0)), _q("2030-10-22", eps=(0.9, 1.0))],
                            {"2031-10-21": float(i) - 1.0, "2030-10-22": -1.0}, read="2031-11-19") for i in range(5)}
    out["ZQN0"] = _copy([_q("2031-07-20")], nxt="2031-12-03", read="2031-11-01")          # still to report; an old copy
    out["ZQN1"] = _copy([_q("2029-01-20")], read="2031-11-18")                               # held, nothing in any season
    out["ZQX0"] = _copy([_q("2031-10-30", eps=(2.0, 1.0))], read="2031-11-18")              # no sector on file
    return out


def _reader(copies, failing=("ZQX1",)):
    reads = []

    def read(sym):
        reads.append(sym)
        if sym in failing:
            raise RuntimeError("an unreadable copy")
        return copies.get(sym)
    return read, reads


def test_fixture_tickers_are_not_stocks_the_site_follows():
    universe = set(json.loads((ROOT / "api" / "data" / "cap_universe.json").read_text(encoding="utf-8")))
    assert "NVDA" in universe                                   # the control: this is the ticker list
    invented = [*SYMS, "ZQA0", "ZQA1", "ZQA2", "ZQA3", "ZQA4", "ZQA5", *[f"ZQB{i}" for i in range(8)],
                *[f"ZQC{i}" for i in range(5)], *[f"ZQD{i}" for i in range(4)], "ZQE0", "ZQE1", "ZQE2", "ZQE3", "ZQF0", "ZQF1"]
    for sym in invented:
        assert sym not in universe


def test_every_stock_is_read_once_and_the_coverage_is_said(monkeypatch):
    read, reads = _reader(_copies())
    pauses = []
    a, note = SE.build(symbols=SYMS, groups=GROUPS, read=read, today=TODAY, trading_day=_trading,
                       pause=pauses.append, yield_s=0.001)
    assert reads == SYMS and len(pauses) == len(SYMS) and "held=8" in note
    assert a["status"] == "ok" and a["v"] == SE.ANSWER_VERSION and a["today"] == "2031-11-20"
    assert a["coverage"] == {"universe": 9, "held": 8, "not_held": 1, "no_sector": 1, "oldest_copy": "2031-11-01",
                             "newest_copy": "2031-11-19", "copies_old": 1, "old_days": 7}
    assert a["build"]["counts"]["read_failed"] == 1
    assert a["seasons"] == SPANS and a["season_rule"] == C.SEASON_RULE and a["map"] == GS.MAP_NAME
    assert (a["in_line_pct"], a["in_line_abs"], a["min_reporters"]) == (0.5, 0.005, 5)
    cur = a["slices"]["current"]
    assert [s["name"] for s in cur["sectors"]] == ["Technology", "Energy", C.NO_SECTOR]     # cleaned as GRPS cleans it
    tech, energy, none = cur["sectors"]
    assert (tech["reported"], tech["eps"]["beat"], tech["eps"]["in_line"], tech["eps"]["beat_pct"]) == (5, 4, 1, 80.0)
    assert (tech["move"]["n"], tech["move"]["median"], tech["move"]["rose"], tech["move"]["rose_pct"]) == (5, 1.0, 3, 60.0)
    assert (energy["reported"], energy["to_report"], energy["upcoming"]) == (0, 1, [("ZQN0", "2031-12-03")])
    assert none["reporters"][0][C.SYM] == "ZQX0"
    ago = a["slices"]["year_ago"]
    assert [s["name"] for s in ago["sectors"]] == ["Technology"] and ago["sectors"][0]["eps"]["miss"] == 5
    prev = a["slices"]["previous"]
    assert [s["name"] for s in prev["sectors"]] == ["Energy"] and prev["total"]["reported"] == 1


def test_the_default_reader_is_the_held_one_through_the_real_snapshot_store(monkeypatch, tmp_path):
    from api.services import fundamentals_snapshot_store as snap
    monkeypatch.setenv("FUNDAMENTALS_TABLES_DB_PATH", str(tmp_path / "fund.db"))
    copies = _copies()
    for sym in ("ZQT0", "ZQT1", "ZQX0"):
        snap.put(EI._KIND, sym, copies[sym], 3600)

    def boom(*a, **k):
        raise AssertionError("a build or a provider call on the read")
    monkeypatch.setattr(EI, "_build", boom)
    monkeypatch.setattr(EI, "get_earnings", boom)
    monkeypatch.setattr(EI, "_schedule_refresh", boom)
    a, _note = SE.build(symbols=["ZQT0", "ZQT1", "ZQX0", "ZQX1"], groups=GROUPS, today=TODAY, trading_day=_trading, yield_s=0)
    assert a["coverage"]["held"] == 3 and a["coverage"]["not_held"] == 1
    assert a["slices"]["current"]["total"]["reported"] == 3


def test_the_one_connection_read_gives_get_earnings_helds_answer_case_by_case(monkeypatch, tmp_path):
    from api.services import fundamentals_snapshot_store as snap
    from api.services.cache import cache
    monkeypatch.setenv("FUNDAMENTALS_TABLES_DB_PATH", str(tmp_path / "fund.db"))
    # the names the read is coupled to (a rename fails here, by name)
    for name in ("_KIND", "_has_quarterly", "_STALE_MAX", "get_earnings_held"):
        assert hasattr(EI, name), f"earnings_intel.{name} is gone: sector_earnings.held_copies reads by it"
    for name in ("_ensure_init", "_connect", "put", "get"):
        assert hasattr(snap, name), f"fundamentals_snapshot_store.{name} is gone"
    copies = _copies()
    now = time.time()
    snap.put(EI._KIND, "ZQT0", copies["ZQT0"], 3600)                                     # fresh
    snap.put(EI._KIND, "ZQT1", copies["ZQT1"], 3600, now=now - EI._STALE_MAX - 60)       # past the model's limit
    snap.put(EI._KIND, "ZQT2", {**copies["ZQT2"], "quarters": [], "estimates": []}, 3600)  # no quarterly series
    snap.put(EI._KIND, "ZQT3", copies["ZQT3"], 3600, now=now - EI._STALE_MAX + 3600)     # old, inside the limit
    snap.put(EI._KIND, "ZQT4", copies["ZQT4"], 3600)                                     # on disk, and another in memory
    in_memory = {**copies["ZQN0"], "ticker": "memory"}
    partial = {"quarters": [], "estimates": [], "annual": {"reported": [1]}}
    cache.set(f"{EI._KIND}::ZQT4", in_memory, 60)
    cache.set(f"{EI._KIND}::ZQN1", partial, 60)                                          # a partial build parked in memory
    syms = ["ZQT0", "ZQT1", "ZQT2", "ZQT3", "ZQT4", "ZQN1", "ZQX1", "zqt0"]
    try:
        bulk = list(SE.held_copies(syms))
        one = [EI.get_earnings_held(s) for s in syms]
    finally:
        cache.invalidate(f"{EI._KIND}::ZQT4")
        cache.invalidate(f"{EI._KIND}::ZQN1")
    assert [s for s, _p in bulk] == syms
    assert [p for _s, p in bulk] == one
    assert [p is not None for _s, p in bulk] == [True, False, False, True, True, False, False, True]
    assert bulk[4][1]["ticker"] == "memory"


def test_the_read_never_asks_a_vendor():
    for name in ("sector_earnings.py", "sector_earnings_calc.py"):
        src = (ROOT / "api" / "services" / name).read_text(encoding="utf-8")
        for word in ("fmp_client", "finnhub", "requests", "httpx", "get_earnings(", "refresh_earnings", "_get_bars_inner",
                     "massive"):
            assert word not in src, f"{name} names {word}"
    assert "get_earnings_held" in (ROOT / "api" / "services" / "sector_earnings.py").read_text(encoding="utf-8")


# ── held: a request never reads a copy ───────────────────────────────────────────────────────

@pytest.fixture()
def held(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    SE.reset_for_tests()
    read, reads = _reader(_copies())
    builds = []
    real = SE.build

    def counted(previous=None, **k):
        builds.append(1)
        return real(previous, symbols=SYMS, groups=GROUPS, read=read, today=TODAY, trading_day=_trading, yield_s=0)
    monkeypatch.setattr(SE, "build", counted)
    monkeypatch.setattr(SE, "_today", lambda: TODAY)
    yield builds, reads
    SE.drain_for_tests()
    SE.reset_for_tests()


def test_the_first_request_waits_on_one_read_and_the_next_reads_nothing(held, monkeypatch):
    builds, reads = held
    first = SE.get_season("current")
    assert first["status"] == "ok" and first["season"] == "current" and len(builds) == 1 and len(reads) == len(SYMS)
    assert "slices" not in first and "build" not in first and first["check"] is None
    second = SE.get_season("year_ago")
    third = SE.get_season("current", "technology")
    assert second["status"] == "ok" and third["found"] is True and len(builds) == 1 and len(reads) == len(SYMS)


def test_the_held_copy_on_disk_serves_after_a_restart(held, monkeypatch, tmp_path):
    builds, _reads = held
    assert SE.get_season("current")["status"] == "ok" and len(builds) == 1
    assert (tmp_path / "sector_earnings" / "sector_earnings_v1.json").exists()
    SE.reset_for_tests()                                         # a restart: nothing in memory
    again = SE.get_season("current", "Technology")
    assert again["status"] == "ok" and len(builds) == 1          # served from disk, no read
    assert again["sector"]["reporters"][0]["symbol"] == "ZQT4"   # rows held as lists on disk read the same


def test_while_the_first_read_runs_a_request_is_told_computing(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    SE.reset_for_tests()
    gate = threading.Event()
    blank = {"total": C.season_slice([], "current")["total"], "sectors": []}
    answer = {"status": "ok", "v": SE.ANSWER_VERSION, "today": "2031-11-20", "slices": {sid: blank for sid in C.SEASON_IDS}}
    monkeypatch.setattr(SE, "build", lambda previous=None, **k: (gate.wait(5), (answer, "x"))[1])
    monkeypatch.setattr(SE._held, "_wait_s", 0.05)
    assert SE.get_season("previous") == {"status": "computing", "season": "previous"}
    gate.set()
    SE.drain_for_tests()
    got = SE.get_season("previous")
    assert got["status"] == "ok" and got["sectors"] == [] and got["total"]["reported"] == 0 and got["total"]["year_ago"] is None
    SE.reset_for_tests()


def test_a_failed_read_is_said_and_a_season_it_does_not_know_is_refused(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    SE.reset_for_tests()
    monkeypatch.setattr(SE, "build", lambda previous=None, **k: (_ for _ in ()).throw(RuntimeError("disk")))
    got = SE.get_season("current")
    assert got["status"] == "failed" and got["reason"] == "error" and got["season"] == "current"
    assert SE.get_season("last")["status"] == "error"
    SE.reset_for_tests()


def test_the_refresh_rule(monkeypatch):
    monkeypatch.setattr(SE, "_today", lambda: TODAY)
    assert SE.REFRESH_S == 1800
    assert SE._due({"today": "2031-11-20"}, time.time() - 60) is False
    assert SE._due({"today": "2031-11-20"}, time.time() - SE.REFRESH_S - 1) is True
    assert SE._due({"today": "2031-11-19"}, time.time() - 60) is True          # another day: the seasons move
    assert SE._valid({"status": "ok", "v": 1, "slices": {sid: {} for sid in C.SEASON_IDS}}) is True
    assert SE._valid({"status": "ok", "v": 1, "slices": {"current": {}}}) is False


# ── what the route gives ─────────────────────────────────────────────────────────────────────

def test_a_season_every_sector_beside_a_year_earlier_and_one_sector_in_full(held):
    cur = SE.get_season("current")
    assert [s["name"] for s in cur["sectors"]] == ["Technology", "Energy", C.NO_SECTOR] and cur["count"] == 3
    tech = cur["sectors"][0]
    assert "reporters" not in tech and "upcoming" not in tech and "late" not in tech
    assert tech["year_ago"]["eps"]["miss"] == 5 and tech["year_ago"]["name"] == "Technology"
    assert cur["sectors"][1]["year_ago"] is None                 # no Energy report a year earlier
    assert cur["total"]["year_ago"]["reported"] == 5 and cur["seasons"]["current"]["label"] == "Q3 2031"
    assert cur["coverage"]["held"] == 8
    prev = SE.get_season("previous")
    assert prev["total"]["year_ago"] is None and all(s["year_ago"] is None for s in prev["sectors"])
    one = SE.get_season("current", "  technology ")
    assert one["found"] is True and one["asked"] == "technology" and one["sector"]["name"] == "Technology"
    assert [r["symbol"] for r in one["sector"]["reporters"]] == ["ZQT4", "ZQT3", "ZQT2", "ZQT1", "ZQT0"]
    assert set(one["sector"]["reporters"][0]) == set(C.ROW_FIELDS)
    assert one["sector"]["year_ago"]["reported"] == 5 and "sectors" not in one
    energy = SE.get_season("current", "Energy")["sector"]
    assert energy["upcoming"] == [{"symbol": "ZQN0", "date": "2031-12-03"}] and energy["late"] == []
    missing = SE.get_season("current", "Utilities")
    assert missing["found"] is False and missing["sector"] is None
    assert len(json.dumps(cur)) < 20000


def _client(user):
    from api.routers import group_stats as route
    app = FastAPI()
    app.include_router(route.router)
    if user is not None:
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app, raise_server_exceptions=False)


def test_the_route_is_paid_and_takes_only_its_words(monkeypatch):
    from api.routers import group_stats as route
    asked = []
    monkeypatch.setattr(SE, "get_season", lambda season, sector: asked.append((season, sector)) or {"status": "ok"})
    path = "/api/research/sector-earnings"
    (r,) = [x for x in route.router.routes if x.path == path]
    assert r.methods == {"GET"} and route.require_paid in {d.call for d in r.dependant.dependencies}
    assert route.require_paid.__module__ == "api.routers.group_stats"
    assert not inspect.iscoroutinefunction(route.get_sector_earnings)
    assert _client(None).get(path).status_code == 401
    refused = _client(FREE_USER).get(path)
    assert refused.status_code == 402 and refused.json() == {"detail": "Group figures require a paid plan"}
    assert asked == []
    paid = _client(PAID_USER)
    assert paid.get(path).json() == {"status": "ok"}
    assert paid.get(path + "?season=year_ago&sector=Consumer%20Cyclical").status_code == 200
    assert paid.get(path + "?season=previous").status_code == 200
    assert asked == [("current", None), ("year_ago", "Consumer Cyclical"), ("previous", None)]
    for bad in ("?season=last", "?season=CURRENT", "?sector=", "?sector=" + "x" * 81):
        assert paid.get(path + bad).status_code == 422
    assert len(asked) == 3
    # the group figures beside it are untouched
    assert any(x.path == "/api/research/group-stats" for x in route.router.routes)
