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

import httpx

log = logging.getLogger(__name__)

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
        # Conviction threshold removed 2026-06-17 — Bullflow's per-alert filters
        # are the conviction signal now. Every alert that passes TABLE_FILTER
        # forwards to Discord.
        "discord_threshold": None,
        # Per-alert ticker exclusions (e.g. mega-caps blocked on Unusual scans).
        "per_alert_blocklists": {
            name: sorted(tickers) for name, tickers in ALERT_TICKER_BLOCKLISTS.items()
        },
        # User-managed blocklist — read fresh from module-level set each call
        # so the API echoes the current state, not a snapshot at startup.
        "user_ticker_blocklist": sorted(_user_ticker_blocklist),
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
async def _post_to_discord(client, alert):
    """
    Posts a rich embed to the configured Discord webhook. Color-codes by C/P.
    Failures are swallowed and logged — never block the SSE consumer.

    Mirrors the embed structure used by discord_watchlist.py: title with the
    most important fact (ticker + C/P + strike + exp), fields with context.
    """
    if not DISCORD_WEBHOOK_URL:
        return
    cp = alert.get("cp") or "?"
    ticker = alert.get("ticker") or "?"
    strike = alert.get("strike")
    exp = alert.get("exp") or "?"
    dte = alert.get("dte")
    premium = alert.get("alertPremium") or 0
    avg_fill = alert.get("averageFillPrice")
    name = alert.get("alertName") or "Alert"
    score = alert.get("convictionScore")
    score_str = f"{score:.1f}" if score is not None else "—"

    color = 0x3CB868 if cp == "C" else (0xE74C3C if cp == "P" else 0xc9a84c)
    strike_str = f"${strike:g}" if strike is not None else "?"
    dte_str = f"{dte}d" if dte is not None else "?"
    if premium >= 1_000_000:
        prem_str = f"${premium/1_000_000:.2f}M"
    else:
        prem_str = f"${premium/1_000:.0f}K"
    avg_fill_str = f"${avg_fill:.2f}" if avg_fill is not None else "?"

    embed = {
        "title": f"🚨 LIVE · {ticker} {cp} {strike_str} {exp}",
        "color": color,
        "fields": [
            {"name": "Premium",    "value": prem_str,       "inline": True},
            {"name": "Avg Fill",   "value": avg_fill_str,   "inline": True},
            {"name": "DTE",        "value": dte_str,        "inline": True},
            {"name": "Alert",      "value": name,           "inline": True},
            {"name": "Conviction", "value": score_str, "inline": True},
            {"name": "Type",       "value": (alert.get("alertType") or "?").upper(), "inline": True},
        ],
        "footer": {"text": "via Bullflow · UCT Live Flow"},
        "timestamp": alert.get("ingestedAt"),
    }
    payload = {"embeds": [embed]}
    try:
        r = await client.post(DISCORD_WEBHOOK_URL, json=payload, timeout=10.0)
        if r.status_code >= 400:
            body = (await r.aread())[:200]
            log.warning("[liveflow] discord post HTTP %s: %r", r.status_code, body)
            _status["last_discord_error"] = f"HTTP {r.status_code}: {body!r}"
            return
        _status["total_alerts_forwarded"] += 1
        _status["last_discord_error"] = None
    except Exception as e:
        log.warning("[liveflow] discord post error: %s", e)
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
                break
    else:
        # action == "accept": this is a NEW distinct trade on this contract.
        # Increment per-contract counter and attach the badge value.
        enriched["contractRepeatCount"] = _track_repeat(enriched)

    # Enrich with OI data (trade size, prior OI, vol/OI ratio, exceeded flag).
    # Done after dedup so we don't waste SQLite reads on dropped alerts. The
    # cache means repeat fires on the same contract only hit the DB once/day.
    _enrich_with_oi(enriched)

    _alerts.append(enriched)
    _status["total_alerts_shown"] += 1

    # Delayed forward: gives a brief window for a higher-priority alert to
    # arrive and supersede this one. The forward task re-checks the dedup
    # cache before posting, so superseded alerts never reach Discord.
    asyncio.create_task(_delayed_discord_forward(discord_client, enriched))


async def _delayed_discord_forward(discord_client, alert: dict):
    """
    Wait DISCORD_FORWARD_DELAY_SEC, then post to Discord only if this alert
    is still the dedup winner for its contract key. If a higher-priority
    alert superseded it during the delay, this is a no-op.
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
    alert["forwardedToDiscord"] = True
    try:
        await _post_to_discord(discord_client, alert)
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
