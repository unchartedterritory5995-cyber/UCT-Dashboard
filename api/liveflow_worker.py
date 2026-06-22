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
    # ETF blocklist: Bullflow's "Stocks" quick-filter doesn't always exclude
    # ETFs (USO leaked through on 2026-06-22 as a UCT Bearish alert).
    # Grouping below for maintainability — order doesn't matter, just readability.
    "ticker_blocklist": {
        # Major index ETFs
        "SPY", "QQQ", "IWM", "DIA", "VTI", "VOO", "VEA", "VWO",
        # SPDR sector ETFs
        "XLE", "XLF", "XLI", "XLK", "XLP", "XLU", "XLV", "XLY", "XLB", "XLC",
        # Industry/thematic
        "XRT", "XOP", "XBI",
        # Commodities / currencies / bonds
        "GLD", "SLV", "USO", "UNG", "TLT", "IEF", "HYG", "LQD",
        # Regional / country
        "EEM", "EFA", "FXI", "EWZ", "INDA", "EWJ",
        # Leveraged / inverse — these are where noise concentrates
        "SOXL", "SOXS", "TQQQ", "SQQQ", "TNA", "TZA", "SPXL", "SPXS",
        "LABU", "LABD", "NUGT", "DUST", "UVXY", "VXX",
        # ARK funds
        "ARKK", "ARKG", "ARKW", "ARKQ", "ARKF",
    },
    # alertName must NOT contain any of these substrings (case-insensitive)
    # 2026-06-22 additions: "urgent" + "repeater" suppress Bullflow's
    # "Urgent Repeater" algo alerts which pushed despite gatePassed=false on
    # Day 1 (APLD $263K, grade D). These aren't UCT alerts — they're
    # Bullflow defaults firing inside the worker before grade gating.
    "alertname_block_substrings": ["grenade", "urgent", "repeater"],
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

# Tickers excluded from "UCT Unusual Weeklies" re-tagging (see _maybe_retag_
# weeklies below). For these names, $500K on a sub-7-DTE weekly is daily
# noise — their normal flow exceeds that. We block them from the weeklies
# channel so subscribers see real small/mid-cap conviction trades instead.
# Includes the MEGA_CAP_TICKERS plus a few names treated as "mega-like" for
# weekly purposes (MU/INTC/AMD/SNDK have huge weekly flow even though
# technically large-cap). Tune freely — does NOT affect other alerts.
# 2026-06-22: SPCX removed from exclude per operator — SPCX flow IS signal
# for that small-cap ticker; let it route to Unusual Weeklies normally.
UNUSUAL_WEEKLIES_MEGA_CAP_EXCLUDE = MEGA_CAP_TICKERS | frozenset({
    "AMD", "INTC", "MU", "SNDK", "CRM", "TSM", "ASML",
})

# ─── Earnings calendar (weekly refresh required) ──────────────────────────────
# Hardcoded list of tickers reporting THIS WEEK. Two behaviors apply:
#
#   1. Filter-level block: any trade on these tickers with DTE <= EARNINGS_
#      MAX_DTE_BLOCK gets dropped before grading (pure earnings gambles —
#      no signal value, just lottery tickets that hammer subscribers with
#      noise on report week).
#
#   2. Disclaimer badge: any trade on these tickers that PASSES filter (i.e.
#      DTE > EARNINGS_MAX_DTE_BLOCK) gets an "⚠️ Earnings: <date>" badge
#      added to the Discord embed so subscribers see the calendar context
#      and understand the trade may be positioning vs an upcoming event.
#
# Source of truth: manual entry from Seeking Alpha / Market Chameleon weekly
# earnings calendar. TODO long-term: replace with yfinance Ticker.earnings_
# dates lookup, refresh nightly via a cron job. Until then, this dict needs
# manual update every Sunday for the upcoming week.
#
# Date format: short human-readable string for the badge ("Tue 6/23", "Wed
# 6/24"). Don't use ISO format — the badge needs to be scannable in Discord.
EARNINGS_THIS_WEEK: dict = {
    "MU":  "Wed 6/24",  # AMC
    "FDX": "Tue 6/23",
    # Add more before each Monday's open. Other Seeking Alpha names this
    # week (KFY, WOR, DRI, BB, KBH, NG, WGO, PAYX, SNX, CMC, CCL, MKC,
    # APOG, MLKN, FUL, ICLR, AYI, MEI, JEF) intentionally omitted — they
    # don't see meaningful UCT alert flow.
}

# DTE cutoff for the earnings filter. Trades ≤ this DTE on an earnings-week
# ticker get blocked at the filter; trades > this DTE pass with a badge.
# 15 = blocks weeklies + biweeklies (pure earnings gambles) but allows
# monthly-and-out positioning trades to pass through with the disclaimer.
EARNINGS_MAX_DTE_BLOCK = 15


# ─── Tier premium requirements ────────────────────────────────────────────────
# Grade alone is insufficient — a B-grade trade at $700K and a B-grade trade
# at $20M are different signals entirely. This matrix says: to push, a trade
# must meet BOTH (a) the grade threshold and (b) the premium threshold for
# that grade tier. Replaces the cliff-edge B-floor with a graduated rule.
#
# Tuned against the 2026-06-22 EOD OptionsFlow watchlist (40 trades) to
# produce a Discord push volume of ~35-50 quality alerts per day rather
# than 100+ noisy ones. Key calibration points:
#   - $600K floor for A keeps PERI-style microcap signals ($690K)
#   - $2M floor for B kills mid-quality $700K-$1.5M noise
#   - C and D are blocked entirely (Unusual Weeklies tier has its own logic)
TIER_PREMIUM_REQUIREMENTS = {
    "A+": 500_000,
    "A":  600_000,
    "B":  2_000_000,
    "C":  None,     # blocked unless tier override (e.g. Unusual Weeklies min_grade=D)
    "D":  None,
}


# Premium threshold that overrides ALL filters: mega-cap exclude, earnings
# short-DTE block, per-alert ticker blocklists. Above this dollar amount,
# the trade IS the signal regardless of context. Calibrated to the watchlist's
# $5M+ trades (13 of 40) which routinely include mega-cap names (NVDA $11M)
# and earnings tickers (MU weeklies $5M+).
HIGH_PREMIUM_OVERRIDE = 5_000_000


