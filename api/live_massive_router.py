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


def _derive_direction(cp: str, side: str):
    """Bull/Bear from Side+CP. None when Side is empty (unclassified)."""
    if not side:
        return None
    side_is_ask = side in ("A", "AA")
    side_is_bid = side in ("B", "BB")
    if cp == "CALL":
        if side_is_ask: return "Bull"
        if side_is_bid: return "Bear"
    elif cp == "PUT":
        if side_is_ask: return "Bear"   # PUT bought = bearish bet
        if side_is_bid: return "Bull"   # PUT sold = bullish bet
    return None


def _derive_alert_name(row: dict, direction: str) -> tuple[str, str, int]:
    """Returns (alertName, tier_key, tier_priority).

    Mapping aligns to LiveFlow.jsx deriveTier() so the existing UI groups
    Massive rows into the right colored sections without modification.
    """
    color = row["Color"]
    type_ = row["Type"] or ""
    premium = _parse_int(row["Premium"])
    side = row["Side"] or ""
    dte = _parse_int(row["Dte"])
    volume = _parse_int(row["Volume"])
    oi = _parse_int(row["OI"])
    v_oi = (volume / oi) if oi > 0 else 0

    # Multi-leg complex strategies → Algo (non-directional, low priority)
    if type_ == "ML/":
        return ("Algo", "algo", TIER_PRIORITY["algo"])

    is_leaps = dte >= 180
    side_is_ask = side in ("A", "AA")

    # Direction-aware tier key: Bull → "bullish", Bear → "bearish".
    # Both share priority 3 in TIER_PRIORITY, just rendered in different
    # colored sections in LiveFlow.jsx (green vs red).
    dir_tier = "bullish" if direction == "Bull" else "bearish"

    if color == "MAGENTA":
        # Alpha Gold — rarest, top tier
        if premium >= 1_000_000 and side_is_ask and not is_leaps:
            return (f"UCT Alpha Gold {direction}", "alpha", TIER_PRIORITY["alpha"])
        # LEAPS
        if is_leaps:
            return (f"UCT {direction} LEAPS", "leaps", TIER_PRIORITY["leaps"])
        # Unusual — dormant ticker (per past N trading days) waking up with
        # high V/OI flow. When precompute data unavailable, falls back to
        # legacy V/OI-only rule. See _is_unusual_classification() for full
        # explanation.
        if _is_unusual_classification(row["Symbol"], v_oi, premium):
            return ("UCT Unusual Name", "unusual", TIER_PRIORITY["unusual"])
        # Size — big premium magenta
        if premium >= 500_000:
            return (f"UCT Size {direction}s", "size", TIER_PRIORITY["size"])
        # Regular bullish/bearish magenta
        return (f"UCT {direction}ish", dir_tier, TIER_PRIORITY[dir_tier])

    if color == "YELLOW":
        if is_leaps:
            return (f"UCT {direction} LEAPS", "leaps", TIER_PRIORITY["leaps"])
        # YELLOW = cumulative accumulation
        return (f"UCT {direction}ish Accumulation", dir_tier, TIER_PRIORITY[dir_tier])

    # Shouldn't happen given query filter but defensive
    return ("Unusual", "unusual", TIER_PRIORITY["unusual"])


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

    direction = _derive_direction(cp_full, side)
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

    alert_name, tier_key, tier_priority = _derive_alert_name(row, direction)
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
        cur = conn.execute("""
            SELECT id, source, CreatedDate, CreatedTime, Symbol, Type, Volume,
                   Price, Side, CallPut, Strike, Spot, Premium, ExpirationDate,
                   Color, Dte, ER, StockEtf, Sector, Uoa, Weekly, MktCap, OI
              FROM flow
             WHERE source = 'stocks'
               AND CreatedDate = ?
               AND Color IN ('MAGENTA', 'YELLOW')
             ORDER BY id DESC
             LIMIT ?
        """, (today, sql_limit))
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
        d = _derive_direction(cp, side)
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
    allowed_top = {"stack", "premium_by_cap", "unusual", "cap_bands"}
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
    strike: float = Query(..., description="Strike price as number"),
    exp: str = Query(..., description="Expiration date M/D/YYYY"),
    target_date: str = Query(default=None, description="Trading date M/D/YYYY (default today)"),
):
    """Diagnostic: return ALL FlowDB rows for a specific contract on a given
    day, regardless of Color (MAGENTA / YELLOW / WHITE). Use this to answer
    "why didn't I see X on /live-massive" — usually one of:
      - Color=WHITE (cum_vol/OI didn't trigger classification)
      - Side unclassifiable (worker can't determine ASK vs BID)
      - Not captured at all (worker was idle / Bullflow saw something Massive didn't)

    Returns raw rows + summary of how the row would have been classified.
    """
    today = target_date or _today_mdyyyy()
    cp_norm = (cp or "").strip().upper()
    if cp_norm not in ("C", "P", "CALL", "PUT"):
        raise HTTPException(400, "cp must be C, P, CALL, or PUT")
    cp_long = "CALL" if cp_norm in ("C", "CALL") else "PUT"

    # Strike stored as TEXT — match flexibly (some rows have '$2050', some '2050',
    # some '2050.0'). Normalize the input then test multiple representations.
    strike_int = int(strike) if float(strike).is_integer() else None
    strike_candidates = [str(strike), f"${strike}"]
    if strike_int is not None:
        strike_candidates += [str(strike_int), f"${strike_int}", f"{strike_int}.0"]

    conn = sqlite3.connect(DB_PATH, timeout=10)
    try:
        conn.row_factory = sqlite3.Row
        placeholders = ",".join("?" for _ in strike_candidates)
        cur = conn.execute(f"""
            SELECT id, CreatedDate, CreatedTime, Symbol, Type, Volume, Price,
                   Side, CallPut, Strike, Spot, Premium, ExpirationDate, Color,
                   Dte, MktCap, OI
              FROM flow
             WHERE source = 'stocks'
               AND CreatedDate = ?
               AND Symbol = ?
               AND CallPut = ?
               AND Strike IN ({placeholders})
               AND ExpirationDate = ?
             ORDER BY id ASC
        """, (today, ticker.upper(), cp_long, *strike_candidates, exp))
        rows = [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()

    # Classify each row + summarize what would have happened
    summary = {
        "total_rows": len(rows),
        "by_color": {},
        "by_side": {},
        "would_be_classified_count": 0,
        "would_be_unclassified_count": 0,
        "tier_distribution": {},
        "total_volume": 0,
        "total_premium": 0,
        "max_oi_seen": 0,
    }
    detailed = []
    for r in rows:
        color = r["Color"] or "(none)"
        side = r["Side"] or "(none)"
        summary["by_color"][color] = summary["by_color"].get(color, 0) + 1
        summary["by_side"][side] = summary["by_side"].get(side, 0) + 1
        summary["total_volume"] += _parse_int(r["Volume"])
        summary["total_premium"] += _parse_int(r["Premium"])
        summary["max_oi_seen"] = max(summary["max_oi_seen"], _parse_int(r["OI"]))

        # Try to classify exactly as /recent would
        a = _row_to_alert(r)
        classified = a is not None
        if classified:
            summary["would_be_classified_count"] += 1
            t = a.get("_tierKey", "?")
            summary["tier_distribution"][t] = summary["tier_distribution"].get(t, 0) + 1
        else:
            summary["would_be_unclassified_count"] += 1

        detailed.append({
            "id": r["id"],
            "time": r["CreatedTime"],
            "color": r["Color"],
            "side": r["Side"],
            "volume": _parse_int(r["Volume"]),
            "price": r["Price"],
            "premium": _parse_int(r["Premium"]),
            "oi": _parse_int(r["OI"]),
            "v_oi": round(_parse_int(r["Volume"]) / _parse_int(r["OI"]), 2)
                if _parse_int(r["OI"]) > 0 else None,
            "spot": r["Spot"],
            "type": r["Type"],
            "would_classify_as_tier": a.get("_tierKey") if a else None,
            "would_classify_as_grade": a.get("grade") if a else None,
            "would_show_in_live_massive": classified and r["Color"] in ("MAGENTA", "YELLOW"),
            "why_filtered": (
                None if classified and r["Color"] in ("MAGENTA", "YELLOW")
                else "Color=WHITE (cum_vol/OI ratio < 1.0)" if r["Color"] == "WHITE"
                else "Color missing/other" if r["Color"] not in ("MAGENTA","YELLOW","WHITE")
                else "Side unclassifiable (not A/AA/B/BB)"
            ),
        })

    return {
        "query": {
            "date": today,
            "ticker": ticker.upper(),
            "cp": cp_long,
            "strike": strike,
            "exp": exp,
        },
        "summary": summary,
        "rows": detailed,
        "interpretation": (
            "No rows found — worker did not capture this contract today. "
            "Possible causes: worker was idle, contract isn't in the Massive "
            "subscription, or symbol/date mismatch."
            if not rows else
            "Rows found. See `summary.by_color` and `would_show_in_live_massive` "
            "per row to understand why specific events did or didn't surface."
        ),
    }
