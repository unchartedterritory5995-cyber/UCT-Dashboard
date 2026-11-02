"""One link policy for every server import path -- connector fidelity Plan A Task 10
(spec L-3, L-4).

Two pure passes over a TipTap doc, both deep-copying (the input is never mutated):

`normalize_link_hrefs(doc, source_url=None)` -- every existing `link` mark's href goes
through `resolve_href`; a `None` answer removes the MARK and keeps the text (and every
other mark on it). The rules are Plan B's `resolveHref` (client `linkPolicy.js`), stated
once per side:
  * `import-link://`, `import-ref://`, `/journal...`, `/terminal?cmd=`,
    `/api/j2/notes/attachments/` -> unchanged;
  * `javascript:` `data:` `vbscript:` `file:` -> text. The scheme is read the way a
    browser reads it (`mddoc.link_href_as_read`), so `java<TAB>script:` is caught;
  * `evernote:` `notion:` `obsidian:` `onenote:` deep links -> a pending
    `import-link://<key>` when the link names a note an import key can be derived for
    (today: a Notion page id, `notion:<uuid>`, the key `NotionProvider.import_key`
    writes), so the Task 4 link-key machinery (`link_keys.resolve_link_keys` in the
    engine's final pass, `heal_pending_links` later) turns it into the in-app note link;
    any other deep link -> text;
  * any other scheme (`https:`, `mailto:`, `tel:`, `ftp:`, `zoommtg:` ...) -> unchanged;
  * `//host...` -> `https://host...`;
  * relative, `#...`, `?...` -> resolved against the note's own http(s) source URL when
    one is known, else text. ⛔ Never against uctintelligence.com: in the app a relative
    href would land on OUR origin, which is never what the source author meant.

`linkify_doc(doc)` -- bare `https://...`, `http://...`, `www....`, `mailto:` and email
addresses in plain text become link marks. ONE module-level `LinkifyIt()` (linkify-it's
defaults, the same behaviour markdown-it's linkify has on the client), then:
  * keep a match only if its schema is `http:`/`https:`/`mailto:` (a bare email counts),
    or its schema is empty and its raw text starts with `www.` (href gets `https://`).
    Every other fuzzy domain is dropped: `NVDA.US`, `BRK.B`, `example.com` are tickers
    and prose far more often than links. `ftp:` and `//` matches are dropped too;
  * ONE trim, identical on the client: cut at the first CJK/fullwidth punctuation mark or
    curly quote (linkify-it keeps `。` and `”` inside a path), strip trailing `.,:;!?`
    (linkify-it keeps a trailing `:`), and keep the result only if linkify-it matches it
    again as exactly one kept link spanning all of it;
  * never inside a `codeBlock`, `inlineMath` or `blockMath` subtree, and never on a run
    carrying a `code` or `link` mark (such a run is a hard boundary: a match never
    crosses it);
  * within a textblock, adjacent text runs are matched as ONE string, so a URL split by a
    bold word is still one link; the runs keep their own marks and gain the link mark.

The shared vectors `app/src/pages/journal-2-0/lib/importer/__fixtures__/linkify_vectors.json`
are asserted by `test_linkify.py` here and by Plan B's client test, so the sides cannot
drift. Cost is linear in the text (one linkify scan per run, plus one re-check per kept
match); the engine still runs it off the event loop (`engine._finalize_remote_notes`).
"""
from __future__ import annotations

import copy
import re
import threading
from typing import Any
from urllib.parse import urljoin, urlsplit

from linkify_it import LinkifyIt

from . import LINK_PREFIX, REF_PREFIX
from .mddoc import link_href_as_read

# ⛔ linkify-it keeps per-call match state on the instance (`test()` then `match()`), so
# the one instance is shared under a lock: the engine runs this in worker threads.
_LINKIFY = LinkifyIt()
_LINKIFY_LOCK = threading.Lock()

_KEEP_SCHEMAS = frozenset({"http:", "https:", "mailto:"})
_STOP_RE = re.compile(
    "[　、。，；：！？（）【】「」"
    "『』《》〈〉“”‘’…]"
)
_TRAIL_RE = re.compile(r"[.,:;!?]+$")
_SKIP_SUBTREES = frozenset({"codeBlock", "inlineMath", "blockMath"})
_BOUNDARY_MARKS = frozenset({"code", "link"})

_KEPT_PREFIXES = (LINK_PREFIX, REF_PREFIX, "/journal", "/terminal?cmd=", "/api/j2/notes/attachments/")
_UNSAFE_SCHEMES = frozenset({"javascript", "data", "vbscript", "file"})
_APP_SCHEMES = frozenset({"evernote", "notion", "obsidian", "onenote"})
_SCHEME_RE = re.compile(r"^([a-zA-Z][a-zA-Z0-9+.\-]*):")
_NOTION_SEGMENT_RE = re.compile(
    r"(?:.*-)?([0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"
)
_NOTION_HOSTS = frozenset({"notion.so", "www.notion.so", "notion.com", "www.notion.com"})
_APP_HOST = "uctintelligence.com"


