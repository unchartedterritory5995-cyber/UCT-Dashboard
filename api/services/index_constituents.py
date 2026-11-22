"""US stock-index constituents from FMP (the `stable/` plan) for the
'UCT Index Components' prebuilt watchlists.

STDLIB-ONLY (urllib) on purpose: both consumers must be able to import it —
  • tools/build_prebuilt_lists.py, run under a dep-less local python via
    `railway run --service web -- python tools/build_prebuilt_lists.py`, and
  • api/services/watchlist_prebuilt_refresh (the on-pod monthly refresh).

Two source shapes on the FMP stable plan (probe-confirmed 2026-08):
  • constituent endpoints — sp500 / nasdaq / dowjones-constituent → ticker in `symbol`
  • ETF holdings — etf/holdings?symbol=OEF/IJH/IJR/IWM → the ETF is `symbol`,
    the HOLDING's ticker is `asset`; rows also carry foreign listings
    (…​.L / .TO / .OL / .SW) and blanks, which _looks_us() filters out.
"""
import json
import os
import re
import urllib.parse
import urllib.request

_BASE = "https://financialmodelingprep.com"
CATEGORY = "UCT Index Components"

# (name, desc, kind, source, floor) — order here is the picker's display order.
#   kind='constituent' → FMP constituent endpoint (ticker in `symbol`)
#   kind='holdings'    → FMP etf/holdings for the tracking ETF (ticker in `asset`)
#   floor = the minimum plausible member count; a thinner fetch is treated as a
#           failure so the caller keeps the prior/committed set (never wipes).
INDEX_LISTS = [
    ("S&P 500", "The 500 large-cap constituents of the S&P 500.",
     "constituent", "/stable/sp500-constituent", 400),
    ("S&P 100", "The mega-cap S&P 100 (OEX) — the largest, most liquid US names.",
     "holdings", "OEF", 80),
    ("Nasdaq 100", "The 100 largest non-financial companies listed on the Nasdaq (NDX).",
     "constituent", "/stable/nasdaq-constituent", 90),
    ("Dow 30", "The 30 blue-chip components of the Dow Jones Industrial Average.",
     "constituent", "/stable/dowjones-constituent", 25),
    ("S&P MidCap 400", "The 400 mid-cap constituents of the S&P MidCap 400.",
     "holdings", "IJH", 350),
    ("S&P SmallCap 600", "The 600 small-cap constituents of the S&P SmallCap 600 (profitability-screened).",
     "holdings", "IJR", 500),
    ("Russell 2000", "The ~2,000 small-cap constituents of the Russell 2000.",
     "holdings", "IWM", 1500),
]

# A US listing that FMP returns as a plain (optionally class-share-hyphenated)
# ticker: 1-6 chars, starts with a letter, letters/digits/hyphen only. This drops
# foreign suffixes (BIPC.TO, 0VAG.L, RIGN.SW), blanks and numeric-leading foreign
# codes, while KEEPING dual-class shares (BRK-B, MOG-A) in the hyphen convention
# the app already stores (massive.to_polygon_symbol maps '-'→'.' at the provider
# boundary only).
_US_TICKER = re.compile(r"^[A-Z][A-Z0-9]*(-[A-Z0-9]+)?$")


def _looks_us(sym: str) -> bool:
    return bool(sym) and len(sym) <= 6 and bool(_US_TICKER.match(sym))


#: ⛔ WHEN-ISSUED LINES ARE NOT MEMBERS (2026-11-11). Around a spin-off, a holdings file
#: lists the parent under its temporary when-issued line -- Nasdaq symbology's FIFTH
#: letter `V` ("when-issued / when-distributed"): HONAV for HONA, VSNTV for VSNT, ANGIV for
#: ANGI. That line trades for days and then never again, so the prebuilt S&P 100 kept a
#: member whose every chart answered 503 with 0 bars, forever. A member is the REGULAR
#: listing: the when-issued suffix is mapped back to its base symbol at this door.
_WHEN_ISSUED = re.compile(r"^([A-Z]{4})V$")


def normalize_member(sym: str) -> str:
    """The regular-way listing an index member trades under (when-issued -> base)."""
    s = str(sym or "").strip().upper()
    m = _WHEN_ISSUED.match(s)
    return m.group(1) if m else s


def is_resolvable_member(sym: str) -> bool:
    """True for a symbol a prebuilt list may hold: a plain US listing, never a temporary
    when-issued line (see `normalize_member`)."""
    s = str(sym or "").strip().upper()
    return _looks_us(s) and normalize_member(s) == s


def normalize_members(syms) -> list:
    """`normalize_member` over a list, de-duplicated, order kept."""
    seen, out = set(), []
    for t in syms or []:
        n = normalize_member(t)
        if n and n not in seen:
            seen.add(n)
            out.append(n)
    return out


def _get(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def _fetch_one(kind: str, source: str, key: str) -> list:
    """Return the de-duplicated, US-filtered ticker list for one index (source order)."""
    if kind == "constituent":
        url = f"{_BASE}{source}?apikey={urllib.parse.quote(key)}"
        field = "symbol"
    else:
        q = urllib.parse.urlencode({"symbol": source, "apikey": key})
        url = f"{_BASE}/stable/etf/holdings?{q}"
        field = "asset"
    rows = _get(url)
    if not isinstance(rows, list):
        return []
    return normalize_members(
        t for t in (str((r or {}).get(field) or "").strip().upper() for r in rows) if _looks_us(t))


def fetch_index_lists(key: str | None = None) -> dict:
    """{index name: [tickers]} for every index that returned a plausible (>= floor)
    set. A thin/failed fetch is OMITTED (never an empty list) so the caller falls
    back to the prior overlay / committed seed. Order within each list is FMP's
    (holdings are weight-descending); callers may re-sort by dollar volume."""
    key = key or os.environ.get("FMP_API_KEY", "")
    out = {}
    if not key:
        return out
    for name, _desc, kind, source, floor in INDEX_LISTS:
        try:
            ticks = _fetch_one(kind, source, key)
        except Exception:
            ticks = []
        if len(ticks) >= floor:
            out[name] = ticks
    return out
