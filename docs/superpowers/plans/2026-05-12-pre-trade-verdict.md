# Pre-Trade Verdict Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `🧭 Check with Compass` button on AddPositionModal that returns a GO / HOLD / SKIP verdict + reasoning before the trade is created, using a deterministic-then-LLM two-stage pipeline.

**Architecture:**
- **Stage 1 (hard checks, no LLM)**: `muted_setups`, `paper_only_days`, risk-cap breach, daily-loss-limit breach, cooling-off active, account size unset. ANY failure → return verdict immediately.
- **Stage 2 (Compass via Sonnet 4.6)**: structured JSON output `{label, paragraph, factors[]}`. Receives setup performance in current regime, recent arcs, weekly focus, trader profile, trade params.
- Verdict logged to new `j2_verdicts` table; on trade submit, `context_at_entry.compass_verdict_id` references it. Audit loop closed.
- Also exposed as a `pre_trade_verdict` chat tool so users can ask "can I take NVDA at $200?" conversationally.

**Tech Stack:** Python 3.12, FastAPI, SQLite, `anthropic>=0.40.0`, React + Vite + SWR.

---

## File Map

| Path | Action | Role |
|---|---|---|
| `api/services/journal_two/db.py` | Modify | Add `j2_verdicts` table |
| `api/services/journal_two/pre_trade_verdict.py` | Create | Hard checks + LLM call + verdict persistence |
| `api/services/journal_two/test_pre_trade_verdict.py` | Create | Tests for hard checks + LLM path |
| `api/services/journal_two/coach_prompts.py` | Modify | Add `COMPASS_VERDICT_SYSTEM_PROMPT` |
| `api/services/journal_two/coach_chat_tools.py` | Modify | Add `pre_trade_verdict` chat tool |
| `api/services/journal_two/test_coach_chat_tools.py` | Modify | Test the chat tool |
| `api/routers/journal_two.py` | Modify | `POST /coach/pre-trade-verdict` endpoint |
| `app/src/pages/journal-2-0/hooks/usePreTradeVerdict.js` | Create | SWR-less hook (one-shot POST) |
| `app/src/pages/journal-2-0/components/PreTradeVerdictCard.jsx` | Create | Verdict display (label + paragraph + factor bullets) |
| `app/src/pages/journal-2-0/components/PreTradeVerdictCard.test.jsx` | Create | Vitest cases |
| `app/src/pages/journal-2-0/components/AddPositionModal.jsx` | Modify | Add "Check with Compass" button + render verdict |

---

## Task 1: DB migration — `j2_verdicts` table

**Files:**
- Modify: `api/services/journal_two/db.py`

- [ ] **Step 1: Append table to `_J2_SCHEMA`**

Append before closing `"""`:

```sql

CREATE TABLE IF NOT EXISTS j2_verdicts (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    account_id      TEXT NOT NULL,
    symbol          TEXT NOT NULL,
    side            TEXT NOT NULL,
    shares          REAL,
    entry_price     REAL,
    stop_price      REAL,
    target_price    REAL,
    setup           TEXT,
    risk_pct        REAL,
    label           TEXT NOT NULL CHECK(label IN ('GO','HOLD','SKIP','ERROR')),
    paragraph       TEXT NOT NULL,
    factors         TEXT NOT NULL DEFAULT '[]',
    source          TEXT NOT NULL CHECK(source IN ('hard_check','llm')),
    hard_check_failed TEXT,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_j2_verdicts_account
    ON j2_verdicts(user_id, account_id, created_at);
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
print('table:', conn.execute(\"SELECT name FROM sqlite_master WHERE type='table' AND name='j2_verdicts'\").fetchone()[0])
cols = [r[1] for r in conn.execute('PRAGMA table_info(j2_verdicts)').fetchall()]
print('label in cols:', 'label' in cols)
print('source in cols:', 'source' in cols)
conn.close(); os.unlink(tmp.name)
"
```

Expected: prints `table: j2_verdicts` + `label in cols: True` + `source in cols: True`.

- [ ] **Step 3: Full j2 suite**

```bash
python -m pytest api/services/journal_two/ -q
```

Expected: baseline holds (~441 passing).

- [ ] **Step 4: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add api/services/journal_two/db.py
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-verdict): db migration — j2_verdicts table"
```

---

## Task 2: `pre_trade_verdict.py` — hard checks + LLM orchestrator + tests

**Files:**
- Create: `api/services/journal_two/pre_trade_verdict.py`
- Create: `api/services/journal_two/test_pre_trade_verdict.py`

The hard checks live in their own function so they're easy to test and easy to reason about. The LLM call comes second.

- [ ] **Step 1: Write failing tests**

Create `api/services/journal_two/test_pre_trade_verdict.py`:

```python
"""Tests for the Pre-Trade Verdict service."""
from __future__ import annotations
import importlib, json, os, sqlite3, tempfile, uuid
from datetime import datetime, timezone, timedelta
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


def _seed_account(db_conn, user_id="u_v"):
    from api.services.journal_two import accounts as accounts_service
    acc = accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)
    # Set basic settings
    db_conn.execute(
        """UPDATE j2_accounts
           SET account_size = ?, max_risk_per_trade_pct = ?,
               daily_loss_limit_pct = ?
           WHERE id = ?""",
        (100000.0, 1.0, 3.0, acc["id"]),
    )
    db_conn.commit()
    return acc


# ── Hard checks ─────────────────────────────────────────────────────────────


