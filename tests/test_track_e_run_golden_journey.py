"""Tests for tools/track_e_run_golden_journey.py's pre-flight gate.

Only the pure gate logic is unit-tested here -- the real run (a subprocess
that spends model calls) is exercised manually via the tool itself once a
scoped key exists, per DEC-008.
"""

from __future__ import annotations

import pytest

from tools import track_e_run_golden_journey as runner


@pytest.fixture(autouse=True)
def _clear_env(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("INDICATOR_VISION_ENABLED", raising=False)


def test_no_key_no_flag_reports_both_blockers():
    blockers = runner.preflight()
    assert len(blockers) == 2
    assert any("ANTHROPIC_API_KEY" in b for b in blockers)
    assert any("INDICATOR_VISION_ENABLED" in b for b in blockers)


def test_key_set_but_flag_missing_reports_one_blocker(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test-only")
    blockers = runner.preflight()
    assert len(blockers) == 1
    assert "INDICATOR_VISION_ENABLED" in blockers[0]


def test_both_set_reports_no_blockers(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test-only")
    monkeypatch.setenv("INDICATOR_VISION_ENABLED", "1")
    assert runner.preflight() == []


def test_blank_key_is_not_treated_as_set(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "   ")
    assert not runner._has_real_key()


@pytest.mark.parametrize("value,expected", [
    ("1", True), ("true", True), ("YES", True), ("on", True),
    ("0", False), ("false", False), ("", False), ("nah", False),
])
def test_vision_flag_accepts_common_truthy_spellings(monkeypatch, value, expected):
    monkeypatch.setenv("INDICATOR_VISION_ENABLED", value)
    assert runner._vision_on() is expected


def test_run_refuses_without_spawning_pytest_when_not_ready(monkeypatch, capsys):
    code = runner.run()
    assert code == 2
    out = capsys.readouterr().out
    assert "NOT READY TO RUN" in out


# ═══ Mechanical evidence extraction (extract_evidence / _draft_results_doc) ═══
#
# ⛔ THESE ARE PURE, MECHANICAL TRANSCRIPTION FUNCTIONS -- no semantic judgment.
# Tests here assert they copy what pytest printed verbatim, not that they
# "correctly judge" anything (that stays a reviewer's job forever -- see the
# runner's own docstring).

_SAMPLE_OUTPUT = """\
tests/test_golden_journey_04_05_live.py::test_empty_prompt_refuses_before_spending_a_token [auth] Database ready at C:\\\\tmp\\\\auth.db
PASSED
tests/test_golden_journey_04_05_live.py::TestGoldenJourney04Live::test_positive_case_produces_an_inspectable_ast [auth] Database ready at C:\\\\tmp\\\\auth.db
[CGJ4 evidence] prompt='close above the 50 day moving average' -> sentence='...' ast={'a': 1}
PASSED
tests/test_golden_journey_04_05_live.py::TestGoldenJourney04Live::test_ambiguous_prompt_does_not_silently_guess [auth] Database ready at C:\\\\tmp\\\\auth.db
[CGJ4 evidence] ambiguous prompt -> ok=False gate='vocab:unknown' not_understood=['vibe']
PASSED
tests/test_golden_journey_04_05_live.py::TestGoldenJourney05Live::test_known_answer_screenshot_produces_a_candidate [auth] Database ready at C:\\\\tmp\\\\auth.db
[CGJ5 evidence] candidates response: {'ok': True}
PASSED

================================== 4 passed in 12.34s ===================================
"""

_SAMPLE_FAILING_OUTPUT = """\
tests/test_golden_journey_04_05_live.py::test_empty_prompt_refuses_before_spending_a_token [auth] Database ready at C:\\\\tmp\\\\auth.db
PASSED
tests/test_golden_journey_04_05_live.py::TestGoldenJourney04Live::test_positive_case_produces_an_inspectable_ast [auth] Database ready at C:\\\\tmp\\\\auth.db
FAILED

================================== 1 failed, 1 passed in 3.21s ===================================
"""


def test_extract_evidence_pulls_per_test_outcomes_verbatim():
    evidence = runner.extract_evidence(_SAMPLE_OUTPUT)
    tests = {o["test"] for o in evidence["outcomes"]}
    assert "test_empty_prompt_refuses_before_spending_a_token" in tests
    assert "TestGoldenJourney04Live::test_positive_case_produces_an_inspectable_ast" in tests
    assert all(o["outcome"] == "PASSED" for o in evidence["outcomes"])
    assert evidence["counts"]["PASSED"] == 4
    assert evidence["counts"]["FAILED"] == 0


def test_extract_evidence_pulls_the_printed_evidence_lines_verbatim():
    evidence = runner.extract_evidence(_SAMPLE_OUTPUT)
    assert any(l.startswith("[CGJ4 evidence] prompt=") for l in evidence["lines"])
    assert any(l.startswith("[CGJ4 evidence] ambiguous prompt") for l in evidence["lines"])
    assert any(l.startswith("[CGJ5 evidence] candidates response") for l in evidence["lines"])
    # ⛔ Never invented, never paraphrased -- a substring of the ORIGINAL line.
    assert "vibe" in [l for l in evidence["lines"] if "ambiguous" in l][0]


def test_extract_evidence_reads_the_summary_line():
    evidence = runner.extract_evidence(_SAMPLE_OUTPUT)
    assert evidence["summary"] == "4 passed"


def test_extract_evidence_is_not_fooled_by_a_bare_test_id_in_the_warnings_summary():
    """⛔ REGRESSION for a real bug found against a real captured log: pytest's
    own "warnings summary" section reprints bare `tests/....py::name` lines
    (attributing a DeprecationWarning to the test that raised it) with NO
    PASSED/FAILED word anywhere near it. A version of extract_evidence that
    searched the WHOLE output picked this up as an 8th "test start" with only
    7 real outcome words following it."""
    output = _SAMPLE_OUTPUT + (
        "\n\n=============================== warnings summary ===============================\n"
        "tests/test_golden_journey_04_05_live.py::test_empty_prompt_refuses_before_spending_a_token\n"
        "  some/site-packages/thing.py:1: DeprecationWarning: whatever\n"
    )
    evidence = runner.extract_evidence(output)
    assert evidence["raw_counts"]["test_starts"] == evidence["raw_counts"]["outcome_words"] == 4
    assert len(evidence["outcomes"]) == 4


def test_extract_evidence_on_a_failing_run_counts_the_failure():
    evidence = runner.extract_evidence(_SAMPLE_FAILING_OUTPUT)
    assert evidence["counts"]["FAILED"] == 1
    assert evidence["counts"]["PASSED"] == 1


def test_draft_doc_carries_the_DRAFT_banner_and_every_outcome():
    evidence = runner.extract_evidence(_SAMPLE_OUTPUT)
    doc = runner._draft_results_doc(evidence, log_path="fake.log", stamp="20260101-000000")
    assert "DRAFT" in doc
    assert "not yet reviewed" in doc.lower() or "not been read" in doc.lower()
    assert "test_positive_case_produces_an_inspectable_ast" in doc
    assert "[CGJ4 evidence]" in doc
    assert "[CGJ5 evidence]" in doc
    # ⛔ The reviewer checklist is PRESENT, never pre-filled -- this function
    # must never answer its own judgment questions.
    assert "- [ ]" in doc
    assert "VALIDATION_COVERAGE_MAP.md" in doc


def test_run_writes_a_draft_doc_only_on_a_genuine_full_pass(monkeypatch, tmp_path):
    """⛔ MUTATION-SHAPED: a run() that always wrote the draft (or never did)
    would make this the untested branch this whole tool exists to avoid."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test-only")
    monkeypatch.setenv("INDICATOR_VISION_ENABLED", "1")
    monkeypatch.setattr(runner, "LOG_DIR", str(tmp_path / "runs"))
    results_doc = tmp_path / "RESULTS.md"
    monkeypatch.setattr(runner, "RESULTS_DOC", str(results_doc))

    class _FakeCompletedProcess:
        def __init__(self, returncode, stdout):
            self.returncode = returncode
            self.stdout = stdout
            self.stderr = ""

    def _fake_run_passing(cmd, cwd, capture_output, text):
        return _FakeCompletedProcess(0, _SAMPLE_OUTPUT)

    def _fake_run_failing(cmd, cwd, capture_output, text):
        return _FakeCompletedProcess(1, _SAMPLE_FAILING_OUTPUT)

    monkeypatch.setattr(runner.subprocess, "run", _fake_run_passing)
    code = runner.run()
    assert code == 0
    assert results_doc.exists(), "a full pass must draft the results doc"
    assert "DRAFT" in results_doc.read_text(encoding="utf-8")

    results_doc.unlink()
    monkeypatch.setattr(runner.subprocess, "run", _fake_run_failing)
    code = runner.run()
    assert code == 1
    assert not results_doc.exists(), (
        "a failing run must NOT draft a results doc -- it would misrepresent "
        "a failure as evidence")
