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
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, date, timedelta
from io import StringIO
from typing import Optional

# Dedicated single-worker executor for FlowDB writes (2026-07-07). Writes run
# here — NOT the default asyncio executor — so (a) they're serialized in ONE
# thread (never two concurrent FlowDB writers) and (b) they don't compete with
# the OI-persist / color-refresh / spot offloads on the default pool. Paired
# with the async write-queue in _run_session: the flusher enqueues small 2s
# batches without blocking, this thread drains them continuously, so the tape
# stays real-time while the event loop never stalls on the write.
_WRITE_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="massive-write")
_WRITE_QUEUE_MAX = int(os.environ.get("MASSIVE_WRITE_QUEUE_MAX", "2000"))

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

# Minimum gap between ANY two connection attempts -- clean close OR error.
# Massive support guidance: leave 10-30s between reconnections so their
# server fully reaps the old session before a new one arrives; reconnecting
# into a still-counted session trips max_connections. We take the high end.
# Module-level + env-tunable so unit tests and after-hours smokes can shrink
# it, and ops can raise it (e.g. to 45) without a code change.
MIN_RECONNECT_GAP = float(os.environ.get("MASSIVE_MIN_RECONNECT_GAP", "30"))

# max_connections backoff ladder -- replaces the old blind 600s cooldown.
# Strike count resets ONLY on auth_success. While process uptime is under
# MAXCONN_YOUNG_UPTIME_SEC (i.e. right after a deploy), the cooldown is
# capped at MAXCONN_YOUNG_CAP_SEC: a young process's max_connections is
# almost always the 10-30s zombie-session overlap from the deploy handoff,
# not a real lockout -- sleeping 600s there is 10 minutes of lost tape.
# NOTE: no rung and no cap is ever below 30s (Massive 10-30s guidance).
MAXCONN_LADDER = (30.0, 60.0, 120.0, 300.0, 600.0)
MAXCONN_YOUNG_UPTIME_SEC = float(os.environ.get("MASSIVE_MAXCONN_YOUNG_UPTIME", "900"))
MAXCONN_YOUNG_CAP_SEC = float(os.environ.get("MASSIVE_MAXCONN_YOUNG_CAP", "60"))


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
    # Graceful-stop plumbing (2026-07-06 deploy-survival patch). Captured by
    # _consumer_root() at thread start; consumed by stop(). NOT JSON-
    # serializable -- get_status() strips them (like "thread").
    "loop": None,            # asyncio loop owned by the consumer thread
    "root_task": None,       # root Task wrapping _consume_forever
    "stop_requested": False, # set by stop(); guards against double-cancel
    # Reconnect-discipline telemetry (post-deploy verification via /status)
    "maxconn_strikes": 0,     # consecutive max_connections since last auth_success
    "last_cooldown_sec": None, # duration of the most recent reconnect sleep
    "clean_reconnects": 0,     # sessions that ended with a clean close (e.g. watchdog 1001)
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
    # Subscribe-lag recovery (2026-07-11): fast-path subscribe + post-NBBO
    # reclassification. Success = reclassified_total climbing during RTH while
    # last_side_classified_tick / no_signal shrink on first-burst contracts.
    "reclassify_buffer_size": 0,     # tick/empty prints currently buffered for retry
    "reclassified_total": 0,         # cumulative rows whose Side was recovered via NBBO re-pass
    "last_reclassify_count": 0,      # rows recovered in the most recent re-pass
    "fast_path_subscribes": 0,       # cumulative new contracts fast-path-subscribed on first big print
    # Phase 2f: on-demand OI fetch via Schwab
    "oi_fetch_queue_size": 0,        # contracts pending on-demand fetch
    "oi_fetch_batches_sent": 0,      # cumulative Schwab batch calls
    "oi_fetch_contracts_resolved": 0, # contracts where Schwab returned OI > 0
    "oi_fetch_contracts_unresolved": 0, # contracts where Schwab returned no data
    # Phase 3: retroactive spot backfill on startup — fills blank Spot on
    # today's rows written by prior worker processes that died before
    # the async spot fetcher could resolve their symbols. See
    # backfill_stranded_spots() at end of file for details.
    "last_spot_backfill": None,      # {symbols_scanned, symbols_resolved, rows_updated, ...}
}


# Phase 2c: NBBO table and Q subscription pool (in-memory, per-session).
# Cleared on disconnect -- rebuilt over the first ~10 min of market activity
# after each reconnect. Lifetime is the WebSocket session.
_nbbo_table: dict = {}        # {contract_sym: (bid, ask, ts_ms)}
_q_subscribed: set = set()    # contract syms we're currently subscribed to Q for
_q_last_seen: dict = {}       # {contract_sym: ts_ns} - LRU tracking
_q_cumulative_premium: dict = {}  # {contract_sym: int premium} — value-weighted eviction priority.
                                  # Added in the SWEEP Side-classification fix (7/7): pure LRU
                                  # drops big-flow contracts when they briefly quiet down, which
                                  # is exactly when we need NBBO on the next burst. Sorting
                                  # eviction candidates by (cumulative_premium ASC, last_seen ASC)
                                  # keeps institutional-signal contracts sticky within the 950
                                  # slot budget, since Massive's 1000-cap prevents pool expansion.
_q_pending_subscribe: list = []   # queued contracts to subscribe (added by event loop)
_q_pending_unsubscribe: list = [] # queued contracts to unsubscribe (LRU evictions)

# 7/8: Q pool event log — persists subscribe/unsubscribe events to flow.db so
# we can retroactively answer "was contract X in the pool at time T?" This is
# diagnostic-only: it doesn't change subscription behavior. Added after 7/7
# analysis showed the raw OPRA had abundant prints for VRT/ORCL/MSFT gaps
# (all $2M+ notional), meaning the loss was Q pool coverage. Without this
# log we can't distinguish "wasn't subscribed at print time" from other
# causes for future gaps.
#
# Buffered in-memory to keep the event loop lock-free; flushed to flow.db in
# batches by a dedicated background task. Table is created lazily on first
# flush (idempotent CREATE TABLE IF NOT EXISTS).
_q_pool_event_log: list = []  # [(ts_unix, action, occ, reason, pool_size_after, evicted_for)]
_Q_POOL_LOG_MAX_BUFFER = 5000  # drop oldest if writer falls behind — diagnostic, not authoritative


def _log_q_event(action: str, occ: str, reason: str = None,
                 pool_size_after: int = None, evicted_for: str = None) -> None:
    """Append a Q pool subscription event to the in-memory buffer.

    action: 'sub' | 'unsub' | 'warmstart'
    occ:    OCC symbol (e.g. 'O:VRT260821P00330000')
    reason: 'demand' | 'eviction' | 'startup' | 'session_reset'
    pool_size_after: len(_q_subscribed) after this event applied
    evicted_for: if action='unsub' and reason='eviction', the OCC that took this slot

    Hot-path call — must not do I/O or acquire locks. Just appends to a list.
    Background task drains and writes to flow.db.
    """
    entry = (time.time(), action, occ, reason, pool_size_after, evicted_for)
    _q_pool_event_log.append(entry)
    # Cap the buffer so a stalled writer can't grow it unboundedly. Drop
    # oldest since newer events are more diagnostically valuable.
    if len(_q_pool_event_log) > _Q_POOL_LOG_MAX_BUFFER:
        del _q_pool_event_log[:len(_q_pool_event_log) - _Q_POOL_LOG_MAX_BUFFER]

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
# 2026-07-16: raised 5s -> 30s. Measured against Massive's REST quotes API
# (real ground truth, no 950-slot cap) across 4 runs on 7/15-7/16:
#
#   31-57% of prints had NO quote within 5s. Those fell to the tick test,
#   which INVENTS a direction. A slightly stale book beats an invented one.
#
#   Proof: SNDK 7/24 $1310P, 15:33:09 ET. NBBO was 23s old but STABLE
#   (120.00/122.10). Price 119.61 = below bid = BB, independently confirmed by
#   the reference tape (234@119.615_BB). Live rejected the quote for age, fell
#   to the tick test, stamped "A", and fired ALPHA GOLD BULL on a contract with
#   ~$25M of puts being SOLD. The stale quote had the right answer all along.
#
# The 5s rule was written to prevent stale-book misclassification, but the
# fallback it triggers is worse than the staleness it prevents. 30s is a
# compromise: still rejects genuinely dead books, keeps the stable ones.
# Watch last_side_fresh_nbbo vs last_side_have_nbbo in /side-method-stats.
NBBO_STALENESS_NS = 30_000_000_000  # 30s (was 5s; 60s before the Phase 1 audit)


# ── Subscribe-lag recovery (2026-07-11) ────────────────────────────
# A brand-new contract subscribes to Q only AFTER it emits an event, and the
# subscribe fires on the manager's 5s cadence -- so its FIRST burst (usually the
# accumulation start, the prints that matter most) is classified with no NBBO.
# Those prints fall to the tick test, which inverts in a fast tape (it only knows
# "printed below the last trade", not "above the ask"), or stay empty. Two fixes:
#
#   1. Fast-path subscribe: when an unsubscribed contract's print clears a
#      premium bar, wake the subscription manager immediately instead of waiting
#      up to 5s, so NBBO starts flowing ASAP and the rest of the burst gets
#      Tier-1 classified. Rides the SAME 950-cap eviction path, so it adds no
#      pool pressure -- it only reduces latency.
#   2. Post-NBBO reclassification: buffer each tick/empty print, and once its
#      NBBO history has filled in, re-run _classify_side over it and overwrite
#      the already-written flow.db row IN PLACE (the live tape polls flow.db, so
#      a DB update propagates everywhere on the next poll -- no SSE correction).
#      Idempotent + only overwrites tick/empty sides, never an NBBO one.
RECLASSIFY_ENABLED = os.environ.get("MASSIVE_RECLASSIFY_ENABLED", "1") == "1"
FAST_PATH_ENABLED = os.environ.get("MASSIVE_FAST_PATH_ENABLED", "1") == "1"
# Premium bar a NEW contract's print must clear to fast-path its subscribe.
# Well above MIN_PREMIUM ($10K) so only genuine institutional first-prints wake
# the manager early -- a busy open shouldn't fast-path everything.
FAST_PATH_PREMIUM = float(os.environ.get("MASSIVE_FAST_PATH_PREMIUM", "50000"))
# How often the reclassification re-pass runs. Short enough to recover within
# the NBBO lag window (a few seconds after fast-path subscribe fills NBBO).
RECLASSIFY_INTERVAL_SEC = float(os.environ.get("MASSIVE_RECLASSIFY_INTERVAL", "3.0"))
# Bounded, memory-only buffer of tick/empty prints awaiting NBBO. Each entry is
# a dict(dedup_key, sym, ts_ns, avg_price, side, buffered_at). Near-real-time
# recovery within the lag window -- NOT an EOD batch. Prints whose NBBO never
# arrives expire silently (best-effort, expected). Bound + TTL keep it small.
_RECLASSIFY_BUFFER: deque = deque()
_RECLASSIFY_BUFFER_MAX = int(os.environ.get("MASSIVE_RECLASSIFY_BUFFER_MAX", "5000"))
_RECLASSIFY_TTL_SEC = float(os.environ.get("MASSIVE_RECLASSIFY_TTL", "60"))
# Set by _queue_q_subscriptions_for_events (on the loop) to wake the subscription
# manager for a fast-path subscribe. Created in _run_session on the consumer loop.
_fast_path_event = None


