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
    text with marks bold / italic / strike / code / link(href)

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
from html.parser import HTMLParser
from typing import Any

from markdown_it import MarkdownIt
from markdown_it.token import Token
from mdit_py_plugins.tasklists import tasklists_plugin

from . import LINK_PREFIX, REF_PREFIX

_MD: MarkdownIt | None = None


def _get_md() -> MarkdownIt:
    """A GFM-like markdown-it-py instance: CommonMark base + GFM tables +
    strikethrough + a task-list post-pass (checkbox state on list items).
    Built once and reused — `MarkdownIt.parse()` is stateless per call."""
    global _MD
    if _MD is None:
        md = MarkdownIt("commonmark").enable(["table", "strikethrough"])
        md.use(tasklists_plugin, enabled=True)
        _MD = md
    return _MD


class _Ctx:
    __slots__ = ("media", "links", "media_refs", "data_uri_counter")

    def __init__(self) -> None:
        self.media: list[dict[str, Any]] = []
        self.links: list[str] = []
        self.media_refs: set[str] = set()  # dedup guard for `_register_media`
        self.data_uri_counter: int = 0  # for synthesizing bounded md-img-N refs


# A data-URI image whose MIME isn't one mddoc supports (png/jpeg/gif/webp) never
# tokenizes as an `image` at all: markdown-it-py's OWN destination validator
# (`markdown_it.common.normalize_url`, `GOOD_DATA_RE = r"^data:image\/(gif|png|
# jpeg|webp);"`) already restricts `data:` image sources to exactly those four
# MIMEs — anything else falls back to literal, UNBOUNDED source text instead (a
# real base64 payload can run tens of KB; probed: a 20KB SVG produced a single
# 20,307-char text node, media []). That is worse than the ref-exploding bug
# `_data_uri_image_node` guards against below — the giant string lands as
# VISIBLE note content instead of a placeholder, and it never even reaches
# `_image_node`'s "unsupported -> visible marker" fallback because it never
# becomes an `image` token in the first place.
#
# Fix: a pre-tokenization pass over the RAW markdown string, before it ever
# reaches `_get_md().parse(...)`. Non-greedy on the base64 payload (deliberately,
# per review) and tolerant of an optional `"title"`/'title' suffix — CommonMark
# image syntax allows `![alt](url "title")`. A payload with a SUPPORTED mime is
# left byte-for-byte untouched (`re.Match.group(0)`); it still flows through the
# normal tokenize -> `_image_node` -> `_data_uri_image_node` path, which assigns
# it a bounded `md-img-N.<ext>` ref exactly as before.
_UNSUPPORTED_DATA_IMAGE_MD_RE = re.compile(
    r"!\[(?P<alt>[^\]]*)\]\("
    r"\s*data:(?P<mime>[^;,\s]+);base64,(?P<payload>[A-Za-z0-9+/=]*?)"
    r"\s*(?:\"[^\"]*\"|'[^']*')?\s*"
    r"\)"
)


def _strip_unsupported_data_uri_images(md: str) -> str:
    def _replace(match: "re.Match[str]") -> str:
        mime = match.group("mime").strip()
        if mime.lower() in _DATA_URI_MIME_EXT:
            return match.group(0)  # supported — untouched, handled downstream
        alt = match.group("alt").strip()
        marker = f"[unsupported image: {alt}, {mime}]" if alt else f"[unsupported image: {mime}]"
        return marker

    return _UNSUPPORTED_DATA_IMAGE_MD_RE.sub(_replace, md)


