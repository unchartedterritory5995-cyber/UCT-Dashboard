# Real-Time Intervention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a tilt-detection layer that surfaces Compass heads-up banners when the trader opens AddPositionModal or the Compass tab. 4 deterministic rules. Reactive (not background polling).

**Architecture:** Service `interventions.py` runs a rule engine on demand. Each firing logs to `j2_interventions` with cooldown to prevent spam. Endpoints + chat tool expose active interventions. Banner component renders top-of-modal and above chat. No new LLM calls — pure rule engine.

**Tech Stack:** Python 3.12, FastAPI, SQLite, React + Vite + SWR.

---

## File Map

| Path | Action |
|---|---|
| `api/services/journal_two/db.py` | Add `j2_interventions` table |
| `api/services/journal_two/interventions.py` | Create — rule engine |
| `api/services/journal_two/test_interventions.py` | Create — tests |
| `api/services/journal_two/coach_chat_tools.py` | Add `check_active_interventions` tool |
| `api/routers/journal_two.py` | Add 2 endpoints |
| `app/src/pages/journal-2-0/hooks/useInterventions.js` | Create |
| `app/src/pages/journal-2-0/components/InterventionBanner.jsx` | Create + tests |
| `app/src/pages/journal-2-0/components/AddPositionModal.jsx` | Mount banner at top |
| `app/src/pages/journal-2-0/tabs/CompassTab.jsx` | Mount banner above chat |

---

## Task 1: DB migration — `j2_interventions` table

**Files:** Modify `api/services/journal_two/db.py`

- [ ] **Step 1: Append to `_J2_SCHEMA`**

```sql

CREATE TABLE IF NOT EXISTS j2_interventions (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    account_id   TEXT NOT NULL,
    rule         TEXT NOT NULL,
    severity     TEXT NOT NULL CHECK(severity IN ('info','warning','danger')),
    message      TEXT NOT NULL,
    factors      TEXT NOT NULL DEFAULT '[]',
    fired_at     TEXT NOT NULL,
    cooldown_until TEXT NOT NULL,
    dismissed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_j2_interventions_active
    ON j2_interventions(user_id, account_id, rule, cooldown_until);
```

- [ ] **Step 2: Smoke + suite**

```bash
cd C:/Users/Patrick/uct-dashboard
python -c "
import tempfile, sqlite3, os, importlib
tmp = tempfile.NamedTemporaryFile(suffix='.db', delete=False); tmp.close()
os.environ['AUTH_DB_PATH'] = tmp.name
from api.services import auth_db; importlib.reload(auth_db); auth_db.init_db()
conn = sqlite3.connect(tmp.name); conn.row_factory = sqlite3.Row
print('table:', conn.execute(\"SELECT name FROM sqlite_master WHERE type='table' AND name='j2_interventions'\").fetchone()[0])
conn.close(); os.unlink(tmp.name)
"
python -m pytest api/services/journal_two/ -q
```

Expected: prints table name; suite green.

- [ ] **Step 3: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add api/services/journal_two/db.py
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-intervention): db migration — j2_interventions table"
```

---

## Task 2: Rule engine service + tests

**Files:** Create `interventions.py` + tests.

- [ ] **Step 1: Write failing tests**

`api/services/journal_two/test_interventions.py`:

```python
"""Tests for the intervention rule engine."""
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


def _seed_account(db_conn, user_id="u_i"):
    from api.services.journal_two import accounts as accounts_service
    acc = accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)
    db_conn.execute(
        """UPDATE j2_accounts
           SET account_size = ?, daily_loss_limit_pct = ?,
               cooling_off_minutes_after_loss = ?
           WHERE id = ?""",
        (100000.0, 3.0, 30, acc["id"]),
    )
    db_conn.commit()
    return acc


def _insert_closed_trade(conn, *, user_id, account_id, exit_iso, result="Win",
                          pnl_dollar=500, r_multiple=1.0):
    tid = str(uuid.uuid4())
    conn.execute(
        """INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares,
           entry_price, entry_date, exit_price, exit_date, original_stop, setup,
           notes, pnl_dollar, pnl_percent, r_multiple, hold_days, result,
           context_at_entry, created_at, account_id, mistake_tags, emotion_tags, fees, regime)
           VALUES (?, ?, ?, 'NVDA', 'Long', 100, 100.0, ?, 105.0, ?, 98.0,
           'Bull Flag', NULL, ?, ?, ?, 0, ?, '{}', ?, ?, '[]', '[]', 0, NULL)""",
        (tid, user_id, str(uuid.uuid4()),
         exit_iso, exit_iso, pnl_dollar, pnl_dollar / 1000.0, r_multiple, result,
         exit_iso, account_id),
    )
    conn.commit()
    return tid


