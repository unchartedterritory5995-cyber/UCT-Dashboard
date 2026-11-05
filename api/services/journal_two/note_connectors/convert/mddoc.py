"""Markdown -> TipTap JSON, server-side.

Python port of the wizard's browser pipeline
(`app/src/pages/journal-2-0/lib/importer/adapters/generic.js::mdToHtml` +
`convert.js::htmlToNote`, which round-trips through `generateJSON`) — except
here there is no browser/DOM, so this walks the markdown-it-py TOKEN STREAM
directly and builds TipTap JSON nodes by hand. Output must stay inside the
node/mark vocabulary declared by `tiptap.js::buildExtensions`:

    doc / paragraph / heading(1-3) / bulletList / orderedList / listItem /
    taskList / taskItem(checked) / table / tableRow / tableHeader /
    tableCell / codeBlock(language) / blockquote / horizontalRule /
    hardBreak / image(src) / attachmentChip(href,name,size) /
    text with marks bold / italic / strike / code / link(href) /
    underline (the HTML walker's `<u>` only) /
    highlight (from an inline `<mark>`…`</mark>` pair only -- wave 5's
    NotebookHighlight; how an Obsidian `==x==` arrives, review N5)

mddoc.py never emits `attachmentChip` — deciding which non-image link targets
are file attachments is a per-connector concern (mirroring how the wizard's
adapters resolve that at the HTML-preprocessing step, before `generateJSON`
ever runs), not this generic markdown layer's job. `rewrite.py` still has to
understand attachmentChip nodes, because a connector's own pre-pass (or a
later block converter such as the design's planned `notion_blocks.py`) can
still hand `rewrite_body` a doc containing one.

Placeholder conventions (shared with the JS side, `commit.js`):
  - `import-ref://<ref>`  — an unresolved media reference. An image whose src
    already carries this prefix is a connector-supplied placeholder and is
    passed through untouched (no double-wrapping, no new media entry) — the
    connector already registered it. Any OTHER image src is wrapped into
    this placeholder scheme and recorded in the returned `media` list.
  - `import-link://<key>` — an unresolved doc-to-doc link. Passed through
    verbatim as a `link` mark's href; `rewrite_body` resolves it later. Every
    such href seen is also recorded (target key only) in the returned
    `links` list.

Spec: docs/superpowers/specs/2026-08-11-note-connectors-design.md §4.
"""

from __future__ import annotations

import re
import urllib.parse
from html.parser import HTMLParser
from typing import Any, Callable

from markdown_it import MarkdownIt
from markdown_it.common.normalize_url import validateLink as markdown_it_validate_link
from markdown_it.token import Token
from mdit_py_plugins.tasklists import tasklists_plugin

from api.services.journal_two import import_notice

from . import ATTACHMENT_REF_PREFIX, LINK_PREFIX, REF_PREFIX
from .emoji import is_extended_pictographic
from .marks import exclusive_marks

_MD: MarkdownIt | None = None


def _get_md() -> MarkdownIt:
    """A GFM-like markdown-it-py instance: CommonMark base + GFM tables +
    strikethrough + a task-list post-pass (checkbox state on list items).
    Built once and reused — `MarkdownIt.parse()` is stateless per call."""
    global _MD
    if _MD is None:
        md = MarkdownIt("commonmark").enable(["table", "strikethrough"])
        md.use(tasklists_plugin, enabled=True)
        md.validateLink = _validate_link
        _MD = md
    return _MD


def _validate_link(url: str) -> bool:
    """markdown-it's destination gate, OPEN: every destination tokenizes, and this module
    decides what each one becomes (Plan A Task 15, D2).

    ⛔ Why open. markdown-it's stock gate (`BAD_PROTO_RE`: javascript, vbscript, file, data)
    does not refuse a LINK, it refuses to PARSE one: `[text](javascript:alert(1))` was then
    stored as that raw markdown source. Opened, the destination reaches the two places that
    already own the decision, each the one guard for its invariant:
      * a link: `_is_allowed_link_href` (TipTap's own allow-list) refuses the mark, so the
        visible `text` stays and nothing else does; nothing the stock gate refused can pass
        it (none of the four schemes is on TipTap's list);
      * an image: `_image_node` refuses any src the STOCK gate refuses (`_is_unsafe_image_src`)
        except a `data:image/*` of any MIME (Plan A Task 9, I-6), which it registers as a
        media entry the engine decodes and rehosts."""
    return True


class _Ctx:
    __slots__ = ("media", "links", "media_refs", "data_uri_counter", "resolve_href",
                 "unsafe_image_notice", "inherited")

    def __init__(self, resolve_href: Callable[[str], str | None] | None = None,
                 unsafe_image_notice: bool = False) -> None:
        # Task 15 fix round 1: a connector caller's answer for an unsafe image src
        # (`_inline_nodes`' image branch): an importNotice `unsafe`, not the text marker.
        self.unsafe_image_notice = unsafe_image_notice
        self.media: list[dict[str, Any]] = []
        self.links: list[str] = []
        self.media_refs: set[str] = set()  # dedup guard for `_register_media`
        self.data_uri_counter: int = 0  # for synthesizing bounded md-img-N refs
        # Plan A Task 13: a connector's answer for a scheme-less link (`_link_href`).
        self.resolve_href = resolve_href
        # D3 fix round 1 (C1): the inline elements an HTML region holds open around the
        # markdown blocks being converted, as `[tag, mark or None]` lists, outermost first.
        # `_inline_nodes` starts every run inside them and REMOVES one a raw close tag ends.
        self.inherited: list[list[Any]] = []


# Plan A Task 9 (I-6): EVERY `data:image/*` destination -- any image MIME, base64 or
# percent-encoded -- tokenizes as an image (`_validate_link` widens markdown-it's own gate,
# which admits only `data:image/(gif|png|jpeg|webp);`), and `_data_uri_image_node` registers
# it as a media entry with a bounded `md-img-N.<ext>` ref. ⚰️ Before this an SVG, a HEIC or
# a percent-encoded image was refused here and lost.
#
# A NON-image `data:` destination is still refused by markdown-it, and would then fall back
# to literal, UNBOUNDED source text (a real payload can run tens of KB; probed: 20 KB made a
# single 20,307-char text node). So a pre-tokenization pass over the RAW markdown replaces
# exactly that construct with a short visible marker before `_get_md().parse(...)` sees it.
# Tolerant of an optional `"title"`/'title' suffix (CommonMark allows `![alt](url "title")`)
# and of balanced parentheses in a percent-encoded payload. An IMAGE MIME is left
# byte-for-byte untouched (`re.Match.group(0)`) for the tokenizer.
# D3 item 5: the type and its parameters hold no `(` (no real one does). With `(` allowed,
# `[^;,\s)]*` ran from each `](data:` over every following `![a](data:` to the end of the run:
# quadratic, 2.2 s at 40 KB.
_DATA_IMAGE_MD_RE = re.compile(
    r"!\[(?P<alt>[^\]]*)\]\("
    r"\s*data:(?P<mime>[^;,\s()]*)(?:;[^;,\s()]*)*,(?:[^\s()]|\([^\s()]*\))*"
    r"\s*(?:\"[^\"]*\"|'[^']*')?\s*"
    r"\)",
    re.IGNORECASE,
)


#: The destination half of `_DATA_IMAGE_MD_RE`, from its `](`: what the pass below searches
#: for. ⛔ Never the whole pattern: its `!\[[^\]]*` scans to the next `]` from EVERY `!`, so a
#: run of `![[` (an Obsidian embed run) or `![` with no `]` was quadratic (D3 item 5: 1.1 s
#: at 39 KB, 2.2 s at 40 KB of `![a](data:`, on the connector worker).
_DATA_URI_DEST_RE = re.compile(_DATA_IMAGE_MD_RE.pattern[len(r"!\[(?P<alt>[^\]]*)"):],
                               re.IGNORECASE)


def _extract_data_uri_images(md: str) -> str:
    """The raw-markdown pass above: every `![alt](data:...)` whose MIME is an image is left
    for the tokenizer to extract as a media entry; every other one becomes a short visible
    `[unsupported image: ...]` marker (never an image, never the payload as text).

    Linear (D3 item 5), and the SAME matches `_DATA_IMAGE_MD_RE.sub` makes: search the
    destination half from its `]`, then take the alt's start as that regex would, the LEFTMOST
    `![` after the previous `]` (an alt holds no `]`) and after the last match. Every `![`
    between two `]`s reaches the same `]`, so they all match there or none does; each
    character is searched forward once and backward once. A `]` with no `![` before it is no
    match, and the search resumes one character on, as the regex would."""
    out: list[str] = []
    last = 0  # end of the previous match: a match never starts inside one
    pos = 0
    while True:
        m = _DATA_URI_DEST_RE.search(md, pos)
        if m is None:
            break
        close = m.start()
        floor = max(last, md.rfind("]", last, close) + 1)
        start = md.find("![", floor, close)
        if start == -1:
            pos = close + 1
            continue
        mime = m.group("mime").strip()
        out.append(md[last:start])
        if _is_image_mime(mime):
            out.append(md[start:m.end()])  # an image -- untouched, extracted downstream
        else:
            alt = md[start + 2:close].strip()
            shown = mime or "no type"
            out.append(f"[unsupported image: {alt}, {shown}]" if alt else f"[unsupported image: {shown}]")
        last = pos = m.end()
    out.append(md[last:])
    return "".join(out)


def md_to_tiptap(
    md: str | None, *, resolve_href: Callable[[str], str | None] | None = None,
    unsafe_image_notice: bool = False,
) -> dict[str, Any]:
    """Convert a markdown string into `{doc, media, links}`.

    - `doc` — a TipTap JSON document (`{"type": "doc", "content": [...]}`).
      Empty/whitespace-only input yields `{"type": "doc", "content": []}`,
      matching the empty-body convention already used server-side
      (`notes.py::_validate_body_json`).
    - `media` — `[{"ref", "kind", "name"}, ...]` for every image reference
      encountered that was NOT already an `import-ref://` placeholder.
    - `links` — the target key (prefix stripped) of every `import-link://`
      href encountered, in document order.

    `resolve_href` (Plan A Task 13): a connector's own answer for a link that names
    something in ITS world, e.g. an Obsidian vault's relative `[x](Other%20note.md)`.
    See `_link_href`: it is asked only about a scheme-less, non-`#` destination
    (markdown `[x](...)` or a raw `<a href>`), decoded once. A string answer replaces the
    href; None keeps today's href, which the engine's one link policy then judges
    (`linkify.resolve_href`: a relative href with no http(s) source becomes text).

    `unsafe_image_notice` (Task 15 fix round 1, controller ruling): passed True by the
    CONNECTOR callers only. An image whose src markdown-it's stock gate refuses
    (`_is_unsafe_image_src`: javascript, vbscript, file, a non-image data URI, read raw AND
    decoded once) then becomes an importNotice `unsafe` in place. False (the personal API and
    inbound email, which strip media to their own markers) keeps the `[unsupported image]`
    text. Either way it is never a media entry.
    """
    cleaned = _extract_data_uri_images(md or "")
    tokens = _get_md().parse(cleaned)
    ctx = _Ctx(resolve_href, unsafe_image_notice)
    doc = {"type": "doc", "content": _blocks(tokens, 0, len(tokens), ctx)}
    # D3 item 8: `- - a` and `- ![x](a.png)` open a list item with a block, as raw HTML does;
    # the same repair as `html_to_tiptap`, so a markdown list reads as the client's parse.
    repair_list_items(doc)
    return {"doc": doc, "media": ctx.media, "links": ctx.links}


# ---------------------------------------------------------------------------
# block-level walk
# ---------------------------------------------------------------------------


def _find_close(tokens: list[Token], open_idx: int, close_type: str) -> int:
    """Index of the token that closes `tokens[open_idx]`, honoring same-type
    nesting (nested bullet lists, nested blockquotes, ...) via depth
    counting on the OPEN token's own type."""
    open_type = tokens[open_idx].type
    depth = 0
    for i in range(open_idx, len(tokens)):
        t = tokens[i].type
        if t == open_type:
            depth += 1
        elif t == close_type:
            depth -= 1
            if depth == 0:
                return i
    raise ValueError(f"unbalanced markdown tokens: unclosed {open_type!r}")


