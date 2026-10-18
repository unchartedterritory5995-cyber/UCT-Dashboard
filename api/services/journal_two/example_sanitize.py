"""The text patterns of an EXAMPLE NOTE (Notebook P3b, Task 2): what `public_note_payload.reduce`
in `example` mode replaces inside a note's text before an author's note is shown to other members
as an example of a style, and what an image's OCR text is warned about.

⛔ PURE. It imports only `re`: no database, no clock, no log line. The reducer calls this on every
text of the note; the author's own institution names arrive as the `brokers` argument (the caller
reads them), and the house list `BROKER_NAMES` is always applied on top of them.

⛔ `before` IS THE AUTHOR'S OWN TEXT. A change entry's `before` (at most 60 characters of the
original) is handed back to the author's preview and nowhere else: this module never prints,
logs or stores it, and neither may a caller (plan R-P3b-4, Global Constraints).

What is replaced, in this order (rulings P3b-T2-R9..R12 on top of plan R-P3b-3):
  1. a URL written in prose (`scheme://...` or `www....`) -> LINK_TEXT, WHOLE (kind `link`). This
     pass runs FIRST, so no later pattern ever edits inside an address.
  2. in ONE pass over the text that remains, every span below, matched against the ORIGINAL words
     (a replacement never feeds the next pattern; the earlier span, then the longer, wins):
     * money -> VALUE_TEXT (kind `money`): the plan's verbatim `$` pattern; a currency code or
       symbol before or after (USD EUR GBP CAD, EUR/GBP/JPY signs, `C$`, `A$`); a trailing `$`;
       "N dollars|bucks|grand"; "N k|m profit|loss|gain|down|up"; and a number with 4 or more
       digits or a decimal within 3 words after balance|equity|buying power|net liq|account
       value|cash. An amount runs on over a trailing `,digits` (`$1,24` is one amount).
     * a P&L figure -> VALUE_TEXT (kind `pnl_figure`): an `R`/`r` or `%` figure with a P&L word
       among the 3 words BEFORE it, or a loss|profit|gain|drawdown|return|win rate word among the
       2 words AFTER it. "NVDA 3.2R target" stays: no P&L word on either side.
     * an account id -> VALUE_TEXT (kind `account`): a digit run of 8 or more digits (spaces and
       dashes inside the run removed; an ISO date such as 2026-10-17 is not one); a run of 4 or
       more digits within 3 words after acct|account|a/c|#|ending|ends in|last four|routing|card;
       a broker-style id `[A-Z]{1,2}` + 6 or more digits anywhere.
     * a broker name -> BROKER_TEXT (kind `broker`): the house list whole-word in ANY case, and
       the author's own institution names whole-word in their STORED case and only at 4 or more
       characters (ruling P3b-T2-R3: an institution recorded as an ordinary word does not wipe the
       word everywhere). Longest name first.
A price with no `$` ("NVDA 132.40") is kept: a level in a plan is the example's point, and the
author sees every replacement in the preview.

⚠️ KNOWN LIMIT (ruling P3b-T2-R7): each text node is scrubbed on its own, so an amount split across
marks -- "made $1," then a bold "240" -- is split across text nodes too, and only the part a
pattern can see is replaced. The author's preview and the review queue are the backstop.
"""
from __future__ import annotations

import re

#: The brokerages an example scrubs whatever the author's accounts say (case-insensitive).
BROKER_NAMES: tuple[str, ...] = (
    "Charles Schwab", "Schwab", "Fidelity", "Interactive Brokers", "IBKR", "Robinhood", "Webull",
    "E*TRADE", "ETRADE", "TD Ameritrade", "tastytrade", "tastyworks", "TradeStation", "Lightspeed",
    "Cobra Trading", "Vanguard", "Merrill Edge", "Merrill", "SoFi Invest", "Public.com", "Firstrade",
    "Ally Invest", "Moomoo", "Tradier", "Centerpoint", "Cobra",
)

#: What a money amount, a P&L figure, an account id and a fact become.
VALUE_TEXT = "your value here"
#: What a broker name becomes.
BROKER_TEXT = "your broker"
#: What a URL written in prose becomes (ruling P3b-T2-R9).
LINK_TEXT = "link"

#: How much of the original text a change entry carries.
BEFORE_MAX = 60

#: Task 2's money pattern, verbatim. It stays ONE alternative of the money rule.
MONEY_PATTERN = (r"(?<![\w$])[+-]?\$\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?[kKmM]?\b"
                 r"|(?<![\w$])[+-]?\$\s?\d+(?:\.\d+)?[kKmM]?\b")
