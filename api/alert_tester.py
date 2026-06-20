"""
api/alert_tester.py

UCT Alert Tester — admin-only simulator that lets you upload a Bullflow CSV,
edit any custom-alert config, and see the full UCT pipeline output:
  Bullflow filter -> normalize -> dedup -> aggregate -> grade -> gate

NEVER posts to Discord. NEVER mutates production state. NEVER writes to DB.
Pure read-only simulation.

Endpoints
---------
GET  /api/admin/alert-tester/configs      Proxy to Bullflow MCP, returns 10 saved alerts
POST /api/admin/alert-tester/simulate     Upload CSV + config JSON, run pipeline

Mount in main.py:
    from api import alert_tester
    app.include_router(alert_tester.router)
"""

from __future__ import annotations

import io
import csv
import json
import math
import logging
from collections import defaultdict, Counter
from datetime import date, datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query
from fastapi.responses import JSONResponse

log = logging.getLogger("alert_tester")

router = APIRouter(prefix="/api/admin/alert-tester", tags=["alert-tester"])

# ─────────────────────────────────────────────────────────────────────────────
# CSV PARSING + PREPROCESSING
# ─────────────────────────────────────────────────────────────────────────────

# Expected columns in Bullflow CSV export
EXPECTED_COLS = {
    "time_of_trade", "tickerSymbol", "premium", "optionType", "tradeType",
    "currentVolume", "expirationDate", "impliedVolatility", "openInterest",
    "otmPercentage", "score", "spotPrice", "spreadExecution", "strikePrice",
    "tradePrice", "tradeSize", "unixTimestamp", "earningsDateFormatted",
    "Symbol",
}


def _parse_dte(exp_str: str, trade_date: date) -> int:
    """expirationDate is 'YY-MM-DD' format. Returns DTE relative to trade_date."""
    try:
        parts = exp_str.strip().split("-")
        if len(parts) != 3:
            return -1
        yy, mm, dd = int(parts[0]), int(parts[1]), int(parts[2])
        exp_dt = date(2000 + yy, mm, dd)
        return (exp_dt - trade_date).days
    except Exception:
        return -1


def _infer_direction(option_type: str, side: str) -> str:
    """
    Bullish/Bearish/Neutral inferred from option type + spread execution.
    Standard convention:
      Call + Ask (or Above Ask) = BULLISH  (aggressive call buying)
      Call + Bid (or Below Bid) = BEARISH  (call selling)
      Put  + Ask (or Above Ask) = BEARISH  (aggressive put buying)
      Put  + Bid (or Below Bid) = BULLISH  (put selling)
      Anything Mid              = NEUTRAL
    """
    cp = (option_type or "").upper()
    sd = (side or "").lower()
    if "mid" in sd:
        return "NEUTRAL"
    is_ask = "ask" in sd or "above" in sd
    is_bid = "bid" in sd or "below" in sd
    if cp == "C":
        if is_ask:
            return "BULLISH"
        if is_bid:
            return "BEARISH"
    elif cp == "P":
        if is_ask:
            return "BEARISH"
        if is_bid:
            return "BULLISH"
    return "NEUTRAL"


def _side_bucket(side: str) -> str:
    """Map fine-grained spreadExecution into canonical Ask / Bid / Mid buckets."""
    sd = (side or "").lower()
    if "mid" in sd:
        return "MID"
    if "ask" in sd or "above" in sd:
        return "ASK"
    if "bid" in sd or "below" in sd:
        return "BID"
    return "MID"


def _trade_type_bucket(tt: str) -> str:
    """Normalize tradeType column to UCT canonical buckets."""
    s = (tt or "").upper()
    if "SWEEP" in s:
        return "SWEEP"
    if "BLOCK" in s:
        return "BLOCK"
    if "SPLIT" in s:
        return "SPLIT"
    if "MULTI" in s:
        return "MULTILEG"
    if "SINGLE" in s:
        return "SINGLE"
    return s


