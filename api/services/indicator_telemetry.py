"""The indicator/screener member-journey telemetry — Phase One Track C.

Per `docs/superpowers/specs/universal-indicator-ecosystem/TELEMETRY_OBSERVABILITY_FINDINGS.md`
(Phase Zero, P6): this product surface had NO telemetry at all — no structured
logging on the interactive save/import path, no correlation IDs, no frontend
analytics layer, nothing persisted. That audit's own recommendation, taken
verbatim: wire into the already-live `landing_events` table (`api/services/
auth_db.py`) rather than design new storage, because it is already indexed on
`(visitor_id, created_at)` and `(event, created_at)` and already carries a JSON
`props` column with room for whatever correlation keys a journey needs.

⛔ THIS IS NOT A NEW ANALYTICS PLATFORM. `landing_events` was built for anonymous
marketing-page visitors, but its schema does not actually require that — a
`visitor_id` is just an opaque TEXT identifier for "whose session is this", and
an authenticated `user_id` fits that slot exactly as well as a localStorage
UUID does. Extending it costs zero migrations and reuses a table this codebase
already trusts.

## The five events

`import_submitted` · `compile_finished` · `import_accepted` ·
`delivery_configured` · `execution_finished` — one product boundary each, per
the owner-approved five-event minimum. See `TRACK_C_TELEMETRY.md` for exactly
where each one fires and why.

## What this module will NOT log — ENFORCED, not just documented

⛔ NEVER the raw pasted script/thinkScript/PCF text, and NEVER uploaded
screenshot bytes, plain-language prompts, formula source, or a free-form
frontend state blob. `props` carries shape (dialect, success/failure, error
class, source length) — enough to reconstruct a journey and diagnose a
failure class, never enough to reconstruct WHAT a member typed. This mirrors
`CURRENT_ARCHITECTURE.md`'s own standing decision that raw source text is
transient and never persisted for the definitions store itself; telemetry
must not quietly become the place that persists it instead.

⛔⛔ 2026-09-04 HARDENING: a length ceiling alone is NOT this guarantee — a
pasted script, prompt, or sensitive fragment is routinely under 200
characters, so a length-only gate would wave through exactly the content it
exists to stop. **`EVENT_SCHEMAS` below is the PRIMARY defense**: each of the
five events has an explicit, named allowlist of (property, type). Anything
not on that list — under any name, of any length — is dropped or rejected
before it ever reaches storage. The 200-char cap survives as defense-in-depth
ONLY (`_MAX_PROP_STRING_LEN`), for an allowed field that somehow arrives
absurdly long; it is deliberately not the first or only line of defense.

⛔⛔ A LIST OR DICT VALUE IS NEVER ALLOWED, REGARDLESS OF KEY. Free-form
content wrapped in a container (`{"gate": {"note": "<the actual prompt>"}}`,
or a list) is exactly the bypass a flat per-key check would miss — `_prop_
violation` refuses any non-scalar value outright, on every event, with no
per-field opt-in.

## De-duplication

`log_event` is idempotent per `(user_id, event, import_id)` when `import_id`
is supplied: a caller that retries a request (a client-side network retry, a
double-fired handler) does not multiply the count. This directly answers the
"a retried request re-submitting import_submitted" risk named in the Track C
directive. It works by checking `landing_events` for an existing row bearing
that trio before inserting a new one — a light, best-effort check (not a DB
constraint, since `landing_events` is a shared table other, unrelated features
write to with entirely different — and legitimately repeatable — semantics,
so a table-level UNIQUE constraint would be the wrong tool here).

Events with no natural `import_id` (`delivery_configured`, `execution_finished`)
are not de-duplicated by this module — their own call sites are, by
construction, single-fire (see `TRACK_C_TELEMETRY.md`'s guard-by-guard list).
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

from api.services.auth_db import get_connection

log = logging.getLogger(__name__)

#: The full five-event vocabulary. Anything else is refused at the door,
#: mirroring `landing_analytics.py`'s own `ALLOWED_EVENTS` hygiene rule (a
#: junk event name is a junk row nobody can query for later).
EVENTS = frozenset({
    "import_submitted",
    "compile_finished",
    "import_accepted",
    "delivery_configured",
    "execution_finished",
    # ⭐ CONTROLLED ROLLOUT (2026-10-07) -- UCT Intelligence conversational authoring.
    "converse_turn",     # server-only: one /converse turn's outcome, cost and shape
    "studio_action",     # client: the authoring funnel (opened / preview / saved / ...)
    # ⭐ UCT RELATIVE STRENGTH (plan §13, 2026-11-07) -- counts only, client-fired
    # by `app/src/lib/rsTelemetry.js`; see "the UCT RS counts" below.
    # ⚰️ `rs_preset` (a preset was picked) RETIRED by the RS split (U9, 2026-11-09):
    # the slim UCT RS Line has no presets, so the event is refused at the door (400)
    # like any other unknown event, not left on the list with nothing to count.
    "rs_on",              # an RS copy started drawing on a chart
    "rs_off_within_60s",  # that copy stopped drawing within 60 s
    "rs_benchmark",       # a copy's benchmark changed
    "rs_marker_card",     # a readout card was opened
    "rs_learn",           # a Learn link was followed
})

#: Of the five, only these two are ever fired FROM THE CLIENT (the three
#: paste dialects compile in-browser, so the backend never sees a submit/
#: compile attempt for them unless the client reports it). The other three
#: are server-derived only — a client must never be able to claim its own
#: formula was "accepted" or "delivered"; that would let an unaccepted or
#: unvalidated definition masquerade as a real one in the journey data.
CLIENT_FIREABLE_EVENTS = frozenset({"import_submitted", "compile_finished", "studio_action",
                                    # the five UCT RS counts are observations of the
                                    # member's own chart, never a server decision
                                    "rs_on", "rs_off_within_60s", "rs_benchmark",
                                    "rs_marker_card", "rs_learn"})

#: Correlation/identity fields every event may carry — the "which journey,
#: which formula, which door" axis. Never content: an import_id is a
#: client-minted UUID, a def_id/def_hash a stored definition's own id/hash,
#: dialect/door short enum-like strings ("pine", "plain-language", ...).
_CORRELATION_FIELDS: dict = {
    "import_id": (str,),
    "def_id": (str,),
    "def_hash": (str,),
    "dialect": (str,),
    "door": (str,),
}

#: ⭐⭐ THE PRIMARY DEFENSE. One explicit allowlist per event — name -> the
#: Python type(s) a value must be. Anything not listed here for an event is
#: refused (dropped server-side, rejected at the client door), no matter how
#: short the value or how it's nested. Extending an event's shape means
#: adding a name here, in the open, next to its type — never widening a
#: generic passthrough.
EVENT_SCHEMAS: dict = {
    "import_submitted": {
        **_CORRELATION_FIELDS,
    },
    "compile_finished": {
        **_CORRELATION_FIELDS,
        "success": (bool,),
        "stage": (str,),
        "gate": (str,),  # the unsupported-construct / refusal code, e.g. "bars:too-large"
        "source_length": (int, float),
        "node_count": (int, float),
        "latency_ms": (int, float),
    },
    "import_accepted": {
        **_CORRELATION_FIELDS,
        "source_length": (int, float),
        "node_count": (int, float),
    },
    "delivery_configured": {
        **_CORRELATION_FIELDS,
        "surface": (str,),        # e.g. "alert", "chart-widget" (future)
        "destination": (str,),
        "indicator": (str,),      # a user-address like "u_abc123.value" — never a formula
        "sym": (str,),
        "tf": (str,),
    },
    "execution_finished": {
        **_CORRELATION_FIELDS,
        "mode": (str,),
        "tf": (str,),
        "as_of": (str,),
        "session": (str,),
        "universe": (str, int),
        "state": (str,),
        "gate": (str,),
        "latency_ms": (int, float),
    },
}

# ─── ⭐ CONTROLLED ROLLOUT: the conversation's events ─────────────────────────
#
# ⛔ SHAPE ONLY, LIKE EVERYTHING ABOVE: never the member's words, the model's reply,
# a tree or a formula. Every STRING below is additionally held to a closed value
# set or a strict pattern (`_VALUE_RULES`), so not even a short free-text phrase
# can ride in under a legal key. The unsupported-demand CATEGORY is computed
# server-side from the turn (`definition_conversation.unsupported_category`); the
# words it was computed from are never stored.

#: The op names a `converse_turn` may report (the patch contract's 22).
#: The operations as they stood when this list was hand-typed. ⚰️ 2026-11-17: it was THE list, and
#: seven operations added to the patch contract after it (`set_color_states`, `set_color_rule`,
#: `set_table`, `remove_table`, `set_input`, `remove_input`, `set_calculation_timeframe`) were not in
#: it, so every turn that used one had its whole `op_kinds` dropped: the record of what the newest
#: features built was the part that went missing. It survives only as the answer when the contract
#: cannot be read.
_CONVERSE_OPS_AS_TYPED = frozenset({
    "create", "rename_definition", "add_output", "remove_output", "rename_output",
    "set_output_tree", "set_slot", "add_clause", "remove_clause", "set_intent",
    "set_placement", "set_style", "set_marker", "remove_marker", "set_paint",
    "remove_paint", "request_info_value", "request_alert", "cancel_request",
    "set_levels", "set_fill", "remove_fill",
})


def contract_ops() -> frozenset:
    """Every operation the patch contract defines (`patchSchema.json`, each `$defs.op_*`'s `op`).
    DERIVED, never restated: a new operation is countable the day it is authorable. Never raises:
    telemetry must not take the door down, so an unreadable contract answers the typed list."""
    try:
        from pathlib import Path
        path = (Path(__file__).resolve().parents[2] / "app" / "src" / "components" / "chart" / "builder"
                / "authoring" / "patchSchema.json")
        defs = json.loads(path.read_text(encoding="utf-8"))["$defs"]
        ops = frozenset(v["properties"]["op"]["const"] for k, v in defs.items()
                        if k.startswith("op_") and isinstance(v, dict)
                        and isinstance(v.get("properties", {}).get("op", {}).get("const"), str))
        if ops:
            return ops
        log.error("[indicator-telemetry] the patch contract defines no operations; using the typed list")
    except Exception:  # noqa: BLE001
        log.exception("[indicator-telemetry] the patch contract could not be read; using the typed list")
    return _CONVERSE_OPS_AS_TYPED


_CONVERSE_OPS = contract_ops()

#: ⭐ 2026-11-17 -- WHICH BROWSER RULE SENT A PATCH BACK. When the browser's patch engine refuses a
#: change the door offered, it sends its refusal back for one repair
#: (`definition_conversation.browser_refusal`); each refusal begins with the engine's own code
#: (`color:condition-output`, `fill:not-series`, `calc-tf:lower`). Counted, they say which rules
#: the assistant trips most: the ranked list of what to teach it, or what the door should check.
#: ⛔ The codes arrive from the client, and the engine that owns them is not importable here, so
#: this is a strict SHAPE and not a closed set: two short lowercase slugs, letters and hyphens only
#: (no digits, no spaces), at most four. It cannot carry a sentence.
BROWSER_CODE = re.compile(r"[a-z][a-z-]{1,15}:[a-z][a-z-]{1,23}")
BROWSER_CODES_MAX = 4


def _browser_codes_ok(v: str) -> bool:
    parts = [p for p in v.split(",") if p]
    return 0 < len(parts) <= BROWSER_CODES_MAX and all(BROWSER_CODE.fullmatch(p) for p in parts)
#: What a turn's result WAS -- distinct product signals, never one "failed".
FAILURE_CLASSES = frozenset({
    "ok",                 # the model answered within the contract (any disposition)
    "preflight_refused",  # deterministic refusal before any model call (another symbol/timeframe)
    "backstop_refused",   # a change refused after the model (named another symbol / advisory phrase)
    "concept_refused",    # the planner refused an unknown concept / unsupported data (truthful)
    "model_invalid",      # the model's answer failed validation after the repair
    "budget_user",        # this member's daily allowance
    "budget_global",      # the shared member pool
    "rate_limited",       # the hourly request window
    "platform",           # the model provider could not be reached
    "provider_account",   # the provider refused OUR account (key, permission, credit): needs a person
    "internal",           # an unexpected server error
})
#: Unsupported demand, aggregated. ⭐ Derived from the refusal reasons that exist
#: (preflight gates, planner gates) plus a keyword bucket over a model UNSUPPORTED
#: turn; "other" is the honest remainder.
UNSUPPORTED_CATEGORIES = frozenset({
    "other_symbol", "other_timeframe", "nightly_scalar", "unknown_concept",
    "table", "fundamentals", "economic_data", "options", "news_sentiment",
    "drawing", "delivery", "other",
})
STUDIO_ACTIONS = frozenset({
    "opened", "preview", "saved", "save_failed", "discarded", "turn_failed",
    # The member pressed Undo on a preview at least once in this conversation: the answer
    # drew, and was not what they wanted (plan section 7, L7).
    "undone",
})
#: Output/presentation kinds a saved conversation's definition carries (shape).
_KINDS = frozenset({
    "series", "condition", "marker", "candle_paint", "background", "fill", "level",
    "info_value", "alert",
})
_CONV_ID = r"[A-Za-z0-9_-]{8,64}"


def _csv_of(allowed):
    def ok(v):
        parts = [p for p in v.split(",") if p]
        return len(parts) <= 32 and all(p in allowed for p in parts)
    return ok


# ⭐ LEARN AS A PRODUCT (2026-11-18) -- six fields a turn may carry about questions, memory and
# names (`definition_conversation.learned_fields`). EACH IS A CLOSED ID, checked against the file
# that owns it AT THE MOMENT OF WRITING: a question id against the clarify registry, an entry id
# against the named-indicator library, a name id against the name catalogue. None is a pattern: a
# word a member typed cannot be an id, so it cannot be stored. ⛔ A set that cannot be read
# refuses the value (the field is dropped, the row is still written).

def _clarify_ids() -> frozenset:
    from api.services import definition_conversation
    return frozenset(definition_conversation.clarify_registry())


def _library_ids() -> frozenset:
    from api.services import named_indicators
    return frozenset(e["id"] for e in named_indicators.entries() + named_indicators.held_names())


def _catalogue_ids() -> frozenset:
    from api.services import indicator_names
    return indicator_names.ids() | {indicator_names.OTHER}


LEARNED_MAX_IDS = 8


def _ids_of(closed, *, also=frozenset(), many=True):
    """A rule: every comma-separated part is in the closed set ``closed()`` reads (or in ``also``)."""
    def ok(v: str) -> bool:
        try:
            allowed = closed() | also
        except Exception:  # noqa: BLE001 -- unreadable: refuse the value, never raise
            log.exception("[indicator-telemetry] a closed id set could not be read")
            return False
        parts = v.split(",") if many else [v]
        return 0 < len(parts) <= (LEARNED_MAX_IDS if many else 1) and all(p in allowed for p in parts)
    return ok


_VALUE_RULES: dict = {
    "converse_turn": {
        "asked": _ids_of(_clarify_ids, also=frozenset({"assistant"}), many=False),
        "answered": _ids_of(_clarify_ids, many=False),
        "remembered": _ids_of(_clarify_ids),
        "named_built": _ids_of(_library_ids),
        "acronym_built": _ids_of(_library_ids),
        "named_held": _ids_of(_library_ids),
        "unknown_name": _ids_of(_catalogue_ids),
        "conversation_id": re.compile(_CONV_ID),
        "access": frozenset({"admin", "cohort"}),
        "disposition": frozenset({"change", "answer", "clarify", "unsupported", "none"}),
        "outcome": re.compile(r"(patch|question|noop|[a-z_-]{2,32}:[a-z0-9_-]{2,48})"),
        "failure_class": FAILURE_CLASSES,
        "unsupported_category": UNSUPPORTED_CATEGORIES,
        "repair_gate": re.compile(r"[a-z_-]{2,32}:[a-z0-9_-]{2,48}"),
        "input_wrapper": frozenset({"args"}),
        "op_kinds": _csv_of(_CONVERSE_OPS),
        "browser_codes": _browser_codes_ok,
        # What produced the turn (`definition_conversation.turn_stamps`). Each is a
        # strict pattern, never free text: a hash, a version, a model id.
        "prompt_sha": re.compile(r"[0-9a-f]{16}"),
        "vocab_version": re.compile(r"[0-9A-Za-z][0-9A-Za-z._-]{0,31}"),
        "model": re.compile(r"[a-z0-9][a-z0-9._:@-]{1,63}"),
    },
    "studio_action": {
        "conversation_id": re.compile(_CONV_ID),
        "action": STUDIO_ACTIONS,
        "surface": frozenset({"studio", "sheet"}),
        "kinds": _csv_of(_KINDS),
        "origin": frozenset({"native", "imported"}),
        "failure": frozenset({"network", "http_5xx", "http_429", "http_403", "http_402", "http_other"}),
        "import_id": re.compile(r"[A-Za-z0-9_:-]{1,64}"),
        # the store's own id shape (`user_definitions.DEF_ID_RE`): never a name or a word
        "def_id": re.compile(r"u_[0-9a-f]{12}"),
    },
}
_N = (int, float)
EVENT_SCHEMAS.update({
    "converse_turn": {
        "conversation_id": (str,), "access": (str,), "disposition": (str,),
        "outcome": (str,), "failure_class": (str,), "unsupported_category": (str,),
        "attempts": _N, "calls": _N, "repair_gate": (str,), "input_wrapper": (str,),
        "examples": (int,),
        "mended": (str,),
        "usd": _N, "input_tokens": _N, "output_tokens": _N,
        "cache_read_tokens": _N, "cache_write_tokens": _N, "latency_ms": _N,
        "op_kinds": (str,), "preflight": (bool,), "browser_codes": (str,),
        "prompt_sha": (str,), "vocab_version": (str,), "model": (str,), "engine": (int,),
        "asked": (str,), "answered": (str,), "remembered": (str,),
        "named_built": (str,), "acronym_built": (str,), "named_held": (str,), "unknown_name": (str,),
    },
    "studio_action": {
        "import_id": (str,), "conversation_id": (str,), "action": (str,),
        "surface": (str,), "kinds": (str,), "origin": (str,), "created": (bool,),
        "failure": (str,), "turns": _N,
        # ⭐ L7: on 'saved' only, the stored definition's own id (held to its pattern below)
        "def_id": (str,),
    },
})

# ─── ⭐ THE UCT RS COUNTS (plan §13; client `app/src/lib/rsTelemetry.js`) ────────
#
# Five events (six until U9 retired `rs_preset`), each carrying the correlation id the client always sends
# (`import_id`, a fresh `crypto.randomUUID()` per event, so nothing is folded by
# the de-dup lookup) and AT MOST ONE prop. ⛔ COUNTS ONLY, NEVER FREE TEXT: every
# prop is held to a closed set or a strict pattern below, so a legal key cannot
# carry a word a member typed. `dialect` is sent as null and therefore never
# stored.
#
#   rs_on / rs_off_within_60s  symbol   a ticker (`_RS_TICKER`)
#   rs_benchmark               value    a benchmark code the chart's menu offers
#                                       (`registry_defs.RS_LINE_BENCHMARKS_V4`, read live:
#                                       the v4 menu, CUSTOM included, as the JS enum)
#   rs_marker_card             kind     a readout row key that has a card (`RS_CARD_KINDS`)
#   rs_learn                   target   a lesson key of the definition (`RS_LEARN_TARGETS`)
#
# ⛔ The two closed sets are ONE FACT IN TWO FILES: the `rsLine` definition in
# `app/src/components/chart/engine/nativeRegistry.js` owns them (`meta.learn[].key`,
# the `readout[]` keys with a `card`), and `tests/test_rs_telemetry_door.py` PARSES
# that file and pins these equal, so a lesson or card added there without a line
# here reds the rail instead of being silently refused at the door. (`RS_PRESETS`,
# the third set, left with the `rs_preset` event: U9.) `RS_CARD_KINDS` is today's
# definition's full card list; the slim RS Line (`VITE_RS_SPLIT_ENABLED=1`) fires a
# subset of it, which the door accepts unchanged.

#: `meta.learn[].key` of the UCT RS definition.
RS_LEARN_TARGETS = frozenset({"rsLine", "phase", "newHigh", "beforePrice", "redDay", "fourChecks"})
#: The `readout[]` keys of the UCT RS definition whose row opens a card.
RS_CARD_KINDS = frozenset({"benchmarkName", "ratingSummary", "fastRating", "phase", "mansfield", "rsHigh",
                           "beforePrice", "redDay", "sensitivity", "regime", "checks",
                           "rotation", "quality", "vars", "ratingView"})
#: A chart symbol: upper-case letters and digits, with the class / exchange
#: separators the app's symbols use (`BRK-B`, `BRK.B`, `X:BTCUSD`). Never a word
#: in lower case, never a space.
_RS_TICKER = re.compile(r"[A-Z0-9][A-Z0-9.:-]{0,11}")
#: The correlation id: `crypto.randomUUID()`, or the client's fallback
#: (`<event>:<ms>:<base36>`). The `studio_action` id rule.
_RS_IMPORT_ID = re.compile(r"[A-Za-z0-9_:-]{1,64}")


def _rs_benchmark_ok(value: str) -> bool:
    """A benchmark code the RS chart menu offers. Read from the row module, so
    a code added there is accepted here with no second list; fails CLOSED when
    the row cannot be read. The v4 menu (CUSTOM included): a code, never the
    member's typed ticker, so the count stays free of free text."""
    try:
        from api.services.signature import registry_defs
        return value in registry_defs.RS_LINE_BENCHMARKS_V4
    except Exception:  # noqa: BLE001
        log.exception("[indicator-telemetry] RS benchmark list unavailable")
        return False


_RS_PROP = {"rs_on": "symbol", "rs_off_within_60s": "symbol",
            "rs_benchmark": "value", "rs_marker_card": "kind", "rs_learn": "target"}
_RS_PROP_RULE = {"symbol": _RS_TICKER, "value": _rs_benchmark_ok,
                 "kind": RS_CARD_KINDS, "target": RS_LEARN_TARGETS}
for _event, _prop in _RS_PROP.items():
    EVENT_SCHEMAS[_event] = {"import_id": (str,), _prop: (str,)}
    _VALUE_RULES[_event] = {"import_id": _RS_IMPORT_ID, _prop: _RS_PROP_RULE[_prop]}
del _event, _prop

#: Defense-in-depth ONLY — see the module docstring's 2026-09-04 hardening
#: note. The allowlist above is what actually keeps content out; this just
#: bounds an allowed field that arrives implausibly long.
_MAX_PROP_STRING_LEN = 200


def _type_ok(value: Any, allowed: tuple) -> bool:
    """`bool` is a subclass of `int` in Python — without this, a field typed
    `(int, float)` would silently accept `True`/`False`, and the reverse
    (a `(bool,)` field accepting a bare `0`/`1`) would be just as wrong. This
    treats the two as never interchangeable."""
    if isinstance(value, bool):
        return bool in allowed
    return isinstance(value, allowed)


def _prop_violation(event: str, key: str, value: Any) -> Optional[str]:
    """The ONE place both the lenient (server-side, drop) and strict
    (client-facing, reject) enforcement ask the same question, so the two
    can never disagree about what is allowed. Returns None iff `(key,
    value)` is a legal property of `event`; otherwise a short reason.
    """
    types = EVENT_SCHEMAS.get(event, {}).get(key)
    if types is None:
        return f"{key!r} is not an allowed property for event {event!r}"
    if isinstance(value, (list, dict)):
        return f"{key!r} must be a scalar, not a {type(value).__name__}"
    if not _type_ok(value, types):
        allowed_names = "/".join(t.__name__ for t in types)
        return f"{key!r} must be {allowed_names}, got {type(value).__name__}"
    if isinstance(value, str) and len(value) > _MAX_PROP_STRING_LEN:
        return f"{key!r} exceeds {_MAX_PROP_STRING_LEN} chars"
    rule = _VALUE_RULES.get(event, {}).get(key)
    if rule is not None and isinstance(value, str):
        if isinstance(rule, frozenset):
            ok = value in rule
        elif hasattr(rule, "fullmatch"):
            ok = rule.fullmatch(value) is not None
        else:
            ok = bool(rule(value))
        if not ok:
            return f"{key!r} is not one of the values this event may carry"
    return None


def sanitize_props(event: str, props: Optional[dict]) -> dict:
    """Lenient enforcement: drop anything `_prop_violation` flags, keep the
    rest. Never raises — matches `log_event`'s own "a telemetry failure must
    never break the product action it observes" contract. Returns a NEW
    dict; never mutates the input.
    """
    out: dict[str, Any] = {}
    for key, value in (props or {}).items():
        if value is None:
            continue
        if _prop_violation(event, key, value) is None:
            out[key] = value
    return out


def _already_logged(conn, user_id: str, event: str, import_id: str) -> bool:
    """Best-effort de-dup lookup. Never raises — a lookup failure must not
    block the (much more important) actual telemetry write."""
    try:
        row = conn.execute(
            "SELECT 1 FROM landing_events"
            " WHERE visitor_id = ? AND event = ?"
            "   AND json_extract(props, '$.import_id') = ?"
            " LIMIT 1",
            (user_id, event, import_id),
        ).fetchone()
        return row is not None
    except Exception:  # noqa: BLE001
        log.exception("[indicator-telemetry] dedup lookup failed for %s/%s", user_id, event)
        return False


def log_event(user_id: Any, event: str, *, import_id: Optional[str] = None,
              dialect: Optional[str] = None, def_id: Optional[str] = None,
              def_hash: Optional[str] = None, **extra: Any) -> bool:
    """Write one telemetry event. Returns True if a row was written, False if
    it was refused (unknown event) or skipped as a duplicate.

    Never raises: a telemetry failure must never break the product action it
    is observing. Every failure is logged and swallowed.
    """
    if event not in EVENTS:
        log.warning("[indicator-telemetry] refused unknown event %r", event)
        return False
    uid = str(user_id)
    raw_props: dict[str, Any] = dict(extra)
    if import_id is not None:
        raw_props["import_id"] = import_id
    if dialect is not None:
        raw_props["dialect"] = dialect
    if def_id is not None:
        raw_props["def_id"] = def_id
    if def_hash is not None:
        raw_props["def_hash"] = def_hash
    # ⭐ Every field — named kwarg or **extra alike — passes through the SAME
    # allowlist as the client-facing door. A caller cannot smuggle content
    # through `dialect=`/`def_id=` any more than through props: sanitize_props
    # sees the fully-merged dict and knows nothing about which arguments were
    # named vs. free-form.
    props = sanitize_props(event, raw_props)
    dropped = set(k for k, v in raw_props.items() if v is not None) - set(props.keys())
    if dropped:
        log.warning("[indicator-telemetry] dropped disallowed propert%s for %s: %s",
                    "y" if len(dropped) == 1 else "ies", event, sorted(dropped))
    try:
        conn = get_connection()
    except Exception:  # noqa: BLE001
        log.exception("[indicator-telemetry] could not open a connection for %s", event)
        return False
    try:
        if import_id and _already_logged(conn, uid, event, import_id):
            return False
        conn.execute(
            "INSERT INTO landing_events (visitor_id, event, props) VALUES (?, ?, ?)",
            (uid, event, json.dumps(props, separators=(",", ":")) if props else None),
        )
        conn.commit()
        return True
    except Exception:  # noqa: BLE001
        log.exception("[indicator-telemetry] write failed for %s/%s", uid, event)
        return False
    finally:
        conn.close()


# ─── ⭐ CONTROLLED ROLLOUT — the owner's report (aggregates only) ──────────────

def _pct(values: list, q: float):
    if not values:
        return None
    v = sorted(values)
    return v[min(len(v) - 1, max(0, int(round(q * (len(v) - 1)))))]


def _tally(values) -> dict:
    out: dict = {}
    for v in values:
        if v is None or v == "":
            continue
        out[str(v)] = out.get(str(v), 0) + 1
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))