def md_to_tiptap(md: str | None) -> dict[str, Any]:
    """Convert a markdown string into `{doc, media, links}`.

    - `doc` — a TipTap JSON document (`{"type": "doc", "content": [...]}`).
      Empty/whitespace-only input yields `{"type": "doc", "content": []}`,
      matching the empty-body convention already used server-side
      (`notes.py::_validate_body_json`).
    - `media` — `[{"ref", "kind", "name"}, ...]` for every image reference
      encountered that was NOT already an `import-ref://` placeholder.
    - `links` — the target key (prefix stripped) of every `import-link://`
      href encountered, in document order.
    """
    cleaned = _strip_unsupported_data_uri_images(md or "")
    tokens = _get_md().parse(cleaned)
    ctx = _Ctx()
    content = _blocks(tokens, 0, len(tokens), ctx)
    return {"doc": {"type": "doc", "content": content}, "media": ctx.media, "links": ctx.links}


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
            text_items = [n for n in flat if n.get("type") != "image"]
            images = [n for n in flat if n.get("type") == "image"]
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
            text = (t.content or "").rstrip("\n")
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

        elif t.type == "html_block":
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


def _wrap_paragraph(flat: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Splits a flat inline-node sequence into block-level nodes, hoisting
    any `image` item out to its own sibling block. TipTap's Image node is
    block-level (`inline: false` in tiptap.js), so `text ![x](y) text` must
    become `paragraph, image, paragraph` — embedding the image inside a
    paragraph's content would be schema-invalid in the real editor."""
    out: list[dict[str, Any]] = []
    buf: list[dict[str, Any]] = []
    for item in flat:
        if item.get("type") == "image":
            if buf:
                out.append({"type": "paragraph", "content": buf})
                buf = []
            out.append(item)
        else:
            buf.append(item)
    if buf or not out:
        out.append({"type": "paragraph", "content": buf})
    return out


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
    ctx.media.append(entry)


# Base64 data-URI images (`![x](data:image/png;base64,...)`) carry the WHOLE
# encoded payload as their "src" — using that verbatim as a media `ref` would
# explode the ref string (and the `import-ref://` placeholder embedding it)
# to the size of the image itself. Mirrors the JS docx importer's synthetic
# `docx-img-N.<ext>` convention (`adapters/generic.js::extractDocxImages`):
# assign a small counter-based ref instead, and carry the original data URI
# on the media entry's `data_uri` field so the engine can decode bytes from
# it directly (no upload-by-URL round trip needed for an already-inline image).
_DATA_URI_RE = re.compile(r"^data:([^;,]+);base64,([\s\S]*)$")
_DATA_URI_MIME_EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
}


def _data_uri_image_node(src: str, ctx: _Ctx) -> dict[str, Any] | None:
    match = _DATA_URI_RE.match(src)
    if not match:
        return None
    ext = _DATA_URI_MIME_EXT.get(match.group(1).strip().lower())
    if ext is None:
        return None
    ctx.data_uri_counter += 1
    ref = f"md-img-{ctx.data_uri_counter}.{ext}"
    _register_media(ctx, ref=ref, kind="image", name=ref, data_uri=src)
    return {"type": "image", "attrs": {"src": f"{REF_PREFIX}{ref}"}}


def _image_node(token: Token, ctx: _Ctx) -> dict[str, Any] | None:
    """Returns the TipTap image node, or `None` when the src is an
    unsupported data URI (caller degrades to visible text in that case)."""
    src = token.attrs.get("src") or ""
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
_LINK_ALLOWED_PROTOCOLS = (
    "http", "https", "ftp", "ftps", "mailto", "tel", "callto", "sms", "cid", "xmpp",
)
_LINK_URI_RE = re.compile(
    r"^(?:(?:" + "|".join(_LINK_ALLOWED_PROTOCOLS) + r"):|[^a-z]|[a-z0-9+.\-]+(?:[^a-z+.\-:]|$))",
    re.IGNORECASE,
)


