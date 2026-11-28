"""Licensed reference reads shared by the ticker-metadata callers (licensed-first pass 2, 2026-11-28).

Before this pass, a ticker's company name, sector, industry and exchange were read from Yahoo
Finance first (`yfinance .info`, licensing register T-73, class X) and only gaps went to FMP or
Finnhub. This module holds the two LICENSED reads that now come first, and the wording rules that
keep everything that matched on the old words matching:

  * Massive ticker details (`/v3/reference/tickers/{t}`, register T-07, `provider_licensing_class`
    ("massive", "reference") = LA): the company name, the listing's primary exchange (a MIC code,
    mapped below to the names our store has always held: NASDAQ, NYSE, NYSE Arca ...), the
    instrument type (CS, ETF, ...), the market cap and the branding images;
  * FMP company profile (`/stable/profile`, register T-33 names "profile"; the adapter stamps it
    "U" because `provider_licensing_class` has no ("fmp", "profile") row, see
    `fmp_client.get_company_profile`): the company name, sector and industry.

WORDING. Every consumer of these strings was written against Yahoo's (Morningstar's) words: the
calendar's sector chips, the catalyst engine's sector banner and bank rule, the AI peer check
(`groups._ai_peers`: same sector or same industry), the earnings-preview fund test, the industry
cohorts of `industry_map`. FMP uses the same eleven sector names, but words a few dozen industries
differently ("Medical - Devices" where Yahoo says "Medical Devices"). `normalize_industry` maps every
FMP industry that has ONE Yahoo equivalent onto the Yahoo word; an FMP industry with no one-to-one
Yahoo word (FMP "Hardware, Equipment & Parts" covers Yahoo's "Electronic Components" AND
"Scientific & Technical Instruments") passes through as FMP's own words, because picking one Yahoo
word for it would be a guess. `normalize_sector` maps the GICS-style spellings a vendor sometimes
sends onto the same eleven.

Nothing here talks HTTP except through `massive.get_ticker_details` (the Massive client's own
timeout), and every read is cached in this module so a request path asks a ticker once a day.
Never raises.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Optional

_log = logging.getLogger(__name__)

# ── exchange: Massive's MIC code -> the names `ticker_meta` has always stored ──────────────────
# These are the exact strings `ticker_meta._YF_EXCHANGE` produced from Yahoo's codes, so the
# chart's `symbolScope.json` tick-size / listing-field rows (keyed NASDAQ, NYSE, NYSE Arca) and
# the compare legend read the same text whichever source answered. NASDAQ is four codes (the
# composite and three tiers, `breadth_universes.NASDAQ_VENUES`). A code not listed stays
# unmapped (None), never relabelled: the caller then asks its next source.
MIC_TO_EXCHANGE = {
    "XNAS": "NASDAQ", "XNGS": "NASDAQ", "XNMS": "NASDAQ", "XNCM": "NASDAQ",
    "XNYS": "NYSE",
    "ARCX": "NYSE Arca",
    "XASE": "NYSE American",
    "BATS": "Cboe BZX",
    "OTCM": "OTC", "OOTC": "OTC", "OTCB": "OTC", "PSGM": "OTC", "OTCQ": "OTC",
}

#: Massive's instrument types that are an operating company's shares (common stock, ADRs).
COMPANY_TYPES = frozenset({"CS", "ADRC", "ADRP", "ADRS", "GDR", "NYRS"})
#: Massive's instrument types that are a fund or a note (never a company).
FUND_TYPES = frozenset({"ETF", "ETN", "ETV", "ETS", "FUND", "UNIT"})

# ── sector: the eleven words every consumer matches on ─────────────────────────────────────────
SECTORS = ("Technology", "Healthcare", "Financial Services", "Consumer Cyclical",
           "Consumer Defensive", "Industrials", "Energy", "Utilities", "Basic Materials",
           "Real Estate", "Communication Services")
_SECTOR_ALIASES = {
    "information technology": "Technology",
    "health care": "Healthcare",
    "financial": "Financial Services",
    "financials": "Financial Services",
    "consumer discretionary": "Consumer Cyclical",
    "consumer staples": "Consumer Defensive",
    "materials": "Basic Materials",
    "telecommunication services": "Communication Services",
    "communication": "Communication Services",
}

# ── industry: FMP's word -> Yahoo's word, only where the two name the same group ───────────────
# FMP words not listed here are either already Yahoo's word ("Semiconductors", "Software -
# Infrastructure", "Banks - Regional", "Biotechnology", "Aerospace & Defense", "REIT - Office" ...)
# or have no one Yahoo equivalent; both pass through unchanged.
FMP_INDUSTRY_TO_YAHOO = {
    "Auto - Manufacturers": "Auto Manufacturers",
    "Auto - Parts": "Auto Parts",
    "Auto - Dealerships": "Auto & Truck Dealerships",
    "Auto - Recreational Vehicles": "Recreational Vehicles",
    "Medical - Devices": "Medical Devices",
    "Medical - Instruments & Supplies": "Medical Instruments & Supplies",
    "Medical - Diagnostics & Research": "Diagnostics & Research",
    "Medical - Distribution": "Medical Distribution",
    "Medical - Care Facilities": "Medical Care Facilities",
    "Medical - Healthcare Plans": "Healthcare Plans",
    "Medical - Healthcare Information Services": "Health Information Services",
    "Financial - Capital Markets": "Capital Markets",
    "Financial - Credit Services": "Credit Services",
    "Financial - Mortgages": "Mortgage Finance",
    "Financial - Conglomerates": "Financial Conglomerates",
    "Financial - Data & Stock Exchanges": "Financial Data & Stock Exchanges",
    "Insurance - Brokers": "Insurance Brokers",
    "Oil & Gas Exploration & Production": "Oil & Gas E&P",
    "Industrial - Machinery": "Specialty Industrial Machinery",
    "Industrial - Distribution": "Industrial Distribution",
    "Industrial - Pollution & Treatment Controls": "Pollution & Treatment Controls",
    "Agricultural - Machinery": "Farm & Heavy Construction Machinery",
    "Agricultural Farm Products": "Farm Products",
    "Apparel - Manufacturers": "Apparel Manufacturing",
    "Apparel - Retail": "Apparel Retail",
    "Apparel - Footwear & Accessories": "Footwear & Accessories",
    "Chemicals - Specialty": "Specialty Chemicals",
    "Manufacturing - Tools & Accessories": "Tools & Accessories",
    "Manufacturing - Metal Fabrication": "Metal Fabrication",
    "Construction Materials": "Building Materials",
    "Travel Lodging": "Lodging",
    "Telecommunications Services": "Telecom Services",
    "Home Improvement": "Home Improvement Retail",
    "Food Confectioners": "Confectioners",
    "Regulated Electric": "Utilities - Regulated Electric",
    "Regulated Gas": "Utilities - Regulated Gas",
    "Regulated Water": "Utilities - Regulated Water",
    "Diversified Utilities": "Utilities - Diversified",
    "Renewable Utilities": "Utilities - Renewable",
    "Independent Power Producers": "Utilities - Independent Power Producers",
    "Asset Management - Bonds": "Asset Management",
    "Asset Management - Income": "Asset Management",
    "Asset Management - Global": "Asset Management",
    "Asset Management - Leveraged": "Asset Management",
    "Asset Management - Cryptocurrency": "Asset Management",
}


def _clean(s) -> Optional[str]:
    return " ".join(s.split()) if isinstance(s, str) and s.strip() else None


def normalize_sector(s) -> Optional[str]:
    """A vendor's sector in the eleven words the consumers match on; any other text unchanged."""
    s = _clean(s)
    if s is None:
        return None
    return _SECTOR_ALIASES.get(s.lower(), s)


