"""The Signature indicators AS REGISTRY DEFINITIONS, on ONE generic server lane.

⭐ THE LANE IS THE DELIVERABLE, NOT THREE DEFINITIONS WEARING A NEW COAT.
Spec §10 called the three hardcoded endpoints *"acceptable at launch, genericize
in C"*. Three definitions that each know their own endpoint is not a lane; it is
the same hardcoding with more ceremony. **A lane is generic when a fourth tenant
needs no code in it** — and this file has a fourth (`rsLine`, Task 14's) precisely
so that claim is measured rather than asserted.

Everything the lane needs to serve a definition is a ROW here:

  * `id` — the definition id the chart addresses it by.
  * `compute` — `{"kind": "server", "fn": ..., "rev": ...}`, mirroring the JS
    registry's shape so the two lanes are diffable.
  * `inputs` — the declared, validated input vocabulary (`enum` options and all).
  * `columns` — the per-bar column keys this definition produces. **May be
    empty**: dark-pool levels and GEX walls draw horizontal LEVELS, which v1's
    plot vocabulary cannot express as a column (`hlines` requires a STATIC
    `levels` array and `zones` is schema-RESERVED). An empty list is the honest
    declaration, and `wire_columns` enforces it in both directions.
  * `payload_keys` — the non-column keys the tenant's envelope carries
    (`levels`, `signals`), so the wire shape is declared rather than discovered.
  * `ledger` — see below.

⛔ THE ONE THING THIS FILE MAY NOT DO: RE-KEY THE LEDGER.
`api/services/signature/ledger.py` is INSERT-only — there is no rewrite path — and
it is accruing real history keyed `(indicator='fcb', version='fcb-v2', tf='1D')`.
Renaming the CHART-FACING id to `uct-flow-breakout` must not touch a byte of what
gets WRITTEN. `LEDGER_INDICATOR_FOR` and `LEDGER_TF_FOR` are that translation,
written down as data so the separation is a lookup and not a convention somebody
remembers. A re-key orphans history that cannot be reconstructed.

⚠️ WIRE FORMAT (spec §4): a column is a JSON **array of numbers and `null`**,
`null` ⇄ NaN mapped at the client boundary (`engine/serverCompute.js`). Compute
NEVER emits point objects — `[{"time":…, "value":…}]` is the shape the binder
already converts FROM, and emitting it here would put that conversion in two
places with nothing keeping them equal. `wire_columns` refuses it by name.

⚠️ PREMIUM STAYS GATED BY HANDLER IDENTITY. This module holds no auth. Every
Signature route declares `Depends(require_paid)` INDIVIDUALLY (there is no
router-level dependency, and `test_a_free_user_is_refused_on_every_route` exists
because a gate applied to two of three routes passes any single-route test). A
registry definition must not become a way to reach the data without the handler,
so the lane's provider registry is populated BY the router — the module that owns
the gate — and this file cannot reach a provider that has not been plugged in.
"""
from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any, Callable, Iterable

SCHEMA_VERSION = 1

# ── The ledger vocabulary, frozen ───────────────────────────────────────────
#
# Ten rows of real history are keyed `(indicator='fcb', version='fcb-v2',
# tf='1D', …)`. The definition may be called `uct-flow-breakout` on the chart;
# what it WRITES stays 'fcb'/'1D'.
LEDGER_INDICATOR_FOR: dict[str, str] = {
    "uct-darkpool-levels": "dpl",
    "uct-gex-walls": "gxw",
    "uct-flow-breakout": "fcb",
}

# The product timeframe label → the ledger's `tf`. Identity for "1D" on purpose:
# the ledger stores the PRODUCT label, and the value of writing it down is that
# the identity is a ROW somebody has to change on purpose, not an absence.
# "D" is the BARS-STORE key (`bars_sqlite`) and maps to the same ledger label —
# the two encodings drifting apart silently is this module's whole history.
LEDGER_TF_FOR: dict[str, str] = {"1D": "1D", "D": "1D"}

# Chart timeframe code → the key `bars_sqlite` actually stores rows under.
# `_fetch_bars`'s docstring is the cautionary tale: passing the PRODUCT label
# "1D" matches no rows at all and the indicator ships permanently, silently dead.
STORE_TF_FOR: dict[str, str] = {
    "1": "1", "5": "5", "15": "15", "30": "30", "60": "60",
    "D": "D", "1D": "D", "W": "W", "1W": "W", "M": "M", "1M": "M",
}

# The benchmark vocabulary — ONE list, shared with the JS definition's `enum`
# options (`nativeRegistry.RS_LINE_RAW`). `test_the_rs_line_benchmarks_are_ONE_
# list_across_BOTH_LANES` diffs them, so a benchmark added on one side alone is
# a red test rather than an option that resolves to nothing.
RS_LINE_BENCHMARKS: tuple[str, ...] = ("SPY", "QQQ", "IWM")


