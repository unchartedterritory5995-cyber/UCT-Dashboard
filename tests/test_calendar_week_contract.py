"""TERM-030 / FB-A5-02 — the week contract fails loudly at its readers.

Two halves, and both are needed:

1. BEHAVIOUR. One malformed week (the contract changed: every entry's `sym`
   is now `symbol`) is fed to every reader. Before TERM-030 each one ran its
   bare `.get()` chain, skipped every entry, and reported an EMPTY week — the
   same answer as a quiet week. Now each fails BY NAME: the violation is
   counted under that reader's id and its message names the key.
   A well-formed control week is fed to the same drivers and must come back
   with its reporter, so a driver that never reaches its reader cannot pass.

2. CENSUS. The reader population is DERIVED from the source, not typed: every
   function under `api/` outside the owning router that consumes a week door
   (`get_calendar`, `_get_or_build_range_week`, `_build_current_week`, or the
   raw `calendar_weekly` cache entry) and USES the result. Each must call the
   shared `week_days(...)`, and the behaviour table above must cover every
   `week_days` call site — so a sixth reader fails here by name. The one
   exception is FROZEN below, and it expires on its own.
"""
from __future__ import annotations

import ast
import datetime as dt
import logging
from pathlib import Path
from unittest import mock

import pytest

from api.services import calendar_week_contract as wc
from api.services.calendar_week_contract import WeekContractViolation, week_days

ROOT = Path(__file__).resolve().parents[1]
DAY = "2026-09-28"          # a Monday
MONDAY = dt.date(2026, 9, 28)


def _week(entry_key: str) -> dict:
    return {
        "week_start": DAY, "week_end": "2026-10-02", "source": "live",
        "days": {DAY: {
            "bmo": [{entry_key: "AAPL", "eps_est": 1.5, "mc_b": 3000.0}],
            "amc": [], "tbd": [], "econ": [], "fed": [],
        }},
    }


GOOD_WEEK = _week("sym")
BAD_WEEK = _week("symbol")      # the contract changed under the reader


@pytest.fixture(autouse=True)
def _fresh_counts():
    wc._reset_violation_counts()
    yield
    wc._reset_violation_counts()


# ── The assertion itself ─────────────────────────────────────────────────────

def test_absent_is_not_malformed():
    assert week_days(None, reader="r") is None
    assert wc.violation_counts() == {}


def test_a_well_formed_week_passes_through_untouched():
    assert week_days(GOOD_WEEK, reader="r") is GOOD_WEEK["days"]
    assert week_days({"days": {}}, reader="r") == {}          # error/out_of_range shape
    # `tbd` arrived later than bmo/amc; a day without it is still the contract.
    assert week_days({"days": {DAY: {"bmo": [], "amc": []}}}, reader="r") == {
        DAY: {"bmo": [], "amc": []}}
    assert wc.violation_counts() == {}


@pytest.mark.parametrize("payload, path", [
    ([], "payload"),
    ({"week_start": DAY}, "days"),
    ({"days": []}, "days"),
    ({"days": {DAY: None}}, f"days[{DAY}]"),
    ({"days": {DAY: {"amc": []}}}, f"days[{DAY}].bmo"),
    ({"days": {DAY: {"bmo": None, "amc": []}}}, f"days[{DAY}].bmo"),
    ({"days": {DAY: {"bmo": [], "amc": [], "tbd": [{"sym": 7}]}}}, f"days[{DAY}].tbd[0].sym"),
    (BAD_WEEK, f"days[{DAY}].bmo[0].sym"),
])
def test_a_malformed_week_fails_naming_the_reader_and_the_key(payload, path):
    with pytest.raises(WeekContractViolation) as ei:
        week_days(payload, reader="some.reader")
    assert ei.value.reader == "some.reader"
    assert ei.value.path == path
    assert f"some.reader: {path} " in str(ei.value)
    assert wc.violation_counts() == {"some.reader": 1}


def test_a_violation_is_logged_at_error_and_routed_to_the_ops_sink(caplog, monkeypatch):
    emitted = []
    from api.services import chart_health_alerts
    monkeypatch.setattr(chart_health_alerts, "emit",
                        lambda key, sev, msg, meta=None: emitted.append((key, sev, msg)))
    with caplog.at_level(logging.ERROR, logger=wc.__name__):
        with pytest.raises(WeekContractViolation):
            week_days(BAD_WEEK, reader="x.y")
    assert any("x.y" in r.getMessage() and r.levelno == logging.ERROR for r in caplog.records)
    # WARNING, not critical: the admin feed, never a page.
    assert [(k, s) for k, s, _ in emitted] == [("calendar_week_contract:x.y", "warning")]


