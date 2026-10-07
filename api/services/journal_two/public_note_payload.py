"""What a stranger receives: the ONE reducer for every public copy of a note, and the
one public-response contract. Wave 8, lane 8B.

Both public surfaces call it -- share links (`note_shares.py`, `mode="share"`) and
publish-to-web (`note_publish.py`, `mode="publish"`). A second reducer would be a second
authority over what leaves the account, which is the defect this repo keeps paying for.

⛔ THE POLICY IS A TABLE, AND EVERY NOTE TYPE HAS A ROW. `NODE_POLICY` names, for every
node and mark type in `app/src/pages/journal-2-0/lib/notebookSchema.js`, what share mode
and publish mode do with it. `tests/test_public_note_payload.py` DERIVES the type list from
that file and fails by name on a type with no row. At run time an unknown type is DROPPED
(fail closed): a node this module has never been told about is not something to hand a
stranger.

⛔ THE MARKET-DATA DECISION IS ANOTHER TABLE, AND IT IS THE OWNER'S. `MARKET_DATA_VENDORS`
says which vendor each market-data item comes from; `VENDOR_VERDICT` says whether that
vendor may be shown publicly. Owner legal sign-off, 2026-09-25 (L3, and its correction):
FMP and Finnhub figures render; Massive-sourced chart images and bar widgets become the
neutral line, on share links and published pages alike; anything not attributed to an
approved vendor stays neutral (L3 as sent -- the correction loosened FMP and Finnhub only).
Loosening Massive later is ONE line: `"massive": SHOWN` in `VENDOR_VERDICT`.

What each mode does (the rows below are the authority; this is the summary):
  * both modes -- `askCitation` keeps only its number (share) or goes (publish); `noteLink`
    becomes the plain text "linked note" (ruling D-B7) unless, in publish mode, its target
    is in the same publication, where it becomes a link to that note's public URL; a
    `link` mark that points inside the app (another note, a trade, an API) loses the link
    and keeps its text; an image copied from ANOTHER note (its URL still names the owner's
    user id and that note's id) is dropped; file attachment chips are dropped; every
    image-bearing attribute (an image's src, a card's image, a widget's archived image, the
    hero) must be this note's public proxy or an http(s) address off our own host, a link
    card whose address is in-app is dropped, and an embed's in-app fallback address is
    cleared -- no in-app URL, which would carry a note id, reaches a stranger (M-6).
  * publish only -- Ask answers (`askInsert` with no `action`) go, writing-help blocks
    stay with their label (ruling D-B5), and every `askCitation` goes.
  * gallery only (wave 12, lane 12A: a member template published to the COMMUNITY GALLERY,
    `template_gallery.py`) -- a template is a scaffold other members copy, not a page of the
    author's, so it keeps less than publish does: EVERY image and image-bearing attribute goes
    (an image, a figure and its caption, a link card's picture; re-uploading is a later step),
    every `askInsert` goes, writing help included, and every `askCitation` (both were computed
    from the author's private notes), a `noteLink` is the plain text "linked note" (a gallery
    copy has no publication to link into), every market-data node is the neutral line whatever
    its vendor, task items are UNCHECKED (a template starts undone), and an email address --
    written as text or as a `mailto:` link -- becomes the words "email address".
"""
from __future__ import annotations

import copy
import json
import re
from typing import Any, Iterable, Mapping
from urllib.parse import urlsplit

from fastapi import HTTPException
from fastapi.responses import FileResponse, JSONResponse

# ── The public-response contract ─────────────────────────────────────────────────────────
#
# ⛔ EVERY public response carries all four, the JSON and the image FileResponse alike, and
# every public MISS too (so a miss and a hit differ in status and body, never in these).
#   * Cache-Control: no-store, private -- a revoked link must stop at the CDN and in the
#     browser, not only on the server (dispatch plan R5; the zone's CDN rules are not
#     verified, which is exactly why the header is set rather than trusted).
#   * X-Robots-Tag: noindex, nofollow -- always noindex, no toggle (ruling D-B10).
#   * Referrer-Policy: no-referrer -- the token rides in the path (ruling D-B1).
#   * X-Content-Type-Options: nosniff -- the image proxy serves strangers bytes whose type
#     only the uploader DECLARED (the stored extension comes from the declared MIME and the
#     content is never verified), so a browser must use the type it is told and never guess
#     one from the bytes (wave-8 final review M-7).
PUBLIC_HEADERS: dict[str, str] = {
    "Cache-Control": "no-store, private",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
}

#: The image responses add one more (M-7): a proxied file opened on its own, as a document,
#: may load nothing and run nothing -- whatever its bytes turn out to be.
IMAGE_CSP = "default-src 'none'"
PUBLIC_IMAGE_HEADERS: dict[str, str] = {**PUBLIC_HEADERS, "Content-Security-Policy": IMAGE_CSP}

#: The ONE not-found body. Every public miss (unknown, revoked, expired, trashed, archived)
#: AND the flag-off path answer exactly this, so no answer tells a caller which it was.
NOT_FOUND_DETAIL = "Not found"


def not_found() -> HTTPException:
    """`raise not_found()` -- the one 404 every public miss and the flag-off path share."""
    return HTTPException(status_code=404, detail=NOT_FOUND_DETAIL, headers=dict(PUBLIC_HEADERS))


def public_json(content: Any) -> JSONResponse:
    return JSONResponse(content=content, headers=dict(PUBLIC_HEADERS))


def public_file(path: Any) -> FileResponse:
    return FileResponse(str(path), headers=dict(PUBLIC_IMAGE_HEADERS))


def enforce_rate(limit: str, scope: str, key: str, sentence: str, *, public: bool) -> None:
    """The inline slowapi hit (`notebook_personal_api.py`'s shape): one bucket per `scope`,
    counted per `key`, in `api/limiter.py`'s in-memory storage.

    ⚠️ PER-PROCESS STATE: a second web process would double every limit here (the CLAUDE.md
    single-process roster). Over the limit: 429 with a plain sentence."""
    from api.limiter import limiter
    if not limiter.enabled:
        return
    from limits import parse
    if not limiter.limiter.hit(parse(limit), scope, key):
        raise HTTPException(status_code=429, detail=sentence,
                            headers=dict(PUBLIC_HEADERS) if public else None)


def client_key(request: Any) -> str:
    """The caller's IP through the Limiter's OWN key function (`api/limiter.py` ->
    `request_ip.client_ip`, which trusts CF-Connecting-IP only behind a Cloudflare edge),
    never a second copy of it."""
    from api.limiter import limiter
    return "ip:" + str(limiter._key_func(request))


# ── What a public copy of a note is made of ──────────────────────────────────────────────

