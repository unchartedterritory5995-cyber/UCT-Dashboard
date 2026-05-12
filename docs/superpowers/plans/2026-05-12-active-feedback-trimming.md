# Active Feedback Trimming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the feedback loop. When trader clicks 👎 on any Compass recap, surface a "Compass wants to refine its understanding" prompt and let Compass propose a Trader Profile edit through chat.

**Architecture:** New `j2_profile_suggestions` table tracks pending suggestions. Each `set_feedback('unhelpful', ...)` call on Weekly/EOD/TradeReview auto-creates a suggestion. New `list_pending_profile_suggestions` read tool + `update_trader_profile` action tool + `resolve_profile_suggestion` action tool. Compass tab gets a "Compass wants to refine" banner when suggestions are pending.

**Tech Stack:** Python 3.12, FastAPI, SQLite, React + Vite + SWR.

---

## File Map

| Path | Action |
|---|---|
| `api/services/journal_two/db.py` | New `j2_profile_suggestions` table |
| `api/services/journal_two/profile_suggestions.py` | Service module |
| `api/services/journal_two/test_profile_suggestions.py` | Tests |
| `api/services/journal_two/coach.py` | `set_feedback` auto-creates suggestion on 'unhelpful' |
| `api/services/journal_two/trade_review.py` | `set_feedback` auto-creates suggestion on 'unhelpful' |
| `api/services/journal_two/coach_chat_tools.py` | 3 new tools |
| `api/routers/journal_two.py` | 2 new endpoints (list, resolve) |
| `app/src/pages/journal-2-0/hooks/useProfileSuggestions.js` | Hook |
| `app/src/pages/journal-2-0/tabs/CompassTab.jsx` | Banner above chat |

---

## Task 1: DB + service + auto-create wiring

**Files:**
- Modify `api/services/journal_two/db.py`
- Create `api/services/journal_two/profile_suggestions.py` + test

- [ ] **Step 1: Append table to `_J2_SCHEMA`**

```sql

CREATE TABLE IF NOT EXISTS j2_profile_suggestions (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    account_id    TEXT NOT NULL,
    source_type   TEXT NOT NULL CHECK(source_type IN ('weekly_review','eod_recap','trade_review','chat')),
    source_id     TEXT NOT NULL,
    suggestion    TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','dismissed')),
    created_at    TEXT NOT NULL,
    resolved_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_j2_profile_suggestions_pending
    ON j2_profile_suggestions(user_id, account_id, status, created_at);
```

- [ ] **Step 2: Write failing tests**

`api/services/journal_two/test_profile_suggestions.py`:

