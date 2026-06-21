"""
Live Flow Worker — Phase B

Phase A scope (still in place): consume Bullflow SSE, buffer alerts in memory,
expose via GET /api/live/alerts/recent. Single replica on web service.

Phase B additions:
  - Filter Engine v1: tiered conviction scoring per alert. Decides:
      * Does this alert SHOW UP in the table at all (table filter)
      * Does it FORWARD to Discord (conviction threshold)
  - Discord webhook forwarder: matches discord_watchlist.py rich-embed pattern
  - Per-alert flags stored on the buffered object so frontend can render badges

Filter rules are hardcoded in this module (TABLE_FILTER + scoring rules below).
Tunable by editing the dict + redeploying. A Phase C would expose CRUD for
these via a Railway-backed admin route, but for now: edit code, push,
Railway redeploys.

Out of scope still:
  - SQLite persistence (in-memory only)
  - Migration to `worker` Railway service (still on `web`)
  - Editable filter UI
"""
import asyncio
import json
import logging
import os
import re
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx

# Lazy import in functions where needed for live_alerts persistence. Top-level
# import here is safe because live_alerts_db gracefully handles a missing
# /data mount on Railway (init_db retries silently).
from api import live_alerts_db

log = logging.getLogger(__name__)

# Eastern Time zone — used for displaying market timestamps to subscribers.
# Railway runs UTC by default, so naive datetime.fromtimestamp() returns UTC
# (not local market time). Use this with fromtimestamp(ts, tz=ET) to convert.
# Handles DST automatically (EDT vs EST).
ET = ZoneInfo("America/New_York")

"""
Logo URL shown in the author block at the top of every Discord embed. Override
via the UCT_LOGO_URL env var on Railway — that's the path of least resistance
for ops; no code change needed when the logo file is swapped.

Fallback resolution order:
  1. UCT_LOGO_URL env var (preferred — set on Railway worker service)
  2. GitHub raw URL pointing at app/public/UCT_logo.jpg in the master branch
     (permanent, immune to Vite hash rebuilds, requires no Railway config)

NEVER use:
  - Vite-built /assets/* paths — hashes change every frontend deploy, URL dies
  - Discord CDN URLs (cdn.discordapp.com) — signed query params expire in 24-48h
  - Locally-uploaded Imgur / temporary file hosts — out-of-band, no version control

Image must be PNG/JPG/WebP (AVIF is unreliable in Discord embeds).
"""
UCT_LOGO_URL = os.getenv(
    "UCT_LOGO_URL",
    "https://raw.githubusercontent.com/unchartedterritory5995-cyber/"
    "UCT-Dashboard/master/app/public/UCT_logo_512.png",
).strip()

# ─── Config ──────────────────────────────────────────────────────────────────
BULLFLOW_API_KEY = os.getenv("BULLFLOW_API_KEY", "").strip()
BULLFLOW_SSE_URL = "https://api.bullflow.io/v1/streaming/alerts"

# Reuse the existing Discord webhook (same channel as breadth/watchlist pushes).
# Fallback chain matches what the user has set up; LIVE-specific var wins if set.
DISCORD_WEBHOOK_URL = (
    os.getenv("DISCORD_LIVE_FLOW_WEBHOOK_URL")
    or os.getenv("DISCORD_WEBHOOK_URL", "")
).strip()

MAX_BUFFER = 1000
RECONNECT_MIN_SEC = 1.0
RECONNECT_MAX_SEC = 30.0

# ─── Filter Engine v1 ────────────────────────────────────────────────────────
# Table filter — alerts must pass ALL of these to appear in the LiveFlow UI.
# Anything that fails goes into _alerts_dropped counter, not the buffer.
TABLE_FILTER = {
    "premium_min": 250_000,                # below this = noise
    "ticker_blocklist": {"SPY", "QQQ", "IWM"},
    # alertName must NOT contain any of these substrings (case-insensitive)
    "alertname_block_substrings": ["grenade"],  # lottery/hedge noise
}

# Mega-cap tickers — used by per-alert blocklists below to exclude these from
# alerts where mega-cap noise drowns out signal. Edit this list freely; it's
# the single source of truth. To exclude more names (large-cap, $200B-$500B
# range), uncomment the additional entries below.
MEGA_CAP_TICKERS = frozenset({
    # $1T+ market cap
    "AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "AMZN", "META", "TSLA",
    # $500B-$1T
    "BRK.A", "BRK.B", "LLY", "AVGO", "V", "JPM", "WMT", "XOM", "UNH", "MA",
    # $300B-$500B (heavy options activity, large enough to drown unusual scans)
    "ORCL", "NFLX", "COST", "JNJ", "HD", "ABBV", "PG", "BAC",
    # Optional: $200B-$300B (uncomment if Unusual is still too noisy)
    # "MRK", "CRM", "CSCO", "ADBE", "AMD", "TMO", "ACN", "MCD", "CVX",
    # "NOW", "IBM", "DIS", "GE", "INTU", "T", "CMCSA", "PEP", "KO",
})

# Per-alert ticker blocklists — applied IN ADDITION to TABLE_FILTER's global
# blocklist. Keyed by exact alert name (whitespace stripped). Mega-caps are
# excluded from Unusual / Vol>OI because unusual activity in those names is
# typically noise — their average daily volume is high enough that ratio-based
# anomaly detection generates false positives. Small/mid-cap unusual activity
# is the real alpha here.
ALERT_TICKER_BLOCKLISTS = {
    "UCT Unusual": MEGA_CAP_TICKERS,
    "UCT Vol>OI":  MEGA_CAP_TICKERS,
}

# User-managed ticker blocklist — edited live via the admin UI and persisted
# to a JSON file on the Railway volume so it survives worker restarts. Use
# cases: recent IPOs with noisy flow (SPCX, RKLB), tickers you don't trade,
# rumor-driven names that generate false signals, etc.
#
# The file lives on the Railway volume mount (/data) by default; override
# via USER_BLOCKLIST_FILE env var for local testing. If the file doesn't
# exist or can't be written, the blocklist degrades to in-memory only —
# the worker keeps running.
USER_BLOCKLIST_FILE = os.getenv(
    "USER_BLOCKLIST_FILE", "/data/liveflow_user_blocklist.json"
)
_user_ticker_blocklist: set = set()


def _load_user_blocklist():
    """Load tickers from disk into the in-memory set. Idempotent and safe."""
    global _user_ticker_blocklist
    try:
        with open(USER_BLOCKLIST_FILE, "r") as f:
            data = json.load(f)
        tickers = data.get("tickers", [])
        _user_ticker_blocklist = {
            t.upper().strip() for t in tickers if t and t.strip()
        }
        log.info("[liveflow] loaded %d user-blocked tickers from %s",
                 len(_user_ticker_blocklist), USER_BLOCKLIST_FILE)
    except FileNotFoundError:
        _user_ticker_blocklist = set()
        log.info("[liveflow] no user blocklist file at %s — starting empty",
                 USER_BLOCKLIST_FILE)
    except Exception as e:
        _user_ticker_blocklist = set()
        log.warning("[liveflow] error loading user blocklist (%s) — starting empty", e)


def _save_user_blocklist():
    """Persist current set to disk. Errors are logged but non-fatal."""
    try:
        os.makedirs(os.path.dirname(USER_BLOCKLIST_FILE), exist_ok=True)
        with open(USER_BLOCKLIST_FILE, "w") as f:
            json.dump({"tickers": sorted(_user_ticker_blocklist)}, f, indent=2)
    except Exception as e:
        log.warning("[liveflow] error saving user blocklist: %s", e)


def get_user_blocklist():
    """Public accessor used by API endpoint. Returns sorted list for stable UI."""
    return sorted(_user_ticker_blocklist)


def set_user_blocklist(tickers):
    """
    Replace the entire user blocklist atomically. Uppercases + strips each
    ticker. Empty/whitespace-only entries are dropped. Persists to disk on
    success and returns the new normalized list.
    """
    global _user_ticker_blocklist
    cleaned = {
        t.upper().strip() for t in (tickers or [])
        if t and isinstance(t, str) and t.strip()
    }
    _user_ticker_blocklist = cleaned
    _save_user_blocklist()
    # Reflect in status block so /api/live/alerts/recent surfaces current state.
    _status["filter_config"]["user_ticker_blocklist"] = sorted(_user_ticker_blocklist)
    return sorted(_user_ticker_blocklist)


# Load on module import so the worker has the blocklist available immediately.
_load_user_blocklist()

# ─── Dedup engine ────────────────────────────────────────────────────────────
# Bullflow fires one event per matching alert, so a single trade often arrives
# 2-3 times (e.g. matches both UCT Bullish and UCT Vol>OI, plus their native
# "Sizable Sweep" algo alert). This dedup engine collapses those to a single
# Discord post + a single table row, while preserving legitimately distinct
# trades on the same contract (different premium / fill price).
#
# Dedup behavior:
# - Same contract (ticker+cp+strike+exp) + same premium + same fill price
#   within DEDUP_WINDOW_SEC → considered duplicates of the same trade.
# - Highest-priority alert wins. Lower-priority duplicates are dropped from
#   the buffer entirely.
# - Priority: UCT Alpha Gold > Size > directional Bullish/Bearish > LEAPS >
#   Unusual/Vol>OI > everything else > ALGO (Bullflow's native alerts).
# - Discord forwarding uses a small delay (DISCORD_FORWARD_DELAY_SEC) so when
#   a UCT alert arrives after an ALGO alert for the same trade, the UCT wins
#   and Discord shows only the UCT post.

DEDUP_WINDOW_SEC = 60               # how long to remember a dedup key
DISCORD_FORWARD_DELAY_SEC = 2.0     # how long to wait before posting to Discord

