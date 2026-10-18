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
  1. an address written in prose -> LINK_TEXT, WHOLE (kind `link`): `scheme://...` or `www....`
     (R9), a bare host with a declared TLD (`URL_TLDS`), with or without a path, and any bare
     `host.tld/path` (R18). This pass runs FIRST, so no later pattern ever edits inside an address.
     ("Public.com" is therefore "link", not "your broker".)
  2. in ONE pass over the text that remains, every span below, matched against the ORIGINAL words
     (a replacement never feeds the next pattern; the earlier span, then the longer, wins):
     * money -> VALUE_TEXT (kind `money`): the plan's verbatim `$` pattern; a currency code or
       sign before or after (`_CURRENCY`: USD EUR GBP CAD CHF JPY AUD NZD HKD SGD, the euro,
       pound, yen, rupee, won, rouble and bitcoin signs, the full-width dollar and yen, `C$`, `A$`);
       a 1-3 capital-letter prefix glued to `$` (US$, CA$, HK$...) or a `$` glued to a word or to
       the amount before it ("$500$600" is two amounts, R28), when a digit follows (R19; a `$NVDA`
       cashtag stays); a currency CODE glued to a lower-case word ("madeUSD 1,240", R28; an
       all-capitals pair such as "BTCUSD 65000" is a quote and stays); a trailing `$`; "N dollars|bucks|grand";
       "N k|m profit|loss|gain|down|up"; a currency amount with space-grouped thousands, whole
       ("$1 240", "1 240 €", R22); and a BARE number (R11, R20) within 3 words after a balance
       word (3+ digits, a decimal or k/m), a P&L word (3+ digits, a comma group or k/m) or up/down
       (only k/m, or a comma-grouped 1,000 or more, so "up to 5850" stays a level) -- never a
       percent or an R figure. A declared plan phrase (`PLAN_PHRASES`, R27: an exact list) keeps
       the number that is its VERY NEXT token, at most one `PLAN_CONNECTORS` entry between (R26:
       "profit target 150", "stop loss @ 98.5", "profit taking at 155" stay). Any other word between
       ("stop loss hit for 2k"), or a P&L word right after the number ("take profit 1,240 realized"),
       and the phrase's P&L word is a trigger again.
       An amount runs on over a trailing `,digits` (`$1,24` is one amount).
     * a P&L figure -> VALUE_TEXT (kind `pnl_figure`): an `R`/`r` or `%` figure with a P&L word
       among the 3 words BEFORE it, or a loss|profit|gain|drawdown|return|win rate word among the
       2 words AFTER it. "NVDA 3.2R target" stays: no P&L word on either side.
     * an account id -> VALUE_TEXT (kind `account`): a digit run of 8 or more digits (a run joins
       across separators only card-shaped, exactly 4 groups of 4 digits, or across dashes with 3+
       groups that are not a date or a two-number range -- R16, R21 -- so "SPX 5800 5850",
       "145 150 155" and "range 5850-5900" stay; an ISO date is not one); a run of 4 or more
       digits within 3 words after acct|account|a/c|#|ending in|ending with|ends in|last
       four|routing|card, except a 1900-2099 year not directly after acct|account|card|routing
       ("fiscal year ending 2025", "the card from 2024" stay); a broker-style id `[A-Z]{1,2}` + 6
       or more digits anywhere.
     * a broker name -> BROKER_TEXT (kind `broker`): the house list whole-word in ANY case, and
       the author's own institution names whole-word in their STORED case and only at 4 or more
       characters (ruling P3b-T2-R3: an institution recorded as an ordinary word does not wipe the
       word everywhere). Longest name first.
A price with no `$` ("NVDA 132.40") is kept: a level in a plan is the example's point, and the
author sees every replacement in the preview.

A replacement glued to the word before it gets ONE space (ruling P3b-T2-R25: "made$1,240" reads
"made your value here"), every kind alike; never after a space or punctuation. (The address, email
and in-app passes cannot match glued to a word: their lookbehinds refuse it.)

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

#: ⛔ THE change kinds, the ONE list (ruling P3b-T2-R22, review N-8). The payload docstring's table
#: and every kind the two modules can emit (derived by AST) are railed against this tuple in
#: tests/test_example_reduce.py; a new kind is added HERE first.
KINDS: tuple[str, ...] = ("money", "pnl_figure", "account", "broker", "link", "email", "trade_link",
                          "block_reset", "fact", "market_data", "image_off", "dropped")

