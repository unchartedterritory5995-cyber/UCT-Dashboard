"""SQLite store for UCT Agent conversations and structured telemetry.

THREE TABLES
  agent_conversations  one row per chat (owner, title, timestamps)
  agent_turns          the transcript: role 'member' (what they typed or said),
                       'agent' (the model's reply text + its structured
                       envelope), 'outcome' (what UCT ACTUALLY did: the
                       deterministic receipt / refusal / undo the browser
                       produced). The model's history is rebuilt from these,
                       so it sees what happened, never only what it asked for.
  agent_telemetry      one row per turn, NO conversation text: path (fast /
                       model), disposition, action names, refused / clarified /
                       undo flags, latency, model, cost, unsupported category.
                       This is what later tells us which requests deserve a
                       fast path or a new registry action.

DB path: /data/uct_agent.db (UCT_AGENT_DB_PATH). The repo conftest derives its
data-path redirect from this env read, so tests never touch /data. Same store
pattern as charts_layout_service: WAL, one write lock, contextlib.closing.
"""
from __future__ import annotations

import contextlib
import json
import os
import secrets
import sqlite3
import threading
import time
from typing import Any

_DB_PATH = os.environ.get("UCT_AGENT_DB_PATH", "/data/uct_agent.db")
_WRITE_LOCK = threading.Lock()
_READY = False

MAX_TEXT = 4000
TITLE_LEN = 60

_SCHEMA = """
CREATE TABLE IF NOT EXISTS agent_conversations (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_conv_user ON agent_conversations(user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS agent_turns (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  role            TEXT NOT NULL,          -- member | agent | outcome
  text            TEXT NOT NULL,
  data_json       TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_turns_conv ON agent_turns(conversation_id, id);
CREATE TABLE IF NOT EXISTS agent_telemetry (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL,
  conversation_id TEXT,
  path            TEXT,                   -- fast | model | local
  disposition     TEXT,
  actions         TEXT,                   -- JSON list of action names
  refused         INTEGER NOT NULL DEFAULT 0,
  clarified       INTEGER NOT NULL DEFAULT 0,
  undo            INTEGER NOT NULL DEFAULT 0,
  latency_ms      INTEGER,
  model           TEXT,
  cost_usd        REAL,
  research_calls  INTEGER NOT NULL DEFAULT 0,
  unsupported     TEXT,
  voice           INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);
"""


def _connect() -> sqlite3.Connection:
    global _READY
    d = os.path.dirname(_DB_PATH)
    if d and not os.path.isdir(d):
        os.makedirs(d, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    if not _READY:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(_SCHEMA)
        _READY = True
    return conn


def _uid(user_id: Any) -> str:
    """Member ids are opaque strings (production ids are UUIDs) -- never cast
    them to int. ⚰️ 2026-10-07: `int(user_id)` 500'd every production turn.
    Tables created with the old INTEGER declaration still store and match the
    text id exactly (SQLite type affinity), so no migration is needed."""
    return str(user_id)


def _now() -> int:
    return int(time.time())


def _clip(s: Any, n: int = MAX_TEXT) -> str:
    return str(s or "")[:n]


def create_conversation(user_id: int, first_text: str) -> str:
    cid = "ac_" + secrets.token_hex(8)
    title = " ".join(_clip(first_text, 200).split())[:TITLE_LEN] or "New chat"
    now = _now()
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("INSERT INTO agent_conversations (id, user_id, title, created_at, updated_at) VALUES (?,?,?,?,?)",
                  (cid, _uid(user_id), title, now, now))
        c.commit()
    return cid


def owns(user_id: int, conversation_id: str) -> bool:
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT 1 FROM agent_conversations WHERE id = ? AND user_id = ?",
                        (str(conversation_id), _uid(user_id))).fetchone()
    return row is not None


def ensure_conversation(user_id: int, conversation_id: str | None, first_text: str) -> str:
    """The caller's own conversation, or a new one. A foreign / unknown id is
    never written into -- it silently starts a new chat for THIS member."""
    if conversation_id and owns(user_id, conversation_id):
        return conversation_id
    return create_conversation(user_id, first_text)


