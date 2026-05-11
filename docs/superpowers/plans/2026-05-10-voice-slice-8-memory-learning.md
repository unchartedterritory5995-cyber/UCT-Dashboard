# Voice Assistant — Slice 8: Memory & Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** The assistant remembers conversations and learns user-specific facts. Users can teach it explicitly ("remember that my Swing account is the primary one") and the assistant naturally calls `remember()` when it hears teachable preferences. Across sessions, the assistant has continuity — it knows what you discussed yesterday, what you trade, how you talk about your accounts.

**Architecture:** Two new SQLite tables (`user_voice_facts`, `voice_session_summaries`). Memory injection happens at Realtime session-token mint time — all user facts + the 5 most recent session summaries get folded into the model's `instructions`. At session end, a background task uses `gpt-4o-mini` to summarize the conversation and persists the summary. Four new voice tools (`remember`, `forget`, `list_my_facts`, `recall_session`) let the model interact with memory natively during conversation.

**Tech Stack:** OpenAI gpt-4o-mini (summary generation) · existing voice tool registry · existing voice_session_service · FastAPI · React Context already in place

**Builds on:** Slices 1, 2, 4 (voice_sessions/voice_transcripts tables already exist, voice_tools registry already exists, voice_dispatch already wraps tool calls)

**Spec:** Augments the original `2026-05-08-voice-assistant-design.md` — memory was implicit in "Voice History" but not as a learning layer. This makes it explicit.

**Out of scope (future):**
- Vector embeddings / semantic recall (use plain text + LIKE search for now — fine at 100s of summaries per user)
- Broad cross-user learning / federated patterns (Slice 9, separate effort)
- Auto-extraction of facts from transcripts via LLM (only explicit `remember()` calls for v1)
- Forgetting curve / decay (facts persist until user removes)

---

## File Structure

### Backend

| File | Responsibility |
|------|----------------|
| `api/services/auth_db.py` | Add `user_voice_facts` + `voice_session_summaries` tables |
| `api/services/voice_memory_service.py` | NEW. Fact CRUD + summary CRUD + memory-string builder |
| `api/services/voice_summarizer.py` | NEW. gpt-4o-mini call to summarize a session's transcripts |
| `api/services/voice_tool_impls.py` | Extend with 4 memory tools (`remember`, `forget`, `list_my_facts`, `recall_session`) |
| `api/routers/voice.py` | Extend `/session_token` to inject memory into instructions; modify `/session/end` to trigger background summarization; add `/memory/*` endpoints for the Settings UI |

### Frontend

| File | Responsibility |
|------|----------------|
| `app/src/hooks/useVoiceMemory.js` | NEW. SWR-style hook for facts CRUD |
| `app/src/components/voice/VoiceMemoryPanel.jsx` + `.module.css` | NEW. Settings panel — list of facts, add/edit/delete |
| `app/src/pages/Settings.jsx` | Mount `<VoiceMemoryPanel>` |

### Tests

| File | Coverage |
|------|----------|
| `tests/test_voice_memory_service.py` | Fact CRUD, summary CRUD, memory-string composition |
| `tests/test_voice_summarizer.py` | Mocked gpt-4o-mini summary generation |
| `tests/test_voice_memory_router.py` | `/memory/facts` GET/POST/DELETE, auth gate |
| Existing `tests/test_voice_tools.py` | Extend with 4 new tools |

---

## Plan-Wide Conventions

- **Fact storage shape:** `{id, user_id, category, text, created_at, updated_at}`. Categories: `preference`, `account_alias`, `style`, `fact`, `general`. The classifier picks a category; user can re-categorize.
- **Summary storage shape:** `{id, session_id, user_id, summary_text, key_topics_json, created_at}`. `key_topics` is a JSON array of strings like `["NVDA", "earnings", "small-caps"]` for search.
- **Memory injection budget:** ≤2000 chars total (facts + summaries) so we don't blow the Realtime context. Facts get full text. Summaries get bullet-style truncation.
- **Summary generation:** runs as a FastAPI BackgroundTask after `/session/end`. Non-blocking. If it fails, the session ends successfully without a summary.
- **Privacy default:** all memories are per-user. No cross-user sharing in v1.
- **Commit cadence:** one commit per task. `feat(voice):` / `fix(voice):` / `test(voice):`.

---

## Task 1: Add user_voice_facts + voice_session_summaries tables

**Files:**
- Modify: `api/services/auth_db.py`
- Test: `tests/test_voice_db_schema.py`

- [ ] **Step 1: Append failing tests to `tests/test_voice_db_schema.py`**

```python


def test_user_voice_facts_table_exists():
    init_db()
    conn = get_connection()
    try:
        cols = conn.execute("PRAGMA table_info(user_voice_facts)").fetchall()
        col_names = {c["name"] for c in cols}
        assert {"id", "user_id", "category", "text", "created_at", "updated_at"}.issubset(col_names)
    finally:
        conn.close()


def test_voice_session_summaries_table_exists():
    init_db()
    conn = get_connection()
    try:
        cols = conn.execute("PRAGMA table_info(voice_session_summaries)").fetchall()
        col_names = {c["name"] for c in cols}
        assert {"id", "session_id", "user_id", "summary_text",
                "key_topics_json", "created_at"}.issubset(col_names)
    finally:
        conn.close()
```

- [ ] **Step 2: Run — should fail**

```
cd C:/Users/Patrick/uct-dashboard
python -m pytest tests/test_voice_db_schema.py -v
```

- [ ] **Step 3: Append to `_SCHEMA` in `api/services/auth_db.py`**

```sql
CREATE TABLE IF NOT EXISTS user_voice_facts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL REFERENCES users(id),
    category    TEXT NOT NULL DEFAULT 'general',
    text        TEXT NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_voice_facts_user ON user_voice_facts(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS voice_session_summaries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      INTEGER NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id),
    summary_text    TEXT NOT NULL,
    key_topics_json TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_voice_summaries_user ON voice_session_summaries(user_id, created_at DESC);
```

- [ ] **Step 4: Run — should pass**