def _blocks(tokens: list[Token], start: int, end: int, ctx: _Ctx) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    i = start
    while i < end:
        t = tokens[i]

        if t.type == "heading_open":
            level = min(int(t.tag[1:]), 3)
            inline = tokens[i + 1]
            flat = _inline_nodes(inline.children or [], ctx)
            # Heading's content model is `inline*` (verified against the
            # installed @tiptap/extension-heading@3.23.6 source) — it cannot
            # hold a block-level Image node. Hoist any image OUT as a sibling
            # block right after the heading; the heading keeps only its text.
            text_items = [n for n in flat if n.get("type") not in _HOISTABLE_BLOCK_TYPES]
            images = [n for n in flat if n.get("type") in _HOISTABLE_BLOCK_TYPES]
            out.append({"type": "heading", "attrs": {"level": level}, "content": text_items})
            out.extend(images)
            i += 3

        elif t.type == "paragraph_open":
            inline = tokens[i + 1]
            flat = _inline_nodes(inline.children or [], ctx)
            out.extend(_wrap_paragraph(flat))
            i += 3

        elif t.type == "bullet_list_open":
            j = _find_close(tokens, i, "bullet_list_close")
            out.extend(_list_runs(tokens, i + 1, j, ctx, ordered=False))
            i = j + 1

        elif t.type == "ordered_list_open":
            j = _find_close(tokens, i, "ordered_list_close")
            out.extend(_list_runs(tokens, i + 1, j, ctx, ordered=True))
            i = j + 1

        elif t.type == "table_open":
            j = _find_close(tokens, i, "table_close")
            rows = _table_rows(tokens, i + 1, j, ctx)
            out.append({"type": "table", "content": rows})
            i = j + 1

        elif t.type in ("fence", "code_block"):
            language = None
            if t.type == "fence":
                info = (t.info or "").strip()
                language = info.split()[0] if info else None
            text = _code_without_line_end(t.content or "")
            content = [{"type": "text", "text": text}] if text else []
            out.append({"type": "codeBlock", "attrs": {"language": language}, "content": content})
            i += 1

        elif t.type == "blockquote_open":
            j = _find_close(tokens, i, "blockquote_close")
            content = _blocks(tokens, i + 1, j, ctx)
            out.append({"type": "blockquote", "content": content})
            i = j + 1

        elif t.type == "hr":
            out.append({"type": "horizontalRule"})
            i += 1

        elif t.type == "html_block" and (region := _html_region(tokens, i, end, ctx)) is not None:
            nodes, i = region
            out.extend(nodes)

        elif t.type == "html_block":
            converted = _raw_html_block(t.content or "", ctx)
            if converted is not None:
                out.extend(converted)
            else:
                text = (t.content or "").strip()
                if text:
                    out.append({"type": "paragraph", "content": [{"type": "text", "text": text}]})
            i += 1

        else:
            # Anything else this restricted preset can't produce (or a
            # future token type) degrades to nothing rather than crashing —
            # never emit a node outside the declared vocabulary.
            i += 1

    return out


# Node types that must be HOISTED out of inline content to their own sibling
# block — both are block-level atoms in the installed TipTap config
# (`extension-image`'s `inline: false`; `attachmentChip.js`'s `group:
# 'block'`), so neither can legally sit inside a paragraph's own `content`.
# `attachmentChip` never appears here from the MARKDOWN walker directly (only
# via a connector's post-`md_to_tiptap` promotion pass — Obsidian's, through
# `convert/placeholders.py`; Dropbox's, the first, was archived 2026-11-04); it's included here purely
# so the HTML walker's `_html_inline_walk` (which CAN emit one directly, via
# `ATTACHMENT_REF_PREFIX`) gets the same correct hoisting for free. Widening
# this set is a strict no-op for existing markdown-walker output.
#: `importNotice` (Task 15 fix round 1): a block leaf, written in an image's place on the
#: connector path, hoisted exactly as the image would have been.
_HOISTABLE_BLOCK_TYPES = frozenset({"image", "attachmentChip", import_notice.IMPORT_NOTICE_TYPE})


def _code_without_line_end(text: str) -> str:
    """A code block's text without its FINAL line end (D3 item 1), one `\\n` and no more.

    markdown-it ends every fenced or indented block's content with the line end before the
    closing fence, and an HTML `<pre>` often ends the same way; it is the block's line end, not
    a line the member wrote. Exactly one goes: the export writes ```` ```lang\\n{code}\\n``` ````
    (`notes_export._block`), so dropping one is what reads every code back unchanged, a
    member's own trailing blank line included. ⚰️ This was `rstrip("\\n")`, which ate that
    blank line too. The client lane drops the same one (`convert.js::dropCodeLineEnds`)."""
    return text[:-1] if text.endswith("\n") else text


def _wrap_paragraph(flat: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Splits a flat inline-node sequence into block-level nodes, hoisting
    any `image`/`attachmentChip` item out to its own sibling block. Both are
    block-level in the real editor's schema, so `text ![x](y) text` must
    become `paragraph, image, paragraph` — embedding either inside a
    paragraph's content would be schema-invalid in the real editor."""
    out: list[dict[str, Any]] = []
    buf: list[dict[str, Any]] = []
    for item in flat:
        if item.get("type") in _HOISTABLE_BLOCK_TYPES:
            if buf and not _blank_run(buf):
                out.append({"type": "paragraph", "content": buf})
            buf = []
            out.append(item)
        else:
            buf.append(item)
    if buf and out and _blank_run(buf):
        buf = []  # only whitespace after the last atom (D3 item 4)
    if buf or not out:
        out.append({"type": "paragraph", "content": buf})
    return out


#: HTML's own whitespace, as the client's parse collapses and strips it (a no-break space is
#: text, never stripped).
_ASCII_SPACE_ONLY_RE = re.compile(r"[ \t\r\n\f]*")


def _blank_run(buf: list[dict[str, Any]]) -> bool:
    """D3 item 4: a run beside a block atom holding only whitespace text (`x ![a](a) ![b](b)`
    leaves `" "` between the images) is no paragraph. The client's parse strips it as it closes
    the block around the atom, so it never wrote the lone `paragraph(" ")` the server did. A
    hard break, an atom-free paragraph, and a no-break space are kept, as there."""
    return all(i.get("type") == "text" and _ASCII_SPACE_ONLY_RE.fullmatch(i.get("text") or "")
               for i in buf)


# ---------------------------------------------------------------------------
# lists (incl. task lists)
# ---------------------------------------------------------------------------


def _list_runs(
    tokens: list[Token], start: int, end: int, ctx: _Ctx, ordered: bool,
) -> list[dict[str, Any]]:
    """A markdown list can mix checkbox (`- [ ] x`) and plain items freely,
    but TipTap's schema cannot: `taskList` requires `taskItem+` and
    `bulletList`/`orderedList` require `listItem+` (verified against the
    installed @tiptap/extension-list@3.23.6 source) — a `listItem` inside a
    `taskList` (or vice versa) is schema-invalid. So a single markdown list
    can emit MULTIPLE sibling list nodes: parse every item first, then split
    into consecutive same-kind RUNS, each becoming its own taskList/
    bulletList/orderedList. Recursion into `_blocks`/`_task_item_blocks` for
    each item's content means nested mixed lists split the same way."""
    parsed: list[dict[str, Any]] = []
    i = start
    while i < end:
        t = tokens[i]
        if t.type != "list_item_open":
            i += 1
            continue
        j = _find_close(tokens, i, "list_item_close")
        classes = t.attrs.get("class") or ""
        if "task-list-item" in classes:
            checked, content = _task_item_blocks(tokens, i + 1, j, ctx)
            parsed.append({"task": True, "checked": checked, "content": content})
        else:
            content = _blocks(tokens, i + 1, j, ctx)
            marker = None
            if ordered and t.info:
                try:
                    marker = int(t.info)
                except ValueError:
                    marker = None
            parsed.append({"task": False, "content": content, "marker": marker})
        i = j + 1

    out: list[dict[str, Any]] = []
    idx = 0
    while idx < len(parsed):
        is_task = parsed[idx]["task"]
        run = []
        while idx < len(parsed) and parsed[idx]["task"] == is_task:
            run.append(parsed[idx])
            idx += 1
        if is_task:
            items = [
                {"type": "taskItem", "attrs": {"checked": p["checked"]}, "content": p["content"]}
                for p in run
            ]
            out.append({"type": "taskList", "content": items})
        else:
            items = [{"type": "listItem", "content": p["content"]} for p in run]
            if ordered:
                # Each RUN restarts numbering from its own first item's own
                # marker digit (not always 1) — the source's own numbering,
                # not a guess.
                start_at = run[0]["marker"] if run[0]["marker"] is not None else 1
                out.append({"type": "orderedList", "attrs": {"start": start_at}, "content": items})
            else:
                out.append({"type": "bulletList", "content": items})
    return out


def _task_item_blocks(
    tokens: list[Token], start: int, end: int, ctx: _Ctx,
) -> tuple[bool, list[dict[str, Any]]]:
    """The tasklists plugin (mdit_py_plugins.tasklists) marks a checkbox-led
    list item's class and — on its FIRST paragraph's inline children — always
    inserts a synthetic `html_inline` checkbox token at position 0 (content
    containing `checked="checked"` iff checked), leaving the original first
    text child's content missing its `[x] ` prefix but with the separating
    whitespace still attached. We strip that checkbox token here, lstrip the
    leftover leading whitespace off the following text run, and build the
    paragraph from what remains."""
    checked = False
    blocks: list[dict[str, Any]] = []

    has_leading_paragraph = (
        start < end
        and tokens[start].type == "paragraph_open"
        and start + 1 < end
        and tokens[start + 1].type == "inline"
    )
    if not has_leading_paragraph:
        return checked, _blocks(tokens, start, end, ctx)

    inline = tokens[start + 1]
    children = inline.children or []
    rest = children
    lstrip_first = False
    if children and children[0].type == "html_inline":
        checked = "checked=" in (children[0].content or "")
        rest = children[1:]
        lstrip_first = True

    flat = _inline_nodes(rest, ctx, lstrip_first=lstrip_first)
    blocks.extend(_wrap_paragraph(flat))
    blocks.extend(_blocks(tokens, start + 3, end, ctx))
    return checked, blocks


# ---------------------------------------------------------------------------
# tables
# ---------------------------------------------------------------------------


def _table_rows(tokens: list[Token], start: int, end: int, ctx: _Ctx) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    i = start
    while i < end:
        t = tokens[i]
        if t.type == "tr_open":
            j = _find_close(tokens, i, "tr_close")
            cells = _table_cells(tokens, i + 1, j, ctx)
            rows.append({"type": "tableRow", "content": cells})
            i = j + 1
        else:
            i += 1
    return rows


def _table_cells(tokens: list[Token], start: int, end: int, ctx: _Ctx) -> list[dict[str, Any]]:
    cells: list[dict[str, Any]] = []
    i = start
    while i < end:
        t = tokens[i]
        if t.type in ("th_open", "td_open"):
            close_type = "th_close" if t.type == "th_open" else "td_close"
            j = _find_close(tokens, i, close_type)
            flat: list[dict[str, Any]] = []
            if j > i + 1 and tokens[i + 1].type == "inline":
                flat = _inline_nodes(tokens[i + 1].children or [], ctx)
            node_type = "tableHeader" if t.type == "th_open" else "tableCell"
            # TableCell/TableHeader content model is `block+` (verified
            # against the installed @tiptap/extension-table@3.23.6 source),
            # so an image can sit as a sibling BLOCK next to the cell's
            # paragraph — `_wrap_paragraph` (already used for top-level
            # paragraphs) produces exactly that shape. A cell with no image
            # still comes out as the plain single `[paragraph]` it always was.
            cells.append({"type": node_type, "content": _wrap_paragraph(flat)})
            i = j + 1
        else:
            i += 1
    return cells


# ---------------------------------------------------------------------------
# inline walk
# ---------------------------------------------------------------------------


def _pop_mark(stack: list[dict[str, Any]], mark_type: str) -> None:
    for i in range(len(stack) - 1, -1, -1):
        if stack[i]["type"] == mark_type:
            stack.pop(i)
            return


def _register_media(
    ctx: _Ctx, ref: str, kind: str, name: str, data_uri: str | None = None,
) -> None:
    """Adds one `{ref, kind, name[, data_uri]}` media entry, deduped by
    `ref` (mirrors `dedupeMedia` in the JS adapters — the SAME src/path
    referenced twice in one document must not produce two upload jobs for
    identical bytes; every occurrence's placeholder still points at the one
    registered ref)."""
    if ref in ctx.media_refs:
        return
    ctx.media_refs.add(ref)
    entry: dict[str, Any] = {"ref": ref, "kind": kind, "name": name}
    if data_uri is not None:
        entry["data_uri"] = data_uri
    # No `source_url` here: a content URL's ref IS the original, and the engine's notice
    # links to the ref when the entry names no `source_url` (`engine._media_source_url`).
    ctx.media.append(entry)


# Base64 data-URI images (`![x](data:image/png;base64,...)`) carry the WHOLE
# encoded payload as their "src" — using that verbatim as a media `ref` would
# explode the ref string (and the `import-ref://` placeholder embedding it)
# to the size of the image itself. Mirrors the JS docx importer's synthetic
# `docx-img-N.<ext>` convention (`adapters/generic.js::extractDocxImages`):
# assign a small counter-based ref instead, and carry the original data URI
# on the media entry's `data_uri` field so the engine can decode bytes from
# it directly (no upload-by-URL round trip needed for an already-inline image).
#
# Plan A Task 9 (I-6): the ONE grammar of a data URI -- `data:<mime>[;param...][;base64],
# <payload>` -- for this module and the engine's `_decode_data_uri`. The payload is base64
# when a `;base64` parameter is present, else percent-encoded (`data:image/svg+xml,%3Csvg...`).
DATA_URI_RE = re.compile(
    r"^\s*data:(?P<mime>[^;,]*)(?P<params>(?:;[^;,]*)*),(?P<payload>[\s\S]*)$", re.IGNORECASE)
_DATA_IMAGE_PREFIX_RE = re.compile(r"^\s*data:image/[a-z0-9][a-z0-9.+-]*[;,]", re.IGNORECASE)
_IMAGE_MIME_RE = re.compile(r"^image/[a-z0-9][a-z0-9.+-]*$", re.IGNORECASE)
#: The ref extension for an image MIME. Any other `image/*` takes its own subtype, sanitised.
_DATA_URI_MIME_EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/tiff": "tif",
    "image/bmp": "bmp",
    "image/avif": "avif",
    "image/x-icon": "ico",
    "image/vnd.microsoft.icon": "ico",
}


def _is_image_mime(mime: str) -> bool:
    return bool(_IMAGE_MIME_RE.match(mime.strip()))


def is_data_image_uri(src: str) -> bool:
    """True for a `data:image/*` URI this walker uploads (`_data_uri_image_node`). Public so a
    pre-pass (Plan E `enml.py`) asks the walker's own rule instead of keeping a copy."""
    match = DATA_URI_RE.match(src)
    return bool(match and _is_image_mime(match.group("mime")))


