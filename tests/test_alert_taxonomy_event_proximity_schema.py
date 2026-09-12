"""GATE-S7-EVENT-PROXIMITY Checkpoint 1 — registration + schema, nothing else.

⛔ The type must be DARK BY CONSTRUCTION, not by intention: no evaluator, no
delivery import, no read of the legacy dedup table, and nothing calling
`register()` yet. Each of those is asserted from the SOURCE rather than promised.
"""
from __future__ import annotations

import ast
import pathlib

import pytest

from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import event_proximity as ep
from api.services.alert_taxonomy import registry as _registry

_REPO = pathlib.Path(__file__).resolve().parents[1]
_MODULE = _REPO / "api" / "services" / "alert_taxonomy" / "event_proximity.py"
_LEGACY = _REPO / "api" / "services" / "calendar_alerts.py"


def _code_only(path: pathlib.Path) -> str:
    """⛔ CODE, NEVER PROSE. This module discusses delivery, replay and the legacy
    path at length; a naive substring search matches its own explanation."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
    return ast.unparse(tree)


# --- the type ---------------------------------------------------------------

def test_the_type_id_is_the_spec_s_id():
    assert ep.TYPE_ID == "event-proximity"


def test_registration_round_trips_the_schema(tmp_path):
    p = str(tmp_path / "at.db")
    _db.init_db(db_path=p)
    ep.register(db_path=p)
    types = {t["type_id"]: t for t in _registry.list_trigger_types(db_path=p)}
    assert "event-proximity" in types
    assert types["event-proximity"]["module"] == "api.services.alert_taxonomy.event_proximity"
    assert types["event-proximity"]["params_schema"] == ep.PARAMS_SCHEMA


def test_register_is_idempotent(tmp_path):
    p = str(tmp_path / "at.db")
    _db.init_db(db_path=p)
    ep.register(db_path=p)
    ep.register(db_path=p)
    rows = [t for t in _registry.list_trigger_types(db_path=p)
            if t["type_id"] == "event-proximity"]
    assert len(rows) == 1, "a second boot must upsert, never duplicate"


# --- F-S7-EP-1: wider shapes pinned, narrow behaviour not widened ------------

@pytest.mark.parametrize("field", ["event_kind", "entity_ref", "event_date",
                                   "granularity", "lead_days", "lead_hours", "session"])
def test_every_schema_field_carries_its_contract(field):
    """A bare type name pushes the meaning into a comment nobody reads at the
    call site."""
    assert isinstance(ep.PARAMS_SCHEMA[field], str) and len(ep.PARAMS_SCHEMA[field]) > 20


def test_all_four_event_kinds_are_pinned_even_though_three_are_unpopulated():
    """⭐ THE F-S7-2 CALL, MADE AGAIN. A schema that admits only what exists today
    teaches the next engineer that the narrow shape is the whole shape, and
    widening a LIVE schema costs far more than pinning an unpopulated field."""
    assert ep.EVENT_KINDS == ("earnings", "economic", "ipo", "dividend")
    for kind in ep.EVENT_KINDS:
        assert kind in ep.PARAMS_SCHEMA["event_kind"], (
            f"{kind} is in EVENT_KINDS but not described in the schema text")


def test_both_granularities_are_pinned_and_the_day_only_limit_is_stated():
    assert ep.GRANULARITIES == ("day", "hour")
    assert "DAY-ONLY" in ep.PARAMS_SCHEMA["granularity"]


def test_the_schema_WARNS_about_the_three_day_constant_that_is_not_this_paths():
    """⛔⛔ F-S7-EP-1's SHARPEST EDGE, pinned so it cannot be quietly dropped.

    `calendar_alerts.EARNINGS_PROXIMITY_DEFAULT_DAYS = 3` lives in the file this
    type absorbs but is consumed by `awareness/engine.py`, NOT by
    `run_prereport_alerts`. A reader who takes it for this alert's window builds a
    type that fires three days early and concludes the legacy path was "missing"
    alerts it was never designed to send.
    """
    txt = ep.PARAMS_SCHEMA["lead_days"]
    assert "EARNINGS_PROXIMITY_DEFAULT_DAYS" in txt
    assert "awareness" in txt


def test_CONTROL_the_three_day_constant_really_does_live_in_the_legacy_file():
    """⛔ The warning above is only worth pinning if the trap is real. If the
    constant ever moves out of `calendar_alerts.py`, the note describes nothing
    and should be rewritten rather than carried."""
    legacy = _LEGACY.read_text(encoding="utf-8")
    assert "EARNINGS_PROXIMITY_DEFAULT_DAYS = 3" in legacy, (
        "the constant this warning is about is no longer in the legacy file - "
        "re-read F-S7-EP-1 rather than keeping a note about a trap that moved")


def test_CONTROL_the_legacy_alert_path_really_is_earnings_only_and_day_keyed():
    """⛔ F-S7-EP-1 IS A CLAIM ABOUT CODE, so it is checked against the code.

    If `run_prereport_alerts` grows an economic/IPO/dividend branch or an hour
    concept, this type's "compare the behaviour that exists" scope is stale and
    the packet needs re-reading - the rail says so instead of silently passing.
    """
    legacy = _code_only(_LEGACY)
    assert "run_prereport_alerts" in legacy, "the scan did not find the alert path - broken"
    assert "market_date" in legacy, "the day-keyed identity is gone; re-read the packet"
    for widened in ("ipo_calendar", "dividends_calendar", "economic_calendar"):
        assert widened not in legacy, (
            f"the legacy alert path now reaches {widened} - F-S7-EP-1 said it fires "
            "on earnings ONLY, and that is the premise CP1-CP2's scope rests on")


# --- dark by construction ---------------------------------------------------

def test_the_type_is_dark_by_construction_not_by_intention():
    """No delivery, no email, no legacy-table read. Asserted from the imports."""
    imported: set = set()
    for node in ast.walk(ast.parse(_MODULE.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            imported |= {a.name for a in node.names}
        elif isinstance(node, ast.ImportFrom):
            base = node.module or ""
            imported.add(base)
            imported |= {f"{base}.{a.name}" for a in node.names}
    assert imported, "the import scan saw nothing - broken, not green"
    for banned in ("delivery", "email_service", "calendar_alerts", "deliver_alert_payload"):
        assert not any(banned in n for n in imported), f"event_proximity imports {banned}"


def test_no_replay_fn_is_registered():
    """⛔ A calendar date MOVES, and the legacy row keeps no record of what it was
    when the alert armed. Replaying against today's calendar answers a question
    about today's data, not about the day in question."""
    code = _code_only(_MODULE)
    assert "replay_fn" not in code, (
        "event_proximity registers a replay_fn - see the module docstring: the "
        "comparison is forward-only and a date change resets the clock")


