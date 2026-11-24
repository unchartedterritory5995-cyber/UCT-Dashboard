"""MD-1 kinds of terminal data wave 11: `groups.rank`, `groups.crowding`, `earnings.seasonBySector`,
`estimates.revisionBreadth`, `options.ivRankLeaders`, `ipo.lockups`, `cot.byTrader` — the Agent half of GRPS RANK, GRPS
CROWDING, ERNSC, EEHSC, OSCR RICH / CHEAP, IPO LOCKUP and the COT panel's "By trader type" view.

No network and no real store: every held answer is put where its service keeps it BY the service, over the invented reads
its own test file already stands in for (the closes of `tests/test_group_stats`, the three stores of
`tests/test_group_positioning`, the earnings copies of `tests/test_sector_earnings`, the estimate store of
`tests/test_estimate_revisions`, the options log of `tests/test_iv_rank_leaders`, the listings of `tests/test_ipo_lockups`,
the CFTC files of `tests/test_cot_finer`). Every number, name and date is invented. Pinned per kind: an ok read (envelope
conformance, every block the service's own, the data's own date as `as_of`, or null with each part's own date), a
missing number null and never 0, the cut stated and from which end, `unavailable` kept apart from a healthy answer with
each state said in its own note, the route's switch respected, a malformed request refused before any read, a failing
service answered `unavailable`, and THE BUDGET RULE: no read builds, starts a thread, a request, a download or a cache
write, with the member path's own reader shown to do exactly that in the same state (so the rail can fail). For all
seven: registered dark, model-isolated, dormant until armed one by one. The licensing rows the isolation cites are read
from the register. And the contract: MD-1 §4.20 quotes every note these adapters emit.
"""
from __future__ import annotations

import datetime as dt
import inspect
import re
import threading
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from api.services import cot_finer as F, cot_service as CS
from api.services import estimate_history as EH, estimate_revisions as ER, estimate_revisions_held
from api.services import group_positioning as GP, group_stats as GS, group_stats_calc as GC
from api.services import held_build, held_reads, local_bars, scan_ipo
from api.services import ipo_lockups as LK, ipo_lockups_held
from api.services import sector_earnings as SE, sector_earnings_calc as SEC, sector_earnings_held
from api.services.cache import cache
from api.services.research import iv_history, iv_rank_leaders as IVR
from api.services.uct_agent import turn as agent_turn
from api.services.uct_agent.marketdata import cot_finer_read as cfr
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw
from api.services.uct_agent.marketdata import group_crowding_read as gcr
from api.services.uct_agent.marketdata import group_rank_read as grr
from api.services.uct_agent.marketdata import ipo_lockups_read as ilr
from api.services.uct_agent.marketdata import iv_rank_leaders_read as ivr
from api.services.uct_agent.marketdata import revision_breadth_read as rbr
from api.services.uct_agent.marketdata import sector_earnings_read as ser
from api.services.uct_agent.marketdata.short_interest import day_as_of
from tests import test_cot_finer as T_COT
from tests import test_estimate_revisions as T_ER
from tests import test_group_positioning as T_GP
from tests import test_ipo_lockups as T_IL
from tests import test_iv_rank_leaders as T_IV
from tests import test_sector_earnings as T_SE
from tests.test_group_stats import closes_of

REPO = Path(__file__).resolve().parents[1]
ET = ZoneInfo("America/New_York")
MODULES = (grr, gcr, ser, rbr, ivr, ilr, cfr)
KINDS = tuple(m.KIND for m in MODULES)
#: this wave's isolation defaults (ADR-005): all seven. They are the builder's defaults; a kind leaving this set is an owner
#: decision that has not been made.
ISOLATED = set(KINDS)
ACTIONS = {"stock.groupRank", "stock.groupOwnership", "stock.sectorEarnings", "stock.estimatesBreadth", "stock.ivRankLeaders",
           "stock.ipoUnlock", "stock.positionTypes"}
DOC = REPO / "docs/agent/program/contracts/MD-1-market-data.md"
REGISTER = REPO / "docs/terminal-research/09-security-licensing-cost/licensing-register.md"
PARAMS = {grr: {"kind": "sector"}, gcr: {"kind": "sector"}, ser: {"season": "current"}, rbr: {"metric": "eps", "window": 30},
          ivr: {"side": "both"}, ilr: {}, cfr: {"market": "ES"}}
#: what a turn must never reach, per service: every builder, job starter, store reader, download and route reader that can
#: start work
FORBIDDEN = {
    GS: ("build", "_start_job", "refresh_if_due", "scheduled_refresh", "_run_build", "_closes", "_artifact_reader", "_save_disk"),
    GP: ("build", "read_short", "read_insider", "read_nport"),
    SE: ("build", "held_copies", "get_season"),
    ER: ("build", "get_breadth"),
    EH: ("snapshot_symbol", "track"),
    IVR: ("build", "run_scheduled", "catch_up", "_run", "_save_disk"),
    iv_history: ("get_store",),
    LK: ("build", "get_lockups", "change_since_listing"),
    scan_ipo: ("held_listings",),
    local_bars: ("read_bars",),
    F: ("refresh", "run_scheduled", "_download", "_run", "store", "init_db", "plan"),
    CS: ("refresh_from_current", "refresh_if_stale", "seed_from_historical", "daily_catchup", "init_db"),
    held_build.HeldBuild: ("get", "_start", "_run"),
    held_reads.KeyedHeld: ("get",),
}

# ── the invented worlds, each held by its own service ─────────────────────────────────────────────────────────────
EVENING = dt.datetime(2031, 6, 4, 21, 0, tzinfo=ET)            # a Wednesday evening, after 20:15 New York time
ENERGY = ["QCA", "QCB", "QCC", "QCD", "QCE"]
UP = closes_of([10 + i * 0.1 for i in range(400)])
DOWN = closes_of([60 - i * 0.1 for i in range(400)])
FLAT = closes_of([30 + (i % 7) * 0.01 for i in range(400)])
PRICES = {**{s: UP for s in T_GP.SOFT}, **{s: DOWN for s in T_GP.CHIP}, **{s: FLAT for s in ENERGY}}
MAP = {**{s: {"sector": "Technology", "industry": "Software"} for s in T_GP.SOFT},
       **{s: {"sector": "Technology", "industry": "Chips"} for s in T_GP.CHIP},
       **{s: {"sector": "Energy", "industry": "Oil"} for s in ENERGY}}
_REAL_GS_BUILD = GS.build


def _hold_groups(mp, positioning=None):
    reads = []

    def build():
        return _REAL_GS_BUILD(EVENING, read_closes=lambda s: reads.append(s) or {"status": "ok", "closes": PRICES[s]},
                              read_artifact=None, symbols=list(PRICES), groups=MAP, pause=lambda s: None, yield_s=0.0,
                              fund_on=False, positioning=positioning or (lambda sg: GP.build(
                                  sg, short_reader=lambda: T_GP.SHORT, insider_reader=lambda: T_GP.INSIDER,
                                  nport_reader=lambda syms: T_GP.NPORT)))
    mp.setattr(GS, "build", build)
    GS._run_build(threading.Event())                                    # the service's own hold path, on this thread
    assert GS.held_answer()[1] == "held"
    return reads


