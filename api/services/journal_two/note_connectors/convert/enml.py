"""ENML -> TipTap JSON, server-side (Plan E Task 3, Evernote live sync).

`get_note` returns a note's body as ENML in `structuredContent.content` and its attachments as
`structuredContent.resources` (`{id, hash (md5), mime, name, sizeBytes}`, or `null` when there are
none). This module ports the `.enex` adapter's rules (`app/src/pages/journal-2-0/lib/importer/
adapters/evernote.js`) one for one, so a note looks the same whether it arrived by file or by sync.

Shape: an `html.parser`-level pre-pass builds a small tree of the ENML (never `xml.etree`: ENML
carries XHTML entities such as `&nbsp;` that a strict XML parser rejects), rewrites it, serialises
it back to HTML and hands that to `mddoc.html_to_tiptap`, the walker every HTML connector uses.
A short post-pass then does the two things HTML cannot carry: the `missing_resource` notices and
the attachment chips' real names.

Rules, in order (the brief's numbering):
 1. Strip the prolog; work inside `<en-note>`.
 2. `<en-crypt>` -> `<p>[encrypted content — cannot be imported]</p>`.
 3. Note links (the client's `isEvernoteNoteHref`): a GUID href -> `LINK_PREFIX +
    live_import_key(guid)`, every child kept; any other note link -> `LINK_PREFIX +
    "evernote-title:" + <its text>` (the key `link_keys` heals); with no text it becomes its content.
 4. `<en-media hash type>` against `resources` by hash: an image -> `<img src=REF_PREFIX+ref>`,
    anything else -> an attachment chip named from the resource. A hash that matches nothing
    pairs with an uncited resource only when unambiguous (the client's `unambiguousPairs`);
    otherwise an importNotice `missing_resource` IN PLACE. Content nested inside an
    `<en-media>` is unwrapped after it.
 5. `<div>`s carrying `<en-todo checked>` group into one `<ul><li data-uct-task="0|1">` run.
 6. Resources nothing cited are appended at the end; duplicate hashes collapse first-wins.
 7. An http(s) `source_url` (not our own site) becomes a first line `Source: <a>`.
 8. First every web link goes through `linkify.resolve_href(href, source)` (the client's
    `resolveWebLinks`): relative against the web clip, refused -> its content. Then media inside a
    link moves out to just before it; an emptied note link becomes its content, an emptied web
    link shows its (already resolved) href.
 9. `<div style="...-en-codeblock:true...">` -> `<pre><code>` with its text verbatim.
Then (needed by the server walker, which unwraps every `<div>`): each ENML line `<div>` becomes a
`<p>`, so lines stay separate paragraphs as they do in the editor.

Media refs are `evernote-res://{noteGuid}/{md5}`; `providers/evernote.py` (Task 5) fetches them.
"""

from __future__ import annotations

import html as _html
import re
from html.parser import HTMLParser
from typing import Any, Callable
from urllib.parse import urlsplit

from api.services.journal_two import import_notice

from . import ATTACHMENT_REF_PREFIX, LINK_PREFIX, REF_PREFIX
from .linkify import resolve_href
from .mddoc import html_to_tiptap, is_data_image_uri

EVERNOTE_RES_SCHEME = "evernote-res://"
LIVE_KEY_PREFIX = "evernote:guid:"
#: `link_keys.EVERNOTE_TITLE_KIND`, the key kind the server heals by title.
EVERNOTE_TITLE_KIND = "evernote-title:"
#: The text of a note link the lift adds after an image with no alt (Task 9 fix round 2, concern 5
#: ruling): never the link's URL, which carries the member's Evernote user id and shard, and which a
#: heal would never relabel. The client's `evernoteLinks.LINKED_NOTE_LABEL` reads this line.
LINKED_NOTE_LABEL = "Linked note"
ENCRYPTED_TEXT = "[encrypted content — cannot be imported]"

# Internal placeholder `<img src=REF_PREFIX + "evernote-notice://{i}">`: HTML cannot carry an
# importNotice, so the pre-pass leaves this image where the notice belongs and the post-pass swaps
# in `_Notices.nodes[i]`. Never leaves this module.
_NOTICE_SCHEME = "evernote-notice://"
_TITLE_MAX = 300  # `notes.MAX_TITLE_CHARS`, as the client's `titleKeyText` cuts
_APP_HOST = "uctintelligence.com"

_VOID_TAGS = frozenset({"br", "hr", "img", "input", "col", "area", "wbr", "meta", "link",
                        "base", "source", "embed", "param", "track"})
_BLOCK_TAGS = frozenset({"p", "div", "ul", "ol", "li", "table", "tr", "td", "th", "pre",
                         "blockquote", "hr", "h1", "h2", "h3", "h4", "h5", "h6"})
_INTERNAL_ATTRS = frozenset({"data-uct-chip", "data-evernote-link", "data-uct-alt"})

_PROLOG_RE = re.compile(r"^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!DOCTYPE[^>]*>\s*)?", re.IGNORECASE)
_CODEBLOCK_RE = re.compile(r"-en-codeblock\s*:\s*true", re.IGNORECASE)
# The client's `isEvernoteNoteHref` (lib/importer/evernoteLinks.js), verbatim.
_APP_LINK_RE = re.compile(r"^evernote:///?view/", re.IGNORECASE)
_WEB_LINK_RE = re.compile(
    r"^https?://(?:www\.)?evernote\.com/(?:shard/[^/]+/(?:nl|sh)/|l/).", re.IGNORECASE)
_APP_GUID_RE = re.compile(r"^evernote:///?view/(?P<rest>.*)$", re.IGNORECASE)
_NL_GUID_RE = re.compile(
    r"^https?://(?:www\.)?evernote\.com/shard/[^/]+/nl/[^/]+/(?P<guid>[^/?#]+)", re.IGNORECASE)