#: The public keys of a NOTE, exactly (rail: tests/test_share_publish_authorization.py).
PUBLIC_NOTE_KEYS = ("title", "subtitle", "bodyJson", "heroImageUrl", "updatedAt")

MODES = ("share", "publish", "gallery")

#: What an email address becomes in a gallery copy (wave 12, lane 12A).
EMAIL_TEXT = "email address"
_EMAIL_IN_TEXT = re.compile(r"(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+", re.IGNORECASE)

#: ONE neutral paragraph where a market-data item stood (ruling D-B4, extended to share
#: links by the owner's L3). Adjacent ones collapse to one.
NEUTRAL_LINE = "A market-data item is not shown on public pages."

#: What a noteLink becomes (ruling D-B7): no id and no title leaves.
LINKED_NOTE_TEXT = "linked note"

#: What an in-app ADDRESS written as text becomes (wave-8 walk W3). `_reduce_marks` drops an
#: internal link mark and keeps its text -- right for "my thesis" linked to a note, wrong when
#: the member pasted the address itself: then the text IS `https://uctintelligence.com/journal/
#: notebook?note=<id>`, and the other note's id reached the public page as plain text. The same
#: happens to an address pasted as plain text, with no mark at all. So every in-app address in a
#: public text node is replaced, whatever marks it carried.
IN_APP_LINK_TEXT = "in-app link"

_ATTACHMENT_PREFIX = "/api/j2/notes/attachments/"

SHOWN, NEUTRAL = "shown", "neutral"

# ── ⛔ THE VENDOR TABLE (owner legal sign-off 2026-09-25, L3 + correction) ────────────────
#
# node type (and, where one node carries many vendors, its discriminator) -> vendor.
#   widgetEmbed: the discriminator is `attrs.widgetId` (every id in app/src/widgets/registry.js
#                has a row; tests/test_public_note_payload.py derives the ids and fails by name).
#   financialFact: the discriminator is the fact's own `source` column
#                (j2_fact_observations.source: user | uct_derived | massive | fmp).
#   documentExcerpt: one row.
# Anything without a row is NEUTRAL.
MARKET_DATA_VENDORS: dict[tuple[str, str | None], str] = {
    # widgetEmbed -- the archived image is what a stranger would see.
    ("widgetEmbed", "chart"): "massive",          # candles from Massive bars
    ("widgetEmbed", "watchlist"): "massive",      # live prices / % change
    ("widgetEmbed", "themes"): "massive",         # per-holding returns from Massive bars
    ("widgetEmbed", "scanner"): "mixed",          # Massive OHLCV + Finviz screens
    ("widgetEmbed", "fundamentals"): "fmp",       # the earnings table (FMP); owner-named as shown
    ("widgetEmbed", "breadth"): "massive",        # breadth computed from Massive bars
    ("widgetEmbed", "indexes"): "massive",        # index prices
    ("widgetEmbed", "marketcontext"): "mixed",    # regime + prices
    ("widgetEmbed", "aisearch"): "mixed",         # an AI answer over several sources
    ("widgetEmbed", "news"): "mixed",             # AlphaVantage / RSS headlines
    ("widgetEmbed", "notebook"): "private",       # the member's OTHER notes -- never public
    ("widgetEmbed", "profile"): "mixed",          # AI profile + price statistics
    ("widgetEmbed", "alerts"): "private",         # the member's own alert list + prices
    ("widgetEmbed", "calendar"): "mixed",         # EarningsWhispers / Finviz / Finnhub
    ("widgetEmbed", "optionsflow"): "massive",    # the OPRA tape
    ("widgetEmbed", "periodsort"): "massive",     # returns from Massive bars
    ("widgetEmbed", "nhnl"): "massive",
    ("widgetEmbed", "nhnlPulse"): "massive",
    ("widgetEmbed", "volumescan"): "massive",
    ("widgetEmbed", "scatter"): "massive",
    # G-040 capture-only kinds (wave 10 L16): frozen snapshots saved into a note from
    # the Screener, COT and Model Book. Each mixes sources -- screen results over
    # Massive prices; CFTC positioning beside an ETF price proxy; the firm's curated
    # library beside Massive charts -- so each is the neutral line until decided.
    ("widgetEmbed", "screener"): "mixed",
    ("widgetEmbed", "cot"): "mixed",
    ("widgetEmbed", "modelbook"): "mixed",
    # financialFact -- by the fact's recorded source.
    ("financialFact", "fmp"): "fmp",
    ("financialFact", "finnhub"): "finnhub",
    ("financialFact", "massive"): "massive",      # the `price` fact type
    ("financialFact", "user"): "member",          # the member's own words ("my target: $195")
    ("financialFact", "uct_derived"): "private",  # derived from the member's trades
    # documentExcerpt -- D-B4 unchanged (the planner listed it as vendor data: an excerpt of
    # an uploaded filing or report). Not loosened here.
    ("documentExcerpt", None): "document",
    # tradeCanvas (wave 11 lane 11D) -- a trade plan: the member's own levels and
    # cards beside charts drawn from Massive bars. Mixed by construction, so it is
    # the neutral line until somebody decides what a stranger may see of a plan.
    ("tradeCanvas", None): "mixed",
}

#: vendor -> verdict. ⭐ Loosening Massive is this one line: "massive": SHOWN.
VENDOR_VERDICT: dict[str, str] = {
    "fmp": SHOWN,          # approved by the owner directly (P-7 correction, 2026-09-25)
    "finnhub": SHOWN,      # approved by the owner directly (P-7 correction, 2026-09-25)
    "member": SHOWN,       # the member's own content, not market data
    "massive": NEUTRAL,    # not named by the owner: charts and bars stay neutral
    "mixed": NEUTRAL,      # not attributable to an approved vendor alone (L3 as sent)
    "document": NEUTRAL,   # D-B4, unchanged
    "private": NEUTRAL,    # member-private, not a vendor question at all
}


def market_data_verdict(node_type: str, discriminator: str | None) -> str:
    vendor = MARKET_DATA_VENDORS.get((node_type, discriminator))
    return VENDOR_VERDICT.get(vendor, NEUTRAL) if vendor else NEUTRAL


