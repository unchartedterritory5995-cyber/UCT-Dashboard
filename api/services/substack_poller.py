"""Substack RSS poller for The Desk → Articles section.

Each Substack publication exposes a public RSS feed at `<pub>.substack.com/feed`.
We fetch every enabled publication, parse the feed with stdlib xml.etree (same
approach as news_aggregator — no feedparser dependency), and upsert posts deduped
on guid/url. Best-effort: one bad feed never kills the run.
"""
from __future__ import annotations

import os
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit, urlunsplit

import requests

from api.services import desk_store

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)
_HEADERS = {"User-Agent": _UA, "Accept": "application/rss+xml, application/xml, text/xml, */*"}
_TIMEOUT = 12

# Namespaces seen in Substack feeds.
_NS = {
    "content": "http://purl.org/rss/1.0/modules/content/",
    "dc": "http://purl.org/dc/elements/1.1/",
    "media": "http://search.yahoo.com/mrss/",
}

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
_IMG_RE = re.compile(r'<img[^>]+src="([^"]+)"', re.IGNORECASE)


def _strip_html(s: str) -> str:
    s = _TAG_RE.sub(" ", s or "")
    s = _WS_RE.sub(" ", s)
    return s.strip()


def _parse_date(s: str) -> int:
    """RFC-822 pubDate → unix seconds. 0 on failure (sorts oldest)."""
    if not s:
        return 0
    try:
        dt = parsedate_to_datetime(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    except (TypeError, ValueError):
        return 0


def _first_image(*html_blobs: str) -> str | None:
    for blob in html_blobs:
        if not blob:
            continue
        m = _IMG_RE.search(blob)
        if m:
            return m.group(1)
    return None


def parse_feed(xml_text: str, publication_id=None) -> list[dict]:
    """Parse a Substack RSS string → list of post dicts. Pure (no network),
    so it's unit-testable. Skips items missing a link or title."""
    out: list[dict] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return out
    channel = root.find("channel")
    if channel is None:
        return out
    for item in channel.findall("item"):
        link = (item.findtext("link") or "").strip()
        title = (item.findtext("title") or "").strip()
        if not link or not title:
            continue
        guid = (item.findtext("guid") or "").strip() or link
        desc = item.findtext("description") or ""
        content = ""
        ce = item.find("content:encoded", _NS)
        if ce is not None and ce.text:
            content = ce.text
        author = (item.findtext("dc:creator", namespaces=_NS) or "").strip() or None
        # hero image, in priority order:
        #   1. <enclosure url="..." type="image/*"/>  — Substack's canonical hero
        #   2. <media:content url="..."/>             — other feeds
        #   3. first <img> in content:encoded / description
        hero = None
        enc = item.find("enclosure")
        if enc is not None and enc.get("url"):
            etype = (enc.get("type") or "").lower()
            # Substack tags hero enclosures type="image/jpeg" even for webp/png.
            if etype.startswith("image") or "image" in etype or not etype:
                hero = enc.get("url")
        if not hero:
            mc = item.find("media:content", _NS)
            if mc is not None and mc.get("url"):
                hero = mc.get("url")
        if not hero:
            hero = _first_image(content, desc)
        excerpt = _strip_html(desc or content)[:280]
        out.append({
            # The FULL post body, for the native article reader. Only RSS carries
            # it in bulk (the archive listing's `body_html` is always empty), and
            # only for the ~20 newest posts -- but it rides a request we already
            # make, so recent bodies and edits cost nothing extra.
            "body_raw": content or "",
            # Key on the post URL (stable across RSS + archive paths) so the same
            # post never gets two rows. (Was `guid` — Substack guid == link, but
            # the archive path used the numeric id → cross-path duplicates.)
            "id": link,
            "publication_id": publication_id,
            "title": title[:300],
            "excerpt": excerpt,
            "url": link,
            "hero_image": hero,
            "author": author,
            "published_at": _parse_date(item.findtext("pubDate") or ""),
        })
    return out


# ── Archive API (full history) ──────────────────────────────────────────────────
# Substack's RSS /feed only returns the ~20 most recent posts. The archive API
# (/api/v1/archive?sort=new&offset=N&limit=L) paginates the ENTIRE back-catalog
# and reliably carries cover_image + post_date, so we use it as the primary
# source and keep RSS as a fallback.

# Substack silently caps the archive `limit` at ~12 (asking for 50 returns a
# short page; 100 errors). Request 12 and advance by the ACTUAL batch size so a
# short page never ends pagination prematurely — only an empty page does.
_ARCHIVE_PAGE = 12          # items per request (Substack's effective max)
_ARCHIVE_MAX = 2000         # safety cap on total posts pulled per publication


def _base_url(feed_url: str) -> str:
    """https://pub.substack.com/feed → https://pub.substack.com (scheme+host)."""
    parts = urlsplit((feed_url or "").strip())
    if not parts.scheme or not parts.netloc:
        return ""
    return urlunsplit((parts.scheme, parts.netloc, "", "", ""))


def _parse_iso8601(s: str) -> int:
    """ISO8601 (e.g. '2026-06-14T16:30:47.892Z') → unix seconds. 0 on failure."""
    if not s:
        return 0
    try:
        txt = s.strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(txt)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    except (TypeError, ValueError):
        return 0


def parse_archive_items(items: list, publication_id=None) -> list[dict]:
    """Map Substack archive-API JSON objects → post dicts. Pure (no network)."""
    out: list[dict] = []
    for it in items or []:
        if not isinstance(it, dict):
            continue
        url = (it.get("canonical_url") or "").strip()
        title = (it.get("title") or "").strip()
        if not url or not title:
            continue
        # Skip non-post types (podcasts/threads still welcome — keep newsletters + posts)
        # `truncated_body_text` FIRST: on this publication `description` and
        # `subtitle` are literally the post's date ("August 9th, 2026") on all
        # but the newest issue, so preferring them prints the date twice on a
        # card that already carries it in the title. Measured against the live
        # archive, not assumed.
        excerpt = (it.get("truncated_body_text") or it.get("description")
                   or it.get("subtitle") or "").strip()
        author = None
        bylines = it.get("publishedBylines") or it.get("publishedbylines")
        if isinstance(bylines, list) and bylines:
            author = (bylines[0] or {}).get("name")
        out.append({
            # Key on canonical_url (== RSS link) so RSS + archive agree → no dupes.
            "id": url,
            "publication_id": publication_id,
            "title": title[:300],
            "excerpt": _strip_html(excerpt)[:280],
            "url": url,
            "hero_image": it.get("cover_image") or None,
            "author": author,
            "published_at": _parse_iso8601(it.get("post_date") or ""),
        })
    return out


def fetch_archive(feed_url: str, publication_id=None, max_posts: int = _ARCHIVE_MAX) -> list[dict]:
    """Paginate the Substack archive API for the full back-catalog. Returns post
    dicts (may be empty). Raises on the first request so the caller can fall back."""
    base = _base_url(feed_url)
    if not base:
        return []
    posts: list[dict] = []
    offset = 0
    while offset < max_posts:
        url = f"{base}/api/v1/archive?sort=new&offset={offset}&limit={_ARCHIVE_PAGE}"
        resp = requests.get(url, headers=_HEADERS, timeout=_TIMEOUT)
        resp.raise_for_status()
        batch = resp.json()
        if not isinstance(batch, list) or not batch:
            break
        posts.extend(parse_archive_items(batch, publication_id=publication_id))
        # Advance by the actual batch size (Substack may return fewer than asked).
        offset += len(batch)
        if len(batch) < _ARCHIVE_PAGE:
            break  # final (partial) page — no more posts
    return posts


def _store_bodies(posts: list[dict]) -> dict:
    """Hand RSS-parsed bodies to the article layer. Never raises: the roster is
    the poller's job and must land even if the reader's bodies don't."""
    try:
        from api.services import substack_bodies  # local: avoids an import cycle
        return substack_bodies.refresh_recent_bodies(posts)
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)[:200]}


