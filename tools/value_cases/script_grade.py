"""Grade the script-lane value cases: one run of the lane for all of them, then the rules, case by case.

`grade_all(cases, answers=None)` takes cases of lane "script" and, for each, the answer to grade (the recorded
one by default): {turn: 'script', script: {pine}} is run through `script_lane.run`; anything else is graded as
the wrong lane. Returns {case id: {'verdict', 'lines', 'lane', 'not_asked_for'}}.

`rule_digests(cases)` fingerprints what each script rule SAYS on the bars the lane runs on, for the same rail the
formula lane has: a rule that changes must say why in the case.
"""
from __future__ import annotations

import hashlib
from typing import Any, Dict, List, Optional

from . import grade as G
from . import script_lane, script_rules


def source_of(answer: Optional[Dict[str, Any]]) -> Optional[str]:
    script = (answer or {}).get("script")
    pine = script.get("pine") if isinstance(script, dict) else None
    return pine if isinstance(pine, str) and pine.strip() else None


def grade_all(cases: List[Dict[str, Any]], answers: Optional[Dict[str, Any]] = None) -> Dict[str, Dict[str, Any]]:
    answers = answers or {}
    out, jobs = {}, []
    for case in cases:
        answer = answers.get(case["id"], case["answer"])
        lane = G.lane_of(answer)
        source = source_of(answer)
        if lane != "script" or source is None:
            out[case["id"]] = {"verdict": "wrong", "lane": lane, "not_asked_for": {},
                               "lines": [f"answered on the {lane} lane, the script lane expected"]}
            continue
        jobs.append((case, source))
    if jobs:
        run = script_lane.run([{"id": case["id"], "source": source, "chart": case.get("chart", "daily")} for case, source in jobs])
        for case, source in jobs:
            chart = run["charts"].get(case.get("chart", "daily"))
            result = script_rules.grade_script(case["id"], source, run["scripts"].get(case["id"]), chart)
            out[case["id"]] = {**result, "lane": "script"}
    return out


def rule_digests(cases: List[Dict[str, Any]]) -> Dict[str, Optional[str]]:
    """{case id: a fingerprint of the rule's columns and drawn expectations on the lane's own bars}"""
    kinds = sorted({case.get("chart", "daily") for case in cases})
    # the bars come from the lane (the engine's built bars); a script that plots nothing is enough to fetch them
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
