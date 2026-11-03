"""UCT Agent — SCHEMA-CONSTRAINED ARGS: the per-capability argument normalizer (Wave 2 W2-A3, 2026-11-03).

Live finding LT-3: four of Wave 1's new operator paths failed in production because the model's `args` came back
in a shape the strict schema check (turn.args_match) refuses — a value as a string where a number or boolean is
declared, an enum in another case, a singular key for a plural one, a lone value where a list is declared, an
argument the model added for itself. Every such plan died as "I couldn't fill in the details of one of the steps".

This module is the GENERAL mechanism, driven ONLY by the capability's own closed args schema (the manifest the
browser sent — nothing is named here): it coerces what can be made valid without changing its meaning, and
REFUSES, explicitly and with a reason, anything that cannot. It never invents a value, never drops a value the
member gave, never widens a schema. The result is still checked by turn.args_match (and again by the browser's
planner before anything runs).

  normalize_args(schema, args) -> (args, changes)        raises ArgsRefused(reason)

What it makes valid (each noted in `changes`, value-free):
  keys     exact → case / snake-camel-kebab fold ("sortField" → sort_field) → singular/plural ("symbol" →
           symbols) → one wrapped argument (the object's keys written at the top level) → a [{key, value}] list
           or a JSON string instead of an object; meta keys the model adds for itself (reason, note…) are dropped
  missing  a nullable argument → null; a non-nullable ARRAY → []; anything else → refused (never guessed)
  extra    an argument the schema does not declare → refused (it may carry intent nothing here can honour)
  values   string → number / integer ("90", "90%", "$10M", "1,000", "10k"), string → boolean (true/false, on/off,
           yes/no, enabled/disabled, 1/0), "null"/"none"/"" → null where null is allowed, number → string where
           only a string fits, enum case/space/underscore fold ("Cross Above" → cross_above), a scalar → [scalar]
           and "a, b" → ["a", "b"] for arrays, nested objects recursively, anyOf by the first branch that fits
  refused  a value no coercion makes valid ("fast" for a number, an enum value that is not offered)

`example_args(schema)` builds one valid example object from a schema for the catalog line, so the model sees the
exact shape it must write (W2-A3 part 3).
"""
from __future__ import annotations

import json
import re
from typing import Any

#: keys a model adds for its own bookkeeping — never arguments; dropped silently (noted)
META_KEYS = frozenset({"reason", "reasoning", "note", "notes", "explanation", "comment", "comments", "why",
                       "description", "_comment", "rationale", "thought", "thoughts"})
MAX_CHANGES = 24
_TRUE = frozenset({"true", "yes", "on", "enabled", "enable", "1", "y", "t"})
_FALSE = frozenset({"false", "no", "off", "disabled", "disable", "0", "n", "f"})
_NULLS = frozenset({"", "null", "none", "nil", "n/a"})
_NUM = re.compile(r"^\s*([-+]?)\$?\s*(\d[\d,]*(?:\.\d+)?|\.\d+)\s*(%|k|m|b|mm|bn|x)?\s*$", re.IGNORECASE)
_MULT = {"k": 1e3, "m": 1e6, "mm": 1e6, "b": 1e9, "bn": 1e9}
_KEY_VALUE_KEYS = (("key", "value"), ("name", "value"), ("setting", "value"), ("field", "value"), ("property", "value"))


