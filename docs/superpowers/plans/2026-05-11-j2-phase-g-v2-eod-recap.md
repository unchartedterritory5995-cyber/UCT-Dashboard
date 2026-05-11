# Journal 2.0 Phase G v2 — EOD Recap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkbox syntax.

**Goal:** Ship Compass's second surface — a daily auto-generated EOD recap with multi-day arc detection, server-side hallucination validation, and a strict reflective-question rubric. The recap surfaces in the Compass tab + cross-tab banner; auto-fires at 4:30pm ET via APScheduler; reuses Coach Core.

**Architecture:** Three new modules join the v1 Coach pipeline: `coach_validation.py` (post-generation guardrail + this_weeks_focus extractor), six deterministic multi-day arc detectors in `coach_data_assembler.py`, and a new `assemble_day` builder. `coach.py` grows a `generate_eod_recap` orchestrator with a 1-retry validation loop. EOD summaries feed back into Weekly Review prompt context. No new tables — `j2_coach_outputs.output_type` CHECK already enumerates `eod_recap`.

**Tech Stack:** Python 3.12, FastAPI, SQLite, `anthropic>=0.40.0`, APScheduler (existing), React + Vite + SWR, vitest, pytest.

**Spec reference:** `docs/superpowers/specs/2026-05-11-j2-phase-g-v2-eod-recap-design.md`

---

## File Map

| Path | Action | Role |
|---|---|---|
| `api/services/journal_two/coach_validation.py` | **Create** | `validate_eod_output(body, data)`, `extract_this_weeks_focus(body)`, helper regex extractors |
| `api/services/journal_two/test_coach_validation.py` | **Create** | TDD tests for validator + extractor |
| `api/services/journal_two/coach_prompts.py` | Modify | Append Section 6 to `COMPASS_SYSTEM_PROMPT` (EOD format + reflective-question rubric + 3 good / 3 bad examples). Add `assemble_eod_user_message(data)` |
| `api/services/journal_two/coach_data_assembler.py` | Modify | Add 6 arc-detector helpers + `recent_arcs` aggregator + `assemble_day(user_id, account_id, day_iso, conn)`. Extend `assemble_week` with `weekly_eod_context` retrieval |
| `api/services/journal_two/test_coach_data_assembler.py` | Modify | New tests: arc detectors, `assemble_day` shape + filters, weekly_eod_context |
| `api/services/journal_two/coach.py` | Modify | Add `write_eod_recap` to `AnthropicClient` + `CoachClientProto`. Add `generate_eod_recap` orchestrator with validation+retry. Add `list_eod_recaps`, `get_eod_recap`, `mark_eod_viewed` helpers. Amend `generate_weekly_review` to write structured `this_weeks_focus` to metadata |
| `api/services/journal_two/test_coach.py` | Modify | New EOD tests: idempotency on (account, day), validation-retry path, no-activity skip, this_weeks_focus extracted on weekly write |
| `api/routers/journal_two.py` | Modify | 7 new endpoints under `/coach/eod-recaps/*` |
| `api/main.py` | Modify | Register APScheduler EOD cron job (Mon-Fri 16:30 America/New_York) on the existing scheduler instance |
| `app/src/pages/journal-2-0/lib/coachMarkdown.js` | **Create** | Shared minimal-markdown renderer (extracted from `CompassReview`) |
| `app/src/pages/journal-2-0/components/CompassReview.jsx` | Modify | Import `renderMarkdown` from `lib/coachMarkdown.js` instead of defining inline |
| `app/src/pages/journal-2-0/hooks/useJ2EODRecaps.js` | **Create** | SWR list + generate/regenerate/feedback/forget/markViewed |
| `app/src/pages/journal-2-0/hooks/useJ2UnviewedEOD.js` | **Create** | Returns most-recent unviewed EOD for the banner |
| `app/src/pages/journal-2-0/components/EODRecap.jsx` | **Create** | Single-recap render with feedback chips + validation badge when needed |
| `app/src/pages/journal-2-0/components/EODRecap.test.jsx` | **Create** | Vitest cases |
| `app/src/pages/journal-2-0/components/EODRecapBanner.jsx` | **Create** | Cross-tab "Compass wrapped today's session →" strip |
| `app/src/pages/journal-2-0/tabs/CompassTab.jsx` | Modify | Insert "Daily Recaps" section between weekly CTA and weekly list |
| `app/src/pages/journal-2-0/JournalTwoRoot.jsx` | Modify | Mount `EODRecapBanner` above nested tab bar |

---

## Task 1: Coach validation module + tests

**Files:**
- Create: `api/services/journal_two/coach_validation.py`
- Create: `api/services/journal_two/test_coach_validation.py`

The validator is the foundation of the elite trust contract. TDD it tightly.

- [ ] **Step 1: Write the failing test file**

Create `api/services/journal_two/test_coach_validation.py`:

```python
"""Tests for the post-generation output validator + this_weeks_focus extractor."""
from __future__ import annotations


def _sample_data():
    """Minimal data dict — what assemble_day would produce."""
    return {
        "trader_profile": "",
        "memory": {"recent_eod_summaries": [], "last_weekly_summary": "", "this_weeks_focus": None},
        "today": {
            "date": "2026-05-11",
            "trades": [
                {"symbol": "NVDA", "side": "Long", "pnl_dollar": -140.0, "r_multiple": -1.4,
                 "mistake_tags": ["FOMO"], "emotion_tags": [], "regime": "AMBER",
                 "setup": "Bull Flag"},
                {"symbol": "AAPL", "side": "Long", "pnl_dollar": 420.0, "r_multiple": 2.1,
                 "mistake_tags": [], "emotion_tags": ["calm"], "regime": "AMBER",
                 "setup": "Pullback"},
            ],
            "aggregates": {
                "trade_count": 2, "wins": 1, "losses": 1, "bes": 0,
                "win_rate": 0.5, "avg_r": 0.35,
                "net_pnl_dollar": 280.0, "net_pnl_pct": 0.28,
            },
            "discipline_events": {"risk_cap_breaches": 0, "risk_cap_overrides": 0,
                                  "daily_loss_lockouts": 0, "cooling_off_fires": 1,
                                  "no_trade_window_blocks": 0, "a_plus_taken": 0},
            "open_positions": [],
        },
        "week_to_date": {"range": "2026-05-11 to 2026-05-11", "trade_count": 2,
                         "net_pnl_dollar": 280.0, "wins": 1, "losses": 1},
        "vs_yesterday": {"prior_day_net_pnl_dollar": 0.0},
        "recent_arcs": [],
        "feedback_signals": [],
    }


# ── Numeric grounding ─────────────────────────────────────────────────────────

def test_validator_passes_when_numbers_match_data():
    from api.services.journal_two import coach_validation as cv
    body = (
        "Today the FOMO entry on NVDA cost you 1.4R, while AAPL's clean Pullback "
        "delivered +2.1R for a net +$280. "
        "What was different about your read on AAPL vs NVDA this morning?"
    )
    result = cv.validate_eod_output(body, _sample_data())
    assert result["passed"] is True
    assert result["flags"] == []


def test_validator_flags_invented_r_multiple():
    from api.services.journal_two import coach_validation as cv
    body = (
        "Today the FOMO entry on NVDA cost you 5.9R, while AAPL delivered +2.1R for a net +$280. "
        "What was different about your read on AAPL vs NVDA?"
    )
    result = cv.validate_eod_output(body, _sample_data())
    assert result["passed"] is False
    assert any("5.9R" in f for f in result["flags"])


def test_validator_flags_invented_dollar_amount():
    from api.services.journal_two import coach_validation as cv
    body = (
        "Today's two trades netted +$9,999 on the back of a clean Pullback on AAPL. "
        "What about the Pullback worked today?"
    )
    result = cv.validate_eod_output(body, _sample_data())
    assert result["passed"] is False
    assert any("$9,999" in f or "9999" in f for f in result["flags"])


def test_validator_tolerates_rounding_in_numbers():
    """The validator allows 1-decimal-place tolerance. avg_r=0.35 should accept '+0.4R'."""
    from api.services.journal_two import coach_validation as cv
    body = (
        "Today netted +0.4R on average across the two trades. NVDA was -1.4R, AAPL +2.1R. "
        "What about today's setup picks worked?"
    )
    result = cv.validate_eod_output(body, _sample_data())
    # The "0.4R" rounds from 0.35 in data — should pass.
    assert result["passed"] is True, result["flags"]


# ── Symbol grounding ──────────────────────────────────────────────────────────

def test_validator_flags_invented_ticker():
    from api.services.journal_two import coach_validation as cv
    body = (
        "Today's setup picks were rough — TSLA was the late entry that cost you 1.4R. "
        "AAPL recovered with +2.1R. What's the read on TSLA vs AAPL?"
    )
    result = cv.validate_eod_output(body, _sample_data())
    # TSLA is not in any trade today.
    assert result["passed"] is False
    assert any("TSLA" in f for f in result["flags"])


def test_validator_ignores_common_uppercase_words():
    """Words like 'ET', 'EOD', 'YTD', 'FOMO', 'A' shouldn't trip the ticker check."""
    from api.services.journal_two import coach_validation as cv
    body = (
        "Today by EOD the FOMO entry on NVDA was -1.4R; AAPL recovered with +2.1R for "
        "a net +$280. Looks like A discipline tag is needed. "
        "What was different on the AAPL Pullback?"
    )
    result = cv.validate_eod_output(body, _sample_data())
    assert result["passed"] is True, result["flags"]


# ── Format compliance ─────────────────────────────────────────────────────────

def test_validator_flags_markdown_headers():
    from api.services.journal_two import coach_validation as cv
    body = (
        "## Today's Recap\n\n"
        "NVDA was -1.4R, AAPL +2.1R. "
        "What was different about the Pullback?"
    )
    result = cv.validate_eod_output(body, _sample_data())
    assert result["passed"] is False
    assert any("header" in f.lower() for f in result["flags"])


def test_validator_flags_bullet_points():
    from api.services.journal_two import coach_validation as cv
    body = (
        "Today's takeaways:\n- NVDA was -1.4R\n- AAPL was +2.1R\n"
        "What was different about the Pullback?"
    )
    result = cv.validate_eod_output(body, _sample_data())
    assert result["passed"] is False
    assert any("bullet" in f.lower() for f in result["flags"])


def test_validator_flags_missing_question():
    from api.services.journal_two import coach_validation as cv
    body = (
        "Today the FOMO entry on NVDA cost you 1.4R, while AAPL delivered +2.1R for a net +$280."
    )
    result = cv.validate_eod_output(body, _sample_data())
    assert result["passed"] is False
    assert any("question" in f.lower() for f in result["flags"])


def test_validator_flags_multiple_questions():
    """The reflective question must be the only `?` — multiple questions dilute focus."""
    from api.services.journal_two import coach_validation as cv
    body = (
        "Today's read: was the FOMO entry on NVDA worth it? It cost you 1.4R. AAPL's +2.1R covered. "
        "What about the Pullback worked today?"
    )
    result = cv.validate_eod_output(body, _sample_data())
    assert result["passed"] is False
    assert any("question" in f.lower() for f in result["flags"])


# ── Question rubric (light touch) ─────────────────────────────────────────────

def test_validator_flags_yes_no_question():
    from api.services.journal_two import coach_validation as cv
    body = (
        "Today the FOMO entry on NVDA cost you 1.4R, while AAPL delivered +2.1R. "
        "Did you feel rushed on the NVDA entry?"
    )
    result = cv.validate_eod_output(body, _sample_data())
    assert result["passed"] is False
    assert any("yes/no" in f.lower() or "yes-no" in f.lower() for f in result["flags"])


# ── this_weeks_focus extraction ──────────────────────────────────────────────

def test_extract_this_weeks_focus_standard_header():
    from api.services.journal_two import coach_validation as cv
    weekly_body = (
        "# Week of 2026-05-04 — Compass's Review\n\n"
        "Quiet week.\n\n"
        "## Performance\nNet P&L: +$500\n\n"
        "## This week's focus\n"
        "Skip Pullback setups entirely. You're -3.1R YTD on them.\n"
    )
    focus = cv.extract_this_weeks_focus(weekly_body)
    assert focus is not None
    assert "Skip Pullback" in focus


def test_extract_this_weeks_focus_with_colon():
    from api.services.journal_two import coach_validation as cv
    weekly_body = "## This week's focus:\nFocus content here.\n"
    focus = cv.extract_this_weeks_focus(weekly_body)
    assert focus == "Focus content here."


def test_extract_this_weeks_focus_case_insensitive():
    from api.services.journal_two import coach_validation as cv
    weekly_body = "## THIS WEEK'S FOCUS\nFocus content here.\n"
    focus = cv.extract_this_weeks_focus(weekly_body)
    assert focus == "Focus content here."


def test_extract_this_weeks_focus_returns_none_when_missing():
    from api.services.journal_two import coach_validation as cv
    weekly_body = "# Week\n\nNo focus section here.\n"
    assert cv.extract_this_weeks_focus(weekly_body) is None
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd C:/Users/Patrick/uct-dashboard
python -m pytest api/services/journal_two/test_coach_validation.py -q
```