```python
"""Tests for profile suggestion service + auto-create hooks."""
from __future__ import annotations
import importlib, json, os, sqlite3, tempfile, uuid
from datetime import datetime, timezone
import pytest


@pytest.fixture
def db_conn(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()
    os.unlink(tmp.name)


def _seed_account(db_conn, user_id="u_p"):
    from api.services.journal_two import accounts as accounts_service
    return accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)


def test_create_suggestion_inserts_row(db_conn):
    from api.services.journal_two import profile_suggestions as ps
    acc = _seed_account(db_conn)
    sid = ps.create_suggestion(
        user_id="u_p", account_id=acc["id"],
        source_type="eod_recap", source_id="recap-123",
        suggestion="Trader said the FOMO observation was wrong — refine that section.",
        conn=db_conn,
    )
    row = db_conn.execute(
        "SELECT source_type, suggestion, status FROM j2_profile_suggestions WHERE id = ?", (sid,)
    ).fetchone()
    assert row["source_type"] == "eod_recap"
    assert "FOMO" in row["suggestion"]
    assert row["status"] == "pending"


def test_list_pending_returns_only_pending(db_conn):
    from api.services.journal_two import profile_suggestions as ps
    acc = _seed_account(db_conn)
    s1 = ps.create_suggestion(user_id="u_p", account_id=acc["id"],
                               source_type="eod_recap", source_id="r1",
                               suggestion="one", conn=db_conn)
    s2 = ps.create_suggestion(user_id="u_p", account_id=acc["id"],
                               source_type="eod_recap", source_id="r2",
                               suggestion="two", conn=db_conn)
    ps.resolve_suggestion(s1, user_id="u_p", conn=db_conn)
    out = ps.list_pending(user_id="u_p", account_id=acc["id"], conn=db_conn)
    ids = [s["id"] for s in out["suggestions"]]
    assert s2 in ids
    assert s1 not in ids


def test_resolve_marks_resolved_with_timestamp(db_conn):
    from api.services.journal_two import profile_suggestions as ps
    acc = _seed_account(db_conn)
    sid = ps.create_suggestion(user_id="u_p", account_id=acc["id"],
                                source_type="weekly_review", source_id="w1",
                                suggestion="trim X", conn=db_conn)
    n = ps.resolve_suggestion(sid, user_id="u_p", conn=db_conn)
    assert n == 1
    row = db_conn.execute(
        "SELECT status, resolved_at FROM j2_profile_suggestions WHERE id = ?", (sid,)
    ).fetchone()
    assert row["status"] == "resolved"
    assert row["resolved_at"] is not None


def test_dismiss_marks_dismissed(db_conn):
    from api.services.journal_two import profile_suggestions as ps
    acc = _seed_account(db_conn)
    sid = ps.create_suggestion(user_id="u_p", account_id=acc["id"],
                                source_type="trade_review", source_id="t1",
                                suggestion="trim Y", conn=db_conn)
    ps.dismiss_suggestion(sid, user_id="u_p", conn=db_conn)
    row = db_conn.execute(
        "SELECT status FROM j2_profile_suggestions WHERE id = ?", (sid,)
    ).fetchone()
    assert row["status"] == "dismissed"


def test_weekly_review_unhelpful_feedback_creates_suggestion(db_conn):
    """When set_feedback runs with 'unhelpful' on a weekly review, a suggestion is auto-created."""
    from api.services.journal_two import coach
    acc = _seed_account(db_conn)
    # Seed a weekly review row
    rid = str(uuid.uuid4())
    db_conn.execute(
        """INSERT INTO j2_coach_outputs
           (id, user_id, account_id, output_type, body, summary, metadata, forgotten, created_at)
           VALUES (?, 'u_p', ?, 'weekly_review', 'body', 'summary', '{}', 0, ?)""",
        (rid, acc["id"], datetime.now(timezone.utc).isoformat()),
    )
    db_conn.commit()
    coach.set_feedback(rid, feedback="unhelpful", user_id="u_p", conn=db_conn)
    n = db_conn.execute(
        """SELECT COUNT(*) AS n FROM j2_profile_suggestions
           WHERE source_id = ? AND source_type = 'weekly_review'""",
        (rid,),
    ).fetchone()["n"]
    assert n == 1


def test_weekly_review_helpful_feedback_does_not_create_suggestion(db_conn):
    from api.services.journal_two import coach
    acc = _seed_account(db_conn)
    rid = str(uuid.uuid4())
    db_conn.execute(
        """INSERT INTO j2_coach_outputs
           (id, user_id, account_id, output_type, body, summary, metadata, forgotten, created_at)
           VALUES (?, 'u_p', ?, 'weekly_review', 'body', 'summary', '{}', 0, ?)""",
        (rid, acc["id"], datetime.now(timezone.utc).isoformat()),
    )
    db_conn.commit()
    coach.set_feedback(rid, feedback="helpful", user_id="u_p", conn=db_conn)
    n = db_conn.execute(
        """SELECT COUNT(*) AS n FROM j2_profile_suggestions WHERE source_id = ?""",
        (rid,),
    ).fetchone()["n"]
    assert n == 0


def test_trade_review_unhelpful_feedback_creates_suggestion(db_conn):
    """When trade_review.set_feedback runs with 'unhelpful', a suggestion is auto-created."""
    from api.services.journal_two import trade_review as tr
    acc = _seed_account(db_conn)
    # Seed a trade + review
    trade_id = str(uuid.uuid4())
    db_conn.execute(
        """INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares,
           entry_price, entry_date, exit_price, exit_date, original_stop, setup,
           notes, pnl_dollar, pnl_percent, r_multiple, hold_days, result,
           context_at_entry, created_at, account_id, mistake_tags, emotion_tags, fees)
           VALUES (?, 'u_p', ?, 'NVDA', 'Long', 100, 200, '2026-05-11T18:00:00+00:00',
           205, '2026-05-11T20:00:00+00:00', 198, 'Bull Flag', NULL,
           500, 2.5, 2.0, 0, 'Win', '{}', '2026-05-11T20:00:00+00:00', ?, '[]', '[]', 0)""",
        (trade_id, str(uuid.uuid4()), acc["id"]),
    )
    rid = str(uuid.uuid4())
    db_conn.execute(
        """INSERT INTO j2_trade_reviews
           (id, user_id, account_id, trade_id, body, summary, metadata, feedback, forgotten, created_at)
           VALUES (?, 'u_p', ?, ?, 'body', 'summary', '{}', NULL, 0, ?)""",
        (rid, acc["id"], trade_id, datetime.now(timezone.utc).isoformat()),
    )
    db_conn.commit()
    tr.set_feedback(rid, feedback="unhelpful", user_id="u_p", conn=db_conn)
    n = db_conn.execute(
        """SELECT COUNT(*) AS n FROM j2_profile_suggestions
           WHERE source_id = ? AND source_type = 'trade_review'""",
        (rid,),
    ).fetchone()["n"]
    assert n == 1
```

