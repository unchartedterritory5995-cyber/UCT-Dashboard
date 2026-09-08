"""Publisher registry — the single place source trust is decided.

Everything the News tab shows or hides by publisher is decided here. No other
module in `api/services/news/` may hard-code a publisher string; they call
`classify()` / `is_displayable()` instead.

WHY THIS IS CENTRALIZED
    The source probe (7 Sep 2026) measured FMP's `/stable/news/stock` at 85.5%
    commentary -- Zacks, Motley Fool, 24/7 Wall Street, Defense World. That
    endpoint is only usable behind a strict whitelist, and a whitelist scattered
    across adapters, filters and the API would drift apart within a month.

THE UNKNOWN-PUBLISHER RULE
    A publisher we have never seen is STORED and CLASSIFIED `unknown`, and does
    NOT appear in the default feed. FMP's corpus provably drifts (Massive lost
    MarketWatch and Seeking Alpha and regained Zacks over 13 quarters), so a new
    name appearing in the response must never silently reach members. Unknown
    publishers are counted so the whitelist can be reviewed deliberately.

Environment overrides (comma-separated publisher names, exact or alias form):
    NEWS_EXTRA_JOURNALISM   promote publishers into the journalism tier
    NEWS_EXTRA_REJECT       demote publishers into the rejected tier
Both are additive and applied after the built-in tables, so a bad provider name
can be shut off in production without a deploy.
"""

from __future__ import annotations

import os
import re
import threading
from typing import Iterable

# ---------------------------------------------------------------------------
# Source classes, most trusted first. Used for dedupe precedence (§9), the UI
# trust hint (§12), and relevance weighting (§11).
# ---------------------------------------------------------------------------
CLASS_PRIMARY = "primary"        # SEC, the issuer itself
CLASS_WIRE = "wire"              # GlobeNewswire, Business Wire, PR Newswire...
CLASS_JOURNALISM = "journalism"  # Reuters, CNBC, WSJ, Barron's...
CLASS_SOCIAL = "social"          # curated X accounts
CLASS_COMMENTARY = "commentary"  # Zacks, Motley Fool... stored, never displayed
CLASS_UNKNOWN = "unknown"        # never seen before; stored, never displayed

# Ordering for "which version of one event wins" (§9). Lower index wins.
CLASS_RANK = {
    CLASS_PRIMARY: 0,
    CLASS_WIRE: 1,
    CLASS_JOURNALISM: 2,
    CLASS_SOCIAL: 3,
    CLASS_COMMENTARY: 8,
    CLASS_UNKNOWN: 9,
}

# Classes allowed into the DEFAULT company feed.
DISPLAYABLE = frozenset({CLASS_PRIMARY, CLASS_WIRE, CLASS_JOURNALISM, CLASS_SOCIAL})


def _norm(name: str) -> str:
    """Fold a publisher string to a comparison key.

    FMP alone returned '24/7 Wall Street', '247 Wallst', 'GlobeNewsWire',
    'Globe News Wire' and 'PRNewsWire' for three underlying publishers, so
    matching on the raw string would leak rejected sources through spelling
    variants. Strip everything but letters and digits.
    """
    return re.sub(r"[^a-z0-9]+", "", (name or "").lower())


# ---------------------------------------------------------------------------
# The tables. Keys are the folded form; the value is the canonical display name.
# ---------------------------------------------------------------------------
_WIRE = {
    "globenewswire": "GlobeNewswire",
    "globenewswireinc": "GlobeNewswire",
    "globenews": "GlobeNewswire",
    "businesswire": "Business Wire",
    "prnewswire": "PR Newswire",
    "pressrelease": "PR Newswire",
    "newsfilecorp": "Newsfile",
    "newsfile": "Newsfile",
    "accesswire": "Accesswire",
    "acnewswire": "ACN Newswire",
    "einpresswire": "EIN Presswire",
    "prweb": "PRWeb",
}

_JOURNALISM = {
    "reuters": "Reuters",
    "barrons": "Barron's",
    "barron": "Barron's",
    "cnbc": "CNBC",
    "cnbctelevision": "CNBC",
    "businessinsider": "Business Insider",
    "wsj": "WSJ",
    "thewallstreetjournal": "WSJ",
    "wallstreetjournal": "WSJ",
    "marketwatch": "MarketWatch",
    "techcrunch": "TechCrunch",
    "pymnts": "PYMNTS",
    "investopedia": "Investopedia",
    "forbes": "Forbes",
    "morningstar": "Morningstar",
    "schwabnetwork": "Schwab Network",
    "associatedpress": "AP",
    "ap": "AP",
    "bloomberg": "Bloomberg",
    "financialtimes": "Financial Times",
    "ft": "Financial Times",
    "axios": "Axios",
    "nypost": "New York Post",
    "newyorkpost": "New York Post",
    # Surfaced as UNKNOWN by the first live FMP pull (7 Sep 2026). The
    # registry correctly refused to auto-admit it; admitted here by hand,
    # which is the only way anything joins this table.
    "foxbusiness": "Fox Business",
    "cnn": "CNN", "cnnbusiness": "CNN",
    "theguardian": "The Guardian",
}

