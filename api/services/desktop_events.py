"""Desktop app telemetry: the server half (desktop plan 5.1, v2 Task 30).

The UCT desktop shell (`uct-desktop`, `src/main/telemetry.ts`) reports a small,
fixed set of lifecycle events: launch, load failures, crashes, unclean exits,
update outcomes. It reports them BEFORE sign-in too, because the failures that
matter most (the shell cannot load the site, the renderer crashes on launch)
happen before a member can sign in. So this door is anonymous, like
`/api/client-errors`, and is built the same way: kill switch, byte cap, field
caps, a rate limit counted from the store, a hard row ceiling.

ENUM-ONLY, so there is nothing to scrub
---------------------------------------
Every stored field is either a member of a fixed set or matches a short,
anchored pattern that admits only digits, dots and lowercase words. A value
that is neither is REFUSED (the event is counted `invalid`), never cleaned:
cleaning would mean free text reached the store first. No message, no stack,
no URL, no file path, no member id, no IP ever reaches a row.

  * `event`         one of EVENTS
  * `shell_version` `1.2.3` or `1.2.3-beta.1`: digits are KEPT (Task 30:
                    "versions pass without digit masking"), because a version
                    is the one fact every halt decision needs
  * `os`            `win32`, `darwin` or `linux`, optionally `-10.0.26200`
  * `error_code`    one of ERROR_CODES, or `net_<digits>` (a Chromium net error
                    number, e.g. `net_105` for ERR_NAME_NOT_RESOLVED)
  * `install`       optional: a random 32-hex id the shell makes on first run.
                    Stored only as a salted hash (`install_hash`). It exists so
                    the halt rule can count MACHINES ("the same crash on two or
                    more machines"), not reports from one noisy machine.
  * `ts`            optional client time, kept only inside a sane window
                    (events queued while offline are sent later).

Storage and bounds
------------------
Its own SQLite file, `DESKTOP_EVENTS_DB_PATH` (default `/data/desktop_events.db`,
read at CALL time so tests can point it at a tmp file). Rows are kept
RETENTION_DAYS (90) and pruned on write at most hourly. A row is under 256 bytes
of data and the table is hard-capped at MAX_ROWS (100,000) rows, the oldest
deleted in the same transaction as each write, so the file stays well under
50 MB on the shared `/data` volume whatever a caller sends.

Rate limit
----------
Per signed-in member or per IP, counted from the STORED rows (durable across a
restart, correct on more than one process). An over-quota event is `dropped`,
never an error, so the shell never learns to retry into a closed door.

Kill switch
-----------
`DESKTOP_TELEMETRY_ENABLED`: unset or anything but an off value means ON;
`0` / `false` / `no` / `off` means OFF. Read per request. OFF stops collection
and answers `{enabled: false}`, which tells the shell to stop sending for the
rest of its run; it never deletes a stored row (docs/feature_flags.json).

Halt triggers (v2 Task 30 step 2, "under 500 machines")
-------------------------------------------------------
`halt_triggers()` names any version where, in the window, the same crash
signature (event + error_code) or any `update_error` came from two or more
machines, or one machine logged a launch-failure loop (LOOP_THRESHOLD load
failures with no `launch_ok`). `alert_tick()` posts each new trigger once
(deduped in the store) and one daily digest, to the OPS destination.
"""
from __future__ import annotations

import hashlib
import logging
import math
import os
import re
import sqlite3
import threading
import time
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

KILL_SWITCH = "DESKTOP_TELEMETRY_ENABLED"
_OFF_VALUES = frozenset({"0", "false", "no", "off"})

EVENTS = frozenset({
    "launch_ok",          # the site's first paint landed in the desk window
    "load_failed",        # the main frame failed to load (error_code: net_<n>)
    "unclean_exit",       # the previous run ended without a clean exit (black box)
    "renderer_crash",     # a site renderer process died (error_code: its reason)
    "gpu_crash",          # the GPU process died (error_code: its reason)
    "site_unresponsive",  # the site window hung long enough for Electron to say so
    "update_downloaded",
    "update_installed",   # first launch of a new version, sent once per version
    "update_error",       # error_code: signature | integrity | network | feed | other
    "first_signin",       # the first sign-in on this install
    "desk_restored",      # a saved desk (boards and pop-outs) was restored at launch
})

# Electron's render-process-gone / child-process-gone reasons, with `-` as `_`,
# and the update error classes from `uct-desktop/src/main/updates.ts`.
ERROR_CODES = frozenset({
    "clean_exit", "abnormal_exit", "killed", "crashed", "oom",
    "launch_failed", "integrity_failure", "memory_eviction",
    "signature", "integrity", "network", "feed", "other",
})