def _parse_csv(raw: bytes) -> tuple[list[dict], list[str]]:
    """
    Parse the Bullflow CSV. Returns (rows, warnings).
    Each row is a dict with normalized fields used downstream.
    """
    warnings: list[str] = []
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1", errors="replace")
        warnings.append("CSV decoded as latin-1 (non-UTF-8 bytes present).")

    reader = csv.DictReader(io.StringIO(text))
    headers = set(reader.fieldnames or [])
    missing = EXPECTED_COLS - headers
    if missing:
        warnings.append(f"CSV missing expected columns: {sorted(missing)}")

    # Trade date inferred from first row's unixTimestamp (fallback: today)
    rows: list[dict] = []
    trade_date: Optional[date] = None
    skipped = 0
    for raw_row in reader:
        try:
            ts_unix = int(raw_row.get("unixTimestamp") or 0)
        except (ValueError, TypeError):
            ts_unix = 0
        if trade_date is None and ts_unix > 0:
            trade_date = datetime.utcfromtimestamp(ts_unix).date()

        try:
            premium = float(raw_row.get("premium") or 0)
            strike = float(raw_row.get("strikePrice") or 0)
            spot = float(raw_row.get("spotPrice") or 0)
            iv = float(raw_row.get("impliedVolatility") or 0)
            oi = int(float(raw_row.get("openInterest") or 0))
            vol = int(float(raw_row.get("currentVolume") or 0))
            trade_size = int(float(raw_row.get("tradeSize") or 0))
            trade_price = float(raw_row.get("tradePrice") or 0)
            otm_pct = float(raw_row.get("otmPercentage") or 0)
            score = float(raw_row.get("score") or 0)
        except (ValueError, TypeError):
            skipped += 1
            continue

        ttype = _trade_type_bucket(raw_row.get("tradeType", ""))
        if ttype in ("CORRECTION", "CANCELED", "CANCELLED"):
            skipped += 1
            continue

        side = _side_bucket(raw_row.get("spreadExecution", ""))
        cp = (raw_row.get("optionType") or "").upper()
        direction = _infer_direction(cp, raw_row.get("spreadExecution", ""))

        rows.append({
            "time": raw_row.get("time_of_trade", ""),
            "ticker": (raw_row.get("tickerSymbol") or "").upper(),
            "premium": premium,
            "cp": cp,
            "trade_type": ttype,
            "vol": vol,
            "exp": raw_row.get("expirationDate", ""),
            "iv": iv,
            "oi": oi,
            "otm_pct": otm_pct,
            "score": score,
            "spot": spot,
            "side": side,
            "side_raw": raw_row.get("spreadExecution", ""),
            "strike": strike,
            "trade_price": trade_price,
            "trade_size": trade_size,
            "unix": ts_unix,
            "earnings": raw_row.get("earningsDateFormatted", ""),
            "symbol": raw_row.get("Symbol", ""),
            "direction": direction,
        })

    if trade_date is None:
        trade_date = date.today()
        warnings.append("Could not infer trade date from unixTimestamp; using today.")
    if skipped:
        warnings.append(f"Skipped {skipped} rows (parse errors or CORRECTION/CANCELED).")

    # Compute DTE on every row now that trade_date is known
    for r in rows:
        r["dte"] = _parse_dte(r["exp"], trade_date)

    return rows, warnings


# ─────────────────────────────────────────────────────────────────────────────
# BULLFLOW-SIDE FILTER
# ─────────────────────────────────────────────────────────────────────────────

