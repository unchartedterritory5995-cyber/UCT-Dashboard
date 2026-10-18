"""The text patterns of an EXAMPLE NOTE (Notebook P3b, Task 2): what `public_note_payload.reduce`
in `example` mode replaces inside a note's text before an author's note is shown to other members
as an example of a style, and what an image's OCR text is warned about.

⛔ PURE. No import beyond `re` and `unicodedata`, no database, no clock, no log line. The reducer
calls this on every text node of the note, and the author's own institution names arrive as the
`brokers` argument (the caller reads them); nothing here looks anything up.

⛔ `before` IS THE AUTHOR'S OWN TEXT. A change entry's `before` (at most 60 characters of the
original) is handed back to the author's preview and nowhere else: this module never prints,
logs or stores it, and neither may a caller (plan R-P3b-4, Global Constraints).

What is replaced (plan R-P3b-3, Task 2's matching rules):
  * a money amount: `$`, `-$` or `+$`, then digits with optional `,` groups, decimals and a
    `k`/`K`/`m`/`M` suffix                                           -> VALUE_TEXT  (kind `money`)
  * an R or percent figure with a P&L word among the 3 words before it -> VALUE_TEXT  (`pnl_figure`)
  * a broker name, whole word, any case, the longest name first       -> BROKER_TEXT (`broker`)
A price with no `$` ("NVDA 132.40") is kept: a level in a plan is the example's point, and the
author sees every replacement in the preview.

Every pattern is matched against the ORIGINAL text in one pass, so a replacement never feeds the
next pattern (the 3-word window counts the words the author wrote, not "your value here").
"""
from __future__ import annotations

import re

#: The brokerages an example scrubs whatever the author's accounts say. The reducer unions these
#: with the author's own institution names (`j2_broker_accounts.brokerage_name`).
BROKER_NAMES: tuple[str, ...] = (
    "Charles Schwab", "Schwab", "Fidelity", "Interactive Brokers", "IBKR", "Robinhood", "Webull",
    "E*TRADE", "ETRADE", "TD Ameritrade", "tastytrade", "tastyworks", "TradeStation", "Lightspeed",
    "Cobra Trading", "Vanguard", "Merrill Edge", "Merrill", "SoFi Invest", "Public.com", "Firstrade",
    "Ally Invest", "Moomoo", "Tradier", "Centerpoint", "Cobra",
)

#: What a money amount, a P&L figure and a fact become.
VALUE_TEXT = "your value here"
#: What a broker name becomes.
BROKER_TEXT = "your broker"

#: How much of the original text a change entry carries.
BEFORE_MAX = 60

#: Task 2's money pattern, verbatim.
MONEY_PATTERN = (r"(?<![\w$])[+-]?\$\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?[kKmM]?\b"
                 r"|(?<![\w$])[+-]?\$\s?\d+(?:\.\d+)?[kKmM]?\b")
#: Task 2's P&L figure pattern, with ONE correction: the brief's trailing `\b` is `(?!\w)` here.
#: `\b` after `%` needs a WORD character next, so "Down 4% today" and a figure at the end of a
#: sentence could never match; for `R` (a word character) the two are the same assertion.
PNL_PATTERN = r"[+-]?\d+(?:\.\d+)?\s?(?:R|%)(?!\w)"
#: The P&L words, any case, and how many words before a figure they are looked for in.
PNL_WORDS: frozenset[str] = frozenset({"pnl", "p&l", "profit", "loss", "up", "down", "made", "lost",
                                       "gain", "gained"})
PNL_WINDOW = 3
#: OCR only: a run of 6 or more digits once the spaces and dashes inside the run are removed.
DIGITS_PATTERN = r"\d{6,}"

#: A broker name is ignored below this many characters: one or two letters would replace ordinary
#: words all over a note.
MIN_BROKER_CHARS = 3

_MONEY = re.compile(MONEY_PATTERN)
_PNL = re.compile(PNL_PATTERN)
_DIGITS = re.compile(DIGITS_PATTERN)
#: A digit run that may hold single spaces or dashes inside it (a card or account number as OCR reads it).
_DIGIT_CANDIDATE = re.compile(r"\d(?:[ -]*\d)*")
_WORD_EDGE = re.compile(r"^[^\w&]+|[^\w&]+$")

_BROKER_RX_CACHE: dict[tuple[str, ...], "re.Pattern[str] | None"] = {}


def _broker_names(brokers: tuple[str, ...]) -> tuple[str, ...]:
    """The names to match: each once (case does not matter), blank and too-short names left out,
    and LONGEST FIRST, so "Charles Schwab" is one match and "Merrill Edge" never leaves "Edge"."""
    seen: set[str] = set()
    names: list[str] = []
    for raw in brokers or ():
        if not isinstance(raw, str):
            continue
        name = " ".join(raw.split())
        key = name.casefold()
        if len(name) < MIN_BROKER_CHARS or key in seen:
            continue
        seen.add(key)
        names.append(name)
    return tuple(sorted(names, key=len, reverse=True))


