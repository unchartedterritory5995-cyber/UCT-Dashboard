"""The flags-off parity tool's expected-difference list stays exact.

`tools/notebook_w14_flagsoff_parity.py` may PASS a run that differs from the base only when
every difference is explained exactly by a NAMED entry in `EXPECTED`. That list is five accepted
changes: the passed-setups status line (fin-a11y M-5, 2026-10-06), the Active setups door (lane
NAV), and three from the keyboard lane (the Research Home skip link, its landing heading, and
the editor toolbar as one Tab stop, which is the one always-on entry), all 2026-10-07. This
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


RECORD = {"name", "surface", "needs", "commit", "accepted", "reason"}
NO_PATTERN = re.compile(r"[*?]|\.\.\.|\\d|\\w|\.\+")


def test_every_expected_entry_is_literal_text_with_its_record(tool):
    """Five named entries (2026-10-07). An entry is literal text in one of three shapes: a whole
    leaf element, one opening tag as HEAD and as BASE have it, or the one counted roving run.
    None may hold a pattern, and each carries its commit, the date it was accepted, and why."""
    assert len(tool.EXPECTED) == 5, "adding an expected difference is a controller ruling: update this count with it"
    assert len({e["name"] for e in tool.EXPECTED}) == len(tool.EXPECTED)
    shapes = []
    for e in tool.EXPECTED:
        shape = set(e) - RECORD
        assert set(e) >= RECORD, sorted(RECORD - set(e))
        if shape == {"element"}:
            assert re.fullmatch(r"<(\w+)( [^<>]*)?>[^<>]*</\1>", e["element"]), "one whole leaf element; no fragment"
            literals = [e["element"]]
        elif shape == {"head", "base"}:
            for tag in (e["head"], e["base"]):
                assert re.fullmatch(r"<\w+( [^<>]*)?>", tag), "one opening tag"
            assert e["head"].split()[0].rstrip(">") == e["base"].split()[0].rstrip(">"), "the same element"
            assert e["head"] != e["base"]
            literals = [e["head"], e["base"]]
        else:
            assert shape == {"roving"}, f"an entry of no known shape: {sorted(shape)}"
            assert re.fullmatch(r"[a-z]{1,8}", e["roving"])
            literals = []
        shapes.append(tuple(sorted(shape)))
        for lit in literals:
            assert not NO_PATTERN.search(lit), "a literal, never a pattern"
        assert re.fullmatch(r"[0-9a-f]{7,40}", e["commit"])
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", e["accepted"])
        assert e["needs"] is None or e["needs"].startswith("notebook_")
        assert len(e["reason"]) > 40
        if e["needs"] is None:
            assert "ALWAYS ON" in e["reason"], "an always-on entry says so in its reason"
    assert shapes.count(("roving",)) == 1, "one counted run, and it is named"
    assert sum(1 for e in tool.EXPECTED if e["needs"] is None) == 1, "one always-on entry; a second is a new ruling"


def test_an_always_on_entry_is_still_bound_to_its_surface(tool):
    e = next(x for x in tool.EXPECTED if x["needs"] is None)
    base = '<div><button class="b0">a</button><button class="b1">b</button></div>'
    head = tool._apply(base, e, n=2)
    flags = {"all off": {}}
    assert tool.judge(f"{e['surface']} | all off | m", head, base, flags)[0] == "expected"
    assert tool.judge("notebook home | all off | m", head, base, flags)[0] == "differs"
    assert tool.judge(f"{e['surface']} | not a flag set | m", head, base, flags)[0] == "differs"


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