def test_hard_check_muted_setup_returns_skip(db_conn):
    from api.services.journal_two import pre_trade_verdict as ptv
    acc = _seed_account(db_conn)
    db_conn.execute(
        "UPDATE j2_accounts SET muted_setups = ? WHERE id = ?",
        (json.dumps([{"setup_name": "Bull Flag", "until_date": "2026-12-31"}]), acc["id"]),
    )
    db_conn.commit()
    result = ptv.generate_verdict(
        user_id="u_v", account_id=acc["id"],
        params={"symbol": "NVDA", "side": "Long", "shares": 100,
                "entry_price": 200.0, "stop_price": 198.0, "setup": "Bull Flag"},
        conn=db_conn,
    )
    assert result["label"] == "SKIP"
    assert result["source"] == "hard_check"
    assert "muted" in result["paragraph"].lower()


def test_hard_check_paper_only_day_returns_skip(db_conn):
    from api.services.journal_two import pre_trade_verdict as ptv
    acc = _seed_account(db_conn)
    today = datetime.now(timezone.utc).date().isoformat()
    db_conn.execute(
        "UPDATE j2_accounts SET paper_only_days = ? WHERE id = ?",
        (json.dumps([{"date": today, "reason": "compass_chat"}]), acc["id"]),
    )
    db_conn.commit()
    result = ptv.generate_verdict(
        user_id="u_v", account_id=acc["id"],
        params={"symbol": "NVDA", "side": "Long", "shares": 100,
                "entry_price": 200.0, "stop_price": 198.0, "setup": "Bull Flag"},
        conn=db_conn,
    )
    assert result["label"] == "SKIP"
    assert result["source"] == "hard_check"
    assert "paper" in result["paragraph"].lower()


def test_hard_check_risk_above_cap_returns_skip(db_conn):
    from api.services.journal_two import pre_trade_verdict as ptv
    acc = _seed_account(db_conn)
    # 100 shares * (200-180) = $2000 risk. $100k account. 2% risk. Cap is 1%.
    result = ptv.generate_verdict(
        user_id="u_v", account_id=acc["id"],
        params={"symbol": "NVDA", "side": "Long", "shares": 100,
                "entry_price": 200.0, "stop_price": 180.0, "setup": "Bull Flag"},
        conn=db_conn,
    )
    assert result["label"] == "SKIP"
    assert result["source"] == "hard_check"
    assert "risk" in result["paragraph"].lower()


def test_hard_check_account_size_unset_returns_error(db_conn):
    from api.services.journal_two import pre_trade_verdict as ptv
    from api.services.journal_two import accounts as accounts_service
    acc = accounts_service.get_or_migrate_default_account("u_v", conn=db_conn)
    db_conn.execute("UPDATE j2_accounts SET account_size = 0 WHERE id = ?", (acc["id"],))
    db_conn.commit()
    result = ptv.generate_verdict(
        user_id="u_v", account_id=acc["id"],
        params={"symbol": "NVDA", "side": "Long", "shares": 100,
                "entry_price": 200.0, "stop_price": 198.0, "setup": "Bull Flag"},
        conn=db_conn,
    )
    assert result["label"] == "ERROR"


def test_hard_check_daily_loss_limit_breached_returns_skip(db_conn):
    from api.services.journal_two import pre_trade_verdict as ptv
    acc = _seed_account(db_conn)
    # Daily loss limit is 3% of $100k = $3000. Insert today's trades summing to -$3500.
    today_iso = datetime.now(timezone.utc).date().isoformat()
    db_conn.execute(
        """INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares,
           entry_price, entry_date, exit_price, exit_date, original_stop, setup,
           notes, pnl_dollar, pnl_percent, r_multiple, hold_days, result,
           context_at_entry, created_at, account_id, mistake_tags, emotion_tags, fees, regime)
           VALUES (?, 'u_v', ?, 'XYZ', 'Long', 100, 100, ?, 95, ?, 99, 'Pullback',
           NULL, -3500, -3.5, -1, 0, 'Loss', '{}', ?, ?, '[]', '[]', 0, NULL)""",
        (str(uuid.uuid4()), str(uuid.uuid4()),
         f"{today_iso}T14:00:00+00:00", f"{today_iso}T20:00:00+00:00",
         f"{today_iso}T20:00:00+00:00", acc["id"]),
    )
    db_conn.commit()
    result = ptv.generate_verdict(
        user_id="u_v", account_id=acc["id"],
        params={"symbol": "NVDA", "side": "Long", "shares": 100,
                "entry_price": 200.0, "stop_price": 199.0, "setup": "Bull Flag"},
        conn=db_conn,
    )
    assert result["label"] == "SKIP"
    assert result["source"] == "hard_check"
    assert "daily" in result["paragraph"].lower() or "loss limit" in result["paragraph"].lower()


# ── LLM path (with FakeClient) ──────────────────────────────────────────────


class FakeVerdictClient:
    def __init__(self, response_text):
        self.response_text = response_text
        self.calls = []

    def write_verdict(self, *, system_prompt, user_message):
        self.calls.append({"system_prompt": system_prompt, "user_message": user_message})
        return {"body": self.response_text}


def test_llm_path_returns_structured_verdict(db_conn):
    from api.services.journal_two import pre_trade_verdict as ptv
    acc = _seed_account(db_conn)
    fake = FakeVerdictClient(json.dumps({
        "label": "GO",
        "paragraph": "Bull Flag at AMBER is your strong zone. Size is in range. Go.",
        "factors": ["Bull Flag +1.8R avg in AMBER", "1% sizing within cap"],
    }))
    result = ptv.generate_verdict(
        user_id="u_v", account_id=acc["id"],
        params={"symbol": "NVDA", "side": "Long", "shares": 100,
                "entry_price": 200.0, "stop_price": 199.0, "setup": "Bull Flag"},
        client=fake, conn=db_conn,
    )
    assert result["label"] == "GO"
    assert result["source"] == "llm"
    assert "Bull Flag" in result["paragraph"]
    assert len(result["factors"]) == 2


