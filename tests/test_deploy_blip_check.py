"""The harm check: a 502 filter that matches milliseconds is not a measurement.

⚰️ On 2026-09-14 the deploy-window logs were filtered on the string `502` and
returned 18 hits — every one of them the millisecond field of a timestamp
(`19:41:44,502`). "No 502s found" was therefore never a measurement: that filter
could not have seen a real 502.

⛔ THE MANDATORY CONTROL PAIR IS THE FIRST TWO TESTS IN THIS FILE. A planted 502
must be COUNTED and `19:41:44,502` must NOT be. Without BOTH, this instrument is
exactly the thing it replaces — and the pair must be read together: either one
alone is satisfied by a checker that always answers the same way.
"""
import importlib.util
import json
import pathlib

import pytest

_REPO = pathlib.Path(__file__).resolve().parents[1]
_TOOL = _REPO / "tools" / "deploy_blip_check.py"


def _load():
    spec = importlib.util.spec_from_file_location("blip", str(_TOOL))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


B = _load()

#: A REAL line, copied verbatim out of
#: docs/discord-render/evidence/smoke-2026-09-14/step08-buzz-logs.jsonl.
#: Its milliseconds are `,203` and it carries `status=200` — so it exercises both
#: halves of the parser against a shape this repo actually emits.
REAL_LINE = ("2026-09-14 19:10:31,203 INFO chart-renderer: render cid=- path=/r/buzz "
             "status=200 ms=10738 prio=interactive ready=True bytes=346078")

#: The exact shape that produced the 18 phantom hits.
MILLISECOND_502 = ("2026-09-14 19:41:44,502 INFO api.main: [buzz] 1216816863313657886: "
                   "2 message(s), 1 mention(s)")


def _row(message, ts="2026-09-14T19:41:44.000000000Z"):
    return {"timestamp": ts, "message": message, "severity": "info"}


# ══════════════════════════ THE CONTROL PAIR — read these two together

def test_a_planted_502_is_COUNTED():
    """⛔ MANDATORY CONTROL, half one. An instrument that cannot report harm is
    not an instrument that found none."""
    line = "2026-09-14 19:41:44,404 WARNING api.main: [buzz] render HTTP 502: Bad Gateway"
    assert B.status_in_message(line) == 502, "a real 502 in a named field was not read"
    r = B.assess([_row(line)])
    assert r["verdict"] == B.HARM
    assert r["harm"] == 1 and r["by_class"] == {"5xx": 1}


def test_a_millisecond_field_of_502_is_NOT_counted():
    """⛔ MANDATORY CONTROL, half two — the actual 2026-09-14 defect. `,502` is
    502 MILLISECONDS. A substring filter counted 18 of these and reported clean."""
    assert B.status_in_message(MILLISECOND_502) is None, \
        "the millisecond field was read as a status — this is the original bug"
    r = B.assess([_row(MILLISECOND_502)])
    assert r["harm"] == 0
    assert r["verdict"] == B.INCONCLUSIVE, \
        "a window where nothing carried a status must never read as CLEAN"


def test_the_pair_is_not_satisfied_by_one_constant_answer():
    """DISCRIMINATOR. Both halves above pass trivially for a parser that always
    returns None (half two) or always returns 502 (half one). One line holding a
    millisecond 502 AND a real 200 can only be answered correctly."""
    line = "2026-09-14 19:41:44,502 INFO api.main: [buzz] render HTTP 200: ok"
    assert B.status_in_message(line) == 200
    assert B.assess([_row(line)])["verdict"] == B.CLEAN


def test_a_real_line_from_the_evidence_file_parses_to_its_own_field():
    """The corpus is the regression net. This line is on disk in the smoke
    evidence; its milliseconds are 203 and its status is 200."""
    assert B.status_in_message(REAL_LINE) == 200


# ══════════════════════════ the status comes from a FIELD, never from prose

@pytest.mark.parametrize("line,expected", [
    ('INFO: 10.0.0.1:0 - "GET /api/health HTTP/1.1" 502 -', 502),
    ("[liveflow] discord POST HTTP 429: rate limited", 429),
    ("render cid=- path=/r/buzz status=500 ms=12 ready=False", 500),
    ('{"t":"drender","httpStatus":503,"cmd":"flow"}', 503),
    ("upload failed status_code=413", 413),
])
def test_named_field_forms_are_read(line, expected):
    assert B.status_in_message(line) == expected


