"""Server-side validation of a stored definition's ``inputs[]`` — the knobs.

⭐ WHY THIS EXISTS. ``user_definitions.save`` re-applies ``defSchema``'s COMPUTE
rules (``validate_v2``) at the last door, because the browser's validation is a
property of one client at one version. Until this module, ``inputs[]`` had no
such door: a client could store ``{"key": "close"}``, a duplicate key, a key
with a space in it, an ``int`` whose default is the string ``"14"``, or no
default at all — and every reader downstream would then meet it:

* ``ast_interpret.interpret`` RAISES on an input that shadows a table name
  (``the input 'close' shadows a table name``) — inside the alert evaluator's
  per-alert handler, where the member who armed it never sees the sentence;
* ``alert_user_series._inputs_for`` silently drops a non-number default, so a
  knob the chart draws with is a knob the alert never receives;
* ``ast_lint.declared_inputs`` widens the lint scope by every declared key, so
  a forged key changes a repaint badge.

⛔ THE RULES ARE ``defSchema.validateInput`` / ``validateInputValue`` /
``validateActiveWhen``, MIRRORED, NOT INVENTED — plus ONE the browser applies in
a different place: a key may not shadow a name the closed table computes
(``builderInputs.js`` refuses it at the sheet: "declaring it would shadow the
real column"; both interpreters raise on it). A document the shipped client
builds therefore passes this door unchanged; the door exists for the document
that did NOT come from the shipped client.

⛔ THE VOCABULARY IS DERIVED, NOT RETYPED, WHERE A FILE HOLDS IT. The table
names come from ``ast_table`` (which reads ``closedTable.json``). The input
types and the key pattern live in JS source, so they are restated here and a
rail (``tests/test_definition_inputs.py``) reads ``defSchema.js`` / ``parse.js``
and fails by name the day the two drift.

Raises ``ValueError`` whose FIRST TOKEN is the field path (``inputs[2].key: …``),
the convention ``validate_v2`` states: the router returns it verbatim as a 400.
FAILS CLOSED: anything this module does not recognise is a refusal, never a
pass-through.
"""
from __future__ import annotations

import json
import math
import re
from typing import Any

from api.services.ast_table import (
    CLOCK_SECTION,
    FUNCTIONS_SECTION,
    SCALARS_SECTION,
    SERIES_SECTION,
    TABLE,
    recurrence_bindings,
)

#: ``defSchema.js::INPUT_TYPES`` — buildable input types (rail-checked).
INPUT_TYPES = ("int", "float", "bool", "enum", "string", "color", "source")

#: ``defSchema.js::RESERVED_INPUT_TYPES`` — named by the spec, not buildable yet.
RESERVED_INPUT_TYPES = ("timeframe", "price", "time", "session", "symbol", "confirm")

#: ``parse.js::KEY_RE`` — what makes ``$<key>`` an unambiguous reference.
KEY_PATTERN = r"^[A-Za-z][A-Za-z0-9_]*$"
_KEY_RE = re.compile(KEY_PATTERN)

#: The string-valued presentation modifiers ``defSchema.validateInput`` checks.
_STRING_MODIFIERS = ("label", "group", "inline", "tooltip", "disabled")

#: The numeric modifiers ``defSchema.validateInput`` checks.
_NUMERIC_MODIFIERS = ("min", "max", "step")


def _fmt(v: Any) -> str:
    """``defSchema.fmt``'s job: show the value as JSON, so a member reads
    ``"14"`` (a string) differently from ``14`` (a number)."""
    try:
        return json.dumps(v, ensure_ascii=False, sort_keys=True)[:120]
    except (TypeError, ValueError):
        return repr(v)[:120]


def _is_number(v: Any) -> bool:
    """A JS ``number`` that is finite: never a bool (``True`` is an ``int`` in
    Python and a boolean in JSON)."""
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _is_integer(v: Any) -> bool:
    """``Number.isInteger``: ``5`` and ``5.0`` both are (JSON cannot tell them
    apart once the browser has parsed them); ``5.5``, ``NaN`` and ``True`` are not."""
    return _is_number(v) and float(v).is_integer()


