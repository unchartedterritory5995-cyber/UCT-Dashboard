"""MD-1 kinds of terminal data wave 10: `stock.stats`, `stock.volumeFootprint`, `stock.factorExposure`, `stock.setupHistory`,
`company.publicRecords`, `ownership.funds` — the Agent half of STAT, VFP, FCTX, SETH (one stock), PUBR and the OWN panel's
N-PORT block.

No network and no real store: every held answer is put where its service keeps it BY the service, over the invented reads
its own test file already stands in for (the bar reads of `tests/test_stock_stats._world`, `tests/test_volume_footprint.
_vfp_world`, `tests/test_factor_exposure._fex_world` and `tests/test_setup_history`, the four agencies of
`tests/test_public_records.Agencies`, the SEC's data sets of `tests/test_fund_holders_nport`). Every number, name and date is
invented. Pinned per kind: an ok read (envelope conformance, every block the service's own, the data's own date as
`as_of`, or null with each section's own read time), a missing number null and never 0, the cut stated and from which end,
`unavailable` kept apart from a healthy answer with each state said in its own note, a malformed request refused before
any read, a failing service answered `unavailable`, and THE BUDGET RULE: no read works a stock out, starts a build, a thread,
a request, a download or a cache write, with the member path's own reader shown to do exactly that in the same state (so the
rail can fail). For all six: registered dark, model-isolated, dormant until armed one by one. The cross-file facts (the
services' own constants) are read from the other module rather than retyped. The licensing rows the isolation cites are
read from the register. And the contract: MD-1 §4.19 quotes every note these adapters emit.
"""
from __future__ import annotations

import datetime as dt
import inspect
import re
import threading
from pathlib import Path

import pytest

from api.services import factor_exposure as FX, factor_exposure_calc as FXC, factor_exposure_held
from api.services import fund_holders_nport as FH, fund_holders_nport_data as FHD
from api.services import held_build, held_reads, market_history
from api.services import public_records as PR, public_records_parse as PRP
from api.services import setup_history as SH, setup_history_calc as SHC, setup_history_held
from api.services import stock_stats as SS, stock_stats_calc as SSC, stock_stats_held
from api.services import volume_footprint as VF, volume_footprint_calc as VFC, volume_footprint_held
from api.services.cache import cache
from api.services.market_intel import price_reads
from api.services.uct_agent import turn as agent_turn
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import factor_exposure_read as fxr
from api.services.uct_agent.marketdata import fund_holders_read as fhr
from api.services.uct_agent.marketdata import gateway as gw
from api.services.uct_agent.marketdata import public_records_read as prr
from api.services.uct_agent.marketdata import setup_history_read as shr
from api.services.uct_agent.marketdata import stock_stats_read as ssr
from api.services.uct_agent.marketdata import volume_footprint_read as vfr
from api.services.uct_agent.marketdata.short_interest import day_as_of
from tests import test_fund_holders_nport as T_FH
from tests import test_public_records as T_PR
from tests import test_setup_history as T_SH
from tests.test_factor_exposure import _fex_world
from tests.test_stock_stats import _world as _stats_world
from tests.test_volume_footprint import _vfp_world

REPO = Path(__file__).resolve().parents[1]
MODULES = (ssr, vfr, fxr, shr, prr, fhr)
KINDS = tuple(m.KIND for m in MODULES)
#: this wave's isolation defaults (ADR-005): all six. They are the builder's defaults; a kind leaving this set is an owner
#: decision that has not been made.
ISOLATED = set(KINDS)
ACTIONS = {"stock.riskProfile", "stock.volumeFootprint", "stock.factorExposure", "stock.setupHistory", "stock.companyRecord",
           "stock.ownershipReport"}
DOC = REPO / "docs/agent/program/contracts/MD-1-market-data.md"
REGISTER = REPO / "docs/terminal-research/09-security-licensing-cost/licensing-register.md"
PRICE = (ssr, vfr, fxr, shr)
SYM = {ssr: "ZZQA", vfr: "ZZQA", fxr: "ZZQA", shr: "QZSA", prr: T_PR.SYM, fhr: "ZQAA"}
NOT_HELD_SYM = "ZZQX"
#: what a turn must never reach, per service: every builder, reader of prices, agency, download and route reader
FORBIDDEN = {
    SS: ("get_stock_stats", "build", "_read_bars", "_read_closes", "_market_answer", "market_corrections", "bench_closes"),
    VF: ("get_volume_footprint", "build", "_read_bars", "_read_earnings", "earnings"),
    FX: ("get_factor_exposure", "build", "_read_bars", "fund_set", "read_funds"),
    SH: ("get_stock", "get_study", "build_study", "_build_stock", "_read_bars", "_market", "_universe"),
    PR: ("get_public_records", "fetch_json", "_http", "_company", "_sec_submissions", "_resolve_cik", "_site_name"),
    FH: ("run_scheduled", "build", "_download", "_sec_get", "_read_splits", "ftd_pairs"),
    market_history: ("get_market_history",),
    price_reads: ("daily_bars", "daily_closes"),
    held_build.HeldBuild: ("get", "_start", "_run"),
    held_reads.KeyedHeld: ("get",),
}


# ── holding each answer, by its own service ───────────────────────────────────────────────────────────────────
def _hold_stats(mp):
    w = _stats_world(mp)
    mp.setattr(SS, "_is_trading_day", lambda d: d.weekday() < 5)
    return SS.get_stock_stats("ZZQA"), w


def _hold_footprint(mp):
    w = _vfp_world(mp)
    return VF.get_volume_footprint("ZZQA"), w


def _hold_exposure(mp):
    w = _fex_world(mp)
    return FX.get_factor_exposure("ZZQA"), w


def _setup_world(mp, seen=None):
    mp.setattr(SH, "_universe", lambda: list(T_SH.SYMS))
    mp.setattr(SH, "_market", lambda wait_s: T_SH._market())
    mp.setattr(SH, "evening_key", lambda now: T_SH.KEY)
    mp.setattr(SH, "now_et", lambda: T_SH.SATURDAY)
    mp.setattr(SH, "HISTORY_YEARS", 2)
    mp.setattr(SH, "_read_bars", T_SH._reader(seen))


def _hold_setups(mp, study=True):
    _setup_world(mp)
    if study:
        SH.get_study()
        SH._STUDY.drain(30)
    ans = SH.get_stock("QZSA")
    if ans.get("status") == "computing":
        SH._STOCK.drain(30)
        ans = SH.get_stock("QZSA")
    return ans


