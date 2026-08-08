"""The ROLLBACK LEVER: `ALERT_EVAL_MODE` as an environment override.

⭐ WHY THIS EXISTS, AND IT IS NOW LOAD-BEARING RATHER THAN PRECAUTIONARY. Task 8
has flipped the committed constant to `"closed"`. If the closed lane misbehaves,
that is discovered DURING A SESSION — and rolling back used to mean a code edit,
a push and a Railway build (~10 minutes), except that the pre-push hook BLOCKS
pushes 09:15-16:20 ET, which is exactly the window in which the rollback would be
wanted. That is a full trading session of wrong alert behaviour with no
mitigation. The lever is one Railway variable:

    railway variables --service web --set "ALERT_EVAL_MODE=forming"

⚠️ SINCE THE CUTOVER THE TWO DIRECTIONS HAVE SWAPPED WHICH ONE IS EASY. Every
test that overrides to `"closed"` is now agreeing with the default and proves
nothing on its own, so the file drives `"forming"` wherever the point is that the
override MOVED something, and keeps a constant-patched test for the other
direction so neither lane is a special case of what happens to be committed.

⛔ EVERY ASSERTION HERE THAT CARES ABOUT A LANE IS BEHAVIOURAL. `eval_mode()`
returning the string "closed" and the evaluator RUNNING the closed lane are two
different claims, and a phase whose mandated mutation is a tombstone — a mode
function hardcoded while the constant it reports still says otherwise — cannot
afford to check the first and assume the second. So the fixture below is built
so the two lanes give DIFFERENT ANSWERS on the same bars, and the tests read the
answer, not the label.

⚠️ THE ENVIRONMENT IS CONTROLLED FOR EVERY TEST IN THIS FILE (autouse). A shell
that already exports `ALERT_EVAL_MODE` would otherwise silently re-point the
whole module.
"""

from __future__ import annotations

import ast
import json
import logging
import pathlib
import time

import pytest

from api.services import indicator_alert_evaluator as ev

_ROOT = pathlib.Path(__file__).resolve().parent.parent
_TF = "5"


# ─── the fixture: one set of bars on which the two lanes DISAGREE ────────────