#: A number as the extra money forms read it: grouped thousands or a plain run, then decimals.
_NUM = r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?"
_CURRENCY = r"(?:USD|EUR|GBP|CAD|€|£|¥|C\$|A\$)"
#: Ruling P3b-T2-R11: the money forms beyond the plan's `$` pattern.
MONEY_EXTRA_PATTERNS: tuple[str, ...] = (
    rf"(?<![\w$])[+-]?{_CURRENCY}\s?{_NUM}[kKmM]?(?!\w)",      # USD 1,240 / €1,240 / C$500
    rf"(?<![\w.,$]){_NUM}[kKmM]?\s?(?:{_CURRENCY}|\$)(?!\w)",                 # 1,240 USD / 1240$
    rf"(?<![\w.,$]){_NUM}[kKmM]?\s+(?:dollars|bucks|grand)(?!\w)",           # 1,240 dollars
    rf"(?<![\w.,$]){_NUM}[kKmM](?=\s+(?:profit|loss|gain|down|up)(?!\w))",   # 1.2k profit
)
#: The words a bare balance figure follows (within 3 words before it), and its number.
BALANCE_WORDS: tuple[str, ...] = ("balance", "equity", "buying power", "net liq", "account value", "cash")
_BALANCE_NUM = re.compile(rf"(?<![\w.,$]){_NUM}(?![\w])")

#: Task 2's P&L figure pattern, with the corrections ruled since: the trailing `\b` is `(?!\w)`
#: (P3b-T2-R1), `r` counts as `R` (P3b-T2-R12), and the number may carry thousands groups (M-3,
#: so "up 1,240%" is one figure).
PNL_PATTERN = r"[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s?(?:[Rr]|%)(?!\w)"
#: Ruling P3b-T2-R12: the P&L words, any case, looked for among the 3 words BEFORE a figure...
PNL_WORDS: tuple[str, ...] = ("pnl", "p&l", "p/l", "profit", "loss", "lost", "made", "up", "down", "gain",
                              "gained", "net", "realized", "unrealized", "drawdown", "dd", "return",
                              "returned", "closed", "booked", "stopped", "win rate", "winrate")
PNL_WINDOW = 3
#: ...and among the 2 words AFTER it.
PNL_WORDS_AFTER: tuple[str, ...] = ("loss", "profit", "gain", "drawdown", "return", "win rate")
PNL_WINDOW_AFTER = 2

#: Ruling P3b-T2-R10: the account-id rule.
ACCOUNT_DIGITS_MIN = 8
ACCOUNT_WORDS: tuple[str, ...] = ("acct", "account", "a/c", "#", "ending", "ends in", "last four",
                                  "routing", "card")
ACCOUNT_WORD_DIGITS_MIN = 4
ACCOUNT_WINDOW = 3
_BROKER_STYLE_ID = re.compile(r"(?<![A-Za-z0-9])[A-Z]{1,2}\d{6,}(?!\d)")
_ISO_DATE = re.compile(r"(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])")

#: OCR only: a run of 6 or more digits once the spaces and dashes inside the run are removed.
DIGITS_PATTERN = r"\d{6,}"

#: The author's own institution names are matched only at this length or more (P3b-T2-R3); the
#: house list is matched as written.
MIN_AUTHOR_BROKER_CHARS = 4

#: Ruling P3b-T2-R9: a URL in prose. Trailing sentence punctuation is handed back to the sentence.
_URL = re.compile(r"(?<![\w@.-])(?:[A-Za-z][A-Za-z0-9+.-]*://|www\.)[^\s<>\"'`]+", re.IGNORECASE)
_URL_TRAILING = ".,;:!?)]}'\""

_MONEY = re.compile(MONEY_PATTERN)
_MONEY_EXTRA = tuple(re.compile(p, re.IGNORECASE) for p in MONEY_EXTRA_PATTERNS)
_MONEY_RUN_ON = re.compile(r"(?:[,.]\d+)+")
_PNL = re.compile(PNL_PATTERN)
_DIGITS = re.compile(DIGITS_PATTERN)
#: A digit run that may hold spaces or dashes inside it (an account or card number as written).
_DIGIT_CANDIDATE = re.compile(r"\d(?:[ -]*\d)*")
_WORD_EDGE = re.compile(r"^[^\w&/#]+|[^\w&/#]+$")