def _records_world(mp):
    fake = T_PR.Agencies()
    mp.setattr(PR, "_http", fake)
    mp.setattr(PR, "_sleep", lambda s: None)
    mp.setattr(PR, "_today", lambda: T_PR.TODAY)
    mp.setattr(PR, "_site_name", lambda sym: "Kestrel Dynamics Corporation" if sym == T_PR.SYM else None)
    mp.setattr(PR, "_resolve_cik", lambda sym: "0009990001" if sym == T_PR.SYM else None)
    mp.setattr(PR, "_sec_submissions", lambda cik: {"name": "KESTREL DYNAMICS CORP", "formerNames": []})
    return fake


def _hold_records(mp):
    fake = _records_world(mp)
    return T_PR._full(), fake


def _hold_funds(mp, tmp_path):
    mp.setattr(FH, "ftd_pairs", lambda: dict(T_FH.FTD))
    mp.setattr(FH, "quiet", lambda now: True)
    mp.setattr(FH, "PAUSE_S", 0.0)
    mp.setattr(FH, "_read_splits", lambda a, b: [])
    out, calls = T_FH._built(tmp_path, mp)
    assert out["state"] == "built"
    return FH.answer_for("ZQAA"), calls


# ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────────────
def _forget():
    for svc in (SS, VF, FX, SH, PR, FH):
        svc.reset_for_tests()


@pytest.fixture(autouse=True)
def world(monkeypatch, tmp_path):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(KINDS))
    monkeypatch.setenv(gw.ISOLATED_ENV, "1")
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(sorted(ISOLATED)))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    # the price studies' clocks: an invented evening, the same one their own test files use
    for svc in (SS, VF, FX):
        monkeypatch.setattr(svc, "session_key", lambda now: "2031-06-02")
        monkeypatch.setattr(svc, "now_et", lambda: dt.datetime(2031, 6, 3, 12, 0))
        # speed pass 2 (2026-11-24): the route readers answer `computing` while one background build runs; these
        # rails read the services' own answers back, so each route read here waits for the build it started
        monkeypatch.setattr(svc, "WAIT_S", 10.0)
    monkeypatch.setattr(SH, "evening_key", lambda now: T_SH.KEY)
    monkeypatch.setattr(SH, "now_et", lambda: T_SH.SATURDAY)
    _forget()
    gw._reset_for_test(None)
    yield tmp_path
    SH._STUDY.drain(10)
    SH._STOCK.drain(10)
    PR.drain_for_tests(10)
    for svc in (SS, VF, FX):
        svc.drain_for_tests()
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
    return gw.read(kind, {"symbol": SYM[m]} if params is None else params, user_id=1, turn_id=f"w10-{next(_turn)}",
                   purpose=purpose)


def _conforms(out, kind):
    assert env.validate_envelope(out) == [], out
    assert out["kind"] == kind
    assert out["provider_calls"] == 0                                # no kind of this wave ever spends a provider call
    if out["status"] in ("ok", "partial"):
        assert env.FRESHNESS.index(out["freshness"]) >= env.FRESHNESS.index(gw.registry().get(kind).freshness)
        assert out["freshness"] == ("periodic" if kind in (prr.KIND, fhr.KIND) else "historical")
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
    return re.compile(".+?".join(re.escape(p) for p in re.split(r"\{\w+\}", template)), re.S)


def _note(out, template):
    hits = [n for n in out["notes"] if _made_from(template).fullmatch(n)]
    assert len(hits) == 1, (template, out["notes"])
    return hits[0]


def _lacks(out, template):
    return not [n for n in out["notes"] if _made_from(template).fullmatch(n)]


def _unavailable(out, kind, note):
    _conforms(out, kind)
    assert out["status"] == "unavailable" and out["notes"] == [note], out["notes"]


# ── registration, dark by default, isolation ──────────────────────────────────────────────────────────────────
def test_all_six_kinds_are_registered_once_by_their_modules_and_all_six_are_isolated():
    r = gw.registry()
    for m in MODULES:
        k = r.get(m.KIND)
        assert k is not None and k.owner == "terminal-data" and k.category == "market", m.KIND
        assert k.validate is m.validate and k.description
        assert k.model_isolated is True, m.KIND
        assert "Shown to the member only" in k.description and "never the time of the read" in k.description, m.KIND
        assert "never a build or a request" in k.description, m.KIND
    assert {r.get(k).freshness for k in KINDS} == {"periodic"}       # none is ever declared live or delayed
    assert [r.get(k).max_symbols for k in KINDS] == [1] * 6
    assert KINDS == ("stock.stats", "stock.volumeFootprint", "stock.factorExposure", "stock.setupHistory",
                     "company.publicRecords", "ownership.funds")
    assert [m.SOURCE for m in MODULES] == ["uct-stock-stats", "uct-volume-footprint", "uct-factor-exposure",
                                           "uct-setup-history", "public-records", "sec-form-nport"]
    assert [r.get(k).fn.__name__ for k in KINDS] == ["read_stats", "read_footprint", "read_exposure", "read_signals",
                                                     "read_records", "read_funds"]
    assert ACTIONS <= set(agent_turn.LOCAL_ONLY_ACTIONS)
    assert not ACTIONS & set(agent_turn.DATA_READ_ACTIONS)


def test_dark_unless_the_gateway_is_on_and_the_kind_is_named(world, monkeypatch):
    ran = []
    for m in MODULES:
        monkeypatch.setattr(m, "held_answer", lambda *a, _m=m: ran.append(_m.KIND) or (None, "not_held"))
    monkeypatch.setenv(gw.KINDS_ENV, "quote,themes,bars.daily,seasonality.stock,stock.setups")
    for kind in KINDS:
        out = _read(kind)
        assert out["status"] == "refused" and gw.KINDS_ENV in out["notes"][0], kind
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(KINDS))
    monkeypatch.delenv(gw.DATA_ENV)
    for kind in KINDS:
        assert _read(kind)["status"] == "refused", kind
    assert ran == []


def test_isolated_kinds_are_dormant_until_armed_by_name_and_answer_the_member_only(world, monkeypatch):
    _hold_stats(monkeypatch)
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, "")
    for kind in KINDS:
        out = _read(kind)
        assert out["status"] == "refused" and _plain(out["data"]) is None, kind
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ssr.KIND)                 # arming ONE arms one
    assert _read(ssr.KIND)["status"] == "ok"
    for kind in KINDS[1:]:
        assert _read(kind)["status"] == "refused", kind
    for purpose in ("research", "scan"):                                # never for a model's research
        assert _read(ssr.KIND, purpose=purpose)["status"] == "refused"
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(sorted(ISOLATED)))
    assert _read(vfr.KIND)["status"] == "unavailable"                   # armed: read, and nothing is held
    monkeypatch.delenv(gw.ISOLATED_ENV)                                 # the master switch turns all six off
    for kind in KINDS:
        assert _read(kind)["status"] == "refused", kind