# Stored for analytics and future use, never shown in the default feed.
_COMMENTARY = {
    "zacks": "Zacks",
    "zacksinvestmentresearch": "Zacks",
    "themotleyfool": "The Motley Fool",
    "motleyfool": "The Motley Fool",
    "fool": "The Motley Fool",
    "foolinvestingnews": "The Motley Fool",
    "247wallstreet": "24/7 Wall Street",
    "247wallst": "24/7 Wall Street",
    "24 7wallstreet": "24/7 Wall Street",
    "defenseworld": "Defense World",
    "seekingalpha": "Seeking Alpha",
    "gurufocus": "GuruFocus",
    "benzinga": "Benzinga",
    "marketbeat": "MarketBeat",
    "investorplace": "InvestorPlace",
    "investerplace": "InvestorPlace",
    "finbold": "Finbold",
    "schaeffersresearch": "Schaeffers Research",
    "schaeffers": "Schaeffers Research",
    "simplywallst": "Simply Wall St",
    "stocknews": "StockNews",
    "stocknewscom": "StockNews",
    "insidermonkey": "Insider Monkey",
    "etfdailynews": "ETF Daily News",
    "chartmill": "ChartMill",
    "invezz": "Invezz",
    "proactiveinvestors": "Proactive Investors",
    "proactiveinvestorsfinance": "Proactive Investors",
    "fintel": "Fintel",
    "pennystocks": "PennyStocks",
    "kiplinger": "Kiplinger",
    "etftrends": "ETF Trends",
    "fxempire": "FXEmpire",
    "yahoo": "Yahoo",          # aggregator wrapper: hides the real publisher
    "yahoofinance": "Yahoo",
}

_PRIMARY = {
    "sec": "SEC",
    "secedgar": "SEC",
    "edgar": "SEC",
}

_LOCK = threading.Lock()
_ENV_JOURNALISM: dict[str, str] = {}
_ENV_REJECT: dict[str, str] = {}
_ENV_LOADED = False


def _load_env() -> None:
    global _ENV_LOADED
    if _ENV_LOADED:
        return
    with _LOCK:
        if _ENV_LOADED:
            return
        for raw in (os.environ.get("NEWS_EXTRA_JOURNALISM") or "").split(","):
            n = raw.strip()
            if n:
                _ENV_JOURNALISM[_norm(n)] = n
        for raw in (os.environ.get("NEWS_EXTRA_REJECT") or "").split(","):
            n = raw.strip()
            if n:
                _ENV_REJECT[_norm(n)] = n
        _ENV_LOADED = True


def reset_env_cache() -> None:
    """Test hook: re-read the env overrides."""
    global _ENV_LOADED
    with _LOCK:
        _ENV_JOURNALISM.clear()
        _ENV_REJECT.clear()
        _ENV_LOADED = False


def classify(publisher: str, *, provider: str = "") -> tuple[str, str]:
    """(source_class, canonical_display_name) for a raw publisher string.

    `provider` lets a source assert its own class regardless of the publisher
    field: SEC filings are primary and tweets are social by construction.
    """
    _load_env()
    if provider == "sec":
        return CLASS_PRIMARY, "SEC"
    if provider in ("x", "twitter"):
        return CLASS_SOCIAL, (publisher or "").strip() or "X"

    key = _norm(publisher)
    if not key:
        return CLASS_UNKNOWN, (publisher or "").strip() or "Unknown"

    # Env reject wins over everything so a bad feed can be killed without deploy.
    if key in _ENV_REJECT:
        return CLASS_COMMENTARY, _ENV_REJECT[key]
    if key in _PRIMARY:
        return CLASS_PRIMARY, _PRIMARY[key]
    if key in _WIRE:
        return CLASS_WIRE, _WIRE[key]
    if key in _JOURNALISM:
        return CLASS_JOURNALISM, _JOURNALISM[key]
    if key in _ENV_JOURNALISM:
        return CLASS_JOURNALISM, _ENV_JOURNALISM[key]
    if key in _COMMENTARY:
        return CLASS_COMMENTARY, _COMMENTARY[key]
    return CLASS_UNKNOWN, (publisher or "").strip()


def is_displayable(source_class: str) -> bool:
    """May an item of this class enter the DEFAULT feed?"""
    return source_class in DISPLAYABLE


def rank(source_class: str) -> int:
    return CLASS_RANK.get(source_class, CLASS_RANK[CLASS_UNKNOWN])


def known_publishers() -> dict[str, list[str]]:
    """For the admin/health view: what the registry currently knows."""
    _load_env()
    return {
        CLASS_PRIMARY: sorted(set(_PRIMARY.values())),
        CLASS_WIRE: sorted(set(_WIRE.values())),
        CLASS_JOURNALISM: sorted(set(_JOURNALISM.values()) | set(_ENV_JOURNALISM.values())),
        CLASS_COMMENTARY: sorted(set(_COMMENTARY.values()) | set(_ENV_REJECT.values())),
    }


def unknown_among(publishers: Iterable[str]) -> list[str]:
    """Publisher names in `publishers` the registry does not recognise."""
    out: set[str] = set()
    for p in publishers:
        cls, name = classify(p)
        if cls == CLASS_UNKNOWN and name:
            out.add(name)
    return sorted(out)
