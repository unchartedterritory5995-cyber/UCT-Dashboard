"""Deterministic event sentiment.

⛔ NO provider sentiment in MVP. The Massive probe measured its classifier at
7.0 positive per negative for Zacks and 2.4 for Motley Fool while GlobeNewswire
sat at 1.4 -- the skew tracked publisher voice, not the market. Worse, 43 of 46
"mention-only" pairs were labelled neutral, so "neutral" was largely a proxy
for "not actually about this company".

So sentiment here is RULES ONLY, and the rules are deliberately narrow. An
unclassified story is the normal case, appears under ALL, and carries no badge.
Sentiment never reorders the feed -- chronology is primary (§21).
"""

from __future__ import annotations

import re

BULLISH = "bullish"
BEARISH = "bearish"
NEUTRAL = ""          # unclassified; stored as empty, shown without a badge

# Both sides of a pair must be unambiguous for a call to be made. Anything
# that trips a rule on both sides ends up unclassified rather than guessed.
_BULL = [
    (re.compile(r"\braises?\s+(?:its\s+)?(?:full[\s-]year\s+|fy\s*\d*\s*|q[1-4]\s*)?"
                r"(?:revenue\s+|earnings\s+|profit\s+|eps\s+)?(?:guidance|outlook|forecast|view)\b", re.I),
     "raised guidance"),
    (re.compile(r"\b(?:beats?|tops?|exceeds?)\s+(?:analyst\s+|consensus\s+|street\s+)?"
                r"(?:estimates?|expectations?|forecasts?|views?)\b", re.I), "beat estimates"),
    (re.compile(r"\brecord\s+(?:quarterly\s+|annual\s+)?(?:revenue|earnings|profit|sales|backlog)\b", re.I),
     "record results"),
    (re.compile(r"\b(?:announces?|declares?)\s+(?:a\s+)?(?:new\s+)?"
                r"(?:\$[\d.]+\s*(?:million|billion)\s+)?(?:share\s+)?(?:buyback|repurchase)\b", re.I),
     "buyback announced"),
    (re.compile(r"\b(?:raises?|increases?|hikes?|boosts?)\s+(?:its\s+)?(?:quarterly\s+)?dividend\b", re.I),
     "dividend raised"),
    (re.compile(r"\b(?:wins?|awarded|secures?)\s+(?:a\s+)?(?:\$[\d.]+\s*(?:million|billion)\s+)?"
                r"(?:contract|order|deal|award)\b", re.I), "contract win"),
    (re.compile(r"\b(?:fda|ema)\s+approv(?:es|al)\b|\breceives?\s+(?:fda\s+)?approval\b", re.I),
     "regulatory approval"),
    (re.compile(r"\bupgrade[sd]?\s+to\s+(?:buy|outperform|overweight)\b"
                r"|\braises?\s+price\s+target\b", re.I), "analyst upgrade"),
]

_BEAR = [
    (re.compile(r"\b(?:cuts?|lowers?|reduces?|slashes?|trims?)\s+(?:its\s+)?"
                r"(?:full[\s-]year\s+|fy\s*\d*\s*|q[1-4]\s*)?"
                r"(?:revenue\s+|earnings\s+|profit\s+|eps\s+)?(?:guidance|outlook|forecast|view)\b", re.I),
     "cut guidance"),
    (re.compile(r"\bmisses?\s+(?:analyst\s+|consensus\s+|street\s+)?"
                r"(?:estimates?|expectations?|forecasts?)\b|\bfalls?\s+short\s+of\b", re.I),
     "missed estimates"),
    (re.compile(r"\b(?:cuts?|suspends?|eliminates?|halts?)\s+(?:its\s+)?dividend\b", re.I),
     "dividend cut"),
    (re.compile(r"\b(?:announces?|begins?)\s+(?:a\s+)?(?:major\s+)?(?:layoffs?|job\s+cuts?|restructuring)\b"
                r"|\bcuts?\s+\d[\d,]*\s+jobs\b", re.I), "layoffs"),
    (re.compile(r"\bdowngrade[sd]?\s+to\s+(?:sell|underperform|underweight)\b"
                r"|\bcuts?\s+price\s+target\b", re.I), "analyst downgrade"),
    (re.compile(r"\brecalls?\b.{0,40}\b(?:units|vehicles|products|devices)\b"
                r"|\bissues?\s+(?:a\s+)?recall\b", re.I), "product recall"),
    (re.compile(r"\b(?:fda|ema)\s+(?:reject|declines?|issues?\s+crl)\b"
                r"|\bcomplete\s+response\s+letter\b|\bclinical\s+(?:hold|failure)\b"
                r"|\btrial\s+(?:fails?|failed|misses?\s+endpoint)\b", re.I), "regulatory setback"),
    (re.compile(r"\bfiles?\s+for\s+(?:chapter\s+(?:7|11)|bankruptcy)\b"
                r"|\bgoing\s+concern\b|\bdelisting\s+notice\b", re.I), "financial distress"),
    (re.compile(r"\b(?:fined|penalt(?:y|ies))\b.{0,30}\b(?:\$[\d.]+|million|billion)\b"
                r"|\bsec\s+charges?\b|\bdoj\s+(?:probe|investigation|charges?)\b", re.I),
     "enforcement action"),
]

# Financing is structurally ambiguous -- a debt raise can be strength or
# distress depending on why. §13 named it explicitly; it stays neutral.
_FORCE_NEUTRAL = re.compile(
    r"\b(?:convertible\s+)?(?:senior\s+)?notes?\s+(?:offering|due)\b"
    r"|\bpublic\s+offering\b|\bprices?\s+\$[\d.]+\s*(?:million|billion)\b"
    r"|\bcredit\s+facility\b|\batm\s+program\b|\bshelf\s+registration\b", re.I)


def classify(title: str, description: str = "", *, category: str = "") -> tuple[str, str]:
    """(sentiment, reason). Empty sentiment means unclassified.

    Only the HEADLINE is scored. A description can qualify a headline in ways
    a regex cannot read, and scoring it produced false positives in testing.
    """
    t = (title or "").strip()
    if not t:
        return NEUTRAL, ""
    if _FORCE_NEUTRAL.search(t):
        return NEUTRAL, ""

    bull = next(((r) for pat, r in _BULL if pat.search(t)), None)
    bear = next(((r) for pat, r in _BEAR if pat.search(t)), None)

    # "Beats estimates but cuts guidance" -- genuinely mixed. Do not pick a side.
    if bull and bear:
        return NEUTRAL, ""
    if bull:
        return BULLISH, bull
    if bear:
        return BEARISH, bear
    return NEUTRAL, ""
