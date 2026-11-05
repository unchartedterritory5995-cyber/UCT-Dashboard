"""W9 T0 - the census names a strategy's real wall, read from the script's text.

W9-STRATEGY-DESIGN finding 4: the 11-03 map counted order-placing strategies as transfers because
"places orders" was read from the reference INVENTORY (a name the extract lacks reads as "no orders") against a
second, 5-name copy of the engine's 13-name order set. Pinned here:

  * the order set IS pine.js's STRATEGY_ORDER_CALLS (parsed, never restated);
  * detection reads the script's text, so an inventory without strategy.entry changes nothing;
  * `runtime:strategy-*` and an order strategy's `runtime:no-output` route to W9;
  * the committed-corpus wall counts of tools/pine_coverage/w9_strategy_walls.py.
"""
from __future__ import annotations

import collections
import importlib.util
import os
import re

import pytest

from tools.pine_coverage import coverage_map as cm
from tools.pine_coverage import w9_strategy_walls as w9

_TARGETS = os.path.join(os.path.dirname(cm.__file__), "w0", "targets.py")
_spec = importlib.util.spec_from_file_location("w0_targets_w9t0", _TARGETS)
targets = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(targets)

# the three committed strategies whose orders are entry / exit / cancel only (the 11-03 false transfers)
ENTRY_EXIT_ONLY = [
    "optimized-keltner-channels-sltp-strategy-for-btc__48bc69cf84",
    "tradingview-alerts-to-mt4-mt5-strategy-example__LclqojYSOA",
    "tradingview-alerts-to-mt4-mt5-forex-indices-commodities-stocks-crypto__EqnpYOP7hy",
]


def _src(slug):
    return open(os.path.join(cm.ROOT, "corpus", "committed", slug + ".pine"), encoding="utf-8").read()


def _bare_inventory():
    """A reference extract that lacks every strategy order name (what the 11-03 map's extract did)."""
    return cm.Inventory({"functions": [{"name": "strategy"}, {"name": "plot"}], "variables": [], "constants": [],
                         "types": [], "keywords": [], "annotations": [], "operators": []})


def _pine_js_names():
    txt = open(cm.PINE_JS, encoding="utf-8").read()
    start = txt.index("STRATEGY_ORDER_CALLS")
    block = txt[start:txt.index("]", start)]
    return set(re.findall(r"'(strategy\.[\w.]+)'", block))


def test_the_order_set_is_the_engines_not_a_copy():
    assert cm.STRATEGY_ORDERS == _pine_js_names()
    assert {"strategy.cancel", "strategy.cancel_all", "strategy.risk.max_drawdown"} <= cm.STRATEGY_ORDERS
    assert len(cm.STRATEGY_ORDERS) == 13


def test_the_order_set_follows_the_engine_file(tmp_path):
    f = tmp_path / "pine.js"
    f.write_text("export const STRATEGY_ORDER_CALLS = Object.freeze(new Set(['strategy.entry', 'strategy.zzz']))\n")
    assert cm.engine_order_calls(str(f)) == {"strategy.entry", "strategy.zzz"}


def test_the_order_set_that_cannot_be_read_stops_the_run(tmp_path):
    f = tmp_path / "pine.js"
    f.write_text("export const OTHER = 1\n")
    with pytest.raises(SystemExit):
        cm.engine_order_calls(str(f))


@pytest.mark.parametrize("slug", ENTRY_EXIT_ONLY)
def test_an_order_strategy_never_transfers_whatever_the_inventory_says(slug):
    u = cm.usage_of(_src(slug), _bare_inventory())
    assert not (u["items"] & {"strategy.entry", "strategy.exit"})     # the inventory really lacks them
    assert cm.declaration_of(u) == "strategy" and u["orders"]
    assert cm.places_orders(u) is True
    assert cm.transfers_fully({"clean": True}, u) is False


def test_cancel_alone_is_an_order_call():
    code, _ = cm.strip_code("//@version=5\nstrategy('x')\nif close > open\n    strategy.cancel('a')\n")
    assert cm.order_calls_in(code) == {"strategy.cancel"}


def test_risk_calls_and_spaced_dots_count_and_comments_strings_do_not():
    code, _ = cm.strip_code("strategy('x')\nstrategy . risk . max_drawdown(10, strategy.percent_of_equity)\n"
                            "// strategy.entry('a')\nlabel = 'strategy.exit('\n")
    assert cm.order_calls_in(code) == {"strategy.risk.max_drawdown"}


def test_a_strategy_that_places_no_orders_may_transfer():
    u = cm.usage_of("//@version=5\nstrategy('x')\nplot(close)\n", _bare_inventory())
    assert cm.places_orders(u) is False
    assert cm.transfers_fully({"clean": True}, u) is True


def test_an_indicator_is_never_an_order_strategy():
    u = cm.usage_of("//@version=5\nindicator('x')\nplot(close)\n", _bare_inventory())
    assert cm.places_orders(u) is False


def test_rt_wave_routes_strategy_guards_to_w9():
    assert targets.rt_wave("runtime:strategy-order") == "W9"
    assert targets.rt_wave("runtime:strategy-chart") == "W9"
    assert targets.rt_wave("runtime:no-output", (), True) == "W9"
    assert targets.rt_wave("runtime:no-output", (), False) != "W9"


def test_the_target_lists_read_the_maps_own_placing_flag():
    assert targets.placing_orders({"placesOrders": True, "walls": []}) is True
    assert targets.placing_orders({"placesOrders": False, "walls": ["[strategy]"]}) is False   # no-plot strategy, no orders
    assert targets.placing_orders({"walls": ["[strategy]"]}) is True                           # an old map: the label