class ArgsRefused(Exception):
    """The args cannot be made valid for this schema. `.reason` is a short, value-free sentence for the model /
    the log; the member's sentence stays UCT's fixed wording (turn._unreadable)."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


# ── helpers ──────────────────────────────────────────────────────────────────────────────────
def _types(spec: dict) -> list[str]:
    t = spec.get("type")
    return [t] if isinstance(t, str) else list(t or [])


def _fold(key: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(key).lower())


def _singular(key: str) -> str:
    if key.endswith("ies"):
        return key[:-3] + "y"
    if key.endswith("es") and key[:-2].endswith(("s", "x", "sh", "ch")):
        return key[:-2]
    if key.endswith("s") and not key.endswith("ss"):
        return key[:-1]
    return key


def _plural(key: str) -> str:
    if key.endswith("y") and not key.endswith(("ay", "ey", "oy", "uy")):
        return key[:-1] + "ies"
    if key.endswith(("s", "x", "sh", "ch")):
        return key + "es"
    return key + "s"


def _is_type(v: Any, t: str) -> bool:
    if t == "number":
        return isinstance(v, (int, float)) and not isinstance(v, bool)
    if t == "integer":
        return isinstance(v, int) and not isinstance(v, bool)
    if t == "string":
        return isinstance(v, str)
    if t == "boolean":
        return isinstance(v, bool)
    if t == "null":
        return v is None
    if t == "object":
        return isinstance(v, dict)
    if t == "array":
        return isinstance(v, list)
    return False


def _valid(spec: dict, v: Any) -> bool:
    """turn.args_match's own value rule (kept in step with turn._value_ok): type ∈ declared, enum, items."""
    if "anyOf" in spec and not spec.get("type"):
        return any(isinstance(b, dict) and _valid(b, v) for b in spec["anyOf"])
    ts = _types(spec)
    if ts and not any(_is_type(v, t) for t in ts):
        return False
    if "enum" in spec and v not in spec["enum"]:
        return False
    if isinstance(v, list) and isinstance(spec.get("items"), dict):
        return all(_valid(spec["items"], x) for x in v)
    if isinstance(v, dict) and isinstance(spec.get("properties"), dict) and spec.get("additionalProperties") is False:
        props = spec["properties"]
        if set(v) != set(props):
            return False
        return all(_valid(props[k], v[k]) for k in props)
    return True


def _number(s: str) -> float | None:
    m = _NUM.match(s)
    if not m:
        return None
    sign, body, suffix = m.group(1), m.group(2).replace(",", ""), (m.group(3) or "").lower()
    try:
        n = float(body)
    except ValueError:
        return None
    n *= _MULT.get(suffix, 1)
    return -n if sign == "-" else n


def _as_int(n: float) -> int | None:
    return int(n) if float(n).is_integer() else None


def _enum_fold(enum: list, v: Any):
    """The enum member `v` names after folding case, spaces, hyphens and underscores (strings), or a numeric string
    for a numeric member. Exactly one match, else None."""
    sv = str(v).strip()
    key = _fold(sv)
    hits = []
    for e in enum:
        if e is None:
            continue
        if isinstance(e, str) and _fold(e) in (key, _fold(_plural(sv)), _fold(_singular(sv))):
            hits.append(e)
        elif isinstance(e, bool):
            if (e and sv.lower() in _TRUE) or (not e and sv.lower() in _FALSE):
                hits.append(e)
        elif isinstance(e, (int, float)) and not isinstance(v, bool):
            n = _number(sv) if isinstance(v, str) else (v if isinstance(v, (int, float)) else None)
            if n is not None and float(n) == float(e):
                hits.append(e)
    return hits[0] if len(hits) == 1 else None


# ── values ───────────────────────────────────────────────────────────────────────────────────
def _union_literal(spec: dict, v: Any, path: str, changes: list[str]) -> Any:
    """A value for a UNION type (string | number | boolean — a setting's value): the exact words true / false become
    the boolean, and a purely numeric text becomes the number, when the union allows them. Nothing else moves
    ("off", "#2962ff", "30%" stay text: the capability's own check reads those)."""
    ts = _types(spec)
    if not isinstance(v, str) or len(ts) < 2 or spec.get("enum") is not None:
        return v
    s = v.strip()
    if "null" in ts and s.lower() in _NULLS:
        changes.append(f"{path}: empty read as null")
        return None
    if "boolean" in ts and s.lower() in ("true", "false"):
        changes.append(f"{path}: the word true/false read as the boolean")
        return s.lower() == "true"
    if ("number" in ts or "integer" in ts) and re.fullmatch(r"[-+]?\d+(?:\.\d+)?", s):
        changes.append(f"{path}: numeric text read as a number")
        n = float(s)
        return int(n) if n.is_integer() and "." not in s else n
    return v


