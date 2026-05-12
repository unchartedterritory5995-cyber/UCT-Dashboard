"""
Live regime classifier — synthesizes breadth, VIX, McClellan, MA breadth
into one canonical regime label the voice assistant can reference.

Five regimes (matches the KB playbook entries):
  - bull_trend         strong breadth, low VIX, MAs rising, McClellan positive
  - bull_correction    decent breadth deteriorated, VIX 20-30, recovering
  - distribution       near highs but breadth diverging, MAs flattening
  - chop               range-bound, no clear trend, mixed signals
  - bear_trend         broken MAs, McClellan deeply negative, VIX elevated

Output also includes confidence (0-1) and the contributing signals so
the model can talk about WHY the regime is what it is.

Refreshes on every call via TTLCache (15min). Sources from engine.get_breadth
which is fed by the morning wire push.
"""

import logging
from typing import Any

_log = logging.getLogger(__name__)

REGIMES = ("bull_trend", "bull_correction", "distribution", "chop", "bear_trend")


def _to_float(v: Any) -> float | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).strip().replace("%", "").replace("+", ""))
    except (TypeError, ValueError):
        return None


def _fetch_signals() -> dict:
    """Pull current breadth + VIX. Returns a dict of named signals."""
    signals: dict = {}
    try:
        from api.services.engine import get_breadth
        b = get_breadth() or {}
    except Exception:
        b = {}
    signals["pct_above_50ma"] = _to_float(b.get("pct_above_50ma"))
    signals["pct_above_200ma"] = _to_float(b.get("pct_above_200ma"))
    signals["pct_above_5ma"] = _to_float(b.get("pct_above_5ma"))
    signals["new_highs"] = _to_float(b.get("new_highs"))
    signals["new_lows"] = _to_float(b.get("new_lows"))
    signals["breadth_score"] = _to_float(b.get("breadth_score"))
    signals["distribution_days"] = _to_float(b.get("distribution_days"))
    signals["market_phase"] = b.get("market_phase")
    signals["uct_exposure_rating"] = _to_float(b.get("uct_exposure_rating") or
                                                b.get("exposure_score"))

    # VIX from market snapshot
    try:
        from api.services.massive import get_ticker_snapshot
        vix = get_ticker_snapshot("VIX") or {}
        v = vix.get("close") or vix.get("price")
        signals["vix"] = _to_float(v)
    except Exception:
        signals["vix"] = None

    return signals


