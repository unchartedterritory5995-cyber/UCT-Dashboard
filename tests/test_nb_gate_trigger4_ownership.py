"""Trigger 4 filters by OWNERSHIP of the failing request, not by severity.

Owner ruling 2026-09-14, approved as proposed:

    "Trigger-4 filter - filter by OWNERSHIP of the failing request's origin, not
     severity. A 401 from a request the Notebook doesn't issue is FOREIGN and
     recorded, not an ANOMALY; a 401 from anything the Notebook issues stays a
     trigger. Rail both directions."

⛔⛔ THE TRAP THIS FILE EXISTS TO HOLD SHUT IS THE *CLEARING* DIRECTION. A filter
that decides a row is "not ours" is a filter that can delete evidence, and the
cheapest way to write it wrong is to answer a two-way question - ours / not ours -
when the honest answer set has THREE members. Every row the sampler wrote before
2026-09-14 records a COUNT and no URL at all; scoring those as foreign would
silently clear three ANOMALY rows nobody has looked at. So the rails below drive
all three answers, and the un-attributable one is driven FIRST.

⭐ AND THE FOREIGN ROWS ARE STILL PRINTED. `test_a_foreign_row_is_REPORTED...`
asserts the URL reaches the verdict file, because a hole that is invisible is
worse than one that is attributed - clearing a row from a trigger and clearing it
from the record are two different acts and only the first was ruled on.

⚰️ ONE MORE DEFECT, FOUND BY MEASURING RATHER THAN REASONING: the only row that
has ever carried a URL was UNREADABLE. `nb_observe.py` joins an ANOMALY reason's
parts with `"  |  "`, so the flag cell contains a PIPE and the live 2026-09-14
01:00 ET row parsed as TEN cells under a NINE-column header - dropped with
`row ... has 10 cell(s) under a 9-column header`. The ownership rule would have
had nothing to read on the one row it was written for, and trigger 4 would have
looked unchanged while the evidence fell out of the parser. Railed here too.

⛔⛔ EVERY ANSWER BELOW IS READ OFF THE RENDERED `verdict.md`, NEVER OFF A HARNESS
THAT RESTATES THE PARTITION. That is the rule the sibling file
`tests/test_nb_gate_trigger1_ownership.py:30-33` states and was written to, and
this file used to break it: a `_buckets()` helper re-derived the blocking/foreign
split with its OWN copy of the `== 'foreign'` predicate, under a comment reading
"exactly as main() partitions them". A copy that says "exactly as" is a second
authority over one value, and it agreed with itself. MEASURED 2026-09-15: changing
`tools/nb_gate.py:714` from `attr['verdict'] == 'foreign'` to
`attr['verdict'] in ('foreign','unknown')` - the one edit that clears the
un-attributable rows this file's first section exists to protect - left the WHOLE
FILE GREEN, 10 passed, runner exit 0. Only the foreign and the Notebook directions
were ever driven through `main()`; the direction that would clear real rows was
asserted solely through the restating harness.

⭐ THE REPAIR COST TWO TEST FUNCTIONS, AND THAT IS THE POINT. Once the answer comes
from `main()`, "a foreign row is not blocking" and "a foreign row reaches the
verdict as FOREIGN" are one assertion over one render, so the duplicated pairs were
merged rather than kept side by side - three copies of a guard cannot be
mutation-proved, and two agreeing copies are exactly what this file just paid for.
"""
from __future__ import annotations

import importlib.util
import pathlib
import sys

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools"
NL = chr(10)
DASH = chr(8212)          # em dash, what a SKIPPED row writes for a reading
MID = chr(183)            # middot, the separator inside the opt-in cell
PIPE = chr(124)           # the character the sampler writes INTO the flag cell


