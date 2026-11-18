"""SETTINGS PARITY (2a) - a folded Pine parameter is a chart setting, per instance. Server twin.

The Python twin of ``app/src/components/chart/engine/paramInputs.js``, held equal by
``tests/fixtures/ast/param_inputs_parity.json`` (written by the JS suite, read by both).

A Pine translation folds a window length into its tree as a literal and records every
literal it became (``compute.paramManifest``: per parameter, ``{treeIndex, astPath}``). The
member's chart now declares each ATTACHED parameter as an ``int`` / ``float`` setting keyed
``param<N>`` and computes the tree with the instance's value written into those literals.
An alert armed from that chart stores the instance's settings in ``params_json``; this
module lets the alert lane evaluate the SAME specialised tree, so the alert and the chart
answer one question. A value the bounds refuse is refused by name, never evaluated.
"""
from __future__ import annotations

import copy
import math
from typing import Any, Mapping, Optional

from api.services.param_manifest import _literal_value, _walk

PARAM_ID_PREFIX = "__uct_param_"
PARAM_INPUT_PREFIX = "param"
#: The guard a refused parameter setting carries (the JS lane's ``PARAM_SETTING_GUARD``).
PARAM_SETTING_GUARD = "setting:param-refused"


def param_input_key(param_id: Any) -> Optional[str]:
    """``__uct_param_1003`` -> ``param1003``; anything else -> None."""
    s = str(param_id)
    return PARAM_INPUT_PREFIX + s[len(PARAM_ID_PREFIX):] if s.startswith(PARAM_ID_PREFIX) else None


def _tree(definition: Mapping, tree_index: Any) -> Any:
    compute = definition.get("compute") or {}
    if tree_index is None:
        return compute.get("ast")
    trees = compute.get("trees") or {}
    if isinstance(trees, list):
        return trees[tree_index] if isinstance(tree_index, int) and 0 <= tree_index < len(trees) else None
    return trees.get(tree_index) if isinstance(trees, Mapping) else None


def attached_value(definition: Mapping, entry: Mapping) -> Optional[float]:
    """The one value every locator reads, or None (detached, not a number, or disagreeing)."""
    locators = entry.get("locators") if isinstance(entry, Mapping) else None
    if not isinstance(locators, list) or not locators:
        return None
    value = None
    for loc in locators:
        tree = _tree(definition, loc.get("treeIndex"))
        node = _walk(tree, list(loc.get("astPath") or [])) if tree is not None else None
        v = _literal_value(node)
        if v is None or not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(float(v)):
            return None
        if value is None:
            value = v
        elif value != v:
            return None
    return value


def param_input_specs(definition: Mapping) -> list:
    """The settings a document's attached parameters become, in manifest order."""
    compute = definition.get("compute") if isinstance(definition, Mapping) else None
    if not isinstance(compute, Mapping) or compute.get("kind") != "ast":
        return []
    manifest = compute.get("paramManifest")
    if not isinstance(manifest, Mapping):
        return []
    taken = {str(i.get("key")) for i in (definition.get("inputs") or [])
             if isinstance(i, Mapping) and not i.get("fromParam")}
    out = []
    for pid, entry in manifest.items():
        if not isinstance(entry, Mapping) or entry.get("type") not in ("int", "float"):
            continue
        key = param_input_key(pid)
        if not key or key in taken:
            continue
        value = attached_value(definition, entry)
        if value is None or (entry.get("type") == "int" and not float(value).is_integer()):
            continue
        title = entry.get("title")
        spec = {"key": key, "label": title if isinstance(title, str) and title else key,
                "type": entry.get("type"), "default": value, "fromParam": pid}
        for k in ("min", "max", "step"):
            v = entry.get(k)
            if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(float(v)):
                spec[k] = v
        out.append(spec)
    return out


def param_value_refusal(spec: Mapping, value: Any) -> Optional[str]:
    """Why ``value`` cannot be computed for ``spec``, or None (the instance validator's rules)."""
    label = spec.get("label")
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(float(value)):
        return f"{label} must be a number"
    if spec.get("type") == "int" and not float(value).is_integer():
        return f"{label} must be a whole number"
    if isinstance(spec.get("min"), (int, float)) and value < spec["min"]:
        return f"{label} must be at least {spec['min']}"
    if isinstance(spec.get("max"), (int, float)) and value > spec["max"]:
        return f"{label} must be at most {spec['max']}"
    return None


def _write(node: Any, path: list, value: Any) -> None:
    """In-place write of ``value`` at ``path`` (the caller passes a deep copy)."""
    for step in path[:-1]:
        node = node[step]
    last = path[-1]
    leaf = node[last]
    if isinstance(node, dict) and node.get("type") == "offset" and last == "value" and isinstance(leaf, (int, float)):
        node[last] = value
    else:
        leaf["value"] = value


def specialize(definition: Mapping, params: Optional[Mapping]) -> tuple:
    """``(definition, None)`` with the instance's moved parameter settings written into their
    literals (the same object when nothing moved), or ``(None, sentence)`` for a value the
    bounds refuse. Values compare as numbers (an alert row's JSON holds ``30`` or ``30.0``)."""
    specs = param_input_specs(definition)
    if not specs or not isinstance(params, Mapping):
        return definition, None
    moved = []
    for spec in specs:
        if spec["key"] not in params:
            continue
        v = params[spec["key"]]
        if v is None:
            continue
        why = param_value_refusal(spec, v)
        if why:
            return None, why
        if float(v) == float(spec["default"]):
            continue
        moved.append((spec, int(v) if spec["type"] == "int" else float(v)))
    if not moved:
        return definition, None
    out = copy.deepcopy(dict(definition))
    compute = out["compute"]
    # ⭐⭐ A NULL `treeIndex` NAMES THE SCAN PLOT'S TREE, and a multi-tree document runs that plot from
    # `trees[scanPlot]` — mirrors `paramInputs.js::specializeParams`. Written there too wherever it holds
    # the same literal at that path (never blind), whether or not it is the very object `ast` is (a
    # materialised graph aliases them; a JSON-loaded document does not).
    trees = compute.get("trees")
    scan = compute.get("scanPlot")
    scan_tree = trees.get(scan) if isinstance(trees, dict) and isinstance(scan, str) else None
    for spec, v in moved:
        for loc in compute["paramManifest"][spec["fromParam"]]["locators"]:
            ti = loc.get("treeIndex")
            path = list(loc.get("astPath") or [])
            if ti is None:
                if scan_tree is not None and scan_tree is not compute["ast"] and _same_literal_at(scan_tree, compute["ast"], path):
                    _write(scan_tree, path, v)
                _write(compute["ast"], path, v)
            else:
                _write(compute["trees"][ti], path, v)
    return out, None


def _same_literal_at(a: Any, b: Any, path: list) -> bool:
    """Do two trees hold the same literal at ``path`` (both a plain number there, equal)?"""
    x = _literal_value(_walk(a, path))
    y = _literal_value(_walk(b, path))
    return x is not None and y is not None and x == y