# ── rapid_fire_trading ──────────────────────────────────────────────────────


def test_rapid_fire_fires_when_3_trades_in_60min(db_conn):
    from api.services.journal_two import interventions as iv
    acc = _seed_account(db_conn)
    now = datetime.now(timezone.utc)
    for offset_min in (5, 15, 30):
        _insert_closed_trade(
            db_conn, user_id="u_i", account_id=acc["id"],
            exit_iso=(now - timedelta(minutes=offset_min)).isoformat(),
        )
    results = iv.evaluate_interventions(
        user_id="u_i", account_id=acc["id"], conn=db_conn,
    )
    rules = [r["rule"] for r in results]
    assert "rapid_fire_trading" in rules


def test_rapid_fire_does_not_fire_for_2_trades(db_conn):
    from api.services.journal_two import interventions as iv
    acc = _seed_account(db_conn)
    now = datetime.now(timezone.utc)
    for offset_min in (5, 15):
        _insert_closed_trade(
            db_conn, user_id="u_i", account_id=acc["id"],
            exit_iso=(now - timedelta(minutes=offset_min)).isoformat(),
        )
    results = iv.evaluate_interventions(
        user_id="u_i", account_id=acc["id"], conn=db_conn,
    )
    rules = [r["rule"] for r in results]
    assert "rapid_fire_trading" not in rules


# ── daily_loss_approach ─────────────────────────────────────────────────────


def test_daily_loss_approach_fires_at_75pct_of_limit(db_conn):
    from api.services.journal_two import interventions as iv
    acc = _seed_account(db_conn)
    today_iso = datetime.now(timezone.utc).date().isoformat()
    # Limit is 3% of 100k = $3000. 75% = $2250. Insert losses summing to -$2500.
    _insert_closed_trade(
        db_conn, user_id="u_i", account_id=acc["id"],
        exit_iso=f"{today_iso}T14:00:00+00:00",
        result="Loss", pnl_dollar=-2500, r_multiple=-2.5,
    )
    results = iv.evaluate_interventions(
        user_id="u_i", account_id=acc["id"], conn=db_conn,
    )
    rules = [r["rule"] for r in results]
    assert "daily_loss_approach" in rules


def test_daily_loss_approach_no_fire_when_well_below(db_conn):
    from api.services.journal_two import interventions as iv
    acc = _seed_account(db_conn)
    today_iso = datetime.now(timezone.utc).date().isoformat()
    _insert_closed_trade(
        db_conn, user_id="u_i", account_id=acc["id"],
        exit_iso=f"{today_iso}T14:00:00+00:00",
        result="Loss", pnl_dollar=-500, r_multiple=-0.5,
    )
    results = iv.evaluate_interventions(
        user_id="u_i", account_id=acc["id"], conn=db_conn,
    )
    rules = [r["rule"] for r in results]
    assert "daily_loss_approach" not in rules


# ── loss_streak ─────────────────────────────────────────────────────────────


def test_loss_streak_fires_at_3_consecutive(db_conn):
    from api.services.journal_two import interventions as iv
    acc = _seed_account(db_conn)
    today_iso = datetime.now(timezone.utc).date().isoformat()
    for h in (10, 11, 13):
        _insert_closed_trade(
            db_conn, user_id="u_i", account_id=acc["id"],
            exit_iso=f"{today_iso}T{h:02d}:00:00+00:00",
            result="Loss", pnl_dollar=-200, r_multiple=-1.0,
        )
    results = iv.evaluate_interventions(
        user_id="u_i", account_id=acc["id"], conn=db_conn,
    )
    rules = [r["rule"] for r in results]
    assert "loss_streak" in rules


def test_loss_streak_does_not_fire_with_winner_between(db_conn):
    from api.services.journal_two import interventions as iv
    acc = _seed_account(db_conn)
    today_iso = datetime.now(timezone.utc).date().isoformat()
    _insert_closed_trade(
        db_conn, user_id="u_i", account_id=acc["id"],
        exit_iso=f"{today_iso}T10:00:00+00:00",
        result="Loss", pnl_dollar=-200,
    )
    _insert_closed_trade(
        db_conn, user_id="u_i", account_id=acc["id"],
        exit_iso=f"{today_iso}T11:00:00+00:00",
        result="Win", pnl_dollar=500,
    )
    _insert_closed_trade(
        db_conn, user_id="u_i", account_id=acc["id"],
        exit_iso=f"{today_iso}T12:00:00+00:00",
        result="Loss", pnl_dollar=-200,
    )
    _insert_closed_trade(
        db_conn, user_id="u_i", account_id=acc["id"],
        exit_iso=f"{today_iso}T13:00:00+00:00",
        result="Loss", pnl_dollar=-200,
    )
    results = iv.evaluate_interventions(
        user_id="u_i", account_id=acc["id"], conn=db_conn,
    )
    rules = [r["rule"] for r in results]
    assert "loss_streak" not in rules


