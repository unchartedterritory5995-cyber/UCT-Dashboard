"""
massive_processor.py -- Aggregates raw Massive OPRA trades into BBS-format events.

Pure logic, no I/O. Two interfaces:
- TradeAggregator: streaming use (WebSocket). Add trades one at a time,
  periodically call flush_ready() to emit completed events.
- batch_process(): batch use (Flat Files). Feed a DataFrame, get rows back.

Events flow: RawTrade -> TradeAggregator -> AggEvent -> event_to_bbs_row() ->
dict matching BBS CSV schema -> flow_db.insert_csv()

V1 limitations (documented, fixed in V2):
- Side classification stubbed (no NBBO yet -- needs Quotes file or live Q stream)
- Spot, IV, OI, MktCap, Sector, ER stubbed (wired to existing helpers at deploy)
"""

import os
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

# Indexes/ETF underlyings -- routed to source='indexes', everything else to 'stocks'.
# Built from your June 22 Indexes-data.csv top tickers + standard set.
INDEX_SYMBOLS = frozenset({
    # Pure indexes
    'SPX', 'SPXW', 'XSP', 'NDX', 'NDXP', 'NQX', 'RUT', 'RUTW', 'VIX', 'VIXW',
    #                    ^^^^ 7/7: NDXP (PM-settled Nasdaq-100 Index) was
    #                    missing, so its prints were routing to source='stocks'
    #                    and stamped StockEtf='STOCK'. Fixed.
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


# -- OPRA condition code semantics (Phase 2e: Block B multi-leg detection) --
#
# Fetched from Massive's official conditions reference at
# https://api.massive.com/v3/reference/conditions?asset_class=options&data_type=trade
#
# These codes tell us what kind of execution the print represents. Before
# Phase 2e we classified type with a heuristic (n_exchanges >= 3 = SWEEP),
# but the condition code is the ground truth from OPRA itself.

# Cancels / retractions -- DROP these trades entirely. They never actually
# executed (or were broken/busted post-execution).
#
# 6/27/2026 update: added 202 and 204 after observing $607M of cancel-class
# notional leaking through on 6/26. Bull Flow labels these "Cancelled" /
# "Correction" in their UI; BBS filters them entirely. Example: CAPR CALL
# $30 8/21 at 14:06:30 -- 5000 contracts @ $8.00 cond=204 = $4M phantom
# trade (CAPR was at $26, OTM $30 call worth $1-2 -- 4x fair value, classic
# busted print). Codenames below are inferred from OPRA spec; verify exact
# names via https://api.massive.com/v3/reference/conditions when convenient.
#
# Note: cond=231 (SLFT) is NOT added here even though it appears in cancel
# cascades, because it's also the marker for legitimate Single Leg Floor
# Trades on clean contracts (~$700M/day of real flow). The contaminated-
# contract pattern (231 on a contract that ALSO has 202/204) is handled
# at EOD via apply_cancel_patches.py, where we know the full day's prints.
CANCEL_CONDITIONS = frozenset({
    201,  # CANC -- Canceled
    202,  # LATE -- Late report (inferred name; filter rationale: 6/26 data)
    203,  # CNCL -- Last and Canceled
    204,  # LCAN -- Late Cancel (inferred name; filter rationale: 6/26 data)
    205,  # CNCO -- Opening Trade and Canceled
    207,  # CNOL -- Only Trade and Canceled
})

# Multi-leg / spread / combo prints. Any of these on a print means the burst
# is part of a complex order (vertical spread, iron condor, calendar, etc.).
# BBS tags these as type 'ML/'. These account for ~20% of all OPRA prints
# and ~80%+ of institutional premium flow.
MULTI_LEG_CONDITIONS = frozenset({
    232,  # MLET -- Multi Leg auto-electronic trade
    233,  # MLAT -- Multi Leg Auction
    234,  # MLCT -- Multi Leg Cross
    235,  # MLFT -- Multi Leg floor trade
    236,  # MESL -- Multi Leg auto-electronic trade against single leg(s)
    237,  # TLAT -- Stock Options Auction (stock+options combo)
    238,  # MASL -- Multi Leg Auction against single leg(s)
    239,  # MFSL -- Multi Leg floor trade against single leg(s)
    240,  # TLET -- Stock Options auto-electronic trade
    241,  # TLCT -- Stock Options Cross
    242,  # TLFT -- Stock Options floor trade
    243,  # TESL -- Stock Options auto-electronic trade against single leg(s)
    244,  # TASL -- Stock Options Auction against single leg(s)
    245,  # TFSL -- Stock Options floor trade against single leg(s)
    246,  # CBMO -- Multi Leg Floor Trade of Proprietary Products (3+ legs)
    247,  # MCTP -- Multilateral Compression Trade of Proprietary Products
})

# Intermarket Sweep Order -- explicit SWEEP marker from OPRA. More reliable
# than counting exchanges (a sweep that lands on 2 exchanges is still a sweep
# under OPRA's definition).
ISO_CONDITION = 219  # ISOI -- Intermarket Sweep Order

# Single-leg auction/cross/floor -- explicit BLOCK markers.
SINGLE_LEG_CONDITIONS = frozenset({
    227,  # SLAN -- Single Leg Auction Non ISO
    228,  # SLAI -- Single Leg Auction ISO
    229,  # SLCN -- Single Leg Cross Non ISO
    230,  # SLCI -- Single Leg Cross ISO
    231,  # SLFT -- Single Leg Floor Trade
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
      old bucket as an event and starts a fresh bucket -- this is the key
      streaming semantic
    - Type: SWEEP if 3+ distinct exchanges, else BLOCK
    - Side: '' for V1 (no NBBO available yet)

    Validated against BBS June 22 MSFT $450C 154-contract event: 5 prints
    across 4 exchanges spanning 76ms all at $16.00 -> one BBS SWEEP event.

    Filters:
    - min_premium (default $10K, per user spec)
    - min_volume  (default 50, derived from BBS June 22 distribution: p1=85
      contracts, so 50 is just below their floor -- tighten later if noisy)
    """

    # 2026-07-03: widened from 100ms to 500ms. Empirical: cross-exchange sweeps
    # on illiquid strikes routinely span 200-700ms as smart routers walk price
    # levels. At 100ms we were splitting single sweeps into multiple BLOCK
    # events -- see SPCX $165 12/17/27 CALL 10:36-10:44 trace where a
    # 494-vol 4-exchange sweep with ISO marker at t+363ms was classified as
    # BLOCK because the ISO tick fell in the next window.
    WINDOW_MS = 500
    WINDOW_NS = WINDOW_MS * 1_000_000
    PRICE_EPS = 0.0001

    def __init__(self, min_premium: float = 10_000, min_volume: int = 50,
                 high_premium_escape: float = None):
        self.min_premium = min_premium
        self.min_volume = min_volume
        # High-premium escape (2026-07-07, audit F3): the volume floor and the
        # premium floor were an AND, so an expensive low-lot institutional print
        # — small in CONTRACT count but large in DOLLARS (e.g. a $120K 20-lot
        # index option) — was dropped entirely and never entered flow.db. A
        # print whose premium clears this bar is kept even when it is below the
        # volume floor. Absolute premium floor (min_premium) still applies to
        # everything, so this only ADDS genuinely-large prints, never noise.
        # Env-tunable so it can be adjusted without a code change.
        if high_premium_escape is None:
            high_premium_escape = float(
                os.environ.get("MASSIVE_HIGH_PREMIUM_ESCAPE", "25000"))
        self.high_premium_escape = high_premium_escape
        # Active bucket per ticker -- newest still-growing burst.
        # Fix 3 (2026-07-03): keyed by ticker only (was ticker+price).
        self._pending: dict[str, list[RawTrade]] = {}
        # Completed events queued for drain()
        self._ready: list[AggEvent] = []
        self._stats = {
            'added': 0, 'emitted': 0, 'dropped_unparseable': 0,
            'dropped_below_premium': 0, 'dropped_below_volume': 0,
            'kept_high_premium_low_volume': 0,
        }

    # 2026-07-03 (Fix 3): bucket key changed from (ticker, price) to just ticker.
    # Previously, a sweep that walked prices (e.g., TER $290 CALL 7/17 hitting
    # $81.80 -> $82.80 in 700ms) got split into 3 sub-$1M events by price
    # bucket. BBS and Bullflow both aggregate the whole walk as one event
    # with weighted-average price (matched vol 244 @ $82.157 = $2M).
    #
    # The 500ms window still separates temporally-unrelated trades. Weighted-
    # price computation already exists in _aggregate. Risk of merging genuinely
    # unrelated sub-500ms activity on the same contract is small in practice --
    # options tick rates on illiquid strikes rarely have overlapping
    # independent activity within 500ms.
    def add_trade(self, trade: RawTrade) -> None:
        if trade.size <= 0 or trade.price <= 0:
            return
        # Phase 2e: drop cancelled prints. Their condition code says they
        # were retracted -- including them in aggregation would attribute
        # premium/volume to trades that never actually happened.
        if trade.conditions in CANCEL_CONDITIONS:
            self._stats['dropped_cancelled'] = self._stats.get('dropped_cancelled', 0) + 1
            return
        self._stats['added'] += 1
        key = trade.ticker
        bucket = self._pending.get(key)
        if bucket is not None:
            gap = trade.ts_ns - bucket[-1].ts_ns
            if gap > self.WINDOW_NS:
                # Gap too large -- close the old burst, start a new one
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

        # Compute premium BEFORE the volume gate (audit F3): premium is what
        # decides whether an expensive low-lot print escapes the volume floor.
        weighted_price = sum(t.price * t.size for t in trades) / total_size
        premium = sum(t.price * t.size for t in trades) * 100.0

        # Absolute premium floor — applies to everything, kills dollar-noise.
        if premium < self.min_premium:
            self._stats['dropped_below_premium'] += 1
            return None

        # Volume floor, WITH a high-premium escape: a print below the volume
        # floor is kept only if its premium is genuinely large (>= escape).
        # This recovers institutional low-lot / high-dollar prints (e.g. a
        # $120K 20-lot index option) that the old volume-first AND dropped.
        if total_size < self.min_volume:
            if premium < self.high_premium_escape:
                self._stats['dropped_below_volume'] += 1
                return None
            self._stats['kept_high_premium_low_volume'] += 1

        parsed = parse_occ(trades[0].ticker)
        if parsed is None:
            self._stats['dropped_unparseable'] += 1
            return None

        exchanges = {t.exchange for t in trades}

        # Phase 2e: classify type from OPRA condition codes (the authoritative
        # source). Falls back to the n_exchanges heuristic only when no
        # informative condition code is present (rare -- usually means the
        # codes were stripped or are unrecognized).
        #
        # Priority order:
        #   1. Any ML/combo code in the burst -> 'ML/' (multi-leg)
        #   2. ISOI (219) -> 'SWEEP' (Intermarket Sweep Order)
        #   3. Any single-leg auction/cross/floor code -> 'BLOCK'
        #   4. Fallback: n_exchanges >= 2 -> 'SWEEP', else 'BLOCK'
        #
        # 2026-07-03: fallback threshold lowered from 3 to 2 exchanges.
        # Empirical: BBS classifies 2-exchange near-simultaneous prints as
        # SWEEP when combined size is meaningful. Prior 3+ threshold missed
        # cases like SPCX 10:36:22 (2 exchanges, 480 vol) that BBS surfaced
        # as $2.4M SWEEP. Bumped ML/SINGLE_LEG explicit codes still win over
        # this fallback, so genuine blocks marked with 227/229 stay BLOCK.
        conditions_seen = {t.conditions for t in trades}
        if conditions_seen & MULTI_LEG_CONDITIONS:
            type_ = 'ML/'
        elif ISO_CONDITION in conditions_seen:
            type_ = 'SWEEP'
        elif conditions_seen & SINGLE_LEG_CONDITIONS:
            type_ = 'BLOCK'
        else:
            type_ = 'SWEEP' if len(exchanges) >= 2 else 'BLOCK'

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


# -- BBS row formatting ----------------------------------------------

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


def compute_color(premium: float, type_: str, *, volume: int = 0, oi: int = 0) -> str:
    """
    BBS-style Color label for an aggregated event.

    Per BBS official guide:
    - WHITE:   Open Interest has NOT been exceeded (volume <= OI)
    - YELLOW:  OI exceeded in a single trade - block/sweep with vol > OI
    - MAGENTA: OI exceeded significantly (volume >> OI - heavy positioning)

    Colors are about OI exceedance - new positioning vs trading existing
    contracts - NOT about premium size. A $30K trade opening fresh OI on an
    illiquid strike is more directionally meaningful than a $1M trade on a
    heavily-held contract just churning between holders.

    When OI is unknown (oi=0), we can't compute exceedance, so default WHITE.
    Volume/OI >= 1.5 ratio is the MAGENTA threshold - significant exceedance
    that suggests aggressive opening positioning. Tuned to roughly match BBS's
    color distribution against the June 22 export (52% confirmed = MAGENTA+YELLOW).
    """
    # No OI data -> can't compute, default WHITE (consistent with how BBS
    # treats contracts without OI data -- never confirmed).
    if oi <= 0 or volume <= 0:
        return 'WHITE'

    if volume >= int(1.5 * oi):
        return 'MAGENTA'
    if volume > oi:
        return 'YELLOW'
    return 'WHITE'


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
    cumulative_volume: Optional[int] = None,
) -> dict:
    """
    Convert an AggEvent to a BBS CSV row dict.

    Enrichment params (spot, iv, oi, mktcap, sector, er_flag, uoa_flag) come
    from your existing helpers at deploy time. Defaults are V1 stubs that
    insert cleanly but show 0/blank in the UI for those fields.

    cumulative_volume (Phase 2d): if provided, this is the total day-cumulative
    volume on this contract (sum of THIS event + all prior events today).
    Used for BBS-style Color computation (vol > OI is judged on the day's
    running total, not single-event volume). If None, falls back to single-
    event volume -- which produces fewer YELLOW/MAGENTA than BBS does.
    """
    ts_et = datetime.fromtimestamp(evt.first_ts_ns / 1e9, tz=UTC).astimezone(ET)
    dte = (evt.expiry - ts_et.date()).days

    # Volume used for Color and Uoa: cumulative if provided, else single-event
    vol_for_color = cumulative_volume if cumulative_volume is not None else evt.total_size

    # Uoa derived from volume/OI ratio if not provided and OI is known
    if uoa_flag is None:
        if oi > 0 and vol_for_color > oi:
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
        'Color': compute_color(evt.premium, evt.type_, volume=vol_for_color, oi=oi),
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


# -- Batch processor (for Flat Files validation + backfill) ------------

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
