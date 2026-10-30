"""Trade Exchange News -- the headline's CATEGORY and its ticker context, derived.

⭐ DERIVED, NEVER STORED IN PLACE OF THE SOURCE. The provider's ``source`` label
(``TX-News``, ``TX-PressRelease`` ...) is kept verbatim in every record; the
category is computed from it (and, for broad labels only, from the headline) each
time an event is built -- so stored history and new arrivals always agree, and a
rule change re-labels old rows without a migration.

⛔ FAST AND LOCAL: a source lookup plus a few compiled regexes, microseconds per
headline, on the writer thread that already builds the event. No model call, no
network, nothing that could hold a breaking headline back.

Rules, in order (the first that applies wins):
  1. An authoritative source label maps straight to its category
     (``SOURCE_CATEGORY``). A press release is still re-labelled ``Earnings`` when it
     plainly reports results or guidance -- the more specific fact.
  2. A broad label (``TX-News`` / ``TX-News1``) is classified CONSERVATIVELY from the
     text: Earnings, Options, Price, Macro -- each only on strong evidence; anything
     else is ``News``.
  3. A label we have never seen is ``Other`` -- never a guess.
"""
from __future__ import annotations

import re

from api.services import ticker_resolver as tr

NEWS, MACRO, OPTIONS, PRESS, EARNINGS, PRICE, FILING, OTHER = (
    "News", "Macro", "Options", "Press Release", "Earnings", "Price", "Filing", "Other")
CATEGORIES = (NEWS, MACRO, OPTIONS, PRESS, EARNINGS, PRICE, FILING, OTHER)

#: Provider labels whose meaning is the category itself (observed 2026-10-29).
SOURCE_CATEGORY = {
    "TX-PressRelease": PRESS,
    "TX-Options": OPTIONS,
    "TX-Filings": FILING,
}
#: Broad labels: the text decides, conservatively.
BROAD_SOURCES = frozenset({"TX-News", "TX-News1", "TXNews1"})

#: Which canonical resolver context reads each label's text (ticker_resolver owns the rules).
SOURCE_TICKER_CONTEXT = {
    "TX-PressRelease": tr.WIRE_RELEASE,
    "TX-Filings": tr.WIRE_FILING,
}

_EARNINGS = re.compile(
    r"\b(?:reports?|reported|announces?|posts?|delivers?)\b[^.;]{0,60}\b(?:results|earnings)\b"
    r"|\b(?:Q[1-4]|first|second|third|fourth)[- ](?:quarter|qtr)\b[^.;]{0,60}\b(?:results|earnings|revenue|EPS)\b"
    r"|\b(?:raises|cuts|lowers|reaffirms|reiterates|issues|updates|withdraws)\b[^.;]{0,40}\b(?:guidance|outlook|forecast)\b"
    r"|\bEPS\b[^.;]{0,30}\b(?:vs\.?|est|estimate|consensus)\b"
    r"|\b(?:beats|misses|tops)\b[^.;]{0,30}\b(?:estimates|expectations|consensus)\b",
    re.I)
_OPTIONS = re.compile(
    r"\bunusual options\b|\boptions activity\b|\b(?:call|put) (?:sweep|buyer|seller|volume|block)s?\b"
    r"|\b(?:calls|puts) (?:bought|sold|trade|traded)\b", re.I)
#: A price line: a symbol and one or two price words, nothing else ("GOOGL lows", "ADT Open").
_PRICE = re.compile(
    r"^\s*\$?[A-Z][A-Z0-9.\-]{0,9}\s+(?:new\s+)?(?:lows?|highs?|open|opens|opened|halted|halt|resumed"
    r"|52[- ]week (?:highs?|lows?)|all[- ]time (?:highs?|lows?)|gaps? (?:up|down)|up|down|green|red|flat"
    r"|[-+]?\$?\d+(?:\.\d+)?%?)\s*[.!]?\s*$", re.I)
