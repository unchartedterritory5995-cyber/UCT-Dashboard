"""D3 CP2 — the bars-pair cap has ONE name, and both sides cite it.

⛔ APPROVED SCOPE: **NONE YET.** CP2 is unsigned; built to signature-ready, not merged.
Gate line: `docs/terminal-research/12-decisions/gates/d3-realtime-streaming-pre-implementation-gate.md`
§4, id **CP2** — *"Name the bars-pair cap … One literal, one rename, one comment."*

⚰️ **WHY THIS IS A GATE AND NOT A REPORT: the repo was on the wrong side of it.** Before
this checkpoint `api/routers/stream.py` capped with an inline `pairs[:50]` several hundred
lines below `MAX_SSE_TICKERS`, and `app/src/lib/barsStreamManager.js` carried its own `50`
whose comment described itself as a *"mirror of api/routers/stream.py pairs[:50]"*. A
magic number citing a magic number, with nothing able to notice if either moved — this
repo's `lesson_a_comment_claiming_agreement_is_not_agreement` in one line.

⛔ **SAME VALUE, DIFFERENT FACT.** `MAX_SSE_TICKERS` is Finnhub's per-key subscription
ceiling; `MAX_BARS_PAIRS` bounds how much fan-out one browser may ask of this pod. They
are 50 today and are free to diverge, so this rail asserts each name separately and never
that the two numbers are equal.
"""
from __future__ import annotations

import ast
import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parents[1]
PY = REPO / "api" / "routers" / "stream.py"
JS = REPO / "app" / "src" / "lib" / "barsStreamManager.js"


def _module_constant(src: str, name: str):
    """The value of a module-level `NAME = <int>`, by AST. ⛔ Never a regex: a regex
    finds the name in a comment, which is how this repo has been wrong six times."""
    tree = ast.parse(src)
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id == name and isinstance(
                        node.value, ast.Constant):
                    return node.value.value
    return None


def _strip_py_comments(src: str) -> str:
    """⛔ CODE, NEVER PROSE — this file's own docstring contains `pairs[:50]`."""
    out = []
    for ln in src.splitlines():
        at = ln.find("#")
        if at >= 0 and ln.count("'", 0, at) % 2 == 0 and ln.count('"', 0, at) % 2 == 0:
            ln = ln[:at]
        out.append(ln)
    return "\n".join(out)


def test_non_vacuity_both_files_are_readable_and_substantial():
    """⛔ Every assertion below passes over an empty string."""
    assert len(PY.read_text(encoding="utf-8")) > 5000
    assert len(JS.read_text(encoding="utf-8")) > 2000


def test_the_python_cap_is_a_named_module_constant():
    val = _module_constant(PY.read_text(encoding="utf-8"), "MAX_BARS_PAIRS")
    assert val == 50, "MAX_BARS_PAIRS must be a module-level int, got %r" % (val,)


def test_the_cap_site_uses_the_NAME_and_no_inline_literal_survives():
    body = _strip_py_comments(PY.read_text(encoding="utf-8"))
    assert "pairs[:MAX_BARS_PAIRS]" in body
    # ⛔ THE ONE THAT WOULD HAVE CAUGHT THE ORIGINAL. An inline slice-by-literal is the
    # defect; the name must not merely exist beside it.
    # v1 of this assertion forbade ANY `pairs[:N]` and went red on the log line
    # `pairs[:10]`, which truncates the list for readability and is correct code.
    # A rail that reds correct code gets muted, so it is scoped to the ASSIGNMENT
    # form: capping `pairs` by a literal is the defect; slicing it for a message
    # is not.
    assert not re.search(r"pairs\s*=\s*pairs\[:\s*\d+\s*\]", body), \
        "an inline numeric bars-pair cap is back; use MAX_BARS_PAIRS"


def test_the_finnhub_ceiling_keeps_its_own_name():
    """⭐ Asserted separately, and NEVER as equality with MAX_BARS_PAIRS. They are the
    same number today and describe different constraints; a rail that tied them together
    would forbid the divergence the packet explicitly allows."""
    assert _module_constant(PY.read_text(encoding="utf-8"), "MAX_SSE_TICKERS") == 50


def test_the_browser_mirror_cites_the_NAME_not_the_literal():
    js = JS.read_text(encoding="utf-8")
    line = next(l for l in js.splitlines() if "MAX_BARS_PAIRS" in l and "export" in l)
    assert "MAX_BARS_PAIRS" in line
    assert "pairs[:50]" not in line, \
        "the mirror comment cites a magic number; cite MAX_BARS_PAIRS instead"
    assert "stream.py MAX_BARS_PAIRS" in line


def test_both_sides_agree_today_and_the_check_can_see_a_difference():
    """A value check with a control: if the two ever diverge this must fail, so the
    comparison is written against the parsed values rather than the text."""
    py = _module_constant(PY.read_text(encoding="utf-8"), "MAX_BARS_PAIRS")
    m = re.search(r"export const MAX_BARS_PAIRS\s*=\s*(\d+)", JS.read_text(encoding="utf-8"))
    assert m, "the browser constant could not be read — this check proves nothing"
    js = int(m.group(1))
    assert py == js, "cap disagreement: python=%r browser=%r" % (py, js)
    # ⛔ CONTROL: the comparison is real, not `x == x`.
    assert py != js + 1
