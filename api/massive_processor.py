"""
massive_processor.py — Aggregates raw Massive OPRA trades into BBS-format events.

Pure logic, no I/O. Two interfaces:
- TradeAggregator: streaming use (WebSocket). Add trades one at a time,
  periodically call flush_ready() to emit completed events.
- batch_process(): batch use (Flat Files). Feed a DataFrame, get rows back.

Events flow: RawTrade → TradeAggregator → AggEvent → event_to_bbs_row() →
dict matching BBS CSV schema → flow_db.insert_csv()

V1 limitations (documented, fixed in V2):
- Side classification stubbed (no NBBO yet — needs Quotes file or live Q stream)
- Spot, IV, OI, MktCap, Sector, ER stubbed (wired to existing helpers at deploy)
"""

import re
from dataclasses import dataclass
from datetime import datetime, date
from zoneinfo import ZoneInfo
from collections import defaultdict
from typing import Optional

ET = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")

# OCC option symbol: O:ROOT YYMMDD C/P STRIKE(8 digits, 3 implied decimals)
# Example: O:MSFT270115C00450000 = MSFT 2027-01-15 Call $450
OCC_PATTERN = re.compile(r'^O:([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$')

# Indexes/ETF underlyings — routed to source='indexes', everything else to 'stocks'.
# Built from your June 22 Indexes-data.csv top tickers + standard set.
INDEX_SYMBOLS = frozenset({
    # Pure indexes
    'SPX', 'SPXW', 'XSP', 'NDX', 'NQX', 'RUT', 'RUTW', 'VIX', 'VIXW',
    # Major broad-market ETFs
    'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'VTI', 'VT', 'VXUS', 'VUG', 'RSP', 'MAGS',
    # Sector ETFs (SPDR)
    'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLB', 'XLU', 'XLC', 'XLRE',
    'XBI', 'XHB', 'XME', 'XOP', 'XSD', 'XTL',
    # Tech / industry ETFs
    'SMH', 'SOXX', 'IBB', 'IGV', 'KWEB', 'FXI', 'MCHI', 'ASHR', 'EWY', 'EWJ',
    'EWT', 'EWZ', 'EEM', 'EFA', 'IWD', 'IWF', 'MTUM', 'IHI', 'JETS', 'TAN',
    'COPX', 'GDX', 'GDXJ', 'SIL', 'SILJ', 'OIH', 'KRE', 'IYR',
    # Bond ETFs
    'TLT', 'IEF', 'HYG', 'LQD', 'BHYP', 'TLH', 'ZROZ', 'EDV', 'TMF',
    # Leveraged / inverse
    'TQQQ', 'SQQQ', 'SOXL', 'SOXS', 'SPXL', 'SPXS', 'TNA', 'TZA', 'UVXY', 'SVXY',
    'UDOW', 'FAS', 'DPST', 'GUSH', 'BOIL', 'KOLD', 'TSLL', 'MSTU', 'MSTX', 'MSFL',
    'AMDL', 'NXT', 'CHAU', 'KORU',
    # Commodities
    'GLD', 'IAU', 'SLV', 'USO', 'UNG', 'UCO', 'SCO', 'BNO', 'LIT', 'URA', 'CPER',
    # Crypto ETFs
    'IBIT', 'FBTC', 'BITX', 'BITO', 'GBTC', 'ETHA', 'ETHU', 'FETH',
    # Volatility / niche
    'VXX', 'JNUG', 'REMX', 'EUAD', 'EUV', 'FXY', 'SPCH', 'SPCX',
})


@dataclass
class RawTrade:
    """A single OPRA trade print, normalized from Massive (Flat Files or WS)."""
    ticker: str
    price: float
    size: int
    exchange: int
    conditions: int
    ts_ns: int  # nanoseconds since epoch, UTC


@dataclass
class AggEvent:
    """An aggregated event, ready to be formatted as a BBS row."""
    ticker: str
    root: str
    cp: str            # CALL / PUT
    strike: float
    expiry: date

    avg_price: float
    total_size: int
    premium: float

    first_ts_ns: int
    last_ts_ns: int
    n_exchanges: int
    n_prints: int
    type_: str         # SWEEP / BLOCK
    side: str          # A / B / AA / BB / "" (empty = MID or unknown)


def parse_occ(ticker: str) -> Optional[dict]:
    """Parse an OCC option ticker. Returns None if not parseable."""
    m = OCC_PATTERN.match(ticker)
    if not m:
        return None
    root, yy, mm, dd, cp_letter, strike_raw = m.groups()
    try:
        expiry = date(2000 + int(yy), int(mm), int(dd))
    except ValueError:
        return None
    return {
        'root': root,
        'expiry': expiry,
        'cp': 'CALL' if cp_letter == 'C' else 'PUT',
        'strike': int(strike_raw) / 1000.0,
    }


def is_index_source(root: str) -> bool:
    """Decide whether an underlying root goes to source='indexes' (vs 'stocks')."""
    return root in INDEX_SYMBOLS