def test_the_bounds_fields_and_words_are_the_services_own():
    assert ssr.MAX_ROWS == SSC.DRAWDOWNS_SHOWN and "jumps[-20:]" in inspect.getsource(SS.build) and ssr.JUMPS_SHOWN == 20
    src = inspect.getsource(SS.market_corrections)
    for state in ssr.CORRECTION_WORDS:
        assert f'"{state}"' in src, state
    assert vfr.MAX_ROWS == VFC.GAPS_SHOWN
    assert set(vfr.EARNINGS_WORDS) == {"not_held", "no_dates"} and all(f'"{s}"' in inspect.getsource(VF.earnings) for s in vfr.EARNINGS_WORDS)
    assert fxr.FACTOR_KEYS == FXC.FACTOR_KEYS
    assert set(fxr.WINDOW_WORDS) == {"short", "singular"} and all(f'"state": "{s}"' in inspect.getsource(FXC.fit) for s in fxr.WINDOW_WORDS)
    assert shr.HORIZONS == SHC.HORIZONS
    assert prr.MAX_ROWS == PRP.AWARD_CAP and prr.NAMES_SHOWN == PRP.NOT_COUNTED_CAP and prr.SECTIONS == PR.SECTIONS
    for name, fields in prr.ROW_FIELDS.items():                         # each row field is the parser's own name
        shaping = inspect.getsource({"awards": PRP.award_rows, "active": PRP.study_rows, "actions": PRP.shape_fda}[name])
        for f in fields:
            assert f'"{f}"' in shaping, (name, f)
    shaping = inspect.getsource(PRP.shape_lobbying) + inspect.getsource(PRP.last_quarters)
    for f in prr.QUARTER_FIELDS:
        assert f'"{f}"' in shaping, f
    assert fhr.MAX_ROWS == FH.DISPLAY_ROWS and fhr.CHANGE_STATES == FHD.STATES
    for f in fhr.HOLDER_FIELDS + fhr.SOLD_FIELDS:
        assert f'"{f}"' in inspect.getsource(FH._fund) + inspect.getsource(FH.answer_for), f
    for fn in (ssr.held_answer, vfr.held_answer, fxr.held_answer, shr.held_answer, prr.held_answer, fhr.held_answer,
               stock_stats_held.held_stats, volume_footprint_held.held_footprint, factor_exposure_held.held_exposure,
               setup_history_held.held_signals, PR.held_records):
        assert "READ ONLY" in fn.__doc__, fn.__qualname__
    assert "read-only SQLite read" in fhr.held_answer.__doc__ and "never downloads" in FH.__doc__.replace("\n", " ")


# ── stock.stats ───────────────────────────────────────────────────────────────────────────────────────────────
def test_stats_reads_the_held_answer_with_every_block_the_services_own(world, work, monkeypatch):
    served, w = _hold_stats(monkeypatch)
    work["threads"].clear()
    out = _read(ssr.KIND, {"symbol": "zzqa", "rows": ssr.MAX_ROWS})
    _conforms(out, ssr.KIND)
    assert out["status"] == "ok" and out["source"] == ssr.SOURCE and out["stale"] is False
    d = _plain(out["data"])
    for k in ("volatility", "beta", "returns"):
        assert d[k] == served[k], k                                  # the service's own blocks, passed through
    assert d["drawdowns"]["episodes"] == served["drawdowns"]["episodes"][:ssr.MAX_ROWS]
    assert {k: v for k, v in d["corrections"].items()} == {k: v for k, v in served["corrections"].items() if k != "episodes"}
    assert (d["symbol"], d["data_through"], d["session"], d["stale_for"]) == ("ZZQA", "2031-06-02", "2031-06-02", [])
    assert out["as_of"] == ssr.close_as_of("2031-06-02") and out["as_of"].startswith("2031-06-02T")
    assert d["read_at"] == env.utc_iso(dt.datetime.fromisoformat(served["built_at"]))
    assert out["notes"][:2] == [ssr.NOTE_WHAT.format(symbol="ZZQA", first=served["first"], through="2031-06-02", sessions=served["sessions"]),
                                ssr.NOTE_AS_OF.format(day="2031-06-02", at=d["read_at"])]
    assert out["notes"][-1] == ssr.NOTE_LEFT_OUT and d["left_out"] == ["correction_episodes"]
    assert _note(out, ssr.NOTE_CORRECTIONS) == ssr.NOTE_CORRECTIONS.format(why=ssr.CORRECTION_WORDS["computing"])
    assert w["reads"] == ["ZZQA"] and _quiet(work)


def test_stats_a_benchmark_not_stated_is_said_and_null_never_zero_and_the_declines_are_cut_from_the_old_end(world, monkeypatch):
    _stats_world(monkeypatch, groups={})                               # no sector held: the sector fund cannot be named
    monkeypatch.setattr(SS, "_is_trading_day", lambda d: d.weekday() < 5)
    served = SS.get_stock_stats("ZZQA")
    out = _read(ssr.KIND, {"symbol": "ZZQA", "rows": 1})
    d = _plain(out["data"])
    assert d["beta"]["sector"] == {"state": "no_sector"} and "beta" not in d["beta"]["sector"]
    assert _note(out, ssr.NOTE_BENCH) == ssr.NOTE_BENCH.format(n=1, what="the sector fund (no sector is held for the stock)")
    total = served["drawdowns"]["total"]
    if total > 1:
        assert _note(out, ssr.NOTE_CUT) == ssr.NOTE_CUT.format(total=total, shown=1) and "cut from the OLD end" in ssr.NOTE_CUT
    assert len(d["drawdowns"]["episodes"]) == min(1, total) and d["drawdowns"]["shown"] == min(1, total)
    # a statistic the history is too short for keeps the service's `short` block: never a 0
    held, _ = stock_stats_held.held_stats("ZZQA")
    short = {**held, "volatility": {**held["volatility"], "atr": {"state": "short", "needed": 15, "held": 9, "unit": "sessions"}}}
    monkeypatch.setattr(ssr, "held_answer", lambda sym: (short, "held"))
    assert _plain(_read(ssr.KIND)["data"])["volatility"]["atr"] == {"state": "short", "needed": 15, "held": 9, "unit": "sessions"}


