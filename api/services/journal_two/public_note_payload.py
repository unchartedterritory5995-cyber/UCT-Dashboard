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
  * example only (Notebook P3b, Task 2: an author's note attached to a style they share, as an
    EXAMPLE NOTE other members see) -- gallery's rules, through the SAME code path (ruling P3b-R3:
    `node_action` falls back to the gallery column for every row), except a DECLARED override set,
    `EXAMPLE_OVERRIDES`: an image is kept only when it is THIS note's own attachment AND the author
    switched it on (`images_on`), with its src rewritten by `image_src_for` to the gallery image
    route (P3b-T2-R13); its alt text is kept, scrubbed (R4), its title goes; a figure follows its
    image; a kept caption's text is scrubbed; a link mark is REMOVED and its words stay, and a link
    card or web embed is DROPPED (R8: an address can carry an account number, an email, a broker
    domain). On top of gallery's realisation: a trader block (`trader_blocks.BLOCK_IDS`) is reset to
    its builder's NO-READ empty params, filtered through the embed allowlist; a private embed
    (vendor "private" and not a block: the member's notes, alerts) is dropped; a financial fact is
    the words "your value here"; a formula whose expression holds a replacement is replaced whole by
    those words (R7). Every text -- a text node, and the attribute text a node keeps -- goes through
    `example_sanitize`: URLs first (replaced whole), then money, P&L figures, account ids and broker
    names. `report=` collects one change entry per replacement, `{kind, before, after, path}`.

    The change entries (`path`: the child indices, from the doc root, of the node in the REDUCED
    body where `after` sits; for a node that is dropped, the index where it would have stood). The
    kinds are `example_sanitize.KINDS`, the one list; this table and every kind the code can emit
    are railed against it (ruling P3b-T2-R22):
      kind           made by                                          `before` holds
      `money`        an amount in text or alt text; a formula holding   the amount (the formula)
                     any replacement (R7)
      `pnl_figure`   an R or % figure beside a P&L word                 the figure
      `account`      an account or card number, a broker-style id       the number
      `broker`       a broker name (house list, the author's own)       the name
      `link`         a URL in prose; a link mark removed (R8, R9)       the address
      `email`        an email address in text; a mailto link removed    the address
      `trade_link`   a trade reference on a block; an in-app trade      the reference or path
                     link or address
      `block_reset`  a trader block reset to its empty params           the author's params (JSON)
      `fact`         a financial fact replaced                          the fact's value, if known
      `market_data`  a market-data node replaced by the neutral line    the widget id or node type
      `image_off`    an image not shown (off, not this note's, or no    the file name
                     gallery address for it)
      `dropped`      anything else that goes or loses text: a link      the node type, address or
                     card, a web embed, an Ask insert or citation, an   text that went
                     attachment chip, a private embed, an unknown node
                     or mark, a node the attribute table refuses, a
                     noteLink (becomes "linked note"), an in-app
                     address, a block's caption, an image's title
    Unchecking a task item (gallery's rule) records no entry. `before` is at most 60 characters of
    the author's own text and is returned only, never stored or logged. Known limit (R7): text is
    scrubbed node by node, so an amount split across marks is split across text nodes too.
"""
from __future__ import annotations

import copy
import json
import re
import threading
import time
import unicodedata
from typing import Any, Callable, Iterable, Mapping
from urllib.parse import unquote, urlsplit

from api.services.journal_two import example_sanitize   # pure (re only): the closure stays framework-free

# ⛔ NO WEB FRAMEWORK AT MODULE LEVEL. `journal_two.db.ensure_schema` imports
# `template_gallery`, which imports this module for `reduce`, and the firm-template seed calls
# `reduce` on a first boot. So this file is in the schema layer's import closure, and every
# process that only opens the database (the test session fixture, the deploy gate, a worker)
# imports it. The four response helpers below import fastapi where they use it.
# Rail: tests/test_j2_db_import_closure.py.

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


def not_found() -> "HTTPException":
    """`raise not_found()` -- the one 404 every public miss and the flag-off path share."""
    from fastapi import HTTPException
    return HTTPException(status_code=404, detail=NOT_FOUND_DETAIL, headers=dict(PUBLIC_HEADERS))


def public_json(content: Any) -> "JSONResponse":
    from fastapi.responses import JSONResponse
    return JSONResponse(content=content, headers=dict(PUBLIC_HEADERS))


def public_file(path: Any) -> "FileResponse":
    from fastapi.responses import FileResponse
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
        from fastapi import HTTPException
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

#: The modes that are a COLUMN of `NODE_POLICY` (and of `ATTR_POLICY`).
BASE_MODES = ("share", "publish", "gallery")
#: Every mode `reduce` takes. `example` has no column: `node_action` derives it from gallery's.
MODES = BASE_MODES + ("example",)
#: The modes that take the gallery rules in the code paths below (the address SHAPE rule, the
#: email scrub, gallery's attribute table, the link card's image). One set, read in each place, so
#: "gallery's rule" for an example note is the same branch, never a copy of it.
_GALLERY_RULES = frozenset({"gallery", "example"})

#: What an email address becomes in a gallery copy (wave 12, lane 12A).
EMAIL_TEXT = "email address"
_EMAIL_IN_TEXT = re.compile(r"(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+", re.IGNORECASE)


def _email_in_href(href: Any) -> str | None:
    """The first email address an href carries once percent-decoded (`?email=me@x.com`, `me%40x.com`), or None.

    OI-P3b-4: gallery mode drops a `mailto:` link, and the same address in a web link's query string is as
    personal. Decoded a few times over, so `%2540` (an encoded `%40`) is read as the `@` it ends up as."""
    if not isinstance(href, str):
        return None
    s = href.strip()
    for _ in range(3):
        decoded = unquote(s)
        if decoded == s:
            break
        s = decoded
    m = _EMAIL_IN_TEXT.search(s)
    return m.group(0) if m else None

#: ONE neutral paragraph where a market-data item stood (ruling D-B4, extended to share
#: links by the owner's L3). Adjacent ones collapse to one.
NEUTRAL_LINE = "A market-data item is not shown on public pages."

#: The neutral line for a member's own ACCOUNT figures (Notebook widgets, Task 5): P&L, open
#: positions, rules and mistakes. Different words from NEUTRAL_LINE on purpose: the reason a
#: stranger does not see it is the member's privacy, not a vendor licence. Adjacent runs of the
#: SAME line collapse to one; a market line beside an account line stays two.
ACCOUNT_NEUTRAL_LINE = "A private account item is not shown on public pages."

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
    # Notebook P2a trader blocks (IR-B3). The checklist and the sizer hold the member's own setups,
    # rules, prices and account; a price-stamps block is a switch over Massive price facts, so it
    # follows ("financialFact", "massive") below. The market context stamp is "marketcontext" above.
    ("widgetEmbed", "preEntryChecklist"): "private",
    ("widgetEmbed", "priceStamps"): "massive",
    ("widgetEmbed", "positionSizing"): "private",
    # Notebook P2b blocks (IR-B3, part b): the member's own rules, names, watchlist, plans and trade are
    # private; the Morning Wire headline and exposure rating are mixed, like marketcontext.
    ("widgetEmbed", "myRules"): "private",
    ("widgetEmbed", "prepWire"): "mixed",
    ("widgetEmbed", "prepEarnings"): "private",
    ("widgetEmbed", "prepMovers"): "private",
    ("widgetEmbed", "prepLevels"): "private",
    ("widgetEmbed", "tradeReview"): "private",
    # P2 Tier 3: the member's own mood and focus. A stranger sees the neutral line, never a level.
    ("widgetEmbed", "moodCheckIn"): "private",
    # Notebook widgets (Task 6): frozen snapshots fetched by their own slash items. Task 5 moves the two
    # account kinds to "member-optin"; until then they are the neutral private line.
    ("widgetEmbed", "myWatchlistToday"): "mixed",    # the member's list beside live prices
    ("widgetEmbed", "myNamesReporting"): "mixed",    # earnings windows over the member's names
    ("widgetEmbed", "tickerCard"): "mixed",          # one ticker's prices, earnings and the member's history
    # "member-optin": an ACCOUNT figure. Neutral on every public page unless the member switched
    # `params.share` on in the editor, and then only the keys EMBED_PARAM_KEYS names (never positionId).
    ("widgetEmbed", "myPnlStats"): "member-optin",        # the member's own P&L and stats
    ("widgetEmbed", "myPositionsRisk"): "member-optin",   # the member's own open positions and risk
    ("widgetEmbed", "myRulesCheck"): "member-optin",      # later waves, declared now so a stored node fails closed
    ("widgetEmbed", "myMistakes"): "member-optin",
    ("widgetEmbed", "tradeRecap"): "member-optin",
    ("widgetEmbed", "myPnlCalendar"): "member-optin",
    ("widgetEmbed", "mySetupEdge"): "member-optin",
    # Notebook widgets phase 2: a member-built widget. Its figures are the member's own account data, so it is
    # neutral unless `params.share` is the boolean True, and then only the result keys below (Task 8.12). The
    # registry row (KIND_WAVE / ACCOUNT_KINDS) arrives with Task 8.13; this row lands first on purpose, because
    # `test_every_registered_widget_has_a_vendor_row` reds a registry id without one and nothing reds the reverse.
    ("widgetEmbed", "builtWidget"): "member-optin",
    ("widgetEmbed", "marketOnMyNames"): "mixed",
    ("widgetEmbed", "tickerFlow"): "mixed",
    ("widgetEmbed", "myScreenToday"): "mixed",
    ("widgetEmbed", "roomBuzzOnMyNames"): "mixed",
    ("widgetEmbed", "myEarningsReactions"): "mixed",
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
    # An account figure the MEMBER may switch on (`params.share is True`). Any caller that asks the
    # table and ignores the switch gets NEUTRAL: fails closed. `_market_data` is what reads the switch.
    "member-optin": NEUTRAL,
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

#: ⛔ THE EXAMPLE OVERRIDE SET (ruling P3b-R3), and the ONLY rows whose example decision is not
#: gallery's. An example note may show the pictures its author switched on; a template never does.
#:   opt-in-image  kept, src rewritten by `image_src_for`, when its ORIGINAL src is in `images_on`;
#:                 otherwise dropped, with an `image_off` change entry
#:   figure        (the share/publish action) dropped when its image was dropped
#:   keep          a caption stays, and its text is scrubbed like every text node
#:   drop          (ruling P3b-T2-R8) a link card, a web embed and the link MARK: an address can
#:                 carry an account number, an email or a broker domain, and an example needs no
#:                 live link. A link mark's words stay; the card and the embed go whole.
#: Rail: tests/test_example_reduce.py derives the rows from NODE_POLICY and fails on any row
#: whose example decision differs from gallery's outside this set, or on a copied example column.
EXAMPLE_OVERRIDES: dict[str, str] = {
    "image": "opt-in-image", "imageFigure": "figure", "imageCaption": "keep",
    "linkPreview": "drop", "webEmbed": "drop", "link": "drop",
}

#: Where an example's switched-on image may point after `image_src_for` (plan R-P3b-7's route,
#: `GET /api/j2/template-gallery/{item_id}/images/{n}`): nothing else is ever published.
#: Anchored with `\Z`, never `$` (OI-P3b-11): `$` also matches before ONE trailing newline, so `.match` admitted
#: `.../images/0\n`.
EXAMPLE_IMAGE_ROUTE = re.compile(r"^/api/j2/template-gallery/[A-Za-z0-9_-]{1,64}/images/[A-Za-z0-9_-]{1,32}\Z")


def node_action(type_: Any, mode: str) -> str | None:
    """The ONE lookup of a node or mark type's action in a mode: its `NODE_POLICY` column, and in
    `example` mode gallery's column unless the type is in `EXAMPLE_OVERRIDES`. None: no row."""
    row = NODE_POLICY.get(type_) if isinstance(type_, str) else None
    if row is None:
        return None
    if mode == "example":
        return EXAMPLE_OVERRIDES.get(type_, row["gallery"])
    return row[mode]

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


def attr_decision(row: str, mode: str) -> str:
    """An attribute row's decision in a mode; `example` reads gallery's (the `node_action` rule).

    ⚠️ A RAIL HELPER (review M-4): the reducer does not call it. ATTR_POLICY is enforced by the
    embed allowlist (`EMBED_KEPT_ATTRS` never names a "drop" row, railed in
    tests/test_public_note_payload.py), and an example's reset block is filtered through the same
    allowlist; this lookup lets the example rail state that the row's example decision is gallery's."""
    decision = ATTR_POLICY[row]
    return decision["gallery"] if mode == "example" else decision[mode]
EMBED_PARAM_KEYS: dict[str, tuple[str, ...]] = {
    "fundamentals": ("symbol", "view"),
    # Account kinds: kept ONLY when the member switched `share` on. `truncated`/`partial` are the
    # builders' own honesty flags. NEVER `positionId`: every row passes EMBED_ROW_KEYS (R60).
    # `tooLarge` + `empty` (the too-large sentence), `truncated` (rows the cap dropped) and
    # `mistakesTruncated` (tags past MISTAKES_MAX) are the CAP's honesty flags (notebook_widgets.cap_payload),
    # kept for every kind the cap can set them on, so a stranger reads the sentence and the "+n more" the
    # member does (fix F1b, review M-4). Railed against the cap's real output.
    "myPnlStats": ("asOf", "source", "range", "netPnl", "winRate", "avgR", "tradeCount", "equity", "empty", "share",
                   "truncated", "tooLarge"),
    "myPositionsRisk": ("asOf", "source", "accountSize", "accountSizeSource", "rows", "empty", "share", "truncated", "partial",
                        "tooLarge"),
    "myRulesCheck": ("asOf", "source", "range", "kept", "total", "rules", "empty", "share", "truncated", "tooLarge"),
    "myMistakes": ("asOf", "source", "rows", "empty", "share", "truncated", "tooLarge"),
    # Wave 6. ⛔ NEVER `tradeId`: it names one of the member's trades, and the builder's own payload
    # carries no id, so a shown recap needs none. The settings key stays home with the rest.
    "tradeRecap": ("asOf", "source", "symbol", "side", "entryDate", "exitDate", "entryPrice", "exitPrice",
                   "r", "pnl", "setup", "holdDays", "mistakes", "bars", "share",
                   "empty", "truncated", "tooLarge", "mistakesTruncated"),
    "myPnlCalendar": ("asOf", "source", "month", "days", "best", "worst", "empty", "share", "truncated", "tooLarge"),
    "mySetupEdge": ("asOf", "source", "rows", "empty", "share", "truncated", "tooLarge"),
    # A built widget (Task 8.12): the RESULT only. NEVER `def`, `defRef`, `defId`, `defRev`, `latestRev`,
    # `summary`, `scopeLabel`, `filter`, `accountId`, `range`, `coverage`, `sample`, and never `footnotes` or
    # `sourceDetail` (the payload carries both; they name scope and provenance a stranger must not read).
    # Railed in tests/test_public_note_payload.py.
    "builtWidget": ("asOf", "source", "title", "view", "measures", "value", "compare", "compareLabel", "rows",
                    "series", "points", "cells", "count", "rangeLabel", "capped", "notice", "truncated", "tooLarge",
                    "empty", "share"),
}

#: Ruling R60: what a SHOWN account widget's structured params may publish, item by item. Every list or
#: object kept by EMBED_PARAM_KEYS goes through this table: a dict item keeps ONLY the keys named here, and
#: only their scalar values (a nested id, an unknown key, a key a builder adds later or an imported row's
#: extra all stay home); `SCALAR_ITEMS` names a list of scalars (a recap's mistake tags) and `PAIR_ITEMS` a
#: list of scalar pairs (the equity curve's [day, value]). A structured param this table does not name is
#: not published.
class _ItemShape:
    """A list-item mode for EMBED_ROW_KEYS, told apart by IDENTITY (`is`), never by equality (fix F1b,
    review M-6: `keys == ()` was true for ANY empty tuple, so an entry written `()` to mean "keep no keys"
    would have passed every scalar item through). As a key list it names NO key, so a shape placed where a
    dict's keys are read keeps nothing (fails closed)."""

    def __init__(self, name: str):
        self.name = name

    def __iter__(self):
        return iter(())

    def __contains__(self, _key: object) -> bool:
        return False

    def __repr__(self) -> str:
        return self.name


SCALAR_ITEMS = _ItemShape("SCALAR_ITEMS")
PAIR_ITEMS = _ItemShape("PAIR_ITEMS")
EMBED_ROW_KEYS: dict[str, dict[str, Any]] = {
    "myPnlStats": {"range": ("from", "to"), "equity": PAIR_ITEMS},
    "myPositionsRisk": {"rows": ("symbol", "side", "kind", "sizePct", "openPnl", "stopPrice", "distToStopPct",
                                 "noStop")},
    "myRulesCheck": {"range": ("from", "to"), "rules": ("rule", "kept", "total")},
    "myMistakes": {"rows": ("mistake", "cost30d", "countNow", "countPrior", "trend")},
    "tradeRecap": {"bars": ("t", "o", "h", "l", "c"), "mistakes": SCALAR_ITEMS},
    "myPnlCalendar": {"days": ("day", "pnl"), "best": ("day", "pnl"), "worst": ("day", "pnl")},
    "mySetupEdge": {"rows": ("setup", "n", "expectancyR", "winRate", "thin")},
    # A built widget (Task 8.12): fixed keys per list; an id, a nested object or a key a builder adds later stays home.
    "builtWidget": {
        "measures": ("label", "unit", "kind", "fmt"),
        "value": ("v1", "v2", "v3", "n1", "n2", "n3", "s1", "s2", "s3", "n"),
        "compare": ("v1", "v2", "v3", "n1", "n2", "n3", "s1", "s2", "s3", "n"),
        "rows": ("label", "label2", "v1", "v2", "v3", "n1", "n2", "n3", "s1", "s2", "s3", "n", "flagged"),
        "series": ("label", "label2", "v1", "v2", "v3", "n1", "n2", "n3", "s1", "s2", "s3", "n", "flagged"),
        "points": ("x", "y", "d", "r"),
        "cells": ("label", "v1", "n1", "s1"),
    },
}


def _scalar(v: Any) -> bool:
    return v is None or isinstance(v, (str, int, float, bool))


def _allowed_item(item: Any, keys: Any) -> Any:
    """One list item through its allowlist, or `_DROP`. The two item shapes are matched by identity; any
    other entry is a tuple of key names, and `()` keeps no key of a dict and drops a scalar (fails closed)."""
    if keys is SCALAR_ITEMS:
        return item if _scalar(item) else _DROP
    if keys is PAIR_ITEMS:
        ok = isinstance(item, (list, tuple)) and len(item) == 2 and all(_scalar(x) for x in item)
        return list(item) if ok else _DROP
    if isinstance(item, dict) and isinstance(keys, tuple):
        return {k: item[k] for k in keys if k in item and _scalar(item[k])}
    return _DROP


_DROP = object()


def allowed_params(widget_id: Any, params: Mapping[str, Any]) -> dict[str, Any]:
    """`params` reduced to what a stranger may read for this shown widget: the EMBED_PARAM_KEYS names, each
    structured value through EMBED_ROW_KEYS (ruling R60). Scalars pass as they are."""
    rows = EMBED_ROW_KEYS.get(widget_id, {}) if isinstance(widget_id, str) else {}
    out: dict[str, Any] = {}
    for k in EMBED_PARAM_KEYS.get(widget_id, ()) if isinstance(widget_id, str) else ():
        if k not in params:
            continue
        v = params[k]
        if _scalar(v):
            out[k] = v
        elif k not in rows:
            continue                                     # a structure nobody vetted stays home
        elif isinstance(v, dict):
            out[k] = {f: v[f] for f in rows[k] if f in v and _scalar(v[f])}
        elif isinstance(v, list):
            # Review m7: a `()` entry names no key, so it publishes NO items -- never one `{}` per item, which
            # would still tell a stranger how many rows (or bars) the member has.
            out[k] = ([] if rows[k] == () else
                      [x for x in (_allowed_item(i, rows[k]) for i in v) if x is not _DROP])
    return out

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


def _scrub_in_app_addresses(text: str, strict: bool = False, changes: list | None = None) -> str:
    """`text` with every in-app address replaced by `IN_APP_LINK_TEXT`; an external address and
    a public page's own address stay. `strict` (gallery mode) also replaces an address that has
    an in-app SHAPE on any host (`_in_app_shape`). `changes` (example mode) collects one entry
    per replaced address; the replacement is the same either way."""
    def repl(m: "re.Match[str]") -> str:
        s = m.group(0)
        core = s.rstrip(_TRAILING_PUNCT)
        tail = s[len(core):]
        if core and not _is_public_address(core) and (_internal_href(core) or (strict and _in_app_shape(core))):
            if changes is not None:
                kind = "trade_link" if "/trade" in core.lower() else "dropped"
                changes.append({"kind": kind, "before": core[:example_sanitize.BEFORE_MAX],
                                "after": IN_APP_LINK_TEXT})
            return IN_APP_LINK_TEXT + tail
        return s
    return _ADDRESS_IN_TEXT.sub(repl, text)


def scrub_emails(text: str, changes: list | None = None) -> str:
    """`text` with every email address replaced by `EMAIL_TEXT` (gallery and example modes).
    `changes` (example mode) collects one entry per address; the replacement is the same."""
    if not isinstance(text, str):
        return text
    if changes is None:
        return _EMAIL_IN_TEXT.sub(EMAIL_TEXT, text)

    def repl(m: "re.Match[str]") -> str:
        changes.append({"kind": "email", "before": m.group(0)[:example_sanitize.BEFORE_MAX], "after": EMAIL_TEXT})
        return EMAIL_TEXT
    return _EMAIL_IN_TEXT.sub(repl, text)


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
# The rule (first for gallery mode; since round 2 for share and publish too, see
# `PUBLIC_ATTR_POLICY` below):
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
# Share links and published pages take the same rule through their own table,
# `PUBLIC_ATTR_POLICY`, which differs only where a member's own page carries more.

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


def _scrub_public_text(text: str) -> str:
    """Attribute text on a share link or a published page: in-app addresses go (the rule a
    text node gets there, walk W3). Emails stay; the author chose to publish them."""
    return _scrub_in_app_addresses(text) if isinstance(text, str) else ""


def _v_text(limit: int, scrub=scrub_gallery_text):
    def check(v: Any) -> Any:
        if v is None:
            return None
        if not isinstance(v, str):
            return _OMIT
        return scrub(v)[:limit]
    return check


def _v_domain(v: Any) -> Any:
    if v is None:
        return None
    return v if isinstance(v, str) and _DOMAIN.match(v) else _OMIT


def _v_latex(scrub=scrub_gallery_text):
    def check(v: Any) -> Any:
        if not isinstance(v, str) or len(v) > 4000 or _LATEX_ACTIVE.search(v):
            return _DROP_NODE
        return scrub(v)
    return check


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


# ── the PUBLIC text-style grammar (share links and published pages) ───────────────────────
#
# A gallery template takes the toolbar's own values only (above). A member's OWN note may
# also hold a font or a size that came in by paste or import (Word's `Calibri`, `11pt`, a
# Chinese or Arabic font name), and a public page must not strip formatting the member can
# see in their editor. So the public modes accept the toolbar's values AND anything of a
# strict SHAPE that cannot carry a second CSS declaration.
#
# THE SHAPE OF A FONT FAMILY: one to eight names separated by commas (up to two spaces each
# side). A name is made of Unicode LETTERS, MARKS and DIGITS (general categories L*, M*, N*),
# the ASCII space, `_` and `-`, at most 40 characters. Unquoted it starts with a letter (or
# `-` then a letter). In double quotes it may also hold `'`, in single quotes `"`.
# ⛔ It is an ALLOW-list by category, so every character that could start a second
# declaration or a function is out without being named: `; : ( ) { } \ / < > ! @`, every
# control character, and their Unicode look-alikes (the full-width semicolon and colon are
# punctuation, category Po; a bidirectional override or a zero-width character is a format
# character, Cf; a no-break or ideographic space is Zs, and only U+0020 is a space here).
#
# ⛔ ONE FACT IN TWO LANGUAGES with `lib/tiptap.js` (`safeFontFamily`, `safeFontSize`),
# which narrows the same two attributes in the editor. Both are the SAME algorithm and are
# driven by the SAME case file, tests/fixtures/notebook_text_style_cases.json, look-alike
# attacks included, so the two cannot drift.
_FONT_SIZE_KEYWORDS = frozenset({"xx-small", "x-small", "small", "medium", "large", "x-large", "xx-large",
                                 "xxx-large", "smaller", "larger"})
MAX_FAMILY_CHARS, MAX_FAMILY_NAMES, MAX_FAMILY_NAME_CHARS = 200, 8, 40


def _category(ch: str) -> str:
    return unicodedata.category(ch)[0]


def _family_name_ok(name: str) -> bool:
    if len(name) >= 2 and name[0] in "\"'" and name[-1] == name[0]:
        inner, other_quote = name[1:-1], ("'" if name[0] == '"' else '"')
        return (1 <= len(inner) <= MAX_FAMILY_NAME_CHARS and _category(inner[0]) in "LN"
                and all(c in " _-" or c == other_quote or _category(c) in "LMN" for c in inner))
    body = name[1:] if name.startswith("-") else name
    return (1 <= len(body) <= MAX_FAMILY_NAME_CHARS and _category(body[0]) == "L"
            and all(c in " _-" or _category(c) in "LMN" for c in body))


def _strip_spaces(text: str, *, left: bool, right: bool) -> str:
    """`text` less at most two ASCII spaces on each named side."""
    for _ in range(2):
        if left and text.startswith(" "):
            text = text[1:]
        if right and text.endswith(" "):
            text = text[:-1]
    return text


_SAFE_FONT_SIZE = re.compile(r"([0-9]{1,4}(?:\.[0-9]{1,4})?)(px|pt|em|rem|%)")
#: unit -> (smallest, largest) a public page renders.
PUBLIC_FONT_SIZE_BOUNDS = {"px": (6, 200), "pt": (5, 150), "em": (0.5, 10), "rem": (0.5, 10), "%": (50, 1000)}
_COLOR_HEX = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
_SAFE_MAILTO = re.compile(r"^mailto:[^\s<>\"'`\\]{3,320}$", re.IGNORECASE)
_SAFE_SRC = re.compile(r"^[^\s<>\"'`\\]{1,2048}$")


def safe_font_family(v: Any) -> bool:
    if not isinstance(v, str) or not 1 <= len(v) <= MAX_FAMILY_CHARS:
        return False
    if v in GALLERY_FONT_FAMILIES:
        return True
    parts = v.split(",")
    if len(parts) > MAX_FAMILY_NAMES:
        return False
    last = len(parts) - 1
    return all(_family_name_ok(_strip_spaces(part, left=i > 0, right=i < last)) for i, part in enumerate(parts))


def safe_font_size(v: Any) -> bool:
    if not isinstance(v, str):
        return False
    if v in _FONT_SIZE_KEYWORDS:
        return True
    m = _SAFE_FONT_SIZE.fullmatch(v)
    if not m:
        return False
    lo, hi = PUBLIC_FONT_SIZE_BOUNDS[m.group(2)]
    return lo <= float(m.group(1)) <= hi


def _v_public_family(v: Any) -> Any:
    return v if v is None or safe_font_family(v) else _OMIT


def _v_public_size(v: Any) -> Any:
    return v if v is None or safe_font_size(v) else _OMIT


def _v_color(*, none_ok: bool, hex_ok: bool):
    def check(v: Any) -> Any:
        if v is None:
            return None if none_ok else _OMIT
        if isinstance(v, str) and (v in GALLERY_COLOR_NAMES or (hex_ok and _COLOR_HEX.match(v))):
            return v
        return _OMIT
    return check


def _v_href_public(v: Any) -> Any:
    kept = _v_url(v)
    if kept is not _OMIT and kept is not None:
        return kept
    return v if isinstance(v, str) and _SAFE_MAILTO.match(v) else _OMIT


def _v_src(v: Any) -> Any:
    """An image address the reducer has ALREADY decided may be shown (`_public_image_src`:
    this note's own public proxy, or an http(s) address off our host). This only refuses a
    value that could not be an address at all."""
    if v is None:
        return None
    return v if isinstance(v, str) and _SAFE_SRC.match(v) else _OMIT


def _v_number(lo: float, hi: float):
    def check(v: Any) -> Any:
        if v is None:
            return None
        return v if type(v) in (int, float) and lo <= v <= hi else _OMIT
    return check


def _v_plain(limit: int):
    def check(v: Any) -> Any:
        if v is None:
            return None
        return v if isinstance(v, str) and len(v) <= limit else _OMIT
    return check


_CELL_ATTRS = {
    "colspan": _int_in(1, 50), "rowspan": _int_in(1, 50), "colwidth": _v_colwidth,
    "align": _one_of(None, "left", "center", "right"),
}


def _attr_policy(*, gallery: bool, scrub: Callable[[str], str] | None = None) -> dict[str, dict[str, Any]]:
    """The attribute table. `scrub` replaces the attribute-text scrub (example mode passes
    gallery's scrub followed by the example text patterns); every row is the same."""
    scrub = scrub or (scrub_gallery_text if gallery else _scrub_public_text)
    return {
        # ── nodes ──
        "heading": {"level": _int_in(1, 6)},
        "orderedList": {"start": _int_in(0, 1_000_000), "type": _one_of(None, "1", "a", "A", "i", "I")},
        "codeBlock": {"language": _v_str(_CODE_LANGUAGE)},
        "taskItem": {"checked": _one_of(False) if gallery else _v_bool},
        "tableHeader": _CELL_ATTRS,
        "tableCell": _CELL_ATTRS,
        "callout": {"emoji": _v_emoji, "variant": _one_of(None, *GALLERY_CALLOUT_VARIANTS)},
        "toggle": {"open": _v_bool},
        "linkPreview": {"url": _v_url, "title": _v_text(300, scrub), "description": _v_text(600, scrub),
                        "domain": _v_domain, "image": _one_of(None) if gallery else _v_src},
        "webEmbed": {"provider": _one_of(*GALLERY_EMBED_REFS),
                     "ref": _v_str(_EMBED_REF_SHAPE, none_ok=False), "url": _v_url},
        "dateMention": {"date": _v_str(_ISO_DAY)},
        "videoTimestamp": {"seconds": _v_seconds},
        "inlineMath": {"latex": _v_latex(scrub)},
        "blockMath": {"latex": _v_latex(scrub)},
        # ── marks ──
        "link": {"href": _v_url if gallery else _v_href_public},   # target and rel are SET, never copied
        "textStyle": ({"fontFamily": _one_of(None, *GALLERY_FONT_FAMILIES), "fontSize": _v_font_size} if gallery
                      else {"fontFamily": _v_public_family, "fontSize": _v_public_size}),
        "textColor": {"color": _v_color(none_ok=False, hex_ok=not gallery)},
        "highlight": {"color": _v_color(none_ok=True, hex_ok=not gallery)},
    }


#: type (node or mark) -> {attribute: check}. A check returns the value to keep (cleaned),
#: `_OMIT` to leave the attribute out, or `_DROP_NODE`.
GALLERY_ATTR_POLICY: dict[str, dict[str, Any]] = _attr_policy(gallery=True)

#: ⛔ THE SAME TABLE FOR SHARE LINKS AND PUBLISHED PAGES (security lane, round 2). Those pages
#: are public, served from our own domain, and render the body with the real editor
#: extensions, so an attribute value an AUTHOR controls reached a VISITOR'S browser as inline
#: CSS (`style="font-family: x; position: fixed; ..."`), and a link could carry any class,
#: target and rel. Measured on the rendered page before this table applied to them
#: (docs/notebook/fin-sec.md). The rows differ from the gallery's only where a member's own
#: page legitimately carries more: a checked task, an image and its size, a `mailto:` link,
#: a font or size that arrived by paste or import (by shape, see the grammar above), a hex
#: colour, and emails in attribute text.
PUBLIC_ATTR_POLICY: dict[str, dict[str, Any]] = {
    **_attr_policy(gallery=False),
    "image": {"src": _v_src, "alt": _v_text(300, _scrub_public_text), "title": _v_text(300, _scrub_public_text),
              "width": _v_number(1, 10_000), "height": _v_number(1, 10_000),
              "align": _one_of(None, "left", "center", "right", "full")},
    # an Ask or writing-help block's own labels (share keeps Ask answers, publish writing help)
    "askInsert": {"insertedAt": _v_plain(40), "scope": _v_plain(40), "question": _v_text(2000, _scrub_public_text),
                  "action": _v_plain(40), "model": _v_plain(80)},
}

ATTR_POLICY_BY_MODE: dict[str, dict[str, dict[str, Any]]] = {
    "gallery": GALLERY_ATTR_POLICY, "share": PUBLIC_ATTR_POLICY, "publish": PUBLIC_ATTR_POLICY,
}

#: The one row an example note's table has that gallery's has not: the image (P3b-R3's override
#: set). Its address is the gallery image route `image_src_for` built. Its `alt` is added per call
#: by `_example_attr_policy`, scrubbed with change entries (ruling P3b-T2-R4: alt is the public
#: copy's accessibility); its `title` does not travel, and is reported when it goes.
EXAMPLE_IMAGE_ATTRS: dict[str, Any] = {
    "src": _v_src, "width": _v_number(1, 10_000), "height": _v_number(1, 10_000),
    "align": _one_of(None, "left", "center", "right", "full"),
}

#: What a public link always carries, whatever the stored mark said.
GALLERY_LINK_FIXED = {"target": "_blank", "rel": "noreferrer"}


def _kept_attrs(policy: dict, type_name: Any, attrs: Any) -> Any:
    """The attributes of one node or mark that a public copy keeps: a dict (possibly empty),
    or `_DROP_NODE`."""
    rows = policy.get(type_name) if isinstance(type_name, str) else None
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


def _clean_mark(mark: dict, mode: str, policy: dict | None = None) -> dict | None:
    """One kept mark, reduced to its named attributes; None when nothing of it is left."""
    policy = policy if policy is not None else ATTR_POLICY_BY_MODE[mode]
    t = mark.get("type")
    attrs = _kept_attrs(policy, t, mark.get("attrs"))
    if t == "link":
        if not isinstance(attrs.get("href"), str):
            return None                              # not an address a public page links to: the words stay
        return {"type": "link", "attrs": {"href": attrs["href"], **GALLERY_LINK_FIXED}}
    if t == "textStyle" and not any(v is not None for v in attrs.values()):
        return None                                  # a style mark that styles nothing
    if t == "textColor" and "color" not in attrs:
        return None
    out: dict[str, Any] = {"type": t}
    if t in policy and isinstance(mark.get("attrs"), dict):
        out["attrs"] = attrs
    return out


def _clean_node(out: dict, mode: str, policy: dict | None = None) -> dict | None:
    """One kept node, reduced to the keys and attributes a public copy carries. None drops it."""
    policy = policy if policy is not None else ATTR_POLICY_BY_MODE[mode]
    t = out.get("type")
    attrs = _kept_attrs(policy, t, out.get("attrs"))
    if attrs is _DROP_NODE:
        return None
    if t == "webEmbed":
        pattern = GALLERY_EMBED_REFS.get(attrs.get("provider"))
        if pattern is None or not isinstance(attrs.get("ref"), str) or not pattern.match(attrs["ref"]):
            attrs.pop("provider", None)              # not a player this app can build:
            attrs.pop("ref", None)                   # it reads as a plain link, or nothing
    if t == "linkPreview" and not isinstance(attrs.get("url"), str):
        return None                                  # a card with no address is nothing
    if t == "image" and not isinstance(attrs.get("src"), str):
        return None                                  # an image with no address is nothing
    node: dict[str, Any] = {"type": t}
    if t in policy and isinstance(out.get("attrs"), dict):
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
                 note_links: Mapping[str, tuple[str, str]], attachment_base: str = "", *,
                 images_on: frozenset = frozenset(), brokers: tuple[str, ...] = (),
                 image_src_for: Callable[[str], str] | None = None, report: list | None = None,
                 owner_id: str = "", note_id: str = "", offered: list | None = None):
        self.mode = mode
        self.facts = facts
        self.note_links = note_links
        self.attachment_base = attachment_base
        self.strict = mode in _GALLERY_RULES          # gallery's rules (example takes them too)
        self.example = mode == "example"
        self.images_on = frozenset(images_on or ()) if self.example else frozenset()
        self.image_src_for = image_src_for if self.example else None
        #: P3b-T2-R13: THIS note's own attachment prefix -- the only images an example may show
        self.own_attachments = f"{_ATTACHMENT_PREFIX}{owner_id}/{note_id}/" if (owner_id and note_id) else None
        #: the AUTHOR'S institution names; example_sanitize always adds the house list (fail closed)
        self.brokers = tuple(brokers or ()) if self.example else ()
        self.report = report if self.example and isinstance(report, list) else None
        #: P3b-T3-R4: every image of THIS note the walk reaches (so one the author may switch on), in walk order
        self.offered = offered if self.example and isinstance(offered, list) else None
        self.path: list[int] = []                     # child indices from the doc root (change entries)
        self.attr_policy = _example_attr_policy(self) if self.example else ATTR_POLICY_BY_MODE[mode]

    def recording(self) -> list | None:
        """A fresh list to collect a helper's change entries into, or None when nothing is reported."""
        return [] if self.report is not None else None

    def note(self, kind: str, before: Any = "", after: str = "") -> None:
        """One change entry at the current path (example mode with a report only)."""
        if self.report is not None:
            self.report.append({"kind": kind, "before": str(before or "")[:example_sanitize.BEFORE_MAX],
                                "after": after, "path": list(self.path)})

    def extend(self, entries: list | None) -> None:
        """A helper's collected entries, stamped with the current path."""
        if self.report is not None and entries:
            for e in entries:
                self.report.append({**e, "path": list(self.path)})

    def scrub_text(self, text: str) -> str:
        """Example mode's own text patterns, after gallery's (money, P&L figures, account ids,
        broker names; `example_sanitize.scrub_text` runs its URL pass first, a no-op by then)."""
        got = self.recording()
        out = example_sanitize.scrub_text(text, self.brokers, got)
        self.extend(got)
        return out

    def scrub_urls(self, text: str) -> str:
        """Ruling P3b-T2-R9: every URL in prose replaced WHOLE, BEFORE any other text pass."""
        got = self.recording()
        out = example_sanitize.scrub_urls(text, got)
        self.extend(got)
        return out

    def scrub_example(self, text: str) -> str:
        """The whole example text pass, in its ruled order: URLs, then gallery's in-app addresses
        and emails, then the example patterns."""
        text = self.scrub_urls(text)
        got = self.recording()
        text = scrub_emails(_scrub_in_app_addresses(text, strict=True, changes=got), got)
        self.extend(got)
        return self.scrub_text(text)


def _example_attr_policy(ctx: "_Ctx") -> dict[str, dict[str, Any]]:
    """An example note's attribute table: gallery's rows (`_attr_policy(gallery=True)`, the same
    builder) with attribute text scrubbed by the example's whole text pass, plus the image row and
    its scrubbed alt text (ruling P3b-T2-R4)."""
    rows = _attr_policy(gallery=True, scrub=ctx.scrub_example)
    return {**rows, "image": {**EXAMPLE_IMAGE_ATTRS, "alt": _v_text(300, ctx.scrub_example)}}


def _example_dry_run(text: str, ctx: "_Ctx") -> str:
    """What the example text pass would make of `text`, recording nothing (a formula is replaced
    whole when this differs, ruling P3b-T2-R7)."""
    text = example_sanitize.scrub_urls(text, None)
    text = scrub_emails(_scrub_in_app_addresses(text, strict=True))
    return example_sanitize.scrub_text(text, ctx.brokers, None)


def _own_attachment(src: Any, ctx: "_Ctx") -> bool:
    """Ruling P3b-T2-R13 (review I-5): is `src` THIS note's own attachment? The prefix names this
    owner and this note; nothing after it may climb (`..`, a backslash) or name the prefix again."""
    if not isinstance(src, str) or not ctx.own_attachments or not src.startswith(ctx.own_attachments):
        return False
    rest = src[len(ctx.own_attachments):]
    return bool(rest) and ".." not in rest and "\\" not in rest and _ATTACHMENT_PREFIX not in rest


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
        if _internal_href(attrs.get("url")) or (ctx.strict and _in_app_shape(attrs.get("url"))):
            ctx.note("dropped", attrs.get("url"))
            return None
        if ctx.strict and attrs.get("image") is not None:
            ctx.note("dropped", attrs.get("image"))
            return {**node, "attrs": {**attrs, "image": None}}     # gallery: no image of any kind
        if attrs.get("image") is not None and _public_image_src(attrs.get("image"), ctx.attachment_base) is None:
            node = {**node, "attrs": {**attrs, "image": None}}
        return node
    if t == "webEmbed":
        url = attrs.get("url")
        if url is not None and (_internal_href(url) or (ctx.strict and _in_app_shape(url))):
            ctx.note("dropped", url)
            node = {**node, "attrs": {**attrs, "url": None}}
        return node
    return node


def _neutral(line: str = NEUTRAL_LINE) -> dict:
    return {"type": "paragraph", "content": [{"type": "text", "text": line}]}


def _neutral_line_of(node: Any) -> str | None:
    """Which neutral line this node is (market or account), or None when it is neither."""
    if isinstance(node, dict) and node.get("type") == "paragraph":
        for line in (NEUTRAL_LINE, ACCOUNT_NEUTRAL_LINE):
            if node.get("content") == [{"type": "text", "text": line}]:
                return line
    return None


def _is_neutral(node: Any, line: str | None = None) -> bool:
    """A neutral line. With `line`, exactly that one; without, either."""
    found = _neutral_line_of(node)
    return found is not None and (line is None or found == line)


def _is_account_kind(widget_id: Any) -> bool:
    return MARKET_DATA_VENDORS.get(("widgetEmbed", widget_id)) == "member-optin"


def _neutral_for_embed(widget_id: Any) -> dict:
    """The ONE place that chooses the line for a widgetEmbed: the account line for an account kind."""
    return _neutral(ACCOUNT_NEUTRAL_LINE if _is_account_kind(widget_id) else NEUTRAL_LINE)


def _reduce_marks(marks: Any, mode: str = "share", ctx: "_Ctx | None" = None) -> list | None:
    if not isinstance(marks, list):
        return None
    note = ctx.note if ctx is not None else (lambda *a: None)
    out = []
    for m in marks:
        if not isinstance(m, dict):
            continue
        action = node_action(m.get("type"), mode)    # the ONE lookup; the base columns of a mark agree
        if action is None:
            note("dropped", m.get("type"))
            continue                                 # an unknown mark: its text stays, it goes
        if action == "drop":                         # example mode: the link mark goes (P3b-T2-R8)
            href = str((m.get("attrs") or {}).get("href") or "").strip()
            if href.lower().startswith("mailto:"):
                note("email", href[7:])
            elif _internal_href(href) and "/trade" in href.lower():
                note("trade_link", href)
            else:
                note("link", href)
            continue
        if action == "link-mark":
            href = (m.get("attrs") or {}).get("href")
            if _internal_href(href):
                note("trade_link" if "/trade" in str(href).lower() else "dropped", href)
                continue
            if mode in _GALLERY_RULES and (str(href).strip().lower().startswith("mailto:") or _in_app_shape(href)):
                mailto = str(href).strip().lower().startswith("mailto:")
                note("email" if mailto else "dropped", str(href).strip()[7:] if mailto else href)
                continue                            # gallery: an address is personal; the words stay
            if mode in _GALLERY_RULES and (address := _email_in_href(href)) is not None:
                note("email", address)              # OI-P3b-4: an address in a web link's query, the mailto rule
                continue
        if action in ("mark", "link-mark"):
            m = _clean_mark(m, mode, ctx.attr_policy if ctx is not None else None)   # the attribute table, every mode (I-4)
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
        params = attrs.get("params") if isinstance(attrs.get("params"), dict) else {}
        if _is_account_kind(widget_id):
            # The member's switch, read BEFORE the vendor verdict (which is NEUTRAL for this vendor).
            # Only a real boolean True shows: "true", 1 and everything else are the neutral line.
            if params.get("share") is not True:
                return [_neutral_for_embed(widget_id)]
        elif market_data_verdict("widgetEmbed", widget_id) != SHOWN:
            return [_neutral_for_embed(widget_id)]
        kept = {k: copy.deepcopy(attrs[k]) for k in EMBED_KEPT_ATTRS if k in attrs}
        kept["params"] = copy.deepcopy(allowed_params(widget_id, params))       # ruling R60
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
    """The children, reduced. ⛔ A change entry's path addresses the REDUCED body (ruling
    P3b-T2-R5): a child is reduced at the index it will take (`len(out)`), and afterwards the
    entries it produced are re-pointed when it collapsed into the neutral line before it, or cut
    back to that index (where it would have stood) when it was dropped."""
    out: list = []
    for child in children or []:
        depth = len(ctx.path)
        mark = len(ctx.report) if ctx.report is not None else 0
        ctx.path.append(len(out))
        try:
            produced = _reduce_node(child, ctx)
        finally:
            ctx.path.pop()
        placed = None
        for reduced in produced:
            line = _neutral_line_of(reduced)
            if line is not None and out and _neutral_line_of(out[-1]) == line:
                placed = len(out) - 1 if placed is None else placed
                continue                             # ONE neutral line for a run of them
            placed = len(out) if placed is None else placed
            out.append(reduced)
        if ctx.report is not None:
            for entry in ctx.report[mark:]:
                path = entry["path"]
                if len(path) <= depth:
                    continue
                if placed is None:
                    entry["path"] = path[:depth] + [len(out)]          # dropped: where it would stand
                else:
                    entry["path"] = path[:depth] + [placed] + path[depth + 1:]
    return out


# ── the example mode's realisation of gallery's `neutral` (plan R-P3b-3) ─────────────────
#
# The DECISION for a widgetEmbed, a financialFact, a documentExcerpt and a tradeCanvas is
# gallery's `neutral` (node_action). What that decision makes of the node in an example note
# follows the plan's table row by row:
#   * a trader block -> the same block with its builder's NO-READ empty params (ruling P3b-R10:
#     the builder in "update" mode, with no member, which reads nothing and stamps nothing);
#   * a private embed (vendor "private" and not a block: the member's other notes, their alerts)
#     -> dropped;
#   * a financial fact -> the words VALUE_TEXT;
#   * anything else (market data of any vendor, marketcontext among it) -> the neutral line,
#     exactly as gallery.

#: The block a reset builds is built at this instant, and then UN-stamped (no capturedAt, no
#: embedId): an example never carries the author's instance or a time.
_RESET_NOW_UTC = (1970, 1, 1)


def _reset_block(attrs: dict, ctx: _Ctx) -> list:
    """A trader block reset through its builder's NO-READ output."""
    from datetime import datetime, timezone
    from api.services.journal_two import trader_blocks
    widget_id = attrs.get("widgetId")
    builder = trader_blocks.BUILDERS.get(widget_id)
    if builder is None:
        ctx.note("dropped", widget_id)
        return []                                    # no builder: nothing safe to show
    built, _ = builder({"settings": {}}, {"now": datetime(*_RESET_NOW_UTC, tzinfo=timezone.utc),
                                          "mode": "update"})
    if not isinstance(built, dict) or not isinstance(built.get("attrs"), dict):
        ctx.note("dropped", widget_id)
        return []
    # M-2: through the embed allowlist, like every public widgetEmbed -- a builder that one day writes
    # something new into its node does not publish it.
    kept = set(EMBED_KEPT_ATTRS) | {"params"}
    reset = {k: copy.deepcopy(v) for k, v in built["attrs"].items() if k in kept}
    reset["capturedAt"] = None
    if attrs.get("tradeRef") or attrs.get("tradeRefType"):
        ctx.note("trade_link", attrs.get("tradeRef") or attrs.get("tradeRefType"))
    if isinstance(attrs.get("caption"), str) and attrs["caption"].strip() and attrs["caption"] != reset.get("caption"):
        ctx.note("dropped", attrs["caption"])     # M-1: the author's caption goes with the reset
    before = attrs.get("params") if isinstance(attrs.get("params"), dict) else {}
    if before != reset.get("params"):
        ctx.note("block_reset", json.dumps(before, sort_keys=False, default=str),
                 json.dumps(reset.get("params"), default=str))
    return [{"type": "widgetEmbed", "attrs": reset}]


def _example_neutral(node: dict, ctx: _Ctx) -> list:
    t = node.get("type")
    attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
    if t == "widgetEmbed":
        from api.services.journal_two import trader_blocks
        widget_id = attrs.get("widgetId")
        if widget_id in trader_blocks.BLOCK_IDS:
            return _reset_block(attrs, ctx)
        if MARKET_DATA_VENDORS.get(("widgetEmbed", widget_id)) in ("private", "member-optin"):
            ctx.note("dropped", widget_id)           # an account kind is dropped in an example, as private was
            return []
        ctx.note("market_data", widget_id)
        return [_neutral()]
    if t == "financialFact":
        fact = ctx.facts.get(str(attrs.get("factId") or ""))
        ctx.note("fact", _format_fact_value(fact) if fact else "", example_sanitize.VALUE_TEXT)
        return [{"type": "paragraph", "content": [{"type": "text", "text": example_sanitize.VALUE_TEXT}]}]
    ctx.note("market_data", t)
    return [_neutral()]


def _reduce_node(node: Any, ctx: _Ctx) -> list:
    """One stored node -> the list of nodes that replace it in the public copy (0, 1, ...)."""
    if not isinstance(node, dict):
        return []
    t = node.get("type")
    action = node_action(t, ctx.mode)               # ⛔ the ONE lookup (P3b-R3)
    if action is None:
        ctx.note("dropped", t)
        return []                                    # ⛔ unknown type: fail closed
    if action == "drop":
        ctx.note("dropped", t)
        return []
    if action == "neutral":
        if ctx.example:
            return _example_neutral(node, ctx)
        if t == "widgetEmbed":                       # gallery: the line is chosen by the kind, same helper
            attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
            return [_neutral_for_embed(attrs.get("widgetId"))]
        return [_neutral()]
    if action == "market-data":
        return _market_data(node, ctx)
    if action == "linked-note":
        target = str((node.get("attrs") or {}).get("noteId") or "")
        if ctx.mode == "publish" and target in ctx.note_links:
            href, title = ctx.note_links[target]
            return [{"type": "text", "text": title or "Untitled",
                     "marks": [{"type": "link", "attrs": {"href": href}}]}]
        ctx.note("dropped", t, LINKED_NOTE_TEXT)
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
    if action == "opt-in-image":                     # example mode: the author's switch (P3b-R3)
        attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
        src = attrs.get("src")
        if ctx.offered is not None and _own_attachment(src, ctx) and src not in ctx.offered:
            ctx.offered.append(src)                  # P3b-T3-R4: reached by THIS walk, so it can be kept
        # P3b-T2-R13: THIS note's own attachment AND switched on, whatever images_on says; and the
        # rewritten address must be the gallery image route, nothing else.
        public = ctx.image_src_for(src) if (_own_attachment(src, ctx) and src in ctx.images_on
                                            and ctx.image_src_for is not None) else None
        if not isinstance(public, str) or not EXAMPLE_IMAGE_ROUTE.match(public):
            ctx.note("image_off", str(src or "").rsplit("/", 1)[-1])
            return []
        node = {**node, "attrs": {**attrs, "src": public}}
    if ctx.example and t in ("inlineMath", "blockMath"):
        latex = (node.get("attrs") or {}).get("latex")
        if isinstance(latex, str) and _example_dry_run(latex, ctx) != latex:
            # P3b-T2-R7: a formula holding a replacement is replaced WHOLE, never left broken
            ctx.note("money", latex, example_sanitize.VALUE_TEXT)
            words = {"type": "text", "text": example_sanitize.VALUE_TEXT}
            return [words] if t == "inlineMath" else [{"type": "paragraph", "content": [words]}]
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
        if ctx.example:
            out["text"] = ctx.scrub_example(out["text"])   # URLs FIRST (P3b-T2-R9), then gallery's, then ours
        else:
            out["text"] = _scrub_in_app_addresses(out["text"], strict=ctx.strict)  # walk W3
            if ctx.strict:
                out["text"] = scrub_emails(out["text"])
    cleaned = _clean_node(out, ctx.mode, ctx.attr_policy)   # the attribute table, every mode (I-4)
    if cleaned is None:
        ctx.note("dropped", t)                       # M-1: the table refused it (a formula that links, ...)
        return []
    out = cleaned
    if ctx.example and t == "image" and isinstance((node.get("attrs") or {}).get("title"), str) \
            and node["attrs"]["title"].strip():
        ctx.note("dropped", node["attrs"]["title"])  # M-1: an image's title does not travel
    if "marks" in node:
        marks = _reduce_marks(node.get("marks"), ctx.mode, ctx)
        if marks is not None and (marks or not node.get("marks")):
            out["marks"] = marks                     # an empty list stays empty; an emptied one goes
    if "content" in node:
        had = bool(node.get("content"))
        mark = len(ctx.report) if ctx.report is not None else 0
        content = _reduce_children(node.get("content"), ctx)
        if action == "figure" and not any(c.get("type") == "image" for c in content):
            if ctx.report is not None:               # the caption that goes with it reports nothing
                ctx.report[mark:] = [e for e in ctx.report[mark:] if e["kind"] == "image_off"]
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
    images_on: frozenset[str] = frozenset(),
    brokers: tuple[str, ...] = (),
    image_src_for: Callable[[str], str] | None = None,
    report: list | None = None,
    offered: list | None = None,
) -> dict:
    """The public copy of one note's body.

    `attachment_base` is where THIS note's attachments are served publicly (the share or
    publish proxy, ending in "/"). `facts` maps this note's fact ids to their rows
    (`public_facts`). `note_links` (publish only) maps a target note id to
    `(public href, title)` for targets inside the same publication.

    Example mode only (the other modes ignore these four): `images_on` holds the ORIGINAL `src`
    of each image the author switched on (honoured only for THIS note's own attachments);
    `image_src_for(src)` returns its rewritten address on the gallery image route; `brokers` is
    the author's own institution names, matched in their stored case at 4+ characters (the house
    `BROKER_NAMES` always apply, any case); `report`, when a list, receives one
    `{kind, before, after, path}` change entry per replacement -- `path` addresses the REDUCED
    body (see the module docstring's table), and `before` (at most 60 characters of the author's
    text) is for the author's preview only. `offered`, when a list, receives the ORIGINAL `src` of each of
    THIS note's own images the walk reaches, switched on or not -- the images the author may switch on: one
    inside a node the policy drops is never reached, so never offered (P3b-T3-R4).
    """
    if mode not in MODES:
        raise ValueError(f"unknown public mode {mode!r}")
    doc = body if isinstance(body, dict) and body.get("type") == "doc" else {"type": "doc", "content": []}
    raw = json.dumps(doc)
    if mode != "example":
        # an example's images are switched on by their ORIGINAL src and rewritten by image_src_for,
        # never through this note's share/publish proxy
        raw = raw.replace(f"{_ATTACHMENT_PREFIX}{owner_id}/{note_id}/", attachment_base)
    ctx = _Ctx(mode, facts or {}, note_links or {}, attachment_base, images_on=images_on, brokers=brokers,
               image_src_for=image_src_for, report=report, owner_id=owner_id, note_id=note_id,
               offered=offered)
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


def referenced_images(payload: Any, attachment_base: str) -> frozenset[str]:
    """Ruling R59: the `"<sub>/<filename>"` set of THIS note's attachments that a REDUCED public payload
    references, from whatever attribute carries them (image and figure `src`, a card's image, the hero, a
    widget's `fallback.url`, and any image-bearing attribute added later), because it reads every string the
    payload holds rather than a list of attribute names. The public image proxies serve only this set, so a
    file the page stopped naming (a widget switched back to private, an image deleted from a shared note)
    is the same not-found as a file that never existed."""
    if not attachment_base:
        return frozenset()
    text = json.dumps(payload, ensure_ascii=False)
    pattern = re.escape(attachment_base) + r"(inline|hero)/([^\"\\/?#\s]+)"
    return frozenset(f"{m.group(1)}/{m.group(2)}" for m in re.finditer(pattern, text))


#: How long one note revision's reference set is reused (R59): a page's images are fetched in a burst.
REFERENCE_SET_TTL_S = 60.0
_REF_SETS: dict[tuple, tuple[float, frozenset[str]]] = {}
_REF_SETS_MAX = 500
_REF_LOCK = threading.Lock()
#: Fix F1b (review M-2): ONE computation per cold key. A page's images arrive as a burst, and each miss is a
#: full `public_note` reduction plus `public_facts`; the burst now waits on the first request's answer. A
#: waiter holds a request thread, so at most `REFERENCE_SET_WAITERS` wait, each at most
#: `REFERENCE_SET_WAIT_S`; any other computes its own (the old behaviour, never a refusal).
REFERENCE_SET_WAITERS = 16
REFERENCE_SET_WAIT_S = 10.0
_REF_FLIGHT: Any = None


def _reference_flight() -> Any:
    """The reference sets' single-flight table (notebook_widgets.SingleFlight, created on first use)."""
    global _REF_FLIGHT
    with _REF_LOCK:
        if _REF_FLIGHT is None:
            from api.services.journal_two.notebook_widgets import SingleFlight
            _REF_FLIGHT = SingleFlight(REFERENCE_SET_WAITERS, name="public reference set")
        return _REF_FLIGHT


def cached_reference_set(key: tuple, compute: Callable[[], frozenset[str]], *,
                         now: Callable[[], float] | None = None) -> frozenset[str]:
    """`compute()`'s set, held `REFERENCE_SET_TTL_S` per `key`. The caller's key names the note AND its
    revision (`updated_at`), so a write that drops an image is never answered from the old set. Bounded:
    past `_REF_SETS_MAX` keys the oldest entries go. Per process.

    Concurrent misses for one key compute it ONCE (review M-2): the first runs `compute` on its own thread
    (it reads through the request's own sqlite connection, which is bound to that thread, so never a pool)
    and the rest take its answer."""
    t = (now or time.monotonic)()
    with _REF_LOCK:
        hit = _REF_SETS.get(key)
        if hit is not None and t - hit[0] < REFERENCE_SET_TTL_S:
            return hit[1]

    def fill() -> frozenset[str]:
        with _REF_LOCK:     # review m4: a caller that missed above but became a leader after the last one stored
            hit = _REF_SETS.get(key)
            if hit is not None and t - hit[0] < REFERENCE_SET_TTL_S:
                return hit[1]
        got = frozenset(compute())
        with _REF_LOCK:
            _REF_SETS[key] = (t, got)
            if len(_REF_SETS) > _REF_SETS_MAX:
                for k, _v in sorted(_REF_SETS.items(), key=lambda kv: kv[1][0])[:len(_REF_SETS) - _REF_SETS_MAX]:
                    _REF_SETS.pop(k, None)
        return got

    ok, got = _reference_flight().run_here(key, fill, REFERENCE_SET_WAIT_S)
    return got if ok else fill()


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
    "PUBLIC_HEADERS", "PUBLIC_IMAGE_HEADERS", "IMAGE_CSP", "NOT_FOUND_DETAIL", "PUBLIC_NOTE_KEYS", "NEUTRAL_LINE", "ACCOUNT_NEUTRAL_LINE", "LINKED_NOTE_TEXT",
    "NODE_POLICY", "MARKET_DATA_VENDORS", "VENDOR_VERDICT", "EMBED_KEPT_ATTRS", "EMBED_PARAM_KEYS",
    "ATTR_POLICY", "EMBED_ROW_KEYS", "SCALAR_ITEMS", "PAIR_ITEMS", "allowed_params", "GALLERY_ATTR_POLICY", "GALLERY_FONT_FAMILIES", "GALLERY_FONT_SIZE_RANGE",
    "GALLERY_COLOR_NAMES", "GALLERY_CALLOUT_VARIANTS", "GALLERY_EMBED_REFS", "GALLERY_LINK_FIXED",
    "PUBLIC_ATTR_POLICY", "ATTR_POLICY_BY_MODE", "PUBLIC_FONT_SIZE_BOUNDS", "safe_font_family", "safe_font_size",
    "SHOWN", "NEUTRAL", "MODES", "BASE_MODES", "EXAMPLE_OVERRIDES", "EXAMPLE_IMAGE_ATTRS", "node_action",
    "attr_decision", "not_found", "public_json", "public_file", "enforce_rate",
    "client_key", "market_data_verdict", "reduce", "public_hero", "public_note", "public_facts",
    "read_public_note", "walk_types", "referenced_images", "cached_reference_set", "REFERENCE_SET_TTL_S",
]