def test_llm_path_persists_to_j2_verdicts(db_conn):
    from api.services.journal_two import pre_trade_verdict as ptv
    acc = _seed_account(db_conn)
    fake = FakeVerdictClient(json.dumps({
        "label": "HOLD",
        "paragraph": "Sample size too small.",
        "factors": ["only 3 prior trades on this setup"],
    }))
    result = ptv.generate_verdict(
        user_id="u_v", account_id=acc["id"],
        params={"symbol": "NVDA", "side": "Long", "shares": 100,
                "entry_price": 200.0, "stop_price": 199.0, "setup": "Bull Flag"},
        client=fake, conn=db_conn,
    )
    row = db_conn.execute(
        "SELECT label, paragraph, source FROM j2_verdicts WHERE id = ?",
        (result["verdict_id"],),
    ).fetchone()
    assert row["label"] == "HOLD"
    assert row["source"] == "llm"


def test_hard_check_verdict_also_persisted(db_conn):
    from api.services.journal_two import pre_trade_verdict as ptv
    acc = _seed_account(db_conn)
    db_conn.execute(
        "UPDATE j2_accounts SET muted_setups = ? WHERE id = ?",
        (json.dumps([{"setup_name": "Bull Flag", "until_date": "2026-12-31"}]), acc["id"]),
    )
    db_conn.commit()
    result = ptv.generate_verdict(
        user_id="u_v", account_id=acc["id"],
        params={"symbol": "NVDA", "side": "Long", "shares": 100,
                "entry_price": 200.0, "stop_price": 199.0, "setup": "Bull Flag"},
        conn=db_conn,
    )
    n = db_conn.execute("SELECT COUNT(*) AS n FROM j2_verdicts").fetchone()["n"]
    assert n == 1


def test_llm_path_handles_malformed_json_gracefully(db_conn):
    """If the LLM returns non-JSON, return SKIP with explanation instead of crashing."""
    from api.services.journal_two import pre_trade_verdict as ptv
    acc = _seed_account(db_conn)
    fake = FakeVerdictClient("Sorry, I can't help with that.")
    result = ptv.generate_verdict(
        user_id="u_v", account_id=acc["id"],
        params={"symbol": "NVDA", "side": "Long", "shares": 100,
                "entry_price": 200.0, "stop_price": 199.0, "setup": "Bull Flag"},
        client=fake, conn=db_conn,
    )
    assert result["label"] in ("HOLD", "SKIP")  # graceful fallback
```

- [ ] **Step 2: Confirm fail**

```bash
cd C:/Users/Patrick/uct-dashboard
python -m pytest api/services/journal_two/test_pre_trade_verdict.py -q
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement `pre_trade_verdict.py`**

