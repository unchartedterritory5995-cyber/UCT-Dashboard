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
    monkeypatch.delenv("SMOKE_PASSWORD", raising=False)           # not set at all on a runner; set on a dev box
    assert value_record.main([str(tmp_path / "run"), "--account", "smoke"]) == 2
    # an account the helper does not know is refused by name, whatever the environment holds
    monkeypatch.setenv("OWNER_EMAIL", "owner@uctintelligence.internal")
    monkeypatch.setenv("OWNER_PASSWORD", "x")
    assert value_record.main([str(tmp_path / "run"), "--account", "owner"]) == 2
    assert "OWNER is not one of the synthetic accounts" in capsys.readouterr().out
    assert not (tmp_path / "run").exists()


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


ALLOWANCE = {"status": 200, "body": {"ok": False, "gate": "cost:user", "reason": "you have used up today's allowance of the UCT Agent"}}
BUILT = {"status": 200, "body": {"ok": True, "disposition": "change", "envelope": {"ops": []}}}


@pytest.mark.parametrize("answers,why", [
    ([ALLOWANCE], "the member's daily allowance (cost:user)"),
    ([{"status": 200, "body": {"ok": False, "gate": "cost:global", "reason": "x"}}], "the product's daily spending limit (cost:global)"),
    ([BUILT, ALLOWANCE], "the member's daily allowance (cost:user)"),           # a repair turn met it: the request is not answered
    ([ALLOWANCE, BUILT], "the member's daily allowance (cost:user)"),           # ANY turn of the request, wherever it sits
    ([BUILT], None),
    ([{"status": 200, "body": {"ok": False, "gate": "concept:ungrounded", "reason": "not a name UCT knows"}}], None),   # about the REQUEST
    ([{"status": 200, "body": {"ok": True, "gate": "cost:user"}}], None),      # not a refusal
    ([{"status": 429, "body": {"_text": "limit"}}], None), ([{"status": 200, "body": None}], None), ([], None),
])
def test_a_refusal_about_the_ACCOUNT_is_named_and_one_about_the_request_is_not(answers, why):
    assert value_record.account_refusal(answers) == why


def test_A_REFUSAL_ABOUT_THE_ACCOUNT_IS_NOT_AN_ANSWER():
    """Found live 2026-11-22: the member's daily allowance ran out mid-lane; seven refusals were recorded as answers."""
    assert value_record.is_answer([BUILT]) is True
    refused_request = {"status": 200, "body": {"ok": False, "gate": "concept:ungrounded", "reason": "no"}}
    assert value_record.is_answer([refused_request]) is True                   # a wall IS an answer to the request
    assert value_record.is_answer([ALLOWANCE]) is False and value_record.is_answer([BUILT, ALLOWANCE]) is False
    assert value_record.is_answer([{"status": 429, "body": {}}]) is False and value_record.is_answer([]) is False
    assert value_record.is_answer([BUILT, {"status": 500, "body": {}}]) is False


def test_the_run_keeps_nothing_of_such_a_turn_and_stops_there():
    """The sending loop needs a browser, so what it does with such a turn is held in its own code (the code, never
    its comments): the body is written as the case's answer only when no turn was a refusal about the account; the
    row's `done` is `is_answer`; and the refusal becomes the reason the run stops."""
    tree = ast.parse((ROOT / "tools" / "value_record.py").read_text(encoding="utf-8"))
    main = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "main")
    dumped = {ast.dump(n) for n in ast.walk(main)}
    names = lambda node: {n.id for n in ast.walk(node) if isinstance(n, ast.Name)}  # noqa: E731
    # (1) the write of `<id>-0.body.json` sits under a test that reads `refused`
    writes = [n for n in ast.walk(main) if isinstance(n, ast.If) and "body.json" in ast.dump(n)]
    assert writes and all("refused" in names(n.test) for n in writes if "body" in names(n.test)), "the answer file is written whatever the turn was"
    assert any("refused" in names(n.test) and "body" in names(n.test) for n in writes)
    # (2) `done=` is the helper's verdict, not a status check written again
    done = [k.value for n in ast.walk(main) if isinstance(n, ast.Call) for k in n.keywords if k.arg == "done"]
    assert done and all(isinstance(v, ast.Call) and getattr(v.func, "id", None) == "is_answer" for v in done)
    # (3) the refusal stops the run and is named in the row
    stops = [n for n in ast.walk(main) if isinstance(n, ast.If) and names(n.test) == {"refused"}]
    assert stops and any(isinstance(b, ast.Assign) and getattr(b.targets[0], "id", None) == "stopped" for n in stops for b in n.body)
    assert any("not_an_answer" in ast.dump(b) for n in stops for b in n.body)
    assert dumped                                                           # (the walk saw something)


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
        if body.get("questions"):                                    # the door sends a question's choices in the envelope
            body["envelope"] = {"questions": body.pop("questions")}
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
    # each case's verdict is the one its record holds: right, or the known defect's WRONG (named in the case)
    assert report["verdicts"] == {c["id"]: c.get("recorded_verdict", "right") for c in CASES if c["lane"] != "script"}
    # (a wrong verdict is there exactly when a case graded here is recorded WRONG; today the fixture may hold none)
    assert set(report["verdicts"]) == set(graded_here)
    assert ("wrong" in report["verdicts"].values()) == any(c.get("recorded_verdict") == "wrong" for c in CASES if c["lane"] != "script")
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