def test_stats_an_earlier_sessions_answer_or_closes_that_stop_short_are_stale_and_nothing_is_worked_out(world, work, monkeypatch):
    served, w = _hold_stats(monkeypatch)
    monkeypatch.setattr(SS, "session_key", lambda now: "2031-06-03")   # a newer evening has begun
    work["threads"].clear()
    out = _read(ssr.KIND)
    _conforms(out, ssr.KIND)
    assert out["status"] == "ok" and out["stale"] is True and out["data"]["stale_for"] == ["earlier_session"]
    assert _note(out, ssr.NOTE_OLD_SESSION) == ssr.NOTE_OLD_SESSION.format(session="2031-06-02", current="2031-06-03", code="STAT", symbol="ZZQA")
    assert w["reads"] == ["ZZQA"] and _quiet(work)                     # never worked out again
    lag = {**served, "session": "2031-06-02", "data_through": "2031-05-30"}
    monkeypatch.setattr(SS, "session_key", lambda now: "2031-06-02")
    monkeypatch.setattr(ssr, "held_answer", lambda sym: (lag, "held"))
    out = _read(ssr.KIND)
    assert out["data"]["stale_for"] == ["closes_short"] and _note(out, ssr.NOTE_LAGGING)
    assert out["as_of"] == ssr.close_as_of("2031-05-30")


def test_stats_nothing_held_a_held_no_prices_answer_bad_requests_and_a_failing_service(world, work, monkeypatch):
    _unavailable(_read(ssr.KIND, {"symbol": NOT_HELD_SYM}), ssr.KIND, ssr.NOTE_NOT_HELD.format(symbol=NOT_HELD_SYM))
    assert "not the same as no statistics" in ssr.NOTE_NOT_HELD and SS._cache == {} and _quiet(work)
    monkeypatch.setattr(ssr, "held_answer", lambda sym: ({"status": "not_held", "symbol": sym, "detail": "x"}, "held"))
    _unavailable(_read(ssr.KIND), ssr.KIND, ssr.NOTE_NO_PRICES.format(symbol="ZZQA"))
    ran = []
    monkeypatch.setattr(ssr, "held_answer", lambda sym: ran.append(1) or (_ for _ in ()).throw(RuntimeError("x")))
    for bad in ({}, {"symbol": "not a ticker"}, {"symbol": "ZZQA", "rows": 0}, {"symbol": "ZZQA", "rows": ssr.MAX_ROWS + 1},
                {"symbol": "ZZQA", "rows": True}, {"symbol": 5}):
        out = _read(ssr.KIND, bad)
        assert out["status"] in ("refused", "unavailable") and _plain(out["data"]) is None, bad
    assert ran == []
    _unavailable(_read(ssr.KIND), ssr.KIND, ssr.NOTE_FAILED)
    for junk in (("x", "held"), ({"status": "ok", "data_through": None, "built_at": "2031-06-03T00:40:00+00:00"}, "held"),
                 ({"status": "ok", "data_through": "2031-06-02", "built_at": None}, "held"), ({"status": "busy"}, "held"),
                 ({"status": "ok", "data_through": "2031-06-02", "built_at": "2031-06-03T00:40:00+00:00"}, "weird")):
        monkeypatch.setattr(ssr, "held_answer", lambda sym, _j=junk: _j)
        _unavailable(_read(ssr.KIND), ssr.KIND, ssr.NOTE_FAILED)


# ── stock.volumeFootprint ─────────────────────────────────────────────────────────────────────────────────────
def test_footprint_reads_the_held_answer_with_every_count_the_services_own_and_cuts_its_lists(world, work, monkeypatch):
    served, w = _hold_footprint(monkeypatch)
    work["threads"].clear()
    out = _read(vfr.KIND, {"symbol": "ZZQA", "rows": 1})
    _conforms(out, vfr.KIND)
    d = _plain(out["data"])
    assert d["accumulation"] == {k: v for k, v in served["accumulation"].items() if k != "days"}
    assert d["earnings"] == served["earnings"] and d["earnings"]["state"] == "not_held"
    for k in ("pivots", "gaps"):
        assert {x: v for x, v in d[k].items() if x not in ("rows", "last")} == {x: v for x, v in served[k].items() if x != "rows"}, k
        assert d[k]["rows"] == served[k]["rows"][:1], k
    assert d["pivots"]["last"] == (served["pivots"]["rows"][0]["date"] if served["pivots"]["rows"] else None)
    assert out["as_of"] == vfr.close_as_of("2031-06-02") and d["left_out"] == ["big_days", "ad_days"]
    assert _note(out, vfr.NOTE_EARNINGS) == vfr.NOTE_EARNINGS.format(why=vfr.EARNINGS_WORDS["not_held"])
    if served["gaps"]["total"] > 1:
        assert _note(out, vfr.NOTE_CUT_GAPS) == vfr.NOTE_CUT_GAPS.format(total=served["gaps"]["total"], shown=1)
    if served["pivots"]["count"] > 1:
        assert _note(out, vfr.NOTE_CUT_PIVOTS) == vfr.NOTE_CUT_PIVOTS.format(total=served["pivots"]["count"], shown=1)
    assert out["notes"][-1] == vfr.NOTE_LEFT_OUT and w["reads"] == ["ZZQA"] and _quiet(work)
    # a ratio the service left null stays null, never 0
    held, _ = volume_footprint_held.held_footprint("ZZQA")
    noratio = {**held, "accumulation": {**held["accumulation"], "updown": {**held["accumulation"]["updown"], "ratio": None, "no_volume": 2}}}
    monkeypatch.setattr(vfr, "held_answer", lambda sym: (noratio, "held"))
    assert _plain(_read(vfr.KIND)["data"])["accumulation"]["updown"]["ratio"] is None


def test_footprint_nothing_held_stale_bad_requests_and_a_failing_service(world, work, monkeypatch):
    _unavailable(_read(vfr.KIND, {"symbol": NOT_HELD_SYM}), vfr.KIND, vfr.NOTE_NOT_HELD.format(symbol=NOT_HELD_SYM))
    assert VF._cache == {} and _quiet(work)
    _hold_footprint(monkeypatch)
    monkeypatch.setattr(VF, "session_key", lambda now: "2031-06-03")
    out = _read(vfr.KIND)
    assert out["stale"] is True and _note(out, ssr.NOTE_OLD_SESSION).endswith("Open VFP for ZZQA in UCT, then ask again")
    for bad in ({"symbol": "ZZQA", "rows": 61}, {"symbol": "ZZQA", "rows": "5"}, {"rows": 5}):
        assert _read(vfr.KIND, bad)["status"] in ("refused", "unavailable"), bad
    monkeypatch.setattr(vfr, "held_answer", lambda sym: (_ for _ in ()).throw(RuntimeError("x")))
    _unavailable(_read(vfr.KIND), vfr.KIND, vfr.NOTE_FAILED)


