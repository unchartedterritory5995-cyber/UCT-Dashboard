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
