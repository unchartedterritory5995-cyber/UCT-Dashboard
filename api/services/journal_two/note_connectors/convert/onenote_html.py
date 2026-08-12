"""OneNote page HTML -> TipTap JSON, server-side (Task 5, note-connectors).

`GET /me/onenote/pages/{id}/content?includeIDs=true` (Task 6's
`providers/onenote.py::fetch`) returns HTML, so a OneNote page routes through
the SAME `mddoc.html_to_tiptap` walker every other HTML-sourced connector
uses (Dropbox's `.html` path today) — but OneNote's own HTML dialect encodes
three things `html_to_tiptap`'s declared vocabulary has no notion of. This
module is a STRING-LEVEL pre-pass that rewrites those three OneNote idioms
into forms `html_to_tiptap` (or its ONE additive taskList branch, added
alongside this module — see `mddoc.py::_html_list_or_tasklist`) already
understands, then delegates:

  - **to-do tags** — `<p data-tag="to-do">`/`<p data-tag="to-do:completed">`
    (or the same `data-tag` on an existing `<li>`, when OneNote already had
    the paragraph inside a list) mark a checkbox line. Rewritten to
    `<li data-uct-task="0"|"1">`, wrapped in a fresh `<ul>` for the `<p>`
    case (OneNote never puts a checkbox paragraph inside a list of its own)
    or rewritten in place for the `<li>` case (it already has a list
    parent). `html_to_tiptap`'s taskList branch turns that marker into
    `taskList`/`taskItem(checked=bool)`.
  - **embedded resource images** — `<img src="https://graph.microsoft.com/
    .../onenote/resources/{id}/$value" data-fullres-src="...">`. Both URLs
    point at a Graph endpoint this converter has no credentials to fetch
    (Task 6's `fetch_media` does that, authenticated, off the `onenote-res://
    {id}` scheme this rewrite produces) — so the `<img>` is rewritten to
    `<img src="{REF_PREFIX}onenote-res://{id}">` up front, and a media entry
    is registered directly (skipping `html_to_tiptap`'s own registration,
    which only fires for a src it DOESN'T already recognize as a placeholder
    — see `_image_node`'s "already a connector-supplied placeholder" rule,
    the same convention every other connector's pre-registered ref relies
    on). The fullres id is preferred when both `src` and `data-fullres-src`
    resolve to a resource id (higher-quality variant).
  - **file attachments** — `<object data-attachment="name" data="...{id}...">`
    rewrites to `<a href="{ATTACHMENT_REF_PREFIX}onenote-res://{id}">name</a>`
    — `html_to_tiptap` ALREADY knows this prefix (Dropbox's `.html` path uses
    it too, see `providers/dropbox.py::_resolve_relative_attachments_html`)
    and turns it into a real `attachmentChip` node + registers its own media
    entry. **One gap needs a post-pass fix-up, though:** that shared handling
    derives the chip's `name` from the REF's own basename — correct for
    Dropbox (a real relative file path ending in the filename) but useless
    for OneNote's opaque `onenote-res://{id}` ref (the id is not a filename).
    `_rewrite_attachment_objects` returns an id->name map and
    `_apply_attachment_names`/`_apply_attachment_media_names` patch the real
    name into the chip node + its media entry after `html_to_tiptap` runs —
    the same "post-process the already-built doc" shape as Dropbox's own
    `_promote_md_attachments`, just for a different mismatch.

**`position:absolute` wrapper `<div>`s need no code at all.** OneNote wraps
page content (each "outline"/text-box) in an absolutely-positioned `<div>`,
but `html_to_tiptap`'s tree builder already unwraps EVERY `<div>` to its
children unconditionally (`div` is not in `mddoc._HTML_KNOWN_TAGS` — see that
module's own comment on `_unwrap_unknown_html`), regardless of its `style`.
This module relies on that existing, generic behavior rather than
duplicating it.

**Regex, not a second DOM walker.** Every pre-pass rule targets one
OneNote-specific idiom on its OWN element — never multi-element structural
reasoning (that's `mddoc._HtmlDomBuilder`'s job, run afterward). The to-do
rewrite still depth-matches an opening `<p>`/`<li>` against its OWN closing
tag (not a naive "next `</p>`") so a to-do `<li>` that itself contains a
nested `<ul><li>` sub-list is not truncated at the sub-list's close tag.

**External images are untouched, by construction.** An `<img src="https://
...">` whose `src`/`data-fullres-src` don't resolve to a `.../onenote/
resources/{id}/...` path simply never matches the resource-image rewrite —
it flows into `html_to_tiptap` exactly like any other external image from
any other connector's HTML (wrapped in a plain `import-ref://` placeholder
carrying the raw URL, resolved later, unauthenticated). No `onenote-res://`
prefix is ever applied to it.

**Known, deliberate simplification:** multiple STANDALONE to-do paragraphs
(OneNote's normal shape for consecutive checkbox lines — each its own
`<p data-tag="to-do">`, not pre-grouped into one `<ul>`) each become their
OWN single-item `<ul>`/taskList, rather than being merged into one shared
checklist. Each item's text and checked state is still correct; a page with
five consecutive checkbox lines renders as five adjacent one-item task
lists rather than one five-item list. Cross-paragraph merging was left out
deliberately: a generic "merge adjacent `<ul>`s" pass would also merge two
UNRELATED author-written lists that happen to be adjacent elsewhere on the
page, which is worse than the visual difference it would fix.

Spec: `.superpowers/sdd/2026-08-12-note-connectors-msgraph/task-5-brief.md`.
"""

