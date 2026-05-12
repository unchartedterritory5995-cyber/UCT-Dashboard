"""
Causal model service — structured reference for what moves stocks.

Loaded from api/data/voice_kb/causal_model.json. Exposes three lookup
functions used by voice tools:

  - get_sector_rotation_state(regime?) — which sectors should be leading
    given the current (or specified) regime
  - classify_catalyst(text) — which catalyst pattern matches a headline
  - get_time_of_day_pattern(time_str?) — what behavior to expect at this
    time (or now)

This is reference data, not predictive — it tells the model the typical
playbook so it can reason about WHY, not just observe THAT.
"""

import json
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

_log = logging.getLogger(__name__)

_PATH = Path(__file__).parent.parent / "data" / "voice_kb" / "causal_model.json"

_CACHE: dict[str, Any] | None = None


def _load() -> dict:
    """Lazy-load and cache the JSON corpus."""
    global _CACHE
    if _CACHE is not None:
        return _CACHE
    if not _PATH.exists():
        _CACHE = {}
        return _CACHE
    try:
        with open(_PATH, "r", encoding="utf-8") as f:
            _CACHE = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        _log.warning("[causal_model] failed to load: %s", e)
        _CACHE = {}
    return _CACHE


# Map regime label → rotation stage. Bridge between voice_regime_classifier
# output and the rotation playbook.
_REGIME_TO_STAGE = {
    "bull_trend": "mid_bull",  # default; gets refined by breadth context
    "bull_correction": "mid_bull",
    "distribution": "late_bull",
    "chop": "late_bull",
    "bear_trend": "bear",
}


def get_sector_rotation_state(regime: str | None = None) -> dict:
    """
    Return the expected sector rotation given a regime.
    If regime is omitted, uses the live classifier output.
    """
    if not regime:
        try:
            from api.services.voice_regime_classifier import get_current_regime
            r = get_current_regime()
            regime = r.get("regime")
        except Exception:
            regime = "chop"

    stage_key = _REGIME_TO_STAGE.get(regime, "mid_bull")
    data = _load().get("sector_rotation", {}) or {}
    stage = (data.get("stages") or {}).get(stage_key) or {}
    if not stage:
        return {"ok": False, "regime": regime, "stage": stage_key,
                "narration": "Sector rotation data unavailable."}

    leading = stage.get("leading", [])
    lagging = stage.get("lagging", [])
    narration_parts = [f"In {stage_key.replace('_', ' ')} stage ({regime}):"]
    if leading:
        narration_parts.append(f"leading: {', '.join(leading[:5])}")
    if lagging:
        narration_parts.append(f"lagging: {', '.join(lagging[:3])}")
    return {
        "ok": True,
        "regime": regime,
        "stage": stage_key,
        "description": stage.get("description"),
        "leading": leading,
        "lagging": lagging,
        "narration": ". ".join(narration_parts) + ".",
    }


def classify_catalyst(text: str) -> dict:
    """
    Given a news headline or description, return the best-matching catalyst
    from the taxonomy along with its typical move + persistence.

    Match is keyword-based (lowercase substring). For ambiguous text,
    returns the strongest-scoring match.
    """
    q = (text or "").lower().strip()
    if not q:
        return {"ok": False, "narration": "Give me a headline or description."}

    catalysts = (_load().get("catalyst_taxonomy", {}) or {}).get("catalysts", [])
    best: dict | None = None
    best_score = 0
    for c in catalysts:
        score = 0
        for pat in c.get("patterns", []):
            p = (pat or "").lower()
            if not p:
                continue
            if p in q:
                # Score by length of matched pattern (longer = more specific)
                score = max(score, len(p))
        if score > best_score:
            best = c
            best_score = score

    if not best:
        return {
            "ok": True,
            "matched": False,
            "narration": f"No catalyst pattern matches {text!r}. Could be idiosyncratic; treat with normal risk rules.",
        }

    low, high = best.get("typical_move_pct", [0, 0])
    direction = "up" if (low + high) / 2 >= 0 else "down"
    return {
        "ok": True,
        "matched": True,
        "id": best.get("id"),
        "title": best.get("title"),
        "typical_move_low_pct": low,
        "typical_move_high_pct": high,
        "persistence_days": best.get("persistence_days"),
        "notes": best.get("notes"),
        "narration": (
            f"{best.get('title')}: typical move {direction} "
            f"{abs(low)}-{abs(high)}%, persists ~{best.get('persistence_days')} days. "
            f"{best.get('notes', '')}"
        )[:600],
    }


def get_time_of_day_pattern(now: datetime | None = None) -> dict:
    """
    Return the behavior pattern for the current (or specified) time. now
    is interpreted in US/Eastern. Caller should pass a real datetime if
    they have one; otherwise we use server time + a fixed UTC-to-ET offset
    (5h or 4h depending on DST — we use UTC-4 for simplicity in non-DST
    months and UTC-5 in winter; the patterns aren't minute-sensitive).
    """
    if now is None:
        # Naive ET approximation. Markets care about the bucket, not the second.
        utc = datetime.now(timezone.utc)
        # March-October roughly UTC-4 (EDT); else UTC-5 (EST)
        et_offset = -4 if 3 <= utc.month <= 10 else -5
        now = utc + timedelta(hours=et_offset)

    minute_of_day = now.hour * 60 + now.minute
    # Window in JSON is described in plain text; we map manually
    buckets = [
        ((9 * 60 + 30, 10 * 60), 0),       # 09:30-10:00 → opening drive
        ((10 * 60, 11 * 60 + 30), 1),      # 10:00-11:30
        ((11 * 60 + 30, 14 * 60), 2),      # 11:30-14:00
        ((14 * 60, 15 * 60 + 30), 3),      # 14:00-15:30
        ((15 * 60 + 30, 16 * 60), 4),      # 15:30-16:00
        ((16 * 60, 20 * 60), 5),           # 16:00-20:00
    ]
    pattern_idx = None
    for (start, end), idx in buckets:
        if start <= minute_of_day < end:
            pattern_idx = idx
            break

    if pattern_idx is None:
        return {
            "ok": True,
            "window": "outside cash + AH session",
            "label": "Closed",
            "behavior": "Markets are closed. Wait for the next open.",
            "narration": "Markets closed.",
            "weekday": now.weekday(),
        }

    patterns = (_load().get("time_of_day", {}) or {}).get("patterns", [])
    if pattern_idx >= len(patterns):
        return {"ok": False, "narration": "Time-of-day data unavailable."}

    p = patterns[pattern_idx]
    return {
        "ok": True,
        "window": p.get("window"),
        "label": p.get("label"),
        "behavior": p.get("behavior"),
        "narration": f"{p.get('label')} ({p.get('window')}): {p.get('behavior')}",
        "et_hour": now.hour,
        "et_minute": now.minute,
    }
