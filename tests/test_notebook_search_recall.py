"""Rails for the Notebook search's measured recall (wave 10, lane 10E-1, clause 13c).

The instrument is tools/notebook_search_recall.py over docs/notebook/search-recall-set.json.
Each rail runs the REAL readers (`notes.list_and_count_notes`, `notes.switcher_search`) over the
labelled corpus seeded through `notes.create_note`, in the conftest sandbox. Nothing is mocked but
the planted defect, and that one is the control: a rail that cannot fail is not a rail.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from tools import notebook_search_recall as R

SET = Path(R.SET_PATH)


@pytest.fixture(scope="module")
def labelled():
    return json.loads(SET.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def measured(labelled):
    return R.measure(labelled)


def test_every_label_names_a_note_in_the_corpus(labelled):
    keys = {n["key"] for n in labelled["notes"]}
    assert len(keys) == len(labelled["notes"]), "duplicate note keys in the labelled set"
    missing = [(q["q"], r) for q in labelled["queries"] for r in q["relevant"] if r not in keys]
    assert not missing, f"labels naming no note: {missing}"
    assert all(q["relevant"] for q in labelled["queries"]), "a query with no relevant note measures nothing"


def test_the_set_carries_its_baseline_and_the_tree_it_was_measured_on(labelled):
    b = labelled.get("baseline")
    assert b and b.get("measured_on_tree"), "no recorded baseline: the comparison would have nothing to hold"
    for reader in R.READERS:
        assert set(b["readers"][reader]) == {"recall_at_10", "mrr_at_10"}


def test_the_measurement_is_not_vacuous(measured, labelled):
    # every query was asked of both readers, and the search box found SOMETHING for most of them
    for reader in R.READERS:
        assert len(measured["readers"][reader]["per_query"]) == len(labelled["queries"])
    sb = measured["readers"]["search_box"]
    assert sb["recall_at_10"] > 0.5, sb["recall_at_10"]
    # a known-good query ranks its note FIRST (a broken seed or reader could not do this)
    row = next(p for p in sb["per_query"] if p["q"] == "NVDA earnings preview Q3")
    assert row["first_relevant_rank"] == 1 and row["top"][0] == "nvda-earnings"


def test_both_readers_meet_their_recorded_baseline(measured, labelled):
    assert R.compare(measured, labelled.get("baseline")) == []


def test_a_planted_ranker_regression_falls_below_the_baseline(labelled):
    with R.planted_regression():
        bad = R.measure(labelled)
    falls = R.compare(bad, labelled.get("baseline"))
    assert falls and not any("no baseline" in f for f in falls), falls


def test_no_baseline_is_never_a_pass(measured):
    assert R.compare(measured, None) and R.compare(measured, {})
