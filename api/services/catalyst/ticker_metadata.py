"""Per-ticker metadata enrichment: sector, market cap, average volume, share counts.

Two reads feed one 24h SQLite cache (to bound external calls):
  * the company profile and the share-float read (FMP) supply market cap, the
    instrument type, the 52-week high, float and shares outstanding;
  * the Yahoo read supplies sector, industry and the average volume, and any of
    the fields above that the first read has no value for.
Used by sources.py to enrich candidates with the fields that
get_batch_rich_snapshots doesn't provide.

The company profile is also what the news gate (engine.py) and the movers
filter (massive.py) read, through `profile_facts`, so a ticker is asked for at
most once a day whoever asks first.
"""
from __future__ import annotations

import contextlib
import json
import logging
import math
import os
import sqlite3
import threading
import time
from typing import Optional

from api.services import yf_util

logger = logging.getLogger(__name__)

_DB_PATH = os.environ.get("CATALYST_METADATA_DB_PATH", "/data/catalyst_metadata.db")
_WRITE_LOCK = threading.Lock()

# 24h cache TTL — sector/cap/ADV don't change meaningfully day-to-day.
_TTL_SECONDS = 24 * 3600

_SCHEMA = """
CREATE TABLE IF NOT EXISTS ticker_metadata (
  ticker              TEXT PRIMARY KEY,
  sector              TEXT,
  industry            TEXT,
  market_cap          REAL,
  avg_volume_30d      INTEGER,
  fifty_two_week_high REAL,
  quote_type          TEXT,
  float_shares        INTEGER,
  shares_outstanding  INTEGER,
  fetched_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meta_fetched ON ticker_metadata(fetched_at);
CREATE TABLE IF NOT EXISTS vendor_asks (
  ticker    TEXT NOT NULL,
  kind      TEXT NOT NULL,
  state     TEXT NOT NULL,
  facts     TEXT,
  asked_at  INTEGER NOT NULL,
  PRIMARY KEY (ticker, kind)
);
"""


_INIT_DONE = False
_INIT_LOCK = threading.Lock()


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _init_db() -> None:
    global _INIT_DONE
    with _INIT_LOCK:
        if _INIT_DONE:
            return
        parent = os.path.dirname(_DB_PATH)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with contextlib.closing(_connect()) as c:
            c.executescript(_SCHEMA)
            # Backwards-compat: add columns to pre-existing DBs (SQLite has no
            # IF NOT EXISTS on columns, so try + swallow duplicate-column).
            for col, decl in (("fifty_two_week_high", "REAL"),
                              ("quote_type", "TEXT"),
                              ("float_shares", "INTEGER"),
                              ("shares_outstanding", "INTEGER")):
                try:
                    c.execute(f"ALTER TABLE ticker_metadata ADD COLUMN {col} {decl}")
                except sqlite3.OperationalError as e:
                    if "duplicate column name" not in str(e).lower():
                        raise
            c.commit()
        _INIT_DONE = True


def _ensure_init():
    """Lazy init — called by every public function."""
    if not _INIT_DONE:
        _init_db()


def _get_cached(ticker: str) -> Optional[dict]:
    _ensure_init()
    cutoff = int(time.time()) - _TTL_SECONDS
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT * FROM ticker_metadata WHERE ticker = ? AND fetched_at >= ?",
            (ticker.upper(), cutoff),
        ).fetchone()
        return dict(row) if row else None


def _put_cache(ticker: str, sector: Optional[str], industry: Optional[str],
               market_cap: Optional[float], avg_volume_30d: Optional[int],
               fifty_two_week_high: Optional[float] = None,
               quote_type: Optional[str] = None,
               float_shares: Optional[int] = None,
               shares_outstanding: Optional[int] = None) -> None:
    _ensure_init()
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            """INSERT INTO ticker_metadata
               (ticker, sector, industry, market_cap, avg_volume_30d,
                fifty_two_week_high, quote_type, float_shares,
                shares_outstanding, fetched_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(ticker) DO UPDATE SET
                 sector = excluded.sector,
                 industry = excluded.industry,
                 market_cap = excluded.market_cap,
                 avg_volume_30d = excluded.avg_volume_30d,
                 fifty_two_week_high = excluded.fifty_two_week_high,
                 quote_type = excluded.quote_type,
                 float_shares = excluded.float_shares,
                 shares_outstanding = excluded.shares_outstanding,
                 fetched_at = excluded.fetched_at""",
            (ticker.upper(), sector, industry, market_cap, avg_volume_30d,
             fifty_two_week_high, quote_type, float_shares,
             shares_outstanding, int(time.time())),
        )
        c.commit()