# ─── Conviction-based Discord gate ───────────────────────────────────────────
# To prevent bombarding the channel with low-signal alerts, we only POST to
# Discord when the aggregate conviction grade reaches a minimum threshold.
# Alerts below threshold are still buffered + aggregated (so a trade that gains
# conviction over multiple fires gets surfaced when it crosses the threshold),
# but they never produce a Discord notification on their own.
#
# Behavior:
#   - First fire on a contract: gate by current conviction grade.
#       grade < MIN_DISCORD_GRADE → silently aggregate, no post.
#       grade >= MIN_DISCORD_GRADE → post fresh, store message_id.
#   - Subsequent fires: always PATCH the existing message (no re-gating).
#     A trade that was already posted should keep its message thread alive
#     even if subsequent fires don't add new conviction.
#
# Env var: MIN_DISCORD_GRADE = "A+" | "A" | "B" | "C" | "D"  (default "B")
# Setting to "D" effectively disables the gate (every aggregate gets posted).
MIN_DISCORD_GRADE = os.getenv("MIN_DISCORD_GRADE", "B").strip().upper()


def _grade_level(grade_str: str) -> int:
    """Map a conviction grade string to numeric level for comparison.
    Strips any trailing emoji (e.g. 'A+ 🚀' → 4)."""
    g = (grade_str or "D").strip()
    if g.startswith("A+"): return 4
    if g.startswith("A"):  return 3
    if g.startswith("B"):  return 2
    if g.startswith("C"):  return 1
    return 0  # D, unknown, or empty


MIN_DISCORD_GRADE_LEVEL = _grade_level(MIN_DISCORD_GRADE)

# Maps dedup_key tuple -> {"alert_id", "priority", "first_seen", "alert_obj"}
_dedup_cache: dict = {}

# ─── Repeat counter (per-contract aggregation) ───────────────────────────────
# Tracks how many DISTINCT trades have fired on a given contract within a
# rolling window. Separate from _dedup_cache (which collapses identical trades
# — same premium + fill). This one only counts NEW trades, so today's MU
# 1000P 6/26 firing 8 times at different premiums shows up as "8x" while a
# single trade reported by both UCT Bullish AND Sizable Sweep stays as "1x".
#
# Display use: frontend shows "🔁 Nx" badge on the alert row when count > 1.
# Inspired by BlackBox's "Repeater Alert" and Tradytics' "Orders Today" UX.
REPEAT_WINDOW_SEC = 12 * 3600        # 12hr — covers full trading day + ext hours
_contract_repeats: dict = {}         # contract_key -> {count, first_seen, first_alert_id}


# ─── Per-alert conviction gates (2026-06-21) ─────────────────────────────────
# Tuning knobs ported from the offline AlertTester simulator. Same pattern as
# ALERT_TICKER_BLOCKLISTS above: hardcoded dict keyed by exact alert name,
# edit + push to change. Empty/missing alert names fall through with all gates
# disabled, so untuned alerts behave exactly as they do today.
#
# Two gates per alert (both optional):
#
#   min_repeat_fires (int, default 0 = off):
#     2X follow-through filter. Only post when the same contract has had ≥N
#     qualifying fires within `follow_through_window_sec`. Set to 2 to require
#     a confirmation hit — institutional follow-through within minutes is what
#     this catches; one-off trades drop out.
#
#   max_per_ticker_per_day (int, default 0 = unlimited):
#     Per-ticker daily cap. Once a ticker has posted this alert today, suppress
#     further posts on that ticker for this alert tier. Other alerts on the
#     same ticker still flow. Set to 1 for "one Alpha Gold per ticker per day".
#
#   follow_through_window_sec (int, default 900 = 15min):
#     Window for the min_repeat_fires counter. Distinct from REPEAT_WINDOW_SEC
#     (12hr) which feeds the "fired N times today" badge — that one is for
#     display, this one gates Discord. The June 18 simulator runs showed that
#     5min misses SNDK + NVDA (paced 5-7min apart), 10-15min catches the real
#     follow-through clusters.
#
# Workflow: tune values in the AlertTester (uctintelligence.com/alert-tester),
# confirm the predicted Discord output, then edit this dict + push to GitHub.
# Railway redeploys the worker; new gates take effect on next alert.
#
# Recovery: if any gate over-filters in production, set it to 0 here and push
# again. Behavior reverts to current (no gate).
ALERT_CONVICTION_GATES = {
    "UCT Alpha Gold": {
        # 2026-06-21 tune: lowered min_repeat_fires 2→0 after replay against
        # June 18 CSV showed min_repeat=2 yielded only 1-2 Discord posts/day,
        # while min_repeat=0 with max_per_ticker=1 yielded 15 high-quality
        # names (8 of 9 BBS picks matched + 7 additional A+/A grade calls).
        # Rationale: most institutional Alpha Gold sweeps are SINGLE large
        # block fills, not multi-fire campaigns. Requiring a second fire on
        # the same contract within 15min misses the majority of quality
        # setups. The max_per_ticker_per_day=1 cap is sufficient anti-spam
        # protection on its own — prevents MU x6 type floods.
        "min_repeat_fires": 0,
        "max_per_ticker_per_day": 1,    # one Alpha Gold per ticker per day
        "follow_through_window_sec": 900,  # unused at min_repeat=0; kept for future re-tune
    },
    # Other UCT alerts: leave them untuned for now. The Bullflow filters
    # (premium floor, side, trade types) already do most of the work for
    # Bullish/Bearish/Size/Leaps/Vol>OI/Unusual. Tune in the AlertTester first,
    # then add entries here as they're validated.
}


def _get_alert_gates(alert_name: str) -> dict:
    """Return the gates dict for this alert name, or empty dict (no gates)."""
    if not alert_name:
        return {}
    # Exact-name match. Could relax to substring later if needed, but exact
    # avoids accidental gating (e.g. "UCT Alpha Gold v2" wouldn't inherit
    # "UCT Alpha Gold" gates unless explicitly listed).
    return ALERT_CONVICTION_GATES.get(alert_name.strip(), {})


# Sliding-window timestamps per contract — used by the 2X filter only.
# Distinct from _contract_repeats because the WINDOW differs (15min vs 12hr).
# Same contract_key shape from _make_contract_key().
_follow_through_tracker: dict = {}   # contract_key -> [unix_ts, ...]

# Per-(alert_name, ticker) daily post tracker for the per-ticker cap. Resets
# implicitly when the date key changes; stale dates pruned lazily on read.
_alerts_posted_today: dict = {}      # date_iso -> set of (alert_name, ticker) tuples


def _track_follow_through_increment(alert: dict) -> int:
    """
    Called once per ACCEPTED alert in _ingest_alert (not on supersede or drop).
    Adds this alert's timestamp to the contract's bucket and returns the count
    of fires within the widest configured follow-through window.

    Tracks fires across ALL alert types (Bullish at 10:00 + Alpha Gold at
    10:05 counts as 2 follow-through fires) — institutional follow-through is
    a cross-tier signal, not Alpha-Gold-only.

    Uses the LONGEST follow_through_window_sec across all configured gates as
    the prune horizon, so any gate can read the value at forward-time. If no
    alerts are configured with the gate, defaults to 900s.
    """
    key = _make_contract_key(alert)
    now = time.time()
    # Find the widest window across all configured gates so we keep enough
    # history for whichever alert ends up reading it.
    max_window = max(
        (g.get("follow_through_window_sec", 0) for g in ALERT_CONVICTION_GATES.values()),
        default=900,
    ) or 900
    cutoff = now - max_window
    bucket = _follow_through_tracker.setdefault(key, [])
    bucket[:] = [t for t in bucket if t >= cutoff]
    bucket.append(now)
    return len(bucket)


def _count_follow_through_in_window(alert: dict, window_sec: int) -> int:
    """Read-only count of fires within an arbitrary window. Used by gates."""
    key = _make_contract_key(alert)
    cutoff = time.time() - max(0, window_sec)
    bucket = _follow_through_tracker.get(key, [])
    return sum(1 for t in bucket if t >= cutoff)


def _has_alert_posted_for_ticker_today(alert_name: str, ticker: str) -> bool:
    """True if this (alert_name, ticker) pair already posted to Discord today."""
    if not alert_name or not ticker:
        return False
    today_iso = datetime.now(ET).date().isoformat()
    return (alert_name, ticker.upper()) in _alerts_posted_today.get(today_iso, set())


def _mark_alert_posted_for_ticker(alert_name: str, ticker: str):
    """Record that this (alert_name, ticker) pair has posted today.

    Prunes stale dates inline since we only ever check today's set.
    """
    if not alert_name or not ticker:
        return
    today_iso = datetime.now(ET).date().isoformat()
    stale = [d for d in _alerts_posted_today if d != today_iso]
    for d in stale:
        del _alerts_posted_today[d]
    _alerts_posted_today.setdefault(today_iso, set()).add(
        (alert_name, ticker.upper())
    )


def _passes_alert_gates(alert: dict) -> tuple:
    """
    Returns (passes: bool, reason: str). Run inside _delayed_discord_forward,
    AFTER dedup but BEFORE Discord POST. Looks up per-alert config from
    ALERT_CONVICTION_GATES — alerts with no entry pass through unchanged.

    Two gates checked (in order):
      1. 2X follow-through: stamped count must be >= min_repeat_fires
      2. Per-ticker daily cap: (alert_name, ticker) must not have posted yet

    Either gate can be disabled by omitting the key (or setting to 0) in the
    gates dict.
    """
    name = (alert.get("alertName") or "").strip()
    gates = _get_alert_gates(name)
    if not gates:
        return True, ""

    # Gate 1: institutional follow-through
    min_fires = int(gates.get("min_repeat_fires", 0) or 0)
    if min_fires > 1:
        window_sec = int(gates.get("follow_through_window_sec", 900) or 900)
        # Prefer the stamped count (computed at ingest); fall back to a fresh
        # read if absent (older buffered alerts from before this code shipped).
        ft_count = alert.get("_followThroughCount")
        if ft_count is None:
            ft_count = _count_follow_through_in_window(alert, window_sec)
        if ft_count < min_fires:
            return False, f"below_2x:{ft_count}<{min_fires}"

    # Gate 2: per-ticker daily cap
    max_per_ticker = int(gates.get("max_per_ticker_per_day", 0) or 0)
    if max_per_ticker > 0:
        ticker = (alert.get("ticker") or "").upper()
        if _has_alert_posted_for_ticker_today(name, ticker):
            return False, f"ticker_capped:{ticker}_already_posted_today"

    return True, ""