def _apply_bullflow_filter(rows: list[dict], cfg: dict) -> tuple[list[dict], dict]:
    """
    Apply a Bullflow custom-alert config to the list of rows.
    Returns (matched_rows, drop_reasons_counter) for diagnostics.
    """
    drops: Counter = Counter()
    matches: list[dict] = []

    # Pull config with safe defaults
    min_prem = float(cfg.get("minPremium", 0) or 0)
    max_prem = float(cfg.get("maxPremium", 1e15) or 1e15)
    min_dte = int(cfg.get("minDTE", 0) or 0)
    max_dte = int(cfg.get("maxDTE", 9999) or 9999)
    min_strike = float(cfg.get("minStrike", 0) or 0)
    max_strike = float(cfg.get("maxStrike", 1e9) or 1e9)
    min_iv = float(cfg.get("minIV", 0) or 0)
    max_iv = float(cfg.get("maxIV", 1e9) or 1e9)
    min_oi = int(cfg.get("minOI", 0) or 0)
    max_oi = int(cfg.get("maxOI", 1e9) or 1e9)
    min_vol = int(cfg.get("minCurrentVolume", 0) or 0)
    max_vol = int(cfg.get("maxCurrentVolume", 1e9) or 1e9)
    min_spot = float(cfg.get("minSpot", 0) or 0)
    max_spot = float(cfg.get("maxSpot", 1e9) or 1e9)
    min_opt_price = float(cfg.get("minOptionPrice", 0) or 0)
    max_opt_price = float(cfg.get("maxOptionPrice", 1e9) or 1e9)
    min_trade_size = int(cfg.get("minTradeSize", 0) or 0)
    max_trade_size = int(cfg.get("maxTradeSize", 1e9) or 1e9)
    min_otm = float(cfg.get("minOTM", -1e9) or -1e9)
    max_otm = float(cfg.get("maxOTM", 1e9) or 1e9)
    min_score = float(cfg.get("minScore", 0) or 0)
    max_score = float(cfg.get("maxScore", 1) or 1)
    min_vol_exceed = float(cfg.get("minVolumeExceedsOIBy", -1e9) or -1e9)
    max_vol_exceed = float(cfg.get("maxVolumeExceedsOIBy", 1e9) or 1e9)

    excludes = {(t or "").upper() for t in (cfg.get("excludeTickers") or [])}
    only_show = {(t or "").upper() for t in (cfg.get("onlyShowTickers") or [])}

    calls_ok = bool(cfg.get("callsCheckBox", True))
    puts_ok = bool(cfg.get("putsCheckBox", True))
    bullish_ok = bool(cfg.get("bullishCheckBox", True))
    bearish_ok = bool(cfg.get("bearishCheckBox", True))
    neutral_ok = bool(cfg.get("neutralCheckBox", False))

    ask_ok = bool(cfg.get("aaCheckBox", True))   # ASK / Above Ask
    bid_ok = bool(cfg.get("bbCheckBox", False))  # BID / Below Bid
    # If neither aa nor bb checked, allow Mid trades through (rare config)
    mid_ok = not (ask_ok or bid_ok)

    sweeps_ok = bool(cfg.get("sweepsCheckBox", True))
    blocks_ok = bool(cfg.get("blocksCheckbox", False))
    singles_ok = bool(cfg.get("singlesCheckbox", True))
    splits_ok = bool(cfg.get("splitsCheckBox", True))
    multileg_ok = bool(cfg.get("multilegCheckbox", False))

    for r in rows:
        # Premium
        if r["premium"] < min_prem or r["premium"] > max_prem:
            drops["premium_out_of_range"] += 1
            continue
        # DTE
        if r["dte"] < min_dte or r["dte"] > max_dte:
            drops["dte_out_of_range"] += 1
            continue
        # Option type
        if r["cp"] == "C" and not calls_ok:
            drops["calls_disabled"] += 1; continue
        if r["cp"] == "P" and not puts_ok:
            drops["puts_disabled"] += 1; continue
        # Direction (bull/bear/neut)
        if r["direction"] == "BULLISH" and not bullish_ok:
            drops["bullish_disabled"] += 1; continue
        if r["direction"] == "BEARISH" and not bearish_ok:
            drops["bearish_disabled"] += 1; continue
        if r["direction"] == "NEUTRAL" and not neutral_ok:
            drops["neutral_disabled"] += 1; continue
        # Side (Ask / Bid / Mid)
        if r["side"] == "ASK" and not ask_ok and not mid_ok:
            drops["ask_disabled"] += 1; continue
        if r["side"] == "BID" and not bid_ok and not mid_ok:
            drops["bid_disabled"] += 1; continue
        if r["side"] == "MID" and not mid_ok:
            drops["mid_disabled"] += 1; continue
        # Trade type
        tt = r["trade_type"]
        if tt == "SWEEP" and not sweeps_ok: drops["sweeps_disabled"] += 1; continue
        if tt == "BLOCK" and not blocks_ok: drops["blocks_disabled"] += 1; continue
        if tt == "SINGLE" and not singles_ok: drops["singles_disabled"] += 1; continue
        if tt == "SPLIT" and not splits_ok: drops["splits_disabled"] += 1; continue
        if tt == "MULTILEG" and not multileg_ok: drops["multileg_disabled"] += 1; continue
        # Strike / IV / OI / Volume / Spot / Option price / Trade size
        if r["strike"] < min_strike or r["strike"] > max_strike: drops["strike"] += 1; continue
        if r["iv"] < min_iv or r["iv"] > max_iv: drops["iv"] += 1; continue
        if r["oi"] < min_oi or r["oi"] > max_oi: drops["oi"] += 1; continue
        if r["vol"] < min_vol or r["vol"] > max_vol: drops["vol"] += 1; continue
        if r["spot"] < min_spot or r["spot"] > max_spot: drops["spot"] += 1; continue
        if r["trade_price"] < min_opt_price or r["trade_price"] > max_opt_price:
            drops["opt_price"] += 1; continue
        if r["trade_size"] < min_trade_size or r["trade_size"] > max_trade_size:
            drops["trade_size"] += 1; continue
        # OTM%
        if r["otm_pct"] < min_otm or r["otm_pct"] > max_otm: drops["otm"] += 1; continue
        # Score
        if r["score"] < min_score or r["score"] > max_score: drops["score"] += 1; continue
        # Vol exceeds OI by
        vol_exceeds_oi = r["vol"] - r["oi"]
        if vol_exceeds_oi < min_vol_exceed or vol_exceeds_oi > max_vol_exceed:
            drops["vol_exceeds_oi"] += 1; continue
        # Ticker lists
        if only_show and r["ticker"] not in only_show:
            drops["only_show_filter"] += 1; continue
        if r["ticker"] in excludes:
            drops["excluded_ticker"] += 1; continue

        matches.append(r)

    return matches, dict(drops)


