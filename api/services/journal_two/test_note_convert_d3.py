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


# ── follow-up (ruling 2): a raw markdown HTML block renders, sanitised ───────

_MD_VECTORS = json.loads(_HTML_VECTORS_PATH.read_text(encoding="utf-8"))["markdown_vectors"]


@pytest.mark.parametrize("v", _MD_VECTORS, ids=[v["name"] for v in _MD_VECTORS])
def test_shared_markdown_raw_html_vectors(v):
    """The SHARED vectors `convert.test.js` also reads (client: `mdToHtml` + `htmlToNote`)."""
    assert _shape(md_to_tiptap(v["md"])["doc"]) == v["shape"]


def test_a_raw_block_never_mints_an_attachment_or_an_unsafe_image():
    out = md_to_tiptap('<a href="import-attachment-ref://x.pdf">y</a>\n\nz')
    assert "attachmentChip" not in _shape(out["doc"]) and out["media"] == []
    out = md_to_tiptap('<div><img src="javascript:alert(1)"></div>')
    assert out["media"] == [] and _shape(out["doc"]) == "doc(paragraph('[unsupported image]'))"
    out = md_to_tiptap('<div><img src="java&#9;script:alert(1)"></div>', unsafe_image_notice=True)
    assert out["media"] == [] and out["doc"]["content"][0]["type"] == "importNotice"
    out = md_to_tiptap('<div><a href="javascript:alert(1)">x</a></div>')
    assert _links(out["doc"]) == []


# ── follow-up (difference 1): an unsafe raw <img> is the same notice on both lanes ──

_UNSAFE_IMG_VECTORS = json.loads(_HTML_VECTORS_PATH.read_text(encoding="utf-8"))["unsafe_image_vectors"]


def _notices(node: Any, out: list | None = None) -> list:
    out = [] if out is None else out
    if isinstance(node, dict):
        if node.get("type") == "importNotice":
            out.append([node["attrs"]["reason"], node["attrs"].get("name")])
        for child in node.get("content") or []:
            _notices(child, out)
    return out


@pytest.mark.parametrize("v", _UNSAFE_IMG_VECTORS, ids=[v["name"] for v in _UNSAFE_IMG_VECTORS])
def test_shared_unsafe_image_vectors(v):
    out = md_to_tiptap(v["md"], unsafe_image_notice=True)
    assert _notices(out["doc"]) == v["notices"]
    assert out["media"] == []


# ── follow-up (difference 2): <aside> and <details> are a callout and a toggle ──

_BLOCK_NODE_VECTORS = json.loads(_HTML_VECTORS_PATH.read_text(encoding="utf-8"))["block_node_vectors"]


def _node_attrs(node: Any, out: list | None = None) -> list:
    from api.services.journal_two.note_connectors.convert.mddoc import CALLOUT_DEFAULT_EMOJI
    out = [] if out is None else out
    if isinstance(node, dict):
        a = node.get("attrs") or {}
        if node.get("type") == "callout":
            emoji = "default" if a.get("emoji") == CALLOUT_DEFAULT_EMOJI else "other"
            out.append(f"callout emoji={emoji} variant={json.dumps(a.get('variant'))}")
        elif node.get("type") == "toggle":
            out.append(f"toggle open={json.dumps(a.get('open'))}")
        for child in node.get("content") or []:
            _node_attrs(child, out)
    return out


@pytest.mark.parametrize("v", _BLOCK_NODE_VECTORS, ids=[v["name"] for v in _BLOCK_NODE_VECTORS])
def test_shared_block_node_vectors(v):
    doc = html_to_tiptap(v["html"])["doc"]
    assert _shape(doc) == v["shape"]
    assert _node_attrs(doc) == v["attrs"]