# ── stock.factorExposure ──────────────────────────────────────────────────────────────────────────────────────
def test_exposure_reads_the_held_answer_the_servers_reading_and_every_loading_with_its_t(world, work, monkeypatch):
    served, w = _hold_exposure(monkeypatch)
    work["threads"].clear()
    out = _read(fxr.KIND)
    _conforms(out, fxr.KIND)
    d = _plain(out["data"])
    assert d["now"] == served["now"] and d["reading"] == served["reading"] and d["factors"] == served["factors"]
    assert d["method"] == served["method"] and d["left_out"] == ["then", "change", "reading_then", "fund_checks"]
    assert "then" not in d and "change" not in d and "fund_checks" not in d
    for r in d["now"]["loadings"]:
        assert set(r) >= {"key", "loading", "se", "t", "clears", "vif"}
    assert out["as_of"] == fxr.close_as_of("2031-06-02")
    assert out["coverage"]["answered"] == len(served["now"]["loadings"])
    assert w["reads"] == list(FXC.FACTORS[0]["options"][0]) + ["IWM", "IWF", "IWD", "MTUM", "QUAL", "USMV", "ZZQA"] and _quiet(work)
    # a window not fitted states no reading and says so; an unstable fit is said with its factor
    held, _ = factor_exposure_held.held_exposure("ZZQA")
    monkeypatch.setattr(fxr, "held_answer", lambda sym: ({**held, "now": {"state": "short", "needed": 200, "held": 90, "unit": "returns"}}, "held"))
    out = _read(fxr.KIND)
    assert _plain(out["data"])["reading"] is None and _note(out, fxr.NOTE_NOT_FITTED) == fxr.NOTE_NOT_FITTED.format(why=fxr.WINDOW_WORDS["short"])
    wobbly = {**held, "now": {**held["now"], "unstable": True, "max_vif": {"key": "momentum", "value": 6.4}}}
    monkeypatch.setattr(fxr, "held_answer", lambda sym: (wobbly, "held"))
    assert _note(_read(fxr.KIND), fxr.NOTE_UNSTABLE) == fxr.NOTE_UNSTABLE.format(vif=6.4, factor="Momentum", limit=5.0)


def test_exposure_nothing_held_never_reads_the_fund_set_and_a_substituted_fund_is_said(world, work, monkeypatch):
    _unavailable(_read(fxr.KIND, {"symbol": NOT_HELD_SYM}), fxr.KIND, fxr.NOTE_NOT_HELD.format(symbol=NOT_HELD_SYM))
    assert FX._funds == {} and _quiet(work)                           # the fund set is never read by a turn
    _fex_world(monkeypatch, drop=("IWM",))
    FX.get_factor_exposure("ZZQA")
    out = _read(fxr.KIND)
    assert _note(out, fxr.NOTE_SUBSTITUTED) == fxr.NOTE_SUBSTITUTED.format(n=1, what="Size (VTWO minus SPY)")


# ── stock.setupHistory ────────────────────────────────────────────────────────────────────────────────────────
def test_setups_reads_the_held_signals_per_setup_with_the_universe_lines_the_route_attaches(world, work, monkeypatch):
    served = _hold_setups(monkeypatch)
    assert served["status"] == "ok" and served["universe"]["state"] == "ok"
    work["threads"].clear()
    out = _read(shr.KIND, {"symbol": "QZSA", "rows": 1})
    _conforms(out, shr.KIND)
    d = _plain(out["data"])
    per = {}
    for r in served["signals"]:
        per.setdefault(r["setup"], r)                                  # the newest of each setup
    assert sorted((r["date"], r["setup"]) for r in d["signals"]) == sorted((r["date"], r["setup"]) for r in per.values())
    assert d["signals"] == sorted(d["signals"], key=lambda r: r["date"], reverse=True)
    assert d["total"] == served["total"] and d["shown"] == len(per) and d["library"] == served["library"]
    assert d["universe"]["state"] == "ok"
    for r in d["signals"]:
        key = f"{r['setup']}|{r['phase'] or 'all'}"
        assert d["universe"]["lines"][key] == served["universe"]["lines"][key], key
    assert set(d["universe"]["lines"]) == {f"{r['setup']}|{r['phase'] or 'all'}" for r in d["signals"]}
    assert _note(out, shr.NOTE_HINDSIGHT) and out["as_of"] == shr.close_as_of(T_SH.KEY)
    if served["total"] > len(per):
        assert _note(out, shr.NOTE_CUT) == shr.NOTE_CUT.format(total=served["total"], symbol="QZSA", rows=1, shown=len(per))
    assert _quiet(work)
    # each return is the service's own (one the history cannot reach yet stays null, never 0)
    for r in d["signals"]:
        for h, v in r["returns"].items():
            assert v == next(s for s in served["signals"] if s["date"] == r["date"] and s["setup"] == r["setup"])["returns"][h]


def test_setups_a_study_not_held_is_said_and_nothing_is_built(world, work, monkeypatch):
    _unavailable(_read(shr.KIND, {"symbol": NOT_HELD_SYM}), shr.KIND, shr.NOTE_NOT_HELD.format(symbol=NOT_HELD_SYM))
    assert SH._STOCK.keys() == [] and SH.held_study() is None and _quiet(work)
    _hold_setups(monkeypatch, study=False)                              # the stock is held (its route also asks for the study)
    SH._STUDY.drain(30)
    SH._STUDY.reset()                                                   # the study is not held: memory and the disk copy gone
    (world / "setup_history" / "setup_history_v1.json").unlink(missing_ok=True)
    work["threads"].clear()
    assert SH.held_study() is None
    out = _read(shr.KIND)
    assert _plain(out["data"])["universe"] == {"state": "not_held"}
    assert _note(out, shr.NOTE_UNIVERSE) == shr.NOTE_UNIVERSE.format(why=shr.UNIVERSE_WORDS["not_held"])
    assert _quiet(work)
    for bad in ({"symbol": "QZSA", "rows": 21}, {"symbol": "", "rows": 3}):
        assert _read(shr.KIND, bad)["status"] in ("refused", "unavailable"), bad


