"""MD-1 kinds of terminal data wave 14: `options.straddleHistory`, `options.positioning`, `filings.feed`, `congress.trades`,
`market.deals`, `market.setupStudy`, `market.periodChange` — the Agent half of OHIS, POS, FEED, CONG, the bare MNA / IDXC,
the bare SETH and PCHG for any two dates (MD-1 §4.23).

No network and no real store: every held answer is put where its service keeps it BY the service where the service has a
build that can run offline (the options log through tests/test_iv_history.py's `Seed`; POS through `positioning.max_pain` /
`levels` over the fixture chain; the filings feed through `_refresh` over an invented SEC answer; congressional trades
through `latest` / `for_symbol` over invented vendor rows; MNA / IDXC through their own builds over invented vendor rows;
PCHG through `_period_remember`), and the SETH study as its hold keeps a finished build. Every number, name and date is
invented. Pinned per kind: an ok read, `unavailable` (never "none") when nothing is held, the route's switch respected, a
malformed request refused before any read, the cut stated, and THE BUDGET RULE: no read builds, reads a chain, asks the SEC
or a vendor, queues a read, lists or downloads the options log, or starts a thread, with the member path's own reader shown
to do that work in the same state. Registered dark, model-isolated, dormant until armed one by one; the register rows the
isolation cites; and MD-1 §4.23 quotes every note.
"""
from __future__ import annotations

import asyncio
import json
import re
import threading
import time
import types
from pathlib import Path

import pytest

from api.services import congress_trades as CT, filings_feed as FF, filings_feed_held, index_changes as IC
from api.services import mergers as MNA, scan_period as SP, setup_history as SH
from api.services.cache import cache
from api.services.options_analytics import positioning as POS
from api.services.research import iv_history as IVH
from api.services.uct_agent import turn as agent_turn
from api.services.uct_agent.marketdata import congress_read as cgr
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import filings_feed_read as ffr
from api.services.uct_agent.marketdata import gateway as gw
from api.services.uct_agent.marketdata import market_deals_read as mdr
from api.services.uct_agent.marketdata import options_positioning_read as opr
from api.services.uct_agent.marketdata import period_change_read as pcr
from api.services.uct_agent.marketdata import setup_study_read as ssr
from api.services.uct_agent.marketdata import straddle_history_read as shr

REPO = Path(__file__).resolve().parents[1]
MODULES = (shr, opr, ffr, cgr, mdr, ssr, pcr)
KINDS = tuple(m.KIND for m in MODULES)
ISOLATED = set(KINDS)          # the builder's defaults (ADR-005); a kind leaving this set is a decision not made here
ACTIONS = {"stock.straddleHistory", "stock.optionsPositioning", "stock.edgarFeed", "stock.congressTrades", "stock.dealsMarket",
           "stock.setupStudy", "stock.periodChange"}
DOC = REPO / "docs/agent/program/contracts/MD-1-market-data.md"
REGISTER = REPO / "docs/terminal-research/09-security-licensing-cost/licensing-register.md"
SWITCHES = ("OPTIONS_STRADDLE_HISTORY_ENABLED", "OPTIONS_DAILY_MOVE_ENABLED", "OPTIONS_MAX_PAIN_ENABLED",
            "OPTIONS_POSITIONING_VOCAB_ENABLED", "FILINGS_FEED_ENABLED", "CONGRESS_TRADES_ENABLED")
PARAMS = {"options.straddleHistory": {"symbol": "QZOP"}, "options.positioning": {"symbol": "TST"},
          "filings.feed": {"symbol": None}, "congress.trades": {"symbol": None}, "market.deals": {},
          "market.setupStudy": {}, "market.periodChange": {"start": "2031-01-02", "end": "2031-03-03"}}


def _forget():
    POS.clear_cache()
    for k in ("congress_trades_latest", "congress_trades::QZCG", FF._MARKET_KEY, FF._TICKER_PREFIX + "QZFL"):
        cache.invalidate(k)
    MNA._latest.reset()
    IC._held.reset()
    SH._STUDY.reset()
    with SP._period_done_lock:
        SP._period_done.clear()
        SP._period_old.clear()
    with SP._period_inflight_lock:
        SP._period_inflight.clear()
    cache.invalidate("scan_period_20310102_20310303")


@pytest.fixture(autouse=True)
def world(monkeypatch, tmp_path):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(KINDS))
    monkeypatch.setenv(gw.ISOLATED_ENV, "1")
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(sorted(ISOLATED)))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    for s in SWITCHES:
        monkeypatch.setenv(s, "1")
    from tests.test_iv_history import Seed
    seed = Seed(tmp_path / "log")
    monkeypatch.setattr(IVH, "_store_override", seed.store)
    IVH._ROW_CACHE.clear()
    _forget()
    gw._reset_for_test(None)
    yield seed
    _forget()
    gw._reset_for_test(None)


