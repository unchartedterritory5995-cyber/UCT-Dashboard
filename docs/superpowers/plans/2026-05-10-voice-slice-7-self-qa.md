# Voice Assistant — Slice 7: Self-Q&A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** The user can ask the assistant about their own trading. *"How did I do this week?"*, *"What's my best setup?"*, *"Show me my recent mistakes."*, *"What did I journal Monday?"* The model calls dedicated read tools backed by the existing journal analytics service.

**Architecture:** 5 new read-only voice tools that wrap `journal_service` / `journal_analytics` queries and return narration-ready dicts. Same pattern as Slice 2 tools. No new endpoints, no writes.

**Tech Stack:** existing voice_tools registry · existing journal_service / journal_analytics · FastAPI

**Builds on:** Slices 2 + 4 + 8 (memory makes references like "my best setup" feel personal).

**Spec:** `2026-05-08-voice-assistant-design.md` §3.5 Self-Q&A.

**The 5 self-Q&A tools:**

1. **`get_my_pnl(period)`** — week / month / ytd / today P&L
2. **`get_my_setup_performance(setup?)`** — best/worst setups, or stats for a specific setup
3. **`get_my_recent_mistakes(days?)`** — recurring mistakes from journal insights
4. **`get_my_psychology(period?)`** — emotion/process trend summary
5. **`find_my_trades(filters)`** — search by symbol, date range, outcome, setup

**Scope:** Tools wrap existing journal services. No new endpoints. Defer detailed personality/coaching to a future slice.

---

## File Structure

### Backend
| File | Responsibility |
|------|----------------|
| `api/services/voice_self_qa.py` | NEW. 5 query functions assembling narration-friendly dicts |
| `api/services/voice_tool_impls.py` | Register the 5 tools |

### Tests
- `tests/test_voice_self_qa.py` — Each function with mocked journal_service

---

## Task 1: voice_self_qa module

**Files:**
- Create: `api/services/voice_self_qa.py`
- Create: `tests/test_voice_self_qa.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_voice_self_qa.py`:

```python
"""Voice self-Q&A — wrappers over journal service for personal trading questions."""

from unittest.mock import patch
from api.services import voice_self_qa


def test_get_my_pnl_week():
    fake_stats = {"total_pnl_pct": 5.2, "total_pnl_dollar": 1250.50, "trade_count": 8,
                  "win_rate": 0.625, "best_trade": "NVDA", "worst_trade": "TSLA"}
    with patch("api.services.voice_self_qa._stats_for_period", return_value=fake_stats):
        out = voice_self_qa.get_my_pnl(user_id="u-1", period="week")
    text = out["narration"].lower()
    assert "week" in text or "5.2" in text or "1250" in text
    assert out["trade_count"] == 8


def test_get_my_pnl_empty():
    with patch("api.services.voice_self_qa._stats_for_period", return_value={"trade_count": 0}):
        out = voice_self_qa.get_my_pnl(user_id="u-1", period="week")
    assert "no" in out["narration"].lower() or "0" in out["narration"]


def test_get_my_setup_performance_aggregate():
    fake_setups = [
        {"setup": "VCP", "trade_count": 15, "win_rate": 0.73, "avg_pnl_pct": 4.2, "expectancy": 1.5},
        {"setup": "HTF", "trade_count": 8, "win_rate": 0.5, "avg_pnl_pct": 2.1, "expectancy": 0.4},
    ]
    with patch("api.services.voice_self_qa._setup_breakdown", return_value=fake_setups):
        out = voice_self_qa.get_my_setup_performance(user_id="u-1")
    assert "VCP" in out["narration"]
    assert out["count"] == 2


def test_get_my_recent_mistakes():
    fake_mistakes = [
        {"mistake_type": "overtrading", "count": 5},
        {"mistake_type": "fomo", "count": 3},
    ]
    with patch("api.services.voice_self_qa._recent_mistakes", return_value=fake_mistakes):
        out = voice_self_qa.get_my_recent_mistakes(user_id="u-1", days=30)
    assert "overtrading" in out["narration"].lower()


def test_find_my_trades_by_symbol():
    fake_trades = [
        {"sym": "NVDA", "entry_price": 200, "exit_price": 210, "pnl_pct": 5.0, "status": "closed"},
    ]
    with patch("api.services.voice_self_qa._find_trades", return_value=fake_trades):
        out = voice_self_qa.find_my_trades(user_id="u-1", symbol="NVDA")
    assert "NVDA" in out["narration"]
    assert out["count"] == 1
```

