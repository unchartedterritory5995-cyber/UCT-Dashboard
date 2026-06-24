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
from datetime import datetime, date
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
}


# Phase 2c: NBBO table and Q subscription pool (in-memory, per-session).
# Cleared on disconnect -- rebuilt over the first ~10 min of market activity
# after each reconnect. Lifetime is the WebSocket session.
_nbbo_table: dict = {}        # {contract_sym: (bid, ask, ts_ms)}
_q_subscribed: set = set()    # contract syms we're currently subscribed to Q for
_q_last_seen: dict = {}       # {contract_sym: ts_ns} - LRU tracking
_q_pending_subscribe: list = []   # queued contracts to subscribe (added by event loop)
_q_pending_unsubscribe: list = [] # queued contracts to unsubscribe (LRU evictions)

# 1000-contract hard cap per connection (Massive docs).
# We leave a 50-slot headroom so churn doesn't immediately hit the ceiling
# during subscribe-add cycles.
MAX_Q_SUBSCRIPTIONS = 950

# How fresh an NBBO needs to be (vs trade timestamp) to use for Side
# classification. Stale quotes give wrong sides. 5 seconds is generous
# for liquid contracts where quotes update every few hundred ms.
NBBO_STALENESS_NS = 5_000_000_000


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

    return out


# Need to import the ET / UTC zones used above. The processor exports them
# but a local import keeps this module self-contained for the OI helper.
from zoneinfo import ZoneInfo
ET = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")


def _events_to_csv(events: list, source: str, ticker_meta: dict = None, oi_map: dict = None) -> str:
    """Convert AggEvents -> BBS-format CSV string for FlowDB.insert_csv.

    ticker_meta: optional {symbol: {"mktcap": int, "sector": str}} dict for
    per-row enrichment. Built once per flush by _load_ticker_metadata.
    """
    from api.massive_processor import event_to_bbs_row
    from api.flow_db import COLUMNS  # Reuse the exact column order

    ticker_meta = ticker_meta or {}
    oi_map = oi_map or {}
    buf = StringIO()
    buf.write(",".join(COLUMNS) + "\n")
    for i, evt in enumerate(events):
        meta = ticker_meta.get(evt.root, {})
        oi = oi_map.get(i, 0)
        row = event_to_bbs_row(
            evt, source=source,
            mktcap=meta.get("mktcap", 0),
            sector=meta.get("sector", ""),
            oi=oi,
        )
        # Quote-safe write -- premium/strike never have commas but be defensive
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
    """Phase 2c: set evt.side on each AggEvent using current NBBO table.

    Mutates the events in place. Events for contracts without fresh NBBO
    data keep side='' (which the page treats as no-direction, no-confirm).

    Side classification uses the avg_price of the aggregated burst against
    the most recent NBBO for that contract. We require the NBBO to be
    within NBBO_STALENESS_NS of the event's first trade timestamp -- older
    quotes give wrong sides (the market may have moved).
    """
    classified = 0
    for evt in events:
        sym = _reconstruct_occ_symbol(evt.root, evt.expiry, evt.cp, evt.strike)
        nbbo = _nbbo_table.get(sym)
        if not nbbo:
            continue
        bid, ask, ts_ms = nbbo
        # NBBO ts is unix ms; event ts is unix ns -- convert for comparison
        nbbo_ts_ns = ts_ms * 1_000_000
        age_ns = abs(evt.first_ts_ns - nbbo_ts_ns)
        if age_ns > NBBO_STALENESS_NS:
            continue
        side = _classify_side(evt.avg_price, nbbo)
        if side:
            evt.side = side
            classified += 1
    _state["last_side_lookup_size"] = len(events)
    _state["last_side_lookup_classified"] = classified


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

        if stocks:
            csv_str = _events_to_csv(stocks, "stocks",
                                     ticker_meta=ticker_meta, oi_map=oi_stocks)
            result = db.insert_csv(csv_str, source="stocks")
            _state["events_written_stocks"] += result.get("inserted", 0)
            if result.get("skipped", 0):
                logger.debug(
                    "[massive-ws] stocks: %d inserted, %d skipped (dupes)",
                    result["inserted"], result.get("skipped", 0),
                )

        if indexes:
            csv_str = _events_to_csv(indexes, "indexes",
                                     ticker_meta=ticker_meta, oi_map=oi_indexes)
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

                # 3. Subscribe
                await ws.send(json.dumps({
                    "action": "subscribe",
                    "params": MASSIVE_WS_SUBSCRIBE,
                }))
                sub_resp = await asyncio.wait_for(ws.recv(), timeout=10)
                logger.info("[massive-ws] sub: %s", sub_resp[:200])

                # 4. Drain forever -- message loop alongside a periodic flusher
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

    flusher_task = asyncio.create_task(flusher())
    q_mgr_task = asyncio.create_task(q_subscription_manager())

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
