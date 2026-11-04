# -*- coding: utf-8 -*-
"""WS-C (Phase 3) -- an allowlisted script's MATCH claim must be a MEASURED verdict.

WS-I review gap (R1): `api/data/pine_runtime_allowlist.json` names, per script,
the TradingView captures that grade it MATCH with the runtime pane on, and each
`conformant` capability names its evidence captures. The WS-I rails check that
those capture FILES exist and hash to the script. Nothing checked that the
harness ever MEASURED them as MATCH. A capture that the committed runtime-on
harness run grades DIVERGE or INCONCLUSIVE would still read "MATCH" in the
allowlist, and serve.

This rail reads the committed runtime-on scoreboard
(`docs/pine/vendor-harness/runtime-on/verdicts.json`, written by
`vendorHarness.corpus.test.js` with `VENDOR_HARNESS_RUNTIME_ON=1`) and requires:
  1. the scoreboard really is the runtime-on lane;
  2. every capture a script claims MATCH (runtime pane on) is in it, graded MATCH;
  3. every capture named as evidence for a `conformant` capability is in it,
     graded MATCH.
"""
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
ALLOW = ROOT / "api" / "data" / "pine_runtime_allowlist.json"
VERDICTS = ROOT / "docs" / "pine" / "vendor-harness" / "runtime-on" / "verdicts.json"


def _load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def measured_problems(allow, verdicts):
    """Every MATCH claim in `allow` that `verdicts` does not measure as MATCH, by name."""
    out = []
    if verdicts.get("lane") != "runtime-on":
        out.append(f"scoreboard lane is {verdicts.get('lane')!r}, not 'runtime-on'")
    graded = {r.get("id"): r.get("verdict") for r in verdicts.get("results", [])}

    def need(cid, who):
        v = graded.get(cid)
        if v is None:
            out.append(f"{who}: capture {cid} is not in the runtime-on scoreboard")
        elif v != "MATCH":
            out.append(f"{who}: capture {cid} is measured {v}, not MATCH")

    for s in allow.get("scripts", []):
        for c in s.get("captures", []):
            if c.get("verdict") == "MATCH" and c.get("runtimePane") == "on":
                need(c.get("id"), f"script {s.get('slug')}")
    for name, row in allow.get("capabilities", {}).items():
        if row.get("status") == "conformant":
            for cid in row.get("evidence", []):
                need(cid, f"capability {name}")
    return out


def test_every_committed_MATCH_claim_is_a_measured_runtime_on_MATCH():
    problems = measured_problems(_load(ALLOW), _load(VERDICTS))
    assert problems == [], problems


def test_the_rail_has_something_to_check():
    """Non-vacuity: the committed allowlist does claim at least one MATCH capture."""
    allow = _load(ALLOW)
    claims = [c for s in allow["scripts"] for c in s.get("captures", [])
              if c.get("verdict") == "MATCH" and c.get("runtimePane") == "on"]
    assert claims


@pytest.mark.parametrize("mutate, needle", [
    (lambda v: v.update(lane="production"), "not 'runtime-on'"),
    (lambda v: [r.update(verdict="DIVERGE") for r in v["results"]
                if r["id"] == "adx-and-di-for-v4-rddt-1d-2026-09-27"], "measured DIVERGE"),
    (lambda v: v.update(results=[r for r in v["results"]
                                 if r["id"] != "adx-and-di-for-v4-spy-1d-2026-10-03"]), "not in the runtime-on scoreboard"),
])
def test_the_rail_can_fail_BY_NAME(mutate, needle):
    """Controls: a scoreboard that does not back the claim is named, for each way it can fail."""
    v = _load(VERDICTS)
    mutate(v)
    problems = measured_problems(_load(ALLOW), v)
    assert any(needle in p for p in problems), problems
