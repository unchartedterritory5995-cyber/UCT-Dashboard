"""
Live Massive Router — TEST PHASE for Massive-based live flow

Mirrors /api/live/alerts/recent but sources data from FlowDB (worker writes)
instead of Bullflow SSE. The frontend test page (LiveFlowMassive.jsx) polls
this endpoint every 5s and renders the same UI as the existing LiveFlow.

Architecture:
  Massive WS → massive_ws_worker.py → flow table (FlowDB)
  Worker computes Color in real-time when OI arrives:
    cum_vol >= 1.5 * OI  →  MAGENTA  (strong single-trade conviction)
    cum_vol > OI         →  YELLOW   (cumulative accumulation)
  This endpoint surfaces those classified rows + tier-naming + conviction.

Filters applied:
  - source = 'stocks' (indexes have aggregation-boundary risk per 6/26)
  - Color IN ('MAGENTA', 'YELLOW') (drop WHITE noise, drop ARB cancels/clusters)
  - CreatedDate = today (rolling live window)

Tier derivation from row characteristics:
  MAGENTA + premium >= $1M + ASK + DTE < 180  →  Alpha Gold (rarest)
  MAGENTA + DTE >= 180                         →  Bull/Bear LEAPS
  MAGENTA + premium >= $500K                   →  Size Bulls/Bears
  MAGENTA + V/OI >= 5                          →  Unusual
  MAGENTA                                       →  Bullish/Bearish
  YELLOW + DTE >= 180                          →  Bull/Bear LEAPS (lower priority)
  YELLOW                                        →  Bullish/Bearish (accumulation)
  Type=ML/                                      →  Algo (multi-leg, non-directional)

Why this lives separately:
  1. We don't want to break the existing LiveFlow.jsx wiring during testing
  2. The Bullflow worker (liveflow_worker.py) and this router can coexist
  3. Once validated, swap LiveFlow.jsx data source URL — no other changes needed
"""
from fastapi import APIRouter, Query, Request, HTTPException
from datetime import date, datetime, timezone, timedelta
import sqlite3
import os
import time
import re
import json

router = APIRouter(prefix="/api/live/massive", tags=["live-flow-massive"])

DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")
ET = timezone(timedelta(hours=-4))


# ─── Tier priority (for convictionScore weighting) ─────────────────────────
# Lower priority number = higher quality signal. Matches Bullflow taxonomy.
# bullish and bearish share priority 3 (same conviction weight, just opposite
# direction — used for grouping in the UI).
TIER_PRIORITY = {
    "alpha":   1,
    "size":    2,
    "bullish": 3,
    "bearish": 3,
    "leaps":   4,
    "unusual": 5,
    "algo":    99,
}


# ─── Curated mode thresholds + qualification ────────────────────────────────
# Curated mode is the "best of the best" view — only alerts that meet stacked
# criteria show up. The thresholds are admin-tunable via /thresholds endpoint
# and persisted to a JSON file so values stick across deploys.
#
# Stacking model:
#   Tiers {alpha, size, leaps, bullish, bearish}:
#     1. Premium MUST meet tier+cap-band floor (HARD requirement)
#     2. AND must meet ≥ stack.min_signals of these 3 quality confirmers:
#          - V/OI ≥ stack.vOI
#          - Hit count (same-contract repeats) ≥ stack.hit_count
#          - Grade ≥ stack.grade
#     min_signals=0 → premium alone qualifies (loose)
#     min_signals=1 → premium + 1 confirmer (default)
#     min_signals=2 → premium + 2 confirmers
#     min_signals=3 → premium + all 3 confirmers (strictest)
#
#   Tier 'unusual' (cap-agnostic, own path):
#     Show if premium >= unusual.min_premium AND v_oi >= unusual.vOI.
#     The signal IS the V/OI anomaly on a normally-quiet name — no stacking.
#     NOTE: True "unusual name" detection (dormant ticker lookup over past N
#     trading days) is planned for after-hours build. For now, the existing
#     V/OI-based Unusual tier rule applies.
#
#   Tier 'algo': always excluded from Curated.

_THRESHOLDS_PATH = os.environ.get("CURATED_THRESHOLDS_PATH", "/data/curated_thresholds.json")
_thresholds_cache = None

DEFAULT_THRESHOLDS = {
    "stack": {
        "min_signals": 1,         # min quality confirmers (out of 3); premium always required
        "vOI": 3.0,
        "hit_count": 3,
        "grade": "B",
    },
    "premium_by_cap": {
        # premium $ floor by tier and cap band
        "alpha":   {"mid_small": 1_000_000, "large": 1_000_000, "mega": 1_000_000},
        "size":    {"mid_small":   500_000, "large":   750_000, "mega": 1_000_000},
        "leaps":   {"mid_small":   500_000, "large":   750_000, "mega": 1_000_000},
        "bullish": {"mid_small":   250_000, "large":   500_000, "mega":   750_000},
        "bearish": {"mid_small":   250_000, "large":   500_000, "mega":   750_000},
    },
    "unusual": {
        "min_premium": 100_000,
        "vOI": 5.0,
    },
    "cap_bands": {
        # in $ market cap. Below mid_small_max = "mid_small";
        # mid_small_max to large_max = "large"; above large_max = "mega"
        "mid_small_max":  10_000_000_000,    # <$10B = mid/small cap
        "large_max":     200_000_000_000,    # $10B-$200B = large; >$200B = mega
    },
    # Big sweeps/blocks on fresh strikes (OI=0) get classified WHITE because
    # Massive's V/OI classifier can't compute a ratio without OI. This rule
    # promotes those rows to MAGENTA-equivalent classification so they
    # surface in /live-massive. Catches institutional sweeps Massive would
    # otherwise miss (Bullflow surfaces them via different criteria).
    "premium_override": {
        "enabled": True,
        "min_premium": 1_000_000,
        "require_sweep_or_block": True,
    },
    # Deep-ITM filter for Alpha Gold tier (added 6/29 audit).
    #
    # Background: deep in-the-money calls/puts are typically delta-exposure
    # tools (essentially synthetic stock with leverage) rather than direct-
    # ional conviction bets. A $1M+ ask-side buy on a 60% ITM call is
    # mechanical positioning, not a high-conviction signal worth surfacing
    # at the top tier. MRVL 6/29 example: $170C with spot ~$277 (62.9%
    # ITM) qualified for Alpha Gold under the old rules despite being a
    # synthetic-stock substitute.
    #
    # When an otherwise-Alpha-eligible row is deeper than this % ITM, the
    # tier classifier falls through to the Size tier check ($500K-$1M+
    # premium depending on cap band) so the institutional positioning
    # still surfaces -- just not at the Alpha Gold conviction tier.
    #
    # Moneyness pct is measured as (spot - strike) / strike * 100 for
    # calls, with sign flipped for puts so positive = ITM consistently.
    # Threshold of 25% means: calls with strike < 80% of spot (or puts
    # with strike > 125% of spot) are blocked from Alpha Gold.
    "alpha_max_itm_pct": 25.0,
    # Vol/OI gate for Alpha Gold tier (added 6/30 morning).
    #
    # Alpha Gold should require FRESH institutional positioning -- new
    # exposure being created, not adjustments to yesterday's positions.
    # Volume exceeding open interest is the canonical signal for this:
    # today's flow on this contract is larger than the entire prior
    # accumulated position. That's new conviction, not noise.
    #
    # Default 1.0 = vol must strictly exceed OI (the literal "vol > oi"
    # reading). Set higher (e.g. 1.5) for stricter "fresh and dominant"
    # positioning. Set to 0 to disable this gate.
    #
    # Contracts with unknown OI (Schwab snapshot misses, fresh strikes
    # with no OI history) are REJECTED at this gate -- we can't verify
    # the freshness criterion without known OI. Those rows fall through
    # to Size tier where the requirement doesn't apply.
    "alpha_min_vol_oi_ratio": 1.0,
    # Block-type exclusion for Alpha Gold (added 6/30 morning).
    #
    # BLOCK trades are pre-negotiated off-exchange single transactions.
    # When a single BLOCK has huge volume (>OI), it LOOKS like dominant
    # fresh positioning -- but the V/OI dominance can be artifact of a
    # multi-leg structure (delta-neutral spread, stock-hedge pair, etc.)
    # where the apparent directional signal is offset by the other leg.
    #
    # Until next-day settled OI confirms the directional exposure was
    # real, a BLOCK with high V/OI is suggestive but not high-conviction.
    # Exclude BLOCKs from Alpha Gold entirely; they fall through to Size
    # tier where they're still surfaced but not treated as top conviction.
    #
    # SWEEPs are NOT excluded -- they're inherently multi-venue aggressive
    # liquidity-takers, not negotiable, and V/OI dominance is a cleaner
    # signal for sweeps than for blocks.
    "alpha_exclude_block_type": True,
    # Global deep-ITM filter (added 6/30 morning).
    #
    # Trades deeper than this threshold are "synthetic stock substitute"
    # plays -- the trader is using deep-ITM options as a leveraged stock
    # exposure, not making a directional bet on the option itself. They
    # have no informational value as flow signals and clutter the feed.
    #
    # When a trade is deeper than this threshold, it is REJECTED entirely
    # from the alert feed -- not just demoted to a lower tier. The row
    # does not appear in /live-massive at all.
    #
    # Two-tier ITM logic:
    #   - alpha_max_itm_pct (25%): demote from Alpha Gold, keep in Size
    #   - max_itm_pct (50%): drop entirely from feed
    #
    # 25-50% ITM range still surfaces as Size/Bullish/Bearish (these
    # can be legitimate aggressive ITM directional bets). 50%+ is
    # consensus deep-ITM and suppressed.
    "max_itm_pct": 50.0,
    # Size tier V/OI gate (added 6/30 evening).
    #
    # Size tier ($500K-$1M+ premium MAGENTA, not Alpha-Gold-quality)
    # was previously promoted purely on premium. That surfaced large
    # institutional positioning but also a lot of low-V/OI rows that
    # represent adjustments to existing positions rather than fresh
    # conviction flow. Adding a V/OI floor narrows Size tier to trades
    # where today's volume is dominating prior OI -- same "fresh
    # positioning" principle as the Alpha Gold gate, just looser.
    #
    # Default 1.0 = vol must strictly exceed OI. Set to 0 to disable
    # (recover previous behavior). Like the Alpha Gold gate, this
    # requires KNOWN OI (>0); Schwab snapshot misses fail this gate
    # and fall through to bullish/bearish tier.
    "size_min_vol_oi_ratio": 1.0,
    # Strict directional rule (added 6/30 evening, after audit).
    #
    # When True (default), only the unambiguously-aggressive sides
    # produce Bull/Bear direction classification:
    #   - A   (at ask)        Bull on calls / Bear on puts
    #   - AA  (above ask)     Bull on calls / Bear on puts
    #   - BB  (below bid)     Bear on calls / Bull on puts
    #
    # Side=B (at bid only) is dropped from directional classification.
    # Bid-side fills can be closing trades, covered call writes, dealer
    # hedges, or aggressive selling -- the mechanics don't tell us which.
    # Without intent signal, calling them directional generates noise.
    #
    # Today's audit (6/30) showed most Size-tier disagreements between
    # UCT and BBS/Bullflow were on bid-side BLOCK trades where all three
    # sources guessed differently because the trade itself was ambiguous.
    #
    # When False, falls back to legacy behavior (B and BB both treated
    # as bid-side, no distinction).
    "derive_strict_bid_only_bb": True,
    # Fresh-strike promotion threshold (added 6/30 evening).
    #
    # When OI is explicitly known to be zero (Schwab confirmed: no
    # settled OI yesterday — usually a brand new strike that opened
    # today), AND today's volume is at least this threshold, treat the
    # contract as PASSING the V/OI gate (any V/OI test reads as
    # "freshly established institutional position").
    #
    # This is the canonical fresh-strike pattern: someone opens a new
    # strike and immediately builds a meaningful position. Every contract
    # of today's volume is brand-new exposure. Highest-conviction signal
    # possible.
    #
    # Critically, this only applies when OI is EXPLICITLY zero from
    # Schwab. When OI is null/empty (Schwab fetch failed, status unknown),
    # the gate still rejects -- we don't know if it's a fresh strike or
    # a transient API failure. Erring conservative on data quality.
    #
    # Default 100 contracts: high enough to filter out random tiny
    # opening prints, low enough to catch real institutional bets.
    "fresh_strike_min_volume": 100,
    # V/OI gate for Bullish/Bearish catchall tier (added 6/30 evening).
    #
    # The catchall directional tier was previously gateless -- any MAGENTA
    # row with premium and a direction landed in Bullish or Bearish. Today's
    # audit showed 36% direction-disagreement on Bearish vs BBS/Bullflow,
    # mostly because the tier admitted noisy low-V/OI reads.
    #
    # Applying the same V/OI > 1.0 floor as Size/Alpha narrows the tier to
    # only fresh positioning. Failed rows drop from curated entirely
    # (uncurated still shows them).
    #
    # Set to 0 to disable (recover previous behavior — risky, catches lots
    # of noise).
    "bullish_bearish_min_vol_oi_ratio": 1.0,
    # V/OI gate for LEAPS tier (added 6/30 evening).
    #
    # Same principle as Bullish/Bearish. LEAPS gate is independent so it
    # can be tuned looser if institutional position-building on long-dated
    # contracts consistently shows low same-day V/OI. Default starts at
    # the same 1.0 as other tiers; adjust based on observed flow patterns.
    "leaps_min_vol_oi_ratio": 1.0,
}

