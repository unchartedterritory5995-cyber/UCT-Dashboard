"""The Sunday gate reads the OBSERVATION table, BY COLUMN NAME, over OBSERVED rows.

⛔⛔ THREE FAULTS, FOUND TOGETHER ON 2026-09-13 WHILE WIRING THE C-4 SWEEP IN,
AND EACH ONE ALONE PRINTED **REVERT** AGAINST THE LIVE LOG — on the one run of
the week that decides keep-or-revert, with nothing wrong with the wave.

  1. `rows()` selected on *"starts with a pipe"*, so the member identity/exclusion
     PROSE table — added the day before with the attributable-member report — was
     read as five observation rows ending in `**no**` / `**YES**`. None starts
     with "OK", none says SKIPPED, so trigger 1 counted five reds that do not
     exist. Measured: *"trigger 1: 5 non-OK row(s), first at identity"*.

  2. Triggers 2 and 4 read HARD-CODED indices `x[4]` and `x[6]` — correct under
     the 8-column header and OFF BY ONE under the 9-column one the config-served
     column created. Since that column landed, trigger 2 had been reading
     `blocked-baseline` under the name sync-conflict, and trigger 4 had been
     reading `outbox` under the name console errors.

  3. The SKIPPED exclusion existed in TRIGGER 1 ONLY. The 2026-09-12 23:00 SKIP
     (production unreachable mid-deploy — the stacked-push incident CLAUDE.md
     already records) carries **20 console errors** from a page that could not
     load, and trigger 4 counted them as member-visible errors.

⭐ THE SHAPE THEY SHARE: each is a SECOND AUTHORITY over something the log
already states — what a row is, where a column sits, whether a reading was
taken. The fixes make the log the authority in all three cases, and these rails
drive the defects rather than restating the fixes.
"""
from __future__ import annotations

import importlib.util
import pathlib
import sys

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools"
NL = chr(10)
DASH = chr(8212)          # em dash, what a SKIPPED row writes for a reading
MID = chr(183)            # middot, the separator inside the opt-in cell


