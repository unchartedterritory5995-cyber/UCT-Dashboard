"""Quarterly YoY earnings growth from FMP — the half yfinance leaves blank.

WHY THIS EXISTS
---------------
`get_fundamentals` reads `earnings_growth_pct` from yfinance's
`info["earningsGrowth"]`, and that field is empty far more often than it
should be. Sampled live 2026-08-06 across 40 liquid names, **8 (20%) had no
EPS rating at all** as a direct result — and EPS carries the joint-largest
weight (0.25) in the UCT Composite, so one ticker in five was scoring on 75%
of the intended basis.

WHAT THIS CAN AND CANNOT FIX -- the distinction is the whole design
-------------------------------------------------------------------
Of those 8, only SOME were provider gaps. Measured, not assumed:

  PANW   year-ago quarter POSITIVE  -> -167.5%  RECOVERABLE
  COIN   year-ago quarter POSITIVE  -> -125.2%  RECOVERABLE
  JAZZ   year-ago quarter a LOSS    ->  UNDEFINED  (-$405M TTM -> +$941M)
  CRWD, SNOW, ZS, TEAM  likewise    ->  UNDEFINED

A growth PERCENTAGE from a negative or zero base is not a hard number, it is
a meaningless one: JAZZ went -$405M -> +$941M, which is a loss-to-profit
turnaround and arguably the strongest earnings signal there is, but "+332%"
would be arithmetic theatre -- the sign flip, not the magnitude, is the
information. So this module REFUSES those rather than inventing a figure, and
the UI's coverage note already explains the gap honestly (see
`research/ratings._coverage`). Filling them would be worse than the gap.

IT MUST BE THE *SAME* STATISTIC, AND THAT WAS MEASURED
-----------------------------------------------------
The composite ranks `earnings_growth` as a PERCENTILE across the universe. If
80% of tickers carried yfinance's definition and the backfilled 20% carried a
different one, the ranking would silently compare unlike things -- worse than
the blank it replaced, because it would look authoritative.

So the method was chosen by measurement, not intuition. Both candidates were
computed for 9 names where yfinance HAS a value (2026-08-06):

    SYM    yfinance   TTM-over-TTM   quarter-YoY
    MSFT       31.7           31.3          31.3
    NVDA      214.5          107.9         210.6   <-- decisive
    AAPL       28.7           29.9          27.1
    AMD       159.5          127.0         163.4
    LLY        26.2           93.5          25.3   <-- decisive
    ORCL       21.9           37.3          25.6
    ANET       35.7           24.4          36.5
    V          10.2           11.4           6.8
    COST       45.5           12.7          15.2   <-- neither

TTM-over-TTM is the intuitive choice and it is WRONG: it halves NVDA and
nearly quadruples LLY. `info["earningsGrowth"]` is the most recent quarter
against the YEAR-AGO quarter, so that is what this computes -- accepting that
a single quarter is noisier, because matching the incumbent definition matters
more than picking the nicer statistic.

COST matches neither and is left as a known outlier (a fiscal-calendar
mismatch is the likely cause); one name in nine, and it only ever applies when
yfinance returned nothing anyway.

RENAMED AND REUSED TICKERS
--------------------------
FMP keeps answering for a RETIRED symbol. Block renamed SQ -> XYZ, and yfinance
returns nothing for SQ, so the backfill above fired and handed SQ a confident
EPS rating built on figures filed under a symbol that no longer trades. That
turned "no rating" into "a wrong-looking rating", which is the wrong direction.

A staleness check does NOT catch it, and that was measured rather than assumed:

    SQ    latest period 2026-06-30, accepted 2026-08-05, isActivelyTrading=False
    XYZ   latest period 2026-06-30, accepted 2026-08-05, isActivelyTrading=True

FMP serves the SAME current filings under both symbols, so nothing about the
dates distinguishes them. `isActivelyTrading` does, and it is authoritative:
TWTR also reports False (its profile name even ends "(delisted)").

So `is_actively_trading` gates the backfill. It fails CLOSED on an explicit
False and OPEN on an unknown -- a profile outage should cost nothing, but a
provider that positively says "this symbol is retired" is believed.

⚠️ Not covered, deliberately: a REUSED ticker. FB now resolves to a ProShares
ETF -- `isActivelyTrading` is True because the SYMBOL trades, just not as the
company you meant. The `len(ni) <= _YEAR_AGO` guard already refuses it (an ETF
has no quarterly income statement), but a reused OPERATING company would slip
through. That needs real symbol resolution, not a flag.

⚠️ This guard is deliberately scoped to the BACKFILL, not to
`get_fundamentals` at large: Model Book intentionally curates renamed and
delisted tickers (SQ, WTW, WWE), and refusing them wholesale would break it.
The narrow risk here is a stale number silently entering a PERCENTILE ranking.
"""
from __future__ import annotations

