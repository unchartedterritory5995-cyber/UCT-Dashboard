"""MD-1 kinds of terminal data wave 3: `levels.gamma`, `flow.topPicks`, `flow.record`, `earnings.reactions` — the Agent
half of the LVL panel's options levels, the TOPF panel, the Flow Record page and the EMOV panel.

No network, no database: every service is stubbed at the function its member route calls, or its cache is filled
through the route's own function, and every clock is pinned. Pinned per kind: an ok read (envelope conformance, the
documented fields only, the data's own time or null with a note), `unavailable` kept apart from a healthy empty answer,
a malformed request refused before any read, a failing service answered `unavailable`, a read never fresher than its
kind declares, and THE BUDGET RULE: no read ever starts a build (an option chain read, a calendar week, a price read
per reporter) and none spends a provider call. For all four: registered dark, model-isolated, dormant until armed one
by one. The cross-file facts (the route's symbol rule and cache names, the panels' own words and numbers, the Flow
Record's own arithmetic) are read from the other file rather than retyped. And the contract: MD-1 §4.12 quotes every
note these adapters emit, verbatim.
"""
from __future__ import annotations

import inspect
import json
import re
import time
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

from api import flow_scoreboard, gex_service, top_flow_tracker
from api.routers import calendar as calendar_route
from api.routers import signature as signature_route
from api.services.signature import gex_walls, rules
from api.services.uct_agent.marketdata import (earnings_reactions as er, flow_record as fr, flow_top_picks as tp,
                                              gamma_levels as gl)
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw
from api.services.uct_agent.marketdata import sessions

REPO = Path(__file__).resolve().parents[1]
MODULES = (gl, tp, fr, er)
KINDS = tuple(m.KIND for m in MODULES)
#: this wave's isolation decisions (ADR-005): all four. A kind leaving this set is an owner decision.
ISOLATED = set(KINDS)
#: a well-formed request per kind (the gateway rails below need one that passes each kind's own validate)
GOOD = {gl.KIND: {"symbol": "AAA"}, tp.KIND: {}, fr.KIND: {}, er.KIND: {"date": "2026-11-12"}}
TODAY = date(2026, 11, 13)                                          # a Friday
PANELS = REPO / "app/src/pages/terminal/panels"
WEEK_KEYS = ("calendar_weekly", "calendar_week_2026-11-02")
MOVE_DAYS = ("2026-11-05", "2026-11-12", "2026-11-13")


def _forget_everything():
    for sym in ("AAA", "BBB"):
        signature_route.cache.invalidate(signature_route._ck("gxw", sym))
        signature_route._GXW_STALE.forget(sym)
        signature_route._GXW_NEG_CACHE.pop(sym, None)
    for key in WEEK_KEYS + tuple(f"calendar_reactions_{d}" for d in MOVE_DAYS):
        calendar_route.cache.invalidate(key)
    flow_scoreboard._invalidate_cache()


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(KINDS))
    monkeypatch.setenv(gw.ISOLATED_ENV, "1")
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(sorted(ISOLATED)))
    monkeypatch.delenv("GEX_CHAIN_SOURCE", raising=False)      # retired 2026-11-17: nothing reads it (railed below)
    gw._reset_for_test(None)
    monkeypatch.setattr(tp, "today_et", lambda: TODAY)
    monkeypatch.setattr(er, "today_et", lambda: TODAY.isoformat())
    monkeypatch.setattr(calendar_route, "_today_et", lambda: TODAY)
    monkeypatch.setattr(sessions, "last_completed_session", lambda now=None: 20261112)
    monkeypatch.setattr(top_flow_tracker, "_data", {"active": [], "archived": []})
    _forget_everything()
    yield
    _forget_everything()
    gw._reset_for_test(None)


_turn = iter(range(10_000))


def _read(kind, params=None, purpose="answer"):
    return gw.read(kind, GOOD[kind] if params is None else params, user_id=1, turn_id=f"w3-{next(_turn)}", purpose=purpose)


def _conforms(out, kind):
    assert env.validate_envelope(out) == [], out
    assert out["kind"] == kind
    assert out["provider_calls"] == 0                                # no kind of this wave ever spends a provider call
    if out["status"] in ("ok", "partial"):
        # MD-1 §3: a read may be LESS fresh than its kind declares, never fresher
        assert env.FRESHNESS.index(out["freshness"]) >= env.FRESHNESS.index(gw.registry().get(kind).freshness)
        assert out["as_of"] is not None or out["notes"]
        assert out["isolated"] is True and out["data"]["isolated"] is True     # ADR-005 L2, stamped by the gateway


def _boom(*a, **kw):
    raise AssertionError("a build was started inside a turn")


# ── registration, dark by default, isolation ─────────────────────────────────────────────────────────────────────────
def test_every_kind_is_registered_once_by_its_module_and_all_four_are_isolated():
    r = gw.registry()
    for m in MODULES:
        k = r.get(m.KIND)
        assert k is not None and k.owner == "terminal-data" and k.category == "market", m.KIND
        assert k.validate is m.validate and k.description
        assert k.model_isolated is True, m.KIND
        assert "Shown to the member only" in k.description, m.KIND
    assert {r.get(k).freshness for k in KINDS} == {"periodic"}       # none is ever declared live or delayed
    assert r.get(gl.KIND).max_symbols == 1 and r.get(tp.KIND).max_symbols == 1


def test_dark_unless_the_gateway_is_on_and_the_kind_is_named(monkeypatch):
    ran = []
    monkeypatch.setattr(gl, "held_walls", lambda sym: ran.append("gl") or (None, "not_held"))
    monkeypatch.setattr(top_flow_tracker, "get_all", lambda: ran.append("tp") or {"active": [], "archived": []})
    monkeypatch.setattr(flow_scoreboard, "_get_payload", lambda: ran.append("fr") or {})
    monkeypatch.setattr(er, "cached_day", lambda ds: ran.append("er"))
    monkeypatch.setenv(gw.KINDS_ENV, "quote,themes,levels.darkpool,earnings.expectedMove")
    for kind in KINDS:
        out = _read(kind)
        assert out["status"] == "refused" and gw.KINDS_ENV in out["notes"][0], kind
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(KINDS))
    monkeypatch.delenv(gw.DATA_ENV)
    for kind in KINDS:
        assert _read(kind)["status"] == "refused", kind
    assert ran == []