# ── ⛔ THE NODE POLICY: every type in lib/notebookSchema.js, both modes ──────────────────
#
# Actions:
#   keep          the node stays (its children are reduced in turn)
#   mark          a mark that stays
#   link-mark     a `link` mark: stays unless its href points inside the app
#   drop          the node goes, with everything inside it
#   image         src rewritten to the public proxy; an image of ANOTHER note is dropped
#   figure        dropped when its image was dropped
#   linked-note   noteLink -> "linked note" (publish: a link, when the target is published)
#   citation-n    askCitation keeps only {n}
#   ask           askInsert: share keeps it (G-064 ruling); publish keeps writing help only
#   market-data   the vendor table decides: shown -> a public rendition; neutral -> NEUTRAL_LINE
#   neutral       gallery: the neutral line, whatever the vendor table says
#   task          gallery: a taskItem kept UNCHECKED (a template starts undone)
NODE_POLICY: dict[str, dict[str, str]] = {
    # ── nodes ──
    "doc": {"share": "keep", "publish": "keep", "gallery": "keep"},
    "paragraph": {"share": "keep", "publish": "keep", "gallery": "keep"},
    "text": {"share": "keep", "publish": "keep", "gallery": "keep"},
    "heading": {"share": "keep", "publish": "keep", "gallery": "keep"},
    "blockquote": {"share": "keep", "publish": "keep", "gallery": "keep"},
    "bulletList": {"share": "keep", "publish": "keep", "gallery": "keep"},
    "orderedList": {"share": "keep", "publish": "keep", "gallery": "keep"},
    "listItem": {"share": "keep", "publish": "keep", "gallery": "keep"},
    "taskList": {"share": "keep", "publish": "keep", "gallery": "keep"},
    "taskItem": {"share": "keep", "publish": "keep", "gallery": "task"},
    "codeBlock": {"share": "keep", "publish": "keep", "gallery": "keep"},
    "hardBreak": {"share": "keep", "publish": "keep", "gallery": "keep"},
    "horizontalRule": {"share": "keep", "publish": "keep", "gallery": "keep"},
    "table": {"share": "keep", "publish": "keep", "gallery": "keep"},
    "tableRow": {"share": "keep", "publish": "keep", "gallery": "keep"},
    "tableCell": {"share": "keep", "publish": "keep", "gallery": "keep"},
    "tableHeader": {"share": "keep", "publish": "keep", "gallery": "keep"},
    "callout": {"share": "keep", "publish": "keep", "gallery": "keep"},
    "toggle": {"share": "keep", "publish": "keep", "gallery": "keep"},
    "toggleSummary": {"share": "keep", "publish": "keep", "gallery": "keep"},
    "toggleContent": {"share": "keep", "publish": "keep", "gallery": "keep"},
    "videoTimestamp": {"share": "keep", "publish": "keep", "gallery": "keep"},
    "blockMath": {"share": "keep", "publish": "keep", "gallery": "keep"},
    "inlineMath": {"share": "keep", "publish": "keep", "gallery": "keep"},
    "columns": {"share": "keep", "publish": "keep", "gallery": "keep"},
    "column": {"share": "keep", "publish": "keep", "gallery": "keep"},
    "dateMention": {"share": "keep", "publish": "keep", "gallery": "keep"},
    "tableOfContents": {"share": "keep", "publish": "keep", "gallery": "keep"},
    "imageCaption": {"share": "keep", "publish": "keep", "gallery": "drop"},
    "linkPreview": {"share": "keep", "publish": "keep", "gallery": "keep"},   # the member's external link card
    "webEmbed": {"share": "keep", "publish": "keep", "gallery": "keep"},      # an allowlisted external embed
    "image": {"share": "image", "publish": "image", "gallery": "drop"},
    "imageFigure": {"share": "figure", "publish": "figure", "gallery": "drop"},
    "attachmentChip": {"share": "drop", "publish": "drop", "gallery": "drop"},  # file attachments never leave
    "noteLink": {"share": "linked-note", "publish": "linked-note", "gallery": "linked-note"},
    "askCitation": {"share": "citation-n", "publish": "drop", "gallery": "drop"},
    "askInsert": {"share": "keep", "publish": "ask", "gallery": "drop"},
    "widgetEmbed": {"share": "market-data", "publish": "market-data", "gallery": "neutral"},
    "financialFact": {"share": "market-data", "publish": "market-data", "gallery": "neutral"},
    "documentExcerpt": {"share": "market-data", "publish": "market-data", "gallery": "neutral"},
    "tradeCanvas": {"share": "market-data", "publish": "market-data", "gallery": "neutral"},  # wave 11 11D: a trade plan
    # ── marks ──
    "bold": {"share": "mark", "publish": "mark", "gallery": "mark"},
    "code": {"share": "mark", "publish": "mark", "gallery": "mark"},
    "italic": {"share": "mark", "publish": "mark", "gallery": "mark"},
    "strike": {"share": "mark", "publish": "mark", "gallery": "mark"},
    "underline": {"share": "mark", "publish": "mark", "gallery": "mark"},
    "textStyle": {"share": "mark", "publish": "mark", "gallery": "mark"},
    "highlight": {"share": "mark", "publish": "mark", "gallery": "mark"},
    "textColor": {"share": "mark", "publish": "mark", "gallery": "mark"},
    "link": {"share": "link-mark", "publish": "link-mark", "gallery": "link-mark"},
}

#: The widgetEmbed attributes a public copy keeps -- exactly what the archived render reads
#: (`WidgetEmbedView.jsx` ArchivedImage / PlaceholderChip / the frame): the image, the
#: frame's size, the caption the member wrote, and what `embedAutoCaption` needs for the alt
#: text. ⛔ Never `tradeRef` (names a member's trade), `searchText`, `annotations`, `ta`
#: (wave 13, see ATTR_POLICY) or `embedId`; and of `params`, only the keys `EMBED_PARAM_KEYS` names for that widget (the
#: widget's plain-text line reads them; the rest -- settings, frozen data -- stay home).
EMBED_KEPT_ATTRS = ("v", "widgetId", "mode", "capturedAt", "fallback", "frozen", "caption", "layout")

#: ⛔ THE ATTRIBUTE ROWS (wave 13, lane 13H-1). Every row of the schema's attribute table
#: (`notebook_schema.NOTEBOOK_ATTR_SCHEMA`, a non-optional attribute on an existing type) takes
#: a decision in EVERY public mode, exactly as every type takes a NODE_POLICY row;
#: tests/test_public_note_payload.py derives the row list from `lib/notebookSchema.js` and fails
#: by name on one with no decision. "drop" means the attribute never reaches a stranger.
#:
#:   widgetEmbed.ta  the chart's plan data: the member's setup tag, the technical fingerprint
#:                   frozen at insert, and the plan block (planned shares, which engine sized
#:                   them). Private trading intent, like `tradeRef`; and its plan levels live
#:                   in `annotations`, which no mode publishes either. Dropped in all three.
#:
#: A "drop" row is enforced by the embed allowlist above (`EMBED_KEPT_ATTRS` never names it),
#: and the rail asserts both halves, so adding the attribute to the allowlist goes red.
ATTR_POLICY: dict[str, dict[str, str]] = {
    "widgetEmbed.ta": {"share": "drop", "publish": "drop", "gallery": "drop"},
}
EMBED_PARAM_KEYS: dict[str, tuple[str, ...]] = {
    "fundamentals": ("symbol", "view"),
}

