"""MD-1 kinds of terminal data wave 12: `estimates.history`, `analyst.ratings`, `company.segments`, `stock.failsToDeliver`,
`company.deals` — the Agent half of EEH, ANR, SEG, FTD and of one stock's MNA / IDXC — and the existing `ratings` kind (RTG),
whose adapter now reads only the held rating (MD-1 §4.4 since v1.18).

No network and no real store: every held answer is put where its service keeps it BY the service (the shared cache entry
the ratings and analyst composers answer from, the estimate snapshot store through `estimate_history.snapshot_symbol`, the
SEG / MNA / IDXC holds through their own builds over an invented vendor leg, the FTD store through its own ingest). Every
number, name and date is invented. Pinned per kind: an ok read (envelope conformance, the data's own date as `as_of`, or
null with each part's own read time), a missing number null and never 0, the cut stated and from which end,
`unavailable` kept apart from a healthy answer with each state in its own note, the route's switch respected, a malformed
request refused before any read, a failing reader answered `unavailable`, and THE BUDGET RULE: no read builds, starts a
thread, asks a vendor, registers a symbol, creates a store or writes the shared cache, with the member path's own reader
shown to do exactly that in the same state (so the rail can fail). For all six: registered dark, model-isolated, dormant
until armed one by one. The licensing rows the isolation cites are read from the register. And the contract: MD-1 §4.21
quotes every note these adapters emit.
"""
from __future__ import annotations

import datetime as dt
import inspect
import os
import re
import sqlite3
import threading
from pathlib import Path

import pytest

from api.services import analyst_grades as AG, company_deals_held, estimate_history as EH, estimate_history_held
from api.services import estimate_revisions as ER, ftd_dataset as FTD, ftd_dataset_held, held_build, held_reads
from api.services import index_changes as IC, mergers as MNA, revenue_segments as RS, revenue_segments_held
from api.services import fmp_client as FC, ticker_search_index
from api.services.cache import cache
from api.services.research import analyst_ratings as AR, analyst_ratings_held, ratings as RT_SVC, ratings_held
from api.services.uct_agent import turn as agent_turn
from api.services.uct_agent.marketdata import analyst_ratings_read as arr
from api.services.uct_agent.marketdata import company_deals_read as cdr
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import estimate_history_read as ehr
from api.services.uct_agent.marketdata import ftd_read as ftr
from api.services.uct_agent.marketdata import gateway as gw
from api.services.uct_agent.marketdata import ratings as rtg
from api.services.uct_agent.marketdata import revenue_segments_read as rsr

REPO = Path(__file__).resolve().parents[1]
MODULES = (ehr, arr, rsr, ftr, cdr)
KINDS = tuple(m.KIND for m in MODULES)
#: this wave's isolation defaults (ADR-005): all five new kinds, and `ratings` already was. They are the builder's
#: defaults; a kind leaving this set is an owner decision that has not been made.
ISOLATED = set(KINDS) | {"ratings"}
ACTIONS = {"stock.uctRating", "stock.estimatesHistory", "stock.consensusRating", "stock.revenueSplit", "stock.failsToDeliver",
           "stock.companyDeals"}
DOC = REPO / "docs/agent/program/contracts/MD-1-market-data.md"
REGISTER = REPO / "docs/terminal-research/09-security-licensing-cost/licensing-register.md"
SYM = "QZRT"
_REAL_HELD_CLOSE = arr.held_close                                     # the world fixture stands a close in for it
SNAP = ["2031-02-03", "2031-03-03", "2031-04-03", "2031-04-28", "2031-05-05"]


# ── invented worlds, each held by its own service ─────────────────────────────────────────────────────────────────
def _fmp_seg(fn, sym, period=None):
    rows = [{"symbol": sym, "fiscalYear": 2031, "period": "FY", "date": "2031-01-31", "data": {"Made-up Chips": 600.0, "Made-up Boards": 400.0}},
            {"symbol": sym, "fiscalYear": 2030, "period": "FY", "date": "2030-01-31", "data": {"Made-up Chips": 400.0, "Made-up Boards": 500.0}}]
    if period == "quarter":
        rows = [{"symbol": sym, "fiscalYear": 2031, "period": "Q1", "date": "2031-04-30", "data": {"Made-up Chips": 160.0}},
                {"symbol": sym, "fiscalYear": 2030, "period": "Q1", "date": "2030-04-30", "data": {"Made-up Chips": 100.0}}]
    if fn is not FC.get_revenue_product_segmentation:
        rows = [{"symbol": sym, "fiscalYear": 2031, "period": "FY" if period != "quarter" else "Q1",
                 "date": "2031-01-31" if period != "quarter" else "2031-04-30", "data": {"Northland": 700.0, "Southland": 300.0}}]
    return "ok", rows, None


def _hold_segments(mp, period="annual"):
    mp.setattr(RS, "fmp_leg", _fmp_seg)
    RS.get_segments(SYM, period, wait_s=10)
    RS._held.drain(10)
    assert revenue_segments_held.held_segments(SYM, period)[1] == "held"


def _deal(sym, name, target, day, target_sym=None):
    return {"symbol": sym, "companyName": name, "cik": "1", "targetedCompanyName": target, "targetedSymbol": target_sym,
            "transactionDate": day, "acceptedDate": f"{day} 16:20:38", "link": "https://www.sec.gov/Archives/edgar/data/1/made-up.htm"}


def _fmp_mna(fn, *a, **k):
    from api.services import fmp_client as fc
    if fn is fc.get_mergers_acquisitions_latest:
        return "ok", [_deal("QZOT", "Made-up Other Corp", "Made-up Target LLC", "2031-05-01"),
                      _deal("QZOT", "Made-up Other Corp", "Made-up Rt Inc", "2031-04-10", target_sym=SYM)], None
    return "ok", [_deal(SYM, "Made-up Rt Inc", "Made-up Tiny Co", "2031-03-02"),
                  _deal("QZZZ", "Made-up Unrelated Inc", "Made-up Elsewhere", "2031-02-01")], None