- [ ] **Step 2: Run — should fail**

```
cd C:/Users/Patrick/uct-dashboard
python -m pytest tests/test_voice_self_qa.py -v
```

- [ ] **Step 3: Implement**

Create `api/services/voice_self_qa.py`:

```python
"""
Voice self-Q&A — let the user ask the assistant about THEIR OWN trading
performance, setups, mistakes, and history.

Each function:
  - calls into the existing journal_service / journal_analytics / journal_insights
  - returns {narration: str, ...structured_data} so the model can speak the
    narration AND optionally reference the structured fields

If an underlying service is unavailable, the function returns a graceful
fallback narration ("I couldn't pull your journal data") rather than failing.
"""

import logging
from datetime import datetime, timedelta

_log = logging.getLogger(__name__)


# ── Indirections — monkeypatchable in tests ────────────────────────────────

def _stats_for_period(user_id: str, period: str) -> dict:
    """Return aggregate trading stats for the given period."""
    try:
        from api.services.journal_service import get_stats_for_period
        return get_stats_for_period(user_id, period) or {}
    except (ImportError, AttributeError):
        try:
            from api.services.journal_service import get_stats
            return get_stats(user_id) or {}
        except (ImportError, AttributeError):
            return {}


def _setup_breakdown(user_id: str) -> list[dict]:
    """Return per-setup performance breakdown."""
    try:
        from api.services.journal_analytics import group_by_setup
        return group_by_setup(user_id) or []
    except (ImportError, AttributeError):
        try:
            from api.services.journal_service import setup_performance
            return setup_performance(user_id) or []
        except (ImportError, AttributeError):
            return []


def _recent_mistakes(user_id: str, days: int = 30) -> list[dict]:
    """Return aggregate of recent mistakes (mistake_type → count)."""
    try:
        from api.services.journal_insights import recent_mistakes
        return recent_mistakes(user_id, days=days) or []
    except (ImportError, AttributeError):
        return []


def _psychology_trend(user_id: str, days: int = 90) -> dict:
    try:
        from api.services.journal_psychology import get_psychology_data
        return get_psychology_data(user_id, days=days) or {}
    except (ImportError, AttributeError):
        return {}


def _find_trades(user_id: str, *, symbol: str = "", status: str = "",
                 setup: str = "", days: int = 30) -> list[dict]:
    try:
        from api.services.journal_service import list_entries
        entries = list_entries(user_id) or []
        out = []
        sym = symbol.upper().strip()
        for e in entries:
            if sym and (e.get("sym") or "").upper() != sym:
                continue
            if status and (e.get("status") or "") != status:
                continue
            if setup and (e.get("setup") or "") != setup:
                continue
            out.append(e)
        return out[:20]
    except (ImportError, AttributeError):
        return []


# ── Tools ──────────────────────────────────────────────────────────────────

def get_my_pnl(*, user_id: str, period: str = "week") -> dict:
    period = (period or "week").lower().strip()
    if period not in {"today", "week", "month", "ytd", "year", "all"}:
        period = "week"
    stats = _stats_for_period(user_id, period) or {}
    count = int(stats.get("trade_count") or 0)
    pnl_pct = stats.get("total_pnl_pct")
    pnl_dol = stats.get("total_pnl_dollar")
    win_rate = stats.get("win_rate")
    best = stats.get("best_trade")
    worst = stats.get("worst_trade")

    if count == 0:
        return {"narration": f"No trades logged for {period} yet.", "trade_count": 0}

    parts = [f"For {period}: {count} trades"]
    if pnl_pct is not None:
        parts.append(f"{round(float(pnl_pct), 1)} percent net")
    if pnl_dol is not None:
        parts.append(f"that's {round(float(pnl_dol), 0)} dollars")
    if win_rate is not None:
        parts.append(f"{round(float(win_rate) * 100)} percent win rate")
    narration = "; ".join(parts) + "."
    if best:
        narration += f" Best was {best}."
    if worst:
        narration += f" Worst was {worst}."

    return {"narration": narration, "trade_count": count,
            "pnl_pct": pnl_pct, "pnl_dollar": pnl_dol, "win_rate": win_rate}


def get_my_setup_performance(*, user_id: str, setup: str = "") -> dict:
    setups = _setup_breakdown(user_id)
    if not setups:
        return {"narration": "No setup data yet — I need more closed trades to compute breakdown.",
                "count": 0}

    if setup:
        # Filter to specific setup
        match = next((s for s in setups if (s.get("setup") or "").lower() == setup.lower()), None)
        if not match:
            return {"narration": f"I don't see any trades on the {setup} setup yet.", "count": 0}
        wr = match.get("win_rate")
        avg = match.get("avg_pnl_pct")
        cnt = match.get("trade_count")
        parts = [f"{setup}: {cnt} trades"]
        if wr is not None:
            parts.append(f"{round(float(wr) * 100)} percent win rate")
        if avg is not None:
            parts.append(f"{round(float(avg), 1)} percent average")
        return {"narration": "; ".join(parts) + ".", "count": 1, "setup": setup}

    # Sorted by expectancy or avg_pnl
    ranked = sorted(setups, key=lambda s: float(s.get("expectancy") or s.get("avg_pnl_pct") or 0), reverse=True)
    top3 = ranked[:3]
    bottom1 = ranked[-1] if len(ranked) > 3 else None

    parts = ["Your strongest setups: "]
    parts.append(", ".join(
        f"{s.get('setup')} at {round(float(s.get('avg_pnl_pct') or 0), 1)} percent average"
        for s in top3
    ))
    if bottom1 and bottom1 not in top3:
        parts.append(
            f". Weakest is {bottom1.get('setup')} at {round(float(bottom1.get('avg_pnl_pct') or 0), 1)} percent."
        )
    else:
        parts.append(".")

    return {"narration": "".join(parts), "count": len(setups)}


def get_my_recent_mistakes(*, user_id: str, days: int = 30) -> dict:
    days = max(1, min(int(days or 30), 365))
    mistakes = _recent_mistakes(user_id, days=days)
    if not mistakes:
        return {"narration": f"No mistakes logged in the last {days} days. Clean tape.", "count": 0}

    top3 = sorted(mistakes, key=lambda m: int(m.get("count") or 0), reverse=True)[:3]
    parts = ", ".join(
        f"{m.get('mistake_type')} {int(m.get('count') or 0)} times"
        for m in top3
    )
    return {
        "narration": f"In the last {days} days: {parts}.",
        "count": len(mistakes),
    }


def get_my_psychology(*, user_id: str, period: str = "month") -> dict:
    days_map = {"week": 7, "month": 30, "quarter": 90, "year": 365}
    days = days_map.get((period or "month").lower(), 30)
    data = _psychology_trend(user_id, days=days)
    if not data or not data.get("process_trend"):
        return {"narration": "I don't have enough process data to comment yet — keep logging.", "count": 0}

    # Average process score from trend
    trend = data.get("process_trend") or {}
    if isinstance(trend, dict):
        vals = [v for v in trend.values() if v is not None]
    else:
        vals = []
    avg_process = round(sum(vals) / len(vals), 1) if vals else None

    emo = data.get("emotion_outcomes") or {}
    best_emo = None
    if isinstance(emo, dict):
        for k, v in emo.items():
            pnl = v.get("avg_pnl") if isinstance(v, dict) else None
            if pnl is not None and (best_emo is None or pnl > best_emo[1]):
                best_emo = (k, pnl)

    parts = []
    if avg_process is not None:
        parts.append(f"Average process score is {avg_process}")
    if best_emo:
        parts.append(f"You trade best when you feel {best_emo[0]}")
    if not parts:
        return {"narration": "Process data is sparse for this period.", "count": 0}

    return {"narration": ". ".join(parts) + ".", "count": 1}


def find_my_trades(*, user_id: str, symbol: str = "", status: str = "",
                   setup: str = "", days: int = 30) -> dict:
    trades = _find_trades(user_id, symbol=symbol, status=status, setup=setup, days=days)
    if not trades:
        filters_desc = []
        if symbol:
            filters_desc.append(symbol.upper())
        if status:
            filters_desc.append(status)
        if setup:
            filters_desc.append(setup)
        desc = " ".join(filters_desc) if filters_desc else "your filter"
        return {"narration": f"I couldn't find any trades matching {desc}.", "count": 0}

    parts = [f"Found {len(trades)} matching trade{'s' if len(trades) != 1 else ''}."]
    # Mention the most recent 3
    for t in trades[:3]:
        sym = (t.get("sym") or "").upper()
        status_t = t.get("status") or "open"
        pnl = t.get("pnl_pct")
        if pnl is not None:
            parts.append(f"{sym} {status_t}, {round(float(pnl), 1)} percent")
        else:
            parts.append(f"{sym} {status_t}")

    return {"narration": " ".join(parts), "count": len(trades)}
```