Expected: ModuleNotFoundError on `coach_validation`.

- [ ] **Step 3: Implement the validator**

Create `api/services/journal_two/coach_validation.py`:

```python
"""
Compass — post-generation output validation + structured-field extraction.

The validator is the elite trust guardrail. The system prompt forbids
hallucination; this module enforces it after the LLM returns. Two
public entry points:

1. validate_eod_output(body, data) — checks an EOD recap body for
   numeric grounding, symbol grounding, format compliance, and a
   light-touch question rubric. Returns {passed: bool, flags: list[str]}.

2. extract_this_weeks_focus(body) — tolerant extractor for the
   structured this_weeks_focus field written at Weekly-Review-write-time.
"""

from __future__ import annotations

import json
import re
from typing import Any


# ── Numeric token extraction ─────────────────────────────────────────────────

_R_MULTIPLE_RE = re.compile(r"(?<![A-Za-z0-9.])([+-]?\d+(?:\.\d+)?)R\b")
_DOLLAR_RE = re.compile(r"(?<![A-Za-z0-9.])(-?\$\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\$\d+(?:\.\d+)?)")
_PERCENT_RE = re.compile(r"(?<![A-Za-z0-9.])([+-]?\d+(?:\.\d+)?)%")

# Words that look like tickers but aren't — common uppercase abbreviations.
_NON_TICKER_WORDS = frozenset({
    "A", "I", "AM", "PM", "ET", "UTC", "EST", "EDT", "PST", "PDT",
    "EOD", "EOM", "YTD", "MTD", "QTD", "TLDR",
    "FOMO", "FOMC", "ATR", "ATM", "OTM", "ITM",
    "API", "URL", "BUY", "SELL", "STOP", "TARGET",
    "WIN", "LOSS", "OPEN", "CLOSE", "ENTRY", "EXIT",
    "RTH", "AH", "PM",
    "USD", "EUR", "GBP", "JPY",
    "OK", "OKAY", "YES", "NO",
    "BE",  # break-even
})

_TICKER_RE = re.compile(r"\b([A-Z]{2,5})\b")


def _strip_sign(token: str) -> str:
    return token.lstrip("+-").lstrip()


def _to_float(token: str) -> float | None:
    """Parse a number string ('+1.4', '-$1,200', '2.4') to float."""
    s = token.replace("$", "").replace(",", "").rstrip("R%").lstrip("+")
    try:
        return float(s)
    except ValueError:
        return None


def _data_numbers(data: dict) -> set[float]:
    """Every numeric value present anywhere in the injected data, as floats.
    Returns a set so we can do rounding-tolerant membership."""
    out: set[float] = set()

    def _add(v: Any) -> None:
        if v is None:
            return
        if isinstance(v, bool):  # bool is int — skip
            return
        if isinstance(v, (int, float)):
            try:
                f = float(v)
                out.add(f)
                # Also add common derivations
                out.add(abs(f))
            except (TypeError, ValueError):
                pass
        elif isinstance(v, (list, tuple)):
            for x in v:
                _add(x)
        elif isinstance(v, dict):
            for x in v.values():
                _add(x)

    _add(data)
    return out


def _data_symbols(data: dict) -> set[str]:
    """All trade/position symbols mentioned in data."""
    out: set[str] = set()
    today = data.get("today") or {}
    for t in today.get("trades") or []:
        s = t.get("symbol")
        if isinstance(s, str):
            out.add(s.upper())
    for p in today.get("open_positions") or []:
        s = p.get("symbol")
        if isinstance(s, str):
            out.add(s.upper())
    return out


def _matches_within_tolerance(claimed: float, data_set: set[float]) -> bool:
    """Allow 1-decimal-place rounding tolerance. e.g. 0.4 matches 0.35; 1.4 matches 1.36-1.44."""
    for v in data_set:
        if abs(claimed - v) <= 0.05:  # half a tenth on each side
            return True
        # Also try rounding both to 1 decimal
        if round(claimed, 1) == round(v, 1):
            return True
    return False


# ── Public validator ─────────────────────────────────────────────────────────

_YES_NO_OPENERS = (
    "did you", "did the", "did your",
    "were you", "were the",
    "is it", "is the", "is that", "is there",
    "are you", "are the", "are those",
    "have you", "has it", "has the",
    "was it", "was the", "was that",
    "will you", "will the",
    "do you", "does it", "does the", "does that",
    "can you", "could you", "should you", "would you",
)


def validate_eod_output(body: str, data: dict) -> dict[str, Any]:
    """Run all checks against an EOD recap output. Returns {passed, flags}."""
    flags: list[str] = []

    if not isinstance(body, str) or not body.strip():
        return {"passed": False, "flags": ["empty body"]}

    # ── A. Numeric grounding
    data_numbers = _data_numbers(data)
    # R-multiples
    for tok in _R_MULTIPLE_RE.findall(body):
        val = _to_float(tok + "R")
        if val is None:
            continue
        if not _matches_within_tolerance(val, data_numbers):
            flags.append(f"unverified R-multiple: {tok}R")
    # Dollar amounts
    for tok in _DOLLAR_RE.findall(body):
        val = _to_float(tok)
        if val is None:
            continue
        if not _matches_within_tolerance(val, data_numbers) and not _matches_within_tolerance(abs(val), data_numbers):
            flags.append(f"unverified dollar amount: {tok}")
    # Percentages
    for tok in _PERCENT_RE.findall(body):
        val = _to_float(tok + "%")
        if val is None:
            continue
        if not _matches_within_tolerance(val, data_numbers):
            flags.append(f"unverified percentage: {tok}%")

    # ── B. Symbol grounding
    data_symbols = _data_symbols(data)
    for tok in _TICKER_RE.findall(body):
        if tok in _NON_TICKER_WORDS:
            continue
        if tok not in data_symbols:
            flags.append(f"unverified symbol: {tok}")

    # ── D. Format compliance
    # Headers (lines starting with #)
    for line in body.splitlines():
        if line.lstrip().startswith("#"):
            flags.append("markdown header present (forbidden in EOD)")
            break
    # Bullet points (lines starting with `- ` or `* `)
    for line in body.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("- ") or stripped.startswith("* "):
            flags.append("bullet point present (forbidden in EOD)")
            break
    # Question count: must be exactly 1
    n_questions = body.count("?")
    if n_questions == 0:
        flags.append("no reflective question (must end with exactly one)")
    elif n_questions > 1:
        flags.append(f"too many questions ({n_questions}); must be exactly one")

    # ── E. Question rubric (light touch — only when there IS exactly one question)
    if n_questions == 1:
        # Find the question sentence
        q_idx = body.index("?")
        # Walk backwards to the start of the question (previous period/newline)
        start = max(body.rfind(".", 0, q_idx), body.rfind("\n", 0, q_idx))
        question = body[start + 1:q_idx + 1].strip().lower()
        for opener in _YES_NO_OPENERS:
            if question.startswith(opener):
                flags.append(f"yes/no question pattern detected ('{opener}...')")
                break

    return {"passed": len(flags) == 0, "flags": flags}


# ── this_weeks_focus extractor ──────────────────────────────────────────────

_FOCUS_HEADER_RE = re.compile(
    r"^\s*##+\s*this\s*week'?s\s*focus\s*:?\s*$",
    re.IGNORECASE | re.MULTILINE,
)


def extract_this_weeks_focus(weekly_body: str) -> str | None:
    """Tolerant extractor for the 'This week's focus' section of a Weekly Review.

    Matches: ## This week's focus / ## This Week's Focus / ## THIS WEEK'S FOCUS,
    with or without a trailing colon. Returns the section's body text up to the
    next ## header or end-of-string. Returns None if not found.
    """
    if not isinstance(weekly_body, str):
        return None
    match = _FOCUS_HEADER_RE.search(weekly_body)
    if match is None:
        return None
    start = match.end()
    # Find the next ## header
    rest = weekly_body[start:]
    next_header = re.search(r"^\s*##+\s", rest, re.MULTILINE)
    end = next_header.start() if next_header else len(rest)
    return rest[:end].strip() or None
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
python -m pytest api/services/journal_two/test_coach_validation.py -q
```

Expected: 12 tests pass.

- [ ] **Step 5: Run full j2 suite**

```bash
python -m pytest api/services/journal_two/ -q
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add api/services/journal_two/coach_validation.py api/services/journal_two/test_coach_validation.py
git commit -m "feat(j2-coach): output validation + this_weeks_focus extractor for Phase G v2"
```

---

## Task 2: System prompt extension + EOD user-message assembler

**Files:**
- Modify: `api/services/journal_two/coach_prompts.py`

- [ ] **Step 1: Append Section 6 to `COMPASS_SYSTEM_PROMPT`**

Open `api/services/journal_two/coach_prompts.py`. The `COMPASS_SYSTEM_PROMPT` constant currently ends with `"You are Compass. Begin when asked.\n"""`. Replace that closing with:

```python
"""\
[... existing prompt content unchanged ...]

## 6. End-of-Day (EOD) Recap output structure

When asked to write an EOD recap (NOT a weekly review), produce a short
conversational note. Different shape, same Compass voice.

### Format rules

- **Length: 200-300 words target, 400 words hard cap.**
- **Prose paragraphs only.** No headers (##/###), no bullet points, no
  emoji, no tables. Pure flowing text.
- **Opening line: the punch line of today.** The single most-notable
  observation. NOT the P&L number unless it's the actual headline.
- **Body: 1-2 specific observations.** Cite trades by symbol when relevant
  ("the late entry on NVDA cost you 1.4R"). Reference mistake or emotion
  tags the user applied. Calibrated language ("looks like", "the data
  suggests").
- **Multi-day arc references** when the `recent_arcs` field is non-empty.
  Weave them in by name. "Today is your third consecutive Bull Flag loss"
  is exactly the kind of pattern reference the user can't get elsewhere.
- **Open-position note**: ONE closing sentence if open positions are held
  overnight. Awareness only — no recommendations. ("You're carrying 3
  overnight — biggest is +1.8R on AAPL; two are flat.")
- **Exactly ONE question mark in the entire output.** This is the
  reflective question at the end. Multiple question marks are forbidden.
- **No "Today's focus" or directive asks.** That's the Weekly Review's
  job. EOD is reflective.

### The reflective question — most-important content

The question must obey this rubric:

1. **MUST reference a specific data point from today** — a trade by
   symbol, a tag, an exit time, a setup, a P&L number, a regime.
2. **MUST NOT be answerable yes/no.** Forbidden openings include "Did
   you...", "Were you...", "Is it...", "Are you...", "Have you...",
   "Was it...", "Do you...", "Can you...", "Should you...", "Would you...".
3. **MUST ask about a pattern across ≥2 data points** — today's trades
   compared to each other, today vs yesterday, today vs the week's focus,
   today vs the user's historical record on this setup. Not a re-
   litigation of a single trade.

**Good examples** (do write questions like these):

  - "What changed between the first NVDA entry that worked and the
    second that gave it back?"
  - "When you sized up after the morning win, what were you assuming
    that the afternoon proved wrong?"
  - "You took two Bull Flags today; the data is now 5 wins and 8 losses
    on that setup this quarter — what's the case for taking the 14th?"
  - "The FOMO tag you put on NVDA — what was different about that trade
    from the Pullback on AAPL where you stayed calm?"

**Bad examples** (do NOT write questions like these):

  - "How did you feel about today?" (generic, no data point)
  - "Did you stick to your plan?" (yes/no-able)
  - "Want to keep trading Bull Flags?" (yes/no-able, no pattern)
  - "What's next?" (no data reference, no pattern)

### Empty-day rule

If the user had zero closed trades AND zero open positions today, you
will not be asked to write a recap. If you ARE asked and the trades list
is empty but open positions exist, write a brief holdings note (~80
words): one observation about the held positions, one reflective question
about the trader's overnight bet. Skip the multi-paragraph body.

### Format-strict mode

The orchestrator runs a server-side validator on your output before
showing it to the user. The validator checks numeric grounding (every
number you cite must appear in the data I gave you), symbol grounding
(every ticker you mention must be in today's trades or open positions),
format compliance (no headers, no bullets, exactly one question mark),
and the yes/no rubric for your reflective question. If the validator
flags anything, you'll get a corrective addendum and one retry. Don't
invent. Don't generalize. Stay in the data.

You are Compass. Begin when asked.
"""
```

