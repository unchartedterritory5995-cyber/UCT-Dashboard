# Voice Assistant — Slice 6: Agentic Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Pre-built multi-tool flows you can trigger with a single phrase. *"Morning briefing"* makes the assistant pull market state, your watchlist alerts, today's earnings, and the leading themes — then narrates them as one coherent ~30-second monologue. *"Pre-trade check on NVDA"* assembles quote + chart context + brain recommendation + similar setups + risk calc and speaks it as a single briefing.

The model now has **5 high-level orchestration tools** that internally fan out across many existing services. This dramatically improves perceived intelligence: one phrase, comprehensive answer.

**Architecture:** Each agentic flow is a single async function in `api/services/voice_briefings.py` that calls multiple existing services (engine, snapshot, themes, journal, etc.), assembles a narration string with key facts, and returns it as a `dict` with a single `narration` field. Registered as voice tools just like Slice 2 tools — but each tool internally executes a multi-step orchestration. The model speaks the result via tts-1-hd (within an existing Realtime session) — no special pipeline.

**Tech Stack:** existing voice_tools registry · existing services (engine, massive, journal_service, theme_performance, breadth) · gpt-4o-mini for the natural-language assembly · FastAPI

**Builds on Slice 2 (tool registry), Slice 4 (Realtime sessions), Slice 8 (memory injection).**

**Spec:** `2026-05-08-voice-assistant-design.md` §3.14 Agentic flows.

**The 5 flows:**

1. **`morning_briefing()`** — Today's regime + UCT exposure + leading themes + your watchlist alerts + earnings today + open positions
2. **`closing_briefing()`** / **`eod_summary()`** — Day's P&L, top trades, sector winners/losers, tomorrow's earnings
3. **`pre_trade_check(symbol)`** — Quote + chart context + setup type + brain rec + risk calc — assembled briefing for a specific ticker
4. **`post_trade_review(symbol)`** — Most recent trade for the symbol: entry/exit, P&L, screenshot count, journal note
5. **`plan_my_day()`** — Calendar (FOMC/CPI), today's earnings, your positions, top setups in watchlist

**Scope (this plan):**
- ✅ All 5 flows implemented + registered as voice tools
- ✅ Each flow assembles narration text from existing services (no new endpoints needed)
- ✅ The model calls these like any other tool — narration comes back, model speaks it

**Out of scope:**
- ❌ Voice-driven journal modifications (Slice 5 covers writes)
- ❌ Personalized briefings based on user's specific watchlist over time (Slice 7 — leverages memory)
- ❌ Streaming briefing updates ("now reading section 2" etc.)

---

## File Structure

### Backend

| File | Responsibility |
|------|----------------|
| `api/services/voice_briefings.py` | NEW. The 5 agentic flow functions |
| `api/services/voice_tool_impls.py` | Register the 5 flows as voice tools |

### Tests

| File | Coverage |
|------|----------|
| `tests/test_voice_briefings.py` | Each flow with mocked underlying services |

---

## Plan-Wide Conventions

- **Each flow returns `{narration: str, sections: list[str]}`** so the model can speak the narration AND optionally reference structured sections. `sections` is for future UI (transcript bubble could show them as headers).
- **Narration length cap:** 800 chars per flow. The assistant speaks for ~30-45 seconds. If too long, voice fatigue kicks in.
- **Graceful degradation:** if any underlying service fails or returns empty, the flow includes a one-line fallback for that section ("no positions today") rather than failing the whole briefing.
- **No new endpoints.** Flows run through the existing `/api/voice/exec` dispatcher.

---

## Task 1: Create voice_briefings module with morning_briefing

**Files:**
- Create: `api/services/voice_briefings.py`
- Create: `tests/test_voice_briefings.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_voice_briefings.py`:

