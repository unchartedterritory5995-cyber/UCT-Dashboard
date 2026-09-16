"""Trigger 1 carries the SAME ownership filter trigger 4 got - and nothing more.

Owner ruling 2026-09-14, approved:

    "Trigger 1 saying REVERT on a foreign row: apply the same ownership filter
     you applied to trigger 4 - a foreign-origin console row is recorded, not a
     trigger. Rail it, sync the deployed copy, re-run the gate script, post the
     corrected line."

⛔⛔ WHAT TRIGGER 1 ACTUALLY TESTS, because getting this wrong applies the ruling
to the wrong condition. It is NOT a console-error test. It reads the sampler's
FLAG CELL over every OBSERVED (non-SKIPPED) row and fires on anything that is not
`OK`. `nb_observe.py` builds that cell from THREE reason families joined with
`" · "`:

  · `<N> console/page error(s): ...`            - the only family the ruling touches
  · `UNKNOWN INTERNAL identity opted in (...)`  - an undeclared `.internal` account
  · `blocked-baseline events = <N>`             - the wave's own headline metric

So "the console errors on this row are foreign" is an answer about ONE of three
families. A filter that let that answer clear the whole row would clear a
blocked-baseline event - the single number this observation window exists to
watch - because a foreign 401 happened to land on the same row.

⭐ THE RAILS BELOW THEREFORE DRIVE FOUR ANSWERS, NOT TWO: foreign (cleared),
Notebook-owned (fails), un-attributable (fails), and "red for a reason ownership
does not answer" (fails). The last one is the case a two-way predicate gets wrong,
and it is the one that would silently delete evidence.

⭐ AND THE PARTITION IS ASSERTED THROUGH `main()`, NOT THROUGH A HARNESS THAT
RESTATES IT. A test helper that re-derives `verdict not in ('ok', 'foreign')` can
agree with itself while the gate does something else - that is R-05's defect
exactly. What a person reads is the verdict file, so that is what these assert on.
"""
from __future__ import annotations

import importlib.util
import inspect
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
TOOLS = HERE.parent / "tools"
NL = chr(10)
DASH = chr(8212)          # em dash - what the sampler writes after `**ANOMALY**`
MID = chr(183)            # middot - BOTH separators the sampler uses
PIPE = chr(124)


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


# ⭐ ONE FIXTURE AUTHORITY. The flag shapes live in the trigger-4 rail already and
# were copied off the live log there; re-typing them here is how two fixtures for
# one sampler drift apart.
T4 = _load("_nb_gate_t4_fixtures", HERE / "test_nb_gate_trigger4_ownership.py")
FOREIGN_URL = T4._FOREIGN_URL
OWNED_URL = T4._OWNED_URL
LEGACY_FLAG = T4.LEGACY_FLAG          # a count and nothing else - pre-2026-09-14
FOREIGN_FLAG_PIPE = T4.FOREIGN_FLAG   # the 01:00 ET shape: bits joined with a PIPE
OWNED_FLAG = T4.OWNED_FLAG

# ⛔ THE LIVE SHAPE SINCE 2026-09-14 03:00 ET joins the console reason's bits with
# a DOUBLE-SPACED middot, because the sampler stopped emitting the table delimiter.
# The rows the ruling was written for wear THIS shape, so it is railed beside the
# pipe one rather than instead of it.
FOREIGN_FLAG_MIDDOT = (
    "**ANOMALY** " + DASH + " 2 console/page error(s): console.error: Failed to "
    "load resource: the server responded with a status of 401 ()"
    "  [issued by " + FOREIGN_URL + ":0]  " + MID + "  HTTP: GET "
    + FOREIGN_URL + " -> 401 ; GET https://uctintelligence.com/api/intradaypack"
    "/manifest -> FAILED (net::ERR_ABORTED)")

# The two reason families ownership says NOTHING about, each riding beside a
# console reason whose every origin IS foreign. Joined with the sampler's
# SINGLE-spaced reason separator, which is the only thing distinguishing them
# from the double-spaced joiner inside the console reason above.
BLOCKED_BESIDE_FOREIGN = (
    FOREIGN_FLAG_MIDDOT + " " + MID + " blocked-baseline events = 2")
UNKNOWN_INTERNAL_BESIDE_FOREIGN = (
    FOREIGN_FLAG_MIDDOT + " " + MID + " UNKNOWN INTERNAL identity opted in (1): "
    "someone@uctintelligence.internal " + DASH + " an unroutable .internal address "
    "nobody declared. Add it to SYNTHETIC_MEMBERS or explain it; it is NOT organic "
    "exposure")