(Note: keep all existing prompt sections 1-5 unchanged. Only add Section 6.)

- [ ] **Step 2: Add `assemble_eod_user_message`**

At the bottom of `coach_prompts.py` (after the existing `assemble_user_message` function), add:

```python
def assemble_eod_user_message(*, data: dict[str, Any]) -> str:
    """Build the user-message body for an EOD Recap call.

    `data` is the dict returned by coach_data_assembler.assemble_day(...).
    """
    parts: list[str] = []

    # Header — explicit context that this is an EOD request (not a weekly)
    parts.append("# Task: write today's EOD recap.")
    parts.append(
        "Follow EOD format from Section 6 of the system prompt: conversational "
        "prose, 200-300 words, no headers/bullets, exactly one reflective "
        "question. Don't invent numbers or symbols."
    )

    # Trader Profile
    profile = data.get("trader_profile") or "First recap for this trader — no profile yet."
    parts.append("## Trader Profile\n\n" + profile)

    # Memory
    memory = data.get("memory") or {}
    eod_summaries = memory.get("recent_eod_summaries") or []
    if eod_summaries:
        parts.append("## Recent EOD summaries (last 2 days)")
        for m in eod_summaries:
            parts.append(f"- {m.get('day')}: {m.get('summary', '')}")
    last_weekly = memory.get("last_weekly_summary") or ""
    if last_weekly:
        parts.append("## Last weekly review summary\n\n" + last_weekly)
    focus = memory.get("this_weeks_focus")
    if focus:
        parts.append("## This week's focus (from Sunday's Weekly Review)\n\n" + focus)

    # Multi-day arcs — the elite signal
    arcs = data.get("recent_arcs") or []
    if arcs:
        parts.append("## Multi-day patterns detected (weave these into the recap if relevant)")
        for a in arcs:
            parts.append(f"- {a}")

    # Today
    today = data.get("today") or {}
    parts.append(f"## Today ({today.get('date', 'unknown')})")

    trades = today.get("trades") or []
    if trades:
        parts.append("### Closed trades today")
        parts.append(_format_trades_table(trades))
    else:
        parts.append("### Closed trades today\n\n(none)")

    agg = today.get("aggregates") or {}
    parts.append("### Today's aggregates")
    parts.append(_format_aggregates(agg))

    disc = today.get("discipline_events") or {}
    if any(disc.values()):
        parts.append("### Discipline events today")
        parts.append(_format_discipline(disc))

    open_positions = today.get("open_positions") or []
    if open_positions:
        parts.append("### Open positions held overnight")
        for p in open_positions:
            r = p.get("unrealized_r")
            r_str = _signed(r) + "R" if r is not None else "(current price unavailable)"
            parts.append(
                f"- {p.get('symbol')} {p.get('side')} {p.get('shares')} sh, "
                f"entry {_money(p.get('entry_price'))}, day {p.get('days_held', '?')}: {r_str}"
            )
    else:
        parts.append("### Open positions held overnight\n\n(none)")

    # Week-to-date
    wtd = data.get("week_to_date") or {}
    if wtd:
        parts.append(
            f"### Week-to-date ({wtd.get('range', '?')})\n"
            f"- Trades: {wtd.get('trade_count', 0)} "
            f"({wtd.get('wins', 0)}W / {wtd.get('losses', 0)}L)\n"
            f"- Net P&L: {_signed_money(wtd.get('net_pnl_dollar'))}"
        )

    vs_yest = data.get("vs_yesterday") or {}
    if vs_yest.get("prior_day_net_pnl_dollar") is not None:
        parts.append(
            f"### Vs yesterday\n- Yesterday net P&L: "
            f"{_signed_money(vs_yest.get('prior_day_net_pnl_dollar'))}"
        )

    # User feedback signals
    feedback = data.get("feedback_signals") or []
    if feedback:
        parts.append("## User feedback signals")
        parts.append("The user marked these recent recaps unhelpful — avoid those patterns:")
        for f in feedback:
            parts.append(f"- ({f.get('day')}) {f.get('summary')}")

    parts.append("\n---\n\nWrite today's EOD recap. Be Compass.")

    return "\n\n".join(parts)
```

The `_format_trades_table`, `_format_aggregates`, `_format_discipline`, `_money`, `_signed_money`, `_signed`, `_pct` helpers already exist in `coach_prompts.py` from v1 — reuse them.

- [ ] **Step 3: Smoke import**

```bash
cd C:/Users/Patrick/uct-dashboard
python -c "from api.services.journal_two.coach_prompts import COMPASS_SYSTEM_PROMPT, assemble_eod_user_message; print(len(COMPASS_SYSTEM_PROMPT), 'chars'); assert 'EOD Recap output structure' in COMPASS_SYSTEM_PROMPT"
```

Expected: prints a character count around 13000-14000 (v1 was ~10800; +3000 for Section 6) and the assertion passes.

- [ ] **Step 4: Commit**

```bash
git add api/services/journal_two/coach_prompts.py
git commit -m "feat(j2-coach): system prompt Section 6 (EOD format + reflective rubric) + EOD assembler"
```

---

## Task 3: Multi-day arc detectors + `assemble_day`

**Files:**
- Modify: `api/services/journal_two/coach_data_assembler.py`
- Modify: `api/services/journal_two/test_coach_data_assembler.py`

- [ ] **Step 1: Write failing tests for arc detectors + assemble_day**

Append to `api/services/journal_two/test_coach_data_assembler.py`:

```python
# ── Phase G v2: assemble_day + arcs ────────────────────────────────────────


def test_assemble_day_empty_returns_skeleton(db_conn):
    from api.services.journal_two import coach_data_assembler as assembler
    acc = _seed_account(db_conn)
    data = assembler.assemble_day(
        user_id="u_coach", account_id=acc["id"], day_iso="2026-05-11", conn=db_conn,
    )
    assert data["today"]["date"] == "2026-05-11"
    assert data["today"]["trades"] == []
    assert data["today"]["aggregates"]["trade_count"] == 0
    assert data["today"]["open_positions"] == []
    assert data["recent_arcs"] == []


def test_assemble_day_includes_today_trades(db_conn):
    from api.services.journal_two import coach_data_assembler as assembler
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_coach", account_id=acc["id"],
                  exit_iso="2026-05-11T20:00:00+00:00", setup="Bull Flag",
                  r_multiple=1.5, result="Win")
    _insert_trade(db_conn, user_id="u_coach", account_id=acc["id"],
                  exit_iso="2026-05-10T20:00:00+00:00", setup="Bull Flag",
                  r_multiple=-1.0, result="Loss")
    data = assembler.assemble_day(
        user_id="u_coach", account_id=acc["id"], day_iso="2026-05-11", conn=db_conn,
    )
    assert data["today"]["aggregates"]["trade_count"] == 1
    assert len(data["today"]["trades"]) == 1
    assert data["today"]["trades"][0]["setup"] == "Bull Flag"


def test_arc_consecutive_setup_losses(db_conn):
    """Three Bull Flag losses on consecutive trading days should produce one arc."""
    from api.services.journal_two import coach_data_assembler as assembler
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_coach", account_id=acc["id"],
                  exit_iso="2026-05-07T20:00:00+00:00", setup="Bull Flag",
                  symbol="TSLA", result="Loss", r_multiple=-1.0, pnl_dollar=-100)
    _insert_trade(db_conn, user_id="u_coach", account_id=acc["id"],
                  exit_iso="2026-05-08T20:00:00+00:00", setup="Bull Flag",
                  symbol="NVDA", result="Loss", r_multiple=-1.0, pnl_dollar=-100)
    _insert_trade(db_conn, user_id="u_coach", account_id=acc["id"],
                  exit_iso="2026-05-11T20:00:00+00:00", setup="Bull Flag",
                  symbol="CRWD", result="Loss", r_multiple=-1.0, pnl_dollar=-100)
    data = assembler.assemble_day(
        user_id="u_coach", account_id=acc["id"], day_iso="2026-05-11", conn=db_conn,
    )
    arcs = data["recent_arcs"]
    assert any("3" in a and "Bull Flag" in a for a in arcs), arcs


def test_arc_repeated_mistake_tag(db_conn):
    """Three FOMO-tagged trades in the rolling window should produce an arc."""
    from api.services.journal_two import coach_data_assembler as assembler
    acc = _seed_account(db_conn)
    import json
    for day in ("2026-05-07", "2026-05-08", "2026-05-11"):
        _insert_trade(
            db_conn, user_id="u_coach", account_id=acc["id"],
            exit_iso=f"{day}T20:00:00+00:00",
            mistake_tags=json.dumps(["FOMO"]),
            result="Loss", r_multiple=-1.0, pnl_dollar=-100,
        )
    data = assembler.assemble_day(
        user_id="u_coach", account_id=acc["id"], day_iso="2026-05-11", conn=db_conn,
    )
    arcs = data["recent_arcs"]
    assert any("FOMO" in a for a in arcs), arcs


def test_arc_days_since_last_winner(db_conn):
    """Three days in a row with no winner should produce an arc."""
    from api.services.journal_two import coach_data_assembler as assembler
    acc = _seed_account(db_conn)
    for day in ("2026-05-07", "2026-05-08", "2026-05-11"):
        _insert_trade(
            db_conn, user_id="u_coach", account_id=acc["id"],
            exit_iso=f"{day}T20:00:00+00:00",
            result="Loss", r_multiple=-1.0, pnl_dollar=-100,
        )
    data = assembler.assemble_day(
        user_id="u_coach", account_id=acc["id"], day_iso="2026-05-11", conn=db_conn,
    )
    arcs = data["recent_arcs"]
    assert any("no closing winner" in a.lower() or "no winner" in a.lower() for a in arcs), arcs


def test_arc_cap_at_3(db_conn):
    """When more than 3 arcs could be reported, only the top 3 surface."""
    from api.services.journal_two import coach_data_assembler as assembler
    acc = _seed_account(db_conn)
    import json
    # Make it look like every arc fires
    for day in ("2026-05-07", "2026-05-08", "2026-05-11"):
        _insert_trade(
            db_conn, user_id="u_coach", account_id=acc["id"],
            exit_iso=f"{day}T20:00:00+00:00", setup="Bull Flag",
            mistake_tags=json.dumps(["FOMO"]),
            result="Loss", r_multiple=-1.0, pnl_dollar=-100,
            regime="ORANGE",
        )
    data = assembler.assemble_day(
        user_id="u_coach", account_id=acc["id"], day_iso="2026-05-11", conn=db_conn,
    )
    assert len(data["recent_arcs"]) <= 3


def test_assemble_week_now_includes_weekly_eod_context(db_conn):
    """Phase G v2 amends assemble_week to inject EOD summaries from the week."""
    from api.services.journal_two import coach_data_assembler as assembler
    import json, uuid
    acc = _seed_account(db_conn)
    # Seed an EOD recap from this week
    db_conn.execute(
        """
        INSERT INTO j2_coach_outputs
            (id, user_id, account_id, output_type, body, summary, metadata, created_at)
        VALUES (?, ?, ?, 'eod_recap', ?, ?, ?, ?)
        """,
        (
            str(uuid.uuid4()), "u_coach", acc["id"],
            "Tuesday's full body", "Tuesday's summary",
            json.dumps({"day": "2026-05-05"}),
            "2026-05-05T20:00:00+00:00",
        ),
    )
    db_conn.commit()
    data = assembler.assemble_week(
        user_id="u_coach", account_id=acc["id"], week_start="2026-05-04", conn=db_conn,
    )
    weo = data.get("weekly_eod_context") or []
    assert any(e.get("day") == "2026-05-05" for e in weo), weo
```

- [ ] **Step 2: Run, confirm fail**

```bash
python -m pytest api/services/journal_two/test_coach_data_assembler.py -q
```

Expected: 7 new tests fail (assemble_day not defined, weekly_eod_context not in assemble_week output).

- [ ] **Step 3: Implement arc detectors + assemble_day in `coach_data_assembler.py`**

At the top of the file, near other imports, ensure `from collections import defaultdict` is present.

Below the existing `assemble_week` function, add:

