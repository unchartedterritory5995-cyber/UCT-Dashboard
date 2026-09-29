"""FROZEN pre-TERM-064 oracle — F1 AI Search query parser (`ai_search._extract_tickers`).

Copied VERBATIM from `api/routers/ai_search.py` at base 15a100749 (lines 690-791) so the parity rail in
`tests/test_ticker_resolver.py` compares the ONE resolver against the code it
replaced, never against expectations typed by hand. ⛔ Never edit this file: a
behaviour change in the resolver is declared in that test's DECLARED_DELTAS, not
absorbed here. The universe is injected through `_UNI` / `UNIVERSE` by the test.
"""
import re

_TICKER_STOP = {
    "A", "I", "AI", "AN", "AT", "BE", "BY", "DO", "GO", "IF", "IN", "IS", "IT",
    "ME", "MY", "NO", "OF", "OK", "ON", "OR", "SO", "TO", "UP", "US", "WE",
    "ALL", "AND", "ANY", "ARE", "BIG", "CAN", "CEO", "CFO", "DID", "EPS", "ETF",
    "FOR", "GET", "HAS", "HOW", "IPO", "LOW", "NEW", "NOW", "OUT", "PE", "SEC",
    "THE", "TOP", "USD", "WAS", "WHO", "WHY", "YES", "YOY", "HIGH", "WHAT",
    "WEEK", "GOOD", "BEST", "NEXT", "LAST", "MOVE", "NAME", "LIST",
    # Options / trading jargon that collide with real cap_universe tickers and
    # would inject the WRONG company as authoritative desk context:
    "PM", "AM", "MA", "DTE", "OI", "DD", "ES", "DOW", "EOD", "ATH", "ATL",
    "IV", "RSI", "MACD", "VWAP", "ADR", "RS", "PT", "EOW", "EOM", "YTD", "GEX",
    "OTM", "ITM", "ATM", "COT", "FOMC", "CPI", "GDP", "PCE", "QE", "SI", "FA",
    "TA", "EV", "TAM", "YOLO", "HODL", "FUD", "DCA", "PA",
}
_UNI: set | None = None
# A stop-listed symbol that IS a real ticker (NOW=ServiceNow, LOW=Lowe's,
# HAS=Hasbro, ALL=Allstate, DD=DuPont, PM=Philip Morris, MA=Mastercard …) can
# still be a genuine mention — extract it only on a STRONG ticker-position cue.
_STRONG_TICKER_CUE = re.compile(
    r"(?:\b(?:is|why is|why did|about|on|buy|sell|short|long|thoughts on|hold|own"
    r"|trading|chart|setup on|flow on|price of)\s+)([A-Z]{1,5})\b"
    r"|\b([A-Z]{1,5})\s+(?:stock|shares|calls?|puts?|earnings|chart)\b")
# Case-INSENSITIVE cue for lowercase/mixed-case bare tickers. Bare lowercase
# used to be dropped entirely ("thoughts on nvda" got ZERO desk grounding — a
# realistic phone typing pattern, since /ai-search is the mobile home). The
# collision risk that justified dropping it ("now", "open", "run" are all real
# tickers) is bounded three ways: a lowercase word must sit in a strong ticker
# POSITION, be in cap_universe, and NOT be stop-listed (stop-listed names like
# NOW/LOW/ALL stay uppercase-or-cashtag only — "buy now" is English).
# ⛔ Deliberately NARROWER than the uppercase cue: bare "on"/"is"/"hold"/
# "trading" made ordinary idioms extract — "what's on deck" → DECK, "hold cash"
# → CASH, "trading well" → WELL (2026-08-28 review). Only cues that read as an
# explicit ticker reference survive on this path.
_LOWER_TICKER_CUE = re.compile(
    r"(?:\b(?:thoughts on|setup on|flow on|about|price of|chart"
    r"|buy|sell|short)\s+)([A-Za-z]{2,5})\b"
    r"|\b([A-Za-z]{2,5})\s+(?:stock|shares|calls?|puts?|earnings|chart)\b", re.I)
# English words that ARE real tickers and still land in the narrowed cue
# positions ("buy tech", "buy gold", "sell bill"). Blocked on the LOWERCASE
# path only — uppercase/cashtag still reaches every one of them. Extended
# 2026-08-28 with the review's verified cap_universe collisions.
_LOWER_ONLY_STOP = {
    "TECH", "LIFE", "PLAY", "REAL", "OPEN", "RUN", "GAP", "EDGE", "CORE",
    "HOPE", "MIND", "CAMP", "RIDE", "WING", "CAKE", "NICE", "COOL", "FAST",
    "SAFE", "PATH", "LOVE", "GOLD", "BABY", "GAME", "FUND", "BOOT", "TREE",
    "CASH", "DECK", "WELL", "NET", "TWO", "BILL", "SPOT", "GAIN", "TEN",
    "BIT", "LOT", "TAP", "MAIN", "HERE", "SOME", "MORE", "IT", "SO",
}


def _universe() -> set:
    global _UNI
    if _UNI is None:
        try:
            from api.routers.ticker_search import _UNIVERSE
            _UNI = set(_UNIVERSE)
        except Exception:
            _UNI = set()
    return _UNI


def _extract_tickers(query: str) -> list[str]:
    """Tickers named in the query, in document order (order matters — the
    grounding caps at the first 2-3 symbols).

    - $CASHTAG (incl. class shares $BRK.B / $BRK-B) is always trusted; the
      trailing (?![A-Za-z]) makes $NVIDIA match nothing rather than a fragment.
    - bare UPPERCASE must be in cap_universe and not a stopword; a stop-listed
      symbol that IS a real ticker (NOW/LOW/HAS…) needs a strong position cue.
    - bare lowercase/mixed-case must be in cap_universe, NOT stop-listed, AND
      sit in a strong ticker position (_LOWER_TICKER_CUE) — "thoughts on nvda"
      grounds; "the gap up" and "buy now" stay English.
    """
    q = query or ""
    strong = {(a or b).upper() for a, b in _STRONG_TICKER_CUE.findall(q)}
    lower_cued = {(a or b).upper() for a, b in _LOWER_TICKER_CUE.findall(q)}
    uni = _universe()
    out: list[str] = []
    # One left-to-right pass over ALL forms so order = mention order.
    for m in re.finditer(r"\$([A-Za-z]{1,5}(?:[.\-][A-Za-z])?)(?![A-Za-z])|\b([A-Za-z]{2,5})\b", q):
        cash, bare = m.group(1), m.group(2)
        if cash:
            sym = cash.upper().replace("-", ".")
            if sym not in out:
                out.append(sym)
            continue
        sym = bare.upper()
        if sym in out:
            continue
        if bare != sym:
            # lowercase/mixed-case path: cue + universe + never a stop-listed word
            if (sym in lower_cued and sym in uni
                    and sym not in _TICKER_STOP and sym not in _LOWER_ONLY_STOP):
                out.append(sym)
            continue
        if sym in _TICKER_STOP:
            if sym in strong and sym in uni:
                out.append(sym)
            continue
        if sym in uni:
            out.append(sym)
    return out