_GRADE_NUMERIC = {"A+ 🚀": 4, "A+": 4, "A": 3, "B": 2, "C": 1, "D": 0}


def _deep_merge_thresholds(defaults: dict, saved: dict) -> dict:
    """Merge saved values into defaults so missing keys fall back gracefully
    when the saved file pre-dates a new threshold being added."""
    out = json.loads(json.dumps(defaults))  # deep copy
    for k, v in saved.items():
        if k in out and isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = _deep_merge_thresholds(out[k], v)
        else:
            out[k] = v
    return out


def _load_thresholds() -> dict:
    """Load thresholds from disk, falling back to defaults. Cached in-memory
    after first read; cache invalidates on _save_thresholds()."""
    global _thresholds_cache
    if _thresholds_cache is not None:
        return _thresholds_cache
    try:
        if os.path.exists(_THRESHOLDS_PATH):
            with open(_THRESHOLDS_PATH) as f:
                saved = json.load(f)
            _thresholds_cache = _deep_merge_thresholds(DEFAULT_THRESHOLDS, saved)
        else:
            _thresholds_cache = json.loads(json.dumps(DEFAULT_THRESHOLDS))
    except Exception as e:
        print(f"[curated] Failed to load thresholds ({e}), using defaults")
        _thresholds_cache = json.loads(json.dumps(DEFAULT_THRESHOLDS))
    return _thresholds_cache


def _save_thresholds(thresholds: dict) -> bool:
    """Persist thresholds to disk. Refresh cache on success."""
    global _thresholds_cache
    try:
        merged = _deep_merge_thresholds(DEFAULT_THRESHOLDS, thresholds)
        os.makedirs(os.path.dirname(_THRESHOLDS_PATH), exist_ok=True)
        tmp = _THRESHOLDS_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump(merged, f, indent=2)
        os.replace(tmp, _THRESHOLDS_PATH)  # atomic swap
        _thresholds_cache = merged
        return True
    except Exception as e:
        print(f"[curated] Failed to save thresholds: {e}")
        return False


def _cap_band_key(mkt_cap, cap_bands: dict) -> str:
    """Classify a ticker's market cap into 'mid_small', 'large', or 'mega'."""
    mc = mkt_cap if isinstance(mkt_cap, (int, float)) else _parse_int(mkt_cap)
    if not mc or mc <= 0:
        return "mid_small"   # default to most permissive when unknown
    if mc < cap_bands.get("mid_small_max", 10_000_000_000):
        return "mid_small"
    if mc < cap_bands.get("large_max", 200_000_000_000):
        return "large"
    return "mega"


def _qualifies_curated(alert: dict, thresholds: dict) -> bool:
    """Apply Curated-mode filter to a single alert.
    Returns True if the alert should be visible in Curated mode.

    Rule (for alpha/size/leaps/bullish/bearish tiers):
      1. Premium MUST meet tier+cap floor (HARD requirement, no skip)
      2. AND ≥ stack.min_signals of these 3 quality signals must also pass:
            - V/OI ≥ stack.vOI
            - hit count ≥ stack.hit_count
            - grade ≥ stack.grade
         min_signals=0 → premium alone qualifies
         min_signals=1 → premium + 1 confirmer (recommended default)
         min_signals=3 → premium + all confirmers (strictest)

    Rule (for unusual tier): own path — premium + V/OI thresholds only
    Rule (for algo tier): always excluded
    """
    tier = alert.get("_tierKey", "")

    if tier == "algo":
        return False

    prem = alert.get("alertPremium") or 0
    v_oi = alert.get("volumeOIRatio") or 0
    hit_count = alert.get("_hitCount") or 1
    grade = alert.get("grade", "")
    mkt_cap = alert.get("_mktCap") or 0

    # Unusual: own path. V/OI anomaly + small premium IS the signal.
    if tier == "unusual":
        u = thresholds.get("unusual", {})
        return (prem >= u.get("min_premium", 100_000) and
                v_oi >= u.get("vOI", 5.0))

    if tier not in ("alpha", "size", "leaps", "bullish", "bearish"):
        return False

    stack = thresholds.get("stack", {})
    prem_caps = thresholds.get("premium_by_cap", {}).get(tier, {})
    cap_bands = thresholds.get("cap_bands", {})

    # ─── HARD requirement: premium tier+cap floor ─────────────────────
    band = _cap_band_key(mkt_cap, cap_bands)
    prem_floor = prem_caps.get(band, 0)
    if prem < prem_floor:
        return False

    # ─── Count quality signals (V/OI, hits, grade) ────────────────────
    quality_signals = 0
    if v_oi >= stack.get("vOI", 3.0):
        quality_signals += 1
    if hit_count >= stack.get("hit_count", 3):
        quality_signals += 1
    min_grade_n = _GRADE_NUMERIC.get(stack.get("grade", "B"), 2)
    if _GRADE_NUMERIC.get(grade, 0) >= min_grade_n:
        quality_signals += 1

    return quality_signals >= stack.get("min_signals", 1)


# ─── Dormant ticker tracking (true "Unusual name" detection) ──────────────
# A ticker is "dormant" if it has NOT produced any classifiable MAGENTA/
# YELLOW alert in the past N trading days. The Unusual tier promotes a
# dormant ticker that suddenly shows up with high V/OI flow — the canonical
# "name that doesn't normally trade flow is suddenly trading" signal.
#
# Storage model:
#   /data/dormant_tickers.json — JSON file written by the recompute job.
#   Contains the ACTIVE set (smaller than universe of all tickers).
#   Lookup: ticker IN active_set → not dormant. NOT IN → dormant.
#
# Performance model:
#   File loaded into a frozenset at module level. Membership check is O(1).
#   Cache invalidates on file mtime change (so manual recompute takes effect
#   without restart).
#
# Graceful fallback:
#   If dormant data hasn't been computed yet (initial deploy, missing file),
#   _has_dormant_data() returns False and the classifier falls back to the
#   legacy V/OI-only Unusual rule. This means the system works seamlessly
#   pre- and post-precompute without manual coordination.

_DORMANT_PATH = os.environ.get("DORMANT_TICKERS_PATH", "/data/dormant_tickers.json")
_dormant_cache = None         # full JSON object (for status display)
_dormant_active_set = None    # frozenset(active_tickers) for fast lookup
_dormant_loaded_mtime = 0     # mtime when we last loaded (for cache invalidation)


def _load_dormant_tickers():
    """Load dormant tickers data from disk into module cache. Re-reads if
    file mtime is newer than our cached load time (so manual recomputes
    take effect without process restart). Safe to call on every request."""
    global _dormant_cache, _dormant_active_set, _dormant_loaded_mtime
    try:
        if not os.path.exists(_DORMANT_PATH):
            # Reset caches if file was deleted
            if _dormant_cache is not None:
                _dormant_cache = None
                _dormant_active_set = None
                _dormant_loaded_mtime = 0
            return
        mtime = os.path.getmtime(_DORMANT_PATH)
        if _dormant_cache is not None and mtime <= _dormant_loaded_mtime:
            return  # cache still valid
        with open(_DORMANT_PATH) as f:
            data = json.load(f)
        _dormant_cache = data
        _dormant_active_set = frozenset(data.get("active_tickers", []))
        _dormant_loaded_mtime = mtime
    except Exception as e:
        print(f"[dormant] load error: {e}")
        # Don't clobber existing cache on error — better to use stale than empty
        if _dormant_cache is None:
            _dormant_cache = {}
            _dormant_active_set = frozenset()


def _has_dormant_data() -> bool:
    """True if precompute has been run and active-tickers set is loaded.
    When False, classifier should fall back to legacy V/OI Unusual rule."""
    _load_dormant_tickers()
    return _dormant_active_set is not None and len(_dormant_active_set) > 0


def _is_dormant_ticker(symbol: str) -> bool:
    """True if ticker is NOT in the active-tickers set (i.e. dormant).
    Returns False if no precompute data — caller should check _has_dormant_data()
    first to decide which classification path to take."""
    _load_dormant_tickers()
    if _dormant_active_set is None:
        return False
    return symbol not in _dormant_active_set


def _trading_days_back(n: int, end_date: date = None) -> list:
    """Return the last N trading days as date objects, ending at `end_date`
    (default: today). Weekends excluded. Holidays NOT excluded (over-includes
    by 5-9 calendar days per year, harmless for "dormancy in N trading days").
    """
    end = end_date or datetime.now(ET).date()
    dates = []
    d = end
    while len(dates) < n:
        if d.weekday() < 5:  # 0-4 = Mon-Fri
            dates.append(d)
        d -= timedelta(days=1)
    return dates


def _compute_active_tickers(lookback_days: int = 30) -> dict:
    """Scan FlowDB for distinct tickers with at least one classifiable
    MAGENTA/YELLOW alert in the past N trading days. Returns dict matching
    the JSON file schema. Heavy operation — full DB scan, can take 1-5s."""
    trading_dates = _trading_days_back(lookback_days)
    earliest = trading_dates[-1]
    today = trading_dates[0]
    date_strs = [f"{d.month}/{d.day}/{d.year}" for d in trading_dates]

    conn = sqlite3.connect(DB_PATH, timeout=30)
    try:
        placeholders = ",".join("?" for _ in date_strs)
        cur = conn.execute(f"""
            SELECT Symbol, COUNT(*) AS hits
              FROM flow
             WHERE source = 'stocks'
               AND Color IN ('MAGENTA', 'YELLOW')
               AND CreatedDate IN ({placeholders})
             GROUP BY Symbol
        """, date_strs)
        rows = cur.fetchall()
        active = sorted([r[0] for r in rows if r[0]])
        total_hits = sum(r[1] for r in rows)
    finally:
        conn.close()

    return {
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "lookback_trading_days": lookback_days,
        "earliest_date": f"{earliest.month}/{earliest.day}/{earliest.year}",
        "today_date": f"{today.month}/{today.day}/{today.year}",
        "active_tickers": active,
        "active_count": len(active),
        "total_alerts_scanned": total_hits,
    }