_turn = iter(range(100_000))


def _read(kind, params=None, purpose="answer"):
    p = dict(PARAMS[kind]) if params is None else dict(params)
    return gw.read(kind, p, user_id=1, turn_id=f"w14-{next(_turn)}", purpose=purpose)


def _conforms(out, kind):
    assert env.validate_envelope(out) == [], out
    assert out["kind"] == kind and out["provider_calls"] == 0
    if out["status"] in ("ok", "partial"):
        if out["as_of"] is None:
            assert "`as_of` is null" in " ".join(out["notes"])
        assert out["isolated"] is True and out["data"]["isolated"] is True
    else:
        assert out["data"] is None and out["notes"]


def _unavailable(out, kind, note):
    _conforms(out, kind)
    assert out["status"] == "unavailable" and out["notes"] == [note], out["notes"]


# ── invented worlds, each held by its own service ─────────────────────────────────────────────────────────────────
def _hold_log(seed, sym="QZOP", n=4):
    from tests.test_iv_history import row
    from tests.test_options_log_history import sessions_from
    days = sessions_from("2031-03-03", n)
    for i, d in enumerate(days):
        seed.day(d, [row(sym, 0.3 + i / 100, px=100.0 + i, straddle=5.0 + i, fexp="2031-04-17", fdte=30 - i)])
    return days


def _pos_stubs(monkeypatch):
    from tests.test_options_positioning import CHAIN, GEX
    calls = {"chain": 0}

    async def fetch(sym, f, t):
        calls["chain"] += 1
        return json.loads(json.dumps(CHAIN)), None, "massive"

    async def gex(sym, dte="all", adjusted=False, source=None):
        return dict(GEX)
    from api import gex_service
    monkeypatch.setattr(POS, "_fetch", fetch)
    monkeypatch.setattr(POS, "_atm", lambda s: {"iv": 0.252, "strike": 100.0, "expiration": "2031-04-17", "spot": 100.0})
    monkeypatch.setattr(gex_service, "get_gex_data", gex)
    return calls


def _hold_pos(monkeypatch):
    calls = _pos_stubs(monkeypatch)
    asyncio.run(POS.max_pain("TST", "month"))
    asyncio.run(POS.levels("TST", "month"))
    return calls


def _filing(acc, form="8-K", day="2031-06-02"):
    return {"form": form, "filingDate": day, "acceptanceDateTime": f"{day}T16:05:00.000Z", "accessionNumber": acc,
            "items": "2.02,9.01" if form == "8-K" else "", "primaryDocument": "x.htm", "reportDate": day}


def _hold_filings(monkeypatch):
    sub = {"name": "Made-up Filer Inc", "filings": {"recent": {}}}
    rows = [_filing("0009900001-31-000001"), _filing("0009900001-31-000002", "10-Q", "2031-05-01")]
    for k in rows[0]:
        sub["filings"]["recent"][k] = [r[k] for r in rows]
    monkeypatch.setattr(FF, "_load_tickers", lambda force=False: True)
    monkeypatch.setitem(FF._tickers, "by_ticker", {"QZFL": 9900001})
    monkeypatch.setitem(FF._tickers, "by_cik", {9900001: "QZFL"})
    monkeypatch.setattr(FF, "_sec_get", lambda url: json.dumps(sub).encode())
    FF._refresh("QZFL")
    mrow = FF._row(form="4", company="Made-up Filer Inc", cik=9900002, accession="0009900002-31-000009", filed="2031-06-03",
                   accepted="2031-06-03T17:00:00-04:00", items=[], source=FF.SOURCE_FEED, ticker="QZMK")
    cache.set(FF._MARKET_KEY, {"rows": [mrow], "forms": {"4": {"state": "ok", "at": time.time(), "n": 1}},
                               "polled_at": time.time(), "poll_minutes": FF.POLL_MINUTES}, 3600)


def _cg_row(sym, last, kind="Purchase", disclosed="2031-06-01", traded="2031-05-10"):
    return {"firstName": "Made-up", "lastName": last, "office": "Made-up Office", "symbol": sym, "type": kind,
            "amount": "$1,001 - $15,000", "transactionDate": traded, "disclosureDate": disclosed, "owner": "Self",
            "assetDescription": f"{sym} common", "link": "https://example.invalid/x"}