def _non_empty_str(v: Any) -> bool:
    return isinstance(v, str) and v != ""


def table_names() -> frozenset:
    """Every name an input key may not take: what the closed table computes —
    series, clock fields, functions, scalars — and the recurrence bindings.

    ⛔ THE SAME SET ``ast_interpret.interpret`` RAISES ON (its scope is series +
    clock + scalars, then ``functions`` and ``recurrence_bindings``), read off the
    same manifest. A narrower set here would store a document the evaluator then
    refuses to run."""
    names: set = set()
    for section in (SERIES_SECTION, CLOCK_SECTION, FUNCTIONS_SECTION, SCALARS_SECTION):
        names.update((TABLE.get(section) or {}).keys())
    names.update(recurrence_bindings())
    return frozenset(names)


def _enum_option_value(option: Any) -> Any:
    """``defSchema.enumOptionValue``: a bare scalar, ``[value, label]`` or
    ``{value, label}``."""
    if isinstance(option, list):
        return option[0] if option else None
    if isinstance(option, dict) and "value" in option:
        return option["value"]
    return option


def _same_value(a: Any, b: Any) -> bool:
    """``Array.prototype.includes`` (SameValueZero) without Python's ``True == 1``."""
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a is b
    if _is_number(a) and _is_number(b):
        return float(a) == float(b)
    return type(a) is type(b) and a == b


def _check_value(spec: dict, value: Any, path: str) -> None:
    """``defSchema.validateInputValue`` — a value against a declared type."""
    kind = spec.get("type")
    if kind == "int" and not _is_integer(value):
        raise ValueError(f'{path}: type "int" requires an integer, got {_fmt(value)}')
    if kind == "float" and not _is_number(value):
        raise ValueError(f'{path}: type "float" requires a finite number, got {_fmt(value)}')
    if kind == "bool" and not isinstance(value, bool):
        raise ValueError(f'{path}: type "bool" requires true or false, got {_fmt(value)}')
    if kind == "string" and not isinstance(value, str):
        raise ValueError(f'{path}: type "string" requires a string, got {_fmt(value)}')
    if kind == "color" and not _non_empty_str(value):
        raise ValueError(f'{path}: type "color" requires a non-empty string (a "token:<role>" '
                         f"ref or a raw CSS colour), got {_fmt(value)}")
    if kind == "source" and not _non_empty_str(value):
        raise ValueError(f'{path}: type "source" requires a non-empty string (a bar field or a '
                         f'"defId.plotKey" handle), got {_fmt(value)}')
    if kind == "enum":
        options = spec.get("options")
        if not isinstance(options, list) or not options:
            raise ValueError(f'{path}: type "enum" requires a non-empty options array on the '
                             f"input, got {_fmt(options)}")
        values = [_enum_option_value(o) for o in options]
        bad = [v for v in values if not isinstance(v, (str, int, float, bool))
               or (isinstance(v, float) and not math.isfinite(v))]
        if bad:
            raise ValueError(f"{path}: enum option values must be scalars (string, number or "
                             f"boolean), got {', '.join(_fmt(v) for v in bad)}")
        if not any(_same_value(value, v) for v in values):
            raise ValueError(f"{path}: {_fmt(value)} is not one of the declared options: "
                             f"{', '.join(_fmt(v) for v in values)}")
    if kind in ("int", "float") and _is_number(value):
        lo, hi = spec.get("min"), spec.get("max")
        if _is_number(lo) and value < lo:
            raise ValueError(f"{path}: {_fmt(value)} is below the declared min {_fmt(lo)}")
        if _is_number(hi) and value > hi:
            raise ValueError(f"{path}: {_fmt(value)} is above the declared max {_fmt(hi)}")


