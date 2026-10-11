"""Pure rails on the exit-bar door audit (tools/notebook_door_audit.py), Task 14 and its fix round 1.

No browser, no sandbox: the table's shape, the verdict function, the exit code, the control's exit
check, and the tool's own `--self-check`. The browser half is the instrument; its raw evidence is
committed under docs/notebook/evidence/door-audit-<stamp>/.

Every grading rule below is pinned to the row of the 2026-10-11 audit
(docs/notebook/discoverability-audit-2026-10-11.md) that fixes it, because the instrument has to
grade the way the audit graded. Every rail has a case that must be able to FAIL:
`test_self_check_can_fail` feeds the self-check a wrong expectation; `test_the_verdict_is_not_a_constant`
proves the verdict function tells the five verdicts apart, so the mutation this file is proved
against (verdict always EASY, exit_code always 0) fails several tests, not one.
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


def m(clicks, above, **kw):
    return {"found": True, "above_fold": above, "clicks": clicks, "uncovered": True, **kw}


# ── the table ──────────────────────────────────────────────────────────────────────────────────

def test_every_hard_or_hidden_audit_row_has_a_door_or_is_declared_doorless():
    rows = table()
    assert REQUIRED <= {r["audit_row"] for r in rows}
    for r in rows:
        if r.get("door") is False:
            assert A.reason_for(r, "HIDDEN"), f"{r['feature']}: no door and no written note of why"


def test_the_table_is_well_formed():
    assert A.validate_table(table()) == []


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
    # no row in the table is doorless any more (task 14b built the last two); the rule still holds
    bad = json.loads(json.dumps(rows))
    next(r for r in bad if r["audit_row"] == 29)["door"] = False
    assert any("written reason" in w for w in A.validate_table(bad))
    bad = json.loads(json.dumps(rows))
    next(r for r in bad if r["audit_row"] == 15)["reason"] = "a bare string is no longer a reason"
    assert any("reason is" in w for w in A.validate_table(bad))
    bad = json.loads(json.dumps(rows))
    row = next(r for r in bad if r["audit_row"] == 42)
    row["unmeasurable_here"] = True
    row["reason"] = {"verdict": "HARD", "text": "wrong verdict for an unmeasurable row"}
    assert any("NOT_MEASURED reason" in w for w in A.validate_table(bad))
    bad = json.loads(json.dumps(rows))
    next(r for r in bad if r["audit_row"] == 42)["needs_seed"] = "no such seed"
    assert any("needs_seed" in w for w in A.validate_table(bad))
    bad = json.loads(json.dumps(rows))
    next(r for r in bad if r["audit_row"] == 29)["target"] = {"text": ""}
    assert any("a target needs" in w for w in A.validate_table(bad))


# ── the verdict, graded the way the audit grades ───────────────────────────────────────────────

def test_verdicts():
    # the brief's three cases, in presses-before (steps), still hold
    assert A.verdict({"found": True, "above_fold": True, "steps": 1, "uncovered": True}) == "EASY"
    assert A.verdict({"found": False}) == "HIDDEN"
    assert A.verdict({"found": True, "above_fold": False, "steps": 4, "uncovered": True}) == "HARD"


def test_a_click_counts_the_press_on_the_target_as_the_audit_does():
    # the audit's row 1, "Start a note": "1 / 1" -- one click, the press on the control itself
    assert A.clicks_of({"steps": 0}) == 1
    assert A.clicks_of({"steps": 3}) == 4          # open note, Details, Add property, then Add a formula
    assert A.clicks_of({"steps": 3, "clicks": 9}) == 9


def test_audit_row_1_one_click_with_a_label_above_the_fold_is_easy():
    assert A.verdict(m(1, True)) == "EASY" and A.verdict(m(2, True)) == "EASY"


def test_audit_row_14_three_clicks_is_ok():
    assert A.verdict(m(3, True)) == "OK"


def test_audit_row_15_four_or_more_clicks_is_hard():
    # "HARD: 4+ steps"; row 15 was graded HARD at 5 / 5
    assert A.verdict(m(4, True)) == "HARD"
    assert A.verdict(m(5, False, scroll_screens=1)) == "HARD"


def test_audit_row_22_an_icon_only_door_is_ok_at_best_never_easy():
    # row 22 Dictation: "2 / 2 ... icon only ... OK"; EASY needs a "plain label"
    assert A.verdict(m(2, True, labelled=False)) == "OK"
    assert A.verdict(m(1, True, labelled=False)) == "OK"


def test_audit_rows_39_and_40_three_clicks_and_a_scroll_is_hard():
    # "3 + scroll / 3 + scroll ... no / no ... HARD", even with a label
    assert A.verdict(m(3, False, labelled=True, scroll_screens=1)) == "HARD"


def test_audit_rows_13_and_45_a_label_and_one_scroll_at_two_clicks_or_fewer_is_ok():
    # row 13 "1 + scroll ... OK" and row 45 "2 / 2 ... at the bottom edge or below ... OK"
    assert A.verdict(m(1, False, labelled=True, scroll_screens=1)) == "OK"
    assert A.verdict(m(2, False, labelled=True, scroll_screens=1)) == "OK"


def test_the_audit_hard_rule_below_the_fold_and_icon_only():
    # "HARD: ... below the fold *and* jargon or icon-only"
    assert A.verdict(m(1, False, labelled=False, scroll_screens=1)) == "HARD"


def test_more_than_one_scroll_away_is_not_one_scroll():
    assert A.verdict(m(1, False, labelled=True, scroll_screens=3)) == "HARD"
    assert A.verdict(m(1, False, labelled=True, scroll_screens=2)) == "HARD"


def test_audit_row_24_a_covered_or_clipped_control_is_hard():
    # "a phone control off screen" (row 24: "the 44 px button spans x 354-398 on a 390 px screen")
    assert A.verdict({"found": True, "above_fold": True, "clicks": 1, "uncovered": False}) == "HARD"


def test_the_verdict_is_not_a_constant():
    """The mutation proof makes `verdict` always return EASY; this is the case that catches it."""
    assert {A.verdict(mm) for _name, mm, _want in A.CASES} == {"EASY", "OK", "HARD", "HIDDEN", "NOT_MEASURED"}


def test_every_known_case_holds():
    for name, mm, want in A.CASES:
        assert A.verdict(mm) == want, name


# ── rows, reasons, the exit code ───────────────────────────────────────────────────────────────

def test_a_row_is_its_worst_viewport():
    v, each = A.row_verdict({"feature": "x", "audit_row": 11}, {"1280": m(2, True), "390": m(5, False, scroll_screens=1)})
    assert v == "HARD" and each == {"1280": "EASY", "390": "HARD"}


def test_a_doorless_row_is_hidden_not_a_pass_and_not_a_new_verdict():
    v, _ = A.row_verdict({"feature": "x", "audit_row": 29, "door": False,
                          "reason": {"verdict": "HIDDEN", "text": "none built"}}, {})
    assert v == "HIDDEN"


def test_unmeasurable_here_is_not_measured_only_when_every_step_was_made():
    row = {"feature": "x", "audit_row": 42, "unmeasurable_here": True,
           "reason": {"verdict": "NOT_MEASURED", "text": "needs the overnight run"}}
    absent = {"found": False, "target_absent": True}
    assert A.row_verdict(row, {"1280": absent})[0] == "NOT_MEASURED"
    # a STEP that could not be made on a page that loaded is HIDDEN, whatever the row says
    broken = {"found": False, "step_failed": True, "failed_step": "click link|Open the setups board: not on screen"}
    assert A.row_verdict(row, {"1280": broken})[0] == "HIDDEN"
    assert A.row_verdict(row, {"1280": {"found": False, "target_absent": True, "step_failed": True}})[0] == "HIDDEN"
    # without the declaration the same absence is HIDDEN
    assert A.row_verdict({"feature": "x", "audit_row": 42}, {"1280": absent})[0] == "HIDDEN"


def test_a_page_that_broke_is_not_measured_and_a_missing_step_is_hidden():
    assert A.verdict({"found": False, "setup_failed": "TimeoutError while load: the page never loaded"}) == "NOT_MEASURED"
    assert A.verdict({"found": False, "step_failed": True}) == "HIDDEN"


def test_a_reason_clears_only_the_verdict_it_was_written_for():
    row = {"reason": {"verdict": "HARD", "text": "formulas are per-note properties"}}
    assert A.reason_for(row, "HARD")
    assert A.reason_for(row, "HIDDEN") is None and A.reason_for(row, "NOT_MEASURED") is None
    assert A.reason_for({"reason": {"verdict": "HARD", "text": "  "}}, "HARD") is None
    assert A.reason_for({"reason": "a bare string"}, "HARD") is None
    assert A.reason_for({}, "HARD") is None


def test_only_a_hard_reason_on_a_hard_row_clears_anything():
    hard = {"reason": {"verdict": "HARD", "text": "owner call"}}
    assert A.reason_clears(hard, "HARD")
    assert not A.reason_clears(hard, "HIDDEN") and not A.reason_clears(hard, "NOT_MEASURED")
    for v in ("HIDDEN", "NOT_MEASURED"):
        assert not A.reason_clears({"reason": {"verdict": v, "text": "recorded, not a pass"}}, v)
    assert not A.reason_clears({}, "HARD")


def test_exit_codes():
    ok = {"row": {}, "verdict": "EASY"}
    hard_ok = {"row": {"reason": {"verdict": "HARD", "text": "owner call"}}, "verdict": "HARD"}
    assert A.exit_code([ok]) == 0
    assert A.exit_code([ok, hard_ok]) == 0
    assert A.exit_code([ok, {"row": {"reason": {"verdict": "HIDDEN", "text": "x"}}, "verdict": "HIDDEN"}]) == 1   # never cleared
    assert A.exit_code([ok, {"row": {}, "verdict": "HARD"}]) == 1
    assert A.exit_code([ok, {"row": {"reason": {"verdict": "HIDDEN", "text": "x"}}, "verdict": "HARD"}]) == 1     # wrong verdict
    assert A.exit_code([ok, {"row": {"reason": {"verdict": "NOT_MEASURED", "text": "x"}}, "verdict": "NOT_MEASURED"}]) == 3
    assert A.exit_code([ok, {"row": {}, "verdict": "NOT_MEASURED"}]) == 3
    assert A.exit_code([{"row": {}, "verdict": "NOT_MEASURED"}]) == 2                                          # nothing measured
    assert A.exit_code([]) == 2


def test_a_failure_outranks_an_unproven_row_and_an_unproven_row_is_never_zero():
    nm = {"row": {"reason": {"verdict": "NOT_MEASURED", "text": "x"}}, "verdict": "NOT_MEASURED"}
    assert A.exit_code([nm, {"row": {}, "verdict": "EASY"}]) not in (0,)
    assert A.exit_code([nm, {"row": {}, "verdict": "HIDDEN"}]) == 1


def test_the_known_exit_cases_hold():
    for name, results, want in A.EXIT_CASES:
        assert A.exit_code(results) == want, name


# ── the control reaches the exit code ──────────────────────────────────────────────────────────

def test_the_control_set_as_it_must_answer_reaches_the_exit_code_correctly():
    assert A.control_exit_checks(dict(A.CONTROL_WANT)) == []


def test_the_control_notices_an_instrument_that_cannot_tell_hidden_from_easy():
    got = dict(A.CONTROL_WANT)
    got[A.C_ABSENT] = "EASY"                      # a tool that cannot fail
    got[A.C_STEP] = "EASY"
    assert A.control_exit_checks(got)
    got = dict(A.CONTROL_WANT)
    got[A.C_COVERED] = "EASY"
    got[A.C_FAR] = "EASY"
    assert A.control_exit_checks(got)             # no HARD row left to prove a reason clears only HARD


def test_the_control_notices_a_broken_exit_code(monkeypatch):
    monkeypatch.setattr(A, "exit_code", lambda results: 0)
    assert A.control_exit_checks(dict(A.CONTROL_WANT))


def test_the_control_covers_every_failure_shape_the_instrument_can_grade():
    assert set(A.CONTROL_WANT.values()) == {"EASY", "OK", "HIDDEN", "HARD"}
    assert {c["feature"] for c in A.CONTROLS} == set(A.CONTROL_WANT)
    step_row = next(c for c in A.CONTROLS if c["feature"] == A.C_STEP)
    assert step_row["steps"] and A.CONTROL_WANT[A.C_STEP] == "HIDDEN"       # a failing STEP is HIDDEN, never NOT_MEASURED


# ── the tool's own check ───────────────────────────────────────────────────────────────────────

def test_self_check_passes():
    r = subprocess.run([sys.executable, "tools/notebook_door_audit.py", "--self-check"],
                       capture_output=True, text=True, cwd=str(REPO))
    assert r.returncode == 0, r.stdout + r.stderr


def test_self_check_can_fail():
    wrong = A.self_check(cases=[("an obvious EASY, expected HIDDEN", m(1, True), "HIDDEN")], exit_cases=[])
    assert wrong and "got EASY" in wrong[0]
    wrong = A.self_check(cases=[], exit_cases=[("a HARD row with no reason, expected 0",
                                                [{"row": {}, "verdict": "HARD"}, {"row": {}, "verdict": "EASY"}], 0)])
    assert any("exit_code" in w for w in wrong)


def test_the_door_table_hash_is_recorded_and_stable():
    h = A.table_sha256()
    assert len(h) == 64 and h == A.table_sha256()


# ── Task 14b: rows 29 and 53 through Learn, and row 42 measured on seeded matches ───────────────

def row_of(audit_row):
    return next(r for r in table() if r["audit_row"] == audit_row)


def test_rows_29_and_53_are_reached_through_learn_and_the_sheet_names_them():
    """The door is Research Home > Learn > What your Notebook can do > the entry's label in the Sheet.
    The labels are the catalogue's own (capabilityList.js), read from the file, never retyped."""
    cap = (REPO / "app" / "src" / "pages" / "journal-2-0" / "components" / "notebook" / "onboarding" / "capabilityList.js").read_text(encoding="utf-8")
    for audit_row, label in ((29, "Compass can read your notes"), (53, "Terminal commands in notes")):
        assert f"label: '{label}'" in cap, f"capabilityList.js no longer carries {label!r}"
        r = row_of(audit_row)
        assert r.get("door") is not False, "a door was built: the row is measured, not declared doorless"
        assert r["steps"] == [{"click": "button|Learn"}, {"click": "menuitem|What your Notebook can do"}]
        assert r["target"] == {"text": label}
        assert "reason" not in r and not r.get("unmeasurable_here"), "the old NO DOOR reason must be gone"
        assert set(r["viewports"]) == {"1280", "390"}
        assert r["target_wait_ms"] >= 10000, "the Sheet loads the catalogue's chunk on first open"
    assert row_of(29)["flag"] == "COMPASS_NOTES_TOOL_ENABLED"
    assert row_of(53)["flag"] == "NOTEBOOK_TERMINAL_LINKS_ENABLED"
    assert A.validate_table(table()) == []