_BROKER_RX_CACHE: dict[tuple, "re.Pattern[str] | None"] = {}


def _broker_names(brokers: tuple[str, ...], min_chars: int) -> tuple[str, ...]:
    """The names to match: each once, blank and too-short names left out, and LONGEST FIRST, so
    "Charles Schwab" is one match and "Merrill Edge" never leaves "Edge"."""
    seen: set[str] = set()
    names: list[str] = []
    for raw in brokers or ():
        if not isinstance(raw, str):
            continue
        name = " ".join(raw.split())
        if len(name) < min_chars or name.casefold() in seen:
            continue
        seen.add(name.casefold())
        names.append(name)
    return tuple(sorted(names, key=len, reverse=True))


def _compile_names(names: tuple[str, ...], min_chars: int, flags: int) -> "re.Pattern[str] | None":
    key = (names, min_chars, flags)
    if key in _BROKER_RX_CACHE:
        return _BROKER_RX_CACHE[key]
    ordered = _broker_names(names, min_chars)
    rx = None
    if ordered:
        alts = [r"\s+".join(re.escape(word) for word in name.split()) for name in ordered]
        rx = re.compile(r"(?<!\w)(?:" + "|".join(alts) + r")(?!\w)", flags)
    if len(_BROKER_RX_CACHE) > 64:
        _BROKER_RX_CACHE.clear()
    _BROKER_RX_CACHE[key] = rx
    return rx


def broker_patterns(brokers: tuple[str, ...]) -> list["re.Pattern[str]"]:
    """The house list (any case) and the author's names (stored case, 4+ characters), as patterns
    of whole words whose words may be joined by any run of whitespace."""
    house = {name.casefold() for name in BROKER_NAMES}
    authors = tuple(b for b in brokers or () if isinstance(b, str) and " ".join(b.split()).casefold() not in house)
    out = [_compile_names(BROKER_NAMES, 1, re.IGNORECASE),
           _compile_names(authors, MIN_AUTHOR_BROKER_CHARS, 0)]
    return [rx for rx in out if rx is not None]


def _words(s: str) -> list[str]:
    """Whitespace-separated words with their edge punctuation removed and folded ("P&L:" is `p&l`,
    "(up" is `up`, "#" stays `#`)."""
    return [_WORD_EDGE.sub("", w).casefold() for w in s.split()]


def _has_word(words: list[str], vocabulary: tuple[str, ...]) -> bool:
    """Does `words` hold a vocabulary entry? A two-word entry ("win rate") must be two adjacent words."""
    singles = {v for v in vocabulary if " " not in v}
    pairs = {v for v in vocabulary if " " in v}
    if any(w in singles for w in words):
        return True
    return any(f"{a} {b}" in pairs for a, b in zip(words, words[1:]))


def _word_before(text: str, at: int, vocabulary: tuple[str, ...], n: int) -> bool:
    """Is a vocabulary entry among the `n` words before `at`? A two-word entry ("win rate",
    "buying power") also counts when only its LAST word is inside the window."""
    words = _words(text[:at])
    if _has_word(words[-n:], vocabulary):
        return True
    pairs = tuple(v for v in vocabulary if " " in v)
    return bool(pairs) and len(words) > n and _has_word(words[-n - 1:-n + 1], pairs)


def _after(text: str, at: int, n: int) -> list[str]:
    return _words(text[at:])[:n]


def scrub_urls(text: str, changes: list | None) -> str:
    """`text` with every URL written in prose replaced WHOLE by LINK_TEXT (kind `link`)."""
    if not isinstance(text, str) or not text:
        return text

    def repl(m: "re.Match[str]") -> str:
        s = m.group(0)
        core = s.rstrip(_URL_TRAILING)
        if not core:
            return s
        if changes is not None:
            changes.append({"kind": "link", "before": core[:BEFORE_MAX], "after": LINK_TEXT})
        return LINK_TEXT + s[len(core):]
    return _URL.sub(repl, text)


def _money_spans(text: str) -> list[tuple[int, int]]:
    spans = [(m.start(), m.end()) for m in _MONEY.finditer(text)]
    for rx in _MONEY_EXTRA:
        spans += [(m.start(), m.end()) for m in rx.finditer(text)]
    for m in _BALANCE_NUM.finditer(text):
        digits = sum(c.isdigit() for c in m.group(0))
        if (digits >= 4 or "." in m.group(0)) and _word_before(text, m.start(), BALANCE_WORDS, 3):
            spans.append((m.start(), m.end()))
    out = []
    for start, end in spans:                       # M-3: an amount runs on over a trailing ,digits
        run_on = _MONEY_RUN_ON.match(text, end)
        out.append((start, run_on.end() if run_on else end))
    return out