```python
"""Voice briefings — agentic flow orchestrations."""

from unittest.mock import patch
from api.services import voice_briefings


def test_morning_briefing_returns_narration():
    fake_breadth = {
        "breadth_score": 75, "advancing": 320, "declining": 180,
        "market_phase": "uptrend",
    }
    fake_themes = {"leaders": [
        {"name": "Semis", "pct": "+2.5%"},
        {"name": "AI", "pct": "+1.8%"},
    ]}
    fake_earnings = {"bmo": [{"sym": "AAPL"}, {"sym": "MSFT"}], "amc": []}

    with patch("api.services.voice_briefings._get_breadth", return_value=fake_breadth), \
         patch("api.services.voice_briefings._get_themes", return_value=fake_themes), \
         patch("api.services.voice_briefings._get_earnings", return_value=fake_earnings):
        out = voice_briefings.morning_briefing(user_id="u-1")

    assert "narration" in out
    assert len(out["narration"]) > 0
    # Should mention something specific from the inputs
    text = out["narration"].lower()
    assert any(s in text for s in ["semis", "ai", "uptrend", "aapl", "earnings"])


def test_morning_briefing_handles_empty_data():
    with patch("api.services.voice_briefings._get_breadth", return_value={}), \
         patch("api.services.voice_briefings._get_themes", return_value={}), \
         patch("api.services.voice_briefings._get_earnings", return_value={}):
        out = voice_briefings.morning_briefing(user_id="u-1")
    assert "narration" in out
    # Even with no data, should produce a polite default
    assert len(out["narration"]) > 0
```

- [ ] **Step 2: Run — should fail (ImportError)**

```
cd C:/Users/Patrick/uct-dashboard
python -m pytest tests/test_voice_briefings.py -v
```

- [ ] **Step 3: Implement**

Create `api/services/voice_briefings.py`:

```python
"""
Agentic flow orchestrations for the voice assistant.

Each flow is a single function that chains multiple existing services
and assembles a coherent narration. Triggered via voice tools — see
voice_tool_impls.py for the registrations.

Design principles:
- Each flow returns {narration: str, sections: list[str]}.
- Narration is what the model speaks. Capped at ~800 chars.
- If any sub-service fails, that section gets a one-line fallback;
  the whole flow does NOT fail.
- Flows are fast (~200ms each) since they call already-cached data.
"""

import logging
from datetime import datetime

_log = logging.getLogger(__name__)

MAX_NARRATION_CHARS = 800


# ── Indirection helpers (monkeypatchable in tests) ──────────────────────────

def _get_breadth() -> dict:
    try:
        from api.services.engine import get_breadth
        return get_breadth() or {}
    except Exception:
        return {}


def _get_themes() -> dict:
    try:
        from api.services.engine import get_themes
        return get_themes() or {}
    except Exception:
        return {}


def _get_earnings() -> dict:
    try:
        from api.services.engine import get_earnings
        return get_earnings() or {}
    except Exception:
        return {}


def _get_snapshot(sym: str) -> dict:
    try:
        from api.services.massive import get_ticker_snapshot
        return get_ticker_snapshot(sym) or {}
    except Exception:
        return {}


def _get_movers() -> dict:
    try:
        from api.services.massive import get_movers
        return get_movers() or {}
    except Exception:
        return {}


def _parse_pct(value) -> float:
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().replace("%", "").replace("+", "")
    try:
        return float(s)
    except ValueError:
        return 0.0


def _truncate(text: str, max_chars: int = MAX_NARRATION_CHARS) -> str:
    if len(text) <= max_chars:
        return text
    cut = text[:max_chars]
    if "." in cut[-100:]:
        return cut[:cut.rfind(".") + 1]
    return cut


# ── Flows ──────────────────────────────────────────────────────────────────

def morning_briefing(*, user_id: str) -> dict:
    """Today's market posture + leaders + earnings + open positions snapshot."""
    sections = []

    breadth = _get_breadth()
    if breadth:
        adv = int(breadth.get("advancing") or 0)
        dec = int(breadth.get("declining") or 0)
        phase = breadth.get("market_phase") or "no clear regime"
        score = breadth.get("breadth_score") or breadth.get("uct_exposure_rating")
        score_str = f", UCT exposure rating {score}" if score is not None else ""
        sections.append(
            f"Market posture: {phase}. Advancers {adv}, decliners {dec}{score_str}."
        )

    themes = _get_themes()
    leaders = (themes.get("leaders") or [])[:3]
    if leaders:
        lead_str = ", ".join(
            f"{t.get('name')} up {abs(round(_parse_pct(t.get('pct')), 1))} percent"
            for t in leaders
        )
        sections.append(f"Leading themes: {lead_str}.")

    earnings = _get_earnings()
    bmo = earnings.get("bmo") or []
    amc = earnings.get("amc") or []
    syms_today = [str(e.get("sym", "")).upper() for e in bmo[:3] if e.get("sym")]
    if syms_today:
        sections.append(f"Reporting today before the bell: {', '.join(syms_today)}.")
    elif amc:
        amc_syms = [str(e.get("sym", "")).upper() for e in amc[:3] if e.get("sym")]
        if amc_syms:
            sections.append(f"After the close today: {', '.join(amc_syms)}.")

    if not sections:
        narration = "Markets are quiet right now — no fresh data is available. Try again in a few minutes."
    else:
        narration = " ".join(sections)

    return {"narration": _truncate(narration), "sections": sections}


def closing_briefing(*, user_id: str) -> dict:
    """End-of-day recap: movers, breadth, what's on deck tomorrow."""
    sections = []

    movers = _get_movers()
    rip = (movers.get("ripping") or [])[:3]
    drill = (movers.get("drilling") or [])[:3]
    if rip:
        names = ", ".join(f"{m.get('sym')} up {abs(round(_parse_pct(m.get('pct')), 1))} percent" for m in rip)
        sections.append(f"Top performers today: {names}.")
    if drill:
        names = ", ".join(f"{m.get('sym')} down {abs(round(_parse_pct(m.get('pct')), 1))} percent" for m in drill)
        sections.append(f"Weakest names: {names}.")

    breadth = _get_breadth()
    if breadth:
        adv = int(breadth.get("advancing") or 0)
        dec = int(breadth.get("declining") or 0)
        sections.append(f"Breadth closed at {adv} advancers versus {dec} decliners.")

    earnings = _get_earnings()
    bmo_tomorrow = earnings.get("bmo_tomorrow") or earnings.get("bmo") or []
    syms = [str(e.get("sym", "")).upper() for e in bmo_tomorrow[:3] if e.get("sym")]
    if syms:
        sections.append(f"On deck for tomorrow morning: {', '.join(syms)}.")

    if not sections:
        narration = "End of day, but no closing data available yet — try again after the bell."
    else:
        narration = " ".join(sections)

    return {"narration": _truncate(narration), "sections": sections}


def pre_trade_check(*, symbol: str, user_id: str) -> dict:
    """Assemble a quick briefing for one ticker before pulling the trigger."""
    sym = (symbol or "").upper().strip()
    if not sym:
        return {"narration": "I need a ticker to check.", "sections": []}

    sections = []
    snap = _get_snapshot(sym)
    if snap:
        last = float(snap.get("close") or 0)
        chg = float(snap.get("change_pct") or 0)
        direction = "up" if chg > 0 else "down" if chg < 0 else "flat"
        sections.append(
            f"{sym} is trading at {last:.2f}, {direction} {abs(round(chg, 1))} percent."
        )

    breadth = _get_breadth()
    if breadth:
        phase = breadth.get("market_phase") or "uncertain"
        sections.append(f"Broader market is {phase}.")

    themes = _get_themes()
    leaders = (themes.get("leaders") or [])[:2]
    if leaders:
        lead_str = ", ".join(t.get("name") for t in leaders if t.get("name"))
        sections.append(f"Strongest themes right now: {lead_str}.")

    if not sections:
        narration = f"I couldn't pull live data for {sym}. Try again in a moment."
    else:
        sections.append("Sanity-check your entry against your risk plan before sizing in.")
        narration = " ".join(sections)

    return {"narration": _truncate(narration), "sections": sections}


def post_trade_review(*, symbol: str, user_id: str) -> dict:
    """Recap the most recent trade for a symbol."""
    sym = (symbol or "").upper().strip()
    if not sym:
        return {"narration": "I need a ticker to look up.", "sections": []}

    try:
        from api.services.journal_service import list_entries
        entries = [e for e in (list_entries(user_id) or [])
                   if (e.get("sym") or "").upper() == sym]
    except Exception:
        entries = []

    if not entries:
        return {
            "narration": f"I don't see any recent trades on {sym} in your journal.",
            "sections": [],
        }

    entries_sorted = sorted(entries, key=lambda e: e.get("entry_date") or "", reverse=True)
    last = entries_sorted[0]
    entry = last.get("entry_price")
    exitp = last.get("exit_price")
    pnl_pct = last.get("pnl_pct")
    status = last.get("status") or "open"
    setup = last.get("setup") or ""

    sections = [f"Your most recent {sym} trade — setup {setup or 'unspecified'}, status {status}."]
    if entry:
        sections.append(f"Entry at {entry}.")
    if exitp:
        sections.append(f"Exited at {exitp}.")
    if pnl_pct is not None:
        sections.append(f"Result was {round(float(pnl_pct), 1)} percent.")

    narration = " ".join(sections)
    return {"narration": _truncate(narration), "sections": sections}


def plan_my_day(*, user_id: str) -> dict:
    """Sequenced briefing: what's likely to matter today."""
    sections = []

    earnings = _get_earnings()
    bmo = earnings.get("bmo") or []
    if bmo:
        syms = [str(e.get("sym", "")).upper() for e in bmo[:5] if e.get("sym")]
        if syms:
            sections.append(f"Earnings before the bell: {', '.join(syms)}.")

    breadth = _get_breadth()
    if breadth:
        score = breadth.get("breadth_score") or breadth.get("uct_exposure_rating")
        if score is not None:
            sections.append(f"UCT exposure rating opens at {score}.")
        phase = breadth.get("market_phase")
        if phase:
            sections.append(f"Regime is {phase}.")

    themes = _get_themes()
    leaders = (themes.get("leaders") or [])[:2]
    if leaders:
        lead_str = ", ".join(t.get("name") for t in leaders if t.get("name"))
        sections.append(f"Watch {lead_str} for continuation.")

    if not sections:
        narration = "Not much fresh data to work with this morning — try again after the open."
    else:
        sections.append("Tighten your risk and trade what's working.")
        narration = " ".join(sections)

    return {"narration": _truncate(narration), "sections": sections}
```