def _bars(n: int = 60) -> list:
    """`n` 5-minute bars whose newest bar is still OPEN.

    The newest (forming) bar closes at 110 and the newest CLOSED bar closes at
    90, so on `close above 100` the forming lane answers `(110.0, True)` and the
    closed lane answers `(90.0, False)`. Two axes of difference — the value and
    the trigger — so a lane cannot be mistaken for the other by accident.
    """
    t0 = (int(time.time()) // 300) * 300 - (n - 1) * 300
    out = []
    for i in range(n):
        c = 100.0
        if i == n - 2:
            c = 90.0
        if i == n - 1:
            c = 110.0
        out.append({"t": t0 + i * 300, "o": c, "h": c + 1.0, "l": c - 1.0,
                    "c": c, "v": 1000})
    return out


def _alert() -> dict:
    return {"id": 1, "user_id": "u", "sym": "T", "tf": _TF,
            "indicator": "close", "condition": "above", "threshold": 100.0,
            "params_json": None, "last_value": None, "alert_key": "k"}


#: What each lane answers on `_bars()`. Named, so a test can say WHICH LANE RAN
#: rather than compare two magic numbers.
FORMING_ANSWER = (110.0, True)
CLOSED_ANSWER = (90.0, False)


def _lane_that_ran(bars: list) -> str:
    """Run an UNQUALIFIED `_evaluate_one` and name the lane it took.

    Unqualified on purpose: every explicit `mode="closed"` test in the suite
    rides straight past a mutated `eval_mode()`. This is the call production
    makes, and it is the only one that can see the mode at all.
    """
    now = ev.bar_close_epoch(bars[-1]["t"], _TF) - 1
    answer = ev._evaluate_one(_alert(), bars=bars, now_epoch=now)
    if answer == FORMING_ANSWER:
        return "forming"
    if answer == CLOSED_ANSWER:
        return "closed"
    raise AssertionError(
        "the unqualified lane answered {!r}, which is NEITHER lane's answer on "
        "this fixture ({!r} forming / {!r} closed) — the fixture has stopped "
        "separating them and every assertion in this file would be vacuous"
        .format(answer, FORMING_ANSWER, CLOSED_ANSWER))


@pytest.fixture(autouse=True)
def clean_lever(monkeypatch):
    """No inherited variable, no inherited refusal count. Restored by pytest."""
    monkeypatch.delenv(ev.ALERT_EVAL_MODE_ENV, raising=False)
    monkeypatch.setattr(ev, "_EVAL_MODE_REFUSALS", {})


@pytest.fixture
def bars():
    return _bars()


def test_the_fixture_really_does_separate_the_two_lanes(bars):
    """⭐ THE CONTROL FOR EVERY TEST BELOW.

    If both lanes answered the same thing here, "the override moved the lane"
    and "the override did nothing" would look identical, and this whole file
    would be a set of assertions that cannot fail. Driven through the EXPLICIT
    modes, so it is a property of the fixture and not of `eval_mode()`.
    """
    now = ev.bar_close_epoch(bars[-1]["t"], _TF) - 1
    forming = ev._evaluate_one(_alert(), bars=bars, mode="forming",
                               now_epoch=now)
    closed = ev._evaluate_one(_alert(), bars=bars, mode="closed", now_epoch=now)
    assert forming == FORMING_ANSWER
    assert closed == CLOSED_ANSWER
    assert forming != closed


# ─── 1. the committed default ───────────────────────────────────────────────

def test_the_committed_constant_is_closed_and_is_assigned_once():
    """⛔ TASK 8 FLIPPED IT, IN ITS OWN COMMIT, AFTER THE SOAK.

    Read off the AST rather than off the imported value, because a module that
    assigned the constant twice would import with the second value and an
    equality check would happily agree with it.
    """
    src = pathlib.Path(ev.__file__).read_text(encoding="utf-8")
    tree = ast.parse(src)
    assigned = [n for n in tree.body
                if isinstance(n, ast.Assign)
                and any(getattr(t, "id", None) == "ALERT_EVAL_MODE"
                        for t in n.targets)]
    assert len(assigned) == 1, "ALERT_EVAL_MODE is assigned more than once"
    assert assigned[0].value.value == "closed"
    assert ev.ALERT_EVAL_MODE == "closed"


def test_with_no_variable_set_the_COMMITTED_lane_is_the_one_that_runs(bars):
    """The inert state, which is production.

    Until somebody sets the variable, `eval_mode()` is the constant — and the
    lane the evaluator actually takes is that one, asserted behaviourally rather
    than as a string.
    """
    assert ev.eval_mode() == "closed"
    assert _lane_that_ran(bars) == "closed"
    report = ev.eval_mode_report()
    assert report["override_present"] is False
    assert report["override_applied"] is False
    assert report["override_refused"] is False
    assert report["effective"] == "closed"


# ─── 2. the override actually moves the lane ────────────────────────────────

def test_the_ROLLBACK_moves_the_LANE_not_merely_the_STRING(bars, monkeypatch):
    """🔴 THE MUTATION RAIL FOR "the override is ignored entirely" — AND SINCE
    THE CUTOVER IT IS ALSO THE DIRECTION THAT MATTERS MONDAY MORNING.

    A lever that reports itself pulled and changes nothing is worse than no
    lever: the operator stops looking for the problem. So this asserts the
    evaluator's own answer, through a call that passes no `mode`. With the
    committed constant now `"closed"`, the environment saying `"forming"` IS the
    rollback — the whole reason the seam was built before the flip.
    """
    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "forming")
    assert ev.eval_mode() == "forming"
    assert _lane_that_ran(bars) == "forming"
    assert ev.eval_mode_report()["override_applied"] is True


