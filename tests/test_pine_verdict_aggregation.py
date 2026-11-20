# -*- coding: utf-8 -*-
"""ANY DIVERGE DOMINATES (coordinator ruling 2026-11-19): a script's verdict over its captures is never MATCH when one
of them DIVERGEs. Three charts drawn right and one drawn wrong is a script that draws a wrong picture, so for REACH a
DIVERGE capture on the members' lane at the current engine outweighs every MATCH.

The one rule is `coverage_map.script_verdict`; every fold of captures into a script's verdict asks it:
  * the map's `vendorVerdict` (`vendor_verdict_of`, one lane's verdicts run plus that lane's FRESH ledger rows);
  * the roadmap's members'-lane evidence (`parity_roadmap.members_lane_verdict`: `evidence_status`'s `committedMatch`
    and the `admit:*` units' `runtimeDrawnWithMatch`);
  * `w0/targets.py::runtime_on_verdicts`, which reads the order from it.
The server's graded allowlist (R1, `rollout_gate.pine_runtime_admission`) applies the same ruling to the captures a
record lists: tests/test_pine_runtime_switch_on.py::test_WSI_R1_three_MATCH_and_one_DIVERGE_is_not_admitted_the_DIVERGE_dominates.

⚰️ Until then MATCH won over everything: sonarlab-order-blocks (AAPL 1D DIVERGE beside three MATCHes) read MATCH.
"""
from __future__ import annotations

import itertools
import pathlib
import re
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
for p in (REPO / "tools" / "vendor_harness", REPO / "tools", REPO / "tools" / "pine_coverage"):
    sys.path.insert(0, str(p))

import coverage_map as cm  # noqa: E402
import parity_roadmap as pr  # noqa: E402


@pytest.mark.parametrize("verdicts", sorted(set(itertools.permutations(["MATCH", "MATCH", "MATCH", "DIVERGE"]))))
def test_AGG1_three_MATCH_and_one_DIVERGE_is_DIVERGE_in_any_order(verdicts):
    assert cm.script_verdict(list(verdicts)) == "DIVERGE"


@pytest.mark.parametrize("verdicts,want", [
    (["MATCH", "MATCH", "MATCH"], "MATCH"),                        # CONTROL: no DIVERGE, a MATCH
    (["MATCH", "INCONCLUSIVE"], "MATCH"),                          # an INCONCLUSIVE never outweighs a MATCH
    (["MATCH_SUBSTITUTED", "DIVERGE"], "DIVERGE"),                 # nor does a substituted MATCH outweigh a DIVERGE
    (["MATCH_SUBSTITUTED", "MATCH"], "MATCH"),
    (["MATCH_SUBSTITUTED", "INCONCLUSIVE"], "MATCH_SUBSTITUTED"),
    (["DIVERGE", "INCONCLUSIVE"], "DIVERGE"),
    (["INCONCLUSIVE"], "INCONCLUSIVE"),
    ([], None),
])
def test_AGG1_the_rest_of_the_order(verdicts, want):
    assert cm.script_verdict(verdicts) == want


def test_AGG2_the_map_folds_a_script_with_one_DIVERGE_to_DIVERGE_and_never_counts_it_verified():
    """`vendor_verdict_of` (the map's `vendorVerdict`) and `parity_counts` (`verifiedTransfer`) over one transferring
    script whose captures are three MATCH and one DIVERGE. CONTROL: the same script without the DIVERGE is verified."""
    mixed = {"clean": True, "_captures": {"MATCH", "DIVERGE"}}
    clean = {"clean": True, "_captures": {"MATCH"}}
    for s in (mixed, clean):
        s["vendorVerdict"] = cm.vendor_verdict_of(s)
    assert mixed["vendorVerdict"] == "DIVERGE" and clean["vendorVerdict"] == "MATCH"
    assert cm.parity_counts([mixed], 1)["verifiedTransfer"] == 0
    assert cm.parity_counts([clean], 1)["verifiedTransfer"] == 1


def _facts(*caps):
    return {"captures": [{"id": "c%d" % i, **c} for i, c in enumerate(caps)]}


def test_AGG3_the_roadmaps_members_lane_evidence_is_not_MATCH_with_a_DIVERGE():
    """`evidence_status` reads `committedMatch` only when the committed captures grade MATCH on the members' lane
    (runtime-on) with no DIVERGE among them. CONTROLS: three MATCH alone is `committedMatch`; a DIVERGE on the
    PRODUCTION (host) lane is not the members' lane and does not outweigh the runtime-on MATCHes."""
    m = {"runtimeOn": "MATCH", "production": "MATCH"}
    facts = {
        "mixed": _facts(m, m, m, {"runtimeOn": "DIVERGE", "production": "MATCH"}),
        "match": _facts(m, m, m),
        "hostDiverge": _facts(m, m, m, {"runtimeOn": "MATCH", "production": "DIVERGE"}),
        "hostOnly": _facts({"production": "MATCH"}),
    }
    assert pr.members_lane_verdict(facts["mixed"]) == "DIVERGE"
    assert pr.members_lane_verdict(facts["match"]) == "MATCH"
    assert pr.members_lane_verdict(facts["hostDiverge"]) == "MATCH"
    assert pr.members_lane_verdict(facts["hostOnly"]) is None
    st = pr.evidence_status(sorted(facts), facts)
    assert st["counts"] == {"committedMatch": 2, "committedOther": 2}
    assert {r["script"] for r in st["queue"]} == {"mixed", "hostOnly"}


def test_AGG4_no_other_fold_of_captures_says_MATCH_because_one_capture_does():
    """The one rule: no tool under tools/pine_coverage folds a script's captures with `any(... == "MATCH" ...)` (the
    shape both roadmap sites had). CONTROL: the pattern finds the old shape."""
    rx = re.compile(r"any\([^\n]*==\s*[\"']MATCH[\"']")
    assert rx.search('if any(x.get("runtimeOn") == "MATCH" for x in caps):')
    hits = [f"{p.relative_to(REPO)}:{n}" for p in sorted((REPO / "tools" / "pine_coverage").rglob("*.py"))
            for n, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1) if rx.search(line)]
    assert hits == [], hits
