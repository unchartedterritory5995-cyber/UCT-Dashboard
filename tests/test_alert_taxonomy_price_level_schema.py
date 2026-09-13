"""GATE-S7-PRICE-LEVEL Checkpoint 1's rail.

Two jobs, and they fail for different reasons — which is why they are separate
tests rather than one:

  1. **The schema can represent every shape the legacy path actually handles.**
     The shapes are DERIVED from `watchlist_alert_service.py` by AST, never
     hand-typed here. A typed list would be a second authority over the same
     value and would go stale in whichever copy moved first — the defect this
     repo names more than any other.

  2. **The type is dark BY CONSTRUCTION.** Not "we did not call delivery" — a
     claim about a run — but "this file does not import delivery," a property of
     the file that a test can actually hold.

⛔ Every scan here carries a NON-VACUITY CONTROL. An AST walk that matches
nothing returns an empty set, and an empty set satisfies almost any assertion
anyone writes (rule 14).
"""
from __future__ import annotations

import ast
import pathlib
import re

import pytest

from api.services.alert_taxonomy import price_level

_REPO = pathlib.Path(__file__).resolve().parents[1]
_LEGACY = _REPO / "api" / "services" / "watchlist_alert_service.py"
_DDL = _REPO / "api" / "services" / "auth_db.py"
_MODULE = _REPO / "api" / "services" / "alert_taxonomy" / "price_level.py"


def _legacy_alert_types() -> set[str]:
    """Every `alert_type` value the LEGACY module actually handles, read from it.

    Two sources, because the value arrives two ways and either alone under-counts:
      * default values of a parameter named `alert_type` (`create_alert`,
        `resync_bound_alerts`)
      * string constants compared against something named `alert_type`
        (`_alert_level_now`'s dispatch)
    """
    tree = ast.parse(_LEGACY.read_text(encoding="utf-8"))
    found: set[str] = set()

    for node in ast.walk(tree):
        # `def f(..., alert_type: str = "price")`
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            args = node.args
            positional = args.posonlyargs + args.args
            for arg, default in zip(positional[len(positional) - len(args.defaults):], args.defaults):
                if arg.arg == "alert_type" and isinstance(default, ast.Constant) \
                        and isinstance(default.value, str):
                    found.add(default.value)
            for arg, default in zip(args.kwonlyargs, args.kw_defaults):
                if arg.arg == "alert_type" and isinstance(default, ast.Constant) \
                        and isinstance(default.value, str):
                    found.add(default.value)

        # `alert.get("alert_type") == "trendline"` / `alert_type == "trendline"`
        if isinstance(node, ast.Compare):
            rendered = ast.dump(node.left)
            if "alert_type" in rendered:
                for comparator in node.comparators:
                    if isinstance(comparator, ast.Constant) and isinstance(comparator.value, str):
                        found.add(comparator.value)

    return found


def _ddl_alert_type_default() -> str | None:
    """The column default in `watchlist_alerts`' CREATE TABLE — the value every
    row written without an explicit type carries."""
    m = re.search(r"alert_type\s+TEXT\s+DEFAULT\s+'([^']+)'", _DDL.read_text(encoding="utf-8"))
    return m.group(1) if m else None


def test_the_derivation_actually_read_the_legacy_module():
    """NON-VACUITY CONTROL for both scans below. If the paths are wrong or the
    AST shapes stopped matching, every downstream assertion would pass over an
    empty set and this rail would be decoration."""
    assert _LEGACY.exists(), f"the legacy module is not where this rail looks: {_LEGACY}"
    types = _legacy_alert_types()
    assert types, ("the AST scan found NO alert_type values at all — it is broken, "
                   "not green. The legacy module dispatches on this field.")
    # Name a member the scan CANNOT legitimately miss: `_alert_level_now`'s
    # dispatch is the reason this trigger type has two shapes at all.
    assert "trendline" in types, (
        f"the scan missed the trendline branch, which is F-S7-2's whole subject. Saw: {sorted(types)}")
    assert _ddl_alert_type_default() is not None, (
        "the watchlist_alerts DDL default could not be read; the regex or the schema moved")


