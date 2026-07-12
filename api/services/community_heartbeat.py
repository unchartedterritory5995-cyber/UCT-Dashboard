# api/services/community_heartbeat.py
"""UCT Mentor daily heartbeat — one 'UCT Mentor' system message into #trading-floor
each weekday morning so the live room is never a dead room (the #1 retention risk for
a single-channel community). author_id=NULL renders as 'UCT Mentor' and skips rate
limits; the $TICKER text also feeds hot_tickers → The Tape lights up. Best-effort:
never raises, idempotent per day."""
import json
import logging
import os
import time
from contextlib import closing
from datetime import datetime, timezone

_logger = logging.getLogger(__name__)


def _enabled() -> bool:
    return os.environ.get("COMMUNITY_CHAT_ENABLED", "0") == "1"


def _already_posted_recently() -> bool:
    """Idempotency: skip if a system heartbeat went out in the last 12h."""
    from api.services import community_store as store
    try:
        with closing(store.get_connection()) as conn:
            row = conn.execute(
                "SELECT created_at FROM messages "
                "WHERE channel_slug='trading-floor' AND author_id IS NULL AND deleted=0 "
                "ORDER BY id DESC LIMIT 1").fetchone()
        return bool(row) and (time.time() - row["created_at"]) < 12 * 3600
    except Exception:
        return False


def _para(nodes):
    return {"type": "paragraph", "content": nodes}


def build_heartbeat_doc():
    """Build the morning message from live wire data. Returns (body_json, tickers)."""
    from api.services import engine
    try:
        breadth = engine.get_breadth() or {}
    except Exception:
        breadth = {}
    phase = (breadth.get("market_phase") or "").strip()
    exposure = (breadth.get("exposure") or {}).get("score")
    tickers = []
    try:
        for it in (engine.get_leadership() or [])[:5]:
            t = str(it.get("sym") or it.get("ticker") or "").upper()[:8]
            if t and t not in tickers:
                tickers.append(t)
    except Exception:
        pass

    date_str = datetime.now(timezone.utc).strftime("%b %d")
    paras = [_para([{"type": "text", "marks": [{"type": "bold"}],
                     "text": f"Good morning — the floor is open. ({date_str})"}])]
    bits = []
    if phase:
        bits.append(f"Regime: {phase}")
    if exposure is not None:
        try:
            bits.append(f"UCT Exposure: {int(exposure)}")
        except (TypeError, ValueError):
            pass
    if bits:
        paras.append(_para([{"type": "text", "text": " · ".join(bits)}]))
    if tickers:
        content = [{"type": "text", "text": "Leaders to watch: "}]
        for t in tickers:
            content.append({"type": "tickerChip", "attrs": {"ticker": t}})
            content.append({"type": "text", "text": " "})
        paras.append(_para(content))
    paras.append(_para([{"type": "text", "text": "Talk the tape — what are you watching?"}]))
    return json.dumps({"type": "doc", "content": paras}), tickers


def post_daily_heartbeat(force: bool = False):
    if not _enabled():
        return {"posted": False, "reason": "disabled"}
    if not force and _already_posted_recently():
        return {"posted": False, "reason": "already_posted"}
    from api.services import community_store as store
    try:
        body, tickers = build_heartbeat_doc()
        mid = store.create_message("trading-floor", None, body,
                                   ticker_tags=tickers, bypass_rate_limit=True)
        marks = {}
        try:
            from api.services import community_marks
            marks = community_marks.capture(mid, tickers)
        except Exception:
            pass
        # Broadcast live so anyone already on the floor sees it appear.
        try:
            from api import chat_stream
            msg = store.get_message(mid)
            msg["author"] = {"name": "UCT Mentor", "is_mentor": True}
            msg.pop("card_json", None)
            msg["card"] = None
            msg["ticker_marks"] = marks
            chat_stream.get_hub().broadcast("trading-floor", "message", msg)
        except Exception:
            pass
        _logger.info("[floor-heartbeat] posted daily heartbeat msg=%s tickers=%s", mid, tickers)
        return {"posted": True, "id": mid, "tickers": tickers}
    except Exception as e:
        _logger.warning("[floor-heartbeat] failed: %s", e)
        return {"posted": False, "reason": str(e)}