def test_isolated_kinds_are_dormant_until_armed_by_name_and_answer_the_member_only(monkeypatch):
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, "")                       # listed in DATA_KINDS, not armed
    for kind in KINDS:
        out = _read(kind)
        assert out["status"] == "refused" and out["data"] is None, kind
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, tp.KIND)                  # arming ONE arms one
    assert _read(tp.KIND)["status"] == "ok"
    for kind in sorted(ISOLATED - {tp.KIND}):
        assert _read(kind)["status"] == "refused", kind
    for purpose in ("research", "scan"):                                # never for a model's research
        assert _read(tp.KIND, purpose=purpose)["status"] == "refused"
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(sorted(ISOLATED)))
    monkeypatch.delenv(gw.ISOLATED_ENV)                                 # the master switch turns every one off
    for kind in KINDS:
        assert _read(kind)["status"] == "refused", kind


# ── levels.gamma ─────────────────────────────────────────────────────────────────────────────────────────────────────
def _gex(**over):
    """What `gex_service.get_gex_data` answers, as far as `shape_walls` reads it."""
    body = {"spot": 100.0, "callWall": {"strike": 105.0, "gex": 5.0}, "putWall": {"strike": 95.0, "gex": -4.0},
            "zeroGamma": 98.5, "regime": "choppy", "strikes": ["dropped"], "netDelta": 123456}
    return {**body, **over}


def _hold_walls(monkeypatch, gex=None, sym="AAA"):
    """Fill the route's cache AND its last-good slot through the route's OWN serve path (the chain read stubbed), then
    make every build raise. Returns the payload the route holds."""
    async def get_gex_data(ticker, dte_filter="all", adjusted=False, source=None):
        return _gex() if gex is None else gex
    monkeypatch.setattr(gex_service, "get_gex_data", get_gex_data)
    payload = signature_route._serve_gxw(sym)
    monkeypatch.setattr(gex_service, "get_gex_data", _boom)
    monkeypatch.setattr(signature_route, "_gxw_build", _boom)
    monkeypatch.setattr(signature_route, "fetch_gex_walls", _boom)
    return payload


def test_the_symbol_rule_is_the_gex_walls_routes_own():
    src = (REPO / "api/routers/signature.py").read_text(encoding="utf-8")
    m = re.search(r'^_SYM_RE = re\.compile\(r"([^"]+)"\)', src, flags=re.M)
    assert m and m.group(1) == gl.SYMBOL_RE.pattern == signature_route._SYM_RE.pattern


def test_the_level_kinds_and_regimes_are_the_services_and_the_lvl_panels_own():
    """One fact in three files: what `shape_walls` emits, what this kind passes on, what the LVL panel reads."""
    shaped = gex_walls.shape_walls(_gex())
    assert tuple(lv["kind"] for lv in shaped["levels"]) == gl.LEVEL_KINDS
    js = (PANELS / "levelsModel.js").read_text(encoding="utf-8")
    assert re.search(r"^const GEX_KINDS = \[([^\]]+)\]", js, flags=re.M).group(1).replace("'", "").split(", ") == list(gl.LEVEL_KINDS)
    block = js[js.index("export const REGIME_TEXT = Object.freeze({"):js.index("const num = ")]
    assert tuple(re.findall(r"^\s+(\w+): '", block, flags=re.M)) == gl.REGIMES
    assert rules.GXW_DTE == "week"                                    # NOTE_WHAT says "expiring within a week"
    # one chain since Schwab was retired (2026-11-17): the kind's table is exactly what the service can answer
    assert gl.CHAIN_OF_MODE == {"massive": "massive"} and gex_service.chain_source() in gl.CHAIN_OF_MODE
    assert not hasattr(gex_service, "GEX_SOURCE_ENV") and not hasattr(gex_service, "GEX_MODES")


def test_gamma_reads_what_the_route_holds_and_never_builds(monkeypatch):
    held = _hold_walls(monkeypatch)
    out = _read(gl.KIND, {"symbol": " aaa "})
    _conforms(out, gl.KIND)
    assert out["status"] == "ok" and out["freshness"] == "periodic" and out["stale"] is False
    assert out["as_of"] is None                                       # the build time is UCT's, never the data's
    d = out["data"]
    assert d["sym"] == "AAA" and d["held"] == "fresh" and d["spot"] == 100.0 and d["regime"] == "choppy"
    assert [(lv["kind"], lv["price"]) for lv in d["levels"]] == [("callWall", 105.0), ("putWall", 95.0), ("zeroGamma", 98.5)]
    assert set(d["levels"][0]) - {"isolated"} == {"kind", "price"}    # the documented fields only
    assert d["asOf"] == held["asOf"] and d["version"] == rules.VERSIONS["gxw"]
    assert d["computed_at"] == env.utc_iso(datetime.fromtimestamp(held["asOf"], tz=timezone.utc))
    assert d["band_pct"] == 15 and d["kept_minutes"] == rules.GXW_TTL_S // 60 and d["last_good_minutes"] == rules.GXW_MAX_AGE_S // 60
    assert gl.NOTE_WHAT.format(sym="AAA", band=15) in out["notes"] and gl.NOTE_SPOT in out["notes"] and gl.NOTE_ZERO in out["notes"]
    assert gl.NOTE_TIME.format(at=d["computed_at"]) in out["notes"]
    assert "strikes" not in json.dumps(out) and "netDelta" not in json.dumps(out)      # nothing of the chain rides along