def _is_unusual_classification(symbol: str, v_oi: float, premium: int) -> bool:
    """Should this alert be classified as Unusual tier?

    Two modes depending on whether dormant precompute data is available:

    Dormant mode (preferred — when precompute has been run):
      Symbol must be DORMANT (not in active set) +
      V/OI >= 5.0 + premium >= $100K.
      This catches "quiet name suddenly waking up" — the canonical Unusual.
      AAPL/NVDA/TSLA will NEVER qualify because they trade every day.

    Legacy mode (fallback — pre-precompute):
      V/OI >= 5.0 + premium < $500K.
      Preserved so the system works seamlessly during initial deploy before
      the dormant precompute has been triggered.
    """
    if v_oi < 5.0:
        return False
    if _has_dormant_data():
        return _is_dormant_ticker(symbol) and premium >= 100_000
    # Legacy fallback
    return premium < 500_000


def _parse_int(s, default=0):
    try:
        return int(s) if s else default
    except (ValueError, TypeError):
        return default


def _oi_status(raw):
    """Distinguish 'OI explicitly known to be zero' (fresh strike, no
    settled positions yesterday) from 'OI unknown' (Schwab couldn't
    retrieve data for this contract).

    Both return integer 0 from _parse_int, but they're semantically
    different: a real fresh strike with active volume is high-conviction
    institutional positioning (every contract today is new exposure),
    while unknown OI is just missing data.

    Returns one of:
      ("known", int)  — Schwab returned a positive integer value
      ("zero", 0)     — Schwab explicitly returned "0" (real fresh strike)
      ("unknown", 0)  — Schwab returned null/empty (failed fetch)
    """
    if raw is None:
        return ("unknown", 0)
    if isinstance(raw, str):
        raw_s = raw.strip()
        if raw_s == "":
            return ("unknown", 0)
        if raw_s == "0":
            return ("zero", 0)
        try:
            val = int(raw_s)
            if val > 0:
                return ("known", val)
            if val == 0:
                return ("zero", 0)
            return ("unknown", 0)  # negative is weird, treat as unknown
        except ValueError:
            return ("unknown", 0)
    if isinstance(raw, (int, float)):
        if raw > 0:
            return ("known", int(raw))
        if raw == 0:
            return ("zero", 0)
        return ("unknown", 0)
    return ("unknown", 0)


def _parse_float(s, default=0.0):
    try:
        return float(s) if s else default
    except (ValueError, TypeError):
        return default


def _parse_strike(s):
    """Strike may be stored as '30' or '30.5' or '30.0' — return float."""
    return _parse_float(s, 0.0)


def _ts_from_row(created_date: str, created_time: str) -> float:
    """'6/26/2026' + '11:25:14 AM' -> Unix timestamp."""
    try:
        m, d, y = created_date.split("/")
        # Parse the time format "H:MM:SS AM/PM"
        t = datetime.strptime(created_time.strip(), "%I:%M:%S %p")
        dt = datetime(int(y), int(m), int(d), t.hour, t.minute, t.second, tzinfo=ET)
        return dt.timestamp()
    except (ValueError, AttributeError):
        return 0.0


def _derive_direction(cp: str, side: str, type_: str = ""):
    """Bull/Bear from Side+CP. Returns None when the side classification
    is too ambiguous to call directional.

    Refined rule (added 6/30 evening, after audit analysis showed bid-side
    blocks are unreliable directional signals):

      Aggressive sides (kept as directional):
        - A   (at ask)        — buyer aggression
        - AA  (above ask)     — strong buyer aggression
        - BB  (below bid)     — strong seller aggression

      Ambiguous side (dropped — return None):
        - B   (at bid)        — can be closing trade, covered call write,
                                dealer hedge, or genuine seller aggression.
                                Without more context, not a clean direction
                                signal. Trader can still see these in
                                uncurated mode.
        - Mid / blank         — no signal at all

    Tunable via thresholds.derive_strict_bid_only_bb. When False, falls back
    to legacy behavior treating B and BB identically (pre-6/30 logic).

    Empty-side SWEEP fallback (added 2026-07-03):
      When side is empty AND type is SWEEP, presume A (at ask). Sweeps are
      by definition aggressive orders that cross the spread across venues;
      market microstructure makes them almost always buyer-initiated
      (~85%+ per BBS side distribution audit). This lets high-conviction
      institutional sweeps (e.g. SPCX $2.4M 10:36 CALL SWEEP on 7/2) reach
      the Premium Override rescue path in _derive_alert_name, which they
      previously couldn't because empty-side rows exited before the
      override could run.

      Only applies to SWEEP type (including ISO variants). BLOCKs stay
      strict — a $3M BLOCK with no side signal is more ambiguous than a
      SWEEP (could be portfolio rebalance, dealer facilitation, etc.).

      Tunable via thresholds.sweep_empty_side_as_ask (default True).
      Set False to revert to strict "empty = drop" behavior.

    For PUT contracts, direction maps inversely as before.
    """
    side_norm = (side or "").strip().upper()
    type_up = (type_ or "").upper().strip().strip("/")
    is_sweep = ("SWEEP" in type_up) or ("ISO" in type_up)

    # Empty-side handling with SWEEP fallback
    if not side_norm:
        try:
            thresholds = _load_thresholds()
            sweep_fallback = thresholds.get("sweep_empty_side_as_ask", True)
        except Exception:
            sweep_fallback = True
        if sweep_fallback and is_sweep:
            # Presume ASK — sweeps are buyer-driven
            side_is_ask = True
            side_is_bid = False
        else:
            return None
    else:
        # Non-empty side: original strict/legacy logic
        try:
            thresholds = _load_thresholds()
            strict = thresholds.get("derive_strict_bid_only_bb", True)
        except Exception:
            strict = True

        # Aggressive ask-side (always directional)
        if side_norm in ("A", "AA"):
            side_is_ask = True
            side_is_bid = False
        elif side_norm == "BB":
            # Below-bid: unambiguous seller aggression, always directional
            side_is_ask = False
            side_is_bid = True
        elif side_norm == "B":
            if strict:
                # Strict mode: at-bid alone is ambiguous, drop
                return None
            # Legacy mode: treat B same as BB
            side_is_ask = False
            side_is_bid = True
        else:
            # Unknown side string
            return None

    if cp == "CALL":
        if side_is_ask: return "Bull"
        if side_is_bid: return "Bear"
    elif cp == "PUT":
        if side_is_ask: return "Bear"   # PUT bought = bearish bet
        if side_is_bid: return "Bull"   # PUT sold = bullish bet
    return None