def add_turn(user_id: int, conversation_id: str, role: str, text: str, data: dict | None = None) -> int:
    if role not in ("member", "agent", "outcome"):
        raise ValueError(f"bad role {role!r}")
    now = _now()
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute(
            "INSERT INTO agent_turns (conversation_id, user_id, role, text, data_json, created_at) VALUES (?,?,?,?,?,?)",
            (conversation_id, _uid(user_id), role, _clip(text),
             json.dumps(data, separators=(",", ":"))[:20000] if data is not None else None, now))
        c.execute("UPDATE agent_conversations SET updated_at = ? WHERE id = ? AND user_id = ?",
                  (now, conversation_id, _uid(user_id)))
        c.commit()
        return int(cur.lastrowid)


def list_conversations(user_id: int, limit: int = 30) -> list[dict]:
    with contextlib.closing(_connect()) as c:
        rows = c.execute("SELECT id, title, created_at, updated_at FROM agent_conversations WHERE user_id = ? "
                         "ORDER BY updated_at DESC LIMIT ?", (_uid(user_id), int(limit))).fetchall()
    return [dict(r) for r in rows]


def get_turns(user_id: int, conversation_id: str, limit: int = 200) -> list[dict] | None:
    if not owns(user_id, conversation_id):
        return None
    with contextlib.closing(_connect()) as c:
        rows = c.execute("SELECT id, role, text, data_json, created_at FROM agent_turns WHERE conversation_id = ? "
                         "AND user_id = ? ORDER BY id DESC LIMIT ?",
                         (conversation_id, _uid(user_id), int(limit))).fetchall()
    out = []
    for r in reversed(rows):
        d = dict(r)
        raw = d.pop("data_json")
        try:
            d["data"] = json.loads(raw) if raw else None
        except ValueError:
            d["data"] = None
        out.append(d)
    return out


def get_conversation(user_id: int, conversation_id: str) -> dict | None:
    turns = get_turns(user_id, conversation_id)
    if turns is None:
        return None
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT id, title, created_at, updated_at FROM agent_conversations WHERE id = ?",
                        (conversation_id,)).fetchone()
    return {**dict(row), "turns": turns}


_TELEMETRY_COLS = ("path", "disposition", "refused", "clarified", "undo", "latency_ms", "model",
                   "cost_usd", "research_calls", "unsupported", "voice")


def record_telemetry(user_id: int, conversation_id: str | None, row: dict) -> None:
    """Structured, content-free. Never raises into a request."""
    try:
        vals = {k: row.get(k) for k in _TELEMETRY_COLS}
        actions = row.get("actions") or []
        with _WRITE_LOCK, contextlib.closing(_connect()) as c:
            c.execute(
                "INSERT INTO agent_telemetry (user_id, conversation_id, path, disposition, actions, refused, "
                "clarified, undo, latency_ms, model, cost_usd, research_calls, unsupported, voice, created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (_uid(user_id), conversation_id, _clip(vals["path"], 16), _clip(vals["disposition"], 16),
                 json.dumps([_clip(a, 40) for a in actions][:16]),
                 int(bool(vals["refused"])), int(bool(vals["clarified"])), int(bool(vals["undo"])),
                 int(vals["latency_ms"]) if isinstance(vals["latency_ms"], (int, float)) else None,
                 _clip(vals["model"], 64) or None,
                 float(vals["cost_usd"]) if isinstance(vals["cost_usd"], (int, float)) else None,
                 int(vals["research_calls"] or 0), _clip(vals["unsupported"], 40) or None,
                 int(bool(vals["voice"])), _now()))
            c.commit()
    except Exception:  # noqa: BLE001 -- telemetry never breaks a turn
        pass


def telemetry_rows(user_id: int | None = None, limit: int = 500) -> list[dict]:
    with contextlib.closing(_connect()) as c:
        if user_id is None:
            rows = c.execute("SELECT * FROM agent_telemetry ORDER BY id DESC LIMIT ?", (int(limit),)).fetchall()
        else:
            rows = c.execute("SELECT * FROM agent_telemetry WHERE user_id = ? ORDER BY id DESC LIMIT ?",
                             (_uid(user_id), int(limit))).fetchall()
    return [dict(r) for r in rows]


def _reset_for_tests() -> None:
    global _READY
    _READY = False
