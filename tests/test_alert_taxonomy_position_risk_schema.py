"""GATE-S7-POSITION-RISK Checkpoint 1 — registration + schema, nothing else.

⛔ The type must be DARK BY CONSTRUCTION, not by intention: no delivery import,
no read of `j2_positions`, no change to `awareness/**`, no scheduler entry, and
nothing calling `register()` yet. Each is asserted FROM THE SOURCE rather than
promised, and every absence assertion carries a control proving the probe could
have seen the thing it says is missing.

⛔ AND THE LEGACY SHAPES ARE DERIVED, NEVER QUOTED. The module docstring claims
to report exactly what `rule_stop_watch` reads and emits; the rails below
re-derive both by AST and fail if the docstring drifts from the code it
describes.
"""
from __future__ import annotations

import ast
import pathlib
import re

import pytest

from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import position_risk as pr
from api.services.alert_taxonomy import registry as _registry

_REPO = pathlib.Path(__file__).resolve().parents[1]
_MODULE = _REPO / "api" / "services" / "alert_taxonomy" / "position_risk.py"
_COMPARE = _REPO / "api" / "services" / "alert_taxonomy" / "position_risk_compare.py"
_LEGACY_RULES = _REPO / "api" / "services" / "awareness" / "rules.py"
_LEGACY_ENGINE = _REPO / "api" / "services" / "awareness" / "engine.py"

#: ⛔⛔ DOCUMENTATION IS NOT ALWAYS A DOCSTRING IN THIS PACKAGE. `PARAMS_SCHEMA`
#: and `BLIND_SPOTS` are prose stored in string LITERALS, so a docstring-only
#: stripper leaves every word of them in the "code" it hands back — and this
#: schema DESCRIBES the delivery and the population it must never touch.
#: Blanking these two by name is the fix;
#: `test_the_stripper_sees_code_and_not_prose` proves it still sees real code.
_PROSE_CONSTANTS = ("PARAMS_SCHEMA", "BLIND_SPOTS")