```python
# ── Phase G v2: assemble_day + multi-day arc detection ──────────────────────


def assemble_day(
    *,
    user_id: str,
    account_id: str,
    day_iso: str,           # "YYYY-MM-DD" — the trader's calendar day in ET
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Build the structured payload for an EOD Recap prompt.

    Mirrors `assemble_week` but scoped to a single ET calendar day plus
    week-to-date + multi-day arc detection.
    """
    owned = conn is None
    conn = conn or get_connection()
    try:
        # The day window in UTC: [day_00:00 ET, day+1 00:00 ET).
        # Stored exit_date strings are UTC ISO. Approximate ET via -04:00/-05:00.
        # Implementation: use python's zoneinfo for correctness.
        from datetime import datetime, time, timedelta, timezone
        from zoneinfo import ZoneInfo

        et = ZoneInfo("America/New_York")
        day_date = datetime.fromisoformat(day_iso).date()
        day_start_et = datetime.combine(day_date, time(0, 0), tzinfo=et)
        day_end_et = day_start_et + timedelta(days=1)
        day_start_utc = day_start_et.astimezone(timezone.utc).isoformat()
        day_end_utc = day_end_et.astimezone(timezone.utc).isoformat()

        # Trader profile
        trader_profile = _read_trader_profile(conn, user_id, account_id)

        # Memory — last 2 EOD summaries + last weekly summary + this_weeks_focus
        eod_summaries = _recent_eod_summaries(conn, user_id, account_id, limit=2, before_day=day_iso)
        last_weekly = _last_weekly_summary_and_focus(conn, user_id, account_id)

        # Today's trades + aggregates
        # Reuse the existing _trades_in_range helper (it accepts datetimes).
        trades = _trades_in_range(
            conn, user_id, account_id,
            datetime.fromisoformat(day_start_utc.replace("Z", "+00:00").replace("+00:00", "+00:00")),
            datetime.fromisoformat(day_end_utc.replace("Z", "+00:00").replace("+00:00", "+00:00")),
        )
        aggregates = _aggregate_trades(trades)

        # Today's discipline events
        discipline_events = _discipline_events(
            conn, user_id, account_id,
            datetime.fromisoformat(day_start_utc.replace("Z", "+00:00")),
            datetime.fromisoformat(day_end_utc.replace("Z", "+00:00")),
        )

        # Open positions (snapshot, with placeholder unrealized_r=None for v2)
        open_positions = _open_positions(conn, user_id, account_id)

        # Week-to-date
        wtd_start = day_start_et - timedelta(days=day_start_et.weekday())
        wtd_trades = _trades_in_range(
            conn, user_id, account_id,
            wtd_start.astimezone(timezone.utc),
            day_end_et.astimezone(timezone.utc),
        )
        wtd_agg = _aggregate_trades(wtd_trades)

        # Vs yesterday
        yesterday_et = day_start_et - timedelta(days=1)
        y_trades = _trades_in_range(
            conn, user_id, account_id,
            yesterday_et.astimezone(timezone.utc),
            day_start_et.astimezone(timezone.utc),
        )
        prior_day_net = _aggregate_trades(y_trades).get("net_pnl_dollar", 0.0)

        # Multi-day arcs (the moat)
        rolling_window = _trades_in_range(
            conn, user_id, account_id,
            (day_start_et - timedelta(days=10)).astimezone(timezone.utc),
            day_end_et.astimezone(timezone.utc),
        )
        recent_arcs = _detect_recent_arcs(rolling_window, today_date=day_date)

        feedback_signals = _eod_feedback_signals(conn, user_id, account_id)

        return {
            "trader_profile": trader_profile,
            "memory": {
                "recent_eod_summaries": eod_summaries,
                "last_weekly_summary": last_weekly.get("summary", ""),
                "this_weeks_focus": last_weekly.get("this_weeks_focus"),
            },
            "today": {
                "date": day_iso,
                "trades": trades,
                "aggregates": aggregates,
                "discipline_events": discipline_events,
                "open_positions": open_positions,
            },
            "week_to_date": {
                "range": f"{wtd_start.date().isoformat()} to {day_iso}",
                "trade_count": wtd_agg.get("trade_count", 0),
                "net_pnl_dollar": wtd_agg.get("net_pnl_dollar", 0.0),
                "wins": wtd_agg.get("wins", 0),
                "losses": wtd_agg.get("losses", 0),
            },
            "vs_yesterday": {
                "prior_day_net_pnl_dollar": prior_day_net,
            },
            "recent_arcs": recent_arcs,
            "feedback_signals": feedback_signals,
        }
    finally:
        if owned:
            conn.close()


def _recent_eod_summaries(
    conn: sqlite3.Connection, user_id: str, account_id: str, *,
    limit: int, before_day: str,
) -> list[dict]:
    """Return the last N EOD recap summaries for this account, excluding the
    recap for `before_day` itself."""
    rows = conn.execute(
        """
        SELECT summary, metadata FROM j2_coach_outputs
         WHERE user_id = ? AND account_id = ?
           AND output_type = 'eod_recap' AND forgotten = 0
           AND json_extract(metadata, '$.day') < ?
         ORDER BY created_at DESC LIMIT ?
        """,
        (user_id, account_id, before_day, limit),
    ).fetchall()
    out: list[dict] = []
    for r in rows:
        try:
            meta = json.loads(r["metadata"]) if r["metadata"] else {}
        except (TypeError, json.JSONDecodeError):
            meta = {}
        out.append({"day": meta.get("day"), "summary": r["summary"] or ""})
    return out


def _last_weekly_summary_and_focus(
    conn: sqlite3.Connection, user_id: str, account_id: str,
) -> dict:
    """Return {summary, this_weeks_focus} from the most recent weekly_review.
    Both default to empty/None when none exists."""
    row = conn.execute(
        """
        SELECT summary, metadata FROM j2_coach_outputs
         WHERE user_id = ? AND account_id = ?
           AND output_type = 'weekly_review' AND forgotten = 0
         ORDER BY created_at DESC LIMIT 1
        """,
        (user_id, account_id),
    ).fetchone()
    if row is None:
        return {"summary": "", "this_weeks_focus": None}
    try:
        meta = json.loads(row["metadata"]) if row["metadata"] else {}
    except (TypeError, json.JSONDecodeError):
        meta = {}
    return {
        "summary": row["summary"] or "",
        "this_weeks_focus": meta.get("this_weeks_focus"),
    }


def _open_positions(conn: sqlite3.Connection, user_id: str, account_id: str) -> list[dict]:
    """Open positions (closed_at IS NULL) for this account."""
    rows = conn.execute(
        """
        SELECT symbol, side, shares, entry_price, stop_price, entry_date
          FROM j2_positions
         WHERE user_id = ? AND account_id = ? AND closed_at IS NULL
         ORDER BY entry_date ASC
        """,
        (user_id, account_id),
    ).fetchall()
    from datetime import datetime as dt, timezone as tz
    out: list[dict] = []
    for r in rows:
        try:
            entry_dt = dt.fromisoformat(str(r["entry_date"]).replace("Z", "+00:00"))
            days_held = (dt.now(tz.utc) - entry_dt).days
        except Exception:
            days_held = None
        out.append({
            "symbol": r["symbol"],
            "side": r["side"],
            "shares": float(r["shares"]) if r["shares"] is not None else None,
            "entry_price": float(r["entry_price"]) if r["entry_price"] is not None else None,
            "stop_price": float(r["stop_price"]) if r["stop_price"] is not None else None,
            "entry_date": r["entry_date"],
            "days_held": days_held,
            "unrealized_r": None,        # v2: live price integration deferred
            "current_price": None,
        })
    return out


def _eod_feedback_signals(conn, user_id, account_id) -> list[dict]:
    """Recent EOD recaps the user marked unhelpful (for prompt injection)."""
    rows = conn.execute(
        """
        SELECT summary, metadata FROM j2_coach_outputs
         WHERE user_id = ? AND account_id = ?
           AND output_type = 'eod_recap'
           AND feedback = 'unhelpful' AND forgotten = 0
         ORDER BY created_at DESC LIMIT 3
        """,
        (user_id, account_id),
    ).fetchall()
    out = []
    for r in rows:
        try:
            meta = json.loads(r["metadata"]) if r["metadata"] else {}
        except (TypeError, json.JSONDecodeError):
            meta = {}
        out.append({"day": meta.get("day"), "summary": r["summary"]})
    return out


# ── Arc detectors ──────────────────────────────────────────────────────────


def _detect_recent_arcs(rolling_window_trades: list[dict], *, today_date) -> list[str]:
    """Run all arc detectors, cap at 3, sort by significance."""
    arcs: list[tuple[int, str]] = []   # (priority, text)

    # Walk trades chronologically (rolling_window is already ASC by exit_date in _trades_in_range)
    # ── Detector A: consecutive setup losses (descending from today) ──
    # Look at most-recent N trades and see if last 3+ same-setup losses in a row.
    if rolling_window_trades:
        recent = rolling_window_trades[-10:]   # most recent 10
        # Walk backwards from the most recent trade
        if recent and recent[-1]["result"] == "Loss":
            setup = recent[-1].get("setup")
            streak_syms: list[str] = []
            for t in reversed(recent):
                if t.get("setup") == setup and t.get("result") == "Loss":
                    streak_syms.append(t.get("symbol") or "?")
                else:
                    break
            if len(streak_syms) >= 3 and setup:
                streak_syms_quote = ", ".join(streak_syms[::-1])
                arcs.append((10, f"{len(streak_syms)} consecutive losses on {setup} ({streak_syms_quote})"))

    # ── Detector B: repeated mistake tag (rolling 7 days) ──
    from collections import Counter
    tag_count: Counter[str] = Counter()
    for t in rolling_window_trades[-15:]:
        for tag in t.get("mistake_tags") or []:
            tag_count[tag] += 1
    for tag, n in tag_count.most_common(2):
        if n >= 3:
            arcs.append((8, f"the `{tag}` mistake tag has appeared on {n} trades in the last 7 days"))

    # ── Detector C: days since last winner ──
    days_back = 0
    from datetime import datetime as dt
    seen_winner = False
    # Trades are oldest-first; reverse to walk most-recent backward
    for t in reversed(rolling_window_trades):
        if t.get("result") == "Win":
            seen_winner = True
            break
        days_back += 1
    if not seen_winner and days_back >= 3:
        arcs.append((6, f"{days_back} most-recent trades all without a closing winner"))
    elif seen_winner is False and days_back == 0:
        # No trades at all in window — not an arc
        pass

    # ── Detector D: cumulative drawdown approach ──
    # Rolling 5-day net P&L < a threshold (we use a static 3% of accountSize once it lands)
    # Without account size in this function signature, we instead surface "rolling 5-day net P&L = $X"
    # only when it's notably negative.
    last_5 = rolling_window_trades[-15:]   # rough window
    five_day_pnl = sum(t.get("pnl_dollar") or 0 for t in last_5 if t.get("exit_date"))
    if five_day_pnl <= -1000:
        arcs.append((5, f"net P&L over the last several days is {_signed_money_str(five_day_pnl)}"))

    # ── Detector E: regime-mismatch streak ──
    # Trades taken in ORANGE/RED regime over the recent window — flag when >=3.
    hostile_regimes = [t for t in rolling_window_trades[-10:] if t.get("regime") in ("ORANGE", "RED")]
    if len(hostile_regimes) >= 3:
        arcs.append((4, f"{len(hostile_regimes)} of your recent trades were taken in ORANGE/RED regime"))

    # ── Detector F: consecutive discipline-cap breaches ──
    # We don't have per-trade breach flags directly; approximate by counting how
    # many of the last 10 trades had risk that would breach a 1% cap. Skipped in
    # this implementation when accountSize isn't injected — left as None.

    # Sort by priority desc, take top 3
    arcs.sort(key=lambda x: -x[0])
    return [text for _, text in arcs[:3]]


def _signed_money_str(v: float) -> str:
    if v >= 0:
        return f"+${v:.0f}"
    return f"-${abs(v):.0f}"
```

Then extend the existing `assemble_week` function to inject `weekly_eod_context`. Find this section in `assemble_week`:

```python
        feedback_signals = _feedback_signals(conn, user_id, account_id)

        return {
```

Replace with:

```python
        feedback_signals = _feedback_signals(conn, user_id, account_id)

        # Phase G v2: pull EOD summaries from this week for the Weekly prompt.
        weekly_eod_context = _eod_summaries_in_week(
            conn, user_id, account_id, week_start, week_end_str,
        )

        return {
```

And add to the returned dict before the closing `}`:

```python
            "feedback_signals": feedback_signals,
            "weekly_eod_context": weekly_eod_context,
        }
```

Add the helper function below the others:

```python
def _eod_summaries_in_week(
    conn: sqlite3.Connection, user_id: str, account_id: str,
    week_start: str, week_end: str,
) -> list[dict]:
    """Return EOD recap summaries from this week (used by Weekly Review prompt)."""
    rows = conn.execute(
        """
        SELECT summary, metadata FROM j2_coach_outputs
         WHERE user_id = ? AND account_id = ?
           AND output_type = 'eod_recap' AND forgotten = 0
           AND json_extract(metadata, '$.day') BETWEEN ? AND ?
         ORDER BY json_extract(metadata, '$.day') ASC
        """,
        (user_id, account_id, week_start, week_end),
    ).fetchall()
    out = []
    for r in rows:
        try:
            meta = json.loads(r["metadata"]) if r["metadata"] else {}
        except (TypeError, json.JSONDecodeError):
            meta = {}
        out.append({"day": meta.get("day"), "summary": r["summary"] or ""})
    return out
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
python -m pytest api/services/journal_two/test_coach_data_assembler.py -q
```

Expected: all 7 new tests pass + the existing tests still pass.

- [ ] **Step 5: Full suite**

```bash
python -m pytest api/services/journal_two/ -q
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add api/services/journal_two/coach_data_assembler.py api/services/journal_two/test_coach_data_assembler.py
git commit -m "feat(j2-coach): assemble_day + 5 arc detectors + weekly_eod_context for Phase G v2"
```

---

## Task 4: EOD orchestrator with validation+retry

**Files:**
- Modify: `api/services/journal_two/coach.py`
- Modify: `api/services/journal_two/test_coach.py`

- [ ] **Step 1: Write failing tests**

Append to `api/services/journal_two/test_coach.py`:

```python
# ── Phase G v2: EOD orchestrator ────────────────────────────────────────────


class FakeEODClient:
    """FakeClient supporting EOD + retry behavior. Lets a test script multiple
    responses across calls so we can simulate the retry loop."""
    def __init__(self, *, responses: list[dict], updated_profile: str = ""):
        # responses: list of dicts each containing {body, summary, key_observations?}
        self.responses = list(responses)
        self.updated_profile = updated_profile
        self.calls: list[dict] = []

    def _pop(self):
        if not self.responses:
            raise RuntimeError("FakeEODClient ran out of responses")
        return self.responses.pop(0)

    def write_review(self, *, system_prompt, user_message):
        self.calls.append({"kind": "review", "user": user_message})
        return self._pop()

    def write_profile_update(self, *, system_prompt, user_message):
        self.calls.append({"kind": "profile", "user": user_message})
        return {"updated_profile": self.updated_profile}

    def write_eod_recap(self, *, system_prompt, user_message):
        self.calls.append({"kind": "eod", "user": user_message})
        return self._pop()


def test_generate_eod_recap_writes_row(db_conn):
    from api.services.journal_two import coach
    acc = _seed_account(db_conn)
    client = FakeEODClient(responses=[
        {
            "body": "Today's two trades were a mixed read. The Pullback on AAPL "
                    "(+2.1R) was clean. What was different about today's AAPL "
                    "entry compared to your prior Pullbacks this week?",
            "summary": "Mixed day.",
            "key_observations": [],
        },
    ])
    # Seed a trade so the day has activity
    _insert_trade(
        db_conn, user_id="u_coach", account_id=acc["id"],
        exit_iso="2026-05-11T20:00:00+00:00",
        symbol="AAPL", setup="Pullback", r_multiple=2.1, pnl_dollar=420, result="Win",
    )
    out = coach.generate_eod_recap(
        user_id="u_coach", account_id=acc["id"], day="2026-05-11",
        client=client, conn=db_conn,
    )
    assert out["body"].startswith("Today's two trades")
    row = db_conn.execute(
        "SELECT output_type, metadata FROM j2_coach_outputs WHERE user_id = ? AND account_id = ?",
        ("u_coach", acc["id"]),
    ).fetchone()
    import json
    assert row["output_type"] == "eod_recap"
    meta = json.loads(row["metadata"])
    assert meta.get("day") == "2026-05-11"


def test_generate_eod_recap_idempotent_on_same_day(db_conn):
    from api.services.journal_two import coach
    acc = _seed_account(db_conn)
    _insert_trade(
        db_conn, user_id="u_coach", account_id=acc["id"],
        exit_iso="2026-05-11T20:00:00+00:00",
        symbol="AAPL", setup="Pullback", r_multiple=2.1, pnl_dollar=420, result="Win",
    )
    body = ("Today's read on AAPL was clean — the Pullback delivered +2.1R. "
            "What about today's entry was different from your prior AAPL Pullbacks?")
    client = FakeEODClient(responses=[
        {"body": body, "summary": "Clean Pullback day.", "key_observations": []},
    ])
    first = coach.generate_eod_recap(
        user_id="u_coach", account_id=acc["id"], day="2026-05-11",
        client=client, conn=db_conn,
    )
    # Second call should NOT consume another response (client only has 1 left)
    second = coach.generate_eod_recap(
        user_id="u_coach", account_id=acc["id"], day="2026-05-11",
        client=client, conn=db_conn,
    )
    assert first["id"] == second["id"]
    n = db_conn.execute(
        "SELECT COUNT(*) AS n FROM j2_coach_outputs WHERE output_type = 'eod_recap'",
    ).fetchone()["n"]
    assert n == 1


def test_generate_eod_recap_retries_on_validation_failure(db_conn):
    """First response invents an R-multiple; second response is clean."""
    from api.services.journal_two import coach
    acc = _seed_account(db_conn)
    _insert_trade(
        db_conn, user_id="u_coach", account_id=acc["id"],
        exit_iso="2026-05-11T20:00:00+00:00",
        symbol="AAPL", setup="Pullback", r_multiple=2.1, pnl_dollar=420, result="Win",
    )
    bad_body = ("AAPL delivered +9.9R today (hallucinated). What about your AAPL entry stood out?")
    good_body = ("AAPL's Pullback delivered +2.1R today. What about your AAPL entry stood out today?")
    client = FakeEODClient(responses=[
        {"body": bad_body, "summary": "", "key_observations": []},
        {"body": good_body, "summary": "Clean.", "key_observations": []},
    ])
    out = coach.generate_eod_recap(
        user_id="u_coach", account_id=acc["id"], day="2026-05-11",
        client=client, conn=db_conn,
    )
    # The orchestrator should have made 2 calls (initial + 1 retry)
    eod_calls = [c for c in client.calls if c["kind"] == "eod"]
    assert len(eod_calls) == 2
    # Final stored body is the good one
    assert "+2.1R" in out["body"]
    # Metadata records validation passed
    import json
    row = db_conn.execute(
        "SELECT metadata FROM j2_coach_outputs WHERE output_type = 'eod_recap'",
    ).fetchone()
    meta = json.loads(row["metadata"])
    assert meta.get("validation", {}).get("passed") is True


def test_generate_eod_recap_persists_with_flag_after_second_failure(db_conn):
    """Both responses fail validation — orchestrator stores the second one
    with passed=false so the user sees the ⚠ badge."""
    from api.services.journal_two import coach
    acc = _seed_account(db_conn)
    _insert_trade(
        db_conn, user_id="u_coach", account_id=acc["id"],
        exit_iso="2026-05-11T20:00:00+00:00",
        symbol="AAPL", setup="Pullback", r_multiple=2.1, pnl_dollar=420, result="Win",
    )
    bad1 = "AAPL +9.9R today. Did you stick to your plan?"
    bad2 = "AAPL +8.8R today. Want to keep doing Pullbacks?"
    client = FakeEODClient(responses=[
        {"body": bad1, "summary": "", "key_observations": []},
        {"body": bad2, "summary": "", "key_observations": []},
    ])
    out = coach.generate_eod_recap(
        user_id="u_coach", account_id=acc["id"], day="2026-05-11",
        client=client, conn=db_conn,
    )
    import json
    row = db_conn.execute(
        "SELECT metadata FROM j2_coach_outputs WHERE output_type = 'eod_recap'",
    ).fetchone()
    meta = json.loads(row["metadata"])
    assert meta["validation"]["passed"] is False
    assert len(meta["validation"]["flags"]) > 0


def test_generate_eod_recap_skips_when_no_activity(db_conn):
    """No trades AND no open positions today → return skip sentinel, write nothing."""
    from api.services.journal_two import coach
    acc = _seed_account(db_conn)
    client = FakeEODClient(responses=[])   # would error if called
    out = coach.generate_eod_recap(
        user_id="u_coach", account_id=acc["id"], day="2026-05-11",
        client=client, conn=db_conn,
    )
    assert out.get("skipped") is True
    n = db_conn.execute(
        "SELECT COUNT(*) AS n FROM j2_coach_outputs WHERE output_type = 'eod_recap'",
    ).fetchone()["n"]
    assert n == 0


def test_generate_weekly_review_writes_this_weeks_focus_to_metadata(db_conn):
    """v2 amendment: Weekly Review extracts the focus section at write time."""
    from api.services.journal_two import coach
    acc = _seed_account(db_conn)
    body = (
        "# Week of 2026-05-04 — Compass's Review\n\n"
        "Mixed week.\n\n"
        "## Performance\nNet P&L: +$500\n\n"
        "## This week's focus\n"
        "Skip Pullback setups entirely. You're -3.1R YTD on them.\n"
    )
    client = FakeEODClient(responses=[
        {"body": body, "summary": "Mixed.", "key_observations": []},
    ])
    coach.generate_weekly_review(
        user_id="u_coach", account_id=acc["id"], week_start="2026-05-04",
        client=client, conn=db_conn,
    )
    row = db_conn.execute(
        "SELECT metadata FROM j2_coach_outputs WHERE output_type='weekly_review'",
    ).fetchone()
    import json
    meta = json.loads(row["metadata"])
    assert "this_weeks_focus" in meta
    assert "Skip Pullback" in meta["this_weeks_focus"]
```

- [ ] **Step 2: Run, confirm fail**

```bash
python -m pytest api/services/journal_two/test_coach.py -q
```

Expected: 6 new tests fail (generate_eod_recap missing, this_weeks_focus not in metadata).

- [ ] **Step 3: Implement EOD orchestrator + amend Weekly**

Open `api/services/journal_two/coach.py`. Add imports at the top:

```python
from api.services.journal_two import coach_validation
```

Extend the `CoachClientProto` Protocol:

```python
class CoachClientProto(Protocol):
    def write_review(self, *, system_prompt: str, user_message: str) -> dict: ...
    def write_profile_update(self, *, system_prompt: str, user_message: str) -> dict: ...
    def write_eod_recap(self, *, system_prompt: str, user_message: str) -> dict: ...
```

Add `write_eod_recap` to `AnthropicClient`:

```python
    def write_eod_recap(self, *, system_prompt: str, user_message: str) -> dict:
        msg = self._client.messages.create(
            model=self.DEFAULT_MODEL,
            max_tokens=1200,
            temperature=0.5,
            system=[
                {"type": "text", "text": system_prompt,
                 "cache_control": {"type": "ephemeral"}}
            ],
            messages=[{"role": "user", "content": user_message}],
        )
        body = msg.content[0].text if msg.content else ""
        summary = _extract_first_paragraph(body)
        return {"body": body, "summary": summary, "key_observations": []}
```

Below the existing `generate_weekly_review`, add:

