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
})

#: Of the five, only these two are ever fired FROM THE CLIENT (the three
#: paste dialects compile in-browser, so the backend never sees a submit/
#: compile attempt for them unless the client reports it). The other three
#: are server-derived only — a client must never be able to claim its own
#: formula was "accepted" or "delivered"; that would let an unaccepted or
#: unvalidated definition masquerade as a real one in the journey data.
CLIENT_FIREABLE_EVENTS = frozenset({"import_submitted", "compile_finished", "studio_action"})

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
_CONVERSE_OPS = frozenset({
    "create", "rename_definition", "add_output", "remove_output", "rename_output",
    "set_output_tree", "set_slot", "add_clause", "remove_clause", "set_intent",
    "set_placement", "set_style", "set_marker", "remove_marker", "set_paint",
    "remove_paint", "request_info_value", "request_alert", "cancel_request",
    "set_levels", "set_fill", "remove_fill",
})
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


_VALUE_RULES: dict = {
    "converse_turn": {
        "conversation_id": re.compile(_CONV_ID),
        "access": frozenset({"admin", "cohort"}),
        "disposition": frozenset({"change", "answer", "clarify", "unsupported", "none"}),
        "outcome": re.compile(r"(patch|question|noop|[a-z_-]{2,32}:[a-z0-9_-]{2,48})"),
        "failure_class": FAILURE_CLASSES,
        "unsupported_category": UNSUPPORTED_CATEGORIES,
        "repair_gate": re.compile(r"[a-z_-]{2,32}:[a-z0-9_-]{2,48}"),
        "input_wrapper": frozenset({"args"}),
        "op_kinds": _csv_of(_CONVERSE_OPS),
    },
    "studio_action": {
        "conversation_id": re.compile(_CONV_ID),
        "action": STUDIO_ACTIONS,
        "surface": frozenset({"studio", "sheet"}),
        "kinds": _csv_of(_KINDS),
        "origin": frozenset({"native", "imported"}),
        "failure": frozenset({"network", "http_5xx", "http_429", "http_403", "http_402", "http_other"}),
        "import_id": re.compile(r"[A-Za-z0-9_:-]{1,64}"),
    },
}
_N = (int, float)
EVENT_SCHEMAS.update({
    "converse_turn": {
        "conversation_id": (str,), "access": (str,), "disposition": (str,),
        "outcome": (str,), "failure_class": (str,), "unsupported_category": (str,),
        "attempts": _N, "calls": _N, "repair_gate": (str,), "input_wrapper": (str,),
        "usd": _N, "input_tokens": _N, "output_tokens": _N,
        "cache_read_tokens": _N, "cache_write_tokens": _N, "latency_ms": _N,
        "op_kinds": (str,), "preflight": (bool,),
    },
    "studio_action": {
        "import_id": (str,), "conversation_id": (str,), "action": (str,),
        "surface": (str,), "kinds": (str,), "origin": (str,), "created": (bool,),
        "failure": (str,), "turns": _N,
    },
})

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
    """Today's TOTAL AI spend against the shared member ceiling (hard cap minus the
    scheduled reserve) -- READ-ONLY, the numbers `cost_guard.may_member_spend` compares."""
    try:
        import os
        from api.services.catalyst import cost_guard, store
        from api.services import definition_concierge as dc
        hard = float(os.environ.get("CATALYST_COST_HARD_CAP", "15.00"))
        ceiling = max(0.0, hard - cost_guard.scheduled_reserve_usd())
        spent = float(store.cost_stats_for_date(dc._market_date()).get("total_cost_usd", 0.0))
        return {"spent_usd": round(spent, 4), "member_ceiling_usd": ceiling, "hard_cap_usd": hard,
                "headroom_usd": round(max(0.0, ceiling - spent), 4),
                "used_fraction": round(spent / ceiling, 3) if ceiling else None}
    except Exception:  # noqa: BLE001
        log.exception("[indicator-telemetry] pool state unavailable")
        return {}


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
            "save_failed": len([c for c, a in convs.items() if "save_failed" in a]),
            "save_rate": round(len(saved) / len(started), 3) if started else None,
            "client_turn_failures": _tally(p.get("failure") for _, _, p in actions
                                           if p.get("action") == "turn_failed"),
            "saved_kinds": _tally(k for _, _, p in actions if p.get("action") == "saved"
                                  for k in (p.get("kinds") or "").split(",") if k),
            "saved_origin": _tally(p.get("origin") for _, _, p in actions if p.get("action") == "saved"),
        },
        "shared_pool_today": _pool_state(),
    }