def test_gamma_the_last_good_copy_is_stale_and_past_its_age_nothing_is_held(monkeypatch):
    held = _hold_walls(monkeypatch)
    signature_route.cache.invalidate(signature_route._ck("gxw", "AAA"))     # the 10-minute entry has lapsed
    out = _read(gl.KIND)
    _conforms(out, gl.KIND)
    assert out["status"] == "ok" and out["stale"] is True and out["data"]["held"] == "last_good"
    assert gl.NOTE_LAST_GOOD.format(minutes=rules.GXW_TTL_S // 60) in out["notes"]
    too_old = time.time() - signature_route._GXW_STALE.max_age - 5
    signature_route._GXW_STALE.remember("AAA", held, at=too_old)            # past the slot's own bound
    out = _read(gl.KIND)
    _conforms(out, gl.KIND)
    assert out["status"] == "unavailable" and out["data"] is None
    assert out["notes"] == [gl.NOTE_NOT_HELD.format(sym="AAA", minutes=rules.GXW_TTL_S // 60, max_minutes=rules.GXW_MAX_AGE_S // 60)]


def test_gamma_a_cold_symbol_is_unavailable_and_no_chain_is_read(monkeypatch):
    """Through the REAL route state with nothing held: the member route would build here; this read must not. The build
    is COUNTED, not raised: the adapter answers a raising service honestly, which would hide a build that only raised."""
    built = []

    async def get_gex_data(*a, **kw):
        built.append("chain")
        return _gex()
    monkeypatch.setattr(gex_service, "get_gex_data", get_gex_data)
    real_build = signature_route._gxw_build
    monkeypatch.setattr(signature_route, "_gxw_build", lambda s: built.append("build") or real_build(s))
    out = _read(gl.KIND)
    _conforms(out, gl.KIND)
    assert out["status"] == "unavailable" and gl.NOTE_NOT_HELD.format(sym="AAA", minutes=10, max_minutes=30) in out["notes"]
    assert built == []
    # a remembered failure (the route's negative cache) is "nothing held", never an answer
    signature_route._gxw_remember_error("AAA", {"sym": "AAA", "levels": [], "error": "Massive API error: 503"})
    out = _read(gl.KIND)
    assert out["status"] == "unavailable" and "503" not in json.dumps(out) and built == []


def test_gamma_no_level_in_the_band_is_healthy_and_a_bad_payload_is_never_no_levels(monkeypatch):
    _hold_walls(monkeypatch, gex=_gex(callWall={"strike": 150.0}, putWall={"strike": 50.0}, zeroGamma=None))
    out = _read(gl.KIND)
    _conforms(out, gl.KIND)
    assert out["status"] == "ok" and out["data"]["levels"] == []
    assert gl.NOTE_NONE.format(sym="AAA", band=15) in out["notes"] and gl.NOTE_ZERO not in out["notes"]
    key = signature_route._ck("gxw", "AAA")
    for payload, note in (({"sym": "AAA", "levels": [], "spot": 0.0, "regime": ""}, gl.NOTE_NO_PRICE),
                          ({"sym": "AAA", "levels": [], "error": "No options data with greeks for AAA"}, gl.NOTE_FAILED),
                          ({"sym": "AAA", "levels": None, "spot": 100.0}, gl.NOTE_FAILED)):
        signature_route.cache.set(key, payload, ttl=60)
        out = _read(gl.KIND)
        _conforms(out, gl.KIND)
        assert out["status"] == "unavailable" and out["notes"] == [note.format(sym="AAA")], payload
    signature_route.cache.set(key, {"sym": "AAA", "levels": [{"kind": "callWall", "price": 105.0}, {"kind": "other", "price": 1.0},
                                                         {"kind": "putWall", "price": float("nan")}], "spot": 100.0}, ttl=60)
    out = _read(gl.KIND)                                               # no build time: unknown is never claimed fresh
    _conforms(out, gl.KIND)
    assert out["data"]["levels"] == [{"kind": "callWall", "price": 105.0, "isolated": True}]
    assert out["stale"] is True and out["data"]["computed_at"] is None and gl.NOTE_NO_TIME in out["notes"]


@pytest.mark.parametrize("left_in_the_retired_variable", [None, "massive", "schwab", "shadow"])
def test_gamma_names_massive_whatever_the_retired_variable_says(monkeypatch, left_in_the_retired_variable):
    """`GEX_CHAIN_SOURCE` chose between Massive's chain and Schwab's until 2026-11-17. It is retired with Schwab: a
    value still set on a server (production carries `massive`; `schwab` and `shadow` were its other values) is read
    by nothing, and the kind names Massive."""
    _hold_walls(monkeypatch)
    if left_in_the_retired_variable:
        monkeypatch.setenv("GEX_CHAIN_SOURCE", left_in_the_retired_variable)
    out = _read(gl.KIND)
    assert out["data"]["chain_source"] == "massive" and gl.NOTE_CHAIN in out["notes"]
    assert gl.NOTE_CHAIN == "the option chain behind these levels is Massive's, the one chain UCT reads for them"
    assert "schwab" not in json.dumps(out).lower()


def test_gamma_does_not_name_a_chain_it_does_not_know(monkeypatch):
    """`chain_source` stays in the payload (shape); a label the kind has no row for is None, never a guess."""
    _hold_walls(monkeypatch)
    monkeypatch.setattr(gex_service, "chain_source", lambda: "schwab")
    out = _read(gl.KIND)
    assert "chain_source" in out["data"] and out["data"]["chain_source"] is None and gl.NOTE_CHAIN not in out["notes"]


def test_gamma_failing_route_and_bad_symbols(monkeypatch):
    ran = []

    def boom(sym):
        ran.append(sym)
        raise RuntimeError("cache backend down at redis://internal")
    monkeypatch.setattr(gl, "held_walls", boom)
    out = _read(gl.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [gl.NOTE_FAILED.format(sym="AAA")]
    for bad in ({}, {"symbol": ""}, {"symbol": ".."}, {"symbol": "AAA BBB"}, {"symbol": 5}, {"symbol": "-A"}):
        assert _read(gl.KIND, bad)["status"] == "refused", bad
    assert ran == ["AAA"]                                               # refused before any read


# ── the pick store both flow kinds read ──────────────────────────────────────────────────────────────────────────────
def _h(day, price, oi=1000, **over):
    return {"date": day, "price": price, "oi": oi, "spot": 100.0, "volume": None, **over}


def _pick(sym, entry, history, **over):
    body = {"id": f"{sym}|C|100.0|1/15/2027", "sym": sym, "cp": "C", "strike": 100.0, "exp": "1/15/2027", "entry": entry,
            "grade": "A+ extra", "dir": "BULL", "cap": "Large Cap", "dateSaved": "2026-08-10", "hits": 4, "prem": 1_500_000,
            "history": history, "finalPnl": 0, "finalPrice": 0}
    return {**body, **over}


def _store(monkeypatch, active=None, archived=None):
    """Hold a pick store in the tracker itself, so both kinds read it through the tracker's own `get_all`."""
    active = [
        _pick("AAA", 2.0, [_h("11/10/2026", 2.5, src="massive"), _h("11/11/2026", 4.0, 1300, src="massive"), _h("11/12/2026", 3.0, src="schwab")]),
        _pick("BBB", 5.0, [_h("11/10/2026", 4.0), _h("11/12/2026", 2.5)], dir="BEAR", cp="P", grade="B", dateSaved="2026-08-12"),
        _pick("CCC", 1.0, [_h("11/12/2026", 1.2, src="massive")], grade="A", dateSaved="2026-08-14"),          # one price: too new
        _pick("DDD", 3.0, [], grade="C", dateSaved="2026-08-13"),                                               # no price at all
    ] if active is None else active
    archived = [
        _pick("EEE", 2.0, [_h("7/1/2026", 2.0), _h("7/2/2026", 6.0), _h("7/6/2026", 1.0)], dateSaved="2026-06-30", exp="7/17/2026",
              grade="A", purgeReason="stopped early"),
    ] if archived is None else archived
    monkeypatch.setattr(top_flow_tracker, "_data", {"active": active, "archived": archived})
    monkeypatch.setattr(top_flow_tracker, "snapshot_prices", _boom)
    return active, archived


# ── flow.topPicks ────────────────────────────────────────────────────────────────────────────────────────────────────
def test_the_statuses_directions_sorts_and_day_limits_are_the_topf_panels_own():
    js = (PANELS / "topFlowModel.js").read_text(encoding="utf-8")

    def keys(name):
        block = js[js.index(f"export const {name} = Object.freeze({{"):]
        return tuple(re.findall(r"^  (\w+): Object\.freeze", block[:block.index("\n})")], flags=re.M))
    assert keys("TOP_FLOW_STATUSES") == tp.STATUSES
    assert keys("TOP_FLOW_DIRECTIONS") == tuple(tp.DIRECTIONS)
    assert keys("TOP_FLOW_SORTS") == tp.SORTS
    for const, mine in (("STALE_AFTER_DAYS", tp.STALE_AFTER_DAYS), ("NO_NEW_PICKS_AFTER_DAYS", tp.NO_NEW_PICKS_AFTER_DAYS),
                        ("MIN_HISTORY_SNAPSHOTS", flow_scoreboard.MIN_HISTORY_SNAPSHOTS)):
        assert int(re.search(rf"^export const {const} = (\d+)$", js, flags=re.M).group(1)) == mine, const
    words = dict(re.findall(r"^  (\w+): Object\.freeze\(\{[^}]*words: '([^']+)'", js, flags=re.M))
    assert words == tp.SORT_WORDS
    # the labels a stored entry can carry: the tracker writes only "massive" now; "schwab" is read, never written
    assert tp.PRICE_SOURCES == ("massive", "schwab") and not hasattr(top_flow_tracker, "SNAPSHOT_SOURCES")
    written = top_flow_tracker._massive_entry({"mid": 2.5, "oi": 10}, "11/17/2026")
    assert written["src"] == "massive" and '"src": "schwab"' not in inspect.getsource(top_flow_tracker)


def test_top_picks_every_gain_is_the_flow_records_own_arithmetic(monkeypatch):
    active, archived = _store(monkeypatch)
    out = _read(tp.KIND)
    _conforms(out, tp.KIND)
    assert out["status"] == "ok" and out["freshness"] == "historical"
    d = out["data"]
    by_sym = {r["sym"]: r for r in d["rows"]}
    assert set(by_sym) == {"AAA", "BBB", "CCC", "DDD", "EEE"} and d["count"] == 5
    for pick in active + archived:
        row, stats = by_sym[pick["sym"]], flow_scoreboard.pick_stats(pick)
        assert set(row) - {"isolated"} == set(tp.ROW_FIELDS)           # the documented fields only
        assert row["scored"] is (stats is not None) is (row["prices"] >= flow_scoreboard.MIN_HISTORY_SNAPSHOTS)
        for mine, theirs in (("entry", "entry"), ("latest_price", "latest_price"), ("peak_price", "peak_price"),
                             ("current_gain_pct", "current_gain_pct"), ("max_gain_pct", "max_gain_pct"),
                             ("days_tracked", "days_tracked"), ("oi_confirmed", "oi_confirmed")):
            if stats is not None:
                assert row[mine] == stats[theirs], (pick["sym"], mine)
    assert by_sym["AAA"]["current_gain_pct"] == 50.0 and by_sym["AAA"]["max_gain_pct"] == 100.0 and by_sym["AAA"]["oi_confirmed"] is True
    assert by_sym["AAA"]["grade"] == "A+" and by_sym["AAA"]["latest_date"] == "2026-11-12" and by_sym["AAA"]["status"] == "open"
    assert by_sym["EEE"]["status"] == "expired" and by_sym["EEE"]["stopped"] is True and by_sym["EEE"]["current_gain_pct"] == -50.0
    text = json.dumps(out)
    assert "finalPnl" not in text and "finalPrice" not in text and "purgeReason" not in text   # the store's 0-for-missing is never shown


def test_top_picks_too_new_is_never_zero_percent_and_sources_are_named(monkeypatch):
    _store(monkeypatch)
    out = _read(tp.KIND)
    by_sym = {r["sym"]: r for r in out["data"]["rows"]}
    for sym, prices in (("CCC", 1), ("DDD", 0)):
        row = by_sym[sym]
        assert row["scored"] is False and row["prices"] == prices
        assert row["current_gain_pct"] is None and row["max_gain_pct"] is None and row["peak_price"] is None    # null, never 0
    assert by_sym["CCC"]["latest_price"] == 1.2 and by_sym["CCC"]["entry"] == 1.0 and by_sym["DDD"]["latest_price"] is None
    assert tp.NOTE_TOO_NEW.format(n=2, total=5, min=flow_scoreboard.MIN_HISTORY_SNAPSHOTS) in out["notes"]
    assert out["data"]["counts"] == {"total": 5, "open": 4, "expired": 1, "scored": 3, "too_new": 2, "never_scored": 0, "isolated": True}
    assert by_sym["AAA"]["src"] == ["massive", "schwab"] and by_sym["CCC"]["src"] == ["massive"]
    assert by_sym["BBB"]["src"] == ["schwab"] and by_sym["DDD"]["src"] == []      # an entry with no source on record is Schwab
    assert tp.NOTE_WHAT in out["notes"] and tp.NOTE_SOURCES in out["notes"]
    assert "options flow tape" in tp.NOTE_SOURCES and "Schwab as backup" not in tp.NOTE_SOURCES
    # the same words the member reads on the Top Flow panel and the Flow Record
    for said in (tp.NOTE_SOURCES, fr.NOTE_SOURCES):
        assert "from Massive (prices recorded before November 2026 came from Schwab and stay as recorded)" in said


def test_top_picks_time_is_the_newest_daily_price_and_the_newest_pick_is_said(monkeypatch):
    _store(monkeypatch)
    out = _read(tp.KIND)
    assert out["as_of"] == "2026-11-12T21:00:00Z" and out["stale"] is False and tp.NOTE_AS_OF in out["notes"]
    d = out["data"]
    assert d["newest_price_date"] == "2026-11-12" and d["days_since_newest_price"] == 1
    assert d["newest_pick_date"] == "2026-08-14" and d["days_since_newest_pick"] == 91 and d["no_new_picks"] is True
    assert tp.NOTE_NO_NEW_PICKS.format(date="2026-08-14") in out["notes"]
    monkeypatch.setattr(tp, "today_et", lambda: date(2026, 11, 12 + tp.STALE_AFTER_DAYS + 1))
    out = _read(tp.KIND)
    _conforms(out, tp.KIND)
    assert out["stale"] is True and tp.NOTE_STALE.format(date="2026-11-12", days=tp.STALE_AFTER_DAYS) in out["notes"]
    _store(monkeypatch, active=[_pick("DDD", 3.0, [], dateSaved="2026-11-12")], archived=[])
    monkeypatch.setattr(tp, "today_et", lambda: TODAY)
    out = _read(tp.KIND)
    _conforms(out, tp.KIND)
    assert out["as_of"] is None and out["stale"] is False and tp.NOTE_NO_PRICES in out["notes"]
    assert out["data"]["no_new_picks"] is False and not any(n.startswith("the newest pick") for n in out["notes"])


def test_top_picks_filters_orders_and_states_the_cut(monkeypatch):
    _store(monkeypatch)
    syms = lambda **p: [r["sym"] for r in _read(tp.KIND, p)["data"]["rows"]]          # noqa: E731
    assert syms() == ["AAA", "BBB", "EEE", "CCC", "DDD"]             # biggest current gain; the unscored last, newest first
    assert syms(sort="loss") == ["BBB", "EEE", "AAA", "CCC", "DDD"]  # ... and last under a loss order too, never ranked 0
    assert syms(sort="peak") == ["EEE", "AAA", "BBB", "CCC", "DDD"]
    assert syms(sort="newest") == ["CCC", "DDD", "BBB", "AAA", "EEE"]
    assert syms(status="expired") == ["EEE"] and syms(status="open", direction="bearish") == ["BBB"]
    assert syms(symbol=" bbb ") == ["BBB"]
    out = _read(tp.KIND, {"limit": 2})
    _conforms(out, tp.KIND)
    assert [r["sym"] for r in out["data"]["rows"]] == ["AAA", "BBB"] and out["data"]["count"] == 5
    assert tp.NOTE_CUT.format(n=2, total=5, order=tp.SORT_WORDS["gain"]) in out["notes"]
    assert out["coverage"] == {"evaluated": 5, "answered": 2, "dropped": 3, "not_computable": 0}
    out = _read(tp.KIND, {"symbol": "ZZZ"})
    _conforms(out, tp.KIND)
    assert out["status"] == "ok" and out["data"]["rows"] == [] and tp.NOTE_NO_MATCH.format(total=5) in out["notes"]


def test_top_picks_an_empty_store_is_said_to_be_ambiguous_and_a_failed_read_is_never_empty(monkeypatch):
    out = _read(tp.KIND)                                               # the autouse store: nothing in it
    _conforms(out, tp.KIND)
    assert out["status"] == "ok" and out["data"]["rows"] == [] and out["data"]["counts"]["total"] == 0
    assert tp.NOTE_EMPTY in out["notes"] and "could not be loaded" in tp.NOTE_EMPTY
    _store(monkeypatch, active=[_pick("AAA", 2.0, [_h("11/11/2026", 2.0), _h("11/12/2026", 3.0)]), "not a pick",
                                _pick("", 1.0, []), _pick("BAD", 1.0, ["not an entry", _h("11/12/2026", 1.0)])], archived=[])
    out = _read(tp.KIND)
    _conforms(out, tp.KIND)
    # a history the Flow Record's own arithmetic cannot read is left out and counted, never scored by another rule
    assert [r["sym"] for r in out["data"]["rows"]] == ["AAA"] and out["data"]["unread"] == 3
    assert tp.NOTE_UNREAD.format(n=3) in out["notes"] and out["coverage"]["not_computable"] == 3

    def boom():
        raise RuntimeError("picks file unreadable at /data/top_flow_picks.json")
    monkeypatch.setattr(top_flow_tracker, "get_all", boom)
    out = _read(tp.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [tp.NOTE_FAILED] and out["data"] is None
    monkeypatch.setattr(top_flow_tracker, "get_all", lambda: {"active": None, "archived": []})
    assert _read(tp.KIND)["notes"] == [tp.NOTE_FAILED]


def test_top_picks_bad_requests_are_refused_before_any_read(monkeypatch):
    ran = []
    monkeypatch.setattr(top_flow_tracker, "get_all", lambda: ran.append(1) or {"active": [], "archived": []})
    for bad in ({"status": "live"}, {"status": "OPEN"}, {"direction": "bull"}, {"direction": "BULL"}, {"sort": "best"},
                {"limit": 0}, {"limit": tp.MAX_LIMIT + 1}, {"limit": True}, {"limit": 2.5}, {"symbol": "AAA BBB"}, {"symbol": 5}):
        assert _read(tp.KIND, bad)["status"] == "refused", bad
    assert ran == []


# ── flow.record ──────────────────────────────────────────────────────────────────────────────────────────────────────
def test_record_is_the_services_own_board_with_nothing_re_derived(monkeypatch):
    active, archived = _store(monkeypatch)
    out = _read(fr.KIND)
    _conforms(out, fr.KIND)
    assert out["status"] == "ok" and out["freshness"] == "historical" and out["stale"] is False
    board = flow_scoreboard._get_payload()                             # the route's own cached payload: the same object
    d = out["data"]
    assert d["picks_tracked"] == board["picks_tracked"] == 3 and d["too_new"] == board["too_new"] == 2 and d["flagged"] == 5
    assert {k: v for k, v in d["overall"].items() if k != "isolated"} == board["overall"]
    assert set(d["overall"]) - {"isolated"} == set(fr.BUCKET_FIELDS) == set(flow_scoreboard._bucket_stats([]))
    assert [g["grade"] for g in d["by_grade"]] == flow_scoreboard.GRADE_ORDER
    for mine, theirs in zip(d["by_grade"], board["by_grade"]):
        assert {k: v for k, v in mine.items() if k != "isolated"} == theirs
    assert d["overall"]["picks"] == 3 and d["overall"]["win_rate_50"] == round(2 / 3 * 100, 1)     # the loser is in the sample
    assert [p["sym"] for p in d["recent_picks"]] == [p["sym"] for p in board["recent_picks"]] == ["BBB", "AAA", "EEE"]
    assert set(d["recent_picks"][0]) - {"isolated"} == set(fr.PICK_FIELDS)
    assert set(fr.PICK_FIELDS) == set(flow_scoreboard._PUBLIC_FIELDS) | {"current_gain_pct", "latest_price"}
    assert d["generated_at"] == board["generated_at"] and d["computed_at"] == fr._computed_at(board["generated_at"])
    assert "methodology" not in d and "window" not in d                # the page's own sentences are not passed on
    assert fr.NOTE_WHAT in out["notes"] and fr.NOTE_SOURCES in out["notes"]
    assert fr.NOTE_TOO_NEW.format(n=2, min=flow_scoreboard.MIN_HISTORY_SNAPSHOTS) in out["notes"]
    assert fr.NOTE_LISTS.format(winners=flow_scoreboard.RECENT_WINNERS_LIMIT, days=flow_scoreboard.RECENT_WINDOW_DAYS,
                                picks=flow_scoreboard.RECENT_PICKS_LIMIT) in out["notes"]
    assert fr.NOTE_TIME.format(at=d["computed_at"], minutes=flow_scoreboard.CACHE_TTL_SECONDS // 60) in out["notes"]


def test_record_and_top_picks_state_one_time_and_the_newest_pick(monkeypatch):
    _store(monkeypatch)
    rec, picks = _read(fr.KIND), _read(tp.KIND)
    assert rec["as_of"] == picks["as_of"] == "2026-11-12T21:00:00Z" and fr.NOTE_AS_OF in rec["notes"]
    for key in ("newest_price_date", "newest_pick_date", "days_since_newest_pick", "no_new_picks"):
        assert rec["data"][key] == picks["data"][key], key
    assert rec["data"]["newest_pick_date"] == "2026-08-14" and fr.NOTE_NO_NEW_PICKS.format(date="2026-08-14") in rec["notes"]
    monkeypatch.setattr(tp, "today_et", lambda: date(2026, 11, 20))
    rec = _read(fr.KIND)
    assert rec["stale"] is True and fr.NOTE_STALE.format(date="2026-11-12", days=tp.STALE_AFTER_DAYS) in rec["notes"]


def test_record_a_failed_tracker_read_is_unavailable_never_a_zero_pick_board(monkeypatch):
    def boom():
        raise RuntimeError("tracker not loaded")
    monkeypatch.setattr(top_flow_tracker, "get_all", boom)
    for _ in range(2):                                                 # the second read rides the service's failure memory
        out = _read(fr.KIND)
        _conforms(out, fr.KIND)
        assert out["status"] == "unavailable" and out["notes"] == [fr.NOTE_FAILED] and out["data"] is None
    flow_scoreboard._invalidate_cache()
    for payload in (None, {"overall": {}}, {"overall": {}, "by_grade": "x"}):
        monkeypatch.setattr(flow_scoreboard, "_get_payload", lambda p=payload: p)
        assert _read(fr.KIND)["notes"] == [fr.NOTE_FAILED], payload


def test_record_an_empty_record_is_said_to_be_ambiguous_and_unreadable_dates_are_never_fresh(monkeypatch):
    out = _read(fr.KIND)                                               # the autouse store: nothing in it
    _conforms(out, fr.KIND)
    assert out["status"] == "ok" and out["data"]["flagged"] == 0 and out["as_of"] is None
    assert fr.NOTE_EMPTY in out["notes"] and fr.NOTE_NO_PRICES in out["notes"]
    assert out["data"]["overall"]["win_rate_50"] is None               # no rate from no pick: null, never 0
    _store(monkeypatch)
    flow_scoreboard._invalidate_cache()
    board = flow_scoreboard._get_payload()
    monkeypatch.setattr(flow_scoreboard, "_get_payload", lambda: board)
    monkeypatch.setattr(top_flow_tracker, "get_all", lambda: {"active": None})
    out = _read(fr.KIND)
    _conforms(out, fr.KIND)
    assert out["status"] == "ok" and out["as_of"] is None and out["stale"] is True and fr.NOTE_DATES_UNREAD in out["notes"]


def test_record_takes_no_parameter(monkeypatch):
    ran = []
    monkeypatch.setattr(flow_scoreboard, "_get_payload", lambda: ran.append(1))
    for bad in ({"grade": "A"}, {"limit": 5}, {"symbol": "AAA"}):
        assert _read(fr.KIND, bad)["status"] == "refused", bad
    assert ran == []


# ── earnings.reactions ───────────────────────────────────────────────────────────────────────────────────────────────
def _e(sym, eps_act=None, eps_est=1.0, **over):
    return {"sym": sym, "name": f"{sym} Corp", "eps_est": eps_est, "eps_act": eps_act, "rev_est": 500.0,
            "rev_act": 520.0 if eps_act is not None else None, "timing": "bmo", "internal": "dropped", **over}


def _week(days):
    return {"days": {ds: {"label": ds, "bmo": d.get("bmo", []), "amc": d.get("amc", []), "tbd": d.get("tbd", []), "econ": ["dropped"]}
                     for ds, d in days.items()}, "source": "fixture"}


THURSDAY = {"bmo": [_e("AAA", 1.25), _e("BBB", 0.8, 1.0), _e("NOT", None)], "amc": [_e("CCC", 2.0, 1.5), _e("AAA", 9.9)],
            "tbd": [_e("DDD", 0.1, None)]}


def _hold_this_week(days=None):
    calendar_route.cache.set("calendar_weekly", _week({"2026-11-12": THURSDAY} if days is None else days), ttl=300)


def _hold_moves(monkeypatch, ds, moves, day=None):
    """Fill the route's reactions cache through the route's OWN handler (the price reads stubbed), then make them raise."""
    monkeypatch.setattr(calendar_route, "_days_for_date", lambda target: THURSDAY if day is None else day)
    monkeypatch.setattr(calendar_route, "_past_reactions", lambda target, d: dict(moves))
    assert calendar_route.get_reactions(date_str=ds) == moves
    monkeypatch.setattr(calendar_route, "_past_reactions", _boom)
    monkeypatch.setattr(calendar_route, "_days_for_date", _boom)
    monkeypatch.setattr(calendar_route, "_get_or_build_range_week", _boom)
    monkeypatch.setattr(calendar_route, "_build_range_week", _boom)


def test_the_day_is_read_from_the_same_cache_entries_the_router_reads(monkeypatch):
    """⚠️ the coupling, railed: the adapter's cached-only day read agrees with the router's own readers of those entries."""
    _hold_this_week()
    assert er.cached_day("2026-11-12") == calendar_route._days_for_date("2026-11-12")     # the current week: read-only
    assert calendar_route.cached_report_session("AAA", "2026-11-12") == "bmo"
    monkeypatch.setattr(calendar_route, "_build_range_week", lambda monday: _week({"2026-11-05": {"amc": [_e("EEE", 1.0)]}}))
    built = calendar_route._get_or_build_range_week(date(2026, 11, 2))                    # the router's own write of another week
    monkeypatch.setattr(calendar_route, "_build_range_week", _boom)
    assert er.cached_day("2026-11-05") == built["days"]["2026-11-05"]
    assert calendar_route.cached_report_session("EEE", "2026-11-05") == "amc"
    assert er.cached_day("2026-11-06") is None and er.cached_day("2026-10-29") is None   # a day, and a week, not held
    assert int(calendar_route._REACTIONS_TTL) == 30 and calendar_route._PAST_REACTIONS_TTL == 24 * 3600


def test_reactions_pairs_the_cached_day_with_the_cached_moves_and_never_builds(monkeypatch):
    _hold_this_week()
    _hold_moves(monkeypatch, "2026-11-12", {"AAA": 4.25, "BBB": -7.5, "DDD": 0.0, "ZZZ": 3.0})
    monkeypatch.setattr(calendar_route, "get_reactions", _boom)
    out = _read(er.KIND, {"date": "2026-11-12", "limit": 3})
    _conforms(out, er.KIND)
    assert out["status"] == "ok" and out["freshness"] == "historical" and out["as_of"] is None and out["stale"] is False
    d = out["data"]
    assert d["date"] == "2026-11-12" and d["day_kind"] == "past" and d["scheduled"] == 5 and d["count"] == 4
    assert [(r["sym"], r["move"], r["session"]) for r in d["reporters"]] == [("BBB", -7.5, "bmo"), ("AAA", 4.25, "bmo"), ("DDD", 0.0, "tbd")]
    assert set(d["reporters"][0]) - {"isolated"} == set(er.ROW_FIELDS)        # the documented fields only
    assert d["reporters"][1] == {"sym": "AAA", "name": "AAA Corp", "session": "bmo", "eps_act": 1.25, "eps_est": 1.0,
                                 "rev_act": 520.0, "rev_est": 500.0, "move": 4.25, "isolated": True}    # listed once, its first session
    assert d["moves"] == "held" and (d["moved"], d["up"], d["down"], d["flat"], d["no_move"]) == (3, 1, 1, 1, 1)
    assert er.NOTE_WHAT.format(date="2026-11-12") in out["notes"] and er.NOTE_MOVE_PAST in out["notes"] and er.NOTE_NO_AS_OF in out["notes"]
    assert er.NOTE_SOME_NO_MOVE.format(n=1, total=4) in out["notes"] and er.NOTE_CUT.format(n=3, total=4) in out["notes"]
    assert out["coverage"] == {"evaluated": 4, "answered": 3, "dropped": 1, "not_computable": 1}
    assert "ZZZ" not in json.dumps(out) and "internal" not in json.dumps(out) and "econ" not in json.dumps(out)


def test_reactions_moves_not_held_is_partial_and_never_no_move(monkeypatch):
    _hold_this_week()
    monkeypatch.setattr(calendar_route, "get_reactions", _boom)
    monkeypatch.setattr(calendar_route, "_past_reactions", _boom)
    out = _read(er.KIND)
    _conforms(out, er.KIND)
    assert out["status"] == "partial" and out["data"]["moves"] == "not_cached" and out["data"]["count"] == 4
    assert all(r["move"] is None for r in out["data"]["reporters"]) and out["data"]["no_move"] == 4     # null, never 0
    assert [r["sym"] for r in out["data"]["reporters"]] == ["AAA", "BBB", "CCC", "DDD"]
    assert er.NOTE_MOVES_NOT_CACHED.format(date="2026-11-12", hours=24, seconds=30) in out["notes"]


def test_reactions_an_empty_moves_answer_is_not_nothing_moved(monkeypatch):
    _hold_this_week()
    _hold_moves(monkeypatch, "2026-11-12", {})                          # the route's "price source did not answer"
    out = _read(er.KIND)
    _conforms(out, er.KIND)
    assert out["status"] == "partial" and out["data"]["moves"] == "none_worked_out"
    assert er.NOTE_NO_MOVES.format(n=4) in out["notes"] and out["data"]["flat"] == 0


def test_reactions_today_is_periodic_and_nobody_reported_is_a_healthy_answer(monkeypatch):
    friday = {"bmo": [_e("AAA", 1.25)], "amc": [_e("LATER", None)]}
    _hold_this_week({"2026-11-13": friday, "2026-11-12": {"bmo": [_e("SOON", None), _e("ALSO", None)]}})
    calendar_route.cache.set("calendar_reactions_2026-11-13", {"AAA": 2.5}, ttl=30)
    out = _read(er.KIND, {"date": "2026-11-13"})
    _conforms(out, er.KIND)
    assert out["status"] == "ok" and out["freshness"] == "periodic" and out["data"]["day_kind"] == "today"
    assert er.NOTE_MOVE_TODAY.format(seconds=30) in out["notes"] and er.NOTE_MOVE_PAST not in out["notes"]
    out = _read(er.KIND, {})                                           # no date: the newest completed session
    _conforms(out, er.KIND)
    assert out["status"] == "ok" and out["data"]["date"] == "2026-11-12" and out["data"]["reporters"] == []
    assert out["data"]["moves"] is None and er.NOTE_NONE_REPORTED.format(scheduled=2, date="2026-11-12") in out["notes"]


def test_reactions_a_day_not_held_is_unavailable_and_no_week_is_built(monkeypatch):
    built = []
    monkeypatch.setattr(calendar_route, "_build_range_week", lambda monday: built.append("week") or _week({}))
    monkeypatch.setattr(calendar_route, "_past_reactions", lambda target, day: built.append("moves") or {})
    for ds in ("2026-11-12", "2026-11-05", "2025-01-06"):               # this week, another week, far outside the horizon
        out = _read(er.KIND, {"date": ds})
        _conforms(out, er.KIND)
        assert out["status"] == "unavailable" and out["notes"] == [er.NOTE_DAY_NOT_CACHED.format(date=ds)] and out["data"] is None
    assert built == []

    def boom(ds):
        raise RuntimeError("calendar cache unreadable")
    monkeypatch.setattr(er, "cached_day", boom)
    assert _read(er.KIND)["notes"] == [er.NOTE_FAILED.format(date="2026-11-12")]


def test_reactions_bad_requests_are_refused_before_any_read(monkeypatch):
    ran = []
    monkeypatch.setattr(er, "cached_day", lambda ds: ran.append(ds))
    for bad in ({"date": "yesterday"}, {"date": "2026-02-30"}, {"date": "2026-11-14"}, {"date": 20261112}, {"limit": 0},
                {"limit": er.MAX_LIMIT + 1}, {"limit": True}, {"limit": "5"}):
        assert _read(er.KIND, bad)["status"] == "refused", bad
    assert ran == []


def test_the_sessions_and_the_reporter_test_are_the_emov_panels_own():
    js = (PANELS / "earningsReactionsModel.js").read_text(encoding="utf-8")
    assert "for (const session of ['bmo', 'amc', 'tbd'])" in js and er.SESSIONS == ("bmo", "amc", "tbd")
    assert "const epsActual = num(e.eps_act)" in js and "if (epsActual === null) continue" in js
    block = js[js.index("export const SESSION_TEXT = Object.freeze({"):js.index("/** Pure: reported EPS against expected")]
    assert tuple(re.findall(r"^\s+(\w+): '", block, flags=re.M)) == er.SESSIONS


# ── the contract (MD-1 v1.9 §4.12) ───────────────────────────────────────────────────────────────────────────────────
def test_the_contract_doc_states_section_4_12_and_every_note_the_adapters_emit():
    """MD-1 §4.12 quotes each note verbatim; QA pins fixtures to the doc, so the two must not drift."""
    doc = (REPO / "docs/agent/program/contracts/MD-1-market-data.md").read_text(encoding="utf-8")
    head = ("### 4.12 Terminal data wave 3: `levels.gamma`, `flow.topPicks`, `flow.record`, `earnings.reactions` "
            "(v1.9, terminal-data)")
    assert head in doc                                    # the section, not the file's title: later bumps add
    section = doc[doc.index(head):doc.index("## 8. Changing this contract")]
    for m in MODULES:
        assert f"`{m.KIND}`" in section and f"`{m.SOURCE}`" in section, m.KIND
        notes = {k: v for k, v in vars(m).items() if k.startswith("NOTE_")}
        assert notes, m.KIND
        for name, text in notes.items():
            assert text in section, f"{m.KIND} {name}"
        assert f"| `{m.KIND}` |" in section and f"- `{m.KIND}`: " in section, m.KIND      # its table row, and why it is isolated
    # default OFF, the isolation switch and the never-builds rule are stated where the kinds are documented
    for s in ("UCT_AGENT_DATA_KINDS", "UCT_AGENT_ISOLATED_KINDS", "turn.LOCAL_ONLY_ACTIONS", "**Status: dark, not armed.**",
              "**No read of this section starts a build or spends a provider call.**", "too new to score",
              # the chain switch is named only to say it is retired
              "the `GEX_CHAIN_SOURCE` switch and the Schwab chain it could select were retired that day"):
        assert s in section, s
    assert "`massive` or `schwab`" not in section and "Schwab as backup" not in section and "`shadow` serves" not in section
    # wave 2's section still ends where this one begins, and the statement v1.9 amends no longer stands as written
    assert doc.index("### 4.11 Terminal data wave 2") < doc.index(head) < doc.index("## 8. Changing this contract")
    assert "(`GET /api/signature/gex-walls`) are not exposed to the Agent.\n" not in doc
    assert "`levels.gamma` (§4.12)" in doc[doc.index("### 4.10 Terminal data wave 1"):doc.index("### 4.11 Terminal data wave 2")]
    entry = next(line for line in doc.splitlines() if line.startswith("- **v1.9 addition (2026-11-17, terminal-data, data wave 3):**"))
    assert "owed by a person" in entry and "acknowledged by the owner" not in entry      # §8.1: no acknowledgement is claimed
    # the Schwab retirement is an AMENDMENT of v1.9 (no kind, param or field moved), dated, quoting the instruction,
    # and it claims no acknowledgement either
    amended = next(line for line in doc.splitlines() if line.startswith("- **v1.9 amendment (2026-11-17, terminal-data, Schwab retired):**"))
    assert '"Move it, fix the status and remove schwab from everything."' in amended
    assert "it is not an acknowledgement of v1.9" in amended and "acknowledged by the owner" not in amended
    # the file's title carries the newest version, which later waves bump (v1.10 is data wave 4): never older than this one
    title = re.match(r"# MD-1 — UCT market-data contract \(v1\.(\d+)\)", doc)
    assert doc.index(amended) < doc.index(entry) and title and int(title.group(1)) >= 9
    assert "- **`flow.summary`:** only through the existing flow proxy" in doc       # still deferred: no tape kind was added