def _event_dedup_key(evt, source: str) -> str:
    """Rebuild the exact flow.db dedup_key that _write_events will store for this
    event, so post-NBBO reclassification can UPDATE that row later.

    Reuses the SAME two functions the write path uses -- event_to_bbs_row (which
    formats every field as a string) + FlowDB._make_dedup_key -- so the key is
    byte-identical by construction. The dedup key is built only from
    evt-derived fields (date/time/symbol/type/volume/price/cp/strike/expiry/
    premium) and EXCLUDES Side, so enrichment args don't affect it.
    """
    from api.massive_processor import event_to_bbs_row
    from api.flow_db import FlowDB
    row = event_to_bbs_row(evt, source=source)
    return FlowDB._make_dedup_key(row, source)


def _buffer_prints_for_reclassify(events: list) -> None:
    """Queue tick/empty-classified prints for the post-NBBO re-pass.

    Only events whose side was set by the tick test or left unclassified are
    eligible -- an NBBO ("nbbo") side is ground truth and never re-touched.
    Called at the end of _classify_events_side, on the consumer loop (pure
    string work, no I/O).
    """
    if not RECLASSIFY_ENABLED:
        return
    from api.massive_processor import is_index_source
    now = time.time()
    for evt in events:
        if getattr(evt, "side_method", "") not in ("tick", "none"):
            continue
        source = "indexes" if is_index_source(evt.root) else "stocks"
        try:
            key = _event_dedup_key(evt, source)
        except Exception:
            continue  # never let key-building break classification
        _RECLASSIFY_BUFFER.append({
            "dedup_key": key,
            "sym": _reconstruct_occ_symbol(evt.root, evt.expiry, evt.cp, evt.strike),
            "ts_ns": evt.first_ts_ns,
            "avg_price": evt.avg_price,
            "side": evt.side,          # the tick/empty value we wrote; the UPDATE guard
            "buffered_at": now,
        })
    # Bound memory: drop oldest (least likely to still recover) beyond the cap.
    over = len(_RECLASSIFY_BUFFER) - _RECLASSIFY_BUFFER_MAX
    if over > 0:
        for _ in range(over):
            _RECLASSIFY_BUFFER.popleft()
    _state["reclassify_buffer_size"] = len(_RECLASSIFY_BUFFER)