def _turn_block(sel: list) -> dict:
    """Aggregates over `(user_id, day, props)` converse_turn rows."""
    usd = [float(p.get("usd") or 0) for _, _, p in sel]
    lat = [float(p["latency_ms"]) for _, _, p in sel if isinstance(p.get("latency_ms"), (int, float))]
    model_turns = [p for _, _, p in sel if (p.get("calls") or 0) >= 1]
    first = [p for p in model_turns if p.get("failure_class") == "ok" and (p.get("attempts") or 0) == 1]
    repaired = [p for p in model_turns if (p.get("calls") or 0) > 1 or p.get("repair_gate")]
    ok = [p for _, _, p in sel if p.get("failure_class") == "ok"]
    per_member_day: dict = {}
    for u, d, p in sel:
        cell = per_member_day.setdefault((u, d), {"turns": 0, "usd": 0.0})
        cell["turns"] += 1
        cell["usd"] += float(p.get("usd") or 0)
    return {
        "members": len({u for u, _, _ in sel}),
        "turns": len(sel),
        "model_turns": len(model_turns),
        "conversations": len({p.get("conversation_id") for _, _, p in sel if p.get("conversation_id")}),
        "first_pass": len(first),
        "first_pass_rate": round(len(first) / len(model_turns), 3) if model_turns else None,
        "repairs": len(repaired),
        "repair_rate": round(len(repaired) / len(model_turns), 3) if model_turns else None,
        "ok_rate": round(len(ok) / len(sel), 3) if sel else None,
        "usd_total": round(sum(usd), 4),
        "usd_per_turn_mean": round(sum(usd) / len(usd), 4) if usd else None,
        "usd_per_turn_median": _pct(usd, 0.5),
        "usd_per_member_day_max": round(max((v["usd"] for v in per_member_day.values()), default=0.0), 4),
        "turns_per_member_day_max": max((v["turns"] for v in per_member_day.values()), default=0),
        "latency_ms_p50": _pct(lat, 0.5),
        "latency_ms_p95": _pct(lat, 0.95),
        "cache_read_tokens": sum(int(p.get("cache_read_tokens") or 0) for _, _, p in sel),
        "cache_write_tokens": sum(int(p.get("cache_write_tokens") or 0) for _, _, p in sel),
        "by_disposition": _tally(p.get("disposition") for _, _, p in sel),
        "by_failure_class": _tally(p.get("failure_class") for _, _, p in sel),
        "unsupported_demand": _tally(p.get("unsupported_category") for _, _, p in sel),
        "op_kinds": _tally(o for _, _, p in sel for o in (p.get("op_kinds") or "").split(",") if o),
        # ⭐ WHICH CHECK CAUSED EACH REPAIR (the scoreboard's "which check caught it"): the door's own
        # gate, or `browser:refused` when the browser sent its refusal back; and for those, which of
        # the browser's rules. The top of each list is what to teach the assistant next.
        "repair_gates": _tally(p.get("repair_gate") for p in model_turns),
        "browser_refusals": _tally(c for p in model_turns for c in (p.get("browser_codes") or "").split(",") if c),
    }