# ── cooling_off_active ──────────────────────────────────────────────────────


def test_cooling_off_fires_within_window(db_conn):
    from api.services.journal_two import interventions as iv
    acc = _seed_account(db_conn)  # cooling_off = 30 min
    # Insert loss 10 min ago — within window
    now = datetime.now(timezone.utc)
    _insert_closed_trade(
        db_conn, user_id="u_i", account_id=acc["id"],
        exit_iso=(now - timedelta(minutes=10)).isoformat(),
        result="Loss", pnl_dollar=-200,
    )
    results = iv.evaluate_interventions(
        user_id="u_i", account_id=acc["id"], conn=db_conn,
    )
    rules = [r["rule"] for r in results]
    assert "cooling_off_active" in rules


def test_cooling_off_does_not_fire_after_window(db_conn):
    from api.services.journal_two import interventions as iv
    acc = _seed_account(db_conn)
    now = datetime.now(timezone.utc)
    # Loss 60 min ago — outside the 30-min cooling-off window
    _insert_closed_trade(
        db_conn, user_id="u_i", account_id=acc["id"],
        exit_iso=(now - timedelta(minutes=60)).isoformat(),
        result="Loss", pnl_dollar=-200,
    )
    results = iv.evaluate_interventions(
        user_id="u_i", account_id=acc["id"], conn=db_conn,
    )
    rules = [r["rule"] for r in results]
    assert "cooling_off_active" not in rules


# ── persistence + dismissal ─────────────────────────────────────────────────


def test_evaluate_persists_fired_interventions(db_conn):
    from api.services.journal_two import interventions as iv
    acc = _seed_account(db_conn)
    now = datetime.now(timezone.utc)
    _insert_closed_trade(
        db_conn, user_id="u_i", account_id=acc["id"],
        exit_iso=(now - timedelta(minutes=10)).isoformat(),
        result="Loss", pnl_dollar=-200,
    )
    iv.evaluate_interventions(
        user_id="u_i", account_id=acc["id"], conn=db_conn,
    )
    n = db_conn.execute("SELECT COUNT(*) AS n FROM j2_interventions").fetchone()["n"]
    assert n >= 1


def test_dismiss_intervention_marks_dismissed(db_conn):
    from api.services.journal_two import interventions as iv
    acc = _seed_account(db_conn)
    now = datetime.now(timezone.utc)
    _insert_closed_trade(
        db_conn, user_id="u_i", account_id=acc["id"],
        exit_iso=(now - timedelta(minutes=10)).isoformat(),
        result="Loss", pnl_dollar=-200,
    )
    results = iv.evaluate_interventions(
        user_id="u_i", account_id=acc["id"], conn=db_conn,
    )
    assert len(results) > 0
    iid = results[0]["id"]
    iv.dismiss_intervention(intervention_id=iid, user_id="u_i", conn=db_conn)
    row = db_conn.execute(
        "SELECT dismissed_at FROM j2_interventions WHERE id = ?", (iid,)
    ).fetchone()
    assert row["dismissed_at"] is not None


def test_evaluate_respects_cooldown_no_duplicate_firings(db_conn):
    """A rule that just fired won't fire again until its cooldown elapses."""
    from api.services.journal_two import interventions as iv
    acc = _seed_account(db_conn)
    now = datetime.now(timezone.utc)
    _insert_closed_trade(
        db_conn, user_id="u_i", account_id=acc["id"],
        exit_iso=(now - timedelta(minutes=10)).isoformat(),
        result="Loss", pnl_dollar=-200,
    )
    iv.evaluate_interventions(user_id="u_i", account_id=acc["id"], conn=db_conn)
    n1 = db_conn.execute("SELECT COUNT(*) AS n FROM j2_interventions").fetchone()["n"]
    iv.evaluate_interventions(user_id="u_i", account_id=acc["id"], conn=db_conn)
    n2 = db_conn.execute("SELECT COUNT(*) AS n FROM j2_interventions").fetchone()["n"]
    assert n2 == n1  # No new firings during cooldown