# ── One vendor read per ticker per day ───────────────────────────────────────
# The company profile and the share-float read are each made at most once in
# 24 h per ticker, whoever asks: this module, the news gate (engine.py) or the
# movers filter (massive.py). Every ask that went out is recorded with its
# outcome -- a row ("ok"), no row ("none") or a failed read ("failed") -- in this
# module's database, so a restart does not ask again and a ticker the vendor
# holds nothing for is not asked every few minutes. A failed read is recorded as
# an ASK, never as an answer: the caller gets None and uses its other source.
_ASK_TTL_SECONDS = 24 * 3600
_VENDOR_TIMEOUT_S = 8
# Every caller of these reads is a background build (the catalyst refresh, the
# news build, the movers build), and a news build can ask for hundreds of
# tickers at once. The request budget is shared with the panels a member is
# looking at, so an ask goes out only while the budget holds at least this many
# requests (the reserve `research_panel_warm` keeps). Below it nothing is asked
# and nothing is recorded: the caller uses its other source and a later build
# asks.
_MEMBER_RESERVE_TOKENS = 60.0

# (ticker, kind) -> (asked_at, state, facts): this process's copy of the record.
_ASKED: dict = {}
_ASK_LOCKS: dict = {}
_ASK_LOCKS_GUARD = threading.Lock()


def _ask_lock(key: tuple) -> threading.Lock:
    """One lock per (ticker, kind), so two callers cannot both ask for one ticker."""
    with _ASK_LOCKS_GUARD:
        lock = _ASK_LOCKS.get(key)
        if lock is None:
            lock = _ASK_LOCKS[key] = threading.Lock()
        return lock


def _recorded_ask(ticker: str, kind: str) -> Optional[tuple]:
    """(state, facts) of the ask made in the last 24 h, or None when there was none."""
    key = (ticker, kind)
    cutoff = int(time.time()) - _ASK_TTL_SECONDS
    hit = _ASKED.get(key)
    if hit and hit[0] >= cutoff:
        return hit[1], hit[2]
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT state, facts, asked_at FROM vendor_asks"
            " WHERE ticker = ? AND kind = ? AND asked_at >= ?",
            (ticker, kind, cutoff),
        ).fetchone()
    if not row:
        return None
    facts = json.loads(row["facts"]) if row["facts"] else None
    _ASKED[key] = (row["asked_at"], row["state"], facts)
    return row["state"], facts


def _record_ask(ticker: str, kind: str, state: str, facts: Optional[dict]) -> None:
    now = int(time.time())
    _ASKED[(ticker, kind)] = (now, state, facts)
    try:
        _ensure_init()
        with _WRITE_LOCK, contextlib.closing(_connect()) as c:
            c.execute(
                """INSERT INTO vendor_asks (ticker, kind, state, facts, asked_at)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(ticker, kind) DO UPDATE SET
                     state = excluded.state,
                     facts = excluded.facts,
                     asked_at = excluded.asked_at""",
                (ticker, kind, state,
                 json.dumps(facts) if facts is not None else None, now),
            )
            c.commit()
    except Exception as e:
        logger.warning("[ticker_metadata] could not record the %s ask for %s: %s",
                       kind, ticker, e)


def _vendor_row(body) -> Optional[dict]:
    """These endpoints answer with a list of one row (some with a bare row)."""
    if isinstance(body, list) and body and isinstance(body[0], dict):
        return body[0]
    if isinstance(body, dict) and body:
        return body
    return None


def _positive(value) -> Optional[float]:
    """A real number above zero, else None. A vendor's 0 is "nothing held"."""
    if isinstance(value, bool):
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    return num if math.isfinite(num) and num > 0 else None


def _flag(value) -> Optional[bool]:
    return value if isinstance(value, bool) else None


def _profile_facts_from_row(row: dict) -> dict:
    # `range` is the 52-week range as "low-high".
    parts = str(row.get("range") or "").split("-")
    year_high = _positive(parts[1].strip()) if len(parts) == 2 else None
    return {
        "name": str(row.get("companyName") or "").strip() or None,
        "is_etf": _flag(row.get("isEtf")),
        "is_fund": _flag(row.get("isFund")),
        "market_cap": _positive(row.get("marketCap")),
        "price": _positive(row.get("price")),
        "avg_volume": _positive(row.get("averageVolume")),
        "year_high": year_high,
    }