# ── company.publicRecords ─────────────────────────────────────────────────────────────────────────────────────
def test_records_reads_each_held_section_with_its_agencys_own_words_and_never_asks(world, work, monkeypatch):
    served, fake = _hold_records(monkeypatch)
    asked = len(fake.calls)
    work["threads"].clear()
    out = _read(prr.KIND, {"symbol": T_PR.SYM, "rows": 1})
    _conforms(out, prr.KIND)
    assert out["status"] == "ok" and out["as_of"] is None and out["notes"][:2] == [prr.NOTE_WHAT.format(symbol=T_PR.SYM), prr.NOTE_AS_OF]
    d = _plain(out["data"])
    for k in prr.SECTIONS:
        assert d[k]["state"] == served[k]["state"] and d[k]["credit"] == prr.CREDITS[k], k
        assert d[k]["counted"] == [{f: n.get(f) for f in prr.NAME_FIELDS} for n in served[k]["counted"]][:prr.NAMES_SHOWN], k
    assert d["contracts"]["recent_total"] == served["contracts"]["recent_total"] and d["contracts"]["prior_total"] == served["contracts"]["prior_total"]
    assert d["contracts"]["awards"] == [{f: a.get(f) for f in prr.ROW_FIELDS["awards"]} for a in served["contracts"]["awards"]][:1]
    assert d["trials"]["by_phase"] == served["trials"]["by_phase"] and d["trials"]["data_processed"] == served["trials"]["data_processed"]
    assert d["fda"]["actions_matched"] == served["fda"]["actions_matched"] and d["fda"]["notice"] == served["fda"]["notice"]
    assert d["lobbying"]["quarters"] == [{f: q.get(f) for f in prr.QUARTER_FIELDS} for q in served["lobbying"]["quarters"]]
    assert d["company"]["state"] == "ok" and d["company"]["names"]
    assert len(fake.calls) == asked and _quiet(work)


def test_records_a_section_not_held_is_said_and_no_match_is_never_none_exist(world, work, monkeypatch):
    _unavailable(_read(prr.KIND, {"symbol": NOT_HELD_SYM}), prr.KIND, prr.NOTE_NOT_HELD.format(symbol=NOT_HELD_SYM))
    assert _quiet(work)
    held = {"status": "ok", "sym": "QQZA", "company": {"status": "computing"},
            "contracts": {"status": "ok", "state": "no_match", "section": "contracts", "source": "x", "read_at": "2030-05-14T10:00:00+00:00",
                          "counted": [], "not_counted": [], "not_counted_total": 3, "recent_total": None, "prior_total": None},
            "trials": {"status": "not_held", "section": "trials"}, "fda": {"status": "not_held", "section": "fda"},
            "lobbying": {"status": "ok", "state": "no_name", "section": "lobbying", "counted": [], "not_counted": [], "not_counted_total": 0}}
    monkeypatch.setattr(prr, "held_answer", lambda sym: held)
    out = _read(prr.KIND, {"symbol": "QQZA"})
    _conforms(out, prr.KIND)
    assert out["status"] == "partial"
    assert _note(out, prr.NOTE_NOT_HELD_SECTIONS) == prr.NOTE_NOT_HELD_SECTIONS.format(n=2, what="clinical trials, FDA approvals")
    assert _note(out, prr.NOTE_NO_MATCH) == prr.NOTE_NO_MATCH.format(n=1, what="federal contracts")
    assert "no record matched" in prr.NOTE_NO_MATCH and "not the same as no record existing" in prr.NOTE_NO_MATCH
    assert _note(out, prr.NOTE_NO_NAME) and _note(out, prr.NOTE_COMPANY)
    d = _plain(out["data"])
    assert d["contracts"]["recent_total"] is None and d["trials"] == {"source": None, "source_url": None, "credit": prr.CREDITS["trials"], "state": "not_held"}
    monkeypatch.setattr(prr, "held_answer", lambda sym: {"status": "ok"})
    _unavailable(_read(prr.KIND, {"symbol": "QQZA"}), prr.KIND, prr.NOTE_FAILED)


# ── ownership.funds ───────────────────────────────────────────────────────────────────────────────────────────
def test_funds_reads_the_held_index_with_every_count_and_holder_the_blocks_own(world, work, tmp_path, monkeypatch):
    served, calls = _hold_funds(monkeypatch, tmp_path)
    asked = len(calls)
    work["threads"].clear()
    out = _read(fhr.KIND, {"symbol": "ZQAA", "rows": 2})
    _conforms(out, fhr.KIND)
    d = _plain(out["data"])
    assert d["state"] == "ok" and d["summary"] == {k: served["summary"].get(k) for k in fhr.SUMMARY_FIELDS}
    assert d["holders"] == [{k: h.get(k) for k in fhr.HOLDER_FIELDS} for h in served["holders"]][:2]
    assert d["holders_total"] == served["holders_total"] and d["sold_out_total"] == served["sold_out_total"]
    assert d["data_set"]["quarter"] == "2031Q3" and d["coverage"]["matched_rows_pct"] == served["coverage"]["matched_rows_pct"]
    day = served["summary"]["period_to"]
    assert out["as_of"] == day_as_of(day) and _note(out, fhr.NOTE_AS_OF)
    assert _note(out, fhr.NOTE_CUT_HOLDERS) == fhr.NOTE_CUT_HOLDERS.format(total=served["holders_total"], shown=2)
    assert "cusip" not in str(d).lower()
    assert len(calls) == asked and _quiet(work)


def test_funds_not_read_yet_not_matched_and_an_unreadable_index_are_each_said(world, work, tmp_path, monkeypatch):
    _unavailable(_read(fhr.KIND, {"symbol": "ZQAA"}), fhr.KIND, fhr.NOTE_NOT_READ.format(symbol="ZQAA"))
    assert "not the same as no fund holding it" in fhr.NOTE_NOT_READ and _quiet(work)
    _hold_funds(monkeypatch, tmp_path)
    out = _read(fhr.KIND, {"symbol": "ZQZZ"})
    _conforms(out, fhr.KIND)
    assert out["status"] == "ok" and out["data"]["state"] == "not_matched"
    assert _note(out, fhr.NOTE_NOT_MATCHED) == fhr.NOTE_NOT_MATCHED.format(quarter="2031Q3", symbol="ZQZZ")
    monkeypatch.setattr(fhr, "held_answer", lambda sym: {"state": "unavailable"})
    _unavailable(_read(fhr.KIND, {"symbol": "ZQAA"}), fhr.KIND, fhr.NOTE_UNREADABLE)
    monkeypatch.setattr(fhr, "held_answer", lambda sym: (_ for _ in ()).throw(RuntimeError("x")))
    _unavailable(_read(fhr.KIND, {"symbol": "ZQAA"}), fhr.KIND, fhr.NOTE_FAILED)


