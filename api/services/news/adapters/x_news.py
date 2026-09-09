"""Curated X adapter — the fast social lane.

Reads the EXISTING tweet pipeline. Nothing new is polled and no new cost is
introduced: `tweet_poller` already fills `tweets.db` from a curated
`twitter_accounts` table on a central schedule, with `since_id` so an empty
poll is free. This adapter only projects what is already stored into the
shared news shape (§6: no per-user, no per-ticker polling).

Media: images are already extracted from raw tweet JSON by
`tweet_store._extract_media`. Video is detected here from the raw payload and
surfaced as an EMBED reference only -- §29 forbids downloading or rehosting,
so the expanded row uses X's own oEmbed and nothing is ever copied.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone

_log = logging.getLogger(__name__)

# A tweet that is mostly a cashtag list or a bare link is not a story.
_LOW_SIGNAL = re.compile(r"^\s*(?:[$#]\w+[\s,]*){1,}(?:https?://\S+)?\s*$", re.I)
_URL_RE = re.compile(r"https?://\S+")
_VIDEO_HINT = re.compile(r'"(?:video_info|type)"\s*:\s*"?(?:video|animated_gif)', re.I)


def _has_video(raw_json: str | None) -> bool:
    if not raw_json:
        return False
    if _VIDEO_HINT.search(raw_json):
        return True
    try:
        obj = json.loads(raw_json)
    except Exception:
        return False

    def walk(o) -> bool:
        if isinstance(o, dict):
            if o.get("type") in ("video", "animated_gif"):
                return True
            if "video_info" in o:
                return True
            return any(walk(v) for v in o.values())
        if isinstance(o, list):
            return any(walk(v) for v in o)
        return False

    try:
        return walk(obj)
    except Exception:
        return False


def _clean_text(text: str) -> str:
    """Trailing self-links are chrome; the post text is the headline."""
    s = (text or "").strip()
    s = re.sub(r"\s+https://t\.co/\w+\s*$", "", s)
    return s.strip()


def fetch(symbol: str, *, hours: int = 24 * 30, limit: int = 60) -> list[dict]:
    """Stored tweets for one ticker, in the shared raw shape."""
    sym = (symbol or "").upper().strip()
    if not sym:
        return []
    try:
        from api.services import tweet_store
        rows = tweet_store.tweets_for_ticker(sym, hours=hours) or []
    except Exception as e:                            # noqa: BLE001
        _log.warning("x fetch %s: %s", sym, e)
        return []

    out: list[dict] = []
    for r in rows[:limit]:
        text = _clean_text(r.get("text") or "")
        if not text or _LOW_SIGNAL.match(text):
            continue
        ts = r.get("created_at")
        try:
            when = datetime.fromtimestamp(int(ts), timezone.utc)
        except (TypeError, ValueError):
            continue

        handle = (r.get("author_handle") or "").lstrip("@")
        raw = r.get("raw_json")
        images: list[str] = []
        try:
            from api.services import tweet_store as ts_mod
            images = ts_mod._extract_media(raw, limit=1) or []
        except Exception:
            images = []

        # The post text IS the headline. A long post keeps its first sentence
        # as the headline and the remainder becomes the description, so the
        # feed row stays scannable without rewriting anyone's words (§24).
        headline, _, rest = text.partition("\n")
        headline = headline.strip() or text
        body = rest.strip()
        if len(headline) > 180:
            cut = headline[:180].rsplit(" ", 1)[0]
            body = (headline[len(cut):].strip() + " " + body).strip()
            headline = cut + "…"

        has_video = _has_video(raw)
        out.append({
            "provider": "x",
            "lane": "x",
            "provider_id": str(r.get("id") or ""),
            "publisher": f"@{handle}" if handle else "X",
            "url": r.get("url") or "",
            "title": headline,
            "body": _URL_RE.sub("", body).strip(),
            "image": images[0] if images else "",
            "published_at": when,
            "tags": [sym],
            "author": (r.get("author_name") or "").strip(),
            "media_type": "video" if has_video else ("image" if images else ""),
            # Official embed only; nothing is downloaded or rehosted.
            "embed_url": (r.get("url") or "") if has_video else "",
        })
    return out
