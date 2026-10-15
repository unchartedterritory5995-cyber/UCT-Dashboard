"""Tier 2 part B (Task 11): the finish walk's `followup` group. The group itself needs a sandbox boot and a browser
(Task 12 runs it), so these rails check what can be checked without one: that the group is registered after `smart`,
that every name it asserts on is the product's own (read, never retyped), that the producer child parses, and that the
sandbox calendar edit keeps the file's shape."""
from __future__ import annotations

import ast
import json
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))

import notebook_fin_walk as C  # noqa: E402
import notebook_fin_walk_features as F  # noqa: E402


def test_the_followup_step_is_registered_right_after_smart():
    assert F.ORDER.index("followup") == F.ORDER.index("smart") + 1
    assert F.ORDER.count("followup") == 1


def test_the_followup_flag_is_one_the_walk_arms_in_c2():
    assert F.EARNINGS_FOLLOWUP_KEY.upper() in C.WAVE_FLAGS          # armed in c2 (c2 = armed + WAVE_FLAGS)
    assert F.JOURNAL_STYLES_KEY.upper() in C.WAVE_FLAGS             # the card's create needs it too


def test_the_headings_the_walk_expects_are_the_products():
    from api.services.journal_two import journal_styles
    assert F.followup_headings() == journal_styles.FOLLOWUP_HEADINGS and len(F.followup_headings()) == 3


def test_the_notice_title_the_walk_looks_for_is_what_the_producer_writes():
    from api.services.journal_two import earnings_followup as ef
    title, _ = ef.notice_copy(F.FOLLOWUP_SYM, date(2026, 10, 14), ["watchlist"])
    assert title == F.FOLLOWUP_NOTICE_TITLE == "ORCL reported: write your follow-up"
    assert ef.followup_url(F.FOLLOWUP_SYM, "2026-10-14") == "/journal/notebook?followup=ORCL&reportDate=2026-10-14"


def test_the_producer_child_parses_and_runs_the_pass_twice_with_the_default_delivery():
    tree = ast.parse(C.FOLLOWUP_CHILD)
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and getattr(n.func, "attr", "") == "run_followups"]
    assert len(calls) == 2
    for c in calls:                                                  # the default delivery: no `deliver=` seam
        assert "deliver" not in {k.arg for k in c.keywords}
    # the seed is written where the card reads it: earnings_intel's own snapshot kind, 7 days
    assert "earnings_intel._KIND" in C.FOLLOWUP_CHILD and "7 * 86400" in C.FOLLOWUP_CHILD


def test_the_calendar_edit_keeps_the_existing_reporters_and_the_indent_1_shape(tmp_path):
    cal = {"reporters": {"AMZN": {"date": "2026-10-19"}, "AMD": {"date": "2026-10-19"}}, "asOf": "2026-10-15T00:00:00+00:00",
           "partial": False}
    (tmp_path / C.CAL_FILE).write_text(json.dumps(cal, indent=1), encoding="utf-8")
    held = C.add_calendar_reporter(tmp_path, "ORCL", "2026-10-14", "bmo")
    after = json.loads((tmp_path / C.CAL_FILE).read_text(encoding="utf-8"))
    assert held == after["reporters"] == {**cal["reporters"], "ORCL": {"date": "2026-10-14", "timing": "bmo"}}
    assert {k: v for k, v in after.items() if k != "reporters"} == {k: v for k, v in cal.items() if k != "reporters"}
    assert (tmp_path / C.CAL_FILE).read_text(encoding="utf-8") == json.dumps(after, indent=1)       # the same shape