_MACRO = re.compile(
    r"\b(?:FED|FOMC|POWELL|FEDERAL RESERVE|RATE (?:CUT|HIKE)S?|INTEREST RATES?|RATES|INFLATION|CPI|PPI|PCE|GDP"
    r"|PAYROLLS?|JOBLESS CLAIMS|UNEMPLOYMENT|JOBS REPORT|TREASURY|TREASURIES|YIELDS?|TARIFFS?|BESSENT|HASSETT"
    r"|ECB|BOJ|BOE|PBOC|CENTRAL BANK|RECESSION|DEBT CEILING|SHUTDOWN|RETAIL SALES|ISM|PMI)\b", re.I)


def category_for(source: str, content: str) -> str:
    text = content or ""
    cat = SOURCE_CATEGORY.get(source)
    if cat == PRESS:
        return EARNINGS if _EARNINGS.search(text) else PRESS
    if cat:
        return cat
    if source not in BROAD_SOURCES:
        return OTHER
    if _PRICE.match(text):
        return PRICE
    if _EARNINGS.search(text):
        return EARNINGS
    if _OPTIONS.search(text):
        return OPTIONS
    if _MACRO.search(text):
        return MACRO
    return NEWS


#: Labels whose text names companies in prose (a filing line's names are people/roles).
NAME_SOURCES_EXCLUDED = frozenset({"TX-Filings"})


def tickers_for(source: str, content: str) -> list[str]:
    """Explicit symbols (the canonical resolver, in this label's context) plus the
    symbols of high-confidence company NAMES -- what filters and alerts match on."""
    out = tr.resolve_tickers(content, SOURCE_TICKER_CONTEXT.get(source, tr.WIRE_NEWS))
    for _text, sym in mentions_for(source, content):
        if sym not in out:
            out.append(sym)
    return out[:12]


def mentions_for(source: str, content: str) -> list[list[str]]:
    """[[text as written, symbol]] for company names to link in the headline."""
    if source in NAME_SOURCES_EXCLUDED:
        return []
    explicit = set(tr.resolve_tickers(content, SOURCE_TICKER_CONTEXT.get(source, tr.WIRE_NEWS)))
    return [[t, s] for t, s in tr.resolve_company_mentions(content, explicit=explicit)]


#: ⛔ Graphic-only placeholders: Trade Exchange's own app shows a picture under
#: these, but the webhook carries only the label (no image, embed or extra field
#: has been seen: admin status extra_keys_seen is empty). CONFIRMED labels only --
#: a short headline is NOT a placeholder ("GOOGL lows", "VIX 16.40" stay).
GRAPHIC_PLACEHOLDERS = frozenset({"CRYPTO"})
_INVISIBLE = re.compile(r"[\s\u200b-\u200f\u2060\ufeff\u00ad]+")


def placeholder_for(content: str) -> str | None:
    visible = _INVISIBLE.sub("", content or "")
    if not visible:
        return "graphic"                 # nothing to read: an image-only post
    if visible.upper() in GRAPHIC_PLACEHOLDERS and (content or "").strip().upper() in GRAPHIC_PLACEHOLDERS:
        return "graphic"
    return None


# ── market-impact marks (``impact``) ─────────────────────────────────────────
#
# ⭐ A FACT ABOUT THE TEXT, NEVER A PREDICTION. A headline is marked only when it
# plainly reports one of a short list of event kinds traders treat as material --
# each a compiled rule that can be read and tested, no model, no score. Anything
# uncertain is left unmarked (precision over recall); the widget explains every
# rule in its tooltip. Derived like the category, at every event build.
HALT, CENTRAL_BANK, ECON_RELEASE, MNA, BANKRUPTCY, REGULATORY, GUIDANCE, LEADERSHIP = (
    "halt", "central_bank", "econ_release", "mna", "bankruptcy", "regulatory", "guidance", "leadership")

