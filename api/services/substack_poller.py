"""Substack RSS poller for The Desk → Articles section.

Each Substack publication exposes a public RSS feed at `<pub>.substack.com/feed`.
We fetch every enabled publication, parse the feed with stdlib xml.etree (same
approach as news_aggregator — no feedparser dependency), and upsert posts deduped
on guid/url. Best-effort: one bad feed never kills the run.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

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
            "id": guid,
            "publication_id": publication_id,
            "title": title[:300],
            "excerpt": excerpt,
            "url": link,
            "hero_image": hero,
            "author": author,
            "published_at": _parse_date(item.findtext("pubDate") or ""),
        })
    return out


def poll_publication(pub: dict) -> dict:
    """Fetch + parse + store one publication. Returns a summary dict. Never raises."""
    try:
        resp = requests.get(pub["feed_url"], headers=_HEADERS, timeout=_TIMEOUT)
        resp.raise_for_status()
        posts = parse_feed(resp.text, publication_id=pub["id"])
        for p in posts:
            desk_store.upsert_post(p)
        return {"publication": pub["name"], "stored": len(posts), "status": "ok"}
    except Exception as e:  # noqa: BLE001 — best-effort per feed
        return {"publication": pub.get("name"), "stored": 0, "status": "error",
                "error": str(e)[:200]}


def poll_all() -> list[dict]:
    """Poll every enabled publication. Returns per-publication summaries."""
    results = []
    for pub in desk_store.list_publications(enabled_only=True):
        results.append(poll_publication(pub))
    return results
