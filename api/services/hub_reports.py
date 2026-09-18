"""The joystick hub's owner-report store — W2, owner ruling R2 (2026-09-17).

⭐ WHY THIS EXISTS. The owner used the hub on real glass and reported "tons of bugs … too glitchy …
simplify a ton". He will not type a bug list, and the programme had no way to receive one: every
device path died on transport, and the gesture trace could only leave the phone by the owner
selecting JSON out of a DOM attribute and pasting it somewhere. R2's answer is to put the intake IN
the product — one tap on the phone files a report with the trace attached.

⛔⛔ ADMIN ONLY, AND THAT IS A PRODUCT CONSTRAINT, NOT A CONVENIENCE. The hub is admin-preview
surface at stage 1. A member must not be able to reach this endpoint, and a signed-out request must
not either. The router enforces it; `tests/test_hub_reports.py` proves all three answers (admin 200,
member 403, anonymous 401) rather than asserting the happy path alone.

⛔ NO ANALYTICS, AND THE DISTINCTION IS EXACT. `gestureTrace.js` still has NO SINK — it records into
a ring and nothing in that file may POST. What changed on 2026-09-17 is that a SEPARATE module, on
an EXPLICIT tap by an admin, may read the ring's existing export and send it here. Nothing is sent
in the background, on a timer, on navigation, or on unload. That is the whole of the relaxation and
it is deliberately narrow.
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
from contextlib import closing
from typing import Any

# ⛔ Its OWN env var with a /data default, which is the repo's census idiom — `conftest.py` derives
# the pin by AST over `api/**`, so this path is redirected in tests the day it lands rather than
# needing a hand-added entry. Do NOT resolve it through DATA_DIR: that reaches 1 of 72 path vars.
_DEFAULT_DB = "/data/hub_reports.db"


def db_path() -> str:
    """Resolved per call, never captured at import — a module-level capture is unreachable by a
    test that sets the env after import, which is the trap the shared-root census exists for."""
    return os.environ.get("HUB_REPORTS_DB_PATH", _DEFAULT_DB)


_SCHEMA = """
CREATE TABLE IF NOT EXISTS hub_reports (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT    NOT NULL,
    user_email    TEXT,
    created_at    INTEGER NOT NULL,
    note          TEXT,
    payload_json  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_reports_created ON hub_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hub_reports_user    ON hub_reports (user_id, created_at DESC);
"""


def _connect() -> sqlite3.Connection:
    path = db_path()
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = sqlite3.connect(path, timeout=5)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Idempotent. Cheap enough to call on every write, which is what keeps a fresh volume working
    without a migration step."""
    with closing(_connect()) as conn:
        conn.executescript(_SCHEMA)
        conn.commit()


def add_report(*, user_id: str, user_email: str | None, note: str | None,
               payload: dict[str, Any]) -> int:
    """Append one report. Returns its id.

    ⭐ `payload` is stored as JSON TEXT verbatim. The note is ALSO stored in its own column even
    though it is inside the payload: the intake tool reads notes without parsing every payload, and
    a note is the one field a human wrote — it should not require a JSON parse to find.
    """
    init_db()
    blob = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    with closing(_connect()) as conn:
        cur = conn.execute(
            "INSERT INTO hub_reports (user_id, user_email, created_at, note, payload_json) "
            "VALUES (?, ?, ?, ?, ?)",
            (user_id, user_email, int(time.time()), note, blob),
        )
        conn.commit()
        return int(cur.lastrowid)


def list_reports(*, limit: int = 200, since: int | None = None) -> list[dict[str, Any]]:
    """Newest first. `payload` comes back PARSED — a caller that wanted the raw text would be
    re-implementing the parse, and two spellings of one value is the defect this repo keeps paying
    for."""
    init_db()
    sql = "SELECT id, user_id, user_email, created_at, note, payload_json FROM hub_reports"
    args: list[Any] = []
    if since is not None:
        sql += " WHERE created_at >= ?"
        args.append(int(since))
    sql += " ORDER BY created_at DESC, id DESC LIMIT ?"
    args.append(max(1, min(int(limit), 1000)))
    with closing(_connect()) as conn:
        rows = conn.execute(sql, args).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        try:
            payload = json.loads(r["payload_json"])
        except (ValueError, TypeError):
            # ⛔ A row that will not parse is REPORTED as unparseable, never dropped. A silently
            # skipped row makes the table read quieter than it is, which is the one thing an
            # intake table must never do.
            payload = {"_unparseable": True, "_raw_len": len(r["payload_json"] or "")}
        out.append({
            "id": r["id"],
            "user_id": r["user_id"],
            "user_email": r["user_email"],
            "created_at": r["created_at"],
            "note": r["note"],
            "payload": payload,
        })
    return out


def count_reports() -> int:
    init_db()
    with closing(_connect()) as conn:
        return int(conn.execute("SELECT COUNT(*) FROM hub_reports").fetchone()[0])