def test_a_text_target_is_a_valid_target_and_an_empty_one_is_not():
    base = {"feature": "x", "audit_row": 1, "path": "/", "steps": [], "viewports": ["1280"]}
    only_missing_rows = "audit rows with no entry: " + str(sorted(set(A.REQUIRED_AUDIT_ROWS)))
    assert A.validate_table([{**base, "target": {"text": "Compass can read your notes"}}]) == [only_missing_rows]
    assert any("a target needs" in w for w in A.validate_table([{**base, "target": {"text": " "}}]))
    assert any("a target needs" in w for w in A.validate_table([{**base, "target": {"text": 5}}]))


def test_row_42_is_graded_by_measurement_and_needs_the_seed_not_a_written_excuse():
    r = row_of(42)
    assert r["needs_seed"] == "find_similar"
    assert "unmeasurable_here" not in r and "reason" not in r, "the NOT_MEASURED reason is dropped"
    assert r["target"]["name"] == "~^Find more like"
    assert r["target_wait_ms"] >= 20000, "the board fills after its own fetches; a 5 s wait would read it absent"
    assert set(r["viewports"]) == {"1280", "390"}


def test_a_row_that_needs_the_seed_is_not_measured_when_the_seed_did_not_land():
    row = {"feature": "x", "audit_row": 42, "needs_seed": "find_similar"}
    assert A.seed_gap({"feature": "x", "audit_row": 11}, None) is None, "a row that needs no seed ignores it"
    assert A.seed_gap(row, {"ok": True, "matches": 1}) is None
    for seed in (None, {}, {"ok": False, "why": "the sandbox data dir was not given"}):
        gap = A.seed_gap(row, seed)
        assert gap and "find-similar" in gap, seed
    assert "the sandbox data dir" in A.seed_gap(row, {"ok": False, "why": "the sandbox data dir was not given"})
    # ok but no match stored: the seed did not do its job, so the door is not measured on it
    assert A.seed_gap(row, {"ok": True, "matches": 0})


