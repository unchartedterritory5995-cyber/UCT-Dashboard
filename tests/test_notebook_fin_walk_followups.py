"""Rails for the c2 walk's `followups` step (tools/notebook_fin_walk_followups.py, follow-up E).

The step's words are read from the product's files at import, so a renamed control is a red here, not a 30-second
timeout in an evidence run; the coverage row's list and the rows the code records must be the same set, or a row
could drop out of the record unseen; and the step must run before `remove` (it reads the sample's titles).
"""
import ast
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))

import notebook_fin_walk_followups as fu  # noqa: E402

SRC = (REPO / "tools" / "notebook_fin_walk_followups.py").read_text(encoding="utf-8")


def _step_features(tree) -> set:
    """Every literal or f-string feature name passed as the third argument of a `C.step(...)` call."""
    out = set()
    for c in ast.walk(tree):
        if isinstance(c, ast.Call) and isinstance(c.func, ast.Attribute) and c.func.attr == "step" and len(c.args) >= 3:
            a = c.args[2]
            if isinstance(a, ast.Constant) and isinstance(a.value, str):
                out.add(a.value)
            elif isinstance(a, ast.JoinedStr):
                parts = [v.value if isinstance(v, ast.Constant) else "{}" for v in a.values]
                out.add("".join(parts))
    return out


def _want(tree) -> set:
    for n in ast.walk(tree):
        if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "want" for t in n.targets) and isinstance(n.value, ast.Set):
            return {e.value for e in n.value.elts}
    raise AssertionError("the coverage row's `want` set was not found")


def test_the_words_the_step_compares_against_are_read_from_the_product():
    assert fu.MANAGER_VIEWS == ["Active", "Archived", "Recently deleted"]
    assert fu.TEMPLATE_ARCHIVE_ONE.startswith("It stays in your 1 note.")
    assert fu.UNDO_DELETED == "Moved to Recently deleted."
    assert fu.SAVED_WORDS and fu.SAVING_WORDS and fu.SAVED_WORDS != fu.SAVING_WORDS
    assert fu.OPEN_MANAGER and fu.PLAIN_MANAGE_LINK and fu.DAILY_CHANGE_LINK and fu.DAILY_BRIEF == "Daily brief"


def test_every_row_in_the_coverage_list_is_recorded_by_the_code_and_back():
    tree = ast.parse(SRC)
    want = _want(tree)
    recorded = _step_features(tree)
    expanded = set(recorded)
    for r in recorded:                       # the one f-string row family: insert-cold at each width
        if "{}" in r and r.startswith("followups.held.insert-cold-"):
            expanded |= {r.replace("{}", w) for w in ("1280", "390")}
    assert len(want) >= 30, "non-vacuity: the coverage list was not read"
    assert want <= expanded, f"rows in the coverage list that no step records: {sorted(want - expanded)}"
    real = {r for r in expanded if "{}" not in r and r.startswith("followups.") and r != "followups.coverage"}
    assert real <= want, f"rows recorded but missing from the coverage list: {sorted(real - want)}"


def test_the_step_is_registered_and_runs_before_the_sample_is_removed():
    import notebook_fin_walk_features as feat
    assert "followups" in feat.ORDER and feat.ORDER.index("followups") < feat.ORDER.index("remove")