def test_CP1_ships_no_evaluator_and_nothing_calls_register():
    """⛔ CP1 DECLARES THE TYPE. A registered type with a wired evaluator is CP2+;
    a registered type with an evaluator nobody calls is the defect price-level
    shipped, so both halves are asserted."""
    code = _code_only(_MODULE)
    for evaluator_ish in ("def evaluate", "def run_dark_sweep", "record_fire"):
        assert evaluator_ish not in code, f"CP1 must ship no evaluator; found {evaluator_ish}"

    callers = []
    for path in sorted((_REPO / "api").rglob("*.py")):
        if path == _MODULE:
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"))
        except SyntaxError:
            continue
        aliases = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and "alert_taxonomy" in (node.module or ""):
                for a in node.names:
                    if a.name == "event_proximity":
                        aliases.add(a.asname or a.name)
        if not aliases:
            continue
        for node in ast.walk(tree):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "register"
                    and isinstance(node.func.value, ast.Name)
                    and node.func.value.id in aliases):
                callers.append(str(path.relative_to(_REPO)).replace("\\", "/"))
    assert callers == [], (
        f"event_proximity.register() is wired in {callers}. CP1 declares the type; "
        "wiring lands with the evaluator under CP3's own approval line.")


def test_the_legacy_path_is_byte_identical():
    """⛔ THE ABSORPTION DEFAULT: legacy stays live and untouched."""
    import subprocess
    r = subprocess.run(
        ["git", "-C", str(_REPO), "diff", "--stat", "origin/master", "--",
         "api/services/calendar_alerts.py"],
        capture_output=True, text=True)
    assert r.stdout.strip() == "", (
        f"calendar_alerts.py differs from master:\n{r.stdout}")