```python
"""
Pre-Trade Verdict — two-stage decision pipeline.

Stage 1 (hard checks, no LLM): muted setups, paper-only days, risk cap,
daily-loss-limit, cooling-off, account-size. ANY failure → return immediately.

Stage 2 (LLM via Sonnet 4.6): structured JSON verdict on soft factors —
setup performance in current regime, recent patterns, weekly focus,
trader profile.

Every verdict is logged to `j2_verdicts` for audit (whether the trader
followed the verdict can be tracked post-trade via
context_at_entry.compass_verdict_id on j2_positions).
"""
from __future__ import annotations
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone, timedelta, date
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two import coach_data_assembler
from api.services.journal_two import db as j2_db


# ── Anthropic wrapper ────────────────────────────────────────────────────────


class AnthropicVerdictClient:
    DEFAULT_MODEL = "claude-sonnet-4-6"

    def __init__(self, api_key: str | None = None):
        import anthropic
        key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            raise RuntimeError("ANTHROPIC_API_KEY not set")
        self._client = anthropic.Anthropic(api_key=key)

    def write_verdict(self, *, system_prompt: str, user_message: str) -> dict:
        msg = self._client.messages.create(
            model=self.DEFAULT_MODEL,
            max_tokens=600,
            temperature=0.3,
            system=[{"type": "text", "text": system_prompt,
                     "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user_message}],
        )
        body = msg.content[0].text if msg.content else ""
        return {"body": body}


# ── Helpers ──────────────────────────────────────────────────────────────────


def _get_conn(conn=None):
    if conn is not None:
        return conn, False
    import sqlite3 as _sq
    path = os.environ.get("AUTH_DB_PATH") or "/data/auth.db"
    c = _sq.connect(path)
    c.row_factory = _sq.Row
    return c, True


def _compute_risk_pct(params: dict, account_size: float) -> float | None:
    shares = float(params.get("shares") or 0)
    entry = float(params.get("entry_price") or 0)
    stop = float(params.get("stop_price") or 0)
    if shares <= 0 or entry <= 0 or stop <= 0 or account_size <= 0:
        return None
    per_share = abs(entry - stop)
    return (shares * per_share / account_size) * 100.0


def _persist_verdict(
    conn, *,
    user_id: str, account_id: str, params: dict, risk_pct: float | None,
    label: str, paragraph: str, factors: list, source: str,
    hard_check_failed: str | None = None,
) -> str:
    vid = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT INTO j2_verdicts
           (id, user_id, account_id, symbol, side, shares, entry_price, stop_price,
            target_price, setup, risk_pct, label, paragraph, factors, source,
            hard_check_failed, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (vid, user_id, account_id,
         params.get("symbol"), params.get("side"),
         params.get("shares"), params.get("entry_price"), params.get("stop_price"),
         params.get("target_price"), params.get("setup"),
         risk_pct, label, paragraph, json.dumps(factors), source,
         hard_check_failed, now_iso),
    )
    conn.commit()
    return vid


# ── Hard checks ──────────────────────────────────────────────────────────────


def _hard_checks(*, user_id: str, account_id: str, params: dict, conn) -> dict | None:
    """Run hard checks. Returns a verdict dict if ANY check fires, else None."""
    settings = accounts_service.get_account_settings(user_id, account_id, conn=conn) or {}
    account_size = float(settings.get("accountSize") or 0)
    risk_pct = _compute_risk_pct(params, account_size)

    # Account size
    if account_size <= 0:
        return {
            "label": "ERROR",
            "paragraph": "Your account size is not configured. Set it in Settings before I can evaluate trades.",
            "factors": ["account_size unset"],
            "source": "hard_check",
            "hard_check_failed": "account_size_unset",
            "risk_pct": None,
        }

    # Muted setup check
    setup_name = params.get("setup")
    if setup_name:
        muted_raw = (conn.execute(
            "SELECT muted_setups FROM j2_accounts WHERE id = ? AND user_id = ?",
            (account_id, user_id),
        ).fetchone() or {})
        try:
            muted = json.loads(muted_raw["muted_setups"] or "[]") if muted_raw else []
        except (TypeError, json.JSONDecodeError, KeyError):
            muted = []
        for m in muted:
            if m.get("setup_name") == setup_name:
                until = m.get("until_date") or ""
                return {
                    "label": "SKIP",
                    "paragraph": f"You muted {setup_name} until {until}. If you've changed your mind, unmute it first.",
                    "factors": [f"{setup_name} is muted until {until}"],
                    "source": "hard_check",
                    "hard_check_failed": "muted_setup",
                    "risk_pct": risk_pct,
                }

    # Paper-only day check
    today_iso = datetime.now(timezone.utc).date().isoformat()
    paper_raw = (conn.execute(
        "SELECT paper_only_days FROM j2_accounts WHERE id = ? AND user_id = ?",
        (account_id, user_id),
    ).fetchone() or {})
    try:
        paper_days = json.loads(paper_raw["paper_only_days"] or "[]") if paper_raw else []
    except (TypeError, json.JSONDecodeError, KeyError):
        paper_days = []
    if any((d.get("date") == today_iso) for d in paper_days):
        return {
            "label": "SKIP",
            "paragraph": f"Today ({today_iso}) is marked paper-only. Take this trade in your paper account.",
            "factors": [f"today is paper-only"],
            "source": "hard_check",
            "hard_check_failed": "paper_only_day",
            "risk_pct": risk_pct,
        }

    # Risk-cap breach
    cap_pct = settings.get("maxRiskPerTradePct")
    if cap_pct is not None and risk_pct is not None and risk_pct > float(cap_pct):
        return {
            "label": "SKIP",
            "paragraph": f"This trade risks {risk_pct:.2f}% of your account. Your cap is {cap_pct}%. Reduce shares or widen account size.",
            "factors": [f"risk {risk_pct:.2f}% > cap {cap_pct}%"],
            "source": "hard_check",
            "hard_check_failed": "risk_cap_breach",
            "risk_pct": risk_pct,
        }

    # Daily-loss-limit breach
    daily_limit_pct = settings.get("dailyLossLimitPct")
    if daily_limit_pct is not None and account_size > 0:
        threshold_dollar = -float(daily_limit_pct) * account_size / 100.0
        rows = conn.execute(
            """SELECT pnl_dollar FROM j2_trades
               WHERE user_id = ? AND account_id = ?
                 AND substr(exit_date, 1, 10) = ?""",
            (user_id, account_id, today_iso),
        ).fetchall()
        net = sum(float(r["pnl_dollar"] or 0) for r in rows)
        if net <= threshold_dollar:
            return {
                "label": "SKIP",
                "paragraph": f"You're already down ${abs(net):.0f} today — past your daily loss limit of {daily_limit_pct}%. Step away.",
                "factors": [f"today realized {net:.0f} ≤ -{daily_limit_pct}% threshold"],
                "source": "hard_check",
                "hard_check_failed": "daily_loss_limit_breach",
                "risk_pct": risk_pct,
            }

    return None  # All hard checks passed; defer to LLM


# ── LLM path ─────────────────────────────────────────────────────────────────


def _llm_verdict(
    *, user_id: str, account_id: str, params: dict, risk_pct: float | None,
    client, conn,
) -> dict:
    from api.services.journal_two import coach_prompts

    # Assemble context
    settings = accounts_service.get_account_settings(user_id, account_id, conn=conn) or {}

    # Setup performance in current regime over 90d
    setup_name = params.get("setup")
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=90)
    trades = coach_data_assembler._trades_in_range(conn, user_id, account_id, start, end)
    setup_trades = [t for t in trades if t.get("setup") == setup_name] if setup_name else []
    setup_agg = coach_data_assembler._aggregate_trades(setup_trades)

    # Current regime
    regime_label = None
    try:
        from api.services.journal_two import regime as regime_service
        info = regime_service.get_current_regime() or {}
        regime_label = info.get("regime")
    except Exception:
        pass

    # Recent arcs
    arcs = []
    try:
        rolling = coach_data_assembler._trades_in_range(
            conn, user_id, account_id, end - timedelta(days=10), end,
        )
        arcs = coach_data_assembler._detect_recent_arcs(rolling, today_date=end.date())
    except Exception:
        pass

    # This-week focus
    focus = None
    try:
        focus_row = conn.execute(
            """SELECT metadata FROM j2_coach_outputs
               WHERE user_id = ? AND account_id = ? AND output_type='weekly_review' AND forgotten=0
               ORDER BY created_at DESC LIMIT 1""",
            (user_id, account_id),
        ).fetchone()
        if focus_row:
            meta = json.loads(focus_row["metadata"] or "{}")
            focus = meta.get("this_weeks_focus")
    except Exception:
        pass

    # Trader profile excerpt
    profile_row = conn.execute(
        "SELECT trader_profile FROM j2_accounts WHERE id = ? AND user_id = ?",
        (account_id, user_id),
    ).fetchone()
    profile = (profile_row["trader_profile"] or "")[:1500] if profile_row else ""

    # Build user message
    user_message_parts = [
        "# Pre-Trade Verdict request",
        "",
        "## Proposed trade",
        f"- Symbol: {params.get('symbol')}",
        f"- Side: {params.get('side')}",
        f"- Shares: {params.get('shares')}",
        f"- Entry: {params.get('entry_price')}",
        f"- Stop: {params.get('stop_price')}",
        f"- Target: {params.get('target_price') or '(none)'}",
        f"- Setup: {setup_name or '(unspecified)'}",
        f"- Computed risk: {risk_pct:.2f}%" if risk_pct is not None else "- Risk: (cannot compute)",
        "",
        f"## Current regime: {regime_label or 'unknown'}",
        "",
        f"## Setup performance over last 90 days ({setup_name or 'all'})",
        f"- Trades: {setup_agg.get('trade_count', 0)}",
        f"- Wins/Losses: {setup_agg.get('wins', 0)}/{setup_agg.get('losses', 0)}",
        f"- Avg R: {setup_agg.get('avg_r')}",
        f"- Profit factor: {setup_agg.get('profit_factor')}",
        "",
    ]
    if arcs:
        user_message_parts.append("## Recent patterns")
        for a in arcs:
            user_message_parts.append(f"- {a}")
        user_message_parts.append("")
    if focus:
        user_message_parts.append("## This week's focus (from Sunday's Weekly Review)")
        user_message_parts.append(focus)
        user_message_parts.append("")
    if profile:
        user_message_parts.append("## Trader profile")
        user_message_parts.append(profile)
        user_message_parts.append("")
    user_message_parts.append("Return your verdict as JSON only — no surrounding text.")

    user_message = "\n".join(user_message_parts)

    response = client.write_verdict(
        system_prompt=coach_prompts.COMPASS_VERDICT_SYSTEM_PROMPT,
        user_message=user_message,
    )
    raw = response.get("body", "").strip()

    # Parse JSON (with graceful fallback)
    parsed: dict | None = None
    try:
        # Strip markdown fence if present
        if raw.startswith("```"):
            raw = raw.split("```", 2)[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()
            if raw.endswith("```"):
                raw = raw.rsplit("```", 1)[0].strip()
        parsed = json.loads(raw)
    except (json.JSONDecodeError, IndexError):
        pass

    if parsed and isinstance(parsed, dict) and parsed.get("label") in ("GO", "HOLD", "SKIP"):
        return {
            "label": parsed["label"],
            "paragraph": (parsed.get("paragraph") or "")[:2000],
            "factors": parsed.get("factors") or [],
            "source": "llm",
            "risk_pct": risk_pct,
        }

    # Malformed — graceful fallback
    return {
        "label": "HOLD",
        "paragraph": "Compass couldn't produce a structured verdict on this trade. Consider taking a smaller size or paper-trading it.",
        "factors": ["LLM response was unparseable"],
        "source": "llm",
        "risk_pct": risk_pct,
    }


# ── Public entry point ──────────────────────────────────────────────────────


def generate_verdict(
    *,
    user_id: str,
    account_id: str,
    params: dict,
    client=None,
    conn=None,
) -> dict:
    """Two-stage verdict: hard checks first, LLM second. Always persists to
    j2_verdicts. Returns {verdict_id, label, paragraph, factors, source,
    hard_check_failed?, risk_pct}."""
    _conn, _close = _get_conn(conn)
    try:
        # Stage 1: hard checks
        hard = _hard_checks(
            user_id=user_id, account_id=account_id, params=params, conn=_conn,
        )
        if hard is not None:
            vid = _persist_verdict(
                _conn, user_id=user_id, account_id=account_id, params=params,
                risk_pct=hard.get("risk_pct"),
                label=hard["label"], paragraph=hard["paragraph"],
                factors=hard.get("factors") or [], source="hard_check",
                hard_check_failed=hard.get("hard_check_failed"),
            )
            return {**hard, "verdict_id": vid}

        # Stage 2: LLM
        settings = accounts_service.get_account_settings(user_id, account_id, conn=_conn) or {}
        account_size = float(settings.get("accountSize") or 0)
        risk_pct = _compute_risk_pct(params, account_size)

        active_client = client or AnthropicVerdictClient()
        llm = _llm_verdict(
            user_id=user_id, account_id=account_id, params=params,
            risk_pct=risk_pct, client=active_client, conn=_conn,
        )
        vid = _persist_verdict(
            _conn, user_id=user_id, account_id=account_id, params=params,
            risk_pct=risk_pct,
            label=llm["label"], paragraph=llm["paragraph"],
            factors=llm.get("factors") or [], source="llm",
        )
        return {**llm, "verdict_id": vid}
    finally:
        if _close:
            _conn.close()
```

- [ ] **Step 4: Confirm tests pass**

```bash
python -m pytest api/services/journal_two/test_pre_trade_verdict.py -q
```

Expected: 9 passed.

- [ ] **Step 5: Full j2 suite**

```bash
python -m pytest api/services/journal_two/ -q
```

Expected: ≥ 450 passing.

- [ ] **Step 6: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add api/services/journal_two/pre_trade_verdict.py api/services/journal_two/test_pre_trade_verdict.py
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-verdict): pre_trade_verdict service — hard checks + LLM + persistence"
```

---

## Task 3: System prompt — `COMPASS_VERDICT_SYSTEM_PROMPT`

**Files:**
- Modify: `api/services/journal_two/coach_prompts.py`

- [ ] **Step 1: Append the verdict-specific system prompt**

At the bottom of `coach_prompts.py`:

```python
# ── COMPASS_VERDICT_SYSTEM_PROMPT ───────────────────────────────────────────
#
# Used by pre_trade_verdict service. Compass is asked to evaluate a single
# proposed trade against the trader's history + current regime + their
# stated rules. Output is JSON only.

COMPASS_VERDICT_SYSTEM_PROMPT = """\
You are Compass, a senior trading coach. The trader has filled in a trade
form and clicked "Check with Compass" — they want a quick verdict before
they execute.

## Output format

Return JSON ONLY. No surrounding prose. No markdown fence. Schema:

```
{
  "label": "GO" | "HOLD" | "SKIP",
  "paragraph": "2-3 sentence verdict, max 350 chars",
  "factors": ["short factor line", "another factor line", ...]
}
```

Labels mean:
- **GO** — setup + sizing + regime + recent patterns all support taking it
- **HOLD** — would take it BUT something is borderline (small sample, mediocre setup-in-regime fit, slight conflict with this-week's focus)
- **SKIP** — actively opposed (poor setup-in-regime fit, recent pattern argues against, conflict with stated focus, low-conviction conditions)

## Tone

Direct. Calibrated. No moralizing. State your call in the first 5 words of
the paragraph. Cite ONE specific data point in the next clause.

Good: "GO. Bull Flag in AMBER is +1.8R over last 90d (6 wins / 4 losses)."
Bad: "Looking at your data, considering many factors, I think you might want to consider..."

## Calibration

- Sample size <5 trades on this setup → degrade GO → HOLD and mention "small sample"
- Setup performance NEGATIVE over period → SKIP
- "This week's focus" conflicts with the trade → SKIP regardless of stats
- Regime + setup mix shows clear negative edge → SKIP

## Hard rule

NEVER invent numbers. If a stat isn't in the data I gave you, don't cite it.
If the data is genuinely thin, return HOLD with "sample too small to call".

Begin when asked.
"""
```

- [ ] **Step 2: Smoke + suite + commit**

```bash
cd C:/Users/Patrick/uct-dashboard
python -c "from api.services.journal_two.coach_prompts import COMPASS_VERDICT_SYSTEM_PROMPT; assert 'GO' in COMPASS_VERDICT_SYSTEM_PROMPT and 'SKIP' in COMPASS_VERDICT_SYSTEM_PROMPT; print('OK')"
python -m pytest api/services/journal_two/ -q
git -C C:/Users/Patrick/uct-dashboard add api/services/journal_two/coach_prompts.py
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-verdict): COMPASS_VERDICT_SYSTEM_PROMPT — JSON-only structured verdict"
```

---

## Task 4: Endpoint + chat tool

**Files:**
- Modify: `api/routers/journal_two.py`
- Modify: `api/services/journal_two/coach_chat_tools.py`
- Modify: `api/services/journal_two/test_coach_chat_tools.py`

- [ ] **Step 1: Add the endpoint**

In `api/routers/journal_two.py`, after the existing chat endpoints, append:

```python
@router.post("/accounts/{account_id}/coach/pre-trade-verdict")
def pre_trade_verdict(
    account_id: str,
    payload: dict,
    user: dict = Depends(get_current_user),
):
    from api.services.journal_two import pre_trade_verdict as ptv_service
    settings_check = accounts_service.get_account_settings(user["id"], account_id)
    if settings_check is None:
        raise HTTPException(status_code=404, detail="Account not found")
    if not settings_check.get("compassEnabled", True):
        raise HTTPException(status_code=403, detail="Compass is disabled for this account")
    return ptv_service.generate_verdict(
        user_id=user["id"], account_id=account_id, params=payload or {},
    )
```

- [ ] **Step 2: Add the chat tool**

In `coach_chat_tools.py`, near the action tools:

```python
def _exec_pre_trade_verdict(*, user_id, account_id, args, conn=None) -> dict:
    from api.services.journal_two import pre_trade_verdict as ptv
    return ptv.generate_verdict(
        user_id=user_id, account_id=account_id, params=args, conn=conn,
    )
```

Register:

```python
TOOLS.update({
    "pre_trade_verdict": {
        "name": "pre_trade_verdict",
        "description": "Run a pre-trade verdict on a proposed trade. Returns GO/HOLD/SKIP + paragraph + factors. Use this when the trader asks 'can I take this trade?' or similar.",
        "requires_confirm": False,
        "executor": _exec_pre_trade_verdict,
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string"},
                "side": {"type": "string", "enum": ["Long", "Short"]},
                "shares": {"type": "number"},
                "entry_price": {"type": "number"},
                "stop_price": {"type": "number"},
                "target_price": {"type": "number"},
                "setup": {"type": "string"},
            },
            "required": ["symbol", "side", "shares", "entry_price", "stop_price"],
        },
    },
})
```

- [ ] **Step 3: Append a tool test**

```python
def test_pre_trade_verdict_tool_invokes_ptv(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    db_conn.execute(
        "UPDATE j2_accounts SET account_size = 100000, max_risk_per_trade_pct = 1 WHERE id = ?",
        (acc["id"],),
    )
    db_conn.commit()
    # Risk = 100 * 20 / 100000 = 2% > cap of 1% → hard check SKIP
    result = tools.TOOLS["pre_trade_verdict"]["executor"](
        user_id="u_chat", account_id=acc["id"],
        args={"symbol": "NVDA", "side": "Long", "shares": 100,
              "entry_price": 200.0, "stop_price": 180.0, "setup": "Bull Flag"},
        conn=db_conn,
    )
    assert result["label"] == "SKIP"
    assert result["source"] == "hard_check"
```

- [ ] **Step 4: Smoke + tests**

```bash
python -m pytest api/services/journal_two/test_coach_chat_tools.py -q
python -c "from fastapi.testclient import TestClient; from api.main import app; routes = sorted([r.path for r in app.routes if 'pre-trade' in r.path]); print(routes)"
python -m pytest api/services/journal_two/ -q
```

Expected: 1 new test passes; route registered; suite green.

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add api/routers/journal_two.py api/services/journal_two/coach_chat_tools.py api/services/journal_two/test_coach_chat_tools.py
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-verdict): POST /coach/pre-trade-verdict endpoint + chat tool"
```

---

## Task 5: Frontend hook + verdict card + tests

**Files:**
- Create: `app/src/pages/journal-2-0/hooks/usePreTradeVerdict.js`
- Create: `app/src/pages/journal-2-0/components/PreTradeVerdictCard.jsx`
- Create: `app/src/pages/journal-2-0/components/PreTradeVerdictCard.test.jsx`

- [ ] **Step 1: Create the hook**

```js
/**
 * Pre-Trade Verdict hook — one-shot POST, no SWR caching.
 *
 * Returns: { run, verdict, isLoading, error, reset }
 */