```python
# ── EOD Recap (Phase G v2) ──────────────────────────────────────────────────


def generate_eod_recap(
    *,
    user_id: str,
    account_id: str,
    day: str,                  # "YYYY-MM-DD" ET calendar date
    client: CoachClientProto | None = None,
    conn=None,
) -> dict[str, Any]:
    """Generate (or return existing) EOD recap for one (account, day).

    Idempotent on (user_id, account_id, day). Runs a post-generation
    validation pass; retries once with corrective context on flag, then
    persists with `validation.passed=false` if still failing.

    Returns either the stored recap dict OR {"skipped": True, "reason": "..."}
    if no activity to recap.
    """
    _conn, _should_close = _get_conn(conn)
    try:
        # 1. Idempotency check
        existing = _conn.execute(
            """
            SELECT id, body, summary, metadata, feedback, created_at
              FROM j2_coach_outputs
             WHERE user_id = ? AND account_id = ?
               AND output_type = 'eod_recap' AND forgotten = 0
               AND json_extract(metadata, '$.day') = ?
             LIMIT 1
            """,
            (user_id, account_id, day),
        ).fetchone()
        if existing:
            return _row_to_eod_dict(existing)

        # 2. Assemble data
        data = coach_data_assembler.assemble_day(
            user_id=user_id, account_id=account_id, day_iso=day, conn=_conn,
        )

        # 3. Activity check — skip if nothing to recap
        today = data.get("today") or {}
        n_closed = (today.get("aggregates") or {}).get("trade_count", 0)
        n_open = len(today.get("open_positions") or [])
        if n_closed == 0 and n_open == 0:
            return {"skipped": True, "reason": "no_activity"}

        # 4. Build user message
        user_message = coach_prompts.assemble_eod_user_message(data=data)

        # 5. Call Compass (with up to 1 retry on validation failure)
        active_client = client or AnthropicClient()
        attempts: list[dict] = []
        validation: dict[str, Any] = {"passed": False, "flags": []}
        body = ""
        summary = ""
        for attempt_idx in range(2):
            response = active_client.write_eod_recap(
                system_prompt=coach_prompts.COMPASS_SYSTEM_PROMPT,
                user_message=user_message if attempt_idx == 0 else _retry_user_message(
                    user_message, attempts[-1]["body"], attempts[-1]["validation"]["flags"],
                ),
            )
            body = response.get("body", "") or ""
            summary = response.get("summary") or _extract_first_paragraph(body)
            validation = coach_validation.validate_eod_output(body, data)
            attempts.append({"body": body, "validation": validation})
            if validation["passed"]:
                break

        # 6. Persist (passed or final-failed)
        recap_id = str(uuid.uuid4())
        now_iso = datetime.now(timezone.utc).isoformat()
        metadata = {
            "day": day,
            "validation": validation,
            "attempts": len(attempts),
        }
        _conn.execute(
            """
            INSERT INTO j2_coach_outputs
                (id, user_id, account_id, output_type, body, summary, metadata,
                 feedback, forgotten, created_at)
            VALUES (?, ?, ?, 'eod_recap', ?, ?, ?, NULL, 0, ?)
            """,
            (recap_id, user_id, account_id, body, summary,
             json.dumps(metadata), now_iso),
        )
        _conn.commit()

        return {
            "id": recap_id,
            "body": body,
            "summary": summary,
            "metadata": metadata,
            "feedback": None,
            "created_at": now_iso,
            "day": day,
            "validation": validation,
        }
    finally:
        if _should_close:
            _conn.close()


def _retry_user_message(original: str, failed_body: str, flags: list[str]) -> str:
    """Build the corrective addendum for retry attempts."""
    flag_list = "\n".join(f"  - {f}" for f in flags)
    return (
        original
        + "\n\n---\n\n"
        + "## Your prior draft was flagged by the validator:\n\n"
        + f"```\n{failed_body}\n```\n\n"
        + f"## Validation flags:\n{flag_list}\n\n"
        + "Rewrite the EOD recap. Use ONLY values and symbols that appear in "
        + "the data I gave you. Replace each flagged value with a verified one "
        + "or omit the sentence entirely. If the reflective question was "
        + "yes/no-able, rewrite it to reference a specific pattern across "
        + "≥2 data points. Maintain the conversational note format — no "
        + "headers, no bullets, exactly one question."
    )


def list_eod_recaps(
    *, user_id: str, account_id: str, conn=None,
) -> list[dict]:
    _conn, _should_close = _get_conn(conn)
    try:
        rows = _conn.execute(
            """
            SELECT id, body, summary, metadata, feedback, created_at FROM j2_coach_outputs
             WHERE user_id = ? AND account_id = ?
               AND output_type = 'eod_recap' AND forgotten = 0
             ORDER BY created_at DESC
            """,
            (user_id, account_id),
        ).fetchall()
        return [_row_to_eod_dict(r) for r in rows]
    finally:
        if _should_close:
            _conn.close()


def get_eod_recap(recap_id: str, *, user_id: str | None = None, conn=None) -> dict | None:
    _conn, _should_close = _get_conn(conn)
    try:
        if user_id is not None:
            row = _conn.execute(
                """
                SELECT id, body, summary, metadata, feedback, created_at
                  FROM j2_coach_outputs
                 WHERE id = ? AND user_id = ?
                   AND output_type = 'eod_recap' AND forgotten = 0
                """,
                (recap_id, user_id),
            ).fetchone()
        else:
            row = _conn.execute(
                "SELECT id, body, summary, metadata, feedback, created_at "
                "FROM j2_coach_outputs WHERE id = ? AND output_type = 'eod_recap' AND forgotten = 0",
                (recap_id,),
            ).fetchone()
        return _row_to_eod_dict(row) if row else None
    finally:
        if _should_close:
            _conn.close()


def mark_eod_viewed(recap_id: str, *, user_id: str, conn=None) -> int:
    _conn, _should_close = _get_conn(conn)
    try:
        # Read existing metadata, set viewed_at, write back.
        row = _conn.execute(
            "SELECT metadata FROM j2_coach_outputs WHERE id = ? AND user_id = ?",
            (recap_id, user_id),
        ).fetchone()
        if row is None:
            return 0
        try:
            meta = json.loads(row["metadata"]) if row["metadata"] else {}
        except (TypeError, json.JSONDecodeError):
            meta = {}
        meta["viewed_at"] = datetime.now(timezone.utc).isoformat()
        cur = _conn.execute(
            "UPDATE j2_coach_outputs SET metadata = ? WHERE id = ? AND user_id = ?",
            (json.dumps(meta), recap_id, user_id),
        )
        _conn.commit()
        return cur.rowcount
    finally:
        if _should_close:
            _conn.close()


def _row_to_eod_dict(row) -> dict:
    try:
        meta = json.loads(row["metadata"]) if row["metadata"] else {}
    except (TypeError, json.JSONDecodeError):
        meta = {}
    keys = row.keys() if hasattr(row, "keys") else []
    return {
        "id": row["id"],
        "body": row["body"],
        "summary": row["summary"] or "",
        "metadata": meta,
        "feedback": row["feedback"] if "feedback" in keys else None,
        "created_at": row["created_at"],
        "day": meta.get("day"),
        "validation": meta.get("validation", {"passed": True, "flags": []}),
    }
```

Now amend `generate_weekly_review` to write `this_weeks_focus` to metadata. Find this block in coach.py:

```python
    metadata = {
        "week_start": week_start,
        "key_observations": key_observations,
    }
```

Replace with:

```python
    metadata = {
        "week_start": week_start,
        "key_observations": key_observations,
        "this_weeks_focus": coach_validation.extract_this_weeks_focus(body),
    }
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
python -m pytest api/services/journal_two/test_coach.py -q
```

Expected: all 6 new tests pass + all existing tests still pass.

- [ ] **Step 5: Full suite**

```bash
python -m pytest api/services/journal_two/ -q
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add api/services/journal_two/coach.py api/services/journal_two/test_coach.py
git commit -m "feat(j2-coach): generate_eod_recap orchestrator with validation+retry; structured this_weeks_focus on Weekly"
```

---

## Task 5: APScheduler EOD cron job

**Files:**
- Modify: `api/main.py`

- [ ] **Step 1: Read existing scheduler integration**

```bash
grep -n "APScheduler\|BackgroundScheduler\|scheduler\|cot" api/main.py | head -20
```

Confirm an existing scheduler instance is created in the lifespan handler. The COT scheduler is the model — it adds a CronTrigger.

- [ ] **Step 2: Register the EOD cron job in the lifespan handler**

In `api/main.py`, find the lifespan handler where the COT scheduler is registered. Add an EOD job alongside it. The exact placement depends on the existing structure; this snippet shows the addition:

```python
# In the lifespan handler, after the existing scheduler.add_job(cot_refresh, ...) line:

from apscheduler.triggers.cron import CronTrigger

def _compass_eod_job():
    """Phase G v2 — auto-generate EOD recaps for every active Compass account."""
    import logging
    log = logging.getLogger("compass.eod")
    import os
    if not os.environ.get("ANTHROPIC_API_KEY"):
        log.warning("Compass EOD scheduler tick: ANTHROPIC_API_KEY missing — skipping batch")
        return

    from datetime import datetime
    from zoneinfo import ZoneInfo
    from api.services.auth_db import get_connection
    from api.services.journal_two import coach as coach_service

    et = ZoneInfo("America/New_York")
    today_iso = datetime.now(et).date().isoformat()

    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT id, user_id FROM j2_accounts WHERE compass_enabled = 1",
        ).fetchall()
        log.info("Compass EOD batch: %d eligible accounts", len(rows))
        for row in rows:
            account_id = row["id"]
            user_id = row["user_id"]
            try:
                result = coach_service.generate_eod_recap(
                    user_id=user_id, account_id=account_id, day=today_iso,
                    conn=conn,
                )
                if result.get("skipped"):
                    log.info("EOD skipped for account %s: %s", account_id, result.get("reason"))
                else:
                    log.info("EOD generated for account %s (id=%s)", account_id, result.get("id"))
            except Exception as e:
                log.error("EOD generation failed for account %s: %s", account_id, e)
    finally:
        conn.close()


scheduler.add_job(
    _compass_eod_job,
    trigger=CronTrigger(day_of_week="mon-fri", hour=16, minute=30, timezone="America/New_York"),
    id="compass_eod_recap",
    replace_existing=True,
    misfire_grace_time=600,
)
```

The exact import path for the scheduler and existing job-registration pattern should match what's already in `main.py`. Read the file briefly to confirm.

- [ ] **Step 3: Smoke import**

```bash
python -c "import api.main; print('OK')"
```

Expected: prints `OK` with no errors.

- [ ] **Step 4: Run full backend tests**

```bash
python -m pytest api/services/journal_two/ -q
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add api/main.py
git commit -m "feat(j2-coach): APScheduler EOD recap cron (Mon-Fri 16:30 ET)"
```

---

## Task 6: Router endpoints

**Files:**
- Modify: `api/routers/journal_two.py`

- [ ] **Step 1: Add 7 endpoints**

Add the import alongside the existing `coach_service` import (already there from v1):

```python
# coach_service already imported in v1 — no new import needed
```

Add this block of endpoints after the existing `/coach/weekly-reviews/*` endpoints:

```python
# ── Phase G v2: EOD recaps ──────────────────────────────────────────────────


@router.get("/accounts/{account_id}/coach/eod-recaps")
def list_coach_eod_recaps(
    account_id: str,
    user: dict = Depends(get_current_user),
):
    return {"recaps": coach_service.list_eod_recaps(
        user_id=user["id"], account_id=account_id,
    )}


@router.get("/accounts/{account_id}/coach/eod-recaps/{recap_id}")
def get_coach_eod_recap(
    account_id: str,
    recap_id: str,
    user: dict = Depends(get_current_user),
):
    r = coach_service.get_eod_recap(recap_id, user_id=user["id"])
    if not r:
        raise HTTPException(status_code=404, detail="Recap not found")
    return r


@router.post("/accounts/{account_id}/coach/eod-recaps/generate")
def generate_coach_eod_recap(
    account_id: str,
    payload: dict | None = None,
    user: dict = Depends(get_current_user),
):
    # Compass-enabled gate
    settings_check = accounts_service.get_account_settings(user["id"], account_id)
    if settings_check is None:
        raise HTTPException(status_code=404, detail="Account not found")
    if not settings_check.get("compassEnabled", True):
        raise HTTPException(status_code=403, detail="Compass is disabled for this account")

    # Default day = today ET
    from datetime import datetime
    from zoneinfo import ZoneInfo
    et = ZoneInfo("America/New_York")
    day = (payload or {}).get("day") or datetime.now(et).date().isoformat()
    try:
        return coach_service.generate_eod_recap(
            user_id=user["id"], account_id=account_id, day=day,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/accounts/{account_id}/coach/eod-recaps/{recap_id}/regenerate")
def regenerate_coach_eod_recap(
    account_id: str,
    recap_id: str,
    user: dict = Depends(get_current_user),
):
    existing = coach_service.get_eod_recap(recap_id, user_id=user["id"])
    if not existing:
        raise HTTPException(status_code=404, detail="Recap not found")
    day = (existing.get("metadata") or {}).get("day")
    coach_service.forget_review(review_id=recap_id, user_id=user["id"])
    try:
        return coach_service.generate_eod_recap(
            user_id=user["id"], account_id=account_id, day=day,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/accounts/{account_id}/coach/eod-recaps/{recap_id}/feedback")
def feedback_coach_eod_recap(
    account_id: str,
    recap_id: str,
    payload: dict,
    user: dict = Depends(get_current_user),
):
    feedback = (payload or {}).get("feedback")
    if feedback not in ("helpful", "unhelpful"):
        raise HTTPException(status_code=400, detail="feedback must be 'helpful' or 'unhelpful'")
    existing = coach_service.get_eod_recap(recap_id, user_id=user["id"])
    if not existing:
        raise HTTPException(status_code=404, detail="Recap not found")
    coach_service.set_feedback(recap_id, feedback=feedback, user_id=user["id"])
    return {"ok": True}


@router.post("/accounts/{account_id}/coach/eod-recaps/{recap_id}/forget")
def forget_coach_eod_recap(
    account_id: str,
    recap_id: str,
    user: dict = Depends(get_current_user),
):
    existing = coach_service.get_eod_recap(recap_id, user_id=user["id"])
    if not existing:
        raise HTTPException(status_code=404, detail="Recap not found")
    coach_service.forget_review(review_id=recap_id, user_id=user["id"])
    return {"ok": True}


@router.post("/accounts/{account_id}/coach/eod-recaps/{recap_id}/viewed")
def viewed_coach_eod_recap(
    account_id: str,
    recap_id: str,
    user: dict = Depends(get_current_user),
):
    n = coach_service.mark_eod_viewed(recap_id, user_id=user["id"])
    if n == 0:
        raise HTTPException(status_code=404, detail="Recap not found")
    return {"ok": True}
```