#: Container types whose schema requires content: emptied by a drop, they get one empty
#: paragraph rather than becoming a document the editor refuses to read.
_BLOCK_CONTAINERS = frozenset({
    "doc", "blockquote", "listItem", "taskItem", "tableCell", "tableHeader", "askInsert",
    "callout", "toggleContent", "column",
})

_EXTERNAL_HREF = re.compile(r"^(https?:|mailto:)", re.IGNORECASE)
_OWN_HOSTS = ("uctintelligence.com",)


def _internal_href(href: Any) -> bool:
    """A link that points INSIDE the app -- a relative path (another note, a trade, an API)
    or an absolute URL on our own host. Those lose the link and keep their text.

    The host is also read the way a browser reads it (wave-8 final review M-6): an address
    whose userinfo hides our host (`https://example.com@uctintelligence.com/...`) is ours,
    and one that cannot be parsed, or has no host at all, is not trusted as external."""
    if not isinstance(href, str) or not href.strip():
        return True
    h = href.strip()
    if not _EXTERNAL_HREF.match(h):
        return True
    low = h.lower()
    if any(f"//{host}" in low or f".{host}" in low for host in _OWN_HOSTS):
        return True
    if low.startswith("mailto:"):
        return False
    try:
        host = (urlsplit(h).hostname or "").lower().rstrip(".")
    except ValueError:
        return True
    if not host:
        return True
    return any(host == own or host.endswith("." + own) for own in _OWN_HOSTS)


_WEB_URL = re.compile(r"^https?://", re.IGNORECASE)

# What an address looks like inside prose, four ways (the same forms the M-6 rail drives through
# the node attributes): an absolute http(s) address; a protocol-relative one on OUR host (never
# any `//word`, which is ordinary text); a relative in-app path (`/journal/...`, `/api/...`) that
# does not continue a longer path; and a bare `?note=<id>` / `&note=<id>` query. Trailing
# sentence punctuation is handed back, not swallowed.
_ADDRESS_IN_TEXT = re.compile(
    r"https?://[^\s<>\"'()\[\]]+"
    r"|(?<![:\w])//(?:[\w-]+\.)*uctintelligence\.com(?![\w.-])[^\s<>\"'()\[\]]*"
    r"|(?<![\w/.])/(?:journal|api)/[^\s<>\"'()\[\]]*"
    r"|(?<![\w/])[?&]note=[^\s<>\"'()\[\]&]+",
    re.IGNORECASE)
_TRAILING_PUNCT = ".,;:!?"
# The two PUBLIC doors on our own host (`lib/notePublishLink.js` PUBLISHED_PATH,
# `lib/noteShareLink.js` SHARED_NOTE_PATH): an address the member already made public carries a
# slug or token, never a note id, so it stays readable.
_PUBLIC_PATH_PREFIXES = ("/p/", "/share/n/")


def _is_public_address(address: str) -> bool:
    try:
        absolute = _WEB_URL.match(address) or address.startswith("//")
        path = urlsplit(address).path if absolute else address.split("?", 1)[0]
    except ValueError:
        return False
    return path.startswith(_PUBLIC_PATH_PREFIXES)


_IN_APP_PATHS = ("/journal/", "/api/")
_NOTE_QUERY = re.compile(r"(^|[?&])note=", re.IGNORECASE)


def _in_app_shape(href: Any) -> bool:
    """GALLERY MODE ONLY (wave 12 12A walk run 2, `0b80ee9945` G1): an address that LOOKS like
    one of this app's -- a `/journal/` or `/api/` path, or a `note=` query -- whatever host it
    names. `_internal_href` decides by HOST, so the app reached through any other name (a
    sandbox's 127.0.0.1, the Railway service address) passed as external and a pasted
    `.../journal/notebook?note=<id>` kept the other note's id. Share and publish are unchanged
    (that is the owner's question, docs/notebook/wave12-12a.md); a template is copied into
    strangers' notebooks, so it errs further."""
    if not isinstance(href, str) or not _WEB_URL.match(href.strip()):
        return False
    try:
        parts = urlsplit(href.strip())
    except ValueError:
        return True
    return parts.path.startswith(_IN_APP_PATHS) or bool(_NOTE_QUERY.search(parts.query or ""))


def _scrub_in_app_addresses(text: str, strict: bool = False) -> str:
    """`text` with every in-app address replaced by `IN_APP_LINK_TEXT`; an external address and
    a public page's own address stay. `strict` (gallery mode) also replaces an address that has
    an in-app SHAPE on any host (`_in_app_shape`)."""
    def repl(m: "re.Match[str]") -> str:
        s = m.group(0)
        core = s.rstrip(_TRAILING_PUNCT)
        tail = s[len(core):]
        if core and _internal_href(core) and not _is_public_address(core):
            return IN_APP_LINK_TEXT + tail
        if core and strict and _in_app_shape(core) and not _is_public_address(core):
            return IN_APP_LINK_TEXT + tail
        return s
    return _ADDRESS_IN_TEXT.sub(repl, text)


def scrub_emails(text: str) -> str:
    """`text` with every email address replaced by `EMAIL_TEXT` (gallery mode)."""
    return _EMAIL_IN_TEXT.sub(EMAIL_TEXT, text) if isinstance(text, str) else text


def scrub_gallery_text(text: Any) -> str:
    """A gallery template's own plain-text fields (its title, its description): the same two
    rules its body's text nodes get -- in-app addresses and email addresses go."""
    if not isinstance(text, str):
        return ""
    return scrub_emails(_scrub_in_app_addresses(text, strict=True))


# ── ⛔ THE GALLERY ATTRIBUTE TABLE (security review I-4, and M-8) ─────────────────────────
#
# A gallery template is copied into OTHER MEMBERS' notebooks and opened in their editor, so
# what it carries is decided attribute by attribute, not type by type. Before this table the
# gallery copy kept every attribute of a kept node and every attribute of a kept mark, and
# TipTap's FontFamily and FontSize write theirs straight into an inline `style`
# (`font-family: ${attributes.fontFamily}`), so a published template could put CSS into
# another member's editor. The admin preview does not render that style, so a reviewer could
# not see it.
#
# The rule, in gallery mode only:
#   * a node keeps `type`, `attrs`, `content`, `marks` and (a text node) `text`: no other key;
#   * a mark keeps `type` and `attrs`: no other key;
#   * an attribute travels only when its type has a row here AND the row names it AND its
#     value passes the row's check. Anything else is left out, and the editor fills in the
#     attribute's own default. A type with no row carries no attributes at all (fail closed);
#   * text inside an attribute gets the same scrub a text node gets (emails and in-app
#     addresses), which is finding M-8.
#
# ⛔ THE VALUE LISTS ARE THE CLIENT'S, held equal by tests/test_notebook_fin_sec_gallery_attrs.py,
# which PARSES the client files: the toolbar's font table (app/src/utils/fontFamilies.js), the
# colour palette (lib/textColor.js NOTE_COLORS), the callout styles (lib/calloutNode.js) and
# the embed providers (lib/webEmbeds.js).
#
# Share links and published pages are NOT changed here: they predate the reviewed diff, they
# are rendered read-only on a public page rather than copied into another member's editor,
# and narrowing them is a separate decision (docs/notebook/fin-sec.md).