# ─── Historical gate replay ──────────────────────────────────────────────────
# Pure function — takes a list of stored alerts (from live_alerts_db) and
# replays them through CURRENT ALERT_CONVICTION_GATES config to determine what
# WOULD have posted to Discord if those gates had been active when the alerts
# were originally ingested.
#
# Uses fresh per-call state (NOT the production module-level _follow_through_tracker
# or _alerts_posted_today) so this is safe to call from API endpoints without
# polluting live worker state. The live worker keeps tracking against its own
# real-time state; this function is read-only with respect to that.
#
# Returns the same alert dicts with new fields stamped on:
#   _replayedFollowThroughCount  — int, fires within window (incl. self)
#   _replayedGatePassed          — 1 if would have passed gates, 0 if not
#   _replayedGateReason          — str, empty if passed, otherwise drop reason
#   _replayedWouldForward        — 1 if would post to Discord, 0 if not
#
# Used by /api/live/alerts/history?replay_gates=1 to show "what if current
# gates were active on a past date" — useful for tuning thresholds against
# real historical data.
def replay_alerts_through_gates(alerts: list) -> list:
    """
    Replay historical alerts through current ALERT_CONVICTION_GATES.

    Operates on a list of alert dicts (typically from live_alerts_db.query_alerts).
    Sorts by ingestedAt ascending so follow-through windows compute correctly
    even if input is newest-first. Returns a NEW list of the same dicts with
    additional `_replayed*` fields stamped on each.

    Pure function: does NOT mutate production state, does NOT write to DB.
    Safe to call repeatedly with the same input — deterministic output.

    Uses the alert's RECORDED ingestedAt as the "now" for each gate check
    (not time.time()) so daily caps reset at the correct ET midnight and
    follow-through windows count the right fires.
    """
    if not alerts:
        return []

    # Local helper to parse ingestedAt (ISO string) → unix timestamp.
    # Falls back to `timestamp` field if ingestedAt is missing/malformed.
    def _to_unix(a):
        ts = a.get("ingestedAt") or a.get("timestamp")
        if ts is None:
            return 0.0
        if isinstance(ts, (int, float)):
            return float(ts)
        try:
            # ISO string — strip trailing Z, parse with timezone.
            s = str(ts).replace("Z", "+00:00")
            return datetime.fromisoformat(s).timestamp()
        except (ValueError, TypeError):
            return 0.0

    # Sort ascending by timestamp so follow-through windows accumulate correctly.
    sorted_alerts = sorted(alerts, key=_to_unix)

    # Fresh per-replay state (NOT the production module-level dicts).
    replay_follow_through: dict = {}  # contract_key -> [unix_ts, ...]
    replay_posted_today: dict = {}    # date_iso -> set of (alert_name, ticker)

    for a in sorted_alerts:
        name = (a.get("alertName") or "").strip()
        ticker = (a.get("ticker") or "").upper()
        alert_ts = _to_unix(a)

        # Always track follow-through (across all alert types, not just gated ones).
        # Mirrors the live worker's _track_follow_through_increment behavior.
        key = _make_contract_key(a)
        max_window = max(
            (g.get("follow_through_window_sec", 0) for g in ALERT_CONVICTION_GATES.values()),
            default=900,
        ) or 900
        cutoff = alert_ts - max_window
        bucket = replay_follow_through.setdefault(key, [])
        bucket[:] = [t for t in bucket if t >= cutoff]
        bucket.append(alert_ts)
        a["_replayedFollowThroughCount"] = len(bucket)

        # Look up gates for this alert name.
        gates = _get_alert_gates(name)
        if not gates:
            # No gates configured for this alert type — passes through unchanged.
            a["_replayedGatePassed"] = 1
            a["_replayedGateReason"] = ""
            a["_replayedWouldForward"] = 1
            continue

        # Gate 1: 2X follow-through within the alert's configured window.
        min_fires = int(gates.get("min_repeat_fires", 0) or 0)
        if min_fires > 1:
            window_sec = int(gates.get("follow_through_window_sec", 900) or 900)
            cutoff_specific = alert_ts - window_sec
            ft_in_window = sum(1 for t in bucket if t >= cutoff_specific)
            if ft_in_window < min_fires:
                a["_replayedGatePassed"] = 0
                a["_replayedGateReason"] = f"below_2x:{ft_in_window}<{min_fires}"
                a["_replayedWouldForward"] = 0
                continue

        # Gate 2: per-ticker daily cap. Date is computed from the alert's
        # recorded timestamp in ET so the cap resets at the correct midnight.
        max_per_ticker = int(gates.get("max_per_ticker_per_day", 0) or 0)
        if max_per_ticker > 0:
            try:
                alert_et_date = datetime.fromtimestamp(alert_ts, tz=timezone.utc).astimezone(ET).date().isoformat()
            except (OverflowError, ValueError):
                alert_et_date = "1970-01-01"
            posted_set = replay_posted_today.setdefault(alert_et_date, set())
            if (name, ticker) in posted_set:
                a["_replayedGatePassed"] = 0
                a["_replayedGateReason"] = f"ticker_capped:{ticker}_already_posted_that_day"
                a["_replayedWouldForward"] = 0
                continue
            # Passed the cap — mark this ticker as posted for that date.
            posted_set.add((name, ticker))

        # All gates passed.
        a["_replayedGatePassed"] = 1
        a["_replayedGateReason"] = ""
        a["_replayedWouldForward"] = 1

    return sorted_alerts


# ─── Sweep+Block combo detection — DEFERRED ──────────────────────────────────
# Bullflow's SSE payload does NOT currently include an explicit sweep/block
# tag — we only get alertType ("custom" vs "algo") and alertName. Without a
# way to tell sweeps from blocks at ingest time, live combo detection here
# requires one of:
#   (a) Inspecting the raw Bullflow SSE event payload to confirm tradeType
#       isn't there under another field name (needs a debug capture)
#   (b) Schwab tape lookup per alert to determine execution type (adds latency)
#
# Until that's wired up, combo detection stays simulator-only. The 2X
# follow-through filter and per-ticker cap above cover most of the noise
# reduction the combo rule was added to provide.



def _make_contract_key(alert: dict) -> tuple:
    """
    Contract key for repeat counter. INTENTIONALLY excludes premium and fill,
    so we count distinct trades ON the same contract (different prices).
    """
    return (
        (alert.get("ticker") or "").upper(),
        alert.get("cp") or "",
        alert.get("strike"),
        alert.get("exp") or "",
    )


def _prune_repeat_cache():
    """Drop repeat entries older than REPEAT_WINDOW_SEC. Lazy cleanup on read."""
    cutoff = time.time() - REPEAT_WINDOW_SEC
    expired = [k for k, v in _contract_repeats.items() if v["first_seen"] < cutoff]
    for k in expired:
        del _contract_repeats[k]


def _track_repeat(alert: dict) -> int:
    """
    Increment the repeat count for this alert's contract. Returns the new
    count (1 if first fire on contract today, 2 if second distinct trade…).
    Called only on accepted alerts — identical-trade duplicates and superseded
    alerts intentionally don't bump the count because they're the same trade.
    """
    _prune_repeat_cache()
    key = _make_contract_key(alert)
    entry = _contract_repeats.get(key)
    if not entry:
        _contract_repeats[key] = {
            "count": 1,
            "first_seen": time.time(),
            "first_alert_id": alert.get("id"),
        }
        return 1
    entry["count"] += 1
    return entry["count"]


# ─── Contract aggregation for Discord ─────────────────────────────────────────
# When multiple distinct trades fire on the same contract (e.g. today's MU
# 1000P firing 8 times), we want ONE evolving Discord post — not 8 separate
# messages. This cache holds per-contract running totals; the Discord forwarder
# creates a post on the first fire and EDITS it on subsequent fires via the
# webhook PATCH endpoint.
#
# Reset behavior: keyed by (contract_key, YYYY-MM-DD). New trading day starts
# a fresh aggregate even if the worker has been up for >24 hours. In-memory
# only — if worker restarts mid-day, the next fire on a contract creates a
# new Discord post (mild duplication, acceptable trade-off).

_contract_aggregates: dict = {}  # contract_key -> {date, ...fields, message_id, ...}


def _aggregate_key(alert: dict, today_iso: str) -> tuple:
    return (_make_contract_key(alert), today_iso)


