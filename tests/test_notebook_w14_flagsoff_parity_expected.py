"""The flags-off parity tool's expected-difference list stays exact.

`tools/notebook_w14_flagsoff_parity.py` may PASS a run that differs from the base only when
every difference is explained exactly by a NAMED entry in `EXPECTED`. The list is the accepted
changes: the home skip link and the editor toolbar as one Tab stop (keyboard lane, 2026-10-07),
and the P0 doors of ruling R9 (2026-10-11): the Active setups box, the New note menu, the home
search input and the note's "Ask this note" door. (The passed-setups status line and the reviews
heading were removed on 2026-10-11: the 10/10 UX pass took their targets out of the page.) This
rail keeps it from becoming a tolerance: the judge's own self-check must pass, and every entry is
literal text with its commit, date and reason.

THE SHAPES. The default is strict: a whole LEAF element, one opening tag as HEAD and as BASE have
it, or the one counted roving run. Four R9 entries are not leaves, and each has a NARROW, NAMED
allowance below (`ALLOWANCES`), tied to that entry by name and checked by a parser, never by a
looser regex for all: a nested element (balanced, one root), a void element (the one `<input>`),
and a whole-button pair (the renamed Ask door, whose NAME and TEXT both changed). An allowance
whose entry is gone fails, and so does an entry with no allowance that is not strictly shaped.

It does not run the parity capture (that needs a build and minutes of vitest); it loads the tool
and exercises the judge, which is pure.
"""
from __future__ import annotations

import copy
import importlib.util
import re
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
TOOL = REPO / "tools" / "notebook_w14_flagsoff_parity.py"

# How many accepted differences there are. Adding or removing one is a controller ruling: change it here with it.
EXPECTED_COUNT = 6
# The entries that are ALWAYS ON (`needs` None). A fifth is a new ruling.
ALWAYS_ON = {
    "New note menu on Research Home (P0.1)",
    "Home search input (P0.13)",
    "note Ask door is named 'Ask this note' (P0.7)",
    "editor formatting toolbar is one Tab stop (lane KEYS)",
}
# entry name -> the one non-leaf shape it is allowed. Each is checked by `SHAPE_CHECKS`, not by a pattern.
ALLOWANCES = {
    "Active setups box (P0.5; replaces the lane NAV door)": "nested element",
    "New note menu on Research Home (P0.1)": "nested element",
    "Home search input (P0.13)": "void element",
    "note Ask door is named 'Ask this note' (P0.7)": "whole-button pair",
}

VOID = {"input", "br", "hr", "img", "meta", "link"}


class _Balance(HTMLParser):
    """Counts root elements and notes an unbalanced fragment."""

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.stack, self.roots, self.bad = [], 0, False

    def handle_starttag(self, tag, attrs):
        if not self.stack:
            self.roots += 1
        if tag not in VOID:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if not self.stack or self.stack.pop() != tag:
            self.bad = True

    def handle_data(self, data):
        if not self.stack and data.strip():
            self.roots += 1          # loose text beside the root is a second root


def _one_balanced_root(lit: str, root_tag: str | None = None) -> bool:
    p = _Balance()
    p.feed(lit)
    p.close()
    ok = not p.bad and not p.stack and p.roots == 1
    return ok and (root_tag is None or lit.startswith(f"<{root_tag}"))


def _nested(e):
    assert _one_balanced_root(e["element"]), "one balanced element; no fragment"
    assert e["element"].count("<") > 2, "a nested element has children; a leaf is checked strictly"


def _void(e):
    assert re.fullmatch(r"<input [^<>]*>", e["element"]), "one void <input>, nothing else"


def _button_pair(e):
    for lit in (e["head"], e["base"]):
        assert lit.startswith("<button ") and lit.endswith("</button>"), "a whole button"
        assert _one_balanced_root(lit, "button")
    assert e["head"] != e["base"]


SHAPE_CHECKS = {"nested element": _nested, "void element": _void, "whole-button pair": _button_pair}

RECORD = {"name", "surface", "needs", "commit", "accepted", "reason"}
NO_PATTERN = re.compile(r"[*?]|\.\.\.|\\d|\\w|\.\+")


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


def check_entry(e):
    """One entry's whole contract. Raises AssertionError on a malformed one (the control below feeds it some)."""
    shape = set(e) - RECORD
    assert set(e) >= RECORD, sorted(RECORD - set(e))
    allowance = ALLOWANCES.get(e["name"])
    literals: list[str] = []
    if allowance:
        SHAPE_CHECKS[allowance](e)
        literals = [e["element"]] if shape == {"element"} else [e["head"], e["base"]]
    elif shape == {"element"}:
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
    for lit in literals:
        assert not NO_PATTERN.search(lit), "a literal, never a pattern"
    assert re.fullmatch(r"[0-9a-f]{7,40}", e["commit"])
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", e["accepted"])
    assert e["needs"] is None or e["needs"].startswith("notebook_")
    assert len(e["reason"]) > 40
    if e["needs"] is None:
        assert "ALWAYS ON" in e["reason"], "an always-on entry says so in its reason"
    return tuple(sorted(shape))


