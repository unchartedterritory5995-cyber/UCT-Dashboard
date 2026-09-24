"""Client error beacon — the server half (D14: our own reporter, no new vendor).

The browser half is `app/src/lib/errorBeacon.js`. It scrubs before it sends;
this module is the SECOND layer and deliberately does not restate the first.

What the two layers each own
----------------------------
* The CLIENT owns the one judgement only the page can make: which words in a
  message could be a member's own writing. It sends a message SKELETON (engine
  vocabulary and code-shaped tokens survive, everything else is `…`) and no
  DOM content at all.
* THIS side owns transport safety, and applies it whatever the client did —
  an old bundle, a hostile caller, a bug in the scrub: every URL loses its
  query AND fragment (share and login tokens ride in fragments —
  `/smoke-login#token=…` is the live example), every field is capped, control
  characters go, and the row carries a HASH of the rate key rather than a raw
  IP address.

⛔ The message skeleton is NOT re-implemented here. Two copies of one
redaction rule drift the moment either changes, and the copy nobody tests is
the one that leaks (`lesson_a_second_authority_over_one_value`).

Storage
-------
Its own SQLite file, `CLIENT_ERRORS_DB_PATH` (default `/data/client_errors.db`,
read at CALL time so the conftest census pins it and a monkeypatch reaches it).
Rows are kept `RETENTION_DAYS` (14) and pruned opportunistically on write.

Rate limit
----------
Per session (a signed-in member) or per IP (anyone else), counted from the
STORED rows — durable across a restart, and correct on more than one process,
because the store is the only counter. A global hourly ceiling sits above it so
a caller rotating addresses cannot fill the volume.

Kill switch
-----------
`CLIENT_ERROR_BEACON_ENABLED` — unset or anything but an off value means ON;
`0` / `false` / `no` / `off` means OFF. Read per request, so turning it off
needs no redeploy (docs/feature_flags.json).
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import sqlite3
import threading
import time
from typing import Any

logger = logging.getLogger(__name__)

KILL_SWITCH = "CLIENT_ERROR_BEACON_ENABLED"
_OFF_VALUES = {"0", "false", "no", "off"}

RETENTION_DAYS = 14
RATE_LIMIT = 30                 # stored reports per key per window
RATE_WINDOW_S = 600             # ten minutes
GLOBAL_LIMIT_PER_HOUR = 2000    # every key together
MAX_REPORTS_PER_REQUEST = 10
MAX_BODY_BYTES = 64 * 1024

# Field caps. The client caps too (message 500, stack 4000); these are the
# server's own ceilings and may be equal — they are not derived from the
# client, because the client is exactly what this layer does not trust.
CAP_NAME = 100
CAP_MESSAGE = 500
CAP_STACK = 4000
CAP_COMPONENT_STACK = 2000
CAP_PAGE = 300
CAP_USER_AGENT = 300

KINDS = ("error", "unhandledrejection", "boundary")

_PRUNE_EVERY_S = 3600
_last_prune = 0.0
_init_lock = threading.Lock()
_initialised: set[str] = set()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS client_errors (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at      REAL NOT NULL,
    rate_key        TEXT NOT NULL,
    user_id         TEXT,
    kind            TEXT NOT NULL,
    name            TEXT NOT NULL DEFAULT '',
    message         TEXT NOT NULL DEFAULT '',
    stack           TEXT NOT NULL DEFAULT '',
    component_stack TEXT NOT NULL DEFAULT '',
    page            TEXT NOT NULL DEFAULT '',
    user_agent      TEXT NOT NULL DEFAULT '',
    client_ts       REAL
);
CREATE INDEX IF NOT EXISTS idx_client_errors_rate ON client_errors(rate_key, created_at);
CREATE INDEX IF NOT EXISTS idx_client_errors_created ON client_errors(created_at);
"""


def db_path() -> str:
    return os.environ.get("CLIENT_ERRORS_DB_PATH", "/data/client_errors.db")


def enabled() -> bool:
    """Per-request read of the kill switch. Unset means ON."""
    raw = os.environ.get(KILL_SWITCH)
    if raw is None:
        return True
    return raw.strip().lower() not in _OFF_VALUES


def _connect() -> sqlite3.Connection:
    path = db_path()
    conn = sqlite3.connect(path, timeout=2)
    conn.row_factory = sqlite3.Row
    if path not in _initialised:
        with _init_lock:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(_SCHEMA)
            conn.commit()
            _initialised.add(path)
    conn.execute("PRAGMA busy_timeout=2000")
    return conn


# ── Transport scrub (the server's layer) ───────────────────────────────────