@pytest.mark.parametrize("lead, rest", [
    ([0x1F4A1], " tip"), ([0x2600, 0xFE0F], "  sun"), ([0x1F4A1], "x"), ([0x20, 0xA0, 0x26A0], "\twarn"),
])
def test_an_aside_leading_emoji_is_the_callout_emoji(lead, rest):
    """The client's LEADING_EMOJI_RE: JS whitespace stripped, one Extended_Pictographic (plus an
    optional U+FE0F), then spaces or tabs. Emoji built from numbers, never written raw."""
    text = "".join(chr(c) for c in lead) + rest
    doc = html_to_tiptap(f"<aside>{text}</aside>")["doc"]
    want = "".join(chr(c) for c in lead if c not in (0x20, 0xA0))
    assert doc["content"][0]["attrs"]["emoji"] == want
    assert _texts(doc)[0]["text"] == rest.lstrip(" \t")


def test_a_letter_or_digit_is_no_callout_emoji():
    from api.services.journal_two.note_connectors.convert.mddoc import CALLOUT_DEFAULT_EMOJI
    doc = html_to_tiptap("<aside>1 first</aside>")["doc"]
    assert doc["content"][0]["attrs"]["emoji"] == CALLOUT_DEFAULT_EMOJI
    assert _texts(doc)[0]["text"] == "1 first"


def test_the_default_emoji_is_the_callout_nodes_own():
    """`calloutNode.js` declares the default; this file's constant must be it."""
    import re
    from api.services.journal_two.note_connectors.convert.mddoc import CALLOUT_DEFAULT_EMOJI
    src = (_HTML_VECTORS_PATH.parents[2] / "calloutNode.js").read_text(encoding="utf-8")
    m = re.search(r"emoji:\s*\{\s*default:\s*'([^']+)'", src)
    assert m is not None and m.group(1) == CALLOUT_DEFAULT_EMOJI


# ── follow-up (difference 3): inline raw HTML renders, sanitised ─────────────

_INLINE_VECTORS = json.loads(_HTML_VECTORS_PATH.read_text(encoding="utf-8"))["inline_vectors"]


def _shape_marks(node: dict[str, Any]) -> str:
    if node["type"] == "text":
        marks = sorted(
            f"link={m['attrs']['href']}" if m["type"] == "link" else m["type"]
            for m in node.get("marks") or [])
        return f"'{node['text']}'" + (f"[{'+'.join(marks)}]" if marks else "")
    kids = node.get("content") or []
    return node["type"] + (f"({', '.join(_shape_marks(k) for k in kids)})" if kids else "")


@pytest.mark.parametrize("v", _INLINE_VECTORS, ids=[v["name"] for v in _INLINE_VECTORS])
def test_shared_inline_html_vectors(v):
    assert _shape_marks(md_to_tiptap(v["md"])["doc"]) == v["shape"]


def test_the_html_walker_reads_underline_and_highlight_as_the_client_does():
    doc = html_to_tiptap("<p>a <u>u</u> <mark>m</mark> z</p>")["doc"]
    assert _shape_marks(doc) == "doc(paragraph('a ', 'u'[underline], ' ', 'm'[highlight], ' z'))"


# ── fix round 1, C1: a region's markdown inside an open inline or leaf element ──

_REGION_VECTORS = json.loads(_HTML_VECTORS_PATH.read_text(encoding="utf-8"))["region_vectors"]


@pytest.mark.parametrize("v", _REGION_VECTORS, ids=[v["name"] for v in _REGION_VECTORS])
def test_shared_region_vectors(v):
    out = md_to_tiptap(v["md"])
    assert _shape_marks(out["doc"]) == v["shape"]
    assert not _orphan_media(out)


def _orphan_media(out: dict[str, Any]) -> list[str]:
    """Media refs the doc never references: always a dropped node (C1's class of bug)."""
    used: set[str] = set()

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            attrs = node.get("attrs") or {}
            for key in ("src", "href"):
                val = attrs.get(key)
                if isinstance(val, str) and val.startswith("import-ref://"):
                    used.add(val[len("import-ref://"):])
            if isinstance(attrs.get("ref"), str):
                used.add(attrs["ref"])
            for child in node.get("content") or []:
                walk(child)

    walk(out["doc"])
    return [m["ref"] for m in out["media"] if m["ref"] not in used]