def test_every_expected_entry_is_literal_text_with_its_record(tool):
    """An entry is literal text in a known shape (strict by default, or its one named allowance), with
    its commit, the date it was accepted, and why. None may hold a pattern."""
    assert len(tool.EXPECTED) == EXPECTED_COUNT, "adding an expected difference is a controller ruling: update EXPECTED_COUNT with it"
    names = [e["name"] for e in tool.EXPECTED]
    assert len(set(names)) == len(names)
    assert set(ALLOWANCES) <= set(names), f"an allowance for an entry that is gone: {sorted(set(ALLOWANCES) - set(names))}"
    shapes = [check_entry(e) for e in tool.EXPECTED]
    assert shapes.count(("roving",)) == 1, "one counted run, and it is named"
    assert {e["name"] for e in tool.EXPECTED if e["needs"] is None} == ALWAYS_ON, "the always-on set is a ruling"


def test_the_entry_check_refuses_a_malformed_entry(tool):
    """Control: check_entry is not a rubber stamp. Each mutation of a real entry must be refused."""
    by_name = {e["name"]: e for e in tool.EXPECTED}
    box = by_name["Active setups box (P0.5; replaces the lane NAV door)"]
    inp = by_name["Home search input (P0.13)"]
    ask = by_name["note Ask door is named 'Ask this note' (P0.7)"]
    skip = next(e for e in tool.EXPECTED if e["name"].startswith("Research Home skip link"))
    bad = {
        "nested element left unbalanced": {**box, "element": box["element"][:-6]},
        "nested element with a second root": {**box, "element": box["element"] + "<i></i>"},
        "a pattern in a literal": {**box, "element": box["element"].replace("Open the setups board", "Open .+ board")},
        "void element that is not an input": {**inp, "element": "<div></div>"},
        "void element with a child": {**inp, "element": inp["element"] + "</input>"},
        "button pair that is not a button": {**ask, "head": ask["head"].replace("<button", "<div", 1)},
        "button pair with head == base": {**ask, "base": ask["head"]},
        "a nested entry given no allowance (strict leaf rule)": {**box, "name": "an unnamed nested entry"},
        "a record field missing": {k: v for k, v in skip.items() if k != "commit"},
        "an always-on entry that does not say so": {**ask, "reason": ask["reason"].replace("ALWAYS ON", "sometimes on")},
    }
    for label, e in bad.items():
        with pytest.raises(AssertionError):
            check_entry(copy.deepcopy(e))
            pytest.fail(f"accepted: {label}")
    for e in tool.EXPECTED:        # and the real ones are accepted
        check_entry(e)


def test_an_always_on_entry_is_still_bound_to_its_surface(tool):
    """Every always-on entry is allowed on its own surface in every flag set, and nowhere else."""
    for e in (x for x in tool.EXPECTED if x["needs"] is None):
        if "roving" in e:
            base = '<div><button class="b0">a</button><button class="b1">b</button></div>'
        elif "head" in e:
            base = f"<div>{e['base']}</div>"
        else:
            base = "<main><section><p>x</p></section></main>"
        head = tool._apply(base, e, n=2)
        assert head != base, e["name"]
        flags = {"all off": {}}
        other = "notebook home" if e["surface"] != "notebook home" else "open note"
        assert tool.judge(f"{e['surface']} | all off | m", head, base, flags)[0] == "expected", e["name"]
        assert tool.judge(f"{other} | all off | m", head, base, flags)[0] == "differs", e["name"]
        assert tool.judge(f"{e['surface']} | not a flag set | m", head, base, flags)[0] == "differs", e["name"]


def test_the_judge_refuses_what_the_list_does_not_name(tool):
    e = next(x for x in tool.EXPECTED if "element" in x and x["needs"])
    flags = {"on": {e["needs"]: True}, "off": {e["needs"]: False}}
    base = "<div><p>x</p></div>"
    head = base.replace("</p>", "</p>" + e["element"])
    on, off = f"{e['surface']} | on | m", f"{e['surface']} | off | m"
    assert tool.judge(on, head, base, flags) == ("expected", [e["name"]])
    assert tool.judge(off, head, base, flags)[0] == "differs"                # capability off
    assert tool.judge(on, head + "<i></i>", base, flags)[0] == "differs"     # plus anything else
    assert tool.judge(on, base + "<i></i>", base, flags)[0] == "differs"     # any other difference
    assert tool.judge(on, head, base, flags, expected=())[0] == "differs"    # control: the list is what allows it