def _cohort_state() -> dict:
    try:
        from api.services import rollout, rollout_gate
        return {"name": rollout_gate.CREATE_INDICATOR_COHORT,
                "switch_on": rollout_gate.create_indicator_cohort_enabled(),
                "tagged_members": len(rollout.cohort_user_ids(rollout_gate.CREATE_INDICATOR_COHORT))}
    except Exception:  # noqa: BLE001
        log.exception("[indicator-telemetry] cohort state unavailable")
        return {"name": "create-indicator", "switch_on": None, "tagged_members": None}


def _pool_state() -> dict:
    """Today's AI budget split by kind -- READ-ONLY, the same numbers
    `cost_guard.may_member_spend` (interactive) and `may_synthesize` (background)
    compare. Aggregates only: no user ids, no tickers."""
    try:
        from api.services.catalyst import cost_guard
        from api.services import definition_concierge as dc
        return cost_guard.budget_state(dc._market_date())
    except Exception:  # noqa: BLE001
        log.exception("[indicator-telemetry] pool state unavailable")
        return {}


def authoring_demand(days: int = 7, *, top: int = 12) -> dict:
    """⭐ L6 (Studio plan, section 7): what members asked Create Indicator for that it could
    not build, RANKED BY DISTINCT MEMBERS. One member asking ten times is one ask; ten members
    asking once each is ten. The rows are the closed demand categories each turn already
    carries (`definition_conversation.unsupported_category`), so nothing here can hold a
    member's words. READ-ONLY.

    ``other`` is the share the taxonomy cannot place yet: a falling ``unclassified_share``
    means it is learning. ``could_not_produce`` is a different signal, kept apart: requests
    the assistant tried and failed to express (a defect to fix, not demand to weigh).
    """
    days = max(1, min(int(days or 7), 90))
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT visitor_id, props, date(created_at) FROM landing_events"
            " WHERE event = 'converse_turn' AND created_at >= datetime('now', ?)",
            (f"-{days} days",),
        ).fetchall()
    finally:
        conn.close()
    cells: dict = {}
    invalid_members, invalid_turns = set(), 0
    for uid, props, day in rows:
        try:
            p = json.loads(props) if props else {}
        except ValueError:
            continue
        if p.get("failure_class") == "model_invalid":
            invalid_members.add(str(uid)); invalid_turns += 1
        cat = p.get("unsupported_category")
        if cat not in UNSUPPORTED_CATEGORIES:
            continue
        c = cells.setdefault(cat, {"members": set(), "cohort": set(), "turns": 0, "last_day": None})
        c["members"].add(str(uid))
        if p.get("access") == "cohort":
            c["cohort"].add(str(uid))
        c["turns"] += 1
        c["last_day"] = max(c["last_day"] or day, day)
    ranked = sorted(({"category": k, "members": len(v["members"]),
                     "members_excluding_admins": len(v["cohort"]),
                     "turns": v["turns"], "last_day": v["last_day"]} for k, v in cells.items()),
                    key=lambda r: (-r["members"], -r["turns"], r["category"]))
    for i, r in enumerate(ranked, 1):
        r["rank"] = i
    total = sum(r["turns"] for r in ranked)
    other = next((r for r in ranked if r["category"] == "other"), None)
    return {
        "window_days": days,
        "ranked": ranked[:max(1, int(top))],
        "categories": len(ranked),
        "unclassified_share": round(other["turns"] / total, 3) if (other and total) else (0.0 if total else None),
        "could_not_produce": {"members": len(invalid_members), "turns": invalid_turns},
    }


