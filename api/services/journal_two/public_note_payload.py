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
    user id and that note's id) is dropped; file attachment chips are dropped.
  * publish only -- Ask answers (`askInsert` with no `action`) go, writing-help blocks
    stay with their label (ruling D-B5), and every `askCitation` goes.
"""
from __future__ import annotations

import copy
import json
import re
from typing import Any, Iterable, Mapping

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
    `request_ip.client_ip`, which reads CF-Connecting-IP first), never a second copy of it."""
    from api.limiter import limiter
    return "ip:" + str(limiter._key_func(request))


# ── What a public copy of a note is made of ──────────────────────────────────────────────

#: The public keys of a NOTE, exactly (rail: tests/test_share_publish_authorization.py).
PUBLIC_NOTE_KEYS = ("title", "subtitle", "bodyJson", "heroImageUrl", "updatedAt")

MODES = ("share", "publish")

#: ONE neutral paragraph where a market-data item stood (ruling D-B4, extended to share
#: links by the owner's L3). Adjacent ones collapse to one.
NEUTRAL_LINE = "A market-data item is not shown on public pages."

#: What a noteLink becomes (ruling D-B7): no id and no title leaves.
LINKED_NOTE_TEXT = "linked note"

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
    # financialFact -- by the fact's recorded source.
    ("financialFact", "fmp"): "fmp",
    ("financialFact", "finnhub"): "finnhub",
    ("financialFact", "massive"): "massive",      # the `price` fact type
    ("financialFact", "user"): "member",          # the member's own words ("my target: $195")
    ("financialFact", "uct_derived"): "private",  # derived from the member's trades
    # documentExcerpt -- D-B4 unchanged (the planner listed it as vendor data: an excerpt of
    # an uploaded filing or report). Not loosened here.
    ("documentExcerpt", None): "document",
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
NODE_POLICY: dict[str, dict[str, str]] = {
    # ── nodes ──
    "doc": {"share": "keep", "publish": "keep"},
    "paragraph": {"share": "keep", "publish": "keep"},
    "text": {"share": "keep", "publish": "keep"},
    "heading": {"share": "keep", "publish": "keep"},
    "blockquote": {"share": "keep", "publish": "keep"},
    "bulletList": {"share": "keep", "publish": "keep"},
    "orderedList": {"share": "keep", "publish": "keep"},
    "listItem": {"share": "keep", "publish": "keep"},
    "taskList": {"share": "keep", "publish": "keep"},
    "taskItem": {"share": "keep", "publish": "keep"},
    "codeBlock": {"share": "keep", "publish": "keep"},
    "hardBreak": {"share": "keep", "publish": "keep"},
    "horizontalRule": {"share": "keep", "publish": "keep"},
    "table": {"share": "keep", "publish": "keep"},
    "tableRow": {"share": "keep", "publish": "keep"},
    "tableCell": {"share": "keep", "publish": "keep"},
    "tableHeader": {"share": "keep", "publish": "keep"},
    "callout": {"share": "keep", "publish": "keep"},
    "toggle": {"share": "keep", "publish": "keep"},
    "toggleSummary": {"share": "keep", "publish": "keep"},
    "toggleContent": {"share": "keep", "publish": "keep"},
    "videoTimestamp": {"share": "keep", "publish": "keep"},
    "blockMath": {"share": "keep", "publish": "keep"},
    "inlineMath": {"share": "keep", "publish": "keep"},
    "columns": {"share": "keep", "publish": "keep"},
    "column": {"share": "keep", "publish": "keep"},
    "dateMention": {"share": "keep", "publish": "keep"},
    "tableOfContents": {"share": "keep", "publish": "keep"},
    "imageCaption": {"share": "keep", "publish": "keep"},
    "linkPreview": {"share": "keep", "publish": "keep"},   # the member's external link card
    "webEmbed": {"share": "keep", "publish": "keep"},      # an allowlisted external embed
    "image": {"share": "image", "publish": "image"},
    "imageFigure": {"share": "figure", "publish": "figure"},
    "attachmentChip": {"share": "drop", "publish": "drop"},  # file attachments never leave
    "noteLink": {"share": "linked-note", "publish": "linked-note"},
    "askCitation": {"share": "citation-n", "publish": "drop"},
    "askInsert": {"share": "keep", "publish": "ask"},
    "widgetEmbed": {"share": "market-data", "publish": "market-data"},
    "financialFact": {"share": "market-data", "publish": "market-data"},
    "documentExcerpt": {"share": "market-data", "publish": "market-data"},
    # ── marks ──
    "bold": {"share": "mark", "publish": "mark"},
    "code": {"share": "mark", "publish": "mark"},
    "italic": {"share": "mark", "publish": "mark"},
    "strike": {"share": "mark", "publish": "mark"},
    "underline": {"share": "mark", "publish": "mark"},
    "textStyle": {"share": "mark", "publish": "mark"},
    "highlight": {"share": "mark", "publish": "mark"},
    "textColor": {"share": "mark", "publish": "mark"},
    "link": {"share": "link-mark", "publish": "link-mark"},
}

