"""The hand-check sheet reads verdicts back honestly — and an unjudged sheet is not a clean one.

⛔⛔ THE FAILURE THIS GUARDS. The sheet decides whether PRINCIPLE keeps publishing under the lens
(66 records) or reverts to KEY (31). A reader that counted a BLANK verdict as agreement would
report "no over-merge found" for a sheet nobody had opened — the vacuous pass, on the one artifact
whose whole purpose is a human's judgement.

⛔ And the sheet is quote-bearing. The tool prints counts and pair ids; the statements stay in the
gitignored file. A test pins that the printing path carries no statement column.
"""
from __future__ import annotations

import csv
import importlib.util
import pathlib
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]


def _load():
    spec = importlib.util.spec_from_file_location("_pair_verdicts_under_test",
                                                  REPO / "tools" / "wisdom" / "pair_verdicts.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["_pair_verdicts_under_test"] = module
    spec.loader.exec_module(module)
    return module


tool = _load()


def _sheet(tmp_path, verdicts):
    path = tmp_path / "sheet.tsv"
    with path.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=tool.COLUMNS, delimiter="\t", lineterminator="\n")
        w.writeheader()
        for i, v in enumerate(verdicts, start=1):
            w.writerow({"pair_id": i, "verdict": v, "jaccard": 0.7, "segment_id": "seg-1",
                        "key_a": "p_a", "key_b": "p_b",
                        "statement_a": "size down in chop", "statement_b": "size down when choppy"})
    return path


def test_a_blank_verdict_is_unjudged_never_agreement(tmp_path):
    """⛔ THE LOAD-BEARING ONE."""
    out = tool.read(_sheet(tmp_path, ["", "", ""]))
    assert out["unjudged"] == 3
    assert out["same_principle"] == 0 and out["over_merged"] == 0


def test_a_single_N_is_an_over_merge_and_names_the_pair(tmp_path):
    out = tool.read(_sheet(tmp_path, ["Y", "N", "Y"]))
    assert out["over_merged"] == 1
    assert out["over_merged_pair_ids"] == ["2"]
    assert out["unjudged"] == 0


def test_all_Y_is_a_clean_sheet(tmp_path):
    out = tool.read(_sheet(tmp_path, ["Y", "Y"]))
    assert out["over_merged"] == 0 and out["unjudged"] == 0 and out["same_principle"] == 2


def test_verdicts_are_case_and_space_insensitive(tmp_path):
    out = tool.read(_sheet(tmp_path, [" y ", "n", "Y"]))
    assert out["same_principle"] == 2 and out["over_merged"] == 1 and out["unjudged"] == 0


def test_an_unrecognised_verdict_is_unjudged_not_silently_yes(tmp_path):
    """⚠️ 'maybe', 'ok', '?' must not read as agreement."""
    out = tool.read(_sheet(tmp_path, ["maybe", "ok", "?"]))
    assert out["unjudged"] == 3 and out["same_principle"] == 0


def test_the_report_path_prints_no_statement(capsys, tmp_path, monkeypatch):
    """⛔ §0.4f — counts and pair ids only reach a terminal."""
    sheet = _sheet(tmp_path, ["N", "Y"])
    monkeypatch.setattr(sys, "argv", ["pair_verdicts.py", "--read", "--sheet", str(sheet)])
    tool.main()
    out = capsys.readouterr().out
    assert "size down" not in out, "a statement reached stdout"
    assert "over_merged" in out and "pair ids" in out


def test_a_missing_sheet_is_inconclusive_not_clean(capsys, tmp_path, monkeypatch):
    monkeypatch.setattr(sys, "argv", ["pair_verdicts.py", "--read", "--sheet", str(tmp_path / "nope.tsv")])
    assert tool.main() == 2
    assert "INCONCLUSIVE" in capsys.readouterr().out


def test_one_line_collapses_whitespace_but_never_truncates():
    """⚠️ A clipped statement is a statement judged on half the evidence."""
    long = "a" * 400
    assert tool._one_line(f"  x\n\ty  ") == "x y"
    assert tool._one_line(long) == long


def test_the_tool_writes_nothing_to_the_store():
    src = (REPO / "tools" / "wisdom" / "pair_verdicts.py").read_text(encoding="utf-8")
    for banned in ("store.write", "UPDATE ", "INSERT ", "DELETE "):
        assert banned not in src, banned
    # non-vacuity: the file really is the tool under test
    assert "PRINCIPLE_IDENTITY" in src and "over_merged" in src