GALLERY_FONT_FAMILIES: tuple[str, ...] = (
    "Instrument Sans, Arial, sans-serif",
    'Georgia, "Times New Roman", serif',
    'Consolas, "Courier New", monospace',
    "Arial, Helvetica, sans-serif",
    "Helvetica, Arial, sans-serif",
    "Verdana, Geneva, sans-serif",
    "Tahoma, Geneva, sans-serif",
    '"Trebuchet MS", Helvetica, sans-serif',
    "Calibri, Candara, sans-serif",
    '"Century Gothic", sans-serif',
    "Georgia, serif",
    '"Times New Roman", Times, serif',
    "Garamond, serif",
    '"Palatino Linotype", "Book Antiqua", Palatino, serif',
    "Cambria, Georgia, serif",
    'Baskerville, "Baskerville Old Face", serif',
    '"Courier New", Courier, monospace',
    "Consolas, monospace",
    '"Lucida Sans Unicode", "Lucida Grande", sans-serif',
    '"Comic Sans MS", "Comic Sans", cursive',
    "Impact, Haettenschweiler, sans-serif",
    '"Brush Script MT", cursive',
)
#: A font size is a whole number of CSS pixels in this range, written `<n>px`.
GALLERY_FONT_SIZE_RANGE = (8, 96)
GALLERY_COLOR_NAMES: tuple[str, ...] = ("gray", "red", "orange", "yellow", "green", "blue")
GALLERY_CALLOUT_VARIANTS: tuple[str, ...] = ("note", "info", "success", "warning", "danger")
#: provider -> the pattern its id must match (lib/webEmbeds.js YOUTUBE_ID, TRADINGVIEW_REF).
GALLERY_EMBED_REFS: dict[str, "re.Pattern[str]"] = {
    "youtube": re.compile(r"^[A-Za-z0-9_-]{11}$"),
    "tradingview": re.compile(r"^(?:[A-Z0-9_]{1,20}:)?[A-Z0-9._!]{1,30}$"),
}
GALLERY_MAX_URL_CHARS = 2048

_OMIT = object()          # leave this attribute out
_DROP_NODE = object()     # drop the whole node

_FONT_SIZE = re.compile(r"^([0-9]{1,3})px$")
_SAFE_URL = re.compile(r"^https?://[^\s<>\"'`\\]+$", re.IGNORECASE)
_ISO_DAY = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
_CODE_LANGUAGE = re.compile(r"^[A-Za-z0-9+#_.-]{1,32}$")
_EMBED_REF_SHAPE = re.compile(r"^[A-Za-z0-9._!:_-]{1,64}$")
_DOMAIN = re.compile(r"^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$")
_EMOJI_BAD = re.compile(r"[\x00-\x1f\x7f<>\"'`&;:(){}\\/=\s]")
# KaTeX commands that make a link, load a file or set HTML attributes. A template has no use
# for them, so a formula that names one does not travel at all.
_LATEX_ACTIVE = re.compile(r"\\(?:href|url|includegraphics|html(?:Class|Id|Style|Data))(?![A-Za-z])")


def _one_of(*allowed: Any):
    def check(v: Any) -> Any:
        return v if any(v is a or (type(v) is type(a) and v == a) for a in allowed) else _OMIT
    return check


def _int_in(lo: int, hi: int):
    def check(v: Any) -> Any:
        return v if type(v) is int and lo <= v <= hi else _OMIT
    return check


def _v_bool(v: Any) -> Any:
    return v if isinstance(v, bool) else _OMIT


def _v_font_size(v: Any) -> Any:
    if v is None:
        return None
    m = _FONT_SIZE.match(v) if isinstance(v, str) else None
    if m and GALLERY_FONT_SIZE_RANGE[0] <= int(m.group(1)) <= GALLERY_FONT_SIZE_RANGE[1]:
        return v
    return _OMIT


def _v_url(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, str) and len(v) <= GALLERY_MAX_URL_CHARS and _SAFE_URL.match(v):
        return v
    return _OMIT


def _v_text(limit: int):
    def check(v: Any) -> Any:
        if v is None:
            return None
        if not isinstance(v, str):
            return _OMIT
        return scrub_gallery_text(v)[:limit]
    return check


def _v_domain(v: Any) -> Any:
    if v is None:
        return None
    return v if isinstance(v, str) and _DOMAIN.match(v) else _OMIT


def _v_latex(v: Any) -> Any:
    if not isinstance(v, str) or len(v) > 4000 or _LATEX_ACTIVE.search(v):
        return _DROP_NODE
    return scrub_gallery_text(v)


def _v_seconds(v: Any) -> Any:
    return v if type(v) in (int, float) and 0 <= v <= 864_000 else _OMIT


def _v_colwidth(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, list) and 1 <= len(v) <= 50 and all(type(w) is int and 20 <= w <= 2000 for w in v):
        return v
    return _OMIT


def _v_emoji(v: Any) -> Any:
    return v if isinstance(v, str) and 1 <= len(v) <= 16 and not _EMOJI_BAD.search(v) else _OMIT


def _v_str(pattern: "re.Pattern[str]", *, none_ok: bool = True):
    def check(v: Any) -> Any:
        if v is None:
            return None if none_ok else _OMIT
        return v if isinstance(v, str) and pattern.match(v) else _OMIT
    return check


_CELL_ATTRS = {
    "colspan": _int_in(1, 50), "rowspan": _int_in(1, 50), "colwidth": _v_colwidth,
    "align": _one_of(None, "left", "center", "right"),
}