def _code_only(path: pathlib.Path) -> str:
    """⛔ CODE, NEVER PROSE."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id in _PROSE_CONSTANTS for t in node.targets):
            node.value = ast.Constant(value="<prose>")
    return ast.unparse(ast.fix_missing_locations(tree))


def _fn(path: pathlib.Path, name: str) -> ast.FunctionDef:
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{path.name} has no function {name} — the probe is broken, not the code")


def _imported_names(path: pathlib.Path) -> set[str]:
    """Every module a file imports, from the AST. Used for the delivery
    assertions so a mention inside prose can never satisfy or break one."""
    out: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            out |= {a.name for a in node.names}
        elif isinstance(node, ast.ImportFrom):
            base = node.module or ""
            out.add(base)
            out |= {f"{base}.{a.name}" for a in node.names}
    return out


# ═════════════════════════════════════════════════════════════════════════
# CONTROLS — every absence assertion below is worthless without these
# ═════════════════════════════════════════════════════════════════════════

def test_the_stripper_sees_code_and_not_prose():
    """⛔ THE CONTROL FOR EVERY ABSENCE ASSERTION BELOW. Without it, a stripper
    that returned '' would make all of them pass over nothing."""
    code = _code_only(_MODULE)
    raw = _MODULE.read_text(encoding="utf-8")
    # (a) the needles ARE in the prose…
    assert "deliver_alert_payload" in raw
    assert "j2_positions" in raw
    assert "replay_fn" in raw
    # (b) …and NONE of them is in the code.
    assert "deliver_alert_payload" not in code
    assert "j2_positions" not in code
    assert "replay_fn" not in code
    # (c) and the stripper still sees real code — named against what CP1-CP2
    # actually ship, never against a symbol from a later checkpoint.
    assert "def register" in code
    assert "def would_fire" in code
    assert "TYPE_ID = 'position-risk'" in code or 'TYPE_ID = "position-risk"' in code
    assert "register_trigger_type" in code
    assert "is_placeholder_stop" in code
    assert len(code) > 500


def test_the_import_probe_can_see_a_real_import():
    """⛔ NON-VACUITY for the no-delivery assertions. An import walk that
    returned an empty set would make every "does not import X" pass."""
    names = _imported_names(_MODULE)
    assert names, "the import walk found nothing at all — it is broken, not green"
    assert "api.services.placeholder_stop" in names
    assert "api.services.placeholder_stop.is_placeholder_stop" in names
    assert "api.services.alert_taxonomy.registry" in names


# ═════════════════════════════════════════════════════════════════════════
# THE TYPE
# ═════════════════════════════════════════════════════════════════════════

def test_the_type_id_is_the_spec_s_id():
    assert pr.TYPE_ID == "position-risk"


def test_registration_round_trips_the_schema(tmp_path):
    p = str(tmp_path / "at.db")
    _db.init_db(db_path=p)
    pr.register(db_path=p)
    types = {t["type_id"]: t for t in _registry.list_trigger_types(db_path=p)}
    assert "position-risk" in types
    assert types["position-risk"]["module"] == "api.services.alert_taxonomy.position_risk"
    assert types["position-risk"]["params_schema"] == pr.PARAMS_SCHEMA


def test_register_is_idempotent(tmp_path):
    p = str(tmp_path / "at.db")
    _db.init_db(db_path=p)
    pr.register(db_path=p)
    pr.register(db_path=p)
    rows = [t for t in _registry.list_trigger_types(db_path=p) if t["type_id"] == "position-risk"]
    assert len(rows) == 1, "a second boot must upsert, never duplicate"


def test_there_is_exactly_ONE_severity_vocabulary_constant():
    """⛔ The three types before this carry a `MATCH_RULES` tuple beside a
    separate discriminator. Here SPEC-S7 §5.2's discriminator IS the severity,
    so a second name would be a second authority over one value — and the two
    would drift the first time a severity was added to one of them."""
    code = _code_only(_MODULE)
    assert "MATCH_RULES" not in code
    assert set(pr.SEVERITIES) == {"stop_hit", "stop_proximity", "aggregate_heat"}
    assert set(pr.ABSORBED_SEVERITIES) | set(pr.UNREACHABLE_SEVERITIES) == set(pr.SEVERITIES)
    assert not set(pr.ABSORBED_SEVERITIES) & set(pr.UNREACHABLE_SEVERITIES)


# ═════════════════════════════════════════════════════════════════════════
# ⛔⛔ THE LEGACY SHAPES — DERIVED BY AST, NOT READ FROM THE GATE PACKET
# ═════════════════════════════════════════════════════════════════════════

def _stop_watch_kind_literals() -> set[str]:
    kinds = set()
    for node in ast.walk(_fn(_LEGACY_RULES, "rule_stop_watch")):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                and node.func.id == "InsightCandidate"):
            for kw in node.keywords:
                if kw.arg == "kind" and isinstance(kw.value, ast.Constant):
                    kinds.add(kw.value.value)
    return kinds


def _stop_watch_position_fields() -> set[str]:
    out = set()
    for node in ast.walk(_fn(_LEGACY_RULES, "rule_stop_watch")):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr == "get" and node.args
                and isinstance(node.args[0], ast.Constant)
                and isinstance(node.func.value, ast.Name)
                and node.func.value.id == "pos"):
            out.add(node.args[0].value)
    return out


def test_the_absorbed_severities_are_the_legacy_kind_literals():
    """⛔ GATE §4 ITEM 4. Derived from `rule_stop_watch`'s own `kind=` literals,
    so a FOURTH kind added there goes RED here rather than being silently
    unabsorbed."""
    kinds = _stop_watch_kind_literals()
    assert kinds, "the AST scan found no InsightCandidate kind= at all — broken, not green"
    assert kinds == set(pr.ABSORBED_SEVERITIES), (
        f"awareness/rules.py::rule_stop_watch now emits {sorted(kinds)}; "
        f"position-risk absorbs {sorted(pr.ABSORBED_SEVERITIES)}")


def test_the_near_stop_threshold_is_the_legacy_constant_read_by_AST():
    """⛔ GATE §4 ITEM 3 — derived from `rules.py`, never hand-typed."""
    found = {}
    for node in ast.parse(_LEGACY_RULES.read_text(encoding="utf-8")).body:
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id.isupper():
                    found[t.id] = node.value.value
    assert "NEAR_STOP_PCT" in found, f"rules.py no longer declares NEAR_STOP_PCT; saw {sorted(found)}"
    assert pr.LEGACY_NEAR_STOP_PCT == found["NEAR_STOP_PCT"]


def test_the_side_vocabulary_is_the_legacy_membership_guard():
    """The legacy rule skips any row whose side is outside its own tuple. Read
    from that tuple rather than from memory."""
    sides = set()
    for node in ast.walk(_fn(_LEGACY_RULES, "rule_stop_watch")):
        if isinstance(node, ast.Compare) and any(
                isinstance(o, (ast.In, ast.NotIn)) for o in node.ops):
            for c in node.comparators:
                if isinstance(c, (ast.Tuple, ast.List, ast.Set)):
                    sides |= {e.value for e in c.elts
                              if isinstance(e, ast.Constant) and isinstance(e.value, str)}
    assert sides, "no membership guard found in rule_stop_watch — the probe is broken"
    assert sides == set(pr.SIDES)


def test_the_module_docstring_REPORTS_the_legacy_shapes_it_read():
    """⛔⛔ REPORT THE LEGACY SHAPES BEFORE THE SCHEMA IS PINNED — and keep
    reporting them. Every position field the legacy rule actually reads, and
    every severity it actually emits, must be named in this module's docstring.

    ⭐ This is the rail that stops the docstring becoming the third artifact in
    this repo that describes code it no longer matches: a field added to
    `rule_stop_watch` goes red HERE, in the file whose whole first section
    claims to enumerate them.
    """
    doc = ast.get_docstring(ast.parse(_MODULE.read_text(encoding="utf-8"))) or ""
    assert doc, "the module has no docstring — there is nothing reporting the legacy shapes"
    fields = _stop_watch_position_fields()
    assert len(fields) >= 5, f"the field probe found only {sorted(fields)} — it is broken"
    for f in sorted(fields):
        assert f"pos['{f}']" in doc, (
            f"rule_stop_watch reads pos[{f!r}] and the docstring does not report it")
    assert "scan_ctx['live_prices']" in doc
    for kind in sorted(_stop_watch_kind_literals()):
        assert f"kind={kind}" in doc, f"the docstring does not report the {kind} severity"


def test_the_population_and_the_delivery_floor_are_reported_from_the_engine():
    """The two facts about the legacy path a projection would get wrong: which
    rows it reads, and that a stop breach ALREADY emails and Discords."""
    doc = ast.get_docstring(ast.parse(_MODULE.read_text(encoding="utf-8"))) or ""
    eng = ast.parse(_LEGACY_ENGINE.read_text(encoding="utf-8"))
    sql = [n.value for n in ast.walk(eng)
           if isinstance(n, ast.Constant) and isinstance(n.value, str) and "j2_positions" in n.value]
    assert sql, "no j2_positions query found in awareness/engine.py — the probe is broken"
    assert "closed_at IS NULL" in " ".join(" ".join(s.split()) for s in sql)
    assert "closed_at IS NULL" in doc

    floors = [n.value.value for n in eng.body
              if isinstance(n, ast.Assign) and isinstance(n.value, ast.Constant)
              and any(isinstance(t, ast.Name) and t.id == "_DELIVER_IMPORTANCE_FLOOR"
                      for t in n.targets)]
    assert floors == [8], f"the away-delivery floor moved: {floors}"
    assert "_DELIVER_IMPORTANCE_FLOOR = 8" in doc


# ═════════════════════════════════════════════════════════════════════════
# §1 — aggregate_heat is PINNED and UNREACHABLE, measured
# ═════════════════════════════════════════════════════════════════════════

def test_aggregate_heat_has_NO_scheduled_or_delivering_legacy_path():
    """⛔⛔ THE MEASUREMENT THE SCHEMA'S THIRD SEVERITY RESTS ON.

    An anchored, comment-and-docstring-stripped AST sweep over `api/**` for
    calls to `portfolio_heat(`. Every hit must be a REQUEST-TIME reader, the
    module itself, or its sibling test — nothing scheduled, nothing delivering.

    ⚠️ The anchor matters. A naive substring adds `api/routers/intelligence.py`,
    which calls `calculate_portfolio_heat` — a different function, from the
    brain engine. A search that counts its own near-miss is how a "sixth call
    site" gets reported.
    """
    rx = re.compile(r"(?<![A-Za-z0-9_])portfolio_heat\s*\(")
    naive = re.compile(r"portfolio_heat\s*\(")
    hits, naive_hits, scanned = [], [], 0
    for p in (_REPO / "api").rglob("*.py"):
        try:
            code = _code_only(p)
        except SyntaxError:
            continue
        scanned += 1
        rel = str(p.relative_to(_REPO)).replace("\\", "/")
        if rx.search(code):
            hits.append(rel)
        if naive.search(code):
            naive_hits.append(rel)

    assert scanned > 100, f"the module walk found almost nothing ({scanned}) — it is broken"
    assert sorted(hits) == [
        "api/services/ai_search_personal.py",
        "api/services/journal_two/coach_chat_tools.py",
        "api/services/portfolio_heat.py",
        "api/services/test_portfolio_heat.py",
        "api/services/voice_tool_impls.py",
    ], f"the portfolio_heat call sites moved: {sorted(hits)}"

    # ⭐ THE CONTROL ON THE ANCHOR: the naive form really does over-match, so
    # the anchored answer above is a choice rather than a coincidence.
    assert "api/routers/intelligence.py" in naive_hits
    assert "api/routers/intelligence.py" not in hits

    # …and nothing schedules it.
    main = _code_only(_REPO / "api" / "main.py")
    assert "portfolio_heat" not in main


def test_all_THREE_severities_are_pinned_and_the_schema_says_which_is_unreachable():
    """The F-S7-2 call: pin the shapes nothing populates yet, so a later
    widening is a data change and not a schema change — and say so, so the next
    engineer does not read the narrow shape as the whole shape."""
    sev = pr.PARAMS_SCHEMA["severity"]
    for name in pr.SEVERITIES:
        assert name in sev
    assert "UNREACHABLE" in sev
    assert pr.UNREACHABLE_SEVERITIES == ("aggregate_heat",)


def test_the_unreachable_severity_evaluates_to_NOTHING_rather_than_raising():
    """Pinned-but-unauthorized, the same call F-S7-2 made for `trendline`.
    Raising would make an unreachable severity break the very harness that is
    supposed to report it as unreachable."""
    pos = [{"symbol": "NVDA", "side": "Long", "entry_price": 100.0,
            "stop_price": 95.0, "source": "manual"}]
    for sev in ("aggregate_heat", "not_a_severity", None):
        params = {"severity": sev}
        assert pr.would_fire(params, positions=pos, live_prices={"NVDA": 90.0}) == [], sev


# ═════════════════════════════════════════════════════════════════════════
# ⛔ §3's CONDITION — no field encodes a placeholder verdict
# ═════════════════════════════════════════════════════════════════════════

def test_the_schema_carries_NO_field_encoding_a_placeholder_VERDICT():
    """⛔ GATE §3, and it is the whole condition CP1 was allowed under. A field
    naming the row's `source` is a FACT; a field naming whether its stop is REAL
    is a VERDICT, and pinning one would silently choose one of the definitions
    H14 unified and make it this type's specification."""
    for forbidden in ("stop_is_real", "has_real_stop", "is_placeholder",
                      "placeholder_stop", "stop_valid", "real_stop"):
        assert forbidden not in pr.PARAMS_SCHEMA, f"{forbidden} is a verdict, not a fact"
    assert "position_source" in pr.PARAMS_SCHEMA
    assert "NO\nDEFAULT" in pr.PARAMS_SCHEMA["position_source"] \
        or "NO DEFAULT" in pr.PARAMS_SCHEMA["position_source"]


