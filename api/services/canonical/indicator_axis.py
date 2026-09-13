"""GATE-D2 **CP4** — the indicator axis: a SECOND canonical address form.

Signed 2026-09-13, PRD-D2 §9.5, fingerprint `3257cc319`. Technical form: SPEC-D2 §5.4.

⭐ **WHY A SECOND FORM AND NOT A TRANSLATION TABLE.** Measured:

    legacy addresses  indicator_alert_evaluator.all_addresses()   31
    book metrics      api/data/canonical_address_book.json       142
    INTERSECTION                                                   0

The honest reading of that 0 is **one rename (`close` ↔ `ohlcv.c`) and thirty
genuine absences** — an earlier probe compared the leaf `close` against the leaf
`c`, could not see an abbreviation, and reported "zero renames". A translation
table would map **one row of thirty-one** and read as progress.

The thirty are absent because they are a different KIND of thing (SPEC §5.4.2):

| property   | a screener metric  | an indicator output                       |
|------------|--------------------|-------------------------------------------|
| where      | a stored column    | **nowhere — computed on demand**          |
| identity   | the name           | the name **plus its parameters**          |
| timeframe  | implicit           | **part of the address**                   |
| `as_of`    | the row's stamp    | **the last CLOSED bar of that timeframe** |

⛔⛔ **THIS RESOLVER MUST NOT COMPUTE.** It returns a *descriptor* — the source
series, the indicator function, the bound parameters — and never a value. D2
describes; the caller computes. A resolver that returns numbers becomes a second
calculation engine beside the one that already exists.

⛔⛔ **NOTHING HERE IS TYPED THAT COULD BE DERIVED.** The book's own contract is
*"every value is derived from a declaration that already exists in this repo"*.
The thirty come from `all_addresses()`; every parameter name, order and type
comes from `alert_series.address_inputs()`, which reads them off the column
function that actually consumes them. The timeframe vocabulary comes from
`signature.ledger._BARS_STORE_TF_KEYS`. Two values are declared here because no
code knows them — the `close` → `ohlcv.c` rename (SPEC §5.4.5) and the boolean
`yields` of the two `sar` events — and each carries a rail.

⛔ **FLAG-OFF BY DEFAULT** (`CANONICAL_INDICATOR_AXIS_ENABLED`). CP4 declares and
describes; consuming the axis is `indicator-condition` CP3's act under its own
approval line, not this one.

⛔ **`bars_fetch.py` / `bars_sqlite.py` ARE NOT TOUCHED.** Owner ruling
2026-09-13: flow-worker's watch list is NOT widened; those two stay
in-closure-unwatched, and any change to them is BEHAVIOUR-CHANGING under the rail
and merges after-hours with a marker bump. This module therefore *describes* the
bars source without editing it.
"""
from __future__ import annotations

import os
import re
from typing import Optional

from api.services import alert_series, indicator_alert_evaluator
from api.services.canonical import address_book
from api.services.signature import ledger

FLAG = "CANONICAL_INDICATOR_AXIS_ENABLED"

# ── resolution statuses ──────────────────────────────────────────────────────
OK = "ok"
DISABLED = "disabled"
UNKNOWN_METRIC = "unknown_metric"
UNKNOWN_TIMEFRAME = "unknown_timeframe"
MALFORMED = "malformed"
MISSING_PARAMS = "missing_params"
BAD_PARAMS = "bad_params"

#: ⛔ DECLARED BUT NEVER RETURNED BY `resolve()`. "Insufficient history" is the
#: CALLER's outcome — this module does not read bars, so it cannot know. It is
#: named here because the distinction must survive: `not_computable` is NOT
#: `false`. `rsi(14)@D` on a symbol with nine bars is not "the condition did not
#: hold"; collapsing them makes a thin new listing look bearish, which is the
#: CoverageLine distinction this repo already paid to learn.
NOT_COMPUTABLE = "not_computable"

#: The ONE genuine rename (SPEC §5.4.5). Declared, not derived, because no code
#: knows that the legacy `close` means the book's `ohlcv.c`. Railed: the target
#: must exist in the canonical book, or this points nowhere.
RENAMES = {"close": "ohlcv.c"}

#: The two legacy addresses that are BOOLEANS about a transition between two
#: bars, not levels (SPEC §5.4.5). Declared because `address_inputs` reports
#: their parameters, not their return kind. They need a two-bar window, so a
#: descriptor that claimed `yields: num` would mis-describe them.
BOOLEAN_ADDRESSES = ("sar.priceCrossedSar", "sar.trendFlipped")

_ADDRESS_RE = re.compile(
    r"^(?P<name>[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)"
    r"(?:\((?P<params>[^()]*)\))?"
    r"@(?P<tf>[A-Za-z0-9]+)$"
)


def enabled() -> bool:
    return os.environ.get(FLAG, "").strip().lower() in ("1", "true", "yes")


def timeframe_codes() -> dict:
    """code -> product label, from the bars store's OWN declaration."""
    return dict(ledger._BARS_STORE_TF_KEYS)


