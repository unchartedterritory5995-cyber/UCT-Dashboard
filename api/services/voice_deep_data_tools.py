"""
Voice deep data tools — Polish P9.

Bridges five existing dashboard data services to voice that previously had
no programmatic path:

  - get_bar_summary       → bars_sqlite recent OHLC stats
  - get_pattern_detection → pattern_engine.memory active detections
  - get_trade_detail      → journal_two single-trade attribution
  - get_recent_alerts     → alerts.get_alerts last fired alerts
  - get_breadth_history   → breadth_monitor metric time series

Every tool returns a {ok, narration, ...} envelope matching the existing
voice tool convention. Each one normalizes to compact, voice-friendly
output (never raw rows) so the model speaks numbers, not blobs.
"""

import logging
from typing import Any

_log = logging.getLogger(__name__)


_TF_ALIASES = {
    "1d": "D", "d": "D", "daily": "D", "day": "D",
    "1w": "W", "w": "W", "weekly": "W", "week": "W",
    "1m": "M", "m": "M", "monthly": "M", "month": "M",
    "5min": "5", "5m": "5", "5": "5",
    "15min": "15", "15m": "15", "15": "15",
    "30min": "30", "30m": "30", "30": "30",
    "1hr": "60", "60min": "60", "60m": "60", "1h": "60", "60": "60",
}


def _norm_tf(tf: str | None, default: str = "D") -> str:
    if not tf:
        return default
    k = str(tf).strip().lower()
    return _TF_ALIASES.get(k, default)


def _fmt_pct(v) -> str:
    if v is None:
        return "n/a"
    try:
        return f"{float(v):+.2f}%"
    except (TypeError, ValueError):
        return "n/a"


def _fmt_money(v) -> str:
    if v is None:
        return "n/a"
    try:
        f = float(v)
    except (TypeError, ValueError):
        return "n/a"
    if abs(f) >= 1_000_000:
        return f"${f/1_000_000:.2f}M"
    if abs(f) >= 1_000:
        return f"${f/1_000:.1f}K"
    return f"${f:,.2f}"


# ── 1. Bar summary ─────────────────────────────────────────────────────────

def get_bar_summary(*, symbol: str, timeframe: str | None = None,
                    lookback: int = 20) -> dict:
    """Recent OHLC stats from the local bars cache. No API call."""
    sym = (symbol or "").strip().upper()
    if not sym:
        return {"ok": False, "narration": "Need a ticker symbol.",
                "error": "missing_symbol"}
    tf = _norm_tf(timeframe, default="D")
    n = max(2, min(250, int(lookback or 20)))

    try:
        from api.services import bars_sqlite
        rows = bars_sqlite.get_bars(sym, tf, n)
    except Exception as e:
        _log.warning("[deep_data] get_bars failed for %s: %s", sym, e)
        return {"ok": False, "narration": f"Couldn't load bars for {sym}.",
                "error": "bars_fetch_failed"}

    if not rows or len(rows) < 2:
        return {"ok": False,
                "narration": f"No cached bars for {sym} on {tf} timeframe.",
                "symbol": sym, "timeframe": tf, "bar_count": len(rows or [])}

    closes = [r[4] for r in rows if r[4] is not None]
    highs = [r[2] for r in rows if r[2] is not None]
    lows = [r[3] for r in rows if r[3] is not None]
    vols = [r[5] for r in rows if r[5] is not None]

    last = rows[-1]
    prev = rows[-2]
    last_close = last[4]
    prev_close = prev[4]
    chg_pct = ((last_close - prev_close) / prev_close * 100.0
               if prev_close else None)

    window_high = max(highs) if highs else None
    window_low = min(lows) if lows else None
    pct_off_high = ((last_close - window_high) / window_high * 100.0
                    if window_high else None)
    avg_vol = (sum(vols) / len(vols)) if vols else None
    last_vol = last[5]
    vol_vs_avg = ((last_vol / avg_vol) if avg_vol else None)

    # Simple SMA
    sma_n = closes[-min(20, len(closes)):]
    sma20 = sum(sma_n) / len(sma_n) if sma_n else None
    above_sma = bool(sma20 and last_close > sma20)

    narration = (
        f"{sym} on {tf}: last close {last_close:.2f}, {_fmt_pct(chg_pct)} "
        f"day-over-day. {n}-bar range "
        f"{(window_low or 0):.2f}–{(window_high or 0):.2f}, "
        f"{_fmt_pct(pct_off_high)} off the high. "
        f"{'Above' if above_sma else 'Below'} 20-bar SMA "
        f"({(sma20 or 0):.2f})."
    )

    return {
        "ok": True,
        "narration": narration,
        "symbol": sym,
        "timeframe": tf,
        "bar_count": len(rows),
        "last_close": round(last_close, 4),
        "prev_close": round(prev_close, 4) if prev_close else None,
        "change_pct": round(chg_pct, 2) if chg_pct is not None else None,
        "window_high": round(window_high, 4) if window_high else None,
        "window_low": round(window_low, 4) if window_low else None,
        "pct_off_high": round(pct_off_high, 2) if pct_off_high is not None else None,
        "avg_volume": int(avg_vol) if avg_vol else None,
        "last_volume": int(last_vol) if last_vol else None,
        "vol_vs_avg": round(vol_vs_avg, 2) if vol_vs_avg is not None else None,
        "sma_20": round(sma20, 4) if sma20 else None,
        "above_sma_20": above_sma,
    }