def normalize_industry(s) -> Optional[str]:
    """An FMP industry in Yahoo's word where the two name the same group; otherwise unchanged.
    An em dash ("Banks—Regional", Yahoo's older spelling) is read as the spaced hyphen."""
    s = _clean(s)
    if s is None:
        return None
    s = s.replace("—", " - ").replace("  ", " ")
    s = " ".join(s.split())
    return FMP_INDUSTRY_TO_YAHOO.get(s, s)


def exchange_from_mic(mic) -> Optional[str]:
    return MIC_TO_EXCHANGE.get(str(mic or "").strip().upper()) if mic else None


# ── Massive ticker details, read once a day per ticker ─────────────────────────────────────────
_OK_TTL_S = 24 * 3600
_FAIL_TTL_S = 600
_DETAILS: dict = {}
_DETAILS_LOCK = threading.Lock()


def massive_details(ticker: str) -> dict:
    """Massive's ticker details for one ticker ({} when it has none or the read failed).
    Held here a day after an answer, ten minutes after an empty one, so a request path
    asks a ticker at most once a day. Never raises."""
    sym = (ticker or "").upper().strip()
    if not sym:
        return {}
    now = time.time()
    with _DETAILS_LOCK:
        hit = _DETAILS.get(sym)
        if hit is not None and hit[0] > now:
            return dict(hit[1])
    try:
        from api.services import massive
        res = massive.get_ticker_details(sym) or {}
    except Exception as exc:                                   # noqa: BLE001
        _log.info("massive ticker details failed for %s: %s", sym, type(exc).__name__)
        res = {}
    if not isinstance(res, dict):
        res = {}
    with _DETAILS_LOCK:
        _DETAILS[sym] = (now + (_OK_TTL_S if res else _FAIL_TTL_S), dict(res))
        if len(_DETAILS) > 20000:                              # bounded: drop the oldest half
            for k in sorted(_DETAILS, key=lambda k: _DETAILS[k][0])[:10000]:
                _DETAILS.pop(k, None)
    return dict(res)


