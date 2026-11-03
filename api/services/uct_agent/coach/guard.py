"""The coach guard (W3-2): a deterministic evaluation of every coach reply, applied SERVER-SIDE before the reply
is stored or sent. Mirrored in the browser by app/src/agent/coach/guard.js (same regexes, same codes); both read
the same adversarial cases, app/src/agent/__fixtures__/coachGuardCases.json.

Four checks, in this order (codes):
  unsupported   an unsupported conclusion: guaranteed, will go up/down, can't lose, sure thing, buy now / sell now,
                a price target, "always works", risk-free ... (a NEGATED guarantee -- "no guarantee" -- is a hedge,
                not a claim, and is removed before the scan)
  order         order language: buy/sell/short ... now, N shares, place an order, enter/exit now, you should buy
  figure        a figure in the reply that is in none of the inputs (the concept text, the chart observation, the
                journal stats the browser computed, the member's own message): every number is traceable or the
                reply is replaced
  uncertainty   a reply about OUTCOMES (will, likely, odds, follow-through, breakout, target ...) with no hedge
                sentence (may / might / could / often / not guaranteed / depends / historically / can fail ...)

`enforce` replaces a violating reply with FIXED (never edits it: an edited sentence could still carry the claim in
other words) and reports the codes; the caller logs the codes only (value-free, ADR-005 style). Every coach reply
ends with the educational footer.

MUTATION NOTE (how the suite proves itself): tests/test_uct_agent_coach_guard.py runs the fixture both ways -- every
`violations` case must trip exactly its codes and every `clean` case none. Deleting any one regex below makes at
least one violating case pass (the fixture names which phrase each regex is for), and loosening the hedge list makes
a clean case fail; the vitest mirror runs the identical fixture, so the two implementations cannot drift apart.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Iterable

FOOTER = "Educational, not advice."
FIXED = ("I can explain the concept and what to check on your chart, but I can't make that claim. "
         + FOOTER)
CODES = ("unsupported", "order", "figure", "uncertainty")

# a negated guarantee is a hedge: removed before the unsupported scan
_NEGATED = re.compile(r"\b(?:no|not|never|isn't|isnt|aren't|arent|without|cannot be|can't be|cant be|nothing is|"
                      r"there is no|there's no|there are no|doesn't|does not|don't|do not)\s+(?:a\s+|any\s+)?guarantee[sd]?\b", re.I)

# W3 review: every check runs on NORMALISED text -- NFKC, curly quotes to straight, zero-width characters dropped, and
# a small set of Cyrillic / Greek look-alikes mapped to Latin (a "guaranteed" spelled with Cyrillic e is "guaranteed")
_CONFUSABLES = str.maketrans({
    "‘": "'", "’": "'", "ʼ": "'", "´": "'", "`": "'", "“": '"', "”": '"',
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x",
    "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "һ": "h", "ӏ": "l", "к": "k",
    "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O",
    "Р": "P", "С": "C", "Т": "T", "Х": "X", "І": "I",
    "ο": "o", "α": "a", "ε": "e", "ι": "i", "ν": "v", "ρ": "p", "τ": "t", "κ": "k",
    "Ο": "O", "Α": "A", "Ε": "E", "Ι": "I", "Κ": "K", "Ρ": "P", "Τ": "T",
    "​": None, "‌": None, "‍": None, "⁠": None, "﻿": None, "­": None,
})


def normalize(text: str) -> str:
    """The text every check reads (NFKC + the confusables above)."""
    return unicodedata.normalize("NFKC", str(text or "")).translate(_CONFUSABLES)


# the mandated footer is NOT a hedge: it is removed before the uncertainty check (W3 review C2)
_FOOTER_RX = re.compile(r"educational,?\s*not\s+(?:financial\s+|investment\s+)?advice\.?", re.I)

_MOVE = (r"(?:go|move|head|trade|rally|rip|run|climb|rise|fall|drop|tank|crash|break ?out|bounce|recover|double|"
         r"triple|soar|plunge|squeeze|explode|moon|continue|hold|keep going|take off|hit|reach)")
UNSUPPORTED = [
    ("guarantee", re.compile(r"\bguarantee[sd]?\b", re.I)),
    ("will-move", re.compile(r"\bwill\s+(?:definitely\s+|certainly\s+|surely\s+|almost certainly\s+|probably\s+)?" + _MOVE + r"\b", re.I)),
    ("going-to", re.compile(r"\b(?:is|are|it's|its|this is|that's)\s+(?:going to|gonna)\s+" + _MOVE + r"\b", re.I)),
    ("cant-lose", re.compile(r"\bcan(?:'t|not|t)\s+(?:lose|fail|miss|go wrong|go down|go lower)\b", re.I)),
    ("wont-lose", re.compile(r"\b(?:won't|wont|will not)\s+(?:lose|fail|miss|go wrong|go down|go lower|drop|fall|break down)\b", re.I)),
    ("confident", re.compile(r"\b(?:i'm|i am|im|we're|we are|i feel)\s+(?:very\s+|pretty\s+|quite\s+|fairly\s+|really\s+|highly\s+|so\s+)?"
                             r"(?:confident|certain|convinced)\b", re.I)),
    ("headed-to", re.compile(r"\b(?:heads?|headed|heading|going|goes|gets?|run(?:s|ning)?|climb(?:s|ing)?|rall(?:y|ies|ying)|"
                             r"ride (?:it|this|them|that))\s+(?:up\s+|back\s+|higher\s+|lower\s+|all the way\s+)?(?:to|toward|towards|for)\s+\$?\d", re.I)),
    ("ride-it", re.compile(r"\bride (?:it|this|them|that)\s+(?:up|higher|to|all the way)\b", re.I)),
    ("odds-favor", re.compile(r"\b(?:odds|chances|probabilit(?:y|ies))\s+(?:strongly\s+|heavily\s+|clearly\s+|really\s+)?"
                              r"(?:favou?r|are (?:good|high|great|strong|in (?:your|our|the bulls'?|the bears'?) favou?r))\b", re.I)),
    ("sure-thing", re.compile(r"\b(?:sure (?:thing|bet|win|winner|shot)|for sure|dead cert|no[- ]brainer|slam dunk|lock)\b", re.I)),
    ("certain", re.compile(r"\b(?:is|are|it's|its|this is|that's)\s+(?:a\s+)?(?:certain|definite|definitely|certainly|sure)\s+(?:to|thing|bet|win|winner)\b", re.I)),
    ("buy-sell-now", re.compile(r"\b(?:buy|sell|short)\s+(?:it\s+|this\s+|them\s+|here\s+)?(?:now|today|immediately|right now|asap)\b", re.I)),
    ("price-target", re.compile(r"\b(?:price target|target price|my target|a target of|targets? (?:is|are|at)?\s*\$?\d|"
                                r"should (?:hit|reach|get to|be at|trade at)\s+\$?\d|(?:upside|downside) to \$?\d)", re.I)),
    ("always-works", re.compile(r"\b(?:always works?|never fails?|works every time|never loses?|always wins?|can only go (?:up|down|higher|lower)|"
                                r"has to (?:go|rally|bounce|drop|rise|fall)|bound to (?:go|rally|bounce|drop|rise|fall)|"
                                r"100 ?% (?:certain|sure|win|success|safe)|risk[- ]free|no (?:risk|downside|doubt)|zero risk|"
                                r"definitely (?:will|going)|without (?:a )?doubt|cannot fail|can't fail)\b", re.I)),
]

ORDER = [
    ("trade-now", re.compile(r"\b(?:buy(?:ing)?|sell(?:ing)?|short(?:ing)?|cover(?:ing)?|go long|go short|get long|get short|enter|exit|"
                             r"load(?:ing)? up|size up|double down|trim(?:ming)?|take profits?|scale (?:in|out)|"
                             r"grab(?:bing)? (?:a |some )?(?:position|shares|stake)|open(?:ing)? a position|"
                             r"add to (?:your |the )?position)\b[^.!?\n]{0,40}?\b(?:now|today|here|immediately|right now|at the open|"
                             r"at open|before the close|into the close|tomorrow|premarket|pre-market)\b", re.I)),
    ("shares", re.compile(r"\b(?:buy|sell|short|purchase|pick up|grab|dump|unload)\s+(?:\d[\d,]*\s+|some\s+|more\s+|a few\s+)?shares\b", re.I)),
    ("place-order", re.compile(r"\b(?:place|put in|enter|submit|set|execute)\s+(?:an?\s+|the\s+|your\s+)?(?:buy|sell|limit|market|stop|stop-loss|bracket)?\s*(?:order|trade)\b", re.I)),
    ("you-should", re.compile(r"\b(?:you should|you need to|you must|you have to|i would|i'd|i'd say|go ahead and|my advice is to|time to|"
                              r"consider|i'd be|i would be|i'm|i am)\s+"
                              r"(?:(?:buy|sell|short)(?:ing)?|cover|go long|go short|get in|get out|take the trade|take this trade|add|enter|exit|bail|dump)\b", re.I)),
    ("load-up", re.compile(r"\bload(?:ing)? up\b|\btrim(?:ming)?\s+(?:half|some|a third|a quarter|\d)", re.I)),
    ("take-trade", re.compile(r"\b(?:take|make) (?:the|this|that) trade\b|\bpull the trigger\b|\bget in (?:now|here|today)\b|\bget out (?:now|here|today)\b", re.I)),
]

OUTCOME = re.compile(r"\b(?:will|likely|unlikely|probab\w*|odds|chances?|expect\w*|outcomes?|follow[- ]?through|work(?:s|ed)? out|"
                     r"play(?:s|ed)? out|next (?:move|session|week|day|leg)|going to|gonna|succeed\w*|fail\w*|targets?|upside|downside|"
                     r"forecast\w*|predict\w*|rally|rallies|bounce\w*|break ?outs?|breakdowns?|continu\w*|resolv\w*|should (?:hold|work|go|rally|bounce))\b", re.I)
HEDGE = re.compile(r"\b(?:may|might|could|often|sometimes|tends? to|tend|not guaranteed|no guarantee|no guarantees|isn't guaranteed|"
                   r"uncertain\w*|not certain|no certainty|no way to know|cannot know|can't know|nobody knows|unknown|"
                   r"doesn't always|does not always|not always|don't always|do not always|depends|historically|in the past|hypothesis|"
                   r"one input|not a forecast|not a prediction|not a promise|not predictions|can fail|could fail|might fail|"
                   r"may fail|can reverse|could reverse|can break|could break|can still|could still|may still|no pattern|cannot be known|"
                   r"can't be known|possibility|possible|possibly|perhaps|not a signal|not a rule|not rules|estimate\w*)\b", re.I)

# a figure: 20, 20.5, 1,000, $10, 15%, -3, 2R (the letter after is fine); a letter BEFORE a digit is not a figure ("v2")
_FIGURE = re.compile(r"(?<![A-Za-z0-9])[-+]?\$?(\d[\d,]*(?:\.\d+)?)%?")


def figures(text: str) -> set[str]:
    """Every number in the text, canonical ('1,000' -> '1000', '20.50' -> '20.5')."""
    out: set[str] = set()
    for m in _FIGURE.finditer(str(text or "")):
        raw = m.group(1).replace(",", "")
        try:
            v = float(raw)
        except ValueError:
            continue
        out.add(str(int(v)) if v.is_integer() else repr(v).rstrip("0").rstrip("."))
    return out


def _input_text(inputs: Iterable[str] | str | None) -> str:
    if inputs is None:
        return ""
    if isinstance(inputs, str):
        return inputs
    return "\n".join(str(x) for x in inputs if x)


def unsupported(text: str) -> list[str]:
    t = _NEGATED.sub(" ", normalize(text))
    return [name for name, rx in UNSUPPORTED if rx.search(t)]


def order_language(text: str) -> list[str]:
    t = normalize(text)
    return [name for name, rx in ORDER if rx.search(t)]


def untraceable_figures(text: str, inputs: Iterable[str] | str | None) -> list[str]:
    allowed = figures(_input_text(inputs))
    return sorted(f for f in figures(text) if f not in allowed)


def about_outcomes(text: str) -> bool:
    return bool(OUTCOME.search(normalize(text)))


def has_hedge(text: str) -> bool:
    """A real hedge -- the mandated footer is stripped first, so it can never stand in for one (W3 review C2)."""
    return bool(HEDGE.search(_FOOTER_RX.sub(" ", normalize(text))))


def check(reply: str, inputs: Iterable[str] | str | None = None) -> list[str]:
    """The violation codes of a reply (empty = clean), in CODES order."""
    codes: list[str] = []
    if unsupported(reply):
        codes.append("unsupported")
    if order_language(reply):
        codes.append("order")
    if untraceable_figures(normalize(reply), inputs):
        codes.append("figure")
    if about_outcomes(reply) and not has_hedge(reply):
        codes.append("uncertainty")
    return codes


def ensure_footer(text: str) -> str:
    t = str(text or "").rstrip()
    if "educational" in t.lower():
        return t
    return (t + "\n\n" + FOOTER) if t else FOOTER


def enforce(reply: str, inputs: Iterable[str] | str | None = None) -> dict:
    """{text, violations}: the reply with the footer, or FIXED when it violates (never an edited reply)."""
    codes = check(reply, inputs)
    if codes:
        return {"text": FIXED, "violations": codes}
    return {"text": ensure_footer(reply), "violations": []}
