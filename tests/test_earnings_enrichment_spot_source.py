"""`get_implied_move`'s SPOT costs no request of its own any more.

An implied move is a RATIO — `(call mark + put mark) / spot` — so the
numerator and the denominator have to come from the SAME INSTANT. The straddle
was priced by the market against the spot that existed at quote time; a spot
sampled from any other rail, however "fresh", adds skew rather than accuracy.

`get_implied_move` used to OPEN with a `yfinance` daily-history fetch whose only
job was to learn that price — an entire extra Yahoo round-trip per symbol,
before it had fetched anything else, on a function fanned out once per reporting
symbol by both the calendar enrichment sweep and the 7×/weekday preview warmer.
And it was redundant: yfinance's `option_chain()` returns `.underlying` — the
`quote` object Yahoo puts in the SAME HTTP response as the calls and puts.

Rails, each mutation-proven (7/7 mutants killed, control green both sides):

  A. STRUCTURAL, by AST — `get_implied_move`'s own body contains no
     `.history(...)`/`.download(...)` call at all. A behavioural test alone
     would pass on a mocked run, so "the call is gone" has to be read off the
     source tree. The scanner carries a POSITIVE CONTROL: three real functions
     in this module that legitimately still call `.history(` must be detected,
     or the scanner is proving nothing.
  B. STRUCTURAL, by AST — inside `_resolve_spot`, the extra-round-trip rail is
     reached only after the chain's own spot, asserted on node ordering rather
     than on a grep of the text.
  C. BEHAVIOURAL, both directions — a chain that carries `underlying` is priced
     with `.history` wired to EXPLODE; a chain that does not falls back, still
     answers, and is counted + logged.
  D. ARITHMETIC — same spot in, same `{pct, dollar, expiry, strike, spot,
     call_mark, put_mark}` out, to the last decimal. The expected values are
     restated independently here, not copied from the implementation.
  E. Every yfinance call in the module rides the bounded 4-slot valve, so a
     hung Yahoo socket can no longer pin a worker forever.
"""
from __future__ import annotations

import ast
import inspect
import logging
from pathlib import Path
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from api.services import earnings_enrichment as ee


# ── shared fixture: a deterministic option chain ─────────────────────────────

SYM = "SPOTSYM"
EXPIRY = "2026-08-14"

# Strikes straddling the spot used throughout (100.0) so ATM selection is
# unambiguous, plus decoy strikes that must NOT be picked.
_CALLS = pd.DataFrame({
    "strike":    [95.0, 100.0, 105.0],
    "bid":       [7.00,   4.00,  2.00],
    "ask":       [7.40,   4.46,  2.20],
    "lastPrice": [7.20,   4.20,  2.10],
})
_PUTS = pd.DataFrame({
    "strike":    [95.0, 100.0, 105.0],
    "bid":       [1.00,   2.80,  6.00],
    "ask":       [1.20,   3.20,  6.40],
    "lastPrice": [1.10,   3.00,  6.20],
})

# Restated independently of the implementation (rail D):
#   call_mark = (4.00 + 4.46) / 2 = 4.23
#   put_mark  = (2.80 + 3.20) / 2 = 3.00
#   straddle  = 7.23
#   pct       = 7.23 / 100.0 * 100 = 7.23 -> ROUNDED TO 1dp = 7.2
#
# The ask is 4.46 and not a round 4.40 on purpose: with a straddle of 7.20 the
# published `pct` reads 7.2 whether it is rounded to 1dp or 2dp, so this rail
# would not notice the precision changing under it. 7.23 separates them, and the
# gauntlet's `round(pct, 1)` -> `round(pct, 2)` run is what proved the earlier
# fixture could not.
EXPECTED = {
    "pct":       7.2,
    "dollar":    7.23,
    "expiry":    EXPIRY,
    "strike":    100.0,
    "spot":      100.0,
    "call_mark": 4.23,
    "put_mark":  3.0,
}


def _chain(underlying=None):
    c = MagicMock()
    c.calls = _CALLS
    c.puts = _PUTS
    c.underlying = underlying
    return c


