"""⛔ A TRIGGER TYPE IS WIRED INTO `main.py` WHEN ITS **CP3** IS SIGNED — NEVER BEFORE, NEVER AFTER.

Both directions, one rail, because the two failures look nothing alike and both
have happened in this programme:

  **TOO EARLY** — a type wired while it sits at CP2 puts an unapproved module in
  the boot path. Each type's own CP1/CP2 suite already guards this with
  `assert "<module>" not in main`; this file states the family rule those
  per-type rails are instances of.

  **TOO LATE** — a type reaches CP3, gets a projection, a sweep and eighteen
  green tests, and nothing calls it. `price-level` CP3 shipped exactly that way
  for one commit: *built, tested, green and unreachable.* Every CP3 suite's own
  caller rail catches it for ONE type; this catches the family.

──────────────────────────────────────────────────────────────────────────────
⚰️ THE READING THIS FILE EXISTS TO PREVENT, AND IT WAS MINE, 2026-09-13
──────────────────────────────────────────────────────────────────────────────

Measured in the production pod, `/data/alert_taxonomy.db`:

    REGISTERED TRIGGER TYPES: 3
        document-arrival | event-proximity | price-level

…while the package ships **eight** modules that each define `register()`. That
looked exactly like five instances of *built, tested, green and unreachable* —
a hazard class, live, of the kind H14 says to chase immediately. A draft commit
wired all five.

⭐⭐ **IT WAS WRONG, AND THE FOUR BOUNDARY RAILS CAUGHT IT.** Registration in
`main.py` is CP3's act. `regime_change`, `scan_membership_change`,
`catalyst_match` and `indicator_condition` sit at CP2 and are absent ON PURPOSE.
**Three registered types is the correct state of a programme in which three
types have reached CP3.** CP1's "registration + params schema" means the module
OFFERS a `register()`; the process takes it up when the dark run is approved.

⛔ **THE GENERAL FORM IS WORTH MORE THAN THE INSTANCE:** a gap between what a
module PROVIDES and what the process USES is not automatically a defect. Ask
what the boundary is for before closing it. The same shape produced this repo's
`earnings_router` row — present, unmounted, and deliberately so.
"""
from __future__ import annotations

import ast
import pathlib

import pytest

_REPO = pathlib.Path(__file__).resolve().parents[1]
_PKG = _REPO / "api" / "services" / "alert_taxonomy"
_MAIN = _REPO / "api" / "main.py"

#: Modules in the package that are not trigger types. DECLARED rather than
#: guessed from the name: "does this define register()" is the question, and a
#: name-shaped rule about which files are types would be a second authority.
_NOT_A_TYPE = {"db", "delivery", "predicates", "receipts", "registry", "__init__"}

#: ⛔ THE APPROVAL STATE, DECLARED — the one thing no AST can read, because it
#: lives in a signed gate packet and not in the source. Read 2026-09-13 from
#: `docs/terminal-research/12-decisions/gates/`.
#:
#: `True`  — CP3 is signed, so `main.py` MUST call `register()`.
#: `False` — the type is at CP2 or earlier, so `main.py` MUST NOT name it.
CP3_SIGNED = {
    "document_arrival": True,          # the first slice; live, not dark
    "price_level": True,               # line 2, 2026-09-12
    "event_proximity": True,           # line 2, 2026-09-12
    "position_risk": True,             # line 2, ec2b197f8
    "regime_change": True,             # line 2, 9f0575340
    "scan_membership_change": True,    # line 2, d0415f251
    "catalyst_match": True,            # line 2, 3ee80dc13
    "indicator_condition": True,       # line 3, 4e8d3af5d (dep discharged)
}


def _defines_register(path: pathlib.Path) -> bool:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return any(isinstance(n, ast.FunctionDef) and n.name == "register"
               for n in tree.body)