def _collect_reclassifications(now: float) -> list:
    """Walk the reclassify buffer once: recover the sides whose NBBO has filled
    in, expire the ones past TTL, and re-queue the rest for a later pass.

    Returns a list of (dedup_key, new_side, old_side) updates ready to apply.
    Pure CPU + in-memory (reads _NBBO_HISTORY via _nbbo_at); no I/O, no awaits,
    so callers can treat the buffer as consistent across the walk. Extracted
    from reclassify_manager so the recovery logic is unit-testable.
    """
    updates = []
    keep = deque()
    while _RECLASSIFY_BUFFER:
        e = _RECLASSIFY_BUFFER.popleft()
        if now - e["buffered_at"] > _RECLASSIFY_TTL_SEC:
            continue  # aged out -- NBBO never arrived; leave the row as-is
        nbbo = _nbbo_at(e["sym"], e["ts_ns"])
        if nbbo:
            bid, ask, nbbo_ts_ns = nbbo
            age = e["ts_ns"] - nbbo_ts_ns  # >= 0 (_nbbo_at filters)
            if age <= NBBO_STALENESS_NS:
                new_side = _classify_side(
                    e["avg_price"], (bid, ask, nbbo_ts_ns // 1_000_000))
                if new_side and new_side != e["side"]:
                    updates.append((e["dedup_key"], new_side, e["side"]))
                    continue  # recovered -- drop from buffer
        keep.append(e)  # NBBO not ready yet -- retry next cycle (until TTL)
    _RECLASSIFY_BUFFER.extend(keep)
    _state["reclassify_buffer_size"] = len(_RECLASSIFY_BUFFER)
    return updates


def _apply_reclassifications(updates: list) -> int:
    """Apply a batch of Side reclassifications to flow.db. Runs on the shared
    single-worker _WRITE_EXECUTOR (never concurrent with the insert path).
    Returns the number of rows actually updated."""
    if not updates:
        return 0
    from api.flow_db import FlowDB
    return FlowDB().update_sides_by_dedup(updates)


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
    # Non-serializable runtime handles -- never expose via JSON endpoints
    # (/api/live/massive/status would 500 and blind external monitors).
    s.pop("thread", None)
    s.pop("loop", None)
    s.pop("root_task", None)
    if s["started_at"]:
        s["uptime_sec"] = round(time.time() - s["started_at"], 1)
    s["dry_run"] = DRY_RUN
    s["enabled"] = ENABLED
    s["min_premium"] = MIN_PREMIUM
    s["min_volume"] = MIN_VOLUME
    s["min_reconnect_gap"] = MIN_RECONNECT_GAP
    s["graceful_stop"] = True  # feature-detect for monitors / smoke checks
    return s


# -- Event handling -------------------------------------------------

# Stage-2 fallback result cache: contract_key -> (oi_or_None, cached_at).
# Hits AND misses cached (misses are the expensive case — see the 2026-07-17
# write-profile note inside _load_oi_for_events). OI moves once daily, so a
# short TTL is safe; the on-demand fetch pipeline still upgrades misses via
# Stage 1 on later batches.
_OI_FALLBACK_CACHE: dict = {}
_OI_FALLBACK_TTL = float(os.environ.get("MASSIVE_OI_FALLBACK_CACHE_TTL", "600"))


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
            # contract_oi_snapshots moved to its own DB (2026-07-17) — attach so
            # the Stage-1 query below resolves it; Stage 2 still hits flow (main).
            try:
                from api.oi_snapshots import attach_oi_snapshots
                attach_oi_snapshots(conn)
            except Exception:
                pass
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

            # Stage 2: flow table fallback for events that missed.
            #
            # 2026-07-17 write-profile finding: this stage was 86,688ms of an
            # 88,734ms batch — up to 3 ORDER-BY-id-DESC probes PER EVENT
            # against flow, re-run EVERY batch for contracts with no OI
            # anywhere (fresh weeklies scan the whole table and miss again 2s
            # later). Two rails fix it: idx_flow_contract (created at
            # flow-worker boot) makes each probe an index seek, and a 10-min
            # result cache (hits AND misses) skips repeat probes entirely.
            _now_cache = time.time()
            unresolved = []
            for k, i, e in keys_and_idx:
                if i in out:
                    continue
                _hit = _OI_FALLBACK_CACHE.get(k)
                if _hit is not None and (_now_cache - _hit[1]) < _OI_FALLBACK_TTL:
                    if _hit[0]:
                        out[i] = _hit[0]
                else:
                    unresolved.append((k, i, e))
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
                    # Cache the outcome either way — a miss cached is a
                    # full-probe skipped on every batch for the next 10 min.
                    _OI_FALLBACK_CACHE[key] = (out.get(i), _now_cache)
                if len(_OI_FALLBACK_CACHE) > 30000:
                    _cut = _now_cache - _OI_FALLBACK_TTL
                    for _k in [_k for _k, _v in _OI_FALLBACK_CACHE.items()
                               if _v[1] < _cut]:
                        _OI_FALLBACK_CACHE.pop(_k, None)
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

    # WRITE-LOOP SAFETY (2026-07-16, the SECOND _load_er_flags-class fix; see
    # also _load_cumulative_volume's 7/9 note — same disease, third organ):
    # this runs on EVERY batch with NO cache, and the MAX(id) GROUP BY walked
    # each symbol's ENTIRE history TWICE (MktCap + Sector). Per-batch cost grew
    # with the table — the deploy-free day-over-day lag creep (Mon 4s → Wed
    # 18s). MktCap/Sector move on earnings timescales: cache 24h + bounded
    # newest-row lookups (rides idx_flow_symbol_created).
    now = time.time()
    out: dict = {}
    to_fetch = []
    for sym in clean:
        entry = _META_CACHE.get(sym)
        if entry and (now - entry[1]) < _META_TTL_SEC:
            if entry[0]:
                out[sym] = dict(entry[0])
        else:
            to_fetch.append(sym)
    if not to_fetch:
        return out

    try:
        with sqlite3.connect(db.db_path, timeout=10) as conn:
            for sym in to_fetch:
                meta = {}
                row = conn.execute(
                    "SELECT MktCap FROM flow WHERE Symbol = ? "
                    "AND MktCap IS NOT NULL AND MktCap != '' AND MktCap != '0' "
                    "ORDER BY rowid DESC LIMIT 1", (sym,)).fetchone()
                if row:
                    try:
                        mc = int(float((row[0] or "0").strip()))
                        if mc > 0:
                            meta["mktcap"] = mc
                    except (ValueError, TypeError):
                        pass
                row = conn.execute(
                    "SELECT Sector FROM flow WHERE Symbol = ? "
                    "AND Sector IS NOT NULL AND Sector != '' "
                    "ORDER BY rowid DESC LIMIT 1", (sym,)).fetchone()
                if row and (row[0] or "").strip():
                    meta["sector"] = row[0].strip()
                _META_CACHE[sym] = (meta, now)
                if meta:
                    out[sym] = dict(meta)
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
        # Default classification method; overwritten to "nbbo"/"tick" on success.
        # Left as "none" => no NBBO and no tick signal (eligible for the re-pass).
        evt.side_method = "none"
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
                    evt.side_method = "nbbo"
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
                    # NBBO said "no aggressor" -- a ground-truth empty. Tag it
                    # "nbbo" so post-NBBO reclassification never overwrites it.
                    evt.side_method = "nbbo"
                    nbbo_classified = True

        # ====== TIER 2: Tick test fallback ======
        # Only runs if NBBO didn't classify (missing, stale, or never set).
        # Mid-market trades fall through to tick test (mid-market fix).
        #
        # Phase 2i: Use RAW T print history instead of event-to-event prices.
        # We bisect into _RAW_T_HISTORY to find the last raw print BEFORE
        # this event's first timestamp -- that's the "previous tick" for
        # ── TICK TEST REMOVED (2026-07-16) ────────────────────────────────
        # Was: walk _RAW_T_HISTORY back for the last price before the event,
        # then  diff_pct > 0.5 -> "A"  /  diff_pct < -0.5 -> "B".
        #
        # WHY IT'S GONE: it SATURATES. In a stacked-bid uptrend every seller
        # hitting the rising bid prints higher than the last trade, so the test
        # stamps "A" on prints that were bid-side. It cannot distinguish "above
        # the ask" from "next print up the ladder" -- it never sees the book at
        # all. The 6/29 Phase 1 audit caught exactly this and removed AA/BB from
        # this path, but A/B carries the identical flaw and was left in.
        #
        # MEASURED (Massive REST quotes as ground truth, 7/15-7/16, 4 runs over
        # alpha+size, both live and post-heal):
        #   - ZERO direction flips originated from the NBBO path.
        #   - Every confirmed flip originated HERE.
        #   - SNDK 7/24 $1310P: true BB (below bid), tick test said A,
        #     fired ALPHA GOLD BULL on a contract with ~$25M of puts SOLD.
        #
        # The tick test does not fill coverage gaps -- it launders ignorance
        # into confidence, and the curated tiers then treat that confidence as
        # signal. A blank Side is dropped by the gates, which is the correct
        # outcome for a print we genuinely cannot classify.
        #
        # NOTE: this only helps if thresholds.sweep_empty_side_as_ask is FALSE.
        # Otherwise blank-side SWEEPs get presumed ASK downstream in
        # _derive_direction and the same wrong answer comes out the far end.
        #
        # classified_tick stays in _state deliberately: it should now read 0 on
        # /side-method-stats, which is how we confirm this is live.
        if not nbbo_classified:
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

    # Subscribe-lag recovery: queue the tick/empty prints so the reclassify
    # re-pass can upgrade their Side once NBBO fills in for the contract.
    _buffer_prints_for_reclassify(events)


def _queue_q_subscriptions_for_events(events: list) -> None:
    """Phase 2c: enqueue Q subscriptions for contracts that emitted events
    but aren't yet in our subscription pool.

    Eviction policy (7/7 revision): PREMIUM-WEIGHTED LRU.
    Pure LRU dropped contracts by recency alone, which meant a $10K sweep
    would keep its slot while a $5M sweep from 30 minutes ago got evicted.
    Since NBBO coverage on the next burst is what determines Side
    classification, evicting big-flow contracts is the opposite of what we
    want. Revised eviction sorts candidates by
    (cumulative_premium ASC, last_seen_ns ASC) — smallest total premium
    leaves first; recency is the tiebreaker for equally-quiet contracts.
    Contracts that emitted a big event stay sticky within the 950 slot
    budget (Massive hard-caps at 1000 per connection).

    The actual subscribe/unsubscribe WS messages are sent by the
    q_subscription_manager task on its 5-second cadence -- we just queue
    here so we don't block the flusher on network I/O.

    Fast-path (2026-07-11): when a NEW contract's print clears FAST_PATH_PREMIUM
    we still queue it the same way (same 950-cap eviction, no pool pressure), but
    signal the manager to drain NOW instead of on its 5s tick -- so NBBO starts
    flowing within ~1 tick and the rest of that first burst gets Tier-1 classified.
    """
    fast_path_wanted = False  # a big NEW contract was queued this flush
    for evt in events:
        sym = _reconstruct_occ_symbol(evt.root, evt.expiry, evt.cp, evt.strike)
        try:
            premium_i = int(evt.premium or 0)
        except (TypeError, ValueError):
            premium_i = 0
        # Track cumulative premium for every emitted event, whether the
        # contract is already subscribed or not. This keeps eviction priority
        # in sync with actual institutional-flow value across the session.
        _q_cumulative_premium[sym] = _q_cumulative_premium.get(sym, 0) + premium_i
        # Already subscribed (or pending) -- nothing more to do
        if sym in _q_subscribed or sym in _q_pending_subscribe:
            continue
        is_big = FAST_PATH_ENABLED and premium_i >= FAST_PATH_PREMIUM
        # Room in the pool -- queue subscribe directly
        if len(_q_subscribed) + len(_q_pending_subscribe) < MAX_Q_SUBSCRIPTIONS:
            _q_pending_subscribe.append(sym)
            if is_big:
                fast_path_wanted = True
                _state["fast_path_subscribes"] += 1
            continue
        # Pool full -- evict lowest-premium contract (recency tiebreaker)
        # that isn't itself pending eviction. This preserves NBBO coverage
        # on institutional-signal contracts even when they briefly quiet.
        candidates = [(s,
                       _q_cumulative_premium.get(s, 0),
                       _q_last_seen.get(s, 0))
                      for s in _q_subscribed
                      if s not in _q_pending_unsubscribe]
        if not candidates:
            # Everything is already pending eviction -- skip and try next flush
            continue
        candidates.sort(key=lambda kv: (kv[1], kv[2]))  # premium ASC, then LRU
        evict_sym = candidates[0][0]
        _q_pending_unsubscribe.append(evict_sym)
        _q_pending_subscribe.append(sym)
        if is_big:
            fast_path_wanted = True
            _state["fast_path_subscribes"] += 1

    # Wake the subscription manager immediately for a big new contract so its
    # NBBO starts flowing ASAP (else it waits up to the 5s cadence). Idempotent
    # -- the manager clears the event when it drains. Loop-safe: this runs in the
    # flusher on the consumer loop, same loop that owns the Event.
    if fast_path_wanted and _fast_path_event is not None:
        _fast_path_event.set()


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
    # 7/7 revision: order by SUM(Premium) instead of SUM(Volume). Volume
    # favors penny options with lots of size but low institutional value.
    # Premium is a direct proxy for the alerts we actually surface, so the
    # warm-start pool now allocates its 950 slots to contracts historically
    # more likely to emit big-flow events. Same slot budget, better priors.
    sql = f"""
        SELECT Symbol, CallPut, Strike, ExpirationDate,
               SUM(CAST(Premium AS INTEGER)) AS total_prem
        FROM flow
        WHERE CreatedDate IN ({placeholders})
          AND Symbol IS NOT NULL AND Symbol != ''
          AND CallPut IN ('CALL', 'PUT')
          AND Strike IS NOT NULL AND Strike != ''
          AND ExpirationDate IS NOT NULL AND ExpirationDate != ''
          AND Premium IS NOT NULL AND Premium != '' AND Premium != '0'
        GROUP BY Symbol, CallPut, Strike, ExpirationDate
        ORDER BY total_prem DESC
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
    for sym, cp, strike_str, exp_str, _prem in rows:
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
# MEMORY-LEAK FIX (2026-07-17, Ravi's find): both _NBBO_HISTORY and _nbbo_table
# are dicts that grew ONE entry per contract EVER subscribed all session and
# were only .clear()'d at teardown. The per-contract deque is bounded, but the
# DICT is not — at pool churn that's tens of thousands of contracts, ~100 MB/min
# monotonic. Today's 20 restarts were an accidental GC; with the tape now stable
# a clean 6.5h Monday session projected ~39 GB vs a 32 GB ceiling ~2:30-3:00 PM ET.
# Fix: (1) evict a contract's NBBO state when it leaves the Q-pool [primary], and
# (2) a backstop sweep that drops entries no longer in _q_subscribed when the map
# exceeds this cap [catches in-flight quotes for just-unsubscribed contracts].
_NBBO_CONTRACTS_MAX = int(os.environ.get("MASSIVE_NBBO_CONTRACTS_MAX", "2500"))


def _evict_dead_nbbo() -> None:
    """Drop NBBO state for contracts no longer subscribed. O(n) but only runs
    when the map exceeds _NBBO_CONTRACTS_MAX — the Q-pool caps at ~950, so this
    fires only on straggler buildup, and the survivors are exactly the live
    pool. Never touches subscribed contracts' history."""
    if len(_NBBO_HISTORY) <= _NBBO_CONTRACTS_MAX:
        return
    dead = [s for s in _NBBO_HISTORY if s not in _q_subscribed]
    for s in dead:
        _NBBO_HISTORY.pop(s, None)
        _nbbo_table.pop(s, None)
    if dead:
        logger.info("[massive-ws] NBBO map trim: evicted %d unsubscribed "
                    "contracts (now %d tracked)", len(dead), len(_NBBO_HISTORY))


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


def _tape_spool(msg) -> None:
    """Raw-frame spool hook for the receive loop. Lazy-bound + total —
    the tape must never depend on the spool module importing/working."""
    global _tape_spool_fn
    try:
        if _tape_spool_fn is None:
            from api.flow_tape_spool import spool_frame as _fn
            _tape_spool_fn = _fn
        _tape_spool_fn(msg)
    except Exception:
        pass


_tape_spool_fn = None

# MktCap/Sector cache for _load_ticker_metadata (2026-07-16 write-loop fix —
# same class as _ER_CACHE). {symbol: ({'mktcap':..,'sector':..}, fetched_at)}
_META_CACHE: dict = {}
_META_TTL_SEC = 24 * 60 * 60    # metadata moves on earnings timescales


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

    # Query FlowDB for the most recent ER value per symbol. ER comes in as
    # 'T' or 'F' (BBS uses single-char codes for boolean flags).
    #
    # WRITE-LOOP SAFETY (2026-07-16 open-freeze fix): this runs INSIDE the
    # consumer's classify path. The old unbounded per-symbol query pulled a
    # symbol's ENTIRE history and date-parsed it in Python — after any boot
    # (cold cache) the first batches at the open scanned full SPY/QQQ-class
    # histories and stalled the writer for minutes. Bounded LIMIT queries only.
    #
    # COHORT PREFERENCE (review A2): T+1 heals used to insert backfill rows
    # with a hardcoded ER='F' at HIGHER rowids than the live rows, so a naive
    # "newest row" read returned a poisoned 'F' for symbols whose latest rows
    # are backfill. The hazard is the hardcoded VALUE on backfill rows (now
    # also fixed at the builders), not cache drift. Prefer the newest row
    # whose insert date matches its trade date (live-captured); fall back to
    # the newest row otherwise. LIMIT 20 keeps it bounded either way.
    try:
        import sqlite3
        from api.flow_db import FlowDB
        db = FlowDB()
        with sqlite3.connect(db.db_path, timeout=10) as conn:
            for sym in to_fetch:
                rows = conn.execute(
                    "SELECT ER, CreatedDate, substr(created_at, 1, 10) "
                    "FROM flow WHERE Symbol = ? "
                    "AND ER IS NOT NULL AND TRIM(ER) != '' "
                    "ORDER BY rowid DESC LIMIT 20", (sym,)).fetchall()
                er_raw = rows[0][0] if rows else 'F'
                for er, cdate, idate in rows:
                    if _same_cohort(cdate, idate):
                        er_raw = er
                        break
                er_val = 'T' if (er_raw or 'F').strip().upper() == 'T' else 'F'
                out[sym] = er_val
                _ER_CACHE[sym] = (er_val, now)
    except Exception as e:
        logger.warning("[massive-ws] ER flag lookup failed: %s", e)
        for sym in to_fetch:
            out.setdefault(sym, 'F')

    return out


def _same_cohort(created_date_mdy, insert_date_iso) -> bool:
    """True when a row's insert date is the same (or next, for post-8pm-ET
    UTC rollover) day as its trade date — i.e. live-captured, not backfill."""
    try:
        m, d, y = (created_date_mdy or "").split("/")
        trade = _dt_date(int(y), int(m), int(d))
        yy, mm, dd = (insert_date_iso or "").split("-")
        ins = _dt_date(int(yy), int(mm), int(dd))
        return 0 <= (ins - trade).days <= 1
    except (ValueError, AttributeError):
        return False


from datetime import date as _dt_date  # noqa: E402  (helper import for _same_cohort)


PREWARM_ROWID_WINDOW = int(os.environ.get("MASSIVE_PREWARM_ROWID_WINDOW", "5000000"))
PREWARM_STAGGER_SEC = float(os.environ.get("MASSIVE_PREWARM_STAGGER_SEC", "75"))


def prewarm_er_cache() -> int:
    """One bounded pass that fills _ER_CACHE for every symbol seen recently,
    so the consumer's write loop never pays a cold ER lookup at the market
    open. Runs in a daemon thread at consumer start, OFF the write path.

    Review A10: staggered past boot (so it doesn't pile onto boot ingest +
    integrity checks) and bounded to the newest PREWARM_ROWID_WINDOW rows —
    three unbounded GROUP BY scans of a multi-GB table on every watchdog
    restart was its own IO storm. Review A2: rows whose newest entry is
    backfill-cohort are SKIPPED (their hardcoded flags may be wrong); the
    per-symbol cohort-aware lookup covers them on first use."""
    try:
        time.sleep(PREWARM_STAGGER_SEC)
        import sqlite3
        from api.flow_db import FlowDB
        db = FlowDB()
        now = time.time()
        with sqlite3.connect(db.db_path, timeout=15) as conn:
            floor = max(0, (conn.execute("SELECT COALESCE(MAX(rowid),0) FROM flow")
                            .fetchone()[0] or 0) - PREWARM_ROWID_WINDOW)
            rows = conn.execute(
                "SELECT Symbol, ER, CreatedDate, substr(created_at,1,10) "
                "FROM flow WHERE rowid IN ("
                "  SELECT MAX(rowid) FROM flow "
                "  WHERE rowid >= ? AND ER IS NOT NULL AND TRIM(ER) != '' "
                "  GROUP BY Symbol)", (floor,)).fetchall()
        seeded = 0
        for sym, er, cdate, idate in rows:
            if not sym or not _same_cohort(cdate, idate):
                continue
            er_clean = (er or 'F').strip().upper()
            _ER_CACHE.setdefault(sym, ('T' if er_clean == 'T' else 'F', now))
            seeded += 1
        logger.info("[massive-ws] ER cache prewarmed: %d symbols (%d skipped as backfill-cohort)",
                    seeded, len(rows) - seeded)

        # MktCap/Sector prewarm (same rationale): one boot-time pass instead
        # of per-batch history walks. Newest non-blank row per symbol, same
        # rowid floor (A10). No cohort filter needed: backfill builders copy
        # metadata forward correctly, so those values aren't poisoned.
        meta: dict = {}
        with sqlite3.connect(db.db_path, timeout=15) as conn:
            for sym, mc in conn.execute(
                    "SELECT Symbol, MktCap FROM flow WHERE rowid IN ("
                    "  SELECT MAX(rowid) FROM flow WHERE rowid >= ? "
                    "  AND MktCap IS NOT NULL "
                    "  AND MktCap != '' AND MktCap != '0' GROUP BY Symbol)",
                    (floor,)):
                try:
                    v = int(float((mc or "0").strip()))
                    if sym and v > 0:
                        meta.setdefault(sym, {})["mktcap"] = v
                except (ValueError, TypeError):
                    pass
            for sym, sec in conn.execute(
                    "SELECT Symbol, Sector FROM flow WHERE rowid IN ("
                    "  SELECT MAX(rowid) FROM flow WHERE rowid >= ? "
                    "  AND Sector IS NOT NULL "
                    "  AND Sector != '' GROUP BY Symbol)", (floor,)):
                if sym and (sec or "").strip():
                    meta.setdefault(sym, {})["sector"] = sec.strip()
        now2 = time.time()
        for sym, m in meta.items():
            _META_CACHE.setdefault(sym, (m, now2))
        logger.info("[massive-ws] metadata cache prewarmed: %d symbols", len(meta))
        return seeded
    except Exception as e:
        logger.warning("[massive-ws] ER prewarm failed (non-fatal): %s", e)
        return 0


def _load_spot_for_events(events: list) -> dict:
    """Phase 2b: synchronous spot lookup with background fetch queue.

    For each unique symbol in the batch:
    - If cached, return the cached value (even if past TTL — slightly
      stale spot is OK for moneyness, but null spot leaves SPOT and
      %ITM/OTM columns blank in the UI which was breaking repeat-fire
      visibility, fix added 6/30 evening)
    - If cache is stale (past TTL), ALSO queue for refresh so the next
      batch gets a fresher value
    - If no cache at all, queue for fetch and omit from output (the
      "first event on a brand-new symbol" case — caller treats as spot=0)

    Returns {symbol: spot_price}. Symbols with no cache at all are omitted.
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
        if cached:
            # Always use cached spot, even if past TTL. The underlying
            # stock price doesn't move much in a few minutes; better to
            # show slightly stale value than null.
            out[sym] = cached[0]
            cache_age = now - cached[1]
            if cache_age >= _SPOT_TTL_SEC:
                # Past TTL -- queue refresh so subsequent batches see
                # a fresher value. Doesn't block this batch.
                if sym and not sym[-1].isdigit() and sym not in _spot_fetch_seen:
                    _spot_fetch_queue.append(sym)
                    _spot_fetch_seen.add(sym)
        else:
            # No cache at all -- queue for fetch
            if sym and not sym[-1].isdigit() and sym not in _spot_fetch_seen:
                _spot_fetch_queue.append(sym)
                _spot_fetch_seen.add(sym)
    _state["last_spot_lookup_size"] = len({e.root for e in events if e.root})
    _state["last_spot_lookup_resolved"] = len(out)
    _state["spot_fetch_queue_size"] = len(_spot_fetch_queue)
    return out


# In-memory day-volume counters (2026-07-17 final cumvol fix): the per-batch
# SQL aggregation re-scans ALL of today's rows every batch (CAST per row), a
# FIXED ~1s-per-15k-rows cost that grew to 11-13s/batch by afternoon — batch
# size irrelevant. Seed ONCE per (boot, date) with the same grouped query,
# then maintain counts in memory (the writer is single-threaded by design:
# single consumer + 1-worker executor). Restart → reseed from DB, so counts
# never drift from what's actually persisted.
_CUMVOL_STATE: dict = {"date": None, "counts": None}
_CUMVOL_SEED_LOCK = threading.Lock()
_cumvol_seeding_date = {"date": None}  # guards against double-seed


def _kick_cumvol_seed(trade_date_mdY: str) -> None:
    """Fire a ONE-SHOT background thread that folds the pre-boot day-to-date
    volume into the live counters. Never blocks the writer. Idempotent per
    date. Adds to (never overwrites) the live-maintained counts so volume the
    writer accrued while the seed ran is preserved."""
    if _cumvol_seeding_date["date"] == trade_date_mdY:
        return
    _cumvol_seeding_date["date"] = trade_date_mdY

    def _run():
        import sqlite3
        counts_from_db = {}
        try:
            from api.flow_db import FlowDB
            t0 = time.perf_counter()
            with sqlite3.connect(FlowDB().db_path, timeout=30) as conn:
                _sql = ("SELECT Symbol, CallPut, Strike, ExpirationDate, "
                        "COALESCE(SUM(CAST(Volume AS INTEGER)),0) "
                        "FROM flow INDEXED BY idx_flow_created_symbol "
                        "WHERE CreatedDate=? "
                        "GROUP BY Symbol, CallPut, Strike, ExpirationDate")
                try:
                    cur = conn.execute(_sql, (trade_date_mdY,))
                except sqlite3.OperationalError:
                    cur = conn.execute(
                        _sql.replace(" INDEXED BY idx_flow_created_symbol", ""),
                        (trade_date_mdY,))
                for r in cur.fetchall():
                    counts_from_db[(r[0], r[1], str(r[2]), r[3])] = int(r[4] or 0)
            # Merge into the live counters under the lock. The DB total already
            # INCLUDES any rows the live writer persisted before this query ran,
            # AND the live counters ALSO accrued those — so overwrite with the
            # DB value (authoritative day-to-date) rather than add (would double
            # count). Rows written AFTER the query but before this merge are the
            # only skew, bounded by the query duration + next heal fixes it.
            with _CUMVOL_SEED_LOCK:
                if _CUMVOL_STATE["date"] == trade_date_mdY and _CUMVOL_STATE["counts"] is not None:
                    _CUMVOL_STATE["counts"].update(counts_from_db)
            logger.info("[massive-ws] cumvol background seed merged: %d "
                        "contracts for %s in %.1fs (tape never blocked)",
                        len(counts_from_db), trade_date_mdY,
                        time.perf_counter() - t0)
        except Exception as e:  # noqa: BLE001
            logger.warning("[massive-ws] cumvol background seed failed "
                           "(live counts stand; heal reconciles): %s", e)

    threading.Thread(target=_run, name="cumvol-seed", daemon=True).start()


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

    # NON-BLOCKING seed (2026-07-17 pt2): the DB seed scans the whole day's
    # rows (~80s at 62k contracts) and MUST NOT run inline — it froze the tape
    # ~115s on the 4:04 restart. Instead the writer maintains counts live from
    # the first event; a one-shot background thread folds in the pre-boot day
    # total when it lands. So the tape NEVER blocks on the seed; the only cost
    # is that batches in the first ~80s slightly UNDER-count cumvol (missing
    # pre-boot volume) → some rows read a lighter color until the seed merges
    # and the nightly heal reconciles. A 115s freeze traded for cosmetic,
    # self-healing imprecision on a restart's first minute.
    st = _CUMVOL_STATE
    if st["date"] != trade_date_mdY:
        # New boot or date rollover: start live counts now, seed in background.
        st["date"] = trade_date_mdY
        st["counts"] = {}
        _kick_cumvol_seed(trade_date_mdY)
    counts = st["counts"]

    # Per event: cumulative = seeded/maintained day total + in-batch running
    # sum; then fold this batch INTO the counters (under the first canonical
    # strike string) so the next batch sees it without any DB round-trip.
    batch_running = {}  # (root, cp, strike, exp_mdy) -> running batch sum
    out = {}
    for i, e in enumerate(events):
        exp_mdy = f"{e.expiry.month}/{e.expiry.day}/{e.expiry.year}"
        key = (e.root, e.cp, e.strike, exp_mdy)
        strike_strs = contracts.get(key) or [str(float(e.strike))]
        day_total = 0
        for ss in strike_strs:
            day_total += counts.get((e.root, e.cp, ss, exp_mdy), 0)
        batch_running[key] = batch_running.get(key, 0) + e.total_size
        out[i] = day_total + batch_running[key]
    for key, added in batch_running.items():
        root, cp, strike, exp_mdy = key
        ss0 = (contracts.get(key) or [str(float(strike))])[0]
        ck = (root, cp, ss0, exp_mdy)
        counts[ck] = counts.get(ck, 0) + added
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

        # Per-pass timing (2026-07-17): the writer sustains ~30 ev/s vs the
        # ~650/s open firehose and nobody knows WHICH enrichment pass eats the
        # time. One INFO line per coalesced batch answers it in production.
        _tp0 = time.perf_counter()

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

        _tp_meta = time.perf_counter()

        # OI enrichment: look up snapshot OI for each event's contract.
        # Powers Color (WHITE/YELLOW/MAGENTA) per BBS rules. Without OI we
        # can't tell if a trade exceeds existing positioning -- everything
        # stays WHITE. Stocks and indexes both have snapshots (SOURCES list
        # in oi_snapshots.py includes both).
        oi_stocks = _load_oi_for_events(stocks) if stocks else {}
        oi_indexes = _load_oi_for_events(indexes) if indexes else {}
        _state["last_oi_lookup_size"] = len(stocks) + len(indexes)
        _state["last_oi_lookup_resolved"] = len(oi_stocks) + len(oi_indexes)

        _tp_oi = time.perf_counter()

        # Phase 2d: cumulative day volume per contract for BBS-style Color.
        # Combined with OI, this drives YELLOW/MAGENTA confirmation. Without
        # this, Color is computed from single-event volume and we sit at
        # ~12% confirmed vs BBS's 51%.
        cum_vol_stocks = _load_cumulative_volume(stocks) if stocks else {}
        cum_vol_indexes = _load_cumulative_volume(indexes) if indexes else {}

        _tp_cum = time.perf_counter()

        # Phase 2b: spot price enrichment. Best-effort -- symbols not in cache
        # get omitted and spot=0 in the row (same as pre-Phase-2b behavior).
        # Symbols queue for background fetch; next batch picks them up.
        spot_stocks = _load_spot_for_events(stocks) if stocks else {}
        spot_indexes = _load_spot_for_events(indexes) if indexes else {}

        _tp_spot = time.perf_counter()

        # Phase 2g: ER flag from FlowDB cache (BBS uploads provide this).
        # Free lookup, no external API.
        all_syms_for_er = list({e.root for e in events})
        er_map = _load_er_flags(all_syms_for_er)

        _tp_er = time.perf_counter()

        if stocks:
            csv_str = _events_to_csv(stocks, "stocks",
                                     ticker_meta=ticker_meta, oi_map=oi_stocks,
                                     cum_vol_map=cum_vol_stocks,
                                     spot_map=spot_stocks, er_map=er_map)
            result = _insert_with_retry(db, csv_str, "stocks")
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
            result = _insert_with_retry(db, csv_str, "indexes")
            _state["events_written_indexes"] += result.get("inserted", 0)
            if result.get("skipped", 0):
                logger.debug(
                    "[massive-ws] indexes: %d inserted, %d skipped (dupes)",
                    result["inserted"], result.get("skipped", 0),
                )

        _tp_ins = time.perf_counter()
        _prof = (
            "[massive-ws] write-profile: n=%d meta=%.0fms oi=%.0fms "
            "cumvol=%.0fms spot=%.0fms er=%.0fms csv+insert=%.0fms total=%.0fms"
            % (len(events),
               (_tp_meta - _tp0) * 1000, (_tp_oi - _tp_meta) * 1000,
               (_tp_cum - _tp_oi) * 1000, (_tp_spot - _tp_cum) * 1000,
               (_tp_er - _tp_spot) * 1000, (_tp_ins - _tp_er) * 1000,
               (_tp_ins - _tp0) * 1000))
        _state["last_write_profile"] = _prof
        logger.info(_prof)

        _state["last_write_ts"] = time.time()
        try:
            from api.flow_watchdog import note_live_insert
            note_live_insert()      # B5: live-lane heartbeat for the watchdog
        except Exception:
            pass
    except Exception as e:
        logger.exception("[massive-ws] DB write failed: %s", e)
        _state["last_error"] = f"db_write: {e}"


def _insert_with_retry(db, csv_str: str, source: str, attempts: int = 3) -> dict:
    """Bounded retry on transient SQLite lock contention (review A7).

    A 'database is locked' here used to be swallowed by _write_events' outer
    except and the WHOLE batch silently vanished — a sub-2-minute hole that
    MIN_GAP_MINUTES=2 gap detection can never see and no heal ever fixes.
    Backups, heals and admin scans all take short write locks; 2 retries with
    backoff ride them out. Exhausted retries increment a VISIBLE counter."""
    last_exc = None
    for i in range(attempts):
        try:
            return db.insert_csv(csv_str, source=source)
        except Exception as e:
            if "locked" not in str(e).lower() and "busy" not in str(e).lower():
                raise
            last_exc = e
            time.sleep(1.0 + i)
    _state["batches_dropped_locked"] = _state.get("batches_dropped_locked", 0) + 1
    logger.error("[massive-ws] %s batch DROPPED after %d locked retries: %s",
                 source, attempts, last_exc)
    raise last_exc


# -- WebSocket consumer ---------------------------------------------

async def _consume_forever():
    """Outer loop: connect, run, reconnect with backoff.

    Reconnect discipline (2026-07-06 deploy-survival patch):
    - EVERY reconnect -- clean session end or error -- waits at least
      MIN_RECONNECT_GAP (30s). Massive's server keeps counting a dead session
      for 10-30s after it drops; reconnecting inside that window trips
      max_connections. The old code slept only in the error path, so a
      watchdog-initiated clean close (code 1001) reconnected with ZERO gap,
      hit max_connections, and fell into a blind 600s cooldown.
    - max_connections uses the MAXCONN_LADDER (30/60/120/300/600s) instead of
      a blind 600s. Strikes reset ONLY on auth_success. While process uptime
      < MAXCONN_YOUNG_UPTIME_SEC the cooldown is capped at
      MAXCONN_YOUNG_CAP_SEC -- a young process's max_connections is deploy-
      handoff overlap, not a real lockout.
    - Exponential backoff for other errors resets ONLY on auth_success
      (unchanged) -- NOT on TCP connect, so a locked-out account is never
      hammered.
    """
    import websockets

    backoff = MIN_RECONNECT_GAP
    MAX_BACKOFF = 120.0
    maxconn_strikes = 0

    while ENABLED:
        try:
            logger.info("[massive-ws] connecting to %s", MASSIVE_OPTIONS_WS_URL)
            async with websockets.connect(
                MASSIVE_OPTIONS_WS_URL,
                ping_interval=20,
                # 2026-07-07: raised 20 -> 45 (env MASSIVE_WS_PING_TIMEOUT). At
                # the busy open the consumer's event loop can stall past 20s on
                # the synchronous DB flush (the "Class B" ping-timeout flapping:
                # keepalive can't be serviced -> 1011 drop -> reconnect -> repeat,
                # losing ~1 min of tape per cycle). A 45s window tolerates the
                # stalls; the 60s stale watchdog remains the backstop for a
                # genuinely dead peer. Proper fix = offload the flush off the
                # loop (deferred, higher-risk).
                ping_timeout=float(os.environ.get("MASSIVE_WS_PING_TIMEOUT", "45")),
                close_timeout=3,   # bound the closing handshake: shutdown and
                                   # watchdog closes must not hang on a dead
                                   # peer (library default is 10s)
                max_size=2**24,  # 16 MB frames; bursts can be large
            ) as ws:
                _state["connected"] = True
                # NOTE: do NOT reset backoff here -- wait for auth_success below

                # 1. Initial status message -- could be "connected" OR an error
                first = await asyncio.wait_for(ws.recv(), timeout=10)
                logger.info("[massive-ws] hello: %s", first[:200])
                # Detect immediate rejection (e.g. max_connections) and fail
                # fast so we don't waste an auth attempt that's guaranteed to
                # be rejected too. Triggers the ladder path below.
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

                # Auth successful -- NOW reset backoff AND the max_connections
                # strike ladder. (Resetting on TCP-open would hammer a locked
                # account; resetting only here is the safe anchor.)
                backoff = MIN_RECONNECT_GAP
                maxconn_strikes = 0
                _state["maxconn_strikes"] = 0

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

            # ---- clean session end (watchdog 1001 / server clean close) ----
            # The async-with has fully closed our side of the socket by the
            # time we get here. Honor the same server-cleanup window as the
            # error path before reconnecting: the old zero-gap loop here is
            # what turned every watchdog close into a max_connections spiral
            # ending in the blind 600s cooldown (7/6 Class B).
            _state["connected"] = False
            _state["clean_reconnects"] += 1
            if not ENABLED:
                break
            _state["last_cooldown_sec"] = MIN_RECONNECT_GAP
            logger.info(
                "[massive-ws] session ended cleanly -- reconnect in %.0fs "
                "(server cleanup window)", MIN_RECONNECT_GAP,
            )
            await asyncio.sleep(MIN_RECONNECT_GAP)

        except asyncio.CancelledError:
            logger.info("[massive-ws] cancelled -- exiting")
            raise
        except Exception as e:
            _state["connected"] = False
            _state["last_error"] = str(e)
            _state["reconnect_count"] += 1

            err_str = str(e)
            if "max_connections" in err_str:
                idx = min(maxconn_strikes, len(MAXCONN_LADDER) - 1)
                sleep_for = MAXCONN_LADDER[idx]
                maxconn_strikes += 1
                _state["maxconn_strikes"] = maxconn_strikes
                uptime = time.time() - (_state.get("started_at") or time.time())
                capped = ""
                if uptime < MAXCONN_YOUNG_UPTIME_SEC and sleep_for > MAXCONN_YOUNG_CAP_SEC:
                    # Deploy-overlap residual: the zombie session dies within
                    # 10-30s server-side; probe again soon instead of eating
                    # a 5-10 minute hole in the tape.
                    sleep_for = MAXCONN_YOUNG_CAP_SEC
                    capped = " [young-process cap]"
                logger.warning(
                    "[massive-ws] max_connections -- cooldown %.0fs%s "
                    "(strike %d, uptime %.0fs)",
                    sleep_for, capped, maxconn_strikes, uptime,
                )
            else:
                sleep_for = backoff
                logger.warning(
                    "[massive-ws] connection error (%s) -- reconnect in %.1fs",
                    e, sleep_for,
                )
                backoff = min(backoff * 2, MAX_BACKOFF)

            _state["last_cooldown_sec"] = sleep_for
            await asyncio.sleep(sleep_for)

    logger.info("[massive-ws] consumer loop exiting (ENABLED=False)")


async def _run_session(ws):
    """Handle one connected session: parse trades, periodic flush, Q subscription pool."""
    global _fast_path_event
    from api.massive_processor import TradeAggregator, RawTrade

    agg = TradeAggregator(min_premium=MIN_PREMIUM, min_volume=MIN_VOLUME)

    # Fast-path subscribe signal -- created fresh on the consumer loop each
    # session so _queue_q_subscriptions_for_events can wake q_subscription_manager
    # the moment a big new contract needs NBBO. (Set-then-clear; loop-owned.)
    _fast_path_event = asyncio.Event()

    # Phase 2c: clear NBBO/subscription state on each session. These don't
    # survive disconnects -- we rebuild over the first few minutes of trading
    # after reconnect. Module-level so the message handler can mutate them.
    _nbbo_table.clear()
    _q_subscribed.clear()
    _q_last_seen.clear()
    _q_cumulative_premium.clear()
    _q_pending_subscribe.clear()
    _q_pending_unsubscribe.clear()
    _state["q_subscribed_count"] = 0
    _state["quotes_received"] = 0

    # Deploy-survival patch: reset the watchdog's staleness anchor for the
    # NEW session. Without this, a fresh session inherits the pre-disconnect
    # last_trade_ts; if the outage exceeded STALE_THRESHOLD_SEC the watchdog
    # kills the brand-new healthy connection on its first 10s check --
    # making the watchdog->reconnect->cooldown loop self-sustaining.
    # None re-arms the watchdog's grace path ("no events yet -- give it time").
    _state["last_trade_ts"] = None

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

    # Subscribe-lag recovery: drop any prints still awaiting reclassification.
    # Their NBBO history is gone (cleared above), so the re-pass could never
    # recover them anyway -- clearing avoids carrying stale cross-session
    # entries. Their flow.db rows persist with whatever Side they were written.
    _RECLASSIFY_BUFFER.clear()
    _state["reclassify_buffer_size"] = 0

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
        # 7/8: log warm-start subscriptions to Q pool event log for future
        # gap diagnosis. Pool size is len(warm) since we cleared _q_subscribed
        # in reset before this block.
        for sym in warm:
            _log_q_event('warmstart', sym, reason='startup', pool_size_after=len(warm))
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

    # Background write pipeline (2026-07-07): the flusher enqueues small batches
    # here; the writer task below drains them to FlowDB via the dedicated
    # single-thread executor. Bounded so a slow disk can't grow memory without
    # limit -- a full queue makes the flusher's `await put` apply backpressure.
    write_queue: asyncio.Queue = asyncio.Queue(maxsize=_WRITE_QUEUE_MAX)

    async def writer():
        """Drain the write queue to FlowDB, one batch at a time, off the loop.

        Runs on the event loop but only ever AWAITs the executor, so it never
        blocks recv. Single consumer + single-worker executor => writes are
        strictly serialized and ordered; no concurrent FlowDB writer. On stop,
        finishes the queue before exiting so no buffered batch is lost."""
        loop = asyncio.get_running_loop()
        # Drain coalescing (re-applied 2026-07-09 after the open drowned the
        # one-batch-at-a-time writer): merge all already-queued batches into ONE
        # _write_events call so the fixed per-write cost (5 enrichment passes +
        # insert txn) is amortized across the whole backlog. Without it the writer
        # pays that cost per 2s flush-batch and falls minutes behind the ~650/s
        # open firehose. Bounds keep any single write sane; env-tunable.
        _c_max_ev = int(os.environ.get("MASSIVE_WRITE_COALESCE_EVENTS", "8000"))
        _c_max_ba = int(os.environ.get("MASSIVE_WRITE_COALESCE_BATCHES", "400"))
        while True:
            try:
                events = await asyncio.wait_for(write_queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                if stop_event.is_set() and write_queue.empty():
                    break
                continue
            drained = 1
            while len(events) < _c_max_ev and drained < _c_max_ba:
                try:
                    events.extend(write_queue.get_nowait())
                except asyncio.QueueEmpty:
                    break
                drained += 1
            try:
                await loop.run_in_executor(_WRITE_EXECUTOR, _write_events, events)
            except Exception as e:
                logger.warning("[massive-ws] writer batch failed: %s", e)
            finally:
                for _ in range(drained):
                    write_queue.task_done()

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
                # Phase 2c: classify Side for each event using current NBBO.
                # Stays on the loop -- it reads the shared _nbbo_table that the
                # recv loop writes, so it must NOT move to a thread.
                _classify_events_side(events)
                # Phase 2c: queue Q subscriptions for any newly-active contracts
                # so future events on these contracts get classified
                _queue_q_subscriptions_for_events(events)
                # 2026-07-07: hand the write batch to the background writer
                # instead of doing it here. The enrichment+insert (5 DB passes +
                # hundreds of rows) is too slow to run inline at the open
                # firehose -- doing it on the loop stalled the WS keepalive
                # (flapping); awaiting it here serialized flushes and lagged the
                # tape ~2 min. Enqueuing keeps flushes at FLUSH_INTERVAL_SEC
                # (small batches) while a dedicated thread drains writes
                # continuously -> real-time tape, no loop stall. `await put`
                # applies async backpressure if the writer ever falls behind
                # (yields to the loop, so recv keeps flowing) -- bounded, never
                # blocking, never dropping.
                await write_queue.put(events)

    async def q_subscription_manager():
        """Drain subscribe/unsubscribe queues in batches every 5 seconds.

        Batching avoids hammering Massive with one WS message per contract.
        Operations happen via the same WS connection that's serving T/Q --
        Massive's docs don't separate subscribe channels from data channels.

        Fast-path (2026-07-11): also wakes early when _fast_path_event is set
        (a big NEW contract needs NBBO now), so its first burst gets Tier-1
        classified instead of waiting up to a full 5s cadence.
        """
        while not stop_event.is_set():
            # Wake on the 5s cadence, OR immediately on stop / a fast-path signal.
            stop_wait = asyncio.ensure_future(stop_event.wait())
            fast_wait = asyncio.ensure_future(_fast_path_event.wait())
            try:
                done, pending = await asyncio.wait(
                    {stop_wait, fast_wait}, timeout=5.0,
                    return_when=asyncio.FIRST_COMPLETED)
            finally:
                for t in (stop_wait, fast_wait):
                    if not t.done():
                        t.cancel()
            if stop_event.is_set():
                # Session tearing down: the socket is dying and Massive clears
                # subscriptions on disconnect anyway. Skipping the final send
                # keeps stop() teardown inside its 5s join budget.
                break
            # Consume the fast-path signal so it doesn't immediately re-fire.
            _fast_path_event.clear()
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
                    # MEMORY-LEAK FIX (2026-07-17): drop the evicted contracts'
                    # NBBO state — they're no longer classified, so their history
                    # is dead weight. This is the primary bound on _NBBO_HISTORY.
                    for _u in unsubs:
                        _NBBO_HISTORY.pop(_u, None)
                        _nbbo_table.pop(_u, None)
                    _state["q_unsubscribes_sent"] += 1
                    logger.info("[massive-ws] Q.unsubscribed %d contracts "
                                "(pool now %d)", len(unsubs), len(_q_subscribed))
                    # 7/8: log confirmed unsubscribes for gap diagnosis. Reason
                    # is always 'eviction' at this point — the only path that
                    # queues to _q_pending_unsubscribe is eviction in
                    # _queue_q_subscriptions_for_events.
                    for _u in unsubs:
                        _log_q_event('unsub', _u, reason='eviction',
                                     pool_size_after=len(_q_subscribed))
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
                    # 7/8: log confirmed subscribes. Reason is 'demand' because
                    # subscribes queue via _queue_q_subscriptions_for_events
                    # from emitted events. Warm-start doesn't go through this
                    # path (it does its own send + log).
                    for _s in subs:
                        _log_q_event('sub', _s, reason='demand',
                                     pool_size_after=len(_q_subscribed))
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
            else:
                # Session tearing down: skip the final Yahoo batch (up to 8s)
                # during teardown so stop() stays inside its join budget.
                break
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
            else:
                # Session tearing down: skip the final Schwab batch during
                # teardown; the next session re-queues unresolved contracts.
                break
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
            resolved = [(ck, oi, "ondemand")
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
                    from api.oi_snapshots import parse_key
                    today_mdY = f"{date.today().month}/{date.today().day}/{date.today().year}"
                    db = FlowDB()
                    rows_updated = 0
                    try:
                        with sqlite3.connect(db.db_path, timeout=10) as conn:
                            # Each item is (contract_key, oi, source) where
                            # contract_key is a pipe-delimited string
                            # "SYM|C|STRIKE|M/D/YYYY" (see oi_snapshots.make_key),
                            # NOT a 4-tuple. Parse it into its fields; iterating
                            # the raw string used to raise "too many values to
                            # unpack (expected 4)" every OI batch, so this whole
                            # color backfill silently never ran. (2026-07-01.)
                            for ck, oi, _src in resolved_contracts:
                                sym, cp_letter, strike, exp_mdy = parse_key(ck)
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

    async def q_pool_log_flusher():
        """7/8: drain _q_pool_event_log buffer to flow.db every 15 sec.

        Diagnostic-only — persists Q pool subscribe/unsubscribe events so
        we can retroactively answer "was contract X in the pool at time T?"
        Zero impact on subscription behavior.

        Uses asyncio.to_thread for the DB write so the sqlite call doesn't
        block the event loop. Batches all pending events into a single
        multi-row INSERT for efficiency (typical batch: 10-200 rows).

        Table schema (created lazily on first flush, idempotent):
            id INTEGER PRIMARY KEY,
            ts_unix REAL,          -- Unix timestamp of the event
            action TEXT,           -- 'sub' | 'unsub' | 'warmstart'
            occ TEXT,              -- OCC symbol
            reason TEXT,           -- 'demand' | 'eviction' | 'startup'
            pool_size_after INT,   -- len(_q_subscribed) after event applied
            evicted_for TEXT       -- OCC that took this slot (unsub only)
        """
        import sqlite3
        from api.flow_db import FlowDB
        db_path = FlowDB().db_path
        # Table creation runs once and is idempotent
        try:
            def _init():
                with sqlite3.connect(db_path, timeout=10) as conn:
                    conn.execute("""
                        CREATE TABLE IF NOT EXISTS q_pool_events (
                            id INTEGER PRIMARY KEY,
                            ts_unix REAL NOT NULL,
                            action TEXT NOT NULL,
                            occ TEXT NOT NULL,
                            reason TEXT,
                            pool_size_after INTEGER,
                            evicted_for TEXT
                        )
                    """)
                    conn.execute("CREATE INDEX IF NOT EXISTS ix_qpe_ts "
                                 "ON q_pool_events(ts_unix)")
                    conn.execute("CREATE INDEX IF NOT EXISTS ix_qpe_occ_ts "
                                 "ON q_pool_events(occ, ts_unix)")
                    conn.commit()
            await asyncio.to_thread(_init)
            logger.info("[massive-ws] q_pool_events table ready")
        except Exception as e:
            logger.warning("[massive-ws] q_pool_events table init failed "
                           "(non-fatal, will retry): %s", e)

        while not stop_event.is_set():
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=15.0)
            except asyncio.TimeoutError:
                pass
            else:
                # Teardown — try one final flush so we don't lose the tail
                pass
            if not _q_pool_event_log:
                continue
            # Snapshot and clear so the hot path can keep appending
            batch = _q_pool_event_log[:]
            del _q_pool_event_log[:len(batch)]
            try:
                def _flush(rows):
                    with sqlite3.connect(db_path, timeout=10) as conn:
                        conn.executemany(
                            "INSERT INTO q_pool_events "
                            "(ts_unix, action, occ, reason, pool_size_after, evicted_for) "
                            "VALUES (?, ?, ?, ?, ?, ?)",
                            rows,
                        )
                        conn.commit()
                await asyncio.to_thread(_flush, batch)
            except Exception as e:
                logger.warning("[massive-ws] q_pool_events flush failed "
                               "(%d events dropped): %s", len(batch), e)

    async def reclassify_manager():
        """Post-NBBO reclassification re-pass (2026-07-11).

        Every RECLASSIFY_INTERVAL_SEC, walk the buffered tick/empty prints and,
        for any whose NBBO history has since filled in, re-run _classify_side and
        overwrite the flow.db row IN PLACE (via the shared single-writer executor,
        so it never races the insert path). Only tick/empty sides are touched;
        the UPDATE guards on the exact recorded side so it's idempotent and can
        never clobber an NBBO one. Entries whose NBBO never arrives expire on TTL
        (best-effort, expected). The live tape polls flow.db, so a corrected row
        propagates to the tape + rollups + direction on the next poll -- no SSE
        correction needed.
        """
        loop = asyncio.get_running_loop()
        while not stop_event.is_set():
            try:
                await asyncio.wait_for(stop_event.wait(),
                                       timeout=RECLASSIFY_INTERVAL_SEC)
                break  # stop requested
            except asyncio.TimeoutError:
                pass
            if not RECLASSIFY_ENABLED or not _RECLASSIFY_BUFFER:
                _state["reclassify_buffer_size"] = len(_RECLASSIFY_BUFFER)
                continue
            # Drain-and-triage. No awaits inside _collect_reclassifications, so
            # the flusher can't append mid-pass -- the buffer stays consistent.
            updates = _collect_reclassifications(time.time())
            if updates:
                try:
                    n = await loop.run_in_executor(
                        _WRITE_EXECUTOR, _apply_reclassifications, updates)
                    _state["reclassified_total"] += n
                    _state["last_reclassify_count"] = n
                    if n:
                        logger.info("[massive-ws] reclassified %d side(s) "
                                    "post-NBBO (of %d recovered this pass)",
                                    n, len(updates))
                except Exception as e:
                    logger.warning("[massive-ws] reclassify apply failed: %s", e)

    flusher_task = asyncio.create_task(flusher())
    writer_task = asyncio.create_task(writer())
    q_mgr_task = asyncio.create_task(q_subscription_manager())
    oi_mgr_task = asyncio.create_task(oi_fetch_manager())
    spot_mgr_task = asyncio.create_task(spot_fetch_manager())
    watchdog_task = asyncio.create_task(stale_connection_watchdog())
    q_log_flusher_task = asyncio.create_task(q_pool_log_flusher())
    reclassify_task = asyncio.create_task(reclassify_manager())

    try:
        async for msg in ws:
            # Raw-tape spool (2026-07-16, gap-elimination): hand the frame to
            # the spool BEFORE any parsing so a wedged pipeline can't lose
            # received prints — boot replay heals gaps from this. O(1) deque
            # append; never raises, never blocks.
            _tape_spool(msg)
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
                        # Backstop for the leak: a quote can arrive for a
                        # just-unsubscribed contract (in-flight), re-creating an
                        # entry the unsub path already cleared. Sweep dead
                        # entries when the map overgrows so it can't creep.
                        if len(_NBBO_HISTORY) > _NBBO_CONTRACTS_MAX:
                            _evict_dead_nbbo()
                    nh.append((ts_ms * 1_000_000, bid, ask))
                    _state["quotes_received"] += 1
                elif ev_type == "status":
                    _msg = str(evt.get("message", ""))
                    if _msg.startswith(("subscribed to:", "unsubscribed to:")):
                        # Per-contract sub/unsub acks flood 500+ lines/sec at
                        # the open — they hit Railway's log rate cap (dropping
                        # every other message, incl. crash tracebacks) and burn
                        # recv-loop CPU. The aggregate "Q.subscribed N
                        # contracts (pool now X)" lines already cover this.
                        logger.debug("[massive-ws] status: %s", evt)
                    else:
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
        # After the flusher stops enqueuing, drain the write queue: the writer
        # keeps going (stop_event set) until the queue is empty, then exits, so
        # every buffered batch is written before the session ends (no loss on
        # disconnect/deploy). Bounded wait so a wedged write can't hang teardown.
        try:
            await asyncio.wait_for(writer_task, timeout=8.0)
        except (Exception, asyncio.TimeoutError):
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
        try:
            q_log_flusher_task.cancel()
            await q_log_flusher_task
        except (Exception, asyncio.CancelledError):
            pass
        try:
            # Reclassify re-pass: wakes on stop_event within RECLASSIFY_INTERVAL_SEC;
            # cancel to bound teardown (any un-applied recoveries are best-effort).
            reclassify_task.cancel()
            await reclassify_task
        except (Exception, asyncio.CancelledError):
            pass
        # Final flush so we don't lose the last few seconds on disconnect
        agg.flush_all()
        events = agg.drain()
        if events:
            _state["events_emitted"] += len(events)
            _write_events(events)


# -- Thread entry point ---------------------------------------------

async def _consumer_root():
    """Root coroutine for the consumer thread's event loop.

    Exists so stop() -- called from ANOTHER thread (uvicorn's lifespan
    teardown) -- has a Task handle to cancel and a loop to schedule the cancel
    on. Captures both into _state BEFORE the first await so the
    stop()-before-refs race window is microseconds.
    """
    _state["loop"] = asyncio.get_running_loop()
    _state["root_task"] = asyncio.current_task()
    try:
        await _consume_forever()
    except asyncio.CancelledError:
        # Terminal cancel from stop(). Swallow it HERE -- not in
        # _consume_forever, which must re-raise so the websockets context
        # manager's __aexit__ runs the closing handshake -- so asyncio.run()
        # returns instead of dumping a CancelledError via threading.excepthook.
        logger.info("[massive-ws] root task cancelled -- graceful stop complete")
    finally:
        _state["loop"] = None
        _state["root_task"] = None


def _thread_main():
    """Run the asyncio loop in this dedicated thread."""
    try:
        asyncio.run(_consumer_root())
    except Exception as e:
        logger.exception("[massive-ws] thread crashed: %s", e)
        _state["last_error"] = f"thread_crash: {e}"
    finally:
        _state["running"] = False
        _state["connected"] = False


def stop(timeout: float = 5.0) -> bool:
    """Gracefully stop the WS consumer. Safe from any thread, any number of
    times, whether or not start() ever ran.

    Sequence:
      1. Flip module-level ENABLED so `while ENABLED` exits even if the cancel
         below is lost (e.g. thread hasn't registered loop/task refs yet).
         No module does `from ... import ENABLED`, so the reassignment is
         seen everywhere.
      2. call_soon_threadsafe(root_task.cancel) -- FIRST call only. Lands
         CancelledError at the consumer's current await; the websockets
         context manager's __aexit__ then performs the closing handshake
         (close frame, bounded by close_timeout=3), so Massive sees a CLEAN
         disconnect and frees the slot in seconds instead of holding a zombie
         session for 10-30s+ that trips the next process into max_connections.
      3. join(timeout): bounded. On timeout we return False -- the daemon
         thread finishes behind us inside the Railway drain window.
    """
    global ENABLED
    already_requested = _state.get("stop_requested", False)
    _state["stop_requested"] = True
    ENABLED = False

    t = _state.get("thread")
    if t is None or not t.is_alive():
        logger.info("[massive-ws] stop(): consumer not running -- nothing to do")
        return True

    if not already_requested:
        loop = _state.get("loop")
        task = _state.get("root_task")
        if loop is not None and task is not None:
            try:
                loop.call_soon_threadsafe(task.cancel)
                logger.info("[massive-ws] stop(): cancel scheduled on consumer loop")
            except RuntimeError:
                pass  # loop already closed -- thread exiting on its own
        else:
            logger.info(
                "[massive-ws] stop(): no loop/task refs yet -- relying on "
                "ENABLED flag"
            )
    # else: a second stop() must NOT cancel again -- a second CancelledError
    # would land inside _run_session's finally (BaseException escapes the
    # `except Exception` guards there) and abort the final flush.

    t.join(timeout)
    if t.is_alive():
        logger.warning(
            "[massive-ws] stop(): thread still alive after %.1fs -- daemon "
            "thread finishes during the remaining drain window", timeout,
        )
        return False
    logger.info("[massive-ws] stop(): consumer thread exited cleanly")
    return True


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

    # ER-cache prewarm (2026-07-16 open-freeze fix): fill the whole cache in a
    # daemon thread so the write loop never pays cold ER lookups at the open.
    threading.Thread(target=prewarm_er_cache, daemon=True,
                     name="massive-ws-er-prewarm").start()

    # Raw-tape spool + boot gap-replay (2026-07-16 gap-elimination): spool
    # every received frame; after boot, heal today's gap windows from the
    # spool so a freeze/restart costs lag, not data.
    try:
        from api import flow_tape_spool
        if flow_tape_spool.start_writer():
            print("[startup] tape spool writer started")
        if flow_tape_spool.start_boot_replay():
            print("[startup] tape-spool boot gap-replay armed")
    except Exception as e:
        print(f"[startup] tape spool failed to start (non-fatal): {e}")

    # Retroactive Spot backfill: fills blank Spot on today's rows that were
    # written by prior worker processes (before this restart). Runs in a
    # separate thread so it never blocks WS consumption startup — worst case,
    # backfill fails silently and blank rows stay blank. Waits 5s to let the
    # WS thread establish its connection before starting a Yahoo-fetching
    # workload against the same event loop / db.
    def _backfill_thread():
        try:
            time.sleep(5)
            backfill_stranded_spots()
        except Exception as e:
            logger.warning("[spot-backfill] thread crashed: %s", e)

    bt = threading.Thread(
        target=_backfill_thread, daemon=True, name="massive-spot-backfill"
    )
    bt.start()

    logger.info(
        "[massive-ws] consumer thread started "
        "(url=%s, subscribe=%s, min_prem=$%s, min_vol=%d, dry_run=%s)",
        MASSIVE_OPTIONS_WS_URL, MASSIVE_WS_SUBSCRIBE,
        f"{MIN_PREMIUM:,.0f}", MIN_VOLUME, DRY_RUN,
    )
    return True


# ─── Retroactive Spot backfill (Phase 3, added 2026-07-06) ─────────────────
# Problem this solves: on-page symptom is rows with SPOT column blank ("—")
# for prints that arrived before a worker restart. Root cause: Spot lookup is
# async — a row is INSERTed with blank Spot, the async fetcher resolves the
# ticker's spot a few seconds later, and future writes for that ticker land
# with populated Spot. But the ORIGINAL row is never updated once written.
# So when a worker process dies (deploy, crash), any row whose ticker hadn't
# been spot-resolved yet becomes permanently stranded — the new process
# starts with an empty _SPOT_CACHE and only sees new arrivals.
#
# What Spot represents on this platform: the underlying stock's price AT
# THE MOMENT THE OPTION PRINT LANDED ON TAPE. Not current spot. Not the
# spot at backfill time. Print-time spot.
#
# The raw Massive OPRA WebSocket doesn't carry underlying price on option
# prints — OPRA tape is options-only. The live path today approximates
# print-time spot by using Yahoo's regularMarketPrice cached with a 60s
# TTL; that works well for live rows because the cache is fresh within
# seconds of the print, but it CANNOT be reused for stranded rows enriched
# hours after the print — the drift on a fast mover could be 5+ percent.
#
# This backfill uses yfinance 1-minute bars keyed on each row's CreatedTime.
# For a print at 11:47:22 AM ET, it looks up the underlying's 1-minute bar
# covering 11:47:00 - 11:47:59 and uses that bar's close as the row's Spot.
# Accuracy: ±30 seconds from print time. yfinance retains 1-min data for
# ~7 days, so this works for any print within the last week.
#
# Fallback chain if the minute bar isn't available:
#   1. Nearest-neighbor within 5 minutes (fills bars Yahoo dropped)
#   2. Daily close for target_date (if 1-min data unavailable — dates > 7d old)
#   3. Skip the row (leave Spot blank rather than write wrong value)
#
# Groups rows by (symbol, minute) so one bar-lookup covers all rows sharing
# the same underlying + minute — typically a 3-5x UPDATE reduction.
#
# Runs once per process start ~5s after WS thread launches. Also exposed
# as POST /api/live/massive/backfill-spot for on-demand retriggering.
#
# Does NOT warm _SPOT_CACHE. Historical minute-bar closes would corrupt
# live-path enrichment if injected there. Cache stays purely current-spot.

def _parse_created_time_to_minute(ct):
    """'11:47:22 AM' → 707 (minutes past midnight). None on parse failure.
    Format matches how the router's _parse_to_minute_of_day handles the
    CreatedTime column — keep the two in sync if the format ever changes.
    """
    try:
        s = ct.strip().upper()
        parts = s.split()
        if len(parts) != 2:
            return None
        hhmmss, ampm = parts[0], parts[1]
        h_str, m_str, *_ = hhmmss.split(":")
        h, m = int(h_str), int(m_str)
        if ampm == "PM" and h != 12:
            h += 12
        elif ampm == "AM" and h == 12:
            h = 0
        return h * 60 + m
    except Exception:
        return None


def backfill_stranded_spots(target_date_mdyyyy: str = None) -> dict:
    """Fill blank Spot on stranded rows using yfinance 1-minute bars.

    Print-time accurate to ±30 seconds. For each stranded row, looks up
    the underlying's 1-minute bar covering the row's CreatedTime and uses
    that bar's close as the Spot value.

    target_date_mdyyyy: 'M/D/YYYY'. Defaults to today ET.

    Returns:
        {
          "target_date": "7/6/2026",
          "symbols_scanned": 15,        # distinct underlyings with blank-spot rows
          "symbols_with_bars": 14,      # got 1-min bars from Yahoo
          "symbols_no_bars": 1,         # Yahoo returned nothing
          "buckets_scanned": 42,        # (symbol, minute) buckets
          "buckets_matched": 39,        # buckets with an available bar
          "rows_scanned": 82,           # total blank-spot rows found
          "rows_updated": 76,           # rows we UPDATE'd with spot
          "rows_no_match": 6,           # buckets with no bar even after neighbor search
          "elapsed_sec": 4.7,
          "sample_updates": [ ... ]     # first few (sym, minute, spot) for verification
        }

    Idempotent: safe to call multiple times.
    Silent on failure: logs + returns {"error": "..."} rather than raising.
    """
    import sqlite3
    from datetime import datetime, timezone, timedelta

    started = time.time()

    # Default target_date to today in ET (matches CreatedDate format).
    if not target_date_mdyyyy:
        _et_now = datetime.now(timezone.utc) + timedelta(hours=-4)  # July DST
        target_date_mdyyyy = f"{_et_now.month}/{_et_now.day}/{_et_now.year}"

    try:
        from api.flow_db import FlowDB
        db_path = FlowDB().db_path
    except Exception as e:
        logger.warning("[spot-backfill] flow_db import failed: %s", e)
        return {"error": f"flow_db import: {e}", "rows_updated": 0}

    # ─── Step 1: scan for stranded rows, grouped by (symbol, minute) ─────
    # Bucketing by minute is critical — a ticker with 20 stranded rows
    # spread across 5 minutes only needs 5 bar lookups + 5 UPDATEs, not 20.
    stranded: dict = {}   # {(symbol, minute_of_day): [row_ids]}
    symbols_seen: set = set()
    try:
        with sqlite3.connect(db_path, timeout=15) as conn:
            cur = conn.execute(
                "SELECT id, Symbol, CreatedTime FROM flow "
                "WHERE CreatedDate = ? "
                "  AND source IN ('stocks', 'indexes') "
                "  AND (Spot IS NULL OR Spot = '' OR CAST(Spot AS REAL) <= 0)",
                (target_date_mdyyyy,)
            )
            for row_id, sym, ct in cur.fetchall():
                if not sym or not ct:
                    continue
                if sym[-1].isdigit():
                    continue
                mod = _parse_created_time_to_minute(ct)
                if mod is None:
                    continue
                stranded.setdefault((sym, mod), []).append(row_id)
                symbols_seen.add(sym)
    except Exception as e:
        logger.warning("[spot-backfill] scan failed: %s", e)
        return {"error": f"scan: {e}", "rows_updated": 0}

    total_rows = sum(len(v) for v in stranded.values())

    if not stranded:
        result = {
            "target_date": target_date_mdyyyy,
            "symbols_scanned": 0,
            "buckets_scanned": 0,
            "rows_scanned": 0,
            "rows_updated": 0,
            "elapsed_sec": round(time.time() - started, 2),
        }
        _state["last_spot_backfill"] = result
        logger.info(
            "[spot-backfill] no stranded rows for %s", target_date_mdyyyy
        )
        return result

    logger.info(
        "[spot-backfill] %d symbols / %d buckets / %d rows for %s",
        len(symbols_seen), len(stranded), total_rows, target_date_mdyyyy
    )

    # ─── Step 2: compute the ET Unix-time range for target_date ─────────
    # yfinance's period1/period2 parameters expect UTC seconds. Use a
    # generous 8 AM - 5 PM ET window so premarket and after-hours prints
    # (rare on options but possible) don't get clipped.
    try:
        m_s, d_s, y_s = target_date_mdyyyy.split("/")
        et_offset = timedelta(hours=-4)  # July DST
        day_open_et = datetime(int(y_s), int(m_s), int(d_s), 8, 0, 0)
        day_close_et = datetime(int(y_s), int(m_s), int(d_s), 17, 0, 0)
        period1 = int((day_open_et - et_offset).replace(tzinfo=timezone.utc).timestamp())
        period2 = int((day_close_et - et_offset).replace(tzinfo=timezone.utc).timestamp())
    except Exception as e:
        logger.warning("[spot-backfill] bad target_date parse: %s", e)
        return {"error": f"target_date parse: {e}", "rows_updated": 0}

    # ─── Step 3: batch-fetch 1-minute bars per symbol ───────────────────
    YF_INDEX_MAP = {
        "SPX": "^GSPC", "NDX": "^NDX", "DJX": "^DJI",
        "RUT": "^RUT", "VIX": "^VIX", "XSP": "^GSPC",
        "SPXW": "^GSPC",
    }
    UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

    async def _fetch_bars_one(client, our_sym):
        """Returns (our_sym, {minute_of_day: close_price})."""
        yf_sym = YF_INDEX_MAP.get(our_sym, our_sym)
        try:
            resp = await client.get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{yf_sym}",
                params={
                    "interval": "1m",
                    "period1": str(period1),
                    "period2": str(period2),
                    "includePrePost": "false",
                },
                headers={"User-Agent": UA},
            )
            if resp.status_code != 200:
                return (our_sym, {})
            data = resp.json()
            result_list = data.get("chart", {}).get("result")
            if not result_list:
                return (our_sym, {})
            first = result_list[0]
            timestamps = first.get("timestamp", []) or []
            quote = first.get("indicators", {}).get("quote", [{}])[0]
            closes = quote.get("close", []) or []
            bars_by_minute = {}
            for ts_unix, close in zip(timestamps, closes):
                if close is None:
                    continue
                # Convert bar's Unix timestamp to ET minute-of-day.
                bar_dt_et = (
                    datetime.fromtimestamp(ts_unix, tz=timezone.utc) + et_offset
                )
                mod = bar_dt_et.hour * 60 + bar_dt_et.minute
                bars_by_minute[mod] = float(close)
            # Also grab daily close as a fallback for buckets with no
            # minute bar coverage (dates outside the 7d 1-min window).
            meta = first.get("meta", {})
            daily_close = None
            for key in ("regularMarketPrice", "chartPreviousClose"):
                v = meta.get(key)
                if isinstance(v, (int, float)) and v > 0:
                    daily_close = float(v)
                    break
            if daily_close and not bars_by_minute:
                # Signal daily-fallback via special key -1
                bars_by_minute[-1] = daily_close
            return (our_sym, bars_by_minute)
        except Exception:
            return (our_sym, {})

    async def _fetch_batch(symbols):
        import httpx
        async with httpx.AsyncClient(timeout=10.0) as client:
            return await asyncio.gather(
                *[_fetch_bars_one(client, s) for s in symbols],
                return_exceptions=False,
            )

    # Sequential batches of 30 — same rate envelope as live path.
    bars_by_symbol: dict = {}  # {symbol: {minute_of_day: close}}
    all_symbols = list(symbols_seen)
    for i in range(0, len(all_symbols), 30):
        batch = all_symbols[i:i + 30]
        try:
            batch_results = asyncio.run(_fetch_batch(batch))
        except Exception as e:
            logger.warning(
                "[spot-backfill] batch %d fetch failed: %s", i // 30, e
            )
            continue
        for sym, bars in batch_results:
            bars_by_symbol[sym] = bars

    # ─── Step 4: match buckets to bars, UPDATE flow.db ──────────────────
    symbols_with_bars = sum(1 for b in bars_by_symbol.values() if b)
    symbols_no_bars = len(symbols_seen) - symbols_with_bars

    def _spot_for_bucket(sym, mod):
        """Look up a specific minute's close, with 5-minute neighbor fallback."""
        bars = bars_by_symbol.get(sym, {})
        if not bars:
            return None
        # Exact minute match
        v = bars.get(mod)
        if v is not None and v > 0:
            return v
        # Nearest-neighbor within 5 minutes (Yahoo occasionally drops bars)
        for delta in range(1, 6):
            v = bars.get(mod - delta)
            if v is not None and v > 0:
                return v
            v = bars.get(mod + delta)
            if v is not None and v > 0:
                return v
        # Daily-close fallback (only present when no minute bars)
        v = bars.get(-1)
        if v is not None and v > 0:
            return v
        return None

    rows_updated = 0
    buckets_matched = 0
    sample_updates: list = []
    try:
        with sqlite3.connect(db_path, timeout=15) as conn:
            for (sym, mod), row_ids in stranded.items():
                spot = _spot_for_bucket(sym, mod)
                if spot is None:
                    continue
                buckets_matched += 1
                spot_str = f"{spot:.2f}"
                # Chunk row IDs to stay under SQLite variable limit.
                for j in range(0, len(row_ids), 500):
                    chunk = row_ids[j:j + 500]
                    placeholders = ",".join(["?"] * len(chunk))
                    conn.execute(
                        f"UPDATE flow SET Spot = ? WHERE id IN ({placeholders})",
                        [spot_str] + chunk
                    )
                    rows_updated += len(chunk)
                if len(sample_updates) < 5:
                    h = mod // 60
                    mm = mod % 60
                    ampm = "AM" if h < 12 else "PM"
                    h12 = h if 1 <= h <= 12 else (h - 12 if h > 12 else 12)
                    sample_updates.append({
                        "symbol": sym,
                        "print_minute_et": f"{h12}:{mm:02d} {ampm}",
                        "spot_written": spot_str,
                        "rows_in_bucket": len(row_ids),
                    })
            conn.commit()
    except Exception as e:
        logger.warning("[spot-backfill] UPDATE failed: %s", e)

    result = {
        "target_date": target_date_mdyyyy,
        "symbols_scanned": len(symbols_seen),
        "symbols_with_bars": symbols_with_bars,
        "symbols_no_bars": symbols_no_bars,
        "buckets_scanned": len(stranded),
        "buckets_matched": buckets_matched,
        "rows_scanned": total_rows,
        "rows_updated": rows_updated,
        "rows_no_match": total_rows - rows_updated,
        "elapsed_sec": round(time.time() - started, 2),
        "sample_updates": sample_updates,
    }
    _state["last_spot_backfill"] = result
    logger.info("[spot-backfill] done: %s", result)
    return result
