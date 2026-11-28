"""SQLite store for UCT Agent conversations and structured telemetry.

THREE TABLES
  agent_conversations  one row per chat (owner, title, timestamps, pinned_at)
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
  created_at      INTEGER NOT NULL,
  model_calls     INTEGER,                -- speed: numbers and one mode word, never content (tools/agent_latency_telemetry.py)
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  cache_read_tokens  INTEGER,
  cache_write_tokens INTEGER,
  schema_mode     TEXT,                   -- constant | routed
  visible_ms      INTEGER,                -- browser: Enter to the change on screen (commit done)
  verified_ms     INTEGER                 -- browser: Enter to the change read back and saved
);
CREATE TABLE IF NOT EXISTS agent_conversation_state (
  conversation_id TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  key             TEXT NOT NULL,          -- STATE_KEYS: lastScreen (W1-C C-01), coachConsent (W3-3)
  value_json      TEXT NOT NULL,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, key)
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
        _migrate(conn)
        _READY = True
    return conn


_TELEMETRY_ADDED = (("model_calls", "INTEGER"), ("input_tokens", "INTEGER"), ("output_tokens", "INTEGER"),
                    ("cache_read_tokens", "INTEGER"), ("cache_write_tokens", "INTEGER"), ("schema_mode", "TEXT"),
                    ("visible_ms", "INTEGER"), ("verified_ms", "INTEGER"))


def _migrate(conn: sqlite3.Connection) -> None:
    """Additive, idempotent column adds for tables created before the column existed."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(agent_conversations)").fetchall()}
    if "pinned_at" not in cols:  # History: pinned chats list first (NULL = not pinned)
        conn.execute("ALTER TABLE agent_conversations ADD COLUMN pinned_at INTEGER")
        conn.commit()
    if "title_source" not in cols:  # NULL = first message (placeholder) | 'auto' (model) | 'user' (renamed)
        conn.execute("ALTER TABLE agent_conversations ADD COLUMN title_source TEXT")
        conn.commit()
    tel = {r[1] for r in conn.execute("PRAGMA table_info(agent_telemetry)").fetchall()}
    for col, kind in _TELEMETRY_ADDED:
        if col not in tel:
            conn.execute(f"ALTER TABLE agent_telemetry ADD COLUMN {col} {kind}")
            conn.commit()


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


DATA_MAX_CHARS = 20000
#: What a row's data must ALWAYS keep, whatever its size: the history door (turn.outcome_for_model /
#: is_local_row) decides from these, and a row without them is replayed as unreadable.
_ESSENTIAL = ("kind", "actions", "local", "requests", "voice")


def _data_json(data: dict | None) -> str | None:
    """A row's data as JSON, NEVER cut mid-value. Over the limit, the optional display parts (the
    member's saved answer views, then long lines, then the stored envelope) are dropped first; the
    essential keys always survive. (Cutting the JSON — the old `[:20000]` — made the whole row
    unreadable: its kind, actions and local flag were lost with the table that overflowed.)"""
    if data is None:
        return None
    dump = lambda d: json.dumps(d, separators=(",", ":"))  # noqa: E731
    out = dump(data)
    if len(out) <= DATA_MAX_CHARS or not isinstance(data, dict):
        return out if len(out) <= DATA_MAX_CHARS else None
    d = dict(data)
    for key in ("views", "view", "citations"):
        if key in d:
            d.pop(key)
            d["trimmed"] = True
            if len(dump(d)) <= DATA_MAX_CHARS:
                return dump(d)
    if isinstance(d.get("lines"), list):
        d["lines"] = [str(x)[:300] for x in d["lines"][:20]]
        if len(dump(d)) <= DATA_MAX_CHARS:
            return dump(d)
    if isinstance(d.get("envelope"), dict):
        env = d["envelope"]
        d["envelope"] = {k: env.get(k) for k in ("disposition", "local_notice") if k in env}
        d["envelope"]["ops"] = [{"action": o.get("action")} for o in (env.get("ops") or []) if isinstance(o, dict)][:24]
        if len(dump(d)) <= DATA_MAX_CHARS:
            return dump(d)
    keep = {k: data[k] for k in _ESSENTIAL if k in data}
    keep["trimmed"] = True
    out = dump(keep)
    return out if len(out) <= DATA_MAX_CHARS else dump({"trimmed": True})


