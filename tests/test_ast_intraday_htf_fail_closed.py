"""⭐⭐ E101 INTRADAY-HTF (NUMBER PENDING) -- THE PYTHON LANE REFUSES A HIGHER INTRADAY TIMEFRAME READ BY NAME.

`request.security(syminfo.tickerid, "60", x)` above an intraday chart is built in the JS lanes only (the host evaluator
and the runtime lane, `interpret.js::periodStamps`), and only the RUNTIME lane's door writes it (`pine.js::securityAsNode`,
resolver option `intradayHtfReads`, behind `intradayHtfGate.js`). No door this lane evaluates writes a `tf_merge` /
`tf_live` of an intraday code: the member door translates for a daily base, and the server lanes run daily bars.

So this lane is NOT a twin of that build yet, and it must FAIL CLOSED rather than answer: a tree of that shape reaching
it is refused by name (`interpret:timeframe`), never computed on a grid this lane does not hold. ⛔ LIFT CONDITION: a
server path that evaluates an intraday Pine document gets the port of `periodStamps` (its 30 / 60 grid is
`bar_rollup.tv_bucket_bounds`, the one the chart's grid is held to) in the same PR that opens the path.
"""
import pytest

from api.services import ast_interpret as ai

T0 = 1768228200  # 2026-01-12 09:30 New York (EST)
BARS = [{"t": T0 + 900 * i, "o": 1.0, "h": 1.0, "l": 1.0, "c": float(i + 1), "v": 1} for i in range(8)]


@pytest.mark.parametrize("kind", ["tf_merge", "tf_live"])
@pytest.mark.parametrize("code", ["30", "60", "120", "240"])
def test_an_intraday_read_is_refused_by_name(kind, code):
    tree = {"type": kind, "value": code, "args": [{"type": "series", "name": "close"}]}
    with pytest.raises(ai.TableRefusal) as err:
        ai.interpret(tree, BARS, {}, opts={"tf": "15"})
    assert err.value.guard == "interpret:timeframe"
    assert f"'{code}'" in str(err.value)


def test_control_a_weekly_merge_still_computes():
    """⛔ CONTROL: the refusal above is the code, not the node -- a weekly merge of the same bars answers."""
    tree = {"type": "tf_merge", "value": "W", "args": [{"type": "series", "name": "close"}]}
    out = ai.interpret(tree, BARS, {}, opts={"tf": "15", "newestBarIsForming": True})
    assert len(out) == len(BARS)