from __future__ import annotations

import re
from html import unescape as _html_unescape  # aliased: every function below
# uses `html` as its own parameter name (the page content string), which
# would otherwise shadow a bare `import html` module reference.
from typing import Any

from . import ATTACHMENT_REF_PREFIX, REF_PREFIX
from .mddoc import html_to_tiptap

_ONENOTE_RES_SCHEME = "onenote-res://"

# ---------------------------------------------------------------------------
# small shared helpers
# ---------------------------------------------------------------------------


def _attr_value(text: str, name: str) -> str | None:
    """First `name="value"` occurrence in `text` (double-quoted only — every
    OneNote/Graph-generated attribute in practice is; a single-quoted or
    unquoted attribute is outside this pre-pass's scope, same tolerance
    level `providers/dropbox.py`'s own regex helpers assume)."""
    m = re.search(rf'\b{re.escape(name)}\s*=\s*"(?P<value>[^"]*)"', text, re.IGNORECASE)
    return m.group("value") if m else None


# A OneNote resource URL always contains this path segment; the resource id
# is everything between it and the next `/`, `?`, or closing quote — e.g.
# `.../onenote/resources/0-abc123!1-def456/$value?fullSize=true` -> the id
# is `0-abc123!1-def456`. Deliberately does NOT anchor on `graph.microsoft.
# com` — some tenants proxy through a different host but the `/onenote/
# resources/{id}/` path shape is the stable part.
_RESOURCE_ID_RE = re.compile(r"onenote/resources/(?P<rid>[^/?\"']+)", re.IGNORECASE)


def _resource_id_from_url(url: str | None) -> str | None:
    if not url:
        return None
    m = _RESOURCE_ID_RE.search(url)
    return m.group("rid") if m else None


def _register(media: list[dict[str, Any]], media_refs: set[str], ref: str, kind: str, name: str) -> None:
    """Mirrors `mddoc._register_media`'s dedup-by-ref discipline (the SAME
    resource referenced twice — e.g. `src` and `data-fullres-src` resolving
    to the same id — must not produce two media entries)."""
    if ref in media_refs:
        return
    media_refs.add(ref)
    media.append({"ref": ref, "kind": kind, "name": name})


# ---------------------------------------------------------------------------
# to-do rewrite: <p data-tag="to-do[:completed]"> / <li data-tag="..."> ->
# <ul><li data-uct-task="0|1">...</li></ul>  /  <li data-uct-task="0|1">...
# ---------------------------------------------------------------------------

_DATA_TAG_RE = re.compile(r'\bdata-tag\s*=\s*"to-do(?P<completed>:completed)?"', re.IGNORECASE)


def _tag_events(html: str, tag: str) -> list[tuple[bool, "re.Match[str]"]]:
    """Every opening (`is_open=True`, `match.group('attrs')` holds the raw
    attribute text) or closing occurrence of `tag`, in document order —
    the primitive `_rewrite_todo_elements` depth-matches over, so an open
    tag is paired with its OWN close tag even when the SAME tag nests
    (a to-do `<li>` containing a nested `<ul><li>` sub-list)."""
    pattern = re.compile(rf"<{tag}\b(?P<attrs>[^>]*)>|</{tag}\s*>", re.IGNORECASE)
    events: list[tuple[bool, "re.Match[str]"]] = []
    for m in pattern.finditer(html):
        is_open = m.group(0)[1] != "/"
        events.append((is_open, m))
    return events