def _derive_alert_name(row: dict, direction: str, money_pct: float | None = None):
    """Returns (alertName, tier_key, tier_priority), or None if the row
    is a WHITE color that didn't qualify for premium-override promotion.

    Mapping aligns to LiveFlow.jsx deriveTier() so the existing UI groups
    Massive rows into the right colored sections without modification.

    money_pct (optional): signed moneyness percentage (positive = ITM,
    negative = OTM) from _moneyness(). When provided, deep-ITM rows are
    blocked from Alpha Gold tier and fall through to Size tier instead.
    See thresholds.alpha_max_itm_pct for the cutoff (default 25%).
    """
    color = row["Color"]
    type_ = row["Type"] or ""
    premium = _parse_int(row["Premium"])
    side = row["Side"] or ""
    dte = _parse_int(row["Dte"])
    volume = _parse_int(row["Volume"])
    oi = _parse_int(row["OI"])
    v_oi = (volume / oi) if oi > 0 else 0

    # Distinguish "explicitly zero OI" (real fresh strike) from "unknown
    # OI" (Schwab fetch failed). _parse_int collapses both to 0 for math,
    # but the gates need the distinction to handle fresh strikes correctly.
    oi_status, _ = _oi_status(row.get("OI"))
    # oi_status is one of: "known", "zero", "unknown"

    try:
        fresh_strike_min_vol = _load_thresholds().get(
            "fresh_strike_min_volume", 100)
    except Exception:
        fresh_strike_min_vol = 100
    # A row counts as "fresh-strike-with-volume" when Schwab confirmed
    # zero OI yesterday AND today's volume crosses the threshold.
    # Every contract trading today is brand-new exposure -- the strongest
    # possible "fresh positioning" signal.
    is_fresh_strike = (oi_status == "zero" and volume >= fresh_strike_min_vol)

    # Multi-leg complex strategies → Algo (non-directional, low priority)
    if type_ == "ML/":
        return ("Algo", "algo", TIER_PRIORITY["algo"])

    # ─── Global deep-ITM rejection (added 6/30 morning) ──────────────
    # Trades deeper than max_itm_pct% ITM are synthetic-stock-substitute
    # plays with no flow-signal value. Reject entirely -- the row will
    # not appear in /live-massive at all. Distinct from the Alpha-tier-
    # only filter (alpha_max_itm_pct, typically 25%) which only demotes.
    # This rejects across ALL tiers above the higher threshold (50%).
    try:
        max_itm = _load_thresholds().get("max_itm_pct", 50.0)
    except Exception:
        max_itm = 50.0
    if money_pct is not None and money_pct > max_itm:
        return None

    is_leaps = dte >= 180
    side_is_ask = side in ("A", "AA")

    # Direction-aware tier key: Bull → "bullish", Bear → "bearish".
    # Both share priority 3 in TIER_PRIORITY, just rendered in different
    # colored sections in LiveFlow.jsx (green vs red).
    dir_tier = "bullish" if direction == "Bull" else "bearish"

    # ─── Premium override (rescue high-conviction WHITE rows) ──────────
    # Massive's classifier assigns Color = WHITE when cum_vol/OI < 1.0.
    # If OI is unknown (e.g. fresh strike, Schwab snapshot miss), the
    # ratio defaults to 0 → WHITE → row filtered out of /live-massive.
    # But a $3M ASK sweep is institutional-grade regardless of what OI
    # says. This rule promotes those rows to MAGENTA-equivalent classify-
    # ation so they surface. Tunable via thresholds.premium_override.
    if color == "WHITE":
        try:
            override = _load_thresholds().get("premium_override", {})
        except Exception:
            override = {}
        if override.get("enabled", True):
            min_prem = override.get("min_premium", 1_000_000)
            require_sb = override.get("require_sweep_or_block", True)
            type_up = type_.upper().strip().strip("/")
            is_sweep_or_block = (
                "SWEEP" in type_up or "ISO" in type_up or "BLOCK" in type_up
                or type_up in ("BLK", "B", "BL", "BT", "S", "SW", "IS")
            )
            if premium >= min_prem and (is_sweep_or_block or not require_sb):
                # Promote — fall through to MAGENTA branch below.
                color = "MAGENTA"

    if color == "MAGENTA":
        # Alpha Gold — rarest, top tier
        if premium >= 1_000_000 and side_is_ask and not is_leaps:
            # ─── Alpha Gold quality gates (ALL must pass) ──────────────
            # Each gate is independent. Failing any gate falls through
            # to the Size / Unusual / Bullish-Bearish tier below.
            try:
                thresholds = _load_thresholds()
            except Exception:
                thresholds = DEFAULT_THRESHOLDS
            deep_itm_threshold = thresholds.get("alpha_max_itm_pct", 25.0)
            min_vol_oi_ratio = thresholds.get("alpha_min_vol_oi_ratio", 1.0)
            exclude_blocks = thresholds.get("alpha_exclude_block_type", True)

            # Gate 1 — Deep-ITM filter (added 6/29 audit):
            # Deep in-the-money calls/puts are delta-exposure plays
            # (essentially synthetic stock with leverage), not directional
            # conviction. A $1M+ ask-side fire on a 60% ITM call is
            # mechanical positioning -- the trader is buying stock
            # exposure, not making a conviction directional bet.
            is_deep_itm = (money_pct is not None and money_pct > deep_itm_threshold)

            # Gate 2 — Volume-exceeds-OI gate (added 6/30 morning):
            # Alpha Gold requires fresh institutional positioning -- new
            # exposure being created, not adjustments to existing positions.
            # Volume strictly greater than OI means today's flow is larger
            # than the entire prior accumulated position. That's new
            # conviction, not noise.
            #
            # Two pass conditions (added 6/30 evening, for fresh strikes):
            #   1. Normal: oi > 0 AND v_oi > min_vol_oi_ratio
            #   2. Fresh strike: Schwab confirmed OI=0 AND volume above
            #      fresh_strike_min_volume floor.
            #
            # Schwab MISSES (oi unknown / fetch failed) still fail this
            # gate -- we don't have the data to evaluate freshness.
            vol_exceeds_oi = (
                (oi > 0 and v_oi > min_vol_oi_ratio)
                or is_fresh_strike
            )

            # Gate 3 — Block-type exclusion (added 6/30 morning):
            # BLOCK trades are pre-negotiated single transactions. High
            # V/OI on a block can be artifact of a multi-leg structure
            # (delta-neutral spread, stock-hedge pair) where the apparent
            # directional signal is offset by the other leg. Until
            # next-day settled OI confirms real exposure, blocks don't
            # earn Alpha Gold conviction. SWEEPs are still allowed --
            # they're inherently aggressive liquidity-takers and the
            # V/OI signal is cleaner for them.
            type_up_g = (type_ or "").upper().strip().strip("/")
            is_block = ("BLOCK" in type_up_g) or type_up_g in ("BLK", "BL", "BT")
            block_disqualifies = exclude_blocks and is_block

            if not is_deep_itm and vol_exceeds_oi and not block_disqualifies:
                return (f"UCT Alpha Gold {direction}", "alpha", TIER_PRIORITY["alpha"])
            # Any gate failed → fall through to Size / Unusual / Bullish-Bearish
        # LEAPS
        # V/OI gate (added 6/30 evening): LEAPS now requires fresh
        # positioning OR fresh-strike with volume. Long-dated contracts
        # that fail the gate (e.g. low V/OI on stale OI) get dropped
        # from curated entirely. Trade still exists in raw feed.
        if is_leaps:
            try:
                leaps_min_voi = _load_thresholds().get(
                    "leaps_min_vol_oi_ratio", 1.0)
            except Exception:
                leaps_min_voi = 1.0
            leaps_vol_exceeds_oi = (
                (oi > 0 and v_oi > leaps_min_voi)
                or is_fresh_strike
            )
            if leaps_vol_exceeds_oi:
                return (f"UCT {direction} LEAPS", "leaps", TIER_PRIORITY["leaps"])
            # V/OI gate failed → drop from curated
            return None
        # Unusual — dormant ticker (per past N trading days) waking up with
        # high V/OI flow. When precompute data unavailable, falls back to
        # legacy V/OI-only rule. See _is_unusual_classification() for full
        # explanation.
        if _is_unusual_classification(row["Symbol"], v_oi, premium):
            return ("UCT Unusual Name", "unusual", TIER_PRIORITY["unusual"])
        # Size — big premium magenta
        # Size tier V/OI gate (added 6/30 evening): like Alpha Gold,
        # Size now requires fresh institutional positioning. Two pass
        # conditions:
        #   1. Normal: oi > 0 AND v_oi > size_min_vol_oi_ratio
        #   2. Fresh strike: Schwab confirmed OI=0 AND volume above
        #      fresh_strike_min_volume floor (added 6/30 evening).
        # Schwab misses (oi unknown) fall through to bullish/bearish.
        if premium >= 500_000:
            try:
                size_min_voi = _load_thresholds().get("size_min_vol_oi_ratio", 1.0)
            except Exception:
                size_min_voi = 1.0
            size_vol_exceeds_oi = (
                (oi > 0 and v_oi > size_min_voi)
                or is_fresh_strike
            )
            if size_vol_exceeds_oi:
                return (f"UCT Size {direction}s", "size", TIER_PRIORITY["size"])
            # V/OI gate failed → fall through to bullish/bearish
        # Regular bullish/bearish magenta
        # V/OI gate (added 6/30 evening): catchall tier now requires
        # vol > OI before classifying as Bullish/Bearish. Without it,
        # noisy stale-OI directional reads (V/OI 0.01-0.20) clutter
        # the curated feed. Today's audit (6/30) confirmed this pattern
        # produced 36% direction-disagreement vs BBS/Bullflow on the
        # Bearish tier.
        try:
            bull_bear_min_voi = _load_thresholds().get(
                "bullish_bearish_min_vol_oi_ratio", 1.0)
        except Exception:
            bull_bear_min_voi = 1.0
        bull_bear_vol_exceeds_oi = (
            (oi > 0 and v_oi > bull_bear_min_voi)
            or is_fresh_strike
        )
        if bull_bear_vol_exceeds_oi:
            return (f"UCT {direction}ish", dir_tier, TIER_PRIORITY[dir_tier])
        # V/OI gate failed → drop from curated entirely
        return None

    if color == "YELLOW":
        if is_leaps:
            return (f"UCT {direction} LEAPS", "leaps", TIER_PRIORITY["leaps"])
        # YELLOW = cumulative accumulation
        return (f"UCT {direction}ish Accumulation", dir_tier, TIER_PRIORITY[dir_tier])

    # WHITE rows that reached here didn't qualify for premium-override
    # promotion (premium too low, or wrong type). Skip — caller filters None.
    return None


def _moneyness(strike: float, spot: float, cp: str):
    """Returns (pct, label) where pct is signed (negative for OTM puts,
    positive for OTM calls). Label is ITM/ATM/OTM."""
    if not spot or not strike:
        return (None, None)
    pct = (spot - strike) / strike * 100.0
    if cp == "PUT":
        pct = -pct  # PUTs: ITM when spot < strike, so flip
    if abs(pct) < 1.0:
        return (round(pct, 1), "ATM")
    if pct > 0:
        return (round(pct, 1), "ITM")
    return (round(pct, 1), "OTM")


def _compute_conviction(premium: int, oi: int, volume: int,
                        tier_priority: int, moneyness_label: str | None,
                        moneyness_pct: float | None, is_leaps: bool) -> tuple[float, str]:
    """
    Ported from liveflow_worker._compute_conviction. Simplified because we
    don't have multi-fire aggregate state in real-time (single rows only).

    Score components (0-10 cap):
      Premium tier:    0-3
      OI break ratio:  0-2
      Tier priority:   0-3 (Alpha highest, Algo lowest)
      Moneyness:       0-1
      LEAPS bonus:     0-0.5
    """
    score = 0.0

    # Premium tier (0-3)
    if premium >= 5_000_000:   score += 3.0
    elif premium >= 2_000_000: score += 2.5
    elif premium >= 1_000_000: score += 2.0
    elif premium >= 500_000:   score += 1.5
    elif premium >= 250_000:   score += 1.0
    else:                      score += 0.5

    # OI break (0-2)
    if oi > 0 and volume > oi:
        ratio = volume / oi
        if ratio >= 5.0:   score += 2.0
        elif ratio >= 2.0: score += 1.5
        else:              score += 1.0

    # Tier priority (0-3)
    if tier_priority == 1:   score += 3.0   # Alpha Gold
    elif tier_priority == 2: score += 2.0   # Size
    elif tier_priority == 3: score += 1.25  # Bullish/Bearish
    elif tier_priority == 4: score += 1.0   # LEAPS
    elif tier_priority == 5: score += 0.5   # Unusual
    else:                    score += 0.25  # Algo

    # Moneyness (0-1)
    if moneyness_label == "ITM":
        if moneyness_pct is not None and 5 <= moneyness_pct <= 30:
            score += 1.0
        else:
            score += 0.75
    elif moneyness_label == "ATM":
        score += 0.75
    elif moneyness_label == "OTM" and moneyness_pct is not None:
        ap = abs(moneyness_pct)
        if ap <= 5: score += 0.6
        elif ap <= 15: score += 0.3

    # LEAPS bonus
    if is_leaps:
        score += 0.5

    score = min(score, 10.0)
    if score >= 8.5: grade = "A+ 🚀"
    elif score >= 7.0: grade = "A"
    elif score >= 5.5: grade = "B"
    elif score >= 3.5: grade = "C"
    else: grade = "D"

    return (round(score, 1), grade)


