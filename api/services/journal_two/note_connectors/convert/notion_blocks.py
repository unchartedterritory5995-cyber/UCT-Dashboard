"""Notion block -> TipTap dispatch table (spec §4/§7).

`providers/notion.py` owns every HTTP call (search, block children,
database queries, media downloads); this module is deliberately I/O-free
and network-library-free — it walks ALREADY-FETCHED Notion block dicts and
calls back into three injected async callables whenever it needs more data
(`fetch_children`, `query_database`, `resolve_media`). That keeps this
module testable with plain fake callables, no `httpx.MockTransport`
required, mirroring `roam_text.py`'s "no module-level state, explicit
parameters" discipline — except here the walk is async (Notion block trees
are paginated per-level, unlike Roam's single `pull-many` whole-tree fetch),
so state that WOULD have been a `_Ctx` object in `mddoc.py` is threaded
explicitly through every recursive call instead.

**Dispatch table** (`NotionBlockConverter._dispatch`, built in `__init__`):
paragraph / heading_1-3 (+ toggleable -> blockquote+bold title) /
bulleted_list_item / numbered_list_item / to_do -> taskItem / toggle ->
blockquote+bold title / callout -> blockquote+bold title(+emoji) / quote /
code(+caption) / divider / table(+table_row) / child_database (<=50 rows ->
inline table, >50 -> per-row pages, spec's "wizard parity" threshold) /
child_page -> import-link:// / link_to_page -> import-link:// / synced_block
(resolve the original ONCE, cycle-guarded) / column_list -> sequential /
equation -> codeBlock-styled text / image·video·file·pdf -> media
placeholders / bookmark·link_preview·embed -> plain external link.
table_of_contents/breadcrumb are Notion-UI-only navigational blocks with no
user content to preserve — deliberately DROPPED (not routed through the
`unsupported` marker, which exists for content we don't know how to
represent, not content that never had any). ANY block type not in the
table above (including Notion's own literal `"unsupported"` type, and
`"template"`) falls through to a visible `[unsupported block: <type>]`
paragraph — NEVER silent.

**Two lifetimes, kept separate on purpose:**
  - `_synced_cache`/`_synced_resolving` (instance-level, on `self`): a
    synced_block's original is resolved+converted ONCE per
    `NotionBlockConverter` instance and reused for every later reference to
    it, including across DIFFERENT pages converted by the same instance —
    correct (a synced block mirrors identical content everywhere) and a
    real perf win across one batch's worth of pages.
  - `_Media` (media/media_refs) — fresh per NOTE, never shared. A
    `child_database` with >50 rows spawns per-row NOTES
    (`convert_row_page`, spec: "wizard parity"); each row's downloaded
    media bytes belong to THAT row's own `RemoteNote.media`, never the
    parent page's — sharing one media list across notes would silently
    strand a row note's `import-ref://` placeholders (nothing would ever
    resolve them, since the bytes would be attributed to a DIFFERENT
    note's `.media`). `extra_pages` (the flat list of per-row notes
    discovered anywhere in the tree, including nested inside another
    row's own body) is the one thing genuinely shared across the WHOLE
    top-level `convert()` call — it is threaded explicitly as a plain
    list, not stuffed into `_Media`, so its very different lifetime is
    visible at every call site rather than hidden inside one grab-bag
    object.

Spec: docs/superpowers/specs/2026-08-11-note-connectors-design.md §4, §7.
"""

from __future__ import annotations

import copy
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from . import LINK_PREFIX, REF_PREFIX

# spec §7: "<=50 rows -> table doc, >50 -> per-row pages (wizard parity)" —
# matches the wizard's own CSV_MAX_ROWS constant
# (app/src/pages/journal-2-0/lib/importer/adapters/notion.js).
_DATABASE_TABLE_MAX_ROWS = 50

FetchChildrenFn = Callable[[str], Awaitable[list[dict[str, Any]]]]
QueryDatabaseFn = Callable[[str], Awaitable[list[dict[str, Any]]]]
ResolveMediaFn = Callable[[dict[str, Any]], Awaitable[dict[str, Any] | None]]

