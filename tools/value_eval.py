"""The value cases, from the command line: is what the Create Indicator door answers RIGHT, case by case.

  python tools/value_eval.py                          # every RECORDED answer against its case (no model, no network)
  python tools/value_eval.py --requests               # the requests as a set a recorder can send ({requests: [{id, words}]})
  python tools/value_eval.py --answers <run_dir>      # grade a FRESH run and say what changed against the record
  python tools/value_eval.py --answers <run_dir> --full [--write]
                                                      # the same, as a full run under the ratchet (exit 1 below a threshold);
                                                      # --write records the thresholds the first full run sets
  python tools/value_eval.py --answers <run_dir> --adopt
                                                      # make this run's RIGHT answers the record (a wrong one never is)
  python tools/value_eval.py --stale                  # which records were made before the door's files last changed
  python tools/value_eval.py --rule-digest <case id>  # the fingerprint of a rule as it stands (for rule.history)

A run folder holds one `<id>-0.body.json` per request: the door's whole answer to it, as the recorder that drives
the Create Indicator window writes it. This tool sends nothing; a live run is the recorder's job, and costs money.

Run from the repository root. Exit 0: nothing went from right to wrong (and, with --full, no lane is below its
threshold). Exit 1: something did. Exit 2: the run could not be graded.
"""
from __future__ import annotations

import copy
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.value_cases import grade as G  # noqa: E402

FIXTURE = ROOT / "tests" / "fixtures" / "authoring" / "value_cases.json"
LANES = ("formula", "wall", "script")
#: what the door's answers are written FROM: a record made before one of these last changed is stale, and a
#: stale record says what the door answered then, not what it answers now. Re-run it live (tools/value_record.py).
DOOR_PATHS = (
    "api/services/definition_conversation.py",
    "api/services/script_conversation.py",
    "api/services/pine_authoring.py",
    "app/src/components/chart/supportLoop/assistantPineReference.json",
    "app/src/components/chart/supportLoop/assistantRecipes.json",
    "app/src/components/chart/engine/scriptEngineVersion.js",
)


def answer_of(body):
    """The door's answer in the case's own shape, from a recorded response body."""
    env = body.get("envelope") or {}
    # what the MEMBER was told: the reply, or, when the door declined by a gate (`ok` false: the script door's "I can't"
    # carries no reply), the gate's own member sentence, `reason`
    said = body.get("reply") or env.get("reply") or (body.get("reason") if body.get("ok") is False else None) or ""
    out = {"disposition": body.get("disposition"), "reply": said}
    if env.get("ops"):
        out["ops"] = env["ops"]
    if env.get("questions"):
        out["questions"] = env["questions"]                        # a question's text and its one-tap choices
    if isinstance(body.get("script"), dict):
        out["script"] = body["script"]
    if body.get("turn"):
        out["turn"] = body["turn"]
    return out


