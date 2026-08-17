"""Fetch Substack post bodies and store them as native UCT articles.

`substack_poller` owns the ROSTER (which posts exist). This owns the BODY of
each one, because they come from different places and fail differently:

  * The archive listing (`/api/v1/archive`) carries a `body_html` key that is
    ALWAYS EMPTY. It is a roster, not a body source -- reading it and believing
    it is how you ship 84 blank articles.
  * RSS `<content:encoded>` carries the FULL body, but only for the ~20 newest
    posts. It arrives inside a fetch the poller already makes, so it costs
    nothing.
  * `/api/v1/posts/{slug}` carries the full body for the ENTIRE back catalogue.
    It is one request per post, so it is the backfill path, not the hot path.

FAIL CLOSED ON PAYWALLED POSTS. A Substack post that isn't `audience=everyone`
comes back TRUNCATED, not refused -- a plausible opening followed by silence.
Storing that renders a partial article with no indication it is partial, which
is worse than linking out. We refuse the body and keep the link-out card.
"""
from __future__ import annotations

import hashlib
import json
import re
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import requests

from api.services import desk_store, substack_article

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)
_HEADERS = {"User-Agent": _UA, "Accept": "application/json, text/plain, */*"}
_TIMEOUT = 20

_ET = ZoneInfo("America/New_York")

# Substack tolerates a steady crawl but not a burst. The backfill is a one-time
# ~84-request walk, so a second between posts costs ~90s and stays polite.
_BACKFILL_PACE_SECONDS = 1.0

# Tracking on the only outbound conversion links in the body, so the native
# reader's contribution to signups is measurable rather than assumed.
_UTM = {"utm_source": "uct_desk", "utm_medium": "article", "utm_campaign": "sunday_scans"}

_ALLOWED_AUDIENCE = "everyone"
_SLUG_RE = re.compile(r"/p/([^/?#]+)")


def _slug_from_url(url: str) -> str | None:
    m = _SLUG_RE.search(url or "")
    return m.group(1) if m else None


def _base_url(url: str) -> str:
    parts = urlsplit((url or "").strip())
    if not parts.scheme or not parts.netloc:
        return ""
    return f"{parts.scheme}://{parts.netloc}"


def _title_case(title: str) -> str:
    """"SUNDAY SCANS" -> "Sunday Scans". Mixed-case titles are left alone.

    Every Sunday Scans post is published under the identical all-caps title, so
    the card grid is otherwise 61 rows reading "SUNDAY SCANS".
    """
    letters = [ch for ch in title if ch.isalpha()]
    if len(letters) < 2 or not all(ch.isupper() for ch in letters):
        return title
    small = {"a", "an", "and", "the", "of", "for", "to", "in", "on", "at", "vs"}
    words = title.lower().split()
    out = []
    for i, w in enumerate(words):
        out.append(w if (i and w in small) else w[:1].upper() + w[1:])
    return " ".join(out)


def display_title_for(title: str, published_at: int) -> str:
    """"SUNDAY SCANS" + 1755370374 -> "Sunday Scans - August 16, 2026".

    Mirrors the Desk video naming (`_session_date_text`), so the same week's
    article and session recording read as a matched pair in the same hub.
    """
    base = _title_case((title or "").strip())
    if not published_at:
        return base
    try:
        dt = datetime.fromtimestamp(int(published_at), tz=timezone.utc).astimezone(_ET)
    except (ValueError, OSError, OverflowError):
        return base
    stamp = f"{dt.strftime('%B')} {dt.day}, {dt.year}"
    if not base:
        return stamp
    # Don't stamp a title that already carries its own date.
    return base if str(dt.year) in base else f"{base} — {stamp}"


def body_hash(raw: str) -> str:
    return hashlib.sha1((raw or "").encode("utf-8", "replace")).hexdigest()