- [ ] **Step 2: Verify**

```bash
python -c "from api.routers import journal_two; print('OK')"
python -m pytest api/services/journal_two/ -q
```

Expected: prints OK; tests stay green.

- [ ] **Step 3: Commit**

```bash
git add api/routers/journal_two.py
git commit -m "feat(j2-coach): 7 endpoints under /api/j2/accounts/{id}/coach/eod-recaps/*"
```

---

## Task 7: Extract shared markdown renderer

**Files:**
- Create: `app/src/pages/journal-2-0/lib/coachMarkdown.js`
- Modify: `app/src/pages/journal-2-0/components/CompassReview.jsx`

- [ ] **Step 1: Create the shared module**

Create `app/src/pages/journal-2-0/lib/coachMarkdown.js`:

```js
/**
 * Minimal markdown renderer shared between CompassReview (weekly) and
 * EODRecap. Handles: headings, bullets, paragraphs, **bold**.
 *
 * Not a full markdown lib — by design. v3 polish can swap in `marked` or
 * `react-markdown` if we need tables/links/code blocks.
 */

export function renderMarkdown(md) {
  if (!md) return []
  const blocks = md.split('\n\n')
  return blocks.map((block, i) => {
    const trimmed = block.trim()
    if (!trimmed) return null
    if (trimmed.startsWith('# ')) {
      return { type: 'h1', key: i, text: trimmed.slice(2) }
    }
    if (trimmed.startsWith('## ')) {
      return { type: 'h2', key: i, text: trimmed.slice(3) }
    }
    if (trimmed.startsWith('### ')) {
      return { type: 'h3', key: i, text: trimmed.slice(4) }
    }
    if (trimmed.startsWith('- ')) {
      const items = trimmed.split('\n').filter((l) => l.trim().startsWith('- '))
      return {
        type: 'ul', key: i,
        items: items.map((line) => line.replace(/^\s*-\s*/, '')),
      }
    }
    return { type: 'p', key: i, text: trimmed }
  }).filter(Boolean)
}

export function renderInline(text) {
  // **bold** only. No links, no code spans in v1/v2.
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) => ({
    bold: p.startsWith('**') && p.endsWith('**'),
    text: p.startsWith('**') && p.endsWith('**') ? p.slice(2, -2) : p,
    key: i,
  }))
}
```

- [ ] **Step 2: Update CompassReview to use it**

In `app/src/pages/journal-2-0/components/CompassReview.jsx`, remove the inline `renderMarkdown` and `renderInline` functions. Add at the top:

```jsx
import { renderMarkdown as parseMarkdown, renderInline as parseInline } from '../lib/coachMarkdown'
```

Then replace the inline `renderMarkdown` function in the file with a wrapper that converts the parsed tree to JSX. The existing `useMemo` call computing `body` should change:

```jsx
const body = useMemo(() => {
  const blocks = parseMarkdown(review?.body)
  return blocks.map((block) => {
    if (block.type === 'h1') {
      return <h1 key={block.key} style={{ fontSize: 22, marginTop: 12 }}>{block.text}</h1>
    }
    if (block.type === 'h2') {
      return <h2 key={block.key} style={{ fontSize: 16, marginTop: 16, color: 'var(--ut-gold, #c9a84c)' }}>{block.text}</h2>
    }
    if (block.type === 'h3') {
      return <h3 key={block.key} style={{ fontSize: 14, marginTop: 12 }}>{block.text}</h3>
    }
    if (block.type === 'ul') {
      return (
        <ul key={block.key} style={{ margin: '6px 0 6px 20px', lineHeight: 1.6 }}>
          {block.items.map((item, j) => (
            <li key={j}>{renderInlineJSX(item)}</li>
          ))}
        </ul>
      )
    }
    if (block.type === 'p') {
      return <p key={block.key} style={{ margin: '8px 0', lineHeight: 1.6 }}>{renderInlineJSX(block.text)}</p>
    }
    return null
  })
}, [review?.body])

function renderInlineJSX(text) {
  return parseInline(text).map((part) =>
    part.bold
      ? <strong key={part.key}>{part.text}</strong>
      : <span key={part.key}>{part.text}</span>,
  )
}
```

(If `parseInline` is only used inside the component, you can define `renderInlineJSX` inside the component too. Keep whatever scoping CompassReview already uses.)

Run the existing CompassReview tests to confirm no regression:

```bash
cd C:/Users/Patrick/uct-dashboard/app
npx vitest run src/pages/journal-2-0/components/CompassReview.test.jsx
```

Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/pages/journal-2-0/lib/coachMarkdown.js app/src/pages/journal-2-0/components/CompassReview.jsx
git commit -m "refactor(j2-coach): extract renderMarkdown into shared lib for EOD + Weekly reuse"
```

---

## Task 8: useJ2EODRecaps hook

**Files:**
- Create: `app/src/pages/journal-2-0/hooks/useJ2EODRecaps.js`

- [ ] **Step 1: Create the hook**

```js
/**
 * SWR hook for Compass EOD recaps per account.
 * Exposes: list, generate, regenerate, feedback, forget, markViewed.
 */

import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

async function jsonPost(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) {
    let msg = `${r.status}`
    try {
      const data = await r.json()
      if (data?.detail) msg = data.detail
    } catch { /* ignore */ }
    throw new Error(msg)
  }
  return r.json()
}

export default function useJ2EODRecaps(accountId) {
  const url = accountId
    ? `/api/j2/accounts/${accountId}/coach/eod-recaps`
    : null
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  const base = accountId ? `/api/j2/accounts/${accountId}/coach/eod-recaps` : null

  return {
    recaps: data?.recaps ?? [],
    isLoading,
    error,
    refresh: () => mutate(),
    generate: async (day) => {
      const out = await jsonPost(`${base}/generate`, day ? { day } : undefined)
      await mutate()
      return out
    },
    regenerate: async (recapId) => {
      const out = await jsonPost(`${base}/${recapId}/regenerate`)
      await mutate()
      return out
    },
    feedback: async (recapId, value) => {
      await jsonPost(`${base}/${recapId}/feedback`, { feedback: value })
      await mutate()
    },
    forget: async (recapId) => {
      await jsonPost(`${base}/${recapId}/forget`)
      await mutate()
    },
    markViewed: async (recapId) => {
      await jsonPost(`${base}/${recapId}/viewed`)
      await mutate()
    },
  }
}
```

- [ ] **Step 2: Build verify**

```bash
cd C:/Users/Patrick/uct-dashboard/app && npm run build
```

- [ ] **Step 3: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add app/src/pages/journal-2-0/hooks/useJ2EODRecaps.js
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-coach): useJ2EODRecaps hook"
```

---

## Task 9: useJ2UnviewedEOD hook

**Files:**
- Create: `app/src/pages/journal-2-0/hooks/useJ2UnviewedEOD.js`

- [ ] **Step 1: Create**

```js
/**
 * Returns the most-recent EOD recap for the current account whose
 * metadata.viewed_at is unset. Used by the cross-tab notification banner.
 */

import useJ2EODRecaps from './useJ2EODRecaps'

export default function useJ2UnviewedEOD(accountId) {
  const { recaps, isLoading } = useJ2EODRecaps(accountId)
  if (!recaps || recaps.length === 0) {
    return { unviewed: null, isLoading }
  }
  // Pick the most recent unviewed
  const found = recaps.find((r) => !r?.metadata?.viewed_at)
  return { unviewed: found || null, isLoading }
}
```

- [ ] **Step 2: Build + commit**

```bash
cd C:/Users/Patrick/uct-dashboard/app && npm run build
git -C C:/Users/Patrick/uct-dashboard add app/src/pages/journal-2-0/hooks/useJ2UnviewedEOD.js
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-coach): useJ2UnviewedEOD hook for banner state"
```

---

## Task 10: EODRecap component + tests

**Files:**
- Create: `app/src/pages/journal-2-0/components/EODRecap.jsx`
- Create: `app/src/pages/journal-2-0/components/EODRecap.test.jsx`

- [ ] **Step 1: Tests**

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EODRecap from './EODRecap'

const SAMPLE = {
  id: 'e1',
  body: "Today's two trades were a mixed read. The Pullback on AAPL (+2.1R) was clean. What was different about today's AAPL entry vs your prior Pullbacks?",
  summary: "Mixed day.",
  metadata: { day: '2026-05-11', validation: { passed: true, flags: [] } },
  feedback: null,
  created_at: '2026-05-11T20:00:00+00:00',
  validation: { passed: true, flags: [] },
  day: '2026-05-11',
}

describe('EODRecap', () => {
  it('renders the recap body', () => {
    render(<EODRecap recap={SAMPLE} onFeedback={() => {}} onRegenerate={() => {}} onForget={() => {}} />)
    expect(screen.getByText(/Pullback on AAPL/i)).toBeInTheDocument()
  })

  it('renders the unverified-claims badge when validation.passed is false', () => {
    const withFlag = { ...SAMPLE, validation: { passed: false, flags: ['unverified R-multiple: 9.9R'] } }
    render(<EODRecap recap={withFlag} onFeedback={() => {}} onRegenerate={() => {}} onForget={() => {}} />)
    expect(screen.getByText(/unverified/i)).toBeInTheDocument()
  })

  it('clicking 👍 calls onFeedback with "helpful"', async () => {
    const user = userEvent.setup()
    const onFeedback = vi.fn()
    render(<EODRecap recap={SAMPLE} onFeedback={onFeedback} onRegenerate={() => {}} onForget={() => {}} />)
    await user.click(screen.getByRole('button', { name: /helpful/i }))
    expect(onFeedback).toHaveBeenCalledWith('helpful')
  })

  it('Forget button calls onForget', async () => {
    const user = userEvent.setup()
    const onForget = vi.fn()
    render(<EODRecap recap={SAMPLE} onFeedback={() => {}} onRegenerate={() => {}} onForget={onForget} />)
    await user.click(screen.getByRole('button', { name: /forget/i }))
    expect(onForget).toHaveBeenCalled()
  })
})
```

Run, confirm fail.

- [ ] **Step 2: Implement**

```jsx
/**
 * Single EOD recap render — body + actions + optional unverified-claims badge.
 *
 * Props:
 *   recap: { id, body, day, metadata, feedback, created_at, validation }
 *   onFeedback(value: 'helpful'|'unhelpful'): void
 *   onRegenerate(): void
 *   onForget(): void
 */

import { useMemo } from 'react'
import { renderMarkdown as parseMarkdown, renderInline as parseInline } from '../lib/coachMarkdown'

