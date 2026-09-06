"""Parameter-manifest save-time enforcement (Track F v1, DEC-006).

Promoted from a 15-point pre-implementation spike (all 15 conditions proven
against real `save()`/`alert_user_series` code — see
`TRACK_F_PARAMETER_ADR_V2_2.md` §6 and `TRACK_F_SPIKE_REPORT_V1.md` for the
evidence) with NO logic changes at promotion — the owner's own instruction
was "do not rewrite proven logic merely for aesthetics." Only the module's
name, its docstring's framing, and `user_definitions.py`'s import were
updated. `tests/test_param_manifest.py` (renamed from
`test_param_manifest_spike.py`, same 21 assertions, unchanged) is the
permanent regression suite for this module — not a spike fixture to retire.

This module is additive and INERT for every definition that does not carry
a `compute.paramManifest` key: ordinary saves are byte-for-byte unaffected.
It implements ONLY the server-side enforcement half of Track F — the Pine
translator (`app/src/components/chart/engine/ast/pine.js`) is what DECIDES
which Pine `input.int`/`input.float` declarations become eligible
parameters and builds the manifest a save submits; this module's job is to
verify and protect a submitted manifest, never to invent one.

⛔⛔ ARCHITECTURE CORRECTION FOUND DURING THE SPIKE, NOT ASSUMED IN THE ADR.
V2.1/V2.2 assumed server-side reconciliation would re-parse `compute.source`
to find `let` bindings. Verified directly against this module's own file
(the comment block above `_PLOT_KEY_RE`, 2026-09 vintage): "there is exactly
one parser and it is in JS (D-A1)... a Python parser... would put a SECOND
parser on one grammar, which is the defect this repo names most often." A
server-side `let`-reparse would be exactly that defect. This module does NOT
parse `compute.source` at all. Instead, per this same file's own already-
preferred idiom ("make the knowing side stamp its answer rather than making
a second side re-derive it"), a parameter's live value is read by walking
the ALREADY-PARSED, ALREADY-SUBMITTED `compute.ast` (or `compute.trees[k]`
for a multi-tree document) at a stored structural path (`astPath`) — pure
JSON traversal, not parsing, of data this service already receives and
already interprets via `ast_interpret.py`.

⛔ NO SPECIAL `let __uct_param_1 = 14` SYNTAX EXISTS ANYWHERE. `compute.
source`/`compute.sources[k]` for a parameterized definition is ORDINARY
printed UCT-DSL text — `rsi(close, 14)`, nothing more — byte-identical in
shape to a definition with no adjustable parameters at all. This was ADR V2's
original idea and it does not survive contact with how the frontend actually
edits a parameter (`pine.js`'s own comment on `Resolver.inputValues`: "the
tree still holds a literal... the knob does not live IN the tree; it lives on
the DOCUMENT, and moving it RE-TRANSLATES"). A parameter edit mutates the
literal at each locator's `astPath` directly, re-derives `compute.source[k]`
via the existing `printFormula(ast)` compiler, and re-parses that regenerated
text through the SAME ordinary formula door every hand-typed edit already
goes through — never a second parser, and never a bespoke `let`-substitution
convention this file or any other would have to keep in sync. Keeping
`compute.source` consistent with `compute.ast` after such an edit is the
CLIENT's job (the one lane with a parser), exactly mirroring the already-
disclosed, already-accepted `sources[k]`/`treesHash` asymmetry this same file
names for an unrelated reason — this module does not attempt to close that
pre-existing gap and was never asked to.

Schema this module expects, additively, inside an existing `compute` dict::

    "compute": {
      "kind": "ast", "ast": {...}, "source": "...",   # all pre-existing
      "paramManifest": {
        "__uct_param_1": {
          "sourceName": "len", "title": "RSI Length", "type": "int",
          "default": 14, "min": 1, "max": 200, "step": 1, "options": null,
          "locators": [{"treeIndex": null, "astPath": ["args", 1]}]
        }
      }
    }

``treeIndex: null`` means "the single-tree v1 document's own `compute.ast`";
a string names a key of a v2 `compute.trees` document. ``astPath`` is a list
of dict-keys / list-indices walked from the tree root.

Derived (never stored as a second authority for current value — computed
fresh by ``reconcile()`` every time, exactly as ADR V2.2 S3(B) requires)::

    "compute": { ..., "paramState": {
      "__uct_param_1": {"state": "attached", "value": 14, "reason": None}
    }}
"""
from __future__ import annotations

from typing import Any, Optional

# The five states named in the ADR (V2.1 S4, V2.2 SS1-2).
ATTACHED = "attached"
DETACHED = "detached"
PARTIALLY_DETACHED = "partially_detached"
CONFLICTED = "conflicted"
NON_LITERAL = "non_literal"

#: Fields that are immutable import-time metadata (ADR V2.2 S3(A)). This is
#: the ENTIRE manifest entry minus nothing — there is no mutable field on a
#: manifest entry; "current value" lives only in the tree, never here.
_IMMUTABLE_FIELDS = ("sourceName", "title", "type", "default", "min", "max",
                     "step", "options", "locators")