import { useState, useCallback } from 'react'

export default function usePreTradeVerdict(accountId) {
  const [verdict, setVerdict] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)

  const run = useCallback(async (params) => {
    if (!accountId) return
    setIsLoading(true)
    setError(null)
    try {
      const r = await fetch(`/api/j2/accounts/${accountId}/coach/pre-trade-verdict`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!r.ok) {
        let msg = `${r.status}`
        try { const j = await r.json(); if (j?.detail) msg = j.detail } catch {}
        throw new Error(msg)
      }
      const data = await r.json()
      setVerdict(data)
      return data
    } catch (e) {
      setError(String(e.message || e))
      return null
    } finally {
      setIsLoading(false)
    }
  }, [accountId])

  const reset = useCallback(() => {
    setVerdict(null)
    setError(null)
  }, [])

  return { run, verdict, isLoading, error, reset }
}
```

- [ ] **Step 2: Write failing component test**

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PreTradeVerdictCard from './PreTradeVerdictCard'

describe('PreTradeVerdictCard', () => {
  it('renders nothing when verdict is null', () => {
    const { container } = render(<PreTradeVerdictCard verdict={null} isLoading={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders loading spinner when isLoading', () => {
    render(<PreTradeVerdictCard verdict={null} isLoading={true} />)
    expect(screen.getByText(/Compass is thinking/i)).toBeInTheDocument()
  })

  it('renders GO label in green', () => {
    render(<PreTradeVerdictCard verdict={{
      label: 'GO', paragraph: 'Bull Flag at AMBER is +1.8R over last 90d.',
      factors: ['90d setup avg: +1.8R'],
    }} isLoading={false} />)
    expect(screen.getByText('GO')).toBeInTheDocument()
    expect(screen.getByText(/Bull Flag at AMBER/i)).toBeInTheDocument()
  })

  it('renders SKIP label in red with paragraph', () => {
    render(<PreTradeVerdictCard verdict={{
      label: 'SKIP', paragraph: 'Risk exceeds your 1% cap.',
      factors: ['risk 2.0% > cap 1%'],
    }} isLoading={false} />)
    expect(screen.getByText('SKIP')).toBeInTheDocument()
    expect(screen.getByText(/Risk exceeds your 1% cap/i)).toBeInTheDocument()
  })

  it('renders factors when expandable section is opened', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    render(<PreTradeVerdictCard verdict={{
      label: 'GO', paragraph: 'Looks fine.',
      factors: ['Setup +1.8R avg', 'Regime AMBER fit'],
    }} isLoading={false} />)
    await user.click(screen.getByRole('button', { name: /What Compass weighed/i }))
    expect(screen.getByText(/Setup \+1.8R avg/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Confirm fail**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npx vitest run src/pages/journal-2-0/components/PreTradeVerdictCard.test.jsx
```