def _row(at, console, flag, blocked=0):
    """One observation row in the sampler's own nine-column shape."""
    return ("| " + at + " | " + T4._OPTIN + " | 20 | 0/0 " + DASH
            + " no member reported | " + str(blocked) + " | 3 | 0 | "
            + str(console) + " | " + flag + " |")


def _gate(tmp_path, monkeypatch, rows):
    """A gate bound to a log carrying `rows` plus one ALWAYS-CLEAN row.

    ⭐ The clean row is the non-vacuity anchor: a row that must appear in NO
    bucket cannot be satisfied by a parser that returned nothing.
    """
    (tmp_path / "obs.md").write_text(NL.join([
        "# Wave Q1 " + DASH + " observation log",
        "",
        T4._HEADER,
        T4._RULE,
        _row("2026-09-14 01:00 ET", 0, "OK"),
    ] + list(rows) + [""]) + NL, encoding="utf-8")
    monkeypatch.setenv("NB_OBSERVE_LOG", str(tmp_path / "obs.md"))
    monkeypatch.setenv("NB_GATE_VERDICT", str(tmp_path / "verdict.md"))
    monkeypatch.setenv("NB_RESUME_DOC", str(tmp_path / "no-such-resume.md"))
    # ⛔ No sweep tool here on purpose: C-4 is a 60-85s subprocess that says
    # nothing about trigger 1, and it reports DID NOT RUN, its own honest answer.
    monkeypatch.setenv("NB_GATE_REPO", str(tmp_path))
    return _load("nb_gate", TOOLS / "nb_gate.py")


def _verdict(tmp_path, monkeypatch, rows):
    gate = _gate(tmp_path, monkeypatch, rows)
    gate.main()
    return gate, (tmp_path / "verdict.md").read_text(encoding="utf-8")


T1_ROW = "| 1 " + MID + " unexplained red | "


# ===========================================================================
# THE THREE ANSWERS THE RULING NAMES, EACH THROUGH main().
# ===========================================================================

def test_a_purely_foreign_row_does_NOT_fail_trigger_1(tmp_path, monkeypatch):
    """⭐ THE LIVE CASE. Every console error on the row came from
    `/api/barspack/manifest` - the app shell's chart prefetch, traced to another
    workstream's deploy. It is recorded; it does not say REVERT.
    """
    _, out = _verdict(tmp_path, monkeypatch,
                      [_row("2026-09-14 03:00 ET", 2, FOREIGN_FLAG_MIDDOT)])
    assert T1_ROW + "PASS - 1 FOREIGN row(s) recorded below, not blocking |" in out, out
    assert "trigger 1:" not in out
    # ...and it is still IN THE RECORD, by URL. Clearing a row from a trigger and
    # clearing it from the record are two different acts.
    assert "## Foreign console errors - RECORDED, not blocking" in out
    assert FOREIGN_URL in out
    # NON-VACUITY: the gate really read this log - two rows, not zero.
    assert "rows read: 2 (0 skipped)" in out


def test_a_Notebook_owned_row_still_FAILS_trigger_1(tmp_path, monkeypatch):
    """⛔ The ruling NARROWS trigger 1; it does not switch it off. A 401 on
    `/api/j2/notes/...` is the Notebook's own write being refused."""
    _, out = _verdict(tmp_path, monkeypatch,
                      [_row("2026-09-14 03:00 ET", 2, OWNED_FLAG)])
    assert T1_ROW + "FAIL |" in out, out
    assert "trigger 1: 1 non-OK row(s), first at 2026-09-14 03:00 ET" in out
    assert OWNED_URL in out
    assert "## Foreign console errors" not in out
    assert "rows read: 2 (0 skipped)" in out


def test_an_un_attributable_row_still_FAILS_trigger_1(tmp_path, monkeypatch):
    """⛔⛔ UNKNOWN IS NOT CLEAR - the direction a two-way predicate gets wrong.

    Three rows written 2026-09-13 name a COUNT and no URL at all; the sampler
    learned to record the origin the next day. Reading "no Notebook URL here" as
    "not ours" clears all three without anyone looking at them.
    """
    _, out = _verdict(tmp_path, monkeypatch,
                      [_row("2026-09-14 03:00 ET", 2, LEGACY_FLAG)])
    assert T1_ROW + "FAIL |" in out, out
    assert "trigger 1: 1 non-OK row(s), first at 2026-09-14 03:00 ET" in out
    assert "unknown is not clear" in out
    assert "## Foreign console errors" not in out