class ParamManifestRejected(ValueError):
    """A save must not proceed. Callers treat this exactly like any other
    ValueError this module already raises (`_save_or_400` already converts
    ValueError to a 400 with this exception's own message)."""


def _tree_for(definition: dict, tree_index: Optional[str]) -> Any:
    compute = definition.get("compute") or {}
    if tree_index is None:
        return compute.get("ast")
    trees = compute.get("trees") or {}
    return trees.get(tree_index)


def _walk(tree: Any, path: list) -> Any:
    """Pure JSON traversal — never a parser. Returns None if the path does
    not resolve (a detached/removed binding looks exactly like this)."""
    node = tree
    for step in path:
        if isinstance(step, int):
            if not isinstance(node, list) or step >= len(node) or step < 0:
                return None
            node = node[step]
        else:
            if not isinstance(node, dict) or step not in node:
                return None
            node = node[step]
    return node


def _literal_value(node: Any):
    """A resolved AST node's value IF it is a plain numeric literal, else
    None. Two shapes both count, per `closedTable.json::_no_offset`'s own
    grammar: a `{"type": "num", "value": X}` node (an ordinary argument
    position, e.g. a call's window/length arg), OR a BARE int/float (an
    `offset` node's own `value` field IS the literal directly — `{"type":
    "offset", "value": 5, "args": [...]}`, no wrapping `num` node — so a
    locator pointing at an offset's index resolves to a raw number, not a
    dict, and must be accepted the same way). `_no_offset`'s "the offset is
    a constant" guarantee is exactly why this second shape is safe to treat
    as a literal: it is one, by construction, never a computed expression."""
    if isinstance(node, dict) and node.get("type") == "num":
        v = node.get("value")
    elif isinstance(node, (int, float)):
        v = node
    else:
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return v


def _type_ok(value, decl_type: str) -> bool:
    if isinstance(value, bool):
        return False
    if decl_type == "int":
        return isinstance(value, int) or (isinstance(value, float) and value.is_integer())
    if decl_type == "float":
        return isinstance(value, (int, float))
    if decl_type == "bool":
        # Track F v1.1 (2026-09-06). No genuine Python/JS `bool` ever reaches
        # this check — `_literal_value` already excludes `isinstance(v, bool)`
        # before this function is called, because `pine.js::resolveInput`
        # folds a Pine `input.bool`/bare `input(true/false)` to a plain
        # `{"type":"num","value":0|1}` node, never a JSON `true`/`false`
        # literal (see that module's own "NUMERIC bucket" comment). So the
        # value here is always a real int/float, and the ONLY thing this
        # type actually restricts, beyond `int`'s own whole-number check, is
        # the DOMAIN: exactly 0 or 1, never an arbitrary integer. Rejects a
        # crafted `2`, `-1`, or `0.5` the same way `_validate_bounds`' own
        # min/max would, but as a TYPE fact rather than a bound one, since a
        # boolean has no author-declared range to violate.
        return (isinstance(value, int) or (isinstance(value, float) and value.is_integer())) \
            and int(value) in (0, 1)
    return False


def _canonicalize_manifest(prev_manifest: dict, submitted_manifest: dict,
                            is_fresh_creation: bool) -> dict:
    """ADR V2.2 S4 + the owner's 15th condition, both enforced here.

    - An id ALSO in `prev_manifest`: the PRIOR record wins, verbatim, no
      matter what the client submitted for it — closes the "widen my own
      bounds" bypass (ADR S4).
    - An id NOT in `prev_manifest`:
        * `is_fresh_creation` (prev is None — a brand-new definition):
          trust the client's submission. This is the one honest,
          necessarily-client-side trust boundary (Pine translation is
          client-side and already authoritative for every save).
        * otherwise (an EDIT to an EXISTING definition): REJECTED outright
          — condition 15. New logical parameter identities may only be
          established at creation time; an ordinary edit can never mint one,
          regardless of how plausible its submitted metadata looks.
    """
    out: dict = {}
    for pid, entry in (submitted_manifest or {}).items():
        if pid in prev_manifest:
            out[pid] = {k: prev_manifest[pid].get(k) for k in _IMMUTABLE_FIELDS}
        elif is_fresh_creation:
            if not isinstance(entry, dict):
                raise ParamManifestRejected(
                    f"paramManifest.{pid}: expected an object, got {type(entry).__name__}")
            out[pid] = {k: entry.get(k) for k in _IMMUTABLE_FIELDS}
        else:
            raise ParamManifestRejected(
                f"paramManifest.{pid}: refused. This logical parameter id does not exist on "
                f"the saved definition being edited, and an ordinary save may never introduce "
                f"a new adjustable-parameter identity — new parameters may only be established "
                f"by a fresh import (creating a new definition), never by editing an existing "
                f"one. (ADR V2.2, owner condition 15.)"
            )
    # Any id present ONLY in prev_manifest (not resubmitted) is simply not
    # carried forward — a member's edit that dropped the manifest for a
    # parameter no longer used is not, by itself, an error; it is exactly
    # the "formula rewritten to not need it" row of the ADR's reconciliation
    # table, and the tree's own validity (does anything still reference a
    # missing binding) is judged by the ordinary translate/analyze pipeline,
    # not by this function.
    return out