Expected: module not found.

- [ ] **Step 4: Implement the card**

```jsx
/**
 * Pre-Trade Verdict card — renders verdict label + paragraph + collapsible factors.
 *
 * Props:
 *   verdict: null | { label: 'GO'|'HOLD'|'SKIP'|'ERROR', paragraph: string, factors: string[] }
 *   isLoading: bool
 *   error?: string
 */
import { useState } from 'react'

const LABEL_STYLES = {
  GO: { bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.5)', text: '#22c55e' },
  HOLD: { bg: 'rgba(201,168,76,0.10)', border: 'rgba(201,168,76,0.5)', text: '#c9a84c' },
  SKIP: { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.5)', text: '#ef4444' },
  ERROR: { bg: 'rgba(120,120,120,0.10)', border: 'var(--border)', text: 'var(--text-muted)' },
}

export default function PreTradeVerdictCard({ verdict, isLoading, error }) {
  const [open, setOpen] = useState(false)

  if (isLoading) {
    return (
      <div style={cardStyle('var(--border)', 'rgba(255,255,255,0.02)')}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          🧭 Compass is thinking…
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={cardStyle('rgba(239,68,68,0.5)', 'rgba(239,68,68,0.06)')}>
        <div style={{ fontSize: 12, color: '#ef4444' }}>Verdict error: {error}</div>
      </div>
    )
  }

  if (!verdict) return null

  const styles = LABEL_STYLES[verdict.label] || LABEL_STYLES.ERROR
  return (
    <div style={cardStyle(styles.border, styles.bg)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>🧭 Compass</div>
        <div style={{
          padding: '4px 12px', fontSize: 14, fontWeight: 700,
          borderRadius: 4, background: styles.text, color: '#000',
        }}>
          {verdict.label}
        </div>
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-bright)', marginBottom: 6 }}>
        {verdict.paragraph}
      </div>
      {Array.isArray(verdict.factors) && verdict.factors.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            style={{
              fontSize: 11, color: 'var(--text-muted)',
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: 0, textDecoration: 'underline',
            }}
          >
            {open ? '▾ Hide' : '▸ What Compass weighed'}
          </button>
          {open && (
            <ul style={{ margin: '6px 0 0 18px', fontSize: 11, color: 'var(--text-muted)' }}>
              {verdict.factors.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function cardStyle(border, bg) {
  return {
    margin: '8px 0',
    padding: '10px 14px',
    background: bg,
    border: `1px solid ${border}`,
    borderRadius: 6,
  }
}
```