def test_all_three_answers_in_ONE_log_partition_by_name(tmp_path, monkeypatch):
    """⭐⭐ THE DISCRIMINATOR plus the NON-VACUITY CONTROL.

    A predicate pinned to either answer passes one of the three tests above; it
    cannot pass this one. And the clean row must appear in NEITHER the failing
    count nor the foreign ledger - an exclusion nothing empty can satisfy.
    """
    gate, out = _verdict(tmp_path, monkeypatch, [
        _row("2026-09-14 03:00 ET", 2, FOREIGN_FLAG_MIDDOT),
        _row("2026-09-14 05:00 ET", 2, OWNED_FLAG),
        _row("2026-09-14 07:00 ET", 2, LEGACY_FLAG),
    ])
    # NON-VACUITY, BY NAME: all four rows parsed, none dropped as unreadable.
    recs, gripes = gate.parsed_rows()
    assert not gripes, gripes
    assert [x["at"] for x in recs] == [
        "2026-09-14 01:00 ET", "2026-09-14 03:00 ET",
        "2026-09-14 05:00 ET", "2026-09-14 07:00 ET"]
    assert "rows read: 4 (0 skipped)" in out

    assert T1_ROW + "FAIL - 1 FOREIGN row(s) recorded below, not blocking |" in out, out
    # TWO fail, and the FIRST one named is the owned row - not the foreign row
    # that precedes it in the log.
    assert "trigger 1: 2 non-OK row(s), first at 2026-09-14 05:00 ET" in out
    # The foreign ledger names the foreign row and ONLY it.
    foreign_block = out.split("## Foreign console errors")[1].split("##")[0]
    assert "2026-09-14 03:00 ET" in foreign_block
    for excluded in ("2026-09-14 01:00 ET", "2026-09-14 05:00 ET",
                     "2026-09-14 07:00 ET"):
        assert excluded not in foreign_block, excluded


# ===========================================================================
# THE HALF THE RULING DOES NOT TOUCH. Ownership answers ONE reason family.
# ===========================================================================

def test_a_blocked_baseline_event_still_FAILS_beside_foreign_console_errors(tmp_path, monkeypatch):
    """⛔⛔ THE TRAP. `blocked-baseline events` is the number this whole window
    exists to watch. It rides the SAME flag cell as the console reason, so a
    filter that clears the row on an ownership answer deletes it."""
    _, out = _verdict(tmp_path, monkeypatch,
                      [_row("2026-09-14 03:00 ET", 2, BLOCKED_BESIDE_FOREIGN,
                            blocked=2)])
    assert T1_ROW + "FAIL |" in out, out
    assert "trigger 1: 1 non-OK row(s), first at 2026-09-14 03:00 ET" in out
    assert "reason ownership does not answer: blocked-baseline events = 2" in out
    # ⭐ AND THE TWO TRIGGERS DISAGREE ABOUT THIS ROW ON PURPOSE, which is the
    # point of keeping them separate. Trigger 4 asks only about the CONSOLE
    # errors and its answer is unchanged - they really are foreign, and they are
    # recorded as such. Trigger 1 asks about the whole flag and still says REVERT,
    # because the blocked-baseline event is a different fact that ownership does
    # not speak to. Collapsing them would lose one of the two.
    assert "| 4 " + MID + " member console error | PASS - 1 FOREIGN row(s) " \
           "recorded below, not blocking |" in out, out
    assert T1_ROW + "PASS" not in out


def test_an_UNKNOWN_INTERNAL_optin_still_FAILS_beside_foreign_console_errors(tmp_path, monkeypatch):
    """⛔ The second family. An undeclared `.internal` address is a synthetic
    account somebody provisioned without saying so - it has no request origin and
    ownership cannot speak to it."""
    _, out = _verdict(tmp_path, monkeypatch,
                      [_row("2026-09-14 03:00 ET", 2,
                            UNKNOWN_INTERNAL_BESIDE_FOREIGN)])
    assert T1_ROW + "FAIL |" in out, out
    assert "reason ownership does not answer: UNKNOWN INTERNAL identity opted in" in out
    # Same disagreement as above, and the same reason for it.
    assert "| 4 " + MID + " member console error | PASS - 1 FOREIGN row(s) " \
           "recorded below, not blocking |" in out, out
    assert T1_ROW + "PASS" not in out


# ===========================================================================
# UNIT: the separator, the shapes, and the ONE ownership authority.
# ===========================================================================