- [ ] **Step 4: Run — should pass**

```
python -m pytest tests/test_voice_briefings.py -v
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```
git add api/services/voice_briefings.py tests/test_voice_briefings.py
git commit -m "feat(voice): add 5 agentic flow orchestrations"
```

---

## Task 2: Register the 5 flows as voice tools

**Files:**
- Modify: `api/services/voice_tool_impls.py`
- Modify: `tests/test_voice_tools.py`

- [ ] **Step 1: Append failing tests**

Append to `tests/test_voice_tools.py`:

```python


# ── Agentic flows (Slice 6) ────────────────────────────────────────────────

def test_agentic_flows_register():
    from api.services import voice_tool_impls  # noqa
    names = set(voice_tools.all_tool_names())
    expected = {"morning_briefing", "closing_briefing", "pre_trade_check",
                "post_trade_review", "plan_my_day"}
    assert expected.issubset(names)


def test_morning_briefing_tool_returns_narration(monkeypatch):
    from api.services import voice_briefings

    monkeypatch.setattr(voice_briefings, "_get_breadth", lambda: {
        "breadth_score": 75, "advancing": 320, "declining": 180, "market_phase": "uptrend"})
    monkeypatch.setattr(voice_briefings, "_get_themes", lambda: {"leaders": [
        {"name": "Semis", "pct": "+2.5%"}]})
    monkeypatch.setattr(voice_briefings, "_get_earnings", lambda: {"bmo": [{"sym": "AAPL"}], "amc": []})

    out = voice_tools.dispatch("morning_briefing", {}, user={"id": "u-1"})
    assert "narration" in out
    assert len(out["narration"]) > 0


