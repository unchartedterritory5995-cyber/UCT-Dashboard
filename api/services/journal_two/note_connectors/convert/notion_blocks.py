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
paragraph / heading_1-3 (+ toggleable -> toggle) /
bulleted_list_item / numbered_list_item / to_do -> taskItem / toggle ->
toggle / callout -> callout(+emoji) / quote /
code(+caption) / divider / table(+table_row) / child_database (<=50 rows ->
inline table, >50 -> per-row pages, spec's "wizard parity" threshold) /
child_page -> import-link:// / link_to_page -> import-link:// / synced_block
(resolve the original ONCE, cycle-guarded) / column_list -> sequential /
equation -> codeBlock-styled text / image·video·file·pdf·audio -> media
placeholders, EXCEPT an external video, which is never downloaded /
video·embed of an allow-listed player (`web_embed.embed_for`, the client's
YouTube/TradingView list) -> `webEmbed`, any other -> plain link (Plan A
Task 12) / bookmark·link_preview -> plain external link. A database table's
cells keep their links, labels and files (`_property_inline`), and a
`link_to_page` reads its target's title through the optional fourth
callable, `fetch_title`.
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
from .linkify import canonical_notion_page_id, notion_note_key, notion_page_id_from_href  # the ONE Notion page-link reader and key builder (Task 10/11)
from ...web_embed import embed_for  # the client's embed allow-list, ported (Task 12)
from ...media_policy import extension_mime  # the one extension -> type table (an image file cell shows inline)
from ...import_notice import notice_node  # what cannot come over is an importNotice block (Task 12 fix round 1)
from ..errors import NoteConnError

# spec §7: "<=50 rows -> table doc, >50 -> per-row pages (wizard parity)" —
# matches the wizard's own CSV_MAX_ROWS constant
# (app/src/pages/journal-2-0/lib/importer/adapters/notion.js).
_DATABASE_TABLE_MAX_ROWS = 50

FetchChildrenFn = Callable[[str], Awaitable[list[dict[str, Any]]]]
QueryDatabaseFn = Callable[[str], Awaitable[list[dict[str, Any]]]]
ResolveMediaFn = Callable[[dict[str, Any]], Awaitable[dict[str, Any] | None]]
FetchTitleFn = Callable[[str], Awaitable[str | None]]

_MEDIA_BLOCK_TYPES = ("image", "video", "file", "pdf", "audio")


class DatabaseRows(list):
    """A database query's rows, plus whether the query stopped at its cap before the database
    ran out (`truncated`). `query_database` may return a plain list (never truncated); the
    provider returns this when its bounded paging hit the cap, and the converter writes a
    `truncated` importNotice under the table so the member sees that rows are missing."""

    def __init__(self, rows=(), *, truncated: bool = False) -> None:
        super().__init__(rows)
        self.truncated = truncated


#: The most files one database `files` cell resolves (each may be a download during traversal).
#: The rest are named by one `truncated` notice in the cell.
_DATABASE_CELL_FILES_MAX = 20


def _notice(reason: str, name: str | None) -> dict[str, Any]:
    """A FINAL importNotice the converter writes itself (no ref: it holds no placeholder, so the
    engine never retries it; it lists it in the sync log, `engine._provider_notice_failures`)."""
    return notice_node(reason, name=name, source_url=None, ref=None, attempts=0)


def _final_notice(resolution: dict[str, Any] | None, name: str | None) -> dict[str, Any] | None:
    """The FINAL importNotice for a media resolution that is a definitive failure, else None
    (a success, or a retryable failure the provider deferred to the engine as a placeholder).

      * None (no address to fetch at all)          -> `missing_resource`
      * `{"too_large": True}` (over the source cap) -> `too_large`
      * `{"final": <reason>}` (gone, refused, unsafe) -> that reason
    """
    if resolution is None:
        return _notice("missing_resource", name)
    label = resolution.get("name") or name
    if resolution.get("too_large"):
        return _notice("too_large", label)
    reason = resolution.get("final")
    if isinstance(reason, str) and reason:
        return _notice(reason, label)
    return None


# ── small pure helpers (no I/O; independently testable) ─────────────────────

def extract_media_info(block: dict[str, Any]) -> tuple[str, bool, str] | None:
    """`(url, is_external, name)` for an image/video/file/pdf/audio block, or
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
    return page_title_or_none(page) or "Untitled"


def page_title_or_none(page: Any) -> str | None:
    """The page's title text, or None when it has none (`extract_title` without the fallback;
    `link_to_page` reads it through `fetch_title` so an untitled target says "Linked page")."""
    if not isinstance(page, dict):
        return None
    for prop in (page.get("properties") or {}).values():
        if not isinstance(prop, dict) or prop.get("type") != "title":
            continue
        text = "".join(rt.get("plain_text", "") for rt in prop.get("title") or [] if isinstance(rt, dict))
        if text:
            return text
    return None


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


#: Property types whose value is an address: the scheme its link gets ("" = the value is the URL).
_LINKED_PROPERTY_SCHEMES = {"url": "", "email": "mailto:", "phone_number": "tel:"}


def _link_mark(href: str) -> dict[str, Any]:
    return {"type": "link", "attrs": {"href": href}}


def _property_inline(prop: Any, *, row_id: str, file_nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """ONE database cell's content (N-8): what a member could click in Notion stays clickable.

      * `url` / `email` / `phone_number` -> the value as linked text (`mailto:` / `tel:`). The
        engine's link policy still decides the href, so an unsafe scheme stays text.
      * `rich_text` / `title` -> `_rich_text_to_inline`, hrefs and marks kept. A `title` cell
        additionally links to the row's own note (`import-link://notion:<row_id>`), as Notion
        opens the row from its title; an untitled row still links, as "Untitled".
      * `files` -> `file_nodes`, the cell's files already resolved by `_child_database` (an image
        inline, any other file a chip, a file that could not come over a named marker). With no
        resolved nodes, the file names as text.
      * everything else (select / status / multi_select labels, numbers, dates, ...) -> today's
        `_property_plain_text`, so a label is always visible text (N-9).
    Returns inline text nodes, plus BLOCK nodes for files; `_cell_content` lays them out."""
    if not isinstance(prop, dict):
        return []
    t = prop.get("type")
    if t in _LINKED_PROPERTY_SCHEMES:
        value = prop.get(t)
        if not isinstance(value, str) or not value.strip():
            return []
        value = value.strip()
        target = "".join(value.split()) if t == "phone_number" else value
        return [{"type": "text", "text": value, "marks": [_link_mark(_LINKED_PROPERTY_SCHEMES[t] + target)]}]
    if t in ("rich_text", "title"):
        inline = _rich_text_to_inline(prop.get(t))
        if t != "title":
            return inline
        href = f"{LINK_PREFIX}{notion_note_key(row_id)}"
        inline = inline or [{"type": "text", "text": "Untitled"}]
        out = []
        for node in inline:
            marks = list(node.get("marks") or [])
            if not any(m.get("type") == "link" for m in marks):
                node = {**node, "marks": [*marks, _link_mark(href)]}
            out.append(node)
        return out
    if t == "files" and file_nodes:
        return list(file_nodes)
    text = _property_plain_text(prop)
    return [{"type": "text", "text": text}] if text else []


def _cell_content(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """A table cell holds blocks: runs of inline text become paragraphs, block nodes (an image,
    an attachment chip, a marker paragraph) stand on their own. Never empty."""
    out: list[dict[str, Any]] = []
    run: list[dict[str, Any]] = []
    for node in nodes:
        if node.get("type") == "text":
            run.append(node)
            continue
        if run:
            out.append(_para(run))
            run = []
        out.append(node)
    if run:
        out.append(_para(run))
    return out or [_text_para("")]


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
            href = _mention_href(rt, mention)
            if href and text:
                marks = _annotations_to_marks(rt.get("annotations") or {})
                marks.append({"type": "link", "attrs": {"href": href}})
                items.append({"type": "text", "text": text, "marks": marks})
                continue
            # A user/date/template mention, or one with no URL to point at,
            # degrades to its plain text — never dropped.
            if text:
                items.append({"type": "text", "text": text})
            continue

        # Plain "text" rich_text item.
        marks = _annotations_to_marks(rt.get("annotations") or {})
        href = rt.get("href")
        if href:
            marks.append({"type": "link", "attrs": {"href": _text_href(href)}})
        if text:
            items.append({"type": "text", "text": text, "marks": marks} if marks else {"type": "text", "text": text})
    return items


def _text_href(href: str) -> str:
    """A link Notion wrote: one naming a Notion page (a workspace-relative `/<id>`, a
    notion.so / notion.site / notion:// URL) becomes the pending `import-link://notion:<id>`
    (spec N-4) — the engine's link-key pass turns it into the imported note, and an
    unresolved one opens notion.so meanwhile (N-5). Every other href is kept as written;
    the engine's link policy (Task 10) decides it."""
    page_id = notion_page_id_from_href(href)
    return f"{LINK_PREFIX}{notion_note_key(page_id)}" if page_id else href


def _mention_href(rt: dict[str, Any], mention: dict[str, Any]) -> str | None:
    """Where a mention points, or None for one that is only text (user, date, template)."""
    kind = mention.get("type")
    if kind == "page":
        page_id = (mention.get("page") or {}).get("id")
        return f"{LINK_PREFIX}{notion_note_key(page_id)}" if page_id else None
    if kind == "link_mention":
        href = (mention.get("link_mention") or {}).get("href")
    elif kind == "link_preview":
        href = (mention.get("link_preview") or {}).get("url")
    elif kind == "database":
        # Databases are not notes: Notion's own URL for it, never a pending note link.
        href = rt.get("href")
        return href if isinstance(href, str) and href else None
    else:
        return None
    return _text_href(href) if isinstance(href, str) and href else None


def _unsupported_marker(block_type: str | None) -> dict[str, Any]:
    label = block_type or "unknown"
    return {"type": "paragraph", "content": [{"type": "text", "text": f"[unsupported block: {label}]"}]}


def _para(inline: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "paragraph", "content": inline}


def _text_para(text: str) -> dict[str, Any]:
    return {"type": "paragraph", "content": [{"type": "text", "text": text}] if text else []}


def notion_page_url(page_id: str) -> str:
    """The page's own notion.so address (`https://www.notion.so/<32 hex>`), the words a page
    link reads as when its title could not be read this time."""
    canonical = canonical_notion_page_id(page_id)
    return f"https://www.notion.so/{str(canonical).replace('-', '')}"


def _link_para(url: str, caption: list[dict[str, Any]]) -> dict[str, Any]:
    """An external page as one linked paragraph: the caption's text, else the URL itself."""
    text = "".join(n.get("text", "") for n in caption) or url
    return _para([{"type": "text", "text": text, "marks": [_link_mark(url)]}])


def _embed_or_link(url: str, caption: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """A video/embed URL (I-4): a `webEmbed` when the client's allow-list would embed it (the
    same `{provider, ref, url}` node a member's paste builds; the player is rebuilt from
    provider + ref on render), the caption italic beneath; anything else a plain link."""
    match = embed_for(url)
    if match is None:
        return [_link_para(url, caption)]
    provider, ref = match
    nodes = [{"type": "webEmbed", "attrs": {"provider": provider, "ref": ref, "url": url}}]
    if caption:
        nodes.append(_para([_add_mark(n, "italic") for n in caption]))
    return nodes


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


def _database_table_node(
    rows: list[dict[str, Any]],
    file_nodes: dict[tuple[str, str], list[dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    """<=50-row database -> one inline TipTap `table`. Column order: the
    title-typed property first, then the rest of the FIRST row's own
    property key order (alphabetical tiebreak keeps it deterministic for
    same-shaped rows) — every row is rendered against that SAME column
    set, missing values simply blank. Each cell is `_property_inline`;
    `file_nodes` maps `(row id, column)` to that `files` cell's resolved
    nodes (`_child_database` builds it)."""
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
        row_id = row.get("id")
        cells = []
        for c in columns:
            nodes = _property_inline(props.get(c), row_id=row_id,
                                     file_nodes=(file_nodes or {}).get((row_id, c)) or [])
            cells.append({"type": "tableCell", "content": _cell_content(nodes)})
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
        resolve_media: ResolveMediaFn, fetch_title: FetchTitleFn | None = None,
    ) -> None:
        self._fetch_children = fetch_children
        self._query_database = query_database
        self._resolve_media = resolve_media
        # `link_to_page` reads its target's title through this (None, or a None answer, keeps
        # "Linked page"). The provider memoises it, so a target costs at most one call per batch.
        self._fetch_title = fetch_title
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
            "audio": self._media_block,
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
            # Same reasoning as _toggle above: Notion's own markdown export
            # renders a toggleable heading as <details><summary>, so the
            # file-import lane already produces a toggle here. Emitting a
            # blockquote would leave this one block type diverging between the
            # two lanes. The heading LEVEL is lost either way -- <summary>
            # cannot hold a heading node, and the file lane loses it too --
            # so this trades styling metadata for the two lanes agreeing.
            return None, [self._toggle_node(inline, children_nodes)]
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

    # ⛔ These used to degrade to a blockquote with a bold first line, because
    # when this connector was written the editor had no callout or toggle node
    # to target. It has both now (2026-09-02, `lib/calloutNode.js` /
    # `lib/toggleNode.js`), and the FILE-import lane maps Notion's exported
    # `<aside>` / `<details>` straight onto them. Leaving these as blockquotes
    # would mean the SAME Notion page lands in two different shapes depending
    # on whether the member connected their account or dropped a zip -- one
    # grammar, two implementations, which is the defect shape this codebase
    # keeps paying for. Both lanes now produce the same nodes.
    async def _toggle(self, block, media, extra_pages):
        return None, [self._toggle_node(
            _rich_text_to_inline((block.get("toggle") or {}).get("rich_text")),
            await self._children_of(block, media, extra_pages),
        )]

    async def _callout(self, block, media, extra_pages):
        data = block.get("callout") or {}
        icon = data.get("icon") or {}
        emoji = icon.get("emoji") if icon.get("type") == "emoji" else None
        # The emoji is the member's own content carried over from Notion, not
        # UI chrome. `calloutNode` defaults it to 💡 when absent, so only send
        # the attribute when Notion actually gave us one.
        content = [_para(_rich_text_to_inline(data.get("rich_text"))),
                   *await self._children_of(block, media, extra_pages)]
        node = {"type": "callout", "content": content}
        if emoji:
            node["attrs"] = {"emoji": emoji}
        return None, [node]

    @staticmethod
    def _toggle_node(summary_inline, children_nodes):
        """`toggle` is `toggleSummary toggleContent` (see lib/toggleNode.js).
        `toggleContent` is `block+`, so an empty toggle still needs one
        paragraph or the document fails schema validation on load -- an empty
        toggle is a real thing a member can create in Notion."""
        return {
            "type": "toggle",
            "content": [
                {"type": "toggleSummary", "content": summary_inline},
                {"type": "toggleContent",
                 "content": children_nodes or [_para([])]},
            ],
        }

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
        # A query that stopped at its cap says so, under the table or the row list: never a
        # database that silently lost its tail. The count rides in the notice's name.
        notice = ([_notice("truncated", f"the first {len(rows)} rows of {title or 'this database'}")]
                  if getattr(rows, "truncated", False) else [])

        if len(rows) <= _DATABASE_TABLE_MAX_ROWS:
            file_nodes = await self._database_file_nodes(rows, media)
            return None, [*heading, _database_table_node(rows, file_nodes), *notice]

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
                    "marks": [{"type": "link", "attrs": {"href": f"{LINK_PREFIX}{notion_note_key(row_note['remote_id'])}"}}],
                }])],
            })
        note_para = _text_para(f"({len(rows)} rows — imported as separate linked pages)")
        return None, [*heading, note_para, {"type": "bulletList", "content": link_items}, *notice]

    async def _database_file_nodes(
        self, rows: list[dict[str, Any]], media: _Media,
    ) -> dict[tuple[str, str], list[dict[str, Any]]]:
        """Every `files` cell's files, resolved through the SAME `resolve_media` door a media
        block uses (so a Notion-hosted file is downloaded now, before its signed URL expires, and
        a hotlink is copied by the engine later) and registered on this note's media. Bounded by
        the table (at most `_DATABASE_TABLE_MAX_ROWS` rows) and per cell (at most
        `_DATABASE_CELL_FILES_MAX` files; the rest are one `truncated` notice in the cell). The
        synthesized block's id `<row id>:<column>:<i>` is unique per file, and its `_synthetic`
        flag tells the provider there is no real block behind it."""
        out: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for row in rows:
            row_id = row.get("id")
            for column, prop in (row.get("properties") or {}).items():
                if not isinstance(prop, dict) or prop.get("type") != "files":
                    continue
                items = [(i, item) for i, item in enumerate(prop.get("files") or []) if isinstance(item, dict)]
                nodes: list[dict[str, Any]] = []
                for i, item in items[:_DATABASE_CELL_FILES_MAX]:
                    nodes.append(await self._file_cell_node(f"{row_id}:{column}:{i}", item, media))
                if len(items) > _DATABASE_CELL_FILES_MAX:
                    nodes.append(_notice(
                        "truncated", f"the first {_DATABASE_CELL_FILES_MAX} of {len(items)} files in {column}"))
                if nodes:
                    out[(row_id, column)] = nodes
        return out

    async def _file_cell_node(self, block_id: str, item: dict[str, Any], media: _Media) -> dict[str, Any]:
        kind = item.get("type")
        data = item.get(kind) if isinstance(kind, str) else None
        url = data.get("url") if isinstance(data, dict) else None
        name = item.get("name") or (_basename_from_url(url) if isinstance(url, str) and url else "file")
        btype = "image" if (extension_mime(name) or "").startswith("image/") else "file"
        resolution = await self._resolve_media({"type": btype, "id": block_id, "_synthetic": True, btype: item})
        # The provider answers a TRANSIENT download failure with a deferred entry (a placeholder
        # the engine's media pass turns into a counted, retried `fetch_failed` notice). A
        # definitive one is a final notice here.
        final = _final_notice(resolution, name)
        if final is not None:
            return final
        media.register(resolution)
        return self._media_node(btype, resolution)

    @staticmethod
    def _media_node(btype: str, resolution: dict[str, Any]) -> dict[str, Any]:
        ref = resolution["ref"]
        if btype == "image":
            return {"type": "image", "attrs": {"src": f"{REF_PREFIX}{ref}"}}
        return {
            "type": "attachmentChip",
            "attrs": {"href": f"{REF_PREFIX}{ref}", "name": resolution.get("name"), "size": None},
        }

    async def _child_page(self, block, media, extra_pages):
        title = (block.get("child_page") or {}).get("title") or "Untitled"
        page_id = block["id"]
        para = _para([{
            "type": "text", "text": title,
            "marks": [{"type": "link", "attrs": {"href": f"{LINK_PREFIX}{notion_note_key(page_id)}"}}],
        }])
        return None, [para]

    async def _link_to_page(self, block, media, extra_pages):
        data = block.get("link_to_page") or {}
        target_id = data.get("page_id") or data.get("database_id")
        if not target_id:
            return None, [_unsupported_marker("link_to_page")]
        # The target's own title, as Notion shows it (N-8). A database target, a target the
        # integration cannot read (`fetch_title` answers None), or no reader at all keeps
        # "Linked page". A TRANSIENT failure (rate limit, 5xx) raises instead: the link then
        # reads as its own Notion address -- never a generic label frozen in by the skip gate.
        label = None
        if data.get("page_id") and self._fetch_title is not None:
            try:
                label = await self._fetch_title(target_id)
            except NoteConnError:
                label = notion_page_url(target_id)
        para = _para([{
            "type": "text", "text": label if isinstance(label, str) and label.strip() else "Linked page",
            "marks": [{"type": "link", "attrs": {"href": f"{LINK_PREFIX}{notion_note_key(target_id)}"}}],
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
        block_data = block.get(btype) or {}
        caption = _rich_text_to_inline(block_data.get("caption"))
        if btype == "video":
            info = extract_media_info(block)
            if info is not None and info[1]:
                # An external video is a page, not a file (I-4): never downloaded. An
                # allow-listed one plays in the note; any other is its link.
                return None, _embed_or_link(info[0], caption)
        resolution = await self._resolve_media(block)
        # Fix round 2 (ruling): a DEFINITIVE failure is a final importNotice here; a retryable one
        # arrives as an ordinary (byte-less) resolution and stays a placeholder for the engine.
        info = extract_media_info(block)
        final = _final_notice(resolution, info[2] if info is not None else btype)
        if final is not None:
            nodes = [final]
            if caption:
                nodes.append(_para([_add_mark(n, "italic") for n in caption]))
            return None, nodes

        media.register(resolution)
        nodes = [self._media_node(btype, resolution)]
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
        if btype == "embed":
            # An embed of an allow-listed player plays in the note (I-4). Bookmarks and link
            # previews stay links: there is no metadata here to fill a preview card.
            return None, _embed_or_link(url, caption)
        return None, [_link_para(url, caption)]

    async def _silent_drop(self, block, media, extra_pages):
        # table_of_contents / breadcrumb — Notion-UI-only navigational
        # blocks with no user content to preserve. Deliberate, not a gap;
        # see the module docstring.
        return None, []