def _ticker(underlying=None, history_side_effect=None):
    """A yfinance Ticker double whose OPTIONS half works and whose `.history`
    does whatever the caller wants — by default it BLOWS UP, so any surviving
    spot round-trip is a hard failure rather than a silently-tolerated cost."""
    t = MagicMock()
    t.options = [EXPIRY]
    t.option_chain.return_value = _chain(underlying)
    if history_side_effect is None:
        t.history.side_effect = AssertionError(
            "yfinance .history() was called on the happy path"
        )
    else:
        t.history.side_effect = history_side_effect
    return t


# A chain payload carrying the quote Yahoo ships alongside the marks. Yahoo's
# `quote` object is much wider than this; only `regularMarketPrice` is read.
UNDERLYING = {
    "regularMarketPrice": 100.0,
    "regularMarketPreviousClose": 96.5,
    "postMarketPrice": 108.4,       # must NOT be used: different instant
}


# ─────────────────────────────────────────────────────────────────────────────
# RAIL A — structural: the extra spot round-trip is GONE from the happy path
# ─────────────────────────────────────────────────────────────────────────────

_PRICE_HISTORY_ATTRS = {"history", "download"}


def _module_ast() -> ast.Module:
    src = Path(inspect.getsourcefile(ee)).read_text(encoding="utf-8")
    return ast.parse(src)


def _func_node(name: str) -> ast.FunctionDef:
    for node in ast.walk(_module_ast()):
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{name} not found in {ee.__name__}")


def _price_history_calls(fn: ast.FunctionDef) -> list[ast.Call]:
    """Every `<something>.history(...)` / `<something>.download(...)` call in a
    function body. AST, never a grep: a comment or docstring mentioning
    `t.history(` must not count, and a renamed local must still be caught."""
    return [
        n for n in ast.walk(fn)
        if isinstance(n, ast.Call)
        and isinstance(n.func, ast.Attribute)
        and n.func.attr in _PRICE_HISTORY_ATTRS
    ]


def test_the_scanner_can_actually_see_a_price_history_call():
    """POSITIVE CONTROL for rail A.

    Three REAL functions in this same module still fetch price history on
    purpose — two siblings that legitimately need daily bars, and the fallback
    helper where the original spot call now lives. If the scanner cannot find
    theirs it is proving nothing about `get_implied_move`, and rail A would be
    a gate that cannot fail.
    """
    for name in ("get_pre_earnings_context",
                 "get_historical_earnings_moves",
                 "_spot_from_yfinance"):
        found = _price_history_calls(_func_node(name))
        assert found, f"scanner failed to detect the real .history() call in {name}"


def test_get_implied_move_contains_no_yfinance_price_history_call():
    found = _price_history_calls(_func_node("get_implied_move"))
    assert found == [], (
        "get_implied_move's happy path fetches price history from yfinance "
        f"again (lines {[n.lineno for n in found]}) — spot must come off the "
        "chain response via _resolve_spot"
    )


# ─────────────────────────────────────────────────────────────────────────────
# RAIL B — structural: the extra round-trip is reached only as a fallback
# ─────────────────────────────────────────────────────────────────────────────

def test_resolve_spot_reads_the_chain_before_paying_for_a_round_trip():
    fn = _func_node("_resolve_spot")

    def _first_call_line(callee: str) -> int:
        lines = [
            n.lineno for n in ast.walk(fn)
            if isinstance(n, ast.Call)
            and isinstance(n.func, ast.Name)
            and n.func.id == callee
        ]
        assert lines, f"_resolve_spot never calls {callee}"
        return min(lines)

    assert _first_call_line("_spot_from_chain") < _first_call_line("_spot_from_yfinance"), (
        "the spot that arrived WITH the marks must be preferred over a second "
        "request to a different instant"
    )


def test_spot_is_resolved_after_the_chain_is_fetched():
    """It has to be — the chain is what carries it. Ordering read off the AST."""
    fn = _func_node("get_implied_move")
    chain_calls = [
        n.lineno for n in ast.walk(fn)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
        and n.func.attr == "option_chain"
    ]
    resolve = [
        n.lineno for n in ast.walk(fn)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
        and n.func.id == "_resolve_spot"
    ]
    assert chain_calls and resolve
    assert min(chain_calls) < min(resolve)


# ─────────────────────────────────────────────────────────────────────────────
# RAIL C — behavioural, BOTH directions
# ─────────────────────────────────────────────────────────────────────────────