def grade_run(data, run_dir):
    """{scores: {lane: {right, of, answered}}, changed: [{id, lane, was, now, lines}], full: every case was answered,
    full_lanes: [the lanes whose every case was answered and graded], verdicts, answers}"""
    run_dir = Path(run_dir)
    scores, changed, answered = {}, [], 0
    verdicts, fresh = {}, {}
    scripts, script_answers = [c for c in data["cases"] if c["lane"] == "script"], {}
    for case in data["cases"]:
        if case["lane"] == "script":
            continue                                               # graded below, through the browser engine
        lane = scores.setdefault(case["lane"], {"right": 0, "of": 0, "answered": 0})
        lane["of"] += 1
        path = run_dir / f"{case['id']}-0.body.json"
        if path.exists():
            answered += 1
            lane["answered"] += 1
            fresh[case["id"]] = answer_of(json.loads(path.read_text(encoding="utf-8")))
            result = G.grade_case(case, fresh[case["id"]])
            now, lines = result["verdict"], result["lines"]
        else:
            now, lines = "no answer", []
        verdicts[case["id"]] = now
        lane["right"] += now == "right"
        # the record is held right by tests/test_value_cases.py; it is graded again only to describe a change
        # (a case recorded WRONG is a known defect: `was` is that, so the run that gets it right names the change)
        was = case.get("recorded_verdict") or ("right" if now == "right" else G.grade_case(case)["verdict"])
        if now != was:
            changed.append({"id": case["id"], "lane": case["lane"], "was": was, "now": now, "lines": lines})
    total = sum(v["of"] for v in scores.values())
    full = answered == total
    if scripts:
        for case in scripts:
            path = run_dir / f"{case['id']}-0.body.json"
            if path.exists():
                script_answers[case["id"]] = answer_of(json.loads(path.read_text(encoding="utf-8")))
        if script_answers:
            lane = scores.setdefault("script", {"right": 0, "of": len(scripts), "answered": len(script_answers)})
            try:
                from tools.value_cases import script_grade
                got = script_grade.grade_all([c for c in scripts if c["id"] in script_answers], script_answers)
            except Exception as exc:  # noqa: BLE001 -- no node here: the lane is NOT graded, and the run is not full
                lane["not_graded"] = str(exc)[:200]
                full = False
            else:
                fresh.update(script_answers)
                for case in scripts:
                    now = got[case["id"]]["verdict"] if case["id"] in got else "no answer"
                    verdicts[case["id"]] = now
                    lane["right"] += now == "right"
                    was = case.get("recorded_verdict", "right")     # the record is held by tests/test_value_cases_scripts.py
                    if now != was:
                        changed.append({"id": case["id"], "lane": "script", "was": was, "now": now, "lines": (got.get(case["id"]) or {}).get("lines", [])})
                full = full and len(script_answers) == len(scripts)
    full_lanes = sorted(name for name, v in scores.items() if v["answered"] == v["of"] and "not_graded" not in v)
    return {"scores": scores, "changed": changed, "full": full, "full_lanes": full_lanes, "verdicts": verdicts, "answers": fresh}


def record_of(case, answer):
    """A fresh answer cut to what a case keeps: what is graded, nothing else of the response."""
    if case["lane"] == "formula":
        kept = {"contract": "uct.authoring.patch/1", "ops": answer.get("ops")}
        if case.get("says"):
            kept["reply"] = answer.get("reply")                    # this case holds what the member is told, too
        return kept
    if case["lane"] == "script":
        return {"turn": "script", "script": {"pine": (answer.get("script") or {}).get("pine")}}
    kept = {"disposition": answer.get("disposition"), "reply": answer.get("reply")}
    if answer.get("questions"):
        kept["questions"] = [{k: q[k] for k in ("text", "choices") if k in q} for q in answer["questions"] if isinstance(q, dict)]
    return kept


def _capabilities_of(source):
    from api.services import pine_capabilities                    # (only an adoption reads it: grading never does)
    return pine_capabilities.capabilities_of(source)


def held_by(cases, capabilities_of):
    """{capability id: the script cases whose recorded script uses it}."""
    out = {}
    for case in cases:
        script = (case.get("answer") or {}).get("script") if case.get("lane") == "script" else None
        if isinstance(script, dict) and isinstance(script.get("pine"), str):
            for cap in capabilities_of(script["pine"]):
                out.setdefault(cap, []).append(case["id"])
    return out


def coverage_lines(held):
    """What the command says of each right answer it did not adopt because the record would have lost a capability."""
    return [f"NOT ADOPTED {cid}: right again, but its recorded script is the only case of {caps}; the old record stands"
            for cid, caps in sorted((held or {}).items())]