#: Task 2's money pattern, verbatim. It stays ONE alternative of the money rule.
MONEY_PATTERN = (r"(?<![\w$])[+-]?\$\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?[kKmM]?\b"
                 r"|(?<![\w$])[+-]?\$\s?\d+(?:\.\d+)?[kKmM]?\b")
#: A number as the extra money forms read it: grouped thousands or a plain run, then decimals.
_NUM = r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?"
#: Ruling P3b-T2-R22: thousands grouped by a space (or a no-break space), "1 240".
_NUM_SPACED = r"\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?"
#: Rulings P3b-T2-R11 and R22: the currency codes and signs.
_CURRENCY_CODES: tuple[str, ...] = ("USD", "EUR", "GBP", "CAD", "CHF", "JPY", "AUD", "NZD", "HKD", "SGD")
_CURRENCY = (r"(?:" + "|".join(_CURRENCY_CODES)
             + r"|€|£|¥|₹|₩|₽|₿|＄|￥|C\$|A\$)")
#: Ruling P3b-T2-R11 (and R22's currencies): the money forms beyond the plan's `$` pattern.
MONEY_EXTRA_PATTERNS: tuple[str, ...] = (
    rf"(?<![\w$])[+-]?{_CURRENCY}\s?{_NUM}[kKmM]?(?!\w)",      # USD 1,240 / €1,240 / C$500
    rf"(?<![\w.,$]){_NUM}[kKmM]?\s?(?:{_CURRENCY}|\$)(?!\w)",                 # 1,240 USD / 1240$
    rf"(?<![\w.,$]){_NUM}[kKmM]?\s+(?:dollars|bucks|grand)(?!\w)",           # 1,240 dollars
    rf"(?<![\w.,$]){_NUM}[kKmM](?=\s+(?:profit|loss|gain|down|up)(?!\w))",   # 1.2k profit
    # R22: a currency amount whose thousands are grouped by spaces is ONE amount, whole
    rf"(?<![\w$])[+-]?(?:{_CURRENCY}|\$)\s?{_NUM_SPACED}(?!\w)",             # $1 240
    rf"(?<![\w.,$]){_NUM_SPACED}\s?(?:{_CURRENCY}|\$)(?!\w)",                 # 1 240 €
)
#: Ruling P3b-T2-R19: a dollar sign with a 1-3 letter country prefix glued to it (US$, CA$, HK$, S$,
#: R$, NZ$, A$, C$), and a `$` glued to the word before it -- or, ruling P3b-T2-R28, to the amount
#: before it ("$500$600" is two amounts) -- each only when a DIGIT follows, so a `$NVDA` cashtag is
#: never money. R28 also: a currency CODE glued to a lower-case word ("madeUSD 1,240"); after a
#: capital it is a pair ("BTCUSD 65000", "EURUSD 1.0850"), a quote, and stays. Case-sensitive.
MONEY_DOLLAR_PREFIX_PATTERNS: tuple[str, ...] = (
    rf"(?<![\w$])[+-]?[A-Z]{{1,3}}\$\s?(?=\d){_NUM}[kKmM]?(?!\w)",
    rf"(?<=[A-Za-z0-9])\$\s?(?=\d){_NUM}[kKmM]?(?!\w)",
    r"(?<=[a-z])(?:" + "|".join(_CURRENCY_CODES) + rf")\s?(?=\d){_NUM}[kKmM]?(?!\w)",
)
#: Rulings P3b-T2-R11 and R20: a BARE number (no currency sign) is money when, within 3 words
#: after one of these words, it has the named shape. Never a percent or an R figure (those are
#: the P&L-figure rule's).
#:   a balance word -> 3 or more digits, a decimal (R11), or a k/m suffix
BALANCE_WORDS: tuple[str, ...] = ("bal", "balance", "equity", "net liq", "buying power", "account value", "cash")
#:   a P&L word     -> 3 or more digits, a comma group, or a k/m suffix
PNL_MONEY_WORDS: tuple[str, ...] = ("pnl", "p&l", "p/l", "made", "lost", "profit", "loss", "net", "realized",
                                    "unrealized", "gain", "gained")
