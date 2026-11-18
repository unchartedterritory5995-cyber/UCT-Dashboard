"""MD-1 kinds of terminal data wave 1: `analyst.actions`, `highsLows.session`, `sectors.performance`, `leaders.longRun`,
`levels.darkpool` — the Agent half of the UPDG / HILO / SCTR / LEAD / LVL terminal panels.

No network, no database: every service is stubbed at the function its member route calls, and every clock is pinned.
Pinned per kind: an ok read (envelope conformance, the documented fields only, the data's own time or null with a
note), `unavailable` kept apart from an empty answer, a malformed request refused before any read, a failing service
answered `unavailable`, and a read never fresher than its kind declares. For all five: registered dark, isolated kinds
dormant until armed one by one, and the two cross-file facts (the LEAD lens keys, the route's symbol rule) read from
the other file rather than retyped. And the contract: MD-1 §4.10 quotes every note these adapters emit, verbatim.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from api.services import engine, nhnl_live, scan_gainers, scan_ipo, scan_volume, sector_strength
from api.services.cache import cache
from api.services.signature import darkpool_levels as dpl_service
from api.services.signature import rules
from api.services.uct_agent.marketdata import (analyst_actions as aa, darkpool_levels as dp, leaders_long_run as lr,
                                              sectors_performance as sp, session_highs_lows as hl)
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw

REPO = Path(__file__).resolve().parents[1]
MODULES = (aa, hl, sp, lr, dp)
KINDS = tuple(m.KIND for m in MODULES)
#: this wave's isolation decisions (ADR-005). A kind may JOIN this set; leaving it is an owner decision.
ISOLATED = {aa.KIND, hl.KIND, lr.KIND, dp.KIND}
#: a well-formed request per kind (the gateway rails below need one that passes each kind's own validate)
GOOD = {aa.KIND: {}, hl.KIND: {}, sp.KIND: {"period": "1W"}, lr.KIND: {"list": "30D"}, dp.KIND: {"symbol": "AAA"}}
NOW = datetime(2026, 11, 13, 15, 30, tzinfo=timezone.utc)          # Fri 10:30 ET, a regular session


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(KINDS))
    monkeypatch.setenv(gw.ISOLATED_ENV, "1")
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(sorted(ISOLATED)))
    gw._reset_for_test(None)
    cache.delete_prefix("sector_strength_")
    monkeypatch.setattr(hl, "now_utc", lambda: NOW)
    yield
    cache.delete_prefix("sector_strength_")
    gw._reset_for_test(None)


_turn = iter(range(10_000))


def _read(kind, params=None, purpose="answer"):
    return gw.read(kind, GOOD[kind] if params is None else params, user_id=1, turn_id=f"t{next(_turn)}", purpose=purpose)


def _conforms(out, kind):
    assert env.validate_envelope(out) == [], out
    assert out["kind"] == kind
    if out["status"] in ("ok", "partial"):
        # MD-1 §3: a read may be LESS fresh than its kind declares, never fresher
        assert env.FRESHNESS.index(out["freshness"]) >= env.FRESHNESS.index(gw.registry().get(kind).freshness)
        assert out["as_of"] is not None or out["notes"]


# ── registration, dark by default, isolation ─────────────────────────────────────────────────────────────────────────
def test_every_kind_is_registered_once_by_its_module_with_this_waves_isolation():
    r = gw.registry()
    for m in MODULES:
        k = r.get(m.KIND)
        assert k is not None and k.owner == "terminal-data" and k.category == "market", m.KIND
        assert k.validate is m.validate and k.description
        assert k.model_isolated is (m.KIND in ISOLATED), m.KIND
    assert r.get(dp.KIND).max_symbols == 1
    assert {r.get(k).freshness for k in KINDS} == {"periodic"}       # none is ever declared live or delayed


def test_dark_unless_the_gateway_is_on_and_the_kind_is_named(monkeypatch):
    ran = []
    monkeypatch.setattr(engine, "get_analyst_actions", lambda: ran.append("aa") or {})
    monkeypatch.setattr(sector_strength, "get_sector_strength", lambda period="Today": ran.append("sp") or [])
    monkeypatch.setenv(gw.KINDS_ENV, "quote,themes")
    for kind in KINDS:
        out = _read(kind)
        assert out["status"] == "refused" and gw.KINDS_ENV in out["notes"][0], kind
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(KINDS))
    monkeypatch.delenv(gw.DATA_ENV)
    for kind in KINDS:
        assert _read(kind)["status"] == "refused", kind
    assert ran == []


def test_isolated_kinds_are_dormant_until_armed_by_name_and_answer_the_member_only(monkeypatch):
    monkeypatch.setattr(engine, "get_analyst_actions", lambda: _wire())
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, "")                       # listed in DATA_KINDS, not armed
    for kind in sorted(ISOLATED):
        out = _read(kind)
        assert out["status"] == "refused" and out["data"] is None, kind
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, aa.KIND)                  # arming ONE arms one
    assert _read(aa.KIND)["status"] == "ok"
    assert _read(aa.KIND)["isolated"] is True
    for kind in sorted(ISOLATED - {aa.KIND}):
        assert _read(kind)["status"] == "refused", kind
    for purpose in ("research", "scan"):                                # never for a model's research
        assert _read(aa.KIND, purpose=purpose)["status"] == "refused"
    assert "isolated" not in _read(sp.KIND, {"period": "bogus"})        # the plain kind carries no marker


# ── analyst.actions ──────────────────────────────────────────────────────────────────────────────────────────────────
def _wire(**over):
    item = lambda t, action, **kw: {"ticker": t, "action": action, "firm": "Example Securities", "from_rating": "Hold",
                                    "to_rating": "Buy", "price_target": "$120", "internal_note": "never shown", **kw}
    body = {"upgrades": [item("AAA", "Upgrade"), item("BBB", "Initiates", from_rating=None)],
            "downgrades": [item("CCC", "Downgrade", from_rating="Buy", to_rating="Hold")],
            "pt_changes": [item("DDD", "Raises PT"), {"action": "Lowers PT"}],          # the second has no ticker
            "summary": {"upgrades": 2, "downgrades": 1, "pt_changes": 2}, "wire_date": "2026-11-13", "wire_status": "fresh"}
    return {**body, **over}


def test_analyst_actions_as_of_is_the_wires_own_date_and_never_todays(monkeypatch):
    monkeypatch.setattr(engine, "get_analyst_actions", lambda: _wire())
    out = _read(aa.KIND)
    _conforms(out, aa.KIND)
    assert out["status"] == "ok" and out["freshness"] == "periodic" and out["stale"] is False
    assert out["as_of"] == "2026-11-13T05:00:00Z"                       # the start of that Eastern day
    assert out["provider_calls"] == 0 and out["source"] == aa.SOURCE
    d = out["data"]
    assert d["wire_date"] == "2026-11-13" and d["wire_status"] == "fresh"
    assert [a["ticker"] for a in d["upgrades"]] == ["AAA", "BBB"] and len(d["pt_changes"]) == 1
    assert {b: d["summary"][b] for b in aa.BUCKETS} == {"upgrades": 2, "downgrades": 1, "pt_changes": 1}
    assert set(d["upgrades"][0]) - {"isolated"} == set(aa.ITEM_FIELDS)  # the documented fields only
    assert aa.NOTE_FROM_WIRE.format(date="2026-11-13") in out["notes"] and aa.NOTE_DATE_ONLY in out["notes"]
    assert not any("today's analyst" in n for n in out["notes"])


def test_analyst_actions_stale_is_the_services_own_verdict(monkeypatch):
    monkeypatch.setattr(engine, "get_analyst_actions", lambda: _wire(wire_status="stale", wire_date="2026-11-12"))
    out = _read(aa.KIND)
    _conforms(out, aa.KIND)
    assert out["stale"] is True and out["as_of"] == "2026-11-12T05:00:00Z"
    assert aa.NOTE_BEHIND.format(date="2026-11-12") in out["notes"]


def test_analyst_actions_with_no_wire_date_gives_no_as_of_and_says_so(monkeypatch):
    monkeypatch.setattr(engine, "get_analyst_actions", lambda: _wire(wire_date=None, wire_status="unknown"))
    out = _read(aa.KIND)
    _conforms(out, aa.KIND)
    assert out["status"] == "ok" and out["as_of"] is None and out["stale"] is True and aa.NOTE_UNDATED in out["notes"]


def test_analyst_actions_side_filter_and_an_empty_dated_wire(monkeypatch):
    monkeypatch.setattr(engine, "get_analyst_actions", lambda: _wire())
    d = _read(aa.KIND, {"side": "downgrades"})["data"]
    assert d["upgrades"] == [] and d["pt_changes"] == [] and [a["ticker"] for a in d["downgrades"]] == ["CCC"]
    monkeypatch.setattr(engine, "get_analyst_actions", lambda: _wire(upgrades=[], downgrades=[], pt_changes=[]))
    out = _read(aa.KIND)
    assert out["status"] == "ok" and aa.NOTE_EMPTY.format(date="2026-11-13") in out["notes"]


def test_analyst_actions_no_wire_at_all_and_a_failing_service_are_unavailable(monkeypatch):
    monkeypatch.setattr(engine, "get_analyst_actions",
                        lambda: {"upgrades": [], "downgrades": [], "pt_changes": [], "wire_date": None, "wire_status": "unknown"})
    out = _read(aa.KIND)
    _conforms(out, aa.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [aa.NOTE_NO_WIRE] and out["data"] is None

    def boom():
        raise RuntimeError("wire file unreadable")
    monkeypatch.setattr(engine, "get_analyst_actions", boom)
    out = _read(aa.KIND)
    _conforms(out, aa.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [aa.NOTE_FAILED]


def test_analyst_actions_bad_side_is_refused_before_any_read(monkeypatch):
    ran = []
    monkeypatch.setattr(engine, "get_analyst_actions", lambda: ran.append(1) or _wire())
    out = _read(aa.KIND, {"side": "rumours"})
    assert out["status"] == "refused" and ran == []


# ── highsLows.session ────────────────────────────────────────────────────────────────────────────────────────────────
def _live(**over):
    row = lambda s, c, d: {"sym": s, "price": 10.5, "pct": 2.5, "count": c, "ts": "2026-11-13T10:29:58-05:00", "dir": d,
                           "pick": s}
    body = {"window": "rth", "date": "2026-11-13", "asof": "2026-11-13T10:29:58.123456-05:00", "ticks": 900, "active": True,
            "highs_total": 40, "lows_total": 2, "group": None, "value": None, "categories": {},
            "highs": [row("AAA", 12, "high"), row("BBB", 7, "high")], "lows": [row("CCC", 3, "low")]}
    return {**body, **over}


def test_session_highs_lows_ok_says_session_not_52_week_and_gives_no_as_of(monkeypatch):
    seen = {}
    monkeypatch.setattr(nhnl_live, "get_live", lambda **kw: seen.update(kw) or _live())
    out = _read(hl.KIND, {"limit": 5, "min_price": 5, "min_count": 2})
    _conforms(out, hl.KIND)
    assert seen == {"limit": 5, "min_price": 5.0, "min_count": 2}
    assert out["status"] == "ok" and out["freshness"] == "periodic" and out["stale"] is False
    assert out["as_of"] is None and out["provider_calls"] == 0
    d = out["data"]
    assert d["tick_at"] == "2026-11-13T15:29:58Z" and d["window"] == "rth" and d["active"] is True
    assert [r["sym"] for r in d["highs"]] == ["AAA", "BBB"] and d["highs_total"] == 40 and d["lows_total"] == 2
    assert set(d["highs"][0]) - {"isolated"} == set(hl.ROW_FIELDS)
    assert hl.NOTE_WHAT in out["notes"] and "not 52-week" in hl.NOTE_WHAT
    assert hl.NOTE_TICK.format(at="2026-11-13T15:29:58Z") in out["notes"]
    assert out["coverage"] == {"evaluated": 42, "answered": 3, "dropped": 39, "not_computable": 0}


def test_session_highs_lows_a_stopped_scanner_is_stale(monkeypatch):
    monkeypatch.setattr(nhnl_live, "get_live", lambda **kw: _live())
    monkeypatch.setattr(hl, "now_utc", lambda: NOW + timedelta(minutes=5))
    out = _read(hl.KIND)
    _conforms(out, hl.KIND)
    assert out["stale"] is True and hl.NOTE_STOPPED in out["notes"]


def test_session_highs_lows_closed_market_is_historical_never_current(monkeypatch):
    monkeypatch.setattr(nhnl_live, "get_live", lambda **kw: _live(window="closed", active=False))
    out = _read(hl.KIND)
    _conforms(out, hl.KIND)
    assert out["status"] == "ok" and out["freshness"] == "historical" and out["stale"] is False
    assert hl.NOTE_CLOSED.format(date="2026-11-13") in out["notes"]


@pytest.mark.parametrize("payload,note", [
    (dict(active=False), hl.NOTE_OFF),                                              # a session is open, the scanner is off
    (dict(asof=None), hl.NOTE_NO_TICK),                                             # running, never ticked
    (dict(window="closed", active=False, highs=[], lows=[]), hl.NOTE_CLOSED_EMPTY),  # closed, nothing held
    (dict(window="closed", active=False, asof=None), hl.NOTE_CLOSED_EMPTY),
])
def test_session_highs_lows_off_or_empty_is_unavailable_never_no_new_highs(monkeypatch, payload, note):
    monkeypatch.setattr(nhnl_live, "get_live", lambda **kw: _live(**payload))
    out = _read(hl.KIND)
    _conforms(out, hl.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [note] and out["data"] is None


def test_session_highs_lows_failing_service_and_bad_requests(monkeypatch):
    ran = []

    def boom(**kw):
        ran.append(kw)
        raise RuntimeError("scanner lock")
    monkeypatch.setattr(nhnl_live, "get_live", boom)
    out = _read(hl.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [hl.NOTE_FAILED] and len(ran) == 1
    for bad in ({"limit": 0}, {"limit": hl.MAX_LIMIT + 1}, {"limit": True}, {"min_price": -1}, {"min_price": "5"},
                {"min_count": 0}, {"min_count": 1.5}):
        assert _read(hl.KIND, bad)["status"] == "refused", bad
    assert len(ran) == 1                                                # refused before any read


# ── sectors.performance ──────────────────────────────────────────────────────────────────────────────────────────────
def _sector_rows(drop=()):
    return [{"sector": name, "ticker": t, "change_pct": round(1.5 - i * 0.3, 2)}
            for i, (name, t) in enumerate(sector_strength.SECTOR_ETFS.items()) if t not in drop]


def test_sectors_cold_read_counts_one_request_per_fund_and_a_warm_read_none(monkeypatch):
    built = []
    monkeypatch.setattr(sector_strength, "compute_sector_returns", lambda n_bars, **kw: built.append(n_bars) or _sector_rows())
    out = _read(sp.KIND, {"period": "1M"})
    _conforms(out, sp.KIND)
    assert out["status"] == "ok" and out["freshness"] == "periodic" and out["as_of"] is None and out["stale"] is False
    assert out["provider_calls"] == len(sector_strength.SECTOR_ETFS) and built == [sector_strength.PERIOD_TO_BARS["1M"]]
    d = out["data"]
    assert d["period"] == "1M" and d["sessions"] == 21 and d["missing"] == [] and len(d["sectors"]) == 11
    assert set(d["sectors"][0]) == set(sp.ROW_FIELDS)
    assert [r["change_pct"] for r in d["sectors"]] == sorted((r["change_pct"] for r in d["sectors"]), reverse=True)
    assert sp.NOTE_NO_TIME.format(n=21) in out["notes"]
    again = _read(sp.KIND, {"period": "1M"})
    assert again["provider_calls"] == 0 and built == [21]              # served from the service's own cache


def test_the_cache_key_is_the_services_own(monkeypatch):
    """The warm / cold call count reads the service's cache key. If the service renames it, this fails by name."""
    monkeypatch.setattr(sector_strength, "compute_sector_returns", lambda n_bars, **kw: _sector_rows())
    for period in sector_strength.PERIOD_TO_BARS:
        assert cache.get(sp.cache_key(period)) is None
        sector_strength.get_sector_strength(period)
        assert cache.get(sp.cache_key(period)) is not None, period


