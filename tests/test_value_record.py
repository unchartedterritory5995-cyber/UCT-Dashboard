"""THE LIVE RE-RUN OF THE VALUE CASES: what the recorder may send, what it must stop, and what becomes the record.

`tools/value_record.py` drives the Create Indicator window on PRODUCTION as a synthetic account and records the
door's answers; `tools/value_eval.py --answers <run> --adopt` makes the right ones the record and `--stale` says
which records were made before the door's files last changed. A live run is paid and needs a browser, so nothing
here sends anything: what is held is the part that keeps a run SAFE and a record HONEST.

  * only a synthetic account is ever signed in as; the browser is not even imported before that is settled;
  * every write to the account is stopped; the request's own turns pass only while the recorder is waiting for
    them; a turn nobody sent is stopped;
  * a recorded request is not sent again; the answer kept is the last one the door gave;
  * ONLY A RIGHT ANSWER IS ADOPTED: a wrong or missing one leaves the old record standing;
  * a record made before a door file changed is named stale, with the files; an unknown build is stale too.
"""
from __future__ import annotations

import ast
import copy
import json
from pathlib import Path

import pytest

from tools import value_eval, value_record

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "tests" / "fixtures" / "authoring" / "value_cases.json").read_text(encoding="utf-8"))
CASES = DATA["cases"]
BASE = value_record.BASE


# ── who it signs in as ──

@pytest.mark.parametrize("email,ok", [
    ("smoke@uctintelligence.internal", True), ("BENCH@UCTINTELLIGENCE.INTERNAL ", True),
    ("someone@gmail.com", False), ("owner@uctintelligence.com", False), ("x@uctintelligence.internal.evil.com", False),
    ("", False), (None, False),
])
def test_only_a_synthetic_account_is_ever_signed_in_as(email, ok):
    assert value_record.is_synthetic(email) is ok


def test_a_run_is_refused_before_the_browser_when_the_account_is_not_synthetic(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("BENCH_EMAIL", "a.member@gmail.com")
    monkeypatch.setenv("BENCH_PASSWORD", "x")
    assert value_record.main([str(tmp_path / "run")]) == 2                    # the default account is the MEMBER one
    said = capsys.readouterr().out
    assert "REFUSED" in said and "BENCH_EMAIL" in said
    assert not (tmp_path / "run").exists()                         # nothing was even prepared
    monkeypatch.setenv("SMOKE_EMAIL", "smoke@uctintelligence.internal")
    monkeypatch.delenv("SMOKE_PASSWORD")
    assert value_record.main([str(tmp_path / "run"), "--account", "smoke"]) == 2


def test_a_chunk_stops_sending_at_its_time_and_the_run_says_who_answered_what():
    assert value_record.out_of_time(0.0, 17 * 60, 18) is False
    assert value_record.out_of_time(0.0, 18 * 60, 18) is True
    rows = [json.dumps({"id": "a", "account": "BENCH", "done": True}), json.dumps({"id": "b", "account": "BENCH", "done": False}),
            json.dumps({"id": "b", "account": "SMOKE", "done": True}), "", json.dumps({"id": "c", "done": True})]
    assert value_record.answered_by(rows) == {"BENCH": ["a"], "SMOKE": ["b"], "unknown": ["c"]}


def test_the_browser_is_imported_only_inside_a_run():
    tree = ast.parse((ROOT / "tools" / "value_record.py").read_text(encoding="utf-8"))
    top = [n for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom))]
    names = [a.name for n in top if isinstance(n, ast.Import) for a in n.names] + [n.module for n in top if isinstance(n, ast.ImportFrom)]
    assert not any("playwright" in (name or "") for name in names), names
    assert "playwright" in (ROOT / "tools" / "value_record.py").read_text(encoding="utf-8")      # CONTROL: it is used, inside


# ── what it lets through and what it stops ──

@pytest.mark.parametrize("method,path,allowed,want", [
    ("POST", "/api/user-definitions/converse", 3, "turn"),
    ("POST", "/api/user-definitions/converse", 0, "unsent"),
    ("POST", "/api/user-definitions/converse?x=1", 1, "turn"),
    ("POST", "/api/user-definitions/runtime-admission", 0, "admission"),
    ("POST", "/api/user-definitions", 3, "write"),
    ("PUT", "/api/user-definitions/abc", 3, "write"),
    ("DELETE", "/api/user-definitions/abc", 3, "write"),
    ("PUT", "/api/auth/preferences", 3, "write"),
    ("POST", "/api/workspace/layout", 3, "write"),
    ("POST", "/api/charts/layouts", 3, "write"),
    ("GET", "/api/user-definitions", 0, "continue"),
    ("GET", "/api/bars/NVDA?tf=D", 0, "continue"),
    ("POST", "/api/auth/logout", 0, "continue"),
])
def test_every_write_to_the_account_is_stopped_and_a_turn_passes_only_while_one_is_awaited(method, path, allowed, want):
    assert value_record.route_action(method, BASE + path, allowed) == want


