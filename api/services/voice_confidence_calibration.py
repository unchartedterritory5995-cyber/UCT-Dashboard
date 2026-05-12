"""
Confidence calibration — Batch 13f.

Two pieces:

1. A system-prompt block that instructs the model to express confidence
   quantitatively whenever it makes a recommendation. Injected at
   session_token mint alongside the other context blocks.

2. A signals snapshot — computed at mint time — telling the model what
   reduces confidence in this specific session:
     - stale data (wire is N days old)
     - thin user history (few trades to anchor a setup judgment)
     - low-confidence regime classification (<35%)
     - active drift warnings (user's behavior is degrading)
     - low recent thumbs score (the model has been wrong lately)

The prompt then asks the model to factor these into every recommendation.
"""

import logging
from typing import Any

_log = logging.getLogger(__name__)


_CONFIDENCE_RULES = """CONFIDENCE CALIBRATION (apply to every recommendation):
- ALWAYS state confidence as a percentage when recommending a trade,
  setup, or strategy: "65% confident — based on 12 prior flag breakouts
  in similar regimes" beats "looks good".
- Confidence buckets: <40% = "low — I'd skip", 40-60% = "moderate",
  60-80% = "high", 80%+ = "very high".
- DECREASE confidence by 10-20pp when ANY of these are present:
  * Data is stale (see TEMPORAL CONTEXT)
  * User has <5 prior trades on this setup
  * Regime classification is <50% confident
  * Active drift warning (user is degrading)
  * Recent thumbs feedback shows you've been wrong lately
- NEVER fabricate confidence. If you don't have a base rate to anchor
  on, say so: "I don't have enough of your trades on this setup to
  calibrate — call it 50%, treat as a learning rep."
"""


def _signal_snapshot(user_id: str) -> dict[str, Any]:
    """Compute the current confidence-reducing signals for a user."""
    signals: dict[str, Any] = {
        "stale_data": False,
        "regime_low_confidence": False,
        "active_drift": False,
        "recent_negative_feedback": False,
    }

    # Data freshness
    try:
        from api.services.voice_temporal_awareness import _data_freshness
        f = _data_freshness()
        if not f.get("is_fresh"):
            signals["stale_data"] = True
            signals["stale_data_label"] = f.get("label")
    except Exception:
        pass

    # Regime confidence
    try:
        from api.services.voice_regime_classifier import get_current_regime
        r = get_current_regime()
        if (r.get("confidence") or 0) < 0.35:
            signals["regime_low_confidence"] = True
            signals["regime_confidence"] = r.get("confidence")
    except Exception:
        pass

    # Active drift warnings (pending insights of kind=drift_warning)
    try:
        from api.services.voice_proactive_service import list_pending_insights
        pending = list_pending_insights(user_id, limit=10)
        drift = [p for p in pending if p.get("kind") == "drift_warning"]
        if drift:
            signals["active_drift"] = True
            signals["drift_count"] = len(drift)
    except Exception:
        pass

    # Recent feedback — are we below 60% thumbs-up over last 14 days?
    try:
        from api.services.voice_reward_model import variant_scoreboard
        rows = variant_scoreboard(user_id, days=14)
        total_up = sum(r.get("thumbs_up") or 0 for r in rows)
        total_dn = sum(r.get("thumbs_down") or 0 for r in rows)
        total = total_up + total_dn
        if total >= 5:
            ratio = total_up / total
            if ratio < 0.60:
                signals["recent_negative_feedback"] = True
                signals["recent_thumbs_ratio"] = round(ratio, 2)
    except Exception:
        pass

    return signals


def build_confidence_block(user_id: str) -> str:
    """
    Compose the confidence-calibration prompt block.
    Returns "" if no signals are present (rules apply but no caveats).
    """
    snapshot = _signal_snapshot(user_id)
    caveats: list[str] = []

    if snapshot.get("stale_data"):
        caveats.append(
            f"⚠ Data is stale ({snapshot.get('stale_data_label')}) — "
            "deduct 10pp+ from any setup recommendation."
        )
    if snapshot.get("regime_low_confidence"):
        conf = int((snapshot.get("regime_confidence") or 0) * 100)
        caveats.append(
            f"⚠ Regime classification is only {conf}% confident — "
            "be skeptical of regime-dependent recommendations."
        )
    if snapshot.get("active_drift"):
        caveats.append(
            f"⚠ User has {snapshot.get('drift_count')} active drift "
            "warnings — flag this when recommending more aggressive "
            "trades."
        )
    if snapshot.get("recent_negative_feedback"):
        ratio = int((snapshot.get("recent_thumbs_ratio") or 0) * 100)
        caveats.append(
            f"⚠ Your recent thumbs-up rate is {ratio}% (below 60%) — "
            "you may be over-confident lately. Add 10pp humility."
        )

    block = _CONFIDENCE_RULES
    if caveats:
        block += "\n\nCURRENT-SESSION CAVEATS:\n" + "\n".join(f"  {c}" for c in caveats)
    return block