def _data_uri_ext(mime: str) -> str:
    mime = mime.strip().lower()
    known = _DATA_URI_MIME_EXT.get(mime)
    if known is not None:
        return known
    return re.sub(r"[^a-z0-9]", "", mime.split("/", 1)[1].split("+", 1)[0])[:10] or "img"


def _data_uri_image_node(src: str, ctx: _Ctx) -> dict[str, Any] | None:
    """A `data:image/*` src (any image MIME, base64 or percent-encoded) -> an image node with
    a bounded `md-img-N.<ext>` ref, the URI carried on the media entry's `data_uri`. `None`
    (the caller's visible "unsupported" text) for a non-image or malformed data URI."""
    match = DATA_URI_RE.match(src)
    if not match or not _is_image_mime(match.group("mime")):
        return None
    ext = _data_uri_ext(match.group("mime"))
    ctx.data_uri_counter += 1
    ref = f"md-img-{ctx.data_uri_counter}.{ext}"
    _register_media(ctx, ref=ref, kind="image", name=ref, data_uri=src)
    return {"type": "image", "attrs": {"src": f"{REF_PREFIX}{ref}"}}


_SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.\-]*:")


def _destination_as_written(dest: str, *, markdown_image: bool = False) -> str:
    """The ONE place a markdown-it-normalized destination is decoded.

    markdown-it percent-encodes a link destination (`<a b>` -> `a%20b`). Two
    kinds come back encoded and are decoded exactly once, here:
    an `import-link://` href, and (`markdown_image=True`, markdown token path
    only) a truly scheme-less image src, i.e. a vault path. EVERYTHING else
    passes through byte-for-byte: https/mailto/#fragment, relative link
    hrefs (decoding `%2F%2Fevil.com` would mint a protocol-relative external
    link), connector-private refs (`dbx-md-media:`, `od-html:` ... which their
    providers decode themselves) and raw HTML attribute values."""
    if dest.startswith(LINK_PREFIX):
        return urllib.parse.unquote(dest)
    if markdown_image and dest and not _SCHEME_RE.match(dest) and not dest.startswith("//"):
        return urllib.parse.unquote(dest)
    return dest


def _is_unsafe_image_src(src: str) -> bool:
    """A markdown image destination markdown-it's STOCK gate refuses (javascript, vbscript,
    file, a non-image data URI), asked on the token's src as markdown-it normalised it. A
    `data:image/*` of any MIME is the one widening (Plan A Task 9, I-6). `_validate_link`
    is open, so this is the image half of what the stock gate used to do."""
    return not _DATA_IMAGE_PREFIX_RE.match(src) and not markdown_it_validate_link(src)


def _image_node(token: Token, ctx: _Ctx) -> dict[str, Any] | None:
    """Returns the TipTap image node, or `None` when the src is an
    unsupported data URI (caller degrades to visible text in that case).

    An unsafe src (`_is_unsafe_image_src`) is asked on the src as markdown-it normalised it
    AND as `_destination_as_written` decodes it -- the decoded form is the one that would be
    registered (Task 15 fix round 1: `javascript%3Aalert(1)` passed the raw check and became
    the media ref `javascript:alert(1)`). Read as a browser reads it (`link_href_as_read`),
    so `java%09script:` is caught too. It is never a media entry: the connector path
    (`ctx.unsafe_image_notice`) gets an importNotice `unsafe` in place, everyone else `None`
    (the caller's visible marker)."""
    raw = token.attrs.get("src") or ""
    src = _destination_as_written(raw, markdown_image=True)
    if _is_unsafe_image_src(raw) or _is_unsafe_image_src(link_href_as_read(src)):
        if not ctx.unsafe_image_notice:
            return None
        return import_notice.notice_node(
            "unsafe", name=token.content or None, source_url=None, ref=None, attempts=0)
    if src.startswith(REF_PREFIX):
        # Already a connector-supplied placeholder — pass through untouched,
        # no duplicate media entry (the connector already registered it).
        return {"type": "image", "attrs": {"src": src}}
    if src.startswith("data:"):
        return _data_uri_image_node(src, ctx)
    _register_media(ctx, ref=src, kind="image", name=_basename(src))
    return {"type": "image", "attrs": {"src": f"{REF_PREFIX}{src}"}}


def _basename(ref: str) -> str:
    clean = ref.split("#", 1)[0].split("?", 1)[0]
    tail = clean.rsplit("/", 1)[-1]
    return tail or clean


# Mirrors @tiptap/extension-link@3.23.6's `isAllowedUri` helper
# (`src/link.ts`) combined with `tiptap.js`'s `Link.configure({
# protocols: ['https'], isAllowedUri })` override — VERIFIED against the
# literal installed-version source (`node_modules`-equivalent fetched
# directly), not paraphrased or assumed. Two things that source disproves a
# naive reading of the app's config:
#   1. `protocols: ['https']` does NOT restrict validation to https-only —
#      the helper's `allowedProtocols` array starts from a hardcoded default
#      list and the `protocols` OPTION IS APPENDED to it, never replaces it.
#      So http/ftp/ftps/mailto/tel/callto/sms/cid/xmpp are ALL still allowed
#      by `ctx.defaultValidate` regardless of the app-level config.
#   2. A scheme-less URL (relative path, hash link, bare text) is ALSO
#      allowed — the regex's `[^a-z]|[a-z0-9+.-]+(?:[^a-z+.-:]|$)` branch.
# On top of that base policy, tiptap.js's own `isAllowedUri` override
# explicitly allows `/journal...` and `import-link://...`. Only a URL with an
# explicit, unlisted scheme (`javascript:`, `vbscript:`, ...) is rejected —
# the mark is stripped and the text run is kept, mirroring the real editor's
# parseHTML rule returning `false` for a disallowed `<a href>`.
# `[^a-z+.-:]` is a RANGE, `.` to `:` -- it excludes `/` and the digits -- in
# JavaScript AND in Python `re`, and the pattern below is TipTap's text
# verbatim (a rail in test_note_convert_mddoc.py reads the INSTALLED
# @tiptap/extension-link and compares). Until wave 7 lane J fix round 1
# (review M-1) the hyphen was escaped here, which made it three literal
# characters: `notes/x.md`, `a1/b` and `javascript0:` were stored as links by
# this converter while the editor's parseHTML refused them -- one file, two
# answers, and a dead `href=""` wherever the stored mark was rendered.
_LINK_ALLOWED_PROTOCOLS = (
    "http", "https", "ftp", "ftps", "mailto", "tel", "callto", "sms", "cid", "xmpp",
)
_LINK_URI_RE = re.compile(
    r"^(?:(?:" + "|".join(_LINK_ALLOWED_PROTOCOLS) + r"):|[^a-z]|[a-z0-9+.-]+(?:[^a-z+.-:]|$))",
    re.IGNORECASE,
)


# ⛔ What TipTap's `isAllowedUri` strips from the WHOLE uri before the scheme
# check -- `UNICODE_WHITESPACE_PATTERN` in @tiptap/extension-link 3.23.6
# (dist/index.js): U+0000-U+0020, U+00A0, U+1680, U+180E, U+2000-U+2029, U+205F,
# U+3000. A browser ignores them inside a scheme too, so `java<TAB>script:` IS
# `javascript:`. Checked here on the raw string, `"  javascript:..."`,
# `"\tjavascript:..."` and `"java\x00script:..."` were refused by the editor
# and ADMITTED by this converter (wave 7 lane J, J6).
# ⛔ Written with `\u` escapes, never the characters themselves (wave 7 lane J,
# fix round 1, review M-2): U+2029 is a paragraph separator, so the raw one this
# line used to hold made `str.splitlines()` count the file one line longer than
# `\n` does -- any rail mapping `node.lineno` through `splitlines()` was off by
# one below it. This is the ONE copy of the class; lane G's personal API asks
# `link_href_as_read` rather than keeping its own.
_LINK_URI_INVISIBLE_RE = re.compile(r"[\u0000-\u0020\u00a0\u1680\u180e\u2000-\u2029\u205f\u3000]")


def link_href_as_read(href: str) -> str:
    """`href` as TipTap's `isAllowedUri` -- and a browser -- reads it: every
    character of `_LINK_URI_INVISIBLE_RE` removed. The one normaliser: the
    allow-list below and `note_personal_api._link_mark_survives` both ask it."""
    return _LINK_URI_INVISIBLE_RE.sub("", href)


def _is_allowed_link_href(href: str) -> bool:
    if not href:
        return True  # mirrors the JS helper's `!uri` short-circuit
    # tiptap.js's own override tests these two prefixes on the RAW url, ahead of the default check.
    if href.startswith("/journal") or href.startswith(LINK_PREFIX):
        return True
    return bool(_LINK_URI_RE.match(link_href_as_read(href)))


def _is_scheme_less_path(href: str) -> bool:
    read = link_href_as_read(href)
    return bool(read) and not read.startswith(("#", "//")) and not _SCHEME_RE.match(read)


def _link_href(href: str, ctx: _Ctx) -> str:
    """Plan A Task 13: the connector's `resolve_href` answer for `href`, else `href`.

    ⛔ THE one place `resolve_href` is asked. It is asked only about a scheme-less,
    non-`#`, non-`//` destination, and only when its once-decoded form is ALSO one: a
    `javascript%3A...` or `%2F%2Fhost` must never reach a resolver as `javascript:` or
    `//host` (see `_destination_as_written` for why relative hrefs are otherwise left
    encoded). An `import-link://` href is already decoded and never asked."""
    if not _is_scheme_less_path(href):
        return href
    if ctx.resolve_href is not None:
        decoded = urllib.parse.unquote(href)
        if _is_scheme_less_path(decoded):
            answer = ctx.resolve_href(decoded)
            if isinstance(answer, str) and answer:
                return answer
    # D3 item 6: a host-like href (`www.example.com`, `example.com/path`) is its `https://`
    # URL, as linkify writes one, asked only after the connector's own note answer. Here, not
    # only in the engine's `finalize_links`: TipTap's allow-list below refuses
    # `example.com/path` as a link, so the mark (and its target) was gone before then.
    from .linkify import host_like_href  # linkify imports this module
    return host_like_href(href.strip()) or href


# A raw tag that is ONE `<img ...>` or one opening `<a ...>`, nothing else.
#: A tag's attributes, quote-aware (D3 review I2): a `>` inside a quoted value is part of the
#: value, as markdown-it's own HTML_TAG_RE and the browser read it. Each alternative starts on
#: a different character, so the scan is linear.
_TAG_ATTRS = r"""(?:\s(?:[^<>"']|"[^"]*"|'[^']*')*)?"""
_RAW_TAG_RE = re.compile(r"^<(img|a)" + _TAG_ATTRS + r"/?>$", re.IGNORECASE)
#: A raw `</a>` close, spaces before its `>` allowed (`</a >`), any case (I2).
_CLOSE_A_RE = re.compile(r"^</a\s*>$", re.IGNORECASE)
#: D3 follow-up (difference 3): one inline raw tag, opening or closing (`<b>`, `</b>`, `<br/>`).
#: A comment, declaration or processing instruction does not match and renders as nothing.
_INLINE_TAG_RE = re.compile(
    r"^<(/?)([A-Za-z][A-Za-z0-9-]*)" + _TAG_ATTRS.replace(")*)?", ")*?)?") + r"(/?)>$", re.DOTALL)
#: The inline tags with a mark in the editor's schema, as its parse rules read them.
_INLINE_MARK_TAGS = {
    "b": "bold", "strong": "bold", "i": "italic", "em": "italic", "u": "underline",
    "s": "strike", "del": "strike", "strike": "strike", "code": "code", "mark": "highlight",
}
#: HTML's whitespace, the characters the client's parse collapses.
_HTML_SPACE_CHARS = " \t\r\n\f"
#: D3 review M3: the most raw inline tags held open in one paragraph; past it a tag unwraps.
_INLINE_MAX_OPEN = 100
#: Inline tags whose content is dropped with them, as the client's sanitiser drops it.
_INLINE_SKIPPED_TAGS = frozenset({"script", "style"})
#: The only tags a raw markdown HTML block may hold to be converted (Task 13).
_RAW_HTML_BLOCK_TAGS = frozenset({"img", "a"})


def _raw_inline_tag(content: str) -> "_HtmlNode | None":
    """The `<img>` / opening `<a>` element a markdown `html_inline` token holds, parsed by
    the HTML walker's own tokenizer (attribute entities decoded), else None."""
    text = content.strip()
    if not _RAW_TAG_RE.match(text):
        return None
    builder = _HtmlDomBuilder()
    builder.feed(text)
    builder.close()
    kids = [k for k in builder.root.children if isinstance(k, _HtmlNode)]
    return kids[0] if len(kids) == 1 and kids[0].tag in _RAW_HTML_BLOCK_TAGS else None