# ─────────────────────────────────────────────────────────────────────────────
# UCT PIPELINE — Normalize -> Dedup -> Aggregate -> Grade -> Gate
# ─────────────────────────────────────────────────────────────────────────────

# Alert tier weights (matches the live pipeline conviction grade)
TIER_WEIGHTS = {
    "UCT Alpha Gold":     3.0,
    "UCT Size Bulls":     2.5,
    "UCT Size Bears":     2.5,
    "UCT Vol>OI":         2.5,
    "UCT Bullish":        2.0,
    "UCT Bearish":        2.0,
    "UCT Bullish Leaps":  1.5,
    "UCT Bearish Leaps":  1.5,
    "UCT Leaps":          1.0,
    "UCT Unusual":        0.5,
}

# Grade thresholds (composite score is 0..10)
GRADE_THRESHOLDS = [
    (8.5, "A+"),
    (7.0, "A"),
    (6.0, "B+"),
    (5.5, "B"),
    (3.5, "C"),
    (0.0, "D"),
]

GRADE_LEVEL = {"D": 0, "C": 1, "B": 2, "B+": 3, "A": 4, "A+": 5}


def _premium_score(prem: float) -> float:
    """Premium tier score 0..3."""
    if prem >= 5_000_000: return 3.0
    if prem >= 2_500_000: return 2.5
    if prem >= 1_000_000: return 2.0
    if prem >=   750_000: return 1.5
    if prem >=   500_000: return 1.0
    if prem >=   250_000: return 0.5
    return 0.0


