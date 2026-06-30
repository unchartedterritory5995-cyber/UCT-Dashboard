"""
massive_ws_worker.py -- Live Massive WebSocket consumer.

Connects to the Massive Options trades stream, aggregates ticks into
SWEEP/BLOCK events, and writes them to FlowDB as if they came from a BBS
CSV upload. OptionsFlow.jsx picks them up automatically via /api/flow/data.

Design:
- Single dedicated thread running its own asyncio loop. Insulates the
  FastAPI event loop from any WS hiccups.
- Guard with acquire_scheduler_lock() -- only ONE uvicorn worker runs the
  consumer, mirroring the existing scheduler pattern in main.py L1680.
- Reconnect with exponential backoff. On reconnect, in-flight aggregator
  state is preserved (next message resumes naturally).
- Periodic flush every FLUSH_INTERVAL_SEC: drain completed events,
  convert to BBS CSV, call FlowDB.insert_csv() -- same path as the
  existing CSV upload, so dedup, schema, and read path all work unchanged.
- DRY_RUN env var lets the operator deploy and watch logs WITHOUT writing
  to DB. Flip MASSIVE_WS_DRY_RUN=0 once the logs look right.

Mirrors the patterns established in main.py:
- threading.Thread(daemon=True, name="...") for background work
- print() with [tag] prefix for operational logging (visible in Railway logs)
- env-var gates for enabling/disabling

V1 limitations (documented; addressed in V2):
- Side classification stubbed as "" (no NBBO yet -- need to also subscribe
  to Q.* and maintain in-memory NBBO per contract)
- Spot/IV/OI/MktCap/Sector/ER stubbed (wire to existing helpers below)
- Per-asset-class connection limit on Massive's side means we only get
  ONE options WS -- can't run a parallel "shadow" consumer for testing.
  Use MASSIVE_WS_DRY_RUN=1 instead.
"""

import os
import json
import time
import asyncio
import threading
import logging
from datetime import datetime, date, timedelta
from io import StringIO
from typing import Optional

logger = logging.getLogger(__name__)


# -- Configuration (all via env vars) -------------------------------

MASSIVE_API_KEY = os.environ.get("MASSIVE_API_KEY", "").strip()

# Real-time URL for Advanced plan. The 15-min delayed URL is different
# (delayed.massive.com); we want real-time for live alerts.
#
# IMPORTANT: This is MASSIVE_OPTIONS_WS_URL, not MASSIVE_WS_URL -- bar_stream.py
# uses MASSIVE_WS_URL for the /stocks endpoint, so reusing the same name here
# would cause both modules to read the same value and both end up on whichever
# endpoint that var points to (with predictable max_connections errors when the
# second consumer collides with the first).
MASSIVE_OPTIONS_WS_URL = os.environ.get(
    "MASSIVE_OPTIONS_WS_URL",
    "wss://socket.massive.com/options",
).strip()

# Subscription pattern. T.* = all trades on all option contracts.
MASSIVE_WS_SUBSCRIBE = os.environ.get("MASSIVE_WS_SUBSCRIBE", "T.*").strip()

# Master kill switch. Set MASSIVE_WS_ENABLED=0 to disable without redeploying.
ENABLED = os.environ.get("MASSIVE_WS_ENABLED", "1").lower() in ("1", "true", "yes")

# Dry-run: parse and aggregate but do NOT write to FlowDB. Useful for the
# first 30-60 minutes after deploy to verify the pipeline works before
# committing rows to the live database.
DRY_RUN = os.environ.get("MASSIVE_WS_DRY_RUN", "0").lower() in ("1", "true", "yes")

# Filters (tunable; defaults match what we validated against the June 22
# BBS export at 80% coverage).
MIN_PREMIUM = float(os.environ.get("MASSIVE_MIN_PREMIUM", "10000"))
MIN_VOLUME = int(os.environ.get("MASSIVE_MIN_VOLUME", "50"))

# How often (seconds) to flush stale aggregator buckets and write to DB.
# 2s = events appear in OptionsFlow.jsx within 2-3 seconds of the trade.
FLUSH_INTERVAL_SEC = float(os.environ.get("MASSIVE_FLUSH_INTERVAL", "2.0"))


# -- Module-level state (read via get_status() for health endpoint) ---

_state = {
    "started_at": None,
    "running": False,
    "connected": False,
    "trades_received": 0,
    "events_emitted": 0,
    "events_written_stocks": 0,
    "events_written_indexes": 0,
    "last_trade_ts": None,
    "last_write_ts": None,
    "reconnect_count": 0,
    "last_error": None,
    "thread": None,
    # Enrichment diagnostics (Phase 2a debugging)
    "last_meta_lookup_size": 0,      # symbols passed to _load_ticker_metadata
    "last_meta_lookup_resolved": 0,  # symbols that returned non-empty meta
    "last_meta_sample": {},          # first few resolved entries for visibility
    "last_oi_lookup_size": 0,        # events passed to _load_oi_for_events
    "last_oi_lookup_resolved": 0,    # events that returned non-zero OI
    # Phase 2c: Side classification via Q.* NBBO
    "quotes_received": 0,            # total Q events processed
    "q_subscribed_count": 0,         # currently subscribed Q contracts
    "q_subscribes_sent": 0,          # cumulative Q.subscribe messages sent
    "q_unsubscribes_sent": 0,        # cumulative Q.unsubscribe messages sent
    "last_side_lookup_size": 0,      # events in last classification batch
    "last_side_lookup_classified": 0,  # events that got a non-empty Side
    "last_side_classified_nbbo": 0,  # Phase 2h: subset classified via NBBO
    "last_side_classified_tick": 0,  # Phase 2h: subset classified via tick test
    "last_side_no_signal": 0,        # Phase 2h: events with no NBBO+no tick history
    # Phase 2f: on-demand OI fetch via Schwab
    "oi_fetch_queue_size": 0,        # contracts pending on-demand fetch
    "oi_fetch_batches_sent": 0,      # cumulative Schwab batch calls
    "oi_fetch_contracts_resolved": 0, # contracts where Schwab returned OI > 0
    "oi_fetch_contracts_unresolved": 0, # contracts where Schwab returned no data
}


# Phase 2c: NBBO table and Q subscription pool (in-memory, per-session).
# Cleared on disconnect -- rebuilt over the first ~10 min of market activity
# after each reconnect. Lifetime is the WebSocket session.
_nbbo_table: dict = {}        # {contract_sym: (bid, ask, ts_ms)}
_q_subscribed: set = set()    # contract syms we're currently subscribed to Q for
_q_last_seen: dict = {}       # {contract_sym: ts_ns} - LRU tracking
_q_pending_subscribe: list = []   # queued contracts to subscribe (added by event loop)
_q_pending_unsubscribe: list = [] # queued contracts to unsubscribe (LRU evictions)

# Phase 2f: on-demand OI fetch queue. The flusher adds contracts that miss
# the 2-stage snapshot+flow lookup; a background task drains the queue and
# fetches from Schwab in batches. Results persist to contract_oi_snapshots
# so subsequent flushes pick them up via Stage 1.
_oi_fetch_queue: list = []    # list of (sym, cp_letter, strike, exp_mdy) tuples
_oi_fetch_seen: set = set()   # contracts we've already queued this session (dedup)

# 1000-contract hard cap per connection (Massive docs).
# We leave a 50-slot headroom so churn doesn't immediately hit the ceiling
# during subscribe-add cycles.
MAX_Q_SUBSCRIPTIONS = 950

# How fresh an NBBO needs to be (vs trade timestamp) to use for Side
# classification. Stale quotes give wrong sides -- particularly in trending
# regimes where the bid/ask shifts faster than the staleness window allows.
#
# Phase 1 audit (6/29): the prior 60s threshold was too lenient for the
# liquid contracts that dominate Alpha Gold tier (BE, MU, AMD, MRVL, etc.).
# NBBO on those updates many times per second, so 60s effectively meant
# "use any NBBO we have, no matter how stale" -- which produced 30% Side
# disagreement vs BBS+Bullflow on the BE bid-stack accumulation pattern.
#
# Tightened to 5s. Trades on a contract whose latest NBBO is >5s old will
# fall through to tick-test (or stay unclassified). This is the right
# tradeoff: lower classification rate, but the ones we classify are right.
NBBO_STALENESS_NS = 5_000_000_000  # 5s -- tightened from 60s in Phase 1 audit


def _classify_side(trade_price: float, nbbo: tuple) -> str:
    """
    Lee-Ready trade classification using NBBO.

    nbbo: (bid, ask, ts_ms) tuple, or None if no quote data.

    Returns BBS-format Side string:
        "AA": price strictly above ask (super aggressive buyer)
        "A":  price at ask (aggressive buyer)
        "B":  price at bid (aggressive seller)
        "BB": price strictly below bid (super aggressive seller)
        "":   price at mid (no clear aggressor) OR no NBBO available

    Tolerance: 0.5 cent for "at" classification, since aggregated burst
    avg prices may drift slightly from the NBBO quote due to multi-exchange
    variance and the time between the trade and the most recent quote.
    """
    if not nbbo:
        return ""
    bid, ask, _ts = nbbo
    if bid <= 0 or ask <= 0 or ask < bid:
        return ""
    tol = 0.005
    if trade_price > ask + tol:
        return "AA"
    if trade_price >= ask - tol:
        return "A"
    if trade_price < bid - tol:
        return "BB"
    if trade_price <= bid + tol:
        return "B"
    return ""  # mid-market


def _reconstruct_occ_symbol(root: str, expiry, cp: str, strike: float) -> str:
    """
    Build Massive's OCC option symbol format from AggEvent fields.

    Format: O:<ROOT><YY><MM><DD><C|P><STRIKE*1000 zero-padded to 8>
    Example: NVDA + 2026-06-19 + CALL + 200.0 -> 'O:NVDA260619C00200000'
    """
    cp_letter = 'C' if cp == 'CALL' else 'P'
    strike_int = int(round(strike * 1000))
    yy = expiry.year % 100
    return f"O:{root}{yy:02d}{expiry.month:02d}{expiry.day:02d}{cp_letter}{strike_int:08d}"


