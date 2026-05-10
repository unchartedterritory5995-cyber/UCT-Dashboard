# Voice Assistant — Slice 4: Realtime Conversational AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the conversational ChatGPT-like voice layer. Click the floating orb (or hit `Cmd/Ctrl+Shift+V`) and have a continuous spoken conversation with an AI that remembers context, reasons over real-time data via the tool registry, and responds with sub-second latency. The AI can be interrupted mid-sentence, can ask follow-up questions, and chains tool calls naturally.

**Architecture:** Browser opens a direct WebRTC peer connection to OpenAI's Realtime API (`gpt-realtime` model). Backend mints ephemeral 60s session tokens (no permanent API key in browser), defines the tool catalog (reused from Slice 2), and handles tool execution callbacks via `/api/voice/exec`. Audio is bidirectional and continuous — mic streams up, model audio streams down through the existing `<audio>` element. Tool calls flow over a data channel: model emits a function call → browser POSTs args to `/exec` → backend dispatches via voice_tools registry → result returns to browser → browser sends result back into the conversation → model continues speaking with the result naturally voiced.

**Tech Stack:** OpenAI Realtime API (`gpt-realtime` model) · WebRTC (RTCPeerConnection + RTCDataChannel) · existing voice_tools registry from Slice 2 · existing VoiceContext from Slice 1 · FastAPI · React 18

**Spec:** `docs/superpowers/specs/2026-05-08-voice-assistant-design.md` §2 Mode C, §4.3, §6 Backend additions, §8 Security.

**Builds on (already shipped):**
- Slice 1: voice_openai client wrapper, voice_settings, voice_audio_cache, VoiceContext, AudioPlayerBar
- Slice 2: voice_tools registry + 12 read-only tool implementations, intent classifier, FloatingOrb, TranscriptBubble, useOneShot hook (kept around but Slice 4 orb defaults to Mode C)

**Scope (this plan):**
- ✅ Realtime conversational mode (Mode C) is the default orb-click experience
- ✅ Tool calling via existing voice_tools catalog
- ✅ Transcripts persisted to `voice_sessions` + `voice_transcripts` tables
- ✅ Mode C usage tracking + per-tier monthly cap
- ✅ Auto-disconnect on 8s silence
- ✅ User can interrupt the model mid-response (WebRTC + server VAD handles natively)

**Out of scope (future slices):**
- ❌ Wake word "Hey UCT Intelligence" → Slice 3 (deferred, comes after this)
- ❌ Voice History page UI (transcripts are saved server-side; viewing UI is polish)
- ❌ Write tools with two-phase confirm (Slice 5)
- ❌ Agentic flows (Slice 6)
- ❌ Self-Q&A on journal data (Slice 7)

---

## File Structure

### Backend

| File | Responsibility |
|------|----------------|
| `api/services/voice_openai.py` | Add `mint_realtime_session()` — calls `POST /v1/realtime/sessions`, returns ephemeral client_secret |
| `api/services/voice_session_service.py` | NEW. CRUD for `voice_sessions` and `voice_transcripts` rows |
| `api/services/voice_usage.py` | Add `record_mode_c_seconds()` + `is_within_mode_c_cap()` |
| `api/services/auth_db.py` | Add `voice_sessions` and `voice_transcripts` tables to schema |
| `api/services/voice_dispatch.py` | NEW. Wraps `voice_tools.dispatch` with audit logging + result normalization for Realtime function-call responses |
| `api/routers/voice.py` | Add `POST /session_token`, `POST /exec`, `POST /transcript`, `POST /session/end` |

### Frontend

| File | Responsibility |
|------|----------------|
| `app/src/hooks/useRealtimeSession.js` | NEW. WebRTC peer-connection lifecycle, data-channel event handling, tool-call dispatch |
| `app/src/context/VoiceContext.jsx` | Extend reducer with Mode C states (`connecting`, `connected`, `speaking_user`, `speaking_assistant`, `disconnected`) |
| `app/src/components/voice/FloatingOrb.jsx` | Modify orb to start Mode C (Realtime) instead of Mode B (one-shot) on click |
| `app/src/components/voice/TranscriptBubble.jsx` | Extend to render rolling Mode C conversation history (last user turn + last assistant turn) |
| `app/src/components/voice/AudioPlayerBar.jsx` | Allow assigning the WebRTC `MediaStream` directly to `<audio>` (`srcObject` instead of `src`) |
| `app/src/utils/realtimeEventHandlers.js` | NEW. Pure functions to parse Realtime data-channel events |

### Tests

| File | Coverage |
|------|----------|
| `tests/test_voice_session_service.py` | session create/end, transcript append, retention |
| `tests/test_voice_dispatch.py` | dispatch wraps tool calls, normalizes errors, logs audit entries |
| `tests/test_voice_realtime_endpoints.py` | `/session_token`, `/exec`, `/transcript`, `/session/end` (mocked OpenAI) |
| `app/src/hooks/useRealtimeSession.test.js` | mock RTCPeerConnection, verify SDP exchange, data-channel event parsing, tool-call dispatch |
| `app/src/utils/realtimeEventHandlers.test.js` | event parser produces expected dispatches |

### No new dependencies

- WebRTC is built into the browser
- OpenAI SDK already supports `client.beta.realtime.sessions.create()`

---

## Plan-Wide Conventions

