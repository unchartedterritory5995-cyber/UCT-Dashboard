"""GATE-D2 CP4 — the indicator axis. PRD-D2 §9.5, fingerprint 3257cc319.

⛔ Every assertion that could pass vacuously is paired with a control. The axis
is DERIVED, so a rail that merely reads the same derivation back would agree with
itself: the controls below assert against `all_addresses()` and the bars store's
own timeframe map, which are the upstream authorities, not this module's copy.
"""
import pytest

from api.services import alert_series, indicator_alert_evaluator
from api.services.canonical import indicator_axis as ax


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv(ax.FLAG, "1")


# ───────────────────────────────────────────── the declaration is DERIVED

def test_the_axis_declares_exactly_what_the_legacy_lane_enumerates():
    declared = set(ax.declarations())
    legacy = set(indicator_alert_evaluator.all_addresses())
    assert declared == legacy, (
        "the axis and the legacy lane disagree about what exists — "
        f"only-axis={declared - legacy} only-legacy={legacy - declared}")
    assert len(declared) == 31, f"expected 30 indicators + close, got {len(declared)}"


def test_parameter_signatures_come_from_the_compute_not_from_this_module():
    """CONTROL against the upstream authority. If someone hand-typed the params
    here, this fails the moment a compute's signature differs."""
    for address, decl in ax.declarations().items():
        upstream = alert_series.address_inputs(address) or {}
        assert [p["name"] for p in decl["params"]] == list(upstream), address
        assert [p["default"] for p in decl["params"]] == list(upstream.values()), address


def test_the_declaration_is_not_empty():
    """NON-VACUITY. Every assertion above passes over an empty dict."""
    decls = ax.declarations()
    assert decls, "no declarations at all"
    assert any(d["params"] for d in decls.values()), "nothing carries parameters"
    assert any(not d["params"] for d in decls.values()), "nothing is parameterless"


def test_the_one_rename_is_declared_and_lands_somewhere_real():
    assert ax.RENAMES == {"close": "ohlcv.c"}
    assert ax.rename_target_exists(), "`ohlcv.c` is not in the canonical book"
    assert ax.declarations()["close"]["renames_to"] == "ohlcv.c"


def test_the_two_sar_events_yield_bool_not_num():
    d = ax.declarations()
    for a in ("sar.priceCrossedSar", "sar.trendFlipped"):
        assert d[a]["yields"] == "bool", f"{a} is a transition, not a level"
    assert d["rsi"]["yields"] == "num", "control: a level must still be num"


def test_warmup_is_undeclared_and_that_is_not_zero():
    """⛔ No authority in this repo declares an indicator's warmup. `None` says
    so; `0` would claim no warmup is needed, which is false for all thirty."""
    for address, decl in ax.declarations().items():
        assert decl["warmup_bars"] is None, address
        assert decl["warmup_bars"] != 0


# ───────────────────────────────────────────────────── the flag is OFF

def test_the_axis_is_off_by_default(monkeypatch):
    monkeypatch.delenv(ax.FLAG, raising=False)
    assert ax.enabled() is False
    assert ax.resolve("rsi(14)@D")["status"] == ax.DISABLED


def test_control_the_flag_actually_turns_it_on(on):
    """CONTROL — without this, a resolver broken in every case would 'pass'
    the off-by-default test."""
    assert ax.resolve("rsi(14)@D")["status"] == ax.OK


# ───────────────────────────────────────── defaults are NOT implicit

def test_a_parameterised_address_refuses_without_its_parameters(on):
    r = ax.resolve("rsi@D")
    assert r["status"] == ax.MISSING_PARAMS
    assert r["expected"] == ["period"]


def test_the_same_address_resolves_with_them(on):
    r = ax.resolve("rsi(14)@D")
    assert r["status"] == ax.OK
    assert r["params"] == {"period": 14}


def test_a_parameterless_address_takes_no_parens(on):
    """Which addresses these are is DERIVED — `vwap`, `obv`, `bb` and `close`
    have empty signatures, so requiring parens would refuse them forever."""
    for a in ("vwap", "obv", "bb", "close"):
        assert ax.resolve(f"{a}@D")["status"] == ax.OK, a