def get_status() -> dict:
    """Snapshot of worker state. Wire to a health endpoint if useful."""
    s = dict(_state)
    s.pop("thread", None)
    if s["started_at"]:
        s["uptime_sec"] = round(time.time() - s["started_at"], 1)
    s["dry_run"] = DRY_RUN
    s["enabled"] = ENABLED
    s["min_premium"] = MIN_PREMIUM
    s["min_volume"] = MIN_VOLUME
    return s


# -- Event handling -------------------------------------------------

def _load_oi_for_events(events: list) -> dict:
    """
    Look up OI for each event using a two-stage lookup:

    Stage 1: contract_oi_snapshots for today's snap_date (most accurate,
             populated by the 5:30 AM ET cron).

    Stage 2 (fallback): latest non-zero OI from the flow table for the
             same contract. This catches contracts that aren't in the
             snapshot pool (snapshot job filters to contracts with >=3
             trades in past 30d, so less-active contracts are missing).
             The flow table has OI for any contract ever uploaded via BBS,
             which covers a much wider universe.

    Returns: {event_index: oi}. Events missing from both stages stay
    OI=0 downstream (color stays WHITE).
    """
    if not events:
        return {}
    import sqlite3
    from datetime import datetime

    # Build (contract_key, event_idx) tuples
    keys_and_idx = []
    for i, e in enumerate(events):
        cp_letter = 'C' if e.cp == 'CALL' else 'P'
        exp_str = f"{e.expiry.month}/{e.expiry.day}/{e.expiry.year}"
        key = f"{e.root}|{cp_letter}|{float(e.strike)}|{exp_str}"
        keys_and_idx.append((key, i, e))

    if not keys_and_idx:
        return {}

    # All events in one flush share the same ET trade date
    first_ts_et = datetime.fromtimestamp(events[0].first_ts_ns / 1e9, tz=UTC).astimezone(ET)
    snap_date_iso = first_ts_et.date().isoformat()

    try:
        from api.flow_db import FlowDB
        db_path = FlowDB().db_path
    except Exception as e:
        logger.warning("[massive-ws] OI lookup: FlowDB unavailable: %s", e)
        return {}

    out = {}
    try:
        with sqlite3.connect(db_path, timeout=10) as conn:
            # Stage 1: contract_oi_snapshots
            keys = [k for k, _, _ in keys_and_idx]
            placeholders = ",".join("?" for _ in keys)
            sql1 = f"""
                SELECT contract_key, oi
                FROM contract_oi_snapshots
                WHERE snap_date = ?
                  AND contract_key IN ({placeholders})
            """
            idx_by_key = {k: i for k, i, _ in keys_and_idx}
            for key, oi in conn.execute(sql1, (snap_date_iso, *keys)):
                idx = idx_by_key.get(key)
                if idx is not None and oi is not None and oi > 0:
                    out[idx] = int(oi)

            # Stage 2: flow table fallback for events that missed
            unresolved = [(k, i, e) for k, i, e in keys_and_idx if i not in out]
            if unresolved:
                # Build per-contract query against flow. Each contract is
                # (Symbol, CallPut, Strike, ExpirationDate). We use the MAX(id)
                # row with non-zero OI - matches the pattern in
                # flow_db.get_mktcap_batch.
                #
                # We can't easily IN-query on a composite key without temp
                # tables, so we do one query per unresolved event. SQLite
                # handles this fast (<1ms per query) and the unresolved
                # set is usually small (<50).
                sql2 = """
                    SELECT OI FROM flow
                    WHERE Symbol = ? AND CallPut = ? AND Strike = ?
                      AND ExpirationDate = ?
                      AND OI IS NOT NULL AND OI != '' AND OI != '0'
                    ORDER BY id DESC LIMIT 1
                """
                for key, i, e in unresolved:
                    # CallPut in flow table is stored as 'CALL'/'PUT' (from BBS),
                    # while contract_key uses 'C'/'P'. Use the full word here.
                    # Strike in flow is text - match the format BBS uses
                    # (typically "715" not "715.0" - we need to try both).
                    exp_str = f"{e.expiry.month}/{e.expiry.day}/{e.expiry.year}"
                    strike_int = int(e.strike) if e.strike == int(e.strike) else None
                    strike_candidates = []
                    if strike_int is not None:
                        strike_candidates.append(str(strike_int))     # "715"
                    strike_candidates.append(str(float(e.strike)))    # "715.0"
                    strike_candidates.append(f"{e.strike:g}")         # "715"
                    # Dedup while preserving order
                    seen = set()
                    strike_candidates = [s for s in strike_candidates
                                         if not (s in seen or seen.add(s))]
                    for strike_str in strike_candidates:
                        cur = conn.execute(sql2, (
                            e.root, e.cp, strike_str, exp_str,
                        ))
                        row = cur.fetchone()
                        if row:
                            try:
                                oi_val = int(float(row[0]))
                                if oi_val > 0:
                                    out[i] = oi_val
                                    break
                            except (ValueError, TypeError):
                                continue
    except Exception as e:
        logger.warning("[massive-ws] OI batch lookup failed: %s", e)

    # Phase 2f: Stage 3 -- enqueue unresolved contracts for on-demand Schwab
    # fetch. The background oi_fetch_manager task drains the queue every 20s,
    # calls Schwab in batch, and persists to contract_oi_snapshots. The NEXT
    # batch of events for these contracts will hit Stage 1 (snapshot cache)
    # and get the OI for free.
    #
    # Tradeoff: first event on a previously-unknown contract gets OI=0 here.
    # Subsequent events (which are common for active contracts) benefit.
    # For purely one-off contracts, we still miss -- but those are rare in
    # institutional flow.
    for key, i, e in keys_and_idx:
        if i in out:
            continue
        sym = e.root
        if sym and sym[-1].isdigit():
            # Adjusted/when-issued -- Schwab will 400, don't bother
            continue
        cp_letter = 'C' if e.cp == 'CALL' else 'P'
        exp_mdy = f"{e.expiry.month}/{e.expiry.day}/{e.expiry.year}"
        contract_tup = (sym, cp_letter, float(e.strike), exp_mdy)
        # Track this contract so we don't re-queue it within the same session
        if contract_tup not in _oi_fetch_seen:
            _oi_fetch_queue.append(contract_tup)
            _oi_fetch_seen.add(contract_tup)
    _state["oi_fetch_queue_size"] = len(_oi_fetch_queue)

    return out


# Need to import the ET / UTC zones used above. The processor exports them
# but a local import keeps this module self-contained for the OI helper.
from zoneinfo import ZoneInfo
ET = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")


def _events_to_csv(events: list, source: str, ticker_meta: dict = None,
                   oi_map: dict = None, cum_vol_map: dict = None,
                   spot_map: dict = None, er_map: dict = None) -> str:
    """Convert AggEvents -> BBS-format CSV string for FlowDB.insert_csv.

    ticker_meta: optional {symbol: {"mktcap": int, "sector": str}} dict for
    per-row enrichment. Built once per flush by _load_ticker_metadata.

    cum_vol_map: Phase 2d optional {event_index: cumulative_day_volume} for
    BBS-style Color computation. When provided, Color uses cumulative day
    volume vs OI (matching BBS); otherwise falls back to single-event volume.

    spot_map: Phase 2b optional {symbol: spot_price} for per-event Spot
    column enrichment. Symbols missing from this dict fall back to spot=0.

    er_map: Phase 2g optional {symbol: 'T'|'F'} earnings flag for upcoming
    earnings within 14 days. Symbols missing default to 'F'.
    """
    from api.massive_processor import event_to_bbs_row
    from api.flow_db import COLUMNS  # Reuse the exact column order

    ticker_meta = ticker_meta or {}
    oi_map = oi_map or {}
    cum_vol_map = cum_vol_map or {}
    spot_map = spot_map or {}
    er_map = er_map or {}
    buf = StringIO()
    buf.write(",".join(COLUMNS) + "\n")
    for i, evt in enumerate(events):
        meta = ticker_meta.get(evt.root, {})
        oi = oi_map.get(i, 0)
        cum_vol = cum_vol_map.get(i)
        spot = spot_map.get(evt.root, 0.0)
        er_flag = er_map.get(evt.root, 'F')
        row = event_to_bbs_row(
            evt, source=source,
            mktcap=meta.get("mktcap", 0),
            sector=meta.get("sector", ""),
            oi=oi,
            cumulative_volume=cum_vol,
            spot=spot,
            er_flag=er_flag,
        )
        line = ",".join(str(row.get(c, "")) for c in COLUMNS)
        buf.write(line + "\n")
    return buf.getvalue()


def _load_ticker_metadata(symbols: list) -> dict:
    """
    Look up MktCap + Sector for each symbol from the most recent non-blank
    FlowDB row that has those values.

    Reuses the same pattern as flow_db.get_mktcap_batch -- any ticker that's
    ever been in FlowDB (from a BBS upload, prior Bullflow, etc.) has its
    metadata cached and we can read it for free without hitting Schwab.

    Returns: {"AAPL": {"mktcap": 3100000000000, "sector": "Technology"}, ...}
    Symbols never seen before are simply omitted.
    """
    if not symbols:
        return {}
    import sqlite3
    try:
        from api.flow_db import FlowDB
        db = FlowDB()
    except Exception as e:
        logger.warning("[massive-ws] _load_ticker_metadata: FlowDB unavailable: %s", e)
        return {}

    clean = sorted({s.strip().upper() for s in symbols if s and s.strip()})
    if not clean:
        return {}

    out: dict = {}
    try:
        with sqlite3.connect(db.db_path, timeout=10) as conn:
            # MktCap: most recent non-zero per symbol
            placeholders = ",".join("?" for _ in clean)
            mc_sql = f"""
                SELECT f.Symbol, f.MktCap
                FROM flow f
                INNER JOIN (
                    SELECT Symbol, MAX(id) AS max_id
                    FROM flow
                    WHERE Symbol IN ({placeholders})
                      AND MktCap IS NOT NULL AND MktCap != '' AND MktCap != '0'
                    GROUP BY Symbol
                ) latest ON f.id = latest.max_id
            """
            for sym, mc_raw in conn.execute(mc_sql, clean):
                if not sym:
                    continue
                sym = sym.strip().upper()
                try:
                    mc = int(float((mc_raw or "0").strip()))
                except (ValueError, TypeError):
                    mc = 0
                if mc > 0:
                    out.setdefault(sym, {})["mktcap"] = mc

            # Sector: most recent non-blank per symbol
            sec_sql = f"""
                SELECT f.Symbol, f.Sector
                FROM flow f
                INNER JOIN (
                    SELECT Symbol, MAX(id) AS max_id
                    FROM flow
                    WHERE Symbol IN ({placeholders})
                      AND Sector IS NOT NULL AND Sector != ''
                    GROUP BY Symbol
                ) latest ON f.id = latest.max_id
            """
            for sym, sec_raw in conn.execute(sec_sql, clean):
                if not sym:
                    continue
                sym = sym.strip().upper()
                sec = (sec_raw or "").strip()
                if sec:
                    out.setdefault(sym, {})["sector"] = sec
    except Exception as e:
        logger.warning("[massive-ws] _load_ticker_metadata SQL failed: %s", e)

    return out