_GUID_RE = re.compile(r"^[0-9A-Za-z-]+$")


# ---------------------------------------------------------------------------
# keys and hrefs
# ---------------------------------------------------------------------------


def is_guid(value: Any) -> bool:
    """An Evernote GUID as this module accepts one: letters, digits and `-`, never a `/`. The
    provider checks a note's own id with it before it builds a media ref or an import key (n3)."""
    return isinstance(value, str) and bool(_GUID_RE.match(value))


def live_import_key(guid: str) -> str:
    """`evernote:guid:{guid}`. A `.enex` key is `evernote:{notebook}/{title}/{created}` (two `/`)
    and a GUID has none, so the two key spaces cannot collide."""
    return f"{LIVE_KEY_PREFIX}{guid}"


def is_note_href(href: str | None) -> bool:
    """A link to another Evernote note (the client's `isEvernoteNoteHref`)."""
    h = (href or "").strip()
    return bool(_APP_LINK_RE.match(h) or _WEB_LINK_RE.match(h))


def note_guid_from_href(href: str | None) -> str | None:
    """The note GUID in `evernote:///view/{uid}/{shard}/{guid}/{guid}/` or
    `https://www.evernote.com/shard/{s}/nl/{uid}/{guid}/`; None for every other link (a `/l/`
    public link, a `/sh/` shared link, a share-site page), which names its note only by title."""
    h = (href or "").strip()
    guid = None
    m = _APP_GUID_RE.match(h)
    if m:
        segments = m.group("rest").split("/")
        if len(segments) >= 3:
            guid = segments[2]
    else:
        m = _NL_GUID_RE.match(h)
        if m:
            guid = m.group("guid")
    return guid if guid and _GUID_RE.match(guid) else None


def _title_key_text(text: str) -> str:
    """The client's `titleKeyText`: strip, cut at 300 code points, collapse whitespace."""
    return " ".join(text.strip()[:_TITLE_MAX].split())


def _ext_from_mime(mime: str) -> str:
    """The client's `extFromMime`."""
    subtype = (mime.split("/")[1] if "/" in mime else "bin").lower() or "bin"
    mapping = {"jpeg": "jpg", "svg+xml": "svg", "quicktime": "mov", "msword": "doc"}
    if subtype in mapping:
        return mapping[subtype]
    return subtype[2:] if subtype.startswith("x-") else subtype


def _source_line_url(source_url: str | None) -> str | None:
    """The client's `noteSourceUrl`: an http(s) URL with a host, not our own site."""
    raw = (source_url or "").strip()
    if not raw:
        return None
    try:
        parts = urlsplit(raw)
        host = (parts.hostname or "").lower()
    except ValueError:
        return None
    if parts.scheme.lower() not in ("http", "https") or not host:
        return None
    if host == _APP_HOST or host.endswith("." + _APP_HOST):
        return None
    return raw


# ---------------------------------------------------------------------------
# a small tree
# ---------------------------------------------------------------------------


class _Node:
    __slots__ = ("tag", "attrs", "children")

    def __init__(self, tag: str, attrs: dict[str, str | None] | None = None,
                 children: list[Any] | None = None) -> None:
        self.tag = tag
        self.attrs = attrs or {}
        self.children: list[Any] = children or []


#: Elements nested deeper than this are flattened: the tag is dropped and its content joins the
#: deepest kept element (Task 3 review m2). Every walk here and in `mddoc` recurses once or twice
#: per level, so an unbounded depth (500 blockquotes) raised RecursionError and failed the whole
#: note. A note never fails for its nesting; only structure below the cap is lost.
MAX_DEPTH = 100
#: Past the cap a container still gets the one child it needs to hold content (a list's `li`, a
#: table's row and cell): `mddoc` drops text that sits directly in a `ul`/`ol`/`table`/`tr`, so
#: flattening exactly there would lose it. Adds at most three levels.
_STRUCTURAL_CHILD = {"ul": ("li",), "ol": ("li",), "table": ("tr", "tbody", "thead", "tfoot"),
                     "tbody": ("tr",), "thead": ("tr",), "tfoot": ("tr",), "tr": ("td", "th")}


#: Attributes that carry meaning between this module's passes and `mddoc`. Written in a member's
#: note they would forge it (a `data-uct-task` bullet read as a checked task, a `data-uct-chip`
#: link skipping the link policy), so they are dropped as the ENML is parsed (round 2, R2).
_OUR_ATTRS = frozenset({"data-uct-task", "data-uct-chip", "data-evernote-link", "data-uct-alt"})


def _member_attrs(attrs: list[tuple[str, str | None]]) -> dict[str, str | None]:
    return {k.lower(): v for k, v in attrs if k.lower() not in _OUR_ATTRS}