def _rail_inputs() -> list[tuple[str, str, str]]:
    """(name, kind, text) for every input the shared converters' rails hold: the shared
    vectors, the server_convert and obsidian parity fixture inputs, the adversarial corpus
    and the messy Obsidian vault the connector corpora import."""
    convert_dir = pathlib.Path(__file__).resolve().parent / "note_connectors" / "convert"
    corpora_dir = pathlib.Path(__file__).resolve().parent / "note_connectors" / "corpora"
    vectors = json.loads(_HTML_VECTORS_PATH.read_text(encoding="utf-8"))
    out: list[tuple[str, str, str]] = []
    for key in ("vectors", "block_node_vectors"):
        out += [(f"{key}/{v['name']}", "html", v["html"]) for v in vectors[key]]
    for key in ("markdown_vectors", "inline_vectors", "region_vectors", "unsafe_image_vectors"):
        out += [(f"{key}/{v['name']}", "md", v["md"]) for v in vectors[key]]
    for p in sorted((convert_dir / "fixtures_in").iterdir()):
        if p.suffix in (".md", ".html"):
            out.append((f"fixtures_in/{p.name}", p.suffix[1:], p.read_text(encoding="utf-8")))
    for p in sorted((convert_dir / "obsidian_fixtures_in").glob("*.md")):
        out.append((f"obsidian_fixtures_in/{p.name}", "md", p.read_text(encoding="utf-8")))
    adversarial = json.loads((_HTML_VECTORS_PATH.parent / "obsidian_adversarial" / "corpus.json")
                             .read_text(encoding="utf-8"))
    out += [(f"adversarial/{i}", "md", c["input"]) for i, c in enumerate(adversarial["cases"])]
    for p in sorted((corpora_dir / "obsidian_messy").rglob("*.md")):
        out.append((f"obsidian_messy/{p.name}", "md", p.read_text(encoding="utf-8")))
    return out


def test_no_converter_output_holds_an_orphan_media_entry():
    """C1's rail: every media entry a conversion registers is referenced by a node in its doc
    (an image, a chip, a notice). An orphan is always content dropped after it was seen."""
    inputs = _rail_inputs()
    assert len(inputs) > 300
    bad = []
    for name, kind, text in inputs:
        for notice in (False, True):
            out = html_to_tiptap(text) if kind == "html" else md_to_tiptap(text, unsafe_image_notice=notice)
            orphans = _orphan_media(out)
            if orphans:
                bad.append((name, orphans))
    assert bad == []


# ── fix round 1, I1: the list-item repair is iterative ───────────────────────


@pytest.mark.parametrize("n", [1000, 5000])
def test_a_long_list_of_items_opening_with_a_block_converts(n):
    """D3 review I1: `_split_list` recursed per broken item; 1,000 items raised RecursionError
    and the whole note failed to import (a long `- ![[chart-...png]]` log)."""
    import time
    started = time.perf_counter()
    md = md_to_tiptap("\n".join(f"- ![x](a{i}.png)" for i in range(n)))
    nested = md_to_tiptap("\n".join("- - a" for _ in range(n)))
    html = html_to_tiptap("<ul>" + "<li><ul><li>a</li></ul></li>" * n + "</ul>")
    assert time.perf_counter() - started < 30
    assert sum(1 for c in md["doc"]["content"] if c["type"] == "image") == n
    assert sum(1 for c in nested["doc"]["content"] if c["type"] == "bulletList") == 2 * n
    assert sum(1 for c in html["doc"]["content"] if c["type"] == "bulletList") == 2 * n


