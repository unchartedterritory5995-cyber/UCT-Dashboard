"""Which imported links may become an embedded player: the server port of the client's
`app/src/pages/journal-2-0/lib/webEmbeds.js::embedFor` (Plan A Task 12, I-4 video).

A connector that meets a video or embed block asks `embed_for(url)`. A match becomes a
`webEmbed` node `{provider, ref, url}`, the same node the editor builds when a member pastes the
link; anything else stays a plain link. The iframe address is never stored: the client rebuilds
it from `{provider, ref}` on every render (`embedSrc`), so this module only has to agree with the
client on WHICH links embed and WHAT ref they carry.

⛔⛔ ONE ALLOW-LIST IN TWO FILES. The host set, the two id patterns, the TradingView host pattern
and the YouTube path kinds below are the client's, verbatim. `tests/test_web_embed_parity.py`
PARSES them out of `webEmbeds.js` and asserts equality, and runs the client's own `embedFor` in
Node over a corpus of links to compare answers, so a provider added, an id pattern widened or a
URL shape learned on one side goes red until the other side learns it too.
"""

from __future__ import annotations

import re
from urllib.parse import parse_qsl, unquote_to_bytes, urlsplit

#: The providers `embed_for` can answer, the keys of the client's `EMBED_PROVIDERS`.
EMBED_PROVIDERS: tuple[str, ...] = ("youtube", "tradingview")

YOUTUBE_HOSTS: frozenset[str] = frozenset({
    "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be",
    "youtube-nocookie.com", "www.youtube-nocookie.com",
})
YOUTUBE_ID_SRC = r"^[A-Za-z0-9_-]{11}$"
TRADINGVIEW_HOST_SRC = r"^(?:www\.|[a-z]{2}\.)?tradingview\.com$"
# EXCHANGE:SYMBOL or a bare SYMBOL, as TradingView writes them (NASDAQ:AAPL, NYSE:BRK.B).
TRADINGVIEW_REF_SRC = r"^(?:[A-Z0-9_]{1,20}:)?[A-Z0-9._!]{1,30}$"
#: `/<kind>/<id>` paths a YouTube id may sit in (beside `youtu.be/<id>` and `/watch?v=<id>`).
YOUTUBE_PATH_KINDS: tuple[str, ...] = ("shorts", "embed", "live")

# JavaScript's `$` (no `m` flag) matches only at the very end; Python's also matches before a
# trailing newline, so every test below is a `fullmatch`.
_YOUTUBE_ID = re.compile(YOUTUBE_ID_SRC)
_TRADINGVIEW_HOST = re.compile(TRADINGVIEW_HOST_SRC)
_TRADINGVIEW_REF = re.compile(TRADINGVIEW_REF_SRC)

_MAX_URL_LEN = 2048
_BAD_PERCENT = re.compile(r"%(?![0-9A-Fa-f]{2})")
_SPECIAL_SCHEME = re.compile(r"(?i)(https?):[/\\]*")


def _web_url(text: object):
    """`webUrl`: an http(s) address with a host and no credentials, as a SplitResult, else None."""
    if not isinstance(text, str):
        return None
    trimmed = text.strip()
    if not trimmed or any(c.isspace() for c in trimmed) or len(trimmed) > _MAX_URL_LEN:
        return None
    m = _SPECIAL_SCHEME.match(trimmed)
    if m is None:
        return None
    # The WHATWG parser (`new URL`) reads http(s) leniently: any run of `/` or `\` after the
    # scheme starts the authority, and `\` is `/` up to the query. Read the same way, so a link
    # the client would embed is not a plain link here.
    rest = trimmed[m.end():]
    cut = min((i for i in (rest.find("?"), rest.find("#")) if i >= 0), default=len(rest))
    rest = rest[:cut].replace("\\", "/") + rest[cut:]
    try:
        url = urlsplit(f"{m.group(1).lower()}://{rest}")
        host = url.hostname
        url.port  # noqa: B018 -- a malformed or out-of-range port raises, as `new URL` throws
    except ValueError:
        return None
    if not host or url.username or url.password:
        return None
    return url


def _parts(path: str) -> list[str]:
    return [p for p in path.split("/") if p]


def _query_get(query: str, name: str) -> str | None:
    """`URLSearchParams.get`: the FIRST value for `name`, percent-decoded, `+` read as a space."""
    for key, value in parse_qsl(query, keep_blank_values=True):
        if key == name:
            return value
    return None


def _decode_uri_component(text: str) -> str | None:
    """`decodeURIComponent`, which THROWS (here: None) on a malformed escape or invalid UTF-8."""
    if _BAD_PERCENT.search(text):
        return None
    try:
        return unquote_to_bytes(text).decode("utf-8")
    except UnicodeDecodeError:
        return None


def _youtube_ref(url) -> str | None:
    host = (url.hostname or "").lower()
    if host not in YOUTUBE_HOSTS:
        return None
    path = url.path or "/"
    parts = _parts(path)
    ident = None
    if host == "youtu.be":
        ident = parts[0] if parts else None
    elif path == "/watch":
        ident = _query_get(url.query, "v")
    elif parts and parts[0] in YOUTUBE_PATH_KINDS:
        ident = parts[1] if len(parts) > 1 else None
    return ident if ident and _YOUTUBE_ID.fullmatch(ident) else None


def _tradingview_ref(url) -> str | None:
    if not _TRADINGVIEW_HOST.fullmatch((url.hostname or "").lower()):
        return None
    parts = _parts(url.path or "/")
    ref = None
    if parts and parts[0] == "symbols" and len(parts) > 1:
        # /symbols/NASDAQ-AAPL/ -> NASDAQ:AAPL (the FIRST dash splits exchange from symbol)
        raw = _decode_uri_component(parts[1])
        if raw is None:
            return None
        raw = raw.upper()
        dash = raw.find("-")
        ref = f"{raw[:dash]}:{raw[dash + 1:]}" if dash > 0 else raw
    elif parts and parts[0] == "chart":
        ref = (_query_get(url.query, "symbol") or "").upper()
    return ref if ref and _TRADINGVIEW_REF.fullmatch(ref) else None


def embed_for(url: object) -> tuple[str, str] | None:
    """`("youtube", <11-char id>)` or `("tradingview", <ref>)` when `url` may embed, else None."""
    parsed = _web_url(url)
    if parsed is None:
        return None
    yt = _youtube_ref(parsed)
    if yt:
        return ("youtube", yt)
    tv = _tradingview_ref(parsed)
    if tv:
        return ("tradingview", tv)
    return None