def _fmp_idx(fn, *a, **k):
    from api.services import fmp_client as fc
    if fn is fc.get_historical_sp500_constituents:
        return "ok", [{"symbol": SYM, "addedSecurity": "Made-up Rt Inc", "removedTicker": "QZOLD", "removedSecurity": "Made-up Old Co",
                       "dateAdded": "March 20, 2031", "reason": "Made-up reason words."},
                      {"symbol": "QZNEW", "addedSecurity": "Made-up New Co", "removedTicker": "QZOT", "removedSecurity": "Made-up Other Corp",
                       "dateAdded": "January 9, 2031", "reason": None}], None
    if fn is fc.get_historical_dowjones_constituents:
        return "not_in_plan", None, 403
    return "none", None, None


def _hold_mergers(mp, company=True):
    mp.setattr(MNA, "fmp_leg", _fmp_mna)
    mp.setattr(held_reads, "held_name", lambda s: {SYM: "Made-up Rt Inc"}.get(s))
    mp.setattr(held_reads, "site_universe", lambda: frozenset({SYM, "QZOT"}))
    MNA.get_latest(wait_s=10)                                           # the latest list first: a company build reads it
    MNA._latest.drain(10)
    if company:
        MNA.get_company(SYM, wait_s=10)
        MNA._company.drain(10)


def _hold_index(mp):
    mp.setattr(IC, "fmp_leg", _fmp_idx)
    mp.setattr(held_reads, "site_universe", lambda: frozenset({SYM, "QZOT"}))
    IC.get_changes("all", wait_s=10)
    IC._held.drain(10)


def _fill_estimates(symbols=(SYM,), origin="viewed"):
    for s in symbols:
        assert EH.track(s, origin)
    for i, day in enumerate(SNAP):
        eps = 2.0 + 0.1 * i
        rows = [{"date": "2031-06-30", "epsAvg": eps, "epsLow": eps - 0.2, "epsHigh": eps + 0.3, "revenueAvg": 1.0e9 + 1.0e7 * i,
                 "revenueLow": 9.0e8, "revenueHigh": 1.2e9, "numAnalystsEps": 12, "numAnalystsRevenue": 10},
                {"date": "2031-09-30", "epsAvg": 2.5, "epsLow": None, "epsHigh": None, "revenueAvg": None,
                 "numAnalystsEps": None, "numAnalystsRevenue": None}]
        for s in symbols:
            assert EH.snapshot_symbol(s, day, fetch=lambda _s, _r=rows: ("ok", _r, None)) == "ok"


FTD_FILE = ("SETTLEMENT DATE|CUSIP|SYMBOL|QUANTITY (FAILS)|DESCRIPTION|PRICE\n"
            f"20310303|000000001|{SYM}|120000|MADE-UP RT INC|10.00\n"
            f"20310305|000000001|{SYM}|45000|MADE-UP RT INC|.\n"
            f"20310310|000000001|{SYM}|90000|MADE-UP RT INC|12.50\n"
            "20310310|000000002|QZOT|5000|MADE-UP OTHER CORP|3.00\n"
            "Trailer record count 4\n")


def _ingest_ftd():
    rec = FTD.ingest_file("cnsfails203103a", get=lambda url: FTD_FILE.encode("latin-1"))
    assert rec["state"] == "ok"


RATING = {"sym": SYM, "composite": 82, "components": {"eps": 90, "rs": 77, "growth": 70, "value": 40, "smr": "B", "accdis": "B+",
                                                       "sponsorship": 60},
          "checkup": [{"label": "Made-up check", "status": "pass", "value": 1}], "method": "made-up words", "basis": "percentile",
          "coverage": {"measured_weight": 1.0}, "universe_n": 3700, "sector": "Made-up Sector", "group_rs": 71,
          "price_as_of": "2031-05-02", "complete": True}
GRADES = {"symbol": SYM, "entity": {"status": "resolved"},
          "consensus": {"strongBuy": 3, "buy": 9, "hold": 4, "sell": 1, "strongSell": 0, "total": 17, "label": "Buy",
                        "_meta": {"vendor": "a vendor name never passed on", "sourceObservedAt": 1935763200}},
          "price_target": {"high": 300.0, "low": 150.0, "median": 220.0, "consensus": 230.0,
                           "last_month": {"count": 4, "avg": 240.0}, "last_quarter": {"count": 0, "avg": 210.0},
                           "last_year": {"count": 20, "avg": 205.0}, "_meta": {"sourceObservedAt": 1935849600}},
          "recent_actions": {"items": [{"date": f"2031-05-0{9 - i}", "company": f"Made-up Firm {i}", "action": "upgrade",
                                        "from_grade": "Hold", "to_grade": "Buy"} for i in range(8)], "_meta": None},
          "trend": [], "_outage": False}


# ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────────────────
def _forget():
    for svc in (RS, MNA, IC):
        svc.reset_for_tests()
    for key in (ratings_held.cache_key(SYM), analyst_ratings_held.cache_key(SYM)):
        cache.invalidate(key)


@pytest.fixture(autouse=True)
def world(monkeypatch, tmp_path):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, ",".join([*KINDS, "ratings"]))
    monkeypatch.setenv(gw.ISOLATED_ENV, "1")
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(sorted(ISOLATED)))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv(EH.ENABLED_ENV, "1")
    monkeypatch.setenv("ESTIMATE_HISTORY_DB_PATH", str(tmp_path / "eh.db"))
    monkeypatch.setenv(FTD.ENABLED_ENV, "1")
    monkeypatch.setenv("FTD_DB_PATH", str(tmp_path / "ftd.db"))
    monkeypatch.setattr(ticker_search_index, "is_fund", lambda s: False)
    monkeypatch.setattr(arr, "held_close", lambda s: ("2031-05-08", 200.0) if s == SYM else None)
    _forget()
    gw._reset_for_test(None)
    yield tmp_path
    for svc in (RS._held, MNA._company, MNA._latest, IC._held):
        svc.drain(5)
    _forget()
    gw._reset_for_test(None)


@pytest.fixture
def work(monkeypatch):
    """Counts the work a turn must never cause: every thread started (by name)."""
    seen = {"threads": []}
    real_start = threading.Thread.start

    def start(self):
        seen["threads"].append(self.name)
        return real_start(self)
    monkeypatch.setattr(threading.Thread, "start", start)
    return seen


_turn = iter(range(100_000))