def test_sectors_a_dropped_fund_makes_the_read_partial_and_names_it(monkeypatch):
    monkeypatch.setattr(sector_strength, "compute_sector_returns", lambda n_bars, **kw: _sector_rows(drop=("XLRE", "XLU")))
    out = _read(sp.KIND, {})
    _conforms(out, sp.KIND)
    assert out["status"] == "partial" and out["data"]["missing"] == ["Real Estate", "Utilities"]
    assert out["coverage"] == {"evaluated": 11, "answered": 9, "dropped": 2, "not_computable": 0}
    assert sp.NOTE_MISSING.format(names="Real Estate, Utilities") in out["notes"]


def test_sectors_nothing_readable_or_a_failing_service_is_unavailable(monkeypatch):
    monkeypatch.setattr(sector_strength, "compute_sector_returns", lambda n_bars, **kw: [])
    out = _read(sp.KIND, {})
    _conforms(out, sp.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [sp.NOTE_UNAVAILABLE]

    def boom(period="Today"):
        raise RuntimeError("provider down")
    monkeypatch.setattr(sector_strength, "get_sector_strength", boom)
    out = _read(sp.KIND, {})
    assert out["status"] == "unavailable" and out["notes"] == [sp.NOTE_FAILED]


def test_sectors_an_unknown_period_is_refused_before_any_read(monkeypatch):
    ran = []
    monkeypatch.setattr(sector_strength, "get_sector_strength", lambda period="Today": ran.append(period) or [])
    for bad in ({"period": "1Y"}, {"period": "today"}, {"period": 5}):
        assert _read(sp.KIND, bad)["status"] == "refused", bad
    assert ran == []


# ── leaders.longRun ──────────────────────────────────────────────────────────────────────────────────────────────────
def _scan(n=3, **over):
    rows = [{"sym": f"A{i}", "change_nd": 80.0 - i, "ref_close": 10.0, "price": 18.0 - i * 0.1, "prev_close": 17.5,
             "change_pct": 1.2, "volume": 5_000_000, "ref_max": 4_000_000, "ratio": 1.25, "ipo_date": 20260212,
             "secret": "dropped"} for i in range(n)]
    body = {"status": "ok", "results": rows, "count": n, "as_of": "2026-11-13T10:29:30-05:00",
            "coverage": {"evaluated": 500, "answered": 480, "dropped": 5, "not_computable": 15, "dropped_symbols": []}}
    return {**body, **over}


GETTERS = {"30D": (scan_gainers, "get_top_gainers_30d"), "60D": (scan_gainers, "get_top_gainers_60d"),
           "90D": (scan_gainers, "get_top_gainers_90d"), "VOL1Y": (scan_volume, "get_highest_volume_1y"),
           "VOLMAX": (scan_volume, "get_highest_volume_ever"), "IPO": (scan_ipo, "get_ipo_last_1y")}


def test_the_lists_are_the_lead_panels_lens_keys():
    """One fact in two files: the kind's `list` values ARE the LEAD panel's lens keys. Parsed, never retyped."""
    js = (REPO / "app/src/pages/terminal/panels/longRunModel.js").read_text(encoding="utf-8")
    block = js[js.index("export const LONG_RUN_LENSES = Object.freeze({"):js.index("export const DEFAULT_LENS")]
    keys = re.findall(r"^\s+'?([A-Z0-9]+)'?: Object\.freeze\(\{ kind: '(\w+)'", block, flags=re.M)
    assert len(keys) == 6
    assert dict(keys) == {k: v[0] for k, v in lr.LISTS.items()}
    assert {k: (v[1], v[2]) for k, v in lr.LISTS.items()} == {k: (m.__name__.rsplit(".", 1)[1], fn) for k, (m, fn) in GETTERS.items()}


@pytest.mark.parametrize("key", sorted(GETTERS))
def test_leaders_each_list_calls_its_own_service_and_keeps_its_own_fields(monkeypatch, key):
    module, fn = GETTERS[key]
    called = []
    for other_key, (m, f) in GETTERS.items():
        monkeypatch.setattr(m, f, (lambda k=other_key: called.append(k) or _scan(4)))
    out = _read(lr.KIND, {"list": key, "limit": 2})
    _conforms(out, lr.KIND)
    assert called == [key]
    family = lr.LISTS[key][0]
    d = out["data"]
    assert out["status"] == "ok" and out["freshness"] == "periodic" and out["as_of"] is None and out["provider_calls"] == 1
    assert d["list"] == key and d["family"] == family and d["count"] == 4 and len(d["results"]) == 2
    assert set(d["results"][0]) - {"isolated"} == set(lr.FIELDS[family])
    assert d["computed_at"] == "2026-11-13T15:29:30Z" and lr.NOTE_TIME.format(at=d["computed_at"]) in out["notes"]
    assert lr.NOTE_CUT.format(n=2, total=4) in out["notes"]
    assert out["coverage"] == {"evaluated": 500, "answered": 480, "dropped": 5, "not_computable": 15}


def test_leaders_computing_is_unavailable_and_an_empty_ok_is_not_called_no_leaders(monkeypatch):
    monkeypatch.setattr(scan_gainers, "get_top_gainers_30d",
                        lambda: {"status": "computing", "results": [], "count": 0, "as_of": None})
    out = _read(lr.KIND)
    _conforms(out, lr.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [lr.NOTE_COMPUTING] and out["provider_calls"] == 0
    monkeypatch.setattr(scan_gainers, "get_top_gainers_30d",
                        lambda: {"status": "ok", "results": [], "count": 0, "as_of": "2026-11-13T08:00:00-05:00"})
    out = _read(lr.KIND)
    _conforms(out, lr.KIND)
    assert out["status"] == "ok" and out["data"]["results"] == [] and lr.NOTE_EMPTY in out["notes"]
    assert out["coverage"] is None


def test_leaders_failing_service_and_bad_requests(monkeypatch):
    ran = []

    def boom():
        ran.append(1)
        raise RuntimeError("snapshot failed")
    monkeypatch.setattr(scan_ipo, "get_ipo_last_1y", boom)
    out = _read(lr.KIND, {"list": "IPO"})
    assert out["status"] == "unavailable" and out["notes"] == [lr.NOTE_FAILED]
    for bad in ({}, {"list": "30d"}, {"list": "TOP"}, {"list": "IPO", "limit": 0}, {"list": "IPO", "limit": lr.MAX_LIMIT + 1}):
        assert _read(lr.KIND, bad)["status"] == "refused", bad
    assert ran == [1]


# ── levels.darkpool ──────────────────────────────────────────────────────────────────────────────────────────────────
def _levels(**over):
    lv = lambda rank, price, last: {"price": price, "notional": 25_000_000.0 / rank, "printCount": 4, "lastDate": last,
                                    "lo": price - 0.1, "hi": price + 0.1, "rank": rank, "raw": "dropped"}
    body = {"sym": "AAA", "version": rules.VERSIONS["dpl"], "windowDays": rules.DPL_WINDOW_DAYS, "datesCovered": 14,
            "levels": [lv(1, 101.25, "2026-11-10"), lv(2, 98.5, "2026-11-13")], "asOf": 1794583800.0}
    return {**body, **over}


def test_the_symbol_rule_is_the_member_routes_own():
    src = (REPO / "api/routers/signature.py").read_text(encoding="utf-8")
    m = re.search(r'^_SYM_RE = re\.compile\(r"(.+)"\)$', src, flags=re.M)
    assert m and m.group(1) == dp.SYMBOL_RE.pattern


def test_darkpool_levels_as_of_is_the_newest_print_date_never_the_build_time(monkeypatch):
    asked = []
    monkeypatch.setattr(dpl_service, "fetch_dp_levels", lambda sym: asked.append(sym) or _levels())
    out = _read(dp.KIND, {"symbol": " aaa "})
    _conforms(out, dp.KIND)
    assert asked == ["AAA"]
    assert out["status"] == "ok" and out["freshness"] == "historical" and out["provider_calls"] == 0
    assert out["as_of"] == "2026-11-13T21:00:00Z"                       # Fri 2026-11-13's 16:00 ET close
    d = out["data"]
    assert d["newest_print_date"] == "2026-11-13" and d["asOf"] == 1794583800.0
    assert d["computed_at"] == env.utc_iso(datetime.fromtimestamp(1794583800.0, tz=timezone.utc)) != out["as_of"]
    assert [lv["rank"] for lv in d["levels"]] == [1, 2] and set(d["levels"][0]) - {"isolated"} == set(dp.LEVEL_FIELDS)
    assert dp.NOTE_AS_OF in out["notes"] and dp.NOTE_LEDGER in out["notes"]


def test_darkpool_levels_no_cluster_is_ok_and_undated_levels_give_no_as_of(monkeypatch):
    monkeypatch.setattr(dpl_service, "fetch_dp_levels", lambda sym: _levels(levels=[]))
    out = _read(dp.KIND)
    _conforms(out, dp.KIND)
    assert out["status"] == "ok" and out["as_of"] is None and dp.NOTE_NONE.format(sym="AAA") in out["notes"]
    monkeypatch.setattr(dpl_service, "fetch_dp_levels",
                        lambda sym: _levels(levels=[{**_levels()["levels"][0], "lastDate": "11/10"}]))
    out = _read(dp.KIND)
    _conforms(out, dp.KIND)
    assert out["as_of"] is None and dp.NOTE_NO_DATE in out["notes"]


@pytest.mark.parametrize("payload", [{"sym": "AAA", "levels": None, "error": "dark pool levels unavailable: db locked"},
                                     {"sym": "AAA", "levels": None}, {"sym": "AAA", "levels": [], "error": "x"}, None])
def test_darkpool_levels_a_failed_read_is_unavailable_never_no_levels(monkeypatch, payload):
    monkeypatch.setattr(dpl_service, "fetch_dp_levels", lambda sym: payload)
    out = _read(dp.KIND)
    _conforms(out, dp.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [dp.NOTE_FAILED.format(sym="AAA")] and out["data"] is None


def test_darkpool_levels_failing_service_and_bad_symbols(monkeypatch):
    ran = []

    def boom(sym):
        ran.append(sym)
        raise RuntimeError("no such table")
    monkeypatch.setattr(dpl_service, "fetch_dp_levels", boom)
    out = _read(dp.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [dp.NOTE_FAILED.format(sym="AAA")]
    for bad in ({}, {"symbol": ""}, {"symbol": ".."}, {"symbol": "-A"}, {"symbol": "AAA BBB"}, {"symbol": 7},
                {"symbol": "ABCDEFGHIJK"}, {"symbols": ["AAA", "BBB"]}):
        assert _read(dp.KIND, bad)["status"] == "refused", bad
    assert ran == ["AAA"]


# ── the contract (MD-1 v1.7 §4.10) ───────────────────────────────────────────────────────────────────────────────────
def test_the_contract_doc_states_section_4_10_and_every_note_the_adapters_emit():
    """MD-1 §4.10 quotes each note verbatim; QA pins fixtures to the doc, so the two must not drift. The two statements
    v1.7 amended (the scanner "not exposed", dark pool deferred outright) no longer stand as they were written."""
    doc = (REPO / "docs/agent/program/contracts/MD-1-market-data.md").read_text(encoding="utf-8")
    head = ("### 4.10 Terminal data wave 1: `analyst.actions`, `highsLows.session`, `sectors.performance`, "
            "`leaders.longRun`, `levels.darkpool` (v1.7, terminal-data)")
    assert head in doc                                    # the section, not the file's title: later bumps add
    section = doc[doc.index(head):doc.index("## 8. Changing this contract")]
    for m in MODULES:
        assert f"`{m.KIND}`" in section and f"`{m.SOURCE}`" in section, m.KIND
        notes = {k: v for k, v in vars(m).items() if k.startswith("NOTE_")}
        assert notes, m.KIND
        for name, text in notes.items():
            assert text in section, f"{m.KIND} {name}"
    # default OFF, and the isolation switch of the four isolated kinds, are stated where the kinds are documented
    for s in ("UCT_AGENT_DATA_KINDS", "UCT_AGENT_ISOLATED_KINDS", "turn.LOCAL_ONLY_ACTIONS", "turn.DATA_READ_ACTIONS",
              "**Status: dark, not armed.**"):
        assert s in section, s
    for kind in sorted(ISOLATED):
        assert f"| `{kind}` |" in section and f"- `{kind}`: " in section, kind        # its table row, and why it is isolated
    assert "- `sectors.performance` is **not** isolated" in section
    assert "and is **not exposed**" not in doc
    assert "- **`darkpool`:** only once a trustworthy `as_of` source is identified.\n" not in doc
    assert "- **v1.7 addition (2026-11-17, terminal-data, data wave 1):**" in doc