#: type (node or mark) -> {attribute: check}. A check returns the value to keep (cleaned),
#: `_OMIT` to leave the attribute out, or `_DROP_NODE`.
GALLERY_ATTR_POLICY: dict[str, dict[str, Any]] = {
    # ── nodes ──
    "heading": {"level": _int_in(1, 6)},
    "orderedList": {"start": _int_in(0, 1_000_000), "type": _one_of(None, "1", "a", "A", "i", "I")},
    "codeBlock": {"language": _v_str(_CODE_LANGUAGE)},
    "taskItem": {"checked": _one_of(False)},
    "tableHeader": _CELL_ATTRS,
    "tableCell": _CELL_ATTRS,
    "callout": {"emoji": _v_emoji, "variant": _one_of(None, *GALLERY_CALLOUT_VARIANTS)},
    "toggle": {"open": _v_bool},
    "linkPreview": {"url": _v_url, "title": _v_text(300), "description": _v_text(600),
                    "domain": _v_domain, "image": _one_of(None)},
    "webEmbed": {"provider": _one_of(*GALLERY_EMBED_REFS), "ref": _v_str(_EMBED_REF_SHAPE, none_ok=False),
                 "url": _v_url},
    "dateMention": {"date": _v_str(_ISO_DAY)},
    "videoTimestamp": {"seconds": _v_seconds},
    "inlineMath": {"latex": _v_latex},
    "blockMath": {"latex": _v_latex},
    # ── marks ──
    "link": {"href": _v_url},                       # target and rel are SET, never copied
    "textStyle": {"fontFamily": _one_of(None, *GALLERY_FONT_FAMILIES), "fontSize": _v_font_size},
    "textColor": {"color": _one_of(*GALLERY_COLOR_NAMES)},
    "highlight": {"color": _one_of(None, *GALLERY_COLOR_NAMES)},
}

#: What a gallery link always carries, whatever the stored mark said.
GALLERY_LINK_FIXED = {"target": "_blank", "rel": "noreferrer"}


def _gallery_attrs(type_name: Any, attrs: Any) -> Any:
    """The attributes of one node or mark that a gallery copy keeps: a dict (possibly empty),
    or `_DROP_NODE`."""
    rows = GALLERY_ATTR_POLICY.get(type_name) if isinstance(type_name, str) else None
    if not rows or not isinstance(attrs, dict):
        return {}
    kept: dict[str, Any] = {}
    for name, check in rows.items():
        if name not in attrs:
            continue
        value = check(attrs[name])
        if value is _DROP_NODE:
            return _DROP_NODE
        if value is not _OMIT:
            kept[name] = value
    return kept


def _gallery_mark(mark: dict) -> dict | None:
    """One kept mark, reduced to its named attributes; None when nothing of it is left."""
    t = mark.get("type")
    attrs = _gallery_attrs(t, mark.get("attrs"))
    if t == "link":
        if not isinstance(attrs.get("href"), str):
            return None                              # not an http(s) address: the words stay
        return {"type": "link", "attrs": {"href": attrs["href"], **GALLERY_LINK_FIXED}}
    if t == "textStyle" and not any(v is not None for v in attrs.values()):
        return None                                  # a style mark that styles nothing
    if t == "textColor" and "color" not in attrs:
        return None
    out: dict[str, Any] = {"type": t}
    if t in GALLERY_ATTR_POLICY and isinstance(mark.get("attrs"), dict):
        out["attrs"] = attrs
    return out


def _gallery_node(out: dict) -> dict | None:
    """One kept node, reduced to the keys and attributes a gallery copy carries. None drops it."""
    t = out.get("type")
    attrs = _gallery_attrs(t, out.get("attrs"))
    if attrs is _DROP_NODE:
        return None
    if t == "webEmbed":
        pattern = GALLERY_EMBED_REFS.get(attrs.get("provider"))
        if pattern is None or not isinstance(attrs.get("ref"), str) or not pattern.match(attrs["ref"]):
            attrs.pop("provider", None)              # not a player this app can build:
            attrs.pop("ref", None)                   # it reads as a plain link, or nothing
    if t == "linkPreview" and not isinstance(attrs.get("url"), str):
        return None                                  # a card with no address is nothing
    node: dict[str, Any] = {"type": t}
    if t in GALLERY_ATTR_POLICY and isinstance(out.get("attrs"), dict):
        node["attrs"] = attrs
    if t == "text" and isinstance(out.get("text"), str):
        node["text"] = out["text"]
    return node


def _public_image_src(src: Any, attachment_base: str) -> str | None:
    """`src` when a stranger's page may load it, else None (wave-8 final review M-6).

    Two kinds of address qualify, and only two: THIS note's own attachment, already
    rewritten to the public proxy (it starts with `attachment_base`), or an http(s) address
    off our own host. Everything else goes -- another note's attachment, a relative in-app
    path (`/journal/notebook?note=<id>` names a note), our own host, `data:`, `javascript:`,
    a protocol-relative `//host/...` -- because an image-bearing attribute is a URL the
    stranger's browser fetches, and an in-app one carries a note or member id with it."""
    if not isinstance(src, str):
        return None
    s = src.strip()
    if not s or _ATTACHMENT_PREFIX in s:
        return None
    if attachment_base and s.startswith(attachment_base):
        rest = s[len(attachment_base):]
        return src if ".." not in rest and "\\" not in rest else None
    if _WEB_URL.match(s) and not _internal_href(s):
        return src
    return None


class _Ctx:
    def __init__(self, mode: str, facts: Mapping[str, Mapping[str, Any]],
                 note_links: Mapping[str, tuple[str, str]], attachment_base: str = ""):
        self.mode = mode
        self.facts = facts
        self.note_links = note_links
        self.attachment_base = attachment_base


def _kept_urls(t: str, node: dict, ctx: _Ctx) -> dict | None:
    """The URL attributes of a KEPT node, reduced (wave-8 final review M-6). None drops the
    node. `link` marks already lose an in-app href (`_reduce_marks`); these are the node
    attributes that carry a URL of their own:
      * linkPreview.url -- a card whose address is in-app (a note id pasted as a link and
        turned into a card) is DROPPED: its title and description were fetched from that
        in-app page, so there is nothing of it a stranger should see;
      * linkPreview.image -- only a public image source survives (`_public_image_src`);
      * webEmbed.url -- an in-app fallback address is cleared; the player is rebuilt from
        `{provider, ref}` on render (webEmbeds.js), never from this string."""
    attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
    if t == "linkPreview":
        if _internal_href(attrs.get("url")) or (ctx.mode == "gallery" and _in_app_shape(attrs.get("url"))):
            return None
        if ctx.mode == "gallery" and attrs.get("image") is not None:
            return {**node, "attrs": {**attrs, "image": None}}     # gallery: no image of any kind
        if attrs.get("image") is not None and _public_image_src(attrs.get("image"), ctx.attachment_base) is None:
            node = {**node, "attrs": {**attrs, "image": None}}
        return node
    if t == "webEmbed":
        url = attrs.get("url")
        if url is not None and (_internal_href(url) or (ctx.mode == "gallery" and _in_app_shape(url))):
            node = {**node, "attrs": {**attrs, "url": None}}
        return node
    return node