```

- [ ] **Step 2: Implement `interventions.py`**

```python
"""
Intervention rule engine — detects tilt patterns at decision points.

4 rules with cooldowns:
- rapid_fire_trading: 3+ trades closed in last 60 min (1 hr cooldown)
- daily_loss_approach: net daily P&L past 75% of dailyLossLimitPct (4 hr cooldown)
- loss_streak: 3+ consecutive losses today (2 hr cooldown)
- cooling_off_active: within coolingOffMinutesAfterLoss of last loss (auto-clears)

evaluate_interventions returns active (non-dismissed, within-cooldown)
interventions. Persists new firings to j2_interventions; reuses existing
firings within cooldown rather than duplicating.
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


COOLDOWNS_MIN = {
    "rapid_fire_trading": 60,
    "daily_loss_approach": 240,
    "loss_streak": 120,
    "cooling_off_active": 0,  # auto-clears via dynamic check
}


def _get_conn(conn=None):
    if conn is not None:
        return conn, False
    import sqlite3 as _sq
    path = os.environ.get("AUTH_DB_PATH") or "/data/auth.db"
    c = _sq.connect(path)
    c.row_factory = _sq.Row
    return c, True


def _active_firing(conn, *, user_id: str, account_id: str, rule: str) -> dict | None:
    """Return the most recent non-dismissed firing of `rule` whose cooldown hasn't expired."""
    now_iso = datetime.now(timezone.utc).isoformat()
    row = conn.execute(
        """SELECT id, severity, message, factors, fired_at, cooldown_until
           FROM j2_interventions
           WHERE user_id = ? AND account_id = ? AND rule = ?
             AND dismissed_at IS NULL
             AND cooldown_until > ?
           ORDER BY fired_at DESC LIMIT 1""",
        (user_id, account_id, rule, now_iso),
    ).fetchone()
    if row is None:
        return None
    try:
        factors = json.loads(row["factors"] or "[]")
    except (TypeError, json.JSONDecodeError):
        factors = []
    return {
        "id": row["id"], "rule": rule,
        "severity": row["severity"], "message": row["message"],
        "factors": factors, "fired_at": row["fired_at"],
        "cooldown_until": row["cooldown_until"],
    }


def _record_firing(
    conn, *, user_id: str, account_id: str, rule: str,
    severity: str, message: str, factors: list,
) -> dict:
    iid = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    cooldown_min = COOLDOWNS_MIN.get(rule, 60)
    cooldown_until = (now + timedelta(minutes=cooldown_min)).isoformat()
    fired_at = now.isoformat()
    conn.execute(
        """INSERT INTO j2_interventions
           (id, user_id, account_id, rule, severity, message, factors,
            fired_at, cooldown_until, dismissed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)""",
        (iid, user_id, account_id, rule, severity, message,
         json.dumps(factors), fired_at, cooldown_until),
    )
    conn.commit()
    return {
        "id": iid, "rule": rule, "severity": severity, "message": message,
        "factors": factors, "fired_at": fired_at, "cooldown_until": cooldown_until,
    }


def _check_rapid_fire(conn, *, user_id, account_id) -> dict | None:
    """3+ closed trades in last 60 min."""
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=60)).isoformat()
    n = conn.execute(
        """SELECT COUNT(*) AS n FROM j2_trades
           WHERE user_id = ? AND account_id = ? AND exit_date >= ?""",
        (user_id, account_id, cutoff),
    ).fetchone()["n"]
    if n >= 3:
        return {
            "severity": "warning",
            "message": f"You've closed {n} trades in the last hour. Compass thinks you're hunting — slow down.",
            "factors": [f"{n} closed trades in last 60 minutes"],
        }
    return None


def _check_daily_loss_approach(conn, *, user_id, account_id) -> dict | None:
    """Net daily P&L past 75% of dailyLossLimitPct."""
    settings = accounts_service.get_account_settings(user_id, account_id, conn=conn) or {}
    account_size = float(settings.get("accountSize") or 0)
    limit_pct = settings.get("dailyLossLimitPct")
    if limit_pct is None or account_size <= 0:
        return None
    threshold_dollar = -0.75 * float(limit_pct) * account_size / 100.0
    today_iso = datetime.now(timezone.utc).date().isoformat()
    rows = conn.execute(
        """SELECT pnl_dollar FROM j2_trades
           WHERE user_id = ? AND account_id = ?
             AND substr(exit_date, 1, 10) = ?""",
        (user_id, account_id, today_iso),
    ).fetchall()
    net = sum(float(r["pnl_dollar"] or 0) for r in rows)
    if net <= threshold_dollar:
        return {
            "severity": "danger",
            "message": f"You're down ${abs(net):.0f} today — past 75% of your {limit_pct}% daily loss limit. Compass strongly recommends stepping away.",
            "factors": [
                f"today realized {net:.0f}",
                f"75% threshold = {threshold_dollar:.0f}",
            ],
        }
    return None