# Cross-alert per-ticker cap. Limits Discord posts per ticker per day across
# ALL alert tiers combined. Without this, MU could dominate the channel with
# 10+ posts (Size Bulls + Vol>OI + Size Bears + Bullish + Bearish Leaps etc.)
# while other meaningful tickers get 1-2 posts. With cap=3, subscribers see
# at most the 3 best trades per ticker — by premium — distributed across the
# full universe of names with flow.
#
# Per-alert caps (in ALERT_CONVICTION_GATES.max_per_ticker_per_day) still
# apply on top of this; this is the global ceiling. Whichever cap fires first
# wins. Today's MU example: 11 raw alerts → top 3 by premium kept (the LEAPS
# at $22M, bearish LEAPS at $6.51M, near-term bearish at $6.42M).
#
# Tradeoff: a ticker with 5 genuinely good trades loses 2 of them. Acceptable
# because subscribers need ticker diversity more than ticker depth. The lost
# trades remain visible in LiveFlow admin view for manual override push.
GLOBAL_MAX_PER_TICKER_PER_DAY = 3

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


# Default seed list when no user_blocklist file exists. Empty by default —
# tickers can be added via the admin UI at runtime. Earlier iterations seeded
# this with SPCX but operator preference is to let SPCX flow through (its
# weekly noise is real signal sometimes — see the IREN-style microcap thesis).
DEFAULT_USER_BLOCKLIST_SEED = frozenset()


# One-time deprecated-tickers cleanup. Any ticker listed here gets ACTIVELY
# removed from the saved blocklist file on startup, regardless of file state.
# Use this when a ticker was previously seeded but should no longer be blocked.
# Once a ticker has cycled through one deploy with this list, it can be removed.
# Why this exists: file persists on Railway volume across deploys, so a stale
# blocklist entry survives even if the seed list changes. This forces cleanup.
DEPRECATED_BLOCKLIST_REMOVALS = frozenset({
    "SPCX",  # 2026-06-22: removed per operator after one day of testing
})


def _load_user_blocklist():
    """Load tickers from disk into the in-memory set. Idempotent and safe.
    If no file exists yet, seeds from DEFAULT_USER_BLOCKLIST_SEED. Also strips
    any tickers in DEPRECATED_BLOCKLIST_REMOVALS — these get removed from the
    saved file on first restart after being added to the deprecated list."""
    global _user_ticker_blocklist
    try:
        with open(USER_BLOCKLIST_FILE, "r") as f:
            data = json.load(f)
        tickers = data.get("tickers", [])
        loaded = {
            t.upper().strip() for t in tickers if t and t.strip()
        }
        # Strip any deprecated tickers and re-save if we changed anything.
        cleaned = loaded - DEPRECATED_BLOCKLIST_REMOVALS
        if cleaned != loaded:
            removed = loaded - cleaned
            log.info("[liveflow] removing deprecated tickers from blocklist: %s",
                     sorted(removed))
            _user_ticker_blocklist = cleaned
            _save_user_blocklist()
        else:
            _user_ticker_blocklist = loaded
        log.info("[liveflow] loaded %d user-blocked tickers from %s",
                 len(_user_ticker_blocklist), USER_BLOCKLIST_FILE)
    except FileNotFoundError:
        # First-run seed: populate from the default list. Save the seed so
        # subsequent restarts read from disk instead of re-seeding.
        _user_ticker_blocklist = set(DEFAULT_USER_BLOCKLIST_SEED) - DEPRECATED_BLOCKLIST_REMOVALS
        log.info("[liveflow] no user blocklist file at %s — seeded with %d defaults: %s",
                 USER_BLOCKLIST_FILE,
                 len(_user_ticker_blocklist),
                 sorted(_user_ticker_blocklist))
        _save_user_blocklist()
    except Exception as e:
        _user_ticker_blocklist = set(DEFAULT_USER_BLOCKLIST_SEED) - DEPRECATED_BLOCKLIST_REMOVALS
        log.warning("[liveflow] error loading user blocklist (%s) — seeded with %d defaults",
                    e, len(_user_ticker_blocklist))


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