def test_a_chain_that_carries_its_own_spot_never_pays_for_a_second_request():
    t = _ticker(underlying=UNDERLYING)      # .history raises if called

    with patch("yfinance.Ticker", return_value=t):
        out = ee.get_implied_move(SYM, earnings_date="2026-08-12")

    assert out == EXPECTED
    t.history.assert_not_called()
    t.option_chain.assert_called_once_with(EXPIRY)


def test_the_spot_used_is_the_regular_market_price_from_that_same_payload():
    """Not `postMarketPrice`, not `regularMarketPreviousClose` — those are other
    instants, and the marks were struck against the regular one."""
    assert ee._spot_from_chain(_chain(UNDERLYING)) == 100.0


def test_a_chain_with_no_usable_quote_falls_back_and_is_logged(caplog):
    """The other direction: a payload without `underlying` must DEGRADE to the
    old round-trip, not return None."""
    before = ee.spot_source_counts().get("yfinance_history", 0)
    t = _ticker(
        underlying=None,
        history_side_effect=lambda **kw: pd.DataFrame({"Close": [98.0, 99.0, 100.0]}),
    )

    with caplog.at_level(logging.INFO, logger=ee.__name__):
        with patch("yfinance.Ticker", return_value=t):
            out = ee.get_implied_move(SYM, earnings_date="2026-08-12")

    assert out == EXPECTED                     # a degraded answer, not None
    t.history.assert_called_once()
    assert ee.spot_source_counts().get("yfinance_history", 0) == before + 1
    assert any("fell back to the extra yfinance history call" in r.getMessage()
               for r in caplog.records), (
        "the fallback must be logged so its RATE is visible in production"
    )


def test_the_happy_path_is_counted_as_the_zero_cost_rail():
    before = ee.spot_source_counts().get("option_chain_underlying", 0)
    with patch("yfinance.Ticker", return_value=_ticker(underlying=UNDERLYING)):
        ee.get_implied_move(SYM, earnings_date="2026-08-12")
    assert ee.spot_source_counts().get("option_chain_underlying", 0) == before + 1


def test_both_rails_dry_returns_none_and_never_raises():
    """Fail soft in the same direction as before: None, never an exception."""
    t = _ticker(underlying=None, history_side_effect=RuntimeError("yfinance is down"))
    with patch("yfinance.Ticker", return_value=t):
        assert ee.get_implied_move(SYM, earnings_date="2026-08-12") is None


@pytest.mark.parametrize("quote", [
    None, {}, {"regularMarketPrice": None}, {"regularMarketPrice": 0},
    {"regularMarketPrice": -3.0}, {"regularMarketPrice": ""},
    {"regularMarketPrice": float("nan")}, {"regularMarketPrice": float("inf")},
])
def test_chain_rail_rejects_a_non_price(quote):
    """`nan`/`inf` must not reach `straddle / spot` — that is the documented
    `json.dumps` 500 class this module already carries `_finite_pct` for."""
    assert ee._spot_from_chain(_chain(quote)) is None


# ─────────────────────────────────────────────────────────────────────────────
# RAIL D — the arithmetic is UNCHANGED
# ─────────────────────────────────────────────────────────────────────────────

def test_same_spot_from_either_rail_yields_an_identical_dict():
    """Where spot comes from must not change what the number MEANS."""
    t_yf = _ticker(
        underlying=None,
        history_side_effect=lambda **kw: pd.DataFrame({"Close": [1.0, 2.0, 100.0]}),
    )
    with patch("yfinance.Ticker", return_value=t_yf):
        via_history = ee.get_implied_move(SYM, earnings_date="2026-08-12")

    with patch("yfinance.Ticker", return_value=_ticker(underlying=UNDERLYING)):
        via_chain = ee.get_implied_move(SYM, earnings_date="2026-08-12")

    assert via_chain == via_history == EXPECTED
    # to the last decimal, key by key — not just dict equality by luck
    for k, v in EXPECTED.items():
        assert repr(via_chain[k]) == repr(v), f"{k} drifted: {via_chain[k]!r} != {v!r}"