def _hold_congress(monkeypatch, sym="QZCG"):
    res = lambda rows: types.SimpleNamespace(value=rows, degraded=None)   # noqa: E731
    monkeypatch.setattr(CT, "_fetchers_latest", lambda: {"senate": lambda *a, **k: res([_cg_row("QZCG", "Senator")]),
                                                         "house": lambda *a, **k: res([_cg_row("QZCH", "Member", "Sale")])})
    monkeypatch.setattr(CT, "_fetchers_for_symbol", lambda: {"senate": lambda *a, **k: res([_cg_row(sym, "Senator")]),
                                                             "house": lambda *a, **k: (_ for _ in ()).throw(RuntimeError("down"))})
    CT.latest()
    CT.for_symbol(sym)


def _hold_deals(monkeypatch):
    from api.services import fmp_client as fc
    res = lambda rows: types.SimpleNamespace(value=rows, degraded=None)   # noqa: E731
    monkeypatch.setattr(fc, "get_mergers_acquisitions_latest", lambda page=0, limit=100: res([
        {"symbol": "QZAQ", "companyName": "Made-up Acquirer", "cik": "1", "targetedCompanyName": "Made-up Target",
         "transactionDate": "2031-06-02", "acceptedDate": "2031-06-02 16:00:00", "link": "https://www.sec.gov/x"}]) if page == 0 else res([]))
    rows = [{"symbol": "QZAD", "addedSecurity": "Made-up Added", "removedTicker": "QZRM", "removedSecurity": "Made-up Gone",
             "reason": "Made-up reason", "dateAdded": "June 1, 2031", "date": "2031-06-01"}]
    for fn in ("get_historical_sp500_constituents", "get_historical_nasdaq_constituents", "get_historical_dowjones_constituents"):
        monkeypatch.setattr(fc, fn, lambda rows=rows: res(rows))
    for hold, build in ((MNA._latest, MNA.build_latest), (IC._held, IC.build)):
        answer, _note = build(None)
        with hold._lock:
            hold._state.update(held=answer, loaded=True, checked=time.time())


def _study():
    hz = lambda n, below=False: {"n": n, "below_floor": below, "strategy": {"n": n, "win_rate": 55.0, "avg_pct": 2.1,   # noqa: E731
                                 "median_pct": 1.4}, "baseline": {"n": 900, "win_rate": 51.0, "avg_pct": 0.9}, "same_day": {}}
    groups = [{"phase": p, "words": f"made-up {p}", "signals": 40,
               "horizons": {"5": hz(40), "20": hz(40), "60": hz(12, True)}} for p in ("correction", "after_low", "uptrend", "all")]
    return {"status": "ok", "built_for": "2031-W22", "built_at": "2031-06-01T02:00:00+00:00", "session": "2031-05-29",
            "data_through": "2031-05-29", "library": SH.library_version(),
            "window": {"from": "2023-05-29", "to": "2031-05-29", "first_day": "2023-05-30", "years": 8},
            "source": SH.SOURCE, "universe": {"name": SH.UNIVERSE_NAME, "symbols_read": 3},
            "method": {"phase": SH.HINDSIGHT}, "phases": {"index": "S&P 500", "episodes": 2}, "min_signals": 30,
            "setups": [{"id": "qz_break", "name": "Made-up breakout", "words": "made-up", "state": "ok", "signals": 120,
                        "groups": groups},
                       {"id": "qz_pivot", "name": "Made-up pivot", "state": "capped", "groups": [], "detail": "made-up cap"}]}


def _hold_study():
    with SH._STUDY._lock:
        SH._STUDY._state.update(held=_study(), loaded=True, checked=time.time())


def _hold_period(n=30):
    res = [{"sym": f"QZ{i:02d}", "period_change": float(i - 10), "net_change": float(i - 10), "start_close": 100.0,
            "end_close": 100.0 + i - 10, "price": 100.0 + i - 10, "sector": "Made-up", "industry": None} for i in range(n)]
    SP._period_remember("scan_period_20310102_20310303", {"status": "ok", "results": res, "count": n, "start": 20310102,
                                                           "end": 20310303, "as_of": "2031-03-03T17:00:00-05:00",
                                                           "partial": False}, 300)


# ── registration, dark by default, isolation ──────────────────────────────────────────────────────────────────────
def test_the_seven_kinds_are_registered_once_by_their_modules_and_all_seven_are_isolated():
    r = gw.registry()
    fns = {shr: shr.read_straddle_history, opr: opr.read_positioning, ffr: ffr.read_filings, cgr: cgr.read_congress,
           mdr: mdr.read_market_deals, ssr: ssr.read_setup_study, pcr: pcr.read_period_change}
    for m, fn in fns.items():
        k = r.get(m.KIND)
        assert k is not None and k.owner == "terminal-data" and k.fn is fn and k.validate is m.validate, m.KIND
        assert k.model_isolated is True and k.freshness == "periodic", m.KIND
        assert "Shown to the member only" in k.description and "never the time of the read" in k.description, m.KIND
        assert "already holds" in k.description and "never" in k.description, m.KIND
    assert [r.get(k).max_symbols for k in KINDS] == [1, 1, 1, 1, 0, 0, 0]
    assert KINDS == ("options.straddleHistory", "options.positioning", "filings.feed", "congress.trades", "market.deals",
                     "market.setupStudy", "market.periodChange")
    assert ACTIONS <= set(agent_turn.LOCAL_ONLY_ACTIONS) and not ACTIONS & set(agent_turn.DATA_READ_ACTIONS)