_MEDIA_BLOCK_TYPES = ("image", "video", "file", "pdf")


# ── small pure helpers (no I/O; independently testable) ─────────────────────

def extract_media_info(block: dict[str, Any]) -> tuple[str, bool, str] | None:
    """`(url, is_external, name)` for an image/video/file/pdf block, or
    `None` if the block isn't a media type or carries no url. `is_external`
    distinguishes Notion-hosted (pre-signed, ~1h-expiring S3 url — MUST be
    downloaded NOW, during traversal) from `external` (an arbitrary,
    non-expiring url — safe to resolve LATER via `fetch_media`). Exported
    (not underscored) so `providers/notion.py` can reuse it unchanged on a
    freshly-refetched block during its 403-retry path — one parser, not
    two copies that could drift."""
    btype = block.get("type")
    if btype not in _MEDIA_BLOCK_TYPES:
        return None
    data = block.get(btype) or {}
    kind = data.get("type")
    if kind == "external":
        url = (data.get("external") or {}).get("url")
        is_external = True
    elif kind == "file":
        url = (data.get("file") or {}).get("url")
        is_external = False
    else:
        return None
    if not url:
        return None
    name = data.get("name") or _basename_from_url(url)
    return url, is_external, name


def _basename_from_url(url: str) -> str:
    clean = url.split("#", 1)[0].split("?", 1)[0]
    tail = clean.rsplit("/", 1)[-1]
    return tail or clean


def extract_title(page: dict[str, Any]) -> str:
    """The plain text of whichever property has `type == "title"` on a
    Notion page/database-row object — used for both the top-level page
    title (`providers/notion.py`) and a database row's derived title
    (`convert_row_page` below). Falls back to "Untitled", never raises."""
    for prop in (page.get("properties") or {}).values():
        if not isinstance(prop, dict) or prop.get("type") != "title":
            continue
        text = "".join(rt.get("plain_text", "") for rt in prop.get("title") or [])
        if text:
            return text
    return "Untitled"


def _property_plain_text(prop: dict[str, Any] | None) -> str:
    """Stringifies ONE Notion property value for the row-page "Properties"
    preamble / the inline database table. Every branch degrades to `""`
    for missing/unrecognized shapes rather than raising — a property this
    doesn't understand is simply blank, never a crash."""
    if not isinstance(prop, dict):
        return ""
    t = prop.get("type")
    if t in ("rich_text", "title"):
        return "".join(rt.get("plain_text", "") for rt in prop.get(t) or [])
    if t == "number":
        n = prop.get("number")
        return "" if n is None else str(n)
    if t in ("select", "status"):
        sel = prop.get(t)
        return sel.get("name", "") if isinstance(sel, dict) else ""
    if t == "multi_select":
        return ", ".join(o.get("name", "") for o in prop.get("multi_select") or [])
    if t == "date":
        d = prop.get("date")
        if not isinstance(d, dict):
            return ""
        start, end = d.get("start"), d.get("end")
        return f"{start} → {end}" if (start and end) else (start or "")
    if t == "checkbox":
        return "Yes" if prop.get("checkbox") else "No"
    if t in ("url", "email", "phone_number"):
        return prop.get(t) or ""
    if t == "people":
        return ", ".join((p.get("name") or p.get("id", "")) for p in prop.get("people") or [])
    if t == "files":
        return ", ".join(f.get("name", "") for f in prop.get("files") or [])
    if t in ("created_time", "last_edited_time"):
        return prop.get(t) or ""
    if t in ("created_by", "last_edited_by"):
        who = prop.get(t) or {}
        return who.get("name") or who.get("id", "")
    if t in ("formula", "rollup"):
        inner = prop.get(t) or {}
        inner_type = inner.get("type")
        return str(inner.get(inner_type, "")) if inner_type else ""
    if t == "relation":
        rel = prop.get("relation") or []
        return f"{len(rel)} linked" if rel else ""
    if t == "unique_id":
        uid = prop.get("unique_id") or {}
        number = uid.get("number")
        return f"{uid.get('prefix') or ''}{number}" if number is not None else ""
    return ""