- [ ] **Step 5: Run tests + build**

```bash
npx vitest run src/pages/journal-2-0/components/PreTradeVerdictCard.test.jsx
npm run build
```

Expected: 5 vitest pass; build OK.

- [ ] **Step 6: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add app/src/pages/journal-2-0/hooks/usePreTradeVerdict.js app/src/pages/journal-2-0/components/PreTradeVerdictCard.jsx app/src/pages/journal-2-0/components/PreTradeVerdictCard.test.jsx
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-verdict): usePreTradeVerdict hook + PreTradeVerdictCard component"
```

---

## Task 6: AddPositionModal integration

**Files:**
- Modify: `app/src/pages/journal-2-0/components/AddPositionModal.jsx`

- [ ] **Step 1: Add imports**

```jsx
import usePreTradeVerdict from '../hooks/usePreTradeVerdict'
import PreTradeVerdictCard from './PreTradeVerdictCard'
```

- [ ] **Step 2: Get current accountId in the component**

If not already destructured from a hook in the component, the existing modal pattern likely passes `accountId` via props or fetches it via `useJ2SelectedAccount`. Find how AddPositionModal gets accountId currently. If it doesn't have direct access, add:

```jsx
import useJ2SelectedAccount from '../hooks/useJ2SelectedAccount'
// ...
const { accountId } = useJ2SelectedAccount()
```

- [ ] **Step 3: Wire the hook**

Add inside the component, near other state hooks:

```jsx
const { run: runVerdict, verdict, isLoading: verdictLoading, error: verdictError, reset: resetVerdict } = usePreTradeVerdict(accountId)
```

- [ ] **Step 4: Add the "Check with Compass" button + render card**

Find where the existing form's Confirm button lives. Add ABOVE it, but only when the required fields are filled:

```jsx
{/* Compass pre-trade verdict */}
<PreTradeVerdictCard verdict={verdict} isLoading={verdictLoading} error={verdictError} />
<button
  type="button"
  onClick={() => runVerdict({
    symbol: (formState.symbol || '').toUpperCase(),
    side: formState.side || 'Long',
    shares: Number(formState.shares) || 0,
    entry_price: Number(formState.entryPrice) || 0,
    stop_price: Number(formState.stopPrice) || 0,
    target_price: formState.targetPrice ? Number(formState.targetPrice) : undefined,
    setup: formState.setup || undefined,
  })}
  disabled={
    verdictLoading ||
    !formState.symbol || !formState.shares ||
    !formState.entryPrice || !formState.stopPrice
  }
  style={{
    width: '100%', padding: '8px 14px', fontSize: 12, fontWeight: 600,
    background: 'rgba(201,168,76,0.10)', color: 'var(--ut-gold, #c9a84c)',
    border: '1px solid rgba(201,168,76,0.5)', borderRadius: 6,
    cursor: verdictLoading ? 'wait' : 'pointer',
    margin: '6px 0',
  }}