# ── 2. Pattern detection ───────────────────────────────────────────────────

def get_pattern_detection(*, symbol: str, timeframe: str | None = None,
                          min_confidence: float = 50.0,
                          count: int = 5) -> dict:
    """Active pattern detections for a symbol on a timeframe."""
    sym = (symbol or "").strip().upper()
    if not sym:
        return {"ok": False, "narration": "Need a ticker symbol.",
                "error": "missing_symbol"}
    tf = _norm_tf(timeframe, default="D")
    try:
        min_conf = max(0.0, min(100.0, float(min_confidence)))
    except (TypeError, ValueError):
        min_conf = 50.0
    n = max(1, min(10, int(count or 5)))

    try:
        from api.services.pattern_engine import memory as pattern_memory
        # Ensure detector registration via router import side-effects
        try:
            import api.routers.patterns  # noqa: F401
        except Exception:
            pass
        rows = pattern_memory.get_active_detections(sym, tf, min_conf=min_conf)
    except Exception as e:
        _log.warning("[deep_data] pattern detect failed %s: %s", sym, e)
        return {"ok": False,
                "narration": f"Pattern engine unavailable for {sym}.",
                "error": "pattern_engine_failed"}

    rows = rows or []
    if not rows:
        return {
            "ok": True,
            "narration": (
                f"No active patterns on {sym} {tf} above "
                f"{int(min_conf)}% confidence."
            ),
            "symbol": sym, "timeframe": tf,
            "pattern_count": 0,
            "patterns": [],
        }

    top = rows[:n]
    short = [{
        "pattern_id": r.get("pattern_id"),
        "direction": r.get("direction"),
        "confidence": round(float(r.get("confidence") or 0), 1),
        "status": r.get("status"),
        "detected_at": r.get("detected_at"),
    } for r in top]

    head = top[0]
    name = head.get("pattern_id", "pattern").replace("_", " ")
    head_conf = round(float(head.get("confidence") or 0), 0)
    narration = (
        f"{sym} {tf}: {len(rows)} active pattern"
        f"{'s' if len(rows) != 1 else ''}. "
        f"Top hit — {name} at {int(head_conf)}% confidence "
        f"({head.get('direction', '?')})."
    )

    return {
        "ok": True,
        "narration": narration,
        "symbol": sym,
        "timeframe": tf,
        "pattern_count": len(rows),
        "patterns": short,
    }


# ── 3. Trade detail (Journal 2.0) ──────────────────────────────────────────