# ── THE BUDGET RULE ───────────────────────────────────────────────────────────────────────────────────────────
def _forbid(mp, reached):
    for owner, names in FORBIDDEN.items():
        for name in names:
            assert callable(getattr(owner, name)), (getattr(owner, "__name__", owner), name)   # a rename fails here, by name
            label = f"{getattr(owner, '__name__', type(owner).__name__)}.{name}"
            mp.setattr(owner, name, lambda *a, _n=label, **kw: reached.append(_n) or (_ for _ in ()).throw(AssertionError(_n)))
    mp.setattr(cache, "set", lambda *a, **kw: reached.append("cache.set") or (_ for _ in ()).throw(AssertionError("cache.set")))


def test_no_read_of_this_wave_works_anything_out_starts_a_thread_asks_an_agency_or_downloads_held_or_not(world, work, tmp_path, monkeypatch):
    """Every entry point that can cause work is replaced by one that fails and counts, named per service: the price studies'
    route readers, builders and price reads (and MKTH's reader, which can start its build), the fund set's reader, SETH's
    study and stock builders, PUBR's route reader, agency fetch and company-name reads, the N-PORT run, downloads and split
    read, the shared holds' get, start and run, and the shared cache's writer."""
    reached = []
    reads = [(m.KIND, {"symbol": SYM[m]}) for m in MODULES]
    with pytest.MonkeyPatch.context() as mp:                            # nothing held anywhere
        _forbid(mp, reached)
        for kind, params in reads:
            out = _read(kind, params)
            _conforms(out, kind)
            assert out["status"] == "unavailable", (kind, out["notes"])
        assert reached == [] and _quiet(work)
    _hold_stats(monkeypatch)
    _hold_footprint(monkeypatch)
    _hold_exposure(monkeypatch)
    _hold_setups(monkeypatch)
    _hold_records(monkeypatch)
    _hold_funds(monkeypatch, tmp_path)
    for svc in (SS, VF, FX):                                            # and every price study is due again
        monkeypatch.setattr(svc, "session_key", lambda now: "2031-06-09")
    work["threads"].clear()
    with pytest.MonkeyPatch.context() as mp:                            # everything held, everything due
        _forbid(mp, reached)
        for kind, params in reads:
            out = _read(kind, params)
            _conforms(out, kind)
            assert out["status"] in ("ok", "partial"), (kind, out["notes"])
        assert reached == [] and _quiet(work)


def test_the_member_paths_own_readers_do_that_work_in_the_same_state_so_the_rail_can_fail(world, tmp_path, monkeypatch):
    """The contrast: where the adapter answers from what is held, the reader the member path uses works it out."""
    w = _stats_world(monkeypatch)
    monkeypatch.setattr(SS, "_is_trading_day", lambda d: d.weekday() < 5)
    assert _read(ssr.KIND)["status"] == "unavailable" and w["reads"] == []
    SS.get_stock_stats("ZZQA")
    assert w["reads"] == ["ZZQA"] and _read(ssr.KIND)["status"] == "ok"
    w = _vfp_world(monkeypatch)
    assert _read(vfr.KIND)["status"] == "unavailable" and w["reads"] == []
    VF.get_volume_footprint("ZZQA")
    assert w["reads"] == ["ZZQA"] and _read(vfr.KIND)["status"] == "ok"
    w = _fex_world(monkeypatch)
    assert _read(fxr.KIND)["status"] == "unavailable" and w["reads"] == [] and FX._funds == {}
    FX.get_factor_exposure("ZZQA")
    assert "ZZQA" in w["reads"] and "SPY" in w["reads"] and _read(fxr.KIND)["status"] == "ok"
    seen = []
    _setup_world(monkeypatch, seen)
    assert _read(shr.KIND)["status"] == "unavailable" and seen == []
    SH.get_stock("QZSA")
    SH._STOCK.drain(30)
    assert ("QZSA", None) in seen and _read(shr.KIND)["status"] == "ok"
    fake = _records_world(monkeypatch)
    assert _read(prr.KIND)["status"] == "unavailable" and fake.calls == []
    PR.get_public_records(T_PR.SYM, wait_s=0)
    PR.drain_for_tests(10)
    PR.drain_for_tests(10)
    assert fake.calls and _read(prr.KIND)["status"] == "ok"
    assert _read(fhr.KIND)["status"] == "unavailable"
    started = []
    monkeypatch.setattr(threading.Thread, "start", lambda self: started.append(self.name))
    assert FH.run_scheduled(T_FH.QUIET_NOW) == {"started": True} and started == ["fund-holders-nport"]


