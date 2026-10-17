"""P4a (Task 8): the finish walk's `page_layouts` group. The group itself needs a sandbox boot and a browser, so these
rails check what can be checked without one: that it is registered after `followup`, that its switch is one the walk
arms in c2, that the registry the walk reads is the product's own (compared with what Node says the module exports),
and that the two page-order probes are valid JavaScript."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))

import notebook_fin_walk as C  # noqa: E402
import notebook_fin_walk_features as F  # noqa: E402

NODE = shutil.which("node")


def _node(code: str) -> str:
    assert NODE, "node is required for this rail (the repo's frontend toolchain)"
    r = subprocess.run([NODE, "--input-type=module", "-e", code], capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert r.returncode == 0, r.stderr[-800:]
    return r.stdout


def test_the_page_layouts_step_is_registered_right_after_followup():
    assert F.ORDER.count("page_layouts") == 1
    assert F.ORDER.index("page_layouts") == F.ORDER.index("followup") + 1


def test_the_switch_is_one_the_walk_arms_in_c2_and_the_payload_key_is_the_products():
    assert "JOURNAL_PAGE_LAYOUTS_ENABLED" in C.WAVE_FLAGS
    fs = C.flag_sets()                                    # raises when a WAVE_FLAGS name is not an auth.py gate
    assert "JOURNAL_PAGE_LAYOUTS_ENABLED" in fs["c2"] and "JOURNAL_PAGE_LAYOUTS_ENABLED" in fs["gates"]
    assert F.PAGE_LAYOUTS_KEY == "journal_page_layouts_enabled" == "JOURNAL_PAGE_LAYOUTS_ENABLED".lower()
    flag_js = (REPO / "app" / "src" / "pages" / "journal-2-0" / "lib" / "pageLayoutsFlag.js").read_text(encoding="utf-8")
    assert f"PAGE_LAYOUTS_FLAG = '{F.PAGE_LAYOUTS_KEY}'" in flag_js


def test_the_registry_the_walk_reads_is_what_the_module_exports():
    out = _node(f"import * as m from {json.dumps(F.PAGE_LAYOUTS_JS.as_uri())};"
                "console.log(JSON.stringify({pref: m.LAYOUT_PREF, phases: m.PHASE_LABELS,"
                " today: m.PANELS.today.map(p => [p.id, p.label, p.defaultShown]),"
                " trade: m.PANELS.trade.map(p => [p.id, p.label, p.defaultShown])}))")
    want = json.loads(out)
    got = F.page_layout_registry()
    assert got["pref"] == want["pref"] == "journal_page_layout"
    assert got["phases"] == want["phases"] and len(got["phases"]) == 3
    assert [list(t) for t in got["today"]] == want["today"] and len(got["today"]) >= 9      # non-vacuity: the parse found rows
    assert [list(t) for t in got["trade"]] == want["trade"] and len(got["trade"]) >= 9


def test_every_today_panel_has_a_word_the_walk_knows_it_by():
    words = dict((pid, w) for w, pid in F.TODAY_PANEL_KEYS)
    for pid, label, _ in F.page_layout_registry()["today"]:
        assert pid in words, f"Today panel {pid!r} has no entry in TODAY_PANEL_KEYS"
        assert label.lower().startswith(words[pid]) or words[pid] == "coach", (pid, label)


def test_the_order_readers_name_panels_from_what_the_page_shows():
    rows = [{"tag": "div", "key": "Customize"}, {"tag": "section", "key": "Market regime"}, {"tag": "section", "key": "Quick actions"},
            {"tag": "div", "key": "Goal Progress"}, {"tag": "section", "key": "Today's note"}, {"tag": "details", "key": "Notices · 2"}]
    assert F.today_panel_ids(rows) == ["regime", "quickActions", "goalProgress", "todayNote", "notices"]
    assert F.today_panel_ids(None) == [] and F.today_panel_ids([{"key": "A lead card"}]) == []
    assert F.trade_panel_ids([{"id": "story"}, {"id": None, "key": "Linked notes"}, {"id": "outcome"}]) == ["story", "outcome"]


@pytest.mark.parametrize("src", [F.TODAY_ORDER_JS, F.TRADE_ORDER_JS])
def test_the_order_probes_are_valid_javascript_functions(src):
    out = _node(f"const f = new Function('return (' + {json.dumps(src)} + ')')(); console.log(typeof f)")
    assert out.strip() == "function"


def test_the_group_reads_every_default_it_compares_to_from_the_registry():
    body = Path(F.__file__).read_text(encoding="utf-8").split("def page_layouts():", 1)[1].split('run("page_layouts", page_layouts)', 1)[0]
    assert "reg = page_layout_registry()" in body
    assert re.search(r"default_ids = ", body) and "registry_default" in body        # non-vacuity: the comparisons are there
    # no panel label is typed in the group: the labels come from the registry
    for typed in ("Show Market regime", "Show My rules", "Move The story", "Show Chart"):
        assert typed not in body, typed