- [ ] **Step 3: Implement `profile_suggestions.py`**

```python
"""Profile suggestions — actionable feedback turned into pending refinements."""
from __future__ import annotations
import json
import os
import uuid
from datetime import datetime, timezone


def _get_conn(conn=None):
    if conn is not None:
        return conn, False
    import sqlite3 as _sq
    path = os.environ.get("AUTH_DB_PATH") or "/data/auth.db"
    c = _sq.connect(path)
    c.row_factory = _sq.Row
    return c, True


def create_suggestion(
    *, user_id: str, account_id: str,
    source_type: str, source_id: str,
    suggestion: str,
    conn=None,
) -> str:
    """Insert a pending suggestion. Returns its id."""
    _conn, _close = _get_conn(conn)
    try:
        sid = str(uuid.uuid4())
        now_iso = datetime.now(timezone.utc).isoformat()
        _conn.execute(
            """INSERT INTO j2_profile_suggestions
               (id, user_id, account_id, source_type, source_id,
                suggestion, status, created_at, resolved_at)
               VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NULL)""",
            (sid, user_id, account_id, source_type, source_id,
             suggestion, now_iso),
        )
        _conn.commit()
        return sid
    finally:
        if _close:
            _conn.close()


def list_pending(*, user_id: str, account_id: str, conn=None) -> dict:
    _conn, _close = _get_conn(conn)
    try:
        rows = _conn.execute(
            """SELECT id, source_type, source_id, suggestion, status, created_at
               FROM j2_profile_suggestions
               WHERE user_id = ? AND account_id = ? AND status = 'pending'
               ORDER BY created_at DESC""",
            (user_id, account_id),
        ).fetchall()
        return {"suggestions": [dict(r) for r in rows]}
    finally:
        if _close:
            _conn.close()


def resolve_suggestion(suggestion_id: str, *, user_id: str, conn=None) -> int:
    _conn, _close = _get_conn(conn)
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        cur = _conn.execute(
            """UPDATE j2_profile_suggestions
               SET status = 'resolved', resolved_at = ?
               WHERE id = ? AND user_id = ?""",
            (now_iso, suggestion_id, user_id),
        )
        _conn.commit()
        return cur.rowcount
    finally:
        if _close:
            _conn.close()


def dismiss_suggestion(suggestion_id: str, *, user_id: str, conn=None) -> int:
    _conn, _close = _get_conn(conn)
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        cur = _conn.execute(
            """UPDATE j2_profile_suggestions
               SET status = 'dismissed', resolved_at = ?
               WHERE id = ? AND user_id = ?""",
            (now_iso, suggestion_id, user_id),
        )
        _conn.commit()
        return cur.rowcount
    finally:
        if _close:
            _conn.close()


def auto_create_from_unhelpful_feedback(
    *, user_id: str, account_id: str,
    source_type: str, source_id: str,
    source_body: str,
    conn=None,
) -> str | None:
    """Called by set_feedback when feedback='unhelpful'. Crafts a generic
    suggestion message; Compass will later expand on it in chat.

    Returns the suggestion id, or None if not created (e.g., dup)."""
    excerpt = (source_body or "")[:200].replace("\n", " ")
    suggestion = (
        f"Trader marked this {source_type} as unhelpful. Excerpt: \"{excerpt}…\" "
        f"In chat, ask the trader what specifically was off and propose a profile refinement."
    )
    return create_suggestion(
        user_id=user_id, account_id=account_id,
        source_type=source_type, source_id=source_id,
        suggestion=suggestion, conn=conn,
    )
```

