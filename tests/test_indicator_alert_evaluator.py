"""Unit tests for the indicator-alert evaluator.

Covers:
  1. The pure ``check_condition`` decision function (the spec from plan Task 3
     Step 1 — six cases).
  2. Two end-to-end ``_evaluate_one`` tests with mocked bars that exercise the
     RSI compute → condition match path.
  3. The served catalog (B4 Task 9) and, since B5, the PLOT ADDRESSING scheme
     plus the recorded proof that the eight pre-B5 addresses did not move.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from api.services import indicator_alert_evaluator as evaluator
from api.services.indicator_alert_evaluator import check_condition

_FIXTURES = pathlib.Path(__file__).parent / "fixtures"


# ─── pure condition tests (plan Task 3 Step 1) ───────────────────────────────

# 2026-11-07 (RS fix U1, review #2) -- PIN MOVED. The RS alert catalog and the
# create door now follow `registry_defs.RS_V2_ENABLED` (and, for `rs_line.rating`,
# `api.main.rs_history_enabled()`), dark by default; registration is unchanged.
# The pins in this file describe the LIT shape, so both flags are lit here,
# deterministically. The dark shape is railed in tests/test_rs_fix_u1_alert_lane.py.
@pytest.fixture(autouse=True)
def _rs_alert_flags_lit(monkeypatch):
    from api.services.signature import registry_defs as _rs_flag_defs
    monkeypatch.setattr(_rs_flag_defs, "RS_V2_ENABLED", True)
    import api.main  # noqa: F401 -- import BEFORE lighting RS_SPLIT_ENABLED: api.main registers providers for the split rows, which registry_defs only built if the flag was on at ITS import
    monkeypatch.setattr(_rs_flag_defs, "RS_SPLIT_ENABLED", True)  # 2026-11-10 (RS split, S2): the lit shape includes the split alerts
    monkeypatch.setenv("RS_HISTORY_ENABLED", "1")


def test_rsi_above():
    assert check_condition("above", current=72, prev=65, threshold=70) is True
    assert check_condition("above", current=68, prev=65, threshold=70) is False


def test_rsi_below():
    assert check_condition("below", current=25, prev=35, threshold=30) is True


def test_cross_above_requires_crossing():
    """cross_above triggers only on the bar where price moves from below threshold to above."""
    # Clean cross from below to above
    assert check_condition("cross_above", current=72, prev=65, threshold=70) is True
    # Both above: no cross
    assert check_condition("cross_above", current=72, prev=71, threshold=70) is False
    # Stayed below: no cross
    assert check_condition("cross_above", current=68, prev=65, threshold=70) is False


def test_cross_below():
    # Clean cross from above to below
    assert check_condition("cross_below", current=25, prev=35, threshold=30) is True
    # Both above: no cross
    assert check_condition("cross_below", current=35, prev=40, threshold=30) is False


def test_cross_zero_above():
    assert check_condition("cross_zero", current=0.5, prev=-0.3, threshold=0) is True


def test_unknown_condition_returns_false():
    assert check_condition("bogus", current=70, prev=60, threshold=50) is False


# ─── integration: _evaluate_one with mocked bars ─────────────────────────────

def _ramp_bars(n: int, start: float = 100.0, step: float = 1.0) -> list[dict]:
    """Monotonically rising synthetic bars — guaranteed RSI = 100 once warm.

    The evaluator works in dict-bar form (``h/l/c/v`` keys). For RSI the
    only field that matters is ``c``; we still populate the rest so any
    indicator function we add later can consume the same fixture.
    """
    bars = []
    for i in range(n):
        c = start + i * step
        bars.append({
            "t": i,
            "o": c - 0.1,
            "h": c + 0.2,
            "l": c - 0.2,
            "c": c,
            "v": 1000 + i,
        })
    return bars


def _zigzag_bars(n: int, start: float = 100.0, step: float = 1.0) -> list[dict]:
    """Bars that go up and down, so a shorter RSI period reads differently.

    ⛔ A MONOTONIC RAMP MAKES RSI 100 AT EVERY PERIOD, which makes "RSI(7) and
    RSI(14) are two different alerts" untestable — every period agrees. Any
    fixture for an INSTANCE claim has to separate the instances first.
    """
    bars = []
    price = start
    for i in range(n):
        price += step * (1.0 if (i // 3) % 2 == 0 else -1.4)
        bars.append({"t": 1700000000 + i * 300, "o": price, "h": price + 0.6,
                     "l": price - 0.6, "c": price, "v": 1000 + i})
    return bars


def _falling_bars(n: int, start: float = 100.0, step: float = 1.0) -> list[dict]:
    """Monotonically falling synthetic bars — RSI = 0 once warm."""
    bars = []
    for i in range(n):
        c = start - i * step
        bars.append({
            "t": i,
            "o": c + 0.1,
            "h": c + 0.2,
            "l": c - 0.2,
            "c": c,
            "v": 1000 + i,
        })
    return bars


def _intraday_bars(n: int, start: float = 100.0) -> list[dict]:
    """5-minute bars with REAL unix-second timestamps, spanning two ET sessions.

    VWAP is the reason this exists: it buckets on the ET calendar day resolved
    per instant, so the `t` of a bar has to be a genuine instant rather than the
    `0, 1, 2 …` counter `_ramp_bars` uses. Anchored at 2026-06-10 09:30 ET
    (13:30 UTC, EDT) and running past ET midnight, so the session boundary is
    actually crossed and the accumulator's reset is exercised rather than
    assumed. Prices oscillate so the bands and oscillators all have range to
    work with.
    """
    import math

    t0 = 1781184600  # 2026-06-10 13:30:00 UTC == 09:30 ET (EDT)
    bars = []
    for i in range(n):
        c = start + math.sin(i / 7.0) * 6.0 + i * 0.05
        bars.append({
            "t": t0 + i * 300,
            "o": c - 0.15,
            "h": c + 0.45,
            "l": c - 0.45,
            "c": c,
            "v": 10_000 + (i % 13) * 900,
        })
    return bars


def test_evaluate_one_rsi_above_triggers():
    """RSI > 70 on a monotonic uptrend should trigger an 'above 70' alert."""
    bars = _ramp_bars(40)  # plenty of bars to warm a 14-period RSI
    alert = {
        "id": 1,
        "user_id": 1,
        "sym": "TEST",
        "indicator": "rsi",
        "condition": "above",
        "threshold": 70.0,
        "tf": "D",
        "params_json": None,
        "last_value": None,
    }
    value, triggered = evaluator._evaluate_one(alert, bars=bars,
                                              mode="forming")
    assert value is not None
    # Constant uptrend → RSI saturates at 100.
    assert value == pytest.approx(100.0, abs=0.5)
    assert triggered is True


def test_evaluate_one_rsi_below_threshold_no_trigger():
    """RSI well above 30 should NOT trigger an 'rsi below 30' alert."""
    # Same uptrend → RSI near 100, which is NOT below 30.
    bars = _ramp_bars(40)
    alert = {
        "id": 2,
        "user_id": 1,
        "sym": "TEST",
        "indicator": "rsi",
        "condition": "below",
        "threshold": 30.0,
        "tf": "D",
        "params_json": None,
        "last_value": None,
    }
    value, triggered = evaluator._evaluate_one(alert, bars=bars,
                                              mode="forming")
    assert value is not None
    assert value > 30.0
    assert triggered is False


def test_evaluate_one_rsi_below_triggers_on_downtrend():
    """RSI on a monotonic downtrend saturates at 0 → 'below 30' triggers."""
    bars = _falling_bars(40)
    alert = {
        "id": 3,
        "user_id": 1,
        "sym": "TEST",
        "indicator": "rsi",
        "condition": "below",
        "threshold": 30.0,
        "tf": "D",
        "params_json": None,
        "last_value": None,
    }
    value, triggered = evaluator._evaluate_one(alert, bars=bars,
                                              mode="forming")
    assert value is not None
    assert value == pytest.approx(0.0, abs=0.5)
    assert triggered is True


def test_evaluate_one_unknown_indicator_returns_none():
    """Unknown indicator names short-circuit to (None, False)."""
    bars = _ramp_bars(40)
    alert = {
        "id": 4,
        "user_id": 1,
        "sym": "TEST",
        "indicator": "fictional",
        "condition": "above",
        "threshold": 50.0,
        "tf": "D",
        "params_json": None,
        "last_value": None,
    }
    value, triggered = evaluator._evaluate_one(alert, bars=bars,
                                              mode="forming")
    assert value is None
    assert triggered is False


def test_evaluate_one_empty_bars_returns_none():
    """No bars in store → graceful (None, False), no exception."""
    alert = {
        "id": 5,
        "user_id": 1,
        "sym": "TEST",
        "indicator": "rsi",
        "condition": "above",
        "threshold": 70.0,
        "tf": "D",
        "params_json": None,
        "last_value": None,
    }
    value, triggered = evaluator._evaluate_one(alert, bars=[])
    assert value is None
    assert triggered is False


# ─── THE CATALOG — the dropdown's twin, collapsed (B4 Task 9) ────────────────
#
# `IndicatorAlertPopover.jsx` used to hand-write INDICATORS (8 entries) and
# CONDITIONS (a per-indicator map). They were a TWIN of `INDICATOR_FUNCS` and
# they already disagreed with reality: the create path validates nothing at any
# of its three layers (the router types `indicator` as a bare `str`, the service
# inserts it verbatim, the DDL is `TEXT NOT NULL` with no CHECK), so a `vwap`
# alert can be STORED and can never FIRE — `_evaluate_one` returns (None, False)
# on an `INDICATOR_FUNCS` miss, and no surface reports it.
#
# Deriving the catalog from the dict is what makes the OFFER unrepresentable.
# It does not, and is not meant to, validate the create path: spec §8 rebuilds
# this evaluator in Phase C and §9.5 forbids an eager port, so `INDICATOR_FUNCS`
# stays hand-written and is fated 'C' in the enumeration ledger.


def _implemented_conditions() -> set[str]:
    """Which condition strings `check_condition` can actually answer YES to.

    ⚠️ DERIVED BY PROBE, NEVER HAND-WRITTEN. A literal list here would be a
    third copy of the same vocabulary — exactly the twin this task retires —
    and it would agree with `ALERT_CONDITIONS` by construction instead of by
    evidence. `check_condition` returns False for an unknown condition, so a
    condition that fires for SOME input is one the evaluator implements.
    """
    probes = [
        # (current, prev, threshold)
        (10.0, None, 5.0),    # above, touch_upper
        (1.0, None, 5.0),     # below, touch_lower
        (10.0, 1.0, 5.0),     # cross_above
        (1.0, 10.0, 5.0),     # cross_below
        (1.0, -1.0, None),    # cross_zero (up)
        (-1.0, 1.0, None),    # cross_zero (down)
    ]

    def fires(cond: str) -> bool:
        return any(check_condition(cond, c, p, t) for c, p, t in probes)

    offered = {
        c["value"]
        for e in evaluator.alert_catalog()
        for p in e["plots"]
        for c in p["conditions"]
    }
    return {c for c in offered if fires(c)}


def _catalog_addresses() -> list[str]:
    """Every PLOT ADDRESS the catalog can produce, in served order.

    ⚠️ `entry["indicator"]` IS NOT AN ADDRESS for a grouped indicator — `adx`,
    `donchian` and `ichimoku` are group names with no value function behind
    them. Reading the group id as the thing to store is the exact mistake that
    would create an alert which can never fire, so the tests below go through
    `plots[].value` and never through `indicator`.
    """
    return [p["value"] for e in evaluator.alert_catalog() for p in e["plots"]]


def test_catalog_offers_exactly_what_can_be_evaluated():
    """⭐ THREE PARTITIONS SINCE TASK 10, AND THE UNION IS THE OFFER.

    `INDICATOR_FUNCS` holds addresses that name a LEVEL; `EVENT_FUNCS` holds
    addresses that name a `{0, 1, None}` column; `PRICE_FUNCS` holds the bar's
    own close. They are separate because the questions are (`_SAR_IS_NOT_A_THRESHOLD`)
    and because the frozen replay grid iterates the first one (`_series_close`),
    and the catalog is their union.

    ⛔ MOVED DOWN A LEVEL WHEN THE HAND-WRITTEN DICT RETIRED. This used to name
    the two tables by hand, so the day a THIRD partition arrived it would have
    kept passing while covering less — which is how a rail rots green. It reads
    `ADDRESS_PARTITIONS` now, so a fourth partition is in scope the moment it
    exists, and the count below is what makes "somebody deleted a partition from
    that tuple" fail rather than shrink quietly.
    """
    ev = evaluator
    addresses = _catalog_addresses()
    # 2026-11-10 (RS split, S2): the three Mansfield addresses stay registered (so
    # `all_addresses()` holds them) and are WITHHELD from the offer; the rest is the offer.
    assert set(addresses) == set(ev.all_addresses()) - set(_ars.RS_WITHHELD_ADDRESSES)
    assert set(_ars.RS_WITHHELD_ADDRESSES) <= set(ev.all_addresses())
    # …and no address is served twice, which a grouping bug could do silently.
    assert len(addresses) == len(set(addresses))
    # …and the partitions are pairwise DISJOINT, or "which table answers for
    # this address" would depend on lookup order rather than on what it names.
    seen: set[str] = set()
    for partition in ev.ADDRESS_PARTITIONS:
        assert not (seen & set(partition)), "an address is in two partitions"
        seen |= set(partition)
    # ⛔ NON-VACUITY: the tuple really holds the three, and each is non-empty.
    # `ADDRESS_PARTITIONS = ()` satisfies every line above.
    assert len(ev.ADDRESS_PARTITIONS) == 5  # 2026-11-04: +1 `ma_cross` (CROSS); 2026-11-06 (RS 2b-05): +1 `rs_line.*` (RS)
    assert all(len(p) for p in ev.ADDRESS_PARTITIONS)
    assert seen == (set(ev.INDICATOR_FUNCS) | set(ev.EVENT_FUNCS) | set(ev.PRICE_FUNCS)
                    | set(ev.CROSS_FUNCS) | set(ev.RS_FUNCS))


def test_a_group_name_is_never_mistaken_for_an_address():
    """The three grouped indicators expose no value function under the bare base.

    This is the shape of the original defect turned inward: if `adx` (the group)
    were storable, the popover could submit it and the alert would be accepted
    and never fire — which is precisely the class B5 exists to close, re-opened
    inside the fix.
    """
    grouped = [e for e in evaluator.alert_catalog() if len(e["plots"]) > 1]
    assert grouped, "nothing is grouped — the plot selector pins nothing"
    for entry in grouped:
        if entry["indicator"] in evaluator.INDICATOR_FUNCS:
            # A legacy base like `macd` IS an address; then it must be plots[0],
            # never some other plot, or the bare spelling changed meaning.
            assert entry["plots"][0]["value"] == entry["indicator"], (
                f'{entry["indicator"]}: the bare address is no longer its first plot'
            )
        else:
            assert entry["indicator"] in evaluator.ALERT_BASE_LABELS, (
                f'{entry["indicator"]} is neither an address nor a declared group name'
            )


def test_every_catalog_condition_is_one_the_evaluator_implements():
    implemented = _implemented_conditions()
    for entry in evaluator.alert_catalog():
        for plot in entry["plots"]:
            for cond in plot["conditions"]:
                assert cond["value"] in implemented, (
                    f'{plot["value"]}/{cond["value"]} is offered and not implemented'
                )


def test_the_implemented_probe_is_not_vacuous():
    """A probe grid that fires for everything would make the test above pass on
    a condition the evaluator has never heard of."""
    assert _implemented_conditions(), "the probe found nothing — the grid is broken"
    assert not any(
        check_condition("no_such_condition", c, p, t)
        for c, p, t in [(10.0, 1.0, 5.0), (1.0, 10.0, 5.0), (1.0, -1.0, None)]
    )


def test_catalog_labels_are_not_ids():
    """A dropdown showing `williams_r`, or `adx.plusDI`, leaked a key."""
    for e in evaluator.alert_catalog():
        assert e["label"] != e["indicator"]
        assert e["label"].strip()
        for p in e["plots"]:
            assert p["label"] != p["value"], f'{p["value"]} renders its own address'
            assert p["label"].strip()


def test_every_catalog_entry_offers_at_least_one_condition():
    """An indicator with no conditions renders an empty second dropdown and an
    un-submittable form."""
    for e in evaluator.alert_catalog():
        assert e["conditions"], f'{e["indicator"]} offers no condition'
        assert e["plots"], f'{e["indicator"]} offers no plot'
        for p in e["plots"]:
            assert p["conditions"], f'{p["value"]} offers no condition'


def test_the_entry_level_fields_mirror_the_first_plot():
    """The back-compat contract, asserted rather than trusted.

    A client written before B5 reads `conditions` / `default_threshold` off the
    ENTRY and never looks at `plots`. For all eight pre-B5 indicators `plots[0]`
    IS the legacy address, so that client must still read exactly what it read
    before — which only holds while these mirror.
    """
    for e in evaluator.alert_catalog():
        assert e["conditions"] == e["plots"][0]["conditions"]
        assert e["default_threshold"] == e["plots"][0]["default_threshold"]
        # …and it is a COPY, not the same list object: five addresses share one
        # condition list, so a consumer that mutated what it was handed would
        # otherwise edit every entry that shares it.
        assert e["conditions"] is not e["plots"][0]["conditions"]


def test_shared_condition_lists_are_handed_out_as_copies():
    a, b = evaluator.alert_catalog(), evaluator.alert_catalog()
    for ea, eb in zip(a, b):
        for pa, pb in zip(ea["plots"], eb["plots"]):
            assert pa["conditions"] == pb["conditions"]
            assert pa["conditions"] is not pb["conditions"]


def test_adding_a_value_function_without_a_condition_list_fails_loudly():
    """A ninth indicator with no conditions has to fail HERE, at the catalog,
    not in a second dropdown that renders empty."""
    alertable = set(evaluator.all_addresses())
    assert alertable <= set(evaluator.ALERT_CONDITIONS)
    assert set(evaluator.ALERT_CONDITIONS) <= alertable
    # …and every address is LABELLED too. A missing label renders the raw
    # address in the dropdown, which is not a crash and is exactly why nothing
    # ever caught one.
    assert alertable <= set(evaluator.ALERT_LABELS)


def test_needs_threshold_is_declared_per_condition_not_guessed():
    """The popover used to keep its own THRESHOLD_CONDITIONS set. The served
    entry carries the flag, and a threshold-taking condition must declare it.

    ⭐ PHASE C GENERALISED THE RULE INSTEAD OF ADDING AN EXCEPTION TO IT. A
    condition asks the USER for a number exactly when the operand grammar has
    nothing DECLARED for (address, condition). `bb`'s touches were the one
    pre-existing case and they satisfied this by accident — `touch_upper` is not
    in the threshold-taking set at all — so writing the rule as a hand-listed set
    would have kept working while meaning something narrower than it says. The
    two SAR event addresses are the first case where the declaration is what
    makes the flag False, which is what makes the rule observable.
    """
    threshold_taking = {"above", "below", "cross_above", "cross_below"}
    declared = 0
    for e in evaluator.alert_catalog():
        for p in e["plots"]:
            for c in p["conditions"]:
                has_operand = (p["value"], c["value"]) in evaluator.THRESHOLD_OPERAND
                declared += 1 if has_operand else 0
                assert isinstance(c["needs_threshold"], bool)
                assert c["needs_threshold"] is (
                    c["value"] in threshold_taking and not has_operand
                ), f'{p["value"]}/{c["value"]} declares the wrong threshold need'
    assert declared, (
        "no offered condition has a declared operand — the `and not has_operand` "
        "clause is unreachable and this rule is the old hand-listed set again")


# ─── B5: THE SEVEN THAT COULD NOT BE ALERTED ON ──────────────────────────────

def test_a_vwap_alert_can_now_actually_fire():
    """⭐ THE HEADLINE GATE, AS BEHAVIOUR.

    `vwap` was the named example of the defect: creatable through the API,
    accepted by the DDL, offered by nothing, and — the part a dropdown change
    could not fix — impossible to evaluate, because this lane runs in PYTHON and
    `indicator_compute` had no `compute_vwap`. It has one now.

    Asserted in BOTH directions: the alert is offered, and an armed one produces
    a real number and TRIGGERS. A test that only checked "it appears in the
    catalog" would pass on a catalog entry with no working value function behind
    it, which is the same class of lie.
    """
    assert "vwap" in _catalog_addresses()

    bars = _intraday_bars(120)
    alert = {
        "id": 99, "user_id": 1, "sym": "TEST", "indicator": "vwap",
        "condition": "above", "threshold": 1.0, "tf": "5",
        "params_json": None, "last_value": None,
    }
    value, triggered = evaluator._evaluate_one(alert, bars=bars,
                                              mode="forming")
    assert value is not None, "vwap still computes nothing — the gap is not closed"
    assert triggered is True
    # …and the number is the VWAP of those bars, not some other column that
    # happens to be non-None: it sits inside the traded range.
    assert min(b["l"] for b in bars) <= value <= max(b["h"] for b in bars)

    # The other direction, so "always fires" cannot be what makes this green.
    alert["threshold"] = 1e9
    _, triggered_high = evaluator._evaluate_one(alert, bars=bars)
    assert triggered_high is False


def test_a_DAILY_vwap_alert_answers_NOTHING_rather_than_a_number_from_1970():
    """🟢 THE 1970 ANCHOR, ASSERTED WHERE A USER MEETS IT.

    `tests/test_indicator_compute.py` measures the compute. This measures the
    LANE: a row exactly as `indicator_alerts` stores one, evaluated through the
    shipped `_evaluate_one`, on bars shaped exactly as `_fetch_bars_for_alert`
    returns them for `tf="D"` — `t` is the store's `YYYYMMDD` INT, because
    `bars_sqlite`'s own docstring says daily rows are keyed that way and the
    fetch passes the key through verbatim (deliberately: `bar_close_epoch` reads
    that encoding).

    Before the fix this returned a real-looking price computed from a single
    "session" that began on **1970-08-23**, and `triggered` was decided from it.
    A member could have been emailed about it. Now the value is `None`, the cycle
    records nothing, and nothing is delivered.

    ⚠️ THE CONTROL IS THE POINT — WITHOUT IT THIS PASSES ON A BROKEN VWAP. The
    SAME CLOSES with intraday timestamps still produce a real number, so what is
    being asserted is that the UNIT is refused, not that VWAP stopped working.
    """
    closes = [100.0 + (i % 7) for i in range(60)]

    def row(t, c):
        return {"t": t, "o": c, "h": c + 1.0, "l": c - 1.0, "c": c, "v": 10_000}

    def alert(tf):
        return {"id": 99, "user_id": 1, "sym": "TEST", "indicator": "vwap",
                "condition": "above", "threshold": 1.0, "tf": tf,
                "params_json": None, "last_value": None}

    # THE DEFECT'S INPUT: 60 consecutive trading-ish days as YYYYMMDD ints.
    import datetime as _dt
    day = _dt.date(2026, 1, 2)
    daily = []
    for c in closes:
        daily.append(row(int(day.strftime("%Y%m%d")), c))
        day += _dt.timedelta(days=1)
    value, triggered = evaluator._evaluate_one(alert("D"), bars=daily)
    assert value is None, (
        f"a daily vwap alert produced {value!r}. Every bar's `t` here is a "
        f"YYYYMMDD int, which read as unix seconds is 1970 — so whatever that "
        f"number is, it is not a VWAP.")
    assert triggered is False

    # THE CONTROL: same closes, real 5-minute instants → a real number that
    # triggers. So the refusal above is about the encoding and nothing else.
    intraday = [row(1785410100 + i * 300, c) for i, c in enumerate(closes)]
    value_5, triggered_5 = evaluator._evaluate_one(alert("5"), bars=intraday)
    assert value_5 is not None and triggered_5 is True
    assert min(b["l"] for b in intraday) <= value_5 <= max(b["h"] for b in intraday)


def test_all_seven_previously_unalertable_definitions_are_reachable():
    """The gap, closed and counted.

    ⭐ ALL SEVEN NOW, WHICH IS THE PHASE C DELTA. B5 reached six of them and
    deferred `sar` because the two meaningful SAR questions are RELATIONAL and
    this lane had one bb-only relational primitive. The grammar is built, so
    `sar` is reachable — but only through the two EVENT addresses, never through
    a level. The test below is where that narrower claim lives.
    """
    addresses = set(_catalog_addresses())
    bases = {evaluator.plot_base(a) for a in addresses}
    for definition in ("vwap", "atr", "adx", "obv", "donchian", "ichimoku", "sar"):
        assert definition in bases, f"{definition} still cannot be alerted on"


@pytest.mark.parametrize("address", [
    "vwap", "atr", "obv",
    "adx.adx", "adx.plusDI", "adx.minusDI",
    "donchian.upper", "donchian.middle", "donchian.lower",
    "ichimoku.tenkan", "ichimoku.kijun", "ichimoku.spanA", "ichimoku.spanB",
    "ichimoku.chikou",
    "macd.signal", "macd.histogram", "stoch.d",
    "bb.upper", "bb.middle", "bb.lower",
])
def test_every_new_address_produces_a_number(address):
    """No new address may be an offer that cannot fire — the original defect.

    ⛔ THE CLAIM IS ABOUT THE COLUMN, SO IT IS DRIVEN THROUGH THE FORMING LANE.
    The closed-lane version of the same question has a DIFFERENT and measured
    answer — `ichimoku.chikou` is displaced 26 bars and has no value at the bar
    the closed lane judges — and it lives in the test below rather than being
    smuggled in here as a parametrize exception.
    """
    value, _ = evaluator._evaluate_one(
        {
            "id": 1, "user_id": 1, "sym": "TEST", "indicator": address,
            "condition": "above", "threshold": -1e12, "tf": "5",
            "params_json": None, "last_value": None,
        },
        bars=_intraday_bars(160),
        mode="forming",
    )
    assert value is not None, f"{address} is offered and computes nothing"


def test_on_the_CLOSED_lane_exactly_one_offered_address_produces_nothing():
    """⭐ THE CUTOVER'S ONE CASUALTY, AS A CENSUS OVER THE WHOLE CATALOG.

    The rail above says every offered address computes SOMETHING on the forming
    lane. The shipped lane is the closed one, and there the same census has one
    exception — so it is measured here, not asserted as an exception up there,
    and the expected set is DERIVED from the same measurement the create-path
    gate uses rather than typed.

    ⚠️ AN ADDRESS THAT JOINS THAT SET IN FUTURE FAILS HERE FIRST, which is the
    point: it would be a new indicator that is offered and can never fire.
    """
    from api.services import indicator_alert_service as ias
    bars = _intraday_bars(160)
    silent = set()
    for address in sorted(evaluator.all_addresses()):
        # 2026-11-06 (RS 2b-05) — the RS partition is EXCLUDED from this
        # forming-shaped call on purpose: an RS address is offered on closed
        # daily / weekly bars only and REFUSES a 5-minute timeframe by type
        # (`RsTimeframeRefused`; at the door, `refusal_for`), so on these
        # intraday bars it is not "silent", it is not offered. Its own census —
        # every RS address answers a value on the closed lane on daily bars —
        # is `test_every_rs_address_answers_a_value_on_the_closed_lane_on_daily_bars`.
        if address in evaluator.RS_ADDRESSES:
            continue
        value, _, _i = evaluator._evaluate_one_closed(
            {
                "id": 1, "user_id": 1, "sym": "TEST", "indicator": address,
                "condition": "above", "threshold": -1e12, "tf": "5",
                "params_json": None, "last_value": None,
            },
            bars,
            now_epoch=bars[-1]["t"] + 10_000,
        )
        if value is None:
            silent.add(address)

    assert silent == {"ichimoku.chikou"}, silent
    assert silent == set(ias.closed_lane_dead_addresses()), (
        "the census and the create-path gate disagree about which addresses the "
        "closed lane cannot answer — one of them is refusing the wrong thing")
    # the non-vacuity floor: the loop really did drive the whole catalog (minus
    # the eleven RS addresses it skips by declaration, counted here).
    assert len(evaluator.all_addresses()) == 48  # 2026-11-10 (RS split, S2): 44 -> 48, +rs_phases.flipBlue/flipRed +rs_vs_ema.crossUp/crossDown; 2026-11-07 (RS 2b-06): +1 rs_line.rating; 2026-11-04: +1 `ma_cross`; 2026-11-06 (RS 2b-05): +11 `rs_line.*`
    assert len(evaluator.RS_ADDRESSES) == 16  # 2026-11-07 (RS 2b-06): +rs_line.rating; 2026-11-10 (RS split, S2): +4 split


def test_every_plot_address_resolves_to_the_column_it_names():
    """⛔ THE OFF-BY-ONE GATE.

    The new value functions select a column by INDEX out of a multi-output
    compute. A swapped index still returns a real, plausible number, so no
    "did it compute something" test can see it — including the one directly
    above. These are ordering invariants a swap has to violate.
    """
    bars = _intraday_bars(160)

    def val(address, params=None):
        v, _ = evaluator._evaluate_one(
            {
                "id": 1, "user_id": 1, "sym": "TEST", "indicator": address,
                "condition": "above", "threshold": -1e12, "tf": "5",
                "params_json": None if params is None else json.dumps(params),
                "last_value": None,
            },
            bars=bars, mode="forming",
        )
        assert v is not None, f"{address} computed nothing"
        return v

    # Bands: upper >= middle >= lower, by construction. Swap any two and it breaks.
    assert val("donchian.upper") >= val("donchian.middle") >= val("donchian.lower")
    assert val("bb.upper") >= val("bb.middle") >= val("bb.lower")

    # A pure uptrend makes -DM zero on every bar ⇒ -DI is exactly 0 while +DI is
    # not, and ADX saturates at 100. Three distinct values, so no pair can swap.
    rising = _ramp_bars(80)

    def rising_val(address):
        v, _ = evaluator._evaluate_one(
            {
                "id": 1, "user_id": 1, "sym": "TEST", "indicator": address,
                "condition": "above", "threshold": -1e12, "tf": "D",
                "params_json": None, "last_value": None,
            },
            bars=rising, mode="forming",
        )
        return v

    assert rising_val("adx.minusDI") == 0.0
    assert rising_val("adx.plusDI") > 0.0
    assert rising_val("adx.adx") == pytest.approx(100.0, abs=1e-6)

    # On a monotonic rise the 9-bar mid sits above the 26-bar mid, which sits
    # above the 52-bar mid — so tenkan > kijun > spanB, and spanA is their mean.
    t = rising_val("ichimoku.tenkan")
    k = rising_val("ichimoku.kijun")
    b = rising_val("ichimoku.spanB")
    a = rising_val("ichimoku.spanA")
    assert t > k > b
    assert a == pytest.approx((t + k) / 2, abs=1e-6)
    # Chikou is a close from 26 bars ahead of where it is plotted, so on a rising
    # series its LAST published value is above every one of those three.
    assert rising_val("ichimoku.chikou") > t

    # MACD's histogram is the line minus the signal (to the delivery rounding).
    assert val("macd.histogram") == pytest.approx(
        val("macd") - val("macd.signal"), abs=1e-4,
    )


def test_a_camelcase_plot_address_survives_the_evaluator_s_case_folding():
    """⛔ THE BUG THIS TASK ALMOST SHIPPED INTO ITS OWN FIX.

    `_evaluate_one` has always lowercased the stored `indicator`. On the eight
    legacy keys that is a no-op, so it was invisible for the life of the module.
    The engine spells its plots `plusDI` / `spanA`, and `"adx.plusDI".lower()` is
    not a key — so four brand-new addresses were OFFERED AND COULD NEVER FIRE,
    which is verbatim the defect B5 exists to close.

    Both directions: the canonical spelling works, and so does a mangled-case
    version of it, because the create path validates nothing and will store
    whatever it is handed.
    """
    bars = _intraday_bars(160)

    def value_for(stored):
        v, _ = evaluator._evaluate_one(
            {
                "id": 1, "user_id": 1, "sym": "TEST", "indicator": stored,
                "condition": "above", "threshold": -1e12, "tf": "5",
                "params_json": None, "last_value": None,
            },
            bars=bars,
        )
        return v

    canonical = value_for("adx.plusDI")
    assert canonical is not None, "the camelCase address does not resolve"
    assert value_for("ADX.PLUSDI") == canonical
    assert value_for("adx.plusdi") == canonical
    # …and it is genuinely +DI, not -DI arriving via a fold collision.
    assert value_for("adx.minusDI") != canonical


def test_no_two_addresses_collide_when_case_is_folded():
    """Resolution folds case, so two addresses differing only in case would make
    one of them permanently unreachable — silently, and in favour of whichever
    was declared last."""
    lowered = [a.lower() for a in evaluator.INDICATOR_FUNCS]
    assert len(lowered) == len(set(lowered)), (
        f"two plot addresses collide once lowercased: "
        f"{[a for a in lowered if lowered.count(a) > 1]}"
    )
    # …and the map really covers every address, so none falls through to the
    # raw-lowercase branch and misses.
    for address in evaluator.INDICATOR_FUNCS:
        assert evaluator.resolve_address(address) == address


def test_sar_has_no_fixed_threshold_address_and_says_why():
    """SAR is alertable now — by EVENT, never by a fixed level.

    ⭐ MOVED DOWN A LEVEL, NOT DELETED. Its predecessor
    (`test_sar_is_deliberately_not_offered_and_says_why`) asserted `sar` was
    absent from `INDICATOR_FUNCS` AND that the written reason was still present.
    The absence claim NARROWED — SAR has two event addresses now — but the REASON
    did not change one word: a stop level that jumps to the other side of price
    at every flip names no trading event at a fixed number. So the prose survives
    beside the narrower refusal, and this still refuses to let a threshold entry
    be added without someone reading it.

    ⚠️ WITH A POSITIVE CONTROL. `assert "sar" not in THRESHOLD_ADDRESSES` is also
    satisfied by a tree where SAR went back to being un-alertable entirely — the
    exact state this task left behind — so the two event addresses are asserted
    in the same breath.
    """
    from api.services import indicator_compute

    # The compute is really there — this is a naming decision, not a gap.
    sar, trend = indicator_compute.compute_sar(_ramp_bars(40))
    assert any(v is not None for v in sar)
    assert set(v for v in trend if v is not None) <= {1.0, -1.0}

    # ── the refusal, narrowed to FIXED-THRESHOLD addressing ──
    assert "sar" not in evaluator.THRESHOLD_ADDRESSES
    assert "sar" not in {evaluator.plot_base(a) for a in evaluator.THRESHOLD_ADDRESSES}
    assert "jumps" in evaluator._SAR_IS_NOT_A_THRESHOLD
    assert "relational" in evaluator._SAR_IS_NOT_A_THRESHOLD
    assert "markers" in evaluator._SAR_IS_NOT_A_THRESHOLD

    # ── the positive control ──
    assert "sar.trendFlipped" in evaluator.EVENT_ADDRESSES
    assert "sar.priceCrossedSar" in evaluator.EVENT_ADDRESSES
    assert {evaluator.plot_base(a) for a in evaluator.EVENT_ADDRESSES} == {"sar"}
    # …and they are OFFERED, not merely declared: a table nothing reads would
    # satisfy the two lines above while the dropdown showed nothing.
    offered = set(_catalog_addresses())
    assert {"sar.trendFlipped", "sar.priceCrossedSar"} <= offered
    # …and no OFFERED sar address takes a user-typed threshold, which is the
    # refusal restated where a user could actually reach it.
    for entry in evaluator.alert_catalog():
        for plot in entry["plots"]:
            if evaluator.plot_base(plot["value"]) != "sar":
                continue
            assert plot["default_threshold"] is None
            for cond in plot["conditions"]:
                assert cond["needs_threshold"] is False, (
                    f'{plot["value"]}/{cond["value"]} asks the user for a SAR level')


def test_the_sar_event_addresses_produce_a_zero_one_column_and_fire_on_it():
    """⛔ THE OFFER MUST BE ABLE TO FIRE — the `vwap` defect, one more time.

    A declared event address that computes nothing is an alert a user can arm
    that never tells them anything, which is the class this whole programme has
    been closing. Both directions: a bar where the event happened triggers, a bar
    where it did not does not, and the column really is `{0, 1}`.
    """
    from api.services import indicator_compute

    bars = _intraday_bars(200)
    crossed, flipped = indicator_compute.compute_sar_events(bars)
    assert len(crossed) == len(bars) and len(flipped) == len(bars)
    assert set(v for v in crossed if v is not None) <= {0.0, 1.0}
    assert set(v for v in flipped if v is not None) <= {0.0, 1.0}
    assert any(v == 1.0 for v in flipped), (
        "the oscillating fixture never flips trend — this proves nothing")

    def evaluate_at(address, upto):
        return evaluator._evaluate_one(
            {
                "id": 1, "user_id": 1, "sym": "TEST", "indicator": address,
                "condition": "above", "threshold": None, "tf": "5",
                "params_json": None, "last_value": None,
            },
            bars=bars[:upto],
        )

    fired = [i for i, v in enumerate(flipped) if v == 1.0 and i > 60]
    quiet = [i for i, v in enumerate(flipped) if v == 0.0 and i > 60]
    assert fired and quiet, "the column is constant — one direction is untestable"

    value, triggered = evaluate_at("sar.trendFlipped", fired[0] + 1)
    assert (value, triggered) == (1.0, True)
    value, triggered = evaluate_at("sar.trendFlipped", quiet[0] + 1)
    assert (value, triggered) == (0.0, False)
    # ⚠️ AND `0.0` IS NOT `None`. `_evaluate_one` short-circuits on None, and a
    # falsy-vs-None slip here would silently drop every "did not happen" bar,
    # taking `record_evaluation`'s write-back with it.
    assert value is not None

    # The other event resolves too, and through the camelCase fold.
    assert evaluate_at("sar.priceCrossedSar", 200)[0] is not None
    assert evaluate_at("SAR.PRICECROSSEDSAR", 200)[0] is not None


def test_an_unknown_address_is_still_accepted_and_still_never_fires():
    """The create path is STILL not validated, and that is unchanged by B5.

    Both halves matter: an address the dict has never heard of is a silent no-op
    (so an existing bad row behaves exactly as before), and the popover reports
    such a row as "cannot fire". Closing the create hole is Phase C's.
    """
    value, triggered = evaluator._evaluate_one(
        {
            "id": 99, "user_id": 1, "sym": "TEST", "indicator": "not_an_indicator",
            "condition": "above", "threshold": 1.0, "tf": "D",
            "params_json": None, "last_value": None,
        },
        bars=_ramp_bars(60),
    )
    assert (value, triggered) == (None, False)
    # …and a BASE that is only a group name behaves the same way, so the popover
    # submitting `entry.indicator` by mistake would be inert, not wrong.
    value, triggered = evaluator._evaluate_one(
        {
            "id": 98, "user_id": 1, "sym": "TEST", "indicator": "ichimoku",
            "condition": "above", "threshold": 1.0, "tf": "D",
            "params_json": None, "last_value": None,
        },
        bars=_ramp_bars(60),
    )
    assert (value, triggered) == (None, False)


# ─── PHASE C: the operand grammar, where `_evaluate_one` reads it ────────────

def test_a_malformed_operand_is_loud_at_the_boundary_not_a_silent_no_fire():
    """⛔ IT RAISES OUT OF `_evaluate_one`, AND THAT IS THE DESIGN.

    Every other failure in this function is absorbed into `(None, False)` — the
    right answer for a short bar window. A malformed OPERAND is not that: it is a
    bug in a declaration, and swallowing it would produce an alert that is
    offered and can never fire, which is verbatim the `vwap` defect reached from
    a new direction. The declaration is read OUTSIDE the compute try/except so
    the raise reaches the cycle's per-alert handler, which logs and counts it.
    """
    bars = _ramp_bars(60)
    alert = {
        "id": 1, "user_id": 1, "sym": "TEST", "indicator": "rsi",
        "condition": "above", "threshold": 70.0, "tf": "D",
        "params_json": None, "last_value": None,
    }
    # The control: unmutated, this evaluates cleanly. The lane is pinned
    # because `_ramp_bars` numbers its `t` 0, 1, 2 - a counter, not a bar
    # clock - so `bar_close_epoch` cannot resolve it and the closed lane
    # declines the window entirely, which is the safe direction and not what
    # this test is about.
    assert evaluator._evaluate_one(dict(alert), bars=bars,
                                   mode="forming")[0] is not None

    original = dict(evaluator.THRESHOLD_OPERAND)
    evaluator.THRESHOLD_OPERAND[("rsi", "above")] = {"kind": "vibes"}
    try:
        with pytest.raises(ValueError, match="unknown operand kind"):
            evaluator._evaluate_one(dict(alert), bars=bars, mode="forming")
    finally:
        evaluator.THRESHOLD_OPERAND.clear()
        evaluator.THRESHOLD_OPERAND.update(original)
    assert evaluator.THRESHOLD_OPERAND == original


def test_the_dynamic_threshold_is_a_table_lookup_and_not_a_bb_branch():
    """The non-measurement half of the retirement, read off the SOURCE.

    ⚠️ COMMENT-STRIPPED, WITH THE RAW TEXT AS ITS CONTROL. The retired name and
    the old branch both survive in TOMBSTONE PROSE on purpose (a deleted
    mechanism nobody can find the reason for gets rebuilt), so a raw `in` probe
    would report the retirement incomplete forever. The claim is about CODE.
    """
    import re

    src = pathlib.Path(evaluator.__file__).read_text(encoding="utf-8")
    body = src.split("def _evaluate_one")[1].split("\ndef ")[0]
    code = "\n".join(
        line for line in body.splitlines()
        if not line.lstrip().startswith("#")
    )
    # The control: the tombstone prose IS still there, in the comments, so this
    # is measuring the difference between code and prose rather than absence.
    assert '_bb_threshold_override' in body
    assert re.search(r'indicator\s*==\s*"bb"', body)
    # …and neither survives in the CODE.
    assert '_bb_threshold_override' not in code
    assert not re.search(r'indicator\s*==\s*"bb"', code)
    assert "threshold_operand_value(" in code

def test_the_retired_override_is_gone_from_every_lane_that_bound_it():
    """⚰️ PHASE C TASK 5: THE RETIREMENT IS FINISHED, AND THIS IS THE RAIL.

    Task 3 moved the band arithmetic into `THRESHOLD_OPERAND` but kept
    `_bb_threshold_override` alive as a two-line delegation, because two files
    outside the evaluator bound the NAME directly — `tools/alert_replay.py` and
    `tests/test_alert_replay.py`, both of them the frozen fire log's own
    instrument — and deleting it in that commit would have broken the `--check`
    being used to prove that commit safe. This task owns `alert_replay.py`, so
    both binders were re-pointed and the symbol was deleted.

    ⚠️ AST, NOT TEXT, AND WITH A CONTROL. The tombstone PROSE deliberately still
    names it (a deleted mechanism nobody can find the reason for gets rebuilt),
    so a raw `in` probe would report the retirement incomplete forever. The
    claim is that no CODE anywhere defines it, calls it, or reads it as an
    attribute.
    """
    import ast

    roots = [pathlib.Path(evaluator.__file__).parent.parent,          # api/
             pathlib.Path(__file__).parent,                           # tests/
             pathlib.Path(__file__).parent.parent / "tools"]
    scanned = 0
    prose_hits = 0
    offenders: list[str] = []
    for root in roots:
        for path in sorted(root.rglob("*.py")):
            text = path.read_text(encoding="utf-8")
            if "_bb_threshold_override" not in text:
                continue
            prose_hits += 1
            scanned += 1
            tree = ast.parse(text)
            for node in ast.walk(tree):
                if isinstance(node, ast.FunctionDef) and node.name == "_bb_threshold_override":
                    offenders.append(f"{path}: still DEFINES it")
                if isinstance(node, ast.Attribute) and node.attr == "_bb_threshold_override":
                    offenders.append(f"{path}:{node.lineno} still READS it")
                if isinstance(node, ast.Name) and node.id == "_bb_threshold_override":
                    offenders.append(f"{path}:{node.lineno} still NAMES it")
    assert not offenders, (
        "`_bb_threshold_override` survives in CODE, not just in prose:\n"
        + "\n".join(offenders))
    # The control: the name IS still present as text somewhere, so this test is
    # measuring the code/prose difference rather than passing on a tree where
    # every mention — tombstone included — was scrubbed and nothing recorded why.
    assert prose_hits > 0, (
        "the retired name appears nowhere at all, not even in a tombstone. That "
        "makes this scan vacuous AND loses the reason the mechanism was removed.")
    assert scanned > 0


def test_the_operand_table_is_the_only_place_a_relation_is_declared():
    """Every declared pair must name an address the catalog actually offers, and
    a condition that address actually offers — a row pointing at neither is a
    relation nobody can reach, which is the un-fireable-offer shape inverted."""
    offered = {p["value"]: {c["value"] for c in p["conditions"]}
               for e in evaluator.alert_catalog() for p in e["plots"]}
    assert evaluator.THRESHOLD_OPERAND, "no relation is declared at all"
    for (address, condition), spec in evaluator.THRESHOLD_OPERAND.items():
        if address in _ars.RS_WITHHELD_ADDRESSES:
            # 2026-11-10 (RS split, S2): withheld from the offer, still evaluating -- the
            # row must stay so a stored alert keeps its declared operand.
            assert address not in offered
            continue
        assert address in offered, f"{address} is declared and not offered"
        assert condition in offered[address], (
            f"{address}/{condition} is declared and the address does not offer it")
        assert spec["kind"] in evaluator.OPERAND_KINDS
        if spec["kind"] == "address":
            assert spec["address"] in evaluator.INDICATOR_FUNCS, (
                f'{spec["address"]} is the right-hand side of a relation and is '
                "not an address that can be computed")


def test_a_line_can_now_be_compared_to_another_line():
    """⭐ WHAT THE GRAMMAR UNLOCKED, AS A NUMBER.

    MACD-vs-its-signal-LINE was refused for exactly the reason `sar` was — one
    bb-only relational primitive. It is EXPRESSIBLE now and costs one row, which
    this proves by resolving it rather than by asserting a comment. (It is
    deliberately not OFFERED yet; see the `macd` note in `ALERT_CONDITIONS`.)
    """
    bars = _intraday_bars(200)
    signal = evaluator.address_value("macd.signal", bars, {})
    line = evaluator.address_value("macd", bars, {})
    assert signal is not None and line is not None and signal != line

    resolved = evaluator.resolve_operand(
        {"kind": "address", "address": "macd.signal"}, bars, {},
        evaluator.address_value,
    )
    assert resolved == signal
    # …and the relation answers a real question: the line is above its signal
    # exactly when `check_condition` says so against the resolved operand.
    assert check_condition("above", line, None, resolved) is (line > signal)
    assert check_condition("below", line, None, resolved) is (line < signal)


# ─── the served route (B4 Task 9) ────────────────────────────────────────────

def test_catalog_route_is_registered_and_auth_gated():
    """A route that is not mounted answers 200 SPA HTML, not 404, so 'the
    endpoint works' has to be checked against the ROUTE TABLE, not a request.

    ⚠️ INTROSPECTED, NEVER PROBED. `lesson_never_probe_a_mutating_endpoint_to_test_auth`:
    the dependency is read off `route.dependant` rather than by issuing a request.
    """
    from api.routers import indicator_alerts as router_mod
    from api.middleware.auth_middleware import get_current_user

    routes = [
        r for r in router_mod.router.routes
        if getattr(r, "path", None) == "/api/indicator-alerts/catalog"
    ]
    assert len(routes) == 1, "the catalog route is not mounted exactly once"
    route = routes[0]
    assert "GET" in route.methods
    deps = [d.call for d in route.dependant.dependencies]
    assert get_current_user in deps, "the catalog is an enumeration of internals — gate it"
    # ⚠️ THE HANDLER IS HANDED A USER NOW, BECAUSE THE CATALOG IS SERVED SCOPED:
    # `alert_catalog(user_id)` APPENDS that account's own formulas to the global
    # groups. This called `route.endpoint()` with NO arguments, which worked only
    # while the handler ignored its dependency. An EMPTY id is the account-less
    # case by construction — `alert_user_series.user_catalog` returns `[]` for a
    # falsy id without touching the definitions store — so this still asserts
    # exactly what it always asserted: the GLOBAL enumeration, served verbatim.
    # The scoped half has its own rail in `tests/test_alert_user_router.py`.
    #
    # ⭐ AND THE RESPONSE NOW CARRIES A SECOND KEY: `refusals`, the read-out that
    # says why a member's saved formula is NOT among the offerings (the alert
    # half of `918e3c8a`). It is asserted as its own clause rather than folded
    # into a whole-dict equality, so this case keeps meaning "the catalog half is
    # the untouched global enumeration" — which is the claim it was written for —
    # while a third key added later still fails it. `[]` for an account-less
    # caller, by the same "falsy id reaches no store" rule as the line above.
    body = route.endpoint(user={"id": ""})
    assert body["catalog"] == evaluator.alert_catalog()
    assert body["refusals"] == []
    assert set(body) == {"catalog", "refusals"}


def test_the_catalog_route_is_declared_before_any_id_route_that_could_swallow_it():
    """`/catalog` would be parsed as an `alert_id` by a `GET /{alert_id}`
    declared above it. There is no such route today; this fails if one is added
    in front of it rather than after."""
    from api.routers import indicator_alerts as router_mod

    paths = [getattr(r, "path", "") for r in router_mod.router.routes]
    catalog_at = paths.index("/api/indicator-alerts/catalog")
    for i, r in enumerate(router_mod.router.routes):
        path = getattr(r, "path", "")
        if i < catalog_at and "{alert_id}" in path and "GET" in getattr(r, "methods", set()):
            raise AssertionError(f"{path} is declared before /catalog and will swallow it")


def test_catalog_order_is_the_dropdown_order_and_it_did_not_change():
    """The catalog's order IS the order of the `<select>`.

    Pinned against the order the RETIRED `IndicatorAlertPopover.INDICATORS`
    literal shipped, so collapsing the twin moved nothing a user sees. It is
    also the only observable difference between `INDICATOR_FUNCS` and
    `ALERT_CONDITIONS` — their key SETS are asserted equal above, so a catalog
    built by iterating the wrong dict is invisible to every set comparison and
    visible only here.

    ⭐ B5 APPENDS, IT DOES NOT REORDER. The first eight entries are still the
    eight that shipped, in the order they shipped, so an existing user's dropdown
    opens on the same option it always did and every option they already knew is
    where it was. The six new groups follow.
    """
    served = [e["indicator"] for e in evaluator.alert_catalog()]
    assert served[:8] == [
        "rsi", "macd", "bb", "stoch", "williams_r", "cci", "mfi", "price_vs_ma",
    ]
    # ⭐ AND PHASE C APPENDS TOO. `sar` is last because the catalog walks the
    # LEVEL table and then the EVENT table, so neither the eight nor the six
    # moved when the fifteenth group arrived.
    #
    # ⚠️ THIS LITERAL IS UNCHANGED BY TASK 10 AND THAT IS THE POINT — the
    # retirement replaced a hand-written dict with a DERIVATION, and a
    # derivation that walked the registry would have produced the registry's
    # order, not this one. The slice is the only edit: `close` is a SIXTEENTH
    # group appended after `sar`, by the same append-never-reorder rule the
    # docstring above states, and the seven names below are byte-identical.
    assert served[8:15] == [
        "vwap", "atr", "adx", "obv", "donchian", "ichimoku", "sar",
    ]
    # 2026-11-04: `ma_cross` is a SEVENTEENTH group, appended after `close`.
    # 2026-11-06 (RS 2b-05): `rs_line` is an EIGHTEENTH group, appended after `ma_cross`.
    # 2026-11-10 (RS split, S2): `rs_phases` and `rs_vs_ema` are the NINETEENTH and TWENTIETH groups.
    assert served[15:] == ["close", "ma_cross", "rs_line", "rs_phases", "rs_vs_ema"]
    # …and the three legacy multi-plot bases still open on their legacy address,
    # so the pre-selected plot is the one the bare spelling has always meant.
    by_base = {e["indicator"]: e for e in evaluator.alert_catalog()}
    for base in ("macd", "bb", "stoch"):
        assert by_base[base]["plots"][0]["value"] == base
    assert list(evaluator.ALERT_CONDITIONS) != list(evaluator.INDICATOR_FUNCS), (
        "the two dicts fell into the same order — 'which one is iterated' just "
        "became unobservable, and the mutation that swaps them is now equivalent"
    )


# ─── B5: THE EIGHT PRE-B5 ADDRESSES DID NOT MOVE ─────────────────────────────
#
# B5 widened `INDICATOR_FUNCS` from 8 keys to a set of PLOT ADDRESSES so the
# seven engine definitions that could never be alerted on (vwap, atr, sar,
# ichimoku, adx, obv, donchian) became reachable. The gate on that work is that
# an alert a user armed BEFORE the change fires exactly when it fired before.
#
# ⛔ AN IDENTITY CHECK IS NOT THAT PROOF. `INDICATOR_FUNCS['rsi'] is _value_rsi`
# stays green through a change to `indicator_compute`'s delivery rounding, to a
# helper both lanes share, or to `_evaluate_one`'s threshold plumbing — all of
# which move the NUMBER a user's threshold is compared against. So the numbers
# themselves are the oracle: `tests/fixtures/indicator_alert_baseline.json` was
# recorded by `tests/fixtures/_gen_alert_baseline.py` from the tree as it stood
# BEFORE the change, and this replays every row.
#
# ⚠️ EXACT EQUALITY, NEVER approx. Half a unit in the last place is precisely
# what flips a comparison at a boundary, which is the regression this exists to
# catch; a tolerance here would wave through the one defect it is aimed at.

def _load_alert_baseline() -> dict:
    path = _FIXTURES / "indicator_alert_baseline.json"
    assert path.exists(), (
        "the pre-B5 alert baseline is missing. It cannot be regenerated from the "
        "current tree — that would re-record whatever the code now does."
    )
    return json.loads(path.read_text(encoding="utf-8"))


# ─── THE ONE ADDRESS WHOSE RECORDED VALUE MOVED, AND EXACTLY WHY ─────────────
#
# `price_vs_ma` is `close − MA(period)`. `indicator_compute.compute_sma` used to
# compute that MA with a ROLLING SUBTRACT-AND-ADD accumulator while
# `ast_interpret`'s `sma`, `interpret.js`'s `windowMean` and
# `StockChart.computeSMA` all RE-SUM the full window — two Python implementations
# of one value, disagreeing on 89.8% of bars, and the armed-alert lane was on the
# minority one. So an armed `price > 50-day` alert was compared against a number
# the chart never drew: on **CAN 2025-12-09, close 0.96**, the rolling lane's
# MA20 came out `0.9599999999999987` ("above") where the re-sum lane gives exactly
# `0.96` ("not above"), and **GETY's 50/200 golden cross moved a whole session**.
# The re-sum survived — it is what the frozen conformance digests pin and it is
# the more accurate of the two against exact rational arithmetic.
#
# Measured on THIS grid: 336 of the 504 `price_vs_ma` rows moved (the two
# `type: sma` param sets; the `type: ema` set is untouched), by at most
# **2.904e-13 relative**, and **zero of the 5,040 recorded `triggered` booleans
# changed**.
#
# ⛔ THE BASELINE FILE IS NOT RE-RECORDED, NOT ONE BYTE. Re-recording replaces an
# oracle with a photograph of whatever the code now does, and this file's own
# loader says so.
#
# ⭐ SO THE ROW IS PINNED HARDER, NOT LOOSER. For `price_vs_ma` the assertion is
# no longer "the number is unchanged" but "the number changed by EXACTLY the
# retired accumulator's drift and by nothing else": the RECORDED value must
# reproduce BIT FOR BIT under the retired algorithm, and the CURRENT value must
# reproduce BIT FOR BIT under the surviving one. A tolerance would wave through
# any small change; this admits exactly one, names its cause, and still fails on
# a rounding change, a period change, a plumbing change — or on a silent revert
# to the rolling lane, which would make the two halves swap and both fail.

_DRIFTED_ADDRESS = "price_vs_ma"


def _retired_rolling_sma(closes, period):
    """The rolling subtract-and-add SMA `indicator_compute.compute_sma` carried
    until the numeric-columns fix. It lives HERE, in the test that proves what it
    did, and NOWHERE in `api/**` — `tests/test_single_authority_rails.py` reads
    the product source with an AST and fails by name if it reappears there.
    """
    n = len(closes)
    out = [None] * n
    if period <= 0 or n < period:
        return out
    window_sum = sum(closes[:period])
    out[period - 1] = window_sum / period
    for i in range(period, n):
        window_sum += closes[i] - closes[i - period]
        out[i] = window_sum / period
    return out


def _surviving_resum_sma(closes, period):
    """The full-window re-sum SMA that survived — written HERE, independently of
    the product, so "the current value is the re-sum lane's" is a statement this
    file can make on its own rather than one it borrows from the code under test.
    """
    n = len(closes)
    out = [None] * n
    if period <= 0 or n < period:
        return out
    for i in range(period - 1, n):
        total = 0.0
        for j in range(i - period + 1, i + 1):
            total += closes[j]
        out[i] = total / period
    return out


def _value_under_sma(impl, fn, bars, params):
    """`fn(bars, params)` computed with `impl` swapped in as the SMA.

    ⚠️ The attribute is rebound on the MODULE, and `alert_series` resolves
    `indicator_compute.compute_sma` at call time, so the swap is genuinely seen
    (`lesson_from_import_severs_a_module_from_its_guards`, read the other way
    round: a `from … import` there would have made this control unable to fail).
    """
    from api.services import indicator_compute
    live = indicator_compute.compute_sma
    indicator_compute.compute_sma = impl
    try:
        return fn(bars, params)
    finally:
        indicator_compute.compute_sma = live


def _value_mismatch(row, value, fn, bars, params):
    """``None`` when this row's value is what it must be, else why it is not.

    Every address but `price_vs_ma` is byte-identical to the recording. That one
    is pinned to its CAUSE instead — see the block above. Both legs are exact:

      * the RECORDING must reproduce under the retired rolling-subtract SMA, and
      * the CURRENT value must reproduce under the surviving full-window re-sum.

    The `type: ema` rows satisfy both trivially (neither SMA is consulted), which
    is why they are not special-cased: they never moved and they still must not.
    """
    if row["indicator"] != _DRIFTED_ADDRESS:
        return None if value == row["value"] else (
            f"got {value!r} want {row['value']!r}")
    was = _value_under_sma(_retired_rolling_sma, fn, bars, params)
    now = _value_under_sma(_surviving_resum_sma, fn, bars, params)
    if row["value"] != was:
        return (f"the RECORDING no longer reproduces under the retired "
                f"rolling-subtract SMA: recorded {row['value']!r}, that lane "
                f"gives {was!r} — the delta is NOT the accumulator swap")
    if value != now:
        return (f"the current value {value!r} is not the full-window re-sum's "
                f"{now!r} — compute_sma is neither lane this row knows about")
    return None


# ⭐ PHASE C TASK 5: THE BASELINE IS SPLIT — DOWN A LEVEL, NEVER WEAKENED.
#
# The recorded row is `(indicator, params, condition, threshold, prev) →
# (value, triggered)`, and the composition it measures is
#
#     value  ∘  prev-supply  ∘  condition
#
# Phase C changes exactly ONE of those three: WHO SUPPLIES `prev`. The forming
# lane takes it from the alert row (`last_value`, written by the previous poll);
# the closed lane takes it from `series[i-1]`. So the premise of the middle
# factor is about to go — and a test whose premise is gone is deleted or
# weakened, which is how a 5,040-row oracle quietly stops being one.
#
# It is split into its two PURE halves instead, and the split is STRICTER, not
# looser, for four reasons that are each checkable:
#
#   1. The two unchanged factors are now asserted SEPARATELY. A composition can
#      hide compensating errors — a value that moved up and a condition that got
#      looser reproduce the same `triggered`; two separate equalities cannot.
#      The composed form asserts 5,040 `triggered` booleans and 5,040 values;
#      the split form asserts the same 5,040 values plus 5,040 condition
#      decisions taken against the RECORDED value, which is a strictly finer
#      partition of the same evidence.
#   2. The value half now measures `value_function(address)` DIRECTLY, which is
#      the function BOTH lanes compute through. The composed form only ever
#      reached it via `_evaluate_one`, i.e. only ever covered the forming lane.
#      The same rows now guard the closed lane too.
#   3. The condition half calls `check_condition` directly with the recorded
#      `prev`, so it survives the cutover unchanged and keeps pinning the exact
#      function Task 3's M5 found a hole in. That hole (`cross_above`'s `>` → `>=`)
#      is measure-zero on these rows by construction — a computed float landing
#      exactly on a round threshold — which is why it is pinned AT equality in
#      `tests/test_alert_conditions.py::test_every_comparison_in_check_condition_is_pinned_AT_the_boundary`
#      and NOT here. The split does not touch that test and does not pretend to
#      replace it.
#   4. The composed form is KEPT as well, and pinned to the forming lane
#      EXPLICITLY (`mode="forming"`) rather than to whatever the global constant
#      happens to say. Before this task it would have silently started measuring
#      the closed lane the day Task 8 flips `ALERT_EVAL_MODE`; now it measures
#      the forming lane forever, and Task 8 cannot make it vacuous by accident.
#
# Net: every assertion that existed still runs, two more halves run beside it,
# and one of them was previously mode-dependent and now is not.

def test_the_eight_legacy_addresses_evaluate_identically():
    """Every recorded (value, triggered) reproduces, bit for bit — FORMING lane.

    ⚠️ `mode="forming"` IS EXPLICIT AND THAT IS THE POINT. This row's `prev` is a
    SUPPLIED `last_value`, which is the forming lane's mechanism and only the
    forming lane's. Reading the mode from the global would make this test change
    meaning underneath itself at the cutover; naming it keeps this an exact,
    permanent statement about the lane it was recorded from.
    """
    doc = _load_alert_baseline()
    bars = doc["bars"]
    mismatches = []
    for i, row in enumerate(doc["rows"]):
        alert = {
            "id": 1, "user_id": "u", "sym": "TEST", "tf": "D",
            "indicator": row["indicator"],
            "condition": row["condition"],
            "threshold": row["threshold"],
            "params_json": None if row["params"] is None else json.dumps(row["params"]),
            "last_value": row["prev"],
        }
        value, triggered = evaluator._evaluate_one(alert, bars=bars, mode="forming")
        why = _value_mismatch(
            row, value,
            evaluator.value_function(evaluator.resolve_address(row["indicator"])),
            bars, row["params"] or {})
        # ⛔ `triggered` STAYS BYTE-EXACT FOR ALL 5,040 ROWS, `price_vs_ma`
        # INCLUDED. The SMA correction moved 336 VALUES by at most 2.9e-13 and
        # flipped NOT ONE of these booleans; the day one flips, that is a
        # user-visible change in when an armed alert fires and this must say so.
        if why is not None or triggered != row["triggered"]:
            mismatches.append(
                f"row {i} {row['indicator']}/{row['condition']} thr={row['threshold']} "
                f"prev={row['prev']} params={row['params']}: "
                f"{why or ''} got triggered={triggered!r} want {row['triggered']!r}"
            )
    assert not mismatches, (
        f"{len(mismatches)} of {len(doc['rows'])} recorded evaluations changed. An alert a "
        f"user already armed would fire differently.\n" + "\n".join(mismatches[:12])
    )


def test_the_eight_legacy_addresses_still_compute_identical_VALUES():
    """Half one: `value` is a pure function of (bars, params, address) and must
    NEVER move. 5,040 rows, exact equality, no `approx`.

    ⚠️ EXACT, NEVER approx — half a unit in the last place is precisely what
    flips a comparison at a boundary, which is the regression this exists to
    catch, so a tolerance here would wave through the one defect it is aimed at.

    This is the half that outlives the mode. `value_function(address)` is what
    both lanes compute through, so these 5,040 numbers now guard the closed lane
    as well as the forming one — which the composed form never did.
    """
    doc = _load_alert_baseline()
    bars = doc["bars"]
    mismatches = []
    for i, row in enumerate(doc["rows"]):
        address = evaluator.resolve_address(row["indicator"])
        fn = evaluator.value_function(address)
        assert fn is not None, f"row {i}: address {address!r} no longer resolves"
        value = fn(bars, row["params"] or {})
        why = _value_mismatch(row, value, fn, bars, row["params"] or {})
        if why is not None:
            mismatches.append(f"row {i} {row['indicator']} params={row['params']}: {why}")
    assert not mismatches, (
        f"{len(mismatches)} of {len(doc['rows'])} recorded VALUES changed. Every "
        f"armed alert on these eight addresses is now compared against a "
        f"different number.\n" + "\n".join(mismatches[:12])
    )


def test_the_eight_legacy_CONDITIONS_still_decide_identically():
    """Half two: `check_condition(condition, value, prev, threshold)` is pure and
    is called DIRECTLY with the recorded `prev`. Also exact, also forever.

    ⛔ THE SPLIT IS NOT A WEAKENING AND THE ARGUMENT IS THE BLOCK ABOVE. The
    original test was `value` ∘ `prev-supply` ∘ `condition`. Two of those three
    are unchanged and are asserted at full strength — separately, so neither can
    mask the other. The third — WHO SUPPLIES `prev` — is the only thing this
    phase changes, and it is measured by the repaint oracle, which is a STRICTER
    instrument than a grid of hand-picked `prev` values because it derives `prev`
    from the bars themselves and then asks whether the answer depended on when
    you looked.

    ⚠️ THE DECLARED OPERAND IS RESOLVED HERE TOO, or the two `bb` touch
    conditions would be compared against `None` and 630 rows would agree
    vacuously (`check_condition` returns False for a `None` threshold, and the
    recorded `triggered` for a non-firing row is also False).
    """
    doc = _load_alert_baseline()
    bars = doc["bars"]
    mismatches = []
    dynamic_rows = 0
    for i, row in enumerate(doc["rows"]):
        address = evaluator.resolve_address(row["indicator"])
        params = row["params"] or {}
        threshold = row["threshold"]
        dyn = evaluator.threshold_operand_value(address, row["condition"], bars, params)
        if dyn is not None:
            threshold = dyn
            dynamic_rows += 1
        triggered = evaluator.check_condition(
            row["condition"], row["value"], row["prev"], threshold)
        if triggered != row["triggered"]:
            mismatches.append(
                f"row {i} {row['indicator']}/{row['condition']} thr={threshold!r} "
                f"value={row['value']!r} prev={row['prev']!r}: "
                f"got {triggered!r} want {row['triggered']!r}"
            )
    assert not mismatches, (
        f"{len(mismatches)} of {len(doc['rows'])} recorded DECISIONS changed.\n"
        + "\n".join(mismatches[:12])
    )
    # …and the declared-operand path was genuinely exercised, so the `bb` rows
    # are not passing because everything resolved to the same `None`.
    assert dynamic_rows > 0, (
        "no row resolved a declared operand — the two `bb` touch conditions were "
        "compared against a None threshold and agreed vacuously"
    )


def test_both_halves_of_the_split_baseline_can_actually_fail():
    """⛔ THE SPLIT'S OWN CONTROL. Two halves that cannot fail are not a split,
    they are a deletion with extra steps.

    The value half is broken by re-pointing an address (the same control the
    composed form has always had, applied to the half that replaced it); the
    condition half is broken by flipping the recorded `prev`, which is the input
    the crosses are entirely about.
    """
    doc = _load_alert_baseline()
    bars = doc["bars"]
    rsi_rows = [r for r in doc["rows"] if r["indicator"] == "rsi"]
    assert rsi_rows

    original = evaluator.INDICATOR_FUNCS["rsi"]
    evaluator.INDICATOR_FUNCS["rsi"] = evaluator.INDICATOR_FUNCS["mfi"]
    try:
        moved = sum(1 for r in rsi_rows
                    if evaluator.value_function("rsi")(bars, r["params"] or {})
                    != r["value"])
    finally:
        evaluator.INDICATOR_FUNCS["rsi"] = original
    assert evaluator.INDICATOR_FUNCS["rsi"] is original
    assert moved > 0, "the VALUE half cannot detect a re-pointed address"

    cross_rows = [r for r in doc["rows"]
                  if r["condition"] in ("cross_above", "cross_below", "cross_zero")
                  and r["prev"] is not None]
    assert cross_rows, "no cross rows carry a prev — the condition half is thin"
    flipped = sum(
        1 for r in cross_rows
        if evaluator.check_condition(r["condition"], r["value"], -(r["prev"]),
                                     r["threshold"]) != r["triggered"])
    assert flipped > 0, (
        "negating every recorded `prev` changed NO decision — the condition half "
        "is not actually reading `prev` and the crosses are unpinned")


def test_the_baseline_grid_can_actually_detect_a_change():
    """A recorded grid that never fires, or always fires, pins nothing.

    ⚠️ THE NON-VACUITY HALF. The replay above compares a stored answer to a
    computed one; if every stored answer were `(None, False)` — the shape an
    `INDICATOR_FUNCS` miss produces — it would pass while proving that all eight
    addresses had been DELETED. So: every row computed a value, and the fired /
    not-fired split is genuinely mixed.
    """
    doc = _load_alert_baseline()
    rows = doc["rows"]
    assert len(rows) > 1000, "the grid is too small to cover the condition branches"
    assert all(r["value"] is not None for r in rows), (
        "a recorded row computed no value — an address that stopped resolving would "
        "reproduce that `None` exactly and the replay would call it identical"
    )
    fired = sum(1 for r in rows if r["triggered"])
    assert 0 < fired < len(rows), f"the grid is saturated ({fired}/{len(rows)} fired)"
    # …and it covers all eight, every condition each of them offers.
    assert {r["indicator"] for r in rows} == set(doc["indicators"])
    assert len(doc["indicators"]) == 8


def test_the_replay_fails_when_an_address_is_repointed():
    """The replay's own control: break one address, and it must go RED.

    Without this, "the replay is green" is compatible with a replay that cannot
    fail — the exact `lesson_gate_that_cannot_fail` shape. `rsi` is re-pointed at
    `mfi`'s value function (a real, computable, DIFFERENT number, not a stub that
    returns None) and the replay must report it.
    """
    doc = _load_alert_baseline()
    bars = doc["bars"]
    rsi_rows = [r for r in doc["rows"] if r["indicator"] == "rsi"]
    assert rsi_rows, "no rsi rows to break"

    original = evaluator.INDICATOR_FUNCS["rsi"]
    evaluator.INDICATOR_FUNCS["rsi"] = evaluator.INDICATOR_FUNCS["mfi"]
    try:
        changed = 0
        for row in rsi_rows:
            alert = {
                "id": 1, "user_id": "u", "sym": "TEST", "tf": "D",
                "indicator": "rsi", "condition": row["condition"],
                "threshold": row["threshold"],
                "params_json": None if row["params"] is None else json.dumps(row["params"]),
                "last_value": row["prev"],
            }
            value, triggered = evaluator._evaluate_one(alert, bars=bars,
                                              mode="forming")
            if value != row["value"] or triggered != row["triggered"]:
                changed += 1
    finally:
        evaluator.INDICATOR_FUNCS["rsi"] = original

    assert changed > 0, (
        "re-pointing `rsi` at another indicator changed NOTHING the replay reads — "
        "the replay cannot fail and proves nothing"
    )
    # …and the restore really restored it, or every later test in this file is
    # running against a corrupted dict.
    assert evaluator.INDICATOR_FUNCS["rsi"] is original


# ═════════════════════════════════════════════════════════════════════════════
# PHASE C TASK 10 — THE HAND-WRITTEN DICT RETIRES, AND AN ALERT NAMES ITS
# INSTANCE.
# ═════════════════════════════════════════════════════════════════════════════

import ast as _ast  # noqa: E402
import re as _re  # noqa: E402

from api.services import alert_series as _alert_series  # noqa: E402

_EVALUATOR_SRC = pathlib.Path(evaluator.__file__).read_text(encoding="utf-8")

# The 28 addresses the retired literal held, transcribed ONCE, in its order.
# ⛔ THIS IS NOT A COPY OF THE NEW TABLE — it is the RECORD of the old one, and
# it is the whole point of the assertion below: a derivation is only a
# retirement if it produces what the literal produced. It is checked against the
# frozen fire log's own `address_count` too, which was recorded before any of
# this existed.
_RETIRED_LITERAL_ADDRESSES = [
    "rsi", "macd", "bb", "stoch", "williams_r", "cci", "mfi", "price_vs_ma",
    "macd.signal", "macd.histogram", "bb.upper", "bb.middle", "bb.lower",
    "stoch.d", "vwap", "atr", "adx.adx", "adx.plusDI", "adx.minusDI", "obv",
    "donchian.upper", "donchian.middle", "donchian.lower",
    "ichimoku.tenkan", "ichimoku.kijun", "ichimoku.spanA", "ichimoku.spanB",
    "ichimoku.chikou",
]


def test_the_derived_table_IS_the_retired_literal_28_addresses_in_14_groups():
    """⭐ THE MEASUREMENT THE RETIREMENT STANDS ON.

    ⚠️ IT IS 28, NOT THE 25 THE B5 LEDGER AND ITS GAP REPORT BOTH CARRIED. A
    plan carrying 25 forward would have shipped an assertion that failed on its
    first run FOR THE WRONG REASON. 8 legacy + 6 same-base + 14 new-base.

    ⛔ A SORTED LIST, AND ALSO THE EXACT ORDER. The set says the derivation lost
    nothing; the sequence says it did not REORDER, and order is the dropdown's
    order (pinned since B4 Task 9) as well as the order the frozen replay grid
    is generated in. A set-only assertion is green for a derivation that
    shuffles every user's `<select>` and moves 691,195 recorded fires.
    """
    assert len(evaluator.INDICATOR_FUNCS) == 28
    assert sorted(evaluator.INDICATOR_FUNCS) == sorted(_RETIRED_LITERAL_ADDRESSES)
    assert list(evaluator.INDICATOR_FUNCS) == _RETIRED_LITERAL_ADDRESSES
    assert len({evaluator.plot_base(a) for a in evaluator.INDICATOR_FUNCS}) == 14
    # …and `sar` is still absent from the THRESHOLD vocabulary. 28 with `sar` in
    # it would be a different 28.
    assert "sar" not in evaluator.INDICATOR_FUNCS
    assert evaluator.THRESHOLD_ADDRESSES == tuple(_RETIRED_LITERAL_ADDRESSES)


def test_the_frozen_fire_log_agrees_the_grid_is_still_28_wide():
    """The independent witness: a number recorded before this task existed.

    `tools/alert_replay.py` stores `address_count` in the frozen log and warns
    on `--check` when the live table has grown or shrunk. Reading it here makes
    that warning a FAILURE in the suite as well, because a printed warning
    inside a 900-line replay run is a control nobody sees.
    """
    log = json.loads(
        (_FIXTURES / "alerts" / "fire_log_forming.json").read_text(encoding="utf-8"))
    assert log["address_count"] == len(evaluator.INDICATOR_FUNCS) == 28


def test_the_hand_written_dispatch_literal_is_GONE_by_identity():
    """⛔ THE RETIREMENT, VERIFIED THE WAY THE LEDGER VERIFIES ONE.

    The enumeration ledger's anchor for this site is the literal's own
    declaration, `INDICATOR_FUNCS: dict[str,`. It must now match ZERO times —
    re-run here under the same regex that used to demand exactly one, because a
    control that stops looking is a control that rots.

    ⚠️ AND THE NAME MUST SURVIVE. `tools/alert_replay.py` generates the frozen
    grid from `ev.INDICATOR_FUNCS`, `alert_shadow_log` bounds a declaration with
    it, and `alert_soak_matrix` arms from the catalog behind it. What retired is
    the LITERAL — the second place a person had to edit — not the mapping.
    """
    anchor = _re.compile(r"INDICATOR_FUNCS:\s*dict\[str,")
    assert anchor.findall(_EVALUATOR_SRC) == [], (
        "the hand-written dispatch dict is back. It is DERIVED from "
        "`alert_series.SERIES_FUNCS` — a value is the last non-None element of "
        "a column — and a second table of the same 28 closures is exactly the "
        "twin Phase C retired.")
    # …and the regex can still see the shape it is looking for, so the emptiness
    # above is a fact about the file and not about a broken pattern.
    assert anchor.findall("INDICATOR_FUNCS: dict[str, int] = {}") != []
    assert isinstance(evaluator.INDICATOR_FUNCS, dict)


def test_no_second_value_table_survives_anywhere_in_the_module():
    """⛔ THE RETIREMENT, FAKED — THE MUTATION THIS TASK OWES.

    A derivation that is still shadowed by hand-written per-address value
    functions has retired nothing; it has added a third table. So: the module
    may declare NO function whose name starts with `_value_` other than the
    builder, and no `_plot_of`. Read as an AST rather than as text so a name
    inside a comment or a docstring can neither satisfy nor violate it.
    """
    tree = _ast.parse(_EVALUATOR_SRC)
    defined = {n.name for n in _ast.walk(tree)
               if isinstance(n, (_ast.FunctionDef, _ast.AsyncFunctionDef))}
    leftovers = sorted(n for n in defined
                       if (n.startswith("_value_") and n != "_value_of")
                       or n == "_plot_of")
    assert leftovers == [], (
        f"{leftovers} are hand-written value functions living beside the "
        "derivation. `_value_of` composes `_last_non_none` onto the column "
        "table; a per-address function here is the retired dict growing back "
        "one row at a time.")
    # ⛔ NON-VACUITY: the scan really does see this module's functions, and the
    # names it hunts are ones it WOULD match if they existed.
    assert "_value_of" in defined and "_last_non_none" in defined
    assert {n for n in defined if n.startswith("_value")} == {"_value_of"}


def test_every_derived_value_is_the_last_non_none_of_its_column():
    """The derivation, asserted as the definition it claims to be.

    ⚠️ THIS IS DELIBERATELY NOT THE OLD TWIN RAIL. That one compared two
    hand-written tables and was load-bearing because they could drift; this one
    is true by construction and says so. What it still catches is a `_value_of`
    that stopped composing the column — a cache, a snapshot, or an `[-1]`
    instead of the last NON-NONE element (which differs for every padded column,
    and for `ichimoku.chikou` differs on EVERY bar).
    """
    bars = _ramp_bars(120)
    for address in evaluator.all_addresses():
        column = _alert_series.series_for(address, bars, {})
        expected = None
        for v in reversed(column):
            if v is not None:
                expected = float(v)
                break
        got = evaluator.value_function(address)(bars, {})
        assert got == expected, address
    # ⛔ NON-VACUITY: `chikou` is the address whose last element is None while
    # its last non-None value is a real number 26 bars back, so "the last
    # element" and "the last non-None element" are not the same function here.
    chikou = _alert_series.series_for("ichimoku.chikou", bars, {})
    assert chikou[-1] is None
    assert evaluator.value_function("ichimoku.chikou")(bars, {}) is not None


def test_the_column_table_is_read_at_CALL_time_not_captured_at_import():
    """⛔ THE CONTROL THAT TWO COMMITTED ORACLES DEPEND ON.

    `test_the_replay_fails_when_an_address_is_repointed` and Task 2's fire-log
    control both re-point a LIVE table entry at runtime. A `_value_of` that
    captured `SERIES_FUNCS[address]` at import would keep serving the
    pre-mutation callable — a control that cannot fail, which is the exact
    defect Task 6 found in `make_forming_evaluate`.
    """
    bars = _ramp_bars(80)
    original = _alert_series.SERIES_FUNCS["rsi"]
    before = evaluator.value_function("rsi")(bars, {})
    try:
        _alert_series.SERIES_FUNCS["rsi"] = lambda b, p: [1.0] * len(b)
        assert evaluator.value_function("rsi")(bars, {}) == 1.0
    finally:
        _alert_series.SERIES_FUNCS["rsi"] = original
    assert evaluator.value_function("rsi")(bars, {}) == before


def test_value_function_consults_every_partition():
    """⛔ THE ANTI-FORK RAIL, DERIVED FROM THE PARTITION LIST ITSELF.

    Task 6 measured this defect for real: `make_forming_evaluate` resolved
    through `INDICATOR_FUNCS.get()` while the shipped lane resolved through
    `value_function()`, so both `sar` EVENT addresses read `(None, False)` in
    the harness while the live lane fired one 39 times — **and it survived
    because the anti-fork rail iterated the same dict the bug was in.** A third
    partition is precisely when that happens again.
    """
    for partition in evaluator.ADDRESS_PARTITIONS:
        assert partition, "an empty partition makes the loop below vacuous"
        for address in partition:
            assert evaluator.value_function(address) is partition[address], address
    # …and an address in no partition resolves to nothing, so this is not just
    # "returns something for everything".
    assert evaluator.value_function("rsx") is None


# ─── the PRICE address: a LEFT operand at last ───────────────────────────────

def test_price_is_a_LEFT_operand_and_evaluates_on_both_lanes():
    """🔴 THE THING TASK 11 RECORDED AS STRUCTURALLY BLOCKED.

    `alert_conditions.OPERAND_KINDS` has carried `"close"` since Task 3, but
    only as a RIGHT-hand operand: you could ask "VWAP crossed below price" and
    not "price crossed above VWAP", which is the same event and the wrong
    sentence. An alert's LEFT side is its `indicator` field, i.e. an ADDRESS —
    so price needed one.
    """
    bars = _ramp_bars(60, start=100.0, step=1.0)
    assert "close" in evaluator.PRICE_FUNCS
    assert evaluator.value_function("close") is not None
    assert evaluator.address_value("close", bars, {}) == pytest.approx(bars[-1]["c"])
    # the closed lane can read it too, aligned to the bars, or an armed `close`
    # alert would evaluate today and stop dead at Task 8's cutover.
    column = _alert_series.series_for("close", bars, {})
    assert len(column) == len(bars)
    assert column[0] == pytest.approx(bars[0]["c"])
    # …and it is OFFERED, with the four level conditions.
    served = {e["indicator"]: e for e in evaluator.alert_catalog()}
    assert "close" in served
    assert [c["value"] for c in served["close"]["conditions"]] == [
        "above", "below", "cross_above", "cross_below"]


def test_the_price_address_is_kept_OUT_of_the_frozen_replay_grid():
    """⛔ WHY IT IS A THIRD PARTITION AND NOT A 29th LEVEL.

    `tools/alert_replay.py::build_alert_grid` generates the frozen 691,195-fire
    grid by iterating `INDICATOR_FUNCS`. A 29th key there moves every recorded
    digest — which is why Task 3 put the two `sar` EVENT addresses in their own
    table, in its own words: *"growing it would have DESTROYED THE INSTRUMENT."*
    Same reason, same shape, and this is the assertion that stops somebody
    "tidying" the three partitions back into one.
    """
    assert "close" not in evaluator.INDICATOR_FUNCS
    assert "close" not in evaluator.EVENT_FUNCS
    assert len(evaluator.INDICATOR_FUNCS) == 28
    # …and it IS in the catalog, so this is a statement about the INSTRUMENT and
    # not about an address nobody can reach.
    assert "close" in evaluator.all_addresses()


# ─── spec §8: the alert names its INSTANCE ───────────────────────────────────

def test_two_instances_of_one_definition_are_two_different_alerts():
    """⭐ SPEC §8, THE HEADLINE. `RSI(7)` and `RSI(14)` are not the same alert.

    They never were — the period has always lived in `params_json` — but nothing
    on any surface said so, and the popover sent no params at all, so every
    alert a user could create was on the DEFAULT instance and the two sentences
    in the spec were literally unrepresentable.
    """
    # ⚠️ A ZIGZAG, NOT A RAMP, AND THE FIRST DRAFT OF THIS TEST GOT IT WRONG.
    # On a monotonically rising series RSI is 100 at EVERY period, so `RSI(7) ==
    # RSI(14)` — the assertion below would have failed on a tree where params
    # reach the compute perfectly. The instances have to be separable by the
    # FIXTURE before they can be separated by the code.
    bars = _zigzag_bars(90)
    v7 = evaluator.address_value("rsi", bars, {"period": 7})
    v14 = evaluator.address_value("rsi", bars, {"period": 14})
    assert v7 is not None and v14 is not None
    assert v7 != v14, (
        "the two instances computed the identical number — `params_json` is not "
        "reaching the compute, and every alert is on the default instance")
    # …and the NAME distinguishes them, from one authority, so the row a user
    # reads cannot describe a different instance from the one that evaluated.
    assert evaluator.instance_label("rsi", {"period": 7}) == "RSI(7)"
    assert evaluator.instance_label("rsi", {"period": 14}) == "RSI(14)"
    assert evaluator.instance_label("rsi") == "RSI(14)"  # the declared default


def test_the_instance_label_reads_the_knobs_off_the_compute_not_a_list():
    """⛔ THE KNOBS ARE DERIVED, OR THIS IS THE RETIRED DICT WEARING A HAT.

    `address_inputs` reads `fn.inputs` off the column function that actually
    consumes them. A hand-written `{"rsi": ["period"], …}` map would be a new
    enumeration site on the day the old one retired.
    """
    assert _alert_series.address_inputs("rsi") == {"period": 14}
    assert _alert_series.address_inputs("macd") == {"fast": 12, "slow": 26, "signal": 9}
    assert _alert_series.address_inputs("price_vs_ma") == {"period": 50, "type": "sma"}
    # A parameterless address renders bare — "VWAP()" would be noise, and it is
    # also what every existing surface already shows.
    for bare in ("vwap", "obv", "bb", "close"):
        assert _alert_series.address_inputs(bare) == {}
        assert evaluator.instance_label(bare) == evaluator.ALERT_LABELS[bare]
    assert evaluator.instance_label("macd", {"fast": 5}) == "MACD(5, 26, 9)"
    # ⛔ TOTALITY: every address's declared knobs are exactly the ones its column
    # function consumes, for every address there is — so a compute that gains a
    # parameter cannot be labelled with the old ones.
    # ⛔ COMPARED AGAINST THE BASE LABEL, NOT AGAINST "does it contain a
    # bracket" — `close`'s label is literally "Price (Close)", so the bracket
    # test reported a parameterless address as parameterised. Measured, not
    # reasoned: the first draft failed on exactly that address.
    for address in evaluator.all_addresses():
        declared = _alert_series.address_inputs(address)
        base = evaluator.ALERT_LABELS[address]
        label = evaluator.instance_label(address, None)
        assert (label != base) is bool(declared), address


def test_the_catalog_carries_the_instance_shape_for_every_plot():
    """The popover cannot offer `RSI(7)` unless it is told `rsi` has a `period`."""
    for entry in evaluator.alert_catalog():
        for plot in entry["plots"]:
            assert "inputs" in plot, plot["value"]
            assert plot["inputs"] == _alert_series.address_inputs(plot["value"])
            assert plot["instance_label"] == evaluator.instance_label(plot["value"])
    # non-vacuity: at least one plot really does declare knobs, and at least one
    # really declares none — a catalog where every `inputs` were `{}` would pass
    # every line above and offer no instance anywhere.
    shapes = {bool(p["inputs"])
              for e in evaluator.alert_catalog() for p in e["plots"]}
    assert shapes == {True, False}


# ─── 2026-11-06 (RS 2b-05): THE FIFTH PARTITION — `rs_line.*` ────────────────
#
# The UCT Relative Strength addresses (`alert_rs_series.RS_SERIES`): a
# TWO-SYMBOL column (`fn.reads_benchmark`) judged on CLOSED daily / weekly bars
# only. Registered by the evaluator at ITS import (before the partitions and
# `_CANONICAL_ADDRESS` are derived), partitioned as `RS_FUNCS`, kept out of the
# 28-wide frozen grid, catalogued with declared 0.5 operands for its events.

import datetime as _dt  # noqa: E402
import math as _math  # noqa: E402

from api.services import alert_rs_series as _ars  # noqa: E402
from api.services import alert_user_series as _aus  # noqa: E402
from api.services import indicator_alert_service as _ias  # noqa: E402

_RS_FAR = _dt.datetime(2030, 1, 1, tzinfo=_dt.timezone.utc).timestamp()


def _rs_daily_bars(n: int = 400) -> tuple[list[dict], list[dict]]:
    """A stock and a benchmark on the same weekday calendar (`YYYYMMDD` ints, the
    store's D encoding), both moving, so every RS column has events to find."""
    times, day = [], _dt.date(2022, 1, 3)
    while len(times) < n:
        if day.weekday() < 5:
            times.append(int(day.strftime("%Y%m%d")))
        day += _dt.timedelta(days=1)

    def bars(closes):
        return [{"t": t, "o": c - 0.3, "h": c + 1.0, "l": c - 1.2, "c": c,
                 "v": 1_000_000 + i} for i, (t, c) in enumerate(zip(times, closes))]
    stock = bars([100.0 + 12.0 * _math.sin(i / 11.0) + i * 0.08 for i in range(n)])
    bench = bars([200.0 + 20.0 * _math.sin(i / 5.0 + 1.0) + i * 0.03 for i in range(n)])
    return stock, bench


class _RsStore:
    """The injected benchmark reader: `(ticker, tf, want) -> bars`, counting."""

    def __init__(self, bench):
        self.bench = bench
        self.calls = []

    def __call__(self, ticker, tf, want):
        self.calls.append((str(ticker).upper(), str(tf), int(want)))
        return self.bench[-int(want):] if int(want) < len(self.bench) else list(self.bench)


def _rs_session(t: int) -> str:
    """``20240102`` → ``"2024-01-02"``, the side table's session key."""
    return f"{t // 10000:04d}-{(t // 100) % 100:02d}-{t % 100:02d}"


def _rs_rating_rows(bars, rating=lambda i: 1 + (i * 7) % 99):
    """2026-11-07 (RS 2b-06): a stored rating history in `rs_history.ticker_history`'s
    shape (newest session first), one row per bar of ``bars``."""
    return [{"session": _rs_session(int(b["t"])), "ibd": rating(i)} for i, b in enumerate(bars)][::-1]


class _RsRatings:
    """The injected rating-history reader: `(ticker, limit) -> rows`, counting."""

    def __init__(self, rows):
        self.rows = list(rows)
        self.calls = []

    def __call__(self, ticker, limit):
        self.calls.append((str(ticker).upper(), int(limit)))
        return self.rows[:int(limit)]


def _rs_alert(address: str, tf: str = "D") -> dict:
    cond = evaluator.ALERT_CONDITIONS[address][0]
    return {"id": 1, "user_id": "u", "sym": "TEST", "tf": tf, "indicator": address,
            "condition": cond["value"],
            "threshold": -1e12 if cond["needs_threshold"] else None,
            "params_json": None, "last_value": None}


def test_the_rs_partition_is_the_fifth_disjoint_from_the_other_four_and_exactly_twelve():
    ev = evaluator
    assert ev.ADDRESS_PARTITIONS[-1] is ev.RS_FUNCS
    assert len(ev.ADDRESS_PARTITIONS) == 5
    assert list(ev.RS_FUNCS) == list(ev.RS_ADDRESSES) == list(_ars.RS_ADDRESSES)
    assert len(ev.RS_ADDRESSES) == 16  # 2026-11-07 (RS 2b-06): +rs_line.rating; 2026-11-10 (RS split, S2): +4 split
    assert {ev.plot_base(a) for a in ev.RS_ADDRESSES} == {"rs_line", "rs_phases", "rs_vs_ema"}
    others = set().union(*(set(p) for p in ev.ADDRESS_PARTITIONS[:-1]))
    assert not (others & set(ev.RS_ADDRESSES)), "an RS address is in two partitions"
    # the base-set rail on `EVENT_ADDRESSES` still reads {sar}: RS is not an event member
    assert {ev.plot_base(a) for a in ev.EVENT_ADDRESSES} == {"sar"}
    # the frozen grid is untouched: 28, none of them RS, RS not a threshold address
    assert len(ev.INDICATOR_FUNCS) == 28
    assert not any(a in ev.INDICATOR_FUNCS for a in ev.RS_ADDRESSES)
    assert not any(a in ev.THRESHOLD_ADDRESSES for a in ev.RS_ADDRESSES)
    # appended LAST, in the lane's own order, after `ma_cross`
    assert ev.all_addresses()[31] == "ma_cross"
    assert ev.all_addresses()[32:] == list(ev.RS_ADDRESSES)
    # registered in `SERIES_FUNCS` by the evaluator's import, idempotently
    assert all(_alert_series.series_function(a) is _ars.RS_SERIES[a] for a in ev.RS_ADDRESSES)
    assert _ars.register_rs_series() == ()
    # every partition entry is the live value function (the anti-fork rule, fifth partition)
    for a in ev.RS_ADDRESSES:
        assert ev.value_function(a) is ev.RS_FUNCS[a]


def test_every_rs_address_is_closed_only_by_its_columns_own_declaration():
    ev = evaluator
    for a in ev.RS_ADDRESSES:
        fn = _alert_series.series_function(a)
        # 2026-11-07 (RS 2b-06): `reads_benchmark` is the (tf, sym) CALL SHAPE
        # `call_series` routes on and the one flag this set is derived from —
        # every RS column declares it, the rating included; `reads_rating`
        # names what the rating actually reads, and it is offered on D only.
        assert fn.reads_benchmark is True, a
        if a == "rs_line.rating":
            assert fn.reads_rating is True and fn.timeframes == ("D",)
        else:
            assert not getattr(fn, "reads_rating", False) and fn.timeframes == ("D", "W"), a
        assert a in ev.CLOSED_ONLY_ADDRESSES, a
        # the rollback lever does not reach it
        assert ev._lane_for(a, "forming") == "closed"
    assert ev.CLOSED_ONLY_ADDRESSES == frozenset(ev.CROSS_ADDRESSES) | frozenset(ev.RS_ADDRESSES)
    assert len(ev.CLOSED_ONLY_ADDRESSES) == 17  # 2026-11-07 (RS 2b-06): +rs_line.rating; 2026-11-10 (RS split, S2): +4 split


def test_resolve_address_folds_an_rs_address_to_its_camelcase_spelling():
    assert evaluator.resolve_address("rs_line.crossup") == "rs_line.crossUp"
    assert evaluator.resolve_address("RS_LINE.NEWHIGHBEFOREPRICE") == "rs_line.newHighBeforePrice"
    assert evaluator.resolve_address("rs_line.mansfieldcrossdown") == "rs_line.mansfieldCrossDown"


def test_the_rs_catalog_rows_labels_decimals_and_declared_operands():
    ev = evaluator
    served = {e["indicator"]: e for e in ev.alert_catalog()}   # renders: no KeyError
    entry = served["rs_line"]
    assert entry["label"] == "UCT Relative Strength" == ev.ALERT_BASE_LABELS["rs_line"]
    plots = {p["value"]: p for p in entry["plots"]}
    # 2026-11-10 (RS split, S2): the offer is the registered list minus the withheld
    # Mansfield three; the split families are their own catalogue groups.
    rs_line_offered = [a for a in ev.RS_ADDRESSES
                       if a.startswith("rs_line.") and a not in _ars.RS_WITHHELD_ADDRESSES]
    assert list(plots) == rs_line_offered
    assert not (set(plots) & set(_ars.RS_WITHHELD_ADDRESSES))
    for a in rs_line_offered:
        p = plots[a]
        assert ev.ALERT_LABELS[a].strip() and ev.ALERT_LABELS[a] != a
        assert p["label"] == ev.ALERT_LABELS[a]
        assert p["instance_defs"] == ["rsLine"]
        assert p["inputs"] == _alert_series.address_inputs(a)
        assert p["instance_label"] == ev.instance_label(a)
        if a == "rs_line.rating":
            # 2026-11-07 (RS 2b-06): no knobs — no benchmark, no options, no
            # suffix — and the one RS plot with a default: 90, the plan's line.
            assert p["inputs"] == {} and "input_options" not in p
            assert p["default_threshold"] == 90.0 == ev._DEFAULT_THRESHOLDS[a]
            assert p["instance_label"] == ev.ALERT_LABELS[a] == "RS rating (IBD-style)"
        else:
            assert "INDUSTRY" not in p["input_options"]["benchmark"]
            assert p["default_threshold"] is None
            assert "benchmark" in p["inputs"]
            # the instance label carries the PLOT name and the chip's suffix, as one string
            assert p["instance_label"].startswith(f"{ev.ALERT_LABELS[a]} (vs SPY")
        # every needs_threshold-False rule has a declared operand, or is `cross_zero`
        for c in p["conditions"]:
            if c["needs_threshold"] is False:
                assert c["value"] == "cross_zero" or (a, c["value"]) in ev.THRESHOLD_OPERAND, (a, c)
    events = ("rs_line.above", "rs_line.crossUp", "rs_line.crossDown", "rs_line.newHigh",
              "rs_line.newHighBeforePrice", "rs_line.newHighRed")
    for a in events:
        assert [c["value"] for c in plots[a]["conditions"]] == ["above"], a
        assert plots[a]["conditions"][0]["needs_threshold"] is False
        assert ev.THRESHOLD_OPERAND[(a, "above")] == {"kind": "const", "value": 0.5}
    # the withheld Mansfield three: not offered, but their conditions and operands
    # stay declared so a stored alert keeps evaluating
    for a in ("rs_line.mansfieldCrossUp", "rs_line.mansfieldCrossDown"):
        assert [c["value"] for c in ev.ALERT_CONDITIONS[a]] == ["above"]
        assert ev.THRESHOLD_OPERAND[(a, "above")] == {"kind": "const", "value": 0.5}
    assert [c["value"] for c in ev.ALERT_CONDITIONS["rs_line.mansfield"]] == ["cross_zero", "above", "below"]
    # 2026-11-10 (RS split, S2): the two new catalogue groups, one event rule each
    for base, label, plot_values in (
            ("rs_phases", "UCT RS Phases", ["rs_phases.flipBlue", "rs_phases.flipRed"]),
            ("rs_vs_ema", "UCT RS vs 21 EMA", ["rs_vs_ema.crossUp", "rs_vs_ema.crossDown"])):
        group = served[base]
        assert group["label"] == label == ev.ALERT_BASE_LABELS[base]
        assert [p["value"] for p in group["plots"]] == plot_values
        for p in group["plots"]:
            assert p["instance_defs"] == [{"rs_phases": "rsPhases", "rs_vs_ema": "rsVsEma"}[base]]
            assert [c["value"] for c in p["conditions"]] == ["above"] and p["conditions"][0]["needs_threshold"] is False
            assert ev.THRESHOLD_OPERAND[(p["value"], "above")] == {"kind": "const", "value": 0.5}
            assert p["default_threshold"] is None and "INDUSTRY" not in p["input_options"]["benchmark"]
            assert p["instance_label"].startswith(f"{ev.ALERT_LABELS[p['value']]} (vs SPY")
    assert ev.THRESHOLD_OPERAND[("rs_line.mansfield", "above")] == {"kind": "const", "value": 0.0}
    assert ev.THRESHOLD_OPERAND[("rs_line.mansfield", "below")] == {"kind": "const", "value": 0.0}
    for a in ("rs_line.value", "rs_line.ma"):
        assert [c["value"] for c in plots[a]["conditions"]] == ["above", "below", "cross_above", "cross_below"]
        assert all(c["needs_threshold"] for c in plots[a]["conditions"])
        assert ev.value_decimals(a) == 4 == ev.ALERT_VALUE_DECIMALS[a]
    # Mansfield RS prints at the default (2) and is deliberately not a table row
    assert ev.value_decimals("rs_line.mansfield") == ev.NOTIFICATION_DEFAULT_DECIMALS == 2
    assert "rs_line.mansfield" not in ev.ALERT_VALUE_DECIMALS
    # 2026-11-07 (RS 2b-06): the rating is a LEVEL with the four level rules,
    # appended LAST, default 90, printed as the integer it is (1–99)
    assert entry["plots"][-1]["value"] == "rs_line.rating"
    assert [c["value"] for c in plots["rs_line.rating"]["conditions"]] == ["above", "below", "cross_above", "cross_below"]
    assert all(c["needs_threshold"] for c in plots["rs_line.rating"]["conditions"])
    assert ev.value_decimals("rs_line.rating") == 0 == ev.ALERT_VALUE_DECIMALS["rs_line.rating"]
    assert ev.format_alert_value("rs_line.rating", 91) == "91"
    assert ev.format_alert_value("rs_line.rating", 90.0) == "90"
    # "the line crossed its average" is NOT an operand row — the closed lane's
    # right-hand resolver cannot value a benchmark-reading column (measured here),
    # so the relation is offered only where it fires: the two cross EVENTS.
    assert not any(spec.get("address", "").startswith("rs_line.")
                   for spec in ev.THRESHOLD_OPERAND.values())
    stock, _bench = _rs_daily_bars()
    assert ev._closed_address_value("rs_line.ma", stock, {}) is None


def test_the_door_refuses_an_intraday_rs_create_with_the_lanes_own_sentence():
    ev = evaluator
    for a in ev.RS_ADDRESSES:
        cond = ev.ALERT_CONDITIONS[a][0]
        thr = 0.0 if cond["needs_threshold"] else None
        if a in _ars.RS_WITHHELD_ADDRESSES:
            # 2026-11-10 (RS split, S2): the offer gate comes first, so a new Mansfield
            # alert is refused with the withheld sentence on every timeframe.
            for tf in ("5", "D", "W"):
                assert _ias.REFUSAL_RS_WITHHELD in _ias.refusal_for(a, cond["value"], tf, thr), (a, tf)
            continue
        why = _ias.refusal_for(a, cond["value"], "5", thr)
        assert why is not None and why == _ars.timeframe_refusal("5", a), a
        assert _ias.REFUSAL_RS_TIMEFRAME in why
        assert _ias.refusal_for(a, cond["value"], "M", thr) is not None
        assert _ias.refusal_for(a, cond["value"], "D", thr) is None, a
        assert _ias.refusal_for(a, cond["value"], "1D", thr) is None, a
        weekly = _ias.refusal_for(a, cond["value"], "W", thr)
        if a == "rs_line.rating":
            # 2026-11-07 (RS 2b-06): DAILY only, in its own sentence — the rating
            # is a nightly daily-close number, so a weekly create is refused at
            # the door too, and the sentence says why.
            assert weekly == _ars.timeframe_refusal("W", a) and "closed daily bars only" in weekly
            assert "daily closes" in weekly and _ias.REFUSAL_RS_TIMEFRAME in weekly
            assert _ias.refusal_for(a, cond["value"], "1W", thr) is not None
        else:
            assert weekly is None, a
    # the anchor is the lane's own phrase, in every refused spelling, for BOTH
    # sentence families (the eleven's "daily or weekly", the rating's "daily")
    for tf in ("1", "5", "15", "30", "60", "M", "1M", "H"):
        assert _ias.REFUSAL_RS_TIMEFRAME in _ars.timeframe_refusal(tf, "rs_line.newHigh")
        assert _ias.REFUSAL_RS_TIMEFRAME in _ars.timeframe_refusal(tf, "rs_line.rating")
    # params still go through the column's own `validate` / `normalize`
    assert "INDUSTRY" in ev.params_refusal("rs_line.newHigh", "above", {"benchmark": "INDUSTRY"})
    assert ev.params_refusal("rs_line.newHigh", "cross_above", {}) is not None   # a rule it does not offer
    assert ev.params_refusal("rs_line.newHigh", "above", {}) is None
    assert ev.normalize_params("rs_line.ma", {"maType": "sma", "maLength": "10"}) == {"maType": "SMA", "maLength": 10}


def test_every_rs_address_answers_a_value_on_the_closed_lane_on_daily_bars():
    ev = evaluator
    stock, bench = _rs_daily_bars()
    store = _RsStore(bench)
    ratings = _RsRatings(_rs_rating_rows(stock))   # 2026-11-07 (RS 2b-06): the rating's side table
    with _ars.rs_pass(fetch_bars=store, read_ratings=ratings):
        for a in ev.RS_ADDRESSES:
            value, _trig, i = ev._evaluate_one_closed(_rs_alert(a), stock, now_epoch=_RS_FAR)
            assert value is not None, f"{a} is offered and computes nothing on the closed lane"
            assert i == len(stock) - 1
            # …and the lever cannot move it to the forming lane: the same answer
            assert ev._evaluate_one(_rs_alert(a), stock, mode="forming", now_epoch=_RS_FAR)[0] == value
        # one benchmark read per (ticker, tf) across all twelve, inside one pass —
        # and (2b-06) ONE history read for the rating, the window plus its pad
        assert {c[:2] for c in store.calls} == {("SPY", "D")}
        assert len(store.calls) == 1
        assert ratings.calls == [("TEST", len(stock) + _ars.RATING_READ_PAD)]
    # the forming shape answers nothing, by construction — which is why RS is
    # closed-only and why the forming-shaped census above skips it
    for a in ev.RS_ADDRESSES:
        assert ev.value_function(a)(stock, {}) is None


def test_an_rs_event_fires_on_its_event_bar_and_only_there():
    ev = evaluator
    stock, bench = _rs_daily_bars()
    address = "rs_line.crossUp"
    fn = _alert_series.series_function(address)
    with _ars.rs_pass(fetch_bars=_RsStore(bench)):
        column = _aus.call_series(fn, stock, {}, tf="D", sym="TEST")
    ups = [k for k in range(1, len(column)) if column[k] == 1.0]
    assert ups, "the fixture never crosses — the test proves nothing"
    k = ups[0]
    assert column[k - 1] == 0.0
    quiet = next(j for j in range(k + 1, len(column)) if column[j] == 0.0)
    # The lane reads the LATEST window of both symbols (a benchmark reader
    # serves its newest `want` bars), so "the bar being judged is bar k" is
    # modelled as the tape ending at k on BOTH sides — every RS column is causal,
    # so the truncated tape reproduces `column[k]` exactly.
    for last, expect in ((k, (1.0, True)), (quiet, (0.0, False))):
        with _ars.rs_pass(fetch_bars=_RsStore(bench[:last + 1])):
            value, triggered, i = ev._evaluate_one_closed(
                _rs_alert(address), stock[:last + 1], now_epoch=_RS_FAR)
        assert (value, triggered, i) == (*expect, last)


def test_diagnose_reaches_the_closed_lane_value_for_an_rs_alert(monkeypatch):
    stock, bench = _rs_daily_bars()
    with _ars.rs_pass(fetch_bars=_RsStore(bench)):
        assert _ias.diagnose(_rs_alert("rs_line.newHigh"), stock) == (False, None)
        assert _ias.diagnose(_rs_alert("rs_line.mansfield"), stock) == (False, None)
        # under the rollback lever too: the address is closed-only, so is its diagnosis
        monkeypatch.setenv(evaluator.ALERT_EVAL_MODE_ENV, "forming")
        assert _ias.diagnose(_rs_alert("rs_line.newHigh"), stock) == (False, None)
        monkeypatch.delenv(evaluator.ALERT_EVAL_MODE_ENV)
        # warming is not a fault
        is_fault, detail = _ias.diagnose(_rs_alert("rs_line.ma"), stock[:5])
        assert is_fault is False and "not enough history" in detail
    # a row written AROUND the door on a 5-minute timeframe: a fault, in the lane's sentence
    is_fault, detail = _ias.diagnose(_rs_alert("rs_line.newHigh", tf="5"), _intraday_bars(160))
    assert is_fault is True and _ias.REFUSAL_RS_TIMEFRAME in detail
    # 2026-11-07 (RS 2b-06): the rating diagnoses through the stored history —
    # the stored value on daily, a NAMED missing session (not "not enough
    # history": the rating has no warm-up), and the daily-only refusal on W
    with _ars.rs_pass(fetch_bars=_RsStore(bench), read_ratings=_RsRatings(_rs_rating_rows(stock))):
        assert _ias.diagnose(_rs_alert("rs_line.rating"), stock) == (False, None)
    with _ars.rs_pass(fetch_bars=_RsStore(bench), read_ratings=_RsRatings([])):
        is_fault, detail = _ias.diagnose(_rs_alert("rs_line.rating"), stock)
        assert is_fault is False and "no stored rating" in detail and "rs_rating_history" in detail
        assert _rs_session(int(stock[-1]["t"])) in detail and "not enough history" not in detail
    is_fault, detail = _ias.diagnose(_rs_alert("rs_line.rating", tf="W"), stock)
    assert is_fault is True and "closed daily bars only" in detail


def test_the_rating_cross_above_90_fires_on_the_first_bar_above_90_and_not_the_next():
    """2026-11-07 (RS 2b-06). The lane's own `check_condition` rule, applied to
    the stored history: `cross_above` is ``prev <= 90 < current``, so the alert
    fires on the FIRST session whose stored rating exceeds 90 with the one
    before at or below it, and is quiet on the next (prev already above) and on
    a later session that lands back ON 90 (90 is not above 90 — a member who
    means "reaches 90" arms `above` at 89). The history handed to every call is
    the FULL table, newest first; the truncated tape reads only its own dates,
    which is the "a later session never leaks backwards" rule under the lane."""
    ev = evaluator
    stock, _bench = _rs_daily_bars()
    n = len(stock)
    k = n - 3
    path = {k - 2: 85, k - 1: 88, k: 91, k + 1: 93, k + 2: 90}
    rows = _rs_rating_rows(stock, rating=lambda i: path.get(i, 70))
    alert = {**_rs_alert("rs_line.rating"), "condition": "cross_above", "threshold": 90.0}
    with _ars.rs_pass(fetch_bars=_RsStore([]), read_ratings=_RsRatings(rows)):
        column = _aus.call_series(_alert_series.series_function("rs_line.rating"), stock, {}, tf="D", sym="TEST")
        assert column[k - 2:k + 3] == [85, 88, 91, 93, 90] and column[0] == 70
        fired = [(last, ev._evaluate_one_closed(alert, stock[:last + 1], now_epoch=_RS_FAR))
                 for last in (k - 1, k, k + 1, k + 2)]
    assert fired == [(k - 1, (88, False, k - 1)), (k, (91, True, k)),
                     (k + 1, (93, False, k + 1)), (k + 2, (90, False, k + 2))]
    # the default threshold IS 90, and the member may type 80: fires where 80 is first exceeded
    assert ev._DEFAULT_THRESHOLDS["rs_line.rating"] == 90.0
    with _ars.rs_pass(fetch_bars=_RsStore([]), read_ratings=_RsRatings(rows)):
        assert ev._evaluate_one_closed({**alert, "threshold": 80.0}, stock[:k - 1],
                                       now_epoch=_RS_FAR) == (85, True, k - 2)
        assert ev._evaluate_one_closed({**alert, "threshold": 80.0}, stock[:k],
                                       now_epoch=_RS_FAR) == (88, False, k - 1)


def test_the_cycle_wraps_its_group_loop_in_one_rs_pass():
    """Read off the AST: the `for (sym, tf)` loop of `_run_one_cycle` is the body
    of a `with alert_rs_series.rs_pass()` — one benchmark read per pass."""
    src = pathlib.Path(evaluator.__file__).read_text(encoding="utf-8")
    fns = {n.name: n for n in _ast.walk(_ast.parse(src)) if isinstance(n, _ast.FunctionDef)}
    withs = [n for n in _ast.walk(fns["_run_one_cycle"]) if isinstance(n, _ast.With)]
    frames = [w for w in withs
              if any(_ast.unparse(item.context_expr) == "alert_rs_series.rs_pass()" for item in w.items)]
    assert len(frames) == 1, "the cycle does not open exactly one RS pass"
    loops = [n for n in _ast.walk(frames[0]) if isinstance(n, _ast.For)
             and _ast.unparse(n.iter) == "groups.items()"]
    assert len(loops) == 1, "the group loop is not inside the RS pass"