def _hold_season(mp):
    read, reads = T_SE._reader(T_SE._copies())
    real = SE.build
    mp.setattr(SE, "build", lambda previous=None, **k: real(previous, symbols=T_SE.SYMS, groups=T_SE.GROUPS, read=read,
                                                            today=T_SE.TODAY, trading_day=T_SE._trading, yield_s=0))
    SE.get_season()
    SE.drain_for_tests()
    assert SE.peek() is not None
    return reads


def _hold_breadth(mp):
    T_ER._fill()
    mp.setattr(GS, "_group_map", lambda: dict(T_ER.GROUPS))
    ER.get_breadth()
    ER.drain_for_tests()
    assert ER.peek() is not None


def _hold_leaders(mp, tmp_path):
    lg = T_IV.Log(tmp_path / "log")
    mp.setattr(iv_history, "_store_override", lg.store)
    days = T_IV.build_25(lg)
    mp.setenv(T_IV.FLAG, "1")
    assert IVR.run_scheduled(T_IV.NOW) == {"started": True}
    IVR.drain()
    last = dt.date.fromisoformat(days[-1])
    mp.setattr(IVR, "now_et", lambda: dt.datetime(last.year, last.month, last.day, 21, 0, tzinfo=ET))   # its own evening
    return days


def _lockup_world(mp):
    state = {"live": T_IL.LIVE, "sources": dict(T_IL.SOURCES), "date": "2026-11-20", "built_at": 1.0, "building": False}
    mp.setattr(scan_ipo, "held_listings", lambda: dict(state))
    names = {"AQXA": "Aqxa Robotics Inc", "GQXG": "Gqxg Therapeutics"}
    mp.setattr(held_reads, "held_name", lambda s: names.get(s))
    closes = {"AQXA": [T_IL.bar("2026-05-27", 9.0), T_IL.bar("2026-05-28", 20.0), T_IL.bar("2026-11-19", 25.0)],
              "BQXB": [T_IL.bar("2026-06-02", 11.0)], "GQXG": [T_IL.bar("2026-05-30", 40.0)]}
    reads = []
    mp.setattr(local_bars, "read_bars", lambda sym, tf, want: reads.append(sym) or list(closes.get(sym, [])))
    mp.setattr(LK, "now_et", lambda: T_IL.NOW)
    return reads


def _hold_lockups(mp):
    reads = _lockup_world(mp)
    LK.get_lockups()
    LK._HELD.drain()
    assert LK._HELD.peek() is not None
    return reads


def _hold_cot():
    T_COT._store([T_COT.tff_lev("2031-03-11", 300000, 100000, 5000), T_COT.tff_lev("2031-03-18", 412345, 98765, 23456,
                                                                                    Conc_Gross_LE_4_TDR_Long_All="21.7",
                                                                                    Dealer_Positions_Long_All="")], "tff")
    T_COT._store([T_COT.disagg_mm("2031-03-18", 150000, 40000, 9000)], "disaggregated")


# ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────────────────
def _forget():
    for svc in (GS, SE, ER, IVR, LK):
        svc.reset_for_tests()


@pytest.fixture(autouse=True)
def world(monkeypatch, tmp_path):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(KINDS))
    monkeypatch.setenv(gw.ISOLATED_ENV, "1")
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(sorted(ISOLATED)))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv(EH.ENABLED_ENV, "1")
    monkeypatch.setenv("ESTIMATE_HISTORY_DB_PATH", str(tmp_path / "eh.db"))
    monkeypatch.setattr(CS, "DB_PATH", str(tmp_path / "cot.db"))
    F.init_db()
    monkeypatch.setattr(GS, "YIELD_S", 0.0)
    monkeypatch.setattr(GS, "now_et", lambda: EVENING)
    monkeypatch.setattr(SE, "_today", lambda: T_SE.TODAY)
    monkeypatch.setattr(LK, "now_et", lambda: T_IL.NOW)
    monkeypatch.setattr(F, "now_et", lambda: dt.datetime(2031, 3, 21, 18, 0, tzinfo=ET))      # the Friday the 03-18 report is out
    monkeypatch.setattr(IVR, "now_et", lambda: T_IV.NOW)
    _forget()
    gw._reset_for_test(None)
    yield tmp_path
    SE.drain_for_tests()
    ER.drain_for_tests()
    IVR.drain()
    LK._HELD.drain()
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


def _quiet(work) -> bool:
    return work == {"threads": []}


_turn = iter(range(100_000))


def _read(kind, params=None, purpose="answer"):
    m = next(x for x in MODULES if x.KIND == kind)
    return gw.read(kind, dict(PARAMS[m]) if params is None else params, user_id=1, turn_id=f"w11-{next(_turn)}", purpose=purpose)


def _conforms(out, kind):
    assert env.validate_envelope(out) == [], out
    assert out["kind"] == kind
    assert out["provider_calls"] == 0                                # no kind of this wave ever spends a provider call
    if out["status"] in ("ok", "partial"):
        assert env.FRESHNESS.index(out["freshness"]) >= env.FRESHNESS.index(gw.registry().get(kind).freshness)
        assert out["freshness"] == ("historical" if kind in (grr.KIND, ivr.KIND) else "periodic")
        if out["as_of"] is None:
            assert "`as_of` is null" in " ".join(out["notes"])
        assert out["as_of"] != out["fetched_at"]
        assert out["isolated"] is True and out["data"]["isolated"] is True     # ADR-005 L2, stamped by the gateway
    else:
        assert out["data"] is None and out["notes"]


def _plain(v):
    if isinstance(v, dict):
        return {k: _plain(x) for k, x in v.items() if k != "isolated"}
    return [_plain(x) for x in v] if isinstance(v, list) else v


def _made_from(template):
    return re.compile(".+?".join(re.escape(p) for p in re.split(r"\{[\w!r]+\}", template)), re.S)


def _note(out, template):
    hits = [n for n in out["notes"] if _made_from(template).fullmatch(n)]
    assert len(hits) == 1, (template, out["notes"])
    return hits[0]


def _lacks(out, template):
    return not [n for n in out["notes"] if _made_from(template).fullmatch(n)]


def _unavailable(out, kind, note):
    _conforms(out, kind)
    assert out["status"] == "unavailable" and out["notes"] == [note], out["notes"]


# ── registration, dark by default, isolation ──────────────────────────────────────────────────────────────────────
def test_all_seven_kinds_are_registered_once_by_their_modules_and_all_seven_are_isolated():
    r = gw.registry()
    for m in MODULES:
        k = r.get(m.KIND)
        assert k is not None and k.owner == "terminal-data" and k.category == "market", m.KIND
        assert k.validate is m.validate and k.description and k.max_symbols == 0
        assert k.model_isolated is True, m.KIND
        assert "Shown to the member only" in k.description and "never the time of the read" in k.description, m.KIND
        assert "never a build or a request" in k.description, m.KIND
    assert {r.get(k).freshness for k in KINDS} == {"periodic"}       # none is ever declared live or delayed
    assert KINDS == ("groups.rank", "groups.crowding", "earnings.seasonBySector", "estimates.revisionBreadth",
                     "options.ivRankLeaders", "ipo.lockups", "cot.byTrader")
    assert [m.SOURCE for m in MODULES] == ["uct-group-rank", "uct-group-positioning", "uct-sector-earnings",
                                           "uct-estimate-revisions", "uct-options-log", "uct-ipo-lockups", "cftc-cot-finer"]
    assert [r.get(k).fn.__name__ for k in KINDS] == ["read_rank", "read_crowding", "read_season", "read_breadth",
                                                     "read_leaders", "read_lockups", "read_positions"]
    assert ACTIONS <= set(agent_turn.LOCAL_ONLY_ACTIONS)
    assert not ACTIONS & set(agent_turn.DATA_READ_ACTIONS)


