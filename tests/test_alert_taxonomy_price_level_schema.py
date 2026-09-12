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


def test_the_registration_is_not_wired_yet():
    """A registered type with no evaluator behind it lets a predicate be created
    that nothing ever evaluates — an armed alert that silently never fires, which
    is worse than no alert. `register()` exists; nothing calls it yet."""
    callers = []
    for path in (_REPO / "api").rglob("*.py"):
        if path == _MODULE:
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        if "price_level" in text and "register" in text:
            callers.append(str(path.relative_to(_REPO)))
    assert callers == [], (
        f"price_level.register() appears to be wired in {callers}. Checkpoint 1 "
        "declares the type only; wiring lands with the evaluator, under its own approval.")


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