def _update_aggregate(alert: dict) -> dict:
    """
    Update the running aggregate for this alert's contract. Returns the
    current aggregate dict (a live reference, mutated each call).

    Always call this AFTER _track_repeat and _enrich_with_oi so that the
    aggregate has access to enriched fields. Called on accept only.
    """
    today_iso = datetime.now().date().isoformat()
    key = _aggregate_key(alert, today_iso)

    premium = float(alert.get("alertPremium") or 0)
    fill = alert.get("averageFillPrice")
    size = alert.get("tradeSize") or 0
    name = (alert.get("alertName") or "").strip()
    ts = alert.get("timestamp") or time.time()

    agg = _contract_aggregates.get(key)
    if not agg:
        # First fire on this contract today — initialize from current alert.
        agg = {
            "contract_key": key[0],
            "date": today_iso,
            "ticker": alert.get("ticker"),
            "cp": alert.get("cp"),
            "strike": alert.get("strike"),
            "exp": alert.get("exp"),
            "dte": alert.get("dte"),
            "alert_type": alert.get("alertType"),
            "total_premium": premium,
            "max_premium": premium,
            "total_size": size,
            "max_size": size,
            "fire_count": 1,
            "first_fire_ts": ts,
            "last_fire_ts": ts,
            "first_fill_price": fill,
            "last_fill_price": fill,
            # The "best" alert name seen so far (lowest priority number wins).
            # On first fire it's just whatever fired. As more arrive with
            # higher-priority names, we promote.
            "best_alert_name": name,
            "best_alert_priority": _alert_priority(alert),
            # Set of all distinct alert names seen — surfaced in Discord
            # embed as "UCT Bearish + 2 others" or similar.
            "alert_names_seen": {name} if name else set(),
            # OI snapshot — captured once on first fire (assumes OI doesn't
            # change intraday; safe since snapshots reflect prior-day close).
            "prior_oi": alert.get("priorOI"),
            "oi_snapshot_date": alert.get("oiSnapshotDate"),
            # Spot price + moneyness — updated on every fire so the title
            # reflects the most recent price (price drifts intraday, even
            # 2-3% can flip a contract between ITM/OTM categorization).
            "spot": alert.get("spot"),
            "moneyness_pct": alert.get("moneynessPct"),
            "moneyness_label": alert.get("moneynessLabel"),
            # Discord message handle (set after first successful POST).
            "discord_message_id": None,
            "discord_webhook_base": None,  # the URL we POSTed to, for PATCH
        }
        _contract_aggregates[key] = agg
        return agg

    # Subsequent fire — update running totals.
    agg["total_premium"] += premium
    agg["max_premium"] = max(agg["max_premium"], premium)
    agg["total_size"] = (agg["total_size"] or 0) + size
    agg["max_size"] = max(agg["max_size"] or 0, size)
    agg["fire_count"] += 1
    agg["last_fire_ts"] = ts
    agg["last_fill_price"] = fill
    if name:
        agg["alert_names_seen"].add(name)
    # Promote best alert name if this one has higher priority (lower number).
    new_pri = _alert_priority(alert)
    if new_pri < agg["best_alert_priority"]:
        agg["best_alert_name"] = name
        agg["best_alert_priority"] = new_pri
    # Backfill OI if we didn't have it on first fire and the new alert did
    # — covers cases where the snapshot cron caught up mid-day.
    if agg["prior_oi"] is None and alert.get("priorOI") is not None:
        agg["prior_oi"] = alert.get("priorOI")
        agg["oi_snapshot_date"] = alert.get("oiSnapshotDate")
    # Always refresh moneyness — spot price changes through the day, so the
    # latest fire has the most accurate ITM/OTM picture.
    if alert.get("spot") is not None:
        agg["spot"] = alert.get("spot")
        agg["moneyness_pct"] = alert.get("moneynessPct")
        agg["moneyness_label"] = alert.get("moneynessLabel")
    return agg


def _prune_aggregates():
    """Drop yesterday's aggregates so the cache doesn't grow unbounded."""
    today_iso = datetime.now().date().isoformat()
    expired = [k for k, v in _contract_aggregates.items() if v.get("date") != today_iso]
    for k in expired:
        del _contract_aggregates[k]


# ─── OI snapshot lookup ──────────────────────────────────────────────────────
# Wires Bullflow live alerts to our daily Schwab OI snapshot data captured by
# api/oi_snapshots.py. The snapshot cron runs at 5:30 UTC = 1:30 AM ET daily,
# so by 9:30 ET market open we have today's snapshot reflecting yesterday's
# closing OI. Each incoming alert is enriched with:
#   - tradeSize:        contracts traded (derived: premium / fill / 100)
#   - priorOI:          most recent snapshot OI for this contract
#   - oiSnapshotDate:   when that OI was captured (sanity check)
#   - volumeOIRatio:    tradeSize / priorOI — anything > 1.0 means a single
#                       trade exceeded all prior open interest (institutional)
#   - oiExceeded:       True if volumeOIRatio > 1.0
#
# Caching: per-contract result cached for the day. MU 1000P firing 8 times
# hits SQLite once. Cache invalidates at midnight when the day key rolls.
#
# Failure mode: any error → fields set to None/False, alert still flows. The
# OI badge just doesn't render. Worker keeps running.

_OI_LOOKUP_MAX_DAYS_BACK = 5     # walk back this many days to find a snapshot
_oi_cache: dict = {}             # cache_key -> (oi, snap_date_iso) | None
_oi_cache_date: str = ""         # YYYY-MM-DD — invalidates when day changes


def _exp_iso_to_mdy(exp_iso: str) -> str:
    """Convert ISO '2026-06-26' → BBS 'M/D/YYYY' format used in snapshot keys."""
    if not exp_iso or "-" not in exp_iso:
        return ""
    parts = exp_iso.split("-")
    if len(parts) != 3:
        return ""
    try:
        return f"{int(parts[1])}/{int(parts[2])}/{int(parts[0])}"
    except (ValueError, IndexError):
        return ""


def _lookup_prior_oi(ticker, cp, strike, exp_iso):
    """
    Look up the most recent OI snapshot for a contract. Returns (oi, snap_date)
    tuple or None. Walks back up to _OI_LOOKUP_MAX_DAYS_BACK days to handle
    weekends/holidays/skipped cron runs.

    Cached per-contract for the calendar day to avoid hammering SQLite when
    the same contract fires many alerts (e.g. today's MU 1000P 6/26).
    """
    global _oi_cache, _oi_cache_date

    today_iso = datetime.now().date().isoformat()
    if _oi_cache_date != today_iso:
        _oi_cache.clear()
        _oi_cache_date = today_iso

    cache_key = f"{ticker}|{cp}|{strike}|{exp_iso}"
    if cache_key in _oi_cache:
        return _oi_cache[cache_key]

    result = None
    try:
        # Lazy import: keeps liveflow_worker bootable even if oi_snapshots
        # has import issues on Railway (e.g. flow.db not mounted yet).
        from api import oi_snapshots

        exp_mdy = _exp_iso_to_mdy(exp_iso or "")
        if exp_mdy and ticker and cp and strike is not None:
            key = oi_snapshots.make_key(ticker, cp, strike, exp_mdy)
            today = datetime.now().date()
            for delta in range(_OI_LOOKUP_MAX_DAYS_BACK + 1):
                snap_date_iso = (today - timedelta(days=delta)).isoformat()
                snap = oi_snapshots.get_snapshot(key, snap_date_iso)
                if snap is not None:
                    # snap = (oi, source) — only need OI here
                    result = (snap[0], snap_date_iso)
                    break
    except Exception as e:
        log.debug("[liveflow] OI lookup failed for %s: %s", cache_key, e)

    _oi_cache[cache_key] = result
    return result


def _enrich_with_oi(alert: dict):
    """
    Mutates `alert` in-place adding OI enrichment fields. Always sets all four
    fields (None / False on miss) so the frontend can render conditionally
    without null-checking each individually.
    """
    premium = float(alert.get("alertPremium") or 0)
    fill = float(alert.get("averageFillPrice") or 0)
    trade_size = round(premium / (fill * 100)) if fill > 0 else None
    alert["tradeSize"] = trade_size

    snap = _lookup_prior_oi(
        alert.get("ticker"), alert.get("cp"),
        alert.get("strike"), alert.get("exp"),
    )
    if snap and trade_size and snap[0] > 0:
        oi, snap_date = snap
        ratio = round(trade_size / oi, 2)
        alert["priorOI"] = oi
        alert["oiSnapshotDate"] = snap_date
        alert["volumeOIRatio"] = ratio
        alert["oiExceeded"] = ratio > 1.0
    else:
        # Either no snapshot, no fill price, or OI is 0. Set defaults so
        # frontend has stable shape and doesn't render a misleading badge.
        alert["priorOI"] = snap[0] if snap else None
        alert["oiSnapshotDate"] = snap[1] if snap else None
        alert["volumeOIRatio"] = None
        alert["oiExceeded"] = False


# ─── Spot price + moneyness enrichment ───────────────────────────────────────
# Bullflow's streaming payload doesn't include spot price, but we need it to
# compute how deep ITM/OTM a contract is — a key signal for distinguishing
# high-delta directional bets (deep ITM) from lottery plays (far OTM).
#
# Strategy: call Schwab's equity quote endpoint, cache results per-symbol with
# a 2-minute TTL. Same MU ticker firing 8 times in 2 hours hits Schwab once.
# Moneyness recomputed per alert though (price drifts intraday).
#
# Failure mode: any error → fields set to None, alert still flows. Title
# format gracefully omits the moneyness suffix when data isn't available.

SPOT_CACHE_TTL_SEC = 120          # 2 min — spot rarely moves 1%+ in that window
_spot_cache: dict = {}            # symbol → (price, cached_at_ts)


async def _get_cached_spot(symbol):
    """Fetch spot price for an equity, using a short-TTL cache. Returns
    float price or None. Safe to call concurrently — last write wins on
    cache update which is fine since values are functionally equivalent."""
    if not symbol:
        return None
    # Skip indexes / unusual symbols that Schwab's equity endpoint won't quote.
    if symbol.startswith("$") or "." in symbol:
        return None

    now = time.time()
    cached = _spot_cache.get(symbol)
    if cached and (now - cached[1]) < SPOT_CACHE_TTL_SEC:
        return cached[0]

    try:
        from api import schwab_service
        price = await schwab_service.get_equity_quote(symbol)
        if price:
            _spot_cache[symbol] = (price, now)
            return price
    except Exception as e:
        log.debug("[liveflow] spot lookup failed for %s: %s", symbol, e)
    return None


def _calc_moneyness(spot, strike, cp):
    """
    Returns (pct, label) tuple. Sign convention: positive % = ITM, negative = OTM.
    Calls: ITM when spot > strike. Puts: ITM when spot < strike.
    Within ±1% → ATM (no meaningful direction); avoids spurious "+0.3% ITM" noise.
    """
    if not spot or not strike or strike <= 0:
        return (None, None)
    spot_f = float(spot)
    strike_f = float(strike)
    if cp == "C":
        pct = (spot_f - strike_f) / strike_f * 100
    elif cp == "P":
        pct = (strike_f - spot_f) / strike_f * 100
    else:
        return (None, None)
    if abs(pct) < 1.0:
        return (pct, "ATM")
    return (pct, "ITM" if pct > 0 else "OTM")