def test_the_seeded_note_is_a_plan_the_board_lists_and_a_template_the_nightly_job_takes():
    """Built from the product's own readers: the setups board's plan reading, the chart-block index
    and the similar-matches ranking. A note these would refuse would seed nothing."""
    from api.services.journal_two import chart_blocks, plan_extract, similar_matches as sm, tech_fingerprint as tfp
    note = A.find_similar_note("2026-10-09")
    assert note["ticker"] == "AMD" and note["title"]
    blocks = chart_blocks.extract_blocks(note["bodyJson"])
    assert len(blocks) == 1 and blocks[0]["symbol"] == "AMD" and blocks[0]["setup_tag"]
    assert tfp.well_formed(blocks[0]["note_fingerprint"]), "the note's own fingerprint must pass the index's check"
    reading = plan_extract.read_note_plan(note["bodyJson"], None, [], "AMD")
    entry = reading.role("entry")
    assert entry.state == plan_extract.STATE_OK and entry.shape in ("chart", "canvas")
    e, st, tg = reading.value("entry"), reading.value("stop"), reading.value("target")
    assert tg > e > st > 0
    # the template carries enough fields to be ranked at all, and a name with the same values wins
    values = tfp.summary_values(blocks[0]["note_fingerprint"])
    assert sum(1 for f in sm.RULES if values.get(f) is not None) >= sm.MIN_TEMPLATE_FIELDS
    universe = {"as_of": "2026-10-09", "truncated": False,
                "rows": [{"symbol": "CRWD", "as_of": "2026-10-09", "is_etf": False, "values": values}]}
    ranked = sm.rank_matches(values, "AMD", universe)
    assert ranked and ranked[0]["symbol"] == "CRWD" and ranked[0]["score"] == 100