def test_dark_unless_the_gateway_is_on_and_the_kind_is_named_and_dormant_until_armed_by_name(world, monkeypatch):
    ran = []
    for m in MODULES:
        monkeypatch.setattr(m, "held_answer", lambda *a, _m=m: ran.append(_m) or None)
    monkeypatch.setenv(gw.KINDS_ENV, "quote,themes,company.deals,stock.setupHistory,group.drill")
    for kind in KINDS:
        out = _read(kind)
        assert out["status"] == "refused" and gw.KINDS_ENV in out["notes"][0], kind
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(KINDS))
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, "")
    for kind in KINDS:
        assert _read(kind)["status"] == "refused", kind
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(sorted(ISOLATED)))
    for kind in KINDS:
        for purpose in ("research", "scan"):
            assert _read(kind, purpose=purpose)["status"] == "refused", (kind, purpose)
    monkeypatch.delenv(gw.ISOLATED_ENV)
    for kind in KINDS:
        assert _read(kind)["status"] == "refused", kind
    assert ran == []


@pytest.mark.parametrize("kind,bad", [
    ("options.straddleHistory", {"symbol": "not a ticker"}), ("options.straddleHistory", {"symbol": "QZOP", "rows": 0}),
    ("options.positioning", {"symbol": "TST", "window": "year"}), ("filings.feed", {"symbol": None, "form": "13F"}),
    ("filings.feed", {"symbol": None, "rows": 61}), ("congress.trades", {"symbol": "??"}),
    ("market.deals", {"part": "ipos"}), ("market.deals", {"index": "russell"}), ("market.setupStudy", {"phase": "bull"}),
    ("market.periodChange", {"start": "2031-03-03", "end": "2031-01-02"}),
    ("market.periodChange", {"start": "1989-01-03", "end": "2031-01-02"}),
    ("market.periodChange", {"start": "2031-02-30", "end": "2031-03-03"}),
])
def test_a_malformed_request_is_refused_before_any_read(world, monkeypatch, kind, bad):
    m = next(m for m in MODULES if m.KIND == kind)
    monkeypatch.setattr(m, "held_answer", lambda *a: (_ for _ in ()).throw(AssertionError("read")))
    out = _read(kind, bad)
    assert out["status"] == "refused" and out["data"] is None, out


def test_the_bounds_and_names_are_the_services_own():
    assert shr.SWITCHES == {"straddle": "OPTIONS_STRADDLE_HISTORY_ENABLED", "daily_move": "OPTIONS_DAILY_MOVE_ENABLED"}
    assert opr.WINDOWS == tuple(POS.DTE_WINDOWS) and opr.DEFAULT_WINDOW == "month"
    assert ffr.FORMS == FF.FEED_FORMS and cgr.CHAMBERS == CT.CHAMBERS and mdr.INDEXES == IC.INDEXES
    assert ssr.HORIZONS == tuple(str(h) for h in __import__("api.services.setup_history_calc", fromlist=["x"]).HORIZONS)
    from api.services import setup_history_calc as SHC
    assert ssr.PHASES == SHC.GROUPS
    app_model = (REPO / "app/src/pages/terminal/panels/periodChangeModel.js").read_text(encoding="utf-8")
    assert f"export const PERIOD_FLOOR = '{pcr.FLOOR}'" in app_model
    for fn in (filings_feed_held.held_market, filings_feed_held.held_ticker, *(m.held_answer for m in MODULES)):
        assert "READ ONLY" in fn.__doc__, fn.__qualname__


# ── one kind at a time ────────────────────────────────────────────────────────────────────────────────────────────
def test_straddle_history_reads_the_log_on_disk_newest_first_each_part_with_its_state(world, monkeypatch):
    _unavailable(_read(shr.KIND), shr.KIND, shr.NOTE_NOT_HELD)
    days = _hold_log(world)
    out = _read(shr.KIND, {"symbol": "QZOP", "rows": 2})
    _conforms(out, shr.KIND)
    d = out["data"]
    assert out["status"] == "ok" and d["straddle"]["state"] == "held" and d["as_of"] == days[-1]
    assert [r["date"] for r in d["straddle"]["rows"]] == days[::-1][:2] and d["straddle"]["cut"] is True
    assert d["straddle"]["rows"][0]["straddle"] == 8.0 and d["daily_move"]["state"] == "held"
    assert d["daily_move"]["summary"] is None and d["daily_move"]["summary_note"]           # below its minimum: a sentence
    assert out["as_of"].startswith(days[-1][:7])
    _unavailable(_read(shr.KIND, {"symbol": "QZNO"}), shr.KIND, shr.NOTE_NOT_IN_LOG.format(sessions=4, symbol="QZNO"))
    monkeypatch.setenv("OPTIONS_DAILY_MOVE_ENABLED", "0")
    one = _read(shr.KIND)
    assert one["data"]["daily_move"]["state"] == "off" and one["data"]["straddle"]["state"] == "held"
    monkeypatch.setenv("OPTIONS_STRADDLE_HISTORY_ENABLED", "0")
    _unavailable(_read(shr.KIND), shr.KIND, shr.NOTE_BOTH_OFF)