def _neutral() -> dict:
    return {"type": "paragraph", "content": [{"type": "text", "text": NEUTRAL_LINE}]}


def _is_neutral(node: Any) -> bool:
    return (isinstance(node, dict) and node.get("type") == "paragraph"
            and node.get("content") == [{"type": "text", "text": NEUTRAL_LINE}])


def _reduce_marks(marks: Any, mode: str = "share") -> list | None:
    if not isinstance(marks, list):
        return None
    out = []
    for m in marks:
        if not isinstance(m, dict):
            continue
        policy = NODE_POLICY.get(m.get("type"))
        if policy is None:
            continue                                 # an unknown mark: its text stays, it goes
        action = policy["share"]                     # marks read the same in both modes
        if action == "link-mark":
            href = (m.get("attrs") or {}).get("href")
            if _internal_href(href):
                continue
            if mode == "gallery" and (str(href).strip().lower().startswith("mailto:") or _in_app_shape(href)):
                continue                             # gallery: an address is personal; the words stay
        if action in ("mark", "link-mark"):
            if mode == "gallery":
                m = _gallery_mark(m)                 # the attribute table (I-4)
                if m is None:
                    continue
            out.append(m)
    return out


def _format_fact_value(fact: Mapping[str, Any]) -> str:
    unit = fact.get("unit")
    num = fact.get("value_number")
    if num is not None and unit in ("usd", "usd_per_share"):
        return f"${float(num):,.2f}"
    if num is not None and unit == "percent":
        return f"{float(num):.2f}%"
    if num is not None:
        return f"{num}"
    return str(fact.get("value_text") or "").strip()


def _fact_paragraph(fact: Mapping[str, Any]) -> dict | None:
    """A shown fact, as the plain text a reader needs: what it is, its value, and when it was
    captured. The public page cannot mount the fact card (it resolves through the owner's
    notes API), so the figure travels as text -- and the fact's id never leaves."""
    from api.services.journal_two import fact_registry
    ftype = fact_registry.get_fact_type(str(fact.get("fact_type") or ""))
    label = ftype.label if ftype else str(fact.get("fact_type") or "Fact")
    value = _format_fact_value(fact)
    if not value:
        return None
    ticker = str(fact.get("ticker") or "").strip()
    period = str(fact.get("period") or "").strip()
    head = f"{ticker} · {label}" if ticker else label
    if period:
        head += f" ({period})"
    text = f"{head}: {value}"
    caption = str(fact.get("caption") or "").strip()
    if caption:
        text += f" — {caption}"
    observed = str(fact.get("observed_at") or "")[:10]
    if observed:
        text += f" (captured {observed})"
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def _market_data(node: dict, ctx: _Ctx) -> list:
    t = node.get("type")
    attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
    if t == "widgetEmbed":
        widget_id = attrs.get("widgetId")
        if market_data_verdict("widgetEmbed", widget_id) != SHOWN:
            return [_neutral()]
        kept = {k: copy.deepcopy(attrs[k]) for k in EMBED_KEPT_ATTRS if k in attrs}
        params = attrs.get("params") if isinstance(attrs.get("params"), dict) else {}
        kept["params"] = {k: params[k] for k in EMBED_PARAM_KEYS.get(widget_id, ()) if k in params}
        fallback = kept.get("fallback")
        if isinstance(fallback, dict):
            url = fallback.get("url")
            if _public_image_src(url, ctx.attachment_base) is None:
                kept["fallback"] = None              # another note's image, or an in-app address
            else:
                kept["fallback"] = {k: fallback[k] for k in ("url", "w", "h") if k in fallback}
        return [{"type": "widgetEmbed", "attrs": kept}]
    if t == "financialFact":
        fact = ctx.facts.get(str(attrs.get("factId") or ""))
        if not fact:
            return []                                # not this note's fact: nothing to show
        if str(fact.get("rights_class") or "") == "blocked":
            return [_neutral()]
        if market_data_verdict("financialFact", str(fact.get("source") or "")) != SHOWN:
            return [_neutral()]
        para = _fact_paragraph(fact)
        return [para] if para else []
    # documentExcerpt (and any future market-data row with no public rendition)
    return [_neutral()] if market_data_verdict(t, None) != SHOWN else []


def _reduce_children(children: Any, ctx: _Ctx) -> list:
    out: list = []
    for child in children or []:
        for reduced in _reduce_node(child, ctx):
            if _is_neutral(reduced) and out and _is_neutral(out[-1]):
                continue                             # ONE neutral line for a run of them
            out.append(reduced)
    return out


def _reduce_node(node: Any, ctx: _Ctx) -> list:
    """One stored node -> the list of nodes that replace it in the public copy (0, 1, ...)."""
    if not isinstance(node, dict):
        return []
    t = node.get("type")
    policy = NODE_POLICY.get(t)
    if policy is None:
        return []                                    # ⛔ unknown type: fail closed
    action = policy[ctx.mode]
    if action == "drop":
        return []
    if action == "neutral":
        return [_neutral()]
    if action == "market-data":
        return _market_data(node, ctx)
    if action == "linked-note":
        target = str((node.get("attrs") or {}).get("noteId") or "")
        if ctx.mode == "publish" and target in ctx.note_links:
            href, title = ctx.note_links[target]
            return [{"type": "text", "text": title or "Untitled",
                     "marks": [{"type": "link", "attrs": {"href": href}}]}]
        return [{"type": "text", "text": LINKED_NOTE_TEXT}]
    if action == "citation-n":
        attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
        return [{"type": "askCitation", "attrs": {"n": attrs.get("n")}}]
    if action == "ask" and not (node.get("attrs") or {}).get("action"):
        return []                                    # an Ask answer: publish never carries it
    if action == "image":
        src = (node.get("attrs") or {}).get("src")
        if _public_image_src(src, ctx.attachment_base) is None:
            return []                                # another note's image, or an in-app address
    if t in ("linkPreview", "webEmbed"):
        kept = _kept_urls(t, node, ctx)
        if kept is None:
            return []
        node = kept
    out = {k: v for k, v in node.items() if k not in ("content", "marks")}
    if action == "task":
        attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
        out["attrs"] = {**attrs, "checked": False}
    if t == "text" and isinstance(out.get("text"), str):
        out["text"] = _scrub_in_app_addresses(out["text"], strict=ctx.mode == "gallery")  # walk W3
        if ctx.mode == "gallery":
            out["text"] = scrub_emails(out["text"])
    if ctx.mode == "gallery":
        cleaned = _gallery_node(out)                 # the attribute table (I-4)
        if cleaned is None:
            return []
        out = cleaned
    if "marks" in node:
        marks = _reduce_marks(node.get("marks"), ctx.mode)
        if marks is not None and (marks or not node.get("marks")):
            out["marks"] = marks                     # an empty list stays empty; an emptied one goes
    if "content" in node:
        had = bool(node.get("content"))
        content = _reduce_children(node.get("content"), ctx)
        if action == "figure" and not any(c.get("type") == "image" for c in content):
            return []                                # a figure whose image was dropped
        if had and not content and t in _BLOCK_CONTAINERS:
            content = [{"type": "paragraph"}]
        out["content"] = content
    return [out]