def test_dark_unless_the_gateway_is_on_and_the_kind_is_named(world, monkeypatch):
    ran = []
    for m in (grr, gcr, ser, rbr, ilr):
        monkeypatch.setattr(m, "held_answer", lambda *a, _m=m: ran.append(_m.KIND) or (None, "not_held"))
    monkeypatch.setattr(ivr, "held_answer", lambda: ran.append(ivr.KIND) or (None, "not_built"))
    monkeypatch.setattr(cfr, "held_market", lambda code: ran.append(cfr.KIND) or {"state": "not_built"})
    monkeypatch.setenv(gw.KINDS_ENV, "quote,themes,bars.daily,cot.positioning,calendar.ipos,options.ivHistory,earnings.season")
    for kind in KINDS:
        out = _read(kind)
        assert out["status"] == "refused" and gw.KINDS_ENV in out["notes"][0], kind
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(KINDS))
    monkeypatch.delenv(gw.DATA_ENV)
    for kind in KINDS:
        assert _read(kind)["status"] == "refused", kind
    assert ran == []


def test_isolated_kinds_are_dormant_until_armed_by_name_and_answer_the_member_only(world, monkeypatch):
    _hold_cot()
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, "")
    for kind in KINDS:
        out = _read(kind)
        assert out["status"] == "refused" and _plain(out["data"]) is None, kind
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, cfr.KIND)                 # arming ONE arms one
    assert _read(cfr.KIND)["status"] == "ok"
    for kind in KINDS[:-1]:
        assert _read(kind)["status"] == "refused", kind
    for purpose in ("research", "scan"):                                # never for a model's research
        assert _read(cfr.KIND, purpose=purpose)["status"] == "refused"
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(sorted(ISOLATED)))
    assert _read(grr.KIND)["status"] == "unavailable"                   # armed: read, and nothing is held
    monkeypatch.delenv(gw.ISOLATED_ENV)                                 # the master switch turns all seven off
    for kind in KINDS:
        assert _read(kind)["status"] == "refused", kind


def test_the_bounds_fields_and_words_are_the_services_own():
    assert grr.GROUP_KINDS == GS.KINDS and grr.MAX_NAME == GS.MAX_NAME
    assert grr.MEASURES == tuple(mid for mid, _b in GC.RANK_MEASURES)
    assert set(grr.POINTS) == {"now", *(label for label, _b in GC.RANK_BACK), "best", "worst"}
    for state in grr.RANK_WORDS:
        assert f'"{state}"' in inspect.getsource(GS._rank_part) + inspect.getsource(GS.build), state
    for state in grr.HELD_WORDS:
        assert f'"{state}"' in inspect.getsource(GS.get_group_stats), state
    assert gcr.PARTS == tuple(p for p in GP.PART_NAMES if p != "institutions") and gcr.MEMBER_FIELDS == GP.STOCK_FIELDS
    for state in gcr.PART_WORDS:
        assert f'"{state}"' in inspect.getsource(GP), state
    assert ser.SEASONS == SEC.SEASON_IDS
    for f in ser.FIGURE_FIELDS[2:]:
        assert f'"{f}"' in inspect.getsource(SEC.figures) + inspect.getsource(SEC), f
    assert rbr.METRICS == tuple(ER.METRICS) and rbr.WINDOWS == ER.WINDOWS
    for f in rbr.COUNT_FIELDS[2:]:
        assert f'"{f}"' in inspect.getsource(ER._blank_counts) + inspect.getsource(ER.sector_slice), f
    assert ivr.MAX_ROWS == IVR.MAX_PER_SIDE and ivr.COUNT_FIELDS == tuple(IVR._counts())
    for f in ivr.ROW_FIELDS:
        assert f'"{f}"' in inspect.getsource(IVR.build), f
    assert ilr.BASIS == LK.BASIS and ilr.LISTING_SOURCES == tuple(LK.LISTING_SOURCES) and ilr.basis_words() == LK.BASIS_WORDS
    for reason in ilr.CHANGE_REASONS:
        assert f'"{reason}"' in inspect.getsource(LK.change_since_listing), reason
    assert cfr.REPORTS == tuple(F.REPORTS) and cfr.SIDE_FIELDS == F._POSITION_COLS[3:]
    for state in cfr.STATE_WORDS:
        assert f'"{state}"' in inspect.getsource(F.market_answer) + inspect.getsource(F.board_answer), state
    assert cfr.CREDIT == ("Source: CFTC Commitments of Traders (Traders in Financial Futures / Disaggregated), as of the "
                          "Tuesday it covers, published the following Friday.")
    panel = (REPO / "app/src/pages/terminal/panels/cotModel.js").read_text(encoding="utf-8")
    assert "Source: CFTC Commitments of Traders (Traders in Financial Futures / Disaggregated), '" in panel   # the panel's words
    for fn in (grr.held_answer, gcr.held_answer, ser.held_answer, rbr.held_answer, ivr.held_answer, ilr.held_answer,
               cfr.held_market, cfr.held_board, sector_earnings_held.held_season, estimate_revisions_held.held_breadth,
               ipo_lockups_held.held_lockups, GS.held_answer):
        assert "READ ONLY" in fn.__doc__, fn.__qualname__
    assert "NEVER builds" in GS.get_group_stats.__doc__ and "NEVER builds" in GS.get_group_positioning.__doc__
    assert "never a read of the log" in IVR.get_leaders.__doc__ and "never download" in F.__doc__.replace("\n", " ")


# ── groups.rank ───────────────────────────────────────────────────────────────────────────────────────────────────
def test_rank_reads_the_held_table_every_point_the_services_own_and_the_movers_over_every_group(world, work, monkeypatch):
    reads = _hold_groups(monkeypatch)
    asked = len(reads)
    served = GS.get_group_stats("industry")
    work["threads"].clear()
    out = _read(grr.KIND, {"kind": "industry", "rows": 2})
    _conforms(out, grr.KIND)
    d = _plain(out["data"])
    assert d["kind"] == "industry" and d["groups_total"] == 3 and d["ranked_now"] == 2 and d["rank"]["state"] == "ok"
    assert [g["name"] for g in d["groups"]] == ["Oil", "Software"] or [g["name"] for g in d["groups"]] == ["Software", "Oil"]
    by = {g["name"]: g for g in served["groups"]}
    for g in d["groups"]:                                             # every point is the service's own, the line left out
        for mid in grr.MEASURES:
            for k in grr.POINTS:
                want = by[g["name"]]["rank"][mid][k]
                got = g["rank"][mid][k]
                assert (got is None) == (want is None), (g["name"], mid, k)
                if want:
                    assert {x: got[x] for x in ("position", "of", "n", "date")} == {x: want[x] for x in ("position", "of", "n", "date")}
            assert "line" not in g["rank"][mid]
    assert [g["rank"]["m6"]["now"]["position"] for g in d["groups"]] == [1, 2]
    assert out["as_of"] == grr.close_as_of(served["session"]) and _note(out, grr.NOTE_AS_OF)
    assert _note(out, grr.NOTE_CUT) == grr.NOTE_CUT.format(total=3, many="industries", shown=2)
    assert _note(out, grr.NOTE_FEW) == grr.NOTE_FEW.format(min=5, n=1, many="industry")   # Chips: two stocks, no rank, never 0
    assert set(d["movers"]) == {"w4", "w13"} and _note(out, grr.NOTE_MOVERS) and _note(out, grr.NOTE_LEFT_OUT)
    assert not out["stale"] and _lacks(out, grr.NOTE_OLD)
    assert len(reads) == asked and _quiet(work)