def test_position_source_really_has_no_default_in_the_evaluator():
    """⛔ The prose above is only worth anything if the code agrees: a predicate
    that declares no `position_source` must see EVERY source, which is the
    legacy population. A default of 'broker' here would be the verdict smuggled
    back in as a filter."""
    rows = [
        {"symbol": "AAA", "side": "Long", "entry_price": 100.0, "stop_price": 95.0, "source": "broker"},
        {"symbol": "BBB", "side": "Long", "entry_price": 100.0, "stop_price": 95.0, "source": "manual"},
        {"symbol": "CCC", "side": "Long", "entry_price": 100.0, "stop_price": 95.0, "source": None},
    ]
    prices = {"AAA": 90.0, "BBB": 90.0, "CCC": 90.0}
    got = pr.would_fire({"severity": "stop_hit"}, positions=rows, live_prices=prices)
    assert sorted(got) == ["AAA", "BBB", "CCC"]


def test_the_type_module_defines_NO_placeholder_detector_of_its_own():
    """⛔ H14's rail fails by name on a sixth copy — including this one. This is
    the same assertion, scoped to this module, so a failure here names the file
    that broke it rather than 'a call site'."""
    stopish = r"(?:float\s*\(\s*)?\w*stop\w*\s*\)?"
    entryish = r"(?:float\s*\(\s*)?\w*entry\w*\s*\)?"
    rx = re.compile(r"abs\s*\(\s*" + stopish + r"\s*-\s*" + entryish + r"\s*\)\s*[<>]=?", re.I)
    for path in (_MODULE, _COMPARE):
        assert not rx.search(_code_only(path)), (
            f"{path.name} grew its own placeholder-stop test — H14 unified five "
            "detectors into one and this is the sixth")
    # …and it uses THE detector.
    assert "api.services.placeholder_stop.is_placeholder_stop" in _imported_names(_MODULE)
    assert "is_placeholder_stop(" in _code_only(_MODULE)
    # CONTROL: the regex can see a real one, so its silence above means something.
    assert rx.search(_code_only(_REPO / "api" / "services" / "placeholder_stop.py"))


