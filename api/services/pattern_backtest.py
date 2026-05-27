"""Pattern-engine backtest — run a named pattern detector across a single
ticker's history with simple entry/exit rules, return aggregate stats.

v1 scope: single ticker, daily timeframe, 1-year lookback default. Universe-
wide backtest is a Phase 4 build (compute heavy).

Entry rule: at each pattern-detection bar, simulate buying at next-bar open.
Exit rule: hold until target_r OR stop hit, max hold N bars.
"""

import logging
from typing import Any

_log = logging.getLogger(__name__)


def backtest_pattern_on_ticker(
    ticker: str,
    pattern_id: str,
    *,
    days: int = 365,
    target_r: float = 3.0,
    stop_r: float = 1.0,
    max_hold_bars: int = 20,
    min_confidence: float = 60.0,
) -> dict[str, Any]:
    """Walk-forward simulate a pattern detector's signals on one ticker."""
    sym = (ticker or "").upper().strip()
    pid = (pattern_id or "").strip()
    if not sym or not pid:
        return {"error": "ticker and pattern_id required"}

    # Pull bars
    try:
        from api.services.bars_fetch import get_bars
        bars = get_bars(sym, tf="D", bars=max(60, min(2500, int(days or 365))))
    except Exception as e:
        _log.warning("backtest bars fetch failed for %s: %s", sym, e)
        return {"error": f"bars unavailable: {e}", "ticker": sym}

    if not bars or len(bars) < 30:
        return {"error": "insufficient bars", "bars_available": len(bars or [])}

    # Look up the detector
    try:
        from api.routers.patterns import _ensure_pattern_detectors_loaded
        from api.services.pattern_engine.registry import get_detector
        _ensure_pattern_detectors_loaded()
        detector = get_detector(pid)
    except Exception as e:
        _log.warning("backtest detector load failed: %s", e)
        return {"error": f"detector lookup failed: {e}", "pattern_id": pid}
    if detector is None:
        return {"error": f"pattern_id '{pid}' not found"}

    # Walk-forward — for each bar index >= 30, slice up to that bar and ask
    # the detector if it fires. If yes (and conf >= threshold), simulate a
    # trade entering at next bar's open.
    trades = []
    i = 30
    while i < len(bars) - 1:
        window = bars[: i + 1]
        try:
            result = detector.detect(window)
        except Exception:
            i += 1
            continue

        # detector.detect returns dict or list-of-dicts (varies); normalize
        if isinstance(result, list):
            firings = result
        elif isinstance(result, dict) and result.get("detected"):
            firings = [result]
        else:
            firings = []

        fired = None
        for f in firings:
            conf = f.get("confidence") or f.get("score") or 0
            try:
                if float(conf) >= float(min_confidence):
                    fired = f
                    break
            except (TypeError, ValueError):
                continue

        if not fired:
            i += 1
            continue

        # Enter at next bar's open
        entry_bar = bars[i + 1]
        entry_price = float(entry_bar.get("o") or entry_bar.get("open") or 0)
        if entry_price <= 0:
            i += 1
            continue

        # Stop = entry - (entry × 1% × stop_r) for longs (default)
        # Use 2% ATR-equivalent risk per R as a simple proxy
        risk_per_share = entry_price * 0.02 * float(stop_r)
        target_per_share = entry_price * 0.02 * float(target_r)
        stop_price = entry_price - risk_per_share
        target_price = entry_price + target_per_share

        # Walk forward until target/stop/max_hold
        exit_price = None
        exit_bar_idx = None
        outcome = "expired"
        for j in range(i + 1, min(i + 1 + int(max_hold_bars), len(bars))):
            b = bars[j]
            high = float(b.get("h") or b.get("high") or entry_price)
            low = float(b.get("l") or b.get("low") or entry_price)
            if low <= stop_price:
                exit_price = stop_price
                exit_bar_idx = j
                outcome = "stop"
                break
            if high >= target_price:
                exit_price = target_price
                exit_bar_idx = j
                outcome = "target"
                break
        else:
            # Expired — exit at last bar's close
            last = bars[min(i + int(max_hold_bars), len(bars) - 1)]
            exit_price = float(last.get("c") or last.get("close") or entry_price)
            exit_bar_idx = min(i + int(max_hold_bars), len(bars) - 1)

        # Compute R
        r_multiple = (exit_price - entry_price) / risk_per_share if risk_per_share else 0
        trades.append({
            "entry_bar_idx": i + 1,
            "entry_price": round(entry_price, 2),
            "exit_price": round(exit_price, 2),
            "r_multiple": round(r_multiple, 2),
            "outcome": outcome,
            "hold_bars": (exit_bar_idx - (i + 1)) if exit_bar_idx else 0,
            "confidence": fired.get("confidence") or fired.get("score"),
        })

        # Skip forward past the trade to avoid overlapping signals
        i = (exit_bar_idx or i) + 1

    if not trades:
        return {
            "ticker": sym, "pattern_id": pid,
            "trade_count": 0, "message": "no qualifying signals in window",
        }

    wins = [t for t in trades if t["r_multiple"] > 0]
    losses = [t for t in trades if t["r_multiple"] <= 0]
    avg_r = sum(t["r_multiple"] for t in trades) / len(trades)
    win_rate = len(wins) / len(trades)
    gross_win = sum(t["r_multiple"] for t in wins)
    gross_loss = abs(sum(t["r_multiple"] for t in losses))
    profit_factor = gross_win / gross_loss if gross_loss > 0 else None

    return {
        "ticker": sym,
        "pattern_id": pid,
        "days_window": days,
        "trade_count": len(trades),
        "win_rate": round(win_rate, 3),
        "avg_r": round(avg_r, 2),
        "profit_factor": round(profit_factor, 2) if profit_factor else None,
        "wins": len(wins),
        "losses": len(losses),
        "target_r": target_r,
        "stop_r": stop_r,
        "max_hold_bars": max_hold_bars,
        "trades": trades[-20:],  # last 20 for inspection
    }