def _account_spans(text: str) -> list[tuple[int, int]]:
    spans = []
    for m in _DIGIT_CANDIDATE.finditer(text):
        run = m.group(0)
        digits = re.sub(r"[ -]", "", run)
        if len(digits) >= ACCOUNT_DIGITS_MIN and not _ISO_DATE.fullmatch(run):
            spans.append((m.start(), m.end()))
        elif len(digits) >= ACCOUNT_WORD_DIGITS_MIN and _word_before(text, m.start(), ACCOUNT_WORDS,
                                                                       ACCOUNT_WINDOW):
            spans.append((m.start(), m.end()))
    spans += [(m.start(), m.end()) for m in _BROKER_STYLE_ID.finditer(text)]
    return spans


def _spans(text: str, brokers: tuple[str, ...]) -> list[tuple[int, int, str]]:
    """Every (start, end, kind) to replace in `text`, matched against the original, in text order,
    with no two overlapping (the earlier one, then the longer one, wins)."""
    found: list[tuple[int, int, str]] = [(s, e, "money") for s, e in _money_spans(text)]
    for m in _PNL.finditer(text):
        if (_word_before(text, m.start(), PNL_WORDS, PNL_WINDOW)
                or _has_word(_after(text, m.end(), PNL_WINDOW_AFTER), PNL_WORDS_AFTER)):
            found.append((m.start(), m.end(), "pnl_figure"))
    found += [(s, e, "account") for s, e in _account_spans(text)]
    for rx in broker_patterns(brokers):
        found += [(m.start(), m.end(), "broker") for m in rx.finditer(text)]
    found.sort(key=lambda s: (s[0], -(s[1] - s[0])))
    kept: list[tuple[int, int, str]] = []
    for span in found:
        if kept and span[0] < kept[-1][1]:
            continue
        kept.append(span)
    return kept


_AFTER = {"money": VALUE_TEXT, "pnl_figure": VALUE_TEXT, "account": VALUE_TEXT, "broker": BROKER_TEXT}


def scrub_text(text: str, brokers: tuple[str, ...], changes: list | None) -> str:
    """`text` with every URL (first), then every money amount, P&L figure, account id and broker
    name replaced. `brokers` is the author's own institution names; the house list always applies.
    When `changes` is a list, one `{kind, before, after}` entry per replacement is appended to it,
    in that order (URLs, then the rest in text order)."""
    if not isinstance(text, str) or not text:
        return text
    text = scrub_urls(text, changes)
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
    """What an image's OCR text is warned about (plan R-P3b-5): each money amount, each run of 6
    or more digits (spaces and dashes inside the run removed first) and each broker name, as
    `{kind: 'money' | 'digits' | 'broker', match}`, in text order. A warning never blocks."""
    if not isinstance(text, str) or not text:
        return []
    found: list[tuple[int, str, str]] = []
    for start, end in _money_spans(text):
        found.append((start, "money", text[start:end]))
    for m in _DIGIT_CANDIDATE.finditer(text):
        if _DIGITS.fullmatch(re.sub(r"[ -]", "", m.group(0))):
            found.append((m.start(), "digits", m.group(0)))
    for rx in broker_patterns(brokers):
        found += [(m.start(), "broker", m.group(0)) for m in rx.finditer(text)]
    found.sort(key=lambda f: f[0])
    return [{"kind": kind, "match": match} for _, kind, match in found]


__all__ = [
    "BROKER_NAMES", "VALUE_TEXT", "BROKER_TEXT", "LINK_TEXT", "BEFORE_MAX", "MONEY_PATTERN",
    "MONEY_EXTRA_PATTERNS", "BALANCE_WORDS", "PNL_PATTERN", "PNL_WORDS", "PNL_WINDOW", "PNL_WORDS_AFTER",
    "PNL_WINDOW_AFTER", "ACCOUNT_DIGITS_MIN", "ACCOUNT_WORDS", "ACCOUNT_WORD_DIGITS_MIN", "DIGITS_PATTERN",
    "MIN_AUTHOR_BROKER_CHARS", "broker_patterns", "scrub_urls", "scrub_text", "ocr_warnings",
]