def _classify_events_side(events: list) -> None:
    """Phase 2c + 2h: set evt.side on each AggEvent.

    Mutates the events in place. Two-tier classification:

    TIER 1 -- NBBO match (Lee-Ready, requires fresh quote):
      - Compare avg_price to current NBBO bid/ask
      - Returns A/AA for ask-side, B/BB for bid-side
      - Only works when NBBO is fresh (within NBBO_STALENESS_NS)
      - Most accurate when available

    TIER 2 -- Tick test fallback (Phase 2h, no NBBO needed):
      - Compare avg_price to last observed price on this contract
      - Higher = uptick = "A" (aggressive buyer)
      - Lower = downtick = "B" (aggressive seller)
      - Zero-tick uses direction of last differing price
      - Slightly less accurate than NBBO but covers ~95% of contracts
      - Offline validated: 92% classification rate vs 30-40% NBBO-only

    Combined: BBS-equivalent ~85-95% Side classification rate.
    """
    classified = 0
    classified_nbbo = 0  # subset classified via NBBO (most accurate)
    classified_tick = 0  # subset classified via tick test (fallback)
    in_pool = 0          # events whose contract is in Q subscription pool
    have_nbbo = 0        # events with any NBBO entry (subscribed or not)
    fresh_nbbo = 0       # events with NBBO within staleness window
    mid_market = 0       # events where NBBO existed but trade was mid (correct null Side)
    no_signal = 0        # events with no NBBO AND no prior tick data
    sample_misses = []   # up to 5 sample contracts with no NBBO -- helps debug

    # Phase 2h: sort events chronologically so tick test sees correct
    # "previous" prices. Aggregator emission order isn't guaranteed to be
    # strict chronological order (buckets complete out-of-order based on
    # gap detection). Sort here so tick cache builds in time order.
    events = sorted(events, key=lambda e: e.first_ts_ns)

    for evt in events:
        sym = _reconstruct_occ_symbol(evt.root, evt.expiry, evt.cp, evt.strike)
        if sym in _q_subscribed:
            in_pool += 1

        # ====== TIER 1: NBBO classification (preferred) ======
        # Phase 2 (6/29 audit): look up the NBBO in force AT the trade's
        # timestamp via _nbbo_at(), not the current NBBO from _nbbo_table.
        # The old approach compared trades to whatever NBBO was latest at
        # batch-flush time, which for active contracts could be seconds
        # newer than the trade -- producing systematic misclassification
        # on bid-stack accumulation patterns where the bid was rising
        # between the trade and the next-observed quote update.
        nbbo = _nbbo_at(sym, evt.first_ts_ns)
        nbbo_classified = False
        if nbbo:
            have_nbbo += 1
            bid, ask, nbbo_ts_ns = nbbo
            age_ns = evt.first_ts_ns - nbbo_ts_ns  # always >= 0 (_nbbo_at filters)
            if age_ns <= NBBO_STALENESS_NS:
                fresh_nbbo += 1
                # _classify_side expects (bid, ask, ts_ms) format
                side = _classify_side(evt.avg_price, (bid, ask, nbbo_ts_ns // 1_000_000))
                if side:
                    evt.side = side
                    classified += 1
                    classified_nbbo += 1
                    nbbo_classified = True
                else:
                    mid_market += 1
                    # MID-MARKET REVERT (Phase 1 audit, 6/29):
                    # Earlier we set nbbo_classified=False here to let tick
                    # test classify mid-market trades. That recovered ~40%
                    # more classifications but at high cost: mid-market means
                    # NEUTRAL (no aggressor) by definition. Routing those
                    # trades to tick test manufactures direction from price
                    # momentum -- in a trending tape, every mid trade became
                    # A or AA, creating systematic uptrend bias. Audit vs
                    # BBS+Bullflow confirmed this was the primary source of
                    # bid-stack misclassifications on BE/MU/MRVL today.
                    #
                    # Restored: mid-market stays as no-side (empty string).
                    # Cost: lower classification rate. Benefit: no manufactured
                    # direction from neutral trades.
                    nbbo_classified = True

        # ====== TIER 2: Tick test fallback ======
        # Only runs if NBBO didn't classify (missing, stale, or never set).
        # Mid-market trades fall through to tick test (mid-market fix).
        #
        # Phase 2i: Use RAW T print history instead of event-to-event prices.
        # We bisect into _RAW_T_HISTORY to find the last raw print BEFORE
        # this event's first timestamp -- that's the "previous tick" for
        # Lee-Ready classification. Validated 86.7% -> 96.0% accuracy improvement.
        if not nbbo_classified:
            hist = _RAW_T_HISTORY.get(sym)
            if hist:
                # Find latest price before evt.first_ts_ns (event start)
                last_price = None
                prev_diff_price = None
                # Walk backward through deque (newest to oldest)
                for ts, px in reversed(hist):
                    if ts >= evt.first_ts_ns:
                        continue  # this print is AT or AFTER event - skip
                    if last_price is None:
                        last_price = px
                    elif abs(px - last_price) > 0.001:
                        prev_diff_price = px
                        break
                if last_price is not None and last_price > 0:
                    diff_pct = (evt.avg_price - last_price) / last_price * 100
                    # Phase 1 audit (6/29): removed AA/BB tier from tick test.
                    # Tick test only knows "price moved up or down from last
                    # print" -- it CANNOT know whether the trade was above
                    # the contemporaneous ask (AA) or below the bid (BB).
                    # Those subdivisions require fresh NBBO comparison.
                    # Returning AA/BB from a 5% tick move manufactures false
                    # confidence -- a 5% move in a stacked-bid uptrend is
                    # not "above ask," it's just "next print up the ladder."
                    #
                    # Tick test now produces A/B only. NBBO path retains
                    # the full AA/A/B/BB vocabulary.
                    if diff_pct > 0.5:
                        evt.side = "A"; classified += 1; classified_tick += 1
                    elif diff_pct < -0.5:
                        evt.side = "B"; classified += 1; classified_tick += 1
                    elif prev_diff_price is not None and prev_diff_price > 0:
                        # zero-tick: use direction of last differing price
                        if last_price > prev_diff_price:
                            evt.side = "A"; classified += 1; classified_tick += 1
                        elif last_price < prev_diff_price:
                            evt.side = "B"; classified += 1; classified_tick += 1
                        else:
                            no_signal += 1
                    else:
                        no_signal += 1
                else:
                    no_signal += 1
                    if not nbbo and len(sample_misses) < 5:
                        sample_misses.append(sym)
            else:
                no_signal += 1
                if not nbbo and len(sample_misses) < 5:
                    sample_misses.append(sym)

        # Phase 2i: tick cache (_TICK_TEST_CACHE) is no longer updated here
        # because we use _RAW_T_HISTORY (raw print history) for tick test.
        # The old event-to-event cache is left in place but unused -- can
        # be removed in a future cleanup. _RAW_T_HISTORY is populated by
        # the T event handler in real time.

    _state["last_side_lookup_size"] = len(events)
    _state["last_side_lookup_classified"] = classified
    _state["last_side_classified_nbbo"] = classified_nbbo
    _state["last_side_classified_tick"] = classified_tick
    _state["last_side_in_pool"] = in_pool
    _state["last_side_have_nbbo"] = have_nbbo
    _state["last_side_fresh_nbbo"] = fresh_nbbo
    _state["last_side_mid_market"] = mid_market
    _state["last_side_no_signal"] = no_signal
    _state["last_side_sample_misses"] = sample_misses


def _queue_q_subscriptions_for_events(events: list) -> None:
    """Phase 2c: enqueue Q subscriptions for contracts that emitted events
    but aren't yet in our subscription pool.

    Eviction policy: LRU based on _q_last_seen. When the pool is full
    (MAX_Q_SUBSCRIPTIONS), the least-recently-traded contract gets
    unsubscribed to make room.

    The actual subscribe/unsubscribe WS messages are sent by the
    q_subscription_manager task on its 5-second cadence -- we just queue
    here so we don't block the flusher on network I/O.
    """
    for evt in events:
        sym = _reconstruct_occ_symbol(evt.root, evt.expiry, evt.cp, evt.strike)
        # Already subscribed (or pending) -- nothing to do
        if sym in _q_subscribed or sym in _q_pending_subscribe:
            continue
        # Room in the pool -- queue subscribe directly
        if len(_q_subscribed) + len(_q_pending_subscribe) < MAX_Q_SUBSCRIPTIONS:
            _q_pending_subscribe.append(sym)
            continue
        # Pool full -- evict LRU contract that isn't itself pending eviction
        candidates = [(s, _q_last_seen.get(s, 0))
                      for s in _q_subscribed
                      if s not in _q_pending_unsubscribe]
        if not candidates:
            # Everything is already pending eviction -- skip and try next flush
            continue
        candidates.sort(key=lambda kv: kv[1])
        lru_sym = candidates[0][0]
        _q_pending_unsubscribe.append(lru_sym)
        _q_pending_subscribe.append(sym)


def _build_warm_start_contracts(limit: int = 950) -> list:
    """Phase 2c.1: warm-start the Q subscription pool.

    Queries FlowDB for the most-active option contracts in the past N days
    and returns them as OCC-formatted symbols ready for Q.* subscribe.

    "Most active" = highest total volume across recent flow rows. This
    favors high-conviction contracts (SPY/QQQ/NVDA weeklies, popular
    earnings plays) over one-off prints on illiquid strikes.

    Returns: list of OCC symbols like ['O:SPY260627P00450000', ...]
    Max length = limit (default 950, leaves 50-slot headroom under cap).

    Empty list if FlowDB is unreachable or has no usable data.
    """
    import sqlite3
    from datetime import datetime, timedelta

    LOOKBACK_DAYS = 7  # rolling 7-day window of "recently active"
    out = []

    try:
        from api.flow_db import FlowDB
        db_path = FlowDB().db_path
    except Exception as e:
        logger.warning("[massive-ws] warm-start: FlowDB unavailable: %s", e)
        return out

    # Build list of recent date strings in M/D/YYYY format (matches BBS schema).
    today = datetime.utcnow().date()
    date_strs = []
    for i in range(LOOKBACK_DAYS):
        d = today - timedelta(days=i)
        date_strs.append(f"{d.month}/{d.day}/{d.year}")
    if not date_strs:
        return out

    placeholders = ",".join("?" for _ in date_strs)
    sql = f"""
        SELECT Symbol, CallPut, Strike, ExpirationDate, SUM(CAST(Volume AS INTEGER)) AS total_vol
        FROM flow
        WHERE CreatedDate IN ({placeholders})
          AND Symbol IS NOT NULL AND Symbol != ''
          AND CallPut IN ('CALL', 'PUT')
          AND Strike IS NOT NULL AND Strike != ''
          AND ExpirationDate IS NOT NULL AND ExpirationDate != ''
          AND Volume IS NOT NULL AND Volume != '' AND Volume != '0'
        GROUP BY Symbol, CallPut, Strike, ExpirationDate
        ORDER BY total_vol DESC
        LIMIT ?
    """

    try:
        with sqlite3.connect(db_path, timeout=10) as conn:
            cur = conn.execute(sql, (*date_strs, limit * 2))
            rows = cur.fetchall()
    except Exception as e:
        logger.warning("[massive-ws] warm-start: query failed: %s", e)
        return out

    # Skip contracts whose expiry is already past (no point subscribing)
    today_date = datetime.utcnow().date()
    skipped_expired = 0
    skipped_malformed = 0
    for sym, cp, strike_str, exp_str, _vol in rows:
        # Skip adjusted/when-issued symbols (Massive rejects these too)
        if sym and sym[-1].isdigit():
            skipped_malformed += 1
            continue
        try:
            strike = float(strike_str)
        except (ValueError, TypeError):
            skipped_malformed += 1
            continue
        # Parse expiry (M/D/YYYY)
        try:
            parts = exp_str.split("/")
            if len(parts) != 3:
                skipped_malformed += 1
                continue
            exp_date = datetime(int(parts[2]), int(parts[0]), int(parts[1])).date()
        except (ValueError, TypeError, IndexError):
            skipped_malformed += 1
            continue
        if exp_date < today_date:
            skipped_expired += 1
            continue
        # Build OCC symbol -- this is the exact format Massive expects
        try:
            occ = _reconstruct_occ_symbol(sym, exp_date, cp, strike)
        except Exception:
            skipped_malformed += 1
            continue
        out.append(occ)
        if len(out) >= limit:
            break

    logger.info(
        "[massive-ws] warm-start: %d contracts from FlowDB "
        "(skipped %d expired, %d malformed)",
        len(out), skipped_expired, skipped_malformed
    )
    return out


# Phase 2b: Spot price cache with TTL. Populated lazily by a background
# fetcher task that drains _spot_fetch_queue every 10 seconds. Same pattern
# as Phase 2f on-demand OI fetch -- the flusher queues symbols, background
# task hits Schwab, results land in cache; next flush picks them up.
#
# This means the FIRST event on a previously-unknown symbol gets spot=0,
# but subsequent events (for active symbols, common case) get real spot.
_SPOT_CACHE: dict = {}        # {symbol: (price, fetched_at_ts)}
_SPOT_TTL_SEC = 60            # quote freshness window
_spot_fetch_queue: list = []  # symbols pending fetch (deduped)
_spot_fetch_seen: set = set() # symbols already queued this drain cycle


# Phase 2h: Last-trade-price cache for Lee-Ready tick test fallback.
# When NBBO is missing/stale (common for illiquid contracts and morning
# trades), we classify Side by comparing the current event's avg_price to
# the previous trade price on the same contract:
#   - current > last -> uptick -> aggressive buyer -> "A"
#   - current < last -> downtick -> aggressive seller -> "B"
#   - equal -> zero-tick, use direction of last differing price
#
# Offline validation against 6/23 raw data showed 92% Side classification
# rate using this method -- matches BBS's effective rate. NBBO-only was
# stuck at 30-40% in production for the same reason.
#
# Schema: contract_sym -> (last_price, prev_differing_price)
#   - last_price: most recent observed price on this contract
#   - prev_differing_price: most recent price that DIFFERS from last_price
#     (used to break zero-tick ties)
_TICK_TEST_CACHE: dict = {}


# Phase 2i: Raw T-print price history per contract for proper Lee-Ready
# tick test. The event-to-event tick test in Phase 2h compares avg_prices
# between events, which loses sub-event granularity. By keeping a bounded
# deque of recent raw T prints with timestamps, we can use bisect to find
# the LAST trade price BEFORE an event's first timestamp -- giving us a
# proper "previous tick" for Lee-Ready classification.
#
# Validated offline 6/25: LRCX PUT $360 trades went from 1/6 correct
# (event-to-event) to 5/6 correct (raw T prints) classification. Overall
# Side classification: 86.7% -> 96.0%. Watchlist now correctly identifies
# LRCX, MU, SNDK as top bear conviction (matching BBS), where before they
# were missing or classified opposite-direction.
#
# Schema: contract_sym -> deque[(ts_ns, price)] limited to last N prints.
# Memory: ~5000 active contracts * 50 prints * 24 bytes = ~6 MB.
from collections import deque
_RAW_T_HISTORY: dict = {}  # sym -> deque[(ts_ns, price)]
_RAW_T_MAX = 50            # keep last 50 prints per contract


# Phase 2 (6/29 audit): per-contract NBBO history with time-aligned lookup.
#
# Background: prior to this, _nbbo_table stored only the CURRENT NBBO per
# contract. When trades were classified in batches (which can span seconds
# of wall-clock time, especially under aggregator congestion), the
# comparison was against whatever NBBO was latest at batch-flush time --
# NOT what the NBBO was at the moment of the actual trade. For active
# contracts where bid/ask moves multiple times per second, this produced
# systematic misclassification on bid-stack accumulation patterns.
#
# 6/29 audit: 21 of 86 Alpha Gold fires disagreed with BBS+Bullflow on
# Side direction (BE/MRVL/MU/AMD/LLY/NVDA/AMZN) -- all consistent with
# stale-NBBO-at-classify-time root cause.
#
# Fix: maintain a bounded deque of (ts_ns, bid, ask) tuples per contract,
# appended on every Q event. At classify time, _nbbo_at() walks backward
# to find the snapshot in force at the trade's timestamp.
#
# Memory: 950 contracts (Q subscription cap) * 1000 snapshots * 24 bytes
# = ~23 MB worst case. In practice most contracts have <100 snapshots
# per session for the time window relevant to classification.
_NBBO_HISTORY: dict = {}    # sym -> deque[(ts_ns, bid, ask)]
_NBBO_HISTORY_MAX = 1000    # keep last 1000 NBBO snapshots per contract


def _nbbo_at(sym: str, ts_ns: int) -> tuple | None:
    """
    Find the latest NBBO snapshot at or before ts_ns for this contract.

    Returns (bid, ask, q_ts_ns) -- the most recent NBBO update whose
    timestamp is <= ts_ns. Returns None if no such entry exists.

    Does NOT enforce staleness -- caller is responsible for checking
    age vs NBBO_STALENESS_NS. This separation keeps the helper pure
    and lets the classifier do its own telemetry.

    Walks newest-to-oldest. For typical batches the answer is in the
    first few iterations (event being classified is recent, NBBO history
    has many entries after it), so amortized cost is small despite
    worst-case O(n).
    """
    hist = _NBBO_HISTORY.get(sym)
    if not hist:
        return None
    for q_ts_ns, bid, ask in reversed(hist):
        if q_ts_ns <= ts_ns:
            return (bid, ask, q_ts_ns)
    # No quote at or before this trade -- trade is older than any quote
    # we have in history for this contract.
    return None


# Phase 2g: ER (earnings) flag enrichment. BBS rows include ER='T' for
# tickers with earnings in the next 14 days, 'F' otherwise. This drives the
# "EARNINGS FLOW" callout in the Market Read narrative.
#
# Strategy: piggyback on FlowDB. BBS uploads include the ER column, so for
# tickers that have been in any BBS upload in the past few days, we can
# read their ER status directly from FlowDB. No external API needed.
#
# For tickers we've never seen in BBS, we leave ER='F'. The narrative will
# silently undercount earnings tickers for those, but the rest of the page
# is unaffected.
_ER_CACHE: dict = {}            # {symbol: ('T'|'F', fetched_at_ts)}
_ER_TTL_SEC = 6 * 60 * 60       # refresh ER flag every 6 hours


def _load_er_flags(symbols: list) -> dict:
    """Phase 2g: look up ER flag per symbol from recent FlowDB rows.

    Returns {symbol: 'T'|'F'}. Cached for 6 hours per symbol since earnings
    calendars don't change intraday.
    """
    if not symbols:
        return {}
    now = time.time()
    out = {}
    to_fetch = []
    for sym in symbols:
        if not sym:
            continue
        entry = _ER_CACHE.get(sym)
        if entry and (now - entry[1]) < _ER_TTL_SEC:
            out[sym] = entry[0]
        else:
            to_fetch.append(sym)

    if not to_fetch:
        return out

    # Query FlowDB for most recent ER value per symbol. ER comes in as 'T'
    # or 'F' (BBS uses single-char codes for boolean flags).
    #
    # We need the latest VALID (non-empty) value PER SYMBOL. Date ordering
    # is tricky because CreatedDate is M/D/YYYY text not ISO. So we sort by
    # parsing the date columns. SQLite doesn't have native date parsing for
    # this format, but we can use date(substr(...)) tricks. Simpler approach:
    # pull ALL valid-ER rows per symbol and do the date comparison in Python.
    try:
        import sqlite3
        from datetime import datetime as _dt
        from api.flow_db import FlowDB
        db = FlowDB()
        with sqlite3.connect(db.db_path, timeout=10) as conn:
            placeholders = ",".join("?" for _ in to_fetch)
            sql = f"""
                SELECT Symbol, ER, CreatedDate FROM flow
                WHERE Symbol IN ({placeholders})
                  AND ER IS NOT NULL AND TRIM(ER) != ''
            """
            cur = conn.execute(sql, to_fetch)
            # Group by symbol, pick the one with latest parsed date
            by_sym = {}  # symbol -> (parsed_date, er_value)
            for sym, er, created_date in cur.fetchall():
                try:
                    d = _dt.strptime(created_date, "%m/%d/%Y").date()
                except (ValueError, TypeError):
                    continue
                existing = by_sym.get(sym)
                if existing is None or d > existing[0]:
                    by_sym[sym] = (d, er)
            for sym, (_, er) in by_sym.items():
                er_clean = (er or 'F').strip().upper()
                er_val = 'T' if er_clean == 'T' else 'F'
                out[sym] = er_val
                _ER_CACHE[sym] = (er_val, now)
        # For any symbol not found, cache 'F' so we don't keep re-querying
        for sym in to_fetch:
            if sym not in out:
                out[sym] = 'F'
                _ER_CACHE[sym] = ('F', now)
    except Exception as e:
        logger.warning("[massive-ws] ER flag lookup failed: %s", e)

    return out


def _load_spot_for_events(events: list) -> dict:
    """Phase 2b: synchronous spot lookup with background fetch queue.

    For each unique symbol in the batch:
    - If cached and fresh, return cached spot
    - Otherwise queue the symbol for background fetch

    Returns {symbol: spot_price}. Symbols not in cache get omitted (caller
    treats as spot=0 -- same as pre-Phase-2b behavior).
    """
    if not events:
        return {}
    now = time.time()
    out = {}
    for e in events:
        sym = e.root
        if not sym or sym in out:
            continue
        cached = _SPOT_CACHE.get(sym)
        if cached and (now - cached[1]) < _SPOT_TTL_SEC:
            out[sym] = cached[0]
        else:
            # Queue for background fetch
            if sym and not sym[-1].isdigit() and sym not in _spot_fetch_seen:
                _spot_fetch_queue.append(sym)
                _spot_fetch_seen.add(sym)
    _state["last_spot_lookup_size"] = len({e.root for e in events if e.root})
    _state["last_spot_lookup_resolved"] = len(out)
    _state["spot_fetch_queue_size"] = len(_spot_fetch_queue)
    return out


def _load_cumulative_volume(events: list) -> dict:
    """Phase 2d: compute cumulative day volume per contract for BBS-style Color.

    BBS computes Color (YELLOW/MAGENTA when volume > OI) using the DAY's
    running total volume on a contract, not single-event volume. Without
    this, our YELLOW/MAGENTA rate sits at ~12% vs BBS's 51%.

    For each event, sum: (DB day-to-date volume for this contract) + (in-batch
    volume on this contract up to and including this event). Returns
    {event_index: cumulative_volume}.

    Performance: one SQL query per batch (not per event). For a batch of 50
    events on 30 unique contracts, this is ~3ms total.
    """
    if not events:
        return {}
    import sqlite3
    from datetime import datetime

    # ET trade date for these events (all share same date in any batch)
    first_ts_et = datetime.fromtimestamp(events[0].first_ts_ns / 1e9, tz=UTC).astimezone(ET)
    trade_date_mdY = f"{first_ts_et.month}/{first_ts_et.day}/{first_ts_et.year}"

    # Build unique contract identifiers
    contracts = {}  # contract_key -> (symbol, cp, strike_strs, exp_mdy)
    for i, e in enumerate(events):
        exp_mdy = f"{e.expiry.month}/{e.expiry.day}/{e.expiry.year}"
        strike_int = int(e.strike) if e.strike == int(e.strike) else None
        strike_strs = []
        if strike_int is not None:
            strike_strs.append(str(strike_int))
        strike_strs.append(str(float(e.strike)))
        seen = set()
        strike_strs = [s for s in strike_strs if not (s in seen or seen.add(s))]
        key = (e.root, e.cp, e.strike, exp_mdy)
        if key not in contracts:
            contracts[key] = strike_strs

    # Query FlowDB for day-to-date cumulative volume per contract
    db_vol = {}  # (root, cp, strike, exp_mdy) -> sum(Volume)
    try:
        from api.flow_db import FlowDB
        db = FlowDB()
        with sqlite3.connect(db.db_path, timeout=10) as conn:
            for key, strike_strs in contracts.items():
                root, cp, strike, exp_mdy = key
                total = 0
                for strike_str in strike_strs:
                    cur = conn.execute(
                        "SELECT COALESCE(SUM(CAST(Volume AS INTEGER)), 0) "
                        "FROM flow WHERE Symbol=? AND CallPut=? AND "
                        "Strike=? AND ExpirationDate=? AND CreatedDate=?",
                        (root, cp, strike_str, exp_mdy, trade_date_mdY),
                    )
                    row = cur.fetchone()
                    if row and row[0]:
                        total += int(row[0])
                if total > 0:
                    db_vol[key] = total
    except Exception as e:
        logger.warning("[massive-ws] cumulative volume lookup failed: %s", e)

    # For each event, cumulative = DB total + sum of this batch up to (incl) this event
    batch_running = {}  # (root, cp, strike, exp_mdy) -> running batch sum
    out = {}
    for i, e in enumerate(events):
        exp_mdy = f"{e.expiry.month}/{e.expiry.day}/{e.expiry.year}"
        key = (e.root, e.cp, e.strike, exp_mdy)
        batch_running[key] = batch_running.get(key, 0) + e.total_size
        out[i] = db_vol.get(key, 0) + batch_running[key]
    return out


def _write_events(events: list) -> None:
    """Split events into stocks/indexes and write each to FlowDB."""
    from api.massive_processor import is_index_source

    stocks = [e for e in events if not is_index_source(e.root)]
    indexes = [e for e in events if is_index_source(e.root)]

    if not stocks and not indexes:
        return

    if DRY_RUN:
        logger.info(
            "[massive-ws] DRY_RUN: would write %d stocks + %d indexes events "
            "(skipping FlowDB)", len(stocks), len(indexes)
        )
        _state["events_written_stocks"] += len(stocks)
        _state["events_written_indexes"] += len(indexes)
        return

    try:
        from api.flow_db import FlowDB
        db = FlowDB()

        # Enrich with MktCap + Sector from FlowDB cache (free, instant, no API).
        # Any ticker that's been in FlowDB before (BBS upload, prior writes)
        # has its metadata cached. New tickers get empty metadata; the page's
        # cap filter handles that gracefully (falls into Mid-Small bucket).
        all_syms = list({e.root for e in events})
        ticker_meta = _load_ticker_metadata(all_syms)

        # Record diagnostic info so /api/massive/status reveals what enrichment
        # is actually finding in production
        _state["last_meta_lookup_size"] = len(all_syms)
        _state["last_meta_lookup_resolved"] = len(ticker_meta)
        # Sample up to 5 resolved entries (truncate values for compactness)
        sample = {}
        for sym in list(ticker_meta.keys())[:5]:
            m = ticker_meta[sym]
            sample[sym] = {
                "mktcap": m.get("mktcap", 0),
                "sector": m.get("sector", ""),
            }
        _state["last_meta_sample"] = sample

        if ticker_meta:
            logger.debug(
                "[massive-ws] enriched %d/%d tickers with FlowDB metadata",
                len(ticker_meta), len(all_syms),
            )

        # OI enrichment: look up snapshot OI for each event's contract.
        # Powers Color (WHITE/YELLOW/MAGENTA) per BBS rules. Without OI we
        # can't tell if a trade exceeds existing positioning -- everything
        # stays WHITE. Stocks and indexes both have snapshots (SOURCES list
        # in oi_snapshots.py includes both).
        oi_stocks = _load_oi_for_events(stocks) if stocks else {}
        oi_indexes = _load_oi_for_events(indexes) if indexes else {}
        _state["last_oi_lookup_size"] = len(stocks) + len(indexes)
        _state["last_oi_lookup_resolved"] = len(oi_stocks) + len(oi_indexes)

        # Phase 2d: cumulative day volume per contract for BBS-style Color.
        # Combined with OI, this drives YELLOW/MAGENTA confirmation. Without
        # this, Color is computed from single-event volume and we sit at
        # ~12% confirmed vs BBS's 51%.
        cum_vol_stocks = _load_cumulative_volume(stocks) if stocks else {}
        cum_vol_indexes = _load_cumulative_volume(indexes) if indexes else {}

        # Phase 2b: spot price enrichment. Best-effort -- symbols not in cache
        # get omitted and spot=0 in the row (same as pre-Phase-2b behavior).
        # Symbols queue for background fetch; next batch picks them up.
        spot_stocks = _load_spot_for_events(stocks) if stocks else {}
        spot_indexes = _load_spot_for_events(indexes) if indexes else {}

        # Phase 2g: ER flag from FlowDB cache (BBS uploads provide this).
        # Free lookup, no external API.
        all_syms_for_er = list({e.root for e in events})
        er_map = _load_er_flags(all_syms_for_er)

        if stocks:
            csv_str = _events_to_csv(stocks, "stocks",
                                     ticker_meta=ticker_meta, oi_map=oi_stocks,
                                     cum_vol_map=cum_vol_stocks,
                                     spot_map=spot_stocks, er_map=er_map)
            result = db.insert_csv(csv_str, source="stocks")
            _state["events_written_stocks"] += result.get("inserted", 0)
            if result.get("skipped", 0):
                logger.debug(
                    "[massive-ws] stocks: %d inserted, %d skipped (dupes)",
                    result["inserted"], result.get("skipped", 0),
                )

        if indexes:
            csv_str = _events_to_csv(indexes, "indexes",
                                     ticker_meta=ticker_meta, oi_map=oi_indexes,
                                     cum_vol_map=cum_vol_indexes,
                                     spot_map=spot_indexes, er_map=er_map)
            result = db.insert_csv(csv_str, source="indexes")
            _state["events_written_indexes"] += result.get("inserted", 0)
            if result.get("skipped", 0):
                logger.debug(
                    "[massive-ws] indexes: %d inserted, %d skipped (dupes)",
                    result["inserted"], result.get("skipped", 0),
                )

        _state["last_write_ts"] = time.time()
    except Exception as e:
        logger.exception("[massive-ws] DB write failed: %s", e)
        _state["last_error"] = f"db_write: {e}"


# -- WebSocket consumer ---------------------------------------------

async def _consume_forever():
    """Outer loop: connect, run, reconnect on failure with backoff.

    Backoff semantics: starts at MIN_RECONNECT_GAP (20s) per Massive support
    guidance -- their server takes 10-30s to notice an unexpected client
    disconnect. Reconnecting faster than that means the SERVER thinks both
    connections are active, which trips max_connections and locks you out.
    Doubles on each failure to MAX_BACKOFF.

    The backoff resets to MIN_RECONNECT_GAP ONLY after a successful
    authentication -- NOT when TCP connects. Massive will happily accept
    the TCP connection and then immediately respond with auth_failed or
    max_connections; if we reset backoff on TCP-open, an account that's
    locked out gets hammered too fast, which makes the lockout worse.

    Special-case: max_connections triggers a long cooldown (MAX_CONN_COOLDOWN)
    regardless of backoff. This error means Massive thinks you have too many
    connections; retrying every minute won't help and may extend the lockout.
    """
    import websockets

    # Per Massive support: leave 10-30s gap between automatic reconnections
    # so both client and server have time to fully close the old connection
    # before a new one is established. We pick the high end (20s) for safety.
    MIN_RECONNECT_GAP = 20.0
    backoff = MIN_RECONNECT_GAP
    MAX_BACKOFF = 120.0
    MAX_CONN_COOLDOWN = 600.0  # 10 min -- long enough for server-side cleanup

    while ENABLED:
        try:
            logger.info("[massive-ws] connecting to %s", MASSIVE_OPTIONS_WS_URL)
            async with websockets.connect(
                MASSIVE_OPTIONS_WS_URL,
                ping_interval=20,
                ping_timeout=20,
                max_size=2**24,  # 16 MB frames; bursts can be large
            ) as ws:
                _state["connected"] = True
                # NOTE: do NOT reset backoff here -- wait for auth_success below

                # 1. Initial status message -- could be "connected" OR an error
                first = await asyncio.wait_for(ws.recv(), timeout=10)
                logger.info("[massive-ws] hello: %s", first[:200])
                # Detect immediate rejection (e.g. max_connections) and fail
                # fast so we don't waste an auth attempt that's guaranteed to
                # be rejected too. Triggers the cooldown path below.
                if "max_connections" in first:
                    raise RuntimeError(f"max_connections at hello: {first[:300]}")

                # 2. Authenticate
                await ws.send(json.dumps({
                    "action": "auth",
                    "params": MASSIVE_API_KEY,
                }))
                auth_resp = await asyncio.wait_for(ws.recv(), timeout=10)
                logger.info("[massive-ws] auth: %s", auth_resp[:200])
                if "auth_success" not in auth_resp:
                    raise RuntimeError(f"auth failed: {auth_resp[:300]}")

                # Auth successful -- NOW it's safe to reset backoff. From here
                # on, any disconnect is something to retry quickly (but still
                # honoring the 20s server-cleanup window).
                backoff = MIN_RECONNECT_GAP

                # 3. Subscribe to trades
                await ws.send(json.dumps({
                    "action": "subscribe",
                    "params": MASSIVE_WS_SUBSCRIBE,
                }))
                sub_resp = await asyncio.wait_for(ws.recv(), timeout=10)
                logger.info("[massive-ws] sub: %s", sub_resp[:200])

                # 4. Drain forever -- message loop alongside a periodic flusher.
                # Warm-start (Phase 2c.1) happens INSIDE _run_session after it
                # clears the per-session state, so we don't accidentally wipe
                # the warm-started pool.
                await _run_session(ws)

        except asyncio.CancelledError:
            logger.info("[massive-ws] cancelled -- exiting")
            raise
        except Exception as e:
            _state["connected"] = False
            _state["last_error"] = str(e)
            _state["reconnect_count"] += 1

            # Pick cooldown: max_connections gets a long sleep, everything
            # else gets normal exponential backoff.
            err_str = str(e)
            if "max_connections" in err_str:
                sleep_for = MAX_CONN_COOLDOWN
                logger.warning(
                    "[massive-ws] max_connections -- long cooldown %.0fs "
                    "(retrying won't help; check account limit / contact support)",
                    sleep_for,
                )
            else:
                sleep_for = backoff
                logger.warning(
                    "[massive-ws] connection error (%s) -- reconnect in %.1fs",
                    e, sleep_for,
                )
                backoff = min(backoff * 2, MAX_BACKOFF)

            await asyncio.sleep(sleep_for)

    logger.info("[massive-ws] disabled via env -- consumer stopping")


async def _run_session(ws):
    """Handle one connected session: parse trades, periodic flush, Q subscription pool."""
    from api.massive_processor import TradeAggregator, RawTrade

    agg = TradeAggregator(min_premium=MIN_PREMIUM, min_volume=MIN_VOLUME)

    # Phase 2c: clear NBBO/subscription state on each session. These don't
    # survive disconnects -- we rebuild over the first few minutes of trading
    # after reconnect. Module-level so the message handler can mutate them.
    _nbbo_table.clear()
    _q_subscribed.clear()
    _q_last_seen.clear()
    _q_pending_subscribe.clear()
    _q_pending_unsubscribe.clear()
    _state["q_subscribed_count"] = 0
    _state["quotes_received"] = 0

    # Phase 2f: clear OI fetch queue on each session. Contracts that were
    # unresolved last session might now be in the cron snapshot (5:30 AM run);
    # re-checking is essentially free since DB cache hits are <1ms.
    _oi_fetch_queue.clear()
    _oi_fetch_seen.clear()
    _state["oi_fetch_queue_size"] = 0

    # Phase 2b: clear spot fetch queue. Cache survives (60s TTL handles
    # staleness), but pending queue is cleared so we don't re-fetch
    # contracts that may have been resolved between sessions.
    _spot_fetch_queue.clear()
    _spot_fetch_seen.clear()
    _state["spot_fetch_queue_size"] = 0

    # Phase 2h: clear tick test cache on each session. Prices from before
    # the disconnect could be hours old and would give wrong tick directions
    # at session resume. Better to start fresh -- by the time the next event
    # batch arrives, the cache will rebuild for actively-traded contracts.
    _TICK_TEST_CACHE.clear()

    # Phase 2i: clear raw T print history on session start. Same reasoning
    # as tick cache -- stale prices across disconnects can mis-classify.
    _RAW_T_HISTORY.clear()

    # Phase 2 (6/29 audit): clear NBBO history on session start. Same
    # reasoning -- stale quotes from before the disconnect would mis-classify
    # the first events of the new session. Active contracts rebuild the
    # history within seconds as Q events stream in post-reconnect.
    _NBBO_HISTORY.clear()

    # Phase 2c.1: warm-start the Q subscription pool with historically-active
    # contracts BEFORE the message loop starts. Without this, the first
    # 10-15 minutes after market open have ~0% Side classification because
    # the dynamic-add-on-emit logic only learns about contracts AFTER they
    # emit an event. With warm-start, the NBBO table populates from the
    # first market tick.
    #
    # Batched at 200 contracts per subscribe message to stay under any
    # frame-size limits Massive may enforce.
    warm = _build_warm_start_contracts(limit=MAX_Q_SUBSCRIPTIONS)
    if warm:
        BATCH = 200
        for i in range(0, len(warm), BATCH):
            chunk = warm[i:i + BATCH]
            params = ",".join(f"Q.{s}" for s in chunk)
            try:
                await ws.send(json.dumps({
                    "action": "subscribe",
                    "params": params,
                }))
            except Exception as e:
                logger.warning("[massive-ws] warm-start subscribe batch failed: %s", e)
                break
            # Brief yield between batches so the server can ack and our
            # local event loop can handle anything else queued up.
            await asyncio.sleep(0.1)
        # Pre-populate local pool tracking so LRU eviction sees these.
        _q_subscribed.update(warm)
        now_ns = time.time_ns()
        for sym in warm:
            _q_last_seen[sym] = now_ns
        _state["q_subscribed_count"] = len(_q_subscribed)
        _state["q_subscribes_sent"] = (len(warm) + BATCH - 1) // BATCH
        logger.info(
            "[massive-ws] warm-start complete: pool initialized with "
            "%d contracts in %d batches",
            len(warm), _state["q_subscribes_sent"]
        )
    else:
        logger.info(
            "[massive-ws] warm-start skipped (no FlowDB data) -- "
            "Q pool will grow dynamically from T event flow"
        )

    # Periodic flusher task -- runs alongside the receive loop
    stop_event = asyncio.Event()

    async def flusher():
        while not stop_event.is_set():
            try:
                await asyncio.wait_for(stop_event.wait(),
                                       timeout=FLUSH_INTERVAL_SEC)
            except asyncio.TimeoutError:
                pass
            # Flush by wall clock -- close any bucket whose last trade is stale
            now_ns = time.time_ns()
            agg.flush_stale(now_ns)
            events = agg.drain()
            if events:
                _state["events_emitted"] += len(events)
                # Phase 2c: classify Side for each event using current NBBO
                _classify_events_side(events)
                # Phase 2c: queue Q subscriptions for any newly-active contracts
                # so future events on these contracts get classified
                _queue_q_subscriptions_for_events(events)
                _write_events(events)

    async def q_subscription_manager():
        """Drain subscribe/unsubscribe queues in batches every 5 seconds.

        Batching avoids hammering Massive with one WS message per contract.
        Operations happen via the same WS connection that's serving T/Q --
        Massive's docs don't separate subscribe channels from data channels.
        """
        while not stop_event.is_set():
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                pass
            # Take a snapshot of pending lists, then clear them so the event
            # loop can continue queuing while we send.
            subs = _q_pending_subscribe[:]
            unsubs = _q_pending_unsubscribe[:]
            _q_pending_subscribe.clear()
            _q_pending_unsubscribe.clear()
            # Dedup just in case the same contract got queued twice
            subs = list(dict.fromkeys(subs))
            unsubs = list(dict.fromkeys(unsubs))
            # Send unsubscribes FIRST so we don't briefly exceed the 1000 cap
            if unsubs:
                try:
                    params = ",".join(f"Q.{s}" for s in unsubs)
                    await ws.send(json.dumps({
                        "action": "unsubscribe",
                        "params": params,
                    }))
                    _q_subscribed.difference_update(unsubs)
                    _state["q_unsubscribes_sent"] += 1
                    logger.info("[massive-ws] Q.unsubscribed %d contracts "
                                "(pool now %d)", len(unsubs), len(_q_subscribed))
                except Exception as e:
                    logger.warning("[massive-ws] Q unsubscribe failed: %s", e)
                    # On failure, leave the contract in our local set so we
                    # don't count it as "free" capacity. Massive may still
                    # have it subscribed; better to be conservative.
                    _q_subscribed.update(unsubs)
            if subs:
                try:
                    params = ",".join(f"Q.{s}" for s in subs)
                    await ws.send(json.dumps({
                        "action": "subscribe",
                        "params": params,
                    }))
                    _q_subscribed.update(subs)
                    _state["q_subscribes_sent"] += 1
                    logger.info("[massive-ws] Q.subscribed %d contracts "
                                "(pool now %d)", len(subs), len(_q_subscribed))
                except Exception as e:
                    logger.warning("[massive-ws] Q subscribe failed: %s", e)
            _state["q_subscribed_count"] = len(_q_subscribed)

    async def spot_fetch_manager():
        """Phase 2b: drain spot fetch queue every 10 sec via Yahoo Finance.

        Uses Yahoo's v8/chart endpoint (same one their ytd-performance route
        is already using in production). One request per symbol, run in
        parallel via asyncio.gather.

        Each chart response has meta.regularMarketPrice with the live spot.
        Fall back to latest valid close from the close array if meta is
        missing. Cache results in _SPOT_CACHE with 60-sec TTL.

        Index symbols (SPX, NDX, etc.) get mapped to Yahoo's caret format
        via YF_INDEX_MAP -- matches schwab_router.py exactly.
        """
        YF_INDEX_MAP = {
            "SPX": "^GSPC", "NDX": "^NDX", "DJX": "^DJI",
            "RUT": "^RUT", "VIX": "^VIX", "XSP": "^GSPC",
            "SPXW": "^GSPC",
        }
        UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

        async def fetch_one(client, our_sym):
            """Single symbol fetch. Returns (our_sym, spot or None)."""
            yf_sym = YF_INDEX_MAP.get(our_sym, our_sym)
            try:
                resp = await client.get(
                    f"https://query1.finance.yahoo.com/v8/finance/chart/{yf_sym}",
                    params={"interval": "1d", "range": "5d",
                            "includePrePost": "false"},
                    headers={"User-Agent": UA},
                )
                if resp.status_code != 200:
                    return (our_sym, None)
                data = resp.json()
                result = data.get("chart", {}).get("result")
                if not result:
                    return (our_sym, None)
                first = result[0]
                # Prefer meta.regularMarketPrice (current/most-recent)
                meta = first.get("meta", {})
                spot = meta.get("regularMarketPrice")
                if isinstance(spot, (int, float)) and spot > 0:
                    return (our_sym, float(spot))
                # Fallback: latest valid close
                quote = first.get("indicators", {}).get("quote", [{}])[0]
                closes = quote.get("close", [])
                for c in reversed(closes):
                    if isinstance(c, (int, float)) and c > 0:
                        return (our_sym, float(c))
                return (our_sym, None)
            except Exception:
                return (our_sym, None)

        while not stop_event.is_set():
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=10.0)
            except asyncio.TimeoutError:
                pass
            if not _spot_fetch_queue:
                continue
            batch = _spot_fetch_queue[:]
            _spot_fetch_queue.clear()
            _spot_fetch_seen.clear()
            # Cap to 30 parallel requests per cycle (Yahoo can be touchy
            # with high concurrency; their ytd-performance route uses 30)
            if len(batch) > 30:
                overflow = batch[30:]
                batch = batch[:30]
                _spot_fetch_queue.extend(overflow)
                _spot_fetch_seen.update(overflow)
            _state["spot_fetch_queue_size"] = len(_spot_fetch_queue)

            try:
                import httpx
                async with httpx.AsyncClient(timeout=8.0) as client:
                    tasks = [fetch_one(client, sym) for sym in batch]
                    results = await asyncio.gather(*tasks, return_exceptions=False)
                now = time.time()
                resolved = 0
                for sym, spot in results:
                    if spot is not None and spot > 0:
                        _SPOT_CACHE[sym] = (spot, now)
                        resolved += 1
                logger.info(
                    "[massive-ws] spot fetch (Yahoo): %d symbols -> %d resolved",
                    len(batch), resolved
                )
                _state["spot_fetches_sent"] = _state.get("spot_fetches_sent", 0) + 1
                _state["spot_symbols_resolved"] = _state.get("spot_symbols_resolved", 0) + resolved
            except Exception as e:
                logger.debug("[massive-ws] spot fetch failed: %s", e)
                _spot_fetch_seen.difference_update(batch)

    async def oi_fetch_manager():
        """Phase 2f: drain the on-demand OI fetch queue every 20 seconds.

        Calls Schwab in batches of up to 200 contracts per call. Persists
        results to contract_oi_snapshots with source='ondemand-schwab' so
        subsequent event batches pick them up via Stage 1 (DB cache).

        20-second cadence is a compromise:
        - Faster (e.g., 5s) -- more Schwab calls but contracts get OI sooner
        - Slower (e.g., 60s) -- fewer calls but multi-fire contracts miss OI
          on their first 2-3 fires.

        20s catches the typical re-fire pattern (an active contract emits
        events every few seconds during heavy flow) within 1-2 fires.
        """
        from datetime import date
        while not stop_event.is_set():
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=20.0)
            except asyncio.TimeoutError:
                pass
            if not _oi_fetch_queue:
                continue
            # Snapshot and clear the queue
            batch = _oi_fetch_queue[:]
            _oi_fetch_queue.clear()
            _state["oi_fetch_queue_size"] = 0
            # Cap to 200 per Schwab call. Anything over goes back to the
            # queue for the next 20s cycle.
            if len(batch) > 200:
                overflow = batch[200:]
                batch = batch[:200]
                _oi_fetch_queue.extend(overflow)
                _state["oi_fetch_queue_size"] = len(overflow)
            try:
                from api.oi_snapshots import _fetch_oi_all_async, record_batch
                results = await _fetch_oi_all_async(batch)
            except Exception as e:
                logger.warning("[massive-ws] on-demand OI batch failed: %s", e)
                # On failure, leave _oi_fetch_seen as-is so we don't retry
                # these contracts in a tight loop. Next session start clears
                # the dedup set.
                continue
            resolved = [(ck, oi, "ondemand-schwab")
                        for ck, oi in results if oi is not None and oi > 0]
            unresolved = sum(1 for _, oi in results if oi is None or oi == 0)
            today_iso = date.today().isoformat()
            if resolved:
                # record_batch is sync SQLite — under WAL contention with the
                # web service reading, this can take 100s of ms or briefly
                # stall. Offload to thread so the asyncio loop stays
                # responsive (NBBO freshness depends on Q events flowing
                # through the event loop with minimal latency).
                try:
                    loop = asyncio.get_event_loop()
                    await loop.run_in_executor(
                        None, record_batch, resolved, today_iso
                    )
                except Exception as e:
                    logger.warning(
                        "[massive-ws] OI snapshot persist failed: %s", e
                    )

                # COLOR REFRESH: backfill Color on today's WHITE rows that
                # were written before this OI was known. Without this, the
                # first trade of the day on a previously-unsnapshotted
                # contract stays WHITE forever, even though Phase 1 has now
                # resolved its OI. This is the "OI race condition" -- worst
                # case affects the 9:30-10:00 AM window when many contracts
                # don't yet have snapshots.
                #
                # Logic: for each newly-resolved (sym, cp, strike, exp_mdy)
                # contract, look up today's flow rows with Color='WHITE'.
                # Sum their cumulative volume on this contract. If cum_vol
                # exceeds OI thresholds, UPDATE Color on all matching rows.
                #
                # CRITICAL: This block runs in a thread pool via run_in_executor
                # so the SQLite UPDATE statements don't block the asyncio event
                # loop. Without offloading, a slow UPDATE (e.g., 100+ rows on
                # contended SQLite) could pause the WS message handler for
                # multiple seconds -- causing Q events to back up and NBBO
                # freshness to crater. Side classification depends on fresh
                # NBBO so this offloading is mandatory.
                def _color_refresh_sync(resolved_contracts):
                    import sqlite3
                    from api.flow_db import FlowDB
                    today_mdY = f"{date.today().month}/{date.today().day}/{date.today().year}"
                    db = FlowDB()
                    rows_updated = 0
                    try:
                        with sqlite3.connect(db.db_path, timeout=10) as conn:
                            for (sym, cp_letter, strike, exp_mdy), oi, _src in resolved_contracts:
                                cp_full = 'CALL' if cp_letter == 'C' else 'PUT'
                                strike_strs = []
                                if strike == int(strike):
                                    strike_strs.append(str(int(strike)))
                                strike_strs.append(str(float(strike)))
                                strike_strs.append(f"{strike:.1f}")
                                seen = set()
                                strike_strs = [s for s in strike_strs if not (s in seen or seen.add(s))]
                                for strike_str in strike_strs:
                                    cur = conn.execute(
                                        "SELECT COALESCE(SUM(CAST(Volume AS INTEGER)),0) "
                                        "FROM flow WHERE Symbol=? AND CallPut=? AND "
                                        "Strike=? AND ExpirationDate=? AND CreatedDate=?",
                                        (sym, cp_full, strike_str, exp_mdy, today_mdY),
                                    )
                                    cum_vol = cur.fetchone()[0] or 0
                                    if cum_vol <= 0:
                                        continue
                                    new_color = None
                                    if cum_vol >= int(1.5 * oi):
                                        new_color = 'MAGENTA'
                                    elif cum_vol > oi:
                                        new_color = 'YELLOW'
                                    if not new_color:
                                        continue
                                    upd = conn.execute(
                                        "UPDATE flow SET Color=? WHERE Symbol=? AND "
                                        "CallPut=? AND Strike=? AND ExpirationDate=? AND "
                                        "CreatedDate=? AND Color='WHITE'",
                                        (new_color, sym, cp_full, strike_str, exp_mdy, today_mdY),
                                    )
                                    rows_updated += upd.rowcount
                                    conn.execute(
                                        "UPDATE flow SET OI=? WHERE Symbol=? AND "
                                        "CallPut=? AND Strike=? AND ExpirationDate=? AND "
                                        "CreatedDate=? AND (OI='0' OR OI='' OR OI IS NULL)",
                                        (str(oi), sym, cp_full, strike_str, exp_mdy, today_mdY),
                                    )
                                    break
                            conn.commit()
                    except Exception as e:
                        logger.warning("[massive-ws] Color refresh failed (in thread): %s", e)
                    return rows_updated

                try:
                    loop = asyncio.get_event_loop()
                    color_updated = await loop.run_in_executor(None, _color_refresh_sync, resolved)
                    if color_updated:
                        logger.info(
                            "[massive-ws] Color refresh: upgraded %d WHITE -> Y/M "
                            "after OI backfill", color_updated
                        )
                    _state["color_refresh_rows_updated"] = _state.get("color_refresh_rows_updated", 0) + color_updated
                except Exception as e:
                    logger.warning("[massive-ws] Color refresh dispatch failed: %s", e)

            _state["oi_fetch_batches_sent"] += 1
            _state["oi_fetch_contracts_resolved"] += len(resolved)
            _state["oi_fetch_contracts_unresolved"] += unresolved
            logger.info(
                "[massive-ws] on-demand OI batch: %d contracts -> "
                "%d resolved, %d no-data",
                len(batch), len(resolved), unresolved
            )

    async def stale_connection_watchdog():
        """Force-close the WS if no T events received for STALE_THRESHOLD_SEC
        during market hours. Recovers from the "half-open socket" failure
        mode where the connection appears alive (no FIN/RST received) but
        no data is flowing.

        Background on the failure mode this fixes:
          - websockets library's ping_interval=20/ping_timeout=20 is supposed
            to detect dead connections, but in practice has been observed to
            silently stop firing pings under certain conditions (NAT/firewall
            connection tracking quirks, kernel-level socket weirdness)
          - When that happens, `async for msg in ws:` blocks forever waiting
            for data that will never arrive
          - Container shows "online" because the Python process is alive,
            just stuck on a dead socket
          - Manual restart is required to recover, losing minutes of data

        Watchdog logic:
          - Only active during market hours (9:30 AM - 4:00 PM ET, weekdays).
            Outside market hours, no events are EXPECTED to flow, so no
            stale detection. Returns early on weekends/after-hours.
          - Grace period after connect: only triggers if last_trade_ts has
            been set at least once (i.e. session was healthy at some point).
            Avoids false trigger during initial connection establishment.
          - On stale: closes the WS, which triggers the outer reconnect loop
            in run_consumer() to establish a fresh connection.
        """
        STALE_THRESHOLD_SEC = 60.0  # tune via experience
        CHECK_INTERVAL_SEC = 10.0
        ET_TZ = ZoneInfo("America/New_York")
        while not stop_event.is_set():
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=CHECK_INTERVAL_SEC)
            except asyncio.TimeoutError:
                pass
            else:
                break  # stop_event fired

            # Market-hours gate
            now_et = datetime.now(ET_TZ)
            if now_et.weekday() >= 5:
                continue  # weekend
            mo = now_et.replace(hour=9, minute=30, second=0, microsecond=0)
            mc = now_et.replace(hour=16, minute=0, second=0, microsecond=0)
            if not (mo <= now_et <= mc):
                continue  # outside market hours

            last_ts = _state.get("last_trade_ts")
            if last_ts is None:
                # Session just started, no events yet — give it time
                continue
            age = time.time() - last_ts
            if age > STALE_THRESHOLD_SEC:
                logger.warning(
                    "[massive-ws] WATCHDOG: no T events received in %.1fs "
                    "during market hours — forcing WS close to reconnect.", age
                )
                _state["watchdog_force_reconnects"] = (
                    _state.get("watchdog_force_reconnects", 0) + 1
                )
                _state["last_error"] = (
                    f"watchdog: stale connection, no events in {age:.0f}s"
                )
                try:
                    await ws.close(code=1001, reason="watchdog: stale connection")
                except Exception as e:
                    logger.debug("[massive-ws] WATCHDOG ws.close error: %s", e)
                return  # exit watchdog; outer loop will reconnect

    flusher_task = asyncio.create_task(flusher())
    q_mgr_task = asyncio.create_task(q_subscription_manager())
    oi_mgr_task = asyncio.create_task(oi_fetch_manager())
    spot_mgr_task = asyncio.create_task(spot_fetch_manager())
    watchdog_task = asyncio.create_task(stale_connection_watchdog())

    try:
        async for msg in ws:
            # Massive batches multiple events per WS frame into a JSON array
            try:
                payload = json.loads(msg)
            except json.JSONDecodeError:
                logger.warning("[massive-ws] bad json: %s", msg[:200])
                continue

            if not isinstance(payload, list):
                payload = [payload]

            for evt in payload:
                ev_type = evt.get("ev")
                if ev_type == "T":
                    # Options trade -- see schema at
                    # https://massive.com/docs/websocket/options/trades
                    try:
                        sym = evt["sym"]
                        price = float(evt["p"])
                        size = int(evt["s"])
                        exch = int(evt["x"])
                        ts_ms = int(evt["t"])
                        conds = evt.get("c") or []
                        cond = int(conds[0]) if conds else -1
                    except (KeyError, ValueError, TypeError) as e:
                        logger.debug("[massive-ws] skip malformed T: %s (%s)",
                                     evt, e)
                        continue

                    agg.add_trade(RawTrade(
                        ticker=sym,
                        price=price,
                        size=size,
                        exchange=exch,
                        conditions=cond,
                        ts_ns=ts_ms * 1_000_000,  # ms -> ns
                    ))
                    _state["trades_received"] += 1
                    _state["last_trade_ts"] = time.time()
                    # Phase 2i: track raw T price history per contract for
                    # proper Lee-Ready tick test. Bounded to last N prints
                    # per contract to limit memory.
                    hist = _RAW_T_HISTORY.get(sym)
                    if hist is None:
                        hist = deque(maxlen=_RAW_T_MAX)
                        _RAW_T_HISTORY[sym] = hist
                    hist.append((ts_ms * 1_000_000, price))
                    # Phase 2c: refresh LRU tracker for this contract so
                    # active contracts stay in the Q subscription pool
                    _q_last_seen[sym] = time.time_ns()
                elif ev_type == "Q":
                    # Phase 2c: NBBO update -- store latest bid/ask for the
                    # contract so we can classify Side on subsequent trades.
                    # Schema: ev=Q, sym, bp, ap, bs, as, t (ms), q (seq)
                    try:
                        sym = evt["sym"]
                        bid = float(evt["bp"])
                        ask = float(evt["ap"])
                        ts_ms = int(evt["t"])
                    except (KeyError, ValueError, TypeError):
                        continue
                    _nbbo_table[sym] = (bid, ask, ts_ms)
                    # Phase 2 (6/29 audit): append to per-contract NBBO history
                    # for proper time-aligned classification. The current-only
                    # _nbbo_table is kept for diagnostics/status endpoints but
                    # is no longer the source of truth for Side classification.
                    nh = _NBBO_HISTORY.get(sym)
                    if nh is None:
                        nh = deque(maxlen=_NBBO_HISTORY_MAX)
                        _NBBO_HISTORY[sym] = nh
                    nh.append((ts_ms * 1_000_000, bid, ask))
                    _state["quotes_received"] += 1
                elif ev_type == "status":
                    logger.info("[massive-ws] status: %s", evt)
                else:
                    # Other event types (AM, A, FMV) -- not subscribed
                    logger.debug("[massive-ws] unhandled ev=%s", ev_type)
    finally:
        stop_event.set()
        try:
            await flusher_task
        except Exception:
            pass
        try:
            await q_mgr_task
        except Exception:
            pass
        try:
            await oi_mgr_task
        except Exception:
            pass
        try:
            await spot_mgr_task
        except Exception:
            pass
        try:
            watchdog_task.cancel()
            await watchdog_task
        except (Exception, asyncio.CancelledError):
            pass
        # Final flush so we don't lose the last few seconds on disconnect
        agg.flush_all()
        events = agg.drain()
        if events:
            _state["events_emitted"] += len(events)
            _write_events(events)


