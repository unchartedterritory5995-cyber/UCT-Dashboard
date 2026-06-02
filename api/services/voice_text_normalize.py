"""
Normalize finance text for natural-sounding TTS read-aloud.

Raw text-to-speech mangles the things a Morning Wire briefing is full of:
ticker symbols ("XLK"), finance abbreviations ("BMO", "EMA"), and signed
percentages ("+2.23%"). This expands them to their spoken forms so the read
sounds like a person, not a screen reader on a spreadsheet.

Applied server-side, only on the read-aloud path, right before synthesis.
"""

import os
import re
import json
import functools

_HERE = os.path.dirname(__file__)
_CAP_UNIVERSE = os.path.join(_HERE, "..", "data", "cap_universe.json")

# Unambiguous finance abbreviations → spoken form. Keys matched whole-word,
# case-sensitive. Deliberately excludes anything that doubles as a common
# ticker (e.g. "GS", "PT") unless it's far more often an abbreviation.
_ABBREV = {
    "BMO": "before market open",
    "AMC": "after market close",
    "EMA": "E M A",
    "SMA": "S M A",
    "WMA": "W M A",
    "VWAP": "V-WAP",
    "AVWAP": "anchored V-WAP",
    "EPS": "E P S",
    "ETF": "E T F",
    "ETFs": "E T Fs",
    "YTD": "year to date",
    "IPO": "I P O",
    "NFP": "non-farm payrolls",
    "CPI": "C P I",
    "PPI": "P P I",
    "PCE": "P C E",
    "GDP": "G D P",
    "FOMC": "F O M C",
    "RSI": "R S I",
    "ATR": "A T R",
    "ADR": "A D R",
    "ATH": "all-time high",
    "LOD": "low of day",
    "LODs": "lows of day",
    "HOD": "high of day",
    "YoY": "year-over-year",
    "QoQ": "quarter-over-quarter",
    "MoM": "month-over-month",
    "EOD": "end of day",
    "PMI": "P M I",
}

# All-caps tokens that ARE valid tickers but are far more often English words
# or non-ticker acronyms in prose — never spell these out as letters.
_NEVER_SPELL = {
    "A", "I", "AM", "AN", "AS", "AT", "BE", "BY", "DO", "GO", "HE", "IF", "IN",
    "IS", "IT", "ME", "MY", "NO", "OF", "ON", "OR", "SO", "TO", "UP", "US", "WE",
    "AI", "OK", "PM", "ET", "EST", "EDT", "UTC", "ALL", "AND", "ANY", "ARE",
    "BUT", "CAN", "FED", "FOR", "GET", "HAS", "HAD", "HER", "HIM", "HIS", "HOW",
    "ITS", "LET", "MAY", "NEW", "NOT", "NOW", "ONE", "OUR", "OUT", "OWN", "PER",
    "PUT", "SEE", "SHE", "THE", "TWO", "USE", "WAS", "WAY", "WHO", "WHY", "YES",
    "YOU", "CEO", "CFO", "COO", "CNBC", "USA", "UK", "EU", "OPEC", "MOU", "VS",
    "OPEX", "FAANG", "CALL", "CALLS", "DAY", "RUN", "GAP", "BIG", "TON", "EYE",
    "RED", "WAY", "REAL", "OPEN", "LOW",
}


@functools.lru_cache(maxsize=1)
def _ticker_set() -> frozenset:
    try:
        with open(_CAP_UNIVERSE, encoding="utf-8") as f:
            data = json.load(f)
        return frozenset(t.upper() for t in data if isinstance(t, str))
    except Exception:
        return frozenset()


def _spell(sym: str) -> str:
    """NVDA -> 'N-V-D-A' (hyphens read as crisp letter breaks by TTS)."""
    return "-".join(list(sym.upper()))


_ABBREV_RE = re.compile(r"\b(" + "|".join(re.escape(k) for k in _ABBREV) + r")\b")
# Signed percent: +2.23% / -0.55% / −0.45% (unicode minus)
_SIGNED_PCT_RE = re.compile(r"([+\-−])\s*(\d+(?:\.\d+)?)\s*%")
# Bare uppercase token, 1-5 letters (candidate ticker)
_CAPS_RE = re.compile(r"\b[A-Z]{1,5}\b")
# Cashtag: $XLK (letter after $, so dollar amounts like $3.23 are untouched)
_CASHTAG_RE = re.compile(r"\$([A-Za-z]{1,5})\b")


def normalize_for_speech(text: str) -> str:
    """Expand tickers, finance abbreviations, and signed percents to spoken form."""
    if not text:
        return text

    # 1) Cashtags → spelled letters (explicit ticker intent).
    text = _CASHTAG_RE.sub(lambda m: _spell(m.group(1)), text)

    # 2) Signed percentages → "up/down N percent".
    def _pct(m):
        sign = "up" if m.group(1) == "+" else "down"
        return f"{sign} {m.group(2)} percent"
    text = _SIGNED_PCT_RE.sub(_pct, text)

    # 3) Finance abbreviations → spoken form.
    text = _ABBREV_RE.sub(lambda m: _ABBREV[m.group(1)], text)

    # 4) Bare tickers → spelled letters (only real tickers that aren't common
    #    words / already-handled abbreviations).
    tickers = _ticker_set()

    def _maybe_ticker(m):
        tok = m.group(0)
        if tok in _NEVER_SPELL or len(tok) < 2:
            return tok
        if tok in tickers:
            return _spell(tok)
        return tok
    text = _CAPS_RE.sub(_maybe_ticker, text)

    # 5) Remaining bare "%" → " percent"; tidy whitespace.
    text = text.replace("%", " percent")
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text