# ═════════════════════════════════════════════════════════════════════════
# DARK BY CONSTRUCTION
# ═════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("path_name", ["position_risk.py", "position_risk_compare.py"])
def test_no_module_of_this_type_imports_DELIVERY(path_name):
    """⛔ NO DELIVERY IMPORT, asserted from the source. Both the import walk and
    the code scan, because an import can be made at call time inside a function
    and a call-time import is still an import."""
    path = _REPO / "api" / "services" / "alert_taxonomy" / path_name
    names = _imported_names(path)
    assert names, "the import walk found nothing — it is broken, not green"
    for forbidden in ("api.services.watchlist_alert_service",
                      "api.services.alert_taxonomy.delivery",
                      "api.services.email_service",
                      "api.services.voice_proactive_service",
                      "api.services.alerts"):
        assert forbidden not in names, f"{path_name} imports {forbidden}"
    code = _code_only(path)
    for forbidden in ("deliver_alert_payload", "watchlist_alert_service",
                      "add_insight", "send_email", "discord", "delivery"):
        assert forbidden not in code, f"{forbidden} reached {path_name}'s CODE"


def test_the_type_module_reads_no_database_and_no_position_table():
    """⛔ CP1-CP2 add no read of `j2_positions`. Positions arrive as an
    argument; the module never queries for them."""
    code = _code_only(_MODULE)
    for forbidden in ("j2_positions", "sqlite3", "auth_db", "get_connection",
                      "SELECT", "execute("):
        assert forbidden not in code, f"{forbidden} reached the type module's CODE"