def test_atm_strike_selection_still_keys_off_the_resolved_spot():
    """Spot is not only the denominator — it also picks the ATM strike.

    104.37, not a round 104.4, so the echoed `spot` pins its own 2dp rounding
    (1dp would read 104.4). Same reason as the 4.46 ask above.
    """
    t = _ticker(underlying={"regularMarketPrice": 104.37})
    with patch("yfinance.Ticker", return_value=t):
        out = ee.get_implied_move(SYM, earnings_date="2026-08-12")

    assert out["strike"] == 105.0       # |105-104.37| beats |100-104.37|
    assert out["spot"] == 104.37
    assert out["call_mark"] == 2.1      # (2.00 + 2.20) / 2
    assert out["put_mark"] == 6.2       # (6.00 + 6.40) / 2
    assert out["dollar"] == 8.3         # 2dp
    assert out["pct"] == 8.0            # 1dp; 2dp would read 7.95


def test_expiry_selection_is_unchanged_by_the_reordering():
    """Spot moved after the chain fetch; expiry choice must not have moved."""
    t = _ticker(underlying=UNDERLYING)
    t.options = ["2026-08-07", EXPIRY, "2026-08-21"]
    with patch("yfinance.Ticker", return_value=t):
        out = ee.get_implied_move(SYM, earnings_date="2026-08-12")
    assert out["expiry"] == EXPIRY                 # first expiry ON/AFTER the report
    t.option_chain.assert_called_once_with(EXPIRY)

    t2 = _ticker(underlying=UNDERLYING)
    t2.options = ["2026-08-07", EXPIRY]
    with patch("yfinance.Ticker", return_value=t2):
        out2 = ee.get_implied_move(SYM, earnings_date=None)
    assert out2["expiry"] == "2026-08-07"          # no date -> front expiry


# ─────────────────────────────────────────────────────────────────────────────
# RAIL E — every yfinance call in this module goes through THE shared guard
#
# This module was the named example in `lesson_from_import_severs_a_module_from_
# _its_guards`: three function-local `import yfinance` statements calling Yahoo
# with no pool, no deadline, and no visibility to the process's rate-limit
# breaker — while being the burstiest yfinance caller in the repo. A PRIVATE
# bounded pool here (which is what this file shipped first) fixes the hang and
# not the 429, because a breaker that only sees a third of the traffic trips a
# third as often. `tests/test_yf_guard_census.py` is the repo-wide rail; these
# are the module-local ones that make the delegation provable in isolation.
# ─────────────────────────────────────────────────────────────────────────────

_YF_CALLERS = ("get_pre_earnings_context",
               "get_historical_earnings_moves",
               "get_implied_move",
               "_spot_from_yfinance")

# Every attribute through which this module can reach Yahoo.
_YF_TOUCH_ATTRS = {"history", "download", "options", "option_chain"}


def test_every_yfinance_touch_in_this_module_rides_the_shared_guard():
    """AST CONTAINMENT census, not "is there a bounded_call somewhere in here".

    The weaker "at least one guarded call exists" form of this test SURVIVED the
    gauntlet's `M9_unbounded_expiries` mutant: `get_implied_move` has two Yahoo
    touches, so un-guarding one left the other to satisfy the assertion. So this
    asserts SET CONTAINMENT — every touch node must sit lexically inside a
    `yf_util.bounded_call(...)` argument — which is what "every call is
    guarded" actually means.
    """
    tree = _module_ast()   # ONE parse: node identity has to be comparable

    for name in _YF_CALLERS:
        fn = next(n for n in ast.walk(tree)
                  if isinstance(n, ast.FunctionDef) and n.name == name)

        scoped: set[int] = set()
        for n in ast.walk(fn):
            if (isinstance(n, ast.Call)
                    and isinstance(n.func, ast.Attribute)
                    and n.func.attr == "bounded_call"
                    and isinstance(n.func.value, ast.Name)
                    and n.func.value.id == "yf_util"):
                for arg in list(n.args) + [k.value for k in n.keywords if k.value]:
                    scoped.update(id(sub) for sub in ast.walk(arg))

        touches = [n for n in ast.walk(fn)
                   if isinstance(n, ast.Attribute) and n.attr in _YF_TOUCH_ATTRS]
        assert touches, f"{name} has no yfinance touch — has this test gone stale?"

        unguarded = [f"{t.attr}@L{t.lineno}" for t in touches if id(t) not in scoped]
        assert not unguarded, (
            f"{name} reaches Yahoo outside yf_util.bounded_call: {unguarded}"
        )