# ── href policy (L-4) ────────────────────────────────────────────────────────

def _page_id_of_last_segment(path: str) -> str | None:
    """The dashed lowercase UUID a Notion path names: its last segment is the id itself or
    `<slug>-<id>` (32 hex, dashed or not). Anything else (a hex tail glued to a word, an id
    followed by a further segment) names no page."""
    segment = path.rstrip("/").rsplit("/", 1)[-1]
    m = _NOTION_SEGMENT_RE.fullmatch(segment)
    if m is None:
        return None
    h = m.group(1).replace("-", "").lower()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


def notion_page_id_from_href(href: Any) -> str | None:
    """The Notion page a link points at, as the dashed lowercase UUID (`8-4-4-4-12`, the
    shape of `mention.page.id` and of the `notion:{page_id}` import key), else None.

    THE one reader of a Notion page link, for both doors: the Notion converter's rich-text
    hrefs (Task 11) and the `notion://` deep links of `resolve_href` (Task 10). Accepts a
    workspace-relative `/<id>` or `/<slug>-<id>` (what the Notion API writes for a link to
    another page in the workspace), `http(s)://[www.]notion.so|notion.com/[<workspace>/]...`,
    `https://<sub>.notion.site/...`, and `notion://...`; any `?query`/`#fragment` is ignored
    (a `#<block id>` link opens its page)."""
    if not isinstance(href, str):
        return None
    read = link_href_as_read(href.strip())
    path = re.split(r"[?#]", read, maxsplit=1)[0]
    m = _SCHEME_RE.match(path)
    if m is None:
        # relative: a workspace path, never a protocol-relative `//host`
        if not path.startswith("/") or path.startswith("//"):
            return None
        return _page_id_of_last_segment(path)
    scheme = m.group(1).lower()
    if scheme == "notion":
        return _page_id_of_last_segment(path[m.end():])
    if scheme not in ("http", "https"):
        return None
    try:
        parts = urlsplit(path)
    except ValueError:
        return None
    host = (parts.hostname or "").lower()
    if host not in _NOTION_HOSTS and not host.endswith(".notion.site"):
        return None
    return _page_id_of_last_segment(parts.path)


def _notion_key(read: str) -> str | None:
    """`notion:<uuid>` for a Notion deep link whose path ends in a page id, else None."""
    pid = notion_page_id_from_href("notion:" + read)
    return f"notion:{pid}" if pid else None


def _resolve_relative(href: str, source_url: str | None) -> str | None:
    if not isinstance(source_url, str):
        return None
    try:
        base = urlsplit(source_url.strip())
    except ValueError:
        return None
    host = (base.hostname or "").lower()
    if base.scheme.lower() not in ("http", "https") or not host:
        return None
    if host == _APP_HOST or host.endswith("." + _APP_HOST):
        return None
    try:
        # `href` has no scheme (`resolve_href` decided that), so the result keeps the base's.
        return urljoin(source_url.strip(), href)
    except ValueError:
        return None


def resolve_href(href: Any, source_url: str | None = None) -> str | None:
    """The href to keep, or None meaning "render as text". Plan B's `resolveHref`."""
    if not isinstance(href, str):
        return None
    h = href.strip()
    if not h:
        return None
    if h.startswith(_KEPT_PREFIXES):
        return h
    # ⛔ THE scheme guard: the scheme is read the way TipTap and a browser read it. Python's
    # `urljoin` strips a tab too, so without this `java<TAB>script:` would reach
    # `_resolve_relative` as a "relative" href and come back as `javascript:`.
    read = link_href_as_read(h)
    m = _SCHEME_RE.match(read)
    if m is not None:
        scheme = m.group(1).lower()
        if scheme in _UNSAFE_SCHEMES:
            return None
        if scheme in _APP_SCHEMES:
            key = _notion_key(read[m.end():]) if scheme == "notion" else None
            return f"{LINK_PREFIX}{key}" if key else None
        return h
    if read.startswith("//"):
        return "https:" + read
    return _resolve_relative(h, source_url)


def _normalize_in_place(node: Any, source_url: str | None) -> None:
    if isinstance(node, list):
        for c in node:
            _normalize_in_place(c, source_url)
        return
    if not isinstance(node, dict):
        return
    marks = node.get("marks")
    if isinstance(marks, list) and any(isinstance(m, dict) and m.get("type") == "link" for m in marks):
        kept: list[Any] = []
        for m in marks:
            if isinstance(m, dict) and m.get("type") == "link":
                attrs = m.get("attrs") if isinstance(m.get("attrs"), dict) else {}
                href = resolve_href(attrs.get("href"), source_url)
                if href is None:
                    continue  # the mark goes; the text and its other marks stay
                m["attrs"] = {**attrs, "href": href}
            kept.append(m)
        if kept:
            node["marks"] = kept
        else:
            del node["marks"]
    _normalize_in_place(node.get("content"), source_url)


