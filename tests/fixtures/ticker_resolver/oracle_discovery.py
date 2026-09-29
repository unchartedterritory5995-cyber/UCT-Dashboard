"""FROZEN pre-TERM-064 oracle — F2 catalyst Perplexity discovery prose (`catalyst/sources._extract_tickers_from_text`).

Copied VERBATIM from `api/services/catalyst/sources.py` at base 15a100749 (lines 390-427) so the parity rail in
`tests/test_ticker_resolver.py` compares the ONE resolver against the code it
replaced, never against expectations typed by hand. ⛔ Never edit this file: a
behaviour change in the resolver is declared in that test's DECLARED_DELTAS, not
absorbed here. The universe is injected through `_UNI` / `UNIVERSE` by the test.
"""
import re

#: Injected by the test; stands in for `news_match.universe_set()` (the only edit).
UNIVERSE: set = set()

_DISCOVERY_TICKER_RE = re.compile(r"\$([A-Z]{1,5})\b|\b([A-Z]{2,5})\b")
_NON_TICKER_WORDS = {
    "USA", "CEO", "CFO", "COO", "ETF", "IPO", "FDA", "SEC", "USD", "EUR", "GBP",
    "JPY", "CAD", "AUD", "AI", "ML", "EPS", "QOQ", "YOY", "AMC", "BMO", "RTH",
    "NYSE", "PRE", "POST", "FED", "JPM", "GS", "EBIT", "EBITDA", "FY", "FQ",
    "GAAP", "NON",
}


def _extract_tickers_from_text(text: str) -> set[str]:
    """Pull plausible tickers from Perplexity prose. Cashtags trusted;
    bare uppercase words filtered against a tiny stoplist."""
    if not text:
        return set()
    tickers: set[str] = set()
    for cashtag, bareword in _DISCOVERY_TICKER_RE.findall(text):
        sym = cashtag or bareword
        if not sym:
            continue
        sym = sym.upper()
        if cashtag:  # trusted
            tickers.add(sym)
        elif sym not in _NON_TICKER_WORDS and 2 <= len(sym) <= 5:
            tickers.add(sym)
    # Drop the forex/crypto false-positives we already exclude elsewhere
    tickers -= {"USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "CNY", "HKD", "NZD"}
    # Bare-word guesses (no $) must be real cap-universe symbols — Perplexity
    # prose is littered with AWS/EV/GMM-style non-tickers. Cashtags bypass
    # this (explicit + trusted). Fail-open if the universe can't load.
    try:
        uni = set(UNIVERSE)
        if uni:
            cashtags = {(c or "").upper() for c, _ in _DISCOVERY_TICKER_RE.findall(text) if c}
            tickers = {t for t in tickers if t in cashtags or t in uni}
    except Exception:
        pass
    return tickers
