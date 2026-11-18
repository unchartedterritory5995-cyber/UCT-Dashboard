"""MD-1 kinds of terminal data wave 2: `highsLows.yearly`, `themes.rotation`, `confluence.board`, `earnings.expectedMove`,
`earnings.callSearch` — the Agent half of the H52 / TROT / CONFL / EXMV / TSRC terminal panels.

No network, no database: every service is stubbed at the function its member route calls (or its cache is filled
through the service's own function), and every clock is pinned. Pinned per kind: an ok read (envelope conformance, the
documented fields only, the data's own time or null with a note), `unavailable` kept apart from a healthy empty answer,
a malformed request refused before any read, a failing service answered `unavailable`, a read never fresher than its
kind declares, and THE BUDGET RULE of this wave: no read ever starts a build (a breadth read, a theme overlay, a
confluence board, an option chain). For all five: registered dark, model-isolated, dormant until armed one by one.
The cross-file facts (the H52 drill keys, the services' cache names, the licensed chain source) are read from the
other file rather than retyped. And the contract: MD-1 §4.11 quotes every note these adapters emit, verbatim.
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from api import confluence_screen
from api.services import breadth_live, breadth_monitor, implied_move, implied_store, theme_performance, transcript_index
from api.services.cache import cache
from api.services.uct_agent.marketdata import (confluence_board as cb, earnings_call_search as cs,
                                              earnings_expected_move as em, themes_rotation as tr,
                                              yearly_highs_lows as yh)
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw
from api.services.uct_agent.marketdata import sessions

REPO = Path(__file__).resolve().parents[1]
MODULES = (yh, tr, cb, em, cs)
KINDS = tuple(m.KIND for m in MODULES)
#: this wave's isolation decisions (ADR-005): all five. A kind leaving this set is an owner decision.
ISOLATED = set(KINDS)
#: a well-formed request per kind (the gateway rails below need one that passes each kind's own validate)
GOOD = {yh.KIND: {}, tr.KIND: {}, cb.KIND: {}, em.KIND: {"symbol": "AAA"}, cs.KIND: {"q": "pricing power"}}
NOW = datetime(2026, 11, 13, 15, 30, tzinfo=timezone.utc)          # Fri 10:30 ET, a regular session
NOW_S = NOW.timestamp()
PANELS = REPO / "app/src/pages/terminal/panels"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(KINDS))
    monkeypatch.setenv(gw.ISOLATED_ENV, "1")
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(sorted(ISOLATED)))
    gw._reset_for_test(None)
    cache.invalidate(theme_performance._ROTATION_CACHE_KEY)
    monkeypatch.setattr(yh, "now_utc", lambda: NOW)
    monkeypatch.setattr(cb, "now_s", lambda: NOW_S)
    monkeypatch.setattr(em, "today_et", lambda: "2026-11-13")
    monkeypatch.setattr(sessions, "last_completed_session", lambda now=None: 20261112)
    monkeypatch.setattr(confluence_screen, "_CACHES", {})
    _forget_moves()
    yield
    _forget_moves()
    cache.invalidate(theme_performance._ROTATION_CACHE_KEY)
    gw._reset_for_test(None)


def _forget_moves():
    """Drop every straddle these tests hold in the service's cache and last-good slot."""
    for day in (None, "2026-11-19", "2026-11-20", "2026-11-24"):
        implied_move._MOVE_CACHE.invalidate(em.cache_key("AAA", day))
        implied_move._MOVE_STALE.forget(em.cache_key("AAA", day))


_turn = iter(range(10_000))


def _read(kind, params=None, purpose="answer"):
    return gw.read(kind, GOOD[kind] if params is None else params, user_id=1, turn_id=f"t{next(_turn)}", purpose=purpose)


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
def test_every_kind_is_registered_once_by_its_module_and_all_five_are_isolated():
    r = gw.registry()
    for m in MODULES:
        k = r.get(m.KIND)
        assert k is not None and k.owner == "terminal-data" and k.category == "market", m.KIND
        assert k.validate is m.validate and k.description
        assert k.model_isolated is True, m.KIND
        assert "Shown to the member only" in k.description, m.KIND
    assert {r.get(k).freshness for k in KINDS} == {"periodic"}       # none is ever declared live or delayed
    assert r.get(em.KIND).max_symbols == 1 and r.get(cs.KIND).max_symbols == 1


def test_dark_unless_the_gateway_is_on_and_the_kind_is_named(monkeypatch):
    ran = []
    monkeypatch.setattr(breadth_live, "compute_live", lambda **kw: ran.append("yh") or {})
    monkeypatch.setattr(confluence_screen, "get_board", lambda **kw: ran.append("cb") or {})
    monkeypatch.setattr(implied_store, "get_implied_history", lambda sym, limit=8: ran.append("em") or [])
    monkeypatch.setattr(transcript_index, "stats", lambda: ran.append("cs") or {})
    monkeypatch.setattr(tr, "cached_signals", lambda: ran.append("tr"))
    monkeypatch.setenv(gw.KINDS_ENV, "quote,themes,highsLows.session")
    for kind in KINDS:
        out = _read(kind)
        assert out["status"] == "refused" and gw.KINDS_ENV in out["notes"][0], kind
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(KINDS))
    monkeypatch.delenv(gw.DATA_ENV)
    for kind in KINDS:
        assert _read(kind)["status"] == "refused", kind
    assert ran == []


def test_isolated_kinds_are_dormant_until_armed_by_name_and_answer_the_member_only(monkeypatch):
    monkeypatch.setattr(transcript_index, "stats", lambda: _stats())
    monkeypatch.setattr(transcript_index, "search", lambda q, **kw: _found())
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, "")                       # listed in DATA_KINDS, not armed
    for kind in KINDS:
        out = _read(kind)
        assert out["status"] == "refused" and out["data"] is None, kind
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, cs.KIND)                  # arming ONE arms one
    assert _read(cs.KIND)["status"] == "ok"
    for kind in sorted(ISOLATED - {cs.KIND}):
        assert _read(kind)["status"] == "refused", kind
    for purpose in ("research", "scan"):                                # never for a model's research
        assert _read(cs.KIND, purpose=purpose)["status"] == "refused"
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(sorted(ISOLATED)))
    monkeypatch.delenv(gw.ISOLATED_ENV)                                 # the master switch turns every one off
    for kind in KINDS:
        assert _read(kind)["status"] == "refused", kind


# ── highsLows.yearly ─────────────────────────────────────────────────────────────────────────────────────────────────
def _status(**over):
    body = {"ok": True, "provisional": True, "session_live": True, "degraded": False, "session_date": "2026-11-13",
            "as_of": "2026-11-13T10:29:30-05:00", "data_as_of": "2026-11-13T10:29:05-05:00", "market_open": True,
            "nhnl_basis": "intraday", "metrics": {"new_52w_highs": 41}}
    return {**body, **over}