class _Builder(HTMLParser):
    """Every tag kept (ENML's own included). A self-closing `<x/>` is a leaf, as ENML means it;
    a void HTML tag never takes children. Entities arrive decoded (`convert_charrefs`). Nesting
    deeper than `MAX_DEPTH` is flattened."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = _Node("#root")
        self._stack = [self.root]
        self._flattened: list[str] = []  # open tags dropped below the cap, innermost last

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if (tag not in _VOID_TAGS and len(self._stack) > MAX_DEPTH
                and tag not in _STRUCTURAL_CHILD.get(self._stack[-1].tag, ())):
            self._flattened.append(tag)
            return
        node = _Node(tag, _member_attrs(attrs))
        self._stack[-1].children.append(node)
        if node.tag not in _VOID_TAGS:
            self._stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self._stack[-1].children.append(_Node(tag.lower(), _member_attrs(attrs)))

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in _VOID_TAGS:
            return
        if self._flattened:
            if tag in self._flattened:
                # Closes the innermost flattened `tag`, and any flattened tag left open inside it.
                idx = len(self._flattened) - 1 - self._flattened[::-1].index(tag)
                del self._flattened[idx:]
                return
            if not any(n.tag == tag for n in self._stack[1:]):
                return  # a stray end tag: ignored, as below
            # Round 2 R5: the end tag of a KEPT element. The flattened tags it encloses were never
            # closed (malformed markup); they end here, so the structure after stays where it is.
            self._flattened.clear()
        for i in range(len(self._stack) - 1, 0, -1):
            if self._stack[i].tag == tag:
                del self._stack[i:]
                return

    def handle_data(self, data):
        if data:
            self._stack[-1].children.append(data)


def _find(node: _Node, tag: str) -> _Node | None:
    for child in node.children:
        if isinstance(child, _Node):
            if child.tag == tag:
                return child
            found = _find(child, tag)
            if found is not None:
                return found
    return None


def _iter(node: _Node, tag: str | None = None):
    """Elements under `node`, document order (a snapshot: safe to mutate while iterating)."""
    out: list[_Node] = []

    def walk(n: _Node) -> None:
        for c in n.children:
            if isinstance(c, _Node):
                if tag is None or c.tag == tag:
                    out.append(c)
                walk(c)

    walk(node)
    return out


def _parents(root: _Node) -> dict[int, _Node]:
    parents: dict[int, _Node] = {}
    for n in [root, *_iter(root)]:
        for c in n.children:
            if isinstance(c, _Node):
                parents[id(c)] = n
    return parents


def _text_of(node: Any) -> str:
    if isinstance(node, str):
        return node
    return "".join(_text_of(c) for c in node.children)


def _replace(parent: _Node, node: _Node, replacement: list[Any]) -> None:
    for i, c in enumerate(parent.children):
        if c is node:
            parent.children[i:i + 1] = replacement
            return


def _map_elements(node: _Node, fn: Callable[[_Node], list[Any] | None]) -> None:
    """Bottom-up: children first, then `fn(child)`; a list return replaces the child."""
    new_children: list[Any] = []
    for c in node.children:
        if isinstance(c, _Node):
            _map_elements(c, fn)
            replacement = fn(c)
            if replacement is None:
                new_children.append(c)
            else:
                new_children.extend(replacement)
        else:
            new_children.append(c)
    node.children = new_children


def _serialize(node: Any) -> str:
    if isinstance(node, str):
        return _html.escape(node, quote=False)
    attrs = "".join(
        f" {k}" if v is None else f' {k}="{_html.escape(v, quote=True)}"'
        for k, v in node.attrs.items() if k not in _INTERNAL_ATTRS)
    if node.tag in _VOID_TAGS:
        return f"<{node.tag}{attrs}>"
    inner = "".join(_serialize(c) for c in node.children)
    return f"<{node.tag}{attrs}>{inner}</{node.tag}>"


# ---------------------------------------------------------------------------
# the rules
# ---------------------------------------------------------------------------


#: The tag `mddoc` reads for each mark, and the order they nest in.
_MARK_TAGS = ("b", "i", "u", "s")
_NATIVE_MARK = {"b": "b", "strong": "b", "i": "i", "em": "i", "u": "u",
                "s": "s", "del": "s", "strike": "s"}
_BOLD_WEIGHT_RE = re.compile(r"^(?:bold(?:er)?|[5-9]\d{2,})$")


def _style_decls(style: str | None) -> dict[str, str]:
    decls: dict[str, str] = {}
    for part in (style or "").split(";"):
        if ":" in part:
            prop, _, value = part.partition(":")
            decls[prop.strip().lower()] = value.strip().lower()
    return decls


def _rule_formatting(root: _Node) -> None:
    """Task 3 review m3: the formatting the client's editor keeps from ENML, by TipTap's own
    parse rules. Bold: `<b>`/`<strong>`, or `font-weight` bold/bolder/500-900, but not a `<b>`
    whose font-weight is normal or 400. Italic: `<i>`/`<em>` or `font-style: italic`, but not an
    `<i>` whose font-style is normal. Underline: `<u>` or `text-decoration` underline. Strike:
    `<s>`/`<del>`/`<strike>` or `text-decoration` line-through. Colour and font are NOT kept (the
    client drops them too). A style on any element marks every piece of text under it, inside
    nested lines included; a mark an enclosing tag already gives is never doubled."""
    def walk(node: _Node, have: frozenset, want: frozenset) -> None:
        new_children: list[Any] = []
        for c in node.children:
            if isinstance(c, str):
                wrap = [m for m in _MARK_TAGS if m in want and m not in have]
                for m in reversed(wrap):
                    c = _Node(m, {}, [c])
                new_children.append(c)
                continue
            decls = _style_decls(c.attrs.get("style"))
            if (c.tag == "b" and decls.get("font-weight") in ("normal", "400")) or (
                    c.tag == "i" and decls.get("font-style") == "normal"):
                c.tag = "span"  # TipTap does not read these as bold / italic
            child_have = have | {_NATIVE_MARK[c.tag]} if c.tag in _NATIVE_MARK else have
            adds = set()
            if _BOLD_WEIGHT_RE.match(decls.get("font-weight", "")):
                adds.add("b")
            if decls.get("font-style") == "italic":
                adds.add("i")
            decoration = f'{decls.get("text-decoration", "")} {decls.get("text-decoration-line", "")}'
            if "underline" in decoration:
                adds.add("u")
            if "line-through" in decoration:
                adds.add("s")
            walk(c, frozenset(child_have), want | adds)
            new_children.append(c)
        node.children = new_children

    walk(root, frozenset(), frozenset())


def _rule_en_crypt(root: _Node) -> None:
    _map_elements(root, lambda n: [_Node("p", {}, [ENCRYPTED_TEXT])] if n.tag == "en-crypt" else None)


def _media_alt(nodes: list[Any]) -> str:
    """The first image's alt among `nodes` (an `<img alt>`, or an `<en-media alt>` carried as
    `data-uct-alt`), stripped; "" when none has one. Task 9 fix round 1, concern 2."""
    for n in nodes:
        if isinstance(n, _Node) and n.tag in ("img", "en-media"):
            alt = (n.attrs.get("alt") or n.attrs.get("data-uct-alt") or "").strip()
            if alt:
                return alt
    return ""


def _rule_note_links(root: _Node) -> None:
    def fn(n: _Node) -> list[Any] | None:
        if n.tag != "a" or not is_note_href(n.attrs.get("href")):
            return None
        guid = note_guid_from_href(n.attrs.get("href"))
        if guid:
            n.attrs["href"] = LINK_PREFIX + live_import_key(guid)
            n.attrs["data-evernote-link"] = "1"
            return None
        # Named by title only: its text, or (concern 2) the alt of an image it holds.
        title = _title_key_text(_text_of(n)) or _title_key_text(_media_alt(list(_iter(n))))
        if not title:
            # Nothing to heal by: a web link (the share page), left to the web link policy.
            return None
        n.attrs["href"] = LINK_PREFIX + EVERNOTE_TITLE_KIND + title
        n.attrs["data-evernote-link"] = "1"
        return None

    _map_elements(root, fn)


class _Resources:
    """The note's resources by lower-case hash, first-wins (rule 6's collapse)."""

    def __init__(self, resources: list[dict], note_guid: str) -> None:
        self.unique: list[dict] = []
        self.by_hash: dict[str, dict] = {}
        for r in resources:
            if not isinstance(r, dict):
                continue
            h = str(r.get("hash") or "").strip().lower()
            if not h or h in self.by_hash:
                continue
            mime = str(r.get("mime") or "").strip() or "application/octet-stream"
            name = r.get("name") if isinstance(r.get("name"), str) and r["name"].strip() else None
            entry = {
                "hash": h,
                "ref": f"{EVERNOTE_RES_SCHEME}{note_guid}/{h}",
                "kind": "image" if mime.lower().startswith("image/") else "file",
                "name": (name or "").strip() or f"attachment.{_ext_from_mime(mime)}",
                "mime": mime,
            }
            self.by_hash[h] = entry
            self.unique.append(entry)
        self.cited: set[str] = set()


class _Notices:
    """importNotice nodes the post-pass puts where their placeholder images stand."""

    def __init__(self) -> None:
        self.nodes: list[dict] = []

    def placeholder(self, reason: str, *, name: str | None = None,
                    source_url: str | None = None) -> _Node:
        self.nodes.append(import_notice.notice_node(
            reason, name=name, source_url=source_url, ref=None, attempts=0))
        return _Node("img", {"src": f"{REF_PREFIX}{_NOTICE_SCHEME}{len(self.nodes) - 1}"})


_SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.\-]*:")
#: `mediaRefs.js::MEDIA_NAME_MAX`: a media item's display name is bounded (a src can be huge).
MEDIA_NAME_MAX = 200


def _bounded_name(name: str) -> str:
    """The client's `boundedName`: at most MEDIA_NAME_MAX characters, an ellipsis when cut."""
    return name if len(name) <= MEDIA_NAME_MAX else name[:MEDIA_NAME_MAX - 1] + "…"