#: The widgetEmbed attributes a public copy keeps -- exactly what the archived render reads
#: (`WidgetEmbedView.jsx` ArchivedImage / PlaceholderChip / the frame): the image, the
#: frame's size, the caption the member wrote, and what `embedAutoCaption` needs for the alt
#: text. ⛔ Never `tradeRef` (names a member's trade), `searchText`, `annotations` or
#: `embedId`; and of `params`, only the keys `EMBED_PARAM_KEYS` names for that widget (the
#: widget's plain-text line reads them; the rest -- settings, frozen data -- stay home).
EMBED_KEPT_ATTRS = ("v", "widgetId", "mode", "capturedAt", "fallback", "frozen", "caption", "layout")
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
    or an absolute URL on our own host. Those lose the link and keep their text."""
    if not isinstance(href, str) or not href.strip():
        return True
    h = href.strip()
    if not _EXTERNAL_HREF.match(h):
        return True
    low = h.lower()
    return any(f"//{host}" in low or f".{host}" in low for host in _OWN_HOSTS)


class _Ctx:
    def __init__(self, mode: str, facts: Mapping[str, Mapping[str, Any]],
                 note_links: Mapping[str, tuple[str, str]]):
        self.mode = mode
        self.facts = facts
        self.note_links = note_links


def _neutral() -> dict:
    return {"type": "paragraph", "content": [{"type": "text", "text": NEUTRAL_LINE}]}


def _is_neutral(node: Any) -> bool:
    return (isinstance(node, dict) and node.get("type") == "paragraph"
            and node.get("content") == [{"type": "text", "text": NEUTRAL_LINE}])


def _reduce_marks(marks: Any) -> list | None:
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
        if action in ("mark", "link-mark"):
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
            if not isinstance(url, str) or _ATTACHMENT_PREFIX in url:
                kept["fallback"] = None              # another note's image: no image at all
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
        if isinstance(src, str) and _ATTACHMENT_PREFIX in src:
            return []                                # another note's image
    out = {k: v for k, v in node.items() if k not in ("content", "marks")}
    if "marks" in node:
        marks = _reduce_marks(node.get("marks"))
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
    ctx = _Ctx(mode, facts or {}, note_links or {})
    reduced = _reduce_node(json.loads(raw), ctx)
    if not reduced or reduced[0].get("type") != "doc":
        return {"type": "doc", "content": [{"type": "paragraph"}]}
    out = reduced[0]
    if not out.get("content"):
        out["content"] = [{"type": "paragraph"}]
    return out


def public_hero(hero: Any, *, owner_id: str, note_id: str, attachment_base: str) -> str | None:
    """The hero image, rewritten to the public proxy; another note's image goes."""
    if not isinstance(hero, str) or not hero:
        return None
    h = hero.replace(f"{_ATTACHMENT_PREFIX}{owner_id}/{note_id}/", attachment_base)
    return None if _ATTACHMENT_PREFIX in h else h


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
    "SHOWN", "NEUTRAL", "MODES", "not_found", "public_json", "public_file", "enforce_rate",
    "client_key", "market_data_verdict", "reduce", "public_hero", "public_note", "public_facts",
    "read_public_note", "walk_types",
]