def test_the_override_works_in_the_OTHER_direction_too(bars, monkeypatch):
    """⭐ BOTH DIRECTIONS, SO NEITHER IS A SPECIAL CASE OF THE COMMITTED VALUE.

    The constant is PATCHED here rather than edited, so this measures the lever
    on a tree whose default is the opposite of today's. Before the cutover this
    test was the rollback direction and the one above was the easy one; the
    cutover swapped which is which, and keeping both is what stops the file from
    quietly becoming a set of assertions that all agree with the default.
    """
    monkeypatch.setattr(ev, "ALERT_EVAL_MODE", "forming")
    assert _lane_that_ran(bars) == "forming", "the patched constant did not take"

    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "closed")
    assert ev.eval_mode() == "closed"
    assert _lane_that_ran(bars) == "closed"
    assert ev.eval_mode_report()["override_applied"] is True


def test_the_value_is_trimmed_and_case_folded(bars, monkeypatch):
    """`" Closed\\n"` is not a guess, it is the same word.

    Railway variables are typed and pasted by a human under pressure. Trimming
    whitespace and folding case normalises the SAME token; it never invents a
    lane, which is what the refusal below is about.
    """
    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "  Forming\n")
    assert ev.eval_mode() == "forming"
    assert _lane_that_ran(bars) == "forming"
    # …and the other spelling of the other lane, so the fold is not being
    # measured only against the committed default (which would agree anyway).
    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "\tCLOSED ")
    assert ev.eval_mode() == "closed"


# ─── 3. an unrecognised value is refused, and refused LOUDLY ────────────────

def test_an_unrecognised_value_keeps_the_COMMITTED_DEFAULT_lane(bars,
                                                                monkeypatch):
    """🔴 THE MUTATION RAIL FOR "an unrecognised value silently picks a lane".

    `ALERT_EVAL_MODE=closd` names nothing. Picking a lane off it — any lane — is
    how a rollback attempt becomes a no-op, or worse a SECOND unreviewed flip,
    at the worst possible moment.

    ⚠️ THIS TEST DELIBERATELY ASSERTS ONLY THE LANE. The readback's account of
    the same event is the test below, and they are separate because two
    DIFFERENT mutations break them: accepting the typo as a lane breaks this
    one, a readback that re-derives its own answer breaks that one. Rolled into
    a single test they shared every killer and neither was diagnostic.
    """
    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "closd")
    assert ev.eval_mode() == "closed", (
        "an unrecognised value picked a lane instead of being refused")
    assert _lane_that_ran(bars) == "closed"


def test_the_readback_ACCOUNTS_for_a_refused_override(monkeypatch):
    """The other half: the operator has to be able to SEE that it was refused.

    A refusal the lane honours but the readback never mentions is a rollback the
    operator believes happened.
    """
    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "closd")
    report = ev.eval_mode_report()
    assert report["override_present"] is True
    assert report["override_applied"] is False
    assert report["override_refused"] is True
    assert report["env_value"] == "closd"


@pytest.mark.parametrize("raw", ["closd", "closed", "forming", "", "  ", "OPEN"])
def test_the_reports_effective_field_IS_eval_mode_ITSELF(raw, monkeypatch):
    """🔴 THE MUTATION RAIL FOR "the readback re-derives the lane".

    ⚠️ THE COMPLEMENT OF `test_the_report_names_the_lane_that_ACTUALLY_RAN`, NOT
    A WEAKER COPY OF IT — AND THE PAIR IS WHY EACH MUTATION HAS ITS OWN KILLER.
    That test compares the report against the lane the evaluator TOOK, so it
    dies whenever the reported mode and the effective mode part company, from
    either side. This one compares the report against `eval_mode()`, so it dies
    ONLY when the report computed its own answer instead of asking. A report
    that re-derives agrees with the lane on every input EXCEPT an unrecognised
    one — which is precisely the input an operator reads it on.
    """
    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, raw)
    assert ev.eval_mode_report()["effective"] == ev.eval_mode(), (
        "the readback answered from its own reading of the environment rather "
        "than from the function the evaluator calls")


