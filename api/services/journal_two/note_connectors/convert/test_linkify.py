"""Connector fidelity Plan A Task 10 (L-3, L-4): bare URLs become links, and every
existing link href goes through one scheme policy, on every server import path.

The linkify cases come from the SHARED vector file Plan B's client test also reads
(`app/src/pages/journal-2-0/lib/importer/__fixtures__/linkify_vectors.json`), so the
two sides cannot drift."""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from api.services.journal_two.note_connectors.convert.linkify import (
    import_link_keys, linkify_doc, normalize_link_hrefs, resolve_href,
)

_VECTORS = (
    Path(__file__).resolve().parents[5] / "app" / "src" / "pages" / "journal-2-0" / "lib"
    / "importer" / "__fixtures__" / "linkify_vectors.json"
)
VECTORS = json.loads(_VECTORS.read_text(encoding="utf-8"))["vectors"]
EXISTING = "https://existing.example/"


def _doc(*inline) -> dict:
    content = [{"type": "text", "text": x} if isinstance(x, str) else x for x in inline]
    return {"type": "doc", "content": [{"type": "paragraph", "content": content}]}


def _run(text: str, *marks: dict) -> dict:
    return {"type": "text", "text": text, "marks": [dict(m) for m in marks]}


def _link(href: str) -> dict:
    return {"type": "link", "attrs": {"href": href}}


def _texts(node):
    if isinstance(node, dict):
        if node.get("type") == "text":
            yield node
        for c in node.get("content") or []:
            yield from _texts(c)


def _links(doc) -> list[tuple[str, str]]:
    """(text, href) per link, adjacent runs with the same href joined."""
    out: list[tuple[str, str]] = []
    prev = None
    for t in _texts(doc):
        href = next((m["attrs"]["href"] for m in t.get("marks") or [] if m.get("type") == "link"), None)
        if href is not None and href == prev:
            out[-1] = (out[-1][0] + t["text"], href)
        elif href is not None:
            out.append((t["text"], href))
        prev = href
    return out


def _vector_doc(context: str, text: str) -> dict:
    if context == "plain":
        return _doc(text)
    if context == "inline_code":
        return _doc("see ", _run(text, {"type": "code"}), " now")
    if context == "link":
        return _doc("see ", _run(text, _link(EXISTING)), " now")
    if context == "code_block":
        return {"type": "doc", "content": [{"type": "codeBlock", "content": [{"type": "text", "text": text}]}]}
    # Math nodes are atoms in the editor; a text child here proves the SUBTREE is skipped,
    # not merely that an atom has nothing to read.
    if context == "inline_math":
        return _doc("see ", {"type": "inlineMath", "attrs": {"latex": text},
                             "content": [{"type": "text", "text": text}]})
    if context == "block_math":
        return {"type": "doc", "content": [{"type": "blockMath", "attrs": {"latex": text},
                                            "content": [{"type": "text", "text": text}]}]}
    raise AssertionError(f"unknown vector context {context!r}")


@pytest.mark.parametrize("v", VECTORS, ids=[v["name"] for v in VECTORS])
def test_shared_linkify_vectors(v):
    doc = _vector_doc(v["context"], v["text"])
    out = linkify_doc(doc)
    want = [(x["text"], x["href"]) for x in v["links"]]
    if v["context"] == "plain":
        assert _links(out) == want
        # linkify never changes a character of the text
        assert "".join(t["text"] for t in _texts(out)) == v["text"]
    else:
        assert want == []
        assert out == doc  # untouched, byte for byte


def test_vector_file_covers_every_context_and_the_ruled_cases():
    contexts = {v["context"] for v in VECTORS}
    assert contexts == {"plain", "inline_code", "code_block", "link", "inline_math", "block_math"}
    texts = " ".join(v["text"] for v in VECTORS)
    for needle in ("NVDA.US", "example.com", "BRK.B", "v2.3", "mailto:", "www.", "http://",
                   "Bracket_(disambiguation)", "。", "münchen"):
        assert needle in texts


def test_bare_urls_www_and_email_become_links():
    out = linkify_doc(_doc("see https://example.com/x?y=1 and www.example.org or a@b.com"))
    # ⛔ Controller ruling 3 overrides the brief's `http://www.example.org`: Plan B's rule is https.
    assert _links(out) == [("https://example.com/x?y=1", "https://example.com/x?y=1"),
                           ("www.example.org", "https://www.example.org"), ("a@b.com", "mailto:a@b.com")]


def test_fuzzy_bare_domains_never_link():   # Plan B's rule: tickers are not domains
    assert _links(linkify_doc(_doc("NVDA.US and example.com and ftp://x.org and //cdn.x"))) == []


def test_linkify_edge_punctuation_and_code():
    bold = {"type": "bold"}
    doc = {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "(see https://x.com/a)."}]},
        {"type": "paragraph", "content": [
            {"type": "text", "text": "code "},
            _run("https://code.example/x", {"type": "code"}),
            {"type": "text", "text": " and "},
            _run("https://linked.example/y", _link(EXISTING)),
            {"type": "text", "text": " and "},
            _run("https://bold.example/z.", bold),
        ]},
        {"type": "codeBlock", "content": [{"type": "text", "text": "curl https://block.example/q"}]},
    ]}
    out = linkify_doc(doc)
    assert _links(out) == [
        ("https://x.com/a", "https://x.com/a"),
        ("https://linked.example/y", EXISTING),          # the existing link, untouched
        ("https://bold.example/z", "https://bold.example/z"),
    ]
    para = out["content"][1]["content"]
    assert para[1] == _run("https://code.example/x", {"type": "code"})   # never inside code
    assert para[3] == _run("https://linked.example/y", _link(EXISTING))  # never re-linked
    # the bold mark is kept on the linkified run, and the trailing period stays plain bold
    assert para[5] == {"type": "text", "text": "https://bold.example/z",
                       "marks": [bold, _link("https://bold.example/z")]}
    assert para[6] == {"type": "text", "text": ".", "marks": [bold]}
    assert out["content"][2] == doc["content"][2]                       # codeBlock untouched