async def _enrich_with_moneyness(alert: dict):
    """
    Adds spot, moneynessPct, moneynessLabel fields to the alert. Async because
    Schwab quote lookup is async. Always sets the three fields (None on miss).
    """
    spot = await _get_cached_spot(alert.get("ticker"))
    if not spot:
        alert["spot"] = None
        alert["moneynessPct"] = None
        alert["moneynessLabel"] = None
        return
    alert["spot"] = round(spot, 2)
    pct, label = _calc_moneyness(spot, alert.get("strike"), alert.get("cp"))
    alert["moneynessPct"] = round(pct, 1) if pct is not None else None
    alert["moneynessLabel"] = label


def _make_dedup_key(alert: dict) -> tuple:
    """
    Per user spec (2026-06-18): dedup on ticker + cp + strike + exp + premium
    + avgFill. Including premium AND fill ensures legitimately different trades
    on the same contract (DRAM 80C 9/18 at $575K @ $12.20 vs $595K @ $12.25)
    stay as separate alerts, while genuine same-trade duplicates collapse.
    Premium rounded to nearest dollar, fill rounded to 2dp to absorb minor
    float drift between Bullflow's algo + custom alert paths.
    """
    return (
        (alert.get("ticker") or "").upper(),
        alert.get("cp") or "",
        alert.get("strike"),
        alert.get("exp") or "",
        round(float(alert.get("alertPremium") or 0)),
        round(float(alert.get("averageFillPrice") or 0), 2),
    )


def _alert_priority(alert: dict) -> int:
    """
    LOWER number = HIGHER priority (wins over higher numbers in dedup).
    Aligned with the tier ordering in LiveFlow.jsx so the table and Discord
    show the same conviction signal subscribers expect.
    """
    name = (alert.get("alertName") or "").strip()
    alert_type = (alert.get("alertType") or "").lower()
    # Bullflow's native alerts (Sizable Sweep, etc.) lose to any UCT alert.
    if alert_type == "algo":
        return 100
    if "Alpha Gold" in name:
        return 1
    if "Size" in name:                  # UCT Size Bulls / UCT Size Bears
        return 2
    if "Bullish" in name or "Bearish" in name:
        # LEAPS variants come slightly behind regular directional since users
        # generally weight short-term flow heavier than long-dated.
        return 4 if "Leaps" in name else 3
    if "Leaps" in name:                 # neutral "UCT Leaps" (no direction)
        return 5
    if "Unusual" in name or "Vol>OI" in name:
        return 6
    if "ETF Flow" in name:
        # ETF Flow is a category tier (broad market positioning on SPX/SPXW/
        # GLD/SMH/etc), not a conviction tier. Priority 6 = same level as
        # Unusual/Vol>OI so it doesn't outrank single-name Alpha Gold signals
        # but stays above any unrecognized UCT alert.
        return 6
    return 90  # Unknown UCT alert — still beats ALGO


def _prune_dedup_cache():
    """Drop dedup entries older than DEDUP_WINDOW_SEC to bound memory."""
    cutoff = time.time() - DEDUP_WINDOW_SEC
    expired = [k for k, v in _dedup_cache.items() if v["first_seen"] < cutoff]
    for k in expired:
        del _dedup_cache[k]


def _dedup_check(alert: dict) -> tuple:
    """
    Returns one of:
      ("accept", None)         — first time seeing this trade; add + forward
      ("supersede", old_id)    — new alert beats existing; mark old superseded
      ("drop", reason_str)     — new alert loses to existing; ignore entirely
    """
    _prune_dedup_cache()
    key = _make_dedup_key(alert)
    new_priority = _alert_priority(alert)
    existing = _dedup_cache.get(key)

    if not existing:
        _dedup_cache[key] = {
            "alert_id": alert.get("id"),
            "priority": new_priority,
            "first_seen": time.time(),
        }
        return ("accept", None)

    if new_priority < existing["priority"]:
        old_id = existing["alert_id"]
        _dedup_cache[key] = {
            "alert_id": alert.get("id"),
            "priority": new_priority,
            # Keep original timestamp so the dedup window doesn't extend
            # indefinitely as supersedes happen.
            "first_seen": existing["first_seen"],
        }
        return ("supersede", old_id)

    return ("drop", f"dupe_of:{existing['alert_id']}:p{existing['priority']}")


# ─── Conviction scoring — REMOVED 2026-06-17 ─────────────────────────────────
# Previously this module computed per-alert conviction scores using substring
# matching against alertName plus premium tiers, then gated Discord forwarding
# on a score >= threshold check.
#
# That layer is gone because conviction is now expressed directly in Bullflow's
# custom alert filters. When you create/edit a `UCT *` alert in Bullflow's UI,
# you stack quick filters (Sweeps + Ask + Bullish + High Sig + Vol>OI + etc).
# A trade that fires that alert has already passed every conviction criterion
# you encoded into the alert. Re-scoring it server-side would be duplicative
# and lossy (we'd be guessing at filters we already pre-committed to).
#
# Result: every alert that passes TABLE_FILTER is now forwarded to Discord.
# The `convictionScore` field on each alert remains in the payload (set to
# None) so the frontend rendering code keeps working unchanged. We can wire
# scoring back in later if a useful signal-on-top-of-filters emerges.

# ─── State (module-level; single event loop = no lock needed) ────────────────
_alerts: deque = deque(maxlen=MAX_BUFFER)
_status = {
    "connected": False,
    "last_event_at": None,
    "total_alerts_received": 0,    # everything from Bullflow, pre-filter
    "total_alerts_shown": 0,       # passed table filter
    "total_alerts_dropped": 0,     # failed table filter
    "total_alerts_forwarded": 0,   # passed Discord threshold
    "total_alerts_grade_gated": 0, # below MIN_DISCORD_GRADE — silently aggregated
    "total_alerts_gate_blocked": 0, # blocked by per-alert conviction gates
    "last_error": None,
    "last_discord_error": None,
    "started_at": None,
    "reconnect_count": 0,
    "discord_configured": bool(DISCORD_WEBHOOK_URL),
    # Echo filter config so frontend can display "what's active" w/o hardcoding
    "filter_config": {
        "premium_min": TABLE_FILTER["premium_min"],
        "ticker_blocklist": sorted(TABLE_FILTER["ticker_blocklist"]),
        "alertname_block_substrings": list(TABLE_FILTER["alertname_block_substrings"]),
        # Conviction grade gate for Discord (2026-06-18) — only post B+ by default.
        # Tunable via MIN_DISCORD_GRADE env var.
        "discord_min_grade": MIN_DISCORD_GRADE,
        "discord_threshold": None,
        # Per-alert ticker exclusions (e.g. mega-caps blocked on Unusual scans).
        "per_alert_blocklists": {
            name: sorted(tickers) for name, tickers in ALERT_TICKER_BLOCKLISTS.items()
        },
        # User-managed blocklist — read fresh from module-level set each call
        # so the API echoes the current state, not a snapshot at startup.
        "user_ticker_blocklist": sorted(_user_ticker_blocklist),
        # Per-alert conviction gates (2026-06-21) — 2X follow-through and
        # per-ticker daily cap. Empty/missing alert names have no gates applied.
        "alert_conviction_gates": {
            name: dict(g) for name, g in ALERT_CONVICTION_GATES.items()
        },
    },
}

# ─── OCC symbol parser (unchanged from Phase A) ──────────────────────────────
_OCC_RE = re.compile(r"^O:([A-Z0-9]+?)(\d{6})([CP])(\d{8})$")


def parse_occ_symbol(symbol: str) -> dict:
    empty = {"ticker": None, "exp": None, "cp": None, "strike": None, "dte": None}
    if not symbol or not symbol.startswith("O:"):
        return empty
    m = _OCC_RE.match(symbol)
    if not m:
        return empty
    ticker, yymmdd, cp, strike_str = m.groups()
    try:
        year = 2000 + int(yymmdd[:2])
        exp_date = datetime(year, int(yymmdd[2:4]), int(yymmdd[4:6])).date()
    except ValueError:
        return {**empty, "ticker": ticker, "cp": cp}
    strike = int(strike_str) / 1000.0
    today = datetime.now(timezone.utc).date()
    dte = (exp_date - today).days
    return {
        "ticker": ticker,
        "exp": exp_date.strftime("%Y-%m-%d"),
        "cp": cp,
        "strike": strike,
        "dte": dte,
    }


# ─── Filter Engine ───────────────────────────────────────────────────────────
def _passes_table_filter(alert_name, premium, ticker):
    """
    Returns (passes: bool, reason: str). Reason is "" on pass, short token on fail.
    Reason strings aren't surfaced to UI yet but kept for future debug visibility.
    """
    if not premium or premium < TABLE_FILTER["premium_min"]:
        return False, f"premium<{TABLE_FILTER['premium_min']}"
    if ticker and ticker.upper() in TABLE_FILTER["ticker_blocklist"]:
        return False, f"ticker_blocked:{ticker}"
    # User-curated blocklist — managed live via admin UI, persisted to disk.
    # Applies globally across all alerts (unlike ALERT_TICKER_BLOCKLISTS).
    if ticker and ticker.upper() in _user_ticker_blocklist:
        return False, f"user_blocked:{ticker}"
    name_lc = (alert_name or "").lower()
    for sub in TABLE_FILTER["alertname_block_substrings"]:
        if sub.lower() in name_lc:
            return False, f"name_blocked:{sub}"
    # Per-alert ticker blocklists supplementing the global block. Lookup uses
    # the stripped name because Bullflow sometimes stores names with trailing
    # whitespace (e.g. "UCT Bullish " — confirmed in 2026-06-17 audit).
    alert_key = (alert_name or "").strip()
    alert_blocklist = ALERT_TICKER_BLOCKLISTS.get(alert_key)
    if alert_blocklist and ticker and ticker.upper() in alert_blocklist:
        return False, f"alert_blocked:{alert_key}:{ticker}"
    return True, ""