def _coerce(spec: dict, v: Any, path: str, changes: list[str]) -> Any:
    """`v` made valid for `spec`, or ArgsRefused."""
    if _valid(spec, v):
        if isinstance(v, dict) and isinstance(spec.get("properties"), dict):
            return _normalize_object(spec, v, path, changes)        # still fold nested keys / note nothing
        return _union_literal(spec, v, path, changes)
    if "anyOf" in spec and not spec.get("type"):
        errors = []
        for b in spec["anyOf"]:
            if not isinstance(b, dict):
                continue
            try:
                return _coerce(b, v, path, changes)
            except ArgsRefused as e:
                errors.append(e.reason)
        raise ArgsRefused(f"{path}: none of its allowed forms fit")
    ts = _types(spec)
    enum = spec.get("enum")
    # enum first: the value may be one of the members in another spelling
    if enum is not None:
        hit = _enum_fold(enum, v) if v is not None and not isinstance(v, (dict, list)) else None
        if hit is not None and _valid(spec, hit):
            changes.append(f"{path}: read as the option it names")
            return hit
        if v is None and None in enum and "null" in ts:
            return None
        if isinstance(v, str) and v.strip().lower() in _NULLS and None in enum and "null" in ts:
            changes.append(f"{path}: empty read as null")
            return None
        opts = ", ".join(str(e) for e in enum if e is not None)[:200]
        raise ArgsRefused(f"{path}: not one of the options ({opts})")
    # null
    if "null" in ts and (v is None or (isinstance(v, str) and v.strip().lower() in _NULLS)):
        if v is not None:
            changes.append(f"{path}: empty read as null")
        return None
    # boolean
    if "boolean" in ts:
        if isinstance(v, str) and v.strip().lower() in _TRUE | _FALSE:
            changes.append(f"{path}: word read as true/false")
            return v.strip().lower() in _TRUE
        if isinstance(v, (int, float)) and not isinstance(v, bool) and v in (0, 1):
            changes.append(f"{path}: 1/0 read as true/false")
            return bool(v)
    # numbers
    if "integer" in ts or "number" in ts:
        n = None
        if isinstance(v, str):
            n = _number(v)
            if n is not None:
                changes.append(f"{path}: text read as a number")
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            n = float(v)
        if n is not None:
            if "integer" in ts:
                i = _as_int(n)
                if i is not None:
                    return i
                if "number" in ts:
                    return n
                raise ArgsRefused(f"{path}: must be a whole number")
            return int(n) if float(n).is_integer() and isinstance(v, str) and "." not in v else n
    # strings: a number or true/false where text is declared is a different kind of thing (a ticker, a name, an
    # id) — refused, never rewritten (turn.py pins: ["NVDA", 7] is not a list of tickers)
    if "string" in ts and (isinstance(v, (int, float)) or isinstance(v, bool)):
        raise ArgsRefused(f"{path}: must be text")
    # arrays
    if "array" in ts:
        items = spec.get("items") if isinstance(spec.get("items"), dict) else {}
        if isinstance(v, str):
            parsed = _try_json(v)
            if isinstance(parsed, list):
                changes.append(f"{path}: JSON text read as a list")
                return _coerce(spec, parsed, path, changes)
            if _types(items) in (["string"], []) and "," in v:
                changes.append(f"{path}: comma-separated text read as a list")
                return _coerce(spec, [s.strip() for s in v.split(",") if s.strip()], path, changes)
        if isinstance(v, list):
            return [_coerce(items, x, f"{path}[{i}]", changes) if items else x for i, x in enumerate(v)]
        if isinstance(v, dict) and _pair_props(items) and len(v) > 1:
            changes.append(f"{path}: a map read as key/value pairs")
            return _coerce(spec, [{"key": k, "value": x} for k, x in v.items()], path, changes)
        if v is not None and (not isinstance(v, dict) or "object" in _types(items)):
            changes.append(f"{path}: single value wrapped in a list")
            return [_coerce(items, v, f"{path}[0]", changes) if items else v]
    # objects
    if "object" in ts:
        if isinstance(v, str):
            parsed = _try_json(v)
            if isinstance(parsed, (dict, list)):
                changes.append(f"{path}: JSON text read as an object")
                return _coerce(spec, parsed, path, changes)
        if isinstance(v, list):
            kv = _pairs_to_object(v)
            if kv is not None:
                changes.append(f"{path}: key/value pairs read as an object")
                return _coerce(spec, kv, path, changes)
        if isinstance(v, dict):
            pair = _pair_props(spec)
            if pair and len(v) == 1 and not any(str(k) in (spec.get("properties") or {}) for k in v):
                (k, x), = v.items()
                changes.append(f"{path}: a one-entry map read as a key/value pair")
                return _normalize_object(spec, {pair[0]: str(k), pair[1]: x}, path, changes)
            return _normalize_object(spec, v, path, changes)
    want = " or ".join(ts) or "a value"
    raise ArgsRefused(f"{path}: must be {want}")