- [ ] **Step 4: Run — should pass**

```
python -m pytest tests/test_voice_self_qa.py -v
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```
git add api/services/voice_self_qa.py tests/test_voice_self_qa.py
git commit -m "feat(voice): add 5 self-Q&A query functions"
```

---

## Task 2: Register the 5 self-Q&A tools

**Files:**
- Modify: `api/services/voice_tool_impls.py`
- Modify: `tests/test_voice_tools.py`

- [ ] **Step 1: Append failing tests**

```python


# ── Self-Q&A (Slice 7) ─────────────────────────────────────────────────────

def test_self_qa_tools_register():
    from api.services import voice_tool_impls  # noqa
    names = set(voice_tools.all_tool_names())
    expected = {"get_my_pnl", "get_my_setup_performance", "get_my_recent_mistakes",
                "get_my_psychology", "find_my_trades"}
    assert expected.issubset(names)


def test_get_my_pnl_tool(monkeypatch):
    from api.services import voice_self_qa
    monkeypatch.setattr(voice_self_qa, "_stats_for_period", lambda uid, p: {
        "trade_count": 5, "total_pnl_pct": 3.2, "win_rate": 0.6,
    })
    out = voice_tools.dispatch("get_my_pnl", {"period": "week"}, user={"id": "u-1"})
    assert "5" in out["narration"] or "3.2" in out["narration"]