import logging

# Resolved through the MODULE at call time, never `from ... import _fmp_get`.
# A bound copy severs this module from the owner's guards AND from every test
# stub -- that exact mistake sent a live request through an active provider
# cooldown on 2026-08-06. See earnings_history_fmp for the full note.
from api.services import earnings_estimates as _ee
from api.services.cache import cache

_log = logging.getLogger(__name__)

# Quarters pulled. Only rows 0 and 4 are read, but asking for a few extra
# absorbs a restated or duplicated period without the year-ago row falling off
# the end of the response.
_QUARTERS = 8
# Rows back to the year-ago quarter in a newest-first quarterly list.
_YEAR_AGO = 4

_CACHE_TTL = 6 * 3600      # fundamentals move quarterly; 6h is generous
_MISS_TTL = 900            # never cache a failed fetch as a durable value
_SENTINEL = "__none__"     # distinguishes "asked, no answer" from a cache miss
# A symbol stops trading roughly once, forever — no reason to re-ask hourly,
# and the extra profile call rides only the already-rare backfill path.
_ACTIVE_TTL = 24 * 3600


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and f not in (float("inf"), float("-inf")) else None


def _profile(sym: str):
    """FMP's company profile, cached. None when the provider had nothing.

    ONE fetch serves every flag below, so adding a check costs no extra
    request — and the profile only ever rides the already-rare backfill path.
    """
    sym = (sym or "").upper().strip()
    if not sym:
        return None

    ck = f"fmp_profile::{sym}"
    hit = cache.get(ck)
    if hit is not None:
        return None if hit == _SENTINEL else hit

    try:
        rows = _ee._fmp_get("/stable/profile", {"symbol": sym})
    except Exception as exc:                           # noqa: BLE001
        _log.warning("FMP profile failed for %s: %s", sym, exc)
        rows = None

    out = rows[0] if isinstance(rows, list) and rows and isinstance(rows[0], dict) else None
    cache.set(ck, _SENTINEL if out is None else out,
              _MISS_TTL if out is None else _ACTIVE_TTL)
    return out


def _flag(ticker: str, field: str) -> bool | None:
    """One profile field as a STRICT tri-state.

    A non-boolean ("" or 0) is UNKNOWN, not False. Reading it as falsy would
    silently disqualify live symbols on a sloppy provider response.
    """
    prof = _profile(ticker)
    if not isinstance(prof, dict):
        return None
    v = prof.get(field)
    return v if isinstance(v, bool) else None


def is_actively_trading(ticker: str) -> bool | None:
    """FMP's own verdict on whether this SYMBOL still trades.

    True / False / None, and the three are distinct on purpose: None means we
    could not ask, which callers must not treat as False. Verified 2026-08-06 —
    SQ False vs XYZ True for the same company, TWTR False.
    """
    return _flag(ticker, "isActivelyTrading")


