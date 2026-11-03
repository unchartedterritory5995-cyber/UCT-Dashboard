"""D3: shared converter fidelity (every connector and file importer).

One section per D3 item. Brief: `.superpowers/sdd/2026-11-01-connector-fidelity-c-obsidian/
d3-brief.md`. The client lane's half of each item is pinned in
`app/src/pages/journal-2-0/lib/importer/convert.test.js` and the parity rails.
"""

from __future__ import annotations

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