def _check_one(spec: Any, index: int, seen: dict, reserved: frozenset) -> None:
    path = f"inputs[{index}]"
    if not isinstance(spec, dict):
        raise ValueError(f"{path}: expected an object, got {_fmt(spec)}")
    key = spec.get("key")
    if not _non_empty_str(key):
        raise ValueError(f"{path}.key: required non-empty string, got {_fmt(key)}")
    if not _KEY_RE.match(key):
        raise ValueError(f"{path}.key: {_fmt(key)} is not a legal input key — must match "
                         f'{KEY_PATTERN} so that "${key}" stays an unambiguous substitution '
                         "reference")
    if key in seen:
        raise ValueError(f"{path}.key: duplicate input key {_fmt(key)} (first declared at "
                         f'inputs[{seen[key]}]) — "${key}" would be ambiguous')
    if key in reserved:
        raise ValueError(f"{path}.key: {_fmt(key)} is already a name this engine computes — "
                         "declaring it would shadow the real column, and every formula on "
                         "this definition would read the knob instead. Rename the input")
    seen[key] = index

    kind = spec.get("type")
    if kind in RESERVED_INPUT_TYPES:
        raise ValueError(f"{path}.type: input type {_fmt(kind)} is SCHEMA-RESERVED for a later "
                         f"phase — buildable input types are: {', '.join(INPUT_TYPES)}")
    if kind not in INPUT_TYPES:
        raise ValueError(f"{path}.type: unknown input type {_fmt(kind)} — expected one of: "
                         f"{', '.join(INPUT_TYPES)}. Unknown behavioural values are rejected, "
                         "never coerced")

    if "default" not in spec:
        raise ValueError(f"{path}.default: required — every input needs a default (it is the "
                         "value the engine computes with before the member touches anything)")
    _check_value(spec, spec["default"], f"{path}.default")

    for k in _NUMERIC_MODIFIERS:
        if k in spec and spec[k] is not None and not _is_number(spec[k]):
            raise ValueError(f"{path}.{k}: expected a finite number, got {_fmt(spec[k])}")
        # ⚠️ `null` in JSON is `undefined`-adjacent for the browser's `!== undefined`
        # check ONLY when the key is absent; an explicit null is not a number there.
        if k in spec and spec[k] is None:
            raise ValueError(f"{path}.{k}: expected a finite number, got null")
    lo, hi, step = spec.get("min"), spec.get("max"), spec.get("step")
    if _is_number(lo) and _is_number(hi) and lo > hi:
        raise ValueError(f"{path}: min must be <= max, got min={_fmt(lo)} max={_fmt(hi)}")
    if _is_number(step) and step <= 0:
        raise ValueError(f"{path}.step: must be > 0, got {_fmt(step)}")

    for k in _STRING_MODIFIERS:
        if k in spec and not isinstance(spec[k], str):
            raise ValueError(f"{path}.{k}: expected a string, got {_fmt(spec[k])}")


def validate_inputs(definition: Any) -> None:
    """Refuse, by field path, any ``inputs[]`` the shipped client would not build.

    A document with no ``inputs`` key is legal (every input is optional). Raises
    ``ValueError`` on the FIRST defect, in document order."""
    if not isinstance(definition, dict) or "inputs" not in definition:
        return
    specs = definition["inputs"]
    if not isinstance(specs, list):
        raise ValueError(f"inputs: expected an array, got {_fmt(specs)}")
    reserved = table_names()
    seen: dict = {}
    for i, spec in enumerate(specs):
        _check_one(spec, i, seen, reserved)
    # ``defSchema.validateActiveWhen`` — a condition keyed on a missing input
    # would silently hide a control forever.
    for i, spec in enumerate(specs):
        aw = spec.get("activeWhen")
        if aw is None:
            continue
        path = f"inputs[{i}].activeWhen"
        if not isinstance(aw, dict):
            raise ValueError(f"{path}: expected an object describing the condition, got {_fmt(aw)}")
        ref = aw.get("key")
        if not isinstance(ref, str):
            continue  # a future shape the browser does not parse either — left alone
        if ref not in seen:
            raise ValueError(f"{path}.key: unresolvable reference {_fmt(ref)} — no input declares "
                             f"that key (declared input keys: {', '.join(seen) or 'none'})")
        if ref == spec.get("key"):
            raise ValueError(f"{path}.key: {_fmt(ref)} refers to its own input — the condition "
                             "can never be evaluated")