def adopt(data, report, stamps, fixed_by=None, notes=None, capabilities_of=None):
    """Make a run's RIGHT answers the record. A wrong or missing one is never adopted: the old record stands.

    A FIXED DEFECT IS KEPT. A case recorded WRONG that the run gets right keeps its wrong answer as a specimen: it is
    APPENDED to the case's `found` list as {answer, defect, recorded, fixed_by} (never overwritten: a later defect on
    the same case is a second entry). Such a case is adopted only when `fixed_by` names what fixed it
    ({case id: {"pr": "#2435", "merge": "<commit>"}}); without that its old record stands and it is returned in
    `kept`.

    A RE-RECORDING NEVER COSTS A CAPABILITY ITS ONLY CASE. Where adopting a right answer over a record that was
    also right would leave a capability no recorded script uses, that case keeps its old record (it is returned in
    `kept`, and `notes["held_for_coverage"]` says {case id: [capabilities]}). A fixed defect is always adopted. The
    list `capabilities_without_a_case` is taken DOWN to what the record now holds, never up.
    Returns (adopted ids, kept ids). Mutates data."""
    adopted, kept = [], []
    fixed_by = fixed_by or {}
    capabilities_of = capabilities_of or _capabilities_of
    before = {case["id"]: copy.deepcopy(case) for case in data["cases"]}
    for case in data["cases"]:
        if report["verdicts"].get(case["id"]) == "right" and case["id"] in report["answers"]:
            if case.get("recorded_verdict") == "wrong":
                fix = fixed_by.get(case["id"])
                if not (isinstance(fix, dict) and fix.get("pr") and fix.get("merge")):
                    kept.append(case["id"])                        # a fixed defect is adopted only with what fixed it
                    continue
                case.setdefault("found", []).append({"answer": case["answer"], "defect": case.get("defect"),
                                                     "recorded": case.get("recorded"), "fixed_by": {"pr": fix["pr"], "merge": fix["merge"]}})
            case["answer"] = record_of(case, report["answers"][case["id"]])
            case.pop("recorded_verdict", None)                     # a known defect the door now gets right is one no longer
            case.pop("defect", None)
            # the build THIS answer was given on (a run is recorded in passes, hours apart, on different builds)
            own = (stamps.get("fronts") or {}).get(case["id"]) or {}
            case["recorded"] = {"on": str(own.get("at") or stamps.get("started") or "")[:10], "front": own.get("front") or stamps.get("front"),
                                "model": stamps.get("model")}
            adopted.append(case["id"])
        else:
            kept.append(case["id"])
    was, held = held_by(before.values(), capabilities_of), {}
    while True:
        lost = sorted(set(was) - set(held_by(data["cases"], capabilities_of)))
        # only a RE-recording gives way (the old record was right too); a fixed defect is adopted whatever it uses
        back = {cid: [cap for cap in lost if cid in was[cap]] for cap in lost for cid in was[cap]
                if cid in adopted and cid not in held and before[cid].get("recorded_verdict") != "wrong"}
        if not back:
            break
        held.update(back)
        data["cases"][:] = [before[case["id"]] if case["id"] in back else case for case in data["cases"]]
    adopted = [cid for cid in adopted if cid not in held]
    kept += sorted(held)
    if isinstance(notes, dict):
        notes["held_for_coverage"] = held
    listed = data.get("capabilities_without_a_case")
    if isinstance(listed, list):
        now = held_by(data["cases"], capabilities_of)
        data["capabilities_without_a_case"] = [cap for cap in listed if cap not in now]
    return adopted, kept