#:   up / down      -> ONLY a k/m suffix or a comma-grouped amount of 1,000 or more, so "up to 5850"
#:                     and "down to 132.40" stay levels
UP_DOWN_WORDS: tuple[str, ...] = ("up", "down")
#: Ruling P3b-T2-R27 (narrowing R24): the ONLY plan phrases whose P&L word is not a trigger -- an
#: EXACT list, declared here and nowhere else, never "take|stop + any P&L word" ("take gain 1,240",
#: "stop profit 1,240" are money). A level in a plan is the example's point.
PLAN_PHRASES: tuple[str, ...] = ("stop loss", "take profit", "profit target", "profit targets", "loss level",
                                 "loss levels", "profit taking")
#: Ruling P3b-T2-R26: the phrase keeps a number only when the number is its VERY NEXT token, with at
#: most ONE of these between ("profit taking at 155", "stop loss @ 98.5", "stop loss: 145").
PLAN_CONNECTORS: tuple[str, ...] = ("at", "@", ":", "of", "near", "~")
BARE_MONEY_WINDOW = 3
_BARE_NUM = re.compile(r"(?<![\w.,$])[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?[kKmM]?(?!\w)(?![.,]\d)")
_PERCENT_OR_R_AFTER = re.compile(r"\s?(?:%|[Rr](?!\w))")


def _phrase_alternation(phrases: tuple[str, ...]) -> str:
    return "|".join(r"\s+".join(re.escape(w) for w in p.split()) for p in sorted(phrases, key=len, reverse=True))


#: R26 + R27: text that ENDS in a plan phrase plus at most one connector -- matched against the text
#: just before a number, so a number with any other word between is never a plan level.
_PLAN_LEVEL = re.compile(
    r"(?<![\w&/])(?:" + _phrase_alternation(PLAN_PHRASES) + r")"
    + r"(?:\s+(?:" + "|".join(re.escape(c) for c in PLAN_CONNECTORS if c.isalpha()) + r")\s+"
    + r"|\s*[" + "".join(re.escape(c) for c in PLAN_CONNECTORS if not c.isalpha()) + r"]\s*"
    + r"|\s+)$", re.IGNORECASE)
_PLAN_PHRASE_AT = re.compile(r"(?:" + _phrase_alternation(PLAN_PHRASES) + r")(?![\w&/])", re.IGNORECASE)
#: How far back a plan phrase is looked for (a longer gap is never "the very next token").
_PLAN_LOOKBACK = 64
_NEXT_WORD = re.compile(r"\s+([A-Za-z][A-Za-z&/]*)")

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

#: Ruling P3b-T2-R10 (narrowed by R16 and R21): the account-id rule. "ending" counts only as
#: "ending in" / "ending with" / "ends in" (R21), so "fiscal year ending 2025" is not an account.
ACCOUNT_DIGITS_MIN = 8
ACCOUNT_WORDS: tuple[str, ...] = ("acct", "account", "a/c", "#", "ending in", "ending with", "ends in",
                                  "last four", "routing", "card")
ACCOUNT_WORD_DIGITS_MIN = 4
ACCOUNT_WINDOW = 3
#: R21: a year 1900-2099 is an account id only directly after one of these words (a "#", "no",
#: "no." or "number" between them is allowed): "account grew in 2025" and "the card from 2024" stay.
ACCOUNT_YEAR_WORDS: tuple[str, ...] = ("acct", "account", "card", "routing")
_YEAR = re.compile(r"(?:19|20)\d{2}")
_BROKER_STYLE_ID = re.compile(r"(?<![A-Za-z0-9])[A-Z]{1,2}\d{6,}(?!\d)")
_ISO_DATE = re.compile(r"(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])")
#: R21: a dashed run shaped like a date (YYYY-MM-DD, MM-DD-YYYY) never joins into one number.
_DASHED_DATE = re.compile(r"\d{4}-\d{1,2}-\d{1,2}|\d{1,2}-\d{1,2}-\d{4}")

#: OCR only: a run of 6 or more digits once the spaces and dashes inside the run are removed.
DIGITS_PATTERN = r"\d{6,}"

#: The author's own institution names are matched only at this length or more (P3b-T2-R3); the
#: house list is matched as written.
MIN_AUTHOR_BROKER_CHARS = 4

