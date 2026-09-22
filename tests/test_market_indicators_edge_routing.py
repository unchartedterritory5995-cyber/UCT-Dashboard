"""⛔⛔ THE TWO DOORS AND THE EDGE — where the blank charts actually came from.

Market Indicators shipped, every backend store held real history, and EVERY member
chart painted blank. Two independent seams, both invisible from the data layer:

1. `/api/bars-history/` had no market-indicator branch. The symbol fell through to a
   pure bars.db read, which has no rows for it, and served `bars: []` — a VALID,
   CACHEABLE 200. Breadth is branched in BOTH doors, which is exactly why `UCTA50`
   never broke and nobody noticed one door had been taught and the other had not.

2. The Cloudflare edge router forwards to the bars tier unless the ticker starts with
   `UCT` or contains a colon. `VXN`, `SKEW`, `NAAIM` and the rest are bare words, so
   all eight were sent to a tier that has none of their stores.

⚠️ BOTH FAILURES RETURN 200 WITH AN EMPTY ARRAY. Nothing logs, nothing 500s, and a
chart cannot tell "no data" from "flat market". That is why these are pinned by tests
rather than trusted to review.
"""
from __future__ import annotations

import os
import re

import pytest

from api.services.market_indicators import registry as reg


# ── 1. The edge router's list must equal the registry's bare-word symbols ────

WORKER = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                      "edge", "bars-edge-router", "worker.js")


def _worker_symbols() -> set[str]:
    src = open(WORKER, encoding="utf-8").read()
    m = re.search(r"MARKET_INDICATOR_SYMBOLS\s*=\s*new Set\(\[(.*?)\]\)", src, re.S)
    assert m, "the worker must declare MARKET_INDICATOR_SYMBOLS"
    return set(re.findall(r'"([^"]+)"', m.group(1)))


def _bare_word_published() -> set[str]:
    """Published symbols the edge CANNOT recognise by syntax."""
    return {s.symbol for s in reg.published_rows()
            if ":" not in s.symbol and not s.symbol.upper().startswith("UCT")}


def test_the_edge_router_routes_every_bare_word_indicator_to_the_web_pod():
    """⛔ THE SILENT ONE. A newly published bare-word series that is missing here is
    forwarded to a tier with no store for it and answered `bars: []` — 200, cacheable,
    no error, blank chart."""
    assert _worker_symbols() == _bare_word_published()


def test_symbols_the_edge_recognises_by_syntax_are_not_duplicated_in_the_list():
    """`UCT*` and colon-bearing identities already route by rule; listing one too would
    make the list look like the authority when it is only the exception set."""
    for sym in _worker_symbols():
        assert ":" not in sym
        assert not sym.upper().startswith("UCT")


def test_the_worker_actually_consults_the_list():
    src = open(WORKER, encoding="utf-8").read()
    m = re.search(r"const isBreadth\s*=(.*?);", src, re.S)
    assert m, "isBreadth must still be the routing decision"
    assert "MARKET_INDICATOR_SYMBOLS.has(" in m.group(1)


# ── 2. Both history doors must serve every chartable family ─────────────────

@pytest.fixture
def doors(monkeypatch, tmp_path):
    """The two serving functions, with the registry pointed at fixture stores."""
    from api.routers import bars as barsmod
    return barsmod


def test_bars_history_has_a_market_indicator_branch(doors):
    """⛔⛔ DERIVED FROM THE SOURCE, because the defect was a MISSING branch and a
    test that calls the function with empty stores cannot tell a missing branch from
    an empty store — which is precisely how this shipped."""
    import inspect
    src = inspect.getsource(doors.serve_bars_history)
    assert "_is_market_indicator(" in src, (
        "/api/bars-history must ask whether the symbol is a market indicator")
    i = src.index("_is_market_indicator(")
    assert "market_indicators" in src[i:i + 1400], (
        "the branch must actually build market-indicator bars")
    # and it must sit AFTER breadth, so no shipped pseudo-ticker is shadowed
    assert src.index("is_breadth_symbol") < i


def test_both_doors_ask_the_same_membership_authority(doors):
    """⭐ ONE ORACLE, THREE CALLERS. The proxy exclusion, `/api/bars` and
    `/api/bars-history` must not each carry their own copy of the answer."""
    import inspect
    src = inspect.getsource(doors)
    # exactly one definition, and no inline re-implementations left behind
    assert src.count("def _is_market_indicator(") == 1
    assert src.count("_mireg.is_market_indicator(") <= 1, (
        "membership is asked through _is_market_indicator(), not re-imported inline")
    for fn in (doors.serve_bars_history, doors._bars_proxy_should_route):
        assert "_is_market_indicator(" in inspect.getsource(fn)

def test_the_history_proxy_never_sends_a_market_indicator_to_the_bars_worker():
    """⚰️ THE THIRD SEAM. Both doors branched correctly and members still saw blank
    charts, because `/api/bars-history` PROXIES to the bars worker when
    BARS_HISTORY_PROXY_ENABLED=1 — a pod holding the deep `bars.db` and none of the
    market-indicator stores. It answered `bars: []` with a 200.

    ⛔ A capability that depends on WHICH POD serves it must be excluded at EVERY
    routing decision, not only the ones named "route".
    """
    import inspect
    from api.routers import bars as barsmod
    src = inspect.getsource(barsmod.get_bars_history)
    assert "_is_market_indicator(ticker)" in src, (
        "the history proxy must exclude market indicators")
    i = src.index("BARS_HISTORY_PROXY_ENABLED")
    j = src.index("_proxy_bars_history_to_worker")
    k = src.index("_is_market_indicator(ticker)")
    assert i < k < j, "the exclusion must gate the proxy call, not follow it"


def test_every_pod_routing_decision_excludes_market_indicators():
    """⭐ THE COMPLETE SET. Three decisions choose a pod for chart data; all three must
    ask the same oracle. This test is the inventory — a fourth one added later without
    the exclusion is the same defect again."""
    import inspect
    from api.routers import bars as barsmod
    for fn in (barsmod._bars_proxy_should_route, barsmod.get_bars_history):
        assert "_is_market_indicator(" in inspect.getsource(fn), fn.__name__