# A URL with a scheme, up to the first character that cannot be part of one.
_SCHEMED_URL = re.compile(r"[A-Za-z][A-Za-z0-9+.\-]*://[^\s'\"()<>]+")
# A path that starts with "/" and carries a query or a fragment. The leading
# group keeps the character before it, so no lookbehind is needed.
_REL_URL = re.compile(r"(^|[\s(\"'=])(/[^\s?#'\"()<>]*)([?#][^\s'\"()<>]*)")
# A bare `#…` / `?…` token that carries a `name=value` — a fragment or query
# quoted on its own, with no path in front of it to anchor the two rules above.
_BARE_PARAMS = re.compile(r"(^|[\s(\"'=])[#?][^\s'\"()<>]*=[^\s'\"()<>]*")
# Credential-shaped `name=value` anywhere: the value goes, the name stays so
# the report still says what kind of thing was there.
_CREDENTIAL = re.compile(
    r"\b(access_token|id_token|refresh_token|token|api_key|apikey|key|secret|password|"
    r"passwd|pass|code|session|sid|sig|signature|auth)=[^\s&;'\"()<>]*",
    re.IGNORECASE,
)
# `data:` URIs carry their payload inline — it can be anything at all.
_DATA_URI = re.compile(r"data:[^\s'\"()<>]+", re.IGNORECASE)
# The `:line:col` a stack frame puts after its script URL. Only the two-number
# form, and only after a script path (see `_frame_tail`): a single trailing
# `:digits` is as likely to be the end of a token as a line number.
_LINE_COL = re.compile(r"(:\d+:\d+)$")
_SCRIPT_PATH = re.compile(r"\.(?:m?jsx?|cjs|tsx?|html?)$", re.IGNORECASE)
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _frame_tail(path: str, rest: str) -> str:
    """The `:line:col` to keep after a cut, or ''. A script path only."""
    if not _SCRIPT_PATH.search(path):
        return ""
    tail = _LINE_COL.search(rest)
    return tail.group(1) if tail else ""


def scrub_url(url: Any) -> str:
    """Origin + path only. The query AND the fragment go, whatever they hold."""
    if not isinstance(url, str):
        return ""
    if url[:5].lower() == "data:":
        return "data:[removed]"
    cut = len(url)
    for ch in ("?", "#"):
        i = url.find(ch)
        if i != -1:
            cut = min(cut, i)
    if cut == len(url):
        return url
    # A stack frame's :line:col sat AFTER the query; keep it, it is not a secret.
    return url[:cut] + _frame_tail(url[:cut], url[cut:])


def scrub_text(text: Any) -> str:
    """Every URL inside free text loses its query and fragment."""
    if not isinstance(text, str) or not text:
        return ""
    text = _DATA_URI.sub("data:[removed]", text)
    text = _SCHEMED_URL.sub(lambda m: scrub_url(m.group(0)), text)

    def _rel(m: re.Match) -> str:
        return m.group(1) + m.group(2) + _frame_tail(m.group(2), m.group(3))

    text = _REL_URL.sub(_rel, text)
    text = _BARE_PARAMS.sub(lambda m: m.group(1) + "[removed]", text)
    return _CREDENTIAL.sub(lambda m: m.group(1) + "=[removed]", text)


def _clean(value: Any, cap: int, *, text: bool = True) -> str:
    if not isinstance(value, str):
        return ""
    value = _CONTROL.sub("", value)
    if text:
        value = scrub_text(value)
    return value[:cap]


def normalise_report(raw: Any) -> dict[str, Any] | None:
    """One client report → one storable row, or None if it is not a report."""
    if not isinstance(raw, dict):
        return None
    kind = raw.get("kind")
    if kind not in KINDS:
        return None
    ts = raw.get("ts")
    client_ts = float(ts) if isinstance(ts, (int, float)) and not isinstance(ts, bool) else None
    return {
        "kind": kind,
        "name": _clean(raw.get("name"), CAP_NAME),
        "message": _clean(raw.get("message"), CAP_MESSAGE),
        "stack": _clean(raw.get("stack"), CAP_STACK),
        "component_stack": _clean(raw.get("componentStack"), CAP_COMPONENT_STACK),
        "page": scrub_url(_clean(raw.get("page"), CAP_PAGE * 4, text=False))[:CAP_PAGE],
        "client_ts": client_ts,
    }


