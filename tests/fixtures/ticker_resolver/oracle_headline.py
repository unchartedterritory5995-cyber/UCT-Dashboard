"""FROZEN pre-TERM-064 oracle — F3 RSS headline extraction (`news_aggregator._extract_tickers`).

Copied VERBATIM from `api/services/news_aggregator.py` at base 15a100749 (lines 84-129, 218-232) so the parity rail in
`tests/test_ticker_resolver.py` compares the ONE resolver against the code it
replaced, never against expectations typed by hand. ⛔ Never edit this file: a
behaviour change in the resolver is declared in that test's DECLARED_DELTAS, not
absorbed here. The universe is injected through `_UNI` / `UNIVERSE` by the test.
"""
import re

# Words that look like tickers but aren't — filtered from regex extraction
_TICKER_BLACKLIST = {
    "A", "I", "AM", "AN", "ARE", "AS", "AT", "BE", "BY", "DO", "ET", "FM",
    "FOR", "GET", "GO", "HE", "IN", "IS", "IT", "ME", "MY", "NO", "OF",
    "ON", "OR", "SO", "THE", "TO", "UP", "US", "WE",
    # Financial jargon that looks like tickers
    "IPO", "ETF", "CEO", "CFO", "COO", "CTO", "ESG", "GDP", "CPI", "PCE",
    "PPI", "PMI", "AUM", "EPS", "FCF", "M&A", "YOY", "QOQ", "FY", "Q1",
    "Q2", "Q3", "Q4", "AM", "PM", "ET", "EST", "UTC", "NYSE", "NASDAQ",
    "SEC", "FED", "FOMC", "ECB", "BOJ", "IMF", "WTO", "NATO", "AI", "ML",
    "EV", "AR", "VR", "HR", "IT", "PR", "IR", "IF", "OF", "OR", "AND",
    "WITH", "FROM", "INTO", "OVER", "THAN", "THAT", "THIS", "THEY", "THEM",
    "WILL", "HAVE", "BEEN", "WERE", "SAID", "SAYS", "SAID", "MORE", "LESS",
    "ALSO", "EVEN", "JUST", "ONLY", "THAN", "THEN", "WHEN", "WHERE", "WHAT",
    "WHICH", "WHILE", "ABOUT", "AFTER", "AGAIN", "AHEAD", "AMONG", "AWAY",
    "BACK", "BEFORE", "BELOW", "BETWEEN", "BEYOND", "BOTH", "BRINGS",
    "BROAD", "BUYS", "CALL", "CALLS", "CAME", "COME", "CORP", "CUTS",
    "DEAL", "DOES", "DOWN", "EACH", "EARN", "EAST", "EDGE", "ELSE",
    "ENDS", "EVER", "EXEC", "FALL", "FAST", "FELL", "FILE", "FIND",
    "FIRM", "FIVE", "FLAT", "FOUR", "FREE", "FULL", "FUND", "GAIN",
    "GIVE", "GOES", "GOLD", "GOOD", "GREW", "GROW", "HALF", "HARD",
    "HEAD", "HEAR", "HELD", "HELP", "HERE", "HIGH", "HITS", "HOLD",
    "HOME", "HOW", "HURT", "IMPACT", "INTO", "KEEP", "KNEW", "KNOW",
    "LAST", "LATE", "LEAD", "LEAN", "LEFT", "LIKE", "LONG", "LOOK",
    "LOSS", "LOST", "MADE", "MAIN", "MAKE", "MANY", "MARK", "MEET",
    "MISS", "MOST", "MOVE", "MUCH", "MUST", "NEAR", "NEED", "NEXT",
    "NONE", "NOTE", "ONCE", "OPEN", "PART", "PAST", "PLAN", "PLAY",
    "POST", "PUSH", "PUTS", "REAL", "RISE", "RISK", "ROAD", "ROLE",
    "ROSE", "RULE", "RUNS", "SAME", "SAYS", "SEES", "SELL", "SENT",
    "SETS", "SHOT", "SHOW", "SIGN", "SITE", "SIZE", "SLOW", "SOME",
    "SOON", "STAY", "STEP", "STOP", "SUCH", "SURE", "TAKE", "TALK",
    "TELL", "TEST", "TIME", "TOOK", "TOPS", "TRIM", "TRUE", "TURN",
    "TWO", "TYPE", "UNIT", "USED", "VERY", "VIEW", "WAYS", "WEEK",
    "WELL", "WENT", "WEST", "WIDE", "WINS", "YEAR", "BEAT", "BEATS",
    "MISS", "MISSES", "BREAKING", "NEWS", "NEW", "SAYS", "TOPS",
    "STOCK", "MARKET", "SHARES", "PRICE", "TARGET", "GROWTH", "THIRD",
    "FOURTH", "FIRST", "SECOND", "REPORT", "REPORTS", "EARNINGS",
    "REVENUE", "GUIDANCE", "RAISES", "CUTS", "UPDATE", "MAJOR",
    "GLOBAL", "CHINA", "TRADE", "RATE", "RATES", "BOND", "BONDS",
    "CASH", "CASH", "DEBT", "LOAN", "BANK", "BANKS", "JOBS", "HIRE",
    "HIRES", "FIRE", "FIRES", "CLOSE", "CLOSES", "OPEN", "OPENS",
    "QUARTER", "ANNUAL", "FISCAL", "TECH", "ENERGY", "HEALTH", "CARE",
    "REAL", "ESTATE", "RETAIL", "DATA", "CLOUD", "CHIP", "CHIPS",
    "SAYS", "SAID", "CITING", "CITING", "SINCE", "UNTIL", "UNLESS",
    "DURING", "WITHIN", "OUTSIDE", "INSIDE", "ACROSS", "AROUND",
}


def _extract_tickers(text: str) -> list:
    """Extract likely stock ticker symbols from text using regex + blacklist filter."""
    if not text:
        return []
    # Match 2-5 uppercase letters, word-bounded
    candidates = re.findall(r"\b([A-Z]{2,5})\b", text)
    tickers = []
    seen = set()
    for c in candidates:
        if c not in _TICKER_BLACKLIST and c not in seen:
            # Additional heuristics: skip if it's all vowels or very common words
            # Tickers usually have at least one consonant and aren't common English
            tickers.append(c)
            seen.add(c)
    return tickers[:5]