def _check_loss_streak(conn, *, user_id, account_id) -> dict | None:
    """3+ consecutive losses today (no winner since the streak started)."""
    today_iso = datetime.now(timezone.utc).date().isoformat()
    rows = conn.execute(
        """SELECT result, exit_date FROM j2_trades
           WHERE user_id = ? AND account_id = ?
             AND substr(exit_date, 1, 10) = ?
           ORDER BY exit_date DESC""",
        (user_id, account_id, today_iso),
    ).fetchall()
    streak = 0
    for r in rows:
        if r["result"] == "Loss":
            streak += 1
        else:
            break
    if streak >= 3:
        return {
            "severity": "danger",
            "message": f"{streak} consecutive losses today. Compass strongly suggests stepping away before the next trade.",
            "factors": [f"{streak} consecutive losses today"],
        }
    return None


def _check_cooling_off_active(conn, *, user_id, account_id) -> dict | None:
    """Within coolingOffMinutesAfterLoss of last closed loss."""
    settings = accounts_service.get_account_settings(user_id, account_id, conn=conn) or {}
    cooling_min = settings.get("coolingOffMinutesAfterLoss")
    if cooling_min is None or int(cooling_min) <= 0:
        return None
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=int(cooling_min))).isoformat()
    row = conn.execute(
        """SELECT exit_date FROM j2_trades
           WHERE user_id = ? AND account_id = ? AND result = 'Loss'
             AND exit_date >= ?
           ORDER BY exit_date DESC LIMIT 1""",
        (user_id, account_id, cutoff),
    ).fetchone()
    if row is None:
        return None
    # Cooling-off ALWAYS fires while a recent loss is within window (no cooldown).
    # We deliberately bypass _active_firing for this rule.
    return {
        "severity": "warning",
        "message": f"Cooling-off active — you took a loss in the last {cooling_min} minutes. Pause before the next entry.",
        "factors": [f"last loss at {row['exit_date'][:16]}"],
    }


RULE_CHECKS = {
    "rapid_fire_trading": _check_rapid_fire,
    "daily_loss_approach": _check_daily_loss_approach,
    "loss_streak": _check_loss_streak,
    "cooling_off_active": _check_cooling_off_active,
}


def evaluate_interventions(
    *, user_id: str, account_id: str, conn=None,
) -> list[dict]:
    """Run all rule checks. Return active firings (existing within-cooldown
    or newly fired). Cooling-off bypasses cooldown semantics and fires
    every time the underlying condition is true."""
    _conn, _close = _get_conn(conn)
    try:
        active: list[dict] = []
        for rule, check_fn in RULE_CHECKS.items():
            # Cooling-off is special — always re-evaluate fresh, no cooldown
            if rule == "cooling_off_active":
                detected = check_fn(_conn, user_id=user_id, account_id=account_id)
                if detected:
                    # Find existing un-dismissed firing or insert new
                    existing = _conn.execute(
                        """SELECT id, severity, message, factors, fired_at, cooldown_until
                           FROM j2_interventions
                           WHERE user_id = ? AND account_id = ? AND rule = ?
                             AND dismissed_at IS NULL
                           ORDER BY fired_at DESC LIMIT 1""",
                        (user_id, account_id, rule),
                    ).fetchone()
                    if existing:
                        try:
                            factors = json.loads(existing["factors"] or "[]")
                        except (TypeError, json.JSONDecodeError):
                            factors = []
                        active.append({
                            "id": existing["id"], "rule": rule,
                            "severity": existing["severity"],
                            "message": existing["message"],
                            "factors": factors,
                            "fired_at": existing["fired_at"],
                            "cooldown_until": existing["cooldown_until"],
                        })
                    else:
                        rec = _record_firing(
                            _conn, user_id=user_id, account_id=account_id, rule=rule,
                            **detected,
                        )
                        active.append(rec)
                continue

            # Standard rules — respect cooldown
            existing = _active_firing(_conn, user_id=user_id, account_id=account_id, rule=rule)
            if existing:
                active.append(existing)
                continue

            detected = check_fn(_conn, user_id=user_id, account_id=account_id)
            if detected:
                rec = _record_firing(
                    _conn, user_id=user_id, account_id=account_id, rule=rule,
                    **detected,
                )
                active.append(rec)
        return active
    finally:
        if _close:
            _conn.close()