# ── the licensing record the isolation rests on ───────────────────────────────────────────────────────────────
def test_the_licensing_register_rows_the_isolation_cites_say_what_the_adapters_say_they_say():
    register = REGISTER.read_text(encoding="utf-8")
    row = lambda r: next(ln for ln in register.splitlines() if ln.startswith(f"| {r} |"))      # noqa: E731
    assert row("T-04").startswith("| T-04 | Member display — D/W/M history") and "| **R** |" in row("T-04")
    assert row("T-09").startswith("| T-09 | Storage — `bars.db`") and "| **R** |" in row("T-09")
    assert row("T-14").startswith("| T-14 | AI processing — Massive numbers into Claude") and "| **R** |" in row("T-14")
    assert row("T-71").startswith("| T-71 | Member display — intraday + daily bars **fallback**") and "| **X** |" in row("T-71")
    assert row("T-44").startswith("| T-44 | AI processing — FMP numbers (fundamentals, analyst, earnings)") and "No AI clause" in row("T-44")
    for r, start in (("T-100", "| T-100 | Member display — the Terminal's `PUBR` panel, \"Federal contracts\" section"),
                     ("T-101", "| T-101 | Member display — the same `PUBR` panel, \"Clinical trials it leads\" section"),
                     ("T-102", "| T-102 | Member display — the same `PUBR` panel, \"FDA drug approvals\" section"),
                     ("T-103", "| T-103 | Member display — the same `PUBR` panel, \"Lobbying\" section")):
        assert row(r).startswith(start), r
        assert "Nothing else reads it (no AI lane, no export, no external publication)." in row(r), r
    assert "Recipient names come in part from D&B Open Data (Dun & Bradstreet)." in row("T-100")
    assert "Senate Office of Public Records cannot vouch for the data or analyses derived from these data" in row("T-103")
    assert "Data provided by the U.S. Food and Drug Administration" in row("T-102")
    t104 = row("T-104")
    assert t104.startswith("| T-104 | Member display / storage — **which registered funds (mutual funds and ETFs) hold a stock**")
    assert "Nothing else reads it yet (no AI lane, no export, no external publication)" in t104 and "| **A** |" in t104
    # no row names the price studies of this wave
    rows = [ln for ln in register.splitlines() if re.match(r"\| [TN]-\d+ \|", ln)]
    for words in ("stock_stats", "volume_footprint", "factor_exposure", "setup_history", "`stat`", "`vfp`", "`fctx`", "`seth`"):
        assert not [ln for ln in rows if words in ln.lower()], words
    cites = {ssr: ("T-04", "T-09", "T-71", "T-14"), vfr: ("T-04", "T-09", "T-71", "T-14", "T-44"), fxr: ("T-04", "T-09", "T-71", "T-14"),
             shr: ("T-04", "T-09", "T-71", "T-14"), prr: ("T-100", "T-101", "T-102", "T-103"), fhr: ("T-104",)}
    for m, cited in cites.items():                                     # each adapter says which rows, and claims no more
        doc = " ".join(m.__doc__.split())
        assert "licensing-register.md" in doc and "MODEL-ISOLATED (ADR-005; when in doubt, isolate)" in doc, m.KIND
        assert set(re.findall(r"T-\d+", doc)) == set(cited), m.KIND
        assert "for a model provider" in doc and "Shown to the member only; the capability is local-only." in doc, m.KIND
    for m in PRICE:
        assert "The same rule as `seasonality.stock`." in " ".join(m.__doc__.split()), m.KIND
    panel = (REPO / "app/src/pages/terminal/panels/PublicRecordsPanel.jsx").read_text(encoding="utf-8")
    for k in ("contracts", "lobbying"):                                 # each agency's own words, as the PUBR panel shows them
        assert prr.CREDITS[k].split(" LDA.gov.")[0] in panel.replace("' +\n      '", "").replace("`\n      + '", ""), k
    assert prr.CREDITS["fda"].rstrip(".") in panel and "no text is changed" in prr.CREDITS["trials"] and "no text is changed" in panel


# ── the contract (MD-1 v1.16 §4.19) ───────────────────────────────────────────────────────────────────────────
def test_the_contract_doc_states_section_4_19_and_every_note_the_adapters_emit():
    """MD-1 §4.19 quotes each note verbatim; QA pins fixtures to the doc, so the two must not drift."""
    doc = DOC.read_text(encoding="utf-8").replace("\r\n", "\n")
    head = ("### 4.19 Terminal data wave 10: `stock.stats`, `stock.volumeFootprint`, `stock.factorExposure`, `stock.setupHistory`, "
            "`company.publicRecords`, `ownership.funds` (v1.16, terminal-data)")
    assert head in doc
    section = doc[doc.index(head):doc.index("## 8. Changing this contract")]
    for m in MODULES:
        assert f"`{m.KIND}`" in section and f"`{m.SOURCE}`" in section, m.KIND
        notes = {k: v for k, v in vars(m).items() if k.startswith("NOTE_")}
        assert notes, m.KIND
        for name, text in notes.items():
            assert text in section, f"{m.KIND} {name}"
        assert f"| `{m.KIND}` |" in section, m.KIND                    # its table row
    for words in [*ssr.CORRECTION_WORDS.values(), *ssr.BENCH_WORDS.values(), *vfr.EARNINGS_WORDS.values(), *fxr.WINDOW_WORDS.values(),
                  *shr.UNIVERSE_WORDS.values(), *prr.SECTION_WORDS.values(), *(w for _k, w, _e in prr.LISTS.values()), *prr.CREDITS.values(),
                  *fhr.CHECK_WORDS.values()]:
        assert words in section, words                                 # the words a note is filled with
    prose = " ".join(section.split())
    for s in ("UCT_AGENT_DATA_KINDS", "UCT_AGENT_ISOLATED_KINDS", "turn.LOCAL_ONLY_ACTIONS", "**Status: dark, not armed.**",
              "**No read of this section starts a build or a request.**", "`stock_stats_held.held_stats`",
              "`volume_footprint_held.held_footprint`", "`factor_exposure_held.held_exposure`", "`setup_history_held.held_signals`",
              "`public_records.held_records`", "`fund_holders_nport.answer_for`", "row T-04", "row T-09", "row T-71", "row T-14",
              "row T-44", "row T-100", "row T-101", "row T-102", "row T-103", "row T-104", "for a model provider",
              "never the time of the read", "the builder's default", "`stockStudies`", "52nd", "`seasonality.stock`"):
        assert s in prose, s
    assert doc.index("### 4.18 Terminal data wave 9") < doc.index(head) < doc.index("## 8. Changing this contract")
    title = re.match(r"# MD-1 — UCT market-data contract \(v1\.(\d+)\)", doc)
    assert title and int(title.group(1)) >= 16
    entry = next(line for line in doc.splitlines() if line.startswith("- **v1.16 addition (2026-11-23, terminal-data, data wave 10):**"))
    assert "owed by a person" in entry and "acknowledged by the owner" not in entry      # §8.1: no acknowledgement is claimed
    assert "has not been sent" in entry and "not acknowledged by anyone" in entry
    assert "**Not armed:**" in entry and "Nothing in this entry or in §4.19 records an owner decision." in entry
    assert doc.index(entry) < doc.index("- **v1.15 addition (2026-11-21, terminal-data, data wave 9):**")
    status = next(line for line in doc.splitlines() if line.startswith("- **Status:** v1."))
    owed = re.search(r"the §8\.1 notices for ([^;)]*?) are owed by a person and are not acknowledged", status)
    assert owed and all(v in owed.group(1) for v in ("v1.9", "v1.10", "v1.11", "v1.12", "v1.13", "v1.14", "v1.15", "v1.16"))
    for text in (section, entry):
        for claim in ("owner approved", "owner asked", "owner decided", "approved by the owner", "will be armed", "the owner will",
                      "owner wants", "owner ruled"):
            assert claim not in text, claim
