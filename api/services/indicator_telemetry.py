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

## What this module will NOT log

⛔ NEVER the raw pasted script/thinkScript/PCF text, and NEVER uploaded
screenshot bytes. `props` carries shape (dialect, success/failure, error
class, source length) — enough to reconstruct a journey and diagnose a
failure class, never enough to reconstruct WHAT a member typed. This mirrors
`CURRENT_ARCHITECTURE.md`'s own standing decision that raw source text is
transient and never persisted for the definitions store itself; telemetry
must not quietly become the place that persists it instead.

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
    props: dict[str, Any] = dict(extra)
    if import_id is not None:
        props["import_id"] = import_id
    if dialect is not None:
        props["dialect"] = dialect
    if def_id is not None:
        props["def_id"] = def_id
    if def_hash is not None:
        props["def_hash"] = def_hash
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