def test_neither_module_touches_awareness_engine_or_changes_the_legacy():
    """⛔ NO LEGACY CHANGE. `awareness.rules` is a PURE function module and the
    harness drives it read-only; `awareness.engine` reads auth.db and delivers,
    and nothing here may import it."""
    for path in (_MODULE, _COMPARE):
        names = _imported_names(path)
        assert "api.services.awareness.engine" not in names, f"{path.name} imports the engine"
    # CONTROL: the harness DOES import the pure rule module, so the assertion
    # above is a distinction and not an accident of a broken walk.
    assert "api.services.awareness.rules" in _imported_names(_COMPARE)
    assert "api.services.awareness" not in _imported_names(_MODULE)


def test_there_is_no_replay_fn_and_the_module_says_why():
    code = _code_only(_MODULE)
    assert "replay_fn" not in code
    raw = _MODULE.read_text(encoding="utf-8")
    assert "FORWARD-ONLY" in raw
    assert "keeps no history" in raw


def test_nothing_calls_register_yet_and_that_is_the_checkpoint_boundary():
    """⛔ REGISTRATION IS NOT ACTIVATION. §2a item 3's warning, applied: CP1-CP2
    add no scheduler entry and no flag. The rail that this stays true is here so
    an accidental wire is caught rather than discovered at CP3."""
    main = _code_only(_REPO / "api" / "main.py")
    assert "position_risk" not in main, (
        "api/main.py wires position-risk — that is CP3 and needs a new approval line")
    # CONTROL: main.py really was read and really does contain other wiring.
    assert "add_job" in main