def test_rank_movers_are_the_panels_rule_ranked_at_both_ends_most_places_first_equal_moves_by_name():
    def g(name, back, now):
        return {"name": name, "rank": {"m6": {"now": {"position": now}, "w4": None if back is None else {"position": back, "change": None if now is None else back - now}}}}
    groups = [g("Beta", 9, 2), g("Alpha", 9, 2), g("Gamma", 1, 6), g("Delta", None, 3), g("Eps", 4, None), g("Zeta", 3, 3)]
    m = grr.movers(groups, "w4")
    assert [(x["name"], x["change"]) for x in m["up"]] == [("Alpha", 7), ("Beta", 7)]
    assert [(x["name"], x["change"]) for x in m["down"]] == [("Gamma", -5)]
    assert m["counted"] == 4                                             # Zeta held its place; Delta and Eps are not counted


def test_rank_one_group_and_a_name_not_held_and_a_rank_part_pending_or_stale_are_each_said(world, work, monkeypatch):
    _hold_groups(monkeypatch)
    out = _read(grr.KIND, {"kind": "sector", "name": "  technology "})
    _conforms(out, grr.KIND)
    d = _plain(out["data"])
    assert d["found"] is True and d["name"] == "Technology" and d["members"] == 8 and "groups" not in d
    assert d["group_rank"]["m6"]["now"]["position"] in (1, 2) and "line" not in d["group_rank"]["m6"]
    out = _read(grr.KIND, {"kind": "sector", "name": "Invented Sector"})
    d = _plain(out["data"])
    assert d["found"] is False and d["group_rank"] is None
    assert _note(out, grr.NOTE_NOT_FOUND) == grr.NOTE_NOT_FOUND.format(kind="sector", name="Invented Sector", total=2, many="sectors")
    monkeypatch.setattr(GS, "now_et", lambda: EVENING + dt.timedelta(days=1))        # a newer evening has begun
    out = _read(grr.KIND)
    assert out["stale"] is True and _note(out, grr.NOTE_OLD) and out["data"]["stale_for"] == ["earlier_evening"]
    ans, _ = GS.held_answer()
    monkeypatch.setitem(GS._state, "answer", {k: v for k, v in ans.items() if k != "rank"})     # held from before the rank
    out = _read(grr.KIND)
    _conforms(out, grr.KIND)
    d = _plain(out["data"])
    assert d["rank"]["state"] == "pending" and d["groups"] == [] and d["movers"] is None
    assert _note(out, grr.NOTE_RANK) == grr.NOTE_RANK.format(why=grr.RANK_WORDS["pending"]) and _quiet(work)


def test_rank_nothing_held_computing_bad_requests_and_a_failing_service(world, work, monkeypatch):
    _unavailable(_read(grr.KIND), grr.KIND, grr.NOTE_NOT_HELD.format(why=grr.HELD_WORDS["not_built"]))
    monkeypatch.setitem(GS._state, "inflight", threading.Event())
    _unavailable(_read(grr.KIND), grr.KIND, grr.NOTE_NOT_HELD.format(why=grr.HELD_WORDS["computing"]))
    monkeypatch.setitem(GS._state, "inflight", None)
    for bad in ({"kind": "theme"}, {"kind": "sector", "rows": 0}, {"kind": "sector", "rows": grr.MAX_ROWS + 1},
                {"kind": "sector", "name": "x" * 81}, {"kind": "sector", "rows": True}, []):
        assert _read(grr.KIND, bad)["status"] in ("refused", "unavailable"), bad
    monkeypatch.setattr(grr, "held_answer", lambda *a: (_ for _ in ()).throw(RuntimeError("x")))
    _unavailable(_read(grr.KIND), grr.KIND, grr.NOTE_FAILED)
    assert _quiet(work)


# ── groups.crowding ───────────────────────────────────────────────────────────────────────────────────────────────
def test_crowding_reads_each_part_with_its_state_and_date_ordered_by_percent_of_float_and_cut_from_the_low_end(world, work, monkeypatch):
    _hold_groups(monkeypatch)
    served = GS.get_group_positioning("industry")
    work["threads"].clear()
    out = _read(gcr.KIND, {"kind": "industry", "rows": 2})
    _conforms(out, gcr.KIND)
    d = _plain(out["data"])
    assert out["as_of"] is None and _note(out, gcr.NOTE_AS_OF)
    assert {p: d["parts"][p]["state"] for p in gcr.PARTS} == {"short": "ok", "insider": "ok", "funds": "ok"}
    assert d["parts"]["short"]["settlement_date"] == "2031-05-15" and d["institutions"] == "not_held"
    by = {g["name"]: g for g in served["groups"]}
    assert [g["name"] for g in d["groups"]] == ["Software", "Chips"] and d["groups_total"] == 3
    assert d["groups"][0]["positioning"] == _plain(by["Software"]["positioning"])                  # the service's own figures
    assert d["groups"][1]["positioning"]["short"]["pct_float"]["median"] is None                   # two members: no figure, never 0
    assert _note(out, gcr.NOTE_CUT) == gcr.NOTE_CUT.format(total=3, many="industries", shown=2)
    assert _note(out, gcr.NOTE_INSIDER_SALES) and _note(out, gcr.NOTE_ORDER) and _note(out, gcr.NOTE_LEFT_OUT)
    assert "13F" in gcr.NOTE_LEFT_OUT and _quiet(work)


def test_crowding_one_groups_members_most_shorted_first_and_a_part_not_read_is_said(world, work, monkeypatch):
    _hold_groups(monkeypatch, positioning=lambda sg: GP.build(sg, short_reader=lambda: T_GP.SHORT,
                                                              insider_reader=lambda: {"state": "not_held"},
                                                              nport_reader=lambda syms: T_GP.NPORT))
    out = _read(gcr.KIND, {"kind": "industry", "name": "software", "rows": 3})
    _conforms(out, gcr.KIND)
    d = _plain(out["data"])
    assert d["found"] is True and d["members"] == 6 and d["member_total"] == 6
    assert [r["sym"] for r in d["member_rows"]] == ["QAD", "QAE", "QAC"]                 # the service's order: most shorted first
    assert d["member_rows"][0]["pct_float"] == 16.0 and d["member_rows"][0]["buys"] is None
    assert _note(out, gcr.NOTE_MEMBERS_CUT) == gcr.NOTE_MEMBERS_CUT.format(total=6, shown=3)
    assert d["parts"]["insider"]["state"] == "not_held" and d["positioning"]["insider"] is None
    assert _note(out, gcr.NOTE_PART) == gcr.NOTE_PART.format(part="Insider buying", why=gcr.PART_WORDS["not_held"])
    assert _lacks(out, gcr.NOTE_INSIDER_SALES)
    assert _read(gcr.KIND, {"kind": "industry", "rows": gcr.MAX_ROWS + 1})["status"] in ("refused", "unavailable")
    monkeypatch.setattr(gcr, "held_answer", lambda *a: (_ for _ in ()).throw(RuntimeError("x")))
    _unavailable(_read(gcr.KIND), gcr.KIND, gcr.NOTE_FAILED)
    assert _quiet(work)