def test_straddle_history_never_lists_or_downloads_from_the_production_store(world, monkeypatch):
    _hold_log(world)

    class Remote:                             # the production store's shape: a root on disk, and remote reads that must not run
        root = world.root

        def sessions(self):
            raise AssertionError("listed the remote log")

        def listing(self, **k):
            raise AssertionError("listed the remote log")
    monkeypatch.setattr(IVH, "_store_override", Remote())
    assert _read(shr.KIND)["status"] == "ok"
    from api.services.options_analytics import log_history
    with pytest.raises(AssertionError):                                       # the route's own read lists it
        log_history.straddle_history("QZOP")


def test_positioning_reads_only_the_held_result_and_never_the_chain(world, monkeypatch):
    calls = _pos_stubs(monkeypatch)
    _unavailable(_read(opr.KIND), opr.KIND, opr.NOTE_NOT_HELD.format(symbol="TST", window="month"))
    assert calls["chain"] == 0
    _hold_pos(monkeypatch)
    before = calls["chain"]
    out = _read(opr.KIND)
    _conforms(out, opr.KIND)
    assert calls["chain"] == before and out["status"] == "ok" and out["as_of"] is None
    d = out["data"]
    assert d["max_pain"]["state"] == "held" and d["max_pain"]["expirations"][0]["max_pain"] is not None
    assert {lv["id"] for lv in d["levels"]["levels"]} >= {"call_wall", "put_wall", "max_pain"} and d["computed_at"]
    assert _read(opr.KIND, {"symbol": "TST", "window": "week"})["status"] == "unavailable"      # another window: not held
    POS._RESULTS.invalidate("posn::levels::TST::month")
    part = _read(opr.KIND)
    assert part["status"] == "partial" and part["data"]["levels"]["state"] == "not_held"
    monkeypatch.setenv("OPTIONS_MAX_PAIN_ENABLED", "0")
    monkeypatch.setenv("OPTIONS_POSITIONING_VOCAB_ENABLED", "0")
    _unavailable(_read(opr.KIND), opr.KIND, opr.NOTE_BOTH_OFF)


def test_filings_read_the_held_feed_and_one_stock_and_never_queue_an_sec_read(world, monkeypatch):
    queued = []
    monkeypatch.setattr(FF, "_schedule", lambda sym: queued.append(sym) or True)
    _unavailable(_read(ffr.KIND), ffr.KIND, ffr.NOTE_NOT_HELD.format(scope="The newest SEC filings across the market", sym=""))
    _unavailable(_read(ffr.KIND, {"symbol": "QZFL"}), ffr.KIND,
                 ffr.NOTE_NOT_HELD.format(scope="QZFL's recent SEC filings", sym=" for QZFL"))
    assert queued == []
    _hold_filings(monkeypatch)
    mk = _read(ffr.KIND)
    _conforms(mk, ffr.KIND)
    assert mk["data"]["scope"] == "market" and [r["ticker"] for r in mk["data"]["rows"]] == ["QZMK"]
    one = _read(ffr.KIND, {"symbol": "QZFL", "rows": 1})
    _conforms(one, ffr.KIND)
    assert one["data"]["company"] == "Made-up Filer Inc" and one["data"]["cut"] is True and one["data"]["total"] == 2
    assert one["data"]["rows"][0]["form"] == "8-K" and one["data"]["rows"][0]["items"]
    tenq = _read(ffr.KIND, {"symbol": "QZFL", "form": "10-Q"})
    assert [r["form"] for r in tenq["data"]["rows"]] == ["10-Q"]
    none = _read(ffr.KIND, {"symbol": "QZFL", "form": "S-1"})
    assert none["data"]["state"] == "none_in_scope" and none["data"]["rows"] == []
    assert queued == []
    held, how = filings_feed_held.held_ticker("QZFL")
    assert how == "held" and held == FF.ticker_feed("QZFL")                      # the route's own answer, once held
    FF.ticker_feed("QZNOTHELD")                                                  # the route queues a read on a miss
    assert queued == ["QZNOTHELD"]
    monkeypatch.setenv("FILINGS_FEED_ENABLED", "0")
    _unavailable(_read(ffr.KIND), ffr.KIND, ffr.NOTE_OFF)


