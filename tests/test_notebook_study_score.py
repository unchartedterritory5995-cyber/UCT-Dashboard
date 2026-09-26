"""The user-study scorer (wave 9, lane 9C): SUS arithmetic, the 90% CI, and the ruled
decision rule (D-9C6). Every fixture here is SYNTHETIC — P numbers, invented answers —
and no participant has been scored.
"""
from __future__ import annotations

import csv
import importlib.util
import io
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]


def _load():
    spec = importlib.util.spec_from_file_location("notebook_study_score",
                                                  ROOT / "tools" / "notebook_study_score.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["notebook_study_score"] = mod
    spec.loader.exec_module(mod)
    return mod


sc = _load()
BEST = [5, 1, 5, 1, 5, 1, 5, 1, 5, 1]
WORST = [1, 5, 1, 5, 1, 5, 1, 5, 1, 5]
NEUTRAL = [3] * 10
MIXED = [4, 2, 5, 1, 4, 2, 5, 2, 4, 3]     # odd (3+4+3+4+3)=17, even (3+4+3+3+2)=15 -> 80.0
GOOD = [5, 1, 5, 2, 4, 1, 5, 1, 5, 2]       # odd 4+4+3+4+4=19, even 4+3+4+4+3=18 -> 92.5


# ── SUS, exact ──────────────────────────────────────────────────────────────

def test_all_best_is_100():
    assert sc.sus_score(BEST) == 100.0


def test_all_worst_is_0():
    assert sc.sus_score(WORST) == 0.0


def test_all_neutral_is_50():
    assert sc.sus_score(NEUTRAL) == 50.0


def test_a_hand_computed_mixed_row():
    assert sc.sus_score(MIXED) == 80.0
    assert sc.sus_score(GOOD) == 92.5


def test_the_90pct_ci_uses_the_t_table_on_n_minus_1():
    # scores 80, 90, 100: mean 90, s = 10, t(0.95, df=2) = 2.920 -> half = 2.920*10/sqrt(3)
    m, lo, hi = sc.mean_ci90([80.0, 90.0, 100.0])
    assert m == 90.0
    assert round(hi - m, 3) == round(2.920 * 10 / 3 ** 0.5, 3)
    assert round(m - lo, 3) == round(hi - m, 3)


def test_a_df_between_table_rows_takes_the_wider_t():
    assert sc.t_critical_90(22) == sc.T_95[20]


# ── fixtures ────────────────────────────────────────────────────────────────

def _row(p, *, tasks=None, sus=GOOD, t1=75, silent=0, blank=()):
    tasks = {t: "U" for t in sc.TASKS} | (tasks or {})
    r = {"participant": p, "tool_today": "Notion", "session_date": "2026-11-02",
         "t1_seconds": str(t1), "silent_failures": str(silent)}
    r.update(tasks)
    r.update({f"sus_{i + 1}": str(a) for i, a in enumerate(sus)})
    for k in blank:
        r[k] = ""
    return r


def _csv(rows):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=list(sc.COLUMNS), lineterminator="\n")
    w.writeheader()
    for r in rows:
        w.writerow(r)
    return buf.getvalue()


def _score(rows):
    return sc.verdict(*sc.parse(_csv(rows)))


FIVE = [f"P{i}" for i in range(1, 6)]


# ── the verdict branches ────────────────────────────────────────────────────

def test_PASS_when_every_clause_holds():
    v = _score([_row(p) for p in FIVE])
    assert v["word"] == "PASS" and v["reasons"] == []
    assert v["mean"] == 92.5


def test_the_committed_template_parses_with_zero_rows_as_INCOMPLETE():
    text = (ROOT / "docs" / "notebook" / "user-study" / "results-template.csv").read_text(encoding="utf-8")
    rows, problems = sc.parse(text)
    assert rows == [] and problems == []
    v = sc.verdict(rows, problems)
    assert v["word"] == "INCOMPLETE"
    assert v["reasons"] == ["0 participant row(s); at least 5 are needed"]


def test_the_template_header_is_exactly_the_scorers_columns():
    text = (ROOT / "docs" / "notebook" / "user-study" / "results-template.csv").read_text(encoding="utf-8")
    assert tuple(text.splitlines()[0].split(",")) == sc.COLUMNS


def test_fewer_than_five_is_INCOMPLETE():
    assert _score([_row(p) for p in FIVE[:4]])["word"] == "INCOMPLETE"


def test_a_core_task_NT_for_anyone_is_INCOMPLETE():
    v = _score([_row(p) for p in FIVE[:4]] + [_row("P5", tasks={"T6": "NT"})])
    assert v["word"] == "INCOMPLETE"
    assert v["reasons"] == ["core task T6 was not tested for P5"]


