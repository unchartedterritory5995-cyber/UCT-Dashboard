"""One-shot recorder for the EIGHT legacy alert addresses' evaluation behaviour.

⛔ **RUN ONCE, AGAINST THE CODE AS IT WAS BEFORE THE B5 ALERT-GAP CHANGE.** Its
output (``tests/fixtures/indicator_alert_baseline.json``) is committed and is the
oracle for ``test_indicator_alert_evaluator.py::test_the_eight_legacy_addresses_evaluate_identically``.

The B5 alerts-gap task widened ``INDICATOR_FUNCS`` from 8 keys to 25 addresses and
reshaped ``alert_catalog()``. The gate on that work is that the EIGHT keys which
already existed keep evaluating **bit-for-bit identically** — an armed alert must
not start or stop firing the day it ships.

A structural check (``INDICATOR_FUNCS['rsi'] is _value_rsi``) is not that proof:
the value functions read ``indicator_compute``'s DELIVERY wrappers, so a change to
the rounding, to a shared helper, or to ``_evaluate_one``'s threshold plumbing
moves the numbers while every identity check stays green. This records the
NUMBERS — ``(value, triggered)`` for every (indicator × condition × threshold ×
prev × params) combination the catalog can express — so the only way to keep the
test green is to not have moved them.

⚠️ Re-running this after the change would re-record whatever the code now does
and convert a real regression into a green build — the same trap
``tests/fixtures/indicators/_generate.py`` is written under. Do not.

Usage (once, from the repo root, on the PRE-change tree):
    python tests/fixtures/_gen_alert_baseline.py
"""

from __future__ import annotations

import json
import os
import random
import sys

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.abspath(os.path.join(_OUT_DIR, "..", ".."))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from api.services import indicator_alert_evaluator as ev  # noqa: E402

OUT = os.path.join(_OUT_DIR, "indicator_alert_baseline.json")

# The eight addresses that existed before B5. Written down HERE on purpose: this
# file is the record of what the world looked like before the change, so reading
# the list off the (now wider) live dict would make the baseline follow the code.
LEGACY_EIGHT = ["rsi", "macd", "bb", "stoch", "williams_r", "cci", "mfi", "price_vs_ma"]

# Thresholds spread across every branch `check_condition` has: below, at, and
# above the values these indicators produce, plus 0 for the sign-sensitive ones.
THRESHOLDS = [-100.0, -80.0, -20.0, 0.0, 0.5, 20.0, 30.0, 50.0, 70.0, 80.0, 100.0, 150.0]

# `prev` is a SUPPLIED value — the only input the cross_* and cross_zero
# branches read. None (first evaluation) is included deliberately.
#
# ⚠️ WHEN THIS WAS RECORDED, "supplied" MEANT "the previous CYCLE's `last_value`",
# because the forming lane was the only lane. Phase C Task 5 changed where the
# LIVE code gets `prev` from (`series[i-1]` on the closed lane) and split the
# replay accordingly — see the block above
# `test_the_eight_legacy_addresses_evaluate_identically`. These rows are a grid
# of hand-picked `prev` values fed straight into `check_condition`, which is a
# statement about a PURE FUNCTION and is therefore true under both lanes. This
# file is not regenerated, ever.
PREVS = [None, -50.0, -1.0, 0.0, 1.0, 50.0, 99.0]

# Per-indicator param variants, so a change to a default or to param parsing shows.
PARAMS = {
    "rsi": [None, {"period": 7}, {"period": 21}],
    "macd": [None, {"fast": 5, "slow": 13, "signal": 4}],
    "bb": [None, {"period": 10, "stddev": 1.5}],
    "stoch": [None, {"k_period": 9, "d_period": 5}],
    "williams_r": [None, {"period": 21}],
    "cci": [None, {"period": 14}],
    "mfi": [None, {"period": 7}],
    "price_vs_ma": [None, {"period": 20, "type": "ema"}, {"period": 10, "type": "sma"}],
}


def build_bars(seed: int = 20260805, n: int = 220) -> list[dict]:
    """A deterministic OHLCV series with trend, chop and a flat stretch.

    Rounded to 4dp / integer volume so the JSON round-trips to the identical
    IEEE-754 double, exactly as the indicator fixtures do.
    """
    rng = random.Random(seed)
    bars: list[dict] = []
    price = 100.0
    t = 1780000000
    for i in range(n):
        if i < 60:
            price += rng.uniform(-0.7, 0.9)          # chop
        elif i < 110:
            price += 0.8 + rng.uniform(-0.3, 0.6)    # trend up
        elif i < 125:
            price = price                            # flat: zero-range branches
        elif i < 165:
            price -= 1.1 + rng.uniform(-0.4, 0.8)    # drop
        else:
            price += rng.uniform(-0.9, 1.0)          # recovery chop
        c = round(price, 4)
        spread = 0.6
        o = round(c - rng.uniform(-spread, spread), 4)
        h = round(max(o, c) + abs(rng.uniform(0, spread)), 4)
        l = round(min(o, c) - abs(rng.uniform(0, spread)), 4)
        bars.append({"t": t, "o": o, "h": h, "l": l, "c": c,
                     "v": int(1_000_000 * rng.uniform(0.5, 1.8))})
        t += 86400
    return bars


def _conditions_for(indicator: str) -> list[str]:
    """Every condition the PRE-change catalog offered for this indicator."""
    return [c["value"] for c in ev.ALERT_CONDITIONS[indicator]]


def main() -> None:
    bars = build_bars()
    rows = []
    for indicator in LEGACY_EIGHT:
        for params in PARAMS[indicator]:
            for condition in _conditions_for(indicator):
                for threshold in THRESHOLDS:
                    for prev in PREVS:
                        alert = {
                            "id": 1, "user_id": "u", "sym": "TEST", "tf": "D",
                            "indicator": indicator,
                            "condition": condition,
                            "threshold": threshold,
                            "params_json": None if params is None else json.dumps(params),
                            "last_value": prev,
                        }
                        value, triggered = ev._evaluate_one(alert, bars=bars)
                        rows.append({
                            "indicator": indicator,
                            "condition": condition,
                            "threshold": threshold,
                            "prev": prev,
                            "params": params,
                            "value": value,
                            "triggered": triggered,
                        })

    fired = sum(1 for r in rows if r["triggered"])
    valued = sum(1 for r in rows if r["value"] is not None)
    assert fired, "no row triggered — the grid cannot detect a change in firing"
    assert fired < len(rows), "every row triggered — the grid is saturated and pins nothing"
    assert valued == len(rows), "some row computed no value — widen the bar series"

    payload = {
        "note": (
            "Recorded from api/services/indicator_alert_evaluator._evaluate_one BEFORE the "
            "B5 alerts-gap change widened INDICATOR_FUNCS from 8 keys to 25 addresses. Every "
            "row is (value, triggered) for one (indicator, condition, threshold, prev, params) "
            "combination. The gate is EXACT equality: these eight addresses must evaluate "
            "bit-for-bit as they did, so no armed alert changes behaviour on the day it ships."
        ),
        "indicators": LEGACY_EIGHT,
        "bars": bars,
        "rows": rows,
        "summary": {"rows": len(rows), "triggered": fired},
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=1, allow_nan=False)
        f.write("\n")
    print(f"wrote {OUT}  ({len(rows)} rows, {fired} triggered, {len(bars)} bars)")


if __name__ == "__main__":
    main()