def test_congress_reads_the_held_disclosures_a_missing_chamber_is_named_and_none_is_never_said(world, monkeypatch):
    _unavailable(_read(cgr.KIND), cgr.KIND, cgr.NOTE_NOT_HELD.format(scope="The newest congressional trade disclosures", sym=""))
    _hold_congress(monkeypatch)
    out = _read(cgr.KIND)
    _conforms(out, cgr.KIND)
    assert out["status"] == "ok" and {r["symbol"] for r in out["data"]["rows"]} == {"QZCG", "QZCH"}
    assert out["as_of"] is not None and out["data"]["newest_disclosure"] == "2031-06-01"
    assert {r["side"] for r in out["data"]["rows"]} == {"buy", "sell"} and out["data"]["rows"][0]["amount_low"] == 1001.0
    one = _read(cgr.KIND, {"symbol": "QZCG"})
    _conforms(one, cgr.KIND)
    assert one["status"] == "partial" and one["data"]["chambers"]["house"] == "unavailable"
    assert any(n == cgr.NOTE_CHAMBER.format(chamber="House") for n in one["notes"])
    monkeypatch.setenv("CONGRESS_TRADES_ENABLED", "0")
    _unavailable(_read(cgr.KIND), cgr.KIND, cgr.NOTE_OFF)


def test_market_deals_read_both_held_parts_each_with_its_own_state_never_a_build(world, monkeypatch):
    _unavailable(_read(mdr.KIND), mdr.KIND, mdr.NOTE_NOT_HELD)
    assert MNA._latest._state["inflight"] is None and IC._held._state["inflight"] is None
    _hold_deals(monkeypatch)
    out = _read(mdr.KIND)
    _conforms(out, mdr.KIND)
    assert out["status"] == "ok" and out["data"]["mergers"]["rows"][0]["acquirer"]["sym"] == "QZAQ"
    ch = out["data"]["index_changes"]
    assert ch["total"] == 3 and {c["index"] for c in ch["rows"]} == set(IC.INDEXES)
    assert _read(mdr.KIND, {"index": "dow"})["data"]["index_changes"]["total"] == 1
    cut = _read(mdr.KIND, {"part": "index_changes", "rows": 1})
    assert cut["data"]["mergers"] is None and cut["data"]["index_changes"]["cut"] is True
    IC._held.reset()
    with IC._held._lock:
        IC._held._state["loaded"] = True
    part = _read(mdr.KIND)
    assert part["status"] == "partial" and part["data"]["index_changes"]["state"] == "not_held"


def test_setup_study_reads_the_held_study_below_the_floor_is_null_never_0(world):
    _unavailable(_read(ssr.KIND), ssr.KIND, ssr.NOTE_NOT_HELD)
    _hold_study()
    out = _read(ssr.KIND)
    _conforms(out, ssr.KIND)
    s = out["data"]["setups"]
    assert out["status"] == "ok" and out["as_of"] and [x["id"] for x in s] == ["qz_break", "qz_pivot"]
    h60 = {k: v for k, v in s[0]["groups"][0]["horizons"]["60"].items() if k != "isolated"}
    assert h60 == {"n": 12, "below_floor": True, "win_rate": None, "avg_pct": None, "median_pct": None,
                   "baseline_win_rate": None, "baseline_avg_pct": None}
    assert s[0]["groups"][0]["horizons"]["20"]["win_rate"] == 55.0 and s[1]["state"] == "capped"
    assert SH.HINDSIGHT in out["notes"]
    only = _read(ssr.KIND, {"phase": "correction"})
    assert [g["phase"] for g in only["data"]["setups"][0]["groups"]] == ["correction"]


def test_period_change_reads_a_held_ranking_only_computing_and_not_held_are_said(world):
    _unavailable(_read(pcr.KIND), pcr.KIND, pcr.NOTE_NOT_HELD.format(start="2031-01-02", end="2031-03-03"))
    with SP._period_inflight_lock:
        SP._period_inflight["scan_period_20310102_20310303"] = threading.Event()
    _unavailable(_read(pcr.KIND), pcr.KIND, pcr.NOTE_COMPUTING.format(start="2031-01-02", end="2031-03-03"))
    with SP._period_inflight_lock:
        SP._period_inflight.clear()
    _hold_period()
    out = _read(pcr.KIND, {**PARAMS[pcr.KIND], "rows": 3})
    _conforms(out, pcr.KIND)
    assert [r["sym"] for r in out["data"]["rows"]] == ["QZ29", "QZ28", "QZ27"] and out["data"]["total"] == 30
    assert out["data"]["held"] == "fresh" and out["data"]["built_at"] == "2031-03-03T22:00:00Z"
    losers = _read(pcr.KIND, {**PARAMS[pcr.KIND], "side": "losers", "rows": 2})
    assert [r["sym"] for r in losers["data"]["rows"]] == ["QZ00", "QZ01"]
    with SP._period_done_lock:                                                 # only the last good copy left: stale
        SP._period_done.clear()
    cache.invalidate("scan_period_20310102_20310303")
    old = _read(pcr.KIND)
    assert old["stale"] is True and old["data"]["held"] == "last_good" and pcr.NOTE_LAST_GOOD in old["notes"]