def normalize_link_hrefs(doc: dict, source_url: str | None = None) -> dict:
    """A deep copy of `doc` with every link href put through `resolve_href`."""
    out = copy.deepcopy(doc)
    _normalize_in_place(out, source_url)
    return out


def import_link_keys(doc: Any) -> list[str]:
    """Every `import-link://` key in `doc`'s link marks, in document order, once each."""
    out: dict[str, None] = {}

    def walk(node: Any) -> None:
        if isinstance(node, list):
            for c in node:
                walk(c)
            return
        if not isinstance(node, dict):
            return
        for m in node.get("marks") or []:
            href = (m.get("attrs") or {}).get("href") if isinstance(m, dict) else None
            if isinstance(m, dict) and m.get("type") == "link" and isinstance(href, str) \
                    and href.startswith(LINK_PREFIX):
                out.setdefault(href[len(LINK_PREFIX):], None)
        walk(node.get("content"))

    walk(doc)
    return list(out)


# ── linkify (L-3) ────────────────────────────────────────────────────────────

def _kept(m: Any) -> bool:
    return m.schema in _KEEP_SCHEMAS or (m.schema == "" and m.raw[:4].lower() == "www.")


def _href_for(m: Any, text: str) -> str:
    if m.schema == "":
        return "https://" + text
    return text if text.lower().startswith(m.schema) else m.schema + text


def _matches(text: str) -> list[tuple[int, int, str]]:
    """`(start, end, href)` per kept link in `text`, in order, non-overlapping."""
    with _LINKIFY_LOCK:
        if not _LINKIFY.pretest(text):
            return []
        found = _LINKIFY.match(text) or []
        out: list[tuple[int, int, str]] = []
        for m in found:
            if not _kept(m):
                continue
            t = text[m.index:m.last_index]
            stop = _STOP_RE.search(t)
            if stop is not None:
                t = t[:stop.start()]
            t = _TRAIL_RE.sub("", t)
            if not t:
                continue
            again = _LINKIFY.match(t) or []
            if len(again) != 1 or again[0].index != 0 or again[0].last_index != len(t) \
                    or not _kept(again[0]):
                continue
            out.append((m.index, m.index + len(t), _href_for(again[0], t)))
        return out


def _is_plain_run(node: Any) -> bool:
    if not isinstance(node, dict) or node.get("type") != "text" or not isinstance(node.get("text"), str):
        return False
    return not any(isinstance(m, dict) and m.get("type") in _BOUNDARY_MARKS for m in node.get("marks") or [])


def _piece(node: dict, text: str, href: str | None) -> dict:
    out = copy.deepcopy(node)  # pieces of one run never share a marks list or a mark dict
    out["text"] = text
    if href is not None:
        out["marks"] = [*(out.get("marks") or []), {"type": "link", "attrs": {"href": href}}]
    return out


def _linkify_run(run: list[dict]) -> list[dict]:
    text = "".join(n["text"] for n in run)
    matches = _matches(text)
    if not matches:
        return run
    out: list[dict] = []
    mi = 0
    pos = 0  # offset of the current node's first character in `text`
    for node in run:
        start, end = pos, pos + len(node["text"])
        cut = start
        while cut < end:
            while mi < len(matches) and matches[mi][1] <= cut:
                mi += 1
            if mi < len(matches) and matches[mi][0] <= cut:  # inside a match
                stop = min(end, matches[mi][1])
                out.append(_piece(node, text[cut:stop], matches[mi][2]))
            else:
                stop = min(end, matches[mi][0]) if mi < len(matches) else end
                out.append(_piece(node, text[cut:stop], None) if (cut, stop) != (start, end) else node)
            cut = stop
        if start == end:
            out.append(node)
        pos = end
    return out


def _linkify_inline(content: list[Any]) -> list[Any]:
    out: list[Any] = []
    run: list[dict] = []
    for child in content:
        if _is_plain_run(child):
            run.append(child)
            continue
        if run:
            out.extend(_linkify_run(run))
            run = []
        out.append(child)
    if run:
        out.extend(_linkify_run(run))
    return out


def _linkify_in_place(node: Any) -> None:
    if not isinstance(node, dict) or node.get("type") in _SKIP_SUBTREES:
        return
    content = node.get("content")
    if not isinstance(content, list):
        return
    if any(isinstance(c, dict) and c.get("type") == "text" for c in content):
        content = node["content"] = _linkify_inline(content)
    for child in content:
        if isinstance(child, dict) and child.get("type") != "text":
            _linkify_in_place(child)


def linkify_doc(doc: dict) -> dict:
    """A deep copy of `doc` with bare URLs, `www.` hosts and emails turned into links."""
    out = copy.deepcopy(doc)
    _linkify_in_place(out)
    return out