# ── which guard refused each attempt (2026-11-23) ──

def test_the_record_keeps_which_guard_refused_each_attempt_of_each_answer():
    """⚰️ A build that went wrong on its repair call was on record as `attempts: 2` and nothing else."""
    gate = {"attempt": 1, "gate": "envelope:compared-with-itself"}
    plain = {"status": 200, "body": {"ok": True, "attempts": 1}}
    repaired = {"status": 200, "body": {"ok": True, "attempts": 2, "refused_attempts": [gate]}}
    told = {"attempt": 1, "gate": "envelope:reference", "detail": "set_style names output `x`, which the indicator does not have"}
    by_an_admin = {"status": 200, "body": {"ok": True, "attempts": 2, "refused_attempts": [{"attempt": 1, "gate": "envelope:reference"}], "diagnostic": [told]}}
    before = {"status": 200, "body": {"ok": True, "attempts": 2}}          # answered before the door said which guard
    assert value_record.repairs_of([plain]) == [] and value_record.repairs_of([]) == []
    assert value_record.repairs_of([plain, repaired]) == [{"answer": 1, "attempts": 2, "refused": [gate]}]
    assert value_record.repairs_of([by_an_admin]) == [{"answer": 0, "attempts": 2, "refused": [{"attempt": 1, "gate": "envelope:reference"}], "told": [told]}]
    # a repair whose guard the door did not name is kept as a repair with NO guard named, never dropped as "none"
    assert value_record.repairs_of([before]) == [{"answer": 0, "attempts": 2, "refused": []}]
    assert value_record.repairs_of([{"status": 500, "body": None}, {"status": 200, "body": "text"}]) == []
    # a refusal of the whole turn names both attempts
    twice = {"status": 200, "body": {"ok": False, "gate": "envelope:compared-with-itself", "attempts": 2,
                                     "refused_attempts": [gate, {"attempt": 2, "gate": "envelope:compared-with-itself"}]}}
    assert [r["attempt"] for r in value_record.repairs_of([twice])[0]["refused"]] == [1, 2]


def test_every_row_the_recorder_writes_carries_it():
    tree = ast.parse((ROOT / "tools" / "value_record.py").read_text(encoding="utf-8"))
    rows = [node for node in ast.walk(tree) if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
            and node.func.attr == "update" and isinstance(node.func.value, ast.Name) and node.func.value.id == "row"
            and any(k.arg == "done" for k in node.keywords)]
    assert len(rows) == 1                                              # the one place a request's row is written
    repairs = [k.value for k in rows[0].keywords if k.arg == "repairs"]
    assert len(repairs) == 1 and isinstance(repairs[0], ast.Call) and repairs[0].func.id == "repairs_of"
    assert [a.id for a in repairs[0].args] == ["answers"]              # of every answer of the request, not the last one


# ── the sign-in is the helper's, and the session is closed however the run ends (2026-11-23) ──

RECORDER = ROOT / "tools" / "value_record.py"


def _code_strings(tree):
    """Every string the CODE holds (docstrings are prose and are left out: code, never prose)."""
    prose = {id(n.body[0].value) for n in ast.walk(tree)
             if isinstance(n, (ast.Module, ast.FunctionDef, ast.ClassDef)) and n.body
             and isinstance(n.body[0], ast.Expr) and isinstance(n.body[0].value, ast.Constant)}
    return [n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in prose]


def test_the_recorder_never_signs_in_or_out_itself_and_never_reads_the_password():
    """⚰️ Until 2026-11-23 it POSTed the login itself and signed out on the last line of the run: a run that left
    early left a live 30-day session to a production account (the sign-out rail found it)."""
    tree = ast.parse(RECORDER.read_text(encoding="utf-8"))
    strings = _code_strings(tree)
    for needle in ("/api/auth/" + "login", "/api/auth/" + "logout", "_PASS" + "WORD"):
        assert not [s for s in strings if needle in s and "is not set" not in s], needle
    # CONTROL: the walk sees the strings of the code (the door it sends to is one of them)
    assert value_record.CONVERSE in strings
    # the sign-in is the helper's, by the account's NAME
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
             and n.func.attr == "sign_in_playwright"]
    assert len(calls) == 1 and getattr(calls[0].func.value, "id", None) == "synthetic_session"
    assert [getattr(a, "id", None) for a in calls[0].args] == ["page", "BASE", "name"] and not calls[0].keywords
    # the one domain is the helper's: read from it, never written a second time
    domain = next(n for n in tree.body if isinstance(n, ast.Assign) and getattr(n.targets[0], "id", None) == "SYNTHETIC_DOMAIN")
    assert ast.unparse(domain.value) == "synthetic_session.SYNTHETIC_DOMAIN"
    assert value_record.SYNTHETIC_DOMAIN == "@uctintelligence.internal"