def _is_allowed_link_href(href: str) -> bool:
    if not href:
        return True  # mirrors the JS helper's `!uri` short-circuit
    if href.startswith("/journal") or href.startswith(LINK_PREFIX):
        return True
    return bool(_LINK_URI_RE.match(href))


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

    def push_text(text: str) -> None:
        if text == "":
            return
        node: dict[str, Any] = {"type": "text", "text": text}
        if marks:
            node["marks"] = [dict(m) for m in marks]
        if (
            items
            and items[-1].get("type") == "text"
            and items[-1].get("marks", []) == node.get("marks", [])
        ):
            items[-1]["text"] += text
        else:
            items.append(node)

    for idx, child in enumerate(children):
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
            node_marks = [dict(m) for m in marks] + [{"type": "code"}]
            text = child.content or ""
            if text:
                items.append({"type": "text", "text": text, "marks": node_marks})

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
            href = child.attrs.get("href") or ""
            if _is_allowed_link_href(href):
                if href.startswith(LINK_PREFIX):
                    ctx.links.append(href[len(LINK_PREFIX):])
                marks.append({"type": "link", "attrs": {"href": href}})
            # else: disallowed scheme -> no mark pushed. `link_close` below
            # is then a safe no-op (nothing matching 'link' on the stack),
            # so the text run itself still comes through, unmarked —
            # mirroring the real editor's parseHTML rejecting the `<a>` while
            # its text content still parses.
        elif child.type == "link_close":
            _pop_mark(marks, "link")

        elif child.type == "image":
            node = _image_node(child, ctx)
            if node is None:
                push_text("[unsupported image]")
            else:
                items.append(node)

        elif child.type == "html_inline":
            # An injected task-checkbox token is stripped by the caller
            # before we ever see it; any OTHER raw inline HTML has no home
            # in the TipTap vocabulary here — degrade to visible literal
            # text rather than silently dropping content.
            push_text(child.content or "")

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
#   - Task lists (`<input type="checkbox">` inside `<li>`) are NOT
#     recognized — the brief's HTML vocabulary list has no `taskList`/
#     `taskItem` entry (unlike markdown's checkbox syntax); a checkbox input
#     is an unknown/void tag and simply vanishes, its sibling text becomes a
#     plain `listItem`.


_HTML_KNOWN_TAGS = frozenset({
    "p", "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li",
    "table", "tr", "td", "th",
    "pre", "code",
    "blockquote", "hr", "br", "img", "a",
    "b", "strong", "i", "em", "s", "del", "strike",
})

# Tags whose content model never permits children (no close tag expected) —
# appended as a leaf, never pushed onto the open-element stack.
_HTML_VOID_TAGS = frozenset({"br", "hr", "img"})

# Dropped ENTIRELY (tag + every descendant, text included) — see module note
# above. `head` is a deliberate addition beyond the brief's explicit
# script/style pair.
_HTML_DROPPED_TAGS = frozenset({"script", "style", "head"})