# ── Refusals. DELIBERATELY DISJOINT PHRASES ─────────────────────────────────
#
# 🔑 Task 9 measured the cost of sharing one: two gates carrying the same words
# made `pytest.raises(match=…)` still match with the safety DELETED, so the test
# passed on a tree with the guard gone. No two messages below share a phrase.

class DefinitionNotOffered(LookupError):
    """No row in this file carries that id."""


class DefinitionHasNoProvider(LookupError):
    """The row exists; nothing is plugged into the lane for it."""


class InputRejected(ValueError):
    """A declared input was given a value its vocabulary does not contain."""


class ColumnContractViolation(ValueError):
    """The tenant returned something that is not a wire column."""


# ── The definitions ─────────────────────────────────────────────────────────

_DPL = {
    "schemaVersion": SCHEMA_VERSION,
    "id": "uct-darkpool-levels",
    "version": 1,
    "compute": {"kind": "server", "fn": "darkPoolLevels", "rev": 1},
    "meta": {
        "name": "Dark Pool Levels", "shortName": "DP", "category": "UCT Signature",
        "description": "Confirmed off-exchange print clusters, as price levels.",
        "tier": "premium", "repaint": "non-repainting",
    },
    "placement": {"target": "price"},
    "inputs": [],
    # No per-bar column: a dark-pool level is a horizontal LINE at a price, and
    # v1's `hlines` style takes a STATIC levels array. Declared empty rather than
    # faked — see the module docstring.
    "columns": [],
    "payload_keys": ["levels"],
    "rules_key": "dpl",
}

_GXW = {
    "schemaVersion": SCHEMA_VERSION,
    "id": "uct-gex-walls",
    "version": 1,
    "compute": {"kind": "server", "fn": "gexWalls", "rev": 1},
    "meta": {
        "name": "GEX Walls", "shortName": "GEX", "category": "UCT Signature",
        "description": "Call wall, put wall and zero-gamma, from the live chain.",
        "tier": "premium", "repaint": "repaints",
    },
    "placement": {"target": "price"},
    "inputs": [],
    "columns": [],
    "payload_keys": ["levels", "spot", "regime"],
    "rules_key": "gxw",
}

_FCB = {
    "schemaVersion": SCHEMA_VERSION,
    "id": "uct-flow-breakout",
    "version": 1,
    "compute": {"kind": "server", "fn": "flowBreakout", "rev": 1},
    "meta": {
        "name": "Flow-Confirmed Breakout", "shortName": "FCB", "category": "UCT Signature",
        "description": "A closed-bar range break with dominant same-side options premium.",
        "tier": "premium", "repaint": "non-repainting",
    },
    "placement": {"target": "price"},
    "inputs": [],
    # ⭐ THE ONE SIGNATURE DEFINITION THAT IS A REAL COLUMN TENANT. A breakout is
    # an EVENT — a {0, 1, NaN} column per direction, index-aligned to bars — which
    # is exactly the shape Phase C's alert grammar addresses (Task 4). The markers
    # the chart draws today are one rendering of it, not the thing itself.
    "columns": ["bull", "bear"],
    "payload_keys": ["signals"],
    "rules_key": "fcb",
}

_RS_LINE = {
    "schemaVersion": SCHEMA_VERSION,
    "id": "rsLine",
    "version": 1,
    "compute": {"kind": "server", "fn": "rsLine", "rev": 1},
    "meta": {
        "name": "Relative Strength Line", "shortName": "RS", "category": "Momentum",
        "description": "This symbol's close divided by a benchmark's.",
        "tier": "premium", "repaint": "non-repainting",
    },
    "placement": {"target": "pane"},
    "inputs": [
        {"key": "benchmark", "type": "enum", "default": "SPY",
         "options": list(RS_LINE_BENCHMARKS)},
    ],
    "columns": ["rsLine"],
    "payload_keys": [],
    # ⛔ NO LEDGER ROW, ON PURPOSE. `LEDGER_INDICATOR_FOR` has no entry for
    # `rsLine`: it is a chart indicator, not a Signature RULE, and nothing about
    # it is written to the append-only signal ledger. `ledger_indicator()`
    # returning None for it is the assertion that the two are different things.
    "rules_key": None,
}

SERVER_DEFS: tuple[dict, ...] = (_DPL, _GXW, _FCB, _RS_LINE)

_BY_ID: dict[str, dict] = {d["id"]: d for d in SERVER_DEFS}