def _share_counts_from_row(row: dict) -> dict:
    float_shares = _positive(row.get("floatShares"))
    outstanding = _positive(row.get("outstandingShares"))
    # A float larger than the shares outstanding cannot be true, and nothing
    # says which side is wrong: use neither.
    if float_shares and outstanding and float_shares > outstanding:
        float_shares = outstanding = None
    return {
        "float_shares": int(float_shares) if float_shares else None,
        "shares_outstanding": int(outstanding) if outstanding else None,
    }


def _ask_once_a_day(ticker: str, kind: str, read, parse) -> Optional[dict]:
    """`parse` of the row `read` returns, asked for at most once in 24 h per ticker.
    None when the vendor has no row, the read failed, or it cannot be made now."""
    sym = (ticker or "").strip().upper()
    if not sym:
        return None
    with _ask_lock((sym, kind)):
        try:
            seen = _recorded_ask(sym, kind)
        except Exception as e:
            # The record cannot be read, so a new ask could not be counted
            # against it: make none, and let the caller use its other source.
            logger.warning("[ticker_metadata] ask record unreadable for %s: %s", sym, e)
            return None
        if seen is not None:
            state, facts = seen
            return dict(facts) if state == "ok" and facts else None

        from api.services import fmp_client
        try:
            if float(fmp_client.tokens_available()) < _MEMBER_RESERVE_TOKENS:
                return None
        except Exception:
            pass  # an unreadable budget must not stop the read: it answers for itself
        try:
            result = read(fmp_client, sym)
        except fmp_client.FMPNotFound:
            _record_ask(sym, kind, "none", None)
            return None
        except fmp_client.FMPNotConfigured:
            return None  # no key: nothing went out, so there is no ask to record
        except fmp_client.FMPRateLimited as e:
            # The vendor's own 429 carries a status and counts as an ask. The
            # local request budget refusing carries none: nothing went out.
            if getattr(e, "status", None) is not None:
                _record_ask(sym, kind, "failed", None)
            return None
        except Exception as e:
            logger.warning("[ticker_metadata] %s read failed for %s: %s", kind, sym, e)
            _record_ask(sym, kind, "failed", None)
            return None
        if getattr(result, "degraded", None):
            return None  # the endpoint is parked after a refusal: nothing went out
        row = _vendor_row(getattr(result, "value", None))
        if row is None:
            _record_ask(sym, kind, "none", None)
            return None
        facts = parse(row)
        _record_ask(sym, kind, "ok", facts)
        return dict(facts)


def profile_facts(ticker: str) -> Optional[dict]:
    """The company profile's facts for one ticker: name, is_etf, is_fund,
    market_cap (USD), price, avg_volume and year_high, each None when the row
    lacks it. None when the vendor has no row for the ticker, the read failed,
    or it cannot be made now. Asked for at most once in 24 h. Never raises."""
    try:
        return _ask_once_a_day(
            ticker, "profile",
            lambda fmp, sym: fmp.get_company_profile(sym, timeout=_VENDOR_TIMEOUT_S),
            _profile_facts_from_row)
    except Exception as e:
        logger.warning("[ticker_metadata] profile facts failed for %s: %s", ticker, e)
        return None


def share_counts(ticker: str) -> Optional[dict]:
    """float_shares and shares_outstanding from the share-float read (each None
    when not reported). None when the vendor has no row, the read failed, or it
    cannot be made now. Asked for at most once in 24 h. Never raises."""
    try:
        return _ask_once_a_day(
            ticker, "share_counts",
            lambda fmp, sym: fmp.get_shares_float(sym, timeout=_VENDOR_TIMEOUT_S),
            _share_counts_from_row)
    except Exception as e:
        logger.warning("[ticker_metadata] share counts failed for %s: %s", ticker, e)
        return None


def _quote_type_from_profile(facts: dict) -> Optional[str]:
    """The instrument type in the words the quality gate reads (EQUITY / ETF /
    MUTUALFUND), or None when the profile does not say."""
    is_etf, is_fund = facts.get("is_etf"), facts.get("is_fund")
    if is_etf is True:
        return "ETF"
    if is_fund is True:
        return "MUTUALFUND"
    if is_etf is False and is_fund is False:
        return "EQUITY"
    return None