#: Rulings P3b-T2-R9 and R18: an address in prose, replaced WHOLE. Three shapes:
#:   * `scheme://...` or `www....` (R9);
#:   * a bare host whose last label is a DECLARED top-level domain, with or without a path (R18);
#:   * ANY bare `host.tld` followed by "/" and a path (R18).
#: Not an address: a ticker class ("BRK.B"), an abbreviation ("U.S.", "e.g."), a version ("v1.2"),
#: a figure ("3.2R") or a price ("132.40") -- no listed TLD, and no "/" after a letter TLD.
#: Trailing sentence punctuation is handed back to the sentence.
URL_TLDS: tuple[str, ...] = ("com", "net", "org", "io", "co", "us", "uk", "ca", "au", "app", "dev", "ai",
                             "finance", "markets", "trade", "biz", "info")
_HOST = r"(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+"
_URL_TAIL = r"[^\s<>\"'`]"
_URL = re.compile(
    r"(?<![\w@.-])(?:[A-Za-z][A-Za-z0-9+.-]*://|www\.)" + _URL_TAIL + r"+"
    + r"|(?<![\w@./-])" + _HOST + r"(?:" + "|".join(URL_TLDS) + r")(?![\w-])(?:[/?#]" + _URL_TAIL + r"*)?"
    + r"|(?<![\w@./-])" + _HOST + r"[A-Za-z]{2,}/" + _URL_TAIL + r"+",
    re.IGNORECASE)
_URL_TRAILING = ".,;:!?)]}'\""

_MONEY = re.compile(MONEY_PATTERN)
_MONEY_EXTRA = tuple(re.compile(p, re.IGNORECASE) for p in MONEY_EXTRA_PATTERNS) + tuple(
    re.compile(p) for p in MONEY_DOLLAR_PREFIX_PATTERNS)
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


def _glued(text: str, start: int) -> str:
    """Ruling P3b-T2-R25: a replacement glued to the word before it ("made$1,240") gets ONE space,
    so it reads "made your value here". Only after a letter or digit: never after a space (no double
    space) and never after punctuation ("(your value here)", "#your value here")."""
    return " " if start > 0 and text[start - 1].isalnum() else ""


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
        return _glued(m.string, m.start()) + LINK_TEXT + s[len(core):]   # R25 (the URL lookbehind
        #                                                                  already refuses a glued word)
    return _URL.sub(repl, text)


def _plan_level_start(text: str, start: int, end: int) -> int | None:
    """Rulings P3b-T2-R26 + R27: where the plan phrase starts, when the number `text[start:end]` is
    the VERY NEXT token after a PLAN_PHRASES entry (at most one PLAN_CONNECTORS entry between) and no
    P&L word follows the number; otherwise None. "take profit 1,240 realized": the P&L word after the
    figure wins, unless it opens the next plan phrase ("stop loss 145 profit target 160")."""
    m = _PLAN_LEVEL.search(text, max(0, start - _PLAN_LOOKBACK), start)
    if m is None:
        return None
    nxt = _NEXT_WORD.match(text, end)
    if nxt and nxt.group(1).casefold() in PNL_MONEY_WORDS and not _PLAN_PHRASE_AT.match(text, nxt.start(1)):
        return None
    return m.start()


def _pnl_money_trigger_before(text: str, start: int, end: int) -> bool:
    """R20 + R26: a P&L money word among the BARE_MONEY_WINDOW words before the number
    `text[start:end]`, leaving out only the words of the plan phrase the number directly follows."""
    words = _words(text[:start])[-BARE_MONEY_WINDOW:]
    plan = _plan_level_start(text, start, end)
    if plan is not None:
        words = words[:max(0, len(words) - len(_words(text[plan:start])))]
    return _has_word(words, PNL_MONEY_WORDS)


def _bare_money_spans(text: str) -> list[tuple[int, int]]:
    """Rulings P3b-T2-R11 and R20: bare numbers that are money because of the word before them."""
    spans = []
    for m in _BARE_NUM.finditer(text):
        if _PERCENT_OR_R_AFTER.match(text, m.end()):
            continue                                   # a percent or an R figure: not money (R20, R22)
        tok = m.group(0)
        digits = sum(c.isdigit() for c in tok)
        suffix = tok[-1] in "kKmM"
        grouped = "," in tok
        at = m.start()
        if _word_before(text, at, BALANCE_WORDS, BARE_MONEY_WINDOW) and (digits >= 3 or "." in tok or suffix):
            spans.append((m.start(), m.end()))
        elif _pnl_money_trigger_before(text, at, m.end()) and (digits >= 3 or grouped or suffix):
            spans.append((m.start(), m.end()))
        elif _word_before(text, at, UP_DOWN_WORDS, BARE_MONEY_WINDOW) and (
                suffix or (grouped and float(tok.lstrip("+-").replace(",", "")) >= 1000)):
            spans.append((m.start(), m.end()))
    return spans


