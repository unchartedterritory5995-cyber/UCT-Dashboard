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
# The comma-grouped branch requires AT LEAST ONE comma group (`+`, not `*`).
# With `*` it matched the first 1-3 digits of any ungrouped amount and stopped:
# "$1000.00" parsed as $100, "$50000" as $500 — every four-digit dollar figure
# was compared against ground truth as a different number, and flagged.
# An optional K/M/B magnitude suffix is consumed so "$1.2K" is 1200, not 1.2.
_DOLLAR_RE = re.compile(
    r"(?<![A-Za-z0-9.])(-?\$\d{1,3}(?:,\d{3})+(?:\.\d+)?[KkMmBb]?"
    r"|-?\$\d+(?:\.\d+)?[KkMmBb]?)"
)
_PERCENT_RE = re.compile(r"(?<![A-Za-z0-9.])([+-]?\d+(?:\.\d+)?)%")

# Numbers embedded in STRING values of the injected data (tool payloads
# routinely stringify a price, and prose fields quote real figures). The
# lookarounds reject a token touching `-`, `/` or `:` so ISO dates and clock
# times don't seed the corpus with their components.
_STRING_NUMBER_RE = re.compile(r"(?<![\d\-/:.])\d[\d,]*(?:\.\d+)?(?![\d\-/:])")

_MAGNITUDE = {"k": 1e3, "m": 1e6, "b": 1e9}
# Floating-point slack only. Never widen this to buy tolerance — the tolerance
# is derived from the claim's own precision (see _claim_matches).
_FP_SLACK = 1e-9

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


class _Claim:
    """A numeric token lifted out of the model's prose, with the two things
    that decide how strictly it may be matched: the PRECISION it asserts and
    whether it asserted a SIGN."""

    __slots__ = ("value", "decimals", "signed", "token")

    def __init__(self, value: float, decimals: int, signed: bool, token: str):
        self.value = value
        self.decimals = decimals
        self.signed = signed
        self.token = token

    @property
    def tolerance(self) -> float:
        """Half a unit in the last place the claim actually wrote.

        Why this and not a flat window: the only legitimate reason a stated
        number differs from ground truth is ROUNDING, and a claim declares its
        own rounding precision. "$187.4" may stand for anything in
        [187.35, 187.45]; "$187.42" may only stand for [187.415, 187.425].
        The old flat +-0.0501 gave a two-decimal price the same latitude as a
        one-decimal one, which is how a fabricated cents figure landed inside
        the window. Scales correctly in both directions: "$1.2K" asserts one
        decimal at the thousands scale, so its window is +-50.
        """
        return 0.5 * (10.0 ** -self.decimals) + _FP_SLACK


def _parse_claim(token: str) -> _Claim | None:
    """Parse a matched token ('+1.4', '-$1,200', '$1.2K', '2.4') into a _Claim."""
    s = token.strip()
    if not s:
        return None
    negative = s.startswith("-")
    signed = s[0] in "+-"
    s = s.lstrip("+-").replace("$", "").replace(",", "")
    if s[-1:] in ("R", "r", "%"):
        s = s[:-1]
    multiplier = 1.0
    exponent = 0
    if s[-1:].lower() in _MAGNITUDE:
        multiplier = _MAGNITUDE[s[-1:].lower()]
        exponent = len(str(int(multiplier))) - 1
        s = s[:-1]
    decimals = len(s.split(".", 1)[1]) if "." in s else 0
    try:
        value = float(s)
    except ValueError:
        return None
    value *= multiplier
    if negative:
        value = -value
    # A magnitude suffix shifts the last significant place with it.
    return _Claim(value, decimals - exponent, signed, token)


def _to_float(token: str) -> float | None:
    """Parse a number string ('+1.4', '-$1,200', '2.4') to float."""
    claim = _parse_claim(token)
    return None if claim is None else claim.value


def _data_numbers(data: Any) -> set[float]:
    """Every numeric value present anywhere in the injected data, as floats.

    Walks the WHOLE structure — the caller decides what ground truth is, this
    function never second-guesses which keys count. Numbers written as strings
    are picked up too (tool payloads stringify prices and quote figures in
    prose), because a number the model read off a tool result is grounded
    whatever its JSON type.

    `abs()` is deliberately NOT mixed into the corpus here. It used to be,
    which silently doubled the set and made a sign inversion ("you're up 1.4R"
    on a -1.4R day) unflaggable. Sign leniency now lives in one place —
    _claim_matches — and applies only when the prose didn't assert a sign.
    """
    out: set[float] = set()

    def _add(v: Any) -> None:
        if v is None or isinstance(v, bool):  # bool is int — skip
            return
        if isinstance(v, (int, float)):
            try:
                out.add(float(v))
            except (TypeError, ValueError):
                pass
        elif isinstance(v, str):
            for m in _STRING_NUMBER_RE.finditer(v):
                try:
                    out.add(float(m.group(0).replace(",", "")))
                except ValueError:
                    pass
        elif isinstance(v, (list, tuple, set)):
            for x in v:
                _add(x)
        elif isinstance(v, dict):
            for k, x in v.items():
                _add(x)

    _add(data)
    return out