@pytest.mark.parametrize("blank", [("sus_4",), ("T3",), ("t1_seconds",), ("silent_failures",)])
def test_a_blank_cell_is_INCOMPLETE_and_never_imputed(blank):
    v = _score([_row(p) for p in FIVE[:4]] + [_row("P5", blank=blank)])
    assert v["word"] == "INCOMPLETE"
    assert any(r.startswith("P5:") and blank[0] in r for r in v["reasons"]), v["reasons"]
    assert "P5" not in v["sus"] or blank[0] != "sus_4"


@pytest.mark.parametrize("key,value", [("sus_2", "6"), ("sus_2", "0"), ("T4", "X"),
                                       ("participant", "P9"), ("session_date", "Nov 2")])
def test_an_out_of_range_cell_is_named(key, value):
    rows = [_row(p) for p in FIVE]
    rows[2][key] = value
    v = _score(rows)
    assert v["word"] == "INCOMPLETE" and any(value in r or key in r for r in v["reasons"]), v["reasons"]


def test_a_core_task_with_a_hint_is_a_FIX_LIST_naming_the_P_number():
    v = _score([_row(p) for p in FIVE[:3]] + [_row("P4", tasks={"T4": "H"}), _row("P5", tasks={"T4": "F"})])
    assert v["word"] == "FIX-LIST"
    assert v["reasons"] == ["T4 (core) not unaided for P4 (H), P5 (F)"]


def test_an_other_task_below_80pct_of_ITS_ELIGIBLE_participants_is_a_miss():
    # T7: NT for P1 (not eligible), F for P2 -> 3 of 4 eligible = 75% < 80%
    rows = [_row("P1", tasks={"T7": "NT"}), _row("P2", tasks={"T7": "F"})] + [_row(p) for p in FIVE[2:]]
    v = _score(rows)
    assert v["word"] == "FIX-LIST"
    assert v["reasons"] == ["T7 unaided for 3 of 4 eligible — below 80%: P2 (F)"]


def test_an_NT_does_not_count_against_an_other_task():
    rows = [_row("P1", tasks={"T7": "NT"})] + [_row(p) for p in FIVE[1:]]
    assert _score(rows)["word"] == "PASS"


def test_an_other_task_nobody_could_test_is_a_note_not_a_miss():
    v = _score([_row(p, tasks={"T10": "NT"}) for p in FIVE])
    assert v["word"] == "PASS" and any("T10 was not tested" in n for n in v["notes"])


def test_a_SUS_mean_below_80_is_a_miss_and_the_CI_is_printed():
    v = _score([_row(p, sus=MIXED if p != "P5" else NEUTRAL) for p in FIVE])
    assert v["word"] == "FIX-LIST"
    assert v["reasons"][0].startswith("SUS mean 74.0 is below 80 (90% CI ")
    out = sc.render(v)
    assert "mean SUS 74.0  (90% CI " in out and "VERDICT: FIX-LIST" in out


def test_the_SUS_bar_is_the_POINT_mean_not_the_CI():
    """A mean of exactly 80 passes although its interval reaches below 80."""
    answers = {"P1": MIXED,                              # 80.0
               "P2": MIXED,                              # 80.0
               "P3": [4, 2, 4, 2, 4, 2, 4, 2, 4, 2],     # 75.0
               "P4": BEST,                               # 100.0
               "P5": [4, 2, 3, 2, 3, 2, 3, 2, 3, 2]}     # 65.0  -> mean exactly 80.0
    v = _score([_row(p, sus=answers[p]) for p in FIVE])
    assert v["mean"] == 80.0 and v["ci"][0] < 80
    assert v["word"] == "PASS"


def test_T1_at_or_over_two_minutes_is_a_miss():
    v = _score([_row(p) for p in FIVE[:4]] + [_row("P5", t1=120)])
    assert v["reasons"] == ["T1 took 120 s or more for P5 (120 s)"]


def test_any_silent_failure_is_a_miss_naming_the_participant():
    v = _score([_row(p) for p in FIVE[:4]] + [_row("P5", silent=1)])
    assert v["word"] == "FIX-LIST" and v["reasons"] == ["silent failures: P5 (1)"]


def test_main_exit_codes(tmp_path, capsys):
    path = tmp_path / "r.csv"
    path.write_text(_csv([_row(p) for p in FIVE]), encoding="utf-8")
    assert sc.main([str(path)]) == 0
    path.write_text(_csv([_row(p) for p in FIVE[:4]] + [_row("P5", silent=2)]), encoding="utf-8")
    assert sc.main([str(path)]) == 1
    assert sc.main([str(ROOT / "docs" / "notebook" / "user-study" / "results-template.csv")]) == 2
    assert "VERDICT: INCOMPLETE" in capsys.readouterr().out
