"""RS Rating L3 -- the Python twin settles ``syminfo.industry`` / ``syminfo.sector`` exactly as bind.js.

``tests/fixtures/ast/symbol_classification_parity.json`` is the pinned third party: this file holds
``ast_bind.py`` to it and ``symbolClassificationParity.test.js`` holds ``bind.js`` to the same rows.
The production table (``symbolScope.json::classification``) is empty until capture Q-RS4 lands, so
these rails inject rows to drive the serving path.
"""
import json
import pathlib

import pytest

from api.services import ast_bind as B

FIX = json.loads((pathlib.Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "ast"
                  / "symbol_classification_parity.json").read_text(encoding="utf-8"))
ROW = {"value": "Investment Trusts/Mutual Funds", "witnesses": ["AMEX:SPY"], "captures": ["x.json"],
       "captured": "2026-11-20", "how": "h"}


def test_the_fixture_covers_every_outcome():
    cases = FIX["cases"]
    assert len(cases) >= 5
    assert any(c["substituted"] for c in cases)
    assert any(c["values"] and not c["substituted"] for c in cases)
    assert any(not c["values"] for c in cases)


def test_the_served_table_matches_the_pin():
    assert B.classification_table(FIX["table"]) == FIX["served"]


@pytest.mark.parametrize("case", FIX["cases"], ids=lambda c: c["id"])
def test_the_python_lane_agrees_with_the_pin(case):
    table = B.classification_table(FIX["table"])
    got = B.classification_with(table, case["symbol"])
    assert got["values"] == case["values"]
    assert got["substituted"] == case["substituted"]
    consts = B.symbol_constants_with({}, case["symbol"], None, None, None, table)
    assert {k: v for k, v in consts.items() if k in ("syminfo.industry", "syminfo.sector")} == case["values"]


def test_the_production_table_serves_no_row_until_q_rs4_lands():
    raw = B._SYMBOL_SCOPE["classification"]
    for f in B.CLASSIFICATION_FIELD_NAMES:
        for kind in ("by_class", "by_ours"):
            rows = {k for k in raw[f][kind] if not k.startswith("_")}
            key = "byClass" if kind == "by_class" else "byOurs"
            assert set(B.SYMBOL_CLASSIFICATION[f][key]) == rows
    sym = {"ticker": "NVDA", "exchange": "NASDAQ", "industry": "Semiconductors"}
    assert B.symbol_constants(sym)["syminfo.industry"] == "Semiconductors"
    assert B.symbol_substitutions(sym) == [{"name": "syminfo.industry", "source": "uct:ticker_meta",
                                            "vendorValueFrom": "capture.symbol.industry"}]
    assert "syminfo.industry" not in B.symbol_constants({"ticker": "ZZZZ", "exchange": "NASDAQ"})
    assert B.symbol_substitutions({"industry": "Semiconductors"}) == []  # no ticker, no binding


@pytest.mark.parametrize("drop", ["value", "witnesses", "captures", "captured", "how"])
def test_a_row_missing_any_field_serves_nothing(drop):
    row = {k: v for k, v in ROW.items() if k != drop}
    assert B.classification_table({"industry": {"by_class": {"ETF": row}}})["industry"]["byClass"] == {}


def test_a_complete_row_serves_and_a_missing_section_serves_nothing():
    assert B.classification_table({"industry": {"by_class": {"ETF": ROW}}})["industry"]["byClass"] == {
        "ETF": "Investment Trusts/Mutual Funds"}
    assert B.classification_table(None) == {"industry": {"byClass": {}, "byOurs": {}},
                                            "sector": {"byClass": {}, "byOurs": {}}}


def test_an_unsettled_field_stops_the_fold_by_name():
    tree = {"type": "textop", "name": "eq", "args": [{"type": "symtext", "name": "industry"},
                                                     {"type": "str", "value": "X"}]}
    with pytest.raises(B.NotFoldable) as caught:
        B.fold_scalar(tree, B.symbol_constants({"ticker": "ZZZZ"}))
    assert caught.value.what.startswith("syminfo.industry")
    assert "nothing is guessed" in caught.value.what
    assert B.fold_scalar(tree, B.symbol_constants({"ticker": "Z", "industry": "X"})) == 1