def _web_image_url(src: str) -> str | None:
    try:
        parts = urlsplit(src)
    except ValueError:
        return None
    if parts.scheme.lower() in ("http", "https") and parts.hostname:
        return src
    return None


def _rule_refuse_foreign_media(root: _Node, notices: _Notices, base_url: str | None = None) -> None:
    """Task 3 review I4. Runs FIRST, before the converter creates any media of its own, so every
    `<img>` and placeholder href found here was written in the note (ENML has no `<img>`;
    Evernote's images are `<en-media>`). None of them becomes a media ref: the only refs this
    converter emits are `evernote-res://{guid}/{md5}` and web hotlinks, the two Task 5's
    `fetch_media` accepts (a resource via `get_attachment`; a hotlink copied in through the base
    provider's guarded path, as every other connector copies one).
      - an `<img>` with an http(s) src -> kept, a hotlink image the engine copies in (program
        rule: hotlinked images are copied in); `mddoc` registers it, ref = the URL;
      - any other `<img>` (`javascript:`, `vbscript:`, `data:`, `file:`, relative, empty, or a
        forged `import-ref://`) -> an `unsafe` notice;
      - an `<a>` whose href is one of our placeholder prefixes -> its content."""
    placeholders = (REF_PREFIX, ATTACHMENT_REF_PREFIX)

    def fn(n: _Node) -> list[Any] | None:
        if n.tag == "img":
            src = (n.attrs.get("src") or "").strip()
            url = None if src.lower().startswith(placeholders) else _web_image_url(src)
            if url is None and base_url and src and not src.lower().startswith(placeholders):
                # Ruling after Task 4: in a web clip a relative src resolves against the clip's
                # source through the one link policy, then is copied like any hotlink (the file
                # importer's `collectRemoteImages`). With no source it stays `unsafe` below.
                resolved = resolve_href(src, base_url)
                url = _web_image_url(resolved) if resolved else None
            # Every other attribute is dropped; the alt is kept privately for the lift (concern 2).
            alt = {"data-uct-alt": n.attrs["alt"].strip()} if (n.attrs.get("alt") or "").strip() else {}
            if url:
                return [_Node("img", {"src": url, **alt})]
            if is_data_image_uri(src):
                # Ruling after Task 4 (content wins): a `data:image/*` image is uploaded as the
                # file importer uploads it; the walker's data-URI path, media_policy caps in the
                # engine. Scheme lower-cased: the walker reads `data:` case-sensitively.
                return [_Node("img", {"src": "data:" + src[5:], **alt})]
            if not _SCHEME_RE.match(re.sub(r"[\x00-\x20]", "", src)):
                # Task 5 review, concern 2 ruling: no scheme and no clip source to resolve it
                # against -- not dangerous, just unresolvable. The client's code and name
                # (`collectRemoteImages`: `unresolvable_src`, the src bounded to 200 chars).
                return [notices.placeholder("unresolvable_src", name=_bounded_name(src) or None)]
            return [notices.placeholder("unsafe")]  # a refused scheme
        if n.tag == "a" and (n.attrs.get("href") or "").strip().lower().startswith(placeholders):
            return list(n.children)
        return None

    _map_elements(root, fn)