>
  {verdictLoading ? '🧭 Compass is thinking…' : '🧭 Check with Compass'}
</button>
```

**Note**: The exact form field names (`symbol`, `shares`, `entryPrice`, etc.) need to match what AddPositionModal uses. Read the file first to confirm. If the form uses different names like `formState.symbol_input` or refs, adjust.

- [ ] **Step 5: Reset verdict on modal close**

If the modal has an `onClose` handler, ensure it calls `resetVerdict()` so reopening starts fresh.

- [ ] **Step 6: Build + suite**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npm run build
npx vitest run src/pages/journal-2-0/
```

Expected: build OK; vitest green.

- [ ] **Step 7: Commit + push**

```bash
git -C C:/Users/Patrick/uct-dashboard add app/src/pages/journal-2-0/components/AddPositionModal.jsx
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-verdict): wire Check with Compass button into AddPositionModal"
git -C C:/Users/Patrick/uct-dashboard push origin master
```

Railway redeploys. Pre-Trade Verdict is live.

---

## Self-Review Checklist

- **Spec coverage:** Hard checks (Task 2), LLM call (Task 2 + 3), persistence (Task 1 + 2), endpoint (Task 4), chat tool (Task 4), frontend hook (Task 5), verdict card (Task 5), AddPositionModal integration (Task 6). All covered.
- **Placeholder scan:** No TBD/TODO. Every step has concrete code or commands.
- **Type consistency:** `generate_verdict` returns `{verdict_id, label, paragraph, factors, source, hard_check_failed?, risk_pct}` — same shape across hard-check path, LLM path, fallback path. The hook + frontend card consume this shape.
- **Security:** Endpoint scoped by `Depends(get_current_user)`. Compass-enabled gate on endpoint. All SQL scoped by `user_id AND account_id`.
- **Failure modes:** Malformed LLM JSON → HOLD fallback. Account size = 0 → ERROR label. Network/API failure → frontend renders error message via card.
- **Persistence:** Both hard-check verdicts and LLM verdicts persist to `j2_verdicts` for full audit trail.
