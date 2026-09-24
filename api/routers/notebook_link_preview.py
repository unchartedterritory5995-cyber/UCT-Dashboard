"""GET /api/j2/link-preview?url= -- a pasted link's preview card (wave 6, lane D item 6).

A member pastes a lone link into a note and picks "Preview card". The browser
cannot read another site's page (and must never send the member's cookies to
it), so the server fetches the page ONCE, reads its Open Graph / <title> /
description tags, and hands back four strings -- title, description, domain,
image -- that the editor stores in the card node's attrs. The card then renders
from those attrs for ever after, offline included: nothing here is called when
a note opens.

The fetch is a server-side request to an address a member typed, so it is an
SSRF surface, and every rule below exists for that reason:

  * THE ONE GUARD. Every hop -- the first request and every redirect -- goes
    through `note_connectors.providers.base.guarded_media_stream`, the shared
    SSRF guard the note connectors already use (`assert_public_https` on each
    hop: https only, every resolved address public; redirects followed by hand
    and bounded). It is imported, never copied: a second copy of a guard is a
    guard nobody has proved (lesson_a_guard_repeated_is_a_guard_unproved).
    ⚠️ That guard is HTTPS-ONLY by design, so a plain `http://` link gets no
    preview card (the editor keeps it as a link). It is also not
    rebinding-proof; base.py says why that is accepted for a fetch that
    carries no credential -- and this one carries none (below).
  * A SIZE CAP. The guard streams and refuses a body past `MAX_BYTES` (it
    never truncates), so memory per fetch is bounded; `_SEM` bounds how many
    run at once.
  * A TIMEOUT per request (`TIMEOUT_S`) and one for the whole fetch including
    redirects (`TOTAL_S`).
  * NO COOKIES, NO CREDENTIALS. A fresh client per fetch whose cookie jar never
    stores anything (so a cookie set by a redirect hop is not sent to the
    next), `trust_env=False` (no proxy variables, no ~/.netrc credentials),
    and a URL carrying a user:password is refused outright.
  * CACHED by URL (success for hours, a failure for minutes), so a note full
    of the same link, or ten members pasting one article, costs one fetch.

⛔ NOT MOUNTED BY THIS FILE. `api/main.py` is outside lane D's ownership; the
controller mounts `router` (report: wave6-D-report.md). Until then the editor's
"Preview card" answers "No preview for this link" and keeps the link.
"""

from __future__ import annotations

import asyncio
import re
from html.parser import HTMLParser
from http.cookiejar import CookieJar
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import get_current_user
from api.services.cache import TTLCache
from api.services.journal_two.note_connectors.errors import NoteConnTransient, NoteConnUnsupported
from api.services.journal_two.note_connectors.providers import base as ssrf_guard

router = APIRouter()

MAX_URL_LEN = 2048
# A page's <head> is all this reads, but the guard refuses (never truncates) a
# body past the cap, so the cap must admit an ordinary large page whole.
MAX_BYTES = 3 * 1024 * 1024
TIMEOUT_S = 5.0
TOTAL_S = 12.0
MAX_REDIRECTS = 5
OK_TTL_S = 6 * 3600
FAIL_TTL_S = 10 * 60        # a refusal (not https, private host, not a page) stays refused
TRANSIENT_TTL_S = 60        # a page that did not answer may answer in a minute
TITLE_MAX = 200
DESCRIPTION_MAX = 400

_cache = TTLCache(max_size=2000)
# At most this many page fetches in flight at once (x MAX_BYTES = the memory bound).
_SEM = asyncio.Semaphore(4)

_USER_AGENT = "UCTIntelligence-LinkPreview/1.0 (+https://uctintelligence.com)"


class _NoCookieJar(CookieJar):
    """A jar that never keeps a cookie: a Set-Cookie on one redirect hop is
    never sent to the next, and nothing outlives the fetch."""

    def set_cookie(self, cookie):  # noqa: D401 - CookieJar API
        return None

    def extract_cookies(self, response, request):
        return None


def _transport():
    """The injectable seam for tests (a MockTransport). Late-bound: looked up at
    call time, so a module patch reaches it. Production answers None, i.e.
    httpx's own transport."""
    return None


def _make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=httpx.Timeout(TIMEOUT_S),
        cookies=_NoCookieJar(),
        headers={
            "User-Agent": _USER_AGENT,
            "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
            "Accept-Language": "en;q=0.9",
        },
        follow_redirects=False,
        trust_env=False,
        transport=_transport(),
    )