# ── Behaviour: every reader, one fixture ─────────────────────────────────────
#
# Each driver injects `payload` at the reader's own door and returns what the
# reader returned. Keys are the reader ids exactly as the census derives them.

def _drive_calendar_alerts(payload, monkeypatch):
    from api.services import calendar_alerts as mod
    from api.services.cache import cache
    real_get = cache.get
    monkeypatch.setattr(cache, "get",
                        lambda k, *a, **kw: payload if k == "calendar_weekly" else real_get(k, *a, **kw))
    monkeypatch.setattr("api.services.finnhub_client.fh_get",
                        lambda *a, **k: {"earningsCalendar": []})
    monkeypatch.setattr(mod, "_fmp_reporters_for_date_with_status", lambda d: (set(), True))
    return mod._get_reporters_for_date_with_status(DAY)


def _drive_week_poster(payload, monkeypatch):
    from api.services import calendar_week_poster as mod
    monkeypatch.setattr("api.routers.calendar.get_calendar", lambda *a, **k: payload)
    monkeypatch.setattr("api.routers.calendar._week_dates", lambda: [MONDAY])
    monkeypatch.setattr("api.routers.calendar.get_day_metrics", lambda *a, **k: {})
    monkeypatch.setattr("api.services.ticker_logos.get_logo_path", lambda sym: None)
    monkeypatch.setattr("api.services.bars_fetch._is_nyse_holiday", lambda d: False)
    monkeypatch.setattr("api.services.econ_calendar_fmp.fetch_us_econ_week", lambda *a, **k: {})
    return mod.build_payloads(MONDAY)


def _drive_ics(payload, monkeypatch):
    import api.routers.calendar as mod
    with mock.patch("api.routers.calendar.cache") as fake_cache, \
         mock.patch("api.routers.calendar.get_month_calendar", return_value={"days": {}}):
        fake_cache.get.return_value = payload
        return mod._collect_reporters_for_ics("all", None)


def _drive_wire_detector(payload, monkeypatch):
    from api.services.wire import detector
    monkeypatch.setattr("api.routers.calendar.get_calendar", lambda *a, **k: payload)
    return detector.todays_reporters(DAY)


def _drive_preview_warm(payload, monkeypatch):
    from api.services import earnings_preview_warm as warm
    monkeypatch.setattr("api.routers.calendar.get_calendar", lambda *a, **k: payload)
    monkeypatch.setattr("api.routers.calendar.get_day_metrics", lambda *a, **k: {})
    monkeypatch.setattr("api.routers.calendar._week_dates", lambda: [MONDAY])
    return warm._rank(1, reported=False, tracked=set())


def _drive_ai_adapter(payload, monkeypatch):
    import api.routers.calendar as cal
    from api.services.research import earnings_ai_adapter as ea
    monkeypatch.setattr(cal, "_monday_of", lambda d: d)
    monkeypatch.setattr(cal, "_week_dates", lambda: [None])     # never the current week
    monkeypatch.setattr(cal, "_get_or_build_range_week", lambda monday: payload)
    return ea._cross_check_live_window("AAPL", DAY)


DRIVERS = {
    "api.services.calendar_week_poster.build_payloads": _drive_week_poster,
    "api.routers.calendar._collect_reporters_for_ics": _drive_ics,
    "api.services.wire.detector.todays_reporters": _drive_wire_detector,
    "api.services.earnings_preview_warm._rank": _drive_preview_warm,
    "api.services.research.earnings_ai_adapter._cross_check_live_window": _drive_ai_adapter,
}


# What a reader's output carries when it really read GOOD_WEEK's one reporter.
# The adapter answers WHERE it found the name, not the name itself.
WITNESS = {"api.services.research.earnings_ai_adapter._cross_check_live_window": "same_date"}


@pytest.mark.parametrize("reader", sorted(DRIVERS))
def test_control_a_well_formed_week_reaches_the_reader(reader, monkeypatch):
    out = DRIVERS[reader](GOOD_WEEK, monkeypatch)
    witness = WITNESS.get(reader, "AAPL")
    assert witness in repr(out), f"{reader}: the driver never reached the reader ({out!r})"
    assert wc.violation_counts() == {}