def _oi_break_score(vol: int, oi: int) -> float:
    """Vol > OI scoring (0..2)."""
    if oi <= 0: return 1.0  # unknown OI; mild credit
    ratio = vol / oi
    if ratio >= 5.0: return 2.0
    if ratio >= 2.0: return 1.5
    if ratio >= 1.0: return 1.0
    if ratio >= 0.5: return 0.5
    return 0.0


def _repeat_fires_score(fires: int) -> float:
    """Number of times this contract appeared in last 5 minutes (0..2)."""
    if fires >= 5: return 2.0
    if fires >= 3: return 1.5
    if fires >= 2: return 1.0
    return 0.0


def _moneyness_score(otm_pct: float) -> float:
    """ATM = 1.0, drops off as you go OTM (0..1)."""
    a = abs(otm_pct)
    if a <= 2: return 1.0
    if a <= 5: return 0.75
    if a <= 10: return 0.5
    if a <= 20: return 0.25
    return 0.0


def _grade_from_score(score: float) -> str:
    for thresh, grade in GRADE_THRESHOLDS:
        if score >= thresh:
            return grade
    return "D"


def _normalize(matches: list[dict], alert_name: str) -> list[dict]:
    """Turn filtered Bullflow trades into UCT alert objects."""
    out: list[dict] = []
    for i, r in enumerate(matches):
        out.append({
            "id": f"sim-{i+1}",
            "alert_name": alert_name,
            "ticker": r["ticker"],
            "cp": r["cp"],
            "strike": r["strike"],
            "exp": r["exp"],
            "dte": r["dte"],
            "premium": r["premium"],
            "trade_price": r["trade_price"],
            "trade_size": r["trade_size"],
            "side": r["side"],
            "trade_type": r["trade_type"],
            "direction": r["direction"],
            "vol": r["vol"],
            "oi": r["oi"],
            "spot": r["spot"],
            "otm_pct": r["otm_pct"],
            "iv": r["iv"],
            "score": r["score"],
            "time": r["time"],
            "unix": r["unix"],
            "symbol": r["symbol"],
        })
    return out


def _dedup(alerts: list[dict], window_sec: int = 60) -> tuple[list[dict], int]:
    """
    Dedup by contract key within rolling window. Highest premium wins.
    Returns (deduped_list, dropped_count).
    """
    if window_sec <= 0:
        return alerts, 0
    # Sort by time
    sorted_alerts = sorted(alerts, key=lambda a: a["unix"])
    seen: dict[str, dict] = {}  # key -> alert
    last_seen: dict[str, int] = {}  # key -> unix timestamp
    kept: list[dict] = []
    dropped = 0
    for a in sorted_alerts:
        key = f"{a['ticker']}|{a['cp']}|{a['strike']}|{a['exp']}|{round(a['premium'])}"
        prev_unix = last_seen.get(key)
        if prev_unix is not None and (a["unix"] - prev_unix) <= window_sec:
            # Within dedup window - keep higher premium
            existing = seen[key]
            if a["premium"] > existing["premium"]:
                # Replace
                if existing in kept:
                    kept.remove(existing)
                kept.append(a)
                seen[key] = a
            dropped += 1
        else:
            kept.append(a)
            seen[key] = a
            last_seen[key] = a["unix"]
    return kept, dropped


def _aggregate_repeats(alerts: list[dict], window_sec: int = 300) -> list[dict]:
    """
    For each alert, count how many alerts on the same contract appeared in the
    prior `window_sec` seconds (default 5 min). Populates `repeat_fires`.
    """
    by_contract: dict[str, list[int]] = defaultdict(list)
    sorted_alerts = sorted(alerts, key=lambda a: a["unix"])
    for a in sorted_alerts:
        ck = f"{a['ticker']}|{a['cp']}|{a['strike']}|{a['exp']}"
        recent = [t for t in by_contract[ck] if a["unix"] - t <= window_sec]
        a["repeat_fires"] = len(recent) + 1
        by_contract[ck].append(a["unix"])
    return sorted_alerts