def kept_after(min_age_days: int = 7, window_days: int = 30) -> dict:
    """⭐ L7 (Studio plan, section 7): was it wanted? Of the indicators saved from the dock at
    least ``min_age_days`` ago (and within ``window_days`` before that), how many are still
    stored. A member who saved and then deleted it did not want it after all. READ-ONLY."""
    min_age = max(1, min(int(min_age_days or 7), 60))
    window = max(1, min(int(window_days or 30), 180))
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT visitor_id, props FROM landing_events WHERE event = 'studio_action'"
            " AND created_at < datetime('now', ?) AND created_at >= datetime('now', ?)",
            (f"-{min_age} days", f"-{min_age + window} days"),
        ).fetchall()
    finally:
        conn.close()
    saved = set()
    for uid, props in rows:
        try:
            p = json.loads(props) if props else {}
        except ValueError:
            continue
        d = p.get("def_id")
        if p.get("action") == "saved" and isinstance(d, str) and _DEF_ID.fullmatch(d):
            saved.add((str(uid), d))
    from api.services import user_definitions  # noqa: PLC0415
    kept = 0
    for uid, d in saved:
        try:
            row = user_definitions.get(uid, d)
        except Exception:  # noqa: BLE001 -- one unreadable row costs that row, not the report
            continue
        # `get` answers None for a definition its owner deleted (the store's own rule)
        if row is not None:
            kept += 1
    return {"min_age_days": min_age, "window_days": window, "saved": len(saved),
            "still_stored": kept,
            "still_stored_rate": round(kept / len(saved), 3) if saved else None}