# ── THE BUDGET RULE ───────────────────────────────────────────────────────────────────────────────────────────────
def _forbid(mp, reached):
    from api.services import fmp_client
    owners = {POS: ("_fetch", "chain", "max_pain", "levels", "_atm"), FF: ("_schedule", "_refresh", "_sec_get", "poll_market",
              "ticker_feed", "_load_tickers"), CT: ("latest", "for_symbol", "_fetchers_latest", "_fetchers_for_symbol"),
              MNA: ("build_latest", "get_latest", "get_company"), IC: ("build", "get_changes"),
              SH: ("get_study", "build_study", "get_stock"), SP: ("get_period_change", "_build_period_change", "_period_build_bg"),
              fmp_client: ("get_mergers_acquisitions_latest", "get_senate_latest", "get_house_latest")}
    for owner, names in owners.items():
        for name in names:
            label = f"{owner.__name__}.{name}"
            mp.setattr(owner, name, lambda *a, _n=label, **kw: reached.append(_n) or (_ for _ in ()).throw(AssertionError(_n)))
    for hold in (MNA._latest, IC._held, SH._STUDY):
        mp.setattr(hold, "get", lambda *a, _n=hold.name, **kw: reached.append(_n) or (_ for _ in ()).throw(AssertionError(_n)))
        mp.setattr(hold, "_start", lambda *a, _n=hold.name, **kw: reached.append(_n) or (_ for _ in ()).throw(AssertionError(_n)))
    mp.setattr(cache, "set", lambda *a, **kw: reached.append("cache.set") or (_ for _ in ()).throw(AssertionError("cache.set")))


def test_no_read_of_this_wave_builds_reads_a_chain_asks_a_vendor_or_starts_a_thread_held_or_not(world, monkeypatch):
    started, reached = [], []
    real_start = threading.Thread.start
    with pytest.MonkeyPatch.context() as mp:
        _forbid(mp, reached)
        mp.setattr(threading.Thread, "start", lambda self: started.append(self.name) or real_start(self))
        for kind in KINDS:
            out = _read(kind)
            _conforms(out, kind)
            assert out["status"] == "unavailable", (kind, out["notes"])
    assert reached == [] and started == []
    _hold_log(world)
    _hold_pos(monkeypatch)
    _hold_filings(monkeypatch)
    _hold_congress(monkeypatch)
    _hold_deals(monkeypatch)
    _hold_study()
    _hold_period()
    with pytest.MonkeyPatch.context() as mp:
        _forbid(mp, reached)
        mp.setattr(threading.Thread, "start", lambda self: started.append(self.name) or real_start(self))
        for kind in KINDS:
            out = _read(kind)
            _conforms(out, kind)
            assert out["status"] in ("ok", "partial"), (kind, out["notes"])
    assert reached == [] and started == []


def test_the_member_paths_own_readers_do_that_work_in_the_same_state_so_the_rail_can_fail(world, monkeypatch):
    calls = _pos_stubs(monkeypatch)
    asyncio.run(POS.max_pain("TST", "month"))                                  # the POS route reads the chain on a miss
    assert calls["chain"] == 1
    started = []
    real_start = threading.Thread.start
    monkeypatch.setattr(threading.Thread, "start", lambda self: started.append(self.name) or real_start(self))
    monkeypatch.setattr(SP, "_build_period_change", lambda ck, s, e: None)
    SP.get_period_change(20310102, 20310303)                                   # the PCHG route starts its build
    assert "period-build" in started
    monkeypatch.setattr(MNA, "build_latest", lambda previous=None: ({"status": "ok", "deals": []}, "x"))
    MNA.get_latest(wait_s=0)                                                   # the MNA route starts its build
    MNA._latest.drain(5)
    assert "mergers-latest" in " ".join(started) or MNA._latest.peek() is not None
    got = []
    monkeypatch.setattr(CT, "_fetchers_latest", lambda: got.append(1) or {c: (lambda *a, **k: None) for c in CT.CHAMBERS})
    CT.latest()                                                                # the CONG route asks the vendor
    assert got == [1]