def _raw_html_block(html: str, ctx: _Ctx) -> list[dict[str, Any]] | None:
    """A markdown HTML block -> nodes through `html_to_tiptap`'s own walker, as the client
    renders it (markdown-it with `html: true`, then `sanitizeHtml` and the editor's parse).

    D3 follow-up (controller ruling): EVERY raw HTML block renders, sanitised by the walker's
    own rules: `<script>`/`<style>`/`<head>` are dropped with their content, an unknown tag
    unwraps (a block wrapper is a paragraph boundary), links pass the one allow-list, an
    unsafe image src is refused (`_html_image_node`), and nothing outside the vocabulary is
    ever written. ⚰️ Until then only a block of `<img>`/`<a>` rendered and any other tag stayed
    literal text (`<div>b]]` read `<div>b]]` on the server and `b]]` on the client). A block
    holding nothing visible (a comment, an empty `<div>`) is nothing, as on the client.

    None (the caller keeps the literal text) only when the block holds no tag at all, or a
    connector-private attachment href: a member's raw `<a href="import-attachment-ref://...">`
    must never mint an attachment chip."""
    if not _HTML_TAG_SYNTAX_RE.search(html):
        return None
    builder = _HtmlDomBuilder()
    # Stripped: the block's own last line end sits inside an unclosed tag (`<div>b]]\n`), and
    # the client's parse never keeps whitespace at a block's edge.
    builder.feed(html.strip())
    builder.close()
    seen: list[_HtmlNode] = []

    def walk(nodes: list[Any]) -> None:
        for n in nodes:
            if isinstance(n, _HtmlNode):
                seen.append(n)
                walk(n.children)

    walk(builder.root.children)
    if any(n.tag == "a" and (n.attrs.get("href") or "").strip().startswith(ATTACHMENT_REF_PREFIX)
           for n in seen):
        return None
    # A list item opening with a block is repaired with the whole doc (`md_to_tiptap`).
    return _html_blocks_walk(_unwrap_unknown_html(builder.root.children), ctx)


#: Elements whose markdown body spans blocks (`_html_region`).
_HTML_REGION_TAGS = frozenset({"details", "aside"})
#: A region element's close tag inside a nested markdown block (M2).
_REGION_CLOSE_RE = re.compile(r"</(details|aside)\s*>", re.IGNORECASE)


def _html_region(
    tokens: list[Token], start: int, end: int, ctx: _Ctx,
) -> tuple[list[dict[str, Any]], int] | None:
    """D3 follow-up (difference 2): a `<details>` or `<aside>` an HTML block OPENS and a later
    one closes, with markdown between, as Obsidian and GitHub write a collapsible section:

        <details>
        <summary>Setup</summary>

        body *markdown*

        </details>

    The client renders the whole note to HTML before parsing, so the markdown between is
    INSIDE the toggle. Here the blocks are one HTML parse fed piece by piece: each HTML block
    goes to the same builder, each markdown block in between is converted as usual and stands
    in the builder's open element as a `_BlocksNode`, until the builder is back at the top
    (or the note ends: an unclosed element holds the rest, as a browser's parse does).
    `(nodes, next index)`, or None when the block leaves no such element open."""
    first = tokens[start]
    builder = _HtmlDomBuilder()
    builder.feed(first.content or "")
    if not any(n.tag in _HTML_REGION_TAGS for n in builder._stack[1:]):
        return None
    k = start + 1
    while k < end and len(builder._stack) > 1:
        tk = tokens[k]
        if tk.nesting < 0:
            break  # the parent block closes: the region ends with it
        if tk.type == "html_block":
            builder.feed(tk.content or "")
            k += 1
            continue
        last = _find_close(tokens, k, tk.type[:-len("_open")] + "_close") if tk.nesting == 1 else k
        if tk.type == "paragraph_open":
            last = k + 2
        _place_region_blocks(builder, tokens, k, last + 1, ctx)
        # D3 review M2: a `</details>` or `</aside>` written INSIDE that block (in a list item)
        # still closes the region element, as the browser closes it (`details` is in scope
        # through `li`/`ul`). The block was converted whole; only those closes reach the builder.
        for nested in tokens[k + 1:last + 1]:
            if nested.type == "html_block":
                for close in _REGION_CLOSE_RE.findall(nested.content or ""):
                    builder.handle_endtag(close)
        k = last + 1
    builder.close()
    seen: list[_HtmlNode] = []

    def walk(nodes: list[Any]) -> None:
        for n in nodes:
            if isinstance(n, _HtmlNode) and not isinstance(n, _BlocksNode):
                seen.append(n)
                walk(n.children)

    walk(builder.root.children)
    for n in seen:
        # A member's raw connector-private href never mints a chip: its text stays, unlinked.
        if n.tag == "a" and (n.attrs.get("href") or "").strip().startswith(ATTACHMENT_REF_PREFIX):
            n.tag = "span"
    return _html_blocks_walk(_unwrap_unknown_html(builder.root.children), ctx), k


#: Elements a region's markdown blocks may stand in (D3 fix round 1, C1): the root, the
#: region elements, the block wrappers and the containers whose content is blocks.
_REGION_BLOCK_CONTAINERS = frozenset({
    "root", "html", "body", "details", "aside", "summary", "li", "td", "th", "blockquote",
    "ul", "ol", "table", "tr",
})  # and every `_HTML_BLOCK_WRAPPERS` tag (defined below; read at call time)
#: Elements a block start closes, as the browser's tree builder closes an open `<p>` (a
#: `<pre>` or heading cannot hold a paragraph either: the client's parse splits it there).
_REGION_CLOSED_BY_A_BLOCK = frozenset({"p", "pre", "h1", "h2", "h3", "h4", "h5", "h6"})


def _place_region_blocks(
    builder: "_HtmlDomBuilder", tokens: list[Token], start: int, end: int, ctx: _Ctx,
) -> None:
    """D3 fix round 1 (C1): convert the markdown blocks `tokens[start:end]` and put them where
    the client's parse puts them.

    ⚰️ They were appended to whatever element was open, and an inline or leaf element's walker
    (`<p>`, `<a>`, `<b>`, `<pre>`) dropped them, images and links included, while the images
    stayed registered as media. Now, as the browser's tree builder does at a block start:
      * an open `<p>`, `<pre>` or heading is CLOSED (it keeps what it already held);
      * open inline elements (`<a>`, `<b>`, `<span>`...) wrap the blocks: every run starts
        inside their marks (a link only through the one allow-list, `ctx.inherited`), a raw
        close tag in the blocks ends one (`</a>` in `after</a> tail`), and the ones still open
        are re-opened after the blocks (the "reconstruct the active formatting elements"
        step), so later text stays inside them, in document order;
      * the blocks stand in the nearest element that holds blocks (`_REGION_BLOCK_CONTAINERS`)."""
    stack = builder._stack
    while len(stack) > 1 and stack[-1].tag in _REGION_CLOSED_BY_A_BLOCK:
        stack.pop()
    at = len(stack) - 1
    while at > 0 and stack[at].tag not in _REGION_BLOCK_CONTAINERS \
            and stack[at].tag not in _HTML_BLOCK_WRAPPERS:
        at -= 1
    inline = stack[at + 1:]
    del stack[at + 1:]
    entries = [[el.tag, _inline_element_mark(el, ctx), el] for el in inline]
    saved, ctx.inherited = ctx.inherited, list(entries)
    try:
        blocks = _blocks(tokens, start, end, ctx)
        still_open = {id(e[2]) for e in ctx.inherited}
    finally:
        ctx.inherited = saved
    stack[at].children.append(_BlocksNode(blocks))
    parent = stack[at]
    for el in inline:  # re-open the inline elements the blocks did not close
        if id(el) not in still_open:
            continue
        clone = _HtmlNode(el.tag, dict(el.attrs))
        parent.children.append(clone)
        stack.append(clone)
        parent = clone


def _inline_element_mark(el: "_HtmlNode", ctx: _Ctx) -> dict[str, Any] | None:
    """The mark an open inline element puts on the text inside it, as `_html_inline_walk`."""
    if el.tag in _HTML_INLINE_MARK_TAGS:
        return {"type": _HTML_INLINE_MARK_TAGS[el.tag]}
    if el.tag == "a":
        raw = (el.attrs.get("href") or "").strip()
        href = _link_href(_destination_as_written(raw), ctx)
        if raw and _is_allowed_link_href(href) and not href.startswith(ATTACHMENT_REF_PREFIX):
            return {"type": "link", "attrs": {"href": href}}
    return None


#: Tag syntax: an element, a closing tag, a comment or declaration, or a processing
#: instruction. A block with none is text and is kept as written.
_HTML_TAG_SYNTAX_RE = re.compile(r"<[A-Za-z/!?]")


def _inline_nodes(
    children: list[Token], ctx: _Ctx, lstrip_first: bool = False,
) -> list[dict[str, Any]]:
    """Walks one paragraph/heading/cell's inline children into a flat list
    of TipTap inline items (text runs with composed marks, `hardBreak`,
    `image`). A `marks` stack tracks currently-open emphasis/strong/strike/
    link spans so nested marks (e.g. bold text inside a link) compose onto
    the same text node, mirroring what the real editor's schema produces."""
    items: list[dict[str, Any]] = []
    marks: list[dict[str, Any]] = []
    # One entry per open raw `<a>`, and one per open markdown link: `[first item index, href]`
    # when it pushed a link mark, else None (`media_link_label` reads the frame at the close).
    raw_links: list[list[Any] | None] = []
    md_links: list[list[Any] | None] = []
    atom_alts: dict[int, str] = {}  # an image's (or its notice's) alt text, by node id

    def media_link_label(frame: list[Any]) -> None:
        """D3 fix round 2 ruling (a link must survive): a link that wrapped only media (an
        image is a block node, so the link mark has no text to sit on) becomes a link right
        after it, reading the first non-blank alt, else the href. Pushed while the link mark
        is still open, so it carries the same allow-listed href. The client's
        `mediaRefs.liftMediaOutOfLinks` writes the same (`media_link_vectors`)."""
        start, href = frame
        tail = items[start:]
        if any(i.get("type") == "text" and i.get("text", "").strip() for i in tail):
            return  # the link has words of its own (whitespace is not words, as on the client)
        atoms = [i for i in tail if i.get("type") in _HOISTABLE_BLOCK_TYPES]
        if not atoms:
            return
        alt = next((atom_alts.get(id(a), "").strip() for a in atoms
                    if atom_alts.get(id(a), "").strip()), "")
        push_text(alt or href)
    # Open raw inline tags: [name, mark type pushed or None, the `ctx.inherited` entry or None].
    open_tags: list[list[Any]] = []
    any_open: dict[str, int] = {}  # M3: open tags per name, so a stray close is O(1)
    flat_open: dict[str, int] = {}  # M3: tags kept flat past `_INLINE_MAX_OPEN`, per name
    for entry in list(ctx.inherited):  # C1: elements an HTML region holds open around us
        if entry[1] is not None:
            marks.append(dict(entry[1]))
        open_tags.append([entry[0], entry[1]["type"] if entry[1] else None, entry])
        any_open[entry[0]] = any_open.get(entry[0], 0) + 1

    def close_open_tag(k: int) -> None:
        any_open[open_tags[k][0]] = any_open.get(open_tags[k][0], 1) - 1
        if open_tags[k][1] is not None:
            _pop_mark(marks, open_tags[k][1])
        if open_tags[k][2] is not None and open_tags[k][2] in ctx.inherited:
            ctx.inherited.remove(open_tags[k][2])  # closed here: not re-opened after us
        del open_tags[k]

    skip = 0  # inside a raw `<script>`/`<style>`: its content is dropped, as the client does
    eat_space = False  # a raw tag just rendered as nothing, or a raw `<br>`: see push_text

    def push_text(text: str, extra: list[dict[str, Any]] | None = None) -> None:
        nonlocal eat_space
        if eat_space and text:
            # D3 follow-up (difference 3): where a raw tag rendered as nothing (or a raw
            # `<br>` broke the line), the whitespace either side is ONE space, or none after
            # the break, as the client's HTML parse collapses it.
            prev = items[-1] if items else None
            after_break = prev is not None and prev.get("type") == "hardBreak"
            after_space = (prev is not None and prev.get("type") == "text"
                           and prev["text"][-1:] in _HTML_SPACE_CHARS)
            if after_break or after_space:
                text = text.lstrip(_HTML_SPACE_CHARS)
            eat_space = False
        if text == "":
            return
        node: dict[str, Any] = {"type": "text", "text": text}
        # D3 item 2: only a mark set the editor's schema accepts (`marks.exclusive_marks`).
        run_marks = exclusive_marks(marks + (extra or []))
        if run_marks:
            node["marks"] = [dict(m) for m in run_marks]
        if (
            items
            and items[-1].get("type") == "text"
            and items[-1].get("marks", []) == node.get("marks", [])
        ):
            items[-1]["text"] += text
        else:
            items.append(node)

    for idx, child in enumerate(children):
        if skip and child.type != "html_inline":
            continue  # inside a raw <script>/<style>
        if child.type == "text":
            content = child.content or ""
            if lstrip_first and idx == 0:
                content = content.lstrip()
            push_text(content)

        elif child.type == "softbreak":
            # Default (non-`breaks`) markdown-it rendering collapses a soft
            # line break to a single space — mirror that rather than
            # inventing a node type outside the TipTap vocabulary.
            push_text(" ")

        elif child.type == "hardbreak":
            items.append({"type": "hardBreak"})

        elif child.type == "code_inline":
            push_text(child.content or "", [{"type": "code"}])

        elif child.type == "em_open":
            marks.append({"type": "italic"})
        elif child.type == "em_close":
            _pop_mark(marks, "italic")

        elif child.type == "strong_open":
            marks.append({"type": "bold"})
        elif child.type == "strong_close":
            _pop_mark(marks, "bold")

        elif child.type == "s_open":
            marks.append({"type": "strike"})
        elif child.type == "s_close":
            _pop_mark(marks, "strike")

        elif child.type == "link_open":
            href = _link_href(_destination_as_written(child.attrs.get("href") or ""), ctx)
            md_links.append(None)
            if _is_allowed_link_href(href):
                if href.startswith(LINK_PREFIX):
                    ctx.links.append(href[len(LINK_PREFIX):])
                marks.append({"type": "link", "attrs": {"href": href}})
                md_links[-1] = [len(items), href]
            # else: disallowed scheme -> no mark pushed. `link_close` below
            # is then a safe no-op (nothing matching 'link' on the stack),
            # so the text run itself still comes through, unmarked —
            # mirroring the real editor's parseHTML rejecting the `<a>` while
            # its text content still parses.
        elif child.type == "link_close":
            frame = md_links.pop() if md_links else None
            if frame is not None:
                media_link_label(frame)
            _pop_mark(marks, "link")

        elif child.type == "image":
            node = _image_node(child, ctx)
            if node is None:
                push_text("[unsupported image]")
            else:
                atom_alts[id(node)] = child.content or ""
                items.append(node)

        elif child.type == "html_inline":
            # An injected task-checkbox token is stripped by the caller
            # before we ever see it. `<mark>`/`</mark>` is the ONE inline tag
            # with a home in the vocabulary: the `highlight` mark (wave 5's
            # NotebookHighlight), which is how an Obsidian `==x==` arrives
            # (providers/obsidian.py) -- the same mark the file importer's
            # generateJSON gives `<mark>`. Any OTHER raw inline HTML degrades
            # to visible literal text rather than silently dropping content.
            # Plan A Task 13 (§5.2 polish): a raw `<img>` and a raw `<a href>`…`</a>`
            # pair have homes too, the image node and the link mark, through the HTML
            # walker's own rules (`_html_image_node`, `_link_href`, the one allow-list).
            # D3 follow-up (difference 3): EVERY other inline tag renders as the client's
            # parse renders it (`_inline_html_tag` below), never as literal tag text.
            raw = _raw_inline_tag(child.content or "")
            eat_space = raw is None or raw.tag != "img"
            if skip:
                if _INLINE_TAG_RE.match((child.content or "").strip()) is not None:
                    _close, _name, _ = _INLINE_TAG_RE.match((child.content or "").strip()).groups()
                    if _close and _name.lower() in _INLINE_SKIPPED_TAGS:
                        skip -= 1
                continue
            if raw is not None and raw.tag == "img":
                node = _html_image_node(raw, ctx)
                if node is None:
                    push_text("[unsupported image]")
                else:
                    atom_alts[id(node)] = raw.attrs.get("alt") or ""
                    items.append(node)
            elif raw is not None and raw.tag == "a":
                href = _link_href(_destination_as_written((raw.attrs.get("href") or "").strip()), ctx)
                # An `<a>` with no href is no link (the editor's rule is `a[href]`).
                opened = (bool((raw.attrs.get("href") or "").strip()) and _is_allowed_link_href(href)
                          and not href.startswith(ATTACHMENT_REF_PREFIX))
                if opened:
                    if href.startswith(LINK_PREFIX):
                        ctx.links.append(href[len(LINK_PREFIX):])
                    marks.append({"type": "link", "attrs": {"href": href}})
                raw_links.append([len(items), href] if opened else None)
            elif _CLOSE_A_RE.match((child.content or "").strip()):
                # Only a `</a>` closing a RAW `<a>` pops: a stray one never strips the
                # mark of a markdown link it happens to sit inside.
                if raw_links:
                    frame = raw_links.pop()
                    if frame is not None:
                        media_link_label(frame)
                        _pop_mark(marks, "link")
                else:
                    # C1: the `<a>` an HTML region holds open around this paragraph.
                    for k in range(len(open_tags) - 1, -1, -1):
                        if open_tags[k][0] == "a" and open_tags[k][2] is not None:
                            close_open_tag(k)
                            break
            else:
                m = _INLINE_TAG_RE.match((child.content or "").strip())
                if m is None:
                    continue  # a comment, declaration or processing instruction: nothing
                close, name, _self = m.groups()
                name = name.lower()
                mark = _INLINE_MARK_TAGS.get(name)
                if name in _INLINE_SKIPPED_TAGS:
                    skip += 0 if close else 1
                elif name == "br" and not close:
                    items.append({"type": "hardBreak"})
                elif close:
                    # The most recent open tag of that name closes; a stray close is nothing.
                    # M3: a close of a tag kept flat past the cap, or of a name with none open,
                    # is O(1).
                    if flat_open.get(name):
                        flat_open[name] -= 1
                    elif any_open.get(name):
                        for k in range(len(open_tags) - 1, -1, -1):
                            if open_tags[k][0] == name:
                                close_open_tag(k)
                                break
                elif not _self:
                    if len(open_tags) >= _INLINE_MAX_OPEN:
                        # D3 review M3: past the cap a tag is unwrapped (its text kept, no new
                        # mark), as an HTML parser caps its formatting elements, so each run's
                        # mark set stays bounded and the walk linear.
                        flat_open[name] = flat_open.get(name, 0) + 1
                    else:
                        if mark is not None:
                            marks.append({"type": mark})
                        open_tags.append([name, mark, None])
                        any_open[name] = any_open.get(name, 0) + 1
                # Any other tag (`<span>`, `<sub>`, `<kbd>`...) unwraps: its text stays.

        else:
            # Unknown inline construct -> degrade to its literal text
            # content (if any) rather than crash or vanish.
            content = getattr(child, "content", None)
            if content:
                push_text(content)

    return items