_DEF_ID = re.compile(r"u_[0-9a-f]{12}")


# ─── ⭐ LEARN AS A PRODUCT -- the weekly owner report (aggregates only) ─────────────

#: A row about fewer than this many members (admins aside) does not show its numbers.
SMALL = 3
FEWER = f"fewer than {SMALL}"


def _is_built(p: dict) -> bool:
    return p.get("failure_class") == "ok" and p.get("disposition") == "change"


def _counted(rows: list, **splits) -> dict:
    """{members, turns, builders_turns, and one count per split} for one report row over
    `(member, props)` pairs. ``members`` counts distinct members WHO ARE NOT ADMINS; with one or
    two of them every member number of the row is withheld (``FEWER`` and None). The builders'
    own turns (admin accounts) are theirs to see and are counted apart. A split is a named test of
    one turn's props; its count is over the members' turns only."""
    cohort = [(u, p) for u, p in rows if p.get("access") != "admin"]
    members = len({u for u, _ in cohort})
    small = 0 < members < SMALL
    return {"members": FEWER if small else members,
            "turns": None if small else len(cohort),
            **{name: None if small else sum(1 for _, p in cohort if test(p)) for name, test in splits.items()},
            "builders_turns": len(rows) - len(cohort)}


def _name_row(asked: list, from_library: list) -> dict:
    """⭐ ONE NAME, THREE OUTCOMES (ruling 2026-11-18), so the library's queue and the recollection
    gap read apart:

      refused             the request named it and nothing was built
      built_unchecked     the request named it and something WAS built, from the assistant's own
                          recollection: no formula of ours stands behind the name
      built_from_library  built to the library's checked formula (once the library has the name)

    ``asked`` are the turns that named it in a spelling the library does not answer;
    ``from_library`` the turns that built its library entry. A turn in both is a library build:
    what the patch holds is the fact."""
    marks = {id(p) for _, p in from_library}
    return _counted(
        [t for t in asked if id(t[1]) not in marks] + list(from_library),
        refused=lambda p: not _is_built(p),                    # a library build is always a build
        built_unchecked=lambda p: id(p) not in marks and _is_built(p),
        built_from_library=lambda p: id(p) in marks)