# ── the licensing record the isolation rests on ───────────────────────────────────────────────────────────────────
def test_the_licensing_register_rows_the_isolation_cites_say_what_the_adapters_say_they_say():
    register = REGISTER.read_text(encoding="utf-8")
    row = lambda r: next(ln for ln in register.splitlines() if ln.startswith(f"| {r} |"))      # noqa: E731
    assert row("T-28").startswith("| T-28 | Member display — options chain + Greeks + IV") and "| **R** |" in row("T-28")
    assert row("T-14").startswith("| T-14 | AI processing — Massive numbers into Claude") and "| **R** |" in row("T-14")
    assert row("T-83").startswith("| T-83 | All seven uses — SEC EDGAR filings") and "| **A** |" in row("T-83")
    assert row("T-39").startswith("| T-39 | Member display — ETF holdings, index constituents") and "| **R** |" in row("T-39")
    assert row("T-44").startswith("| T-44 | AI processing — FMP numbers") and "No AI clause" in row("T-44")
    assert row("T-04").startswith("| T-04 | Member display — D/W/M history") and "| **R** |" in row("T-04")
    assert row("T-09").startswith("| T-09 | Storage — `bars.db`") and "| **R** |" in row("T-09")
    rows = [ln for ln in register.splitlines() if re.match(r"\| [TN]-\d+ \|", ln)]
    for words in ("congress", "stock act", "13107", "senate-trades", "house-trades"):
        assert not [ln for ln in rows if words in ln.lower()], words              # no row clears congressional data
    cites = {shr: ("T-28", "T-14"), opr: ("T-28", "T-14"), ffr: ("T-83",), cgr: ("T-39", "T-44"),
             mdr: ("T-39", "T-44", "T-83"), ssr: ("T-04", "T-09", "T-14"), pcr: ("T-04", "T-09", "T-14")}
    for m, cited in cites.items():
        doc = " ".join(m.__doc__.split())
        assert "licensing-register.md" in doc and "MODEL-ISOLATED (ADR-005; when in doubt, isolate)" in doc, m.__name__
        assert set(re.findall(r"[TN]-\d+", doc)) == set(cited), m.__name__
        assert "for a model provider" in doc and "Shown to the member only; the capabilit" in doc, m.__name__
    assert "5 U.S.C. 13107" in cgr.__doc__ and "stay dark" in cgr.__doc__


# ── the contract (MD-1 v1.20 §4.23) ───────────────────────────────────────────────────────────────────────────────
def test_the_contract_doc_states_section_4_23_and_every_note_the_adapters_emit():
    doc = DOC.read_text(encoding="utf-8").replace("\r\n", "\n")
    head = ("### 4.23 Terminal data wave 14: `options.straddleHistory`, `options.positioning`, `filings.feed`, "
            "`congress.trades`, `market.deals`, `market.setupStudy`, `market.periodChange` (v1.20, terminal-data)")
    assert head in doc
    section = doc[doc.index(head):doc.index("## 8. Changing this contract")]
    for m in MODULES:
        notes = {k: v for k, v in vars(m).items() if k.startswith("NOTE_")}
        assert notes, m.__name__
        for name, text in notes.items():
            assert text in section, f"{m.__name__} {name}"
        assert f"| `{m.KIND}` |" in section and f"`{m.SOURCE}`" in section, m.KIND
    prose = " ".join(section.split())
    for s in ("UCT_AGENT_DATA_KINDS", "UCT_AGENT_ISOLATED_KINDS", "turn.LOCAL_ONLY_ACTIONS", "**Status: dark, not armed.**",
              "**No read of this section starts a build or a request.**", "`filings_feed_held.held_ticker`", "5 U.S.C. 13107",
              "kept dark", "PEER", "OMON", "OBT", "STRS", "FUND", "FSRC", "FIL", "DVD MARKET", "the builder's default"):
        assert s in prose, s
    assert doc.index("### 4.22 Terminal data wave 13") < doc.index(head)
    title = re.match(r"# MD-1 — UCT market-data contract \(v1\.(\d+)\)", doc)
    assert title and int(title.group(1)) >= 20
    entry = next(line for line in doc.splitlines() if line.startswith("- **v1.20 addition (2026-11-28, terminal-data, data wave 14):**"))
    assert "owed by a person" in entry and "has not been sent" in entry and "not acknowledged by anyone" in entry
    assert "**Not armed:**" in entry and "Nothing in this entry or in §4.23 records an owner decision." in entry
    status = next(line for line in doc.splitlines() if line.startswith("- **Status:** v1."))
    owed = re.search(r"the §8\.1 notices for ([^;)]*?) are owed by a person and are not acknowledged", status)
    assert owed and "v1.20" in owed.group(1)