def massive_reference(ticker: str) -> dict:
    """{name, exchange, type, market_cap, active} from Massive ticker details, each None when
    Massive does not say. `exchange` is in our store's spelling (MIC_TO_EXCHANGE)."""
    d = massive_details(ticker)
    mc = d.get("market_cap")
    try:
        mc = float(mc) if mc is not None and float(mc) > 0 else None
    except (TypeError, ValueError):
        mc = None
    return {
        "name": _clean(d.get("name")),
        "exchange": exchange_from_mic(d.get("primary_exchange")),
        "type": (str(d.get("type")).strip().upper() or None) if d.get("type") else None,
        "market_cap": mc,
        "active": d.get("active") if isinstance(d.get("active"), bool) else None,
    }


def massive_avg_volume(ticker: str, sessions: int, *, lookback_days: Optional[int] = None) -> Optional[dict]:
    """The average daily volume over the last `sessions` COMPLETED sessions, and the last close,
    from Massive's daily aggregates (register T-03/T-04, class LA) read through
    `earnings_reaction.massive_daily_bars` (one request, the Massive client's timeout).
    Today's session is left out while it is still forming (its date is today), so the
    average is a whole-session statistic. -> {avg_volume, last_close, sessions, as_of} or None
    when fewer than `sessions` sessions with a volume came back. Never raises."""
    from datetime import date, timedelta
    try:
        from api.services import earnings_reaction
        span = lookback_days or max(14, int(sessions * 1.6) + 10)
        bars = earnings_reaction.massive_daily_bars(
            ticker, (date.today() - timedelta(days=span)).isoformat())
    except Exception as exc:                                   # noqa: BLE001
        _log.info("massive avg volume failed for %s: %s", ticker, type(exc).__name__)
        return None
    today = date.today().isoformat()
    done = [b for b in bars or [] if isinstance(b, dict) and str(b.get("t") or "") < today]
    vols = []
    for b in done:
        try:
            v = float(b.get("v"))
        except (TypeError, ValueError):
            continue
        if v >= 0:
            vols.append((b["t"], v, b.get("c")))
    if len(vols) < sessions:
        return None
    window = vols[-sessions:]
    try:
        last_close = float(window[-1][2]) if window[-1][2] is not None else None
    except (TypeError, ValueError):
        last_close = None
    return {"avg_volume": sum(v for _, v, _ in window) / sessions, "last_close": last_close,
            "sessions": sessions, "as_of": window[-1][0]}


def first() -> bool:
    """True: the licensed reads of pass 2 run before Yahoo / Finnhub. Production always answers
    True. It is a seam, nothing more: `tests/conftest.py` answers False for every test, so a test
    that stubs Yahoo keeps testing the Yahoo path and no test reaches FMP or Massive through these
    reads by accident; the rails of the licensed reads set it back to True
    (`tests/test_licensed_fallbacks_pass2.py`). Production answers True unless the KILL SWITCH
    LICENSED_FIRST_PASS2_ENABLED is 0/false/no/off (read per call; integrator ruling 2026-11-28:
    ticker names, sectors and logos reach every member, so a rollback must not need a deploy)."""
    import os
    return os.environ.get(
        "LICENSED_FIRST_PASS2_ENABLED", "1"
    ).strip().lower() not in ("0", "false", "no", "off")