def test_a_url_split_across_marks_is_one_link():
    out = linkify_doc(_doc("go https://x.com/", _run("long", {"type": "bold"}), "/path now"))
    assert _links(out) == [("https://x.com/long/path", "https://x.com/long/path")]
    assert out["content"][0]["content"][2]["marks"] == [{"type": "bold"}, _link("https://x.com/long/path")]


def test_a_code_or_link_run_is_a_hard_boundary():
    # the URL before the code run is found on its own; the code run is never part of it
    out = linkify_doc(_doc("see https://x.com/a", _run("b", {"type": "code"}), " end"))
    assert _links(out) == [("https://x.com/a", "https://x.com/a")]
    assert out["content"][0]["content"][2] == _run("b", {"type": "code"})


def test_linkify_is_pure():
    doc = _doc("see https://x.com/a and www.y.com", _run("bold", {"type": "bold"}))
    snapshot = copy.deepcopy(doc)
    out = linkify_doc(doc)
    assert doc == snapshot
    assert out is not doc and out["content"] is not doc["content"]
    doc2 = _doc(_run("x", _link("javascript:alert(1)")))
    snap2 = copy.deepcopy(doc2)
    normalize_link_hrefs(doc2)
    assert doc2 == snap2


@pytest.mark.parametrize("href", [
    "javascript:alert(1)", "JavaScript:x", " javascript:x", "java\tscript:alert(1)",
    "data:text/html,x", "vbscript:x", "file:///C:/a.pdf",
    "evernote:///view/1/s1/g/g/", "onenote:https://x/y.one#p", "obsidian://open?vault=V&file=a",
    "notion://www.notion.so/no-page-id-here",
    "../x.html", "#top", "?q=1", "/news/a-123", "relative/page", "",
])
def test_unsafe_and_app_schemes_and_relative_links_become_text(href):
    out = normalize_link_hrefs(_doc("before ", _run("label", {"type": "bold"}, _link(href)), " after"))
    assert _links(out) == []
    # the text and its other marks survive
    assert out["content"][0]["content"][1] == {"type": "text", "text": "label", "marks": [{"type": "bold"}]}


@pytest.mark.parametrize("href", [
    "/journal?j2tab=notebook&note=abc", "/terminal?cmd=NVDA", "import-link://k",
    "import-ref://media-1", "/api/j2/notes/attachments/a.png",
    "https://x.com/a", "http://x.com", "mailto:me@x.com",
    "tel:+15551234", "ftp://x.org/f", "zoommtg://zoom.us/join?confno=1",
])
def test_internal_and_pending_links_are_kept(href):
    out = normalize_link_hrefs(_doc(_run("label", _link(href))))
    assert _links(out) == [("label", href)]


def test_protocol_relative_gets_https_and_whitespace_is_trimmed():
    assert resolve_href("//cdn.example.com/x.jpg") == "https://cdn.example.com/x.jpg"
    assert resolve_href(" https://spaced.example.com ") == "https://spaced.example.com"


def test_relative_resolves_only_against_a_known_http_source_url():
    assert resolve_href("/news/a-123", "https://news.example.com/2026/clip") == "https://news.example.com/news/a-123"
    assert resolve_href("#section", "https://news.example.com/p") == "https://news.example.com/p#section"
    assert resolve_href("/news/a-123", None) is None
    assert resolve_href("#section", "notion://x") is None
    # an unsafe scheme hidden by an invisible character is caught even when a source URL
    # would otherwise resolve it as "relative" (Python's urljoin strips the tab itself)
    for sneaky in ("java\tscript:alert(1)", "\x01javascript:alert(1)", "da\nta:text/html,x"):
        assert resolve_href(sneaky, "https://news.example.com/p") is None
    assert resolve_href("/\t/cdn.example.com/x") == "https://cdn.example.com/x"
    # ⛔ never against the app's own origin
    assert resolve_href("/news/a-123", "https://uctintelligence.com/journal") is None
    assert resolve_href("#x", "https://www.uctintelligence.com/a") is None


def test_notion_deep_link_with_a_page_id_becomes_a_pending_import_link():
    pid = "0123456789abcdef0123456789abcdef"
    want = "import-link://notion:01234567-89ab-cdef-0123-456789abcdef"
    assert resolve_href(f"notion://www.notion.so/ws/My-Page-{pid}") == want
    assert resolve_href(f"notion://www.notion.so/{pid}?pvs=4") == want
    out = normalize_link_hrefs(_doc(_run("My Page", _link(f"notion://www.notion.so/My-Page-{pid}"))))
    assert _links(out) == [("My Page", want)]
    assert import_link_keys(out) == ["notion:01234567-89ab-cdef-0123-456789abcdef"]


def test_a_large_doc_linkifies_in_linear_time():
    import time
    para = {"type": "paragraph", "content": [{"type": "text", "text": "word https://x.com/a NVDA.US " * 50}]}
    doc = {"type": "doc", "content": [copy.deepcopy(para) for _ in range(400)]}
    t0 = time.perf_counter()
    out = linkify_doc(doc)
    elapsed = time.perf_counter() - t0
    assert len(_links(out)) == 400 * 50
    assert elapsed < 5.0, elapsed
