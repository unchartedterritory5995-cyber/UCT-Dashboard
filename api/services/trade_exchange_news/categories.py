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
    r"|52[- ]week (?:highs?|lows?)|all[- ]time (?:highs?|lows?)|gaps? (?:up|down)|up|down)\s*[.!]?\s*$", re.I)
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


def tickers_for(source: str, content: str) -> list[str]:
    """The canonical resolver, read with the context this label's format calls for."""
    return tr.resolve_tickers(content, SOURCE_TICKER_CONTEXT.get(source, tr.WIRE_NEWS))[:12]