def _classify(signals: dict) -> tuple[str, float, list[str]]:
    """
    Score-based regime classifier. Returns (regime, confidence, reasons).

    Heuristic — each signal pushes votes toward regimes. The regime with
    the highest score wins; confidence is its share of total votes.
    """
    votes = {r: 0.0 for r in REGIMES}
    reasons: list[str] = []

    pct50 = signals.get("pct_above_50ma")
    pct200 = signals.get("pct_above_200ma")
    nh = signals.get("new_highs") or 0
    nl = signals.get("new_lows") or 0
    vix = signals.get("vix")
    score = signals.get("breadth_score")
    dist_days = signals.get("distribution_days") or 0
    exposure = signals.get("uct_exposure_rating")

    # ── % above 50-day MA ──
    if pct50 is not None:
        if pct50 >= 70:
            votes["bull_trend"] += 2.0
            reasons.append(f"{pct50:.0f}% above 50MA (broad participation)")
        elif pct50 >= 55:
            votes["bull_trend"] += 1.0
            votes["distribution"] += 0.5
            reasons.append(f"{pct50:.0f}% above 50MA (decent)")
        elif pct50 >= 40:
            votes["chop"] += 1.5
            votes["bull_correction"] += 1.0
            reasons.append(f"{pct50:.0f}% above 50MA (mixed)")
        elif pct50 >= 25:
            votes["bull_correction"] += 2.0
            votes["distribution"] += 1.0
            reasons.append(f"{pct50:.0f}% above 50MA (deteriorating)")
        else:
            votes["bear_trend"] += 2.5
            reasons.append(f"{pct50:.0f}% above 50MA (broken)")

    # ── % above 200-day MA ──
    if pct200 is not None:
        if pct200 >= 70:
            votes["bull_trend"] += 1.5
            reasons.append(f"{pct200:.0f}% above 200MA (long-term healthy)")
        elif pct200 >= 50:
            votes["bull_correction"] += 1.0
            votes["distribution"] += 0.5
        elif pct200 >= 30:
            votes["distribution"] += 1.0
            votes["chop"] += 1.0
            reasons.append(f"{pct200:.0f}% above 200MA (weakening)")
        else:
            votes["bear_trend"] += 2.0
            reasons.append(f"{pct200:.0f}% above 200MA (bearish)")

    # ── New highs vs new lows ──
    if nh or nl:
        if nh > nl * 3 and nh > 30:
            votes["bull_trend"] += 1.5
            reasons.append(f"{int(nh)} new highs vs {int(nl)} lows")
        elif nl > nh * 3 and nl > 30:
            votes["bear_trend"] += 1.5
            reasons.append(f"{int(nl)} new lows vs {int(nh)} highs")
        elif abs(nh - nl) < 10:
            votes["chop"] += 1.0
        if nh > nl and nh > 0 and pct50 is not None and pct50 < 50:
            # New highs but breadth weak = distribution
            votes["distribution"] += 1.5
            reasons.append("new highs persist but breadth narrow")

    # ── VIX ──
    if vix is not None:
        if vix < 14:
            votes["bull_trend"] += 1.0
            reasons.append(f"VIX {vix:.1f} (complacent)")
        elif vix < 18:
            votes["bull_trend"] += 0.5
            votes["distribution"] += 0.5
        elif vix < 25:
            votes["chop"] += 1.0
            votes["bull_correction"] += 0.5
            reasons.append(f"VIX {vix:.1f} (elevated)")
        elif vix < 35:
            votes["bull_correction"] += 1.5
            votes["bear_trend"] += 0.5
            reasons.append(f"VIX {vix:.1f} (stressed)")
        else:
            votes["bear_trend"] += 2.0
            reasons.append(f"VIX {vix:.1f} (fear)")

    # ── Distribution days ──
    if dist_days >= 5:
        votes["distribution"] += 2.0
        votes["bear_trend"] += 0.5
        reasons.append(f"{int(dist_days)} distribution days (heavy)")
    elif dist_days >= 3:
        votes["distribution"] += 1.0
        reasons.append(f"{int(dist_days)} distribution days")

    # ── UCT exposure rating (0-150) ──
    if exposure is not None:
        if exposure >= 100:
            votes["bull_trend"] += 1.0
        elif exposure >= 70:
            votes["bull_trend"] += 0.5
        elif exposure >= 40:
            votes["chop"] += 0.5
            votes["bull_correction"] += 0.5
        elif exposure >= 15:
            votes["bull_correction"] += 1.0
        else:
            votes["bear_trend"] += 1.5
        reasons.append(f"UCT exposure {int(exposure)}")

    # ── Breadth score (0-100 in the engine) ──
    if score is not None:
        if score >= 70:
            votes["bull_trend"] += 1.0
        elif score >= 50:
            votes["bull_correction"] += 0.5
        elif score >= 30:
            votes["chop"] += 0.5
        else:
            votes["bear_trend"] += 1.0

    # Pick winner
    total = sum(votes.values()) or 1.0
    winner = max(votes, key=votes.get)
    confidence = votes[winner] / total
    return winner, round(confidence, 3), reasons[:6]


# ── Public API ─────────────────────────────────────────────────────────────

_CACHE_KEY = "voice_regime_classification"
_TTL_SECONDS = 900  # 15 min


def get_current_regime(*, fresh: bool = False) -> dict:
    """
    Return {regime, confidence, reasons, signals, narration}.
    Cached for 15min; pass fresh=True to bypass.
    """
    from api.services.cache import cache
    if not fresh:
        cached = cache.get(_CACHE_KEY)
        if cached:
            return cached

    signals = _fetch_signals()
    regime, confidence, reasons = _classify(signals)

    # Human-readable narration
    pretty = {
        "bull_trend": "Bull trend",
        "bull_correction": "Bull correction",
        "distribution": "Distribution",
        "chop": "Chop",
        "bear_trend": "Bear trend",
    }[regime]
    conf_word = "high" if confidence >= 0.5 else "moderate" if confidence >= 0.3 else "low"
    narration_parts = [f"Regime: {pretty} ({conf_word} confidence)."]
    if reasons:
        narration_parts.append("Signals: " + "; ".join(reasons[:4]) + ".")
    narration = " ".join(narration_parts)

    out = {
        "regime": regime,
        "confidence": confidence,
        "reasons": reasons,
        "signals": signals,
        "narration": narration,
        "label": pretty,
    }
    try:
        cache.set(_CACHE_KEY, out, ttl=_TTL_SECONDS)
    except Exception:
        pass
    return out


def build_regime_prompt_line() -> str:
    """Compact one-liner the system prompt can inject at session start."""
    try:
        r = get_current_regime()
    except Exception:
        return ""
    return f"CURRENT MARKET REGIME: {r['label']} ({int(r['confidence'] * 100)}% confidence). {' '.join(r['reasons'][:3])}"
