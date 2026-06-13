"""Company-name → ticker matching for news headlines (Approach 2 v1).

RSS/news headlines name COMPANIES, not cashtags ("Rocket Lab, Nebius,
Astera Labs, CoreWeave, Teradyne to join Nasdaq-100") — so cashtag-only
extraction attached zero of the five inclusion names on 2026-06-12 and the
engine never knew the story existed. This module matches normalized company
names from the cap_universe ticker_meta cache against headline text.

Safety posture (false positives are worse than misses here — a wrong
ticker gets a wrong thesis synthesized onto it):
  * multi-word names match as exact token sequences ("rocket lab")
  * single-token names require length >= 5 AND absence from a common-word
    blocklist (kills Gap/Ford/Visa/Snap/Target/United-style collisions)
  * at most MAX_TICKERS_PER_TEXT matches per headline — listicle headlines
    ("12 stocks to watch this week") are noise, not catalysts

The index builds lazily from cap_universe.json + the on-disk ticker_meta
name cache (warm on the web pod via the ticker-names prewarmer; misses are
skipped — no network, never blocks a source pull). Rebuilt every 6h.
"""
import logging
import os
import re
import threading
import time

logger = logging.getLogger(__name__)

MAX_TICKERS_PER_TEXT = 8

# Corporate suffixes stripped (iteratively) from the end of names.
_SUFFIXES = {
    "inc", "incorporated", "corp", "corporation", "ltd", "limited", "plc",
    "co", "company", "companies", "holdings", "holding", "group", "sa", "nv",
    "ag", "se", "lp", "llc", "usa", "international", "enterprises",
    "industries", "technologies", "technology", "tech", "systems",
    "solutions", "labs", "laboratories", "therapeutics", "pharmaceuticals",
    "pharma", "sciences", "bancorp", "bancshares", "financial", "trust",
    "fund", "etf", "adr", "ads", "cl", "class",
}

# Single-token name variants that are also common English / finance words.
# These NEVER match on the bare token (the full multi-word name still can).
_COMMON_WORD_BLOCKLIST = {
    "target", "united", "first", "general", "american", "national", "global",
    "alliance", "energy", "frontier", "dollar", "spirit", "sound", "smart",
    "match", "block", "shell", "coach", "alphabet", "crane",
    "carter", "brink", "wing", "peak", "path", "pool", "post", "rapid",
    "open", "close", "yield", "price", "limit", "trade", "main", "best",
    "next", "real", "bond", "cash", "core", "gold", "silver", "master",
    "mind", "novel", "pace", "pure", "safe", "sage", "solo", "spot",
    "wave", "weave", "turn", "trip", "vital", "rush", "stem", "root",
    "plug", "arch", "onto", "hub", "key", "lens", "loop", "sun", "circle",
    "compass", "guild", "oscar", "stride", "vertical",
}

_WORD_RE = re.compile(r"[a-z0-9]+")


def _norm_tokens(text: str) -> list[str]:
    return _WORD_RE.findall((text or "").lower())


def _variants(name: str) -> list[str]:
    """Matchable token-sequence variants for one company name.

    Suffixes strip progressively and EVERY >=2-token stage is kept, because
    headlines use any of them: "Target Corporation beats" (full), "Astera
    Labs joins index" (mid-strip — 'labs' is brand-integral there), "Palantir
    rallies" (fully stripped). Single-letter trailing tokens ("N.V." -> n, v)
    strip like suffixes. A final single token must be >=5 chars and not a
    common English word to stand alone."""
    tokens = _norm_tokens(name)
    if not tokens:
        return []
    out: list[str] = []
    stage = list(tokens)
    if len(stage) >= 2:
        out.append(" ".join(stage))
    while len(stage) > 1 and (stage[-1] in _SUFFIXES or len(stage[-1]) == 1):
        stage.pop()
        if len(stage) >= 2:
            out.append(" ".join(stage))
    if len(stage) == 1:
        tok = stage[0]
        if len(tok) >= 5 and tok not in _COMMON_WORD_BLOCKLIST:
            out.append(tok)
    elif len(stage) >= 3:
        # Headlines shorten 3+-token names to their first two tokens
        # ("Rocket Lab USA" -> "Rocket Lab"). Require length >= 8 so the
        # prefix stays distinctive.
        prefix = " ".join(stage[:2])
        if len(prefix) >= 8:
            out.append(prefix)
    return out