def rate_key_for(user_id: str | None, ip: str | None) -> str:
    """A stable, non-reversible key: a member by id, anyone else by address.

    ⛔ Hashed so the table never holds a raw IP. The salt is the table's own
    name — not a secret, and it does not need to be one: the point is that a
    row read out of this file is not a list of addresses."""
    basis = f"user:{user_id}" if user_id else f"ip:{ip or 'unknown'}"
    return hashlib.sha256(f"client_errors|{basis}".encode("utf-8")).hexdigest()[:24]


def _prune(conn: sqlite3.Connection, now: float) -> int:
    cur = conn.execute(
        "DELETE FROM client_errors WHERE created_at < ?",
        (now - RETENTION_DAYS * 86400,),
    )
    return cur.rowcount or 0


def prune(now: float | None = None) -> int:
    """Delete rows past retention. Safe to call from a scheduler."""
    now = time.time() if now is None else now
    conn = _connect()
    try:
        n = _prune(conn, now)
        conn.commit()
        return n
    finally:
        conn.close()


def record_reports(
    reports: list[Any],
    *,
    user_id: str | None,
    ip: str | None,
    user_agent: str | None,
    now: float | None = None,
) -> dict[str, int]:
    """Store what the rate limit allows. Returns `{stored, dropped, invalid}`.

    ⛔ The limit is COUNTED FROM THE STORE, inside the same transaction as the
    insert, so two requests racing cannot each see room for the same slot."""
    global _last_prune
    now = time.time() if now is None else now
    rows = [r for r in (normalise_report(x) for x in reports[:MAX_REPORTS_PER_REQUEST]) if r]
    invalid = min(len(reports), MAX_REPORTS_PER_REQUEST) - len(rows)
    over_cap = max(0, len(reports) - MAX_REPORTS_PER_REQUEST)
    if not rows:
        return {"stored": 0, "dropped": over_cap, "invalid": invalid}

    key = rate_key_for(user_id, ip)
    ua = _clean(user_agent, CAP_USER_AGENT, text=False)
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        used = conn.execute(
            "SELECT COUNT(*) FROM client_errors WHERE rate_key = ? AND created_at >= ?",
            (key, now - RATE_WINDOW_S),
        ).fetchone()[0]
        global_used = conn.execute(
            "SELECT COUNT(*) FROM client_errors WHERE created_at >= ?",
            (now - 3600,),
        ).fetchone()[0]
        room = max(0, min(RATE_LIMIT - used, GLOBAL_LIMIT_PER_HOUR - global_used))
        keep = rows[:room]
        for r in keep:
            conn.execute(
                "INSERT INTO client_errors (created_at, rate_key, user_id, kind, name,"
                " message, stack, component_stack, page, user_agent, client_ts)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (now, key, user_id, r["kind"], r["name"], r["message"], r["stack"],
                 r["component_stack"], r["page"], ua, r["client_ts"]),
            )
        if now - _last_prune >= _PRUNE_EVERY_S:
            _prune(conn, now)
            _last_prune = now
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    for r in keep:
        first_frame = next((ln.strip() for ln in r["stack"].splitlines() if ln.strip()), "")
        logger.warning("[client-error] %s", json.dumps({
            "kind": r["kind"], "name": r["name"], "message": r["message"][:200],
            "frame": first_frame[:200], "page": r["page"], "user": user_id or None,
        }, ensure_ascii=True))
    return {"stored": len(keep), "dropped": len(rows) - len(keep) + over_cap, "invalid": invalid}


def summary(days: int = 1, limit: int = 50, now: float | None = None) -> dict[str, Any]:
    """Admin read: grouped counts and the most recent rows over `days`."""
    now = time.time() if now is None else now
    days = max(1, min(int(days), RETENTION_DAYS))
    limit = max(1, min(int(limit), 200))
    since = now - days * 86400
    conn = _connect()
    try:
        total = conn.execute(
            "SELECT COUNT(*) FROM client_errors WHERE created_at >= ?", (since,),
        ).fetchone()[0]
        groups = conn.execute(
            "SELECT kind, name, message, COUNT(*) AS n, COUNT(DISTINCT rate_key) AS sources,"
            " MAX(created_at) AS last_seen, MIN(page) AS page"
            " FROM client_errors WHERE created_at >= ?"
            " GROUP BY kind, name, message ORDER BY n DESC, last_seen DESC LIMIT ?",
            (since, limit),
        ).fetchall()
        recent = conn.execute(
            "SELECT created_at, kind, name, message, stack, component_stack, page, user_id"
            " FROM client_errors WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?",
            (since, limit),
        ).fetchall()
    finally:
        conn.close()
    return {
        "enabled": enabled(),
        "days": days,
        "total": int(total),
        "groups": [dict(g) for g in groups],
        "recent": [dict(r) for r in recent],
    }