def trigger_type_modules() -> list[str]:
    """Every module in the package that defines a top-level `register()`."""
    out = []
    for p in sorted(_PKG.glob("*.py")):
        if (p.stem in _NOT_A_TYPE or p.stem.endswith("_compare")
                or p.stem.endswith("_projection")):
            continue
        if _defines_register(p):
            out.append(p.stem)
    return out


def registered_in_main() -> set[str]:
    """Every `<alias>.register()` call in `main.py`, resolved to its module.

    ⭐ Resolved through the IMPORT ALIAS, not matched on the alias's spelling:
    `_at_doc_arrival.register()` has to become `document_arrival`, or this rail
    would be asserting a naming convention instead of a wire.

    ⛔ AST, so a call inside a comment or a docstring is not a wire. Proved
    below rather than asserted — six instruments in one week reported their own
    needle as a finding.
    """
    tree = ast.parse(_MAIN.read_text(encoding="utf-8"))
    alias_to_module: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and (node.module or "").endswith("alert_taxonomy"):
            for a in node.names:
                alias_to_module[a.asname or a.name] = a.name
    called: set[str] = set()
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "register"
                and isinstance(node.func.value, ast.Name)):
            mod = alias_to_module.get(node.func.value.id)
            if mod:
                called.add(mod)
    return called


def test_NON_VACUITY_both_sides_of_the_comparison_are_populated():
    """⛔ Every assertion below is satisfied by two empty sets. A parser that
    read nothing would make this rail permanently, invisibly green."""
    modules = trigger_type_modules()
    called = registered_in_main()
    assert len(modules) >= 5, f"only found {modules} — the package walk is broken"
    assert len(called) >= 3, f"only found {called} — the main.py walk is broken"
    assert "document_arrival" in modules and "document_arrival" in called


def test_CONTROL_the_parser_ignores_a_register_that_is_only_prose():
    """⛔ `CODE, NEVER PROSE`. Mutation-proved on the real file too: commenting
    out `_at_regime_change.register()` made this rail go RED, so the AST is
    genuinely reading code and not text."""
    fake = ast.parse('"""calls register() at boot"""\n# thing.register()\nX = 1\n')
    assert not any(isinstance(n, ast.FunctionDef) and n.name == "register"
                   for n in fake.body)
    assert [n for n in ast.walk(fake)
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
            and n.func.attr == "register"] == []


def test_the_declared_approval_state_covers_every_type_that_exists():
    """⛔ A type added tomorrow with no entry here fails LOUDLY rather than
    defaulting to either answer. Defaulting to False would let a signed CP3 go
    unwired; defaulting to True would demand a wire for a type at CP1."""
    undeclared = sorted(set(trigger_type_modules()) - set(CP3_SIGNED))
    assert not undeclared, (
        f"{undeclared} define register() and are not in CP3_SIGNED. Add each "
        "with its approval state — True only if that type's CP3 line is signed.")
    stale = sorted(set(CP3_SIGNED) - set(trigger_type_modules()))
    assert not stale, (
        f"{stale} are declared here but define no register() — remove them in "
        "the same commit that removed the module.")


@pytest.mark.parametrize("module", sorted(CP3_SIGNED))
def test_a_type_is_wired_exactly_when_its_CP3_is_signed(module):
    """⛔⛔ THE RAIL, both directions, failing BY NAME one type at a time."""
    wired = module in registered_in_main()
    if CP3_SIGNED[module]:
        assert wired, (
            f"`{module}` has a SIGNED CP3 and `api/main.py` never calls its "
            f"register() — the type does not exist in the running process, so "
            f"its dark sweep writes receipts against a type_id the registry has "
            f"never heard of. This is `built, tested, green and unreachable`, "
            f"which price-level CP3 shipped once already.")
    else:
        assert not wired, (
            f"`{module}` is wired into api/main.py and its CP3 is NOT signed. "
            f"Registration in the boot path is CP3's act; at CP1-CP2 the module "
            f"only OFFERS a register(). Get the approval line first.")
