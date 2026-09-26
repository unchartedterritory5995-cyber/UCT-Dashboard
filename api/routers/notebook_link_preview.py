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
    never truncates), counted in DECODED bytes, so memory per fetch is
    bounded; `_SEM` bounds how many run at once. A redirect or error body is
    never read past a few KB and never decoded (wave 6 whole-branch review
    I-1: it used to be read whole, and one member could send the pod a 404
    that never ends, or a gzip bomb).
  * THE PARSE IS OFF THE EVENT LOOP, AND BOUNDED. Decoding and parsing run in
    a worker thread, inside the same `_SEM` slot as its fetch so the memory
    bound still counts it, under its own ceiling (`PARSE_TIMEOUT_S`). The web
    pod is one process: a parse on the loop stalls every member's request.
    Only the first `PARSE_MAX_CHARS` of a page are ever parsed (round 4,
    R4-2), and a parse the route has timed out is CANCELLED at its next
    chunk, so it cannot keep running outside `_SEM` and the member limit.
  * A TIMEOUT per request (`TIMEOUT_S`) and one for the whole fetch including
    redirects (`TOTAL_S`).
  * NO COOKIES, NO CREDENTIALS. A fresh client per fetch whose cookie jar never
    stores anything (so a cookie set by a redirect hop is not sent to the
    next), `trust_env=False` (no proxy variables, no ~/.netrc credentials),
    and a URL carrying a user:password is refused outright.
  * CACHED by URL (success for hours, a failure for minutes), so a note full
    of the same link, or ten members pasting one article, costs one fetch.