def _read(kind, params=None, purpose="answer"):
    return gw.read(kind, dict(params or {"symbol": SYM}), user_id=1, turn_id=f"w12-{next(_turn)}", purpose=purpose)


def _conforms(out, kind):
    assert env.validate_envelope(out) == [], out
    assert out["kind"] == kind and out["provider_calls"] == 0          # no kind of this wave ever spends a provider call
    if out["status"] in ("ok", "partial"):
        assert out["as_of"] != out["fetched_at"]
        if out["as_of"] is None:
            assert "`as_of` is null" in " ".join(out["notes"])
        assert out["isolated"] is True and out["data"]["isolated"] is True     # ADR-005 L2, stamped by the gateway
    else:
        assert out["data"] is None and out["notes"]


def _plain(v):
    """The data without the gateway's `isolated` stamp (ADR-005 L2 marks every object)."""
    if isinstance(v, dict):
        return {k: _plain(x) for k, x in v.items() if k != "isolated"}
    return [_plain(x) for x in v] if isinstance(v, list) else v


def _unavailable(out, kind, note):
    _conforms(out, kind)
    assert out["status"] == "unavailable" and out["notes"] == [note], out["notes"]


def _made_from(template):
    return re.compile(".+?".join(re.escape(p) for p in re.split(r"\{[\w!r]+\}", template)), re.S)


def _note(out, template):
    hits = [n for n in out["notes"] if _made_from(template).fullmatch(n)]
    assert len(hits) == 1, (template, out["notes"])
    return hits[0]


# ── registration, dark by default, isolation ──────────────────────────────────────────────────────────────────────
def test_the_five_kinds_are_registered_once_by_their_modules_and_with_ratings_all_six_are_isolated():
    r = gw.registry()
    for m in MODULES:
        k = r.get(m.KIND)
        assert k is not None and k.owner == "terminal-data", m.KIND
        assert k.validate is m.validate and k.max_symbols == 1 and k.model_isolated is True and k.freshness == "periodic", m.KIND
        assert "Shown to the member only" in k.description and "never the time of the read" in k.description, m.KIND
        assert "a request" in k.description and "already holds" in k.description, m.KIND
    assert r.get("ratings").model_isolated is True and r.get("ratings").fn is rtg.read_ratings
    assert KINDS == ("estimates.history", "analyst.ratings", "company.segments", "stock.failsToDeliver", "company.deals")
    assert [m.SOURCE for m in MODULES] == ["uct-estimate-history", "uct-analyst-ratings", "uct-revenue-segments",
                                           "sec-fails-to-deliver", "uct-company-deals"]
    assert ACTIONS <= set(agent_turn.LOCAL_ONLY_ACTIONS)
    assert not ACTIONS & set(agent_turn.DATA_READ_ACTIONS)


def test_dark_unless_the_gateway_is_on_and_the_kind_is_named(world, monkeypatch):
    ran = []
    for m in (rtg, ehr, arr, ftr):
        monkeypatch.setattr(m, "held_answer", lambda *a, _m=m: ran.append(_m) or (None, "not_held"))
    monkeypatch.setattr(rsr, "held_answer", lambda *a: ran.append(rsr) or (None, "not_held"))
    monkeypatch.setattr(cdr, "held_answer", lambda *a: ran.append(cdr) or ((None, "not_held"), (None, "not_held")))
    monkeypatch.setenv(gw.KINDS_ENV, "quote,themes,bars.daily,earnings,analyst.actions,stock.stats,estimates.revisionBreadth")
    for kind in (*KINDS, "ratings"):
        out = _read(kind)
        assert out["status"] == "refused" and gw.KINDS_ENV in out["notes"][0], kind
    monkeypatch.setenv(gw.KINDS_ENV, ",".join([*KINDS, "ratings"]))
    monkeypatch.delenv(gw.DATA_ENV)
    for kind in (*KINDS, "ratings"):
        assert _read(kind)["status"] == "refused", kind
    assert ran == []


def test_isolated_kinds_are_dormant_until_armed_by_name_and_answer_the_member_only(world, monkeypatch):
    _ingest_ftd()
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, "")
    for kind in (*KINDS, "ratings"):
        out = _read(kind)
        assert out["status"] == "refused" and out["data"] is None, kind
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ftr.KIND)                 # arming ONE arms one
    assert _read(ftr.KIND)["status"] == "ok"
    for kind in (*KINDS[:3], cdr.KIND, "ratings"):
        assert _read(kind)["status"] == "refused", kind
    for purpose in ("research", "scan"):                                # never for a model's research
        assert _read(ftr.KIND, purpose=purpose)["status"] == "refused"
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(sorted(ISOLATED)))
    assert _read(rsr.KIND)["status"] == "unavailable"                   # armed: read, and nothing is held
    monkeypatch.delenv(gw.ISOLATED_ENV)                                 # the master switch turns all six off
    for kind in (*KINDS, "ratings"):
        assert _read(kind)["status"] == "refused", kind


def test_the_bounds_fields_and_words_are_the_services_own():
    assert arr.MAX_ROWS == AG._MAX_ACTIONS and arr.BUCKETS == ("strongBuy", "buy", "hold", "sell", "strongSell")
    for k in (*arr.BUCKETS, *arr.WINDOWS, *arr.ACTION_FIELDS):
        assert f'"{k}"' in inspect.getsource(AG), k
    assert ehr.METRICS == tuple(ER.METRICS) and ehr.MAX_PERIODS == EH.MAX_PERIODS
    for f in ehr.POINT_FIELDS:
        assert f'"{f}"' in inspect.getsource(EH.history), f
    for f in ehr.MOVE_FIELDS:
        assert f'"{f}"' in inspect.getsource(ER.classify), f
    assert set(ehr.ORIGIN_WORDS) == set(ER.ORIGIN_WORDS)
    assert rsr.PERIODS == RS.PERIODS and rsr.MAX_ROWS == RS.SEGMENT_CAP
    assert set(rsr.LEG_STATES) == {"ok", "none", "not_in_plan", "not_configured", "rate_limited", "failed"}
    for state in rsr.LEG_STATES:
        assert f'"{state}"' in inspect.getsource(RS) + inspect.getsource(held_reads.fmp_leg), state
    for state in ftr.STATES:
        assert f'"{state}"' in inspect.getsource(FTD.series), state
    assert cdr.INDEX_NAMES == IC.INDEX_NAMES
    for s in cdr.SEARCH_WORDS:
        assert s == "not_run" or f'"{s}"' in inspect.getsource(MNA) + inspect.getsource(held_reads.fmp_leg), s
    from api.routers import research as research_router                   # the routes' own fund sentences
    assert ratings_held.FUND_WHY == research_router._RTG_FUND_WHY and analyst_ratings_held.FUND_WHY == research_router._ANR_FUND_WHY
    for fn in (rtg.held_answer, ehr.held_answer, arr.held_answer, _REAL_HELD_CLOSE, rsr.held_answer, ftr.held_answer, cdr.held_answer,
               ratings_held.held_ratings, analyst_ratings_held.held_ratings, estimate_history_held.held_history,
               revenue_segments_held.held_segments, ftd_dataset_held.held_series, company_deals_held.held_mergers,
               company_deals_held.held_index_changes):
        assert "READ ONLY" in fn.__doc__, fn.__qualname__