def _coerce_trade_id(value: Any) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def get_trade_detail(*, trade_id: str | int | None = None,
                     symbol: str | None = None,
                     user: dict | None = None) -> dict:
    """Single closed trade with full attribution — pnl, R, hold, mistakes.

    Accepts either a trade_id OR a symbol (returns the most recent trade
    for that symbol). user kwarg supplied by dispatcher.
    """
    user = user or {}
    uid = user.get("id")
    if not uid:
        return {"ok": False, "narration": "Not signed in.",
                "error": "no_user"}

    try:
        from api.services.journal_two.trades import list_trades_for_user
    except Exception as e:
        _log.warning("[deep_data] journal_two import failed: %s", e)
        return {"ok": False, "narration": "Journal unavailable.",
                "error": "journal_unavailable"}

    try:
        trades = list_trades_for_user(uid) or []
    except Exception as e:
        _log.warning("[deep_data] list_trades_for_user failed: %s", e)
        return {"ok": False, "narration": "Couldn't load your trades.",
                "error": "trade_fetch_failed"}

    target = None
    tid = _coerce_trade_id(trade_id)
    if tid:
        for t in trades:
            if str(t.get("id")) == tid:
                target = t
                break
    elif symbol:
        sym_u = symbol.strip().upper()
        for t in trades:
            if (t.get("symbol") or "").upper() == sym_u:
                target = t
                break

    if not target:
        if tid:
            msg = f"No trade with id {tid}."
        elif symbol:
            msg = f"No trade found for {symbol.upper()}."
        else:
            msg = "Need a trade_id or symbol."
        return {"ok": False, "narration": msg, "error": "trade_not_found"}

    sym = target.get("symbol", "?")
    side = target.get("side", "?")
    shares = target.get("shares")
    entry = target.get("entry_price")
    exitp = target.get("exit_price")
    pnl_dollar = target.get("pnl_dollar")
    pnl_pct = target.get("pnl_percent")
    r_mult = target.get("r_multiple")
    hold_days = target.get("hold_days")
    setup = target.get("setup")
    result = target.get("result")
    mistakes = target.get("mistake_tags") or []
    emotions = target.get("emotion_tags") or []

    bits = [f"{sym} {side or ''} {shares or '?'} shares"]
    if entry is not None:
        bits.append(f"entry {entry:.2f}")
    if exitp is not None:
        bits.append(f"exit {exitp:.2f}")
    if pnl_dollar is not None:
        bits.append(f"P&L {_fmt_money(pnl_dollar)}")
    if r_mult is not None:
        bits.append(f"R {r_mult:+.2f}")
    if hold_days is not None:
        bits.append(f"held {hold_days}d")
    if setup:
        bits.append(f"setup {setup}")
    if result:
        bits.append(f"result {result}")
    if mistakes:
        bits.append("mistakes: " + ", ".join(mistakes[:3]))

    narration = " · ".join(bits) + "."

    return {
        "ok": True,
        "narration": narration,
        "trade_id": target.get("id"),
        "symbol": sym,
        "side": side,
        "shares": shares,
        "entry_price": entry,
        "exit_price": exitp,
        "entry_date": target.get("entry_date"),
        "exit_date": target.get("exit_date"),
        "original_stop": target.get("original_stop"),
        "pnl_dollar": pnl_dollar,
        "pnl_percent": pnl_pct,
        "r_multiple": r_mult,
        "hold_days": hold_days,
        "setup": setup,
        "result": result,
        "mistake_tags": mistakes,
        "emotion_tags": emotions,
        "notes": (target.get("notes") or "")[:300],
        "account_id": target.get("account_id"),
    }


# ── 4. Recent alerts ───────────────────────────────────────────────────────

def get_recent_alerts(*, count: int = 5,
                      severity: str | None = None) -> dict:
    """Recently fired in-app alerts (regime, scanner, stop, etc.)."""
    n = max(1, min(20, int(count or 5)))
    sev_filter = (severity or "").strip().lower() or None

    try:
        from api.services.alerts import get_alerts
        rows = get_alerts(limit=50) or []
    except Exception as e:
        _log.warning("[deep_data] get_alerts failed: %s", e)
        return {"ok": False, "narration": "Alert feed unavailable.",
                "error": "alerts_unavailable"}

    if sev_filter:
        rows = [a for a in rows if (a.get("severity") or "").lower() == sev_filter]

    rows = rows[:n]

    if not rows:
        msg = (f"No {sev_filter} alerts recently."
               if sev_filter else "No recent alerts.")
        return {"ok": True, "narration": msg, "alerts": []}

    short = [{
        "id": a.get("id"),
        "type": a.get("type"),
        "severity": a.get("severity"),
        "title": a.get("title"),
        "message": (a.get("message") or "")[:200],
        "timestamp": a.get("timestamp"),
        "read": bool(a.get("read")),
    } for a in rows]

    head = rows[0]
    narration = (
        f"{len(rows)} recent alert{'s' if len(rows) != 1 else ''}. "
        f"Latest: {head.get('title', 'untitled')} — "
        f"{head.get('severity', 'info')}."
    )

    return {
        "ok": True,
        "narration": narration,
        "alerts": short,
        "alert_count": len(short),
    }