_VERSION_RE = re.compile(r"\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[a-z0-9]{1,12}(?:\.[0-9]{1,4})?)?")
_OS_RE = re.compile(r"(?:win32|darwin|linux)(?:-[0-9]{1,5}(?:\.[0-9]{1,6}){0,3})?")
_NET_CODE_RE = re.compile(r"net_[0-9]{1,4}")
_INSTALL_RE = re.compile(r"[0-9a-f]{32}")

MAX_BODY_BYTES = 16 * 1024
MAX_EVENTS_PER_REQUEST = 50
RATE_LIMIT = 120               # stored events per key per RATE_WINDOW_S
RATE_WINDOW_S = 3600
GLOBAL_LIMIT_PER_HOUR = 20_000
MAX_ROWS = 100_000
RETENTION_DAYS = 90
CLIENT_TS_PAST_S = 7 * 86400   # a queued event may arrive up to a week late
CLIENT_TS_FUTURE_S = 86400     # a fast clock, but not an absurd one
PRUNE_EVERY_S = 3600
LOOP_THRESHOLD = 5             # load failures from one machine with no launch_ok
HALT_MACHINES = 2

_SALT = "desktop_events"       # not a secret: it keeps rows from being a list of ids
_ET = ZoneInfo("America/New_York")
DIGEST_HOUR_ET = 7

_SCHEMA = """
CREATE TABLE IF NOT EXISTS desktop_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at    REAL NOT NULL,
    client_ts     REAL,
    event         TEXT NOT NULL,
    shell_version TEXT NOT NULL,
    os            TEXT NOT NULL,
    error_code    TEXT NOT NULL DEFAULT '',
    install_hash  TEXT NOT NULL DEFAULT '',
    signed_in     INTEGER NOT NULL DEFAULT 0,
    rate_key      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_desktop_events_created ON desktop_events(created_at);
CREATE INDEX IF NOT EXISTS ix_desktop_events_rate ON desktop_events(rate_key, created_at);
CREATE TABLE IF NOT EXISTS desktop_event_alerts (
    alert_key  TEXT PRIMARY KEY,
    sent_at    REAL NOT NULL
);
"""

_init_lock = threading.Lock()
_initialised: set[str] = set()
_last_prune = 0.0


def db_path() -> str:
    return os.environ.get("DESKTOP_EVENTS_DB_PATH", "/data/desktop_events.db")


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


def _hash(kind: str, value: str) -> str:
    return hashlib.sha256(f"{_SALT}|{kind}|{value}".encode("utf-8")).hexdigest()[:32]


def rate_key_for(user_id: str | None, ip: str | None) -> str:
    """A member by id, anyone else by address; hashed, so no row holds a raw IP."""
    basis = f"user:{user_id}" if user_id else f"ip:{ip or 'unknown'}"
    return _hash("rate", basis)


def _full(pattern: re.Pattern, value: Any) -> str | None:
    if isinstance(value, str) and len(value) <= 64 and pattern.fullmatch(value):
        return value
    return None


def validate(raw: Any, *, now: float) -> dict | None:
    """One event, or None when any field is outside its set. Never cleans."""
    if not isinstance(raw, dict):
        return None
    event = raw.get("event")
    if not isinstance(event, str) or event not in EVENTS:
        return None
    version = _full(_VERSION_RE, raw.get("shell_version"))
    os_name = _full(_OS_RE, raw.get("os"))
    if version is None or os_name is None:
        return None
    code = raw.get("error_code", "")
    if code in (None, ""):
        code = ""
    elif not (isinstance(code, str) and (code in ERROR_CODES or _full(_NET_CODE_RE, code))):
        return None
    install = raw.get("install")
    if install in (None, ""):
        install_hash = ""
    elif _full(_INSTALL_RE, install):
        install_hash = _hash("install", install)
    else:
        return None
    client_ts = raw.get("ts")
    if isinstance(client_ts, bool) or not isinstance(client_ts, (int, float)):
        client_ts = None
    else:
        client_ts = float(client_ts)
        if not math.isfinite(client_ts) or not (now - CLIENT_TS_PAST_S <= client_ts <= now + CLIENT_TS_FUTURE_S):
            client_ts = None
    return {"event": event, "shell_version": version, "os": os_name,
            "error_code": code, "install_hash": install_hash, "client_ts": client_ts}


def _room(conn: sqlite3.Connection, key: str, now: float) -> int:
    used = conn.execute(
        "SELECT COUNT(*) FROM desktop_events WHERE rate_key = ? AND created_at >= ?",
        (key, now - RATE_WINDOW_S)).fetchone()[0]
    global_used = conn.execute(
        "SELECT COUNT(*) FROM desktop_events WHERE created_at >= ?", (now - 3600,)).fetchone()[0]
    return max(0, min(RATE_LIMIT - used, GLOBAL_LIMIT_PER_HOUR - global_used))