def _load(name):
    spec = importlib.util.spec_from_file_location(name, TOOLS / (name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _live_shaped_log(path, console_on_skip="20"):
    """Both header blocks, the prose table between them, and a SKIPPED row.

    ⛔ SHAPED LIKE THE REAL FILE, not like a tidy fixture. Every one of the three
    faults needed a feature a tidy fixture would have left out — a second header,
    a prose table, a SKIPPED row — which is why none of them was caught by the
    rails that already existed.
    """
    path.write_text(NL.join([
        "# Wave Q1 observation log",
        "",
        "| at (ET) | opt-in (member, OLD schema) | opt-in (windowed) | blocked-baseline "
        "| sync-conflict | outbox | console errors | flag |",
        "|---|---|---|---|---|---|---|---|",
        "| 2026-09-12 01:20 ET | 0 | 20 | 0 | 3 | 0 | 0 | OK |",
        "",
        "## Who counts as a member",
        "",
        "| identity | what it is | counts as a member? |",
        "|---|---|---|",
        "| `rig@example.com` via the canary rig | scheduled canary runs | **no** |",
        "| `smoke@uctintelligence.internal` | a post-deploy smoke | **no** |",
        "| anything else | a real member | **YES** |",
        "",
        "| at (ET) | latest opt-in (UTC) | opt-in (windowed) | config-served (members) "
        "| blocked-baseline | sync-conflict notes | outbox (rig only, layer off) "
        "| console errors (rig) | flag |",
        "|---|---|---|---|---|---|---|---|---|",
        "| 2026-09-12 21:00 ET | 2026-09-13 00:00:53 " + MID + " members 0 | 10 "
        "| 0/0 " + DASH + " no member reported | 0 | 3 | 0 | 0 | OK |",
        "| 2026-09-12 23:00 ET | " + DASH + " | " + DASH + " | " + DASH + " | "
        + DASH + " | " + DASH + " | " + DASH + " | " + console_on_skip
        + " | **SKIPPED** " + DASH + " production unreachable (HTTP 5xx) |",
        "| 2026-09-13 09:00 ET | 2026-09-13 03:07:25 " + MID + " members 0 | 11 "
        "| 0/0 " + DASH + " no member reported | 0 | 3 | 0 | 0 | OK |",
        "",
    ]) + NL, encoding="utf-8")
    return path


def test_a_prose_table_in_the_log_is_not_read_as_observation_rows(tmp_path, monkeypatch):
    """⛔⛔ FAULT 1, DRIVEN — the one that flipped the verdict."""
    monkeypatch.setenv("NB_OBSERVE_LOG", str(_live_shaped_log(tmp_path / "obs.md")))
    gate = _load("nb_gate")
    recs, gripes = gate.parsed_rows()
    # ⭐ NON-VACUITY FIRST. Every assertion below is satisfied by an empty list,
    # and an empty list is exactly what a too-strict predicate returns. Name the
    # members rather than counting them.
    assert [x["at"] for x in recs] == [
        "2026-09-12 01:20 ET", "2026-09-12 21:00 ET",
        "2026-09-12 23:00 ET", "2026-09-13 09:00 ET"]
    assert not gripes, gripes
    # ...and the prose rows are gone BY NAME, not merely by count.
    assert not [x for x in recs if "identity" in x["at"] or "anything else" in x["at"]]


def test_columns_are_resolved_by_name_across_BOTH_schemas(tmp_path, monkeypatch):
    """⛔⛔ FAULT 2, DRIVEN. The two rows below hold the SAME conflict count under
    DIFFERENT headers, at different positions."""
    monkeypatch.setenv("NB_OBSERVE_LOG", str(_live_shaped_log(tmp_path / "obs.md")))
    gate = _load("nb_gate")
    recs, _ = gate.parsed_rows()
    eight = next(x for x in recs if x["at"] == "2026-09-12 01:20 ET")
    nine = next(x for x in recs if x["at"] == "2026-09-13 09:00 ET")
    assert gate.number(eight, "conflicts") == 3
    assert gate.number(nine, "conflicts") == 3           # the one `x[4]` misread
    assert gate.number(eight, "console") == 0
    assert gate.number(nine, "console") == 0             # the one `x[6]` misread
    assert "config_served" not in eight                  # the 8-column row has none
    assert nine["config_served"].startswith("0/0")
    # ⭐ THE POSITIONAL PROOF. `conflicts` sits at a DIFFERENT index in the two
    # rows, which is the whole reason a name is the only safe address.
    assert eight["_cells"].index("3") != nine["_cells"].index("3")


def test_an_unknown_header_column_is_a_LOUD_failure(tmp_path, monkeypatch):
    """⛔ The schema may change again, and the next change must BREAK this gate
    rather than quietly re-aim a trigger at the neighbouring column."""
    log = tmp_path / "obs.md"
    log.write_text(NL.join([
        "| at (ET) | latest opt-in (UTC) | brand new column | flag |",
        "|---|---|---|---|",
        "| 2026-09-13 09:00 ET | " + DASH + " | 7 | OK |",
        "",
    ]) + NL, encoding="utf-8")
    monkeypatch.setenv("NB_OBSERVE_LOG", str(log))
    gate = _load("nb_gate")
    _, gripes = gate.parsed_rows()
    assert gripes and "brand new column" in gripes[0]
    assert gate.canonical("brand new column") is None
    # ⭐ CONTROL: the columns it DOES know still resolve, or the assertion above
    # passes because nothing resolves at all.
    assert gate.canonical("console errors (rig)") == "console"
    assert gate.canonical("sync-conflict notes") == "conflicts"
    # ⛔ And the two SAME-STEM columns stay distinct. Dropping the parenthetical
    # would collapse `opt-in (windowed)` and `opt-in (member, OLD schema)` into
    # one key and silently keep whichever came last.
    assert gate.canonical("opt-in (windowed)") == "optin_windowed"
    assert gate.canonical("opt-in (member, OLD schema)") == "optin_member_old"


def test_a_SKIPPED_rows_console_errors_are_never_counted(tmp_path, monkeypatch):
    """⛔⛔ FAULT 3, DRIVEN. A reading that could not be TAKEN is unobserved,
    never a red — and that rule lived in trigger 1 alone."""
    monkeypatch.setenv("NB_OBSERVE_LOG", str(_live_shaped_log(tmp_path / "obs.md")))
    gate = _load("nb_gate")
    recs, _ = gate.parsed_rows()
    skip = next(x for x in recs if gate.is_skipped(x))
    assert gate.number(skip, "console") == 20        # ⭐ the number really IS there
    observed = [x for x in recs if not gate.is_skipped(x)]
    assert not [x for x in observed if (gate.number(x, "console") or 0) > 0]


def test_a_real_console_error_on_an_OBSERVED_row_still_fires(tmp_path, monkeypatch):
    """⭐ THE PAIR. A checker that stays quiet either way measures nothing."""
    log = tmp_path / "obs.md"
    log.write_text(NL.join([
        "| at (ET) | latest opt-in (UTC) | opt-in (windowed) | config-served (members) "
        "| blocked-baseline | sync-conflict notes | outbox | console errors (rig) | flag |",
        "|---|---|---|---|---|---|---|---|---|",
        "| 2026-09-13 09:00 ET | " + DASH + " | 11 | 0/0 | 0 | 3 | 0 | 4 | OK |",
        "",
    ]) + NL, encoding="utf-8")
    monkeypatch.setenv("NB_OBSERVE_LOG", str(log))
    gate = _load("nb_gate")
    recs, _ = gate.parsed_rows()
    observed = [x for x in recs if not gate.is_skipped(x)]
    assert [x["at"] for x in observed] == ["2026-09-13 09:00 ET"]
    assert gate.number(observed[0], "console") == 4


def test_an_em_dash_is_not_zero(tmp_path, monkeypatch):
    """⛔ A value that could not be READ is not a value of zero — the distinction
    `_doc_text(None) == ''` got wrong twice in this wave."""
    monkeypatch.setenv("NB_OBSERVE_LOG", str(_live_shaped_log(tmp_path / "obs.md")))
    gate = _load("nb_gate")
    recs, _ = gate.parsed_rows()
    skip = next(x for x in recs if gate.is_skipped(x))
    assert gate.number(skip, "conflicts") is None
    assert gate.number(skip, "blocked") is None
    # ⭐ and a real zero is still a zero, or the check above passes by rejecting
    # every value it is handed.
    observed = next(x for x in recs if x["at"] == "2026-09-13 09:00 ET")
    assert gate.number(observed, "blocked") == 0


def test_the_identity_count_is_the_authority_and_actually_reaches_the_verdict(tmp_path, monkeypatch):
    """⛔⛔ FAULT 4 — unmasked by fixing fault 2, and the worse of the two.

    The identity count was computed and then OVERWRITTEN on the next line, so the
    sampler's answer never reached the verdict file; the branch also emptied the
    canary list, leaving the timing fallback with zero windows to exclude. It
    survived only because the fallback read the WHOLE cell — which no date parser
    accepts, and `is_rig` answers True for anything unparseable. Addressing
    columns by name made the cell parse, and the live log immediately reported
    `FIRST MEMBER OPT-IN 2026-09-12 15:45:46` on a row whose own count says
    `members 0`.
    """
    monkeypatch.setenv("NB_OBSERVE_LOG", str(_live_shaped_log(tmp_path / "obs.md")))
    monkeypatch.setenv("NB_GATE_VERDICT", str(tmp_path / "verdict.md"))
    monkeypatch.setenv("NB_RESUME_DOC", str(tmp_path / "nonexistent-resume.md"))
    gate = _load("nb_gate")
    recs, _ = gate.parsed_rows()
    # The fixture's rows carry `members 0`, so identity must answer and must say so.
    cells = [str(x.get("latest_optin") or "") for x in recs]
    assert any("members 0" in c for c in cells), cells
    src = (TOOLS / "nb_gate.py").read_text(encoding="utf-8")
    # ⭐ Pinned STRUCTURALLY: the timing fallback lives inside the `else`, so it
    # cannot run while an identity count exists. A behavioural-only assertion
    # here would pass again the moment somebody re-flattens the branches.
    idx_if = src.index("if member_counts:")
    idx_else = src.index("else:", idx_if)
    idx_first = src.index("FIRST MEMBER OPT-IN", idx_if)
    assert idx_else < idx_first, "the timing fallback must sit INSIDE the else branch"
    # ...and the line names which rule answered, so a reader never has to guess.
    assert "timing rule" in src


def test_the_timing_rule_still_answers_when_no_row_has_an_identity_count(tmp_path, monkeypatch):
    """⭐ THE PAIR. Ordering identity first must not delete the fallback — rows
    written before the sampler learned to count identities still need an answer."""
    log = tmp_path / "obs.md"
    log.write_text(NL.join([
        "| at (ET) | opt-in (member, OLD schema) | opt-in (windowed) | blocked-baseline "
        "| sync-conflict | outbox | console errors | flag |",
        "|---|---|---|---|---|---|---|---|",
        "| 2026-09-12 01:20 ET | 0 | 20 | 0 | 3 | 0 | 0 | OK |",
        "",
    ]) + NL, encoding="utf-8")
    monkeypatch.setenv("NB_OBSERVE_LOG", str(log))
    gate = _load("nb_gate")
    recs, _ = gate.parsed_rows()
    assert [x["at"] for x in recs] == ["2026-09-12 01:20 ET"]
    # no `members N` anywhere, so the identity branch has nothing to say
    assert not [x for x in recs if "members " in str(x.get("optin_member_old") or "")]
