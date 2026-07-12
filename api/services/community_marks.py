# api/services/community_marks.py
"""Price-at-mention capture — when a member tags $NVDA, we snapshot the price so the
room can see 'called at 128.50 → +2.1% since'. Every ticker mention becomes a
timestamped, scoreable call. Rides the live-prices router's SHARED per-ticker cache
(warm for hot tickers → usually zero upstream calls). Best-effort: never raises."""
import logging

_logger = logging.getLogger(__name__)

_MAX_MARKS = 4   # cap per message — first few tickers only


def prices_now(tickers):
    """{TK: price} for up to _MAX_MARKS tickers. Cache-first; one batch Massive call
    for misses. Returns {} on any failure."""
    tks = [str(t).upper() for t in (tickers or []) if t][:_MAX_MARKS]
    if not tks:
        return {}
    out = {}
    try:
        from api.routers.live_prices import cache as px_cache, _px_key, _fetch_snapshots
        misses = []
        for tk in tks:
            hit = px_cache.get(_px_key(tk))
            if hit and hit.get("price"):
                out[tk] = float(hit["price"])
            else:
                misses.append(tk)
        if misses:
            from api.services.massive import _get_client, _detect_session
            snaps = _fetch_snapshots(_get_client(), misses, _detect_session()) or {}
            for tk, val in snaps.items():
                px = (val or {}).get("price")
                if px:
                    out[tk] = float(px)
                    try:
                        px_cache.set(_px_key(tk), val, ttl=15)
                    except Exception:
                        pass
    except Exception as e:
        _logger.debug("[floor-marks] price fetch failed: %s", e)
    return out


def capture(message_id, tickers):
    """Snapshot + persist marks for a message's tagged tickers. Returns the marks."""
    try:
        from api.services import community_store as store
        marks = prices_now(tickers)
        if marks:
            store.record_ticker_marks(message_id, marks)
        return marks
    except Exception as e:
        _logger.debug("[floor-marks] capture failed: %s", e)
        return {}