def test_the_two_middot_separators_are_told_apart(tmp_path, monkeypatch):
    """⛔ THEY DIFFER BY ONE SPACE. `nb_observe.py` joins REASONS with `" · "` and
    the bits INSIDE one console reason with `"  ·  "`.

    Both directions are load-bearing and they fail differently:
      · splitting the DOUBLE one leaves `HTTP: ...` looking like a second reason,
        so the live rows would never be cleared and the ruling would do nothing;
      · not splitting the SINGLE one folds `blocked-baseline events = 2` into the
        console reason, so a blocked event would be cleared as foreign.
    """
    gate = _gate(tmp_path, monkeypatch, [])
    assert gate.flag_attribution(FOREIGN_FLAG_MIDDOT)["verdict"] == "foreign"
    assert gate.flag_attribution(FOREIGN_FLAG_PIPE)["verdict"] == "foreign"
    assert gate.flag_attribution(BLOCKED_BESIDE_FOREIGN)["verdict"] == "other"
    # CONTROL: the separator regex really is what separates them - it splits the
    # single-spaced one and leaves the double-spaced one whole.
    assert len(gate._REASON_SEP.split("a " + MID + " b")) == 2
    assert len(gate._REASON_SEP.split("a  " + MID + "  b")) == 1


def test_a_clean_flag_and_an_unreadable_flag_are_different_answers(tmp_path, monkeypatch):
    """⛔ Failure-safe on the shape too: a flag this gate cannot parse is never
    cleared, and `OK` is never confused with an explanation."""
    gate = _gate(tmp_path, monkeypatch, [])
    assert gate.flag_attribution("OK")["verdict"] == "ok"
    for unreadable in ("", None, "ANOMALY - 2 console/page error(s): x",
                       "something the sampler has never written"):
        assert gate.flag_attribution(unreadable)["verdict"] == "other", unreadable
    # An ANOMALY with a reason list that is empty is not a cleared row either.
    assert gate.flag_attribution("**ANOMALY** " + DASH + " ")["verdict"] == "other"


def test_ownership_has_ONE_authority_and_trigger_1_delegates_to_it(tmp_path, monkeypatch):
    """⛔ This programme has paid for duplicated guards repeatedly. The ownership
    rule is `request_ownership` / `console_attribution`; trigger 1's filter must
    CALL it, never restate it."""
    gate = _gate(tmp_path, monkeypatch, [])
    src = inspect.getsource(gate.flag_attribution)
    assert "console_attribution(" in src
    # No second copy of the prefix rule, and no URL or path literal of its own.
    assert "NOTEBOOK_REQUEST_PREFIXES" not in src
    assert "/api/" not in src
    assert "barspack" not in src
    # ...and for a pure console flag the answer IS `console_attribution`'s answer,
    # verbatim - not a re-derivation that happens to agree today.
    for flag in (FOREIGN_FLAG_MIDDOT, FOREIGN_FLAG_PIPE, OWNED_FLAG, LEGACY_FLAG):
        assert gate.flag_attribution(flag) == gate.console_attribution(flag), flag


def test_a_foreign_row_trigger_4_cannot_see_is_still_RECORDED(tmp_path, monkeypatch):
    """⭐ THE TWO TRIGGERS DO NOT CLEAR THE SAME SET, so the ledger is the union.

    A row whose only evidence is a failed HTTP request writes `0` in the console
    column (`len(errors)` is zero) and never reaches trigger 4 at all. If the
    foreign section were still driven by trigger 4 alone, this row would be
    cleared from trigger 1 and vanish from the record in the same move.
    """
    http_only = ("**ANOMALY** " + DASH + " 0 console/page error(s): HTTP: GET "
                 + FOREIGN_URL + " -> 401")
    gate, out = _verdict(tmp_path, monkeypatch,
                         [_row("2026-09-14 03:00 ET", 0, http_only)])
    # NON-VACUITY: trigger 4's own population really is empty for this row, so the
    # assertion below is about the union and not about trigger 4 quietly covering it.
    recs, _ = gate.parsed_rows()
    row = next(x for x in recs if x["at"] == "2026-09-14 03:00 ET")
    assert gate.number(row, "console") == 0
    assert T1_ROW + "PASS - 1 FOREIGN row(s) recorded below, not blocking |" in out, out
    assert "| 4 " + MID + " member console error | PASS |" in out, out
    assert "## Foreign console errors - RECORDED, not blocking" in out
    assert "2026-09-14 03:00 ET - " + FOREIGN_URL in out