class _HeadParser(HTMLParser):
    """Collects <meta property|name=... content=...> and <title> from the
    document head; stops listening at <body> or </head>."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self._title: list[str] = []
        self._in_title = False
        self.done = False

    def handle_starttag(self, tag, attrs):
        if self.done:
            return
        tag = tag.lower()
        if tag == "body":
            self.done = True
        elif tag == "title":
            self._in_title = True
        elif tag == "meta":
            a = {str(k).lower(): (v or "") for k, v in attrs}
            key = (a.get("property") or a.get("name") or "").strip().lower()
            if key and "content" in a and key not in self.meta:
                self.meta[key] = a["content"]

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag == "title":
            self._in_title = False
        elif tag == "head":
            self.done = True

    def handle_data(self, data):
        if self._in_title and not self.done:
            self._title.append(data)

    @property
    def title(self) -> str:
        return "".join(self._title)


def _clean(value: Any, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    text = re.sub(r"\s+", " ", value).strip()
    if not text:
        return None
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


_CHARSET_META = re.compile(rb"""<meta[^>]+charset\s*=\s*["']?([A-Za-z0-9._-]+)""", re.I)


def _decode(body: bytes, content_type: str) -> str:
    charset = None
    m = re.search(r"charset\s*=\s*\"?([A-Za-z0-9._-]+)", content_type or "", re.I)
    if m:
        charset = m.group(1)
    else:
        sniff = _CHARSET_META.search(body[:4096])
        if sniff:
            charset = sniff.group(1).decode("ascii", "ignore")
    try:
        return body.decode(charset or "utf-8", errors="replace")
    except LookupError:
        return body.decode("utf-8", errors="replace")


def _https_or_none(raw: Any, base_url: str) -> str | None:
    """An image reference as the browser will fetch it: absolute, https, has a
    host, not absurdly long. Anything else is dropped (the card shows no image)."""
    if not isinstance(raw, str) or not raw.strip():
        return None
    absolute = urljoin(base_url, raw.strip())
    parts = urlsplit(absolute)
    if parts.scheme.lower() != "https" or not parts.hostname or len(absolute) > MAX_URL_LEN:
        return None
    return absolute


def _domain(url: str) -> str:
    host = (urlsplit(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def parse_preview(html_text: str, *, url: str, final_url: str) -> dict[str, Any] | None:
    """The card fields from a page's head, or None when it names nothing."""
    end = re.search(r"</head\s*>", html_text, re.I)
    parser = _HeadParser()
    try:
        parser.feed(html_text[: end.end()] if end else html_text)
        parser.close()
    except Exception:  # noqa: BLE001 - a malformed page is "no preview", never a 500
        pass
    meta = parser.meta
    title = _clean(meta.get("og:title") or meta.get("twitter:title") or parser.title, TITLE_MAX)
    description = _clean(
        meta.get("og:description") or meta.get("twitter:description") or meta.get("description"),
        DESCRIPTION_MAX,
    )
    if not title and not description:
        return None
    image = None
    for key in ("og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"):
        image = _https_or_none(meta.get(key), final_url)
        if image:
            break
    return {"url": url, "title": title, "description": description,
            "domain": _domain(url), "image": image}


def _refuse(status: int, detail: str):
    raise HTTPException(status_code=status, detail=detail)


async def _fetch_preview(url: str) -> dict[str, Any]:
    async with _SEM:
        async with _make_client() as client:
            try:
                body, response = await asyncio.wait_for(
                    ssrf_guard.guarded_media_stream(
                        client, url, what="link preview", max_redirects=MAX_REDIRECTS,
                        max_bytes=MAX_BYTES),
                    timeout=TOTAL_S,
                )
            except asyncio.TimeoutError:
                _refuse(504, "That page took too long to answer.")
            except NoteConnUnsupported as exc:
                _refuse(422, exc.reason or "No preview for this link.")
            except NoteConnTransient:
                _refuse(502, "Couldn't reach that page.")
    if response.status_code >= 300:
        _refuse(502, f"That page did not answer (HTTP {response.status_code}).")
    content_type = response.headers.get("content-type", "")
    kind = content_type.split(";", 1)[0].strip().lower()
    if kind not in ("text/html", "application/xhtml+xml") and not (not kind and body.lstrip()[:1] == b"<"):
        _refuse(422, "That link is not a web page.")
    preview = parse_preview(_decode(body, content_type), url=url, final_url=str(response.url))
    if preview is None:
        _refuse(422, "No preview for this link.")
    return preview


@router.get("/api/j2/link-preview")
async def link_preview(
    url: str = Query(..., min_length=1, max_length=MAX_URL_LEN),
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    target = url.strip()
    parts = urlsplit(target)
    scheme = (parts.scheme or "").lower()
    if scheme not in ("http", "https") or not parts.hostname:
        _refuse(400, "That is not a web link.")
    if parts.username or parts.password:
        _refuse(422, "A link carrying a user name or password gets no preview.")
    if scheme != "https":
        _refuse(422, "Only secure (https) links get a preview card.")
    key = f"lp::{target}"
    hit = _cache.get(key)
    if hit is not None:
        if "error" in hit:
            _refuse(hit["error"][0], hit["error"][1])
        return hit
    try:
        preview = await _fetch_preview(target)
    except HTTPException as exc:
        ttl = FAIL_TTL_S if exc.status_code in (400, 422) else TRANSIENT_TTL_S
        _cache.set(key, {"error": (exc.status_code, exc.detail)}, ttl)
        raise
    _cache.set(key, preview, OK_TTL_S)
    return preview
