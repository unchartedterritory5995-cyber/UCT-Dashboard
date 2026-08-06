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

    offered = {c["value"] for e in evaluator.alert_catalog() for c in e["conditions"]}
    return {c for c in offered if fires(c)}


def test_catalog_offers_exactly_what_can_be_evaluated():
    from api.services.indicator_alert_evaluator import INDICATOR_FUNCS, alert_catalog

    assert {e["indicator"] for e in alert_catalog()} == set(INDICATOR_FUNCS)


def test_every_catalog_condition_is_one_the_evaluator_implements():
    implemented = _implemented_conditions()
    for entry in evaluator.alert_catalog():
        for cond in entry["conditions"]:
            assert cond["value"] in implemented, (
                f'{entry["indicator"]}/{cond["value"]} is offered and not implemented'
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
    """A dropdown showing `williams_r` is a dropdown that leaked a key."""
    for e in evaluator.alert_catalog():
        assert e["label"] != e["indicator"]
        assert e["label"].strip()


def test_every_catalog_entry_offers_at_least_one_condition():
    """An indicator with no conditions renders an empty second dropdown and an
    un-submittable form."""
    for e in evaluator.alert_catalog():
        assert e["conditions"], f'{e["indicator"]} offers no condition'


def test_adding_a_value_function_without_a_condition_list_fails_loudly():
    """A ninth indicator with no conditions has to fail HERE, at the catalog,
    not in a second dropdown that renders empty."""
    assert set(evaluator.INDICATOR_FUNCS) <= set(evaluator.ALERT_CONDITIONS)
    assert set(evaluator.ALERT_CONDITIONS) <= set(evaluator.INDICATOR_FUNCS)


def test_needs_threshold_is_declared_per_condition_not_guessed():
    """The popover used to keep its own THRESHOLD_CONDITIONS set. The served
    entry carries the flag, and a threshold-taking condition must declare it."""
    threshold_taking = {"above", "below", "cross_above", "cross_below"}
    for e in evaluator.alert_catalog():
        for c in e["conditions"]:
            assert isinstance(c["needs_threshold"], bool)
            assert c["needs_threshold"] is (c["value"] in threshold_taking), (
                f'{e["indicator"]}/{c["value"]} declares the wrong threshold need'
            )


def test_a_vwap_alert_is_not_offered_although_it_can_still_be_stored():
    """The exact defect, both halves, so neither can be quietly re-opened.

    `vwap` is not offered (the dropdown cannot create one) AND it is still
    accepted by `_evaluate_one` as a silent no-op — the create path is NOT
    validated by this change, and Phase C owns that.
    """
    assert "vwap" not in {e["indicator"] for e in evaluator.alert_catalog()}
    value, triggered = evaluator._evaluate_one(
        {
            "id": 99, "user_id": 1, "sym": "TEST", "indicator": "vwap",
            "condition": "above", "threshold": 1.0, "tf": "D",
            "params_json": None, "last_value": None,
        },
        bars=_ramp_bars(60),
    )
    assert (value, triggered) == (None, False)


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
    """
    assert [e["indicator"] for e in evaluator.alert_catalog()] == [
        "rsi", "macd", "bb", "stoch", "williams_r", "cci", "mfi", "price_vs_ma",
    ]
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


def test_the_eight_legacy_addresses_evaluate_identically():
    """Every recorded (value, triggered) reproduces, bit for bit."""
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
        value, triggered = evaluator._evaluate_one(alert, bars=bars)
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