def test_crowding_nothing_held_is_said_never_not_crowded(world, work):
    _unavailable(_read(gcr.KIND), gcr.KIND, gcr.NOTE_NOT_HELD.format(why=grr.HELD_WORDS["not_built"]))
    assert "not the same as no crowding" in gcr.NOTE_NOT_HELD and _quiet(work)


# ── earnings.seasonBySector ───────────────────────────────────────────────────────────────────────────────────────
def test_season_reads_the_held_table_coverage_first_with_the_year_earlier_line(world, work, monkeypatch):
    reads = _hold_season(monkeypatch)
    asked = len(reads)
    served = SE.get_season("current")
    work["threads"].clear()
    out = _read(ser.KIND, {"season": "current"})
    _conforms(out, ser.KIND)
    d = _plain(out["data"])
    assert d["coverage"]["universe"] == served["coverage"]["universe"] and d["coverage"]["held"] == served["coverage"]["held"]
    assert d["total"]["eps"] == served["total"]["eps"] and d["total"]["year_ago"]["eps"] == served["total"]["year_ago"]["eps"]
    assert [s["name"] for s in d["sectors"]] == [s["name"] for s in served["sectors"]]
    tech = next(s for s in d["sectors"] if s["name"] == "Technology")
    assert tech["eps"] == next(s for s in served["sectors"] if s["name"] == "Technology")["eps"] and tech["year_ago"] is not None
    assert "reporters" not in tech and d["left_out"] == ["reporters", "upcoming", "late"]
    assert out["as_of"] == day_as_of(served["coverage"]["newest_copy"]) and _note(out, ser.NOTE_AS_OF)
    assert _note(out, ser.NOTE_WHAT).startswith(served["seasons"]["current"]["label"]) and _note(out, ser.NOTE_FLOOR)
    assert not out["stale"] and len(reads) == asked and _quiet(work)


def test_season_an_earlier_season_carries_no_year_ago_and_a_stale_answer_is_said(world, work, monkeypatch):
    _hold_season(monkeypatch)
    work["threads"].clear()
    out = _read(ser.KIND, {"season": "previous"})
    _conforms(out, ser.KIND)
    d = _plain(out["data"])
    assert d["season"] == "previous" and d["total"].get("year_ago") is None
    monkeypatch.setattr(SE, "_today", lambda: T_SE.TODAY + dt.timedelta(days=1))
    out = _read(ser.KIND)
    assert out["stale"] is True and _note(out, ser.NOTE_STALE) and out["data"]["stale_for"] == ["earlier_day"]
    assert _quiet(work)


def test_season_nothing_held_bad_requests_and_a_failing_service(world, work, monkeypatch):
    _unavailable(_read(ser.KIND), ser.KIND, ser.NOTE_NOT_HELD)
    assert "not the same as no reports" in ser.NOTE_NOT_HELD
    assert _read(ser.KIND, {"season": "next"})["status"] in ("refused", "unavailable")
    monkeypatch.setattr(ser, "held_answer", lambda s: (_ for _ in ()).throw(RuntimeError("x")))
    _unavailable(_read(ser.KIND), ser.KIND, ser.NOTE_FAILED)
    assert _quiet(work)


# ── estimates.revisionBreadth ─────────────────────────────────────────────────────────────────────────────────────
def test_breadth_reads_the_held_answer_with_the_population_sentence_and_no_symbol_lists(world, work, monkeypatch):
    _hold_breadth(monkeypatch)
    served = ER.get_breadth("eps", 30)
    work["threads"].clear()
    out = _read(rbr.KIND, {"metric": "eps", "window": 30})
    _conforms(out, rbr.KIND)
    d = _plain(out["data"])
    assert d["tracked"]["n"] == served["tracked"]["n"] and d["tracked"]["origins"]["viewed"] == served["tracked"]["origins"]["viewed"]
    assert d["total"]["up"] == served["total"]["up"] and d["total"]["net"] == served["total"]["net"]
    tech = next(s for s in d["sectors"] if s["name"] == "Technology")
    want = next(s for s in served["sectors"] if s["name"] == "Technology")
    assert {k: tech[k] for k in ("up", "down", "held", "net", "raises", "cuts")} == {k: want[k] for k in ("up", "down", "held", "net", "raises", "cuts")}
    assert "symbols" not in tech and d["left_out"] == ["symbols"]
    assert out["as_of"] == day_as_of(served["asof"]) and _note(out, rbr.NOTE_AS_OF)
    assert "not the whole market" in _note(out, rbr.NOTE_WHAT) and _note(out, rbr.NOTE_NOT_COUNTED) and _note(out, rbr.NOTE_FLOOR)
    energy = next(s for s in d["sectors"] if s["name"] == "Energy")
    assert energy["net"] is None and energy["counted"] < 5                    # fewer than five counted: no net, never 0
    assert _quiet(work)


def test_breadth_switched_off_nothing_held_bad_requests_and_a_failing_service(world, work, monkeypatch):
    _unavailable(_read(rbr.KIND), rbr.KIND, rbr.NOTE_NOT_HELD)
    monkeypatch.delenv(EH.ENABLED_ENV)
    _unavailable(_read(rbr.KIND), rbr.KIND, rbr.NOTE_SWITCHED_OFF)
    monkeypatch.setenv(EH.ENABLED_ENV, "1")
    for bad in ({"metric": "ebitda"}, {"window": 14}, {"window": True}):
        assert _read(rbr.KIND, bad)["status"] in ("refused", "unavailable"), bad
    monkeypatch.setattr(rbr, "held_answer", lambda m, w: (_ for _ in ()).throw(RuntimeError("x")))
    _unavailable(_read(rbr.KIND), rbr.KIND, rbr.NOTE_FAILED)
    assert _quiet(work)


# ── options.ivRankLeaders ─────────────────────────────────────────────────────────────────────────────────────────
def test_leaders_read_the_held_list_both_ends_cut_and_every_left_out_count(world, work, tmp_path, monkeypatch):
    days = _hold_leaders(monkeypatch, tmp_path)
    served = IVR.get_leaders()
    work["threads"].clear()
    out = _read(ivr.KIND, {"side": "both", "rows": 2})
    _conforms(out, ivr.KIND)
    d = _plain(out["data"])
    assert d["session"] == days[-1] and d["counts"] == {k: served["counts"][k] for k in ivr.COUNT_FIELDS}
    assert [r["symbol"] for r in d["high"]] == [r["symbol"] for r in served["high"]][:2]
    assert [r["symbol"] for r in d["low"]] == [r["symbol"] for r in served["low"]][:2]
    assert d["high"][0] == {k: served["high"][0][k] for k in ivr.ROW_FIELDS}
    assert out["as_of"] == ivr.close_as_of(days[-1]) and _note(out, ivr.NOTE_AS_OF)
    assert _note(out, ivr.NOTE_RANKED) == ivr.NOTE_RANKED.format(ranked=4, below=1, min=20, flat=1, stale=1)
    assert len([n for n in out["notes"] if _made_from(ivr.NOTE_CUT).fullmatch(n)]) == 2          # each side, from the middle
    assert not out["stale"] and _quiet(work)
    out = _read(ivr.KIND, {"side": "low", "rows": 1})
    d = _plain(out["data"])
    assert d["high"] == [] and len(d["low"]) == 1
    monkeypatch.setattr(IVR, "now_et", lambda: T_IV.NOW)                         # weeks on: the list is behind
    out = _read(ivr.KIND)
    assert out["stale"] is True and _note(out, ivr.NOTE_BEHIND) and "behind" in out["data"]["stale_for"]