export default function EODRecap({ recap, onFeedback, onRegenerate, onForget }) {
  const body = useMemo(() => {
    const blocks = parseMarkdown(recap?.body)
    return blocks.map((block) => {
      if (block.type === 'p') {
        return <p key={block.key} style={{ margin: '8px 0', lineHeight: 1.65 }}>{renderInlineJSX(block.text)}</p>
      }
      // EOD recaps should not have headers/bullets per the prompt, but render defensively.
      if (block.type === 'h1') return <h1 key={block.key} style={{ fontSize: 20 }}>{block.text}</h1>
      if (block.type === 'h2') return <h2 key={block.key} style={{ fontSize: 16 }}>{block.text}</h2>
      if (block.type === 'h3') return <h3 key={block.key} style={{ fontSize: 14 }}>{block.text}</h3>
      if (block.type === 'ul') {
        return (
          <ul key={block.key} style={{ margin: '6px 0 6px 20px', lineHeight: 1.6 }}>
            {block.items.map((item, j) => <li key={j}>{renderInlineJSX(item)}</li>)}
          </ul>
        )
      }
      return null
    })
  }, [recap?.body])

  if (!recap) return null

  const feedback = recap.feedback
  const validationPassed = recap.validation?.passed !== false
  const flags = recap.validation?.flags || []

  return (
    <article
      style={{
        background: 'var(--bg-elevated, rgba(255,255,255,0.02))',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '12px 16px',
        margin: '8px 0',
      }}
    >
      <header
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 10, marginBottom: 6, paddingBottom: 6,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {recap.day || recap.metadata?.day || '—'}
          {recap.created_at && (
            <> · written {new Date(recap.created_at).toLocaleString()}</>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" aria-label="helpful"
            onClick={() => onFeedback('helpful')}
            style={chip(feedback === 'helpful', '#22c55e')}>👍</button>
          <button type="button" aria-label="thumbs down"
            onClick={() => onFeedback('unhelpful')}
            style={chip(feedback === 'unhelpful', '#ef4444')}>👎</button>
          <button type="button" onClick={onRegenerate} style={ghost()}>Regen</button>
          <button type="button" onClick={onForget} style={ghost()}>Forget</button>
        </div>
      </header>
      {!validationPassed && (
        <div
          role="alert"
          style={{
            margin: '4px 0 8px',
            padding: '6px 10px',
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: 6,
            color: 'var(--loss, #ef4444)',
            fontSize: 11,
          }}
        >
          ⚠ Compass made unverified claims — review carefully.
          <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
            ({flags.length} flag{flags.length === 1 ? '' : 's'})
          </span>
        </div>
      )}
      <div>{body}</div>
    </article>
  )
}

function renderInlineJSX(text) {
  return parseInline(text).map((part) =>
    part.bold
      ? <strong key={part.key}>{part.text}</strong>
      : <span key={part.key}>{part.text}</span>,
  )
}

function chip(active, color) {
  return {
    padding: '3px 8px', fontSize: 11,
    background: active ? color : 'transparent',
    color: active ? '#000' : 'var(--text-bright)',
    border: `1px solid ${active ? color : 'var(--border)'}`,
    borderRadius: 999, cursor: 'pointer',
  }
}

function ghost() {
  return {
    padding: '3px 8px', fontSize: 11,
    background: 'transparent', color: 'var(--text-muted)',
    border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
  }
}
```

- [ ] **Step 3: Run tests, confirm pass**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npx vitest run src/pages/journal-2-0/components/EODRecap.test.jsx
```

Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/pages/journal-2-0/components/EODRecap.jsx app/src/pages/journal-2-0/components/EODRecap.test.jsx
git commit -m "feat(j2-coach): EODRecap component with unverified-claims badge"
```

---

## Task 11: EODRecapBanner component

**Files:**
- Create: `app/src/pages/journal-2-0/components/EODRecapBanner.jsx`

- [ ] **Step 1: Create**

```jsx
/**
 * Cross-tab notification strip — surfaces when the current account has an
 * unviewed EOD recap for today. Click → routes to Compass tab + marks
 * viewed. Dismiss button also marks viewed.
 *
 * Props:
 *   onClick(): void   // routes to Compass tab (parent supplies)
 *   onDismiss(): void // marks recap viewed (parent supplies)
 *   day: string       // the recap's day, displayed for context
 */

export default function EODRecapBanner({ onClick, onDismiss, day }) {
  return (
    <div
      role="status"
      style={{
        margin: '0 16px 12px',
        padding: '8px 14px',
        background: 'rgba(201,168,76,0.10)',
        border: '1px solid rgba(201,168,76,0.5)',
        borderRadius: 6,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
        fontSize: 13,
      }}
    >
      <span>
        🧭 Compass wrapped {day === todayISO() ? "today's" : `the ${day}`} session — read it →
      </span>
      <span style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          onClick={onClick}
          style={{
            padding: '4px 12px',
            background: 'var(--ut-gold, #c9a84c)',
            color: '#000',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Read
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{
            padding: '4px 8px',
            background: 'transparent',
            color: 'var(--text-muted)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          ×
        </button>
      </span>
    </div>
  )
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}
```

- [ ] **Step 2: Build + commit**

```bash
cd C:/Users/Patrick/uct-dashboard/app && npm run build
git -C C:/Users/Patrick/uct-dashboard add app/src/pages/journal-2-0/components/EODRecapBanner.jsx
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-coach): EODRecapBanner cross-tab notification strip"
```

---

## Task 12: CompassTab — Daily Recaps section

**Files:**
- Modify: `app/src/pages/journal-2-0/tabs/CompassTab.jsx`

- [ ] **Step 1: Add Daily Recaps section**

In `CompassTab.jsx`, add imports:

```jsx
import useJ2EODRecaps from '../hooks/useJ2EODRecaps'
import EODRecap from '../components/EODRecap'
```

Add hook call near the existing useJ2CoachReviews + useJ2TraderProfile:

```jsx
const { recaps: eodRecaps, isLoading: eodLoading, generate: generateEod,
        regenerate: regenerateEod, feedback: eodFeedback, forget: forgetEod } = useJ2EODRecaps(accountId)
```

Add a helper for today's date (ET-approximate; for v2 the JS local-tz date is acceptable since the user is plausibly in ET):

```jsx
function todayISO() {
  return new Date().toISOString().slice(0, 10)
}
```

Insert this JSX block between the Weekly Review CTA section and the Weekly Review list. It goes after the `{!haveCurrent && ...}` block and before `{reviews.map(...)}`:

```jsx
      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, color: 'var(--ut-gold, #c9a84c)', marginBottom: 8 }}>
          Daily Recaps
        </h2>

        {(() => {
          const today = todayISO()
          const haveToday = eodRecaps.some((r) => (r.day || r.metadata?.day) === today)
          if (!haveToday) {
            return (
              <div style={{ margin: '8px 0', padding: '10px 14px', background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 6, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <span>No recap yet for today ({today}).</span>
                <button
                  type="button"
                  onClick={async () => {
                    setErrorMsg(null)
                    setGenerating(true)
                    try {
                      const out = await generateEod()
                      if (out?.skipped) {
                        setErrorMsg('No activity today — Compass took the day off.')
                      }
                    } catch (e) {
                      setErrorMsg(String(e.message || e))
                    } finally {
                      setGenerating(false)
                    }
                  }}
                  disabled={generating}
                  style={{
                    padding: '4px 12px', fontSize: 12, fontWeight: 600,
                    background: 'var(--ut-gold, #c9a84c)', color: '#000',
                    border: 'none', borderRadius: 4, cursor: 'pointer',
                  }}
                >
                  {generating ? 'Working…' : "Generate today's recap →"}
                </button>
              </div>
            )
          }
          return null
        })()}

        {eodLoading && eodRecaps.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading recaps…</p>
        )}

        {eodRecaps.slice(0, 7).map((r) => (
          <EODRecap
            key={r.id}
            recap={r}
            onFeedback={(v) => eodFeedback(r.id, v)}
            onRegenerate={async () => {
              try {
                await regenerateEod(r.id)
              } catch (e) {
                setErrorMsg(String(e.message || e))
              }
            }}
            onForget={() => forgetEod(r.id)}
          />
        ))}
      </section>
```

(This section uses some of the existing CompassTab state — `generating`, `setGenerating`, `errorMsg`, `setErrorMsg`. Confirm those exist in the file; v1's CompassTab already declares them.)

- [ ] **Step 2: Build + frontend tests**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npm run build
npx vitest run src/pages/journal-2-0/
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/pages/journal-2-0/tabs/CompassTab.jsx
git commit -m "feat(j2-coach): Daily Recaps section in CompassTab"
```

---

## Task 13: Mount EODRecapBanner in J2 root

**Files:**
- Modify: `app/src/pages/journal-2-0/JournalTwoRoot.jsx`

- [ ] **Step 1: Add imports + banner logic**

In `JournalTwoRoot.jsx`, add imports:

```jsx
import useJ2UnviewedEOD from './hooks/useJ2UnviewedEOD'
import useJ2EODRecaps from './hooks/useJ2EODRecaps'
import EODRecapBanner from './components/EODRecapBanner'
import useJ2SelectedAccount from './hooks/useJ2SelectedAccount'
```

In the component body, add:

```jsx
const { accountId } = useJ2SelectedAccount()
const { unviewed } = useJ2UnviewedEOD(accountId)
const { markViewed } = useJ2EODRecaps(accountId)
```

In the JSX, immediately ABOVE the existing nested-tab bar (the `<div className={styles.tabBar}>` or whatever the existing structure is), add:

```jsx
{unviewed && (
  <EODRecapBanner
    day={unviewed.day || unviewed.metadata?.day}
    onClick={async () => {
      setNestedTab('compass')   // route to Compass tab
      try { await markViewed(unviewed.id) } catch { /* swallow */ }
    }}
    onDismiss={async () => {
      try { await markViewed(unviewed.id) } catch { /* swallow */ }
    }}
  />
)}
```

If `setNestedTab` is named differently (`setTab`, `setActiveTab`, etc.), match the existing accessor.

- [ ] **Step 2: Build + tests**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npm run build
npx vitest run src/pages/journal-2-0/
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add app/src/pages/journal-2-0/JournalTwoRoot.jsx
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-coach): mount EODRecapBanner above nested tab bar"
```

---

## Task 14: End-to-end smoke + push

- [ ] **Step 1: Backend full suite**

```bash
cd C:/Users/Patrick/uct-dashboard
python -m pytest api/services/journal_two/ -q
```

Expected: clean (~360+ tests).

- [ ] **Step 2: Frontend build + tests**

```bash
cd app
npm run build
npx vitest run src/pages/journal-2-0/
```

Expected: clean.

- [ ] **Step 3: Manual smoke (optional but recommended, only if ANTHROPIC_API_KEY set + Railway deployed)**

In dev:
1. Set `ANTHROPIC_API_KEY` env var locally.
2. `uvicorn api.main:app --reload --port 8000`.
3. Open the J2 Compass tab.
4. Click "Generate today's recap →".
5. Wait ~10-30s; recap renders. Verify it has prose only, exactly one `?`, references at least one specific trade by symbol when trades exist.
6. Click 👎 → endpoint returns ok.
7. Click Forget → recap disappears from list.
8. Re-click generate → returns new recap (since prior was forgotten).
9. Inject a deliberately bad mock if you want to test the validation badge path.

- [ ] **Step 4: Push**

```bash
cd C:/Users/Patrick/uct-dashboard
git push origin master
```

Railway redeploys; EOD cron starts firing at next 4:30pm ET.

---

## Self-Review Checklist

- [ ] Every section of the spec maps to at least one task. (§2 → Tasks 2, 4. §3 → Tasks 2, 3. §3.1 → Task 3. §4 → Tasks 4, 5, 6. §4.4 → Tasks 1, 4. §5 → Tasks 1, 4, 6. §6 → Tasks 7-13. §7 → Tasks 3, 4. §8 → Task 4. §9 → mapped. §10 → cost-tracked in design, not implementation. §11 → not in scope. §12 → manual smoke step. §13 → carry-forwards.)
- [ ] No "TBD"/"implement later" markers anywhere.
- [ ] Function names consistent: `validate_eod_output`, `extract_this_weeks_focus`, `assemble_day`, `generate_eod_recap`, `list_eod_recaps`, `get_eod_recap`, `mark_eod_viewed`. Hook names: `useJ2EODRecaps`, `useJ2UnviewedEOD`. Component names: `EODRecap`, `EODRecapBanner`.
- [ ] Schema column references: `j2_coach_outputs.output_type IN (... 'eod_recap' ...)` — already enumerated in v1.
- [ ] Test counts: Task 1 adds ~12 tests, Task 3 adds ~7, Task 4 adds ~6, Task 10 adds ~4. ~29 new tests across phases.
- [ ] Idempotency: orchestrator checks `(user_id, account_id, day)`. Manual generate + cron simultaneous → second returns existing.
- [ ] Security: review lookups scoped by user_id (added to `get_eod_recap`, `mark_eod_viewed`).
- [ ] Validation retry: 1-attempt budget, persistence on final failure with `validation.passed=false`.
- [ ] Compass disabled gate: enforced in router endpoint AND scheduler skips disabled accounts.
- [ ] EOD does NOT update Trader Profile (no `write_profile_update` call in `generate_eod_recap`).
- [ ] Weekly Review's `metadata.this_weeks_focus` is written at generation time via `coach_validation.extract_this_weeks_focus`.