@pytest.mark.parametrize("line", [
    MILLISECOND_502,
    "2026-09-14 19:41:44.502 INFO api.main: nothing to see",       # dot, not comma
    "[call_recap] warm-on-miss NVDA -> 502",                        # a prose arrow, not a field
    "render ms=502 prio=interactive",                               # a duration
    "[buzz] 1216816863313657886: 2 message(s)",                     # a snowflake id
    "processed 502 rows",                                           # a count
    "HTTP 5021",                                                    # not three digits
])
def test_a_bare_number_is_never_a_status(line):
    """⛔ `-> 502` IS DELIBERATELY NOT A FIELD. `-> %s` appears 18 times in api/**
    and most are prose arrows (a symbol mapping, a cache warm). Accepting it would
    re-commit the original defect in a narrower costume."""
    assert B.status_in_message(line) is None, "%r was read as a status" % line


def test_a_deployment_rows_SUCCESS_status_is_not_an_http_status():
    """⛔ Railway's DEPLOYMENT rows carry `status: "SUCCESS"`. A parser that read
    that field would answer confidently about an entirely different thing."""
    assert B.status_of({"status": "SUCCESS", "message": "deployed"}) is None


def test_a_structured_httpStatus_field_wins_and_is_read_as_an_int():
    assert B.status_of({"httpStatus": 502, "path": "/api/health"}) == 502
    assert B.status_of({"httpStatus": "502"}) == 502
    assert B.status_of({"httpStatus": None, "message": "render status=200"}) == 200
    assert B.status_of({"httpStatus": "not-a-number"}) is None
    assert B.status_of({"httpStatus": 999}) is None


# ══════════════════════════ three-valued, and the third value is the point

def test_no_lines_in_the_window_is_INCONCLUSIVE_never_clean():
    """⛔ An empty result is a failed invocation until proven otherwise."""
    r = B.assess([_row("x", ts="2026-09-14T10:00:00Z")],
                 since="2026-09-14T19:00:00Z", until="2026-09-14T20:00:00Z")
    assert r["in_window"] == 0
    assert r["verdict"] == B.INCONCLUSIVE
    assert "failed invocation" in r["reason"]


def test_lines_but_no_status_field_is_INCONCLUSIVE():
    """This is the exact state the old substring filter called 'no 502s found'."""
    r = B.assess([_row(MILLISECOND_502), _row("[buzz] poll ok")])
    assert r["in_window"] == 2 and r["with_status"] == 0
    assert r["verdict"] == B.INCONCLUSIVE


def test_a_floor_pull_that_found_nothing_is_INCONCLUSIVE():
    """`railway_env_logs.py` says in its own `_meta` whether the pull was EXACT or
    a FLOOR. A floor that found no 5xx cannot say there were none."""
    rows = [{"timestamp": "2026-09-14T19:41:44Z", "httpStatus": 200}]
    assert B.assess(rows, exact=True)["verdict"] == B.CLEAN
    assert B.assess(rows, exact=False)["verdict"] == B.INCONCLUSIVE


def test_harm_is_reported_even_on_a_floor_pull():
    """A floor cannot prove absence; it can still prove PRESENCE. Downgrading a
    found 5xx to INCONCLUSIVE would hide the one thing the check exists for."""
    rows = [{"timestamp": "2026-09-14T19:41:44Z", "httpStatus": 502}]
    assert B.assess(rows, exact=False)["verdict"] == B.HARM


def test_the_window_bounds_actually_filter():
    """CONTROL on the window itself — a filter that selects everything is not a
    filter, and a window that selects nothing would make every run INCONCLUSIVE."""
    rows = [{"timestamp": "2026-09-14T19:00:00Z", "httpStatus": 502},
            {"timestamp": "2026-09-14T21:00:00Z", "httpStatus": 200}]
    inside = B.assess(rows, since="2026-09-14T18:00:00Z", until="2026-09-14T20:00:00Z")
    assert inside["in_window"] == 1 and inside["verdict"] == B.HARM
    after = B.assess(rows, since="2026-09-14T20:30:00Z", until="2026-09-14T22:00:00Z")
    assert after["in_window"] == 1 and after["verdict"] == B.CLEAN