def _split_list_reference(lst):
    """The recursive rule as it was (the ENML converter's), the iterative one's oracle."""
    items = lst.get("content") or []
    for idx, item in enumerate(items):
        content = item.get("content") or []
        if content and content[0].get("type") != "paragraph":
            closed = {**item, "content": [{"type": "paragraph", "content": []}]}
            out = [{**lst, "content": [*items[:idx], closed]}, *content]
            rest = items[idx + 1:]
            if rest:
                out.extend(_split_list_reference({"type": "bulletList", "content": rest}))
            return out
    return [lst]


def test_the_iterative_list_repair_is_the_recursive_rule():
    import random
    from api.services.journal_two.note_connectors.convert.mddoc import _split_list
    rnd = random.Random(11)
    para = {"type": "paragraph", "content": [{"type": "text", "text": "p"}]}
    blocks = [{"type": "image", "attrs": {"src": "x"}}, {"type": "bulletList", "content": []}, para]
    for _ in range(3000):
        items = [{"type": "listItem", "content": [rnd.choice(blocks) for _ in range(rnd.randrange(0, 3))]}
                 for _ in range(rnd.randrange(0, 7))]
        lst = {"type": rnd.choice(["bulletList", "orderedList"]), "attrs": {"start": 3}, "content": items}
        if rnd.random() < 0.1:
            del lst["content"]
        assert _split_list(lst) == _split_list_reference(lst)


# ── fix round 1, M1: a deeply nested raw HTML block imports flattened, never crashes ──


@pytest.mark.parametrize("make", [
    lambda: md_to_tiptap("<div>" * 1600 + "deep text"),
    lambda: html_to_tiptap("<div>" * 5000 + "deep text" + "</div>" * 5000),
    lambda: md_to_tiptap("\n\n".join(["<details>"] * 800) + "\n\ndeep text"),
    lambda: html_to_tiptap("<details><summary>s</summary>" * 3000 + "deep text"),
    lambda: html_to_tiptap("<b>" * 5000 + "deep text"),
])
def test_deep_nesting_imports_flattened(make):
    """D3 review M1: past the builder's depth cap a start tag is a sibling, not a child, so
    nothing recurses past it; the text is all there."""
    out = make()
    assert "deep text" in "".join(r["text"] for r in _texts(out["doc"]))


# ── fix round 1, M3: inline raw tags are linear in how many are open ─────────


@pytest.mark.parametrize("make", [
    lambda n: "<b>x " * n + "</b>" * n,
    lambda n: "a " + "</b>" * n + " z",
    lambda n: "<span>x " * n,
])
def test_inline_raw_tags_scale_linearly(make):
    """D3 review M3: every text run re-checked the whole open-mark list and every close scanned
    the open tags: 53 / 184 / 694 / 2,891 ms at 1k / 2k / 4k / 8k nested `<b>`."""
    import time

    def timed(n):
        started = time.perf_counter()
        md_to_tiptap(make(n))
        return time.perf_counter() - started

    small, big = timed(2000), timed(8000)
    assert big / max(small, 1e-3) < 8, (small, big)  # quadratic is 16x for 4x the input


# ── fix round 1, M7: differences kept on purpose, pinned per lane ─────────────

_KNOWN_DIFFERENCES = json.loads(_HTML_VECTORS_PATH.read_text(encoding="utf-8"))["known_differences"]


@pytest.mark.parametrize("v", _KNOWN_DIFFERENCES, ids=[v["name"][:40] for v in _KNOWN_DIFFERENCES])
def test_known_differences_server_side(v):
    assert v["server"] != v["client"]
    assert _shape(md_to_tiptap(v["md"])["doc"]) == v["server"]


# ── fix round 2, N1: deep nesting flattens structure, never drops content ─────

from api.services.journal_two.note_connectors.convert import deep_nesting_cases as _deep  # noqa: E402

_DEEP_CASES = _deep.cases()


def _expected(html: str) -> tuple[set[str], set[str], set[str]]:
    import re
    words = set(re.findall(r"\b(?:[wsa]\d+|L\d+|second)\b", re.sub(r"<[^>]*>", " ", html)))
    hrefs = set(re.findall(r'href="([^"]+)"', html))
    images = set(re.findall(r'src="([^"]+)"', html))
    return words, hrefs, images