def test_the_session_and_the_browser_are_closed_however_the_run_is_left():
    """Held in the code: the session the helper returns goes straight into the block's exit stack (so does the
    browser), and nothing in the run closes either by hand, where an early exit would skip it."""
    tree = ast.parse(RECORDER.read_text(encoding="utf-8"))
    main = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "main")
    block = next(n for n in ast.walk(main) if isinstance(n, ast.With)
                 and any("ExitStack" in ast.dump(i.context_expr) for i in n.items))
    stack = next(i.optional_vars.id for i in block.items if "ExitStack" in ast.dump(i.context_expr))
    entered = [n for n in ast.walk(block) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
               and n.func.attr == "enter_context" and getattr(n.func.value, "id", None) == stack]
    assert len(entered) == 1 and "sign_in_playwright" in ast.dump(entered[0].args[0])   # entered AS it is made
    callbacks = [n for n in ast.walk(block) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                 and n.func.attr == "callback" and getattr(n.func.value, "id", None) == stack]
    assert [ast.unparse(c.args[0]) for c in callbacks] == ["browser.close"]
    by_hand = [ast.unparse(n) for n in ast.walk(main) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
               and n.func.attr == "close" and not n.args]
    assert by_hand == [], by_hand
    # every way out of the block before the end is a plain `return` inside it: the stack runs on each
    assert [n for n in ast.walk(block) if isinstance(n, ast.Return)]
    # and the run's stamps say whether the sign-out was proved
    assert any(k.arg == "signed_out" for n in ast.walk(main) if isinstance(n, ast.Call) for k in n.keywords)


def test_the_sign_out_rail_sees_nothing_to_refuse_in_the_recorder():
    from tests import test_synthetic_session_signout as rail
    _triggered, bad = rail.violations("tools/value_record.py", RECORDER.read_text(encoding="utf-8"))
    assert bad == []
    # CONTROL: the rail refuses the recorder as it was (a login it POSTs itself)
    was = RECORDER.read_text(encoding="utf-8").replace(
        "session = leave.enter_context(synthetic_session.sign_in_playwright(page, BASE, name))",
        'page.request.post(BASE + "/api/auth/" + "login")'.replace('" + "', ""))
    assert was != RECORDER.read_text(encoding="utf-8")
    assert rail.violations("tools/value_record.py", was)[1]


def test_a_refused_or_failed_sign_in_leaves_no_session_and_no_browser(monkeypatch, tmp_path, capsys):
    """The run itself, with a stand-in browser and a stand-in helper: whichever way the sign-in fails, the browser
    is closed and the session (when one came back) is closed, before `main` returns."""
    import types
    closed = []

    class Session:
        def __init__(self, ok):
            self.ok, self.status, self.signed_out = ok, 401, None

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            closed.append("session")
            self.signed_out = True
            return False

    class Page:
        request = None

        def goto(self, *a, **k):
            return None

    class Browser:
        def new_context(self, **k):
            return types.SimpleNamespace(new_page=lambda: Page())

        def close(self):
            closed.append("browser")

    class PW:
        chromium = types.SimpleNamespace(launch=lambda: Browser())

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    fake = types.ModuleType("playwright.sync_api")
    fake.sync_playwright = lambda: PW()
    monkeypatch.setitem(__import__("sys").modules, "playwright", types.ModuleType("playwright"))
    monkeypatch.setitem(__import__("sys").modules, "playwright.sync_api", fake)
    monkeypatch.setenv("BENCH_EMAIL", "bench@uctintelligence.internal")
    monkeypatch.setenv("BENCH_PASSWORD", "x")
    helper = value_record.synthetic_session

    # (1) the door answers a refusal: a session object comes back, not ok
    monkeypatch.setattr(helper, "sign_in_playwright", lambda page, base, name: Session(False))
    assert value_record.main([str(tmp_path / "a")]) == 2
    assert closed == ["session", "browser"] and "not accepted (HTTP 401)" in capsys.readouterr().out
    # (2) the helper raises (someone else's session, no cookie, TOTP): it signed out itself; the browser still closes
    closed.clear()

    def raises(page, base, name):
        raise helper.IdentityMismatch("answered for a different or no account; the session was signed out")
    monkeypatch.setattr(helper, "sign_in_playwright", raises)
    assert value_record.main([str(tmp_path / "b")]) == 2
    assert closed == ["browser"] and "REFUSED" in capsys.readouterr().out
    # (3) anything else going wrong after the sign-in: the session and the browser are closed on the way out
    closed.clear()
    monkeypatch.setattr(helper, "sign_in_playwright", lambda page, base, name: Session(True))
    with pytest.raises(AttributeError):                      # the stand-in page has no `request`: the run breaks at its next line
        value_record.main([str(tmp_path / "c")])
    assert closed == ["session", "browser"]