def test_strategy_on_block_counts_from_the_rows():
    def row(decl, orders, door, clean):
        return {"declaration": decl, "placesOrders": bool(orders), "_orders": set(orders), "doorClean": door, "clean": clean}
    b = cm.strategy_on_block([row("strategy", {"strategy.entry", "strategy.cancel"}, True, False),
                              row("strategy", {"strategy.entry"}, False, False), row("strategy", set(), True, True),
                              row("indicator", set(), True, True)])
    assert (b["strategies"], b["placingOrders"], b["notPlacingOrders"]) == (3, 2, 1)
    assert b["byCall"] == {"strategy.cancel": 1, "strategy.entry": 2}
    assert (b["doorCleanPlacingOrders"], b["transferringPlacingOrders"]) == (1, 0)
    assert b["orderSet"] == sorted(cm.STRATEGY_ORDERS) and b["wave"] == "W9"


# ---- the walls tool ----------------------------------------------------------------------------------

def _walls(src):
    code, _ = cm.strip_code(src)
    return {k for k, v in w9.walls_of_script(code, cm.version_of(src)).items() if v}


def test_a_v6_strategy_with_no_size_hits_the_percent_default_wall_and_pyramiding():
    assert _walls("//@version=6\nstrategy('x')\nstrategy.entry('l', strategy.long)\n") == {"sizing-percent", "pyramiding-default"}


def test_a_declared_fixed_size_is_not_a_sizing_wall():
    w = _walls("//@version=6\nstrategy('x', default_qty_type=strategy.fixed, default_qty_value=1, pyramiding=2)\n")
    assert "sizing-percent" not in w and "pyramiding-default" not in w


def test_v4_default_quantity_and_percent_declared():
    assert "sizing-v1-v4-default-qty" in _walls("//@version=4\nstrategy('x')\n")
    w = _walls("//@version=4\nstrategy('x', default_qty_type=strategy.percent_of_equity, default_qty_value=10)\n")
    assert "sizing-percent" in w and "sizing-v1-v4-default-qty" not in w


def test_zero_commission_and_slippage_are_not_walls_but_nonzero_are():
    assert not {"commission", "slippage"} & _walls("//@version=5\nstrategy('x', commission_value=0, slippage=0)\n")
    assert {"commission", "slippage"} <= _walls("//@version=5\nstrategy('x', commission_value=0.1, slippage=2)\n")


def test_exit_forms_and_when_and_risk():
    src = ("//@version=5\nstrategy('x')\nstrategy.exit('e', 'l', qty_percent=50, trail_points=10)\n"
           "strategy.close('l', qty=1)\nstrategy.entry('s', strategy.short, when=close > open)\n"
           "strategy.risk.max_drawdown(10, strategy.percent_of_equity)\nstrategy.order('o', strategy.long)\n"
           "strategy.close_all(immediately=true)\n")
    assert {"partial-exit", "trailing", "partial-close", "v5-when", "risk", "order", "close-all-immediately"} <= _walls(src)


def test_qty_percent_100_is_a_whole_exit():
    assert "partial-exit" not in _walls("//@version=5\nstrategy('x')\nstrategy.exit('e', 'l', qty_percent=100)\n")


def test_a_word_in_a_comment_or_string_is_not_a_wall():
    assert "currency" not in _walls("//@version=5\nstrategy('x') // currency=currency.USD\nlabel = 'commission_value=1'\n")


def test_the_walls_rows_carry_no_script_text():
    rows = w9.measure({os.path.join(cm.ROOT, "corpus", "committed", s + ".pine"): "committed" for s in ENTRY_EXIT_ONLY})
    assert len(rows) == 3 and all(r["placesOrders"] for r in rows)
    assert set(rows[0]) == {"key", "population", "version", "sha256", "placesOrders", "orders", "walls", "readbacks"}


def test_committed_corpus_wall_counts_are_pinned():
    pops = w9.gather(os.path.join(cm.ROOT, "corpus", "committed"), None)
    rows = w9.measure(pops)
    assert len(rows) == 25 and all(r["placesOrders"] for r in rows)
    got = collections.Counter(w for r in rows for w in r["walls"])
    assert dict(got) == {
        "sizing-percent": 7, "sizing-v1-v4-default-qty": 9, "currency": 2, "v5-defaults-capital-margin": 3, "risk": 2,
        "v5-when": 5, "order": 1, "oca": 1, "trailing": 1, "commission": 10, "partial-exit": 5, "slippage": 2,
        "partial-close": 2, "calc-on-every-tick": 1, "process-orders-on-close": 2, "close-entries-margin-fill": 1,
        "close-all-immediately": 1, "pyramiding-default": 18}
    s = w9.summarise(rows)
    assert s["readbackScripts"] == {"strategy.position_size": 11, "strategy.position_avg_price": 11, "strategy.opentrades": 2}


def test_measure_reads_stripped_code_not_the_raw_file(tmp_path):
    f = tmp_path / "s.pine"
    f.write_text("//@version=5\nstrategy('x',\n  // note, currency=currency.USD, commission_value=3\n  overlay=true)\n"
                 "strategy.entry('l', strategy.long)\n", encoding="utf-8")
    rows = w9.measure({str(f): "committed"})
    assert len(rows) == 1 and "currency" not in rows[0]["walls"] and "commission" not in rows[0]["walls"]
    g = tmp_path / "i.pine"
    g.write_text("//@version=5\nindicator('x')\nlabel = 'strategy(' + str.tostring(close)\n", encoding="utf-8")
    assert w9.measure({str(g): "committed"}) == []