def test_leaders_switched_off_not_built_bad_requests_and_a_failing_service(world, work, monkeypatch):
    _unavailable(_read(ivr.KIND), ivr.KIND, ivr.NOTE_SWITCHED_OFF)            # the switch is unset in this test
    monkeypatch.setenv(T_IV.FLAG, "1")
    _unavailable(_read(ivr.KIND), ivr.KIND, ivr.NOTE_NOT_BUILT.format(building=""))
    for bad in ({"side": "rich"}, {"rows": 0}, {"rows": ivr.MAX_ROWS + 1}):
        assert _read(ivr.KIND, bad)["status"] in ("refused", "unavailable"), bad
    monkeypatch.setattr(ivr, "held_answer", lambda: (_ for _ in ()).throw(RuntimeError("x")))
    _unavailable(_read(ivr.KIND), ivr.KIND, ivr.NOTE_FAILED)
    assert _quiet(work)


# ── ipo.lockups ───────────────────────────────────────────────────────────────────────────────────────────────────
def test_lockups_read_the_held_list_every_row_estimated_soonest_first_and_cut_from_the_far_end(world, work, monkeypatch):
    reads = _hold_lockups(monkeypatch)
    asked = len(reads)
    served = LK.get_lockups()
    work["threads"].clear()
    out = _read(ilr.KIND, {"rows": 2})
    _conforms(out, ilr.KIND)
    d = _plain(out["data"])
    assert [r["symbol"] for r in d["rows"]] == [r["symbol"] for r in served["rows"]][:2] == ["BQXB", "AQXA"]
    assert {r["basis"] for r in d["rows"]} == {"estimated"} and d["basis_words"] == LK.BASIS_WORDS
    assert d["rows"][1]["change_since_listing"]["pct"] == served["rows"][1]["change_since_listing"]["pct"]
    assert d["rows"][0]["change_since_listing"] == {"pct": None, "first_close": 11.0, "first_date": "2026-06-02", "last_close": 11.0,
                                                    "last_date": "2026-06-02", "reason": "no_first_day"}     # never 0
    assert "listing_source_words" not in d["rows"][0] and d["rows"][0]["listing_source"] == "reference"
    assert out["as_of"] == "2026-11-20T14:58:00Z" and _note(out, ilr.NOTE_AS_OF)
    assert _note(out, ilr.NOTE_CUT) == ilr.NOTE_CUT.format(total=3, shown=2) and _note(out, ilr.NOTE_NO_DATE) and _note(out, ilr.NOTE_NO_CHANGE)
    assert not out["stale"] and len(reads) == asked and _quiet(work)
    monkeypatch.setattr(LK, "now_et", lambda: T_IL.NOW + dt.timedelta(days=2))
    out = _read(ilr.KIND)
    assert out["stale"] is True and _note(out, ilr.NOTE_STALE) == ilr.NOTE_STALE.format(today="2026-11-20", now="2026-11-22", late=2)


def test_lockups_warming_nothing_held_bad_requests_and_a_failing_service(world, work, monkeypatch):
    _unavailable(_read(ilr.KIND), ilr.KIND, ilr.NOTE_NOT_HELD)
    assert "not the same as no lockups" in ilr.NOTE_NOT_HELD
    _lockup_world(monkeypatch)
    monkeypatch.setattr(scan_ipo, "held_listings", lambda: {"live": None, "sources": {}, "date": None})
    LK.get_lockups()
    LK._HELD.drain()
    work["threads"].clear()
    _unavailable(_read(ilr.KIND), ilr.KIND, ilr.NOTE_WARMING)
    for bad in ({"rows": 0}, {"rows": ilr.MAX_ROWS + 1}, {"rows": "5"}):
        assert _read(ilr.KIND, bad)["status"] in ("refused", "unavailable"), bad
    monkeypatch.setattr(ilr, "held_answer", lambda: (_ for _ in ()).throw(RuntimeError("x")))
    _unavailable(_read(ilr.KIND), ilr.KIND, ilr.NOTE_FAILED)
    assert _quiet(work)


# ── cot.byTrader ──────────────────────────────────────────────────────────────────────────────────────────────────
def test_cot_one_market_every_class_its_newest_two_weeks_and_the_watched_class(world, work):
    _hold_cot()
    served = F.market_answer("ES", 2)
    out = _read(cfr.KIND, {"market": "es"})
    _conforms(out, cfr.KIND)
    d = _plain(out["data"])
    assert (d["market"], d["report"], d["watch"]) == ("ES", "tff", "leveraged_funds")
    assert [r["date"] for r in d["rows"]] == ["2031-03-11", "2031-03-18"]
    lev = d["rows"][-1]["classes"]["leveraged_funds"]
    assert lev == {k: served["rows"][-1]["classes"]["leveraged_funds"][k] for k in cfr.SIDE_FIELDS}
    assert (lev["long"], lev["short"]) == (412345, 98765) and d["concentration"]["gross_4_long"] == 21.7
    assert d["rows"][-1]["classes"]["dealer"]["long"] is None                       # the CFTC printed none: null, never 0
    assert out["as_of"] == day_as_of("2031-03-18") and _note(out, cfr.NOTE_AS_OF) and _note(out, cfr.NOTE_LEFT_OUT)
    assert d["credit"] == cfr.CREDIT and not out["stale"] and _quiet(work)
    out = _read(cfr.KIND, {"market": "gold"})                                     # cot.positioning's own resolver
    d = _plain(out["data"])
    assert d["market"] == "GC" and d["watch"] == "managed_money" and len(d["rows"]) == 1 and _note(out, cfr.NOTE_ONE_WEEK)


def test_cot_the_board_its_oldest_newest_week_as_of_and_markets_without_a_record(world, work, monkeypatch):
    _hold_cot()
    out = _read(cfr.KIND, {"market": None})
    _conforms(out, cfr.KIND)
    d = _plain(out["data"])
    assert set(d["markets"]) == {"ES", "GC"} and d["markets"]["ES"]["long"] == 412345 and d["markets"]["ES"]["previous"]["long"] == 300000
    assert d["markets"]["GC"]["previous"] is None and len(d["no_record"]) == len(CS.SYMBOL_MAP) - 2
    assert out["as_of"] == day_as_of("2031-03-18") and _note(out, cfr.NOTE_NO_RECORD_BOARD)
    monkeypatch.setattr(F, "now_et", lambda: dt.datetime(2031, 4, 4, 18, 0, tzinfo=ET))     # two weeks on
    out = _read(cfr.KIND, {"market": None})
    assert out["stale"] is True and _note(out, cfr.NOTE_STALE) and _quiet(work)


