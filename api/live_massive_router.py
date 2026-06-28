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
from fastapi import APIRouter, Query
from datetime import date, datetime, timezone, timedelta
import sqlite3
import os
import time
import re

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
        # Unusual (high V/OI even at lower premium)
        if v_oi >= 5.0 and premium < 500_000:
            return ("UCT Unusual Vol>OI", "unusual", TIER_PRIORITY["unusual"])
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
    """Try to read massive_ws_worker status; gracefully degrade if unavailable."""
    try:
        from api.massive_ws_worker import get_status
        s = get_status()
        return {
            "connected": bool(s.get("connected", False)),
            "source": "massive",
            "last_event_at": s.get("last_trade_ts_iso") or s.get("last_write_ts_iso"),
            "started_at": s.get("started_at"),
            "reconnect_count": s.get("reconnect_count", 0),
            "total_trades_today": s.get("trades_added_today") or s.get("trades_added", 0),
            "last_error": s.get("last_error"),
        }
    except Exception as e:
        return {
            "connected": False,
            "source": "massive",
            "last_event_at": None,
            "started_at": None,
            "reconnect_count": 0,
            "last_error": f"worker status unavailable: {e}",
        }


@router.get("/recent")
def recent_massive_alerts(
    limit: int = Query(default=200, ge=1, le=1000),
    min_grade: str = Query(default="D", description="Min letter grade A+/A/B/C/D"),
    target_date: str = Query(default=None, description="M/D/YYYY override (default=today)"),
    sort_by: str = Query(default="recent", description="recent|conviction|premium"),
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
        # for conviction/premium we pull more upfront.
        sql_limit = limit * 3 if sort_by == "recent" else 10000
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

    # Translate all rows first (drop unclassified + low-grade), then sort + trim
    all_alerts = []
    skipped_unclassified = 0
    skipped_low_grade = 0
    for r in rows:
        a = _row_to_alert(dict(r))
        if a is None:
            skipped_unclassified += 1
            continue
        if grade_threshold.get(a["grade"], 0) < min_threshold:
            skipped_low_grade += 1
            continue
        all_alerts.append(a)

    if sort_by == "conviction":
        all_alerts.sort(key=lambda a: a["convictionScore"], reverse=True)
    elif sort_by == "premium":
        all_alerts.sort(key=lambda a: a["alertPremium"], reverse=True)
    # "recent" already in id DESC order from SQL

    alerts = all_alerts[:limit]

    status = _get_worker_status()
    status["query_date"] = today
    status["sort_by"] = sort_by
    status["rows_scanned"] = len(rows)
    status["skipped_unclassified_side"] = skipped_unclassified
    status["skipped_below_min_grade"] = skipped_low_grade
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