- [ ] **Step 4: Wire into `coach.set_feedback`**

In `api/services/journal_two/coach.py`, find the existing `set_feedback` function. After the existing UPDATE, add:

```python
        # Active feedback trimming: 'unhelpful' creates a profile suggestion
        if feedback == "unhelpful" and cur.rowcount > 0:
            try:
                # Look up the row's account_id and body for context
                row = _conn.execute(
                    "SELECT account_id, body, output_type FROM j2_coach_outputs WHERE id = ?",
                    (review_id,),
                ).fetchone()
                if row and user_id and row["account_id"]:
                    from api.services.journal_two import profile_suggestions as ps
                    ps.auto_create_from_unhelpful_feedback(
                        user_id=user_id, account_id=row["account_id"],
                        source_type=row["output_type"] or "weekly_review",
                        source_id=review_id,
                        source_body=row["body"] or "",
                        conn=_conn,
                    )
            except Exception:
                pass  # Best-effort — feedback succeeded
```

Critical: This block needs to slot into `set_feedback` AFTER `cur = _conn.execute(...)` and AFTER `_conn.commit()` so the feedback persists even if suggestion creation fails. Verify the existing structure of `set_feedback` and adapt the snippet placement accordingly. Keep `user_id` as the kwarg name expected.

- [ ] **Step 5: Wire into `trade_review.set_feedback`**

Similar wiring in `api/services/journal_two/trade_review.py`'s `set_feedback`:

```python
        # Active feedback trimming
        if feedback == "unhelpful" and cur.rowcount > 0:
            try:
                row = _conn.execute(
                    "SELECT account_id, body FROM j2_trade_reviews WHERE id = ?",
                    (review_id,),
                ).fetchone()
                if row and row["account_id"]:
                    from api.services.journal_two import profile_suggestions as ps
                    ps.auto_create_from_unhelpful_feedback(
                        user_id=user_id, account_id=row["account_id"],
                        source_type="trade_review", source_id=review_id,
                        source_body=row["body"] or "",
                        conn=_conn,
                    )
            except Exception:
                pass
```

- [ ] **Step 6: Run all tests + commit**

```bash
cd C:/Users/Patrick/uct-dashboard
python -m pytest api/services/journal_two/test_profile_suggestions.py -q
python -m pytest api/services/journal_two/ -q
git -C C:/Users/Patrick/uct-dashboard add api/services/journal_two/db.py api/services/journal_two/profile_suggestions.py api/services/journal_two/test_profile_suggestions.py api/services/journal_two/coach.py api/services/journal_two/trade_review.py
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-aft): profile suggestions service + auto-create on unhelpful feedback"
```

Expected: 7 new tests pass; suite ≥ 477.

---

## Task 2: Chat tools + endpoints

**Files:** `coach_chat_tools.py` + test, `api/routers/journal_two.py`.

- [ ] **Step 1: Add 3 chat tools**

In `coach_chat_tools.py`:

