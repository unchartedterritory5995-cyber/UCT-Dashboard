"""Rails for ruling D23 (controller, owner-delegated 2026-09-30) in the L3/D3P layout
instrument (docs/notebook/proof/l3-instrument/l3_layout_measure.py -- the SAME shared
module both L3 and D3P's raw runs cite as `instrument` in their own run.json; D3P carries
no separate classifier of its own, only a record-only view (d3p_summarize.py) over fields
this module never touches).

D23, verbatim from the coordinator's ruling: "An occlusion whose occluder is the control's
OWN component's designed hit surface (the instrument's `sameHub: true`: the hub knob under
its own pad, which is the knob's documented touch target) is not a layout regression for
standard 6 clause 'no layout regressions'. It is reported in its own category,
SAME-COMPONENT, never dropped and never counted as CONFIRMED. Any occlusion by a DIFFERENT
element still counts."

`judge()` EXPOSES the evidence (a `sameHub` bool on every lead, read from the control's own
occ reading for that lead's "by" class -- never assumed from the class name alone).
`summarize()` is where the evidence becomes a status: a CONFIRMED lead with `sameHub: True`
moves to `SAME-COMPONENT` and gains `ruling: "D23"`; everything else -- including a CONFIRMED
lead classified "hub" whose occluder is NOT the same hub instance -- is untouched. That
"different element, same class" case is the control that proves this is not a blanket
"hub" exemption.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
INSTRUMENT = REPO / "docs" / "notebook" / "proof" / "l3-instrument" / "l3_layout_measure.py"

L3_R2_AFTER = REPO / "docs" / "notebook" / "proof" / "l3-layout-0e72ad573" / "r2-after" / "run.json"
D3P_AFTER_R2 = REPO / "docs" / "notebook" / "proof" / "d3p-raw" / "after-r2" / "run.json"


def _load():
    spec = importlib.util.spec_from_file_location("l3_layout_measure_d23", str(INSTRUMENT))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def M():
    return _load()


BASE = {"vw": 390, "overflow": {"docScrollW": 390, "docClientW": 390, "docPan": 0, "mainPan": 0}, "sweep": []}


def _hub_occ(same_hub: bool) -> dict:
    return {"cls": "hub", "hit": "div._pad_1fi2m_47", "layer": "div._pad_1fi2m_47",
            "popup": False, "modal": False, "sameHub": same_hub}


def _confirmed_control(same_hub: bool, name: str = "Joystick, Notebook") -> dict:
    """A control confirmed-occluded by something classified "hub" -- `same_hub` controls
    whether that occluder really is the control's OWN hub instance (the knob-under-its-own-pad
    case D23 names) or a different element the classifier merely also calls "hub"."""
    occ = _hub_occ(same_hub)
    box = [305, 538, 38, 38]
    return {"name": name, "key": f"DIV|button|{name}", "nth": 1, "tag": "DIV", "role": "button",
            "w": 38, "h": 38, "minW": 0, "minH": 0,
            "rest": {"box": box, "centreVisible": True, "occluded": True, "occ": occ},
            "best": {"box": box, "centreVisible": True, "occluded": True, "occ": occ},
            "verdict": "CONFIRMED-OCCLUDED"}


def _row(pass_: str, width: int, surface: str, controls: list[dict], M) -> dict:
    reading = {**BASE, "controls": controls}
    return {"pass": pass_, "width": width, "surface": surface, "reading": reading, "judged": M.judge(reading)}


# ── judge(): the evidence ────────────────────────────────────────────────────────────────

def test_judge_exposes_sameHub_true_on_a_confirmed_lead(M):
    j = M.judge({**BASE, "controls": [_confirmed_control(True)]})
    assert len(j["leads"]) == 1
    lead = j["leads"][0]
    assert lead["status"] == "CONFIRMED"
    assert lead["by"] == "hub"
    assert lead["sameHub"] is True


def test_judge_exposes_sameHub_false_for_the_same_class_different_element(M):
    j = M.judge({**BASE, "controls": [_confirmed_control(False)]})
    assert len(j["leads"]) == 1
    lead = j["leads"][0]
    assert lead["status"] == "CONFIRMED"
    assert lead["by"] == "hub"
    assert lead["sameHub"] is False


def test_judge_never_marks_sameHub_on_a_non_hub_occluder(M):
    """Scoped to sameHub only: a control confirmed-occluded by an ordinary chrome layer
    (never hub) must read sameHub False, not merely absent/None-as-falsy by accident."""
    occ = {"cls": "log-fab", "hit": "div._logFab_x", "layer": "div._logFab_x", "popup": False, "modal": False}
    ctrl = {"name": "Log trade", "key": "BUTTON||Log trade", "nth": 1, "tag": "BUTTON",
            "w": 44, "h": 44, "minW": 0, "minH": 0,
            "rest": {"box": [0, 0, 1, 1], "centreVisible": True, "occluded": True, "occ": occ},
            "best": {"box": [0, 0, 1, 1], "centreVisible": True, "occluded": True, "occ": occ},
            "verdict": "CONFIRMED-OCCLUDED"}
    j = M.judge({**BASE, "controls": [ctrl]})
    lead = j["leads"][0]
    assert lead["by"] == "log-fab"
    assert lead["sameHub"] is False


# ── summarize(): the D23 reclassification ────────────────────────────────────────────────

def test_a_sameHub_row_moves_to_SAME_COMPONENT_with_the_ruling(M):
    rows = [_row("hub@667", 390, "editor", [_confirmed_control(True)], M)]
    s = M.summarize(rows)
    assert s["named_leads_by_status"] == {"SAME-COMPONENT": 1}
    lead = s["named_leads"][0]
    assert lead["status"] == "SAME-COMPONENT"
    assert lead["ruling"] == "D23"
    assert lead["by"] == "hub"
    assert lead["control"] == "Joystick, Notebook"


def test_a_different_element_row_with_the_same_geometry_stays_CONFIRMED(M):
    """The control: identical box, identical "by" class ("hub"), but the occluder is NOT the
    control's own hub instance. D23 must not fire on class name alone."""
    rows = [_row("hub@667", 390, "editor", [_confirmed_control(False)], M)]
    s = M.summarize(rows)
    assert s["named_leads_by_status"] == {"CONFIRMED": 1}
    lead = s["named_leads"][0]
    assert lead["status"] == "CONFIRMED"
    assert "ruling" not in lead