def _money_spans(text: str) -> list[tuple[int, int]]:
    spans = [(m.start(), m.end()) for m in _MONEY.finditer(text)]
    for rx in _MONEY_EXTRA:
        spans += [(m.start(), m.end()) for m in rx.finditer(text)]
    spans += _bare_money_spans(text)
    out = []
    for start, end in spans:                       # M-3: an amount runs on over a trailing ,digits
        run_on = _MONEY_RUN_ON.match(text, end)
        out.append((start, run_on.end() if run_on else end))
    return out


def _joins(run: str) -> bool:
    """Rulings P3b-T2-R16 and R21: may the groups of `run` be read as ONE number? Only
      * card-shaped: EXACTLY 4 groups of 4 digits ("1234 5678 9012 3456"), or
      * across dashes with 3 or more groups ("12-3456-789"), never date-shaped (2026-10-17,
        10-17-2026) and never a two-number range ("5850-5900").
    A space-separated list of levels ("SPX 5800 5850", "targets 145 150 155") is several numbers,
    and a level in a plan is the example's point."""
    seps = _RUN_SEPARATOR.findall(run)
    if not seps:
        return True
    groups = _RUN_SEPARATOR.split(run)
    if len(groups) == 4 and all(len(g) == 4 for g in groups):
        return True
    return (all(set(s) == {"-"} for s in seps) and len(groups) >= 3
            and not _DASHED_DATE.fullmatch(run))


def _year_is_account(text: str, start: int) -> bool:
    """R21: a 1900-2099 year counts only DIRECTLY after acct|account|card|routing (a "#", "no",
    "no." or "number" may sit between)."""
    words = [w for w in _words(text[:start]) if w not in ("#", "no", "no.", "number", "")]
    return bool(words) and words[-1] in ACCOUNT_YEAR_WORDS


_RUN_SEPARATOR = re.compile(r"[ -]+")


def _account_spans(text: str) -> list[tuple[int, int]]:
    spans = []
    for m in _DIGIT_CANDIDATE.finditer(text):
        pieces = ([(m.start(), m.end())] if _joins(m.group(0))
                  else [(m.start() + g.start(), m.start() + g.end()) for g in re.finditer(r"\d+", m.group(0))])
        for start, end in pieces:
            run = text[start:end]
            digits = re.sub(r"[ -]", "", run)
            if len(digits) >= ACCOUNT_DIGITS_MIN and not _ISO_DATE.fullmatch(run):
                spans.append((start, end))
            elif len(digits) >= ACCOUNT_WORD_DIGITS_MIN and _word_before(text, start, ACCOUNT_WORDS,
                                                                           ACCOUNT_WINDOW):
                if _YEAR.fullmatch(digits) and not _year_is_account(text, start):
                    continue                           # R21: a year is not an account id
                spans.append((start, end))
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
        parts.append(_glued(text, start) + _AFTER[kind])
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
    "BROKER_NAMES", "VALUE_TEXT", "BROKER_TEXT", "LINK_TEXT", "BEFORE_MAX", "KINDS", "MONEY_PATTERN",
    "MONEY_EXTRA_PATTERNS", "MONEY_DOLLAR_PREFIX_PATTERNS", "BALANCE_WORDS", "PNL_MONEY_WORDS", "UP_DOWN_WORDS",
    "PLAN_PHRASES", "PLAN_CONNECTORS",
    "URL_TLDS", "ACCOUNT_YEAR_WORDS", "PNL_PATTERN", "PNL_WORDS", "PNL_WINDOW", "PNL_WORDS_AFTER",
    "PNL_WINDOW_AFTER", "ACCOUNT_DIGITS_MIN", "ACCOUNT_WORDS", "ACCOUNT_WORD_DIGITS_MIN", "DIGITS_PATTERN",
    "MIN_AUTHOR_BROKER_CHARS", "broker_patterns", "scrub_urls", "scrub_text", "ocr_warnings",
]