def _row_to_alert(row: dict) -> dict | None:
    """Translate a FlowDB row to the alert shape LiveFlow.jsx expects.
    Returns None if the row should be skipped (e.g., unclassified side)."""
    cp_full = row["CallPut"]
    cp_short = "C" if cp_full == "CALL" else ("P" if cp_full == "PUT" else "")
    side = row["Side"] or ""

    direction = _derive_direction(cp_full, side, row.get("Type", ""))
    if direction is None:
        # Unclassified side → can't determine bull/bear → skip
        return None

    strike = _parse_strike(row["Strike"])
    spot = _parse_float(row["Spot"])
    premium = _parse_int(row["Premium"])
    volume = _parse_int(row["Volume"])
    oi = _parse_int(row["OI"])
    dte = _parse_int(row["Dte"])
    price = _parse_float(row["Price"])

    money_pct, money_label = _moneyness(strike, spot, cp_full)

    # ─── Noise filter 1: Deep-money classification (matches OptionsFlow.jsx) ─
    # Ports the exact isDeep + BLK-filter logic that OptionsFlow uses to
    # kill CSCO $80c-style noise (spot $112, 28.8% ITM BLOCKs at $32.5 =
    # arb/rebalancing spread legs, not directional).
    #
    # isDeep threshold varies by type:
    #   - BLOCK: 10% from spot (more aggressive; blocks at moderate ITM
    #     depth are usually spread legs)
    #   - SWEEP: 20% from spot (kept as "urgency" unless very deep)
    #
    # Filter rules:
    #   1. Deep ITM BLOCK → FILTER (arb/rebalancing)
    #   2. Very deep ITM SWEEP (intrinsic > 50% spot) → FILTER (synthetic roll,
    #      matches AXTI $130p at spot $55 case)
    #   3. Deep ITM SWEEP at 20-50% ITM → KEEP (urgency signal)
    #
    # Only applies when spot > 0. Missing spot skips this check.
    type_str = (row.get("Type") or "").upper().strip()
    is_block = type_str == "BLOCK" or "BLK" in type_str
    is_sweep = type_str == "SWEEP" or "SWP" in type_str or "SWEEP" in type_str
    if spot > 0 and strike > 0:
        pct_from_spot = abs(strike - spot) / spot * 100.0
        is_deep_by_type = pct_from_spot >= (10.0 if is_block else 20.0)
        is_itm = (cp_full == "CALL" and strike < spot) or (cp_full == "PUT" and strike > spot)
        if is_deep_by_type and is_itm:
            # Rule 1: Deep ITM BLOCK → always filter (arb/rebalancing/spread leg)
            if is_block:
                return None
            # Rule 2: Very deep ITM SWEEP (intrinsic > 50% spot) → filter
            if cp_full == "CALL":
                intrinsic = spot - strike
            elif cp_full == "PUT":
                intrinsic = strike - spot
            else:
                intrinsic = 0
            if intrinsic > spot * 0.5:
                return None  # synthetic roll

    # ─── Noise filter 2: Deep-OTM lottery ticket ─────────────────────────────
    # Trades that are >40% OTM AND have DTE < 365 are lottery tickets.
    # Legitimate deep-OTM LEAPS (DTE≥365) are institutional tail hedges
    # and should stay. Short-dated deep-OTM is retail gambling — high
    # noise, low signal. Matches OptionsFlow's deep-OTM guard.
    if spot > 0 and dte < 365:
        if cp_full == "CALL" and strike > spot * 1.4:
            return None  # >40% OTM call, short-dated → lottery
        if cp_full == "PUT" and strike < spot * 0.6:
            return None  # >40% OTM put, short-dated → lottery

    # ─── Noise filter 3: BBS-format ML/ skip ─────────────────────────────────
    # Distinguish real multi-leg spreads from Massive's aggregation label:
    #   - BBS ML/ (real spread legs): comes with populated OI (BBS enriches
    #     upstream). Each leg emitted with side classification. These ARE
    #     legit spread activity — not directional, should be skipped from
    #     directional tiers.
    #   - Massive ML/ (aggregation catch-all): ingests with OI=0. Often
    #     misclassified multi-exchange sweeps that should be rescued.
    #
    # If Type='ML/' AND OI>0, it's a BBS-format spread leg. Skip from
    # directional tier assignment (would still land in algo tier via
    # tier detection, which is always excluded from curated).
    if type_str == "ML/" and oi > 0:
        return None  # BBS-format spread leg, not a directional signal

    result = _derive_alert_name(row, direction, money_pct=money_pct)
    if result is None:
        return None  # WHITE row that didn't qualify for premium override
    alert_name, tier_key, tier_priority = result
    is_leaps = dte >= 180

    score, grade = _compute_conviction(
        premium=premium, oi=oi, volume=volume,
        tier_priority=tier_priority, moneyness_label=money_label,
        moneyness_pct=money_pct, is_leaps=is_leaps,
    )

    ts = _ts_from_row(row["CreatedDate"], row["CreatedTime"])

    # Build OCC-style symbol for parity with Bullflow display path
    try:
        exp_m, exp_d, exp_y = row["ExpirationDate"].split("/")
        occ = f"O:{row['Symbol']}{int(exp_y)%100:02d}{int(exp_m):02d}{int(exp_d):02d}{cp_short}{int(strike*1000):08d}"
    except (ValueError, AttributeError):
        occ = row["Symbol"]

    return {
        "id": row["id"],
        "alertType": "massive",
        "alertName": alert_name,
        "_tierKey": tier_key,            # debug / diagnostic
        "_tierPriority": tier_priority,
        "symbol": occ,
        "ticker": row["Symbol"],
        "cp": cp_short,
        "strike": strike,
        "exp": row["ExpirationDate"],
        "dte": dte,
        "alertPremium": float(premium),
        "averageFillPrice": price,
        "tradeSize": volume,
        "timestamp": ts,
        "receivedAt": ts,                # same as timestamp (no Bullflow-style ingest delay)
        "latency": 0.0,
        "deliveryLatency": 0.0,
        "ingestedAt": datetime.fromtimestamp(ts, tz=timezone.utc).isoformat() if ts > 0 else None,
        "priorOI": oi if oi > 0 else None,
        "volumeOIRatio": round(volume / oi, 2) if oi > 0 else None,
        "oiExceeded": (oi > 0 and volume > oi),
        "spot": spot if spot > 0 else None,
        "moneynessPct": money_pct,
        "moneynessLabel": money_label,
        "grade": grade,
        "convictionScore": score,
        "gatePassed": True,              # gating not implemented in test phase
        "forwardedToDiscord": False,     # not wired in test phase
        # Massive-specific extras (useful for debugging / future UI)
        "_color": row["Color"],
        "_side": side,
        "_type": row["Type"],
        "_sector": row["Sector"],
        "_mktCap": _parse_int(row["MktCap"]),
        "_weekly": row["Weekly"],
        "_er": row["ER"],
        "_uoa": row["Uoa"],
        "_direction": direction,
    }


def _today_mdyyyy() -> str:
    """Today as 'M/D/YYYY' (matches FlowDB CreatedDate format)."""
    d = datetime.now(ET).date()
    return f"{d.month}/{d.day}/{d.year}"


def _get_worker_status() -> dict:
    """Worker liveness derived from FlowDB write recency.

    IMPORTANT: the web service and the Massive WS worker run in SEPARATE
    Railway services and don't share memory. Importing
    `from api.massive_ws_worker import get_status` works (same code) but
    returns the WEB service's copy of `_state`, which is never updated by
    the actual worker process. So `connected` would be permanently False
    even when the worker is healthy.

    Instead: query FlowDB for the most-recent stocks row. The worker writes
    rows continuously during market hours; if the latest row's timestamp
    is within `_STALE_THRESHOLD_SEC`, the worker is alive. Otherwise idle.
    Database is the shared substrate between the two services, so this
    avoids the cross-process state visibility problem entirely.
    """
    try:
        conn = sqlite3.connect(DB_PATH, timeout=5)
        try:
            cur = conn.execute("""
                SELECT id, CreatedDate, CreatedTime
                  FROM flow
                 WHERE source = 'stocks'
                 ORDER BY id DESC LIMIT 1
            """)
            row = cur.fetchone()
        finally:
            conn.close()
        if not row:
            return {
                "connected": False, "source": "massive",
                "last_event_at": None, "last_event_age_sec": None,
                "max_id": None,
                "note": "No rows in FlowDB yet — worker has not written any data.",
            }
        max_id, created_date, created_time = row
        latest_ts = _ts_from_row(created_date, created_time)
        if not latest_ts:
            return {
                "connected": False, "source": "massive",
                "last_event_at": None, "last_event_age_sec": None,
                "max_id": max_id,
                "note": "Latest FlowDB row has unparseable timestamp.",
            }
        now = time.time()
        age = now - latest_ts
        connected = age < _STALE_THRESHOLD_SEC
        return {
            "connected": connected,
            "source": "massive",
            "last_event_at": datetime.fromtimestamp(latest_ts, tz=timezone.utc).isoformat(),
            "last_event_age_sec": round(age, 1),
            "max_id": max_id,
            "stale_threshold_sec": _STALE_THRESHOLD_SEC,
        }
    except Exception as e:
        return {
            "connected": False, "source": "massive",
            "last_event_at": None, "last_event_age_sec": None,
            "last_error": f"FlowDB status query failed: {e}",
        }


# How recent the most-recent FlowDB row must be for the worker to be
# considered "live". Massive sends thousands of events per minute during
# market hours, so a 2-minute gap is a strong signal something is wrong.
# Outside market hours legitimate gaps occur; the indicator will show
# IDLE which is accurate.
_STALE_THRESHOLD_SEC = 120


# --- Backward-compatible shims for pre-consolidation frontend --------------
# Added 2026-07-05 during pre-market debug of 404s on /status and /curated.
#
# Before the /recent consolidation these two paths were independent endpoints.
# The refactor absorbed /status into /recent's response envelope ({status,
# alerts}) and turned /curated into a `?curated=true` query param on /recent.
# Cleaner server-side, but the frontend was never migrated -- OptionsFlow.jsx,
# OptionsFlow_admin.jsx, and LiveFlowMassive.jsx still call the old paths,
# which now fall through to the SPA catch-all and return the React 404 page.
#
# These shims restore the pre-consolidation contract without changing the
# frontend. Both delegate to the same underlying logic /recent uses, so there
# is no risk of divergence and no double-maintenance -- when the frontend is
# eventually updated to read status from /recent's envelope and pass
# ?curated=true directly, these can be deleted with no other change.
@router.get("/status")
def status_shim():
    """
    Backward-compat: worker status dict, matches pre-consolidation contract.
    New frontend code should read `status` from GET /recent's response instead.
    """
    return _get_worker_status()


@router.get("/curated")
def curated_shim(
    limit: int = Query(default=200, ge=1, le=20000),
    min_grade: str = Query(default="D", description="Min letter grade A+/A/B/C/D"),
    target_date: str = Query(default=None, description="M/D/YYYY override (default=today)"),
    sort_by: str = Query(default="recent", description="recent|conviction|premium"),
    tier: str = Query(default=None, description="Filter to one tier"),
):
    """
    Backward-compat: equivalent to GET /recent?curated=true.
    New frontend code should call GET /recent?curated=true directly.
    """
    return recent_massive_alerts(
        limit=limit,
        min_grade=min_grade,
        target_date=target_date,
        sort_by=sort_by,
        tier=tier,
        curated=True,
    )