def fetch_body(url: str) -> dict | None:
    """GET one post's full body. Returns None when it can't be served natively.

    Raises nothing: a body we can't fetch leaves the existing link-out card in
    place, which is a working experience rather than a broken one.
    """
    slug = _slug_from_url(url)
    base = _base_url(url)
    if not slug or not base:
        return None
    try:
        resp = requests.get(f"{base}/api/v1/posts/{slug}",
                            headers=_HEADERS, timeout=_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
    except Exception:  # noqa: BLE001 — best-effort per post
        return None
    if not isinstance(data, dict):
        return None
    return _accept_payload(data, slug)


def _accept_payload(data: dict, slug: str) -> dict | None:
    """Apply the paywall gate + shape the fetch result. Pure, so it's testable."""
    audience = (data.get("audience") or "").strip().lower()
    if audience and audience != _ALLOWED_AUDIENCE:
        # Truncated body wearing a full post's title. Refuse it.
        return None
    raw = data.get("body_html") or ""
    if not raw.strip():
        return None
    return {
        "raw": raw,
        "slug": (data.get("slug") or slug),
        "audience": audience,
        "wordcount": data.get("wordcount"),
        "excerpt": (data.get("truncated_body_text") or data.get("description") or "").strip(),
    }


def store_body(post: dict, raw: str, *, slug: str | None = None,
               excerpt: str | None = None) -> dict:
    """Convert a raw body and persist it against an existing post row.

    Returns the converted article so a caller can report what landed.
    """
    art = substack_article.convert(raw, utm=_UTM)
    published_at = int(post.get("published_at") or 0)
    desk_store.save_post_body(post["id"], {
        "body_raw": raw,
        "body_html": art.html,
        "body_hash": body_hash(raw),
        "sections_json": json.dumps(art.sections),
        "tickers_json": json.dumps(art.tickers),
        "display_title": display_title_for(post.get("title") or "", published_at),
        "slug": slug or _slug_from_url(post.get("url") or "") or "",
        "word_count": art.words,
        "reading_minutes": art.reading_minutes,
        "image_count": art.images,
        "converter_version": art.converter_version,
        "body_fetched_at": int(time.time()),
    })
    if excerpt:
        desk_store.upsert_post({**post, "excerpt": excerpt[:280]})
    return art


def reconvert_stored(post: dict) -> bool:
    """Re-run the current converter over the STORED raw body. No network.

    This is what makes a converter improvement cheap: bump CONVERTER_VERSION,
    run the backfill, and every article re-renders from local data.
    """
    raw = desk_store.get_post_raw(post["id"])
    if not raw:
        return False
    store_body(post, raw)
    return True


def refresh_recent_bodies(posts: list[dict]) -> dict:
    """Store bodies for RSS-parsed posts whose content changed.

    The feed carries full bodies for the ~20 newest posts inside a request the
    poller already makes, so this is where an EDIT to a recent post gets picked
    up -- a one-shot backfill would silently serve the pre-edit text forever.
    Older posts are the backfill's job.
    """
    summary = {"checked": 0, "stored": 0, "unchanged": 0}
    for post in posts or []:
        raw = (post.get("body_raw") or "").strip()
        if not raw:
            continue
        summary["checked"] += 1
        existing = desk_store.get_post(post["id"])
        if not existing:
            continue
        fresh = body_hash(raw)
        if (existing.get("body_hash") == fresh
                and (existing.get("converter_version") or 0) >= substack_article.CONVERTER_VERSION):
            summary["unchanged"] += 1
            continue
        try:
            store_body({**existing, **{k: post[k] for k in ("title", "url", "published_at")
                                       if k in post}}, raw)
            summary["stored"] += 1
        except Exception:  # noqa: BLE001 — never break a poll over one body
            pass
    return summary


def backfill_bodies(limit: int = 200, *, pace: float = _BACKFILL_PACE_SECONDS,
                    max_fetches: int | None = None) -> dict:
    """Give every post missing a current body one, newest-first.

    Resumable by construction: the work list is derived from what is actually
    MISSING, so an interrupted run picks up where it stopped and a completed run
    is a no-op. Posts whose raw body we already hold are re-converted locally
    and never re-fetched.

    `max_fetches` bounds only the NETWORK half. Re-converts are local and cost
    nothing, so a converter bump must not be throttled the way a cold archive
    walk is — otherwise bumping the version would take days to take effect.
    """
    pending = desk_store.posts_needing_body(substack_article.CONVERTER_VERSION, limit=limit)
    summary = {"pending": len(pending), "reconverted": 0, "fetched": 0,
               "refused": 0, "failed": 0, "deferred": 0,
               "refused_urls": [], "failed_urls": []}

    for post in pending:
        if post.get("has_raw"):
            if reconvert_stored(post):
                summary["reconverted"] += 1
                continue
        if max_fetches is not None and summary["fetched"] >= max_fetches:
            # Bounded slice: the rest is picked up by the next scheduled pass.
            summary["deferred"] += 1
            continue
        fetched = fetch_body(post.get("url") or "")
        if not fetched:
            # Paywalled or unreachable — the link-out card stays. Name it, so a
            # short backfill is diagnosable rather than a bare count.
            summary["refused"] += 1
            if len(summary["refused_urls"]) < 25:
                summary["refused_urls"].append(post.get("url"))
            continue
        try:
            store_body(post, fetched["raw"], slug=fetched.get("slug"),
                       excerpt=fetched.get("excerpt"))
            summary["fetched"] += 1
        except Exception:  # noqa: BLE001 — one bad post never kills the walk
            summary["failed"] += 1
            if len(summary["failed_urls"]) < 25:
                summary["failed_urls"].append(post.get("url"))
        if pace:
            time.sleep(pace)
    return summary
