"""D3: shared converter fidelity (every connector and file importer).

One section per D3 item. Brief: `.superpowers/sdd/2026-11-01-connector-fidelity-c-obsidian/
d3-brief.md`. The client lane's half of each item is pinned in
`app/src/pages/journal-2-0/lib/importer/convert.test.js` and the parity rails.
"""

from __future__ import annotations

import json
import pathlib
from typing import Any

import pytest

from api.services.journal_two.note_connectors.convert.mddoc import html_to_tiptap, md_to_tiptap
from api.services.journal_two.note_connectors.convert.notion_blocks import _rich_text_to_inline


def _texts(node: Any, out: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    out = [] if out is None else out
    if isinstance(node, dict):
        if node.get("type") == "text":
            out.append(node)
        for child in node.get("content") or []:
            _texts(child, out)
    elif isinstance(node, list):
        for child in node:
            _texts(child, out)
    return out


def _mark_types(node: dict[str, Any]) -> list[str]:
    return [m["type"] for m in node.get("marks") or []]


def _valid_mark_set(types: list[str]) -> bool:
    """The editor schema's rule: one mark per type, and `code` alone (D3 item 2)."""
    return len(types) == len(set(types)) and ("code" not in types or types == ["code"])


# ── item 2: a code run carries no other mark, and a link survives ────────────


def test_bold_around_code_keeps_only_the_code_mark():
    runs = _texts(md_to_tiptap("**`x`**")["doc"])
    assert [(r["text"], _mark_types(r)) for r in runs] == [("x", ["code"])]


def test_a_code_run_inside_a_link_keeps_the_link_and_drops_the_code_mark():
    runs = _texts(md_to_tiptap("see [the `x` plan](https://example.com/p) end")["doc"])
    assert [(r["text"], _mark_types(r)) for r in runs] == [
        ("see ", []), ("the x plan", ["link"]), (" end", []),
    ]


def test_a_bold_code_run_inside_a_link_keeps_link_and_bold():
    runs = _texts(md_to_tiptap("[**`x`**](https://example.com/p)")["doc"])
    assert [(r["text"], sorted(_mark_types(r))) for r in runs] == [("x", ["bold", "link"])]


@pytest.mark.parametrize("html, expected", [
    ("<p><b><code>x</code></b></p>", [("x", ["code"])]),
    ("<p><code><b>x</b></code></p>", [("x", ["code"])]),
    ('<p><a href="https://e.com"><code>x</code></a></p>', [("x", ["link"])]),
    ('<p><code><a href="https://e.com">x</a></code></p>', [("x", ["link"])]),
    ('<p><a href="https://e.com">a <code>b</code> c</a></p>', [("a b c", ["link"])]),
])
def test_the_html_walker_writes_the_same_mark_sets(html, expected):
    runs = _texts(html_to_tiptap(html)["doc"])
    assert [(r["text"], _mark_types(r)) for r in runs] == expected


def test_notion_rich_text_code_with_bold_or_a_link():
    rich = [
        {"type": "text", "plain_text": "a", "annotations": {"bold": True, "code": True}},
        {"type": "text", "plain_text": "b", "annotations": {"code": True},
         "href": "https://example.com/x"},
    ]
    runs = _rich_text_to_inline(rich)
    assert [(r["text"], _mark_types(r)) for r in runs] == [("a", ["code"]), ("b", ["link"])]


def test_an_obsidian_callout_title_code_run_stays_code_only():
    from api.services.journal_two.note_connectors.providers.obsidian import _callouts_in_doc
    doc = md_to_tiptap("> [!tip] use `x` now")["doc"]
    runs = _texts(_callouts_in_doc(doc)["content"][0]["content"][0])
    assert [(r["text"], sorted(_mark_types(r))) for r in runs] == [
        ("use ", ["bold"]), ("x", ["code"]), (" now", ["bold"]),
    ]


_MARKUP = ["**", "*", "~~", "`", "[", "](https://e.com/x)", "<mark>", "</mark>", "<code>",
           "</code>", "<b>", "</b>", '<a href="https://e.com/y">', "</a>", "x", " "]


def test_no_converter_output_holds_an_invalid_mark_set():
    """A property sweep: every 4-piece combination of the markup above, through both
    walkers. Every text run must carry a mark set the editor's schema accepts."""
    import itertools
    bad = []
    for combo in itertools.product(_MARKUP, repeat=4):
        src = "a " + "".join(combo) + "x" + "".join(reversed(combo)) + " b"
        for out in (md_to_tiptap(src), html_to_tiptap(src)):
            for run in _texts(out["doc"]):
                if not _valid_mark_set(_mark_types(run)):
                    bad.append((src, run))
    assert bad[:5] == []


# ── item 1: a fenced code block's final newline is its line end, never content ──


def _code_text(doc: dict[str, Any]) -> list[str]:
    return ["".join(t["text"] for t in n.get("content") or []) for n in doc["content"]
            if n["type"] == "codeBlock"]


@pytest.mark.parametrize("src, expected", [
    ("```\nx\n```", ["x"]),
    ("~~~py\na\nb\n~~~", ["a\nb"]),
    # The member's own blank line before the closing fence is content and stays.
    ("```\nx\n\n```", ["x\n"]),
    ("    indented\n", ["indented"]),
    ("```\n```", [""]),
])
def test_markdown_code_block_drops_only_the_final_line_end(src, expected):
    assert _code_text(md_to_tiptap(src)["doc"]) == expected


@pytest.mark.parametrize("html, expected", [
    ("<pre><code>x\n</code></pre>", ["x"]),
    ("<pre>x\n\n</pre>", ["x\n"]),
    ("<pre><code>a\nb</code></pre>", ["a\nb"]),
])
def test_html_pre_drops_only_the_final_line_end(html, expected):
    assert _code_text(html_to_tiptap(html)["doc"]) == expected


def test_a_code_block_round_trips_through_the_markdown_export_without_drift():
    """The export writes ```` ```lang\n{code}\n``` ```` (`notes_export._block`); reading that
    back must give the same code, however many trailing newlines it holds."""
    from api.services.journal_two import notes_export
    for code in ("x", "x\n", "x\n\n", "a\n\nb"):
        node = {"type": "codeBlock", "attrs": {"language": "py"},
                "content": [{"type": "text", "text": code}]}
        md = notes_export._block(node, None)
        assert _code_text(md_to_tiptap(md)["doc"]) == [code], (code, md)


# ── item 4: no whitespace-only paragraph beside a block atom ──────────────────


def _shape(node: dict[str, Any]) -> str:
    if node["type"] == "text":
        return repr(node["text"])
    kids = node.get("content") or []
    return node["type"] + (f"({', '.join(_shape(k) for k in kids)})" if kids else "")


@pytest.mark.parametrize("src, expected", [
    ("x ![a](a.png) ![b](b.png) y",
     "doc(paragraph('x '), image, image, paragraph(' y'))"),
    ("![a](a.png) ![b](b.png)", "doc(image, image)"),
    ("| c |\n|---|\n| ![a](a.png) ![b](b.png) |",
     "doc(table(tableRow(tableHeader(paragraph('c'))), tableRow(tableCell(image, image))))"),
    # Text between the images is a paragraph, its spaces kept, as before.
    ("A ![a](a.png) between ![b](b.png) stays.",
     "doc(paragraph('A '), image, paragraph(' between '), image, paragraph(' stays.'))"),
    # A paragraph of nothing but a space, with no atom, is untouched.
    ("&#32;", "doc(paragraph(' '))"),
])
def test_markdown_side_by_side_images_leave_no_space_paragraph(src, expected):
    assert _shape(md_to_tiptap(src)["doc"]) == expected


@pytest.mark.parametrize("html, expected", [
    ('<p>x <img src="a.png"> <img src="b.png"> y</p>',
     "doc(paragraph('x '), image, image, paragraph(' y'))"),
    ('<p><img src="a.png"> </p>', "doc(image)"),
    ('<p> <img src="a.png"></p>', "doc(image)"),
    ('<p><img src="a.png"><b> </b><img src="b.png"></p>', "doc(image, image)"),
    # A line break or a no-break space is the member's, as in the client's parse.
    ('<p><img src="a.png"><br><img src="b.png"></p>', "doc(image, paragraph(hardBreak), image)"),
    ('<p><img src="a.png">' + chr(0xA0) + '<img src="b.png"></p>',
     "doc(image, paragraph(" + repr(chr(0xA0)) + "), image)"),
])
def test_html_side_by_side_images_leave_no_space_paragraph(html, expected):
    assert _shape(html_to_tiptap(html)["doc"]) == expected


# ── item 6: a host-like href is its https:// URL, as linkify writes one ───────


def _links(doc: dict[str, Any]) -> list[tuple[str, str]]:
    return [(r["text"], m["attrs"]["href"]) for r in _texts(doc) for m in r.get("marks") or []
            if m["type"] == "link"]


@pytest.mark.parametrize("src, expected", [
    ("[x](www.example.com)", [("x", "https://www.example.com")]),
    # Ruling: linkify's own decision. No `www.`, so not a web address linkify makes; TipTap's
    # allow-list refuses the bare path too, so it is text, as before D3.
    ("[x](example.com/path)", []),
    ('<a href="www.example.com/a?b=1">x</a> y', [("x", "https://www.example.com/a?b=1")]),
    # A note link is never a host: it stays as written for the engine's policy to judge.
    ("[x](notes.md)", [("x", "notes.md")]),
    ("[x](docs/page)", []),
])
def test_markdown_host_like_hrefs(src, expected):
    assert _links(md_to_tiptap(src)["doc"]) == expected


def test_html_walker_host_like_href():
    assert _links(html_to_tiptap('<p><a href="www.example.com/p">x</a></p>')["doc"]) == [
        ("x", "https://www.example.com/p")]
    assert _links(html_to_tiptap('<p><a href="example.com/p">x</a></p>')["doc"]) == []


@pytest.mark.parametrize("ticker", ["NVDA.US", "AAPL.O", "BRK.B"])
def test_a_ticker_href_never_becomes_a_link(ticker):
    """Ruling: an href is host-like only when linkify would link that exact string."""
    from api.services.journal_two.note_connectors.convert.linkify import finalize_links, host_like_href
    assert host_like_href(ticker) is None
    assert _links(finalize_links(md_to_tiptap(f"[x]({ticker})")["doc"])) == []


def test_a_connector_note_answer_wins_over_host_like():
    out = md_to_tiptap("[x](plan.co)", resolve_href=lambda h: "import-link://k:" + h)
    assert _links(out["doc"]) == [("x", "import-link://k:plan.co")]


def test_the_engine_policy_keeps_a_host_like_link_and_drops_a_note_path():
    from api.services.journal_two.note_connectors.convert.linkify import finalize_links
    doc = md_to_tiptap("[a](www.example.com) [b](notes.md)")["doc"]
    assert _links(finalize_links(doc)) == [("a", "https://www.example.com")]


# ── item 7: a block-level div is a paragraph boundary in the HTML walker ─────


_HTML_VECTORS_PATH = (pathlib.Path(__file__).resolve().parents[3] / "app" / "src" / "pages"
                      / "journal-2-0" / "lib" / "importer" / "__fixtures__" / "html_block_vectors.json")
_HTML_VECTORS = json.loads(_HTML_VECTORS_PATH.read_text(encoding="utf-8"))["vectors"]


@pytest.mark.parametrize("v", _HTML_VECTORS, ids=[v["name"] for v in _HTML_VECTORS])
def test_shared_html_block_vectors(v):
    """Items 7 and 8: the SHARED vectors `convert.test.js` also reads, so the server's HTML
    walker and the client's parse read one block structure."""
    assert _shape(html_to_tiptap(v["html"])["doc"]) == v["shape"]


def test_the_html_vectors_cover_item_7():
    names = {v["name"] for v in _HTML_VECTORS}
    assert {"two divs are two paragraphs", "spans join"} <= names


def test_a_marked_run_in_a_div_keeps_its_mark():
    runs = _texts(html_to_tiptap("<div><b>a</b> c</div><div>d</div>")["doc"])
    assert [(r["text"], _mark_types(r)) for r in runs] == [("a", ["bold"]), (" c", []), ("d", [])]


# ── item 8: a list item opening with a block is repaired as the editor's parser does ──


@pytest.mark.parametrize("src, expected", [
    ("- - a\n- b",
     "doc(bulletList(listItem(paragraph)), bulletList(listItem(paragraph('a'))), "
     "bulletList(listItem(paragraph('b'))))"),
    ("- ![x](a.png)\n- b",
     "doc(bulletList(listItem(paragraph)), image, bulletList(listItem(paragraph('b'))))"),
    ("1. - a\n2. b",
     "doc(orderedList(listItem(paragraph)), bulletList(listItem(paragraph('a'))), "
     "bulletList(listItem(paragraph('b'))))"),
    ("- a\n  - b", "doc(bulletList(listItem(paragraph('a'), bulletList(listItem(paragraph('b'))))))"),
])
def test_markdown_list_item_repair(src, expected):
    """The markdown lane wrote `listItem(image)` and `listItem(bulletList)`, list items the
    schema refuses; the client's parse (same markdown, `mdToHtml` + `htmlToNote`) repairs them
    into these shapes (measured), so the server writes the same."""
    assert _shape(md_to_tiptap(src)["doc"]) == expected


# ── item 5: the data-URI image pass is linear ────────────────────────────────


def _reference_extract(md: str) -> str:
    """The pass as one `re.sub` over the whole `_DATA_IMAGE_MD_RE` (what it was): correct but
    quadratic. The linear pass must make exactly its replacements."""
    from api.services.journal_two.note_connectors.convert import mddoc

    def repl(m):
        mime = m.group("mime").strip()
        if mddoc._is_image_mime(mime):
            return m.group(0)
        alt = m.group("alt").strip()
        shown = mime or "no type"
        return f"[unsupported image: {alt}, {shown}]" if alt else f"[unsupported image: {shown}]"
    return mddoc._DATA_IMAGE_MD_RE.sub(repl, md)


def test_the_linear_data_uri_pass_makes_the_regex_replacements():
    import random
    from api.services.journal_two.note_connectors.convert import mddoc
    pieces = ["![", "]", "(", ")", "](", "data:", "text/plain", "image/png", ";base64", ",",
              "x", " ", '"t"', "a", "![a](data:text/plain,1)", "![](data:,z)", "[", "\n"]
    rnd = random.Random(7)
    for _ in range(4000):
        md = "".join(rnd.choice(pieces) for _ in range(rnd.randrange(1, 18)))
        assert mddoc._extract_data_uri_images(md) == _reference_extract(md), md


@pytest.mark.parametrize("unit", ["![[", "![", "![a](data:", "](data:a,", "![a](data:;", '](data:a, "'])
def test_the_data_uri_pass_is_linear_on_a_long_run(unit):
    """D3 item 5: 1.1 s at 39 KB of `![[`, 2.2 s at 40 KB of `![a](data:` before."""
    import time
    from api.services.journal_two.note_connectors.convert import mddoc
    md = unit * (160_000 // len(unit))
    started = time.perf_counter()
    mddoc._extract_data_uri_images(md)
    assert time.perf_counter() - started < 0.25, unit


def test_a_non_image_data_uri_still_becomes_its_marker():
    out = md_to_tiptap("a ![pic](data:text/plain,hello) b ![](data:image/png;base64,AAAA)")
    texts = "".join(r["text"] for r in _texts(out["doc"]))
    assert "[unsupported image: pic, text/plain]" in texts
    assert [m["ref"] for m in out["media"]] == ["md-img-1.png"]
