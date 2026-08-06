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
    value, triggered = evaluator._evaluate_one(alert, bars=bars)
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
    value, triggered = evaluator._evaluate_one(alert, bars=bars)
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
    value, triggered = evaluator._evaluate_one(alert, bars=bars)
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
    value, triggered = evaluator._evaluate_one(alert, bars=bars)
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
    """⭐ TWO TABLES SINCE PHASE C, AND THE UNION IS THE OFFER.

    `INDICATOR_FUNCS` holds addresses that name a LEVEL; `EVENT_FUNCS` holds
    addresses that name a `{0, 1, None}` column. They are separate because the
    questions are — see `_SAR_IS_NOT_A_THRESHOLD` — and the catalog is their
    union, so an address in neither cannot be offered and an address in either
    cannot be silently dropped.
    """
    from api.services.indicator_alert_evaluator import EVENT_FUNCS, INDICATOR_FUNCS

    addresses = _catalog_addresses()
    assert set(addresses) == set(INDICATOR_FUNCS) | set(EVENT_FUNCS)
    # …and no address is served twice, which a grouping bug could do silently.
    assert len(addresses) == len(set(addresses))
    # …and the two tables are DISJOINT, or "which table answers for this
    # address" would depend on lookup order rather than on what it names.
    assert not set(INDICATOR_FUNCS) & set(EVENT_FUNCS)


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
    alertable = set(evaluator.INDICATOR_FUNCS) | set(evaluator.EVENT_FUNCS)
    assert alertable <= set(evaluator.ALERT_CONDITIONS)
    assert set(evaluator.ALERT_CONDITIONS) <= alertable


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
    value, triggered = evaluator._evaluate_one(alert, bars=bars)
    assert value is not None, "vwap still computes nothing — the gap is not closed"
    assert triggered is True
    # …and the number is the VWAP of those bars, not some other column that
    # happens to be non-None: it sits inside the traded range.
    assert min(b["l"] for b in bars) <= value <= max(b["h"] for b in bars)

    # The other direction, so "always fires" cannot be what makes this green.
    alert["threshold"] = 1e9
    _, triggered_high = evaluator._evaluate_one(alert, bars=bars)
    assert triggered_high is False


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
    """No new address may be an offer that cannot fire — the original defect."""
    value, _ = evaluator._evaluate_one(
        {
            "id": 1, "user_id": 1, "sym": "TEST", "indicator": address,
            "condition": "above", "threshold": -1e12, "tf": "5",
            "params_json": None, "last_value": None,
        },
        bars=_intraday_bars(160),
    )
    assert value is not None, f"{address} is offered and computes nothing"


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
            bars=bars,
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
            bars=rising,
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
    # The control: unmutated, this evaluates cleanly.
    assert evaluator._evaluate_one(dict(alert), bars=bars)[0] is not None

    original = dict(evaluator.THRESHOLD_OPERAND)
    evaluator.THRESHOLD_OPERAND[("rsi", "above")] = {"kind": "vibes"}
    try:
        with pytest.raises(ValueError, match="unknown operand kind"):
            evaluator._evaluate_one(dict(alert), bars=bars)
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
    assert route.endpoint() == {"catalog": evaluator.alert_catalog()}


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
    assert served[8:] == [
        "vwap", "atr", "adx", "obv", "donchian", "ichimoku", "sar",
    ]
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
        if value != row["value"] or triggered != row["triggered"]:
            mismatches.append(
                f"row {i} {row['indicator']}/{row['condition']} thr={row['threshold']} "
                f"prev={row['prev']} params={row['params']}: "
                f"got ({value!r}, {triggered!r}) want ({row['value']!r}, {row['triggered']!r})"
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
        if value != row["value"]:
            mismatches.append(
                f"row {i} {row['indicator']} params={row['params']}: "
                f"got {value!r} want {row['value']!r}"
            )
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
            value, triggered = evaluator._evaluate_one(alert, bars=bars)
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