def _ranked(rows: list) -> list:
    """Most members first; a withheld row after every row that shows a number, by name, so the
    order says nothing the row does not."""
    def key(r):
        shown = isinstance(r["members"], int)
        return (0 if shown else 1, -(r["members"] if shown else 0), -(r["turns"] or 0), str(r.get("id")))
    return sorted(rows, key=key)


def _question_block(sel: list) -> dict:
    """Questions over one window of `(member, props)` turns: how many were asked, by whom (the
    door's own, for nothing; the assistant's), and how many per indicator built."""
    door = [p for _, p in sel if p.get("asked") and p.get("asked") != "assistant"]
    assistant = [p for _, p in sel if p.get("asked") == "assistant"]
    built = [p for _, p in sel if _is_built(p)]
    from_memory = [p for p in built if p.get("remembered")]
    questions = len(door) + len(assistant)
    return {
        "turns": len(sel),
        "built": len(built),
        "questions": questions,
        "asked_by_the_door": len(door),
        "asked_by_the_assistant": len(assistant),
        "questions_per_built": round(questions / len(built), 3) if built else None,
        "question_share_of_turns": round(questions / len(sel), 3) if sel else None,
        "built_from_memory": len(from_memory),
        "built_from_memory_share": round(len(from_memory) / len(built), 3) if built else None,
        "by_question": _tally(p.get("asked") for p in door),
        "answered": _tally(p.get("answered") for _, p in sel),
        "remembered": _tally(q for _, p in sel for q in (p.get("remembered") or "").split(",") if q),
    }


def _internal_block(sel: list) -> dict:
    """⭐ TURNS THAT FAILED ON OUR SIDE (ruling 2026-11-18), over one window of `(member, props)`
    turns: the door raised, the member was told to try again, and nothing was changed. Its own
    outcome so the owner sees it. PLAIN COUNTS, never withheld: the number says what UCT did, and
    nothing about what any member asked for."""
    failed = [p for _, p in sel if p.get("failure_class") == "internal"]
    mine = [p for p in failed if p.get("access") == "admin"]
    return {"turns": len(failed), "members_turns": len(failed) - len(mine), "builders_turns": len(mine),
            "share_of_turns": round(len(failed) / len(sel), 3) if sel else None}


#: What a member's NEXT turn does when the indicator they were given was not the one they meant:
#: it takes the output away, rewrites its formula, or starts another indicator. (Changing a number
#: or a colour is ordinary use and is not counted.)
MISREAD_FOLLOW_UPS = frozenset({"remove_output", "set_output_tree", "create"})


def _acronym_rows(ordered: list, recent_ids: set) -> list:
    """⭐ ACRONYMS, WATCHED (ruling 2026-11-18). The requests on file could not say whether "OBV" is
    ever read wrongly: nobody had typed one. So every build that came from an acronym is its own row,
    with the one signal a misread leaves: the member's NEXT turn in that conversation removes or
    rewrites what was built. ``ordered`` is every fetched turn as (row id, member, props), oldest
    first; a row counts when its id is in ``recent_ids`` (this window)."""
    from api.services import named_indicators  # noqa: PLC0415
    next_in = {}
    last_seen: dict = {}
    for rid, _u, p in ordered:
        cid = p.get("conversation_id")
        if cid and cid in last_seen:
            next_in[last_seen[cid]] = p
        if cid:
            last_seen[cid] = rid
    cells: dict = {}
    for rid, u, p in ordered:
        if rid not in recent_ids:
            continue
        for entry_id in (p.get("acronym_built") or "").split(","):
            if entry_id:
                after = next_in.get(rid) or {}
                changed = bool(MISREAD_FOLLOW_UPS & set((after.get("op_kinds") or "").split(",")))
                cells.setdefault(entry_id, []).append((u, {**p, "_changed_next": changed}))
    rows = []
    for entry_id, sel in cells.items():
        e = named_indicators.entry(entry_id) or {}
        rows.append({"id": entry_id, "name": e.get("name"), "acronyms": list(e.get("acronyms") or ()),
                     **_counted(sel, changed_or_removed_next=lambda p: p["_changed_next"])})
    return _ranked(rows)