def _media_node(entry: dict) -> _Node:
    if entry["kind"] == "image":
        return _Node("img", {"src": REF_PREFIX + entry["ref"]})
    return _Node("a", {"href": ATTACHMENT_REF_PREFIX + entry["ref"], "data-uct-chip": "1"},
                 [entry["name"]])


def _kind_of_type(type_: str | None) -> str | None:
    """The client's `kindOfType`: the media kind an `<en-media type>` asks for; None (any) when
    it has none."""
    t = (type_ or "").strip().lower()
    if not t:
        return None
    return "image" if t.startswith("image/") else "file"


def _unambiguous_pairs(unmatched: list[_Node], res: _Resources) -> dict[int, dict]:
    """The client's `unambiguousPairs` (Plan B E-14, fix round 1 ruling 1), exactly: an
    `<en-media>` whose hash matches no resource pairs with an uncited resource ONLY when that
    cannot be a guess. A typed one pairs when it is the only unmatched one of its kind, exactly
    one uncited resource of that kind exists, and no untyped one is unmatched. An untyped one
    pairs when it is the only unmatched one at all and exactly one resource is uncited. Never
    positional. Returns `id(en-media) -> resource`."""
    pairs: dict[int, dict] = {}
    uncited = [r for r in res.unique if r["hash"] not in res.cited]

    def typed(kind: str | None) -> list[_Node]:
        return [el for el in unmatched if _kind_of_type(el.attrs.get("type")) == kind]

    untyped = typed(None)
    for kind in ("image", "file"):
        els = typed(kind)
        candidates = [r for r in uncited if r["kind"] == kind]
        if len(els) == 1 and len(candidates) == 1 and not untyped:
            pairs[id(els[0])] = candidates[0]
    if len(untyped) == 1 and len(unmatched) == 1 and len(uncited) == 1:
        pairs[id(untyped[0])] = uncited[0]
    return pairs


def _rule_en_media(root: _Node, res: _Resources, notices: _Notices) -> None:
    hash_of = lambda el: str(el.attrs.get("hash") or "").strip().lower()  # noqa: E731
    # Exact citations first, across the whole note, so an earlier mismatched en-media can never
    # take a resource a later one cites exactly.
    els = _iter(root, "en-media")
    for el in els:
        if hash_of(el) in res.by_hash:
            res.cited.add(hash_of(el))
    pairs = _unambiguous_pairs([el for el in els if hash_of(el) not in res.by_hash], res)

    def fn(n: _Node) -> list[Any] | None:
        if n.tag != "en-media":
            return None
        entry = res.by_hash.get(hash_of(n)) or pairs.get(id(n))
        if entry is not None:
            res.cited.add(entry["hash"])
            node = _media_node(entry)
            alt = (n.attrs.get("alt") or "").strip()
            if alt and node.tag == "img":
                node.attrs["data-uct-alt"] = alt  # read by the lift only, never stored (concern 2)
        else:
            node = notices.placeholder("missing_resource")
        # Content the parser nested inside the en-media (the client's `unwrapInPlace`) follows it.
        return [node, *n.children]

    _map_elements(root, fn)


def _first_en_todo(div: _Node) -> _Node | None:
    return _find(div, "en-todo")


def _is_todo_div(n: Any) -> bool:
    return isinstance(n, _Node) and n.tag == "div" and _first_en_todo(n) is not None


def _rule_todos(root: _Node) -> None:
    parents = _parents(root)
    containers: dict[int, _Node] = {}
    for todo in _iter(root, "en-todo"):
        node: _Node | None = parents.get(id(todo))
        while node is not None and node is not root and node.tag != "div":
            node = parents.get(id(node))
        if node is not None and node is not root and node.tag == "div":
            container = parents.get(id(node))
            if container is not None:
                containers[id(container)] = container
    for container in containers.values():
        _group_todo_divs(container)


def _group_todo_divs(container: _Node) -> None:
    elements = [c for c in container.children if isinstance(c, _Node)]
    runs: dict[int, list[_Node]] = {}  # id(first div of a run) -> the run
    in_run: set[int] = set()
    i = 0
    while i < len(elements):
        if not _is_todo_div(elements[i]):
            i += 1
            continue
        start = i
        while i < len(elements) and _is_todo_div(elements[i]):
            i += 1
        run = elements[start:i]
        runs[id(run[0])] = run
        in_run.update(id(d) for d in run)
    if not runs:
        return
    out: list[Any] = []
    for c in container.children:
        if isinstance(c, _Node) and id(c) in in_run:
            if id(c) in runs:
                out.append(_Node("ul", {}, [_todo_item(d) for d in runs[id(c)]]))
            continue
        out.append(c)
    container.children = out