def _pair_props(spec: Any) -> tuple[str, str] | None:
    """(key prop, value prop) when `spec` is an object of exactly a name and a value (key/value, name/value…)."""
    if not isinstance(spec, dict) or "object" not in _types(spec):
        return None
    props = spec.get("properties") or {}
    for kk, vk in _KEY_VALUE_KEYS:
        if set(props) == {kk, vk}:
            return kk, vk
    return None


def _try_json(s: str):
    s = s.strip()
    if not s or s[0] not in "[{":
        return None
    try:
        return json.loads(s)
    except ValueError:
        return None


def _pairs_to_object(v: list) -> dict | None:
    """[{key, value}, …] (or name/setting/field/property + value) → {key: value}; None when it is not that shape."""
    if not v or not all(isinstance(x, dict) for x in v):
        return None
    out = {}
    for x in v:
        for kk, vk in _KEY_VALUE_KEYS:
            if kk in x and vk in x and len(x) == 2 and isinstance(x[kk], str):
                out[x[kk]] = x[vk]
                break
        else:
            return None
    return out


# ── objects ──────────────────────────────────────────────────────────────────────────────────
def _match_keys(props: dict, given: dict, path: str, changes: list[str]) -> tuple[dict, list[str]]:
    """Each given key → the declared key it names (exact, folded, singular/plural), meta keys dropped.
    Returns (renamed args, extra keys that name nothing)."""
    folded = {_fold(k): k for k in props}
    out: dict[str, Any] = {}
    extra: list[str] = []
    for k, v in given.items():
        ks = str(k)
        target = None
        if ks in props:
            target = ks
        elif _fold(ks) in folded:
            target = folded[_fold(ks)]
        elif _fold(_plural(ks)) in folded:
            target = folded[_fold(_plural(ks))]
        elif _fold(_singular(ks)) in folded:
            target = folded[_fold(_singular(ks))]
        if target is None:
            if ks.lower() in META_KEYS:
                changes.append(f"{path}{ks}: dropped (not an argument)")
                continue
            extra.append(ks)
            continue
        if target in out:
            raise ArgsRefused(f"{path}{target}: given twice")
        if target != ks:
            changes.append(f"{path}{ks}: read as {target}")
        out[target] = v
    return out, extra


def _wrap_lone(props: dict, given: dict) -> dict | None:
    """The one declared argument is an object (or has an object form) and the model wrote that object's keys at
    the top level → wrapped. None when it is not that case."""
    if len(props) != 1 or not given:
        return None
    (name, spec), = props.items()
    if name in given:
        return None
    forms = [b for b in (spec.get("anyOf") or [spec]) if isinstance(b, dict)]
    gk = {_fold(k) for k in given}
    for f in forms:
        if f.get("type") == "object" and {_fold(k) for k in (f.get("properties") or {})} == gk:
            return {name: given}
    return None