# ─── Discord forwarder ───────────────────────────────────────────────────────
def _compute_conviction(agg: dict) -> tuple:
    """
    Composite conviction score from aggregate state. Returns (score_0_to_10,
    letter_grade). Inputs use what we already track — no new lookups needed.

    Weights (0-12 total, capped at 10):
      Premium tier:       0-3     (whale > big > medium > standard > small)
      OI Break:           0-2     (size > priorOI = institutional positioning)
      Repeat count:       0-2     (5x+ sustained > mild > none)
      Best alert tier:    0-3     (Alpha Gold heavily weighted)
      Moneyness:          0-1     (near-strike > deep OTM)
      Multi-alert match:  0-1     (2+ tiers fired same trade = overlap)

    Calibrated against real cards from 2026-06-18 session: AVGO Alpha Gold
    $1.27M near-ATM lands at B; DDOG Alpha Gold $3.22M deep ITM at A+;
    MU multi-fire $22M at A+; small lottery stays at D.
    """
    score = 0.0

    # Premium tier (0-3): wider band so $1M Alpha Gold gets meaningful credit
    total_prem = agg.get("total_premium") or 0
    if total_prem >= 5_000_000:
        score += 3.0
    elif total_prem >= 2_000_000:
        score += 2.5
    elif total_prem >= 1_000_000:
        score += 2.0
    elif total_prem >= 500_000:
        score += 1.5
    else:
        score += 0.75

    # OI Break (0-2): full points when single trade exceeded prior OI;
    # scaled by ratio magnitude (10x+ = massive accumulation vs noise).
    total_size = agg.get("total_size") or 0
    prior_oi = agg.get("prior_oi") or 0
    if prior_oi > 0 and total_size > prior_oi:
        ratio = total_size / prior_oi
        if ratio >= 5.0:
            score += 2.0
        elif ratio >= 2.0:
            score += 1.5
        else:
            score += 1.0

    # Repeat count (0-2): more fires = more sustained conviction.
    fire_count = agg.get("fire_count") or 1
    if fire_count >= 5:
        score += 2.0
    elif fire_count >= 3:
        score += 1.5
    elif fire_count >= 2:
        score += 1.0

    # Best alert tier (0-3): Alpha Gold is the rarest catch and deserves
    # significant weight. Calibration: a clean Alpha Gold + $1M+ premium
    # should land at B minimum (subscribers expect Alpha Gold = strong signal).
    best_pri = agg.get("best_alert_priority") or 99
    if best_pri == 1:        # Alpha Gold
        score += 3.0
    elif best_pri == 2:      # Size Bulls/Bears
        score += 2.0
    elif best_pri == 3:      # Bullish/Bearish
        score += 1.25
    elif best_pri == 4:      # LEAPS directional
        score += 1.0
    elif best_pri == 5:      # Leaps neutral
        score += 0.75
    else:                    # Unusual / Vol>OI / unknown
        score += 0.5

    # Moneyness (0-1): near-strike = high delta directional; far OTM = lottery.
    # OTM stored as positive magnitude per recent change — use abs() to be safe.
    money_pct = agg.get("moneyness_pct")
    money_label = agg.get("moneyness_label")
    if money_label == "ITM":
        if money_pct and 5 <= money_pct <= 30:
            score += 1.0   # sweet spot for directional bets
        else:
            score += 0.75
    elif money_label == "ATM":
        score += 0.75
    elif money_label == "OTM" and money_pct is not None:
        ap = abs(money_pct)
        if ap <= 5:
            score += 0.6   # near-the-money OTM still meaningful
        elif ap <= 15:
            score += 0.3   # moderate OTM
        # deep OTM (>15%) = lottery; no bonus

    # Multi-alert match (0-1): 2+ UCT tiers catching the same trade is real
    # confirmation that multiple conviction criteria agreed.
    names_seen = agg.get("alert_names_seen") or set()
    if len(names_seen) >= 3:
        score += 1.0
    elif len(names_seen) == 2:
        score += 0.6

    # Map to letter grade. Calibrated so A+ requires multi-criteria excellence
    # (rare — maybe 1-2% of daily alerts); B is the "respectable single signal"
    # baseline; D filters out sub-million lottery noise.
    score = min(score, 10.0)
    if score >= 8.5:
        grade = "A+ 🚀"
    elif score >= 7.0:
        grade = "A"
    elif score >= 5.5:
        grade = "B"
    elif score >= 3.5:
        grade = "C"
    else:
        grade = "D"

    return (round(score, 1), grade)


def _derive_direction(agg: dict) -> str:
    """
    Return 'Bullish' / 'Bearish' / 'Neutral' label for the embed.

    Most cases are trivial (call = bullish, put = bearish). For mixed-direction
    alert tiers (Alpha Gold, Vol>OI, Unusual) where alertName doesn't carry
    direction, we still classify by C/P since the buyer of a call is
    directionally bullish on the underlying regardless of which alert fired.
    """
    cp = (agg.get("cp") or "").upper()
    if cp == "C":
        return "Bullish"
    if cp == "P":
        return "Bearish"
    return "Neutral"


def _build_embed(agg: dict) -> dict:
    """
    Build the Discord embed dict from an aggregate. Same builder used for
    both POST (initial) and PATCH (update) so the layout is consistent —
    only differences are the running totals that change between calls.
    """
    cp = agg.get("cp") or "?"
    ticker = agg.get("ticker") or "?"
    strike = agg.get("strike")
    exp = agg.get("exp") or "?"
    dte = agg.get("dte")
    fire_count = agg.get("fire_count") or 1
    total_prem = agg.get("total_premium") or 0
    max_prem = agg.get("max_premium") or 0
    total_size = agg.get("total_size") or 0
    last_fill = agg.get("last_fill_price")
    prior_oi = agg.get("prior_oi")
    best_name = agg.get("best_alert_name") or "Alert"
    names_seen = agg.get("alert_names_seen") or set()

    # Color by direction (calls=green, puts=red, fallback amber).
    color = 0x3CB868 if cp == "C" else (0xE74C3C if cp == "P" else 0xc9a84c)
    strike_str = f"${strike:g}" if strike is not None else "?"
    dte_str = f"{dte}d" if dte is not None else "?"

    def _fmt_money(n):
        if n >= 1_000_000:
            return f"${n/1_000_000:.2f}M"
        return f"${n/1_000:.0f}K"

    total_prem_str = _fmt_money(total_prem)
    max_prem_str = _fmt_money(max_prem)
    fill_str = f"${last_fill:.2f}" if last_fill is not None else "?"

    # Vol/OI computed over the TOTAL (aggregated) volume vs prior OI — much
    # more meaningful than per-trade ratio when a contract fires many times.
    vol_oi_ratio = None
    oi_exceeded = False
    if prior_oi and prior_oi > 0 and total_size:
        vol_oi_ratio = round(total_size / prior_oi, 2)
        oi_exceeded = vol_oi_ratio > 1.0

    # Badge line in description. Shown above the data fields.
    badges = []
    if oi_exceeded and vol_oi_ratio:
        badges.append(f"🚀 **OI BREAK** {vol_oi_ratio:.1f}x")
    if fire_count > 1:
        badges.append(f"🔁 **{fire_count}x** today")

    # Core fields. Same 3-per-row layout as before via inline=True.
    fields = [
        {"name": "Total Premium" if fire_count > 1 else "Premium",
         "value": total_prem_str, "inline": True},
        {"name": "Largest" if fire_count > 1 else "Avg Fill",
         "value": max_prem_str if fire_count > 1 else fill_str, "inline": True},
        {"name": "DTE", "value": dte_str, "inline": True},
    ]
    # Enrichment row — only show when data is available so we don't render
    # rows of "—" placeholders.
    # Naming convention (Tradytics/BlackBox style):
    #   - "Volume" = cumulative contracts traded across UCT-alerted trades
    #     on this contract today. On a single-fire alert this equals the
    #     one trade's size; on multi-fire it's the running sum.
    #   - "OI" = prior open interest (yesterday's close) from our snapshot.
    #   - "Vol/OI" = Volume / OI, the standard unusual-activity ratio.
    if total_size:
        fields.append({"name": "Volume", "value": f"{total_size:,}", "inline": True})
    if prior_oi is not None:
        fields.append({"name": "OI", "value": f"{prior_oi:,}", "inline": True})
    if vol_oi_ratio is not None:
        fields.append({"name": "Vol/OI", "value": f"{vol_oi_ratio:.2f}x", "inline": True})

    # For multi-fire aggregates, show fill price + time range so user can see
    # how the trade pattern evolved.
    if fire_count > 1:
        fields.append({"name": "Latest Fill", "value": fill_str, "inline": True})
        first_ts = agg.get("first_fire_ts")
        last_ts = agg.get("last_fire_ts")
        if first_ts and last_ts:
            # Convert UNIX timestamp to Eastern time (market hours). Worker
            # runs on Railway in UTC; without explicit conversion fromtimestamp
            # returns the server's local time which displays as UTC labeled "ET".
            # %-I = hour without leading zero (Linux); %p = AM/PM.
            first_t = datetime.fromtimestamp(first_ts, tz=ET).strftime("%-I:%M %p")
            last_t = datetime.fromtimestamp(last_ts, tz=ET).strftime("%-I:%M %p")
            fields.append({"name": "Active From", "value": f"{first_t} → {last_t} ET", "inline": True})

    # Spot price — sits next to the trade data so subscribers can sanity-check
    # the strike against current underlying. The moneyness % itself lives in
    # the title (next to ticker/strike) where direction is most relevant.
    spot = agg.get("spot")
    if spot is not None:
        fields.append({"name": "Spot", "value": f"${spot:,.2f}", "inline": True})

    # Direction — explicit Bullish/Bearish label so subscribers don't have to
    # infer from C/P + alert name. Calls = Bullish, Puts = Bearish (the trader
    # buying the option is directionally betting that way regardless of which
    # UCT alert tier caught it).
    direction = _derive_direction(agg)
    if direction != "Neutral":
        fields.append({"name": "Direction", "value": direction, "inline": True})

    # Conviction — composite grade from premium tier, OI break, repeat count,
    # alert tier, moneyness, and multi-alert overlap. Hidden for D-grade
    # signals (don't want to discourage subscribers from acting on weak setups
    # by labeling them — let them decide; we only surface a grade when there's
    # real signal to communicate).
    conv_score, conv_grade = _compute_conviction(agg)
    if conv_grade != "D":
        fields.append({"name": "Conviction", "value": conv_grade, "inline": True})

    # Alert label: show the best (highest-priority) name; if multiple distinct
    # names fired, add a "+N more" suffix so subscribers see the diversity.
    # Type field removed — source is already conveyed via the embed footer.
    extras = len(names_seen) - 1
    alert_label = best_name
    if extras > 0:
        alert_label = f"{best_name}  +{extras} more"
    fields.append({"name": "Alert", "value": alert_label, "inline": True})

    # Title: ticker + strike + CALL/PUT + exp (US date), with moneyness suffix
    # when available.
    # Format examples:
    #   "MSTR $110 CALL 07-17-2026 (1% OTM)"
    #   "MU $1000 PUT 06-26-2026 (13% ITM)"
    #   "ARM $130 CALL 08-15-2026 (ATM)"
    # No moneyness suffix when spot lookup failed (graceful degradation).
    # Magnitude only — the label already conveys direction. Matches Tradytics/
    # BlackBox convention.
    moneyness_pct = agg.get("moneyness_pct")
    moneyness_label = agg.get("moneyness_label")
    # Expand C/P to full words for clarity (calls/puts more readable than 1-letter)
    cp_label = "CALL" if cp == "C" else ("PUT" if cp == "P" else cp)
    # Convert exp ISO 'YYYY-MM-DD' → US 'MM-DD-YYYY' format. Bullflow's stream
    # gives us ISO; subscribers are US-based and parse MM-DD-YYYY faster.
    exp_us = exp
    if exp and "-" in exp:
        parts = exp.split("-")
        if len(parts) == 3:
            try:
                exp_us = f"{int(parts[1]):02d}-{int(parts[2]):02d}-{int(parts[0])}"
            except (ValueError, IndexError):
                pass  # leave as-is on malformed input
    title_base = f"{ticker} {strike_str} {cp_label} EXP: {exp_us}"
    if moneyness_label == "ATM":
        title = f"{title_base} (ATM)"
    elif moneyness_label in ("ITM", "OTM") and moneyness_pct is not None:
        title = f"{title_base} ({abs(moneyness_pct):.0f}% {moneyness_label})"
    else:
        title = title_base

    embed = {
        "title": title,
        "color": color,
        "fields": fields,
    }
    # Top-of-card branding: small logo + "UCT Live Flow" label. Replaces the
    # plain text footer for a more polished look. If UCT_LOGO_URL is unset or
    # the image fails to load, Discord still shows the "name" text alone.
    if UCT_LOGO_URL:
        embed["author"] = {
            "name": "UCT Live Flow",
            "icon_url": UCT_LOGO_URL,
        }
        # Thumbnail: renders the logo at ~80x80 on the right side of the embed.
        # Much more prominent than the author icon (~24x24) — gives the brand
        # real visual presence without dominating the alert data. Reuses the
        # same URL since GitHub raw caches well and adding a second URL would
        # double-fetch unnecessarily.
        embed["thumbnail"] = {"url": UCT_LOGO_URL}
    else:
        # Fallback: no logo, just keep the text label at the bottom as before.
        embed["footer"] = {"text": "via UCT Live Flow"}
    if badges:
        embed["description"] = " · ".join(badges)
    return embed


