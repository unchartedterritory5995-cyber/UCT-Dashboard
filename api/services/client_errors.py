"""Client error beacon — the server half (D14: our own reporter, no new vendor).

The browser half is `app/src/lib/errorBeacon.js`. It scrubs before it sends;
this module is the SECOND layer and deliberately does not restate the first.

What the two layers each own
----------------------------
* The CLIENT owns the one judgement only the page can make: which part of a
  message is the engine's and which could be a member's own writing. It sends
  a message only as a matched engine TEMPLATE ("x is not a function"), else as
  `<Name>: <unrecognized #hash8>`; frames only; every digit as `#`; every path
  reduced; and no DOM content at all.
* THIS side owns transport safety, and applies it whatever the client did —
  an old bundle, a hostile caller, a bug in the scrub: every URL loses its
  query AND fragment (share and login tokens ride in fragments —
  `/smoke-login#token=…`), every PATH is reduced segment by segment (a
  lowercase digit-free route word survives, anything else is `:id`, and the
  token position of the four share routes is `:id` whatever it looks like —
  share tokens ride in the PATH, `/share/n/<token>`), credential-shaped values
  go, every digit becomes `#`, control characters go, every field is capped in
  UTF-8 BYTES, and the row carries a HASH of the rate key, never a raw IP.

⛔ The template allowlist is NOT re-implemented here. Two copies of one
redaction rule drift the moment either changes, and the copy nobody tests is
the one that leaks (`lesson_a_second_authority_over_one_value`). A client that
skips it can only submit text it already holds, and the store is admin-only.
That is also why the `[client-error]` log line never carries the message: it
carries the kind, the reduced route, the template id (or hash) and a count.

The door's order of work (B-3)
------------------------------
The anonymous door is a place a stranger can make the server spend CPU, so the
cheap refusals come first and nothing pattern-shaped runs until a row is
known to be stored:
  1. kill switch;
  2. body size — a declared or streamed body over MAX_BODY_BYTES is a 413
     before a byte of it is parsed (the router);
  3. field caps — plain slicing, no pattern (`_bounded`);
  4. the rate limit — indexed counts (`_room`); an over-quota request is
     answered here and pays for no scrub;
  5. the scrub — only for the rows that will be stored, on capped fields,
     with a LINEAR URL finder (the regex form backtracked quadratically: 0.73 s
     on 32k letters).
The router runs 3–5 off the event loop (`run_in_threadpool`).

Storage, and the byte ceiling (S-1)
-----------------------------------
Its own SQLite file, `CLIENT_ERRORS_DB_PATH` (default `/data/client_errors.db`,
read at CALL time so the conftest census pins it and a monkeypatch reaches it).
Rows are kept `RETENTION_DAYS` (14) and pruned opportunistically on write.

⛔ THE STORE IS BOUNDED IN BYTES, and that bound — not the rate limit — is the
real one against a caller rotating keys. `client_ip` trusts `CF-Connecting-IP`
first, so a caller that reaches the origin directly can present a fresh address
on every request and a per-key limit counts nothing. So:
  * every field is capped in UTF-8 bytes; the caps plus the fixed columns sum
    under MAX_ROW_BYTES (8 KiB);
  * the table is hard-capped at MAX_ROWS (15,000) rows; every write deletes the
    OLDEST rows past it, in the same transaction;
  * ⇒ at most 15,000 × 8 KiB ≈ 117 MiB of row data. On disk a row takes at most
    three 4 KiB pages (its leaf cell plus two overflow pages), so the file stays
    under ~180 MiB — inside the 250 MB ceiling for this store, on a `/data`
    volume shared with `auth.db` and the notebook.
The global hourly ceiling still sits above the per-key limit so one flood
cannot use every slot for an hour, but it is a fairness rule, not the bound.

Rate limit
----------
Per session (a signed-in member) or per IP (anyone else), counted from the
STORED rows — durable across a restart, and correct on more than one process,
because the store is the only counter.

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
from collections import Counter
from typing import Any

logger = logging.getLogger(__name__)

KILL_SWITCH = "CLIENT_ERROR_BEACON_ENABLED"
_OFF_VALUES = {"0", "false", "no", "off"}

RETENTION_DAYS = 14
RATE_LIMIT = 30                 # stored reports per key per window
RATE_WINDOW_S = 600             # ten minutes
GLOBAL_LIMIT_PER_HOUR = 2000    # every key together — fairness, not the bound
MAX_REPORTS_PER_REQUEST = 10
MAX_BODY_BYTES = 64 * 1024

# Field caps, in UTF-8 BYTES. The client caps too; these are the server's own
# ceilings — not derived from the client, which is what this layer distrusts.
CAP_NAME = 100
CAP_MESSAGE = 500
CAP_TEMPLATE = 40
CAP_STACK = 4000
CAP_COMPONENT_STACK = 2000
CAP_PAGE = 300
CAP_USER_AGENT = 300
CAP_RATE_KEY = 24
CAP_USER_ID = 64
FIXED_ROW_BYTES = 64            # id, created_at, client_ts, kind, row header

# The byte ceiling (see the module docstring): stated, and railed.
MAX_ROW_BYTES = 8 * 1024
MAX_ROWS = 15_000
CEILING_BYTES = MAX_ROWS * MAX_ROW_BYTES

KINDS = ("error", "unhandledrejection", "boundary")

# The four routes whose path carries a bearer token — the client reads these
# from its four `*_ROUTE` constants; tests/test_client_errors.py parses those
# modules and pins this tuple to them.
TOKEN_ROUTES = (
    "/share/n/:token",
    "/track/:token",
    "/screener/shared/:token",
    "/formulas/shared/:token",
)

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
    template        TEXT NOT NULL DEFAULT '',
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
            cols = {r[1] for r in conn.execute("PRAGMA table_info(client_errors)")}
            if "template" not in cols:     # a file written before the column existed
                conn.execute("ALTER TABLE client_errors ADD COLUMN template TEXT NOT NULL DEFAULT ''")
            conn.commit()
            _initialised.add(path)
    conn.execute("PRAGMA busy_timeout=2000")
    return conn


# ── Paths ────────────────────────────────────────────────────────────────────

_ROUTE_WORD = re.compile(r"[a-z]+(?:-[a-z]+)*")
_ASSET_FILE = re.compile(r"[\w.-]{1,120}\.(?:m?jsx?|cjs|tsx?|css|map|wasm|html?)")
_TOKEN_ROUTE_SEGS = tuple(r.split("/") for r in TOKEN_ROUTES)


def reduce_path(path: Any, *, asset: bool = False) -> str:
    """Segment by segment: a lowercase digit-free route word survives, any
    other segment is `:id`, and a token-route position is `:id` whatever it
    looks like. `asset` also keeps a final static-asset file name."""
    if not isinstance(path, str) or not path:
        return ""
    segs = path[:2000].split("/")
    last = len(segs) - 1
    out = []
    for i, s in enumerate(segs):
        if s == "" or _ROUTE_WORD.fullmatch(s):
            out.append(s)
        elif asset and i == last and _ASSET_FILE.fullmatch(s):
            out.append(s)
        else:
            out.append(":id")
    for route in _TOKEN_ROUTE_SEGS:
        if len(out) < len(route):
            continue
        if all(r.startswith(":") or out[i] == r for i, r in enumerate(route)):
            for i, r in enumerate(route):
                if r.startswith(":"):
                    out[i] = ":id"
    return "/".join(out)


# ── Transport scrub (the server's layer) ───────────────────────────────────

_LINE_COL_OWN = re.compile(r"(:\d+(?::\d+)?)$")
_LINE_COL_AFTER = re.compile(r"(:\d+:\d+)$")
_SCRIPT_END = re.compile(r"\.(?:m?jsx?|cjs|tsx?|html?)$", re.IGNORECASE)


def scrub_url(url: Any) -> str:
    """Origin + reduced path (+ a script frame's :line:col). The query AND the
    fragment go, whatever they hold; user info in the origin goes too."""
    if not isinstance(url, str) or not url:
        return ""
    if url[:5].lower() == "data:":
        return "data:[removed]"
    origin, rest = "", url
    sep = url.find("://")
    if sep != -1:
        end = len(url)
        for ch in "/?#":
            i = url.find(ch, sep + 3)
            if i != -1:
                end = min(end, i)
        origin, rest = url[:end], url[end:]
        at = origin.rfind("@")
        if at > sep:
            origin = origin[: sep + 3] + origin[at + 1:]
    cut = len(rest)
    for ch in "?#":
        i = rest.find(ch)
        if i != -1:
            cut = min(cut, i)
    path, after = rest[:cut], rest[cut:]
    tail = ""
    own = _LINE_COL_OWN.search(path)
    if own and _SCRIPT_END.search(path[: own.start()]):
        tail, path = own.group(1), path[: own.start()]
    elif after and _SCRIPT_END.search(path):
        t = _LINE_COL_AFTER.search(after)
        if t:
            tail = t.group(1)
    return origin + reduce_path(path, asset=True) + tail


_URL_BODY = re.compile(r"[^\s'\"()<>]*")


def _is_scheme_char(ch: str) -> bool:
    return ch.isascii() and (ch.isalnum() or ch in "+.-")


def scrub_urls(text: str) -> str:
    """Every scheme URL inside text, scrubbed. A LINEAR scan: find `://`, walk
    left over the scheme and right to the first stop character."""
    out: list[str] = []
    pos = frm = 0
    while True:
        i = text.find("://", frm)
        if i == -1:
            break
        s = i
        while s > pos and _is_scheme_char(text[s - 1]):
            s -= 1
        while s < i and not (text[s].isascii() and text[s].isalpha()):
            s += 1
        if s == i:
            frm = i + 3
            continue
        e = _URL_BODY.match(text, i + 3).end()
        out.append(text[pos:s])
        out.append(scrub_url(text[s:e]))
        pos = frm = e
    out.append(text[pos:])
    return "".join(out)


# An absolute path standing on its own in text (`GET /api/j2/notes?q=…`, a
# Node frame's `C:/Users/…`): reduced, and its query/fragment cut.
_ABS_PATH = re.compile(r"(^|[\s(@\"'=])((?:[A-Za-z]:)?[/\\][^\s()<>'\"]*)")
# A query or fragment carrying `name=value`, wherever it sits (`smoke-login#t=…`).
_QUERY_TAIL = re.compile(r"[#?][^\s'\"()<>#?]*=[^\s'\"()<>]*")
# Credential-shaped `name=value` anywhere: the value goes, the name stays so
# the report still says what kind of thing was there.
_CREDENTIAL = re.compile(
    r"\b(access_token|id_token|refresh_token|token|api_key|apikey|key|secret|password|"
    r"passwd|pass|code|session|sid|sig|signature|auth)=[^\s&;'\"()<>]*",
    re.IGNORECASE,
)
# `data:` URIs carry their payload inline — it can be anything at all.
_DATA_URI = re.compile(r"data:[^\s'\"()<>]+", re.IGNORECASE)
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_DIGITS = re.compile(r"\d+")


def scrub_text(text: Any) -> str:
    """The transport scrub for a free-text field. Every pattern here is linear."""
    if not isinstance(text, str) or not text:
        return ""
    text = _CONTROL.sub("", text)
    text = _DATA_URI.sub("data:[removed]", text)
    text = scrub_urls(text)
    text = _ABS_PATH.sub(lambda m: m.group(1) + scrub_url(m.group(2).replace("\\", "/")), text)
    text = _QUERY_TAIL.sub("[removed]", text)
    text = _CREDENTIAL.sub(lambda m: m.group(1) + "=[removed]", text)
    return _DIGITS.sub("#", text)


def scrub_page(page: Any) -> str:
    if not isinstance(page, str) or not page:
        return ""
    return scrub_url(_CONTROL.sub("", page))


def _cap_bytes(value: str, cap: int) -> str:
    raw = value.encode("utf-8")
    if len(raw) <= cap:
        return value
    return raw[:cap].decode("utf-8", errors="ignore")


_NAME = re.compile(r"Error|[A-Z][A-Za-z]{0,58}(?:Error|Exception)")
_TEMPLATE_ID = re.compile(r"[a-z]+(?:-[a-z]+)*|#[a-p]{8}")


def _letters_hash(text: str) -> str:
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    return "".join(chr(97 + (b & 15)) for b in digest[:8])


# ── The pipeline: bound → count → scrub ──────────────────────────────────────

def _bounded(raw: Any) -> dict[str, Any] | None:
    """Step 3: validate and CAP by slicing. No pattern runs here."""
    if not isinstance(raw, dict):
        return None
    kind = raw.get("kind")
    if kind not in KINDS:
        return None

    def s(key: str, cap: int) -> str:
        v = raw.get(key)
        return v[:cap] if isinstance(v, str) else ""

    ts = raw.get("ts")
    return {
        "kind": kind,
        "name": s("name", CAP_NAME),
        "message": s("message", CAP_MESSAGE),
        "template": s("template", CAP_TEMPLATE),
        "stack": s("stack", CAP_STACK),
        "component_stack": s("componentStack", CAP_COMPONENT_STACK),
        "page": s("page", CAP_PAGE * 2),
        "client_ts": float(ts) if isinstance(ts, (int, float)) and not isinstance(ts, bool) else None,
    }


def _scrubbed(b: dict[str, Any]) -> dict[str, Any]:
    """Step 5: the transport scrub, on capped fields, then the byte caps."""
    message = _cap_bytes(scrub_text(b["message"]), CAP_MESSAGE)
    template = b["template"] if _TEMPLATE_ID.fullmatch(b["template"]) else "#" + _letters_hash(message)
    name = _CONTROL.sub("", b["name"])
    return {
        "kind": b["kind"],
        "name": name if _NAME.fullmatch(name) else "Error",
        "message": message,
        "template": template,
        "stack": _cap_bytes(scrub_text(b["stack"]), CAP_STACK),
        "component_stack": _cap_bytes(scrub_text(b["component_stack"]), CAP_COMPONENT_STACK),
        "page": _cap_bytes(scrub_page(b["page"]), CAP_PAGE),
        "client_ts": b["client_ts"],
    }


def normalise_report(raw: Any) -> dict[str, Any] | None:
    """One client report → one storable row, or None if it is not a report."""
    b = _bounded(raw)
    return _scrubbed(b) if b else None


def rate_key_for(user_id: str | None, ip: str | None) -> str:
    """A stable, non-reversible key: a member by id, anyone else by address.

    ⛔ Hashed so the table never holds a raw IP. The salt is the table's own
    name — not a secret, and it does not need to be one: the point is that a
    row read out of this file is not a list of addresses."""
    basis = f"user:{user_id}" if user_id else f"ip:{ip or 'unknown'}"
    return hashlib.sha256(f"client_errors|{basis}".encode("utf-8")).hexdigest()[:CAP_RATE_KEY]


def _room(conn: sqlite3.Connection, key: str, now: float) -> int:
    """Step 4: how many rows this key may still store. Two indexed counts."""
    used = conn.execute(
        "SELECT COUNT(*) FROM client_errors WHERE rate_key = ? AND created_at >= ?",
        (key, now - RATE_WINDOW_S),
    ).fetchone()[0]
    global_used = conn.execute(
        "SELECT COUNT(*) FROM client_errors WHERE created_at >= ?", (now - 3600,),
    ).fetchone()[0]
    return max(0, min(RATE_LIMIT - used, GLOBAL_LIMIT_PER_HOUR - global_used))


def _prune(conn: sqlite3.Connection, now: float) -> int:
    cur = conn.execute(
        "DELETE FROM client_errors WHERE created_at < ?",
        (now - RETENTION_DAYS * 86400,),
    )
    return cur.rowcount or 0


def _enforce_ceiling(conn: sqlite3.Connection) -> int:
    """The hard row cap: the OLDEST rows past MAX_ROWS go, on every write."""
    n = conn.execute("SELECT COUNT(*) FROM client_errors").fetchone()[0]
    excess = n - MAX_ROWS
    if excess <= 0:
        return 0
    conn.execute(
        "DELETE FROM client_errors WHERE id IN"
        " (SELECT id FROM client_errors ORDER BY created_at ASC, id ASC LIMIT ?)",
        (excess,),
    )
    return excess


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

    Blocking (SQLite + the scrub): the router calls it OFF the event loop.
    ⛔ The limit is COUNTED FROM THE STORE — first as a cheap read that turns
    an over-quota request away before any scrub, then again inside the write
    transaction, so two requests racing cannot each see room for one slot."""
    global _last_prune
    now = time.time() if now is None else now
    if not isinstance(reports, list):
        reports = []
    head = reports[:MAX_REPORTS_PER_REQUEST]
    over_cap = max(0, len(reports) - MAX_REPORTS_PER_REQUEST)
    bounded = [b for b in (_bounded(x) for x in head) if b]
    invalid = len(head) - len(bounded)
    if not bounded:
        return {"stored": 0, "dropped": over_cap, "invalid": invalid}

    key = rate_key_for(user_id, ip)
    conn = _connect()
    keep: list[dict[str, Any]] = []
    try:
        if _room(conn, key, now) <= 0:
            return {"stored": 0, "dropped": len(bounded) + over_cap, "invalid": invalid}
        conn.execute("BEGIN IMMEDIATE")
        room = _room(conn, key, now)
        keep = [_scrubbed(b) for b in bounded[:room]]
        ua = _cap_bytes(_CONTROL.sub("", (user_agent or "")[:CAP_USER_AGENT]), CAP_USER_AGENT)
        uid = user_id[:CAP_USER_ID] if isinstance(user_id, str) else None
        for r in keep:
            conn.execute(
                "INSERT INTO client_errors (created_at, rate_key, user_id, kind, name, message,"
                " template, stack, component_stack, page, user_agent, client_ts)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (now, key, uid, r["kind"], r["name"], r["message"], r["template"], r["stack"],
                 r["component_stack"], r["page"], ua, r["client_ts"]),
            )
        if now - _last_prune >= _PRUNE_EVERY_S:
            _prune(conn, now)
            _last_prune = now
        _enforce_ceiling(conn)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    # One line per (kind, route, template), with a count. ⛔ Never the message:
    # Railway logs are a wider, longer-lived sink than an admin-only table.
    for (kind, route, template), count in Counter(
        (r["kind"], r["page"], r["template"]) for r in keep
    ).items():
        logger.warning("[client-error] %s", json.dumps(
            {"kind": kind, "route": route, "template": template, "count": count},
            ensure_ascii=True,
        ))
    return {"stored": len(keep), "dropped": len(bounded) - len(keep) + over_cap, "invalid": invalid}


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
            "SELECT kind, name, template, MIN(message) AS message, COUNT(*) AS n,"
            " COUNT(DISTINCT rate_key) AS sources, MAX(created_at) AS last_seen, MIN(page) AS page"
            " FROM client_errors WHERE created_at >= ?"
            " GROUP BY kind, name, template ORDER BY n DESC, last_seen DESC LIMIT ?",
            (since, limit),
        ).fetchall()
        recent = conn.execute(
            "SELECT created_at, kind, name, template, message, stack, component_stack, page, user_id"
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