_SYMBOL_KEY_RE = re.compile(r"(?:^|_)(?:sym|symbol|ticker|underlying)s?$", re.IGNORECASE)
_BARE_SYMBOL_RE = re.compile(r"^[A-Za-z]{1,5}(?:[.\-][A-Za-z]{1,2})?$")


def _data_symbols(data: Any) -> set[str]:
    """Every symbol the injected data could legitimately have put in front of
    the model.

    Derived from the payload's own shape — a bare uppercase ticker token, a
    value under a `symbol`/`ticker`/`underlying` key, an uppercase dict KEY
    (batch tools return `{"NVDA": {...}}`), or a ticker named inside prose
    (arc strings, KB passages, headlines). No hand-list of source keys: the
    hand-list is what made a correct answer read as unverified.
    """
    out: set[str] = set()

    def _add_text(s: str) -> None:
        if s.isupper() and _BARE_SYMBOL_RE.match(s):
            out.add(s)
        for tok in _TICKER_RE.findall(s):
            if tok not in _NON_TICKER_WORDS:
                out.add(tok)

    def _walk(v: Any, symbol_key: bool = False) -> None:
        if isinstance(v, str):
            stripped = v.strip()
            if symbol_key and _BARE_SYMBOL_RE.match(stripped):
                out.add(stripped.upper())
            _add_text(stripped)
        elif isinstance(v, dict):
            for k, val in v.items():
                if isinstance(k, str) and k.isupper() and _BARE_SYMBOL_RE.match(k):
                    out.add(k)
                _walk(val, bool(isinstance(k, str) and _SYMBOL_KEY_RE.search(k)))
        elif isinstance(v, (list, tuple, set)):
            for x in v:
                _walk(x, symbol_key)

    _walk(data)
    return out


def _claim_matches(claim: _Claim, data_set: set[float]) -> bool:
    """True when the claim is a correct rounding of some ground-truth number.

    A claim that wrote its own sign ("+2.1R", "-$140") must match that sign.
    An unsigned claim carries its sign in the prose around it ("cost you 1.4R"
    against a stored -1.4), so it matches on magnitude.
    """
    tol = claim.tolerance
    for v in data_set:
        if abs(claim.value - v) <= tol:
            return True
        if not claim.signed and abs(abs(claim.value) - abs(v)) <= tol:
            return True
    return False


def _matches_within_tolerance(claimed: float, data_set: set[float],
                              decimals: int = 1, signed: bool = False) -> bool:
    """Back-compat shim over _claim_matches for float callers."""
    return _claim_matches(_Claim(claimed, decimals, signed, str(claimed)), data_set)


def _grounding_flags(body: str, data: Any) -> list[str]:
    """Numeric + symbol grounding — the shared core of BOTH validators.

    EOD and chat used to carry byte-identical copies of this block. Two
    authorities over one rule is this repo's most-repeated defect; there is
    now one.
    """
    flags: list[str] = []
    data_numbers = _data_numbers(data)

    for pattern, suffix, label in (
        (_R_MULTIPLE_RE, "R", "R-multiple"),
        (_DOLLAR_RE, "", "dollar amount"),
        (_PERCENT_RE, "%", "percentage"),
    ):
        for tok in pattern.findall(body):
            claim = _parse_claim(tok)
            if claim is None:
                continue
            if not _claim_matches(claim, data_numbers):
                flags.append(f"unverified {label}: {tok}{suffix}")

    data_symbols = _data_symbols(data)
    for tok in _TICKER_RE.findall(body):
        if tok in _NON_TICKER_WORDS:
            continue
        if tok not in data_symbols:
            flags.append(f"unverified symbol: {tok}")

    return flags


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

    # ── A/B. Numeric + symbol grounding
    flags.extend(_grounding_flags(body, data))

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
    if not isinstance(body, str) or not body.strip():
        return {"passed": True, "flags": []}  # empty chat turn = no flags

    flags = _grounding_flags(body, data)
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
