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
})

#: Of the five, only these two are ever fired FROM THE CLIENT (the three
#: paste dialects compile in-browser, so the backend never sees a submit/
#: compile attempt for them unless the client reports it). The other three
#: are server-derived only — a client must never be able to claim its own
#: formula was "accepted" or "delivered"; that would let an unaccepted or
#: unvalidated definition masquerade as a real one in the journey data.
CLIENT_FIREABLE_EVENTS = frozenset({"import_submitted", "compile_finished"})

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