def test_the_schema_can_represent_every_shape_the_legacy_path_handles():
    """F-S7-2. The absorption must be able to carry a trendline alert. A schema
    that cannot would silently stop arming every line a member has drawn — an
    armed alert quietly ceasing to be armed, which is member-visible."""
    legacy = _legacy_alert_types() | {_ddl_alert_type_default()}
    declared = price_level.PARAMS_SCHEMA["level_kind"]

    missing = sorted(k for k in legacy if k and k not in declared)
    assert not missing, (
        f"`level_kind` does not name these shipped alert_type values: {missing}. "
        "A price-level predicate that cannot express them drops those alerts.")

    # The trendline shape needs its geometry carried, not just its name.
    for field in ("anchor_t1", "anchor_p1", "anchor_t2", "anchor_p2"):
        assert field in price_level.PARAMS_SCHEMA, (
            f"`{field}` is absent, so a trendline's level could not be recomputed "
            "per cycle — the schema would name the shape without carrying it.")


def test_the_type_is_dark_by_construction_not_by_intention():
    """⛔ Condition 4 of the gate packet. Checkpoint 1 ships no member delivery,
    and the check is the IMPORT, not a promise in a comment."""
    tree = ast.parse(_MODULE.read_text(encoding="utf-8"))
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported |= {a.name for a in node.names}
        elif isinstance(node, ast.ImportFrom):
            base = node.module or ""
            imported.add(base)
            imported |= {f"{base}.{a.name}" for a in node.names}

    # NON-VACUITY: the scan must see the one import the module really has.
    assert any("registry" in name for name in imported), (
        f"the import scan saw nothing recognisable — it is broken, not green. Saw: {sorted(imported)}")

    assert not any("delivery" in name for name in imported), (
        "price_level.py imports delivery. Checkpoint 1 is dark: it registers a "
        "type and must not be able to reach a member.")


def test_checkpoint_1_registers_no_replay_fn():
    """F-S7-3. A `replay_fn` today would emit 'would have fired N times' computed
    against a line that may have been moved since it was armed, with no
    `updated_at` on the row to detect it. A fabricated receipt carrying a figure
    is worse than a blank."""
    src = _MODULE.read_text(encoding="utf-8")
    # Strip comments and docstrings first: this file DISCUSSES replay_fn at
    # length, and a naive substring search would match its own explanation.
    # ⛔ CODE, NEVER PROSE.
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) \
                and isinstance(node.value.value, str):
            node.value.value = ""
    code_only = ast.unparse(tree)

    assert "replay_fn" not in code_only, (
        "price_level.py passes a replay_fn. See F-S7-3 — it cannot be computed "
        "honestly for a bound trendline until the geometry question is answered.")