@pytest.mark.parametrize("case", _DEEP_CASES, ids=[c["name"] for c in _DEEP_CASES])
def test_deep_nesting_keeps_every_word_link_and_image(case):
    """D3 fix round 2 (N1): past the depth cap, structure may flatten but no text, link or
    image is ever dropped, and every image is registered as media and referenced."""
    out = html_to_tiptap(case["html"])
    words, hrefs, images = _expected(case["html"])
    text = " ".join(r["text"] for r in _texts(out["doc"]))
    got_words = set(text.replace(" ", "  ").split())
    assert words - got_words == set()
    got_hrefs = {h for _, h in _links(out["doc"])}
    assert hrefs - got_hrefs == set()
    got_images = set()

    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == "image":
                got_images.add(n["attrs"]["src"][len("import-ref://"):])
            for c in n.get("content") or []:
                walk(c)

    walk(out["doc"])
    assert images - got_images == set()
    assert images - {m["ref"] for m in out["media"]} == set()
    assert not _orphan_media(out)


def test_the_deep_nesting_fixture_is_current(tmp_path):
    written = _deep.generate(tmp_path / "cases.json")
    assert written.read_bytes() == _deep.OUT_PATH.read_bytes()


# ── fix round 2 ruling: a link wrapping only an image survives after it ───────

_MEDIA_LINK_VECTORS = json.loads(_HTML_VECTORS_PATH.read_text(encoding="utf-8"))["media_link_vectors"]


@pytest.mark.parametrize("v", _MEDIA_LINK_VECTORS, ids=[v["name"] for v in _MEDIA_LINK_VECTORS])
def test_shared_media_link_vectors(v):
    out = md_to_tiptap(v["md"]) if "md" in v else html_to_tiptap(v["html"])
    assert _shape_marks(out["doc"]) == v["shape"]
    assert not _orphan_media(out)


_WORD_RE = r"\b(?:[wsa]\d+|L\d+|second)\b"


@pytest.mark.parametrize("case", _DEEP_CASES, ids=[c["name"] for c in _DEEP_CASES])
def test_deep_nesting_keeps_words_in_document_order(case):
    """D3 fix round 3 (N2): flat mode once put the deep run after the element the cap landed in
    (`A E` then `B C D`). The words must come out in the input's document order (the base's
    order wherever it converts: checked against 470eb705f9 in the report)."""
    import re
    expected = re.findall(_WORD_RE, re.sub(r"<[^>]*>", " ", case["html"]))
    got = re.findall(_WORD_RE, " ".join(r["text"] for r in _texts(html_to_tiptap(case["html"])["doc"])))
    assert got == expected


# ── fix round 4, N4: distinct tag names past the cap never deepen the chain ───


def _distinct_custom_tags(n: int) -> str:
    return "<div>" * 101 + "".join(f"<x{i}>w{i} " for i in range(n))


def test_distinct_custom_tags_past_the_cap_convert_linearly_in_order():
    """D3 re-review r2 (N4): past the depth cap `_flat_chain` wrapped every leaf in one element
    per open inline tag NAME, custom tags included, so `<x0><x1>…` built a chain as deep as the
    name count: 1,000 names raised RecursionError, and 3,000 with words took 11.5 s (every leaf
    built the whole chain). Only mark tags and `a` carry anything, so only they are chained."""
    import re
    import time

    def run(n):
        html = _distinct_custom_tags(n)
        started = time.perf_counter()
        out = html_to_tiptap(html)
        elapsed = time.perf_counter() - started
        got = re.findall(_WORD_RE, " ".join(r["text"] for r in _texts(out["doc"])))
        assert got == [f"w{i}" for i in range(n)]
        return elapsed

    small, big = run(1000), run(5000)
    assert big / max(small, 1e-3) < 12, (small, big)  # linear is 5x; quadratic is 25x