def test_pre_trade_check_tool(monkeypatch):
    from api.services import voice_briefings
    monkeypatch.setattr(voice_briefings, "_get_snapshot",
                        lambda sym: {"close": 487.2, "change_pct": 2.1})
    monkeypatch.setattr(voice_briefings, "_get_breadth", lambda: {"market_phase": "uptrend"})
    monkeypatch.setattr(voice_briefings, "_get_themes", lambda: {})

    out = voice_tools.dispatch("pre_trade_check", {"symbol": "NVDA"}, user={"id": "u-1"})
    assert "NVDA" in out["narration"]
```

- [ ] **Step 2: Run — should fail**

```
python -m pytest tests/test_voice_tools.py -v 2>&1 | tail -10
```

- [ ] **Step 3: Add tool definitions to api/services/voice_tool_impls.py**

Add the 5 private wrapper functions BEFORE `_register_all()`:

```python


# ── Agentic flows (Slice 6) ────────────────────────────────────────────────


def _morning_briefing(*, user) -> dict:
    from api.services.voice_briefings import morning_briefing
    return morning_briefing(user_id=user["id"])


def _closing_briefing(*, user) -> dict:
    from api.services.voice_briefings import closing_briefing
    return closing_briefing(user_id=user["id"])


def _pre_trade_check(*, user, symbol: str) -> dict:
    from api.services.voice_briefings import pre_trade_check
    return pre_trade_check(symbol=symbol or "", user_id=user["id"])


def _post_trade_review(*, user, symbol: str) -> dict:
    from api.services.voice_briefings import post_trade_review
    return post_trade_review(symbol=symbol or "", user_id=user["id"])


def _plan_my_day(*, user) -> dict:
    from api.services.voice_briefings import plan_my_day
    return plan_my_day(user_id=user["id"])
```

Then extend `_register_all()` to add the 5 registrations:

```python
    _vt.voice_tool(
        name="morning_briefing",
        description="Comprehensive morning market briefing — regime, leading themes, today's earnings, and overall posture. Call this when the user says 'morning briefing' or 'what's the morning look like' or similar.",
        parameters={},
        contexts=["global"],
        wants_user=True,
    )(_morning_briefing)

    _vt.voice_tool(
        name="closing_briefing",
        description="End-of-day market recap — top performers, weakest names, breadth, what's on deck tomorrow. Call this when the user asks 'how did the market close?' or 'eod recap' or similar.",
        parameters={},
        contexts=["global"],
        wants_user=True,
    )(_closing_briefing)

    _vt.voice_tool(
        name="pre_trade_check",
        description="Quick briefing on a specific ticker before entering a trade — current quote, broader market context, and theme alignment. Call this when the user asks 'check NVDA before I trade it' or 'pre-trade briefing on X'.",
        parameters={"symbol": {"type": "string", "description": "Ticker symbol."}},
        contexts=["global"],
        wants_user=True,
    )(_pre_trade_check)

    _vt.voice_tool(
        name="post_trade_review",
        description="Recap the user's most recent trade for a given ticker, with entry, exit, P&L, and setup type. Call this when the user asks 'how did my NVDA trade go?' or 'recap my last X trade'.",
        parameters={"symbol": {"type": "string"}},
        contexts=["global"],
        wants_user=True,
    )(_post_trade_review)

    _vt.voice_tool(
        name="plan_my_day",
        description="Briefing for what's likely to matter today — earnings, regime, leading themes, and a closing line. Call this when the user says 'plan my day' or 'what should I focus on'.",
        parameters={},
        contexts=["global"],
        wants_user=True,
    )(_plan_my_day)