def _discord_post_url() -> str:
    """Return the webhook URL with ?wait=true so Discord returns the message
    object (including id) on POST — needed for later PATCH calls."""
    base = DISCORD_WEBHOOK_URL.rstrip("?&/")
    # If user's env var already has query params, append wait=true; else add ?
    if "?" in base:
        return base + "&wait=true"
    return base + "?wait=true"


def _discord_patch_url(message_id: str) -> str:
    """Build the PATCH URL: {webhook}/messages/{message_id}. Strips any
    query string (?wait=true belongs only on POST)."""
    base = DISCORD_WEBHOOK_URL.split("?", 1)[0].rstrip("/")
    return f"{base}/messages/{message_id}"


async def _post_to_discord(client, alert):
    """
    Aggregate-aware Discord forwarder with conviction-grade gating.

    - First fire on a contract today → check conviction grade. Below
      MIN_DISCORD_GRADE: silently aggregate, no post. At/above: POST new
      message, store message_id.
    - Subsequent fires → PATCH the existing message with updated aggregate
      (no re-gating — once a message is alive we keep it updated).
    - PATCH failure (deleted message, rate limit) → fall back to POST.

    Failures swallowed and logged; never blocks the SSE consumer.
    """
    if not DISCORD_WEBHOOK_URL:
        return

    _prune_aggregates()
    agg = _update_aggregate(alert)

    # Compute conviction first — needed for the gate decision and for the embed.
    _, grade = _compute_conviction(agg)
    message_id = agg.get("discord_message_id")

    # Persist the conviction grade to the live_alerts row (every alert that
    # reaches this point gets one, even if gated). Stamp on the alert dict
    # too so the in-memory buffer carries the same info.
    alert["grade"] = grade
    try:
        live_alerts_db.update_alert_state(alert.get("id"), grade=grade)
    except Exception as e:
        log.debug("[liveflow] grade persist failed for id=%s: %s",
                  alert.get("id"), e)

    # GATE: only applies to FIRST posts. If we already have a message_id, we
    # always edit it regardless of current grade (preserves the message thread
    # in subscribers' channels — a trade that earned its way in stays in).
    if not message_id and _grade_level(grade) < MIN_DISCORD_GRADE_LEVEL:
        _status["total_alerts_grade_gated"] = _status.get("total_alerts_grade_gated", 0) + 1
        log.debug(
            "[liveflow] grade %s below min %s — silent aggregate for %s %s $%s %s",
            grade, MIN_DISCORD_GRADE,
            agg.get("ticker"), agg.get("cp"), agg.get("strike"), agg.get("exp"),
        )
        alert["gatePassed"] = False
        try:
            live_alerts_db.update_alert_state(alert.get("id"), gate_passed=0)
        except Exception as e:
            log.debug("[liveflow] gate_passed persist failed for id=%s: %s",
                      alert.get("id"), e)
        return

    # Past the gate. Stamp the alert + DB so history view sees this clearly.
    alert["gatePassed"] = True
    try:
        live_alerts_db.update_alert_state(alert.get("id"), gate_passed=1)
    except Exception as e:
        log.debug("[liveflow] gate_passed persist failed for id=%s: %s",
                  alert.get("id"), e)

    embed = _build_embed(agg)
    payload = {"embeds": [embed]}

    if message_id:
        # Edit the existing post in place.
        url = _discord_patch_url(message_id)
        try:
            r = await client.patch(url, json=payload, timeout=10.0)
            if 200 <= r.status_code < 300:
                _status["last_discord_error"] = None
                return
            # Discord returns 404 if the message was manually deleted.
            # Fall through to POST a fresh one so the aggregate continues
            # to be visible to subscribers.
            body = (await r.aread())[:200]
            log.warning("[liveflow] discord PATCH %s HTTP %s: %r — re-POSTing",
                        message_id, r.status_code, body)
            agg["discord_message_id"] = None  # invalidate so we POST
        except Exception as e:
            log.warning("[liveflow] discord PATCH error: %s — re-POSTing", e)
            agg["discord_message_id"] = None

    # POST (first fire OR after PATCH failure). Use ?wait=true so Discord
    # returns the message object including its id.
    url = _discord_post_url()
    try:
        r = await client.post(url, json=payload, timeout=10.0)
        if r.status_code >= 400:
            body = (await r.aread())[:200]
            log.warning("[liveflow] discord POST HTTP %s: %r", r.status_code, body)
            _status["last_discord_error"] = f"HTTP {r.status_code}: {body!r}"
            return
        # Parse out the message_id so we can PATCH on future fires.
        try:
            body_json = r.json()
            agg["discord_message_id"] = str(body_json.get("id") or "")
        except Exception:
            # If the response isn't JSON (shouldn't happen with ?wait=true),
            # we still posted successfully — just can't edit later. Subsequent
            # fires will POST again, producing duplicate messages. Acceptable
            # degraded behavior.
            agg["discord_message_id"] = None
        _status["total_alerts_forwarded"] += 1
        _status["last_discord_error"] = None
        # Persist the message_id + forwarded flag so history view shows which
        # alert kicked off this Discord thread.
        try:
            live_alerts_db.update_alert_state(
                alert.get("id"),
                forwarded_to_discord=1,
                discord_message_id=agg.get("discord_message_id") or None,
            )
        except Exception as e:
            log.debug("[liveflow] discord state persist failed for id=%s: %s",
                      alert.get("id"), e)
    except Exception as e:
        log.warning("[liveflow] discord POST error: %s", e)
        _status["last_discord_error"] = f"{type(e).__name__}: {str(e)[:200]}"


# ─── Public accessors (used by router) ───────────────────────────────────────
def get_recent_alerts(limit=200):
    """
    Return the most recent alerts in reverse chronological order. Alerts that
    were superseded by higher-priority duplicates are filtered out so the
    frontend never renders them — see _dedup_check + _ingest_alert.
    """
    limit = max(1, min(int(limit or 200), MAX_BUFFER))
    visible = [a for a in _alerts if not a.get("_superseded")]
    return list(reversed(visible))[:limit]


def get_status():
    return dict(_status)