def _strip_grade_emoji(grade_str: str) -> str:
    """Strip trailing emoji/whitespace from a grade string for dict lookups.
    'A+ 🚀' → 'A+'. Returns 'D' if input is None/empty for safe lookups."""
    g = (grade_str or "D").strip()
    # The valid letter grades all start with A/B/C/D; everything else trailing
    # is decoration. Split on first space and take just the letter portion.
    return g.split()[0] if g else "D"


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
        #
        # 2026-06-22 tune: raised max_per_ticker_per_day 1→3 after first-day
        # production showed TSLA fired three meaningful Alpha Gold sweeps on
        # different contracts (400C, 405C, 450C LEAPS — total $7.27M across
        # 3 different parts of the chain). Cap=1 missed two of them. Cap=3
        # captures the conviction story when an institutional buyer builds a
        # position across multiple strikes/expirations without devolving into
        # MU-style 6x same-contract spam.
        "min_repeat_fires": 0,
        "max_per_ticker_per_day": 3,
        "follow_through_window_sec": 900,  # unused at min_repeat=0; kept for future re-tune
    },
    # UCT Unusual Weeklies — synthetic alert created by re-tagging in the
    # worker (see _maybe_retag_weeklies). Catches "size on weekly" flow that
    # gets buried by the directional grade scorer because deep-OTM or short-
    # DTE characteristics hurt the composite score. The premise: a $500K+
    # premium on a sub-7-DTE option for a non-mega-cap stock is itself the
    # signal — the trader is making a high-conviction time-bounded bet that
    # the scorer's standard moneyness/DTE penalties miss.
    #
    # min_grade: D (effectively off) — premium + DTE + non-mega-cap is enough
    # qualification. If too noisy, raise to C.
    "UCT Unusual Weeklies": {
        "min_grade": "D",
        "max_per_ticker_per_day": 2,  # allow follow-through, but cap
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


def _get_alert_min_grade_level(alert_name: str) -> int:
    """
    Per-alert minimum grade level. Falls back to global MIN_DISCORD_GRADE_LEVEL
    if the alert doesn't override.

    Used so synthetic alerts like "UCT Unusual Weeklies" can accept lower
    grades (D) than the default Discord floor (B) — the premise being that
    these alerts have alternate qualification criteria (premium+DTE+cap-tier)
    making the conviction grade less informative.

    Returns: int grade level (higher = stricter). Compare with _grade_level().
    """
    gates = _get_alert_gates(alert_name)
    override = gates.get("min_grade")
    if override:
        return _grade_level(str(override).strip().upper())
    return MIN_DISCORD_GRADE_LEVEL


def _maybe_retag_weeklies(alert_name: str, ticker: str, premium: float, dte) -> str:
    """
    Re-tag candidate alerts as "UCT Unusual Weeklies" when they represent
    size on a sub-7-DTE expiration on a non-mega-cap stock. Otherwise return
    the original alert_name unchanged.

    Criteria (ALL must be true):
      - original alert name is "UCT Vol>OI" or "UCT Unusual"
      - DTE is a number and <= 7
      - premium >= $500,000
      - ticker is NOT in UNUSUAL_WEEKLIES_MEGA_CAP_EXCLUDE

    Why only re-tag Vol>OI / Unusual: those alerts already filter for unusual
    activity, so their hits are pre-qualified candidates. Re-tagging Bullish
    or Size alerts would conflict with their own dedicated channels.

    Why mega-cap exclude: $500K on an NVDA/AAPL/MU weekly is a rounding error.
    The "unusual" signal only holds for smaller names where $500K+ on a
    weekly is genuinely uncommon.

    Returns the (possibly modified) alert name to use going forward. Caller
    overwrites the alertName field on the alert dict so downstream gates,
    Discord posts, and SQLite all see the new name.
    """
    if not alert_name or not ticker:
        return alert_name
    if alert_name.strip() not in ("UCT Vol>OI", "UCT Unusual"):
        return alert_name
    if not isinstance(dte, (int, float)) or dte > 7 or dte < 0:
        return alert_name
    if not premium or premium < 500_000:
        return alert_name
    if ticker.upper() in UNUSUAL_WEEKLIES_MEGA_CAP_EXCLUDE:
        return alert_name
    return "UCT Unusual Weeklies"


# Sliding-window timestamps per contract — used by the 2X filter only.
# Distinct from _contract_repeats because the WINDOW differs (15min vs 12hr).
# Same contract_key shape from _make_contract_key().
_follow_through_tracker: dict = {}   # contract_key -> [unix_ts, ...]

# Per-(alert_name, ticker) daily post tracker for the per-ticker cap. Resets
# implicitly when the date key changes; stale dates pruned lazily on read.
_alerts_posted_today: dict = {}      # date_iso -> set of (alert_name, ticker) tuples

# Global ticker counter for GLOBAL_MAX_PER_TICKER_PER_DAY (across ALL alerts).
# Different from _alerts_posted_today which tracks per (alert_name, ticker).
# This tracks just ticker, so MU's Size Bulls + Vol>OI + Bullish all count
# toward the same global ceiling.
_global_posted_today: dict = {}      # date_iso -> {ticker: count}


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
    Does NOT bump the global counter — that's bumped by the caller in
    _delayed_discord_forward and only on NEW posts (not patches), so
    multi-fire same-contract alerts don't burn through the global cap.
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


def _bump_global_ticker_counter(ticker: str):
    """Increment the GLOBAL_MAX_PER_TICKER_PER_DAY counter for `ticker`.

    Called ONLY for NEW Discord posts (not patches on existing messages).
    Patches represent the same contract evolving — keeping the message
    updated — and shouldn't count against the daily cap, because the cap
    is about "how many distinct contracts on this ticker hit Discord today",
    not "how many fires we processed". MU C $1500 LEAPS firing 8 times
    bumps the counter ONCE.
    """
    if not ticker:
        return
    today_iso = datetime.now(ET).date().isoformat()
    stale_g = [d for d in _global_posted_today if d != today_iso]
    for d in stale_g:
        del _global_posted_today[d]
    tg = _global_posted_today.setdefault(today_iso, {})
    tg[ticker.upper()] = tg.get(ticker.upper(), 0) + 1


def _global_ticker_post_count_today(ticker: str) -> int:
    """How many times has ANY alert posted for this ticker today? Used by
    GLOBAL_MAX_PER_TICKER_PER_DAY. Returns 0 if ticker hasn't posted today."""
    if not ticker:
        return 0
    today_iso = datetime.now(ET).date().isoformat()
    return _global_posted_today.get(today_iso, {}).get(ticker.upper(), 0)


def _passes_alert_gates(alert: dict) -> tuple:
    """
    Returns (passes: bool, reason: str). Run inside _delayed_discord_forward,
    AFTER dedup but BEFORE Discord POST. Looks up per-alert config from
    ALERT_CONVICTION_GATES — alerts with no entry pass through unchanged.

    Three gates checked (in order):
      1. GLOBAL per-ticker cap: ticker (across ALL alerts) must be below
         GLOBAL_MAX_PER_TICKER_PER_DAY — prevents one ticker dominating.
         CRITICAL: only applies to NEW posts. When a contract is already
         on Discord (existing message_id in _contract_aggregates), the
         current alert is a PATCH on that message, not a new post.
         Patches always pass because they're the SAME signal evolving —
         multi-fire institutional accumulation. The cap is for distinct
         contracts on the same ticker, not contract progression.
      2. 2X follow-through: stamped count must be >= min_repeat_fires
      3. Per-(alert, ticker) daily cap: (alert_name, ticker) must not have
         hit max_per_ticker_per_day

    Any gate can be disabled by omitting the key (or setting to 0).
    """
    name = (alert.get("alertName") or "").strip()
    gates = _get_alert_gates(name)
    ticker = (alert.get("ticker") or "").upper()

    # Determine if this is a PATCH on an existing Discord message, or a
    # NEW post. Look up the contract aggregate — if it has a message_id,
    # we're patching. Patches bypass the cap (same-contract evolution).
    contract_key = _make_contract_key(alert)
    agg = _contract_aggregates.get(contract_key) if contract_key else None
    is_patch = bool(agg and agg.get("discord_message_id"))

    # Gate 1 (cross-alert global cap) runs FIRST and only on NEW posts.
    # MU C $1500 LEAPS firing 8x → 1 evolving message (doesn't burn cap).
    # MU on a different contract → counts against cap.
    if (
        not is_patch
        and GLOBAL_MAX_PER_TICKER_PER_DAY
        and GLOBAL_MAX_PER_TICKER_PER_DAY > 0
        and ticker
    ):
        global_count = _global_ticker_post_count_today(ticker)
        if global_count >= GLOBAL_MAX_PER_TICKER_PER_DAY:
            return False, (
                f"global_ticker_cap:{ticker}_already_{global_count}_today"
                f"_({GLOBAL_MAX_PER_TICKER_PER_DAY}_cap)"
            )

    if not gates:
        return True, ""

    # Gate 2: institutional follow-through
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

    # Gate 3: per-(alert, ticker) daily cap
    max_per_ticker = int(gates.get("max_per_ticker_per_day", 0) or 0)
    if max_per_ticker > 0:
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


def replay_alerts_through_full_pipeline(alerts: list) -> list:
    """
    Full-pipeline replay: simulates what each alert WOULD do if it ran through
    the live worker right now (current config). Unlike replay_alerts_through_
    gates which only checks the conviction gates, this applies the entire
    pipeline:

        1. TABLE_FILTER (premium floor, ETF/ticker blocklist, alertname substrings)
        2. ALERT_TICKER_BLOCKLISTS (per-alert ticker blocks, e.g. mega-caps on Unusual)
        3. _maybe_retag_weeklies (re-route to "UCT Unusual Weeklies" if eligible)
        4. _compute_conviction (build aggregate from preceding alerts on same contract,
           compute grade)
        5. Per-alert min_grade gate (uses _get_alert_min_grade_level)
        6. min_repeat_fires + max_per_ticker_per_day (same as replay_alerts_through_gates)

    Pure function: does NOT mutate production state (uses fresh local dicts),
    does NOT write to DB, does NOT post to Discord.

    Inputs: list of alert dicts in the live_alerts_db schema (camelCase keys
    like alertName, alertPremium, ticker, cp, strike, exp, ingestedAt, etc.).
    The same shape produced by csv_ingest._build_alert_for_db or returned
    from query_alerts.

    Returns: NEW list of dicts (sorted by ingestedAt asc) with stamped fields:
      _replayedPassesTableFilter:  0/1
      _replayedFilterReason:       str  (e.g. "ticker_blocked:USO" on failure)
      _replayedFinalAlertName:     str  (after possible re-tag to Unusual Weeklies)
      _replayedGrade:              str  ("A+", "A", "B", "C", "D", or None if didn't grade)
      _replayedConvictionScore:    float
      _replayedMinGradeRequired:   str  (alert's min_grade, may be "B" global or override)
      _replayedPassesGradeGate:    0/1/None
      _replayedFollowThroughCount: int
      _replayedPassesConvictionGates: 0/1
      _replayedGateReason:         str
      _replayedWouldForward:       0/1   (THE answer — all gates passed?)

    Use case: preview a CSV-derived flow against current gates to predict
    Discord push volume before actually pushing (see csv_ingest preview endpoint).
    """
    if not alerts:
        return []

    def _to_unix(a):
        ts = a.get("ingestedAt") or a.get("timestamp")
        if ts is None:
            return 0.0
        if isinstance(ts, (int, float)):
            return float(ts)
        try:
            s = str(ts).replace("Z", "+00:00")
            return datetime.fromisoformat(s).timestamp()
        except (ValueError, TypeError):
            return 0.0

    sorted_alerts = sorted(alerts, key=_to_unix)

    # Per-replay state — fresh dicts, not the production module-level ones.
    replay_aggregates: dict = {}        # (ticker,cp,strike,exp,date) -> agg dict
    replay_follow_through: dict = {}    # contract_key tuple -> [unix_ts, ...]
    replay_posted_today: dict = {}      # date_iso -> set of (alert_name, ticker)
    # Contract-level dedup. Tracks which (contract, date) tuples have ALREADY
    # had a "would_forward=1" alert in this replay. Subsequent alert events
    # on the same contract get marked _replayedAggregatesIntoExisting=1
    # instead of _replayedWouldForward=1 — mirrors the live worker's behavior
    # where the SAME contract firing under multiple alert tiers produces ONE
    # Discord post with "+N more" label rather than N separate messages.
    replay_contract_first_seen: dict = {}  # (ticker,cp,strike,exp,date) -> alert_id

    max_window = max(
        (g.get("follow_through_window_sec", 0) for g in ALERT_CONVICTION_GATES.values()),
        default=900,
    ) or 900

    for a in sorted_alerts:
        original_name = (a.get("alertName") or "").strip()
        ticker = (a.get("ticker") or "").upper()
        premium = float(a.get("alertPremium") or 0)
        dte = a.get("dte")
        alert_ts = _to_unix(a)

        # Default stamps so callers can rely on these fields existing.
        a["_replayedPassesTableFilter"] = 0
        a["_replayedFilterReason"] = ""
        a["_replayedFinalAlertName"] = original_name
        a["_replayedGrade"] = None
        a["_replayedConvictionScore"] = None
        a["_replayedMinGradeRequired"] = None
        a["_replayedPassesGradeGate"] = None
        a["_replayedFollowThroughCount"] = 0
        a["_replayedPassesConvictionGates"] = 0
        a["_replayedGateReason"] = ""
        a["_replayedWouldForward"] = 0

        # Step 1: TABLE_FILTER — global premium/ticker/alertname/earnings checks.
        passes, reason = _passes_table_filter(original_name, premium, ticker, dte=dte)
        if not passes:
            a["_replayedFilterReason"] = reason
            continue
        a["_replayedPassesTableFilter"] = 1

        # Step 2: re-tag if eligible. After this point, `name` is the new alert
        # name that gates and grading look up.
        name = _maybe_retag_weeklies(original_name, ticker, premium, dte)
        a["_replayedFinalAlertName"] = name

        # Step 3: build/update aggregate state for this contract so grade
        # computation has correct fire_count, total_premium, names_seen, etc.
        # Mirrors _update_aggregate but uses our local dict.
        # Date used for daily reset; computed from alert's recorded ET date.
        try:
            alert_et_date = datetime.fromtimestamp(alert_ts, tz=timezone.utc).astimezone(ET).date().isoformat()
        except (OverflowError, ValueError):
            alert_et_date = "1970-01-01"
        agg_key = (
            ticker, a.get("cp") or "", a.get("strike"), a.get("exp") or "",
            alert_et_date,
        )
        agg = replay_aggregates.get(agg_key)
        size = a.get("tradeSize") or 0
        if not agg:
            agg = {
                "ticker": ticker, "cp": a.get("cp"), "strike": a.get("strike"),
                "exp": a.get("exp"), "dte": dte,
                "total_premium": premium, "max_premium": premium,
                "total_size": size, "max_size": size,
                "fire_count": 1,
                "best_alert_name": name,
                "best_alert_priority": _alert_priority({"alertName": name}),
                "alert_names_seen": {name} if name else set(),
                "prior_oi": a.get("priorOI"),
                "moneyness_pct": a.get("moneynessPct"),
                "moneyness_label": a.get("moneynessLabel"),
            }
            replay_aggregates[agg_key] = agg
        else:
            agg["total_premium"] += premium
            agg["max_premium"] = max(agg["max_premium"], premium)
            agg["total_size"] = (agg["total_size"] or 0) + size
            agg["max_size"] = max(agg["max_size"] or 0, size)
            agg["fire_count"] += 1
            if name:
                agg["alert_names_seen"].add(name)
            new_pri = _alert_priority({"alertName": name})
            if new_pri < (agg.get("best_alert_priority") or 99):
                agg["best_alert_priority"] = new_pri
                agg["best_alert_name"] = name
            # Refresh moneyness from latest fire (spot drifts intraday).
            if a.get("moneynessPct") is not None:
                agg["moneyness_pct"] = a.get("moneynessPct")
                agg["moneyness_label"] = a.get("moneynessLabel")

        # Step 4: compute conviction grade from the (possibly multi-fire) aggregate.
        score, grade = _compute_conviction(agg)
        a["_replayedGrade"] = grade
        a["_replayedConvictionScore"] = score

        # Step 5: per-alert min_grade gate. If the alert is below the floor,
        # mark and continue (no further gates relevant).
        min_grade_level = _get_alert_min_grade_level(name)
        # Translate level back to letter for display.
        a["_replayedMinGradeRequired"] = {
            v: k for k, v in {
                "A+": _grade_level("A+"), "A": _grade_level("A"),
                "B": _grade_level("B"),  "C": _grade_level("C"),
                "D": _grade_level("D"),
            }.items()
        }.get(min_grade_level, "?")
        if _grade_level(grade) < min_grade_level:
            a["_replayedPassesGradeGate"] = 0
            a["_replayedGateReason"] = f"grade_{grade}_below_{a['_replayedMinGradeRequired']}"
            continue
        a["_replayedPassesGradeGate"] = 1

        # Step 5b: TIER_PREMIUM_REQUIREMENTS — grade alone isn't enough. A
        # B-grade $700K trade and a B-grade $20M trade are very different
        # signals. Check per-tier premium floor (e.g. B requires $2M+).
        # Skip this check for tiers with explicit min_grade overrides (e.g.
        # Unusual Weeklies passes D-grade because premium+DTE+cap-tier IS
        # the signal there — TIER_PREMIUM_REQUIREMENTS["D"] = None).
        tier_floor = TIER_PREMIUM_REQUIREMENTS.get(_strip_grade_emoji(grade))
        if tier_floor is None:
            # Grade C/D with no override gate → block here. But UCT Unusual
            # Weeklies sets min_grade=D so it already passed step 5; for that
            # tier we don't want to re-block. Check whether the alert is one
            # that sets its own min_grade and respect that.
            alert_has_override = bool(_get_alert_gates(name).get("min_grade"))
            if not alert_has_override:
                a["_replayedPassesGradeGate"] = 0
                a["_replayedGateReason"] = f"tier_premium_{grade}_blocked"
                continue
        elif not premium or premium < tier_floor:
            a["_replayedPassesGradeGate"] = 0
            a["_replayedGateReason"] = (
                f"tier_premium_low:{grade}_${int((premium or 0)/1000)}K<${int(tier_floor/1000)}K"
            )
            continue

        # Step 6: follow-through tracker (same shape as replay_alerts_through_gates).
        ft_key = (ticker, a.get("cp") or "", a.get("strike"), a.get("exp") or "")
        cutoff = alert_ts - max_window
        bucket = replay_follow_through.setdefault(ft_key, [])
        bucket[:] = [t for t in bucket if t >= cutoff]
        bucket.append(alert_ts)
        a["_replayedFollowThroughCount"] = len(bucket)

        # Step 7: conviction gates (min_repeat_fires, max_per_ticker_per_day).
        gates = _get_alert_gates(name)
        if gates:
            min_fires = int(gates.get("min_repeat_fires", 0) or 0)
            if min_fires > 1:
                window_sec = int(gates.get("follow_through_window_sec", 900) or 900)
                cutoff_specific = alert_ts - window_sec
                ft_in_window = sum(1 for t in bucket if t >= cutoff_specific)
                if ft_in_window < min_fires:
                    a["_replayedGateReason"] = f"below_2x:{ft_in_window}<{min_fires}"
                    continue

            max_per_ticker = int(gates.get("max_per_ticker_per_day", 0) or 0)
            if max_per_ticker > 0:
                posted_set = replay_posted_today.setdefault(alert_et_date, set())
                # Count existing fires on this (alert, ticker) pair. We store
                # 3-tuples (name, ticker, ts) so multiple fires can be tracked,
                # so unpack into a throwaway third var to avoid ValueError.
                count_for_ticker = sum(
                    1 for (n, t, _ts) in posted_set if n == name and t == ticker
                )
                if count_for_ticker >= max_per_ticker:
                    a["_replayedGateReason"] = f"ticker_capped:{ticker}_already_{count_for_ticker}_today"
                    continue
                # Passed — record this fire. Using ts in the tuple makes each
                # entry unique even when same (alert, ticker) fires repeatedly.
                posted_set.add((name, ticker, alert_ts))

        # All checks passed. Apply contract-level dedup: only the FIRST alert
        # on this (contract, date) gets `_replayedWouldForward=1`; subsequent
        # alerts on the same contract get `_replayedAggregatesIntoExisting=1`
        # (they would PATCH the existing Discord message in the live worker,
        # not create new posts). This is the key fix for the "199 alerts for
        # 50 contracts" inflation in the preview output.
        a["_replayedPassesConvictionGates"] = 1
        if agg_key in replay_contract_first_seen:
            a["_replayedAggregatesIntoExisting"] = 1
            a["_replayedFirstAlertId"] = replay_contract_first_seen[agg_key]
            a["_replayedWouldForward"] = 0
        else:
            a["_replayedWouldForward"] = 1
            replay_contract_first_seen[agg_key] = a.get("id")

    # ─── Post-loop: GLOBAL_MAX_PER_TICKER_PER_DAY enforcement ────────────
    # Cross-alert per-ticker cap. Without this, one ticker (e.g. MU with 11
    # alerts across Size/Vol>OI/Bullish/Bearish Leaps tiers) can dominate
    # Discord. Cap each ticker to the top N trades by premium.
    #
    # Why post-loop instead of inline: we need to know the full per-ticker
    # set BEFORE deciding which to keep, so we can pick top-N by premium
    # rather than first-N by arrival time. Live SSE handler can't do this
    # (no foresight) and falls back to first-N — that's fine for live mode
    # since arrival order roughly correlates with conviction (institutions
    # usually act fast on theses), but replay can do better.
    if GLOBAL_MAX_PER_TICKER_PER_DAY and GLOBAL_MAX_PER_TICKER_PER_DAY > 0:
        # Collect alerts currently marked would_forward=1, grouped by
        # (et_date, ticker). We re-compute ET date because the alert's
        # timestamp ultimately drives the cap window (UTC midnight ≠ ET).
        global_groups: dict = {}
        for a in sorted_alerts:
            if not a.get("_replayedWouldForward"):
                continue
            ts = a.get("timestamp") or a.get("ingested_at_ts") or 0
            try:
                et_date = datetime.fromtimestamp(
                    ts, tz=timezone.utc
                ).astimezone(ET).date().isoformat()
            except (OverflowError, ValueError):
                et_date = "1970-01-01"
            ticker = (a.get("ticker") or "").upper()
            if not ticker:
                continue
            global_groups.setdefault((et_date, ticker), []).append(a)

        # Per group, sort by premium descending and keep top N. The rest
        # get flipped to _replayedWouldForward=0 with a clear gate reason.
        for (et_date, ticker), group in global_groups.items():
            if len(group) <= GLOBAL_MAX_PER_TICKER_PER_DAY:
                continue
            # Sort top-down by premium; ties broken by earliest timestamp
            # (deterministic, favors earlier institutional positioning).
            group_sorted = sorted(
                group,
                key=lambda x: (
                    -(x.get("alertPremium") or x.get("premium") or 0),
                    x.get("timestamp") or 0,
                ),
            )
            kept = group_sorted[:GLOBAL_MAX_PER_TICKER_PER_DAY]
            blocked = group_sorted[GLOBAL_MAX_PER_TICKER_PER_DAY:]
            kept_premiums = [
                f"${int((a.get('alertPremium') or 0)/1000):,}K" for a in kept
            ]
            for b in blocked:
                b["_replayedWouldForward"] = 0
                b["_replayedGateReason"] = (
                    f"global_ticker_cap:{ticker}_kept_top_"
                    f"{GLOBAL_MAX_PER_TICKER_PER_DAY}_{','.join(kept_premiums)}"
                )

    return sorted_alerts


async def replay_post_alerts_to_discord(
    alerts: list,
    max_posts: int = 25,
    inter_post_delay_sec: float = 1.0,
) -> dict:
    """
    Post a list of (already-replayed) alerts to Discord with REPLAY footer.

    Use case: catch-up push after a gate config change. The caller already
    ran replay_alerts_through_full_pipeline + identified the would-forward
    alerts (excluding duplicates of already-posted SQLite rows). This function
    just executes the Discord POST for each.

    Differs from live worker's _post_to_discord:
      - No PATCH logic (each replay is its own message; no aggregation)
      - No re-gating (the caller already decided these qualify)
      - No SQLite mutation (caller handles that)
      - Adds REPLAY footer with the original trade time so subscribers see
        the alert is a historical catch-up, not real-time
      - Sequential with sleep() between posts to avoid Discord rate limits

    Inputs:
      alerts: list of alert dicts that should be posted. Each must have at
        minimum: ticker, cp, strike, exp, dte, alertPremium, ingestedAt.
      max_posts: hard cap on number of Discord POSTs. Defaults to 25 to
        prevent runaway. Caller can override.
      inter_post_delay_sec: sleep between posts. Discord webhooks allow ~30/
        min globally; 1s spacing = 60/min upper bound, comfortably under
        even bursting limits.

    Returns dict:
      {
        attempted: int,
        succeeded: int,
        failed: int,
        rate_limited: int,
        results: [{alert_id, ticker, ok, status, message_id, error}, ...],
        elapsed_sec: float,
      }
    """
    import asyncio
    import httpx
    t0 = time.time()

    if not DISCORD_WEBHOOK_URL:
        return {
            "attempted": 0, "succeeded": 0, "failed": 0, "rate_limited": 0,
            "results": [],
            "error": "DISCORD_WEBHOOK_URL not configured on worker — cannot replay.",
            "elapsed_sec": 0.0,
        }

    # Hard-cap defense: never post more than max_posts regardless of input length.
    alerts_to_post = list(alerts)[:max_posts]

    results = []
    succeeded = 0
    failed = 0
    rate_limited = 0

    async with httpx.AsyncClient(timeout=15.0) as client:
        for alert in alerts_to_post:
            try:
                # Build a single-fire aggregate from the alert dict so _build_embed
                # has the shape it expects. Use alert's actual trade ts (not now).
                trade_ts = alert.get("timestamp") or 0
                try:
                    if isinstance(trade_ts, str):
                        trade_ts = datetime.fromisoformat(
                            trade_ts.replace("Z", "+00:00")
                        ).timestamp()
                except Exception:
                    trade_ts = 0.0

                # Use the replayed final alert name (post-retag) so embed shows
                # "UCT Unusual Weeklies" rather than the original Vol>OI/Unusual.
                display_name = (
                    alert.get("_replayedFinalAlertName")
                    or alert.get("alertName")
                    or "Alert"
                )
                size = alert.get("tradeSize") or 0
                premium = float(alert.get("alertPremium") or 0)

                agg = {
                    "ticker": alert.get("ticker"),
                    "cp": alert.get("cp"),
                    "strike": alert.get("strike"),
                    "exp": alert.get("exp"),
                    "dte": alert.get("dte"),
                    "total_premium": premium,
                    "max_premium": premium,
                    "total_size": size,
                    "max_size": size,
                    "fire_count": 1,
                    "first_fire_ts": trade_ts,
                    "last_fire_ts": trade_ts,
                    "first_fill_price": alert.get("averageFillPrice"),
                    "last_fill_price": alert.get("averageFillPrice"),
                    "best_alert_name": display_name,
                    "best_alert_priority": _alert_priority({"alertName": display_name}),
                    "alert_names_seen": {display_name},
                    "prior_oi": alert.get("priorOI"),
                    "spot": alert.get("spot"),
                    "moneyness_pct": alert.get("moneynessPct"),
                    "moneyness_label": alert.get("moneynessLabel"),
                }

                embed = _build_embed(agg)

                # Add REPLAY marker to the footer/description so subscribers
                # see this isn't a live alert. Original trade time in ET.
                if trade_ts:
                    try:
                        trade_time_et = datetime.fromtimestamp(trade_ts, tz=ET).strftime("%-I:%M %p ET")
                    except Exception:
                        trade_time_et = "earlier today"
                else:
                    trade_time_et = "earlier today"
                replay_marker = f"⏪ REPLAY · trade fired at {trade_time_et}"
                if embed.get("description"):
                    embed["description"] = replay_marker + "\n" + embed["description"]
                else:
                    embed["description"] = replay_marker

                payload = {"embeds": [embed]}
                r = await client.post(_discord_post_url(), json=payload)

                if r.status_code == 429:
                    # Rate limited — back off and try once more
                    rate_limited += 1
                    retry_after = float(r.headers.get("Retry-After", "2"))
                    log.warning("[replay_post] rate limited, sleeping %ss", retry_after)
                    await asyncio.sleep(retry_after + 0.5)
                    r = await client.post(_discord_post_url(), json=payload)

                if r.status_code in (200, 204):
                    succeeded += 1
                    response_data = r.json() if r.content else {}
                    results.append({
                        "alert_id": alert.get("id"),
                        "ticker": alert.get("ticker"),
                        "ok": True,
                        "status": r.status_code,
                        "message_id": response_data.get("id"),
                    })
                else:
                    failed += 1
                    results.append({
                        "alert_id": alert.get("id"),
                        "ticker": alert.get("ticker"),
                        "ok": False,
                        "status": r.status_code,
                        "error": r.text[:200],
                    })
                    log.warning(
                        "[replay_post] failed id=%s status=%s body=%s",
                        alert.get("id"), r.status_code, r.text[:200],
                    )
            except Exception as e:
                failed += 1
                results.append({
                    "alert_id": alert.get("id"),
                    "ticker": alert.get("ticker"),
                    "ok": False,
                    "error": f"{type(e).__name__}: {str(e)[:200]}",
                })
                log.exception("[replay_post] exception for id=%s", alert.get("id"))

            # Inter-post delay — gentle pacing for Discord webhook.
            if inter_post_delay_sec > 0:
                await asyncio.sleep(inter_post_delay_sec)

    return {
        "attempted": len(alerts_to_post),
        "succeeded": succeeded,
        "failed": failed,
        "rate_limited": rate_limited,
        "results": results,
        "elapsed_sec": round(time.time() - t0, 2),
    }


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
    # Neutral "UCT Leaps" handler removed 2026-06-22 — the directional
    # variants (UCT Bullish Leaps / UCT Bearish Leaps) made the neutral
    # version redundant, so it was deleted upstream in Bullflow. If it ever
    # comes back, add: `if "Leaps" in name: return 5` here.
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
def _passes_table_filter(alert_name, premium, ticker, dte=None):
    """
    Returns (passes: bool, reason: str). Reason is "" on pass, short token on fail.
    Reason strings aren't surfaced to UI yet but kept for future debug visibility.

    The dte parameter is optional for backwards compat — callers that don't
    pass it skip the earnings short-DTE check. Callers in the live SSE path
    and replay path DO pass it so the earnings filter applies consistently.
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
    # HIGH_PREMIUM_OVERRIDE: trades $5M+ bypass per-alert mega-cap excludes.
    # A $11M NVDA call IS the signal — don't block on mega-cap rule alone when
    # the size is institutional-grade.
    alert_key = (alert_name or "").strip()
    alert_blocklist = ALERT_TICKER_BLOCKLISTS.get(alert_key)
    if alert_blocklist and ticker and ticker.upper() in alert_blocklist:
        if not premium or premium < HIGH_PREMIUM_OVERRIDE:
            return False, f"alert_blocked:{alert_key}:{ticker}"
        # Else: premium >= $5M → bypass mega-cap exclusion. Trade passes.
    # Earnings short-DTE block. Pure event-driven gambles on this-week-
    # reporting tickers (MU $1050P 10d type trades) get dropped at filter.
    # Trades with DTE > EARNINGS_MAX_DTE_BLOCK on the same tickers pass
    # through and get a disclaimer badge added in _build_embed.
    # HIGH_PREMIUM_OVERRIDE: $5M+ pre-earnings flow IS signal (e.g. MU $1200C
    # 4d $7M — that's institutional pre-earnings positioning, not noise).
    # Override the DTE block for those.
    if (
        ticker
        and isinstance(dte, (int, float))
        and dte <= EARNINGS_MAX_DTE_BLOCK
        and ticker.upper() in EARNINGS_THIS_WEEK
    ):
        if not premium or premium < HIGH_PREMIUM_OVERRIDE:
            return False, f"earnings_short_dte:{ticker.upper()}_{int(dte)}d"
        # Else: premium >= $5M → bypass earnings short-DTE block.
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
    # Earnings disclaimer — when the ticker reports this week and the trade
    # has DTE > EARNINGS_MAX_DTE_BLOCK (anything shorter was already filtered
    # out). Subscribers need to know an earnings catalyst is approaching so
    # they can size positions appropriately. The ticker lookup uses uppercase
    # since EARNINGS_THIS_WEEK keys are uppercased.
    earnings_date = EARNINGS_THIS_WEEK.get((ticker or "").upper())
    if earnings_date:
        badges.append(f"⚠️ **Earnings** {earnings_date}")

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
        # 2026-06-22: removed embed.thumbnail per Ravi's preference. The author
        # icon (~24x24 top-left) gives sufficient branding without the larger
        # ~80x80 thumbnail on the right competing with the alert data fields.
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
    #
    # Per-alert min_grade override: if the alert is in ALERT_CONVICTION_GATES
    # with a min_grade key, use that instead of the global MIN_DISCORD_GRADE.
    # This lets "UCT Unusual Weeklies" accept D-grade trades (where premium+
    # DTE+cap are the signal) without lowering the global floor for everyone.
    alert_min_grade_level = _get_alert_min_grade_level(alert.get("alertName") or "")
    if not message_id and _grade_level(grade) < alert_min_grade_level:
        _status["total_alerts_grade_gated"] = _status.get("total_alerts_grade_gated", 0) + 1
        log.debug(
            "[liveflow] grade %s below alert-min for %s — silent aggregate for %s %s $%s %s",
            grade, alert.get("alertName"),
            agg.get("ticker"), agg.get("cp"), agg.get("strike"), agg.get("exp"),
        )
        alert["gatePassed"] = False
        try:
            live_alerts_db.update_alert_state(alert.get("id"), gate_passed=0)
        except Exception as e:
            log.debug("[liveflow] gate_passed persist failed for id=%s: %s",
                      alert.get("id"), e)
        return

    # TIER_PREMIUM_REQUIREMENTS check — grade alone isn't enough. A B-grade
    # $700K trade and a B-grade $20M trade are different signals. Block when
    # the trade's premium falls below the per-tier floor (e.g. B requires $2M+).
    # Skip when the alert has an explicit min_grade override that this would
    # contradict (e.g. Unusual Weeklies accepts D — TIER req for D is None,
    # but the tier-override should win).
    alert_premium = agg.get("max_premium") or agg.get("total_premium") or 0
    if not message_id:
        tier_floor = TIER_PREMIUM_REQUIREMENTS.get(_strip_grade_emoji(grade))
        alert_has_override = bool(_get_alert_gates(alert.get("alertName") or "").get("min_grade"))
        tier_blocks = False
        block_reason = ""
        if tier_floor is None and not alert_has_override:
            tier_blocks = True
            block_reason = f"tier_premium_{grade}_blocked"
        elif tier_floor is not None and (not alert_premium or alert_premium < tier_floor):
            tier_blocks = True
            block_reason = (
                f"tier_premium_low:{grade}_${int((alert_premium or 0)/1000)}K"
                f"<${int(tier_floor/1000)}K"
            )
        if tier_blocks:
            _status["total_alerts_grade_gated"] = _status.get("total_alerts_grade_gated", 0) + 1
            log.debug(
                "[liveflow] %s — silent aggregate for %s %s $%s %s",
                block_reason, agg.get("ticker"), agg.get("cp"),
                agg.get("strike"), agg.get("exp"),
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

    passes, reason = _passes_table_filter(name, premium, ticker, dte=occ["dte"])
    if not passes:
        _status["total_alerts_dropped"] += 1
        # Don't buffer — drop counter is enough for status visibility.
        return

    # Re-tag candidates as "UCT Unusual Weeklies" when they meet the size-on-
    # weekly criteria (premium >= $500K, DTE <= 7, non-mega-cap ticker). This
    # routes them to their own gate config (min_grade=D) so genuine high-
    # conviction short-dated bets don't get buried by the standard grade gate
    # that's calibrated for longer-DTE flow. See _maybe_retag_weeklies docstring.
    name = _maybe_retag_weeklies(name, ticker, premium, occ["dte"])

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
        # Capture whether this was a new post BEFORE _post_to_discord runs,
        # since after the call the aggregate will have a message_id either way.
        contract_key = _make_contract_key(alert)
        agg_before = _contract_aggregates.get(contract_key) if contract_key else None
        was_new_post = not (agg_before and agg_before.get("discord_message_id"))

        await _post_to_discord(discord_client, alert)

        # Record per-(alert, ticker) post for the per-alert cap (if configured).
        name = (alert.get("alertName") or "").strip()
        gates = _get_alert_gates(name)
        if int(gates.get("max_per_ticker_per_day", 0) or 0) > 0:
            _mark_alert_posted_for_ticker(name, alert.get("ticker") or "")

        # Bump GLOBAL ticker counter ONLY on new posts. Patches don't count —
        # they're the same contract evolving, not a new ticker mention.
        # _mark_alert_posted_for_ticker already bumps global; for alerts WITHOUT
        # a per-alert cap, we need to bump global directly here.
        if was_new_post:
            _bump_global_ticker_counter(alert.get("ticker") or "")
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
