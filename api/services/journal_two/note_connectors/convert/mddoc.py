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

from typing import Any

from markdown_it import MarkdownIt
from markdown_it.token import Token
from mdit_py_plugins.tasklists import tasklists_plugin

REF_PREFIX = "import-ref://"
LINK_PREFIX = "import-link://"

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
    __slots__ = ("media", "links")

    def __init__(self) -> None:
        self.media: list[dict[str, Any]] = []
        self.links: list[str] = []


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
    tokens = _get_md().parse(md or "")
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
            content = _inline_nodes(inline.children or [], ctx)
            out.append({"type": "heading", "attrs": {"level": level}, "content": content})
            i += 3

        elif t.type == "paragraph_open":
            inline = tokens[i + 1]
            flat = _inline_nodes(inline.children or [], ctx)
            out.extend(_wrap_paragraph(flat))
            i += 3

        elif t.type == "bullet_list_open":
            j = _find_close(tokens, i, "bullet_list_close")
            is_task = "contains-task-list" in (t.attrs.get("class") or "")
            items = _list_items(tokens, i + 1, j, ctx, is_task)
            out.append({"type": "taskList" if is_task else "bulletList", "content": items})
            i = j + 1

        elif t.type == "ordered_list_open":
            j = _find_close(tokens, i, "ordered_list_close")
            items = _list_items(tokens, i + 1, j, ctx, False)
            start_at = t.attrs.get("start", 1)
            out.append({"type": "orderedList", "attrs": {"start": start_at}, "content": items})
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


def _list_items(
    tokens: list[Token], start: int, end: int, ctx: _Ctx, is_task: bool,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    i = start
    while i < end:
        t = tokens[i]
        if t.type != "list_item_open":
            i += 1
            continue
        j = _find_close(tokens, i, "list_item_close")
        classes = t.attrs.get("class") or ""
        if is_task and "task-list-item" in classes:
            checked, content = _task_item_blocks(tokens, i + 1, j, ctx)
            items.append({"type": "taskItem", "attrs": {"checked": checked}, "content": content})
        else:
            content = _blocks(tokens, i + 1, j, ctx)
            items.append({"type": "listItem", "content": content})
        i = j + 1
    return items


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
            inline_nodes: list[dict[str, Any]] = []
            if j > i + 1 and tokens[i + 1].type == "inline":
                inline_nodes = _inline_nodes(tokens[i + 1].children or [], ctx)
            node_type = "tableHeader" if t.type == "th_open" else "tableCell"
            cells.append({
                "type": node_type,
                "content": [{"type": "paragraph", "content": inline_nodes}],
            })
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


def _image_node(token: Token, ctx: _Ctx) -> dict[str, Any]:
    src = token.attrs.get("src") or ""
    if src.startswith(REF_PREFIX):
        # Already a connector-supplied placeholder — pass through untouched,
        # no duplicate media entry (the connector already registered it).
        return {"type": "image", "attrs": {"src": src}}
    ctx.media.append({"ref": src, "kind": "image", "name": _basename(src)})
    return {"type": "image", "attrs": {"src": f"{REF_PREFIX}{src}"}}


def _basename(ref: str) -> str:
    clean = ref.split("#", 1)[0].split("?", 1)[0]
    tail = clean.rsplit("/", 1)[-1]
    return tail or clean


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
            if href.startswith(LINK_PREFIX):
                ctx.links.append(href[len(LINK_PREFIX):])
            marks.append({"type": "link", "attrs": {"href": href}})
        elif child.type == "link_close":
            _pop_mark(marks, "link")

        elif child.type == "image":
            items.append(_image_node(child, ctx))

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
