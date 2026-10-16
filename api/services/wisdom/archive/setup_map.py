"""Detector -> archive setup, and today's market state in the archive's own terms.

THE MAP lives in the one setup vocabulary (D9): docs/wisdom/vocabulary/setup-vocabulary-v1.json,
list `trader_archive`, whose rows carry `pattern_engine_ids`. Nothing here restates it;
tests/test_wisdom_vocab_authority.py proves every linked detector exists, that no detector is
linked twice, and that a row and its detectors never disagree on the vocabulary.

THE MARKET STATE uses the rule the archive's scorer used for each call's `regime`: QQQ's daily
close against its 50- and 200-day simple averages. uptrend = close > 50 > 200, downtrend =
close < 50 < 200, anything else mixed. It is deliberately NOT the app's regime classifier
(voice_regime_classifier): the archive's context cuts are keyed on this rule, so reading today
with any other rule would pick a cut the numbers were never measured under.
"""
from __future__ import annotations

import functools
import logging
import threading
import time
from typing import Optional

log = logging.getLogger(__name__)

MARKET_TTL_S = 900
_MARKET_LOCK = threading.Lock()
_MARKET: dict = {"at": 0.0, "value": None}


@functools.lru_cache(maxsize=1)
def _index() -> dict:
    from api.services.wisdom.core import vocab

    rows = vocab.load_vocabulary()["maps"]["trader_archive"]["rows"]
    return {pid: row["external_name"] for row in rows for pid in row.get("pattern_engine_ids") or []}


def setup_for_pattern(pattern_id: Optional[str]) -> Optional[str]:
    """The archive setup a pattern-engine detector finds, or None when it maps to none."""
    return _index().get(str(pattern_id or "").strip().lower()) or None


def clear_cache() -> None:
    _index.cache_clear()
    with _MARKET_LOCK:
        _MARKET.update(at=0.0, value=None)


def classify_market(closes: list) -> Optional[str]:
    """uptrend / downtrend / mixed from oldest-first daily closes; None under 200 bars."""
    if len(closes) < 200:
        return None
    p = float(closes[-1])
    q50 = sum(closes[-50:]) / 50.0
    q200 = sum(closes[-200:]) / 200.0
    if p > q50 > q200:
        return "uptrend"
    if p < q50 < q200:
        return "downtrend"
    return "mixed"


def market_state() -> Optional[str]:
    """Today's QQQ state under the archive's rule, cached 15 minutes. None when bars are missing."""
    now = time.time()
    with _MARKET_LOCK:
        if now - _MARKET["at"] < MARKET_TTL_S:
            return _MARKET["value"]
    value = None
    try:
        from api.services import bars_sqlite

        rows = bars_sqlite.get_bars("QQQ", "D", 210)
        value = classify_market([r[4] for r in rows if r[4] is not None])
    except Exception:  # noqa: BLE001 — a missing bars store answers "unknown", never an error
        log.exception("[wisdom] archive market state unavailable")
    with _MARKET_LOCK:
        _MARKET.update(at=now, value=value)
    return value
