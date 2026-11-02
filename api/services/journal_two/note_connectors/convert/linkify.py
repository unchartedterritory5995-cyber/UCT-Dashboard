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
  * B-14 (controller ruling: every stored link has a door or is plain text) -- any
    other scheme is kept, unchanged, ONLY when `kept_scheme_href` allows it:
    `http:`/`https:` (`//` + a host, no whitespace, no userinfo, port <= 65535),
    `mailto:` with an `@` address, `tel:`/`sms:` with a number (digits, an optional
    leading `+`, spaces `-` `.` `(` `)`). Everything else (`ftp:`, `zoommtg:`, a bare
    `mailto:`/`tel:`, `https://a b`, `https://user:pw@...`) -> text;
  * `//host...` -> `https://host...`;
  * relative, `#...`, `?...` -> resolved against the note's own http(s) source URL when
    one is known, else text. Both results pass `kept_scheme_href` too, and a relative
    href holding whitespace is text (the two runtimes' URL resolvers read it differently).
    ⛔ Never against uctintelligence.com: in the app a relative
    href would land on OUR origin, which is never what the source author meant.

`linkify_doc(doc)` -- bare `https://...`, `http://...`, `www....`, `mailto:` and email
addresses in plain text become link marks. ONE module-level `LinkifyIt()` (linkify-it's
defaults, the same behaviour markdown-it's linkify has on the client), then:
  * keep a match only if its schema is `http:`/`https:`/`mailto:` (a bare email counts),
    or its schema is empty and its raw text starts with `www.` (href gets `https://`).
    Every other fuzzy domain is dropped: `NVDA.US`, `BRK.B`, `example.com` are tickers
    and prose far more often than links. `ftp:` and `//` matches are dropped too, and
    (B-14) so is any match whose href `kept_scheme_href` refuses (`https://user:pw@x`),
    so linkify can never make a link the href policy would turn back into text;
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
(`vectors` for linkify, `href_vectors` for `resolve_href`) are asserted by `test_linkify.py` here and by Plan B's client test, so the sides cannot
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
# ⛔ Stripped with `str.rstrip`, never a `[...]+$` regex: Python's `re.sub` retries that at
# every start position, so a long punctuation run INSIDE a URL (`a....b`) was quadratic
# (32k dots = 2.9 s, under `_LINKIFY_LOCK` and holding the GIL) on member-controlled text.
_TRAIL_CHARS = ".,:;!?"
_SKIP_SUBTREES = frozenset({"codeBlock", "inlineMath", "blockMath"})
_BOUNDARY_MARKS = frozenset({"code", "link", "__uctRefusedLink__"})  # the last: `_REFUSED_MARK`

_KEPT_PREFIXES = (LINK_PREFIX, REF_PREFIX, "/journal", "/terminal?cmd=", "/api/j2/notes/attachments/")
_UNSAFE_SCHEMES = frozenset({"javascript", "data", "vbscript", "file"})
_APP_SCHEMES = frozenset({"evernote", "notion", "obsidian", "onenote"})
_SCHEME_RE = re.compile(r"^([a-zA-Z][a-zA-Z0-9+.\-]*):")
_NOTION_ID_SRC = r"[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
_NOTION_ID_RE = re.compile(_NOTION_ID_SRC)
_NOTION_SEGMENT_RE = re.compile(r"(?:.*-)?(" + _NOTION_ID_SRC + ")")
_NOTION_HOSTS = frozenset({"notion.so", "www.notion.so", "notion.com", "www.notion.com"})
_APP_HOST = "uctintelligence.com"


# ── href policy (L-4) ────────────────────────────────────────────────────────

def canonical_notion_page_id(page_id: Any) -> Any:
    """A Notion page id in its ONE key form, the dashed lowercase UUID. The API writes ids that
    way, but an href may carry the same id undashed or upper-cased; every `notion:` key is built
    through `notion_note_key`, so the two can never name one page twice. Anything that is not a
    32-hex id is returned as it came (never guessed at)."""
    if not isinstance(page_id, str):
        return page_id
    m = _NOTION_ID_RE.fullmatch(page_id.strip())
    if m is None:
        return page_id
    h = m.group(0).replace("-", "").lower()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


def notion_note_key(page_id: Any) -> str:
    """`notion:<page id>`: THE builder of a Notion note key, for the provider's `import_key`
    and for every pending `import-link://notion:` mark the converter and this module write."""
    return f"notion:{canonical_notion_page_id(page_id)}"


def _page_id_of_last_segment(path: str) -> str | None:
    """The dashed lowercase UUID a Notion path names: its last segment is the id itself or
    `<slug>-<id>` (32 hex, dashed or not). Anything else (a hex tail glued to a word, an id
    followed by a further segment) names no page."""
    segment = path.rstrip("/").rsplit("/", 1)[-1]
    m = _NOTION_SEGMENT_RE.fullmatch(segment)
    return None if m is None else canonical_notion_page_id(m.group(1))


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
    return notion_note_key(pid) if pid else None


# ── the kept-link allow-list (B-14) ──────────────────────────────────────────
# ⛔ The client's `lib/linkSchemes.js` states the same rule; the shared `href_vectors` in
# `linkify_vectors.json` pin the two together. Change one, change both, add the vector.
_WEB_RE = re.compile(r"^https?://([^/?#]*)", re.IGNORECASE)
# host[:port]: a bracketed IPv6 literal, or a name with none of the characters a URL parser
# treats as a delimiter or forbids in a host (`%` included: a percent-encoded host is decoded
# by the browser into something other than what the member read).
_AUTHORITY_RE = re.compile(r'^(\[[0-9A-Fa-f:.]+\]|[^\[\]:@/?#\\%<>^|"`{}]+)(?::([0-9]*))?$')
_NUMERIC_LABEL_RE = re.compile(r"^(?:[0-9]+|0[xX][0-9A-Fa-f]*)$")
_IPV4_PART_RE = re.compile(r"^(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])$")
_MAILTO_RE = re.compile(r"^mailto:", re.IGNORECASE)
_NUMBER_RE = re.compile(r"^(tel|sms):(\+?[0-9 ().\-]*[0-9][0-9 ().\-]*)$", re.IGNORECASE)


# Whitespace by EITHER runtime's reading that TipTap's class lacks: U+FEFF and U+202F are a JS
# `\s` (the editor door's own checks refuse them), U+0085 and U+202F are Python `isspace`.
# Refusing all three keeps every kept link openable and both sides equal.
_EXTRA_SPACES = (chr(0xFEFF), chr(0x202F), chr(0x85))


def _clean(x: str) -> bool:
    """No whitespace or invisible character in `x`, by TipTap's, JS's or Python's reading."""
    return link_href_as_read(x) == x and not any(c in x for c in _EXTRA_SPACES)


def _web_host_ok(h: str) -> bool:
    m = _WEB_RE.match(h)
    if m is None:
        return False
    a = _AUTHORITY_RE.match(m.group(1))
    if a is None:
        return False
    host, port = a.group(1), a.group(2)
    if port and int(port) > 65535:
        return False
    if host.startswith("["):
        return True
    labels = host.split(".")
    if len(labels) > 1 and labels[-1] == "":
        labels = labels[:-1]
    # A numeric last label makes a browser read the host as IPv4; only a plain dotted quad
    # reads as what the member saw (`1.2.3.999` fails to parse, `1.2.3` is `1.2.0.3`).
    if _NUMERIC_LABEL_RE.match(labels[-1]):
        return len(labels) == 4 and all(_IPV4_PART_RE.match(p) for p in labels)
    return True


def kept_scheme_href(h: str) -> str | None:
    """`h` (already trimmed) when its scheme has a door in the editor, else None (text).

    http(s): `//` + a host, no whitespace or invisible character, no userinfo, a port of at
    most 65535. mailto: an address with an `@`, no whitespace. tel:/sms: a number -- digits, an
    optional leading `+`, spaces `-` `.` `(` `)`, at least one digit, nothing else."""
    if _WEB_RE.match(h):
        return h if _clean(h) and _web_host_ok(h) else None
    if _MAILTO_RE.match(h):
        rest = h[len("mailto:"):]
        return h if "@" in rest and _clean(rest) else None
    return h if _NUMBER_RE.match(h) else None


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
    if not _clean(href):
        return None  # B-14: whitespace in a relative href; the two runtimes' resolvers read it differently
    try:
        # `href` has no scheme (`resolve_href` decided that), so the result keeps the base's.
        return kept_scheme_href(urljoin(source_url.strip(), href))
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
        return kept_scheme_href(h)
    if read.startswith("//"):
        # B-14 fix round 1: built from `h`, never `read`: `//ex.com/a<TAB>b` must not become
        # `https://ex.com/ab`, a target the source never named. Whitespace in `h` -> text.
        return kept_scheme_href("https:" + h)
    return _resolve_relative(h, source_url)


# B-14 fix round 1: the text a REFUSED link leaves behind carries this mark between the two
# passes of `finalize_links`, so linkify never re-links it (`https://x.com/a b` must not come
# back as a link to `https://x.com/a`). A linkify boundary; it never leaves this module.
_REFUSED_MARK = "__uctRefusedLink__"


def _normalize_in_place(node: Any, source_url: str | None, mark_refused: bool = False) -> None:
    if isinstance(node, list):
        for c in node:
            _normalize_in_place(c, source_url, mark_refused)
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
                    if mark_refused:
                        kept.append({"type": _REFUSED_MARK})
                    continue  # the mark goes; the text and its other marks stay
                m["attrs"] = {**attrs, "href": href}
            kept.append(m)
        if kept:
            node["marks"] = kept
        else:
            del node["marks"]
    _normalize_in_place(node.get("content"), source_url, mark_refused)


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
            t = t.rstrip(_TRAIL_CHARS)
            if not t:
                continue
            again = _LINKIFY.match(t) or []
            if len(again) != 1 or again[0].index != 0 or again[0].last_index != len(t) \
                    or not _kept(again[0]):
                continue
            href = _href_for(again[0], t)
            if kept_scheme_href(href) is None:
                continue  # B-14: never make a link the href policy would turn back into text
            out.append((m.index, m.index + len(t), href))
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


def _strip_refused_marks(node: Any) -> None:
    if isinstance(node, list):
        for c in node:
            _strip_refused_marks(c)
        return
    if not isinstance(node, dict):
        return
    marks = node.get("marks")
    if isinstance(marks, list) and any(isinstance(m, dict) and m.get("type") == _REFUSED_MARK for m in marks):
        kept = [m for m in marks if not (isinstance(m, dict) and m.get("type") == _REFUSED_MARK)]
        if kept:
            node["marks"] = kept
        else:
            del node["marks"]
    _strip_refused_marks(node.get("content"))


def finalize_links(doc: dict, source_url: str | None = None) -> dict:
    """`linkify_doc(normalize_link_hrefs(doc))`, except that the text a REFUSED link leaves is
    never re-linked (B-14 fix round 1): a deep copy, every href through `resolve_href`, then
    bare URLs in plain text become links, never inside a refused link's text. THE entry point
    for an import's doc (the engine's `_finalize_remote_doc`)."""
    out = copy.deepcopy(doc)
    _normalize_in_place(out, source_url, mark_refused=True)
    _linkify_in_place(out)
    _strip_refused_marks(out)
    return out