def _rewrite_todo_elements(html: str, tag: str, *, wrap_ul: bool) -> str:
    events = _tag_events(html, tag)
    out: list[str] = []
    pos = 0
    i = 0
    n = len(events)
    while i < n:
        is_open, m = events[i]
        if not is_open:
            i += 1
            continue
        tag_match = _DATA_TAG_RE.search(m.group("attrs"))
        if tag_match is None:
            i += 1
            continue
        # Depth-match this open tag to its OWN close tag among same-tag events.
        depth = 1
        j = i + 1
        while j < n and depth > 0:
            depth += 1 if events[j][0] else -1
            j += 1
        if depth != 0:
            # Unbalanced markup (no matching close found) -- leave this
            # occurrence untouched rather than risk corrupting the document.
            i += 1
            continue
        close_match = events[j - 1][1]
        content = html[m.end():close_match.start()]
        checked = "1" if tag_match.group("completed") else "0"
        out.append(html[pos:m.start()])
        if wrap_ul:
            out.append(f'<ul><li data-uct-task="{checked}">{content}</li></ul>')
        else:
            out.append(f'<{tag} data-uct-task="{checked}">{content}</{tag}>')
        pos = close_match.end()
        i = j
    out.append(html[pos:])
    return "".join(out)


def _rewrite_todos(html: str) -> str:
    html = _rewrite_todo_elements(html, "p", wrap_ul=True)
    html = _rewrite_todo_elements(html, "li", wrap_ul=False)
    return html


# ---------------------------------------------------------------------------
# resource image rewrite: <img src=... data-fullres-src=...> (a onenote
# resource) -> <img src="{REF_PREFIX}onenote-res://{id}"> + a media entry.
# An external (non-resource) <img> is matched but returned untouched.
# ---------------------------------------------------------------------------

_IMG_TAG_RE = re.compile(r"<img\b[^>]*/?>", re.IGNORECASE)


def _rewrite_resource_images(html: str, media: list[dict[str, Any]], media_refs: set[str]) -> str:
    def repl(m: "re.Match[str]") -> str:
        tag_text = m.group(0)
        src = _attr_value(tag_text, "src")
        fullres = _attr_value(tag_text, "data-fullres-src")
        resource_id = _resource_id_from_url(fullres) or _resource_id_from_url(src)
        if resource_id is None:
            return tag_text  # not a onenote resource -- external image, left as-is
        ref = f"{_ONENOTE_RES_SCHEME}{resource_id}"
        _register(media, media_refs, ref=ref, kind="image", name=resource_id)
        return f'<img src="{REF_PREFIX}{ref}">'

    return _IMG_TAG_RE.sub(repl, html)


# ---------------------------------------------------------------------------
# attachment rewrite: <object data-attachment="name" data="...{id}..."> ->
# <a href="{ATTACHMENT_REF_PREFIX}onenote-res://{id}">name</a>. html_to_tiptap
# already turns an ATTACHMENT_REF_PREFIX href into a real attachmentChip node
# + registers its own media entry -- no extra code needed for that half.
#
# ONE gap that DOES need fixing up afterward: mddoc.py's generic
# ATTACHMENT_REF_PREFIX handling (shared with Dropbox, which this module may
# not modify — the taskList branch is the only mddoc.py change in scope)
# derives the chip's `name` attr from the REF's own basename
# (`_basename(ref)` in `mddoc._html_inline_walk`). That's correct for
# Dropbox, whose ref is a real relative file PATH ending in the filename —
# but OneNote's ref is an opaque `onenote-res://{resourceId}`, so a naive
# basename would just be the resourceId, not the attachment's real name. This
# function returns the id->name map so `onenote_html_to_tiptap` can patch the
# chip (and its media entry) afterward — the exact same shape as Dropbox's
# own `_promote_md_attachments` post-processing pass over `md_to_tiptap`'s
# output, just for a different mismatch.
# ---------------------------------------------------------------------------

_OBJECT_OPEN_RE = re.compile(r"<object\b(?P<attrs>[^>]*?)(?P<selfclose>/?)>", re.IGNORECASE)
_OBJECT_CLOSE_RE = re.compile(r"</object\s*>", re.IGNORECASE)