def dismiss_intervention(*, intervention_id: str, user_id: str, conn=None) -> int:
    _conn, _close = _get_conn(conn)
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        cur = _conn.execute(
            "UPDATE j2_interventions SET dismissed_at = ? WHERE id = ? AND user_id = ?",
            (now_iso, intervention_id, user_id),
        )
        _conn.commit()
        return cur.rowcount
    finally:
        if _close:
            _conn.close()


def list_active(*, user_id: str, account_id: str, conn=None) -> list[dict]:
    """Read-only: list currently active interventions WITHOUT evaluating new rules."""
    _conn, _close = _get_conn(conn)
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        rows = _conn.execute(
            """SELECT id, rule, severity, message, factors, fired_at, cooldown_until
               FROM j2_interventions
               WHERE user_id = ? AND account_id = ?
                 AND dismissed_at IS NULL
                 AND cooldown_until > ?
               ORDER BY fired_at DESC""",
            (user_id, account_id, now_iso),
        ).fetchall()
        out = []
        for r in rows:
            try:
                factors = json.loads(r["factors"] or "[]")
            except (TypeError, json.JSONDecodeError):
                factors = []
            out.append({
                "id": r["id"], "rule": r["rule"],
                "severity": r["severity"], "message": r["message"],
                "factors": factors, "fired_at": r["fired_at"],
                "cooldown_until": r["cooldown_until"],
            })
        return out
    finally:
        if _close:
            _conn.close()
```

- [ ] **Step 3: Run tests, suite, commit**

```bash
python -m pytest api/services/journal_two/test_interventions.py -q
python -m pytest api/services/journal_two/ -q
git -C C:/Users/Patrick/uct-dashboard add api/services/journal_two/interventions.py api/services/journal_two/test_interventions.py
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-intervention): rule engine — rapid_fire/daily_loss/loss_streak/cooling_off"
```

Expected: 11 tests pass; suite ≥ 469.

---

## Task 3: Endpoints + chat tool

**Files:** `api/routers/journal_two.py`, `api/services/journal_two/coach_chat_tools.py` + test.

- [ ] **Step 1: Add 2 endpoints**

```python
@router.get("/accounts/{account_id}/coach/interventions/active")
def list_active_interventions(
    account_id: str,
    evaluate: bool = True,
    user: dict = Depends(get_current_user),
):
    from api.services.journal_two import interventions as iv
    if evaluate:
        return {"interventions": iv.evaluate_interventions(
            user_id=user["id"], account_id=account_id,
        )}
    return {"interventions": iv.list_active(
        user_id=user["id"], account_id=account_id,
    )}


@router.post("/accounts/{account_id}/coach/interventions/{intervention_id}/dismiss")
def dismiss_intervention(
    account_id: str,
    intervention_id: str,
    user: dict = Depends(get_current_user),
):
    from api.services.journal_two import interventions as iv
    n = iv.dismiss_intervention(intervention_id=intervention_id, user_id=user["id"])
    if n == 0:
        raise HTTPException(status_code=404, detail="Intervention not found")
    return {"ok": True}
```

- [ ] **Step 2: Add `check_active_interventions` chat tool**

In `coach_chat_tools.py`:

```python
def _exec_check_active_interventions(*, user_id, account_id, args, conn=None) -> dict:
    from api.services.journal_two import interventions as iv
    return {"interventions": iv.list_active(
        user_id=user_id, account_id=account_id, conn=conn,
    )}