def _map_form(props: dict, given: dict) -> dict | None:
    """A two-argument action whose first argument is an ENUM of names and whose second is its value (a setting and
    its value) written as a one-entry map — {"grid.visible": false}, or {"settings": {"grid.visible": false}} — →
    {setting: "grid.visible", value: false}. None when it is not that case."""
    if len(props) != 2 or len(given) != 1:
        return None
    (k1, s1), (k2, s2) = props.items()
    name_prop, value_prop = (k1, k2) if isinstance(s1.get("enum"), list) and not isinstance(s2.get("enum"), list) else \
        ((k2, k1) if isinstance(s2.get("enum"), list) and not isinstance(s1.get("enum"), list) else (None, None))
    if name_prop is None:
        return None
    enum = [e for e in props[name_prop]["enum"] if isinstance(e, str)]
    (gk, gv), = given.items()
    gk = str(gk)
    # {"settings": {"grid.visible": false}} — the enum argument's name (or its plural) holding the map
    if _fold(gk) in (_fold(name_prop), _fold(_plural(name_prop))) and isinstance(gv, dict) and len(gv) == 1:
        (gk, gv), = gv.items()
        gk = str(gk)
    hits = [e for e in enum if _fold(e) == _fold(gk)]
    if len(hits) != 1 or isinstance(gv, (dict, list)):
        return None
    return {name_prop: hits[0], value_prop: gv}


def _normalize_object(spec: dict, given: dict, path: str, changes: list[str]) -> dict:
    props = spec.get("properties") or {}
    prefix = f"{path}." if path else ""
    wrapped = _wrap_lone(props, given)
    if wrapped is not None:
        changes.append(f"{prefix}{next(iter(props))}: its keys were written at the top level — wrapped")
        given = wrapped
    mapped = _map_form(props, given) if not any(str(k) in props for k in given) else None
    if mapped is not None:
        changes.append(f"{prefix}{'/'.join(props)}: a name→value map read as the two arguments")
        given = mapped
    renamed, extra = _match_keys(props, given, prefix, changes)
    if extra:
        raise ArgsRefused(f"unexpected argument{'s' if len(extra) > 1 else ''} {', '.join(sorted(extra))[:120]} — only {', '.join(props) or 'no arguments'} exist here")
    out: dict[str, Any] = {}
    for k, pspec in props.items():
        p = f"{prefix}{k}"
        if k not in renamed:
            ts = _types(pspec)
            if "null" in ts or (pspec.get("enum") is not None and None in pspec["enum"] and "null" in ts):
                out[k] = None
                changes.append(f"{p}: left out, read as null")
            elif ts == ["array"]:
                out[k] = []
                changes.append(f"{p}: left out, read as an empty list")
            else:
                raise ArgsRefused(f"missing {p}")
            continue
        out[k] = _coerce(pspec, renamed[k], p, changes)
    return out