def _rewrite_attachment_objects(html: str, names: dict[str, str]) -> str:
    out: list[str] = []
    pos = 0
    for m in _OBJECT_OPEN_RE.finditer(html):
        if m.start() < pos:
            continue  # already consumed as part of a previous match's own span
        attrs = m.group("attrs")
        raw_name = _attr_value(attrs, "data-attachment")
        data_url = _attr_value(attrs, "data")
        resource_id = _resource_id_from_url(data_url) if data_url else None
        if raw_name is None or resource_id is None:
            continue  # not a recognized onenote attachment object -- leave untouched
        end = m.end()
        if not m.group("selfclose"):
            close = _OBJECT_CLOSE_RE.search(html, end)
            if close is not None:
                end = close.end()
        # `raw_name` is still HTML-attribute-escaped (e.g. a literal `&amp;`)
        # -- fine to re-embed as-is (attribute and text-content escaping use
        # the same entity rules), but the id->name map used for the LATER
        # attrs-object patch must hold the DECODED display string.
        out.append(html[pos:m.start()])
        out.append(f'<a href="{ATTACHMENT_REF_PREFIX}{_ONENOTE_RES_SCHEME}{resource_id}">{raw_name}</a>')
        pos = end
        names[resource_id] = _html_unescape(raw_name)
    out.append(html[pos:])
    return "".join(out)


def _apply_attachment_names(node: Any, names: dict[str, str]) -> None:
    """Post-processes an already-built TipTap doc tree in place, patching
    every `attachmentChip` whose href resolves to a known OneNote resource
    id with the REAL filename captured during the attachment pre-pass (see
    `_rewrite_attachment_objects`'s docstring for why mddoc.py's own
    basename-derived name is wrong for this connector). Safe to mutate in
    place -- `node` is `html_to_tiptap`'s freshly built, unshared result."""
    if not isinstance(node, dict):
        return
    if node.get("type") == "attachmentChip":
        href = (node.get("attrs") or {}).get("href", "")
        ref = href[len(REF_PREFIX):] if href.startswith(REF_PREFIX) else href
        if ref.startswith(_ONENOTE_RES_SCHEME):
            resource_id = ref[len(_ONENOTE_RES_SCHEME):]
            real_name = names.get(resource_id)
            if real_name is not None:
                node["attrs"]["name"] = real_name
    for child in node.get("content") or []:
        _apply_attachment_names(child, names)


def _apply_attachment_media_names(media: list[dict[str, Any]], names: dict[str, str]) -> None:
    for entry in media:
        ref = entry.get("ref", "")
        if entry.get("kind") == "file" and ref.startswith(_ONENOTE_RES_SCHEME):
            real_name = names.get(ref[len(_ONENOTE_RES_SCHEME):])
            if real_name is not None:
                entry["name"] = real_name


# ---------------------------------------------------------------------------
# public entry point
# ---------------------------------------------------------------------------


def onenote_html_to_tiptap(html: str | None) -> dict[str, Any]:
    """Convert one OneNote page's HTML content into `{doc, media, links}` —
    same shape as `mddoc.md_to_tiptap`/`html_to_tiptap`, so `providers/
    onenote.py::fetch` (Task 6) can treat it identically to every other
    converter's output.

    Order: to-dos, then resource images, then attachments, then delegate.
    The three passes touch disjoint syntax (`<p>`/`<li>` attributes vs.
    `<img>` tags vs. `<object>` tags) so their order doesn't matter to each
    OTHER, but delegating to `html_to_tiptap` must come last — it's the only
    step that understands `data-uct-task` and `{REF,ATTACHMENT_REF}_PREFIX`.
    """
    text = html or ""
    text = _rewrite_todos(text)

    media: list[dict[str, Any]] = []
    media_refs: set[str] = set()
    text = _rewrite_resource_images(text, media, media_refs)
    attachment_names: dict[str, str] = {}
    text = _rewrite_attachment_objects(text, attachment_names)

    result = html_to_tiptap(text)

    # Merge our own pre-registered resource-image entries with whatever
    # html_to_tiptap registered on its own walk (attachment media via its
    # generic ATTACHMENT_REF_PREFIX handling, plus any external image left
    # untouched above) -- deduped by ref, mirroring `_register_media`'s
    # guard everywhere else in this package.
    for entry in result["media"]:
        ref = entry.get("ref")
        if ref in media_refs:
            continue
        media_refs.add(ref)
        media.append(entry)

    # Patch the resourceId-derived attachment names (see
    # `_rewrite_attachment_objects`'s docstring) into both the chip nodes
    # and their media entries, now that html_to_tiptap has built them.
    if attachment_names:
        _apply_attachment_names(result["doc"], attachment_names)
        _apply_attachment_media_names(media, attachment_names)

    return {"doc": result["doc"], "media": media, "links": result["links"]}