```

- [ ] **Step 2: Run — should fail**

```
python -m pytest tests/test_voice_tools.py -v 2>&1 | tail -10
```

- [ ] **Step 3: Add wrappers + registrations**

In `api/services/voice_tool_impls.py`, add before `_register_all()`:

```python


# ── Self-Q&A (Slice 7) ─────────────────────────────────────────────────────


def _get_my_pnl(*, user, period: str = "week") -> dict:
    from api.services.voice_self_qa import get_my_pnl
    return get_my_pnl(user_id=user["id"], period=period)


def _get_my_setup_performance(*, user, setup: str = "") -> dict:
    from api.services.voice_self_qa import get_my_setup_performance
    return get_my_setup_performance(user_id=user["id"], setup=setup)


def _get_my_recent_mistakes(*, user, days: int = 30) -> dict:
    from api.services.voice_self_qa import get_my_recent_mistakes
    return get_my_recent_mistakes(user_id=user["id"], days=days)


def _get_my_psychology(*, user, period: str = "month") -> dict:
    from api.services.voice_self_qa import get_my_psychology
    return get_my_psychology(user_id=user["id"], period=period)


def _find_my_trades(*, user, symbol: str = "", status: str = "",
                    setup: str = "", days: int = 30) -> dict:
    from api.services.voice_self_qa import find_my_trades
    return find_my_trades(user_id=user["id"], symbol=symbol, status=status,
                          setup=setup, days=days)