def _todo_item(div: _Node) -> _Node:
    todo = _first_en_todo(div)
    # Exactly "true", as the client's `getAttribute('checked') === 'true'` (review n1).
    checked = todo is not None and todo.attrs.get("checked") == "true"
    if todo is not None:
        parent = _parents(div).get(id(todo), div)
        _replace(parent, todo, list(todo.children))  # siblings nested inside it come out
    return _Node("li", {"data-uct-task": "1" if checked else "0"}, list(div.children))


# Task 4 list repair: `mddoc.repair_list_items` / `mddoc._split_list` (D3 item 8), the ONE
# implementation, iterative (D3 review I1). This module kept its own recursive copy until the
# merge of #721; the ENML parity fixtures regenerate byte-identical through the shared one.


def _rule_append_uncited(root: _Node, res: _Resources) -> None:
    for entry in res.unique:
        if entry["hash"] not in res.cited:
            root.children.append(_media_node(entry))


def _rule_source_line(root: _Node, source_url: str | None) -> None:
    url = _source_line_url(source_url)
    if url:
        root.children.insert(0, _Node("p", {}, ["Source: ", _Node("a", {"href": url}, [url])]))


def _rule_resolve_web_links(root: _Node, base_url: str | None) -> None:
    """The client's `resolveWebLinks`, run before the lift: every web link (not a note link, not
    a chip) goes through the ONE import link policy, `linkify.resolve_href(href, source)`. A
    relative href resolves against the web clip's source; a refused one (`javascript:`, `ftp:`, a
    relative href with no source) becomes its content. So the lift can never show a raw href."""
    def fn(n: _Node) -> list[Any] | None:
        if n.tag != "a" or "href" not in n.attrs:
            return None
        if "data-uct-chip" in n.attrs or "data-evernote-link" in n.attrs:
            return None
        resolved = resolve_href(n.attrs.get("href"), base_url)
        if resolved is None:
            return list(n.children)  # refused: its content
        n.attrs["href"] = resolved
        return None

    _map_elements(root, fn)


def _is_media(n: Any) -> bool:
    return isinstance(n, _Node) and (n.tag == "img" or (n.tag == "a" and "data-uct-chip" in n.attrs))


def _extract_media(node: _Node) -> list[_Node]:
    """Removes the OUTERMOST media under `node` (a chip moves whole) and returns it, in order.
    One walk of `node`'s subtree."""
    found: list[_Node] = []
    kept: list[Any] = []
    for c in node.children:
        if _is_media(c):
            found.append(c)
            continue
        if isinstance(c, _Node):
            found.extend(_extract_media(c))
        kept.append(c)
    node.children = kept
    return found


def _rule_lift_media(root: _Node) -> None:
    """ONE bottom-up pass (Task 3 review I3: the first version rebuilt a parent map per anchor and
    was quadratic; a 5 MB note of linked thumbnails never finished). Each anchor's subtree is walked
    once; a link inside a link is walked once per enclosing link."""
    def fn(a: _Node) -> list[Any] | None:
        if a.tag != "a" or _is_media(a):
            return None  # a chip is never a link to lift from
        href = (a.attrs.get("href") or "").strip()
        marked = "data-evernote-link" in a.attrs
        if not href and not marked:
            return None
        media = _extract_media(a)
        if not media:
            return None
        if _text_of(a).strip():
            return [*media, a]
        if not href:
            return [*media, *a.children]  # its content
        # Task 9 fix round 1 (concern 2, ruling): the link survives, right after its media, with
        # the same href (a note link stays its heal-able `import-link://`). Its text: the image's
        # alt; else, for a note link, LINKED_NOTE_LABEL (fix round 2: never its URL); else, for a
        # web link, its href (already resolved by `_rule_resolve_web_links`).
        a.children = [_media_alt(media) or (LINKED_NOTE_LABEL if marked else href)]
        return [*media, a]

    _map_elements(root, fn)


def _code_text(node: _Node) -> str:
    parts: list[str] = []
    for c in node.children:
        if isinstance(c, str):
            parts.append(c)
        elif c.tag == "br":
            parts.append("\n")
        elif c.tag in ("div", "p"):
            line = _code_text(c)
            if line.endswith("\n"):
                line = line[:-1]
            if parts and not parts[-1].endswith("\n"):
                parts.append("\n")
            parts.append(line + "\n")
        else:
            parts.append(_code_text(c))
    return "".join(parts)


def _rule_codeblocks(root: _Node) -> None:
    def convert(n: _Node) -> list[Any]:
        text = _code_text(n)
        if text.endswith("\n"):
            text = text[:-1]
        pre = _Node("pre", {}, [_Node("code", {}, [text])])
        # Media cannot live in a code block: it follows the block rather than vanish.
        return [pre, *[m for m in _iter(n) if _is_media(m)]]

    def walk(node: _Node) -> None:
        new_children: list[Any] = []
        for c in node.children:
            if isinstance(c, _Node) and c.tag == "div" and _CODEBLOCK_RE.search(c.attrs.get("style") or ""):
                new_children.extend(convert(c))
            else:
                if isinstance(c, _Node):
                    walk(c)
                new_children.append(c)
        node.children = new_children

    walk(root)


def _is_whitespace_only(children: list[Any]) -> bool:
    """Inter-block whitespace text between a div's block children: never a paragraph of its own."""
    return all(isinstance(c, str) and not c.strip() for c in children)