```python
def _exec_list_pending_profile_suggestions(*, user_id, account_id, args, conn=None) -> dict:
    from api.services.journal_two import profile_suggestions as ps
    return ps.list_pending(user_id=user_id, account_id=account_id, conn=conn)


def _update_trader_profile_preview(*, user_id, account_id, args, conn=None) -> dict:
    new_profile = (args.get("trader_profile") or "")[:8000]
    return {
        "narration": f"Update your Trader Profile with a refinement ({len(new_profile)} chars).",
        "contextual_warnings": [], "confirm_label": "Save refinement", "elevated": False,
        "profile_excerpt": new_profile[:300] + ("…" if len(new_profile) > 300 else ""),
    }


def _update_trader_profile_execute(*, user_id, account_id, args, conn=None) -> dict:
    new_profile = (args.get("trader_profile") or "").strip()
    if not new_profile:
        return {"ok": False, "error": "trader_profile required"}
    c = conn or get_connection()
    c.execute(
        "UPDATE j2_accounts SET trader_profile = ? WHERE id = ? AND user_id = ?",
        (new_profile, account_id, user_id),
    )
    c.commit()
    return {"ok": True, "summary": "Trader profile updated."}


def _resolve_profile_suggestion_preview(*, user_id, account_id, args, conn=None) -> dict:
    return {
        "narration": "Mark this profile suggestion as resolved (no further action needed).",
        "contextual_warnings": [], "confirm_label": "Mark resolved", "elevated": False,
    }


def _resolve_profile_suggestion_execute(*, user_id, account_id, args, conn=None) -> dict:
    sid = args.get("suggestion_id")
    if not sid:
        return {"ok": False, "error": "suggestion_id required"}
    from api.services.journal_two import profile_suggestions as ps
    n = ps.resolve_suggestion(sid, user_id=user_id, conn=conn)
    if n == 0:
        return {"ok": False, "error": "suggestion not found"}
    return {"ok": True, "summary": "Suggestion resolved."}


TOOLS.update({
    "list_pending_profile_suggestions": {
        "name": "list_pending_profile_suggestions",
        "description": "List pending profile-refinement suggestions auto-created when the trader marked a recap unhelpful. Use this at the start of a chat turn to see if there's accumulated feedback to address.",
        "requires_confirm": False,
        "executor": _exec_list_pending_profile_suggestions,
        "input_schema": {"type": "object", "properties": {}},
    },
    "update_trader_profile": {
        "name": "update_trader_profile",
        "description": "Save a refined Trader Profile. Use this AFTER the trader has confirmed the new profile content in chat. The user gets a Confirm card to review the change.",
        "requires_confirm": True,
        "executor": _update_trader_profile_execute,
        "preview": _update_trader_profile_preview,
        "input_schema": {
            "type": "object",
            "properties": {"trader_profile": {"type": "string"}},
            "required": ["trader_profile"],
        },
    },
    "resolve_profile_suggestion": {
        "name": "resolve_profile_suggestion",
        "description": "Mark a profile suggestion as resolved (used after Compass has discussed it with the trader and applied any update_trader_profile changes).",
        "requires_confirm": True,
        "executor": _resolve_profile_suggestion_execute,
        "preview": _resolve_profile_suggestion_preview,
        "input_schema": {
            "type": "object",
            "properties": {"suggestion_id": {"type": "string"}},
            "required": ["suggestion_id"],
        },
    },
})
```

- [ ] **Step 2: Add 2 endpoints**

In `api/routers/journal_two.py`, after the interventions endpoints:

```python
@router.get("/accounts/{account_id}/coach/profile-suggestions")
def list_profile_suggestions(
    account_id: str,
    user: dict = Depends(get_current_user),
):
    from api.services.journal_two import profile_suggestions as ps
    return ps.list_pending(user_id=user["id"], account_id=account_id)


@router.post("/accounts/{account_id}/coach/profile-suggestions/{suggestion_id}/dismiss")
def dismiss_profile_suggestion(
    account_id: str,
    suggestion_id: str,
    user: dict = Depends(get_current_user),
):
    from api.services.journal_two import profile_suggestions as ps
    n = ps.dismiss_suggestion(suggestion_id, user_id=user["id"])
    if n == 0:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    return {"ok": True}
```