def normalize_timeframe(raw: str) -> Optional[str]:
    """Accept either the canonical CODE ('D') or the product LABEL ('1D').
    Returns the CODE, or None.

    ⛔⛔ **CASE-SENSITIVE, AND THAT IS LOAD-BEARING.** The declared labels
    include both `1m` (one MINUTE) and `1M` (one MONTH). They differ by exactly
    one bit of case, so a `.lower()` anywhere in this path silently turns a
    monthly address into a minute one — the same address, a different series, no
    error. The book says the canonical key is the CODE for this reason; labels
    are accepted only because SPEC §5.4.3 writes its examples that way, and they
    are resolved through the store's own map rather than a second table here.
    """
    codes = timeframe_codes()
    if raw in codes:
        return raw
    for code, label in codes.items():
        if raw == label:
            return code
    return None


def declarations() -> dict:
    """The thirty (plus the rename), DERIVED. address -> declaration.

    ⛔ No address, parameter name, order or default is typed here. A compute that
    gains a parameter tomorrow is declared correctly with no edit to this file —
    the retired `{"rsi": ["period"], …}` map is exactly the shape this avoids.
    """
    out: dict = {}
    for address in indicator_alert_evaluator.all_addresses():
        inputs = alert_series.address_inputs(address) or {}
        out[address] = {
            "address": address,
            # ⭐ ORDERED. Params are positional and ordered by the indicator's own
            # declared signature — two spellings of one address would be two cache
            # keys and two disagreeing answers.
            "params": [{"name": k, "default": v, "type": type(v).__name__}
                       for k, v in inputs.items()],
            "yields": "bool" if address in BOOLEAN_ADDRESSES else "num",
            "renames_to": RENAMES.get(address),
            "source_series": "ohlcv",
            "store": "bars_sqlite",
            # ⛔ UNDECLARED, and that is NOT zero. No authority in this repo
            # declares an indicator's warmup, and deriving it as "max integer
            # parameter" is a HEURISTIC — a wrong warmup silently corrupts the
            # head of every series it describes. Registered as F-D2-3.
            "warmup_bars": None,
        }
    return out


def parse(address: str) -> dict:
    """Split `<indicator>[.<output>](<params>)@<timeframe>` without resolving."""
    m = _ADDRESS_RE.match((address or "").strip())
    if not m:
        return {"status": MALFORMED, "address": address}
    raw = m.group("params")
    params = [p.strip() for p in raw.split(",")] if raw not in (None, "") else []
    return {"status": OK, "name": m.group("name"), "params": params,
            "timeframe_raw": m.group("tf"), "address": address}


def resolve(address: str) -> dict:
    """Return a COMPUTATION DESCRIPTOR, never a value.

    ⛔ DEFAULTS ARE NOT IMPLICIT. `rsi@D` refuses; `rsi(14)@D` resolves. A default
    period applied silently is a second authority over what the member asked for,
    and this programme has paid for that class four times. Addresses whose
    declared signature is EMPTY (`vwap`, `obv`, `bb`, `close`) take no parens by
    construction — the rule binds parameterised addresses only, and which ones
    those are is derived, never listed.
    """
    if not enabled():
        return {"status": DISABLED, "address": address}

    p = parse(address)
    if p["status"] != OK:
        return p

    decl = declarations().get(p["name"])
    if decl is None:
        return {"status": UNKNOWN_METRIC, "address": address, "name": p["name"]}

    code = normalize_timeframe(p["timeframe_raw"])
    if code is None:
        return {"status": UNKNOWN_TIMEFRAME, "address": address,
                "timeframe_raw": p["timeframe_raw"]}

    signature = decl["params"]
    given = p["params"]
    if len(given) != len(signature):
        status = MISSING_PARAMS if len(given) < len(signature) else BAD_PARAMS
        return {"status": status, "address": address,
                "expected": [s["name"] for s in signature], "given": given}

    bound = {}
    for spec, raw_value in zip(signature, given):
        caster = {"int": int, "float": float, "str": str}.get(spec["type"], str)
        try:
            bound[spec["name"]] = caster(raw_value)
        except (TypeError, ValueError):
            return {"status": BAD_PARAMS, "address": address,
                    "param": spec["name"], "value": raw_value,
                    "expected_type": spec["type"]}

    return {
        "status": OK,
        "address": address,
        "metric": p["name"],
        "renames_to": decl["renames_to"],
        "store": decl["store"],
        "source_series": decl["source_series"],
        "timeframe": code,
        "timeframe_label": timeframe_codes()[code],
        "params": bound,
        "yields": decl["yields"],
        "warmup_bars": decl["warmup_bars"],
        # ⛔ THE FUNCTION, NOT ITS RESULT. Handing back the callable is what keeps
        # this a description: the caller computes, D2 never does.
        "value_function": indicator_alert_evaluator.value_function(p["name"]),
        # `as_of` is the open-time of the last CLOSED bar of this timeframe —
        # never "now", never the developing bar. The caller supplies the clock;
        # stating the contract here is the point.
        "as_of_contract": "open-time of the last CLOSED bar of the address timeframe",
    }


def rename_target_exists() -> bool:
    """The declared rename must land somewhere real, or it points nowhere."""
    return all(address_book.metric(t) is not None for t in RENAMES.values())