def _refresh_recent_bodies(pub: dict) -> dict:
    """Fetch the RSS feed purely for its bodies.

    The archive API is the roster source but its `body_html` is always empty, so
    the newest ~20 bodies need this one extra request per poll. That is far
    cheaper than 20 per-post calls, and it is what notices an EDIT to a recent
    post -- an archive-only poll would serve pre-edit text indefinitely.
    """
    try:
        resp = requests.get(pub["feed_url"], headers=_HEADERS, timeout=_TIMEOUT)
        resp.raise_for_status()
        posts = parse_feed(resp.text, publication_id=pub["id"])
    except Exception as e:  # noqa: BLE001 — bodies are best-effort
        return {"error": str(e)[:200]}
    return _store_bodies(posts)


def poll_publication(pub: dict) -> dict:
    """Fetch + parse + store one publication, full history. Returns a summary dict.
    Never raises. Primary source = archive API (full back-catalog); falls back to
    RSS (recent ~20) if the archive API is unavailable."""
    name = pub.get("name")
    # 1. Archive API — full history.
    try:
        posts = fetch_archive(pub["feed_url"], publication_id=pub["id"])
        if posts:
            for p in posts:
                desk_store.upsert_post(p)
            bodies = _refresh_recent_bodies(pub)
            return {"publication": name, "stored": len(posts),
                    "status": "ok", "source": "archive", "bodies": bodies}
    except Exception as e:  # noqa: BLE001 — fall back to RSS
        archive_err = str(e)[:200]
    else:
        archive_err = "archive returned no posts"
    # 2. RSS fallback — recent posts only.
    try:
        resp = requests.get(pub["feed_url"], headers=_HEADERS, timeout=_TIMEOUT)
        resp.raise_for_status()
        posts = parse_feed(resp.text, publication_id=pub["id"])
        for p in posts:
            desk_store.upsert_post(p)
        bodies = _store_bodies(posts)
        return {"publication": name, "stored": len(posts), "status": "ok",
                "source": "rss", "archive_note": archive_err, "bodies": bodies}
    except Exception as e:  # noqa: BLE001 — best-effort per feed
        return {"publication": name, "stored": 0, "status": "error",
                "error": str(e)[:200]}