def test_the_upside_close_is_the_bar_stores_newest_completed_session_read_only(monkeypatch):
    from api.services import bars_sqlite
    asked = []
    monkeypatch.setattr(bars_sqlite, "get_bars_before", lambda sym, tf, n, to: asked.append((sym, tf, n)) or [(20310508, 1.0, 2.0, 0.5, 200.0, 10)])
    assert _REAL_HELD_CLOSE(SYM) == ("2031-05-08", 200.0) and asked == [(SYM, "D", 1)]
    monkeypatch.setattr(bars_sqlite, "get_bars_before", lambda *a: [])
    assert _REAL_HELD_CLOSE(SYM) is None
    monkeypatch.setattr(bars_sqlite, "get_bars_before", lambda *a: [(20310508, 1.0, 2.0, 0.5, 0.0, 10)])
    assert _REAL_HELD_CLOSE(SYM) is None                                 # a close of 0 is no close, never an upside base


# ── ratings (RTG) ─────────────────────────────────────────────────────────────────────────────────────────────────
def test_rating_reads_the_held_record_and_never_works_it_out(world, work, monkeypatch):
    out = _read("ratings")
    _unavailable(out, "ratings", rtg.NOTE_NOT_HELD.format(symbol=SYM))
    cache.set(ratings_held.cache_key(SYM), dict(RATING), 600)
    out = _read("ratings", {"symbol": SYM.lower()})
    _conforms(out, "ratings")
    assert out["status"] == "ok" and out["data"]["composite"] == 82 and out["provider_calls"] == 0 and work["threads"] == []
    monkeypatch.setattr(ticker_search_index, "is_fund", lambda s: True)
    out = _read("ratings")
    assert out["status"] == "unavailable" and out["notes"][0].startswith(f"{SYM} is a fund; the UCT composite rates")
    monkeypatch.setattr(rtg, "held_answer", lambda s: (_ for _ in ()).throw(RuntimeError("an invented failure")))
    _unavailable(_read("ratings"), "ratings", rtg.NOTE_FAILED)


# ── estimates.history (EEH) ───────────────────────────────────────────────────────────────────────────────────────
def test_estimates_read_the_held_snapshots_the_eehsc_rule_per_window_and_the_tracked_origin(world, work):
    _fill_estimates()
    out = _read(ehr.KIND)
    _conforms(out, ehr.KIND)
    d = _plain(out["data"])
    assert out["status"] == "ok" and out["freshness"] == "periodic" and out["as_of"] == "2031-05-05T04:00:00Z"
    assert d["tracked"]["origin"] == "viewed" and d["covers_from"] == SNAP[0] and d["last_snapshot"] == SNAP[-1]
    q = d["periods"][0]
    assert q["period_end"] == "2031-06-30" and q["newest"]["eps_avg"] == pytest.approx(2.4) and q["newest"]["n_eps"] == 12
    assert q["moves"]["eps"]["7"]["state"] == "up" and q["moves"]["eps"]["7"]["from_date"] == SNAP[-2]
    assert q["moves"]["eps"]["90"]["state"] == "up" and q["moves"]["eps"]["90"]["from_date"] == SNAP[0]
    for w in ("7", "30", "90"):                                          # the service's own rule, nothing else
        want = ER.classify([(p["snap_date"], "2031-06-30", p["eps_avg"], p["rev_avg"]) for p in EH.history(SYM, register=False)["periods"][0]["points"]],
                           SNAP[0], SNAP[-1], SNAP[-1], int(w), "eps")
        assert q["moves"]["eps"][w] == {k: want[k] for k in ehr.MOVE_FIELDS}
    later = d["periods"][1]
    assert later["newest"]["rev_avg"] is None and later["moves"]["revenue"]["30"]["state"] == "not_comparable"   # never 0
    _note(out, ehr.NOTE_TRACKED)
    assert ehr.NOTE_YEAR in out["notes"] and ehr.NOTE_LEFT_OUT in out["notes"] and work["threads"] == []


def test_estimates_untracked_tracked_without_snapshots_switched_off_and_no_store(world, monkeypatch):
    _unavailable(_read(ehr.KIND), ehr.KIND, ehr.NOTE_NOT_HELD)          # no store file: never created
    assert not os.path.exists(EH.db_path())
    _fill_estimates(symbols=("QZOT",), origin="sp500")
    _unavailable(_read(ehr.KIND), ehr.KIND, ehr.NOTE_NOT_TRACKED.format(symbol=SYM, cap=EH.MAX_SYMBOLS))
    assert SYM not in EH.tracked()                                      # never registered by the read
    EH.track(SYM, "viewed")
    _unavailable(_read(ehr.KIND), ehr.KIND, ehr.NOTE_COLLECTING.format(symbol=SYM))
    monkeypatch.setenv(EH.ENABLED_ENV, "0")
    _unavailable(_read(ehr.KIND), ehr.KIND, ehr.NOTE_SWITCHED_OFF)
    monkeypatch.setenv(EH.ENABLED_ENV, "1")
    assert _read(ehr.KIND, {"symbol": "not a ticker!"})["status"] == "refused"           # refused before any read
    monkeypatch.setattr(ehr, "held_answer", lambda s: (_ for _ in ()).throw(RuntimeError("an invented failure")))
    _unavailable(_read(ehr.KIND), ehr.KIND, ehr.NOTE_FAILED)


