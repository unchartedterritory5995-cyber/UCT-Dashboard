"""Rails for the feature -> rail census (wave 10, lane 10E-1, clause 2b "with a rail").

tools/notebook_feature_rail_census.py derives every §B1 feature from the parity scorecard, its
status from the gap ledger (through tools/gap_ledger_summary.py) and its files from the ledger
row's own citations, then finds the test files that import them. These rails run it on the
committed tree -- and on a PLANTED row that no test can see, which must fail it.
"""
from __future__ import annotations

import pytest

from tools import notebook_feature_rail_census as C


@pytest.fixture(scope="module")
def census():
    return C.census()


def test_the_census_is_not_vacuous(census):
    rows = {f["row"]: f for f in census["features"]}
    # the inventory holds dozens of features and the index found thousands of importers
    assert len(rows) >= 30, len(rows)
    assert census["index_modules"] > 500
    # a known feature resolves to its known file and its known rail (a broken derivation could
    # not produce this pair)
    g138 = rows["G-138"]
    assert "app/src/pages/journal-2-0/components/notebook/NoteFindBar.jsx" in g138["files"]
    assert "app/src/pages/journal-2-0/components/notebook/NoteFindBar.test.jsx" in g138["rails"]


def test_status_comes_from_the_ledger_not_from_here(census):
    rows = {f["row"]: f for f in census["features"]}
    # a ruled "no" is never a shipped feature, whatever it cites
    assert rows["G-157"]["verdict"] == "NOT-SHIPPED" and rows["G-157"]["bucket"] == "REJECTED"


def test_a_planted_unrailed_row_fails_the_check():
    assert C.self_check() == 0


def test_every_shipped_feature_has_a_rail(census):
    bad = [(f["row"], f["verdict"], f.get("cited_missing")) for f in C.failing(census)]
    assert not bad, f"shipped features with no rail the census can see: {bad}"


def test_a_mock_is_not_an_import(tmp_path, monkeypatch):
    # `vi.mock('x')` names a module a test REPLACES; the import regex must not read it as an import
    text = "vi.mock('../lib/memberTemplates')\nimport { render } from '@testing-library/react'\n"
    specs = [a or b for a, b in C._JS_IMPORT.findall(text)]
    assert specs == ["@testing-library/react"], specs