def test_a_refused_override_is_LOUD_once_per_distinct_value(caplog,
                                                            monkeypatch):
    """A refusal nobody can read is a silent default wearing a comment.

    ⚠️ ONCE PER DISTINCT VALUE, NOT ONCE PER CALL: `eval_mode()` runs once per
    armed alert per 60 s cycle, so an unthrottled ERROR would put 31 identical
    lines a minute between the operator and the one line that matters. The
    COUNT still grows on every call, and `eval_mode_report()` carries it, so the
    evidence outlives the log window.
    """
    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "closd")
    with caplog.at_level(logging.ERROR, logger=ev._logger.name):
        ev.eval_mode()
        ev.eval_mode()
        ev.eval_mode()
    refused = [r for r in caplog.records if "REFUSED" in r.getMessage()]
    assert len(refused) == 1, "one ERROR per distinct bad value, not per call"
    assert "closd" in refused[0].getMessage()
    assert "HAS NOT TAKEN" in refused[0].getMessage(), (
        "the line does not tell the operator their rollback did not happen")
    assert ev.eval_mode_report()["refusals"] >= 3

    caplog.clear()
    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "clsoed")
    with caplog.at_level(logging.ERROR, logger=ev._logger.name):
        ev.eval_mode()
    assert len([r for r in caplog.records if "REFUSED" in r.getMessage()]) == 1


@pytest.mark.parametrize("raw", ["", "   ", "\n"])
def test_a_BLANK_variable_is_a_stood_down_lever_not_a_typo(raw, bars,
                                                           monkeypatch,
                                                           caplog):
    """Emptying a Railway variable is how an operator un-does the override.

    Treating "" as unrecognised would log an ERROR and report a REFUSAL at the
    exact moment the lever was correctly stood down — an operator reading that
    mid-session would believe the pod is in a state it is not.
    """
    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, raw)
    with caplog.at_level(logging.ERROR, logger=ev._logger.name):
        assert ev.eval_mode() == "closed"
    assert _lane_that_ran(bars) == "closed"
    report = ev.eval_mode_report()
    assert report["override_present"] is False
    assert report["override_refused"] is False
    assert report["refusals"] == 0
    assert [r for r in caplog.records if "REFUSED" in r.getMessage()] == []


# ─── 4. the report cannot disagree with the lane ────────────────────────────

@pytest.mark.parametrize("raw,expected", [
    (None, "closed"),
    ("closed", "closed"),
    ("forming", "forming"),
    ("CLOSED", "closed"),
    ("FORMING", "forming"),
    ("closd", "closed"),
    ("", "closed"),
])
def test_the_report_names_the_lane_that_ACTUALLY_RAN(raw, expected, bars,
                                                     monkeypatch):
    """🔴 THE ANTI-TOMBSTONE RAIL.

    Task 8's mandated mutation is `eval_mode()` hardcoded "closed" while the
    constant still reads "forming" — "a tombstone that reports the flip as
    done". This lever legitimately makes the constant differ from the running
    lane, so it must not add a SECOND way for the reported mode and the
    effective mode to disagree.

    ⛔ ASSERTING `report["effective"] == eval_mode()` WOULD NOT BE THAT RAIL:
    two calls to the same mutated function agree with each other trivially. So
    the comparison is against the lane the EVALUATOR TOOK on the fixture.
    """
    if raw is None:
        monkeypatch.delenv(ev.ALERT_EVAL_MODE_ENV, raising=False)
    else:
        monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, raw)
    report = ev.eval_mode_report()
    assert report["effective"] == expected
    assert _lane_that_ran(bars) == report["effective"], (
        "the report names {!r} while the evaluator ran the other lane — the "
        "readback an operator would trust mid-rollback is lying"
        .format(report["effective"]))


# ─── 5. the seam stays a seam ───────────────────────────────────────────────