def _add_mark(node: dict[str, Any], mark_type: str) -> dict[str, Any]:
    out = dict(node)
    marks = list(out.get("marks") or [])
    if not any(m.get("type") == mark_type for m in marks):
        marks.append({"type": mark_type})
    out["marks"] = marks
    return out


def _annotations_to_marks(ann: dict[str, Any]) -> list[dict[str, Any]]:
    marks: list[dict[str, Any]] = []
    if ann.get("bold"):
        marks.append({"type": "bold"})
    if ann.get("italic"):
        marks.append({"type": "italic"})
    if ann.get("strikethrough"):
        marks.append({"type": "strike"})
    if ann.get("code"):
        marks.append({"type": "code"})
    # `underline`/`color` have no equivalent in the declared TipTap
    # vocabulary (mddoc.py's own node/mark list) — the STYLE is dropped,
    # the text itself is always kept, matching mddoc's own precedent for
    # marks it can't represent (e.g. Roam's `^^highlight^^` degrading to
    # visible `==text==` rather than inventing an undeclared mark).
    return marks


def _rich_text_to_inline(rich_text: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Notion rich_text array -> flat TipTap inline text-node list. Mirrors
    `mddoc.py::_inline_nodes`'s node shapes exactly (text + composed
    marks) so the rest of the pipeline (rewrite_body, the schema rail)
    treats a Notion-sourced doc identically to a markdown-sourced one."""
    items: list[dict[str, Any]] = []
    for rt in rich_text or []:
        if not isinstance(rt, dict):
            continue
        rt_type = rt.get("type")
        text = rt.get("plain_text", "") or ""

        if rt_type == "equation":
            expr = (rt.get("equation") or {}).get("expression") or text
            if expr:
                items.append({"type": "text", "text": expr, "marks": [{"type": "code"}]})
            continue

        if rt_type == "mention":
            mention = rt.get("mention") or {}
            if mention.get("type") == "page":
                page_id = (mention.get("page") or {}).get("id")
                if page_id and text:
                    marks = _annotations_to_marks(rt.get("annotations") or {})
                    marks.append({"type": "link", "attrs": {"href": f"{LINK_PREFIX}notion:{page_id}"}})
                    items.append({"type": "text", "text": text, "marks": marks})
                    continue
            # Any other mention kind (user/date/database/link_preview) has
            # no resolution path here — degrade to its plain text, never
            # dropped.
            if text:
                items.append({"type": "text", "text": text})
            continue

        # Plain "text" rich_text item.
        marks = _annotations_to_marks(rt.get("annotations") or {})
        href = rt.get("href")
        if href:
            marks.append({"type": "link", "attrs": {"href": href}})
        if text:
            items.append({"type": "text", "text": text, "marks": marks} if marks else {"type": "text", "text": text})
    return items


def _unsupported_marker(block_type: str | None) -> dict[str, Any]:
    label = block_type or "unknown"
    return {"type": "paragraph", "content": [{"type": "text", "text": f"[unsupported block: {label}]"}]}


def _para(inline: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "paragraph", "content": inline}


def _text_para(text: str) -> dict[str, Any]:
    return {"type": "paragraph", "content": [{"type": "text", "text": text}] if text else []}


def _extract_link_targets(node: Any, out: list[str]) -> None:
    """One final walk (post-assembly) over a built TipTap doc, pulling
    every `import-link://` mark's target key — simpler and less
    error-prone than threading a `links` accumulator through every single
    inline-conversion call site (mentions, child_page, link_to_page all
    produce link marks independently; a walk can't miss one by omission
    the way an incremental-tracking call site could)."""
    if isinstance(node, dict):
        for mark in node.get("marks") or []:
            href = (mark.get("attrs") or {}).get("href") if isinstance(mark, dict) else None
            if isinstance(href, str) and href.startswith(LINK_PREFIX):
                out.append(href[len(LINK_PREFIX):])
        for child in node.get("content") or []:
            _extract_link_targets(child, out)
    elif isinstance(node, list):
        for item in node:
            _extract_link_targets(item, out)


def _group_list_runs(entries: list[tuple[str | None, list[dict[str, Any]]]]) -> list[dict[str, Any]]:
    """Notion returns bulleted/numbered/to_do items as flat SIBLING blocks
    (no wrapping "list" container the way markdown tokenizes one) — this
    groups adjacent same-kind entries into ONE bulletList/orderedList/
    taskList, mirroring `mddoc.py::_list_runs`'s run-splitting logic run in
    reverse (there: one markdown list splits into runs by kind; here: a
    flat block sequence groups into runs by kind). A `None`-kind entry
    (anything that isn't a list item) always ends the current run and
    passes its own node(s) through untouched."""
    out: list[dict[str, Any]] = []
    i, n = 0, len(entries)
    _WRAPPER = {"bullet": "bulletList", "ordered": "orderedList", "task": "taskList"}
    while i < n:
        kind, nodes = entries[i]
        if kind is None:
            out.extend(nodes)
            i += 1
            continue
        run = list(nodes)
        i += 1
        while i < n and entries[i][0] == kind:
            run.extend(entries[i][1])
            i += 1
        node: dict[str, Any] = {"type": _WRAPPER[kind], "content": run}
        if kind == "ordered":
            # Notion's API carries no per-item rendered number the way
            # markdown's `3. item` syntax does (mddoc.py::_list_runs reads
            # that digit off the token) — every RUN restarts at 1, matching
            # the wrapper node shape mddoc.py itself emits (`attrs.start`).
            node["attrs"] = {"start": 1}
        out.append(node)
    return out


def _properties_preamble(page: dict[str, Any]) -> list[dict[str, Any]]:
    """A "Properties" heading + bullet list summarizing every non-title
    property on a database-row page, prepended to that row's own body —
    used only by `convert_row_page` (the >50-row overflow path). Empty
    when the row carries no non-title properties (no dangling heading over
    nothing)."""
    props = page.get("properties") or {}
    items: list[dict[str, Any]] = []
    for name, prop in props.items():
        if not isinstance(prop, dict) or prop.get("type") == "title":
            continue
        value = _property_plain_text(prop)
        if not value:
            continue
        items.append({
            "type": "listItem",
            "content": [_para([
                {"type": "text", "text": f"{name}: ", "marks": [{"type": "bold"}]},
                {"type": "text", "text": value},
            ])],
        })
    if not items:
        return []
    return [
        {"type": "heading", "attrs": {"level": 3}, "content": [{"type": "text", "text": "Properties"}]},
        {"type": "bulletList", "content": items},
    ]


def _database_table_node(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """<=50-row database -> one inline TipTap `table`. Column order: the
    title-typed property first, then the rest of the FIRST row's own
    property key order (alphabetical tiebreak keeps it deterministic for
    same-shaped rows) — every row is rendered against that SAME column
    set, missing values simply blank."""
    if not rows:
        return {"type": "table", "content": [{"type": "tableRow", "content": [
            {"type": "tableCell", "content": [_text_para("")]},
        ]}]}
    first_props = rows[0].get("properties") or {}
    columns = sorted(
        first_props.keys(),
        key=lambda k: (first_props[k].get("type") != "title" if isinstance(first_props[k], dict) else True, k),
    )
    header_row = {
        "type": "tableRow",
        "content": [{"type": "tableHeader", "content": [_text_para(c)]} for c in columns],
    }
    body_rows = []
    for row in rows:
        props = row.get("properties") or {}
        cells = []
        for c in columns:
            prop = props.get(c)
            text = _property_plain_text(prop)
            if isinstance(prop, dict) and prop.get("type") == "title" and not text:
                text = extract_title(row)
            cells.append({"type": "tableCell", "content": [_text_para(text)]})
        body_rows.append({"type": "tableRow", "content": cells})
    return {"type": "table", "content": [header_row, *body_rows]}


@dataclass
class _Media:
    """Per-NOTE media accumulator — see the module docstring's "two
    lifetimes" note for why this is never shared across notes."""
    media: list[dict[str, Any]] = field(default_factory=list)
    media_refs: set[str] = field(default_factory=set)

    def register(self, resolution: dict[str, Any]) -> None:
        ref = resolution.get("ref")
        if not ref or ref in self.media_refs:
            return
        self.media_refs.add(ref)
        self.media.append(dict(resolution))


class NotionBlockConverter:
    """Stateful per-sync converter. `providers/notion.py` constructs ONE
    instance per `fetch_many` batch (see that module's docstring for why
    per-batch, not per-provider-lifetime), wiring the three async
    callables to real Notion API calls; tests wire them to plain fakes."""

    def __init__(
        self, *, fetch_children: FetchChildrenFn, query_database: QueryDatabaseFn,
        resolve_media: ResolveMediaFn,
    ) -> None:
        self._fetch_children = fetch_children
        self._query_database = query_database
        self._resolve_media = resolve_media
        # synced_block original-resolution cache/cycle-guard — instance
        # lifetime (see module docstring).
        self._synced_cache: dict[str, list[dict[str, Any]]] = {}
        self._synced_resolving: set[str] = set()
        self._dispatch: dict[str, Callable[[dict, _Media, list], Awaitable[tuple[str | None, list]]]] = {
            "paragraph": self._paragraph,
            "heading_1": self._heading, "heading_2": self._heading, "heading_3": self._heading,
            "bulleted_list_item": self._bulleted_item,
            "numbered_list_item": self._numbered_item,
            "to_do": self._to_do,
            "toggle": self._toggle,
            "callout": self._callout,
            "quote": self._quote,
            "code": self._code,
            "divider": self._divider,
            "table": self._table,
            "child_database": self._child_database,
            "child_page": self._child_page,
            "link_to_page": self._link_to_page,
            "synced_block": self._synced_block,
            "column_list": self._column_list,
            "equation": self._equation_block,
            "image": self._media_block, "video": self._media_block,
            "file": self._media_block, "pdf": self._media_block,
            "bookmark": self._external_link_block,
            "link_preview": self._external_link_block,
            "embed": self._external_link_block,
            "table_of_contents": self._silent_drop,
            "breadcrumb": self._silent_drop,
        }

    # ── top-level entry points ──────────────────────────────────────────

    async def convert(self, blocks: list[dict[str, Any]]) -> dict[str, Any]:
        """One PAGE's top-level block list -> `{doc, media, links,
        extra_pages}`. `extra_pages` is a flat list of
        `{remote_id, title, doc, media, links, created_at, updated_at}`
        dicts — >50-row database rows discovered anywhere in the tree,
        shaped ready for `providers/notion.py` to wrap as sibling
        `RemoteNote`s."""
        media = _Media()
        extra_pages: list[dict[str, Any]] = []
        nodes = await self._convert_blocks(blocks, media, extra_pages)
        doc = {"type": "doc", "content": nodes}
        links: list[str] = []
        _extract_link_targets(doc, links)
        return {"doc": doc, "media": media.media, "links": links, "extra_pages": extra_pages}

    async def convert_row_page(
        self, page: dict[str, Any], extra_pages: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """A database-row PAGE object (has its own `id`/`properties`, and
        its own child blocks fetched exactly like a normal page) -> a
        note-shaped dict. `extra_pages` is the CALLER's (shared, top-level)
        accumulator — passed through so a nested child_database inside
        THIS row's own body still bubbles its overflow rows to the same
        flat list, rather than nesting accumulators."""
        media = _Media()  # fresh — this row's OWN media, never the parent's
        page_id = page["id"]
        title = extract_title(page)
        children = await self._fetch_children(page_id)
        body_nodes = await self._convert_blocks(children, media, extra_pages)
        doc = {"type": "doc", "content": _properties_preamble(page) + body_nodes}
        links: list[str] = []
        _extract_link_targets(doc, links)
        return {
            "remote_id": page_id, "title": title, "doc": doc,
            "media": media.media, "links": links,
            "created_at": page.get("created_time"),
            "updated_at": page.get("last_edited_time"),
        }

    # ── block walk ───────────────────────────────────────────────────────

    async def _convert_blocks(
        self, blocks: list[dict[str, Any]], media: _Media, extra_pages: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        entries: list[tuple[str | None, list[dict[str, Any]]]] = []
        for block in blocks:
            entries.append(await self._convert_one(block, media, extra_pages))
        return _group_list_runs(entries)

    async def _convert_one(
        self, block: dict[str, Any], media: _Media, extra_pages: list[dict[str, Any]],
    ) -> tuple[str | None, list[dict[str, Any]]]:
        btype = block.get("type")
        handler = self._dispatch.get(btype)
        if handler is None:
            return None, [_unsupported_marker(btype)]
        return await handler(block, media, extra_pages)

    async def _children_of(
        self, block: dict[str, Any], media: _Media, extra_pages: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Recurses ONLY when `has_children` is true — the traversal
        requirement named explicitly in the task brief. Every handler
        below that can carry nested content calls this rather than
        unconditionally fetching."""
        if not block.get("has_children"):
            return []
        children = await self._fetch_children(block["id"])
        return await self._convert_blocks(children, media, extra_pages)

    # ── dispatch handlers ────────────────────────────────────────────────

    async def _paragraph(self, block, media, extra_pages):
        inline = _rich_text_to_inline((block.get("paragraph") or {}).get("rich_text"))
        nodes = [_para(inline), *await self._children_of(block, media, extra_pages)]
        return None, nodes

    async def _heading(self, block, media, extra_pages):
        btype = block["type"]
        level = min(int(btype[-1]), 3)
        data = block.get(btype) or {}
        inline = _rich_text_to_inline(data.get("rich_text"))
        toggleable = bool(data.get("is_toggleable"))
        children_nodes = await self._children_of(block, media, extra_pages)
        if toggleable:
            bold_line = [_add_mark(n, "bold") for n in inline]
            return None, [{"type": "blockquote", "content": [_para(bold_line), *children_nodes]}]
        heading = {"type": "heading", "attrs": {"level": level}, "content": inline}
        return None, [heading, *children_nodes]

    async def _bulleted_item(self, block, media, extra_pages):
        return await self._list_item(block, media, extra_pages, kind="bullet")

    async def _numbered_item(self, block, media, extra_pages):
        return await self._list_item(block, media, extra_pages, kind="ordered")

    async def _list_item(self, block, media, extra_pages, *, kind):
        btype = block["type"]
        inline = _rich_text_to_inline((block.get(btype) or {}).get("rich_text"))
        content = [_para(inline), *await self._children_of(block, media, extra_pages)]
        return kind, [{"type": "listItem", "content": content}]

    async def _to_do(self, block, media, extra_pages):
        data = block.get("to_do") or {}
        inline = _rich_text_to_inline(data.get("rich_text"))
        content = [_para(inline), *await self._children_of(block, media, extra_pages)]
        node = {"type": "taskItem", "attrs": {"checked": bool(data.get("checked"))}, "content": content}
        return "task", [node]

    async def _toggle(self, block, media, extra_pages):
        return await self._blockquote_with_bold_title(block, media, extra_pages, icon=None)

    async def _callout(self, block, media, extra_pages):
        icon = (block.get("callout") or {}).get("icon") or {}
        emoji = icon.get("emoji") if icon.get("type") == "emoji" else None
        return await self._blockquote_with_bold_title(block, media, extra_pages, icon=emoji)

    async def _blockquote_with_bold_title(self, block, media, extra_pages, *, icon):
        """toggle/callout -> blockquote with a bold first line, per the
        task brief's self-review checklist wording verbatim. `icon` (a
        callout's emoji, if any) is prefixed onto the bold line."""
        btype = block["type"]
        inline = [_add_mark(n, "bold") for n in _rich_text_to_inline((block.get(btype) or {}).get("rich_text"))]
        if icon:
            inline = [{"type": "text", "text": f"{icon} ", "marks": [{"type": "bold"}]}, *inline]
        content = [_para(inline), *await self._children_of(block, media, extra_pages)]
        return None, [{"type": "blockquote", "content": content}]

    async def _quote(self, block, media, extra_pages):
        inline = _rich_text_to_inline((block.get("quote") or {}).get("rich_text"))
        content = [_para(inline), *await self._children_of(block, media, extra_pages)]
        return None, [{"type": "blockquote", "content": content}]

    async def _code(self, block, media, extra_pages):
        data = block.get("code") or {}
        text = "".join(rt.get("plain_text", "") for rt in data.get("rich_text") or [])
        language = data.get("language")
        if language in (None, "plain text"):
            language = None
        node = {
            "type": "codeBlock", "attrs": {"language": language},
            "content": [{"type": "text", "text": text}] if text else [],
        }
        nodes = [node]
        caption = _rich_text_to_inline(data.get("caption"))
        if caption:
            nodes.append(_para([_add_mark(n, "italic") for n in caption]))
        return None, nodes

    async def _divider(self, block, media, extra_pages):
        return None, [{"type": "horizontalRule"}]

    async def _table(self, block, media, extra_pages):
        has_header = bool((block.get("table") or {}).get("has_column_header"))
        row_blocks = await self._children_raw(block)
        table_rows = []
        for i, row_block in enumerate(row_blocks):
            if row_block.get("type") != "table_row":
                continue
            cells = (row_block.get("table_row") or {}).get("cells") or []
            cell_type = "tableHeader" if (has_header and i == 0) else "tableCell"
            row_nodes = [
                {"type": cell_type, "content": [_para(_rich_text_to_inline(cell))]} for cell in cells
            ]
            table_rows.append({"type": "tableRow", "content": row_nodes})
        if not table_rows:
            return None, [_text_para("[empty table]")]
        return None, [{"type": "table", "content": table_rows}]

    async def _children_raw(self, block: dict[str, Any]) -> list[dict[str, Any]]:
        """Like `_children_of`, but returns the raw block dicts uninverted
        instead of converted TipTap nodes — `table` needs `table_row`'s own
        `cells` data, not a recursive block-conversion of it (table_row is
        never independently dispatched)."""
        if not block.get("has_children"):
            return []
        return await self._fetch_children(block["id"])

    async def _child_database(self, block, media, extra_pages):
        database_id = block["id"]
        rows = await self._query_database(database_id)
        title = (block.get("child_database") or {}).get("title")
        heading = [{"type": "heading", "attrs": {"level": 3}, "content": [{"type": "text", "text": title}]}] if title else []

        if len(rows) <= _DATABASE_TABLE_MAX_ROWS:
            return None, [*heading, _database_table_node(rows)]

        # >50 rows -> per-row pages (spec: "wizard parity"). Leave a
        # navigable linked list in the parent's own body rather than a gap.
        link_items = []
        for row in rows:
            row_note = await self.convert_row_page(row, extra_pages)
            extra_pages.append(row_note)
            link_items.append({
                "type": "listItem",
                "content": [_para([{
                    "type": "text", "text": row_note["title"],
                    "marks": [{"type": "link", "attrs": {"href": f"{LINK_PREFIX}notion:{row_note['remote_id']}"}}],
                }])],
            })
        note_para = _text_para(f"({len(rows)} rows — imported as separate linked pages)")
        return None, [*heading, note_para, {"type": "bulletList", "content": link_items}]

    async def _child_page(self, block, media, extra_pages):
        title = (block.get("child_page") or {}).get("title") or "Untitled"
        page_id = block["id"]
        para = _para([{
            "type": "text", "text": title,
            "marks": [{"type": "link", "attrs": {"href": f"{LINK_PREFIX}notion:{page_id}"}}],
        }])
        return None, [para]

    async def _link_to_page(self, block, media, extra_pages):
        data = block.get("link_to_page") or {}
        target_id = data.get("page_id") or data.get("database_id")
        if not target_id:
            return None, [_unsupported_marker("link_to_page")]
        para = _para([{
            "type": "text", "text": "Linked page",
            "marks": [{"type": "link", "attrs": {"href": f"{LINK_PREFIX}notion:{target_id}"}}],
        }])
        return None, [para]

    async def _synced_block(self, block, media, extra_pages):
        data = block.get("synced_block") or {}
        synced_from = data.get("synced_from")
        if not synced_from:
            # This block IS the original — its content is its own children,
            # rendered inline with no wrapper (matches Notion's own display:
            # a synced_block is invisible chrome around its content).
            return None, await self._children_of(block, media, extra_pages)

        original_id = synced_from.get("block_id")
        if not original_id:
            return None, [_unsupported_marker("synced_block")]
        if original_id in self._synced_cache:
            return None, [copy.deepcopy(n) for n in self._synced_cache[original_id]]
        if original_id in self._synced_resolving:
            # Defensive — Notion data shouldn't form a synced_block cycle,
            # but resolving one must never hang a sync.
            return None, [_unsupported_marker("synced_block (cycle detected)")]

        self._synced_resolving.add(original_id)
        try:
            original_children = await self._fetch_children(original_id)
            resolved = await self._convert_blocks(original_children, media, extra_pages)
        finally:
            self._synced_resolving.discard(original_id)
        self._synced_cache[original_id] = resolved
        return None, [copy.deepcopy(n) for n in resolved]

    async def _column_list(self, block, media, extra_pages):
        # column_list -> sequential: TipTap has no side-by-side layout node
        # in the declared vocabulary, so every column's content is flattened
        # one after another, top to bottom.
        if not block.get("has_children"):
            return None, []
        columns = await self._fetch_children(block["id"])
        out: list[dict[str, Any]] = []
        for col in columns:
            if col.get("type") != "column" or not col.get("has_children"):
                continue
            col_children = await self._fetch_children(col["id"])
            out.extend(await self._convert_blocks(col_children, media, extra_pages))
        return None, out

    async def _equation_block(self, block, media, extra_pages):
        expr = (block.get("equation") or {}).get("expression") or ""
        node = {
            "type": "codeBlock", "attrs": {"language": None},
            "content": [{"type": "text", "text": expr}] if expr else [],
        }
        return None, [node]

    async def _media_block(self, block, media, extra_pages):
        btype = block["type"]
        resolution = await self._resolve_media(block)
        block_data = block.get(btype) or {}
        caption = _rich_text_to_inline(block_data.get("caption"))
        if resolution is None:
            name = None
            info = extract_media_info(block)
            if info is not None:
                name = info[2]
            nodes = [_text_para(f"[{btype} unavailable: {name or btype}]")]
            if caption:
                nodes.append(_para([_add_mark(n, "italic") for n in caption]))
            return None, nodes

        media.register(resolution)
        ref = resolution["ref"]
        if btype == "image":
            node = {"type": "image", "attrs": {"src": f"{REF_PREFIX}{ref}"}}
        else:
            node = {
                "type": "attachmentChip",
                "attrs": {"href": f"{REF_PREFIX}{ref}", "name": resolution.get("name"), "size": None},
            }
        nodes = [node]
        if caption:
            nodes.append(_para([_add_mark(n, "italic") for n in caption]))
        return None, nodes

    async def _external_link_block(self, block, media, extra_pages):
        btype = block["type"]
        data = block.get(btype) or {}
        url = data.get("url") or ""
        if not url:
            return None, [_unsupported_marker(btype)]
        caption = _rich_text_to_inline(data.get("caption"))
        text = "".join(n.get("text", "") for n in caption) or url
        para = _para([{"type": "text", "text": text, "marks": [{"type": "link", "attrs": {"href": url}}]}])
        return None, [para]

    async def _silent_drop(self, block, media, extra_pages):
        # table_of_contents / breadcrumb — Notion-UI-only navigational
        # blocks with no user content to preserve. Deliberate, not a gap;
        # see the module docstring.
        return None, []