def is_weekly(expiry: date) -> bool:
    """Weekly = not a third-Friday standard monthly expiration."""
    return not (expiry.weekday() == 4 and 15 <= expiry.day <= 21)


class TradeAggregator:
    """
    Streaming aggregator. Add trades in (approximate) time order; completed
    events become available via drain(). Periodically call flush_stale() to
    close out buckets where the latest trade is older than WINDOW_MS.

    Aggregation rule (V1):
    - Group trades on the same (ticker, rounded price) within WINDOW_MS of each
      other (sliding gap, not absolute window)
    - A new trade arriving >WINDOW_MS after the bucket's last trade CLOSES the
      old bucket as an event and starts a fresh bucket — this is the key
      streaming semantic
    - Type: SWEEP if 3+ distinct exchanges, else BLOCK
    - Side: '' for V1 (no NBBO available yet)

    Validated against BBS June 22 MSFT $450C 154-contract event: 5 prints
    across 4 exchanges spanning 76ms all at $16.00 → one BBS SWEEP event.

    Filters:
    - min_premium (default $10K, per user spec)
    - min_volume  (default 50, derived from BBS June 22 distribution: p1=85
      contracts, so 50 is just below their floor — tighten later if noisy)
    """

    WINDOW_MS = 100
    WINDOW_NS = WINDOW_MS * 1_000_000
    PRICE_EPS = 0.0001

    def __init__(self, min_premium: float = 10_000, min_volume: int = 50):
        self.min_premium = min_premium
        self.min_volume = min_volume
        # Active bucket per (ticker, price) — newest still-growing burst
        self._pending: dict[tuple[str, float], list[RawTrade]] = {}
        # Completed events queued for drain()
        self._ready: list[AggEvent] = []
        self._stats = {
            'added': 0, 'emitted': 0, 'dropped_unparseable': 0,
            'dropped_below_premium': 0, 'dropped_below_volume': 0,
        }

    def add_trade(self, trade: RawTrade) -> None:
        if trade.size <= 0 or trade.price <= 0:
            return
        self._stats['added'] += 1
        key = (trade.ticker, round(trade.price, 4))
        bucket = self._pending.get(key)
        if bucket is not None:
            gap = trade.ts_ns - bucket[-1].ts_ns
            if gap > self.WINDOW_NS:
                # Gap too large — close the old burst, start a new one
                self._complete(bucket)
                self._pending[key] = [trade]
            else:
                bucket.append(trade)
        else:
            self._pending[key] = [trade]

    def flush_stale(self, now_ns: int) -> None:
        """Close buckets whose last trade is older than now_ns - WINDOW_MS."""
        cutoff = now_ns - self.WINDOW_NS
        for key in list(self._pending.keys()):
            bucket = self._pending[key]
            if not bucket:
                del self._pending[key]
                continue
            if bucket[-1].ts_ns < cutoff:
                self._complete(bucket)
                del self._pending[key]

    def flush_all(self) -> None:
        """Force-close every pending bucket. Call at shutdown / end-of-day."""
        for bucket in self._pending.values():
            self._complete(bucket)
        self._pending.clear()

    def drain(self) -> list[AggEvent]:
        """Return and clear all completed events."""
        out = self._ready
        self._ready = []
        return out

    def stats(self) -> dict:
        s = dict(self._stats)
        s['pending_keys'] = len(self._pending)
        s['pending_trades'] = sum(len(v) for v in self._pending.values())
        s['ready'] = len(self._ready)
        return s

    def _complete(self, trades: list[RawTrade]) -> None:
        """Turn a closed bucket into an AggEvent (if it passes filters)."""
        evt = self._aggregate(trades)
        if evt is not None:
            self._ready.append(evt)
            self._stats['emitted'] += 1

    def _aggregate(self, trades: list[RawTrade]) -> Optional[AggEvent]:
        if not trades:
            return None

        total_size = sum(t.size for t in trades)
        if total_size <= 0:
            return None

        if total_size < self.min_volume:
            self._stats['dropped_below_volume'] += 1
            return None

        weighted_price = sum(t.price * t.size for t in trades) / total_size
        premium = sum(t.price * t.size for t in trades) * 100.0

        if premium < self.min_premium:
            self._stats['dropped_below_premium'] += 1
            return None

        parsed = parse_occ(trades[0].ticker)
        if parsed is None:
            self._stats['dropped_unparseable'] += 1
            return None

        exchanges = {t.exchange for t in trades}
        type_ = 'SWEEP' if len(exchanges) >= 3 else 'BLOCK'

        return AggEvent(
            ticker=trades[0].ticker,
            root=parsed['root'],
            cp=parsed['cp'],
            strike=parsed['strike'],
            expiry=parsed['expiry'],
            avg_price=weighted_price,
            total_size=total_size,
            premium=premium,
            first_ts_ns=trades[0].ts_ns,
            last_ts_ns=trades[-1].ts_ns,
            n_exchanges=len(exchanges),
            n_prints=len(trades),
            type_=type_,
            side='',  # V1: no NBBO
        )