def _prune(conn: sqlite3.Connection, now: float) -> int:
    cur = conn.execute("DELETE FROM desktop_events WHERE created_at < ?",
                       (now - RETENTION_DAYS * 86400,))
    conn.execute("DELETE FROM desktop_event_alerts WHERE sent_at < ?",
                 (now - RETENTION_DAYS * 86400,))
    return cur.rowcount or 0


def _enforce_ceiling(conn: sqlite3.Connection) -> int:
    n = conn.execute("SELECT COUNT(*) FROM desktop_events").fetchone()[0]
    excess = n - MAX_ROWS
    if excess <= 0:
        return 0
    conn.execute("DELETE FROM desktop_events WHERE id IN"
                 " (SELECT id FROM desktop_events ORDER BY created_at ASC, id ASC LIMIT ?)",
                 (excess,))
    return excess


def record_events(events: list[Any], *, user_id: str | None, ip: str | None,
                  now: float | None = None) -> dict[str, int]:
    """Store what the limits allow. Returns `{stored, dropped, invalid}`.

    Blocking (SQLite): the router calls it off the event loop. The rate room is
    read inside the write transaction (`BEGIN IMMEDIATE`), so two racing
    requests cannot each see room for the same slot."""
    global _last_prune
    now = time.time() if now is None else now
    if not isinstance(events, list):
        events = []
    head = events[:MAX_EVENTS_PER_REQUEST]
    over_cap = max(0, len(events) - MAX_EVENTS_PER_REQUEST)
    valid = [v for v in (validate(e, now=now) for e in head) if v]
    invalid = len(head) - len(valid)
    if not valid:
        return {"stored": 0, "dropped": over_cap, "invalid": invalid}
    key = rate_key_for(user_id, ip)
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        room = _room(conn, key, now)
        keep = valid[:room]
        conn.executemany(
            "INSERT INTO desktop_events (created_at, client_ts, event, shell_version, os,"
            " error_code, install_hash, signed_in, rate_key) VALUES (?,?,?,?,?,?,?,?,?)",
            [(now, v["client_ts"], v["event"], v["shell_version"], v["os"], v["error_code"],
              v["install_hash"], 1 if user_id else 0, key) for v in keep])
        if now - _last_prune >= PRUNE_EVERY_S:
            _prune(conn, now)
            _last_prune = now
        _enforce_ceiling(conn)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    for v in keep:
        if v["event"] != "launch_ok":
            logger.info("[desktop-event] %s v=%s os=%s code=%s", v["event"],
                        v["shell_version"], v["os"], v["error_code"] or "-")
    return {"stored": len(keep), "dropped": over_cap + len(valid) - len(keep), "invalid": invalid}


# ── Reading ──────────────────────────────────────────────────────────────────

def summary(*, hours: int = 24, now: float | None = None) -> dict[str, Any]:
    """Counts by event, version and code, distinct machines, and halt triggers."""
    now = time.time() if now is None else now
    since = now - hours * 3600
    conn = _connect()
    try:
        rows = [dict(r) for r in conn.execute(
            "SELECT event, shell_version, error_code, COUNT(*) AS n,"
            " COUNT(DISTINCT NULLIF(install_hash, '')) AS machines"
            " FROM desktop_events WHERE created_at >= ?"
            " GROUP BY event, shell_version, error_code ORDER BY n DESC", (since,))]
        machines = conn.execute(
            "SELECT COUNT(DISTINCT NULLIF(install_hash, '')) FROM desktop_events"
            " WHERE created_at >= ?", (since,)).fetchone()[0]
        triggers = _halt_triggers(conn, since)
    finally:
        conn.close()
    return {"hours": hours, "machines": machines, "rows": rows, "halt_triggers": triggers}


def _halt_triggers(conn: sqlite3.Connection, since: float) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for r in conn.execute(
            "SELECT event, shell_version, error_code, COUNT(DISTINCT install_hash) AS machines"
            " FROM desktop_events WHERE created_at >= ? AND install_hash != ''"
            " AND event IN ('renderer_crash', 'gpu_crash', 'update_error')"
            " GROUP BY event, shell_version, error_code HAVING machines >= ?",
            (since, HALT_MACHINES)):
        out.append({"kind": "same_signature", "event": r["event"], "shell_version": r["shell_version"],
                    "error_code": r["error_code"], "machines": r["machines"]})
    for r in conn.execute(
            "SELECT shell_version, install_hash, SUM(event = 'load_failed') AS fails,"
            " SUM(event = 'launch_ok') AS oks FROM desktop_events"
            " WHERE created_at >= ? AND install_hash != ''"
            " GROUP BY shell_version, install_hash HAVING fails >= ? AND oks = 0",
            (since, LOOP_THRESHOLD)):
        out.append({"kind": "launch_failure_loop", "event": "load_failed",
                    "shell_version": r["shell_version"], "error_code": "",
                    "machines": 1, "machine": r["install_hash"][:8]})
    return out