def normalize_args(schema: dict, args: Any) -> tuple[dict, list[str]]:
    """The model's `args` made valid for the capability's closed schema → (args, changes), or ArgsRefused.
    `changes` are short value-free notes of what was read differently (at most MAX_CHANGES), for the log / the
    model; an empty list means the args were already exactly as declared."""
    if not isinstance(schema, dict) or schema.get("type") != "object":
        raise ArgsRefused("the action has no readable schema")
    changes: list[str] = []
    a = args
    if a is None:
        a = {}
    if isinstance(a, str):
        parsed = _try_json(a)
        if not isinstance(parsed, (dict, list)):
            raise ArgsRefused("args were not JSON")
        changes.append("args: JSON text read as an object")
        a = parsed
    if isinstance(a, list):
        kv = _pairs_to_object(a)
        if kv is None:
            # a bare list for a one-argument action whose argument is a list
            props = schema.get("properties") or {}
            only = next(iter(props.values())) if len(props) == 1 else {}
            forms = [b for b in (only.get("anyOf") or [only]) if isinstance(b, dict)]
            if len(props) == 1 and any("array" in _types(f) for f in forms):
                kv = {next(iter(props)): a}
                changes.append(f"{next(iter(props))}: a bare list read as that argument")
            else:
                raise ArgsRefused("args must be an object")
        else:
            changes.append("args: key/value pairs read as an object")
        a = kv
    if not isinstance(a, dict):
        raise ArgsRefused("args must be an object")
    out = _normalize_object(schema, a, "", changes)
    return out, changes[:MAX_CHANGES]


# ── the example a catalog line shows ─────────────────────────────────────────────────────────
_EXAMPLE_BY_NAME = {
    "symbol": "NVDA", "symbols": ["NVDA", "AMD"], "ticker": "NVDA", "date": "2026-10-15", "start": "2026-09-01",
    "end": "2026-10-15", "compare_date": "2026-09-30", "name": "Swing Ideas", "color": "#2962ff", "up": "#26a69a",
    "down": "#ef5350", "price": 150, "threshold": 70, "level": 100, "query": "nvda earnings reaction", "text": "note",
    "note": "watch the gap", "message": "a 20 EMA crossover indicator", "request": "a 20 EMA crossover indicator",
    "count": 2, "top": 5, "show": 10, "limit": 5, "sessions": 20, "x": 0, "y": 0, "w": 12, "h": 10, "by": 2,
    "as": None, "within": None, "instance": "i1", "widget": "w1", "tab": "t1", "layout": "l1", "screen": "s1",
    "list": "wl1", "drawing": "d1", "pane": "p1", "defId": "movingAverage", "from": "c1", "a": "w1", "b": "w2",
    "chart": "c1", "field": "price", "max": None, "values": None, "value": 1, "setting": None, "key": None,
}


def _example_value(spec: dict, name: str = "", depth: int = 0) -> Any:
    if depth > 4:
        return None
    if "anyOf" in spec and not spec.get("type"):
        branches = [b for b in spec["anyOf"] if isinstance(b, dict)]
        return _example_value(branches[0], name, depth + 1) if branches else None
    enum = [e for e in (spec.get("enum") or []) if e is not None]
    ts = _types(spec)
    if enum:
        return enum[0]
    if name in _EXAMPLE_BY_NAME and _EXAMPLE_BY_NAME[name] is not None and any(_is_type(_EXAMPLE_BY_NAME[name], t) for t in ts):
        return _EXAMPLE_BY_NAME[name]
    if "null" in ts:
        return None                                   # an optional argument's example is null: the shape, not a guess
    if "object" in ts:
        return {k: _example_value(v, k, depth + 1) for k, v in (spec.get("properties") or {}).items()}
    if "array" in ts:
        items = spec.get("items") if isinstance(spec.get("items"), dict) else None
        if name in _EXAMPLE_BY_NAME and isinstance(_EXAMPLE_BY_NAME[name], list):
            return _EXAMPLE_BY_NAME[name]
        return [_example_value(items, _singular(name), depth + 1)] if items else []
    if "string" in ts:
        return "…"
    if "integer" in ts:
        return 1
    if "number" in ts:
        return 1
    if "boolean" in ts:
        return True
    return None


def example_args(schema: dict) -> dict:
    """ONE valid example object for a capability's closed args schema (enum → its first option, a name UCT knows →
    a plausible placeholder, nullable → null, arrays → one item). Built so the model sees the exact shape."""
    props = (schema or {}).get("properties") or {}
    out = {}
    for k, spec in props.items():
        ts = _types(spec)
        v = _example_value(spec, k)
        if v == "…" and "null" in ts:
            v = None
        out[k] = v
    return out