def _grade_all(alerts: list[dict], alert_name: str) -> list[dict]:
    """
    Apply 10pt composite grading to each alert.
    Breakdown:
      premium      0..3
      oi_break     0..2
      fires        0..2
      tier         0..3
      moneyness    0..1
      multi_alert  0..1  (always 0 in single-alert simulation)
    """
    tier_w = TIER_WEIGHTS.get(alert_name, 2.0)
    for a in alerts:
        prem_sc = _premium_score(a["premium"])
        oi_sc = _oi_break_score(a["vol"], a["oi"])
        fires_sc = _repeat_fires_score(a.get("repeat_fires", 1))
        moneyness_sc = _moneyness_score(a["otm_pct"])
        multi_sc = 0.0   # In single-alert simulation, always 0
        composite = prem_sc + oi_sc + fires_sc + tier_w + moneyness_sc + multi_sc
        composite = min(10.0, composite)
        a["grade_breakdown"] = {
            "premium": prem_sc, "oi_break": oi_sc, "fires": fires_sc,
            "tier": tier_w, "moneyness": moneyness_sc, "multi_alert": multi_sc,
        }
        a["grade_score"] = round(composite, 2)
        a["grade"] = _grade_from_score(composite)
        a["grade_level"] = GRADE_LEVEL[a["grade"]]
    return alerts


def _gate(alerts: list[dict], min_grade: str) -> tuple[list[dict], list[dict]]:
    """Returns (would_post, gated_out)."""
    threshold = GRADE_LEVEL.get(min_grade, GRADE_LEVEL["B"])
    would_post = [a for a in alerts if a["grade_level"] >= threshold]
    gated_out = [a for a in alerts if a["grade_level"] < threshold]
    return would_post, gated_out


# ─────────────────────────────────────────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/configs")
async def get_live_configs():
    """
    Fetch the 10 saved Bullflow custom alerts. Lazy import the MCP probe so
    this module stays loadable even if the MCP probe has issues.
    """
    try:
        from api import bullflow_mcp_probe as probe
    except Exception as e:
        raise HTTPException(500, f"Could not import bullflow_mcp_probe: {e}")

    # Two well-known accessor function names; try both in order
    for fn_name in ("get_custom_alerts", "fetch_custom_alerts", "list_custom_alerts"):
        fn = getattr(probe, fn_name, None)
        if callable(fn):
            try:
                data = fn() if not _is_coro(fn) else await fn()
                return JSONResponse(_extract_alerts(data))
            except Exception as e:
                log.exception("MCP probe %s failed", fn_name)
                continue

    # Last resort: call the existing admin endpoint via HTTP loopback would be silly.
    # Instead surface a clear error so caller can paste configs manually.
    raise HTTPException(
        500,
        "Could not fetch live configs from MCP. Paste configs manually into "
        "the form, or hit /api/admin/bullflow/custom in another tab and copy.",
    )


def _is_coro(fn):
    import inspect
    return inspect.iscoroutinefunction(fn)


def _extract_alerts(payload: Any) -> dict:
    """Unwrap the MCP response shape -> {alerts: [...], count: N}."""
    if not isinstance(payload, dict):
        return {"alerts": [], "count": 0, "raw": payload}
    # Try common nested shapes
    if "alerts" in payload and isinstance(payload["alerts"], list):
        return {"alerts": payload["alerts"], "count": len(payload["alerts"])}
    if "data" in payload and isinstance(payload["data"], dict):
        d = payload["data"]
        if "alerts" in d and isinstance(d["alerts"], list):
            return {"alerts": d["alerts"], "count": len(d["alerts"])}
    return {"alerts": [], "count": 0, "raw": payload}