def test_summary_counts_add_up_on_a_mixed_set(M):
    rows = [
        _row("hub@667", 390, "editor", [_confirmed_control(True)], M),
        _row("hub@740", 390, "editor", [_confirmed_control(False, name="Other control")], M),
    ]
    s = M.summarize(rows)
    assert sum(s["named_leads_by_status"].values()) == len(s["named_leads"]) == 2
    assert s["named_leads_by_status"]["SAME-COMPONENT"] == 1
    assert s["named_leads_by_status"]["CONFIRMED"] == 1
    # never dropped: the SAME-COMPONENT row is still a named_leads member, not silently removed
    statuses = {l["control"]: l["status"] for l in s["named_leads"]}
    assert statuses == {"Joystick, Notebook": "SAME-COMPONENT", "Other control": "CONFIRMED"}


def test_a_CLEARED_lead_with_sameHub_is_left_alone(M):
    """Only an already-CONFIRMED lead is eligible for D23 -- a control that escapes via scroll
    is CLEARED regardless of what briefly covered it at rest, and must stay CLEARED."""
    ctrl = _confirmed_control(True)
    ctrl["verdict"] = "reachable"
    ctrl["reachedBy"] = "center"
    j = M.judge({**BASE, "controls": [ctrl], "sweep": [{"i": 0, "cls": "hub", "top": 400}]})
    row = {"pass": "hub@667", "width": 390, "surface": "editor", "judged": j}
    s = M.summarize([row])
    assert s["named_leads_by_status"] == {"CLEARED": 1}


# ── grounded against the two cited runs' own committed raw JSON, no browser ─────────────

@pytest.mark.parametrize("path", [L3_R2_AFTER, D3P_AFTER_R2])
def test_re_reading_the_cited_runs_own_raw_reading_reclassifies_to_SAME_COMPONENT(M, path):
    """R-RAW: re-derive from the committed raw `reading` (never the stale cached `judged`,
    which predates D23) so this is a genuine re-classification of the raw JSON, not a copy
    of numbers already known to be right."""
    if not path.is_file():
        pytest.skip(f"raw run not present: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    hub_rows_with_reading = [r for r in data["rows"] if r.get("pass", "").startswith("hub") and "reading" in r]
    assert hub_rows_with_reading, "no hub-pass row with a raw reading -- the fixture moved"
    reclassified = 0
    still_confirmed = 0
    for r in hub_rows_with_reading:
        j = M.judge(r["reading"])
        s = M.summarize([{**r, "judged": j}])
        for lead in s["named_leads"]:
            if lead["control"] == "Joystick, Notebook" and lead.get("ruling") == "D23":
                reclassified += 1
                assert lead["status"] == "SAME-COMPONENT"
            elif lead["status"] == "CONFIRMED":
                still_confirmed += 1
    assert reclassified > 0, "the cited run's own Joystick-under-hub-pad CONFIRMED leads did not reclassify"
    assert still_confirmed == 0, (
        "a CONFIRMED lead survived D23 re-classification on the cited run -- either a second, "
        "genuinely different root cause exists at 390px (investigate before trusting this count), "
        "or the reclassification is over-broad"
    )
