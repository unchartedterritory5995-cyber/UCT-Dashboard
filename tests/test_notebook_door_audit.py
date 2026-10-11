"""Pure rails on the exit-bar door audit (tools/notebook_door_audit.py), Task 14.

No browser, no sandbox: the table's shape, the verdict function, the exit code, and the tool's own
`--self-check`. The browser half is the instrument; its raw evidence is committed under
docs/notebook/evidence/door-audit-<stamp>/.

Every rail here has a case that must be able to FAIL: `test_self_check_can_fail` feeds the
self-check a wrong expectation and asserts it notices; `test_the_verdict_is_not_a_constant` proves
the verdict function distinguishes the five verdicts, so a function that always answers EASY (the
mutation this file is proved against) fails five tests, not one.
"""
import json
import subprocess
import sys
from pathlib import Path

import tools.notebook_door_audit as A

REPO = Path(__file__).resolve().parents[1]
REQUIRED = {11, 15, 23, 24, 26, 29, 32, 33, 34, 35, 39, 40, 41, 42, 46, 53}


def table():
    return json.loads((REPO / "tools" / "notebook_door_audit_doors.json").read_text(encoding="utf-8"))


def test_every_hard_or_hidden_audit_row_has_a_door_or_a_reason():
    rows = table()
    covered = {r["audit_row"] for r in rows}
    assert REQUIRED <= covered
    for r in rows:
        if r.get("door") is False:
            assert A.has_reason(r), f"{r['feature']}: no door and no written reason"


def test_the_table_is_well_formed():
    assert A.validate_table(table()) == []


def test_verdicts():
    assert A.verdict({"found": True, "above_fold": True, "steps": 1, "uncovered": True}) == "EASY"
    assert A.verdict({"found": False}) == "HIDDEN"
    assert A.verdict({"found": True, "above_fold": False, "steps": 4, "uncovered": True}) == "HARD"


def test_the_verdict_is_not_a_constant():
    """The mutation proof makes `verdict` always return EASY; this is the case that catches it."""
    got = {A.verdict(m) for _name, m, _want in A.CASES}
    assert got == {"EASY", "OK", "HARD", "HIDDEN", "NOT_MEASURED"}


def test_every_known_case_holds():
    for name, m, want in A.CASES:
        assert A.verdict(m) == want, name


def test_a_covered_or_off_edge_target_is_never_easy():
    # on the page and above the fold, but a press lands on something else: the phone mic that sat
    # at x=398 on a 390 px screen was exactly this
    assert A.verdict({"found": True, "above_fold": True, "steps": 0, "uncovered": False}) == "HARD"


def test_a_label_and_one_scroll_make_a_door_ok_and_an_icon_does_not():
    base = {"found": True, "above_fold": False, "steps": 1, "uncovered": True, "scroll_screens": 1}
    assert A.verdict({**base, "labelled": True}) == "OK"
    assert A.verdict({**base, "labelled": False}) == "HARD"
    assert A.verdict({**base, "labelled": True, "scroll_screens": 2}) == "HARD"


def test_unmeasurable_here_is_not_measured_never_hidden_and_never_a_pass():
    row = {"feature": "x", "audit_row": 42, "unmeasurable_here": True, "reason": "needs the overnight run"}
    v, each = A.row_verdict(row, {"1280": {"found": False}, "390": {"found": False}})
    assert v == "NOT_MEASURED" and set(each.values()) == {"NOT_MEASURED"}
    # without the declaration the same measurement is HIDDEN
    v2, _ = A.row_verdict({"feature": "x", "audit_row": 42}, {"1280": {"found": False}})
    assert v2 == "HIDDEN"


def test_a_row_is_its_worst_viewport():
    ok = {"found": True, "above_fold": True, "steps": 3, "uncovered": True}
    hard = {"found": True, "above_fold": False, "steps": 5, "uncovered": True}
    v, each = A.row_verdict({"feature": "x", "audit_row": 11}, {"1280": ok, "390": hard})
    assert v == "HARD" and each == {"1280": "OK", "390": "HARD"}


def test_a_row_with_no_door_is_no_door_not_a_pass():
    v, _ = A.row_verdict({"feature": "x", "audit_row": 29, "door": False, "reason": "none built"}, {})
    assert v == "NO_DOOR"
    assert A.verdict({"found": True, "above_fold": True, "steps": 0, "uncovered": True}) != v


def test_exit_codes():
    ok = {"row": {}, "verdict": "EASY"}
    assert A.exit_code([ok]) == 0
    assert A.exit_code([ok, {"row": {"reason": "x"}, "verdict": "HIDDEN"}]) == 1       # a reason never clears HIDDEN
    assert A.exit_code([ok, {"row": {}, "verdict": "HARD"}]) == 1                      # HARD with no reason
    assert A.exit_code([ok, {"row": {"reason": "owner call"}, "verdict": "HARD"}]) == 0
    assert A.exit_code([ok, {"row": {}, "verdict": "NO_DOOR"}]) == 1
    assert A.exit_code([ok, {"row": {}, "verdict": "NOT_MEASURED"}]) == 1
    assert A.exit_code([{"row": {"reason": "x"}, "verdict": "NOT_MEASURED"}]) == 2     # nothing was measured
    assert A.exit_code([]) == 2


def test_the_known_exit_cases_hold():
    for name, results, want in A.EXIT_CASES:
        assert A.exit_code(results) == want, name


def test_a_malformed_table_is_refused():
    assert A.validate_table([]) != []
    rows = table()
    bad = json.loads(json.dumps(rows))
    bad[0]["viewports"] = ["1024"]
    assert any("viewports" in w for w in A.validate_table(bad))
    bad = json.loads(json.dumps(rows))
    bad[0]["steps"] = [{"tap": "x"}]
    assert any("bad step" in w for w in A.validate_table(bad))
    bad = json.loads(json.dumps(rows))
    bad[0]["steps"] = [{"click": "no pipe here"}]
    assert any("role|name" in w for w in A.validate_table(bad))
    bad = [dict(r) for r in rows if r["audit_row"] != 42]
    assert any("42" in w for w in A.validate_table(bad))
    bad = json.loads(json.dumps(rows))
    for r in bad:
        if r.get("door") is False:
            r.pop("reason")
    assert any("written reason" in w for w in A.validate_table(bad))


def test_self_check_passes():
    r = subprocess.run([sys.executable, "tools/notebook_door_audit.py", "--self-check"],
                       capture_output=True, text=True, cwd=str(REPO))
    assert r.returncode == 0, r.stdout + r.stderr


def test_self_check_can_fail():
    wrong = A.self_check(cases=[("an obvious EASY, expected HIDDEN",
                                 {"found": True, "above_fold": True, "steps": 1, "uncovered": True}, "HIDDEN")],
                         exit_cases=[])
    assert wrong and "got EASY" in wrong[0]
    wrong = A.self_check(cases=[], exit_cases=[("a HARD row with no reason, expected 0",
                                                [{"row": {}, "verdict": "HARD"}, {"row": {}, "verdict": "EASY"}], 0)])
    assert wrong and "exit_code" in wrong[0]
