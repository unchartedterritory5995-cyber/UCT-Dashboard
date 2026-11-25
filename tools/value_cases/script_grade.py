"""Grade the script-lane value cases: one run of the lane for all of them, then the rules, case by case.

`grade_all(cases, answers=None)` takes cases of lane "script" and, for each, the answer to grade (the recorded
one by default): {turn: 'script', script: {pine}} is run through `script_lane.run`; anything else is graded as
the wrong lane. Returns {case id: {'verdict', 'lines', 'lane', 'not_asked_for'}}.

An entry may be HELD BY ANOTHER CASE'S RULE (`holds`): a reference script, written by hand, answers an existing
case's request with a way of writing no door answer uses, and is graded by that case's rule under its own id.

A case may name an EDGE: one bar, exactly `back` bars before the newest, made a strict extreme. The script is
then run on the plain chart AND on the edge chart, and is right only when it is right on both. The edge is what
lets the check tell "the last 252 bars" from 253: on the plain bars the two often draw the same level.

`rule_digests(cases)` fingerprints what each script rule SAYS on the bars the lane runs on, for the same rail the
formula lane has: a rule that changes must say why in the case.
"""
from __future__ import annotations

import hashlib
from typing import Any, Dict, List, Optional

from . import grade as G
from . import script_lane, script_rules

EDGE = "-edge"


def source_of(answer: Optional[Dict[str, Any]]) -> Optional[str]:
    script = (answer or {}).get("script")
    pine = script.get("pine") if isinstance(script, dict) else None
    return pine if isinstance(pine, str) and pine.strip() else None


def grade_all(cases: List[Dict[str, Any]], answers: Optional[Dict[str, Any]] = None) -> Dict[str, Dict[str, Any]]:
    answers = answers or {}
    out, jobs, sources = {}, [], {}
    for case in cases:
        answer = answers.get(case["id"], case["answer"])
        lane = G.lane_of(answer)
        source = source_of(answer)
        if lane != "script" or source is None:
            out[case["id"]] = {"verdict": "wrong", "lane": lane, "not_asked_for": {},
                               "lines": [f"answered on the {lane} lane, the script lane expected"]}
            continue
        sources[case["id"]] = source
        chart = case.get("chart", "daily")
        jobs.append({"id": case["id"], "source": source, "chart": chart})
        if case.get("edge"):
            jobs.append({"id": case["id"] + EDGE, "source": source, "chart": chart, "edge": case["edge"]})
    if jobs:
        run = script_lane.run(jobs)
        for case in cases:
            cid = case["id"]
            if cid not in sources:
                continue
            rule = case.get("holds") or cid                # the rule that holds it: its own, or the case it answers
            result = _one(rule, cid, sources[cid], run)
            if case.get("edge") and result["verdict"] == "right":
                edged = _one(rule, cid + EDGE, sources[cid], run)
                result = {**edged, "lines": result["lines"] + ["  -- on the edge chart --"] + edged["lines"]}
            out[cid] = {**result, "lane": "script"}
    return out


def _one(case_id: str, job_id: str, source: str, run: Dict[str, Any]) -> Dict[str, Any]:
    ran = run["scripts"].get(job_id)
    chart = run["charts"].get((ran or {}).get("chart"))
    return script_rules.grade_script(case_id, source, ran, chart)


def rule_digests(cases: List[Dict[str, Any]]) -> Dict[str, Optional[str]]:
    """{case id: a fingerprint of the rule's columns and drawn expectations on the lane's own (plain) bars}"""
    kinds = sorted({case.get("chart", "daily") for case in cases})
    # the bars come from the lane (the engine's built bars); a script that plots the close is enough to fetch them
    probe = script_lane.run([{"id": f"bars-{kind}", "source": '//@version=5\nindicator("bars")\nplot(close)\n', "chart": kind} for kind in kinds])
    out = {}
    for case in cases:
        script_rules.bind(probe["charts"][case.get("chart", "daily")])
        h = hashlib.sha256()
        cid = case["id"]
        if cid in script_rules.RULES:
            for variant in script_rules.RULES[cid]():
                h.update(repr(variant[0]).encode())
                h.update(",".join("n" if v is None else "%.6g" % v for v in variant[1]).encode())
        drawn = script_rules.drawn_rules(cid)
        if drawn is not None:
            h.update(_stable(drawn).encode())
        out[cid] = h.hexdigest()[:16] if (cid in script_rules.RULES or drawn is not None) else None
    return out


def _stable(value: Any) -> str:
    if isinstance(value, float):
        return "%.6g" % value
    if isinstance(value, dict):
        return "{" + ",".join(f"{k!r}:{_stable(v)}" for k, v in sorted(value.items())) + "}"
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_stable(v) for v in value) + "]"
    return repr(value)