def test_the_registration_is_wired_ONCE_and_nowhere_else():
    """⚰️ **THIS TEST USED TO ASSERT THE OPPOSITE**, and the sentence it carried
    was true when it was written:

        "A registered type with no evaluator behind it lets a predicate be
        created that nothing ever evaluates — an armed alert that silently never
        fires, which is worse than no alert. `register()` exists; nothing calls
        it yet."

    ⛔ That hazard is DISCHARGED, not waived. CP2 built the evaluator and CP3
    wires `register()` under approval line 2 — so the condition the rule was
    protecting (a type that can be armed and never evaluated) no longer holds,
    and the assertion is rewritten rather than deleted. Deleting it would leave
    the next reader with no record that the wiring is deliberate.

    **What must stay true, and what this now asserts:**
      1. an evaluator exists behind the registered type;
      2. `register()` is called from EXACTLY ONE place, the boot path;
      3. nothing schedules the evaluator — registration is not activation.

    ⭐ Callers are DERIVED by AST from the import alias, never grepped: the old
    version matched any file containing both "price_level" and "register", which
    would now match `price_level_projection.py` for its prose.
    """
    assert callable(getattr(price_level, "evaluate", None)), (
        "the type is registered with no evaluator behind it — that is the exact "
        "hazard the CP1 form of this test existed to prevent")

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
            if isinstance(node, ast.ImportFrom):
                for a in node.names:
                    if a.name == "price_level" and "alert_taxonomy" in (node.module or ""):
                        aliases.add(a.asname or a.name)
            elif isinstance(node, ast.Import):
                for a in node.names:
                    if a.name.endswith("alert_taxonomy.price_level"):
                        aliases.add(a.asname or a.name)
        if not aliases:
            continue
        for node in ast.walk(tree):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "register"
                    and isinstance(node.func.value, ast.Name)
                    and node.func.value.id in aliases):
                callers.append(str(path.relative_to(_REPO)).replace("\\", "/"))

    assert callers == ["api/main.py"], (
        f"price_level.register() is called from {callers}. CP3 approves ONE call "
        "site, in the boot path; a second one is a second authority over whether "
        "the type exists.")

    main = (_REPO / "api" / "main.py").read_text(encoding="utf-8")
    after = main.split("_at_price_level.register()")[1][:600]
    assert "add_job" not in after, (
        "a scheduler entry landed beside the registration. The DARK sweep has "
        "its own flag-gated block further down; a second, ungated one here would "
        "run the evaluator on every boot.")

    # ⚰️ This assertion used to read "Registration is NOT activation — putting the
    # evaluator on a tick is the flip, and the flip is its own approval line."
    # ⛔ The second half was WRONG and it nearly cost the dark run. Putting the
    # evaluator on a tick is exactly what approval line 2 authorised ("the
    # comparison harness runs against the projected predicates"); the FLIP is
    # delivery plus the legacy switch-off. Conflating the two left the module
    # registered, tested, green and called by nothing.
    assert 'id="alert_taxonomy_price_level_dark"' in main, (
        "the dark comparison sweep is not wired to any tick — CP3's harness "
        "would collect nothing, and an empty store reads like agreement")


def test_the_type_id_is_the_spec_s_id():
    """PRD-S7 §6.1 row 1 names it `price-level`. The registry, the predicate rows
    and the feed bridge all key off this string."""
    assert price_level.TYPE_ID == "price-level"


@pytest.mark.parametrize("field", ["level_kind", "direction", "target_price", "drawing_id"])
def test_schema_fields_are_documented_not_bare(field):
    """Each field carries its own contract text. The registry stores the schema
    as the type's public description; a bare type name there would push the
    meaning into a comment nobody reads at the call site."""
    assert isinstance(price_level.PARAMS_SCHEMA[field], str)
    assert len(price_level.PARAMS_SCHEMA[field]) > 20, f"{field} has no contract text"


# --- F-S7-4: the third shape, made design -----------------------------------

def test_all_three_known_shapes_are_pinned():
    """⛔ F-S7-4 (owner ruling, 2026-09-12). Production carries a third
    `alert_type` — `line`, drawing-bound and carrying NO anchors — that neither
    F-S7-2 nor the original schema anticipated. It was found by the CP3 pipeline
    dry run, not by reading the legacy code."""
    assert price_level.KNOWN_LEVEL_KINDS == ("price", "trendline", "line")
    for kind in price_level.KNOWN_LEVEL_KINDS:
        assert f"'{kind}'" in price_level.PARAMS_SCHEMA["level_kind"], (
            f"{kind} is in KNOWN_LEVEL_KINDS but the schema text does not name it")