def build_index(names_by_ticker: dict[str, str]) -> dict[str, str]:
    """{variant token-string: ticker}. First ticker wins on collisions
    (dual-class share names collide with themselves — either ticker is
    fine for catalyst attachment)."""
    index: dict[str, str] = {}
    for ticker, name in names_by_ticker.items():
        if not ticker or not name:
            continue
        for v in _variants(name):
            index.setdefault(v, ticker.upper())
    return index


# ── Lazy module-level index over cap_universe + ticker_meta name cache ──
_INDEX: dict[str, str] = {}
_INDEX_BUILT_AT = 0.0
_INDEX_TTL_SECONDS = 6 * 3600
_INDEX_LOCK = threading.Lock()


def _load_universe_names() -> dict[str, str]:
    """Names for the cap universe from the on-disk ticker_meta cache.
    Cache misses are skipped — no network from a source pull, ever."""
    try:
        from api.routers.ticker_search import _load_universe, _name_from_cache
    except Exception:
        logger.exception("[news-match] universe/name helpers unavailable")
        return {}
    names: dict[str, str] = {}
    for t in _load_universe():
        try:
            name = _name_from_cache(t)
        except Exception:
            name = None
        if name:
            names[t] = name
    return names


def universe_set() -> set[str]:
    """Uppercase cap-universe tickers, cached per process. Used to validate
    BARE-WORD ticker guesses from upstream feeds (news_aggregator extracts
    any 2-5-letter uppercase word — FIFA/USMNT/LLP/USA all arrived as
    'tickers' on 2026-06-12 and two junk rows reached selection)."""
    global _UNIVERSE
    if _UNIVERSE is None:
        try:
            from api.routers.ticker_search import _load_universe
            _UNIVERSE = {t.upper() for t in _load_universe()}
        except Exception:
            logger.exception("[news-match] universe load failed")
            _UNIVERSE = set()
    return _UNIVERSE


_UNIVERSE: set[str] | None = None


def _get_index() -> dict[str, str]:
    global _INDEX, _INDEX_BUILT_AT
    now = time.time()
    if _INDEX and (now - _INDEX_BUILT_AT) < _INDEX_TTL_SECONDS:
        return _INDEX
    with _INDEX_LOCK:
        if _INDEX and (time.time() - _INDEX_BUILT_AT) < _INDEX_TTL_SECONDS:
            return _INDEX
        names = _load_universe_names()
        _INDEX = build_index(names)
        _INDEX_BUILT_AT = time.time()
        logger.info("[news-match] index built: %d names -> %d variants",
                    len(names), len(_INDEX))
    return _INDEX


def match_tickers(text: str, index: dict[str, str] | None = None) -> set[str]:
    """Tickers whose company names appear in `text` (word-boundary token
    sequences, 1-3 tokens). Empty set when disabled or over the cap."""
    if os.environ.get("CATALYST_NEWS_MATCH_ENABLED", "1").lower() not in ("1", "true", "yes"):
        return set()
    idx = index if index is not None else _get_index()
    if not idx:
        return set()
    tokens = _norm_tokens(text)
    found: set[str] = set()
    for n in (3, 2, 1):
        for i in range(len(tokens) - n + 1):
            gram = " ".join(tokens[i:i + n])
            hit = idx.get(gram)
            if hit:
                found.add(hit)
    if len(found) > MAX_TICKERS_PER_TEXT:
        # Listicle/roundup headline — too many names to be a single catalyst.
        return set()
    return found