# ─── SSE consumer ────────────────────────────────────────────────────────────
async def _consume_stream(client, discord_client):
    params = {"key": BULLFLOW_API_KEY}
    log.info("[liveflow] connecting to %s", BULLFLOW_SSE_URL)
    async with client.stream(
        "GET", BULLFLOW_SSE_URL, params=params, timeout=None
    ) as response:
        if response.status_code != 200:
            body = await response.aread()
            raise RuntimeError(
                f"SSE handshake failed HTTP {response.status_code}: {body[:200]!r}"
            )
        _status["connected"] = True
        _status["last_error"] = None
        _status["started_at"] = datetime.now(timezone.utc).isoformat()
        log.info("[liveflow] connected, awaiting events")
        async for line in response.aiter_lines():
            if not line or not line.startswith("data: "):
                continue
            try:
                msg = json.loads(line[6:])
            except json.JSONDecodeError as e:
                log.warning("[liveflow] bad JSON line: %s — %r", e, line[:120])
                continue
            event = msg.get("event")
            if event == "alert":
                await _ingest_alert(msg, discord_client)
            elif event == "init":
                log.info("[liveflow] stream init startedAt=%s", msg.get("startedAt"))
            elif event == "heartbeat":
                _status["last_event_at"] = datetime.now(timezone.utc).isoformat()


async def _ingest_alert(msg, discord_client):
    """
    Decode → filter → dedup → buffer → maybe-forward. Always increment received
    counter even on filter/dedup failure, so the UI shows true throughput vs
    filter selectivity.
    """
    data = msg.get("data") or {}
    symbol = data.get("symbol", "") or ""
    occ = parse_occ_symbol(symbol)
    premium = data.get("alertPremium") or 0
    name = data.get("alertName") or ""
    ticker = occ["ticker"] or ""

    _status["total_alerts_received"] += 1
    _status["last_event_at"] = datetime.now(timezone.utc).isoformat()

    passes, reason = _passes_table_filter(name, premium, ticker)
    if not passes:
        _status["total_alerts_dropped"] += 1
        # Don't buffer — drop counter is enough for status visibility.
        return

    enriched = {
        "id": msg.get("id"),
        "alertType": data.get("alertType"),
        "alertName": name,
        "symbol": symbol,
        "ticker": ticker or None,
        "cp": occ["cp"],
        "strike": occ["strike"],
        "exp": occ["exp"],
        "dte": occ["dte"],
        "alertPremium": premium,
        "averageFillPrice": data.get("averageFillPrice"),
        "timestamp": data.get("timestamp"),
        "receivedAt": data.get("receivedAt"),
        "latency": data.get("latency"),
        "deliveryLatency": data.get("deliveryLatency"),
        "ingestedAt": _status["last_event_at"],
        # Conviction score deprecated — see note above the filter engine block.
        "convictionScore": None,
        # Will be flipped to True if the delayed Discord forward actually fires.
        "forwardedToDiscord": False,
        # Set to True if a later, higher-priority alert supersedes this one.
        "_superseded": False,
    }

    # Run dedup check AFTER building the enriched object so we have a stable
    # alert_id reference to compare against.
    action, payload = _dedup_check(enriched)

    if action == "drop":
        # Same trade already represented in the buffer by a higher-priority
        # alert. Don't add, don't forward.
        _status["total_alerts_dropped"] += 1
        return

    if action == "supersede":
        # New alert beats an existing one. Mark the older entry hidden so the
        # table/Discord re-checks pick the winner. Walk recent buffer entries
        # only (most supersedes happen within seconds; deep walk is wasted work).
        old_id = payload
        for a in reversed(_alerts):
            if a.get("id") == old_id:
                a["_superseded"] = True
                # Inherit the old alert's contract repeat count so the new
                # winner shows the same "Nx" badge — this is the same trade
                # being relabeled by a higher-priority alert, not a new fire.
                enriched["contractRepeatCount"] = a.get("contractRepeatCount", 1)
                # Same logic for follow-through count: supersede = same trade,
                # so the new alert carries the existing count rather than
                # double-incrementing the bucket.
                enriched["_followThroughCount"] = a.get("_followThroughCount", 1)
                break
        # Persist supersede on the old row so historical view shows the same
        # state subscribers saw. Best-effort; logs but doesn't raise.
        try:
            live_alerts_db.update_alert_state(old_id, superseded=1)
        except Exception as e:
            log.debug("[liveflow] supersede DB update failed for %s: %s", old_id, e)
    else:
        # action == "accept": this is a NEW distinct trade on this contract.
        # Increment per-contract counter and attach the badge value.
        enriched["contractRepeatCount"] = _track_repeat(enriched)
        # Also stamp follow-through count (narrow window, used by 2X gates).
        # Always tracked so the value is available if a gate gets enabled
        # mid-day, even when no alert is currently configured to read it.
        enriched["_followThroughCount"] = _track_follow_through_increment(enriched)

    # Enrich with OI data (trade size, prior OI, vol/OI ratio, exceeded flag).
    # Done after dedup so we don't waste SQLite reads on dropped alerts. The
    # cache means repeat fires on the same contract only hit the DB once/day.
    _enrich_with_oi(enriched)

    # Enrich with spot price + moneyness (how deep ITM/OTM). Async because
    # Schwab quote lookup is async, but cached per-ticker for 2 min so the
    # network cost is one call per unique ticker every 2 min.
    await _enrich_with_moneyness(enriched)

    _alerts.append(enriched)
    _status["total_alerts_shown"] += 1

    # Persist the enriched alert to SQLite for the history endpoint. Discord
    # state columns (grade, gate_passed, forwarded_to_discord, discord_message_id)
    # are filled in later by _post_to_discord via update_alert_state. Best-effort;
    # never blocks the live pipeline if /data isn't mounted yet.
    try:
        live_alerts_db.insert_alert(enriched)
    except Exception as e:
        log.debug("[liveflow] persistence insert failed for id=%s: %s",
                  enriched.get("id"), e)

    # Delayed forward: gives a brief window for a higher-priority alert to
    # arrive and supersede this one. The forward task re-checks the dedup
    # cache before posting, so superseded alerts never reach Discord.
    asyncio.create_task(_delayed_discord_forward(discord_client, enriched))


async def _delayed_discord_forward(discord_client, alert: dict):
    """
    Wait DISCORD_FORWARD_DELAY_SEC, then post to Discord only if this alert
    is still the dedup winner for its contract key. If a higher-priority
    alert superseded it during the delay, this is a no-op.

    Per-alert conviction gates (defined in ALERT_CONVICTION_GATES) also run
    here — gated alerts stay in the buffer + DB but don't reach Discord.
    """
    await asyncio.sleep(DISCORD_FORWARD_DELAY_SEC)
    if alert.get("_superseded"):
        return
    key = _make_dedup_key(alert)
    winner = _dedup_cache.get(key)
    # If the dedup cache no longer points to this alert, it was superseded
    # (or the cache rotated out due to a >60s gap, in which case forwarding
    # would be stale anyway).
    if not winner or winner.get("alert_id") != alert.get("id"):
        return

    # ── Per-alert conviction gates (2X follow-through, per-ticker cap) ─────
    # No-op for alerts with no entry in ALERT_CONVICTION_GATES.
    passes, gate_reason = _passes_alert_gates(alert)
    if not passes:
        alert["_gateBlocked"] = gate_reason
        _status["total_alerts_gate_blocked"] = (
            _status.get("total_alerts_gate_blocked", 0) + 1
        )
        log.info(
            "[liveflow] gate blocked id=%s alert=%s ticker=%s reason=%s",
            alert.get("id"), alert.get("alertName"), alert.get("ticker"),
            gate_reason,
        )
        # Persist the gated state so the history view can show which alerts
        # were filtered out of Discord (and why).
        try:
            live_alerts_db.update_alert_state(
                alert.get("id"),
                gate_passed=0,
            )
        except Exception:
            pass
        return

    alert["forwardedToDiscord"] = True
    try:
        await _post_to_discord(discord_client, alert)
        # Record that this (alert_name, ticker) pair has posted today, so the
        # per-ticker cap (if configured) can block subsequent posts. Cheap
        # call regardless of whether the cap is configured.
        name = (alert.get("alertName") or "").strip()
        gates = _get_alert_gates(name)
        if int(gates.get("max_per_ticker_per_day", 0) or 0) > 0:
            _mark_alert_posted_for_ticker(name, alert.get("ticker") or "")
    except Exception as e:
        log.warning("[liveflow] delayed discord forward failed: %s", e)



# ─── Forever loop with exponential-backoff reconnect ─────────────────────────
async def run_forever():
    if not BULLFLOW_API_KEY:
        log.error("[liveflow] BULLFLOW_API_KEY env var missing — worker disabled")
        _status["last_error"] = "BULLFLOW_API_KEY env var missing"
        return
    if not DISCORD_WEBHOOK_URL:
        log.warning("[liveflow] no Discord webhook configured (DISCORD_LIVE_FLOW_WEBHOOK_URL "
                    "or DISCORD_WEBHOOK_URL) — alerts will buffer but won't forward")

    # Initialize the alert-history table on the Railway volume. Idempotent;
    # safe across deploys. Failures are logged but non-fatal — the worker
    # still runs, just without persistence until /data is available.
    try:
        live_alerts_db.init_db()
    except Exception as e:
        log.warning("[liveflow] live_alerts_db.init_db failed at startup: %s", e)

    backoff = RECONNECT_MIN_SEC
    # Two separate clients — sse client has timeout=None for long-lived streaming;
    # discord client uses default timeouts and is fire-and-forget short requests.
    async with httpx.AsyncClient() as sse_client, httpx.AsyncClient() as discord_client:
        while True:
            try:
                await _consume_stream(sse_client, discord_client)
                log.info("[liveflow] stream ended cleanly, reconnecting in %.1fs",
                         RECONNECT_MIN_SEC)
                backoff = RECONNECT_MIN_SEC
            except asyncio.CancelledError:
                log.info("[liveflow] worker cancelled, exiting")
                _status["connected"] = False
                raise
            except Exception as e:
                _status["connected"] = False
                _status["last_error"] = f"{type(e).__name__}: {str(e)[:200]}"
                _status["reconnect_count"] += 1
                log.warning("[liveflow] connection error: %s (next attempt in %.1fs)",
                            e, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, RECONNECT_MAX_SEC)
