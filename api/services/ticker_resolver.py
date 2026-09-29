"""S2 — THE ONE TICKER RESOLVER (TERM-064 / FB-S2-02).

"Which tickers does this text name?" used to be answered by independent
resolvers that each owned a grammar, a stop list, a universe and a spelling:

* AI Search's query parser (`routers/ai_search._extract_tickers`) — the
  three-tier precedence, D-12 §3e;
* the catalyst engine's Perplexity discovery pass
  (`catalyst/sources._extract_tickers_from_text`);
* the RSS headline pass (`news_aggregator._extract_tickers`).

They now call this module. ⭐ `_extract_tickers`' three-tier precedence is the
surviving authority, and it is written ONCE, here:

  1. a ``$CASHTAG`` (class shares ``$BRK.B`` / ``$BRK-B`` included) is always
     trusted — unless the input kind EXCLUDES it (forex codes in model prose);
  2. a bare UPPERCASE word must be in the cap universe; a stop-listed one that IS
     a real ticker (NOW/LOW/MA/RS …) needs a strong ticker-position cue;
  3. a bare lowercase/mixed-case word is a ticker only for MEMBER-TYPED input,
     only in a strong ticker position, only in the universe, never stop-listed.

⛔ WHAT DIFFERS BETWEEN CALLERS IS VOCABULARY, NOT PRECEDENCE. A `Context` names
the input kind — a member's typed question, a model's list-mode prose, a
publisher's headline — and carries that kind's stop words. "AMC" in an EOD
catalyst answer is the after-market-close timing code; in a member's question it
is AMC Entertainment. A symbol universe does not settle that
(`lesson_a_symbol_universe_does_not_settle_a_ticker_match`), so the stop words
stay per input kind — declared here, never in a caller.

⛔ ONE SPELLING. A class share is emitted in the canonical HYPHEN form
(``BRK-B``) — the form `cap_universe.json`, the SQLite caches, FMP and yfinance
use. The dot form exists only at the Massive REST boundary
(`massive.to_polygon_symbol`), never here.

⛔ ONE UNIVERSE: `cap_universe.symbols()`, read once per process. An empty
universe means "cannot answer" (the loader's contract), so the bare-word tiers
find nothing and only cashtags survive — never a guess.

Rails: `tests/test_ticker_resolver.py` — parity against the FROZEN pre-migration
code of every migrated family (`tests/fixtures/ticker_resolver/`), a closed list
of declared deltas, the known-ambiguous fixture, and an AST census that fails BY
NAME on a second resolver.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from api.services.a8_taxonomy import CASHTAG_EXCLUDED

# ── the grammar: one left-to-right pass over every form, so order = mention order.
# The trailing (?![A-Za-z]) makes $NVIDIA match nothing rather than a fragment.
_TOKEN_RE = re.compile(r"\$([A-Za-z]{1,5}(?:[.\-][A-Za-z])?)(?![A-Za-z])|\b([A-Za-z]{2,5})\b")

#: AI Search query vocabulary — moved VERBATIM from `routers/ai_search._TICKER_STOP`.
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


#: RSS headline vocabulary — moved VERBATIM from `news_aggregator._TICKER_BLACKLIST`.
#: Words that look like tickers but aren't — filtered from regex extraction.
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

#: Perplexity discovery vocabulary — moved VERBATIM from
#: `catalyst/sources._NON_TICKER_WORDS`. JPM/GS are real tickers stop-listed here
#: on purpose (the answers cite banks as the SOURCE of an upgrade); a strong cue
#: still reaches them, and a cashtag always does.
_NON_TICKER_WORDS = {
    "USA", "CEO", "CFO", "COO", "ETF", "IPO", "FDA", "SEC", "USD", "EUR", "GBP",
    "JPY", "CAD", "AUD", "AI", "ML", "EPS", "QOQ", "YOY", "AMC", "BMO", "RTH",
    "NYSE", "PRE", "POST", "FED", "JPM", "GS", "EBIT", "EBITDA", "FY", "FQ",
    "GAAP", "NON",
}



@dataclass(frozen=True)
class Context:
    """One input kind. Precedence is shared; only vocabulary differs."""
    name: str
    #: Bare words that are not a ticker without a strong ticker-position cue.
    stop: frozenset
    #: Member-typed input: a CUED lowercase word may be a ticker (phone typing).
    #: Published text writes tickers in capitals, so its kinds leave this off.
    lowercase_cued: bool
    #: Never a ticker from this input kind — cashtag or bare, cue or not.
    exclude: frozenset = frozenset()


#: A member's typed question (AI Search, the palette, the AI door).
QUERY = Context("query", frozenset(_TICKER_STOP), lowercase_cued=True)
#: A model's list-mode prose (the catalyst engine's Perplexity discovery). The
#: forex codes are A8's M5 exclusions, derived — never restated.
DISCOVERY_PROSE = Context("discovery_prose", frozenset(_NON_TICKER_WORDS),
                          lowercase_cued=False, exclude=CASHTAG_EXCLUDED)
#: A publisher's headline (the RSS pass).
HEADLINE = Context("headline", frozenset(_TICKER_BLACKLIST), lowercase_cued=False)

CONTEXTS = (QUERY, DISCOVERY_PROSE, HEADLINE)


# ── the universe ─────────────────────────────────────────────────────────────
_UNI: Optional[set] = None


def universe() -> set:
    """Uppercase cap-universe symbols, cached per process. Never raises."""
    global _UNI
    if _UNI is None:
        try:
            from api.services import cap_universe
            _UNI = set(cap_universe.symbols())
        except Exception:
            _UNI = set()
    return _UNI


def canonical(symbol: str) -> str:
    """The one spelling: upper-case, class share in the HYPHEN form (BRK-B)."""
    return (symbol or "").strip().upper().replace(".", "-")


def resolve_tickers(text: Optional[str], context: Context = QUERY) -> list[str]:
    """Tickers named in `text`, in mention order, canonical spelling.

    Order matters to callers that cap the list (AI Search grounds the first 2-3).
    Total: never raises on a string or None.
    """
    q = text or ""
    strong = {(a or b).upper() for a, b in _STRONG_TICKER_CUE.findall(q)}
    lower_cued = ({(a or b).upper() for a, b in _LOWER_TICKER_CUE.findall(q)}
                  if context.lowercase_cued else set())
    uni = universe()
    stop, exclude = context.stop, context.exclude
    out: list[str] = []
    for m in _TOKEN_RE.finditer(q):
        cash, bare = m.group(1), m.group(2)
        if cash:
            sym = canonical(cash)
            if sym not in out and sym not in exclude:
                out.append(sym)
            continue
        sym = bare.upper()
        if sym in out or sym in exclude:
            continue
        if bare != sym:
            # lowercase/mixed-case path: member input + cue + universe + never stop-listed
            if (sym in lower_cued and sym in uni
                    and sym not in stop and sym not in _LOWER_ONLY_STOP):
                out.append(sym)
            continue
        if sym in stop:
            if sym in strong and sym in uni:
                out.append(sym)
            continue
        if sym in uni:
            out.append(sym)
    return out
