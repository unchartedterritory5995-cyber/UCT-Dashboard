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
    landed in which bucket is satisfied by a parser that returned nothing, and a
    row that must appear in NEITHER bucket cannot be satisfied that way.
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


def _buckets(gate):
    """(blocking rows, foreign rows) exactly as `main()` partitions them."""
    recs, _ = gate.parsed_rows()
    observed = [x for x in recs if not gate.is_skipped(x)]
    errs = [x for x in observed if (gate.number(x, "console") or 0) > 0]
    blocking, foreign = [], []
    for x in errs:
        attr = gate.console_attribution(x.get("flag"))
        (foreign if attr["verdict"] == "foreign" else blocking).append((x, attr))
    return blocking, foreign


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
    gate = _gate(tmp_path, monkeypatch,
                 [_row("2026-09-14 03:00 ET", 2, LEGACY_FLAG)])
    blocking, foreign = _buckets(gate)
    assert [x["at"] for x, _ in blocking] == ["2026-09-14 03:00 ET"]
    assert foreign == []
    # ...and it says WHY, in the verdict, rather than reading as an ordinary red.
    assert blocking[0][1]["verdict"] == "unknown"
    assert "unknown is not clear" in blocking[0][1]["why"]


def test_a_truncated_or_unlocated_row_is_UNKNOWN_not_foreign(tmp_path, monkeypatch):
    """⛔ Two more ways the row's own evidence is incomplete, both failure-safe.

    `(+N more)` means the sampler cut the deduped failing-request list at three,
    so origins it did not print exist. `[no location]` means a console error had
    no location at all. Either way the row cannot account for its own errors.
    """
    truncated = (FOREIGN_FLAG + " ; GET https://uctintelligence.com/api/bars/AAPL "
                 "-> 500 ; GET https://uctintelligence.com/api/live-prices -> 500 "
                 "(+2 more)")
    unlocated = ("**ANOMALY** " + DASH + " 2 console/page error(s): "
                 + _RESOURCE_401 + "  [no location]  " + PIPE + "  HTTP: GET "
                 + _FOREIGN_URL + " -> 401")
    gate = _gate(tmp_path, monkeypatch, [
        _row("2026-09-14 03:00 ET", 5, truncated),
        _row("2026-09-14 05:00 ET", 2, unlocated),
    ])
    blocking, foreign = _buckets(gate)
    assert [x["at"] for x, _ in blocking] == [
        "2026-09-14 03:00 ET", "2026-09-14 05:00 ET"]
    assert foreign == []
    assert "TRUNCATED" in blocking[0][1]["why"]
    assert "NO location" in blocking[1][1]["why"]
    # ⭐ CONTROL: the SAME evidence without the truncation marker and without the
    # missing location IS cleared, or the two assertions above pass because
    # nothing is ever cleared.
    assert gate.console_attribution(FOREIGN_FLAG)["verdict"] == "foreign"


def test_a_pageerror_is_the_Notebooks_however_clean_the_HTTP_list_is(tmp_path, monkeypatch):
    """⛔ A JS exception has no request origin, and it was thrown on OUR page.

    Attributing the row by the foreign HTTP failure sitting beside it would clear
    a broken bundle - the 2am case the sampler attaches its listeners before
    `goto` to catch.
    """
    gate = _gate(tmp_path, monkeypatch, [])
    flag = ("**ANOMALY** " + DASH + " 2 console/page error(s): pageerror: "
            "TypeError: t.notes is undefined  " + PIPE + "  HTTP: GET "
            + _FOREIGN_URL + " -> 401")
    assert gate.console_attribution(flag)["verdict"] == "notebook"


# ===========================================================================
# THE TWO DIRECTIONS THE RULING NAMES.
# ===========================================================================

def test_a_Notebook_owned_401_still_FAILS_trigger_4(tmp_path, monkeypatch):
    """⛔ The ruling narrows trigger 4; it does not switch it off.

    A 401 on `/api/j2/notes/...` is the Notebook's own write being refused -
    exactly what this trigger watches for.
    """
    gate = _gate(tmp_path, monkeypatch,
                 [_row("2026-09-14 03:00 ET", 2, OWNED_FLAG)])
    blocking, foreign = _buckets(gate)
    assert [x["at"] for x, _ in blocking] == ["2026-09-14 03:00 ET"]
    assert foreign == []
    assert _OWNED_URL in blocking[0][1]["why"]


