"""W9-T4-F1 -- the Python twin settles ``syminfo.mincontract`` exactly as bind.js.

``symbolScope.json::min_contract`` serves a row only with all five of value / witnesses / captured /
how / captures, and today serves none (no capture of the probe exists). The JS rail
``symbolScopeMinContract.test.js`` re-reads a row's captures; this one holds the Python loader and
fold to the same rules, and the JS-vs-Python parity rail covers the fold on real symbols.
"""
import pytest

from api.services import ast_bind as B

FULL = {"value": 1, "witnesses": ["NYSE:RDDT"], "captured": "2026-11-08", "how": "h", "captures": ["x.json"]}


def test_the_production_table_serves_no_row_until_a_capture_lands():
    rows = {k for k in B._SYMBOL_SCOPE["min_contract"] if not k.startswith("_")}
    assert set(B.SYMBOL_MIN_CONTRACT) == rows
    assert B.SYMBOL_MIN_CONTRACT == {}
    c = B.symbol_constants({"ticker": "RDDT", "exchange": "NYSE"})
    assert "syminfo.mincontract" not in c
    assert c["syminfo.pointvalue"] == "1"  # control: the exchange's other witnessed fields still settle


def test_a_complete_row_serves_decimal_text_like_js_String():
    assert B.min_contract_table({"NYSE": FULL}) == {"NYSE": "1"}
    assert B.min_contract_table({"X": {**FULL, "value": 0.001}}) == {"X": "0.001"}
    assert B.min_contract_table({"X": {**FULL, "value": 100}}) == {"X": "100"}


@pytest.mark.parametrize("drop", ["value", "witnesses", "captured", "how", "captures"])
def test_a_row_missing_any_field_serves_nothing(drop):
    row = {k: v for k, v in FULL.items() if k != drop}
    assert B.min_contract_table({"NYSE": row}) == {}


@pytest.mark.parametrize("bad", [{"witnesses": []}, {"captures": []}, {"value": 0}, {"value": -1},
                                 {"value": "1"}, {"value": True}, {"value": float("inf")}])
def test_a_malformed_row_serves_nothing(bad):
    assert B.min_contract_table({"NYSE": {**FULL, **bad}}) == {}


def test_the_fold_settles_only_a_witnessed_exchange():
    table = {"NYSE": "1"}
    def settle(sym):
        return B.symbol_constants_with(B.SYMBOL_EXCHANGE_CONFIRMED, sym, B.SYMBOL_TICK_SIZE,
                                       B.SYMBOL_LISTING_FIELDS, table)
    assert settle({"ticker": "RDDT", "exchange": "NYSE"})["syminfo.mincontract"] == "1"
    for sym in ({"ticker": "BTCUSD", "exchange": ""}, {"ticker": "AITX", "exchange": "OTC"}, {"ticker": "X"}):
        assert "syminfo.mincontract" not in settle(sym)