# ---------------------------------------------------------------------------
# html_to_tiptap — HTML -> TipTap JSON (the Dropbox connector's `.html` path)
# ---------------------------------------------------------------------------
#
# Added for the Dropbox folder-sync provider (task-10 brief): a note authored
# as an exported/synced `.html` file has no browser/DOM available server-side
# (background sync job, same constraint `md_to_tiptap` above solves for
# markdown) and no markdown-it token stream to walk either. This is a SECOND,
# independent walker over a bounded `html.parser.HTMLParser`-built tree,
# deliberately reusing `_Ctx`/`_register_media`/`_data_uri_image_node`/
# `_basename`/`_is_allowed_link_href`/`_wrap_paragraph` from above so the two
# converters can never drift on the placeholder conventions or link policy —
# only ONE `_is_allowed_link_href` exists in this file, and both converters
# call it.
#
# `html.parser.HTMLParser` is a pure tokenizer (no DOM, no CSS, no script
# execution of any kind) — safe to run over untrusted synced content. Output
# stays inside the EXACT SAME node/mark vocabulary declared at the top of
# this file; anything encountered outside it degrades to nothing (unknown
# tags) or to visible literal text (unsupported images), never a foreign
# TipTap node type.
#
# Explicit, documented scope decisions (the brief names the vocabulary but
# leaves these to the implementer):
#   - `<script>`/`<style>` are dropped ENTIRELY — tag AND all descendant
#     text/markup never reaches `handle_data` at all (tracked via
#     `_skip_depth`, not merely un-mapped).
#   - `<head>` is ALSO dropped entirely (not just "unknown, unwrap"), because
#     unwrapping it would splice a `<title>`'s text (and any stray
#     `<meta>`/`<link>` remnants) into the document as a stray leading
#     paragraph — a real, visible corruption a browser never shows a reader,
#     and the brief's vocabulary list implicitly assumes only BODY content
#     reaches it. `<html>`/`<body>` themselves are ordinary "unknown, unwrap"
#     (pure structural wrappers with no content of their own).
#   - Task lists: a raw `<input type="checkbox">` inside `<li>` is still NOT
#     recognized (an unknown/void tag that simply vanishes, sibling text
#     becomes a plain `listItem`) — no connector emits that shape. The ONE
#     additive exception (task-5 brief, note-connectors) is
#     `<li data-uct-task="0"|"1">`: a connector-supplied marker (OneNote's
#     to-do pre-pass, `convert/onenote_html.py`, was its only producer; it was
#     archived 2026-11-04, so today only fixture 07 feeds it) meaning "this
#     `<li>` is a checkbox item; `1` = checked". See
#     `_html_list_or_tasklist` below — INERT for every other caller (any
#     generic HTML never emits this attribute, so its
#     `_html_convert_list` output is byte-for-byte unchanged).


_HTML_KNOWN_TAGS = frozenset({
    "p", "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li",
    "table", "tr", "td", "th",
    "pre", "code",
    "blockquote", "hr", "br", "img", "a",
    "b", "strong", "i", "em", "s", "del", "strike",
    "u",  # Plan E Task 3 fix round 1 (m3): underline, a level-0 mark in notebook_schema
    "mark",
    # D3 follow-up (difference 2): the client's callout and toggle (`convert.js::
    # mapCalloutsAndToggles`); `_html_aside_callout` / `_html_details_toggle` below.
    "aside", "details", "summary",
})

# Tags whose content model never permits children (no close tag expected) —
# appended as a leaf, never pushed onto the open-element stack.
_HTML_VOID_TAGS = frozenset({"br", "hr", "img"})

#: D3 review M1: the most open elements the tree builder nests. The walkers recurse per level
#: (two or three frames for a `<details>`), so a hostile `"<div>" * 1600` raised RecursionError
#: and the note failed to import; past this depth a start tag is a sibling instead. A browser's
#: own parser caps nesting too (Chromium at 512); no real note comes near 100.
_HTML_MAX_DEPTH = 100

# Dropped ENTIRELY (tag + every descendant, text included) — see module note
# above. `head` is a deliberate addition beyond the brief's explicit
# script/style pair.
_HTML_DROPPED_TAGS = frozenset({"script", "style", "head"})

_HTML_INLINE_MARK_TAGS = {
    "b": "bold", "strong": "bold",
    "i": "italic", "em": "italic",
    "s": "strike", "del": "strike", "strike": "strike",
    "code": "code",
    # D3 follow-up (difference 3): the editor's underline and highlight marks, as its parse
    # and the markdown lane's inline tags (`_INLINE_MARK_TAGS`) read them.
    "u": "underline", "mark": "highlight",
}


class _HtmlNode:
    """One element in the bounded DOM-ish tree `_HtmlDomBuilder` builds.
    `children` holds a mix of `_HtmlNode` and plain `str` (text runs) —
    mirrors how markdown-it's inline `children` list mixes token types,
    which is exactly what `_inline_nodes` above already walks, so the shape
    is deliberately familiar."""

    __slots__ = ("tag", "attrs", "children")

    def __init__(self, tag: str, attrs: dict[str, str | None]) -> None:
        self.tag = tag
        self.attrs = attrs
        self.children: list[Any] = []


class _BlocksNode(_HtmlNode):
    """Converted markdown blocks standing inside an HTML region (`_html_region`)."""

    __slots__ = ("blocks",)

    def __init__(self, blocks: list[dict[str, Any]]) -> None:
        super().__init__("x-uct-blocks", {})
        self.blocks = blocks