# ⭐ THE PROOF THE LANE IS GENERIC, STATED AS AN INVARIANT RATHER THAN A CLAIM.
# `rsLine` is not a Signature indicator, shares no code with one, has its own
# category and its own input, and needed no branch in `serve()` to be served.
SIGNATURE_DEF_IDS: tuple[str, ...] = tuple(d["id"] for d in (_DPL, _GXW, _FCB))


# ── The provider registry ───────────────────────────────────────────────────
#
# `(sym, tf, inputs) -> dict` where the dict carries a `columns` mapping and
# whatever `payload_keys` the row declares. Populated by the ROUTER, which owns
# the paid gate — see the module docstring.
_PROVIDERS: dict[str, Callable[[str, str, dict], dict]] = {}


def register_provider(def_id: str, fn: Callable[[str, str, dict], dict]) -> None:
    """Plug a tenant into the lane. Idempotent (a module re-import re-registers)."""
    if def_id not in _BY_ID:
        raise DefinitionNotOffered(
            f"cannot plug a provider into the lane for {def_id!r}: "
            f"no row in registry_defs declares it")
    _PROVIDERS[def_id] = fn


def provider_for(def_id: str) -> Callable[[str, str, dict], dict]:
    definition(def_id)                      # raises DefinitionNotOffered first
    fn = _PROVIDERS.get(def_id)
    if fn is None:
        raise DefinitionHasNoProvider(
            f"{def_id!r} is declared but the lane has nothing plugged in for it — "
            "the router registers every tenant at import, so this means the router "
            "was never imported or a row was added without one")
    return fn


def definition(def_id: str) -> dict:
    d = _BY_ID.get(def_id)
    if d is None:
        raise DefinitionNotOffered(
            f"no server-lane definition is registered under {def_id!r}; "
            f"offered: {sorted(_BY_ID)}")
    return d


def list_definitions() -> list[dict]:
    return [dict(d) for d in SERVER_DEFS]


def ledger_indicator(def_id: str) -> str | None:
    """The ledger's `indicator` key for a chart-facing definition id, or None.

    None means "this definition writes nothing to the signal ledger", which is
    the correct answer for `rsLine` and is NOT the same as "unknown id" — that
    raises.
    """
    definition(def_id)
    return LEDGER_INDICATOR_FOR.get(def_id)


def ledger_tf(tf: str) -> str:
    """The ledger's `tf` for a chart/store timeframe. Unknown ⇒ the input, verbatim.

    Deliberately NOT a raise: the ledger's uniqueness key includes `tf`, and
    `record_signal` already refuses a tf it cannot key. Guessing here would put
    a second, weaker opinion in front of the one that actually protects history.
    """
    return LEDGER_TF_FOR.get(tf, tf)


def store_tf(tf: str) -> str:
    """The bars-store key for a chart timeframe. Unknown ⇒ 'D'."""
    return STORE_TF_FOR.get(str(tf or "D"), "D")


# ── Inputs ──────────────────────────────────────────────────────────────────

def resolve_inputs(def_id: str, raw: dict | None) -> dict:
    """Declared inputs only, defaults filled, vocabulary enforced.

    An undeclared key is DROPPED rather than refused: the client sends the whole
    instance's input map (colour, line width) and only some of it is the server's
    business. A DECLARED key with an out-of-vocabulary value is refused — that is
    a request for data this definition cannot produce, and answering it with the
    default would draw a benchmark the user did not ask for.
    """
    d = definition(def_id)
    src = raw if isinstance(raw, dict) else {}
    out: dict[str, Any] = {}
    for spec in d["inputs"]:
        key = spec["key"]
        val = src.get(key, spec.get("default"))
        if val is None:
            val = spec.get("default")
        if spec["type"] == "enum":
            options = spec.get("options") or []
            if val not in options:
                raise InputRejected(
                    f"input {key!r} was given {val!r}, which is outside the enum "
                    f"vocabulary {options} declared by {def_id!r}")
        out[key] = val
    return out


# ── The wire contract ───────────────────────────────────────────────────────

def _wire_number(v) -> float | None:
    """One cell. NaN/inf ⇒ `null` — FastAPI serializes with `allow_nan=False`
    and a browser's `r.json()` throws on a bare NaN, which would take the WHOLE
    overlay down rather than one bar."""
    if v is None:
        return None
    if isinstance(v, bool):
        raise ColumnContractViolation(
            "a wire column cell was a bool; columns carry numbers and nulls only")
    if not isinstance(v, (int, float)):
        raise ColumnContractViolation(
            f"a wire column cell was {type(v).__name__}; columns carry numbers and nulls only")
    f = float(v)
    return f if math.isfinite(f) else None