def _item(t, pct):
    return {"t": t, "c": 10.5, "pct": pct, "vr": 1.8, "v": 1_200_000, "n": f"{t} Corp", "a50": 3.1, "atr": 2.0}


def _names(prefix, n):
    return [_item(f"{prefix}{i}", round(9.0 - i, 2)) for i in range(n)]


def _wire_breadth(monkeypatch, status=None, stored="2026-11-12", live=None, kept=None):
    """Stub the four reads; returns the call log. `live` / `kept`: list key → the drill answer / the stored list."""
    log = {"compute": [], "drill": [], "stored": [], "filled": []}
    live = {yh.LISTS["highs"]: {"ok": True, "items": _names("H", 3), "reason": None, "as_of": "2026-11-13T10:29:30-05:00"},
            yh.LISTS["lows"]: {"ok": True, "items": _names("L", 2), "reason": None, "as_of": "2026-11-13T10:29:30-05:00"},
            **(live or {})}
    kept = {yh.LISTS["highs"]: _names("SH", 4), yh.LISTS["lows"]: _names("SL", 1), **(kept or {})}

    def compute_live(force=False, cached_only=False):
        log["compute"].append({"force": force, "cached_only": cached_only})
        return _status() if status is None else status

    monkeypatch.setattr(breadth_live, "compute_live", compute_live)
    monkeypatch.setattr(breadth_live, "_compute_fresh", _boom)
    monkeypatch.setattr(breadth_live, "live_drill", lambda key: log["drill"].append(key) or live[key])
    monkeypatch.setattr(breadth_monitor, "get_history",
                        lambda days=90, end=None, anchor="le": [{"date": stored, "new_52w_highs": 40}] if stored else [])
    monkeypatch.setattr(breadth_monitor, "get_drill_list", lambda day, key: log["stored"].append((day, key)) or kept[key])
    monkeypatch.setattr(breadth_monitor, "fill_drill_volumes", lambda day, items: log["filled"].append(day) or items)
    return log


def test_the_drill_keys_are_the_h52_panels_own():
    """One fact in two files: the kind's lists ARE the H52 panel's drill keys. Parsed, never retyped."""
    js = (PANELS / "highs52Model.js").read_text(encoding="utf-8")
    block = js[js.index("export const HIGHS52_SIDES = Object.freeze({"):js.index("/** The words a side can be typed as")]
    found = dict(re.findall(r"^\s+(highs|lows): Object\.freeze\(\{[^}]*list: '(\w+)'", block, flags=re.M))
    assert found == yh.LISTS and len(found) == 2
    assert set(yh.SIDES) == {"both"} | set(found)
    for key in yh.LISTS.values():                                     # and both are lists the live read can back
        assert breadth_live._metric_key_of(key) in breadth_live.DRILLABLE, key


def test_yearly_session_under_way_reads_the_warm_breadth_read_and_never_computes(monkeypatch):
    log = _wire_breadth(monkeypatch)
    out = _read(yh.KIND, {"side": "both", "limit": 2})
    _conforms(out, yh.KIND)
    assert log["compute"] == [{"force": False, "cached_only": True}]  # the service's own non-building read, once
    assert log["drill"] == [yh.LISTS["highs"], yh.LISTS["lows"]] and log["stored"] == []
    assert out["status"] == "ok" and out["freshness"] == "periodic" and out["stale"] is False
    assert out["as_of"] == "2026-11-13T15:29:05Z"                     # the vendor's snapshot time, never UCT's compute time
    d = out["data"]
    assert d["mode"] == "live" and d["why"] is None and d["session_date"] == "2026-11-13" and d["basis"] == "intraday"
    assert d["computed_at"] == "2026-11-13T15:29:30Z" != out["as_of"]
    assert [i["t"] for i in d["highs"]["items"]] == ["H0", "H1"] and d["highs"]["count"] == 3 and d["lows"]["count"] == 2
    assert set(d["highs"]["items"][0]) - {"isolated"} == set(yh.ITEM_FIELDS)       # the documented fields only
    assert d["highs"]["state"] == d["lows"]["state"] == "ok" and d["missing"] == []
    assert yh.NOTE_WHAT in out["notes"] and yh.NOTE_BASIS in out["notes"]
    assert yh.NOTE_LIVE.format(date="2026-11-13", at="2026-11-13T15:29:30Z") in out["notes"]
    assert yh.NOTE_CUT.format(n=2, total=3, side="high") in out["notes"]
    assert not any(n.startswith("showing the first") and "low list" in n for n in out["notes"])
    assert out["coverage"] == {"evaluated": 5, "answered": 4, "dropped": 1, "not_computable": 0}


def test_yearly_no_vendor_stamp_gives_no_as_of_and_an_old_read_is_stale(monkeypatch):
    _wire_breadth(monkeypatch, status=_status(data_as_of=None, nhnl_basis=None))
    out = _read(yh.KIND)
    _conforms(out, yh.KIND)
    assert out["as_of"] is None and out["stale"] is False and out["data"]["basis"] is None
    assert yh.NOTE_LIVE_NO_TIME.format(date="2026-11-13", at="2026-11-13T15:29:30Z") in out["notes"]
    assert yh.NOTE_BASIS not in out["notes"]
    monkeypatch.setattr(yh, "now_utc", lambda: NOW + timedelta(seconds=yh.STALE_AFTER_S + 60))
    out = _read(yh.KIND)
    assert out["stale"] is True and yh.NOTE_STALE_LIVE in out["notes"]


@pytest.mark.parametrize("status,stored,why,note", [
    (_status(session_live=False, session_date="2026-11-12"), "2026-11-12", "closed", yh.NOTE_CLOSED),
    (_status(), "2026-11-13", "finished", yh.NOTE_FINISHED),            # today's row is stored: superseded
    (_status(degraded=True), "2026-11-12", "thin", yh.NOTE_THIN),
    ({"ok": False, "reason": "no warm live cache (cached_only)"}, "2026-11-12", "no_read", yh.NOTE_NO_READ),
    (None, "2026-11-12", "no_read", yh.NOTE_NO_READ),
])
def test_yearly_otherwise_the_newest_finished_session_with_the_reason(monkeypatch, status, stored, why, note):
    log = _wire_breadth(monkeypatch, status=status if status is not None else {"ok": False}, stored=stored)
    monkeypatch.setattr(sessions, "last_completed_session", lambda now=None: int(stored.replace("-", "")))
    out = _read(yh.KIND, {"side": "highs"})
    _conforms(out, yh.KIND)
    assert log["drill"] == [] and log["stored"] == [(stored, yh.LISTS["highs"])] and log["filled"] == [stored]
    assert out["status"] == "ok" and out["freshness"] == "historical" and out["stale"] is False
    d = out["data"]
    assert d["mode"] == "settled" and d["why"] == why and d["session_date"] == stored and d["lows"] is None
    assert d["computed_at"] is None and d["basis"] is None and why in yh.WHYS
    assert [i["t"] for i in d["highs"]["items"]] == ["SH0", "SH1", "SH2", "SH3"]
    y, m, dd = (int(p) for p in stored.split("-"))
    assert out["as_of"] == env.utc_iso(datetime(y, m, dd, 21, 0, tzinfo=timezone.utc))      # that session's 16:00 ET close
    assert yh.NOTE_SETTLED.format(date=stored) in out["notes"] and note in out["notes"]