_HTML_INLINE_MARK_TAGS = {
    "b": "bold", "strong": "bold",
    "i": "italic", "em": "italic",
    "s": "strike", "del": "strike", "strike": "strike",
    "code": "code",
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

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in _HTML_DROPPED_TAGS:
            self._skip_depth += 1
            return
        if self._skip_depth:
            return
        node = _HtmlNode(tag, {k.lower(): v for k, v in attrs})
        self._stack[-1].children.append(node)
        if tag not in _HTML_VOID_TAGS:
            self._stack.append(node)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in _HTML_DROPPED_TAGS:
            if self._skip_depth:
                self._skip_depth -= 1
            return
        if self._skip_depth or tag in _HTML_VOID_TAGS:
            return
        for i in range(len(self._stack) - 1, 0, -1):
            if self._stack[i].tag == tag:
                del self._stack[i:]
                return
        # Stray close tag with no matching open -> ignore (malformed HTML).

    def handle_data(self, data: str) -> None:
        if self._skip_depth or not data:
            return
        self._stack[-1].children.append(data)


def _unwrap_unknown_html(nodes: list[Any]) -> list[Any]:
    """Splices any tag NOT in `_HTML_KNOWN_TAGS` (e.g. `div`/`span`/`html`/
    `body`/`section`) out of the tree, recursively, replacing it in place
    with its own (already-unwrapped) children — "unknown tags unwrap to
    children" per the brief, applied bottom-up in one pass so a chain of
    nested unknowns (`<div><span>x</span></div>`) fully flattens."""
    out: list[Any] = []
    for n in nodes:
        if isinstance(n, str):
            out.append(n)
            continue
        if n.tag in _HTML_KNOWN_TAGS:
            n.children = _unwrap_unknown_html(n.children)
            out.append(n)
        else:
            out.extend(_unwrap_unknown_html(n.children))
    return out


def _html_image_node(node: "_HtmlNode", ctx: _Ctx) -> dict[str, Any] | None:
    src = (node.attrs.get("src") or "").strip()
    if not src:
        return None
    if src.startswith(REF_PREFIX):
        return {"type": "image", "attrs": {"src": src}}
    if src.startswith("data:"):
        return _data_uri_image_node(src, ctx)
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
        if marks:
            node["marks"] = [dict(m) for m in marks]
        if (
            items
            and items[-1].get("type") == "text"
            and items[-1].get("marks", []) == node.get("marks", [])
        ):
            items[-1]["text"] += text
        else:
            items.append(node)

    for n in nodes:
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
            href = (n.attrs.get("href") or "").strip()
            if _is_allowed_link_href(href):
                if href.startswith(LINK_PREFIX):
                    ctx.links.append(href[len(LINK_PREFIX):])
                link_marks = marks + [{"type": "link", "attrs": {"href": href}}]
                items.extend(_html_inline_walk(n.children, ctx, link_marks))
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

    return items


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
    text = _html_literal_text(source.children)
    content = [{"type": "text", "text": text}] if text else []
    return {"type": "codeBlock", "attrs": {"language": language}, "content": content}


def _html_literal_text(nodes: list[Any]) -> str:
    out: list[str] = []
    for n in nodes:
        if isinstance(n, str):
            out.append(n)
        else:
            if n.tag == "br":
                out.append("\n")
            out.append(_html_literal_text(n.children))
    return "".join(out)


def _html_convert_list(node: "_HtmlNode", ctx: _Ctx, *, ordered: bool) -> dict[str, Any]:
    """`<ul>`/`<ol>` -> `bulletList`/`orderedList`. Only direct `<li>`
    children become items (TipTap's content model is `listItem+`); any other
    stray child is dropped. Unlike markdown lists, raw HTML `<ul>`/`<ol>`
    markup can't mix task-list and plain items (no checkbox syntax in this
    vocabulary — see the module note above), so — unlike `md_to_tiptap`'s
    `_list_runs` — a single list node is always correct here, no run-
    splitting needed."""
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


def _html_convert_table(node: "_HtmlNode", ctx: _Ctx) -> dict[str, Any]:
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
        rows.append({"type": "tableRow", "content": cells})
    return {"type": "table", "content": rows}


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
        if buf:
            out.extend(_wrap_paragraph(buf))
            buf = []

    for n in nodes:
        if isinstance(n, str):
            if n.strip() == "":
                continue  # pure whitespace between block siblings -> noise
            buf.extend(_html_inline_walk([n], ctx))
            continue

        tag = n.tag
        if tag == "p":
            flush()
            # `_wrap_paragraph` always returns >=1 node (even for an empty
            # `<p></p>`) — see its own docstring above.
            out.extend(_wrap_paragraph(_html_inline_walk(n.children, ctx)))
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            flush()
            level = min(int(tag[1]), 3)
            flat = _html_inline_walk(n.children, ctx)
            text_items = [x for x in flat if x.get("type") != "image"]
            images = [x for x in flat if x.get("type") == "image"]
            out.append({"type": "heading", "attrs": {"level": level}, "content": text_items})
            out.extend(images)
        elif tag == "ul":
            flush()
            out.append(_html_convert_list(n, ctx, ordered=False))
        elif tag == "ol":
            flush()
            out.append(_html_convert_list(n, ctx, ordered=True))
        elif tag == "table":
            flush()
            out.append(_html_convert_table(n, ctx))
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
        else:
            # Any remaining known tag here (a/b/strong/i/em/s/del/strike/
            # code/img/br, or a stray li/tr/td/th outside its proper
            # parent) is inline-vocabulary or out-of-context — buffer it
            # like stray text rather than crash or drop it.
            buf.extend(_html_inline_walk([n], ctx))

    flush()
    return out


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
    content = _html_blocks_walk(nodes, ctx)
    return {"doc": {"type": "doc", "content": content}, "media": ctx.media, "links": ctx.links}
