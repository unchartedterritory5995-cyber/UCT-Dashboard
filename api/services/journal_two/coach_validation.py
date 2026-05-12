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
    # Symbols mentioned in arc descriptions (Task 3 produces strings like
    # "3 consecutive losses on Bull Flag (TSLA, NVDA, CRWD)"). The arcs are
    # legitimate references the validator must accept.
    for arc in data.get("recent_arcs") or []:
        if isinstance(arc, str):
            for tok in _TICKER_RE.findall(arc):
                if tok not in _NON_TICKER_WORDS:
                    out.add(tok)
    return out


def _matches_within_tolerance(claimed: float, data_set: set[float]) -> bool:
    """Allow 1-decimal-place rounding tolerance. e.g. 0.4 matches 0.35; 1.4 matches 1.36-1.44.

    Uses a slightly-padded epsilon (0.0501) so that exact half-cases like
    |0.4 - 0.35| = 0.05000000000000000044 (a floating-point artifact) still match.
    """
    for v in data_set:
        if abs(claimed - v) <= 0.0501:  # half a tenth on each side, plus FP slack
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
    # Bullet points (lines starting with `- ` or `* `) and numbered lists (`1. `, `1) `)
    _NUMBERED_LIST_RE = re.compile(r"^\d+[.)]\s")
    for line in body.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("- ") or stripped.startswith("* "):
            flags.append("bullet point present (forbidden in EOD)")
            break
        if _NUMBERED_LIST_RE.match(stripped):
            flags.append("numbered list present (forbidden in EOD)")
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


def validate_chat_output(body: str, data: dict) -> dict:
    """Lighter validator for chat outputs. Only checks numeric + symbol grounding.
    No format compliance (chat can use headers/bullets); no question-mark rules
    (chat is conversational, not reflective)."""
    flags: list[str] = []
    if not isinstance(body, str) or not body.strip():
        return {"passed": True, "flags": []}  # empty chat turn = no flags

    data_numbers = _data_numbers(data)
    for tok in _R_MULTIPLE_RE.findall(body):
        val = _to_float(tok + "R")
        if val is None:
            continue
        if not _matches_within_tolerance(val, data_numbers):
            flags.append(f"unverified R-multiple: {tok}R")
    for tok in _DOLLAR_RE.findall(body):
        val = _to_float(tok)
        if val is None:
            continue
        if not _matches_within_tolerance(val, data_numbers) and not _matches_within_tolerance(abs(val), data_numbers):
            flags.append(f"unverified dollar amount: {tok}")
    for tok in _PERCENT_RE.findall(body):
        val = _to_float(tok + "%")
        if val is None:
            continue
        if not _matches_within_tolerance(val, data_numbers):
            flags.append(f"unverified percentage: {tok}%")

    data_symbols = _data_symbols(data)
    for tok in _TICKER_RE.findall(body):
        if tok in _NON_TICKER_WORDS:
            continue
        if tok not in data_symbols:
            flags.append(f"unverified symbol: {tok}")

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