def broker_pattern(brokers: tuple[str, ...]) -> "re.Pattern[str] | None":
    """One pattern for every name: whole words (no word character on either side), any case, the
    words of a name joined by any run of whitespace. None when there is no name."""
    key = tuple(brokers or ())
    if key in _BROKER_RX_CACHE:
        return _BROKER_RX_CACHE[key]
    names = _broker_names(key)
    rx = None
    if names:
        alts = [r"\s+".join(re.escape(word) for word in name.split()) for name in names]
        rx = re.compile(r"(?<!\w)(?:" + "|".join(alts) + r")(?!\w)", re.IGNORECASE)
    if len(_BROKER_RX_CACHE) > 64:
        _BROKER_RX_CACHE.clear()
    _BROKER_RX_CACHE[key] = rx
    return rx


def _pnl_word_before(prefix: str) -> bool:
    """Is a P&L word among the last PNL_WINDOW words of `prefix`? A word is a whitespace-separated
    token with its edge punctuation removed ("P&L:" is `p&l`, "(up" is `up`)."""
    for word in prefix.split()[-PNL_WINDOW:]:
        if _WORD_EDGE.sub("", word).casefold() in PNL_WORDS:
            return True
    return False


def _spans(text: str, brokers: tuple[str, ...]) -> list[tuple[int, int, str]]:
    """Every (start, end, kind) to replace in `text`, matched against the original, in text order,
    with no two overlapping (the earlier one, then the longer one, wins)."""
    found: list[tuple[int, int, str]] = []
    for m in _MONEY.finditer(text):
        found.append((m.start(), m.end(), "money"))
    for m in _PNL.finditer(text):
        if _pnl_word_before(text[:m.start()]):
            found.append((m.start(), m.end(), "pnl_figure"))
    rx = broker_pattern(brokers)
    if rx is not None:
        for m in rx.finditer(text):
            found.append((m.start(), m.end(), "broker"))
    found.sort(key=lambda s: (s[0], -(s[1] - s[0])))
    kept: list[tuple[int, int, str]] = []
    for span in found:
        if kept and span[0] < kept[-1][1]:
            continue
        kept.append(span)
    return kept


_AFTER = {"money": VALUE_TEXT, "pnl_figure": VALUE_TEXT, "broker": BROKER_TEXT}


def scrub_text(text: str, brokers: tuple[str, ...], changes: list | None) -> str:
    """`text` with every money amount, P&L figure and broker name replaced. When `changes` is a
    list, one `{kind, before, after}` entry per replacement is appended to it, in text order."""
    if not isinstance(text, str) or not text:
        return text
    spans = _spans(text, brokers)
    if not spans:
        return text
    parts: list[str] = []
    at = 0
    for start, end, kind in spans:
        parts.append(text[at:start])
        parts.append(_AFTER[kind])
        if changes is not None:
            changes.append({"kind": kind, "before": text[start:end][:BEFORE_MAX], "after": _AFTER[kind]})
        at = end
    parts.append(text[at:])
    return "".join(parts)


def ocr_warnings(text: str, brokers: tuple[str, ...]) -> list[dict]:
    """What an image's OCR text is warned about (plan R-P3b-5): each dollar amount, each run of 6
    or more digits (spaces and dashes inside the run removed first) and each broker name, as
    `{kind: 'money' | 'digits' | 'broker', match}`, in text order. A warning never blocks."""
    if not isinstance(text, str) or not text:
        return []
    found: list[tuple[int, str, str]] = []
    for m in _MONEY.finditer(text):
        found.append((m.start(), "money", m.group(0)))
    for m in _DIGIT_CANDIDATE.finditer(text):
        if _DIGITS.fullmatch(re.sub(r"[ -]", "", m.group(0))):
            found.append((m.start(), "digits", m.group(0)))
    rx = broker_pattern(brokers)
    if rx is not None:
        for m in rx.finditer(text):
            found.append((m.start(), "broker", m.group(0)))
    found.sort(key=lambda f: f[0])
    return [{"kind": kind, "match": match} for _, kind, match in found]


__all__ = [
    "BROKER_NAMES", "VALUE_TEXT", "BROKER_TEXT", "BEFORE_MAX", "MONEY_PATTERN", "PNL_PATTERN",
    "PNL_WORDS", "PNL_WINDOW", "DIGITS_PATTERN", "MIN_BROKER_CHARS", "broker_pattern", "scrub_text",
    "ocr_warnings",
]