@router.post("/simulate")
async def simulate(
    csv_file: UploadFile = File(...),
    alert_config: str = Form(...),
    min_discord_grade: str = Form("B"),
    dedup_window_sec: int = Form(60),
    repeat_window_sec: int = Form(300),
):
    """
    Run the full UCT pipeline against an uploaded Bullflow CSV with the given
    alert_config (JSON string from the editable form).

    Returns a structured result with:
      - summary counters at each pipeline stage
      - tier breakdown (A+/A/B+/B/C/D)
      - top 25 would-post alerts (Discord-bound)
      - top 25 gated-out alerts (close to making it)
      - top tickers by premium
      - drop reasons (which Bullflow filters cut the most trades)
    """
    # Parse config JSON
    try:
        cfg = json.loads(alert_config)
    except Exception as e:
        raise HTTPException(400, f"alert_config is not valid JSON: {e}")
    if not isinstance(cfg, dict):
        raise HTTPException(400, "alert_config must be a JSON object")

    alert_name = cfg.get("alertName", "Custom Alert")

    # Read CSV
    raw = await csv_file.read()
    if not raw:
        raise HTTPException(400, "Empty CSV upload")
    if len(raw) > 50 * 1024 * 1024:
        raise HTTPException(400, "CSV too large (>50MB)")

    rows, warnings = _parse_csv(raw)
    csv_total = len(rows)

    # Stage 1: Bullflow filter
    matched, drop_reasons = _apply_bullflow_filter(rows, cfg)

    # Stage 2: Normalize
    alerts = _normalize(matched, alert_name)

    # Stage 3: Dedup
    deduped, dedup_dropped = _dedup(alerts, dedup_window_sec)

    # Stage 4: Aggregate repeats
    aggregated = _aggregate_repeats(deduped, repeat_window_sec)

    # Stage 5: Grade
    graded = _grade_all(aggregated, alert_name)

    # Stage 6: Gate
    would_post, gated_out = _gate(graded, min_discord_grade)

    # ── Build summary stats ──
    tier_breakdown = Counter(a["grade"] for a in graded)
    tier_breakdown_sorted = {
        g: tier_breakdown.get(g, 0)
        for g in ["A+", "A", "B+", "B", "C", "D"]
    }

    # Top tickers by total premium (post-grade)
    ticker_prem: defaultdict = defaultdict(lambda: {"hits": 0, "premium": 0.0, "would_post": 0, "best_grade_level": -1, "best_grade": "—"})
    for a in graded:
        t = ticker_prem[a["ticker"]]
        t["hits"] += 1
        t["premium"] += a["premium"]
        if a["grade_level"] >= GRADE_LEVEL.get(min_discord_grade, 2):
            t["would_post"] += 1
        if a["grade_level"] > t["best_grade_level"]:
            t["best_grade_level"] = a["grade_level"]
            t["best_grade"] = a["grade"]
    top_tickers = sorted(
        [{"ticker": k, **v} for k, v in ticker_prem.items()],
        key=lambda x: x["premium"],
        reverse=True,
    )[:20]
    for t in top_tickers:
        t.pop("best_grade_level", None)  # internal only

    # Sample alerts for inspection
    would_post_sorted = sorted(would_post, key=lambda a: (a["grade_level"], a["premium"]), reverse=True)
    gated_out_sorted = sorted(gated_out, key=lambda a: (a["grade_level"], a["premium"]), reverse=True)

    return {
        "alert_name": alert_name,
        "csv_total_rows": csv_total,
        "warnings": warnings,
        "stages": {
            "1_csv_parsed":             csv_total,
            "2_bullflow_matched":       len(matched),
            "3_normalized":             len(alerts),
            "4_after_dedup":            len(deduped),
            "5_graded":                 len(graded),
            "6_would_post_to_discord":  len(would_post),
        },
        "drop_reasons": drop_reasons,
        "dedup_dropped": dedup_dropped,
        "tier_breakdown": tier_breakdown_sorted,
        "min_discord_grade": min_discord_grade,
        "top_tickers": top_tickers,
        "would_post_sample": would_post_sorted[:25],
        "gated_out_sample": gated_out_sorted[:25],
        "config_used": cfg,
        "_NEVER_POSTED_TO_DISCORD": True,
    }