def test_each_of_the_three_shapes_resolves_through_ITS_OWN_BRANCH():
    """⛔⛔ THE POINT OF F-S7-4: LUCK BECOMES DESIGN.

    `price` and `line` produce the same answer, and before this ruling they
    reached it through the same `else` fall-through. ⭐ The tempting reading of a
    drawing-bound row is *"bound to a drawing, therefore interpolate"* — and that
    reading would have disagreed with legacy on every one of those rows, for a
    reason that is not the migration.

    So the branches are asserted from the SOURCE: each named shape must be
    tested for explicitly, not land in a default.
    """
    src = _MODULE.read_text(encoding="utf-8")
    tree = ast.parse(src)
    fn = next(n for n in tree.body
              if isinstance(n, ast.FunctionDef) and n.name == "level_at")
    compared = set()
    for node in ast.walk(fn):
        if isinstance(node, ast.Compare) and isinstance(node.ops[0], ast.Eq):
            rhs = node.comparators[0]
            if isinstance(rhs, ast.Name):
                compared.add(rhs.id)
    assert {"TRENDLINE", "BOUND_LINE", "FIXED"} <= compared, (
        f"level_at does not branch explicitly on every named shape; it compares "
        f"only {sorted(compared)}. A shape that lands in the default is a "
        "fall-through, and F-S7-4 exists because a fall-through was right by luck")


@pytest.mark.parametrize("kind,expect_interpolated", [
    ("trendline", True),
    ("line", False),
    ("price", False),
])
def test_the_three_shapes_resolve_to_the_right_LEVEL(kind, expect_interpolated):
    """The branches must also produce the right answers, not merely exist."""
    t1, t2 = 1_000_000.0, 1_000_000.0 + 86_400.0
    params = {"level_kind": kind, "target_price": 50.0,
              "anchor_t1": t1, "anchor_p1": 100.0,
              "anchor_t2": t2, "anchor_p2": 200.0}
    got = price_level.level_at(params, t1 + 43_200.0)
    if expect_interpolated:
        assert got == pytest.approx(150.0), "a trendline must interpolate"
    else:
        assert got == 50.0, f"{kind} must resolve to its fixed target_price"


def test_a_BOUND_LINE_with_no_anchors_is_the_production_shape():
    """⚠️ The real rows carry `drawing_id` AND NO anchors. The branch must not
    quietly depend on anchors being present."""
    params = {"level_kind": "line", "target_price": 42.0, "drawing_id": "d1",
              "anchor_t1": None, "anchor_p1": None,
              "anchor_t2": None, "anchor_p2": None}
    assert price_level.level_at(params, 1_700_000_000.0) == 42.0


def test_an_UNKNOWN_kind_STILL_falls_through_exactly_as_legacy_does():
    """⛔ A FOURTH alert_type must NOT make the dark side raise or return None.

    `_alert_level_now` falls through to `target_price` for anything that is not
    `trendline`, so the mirror must too — otherwise the day a fourth type
    reaches production the comparison starts measuring our refusal instead of
    the migration. ⭐ The loudness belongs in the rail and the dry run, never in
    a runtime refusal that breaks the thing it was meant to protect.
    """
    params = {"level_kind": "something-new", "target_price": 7.5}
    assert price_level.level_at(params, 1_700_000_000.0) == 7.5


def test_the_dry_run_FAILS_if_a_fourth_alert_type_appears_in_production():
    """⛔ THE CONTROL THE RULING ASKED FOR, and it lives where production data is
    actually read — the dry-run tool, not a unit test that can never see a real
    row. Asserted from the SOURCE so the check cannot be quietly dropped."""
    import ast as _ast
    src = (_REPO / "tools" / "s7_price_level_dryrun.py").read_text(encoding="utf-8")
    tree = _ast.parse(src)
    for node in _ast.walk(tree):
        if (isinstance(node, _ast.Expr) and isinstance(node.value, _ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
    code = _ast.unparse(tree)
    assert "KNOWN_LEVEL_KINDS" in code, (
        "the dry run no longer checks projected shapes against KNOWN_LEVEL_KINDS "
        "— a fourth alert_type would reach the comparison unannounced")