TOOLS.update({
    "check_active_interventions": {
        "name": "check_active_interventions",
        "description": "Check which Compass intervention rules are currently active (e.g., rapid_fire_trading, daily_loss_approach, loss_streak, cooling_off_active). Use this at the start of a turn when the trader seems to be making decisions under pressure or asks 'should I take this?'.",
        "requires_confirm": False,
        "executor": _exec_check_active_interventions,
        "input_schema": {"type": "object", "properties": {}},
    },
})
```

- [ ] **Step 3: Add a chat-tool test**

```python
def test_check_active_interventions_returns_active_list(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    from api.services.journal_two import interventions as iv
    acc = _seed_account(db_conn)
    db_conn.execute(
        "UPDATE j2_accounts SET account_size = 100000, daily_loss_limit_pct = 3, cooling_off_minutes_after_loss = 30 WHERE id = ?",
        (acc["id"],),
    )
    db_conn.commit()
    # Seed a recent loss to trigger cooling_off_active
    now = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
    delta = __import__("datetime").timedelta
    db_conn.execute(
        """INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares,
           entry_price, entry_date, exit_price, exit_date, original_stop, setup,
           notes, pnl_dollar, pnl_percent, r_multiple, hold_days, result,
           context_at_entry, created_at, account_id, mistake_tags, emotion_tags, fees)
           VALUES (?, 'u_chat', ?, 'NVDA', 'Long', 100, 100, ?, 95, ?, 99,
           'Pullback', NULL, -200, -0.2, -1.0, 0, 'Loss', '{}', ?, ?, '[]', '[]', 0)""",
        (str(uuid.uuid4()), str(uuid.uuid4()),
         (now - delta(minutes=10)).isoformat(),
         (now - delta(minutes=10)).isoformat(),
         (now - delta(minutes=10)).isoformat(), acc["id"]),
    )
    db_conn.commit()
    iv.evaluate_interventions(user_id="u_chat", account_id=acc["id"], conn=db_conn)
    result = tools.TOOLS["check_active_interventions"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={}, conn=db_conn,
    )
    assert "interventions" in result
    rules = [i["rule"] for i in result["interventions"]]
    assert "cooling_off_active" in rules
```

- [ ] **Step 4: Tests + smoke + commit**

```bash
python -m pytest api/services/journal_two/test_coach_chat_tools.py -q
python -c "from fastapi.testclient import TestClient; from api.main import app; routes = sorted([r.path for r in app.routes if 'interventions' in r.path]); print(routes)"
python -m pytest api/services/journal_two/ -q
git -C C:/Users/Patrick/uct-dashboard add api/routers/journal_two.py api/services/journal_two/coach_chat_tools.py api/services/journal_two/test_coach_chat_tools.py
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-intervention): 2 endpoints + check_active_interventions chat tool"
```

Expected: 1 new chat-tool test; 2 routes; suite green.

---

## Task 4: Frontend hook + banner + tests

**Files:**
- Create `app/src/pages/journal-2-0/hooks/useInterventions.js`
- Create `app/src/pages/journal-2-0/components/InterventionBanner.jsx` + test

- [ ] **Step 1: Create hook**

```js
/**
 * useInterventions — SWR-fetched active interventions, with dismiss action.
 *
 * `evaluate=true` triggers rule evaluation (writes to DB). `evaluate=false`
 * just reads. Default true.
 */
import useSWR from 'swr'
import { useCallback } from 'react'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useInterventions(accountId, { evaluate = true } = {}) {
  const url = accountId
    ? `/api/j2/accounts/${accountId}/coach/interventions/active?evaluate=${evaluate ? 'true' : 'false'}`
    : null
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: true,
    refreshInterval: 60000,   // 1-min light polling — rules can change as trades close
    shouldRetryOnError: false,
  })

  const dismiss = useCallback(async (id) => {
    if (!accountId || !id) return
    await fetch(`/api/j2/accounts/${accountId}/coach/interventions/${id}/dismiss`, {
      method: 'POST', credentials: 'include',
    })
    await mutate()
  }, [accountId, mutate])

  return {
    interventions: data?.interventions ?? [],
    isLoading,
    error,
    dismiss,
    refresh: mutate,
  }
}
```

- [ ] **Step 2: Write failing test**

`InterventionBanner.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import InterventionBanner from './InterventionBanner'