@pytest.mark.parametrize("reader", sorted(DRIVERS))
def test_a_malformed_week_fails_the_reader_by_name(reader, monkeypatch, caplog):
    with caplog.at_level(logging.ERROR, logger=wc.__name__):
        try:
            out = DRIVERS[reader](BAD_WEEK, monkeypatch)
        except WeekContractViolation as exc:
            assert exc.reader == reader
            out = None
    assert wc.violation_counts() == {reader: 1}, (
        f"{reader} read a malformed week without failing — it returned {out!r}, "
        f"which is indistinguishable from a quiet week")
    assert any(reader in r.getMessage() and ".sym" in r.getMessage() for r in caplog.records)


# ── Frozen: a reader another programme forbids us to edit ────────────────────
#
# calendar_alerts is spec-named (TD-37) but S7's event-proximity shadow
# comparison pins its source byte-identical to origin/master, so the two
# readers being compared cannot drift mid-measurement. Its exemption is NOT a
# typed pass: it holds only while that freeze rail still exists (so the day S7
# lifts it, this goes red and says "wire it"), and its behaviour test is a
# STRICT xfail (so wiring it without moving it into DRIVERS goes red too).
FROZEN = {
    "api.services.calendar_alerts._get_reporters_for_date_with_status": (
        "api/services/calendar_alerts.py",
        ("tests/test_alert_taxonomy_event_proximity_compare.py",
         "tests/test_alert_taxonomy_event_proximity_projection.py"),
    ),
}


def test_a_frozen_reader_is_exempt_only_while_its_freeze_rail_exists():
    for reader, (path, rails) in FROZEN.items():
        for rail in rails:
            src = (ROOT / rail).read_text(encoding="utf-8")
            assert "def test_the_legacy_module_is_byte_identical" in src and path in src, (
                f"{rail} no longer freezes {path} -- wire {reader} through week_days() "
                f"and move it from FROZEN into DRIVERS")


@pytest.mark.xfail(strict=True, reason="calendar_alerts is frozen by S7 (see FROZEN)")
def test_a_malformed_week_fails_calendar_alerts_by_name(monkeypatch):
    reader = "api.services.calendar_alerts._get_reporters_for_date_with_status"
    reporters, ok = _drive_calendar_alerts(BAD_WEEK, monkeypatch)
    assert wc.violation_counts() == {reader: 1}
    assert (reporters, ok) == (set(), False)    # never a clean, quiet day


def test_calendar_alerts_control_reaches_the_reader(monkeypatch):
    reporters, ok = _drive_calendar_alerts(GOOD_WEEK, monkeypatch)
    assert (reporters, ok) == ({"AAPL"}, True)


# ── Census: the population is derived, not typed ─────────────────────────────

OWNER = "api.routers.calendar"
DOORS = {"get_calendar", "_get_calendar_payload", "_get_or_build_range_week", "_build_current_week"}
# The contract's own builders. They PRODUCE the payload; they are not readers of it.
PRODUCERS = {"get_calendar", "_get_calendar_payload", "_get_or_build_range_week",
             "_build_current_week", "_build_range_week"}
CACHE_KEY = "calendar_weekly"


def _parented(tree):
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            child._parent = node
    return tree


def _enclosing_def(node):
    cur = getattr(node, "_parent", None)
    while cur is not None and not isinstance(cur, (ast.FunctionDef, ast.AsyncFunctionDef)):
        cur = getattr(cur, "_parent", None)
    return cur


def _door_names(tree, modname):
    """(bare names bound to a week door, names bound to the router module)."""
    bare, mods = set(), set()
    if modname == OWNER:
        bare |= DOORS
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == OWNER:
            bare |= {a.asname or a.name for a in node.names if a.name in DOORS}
        elif isinstance(node, ast.ImportFrom) and node.module == "api.routers":
            mods |= {a.asname or a.name for a in node.names if a.name == "calendar"}
        elif isinstance(node, ast.Import):
            mods |= {a.asname for a in node.names if a.name == OWNER and a.asname}
    return bare, mods


def _is_door(call, bare, mods):
    f = call.func
    if isinstance(f, ast.Name):
        return f.id in bare
    if isinstance(f, ast.Attribute):
        if f.attr in DOORS:
            return ((isinstance(f.value, ast.Name) and f.value.id in mods)
                    or ast.unparse(f.value) == OWNER)
        if f.attr == "get" and call.args:
            a0 = call.args[0]
            return isinstance(a0, ast.Constant) and a0.value == CACHE_KEY
    return False