- [ ] **Step 3: Test + commit**

```bash
python -m pytest api/services/journal_two/ -q
python -c "from fastapi.testclient import TestClient; from api.main import app; routes = sorted([r.path for r in app.routes if 'profile-suggestions' in r.path]); print(routes)"
git -C C:/Users/Patrick/uct-dashboard add api/services/journal_two/coach_chat_tools.py api/routers/journal_two.py
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-aft): 3 chat tools + 2 endpoints for profile suggestions"
```

Expected: 2 routes; suite green.

---

## Task 3: Frontend hook + Compass tab banner + push

**Files:** new hook, modify `CompassTab.jsx`.

- [ ] **Step 1: Create `useProfileSuggestions.js`**

```js
/**
 * Pending profile suggestions hook — SWR + dismiss action.
 */
import useSWR from 'swr'
import { useCallback } from 'react'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useProfileSuggestions(accountId) {
  const url = accountId
    ? `/api/j2/accounts/${accountId}/coach/profile-suggestions`
    : null
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: true,
    refreshInterval: 30000,
    shouldRetryOnError: false,
  })

  const dismiss = useCallback(async (id) => {
    if (!accountId || !id) return
    await fetch(`/api/j2/accounts/${accountId}/coach/profile-suggestions/${id}/dismiss`, {
      method: 'POST', credentials: 'include',
    })
    await mutate()
  }, [accountId, mutate])

  return {
    suggestions: data?.suggestions ?? [],
    isLoading,
    error,
    dismiss,
    refresh: mutate,
  }
}
```

- [ ] **Step 2: Mount banner in `CompassTab.jsx`**

Read `app/src/pages/journal-2-0/tabs/CompassTab.jsx`. Add imports + hook + banner ABOVE the existing CompassChat / InterventionBanner mount:

```jsx
import useProfileSuggestions from '../hooks/useProfileSuggestions'
// ...
const { suggestions: profileSuggestions, dismiss: dismissSuggestion } = useProfileSuggestions(accountId)
```

Add the banner JSX above the chat panel (and below the InterventionBanner from earlier):

```jsx
{profileSuggestions.length > 0 && (
  <div style={{
    margin: '8px 0', padding: '10px 14px',
    background: 'rgba(201,168,76,0.08)',
    border: '1px solid rgba(201,168,76,0.5)',
    borderRadius: 6,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    gap: 10,
  }}>
    <div style={{ fontSize: 12 }}>
      <strong style={{ color: 'var(--ut-gold, #c9a84c)' }}>🧭 Compass wants to refine its understanding of you.</strong>
      <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>
        {profileSuggestions.length} pending suggestion{profileSuggestions.length === 1 ? '' : 's'} from your recent feedback. Start a chat to walk through them.
      </div>
    </div>
    <button
      type="button"
      onClick={() => profileSuggestions.forEach((s) => dismissSuggestion(s.id))}
      style={{
        padding: '4px 12px', fontSize: 11,
        background: 'transparent', color: 'var(--text-muted)',
        border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer',
      }}
    >Dismiss all</button>
  </div>
)}
```

- [ ] **Step 3: Build, suite, commit, push**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npm run build
npx vitest run src/pages/journal-2-0/
cd ..
python -m pytest api/services/journal_two/ -q
git -C C:/Users/Patrick/uct-dashboard add app/src/pages/journal-2-0/hooks/useProfileSuggestions.js app/src/pages/journal-2-0/tabs/CompassTab.jsx
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-aft): profile suggestions hook + banner in CompassTab"
git -C C:/Users/Patrick/uct-dashboard push origin master
```

Active Feedback Trimming is live.

---

## Self-Review Checklist

- `j2_profile_suggestions` table created
- `auto_create_from_unhelpful_feedback` wired into BOTH `coach.set_feedback` and `trade_review.set_feedback`
- 7 backend tests pass
- 3 chat tools (1 read + 2 action) registered
- 2 endpoints + chat tab banner mount
- Banner shows count + "Dismiss all" link
- All scoped by user_id + account_id