class _HtmlDomBuilder(HTMLParser):
    """SAX-style `html.parser.HTMLParser` callbacks -> a small in-memory
    tree. Tolerant of unbalanced/malformed markup: an unmatched close tag is
    ignored (not desynced against the stack); an unclosed open tag at EOF
    simply contains everything that followed it as descendants rather than
    raising. `convert_charrefs=True` means `handle_data` already receives
    entities (`&amp;`, `&#39;`, ...) decoded — no manual unescaping needed."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = _HtmlNode("root", {})
        self._stack: list[_HtmlNode] = [self.root]
        self._skip_depth = 0
        # D3 fix round 2 (N1): past `_HTML_MAX_DEPTH` the parse goes FLAT (`_flat_*` below):
        # no deeper tree, but every word, link and image is kept, in paragraphs of a box the
        # walkers render. `_flat` is None outside that mode, else the flat-open elements as
        # `[tag, attrs, is_inline]`, outermost first.
        self._flat: list[list[Any]] | None = None
        self._flat_box: _HtmlNode | None = None
        self._flat_para: _HtmlNode | None = None
        self._flat_target: _HtmlNode | None = None  # N2: the inline element written in place
        self._flat_marks: dict[str, int] = {}  # open inline tags per name, flat or seeded
        self._flat_links: list[dict[str, str | None]] = []  # open anchors' attrs, innermost last

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in _HTML_DROPPED_TAGS:
            self._skip_depth += 1
            return
        if self._skip_depth:
            return
        attrs_d = {k.lower(): v for k, v in attrs}
        if self._flat is None and tag not in _HTML_VOID_TAGS and len(self._stack) > _HTML_MAX_DEPTH:
            self._enter_flat()
        if self._flat is not None:
            self._flat_start(tag, attrs_d)
            return
        node = _HtmlNode(tag, attrs_d)
        self._stack[-1].children.append(node)
        if tag in _HTML_VOID_TAGS:
            return
        self._stack.append(node)

    # ── the flat mode past the depth cap (D3 fix round 2, N1) ──────────────────────────────

    def _enter_flat(self) -> None:
        """Too deep: open a BOX in the nearest element the walkers render as blocks (never a
        table, row or list, whose walkers skip loose children), seeded with the inline elements
        open above that element, so the text that follows keeps their marks and links."""
        self._flat, self._flat_para = [], None
        self._flat_marks, self._flat_links = {}, []
        top = self._stack[-1]
        if top.tag not in _FLAT_STRUCTURAL and top.tag not in _FLAT_HOLDERS:
            # D3 fix round 3 (N2): the cap landed INSIDE a paragraph, heading or inline element.
            # The flat runs go into that element itself, in place, so a word written after the
            # deep run (back in the element) still follows it. ⚰️ They went into a box in the
            # holder below, after the whole element: `A <b>B <i>C</i> D</b> E` read `A E` + `B C D`.
            # The element is a real ancestor of the runs, so nothing is seeded from it.
            self._flat_box = None
            self._flat_target = top
            return
        self._flat_target = None
        at = len(self._stack) - 1
        while at > 0 and self._stack[at].tag not in _FLAT_HOLDERS:
            at -= 1
        self._flat_box = _HtmlNode("div", {})
        self._stack[at].children.append(self._flat_box)
        for el in self._stack[at + 1:]:
            if el.tag not in _FLAT_BREAK_TAGS:
                self._flat_push_inline(el.tag, el.attrs)

    def _flat_push_inline(self, tag: str, attrs: dict[str, str | None]) -> None:
        if tag not in _FLAT_CHAINED:
            # D3 fix round 4 (N4): any other inline tag unwraps in the walker, so it adds
            # nothing to the chain. ⚰️ Every distinct NAME was counted, custom tags included:
            # `<x0><x1>…` built a chain as deep as the name count (1,000 names raised
            # RecursionError; 3,000 with words took 11.5 s, every leaf building it whole).
            return
        self._flat_marks[tag] = self._flat_marks.get(tag, 0) + 1
        if tag == "a":
            self._flat_links.append(attrs)

    def _flat_paragraph(self) -> _HtmlNode:
        if self._flat_target is not None:
            return self._flat_target  # in place (N2): a block boundary there splits nothing
        if self._flat_para is None:
            self._flat_para = _HtmlNode("p", {})
            self._flat_box.children.append(self._flat_para)
        return self._flat_para

    def _flat_chain(self, leaf: Any) -> Any:
        """`leaf` inside ONE element per open mark tag NAME and the innermost anchor (at most
        `len(_FLAT_CHAINED)` levels, never the nesting depth or the count of distinct names)."""
        node = leaf
        for name in sorted(n for n, c in self._flat_marks.items() if c > 0 and n != "a"):
            wrap = _HtmlNode(name, {})
            wrap.children = [node]
            node = wrap
        if self._flat_marks.get("a") and self._flat_links:
            wrap = _HtmlNode("a", dict(self._flat_links[-1]))
            wrap.children = [node]
            node = wrap
        return node

    def _flat_start(self, tag: str, attrs: dict[str, str | None]) -> None:
        if tag == "img":
            self._flat_paragraph().children.append(self._flat_chain(_HtmlNode("img", attrs)))
            return
        if tag == "br":
            self._flat_paragraph().children.append(_HtmlNode("br", {}))
            return
        if tag in _HTML_VOID_TAGS or tag in _FLAT_BREAK_TAGS:
            self._flat_para = None  # a block boundary: the next words start a new paragraph
            if tag in _HTML_VOID_TAGS:
                return
            self._flat.append([tag, attrs, False])
            return
        self._flat.append([tag, attrs, True])
        self._flat_push_inline(tag, attrs)

    def _flat_end(self, tag: str) -> bool:
        """True when a flat element closed; False when `tag` closes no flat element (it may
        close one of the real tree's, so the flat mode ends)."""
        for i in range(len(self._flat) - 1, -1, -1):
            if self._flat[i][0] == tag:
                for closed in self._flat[i:]:
                    if closed[2]:
                        if closed[0] in _FLAT_CHAINED:  # N4: only these were counted
                            self._flat_marks[closed[0]] -= 1
                        if closed[0] == "a" and self._flat_links:
                            self._flat_links.pop()
                    else:
                        self._flat_para = None
                del self._flat[i:]
                if not self._flat:
                    self._flat = None  # back at the cap: the next start tag opens a new box
                return True
        self._flat = None
        return False

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in _HTML_DROPPED_TAGS:
            if self._skip_depth:
                self._skip_depth -= 1
            return
        if self._skip_depth or tag in _HTML_VOID_TAGS:
            return
        if self._flat is not None and self._flat_end(tag):
            return
        for i in range(len(self._stack) - 1, 0, -1):
            if self._stack[i].tag == tag:
                del self._stack[i:]
                return
        if tag == "p":
            # D3 fix round 1 (C1): a `</p>` with no open `<p>` is an EMPTY paragraph, as the
            # HTML parser (and so the client's parse) writes it.
            self._stack[-1].children.append(_HtmlNode("p", {}))
        # Any other stray close tag with no matching open -> ignore (malformed HTML).

    def handle_data(self, data: str) -> None:
        if self._skip_depth or not data:
            return
        if self._flat is not None:
            if data.strip() or self._flat_para is not None:
                self._flat_paragraph().children.append(self._flat_chain(data))
            return
        self._stack[-1].children.append(data)


#: D3 item 7: the block-level tags outside the vocabulary, from the editor parser's own list
#: (prosemirror-model `blockTags`, minus the tags this walker already knows and `tfoot`, a
#: table part). Each is a BLOCK BOUNDARY, as in the client's parse: `<div>a</div><div>b</div>`
#: is two paragraphs. ⚰️ They were unwrapped like a `<span>`, so Dropbox and OneNote HTML
#: joined every div's line into one paragraph (`ab`).
_HTML_BLOCK_WRAPPERS = frozenset({
    "address", "article", "canvas", "dd", "div", "dl", "fieldset", "figcaption",
    "figure", "footer", "form", "header", "hgroup", "noscript", "output", "section",
})
#: Parents whose children are items or rows, never blocks: a wrapper there still unwraps.
_HTML_ITEM_PARENTS = frozenset({"ul", "ol", "table", "tr"})
#: D3 fix round 2 (N1): where the flat box past the depth cap may stand: elements whose
#: children the walkers render as blocks (never a table, a row or a list).
_FLAT_HOLDERS = frozenset({"root", "html", "body", "td", "th", "li", "blockquote", "details",
                           "aside", *_HTML_BLOCK_WRAPPERS})
#: Elements whose walkers skip loose children (rows, items): the flat runs never go in one.
_FLAT_STRUCTURAL = frozenset({"table", "thead", "tbody", "tfoot", "tr", "ul", "ol", "dl"})
#: D3 fix round 4 (N4): the only inline tags the flat chain wraps a leaf in: the ones that
#: carry something (a mark, or a link). Every other inline tag unwraps in `_html_inline_walk`.
_FLAT_CHAINED = frozenset({*_HTML_INLINE_MARK_TAGS, "a"})
#: Tags that end a paragraph in the flat mode (block elements); any other tag is inline.
_FLAT_BREAK_TAGS = frozenset({
    "p", "li", "td", "th", "tr", "table", "thead", "tbody", "tfoot", "ul", "ol", "dl", "dt",
    "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "details", "summary", "aside",
    "hr", *_HTML_BLOCK_WRAPPERS,
})


def _unwrap_unknown_html(nodes: list[Any], parent: str = "root") -> list[Any]:
    """Splices any tag NOT in `_HTML_KNOWN_TAGS` (e.g. `span`/`html`/`body`) out of the tree,
    recursively, replacing it in place with its own (already-unwrapped) children — "unknown
    tags unwrap to children" per the brief, applied bottom-up in one pass so a chain of
    nested unknowns (`<span><b>x</b></span>`) fully flattens. A block wrapper
    (`_HTML_BLOCK_WRAPPERS`, D3 item 7) becomes a bare `div`, which `_html_blocks_walk`
    reads as a block boundary; inside a list or a table row it still unwraps."""
    out: list[Any] = []
    for n in nodes:
        if isinstance(n, (str, _BlocksNode)):
            out.append(n)
            continue
        if n.tag in _HTML_KNOWN_TAGS:
            n.children = _unwrap_unknown_html(n.children, n.tag)
            out.append(n)
        elif n.tag in _HTML_BLOCK_WRAPPERS and parent not in _HTML_ITEM_PARENTS:
            block = _HtmlNode("div", {})
            block.children = _unwrap_unknown_html(n.children, "div")
            out.append(block)
        else:
            out.extend(_unwrap_unknown_html(n.children, parent))
    return out


def _html_image_node(node: "_HtmlNode", ctx: _Ctx) -> dict[str, Any] | None:
    src = (node.attrs.get("src") or "").strip()
    if not src:
        return None
    if src.startswith(REF_PREFIX):
        return {"type": "image", "attrs": {"src": src}}
    if src.startswith("data:"):
        return _data_uri_image_node(src, ctx)
    if _is_unsafe_image_src(src) or _is_unsafe_image_src(link_href_as_read(src)):
        # D3 follow-up: a raw HTML block now renders whatever tags it holds, so the HTML
        # walker refuses an unsafe src (`javascript:`, `vbscript:`, `file:`) as the markdown
        # image does (`_image_node`): never a media entry; a notice on the connector path,
        # else the caller's visible marker.
        if not ctx.unsafe_image_notice:
            return None
        return import_notice.notice_node(
            "unsafe", name=node.attrs.get("alt") or None, source_url=None, ref=None, attempts=0)
    _register_media(ctx, ref=src, kind="image", name=_basename(src))
    return {"type": "image", "attrs": {"src": f"{REF_PREFIX}{src}"}}


_HTML_WHITESPACE_RE = re.compile(r"[ \t\r\n\f]+")


def _html_inline_walk(
    nodes: list[Any], ctx: _Ctx, marks: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Inline-context walk (text runs + composed marks + hardBreak + image),
    mirroring `_inline_nodes`'s text-merge/marks-stack shape above. A block
    tag (p/h1-6/ul/ol/table/pre/blockquote/hr) reached HERE means one was
    nested inside inline markup in the source (e.g. malformed `<b><p>x</p>
    </b>`) — TipTap marks cannot wrap a block node, so it degrades to
    walking that tag's OWN children inline (dropping just its block-ness,
    never the content)."""
    marks = list(marks or [])
    items: list[dict[str, Any]] = []

    def push_text(text: str) -> None:
        if text == "":
            return
        node: dict[str, Any] = {"type": "text", "text": text}
        run_marks = exclusive_marks(marks)  # D3 item 2, as `_inline_nodes`
        if run_marks:
            node["marks"] = [dict(m) for m in run_marks]
        if (
            items
            and items[-1].get("type") == "text"
            and items[-1].get("marks", []) == node.get("marks", [])
        ):
            items[-1]["text"] += text
        else:
            items.append(node)

    for n in nodes:
        if isinstance(n, _BlocksNode):
            # C1: `_place_region_blocks` never puts blocks under an inline element, so this is
            # unreachable; if it ever is, nothing vanishes: every text run and block atom in
            # the blocks comes inline (an atom is hoisted by the caller's `_wrap_paragraph`).
            items.extend(_blocks_inline(n.blocks))
            continue
        if isinstance(n, str):
            # A bounded, simple whitespace collapse (any run of HTML
            # whitespace -> one space) — not the full HTML5 whitespace
            # algorithm, but sufficient for note content exported from
            # ordinary apps, and avoids literal source-formatting newlines
            # leaking into the rendered text.
            push_text(_HTML_WHITESPACE_RE.sub(" ", n))
            continue

        tag = n.tag
        if tag in _HTML_INLINE_MARK_TAGS:
            child_marks = marks + [{"type": _HTML_INLINE_MARK_TAGS[tag]}]
            items.extend(_html_inline_walk(n.children, ctx, child_marks))
        elif tag == "a":
            href = _link_href(_destination_as_written((n.attrs.get("href") or "").strip()), ctx)
            if href.startswith(ATTACHMENT_REF_PREFIX):
                # A connector (Dropbox's `_resolve_relative_attachments_html`)
                # already resolved this `<a href>` to a co-located FILE
                # attachment — mirrors `_html_image_node`'s `REF_PREFIX`-on-
                # `src` "already a connector-supplied placeholder" rule, one
                # level up (a whole separate prefix, not `REF_PREFIX` itself,
                # since this signal lives on `<a href>` — a normal LINK
                # target — not an image `src`, and the two must never be
                # ambiguous). `attachmentChip` is a BLOCK-level atom (its
                # installed TipTap node: `group: 'block'`), hoisted out of
                # this paragraph/heading exactly like `image` already is —
                # see `_wrap_paragraph`'s widened `_HOISTABLE_BLOCK_TYPES`.
                ref = href[len(ATTACHMENT_REF_PREFIX):]
                name = _basename(ref)
                _register_media(ctx, ref=ref, kind="file", name=name)
                items.append({
                    "type": "attachmentChip",
                    "attrs": {"href": f"{REF_PREFIX}{ref}", "name": name},
                })
            elif _is_allowed_link_href(href):
                if href.startswith(LINK_PREFIX):
                    ctx.links.append(href[len(LINK_PREFIX):])
                link_marks = marks + [{"type": "link", "attrs": {"href": href}}]
                sub = _html_inline_walk(n.children, ctx, link_marks)
                # D3 fix round 2 ruling: a link wrapping only media survives right after it
                # (`_inline_nodes.media_link_label`, the same rule for the markdown lane).
                if href and any(x.get("type") in _HOISTABLE_BLOCK_TYPES for x in sub) and not any(
                        x.get("type") == "text" and x.get("text", "").strip() for x in sub):
                    alt = next(((img.attrs.get("alt") or "").strip() for img in _html_descendants(n, "img")
                                if (img.attrs.get("alt") or "").strip()), "")
                    label: dict[str, Any] = {"type": "text", "text": alt or href}
                    run_marks = exclusive_marks(link_marks)
                    if run_marks:
                        label["marks"] = [dict(m) for m in run_marks]
                    sub.append(label)
                items.extend(sub)
            else:
                items.extend(_html_inline_walk(n.children, ctx, marks))
        elif tag == "br":
            items.append({"type": "hardBreak"})
        elif tag == "img":
            node_out = _html_image_node(n, ctx)
            if node_out is None:
                push_text("[unsupported image]")
            else:
                items.append(node_out)
        else:
            # A block tag landed in inline position -> degrade per the
            # docstring above: walk ITS children inline, dropping only its
            # block-ness.
            items.extend(_html_inline_walk(n.children, ctx, marks))

    return _merge_text_runs(items)


def _mark_key(node: dict[str, Any]) -> list[tuple[str, str]]:
    return sorted((m.get("type") or "", repr(sorted((m.get("attrs") or {}).items())))
                  for m in node.get("marks") or [])


def _merge_text_runs(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Adjacent text runs with the same mark set become one run, as the editor's parser joins
    them (D3 item 2: `<a>a <code>b</code> c</a>` is ONE link run once the code mark goes,
    though each nested element was walked on its own)."""
    out: list[dict[str, Any]] = []
    for item in items:
        prev = out[-1] if out else None
        if (prev is not None and item.get("type") == "text" and prev.get("type") == "text"
                and _mark_key(prev) == _mark_key(item)):
            out[-1] = {**prev, "text": prev["text"] + item["text"]}
        else:
            out.append(item)
    return out


def _html_convert_pre(node: "_HtmlNode") -> dict[str, Any]:
    """`<pre>` (optionally wrapping `<code class="language-x">`) -> TipTap
    `codeBlock`. Content is extracted VERBATIM (whitespace-preserving,
    entity-decoded by the parser, formatting/marks discarded) — never routed
    through `_html_inline_walk`, which would collapse whitespace and could
    apply marks that have no meaning inside a code block."""
    code_node: _HtmlNode | None = None
    for c in node.children:
        if not isinstance(c, str) and c.tag == "code":
            code_node = c
            break
    source = code_node if code_node is not None else node
    language = None
    if code_node is not None:
        for token in (code_node.attrs.get("class") or "").split():
            if token.startswith("language-"):
                language = token[len("language-"):]
                break
    text = _code_without_line_end(_html_literal_text(source.children))
    content = [{"type": "text", "text": text}] if text else []
    return {"type": "codeBlock", "attrs": {"language": language}, "content": content}


def _html_descendants(node: "_HtmlNode", tag: str) -> list["_HtmlNode"]:
    """Every `tag` element under `node`, in document order (iterative: no recursion)."""
    out: list[_HtmlNode] = []
    todo = list(reversed(node.children))
    while todo:
        n = todo.pop()
        if isinstance(n, _HtmlNode):
            if n.tag == tag:
                out.append(n)
            todo.extend(reversed(n.children))
    return out


def _blocks_inline(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Every text run, hard break and block atom in `blocks`, in order (C1's fallback)."""
    out: list[dict[str, Any]] = []

    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        if node.get("type") in ("text", "hardBreak") or node.get("type") in _HOISTABLE_BLOCK_TYPES:
            out.append(node)
            return
        for child in node.get("content") or []:
            walk(child)

    for b in blocks:
        walk(b)
    return out


def _html_literal_text(nodes: list[Any]) -> str:
    out: list[str] = []
    for n in nodes:
        if isinstance(n, str):
            out.append(n)
        elif isinstance(n, _BlocksNode):
            # C1: unreachable (a block start closes a `<pre>`); if reached, the text stays.
            out.append("".join(t.get("text", "") for t in _blocks_inline(n.blocks)))
        else:
            if n.tag == "br":
                out.append("\n")
            out.append(_html_literal_text(n.children))
    return "".join(out)


def _html_convert_list(node: "_HtmlNode", ctx: _Ctx, *, ordered: bool) -> dict[str, Any]:
    """`<ul>`/`<ol>` -> `bulletList`/`orderedList`. Only direct `<li>`
    children become items (TipTap's content model is `listItem+`); any other
    stray child is dropped. Raw HTML `<ul>`/`<ol>` markup can't normally mix
    task-list and plain items (no checkbox syntax in this vocabulary — see
    the module note above), so — unlike `md_to_tiptap`'s `_list_runs` — a
    single list node is always correct here, no run-splitting needed. Called
    ONLY when `_html_list_or_tasklist` (below) has already determined none of
    this list's `<li>` children carry the `data-uct-task` marker; this
    function itself has NO knowledge of that attribute, which is exactly
    what keeps it byte-for-byte unchanged for every marker-free caller."""
    items: list[dict[str, Any]] = []
    for child in node.children:
        if isinstance(child, str) or child.tag != "li":
            continue
        content = _html_blocks_walk(child.children, ctx)
        if not content:
            content = [{"type": "paragraph", "content": []}]
        items.append({"type": "listItem", "content": content})
    if not items:
        items = [{"type": "listItem", "content": [{"type": "paragraph", "content": []}]}]
    result: dict[str, Any] = {
        "type": "orderedList" if ordered else "bulletList", "content": items,
    }
    if ordered:
        start_raw = node.attrs.get("start")
        try:
            result["attrs"] = {"start": int(start_raw)} if start_raw else {"start": 1}
        except (TypeError, ValueError):
            result["attrs"] = {"start": 1}
    return result


# `data-uct-task` values `_html_list_or_tasklist` treats as a checkbox marker
# — anything else (missing attr, or some other value) is not a task item.
_HTML_TASK_CHECKED_VALUES = {"0": False, "1": True}


def _html_has_task_marker(node: "_HtmlNode") -> bool:
    return any(
        not isinstance(child, str)
        and child.tag == "li"
        and child.attrs.get("data-uct-task") in _HTML_TASK_CHECKED_VALUES
        for child in node.children
    )


def _html_list_or_tasklist(
    node: "_HtmlNode", ctx: _Ctx, *, ordered: bool,
) -> list[dict[str, Any]]:
    """`<ul>`/`<ol>` -> one or more sibling list nodes. THE ONE ADDITIVE
    BRANCH (task-5 brief, note-connectors): inert for ordinary HTML — its
    only producer, `convert/onenote_html.py`'s to-do pre-pass, was archived
    2026-11-04 (fixture 07 still feeds it directly), so for every live
    caller `_html_has_task_marker` is false and this falls straight through
    to `_html_convert_list`'s original, UNCHANGED single-node behavior
    (byte-for-byte identical output for any generic HTML import).

    Only when at least one direct `<li>` child carries `data-uct-task="0"`/
    `"1"` does this split the list into RUNS of consecutive task/non-task
    items — mirroring `_list_runs`'s markdown-checkbox run-grouping above —
    because TipTap's schema requires `taskList` to hold only `taskItem+` and
    `bulletList`/`orderedList` to hold only `listItem+` (verified against the
    installed `@tiptap/extension-list` source, same citation `_list_runs`
    already carries): a `<ul>` mixing plain and to-do `<li>`s cannot become
    one node."""
    if not _html_has_task_marker(node):
        return [_html_convert_list(node, ctx, ordered=ordered)]

    parsed: list[dict[str, Any]] = []
    for child in node.children:
        if isinstance(child, str) or child.tag != "li":
            continue
        content = _html_blocks_walk(child.children, ctx)
        if not content:
            content = [{"type": "paragraph", "content": []}]
        checked = _HTML_TASK_CHECKED_VALUES.get(child.attrs.get("data-uct-task"))
        if checked is None:
            parsed.append({"task": False, "content": content})
        else:
            parsed.append({"task": True, "checked": checked, "content": content})
    if not parsed:
        parsed = [{"task": False, "content": [{"type": "paragraph", "content": []}]}]

    out: list[dict[str, Any]] = []
    # `consumed` = how many of the ORIGINAL `<ol>`'s `<li>` items preceding
    # runs have already accounted for — every item (task or plain) occupies
    # one ordinal slot in the source numbering, so a later orderedList run
    # must pick up numbering where the run(s) before it left off, not restart
    # at the `<ol>`'s own `start` attr every time. Fix (review round,
    # task-5): a to-do splitting `<ol start="5">` into
    # `[taskList(1 item), orderedList(1 item)]` must number that trailing
    # item 6, not 5 — a numbered OneNote list with an embedded checkbox item
    # otherwise renders visibly-wrong numbers. `<ul>` is unaffected: `consumed`
    # is only ever READ inside the `if ordered:` branch below.
    consumed = 0
    idx = 0
    while idx < len(parsed):
        is_task = parsed[idx]["task"]
        run: list[dict[str, Any]] = []
        while idx < len(parsed) and parsed[idx]["task"] == is_task:
            run.append(parsed[idx])
            idx += 1
        if is_task:
            items = [
                {"type": "taskItem", "attrs": {"checked": p["checked"]}, "content": p["content"]}
                for p in run
            ]
            out.append({"type": "taskList", "content": items})
        else:
            items = [{"type": "listItem", "content": p["content"]} for p in run]
            result: dict[str, Any] = {
                "type": "orderedList" if ordered else "bulletList", "content": items,
            }
            if ordered:
                start_raw = node.attrs.get("start")
                try:
                    base_start = int(start_raw) if start_raw else 1
                except (TypeError, ValueError):
                    base_start = 1
                result["attrs"] = {"start": base_start + consumed}
            out.append(result)
        consumed += len(run)
    return out


def _html_convert_table(node: "_HtmlNode", ctx: _Ctx) -> dict[str, Any] | None:
    """`<table>` -> TipTap `table`. `thead`/`tbody`/`tfoot` are not in the
    declared vocabulary, so `_unwrap_unknown_html` has already spliced them
    away by the time this runs — `table`'s direct children are always bare
    `tr` nodes regardless of whether the source wrapped them."""
    rows: list[dict[str, Any]] = []
    for tr in node.children:
        if isinstance(tr, str) or tr.tag != "tr":
            continue
        cells: list[dict[str, Any]] = []
        for cell in tr.children:
            if isinstance(cell, str) or cell.tag not in ("td", "th"):
                continue
            content = _html_blocks_walk(cell.children, ctx)
            if not content:
                content = [{"type": "paragraph", "content": []}]
            cell_type = "tableHeader" if cell.tag == "th" else "tableCell"
            cells.append({"type": cell_type, "content": content})
        if cells:  # a row with no cell is no row (the schema's `tableRow` needs a cell)
            rows.append({"type": "tableRow", "content": cells})
    # A table with no row is nothing (the schema's `table` needs a row). D3 fix round 2: past
    # the depth cap a table's rows go to the flat box beside it, leaving the table empty.
    return {"type": "table", "content": rows} if rows else None


# ── D3 follow-up (difference 2): `<aside>` and `<details>`, as the client maps them ───────────
#
# `convert.js::mapCalloutsAndToggles` turns Notion's classic export shapes into the editor's
# nodes before its parse: an `<aside>` is a `callout` (a leading emoji in its first text is
# the callout's `emoji`), a `<details>` is an open `toggle` of `toggleSummary` (its first
# `<summary>`, or an empty one) and `toggleContent` (everything after). The server writes the
# same nodes with the attrs the client's parse writes: `{emoji, variant: None}` and
# `{open: True}`. ⚰️ Both were unwrapped to plain paragraphs here.

#: `calloutNode.js`'s `emoji` default (`test_note_convert_d3.py` reads that file and pins it).
CALLOUT_DEFAULT_EMOJI = chr(0x1F4A1)
#: JavaScript's `\s` (what the client's `replace(/^\s+/, '')` strips), code point by code
#: point; built from numbers so this file holds none of them raw.
_JS_SPACE = "".join(chr(c) for c in (
    0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, *range(0x2000, 0x200B),
    0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF))
_VARIATION_SELECTOR_16 = chr(0xFE0F)


def _leading_emoji(text: str) -> tuple[str, str] | None:
    """`(emoji, rest)` when `text`, leading JS whitespace stripped, opens with one
    Extended_Pictographic character (plus an optional U+FE0F) and then spaces or tabs, as the
    client's `LEADING_EMOJI_RE`; else None."""
    trimmed = text.lstrip(_JS_SPACE)
    if not trimmed or not is_extended_pictographic(trimmed[0]):
        return None
    end = 2 if trimmed[1:2] == _VARIATION_SELECTOR_16 else 1
    emoji = trimmed[:end]
    return emoji, trimmed[end:].lstrip(" \t")


def _html_aside_callout(node: "_HtmlNode", ctx: _Ctx) -> dict[str, Any]:
    children = list(node.children)
    emoji = CALLOUT_DEFAULT_EMOJI
    if children and isinstance(children[0], str):
        found = _leading_emoji(children[0])
        if found is not None:
            emoji, children[0] = found
    content = _html_blocks_walk(children, ctx) or [{"type": "paragraph", "content": []}]
    return {"type": "callout", "attrs": {"emoji": emoji, "variant": None}, "content": content}


def _html_details_nodes(node: "_HtmlNode", ctx: _Ctx) -> list[dict[str, Any]]:
    """A `<details>` as the client's parse writes it, content written BEFORE its `<summary>`
    included (D3 review M7, measured on the client):
      * inline content before it is the summary of an OUTER toggle holding the real one
        (`<details>intro<summary>S</summary>b</details>`);
      * a block before it closes an empty toggle, then stands on its own, then the real
        toggle follows (`<details><p>pre</p><summary>S</summary>…`).
    Anything else is the one toggle (`_html_details_toggle`)."""
    summary = next((c for c in node.children if isinstance(c, _HtmlNode) and c.tag == "summary"), None)
    if summary is None:
        return [_html_details_toggle(node, ctx)]
    at = node.children.index(summary)
    pre = node.children[:at]
    if all(isinstance(c, str) and c.strip() == "" for c in pre):
        return [_html_details_toggle(node, ctx)]
    real = _HtmlNode("details", node.attrs)
    real.children = node.children[at:]
    if any(isinstance(c, _BlocksNode) or (isinstance(c, _HtmlNode) and c.tag not in _HTML_INLINE_TAGS)
           for c in pre):
        empty = {"type": "toggle", "attrs": {"open": True}, "content": [
            {"type": "toggleSummary", "content": []},
            {"type": "toggleContent", "content": [{"type": "paragraph", "content": []}]},
        ]}
        return [empty, *_html_blocks_walk(pre, ctx), _html_details_toggle(real, ctx)]
    outer = _html_details_toggle(_HtmlNode("details", node.attrs), ctx)
    flat = _html_inline_walk(pre, ctx)
    outer["content"][0]["content"] = [x for x in flat if x.get("type") not in _HOISTABLE_BLOCK_TYPES]
    outer["content"][1]["content"] = [
        *[x for x in flat if x.get("type") in _HOISTABLE_BLOCK_TYPES], _html_details_toggle(real, ctx)]
    return [outer]


#: Tags an inline walk reads (M7: content of these before a `<summary>` is inline).
_HTML_INLINE_TAGS = frozenset({"a", "b", "strong", "i", "em", "s", "del", "strike", "u", "mark",
                               "code", "br", "img"})


def _html_details_toggle(node: "_HtmlNode", ctx: _Ctx) -> dict[str, Any]:
    summary = next((c for c in node.children if isinstance(c, _HtmlNode) and c.tag == "summary"), None)
    rest = [c for c in node.children if c is not summary]
    kids = summary.children if summary is not None else []
    flat = _html_inline_walk([c for c in kids if not isinstance(c, _BlocksNode)], ctx)
    # toggleSummary is `inline*`: a block atom in it, and markdown blocks a region put in it
    # (`_place_region_blocks`, C1), move to the start of the content, as in the client's parse.
    title = [x for x in flat if x.get("type") not in _HOISTABLE_BLOCK_TYPES]
    hoisted = [x for x in flat if x.get("type") in _HOISTABLE_BLOCK_TYPES]
    for c in kids:
        if isinstance(c, _BlocksNode):
            hoisted.extend(c.blocks)
    if title and _blank_run(title):
        title = []  # only whitespace: an empty summary, as the client's parse strips it
    body = hoisted + _html_blocks_walk(rest, ctx)
    return {"type": "toggle", "attrs": {"open": True}, "content": [
        {"type": "toggleSummary", "content": title},
        {"type": "toggleContent", "content": body or [{"type": "paragraph", "content": []}]},
    ]}


#: Plan E Task 3 round 2 (R1): the mark tags that may wrap block content, and the block tags
#: that make them do so. `code` is not one: a code mark over a block has no editor meaning.
#: Merge of D3 (#721): `mark` (D3's highlight) joins the marks, and D3's block elements join
#: the blocks: a block wrapper is now a bare `div` (`_unwrap_unknown_html`) instead of being
#: unwrapped, so without `div` here `<b><div><p>a</p><p>b</p></div></b>` joined into one
#: paragraph `ab` again (R1's defect); `aside`/`details`/`summary` are blocks the same way.
_HTML_BLOCK_MARK_TAGS = frozenset({"b", "strong", "i", "em", "u", "s", "strike", "del", "mark"})
_HTML_BLOCK_TAGS = frozenset({"p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table",
                              "pre", "blockquote", "hr", "div", "aside", "details", "summary"})


def _html_holds_blocks(node: "_HtmlNode") -> bool:
    """True when a mark tag holds a block, directly or through other mark tags."""
    for c in node.children:
        if isinstance(c, str):
            continue
        if c.tag in _HTML_BLOCK_TAGS:
            return True
        if c.tag in _HTML_BLOCK_MARK_TAGS and _html_holds_blocks(c):
            return True
    return False


def _html_mark_text(node: Any, mark_type: str) -> None:
    """Adds `mark_type` to every text node under `node` that lacks it; code blocks untouched."""
    if not isinstance(node, dict) or node.get("type") == "codeBlock":
        return
    if node.get("type") == "text":
        marks = node.setdefault("marks", [])
        if not any(m.get("type") == mark_type for m in marks):
            marks.append({"type": mark_type})
        return
    for child in node.get("content") or []:
        _html_mark_text(child, mark_type)


def _html_blocks_walk(nodes: list[Any], ctx: _Ctx) -> list[dict[str, Any]]:
    """Block-context walk, mirroring `_blocks` above. Stray inline content
    encountered directly (text, or an inline-vocabulary tag with no `<p>`
    wrapper) is buffered and wrapped into implicit paragraph(s) on the next
    block boundary (or at the end) via `_wrap_paragraph` — reused verbatim
    from the markdown converter above, including its `image`-hoisting
    behavior. `_wrap_paragraph` is ONLY ever called here with a non-empty
    buffer (guarded by `if buf:`) — it unconditionally emits a paragraph for
    an EMPTY buffer too (by design, for markdown's own call sites), which
    would insert a spurious blank paragraph between every pair of sibling
    block tags if called unconditionally on every flush."""
    out: list[dict[str, Any]] = []
    buf: list[dict[str, Any]] = []

    def flush() -> None:
        nonlocal buf
        if buf and not _blank_run(buf):
            # Runs buffered from sibling nodes (`<span>a</span><span>b</span>`) join as the
            # editor's parser joins them (D3 item 7). Loose whitespace between blocks (the
            # line end inside an inline element a region's blocks split, C1) is no paragraph,
            # as in the client's parse.
            out.extend(_wrap_paragraph(_merge_text_runs(buf)))
            buf = []

    for n in nodes:
        if isinstance(n, _BlocksNode):
            flush()
            out.extend(n.blocks)  # markdown blocks inside an HTML region, already converted
            continue
        if isinstance(n, str):
            if n.strip() == "":
                continue  # pure whitespace between block siblings -> noise
            buf.extend(_html_inline_walk([n], ctx))
            continue

        tag = n.tag
        if tag == "p":
            flush()
            # `_wrap_paragraph` always returns >=1 node (even for an empty
            # `<p></p>`) — see its own docstring above. A `<p>` holding only whitespace is
            # an EMPTY paragraph, as the client's parse strips it (C1: `<p align>` + newline).
            flat = _html_inline_walk(n.children, ctx)
            out.extend(_wrap_paragraph([] if flat and _blank_run(flat) else flat))
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            flush()
            level = min(int(tag[1]), 3)
            flat = _html_inline_walk(n.children, ctx)
            text_items = [x for x in flat if x.get("type") not in _HOISTABLE_BLOCK_TYPES]
            hoisted = [x for x in flat if x.get("type") in _HOISTABLE_BLOCK_TYPES]
            out.append({"type": "heading", "attrs": {"level": level}, "content": text_items})
            out.extend(hoisted)
        elif tag == "ul":
            flush()
            out.extend(_html_list_or_tasklist(n, ctx, ordered=False))
        elif tag == "ol":
            flush()
            out.extend(_html_list_or_tasklist(n, ctx, ordered=True))
        elif tag == "table":
            flush()
            table = _html_convert_table(n, ctx)
            if table is not None:
                out.append(table)
        elif tag == "pre":
            flush()
            out.append(_html_convert_pre(n))
        elif tag == "blockquote":
            flush()
            inner = _html_blocks_walk(n.children, ctx)
            out.append({"type": "blockquote", "content": inner or [{"type": "paragraph", "content": []}]})
        elif tag == "hr":
            flush()
            out.append({"type": "horizontalRule"})
        elif tag in _HTML_BLOCK_MARK_TAGS and _html_holds_blocks(n):
            # Plan E Task 3 round 2 (R1): a mark tag around BLOCKS (`<b><p>a</p><p>b</p></b>`)
            # keeps the blocks and marks their text, as the editor does. Walking it inline (the
            # branch below) joined the blocks into one paragraph with no separator.
            flush()
            inner = _html_blocks_walk(n.children, ctx)
            for block in inner:
                _html_mark_text(block, _HTML_INLINE_MARK_TAGS[tag])
            out.extend(inner)
        elif tag == "div":
            # D3 item 7: a block wrapper (`_unwrap_unknown_html`) closes the paragraph before
            # it and its own content is blocks; nothing of its own (an empty div is no
            # paragraph, as in the client's parse).
            flush()
            out.extend(_html_blocks_walk(n.children, ctx))
        elif tag == "aside":
            flush()
            out.append(_html_aside_callout(n, ctx))
        elif tag == "details":
            flush()
            out.extend(_html_details_nodes(n, ctx))
        elif tag == "summary":
            # A summary outside a details: a block wrapper, as a div.
            flush()
            out.extend(_html_blocks_walk(n.children, ctx))
        else:
            # Any remaining known tag here (a/b/strong/i/em/s/del/strike/
            # code/img/br, or a stray li/tr/td/th outside its proper
            # parent) is inline-vocabulary or out-of-context — buffer it
            # like stray text rather than crash or drop it.
            buf.extend(_html_inline_walk([n], ctx))

    flush()
    return out


def txt_to_tiptap(text: str | None) -> dict[str, Any]:
    """Plain-text (.txt) -> TipTap JSON with NO markdown parsing — every
    character is literal (a `*`/`#`/`_` is never interpreted as syntax).
    Blank-line-separated blocks become separate paragraphs; single newlines
    within a block become explicit `hardBreak`s (preserves a plain-text
    file's original line layout, which its author typically intends
    verbatim, unlike markdown's line-reflow convention). No links/media are
    possible in plain text, so both lists are always empty.

    Originally a Dropbox-only private helper (`providers/dropbox.py::
    _txt_to_tiptap`) — lifted here (msgraph fix-round-1 Minor #3) once the
    OneDrive connector needed the IDENTICAL `.txt` conversion and importing
    a sibling provider's private, underscore-prefixed name meant a
    Dropbox-internal refactor could silently break OneDrive with no
    compiler/lint signal. Both `dropbox.py` and `onedrive.py` imported
    THIS one function (both archived 2026-11-04; it has no non-test caller
    today) — a Dropbox-only fallback per the ORIGINAL task
    brief's own wording ("reuse the mddoc helper if one exists, else
    escape+paragraphs") is exactly what this move makes true: `mddoc.py`
    now HAS a ready-made text-literal helper, shared like `md_to_tiptap`/
    `html_to_tiptap` above it. Output shape is IDENTICAL to the original —
    this is a pure relocation, not a rewrite."""
    raw = (text or "").replace("\r\n", "\n").replace("\r", "\n").strip("\n")
    if raw.strip() == "":
        return {"doc": {"type": "doc", "content": []}, "media": [], "links": []}
    content: list[dict[str, Any]] = []
    for block in re.split(r"\n{2,}", raw):
        lines = block.split("\n")
        para: list[dict[str, Any]] = []
        for i, line in enumerate(lines):
            if i > 0:
                para.append({"type": "hardBreak"})
            if line:
                para.append({"type": "text", "text": line})
        content.append({"type": "paragraph", "content": para})
    return {"doc": {"type": "doc", "content": content}, "media": [], "links": []}


def html_to_tiptap(html: str | None) -> dict[str, Any]:
    """Convert an HTML document/fragment into `{doc, media, links}` — the
    Dropbox connector's converter for `.html` files. Output shape is
    IDENTICAL to `md_to_tiptap`'s (same three keys, same placeholder
    conventions) so callers can treat both converters interchangeably.

    A bounded `html.parser.HTMLParser` walk (pure tokenizer — never executes
    script, never resolves external entities/DTDs) builds a small tree,
    `<script>`/`<style>`/`<head>` are dropped entirely (see module note
    above for why `<head>` joins the brief's explicit script/style pair),
    every other tag not in the declared vocabulary unwraps to its children,
    and content stays inside the SAME node/mark vocabulary declared at the
    top of this file — never a foreign TipTap node type.
    """
    builder = _HtmlDomBuilder()
    builder.feed(html or "")
    builder.close()
    nodes = _unwrap_unknown_html(builder.root.children)
    ctx = _Ctx()
    doc = {"type": "doc", "content": _html_blocks_walk(nodes, ctx)}
    repair_list_items(doc)  # D3 item 8
    return {"doc": doc, "media": ctx.media, "links": ctx.links}


# ── D3 item 8: the editor parser's list-item repair ──────────────────────────────────────

_REPAIRED_LIST_TYPES = ("bulletList", "orderedList")


def _split_list(lst: dict[str, Any]) -> list[dict[str, Any]]:
    """One list, repaired the way the client's editor parser repairs it. A list item's content
    must start with a paragraph. When an item's first child is another block (a nested list, a
    quote, a table, a code block, an image), the parser closes that item with an EMPTY
    paragraph and the item's content moves up a level, after the list; the list's later items
    continue there in a NEW `bulletList` (the parser's default wrapper, even under an `<ol>`),
    itself repaired the same way. The same rule as the Evernote branch's ENML converter
    (`enml._split_list`), measured there by its parity rail and here by the shared
    `html_block_vectors.json`. ⚰️ The server kept `listItem(bulletList(...))`, a list item the
    schema refuses (`paragraph block*`), where every client import showed the repaired shape."""
    # ⛔ ONE pass, never recursion per broken item (D3 review I1): a 1,000-item
    # `- ![[chart.png]]` log raised RecursionError, and the re-slicing was quadratic first.
    items = lst.get("content") or []
    out: list[dict[str, Any]] = []
    head: dict[str, Any] = lst  # the list being filled: the original, then new bulletLists
    current: list[dict[str, Any]] = []
    for item in items:
        content = item.get("content") or []
        if content and content[0].get("type") != "paragraph":
            closed = {**item, "content": [{"type": "paragraph", "content": []}]}
            out.append({**head, "content": [*current, closed]})
            out.extend(content)
            head, current = {"type": "bulletList"}, []
        else:
            current.append(item)
    if not out:
        return [lst]
    if current:
        out.append({**head, "content": current})
    return out


def repair_list_items(node: Any) -> None:
    """In place, bottom-up (inner lists first, so a block that moves up to the START of an
    outer item makes that item break in turn): every bullet or ordered list through
    `_split_list`. Lists only, as the ENML converter: a task item is written by
    `_html_list_or_tasklist` from a `data-uct-task` marker and keeps its shape."""
    if not isinstance(node, dict):
        return
    content = node.get("content")
    if not isinstance(content, list):
        return
    for child in content:
        repair_list_items(child)
    repaired: list[Any] = []
    for child in content:
        if isinstance(child, dict) and child.get("type") in _REPAIRED_LIST_TYPES:
            repaired.extend(_split_list(child))
        else:
            repaired.append(child)
    node["content"] = repaired
