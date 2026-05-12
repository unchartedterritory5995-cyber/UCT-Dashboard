# Per-Trade Post-Mortem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a "🧭 Tell me about this trade" surface on the Trade Drawer that returns a Compass-written 3-5 sentence post-mortem with specific data references, one takeaway, persisted for future viewing.

**Architecture:** New `j2_trade_reviews` table (one row per (user, trade)). New `trade_review.py` service with `generate_review` (idempotent on trade_id, optional regen). System prompt `COMPASS_TRADE_REVIEW_PROMPT` enforces "cite ≥1 specific data point + ≥1 takeaway". 6 REST endpoints. Frontend hook + card on Trade Drawer + Compass tab "Recent post-mortems" section.

**Tech Stack:** Python 3.12, FastAPI, SQLite, `anthropic`, React + Vite + SWR.

---

## File Map

| Path | Action |
|---|---|
| `api/services/journal_two/db.py` | Add `j2_trade_reviews` table |
| `api/services/journal_two/trade_review.py` | Create — orchestrator |
| `api/services/journal_two/test_trade_review.py` | Create — tests |
| `api/services/journal_two/coach_prompts.py` | Add `COMPASS_TRADE_REVIEW_PROMPT` |
| `api/routers/journal_two.py` | Add 6 endpoints under `/coach/trade-reviews` |
| `app/src/pages/journal-2-0/hooks/useTradeReview.js` | Create |
| `app/src/pages/journal-2-0/components/TradeReviewCard.jsx` | Create + tests |
| `app/src/pages/journal-2-0/components/TradeDrawer.jsx` | Add "Tell me about this trade" button + card |
| `app/src/pages/journal-2-0/tabs/CompassTab.jsx` | Add "Recent post-mortems" section |

---

## Task 1: DB migration — `j2_trade_reviews` table

**Files:** Modify `api/services/journal_two/db.py`

- [ ] **Step 1: Append to `_J2_SCHEMA`**

```sql

CREATE TABLE IF NOT EXISTS j2_trade_reviews (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    account_id  TEXT NOT NULL,
    trade_id    TEXT NOT NULL,
    body        TEXT NOT NULL,
    summary     TEXT,
    metadata    TEXT NOT NULL DEFAULT '{}',
    feedback    TEXT,
    forgotten   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    UNIQUE(user_id, trade_id) ON CONFLICT REPLACE
);

CREATE INDEX IF NOT EXISTS idx_j2_trade_reviews_trade
    ON j2_trade_reviews(trade_id);
CREATE INDEX IF NOT EXISTS idx_j2_trade_reviews_account
    ON j2_trade_reviews(user_id, account_id, created_at);
```

- [ ] **Step 2: Smoke**

```bash
cd C:/Users/Patrick/uct-dashboard
python -c "
import tempfile, sqlite3, os, importlib
tmp = tempfile.NamedTemporaryFile(suffix='.db', delete=False); tmp.close()
os.environ['AUTH_DB_PATH'] = tmp.name
from api.services import auth_db; importlib.reload(auth_db); auth_db.init_db()
conn = sqlite3.connect(tmp.name); conn.row_factory = sqlite3.Row
print('table:', conn.execute(\"SELECT name FROM sqlite_master WHERE type='table' AND name='j2_trade_reviews'\").fetchone()[0])
conn.close(); os.unlink(tmp.name)
"
python -m pytest api/services/journal_two/ -q
```

Expected: prints `table: j2_trade_reviews`; suite stays green.

- [ ] **Step 3: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add api/services/journal_two/db.py
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-review): db migration — j2_trade_reviews table"
```

---

## Task 2: `trade_review.py` service + tests

**Files:** Create `api/services/journal_two/trade_review.py` + test file.

- [ ] **Step 1: Write failing tests**

`api/services/journal_two/test_trade_review.py`:

```python
"""Tests for the per-trade Compass review service."""
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


def _seed_account(db_conn, user_id="u_r"):
    from api.services.journal_two import accounts as accounts_service
    return accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)