# ── analyst.ratings (ANR) ─────────────────────────────────────────────────────────────────────────────────────────
def test_analysts_read_the_held_record_the_upside_from_the_stored_close_and_the_actions_cut_from_the_old_end(world, work):
    _unavailable(_read(arr.KIND), arr.KIND, arr.NOTE_NOT_HELD.format(symbol=SYM))
    AG.cache.set(analyst_ratings_held.cache_key(SYM), dict(GRADES), 600)
    out = _read(arr.KIND, {"symbol": SYM, "rows": 3})
    _conforms(out, arr.KIND)
    d = _plain(out["data"])
    assert out["status"] == "ok" and out["as_of"] == env.utc_iso(dt.datetime.fromtimestamp(1935849600, tz=dt.timezone.utc))
    assert d["consensus"]["total"] == 17 and d["consensus"]["label"] == "Buy" and "vendor" not in repr(d)
    assert d["price_target"]["last_quarter"] == {"count": 0, "avg": None}                    # nothing counted: no average
    assert d["upside"] == {"target": "consensus", "target_value": 230.0, "close": 200.0, "close_date": "2031-05-08", "pct": 15.0,
                           "basis": "stored_close"}
    assert [a["company"] for a in d["recent_actions"]] == ["Made-up Firm 0", "Made-up Firm 1", "Made-up Firm 2"]
    assert d["actions_total"] == 8
    assert arr.NOTE_CUT.format(total=8, shown=3) in out["notes"] and work["threads"] == []


def test_analysts_no_close_no_coverage_an_outage_a_fund_and_a_failure_are_each_said(world, monkeypatch):
    AG.cache.set(analyst_ratings_held.cache_key(SYM), dict(GRADES), 600)
    monkeypatch.setattr(arr, "held_close", lambda s: None)
    out = _read(arr.KIND)
    assert out["data"]["upside"] is None and arr.NOTE_NO_UPSIDE.format(why=arr.UPSIDE_WHY["no_close"]) in out["notes"]
    AG.cache.set(analyst_ratings_held.cache_key(SYM), {"_miss": True, "_outage": False}, 600)
    out = _read(arr.KIND)
    assert out["status"] == "ok" and out["data"]["covered"] is False and arr.NOTE_NO_COVERAGE.format(symbol=SYM) in out["notes"]
    AG.cache.set(analyst_ratings_held.cache_key(SYM), {"_miss": True, "_outage": True}, 600)
    _unavailable(_read(arr.KIND), arr.KIND, arr.NOTE_FAILED)
    AG.cache.set(analyst_ratings_held.cache_key(SYM), {**GRADES, "_outage": True}, 600)
    assert _read(arr.KIND)["status"] == "partial"
    monkeypatch.setattr(ticker_search_index, "is_fund", lambda s: True)
    out = _read(arr.KIND)
    assert out["status"] == "unavailable" and out["notes"][0].startswith(f"{SYM} is a fund; funds carry no sell-side")


# ── company.segments (SEG) ────────────────────────────────────────────────────────────────────────────────────────
def test_segments_read_each_held_period_with_growth_on_a_year_earlier_and_say_the_one_not_held(world, work, monkeypatch):
    _unavailable(_read(rsr.KIND), rsr.KIND, rsr.NOTE_NOT_HELD.format(symbol=SYM))
    _hold_segments(monkeypatch, "annual")
    work["threads"].clear()
    out = _read(rsr.KIND, {"symbol": SYM, "rows": 1})
    _conforms(out, rsr.KIND)
    sp = _plain(out["data"])["splits"]
    assert out["status"] == "ok" and out["as_of"] == "2031-01-31T05:00:00Z" and sp["quarter"] == {"state": "not_held"}
    seg = sp["annual"]["product"]["latest"]["segments"]
    assert seg == [{"name": "Made-up Chips", "revenue": 600.0, "share": 60.0, "prior": 400.0, "growth_pct": 50.0}]
    assert sp["annual"]["product"]["latest"]["segments_total"] == 2 and sp["annual"]["region"]["prior"] is None
    assert sp["annual"]["region"]["latest"]["segments"][0]["growth_pct"] is None                # no year earlier: never 0
    _note(out, rsr.NOTE_ONE_HELD)
    assert rsr.NOTE_CUT.format(period="annual", leg="product", total=2, shown=1) in out["notes"]
    assert work["threads"] == []
    _hold_segments(monkeypatch, "quarter")
    q = _read(rsr.KIND)["data"]["splits"]["quarter"]["product"]["latest"]["segments"][0]
    assert q["growth_pct"] == 60.0                                       # the quarter a year (365 days) earlier


# ── stock.failsToDeliver (FTD) ────────────────────────────────────────────────────────────────────────────────────
def test_ftd_reads_the_ingested_balances_newest_first_with_the_trend_and_never_a_value_of_0(world, work):
    _ingest_ftd()
    out = _read(ftr.KIND, {"symbol": SYM, "rows": 2})
    _conforms(out, ftr.KIND)
    d = _plain(out["data"])
    assert out["status"] == "ok" and out["freshness"] == "historical" and out["as_of"] == "2031-03-10T04:00:00Z"
    assert d["latest"] == {"settle_date": "2031-03-10", "quantity": 90000, "price": 12.5, "value": 1125000.0}
    assert d["trend"]["change"] == 45000 and d["trend"]["peak"]["quantity"] == 120000 and d["trend"]["latest_vs_peak_pct"] == 75.0
    assert [r["settle_date"] for r in d["rows"]] == ["2031-03-10", "2031-03-05"] and d["rows"][1]["value"] is None
    assert ftr.NOTE_LAG in out["notes"] and ftr.NOTE_CUT.format(total=3, shown=2) in out["notes"]
    assert work["threads"] == []
    out = _read(ftr.KIND, {"symbol": "QZNONE"})
    assert out["status"] == "ok" and out["data"]["latest"] is None and out["as_of"] == "2031-03-10T04:00:00Z"
    _note(out, ftr.NOTE_NONE)