def test_os_environ_is_read_in_EXACTLY_ONE_PLACE_in_the_module():
    """The one-reader rule, applied to the environment as well as the constant.

    `eval_mode()` is the only reader of `ALERT_EVAL_MODE` and a source scan
    enforces it (`test_eval_mode_is_the_ONLY_reader_of_the_constant`). A lever
    whose `os.environ.get` was copied to three call sites would reintroduce
    exactly what that rule exists to prevent: a branch no test can drive.
    """
    path = pathlib.Path(ev.__file__)
    tree = ast.parse(path.read_text(encoding="utf-8"))

    environ_nodes = [n for n in ast.walk(tree)
                     if isinstance(n, ast.Attribute) and n.attr == "environ"
                     and isinstance(n.value, ast.Name) and n.value.id == "os"]
    assert environ_nodes, (
        "no `os.environ` in the module at all — this rail would pass on a tree "
        "where the override had been deleted")

    holders = set()
    for fn in ast.walk(tree):
        if not isinstance(fn, ast.FunctionDef):
            continue
        inner = {id(n) for n in ast.walk(fn)}
        for node in environ_nodes:
            if id(node) in inner:
                holders.add(fn.name)
    assert holders == {"_override_raw"}, (
        "the environment is read outside `_override_raw`: {}".format(
            sorted(holders)))

    # …and not smuggled in under another name.
    assert not [n for n in ast.walk(tree)
                if isinstance(n, ast.ImportFrom) and n.module == "os"
                and any(a.name == "environ" for a in n.names)]


def test_the_runbook_carries_the_EXACT_command_for_the_variable_this_code_reads():
    """The lever and the runbook step cannot drift apart.

    Six false alarms in one session came from identifiers typed from memory, so
    the variable name in the assertion below is READ OFF THE MODULE and then
    looked for in the runbook — a rename that forgot the docs fails here rather
    than at 09:31 ET on a Monday.
    """
    doc = (_ROOT / "docs" / "runbooks" / "cutover-watch.md").read_text(
        encoding="utf-8")
    name = ev.ALERT_EVAL_MODE_ENV
    assert "railway variables --set" in doc
    assert "{}=forming".format(name) in doc, (
        "the runbook does not carry the rollback command for {}".format(name))
    # The readback is documented too — a lever with no readback is a lever an
    # operator has to trust rather than confirm.
    assert "eval_mode_report" in doc or "/api/indicator-alerts/latency" in doc


def test_the_endpoint_reports_the_effective_mode_and_its_provenance(monkeypatch):
    """The readback surface, exercised through the shipped handler.

    ⚠️ Called as a FUNCTION with the auth dependency satisfied by hand: this is
    about the body it builds, and a TestClient here would drag the whole app's
    lifespan (schedulers, stores) into a test about one dict.
    """
    from api.routers import indicator_alerts as router

    # No override: the committed lane, and the closed lane's worst case includes
    # the time a bar takes to finish — the honest price of not repainting.
    body = router.get_alert_latency(user={"id": "u"})
    assert body["mode"] == "closed"
    assert body["eval_mode"]["effective"] == body["mode"]
    assert body["eval_mode"]["override_present"] is False
    assert body["eval_mode"]["env_var"] == ev.ALERT_EVAL_MODE_ENV
    assert (body["worst_case_seconds"]["5"]
            > body["cycle_seconds"]), json.dumps(body["worst_case_seconds"])

    # …and the ROLLBACK is visible in the same body, in one read: the lane, the
    # provenance, AND the latency all move together.
    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "forming")
    rolled = router.get_alert_latency(user={"id": "u"})
    assert rolled["mode"] == "forming"
    assert rolled["eval_mode"]["effective"] == rolled["mode"]
    assert rolled["eval_mode"]["override_applied"] is True
    assert rolled["worst_case_seconds"]["5"] == rolled["cycle_seconds"], (
        "the latency answer did not follow the effective lane")
