"""Compatibility harness Layer B -- classifier non-vacuity.

Mocks `run_same_build_check` (the one function that shells out to a live
browser via `chart_parity.py`) so these tests are fast, deterministic, and
CI-safe, while still proving `classify_level`'s branching logic actually
discriminates SUPPORTED / HARNESS_DEFECT / VISUAL_BLOCKED / ENVIRONMENT_BLOCKED
rather than collapsing every outcome to one label -- the exact non-vacuity
standard Section 8 of the harness design doc requires. A LIVE run against a
real dev server (`python tools/compat_harness_visual.py --base-url ...`) is
a separate, already-exercised path (see `RISK_REGISTER.md`'s harness-defect
finding for `ast_user_formula_sma20`'s real, reproducible FontNotSettledError
in this session's own environment) -- these tests do not re-run that browser
session, only the classification logic around its result.
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import pytest

TOOLS_DIR = Path(__file__).resolve().parent.parent / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import compat_harness_visual as chv  # noqa: E402


def test_unknown_level_raises():
    with pytest.raises(KeyError):
        chv.classify_level("level_that_does_not_exist", base_url=None)


def test_no_base_url_cites_prior_evidence_and_does_not_fabricate_a_render_result():
    result = chv.classify_level("level1_single_line_own_pane", base_url=None)
    assert result["steps"]["chart_render"]["status"] == "ENVIRONMENT_BLOCKED"
    assert result["final_classification"] == "PARTIAL"
    # ⛔ NON-VACUITY: the prior committed case evidence must actually be present,
    # not an empty placeholder -- a result that cited nothing would be
    # indistinguishable from one that forgot to look.
    prior = result["steps"]["chart_render"]["prior_committed_evidence"]
    assert prior["expect_px"] == 140925
    assert prior["expect_regions"]["price_plot"] == 28719


def test_a_passing_report_classifies_SUPPORTED(monkeypatch):
    def fake_check(base_url, case_name, font_retries=0):
        return {"results": [{"pass": True, "expect": 140925, "changed": 140925}]}
    monkeypatch.setattr(chv, "run_same_build_check", fake_check)
    result = chv.classify_level("level1_single_line_own_pane", base_url="http://fake")
    assert result["steps"]["chart_render"]["status"] == "SUPPORTED"
    assert result["final_classification"] == "SUPPORTED"


def test_a_font_not_settled_error_classifies_HARNESS_DEFECT_not_VISUAL_BLOCKED(monkeypatch):
    def fake_check(base_url, case_name, font_retries=0):
        return {"results": [{"pass": False, "error": "FontNotSettledError: 31 of 239 ..."}]}
    monkeypatch.setattr(chv, "run_same_build_check", fake_check)
    result = chv.classify_level("level1_single_line_own_pane", base_url="http://fake")
    assert result["steps"]["chart_render"]["status"] == "HARNESS_DEFECT"
    assert result["final_classification"] == "HARNESS_DEFECT"
    assert "harness_defect" in result["failure_taxonomy"]


def test_MUTATION_a_genuine_pixel_mismatch_classifies_VISUAL_BLOCKED_a_different_label(monkeypatch):
    """Non-vacuity control: change the error shape away from a font error and
    confirm the classification actually moves to a DIFFERENT label
    (VISUAL_BLOCKED), proving the font-error branch is a real discriminator
    and not a catch-all that would swallow a genuine rendering regression."""
    def fake_check(base_url, case_name, font_retries=0):
        return {"results": [{"pass": False, "error": "changed=141000 expect=140925 diff exceeds tolerance"}]}
    monkeypatch.setattr(chv, "run_same_build_check", fake_check)
    result = chv.classify_level("level1_single_line_own_pane", base_url="http://fake")
    assert result["steps"]["chart_render"]["status"] == "VISUAL_BLOCKED"
    assert result["final_classification"] == "VISUAL_BLOCKED"
    assert result["final_classification"] != "HARNESS_DEFECT"


def test_an_invocation_error_with_no_report_json_is_ITS_OWN_status(monkeypatch):
    def fake_check(base_url, case_name, font_retries=0):
        return {"_invocation_error": True, "returncode": 1, "stdout_tail": "", "stderr_tail": "boom"}
    monkeypatch.setattr(chv, "run_same_build_check", fake_check)
    result = chv.classify_level("level1_single_line_own_pane", base_url="http://fake")
    assert result["steps"]["chart_render"]["status"] == "HARNESS_DEFECT"
    assert result["final_classification"] == "HARNESS_DEFECT"


def test_the_case_the_fixture_cites_actually_exists_in_chart_parity_cases():
    # ⛔ NON-VACUITY: if `ast_user_formula_sma20` were ever renamed or removed
    # from chart_parity_cases.json, this fixture's citation would silently rot
    # into a KeyError only surfaced at run time with a base URL -- this proves
    # it resolves with NO base URL needed.
    case = chv._load_case("ast_user_formula_sma20")
    assert case["userDefs"][0]["compute"]["source"] == "sma(close, 20)"
    assert case["expect"] == 140925
