"""Desk ticker markers adapter — team CALLs and MENTIONs as StockChart desk markers (W1 Part 5).

Consumer: `api/services/ticker_mentions.py::mentions_for_symbol`, the one authority the
StockChart desk-marker category reads (`GET /api/education/tickers/{sym}/mentions`,
require_paid). There is no TickerPopup Desk tab (CONTRACTS §0 #24).

THE GATE LIVES OUTSIDE THE PER-SYMBOL CACHE. `ticker_mentions` caches video rows per
symbol for 600 s. The flag is read on every call AFTER the cache, so a flip either way
takes effect on the next request and a cached payload never carries Wisdom rows past a
flip-off. With the flag off the hook returns the cached payload object itself.

ROW SHAPE: the endpoint's own keys (video_id, youtube_id, title, anchor_date, t, note)
plus kind ('call'|'mention'), source 'wisdom', status, speaker and locator. A video-backed
source (a Desk session with an edu_videos id) fills video_id/youtube_id/t so a click opens
that moment; anything else leaves them null and `deskMentionHref` returns null (no link).

ORDERING PROTECTS THE EXISTING MARKERS. `buildDeskMentionMarkers` keeps the FIRST row per
day. Video rows keep their exact order and every Wisdom row sorts after the video rows of
its day, so a Wisdom row can never take over a day's click-to-video marker. Wisdom rows
have their own cap: they never displace a video row the flag-off payload would show.
"""
from __future__ import annotations

import logging

from api.services.wisdom.core import flags

log = logging.getLogger(__name__)

CONSUMER = "desk_markers"
FLAG_ENV = "WISDOM_DESK_MARKERS_ENABLED"
WISDOM_CAP = 50
_KINDS = {"CALL": "call", "MENTION": "mention"}


def wisdom_rows(sym: str) -> list[dict]:
    from api.services.wisdom.core import store
    from api.services.wisdom.publish.adapters import common

    ticker = common.normalize_ticker(sym)
    if not ticker:
        return []
    with store.read(for_request=True) as conn:
        if not common.table_exists(conn, "wisdom_records"):
            return []
        records = common.select_records(conn, types=tuple(_KINDS), ticker=ticker, limit=WISDOM_CAP)
    out = []
    for r in records:
        anchor = common.record_date(r)
        if not anchor:
            continue
        video_id = None
        ref = str(r["external_ref"] or "")
        if r["stream"] in common.VIDEO_STREAMS and r["media_pointer"] and ref.startswith("edu_videos:"):
            try:
                video_id = int(ref.split(":", 1)[1])
            except ValueError:
                video_id = None
        who = common.speaker(r["author_id"])
        status = common.status_label(r["status"])
        line = common.clip(r["trigger_text"] or r["thesis"] or r["reason"] or r["seg_text"], 200)
        out.append({
            "video_id": video_id,
            "youtube_id": r["media_pointer"] if video_id is not None else None,
            "title": r["source_title"] or "",
            "anchor_date": anchor,
            "t": int(r["t_start_s"]) if (video_id is not None and r["t_start_s"] is not None) else 0,
            "note": f"{who} ({status}): {line}",
            "kind": _KINDS[r["record_type"]], "source": "wisdom", "status": status, "speaker": who,
            "locator": common.row_locator(r),
        })
    return out


def merge(payload: dict, sym: str) -> dict:
    """A NEW payload with Wisdom rows added; the cached `payload` is never mutated."""
    rows = wisdom_rows(sym)
    if not rows:
        return payload
    videos = list(payload.get("mentions") or [])
    tagged = [(m, 0) for m in videos] + [(m, 1) for m in rows]
    # stable passes: (anchor_date desc, video before wisdom, t asc) — reproduces the
    # endpoint's own video order exactly and puts Wisdom rows last within their day
    tagged.sort(key=lambda x: int(x[0].get("t") or 0))
    tagged.sort(key=lambda x: x[1])
    tagged.sort(key=lambda x: str(x[0].get("anchor_date") or ""), reverse=True)
    return {**payload, "mentions": [m for m, _ in tagged]}


def daily_preview(ctx) -> dict:
    from api.services.wisdom.core import store
    from api.services.wisdom.publish.adapters import common

    flag_on = flags.desk_markers_enabled()
    with store.read() as conn:
        records = common.select_records(conn, types=tuple(_KINDS), extra_where="r.ticker IS NOT NULL")
    tickers = {common.normalize_ticker(r["ticker"]) for r in records}
    out = {"flag_on": flag_on, "tickers": len(tickers), "rows": len(records)}
    if getattr(ctx, "dry_run", False):
        return {**out, "dry_run": True}
    with store.write() as conn:
        common.log_publish(conn, CONSUMER, f"summary:tickers={len(tickers)}:rows={len(records)}",
                           "export" if flag_on else "would_publish", FLAG_ENV, flag_on)
    return out