def _rule_native_p_leading(root: _Node) -> None:
    """A `<p>` written in the ENML is a real paragraph to the client's editor, which always drops
    its leading whitespace (see `_trim_block_edges`). Runs before line divs become `<p>` too."""
    for p in _iter(root, "p"):
        stack: list[Any] = [p]
        while stack:
            node = stack.pop()
            for i, c in enumerate(node.children):
                if isinstance(c, str):
                    stripped = c.lstrip(_PM_SPACE)
                    node.children[i] = stripped
                    if stripped:
                        stack.clear()
                        break
                    continue
                if c.tag in _VOID_TAGS:
                    stack.clear()
                    break
                stack.append(c)  # descend into the first inline element
                break


def _rule_div_lines(root: _Node) -> None:
    def fn(n: _Node) -> list[Any] | None:
        if n.tag != "div":
            return None
        # Review m1: an empty line keeps its <br> -> `paragraph[hardBreak]`, the client's shape.
        if not any(isinstance(c, _Node) and c.tag in _BLOCK_TAGS for c in n.children):
            return [_Node("p", {}, list(n.children))]
        out: list[Any] = []
        run: list[Any] = []

        def flush() -> None:
            if run and not _is_whitespace_only(run):
                out.append(_Node("p", {}, list(run)))
            run.clear()

        for c in n.children:
            if isinstance(c, _Node) and c.tag in _BLOCK_TAGS:
                flush()
                out.append(c)
            else:
                run.append(c)
        flush()
        return out

    _map_elements(root, fn)


#: D2 item 5 (master, #721), the client's `convert.js::markBlockAtomEdges` (b) on this lane. An
#: image or a chip is a BLOCK atom, so the client's editor parser closes the line's paragraph
#: before it and, closing it, would strip its trailing space (`Report: ` read `Report:`). The
#: client keeps that space by putting a marker right after it before the parse and taking the
#: marker out after; `_trim_block_edges` below ports the same strip, so this lane marks the same
#: texts the same way. Case (a) of that rule (an atom opening a `<p>`) is not mirrored: the
#: server walker never leaves the empty paragraph it removes.
_ATOM_MARKERS = tuple(chr(c) for c in range(0xFDD0, 0xFDF0))  # the client's `pickMarker` range


def _is_block_atom(node: Any) -> bool:
    """The client's `BLOCK_ATOMS` (`img, a[data-type="attachmentChip"]`), as this tree holds them."""
    return isinstance(node, _Node) and (
        node.tag == "img" or (node.tag == "a" and "data-uct-chip" in node.attrs))


def _last_text_slot(node: _Node) -> tuple[_Node, int] | None:
    """The client's `lastTextIn`: the last text under `node`, as (the element holding it, its
    index). Depth is bounded by `MAX_DEPTH`, so the recursion is too."""
    for i in range(len(node.children) - 1, -1, -1):
        c = node.children[i]
        if isinstance(c, str):
            return node, i
        found = _last_text_slot(c) if isinstance(c, _Node) else None
        if found is not None:
            return found
    return None


def _rule_mark_atom_edges(root: _Node) -> str | None:
    """Puts the marker after a text's trailing whitespace where the text ends right before a
    block atom (the atom's immediate previous sibling, as the client reads it). Returns the
    marker, or None when nothing was marked (or the note holds all 32 noncharacters).

    Never inside a `<pre>`: the client drops a code block's final line end (`dropCodeLineEnds`)
    BEFORE it marks, and a code block keeps its whitespace anyway, so the client's marker
    changes nothing there; here a marker after that line end would hide it from
    `mddoc._code_without_line_end` (measured: `enml_parity/07-codeblock` kept its final line end)."""
    html = "".join(_serialize(c) for c in root.children)
    marker = next((m for m in _ATOM_MARKERS if m not in html), None)
    if marker is None:
        return None
    in_pre = {id(x) for pre in _iter(root, "pre") for x in (pre, *_iter(pre))}
    marked = False
    for n in [root, *_iter(root)]:
        for i, atom in enumerate(n.children):
            if not _is_block_atom(atom):
                continue
            j = i - 1
            while j >= 0 and isinstance(n.children[j], str) and not n.children[j].strip(_PM_SPACE):
                j -= 1
            if j < 0:
                continue  # the atom opens its line: case (a), not mirrored
            prev = n.children[i - 1]
            slot = (n, i - 1) if isinstance(prev, str) else _last_text_slot(prev)
            if slot is None or id(slot[0]) in in_pre:
                continue
            text = slot[0].children[slot[1]]
            if text.endswith(tuple(_PM_SPACE)) and text.strip(_PM_SPACE):
                slot[0].children[slot[1]] = text + marker
                marked = True
    return marker if marked else None


def _drop_atom_marker(node: Any, marker: str) -> None:
    """Takes the marker out of every text again (the client's `dropMarker`, case (b))."""
    if not isinstance(node, dict):
        return
    if node.get("type") == "text" and marker in node.get("text", ""):
        node["text"] = node["text"].replace(marker, "")
    content = node.get("content")
    if isinstance(content, list):
        for child in content:
            _drop_atom_marker(child, marker)
        node["content"] = [c for c in content
                           if not (isinstance(c, dict) and c.get("type") == "text" and c.get("text") == "")]


# ---------------------------------------------------------------------------
# post-pass on the TipTap doc
# ---------------------------------------------------------------------------


_PM_SPACE = " \t\r\n\f"  # ProseMirror's whitespace class; a no-break space is not in it
_TRIMMED_BLOCKS = frozenset({"paragraph", "heading"})