def test_the_seed_spec_names_the_template_the_candidate_and_the_switch():
    spec = A.seed_spec("da1280@local.dev", "2026-10-09", ["NOTEBOOK_FIND_SIMILAR_ENABLED", "NOTEBOOK_SETUPS_BOARD_ENABLED"])
    assert spec["email"] == "da1280@local.dev" and spec["today"] == "2026-10-09"
    assert spec["template_symbol"] == A.find_similar_note("2026-10-09")["ticker"]
    assert spec["candidate"] and spec["candidate"] != spec["template_symbol"]
    assert "NOTEBOOK_FIND_SIMILAR_ENABLED" in spec["flags"]
    assert spec["project_note_ids"] == [] and spec["quotes"] == [], "no awareness scan: only the matches are seeded"


def test_the_seed_is_the_fin_walks_own_post_child_not_a_copy_of_it():
    """Row 42 reuses tools/notebook_fin_walk.py's run_post_child (brief section 3); the spec this
    tool builds must be one that child's code reads: every key it indexes."""
    import re
    child = (REPO / "tools" / "notebook_fin_walk.py").read_text(encoding="utf-8").split("POST_CHILD = r'''", 1)[1].split("'''", 1)[0]
    needed = set(re.findall(r'spec\["([a-z_]+)"\]', child))
    spec = A.seed_spec("a@local.dev", "2026-10-09", ["NOTEBOOK_FIND_SIMILAR_ENABLED"])
    assert needed and needed <= set(spec), f"the child reads {sorted(needed - set(spec))} which the spec lacks"