def reduce(
    body: Any,
    *,
    mode: str,
    owner_id: str,
    note_id: str,
    attachment_base: str,
    facts: Mapping[str, Mapping[str, Any]] | None = None,
    note_links: Mapping[str, tuple[str, str]] | None = None,
) -> dict:
    """The public copy of one note's body.

    `attachment_base` is where THIS note's attachments are served publicly (the share or
    publish proxy, ending in "/"). `facts` maps this note's fact ids to their rows
    (`public_facts`). `note_links` (publish only) maps a target note id to
    `(public href, title)` for targets inside the same publication.
    """
    if mode not in MODES:
        raise ValueError(f"unknown public mode {mode!r}")
    doc = body if isinstance(body, dict) and body.get("type") == "doc" else {"type": "doc", "content": []}
    raw = json.dumps(doc).replace(f"{_ATTACHMENT_PREFIX}{owner_id}/{note_id}/", attachment_base)
    ctx = _Ctx(mode, facts or {}, note_links or {}, attachment_base)
    reduced = _reduce_node(json.loads(raw), ctx)
    if not reduced or reduced[0].get("type") != "doc":
        return {"type": "doc", "content": [{"type": "paragraph"}]}
    out = reduced[0]
    if not out.get("content"):
        out["content"] = [{"type": "paragraph"}]
    return out


def public_hero(hero: Any, *, owner_id: str, note_id: str, attachment_base: str) -> str | None:
    """The hero image, rewritten to the public proxy; another note's image, and any address
    that is not this note's proxy or an http(s) address off our own host, goes (M-6)."""
    if not isinstance(hero, str) or not hero:
        return None
    h = hero.replace(f"{_ATTACHMENT_PREFIX}{owner_id}/{note_id}/", attachment_base)
    return h if _public_image_src(h, attachment_base) is not None else None


def public_note(note: Mapping[str, Any], *, mode: str, owner_id: str, note_id: str,
                attachment_base: str, facts: Mapping[str, Mapping[str, Any]] | None = None,
                note_links: Mapping[str, tuple[str, str]] | None = None) -> dict:
    """The public payload of one note: EXACTLY `PUBLIC_NOTE_KEYS`."""
    return {
        "title": note.get("title") or "",
        "subtitle": note.get("subtitle"),
        "bodyJson": reduce(note.get("bodyJson") or {}, mode=mode, owner_id=owner_id,
                           note_id=note_id, attachment_base=attachment_base, facts=facts,
                           note_links=note_links),
        "heroImageUrl": public_hero(note.get("heroImageUrl"), owner_id=owner_id,
                                    note_id=note_id, attachment_base=attachment_base),
        "updatedAt": note.get("updatedAt"),
    }


def read_public_note(conn: Any, owner_id: str, note_id: str) -> dict[str, Any] | None:
    """The columns a public copy is built from, when the note may be served at all: owned
    by `owner_id`, neither trashed nor archived. None otherwise, and None for a body that
    does not parse (fail closed: a stranger never gets a half-read document).

    ⛔ A PLAIN SELECT, NEVER `notes.get_note`. `get_note` lazily backfills
    `first_image_url` with an UPDATE on first read, so a stranger opening a public link
    could write a column of the owner's row (finding F-READ-WRITES). A public GET writes
    nothing (rail: tests/test_share_publish_authorization.py, test_11)."""
    row = conn.execute(
        "SELECT title, subtitle, body_json, hero_image_url, updated_at FROM j2_notes"
        " WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND archived_at IS NULL",
        (note_id, owner_id),
    ).fetchone()
    if row is None:
        return None
    try:
        body = json.loads(row["body_json"] or '{"type": "doc", "content": []}')
    except (TypeError, ValueError):
        return None
    return {
        "title": row["title"] or "",
        "subtitle": row["subtitle"],
        "bodyJson": body,
        "heroImageUrl": row["hero_image_url"],
        "updatedAt": row["updated_at"],
    }


def public_facts(conn: Any, owner_id: str, note_id: str) -> dict[str, dict[str, Any]]:
    """This note's facts, by id -- ONLY rows the note's owner captured into this note, so a
    fact id pasted in from elsewhere resolves to nothing."""
    try:
        rows = conn.execute(
            "SELECT id, ticker, fact_type, period, value_number, value_text, unit, observed_at,"
            " source, rights_class, caption FROM j2_fact_observations"
            " WHERE note_id = ? AND user_id = ?",
            (note_id, owner_id),
        ).fetchall()
    except Exception:  # noqa: BLE001 -- no fact table means no facts, never a failed page
        return {}
    return {str(r["id"]): dict(r) for r in rows}


def walk_types(doc: Any) -> Iterable[str]:
    """Every node and mark type in a doc (the rails' scanner)."""
    if isinstance(doc, dict):
        if isinstance(doc.get("type"), str):
            yield doc["type"]
        for m in doc.get("marks") or []:
            if isinstance(m, dict) and isinstance(m.get("type"), str):
                yield m["type"]
        for c in doc.get("content") or []:
            yield from walk_types(c)


__all__ = [
    "PUBLIC_HEADERS", "PUBLIC_IMAGE_HEADERS", "IMAGE_CSP", "NOT_FOUND_DETAIL", "PUBLIC_NOTE_KEYS", "NEUTRAL_LINE", "LINKED_NOTE_TEXT",
    "NODE_POLICY", "MARKET_DATA_VENDORS", "VENDOR_VERDICT", "EMBED_KEPT_ATTRS", "EMBED_PARAM_KEYS",
    "ATTR_POLICY", "GALLERY_ATTR_POLICY", "GALLERY_FONT_FAMILIES", "GALLERY_FONT_SIZE_RANGE",
    "GALLERY_COLOR_NAMES", "GALLERY_CALLOUT_VARIANTS", "GALLERY_EMBED_REFS", "GALLERY_LINK_FIXED",
    "SHOWN", "NEUTRAL", "MODES", "not_found", "public_json", "public_file", "enforce_rate",
    "client_key", "market_data_verdict", "reduce", "public_hero", "public_note", "public_facts",
    "read_public_note", "walk_types",
]
