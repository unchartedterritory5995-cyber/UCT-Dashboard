"""Server comparison sites with no TradingView capture of their own, railed directly (engine 78 (#1858)):
the state narrowing the range proofs read, and the backtest receipt id that must not serve a Pine replay the
receipt an IEEE replay of the same tree filed. Twin of ``pineCompareSites.test.js``."""
from __future__ import annotations

import pytest

from api.services import ast_interpret as A
from api.services import pine_compare as P

C = 1.0
OFFS = [-3e-10, -2.0000000000000004e-10, -1.0000000000000002e-10, -1e-10, -5e-11, -3e-14, 0.0,
        3e-14, 5e-11, 1e-10, 1.0000000000000002e-10, 2.0000000000000004e-10, 3e-10]
STATES = [C + d for d in OFFS]


@pytest.mark.parametrize("table_name", ["pine", "ieee"])
@pytest.mark.parametrize("op", ["<", "<=", ">", ">="])
@pytest.mark.parametrize("branch", [True, False])
def test_the_state_narrowing_never_drops_a_state_the_run_can_be_in(table_name, op, branch):
    table = A._BINARY_PINE if table_name == "pine" else A._BINARY
    lo, hi = P.compare_narrow(op, branch, STATES[0], STATES[-1], C, table)
    for s in STATES:
        if (table[op](s, C) == 1.0) == branch:
            assert lo <= s <= hi, (s, lo, hi)


def test_the_ieee_narrowing_is_todays():
    assert P.compare_narrow(">", False, 0.0, 2.0, 1.0, A._BINARY) == (0.0, 1.0)
    assert P.compare_narrow(">", False, 0.0, 2.0, 1.0, A._BINARY_PINE) == (0.0, 1.0 + 2 * P.PINE_EQ_EPSILON)


def test_a_pine_backtest_receipt_never_shares_an_ieee_receipt_id():
    from api.routers import screener_backtest as sb
    tree = {"type": "op", "name": ">", "args": [{"type": "series", "name": "close"}, {"type": "num", "value": 1}]}
    args = (tree, ["SPY"], "D", 20240102, 20240301, [5])
    plain = sb.job_id(*args)
    assert sb.job_id(*args, pine_compare={}) == plain           # every non-Pine id is byte-identical
    assert sb.job_id(*args, pine_compare=None) == plain
    pine = sb.job_id(*args, pine_compare={"pineCompare": True})
    assert pine != plain
    assert sb.job_id(*args, pine_compare={"pineCompare": True}) == pine   # and deterministic