def bar_field_order_block(definitions: Any, is_admin: Any) -> dict:
    """⭐ SAVED INDICATORS THAT CARRY THE WRONG ARGUMENT ORDER (coordinator's request, 2026-11-18).
    Until that day an assistant's `stoch(close, high, low, 14)` (TradingView's order) was accepted
    as written, though the engine takes high, low, close: a different number on every bar. The door
    mends new answers. This counts what was SAVED before it did: live saved indicators one of whose
    formulas calls such a function with the bar's own fields plainly out of order
    (`definition_conversation.misordered_bar_fields`, the door's own rule).

    READ-ONLY, COUNTS ONLY. ⛔ NOTHING IS CHANGED HERE OR ANYWHERE BY THIS: a saved formula is the
    member's, and correcting one needs its own ruling. `definitions` are stored rows
    (`user_definitions.live_definitions`); `is_admin(user_id)` says whose are the builders' own.
    A row about one or two members withholds its numbers, as every row of this report does."""
    from api.services import definition_conversation, indicator_habits  # noqa: PLC0415
    members: dict = {}
    builders = 0
    functions: dict = {}
    seen = 0
    for row in definitions or ():
        seen += 1
        names = [n for tree in indicator_habits._trees_of(row) for n in definition_conversation.misordered_bar_fields(tree)]
        if not names:
            continue
        uid = str(row.get("user_id"))
        if is_admin(uid):
            builders += 1
            continue
        members[uid] = members.get(uid, 0) + 1
        for n in set(names):
            functions[n] = functions.get(n, 0) + 1
    small = 0 < len(members) < SMALL
    return {"read": True, "saved_indicators_looked_at": seen,
            "members": FEWER if small else len(members),
            "indicators": None if small else sum(members.values()),
            "by_function": None if small else dict(sorted(functions.items())),
            "builders_indicators": builders}


def _bar_field_order() -> dict:
    """`bar_field_order_block` over the live store. ⛔ A READ THAT FAILS SAYS SO: it is never a zero
    (a swallowed error here would read as "no saved indicator is affected")."""
    try:
        from api.services import auth_service, user_definitions  # noqa: PLC0415

        def is_admin(uid: str) -> bool:
            return ((auth_service.get_user_by_id(uid) or {}).get("role")) == "admin"

        return bar_field_order_block(user_definitions.live_definitions(), is_admin)
    except Exception:  # noqa: BLE001 -- the report still answers; this section says it could not be read
        log.exception("[indicator-telemetry] the saved indicators could not be read for the argument-order count")
        return {"read": False}


def weekly_report(days: int = 7) -> dict:
    """⭐ THE WEEKLY OWNER REPORT (admin only). What members asked Create Indicator for, and how it
    answered, over the last ``days`` against the ``days`` before. READ-ONLY, AGGREGATES ONLY: every
    row is a closed id the turn recorded (a question, a library entry, a catalogue name), so no
    member's words can be here; and a row about one or two members withholds its numbers.

    It feeds two queues by demand: ``names`` says which indicators to add to the library next;
    ``questions`` says which questions cost members turns, and whether asking is growing."""
    days = max(1, min(int(days or 7), 45))
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT id, visitor_id, props, created_at >= datetime('now', ?) FROM landing_events"
            " WHERE event = 'converse_turn' AND created_at >= datetime('now', ?) ORDER BY id",
            (f"-{days} days", f"-{2 * days} days"),
        ).fetchall()
    finally:
        conn.close()
    this, previous, ordered, recent_ids = [], [], [], set()
    for rid, uid, props, recent in rows:
        try:
            p = json.loads(props) if props else {}
        except ValueError:
            continue
        (this if recent else previous).append((str(uid), p))
        ordered.append((rid, str(uid), p))
        if recent:
            recent_ids.add(rid)

    from api.services import indicator_names, named_indicators  # noqa: PLC0415
    in_library = indicator_names.now_in_library()

    def since(entry_id):
        e = named_indicators.entry(entry_id) or {}
        return next((v.get("since") for v in e.get("versions") or [] if v.get("since")), None)

    asked: dict = {}
    held: dict = {}
    built: dict = {}
    for u, p in this:
        for nid in (p.get("unknown_name") or "").split(","):
            if nid:
                asked.setdefault(nid, []).append((u, p))
        for hid in (p.get("named_held") or "").split(","):
            if hid:
                held.setdefault(hid, []).append((u, p))
        for bid in (p.get("named_built") or "").split(","):
            if bid:
                built.setdefault(bid, []).append((u, p))
    names = []
    # every catalogue name asked for, and every one the library has gained that was built this window
    for nid in list(asked) + [n for n, e in in_library.items() if n not in asked and e in built]:
        if nid == indicator_names.OTHER:
            continue
        entry_id = in_library.get(nid)
        names.append({"id": nid, "name": indicator_names.name_of(nid),
                      **_name_row(asked.get(nid, []), built.get(entry_id, []) if entry_id else []),
                      "in_library": entry_id, "in_library_since": since(entry_id) if entry_id else None})

    def library_rows(cells):
        return _ranked([{"id": k, "name": (named_indicators.entry(k) or {}).get("name"), **_counted(v)}
                        for k, v in cells.items()])

    block = _turn_block([(u, None, p) for u, p in this])
    return {
        "window_days": days,
        "withheld_below_members": SMALL,
        # 1. what could not be built, ranked by distinct members (L6)
        "demand": authoring_demand(days),
        # 2. names asked for that are not built by name: the library's queue
        "names": {
            "asked_for": _ranked(names),
            "held_and_refused": library_rows(held),
            "not_in_the_catalogue": _counted(asked.get(indicator_names.OTHER, [])),
        },
        # 3. questions: this window against the one before
        "questions": {"this": _question_block(this), "previous": _question_block(previous)},
        # 4. which checks cost a second call
        "second_calls": {"repair_gates": block["repair_gates"], "browser_refusals": block["browser_refusals"],
                         "repair_rate": block["repair_rate"]},
        # 5. named indicators built, by library entry
        "named_built": library_rows(built),
        # 6. the ones named by ACRONYM, and how often the next turn removed or rewrote what was built
        "built_from_an_acronym": _acronym_rows(ordered, recent_ids),
        # 7. turns that failed on OUR side (an internal error), this window against the one before
        "internal_error": {"this": _internal_block(this), "previous": _internal_block(previous)},
        # 8. saved indicators carrying a function's bar fields in another order than the engine's
        #    (as of now, not a window: it is a count of what is stored)
        "bar_field_order": _bar_field_order(),
    }