def test_cot_nothing_stored_no_record_an_unknown_market_bad_requests_and_a_failing_store(world, work, monkeypatch):
    _unavailable(_read(cfr.KIND), cfr.KIND, cfr.NOTE_NOT_STORED.format(why=cfr.STATE_WORDS["not_built"]))
    _unavailable(_read(cfr.KIND, {"market": None}), cfr.KIND, cfr.NOTE_NOT_STORED.format(why=cfr.STATE_WORDS["not_built"]))
    _hold_cot()
    _unavailable(_read(cfr.KIND, {"market": "CL"}), cfr.KIND, cfr.NOTE_NOT_STORED.format(why=cfr.STATE_WORDS["no_record"]))
    _unavailable(_read(cfr.KIND, {"market": "invented paste"}), cfr.KIND, cfr.NOTE_NOT_COVERED.format(word="invented paste"))
    for bad in ({"market": ""}, {"market": "x" * 41}, {"market": 5}):
        assert _read(cfr.KIND, bad)["status"] in ("refused", "unavailable"), bad
    monkeypatch.setattr(cfr, "held_market", lambda code: (_ for _ in ()).throw(RuntimeError("x")))
    _unavailable(_read(cfr.KIND), cfr.KIND, cfr.NOTE_FAILED)
    assert _quiet(work)


# ── THE BUDGET RULE ───────────────────────────────────────────────────────────────────────────────────────────────
def _forbid(mp, reached):
    for owner, names in FORBIDDEN.items():
        for name in names:
            assert callable(getattr(owner, name)), (getattr(owner, "__name__", owner), name)   # a rename fails here, by name
            label = f"{getattr(owner, '__name__', type(owner).__name__)}.{name}"
            mp.setattr(owner, name, lambda *a, _n=label, **kw: reached.append(_n) or (_ for _ in ()).throw(AssertionError(_n)))
    mp.setattr(cache, "set", lambda *a, **kw: reached.append("cache.set") or (_ for _ in ()).throw(AssertionError("cache.set")))


def test_no_read_of_this_wave_builds_starts_a_thread_reads_a_store_or_downloads_held_or_not(world, work, tmp_path, monkeypatch):
    """Every entry point that can cause work is replaced by one that fails and counts, named per service: GRPS's build,
    job starter, refresh and price reads, the positioning stores, ERNSC's and EEHSC's builds, copy read and route reads, the
    estimate store's writers, the IV list's build, scheduler entries and log store, IPO LOCKUP's build, route read, close
    read and the listings scan, the COT reader's run, download, store and plan and the legacy reader's refreshes, the shared
    holds' get, start and run, and the shared cache's writer."""
    monkeypatch.setenv(T_IV.FLAG, "1")
    reached = []
    reads = [(m.KIND, dict(PARAMS[m])) for m in MODULES] + [(cfr.KIND, {"market": None})]
    with pytest.MonkeyPatch.context() as mp:                            # nothing held anywhere
        _forbid(mp, reached)
        for kind, params in reads:
            out = _read(kind, params)
            _conforms(out, kind)
            assert out["status"] == "unavailable", (kind, out["notes"])
        assert reached == [] and _quiet(work)
    _hold_groups(monkeypatch)
    _hold_season(monkeypatch)
    _hold_breadth(monkeypatch)
    _hold_leaders(monkeypatch, tmp_path)
    _hold_lockups(monkeypatch)
    _hold_cot()
    monkeypatch.setattr(GS, "now_et", lambda: EVENING + dt.timedelta(days=2))     # and everything is due again
    monkeypatch.setattr(SE, "_today", lambda: T_SE.TODAY + dt.timedelta(days=2))
    monkeypatch.setattr(LK, "now_et", lambda: T_IL.NOW + dt.timedelta(days=2))
    monkeypatch.setattr(IVR, "now_et", lambda: T_IV.NOW)
    work["threads"].clear()
    with pytest.MonkeyPatch.context() as mp:                            # everything held, everything due
        _forbid(mp, reached)
        for kind, params in reads:
            out = _read(kind, params)
            _conforms(out, kind)
            assert out["status"] == "ok", (kind, out["notes"])
        assert reached == [] and _quiet(work)


def test_the_member_paths_own_readers_do_that_work_in_the_same_state_so_the_rail_can_fail(world, tmp_path, monkeypatch):
    """The contrast: where the adapter answers from what is held, the reader the member path uses starts the work."""
    started = []
    real_start = threading.Thread.start
    monkeypatch.setattr(threading.Thread, "start", lambda self: started.append(self.name) or real_start(self))
    assert _read(grr.KIND)["status"] == "unavailable" and started == []
    monkeypatch.setattr(GS, "build", lambda: (_ for _ in ()).throw(RuntimeError("an invented failure")))
    assert GS.refresh_if_due(EVENING) is True and started == ["group-stats-build"]
    GS._state["inflight"] and GS._state["inflight"].wait(5)
    started.clear()
    read, reads = T_SE._reader(T_SE._copies())
    real = SE.build
    monkeypatch.setattr(SE, "build", lambda previous=None, **k: real(previous, symbols=T_SE.SYMS, groups=T_SE.GROUPS, read=read,
                                                                    today=T_SE.TODAY, trading_day=T_SE._trading, yield_s=0))
    assert _read(ser.KIND)["status"] == "unavailable" and reads == []
    SE.get_season()
    SE.drain_for_tests()
    assert started == ["sector-earnings-build"] and reads and _read(ser.KIND)["status"] == "ok"
    started.clear()
    T_ER._fill()
    monkeypatch.setattr(GS, "_group_map", lambda: dict(T_ER.GROUPS))
    assert _read(rbr.KIND)["status"] == "unavailable" and started == []
    ER.get_breadth()
    ER.drain_for_tests()
    assert started == ["estimate-revisions-build"] and _read(rbr.KIND)["status"] == "ok"
    started.clear()
    reads = _lockup_world(monkeypatch)
    assert _read(ilr.KIND)["status"] == "unavailable" and reads == [] and started == []
    LK.get_lockups()
    LK._HELD.drain()
    assert started == ["ipo-lockups-build"] and reads and _read(ilr.KIND)["status"] == "ok"
    started.clear()
    monkeypatch.setenv(T_IV.FLAG, "1")
    assert _read(ivr.KIND)["status"] == "unavailable" and started == []
    monkeypatch.setattr(IVR, "_run", lambda done, now: done.set())
    assert IVR.run_scheduled(T_IV.NOW) == {"started": True} and started == ["iv-rank-leaders"]
    started.clear()
    assert _read(cfr.KIND)["status"] == "unavailable" and started == []
    monkeypatch.setattr(F, "quiet", lambda now: True)
    monkeypatch.setattr(F, "_run", lambda done, now: done.set())
    assert F.run_scheduled(dt.datetime(2031, 3, 21, 21, 10, tzinfo=ET)) == {"started": True} and started == ["cot-finer"]