def test_ftd_no_store_switched_off_and_a_failure_and_the_store_is_never_created(world, monkeypatch):
    _unavailable(_read(ftr.KIND), ftr.KIND, ftr.NOTE_NOT_HELD)
    assert not os.path.exists(FTD.db_path())
    with sqlite3.connect(FTD.db_path()) as c:                           # a store with no file ingested yet
        c.executescript(FTD._SCHEMA)
    _unavailable(_read(ftr.KIND), ftr.KIND, ftr.NOTE_NOT_INGESTED.format(symbol=SYM))
    monkeypatch.setenv(FTD.ENABLED_ENV, "")
    _unavailable(_read(ftr.KIND), ftr.KIND, ftr.NOTE_SWITCHED_OFF)


# ── company.deals (MNA + IDXC for one stock) ──────────────────────────────────────────────────────────────────────
def test_deals_read_both_held_parts_and_say_no_record_matched_never_none(world, work, monkeypatch):
    _unavailable(_read(cdr.KIND), cdr.KIND, cdr.NOTE_NOT_HELD.format(symbol=SYM))
    _hold_mergers(monkeypatch)
    _hold_index(monkeypatch)
    work["threads"].clear()
    out = _read(cdr.KIND)
    _conforms(out, cdr.KIND)
    dp, ip = _plain(out["data"])["deals"], _plain(out["data"])["index_changes"]
    assert out["status"] == "ok" and out["as_of"] is None
    assert dp["state"] == "held" and dp["search"] == "ok" and dp["other_companies"] == 1
    assert [(x["date"], x["role"]) for x in dp["deals"]] == [("2031-04-10", "target"), ("2031-03-02", "acquirer")]
    assert [(c["date"], c["index"], c["side"]) for c in ip["changes"]] == [("2031-03-20", "sp500", "added")]
    assert ip["indexes"] == {"sp500": "ok", "nasdaq100": "none", "dow": "not_in_plan"}
    _note(out, cdr.NOTE_LEG)
    assert work["threads"] == []
    out = _read(cdr.KIND, {"symbol": "QZNONE"})
    assert out["data"]["index_changes"]["changes"] == [] and cdr.NOTE_NO_CHANGE.format(symbol="QZNONE") in out["notes"]


def test_deals_with_only_the_latest_list_held_say_the_name_search_was_not_run(world, monkeypatch):
    _hold_mergers(monkeypatch, company=False)
    out = _read(cdr.KIND)
    dp = _plain(out["data"])["deals"]
    assert dp["state"] == "latest_only" and dp["search"] == "not_run" and [x["date"] for x in dp["deals"]] == ["2031-04-10"]
    assert _plain(out["data"])["index_changes"] == {"state": "not_held"}
    _note(out, cdr.NOTE_PART_NOT_HELD)


# ── the budget rule: no read of this wave causes work ─────────────────────────────────────────────────────────────
FORBIDDEN = {
    RT_SVC: ("get_ratings", "_build_ratings", "get_fundamentals", "get_ownership", "fetch_history"),
    AG: ("get_analyst_grades", "_consensus", "_price_target", "_recent_actions", "_trend", "resolve_entity"),
    EH: ("track", "snapshot_symbol", "run_daily", "_fetch_fmp", "_seed_sp500"),
    RS: ("get_segments", "fmp_leg"),
    MNA: ("get_latest", "get_company", "build_latest", "fmp_leg"),
    IC: ("get_changes", "build", "fmp_leg"),
    FTD: ("ingest_file", "run_ingest", "_sec_get"),
    held_build.HeldBuild: ("get", "_start", "_run"),
    held_reads.KeyedHeld: ("get", "_one"),
}


def _forbid(mp, reached):
    for owner, names in FORBIDDEN.items():
        for name in names:
            label = f"{getattr(owner, '__name__', type(owner).__name__)}.{name}"
            mp.setattr(owner, name, lambda *a, _n=label, **kw: reached.append(_n) or (_ for _ in ()).throw(AssertionError(_n)))
    mp.setattr(cache, "set", lambda *a, **kw: reached.append("cache.set") or (_ for _ in ()).throw(AssertionError("cache.set")))


def test_no_read_of_this_wave_builds_starts_a_thread_asks_a_vendor_registers_or_creates_a_store_held_or_not(world, work, monkeypatch):
    """Every entry point that can cause work is replaced by one that fails and counts, named per service: the ratings and
    analyst composers and their vendor legs, the estimate store's writers and job, the SEG / MNA / IDXC routes' readers,
    builds and vendor legs, the FTD ingest and SEC transport, the shared holds' get, start and run, and the cache writer."""
    reached = []
    reads = [(k, {"symbol": SYM}) for k in (*KINDS, "ratings")]
    with pytest.MonkeyPatch.context() as mp:                            # nothing held anywhere
        _forbid(mp, reached)
        for kind, params in reads:
            out = _read(kind, params)
            _conforms(out, kind)
            assert out["status"] == "unavailable", (kind, out["notes"])
        assert reached == [] and work["threads"] == []
    assert not os.path.exists(EH.db_path()) and not os.path.exists(FTD.db_path())
    cache.set(ratings_held.cache_key(SYM), dict(RATING), 600)
    AG.cache.set(analyst_ratings_held.cache_key(SYM), dict(GRADES), 600)
    _fill_estimates()
    _hold_segments(monkeypatch)
    _hold_mergers(monkeypatch)
    _hold_index(monkeypatch)
    _ingest_ftd()
    tracked = EH.tracked()
    work["threads"].clear()
    with pytest.MonkeyPatch.context() as mp:                            # everything held
        _forbid(mp, reached)
        for kind, params in reads:
            out = _read(kind, params)
            _conforms(out, kind)
            assert out["status"] in ("ok", "partial"), (kind, out["notes"])
        assert reached == [] and work["threads"] == []
    assert EH.tracked() == tracked