#: [kind, rule] in order; the first that matches wins.
_IMPACT_RULES = (
    (HALT, re.compile(
        r"\b(?:trading\s+)?(?:halted|halts? trading|trading halt|resumes? trading|trading resumes?"
        r"|LULD|circuit breaker)\b", re.I)),
    # The bank itself is the subject of the decision verb ("FED HOLDS RATES", "ECB cuts
    # its deposit rate") -- never "ECB officials are ready to raise rates" (commentary).
    (CENTRAL_BANK, re.compile(
        r"\b(?:FED|FOMC|FEDERAL RESERVE|ECB|BOJ|BOE|BANK OF (?:JAPAN|ENGLAND|CANADA)|PBOC|SNB|RBA|RBNZ)"
        r"\s+(?:unexpectedly\s+)?(?:holds|keeps|leaves|raises|hikes|cuts|lowers|maintains"
        r"|held|kept|left|raised|hiked|cut|lowered)\b[^.;]{0,30}\b(?:rates?|policy rate|benchmark|funds rate)\b"
        r"|\b(?:FOMC|FED|ECB|BOJ|BOE) (?:RATE|POLICY|INTEREST RATE) DECISION\b", re.I)),
    (ECON_RELEASE, re.compile(
        r"\b(?:CPI|CORE CPI|PPI|CORE PPI|PCE|CORE PCE|NONFARM PAYROLLS|NON-FARM PAYROLLS|PAYROLLS|GDP"
        r"|INITIAL JOBLESS CLAIMS|JOBLESS CLAIMS|UNEMPLOYMENT RATE|RETAIL SALES|ISM (?:MANUFACTURING|SERVICES))\b"
        r"[^.;]{0,40}?(?:[-+]?\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*[KM]\b|\bACTUAL\b|\bVS\.?\s|\bEST\b|\bEXP\b)", re.I)),
    (MNA, re.compile(
        r"\b(?:to acquire|agrees? to (?:buy|acquire|be acquired|merge)|definitive (?:merger )?agreement"
        r"|merger agreement|to be acquired by|takeover bid|tender offer for|to go private)\b", re.I)),
    (BANKRUPTCY, re.compile(r"\b(?:files? for (?:chapter 11|bankruptcy)|chapter 11 (?:bankruptcy|protection))\b", re.I)),
    (REGULATORY, re.compile(
        r"\bFDA (?:approves|approval of|grants? (?:accelerated )?approval|rejects|declines to approve)\b"
        r"|\bcomplete response letter\b|\bSEC charges\b|\bDOJ sues\b", re.I)),
    (GUIDANCE, re.compile(
        r"\b(?:raises|cuts|lowers|withdraws|suspends)\b[^.;]{0,40}\b(?:guidance|outlook|forecast)\b", re.I)),
    (LEADERSHIP, re.compile(
        r"\b(?:CEO|chief executive)\b[^.;]{0,30}\b(?:resigns|to step down|steps down|is out|ousted|fired)\b", re.I)),
)

#: What each mark means, word for word what the widget's tooltip says.
IMPACT_REASONS = {
    HALT: "Trading halt or resumption",
    CENTRAL_BANK: "Central-bank rate decision",
    ECON_RELEASE: "Major economic release (with a figure)",
    MNA: "Merger or acquisition agreement",
    BANKRUPTCY: "Bankruptcy filing",
    REGULATORY: "Regulatory decision (FDA, SEC, DOJ)",
    GUIDANCE: "Guidance raised, cut or withdrawn",
    LEADERSHIP: "CEO departure",
}

#: Labels whose text is a price line or a filing form: their wording is not prose.
_IMPACT_SKIP_SOURCES = frozenset({"TX-Filings"})


def impact_for(source: str, content: str) -> str | None:
    """The event kind a headline plainly reports (``IMPACT_REASONS`` key), or None."""
    if source in _IMPACT_SKIP_SOURCES:
        return None
    text = content or ""
    for kind, rule in _IMPACT_RULES:
        if rule.search(text):
            return kind
    return None