def _git(*args):
    return subprocess.run(["git", *args], cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8", errors="replace")


def stale(data, changed_since=None):
    """{case id: why}: records made on a build whose door files differ from this tree's, or on an unknown build.
    `changed_since(build) -> list of changed door files, or None when the build is unknown` (git, by default)."""
    def by_git(build):
        if _git("cat-file", "-e", build + "^{commit}").returncode != 0:
            return None
        return _git("diff", "--name-only", build, "HEAD", "--", *DOOR_PATHS).stdout.split()
    changed_since = changed_since or by_git
    out, seen = {}, {}
    for case in data["cases"]:
        build = (case.get("recorded") or {}).get("front")
        if not build:
            out[case["id"]] = "no build recorded"
            continue
        if build not in seen:
            changed = changed_since(build)
            seen[build] = ("the recorded build is not in this clone" if changed is None
                           else ("changed since: " + ", ".join(sorted(p.rsplit("/", 1)[-1] for p in changed))) if changed else None)
        if seen[build]:
            out[case["id"]] = seen[build]
    return out


def apply_ratchet(data, report):
    """LANE BY LANE: the first run that answers EVERY case of a lane writes that lane's threshold; a later such run
    below it is red. A lane with a request unanswered (or not graded) is neither written nor tested.
    Mutates data['thresholds']."""
    if not report["full_lanes"]:
        return {"ok": True, "below": [], "note": "no lane was fully answered: the thresholds are neither written nor tested"}
    below, wrote = [], []
    for lane in report["full_lanes"]:
        score = report["scores"][lane]
        line = data["thresholds"].get(lane)
        if line is None:
            data["thresholds"][lane] = score["right"]
            wrote.append(lane)
        elif score["right"] < line:
            below.append(lane)
    held = [lane for lane in report["full_lanes"] if lane not in wrote and lane not in below]
    return {"ok": not below, "below": below, "note": f"thresholds written for {wrote}; held on {held}; lanes not fully answered: "
                                                     f"{sorted(set(report['scores']) - set(report['full_lanes']))}"}


def main(argv):
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    if "--rule-digest" in argv:
        print(G.rule_digest(argv[argv.index("--rule-digest") + 1]))
        return 0
    if "--requests" in argv:
        print(json.dumps({"requests": [{"id": c["id"], "words": c["words"]} for c in data["cases"]]}, indent=1, ensure_ascii=False))
        return 0
    if "--stale" in argv:
        old = stale(data)
        for lane in LANES:
            ids = [c["id"] for c in data["cases"] if c["lane"] == lane]
            print(f"{lane}: {sum(1 for i in ids if i in old)} of {len(ids)} records are stale")
        for why in sorted(set(old.values())):
            ids = sorted(i for i, w in old.items() if w == why)
            print(f"  {len(ids)} x {why}: {' '.join(ids[:12])}{' ...' if len(ids) > 12 else ''}")
        return 0
    if "--answers" not in argv:
        tally = {}
        for case in data["cases"]:
            if case["lane"] == "script":
                continue                                           # tests/test_value_cases_scripts.py, or --answers
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
    if "--adopt" in argv:
        stamps_path = run_dir / "run.json"
        stamps = json.loads(stamps_path.read_text(encoding="utf-8")) if stamps_path.exists() else {}
        if not stamps.get("front"):
            print("NOT ADOPTED: the run folder has no run.json naming the build it was recorded on")
            return 2
        fronts_path = run_dir / "fronts.json"
        if fronts_path.exists():
            stamps["fronts"] = json.loads(fronts_path.read_text(encoding="utf-8"))
        fixed_by = {}
        if "--fixed-by" in argv:
            fixed_by = json.loads(Path(argv[argv.index("--fixed-by") + 1]).read_text(encoding="utf-8"))
        unnamed = [c["id"] for c in data["cases"] if c.get("recorded_verdict") == "wrong" and report["verdicts"].get(c["id"]) == "right" and c["id"] not in fixed_by]
        notes = {}
        adopted, kept = adopt(data, report, stamps, fixed_by, notes)
        FIXTURE.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
        print(f"adopted {len(adopted)} right answers as the record (build {stamps['front']}); kept the old record for {len(kept)}")
        if unnamed:
            print(f"NOT ADOPTED, recorded WRONG and right in this run, with nothing in --fixed-by naming what fixed them: {unnamed}")
        for line in coverage_lines(notes.get("held_for_coverage")):
            print(line)
    if "--full" in argv:
        if not report["full_lanes"]:
            print("NO LANE WAS FULLY ANSWERED in this folder: the thresholds are neither written nor tested")
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
