"""Step 1 — grading merges against golden can only raise a number it is entitled to raise.

⛔⛔ WHY THIS IS DANGEROUS IN THE SAME DIRECTION AS THE STUDY ITSELF. A merge precision of 1.000
is an argument for adopting an identity, and adopting an identity PUBLISHES records the floor
would otherwise block. So every way of inflating that number has to be closed:

  * a cluster whose labelled members map to DIFFERENT golden records is an OVER-MERGE, never a
    correct one;
  * a cluster with fewer than two labelled members is UNGRADEABLE, never correct — counting it as
    correct is how a precision over the clusters that happened to be labelled gets presented as a
    precision over all of them;
  * with nothing graded, precision is None, NOT 1.0 — the vacuous-pass this repo keeps catching;
  * a singleton cluster is not a merge and is not graded at all.

⚠️ The grader's own bound is stated in its docstring and repeated here: each key is matched to
golden ALONE, so a key can win an expectation it lost in the full greedy one-to-one run. It
measures "which golden record would this key represent if it stood alone".
"""
from __future__ import annotations

import importlib.util
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[1]


def _load(name: str, relpath: str):
    spec = importlib.util.spec_from_file_location(name, REPO / relpath)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


grader = _load("_grade_merges_under_test", "tools/wisdom/grade_merges.py")


def _clusters(mapping):
    """{segment: {key: cluster_id}}"""
    return {"seg-1": mapping}


def test_two_labelled_members_on_the_same_golden_record_is_correct():
    g = grader.grade(_clusters({"a": 1, "b": 1}),
                     {("seg-1", "a"): frozenset({"g1"}), ("seg-1", "b"): frozenset({"g1"})})
    assert g["correct"] == 1 and g["over_merged"] == 0
    assert g["precision"] == 1.0


def test_two_labelled_members_on_different_golden_records_is_an_over_merge():
    """⛔ THE LOAD-BEARING ONE."""
    g = grader.grade(_clusters({"a": 1, "b": 1}),
                     {("seg-1", "a"): frozenset({"g1"}), ("seg-1", "b"): frozenset({"g2"})})
    assert g["over_merged"] == 1 and g["correct"] == 0
    assert g["precision"] == 0.0


def test_a_cluster_with_no_labelled_member_is_ungradeable_never_correct():
    g = grader.grade(_clusters({"a": 1, "b": 1}), {})
    assert g["ungradeable"] == 1
    assert g["correct"] == 0 and g["over_merged"] == 0
    assert g["clusters_graded"] == 0


def test_a_cluster_with_exactly_one_labelled_member_is_ungradeable():
    """One label cannot agree or disagree with anything."""
    g = grader.grade(_clusters({"a": 1, "b": 1}), {("seg-1", "a"): frozenset({"g1"})})
    assert g["ungradeable"] == 1 and g["clusters_graded"] == 0


def test_precision_is_none_when_nothing_was_graded_not_one():
    """⛔ A precision of 1.0 over zero clusters is the vacuous pass."""
    g = grader.grade(_clusters({"a": 1, "b": 1}), {})
    assert g["precision"] is None


def test_a_singleton_cluster_is_not_a_merge_and_is_not_graded():
    g = grader.grade(_clusters({"a": 1, "b": 2}),
                     {("seg-1", "a"): frozenset({"g1"}), ("seg-1", "b"): frozenset({"g2"})})
    assert g["clusters_graded"] == 0 and g["ungradeable"] == 0
    assert g["detail"] == []


def test_partial_overlap_counts_as_correct_and_disjoint_does_not():
    """A key can satisfy more than one expectation; sharing ANY is agreement."""
    both = grader.grade(_clusters({"a": 1, "b": 1}),
                        {("seg-1", "a"): frozenset({"g1", "g2"}), ("seg-1", "b"): frozenset({"g2"})})
    assert both["correct"] == 1
    apart = grader.grade(_clusters({"a": 1, "b": 1}),
                         {("seg-1", "a"): frozenset({"g1"}), ("seg-1", "b"): frozenset({"g2", "g3"})})
    assert apart["over_merged"] == 1


def test_three_members_all_agreeing_is_one_correct_cluster_not_three():
    g = grader.grade(_clusters({"a": 1, "b": 1, "c": 1}),
                     {("seg-1", k): frozenset({"g1"}) for k in "abc"})
    assert g["correct"] == 1 and g["clusters_graded"] == 1


def test_one_dissenter_among_three_makes_the_whole_cluster_an_over_merge():
    """⛔ The cluster is the unit. Two out of three agreeing does not make the merge correct —
    the third key was still seated with records it does not belong to."""
    g = grader.grade(_clusters({"a": 1, "b": 1, "c": 1}),
                     {("seg-1", "a"): frozenset({"g1"}), ("seg-1", "b"): frozenset({"g1"}),
                      ("seg-1", "c"): frozenset({"g2"})})
    assert g["over_merged"] == 1 and g["correct"] == 0