# -- Thread entry point ---------------------------------------------

def _thread_main():
    """Run the asyncio loop in this dedicated thread."""
    try:
        asyncio.run(_consume_forever())
    except Exception as e:
        logger.exception("[massive-ws] thread crashed: %s", e)
        _state["last_error"] = f"thread_crash: {e}"
    finally:
        _state["running"] = False
        _state["connected"] = False


def start() -> bool:
    """
    Kick off the WS consumer in a background thread.

    Call once during FastAPI startup, AFTER acquire_scheduler_lock() so that
    only one uvicorn worker connects (the per-asset-class connection limit
    on Massive's side would otherwise cause one worker to kick the other off).

    Returns True if the thread was started, False if disabled or missing key.
    """
    if not ENABLED:
        logger.info("[massive-ws] disabled via MASSIVE_WS_ENABLED=0")
        return False
    if not MASSIVE_API_KEY:
        logger.warning("[massive-ws] MASSIVE_API_KEY not set -- not starting")
        return False
    if _state["running"]:
        logger.info("[massive-ws] already running -- start() ignored")
        return False

    t = threading.Thread(
        target=_thread_main, daemon=True, name="massive-ws-consumer"
    )
    _state["thread"] = t
    _state["started_at"] = time.time()
    _state["running"] = True
    t.start()

    logger.info(
        "[massive-ws] consumer thread started "
        "(url=%s, subscribe=%s, min_prem=$%s, min_vol=%d, dry_run=%s)",
        MASSIVE_OPTIONS_WS_URL, MASSIVE_WS_SUBSCRIBE,
        f"{MIN_PREMIUM:,.0f}", MIN_VOLUME, DRY_RUN,
    )
    return True