def test_the_member_paths_own_readers_do_that_work_in_the_same_state_so_the_rail_can_fail(world, monkeypatch, tmp_path):
    """The contrast: where the adapter answers from what is held, the reader the member path uses does the work."""
    asked = []
    monkeypatch.setattr(RT_SVC, "resolve_entity", lambda s, **k: (None, s))
    monkeypatch.setattr(RT_SVC, "get_fundamentals", lambda s: asked.append(("fundamentals", s)) or {})
    monkeypatch.setattr(RT_SVC, "get_ownership", lambda s: asked.append(("ownership", s)) or {})
    monkeypatch.setattr(RT_SVC, "fetch_history", lambda s, **k: asked.append(("history", s)) or None)
    assert _read("ratings")["status"] == "unavailable" and asked == []
    RT_SVC.get_ratings(SYM)
    assert {a[0] for a in asked} == {"fundamentals", "ownership", "history"}
    asked.clear()
    monkeypatch.setattr(AG, "resolve_entity", lambda s, **k: (None, s))
    for leg, v in (("_consensus", None), ("_price_target", None), ("_recent_actions", {"items": [], "_meta": None}), ("_trend", [])):
        monkeypatch.setattr(AG, leg, lambda s, _l=leg, _v=v: asked.append(_l) or _v)
    assert _read(arr.KIND)["status"] == "unavailable" and asked == []
    AG.get_analyst_grades(SYM)
    assert sorted(asked) == ["_consensus", "_price_target", "_recent_actions", "_trend"]
    _fill_estimates(symbols=("QZOT",), origin="sp500")
    assert _read(ehr.KIND)["status"] == "unavailable" and SYM not in EH.tracked()
    EH.history(SYM)                                                      # the route's reader registers the stock
    assert SYM in EH.tracked()
    started = []
    real_start = threading.Thread.start
    monkeypatch.setattr(threading.Thread, "start", lambda self: started.append(self.name) or real_start(self))
    monkeypatch.setattr(RS, "fmp_leg", _fmp_seg)
    assert _read(rsr.KIND)["status"] == "unavailable" and started == []
    RS.get_segments(SYM, "annual", wait_s=10)
    RS._held.drain(10)
    assert started == [f"revenue-segments-{(SYM, 'annual')}-build"]
    started.clear()
    monkeypatch.setattr(MNA, "fmp_leg", _fmp_mna)
    monkeypatch.setattr(IC, "fmp_leg", _fmp_idx)
    assert _read(cdr.KIND)["status"] == "unavailable" and started == []
    MNA.get_company(SYM, wait_s=10)
    IC.get_changes("all", SYM, wait_s=10)
    for h in (MNA._latest, MNA._company, IC._held):
        h.drain(10)
    assert {"mergers-latest-build", f"mergers-company-{SYM}-build", "index-changes-build"} <= set(started)
    monkeypatch.setenv("FTD_DB_PATH", str(tmp_path / "other" / "ftd.db"))
    assert _read(ftr.KIND)["status"] == "unavailable" and not os.path.exists(FTD.db_path())
    FTD.series(SYM)                                                      # the route's reader creates the store
    assert os.path.exists(FTD.db_path())


# ── the held readers give the routes' own answers ─────────────────────────────────────────────────────────────────
def test_each_held_reader_gives_the_routes_own_answer_once_held_and_nothing_before(world, monkeypatch):
    assert revenue_segments_held.held_segments(SYM, "annual") == (None, "not_held")
    _hold_segments(monkeypatch)
    assert revenue_segments_held.held_segments(SYM, "annual")[0] == RS.get_segments(SYM, "annual")
    assert revenue_segments_held.held_segments(SYM, "weekly") == (None, "not_held")
    assert company_deals_held.held_mergers(SYM) == (None, "not_held")
    assert company_deals_held.held_index_changes(SYM) == (None, "not_held")
    _hold_mergers(monkeypatch)
    _hold_index(monkeypatch)
    assert company_deals_held.held_mergers(SYM)[0] == MNA.get_company(SYM)
    assert company_deals_held.held_index_changes(SYM)[0] == IC.get_changes("all", SYM)
    assert estimate_history_held.held_history(SYM) == (None, "not_held")
    _fill_estimates()
    got, how = estimate_history_held.held_history(SYM)
    route = EH.history(SYM, register=False)
    assert how == "held" and got["periods"] == route["periods"] and got["tracked_origin"] == "viewed"
    assert got["store_newest"] == SNAP[-1] and "tracked" not in got
    assert ftd_dataset_held.held_series(SYM) == (None, "not_held")
    _ingest_ftd()
    assert ftd_dataset_held.held_series(SYM)[0] == FTD.series(SYM)
    monkeypatch.setattr(RT_SVC, "resolve_entity", lambda s, **k: (None, s))
    monkeypatch.setattr(RT_SVC, "get_fundamentals", lambda s: {})
    monkeypatch.setattr(RT_SVC, "get_ownership", lambda s: {})
    monkeypatch.setattr(RT_SVC, "fetch_history", lambda s, **k: None)
    assert ratings_held.held_ratings(SYM) == (None, "not_held")
    served = RT_SVC.get_ratings(SYM)
    assert ratings_held.held_ratings(SYM) == (served, "held")
    monkeypatch.setattr(AG, "resolve_entity", lambda s, **k: (None, s))
    monkeypatch.setattr(AR, "resolve_entity", lambda s, **k: (None, s))
    monkeypatch.setattr(AG, "_consensus", lambda s: {**GRADES["consensus"]})
    for leg, v in (("_price_target", None), ("_recent_actions", {"items": [], "_meta": None}), ("_trend", [])):
        monkeypatch.setattr(AG, leg, lambda s, _v=v: _v)
    assert analyst_ratings_held.held_ratings(SYM) == (None, "not_held")
    route = AR.get_analyst_ratings(SYM)
    got = analyst_ratings_held.held_ratings(SYM)[0]
    assert {k: route[k] for k in ("consensus", "price_target", "recent_actions", "outage")} == {k: got[k] for k in ("consensus", "price_target", "recent_actions", "outage")}


