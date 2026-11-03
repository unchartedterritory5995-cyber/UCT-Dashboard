"""Deep-nesting cases for the shared HTML converter (D3 fix round 2, N1).

Program rule: deep nesting may FLATTEN structure, but it never drops text, a link or an image.
The tree builder caps nesting (`mddoc._HTML_MAX_DEPTH`) so no walker recurses without bound;
these cases put each container the walkers treat structurally (a table's row and cell, a
list's item, an anchor, an image, a block wrapper above a table or a list) at, just under and
well past that cap, with text, a link and an image at the levels around it.

`cases()` is the one definition, read by `test_note_convert_d3.py` (text, links and images all
kept, every image registered as media) and by `generate()`, which writes each case's
`html_to_tiptap` output to `__fixtures__/deep_nesting/cases.json` for
`serverConvert.contract.test.js` to put through the editor schema's `check()`.

Runnable directly:
    python -m api.services.journal_two.note_connectors.convert.deep_nesting_cases
"""

from __future__ import annotations

import json
import pathlib
from typing import Any

from .mddoc import html_to_tiptap

_HERE = pathlib.Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parents[4]
OUT_PATH = (_REPO_ROOT / "app" / "src" / "pages" / "journal-2-0" / "lib" / "importer"
            / "__fixtures__" / "deep_nesting" / "cases.json")

DEPTHS = (99, 100, 101, 150, 500)


def _marked(n: int) -> list[int]:
    """The levels that carry content: the edges, the middle, and every level around the cap."""
    return sorted({0, n // 2, 98, 99, 100, 101, 102, n - 1} & set(range(n)))


def _content(i: int) -> str:
    return (f'w{i} <a href="https://e.com/l{i}">L{i}</a> '
            f'<img src="https://e.com/i{i}.png" alt="i{i}">')


def _nested(n: int, open_: str, close: str, inner: str, after: str) -> str:
    marked = set(_marked(n))
    head = "".join(open_ + (_content(i) if i in marked else "") for i in range(n))
    tail = "".join((after.format(i=i) if i in marked else "") + close for i in reversed(range(n)))
    return head + inner + tail


def cases() -> list[dict[str, Any]]:
    """`{name, html}` per container type and depth."""
    leaf = _content(9999)
    out: list[dict[str, Any]] = []
    for n in DEPTHS:
        marked = _marked(n)
        out += [
            {"name": f"table-{n}", "html": _nested(
                n, "<table><tr><td>", "</td></tr></table>", "", "</td><td>s{i}")},
            {"name": f"ul-{n}", "html": _nested(n, "<ul><li>", "</li></ul>", "", "</li><li>s{i}")},
            {"name": f"ol-{n}", "html": _nested(n, "<ol><li>", "</li></ol>", "", "</li><li>s{i}")},
            {"name": f"a-{n}", "html": "".join(
                f'<a href="https://e.com/a{i}">a{i} ' if i in marked else "<a>"
                for i in range(n)) + "</a>" * n},
            {"name": f"img-{n}", "html": "".join(
                "<div>" + (f'w{i} <img src="https://e.com/d{i}.png" alt="d{i}">' if i in marked else "")
                for i in range(n)) + "</div>" * n},
            {"name": f"div-table-{n}", "html": "<div>" * n + "<table><tr><td>" + leaf
             + "</td><td>second</td></tr></table>" + "</div>" * n},
            {"name": f"div-list-{n}", "html": "<div>" * n + "<ul><li>" + leaf
             + "</li><li>second</li></ul>" + "</div>" * n},
        ]
    return out


def _render(data: Any) -> str:
    return json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n"


def generate(out_path: pathlib.Path = OUT_PATH) -> pathlib.Path:
    data = [{"name": c["name"], **html_to_tiptap(c["html"])} for c in cases()]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(_render(data), encoding="utf-8", newline="\n")
    return out_path


if __name__ == "__main__":
    print(f"wrote {generate()}")