def _fetch_fresh(ticker: str) -> dict:
    """One ticker's fields for the cache.

    Market cap, the 52-week high and the two share counts come from the company
    profile and the share-float read; where those have no value (no row, a
    failed read, a field the row lacks) the Yahoo read's value is kept. The
    instrument type is "fund" when either read says so.

    Sector and industry stay on the Yahoo read: the catalyst engine groups and
    matches on those exact strings (the sector banner, the bank-industry score),
    and another source words them differently. The average volume stays there
    too: the volume multiple a member sees divides by it, and a different
    averaging window would move that number.
    """
    facts = profile_facts(ticker) or {}
    counts = share_counts(ticker) or {}
    out = _fetch_via_yfinance(ticker)
    # The quality gate drops anything that is not a stock. A profile that says
    # "fund" settles it; one that says "company" does not overrule a Yahoo read
    # that says otherwise, so the gate is never looser than either read.
    kind = _quote_type_from_profile(facts)
    if kind == "EQUITY" and out.get("quote_type"):
        kind = None
    first = {
        "market_cap": facts.get("market_cap"),
        "quote_type": kind,
        "fifty_two_week_high": facts.get("year_high"),
        "float_shares": counts.get("float_shares"),
        "shares_outstanding": counts.get("shares_outstanding"),
    }
    for key, value in first.items():
        if value is not None:
            out[key] = value
    return out


def _fetch_via_yfinance(ticker: str) -> dict:
    """Hit yfinance Ticker(t).info. Returns the fields we want or empties on error."""
    try:
        import yfinance as yf
        info = yf_util.bounded_call(lambda: yf.Ticker(ticker).info, None) or {}
        return {
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "market_cap": float(info.get("marketCap")) if info.get("marketCap") else None,
            # yfinance gives several avg-volume variants; averageVolume = 10-day avg by default
            "avg_volume_30d": (int(info.get("averageVolume10days")
                                   or info.get("averageVolume")
                                   or info.get("averageDailyVolume10Day")
                                   or 0) or None),
            # 52-week high powers the breakout signal (price at/near new highs
            # on volume = a core swing setup the news feeds don't flag).
            "fifty_two_week_high": (float(info.get("fiftyTwoWeekHigh"))
                                    if info.get("fiftyTwoWeekHigh") else None),
            # EQUITY / ETF / MUTUALFUND / INDEX / CRYPTOCURRENCY — lets the
            # quality gate drop non-stock instruments (a leveraged-semis ETF
            # was SELECTED on 2026-06-11; SOXL/SOXS/KORU recur in gap scans).
            "quote_type": info.get("quoteType"),
            "float_shares": (int(info.get("floatShares"))
                             if info.get("floatShares") else None),
            "shares_outstanding": (int(info.get("sharesOutstanding"))
                                   if info.get("sharesOutstanding") else None),
        }
    except Exception as e:
        logger.warning("[ticker_metadata] yfinance failed for %s: %s", ticker, e)
        return {"sector": None, "industry": None, "market_cap": None,
                "avg_volume_30d": None, "fifty_two_week_high": None,
                "quote_type": None, "float_shares": None,
                "shares_outstanding": None}


def get_metadata(ticker: str) -> dict:
    """Returns dict with sector, industry, market_cap, avg_volume_30d.
    Uses cache when fresh; else fetches fresh + caches.
    Never raises — returns empty fields on any error."""
    if not ticker:
        return {"sector": None, "industry": None, "market_cap": None,
                "avg_volume_30d": None, "fifty_two_week_high": None,
                "quote_type": None, "float_shares": None,
                "shares_outstanding": None}

    cached = _get_cached(ticker)
    if cached:
        return {
            "sector": cached.get("sector"),
            "industry": cached.get("industry"),
            "market_cap": cached.get("market_cap"),
            "avg_volume_30d": cached.get("avg_volume_30d"),
            "fifty_two_week_high": cached.get("fifty_two_week_high"),
            "quote_type": cached.get("quote_type"),
            "float_shares": cached.get("float_shares"),
            "shares_outstanding": cached.get("shares_outstanding"),
        }

    fresh = _fetch_fresh(ticker)
    _put_cache(ticker, fresh["sector"], fresh["industry"],
               fresh["market_cap"], fresh["avg_volume_30d"],
               fresh.get("fifty_two_week_high"), fresh.get("quote_type"),
               fresh.get("float_shares"), fresh.get("shares_outstanding"))
    return fresh


def get_metadata_batch(tickers: list[str]) -> dict[str, dict]:
    """Returns {ticker: metadata_dict} for a list of tickers.
    Cache-hits are instant; misses read one ticker at a time (yfinance bulk
    calls aren't reliable, and we only enrich ~30-50 tickers per refresh).
    """
    return {t.upper(): get_metadata(t) for t in tickers}
