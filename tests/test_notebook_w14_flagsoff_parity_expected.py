"""The flags-off parity tool's expected-difference list stays exact.

`tools/notebook_w14_flagsoff_parity.py` may PASS a run that differs from the base only when
every difference is explained exactly by a NAMED entry in `EXPECTED`. That list is one accepted
accessibility change (the passed-setups status line, fin-a11y M-5, accepted 2026-10-06). This
rail keeps it from becoming a tolerance: the judge's own self-check must pass, and the list must
stay a list of whole literal elements, each with its commit, date and reason.

It does not run the parity capture (that needs a build and minutes of vitest); it loads the tool
and exercises the judge, which is pure.
"""
from __future__ import annotations

import importlib.util
import re
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
TOOL = REPO / "tools" / "notebook_w14_flagsoff_parity.py"


@pytest.fixture(scope="module")
def tool():
    spec = importlib.util.spec_from_file_location("w14_flagsoff_parity_under_test", TOOL)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_the_tools_own_self_check_passes():
    r = subprocess.run([sys.executable, str(TOOL), "--self-check"], cwd=str(REPO),
                       capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "SELF-CHECK: PASS" in r.stdout
    assert "FAIL" not in r.stdout


def test_every_expected_entry_is_a_whole_literal_element_with_its_record(tool):
    assert len(tool.EXPECTED) == 1, "adding an expected difference is a controller ruling: update this count with it"
    for e in tool.EXPECTED:
        assert set(e) == {"name", "element", "surface", "needs", "commit", "accepted", "reason"}
        assert re.fullmatch(r"<(\w+)( [^<>]*)?></\1>", e["element"]), "one whole, empty element; no fragment"
        assert not re.search(r"[*?]|\.\.\.|\\d|\\w|\.\+", e["element"]), "a literal, never a pattern"
        assert re.fullmatch(r"[0-9a-f]{7,40}", e["commit"])
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", e["accepted"])
        assert e["needs"].startswith("notebook_") and len(e["reason"]) > 40


def test_the_judge_refuses_what_the_list_does_not_name(tool):
    e = tool.EXPECTED[0]
    flags = {"on": {e["needs"]: True}, "off": {e["needs"]: False}}
    base = "<div><p>x</p></div>"
    head = base.replace("</p>", "</p>" + e["element"])
    on, off = f"{e['surface']} | on | m", f"{e['surface']} | off | m"
    assert tool.judge(on, head, base, flags) == ("expected", [e["name"]])
    assert tool.judge(off, head, base, flags)[0] == "differs"                # capability off
    assert tool.judge(on, head + "<i></i>", base, flags)[0] == "differs"     # plus anything else
    assert tool.judge(on, base + "<i></i>", base, flags)[0] == "differs"     # any other difference
    assert tool.judge(on, head, base, flags, expected=())[0] == "differs"    # control: the list is what allows it