def _insert_trade(conn, *, user_id, account_id, exit_iso, **kwargs):
    defaults = dict(
        symbol="NVDA", side="Long", shares=100, entry_price=200.0,
        entry_date=exit_iso, exit_price=210.0, exit_date=exit_iso,
        original_stop=198.0, setup="Bull Flag", notes=None,
        pnl_dollar=1000.0, pnl_percent=5.0, r_multiple=2.0,
        hold_days=3, result="Win", context_at_entry="{}",
        created_at=exit_iso, mistake_tags="[]", emotion_tags="[]",
        fees=0, regime="AMBER",
    )
    defaults.update(kwargs)
    tid = str(uuid.uuid4())
    conn.execute(
        """INSERT INTO j2_trades (
            id, user_id, position_id, symbol, side, shares,
            entry_price, entry_date, exit_price, exit_date,
            original_stop, setup, notes, pnl_dollar, pnl_percent,
            r_multiple, hold_days, result, context_at_entry,
            created_at, account_id, mistake_tags, emotion_tags, fees, regime
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (tid, user_id, str(uuid.uuid4()),
         defaults["symbol"], defaults["side"], defaults["shares"],
         defaults["entry_price"], defaults["entry_date"],
         defaults["exit_price"], defaults["exit_date"],
         defaults["original_stop"], defaults["setup"], defaults["notes"],
         defaults["pnl_dollar"], defaults["pnl_percent"], defaults["r_multiple"],
         defaults["hold_days"], defaults["result"], defaults["context_at_entry"],
         defaults["created_at"], account_id, defaults["mistake_tags"],
         defaults["emotion_tags"], defaults["fees"], defaults["regime"]),
    )
    conn.commit()
    return tid


class FakeReviewClient:
    def __init__(self, body):
        self.body = body
        self.calls = []

    def write_review(self, *, system_prompt, user_message):
        self.calls.append({"system_prompt": system_prompt, "user_message": user_message})
        return {"body": self.body}


def test_generate_review_writes_row(db_conn):
    from api.services.journal_two import trade_review as tr
    acc = _seed_account(db_conn)
    trade_id = _insert_trade(db_conn, user_id="u_r", account_id=acc["id"],
                              exit_iso="2026-05-11T20:00:00+00:00")
    client = FakeReviewClient(
        "This NVDA Bull Flag at +2.0R landed cleanly. Entry at 200 hit "
        "your stop discipline. The hold of 3 days matches your setup avg. "
        "Takeaway: this is the rhythm — repeat."
    )
    result = tr.generate_review(
        user_id="u_r", account_id=acc["id"], trade_id=trade_id,
        client=client, conn=db_conn,
    )
    assert result["body"].startswith("This NVDA")
    assert result["trade_id"] == trade_id
    row = db_conn.execute(
        "SELECT body, summary FROM j2_trade_reviews WHERE trade_id = ?",
        (trade_id,),
    ).fetchone()
    assert row is not None
    assert "Bull Flag" in row["body"]


def test_generate_review_idempotent(db_conn):
    from api.services.journal_two import trade_review as tr
    acc = _seed_account(db_conn)
    trade_id = _insert_trade(db_conn, user_id="u_r", account_id=acc["id"],
                              exit_iso="2026-05-11T20:00:00+00:00")
    client = FakeReviewClient("First review body.")
    first = tr.generate_review(
        user_id="u_r", account_id=acc["id"], trade_id=trade_id,
        client=client, conn=db_conn,
    )
    # Second call with NO regen flag returns the existing row, doesn't re-call client.
    second = tr.generate_review(
        user_id="u_r", account_id=acc["id"], trade_id=trade_id,
        client=client, conn=db_conn,
    )
    assert first["id"] == second["id"]
    assert len(client.calls) == 1


def test_generate_review_regen_replaces_existing(db_conn):
    from api.services.journal_two import trade_review as tr
    acc = _seed_account(db_conn)
    trade_id = _insert_trade(db_conn, user_id="u_r", account_id=acc["id"],
                              exit_iso="2026-05-11T20:00:00+00:00")
    # First review
    tr.generate_review(
        user_id="u_r", account_id=acc["id"], trade_id=trade_id,
        client=FakeReviewClient("First body."), conn=db_conn,
    )
    # Regen
    second = tr.generate_review(
        user_id="u_r", account_id=acc["id"], trade_id=trade_id,
        client=FakeReviewClient("Second body, refreshed."), conn=db_conn,
        regenerate=True,
    )
    assert "refreshed" in second["body"]
    # Only one row exists due to UNIQUE constraint + REPLACE
    n = db_conn.execute(
        "SELECT COUNT(*) AS n FROM j2_trade_reviews WHERE trade_id = ?",
        (trade_id,),
    ).fetchone()["n"]
    assert n == 1


def test_generate_review_returns_error_for_missing_trade(db_conn):
    from api.services.journal_two import trade_review as tr
    acc = _seed_account(db_conn)
    result = tr.generate_review(
        user_id="u_r", account_id=acc["id"], trade_id="missing-id",
        client=FakeReviewClient("ignored"), conn=db_conn,
    )
    assert result.get("error") is not None


def test_list_reviews_returns_recent_first(db_conn):
    from api.services.journal_two import trade_review as tr
    acc = _seed_account(db_conn)
    t1 = _insert_trade(db_conn, user_id="u_r", account_id=acc["id"],
                       exit_iso="2026-05-10T20:00:00+00:00")
    t2 = _insert_trade(db_conn, user_id="u_r", account_id=acc["id"],
                       exit_iso="2026-05-11T20:00:00+00:00")
    tr.generate_review(user_id="u_r", account_id=acc["id"], trade_id=t1,
                       client=FakeReviewClient("review one"), conn=db_conn)
    tr.generate_review(user_id="u_r", account_id=acc["id"], trade_id=t2,
                       client=FakeReviewClient("review two"), conn=db_conn)
    out = tr.list_reviews(user_id="u_r", account_id=acc["id"], conn=db_conn)
    assert len(out["reviews"]) == 2
    # Newest first
    assert out["reviews"][0]["trade_id"] == t2


def test_set_feedback_updates_row(db_conn):
    from api.services.journal_two import trade_review as tr
    acc = _seed_account(db_conn)
    trade_id = _insert_trade(db_conn, user_id="u_r", account_id=acc["id"],
                              exit_iso="2026-05-11T20:00:00+00:00")
    r = tr.generate_review(user_id="u_r", account_id=acc["id"], trade_id=trade_id,
                            client=FakeReviewClient("body"), conn=db_conn)
    n = tr.set_feedback(r["id"], feedback="helpful", user_id="u_r", conn=db_conn)
    assert n == 1
    row = db_conn.execute("SELECT feedback FROM j2_trade_reviews WHERE id = ?", (r["id"],)).fetchone()
    assert row["feedback"] == "helpful"


def test_forget_review_marks_forgotten(db_conn):
    from api.services.journal_two import trade_review as tr
    acc = _seed_account(db_conn)
    trade_id = _insert_trade(db_conn, user_id="u_r", account_id=acc["id"],
                              exit_iso="2026-05-11T20:00:00+00:00")
    r = tr.generate_review(user_id="u_r", account_id=acc["id"], trade_id=trade_id,
                            client=FakeReviewClient("body"), conn=db_conn)
    n = tr.forget_review(r["id"], user_id="u_r", conn=db_conn)
    assert n == 1
    out = tr.list_reviews(user_id="u_r", account_id=acc["id"], conn=db_conn)
    assert all(rev["id"] != r["id"] for rev in out["reviews"])
```

- [ ] **Step 2: Implement `trade_review.py`**

```python
"""
Per-trade Compass post-mortem.

One row per (user, trade) in `j2_trade_reviews`. Idempotent by default;
pass regenerate=True to overwrite. Standard helpers for list / get /
feedback / forget mirror the patterns established by Weekly Review +
EOD Recap.
"""
from __future__ import annotations
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two import coach_data_assembler


class AnthropicReviewClient:
    DEFAULT_MODEL = "claude-sonnet-4-6"

    def __init__(self, api_key: str | None = None):
        import anthropic
        key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            raise RuntimeError("ANTHROPIC_API_KEY not set")
        self._client = anthropic.Anthropic(api_key=key)

    def write_review(self, *, system_prompt: str, user_message: str) -> dict:
        msg = self._client.messages.create(
            model=self.DEFAULT_MODEL,
            max_tokens=600,
            temperature=0.4,
            system=[{"type": "text", "text": system_prompt,
                     "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user_message}],
        )
        body = msg.content[0].text if msg.content else ""
        return {"body": body}


def _get_conn(conn=None):
    if conn is not None:
        return conn, False
    import sqlite3 as _sq
    path = os.environ.get("AUTH_DB_PATH") or "/data/auth.db"
    c = _sq.connect(path)
    c.row_factory = _sq.Row
    return c, True


def _trade_row_to_dict(row) -> dict:
    out = dict(row)
    for k in ("mistake_tags", "emotion_tags"):
        try:
            out[k] = json.loads(out.get(k) or "[]")
        except (TypeError, json.JSONDecodeError):
            out[k] = []
    return out


def generate_review(
    *,
    user_id: str,
    account_id: str,
    trade_id: str,
    client=None,
    conn=None,
    regenerate: bool = False,
) -> dict:
    """Generate (or return existing) post-mortem for a closed trade."""
    _conn, _close = _get_conn(conn)
    try:
        # Idempotency check
        if not regenerate:
            existing = _conn.execute(
                """SELECT id, body, summary, metadata, feedback, created_at, trade_id
                   FROM j2_trade_reviews
                   WHERE user_id = ? AND trade_id = ? AND forgotten = 0""",
                (user_id, trade_id),
            ).fetchone()
            if existing:
                return _row_to_dict(existing)

        # Fetch trade
        trade_row = _conn.execute(
            """SELECT id, symbol, side, shares, entry_price, exit_price,
                      entry_date, exit_date, original_stop, setup, notes,
                      pnl_dollar, pnl_percent, r_multiple, hold_days, result,
                      mistake_tags, emotion_tags, regime
               FROM j2_trades WHERE id = ? AND user_id = ?""",
            (trade_id, user_id),
        ).fetchone()
        if trade_row is None:
            return {"error": f"trade {trade_id} not found"}
        trade = _trade_row_to_dict(trade_row)

        # Assemble setup-90d context for comparison
        from api.services.journal_two import coach_prompts
        end = datetime.now(timezone.utc)
        start = end - timedelta(days=90)
        recent_trades = coach_data_assembler._trades_in_range(_conn, user_id, account_id, start, end)
        setup_name = trade.get("setup")
        setup_trades = [t for t in recent_trades if t.get("setup") == setup_name] if setup_name else []
        setup_agg = coach_data_assembler._aggregate_trades(setup_trades)

        # Trader profile
        profile_row = _conn.execute(
            "SELECT trader_profile FROM j2_accounts WHERE id = ? AND user_id = ?",
            (account_id, user_id),
        ).fetchone()
        profile = (profile_row["trader_profile"] or "")[:1500] if profile_row else ""

        # Build user message
        parts = [
            "# Trade post-mortem request",
            "",
            "## The trade",
            f"- Symbol: {trade.get('symbol')}",
            f"- Side: {trade.get('side')}",
            f"- Shares: {trade.get('shares')}",
            f"- Entry: {trade.get('entry_price')} on {trade.get('entry_date')}",
            f"- Exit: {trade.get('exit_price')} on {trade.get('exit_date')}",
            f"- Stop: {trade.get('original_stop')}",
            f"- Setup: {setup_name or '(unspecified)'}",
            f"- Result: {trade.get('result')}",
            f"- R-multiple: {trade.get('r_multiple')}",
            f"- $P&L: {trade.get('pnl_dollar')}",
            f"- Hold days: {trade.get('hold_days')}",
            f"- Regime: {trade.get('regime') or 'unknown'}",
            f"- Trader's notes: {trade.get('notes') or '(none)'}",
            f"- Mistake tags: {trade.get('mistake_tags')}",
            f"- Emotion tags: {trade.get('emotion_tags')}",
            "",
            f"## Setup performance over last 90 days ({setup_name or 'all'})",
            f"- Trades: {setup_agg.get('trade_count', 0)}",
            f"- Wins/Losses: {setup_agg.get('wins', 0)}/{setup_agg.get('losses', 0)}",
            f"- Avg R: {setup_agg.get('avg_r')}",
            f"- Profit factor: {setup_agg.get('profit_factor')}",
            "",
        ]
        if profile:
            parts.append("## Trader profile")
            parts.append(profile)
            parts.append("")
        parts.append("Write the post-mortem. Be Compass.")
        user_message = "\n".join(parts)

        system_prompt = getattr(
            coach_prompts, "COMPASS_TRADE_REVIEW_PROMPT",
            "You are Compass. Write a 3-5 sentence post-mortem on this trade. Cite at least one specific data point and end with one specific takeaway."
        )

        active_client = client or AnthropicReviewClient()
        response = active_client.write_review(
            system_prompt=system_prompt, user_message=user_message,
        )
        body = (response.get("body") or "").strip()
        summary = body[:200] if body else ""

        # Persist (UNIQUE constraint REPLACES on conflict)
        rid = str(uuid.uuid4())
        now_iso = datetime.now(timezone.utc).isoformat()
        meta = json.dumps({"setup": setup_name, "regime": trade.get("regime"),
                           "regenerated": bool(regenerate)})
        _conn.execute(
            """INSERT OR REPLACE INTO j2_trade_reviews
               (id, user_id, account_id, trade_id, body, summary, metadata,
                feedback, forgotten, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)""",
            (rid, user_id, account_id, trade_id, body, summary, meta, now_iso),
        )
        _conn.commit()
        return {
            "id": rid, "body": body, "summary": summary,
            "metadata": json.loads(meta), "feedback": None,
            "created_at": now_iso, "trade_id": trade_id,
        }
    finally:
        if _close:
            _conn.close()


def list_reviews(*, user_id: str, account_id: str, limit: int = 50, conn=None) -> dict:
    _conn, _close = _get_conn(conn)
    try:
        rows = _conn.execute(
            """SELECT id, body, summary, metadata, feedback, created_at, trade_id
               FROM j2_trade_reviews
               WHERE user_id = ? AND account_id = ? AND forgotten = 0
               ORDER BY created_at DESC LIMIT ?""",
            (user_id, account_id, limit),
        ).fetchall()
        return {"reviews": [_row_to_dict(r) for r in rows]}
    finally:
        if _close:
            _conn.close()


def get_review(review_id: str, *, user_id: str, conn=None) -> dict | None:
    _conn, _close = _get_conn(conn)
    try:
        row = _conn.execute(
            """SELECT id, body, summary, metadata, feedback, created_at, trade_id
               FROM j2_trade_reviews
               WHERE id = ? AND user_id = ? AND forgotten = 0""",
            (review_id, user_id),
        ).fetchone()
        return _row_to_dict(row) if row else None
    finally:
        if _close:
            _conn.close()


def set_feedback(review_id: str, *, feedback: str, user_id: str, conn=None) -> int:
    _conn, _close = _get_conn(conn)
    try:
        cur = _conn.execute(
            "UPDATE j2_trade_reviews SET feedback = ? WHERE id = ? AND user_id = ?",
            (feedback, review_id, user_id),
        )
        _conn.commit()
        return cur.rowcount
    finally:
        if _close:
            _conn.close()


def forget_review(review_id: str, *, user_id: str, conn=None) -> int:
    _conn, _close = _get_conn(conn)
    try:
        cur = _conn.execute(
            "UPDATE j2_trade_reviews SET forgotten = 1 WHERE id = ? AND user_id = ?",
            (review_id, user_id),
        )
        _conn.commit()
        return cur.rowcount
    finally:
        if _close:
            _conn.close()


def _row_to_dict(row) -> dict:
    if row is None:
        return None
    try:
        meta = json.loads(row["metadata"]) if row["metadata"] else {}
    except (TypeError, json.JSONDecodeError):
        meta = {}
    return {
        "id": row["id"], "body": row["body"], "summary": row["summary"] or "",
        "metadata": meta, "feedback": row["feedback"],
        "created_at": row["created_at"], "trade_id": row["trade_id"],
    }
```

- [ ] **Step 3: Tests, commit**

```bash
python -m pytest api/services/journal_two/test_trade_review.py -q
python -m pytest api/services/journal_two/ -q
git -C C:/Users/Patrick/uct-dashboard add api/services/journal_two/trade_review.py api/services/journal_two/test_trade_review.py
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-review): trade_review service — generate/list/get/feedback/forget"
```

Expected: 7 tests pass; suite ≥ 458.

---

## Task 3: System prompt + endpoints

**Files:** `coach_prompts.py`, `api/routers/journal_two.py`.

- [ ] **Step 1: Append to `coach_prompts.py`**

```python
COMPASS_TRADE_REVIEW_PROMPT = """\
You are Compass — a senior trading coach. The trader asked you to review
ONE specific closed trade.

## Output format

Write 3-5 sentences of prose. No headers, no bullets, no JSON. Pure
flowing text.

Structure (implicit, not labeled):
1. One sentence: was this trade in your plan? Did execution match it?
2. One sentence: how does this fit (or contradict) your historical pattern on this setup?
3. Optional: one sentence on what the data suggests about the entry, stop, exit, or hold.
4. Final sentence: ONE specific takeaway the trader could repeat or fix.

## Rules

- **Cite at least one specific data point** — the R, the hold days, the
  setup's 90-day average, the regime, a specific tag.
- **Calibrated language**: "looks like", "the data suggests", "in your sample".
- **No moralizing**. No "you should have known". State what happened, draw
  the pattern, give a takeaway.
- **NEVER invent numbers**. If a stat isn't in the data I gave you, don't cite it.
- Length cap: 400 words. Most reviews should be 80-150 words.

You are Compass. Begin when asked.
"""
```

- [ ] **Step 2: Add 6 endpoints to `api/routers/journal_two.py`**

```python
@router.get("/accounts/{account_id}/coach/trade-reviews")
def list_trade_reviews(
    account_id: str,
    user: dict = Depends(get_current_user),
):
    from api.services.journal_two import trade_review as tr
    return tr.list_reviews(user_id=user["id"], account_id=account_id)


@router.get("/accounts/{account_id}/coach/trade-reviews/{review_id}")
def get_trade_review(
    account_id: str,
    review_id: str,
    user: dict = Depends(get_current_user),
):
    from api.services.journal_two import trade_review as tr
    r = tr.get_review(review_id, user_id=user["id"])
    if not r:
        raise HTTPException(status_code=404, detail="Review not found")
    return r


@router.post("/accounts/{account_id}/coach/trade-reviews/generate")
def generate_trade_review(
    account_id: str,
    payload: dict,
    user: dict = Depends(get_current_user),
):
    from api.services.journal_two import trade_review as tr
    settings_check = accounts_service.get_account_settings(user["id"], account_id)
    if settings_check is None:
        raise HTTPException(status_code=404, detail="Account not found")
    if not settings_check.get("compassEnabled", True):
        raise HTTPException(status_code=403, detail="Compass is disabled for this account")
    trade_id = (payload or {}).get("trade_id")
    if not trade_id:
        raise HTTPException(status_code=400, detail="trade_id required")
    return tr.generate_review(
        user_id=user["id"], account_id=account_id, trade_id=trade_id,
    )


@router.post("/accounts/{account_id}/coach/trade-reviews/{review_id}/regenerate")
def regenerate_trade_review(
    account_id: str,
    review_id: str,
    user: dict = Depends(get_current_user),
):
    from api.services.journal_two import trade_review as tr
    existing = tr.get_review(review_id, user_id=user["id"])
    if not existing:
        raise HTTPException(status_code=404, detail="Review not found")
    return tr.generate_review(
        user_id=user["id"], account_id=account_id,
        trade_id=existing["trade_id"], regenerate=True,
    )


@router.post("/accounts/{account_id}/coach/trade-reviews/{review_id}/feedback")
def feedback_trade_review(
    account_id: str,
    review_id: str,
    payload: dict,
    user: dict = Depends(get_current_user),
):
    from api.services.journal_two import trade_review as tr
    feedback = (payload or {}).get("feedback")
    if feedback not in ("helpful", "unhelpful"):
        raise HTTPException(status_code=400, detail="feedback must be 'helpful' or 'unhelpful'")
    existing = tr.get_review(review_id, user_id=user["id"])
    if not existing:
        raise HTTPException(status_code=404, detail="Review not found")
    tr.set_feedback(review_id, feedback=feedback, user_id=user["id"])
    return {"ok": True}


@router.post("/accounts/{account_id}/coach/trade-reviews/{review_id}/forget")
def forget_trade_review(
    account_id: str,
    review_id: str,
    user: dict = Depends(get_current_user),
):
    from api.services.journal_two import trade_review as tr
    existing = tr.get_review(review_id, user_id=user["id"])
    if not existing:
        raise HTTPException(status_code=404, detail="Review not found")
    tr.forget_review(review_id, user_id=user["id"])
    return {"ok": True}
```

- [ ] **Step 3: Smoke, suite, commit**

```bash
python -c "from fastapi.testclient import TestClient; from api.main import app; routes = sorted([r.path for r in app.routes if 'trade-reviews' in r.path]); print('\n'.join(routes))"
python -m pytest api/services/journal_two/ -q
git -C C:/Users/Patrick/uct-dashboard add api/services/journal_two/coach_prompts.py api/routers/journal_two.py
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-review): COMPASS_TRADE_REVIEW_PROMPT + 6 endpoints"
```

Expected: 6 routes; suite still green.

---

## Task 4: Frontend hook + card

**Files:** `app/src/pages/journal-2-0/hooks/useTradeReview.js`, `components/TradeReviewCard.jsx` + test.

- [ ] **Step 1: Create `useTradeReview.js`**

```js
/**
 * Trade-review hook.
 *
 * Returns: { generate, regenerate, feedback, forget, review, isLoading, error, reset }
 */
import { useState, useCallback } from 'react'

export default function useTradeReview(accountId) {
  const [review, setReview] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)

  const callJson = useCallback(async (url, body) => {
    setError(null)
    const r = await fetch(url, {
      method: 'POST', credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!r.ok) {
      let msg = `${r.status}`
      try { const j = await r.json(); if (j?.detail) msg = j.detail } catch {}
      throw new Error(msg)
    }
    return r.json()
  }, [])

  const generate = useCallback(async (tradeId) => {
    if (!accountId || !tradeId) return null
    setIsLoading(true)
    try {
      const data = await callJson(
        `/api/j2/accounts/${accountId}/coach/trade-reviews/generate`,
        { trade_id: tradeId },
      )
      setReview(data)
      return data
    } catch (e) {
      setError(String(e.message || e))
      return null
    } finally {
      setIsLoading(false)
    }
  }, [accountId, callJson])

  const regenerate = useCallback(async (reviewId) => {
    if (!accountId || !reviewId) return null
    setIsLoading(true)
    try {
      const data = await callJson(
        `/api/j2/accounts/${accountId}/coach/trade-reviews/${reviewId}/regenerate`,
      )
      setReview(data)
      return data
    } catch (e) {
      setError(String(e.message || e))
      return null
    } finally {
      setIsLoading(false)
    }
  }, [accountId, callJson])

  const feedback = useCallback(async (reviewId, value) => {
    if (!accountId || !reviewId) return
    try {
      await callJson(
        `/api/j2/accounts/${accountId}/coach/trade-reviews/${reviewId}/feedback`,
        { feedback: value },
      )
      setReview((r) => r && r.id === reviewId ? { ...r, feedback: value } : r)
    } catch (e) {
      setError(String(e.message || e))
    }
  }, [accountId, callJson])

  const forget = useCallback(async (reviewId) => {
    if (!accountId || !reviewId) return
    try {
      await callJson(
        `/api/j2/accounts/${accountId}/coach/trade-reviews/${reviewId}/forget`,
      )
      setReview(null)
    } catch (e) {
      setError(String(e.message || e))
    }
  }, [accountId, callJson])

  const reset = useCallback(() => {
    setReview(null)
    setError(null)
  }, [])

  return { generate, regenerate, feedback, forget, review, isLoading, error, reset }
}
```

- [ ] **Step 2: Create test file `TradeReviewCard.test.jsx`**

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TradeReviewCard from './TradeReviewCard'

describe('TradeReviewCard', () => {
  it('renders nothing when review + isLoading are both falsy', () => {
    const { container } = render(<TradeReviewCard review={null} isLoading={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders loading message when isLoading', () => {
    render(<TradeReviewCard review={null} isLoading={true} />)
    expect(screen.getByText(/Compass is writing/i)).toBeInTheDocument()
  })

  it('renders review body', () => {
    render(<TradeReviewCard review={{
      id: 'r1', body: 'This NVDA Bull Flag at +2.0R landed cleanly. Repeat the rhythm.',
    }} isLoading={false} />)
    expect(screen.getByText(/Bull Flag at \+2.0R/i)).toBeInTheDocument()
  })

  it('clicking helpful fires onFeedback("helpful")', async () => {
    const onFeedback = vi.fn()
    const user = userEvent.setup()
    render(<TradeReviewCard review={{ id: 'r1', body: 'hi' }} isLoading={false}
                            onFeedback={onFeedback} />)
    await user.click(screen.getByRole('button', { name: /helpful/i }))
    expect(onFeedback).toHaveBeenCalledWith('helpful')
  })
})
```

- [ ] **Step 3: Create `TradeReviewCard.jsx`**

```jsx
/**
 * TradeReviewCard — Compass's post-mortem for one specific trade.
 *
 * Props:
 *   review: null | { id, body, feedback, created_at }
 *   isLoading: bool
 *   onFeedback?(value: 'helpful'|'unhelpful'): void
 *   onRegenerate?(): void
 *   onForget?(): void
 */

export default function TradeReviewCard({ review, isLoading, onFeedback, onRegenerate, onForget }) {
  if (isLoading) {
    return (
      <div style={cardStyle()}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          🧭 Compass is writing the post-mortem…
        </div>
      </div>
    )
  }
  if (!review) return null
  const fb = review.feedback
  return (
    <article style={cardStyle()}>
      <header style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: 10, marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ fontSize: 10, color: 'var(--ut-gold, #c9a84c)' }}>
          🧭 Compass review
          {review.created_at && (
            <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
              · {new Date(review.created_at).toLocaleString()}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button type="button" aria-label="helpful"
            onClick={() => onFeedback && onFeedback('helpful')}
            style={chipStyle(fb === 'helpful', '#22c55e')}>👍</button>
          <button type="button" aria-label="thumbs down"
            onClick={() => onFeedback && onFeedback('unhelpful')}
            style={chipStyle(fb === 'unhelpful', '#ef4444')}>👎</button>
          <button type="button" onClick={() => onRegenerate && onRegenerate()} style={ghostBtn()}>Regen</button>
          <button type="button" onClick={() => onForget && onForget()} style={ghostBtn()}>Forget</button>
        </div>
      </header>
      <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-bright)', whiteSpace: 'pre-wrap' }}>
        {review.body}
      </div>
    </article>
  )
}

function cardStyle() {
  return {
    background: 'rgba(201,168,76,0.05)',
    border: '1px solid rgba(201,168,76,0.3)',
    borderRadius: 8,
    padding: '10px 14px',
    margin: '8px 0',
  }
}

function chipStyle(active, color) {
  return {
    padding: '3px 8px', fontSize: 11,
    background: active ? color : 'transparent',
    color: active ? '#000' : 'var(--text-bright)',
    border: `1px solid ${active ? color : 'var(--border)'}`,
    borderRadius: 999, cursor: 'pointer',
  }
}

function ghostBtn() {
  return {
    padding: '3px 8px', fontSize: 11,
    background: 'transparent', color: 'var(--text-muted)',
    border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
  }
}
```

- [ ] **Step 4: Run tests + build + commit**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npx vitest run src/pages/journal-2-0/components/TradeReviewCard.test.jsx
npm run build
git -C C:/Users/Patrick/uct-dashboard add app/src/pages/journal-2-0/hooks/useTradeReview.js app/src/pages/journal-2-0/components/TradeReviewCard.jsx app/src/pages/journal-2-0/components/TradeReviewCard.test.jsx
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-review): useTradeReview hook + TradeReviewCard component"
```

Expected: 4 vitest pass; build OK.

---

## Task 5: TradeDrawer integration + smoke + push

**Files:** `app/src/pages/journal-2-0/components/TradeDrawer.jsx`.

- [ ] **Step 1: Read the file to find:**
- How it gets `accountId` (likely from `useJ2SelectedAccount` or props)
- The trade detail layout (where to insert button + card)
- The current trade's id (state variable)

- [ ] **Step 2: Add imports + hook**

```jsx
import useTradeReview from '../hooks/useTradeReview'
import TradeReviewCard from './TradeReviewCard'
// ...
const { review, isLoading: reviewLoading, generate: generateReview, regenerate: regenerateReview,
        feedback: reviewFeedback, forget: forgetReview, reset: resetReview } = useTradeReview(accountId)
```

- [ ] **Step 3: Add the button + card near the trade detail body**

Find a natural placement (e.g., near the trade's notes/details section). Insert:

```jsx
<TradeReviewCard
  review={review}
  isLoading={reviewLoading}
  onFeedback={(v) => review && reviewFeedback(review.id, v)}
  onRegenerate={() => review && regenerateReview(review.id)}
  onForget={() => review && forgetReview(review.id)}
/>
{!review && !reviewLoading && (
  <button
    type="button"
    onClick={() => generateReview(currentTrade.id)}
    disabled={!currentTrade || !currentTrade.id}
    style={{
      width: '100%', padding: '8px 14px', fontSize: 12, fontWeight: 600,
      background: 'rgba(201,168,76,0.10)', color: 'var(--ut-gold, #c9a84c)',
      border: '1px solid rgba(201,168,76,0.5)', borderRadius: 6,
      cursor: 'pointer', margin: '6px 0',
    }}
  >
    🧭 Tell me about this trade
  </button>
)}
```

`currentTrade` should be replaced with whatever variable holds the current trade object in TradeDrawer.

- [ ] **Step 4: Reset review when trade switches or drawer closes**

Find the effect / handler that loads a new trade. Call `resetReview()` so the previous trade's review doesn't bleed in. Also call it when the drawer closes.

- [ ] **Step 5: Build, smoke, commit, push**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npm run build
npx vitest run src/pages/journal-2-0/
cd ..
python -m pytest api/services/journal_two/ -q
git -C C:/Users/Patrick/uct-dashboard add app/src/pages/journal-2-0/components/TradeDrawer.jsx
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-review): wire 'Tell me about this trade' into TradeDrawer"
git -C C:/Users/Patrick/uct-dashboard push origin master
```

Per-Trade Post-Mortem is live.

---

## Self-Review Checklist

- DB migration is additive (new table only)
- Service: 7 tests pass; idempotent + regenerate
- 6 endpoints scoped by `get_current_user`; Compass-enabled gate on generate
- Frontend: 4 component tests pass; hook + card live
- TradeDrawer: button + card wired; resets between trades
- All commits pushed to Railway
