"""Pass 2 final fix, part 2: the fin walk's `blocks.prep-pack` read of a frozen prep snapshot
(`notebook_fin_walk_features.prep_gap_read`). PrepCapture.jsx draws a gap four ways (a gap that fills itself, the same
gap once nothing will fill it, the names ask, any other gap's `detail`) plus a switch it needs; the walk must expect the
words and the Captured line the block draws in each, and read every sentence from the product file, never retype it."""
from __future__ import annotations

import re
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))

import notebook_fin_walk_features as F  # noqa: E402

PREP = (REPO / "app" / "src" / "pages" / "journal-2-0" / "components" / "notebook" / "blocks" / "PrepCapture.jsx").read_text(encoding="utf-8")

# 2026-11-13 14:30 UTC is 09:30 in New York, the same day; 2026-11-13 03:30 UTC is 22:30 on Nov 12 in New York.
TODAY = date(2026, 11, 13)
TODAY_AT = "2026-11-13T14:30:00Z"
LATE_YESTERDAY_ET = "2026-11-13T03:30:00Z"


def _words(name: str) -> dict:
    block = re.search(r"export const " + name + r" = \{([^}]*)\}", PREP).group(1)
    return dict(re.findall(r'^\s+(\w+): "([^"]+)",$', block, re.M))


def test_the_words_are_read_from_the_product_file():
    assert F.PREP_FILLING_WORDS == _words("FILLING_WORDS")
    assert F.PREP_FINAL_WORDS == _words("FINAL_WORDS")
    assert set(F.PREP_FINAL_WORDS) == set(re.findall(r"'(\w+)'", re.search(r"export const RETRYABLE = \[([^\]]*)\]", PREP).group(1)))
    assert F.PREP_NAMES_ASK in PREP
    assert F.PREP_RETRY_MS * F.PREP_RETRY_MAX == int(re.search(r"RETRY_MS = (\d+)", PREP).group(1)) * int(re.search(r"RETRY_MAX = (\d+)", PREP).group(1))


def test_a_gap_captured_today_in_an_editable_note_fills_itself_with_no_captured_line():
    for gap in F.PREP_FILLING_WORDS:
        got = F.prep_gap_read({"missing": gap, "capturedAt": TODAY_AT, "detail": "Capture again in a few minutes."}, today_et=TODAY)
        assert got == {"branch": "filling", "words": F.PREP_FILLING_WORDS[gap], "captured_line": False}


def test_the_fourth_state_final_words_and_the_captured_line():
    """Nothing will fill it: an earlier New York day (a UTC time on today's date that is yesterday in New York included),
    a read-only view, or its reads ran out. The frozen `detail` is never what it says."""
    snap = {"missing": "no_earnings_yet", "capturedAt": LATE_YESTERDAY_ET, "detail": "Capture again in a few minutes."}
    want = {"branch": "final", "words": F.PREP_FINAL_WORDS["no_earnings_yet"], "captured_line": True}
    assert F.prep_gap_read(snap, today_et=TODAY) == want
    today = dict(snap, capturedAt=TODAY_AT)
    assert F.prep_gap_read(today, today_et=TODAY, editable=False) == want
    assert F.prep_gap_read(today, today_et=TODAY, reads_ran_out=True) == want
    # control: the same snapshot, editable, today, reads left: it is filling, not final
    assert F.prep_gap_read(today, today_et=TODAY)["branch"] == "filling"


def test_no_names_asks_in_an_editable_note_and_shows_its_detail_read_only():
    snap = {"missing": "no_names", "capturedAt": TODAY_AT, "detail": "No names to read."}
    assert F.prep_gap_read(snap, today_et=TODAY) == {"branch": "names", "words": F.PREP_NAMES_ASK, "captured_line": True}
    assert F.prep_gap_read(snap, today_et=TODAY, editable=False) == {"branch": "detail", "words": "No names to read.", "captured_line": True}


def test_any_other_gap_shows_its_detail_and_a_needed_switch_says_so():
    other = {"missing": "no_bars", "capturedAt": TODAY_AT, "detail": "No bars for these names."}
    assert F.prep_gap_read(other, today_et=TODAY) == {"branch": "detail", "words": "No bars for these names.", "captured_line": True}
    needs = {"needs": "earnings prep", "capturedAt": TODAY_AT}
    assert F.prep_gap_read(needs, today_et=TODAY) == {
        "branch": "needs", "words": "This block needs earnings prep, which is not on for you.", "captured_line": True}
    assert F.prep_gap_read({"capturedAt": TODAY_AT, "rows": []}, today_et=TODAY) == {"branch": "full", "words": None, "captured_line": True}


def test_the_walk_step_uses_the_read():
    """The prep-pack step reads its expectation through `prep_gap_read` (code, not a comment)."""
    import ast
    tree = ast.parse((REPO / "tools" / "notebook_fin_walk_features.py").read_text(encoding="utf-8"))
    prep = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "prep_pack")
    calls = {n.func.id for n in ast.walk(prep) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
    assert "prep_gap_read" in calls
