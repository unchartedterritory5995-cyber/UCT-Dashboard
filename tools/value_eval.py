"""The value cases, from the command line: is what the Create Indicator door answers RIGHT, case by case.

  python tools/value_eval.py                          # every RECORDED answer against its case (no model, no network)
  python tools/value_eval.py --requests               # the requests as a set a recorder can send ({requests: [{id, words}]})
  python tools/value_eval.py --answers <run_dir>      # grade a FRESH run and say what changed against the record
  python tools/value_eval.py --answers <run_dir> --full [--write]
                                                      # the same, as a full run under the ratchet (exit 1 below a threshold);
                                                      # --write records the thresholds the first full run sets
  python tools/value_eval.py --rule-digest <case id>  # the fingerprint of a rule as it stands (for rule.history)

A run folder holds one `<id>-0.body.json` per request: the door's whole answer to it, as the recorder that drives
the Create Indicator window writes it. This tool sends nothing; a live run is the recorder's job, and costs money.

Run from the repository root. Exit 0: nothing went from right to wrong (and, with --full, no lane is below its
threshold). Exit 1: something did. Exit 2: the run could not be graded.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.value_cases import grade as G  # noqa: E402

FIXTURE = ROOT / "tests" / "fixtures" / "authoring" / "value_cases.json"
LANES = ("formula", "wall", "script")


def answer_of(body):
    """The door's answer in the case's own shape, from a recorded response body."""
    env = body.get("envelope") or {}
    out = {"disposition": body.get("disposition"), "reply": body.get("reply") or env.get("reply") or ""}
    if env.get("ops"):
        out["ops"] = env["ops"]
    if isinstance(body.get("script"), dict):
        out["script"] = body["script"]
    if body.get("turn"):
        out["turn"] = body["turn"]
    return out


def grade_run(data, run_dir):
    """{scores: {lane: {right, of}}, changed: [{id, lane, was, now, lines}], full: every case was answered}"""
    run_dir = Path(run_dir)
    scores, changed, answered = {}, [], 0
    for case in data["cases"]:
        if case["lane"] == "script":
            continue                                               # graded through the browser engine, not here
        lane = scores.setdefault(case["lane"], {"right": 0, "of": 0})
        lane["of"] += 1
        path = run_dir / f"{case['id']}-0.body.json"
        if path.exists():
            answered += 1
            result = G.grade_case(case, answer_of(json.loads(path.read_text(encoding="utf-8"))))
            now, lines = result["verdict"], result["lines"]
        else:
            now, lines = "no answer", []
        lane["right"] += now == "right"
        # the record is held right by tests/test_value_cases.py; it is graded again only to describe a change
        was = "right" if now == "right" else G.grade_case(case)["verdict"]
        if now != was:
            changed.append({"id": case["id"], "lane": case["lane"], "was": was, "now": now, "lines": lines})
    total = sum(v["of"] for v in scores.values())
    return {"scores": scores, "changed": changed, "full": answered == total}


def apply_ratchet(data, report):
    """The first FULL run writes each lane's threshold; a later full run below one is red. Mutates data['thresholds']."""
    if not report["full"]:
        return {"ok": True, "below": [], "note": "not a full run: the thresholds are neither written nor tested"}
    below, wrote = [], []
    for lane, score in report["scores"].items():
        line = data["thresholds"].get(lane)
        if line is None:
            data["thresholds"][lane] = score["right"]
            wrote.append(lane)
        elif score["right"] < line:
            below.append(lane)
    return {"ok": not below, "below": below, "note": (f"thresholds written for {wrote}" if wrote else "thresholds held")}


def main(argv):
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    if "--rule-digest" in argv:
        print(G.rule_digest(argv[argv.index("--rule-digest") + 1]))
        return 0
    if "--requests" in argv:
        print(json.dumps({"requests": [{"id": c["id"], "words": c["words"]} for c in data["cases"]]}, indent=1, ensure_ascii=False))
        return 0
    if "--answers" not in argv:
        tally = {}
        for case in data["cases"]:
            result = G.grade_case(case)
            tally.setdefault(case["lane"], []).append(result["verdict"])
            if result["verdict"] != "right":
                print(f"{case['id']}  {result['verdict'].upper()}  {case['words'][:90]}")
                for line in result["lines"]:
                    print("    " + line)
        for lane, verdicts in tally.items():
            print(f"{lane}: {verdicts.count('right')} of {len(verdicts)} recorded answers right")
        return 0 if all(v == "right" for vs in tally.values() for v in vs) else 1
    run_dir = Path(argv[argv.index("--answers") + 1])
    if not run_dir.is_dir():
        print(f"no such run folder: {run_dir}")
        return 2
    report = grade_run(data, run_dir)
    for row in report["changed"]:
        print(f"{row['id']}  {row['was']} -> {row['now'].upper()}")
        for line in row["lines"]:
            print("    " + line)
    for lane, score in report["scores"].items():
        print(f"{lane}: {score['right']} of {score['of']} right in this run (threshold {data['thresholds'].get(lane)})")
    worse = [row for row in report["changed"] if row["was"] == "right" and row["now"] not in ("right", "no answer")]
    code = 1 if worse else 0
    if "--full" in argv:
        if not report["full"]:
            print("NOT A FULL RUN: some requests have no answer in this folder; the thresholds are neither written nor tested")
            return 2
        verdict = apply_ratchet(data, report)
        print(verdict["note"])
        if not verdict["ok"]:
            print(f"BELOW THE THRESHOLD on: {verdict['below']}")
            code = 1
        elif "--write" in argv:
            FIXTURE.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
            print("thresholds recorded in the fixture: commit them")
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