def wire_columns(def_id: str, columns: Any) -> dict[str, list]:
    """Validate + serialize a tenant's columns into the wire shape.

    ⛔ THE REFUSAL THAT MATTERS: a column is an ARRAY OF NUMBERS, never a list of
    `{time, value}` points. The binder already converts a NaN-padded column into
    LWC whitespace items at ITS boundary; a tenant emitting points would put that
    conversion in a second place with nothing keeping the two equal, and the
    first divergence would be a line that draws on the wrong bars.
    """
    d = definition(def_id)
    declared = list(d["columns"])
    if not isinstance(columns, dict):
        raise ColumnContractViolation(
            f"{def_id!r} returned {type(columns).__name__} where the lane expects a "
            "mapping of column key to array")
    got = sorted(columns)
    if got != sorted(declared):
        raise ColumnContractViolation(
            f"{def_id!r} returned column keys {got} but declares {sorted(declared)} — "
            "a definition and its provider drifting apart is a failure here, not a "
            "silently empty overlay")
    out: dict[str, list] = {}
    length = None
    for key in declared:
        col = columns[key]
        if isinstance(col, (str, bytes)) or not isinstance(col, Sequence):
            raise ColumnContractViolation(
                f"column {key!r} of {def_id!r} is {type(col).__name__}; the lane carries arrays")
        cells = list(col)
        if cells and isinstance(cells[0], dict):
            raise ColumnContractViolation(
                f"column {key!r} of {def_id!r} was emitted as point objects "
                "({time, value}); compute never emits points — the wire carries a "
                "bare array positionally aligned to `times`, and the binder is the "
                "ONE place a column becomes chart points")
        if length is None:
            length = len(cells)
        elif len(cells) != length:
            raise ColumnContractViolation(
                f"{def_id!r} returned ragged columns: {key!r} has {len(cells)} cells "
                f"where an earlier column has {length}; every column is index-aligned "
                "to the same `times`")
        out[key] = [_wire_number(v) for v in cells]
    return out


def event_columns(bar_keys: Iterable, hits: Iterable[tuple], keys: Sequence[str]) -> dict[str, list]:
    """`{0, 1, None}` columns from (bar_key, column_key) hits — the event shape, generically.

    `bar_keys` supplies the index order ALREADY NORMALIZED to whatever key the
    caller joins on (an ISO date, a unix second — this function does not care and
    deliberately does not decode). `hits` is `(bar_key, column_key)` pairs.
    Nothing here knows what a breakout is: a second event-bearing tenant reuses
    it unchanged.

    ⚠️ JOINED BY KEY, NEVER BY INDEX — the same rule `compute_rs_line_raw` states
    for its benchmark. One missing bar under an index join shifts every
    subsequent signal, and the result is plausible and wrong for the whole
    history rather than absent for one bar.

    0 is "computed, did not happen" and is the whole point — an all-`None` column
    and a quiet tape look identical, and only one of them is an answer.
    """
    index: dict[Any, int] = {}
    n = 0
    for i, k in enumerate(bar_keys):
        index.setdefault(k, i)
        n = i + 1
    cols = {k: [0.0] * n for k in keys}
    for bar_key, col_key in hits:
        i = index.get(bar_key)
        if i is None or col_key not in cols:
            continue
        cols[col_key][i] = 1.0
    return cols


# ── The lane ────────────────────────────────────────────────────────────────

def serve(def_id: str, sym: str, tf: str, inputs: dict | None) -> dict:
    """THE GENERIC DISPATCH. Nothing below this line knows a tenant's name.

    A fourth tenant is a row in `SERVER_DEFS` plus a `register_provider` call.
    There is no `if def_id ==` anywhere in this function, and
    `test_the_lane_names_no_tenant` reads this module's own AST to keep it that
    way — a branch here would be the hardcoding spec §10 said to retire.
    """
    d = definition(def_id)
    fn = provider_for(def_id)
    resolved = resolve_inputs(def_id, inputs)
    raw = fn(sym, tf, resolved) or {}
    columns = wire_columns(def_id, raw.get("columns") or {})
    times = [int(t) for t in (raw.get("times") or [])]
    for key, col in columns.items():
        if times and len(col) != len(times):
            raise ColumnContractViolation(
                f"column {key!r} of {def_id!r} has {len(col)} cells against {len(times)} "
                "times; the wire is positional and a length mismatch would draw the "
                "whole series shifted rather than absent")
    envelope: dict[str, Any] = {
        "defId": def_id,
        "sym": sym,
        "tf": tf,
        "rev": d["compute"]["rev"],
        "inputs": resolved,
        "columns": columns,
        "times": times,
    }
    for key in d["payload_keys"]:
        if key in raw:
            envelope[key] = raw[key]
    for key in ("version", "asOf", "error", "source"):
        if key in raw:
            envelope[key] = raw[key]
    return envelope