# ── 5. Breadth metric history ──────────────────────────────────────────────

_BREADTH_METRIC_ALIASES = {
    "breadth": "breadth_score", "score": "breadth_score",
    "exposure": "uct_exposure",
    "above 5": "pct_above_5sma", "above 5ma": "pct_above_5sma",
    "above 10": "pct_above_10sma", "above 20": "pct_above_20ema",
    "above 40": "pct_above_40sma", "above 50": "pct_above_50sma",
    "above 100": "pct_above_100sma", "above 200": "pct_above_200sma",
    "vix": "vix",
    "new highs": "new_52w_highs", "new lows": "new_52w_lows",
    "spy": "sp500_close", "qqq": "qqq_close",
    "advancing": "advancing", "declining": "declining",
    "putcall": "cboe_putcall", "put call": "cboe_putcall",
}


def _resolve_metric_key(name: str) -> str:
    k = (name or "").strip().lower()
    if not k:
        return ""
    if k in _BREADTH_METRIC_ALIASES:
        return _BREADTH_METRIC_ALIASES[k]
    # Fall back to the user-supplied key if it looks like a column
    return k.replace(" ", "_")


def get_breadth_history(*, metric: str, days: int = 30) -> dict:
    """Time series for a single breadth metric over N days."""
    key = _resolve_metric_key(metric)
    if not key:
        return {"ok": False, "narration": "Need a metric name.",
                "error": "missing_metric"}
    n = max(2, min(365, int(days or 30)))

    try:
        from api.services.breadth_monitor import get_history
        rows = get_history(days=n) or []
    except Exception as e:
        _log.warning("[deep_data] get_history failed: %s", e)
        return {"ok": False, "narration": "Breadth history unavailable.",
                "error": "history_unavailable"}

    if not rows:
        return {"ok": True,
                "narration": f"No breadth history for the last {n} days.",
                "metric": key, "days": n, "series": []}

    # rows are newest-first; build a (date, value) series for the metric
    series: list[dict] = []
    for r in rows:
        v = r.get(key)
        if v is None:
            continue
        series.append({"date": r.get("date"), "value": v})
    if not series:
        # Hint to caller about available keys
        sample = [k for k in rows[0].keys() if not k.startswith("_")][:30]
        return {"ok": False,
                "narration": (
                    f"Metric '{key}' isn't tracked. "
                    f"Try one of these instead."
                ),
                "error": "unknown_metric",
                "metric": key,
                "available_metrics_sample": sample}

    latest = series[0]
    oldest = series[-1]
    vals = [s["value"] for s in series if isinstance(s["value"], (int, float))]
    if not vals:
        avg = mx = mn = None
    else:
        avg = sum(vals) / len(vals)
        mx = max(vals)
        mn = min(vals)

    delta = None
    try:
        if (isinstance(latest["value"], (int, float))
                and isinstance(oldest["value"], (int, float))):
            delta = float(latest["value"]) - float(oldest["value"])
    except Exception:
        delta = None

    narration_bits = [
        f"{key}: latest {latest['value']} on {latest['date']}"
    ]
    if delta is not None:
        narration_bits.append(f"change {delta:+.2f} vs {oldest['date']}")
    if avg is not None:
        narration_bits.append(f"avg {avg:.2f}")
    if mx is not None and mn is not None:
        narration_bits.append(f"range {mn:.2f}–{mx:.2f}")

    return {
        "ok": True,
        "narration": " · ".join(narration_bits) + ".",
        "metric": key,
        "days": n,
        "count": len(series),
        "latest_date": latest["date"],
        "latest_value": latest["value"],
        "oldest_date": oldest["date"],
        "oldest_value": oldest["value"],
        "delta": round(delta, 4) if delta is not None else None,
        "avg": round(avg, 4) if avg is not None else None,
        "max": mx,
        "min": mn,
        "series": series[:60],  # cap to keep response compact
    }