# ══════════════════════════ totals, exit codes and the self-check

def test_every_run_prints_a_totals_line(capsys):
    """A run with no totals line is not a run."""
    B.report(B.assess([{"timestamp": "2026-09-14T19:41:44Z", "httpStatus": 502}]))
    out = capsys.readouterr().out
    assert "TOTALS" in out and "harm=1" in out and "verdict=HARM FOUND" in out


def test_the_exit_codes_separate_harm_from_inconclusive():
    """⛔ 'We could not compute it' and 'it is broken' are different facts; one
    exit code for both is how a checker gets muted."""
    assert B.EXIT_CODE[B.CLEAN] == 0
    assert B.EXIT_CODE[B.HARM] == 1
    assert B.EXIT_CODE[B.INCONCLUSIVE] == 2


def test_self_check_passes_and_prints_a_totals_line(capsys):
    assert B.self_check() == 0
    out = capsys.readouterr().out
    assert "SELF-CHECK PASS" in out
    assert "TOTALS cases=" in out
    assert out.count("TOTALS") >= len(B.SELF_CHECK_CASES) + 1


def test_self_check_carries_the_planted_502_control_by_name():
    """⛔ The control pair must be IN the shipped self-check, not only in this test
    file — the self-check is what an operator runs, and a control that lives only
    in pytest does not travel with the instrument."""
    names = [c[0] for c in B.SELF_CHECK_CASES]
    assert any("planted 502" in n for n in names)
    assert any("MILLISECOND" in n for n in names)
    expected = [c[3] for c in B.SELF_CHECK_CASES]
    assert B.HARM in expected and B.CLEAN in expected and B.INCONCLUSIVE in expected, \
        "a self-check that can only produce one verdict proves nothing"


def test_main_with_no_logs_is_INCONCLUSIVE_not_success():
    assert B.main([]) == B.EXIT_CODE[B.INCONCLUSIVE]


def test_main_reads_a_jsonl_file_and_honours_its_meta(tmp_path):
    p = tmp_path / "logs.jsonl"
    p.write_text(
        json.dumps({"_meta": {"exact": True, "count": 1}}) + "\n"
        + json.dumps({"timestamp": "2026-09-14T19:41:44Z",
                      "message": "render status=502 ms=3"}) + "\n",
        encoding="utf-8", newline="\n")
    assert B.main(["--logs", str(p)]) == B.EXIT_CODE[B.HARM]

    floor = tmp_path / "floor.jsonl"
    floor.write_text(
        json.dumps({"_meta": {"exact": False, "count": 1}}) + "\n"
        + json.dumps({"timestamp": "2026-09-14T19:41:44Z",
                      "message": "render status=200 ms=3"}) + "\n",
        encoding="utf-8", newline="\n")
    assert B.main(["--logs", str(floor)]) == B.EXIT_CODE[B.INCONCLUSIVE]


def test_a_missing_log_file_is_INCONCLUSIVE_not_clean(tmp_path):
    assert B.main(["--logs", str(tmp_path / "nope.jsonl")]) == B.EXIT_CODE[B.INCONCLUSIVE]


def test_it_parses_the_real_evidence_file_on_disk():
    """NON-VACUITY over the real corpus: the file exists, it has rows, and exactly
    the line that carries a status field is the one that is read."""
    p = _REPO / "docs" / "discord-render" / "evidence" / "smoke-2026-09-14" / "step08-buzz-logs.jsonl"
    if not p.exists():
        pytest.skip("evidence file not present in this checkout")
    rows, meta = B.load([p])
    assert rows, "the evidence file produced no rows — the reader, not the deploy, is the finding"
    r = B.assess(rows, exact=meta["exact"])
    assert r["with_status"] == 1, "expected exactly one status-bearing line in this fixture"
    assert r["by_class"] == {"2xx": 1}
    assert r["verdict"] == B.CLEAN
