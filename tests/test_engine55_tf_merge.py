"""ENGINE 55 -- the Python twin of ``tf_merge`` and the two server lanes that refuse it.

``tf_merge`` is Pine's look-ahead-off ``request.security(..., 'W'|'M')`` as TradingView
draws it (``interpret.js``'s ``tf_merge`` arm carries the measurement): the bar that
CLOSES a period -- read off the NEXT bar, never a calendar -- reads that period's value,
every other bar the last closed one, and the newest finished bar is withheld (NaN here,
``tf_merge_mask`` at the root). These are the SAME hand-written dates and expectations as
``app/src/components/chart/engine/ast/engine55HtfMerge.test.js``, so the two lanes are held
to one answer.

The scan door and the alert lane read the newest finished bar -- the one the merge
withholds -- so both refuse a ``tf_merge`` tree BY NAME, and formula ``tf`` keeps screening.
"""
import math

import pytest

from api.services import ast_interpret, ast_lint, scan_definition

DATES = [
    "2026-03-23", "2026-03-24", "2026-03-25", "2026-03-26", "2026-03-27",
    "2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02",
    "2026-04-06", "2026-04-07", "2026-04-08", "2026-04-09", "2026-04-10",
    "2026-05-27", "2026-05-28", "2026-05-29",
    "2026-06-01", "2026-06-02",
]
BARS = [{"t": t, "o": i + 1, "h": i + 1.5, "l": i + 0.5, "c": i + 1, "v": 100} for i, t in enumerate(DATES)]
N = len(BARS)
NA = None
CLOSE = {"type": "series", "name": "close"}
W_MERGE = [NA, NA, NA, NA, 5, 5, 5, 5, 9, 9, 9, 9, 9, 14, 14, 14, 17, 17]
M_MERGE = [NA, NA, NA, NA, NA, NA, 7, 7, 7, 7, 7, 7, 7, 14, 14, 14, 17, 17]
W_TF = [NA, NA, NA, NA, NA, 5, 5, 5, 5, 9, 9, 9, 9, 9, 14, 14, 14, 17, 17]


def node(kind, code, child=None):
    return {"type": kind, "value": code, "args": [child or dict(CLOSE)]}


def col(tree, **opts):
    return ast_interpret.interpret(tree, BARS, {}, opts=dict({"tf": "D"}, **opts))


def test_weekly_merge_reads_the_next_bar_good_friday_week_closes_on_thursday():
    c = col(node("tf_merge", "W"))
    assert c[:N - 1] == W_MERGE
    assert c[DATES.index("2026-04-02")] == 9
    assert c[DATES.index("2026-04-01")] == 5


def test_monthly_merge_may_ends_on_a_sunday_so_friday_closes_it():
    c = col(node("tf_merge", "M"))
    assert c[:N - 1] == M_MERGE
    assert c[DATES.index("2026-05-29")] == 17


@pytest.mark.parametrize("forming", [False, None])
def test_the_newest_finished_or_unknown_bar_is_withheld(forming):
    c = col(node("tf_merge", "W"), newest_bar_is_forming=forming)
    assert c[N - 1] is None
    assert c[:N - 1] == W_MERGE


def test_a_forming_newest_bar_reads_the_forming_week():
    assert col(node("tf_merge", "W"), newest_bar_is_forming=True)[N - 1] == 19


def test_withheld_at_the_root_nz_does_not_make_a_confident_zero():
    tree = {"type": "call", "name": "nz", "args": [node("tf_merge", "W"), {"type": "num", "value": 0}]}
    c = col(tree, newest_bar_is_forming=False)
    assert c[N - 1] is None
    assert c[0] == 0


def test_formula_tf_is_unchanged_b_minus_one_on_every_bar():
    assert col(node("tf", "W"), newest_bar_is_forming=False) == W_TF


def test_lint_badges_tf_merge_preview_repaints_and_tf_non_repainting():
    d = {"id": "u_e55", "plots": [{"key": "value"}], "compute": {"kind": "ast", "ast": node("tf_merge", "W")}}
    assert ast_lint.lint_definition(d)["plots"][0]["mode"] == "preview-repaints"
    d["compute"]["ast"] = node("tf", "W")
    assert ast_lint.lint_definition(d)["plots"][0]["mode"] == "non-repainting"


def test_the_scan_door_refuses_tf_merge_by_name_and_keeps_screening_formula_tf():
    def doc(tree):
        return {"id": "u_e55", "version": 1, "plots": [{"key": "value"}],
                "compute": {"kind": "ast", "ast": tree}}
    cond = {"type": "op", "name": ">", "args": [node("tf_merge", "W"), dict(CLOSE)]}
    with pytest.raises(scan_definition.ScanRefused) as exc:
        scan_definition.assert_scannable(doc(cond))
    assert exc.value.gate == "withheld"
    assert "tf_merge" in str(exc.value)
    plain = {"type": "op", "name": ">", "args": [node("tf", "W"), dict(CLOSE)]}
    try:
        scan_definition.assert_scannable(doc(plain))
    except scan_definition.ScanRefused as e:            # a refusal for another reason is not this one
        assert "tf_merge" not in str(e)