def test_params_bind_positionally_in_the_declared_order(on):
    r = ax.resolve("macd.histogram(12,26,9)@D")
    assert r["status"] == ax.OK
    assert r["params"] == {"fast": 12, "slow": 26, "signal": 9}


def test_a_non_numeric_parameter_is_refused_not_coerced(on):
    r = ax.resolve("rsi(fourteen)@D")
    assert r["status"] == ax.BAD_PARAMS
    assert r["param"] == "period"


def test_too_many_parameters_is_refused(on):
    assert ax.resolve("rsi(14,7)@D")["status"] == ax.BAD_PARAMS


# ──────────────────────────── ⛔ THE CASE HAZARD: 1m minute vs 1M month

def test_minute_and_month_are_different_timeframes(on):
    """⛔⛔ THE DEFECT THIS RAIL EXISTS FOR. The bars store declares both `1m`
    (one MINUTE) and `1M` (one MONTH). They differ by exactly one bit of case, so
    any `.lower()` on this path silently turns a monthly address into a minute
    one: same address, different series, no error."""
    minute = ax.resolve("rsi(14)@1m")
    month = ax.resolve("rsi(14)@1M")
    assert minute["status"] == ax.OK and month["status"] == ax.OK
    assert minute["timeframe"] == "1", f"1m must be the minute code, got {minute['timeframe']}"
    assert month["timeframe"] == "M", f"1M must be the month code, got {month['timeframe']}"
    assert minute["timeframe"] != month["timeframe"]


def test_control_the_timeframe_map_really_does_carry_both(on):
    """CONTROL. If the store ever stopped declaring both spellings, the test
    above would pass by never exercising the collision."""
    labels = set(ax.timeframe_codes().values())
    assert {"1m", "1M"} <= labels, "the collision case is not in the map any more"


def test_both_the_code_and_the_label_resolve_to_the_code(on):
    assert ax.resolve("rsi(14)@D")["timeframe"] == "D"
    assert ax.resolve("rsi(14)@1D")["timeframe"] == "D"


def test_an_undeclared_timeframe_is_refused(on):
    r = ax.resolve("rsi(14)@4h")
    assert r["status"] == ax.UNKNOWN_TIMEFRAME


# ─────────────────────────────────────── it DESCRIBES, it never computes

def test_resolve_returns_a_descriptor_and_never_a_value(on):
    r = ax.resolve("rsi(14)@D")
    assert r["status"] == ax.OK
    assert callable(r["value_function"]), "the descriptor must hand back the FUNCTION"
    forbidden = {"value", "result", "computed", "series"}
    assert not (forbidden & set(r)), f"the resolver returned a computed thing: {forbidden & set(r)}"
    assert r["source_series"] == "ohlcv" and r["store"] == "bars_sqlite"
    assert "last CLOSED bar" in r["as_of_contract"]


def test_not_computable_is_declared_but_never_returned_by_resolve(on):
    """It is the CALLER's outcome — this module never reads bars, so it cannot
    know. Declaring it keeps `not_computable` distinct from `false`."""
    assert ax.NOT_COMPUTABLE == "not_computable"
    for a in ("rsi(14)@D", "rsi@D", "nope(1)@D", "rsi(14)@4h", "not an address"):
        assert ax.resolve(a)["status"] != ax.NOT_COMPUTABLE


def test_unknown_and_malformed_are_distinct_refusals(on):
    assert ax.resolve("no_such_indicator(1)@D")["status"] == ax.UNKNOWN_METRIC
    assert ax.resolve("rsi(14)")["status"] == ax.MALFORMED
    assert ax.resolve("")["status"] == ax.MALFORMED


def test_every_declared_address_resolves_with_its_own_defaults(on):
    """END TO END over all thirty-one, using each address's OWN derived
    signature -- so this cannot pass by testing only the easy ones."""
    for address, decl in ax.declarations().items():
        args = ",".join(str(p["default"]) for p in decl["params"])
        spelled = f"{address}({args})@D" if args else f"{address}@D"
        assert ax.resolve(spelled)["status"] == ax.OK, spelled