def test_a_recorded_request_is_not_sent_again_and_the_filters_narrow():
    some = [c["id"] for c in CASES[:5]]
    left = value_record.todo(CASES, set(some[:2]), set(), set())
    assert [c["id"] for c in left][:3] == some[2:] and len(left) == len(CASES) - 2
    assert [c["id"] for c in value_record.todo(CASES, set(), {some[3]}, set())] == [some[3]]
    walls = value_record.todo(CASES, set(), set(), {"wall"})
    assert walls and all(c["lane"] == "wall" for c in walls)


def test_the_answer_kept_is_the_last_one_the_door_gave():
    first, repair = {"turn": "script", "script": {"pine": "a"}}, {"turn": "script", "script": {"pine": "b"}}
    assert value_record.last_answer([{"status": 200, "body": first}, {"status": 200, "body": repair}]) == repair
    assert value_record.last_answer([{"status": 200, "body": first}, {"status": 429, "body": {"_text": "slow down"}}]) == first
    assert value_record.last_answer([{"status": 500, "body": {"_text": "x"}}]) is None
    assert value_record.last_answer([]) is None


# ── what becomes the record ──

def _run_folder(tmp_path, changed=None):
    for case in [c for c in CASES if c["lane"] != "script"]:
        answer = (changed or {}).get(case["id"], case["answer"])
        body = {"disposition": answer.get("disposition", "change"), "reply": answer.get("reply", ""), "envelope": {"ops": answer.get("ops")}} if "ops" in answer else dict(answer)
        (tmp_path / f"{case['id']}-0.body.json").write_text(json.dumps(body), encoding="utf-8")
    return tmp_path


def test_ONLY_A_RIGHT_ANSWER_IS_ADOPTED():
    data = copy.deepcopy(DATA)
    formula = [c for c in data["cases"] if c["lane"] == "formula"]
    wall = [c for c in data["cases"] if c["lane"] == "wall"]
    good, bad, absent = formula[0], formula[1], wall[0]
    before_bad, before_absent = copy.deepcopy(bad), copy.deepcopy(absent)
    report = {"verdicts": {good["id"]: "right", bad["id"]: "wrong"},
              "answers": {good["id"]: {"disposition": "change", "reply": "said", "ops": good["answer"]["ops"], "turn": "patch"},
                          bad["id"]: {"disposition": "change", "reply": "said", "ops": [{"op": "create"}]}}}
    adopted, kept = value_eval.adopt(data, report, {"started": "2026-12-01T10:00Z", "front": "abc1234567", "model": "the-model"})
    assert adopted == [good["id"]] and bad["id"] in kept and absent["id"] in kept
    assert good["recorded"] == {"on": "2026-12-01", "front": "abc1234567", "model": "the-model"}
    assert good["answer"] == {"contract": "uct.authoring.patch/1", "ops": good["answer"]["ops"]}        # cut to what is graded
    assert bad == before_bad and absent == before_absent                                               # the old record stands


def test_a_record_is_cut_to_what_is_graded_on_each_lane():
    by_lane = {lane: next(c for c in CASES if c["lane"] == lane) for lane in ("formula", "script", "wall")}
    full = {"disposition": "unsupported", "reply": "no: options data", "ops": [{"op": "create"}], "turn": "script",
            "script": {"pine": "//@version=5", "name": "x"}, "usage": {"usd": 1}}
    assert set(value_eval.record_of(by_lane["formula"], full)) == {"contract", "ops"}
    assert value_eval.record_of(by_lane["script"], full) == {"turn": "script", "script": {"pine": "//@version=5"}}
    assert value_eval.record_of(by_lane["wall"], full) == {"disposition": "unsupported", "reply": "no: options data"}


def test_a_fresh_run_reports_each_cases_verdict_and_answer(tmp_path):
    report = value_eval.grade_run(DATA, _run_folder(tmp_path))
    graded_here = [c["id"] for c in CASES if c["lane"] != "script"]
    assert set(report["verdicts"]) == set(graded_here) and set(report["verdicts"].values()) == {"right"}
    assert set(report["answers"]) == set(graded_here)


# ── which records are stale ──

def test_a_record_made_before_a_door_file_changed_is_stale_and_says_which():
    data = {"cases": [{"id": "a", "recorded": {"front": "old"}}, {"id": "b", "recorded": {"front": "new"}},
                      {"id": "c", "recorded": {"front": "gone"}}, {"id": "d", "recorded": {"front": None}}, {"id": "e", "recorded": {"front": "old"}}]}
    asked = []

    def changed_since(build):
        asked.append(build)
        return {"old": ["api/services/pine_authoring.py", "api/services/definition_conversation.py"], "new": [], "gone": None}[build]
    got = value_eval.stale(data, changed_since)
    assert got == {"a": "changed since: definition_conversation.py, pine_authoring.py", "e": "changed since: definition_conversation.py, pine_authoring.py",
                   "c": "the recorded build is not in this clone", "d": "no build recorded"}
    assert sorted(asked) == ["gone", "new", "old"]                  # each build is asked about once


def test_the_door_files_named_for_staleness_exist():
    for path in value_eval.DOOR_PATHS:
        assert (ROOT / path).exists(), path
    assert any("definition_conversation" in p for p in value_eval.DOOR_PATHS) and any("scriptEngineVersion" in p for p in value_eval.DOOR_PATHS)