def _load(name):
    spec = importlib.util.spec_from_file_location(name, TOOLS / (name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# The fixture is written in the sampler's OWN shapes, copied off the live log.
# A tidy fixture would have left out the pipe, the `[issued by ...]` tail and the
# old count-only row - which is to say it would have left out all three defects.
# ---------------------------------------------------------------------------
_RESOURCE_401 = ("console.error: Failed to load resource: the server responded "
                 "with a status of 401 ()")
_FOREIGN_URL = "https://uctintelligence.com/api/barspack/manifest"
_OWNED_URL = "https://uctintelligence.com/api/j2/notes/6f2c1a"

FOREIGN_FLAG = (
    "**ANOMALY** " + DASH + " 2 console/page error(s): " + _RESOURCE_401
    + "  [issued by " + _FOREIGN_URL + ":0]  " + PIPE + "  HTTP: GET "
    + _FOREIGN_URL + " -> 401")
OWNED_FLAG = (
    "**ANOMALY** " + DASH + " 2 console/page error(s): " + _RESOURCE_401
    + "  [issued by " + _OWNED_URL + ":0]  " + PIPE + "  HTTP: PUT "
    + _OWNED_URL + " -> 401")
LEGACY_FLAG = ("**ANOMALY** " + DASH + " 2 console/page error(s): " + _RESOURCE_401)

_HEADER = ("| at (ET) | opt-ins by population (UTC) | opt-in (windowed) "
           "| config-served (members) | blocked-baseline | sync-conflict notes "
           "| outbox | console errors (rig) | flag |")
_RULE = "|---|---|---|---|---|---|---|---|---|"
_OPTIN = ("2026-09-14 03:54:57 " + MID + " organic 0 " + MID + " synthetic 1 "
          + MID + " rig/owner 1")


def _row(at, console, flag):
    return ("| " + at + " | " + _OPTIN + " | 20 | 0/0 " + DASH
            + " no member reported | 0 | 3 | 0 | " + str(console) + " | " + flag + " |")


def _log(path, rows):
    """A log carrying the given rows, plus a CLEAN row that is always present.

    ⭐ The clean row is the NON-VACUITY anchor: every assertion about which rows
    the verdict NAMES is satisfied by a parser that returned nothing, and a row
    that must be named NOWHERE cannot be satisfied that way.
    """
    path.write_text(NL.join([
        "# Wave Q1 " + DASH + " observation log",
        "",
        _HEADER,
        _RULE,
        _row("2026-09-14 01:00 ET", 0, "OK"),
    ] + list(rows) + [""]) + NL, encoding="utf-8")
    return path


def _gate(tmp_path, monkeypatch, rows):
    _log(tmp_path / "obs.md", rows)
    monkeypatch.setenv("NB_OBSERVE_LOG", str(tmp_path / "obs.md"))
    monkeypatch.setenv("NB_GATE_VERDICT", str(tmp_path / "verdict.md"))
    monkeypatch.setenv("NB_RESUME_DOC", str(tmp_path / "no-such-resume.md"))
    # ⛔ NB_GATE_REPO at a directory with no sweep tool: the C-4 sweep is a
    # 60-85s subprocess and says nothing about trigger 4. It reports DID NOT RUN,
    # which is its own honest answer.
    monkeypatch.setenv("NB_GATE_REPO", str(tmp_path))
    return _load("nb_gate")


# ===========================================================================
# READING THE VERDICT. These three helpers LOCATE text in the render. Not one of
# them decides which half a row belongs to - `main()` does, and that is the whole
# repair. A helper here that computed an expected answer would be `_buckets`
# wearing a different name.
# ===========================================================================
WHY = "## Why this is not a clean KEEP"
FOREIGN_HEAD = "## Foreign console errors - RECORDED, not blocking"
_T4_PREFIX = "| 4 " + MID + " member console error | "


def _verdict(tmp_path, monkeypatch, rows, sub="run"):
    """Run the REAL gate over `rows`; return (module, rendered verdict.md).

    Each drive gets its own directory because `nb_gate` reads every path at
    MODULE IMPORT, and because a test that needs two renders needs two logs.
    """
    d = tmp_path / sub
    d.mkdir(parents=True, exist_ok=True)
    gate = _gate(d, monkeypatch, rows)
    assert gate.main() == 0
    out = (d / "verdict.md").read_text(encoding="utf-8")
    # NON-VACUITY: a verdict that was never written, or written empty, satisfies
    # every `not in` below and nothing else.
    assert _T4_PREFIX in out, out
    return gate, out


def _t4_cell(out):
    """The trigger-4 cell, read out of the verdict's own table."""
    for line in out.split(NL):
        if line.startswith(_T4_PREFIX):
            return line[len(_T4_PREFIX):].rsplit(" " + PIPE, 1)[0].strip()
    raise AssertionError("no trigger-4 row in the verdict" + NL + out)


def _section(out, head):
    """The body under one '## ' heading, or None when the heading is absent."""
    lines = out.split(NL)
    if head not in lines:
        return None
    body = []
    for line in lines[lines.index(head) + 1:]:
        if line.startswith("## "):
            break
        body.append(line)
    return NL.join(body)


# ===========================================================================
# THE UN-ATTRIBUTABLE DIRECTION FIRST. It is the one a two-way predicate gets
# wrong, and it is the one that would clear real rows.
# ===========================================================================

def test_an_old_format_row_with_no_URL_still_FAILS_trigger_4(tmp_path, monkeypatch):
    """⛔⛔ UNKNOWN IS NOT CLEAR.

    Three rows written 2026-09-13 carry `2 console/page error(s)` and nothing
    else. The sampler learned to record the URL the next day. A filter that reads
    "no Notebook URL here" as "not ours" clears all three.
    """
    _, out = _verdict(tmp_path, monkeypatch,
                      [_row("2026-09-14 03:00 ET", 2, LEGACY_FLAG)])
    assert _t4_cell(out) == "FAIL", out
    # ...and it is NAMED, with the reason, rather than reading as an ordinary red.
    why = _section(out, WHY)
    assert why is not None, out
    assert "trigger 4: console errors at 2026-09-14 03:00 ET" in why, why
    assert "unknown is not clear" in why, why
    # ⛔ AND IT IS NOT IN THE FOREIGN LEDGER. This is the assertion the deleted
    # harness could not make: there "blocking" and "recorded as cleared" were two
    # readings of one predicate; here they are two independent renders.
    assert FOREIGN_HEAD not in out, out
    # NON-VACUITY: the verdict really did read this log (2 rows, not 0).
    assert "rows read: 2 (0 skipped)" in out, out


def test_a_truncated_or_unlocated_row_is_UNKNOWN_not_foreign(tmp_path, monkeypatch):
    """⛔ Two more ways the row's own evidence is incomplete, both failure-safe.

    `(+N more)` means the sampler cut the deduped failing-request list at three,
    so origins it did not print exist. `[no location]` means a console error had
    no location at all. Either way the row cannot account for its own errors.

    ⭐ DRIVEN ONE AT A TIME, because the verdict names the FIRST blocking row
    only. Both shapes in one log would have proved the truncated case and said
    nothing whatsoever about the unlocated one - an assertion satisfied by a
    report that never mentions the second row.
    """
    tail = (" ; GET https://uctintelligence.com/api/bars/AAPL -> 500"
            " ; GET https://uctintelligence.com/api/live-prices -> 500")
    truncated = FOREIGN_FLAG + tail + " (+2 more)"
    unlocated = ("**ANOMALY** " + DASH + " 2 console/page error(s): "
                 + _RESOURCE_401 + "  [no location]  " + PIPE + "  HTTP: GET "
                 + _FOREIGN_URL + " -> 401")

    _, out = _verdict(tmp_path, monkeypatch,
                      [_row("2026-09-14 03:00 ET", 5, truncated)], sub="truncated")
    assert _t4_cell(out) == "FAIL", out
    assert "TRUNCATED" in _section(out, WHY), out
    assert FOREIGN_HEAD not in out, out

    _, out = _verdict(tmp_path, monkeypatch,
                      [_row("2026-09-14 05:00 ET", 2, unlocated)], sub="unlocated")
    assert _t4_cell(out) == "FAIL", out
    assert "NO location" in _section(out, WHY), out
    assert FOREIGN_HEAD not in out, out

    # ⭐ CONTROL, DIFFERING BY EXACTLY THE TWO MARKERS: the same evidence without
    # ` (+2 more)` and with a location IS cleared. Without this the two FAILs
    # above pass because nothing is ever cleared.
    _, out = _verdict(tmp_path, monkeypatch, [
        _row("2026-09-14 03:00 ET", 5, FOREIGN_FLAG + tail),
        _row("2026-09-14 05:00 ET", 2, FOREIGN_FLAG),
    ], sub="control")
    assert _t4_cell(out) == "PASS - 2 FOREIGN row(s) recorded below, not blocking", out
    assert "trigger 4:" not in out, out


def test_a_pageerror_is_the_Notebooks_however_clean_the_HTTP_list_is(tmp_path, monkeypatch):
    """⛔ A JS exception has no request origin, and it was thrown on OUR page.

    Attributing the row by the foreign HTTP failure sitting beside it would clear
    a broken bundle - the 2am case the sampler attaches its listeners before
    `goto` to catch.
    """
    flag = ("**ANOMALY** " + DASH + " 2 console/page error(s): pageerror: "
            "TypeError: t.notes is undefined  " + PIPE + "  HTTP: GET "
            + _FOREIGN_URL + " -> 401")
    _, out = _verdict(tmp_path, monkeypatch,
                      [_row("2026-09-14 03:00 ET", 2, flag)])
    assert _t4_cell(out) == "FAIL", out
    assert ("a pageerror is an exception thrown by the Notebook page itself"
            in _section(out, WHY)), out
    # ⛔ and the foreign URL sitting beside it bought the row NO clearance.
    assert FOREIGN_HEAD not in out, out


# ===========================================================================
# THE TWO DIRECTIONS THE RULING NAMES, END TO END. The verdict file is what a
# person acts on, so it is what both directions are asserted against.
# ===========================================================================

def test_a_Notebook_owned_401_still_reaches_the_verdict_as_a_trigger(tmp_path, monkeypatch):
    """⛔ The ruling narrows trigger 4; it does not switch it off.

    A 401 on `/api/j2/notes/...` is the Notebook's own write being refused -
    exactly what this trigger watches for - and the verdict must NAME the URL,
    not merely go red.
    """
    _, out = _verdict(tmp_path, monkeypatch,
                      [_row("2026-09-14 03:00 ET", 2, OWNED_FLAG)])
    assert _t4_cell(out) == "FAIL", out
    why = _section(out, WHY)
    assert "trigger 4: console errors at 2026-09-14 03:00 ET" in why, why
    assert _OWNED_URL in why, why
    assert FOREIGN_HEAD not in out, out
    assert "rows read: 2 (0 skipped)" in out, out


def test_a_foreign_row_is_REPORTED_as_foreign_and_does_not_block(tmp_path, monkeypatch):
    """⭐ The case the ruling was written for: the app shell's bars prefetch.

    Clearing a row from a trigger and clearing it from the record are two
    different acts, and only the first was ruled on. The URL must survive.
    """
    _, out = _verdict(tmp_path, monkeypatch,
                      [_row("2026-09-14 03:00 ET", 2, FOREIGN_FLAG)])
    assert _t4_cell(out) == "PASS - 1 FOREIGN row(s) recorded below, not blocking", out
    ledger = _section(out, FOREIGN_HEAD)
    assert ledger is not None, out
    assert "- 2026-09-14 03:00 ET - " + _FOREIGN_URL in ledger, ledger
    # ⛔ and trigger 4 contributed NO line to the blocking list.
    assert "trigger 4:" not in out, out
    # NON-VACUITY: the verdict really did read this log (2 rows, not 0).
    assert "rows read: 2 (0 skipped)" in out, out


def test_both_directions_in_ONE_log_partition_by_name(tmp_path, monkeypatch):
    """⭐⭐ THE DISCRIMINATOR. A predicate pinned to either answer passes one of
    the two tests above; it cannot pass this one.

    Four rows, one log: clean / foreign / Notebook-owned / un-attributable. The
    clean row must be named in NEITHER half, which is the non-vacuity control -
    an empty parse satisfies every membership assertion and satisfies no
    exclusion.
    """
    gate, out = _verdict(tmp_path, monkeypatch, [
        _row("2026-09-14 03:00 ET", 2, FOREIGN_FLAG),
        _row("2026-09-14 05:00 ET", 2, OWNED_FLAG),
        _row("2026-09-14 07:00 ET", 2, LEGACY_FLAG),
    ])
    # NON-VACUITY, BY NAME: all four rows really were read, and none was dropped
    # as unreadable by the pipe inside three of the flag cells.
    assert "rows read: 4 (0 skipped)" in out, out
    recs, gripes = gate.parsed_rows()
    assert not gripes, gripes
    # ...and the console column really carries a number on the error rows, or the
    # partition the verdict reports below is over an empty set.
    assert [gate.number(x, "console") for x in recs] == [0, 2, 2, 2]

    # ONE row is cleared, and it is named with the URL it was cleared on.
    assert _t4_cell(out) == "FAIL - 1 FOREIGN row(s) recorded below, not blocking", out
    ledger = _section(out, FOREIGN_HEAD)
    assert ledger is not None, out
    assert "- 2026-09-14 03:00 ET - " + _FOREIGN_URL in ledger, ledger
    # THE EXCLUSIONS. The Notebook-owned row, the un-attributable row and the
    # CLEAN row are all absent from the ledger; the clean row is absent from the
    # blocking list too. Nothing empty can pass this.
    why = _section(out, WHY)
    for at in ("2026-09-14 05:00 ET", "2026-09-14 07:00 ET", "2026-09-14 01:00 ET"):
        assert at not in ledger, (at, ledger)
    assert "trigger 4: console errors at 2026-09-14 05:00 ET" in why, why
    assert "2026-09-14 01:00 ET" not in why, why


# ===========================================================================
# OWNERSHIP IS ONE RULE IN ONE PLACE - not a URL, and not a copy per call site.
# ===========================================================================

def test_ownership_is_a_PREFIX_RULE_and_the_concrete_URL_is_not_hard_coded(tmp_path, monkeypatch):
    gate = _gate(tmp_path, monkeypatch, [])
    src = (TOOLS / "nb_gate.py").read_text(encoding="utf-8")
    # ⛔ The endpoint that raised the ruling must not be a special case: the next
    # foreign endpoint has to be answered by the rule, not by another ruling.
    assert "barspack" not in src.replace("# ", "@ ").split("NOTEBOOK_REQUEST_PREFIXES")[1]
    # Every entry is a documented prefix, and BOTH surfaces the Notebook issues
    # are present.
    assert gate.NOTEBOOK_REQUEST_PREFIXES == ("/api/j2/", "/api/auth/")
    for own in ("/api/j2/notes/abc", "https://uctintelligence.com/api/j2/telemetry",
                "https://uctintelligence.com/api/auth/me"):
        assert gate.request_ownership(own) == "notebook", own
    # Another product's endpoints - none of which the Notebook issues.
    for foreign in ("https://uctintelligence.com/api/barspack/manifest",
                    "https://uctintelligence.com/api/bars/AAPL?tf=D",
                    "/api/live-prices", "https://uctintelligence.com/api/breadth"):
        assert gate.request_ownership(foreign) == "foreign", foreign
    # ...and everything this rule cannot PLACE stays unknown, including a bundle
    # chunk, which is the shape an app-level console.error's location takes.
    for odd in ("https://uctintelligence.com/assets/index-Cgy0oj8K.js", "",
                "not a url at all", "https://uctintelligence.com/journal/notebook"):
        assert gate.request_ownership(odd) == "unknown", odd


# ===========================================================================
# THE PARSE REPAIR - without it the ruling reads nothing on the only rows that
# carry a URL.
# ===========================================================================

def test_a_pipe_inside_the_flag_cell_does_not_make_the_row_UNREADABLE(tmp_path, monkeypatch):
    """⚰️ MEASURED ON THE LIVE LOG 2026-09-14: the 01:00 ET row - the only row
    that has ever carried a failing URL - was reported as
    `row 2026-09-14 01:00 ET has 10 cell(s) under a 9-column header` and dropped.
    """
    gate = _gate(tmp_path, monkeypatch,
                 [_row("2026-09-14 03:00 ET", 2, FOREIGN_FLAG)])
    recs, gripes = gate.parsed_rows()
    assert not gripes, gripes
    row = next(x for x in recs if x["at"] == "2026-09-14 03:00 ET")
    # The flag cell is whole, pipe and all - byte-identical to what was written.
    assert row["flag"] == FOREIGN_FLAG
    assert PIPE in row["flag"]
    # ⛔ AND THE SURPLUS WENT INTO THE LAST COLUMN ONLY. Splitting it across the
    # middle would shift every column one place, which is the `x[4]`/`x[6]`
    # defect this gate already paid for.
    assert gate.number(row, "console") == 2
    assert gate.number(row, "conflicts") == 3
    assert gate.number(row, "blocked") == 0
    assert len(row["_cells"]) == 9
    # CONTROL: told the width, the splitter merges; told nothing, it does not -
    # so the merge is really the thing under test.
    line = _row("2026-09-14 03:00 ET", 2, FOREIGN_FLAG)
    assert len(gate.split_cells(line)) == 10
    assert len(gate.split_cells(line, 9)) == 9
    # A row with no pipe is untouched either way.
    plain = _row("2026-09-14 05:00 ET", 0, "OK")
    assert gate.split_cells(plain) == gate.split_cells(plain, 9)