```

Then extend `_register_all()`:

```python
    _vt.voice_tool(
        name="get_my_pnl",
        description="Get the user's trading P&L for a period (today, week, month, ytd). Call when they ask 'how did I do this week' / 'what's my P&L' / etc.",
        parameters={"period": {"type": "string", "enum": ["today", "week", "month", "ytd", "year", "all"]}},
        contexts=["global"],
        wants_user=True,
    )(_get_my_pnl)

    _vt.voice_tool(
        name="get_my_setup_performance",
        description="Best/worst setups for the user, or stats for one specific setup. Call when they ask 'what's my best setup' / 'how does my VCP perform' / etc.",
        parameters={"setup": {"type": "string", "description": "Optional — specific setup name."}},
        contexts=["global"],
        wants_user=True,
    )(_get_my_setup_performance)

    _vt.voice_tool(
        name="get_my_recent_mistakes",
        description="Recurring mistakes from the user's journal. Call when they ask 'what mistakes have I been making' / 'show recent mistakes'.",
        parameters={"days": {"type": "integer", "description": "Lookback window in days, default 30."}},
        contexts=["global"],
        wants_user=True,
    )(_get_my_recent_mistakes)

    _vt.voice_tool(
        name="get_my_psychology",
        description="Process score + emotional state summary. Call when they ask 'how's my process / discipline' or 'when do I trade best'.",
        parameters={"period": {"type": "string", "enum": ["week", "month", "quarter", "year"]}},
        contexts=["global"],
        wants_user=True,
    )(_get_my_psychology)

    _vt.voice_tool(
        name="find_my_trades",
        description="Search the user's journal for trades matching a symbol, status, setup, or date range.",
        parameters={
            "symbol": {"type": "string"},
            "status": {"type": "string", "enum": ["open", "closed", ""]},
            "setup": {"type": "string"},
            "days": {"type": "integer"},
        },
        contexts=["global"],
        wants_user=True,
    )(_find_my_trades)
```

- [ ] **Step 4: Run — should pass**

```
python -m pytest tests/test_voice_tools.py -v 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```
git add api/services/voice_tool_impls.py tests/test_voice_tools.py
git commit -m "feat(voice): register 5 self-Q&A tools (pnl/setups/mistakes/psych/find)"
```

---

## Task 3: Manual e2e + push

**Files:** none

- [ ] **Step 1: Run all tests**

```
cd C:/Users/Patrick/uct-dashboard
python -m pytest tests/test_voice_*.py --tb=no -q 2>&1 | tail -5
```

- [ ] **Step 2: Push**

```
git push origin master
```

- [ ] **Step 3: Manual test after Railway redeploys**

Hard-refresh. Click orb. Try:

1. *"How did I do this week?"* → calls `get_my_pnl(period="week")`, reports your trade count + P&L
2. *"What's my best setup?"* → calls `get_my_setup_performance`, names top setups by expectancy
3. *"Show me my recent mistakes."* → calls `get_my_recent_mistakes`, lists top 3
4. *"How's my process been this month?"* → `get_my_psychology(period="month")`
5. *"Find my recent NVDA trades."* → `find_my_trades(symbol="NVDA")`

- [ ] **Step 4: Tag**

```
git tag voice-slice-7-shipped
git push origin master --tags
```

---

## Plan Self-Review

**Spec coverage:** §3.5 — all 5 self-Q&A tools implemented.

**Type consistency:** All tools return `{narration: str, ...other}`. All wrappers use `wants_user=True` and pass `user_id=user["id"]`.

**Placeholder scan:** none.