# ── the licensing record the isolation rests on ───────────────────────────────────────────────────────────────────
def test_the_licensing_register_rows_the_isolation_cites_say_what_the_adapters_say_they_say():
    register = REGISTER.read_text(encoding="utf-8")
    row = lambda r: next(ln for ln in register.splitlines() if ln.startswith(f"| {r} |"))      # noqa: E731
    assert row("T-04").startswith("| T-04 | Member display — D/W/M history") and "| **R** |" in row("T-04")
    assert row("T-09").startswith("| T-09 | Storage — `bars.db`") and "| **R** |" in row("T-09")
    assert row("T-14").startswith("| T-14 | AI processing — Massive numbers into Claude") and "| **R** |" in row("T-14")
    assert row("T-71").startswith("| T-71 | Member display — intraday + daily bars **fallback**") and "| **X** |" in row("T-71")
    assert row("T-28").startswith("| T-28 | Member display — options chain + Greeks + IV") and "| **R** |" in row("T-28")
    assert row("T-34").startswith("| T-34 | Member display — analyst estimates, grades, price targets, consensus") and "| **R** |" in row("T-34")
    assert row("T-36").startswith("| T-36 | Member display — earnings history / surprises") and "| **R** |" in row("T-36")
    assert row("T-44").startswith("| T-44 | AI processing — FMP numbers (fundamentals, analyst, earnings)") and "No AI clause" in row("T-44")
    assert row("T-48").startswith("| T-48 | Member display — float / short float / short ratio / short interest")
    assert row("T-52").startswith("| T-52 | Member display — earnings-calendar past-day backfill") and "IPO calendar" in row("T-52")
    assert row("T-53").startswith("| T-53 | Derived analytics — earnings-intel rollups") and "| **R** |" in row("T-53")
    assert row("T-54").startswith("| T-54 | AI processing — Finnhub fields in Compass / AI Search tool packs") and "| **R** |" in row("T-54")
    assert row("T-82").startswith("| T-82 | All seven uses — CFTC Commitments of Traders") and "grounding gate" in row("T-82")
    assert row("T-93").startswith("| T-93 | Member display — FINRA **short interest** per ticker") and "| **LA** |" in row("T-93")
    t99, t104, t105 = row("T-99"), row("T-104"), row("T-105")
    assert t99.startswith("| T-99 | Member display / storage — **insider cluster buys** from the SEC's own Form 4 filings")
    assert t104.startswith("| T-104 | Member display / storage — **which registered funds (mutual funds and ETFs) hold a stock**")
    assert t105.startswith("| T-105 | Member display / storage — **COT by trader type**") and "| **A** | As T-82." in t105
    for t in (t99, t104, t105):
        assert "Nothing else reads it yet (no AI lane, no export, no external publication)" in t
    rows = [ln for ln in register.splitlines() if re.match(r"\| [TN]-\d+ \|", ln)]
    for words in ("group_stats", "group_positioning", "sector_earnings", "estimate_revisions", "iv_rank_leaders", "ipo_lockups",
                  "`grps`", "`ernsc`", "`eehsc`"):
        assert not [ln for ln in rows if words in ln.lower()], words                  # no row names these studies
    cites = {grr: ("T-04", "T-09", "T-71", "T-14"), gcr: ("T-93", "T-48", "T-99", "T-104"),
             ser: ("T-36", "T-44", "T-53", "T-54", "T-04", "T-09", "T-14"), rbr: ("T-34", "T-44"), ivr: ("T-28", "T-14"),
             ilr: ("T-04", "T-09", "T-14", "T-52", "T-54"), cfr: ("T-105", "T-82", "T-104")}
    for m, cited in cites.items():                                     # each adapter says which rows, and claims no more
        doc = " ".join(m.__doc__.split())
        assert "licensing-register.md" in doc and "MODEL-ISOLATED (ADR-005; when in doubt, isolate)" in doc, m.KIND
        assert set(re.findall(r"T-\d+", doc)) == set(cited), m.KIND
        assert "for a model provider" in doc and "Shown to the member only; the capability is local-only." in doc, m.KIND
    assert "Nothing else reads it yet (no AI lane, no export, no external publication)" in " ".join(cfr.__doc__.split())


# ── the contract (MD-1 v1.17 §4.20) ───────────────────────────────────────────────────────────────────────────────
def test_the_contract_doc_states_section_4_20_and_every_note_the_adapters_emit():
    """MD-1 §4.20 quotes each note verbatim; QA pins fixtures to the doc, so the two must not drift."""
    doc = DOC.read_text(encoding="utf-8").replace("\r\n", "\n")
    head = ("### 4.20 Terminal data wave 11: `groups.rank`, `groups.crowding`, `earnings.seasonBySector`, "
            "`estimates.revisionBreadth`, `options.ivRankLeaders`, `ipo.lockups`, `cot.byTrader` (v1.17, terminal-data)")
    assert head in doc
    section = doc[doc.index(head):doc.index("## 8. Changing this contract")]
    for m in MODULES:
        assert f"`{m.KIND}`" in section and f"`{m.SOURCE}`" in section, m.KIND
        notes = {k: v for k, v in vars(m).items() if k.startswith("NOTE_")}
        assert notes, m.KIND
        for name, text in notes.items():
            assert text in section, f"{m.KIND} {name}"
        assert f"| `{m.KIND}` |" in section, m.KIND                    # its table row
    for words in [*grr.RANK_WORDS.values(), *grr.HELD_WORDS.values(), *gcr.PART_WORDS.values(), *ser.SEASON_WORDS.values(),
                  *cfr.STATE_WORDS.values()]:
        assert words in section, words                                 # the words a note is filled with
    prose = " ".join(section.split())
    for s in ("UCT_AGENT_DATA_KINDS", "UCT_AGENT_ISOLATED_KINDS", "turn.LOCAL_ONLY_ACTIONS", "**Status: dark, not armed.**",
              "**No read of this section starts a build or a request.**", "`sector_earnings_held.held_season`",
              "`estimate_revisions_held.held_breadth`", "`ipo_lockups_held.held_lockups`", "`group_stats.get_group_stats`",
              "`group_stats.get_group_positioning`", "`iv_rank_leaders.get_leaders`", "`cot_finer.market_answer`",
              "`cot_finer.board_answer`", "ESTIMATE_HISTORY_ENABLED", "OPTIONS_SCREENER_ENABLED", "row T-04", "row T-09",
              "row T-71", "row T-14", "row T-28", "row T-34", "row T-36", "row T-44", "row T-48", "row T-52", "row T-53",
              "row T-54", "row T-82", "row T-93", "row T-99", "row T-104", "row T-105", "for a model provider",
              "never the time of the read", "the builder's default", "`marketTables`", "53rd"):
        assert s in prose, s
    assert doc.index("### 4.19 Terminal data wave 10") < doc.index(head) < doc.index("## 8. Changing this contract")
    title = re.match(r"# MD-1 — UCT market-data contract \(v1\.(\d+)\)", doc)
    assert title and int(title.group(1)) >= 17
    entry = next(line for line in doc.splitlines() if line.startswith("- **v1.17 addition (2026-11-23, terminal-data, data wave 11):**"))
    assert "owed by a person" in entry and "acknowledged by the owner" not in entry      # §8.1: no acknowledgement is claimed
    assert "has not been sent" in entry and "not acknowledged by anyone" in entry
    assert "**Not armed:**" in entry and "Nothing in this entry or in §4.20 records an owner decision." in entry
    assert doc.index(entry) < doc.index("- **v1.16 addition (2026-11-23, terminal-data, data wave 10):**")
    status = next(line for line in doc.splitlines() if line.startswith("- **Status:** v1."))
    owed = re.search(r"the §8\.1 notices for ([^;)]*?) are owed by a person and are not acknowledged", status)
    assert owed and all(v in owed.group(1) for v in ("v1.9", "v1.10", "v1.11", "v1.12", "v1.13", "v1.14", "v1.15", "v1.16", "v1.17"))
    for text in (section, entry):
        for claim in ("owner approved", "owner asked", "owner decided", "approved by the owner", "will be armed", "the owner will",
                      "owner wants", "owner ruled"):
            assert claim not in text, claim