@router.get("/recent")
def recent_massive_alerts(
    limit: int = Query(default=200, ge=1, le=20000),
    min_grade: str = Query(default="D", description="Min letter grade A+/A/B/C/D"),
    target_date: str = Query(default=None, description="M/D/YYYY override (default=today)"),
    sort_by: str = Query(default="recent", description="recent|conviction|premium"),
    tier: str = Query(default=None, description="Filter to one tier (alpha|size|bullish|bearish|leaps|unusual|algo). When set, common-tier alerts can't crowd out rare-tier ones — useful for 'show me all the day's Alpha Golds' even hours after they fired."),
    curated: bool = Query(default=False, description="Apply Curated-mode stacking filter: tiers like Size/Alpha need ≥N stacked signals (premium/V-OI/hits/grade), Unusual needs its own dedicated criteria, Algo always excluded. Thresholds are tunable via /thresholds endpoint."),
):
    """
    Return recent MAGENTA + YELLOW rows from FlowDB as alert objects shaped
    to match the existing /api/live/alerts/recent response (so LiveFlow.jsx
    can consume it with just a URL swap).

    Query params:
      limit:       max rows to return (1-1000, default 200)
      min_grade:   filter out rows below this letter grade (A+/A/B/C/D)
      target_date: override date for testing (default = today in ET)
      sort_by:     'recent' (default, id DESC) | 'conviction' | 'premium'
      tier:        if set, only return alerts of this tier. Lets the page
                   show full-day history of rare tiers (Alpha Gold, Size)
                   without being pushed out by common tiers like Algo.
    """
    today = target_date or _today_mdyyyy()

    grade_threshold = {"A+ 🚀": 4, "A": 3, "B": 2, "C": 1, "D": 0,
                       "A+": 4}  # accept both with and without rocket
    min_threshold = grade_threshold.get(min_grade, 0)

    conn = sqlite3.connect(DB_PATH, timeout=10)
    try:
        conn.row_factory = sqlite3.Row
        # When sorting by something other than recency we need to consider
        # ALL the day's rows. id DESC is fine for limit*3 cushion for recent;
        # for conviction/premium we pull more upfront. When a tier filter is
        # active we also pull 20000 since the tier might be rare — limit*3
        # won't have enough of that tier to satisfy `limit` post-filter.
        if sort_by != "recent" or tier:
            sql_limit = 20000
        else:
            sql_limit = max(limit * 3, limit + 1000)  # safety margin for grade filter
        # Pull MAGENTA + YELLOW always. Also pull WHITE rows above the premium
        # override threshold so they get a chance at promotion in
        # _derive_alert_name. SQL filter avoids loading every WHITE row (huge
        # volume); we use a conservative absolute floor of $500K which is
        # below any reasonable premium_override.min_premium setting.
        override_cfg = _load_thresholds().get("premium_override", {})
        override_sql_floor = 500_000  # absolute SQL floor; refined in Python
        cur = conn.execute("""
            SELECT id, source, CreatedDate, CreatedTime, Symbol, Type, Volume,
                   Price, Side, CallPut, Strike, Spot, Premium, ExpirationDate,
                   Color, Dte, ER, StockEtf, Sector, Uoa, Weekly, MktCap, OI
              FROM flow
             WHERE source = 'stocks'
               AND CreatedDate = ?
               AND (Color IN ('MAGENTA', 'YELLOW')
                    OR (Color = 'WHITE' AND CAST(Premium AS INTEGER) >= ?))
             ORDER BY id DESC
             LIMIT ?
        """, (today, override_sql_floor, sql_limit))
        rows = cur.fetchall()
    finally:
        conn.close()

    # Translate all rows first (drop unclassified + low-grade + off-tier),
    # then sort + trim. Tier filter applied here (not in SQL) because the
    # tier is derived in _row_to_alert based on premium/side/dte/color logic
    # that's easier in Python than translating into SQL conditions.
    all_alerts = []
    skipped_unclassified = 0
    skipped_low_grade = 0
    skipped_off_tier = 0
    for r in rows:
        a = _row_to_alert(dict(r))
        if a is None:
            skipped_unclassified += 1
            continue
        if grade_threshold.get(a["grade"], 0) < min_threshold:
            skipped_low_grade += 1
            continue
        if tier and a.get("_tierKey") != tier:
            skipped_off_tier += 1
            continue
        all_alerts.append(a)

    if sort_by == "conviction":
        all_alerts.sort(key=lambda a: a["convictionScore"], reverse=True)
    elif sort_by == "premium":
        all_alerts.sort(key=lambda a: a["alertPremium"], reverse=True)
    # "recent" already in id DESC order from SQL

    # ─── Hit count per contract ─────────────────────────────────────────────
    # Count how many times each contract (ticker|cp|strike|exp) fires across
    # the day's classified alerts. Used both for the ×N hit badge in the UI
    # and for the Curated-mode stacking criterion. Computed over the WHOLE
    # classified set (post-grade-filter, pre-limit) so the hit count reflects
    # the true day's activity, not just what made the visible window.
    hit_counts = {}
    for a in all_alerts:
        k = f"{a.get('ticker')}|{a.get('cp')}|{a.get('strike')}|{a.get('exp')}"
        hit_counts[k] = hit_counts.get(k, 0) + 1
    for a in all_alerts:
        k = f"{a.get('ticker')}|{a.get('cp')}|{a.get('strike')}|{a.get('exp')}"
        a["_hitCount"] = hit_counts.get(k, 1)

    # ─── Curated filter ─────────────────────────────────────────────────────
    # When ?curated=true, apply the stacking + Unusual logic. Algo always
    # excluded. Filter happens AFTER hit-count computation so hits is one
    # of the stacking signals.
    skipped_curated = 0
    if curated:
        thresholds = _load_thresholds()
        kept = []
        for a in all_alerts:
            if _qualifies_curated(a, thresholds):
                kept.append(a)
            else:
                skipped_curated += 1
        all_alerts = kept

    alerts = all_alerts[:limit]

    status = _get_worker_status()
    status["query_date"] = today
    status["sort_by"] = sort_by
    status["tier_filter"] = tier
    status["curated"] = curated
    status["rows_scanned"] = len(rows)
    status["skipped_unclassified_side"] = skipped_unclassified
    status["skipped_below_min_grade"] = skipped_low_grade
    status["skipped_off_tier"] = skipped_off_tier
    status["skipped_curated"] = skipped_curated
    status["returned"] = len(alerts)

    return {
        "status": status,
        "alerts": alerts,
    }


