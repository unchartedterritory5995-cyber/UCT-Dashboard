"""`syminfo.mintick` in the PYTHON lane of the bind-time fold (2026-09-28).

The JS lane serves `syminfo.mintick` on the chart pane from
`symbolScope.json::tick_size`; this lane must answer the same thing for the same
binding, or a definition folds one way on the pane and another in a sweep.
`tests/fixtures/ast/bind_fold_parity.json` pins the shared answers; this file
holds the Python-only pieces: the decimal formatter, the served table and the
refusals.

⛔ The screener lane refuses `syminfo.mintick` at the Pine door (its rows carry
no exchange), so no SAVED screen can contain the node. These rails exist because
the Python fold is still the mirror the parity fixture holds to.
"""
from __future__ import annotations

import json
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from api.services import ast_bind as B  # noqa: E402

SCOPE = json.loads((ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast"
                    / "symbolScope.json").read_text(encoding="utf-8"))
MINTICK = {"type": "textop", "name": "tonumber",
           "args": [{"type": "symtext", "name": "mintick"}]}


def test_tick_text_moves_the_point_and_refuses_non_power_of_ten():
    assert B.tick_text(1, 100) == "0.01"
    assert B.tick_text(25, 100) == "0.25"
    assert B.tick_text(1, 100000) == "0.00001"   # float repr would say 1e-05
    assert B.tick_text(1, 1) == "1"
    assert B.tick_text(1, 3) is None
    assert B.tick_text(0, 100) is None
    assert B.tick_text(True, 100) is None
    assert B.tick_text(1.5, 100) is None
    assert float(B.tick_text(25, 100)) == 25 / 100


def test_the_served_table_is_exactly_the_witnessed_entries_and_is_not_empty():
    served = {k for k, v in SCOPE["tick_size"].items()
              if not k.startswith("_") and v.get("witnesses")}
    assert served, "nothing served: every assertion below would pass vacuously"
    assert set(B.SYMBOL_TICK_SIZE) == served
    for k in served:
        e = SCOPE["tick_size"][k]
        assert B.SYMBOL_TICK_SIZE[k] == B.tick_text(e["minmov"], e["pricescale"])
    for k in SCOPE["tick_size"]["_not_served"]:
        if not k.startswith("_"):
            assert k not in B.SYMBOL_TICK_SIZE, k


@pytest.mark.parametrize("symbol, expected", [
    ({"ticker": "SPY", "exchange": "NYSE Arca"}, 0.01),
    ({"ticker": "AAPL", "exchange": "NASDAQ"}, 0.01),
    ({"ticker": "BRK.A", "exchange": "NYSE"}, 0.01),
])
def test_a_witnessed_exchange_folds_to_the_vendor_tick(symbol, expected):
    assert B.fold_scalar(MINTICK, B.binding_constants(symbol=symbol)) == expected


@pytest.mark.parametrize("symbol", [
    {"ticker": "IMO", "exchange": "NYSE American"},
    {"ticker": "ARKK", "exchange": "Cboe BZX"},
    {"ticker": "AITX", "exchange": "OTC"},
    {"ticker": "X", "exchange": "NASDAQ Global Select"},
    {"ticker": "SPY", "exchange": None},
    None,
])
def test_an_uncovered_symbol_STOPS_the_fold_naming_the_field(symbol):
    with pytest.raises(B.NotFoldable) as caught:
        B.fold_scalar(MINTICK, B.binding_constants(symbol=symbol))
    assert "syminfo.mintick" in caught.value.what
    # and fold_bound leaves the node exactly as it was — no partial rewrite
    assert B.fold_bound(MINTICK, B.binding_constants(symbol=symbol)) == MINTICK


def test_two_symbols_two_answers_through_the_injected_table():
    ticks = {"NASDAQ": "0.01", "CME": "0.25"}
    a = B.symbol_constants_with({}, {"ticker": "AAPL", "exchange": "NASDAQ"}, ticks)
    b = B.symbol_constants_with({}, {"ticker": "ES1!", "exchange": "CME"}, ticks)
    assert B.fold_scalar(MINTICK, a) == 0.01
    assert B.fold_scalar(MINTICK, b) == 0.25


@pytest.mark.parametrize("text", ["0x10", "", " 1", "inf", "nan", "1_000", "abc"])
def test_tonumber_accepts_ONE_spelling_and_names_anything_else(text):
    tree = {"type": "textop", "name": "tonumber", "args": [{"type": "str", "value": text}]}
    with pytest.raises(B.NotFoldable) as caught:
        B.fold_scalar(tree, {})
    assert "is not a number" in caught.value.what or text == ""