def test_a_foreign_401_does_NOT_fail_trigger_4(tmp_path, monkeypatch):
    """⭐ The case the ruling was written for: the app shell's bars prefetch."""
    gate = _gate(tmp_path, monkeypatch,
                 [_row("2026-09-14 03:00 ET", 2, FOREIGN_FLAG)])
    blocking, foreign = _buckets(gate)
    assert blocking == []
    assert [x["at"] for x, _ in foreign] == ["2026-09-14 03:00 ET"]
    assert foreign[0][1]["origins"] == [_FOREIGN_URL]


def test_both_directions_in_ONE_log_partition_by_name(tmp_path, monkeypatch):
    """⭐⭐ THE DISCRIMINATOR. A predicate pinned to either answer passes one of
    the two tests above; it cannot pass this one.

    Four rows, one log: clean / foreign / Notebook-owned / un-attributable. The
    clean row must appear in NEITHER bucket, which is the non-vacuity control -
    an empty parse satisfies every membership assertion and satisfies no
    exclusion.
    """
    gate = _gate(tmp_path, monkeypatch, [
        _row("2026-09-14 03:00 ET", 2, FOREIGN_FLAG),
        _row("2026-09-14 05:00 ET", 2, OWNED_FLAG),
        _row("2026-09-14 07:00 ET", 2, LEGACY_FLAG),
    ])
    recs, gripes = gate.parsed_rows()
    # NON-VACUITY, BY NAME: all four rows really were read, and none was dropped
    # as unreadable by the pipe inside three of the flag cells.
    assert [x["at"] for x in recs] == [
        "2026-09-14 01:00 ET", "2026-09-14 03:00 ET",
        "2026-09-14 05:00 ET", "2026-09-14 07:00 ET"]
    assert not gripes, gripes
    # ...and the console column really carries a number on the error rows, or the
    # partition below is over an empty set.
    assert [gate.number(x, "console") for x in recs] == [0, 2, 2, 2]

    blocking, foreign = _buckets(gate)
    assert [x["at"] for x, _ in foreign] == ["2026-09-14 03:00 ET"]
    assert [x["at"] for x, _ in blocking] == [
        "2026-09-14 05:00 ET", "2026-09-14 07:00 ET"]
    # THE EXCLUSION: the clean row is in neither bucket. Nothing empty can pass.
    everywhere = [x["at"] for x, _ in blocking + foreign]
    assert "2026-09-14 01:00 ET" not in everywhere


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


# ===========================================================================
# END TO END: the verdict file is what a person reads.
# ===========================================================================

def test_a_foreign_row_is_REPORTED_as_foreign_and_does_not_block(tmp_path, monkeypatch):
    """⭐ Clearing a row from a trigger and clearing it from the record are two
    different acts, and only the first was ruled on. The URL must survive."""
    gate = _gate(tmp_path, monkeypatch,
                 [_row("2026-09-14 03:00 ET", 2, FOREIGN_FLAG)])
    gate.main()
    out = (tmp_path / "verdict.md").read_text(encoding="utf-8")
    assert "| 4 " + MID + " member console error | PASS - 1 FOREIGN row(s) " \
           "recorded below, not blocking |" in out, out
    assert "## Foreign console errors - RECORDED, not blocking" in out
    assert _FOREIGN_URL in out
    # ⛔ and trigger 4 contributed NO line to the blocking list.
    assert "trigger 4:" not in out
    # NON-VACUITY: the verdict really did read this log (2 rows, not 0).
    assert "rows read: 2 (0 skipped)" in out


def test_a_Notebook_owned_row_still_reaches_the_verdict_as_a_trigger(tmp_path, monkeypatch):
    """⭐ THE PAIR. A filter that stays quiet either way measures nothing."""
    gate = _gate(tmp_path, monkeypatch,
                 [_row("2026-09-14 03:00 ET", 2, OWNED_FLAG)])
    gate.main()
    out = (tmp_path / "verdict.md").read_text(encoding="utf-8")
    assert "| 4 " + MID + " member console error | FAIL |" in out, out
    assert "trigger 4: console errors at 2026-09-14 03:00 ET" in out
    assert _OWNED_URL in out
    assert "## Foreign console errors" not in out
    assert "rows read: 2 (0 skipped)" in out