- **Realtime model:** `gpt-realtime` (latest production model name as of 2026; if unavailable in the user's account, `gpt-4o-realtime-preview-2024-12-17` is the fallback). The model name is configurable via `OPENAI_REALTIME_MODEL` env var.
- **Default voice for Mode C:** uses `voice_settings.voice` (whatever the user picked in Slice 1 settings). Falls back to `verse`.
- **Auto-disconnect:** if the data channel sees 8 consecutive seconds with no user audio events AND no model speaking, the browser tears down the peer connection and dispatches `b_disconnect` (yes Mode C reuses the disconnect action — same teardown path).
- **Cap:** default 100 minutes/month per paid user. Admins uncapped. Cap is enforced server-side at session-token mint time AND is rechecked every 30s during the session via `record_mode_c_seconds(...)`. If a user exceeds during a session, the next 30s tick triggers a graceful disconnect with a spoken "monthly limit reached" message via the data channel.
- **Tool subset:** `/session_token` requires a `context` field (e.g., `global`, `chart`, `journal`). The minted session's `tools` array is filtered via the existing `voice_tools.get_schema_for_context(context)`.
- **Transcript persistence:** every `conversation.item.input_audio_transcription.completed` (user turn) and `response.audio_transcript.done` (assistant turn) is POSTed by the browser to `/api/voice/transcript`. Backend appends to `voice_transcripts`.
- **Commit cadence:** one commit per task. Conventional `feat(voice):` / `fix(voice):` / `test(voice):`.

---

## Task 1: Add voice_sessions + voice_transcripts tables

**Files:**
- Modify: `api/services/auth_db.py`
- Test: `tests/test_voice_db_schema.py`

- [ ] **Step 1: Append failing tests**

Append to `tests/test_voice_db_schema.py`:

```python


def test_voice_sessions_table_exists():
    init_db()
    conn = get_connection()
    try:
        cols = conn.execute("PRAGMA table_info(voice_sessions)").fetchall()
        col_names = {c["name"] for c in cols}
        assert {"id", "user_id", "mode", "started_at", "ended_at",
                "duration_seconds", "status", "page_context"}.issubset(col_names)
    finally:
        conn.close()


def test_voice_transcripts_table_exists():
    init_db()
    conn = get_connection()
    try:
        cols = conn.execute("PRAGMA table_info(voice_transcripts)").fetchall()
        col_names = {c["name"] for c in cols}
        assert {"id", "session_id", "role", "text", "timestamp"}.issubset(col_names)
    finally:
        conn.close()
```

- [ ] **Step 2: Run — should fail**

```
cd C:/Users/Patrick/uct-dashboard
python -m pytest tests/test_voice_db_schema.py -v
```

Expected: 2 new tests fail with "no such table".

- [ ] **Step 3: Add to `_SCHEMA`**

In `api/services/auth_db.py`, append to the `_SCHEMA` triple-quoted string (just before its closing `"""`):

```sql
CREATE TABLE IF NOT EXISTS voice_sessions (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id            TEXT NOT NULL REFERENCES users(id),
    mode               TEXT NOT NULL,
    source             TEXT,
    started_at         TIMESTAMP NOT NULL,
    ended_at           TIMESTAMP,
    duration_seconds   INTEGER,
    status             TEXT NOT NULL,
    page_context       TEXT,
    estimated_cost_usd REAL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_voice_sessions_user ON voice_sessions(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS voice_transcripts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   INTEGER NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE,
    role         TEXT NOT NULL,
    text         TEXT NOT NULL,
    timestamp    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_voice_transcripts_session ON voice_transcripts(session_id, timestamp);
```

- [ ] **Step 4: Run — should pass**

```
python -m pytest tests/test_voice_db_schema.py -v
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```
git add api/services/auth_db.py tests/test_voice_db_schema.py
git commit -m "feat(voice): add voice_sessions + voice_transcripts tables"
```

---

## Task 2: voice_session_service — CRUD for sessions and transcripts

**Files:**
- Create: `api/services/voice_session_service.py`
- Create: `tests/test_voice_session_service.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_voice_session_service.py`:

```python
"""Voice session + transcript service."""

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services.voice_session_service import (
    create_session, end_session, append_transcript,
    get_session, list_sessions, get_transcripts,
)


def _user():
    init_db()
    return create_user(f"vs_{__import__('uuid').uuid4()}@example.com", "password123")["id"]


def test_create_session_returns_id_with_active_status():
    uid = _user()
    sid = create_session(user_id=uid, mode="c", source="orb", page_context="global")
    s = get_session(sid)
    assert s["user_id"] == uid
    assert s["mode"] == "c"
    assert s["status"] == "active"
    assert s["ended_at"] is None


def test_end_session_records_duration():
    uid = _user()
    sid = create_session(user_id=uid, mode="c", source="orb", page_context="global")
    end_session(sid, duration_seconds=42)
    s = get_session(sid)
    assert s["status"] == "closed"
    assert s["duration_seconds"] == 42
    assert s["ended_at"] is not None


def test_append_transcript_persists():
    uid = _user()
    sid = create_session(user_id=uid, mode="c", source="orb", page_context="global")
    append_transcript(sid, role="user", text="What's NVDA at?")
    append_transcript(sid, role="assistant", text="NVDA is at 487, up 2 percent.")
    rows = get_transcripts(sid)
    assert len(rows) == 2
    assert rows[0]["role"] == "user"
    assert "NVDA" in rows[1]["text"]


def test_list_sessions_for_user_returns_recent_first():
    uid = _user()
    s1 = create_session(user_id=uid, mode="c", source="orb", page_context="global")
    s2 = create_session(user_id=uid, mode="c", source="orb", page_context="global")
    sessions = list_sessions(uid, limit=10)
    ids = [s["id"] for s in sessions]
    assert s2 in ids and s1 in ids
```

- [ ] **Step 2: Run — should fail**

```
python -m pytest tests/test_voice_session_service.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement**

Create `api/services/voice_session_service.py`:

```python
"""
Voice session + transcript persistence.

Sessions are append-only; transcripts are rolling per-session text logs.
Used by Mode C (Realtime conversational) primarily. Mode A read-aloud and
Mode B one-shot do NOT create sessions — they are point-in-time operations.
"""

from datetime import datetime, timezone
from api.services.auth_db import get_connection


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_session(*, user_id: str, mode: str, source: str = "orb",
                   page_context: str = "global") -> int:
    """Insert a new session row, return its id."""
    conn = get_connection()
    try:
        cur = conn.execute(
            """INSERT INTO voice_sessions
               (user_id, mode, source, started_at, status, page_context)
               VALUES (?, ?, ?, ?, 'active', ?)""",
            (user_id, mode, source, _now(), page_context),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def end_session(session_id: int, *, duration_seconds: int,
                status: str = "closed", estimated_cost_usd: float = 0.0) -> None:
    """Mark a session ended with its observed duration."""
    conn = get_connection()
    try:
        conn.execute(
            """UPDATE voice_sessions
               SET ended_at = ?, duration_seconds = ?, status = ?,
                   estimated_cost_usd = ?
               WHERE id = ?""",
            (_now(), int(duration_seconds), status, float(estimated_cost_usd), session_id),
        )
        conn.commit()
    finally:
        conn.close()


def append_transcript(session_id: int, *, role: str, text: str) -> None:
    """Append one transcript entry. role is 'user' | 'assistant' | 'tool'."""
    if role not in {"user", "assistant", "tool"}:
        raise ValueError(f"role must be user/assistant/tool, got {role!r}")
    text = (text or "").strip()
    if not text:
        return
    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO voice_transcripts (session_id, role, text, timestamp)
               VALUES (?, ?, ?, ?)""",
            (session_id, role, text[:8000], _now()),
        )
        conn.commit()
    finally:
        conn.close()


def get_session(session_id: int) -> dict | None:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM voice_sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if row is None:
            return None
        return dict(row)
    finally:
        conn.close()


def list_sessions(user_id: str, *, limit: int = 50) -> list[dict]:
    """Most recent sessions first."""
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT * FROM voice_sessions
               WHERE user_id = ?
               ORDER BY started_at DESC
               LIMIT ?""",
            (user_id, max(1, min(limit, 200))),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_transcripts(session_id: int) -> list[dict]:
    """All transcript entries for a session, oldest first."""
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT * FROM voice_transcripts
               WHERE session_id = ?
               ORDER BY timestamp ASC""",
            (session_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def session_belongs_to_user(session_id: int, user_id: str) -> bool:
    """Authorization helper — confirm a session id is owned by the given user."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT user_id FROM voice_sessions WHERE id = ?", (session_id,)
        ).fetchone()
        return row is not None and row["user_id"] == user_id
    finally:
        conn.close()
```

- [ ] **Step 4: Run — should pass**

```
python -m pytest tests/test_voice_session_service.py -v
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```
git add api/services/voice_session_service.py tests/test_voice_session_service.py
git commit -m "feat(voice): add session + transcript persistence service"
```

---

## Task 3: Mode C usage tracking

**Files:**
- Modify: `api/services/voice_usage.py`
- Modify: `tests/test_voice_usage.py`

- [ ] **Step 1: Append tests**

Append to `tests/test_voice_usage.py`:

```python


# ── Mode C ──────────────────────────────────────────────────────────────────

def test_record_mode_c_seconds_accumulates():
    from api.services.voice_usage import (
        record_mode_c_seconds, get_monthly_usage, MODE_C_DEFAULT_CAP_SECONDS,
    )
    uid = _make_user()
    record_mode_c_seconds(uid, 30)
    record_mode_c_seconds(uid, 45)
    assert get_monthly_usage(uid)["mode_c_seconds"] == 75


def test_within_mode_c_cap():
    from api.services.voice_usage import (
        record_mode_c_seconds, is_within_mode_c_cap, MODE_C_DEFAULT_CAP_SECONDS,
    )
    uid = _make_user()
    assert is_within_mode_c_cap(uid)
    record_mode_c_seconds(uid, MODE_C_DEFAULT_CAP_SECONDS)
    assert not is_within_mode_c_cap(uid)
    assert is_within_mode_c_cap(uid, is_admin=True)
```

- [ ] **Step 2: Run — should fail**

```
python -m pytest tests/test_voice_usage.py -v
```

Expected: 2 new tests fail (ImportError).

- [ ] **Step 3: Implement**

Append to `api/services/voice_usage.py`:

```python


# ── Mode C (realtime conversation) ──────────────────────────────────────────

# 100 minutes/month default. ~$30/user/month max.
# Real cost per second varies (input ~$0.06/min, output ~$0.24/min).
# Use $0.005/sec as a conservative blended estimate.
MODE_C_DEFAULT_CAP_SECONDS = 6000
MODE_C_COST_PER_SECOND = 0.005


def record_mode_c_seconds(user_id: str, seconds: int) -> None:
    """Add Mode C seconds for the current calendar month."""
    if seconds <= 0:
        return
    ym = _current_year_month()
    cost_delta = seconds * MODE_C_COST_PER_SECOND
    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO voice_usage_monthly
               (user_id, year_month, mode_c_seconds, estimated_cost_usd)
               VALUES (?, ?, ?, ?)
               ON CONFLICT (user_id, year_month) DO UPDATE SET
                 mode_c_seconds = mode_c_seconds + excluded.mode_c_seconds,
                 estimated_cost_usd = estimated_cost_usd + excluded.estimated_cost_usd""",
            (user_id, ym, int(seconds), cost_delta),
        )
        conn.commit()
    finally:
        conn.close()


def is_within_mode_c_cap(
    user_id: str,
    *,
    cap_seconds: int = MODE_C_DEFAULT_CAP_SECONDS,
    is_admin: bool = False,
) -> bool:
    if is_admin:
        return True
    return get_monthly_usage(user_id)["mode_c_seconds"] < cap_seconds
```

- [ ] **Step 4: Run — should pass**

```
python -m pytest tests/test_voice_usage.py -v
```

Expected: 9 tests pass (5 original + 2 Mode B + 2 Mode C).

- [ ] **Step 5: Commit**

```
git add api/services/voice_usage.py tests/test_voice_usage.py
git commit -m "feat(voice): add Mode C (realtime) usage tracking + cap"
```

---

## Task 4: voice_dispatch — wraps voice_tools.dispatch with audit + normalization

**Files:**
- Create: `api/services/voice_dispatch.py`
- Create: `tests/test_voice_dispatch.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_voice_dispatch.py`:

```python
"""Voice dispatch — wraps voice_tools.dispatch with audit logging + Realtime-format normalization."""

from unittest.mock import patch
from api.services import voice_dispatch
from api.services.auth_db import init_db


def test_run_tool_returns_normalized_result():
    init_db()
    from api.services import voice_tools, voice_tool_impls  # noqa
    with patch("api.services.voice_dispatch.dispatch", return_value={"symbol": "NVDA", "last": 487.20}):
        out = voice_dispatch.run_tool(
            session_id=None,
            user_id="u-1",
            tool_name="get_quote",
            args={"symbol": "NVDA"},
        )
    assert out["ok"] is True
    assert out["result"]["symbol"] == "NVDA"


def test_run_tool_unknown_returns_error_envelope():
    init_db()
    out = voice_dispatch.run_tool(
        session_id=None,
        user_id="u-1",
        tool_name="this_tool_does_not_exist",
        args={},
    )
    assert out["ok"] is False
    assert "not found" in out["error"].lower() or "unknown" in out["error"].lower()


def test_run_tool_arg_mismatch_returns_error():
    init_db()
    from api.services import voice_tools

    @voice_tools.voice_tool(
        name="dispatch_test_strict",
        description="d",
        parameters={"a": {"type": "integer"}},
        contexts=["global"],
    )
    def _strict(a: int):
        return {"ok": True}

    out = voice_dispatch.run_tool(
        session_id=None, user_id="u-1",
        tool_name="dispatch_test_strict", args={"wrong_key": 1},
    )
    assert out["ok"] is False
```

- [ ] **Step 2: Run — should fail**

```
python -m pytest tests/test_voice_dispatch.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement**

Create `api/services/voice_dispatch.py`:

```python
"""
Wraps voice_tools.dispatch with:
  - error normalization (always returns {ok, result|error} envelope for Realtime)
  - audit logging (session_id transcripts, future Slice 5 write-tool gate)

The OpenAI Realtime API expects function call results as a JSON-serializable
value. This module returns {"ok": bool, "result": ..., "error": ...} so the
browser data-channel handler can pass it straight through.
"""

import json
import logging

from api.services.voice_tools import dispatch
from api.services.voice_session_service import append_transcript

_log = logging.getLogger(__name__)


def run_tool(
    *,
    session_id: int | None,
    user_id: str,
    tool_name: str,
    args: dict,
) -> dict:
    """
    Execute a tool. Always returns {ok, result|error}.

    session_id: optional. When present, appends a transcript entry of role 'tool'.
    """
    safe_args = args or {}

    try:
        result = dispatch(tool_name, safe_args, user={"id": user_id})
    except KeyError as e:
        msg = f"tool {tool_name!r} not found"
        _log.warning(msg)
        return {"ok": False, "tool": tool_name, "error": msg}
    except (ValueError, TypeError) as e:
        msg = f"tool {tool_name} failed: {e}"
        _log.warning(msg)
        if session_id:
            append_transcript(session_id, role="tool", text=f"{tool_name}: ERROR — {e}")
        return {"ok": False, "tool": tool_name, "error": str(e)}
    except Exception as e:  # noqa: BLE001
        msg = f"tool {tool_name} unexpected error: {e}"
        _log.exception(msg)
        if session_id:
            append_transcript(session_id, role="tool", text=f"{tool_name}: ERROR — {e}")
        return {"ok": False, "tool": tool_name, "error": str(e)}

    if session_id:
        try:
            append_transcript(
                session_id,
                role="tool",
                text=f"{tool_name}({json.dumps(safe_args)[:200]}) -> {json.dumps(result)[:400]}",
            )
        except Exception:
            pass

    return {"ok": True, "tool": tool_name, "result": result}
```

- [ ] **Step 4: Run — should pass**

```
python -m pytest tests/test_voice_dispatch.py -v
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```
git add api/services/voice_dispatch.py tests/test_voice_dispatch.py
git commit -m "feat(voice): add dispatch wrapper for Realtime tool calls"
```

---

## Task 5: voice_openai — mint_realtime_session

**Files:**
- Modify: `api/services/voice_openai.py`
- Modify: `tests/test_voice_openai.py`

- [ ] **Step 1: Append tests**

Append to `tests/test_voice_openai.py`:

```python


# ── Realtime session minting ────────────────────────────────────────────────

def test_mint_realtime_session_returns_client_secret():
    fake_session = MagicMock()
    fake_session.id = "sess_abc123"
    fake_session.client_secret = MagicMock(value="ek_xyz999", expires_at=1234567890)

    fake_client = MagicMock()
    fake_client.beta.realtime.sessions.create.return_value = fake_session

    tools_schema = [{"name": "get_quote", "description": "d",
                     "parameters": {"type": "object", "properties": {}}}]

    with patch.object(voice_openai, "_get_client", return_value=fake_client):
        out = voice_openai.mint_realtime_session(
            voice="verse",
            tools=tools_schema,
            instructions="be helpful",
        )

    assert out["session_id"] == "sess_abc123"
    assert out["client_secret"] == "ek_xyz999"
    assert out["expires_at"] == 1234567890
    fake_client.beta.realtime.sessions.create.assert_called_once()
    kwargs = fake_client.beta.realtime.sessions.create.call_args.kwargs
    assert kwargs["voice"] == "verse"
    assert kwargs["instructions"] == "be helpful"
    assert isinstance(kwargs["tools"], list)
```

- [ ] **Step 2: Run — should fail**

```
python -m pytest tests/test_voice_openai.py::test_mint_realtime_session_returns_client_secret -v
```

Expected: AttributeError.

- [ ] **Step 3: Implement**

Append to `api/services/voice_openai.py`:

```python


# ── Realtime session minting ────────────────────────────────────────────────

import os as _os

REALTIME_MODEL = _os.environ.get("OPENAI_REALTIME_MODEL", "gpt-realtime")


def mint_realtime_session(
    *,
    voice: str,
    tools: list[dict],
    instructions: str,
    model: str | None = None,
) -> dict:
    """
    Create an ephemeral Realtime session via the OpenAI SDK.
    Returns {session_id, client_secret, expires_at, model}.

    The browser uses client_secret as Bearer auth in the WebRTC SDP exchange.
    """
    client = _get_client()
    # SDK expects tools in OpenAI function-tool format. Wrap each.
    tool_specs = []
    for t in tools or []:
        tool_specs.append({
            "type": "function",
            "name": t["name"],
            "description": t.get("description", ""),
            "parameters": t.get("parameters") or {"type": "object", "properties": {}},
        })

    session = client.beta.realtime.sessions.create(
        model=model or REALTIME_MODEL,
        voice=voice,
        modalities=["audio", "text"],
        instructions=instructions,
        tools=tool_specs,
        tool_choice="auto",
        turn_detection={"type": "server_vad", "threshold": 0.5},
        input_audio_transcription={"model": "whisper-1"},
    )

    secret_obj = getattr(session, "client_secret", None)
    secret_value = getattr(secret_obj, "value", None) if secret_obj else None
    expires_at = getattr(secret_obj, "expires_at", None) if secret_obj else None

    return {
        "session_id": session.id,
        "client_secret": secret_value,
        "expires_at": expires_at,
        "model": model or REALTIME_MODEL,
    }
```

- [ ] **Step 4: Run — should pass**

```
python -m pytest tests/test_voice_openai.py -v
```

Expected: 8 tests pass (existing + 1 new).

- [ ] **Step 5: Commit**

```
git add api/services/voice_openai.py tests/test_voice_openai.py
git commit -m "feat(voice): add mint_realtime_session for ephemeral Realtime tokens"
```

---

## Task 6: /api/voice/session_token endpoint

**Files:**
- Modify: `api/routers/voice.py`
- Modify: `tests/test_voice_router.py`

- [ ] **Step 1: Append tests**

Append to `tests/test_voice_router.py`:

```python


# ── Realtime endpoints (Slice 4) ───────────────────────────────────────────

def test_session_token_requires_paid(client):
    _login(client, plan="free")
    r = client.post("/api/voice/session_token", json={"context": "global"})
    assert r.status_code == 402


def test_session_token_returns_ephemeral_secret(client):
    _login(client, plan="pro")
    fake_mint = {"session_id": "sess_x", "client_secret": "ek_secret",
                 "expires_at": 9999999999, "model": "gpt-realtime"}
    with patch("api.routers.voice.mint_realtime_session", return_value=fake_mint):
        r = client.post("/api/voice/session_token", json={"context": "global"})
    assert r.status_code == 200
    body = r.json()
    assert body["client_secret"] == "ek_secret"
    assert body["model"] == "gpt-realtime"
    assert "session_id" in body  # our internal voice_sessions row id
    assert "openai_session_id" in body  # OpenAI's


def test_session_token_blocks_when_cap_exceeded(client):
    _login(client, plan="pro")
    from api.services.voice_usage import record_mode_c_seconds, MODE_C_DEFAULT_CAP_SECONDS
    # We need user.id; the helper grabbed it during _login but didn't return.
    # Pull it from the db instead.
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        row = conn.execute("SELECT id FROM users ORDER BY created_at DESC LIMIT 1").fetchone()
        uid = row["id"]
    finally:
        conn.close()
    record_mode_c_seconds(uid, MODE_C_DEFAULT_CAP_SECONDS)

    fake_mint = {"session_id": "sess_x", "client_secret": "ek", "expires_at": 0, "model": "x"}
    with patch("api.routers.voice.mint_realtime_session", return_value=fake_mint):
        r = client.post("/api/voice/session_token", json={"context": "global"})
    assert r.status_code == 429
```

- [ ] **Step 2: Run — should fail**

```
python -m pytest tests/test_voice_router.py -v 2>&1 | tail -10
```

Expected: 3 new tests fail.

- [ ] **Step 3: Add the endpoint**

Add imports near the existing voice imports in `api/routers/voice.py`:

```python
from api.services.voice_openai import mint_realtime_session
from api.services.voice_session_service import (
    create_session as _create_voice_session, end_session as _end_voice_session,
    append_transcript, session_belongs_to_user,
)
from api.services.voice_usage import (
    record_mode_c_seconds, is_within_mode_c_cap, MODE_C_DEFAULT_CAP_SECONDS,
)
```

Append at the end of `api/routers/voice.py`:

```python


# ── Slice 4: Realtime (Mode C) ─────────────────────────────────────────────

class SessionTokenRequest(BaseModel):
    context: str = "global"


_REALTIME_INSTRUCTIONS = (
    "You are UCT Intelligence, a voice trading assistant inside a stock-market "
    "dashboard. You can see the user's available tools and call them to look up "
    "real-time data. Be concise and natural. Round numbers reasonably. Never "
    "invent prices or data — if a tool fails, say so and offer to try a different "
    "approach. Avoid disclaimers; the user is an experienced trader. Speak like "
    "a sharp colleague, not a chatbot."
)


@router.post("/session_token")
@limiter.limit("10/minute")
def session_token(
    request: Request,
    body: SessionTokenRequest,
    user: dict = Depends(requires_voice_access),
):
    settings = get_voice_settings(user["id"])
    if not settings.get("enabled", True):
        raise HTTPException(status_code=400, detail="voice features disabled in settings")

    is_admin = user.get("role") == "admin"
    if not is_within_mode_c_cap(user["id"], is_admin=is_admin):
        raise HTTPException(status_code=429, detail="monthly conversation cap reached")

    try:
        from api.services.voice_openai import _get_client
        _get_client()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    tools_schema = get_schema_for_context(body.context or "global")

    try:
        mint = mint_realtime_session(
            voice=settings["voice"],
            tools=tools_schema,
            instructions=_REALTIME_INSTRUCTIONS,
        )
    except Exception as e:  # noqa: BLE001
        _log.exception("realtime session mint failed")
        raise HTTPException(status_code=502, detail=f"Realtime session mint failed: {e}")

    sess_db_id = _create_voice_session(
        user_id=user["id"], mode="c", source="orb", page_context=body.context or "global",
    )

    return {
        "session_id": sess_db_id,
        "openai_session_id": mint["session_id"],
        "client_secret": mint["client_secret"],
        "expires_at": mint["expires_at"],
        "model": mint["model"],
        "voice": settings["voice"],
        "tools": tools_schema,
    }
```

- [ ] **Step 4: Run — should pass**

```
python -m pytest tests/test_voice_router.py -v 2>&1 | tail -10
```

Expected: all router tests pass (Slice 1+2+3 new ones).

- [ ] **Step 5: Commit**

```
git add api/routers/voice.py tests/test_voice_router.py
git commit -m "feat(voice): add /session_token endpoint for Realtime"
```

---

## Task 7: /api/voice/exec endpoint (tool execution callback)

**Files:**
- Modify: `api/routers/voice.py`
- Modify: `tests/test_voice_router.py`

- [ ] **Step 1: Append tests**

Append to `tests/test_voice_router.py`:

```python


def test_exec_requires_paid(client):
    _login(client, plan="free")
    r = client.post("/api/voice/exec", json={"session_id": 1, "tool": "get_quote", "args": {}})
    assert r.status_code == 402


def test_exec_runs_tool_and_returns_envelope(client):
    _login(client, plan="pro")
    # Create a session for this user so authorization passes
    from api.services.voice_session_service import create_session
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        row = conn.execute("SELECT id FROM users ORDER BY created_at DESC LIMIT 1").fetchone()
        uid = row["id"]
    finally:
        conn.close()
    sid = create_session(user_id=uid, mode="c", source="orb", page_context="global")

    with patch("api.routers.voice.run_tool", return_value={
        "ok": True, "tool": "get_quote", "result": {"symbol": "NVDA", "last": 487.20},
    }):
        r = client.post("/api/voice/exec", json={
            "session_id": sid, "tool": "get_quote", "args": {"symbol": "NVDA"},
        })
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["result"]["symbol"] == "NVDA"


def test_exec_rejects_session_owned_by_another_user(client):
    _login(client, plan="pro")
    from api.services.auth_service import create_user
    from api.services.voice_session_service import create_session
    other = create_user(f"other_{__import__('uuid').uuid4()}@example.com", "p")
    sid = create_session(user_id=other["id"], mode="c", source="orb", page_context="global")

    r = client.post("/api/voice/exec", json={"session_id": sid, "tool": "get_quote", "args": {}})
    assert r.status_code == 403
```

- [ ] **Step 2: Run — should fail**

```
python -m pytest tests/test_voice_router.py -v 2>&1 | tail -10
```

Expected: 3 new tests fail.

- [ ] **Step 3: Add the endpoint**

Add this import near the existing imports in `api/routers/voice.py`:

```python
from api.services.voice_dispatch import run_tool
```

Append at the end:

```python


class ExecRequest(BaseModel):
    session_id: int
    tool: str
    args: dict = {}


@router.post("/exec")
@limiter.limit("120/minute")
def exec_tool(
    request: Request,
    body: ExecRequest,
    user: dict = Depends(requires_voice_access),
):
    if not session_belongs_to_user(body.session_id, user["id"]):
        raise HTTPException(status_code=403, detail="session not owned by user")

    return run_tool(
        session_id=body.session_id,
        user_id=user["id"],
        tool_name=body.tool,
        args=body.args or {},
    )
```

- [ ] **Step 4: Run — should pass**

```
python -m pytest tests/test_voice_router.py -v 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```
git add api/routers/voice.py tests/test_voice_router.py
git commit -m "feat(voice): add /exec endpoint for Realtime tool callbacks"
```

---

## Task 8: /transcript and /session/end endpoints

**Files:**
- Modify: `api/routers/voice.py`
- Modify: `tests/test_voice_router.py`

- [ ] **Step 1: Append tests**

Append to `tests/test_voice_router.py`:

```python


def test_transcript_appends(client):
    _login(client, plan="pro")
    from api.services.voice_session_service import create_session, get_transcripts
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        row = conn.execute("SELECT id FROM users ORDER BY created_at DESC LIMIT 1").fetchone()
        uid = row["id"]
    finally:
        conn.close()
    sid = create_session(user_id=uid, mode="c", source="orb", page_context="global")

    r = client.post("/api/voice/transcript", json={
        "session_id": sid, "role": "user", "text": "what's NVDA at",
    })
    assert r.status_code == 200
    rows = get_transcripts(sid)
    assert len(rows) == 1
    assert rows[0]["role"] == "user"


def test_session_end_records_duration(client):
    _login(client, plan="pro")
    from api.services.voice_session_service import create_session, get_session
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        row = conn.execute("SELECT id FROM users ORDER BY created_at DESC LIMIT 1").fetchone()
        uid = row["id"]
    finally:
        conn.close()
    sid = create_session(user_id=uid, mode="c", source="orb", page_context="global")

    r = client.post("/api/voice/session/end", json={
        "session_id": sid, "duration_seconds": 17,
    })
    assert r.status_code == 200
    s = get_session(sid)
    assert s["status"] == "closed"
    assert s["duration_seconds"] == 17
```

- [ ] **Step 2: Run — should fail**

```
python -m pytest tests/test_voice_router.py -v 2>&1 | tail -10
```

Expected: 2 new tests fail.

- [ ] **Step 3: Add endpoints**

Append to `api/routers/voice.py`:

```python


class TranscriptRequest(BaseModel):
    session_id: int
    role: str
    text: str


class SessionEndRequest(BaseModel):
    session_id: int
    duration_seconds: int


@router.post("/transcript")
@limiter.limit("180/minute")
def transcript_post(
    request: Request,
    body: TranscriptRequest,
    user: dict = Depends(requires_voice_access),
):
    if not session_belongs_to_user(body.session_id, user["id"]):
        raise HTTPException(status_code=403, detail="session not owned by user")
    if body.role not in {"user", "assistant", "tool"}:
        raise HTTPException(status_code=400, detail="invalid role")
    append_transcript(body.session_id, role=body.role, text=body.text or "")
    return {"ok": True}


@router.post("/session/end")
@limiter.limit("60/minute")
def session_end_post(
    request: Request,
    body: SessionEndRequest,
    user: dict = Depends(requires_voice_access),
):
    if not session_belongs_to_user(body.session_id, user["id"]):
        raise HTTPException(status_code=403, detail="session not owned by user")
    duration = max(0, int(body.duration_seconds or 0))
    is_admin = user.get("role") == "admin"
    estimated_cost = duration * 0.005  # MODE_C_COST_PER_SECOND
    _end_voice_session(body.session_id, duration_seconds=duration,
                       estimated_cost_usd=estimated_cost)
    if duration > 0:
        record_mode_c_seconds(user["id"], duration)
    return {"ok": True, "duration_seconds": duration}
```

- [ ] **Step 4: Run — should pass**

```
python -m pytest tests/test_voice_router.py -v 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```
git add api/routers/voice.py tests/test_voice_router.py
git commit -m "feat(voice): add /transcript and /session/end endpoints"
```

---

## Task 9: realtimeEventHandlers — pure event parser

**Files:**
- Create: `app/src/utils/realtimeEventHandlers.js`
- Create: `app/src/utils/realtimeEventHandlers.test.js`

This isolates Realtime event parsing into pure functions so the hook stays focused on connection lifecycle.

- [ ] **Step 1: Write the parser**

Create `app/src/utils/realtimeEventHandlers.js`:

```js
/**
 * Pure parsers for OpenAI Realtime data-channel events.
 *
 * Returns one of:
 *  { kind: 'session_created', session: {...} }
 *  { kind: 'user_transcript', text: string }                    // user finished speaking
 *  { kind: 'assistant_transcript_delta', delta: string }        // streaming reply text
 *  { kind: 'assistant_transcript_done', text: string }          // final reply text
 *  { kind: 'function_call', call_id, name, arguments_json }     // model wants a tool
 *  { kind: 'error', message: string }
 *  { kind: 'unknown' }
 *
 * Other events (audio chunks, tool-call deltas) are intentionally ignored —
 * audio is handled by WebRTC tracks; we only need the COMPLETED transcripts.
 */

export function parseRealtimeEvent(raw) {
  let evt
  try {
    evt = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return { kind: 'unknown' }
  }
  const t = evt?.type
  if (!t) return { kind: 'unknown' }

  switch (t) {
    case 'session.created':
      return { kind: 'session_created', session: evt.session }

    case 'conversation.item.input_audio_transcription.completed':
      return { kind: 'user_transcript', text: (evt.transcript || '').trim() }

    case 'response.audio_transcript.delta':
      return { kind: 'assistant_transcript_delta', delta: evt.delta || '' }

    case 'response.audio_transcript.done':
      return { kind: 'assistant_transcript_done', text: (evt.transcript || '').trim() }

    case 'response.function_call_arguments.done':
      return {
        kind: 'function_call',
        call_id: evt.call_id,
        name: evt.name,
        arguments_json: evt.arguments || '{}',
      }

    case 'error':
      return { kind: 'error', message: evt.error?.message || 'realtime error' }

    default:
      return { kind: 'unknown' }
  }
}


/**
 * Build the data-channel message that delivers a tool result back to the model.
 */
export function functionCallOutputEvent({ call_id, output }) {
  return {
    type: 'conversation.item.create',
    item: {
      type: 'function_call_output',
      call_id,
      output: JSON.stringify(output),
    },
  }
}


/**
 * Asks the model to continue speaking after a function output (or proactively).
 */
export function responseCreateEvent() {
  return { type: 'response.create' }
}
```

- [ ] **Step 2: Write tests**

Create `app/src/utils/realtimeEventHandlers.test.js`:

```js
import { describe, it, expect } from 'vitest'
import {
  parseRealtimeEvent,
  functionCallOutputEvent,
  responseCreateEvent,
} from './realtimeEventHandlers'

describe('parseRealtimeEvent', () => {
  it('returns unknown for invalid input', () => {
    expect(parseRealtimeEvent('not-json').kind).toBe('unknown')
    expect(parseRealtimeEvent({}).kind).toBe('unknown')
  })

  it('parses session.created', () => {
    const out = parseRealtimeEvent({ type: 'session.created', session: { id: 'sess_1' } })
    expect(out.kind).toBe('session_created')
    expect(out.session.id).toBe('sess_1')
  })

  it('parses user transcription completed', () => {
    const out = parseRealtimeEvent({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: '  what is NVDA  ',
    })
    expect(out.kind).toBe('user_transcript')
    expect(out.text).toBe('what is NVDA')
  })

  it('parses assistant transcript delta and done', () => {
    expect(parseRealtimeEvent({ type: 'response.audio_transcript.delta', delta: 'NVDA' }))
      .toEqual({ kind: 'assistant_transcript_delta', delta: 'NVDA' })
    expect(parseRealtimeEvent({ type: 'response.audio_transcript.done', transcript: 'NVDA is at 487' }))
      .toEqual({ kind: 'assistant_transcript_done', text: 'NVDA is at 487' })
  })

  it('parses function_call', () => {
    const out = parseRealtimeEvent({
      type: 'response.function_call_arguments.done',
      call_id: 'call_42',
      name: 'get_quote',
      arguments: '{"symbol":"NVDA"}',
    })
    expect(out).toEqual({
      kind: 'function_call', call_id: 'call_42', name: 'get_quote', arguments_json: '{"symbol":"NVDA"}',
    })
  })

  it('parses error', () => {
    const out = parseRealtimeEvent({ type: 'error', error: { message: 'rate limit' } })
    expect(out).toEqual({ kind: 'error', message: 'rate limit' })
  })
})

describe('functionCallOutputEvent', () => {
  it('returns conversation.item.create with stringified output', () => {
    const out = functionCallOutputEvent({ call_id: 'c1', output: { ok: true, last: 487 } })
    expect(out.type).toBe('conversation.item.create')
    expect(out.item.type).toBe('function_call_output')
    expect(out.item.call_id).toBe('c1')
    expect(JSON.parse(out.item.output).last).toBe(487)
  })
})

describe('responseCreateEvent', () => {
  it('returns response.create', () => {
    expect(responseCreateEvent()).toEqual({ type: 'response.create' })
  })
})
```

- [ ] **Step 3: Run**

```
cd C:/Users/Patrick/uct-dashboard/app
npx vitest run src/utils/realtimeEventHandlers.test.js 2>&1 | tail -10
```

Expected: 8 tests pass.

- [ ] **Step 4: Commit**

```
cd C:/Users/Patrick/uct-dashboard
git add app/src/utils/realtimeEventHandlers.js app/src/utils/realtimeEventHandlers.test.js
git commit -m "feat(voice): add Realtime event parser utilities"
```

---

## Task 10: VoiceContext — Mode C state extensions

**Files:**
- Modify: `app/src/context/VoiceContext.jsx`

- [ ] **Step 1: Extend reducer + helpers**

Open `app/src/context/VoiceContext.jsx`. The current reducer handles `idle`, `loading`, `playing`, `paused`, `error`, `setSpeed`, `b_listening`, `b_thinking`, `b_responding`. Add Mode C states.

Modify `initialState` to add:

```jsx
  // Slice 4: Realtime conversational mode (Mode C)
  realtimeSessionId: null,        // backend voice_sessions.id
  realtimeOpenaiSessionId: null,  // OpenAI session id
  rollingTranscript: [],          // last few turns: [{role, text}]
  partialAssistant: '',           // streaming assistant text being typed
```

Replace the reducer with this expanded version (incremental — keep existing cases, add new):

```jsx
function reducer(state, action) {
  switch (action.type) {
    case 'load':
      return {
        ...state, status: 'loading', mode: 'a',
        trackId: action.trackId, trackLabel: action.trackLabel,
        errorMessage: null, transcript: '', narration: '',
      }
    case 'play':
      return { ...state, status: 'playing' }
    case 'pause':
      return { ...state, status: 'paused' }
    case 'stop':
      return { ...initialState, speed: state.speed }
    case 'error':
      return { ...state, status: 'error', errorMessage: action.message }
    case 'setSpeed':
      return { ...state, speed: action.speed }

    // Mode B (Slice 2)
    case 'b_listening':
      return { ...initialState, speed: state.speed, status: 'listening', mode: 'b' }
    case 'b_thinking':
      return { ...state, status: 'thinking', mode: 'b' }
    case 'b_responding':
      return {
        ...state, status: 'responding', mode: 'b',
        transcript: action.transcript || '', narration: action.narration || '',
      }

    // Mode C (Slice 4)
    case 'c_connecting':
      return { ...initialState, speed: state.speed, status: 'connecting', mode: 'c' }
    case 'c_connected':
      return {
        ...state, status: 'connected', mode: 'c',
        realtimeSessionId: action.sessionId,
        realtimeOpenaiSessionId: action.openaiSessionId,
      }
    case 'c_user_turn':
      return {
        ...state, status: 'speaking_user', mode: 'c',
        transcript: action.text || '',
        rollingTranscript: appendTurn(state.rollingTranscript, 'user', action.text),
      }
    case 'c_assistant_partial':
      return { ...state, status: 'speaking_assistant', mode: 'c',
               partialAssistant: (state.partialAssistant || '') + (action.delta || '') }
    case 'c_assistant_done':
      return {
        ...state, mode: 'c', partialAssistant: '',
        narration: action.text || '',
        rollingTranscript: appendTurn(state.rollingTranscript, 'assistant', action.text),
      }
    case 'c_disconnect':
      return { ...initialState, speed: state.speed }
    case 'c_error':
      return { ...state, status: 'error', mode: 'c', errorMessage: action.message }

    default:
      return state
  }
}

function appendTurn(rolling, role, text) {
  if (!text) return rolling
  const next = [...rolling, { role, text }]
  return next.slice(-10)  // keep last 10 turns
}
```

Add new action helpers in the provider after `startResponding`:

```jsx
  const beginRealtime = useCallback(() => dispatch({ type: 'c_connecting' }), [])
  const realtimeConnected = useCallback(({ sessionId, openaiSessionId }) =>
    dispatch({ type: 'c_connected', sessionId, openaiSessionId }), [])
  const realtimeUserTurn = useCallback((text) =>
    dispatch({ type: 'c_user_turn', text }), [])
  const realtimeAssistantPartial = useCallback((delta) =>
    dispatch({ type: 'c_assistant_partial', delta }), [])
  const realtimeAssistantDone = useCallback((text) =>
    dispatch({ type: 'c_assistant_done', text }), [])
  const realtimeDisconnect = useCallback(() => dispatch({ type: 'c_disconnect' }), [])
  const realtimeError = useCallback((message) => dispatch({ type: 'c_error', message }), [])
```

Add them to the value memo's exposed methods + dependency array:

```jsx
  const value = useMemo(() => ({
    ...state,
    attachAudio, playUrl, pause, resume, stop, setSpeed,
    startListening, startThinking, startResponding,
    beginRealtime, realtimeConnected, realtimeUserTurn,
    realtimeAssistantPartial, realtimeAssistantDone,
    realtimeDisconnect, realtimeError,
  }), [state, attachAudio, playUrl, pause, resume, stop, setSpeed,
       startListening, startThinking, startResponding,
       beginRealtime, realtimeConnected, realtimeUserTurn,
       realtimeAssistantPartial, realtimeAssistantDone,
       realtimeDisconnect, realtimeError])
```

- [ ] **Step 2: Smoke build**

```
cd C:/Users/Patrick/uct-dashboard/app
npx vite build --mode development 2>&1 | tail -5
```

- [ ] **Step 3: Run frontend tests**

```
npx vitest run src/components/voice 2>&1 | tail -10
```

Expected: 6 existing tests still pass.

- [ ] **Step 4: Commit**

```
cd C:/Users/Patrick/uct-dashboard
git add app/src/context/VoiceContext.jsx
git commit -m "feat(voice): extend VoiceContext with Mode C realtime states"
```

---

## Task 11: AudioPlayerBar — accept WebRTC MediaStream as srcObject

**Files:**
- Modify: `app/src/components/voice/AudioPlayerBar.jsx`
- Modify: `app/src/context/VoiceContext.jsx`

The Realtime API delivers model audio via a WebRTC MediaStream (from `pc.ontrack`). Today's `playUrl` only accepts a blob URL string. Add a sibling helper for streams.

- [ ] **Step 1: Add `playStream` to VoiceContext**

In `app/src/context/VoiceContext.jsx`, inside `VoiceProvider`, add this helper after the existing `playUrl`:

```jsx
  const playStream = useCallback(async ({ stream, trackId, trackLabel }) => {
    dispatch({ type: 'load', trackId, trackLabel })
    const el = audioRef.current
    if (!el) {
      dispatch({ type: 'error', message: 'Audio element not ready' })
      return
    }
    try {
      el.srcObject = stream
      el.playbackRate = 1.0  // realtime audio shouldn't be sped up
      await el.play()
      dispatch({ type: 'play' })
    } catch (err) {
      dispatch({ type: 'error', message: err.message || 'Stream playback failed' })
    }
  }, [])
```

Add `playStream` to the value memo:

```jsx
  const value = useMemo(() => ({
    ...state,
    attachAudio, playUrl, playStream, pause, resume, stop, setSpeed,
    startListening, startThinking, startResponding,
    beginRealtime, realtimeConnected, realtimeUserTurn,
    realtimeAssistantPartial, realtimeAssistantDone,
    realtimeDisconnect, realtimeError,
  }), [state, attachAudio, playUrl, playStream, pause, resume, stop, setSpeed,
       startListening, startThinking, startResponding,
       beginRealtime, realtimeConnected, realtimeUserTurn,
       realtimeAssistantPartial, realtimeAssistantDone,
       realtimeDisconnect, realtimeError])
```

- [ ] **Step 2: Update AudioPlayerBar to clear srcObject on stop**

Open `app/src/components/voice/AudioPlayerBar.jsx`. Find the `voice.stop` handler / cleanup logic. Currently it clears `el.src`. Also clear `el.srcObject`:

In the existing `useEffect` that wires `ended`/`error` listeners, add (or modify) so that when the audio ends naturally, both `src` AND `srcObject` are cleared. Easiest: replace the `onEnded`/`onError` handlers with:

```jsx
    const onEnded = () => {
      try { if (el.srcObject) el.srcObject = null } catch {}
      voice.stop()
    }
    const onError = () => {
      try { if (el.srcObject) el.srcObject = null } catch {}
      voice.stop()
    }
```

- [ ] **Step 3: Smoke build**

```
cd C:/Users/Patrick/uct-dashboard/app
npx vite build --mode development 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```
cd C:/Users/Patrick/uct-dashboard
git add app/src/context/VoiceContext.jsx app/src/components/voice/AudioPlayerBar.jsx
git commit -m "feat(voice): support WebRTC MediaStream in AudioPlayerBar"
```

---

## Task 12: useRealtimeSession hook

**Files:**
- Create: `app/src/hooks/useRealtimeSession.js`

This is the heaviest single file in the slice. It owns the WebRTC peer-connection lifecycle, mic capture, data-channel wiring, transcript persistence, and tool-call dispatch.

- [ ] **Step 1: Create the hook**

Create `app/src/hooks/useRealtimeSession.js`:

```js
import { useCallback, useEffect, useRef } from 'react'
import { useVoice } from '../context/VoiceContext'
import {
  parseRealtimeEvent,
  functionCallOutputEvent,
  responseCreateEvent,
} from '../utils/realtimeEventHandlers'

const SILENCE_TIMEOUT_MS = 8_000
const HEARTBEAT_MS = 30_000

/**
 * Open a Realtime conversation: mic in, model audio out, function calls in,
 * tool results out. Single live session at a time per user.
 *
 * Usage:
 *   const { connect, disconnect, isConnected } = useRealtimeSession()
 *   <button onClick={() => connect('global')}>Talk</button>
 */
export default function useRealtimeSession() {
  const voice = useVoice()
  const pcRef = useRef(null)
  const dcRef = useRef(null)
  const localStreamRef = useRef(null)
  const sessionRef = useRef({ id: null, openaiId: null, startedAt: 0 })
  const silenceTimerRef = useRef(null)
  const heartbeatTimerRef = useRef(null)

  const cleanup = useCallback(async () => {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null }
    if (heartbeatTimerRef.current) { clearInterval(heartbeatTimerRef.current); heartbeatTimerRef.current = null }
    try { dcRef.current?.close?.() } catch {}
    try { pcRef.current?.close?.() } catch {}
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop())
    }
    pcRef.current = null
    dcRef.current = null
    localStreamRef.current = null
  }, [])

  const endSessionOnServer = useCallback(async () => {
    const sess = sessionRef.current
    if (!sess.id) return
    const duration = Math.max(0, Math.round((Date.now() - sess.startedAt) / 1000))
    try {
      await fetch('/api/voice/session/end', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sess.id, duration_seconds: duration }),
      })
    } catch (e) {
      console.warn('[useRealtimeSession] end-session failed', e)
    }
    sessionRef.current = { id: null, openaiId: null, startedAt: 0 }
  }, [])

  const disconnect = useCallback(async () => {
    await cleanup()
    await endSessionOnServer()
    voice.realtimeDisconnect()
  }, [cleanup, endSessionOnServer, voice])

  const resetSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    silenceTimerRef.current = setTimeout(() => {
      console.log('[useRealtimeSession] silence timeout — disconnecting')
      disconnect()
    }, SILENCE_TIMEOUT_MS)
  }, [disconnect])

  const sendTranscriptToServer = useCallback(async (role, text) => {
    const sid = sessionRef.current.id
    if (!sid || !text) return
    try {
      await fetch('/api/voice/transcript', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, role, text }),
      })
    } catch {}
  }, [])

  const handleFunctionCall = useCallback(async ({ call_id, name, arguments_json }) => {
    const sid = sessionRef.current.id
    let args = {}
    try { args = JSON.parse(arguments_json || '{}') } catch {}
    let result
    try {
      const r = await fetch('/api/voice/exec', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, tool: name, args }),
      })
      result = await r.json()
    } catch (e) {
      result = { ok: false, error: e?.message || 'fetch failed' }
    }

    const dc = dcRef.current
    if (dc?.readyState === 'open') {
      dc.send(JSON.stringify(functionCallOutputEvent({ call_id, output: result })))
      dc.send(JSON.stringify(responseCreateEvent()))
    }
  }, [])

  const onChannelMessage = useCallback((event) => {
    const parsed = parseRealtimeEvent(event.data)
    switch (parsed.kind) {
      case 'session_created':
        // Already tracked via /session_token response — no-op here
        break
      case 'user_transcript':
        voice.realtimeUserTurn(parsed.text)
        sendTranscriptToServer('user', parsed.text)
        resetSilenceTimer()
        break
      case 'assistant_transcript_delta':
        voice.realtimeAssistantPartial(parsed.delta)
        resetSilenceTimer()
        break
      case 'assistant_transcript_done':
        voice.realtimeAssistantDone(parsed.text)
        sendTranscriptToServer('assistant', parsed.text)
        resetSilenceTimer()
        break
      case 'function_call':
        handleFunctionCall(parsed).catch((e) => console.error('[function_call] failed', e))
        resetSilenceTimer()
        break
      case 'error':
        console.error('[realtime] error event', parsed.message)
        voice.realtimeError(parsed.message)
        break
      default:
        break
    }
  }, [voice, handleFunctionCall, resetSilenceTimer, sendTranscriptToServer])

  const connect = useCallback(async (context = 'global') => {
    if (pcRef.current) {
      // Already connected — toggle off
      await disconnect()
      return
    }

    voice.beginRealtime()

    // 1. Mint ephemeral token + get tool catalog from backend
    let tokenResp
    try {
      const r = await fetch('/api/voice/session_token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context }),
      })
      if (!r.ok) {
        if (r.status === 402) alert('Voice features require a paid plan.')
        else if (r.status === 429) alert('Monthly conversation cap reached.')
        else if (r.status === 503) alert('Voice service is misconfigured (server log will explain).')
        else console.error('[realtime] token fetch returned', r.status)
        voice.realtimeDisconnect()
        return
      }
      tokenResp = await r.json()
    } catch (e) {
      console.error('[realtime] token fetch failed', e)
      voice.realtimeDisconnect()
      return
    }

    sessionRef.current = {
      id: tokenResp.session_id,
      openaiId: tokenResp.openai_session_id,
      startedAt: Date.now(),
    }

    // 2. Get mic
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      alert('Microphone permission is required.')
      voice.realtimeDisconnect()
      await endSessionOnServer()
      return
    }
    localStreamRef.current = stream

    // 3. Create RTCPeerConnection
    const pc = new RTCPeerConnection()
    pcRef.current = pc

    // 4. Wire model's audio track into our existing <audio> element
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams
      voice.playStream({
        stream: remoteStream,
        trackId: `realtime-${Date.now()}`,
        trackLabel: 'Live conversation',
      })
    }

    // 5. Add mic
    stream.getTracks().forEach((track) => pc.addTrack(track, stream))

    // 6. Open data channel for events
    const dc = pc.createDataChannel('oai-events')
    dcRef.current = dc
    dc.addEventListener('open', () => {
      voice.realtimeConnected({
        sessionId: tokenResp.session_id,
        openaiSessionId: tokenResp.openai_session_id,
      })
      resetSilenceTimer()
    })
    dc.addEventListener('message', onChannelMessage)
    dc.addEventListener('close', () => {
      console.log('[realtime] data channel closed')
    })

    // 7. SDP exchange
    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      const sdpResponse = await fetch(
        `https://api.openai.com/v1/realtime?model=${encodeURIComponent(tokenResp.model)}`,
        {
          method: 'POST',
          body: offer.sdp,
          headers: {
            'Authorization': `Bearer ${tokenResp.client_secret}`,
            'Content-Type': 'application/sdp',
          },
        }
      )
      if (!sdpResponse.ok) {
        const errText = await sdpResponse.text()
        throw new Error(`SDP exchange failed: ${sdpResponse.status} ${errText}`)
      }
      const answerSdp = await sdpResponse.text()
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })
    } catch (e) {
      console.error('[realtime] SDP exchange failed', e)
      voice.realtimeError(e.message || 'connection failed')
      await cleanup()
      await endSessionOnServer()
      return
    }

    // 8. Heartbeat — accumulate seconds in case session is killed mid-flight
    heartbeatTimerRef.current = setInterval(() => {
      // No-op; the actual second-counting happens server-side on session/end.
      // Could send a "ping" data-channel event in future to detect zombie sessions.
    }, HEARTBEAT_MS)
  }, [voice, disconnect, endSessionOnServer, cleanup, onChannelMessage, resetSilenceTimer])

  // Tear down on unmount
  useEffect(() => () => { disconnect() }, [disconnect])

  return {
    connect,
    disconnect,
    isConnected: voice.mode === 'c' && voice.status !== 'idle',
  }
}
```

- [ ] **Step 2: Smoke build**

```
cd C:/Users/Patrick/uct-dashboard/app
npx vite build --mode development 2>&1 | tail -5
```

Expected: build succeeds (warnings about chunk size are fine).

- [ ] **Step 3: Commit**

```
cd C:/Users/Patrick/uct-dashboard
git add app/src/hooks/useRealtimeSession.js
git commit -m "feat(voice): add useRealtimeSession hook (WebRTC + tool dispatch)"
```

---

## Task 13: FloatingOrb — open Realtime instead of one-shot

**Files:**
- Modify: `app/src/components/voice/FloatingOrb.jsx`

- [ ] **Step 1: Swap the underlying hook**

Open `app/src/components/voice/FloatingOrb.jsx`. Currently it imports `useOneShot` and calls `start(context)` on click. Swap to `useRealtimeSession`.

Replace the file contents with:

```jsx
import { useVoice } from '../../context/VoiceContext'
import useRealtimeSession from '../../hooks/useRealtimeSession'
import styles from './FloatingOrb.module.css'

/**
 * Floating mic orb. Click → starts a Realtime conversation. Click again → ends it.
 *
 * - Idle: gold mic icon
 * - Connecting: spinning border + ellipsis
 * - Connected (idle within session): solid green ring + waveform icon
 * - User speaking: pulsing red ring
 * - Assistant speaking: glowing green ring
 */
export default function FloatingOrb({ context = 'global' }) {
  const voice = useVoice()
  const { connect, disconnect } = useRealtimeSession()

  // Hide when busy with a non-voice activity (e.g. read-aloud playing)
  if (voice.mode === 'a' && voice.status === 'playing') return null

  const status = voice.status
  let stateClass = styles.idle
  let icon = '🎤'
  let label = 'Tap to start a conversation'

  if (voice.mode === 'c') {
    if (status === 'connecting') {
      stateClass = styles.thinking
      icon = '…'
      label = 'Connecting…'
    } else if (status === 'connected') {
      stateClass = styles.responding
      icon = '◉'
      label = 'Connected — say something'
    } else if (status === 'speaking_user') {
      stateClass = styles.listening
      icon = '●'
      label = 'Listening…'
    } else if (status === 'speaking_assistant' || status === 'playing' || status === 'loading') {
      stateClass = styles.responding
      icon = '🔊'
      label = 'Speaking — tap to stop'
    } else if (status === 'error') {
      stateClass = styles.idle
      icon = '⚠'
      label = `Error: ${voice.errorMessage || 'unknown'}`
    }
  }

  const inSession = voice.mode === 'c' && status !== 'idle' && status !== 'error'
  const onClick = () => (inSession ? disconnect() : connect(context))

  return (
    <button
      type="button"
      className={`${styles.orb} ${stateClass}`}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <span className={styles.icon}>{icon}</span>
    </button>
  )
}
```

- [ ] **Step 2: Smoke build**

```
cd C:/Users/Patrick/uct-dashboard/app
npx vite build --mode development 2>&1 | tail -5
```

- [ ] **Step 3: Run existing voice tests**

```
npx vitest run src/components/voice 2>&1 | tail -10
```

If `FloatingOrb.test.jsx` from Slice 2 fails (mocked `useOneShot` no longer relevant), update the mock to mock `useRealtimeSession` instead:

```js
vi.mock('../../hooks/useRealtimeSession', () => ({
  default: () => ({ connect: vi.fn(), disconnect: vi.fn(), isConnected: false }),
}))
```

Replace the existing `vi.mock` for useOneShot with the above, then re-run.

- [ ] **Step 4: Commit**

```
cd C:/Users/Patrick/uct-dashboard
git add app/src/components/voice/FloatingOrb.jsx app/src/components/voice/FloatingOrb.test.jsx
git commit -m "feat(voice): orb opens Realtime conversation instead of one-shot"
```

---

## Task 14: TranscriptBubble — show rolling Mode C conversation

**Files:**
- Modify: `app/src/components/voice/TranscriptBubble.jsx`

- [ ] **Step 1: Render rolling history when mode is c**

Replace the file contents with:

```jsx
import { useEffect, useState } from 'react'
import { useVoice } from '../../context/VoiceContext'
import styles from './TranscriptBubble.module.css'

/**
 * Ephemeral transcript popover above the FloatingOrb.
 *
 * Mode B: shows {You: ..., UCT: ...} for the current one-shot exchange.
 * Mode C: shows the last 2-3 turns of the live conversation (user + assistant).
 */
export default function TranscriptBubble() {
  const voice = useVoice()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!voice.mode) {
      setVisible(false)
      return
    }
    const active = voice.status !== 'idle' && voice.status !== 'error'
    if (active) {
      setVisible(true)
      return
    }
    const t = setTimeout(() => setVisible(false), 2000)
    return () => clearTimeout(t)
  }, [voice.mode, voice.status])

  if (!visible) return null
  if (!voice.mode) return null

  const showThinking =
    (voice.mode === 'b' && voice.status === 'thinking' && !voice.transcript) ||
    (voice.mode === 'c' && voice.status === 'connecting')
  const showListening =
    (voice.mode === 'b' && voice.status === 'listening') ||
    (voice.mode === 'c' && voice.status === 'speaking_user')

  if (voice.mode === 'b') {
    return (
      <div className={styles.bubble} role="status" aria-live="polite">
        {showListening && <div className={styles.listening}>Listening…</div>}
        {showThinking && <div className={styles.thinking}>Thinking…</div>}
        {voice.transcript && (
          <div className={styles.you}>
            <span className={styles.tag}>You:</span> {voice.transcript}
          </div>
        )}
        {voice.narration && (
          <div className={styles.assistant}>
            <span className={styles.tag}>UCT:</span> {voice.narration}
          </div>
        )}
      </div>
    )
  }

  // Mode C — rolling conversation
  const recent = voice.rollingTranscript?.slice(-3) || []
  return (
    <div className={styles.bubble} role="status" aria-live="polite">
      {showListening && !recent.length && <div className={styles.listening}>Listening…</div>}
      {showThinking && <div className={styles.thinking}>Connecting…</div>}
      {recent.map((turn, i) => (
        <div key={i} className={turn.role === 'user' ? styles.you : styles.assistant}>
          <span className={styles.tag}>{turn.role === 'user' ? 'You:' : 'UCT:'}</span> {turn.text}
        </div>
      ))}
      {voice.partialAssistant && voice.status === 'speaking_assistant' && (
        <div className={styles.assistant}>
          <span className={styles.tag}>UCT:</span> {voice.partialAssistant}<span className={styles.cursor}>▍</span>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add the cursor style**

In `app/src/components/voice/TranscriptBubble.module.css`, append:

```css
.cursor {
  display: inline-block;
  margin-left: 2px;
  color: #c9a84c;
  animation: blink 1s steps(2, start) infinite;
}
@keyframes blink {
  to { visibility: hidden; }
}
```

- [ ] **Step 3: Smoke build**

```
cd C:/Users/Patrick/uct-dashboard/app
npx vite build --mode development 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```
cd C:/Users/Patrick/uct-dashboard
git add app/src/components/voice/TranscriptBubble.jsx app/src/components/voice/TranscriptBubble.module.css
git commit -m "feat(voice): show rolling Mode C transcript with streaming cursor"
```

---

## Task 15: Hotkey routes to Realtime instead of one-shot

**Files:**
- Modify: `app/src/hooks/usePushToTalkHotkey.js`

- [ ] **Step 1: Swap to Realtime**

Replace contents of `app/src/hooks/usePushToTalkHotkey.js`:

```js
import { useEffect } from 'react'
import useRealtimeSession from './useRealtimeSession'

/**
 * Cmd/Ctrl+Shift+V global hotkey: starts (or ends) a Realtime conversation.
 */
export default function usePushToTalkHotkey({ context = 'global' } = {}) {
  const { connect, disconnect, isConnected } = useRealtimeSession()

  useEffect(() => {
    const onKeyDown = (e) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC')
      const modifier = isMac ? e.metaKey : e.ctrlKey
      if (modifier && e.shiftKey && e.code === 'KeyV') {
        e.preventDefault()
        if (isConnected) disconnect(); else connect(context)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [connect, disconnect, isConnected, context])
}
```

- [ ] **Step 2: Smoke build**

```
cd C:/Users/Patrick/uct-dashboard/app
npx vite build --mode development 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```
cd C:/Users/Patrick/uct-dashboard
git add app/src/hooks/usePushToTalkHotkey.js
git commit -m "feat(voice): hotkey toggles Realtime session instead of one-shot"
```

---

## Task 16: Manual e2e + final tests

**Files:** none (manual + verification)

- [ ] **Step 1: Run all backend voice tests**

```
cd C:/Users/Patrick/uct-dashboard
python -m pytest tests/test_voice_*.py -v 2>&1 | tail -10
```

Expected: all green.

- [ ] **Step 2: Run all frontend voice tests**

```
cd app
npx vitest run src/components/voice src/utils/realtimeEventHandlers.test.js 2>&1 | tail -10
```

Expected: all green.

- [ ] **Step 3: Push to Railway**

```
cd C:/Users/Patrick/uct-dashboard
git push origin master
```

- [ ] **Step 4: Manual conversation test**

Once Railway redeploys (~2 min):
1. Hard-refresh uctintelligence.com
2. Click the gold mic orb in the bottom-right
3. Grant mic permission if prompted
4. Wait ~1s for "Connected" state
5. Say: *"What's NVDA at?"*
6. Should hear a natural-sounding spoken answer in <2s with the actual quote
7. Say a follow-up: *"And TSLA?"* — model should remember the context and give just the quote
8. Try: *"Compare NVDA, AAPL, and MSFT"*
9. Click the orb again to end the conversation
10. Wait 8 seconds of silence — auto-disconnect should trigger

**Acceptance:**
- Sub-second response latency (after the first connection setup ~1-2s)
- Multi-turn context preserved
- Tool calls work and produce real data
- Interrupting the assistant mid-sentence works (just start talking)

- [ ] **Step 5: Tag the slice**

```
git tag voice-slice-4-shipped
git push origin master --tags
```

---

## Plan Self-Review

**Spec coverage check:**
- §2 Mode C architecture (browser ↔ OpenAI WebRTC) — Tasks 5, 6, 12
- §4.3 Mode C data flow — Tasks 6, 7, 8, 12
- §6 Backend additions: session_token, exec, transcript, session/end — Tasks 6, 7, 8
- §6 voice_sessions + voice_transcripts tables — Task 1
- §6 voice_dispatch two-phase executor — partially Task 4 (slice 4 uses single-phase reads only; two-phase comes in Slice 5 for writes)
- §7 Cost optimization: per-tier minute cap, server-side cap re-check — Tasks 3, 6
- §8 Security: ephemeral 60s tokens (Task 5/6), session ownership check (Tasks 7, 8), rate limits (Tasks 6, 7, 8)
- §9 Testing: unit (Tasks 1-9), browser (Tasks 9 partial), manual e2e (Task 16)

**Placeholder scan:** none. Every step has runnable commands or full code.

**Type consistency:**
- `session_id` (int) is consistent across backend service + endpoints + frontend hook posts
- `mode_c_seconds` consistent in usage helpers + service + endpoints
- `realtimeUserTurn(text)`, `realtimeAssistantPartial(delta)`, `realtimeAssistantDone(text)` action helpers match dispatcher cases
- `parseRealtimeEvent` return shapes match the consumer's `switch` cases in `useRealtimeSession.js` exactly
- Hot-key + orb both consume the same `useRealtimeSession` hook with consistent `connect/disconnect/isConnected` shape
- `MODE_C_DEFAULT_CAP_SECONDS` (6000 = 100 min) consistent in service, router, and cap-check call sites

**Open notes for future slices:**
- Slice 5 (write tools) extends `voice_dispatch.run_tool` with a `phase: 'preview' | 'confirm'` flag and an `action_id` HMAC. The `voice_tools` registry already has a `wants_user` flag that can be paired with a future `requires_confirm` flag.
- Slice 3 (wake word) plugs into `useRealtimeSession.connect()` exactly the same way the orb does — Porcupine's wake event becomes another caller.
- Voice History page (Settings) is a future polish — backend already persists transcripts; UI is straightforward.