def _is_week_days(call):
    f = call.func
    return ((isinstance(f, ast.Name) and f.id == "week_days")
            or (isinstance(f, ast.Attribute) and f.attr == "week_days"))


def census(source: str, modname: str):
    """({reader_id: asserted?}, [(reader_id_expected, reader_literal)] for each week_days call)."""
    tree = _parented(ast.parse(source))
    bare, mods = _door_names(tree, modname)
    readers: dict[str, bool] = {}
    labels: list[tuple[str, object]] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        fn = _enclosing_def(node)
        rid = f"{modname}.{fn.name}" if fn else f"{modname}.<module>"
        if _is_week_days(node):
            lit = next((kw.value.value for kw in node.keywords
                        if kw.arg == "reader" and isinstance(kw.value, ast.Constant)), None)
            labels.append((rid, lit))
            continue
        if not _is_door(node, bare, mods):
            continue
        if isinstance(getattr(node, "_parent", None), ast.Expr):
            continue                      # result discarded: a warm or a trigger, not a read
        if modname == OWNER and fn is not None and fn.name in PRODUCERS:
            continue
        asserted = fn is not None and any(
            isinstance(n, ast.Call) and _is_week_days(n) for n in ast.walk(fn))
        readers[rid] = readers.get(rid, True) and asserted
    return readers, labels


def _api_modules():
    for path in sorted((ROOT / "api").rglob("*.py")):
        if path.name.startswith("test_") or "tests" in path.parts:
            continue
        rel = path.relative_to(ROOT).with_suffix("")
        yield ".".join(rel.parts), path.read_text(encoding="utf-8")


def _full_census():
    readers, labels = {}, []
    for modname, src in _api_modules():
        r, l = census(src, modname)
        readers.update(r)
        labels.extend(l)
    return readers, labels


def test_census_control_the_derivation_can_see_and_can_refuse():
    src = '''
from api.routers.calendar import get_calendar
from api.routers import calendar as cal
from api.services.calendar_week_contract import week_days

def unasserted():
    return get_calendar().get("days")

def asserted():
    return week_days(cal._get_or_build_range_week(1), reader="m.asserted")

def raw_cache(cache):
    return cache.get("calendar_weekly")

def warm_only():
    get_calendar()

def other_calendar(calendar_service):
    return calendar_service.get_calendar("u1")
'''
    readers, labels = census(src, "m")
    assert readers == {"m.unasserted": False, "m.asserted": True, "m.raw_cache": False}
    assert labels == [("m.asserted", "m.asserted")]


def test_every_reader_outside_the_owner_calls_the_shared_assertion(capsys):
    readers, _ = _full_census()
    outside = {r: ok for r, ok in readers.items() if not r.startswith(OWNER + ".")}
    owner = {r: ok for r, ok in readers.items() if r.startswith(OWNER + ".")}
    with capsys.disabled():
        print(f"\n[TERM-030] week-contract readers outside {OWNER}: {len(outside)}")
        for r in sorted(outside):
            tag = 'asserted' if outside[r] else ('FROZEN  ' if r in FROZEN else 'BARE    ')
            print(f"    {tag}  {r}")
        print(f"[TERM-030] owner-internal readers (denominator, not in scope): {len(owner)}"
              f" — asserted {sum(owner.values())}")
        for r in sorted(owner):
            print(f"    {'asserted' if owner[r] else 'bare    '}  {r}")
    assert outside, "the census found no readers at all — it cannot be seeing the source"
    assert owner, "the census found no owner-internal readers — it cannot be seeing the router"
    bare = sorted(r for r, ok in outside.items() if not ok and r not in FROZEN)
    assert not bare, f"week-contract readers with no week_days() assertion: {bare}"
    stale = sorted(r for r in FROZEN if outside.get(r) is not False)
    assert not stale, f"FROZEN names a reader that is not a bare reader any more: {stale}"


def test_every_week_days_label_is_its_own_reader_id():
    _, labels = _full_census()
    assert labels, "no week_days() call sites found"
    wrong = [(where, lit) for where, lit in labels if where != lit]
    assert not wrong, f"reader= must equal <module>.<function>: {wrong}"


def test_the_behaviour_table_covers_every_asserted_reader():
    _, labels = _full_census()
    assert set(DRIVERS) == {where for where, _ in labels}