@router.get("/diagnostic")
def diagnostic(target_date: str = Query(default=None)):
    """Per-tier counts for the target date — useful for tuning thresholds."""
    today = target_date or _today_mdyyyy()
    conn = sqlite3.connect(DB_PATH, timeout=10)
    try:
        conn.row_factory = sqlite3.Row
        cur = conn.execute("""
            SELECT * FROM flow
             WHERE source = 'stocks' AND CreatedDate = ?
               AND Color IN ('MAGENTA', 'YELLOW')
        """, (today,))
        rows = [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()

    tier_counts = {}
    grade_counts = {}
    color_counts = {}
    skipped_unclassified = 0
    for r in rows:
        cp = r["CallPut"]
        side = r["Side"] or ""
        d = _derive_direction(cp, side, r.get("Type", ""))
        if d is None:
            skipped_unclassified += 1
            continue
        a = _row_to_alert(r)
        if a is None:
            continue
        tier_counts[a["_tierKey"]] = tier_counts.get(a["_tierKey"], 0) + 1
        grade_counts[a["grade"]] = grade_counts.get(a["grade"], 0) + 1
        color_counts[r["Color"]] = color_counts.get(r["Color"], 0) + 1

    return {
        "query_date": today,
        "total_rows_yellow_magenta": len(rows),
        "skipped_unclassified_side": skipped_unclassified,
        "after_classification": len(rows) - skipped_unclassified,
        "by_tier": tier_counts,
        "by_grade": grade_counts,
        "by_color": color_counts,
    }


# ─── Current quotes endpoint (for P/L column) ─────────────────────────────
# Frontend polls this every 30s with the unique tickers visible on the page.
# Server uses the same Schwab quote service liveflow_worker uses, with a
# 2-min TTL cache (so two pages polling the same tickers don't double-hit
# Schwab). Returns a dict of ticker → current spot price.

from pydantic import BaseModel

# Reuse liveflow_worker's spot cache — same TTL, same source of truth.
# Avoids duplicate Schwab calls from /live-flow + /live-massive both polling.
_SPOT_CACHE_TTL = 120  # 2 min; matches liveflow_worker
_quote_cache: dict = {}  # ticker → (price, cached_at_unix)


class CurrentQuotesPayload(BaseModel):
    tickers: list[str] = []


async def _fetch_one_quote(ticker: str) -> float | None:
    """Single ticker quote with 2-min cache. Lazy import of schwab_service
    so we don't pull it on cold start when this endpoint isn't used."""
    if not ticker or ticker.startswith("$") or "." in ticker:
        return None
    now = time.time()
    cached = _quote_cache.get(ticker)
    if cached and (now - cached[1]) < _SPOT_CACHE_TTL:
        return cached[0]
    try:
        from api import schwab_service
        price = await schwab_service.get_equity_quote(ticker)
        if price:
            _quote_cache[ticker] = (float(price), now)
            return float(price)
    except Exception:
        # Quote unavailable for this ticker — likely index/unusual symbol or
        # rate-limited. Returning None lets the frontend show "—" in P/L.
        pass
    return None


@router.post("/current-quotes")
async def current_quotes(payload: CurrentQuotesPayload):
    """
    Batch fetch current spot prices for a list of tickers. Used by the
    frontend to compute P/L from alert spot → current spot. Polls less
    frequently than /recent (spot moves slower than alert flow).

    Body: {"tickers": ["MSFT", "MU", "NVDA", ...]}
    Returns: {"quotes": {"MSFT": 388.50, "MU": 105.20, "NVDA": null}, "fetched_at": <unix>}
    """
    import asyncio
    tickers = list(dict.fromkeys(payload.tickers or []))  # dedup, preserve order
    if not tickers:
        return {"quotes": {}, "fetched_at": time.time()}

    # Cap to avoid abuse / huge bursts. 200 tickers per call is plenty
    # (the live page maxes at 200 alerts which is typically <100 uniques).
    tickers = tickers[:200]

    # Fire all lookups concurrently. Schwab service handles its own rate
    # limiting; cache layer (above) dedupes same-ticker repeats within TTL.
    results = await asyncio.gather(
        *[_fetch_one_quote(t) for t in tickers], return_exceptions=False
    )
    quotes = {t: p for t, p in zip(tickers, results) if p is not None}
    return {"quotes": quotes, "fetched_at": time.time(), "requested": len(tickers)}


# ─── Day stats endpoint (for Market Read hero card) ────────────────────────
# Returns aggregated bull/bear stats for ALL classifiable Y/M rows on the
# target date, independent of any pagination/grade/tier filters. The frontend
# uses this for the hero card so the macro Market Read is stable regardless
# of the user's filter selections (a chip toggle shouldn't change what "the
# market looks like today" — only what THEY are looking at).

_day_stats_cache: dict = {}  # date_key → (computed_at_unix, payload)
_DAY_STATS_TTL = 30  # 30s — fast enough for live, slow enough to skip work


def _build_day_stats(today: str, exclude_algo: bool = False) -> dict:
    """Compute aggregate stats for all Y/M classifiable stocks rows on `today`.
    Heavy SQL + Python pass over potentially 5K-10K rows; cache the result
    via the wrapper endpoint so repeated polls within 30s don't re-process.

    When exclude_algo=True, alerts classified as Algo tier (multi-leg complex
    strategies) are skipped during aggregation. Multi-leg trades aren't truly
    directional even when one leg happens to print at ask, so excluding them
    gives a cleaner "directional conviction only" read.
    """
    conn = sqlite3.connect(DB_PATH, timeout=10)
    try:
        conn.row_factory = sqlite3.Row
        cur = conn.execute("""
            SELECT id, source, CreatedDate, CreatedTime, Symbol, Type, Volume,
                   Price, Side, CallPut, Strike, Spot, Premium, ExpirationDate,
                   Color, Dte, ER, StockEtf, Sector, Uoa, Weekly, MktCap, OI
              FROM flow
             WHERE source = 'stocks'
               AND CreatedDate = ?
               AND Color IN ('MAGENTA', 'YELLOW')
        """, (today,))
        rows = cur.fetchall()
    finally:
        conn.close()

    # Translate each row to an alert (includes direction + dte + ticker)
    classified = []
    for r in rows:
        a = _row_to_alert(dict(r))
        if a is not None:
            classified.append(a)

    # Aggregate everything in one pass
    bull_prem = 0
    bear_prem = 0
    bull_count = 0
    bear_count = 0
    by_ticker = {}              # ticker → {bull, bear}
    dte_buckets = {
        "0-7":   {"label": "0-7d",   "bull": 0, "bear": 0, "count": 0},
        "7-14":  {"label": "7-14d",  "bull": 0, "bear": 0, "count": 0},
        "14-60": {"label": "14-60d", "bull": 0, "bear": 0, "count": 0},
        "60+":   {"label": "60+d",   "bull": 0, "bear": 0, "count": 0},
    }

    # Last-hour window resolution differs by mode:
    #   • If target_date == today (ET): rolling 60 min ending NOW (real-time)
    #   • If target_date is historical: last hour of trading activity on that
    #     date (max(timestamp) - 3600). Otherwise historical pages always
    #     show "no alerts in last 60 minutes" which is useless.
    now_et = datetime.now(ET)
    try:
        m, d, y = today.split("/")
        target_date_obj = datetime(int(y), int(m), int(d)).date()
    except (ValueError, AttributeError):
        target_date_obj = None
    is_today = (target_date_obj == now_et.date()) if target_date_obj else False

    if is_today:
        one_hour_threshold = time.time() - 3600
    elif classified:
        max_ts = max((a["timestamp"] for a in classified if a.get("timestamp")), default=0)
        one_hour_threshold = max_ts - 3600 if max_ts > 0 else 0
    else:
        one_hour_threshold = 0

    bull_prem_1h = 0
    bear_prem_1h = 0
    count_1h = 0
    by_ticker_1h: dict = {}  # ticker → {bull, bear} restricted to last-hour window

    for a in classified:
        # Skip multi-leg/Algo alerts when caller requested directional-only.
        if exclude_algo and a.get("_tierKey") == "algo":
            continue
        prem = a["alertPremium"] or 0
        direction = a.get("_direction")
        is_bull = direction == "Bull"
        is_bear = direction == "Bear"
        if not (is_bull or is_bear):
            continue

        if is_bull:
            bull_prem += prem
            bull_count += 1
        else:
            bear_prem += prem
            bear_count += 1

        # Last hour
        ts = a.get("timestamp") or 0
        if one_hour_threshold > 0 and ts >= one_hour_threshold:
            count_1h += 1
            if is_bull:
                bull_prem_1h += prem
            else:
                bear_prem_1h += prem
            # Per-ticker rollup restricted to last-hour window
            t1h = a.get("ticker")
            if t1h:
                if t1h not in by_ticker_1h:
                    by_ticker_1h[t1h] = {"bull": 0, "bear": 0}
                if is_bull:
                    by_ticker_1h[t1h]["bull"] += prem
                else:
                    by_ticker_1h[t1h]["bear"] += prem

        # Per-ticker rollup
        t = a.get("ticker")
        if t:
            if t not in by_ticker:
                by_ticker[t] = {"bull": 0, "bear": 0}
            if is_bull:
                by_ticker[t]["bull"] += prem
            else:
                by_ticker[t]["bear"] += prem

        # DTE bucket
        dte = a.get("dte") if a.get("dte") is not None else 999
        if dte <= 7:
            bucket = "0-7"
        elif dte <= 14:
            bucket = "7-14"
        elif dte <= 60:
            bucket = "14-60"
        else:
            bucket = "60+"
        if is_bull:
            dte_buckets[bucket]["bull"] += prem
        else:
            dte_buckets[bucket]["bear"] += prem
        dte_buckets[bucket]["count"] += 1

    # Top tickers by direction (top 10 each; frontend uses 3 for inline
    # summary and up to 10 for click-to-expand drilldown)
    top_bull = sorted(
        [{"ticker": t, "premium": v["bull"]} for t, v in by_ticker.items() if v["bull"] > 0],
        key=lambda x: x["premium"], reverse=True,
    )[:10]
    top_bear = sorted(
        [{"ticker": t, "premium": v["bear"]} for t, v in by_ticker.items() if v["bear"] > 0],
        key=lambda x: x["premium"], reverse=True,
    )[:10]

    # Top tickers active in the last-hour window (combined premium, max 5).
    # Each entry carries bull/bear split so the frontend can color the amount
    # by which side dominated for that ticker in that hour.
    top_tickers_1h = []
    for t, v in by_ticker_1h.items():
        total = v["bull"] + v["bear"]
        if total <= 0:
            continue
        top_tickers_1h.append({
            "ticker": t,
            "total": total,
            "bull": v["bull"],
            "bear": v["bear"],
            "lean": "bull" if v["bull"] > v["bear"] else
                    "bear" if v["bear"] > v["bull"] else "flat",
        })
    top_tickers_1h.sort(key=lambda x: x["total"], reverse=True)
    top_tickers_1h = top_tickers_1h[:5]

    return {
        "query_date": today,
        "total_classified": len(classified),
        "bull_premium": bull_prem,
        "bear_premium": bear_prem,
        "bull_count": bull_count,
        "bear_count": bear_count,
        "by_dte": list(dte_buckets.values()),  # ordered list for stable frontend rendering
        "top_bull": top_bull,
        "top_bear": top_bear,
        "last_hour": {
            "bull_premium": bull_prem_1h,
            "bear_premium": bear_prem_1h,
            "count": count_1h,
            "is_today_target": is_today,
            "top_tickers": top_tickers_1h,
        },
    }


@router.get("/day-stats")
def day_stats(
    target_date: str = Query(default=None),
    exclude_algo: bool = Query(default=False, description="Exclude multi-leg/Algo tier from the bull/bear/DTE/top-tickers aggregation. Useful for a 'pure directional' read since multi-leg trades aren't truly directional even when one leg prints at ask."),
):
    """
    Aggregated bull/bear stats for ALL classifiable Y/M stocks rows on the
    target date. Independent of filters — gives the page's Market Read a
    stable macro view that doesn't shift when user toggles tier chips or
    min-grade selector.

    Cached for 30s server-side per date. Historical dates never change so
    cache hit rate is near-100% after first request.

    When exclude_algo=true, the Algo tier (multi-leg complex strategies) is
    skipped during aggregation. Single-leg directional alerts only.
    """
    today = target_date or _today_mdyyyy()
    now = time.time()
    cache_key = (today, bool(exclude_algo))
    cached = _day_stats_cache.get(cache_key)
    if cached and (now - cached[0]) < _DAY_STATS_TTL:
        return cached[1]
    payload = _build_day_stats(today, exclude_algo=exclude_algo)
    _day_stats_cache[cache_key] = (now, payload)
    return payload


# ─── Curated thresholds endpoints (admin tuning panel) ────────────────────
# Used by the in-page tuning panel (`?tune=1` on /live-massive). The frontend
# fetches current thresholds, lets admin adjust sliders + preview the impact
# against the latest /recent payload, then POSTs the final values back.

@router.get("/thresholds")
def get_thresholds():
    """Return the current Curated-mode thresholds. Defaults if file missing."""
    return {
        "thresholds": _load_thresholds(),
        "defaults": DEFAULT_THRESHOLDS,
        "path": _THRESHOLDS_PATH,
    }


@router.post("/thresholds")
async def save_thresholds(request: Request):
    """Admin: persist new Curated-mode thresholds. Validates shape lightly
    then atomic-swaps the JSON file. Invalidates server-side cache so the
    next /recent poll picks up the new values."""
    try:
        body = await request.json()
    except Exception as e:
        raise HTTPException(400, f"Invalid JSON: {e}")
    if not isinstance(body, dict):
        raise HTTPException(400, "Body must be a JSON object")
    # Basic shape validation — top-level keys we accept
    allowed_top = {
        "stack", "premium_by_cap", "unusual", "cap_bands", "premium_override",
        # Alpha Gold quality gates (added 6/29-6/30)
        "alpha_max_itm_pct",         # deep-ITM filter threshold (Alpha only)
        "alpha_min_vol_oi_ratio",    # vol > OI fresh-positioning gate
        "alpha_exclude_block_type",  # BLOCK trades excluded from Alpha Gold
        "max_itm_pct",               # global deep-ITM filter (drops entirely)
        "size_min_vol_oi_ratio",     # vol > OI gate for Size tier
        "derive_strict_bid_only_bb", # B alone is ambiguous, only BB counts as bid-side
        "fresh_strike_min_volume",   # min volume to promote OI=0 fresh strikes
        "bullish_bearish_min_vol_oi_ratio",  # V/OI gate for catchall tier
        "leaps_min_vol_oi_ratio",    # V/OI gate for LEAPS tier
    }
    bad_keys = set(body.keys()) - allowed_top
    if bad_keys:
        raise HTTPException(400, f"Unknown keys: {sorted(bad_keys)}")
    if not _save_thresholds(body):
        raise HTTPException(500, "Failed to save thresholds")
    return {"ok": True, "thresholds": _load_thresholds()}


@router.post("/thresholds/reset")
def reset_thresholds():
    """Admin: revert to compiled-in defaults (wipes the saved file)."""
    try:
        if os.path.exists(_THRESHOLDS_PATH):
            os.remove(_THRESHOLDS_PATH)
        global _thresholds_cache
        _thresholds_cache = None
        return {"ok": True, "thresholds": _load_thresholds()}
    except Exception as e:
        raise HTTPException(500, f"Failed to reset: {e}")


# ─── Dormant ticker admin endpoints ───────────────────────────────────────
# Used to manage the dormant-ticker precompute that powers the true Unusual
# classification. Trigger from browser address bar / fetch() in console —
# no terminal cron in user's workflow, so manual trigger is the norm. Aim
# for once-nightly cadence; data is stable through the trading day.

@router.get("/dormant-status")
def dormant_status():
    """Show metadata about the current dormant-ticker dataset."""
    _load_dormant_tickers()
    if _dormant_cache is None or not _dormant_active_set:
        return {
            "ok": False,
            "has_data": False,
            "message": (
                "No dormant data computed yet. Unusual classification is using "
                "legacy V/OI-only fallback. Run POST /recompute-dormant to build it."
            ),
            "path": _DORMANT_PATH,
        }
    return {
        "ok": True,
        "has_data": True,
        "computed_at": _dormant_cache.get("computed_at"),
        "lookback_trading_days": _dormant_cache.get("lookback_trading_days"),
        "earliest_date": _dormant_cache.get("earliest_date"),
        "today_date": _dormant_cache.get("today_date"),
        "active_count": _dormant_cache.get("active_count"),
        "total_alerts_scanned": _dormant_cache.get("total_alerts_scanned"),
        "sample_active": _dormant_cache.get("active_tickers", [])[:30],
        "path": _DORMANT_PATH,
    }


@router.post("/recompute-dormant")
def recompute_dormant(
    lookback: int = Query(default=30, ge=1, le=365, description="Trading days to look back"),
):
    """Admin: scan FlowDB and recompute the active-tickers set. Writes the
    result to /data/dormant_tickers.json (atomic swap) and invalidates the
    in-memory cache so the next classification picks up new values.

    Heavy operation — does a full DB scan over the lookback window. Expected
    runtime: 1-5 seconds depending on FlowDB size. Safe to call during
    market hours but ideally run nightly after close.
    """
    try:
        data = _compute_active_tickers(lookback_days=lookback)
    except Exception as e:
        raise HTTPException(500, f"Compute failed: {e}")

    try:
        os.makedirs(os.path.dirname(_DORMANT_PATH), exist_ok=True)
        tmp = _DORMANT_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump(data, f)
        os.replace(tmp, _DORMANT_PATH)  # atomic swap
    except Exception as e:
        raise HTTPException(500, f"Failed to write dormant file: {e}")

    # Invalidate cache so next read picks up new file
    global _dormant_cache, _dormant_active_set, _dormant_loaded_mtime
    _dormant_cache = None
    _dormant_active_set = None
    _dormant_loaded_mtime = 0

    # Force reload to populate cache with new data
    _load_dormant_tickers()

    return {
        "ok": True,
        "computed_at": data["computed_at"],
        "lookback_trading_days": data["lookback_trading_days"],
        "earliest_date": data["earliest_date"],
        "today_date": data["today_date"],
        "active_count": data["active_count"],
        "total_alerts_scanned": data["total_alerts_scanned"],
        "sample_active": data["active_tickers"][:30],
    }



@router.get("/contract-debug")
def contract_debug(
    ticker: str = Query(..., description="Underlying symbol, e.g. 'SNDK'"),
    cp: str = Query(..., description="'C' or 'P' (case-insensitive)"),
    strike: str = Query(..., description="Strike price (any reasonable format)"),
    exp: str = Query(..., description="Expiration date M/D/YYYY"),
    target_date: str = Query(default=None, description="Trading date M/D/YYYY (default today)"),
):
    """Diagnostic: return ALL FlowDB rows for a specific contract on a given
    day, regardless of Color. Hardened to never 500 — wraps each row's
    classification in try/except and reports diagnostics for any failure.

    Use case: "why didn't I see X on /live-massive?" Returns enough raw
    detail to answer that without needing to query the DB directly.
    """
    debug = {"stage": "init", "errors": []}
    try:
        today = target_date or _today_mdyyyy()
        debug["query_date"] = today

        # Normalize cp
        cp_norm = (cp or "").strip().upper()
        if cp_norm in ("C", "CALL"):
            cp_long = "CALL"
        elif cp_norm in ("P", "PUT"):
            cp_long = "PUT"
        else:
            return {"error": f"cp must be C/CALL/P/PUT, got {cp!r}", "debug": debug}

        # Build many strike candidates — DB stores Strike as TEXT in various
        # formats depending on source ("$2050", "2050.0", "2050", etc.)
        strike_str = str(strike).strip().lstrip("$").strip()
        try:
            strike_float = float(strike_str)
        except ValueError:
            return {"error": f"strike not parseable: {strike!r}", "debug": debug}
        is_whole = strike_float.is_integer()
        strike_int = int(strike_float) if is_whole else None

        candidates = set()
        candidates.add(strike_str)
        candidates.add(f"${strike_str}")
        candidates.add(str(strike_float))
        candidates.add(f"${strike_float}")
        if strike_int is not None:
            candidates.add(str(strike_int))
            candidates.add(f"${strike_int}")
            candidates.add(f"{strike_int}.0")
            candidates.add(f"${strike_int}.0")
        candidates = list(candidates)
        debug["strike_candidates"] = candidates

        debug["stage"] = "sql_query"
        conn = sqlite3.connect(DB_PATH, timeout=10)
        try:
            conn.row_factory = sqlite3.Row
            placeholders = ",".join("?" for _ in candidates)
            cur = conn.execute(f"""
                SELECT id, source, CreatedDate, CreatedTime, Symbol, Type, Volume, Price,
                       Side, CallPut, Strike, Spot, Premium, ExpirationDate, Color,
                       Dte, ER, StockEtf, Sector, Uoa, Weekly, MktCap, OI
                  FROM flow
                 WHERE source = 'stocks'
                   AND CreatedDate = ?
                   AND Symbol = ?
                   AND CallPut = ?
                   AND Strike IN ({placeholders})
                   AND ExpirationDate = ?
                 ORDER BY id ASC
            """, [today, ticker.upper(), cp_long, *candidates, exp])
            rows = [dict(r) for r in cur.fetchall()]
        finally:
            conn.close()
        debug["row_count_strict"] = len(rows)

        # If strict match returns nothing, do a forgiving second query: same
        # symbol + cp + date, no strike/exp filter. Helps diagnose strike-
        # format mismatches and shows what IS in the DB for that ticker.
        loose_rows = []
        if not rows:
            debug["stage"] = "sql_loose_query"
            conn = sqlite3.connect(DB_PATH, timeout=10)
            try:
                conn.row_factory = sqlite3.Row
                cur = conn.execute("""
                    SELECT id, CreatedTime, Symbol, CallPut, Strike, ExpirationDate,
                           Color, Side, Volume, Premium, OI
                      FROM flow
                     WHERE source = 'stocks'
                       AND CreatedDate = ?
                       AND Symbol = ?
                       AND CallPut = ?
                     ORDER BY id ASC
                     LIMIT 50
                """, [today, ticker.upper(), cp_long])
                loose_rows = [dict(r) for r in cur.fetchall()]
            finally:
                conn.close()
            debug["row_count_loose_same_ticker_cp"] = len(loose_rows)

        # Per-row classification (try/except so one bad row doesn't kill it)
        debug["stage"] = "classify_rows"
        summary = {
            "total_rows": len(rows),
            "by_color": {},
            "by_side": {},
            "would_show_in_live_massive_count": 0,
            "max_oi_seen": 0,
            "total_volume": 0,
            "total_premium": 0,
        }
        detailed = []
        for r in rows:
            try:
                color = r.get("Color") or "(none)"
                side = r.get("Side") or "(none)"
                summary["by_color"][color] = summary["by_color"].get(color, 0) + 1
                summary["by_side"][side] = summary["by_side"].get(side, 0) + 1
                vol = _parse_int(r.get("Volume"))
                prem = _parse_int(r.get("Premium"))
                oi = _parse_int(r.get("OI"))
                summary["total_volume"] += vol
                summary["total_premium"] += prem
                if oi > summary["max_oi_seen"]:
                    summary["max_oi_seen"] = oi
                v_oi = round(vol / oi, 2) if oi > 0 else None

                # Try classify
                a = None
                tier = grade = None
                try:
                    a = _row_to_alert(r)
                    if a:
                        tier = a.get("_tierKey")
                        grade = a.get("grade")
                except Exception as e:
                    debug["errors"].append(f"row {r.get('id')} classify error: {e}")

                in_live_massive = (a is not None) and color in ("MAGENTA", "YELLOW")
                if in_live_massive:
                    summary["would_show_in_live_massive_count"] += 1

                why_filtered = None
                if not in_live_massive:
                    if color == "WHITE":
                        why_filtered = "Color=WHITE (cum_vol/OI ratio < 1.0)"
                    elif color not in ("MAGENTA", "YELLOW", "WHITE"):
                        why_filtered = f"Color={color!r}"
                    elif a is None:
                        why_filtered = "Side unclassifiable or unknown direction"

                detailed.append({
                    "id": r.get("id"),
                    "time": r.get("CreatedTime"),
                    "color": r.get("Color"),
                    "side": r.get("Side"),
                    "volume": vol,
                    "price": r.get("Price"),
                    "premium": prem,
                    "oi": oi,
                    "v_oi": v_oi,
                    "spot": r.get("Spot"),
                    "type": r.get("Type"),
                    "strike_in_db": r.get("Strike"),
                    "tier": tier,
                    "grade": grade,
                    "would_show_in_live_massive": in_live_massive,
                    "why_filtered": why_filtered,
                })
            except Exception as e:
                debug["errors"].append(f"row {r.get('id')} outer error: {e}")

        debug["stage"] = "done"

        # Interpretation hint
        if not rows and not loose_rows:
            interp = "No rows for this ticker+cp+date at all. Worker did not capture, or symbol/date mismatch."
        elif not rows and loose_rows:
            interp = (
                "Strike/exp filter excluded all rows BUT the ticker+cp DOES have rows today. "
                "See `loose_match_sample` for actual Strike/ExpirationDate values stored — "
                "your input likely has a format mismatch."
            )
        else:
            mag_yel = sum(summary["by_color"].get(c, 0) for c in ("MAGENTA", "YELLOW"))
            white = summary["by_color"].get("WHITE", 0)
            if summary["would_show_in_live_massive_count"] > 0:
                interp = f"Yes, {summary['would_show_in_live_massive_count']} rows would show in /live-massive."
            elif white > 0 and mag_yel == 0:
                interp = (
                    f"Captured {white} rows but all classified Color=WHITE. The cum_vol/OI "
                    f"ratio never reached 1.0× — Massive's classifier filters these out."
                )
            else:
                interp = "Captured but filtered. See per-row why_filtered."

        return {
            "query": {
                "date": today, "ticker": ticker.upper(), "cp": cp_long,
                "strike": strike, "exp": exp,
            },
            "summary": summary,
            "rows": detailed,
            "loose_match_sample": loose_rows[:20] if not rows else None,
            "interpretation": interp,
            "debug": debug,
        }

    except Exception as e:
        import traceback
        debug["errors"].append(f"top-level: {type(e).__name__}: {e}")
        debug["traceback"] = traceback.format_exc().split("\n")[-15:]
        return {"error": str(e), "debug": debug}


@router.get("/side-diagnostic")
def side_diagnostic(target_date: str = Query(default=None, description="Trading date M/D/YYYY (default today)")):
    """Diagnose unclassified-Side rate. Returns breakdown of Side values
    across today's MAGENTA/YELLOW rows + sample of unclassified rows for
    pattern detection. Useful for investigating "skipped_unclassified_side"
    metric on /recent responses.

    Common reasons a row has empty/unclassifiable Side:
      - Trade printed at mid-market (Lee-Ready can't decide)
      - NBBO data stale / Q subscription not yet active for the contract
      - Raw print history empty (first trade on the contract today)
      - Worker was warming up and hadn't subscribed to this contract yet
    """
    today = target_date or _today_mdyyyy()
    conn = sqlite3.connect(DB_PATH, timeout=10)
    try:
        conn.row_factory = sqlite3.Row
        # Counts by Side value across today's classifiable color rows
        cur = conn.execute("""
            SELECT COALESCE(Side, '') AS s, COUNT(*) AS n
              FROM flow
             WHERE source = 'stocks'
               AND CreatedDate = ?
               AND Color IN ('MAGENTA', 'YELLOW')
             GROUP BY s
             ORDER BY n DESC
        """, (today,))
        side_counts = [(r["s"] or "(empty)", r["n"]) for r in cur.fetchall()]
        total = sum(n for _, n in side_counts)
        classified = sum(n for s, n in side_counts if s in ("A", "AA", "B", "BB"))
        unclassified = total - classified

        # Sample of unclassified rows for pattern detection
        cur = conn.execute("""
            SELECT CreatedTime, Symbol, Type, CallPut, Strike, Spot,
                   Premium, Color, OI, Volume, Side, ExpirationDate
              FROM flow
             WHERE source = 'stocks'
               AND CreatedDate = ?
               AND Color IN ('MAGENTA', 'YELLOW')
               AND (Side IS NULL OR Side = '' OR Side NOT IN ('A','AA','B','BB'))
             ORDER BY id DESC
             LIMIT 25
        """, (today,))
        sample_unclassified = [dict(r) for r in cur.fetchall()]

        # Pattern: which tickers have the most unclassified
        cur = conn.execute("""
            SELECT Symbol, COUNT(*) AS n
              FROM flow
             WHERE source = 'stocks'
               AND CreatedDate = ?
               AND Color IN ('MAGENTA', 'YELLOW')
               AND (Side IS NULL OR Side = '' OR Side NOT IN ('A','AA','B','BB'))
             GROUP BY Symbol
             ORDER BY n DESC
             LIMIT 20
        """, (today,))
        top_unclassified_tickers = [(r["Symbol"], r["n"]) for r in cur.fetchall()]

        # Pattern: by Type (sweep vs block vs ML vs regular)
        cur = conn.execute("""
            SELECT COALESCE(Type, '') AS t, COUNT(*) AS n
              FROM flow
             WHERE source = 'stocks'
               AND CreatedDate = ?
               AND Color IN ('MAGENTA', 'YELLOW')
               AND (Side IS NULL OR Side = '' OR Side NOT IN ('A','AA','B','BB'))
             GROUP BY t
             ORDER BY n DESC
             LIMIT 10
        """, (today,))
        unclassified_by_type = [(r["t"] or "(empty)", r["n"]) for r in cur.fetchall()]
    finally:
        conn.close()

    return {
        "query_date": today,
        "summary": {
            "total_my_rows": total,
            "classified_count": classified,
            "unclassified_count": unclassified,
            "unclassified_pct": round(100.0 * unclassified / total, 1) if total else 0,
        },
        "side_distribution": dict(side_counts),
        "top_unclassified_tickers": dict(top_unclassified_tickers),
        "unclassified_by_type": dict(unclassified_by_type),
        "sample_unclassified": sample_unclassified,
        "interpretation": (
            f"{unclassified} of {total} MAGENTA/YELLOW rows have no usable Side. "
            "Common causes: trades printing mid-market (Lee-Ready can't decide), "
            "NBBO data stale, Q subscription not active, or first trade on a "
            "contract before raw print history existed."
        ),
    }
