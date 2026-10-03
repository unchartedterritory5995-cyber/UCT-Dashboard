"""RT2 — the store's repaint class for a runtime document is the member door's.

* the corpus answer the JS module committed (``tests/fixtures/runtime_repaint/
  corpus.json``, written by ``runtimeRepaint.test.js``) is this module's answer for
  every script, byte for byte — the two languages cannot drift;
* a clock leaf's reach is the host linter's (``ast_lint.ast_reach``): moving the
  shared table's declaration moves it;
* the rules, with their controls.
"""
from __future__ import annotations

import hashlib
import json
import pathlib

import pytest

from api.services import ast_lint, ast_table, runtime_repaint

REPO = pathlib.Path(__file__).resolve().parents[1]
FIXTURE = REPO / "tests" / "fixtures" / "runtime_repaint" / "corpus.json"


def _of(body: str) -> dict:
    return runtime_repaint.runtime_repaint_of(f'//@version=6\nindicator("t")\n{body}\n')


def test_the_corpus_answer_is_the_JS_modules_for_every_script():
    committed = json.loads(FIXTURE.read_text(encoding="utf-8"))["rows"]
    assert len(committed) > 200
    seen = 0
    for row in committed:
        path = REPO / row["file"]
        text = path.read_bytes().decode("utf-8")
        # ⛔ of the LF text: a checkout's line endings are the box's, not the script's
        lf = text.replace("\r\n", "\n").replace("\r", "\n")
        assert hashlib.sha256(lf.encode("utf-8")).hexdigest() == row["sha256"], row["file"]
        r = runtime_repaint.runtime_repaint_of(text)
        if row["mode"] is None:
            assert r["ok"] is False, row["file"]
            assert r["why"] == row["why"], row["file"]
        else:
            got = {"mode": r["mode"], "forward": r["forward"],
                   "reads": [[x["name"], x["forward"]] for x in r["reads"]]}
            assert got == {k: row[k] for k in ("mode", "forward", "reads")}, row["file"]
        seen += 1
    assert seen == len(committed)
    # non-vacuity: every class is reached
    assert {r["mode"] for r in committed} >= set(ast_lint.REPAINT_MODES)


def test_moving_the_host_declaration_moves_the_runtime_reach():
    moved = ast_lint.load_table()  # a fresh copy of the shared manifest
    moved["clock"]["isconfirmed"] = dict(moved["clock"]["isconfirmed"], forward=3)
    assert runtime_repaint.clock_leaf_reach("isconfirmed") == 0
    assert runtime_repaint.clock_leaf_reach("isconfirmed", moved) == 3
    moved["clock"]["islast"] = dict(moved["clock"]["islast"], forward="unbounded")
    assert runtime_repaint.clock_leaf_reach("islast", moved) == "unbounded"
    assert runtime_repaint.clock_leaf_reach("islast") == 1


def test_every_bound_clock_leaf_is_in_the_shared_table():
    for pine, key in runtime_repaint.RULES["clockReads"].items():
        if pine.startswith("_"):
            continue
        assert key in ast_table.TABLE["clock"], (pine, key)


@pytest.mark.parametrize("body,mode", [
    ("plot(close)", "non-repainting"),
    ("plot(barstate.islast ? close : na)", "preview-repaints"),
    ("plot(last_bar_index > 0 ? close : na)", "repaints"),
    ("plot(timenow > 0 ? close : na)", "repaints"),
    ("plot(barstate.isconfirmed ? close : na)", "non-repainting"),
    ("varip int n = 0\nplot(n)", "repaints"),
    ("x = request.security(syminfo.tickerid, timeframe.period, close)\nplot(x)", "non-repainting"),
    ('x = request.security(syminfo.tickerid, "", close)\nplot(x)', "non-repainting"),
    ('x = request.security(syminfo.tickerid, "D", close)\nplot(x)', "repaints"),
    ("x = request.security(syminfo.tickerid, timeframe.period, close, "
     "lookahead = barmerge.lookahead_on)\nplot(x)", "repaints"),
    ("// barstate.islast request.security varip\nplot(close)", "non-repainting"),
    ('t = "timenow"\nplot(close)', "non-repainting"),
    ("plot(barstate . islast ? close : na)", "preview-repaints"),
])
def test_the_rules(body, mode):
    assert _of(body)["mode"] == mode


def test_an_unreadable_source_has_no_class():
    r = runtime_repaint.runtime_repaint_of('indicator("t")\nx = "never closed\n')
    assert r["ok"] is False and "unterminated string" in r["why"]