```
python -m pytest tests/test_voice_db_schema.py -v
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```
git add api/services/auth_db.py tests/test_voice_db_schema.py
git commit -m "feat(voice): add user_voice_facts + voice_session_summaries tables"
```

---

## Task 2: voice_memory_service — fact CRUD + summary CRUD

**Files:**
- Create: `api/services/voice_memory_service.py`
- Create: `tests/test_voice_memory_service.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_voice_memory_service.py`:

```python
"""Voice memory service — user facts + session summaries."""

import json
from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services.voice_session_service import create_session
from api.services.voice_memory_service import (
    add_fact, list_facts, update_fact, delete_fact,
    add_summary, list_summaries, search_summaries,
    build_memory_context,
    MAX_MEMORY_CHARS,
)


def _user():
    init_db()
    return create_user(f"vm_{__import__('uuid').uuid4()}@example.com", "p")["id"]


def test_add_and_list_facts():
    uid = _user()
    f1 = add_fact(uid, text="I trade small caps under $5B", category="style")
    f2 = add_fact(uid, text="My Swing account is the primary one", category="account_alias")
    facts = list_facts(uid)
    ids = {f["id"] for f in facts}
    assert f1 in ids and f2 in ids
    assert any("small caps" in f["text"] for f in facts)


def test_update_fact():
    uid = _user()
    fid = add_fact(uid, text="I trade small caps", category="style")
    update_fact(fid, text="I trade small caps under $5B", category="style")
    facts = list_facts(uid)
    target = next(f for f in facts if f["id"] == fid)
    assert "under $5B" in target["text"]


def test_delete_fact():
    uid = _user()
    fid = add_fact(uid, text="some fact", category="general")
    delete_fact(fid, user_id=uid)
    facts = list_facts(uid)
    assert all(f["id"] != fid for f in facts)


def test_delete_fact_only_for_owner():
    uid = _user()
    other = _user()
    fid = add_fact(uid, text="my fact", category="general")
    delete_fact(fid, user_id=other)  # should NOT delete
    facts = list_facts(uid)
    assert any(f["id"] == fid for f in facts)


def test_add_and_search_summaries():
    uid = _user()
    sid = create_session(user_id=uid, mode="c", source="orb", page_context="global")
    add_summary(
        session_id=sid, user_id=uid,
        summary_text="Discussed NVDA earnings and TSLA short setup",
        key_topics=["NVDA", "TSLA", "earnings", "short"],
    )
    matches = search_summaries(uid, query="NVDA")
    assert matches and "NVDA" in matches[0]["summary_text"]


def test_build_memory_context_caps_size():
    uid = _user()
    for i in range(100):
        add_fact(uid, text=f"fact number {i} with some content " * 5, category="general")
    sid = create_session(user_id=uid, mode="c", source="orb", page_context="global")
    for i in range(20):
        add_summary(session_id=sid, user_id=uid,
                    summary_text=f"summary {i} " * 30, key_topics=[])

    ctx = build_memory_context(uid)
    assert len(ctx) <= MAX_MEMORY_CHARS
    assert isinstance(ctx, str)


def test_build_memory_context_empty_for_new_user():
    uid = _user()
    ctx = build_memory_context(uid)
    assert ctx == ""
```

- [ ] **Step 2: Run — should fail (ImportError)**

```
python -m pytest tests/test_voice_memory_service.py -v
```

- [ ] **Step 3: Implement the service**

Create `api/services/voice_memory_service.py`:

```python
"""
Voice memory service — user facts + session summaries.

Facts: explicit user-stated preferences/aliases that persist across
sessions. Created via `remember` voice tool or Settings UI.

Summaries: auto-generated post-session recaps. Created via background
task after /api/voice/session/end.

build_memory_context() composes both into a single text block injected
into the Realtime session's `instructions` at session-token mint time.
"""

import json
from datetime import datetime, timezone
from api.services.auth_db import get_connection


MAX_MEMORY_CHARS = 2000  # cap on injected context size
MAX_FACTS_INJECTED = 30
MAX_SUMMARIES_INJECTED = 5

