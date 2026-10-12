"""Ledger R24 (P1 Task 15 review M2-M6): the styles walk step must wait, not sleep; the two rows must
check what their labels claim; the switch count must not be typed; styles_on mirrors the product gate.
These read the tool's source, because the only other proof is a two-hour re-walk (Task 13 is that)."""
from __future__ import annotations

import ast
import re
from pathlib import Path

FEATURES = Path("tools/notebook_fin_walk_features.py")
WALK = Path("tools/notebook_fin_walk.py")


def _styles_body() -> str:
    src = FEATURES.read_text(encoding="utf-8")
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "styles":
            return ast.get_source_segment(src, node)
    raise AssertionError("no def styles() in the features file")       # non-vacuity


def test_the_styles_step_has_no_blind_sleep():
    body = _styles_body()
    assert "Review update" in body                                       # non-vacuity: the right function
    assert "wait_for_timeout(" not in body


def test_update_layout_reads_the_added_block_and_unknown_block_saves_first():
    body = _styles_body()
    assert re.search(r'widgetId"\)\s*==\s*"chart"', body), "update-layout must check the chart block landed"
    assert "keyboard.type(" in body.split("walkFutureBlock", 1)[1], "unknown-block must edit the note first"
    assert "save_landed" in body, "unknown-block must wait for the save, not a clock"


def test_no_typed_switch_count():
    src = WALK.read_text(encoding="utf-8")
    assert "WAVE_FLAGS = [" in src                                        # non-vacuity
    assert not re.search(r"\b(seventeen|eighteen|nineteen)\s+switches\b", src)


def test_styles_on_mirrors_the_product_gate():
    src = FEATURES.read_text(encoding="utf-8")
    line = next(l for l in src.splitlines() if "styles_on =" in l)
    assert "notebook_journal_styles_enabled" in line
    assert "paid_equiv" not in line


def test_save_landed_waits_on_the_save_response_not_a_poll():
    src = FEATURES.read_text(encoding="utf-8")
    tree = ast.parse(src)
    fn = next((n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "save_landed"), None)
    assert fn is not None, "no def save_landed in the features file"        # non-vacuity
    body = ast.get_source_segment(src, fn)
    assert "expect_response(" in body and '"PUT"' in body
    assert "wait_for_timeout(" not in body and "while " not in body