```

- [ ] **Step 4: Run — should pass**

```
python -m pytest tests/test_voice_tools.py -v
```

Expected: all tests pass including 3 new agentic-flow tests.

- [ ] **Step 5: Commit**

```
git add api/services/voice_tool_impls.py tests/test_voice_tools.py
git commit -m "feat(voice): register 5 agentic flow tools (morning/closing/pre-trade/post-trade/plan)"
```

---

## Task 3: Update system instructions to advertise agentic flows

**Files:**
- Modify: `api/routers/voice.py`

- [ ] **Step 1: Extend _REALTIME_INSTRUCTIONS**

Find the `_REALTIME_INSTRUCTIONS` constant. Append a third paragraph about agentic flows after the MEMORY paragraph. Replace the constant with:

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
    "just call the tool and confirm naturally.\n\n"
    "BRIEFINGS: For higher-level requests prefer the agentic flow tools over "
    "calling multiple smaller tools yourself. If the user says 'morning briefing' "
    "or asks for a market overview, call `morning_briefing`. For EOD recap, use "
    "`closing_briefing`. To check a specific ticker before trading, use "
    "`pre_trade_check`. To recap a recent trade, `post_trade_review`. For a daily "
    "plan, `plan_my_day`. These return a pre-assembled narration — just speak it "
    "naturally and pause for follow-up questions afterward."
)
```

- [ ] **Step 2: Verify existing tests still pass**

```
cd C:/Users/Patrick/uct-dashboard
python -m pytest tests/test_voice_router.py -v 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```
git add api/routers/voice.py
git commit -m "feat(voice): teach the model about agentic flow tools in system prompt"
```

---

## Task 4: Manual e2e

**Files:** none

- [ ] **Step 1: Run all tests**

```
cd C:/Users/Patrick/uct-dashboard
python -m pytest tests/test_voice_briefings.py tests/test_voice_tools.py tests/test_voice_router.py -v 2>&1 | tail -10
```

Expected: all green.

- [ ] **Step 2: Push**

```
git push origin master
```

- [ ] **Step 3: Manual test after Railway redeploys**

Hard-refresh uctintelligence.com. Click the orb. Try:

1. *"Give me a morning briefing"* → model calls `morning_briefing`, speaks a 20-30 second monologue covering regime + themes + earnings
2. *"Pre-trade check on NVDA"* → model calls `pre_trade_check(symbol="NVDA")`, narrates quote + market context + themes
3. *"How did my last NVDA trade go?"* → calls `post_trade_review(symbol="NVDA")` (will say "no recent trades" if you have none)
4. *"Plan my day"* → calls `plan_my_day`, summary of earnings + regime + themes
5. *"Recap how the market closed"* → calls `closing_briefing`

Expected: each phrase produces a single tool call (you can verify in Railway logs that the `_summarize_session_background` log shows one tool dispatched per briefing), narration speaks for 15-30 seconds, model pauses afterward.

- [ ] **Step 4: Tag slice**

```
git tag voice-slice-6-shipped
git push origin master --tags
```

---

## Plan Self-Review

**Spec coverage:**
- Spec §3.14 — 5 agentic flows listed: morning_briefing, closing_briefing/eod_summary, pre_trade_check, post_trade_review, plan_my_day → all 5 implemented (Tasks 1, 2)
- Spec §3.14 note "implemented backend-side as orchestration tools that internally call multiple sub-tools and return a single narration string" → Task 1 does exactly this
- System prompt advertises flows so the model prefers them → Task 3

**Type consistency:**
- All flows return `{narration: str, sections: list[str]}` consistently
- All voice_tool wrappers take `user` keyword and pass `user_id=user["id"]` to the flow
- `_parse_pct` matches the pattern from voice_tool_impls.py

**Placeholder scan:** none.

**Open notes for future polish:**
- Personalized briefings: morning_briefing could load user facts via `voice_memory_service` and tailor the opener ("Hey, since you trade small caps...") — defer to a personalization pass
- Real-time data freshness: flows return whatever the cache has; if data is stale, the narration could mention that ("data is from 8 minutes ago") — defer