def reconcile(definition: dict, canonical_manifest: dict) -> dict:
    """The derived state (ADR V2.2 S3(B)) — recomputed fresh, never trusted
    from a prior save. Reads ONLY the already-submitted `definition`'s
    trees, via plain JSON traversal (see module docstring)."""
    state: dict = {}
    for pid, entry in canonical_manifest.items():
        locators = entry.get("locators") or []
        values = []
        any_detached = False
        any_non_literal = False
        for loc in locators:
            tree = _tree_for(definition, loc.get("treeIndex"))
            node = _walk(tree, loc.get("astPath") or [])
            if node is None:
                any_detached = True
                continue
            v = _literal_value(node)
            if v is None:
                any_non_literal = True
                continue
            values.append(v)
        n = len(locators)
        if n == 0:
            state[pid] = {"state": DETACHED, "value": None,
                          "reason": "this parameter declares no binding locations"}
        elif any_non_literal:
            state[pid] = {"state": NON_LITERAL, "value": None,
                          "reason": "this input's binding is no longer a plain number and "
                                    "can't be shown as a slider"}
        elif len(values) == 0:
            state[pid] = {"state": DETACHED, "value": None,
                          "reason": "this control's underlying binding was removed or renamed"}
        elif any_detached:
            state[pid] = {"state": PARTIALLY_DETACHED, "value": None,
                          "reason": f"only {len(values)} of {n} of this control's bindings "
                                    f"still exist — it has been disabled rather than shown "
                                    f"partially working"}
        elif len(set(values)) > 1:
            state[pid] = {"state": CONFLICTED, "value": None,
                          "reason": f"this control's bindings disagree ({sorted(set(values))}) "
                                    f"across the trees it appears in — edit each tree directly, "
                                    f"or use the control once it's reconciled"}
        else:
            state[pid] = {"state": ATTACHED, "value": values[0], "reason": None}
    return state


def _validate_bounds(pid: str, entry: dict, value) -> None:
    decl_type = entry.get("type")
    if decl_type in ("int", "float", "bool") and not _type_ok(value, decl_type):
        raise ParamManifestRejected(
            f"paramManifest.{pid}: must be {decl_type}, got {value!r}")
    # ⛔ A `bool` PARAMETER HAS NO SEPARATE min/max TO ALSO CHECK. Its whole
    # domain (0/1) is already enforced above, by TYPE — `resolveInput` never
    # emits `minval`/`maxval` for a Pine `input.bool`/bare boolean `input()`
    # (there is no such Pine argument for either), so `entry.get("min"/"max")`
    # would always be `None` here anyway; the early return simply makes that
    # fact explicit rather than relying on the min/max checks below to be
    # silently inert for this type, the same way `options` short-circuits
    # for an enum'd parameter two lines down.
    if decl_type == "bool":
        return
    options = entry.get("options")
    if options is not None:
        if value not in options:
            raise ParamManifestRejected(
                f"paramManifest.{pid}: {value!r} is not one of the declared options {options!r}")
        return  # an enum'd parameter has no separate min/max to also check
    lo, hi = entry.get("min"), entry.get("max")
    if lo is not None and value < lo:
        raise ParamManifestRejected(f"paramManifest.{pid}: must be >= {lo}, got {value!r}")
    if hi is not None and value > hi:
        raise ParamManifestRejected(f"paramManifest.{pid}: must be <= {hi}, got {value!r}")


def apply(definition: dict, prev_definition: Optional[dict]) -> dict:
    """The ONE entry point `save()` calls. Mutates nothing in place; returns
    `definition` unchanged if it carries no `paramManifest` at all (the inert
    path every ordinary, non-parameterized definition takes). Raises
    `ParamManifestRejected` (a ValueError) to refuse the whole save — the
    router's existing `_save_or_400` already turns any ValueError from this
    module into a 400, exactly as it does for every other refusal `save()`
    can raise.
    """
    compute = definition.get("compute") or {}
    submitted_manifest = compute.get("paramManifest")
    if submitted_manifest is None:
        return definition
    if not isinstance(submitted_manifest, dict):
        raise ParamManifestRejected(
            f"compute.paramManifest: expected an object, got {type(submitted_manifest).__name__}")

    is_fresh_creation = prev_definition is None
    prev_manifest = ((prev_definition or {}).get("compute") or {}).get("paramManifest") or {}

    canonical = _canonicalize_manifest(prev_manifest, submitted_manifest, is_fresh_creation)
    state = reconcile(definition, canonical)

    for pid, s in state.items():
        if s["state"] == ATTACHED:
            _validate_bounds(pid, canonical[pid], s["value"])

    definition = dict(definition)
    definition["compute"] = dict(compute)
    definition["compute"]["paramManifest"] = canonical
    definition["compute"]["paramState"] = state
    return definition