def _trim_block_edges(block: dict, *, later_line: bool = False) -> None:
    """Review n2: the client's editor parser (ProseMirror, whitespace not preserved) drops a
    leading space at the start of a text block, right after a line break, or after text that
    already ends in a space; and drops trailing whitespace at the end of the block. Ported so
    `see ` / ` Multi space title ` come out as the client stores them. Code blocks are left alone.

    Task 4 (re-review R4), measured on the client by the ENML parity rail: an ENML line is a
    `<div>`, which has no parse rule, so ProseMirror adds its text at the CONTAINER level. There
    a whitespace-only text run is skipped, and a leading space survives when the container
    already holds a block before it (`later_line`): `<div>x</div><div> b</div>` stores ` b`. The
    first line of a container loses it. (A member-written `<p>` is a real paragraph to
    ProseMirror and always loses it: `_rule_native_p_leading` strips that one up front.)"""
    items = block.get("content")
    if not isinstance(items, list):
        return
    out: list[dict] = []
    for item in items:
        if isinstance(item, dict) and item.get("type") == "text":
            text = item.get("text", "")
            prev = out[-1] if out else None
            if prev is None and not text.strip(_PM_SPACE):
                continue  # whitespace only, before the line has any content: skipped
            if text[:1] in tuple(_PM_SPACE) and (
                    (prev is None and not later_line) or (prev is not None and (
                        prev.get("type") == "hardBreak"
                        or (prev.get("type") == "text"
                            and prev.get("text", "")[-1:] in tuple(_PM_SPACE))))):
                text = text[1:]
            if not text:
                continue
            item["text"] = text
        out.append(item)
    if out and out[-1].get("type") == "text":
        last = out[-1]["text"].rstrip(_PM_SPACE)
        if last:
            out[-1]["text"] = last
        else:
            out.pop()
    block["content"] = out


def _post_pass(node: Any, names: dict[str, str], notices: _Notices) -> None:
    if not isinstance(node, dict):
        return
    content = node.get("content")
    if isinstance(content, list):
        marker = REF_PREFIX + _NOTICE_SCHEME
        for i, child in enumerate(content):
            src = str(((child.get("attrs") or {}) if isinstance(child, dict) else {}).get("src", ""))
            if isinstance(child, dict) and child.get("type") == "image" and src.startswith(marker):
                content[i] = dict(notices.nodes[int(src[len(marker):])])
                continue
            if isinstance(child, dict) and child.get("type") in _TRIMMED_BLOCKS:
                _trim_block_edges(child, later_line=i > 0 and child.get("type") == "paragraph")
            _post_pass(child, names, notices)
    if node.get("type") == "attachmentChip":
        href = (node.get("attrs") or {}).get("href", "")
        ref = href[len(REF_PREFIX):] if href.startswith(REF_PREFIX) else href
        if ref in names:
            node["attrs"]["name"] = names[ref]


# ---------------------------------------------------------------------------
# public entry point
# ---------------------------------------------------------------------------


def enml_to_tiptap(enml: str, resources: list[dict] | None, *, note_guid: str,
                   source_url: str | None = None) -> dict:
    """One note's ENML -> `{doc, media, links}` (the shape every converter returns).

    `resources` is `get_note`'s list; `None` (what `get_note` returns for a note without
    attachments) reads as `[]`. `media` holds one entry per unique resource,
    `{ref, kind, name, mime}`, plus any other image the walker registered."""
    # The ONE null-resources guard (Task 9 fix round 1, concern 6): `null`, and any drifted
    # non-list, read as no resources. The provider passes the measured value through.
    resources = resources if isinstance(resources, list) else []
    builder = _Builder()
    builder.feed(_PROLOG_RE.sub("", enml or "", count=1))
    builder.close()
    root = _find(builder.root, "en-note") or builder.root

    res = _Resources(resources, note_guid)
    notices = _Notices()
    _rule_refuse_foreign_media(root, notices, _source_line_url(source_url))  # before any media of ours (I4)
    _rule_formatting(root)             # before any rule rebuilds an element without its style (m3)
    _rule_en_crypt(root)               # 2
    _rule_note_links(root)             # 3
    _rule_en_media(root, res, notices)  # 4
    _rule_todos(root)                  # 5
    _rule_append_uncited(root, res)    # 6
    _rule_source_line(root, source_url)  # 7
    _rule_resolve_web_links(root, _source_line_url(source_url))  # 8, the client's resolveWebLinks
    _rule_lift_media(root)             # 8
    _rule_codeblocks(root)             # 9
    _rule_native_p_leading(root)       # before line divs become <p> (Task 4, R4)
    _rule_div_lines(root)

    atom_marker = _rule_mark_atom_edges(root)  # last: it reads each atom's final neighbour

    result = html_to_tiptap("".join(_serialize(c) for c in root.children))

    names = {e["ref"]: e["name"] for e in res.unique if e["kind"] == "file"}
    # Lists were repaired once, inside `html_to_tiptap` (mddoc's one implementation), before the
    # post-pass reads each block's final place; a second walk here was idempotent (final review M4).
    _post_pass(result["doc"], names, notices)
    if atom_marker is not None:
        _drop_atom_marker(result["doc"], atom_marker)  # after the trim it protected the space from

    # Two kinds of ref only, by construction (I4 + the hotlink ruling): the note's resources
    # (`evernote-res://`), then the web hotlinks the walker registered. Everything else was
    # refused before the walk; the filter below is the second guard.
    media = [{"ref": e["ref"], "kind": e["kind"], "name": e["name"], "mime": e["mime"]}
             for e in res.unique]
    refs = {m["ref"] for m in media}
    for entry in result["media"]:
        ref = entry.get("ref")
        if isinstance(ref, str) and ref not in refs and (_web_image_url(ref) or entry.get("data_uri")):
            refs.add(ref)
            media.append(entry)
    return {"doc": result["doc"], "media": media, "links": result["links"]}
