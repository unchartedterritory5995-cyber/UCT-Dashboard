"""READ ONLY: the market regime classification this server already holds.

`voice_regime_classifier.get_current_regime()` RECOMPUTES on a cold cache: it reads breadth (which can go on to a
live fetch) and asks the market-data vendor for a VIX snapshot. A reader that must never start that work (the UCT
Agent's `market.regime` data kind, MD-1 §4.16) reads through `held_regime()` instead: the classification the
classifier last stored in the shared cache, or None. It never computes, never reads breadth and never calls a vendor.

It lives beside the classifier and not inside it because flow-worker runs `voice_regime_classifier.py` and that
service is deployed by hand: this file is imported by nothing flow-worker runs. The cache key and the lifetime are
the classifier's own (`_CACHE_KEY`, `_TTL_SECONDS`), read at call time, never retyped here.
"""
from __future__ import annotations

from typing import Optional


def held_regime() -> Optional[tuple[dict, float]]:
    """READ ONLY: `(classification, computed_at)` for the classification the classifier holds, or None.

    `classification` is the dict `get_current_regime()` stored (regime, confidence, reasons, signals, narration,
    label, vocabulary_version), untouched. `computed_at` is a unix time: the entry's expiry less the classifier's own
    lifetime, which is when the classifier stored it (the cache keeps an absolute expiry, also across a restart).
    None when nothing is held, when the entry has expired, or when it is not a classification. Never computes one.
    """
    from api.services import voice_regime_classifier as vrc
    from api.services.cache import cache

    for key, value, expires_at in cache.items_with_expiry():
        if key != vrc._CACHE_KEY:
            continue
        if not isinstance(value, dict) or not value:
            return None
        return value, float(expires_at) - float(vrc._TTL_SECONDS)
    return None