describe('InterventionBanner', () => {
  it('renders nothing when interventions empty', () => {
    const { container } = render(<InterventionBanner interventions={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a danger banner with message', () => {
    render(<InterventionBanner interventions={[{
      id: 'i1', rule: 'daily_loss_approach', severity: 'danger',
      message: 'You\'re down $2500 today — past 75% of your 3% limit.',
    }]} />)
    expect(screen.getByText(/down \$2500/i)).toBeInTheDocument()
  })

  it('renders multiple interventions stacked', () => {
    render(<InterventionBanner interventions={[
      { id: 'i1', rule: 'rapid_fire_trading', severity: 'warning', message: 'Slow down.' },
      { id: 'i2', rule: 'cooling_off_active', severity: 'warning', message: 'Pause please.' },
    ]} />)
    expect(screen.getByText(/Slow down/i)).toBeInTheDocument()
    expect(screen.getByText(/Pause please/i)).toBeInTheDocument()
  })

  it('clicking Dismiss fires onDismiss', async () => {
    const onDismiss = vi.fn()
    const user = userEvent.setup()
    render(<InterventionBanner interventions={[{
      id: 'i1', rule: 'rapid_fire_trading', severity: 'warning', message: 'Hi.',
    }]} onDismiss={onDismiss} />)
    await user.click(screen.getByRole('button', { name: /Dismiss/i }))
    expect(onDismiss).toHaveBeenCalledWith('i1')
  })
})
```

- [ ] **Step 3: Implement `InterventionBanner.jsx`**

```jsx
/**
 * InterventionBanner — renders active Compass interventions as colored banners.
 *
 * Props:
 *   interventions: [{id, rule, severity, message}]
 *   onDismiss?(id): void
 */

const STYLES = {
  info: { bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.5)', icon: 'ℹ️' },
  warning: { bg: 'rgba(201,168,76,0.12)', border: 'rgba(201,168,76,0.55)', icon: '⚠️' },
  danger: { bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.55)', icon: '🛑' },
}

export default function InterventionBanner({ interventions = [], onDismiss }) {
  if (!Array.isArray(interventions) || interventions.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '8px 0' }}>
      {interventions.map((i) => {
        const s = STYLES[i.severity] || STYLES.warning
        return (
          <div key={i.id} style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            padding: '8px 12px', background: s.bg, border: `1px solid ${s.border}`,
            borderRadius: 6,
          }}>
            <span style={{ fontSize: 16, lineHeight: 1.2 }}>{s.icon}</span>
            <div style={{ flex: 1, fontSize: 12, lineHeight: 1.5, color: 'var(--text-bright)' }}>
              <strong style={{ color: 'var(--ut-gold, #c9a84c)', fontSize: 10 }}>🧭 Compass heads-up</strong>
              <div>{i.message}</div>
            </div>
            {onDismiss && (
              <button
                type="button"
                onClick={() => onDismiss(i.id)}
                aria-label="Dismiss"
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--text-muted)', cursor: 'pointer',
                  fontSize: 11, padding: '2px 6px', textDecoration: 'underline',
                }}
              >Dismiss</button>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run tests + build + commit**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npx vitest run src/pages/journal-2-0/components/InterventionBanner.test.jsx
npm run build
git -C C:/Users/Patrick/uct-dashboard add app/src/pages/journal-2-0/hooks/useInterventions.js app/src/pages/journal-2-0/components/InterventionBanner.jsx app/src/pages/journal-2-0/components/InterventionBanner.test.jsx
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-intervention): useInterventions hook + InterventionBanner component"
```

Expected: 4 vitest pass; build OK.

---

## Task 5: Mount in AddPositionModal + CompassTab + push

**Files:** `AddPositionModal.jsx`, `CompassTab.jsx`

- [ ] **Step 1: Mount in AddPositionModal**

Read the file to find the top of the modal body. Add imports + hook + banner at the top of the modal content:

```jsx
import useInterventions from '../hooks/useInterventions'
import InterventionBanner from './InterventionBanner'
// ...
const { interventions, dismiss: dismissIntervention } = useInterventions(accountId)
```

In the modal JSX, immediately at the top of the body (before any form fields):

```jsx
<InterventionBanner
  interventions={interventions}
  onDismiss={dismissIntervention}
/>
```

- [ ] **Step 2: Mount in CompassTab**

Read `app/src/pages/journal-2-0/tabs/CompassTab.jsx`. Add imports + hook + banner ABOVE the chat panel:

```jsx
import useInterventions from '../hooks/useInterventions'
import InterventionBanner from '../components/InterventionBanner'
// ...
const { interventions, dismiss: dismissIntervention } = useInterventions(accountId)
```

In the JSX, immediately at the top of the Compass tab body (above `<CompassChat />`):

```jsx
<InterventionBanner
  interventions={interventions}
  onDismiss={dismissIntervention}
/>
```

- [ ] **Step 3: Build + suite + push**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npm run build
npx vitest run src/pages/journal-2-0/
cd ..
python -m pytest api/services/journal_two/ -q
git -C C:/Users/Patrick/uct-dashboard add app/src/pages/journal-2-0/components/AddPositionModal.jsx app/src/pages/journal-2-0/tabs/CompassTab.jsx
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-intervention): mount InterventionBanner in AddPositionModal + CompassTab"
git -C C:/Users/Patrick/uct-dashboard push origin master
```

Real-Time Intervention is live.

---

## Self-Review Checklist

- 4 rules: rapid_fire / daily_loss_approach / loss_streak / cooling_off_active
- Cooldowns prevent spam (rapid_fire 60min, daily_loss 4hr, loss_streak 2hr, cooling_off auto)
- 11 backend tests pass
- 4 frontend tests pass
- 2 endpoints + 1 chat tool registered
- Banner mounted in AddPositionModal + CompassTab
- All persisted to `j2_interventions`; user-scoped queries