Mounted by the controller in `api/main.py` (7dd7f2705). The editor defends
regardless (wave 6 D fix round 1, I4): an answer that is not JSON of the shape
`parse_preview` returns is "no preview" and the link stays, and the member reads
a fixed sentence per failure, never this file's `detail`.
"""

from __future__ import annotations

import asyncio
import re
import threading
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
# The parse gets the same ceiling as one network read.
PARSE_TIMEOUT_S = TIMEOUT_S
# ⛔ HOW MUCH OF A PAGE IS EVER PARSED (wave 6 fix round 4, R4-2). The card needs
# the <head>; the body cap admits 3 MB so an ordinary large page is not refused,
# but the parser only ever sees this prefix. Sized on this box: the worst shape
# measured (a page of bare '<') parses at ~1.8 MB/s and deeply nested tags at
# ~3 MB/s, so a full 3 MB body cost 1-1.75 s of pure-Python CPU; this prefix
# costs <= ~0.15 s, far inside PARSE_TIMEOUT_S even on a loaded pod.
# ⚠️ A page whose Open Graph tags sit more than 256 KiB in gets no card.
PARSE_MAX_CHARS = 256 * 1024
# The prefix is fed in chunks, so a parse can stop between them: at </head> or
# <body> (the head is all it reads), or when the request has given up on it.
_PARSE_CHUNK = 16 * 1024
MAX_REDIRECTS = 5
OK_TTL_S = 6 * 3600
FAIL_TTL_S = 10 * 60        # a refusal (not https, private host, not a page) stays refused
TRANSIENT_TTL_S = 60        # a page that did not answer may answer in a minute
TITLE_MAX = 200
DESCRIPTION_MAX = 400

_cache = TTLCache(max_size=2000)
# At most this many page fetches in flight at once (x MAX_BYTES = the memory bound).
_SEM = asyncio.Semaphore(4)
# ...and at most this many of them for ONE member (wave 6 D fix round 1, M3).
# ⚰️ `_SEM` is the whole pod's: one member pasting slow links could hold every
# slot for up to TOTAL_S each and starve everyone else's previews. The count is
# per-process, like `_SEM` (the web pod is one process; see CLAUDE.md's
# single-process assumptions). One event loop, and no `await` between the check
# and the increment, so the check cannot race itself.
PER_USER_INFLIGHT = 2
_inflight: dict[str, int] = {}
# The one sentence a refused link gets, whatever refused it (M1): the shared
# guard's `reason` is ITS vocabulary ("Media reference points at a
# private/internal network address"), written for connector logs.
NO_PREVIEW = "No preview for this link."

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
    """The host the card names, in the ASCII form the browser connects to.

    ⛔ (M2) A look-alike host ("apple.com" typed with U+0430, a Cyrillic a) would read
    as "apple.com" on the card, and the domain line is the card's one
    trustworthy field. IDNA-encoded it reads "xn--pple-43d.com", which is what it
    is. A host that cannot be encoded names nothing rather than something it is
    not; an ordinary ASCII host is unchanged."""
    host = (urlsplit(url).hostname or "").lower()
    try:
        host = host.encode("idna").decode("ascii")
    except UnicodeError:
        return ""
    return host[4:] if host.startswith("www.") else host


def parse_preview(html_text: str, *, url: str, final_url: str,
                  cancel: threading.Event | None = None) -> dict[str, Any] | None:
    """The card fields from a page's head, or None when it names nothing.

    ⛔ Bounded (R4-2): only the first `PARSE_MAX_CHARS` are ever parsed, fed in
    `_PARSE_CHUNK` pieces, and feeding stops at the first of: </head> or <body>
    (the parser's own `done`), the end of the prefix, or `cancel` being set.
    `cancel` is how the route STOPS a parse it has stopped waiting for: the
    worker thread notices at the next chunk boundary and returns None, so a
    timed-out parse costs at most one more chunk, never the rest of the page."""
    head = html_text[:PARSE_MAX_CHARS]
    end = re.search(r"</head\s*>", head, re.I)
    if end:
        head = head[: end.end()]
    parser = _HeadParser()
    try:
        for start in range(0, len(head), _PARSE_CHUNK):
            if parser.done or (cancel is not None and cancel.is_set()):
                break
            parser.feed(head[start:start + _PARSE_CHUNK])
        if cancel is not None and cancel.is_set():
            return None
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


def _preview_from_body(body: bytes, content_type: str, url: str, final_url: str,
                       cancel: threading.Event | None = None) -> dict[str, Any] | None:
    """Decode + parse: the CPU-bound half, run in a worker thread. Looks up
    `parse_preview` at call time (a module patch reaches it)."""
    return parse_preview(_decode(body, content_type), url=url, final_url=final_url, cancel=cancel)


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
            except NoteConnUnsupported:
                _refuse(422, NO_PREVIEW)
            except NoteConnTransient:
                _refuse(502, "Couldn't reach that page.")
        if response.status_code >= 300:
            _refuse(502, f"That page did not answer (HTTP {response.status_code}).")
        content_type = response.headers.get("content-type", "")
        kind = content_type.split(";", 1)[0].strip().lower()
        if kind not in ("text/html", "application/xhtml+xml") and not (not kind and body.lstrip()[:1] == b"<"):
            _refuse(422, "That link is not a web page.")
        # ⛔ OFF THE LOOP, and still inside this fetch's `_SEM` slot: the body
        # it holds is counted by the same bound as the fetch that produced it.
        # ⛔ CANCEL, not drop (R4-2): a thread cannot be killed, so on timeout the
        # route SETS `cancel` and the parse stops itself at its next chunk
        # boundary (parse_preview). Its work is bounded twice: by
        # PARSE_MAX_CHARS whatever happens, and by one chunk after a timeout.
        cancel = threading.Event()
        try:
            preview = await asyncio.wait_for(
                asyncio.to_thread(_preview_from_body, body, content_type, url, str(response.url), cancel),
                timeout=PARSE_TIMEOUT_S,
            )
        except asyncio.TimeoutError:
            cancel.set()
            _refuse(504, "That page took too long to answer.")
    if preview is None:
        _refuse(422, NO_PREVIEW)
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
    # M3: a cache hit above costs no slot; a fetch costs one of this member's.
    # ⛔ The refusal is never cached -- it is about the member, not the link.
    who = str((user or {}).get("id") or "")
    if _inflight.get(who, 0) >= PER_USER_INFLIGHT:
        _refuse(429, "Too many previews at once. Try again in a moment.")
    _inflight[who] = _inflight.get(who, 0) + 1
    try:
        preview = await _fetch_preview(target)
    except HTTPException as exc:
        ttl = FAIL_TTL_S if exc.status_code in (400, 422) else TRANSIENT_TTL_S
        _cache.set(key, {"error": (exc.status_code, exc.detail)}, ttl)
        raise
    finally:
        left = _inflight.get(who, 1) - 1
        if left > 0:
            _inflight[who] = left
        else:
            _inflight.pop(who, None)
    _cache.set(key, preview, OK_TTL_S)
    return preview