def test_yearly_a_stored_session_behind_the_last_completed_one_is_stale(monkeypatch):
    _wire_breadth(monkeypatch, status={"ok": False}, stored="2026-11-10")
    out = _read(yh.KIND)
    _conforms(out, yh.KIND)
    assert out["stale"] is True
    assert yh.NOTE_STALE_SETTLED.format(date="2026-11-10", session="2026-11-12") in out["notes"]


def test_the_services_own_cached_only_read_never_computes(monkeypatch):
    """Through the REAL `compute_live(cached_only=True)`: a cold cache answers not-ok and builds nothing. The build is
    COUNTED, not raised: the adapter answers a raising service honestly, which would hide a build that only raised."""
    built = []
    monkeypatch.setattr(breadth_live, "_compute_fresh", lambda now: built.append("fresh") or {"ok": False, "reason": "stub"})
    monkeypatch.setattr(breadth_live, "reference_levels", lambda *a, **kw: built.append("levels"))
    monkeypatch.setattr(breadth_live, "_live_cache", {})
    monkeypatch.setenv("BREADTH_LIVE_ENABLED", "1")
    monkeypatch.setattr(breadth_monitor, "get_history", lambda days=90, end=None, anchor="le": [{"date": "2026-11-12"}])
    monkeypatch.setattr(breadth_monitor, "get_drill_list", lambda day, key: _names("S", 2))
    monkeypatch.setattr(breadth_monitor, "fill_drill_volumes", lambda day, items: items)
    out = _read(yh.KIND)
    _conforms(out, yh.KIND)
    assert out["status"] == "ok" and out["data"]["mode"] == "settled" and out["data"]["why"] == "no_read"
    monkeypatch.setattr(breadth_monitor, "get_history", lambda days=90, end=None, anchor="le": [])
    out = _read(yh.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [yh.NOTE_NOTHING]
    assert built == []                                                  # two reads, and nothing was ever built


def test_yearly_a_list_that_cannot_be_given_is_never_an_empty_list(monkeypatch):
    withheld = {"ok": False, "items": [], "reason": "new_52w_lows is not computed on the live path", "as_of": None}
    _wire_breadth(monkeypatch, live={yh.LISTS["lows"]: withheld})
    out = _read(yh.KIND)
    _conforms(out, yh.KIND)
    assert out["status"] == "partial" and out["data"]["missing"] == ["lows"]
    assert out["data"]["lows"] == {"state": "unavailable", "items": [], "count": 0, "isolated": True}
    assert yh.NOTE_SIDE_MISSING.format(side="low") in out["notes"]
    assert "not computed on the live path" not in json.dumps(out)      # the service's internal reason is not passed on
    out = _read(yh.KIND, {"side": "lows"})                              # the only list asked for cannot be given
    assert out["status"] == "unavailable" and out["notes"] == [yh.NOTE_UNAVAILABLE.format(date="2026-11-13")]
    _wire_breadth(monkeypatch, live={yh.LISTS["lows"]: {"ok": True, "items": [], "reason": None, "as_of": None}})
    out = _read(yh.KIND, {"side": "lows"})                              # a healthy empty list is an answer
    _conforms(out, yh.KIND)
    assert out["status"] == "ok" and out["data"]["lows"]["count"] == 0 and yh.NOTE_EMPTY.format(side="low") in out["notes"]


def test_yearly_a_stored_session_without_the_list_and_failing_services(monkeypatch):
    _wire_breadth(monkeypatch, status={"ok": False}, kept={yh.LISTS["highs"]: None})
    out = _read(yh.KIND)
    _conforms(out, yh.KIND)
    assert out["status"] == "partial" and out["data"]["missing"] == ["highs"] and out["data"]["lows"]["count"] == 1
    log = _wire_breadth(monkeypatch)

    def boom(**kw):
        raise RuntimeError("levels unavailable")
    monkeypatch.setattr(breadth_live, "compute_live", boom)             # the live read raising is "no read", not a crash
    out = _read(yh.KIND)
    assert out["status"] == "ok" and out["data"]["why"] == "no_read" and log["drill"] == []

    def no_store(*a, **kw):
        raise RuntimeError("database is locked")
    monkeypatch.setattr(breadth_monitor, "get_history", no_store)
    out = _read(yh.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [yh.NOTE_NOTHING]


def test_yearly_bad_requests_are_refused_before_any_read(monkeypatch):
    log = _wire_breadth(monkeypatch)
    for bad in ({"side": "52w"}, {"side": "HIGHS"}, {"limit": 0}, {"limit": yh.MAX_LIMIT + 1}, {"limit": True}, {"limit": 2.5}):
        assert _read(yh.KIND, bad)["status"] == "refused", bad
    assert log["compute"] == [] and log["drill"] == []


# ── themes.rotation ──────────────────────────────────────────────────────────────────────────────────────────────────
def _entry(tk, delta, **over):
    body = {"name": f"{tk} theme", "ticker": tk, "1w_return": 4.2, "1w_rank": 80.0, "1m_return": 1.1,
            "1m_rank": round(80.0 - delta, 1), "3m_return": 9.0, "3m_rank": 55.0, "momentum_delta": delta,
            "holdings": ["dropped"]}
    return {**body, **over}


def _signals(n_in=3, n_out=2, **over):
    ins = [_entry(f"IN{i}", 60.0 - i * 10) for i in range(n_in)]
    outs = [_entry(f"OUT{i}", -70.0 + i * 10) for i in range(n_out)]
    flat = [_entry("FLAT", 5.0)]
    body = {"rotating_in": ins, "rotating_out": outs, "rankings": {e["ticker"]: e for e in ins + outs + flat},
            "generated_at": "2026-11-13T15:20:00.123456+00:00"}
    return {**body, **over}


def _hold(payload):
    cache.set(theme_performance._ROTATION_CACHE_KEY, payload, ttl=600)


def _no_theme_build(monkeypatch):
    for fn in ("compute_rotation_signals", "get_theme_performance", "build_theme_performance", "_run_computation"):
        monkeypatch.setattr(theme_performance, fn, _boom)


def test_rotation_reads_the_services_cached_answer_and_gives_no_as_of(monkeypatch):
    _no_theme_build(monkeypatch)
    _hold(_signals())
    out = _read(tr.KIND, {"side": "both", "limit": 2})
    _conforms(out, tr.KIND)
    assert out["status"] == "ok" and out["freshness"] == "periodic" and out["as_of"] is None and out["stale"] is False
    d = out["data"]
    assert [e["ticker"] for e in d["rotating_in"]] == ["IN0", "IN1"] and d["in_count"] == 3
    assert [e["ticker"] for e in d["rotating_out"]] == ["OUT0", "OUT1"] and d["out_count"] == 2
    assert set(d["rotating_in"][0]) - {"isolated"} == set(tr.ENTRY_FIELDS)            # the documented fields only
    assert d["ranked"] == 6 and d["threshold"] == tr.THRESHOLD and d["computed_at"] == "2026-11-13T15:20:00Z"
    assert tr.NOTE_WHAT in out["notes"] and tr.NOTE_BASE in out["notes"]
    assert tr.NOTE_TIME.format(at="2026-11-13T15:20:00Z") in out["notes"]
    assert tr.NOTE_CUT.format(n=2, total=3, side="in") in out["notes"]
    assert out["coverage"] == {"evaluated": 6, "answered": 4, "dropped": 1, "not_computable": 0}


def test_rotation_one_side_and_nothing_rotating_is_a_healthy_answer(monkeypatch):
    _no_theme_build(monkeypatch)
    _hold(_signals())
    d = _read(tr.KIND, {"side": "out"})["data"]
    assert d["rotating_in"] == [] and d["in_count"] == 0 and [e["ticker"] for e in d["rotating_out"]] == ["OUT0", "OUT1"]
    _hold(_signals(n_in=0, n_out=0))
    out = _read(tr.KIND)
    _conforms(out, tr.KIND)
    assert out["status"] == "ok" and out["data"]["rotating_in"] == [] and out["data"]["ranked"] == 1
    assert tr.NOTE_NONE.format(side="in", ranked=1) in out["notes"] and tr.NOTE_NONE.format(side="out", ranked=1) in out["notes"]
    # a row on the wrong side of zero, or with no rank change, is not that list's
    _hold(_signals(rotating_in=[_entry("UP", 30.0), _entry("WRONG", -30.0), _entry("NONE", 30.0, momentum_delta=None),
                                 {"name": "no key", "momentum_delta": 40.0}]))
    assert [e["ticker"] for e in _read(tr.KIND)["data"]["rotating_in"]] == ["UP"]


def test_rotation_never_computes_a_cold_cache_is_unavailable_with_the_reason(monkeypatch):
    _no_theme_build(monkeypatch)
    out = _read(tr.KIND)
    _conforms(out, tr.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [tr.NOTE_NOT_CACHED] and out["data"] is None
    _hold({"rotating_in": [], "rotating_out": [], "rankings": {}, "generated_at": "2026-11-13T15:20:00+00:00"})
    out = _read(tr.KIND)                                                # the service's cold answer: never "nothing rotates"
    assert out["status"] == "unavailable" and out["notes"] == [tr.NOTE_WARMING]
    for bad in ({"rankings": {"a": {}}}, {"rotating_in": "x", "rotating_out": [], "rankings": {"a": {}}}, ["not", "a", "payload"]):
        _hold(bad)
        assert _read(tr.KIND)["notes"] == [tr.NOTE_FAILED], bad
    monkeypatch.setattr(tr, "cached_signals", lambda: (_ for _ in ()).throw(RuntimeError("cache")))
    assert _read(tr.KIND)["notes"] == [tr.NOTE_FAILED]


def test_the_rotation_cache_entry_and_the_threshold_are_the_services_own(monkeypatch):
    """Computed THROUGH the service (its theme read stubbed), then read back by the adapter: a renamed cache key, a
    changed threshold or a changed sign rule fails here by name."""
    rets = {"A": (9.0, 1.0), "B": (7.0, 3.0), "C": (5.0, 5.0), "D": (3.0, 7.0), "E": (2.0, 8.0), "F": (1.0, 9.0)}
    themes = [{"ticker": tk, "name": f"{tk} theme", "group_return": {"1w": w, "1m": m, "3m": 0.0}, "holdings": []}
              for tk, (w, m) in rets.items()]
    monkeypatch.setattr(theme_performance, "get_theme_performance", lambda: {"themes": themes})
    assert cache.get(theme_performance._ROTATION_CACHE_KEY) is None
    built = theme_performance.compute_rotation_signals()
    assert tr.cached_signals() is built
    # six themes rank 0, 20 … 100: C and D sit exactly one step (20 points) from where they were
    assert {e["ticker"]: e["momentum_delta"] for e in built["rotating_in"]} == {"A": 100.0, "B": 60.0, "C": 20.0}
    assert {e["ticker"]: e["momentum_delta"] for e in built["rotating_out"]} == {"F": -100.0, "E": -60.0, "D": -20.0}
    assert min(abs(e["momentum_delta"]) for e in built["rotating_in"] + built["rotating_out"]) == tr.THRESHOLD
    assert str(tr.THRESHOLD) in tr.NOTE_WHAT
    monkeypatch.setattr(theme_performance, "get_theme_performance", _boom)
    out = _read(tr.KIND)
    _conforms(out, tr.KIND)
    assert [e["ticker"] for e in out["data"]["rotating_in"]] == ["A", "B", "C"] and out["data"]["ranked"] == 6
    assert [e["ticker"] for e in out["data"]["rotating_out"]] == ["F", "E", "D"]


def test_rotation_bad_requests_are_refused_before_any_read(monkeypatch):
    ran = []
    monkeypatch.setattr(tr, "cached_signals", lambda: ran.append(1) or _signals())
    for bad in ({"side": "up"}, {"side": "IN"}, {"limit": 0}, {"limit": tr.MAX_LIMIT + 1}, {"limit": "5"}):
        assert _read(tr.KIND, bad)["status"] == "refused", bad
    assert ran == []


# ── confluence.board ─────────────────────────────────────────────────────────────────────────────────────────────────
def _crow(sym, direction, status="BUILDING", band="L", **over):
    body = {"sym": sym, "band": band, "dir": direction, "dpn": 180_000_000.0, "acc": "Acc", "net": 12_500_000.0,
            "net5": 6_000_000.0, "bull": 14_000_000.0, "bear": 1_500_000.0, "bullPct": 90.3,
            "top": {"cp": "C", "strike": 120.0, "exp": "1/15/2027", "dte": 63, "prem": 4_200_000.0, "raw": "dropped"},
            "leapPrem": 5_000_000.0, "leapShare": 0.412, "status": status, "freshRatio": 0.48, "bigPrint": 40_000_000.0,
            "bigDate": "11/10", "dpLo": 98.5, "dpHi": 104.25, "dpAvg": 101.4, "dpLast": 103.1, "bigPrice": 101.0,
            "sector": "Technology", "score": 2.4, "internal": "dropped"}
    return {**body, **over}


def _board(rows=None, **over):
    rows = [_crow("AAA", "BULL"), _crow("BBB", "BEAR", status="STEADY", band="M"), _crow("CCC", "BULL", status="ESTABLISHED", band="S")] if rows is None else rows
    body = {"ok": True, "window": "Oct 6 – Nov 12, 2026", "days": confluence_screen.DAYS, "rows": rows,
            "counts": {"total": len(rows), "bull": 2, "bear": 1, "building": 1}, "band_meta": dict(confluence_screen._BAND_META),
            "allowedDays": [20, 30, 60, 90], "warnings": None}
    return {**body, **over}


def _cached_board(monkeypatch, board, age_s=60.0):
    """Hold `board` as the service's cached default window, built `age_s` ago by the wall clock (the service's own
    get_board reads the wall clock); the adapter's clock is pinned to the same instant. Returns the build log."""
    kicked = []
    built = time.time() - age_s
    monkeypatch.setattr(confluence_screen, "_CACHES", {confluence_screen.DAYS: {"at": built, "board": board}})
    monkeypatch.setattr(cb, "now_s", lambda: built + age_s)
    monkeypatch.setattr(confluence_screen, "compute_board", _boom)
    monkeypatch.setattr(confluence_screen, "_compute_and_cache", _boom)
    monkeypatch.setattr(confluence_screen, "_build_background", lambda days: kicked.append(days))
    return kicked


def test_confluence_serves_the_cached_default_window_and_never_builds(monkeypatch):
    kicked = _cached_board(monkeypatch, _board())
    out = _read(cb.KIND, {"limit": 2})
    _conforms(out, cb.KIND)
    assert kicked == []                                               # a fresh board: nothing was started
    assert out["status"] == "ok" and out["freshness"] == "periodic" and out["as_of"] is None and out["stale"] is False
    d = out["data"]
    assert d["days"] == confluence_screen.DAYS and d["window"] == "Oct 6 – Nov 12, 2026" and d["direction"] == "all"
    assert [r["sym"] for r in d["rows"]] == ["AAA", "BBB"] and d["count"] == 3
    assert d["counts"] == {"total": 3, "bull": 2, "bear": 1, "building": 1, "isolated": True}
    assert set(d["rows"][0]) - {"isolated"} == set(cb.ROW_FIELDS) and "acc" not in d["rows"][0]
    assert set(d["rows"][0]["top"]) - {"isolated"} == set(cb.TOP_FIELDS)
    built = confluence_screen._CACHES[confluence_screen.DAYS]["at"]
    assert d["built_at"] == env.utc_iso(datetime.fromtimestamp(built, tz=timezone.utc)) and d["incomplete"] is False
    assert d["band_meta"]["L"] == list(confluence_screen._BAND_META["L"])
    minutes = int(confluence_screen._TTL // 60)
    assert cb.NOTE_WHAT.format(days=confluence_screen.DAYS) in out["notes"] and cb.NOTE_PRICES in out["notes"]
    assert cb.NOTE_TIME.format(at=d["built_at"], minutes=minutes) in out["notes"]
    assert cb.NOTE_CUT.format(n=2, total=3) in out["notes"]
    assert out["coverage"] == {"evaluated": 3, "answered": 2, "dropped": 1, "not_computable": 0}


def test_confluence_direction_filter_an_empty_board_and_no_name_on_a_side(monkeypatch):
    _cached_board(monkeypatch, _board())
    d = _read(cb.KIND, {"direction": "bear"})["data"]
    assert [r["sym"] for r in d["rows"]] == ["BBB"] and d["count"] == 1 and d["counts"]["total"] == 3
    _cached_board(monkeypatch, _board(rows=[_crow("AAA", "BULL")]))
    out = _read(cb.KIND, {"direction": "bear"})
    _conforms(out, cb.KIND)
    assert out["status"] == "ok" and out["data"]["rows"] == [] and cb.NOTE_NO_MATCH.format(total=1) in out["notes"]
    _cached_board(monkeypatch, _board(rows=[]))
    out = _read(cb.KIND)                                               # nothing passes the gate: a healthy answer
    _conforms(out, cb.KIND)
    assert out["status"] == "ok" and out["data"]["count"] == 0 and cb.NOTE_EMPTY in out["notes"]


def test_confluence_reads_only_the_window_the_scheduler_keeps_warm(monkeypatch):
    asked = []
    board = _board()
    monkeypatch.setattr(confluence_screen, "get_board", lambda days=30, force=False: asked.append((days, force)) or board)
    assert _read(cb.KIND)["status"] == "ok"
    assert asked == [(confluence_screen.DAYS, False)]                   # the default window, never force
    for bad in ({"days": 90}, {"days": confluence_screen.DAYS}, {"direction": "long"}, {"direction": "BULL"},
                {"limit": 0}, {"limit": cb.MAX_LIMIT + 1}, {"limit": True}):
        assert _read(cb.KIND, bad)["status"] == "refused", bad
    assert len(asked) == 1


def test_confluence_a_board_past_its_ttl_is_stale_and_an_unknown_build_time_is_never_fresh(monkeypatch):
    kicked = _cached_board(monkeypatch, _board(), age_s=confluence_screen._TTL + 5)
    out = _read(cb.KIND)
    _conforms(out, cb.KIND)
    assert out["status"] == "ok" and out["stale"] is True
    assert cb.NOTE_STALE.format(minutes=int(confluence_screen._TTL // 60)) in out["notes"]
    assert kicked == [confluence_screen.DAYS]                           # the SERVICE's own background rebuild, default window only
    monkeypatch.setattr(confluence_screen, "get_board", lambda days=30, force=False: _board())     # not the cached object
    out = _read(cb.KIND)
    _conforms(out, cb.KIND)
    assert out["stale"] is True and out["data"]["built_at"] is None and cb.NOTE_NO_TIME in out["notes"]


def test_confluence_warming_or_failing_is_unavailable_never_an_empty_board(monkeypatch):
    kicked = []
    monkeypatch.setattr(confluence_screen, "compute_board", _boom)
    monkeypatch.setattr(confluence_screen, "_compute_and_cache", _boom)
    monkeypatch.setattr(confluence_screen, "_build_background", lambda days: kicked.append(days))
    out = _read(cb.KIND)                                               # the service's real get_board, nothing cached
    _conforms(out, cb.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [cb.NOTE_WARMING] and out["data"] is None
    assert kicked == [confluence_screen.DAYS]
    for payload in ({"ok": False, "status": "flow_unavailable", "rows": []}, dict(confluence_screen._WARMING)):
        monkeypatch.setattr(confluence_screen, "get_board", lambda days=30, force=False, p=payload: p)
        assert _read(cb.KIND)["notes"] == [cb.NOTE_WARMING]
    for payload in (None, {"ok": True, "rows": None}, {"rows": []}):
        monkeypatch.setattr(confluence_screen, "get_board", lambda days=30, force=False, p=payload: p)
        assert _read(cb.KIND)["notes"] == [cb.NOTE_FAILED], payload

    def boom(days=30, force=False):
        raise RuntimeError("flow worker unreachable at http://flow.internal")
    monkeypatch.setattr(confluence_screen, "get_board", boom)
    out = _read(cb.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [cb.NOTE_FAILED]


def test_confluence_a_board_built_with_a_leg_missing_is_partial_and_its_warnings_stay_inside(monkeypatch):
    _cached_board(monkeypatch, _board(warnings=["flow-leg large/30d: timeout calling http://flow.internal:8080"]))
    out = _read(cb.KIND)
    _conforms(out, cb.KIND)
    assert out["status"] == "partial" and out["data"]["incomplete"] is True and cb.NOTE_PARTIAL in out["notes"]
    text = json.dumps(out)
    assert "flow.internal" not in text and "flow-leg" not in text and "warnings" not in text


# ── earnings.expectedMove ────────────────────────────────────────────────────────────────────────────────────────────
def _move(**over):
    body = {"pct": 8.4, "dollar": 10.5, "strike": 125.0, "spot": 125.3, "call_mid": 5.6, "put_mid": 4.9, "iv_atm": 0.71,
            "expiry": "2026-11-20", "horizon": "through 2026-11-20", "asof": "2026-11-13T15:10:00+00:00",
            "source": "massive-chain"}
    return {**body, **over}


def _capture(report_date, pct=7.9, **over):
    body = {"sym": "AAA", "report_date": report_date, "captured_at": f"{report_date}T02:00:00+00:00", "pct": pct,
            "dollar": 9.1, "expiry": report_date, "fiscal_year": 2026, "fiscal_quarter": 3}
    return {**body, **over}


def _store(monkeypatch, rows, since="2025-08-07"):
    asked = []
    monkeypatch.setattr(implied_store, "get_implied_history", lambda sym, limit=8: asked.append((sym, limit)) or rows)
    monkeypatch.setattr(implied_store, "get_earliest_report_date", lambda sym: since)
    return asked


def _no_chain(monkeypatch):
    for fn in ("compute_expected_move", "compute_expected_move_result", "get_expected_move"):
        monkeypatch.setattr(implied_move, fn, _boom)


def _hold_move(monkeypatch, sym, report_date, move):
    """Fill the service's caches THROUGH its own `get_expected_move` (its chain read stubbed)."""
    monkeypatch.setattr(implied_move, "compute_expected_move", lambda s, d, *, outcome=None, timing=None: dict(move))
    assert implied_move.get_expected_move(sym, report_date) == move


def test_the_chain_behind_the_straddle_is_ucts_own_massive_chain_not_schwab():
    """The licensing check, in code: the live straddle is stamped `massive-chain` and its chain module calls Massive only."""
    im = (REPO / "api/services/implied_move.py").read_text(encoding="utf-8")
    assert im.count('"source": "massive-chain"') == 1 and "from api.services import polygon_options" in im
    assert "schwab" not in im.lower()
    chain = (REPO / "api/services/polygon_options.py").read_text(encoding="utf-8")
    assert '_BASE = "https://api.massive.com"' in chain and "schwab" not in chain.lower()
    assert em.LICENSED_SOURCES == ("massive-chain",)


def test_expected_move_reads_the_straddle_the_service_already_holds_and_the_stored_captures(monkeypatch):
    asked = _store(monkeypatch, [_capture("2026-11-19"), _capture("2026-08-06", 6.2), {"sym": "AAA", "report_date": "bad", "pct": 5.0},
                                 _capture("2026-05-07", 0)])
    _hold_move(monkeypatch, "AAA", "2026-11-19", _move())
    _no_chain(monkeypatch)                                              # from here on a chain read fails the test
    out = _read(em.KIND, {"symbol": " aaa "})
    _conforms(out, em.KIND)
    assert asked == [("AAA", em.HISTORY_LIMIT)]
    assert out["status"] == "ok" and out["freshness"] == "periodic" and out["as_of"] is None and out["stale"] is False
    d = out["data"]
    assert d["symbol"] == "AAA" and d["report_date"] == "2026-11-19"   # the coming report the store holds a capture for
    assert d["live_state"] == "fresh" and d["live_outcome"] == {"kind": "ok", "reason": None, "isolated": True}
    assert set(d["live"]) - {"isolated"} == set(em.LIVE_FIELDS) and d["live"]["pct"] == 8.4 and d["live"]["source"] == "massive-chain"
    assert d["read_at"] == "2026-11-13T15:10:00Z"
    assert [h["report_date"] for h in d["history"]] == ["2026-11-19", "2026-08-06"]   # an undated or zero row is dropped
    assert set(d["history"][0]) - {"isolated"} == set(em.HISTORY_FIELDS) and d["history_since"] == "2025-08-07"
    assert "grade" not in d                                             # the Setup Grade is not this kind's
    assert em.NOTE_WHAT in out["notes"] and em.NOTE_CAPTURES in out["notes"]
    assert em.NOTE_READ.format(at="2026-11-13T15:10:00Z") in out["notes"]


def test_the_expected_move_cache_key_is_the_member_routes_own(monkeypatch):
    """Filled through the service, read back with the adapter's key: a renamed cache, slot or key fails by name."""
    _hold_move(monkeypatch, "AAA", "2026-11-19", _move())
    _hold_move(monkeypatch, "AAA", None, _move(expiry="2026-11-14"))
    assert implied_move._MOVE_CACHE.get(em.cache_key("AAA", "2026-11-19"))["expiry"] == "2026-11-20"
    assert implied_move._MOVE_CACHE.get(em.cache_key("AAA", None))["expiry"] == "2026-11-14"
    assert implied_move._MOVE_STALE.peek(em.cache_key("AAA", "2026-11-19"))[0]["pct"] == 8.4
    assert em.cached_move("AAA", "2026-11-19")[1] == "fresh" and em.cached_move("AAA", "2026-11-20") == (None, "not_cached")


def test_expected_move_a_given_report_date_wins_and_no_date_says_the_expiry_may_not_span_the_report(monkeypatch):
    _store(monkeypatch, [_capture("2026-08-06", 6.2)])                  # no capture for a coming report
    _hold_move(monkeypatch, "AAA", "2026-11-24", _move(expiry="2026-11-27"))
    _hold_move(monkeypatch, "AAA", None, _move(expiry="2026-11-14"))
    _no_chain(monkeypatch)
    d = _read(em.KIND, {"symbol": "AAA", "report_date": "2026-11-24"})["data"]
    assert d["report_date"] == "2026-11-24" and d["live"]["expiry"] == "2026-11-27"
    out = _read(em.KIND)
    _conforms(out, em.KIND)
    assert out["data"]["report_date"] is None and out["data"]["live"]["expiry"] == "2026-11-14"
    assert em.NOTE_NO_REPORT_DATE.format(sym="AAA") in out["notes"]


def test_expected_move_the_last_good_straddle_is_served_stale(monkeypatch):
    _store(monkeypatch, [_capture("2026-11-19")])
    _hold_move(monkeypatch, "AAA", "2026-11-19", _move())
    implied_move._MOVE_CACHE.invalidate(em.cache_key("AAA", "2026-11-19"))     # the 15-minute entry lapsed
    _no_chain(monkeypatch)
    out = _read(em.KIND)
    _conforms(out, em.KIND)
    assert out["status"] == "ok" and out["stale"] is True and out["data"]["live_state"] == "last_good"
    assert em.NOTE_LAST_GOOD in out["notes"] and out["data"]["live"]["pct"] == 8.4
    implied_move._MOVE_STALE.remember(em.cache_key("AAA", "2026-11-19"), _move(), at=time.time() - implied_move._MOVE_STALE.max_age - 60)
    assert em.cached_move("AAA", "2026-11-19") == (None, "not_cached")  # past the slot's own bound: not served


def test_expected_move_never_reads_a_chain_nothing_cached_gives_only_the_captures(monkeypatch):
    _store(monkeypatch, [_capture("2026-11-19"), _capture("2026-08-06", 6.2)])
    _no_chain(monkeypatch)
    out = _read(em.KIND)
    _conforms(out, em.KIND)
    assert out["status"] == "partial" and out["as_of"] is None and out["stale"] is False
    d = out["data"]
    assert d["live"] is None and d["live_state"] == "not_cached" and d["live_outcome"] is None and d["read_at"] is None
    assert len(d["history"]) == 2 and d["store_read"] is True
    assert em.NOTE_NOT_CACHED.format(sym="AAA") in out["notes"] and em.NOTE_CAPTURE_TIME in out["notes"]


def test_expected_move_nothing_held_and_a_failing_store_are_unavailable_never_no_move(monkeypatch):
    _store(monkeypatch, [])
    _no_chain(monkeypatch)
    out = _read(em.KIND)
    _conforms(out, em.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [em.NOTE_UNAVAILABLE.format(sym="AAA")] and out["data"] is None

    def boom(sym, limit=8):
        raise RuntimeError("database is locked")
    monkeypatch.setattr(implied_store, "get_implied_history", boom)
    out = _read(em.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [em.NOTE_FAILED.format(sym="AAA")]
    implied_move._MOVE_CACHE.set(em.cache_key("AAA", None), _move(), 600)
    out = _read(em.KIND)                                                # a straddle, but the store could not be read
    _conforms(out, em.KIND)
    assert out["status"] == "partial" and out["data"]["store_read"] is False and out["data"]["history"] == []
    assert em.NOTE_STORE_FAILED.format(sym="AAA") in out["notes"]


def test_expected_move_a_straddle_from_another_chain_is_never_shown(monkeypatch):
    _store(monkeypatch, [_capture("2026-11-19")])
    _no_chain(monkeypatch)
    implied_move._MOVE_CACHE.set(em.cache_key("AAA", "2026-11-19"), _move(source="schwab-chain", pct=44.4), 600)
    out = _read(em.KIND)
    _conforms(out, em.KIND)
    assert out["status"] == "partial" and out["data"]["live"] is None and em.NOTE_UNLICENSED in out["notes"]
    assert "44.4" not in json.dumps(out) and "schwab" not in json.dumps(out).lower()


def test_expected_move_bad_requests_are_refused_before_any_read(monkeypatch):
    asked = _store(monkeypatch, [_capture("2026-11-19")])
    for bad in ({}, {"symbol": ""}, {"symbol": "AAA BBB"}, {"symbol": 7}, {"symbol": "ABCDEFGHIJK"}, {"symbols": ["AAA", "BBB"]},
                {"symbol": "AAA", "report_date": "11/19/2026"}, {"symbol": "AAA", "report_date": "2026-13-40"},
                {"symbol": "AAA", "report_date": 20261119}):
        assert _read(em.KIND, bad)["status"] == "refused", bad
    assert asked == []


# ── earnings.callSearch ──────────────────────────────────────────────────────────────────────────────────────────────
SNIPPET = "we expect <mark>pricing</mark> <mark>power</mark> to hold through the first half …  and margins"


def _stats(**over):
    body = {"transcripts": 1840, "symbols": 1630, "oldest": "2026-08-15", "newest": "2026-11-12 17:00:00", "words": 15_000_000,
            "db_mb": 210.4, "db": "/data/transcripts.db"}
    return {**body, **over}


def _hit(sym, score=9.5, **over):
    body = {"symbol": sym, "year": 2026, "quarter": 3, "date": "2026-11-05 17:00:00", "snippet": SNIPPET, "score": score,
            "content": "the whole call text is never returned"}
    return {**body, **over}


def _found(n=3, **over):
    body = {"query": "pricing power", "match": '"pricing" "power"', "total": n, "hits": [_hit(f"S{i}", 9.5 - i) for i in range(n)]}
    return {**body, **over}


def _index(monkeypatch, found=None, stats=None):
    asked = []
    monkeypatch.setattr(transcript_index, "stats", lambda: _stats() if stats is None else stats)
    monkeypatch.setattr(transcript_index, "search",
                        lambda q, limit=40, symbol=None, since=None: asked.append({"q": q, "limit": limit, "symbol": symbol, "since": since})
                        or (_found() if found is None else found))
    return asked


def test_call_search_hits_with_the_indexs_own_excerpt_dated_by_the_newest_indexed_call(monkeypatch):
    asked = _index(monkeypatch, found=_found(3, total=57))
    out = _read(cs.KIND, {"q": "  pricing   power ", "limit": 3, "symbol": "aaa", "since": "2026-10-01"})
    _conforms(out, cs.KIND)
    assert asked == [{"q": "pricing power", "limit": 3, "symbol": "AAA", "since": "2026-10-01"}]
    assert out["status"] == "ok" and out["freshness"] == "periodic" and out["stale"] is False
    assert out["as_of"] == "2026-11-12T05:00:00Z"                       # the newest indexed call's date, start of that Eastern day
    d = out["data"]
    assert d["query"] == "pricing power" and d["total"] == 57 and [h["symbol"] for h in d["hits"]] == ["S0", "S1", "S2"]
    assert set(d["hits"][0]) - {"isolated"} == set(cs.HIT_FIELDS)      # never the call's text
    assert all(h["snippet"] == SNIPPET for h in d["hits"])              # exactly as the service cut it
    assert d["index"] == {"calls": 1840, "oldest": "2026-08-15", "newest": "2026-11-12", "isolated": True}
    assert "transcripts.db" not in json.dumps(out) and "whole call text" not in json.dumps(out)
    assert cs.NOTE_WHAT in out["notes"] and cs.NOTE_UNCHECKED in out["notes"]
    assert cs.NOTE_INDEX.format(calls=1840, oldest="2026-08-15", newest="2026-11-12") in out["notes"]
    assert cs.NOTE_CUT.format(n=3, total=57) in out["notes"]
    assert out["coverage"] == {"evaluated": 57, "answered": 3, "dropped": 54, "not_computable": 0}


def test_call_search_never_asks_for_or_returns_more_than_its_limit(monkeypatch):
    asked = _index(monkeypatch, found=_found(60, total=60))            # a service that over-answers
    out = _read(cs.KIND, {"q": "tariffs", "limit": cs.MAX_LIMIT})
    assert asked[0]["limit"] == cs.MAX_LIMIT and len(out["data"]["hits"]) == cs.MAX_LIMIT
    assert len(_read(cs.KIND, {"q": "tariffs"})["data"]["hits"]) == cs.DEFAULT_LIMIT and asked[1]["limit"] == cs.DEFAULT_LIMIT
    assert _read(cs.KIND, {"q": "tariffs", "limit": cs.MAX_LIMIT + 1})["status"] == "refused" and len(asked) == 2


def test_call_search_no_hit_is_a_finding_only_when_the_index_holds_calls(monkeypatch):
    asked = _index(monkeypatch, found=_found(0))
    out = _read(cs.KIND)
    _conforms(out, cs.KIND)
    assert out["status"] == "ok" and out["data"]["hits"] == [] and out["data"]["total"] == 0 and cs.NOTE_NONE in out["notes"]
    asked = _index(monkeypatch, found=_found(0), stats=_stats(transcripts=0, oldest=None, newest=None))
    out = _read(cs.KIND)
    _conforms(out, cs.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [cs.NOTE_EMPTY_INDEX] and asked == []      # nothing was searched
    _index(monkeypatch, stats=_stats(oldest="", newest=""))
    out = _read(cs.KIND)                                                # calls, none dated: no as_of, said
    _conforms(out, cs.KIND)
    assert out["as_of"] is None and cs.NOTE_INDEX_UNDATED.format(calls=1840) in out["notes"]


def test_call_search_exact_words_checked_only_on_the_hits_kept_and_a_widened_search_say_so(monkeypatch):
    _index(monkeypatch, found=_found(2, total=31, operators=True, expanded={"tariff": ["tariffs", "duties"], "x": []},
                                     notes=["Exact words and quoted phrases were checked against the call text"]))
    out = _read(cs.KIND, {"q": '"pricing power" tariff'})
    _conforms(out, cs.KIND)
    assert cs.NOTE_TOTAL_WIDER.format(total=31) in out["notes"] and cs.NOTE_EXPANDED in out["notes"]
    assert not any(n.startswith("showing the") for n in out["notes"])
    assert out["data"]["expanded"] == {"tariff": ["tariffs", "duties"], "isolated": True}


@pytest.mark.parametrize("found,note", [
    ({"query": "a AND", "match": None, "hits": [], "total": 0, "error": "A query cannot end with AND.", "query_error": True}, cs.NOTE_BAD_QUERY),
    ({"query": "x", "match": "x", "hits": [], "total": 0, "error": "unsupported search syntax"}, cs.NOTE_BAD_QUERY),
    ({"query": "the", "match": None, "hits": [], "total": 0}, cs.NOTE_NO_WORDS),
    ({"query": "x", "hits": [], "total": 0, "error": "search unavailable"}, cs.NOTE_FAILED),
    ({"query": "x", "match": "x", "total": 3}, cs.NOTE_FAILED),
    (None, cs.NOTE_FAILED),
])
def test_call_search_a_query_the_service_cannot_run_or_a_failed_read_is_unavailable(monkeypatch, found, note):
    monkeypatch.setattr(transcript_index, "stats", lambda: _stats())
    monkeypatch.setattr(transcript_index, "search", lambda q, limit=40, symbol=None, since=None: found)
    out = _read(cs.KIND)
    _conforms(out, cs.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [note] and out["data"] is None
    assert "cannot end with AND" not in json.dumps(out)                 # the service's own sentence is not passed on


def test_call_search_failing_index_and_bad_requests(monkeypatch):
    ran = []

    def boom():
        ran.append(1)
        raise RuntimeError("no such table: transcripts")
    monkeypatch.setattr(transcript_index, "stats", boom)
    monkeypatch.setattr(transcript_index, "search", _boom)
    out = _read(cs.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [cs.NOTE_FAILED]
    monkeypatch.setattr(transcript_index, "stats", lambda: ran.append(1) or {"transcripts": "many"})
    assert _read(cs.KIND)["notes"] == [cs.NOTE_FAILED]
    for bad in ({}, {"q": ""}, {"q": "a"}, {"q": "  a  "}, {"q": "?!"}, {"q": "x" * (cs.MAX_QUERY + 1)}, {"q": 42},
                {"q": "ai", "limit": 0}, {"q": "ai", "limit": 2.0}, {"q": "ai", "symbol": "AAA BBB"}, {"q": "ai", "symbol": 5},
                {"q": "ai", "since": "last month"}, {"q": "ai", "since": "2026-02-30"}):
        assert _read(cs.KIND, bad)["status"] == "refused", bad
    assert len(ran) == 2                                                # refused before any read


# ── facts shared with the terminal panels' models (on master since #1653; skipped where a branch predates them) ────────
def _panel_const(name, const):
    path = PANELS / name
    if not path.exists():
        pytest.skip(f"{name} is not on this branch yet (it is on master since #1653)")
    m = re.search(rf"^export const {const} = (\d+)$", path.read_text(encoding="utf-8"), flags=re.M)
    assert m, f"{const} not found in {name}"
    return int(m.group(1))


def test_the_rotation_threshold_is_the_trot_panels_own():
    assert _panel_const("themeRotationModel.js", "ROTATION_THRESHOLD") == tr.THRESHOLD


def test_the_confluence_window_is_the_confl_panels_own():
    assert _panel_const("confluenceModel.js", "CONFLUENCE_DAYS") == confluence_screen.DAYS


def test_the_call_search_limits_are_the_tsrc_panels_own():
    assert _panel_const("callSearchModel.js", "SEARCH_LIMIT") == cs.MAX_LIMIT
    assert _panel_const("callSearchModel.js", "MIN_QUERY") == cs.MIN_QUERY
    assert _panel_const("callSearchModel.js", "MAX_QUERY") == cs.MAX_QUERY


# ── the contract (MD-1 v1.8 §4.11) ───────────────────────────────────────────────────────────────────────────────────
def test_the_contract_doc_states_section_4_11_and_every_note_the_adapters_emit():
    """MD-1 §4.11 quotes each note verbatim; QA pins fixtures to the doc, so the two must not drift."""
    doc = (REPO / "docs/agent/program/contracts/MD-1-market-data.md").read_text(encoding="utf-8")
    head = ("### 4.11 Terminal data wave 2: `highsLows.yearly`, `themes.rotation`, `confluence.board`, "
            "`earnings.expectedMove`, `earnings.callSearch` (v1.8, terminal-data)")
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
              "**No read of this section starts a build.**", "massive-chain"):
        assert s in section, s
    # wave 1's section still ends where this one begins, and the 52-week row of §4 points here
    assert doc.index("### 4.10 Terminal data wave 1") < doc.index(head) < doc.index("## 8. Changing this contract")
    row = next(line for line in doc.splitlines() if line.startswith("| `nhnl` |"))
    assert "`highsLows.yearly` (§4.11)" in row and "the counts stay `breadth.current` measures" in row
    assert "- **v1.8 addition (2026-11-17, terminal-data, data wave 2):**" in doc
    assert "- **`flow.summary`:** only through the existing flow proxy" in doc       # still deferred: no tape kind was added