# ── the licensing record the isolation rests on ───────────────────────────────────────────────────────────────────
def test_the_licensing_register_rows_the_isolation_cites_say_what_the_adapters_say_they_say():
    register = REGISTER.read_text(encoding="utf-8")
    row = lambda r: next(ln for ln in register.splitlines() if ln.startswith(f"| {r} |"))      # noqa: E731
    assert row("T-04").startswith("| T-04 | Member display — D/W/M history") and "| **R** |" in row("T-04")
    assert row("T-14").startswith("| T-14 | AI processing — Massive numbers into Claude") and "| **R** |" in row("T-14")
    assert row("T-33").startswith("| T-33 | Member display — statements, fundamentals, ratios") and "| **R** |" in row("T-33")
    assert row("T-34").startswith("| T-34 | Member display — analyst estimates, grades, price targets, consensus") and "| **R** |" in row("T-34")
    assert row("T-39").startswith("| T-39 | Member display — ETF holdings, index constituents") and "| **R** |" in row("T-39")
    assert row("T-44").startswith("| T-44 | AI processing — FMP numbers (fundamentals, analyst, earnings)") and "No AI clause" in row("T-44")
    assert row("T-83").startswith("| T-83 | All seven uses — SEC EDGAR filings") and "| **A** |" in row("T-83")
    rows = [ln for ln in register.splitlines() if re.match(r"\| [TN]-\d+ \|", ln)]
    for words in ("segment", "mergers", "fails to deliver", "cnsfails", "historical-sp500"):
        assert not [ln for ln in rows if words in ln.lower()], words                   # no row names these data sets
    # the one mention of the fails-to-deliver store: T-104 reads it as a CUSIP-to-symbol input to the N-PORT index, and
    # governs nothing about showing it (or a model lane for it)
    assert [ln[:7] for ln in rows if "fails-to-deliver" in ln.lower()] == ["| T-104"]
    assert "the SEC fails-to-deliver store already on the server when present (CUSIP and symbol pairs)" in row("T-104")
    cites = {ehr: ("T-34", "T-44"), arr: ("T-34", "T-44", "T-04", "T-14"), rsr: ("T-33", "T-44"), ftr: ("T-83", "T-104"),
             cdr: ("T-39", "T-44", "T-83")}
    for m, cited in cites.items():                                     # each adapter says which rows, and claims no more
        doc = " ".join(m.__doc__.split())
        assert "licensing-register.md" in doc and "MODEL-ISOLATED (ADR-005; when in doubt, isolate)" in doc, m.KIND
        assert set(re.findall(r"T-\d+", doc)) == set(cited), m.KIND
        assert "for a model provider" in doc and "Shown to the member only; the capability is local-only." in doc, m.KIND


# ── the contract (MD-1 v1.18 §4.21, and §4.4 for ratings) ─────────────────────────────────────────────────────────
def test_the_contract_doc_states_section_4_21_and_every_note_the_adapters_emit():
    """MD-1 §4.21 quotes each note verbatim; QA pins fixtures to the doc, so the two must not drift."""
    doc = DOC.read_text(encoding="utf-8").replace("\r\n", "\n")
    head = ("### 4.21 Terminal data wave 12: `estimates.history`, `analyst.ratings`, `company.segments`, "
            "`stock.failsToDeliver`, `company.deals`, and the first capability over `ratings` (v1.18, terminal-data)")
    assert head in doc
    section = doc[doc.index(head):doc.index("## 8. Changing this contract")]
    for m in (*MODULES, rtg):
        notes = {k: v for k, v in vars(m).items() if k.startswith("NOTE_")}
        assert notes, m.__name__
        where = section if m is not rtg else doc
        for name, text in notes.items():
            assert text in where, f"{m.__name__} {name}"
    for m in MODULES:
        assert f"`{m.KIND}`" in section and f"`{m.SOURCE}`" in section and f"| `{m.KIND}` |" in section, m.KIND
    for words in [*arr.UPSIDE_WHY.values(), *ehr.ORIGIN_WORDS.values(), *rsr.LEG_WORDS.values(), *cdr.SEARCH_WORDS.values(),
                  *cdr.LEG_WORDS.values()]:
        assert words in section, words
    prose = " ".join(section.split())
    for s in ("UCT_AGENT_DATA_KINDS", "UCT_AGENT_ISOLATED_KINDS", "turn.LOCAL_ONLY_ACTIONS", "**Status: dark, not armed.**",
              "**No read of this section starts a build or a request.**", "`ratings_held.held_ratings`",
              "`analyst_ratings_held.held_ratings`", "`estimate_history_held.held_history`", "`revenue_segments_held.held_segments`",
              "`ftd_dataset_held.held_series`", "`company_deals_held.held_mergers`", "`company_deals_held.held_index_changes`",
              "`estimate_revisions.classify`", "ESTIMATE_HISTORY_ENABLED", "FTD_DATASET_ENABLED", "row T-04", "row T-14", "row T-33",
              "row T-34", "row T-39", "row T-44", "row T-83", "for a model provider", "never the time of the read",
              "the builder's default", "`stockResearch`", "54th", "PEER", "no record matched"):
        assert s in prose, s
    assert doc.index("### 4.20 Terminal data wave 11") < doc.index(head) < doc.index("## 8. Changing this contract")
    s44 = doc[doc.index("### 4.4 Model-isolated kinds"):doc.index("### 4.5 ")]
    assert "`provider_calls` 0" in s44 and "`ratings_held.held_ratings`" in s44 and "v1.18" in s44
    title = re.match(r"# MD-1 — UCT market-data contract \(v1\.(\d+)\)", doc)
    assert title and int(title.group(1)) >= 18
    entry = next(line for line in doc.splitlines() if line.startswith("- **v1.18 addition (2026-11-24, terminal-data, data wave 12):**"))
    assert "owed by a person" in entry and "acknowledged by the owner" not in entry      # §8.1: no acknowledgement is claimed
    assert "has not been sent" in entry and "not acknowledged by anyone" in entry
    assert "**Not armed:**" in entry and "Nothing in this entry or in §4.21 records an owner decision." in entry
    assert doc.index(entry) < doc.index("- **v1.17 addition (2026-11-23, terminal-data, data wave 11):**")
    status = next(line for line in doc.splitlines() if line.startswith("- **Status:** v1."))
    owed = re.search(r"the §8\.1 notices for ([^;)]*?) are owed by a person and are not acknowledged", status)
    assert owed and all(v in owed.group(1) for v in ("v1.16", "v1.17", "v1.18"))
    for text in (section, entry):
        for claim in ("owner approved", "owner asked", "owner decided", "approved by the owner", "will be armed", "the owner will",
                      "owner wants", "owner ruled"):
            assert claim not in text, claim