def halt_triggers(*, hours: int = 24, now: float | None = None) -> list[dict[str, Any]]:
    now = time.time() if now is None else now
    conn = _connect()
    try:
        return _halt_triggers(conn, now - hours * 3600)
    finally:
        conn.close()


# ── Alerts: halt triggers at once, one digest a day ──────────────────────────

def _trigger_key(t: dict[str, Any], day: str) -> str:
    return "halt|" + "|".join([day, t["kind"], t["event"], t["shell_version"],
                               t["error_code"], t.get("machine", "")])


def _claim(conn: sqlite3.Connection, key: str, now: float) -> bool:
    cur = conn.execute("INSERT OR IGNORE INTO desktop_event_alerts (alert_key, sent_at) VALUES (?, ?)",
                       (key, now))
    return (cur.rowcount or 0) == 1


def digest_text(s: dict[str, Any]) -> str:
    lines = [f"Desktop app, last {s['hours']} h: {s['machines']} machine(s) reported."]
    by_event: dict[str, int] = {}
    for r in s["rows"]:
        by_event[r["event"]] = by_event.get(r["event"], 0) + r["n"]
    if by_event:
        lines.append(", ".join(f"{k} {v}" for k, v in sorted(by_event.items())))
    problems = [r for r in s["rows"] if r["event"] not in ("launch_ok", "desk_restored", "first_signin",
                                                           "update_downloaded", "update_installed")]
    for r in problems[:10]:
        code = f" {r['error_code']}" if r["error_code"] else ""
        lines.append(f"- {r['event']}{code} on {r['shell_version']}: {r['n']} ({r['machines']} machine(s))")
    if s["halt_triggers"]:
        lines.append(f"HALT TRIGGERS: {len(s['halt_triggers'])}, hold the next release.")
    return "\n".join(lines)


def halt_text(t: dict[str, Any]) -> str:
    if t["kind"] == "launch_failure_loop":
        return (f"Desktop HALT: a launch-failure loop on {t['shell_version']} "
                f"({LOOP_THRESHOLD}+ load failures, no successful launch, machine {t['machine']}). "
                "Hold the rollout and check the release.")
    code = f" ({t['error_code']})" if t["error_code"] else ""
    return (f"Desktop HALT: {t['event']}{code} on {t['shell_version']} from {t['machines']} machines "
            "in 24 h. Hold the rollout and check the release.")


def _post_ops(content: str) -> bool:
    """Best-effort post to the OPS destination, resolved at call time."""
    from api.services.alert_destination import ops_webhook
    webhook = (ops_webhook() or "").strip()
    if not webhook:
        return False
    try:
        import json
        import urllib.request
        req = urllib.request.Request(
            webhook, data=json.dumps({"content": content[:1900]}).encode(),
            headers={"Content-Type": "application/json", "User-Agent": "uct-desktop-events/1"})
        with urllib.request.urlopen(req, timeout=10) as r:
            r.read(64)
        return True
    except Exception as e:  # noqa: BLE001 -- best effort, logged
        logger.warning("[desktop-event] ops post failed: %s", e)
        return False


def alert_tick(*, now: float | None = None, post=None) -> dict[str, int]:
    """Run hourly. Posts each new halt trigger once, and the digest once a day
    after DIGEST_HOUR_ET when anything was reported. A claim is written before
    the post, so two processes never both post; a failed post is not retried
    (the next digest still names the trigger)."""
    now = time.time() if now is None else now
    post = post or _post_ops
    sent = {"halts": 0, "digest": 0}
    if not enabled():
        return sent
    day = datetime.fromtimestamp(now, _ET).strftime("%Y-%m-%d")
    s = summary(hours=24, now=now)
    conn = _connect()
    try:
        to_send: list[str] = []
        for t in s["halt_triggers"]:
            if _claim(conn, _trigger_key(t, day), now):
                to_send.append(halt_text(t))
        want_digest = (datetime.fromtimestamp(now, _ET).hour >= DIGEST_HOUR_ET and bool(s["rows"]))
        if want_digest and _claim(conn, f"digest|{day}", now):
            to_send.append(digest_text(s))
            sent["digest"] = 1
        conn.commit()
    finally:
        conn.close()
    for text in to_send:
        if text.startswith("Desktop HALT"):
            sent["halts"] += 1
        post(text)
    return sent