def is_fund(ticker: str) -> bool | None:
    """True when the symbol is an ETF or fund rather than an operating company.

    This is the REUSED-ticker case, and it turned out narrower than it looked.
    FB was Facebook and now resolves to "ProShares S&P 500 Dynamic Buffer ETF":
    `isActivelyTrading` is True, because the SYMBOL genuinely trades — just not
    as the company anyone means by "FB".

    A cross-provider NAME check was the obvious guard, and measuring killed it:
    on 2026-08-06 yfinance and FMP agreed on the company name for every symbol
    tested INCLUDING FB (both say ProShares). Both providers had correctly
    re-pointed the symbol, so there is no disagreement to detect.

    `isEtf`/`isFund` is the real signal, and it is free — same cached profile.

    ⚠️ The case this deliberately does NOT chase: a ticker freed by one
    OPERATING company and taken by another. Both providers agree on the current
    company and its financials are CORRECT for it. That is a question of which
    company the CALLER meant, not a data-integrity defect, and it is not
    solvable at this layer.
    """
    etf, fund = _flag(ticker, "isEtf"), _flag(ticker, "isFund")
    if etf is None and fund is None:
        return None
    return bool(etf) or bool(fund)


def earnings_growth_pct(ticker: str) -> float | None:
    """Quarter-over-year-ago-quarter net-income growth %, or None.

    None covers "FMP had nothing", "the prior-year base was <= 0 so the
    percentage is undefined", and "this symbol no longer trades". The caller
    cannot act differently on any of them -- in every case there is no honest
    figure to show -- and collapsing them keeps this from implying a precision
    it does not have.
    """
    sym = (ticker or "").upper().strip()
    if not sym:
        return None

    ck = f"fmp_eg::{sym}"
    hit = cache.get(ck)
    if hit is not None:
        return None if hit == _SENTINEL else hit

    # A RETIRED symbol still gets served current filings by FMP (SQ carries
    # Block's 2026-08-05 numbers exactly as XYZ does), so this must be asked
    # explicitly -- no property of the figures themselves reveals it. Fails
    # CLOSED only on a definite False; an unknown must not cost coverage.
    if is_actively_trading(sym) is False:
        _log.info("earnings-growth backfill declined for %s: symbol is not "
                  "actively trading (renamed or delisted)", sym)
        cache.set(ck, _SENTINEL, _ACTIVE_TTL)
        return None

    # An ETF/fund has no earnings to grow. FB trades actively — as a ProShares
    # ETF — so the previous check passes it through; only this one refuses it.
    if is_fund(sym) is True:
        _log.info("earnings-growth backfill declined for %s: symbol is a "
                  "fund/ETF, not an operating company", sym)
        cache.set(ck, _SENTINEL, _ACTIVE_TTL)
        return None

    try:
        rows = _ee._fmp_get("/stable/income-statement",
                            {"symbol": sym, "period": "quarter", "limit": _QUARTERS})
    except Exception as exc:                       # noqa: BLE001 - never raise
        _log.warning("FMP income statement failed for %s: %s", sym, exc)
        rows = None

    out = _growth_from_rows(rows)
    # Short TTL on a miss so a transient provider blip doesn't pin a blank for
    # six hours; full TTL only on a real answer.
    cache.set(ck, _SENTINEL if out is None else out,
              _MISS_TTL if out is None else _CACHE_TTL)
    return out


def _growth_from_rows(rows) -> float | None:
    """Pure half, so the arithmetic is testable without touching the network.

    Most recent quarter vs the YEAR-AGO quarter -- matching what
    `info["earningsGrowth"]` reports. See the module note for the measurement
    that ruled out TTM-over-TTM.
    """
    if not isinstance(rows, list):
        return None
    # Drop unusable rows BEFORE indexing, but keep order: position 4 must still
    # be four QUARTERS back. A row with no netIncome would otherwise shift the
    # year-ago index and quietly compare the wrong two periods.
    ni = [_num(r.get("netIncome")) for r in rows if isinstance(r, dict)]
    if len(ni) <= _YEAR_AGO:
        return None
    recent, year_ago = ni[0], ni[_YEAR_AGO]
    if recent is None or year_ago is None:
        return None

    # THE REFUSAL. A percentage from a non-positive base is undefined, not
    # merely large -- see the module note. Returning something here is the
    # single easiest way to make this feature worse than the gap it fills.
    if year_ago <= 0:
        return None
    return round((recent - year_ago) / year_ago * 100, 1)