def add_turn(user_id: int, conversation_id: str, role: str, text: str, data: dict | None = None) -> int:
    if role not in ("member", "agent", "outcome"):
        raise ValueError(f"bad role {role!r}")
    from api.services.uct_agent import retention       # Track C (c): both switches default OFF = identity / no prune
    text, data = retention.on_write(role, text, data)
    now = _now()
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute(
            "INSERT INTO agent_turns (conversation_id, user_id, role, text, data_json, created_at) VALUES (?,?,?,?,?,?)",
            (conversation_id, _uid(user_id), role, _clip(text),
             _data_json(data), now))
        c.execute("UPDATE agent_conversations SET updated_at = ? WHERE id = ? AND user_id = ?",
                  (now, conversation_id, _uid(user_id)))
        c.commit()
        row_id = int(cur.lastrowid)
    retention.maybe_prune(_connect, lock=_WRITE_LOCK)     # background thread, batched under the write lock
    return row_id


def list_conversations(user_id: int, limit: int = 100) -> list[dict]:
    """The member's chats: pinned first (most recently pinned on top), then newest activity."""
    with contextlib.closing(_connect()) as c:
        rows = c.execute("SELECT id, title, title_source, created_at, updated_at, pinned_at FROM agent_conversations "
                         "WHERE user_id = ? ORDER BY (pinned_at IS NULL), pinned_at DESC, updated_at DESC, rowid DESC LIMIT ?",
                         (_uid(user_id), int(limit))).fetchall()
    return [dict(r) for r in rows]


def rename_conversation(user_id: int, conversation_id: str, title: str) -> bool:
    """The member's own chat only. Whitespace collapsed, clipped to TITLE_LEN; an empty title is refused."""
    clean = " ".join(str(title or "").split())[:TITLE_LEN]
    if not clean:
        raise ValueError("empty title")
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute("UPDATE agent_conversations SET title = ?, title_source = 'user' WHERE id = ? AND user_id = ?",
                        (clean, str(conversation_id), _uid(user_id)))
        c.commit()
    return cur.rowcount == 1


def title_info(user_id: int, conversation_id: str) -> dict | None:
    """{title, source}: source None = still the first message, 'auto' = named by the Agent, 'user' = renamed."""
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT title, title_source FROM agent_conversations WHERE id = ? AND user_id = ?",
                        (str(conversation_id), _uid(user_id))).fetchone()
    return {"title": row["title"], "source": row["title_source"]} if row else None


def set_auto_title(user_id: int, conversation_id: str, title: str) -> bool:
    """The Agent's name for a chat. ⛔ NEVER over a name the member chose: the guard is in the
    UPDATE itself, so no caller (and no model output) can replace a 'user' title."""
    clean = " ".join(str(title or "").split())[:TITLE_LEN]
    if not clean:
        return False
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute("UPDATE agent_conversations SET title = ?, title_source = 'auto' WHERE id = ? AND user_id = ? "
                        "AND (title_source IS NULL OR title_source != 'user')",
                        (clean, str(conversation_id), _uid(user_id)))
        c.commit()
    return cur.rowcount == 1


def set_pinned(user_id: int, conversation_id: str, pinned: bool) -> bool:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute("UPDATE agent_conversations SET pinned_at = ? WHERE id = ? AND user_id = ?",
                        (_now() if pinned else None, str(conversation_id), _uid(user_id)))
        c.commit()
    return cur.rowcount == 1


def delete_conversation(user_id: int, conversation_id: str) -> bool:
    """Deletes the member's own chat and its transcript. Telemetry rows carry no
    conversation text and stay (they are counts, not content)."""
    if not owns(user_id, conversation_id):
        return False
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("DELETE FROM agent_turns WHERE conversation_id = ? AND user_id = ?", (str(conversation_id), _uid(user_id)))
        c.execute("DELETE FROM agent_conversation_state WHERE conversation_id = ? AND user_id = ?", (str(conversation_id), _uid(user_id)))
        cur = c.execute("DELETE FROM agent_conversations WHERE id = ? AND user_id = ?", (str(conversation_id), _uid(user_id)))
        c.commit()
    return cur.rowcount == 1


# ── per-conversation STATE (W1-C C-01, builder-c) ─────────────────────────────────────────────────────
# Small, keyed JSON the browser keeps for a chat beyond the session: today only `lastScreen` — the last
# screen's spec + result ids, so a follow-up ("now only technology") composes onto it after a reload.
# One row per (conversation, key); owner-scoped like every read here; a foreign or deleted conversation
# is never written into. The VALUE is the browser's (validated by the route before it gets here); it
# holds a screener spec and tickers, never a model's text and never a market value.
#: W3-3 (w3-a, 2026-11-03): `coachConsent` = {granted: bool, at: iso} -- the member's per-conversation consent to the
#: coach using their journal (services/uct_agent/coach.validate_consent); routed only while UCT_AGENT_COACH is on.
STATE_KEYS = ("lastScreen", "coachConsent")
STATE_MAX_CHARS = 20000