def test_the_ticker_constructor_helper_is_only_ever_called_inside_the_guard():
    """`_ticker_and_expiries` IS the guarded callable, so the containment test
    above cannot cover it — its own body is meant to touch Yahoo directly.
    What has to hold instead is that EVERY call site of it sits inside a
    `yf_util.bounded_call(...)` argument. This is the same shape the repo-wide
    census uses to clear a helper, asserted locally so it cannot regress here
    first.
    """
    tree = _module_ast()

    guarded: set[int] = set()
    for n in ast.walk(tree):
        if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                and n.func.attr == "bounded_call"):
            for arg in list(n.args) + [k.value for k in n.keywords if k.value]:
                guarded.update(id(sub) for sub in ast.walk(arg))

    sites = [n for n in ast.walk(tree)
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
             and n.func.id == "_ticker_and_expiries"]
    assert sites, "_ticker_and_expiries is never called — has this test gone stale?"
    stray = [f"L{n.lineno}" for n in sites if id(n) not in guarded]
    assert not stray, f"_ticker_and_expiries called outside the guard at {stray}"


def test_this_module_owns_no_private_pool_or_breaker():
    """⛔ a fourth pool is the same defect wearing a nicer hat.

    Isolation of THREADS is legitimate and is what `lane="earnings"` is for;
    isolation of POLICY is what makes a 429 invisible to everyone else.
    """
    pools = [
        f"L{n.lineno}" for n in ast.walk(_module_ast())
        if isinstance(n, ast.Call)
        and ((isinstance(n.func, ast.Attribute) and "ThreadPoolExecutor" in n.func.attr)
             or (isinstance(n.func, ast.Name) and "ThreadPoolExecutor" in n.func.id))
    ]
    # `enrich_earnings_response`'s own fan-out pool is a FAN-OUT, not a yfinance
    # valve — it is allowed, and it is the only one.
    assert len(pools) <= 1, f"this module grew a private yfinance pool at {pools}"
    assert not hasattr(ee, "_YF_POOL"), "the private earn-yf pool must be gone"


def test_the_guard_is_reached_through_the_module_not_a_private_copy(monkeypatch):
    """The `from`-import trap, made observable.

    `from api.services.yf_util import bounded_call` binds a PRIVATE copy that
    this monkeypatch cannot reach — so if anyone rewrites the import that way,
    the spy sees zero calls and this fails. That is the exact mechanism by
    which these three call sites escaped the guard originally.
    """
    from api.services import yf_util

    seen = []
    real = yf_util.bounded_call

    def spy(fn, default, *a, **k):
        seen.append(k.get("lane", "default"))
        return real(fn, default, *a, **k)

    monkeypatch.setattr(yf_util, "bounded_call", spy)
    with patch("yfinance.Ticker", return_value=_ticker(underlying=UNDERLYING)):
        assert ee.get_implied_move(SYM, earnings_date="2026-08-12") == EXPECTED

    assert len(seen) == 2, f"expected the expiry + chain fetches to be guarded, saw {seen}"


def test_the_earnings_lane_is_requested_whenever_the_guard_offers_one():
    """Thread isolation without a second guard.

    `yf_util` declares an `earnings` lane specifically for this module's bursts.
    Asserted against the INSTALLED guard's signature so it is a real check under
    either revision — not a branch that quietly passes both ways.
    """
    import inspect as _i
    from api.services import yf_util

    offers_lanes = "lane" in _i.signature(yf_util.bounded_call).parameters
    assert ee._GUARD_KW == ({"lane": "earnings"} if offers_lanes else {})


def test_a_guard_timeout_degrades_get_implied_move_to_none(monkeypatch):
    """The guard returns its `default` on a hang; this module must read that as
    "no data" and fail soft, never raise."""
    from api.services import yf_util
    monkeypatch.setattr(yf_util, "bounded_call",
                        lambda fn, default, *a, **k: default)
    with patch("yfinance.Ticker", return_value=_ticker(underlying=UNDERLYING)):
        assert ee.get_implied_move(SYM, earnings_date="2026-08-12") is None