def poll_all() -> list[dict]:
    """Poll every enabled publication. Returns per-publication summaries."""
    results = []
    for pub in desk_store.list_publications(enabled_only=True):
        results.append(poll_publication(pub))
    # Self-heal: collapse any legacy duplicate rows (old guid/numeric-id keys).
    try:
        desk_store.dedupe_posts()
    except Exception:
        pass
    _backfill_slice()
    return results


def _backfill_slice() -> None:
    """Walk the back catalogue a few posts per poll so the archive fills itself.

    RSS hands us the newest ~20 bodies for free; everything older needs one
    request each. Doing that as a bounded slice per hourly poll means the
    archive completes on its own (~9 hours for an 84-post catalogue) with no
    manual step and no burst against Substack — rather than sitting half-native
    until someone remembers to call the admin endpoint.

    Set DESK_ARTICLE_BACKFILL_PER_POLL=0 to turn the walk off.
    """
    try:
        per_poll = int(os.environ.get("DESK_ARTICLE_BACKFILL_PER_POLL", "8"))
    except ValueError:
        per_poll = 8
    if per_poll <= 0:
        return
    try:
        from api.services import substack_bodies
        got = substack_bodies.backfill_bodies(limit=400, max_fetches=per_poll)
        if got.get("fetched") or got.get("reconverted"):
            print(f"[substack] article bodies: fetched={got['fetched']} "
                  f"reconverted={got['reconverted']} deferred={got.get('deferred', 0)} "
                  f"refused={got['refused']}")
    except Exception as e:  # noqa: BLE001 — never break the poll over a body
        print(f"[substack] backfill slice failed (non-fatal): {str(e)[:200]}")