ALLOWED_CATEGORIES = {"preference", "account_alias", "style", "fact", "general"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Facts ─────────────────────────────────────────────────────────────────

def add_fact(user_id: str, *, text: str, category: str = "general") -> int:
    text = (text or "").strip()
    if not text:
        raise ValueError("text is required")
    if category not in ALLOWED_CATEGORIES:
        category = "general"
    text = text[:1000]
    conn = get_connection()
    try:
        cur = conn.execute(
            """INSERT INTO user_voice_facts (user_id, category, text, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?)""",
            (user_id, category, text, _now(), _now()),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def list_facts(user_id: str, *, limit: int = 100) -> list[dict]:
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT id, user_id, category, text, created_at, updated_at
               FROM user_voice_facts
               WHERE user_id = ?
               ORDER BY updated_at DESC
               LIMIT ?""",
            (user_id, max(1, min(limit, 500))),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def update_fact(fact_id: int, *, text: str | None = None,
                category: str | None = None) -> None:
    if text is None and category is None:
        return
    if text is not None:
        text = text.strip()[:1000]
    if category is not None and category not in ALLOWED_CATEGORIES:
        category = "general"
    sets, vals = [], []
    if text is not None:
        sets.append("text = ?")
        vals.append(text)
    if category is not None:
        sets.append("category = ?")
        vals.append(category)
    sets.append("updated_at = ?")
    vals.append(_now())
    vals.append(fact_id)
    conn = get_connection()
    try:
        conn.execute(
            f"UPDATE user_voice_facts SET {', '.join(sets)} WHERE id = ?",
            vals,
        )
        conn.commit()
    finally:
        conn.close()


def delete_fact(fact_id: int, *, user_id: str) -> None:
    """Owner-only deletion. No-op if fact_id doesn't belong to user_id."""
    conn = get_connection()
    try:
        conn.execute(
            "DELETE FROM user_voice_facts WHERE id = ? AND user_id = ?",
            (fact_id, user_id),
        )
        conn.commit()
    finally:
        conn.close()


def delete_facts_matching(user_id: str, query: str) -> int:
    """Delete facts where text LIKE %query%. Returns count removed."""
    q = (query or "").strip()
    if not q:
        return 0
    conn = get_connection()
    try:
        cur = conn.execute(
            "DELETE FROM user_voice_facts WHERE user_id = ? AND LOWER(text) LIKE LOWER(?)",
            (user_id, f"%{q}%"),
        )
        conn.commit()
        return cur.rowcount or 0
    finally:
        conn.close()


# ── Summaries ─────────────────────────────────────────────────────────────

def add_summary(*, session_id: int, user_id: str, summary_text: str,
                key_topics: list[str] | None = None) -> int:
    summary_text = (summary_text or "").strip()[:2000]
    if not summary_text:
        raise ValueError("summary_text is required")
    topics_json = json.dumps([t for t in (key_topics or []) if t][:20])
    conn = get_connection()
    try:
        cur = conn.execute(
            """INSERT INTO voice_session_summaries
               (session_id, user_id, summary_text, key_topics_json, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (session_id, user_id, summary_text, topics_json, _now()),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def list_summaries(user_id: str, *, limit: int = 20) -> list[dict]:
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT id, session_id, user_id, summary_text, key_topics_json, created_at
               FROM voice_session_summaries
               WHERE user_id = ?
               ORDER BY created_at DESC
               LIMIT ?""",
            (user_id, max(1, min(limit, 100))),
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            try:
                d["key_topics"] = json.loads(d.pop("key_topics_json") or "[]")
            except json.JSONDecodeError:
                d["key_topics"] = []
            out.append(d)
        return out
    finally:
        conn.close()


def search_summaries(user_id: str, *, query: str, limit: int = 10) -> list[dict]:
    """Plain LIKE search over summary_text + key_topics_json."""
    q = (query or "").strip()
    if not q:
        return []
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT id, session_id, user_id, summary_text, key_topics_json, created_at
               FROM voice_session_summaries
               WHERE user_id = ?
                 AND (LOWER(summary_text) LIKE LOWER(?)
                      OR LOWER(key_topics_json) LIKE LOWER(?))
               ORDER BY created_at DESC
               LIMIT ?""",
            (user_id, f"%{q}%", f"%{q}%", max(1, min(limit, 50))),
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            try:
                d["key_topics"] = json.loads(d.pop("key_topics_json") or "[]")
            except json.JSONDecodeError:
                d["key_topics"] = []
            out.append(d)
        return out
    finally:
        conn.close()


# ── Memory composition ────────────────────────────────────────────────────

def build_memory_context(user_id: str) -> str:
    """
    Build a single text block to inject into Realtime session instructions.
    Combines user facts + the latest N session summaries. Capped at MAX_MEMORY_CHARS.
    """
    facts = list_facts(user_id, limit=MAX_FACTS_INJECTED)
    summaries = list_summaries(user_id, limit=MAX_SUMMARIES_INJECTED)

    if not facts and not summaries:
        return ""

    parts: list[str] = []
    if facts:
        parts.append("What you know about this user:")
        for f in facts:
            cat = f.get("category") or "general"
            txt = f.get("text") or ""
            parts.append(f"  - [{cat}] {txt}")

    if summaries:
        if parts:
            parts.append("")
        parts.append("Recent conversations with this user:")
        for s in summaries:
            topics = s.get("key_topics") or []
            topic_str = f" (topics: {', '.join(topics[:5])})" if topics else ""
            txt = s.get("summary_text") or ""
            parts.append(f"  - {txt}{topic_str}")

    out = "\n".join(parts)
    if len(out) > MAX_MEMORY_CHARS:
        out = out[:MAX_MEMORY_CHARS].rsplit("\n", 1)[0]
    return out
```

- [ ] **Step 4: Run — should pass**

```
python -m pytest tests/test_voice_memory_service.py -v
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```
git add api/services/voice_memory_service.py tests/test_voice_memory_service.py
git commit -m "feat(voice): add memory service (facts + summaries + injection)"
```

---

## Task 3: voice_summarizer — gpt-4o-mini conversation summarization

**Files:**
- Create: `api/services/voice_summarizer.py`
- Create: `tests/test_voice_summarizer.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_voice_summarizer.py`:

```python
"""Voice summarizer — gpt-4o-mini summarization of a session's transcripts."""

import json
from unittest.mock import MagicMock, patch
from api.services import voice_summarizer


def test_summarize_returns_text_and_topics():
    fake_msg = MagicMock()
    fake_msg.content = json.dumps({
        "summary": "Discussed NVDA earnings and TSLA short setup.",
        "key_topics": ["NVDA", "TSLA", "earnings"],
    })
    fake_choice = MagicMock(message=fake_msg)
    fake_completion = MagicMock(choices=[fake_choice])

    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = fake_completion

    transcripts = [
        {"role": "user", "text": "What's NVDA at?"},
        {"role": "assistant", "text": "NVDA is at 487."},
        {"role": "user", "text": "And TSLA?"},
        {"role": "assistant", "text": "TSLA at 230, weak setup short."},
    ]

    with patch.object(voice_summarizer, "_get_client", return_value=fake_client):
        out = voice_summarizer.summarize_transcripts(transcripts)

    assert "NVDA" in out["summary"]
    assert "NVDA" in out["key_topics"]
    assert "TSLA" in out["key_topics"]


def test_summarize_returns_empty_for_no_transcripts():
    out = voice_summarizer.summarize_transcripts([])
    assert out["summary"] == ""
    assert out["key_topics"] == []


def test_summarize_handles_malformed_json():
    fake_msg = MagicMock()
    fake_msg.content = "not-valid-json"
    fake_choice = MagicMock(message=fake_msg)
    fake_completion = MagicMock(choices=[fake_choice])

    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = fake_completion

    with patch.object(voice_summarizer, "_get_client", return_value=fake_client):
        out = voice_summarizer.summarize_transcripts([
            {"role": "user", "text": "hi"},
            {"role": "assistant", "text": "hello"},
        ])

    # Falls back to raw text as the summary
    assert isinstance(out["summary"], str)
    assert out["key_topics"] == []
```

- [ ] **Step 2: Run — should fail**

```
python -m pytest tests/test_voice_summarizer.py -v
```

- [ ] **Step 3: Implement**

Create `api/services/voice_summarizer.py`:

```python
"""
Summarize a voice session's transcripts into a short recap + key topics.
Used as a background task after /api/voice/session/end.
"""

import json
import logging
from api.services.voice_openai import _get_client

_log = logging.getLogger(__name__)

_SUMMARY_MODEL = "gpt-4o-mini"

_SYSTEM_PROMPT = """You write short, useful summaries of voice conversations
between a trader and their AI assistant. The summary will be re-injected into
the assistant's context for future conversations, so write it as background
context that helps the assistant pick up where it left off.

Respond with a single JSON object:
{
  "summary": "2-3 sentence recap including: what the user asked about, key
              tickers/themes mentioned, any preferences expressed, and any
              decisions made.",
  "key_topics": ["NVDA", "earnings", ...]   // up to 8 short tags
}

The summary should be useful, not generic. Skip greetings and filler.
"""


def summarize_transcripts(transcripts: list[dict]) -> dict:
    """
    Transcripts: list of {role, text}. Returns {summary, key_topics}.
    """
    if not transcripts:
        return {"summary": "", "key_topics": []}

    # Filter empty + flatten to a compact dialog string
    lines = []
    for t in transcripts:
        role = t.get("role") or "user"
        text = (t.get("text") or "").strip()
        if not text:
            continue
        prefix = "USER" if role == "user" else "ASSISTANT" if role == "assistant" else "TOOL"
        lines.append(f"{prefix}: {text}")
    if not lines:
        return {"summary": "", "key_topics": []}

    dialog = "\n".join(lines)[:6000]

    try:
        client = _get_client()
        completion = client.chat.completions.create(
            model=_SUMMARY_MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": f"Conversation:\n{dialog}\n\nRespond with JSON."},
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
        )
        raw = completion.choices[0].message.content
    except Exception as e:  # noqa: BLE001
        _log.warning("summarize_transcripts: OpenAI call failed: %s", e)
        return {"summary": "", "key_topics": []}

    try:
        data = json.loads(raw)
        return {
            "summary": (data.get("summary") or "").strip()[:2000],
            "key_topics": [t for t in (data.get("key_topics") or []) if isinstance(t, str)][:8],
        }
    except json.JSONDecodeError:
        # Fall back to using the raw response as the summary
        return {"summary": (raw or "").strip()[:2000], "key_topics": []}
```

- [ ] **Step 4: Run**

```
python -m pytest tests/test_voice_summarizer.py -v
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```
git add api/services/voice_summarizer.py tests/test_voice_summarizer.py
git commit -m "feat(voice): add gpt-4o-mini conversation summarizer"
```

---

## Task 4: Add 4 memory voice tools

**Files:**
- Modify: `api/services/voice_tool_impls.py`
- Modify: `tests/test_voice_tools.py`

- [ ] **Step 1: Append failing tests**

Append to `tests/test_voice_tools.py`:

```python


# ── Memory tools (Slice 8) ──────────────────────────────────────────────────

def test_memory_tools_register():
    from api.services import voice_tool_impls  # noqa
    names = set(voice_tools.all_tool_names())
    expected = {"remember", "forget", "list_my_facts", "recall_session"}
    assert expected.issubset(names)


def test_remember_tool_persists_fact():
    from api.services.auth_db import init_db
    from api.services.auth_service import create_user
    init_db()
    uid = create_user(f"r_{__import__('uuid').uuid4()}@example.com", "p")["id"]

    out = voice_tools.dispatch(
        "remember",
        {"fact": "I trade small caps under $5B", "category": "style"},
        user={"id": uid},
    )
    assert out["ok"] is True

    from api.services.voice_memory_service import list_facts
    facts = list_facts(uid)
    assert any("small caps" in f["text"] for f in facts)


def test_forget_tool_removes_matching():
    from api.services.auth_db import init_db
    from api.services.auth_service import create_user
    from api.services.voice_memory_service import add_fact, list_facts
    init_db()
    uid = create_user(f"f_{__import__('uuid').uuid4()}@example.com", "p")["id"]
    add_fact(uid, text="I trade options on weekends", category="style")
    add_fact(uid, text="My main account is Swing", category="account_alias")

    out = voice_tools.dispatch("forget", {"query": "options"}, user={"id": uid})
    assert out["removed"] >= 1

    facts = list_facts(uid)
    assert not any("options" in f["text"] for f in facts)


def test_list_my_facts_tool():
    from api.services.auth_db import init_db
    from api.services.auth_service import create_user
    from api.services.voice_memory_service import add_fact
    init_db()
    uid = create_user(f"l_{__import__('uuid').uuid4()}@example.com", "p")["id"]
    add_fact(uid, text="I prefer dollar amounts over percentages", category="preference")

    out = voice_tools.dispatch("list_my_facts", {}, user={"id": uid})
    assert "dollar amounts" in out["facts_text"]
    assert out["count"] >= 1


def test_recall_session_tool():
    from api.services.auth_db import init_db
    from api.services.auth_service import create_user
    from api.services.voice_session_service import create_session
    from api.services.voice_memory_service import add_summary
    init_db()
    uid = create_user(f"rs_{__import__('uuid').uuid4()}@example.com", "p")["id"]
    sid = create_session(user_id=uid, mode="c", source="orb", page_context="global")
    add_summary(session_id=sid, user_id=uid,
                summary_text="Discussed NVDA earnings setup",
                key_topics=["NVDA", "earnings"])

    out = voice_tools.dispatch("recall_session", {"query": "NVDA"}, user={"id": uid})
    assert "NVDA" in out["recall_text"]
    assert out["count"] >= 1
```

- [ ] **Step 2: Run — should fail**

```
python -m pytest tests/test_voice_tools.py -v
```

- [ ] **Step 3: Add the 4 tools**

In `api/services/voice_tool_impls.py`, near the existing tool implementations, add:

```python


# ── Memory tools (Slice 8) ──────────────────────────────────────────────────


def _remember(*, user, fact: str, category: str = "general") -> dict:
    from api.services.voice_memory_service import add_fact
    fact = (fact or "").strip()
    if not fact:
        return {"ok": False, "error": "fact text is required"}
    try:
        fid = add_fact(user["id"], text=fact, category=category or "general")
        return {"ok": True, "fact_id": fid, "text": fact}
    except ValueError as e:
        return {"ok": False, "error": str(e)}


def _forget(*, user, query: str) -> dict:
    from api.services.voice_memory_service import delete_facts_matching
    q = (query or "").strip()
    if not q:
        return {"ok": False, "removed": 0, "error": "query is required"}
    removed = delete_facts_matching(user["id"], q)
    return {"ok": True, "removed": removed}


def _list_my_facts(*, user) -> dict:
    from api.services.voice_memory_service import list_facts
    facts = list_facts(user["id"], limit=50)
    if not facts:
        return {"facts_text": "I don't have any saved facts about you yet.", "count": 0}
    lines = [f"[{f.get('category')}] {f.get('text')}" for f in facts]
    return {"facts_text": "; ".join(lines)[:1500], "count": len(facts)}


def _recall_session(*, user, query: str) -> dict:
    from api.services.voice_memory_service import search_summaries
    q = (query or "").strip()
    if not q:
        return {"recall_text": "I need a topic or keyword to search past conversations.", "count": 0}
    rows = search_summaries(user["id"], query=q, limit=5)
    if not rows:
        return {"recall_text": f"I don't have any past conversations matching '{q}'.", "count": 0}
    lines = [f"{r.get('summary_text')}" for r in rows]
    return {"recall_text": "; ".join(lines)[:1500], "count": len(rows)}
```

Then extend `_register_all()` with the four registrations:

```python
    _vt.voice_tool(
        name="remember",
        description="Save a fact about the user (preference, account alias, trading style, etc.) for future conversations. Call this when the user explicitly says 'remember that...' or states a clear preference you should keep.",
        parameters={
            "fact": {"type": "string", "description": "The fact to remember, in the user's words."},
            "category": {"type": "string", "enum": ["preference", "account_alias", "style", "fact", "general"]},
        },
        contexts=["global"],
        wants_user=True,
    )(_remember)

    _vt.voice_tool(
        name="forget",
        description="Remove saved facts matching a topic or keyword. Call this when the user says 'forget...' or asks you to stop remembering something.",
        parameters={"query": {"type": "string", "description": "Topic or keyword to match."}},
        contexts=["global"],
        wants_user=True,
    )(_forget)

    _vt.voice_tool(
        name="list_my_facts",
        description="Read back everything you currently remember about the user.",
        parameters={},
        contexts=["global"],
        wants_user=True,
    )(_list_my_facts)

    _vt.voice_tool(
        name="recall_session",
        description="Search past conversation summaries for a topic. Call this when the user asks 'what did we discuss about X?' or 'remind me what I said about Y'.",
        parameters={"query": {"type": "string"}},
        contexts=["global"],
        wants_user=True,
    )(_recall_session)
```

- [ ] **Step 4: Run — should pass**

```
python -m pytest tests/test_voice_tools.py -v
```

Expected: all tests pass including 5 new memory tool tests.

- [ ] **Step 5: Commit**

```
git add api/services/voice_tool_impls.py tests/test_voice_tools.py
git commit -m "feat(voice): add remember/forget/list_my_facts/recall_session voice tools"
```

---

## Task 5: Inject memory into Realtime session instructions

**Files:**
- Modify: `api/routers/voice.py`
- Modify: `tests/test_voice_router.py`

- [ ] **Step 1: Append failing test**

Append to `tests/test_voice_router.py`:

```python


def test_session_token_injects_user_memory(client):
    _login(client, plan="pro")
    from api.services.auth_db import get_connection
    from api.services.voice_memory_service import add_fact
    conn = get_connection()
    try:
        row = conn.execute("SELECT id FROM users ORDER BY created_at DESC LIMIT 1").fetchone()
        uid = row["id"]
    finally:
        conn.close()
    add_fact(uid, text="I trade small caps under $5B", category="style")

    captured_instructions = {}

    def fake_mint(*, voice, tools, instructions, model=None):
        captured_instructions["text"] = instructions
        return {"session_id": "sess_x", "client_secret": "ek_x",
                "expires_at": 0, "model": "gpt-realtime"}

    with patch("api.routers.voice.mint_realtime_session", side_effect=fake_mint):
        r = client.post("/api/voice/session_token", json={"context": "global"})
    assert r.status_code == 200
    assert "small caps" in captured_instructions["text"]
```

- [ ] **Step 2: Run — should fail**

```
python -m pytest tests/test_voice_router.py::test_session_token_injects_user_memory -v
```

- [ ] **Step 3: Modify `/session_token` endpoint**

Open `api/routers/voice.py`. Find the `session_token` handler. Add this import at the top with other voice imports:

```python
from api.services.voice_memory_service import build_memory_context
```

Then in the `session_token` function, BEFORE the `mint = mint_realtime_session(...)` call, build the memory-augmented instructions:

```python
    memory_context = build_memory_context(user["id"])
    session_instructions = _REALTIME_INSTRUCTIONS
    if memory_context:
        session_instructions = (
            _REALTIME_INSTRUCTIONS
            + "\n\n=== USER CONTEXT ===\n"
            + memory_context
            + "\n=== END USER CONTEXT ==="
        )
```

Then change the `mint_realtime_session(...)` call to use `session_instructions` instead of `_REALTIME_INSTRUCTIONS`:

```python
    try:
        mint = mint_realtime_session(
            voice=settings["voice"],
            tools=tools_schema,
            instructions=session_instructions,
        )
```

- [ ] **Step 4: Run — should pass**

```
python -m pytest tests/test_voice_router.py -v 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```
git add api/routers/voice.py tests/test_voice_router.py
git commit -m "feat(voice): inject user memory into Realtime session instructions"
```

---

## Task 6: Auto-summarize at session end (background task)

**Files:**
- Modify: `api/routers/voice.py`

- [ ] **Step 1: Inspect current `/session/end` handler**

Open `api/routers/voice.py`. Find `session_end_post`. Currently it ends the session, records cost, and increments mode_c_seconds. We add a background task that summarizes the transcripts and persists the summary.

- [ ] **Step 2: Add imports**

At the top, alongside the other voice imports:

```python
from api.services.voice_summarizer import summarize_transcripts
from api.services.voice_memory_service import add_summary
from api.services.voice_session_service import get_transcripts as _get_session_transcripts
from fastapi import BackgroundTasks
```

(If `BackgroundTasks` is already imported in another spot, leave it; the rest are new.)

- [ ] **Step 3: Modify `session_end_post`**

Replace the existing handler body with this expanded version. Note the new `background_tasks: BackgroundTasks` parameter and the deferred summarization:

```python
@router.post("/session/end")
@limiter.limit("60/minute")
def session_end_post(
    request: Request,
    body: SessionEndRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(requires_voice_access),
):
    if not session_belongs_to_user(body.session_id, user["id"]):
        raise HTTPException(status_code=403, detail="session not owned by user")
    duration = max(0, int(body.duration_seconds or 0))
    estimated_cost = duration * 0.005
    _end_voice_session(body.session_id, duration_seconds=duration,
                       estimated_cost_usd=estimated_cost)
    if duration > 0:
        record_mode_c_seconds(user["id"], duration)

    # Schedule summary generation in the background (non-blocking)
    background_tasks.add_task(_summarize_session_background, body.session_id, user["id"])

    return {"ok": True, "duration_seconds": duration}


def _summarize_session_background(session_id: int, user_id: str) -> None:
    """Runs after /session/end returns. Best-effort; failures are logged but swallowed."""
    try:
        transcripts = _get_session_transcripts(session_id) or []
        # Only summarize if at least one user + one assistant turn
        roles = {t.get("role") for t in transcripts}
        if "user" not in roles or "assistant" not in roles:
            return
        result = summarize_transcripts(transcripts)
        summary = result.get("summary") or ""
        if not summary.strip():
            return
        add_summary(
            session_id=session_id, user_id=user_id,
            summary_text=summary,
            key_topics=result.get("key_topics") or [],
        )
    except Exception as e:  # noqa: BLE001
        _log.warning("session summarization failed for %s: %s", session_id, e)
```

- [ ] **Step 4: Smoke test that existing tests still pass**

```
cd C:/Users/Patrick/uct-dashboard
python -m pytest tests/test_voice_router.py -v 2>&1 | tail -10
```

Expected: all tests still pass. The summarization task won't actually run in TestClient because `BackgroundTasks` runs after the response, and tests don't wait — that's fine, summarization is best-effort.

- [ ] **Step 5: Commit**

```
git add api/routers/voice.py
git commit -m "feat(voice): auto-summarize sessions on /session/end via background task"
```

---

## Task 7: /api/voice/memory endpoints for Settings UI

**Files:**
- Modify: `api/routers/voice.py`
- Modify: `tests/test_voice_router.py`

- [ ] **Step 1: Append failing tests**

Append to `tests/test_voice_router.py`:

```python


# ── Memory endpoints ───────────────────────────────────────────────────────

def test_memory_facts_get_empty(client):
    _login(client, plan="pro")
    r = client.get("/api/voice/memory/facts")
    assert r.status_code == 200
    assert r.json() == {"facts": []}


def test_memory_facts_post_and_list(client):
    _login(client, plan="pro")
    r = client.post("/api/voice/memory/facts",
                    json={"text": "I trade small caps", "category": "style"})
    assert r.status_code == 200
    fid = r.json()["id"]
    r2 = client.get("/api/voice/memory/facts")
    body = r2.json()
    assert any(f["id"] == fid for f in body["facts"])


def test_memory_fact_delete(client):
    _login(client, plan="pro")
    r = client.post("/api/voice/memory/facts",
                    json={"text": "some fact", "category": "general"})
    fid = r.json()["id"]
    r2 = client.delete(f"/api/voice/memory/facts/{fid}")
    assert r2.status_code == 200
    r3 = client.get("/api/voice/memory/facts")
    assert all(f["id"] != fid for f in r3.json()["facts"])


def test_memory_summaries_get_empty(client):
    _login(client, plan="pro")
    r = client.get("/api/voice/memory/summaries")
    assert r.status_code == 200
    assert r.json() == {"summaries": []}
```

- [ ] **Step 2: Run — should fail**

```
python -m pytest tests/test_voice_router.py -v 2>&1 | tail -10
```

- [ ] **Step 3: Add endpoints**

Add imports at the top of `api/routers/voice.py` (alongside existing voice_memory imports):

```python
from api.services.voice_memory_service import (
    add_fact as _mem_add_fact,
    list_facts as _mem_list_facts,
    delete_fact as _mem_delete_fact,
    list_summaries as _mem_list_summaries,
    ALLOWED_CATEGORIES as _MEM_CATEGORIES,
)
```

Append at the end of `api/routers/voice.py`:

```python


class FactCreate(BaseModel):
    text: str
    category: str = "general"


@router.get("/memory/facts")
def memory_facts_get(user: dict = Depends(requires_voice_access)):
    return {"facts": _mem_list_facts(user["id"])}


@router.post("/memory/facts")
@limiter.limit("30/minute")
def memory_facts_post(
    request: Request,
    body: FactCreate,
    user: dict = Depends(requires_voice_access),
):
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    category = body.category if body.category in _MEM_CATEGORIES else "general"
    try:
        fid = _mem_add_fact(user["id"], text=text, category=category)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"id": fid, "text": text, "category": category}


@router.delete("/memory/facts/{fact_id}")
def memory_fact_delete(
    fact_id: int,
    user: dict = Depends(requires_voice_access),
):
    _mem_delete_fact(fact_id, user_id=user["id"])
    return {"ok": True}


@router.get("/memory/summaries")
def memory_summaries_get(user: dict = Depends(requires_voice_access)):
    return {"summaries": _mem_list_summaries(user["id"], limit=20)}
```

- [ ] **Step 4: Run — should pass**

```
python -m pytest tests/test_voice_router.py -v 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```
git add api/routers/voice.py tests/test_voice_router.py
git commit -m "feat(voice): add /memory/facts + /memory/summaries endpoints"
```

---

## Task 8: Update system instructions to teach the model about memory tools

**Files:**
- Modify: `api/routers/voice.py`

- [ ] **Step 1: Replace `_REALTIME_INSTRUCTIONS`**

Open `api/routers/voice.py`. Find the `_REALTIME_INSTRUCTIONS` constant. Replace with:

```python
_REALTIME_INSTRUCTIONS = (
    "You are UCT Intelligence, a voice trading assistant inside a stock-market "
    "dashboard. You can see the user's available tools and call them to look up "
    "real-time data. Be concise and natural. Round numbers reasonably. Never "
    "invent prices or data — if a tool fails, say so and offer to try a different "
    "approach. Avoid disclaimers; the user is an experienced trader. Speak like "
    "a sharp colleague, not a chatbot.\n\n"
    "MEMORY: You have tools to remember things across sessions. When the user "
    "tells you a preference, account alias, trading style, or any clear fact "
    "about themselves, call the `remember` tool to save it for future "
    "conversations. When they say 'forget X' or 'stop remembering Y', call "
    "`forget`. When they ask 'what did we discuss about X?' or 'remind me about "
    "Y from last time', call `recall_session`. You can also call `list_my_facts` "
    "to read back everything you currently know about them. Don't pre-announce — "
    "just call the tool and confirm naturally."
)
```

- [ ] **Step 2: Verify existing tests still pass**

```
python -m pytest tests/test_voice_router.py -v 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```
git add api/routers/voice.py
git commit -m "feat(voice): teach the model about memory tools in system prompt"
```

---

## Task 9: useVoiceMemory hook

**Files:**
- Create: `app/src/hooks/useVoiceMemory.js`

- [ ] **Step 1: Create the hook**

Create `app/src/hooks/useVoiceMemory.js`:

```js
import { useCallback, useEffect, useState } from 'react'

/**
 * Voice memory hook — CRUD for user facts + listing of past summaries.
 *
 * Used by the Voice Memory Settings panel.
 */
export default function useVoiceMemory() {
  const [facts, setFacts] = useState([])
  const [summaries, setSummaries] = useState([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setErrorMsg('')
    try {
      const [factsR, sumR] = await Promise.all([
        fetch('/api/voice/memory/facts', { credentials: 'include' }),
        fetch('/api/voice/memory/summaries', { credentials: 'include' }),
      ])
      if (factsR.ok) setFacts((await factsR.json()).facts || [])
      if (sumR.ok) setSummaries((await sumR.json()).summaries || [])
      if (!factsR.ok && factsR.status === 402) {
        setErrorMsg('Voice features require a paid plan.')
      }
    } catch (e) {
      setErrorMsg(e?.message || 'Failed to load voice memory')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  const addFact = useCallback(async (text, category = 'general') => {
    const r = await fetch('/api/voice/memory/facts', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, category }),
    })
    if (r.ok) await reload()
    return r.ok
  }, [reload])

  const deleteFact = useCallback(async (factId) => {
    const r = await fetch(`/api/voice/memory/facts/${factId}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (r.ok) await reload()
    return r.ok
  }, [reload])

  return { facts, summaries, loading, errorMsg, reload, addFact, deleteFact }
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
git add app/src/hooks/useVoiceMemory.js
git commit -m "feat(voice): add useVoiceMemory hook"
```

---

## Task 10: VoiceMemoryPanel component

**Files:**
- Create: `app/src/components/voice/VoiceMemoryPanel.jsx`
- Create: `app/src/components/voice/VoiceMemoryPanel.module.css`

- [ ] **Step 1: Create the component**

Create `app/src/components/voice/VoiceMemoryPanel.jsx`:

```jsx
import { useState } from 'react'
import useVoiceMemory from '../../hooks/useVoiceMemory'
import styles from './VoiceMemoryPanel.module.css'

const CATEGORIES = [
  { value: 'preference', label: 'Preference' },
  { value: 'account_alias', label: 'Account alias' },
  { value: 'style', label: 'Trading style' },
  { value: 'fact', label: 'Fact' },
  { value: 'general', label: 'General' },
]

export default function VoiceMemoryPanel() {
  const { facts, summaries, loading, errorMsg, addFact, deleteFact } = useVoiceMemory()
  const [newText, setNewText] = useState('')
  const [newCategory, setNewCategory] = useState('general')

  const onAdd = async (e) => {
    e.preventDefault()
    const text = newText.trim()
    if (!text) return
    const ok = await addFact(text, newCategory)
    if (ok) {
      setNewText('')
      setNewCategory('general')
    }
  }

  return (
    <div className={styles.panel}>
      <h3 className={styles.title}>What UCT remembers about you</h3>
      <p className={styles.subtitle}>
        Facts you teach the assistant get injected into every future conversation.
        It can also save these itself when you say "remember that…".
      </p>

      {errorMsg && <div className={styles.error}>{errorMsg}</div>}

      <form className={styles.addRow} onSubmit={onAdd}>
        <input
          type="text"
          className={styles.input}
          placeholder="e.g. I trade small caps under $5B market cap"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
        />
        <select
          className={styles.select}
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
        >
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <button type="submit" className={styles.addBtn} disabled={!newText.trim()}>
          Add
        </button>
      </form>

      <div className={styles.factsList}>
        {loading && <div className={styles.empty}>Loading…</div>}
        {!loading && facts.length === 0 && (
          <div className={styles.empty}>
            No saved facts yet. Try saying "remember that I trade small caps" in a voice session.
          </div>
        )}
        {facts.map((f) => (
          <div key={f.id} className={styles.factRow}>
            <span className={styles.factCategory}>{f.category}</span>
            <span className={styles.factText}>{f.text}</span>
            <button
              type="button"
              className={styles.deleteBtn}
              onClick={() => deleteFact(f.id)}
              aria-label="Delete fact"
              title="Delete"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <h4 className={styles.subhead}>Recent conversation summaries</h4>
      <div className={styles.summariesList}>
        {summaries.length === 0 && (
          <div className={styles.empty}>No summaries yet. Have a conversation with UCT and one will appear here.</div>
        )}
        {summaries.slice(0, 10).map((s) => (
          <div key={s.id} className={styles.summaryRow}>
            <div className={styles.summaryText}>{s.summary_text}</div>
            {Array.isArray(s.key_topics) && s.key_topics.length > 0 && (
              <div className={styles.summaryTopics}>
                {s.key_topics.map((t, i) => <span key={i} className={styles.topic}>{t}</span>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add styles**

Create `app/src/components/voice/VoiceMemoryPanel.module.css`:

```css
.panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 0;
}
.title { color: #c9a84c; font-size: 15px; font-weight: 600; margin: 0; }
.subtitle { font-size: 12px; opacity: 0.75; margin: 0 0 6px 0; }
.subhead { color: #c9a84c; font-size: 13px; font-weight: 600; margin: 18px 0 6px 0; opacity: 0.85; }
.error { color: #f87171; font-size: 12px; }

.addRow { display: flex; gap: 8px; align-items: stretch; }
.input {
  flex: 1; background: rgba(255,255,255,0.05); border: 1px solid rgba(201, 168, 76, 0.25);
  color: #e8e6df; border-radius: 6px; padding: 6px 10px; font-size: 13px;
}
.input:focus { outline: none; border-color: rgba(201, 168, 76, 0.6); }
.select {
  background: rgba(255,255,255,0.05); color: #e8e6df;
  border: 1px solid rgba(255,255,255,0.12); border-radius: 6px; padding: 6px;
}
.addBtn {
  background: rgba(201, 168, 76, 0.18); color: #c9a84c;
  border: 1px solid rgba(201, 168, 76, 0.4); border-radius: 6px;
  padding: 6px 14px; cursor: pointer; font-weight: 600;
}
.addBtn:disabled { opacity: 0.4; cursor: not-allowed; }

.factsList { display: flex; flex-direction: column; gap: 4px; }
.factRow {
  display: flex; align-items: center; gap: 8px;
  background: rgba(255,255,255,0.03); border-radius: 6px;
  padding: 6px 10px;
}
.factCategory {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
  color: #c9a84c; background: rgba(201, 168, 76, 0.12);
  border-radius: 4px; padding: 2px 6px; min-width: 80px; text-align: center;
}
.factText { flex: 1; font-size: 13px; }
.deleteBtn {
  background: transparent; border: none; color: #f87171; cursor: pointer;
  font-size: 16px; padding: 2px 6px; opacity: 0.6;
}
.deleteBtn:hover { opacity: 1; }

.empty { font-size: 12px; opacity: 0.6; padding: 8px 0; }

.summariesList { display: flex; flex-direction: column; gap: 6px; }
.summaryRow { background: rgba(255,255,255,0.03); border-radius: 6px; padding: 8px 12px; }
.summaryText { font-size: 12px; line-height: 1.5; }
.summaryTopics { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.topic {
  font-size: 10px; background: rgba(201, 168, 76, 0.1); color: #c9a84c;
  padding: 1px 6px; border-radius: 4px;
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
git add app/src/components/voice/VoiceMemoryPanel.jsx app/src/components/voice/VoiceMemoryPanel.module.css
git commit -m "feat(voice): add VoiceMemoryPanel UI for Settings"
```

---

## Task 11: Mount VoiceMemoryPanel in Settings page

**Files:**
- Modify: `app/src/pages/Settings.jsx`

- [ ] **Step 1: Add import**

Open `app/src/pages/Settings.jsx`. Near other voice/component imports, add:

```jsx
import VoiceMemoryPanel from '../components/voice/VoiceMemoryPanel'
```

- [ ] **Step 2: Render inside the existing Voice TileCard**

Find the existing `<VoicePanel />` component inside Settings.jsx. After or below it, mount a new TileCard with the memory panel. The simplest placement is a new TileCard right after the Voice panel:

```jsx
        <TileCard title="Voice Memory">
          <VoiceMemoryPanel />
        </TileCard>
```

Place this directly after the existing `<VoicePanel />` line in the Settings render tree.

- [ ] **Step 3: Smoke build**

```
cd C:/Users/Patrick/uct-dashboard/app
npx vite build --mode development 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```
cd C:/Users/Patrick/uct-dashboard
git add app/src/pages/Settings.jsx
git commit -m "feat(voice): mount VoiceMemoryPanel in Settings"
```

---

## Task 12: Manual e2e

**Files:** none

- [ ] **Step 1: Run all backend voice tests**

```
cd C:/Users/Patrick/uct-dashboard
python -m pytest tests/test_voice_*.py -v 2>&1 | tail -10
```

Expected: all green.

- [ ] **Step 2: Run frontend tests**

```
cd app
npx vitest run src/components/voice src/utils/realtimeEventHandlers.test.js 2>&1 | tail -10
```

Expected: all green.

- [ ] **Step 3: Push**

```
cd C:/Users/Patrick/uct-dashboard
git push origin master
```

- [ ] **Step 4: Manual conversation test**

Once Railway redeploys:

1. Open `/settings` → confirm new "Voice Memory" panel renders. List should be empty.
2. Click orb to start a Realtime conversation.
3. Say: *"Remember that I trade primarily small caps under $5B market cap."*
4. The assistant should confirm naturally ("Got it, I'll remember that.") and call the `remember` tool.
5. End the session.
6. Refresh `/settings` → the new fact should appear under "Voice Memory" with category `style` (or similar).
7. Start a NEW conversation. Say: *"What do you know about my trading style?"*
8. The assistant should reference the small-caps fact directly — meaning the memory injection is working.
9. Say: *"Forget the small caps thing."*
10. Verify the fact is removed from the Settings panel.
11. Have another conversation about a specific topic (e.g., a few NVDA questions). End it.
12. Wait ~30 seconds. Refresh `/settings` → a session summary should appear listing NVDA as a key topic.
13. Start a new session. Say: *"What did we discuss about NVDA last time?"*
14. The assistant should call `recall_session` and reference the summary.

- [ ] **Step 5: Tag the slice**

```
git tag voice-slice-8-shipped
git push origin master --tags
```

---

## Plan Self-Review

**Spec coverage check:**
- User memory across sessions → Tasks 1, 2, 5 (injection at session start)
- Auto-session summarization → Tasks 3, 6
- Teaching tools usable by the model → Task 4 + 8
- User-managed memory UI → Tasks 7, 9, 10, 11

**Type consistency:**
- `user_id` is always `str` (matches users.id TEXT primary key from auth_db)
- `fact_id` is always `int` (autoincrement)
- `session_id` is always `int` (autoincrement, matches voice_sessions.id)
- `category` is always one of `ALLOWED_CATEGORIES`
- All memory tools use `wants_user=True` and receive `user` keyword

**Placeholder scan:** none.

**Open notes:**
- Slice 9 (broad cross-user learning) would observe fact patterns across all users and feed back into the system prompt. Privacy-sensitive, needs explicit user opt-in. Deferred indefinitely.
- Vector embeddings for semantic recall: not needed for v1 (text LIKE is fine at <1000 summaries per user). Add if user complains about recall accuracy.
- Memory eviction: not implemented. Summaries grow unbounded. Add a retention setting later if it becomes a problem.