def set_state(user_id: int, conversation_id: str, key: str, value: Any) -> bool:
    """Replace the member's state `key` for their own conversation. False when the conversation is not
    theirs (or gone); ValueError for an unknown key or an over-size value."""
    if key not in STATE_KEYS:
        raise ValueError(f"unknown state key {key!r}")
    dump = json.dumps(value, separators=(",", ":"))
    if len(dump) > STATE_MAX_CHARS:
        raise ValueError(f"state {key!r} is over {STATE_MAX_CHARS} characters")
    if not owns(user_id, conversation_id):
        return False
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("INSERT INTO agent_conversation_state (conversation_id, user_id, key, value_json, updated_at) "
                  "VALUES (?,?,?,?,?) ON CONFLICT(conversation_id, key) DO UPDATE SET value_json = excluded.value_json, "
                  "updated_at = excluded.updated_at, user_id = excluded.user_id",
                  (str(conversation_id), _uid(user_id), key, dump, _now()))
        c.commit()
    return True


def get_state(user_id: int, conversation_id: str, key: str) -> dict | None:
    """{value, updated_at} for the member's own conversation, else None (also for an unknown key)."""
    if key not in STATE_KEYS:
        return None
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT value_json, updated_at FROM agent_conversation_state WHERE conversation_id = ? "
                        "AND user_id = ? AND key = ?", (str(conversation_id), _uid(user_id), key)).fetchone()
    if row is None:
        return None
    try:
        return {"value": json.loads(row["value_json"]), "updated_at": int(row["updated_at"])}
    except ValueError:
        return None


SEARCH_LIMIT = 60
SEARCH_TERMS = 6


def search_turns(user_id: int, query: str, limit: int = SEARCH_LIMIT) -> list[dict]:
    """History search across the member's OWN chats: every word must appear (any order, any case),
    newest first. Each hit names its conversation (id + title) and when it was said."""
    terms = [t.lstrip("$") for t in str(query or "").lower().split()]
    terms = [t for t in terms if t][:SEARCH_TERMS]
    if not terms:
        return []
    def like(t: str) -> str:
        return "%" + t.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    where = " AND ".join(["lower(t.text) LIKE ? ESCAPE '\\'"] * len(terms))
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT t.id, t.conversation_id, t.role, t.text, t.created_at, c.title FROM agent_turns t "
            "JOIN agent_conversations c ON c.id = t.conversation_id AND c.user_id = t.user_id "
            f"WHERE t.user_id = ? AND {where} ORDER BY t.created_at DESC, t.id DESC LIMIT ?",
            (_uid(user_id), *[like(t) for t in terms], int(limit))).fetchall()
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
                   "cost_usd", "research_calls", "unsupported", "voice", "model_calls", "input_tokens", "output_tokens",
                   "cache_read_tokens", "cache_write_tokens", "schema_mode", "visible_ms", "verified_ms")


def _int_or_none(v: Any) -> int | None:
    return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def record_telemetry(user_id: int, conversation_id: str | None, row: dict) -> None:
    """Structured, content-free. Never raises into a request."""
    try:
        vals = {k: row.get(k) for k in _TELEMETRY_COLS}
        actions = row.get("actions") or []
        with _WRITE_LOCK, contextlib.closing(_connect()) as c:
            c.execute(
                "INSERT INTO agent_telemetry (user_id, conversation_id, path, disposition, actions, refused, "
                "clarified, undo, latency_ms, model, cost_usd, research_calls, unsupported, voice, created_at, "
                "model_calls, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, schema_mode, "
                "visible_ms, verified_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (_uid(user_id), conversation_id, _clip(vals["path"], 16), _clip(vals["disposition"], 16),
                 json.dumps([_clip(a, 40) for a in actions][:16]),
                 int(bool(vals["refused"])), int(bool(vals["clarified"])), int(bool(vals["undo"])),
                 int(vals["latency_ms"]) if isinstance(vals["latency_ms"], (int, float)) else None,
                 _clip(vals["model"], 64) or None,
                 float(vals["cost_usd"]) if isinstance(vals["cost_usd"], (int, float)) else None,
                 int(vals["research_calls"] or 0), _clip(vals["unsupported"], 40) or None,
                 int(bool(vals["voice"])), _now(),
                 *(_int_or_none(vals[k]) for k in ("model_calls", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens")),
                 (vals["schema_mode"] if vals["schema_mode"] in ("constant", "routed") else None),
                 _int_or_none(vals["visible_ms"]), _int_or_none(vals["verified_ms"])))
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