# ── BBS row formatting ──────────────────────────────────────────────

def _fmt_mdY(d: date) -> str:
    """Format date as 'M/D/YYYY' (no zero-pad), matching BBS."""
    return f"{d.month}/{d.day}/{d.year}"


def _fmt_time(ts_et: datetime) -> str:
    """Format time as 'H:MM:SS AM/PM' (no leading zero on hour)."""
    h = ts_et.hour % 12 or 12
    ampm = 'PM' if ts_et.hour >= 12 else 'AM'
    return f"{h}:{ts_et.minute:02d}:{ts_et.second:02d} {ampm}"


def _fmt_price(p: float) -> str:
    """Match BBS-style: usually 2-3 decimals, trim trailing zeros if cleaner."""
    s = f"{p:.4f}"
    if '.' in s:
        s = s.rstrip('0').rstrip('.')
    return s or '0'


def _fmt_strike(s: float) -> str:
    """Match BBS: integer strikes stay integers; halves show .5."""
    if s == int(s):
        return str(int(s))
    return f"{s:.1f}".rstrip('0').rstrip('.')


def event_to_bbs_row(
    evt: AggEvent,
    source: str,
    *,
    spot: float = 0.0,
    iv: float = 0.0,
    oi: int = 0,
    mktcap: int = 0,
    sector: str = '',
    er_flag: str = 'F',
    uoa_flag: Optional[str] = None,
) -> dict:
    """
    Convert an AggEvent to a BBS CSV row dict.

    Enrichment params (spot, iv, oi, mktcap, sector, er_flag, uoa_flag) come
    from your existing helpers at deploy time. Defaults are V1 stubs that
    insert cleanly but show 0/blank in the UI for those fields.
    """
    ts_et = datetime.fromtimestamp(evt.first_ts_ns / 1e9, tz=UTC).astimezone(ET)
    dte = (evt.expiry - ts_et.date()).days

    # Uoa derived from volume/OI ratio if not provided and OI is known
    if uoa_flag is None:
        if oi > 0 and evt.total_size > oi:
            uoa_flag = 'T'
        else:
            uoa_flag = 'F'

    stock_etf = 'ETF' if source == 'indexes' else 'STOCK'

    return {
        'CreatedDate': _fmt_mdY(ts_et.date()),
        'CreatedTime': _fmt_time(ts_et),
        'Symbol': evt.root,
        'Type': evt.type_,
        'Volume': str(evt.total_size),
        'Price': _fmt_price(evt.avg_price),
        'Side': evt.side,
        'CallPut': evt.cp,
        'Strike': _fmt_strike(evt.strike),
        'Spot': _fmt_price(spot) if spot else '0',
        'Premium': str(int(round(evt.premium))),
        'ExpirationDate': _fmt_mdY(evt.expiry),
        'Color': 'WHITE',
        'ImpliedVolatility': f"{iv:.2f}" if iv else '0',
        'Dte': str(dte),
        'ER': er_flag,
        'StockEtf': stock_etf,
        'Sector': sector,
        'Uoa': uoa_flag,
        'Weekly': 'T' if is_weekly(evt.expiry) else 'F',
        'MktCap': str(mktcap) if mktcap else '0',
        'OI': str(oi) if oi else '0',
    }


# ── Batch processor (for Flat Files validation + backfill) ────────────

def batch_process(
    df,  # pandas DataFrame with columns: ticker, price, size, exchange, conditions, sip_timestamp
    min_premium: float = 10_000,
    min_volume: int = 50,
    flush_interval_rows: int = 10_000,
) -> tuple[list[AggEvent], dict]:
    """
    Process a sorted-by-timestamp DataFrame of raw OPRA trades.
    Returns (events, stats).

    Note: add_trade does most of the splitting (via gap detection), but we
    still call flush_stale periodically so buckets that just go quiet
    (no further trades at that price) get emitted at the right time.
    """
    import pandas as pd

    if 'sip_timestamp' not in df.columns:
        raise ValueError("DataFrame must have sip_timestamp column")

    agg = TradeAggregator(min_premium=min_premium, min_volume=min_volume)
    events: list[AggEvent] = []
    last_ts = 0

    for i, row in enumerate(df.itertuples(index=False)):
        cond = row.conditions
        if pd.isna(cond):
            cond = -1
        agg.add_trade(RawTrade(
            ticker=row.ticker,
            price=float(row.price),
            size=int(row.size),
            exchange=int(row.exchange),
            conditions=int(cond),
            ts_ns=int(row.sip_timestamp),
        ))
        last_ts = int(row.sip_timestamp)

        if (i + 1) % flush_interval_rows == 0:
            agg.flush_stale(last_ts)
            events.extend(agg.drain())

    agg.flush_all()
    events.extend(agg.drain())
    return events, agg.stats()
