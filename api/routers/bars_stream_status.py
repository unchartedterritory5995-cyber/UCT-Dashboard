"""`GET /api/admin/bars-stream-status`: the push feed's health, moved VERBATIM out of `api/routers/bars.py` (2026-11-26).

It is the only route that reads the stream modules (`bar_broadcaster`, `bar_stream`, `feed_client`). `api/routers/bars.py`
is imported for `serve_bars` by six callers that flow-worker loads (discord interactions, discord_render.symbols,
seasonality, index_bars, journal_two.tweet_price), so this one route there put the whole stream into flow-worker's
import closure (tests/test_alert_taxonomy_price_level_projection.py). Same path, same handler, same open-read gate
(mounted beside the bars router in api/main.py).
"""
import os

from fastapi import APIRouter

router = APIRouter()


@router.get("/api/admin/bars-stream-status")
def bars_stream_status():
    """Push-feed (Phase C) health (no auth — read-only). The ONLY way to answer, without an
    SSH: is the Massive WS connected, how many (sym,tf) are fanning out, is anyone subscribed,
    and — the key signal — is it actually EMITTING (bars_emitted_total climbing / last_emit_age
    small) vs silently dead while users invisibly fell back to Finnhub. `bars_dropped_total` > 0
    = slow-consumer data loss. `enabled=false` = the whole rail is off (STREAM_BARS_ENABLED)."""
    enabled = os.environ.get("STREAM_BARS_ENABLED") == "1"
    out = {"enabled": enabled}
    if not enabled:
        return out
    try:
        from api.services.bar_broadcaster import get_broadcaster
        out["broadcaster"] = get_broadcaster().get_status()
    except Exception as e:  # noqa: BLE001
        out["broadcaster_error"] = str(e)[:200]
    try:
        from api.services import bar_stream
        out["websocket"] = bar_stream.get_status()
    except Exception as e:  # noqa: BLE001
        out["websocket_error"] = str(e)[:200]
    try:
        from api.services import bar_stream
        # Per-channel subscription counts + each owner's channels (STREAM_SCOPED_CHANNELS).
        out["websocket_channels"] = bar_stream.get_channel_counts()
    except Exception as e:  # noqa: BLE001
        out["websocket_channels_error"] = str(e)[:200]
    try:
        from api.services import feed_client
        out["feed_source"] = feed_client.feed_source()
        st = feed_client.status()
        if st is not None:
            out["feed_client"] = st
    except Exception as e:  # noqa: BLE001
        out["feed_client_error"] = str(e)[:200]
    return out