def weekly_report_text(report: dict) -> str:
    """The weekly report in plain words, for reading in a browser tab. Built ONLY from what
    ``weekly_report`` returned, so it can hold nothing that report does not."""
    days = report["window_days"]
    this, before = report["questions"]["this"], report["questions"]["previous"]

    def was(key):
        return f" (the {days} days before: {before[key] if before[key] is not None else 'none'})"

    def people(row, noun):
        if row["members"] == FEWER:
            line = f"{FEWER} members"
        else:
            line = f"{row['members']} member{'' if row['members'] == 1 else 's'}, {row['turns']} {noun}"
        if row.get("builders_turns"):
            line += f"; {row['builders_turns']} by the builders' own accounts"
        return line

    def question_text(qid):
        try:
            from api.services import definition_conversation
            return definition_conversation.clarify_registry()[qid]["text"]
        except Exception:  # noqa: BLE001
            return qid

    out = [f"Create Indicator: the last {days} days",
           "Counts only. Nothing here is a member's words, and a row about one or two members shows no numbers.",
           "",
           "QUESTIONS",
           f"  Indicators built: {this['built']}{was('built')}",
           f"  Questions asked: {this['questions']}{was('questions')}"
           f": {this['asked_by_the_door']} by the door (no AI call), {this['asked_by_the_assistant']} by the assistant",
           f"  Questions per indicator built: "
           f"{this['questions_per_built'] if this['questions_per_built'] is not None else 'none built'}{was('questions_per_built')}",
           f"  Built using a remembered choice: {this['built_from_memory']} of {this['built']}"]
    for qid, n in this["by_question"].items():
        out.append(f"  Asked {n} time{'' if n == 1 else 's'}: {question_text(qid)}")

    failed, failed_before = report["internal_error"]["this"], report["internal_error"]["previous"]
    out += ["", "FAILED ON OUR SIDE (an internal error: the member was told to try again, nothing was changed)",
            f"  {failed['turns']} turn{'' if failed['turns'] == 1 else 's'}"
            + (f": {failed['members_turns']} for members, {failed['builders_turns']} for the builders' own accounts"
               if failed["turns"] else "")
            + f" (the {days} days before: {failed_before['turns']})"]

    order = report.get("bar_field_order") or {"read": False}
    out += ["", "SAVED INDICATORS WITH A FUNCTION'S HIGH, LOW AND CLOSE IN THE WRONG ORDER (stored today; nothing is changed)"]
    if not order.get("read"):
        out.append("  Could not be read this time. This is not a zero.")
    else:
        if order["members"] == FEWER:
            out.append(f"  {FEWER} members have one")
        else:
            out.append(f"  {order['indicators']} saved indicator{'' if order['indicators'] == 1 else 's'} of "
                       f"{order['members']} member{'' if order['members'] == 1 else 's'}"
                       + ("".join(f"; {fn}: {n}" for fn, n in (order["by_function"] or {}).items())))
        out.append(f"  The builders' own accounts: {order['builders_indicators']}"
                   f" (of {order['saved_indicators_looked_at']} saved indicators looked at)")

    names = report["names"]
    out += ["", "NAMES ASKED FOR THAT ARE NOT BUILT BY NAME (the library's queue)"]
    for row in names["asked_for"]:
        line = f"  {row['name'] or row['id']}: {people(row, 'requests')}"
        for key, words in (("refused", "refused"),
                           ("built_unchecked", "built unchecked, from the assistant's own recollection"),
                           ("built_from_library", "built from the library")):
            if row[key]:
                line += f"; {row[key]} {words}"
        if row["in_library"]:
            line += f"; in the library since {row['in_library_since'] or 'it was added'}"
        out.append(line)
    if not names["asked_for"]:
        out.append("  None.")
    other = names["not_in_the_catalogue"]
    if other["members"] or other["builders_turns"]:
        out.append(f"  Names in no list: {people(other, 'requests')}")

    out += ["", "NAMES UCT KNOWS AND DOES NOT BUILD YET (refused by name)"]
    out += [f"  {r['name'] or r['id']}: {people(r, 'requests')}" for r in names["held_and_refused"]] or ["  None."]

    out += ["", "NAMED INDICATORS BUILT FROM THE LIBRARY"]
    out += [f"  {r['name'] or r['id']}: {people(r, 'builds')}" for r in report["named_built"]] or ["  None."]

    out += ["", "BUILT FROM AN ACRONYM (and how often the next turn removed or rewrote it: a misread's mark)"]
    for r in report["built_from_an_acronym"]:
        line = f"  {'/'.join(a.upper() for a in r['acronyms']) or r['id']} as {r['name'] or r['id']}: {people(r, 'builds')}"
        if r["changed_or_removed_next"]:
            line += f"; {r['changed_or_removed_next']} removed or rewritten on the next turn"
        out.append(line)
    if not report["built_from_an_acronym"]:
        out.append("  None.")

    out += ["", "WHAT COULD NOT BUILD, BY KIND"]
    out += [f"  {r['category'].replace('_', ' ')}: {r['members']} member{'' if r['members'] == 1 else 's'}, {r['turns']} requests"
            for r in report["demand"]["ranked"]] or ["  Nothing."]

    second = report["second_calls"]
    out += ["", "ANSWERS THAT NEEDED A SECOND AI CALL",
            f"  Share: {'none recorded' if second['repair_rate'] is None else str(round(second['repair_rate'] * 100)) + '%'}"]
    out += [f"  {gate}: {n}" for gate, n in list(second["repair_gates"].items())[:5]]
    out += [f"  the browser's rule {code}: {n}" for code, n in list(second["browser_refusals"].items())[:5]]
    return "\n".join(out) + "\n"


def rollout_report(days: int = 7) -> dict:
    """What the rollout cohort is doing with Create Indicator: the two structured
    events above plus the shared spend ledger. READ-ONLY; aggregates only — the
    store holds no member words, so none can be returned.

    One key per owner question: who used it, turns, spend, repair, latency, saves,
    the save rate, unsupported demand, recurring errors, and headroom under the
    shared member ceiling. ``cohort_members`` excludes admins (``access``)."""
    days = max(1, min(int(days or 7), 90))
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT visitor_id, event, props, date(created_at) FROM landing_events"
            " WHERE event IN ('converse_turn','studio_action')"
            "   AND created_at >= datetime('now', ?)",
            (f"-{days} days",),
        ).fetchall()
    finally:
        conn.close()
    turns, actions = [], []
    for uid, event, props, day in rows:
        try:
            p = json.loads(props) if props else {}
        except ValueError:
            continue
        (turns if event == "converse_turn" else actions).append((str(uid), day, p))
    convs: dict = {}
    for _, _, p in actions:
        cid = p.get("conversation_id")
        if cid:
            convs.setdefault(cid, set()).add(p.get("action"))
    started = [c for c, a in convs.items() if "opened" in a or "preview" in a]
    saved = [c for c, a in convs.items() if "saved" in a]
    return {
        "window_days": days,
        "cohort": _cohort_state(),
        "cohort_members": _turn_block([t for t in turns if t[2].get("access") == "cohort"]),
        "everyone_incl_admins": _turn_block(turns),
        "funnel": {
            "opened_by_members": len({u for u, _, p in actions if p.get("action") == "opened"}),
            "conversations_started": len(started),
            "reached_preview": len([c for c, a in convs.items() if "preview" in a]),
            "saved": len(saved),
            "discarded": len([c for c, a in convs.items() if "discarded" in a]),
            "undone": len([c for c, a in convs.items() if "undone" in a]),
            # Undone and still saved: it took a correction to get there.
            "saved_after_undo": len([c for c, a in convs.items() if "undone" in a and "saved" in a]),
            "save_failed": len([c for c, a in convs.items() if "save_failed" in a]),
            "save_rate": round(len(saved) / len(started), 3) if started else None,
            "client_turn_failures": _tally(p.get("failure") for _, _, p in actions
                                           if p.get("action") == "turn_failed"),
            "saved_kinds": _tally(k for _, _, p in actions if p.get("action") == "saved"
                                  for k in (p.get("kinds") or "").split(",") if k),
            "saved_origin": _tally(p.get("origin") for _, _, p in actions if p.get("action") == "saved"),
        },
        # Which instructions, vocabulary, model and engine produced the window's turns
        # (`definition_conversation.turn_stamps`). More than one value in a row means a
        # change landed inside the window, so its rates mix two versions.
        "produced_by": {k: _tally(p.get(k) for _, _, p in turns if p.get(k) is not None)
                        for k in ("prompt_sha", "vocab_version", "model", "engine")},
        "shared_pool_today": _pool_state(),
        # ⭐ L6: what could not be built, ranked by distinct members
        "demand": authoring_demand(days),
        # ⭐ L7: saved from the dock a week or more ago, and still stored
        "kept_after_7_days": kept_after(7, 30),
    }
