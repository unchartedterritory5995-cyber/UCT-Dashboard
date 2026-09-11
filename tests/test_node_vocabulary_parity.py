"""Every copy of the node vocabulary must BE the vocabulary — and the copies are
FOUND, not listed.

⛔⛔ WHY THIS FILE EXISTS. ``ast_interpret.NODE_TYPES`` is the one authority for
the canonical node types, and at least five modules redeclare it because the
purity rails forbid them from importing the evaluator (a linter that could reach
``indicator_compute`` could reach a verdict by RUNNING a formula). The Kind-4
merge added ``str``/``symtext``/``textop`` to the authority and moved exactly one
of those copies. The others stayed at eight:

  * ``ast_lint._CANONICAL_TYPES``       — had a parity test, went red, stayed red
  * ``ast_freshness._CANONICAL_TYPES``  — same test, same red
  * ``scan_definition``'s branch arms   — had a parity test, went red
  * ``user_definitions._CANONICAL_KEYS`` — was updated
  * ``compute_graph.CANONICAL_KEYS``    — 🔴 **HAD NO RAIL AT ALL** and was
    silently eight for as long as the trio existed. Nothing was red. A V2 graph
    carrying bind-time text would have been refused as "not a canonical node"
    with a message naming eight types, by the one mirror nobody was watching.

⭐⭐ SO THE COPIES ARE DERIVED HERE RATHER THAN ENUMERATED. A test that listed
the five would itself be a sixth hand list — and the sixth is exactly what went
unguarded last time. This walks the source with an AST and finds every
module-level container that is CLAIMING to be the vocabulary, which means a new
copy in a new file is covered the day it lands, by nobody's remembering.

⛔ A RED HERE IS NOT "ADD THE MISSING NAME TO THE TEST". It means a copy of the
vocabulary has drifted from ``ast_interpret.NODE_TYPES``, and the fix is in the
module — or, better, in deleting the copy.
"""

import ast
import io
import pathlib

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
ROOTS = (REPO / "api" / "services", REPO / "api" / "routers")

#: A container holding MORE THAN HALF the vocabulary is claiming to be it.
#:
#: ⭐ THE THRESHOLD IS WHAT LETS A DECLARED SUBSET EXIST.
#: ``ast_interpret.BIND_TIME_NODE_TYPES`` is three of the eleven ON PURPOSE — it
#: names the non-evaluable subset, and its own docstring says two rails need it
#: for opposite reasons. Demanding that every container of node-type names be the
#: whole vocabulary would make that legitimate subset illegal, and the fix would
#: be to weaken this rail. A majority is the line between "a subset of the
#: vocabulary" and "a copy of the vocabulary".
MAJORITY = 0.5


def _authority():
    import sys
    sys.path.insert(0, str(REPO))
    from api.services import ast_interpret
    return set(ast_interpret.NODE_TYPES)


def _string_members(node):
    """The string elements of a literal container, or None if it is not one."""
    if isinstance(node, (ast.Tuple, ast.List, ast.Set)):
        items = node.elts
    elif isinstance(node, ast.Dict):
        items = [k for k in node.keys if k is not None]
    else:
        return None
    out = []
    for it in items:
        if not isinstance(it, ast.Constant) or not isinstance(it.value, str):
            return None
        out.append(it.value)
    return out


def _candidates():
    """Every module-level container that is claiming to be the node vocabulary."""
    auth = _authority()
    found = []
    for root in ROOTS:
        for path in sorted(root.rglob("*.py")):
            try:
                tree = ast.parse(io.open(path, encoding="utf-8").read())
            except SyntaxError:
                continue
            for stmt in tree.body:  # module level ONLY
                if not isinstance(stmt, (ast.Assign, ast.AnnAssign)):
                    continue
                targets = stmt.targets if isinstance(stmt, ast.Assign) else [stmt.target]
                names = [t.id for t in targets if isinstance(t, ast.Name)]
                if not names:
                    continue
                members = _string_members(stmt.value)
                if members is None:
                    continue
                overlap = set(members) & auth
                if len(overlap) > len(auth) * MAJORITY:
                    found.append((str(path.relative_to(REPO)).replace("\\", "/"),
                                  names[0], tuple(members)))
    return found


def test_the_search_FINDS_the_copies_it_is_supposed_to_guard():
    """⛔⛔ THE NON-VACUITY CONTROL, AND IT IS THE POINT OF THE FILE.

    A derived census that finds nothing passes every other test here for the
    worst possible reason. This names the copies that were actually stale on
    2026-09-11 — including ``compute_graph.CANONICAL_KEYS``, the one with no rail
    — and fails if the walk stops seeing them, which is what a refactor that
    renames or relocates a copy looks like from here.
    """
    found = {(p, n) for p, n, _ in _candidates()}
    must_see = {
        ("api/services/ast_lint.py", "_CANONICAL_TYPES"),
        ("api/services/ast_freshness.py", "_CANONICAL_TYPES"),
        ("api/services/compute_graph.py", "CANONICAL_KEYS"),
        ("api/services/user_definitions.py", "_CANONICAL_KEYS"),
    }
    missing = must_see - found
    assert not missing, (
        f"the walk no longer sees {sorted(missing)} — either the copy moved (fix "
        f"this list) or the search broke (fix the search). Do not delete the entry.")
    assert len(found) >= len(must_see)


@pytest.mark.parametrize("path,name,members", _candidates(),
                         ids=lambda v: v if isinstance(v, str) else "")
def test_a_copy_of_the_node_vocabulary_IS_the_vocabulary(path, name, members):
    """Symmetric difference, both directions, by name."""
    auth = _authority()
    got = set(members)
    assert got == auth, (
        f"{path}::{name} has drifted from ast_interpret.NODE_TYPES.\n"
        f"  missing here : {sorted(auth - got) or '-'}\n"
        f"  extra here   : {sorted(got - auth) or '-'}\n"
        f"⛔ Fix the module, or delete the copy. Do not edit this test.")


def test_a_DECLARED_SUBSET_is_still_allowed_to_be_a_subset():
    """⭐ The threshold's own control.

    `ast_interpret.BIND_TIME_NODE_TYPES` is three of eleven deliberately. If the
    majority rule ever stopped exempting it, this file would be demanding that a
    documented subset become the whole vocabulary — and the next engineer would
    "fix" it by widening the subset, which would silently tell the conformance
    census that every node type is non-evaluable.
    """
    import sys
    sys.path.insert(0, str(REPO))
    from api.services import ast_interpret
    subset = set(ast_interpret.BIND_TIME_NODE_TYPES)
    auth = _authority()
    assert subset < auth, "the bind-time subset must be a STRICT subset"
    assert len(subset) <= len(auth) * MAJORITY, (
        "the declared subset now holds a majority of the vocabulary, so the "
        "search above will start demanding it be the whole thing. Re-think the "
        "threshold rather than widening the subset.")
