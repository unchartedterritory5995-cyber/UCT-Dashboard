"""F7 (step 93) -- ``ta.wma``'s FFILL warm-up, Python lane against the JS lane.

The fixture ``tests/fixtures/ast/ffill_warmup_parity.json`` is written by (and
asserted equal to) the JS lane's ``interpret.js::FN.wma`` in
``vendorHarness.f7HostWmaWarmup.test.js``. Here the Python lane's ``_rolling``
(through the ``wma`` window function) must answer on exactly the same bars with
the same values: one rule -- the first answer on the n-th FINITE input, a hole in
the lookback carried at its own weight, ``na`` on an ``na`` bar.
"""
import json
import math
import os

import pytest

from api.services import ast_interpret as A

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "ast", "ffill_warmup_parity.json")
DATA = json.load(open(FIXTURE, encoding="utf-8"))
NAN = float("nan")


def _wma(x, n):
    return A._rolling(x, n, A._window_weighted_mean, A.WINDOW_NA["wma"])


def test_wma_is_the_ffill_member():
    assert A.WINDOW_NA["wma"] == A.NA_FFILL


def test_fixture_is_not_vacuous():
    cases = DATA["cases"]
    assert len(cases) >= 12
    # at least one case where the count rule and the full-window rule disagree
    separating = [c for c in cases if c["name"].startswith("finite on bar 0") and c["n"] == 4]
    assert separating and next(i for i, v in enumerate(separating[0]["wma"]) if v is not None) == 12


@pytest.mark.parametrize("case", DATA["cases"], ids=lambda c: "%s-n%d" % (c["name"], c["n"]))
def test_python_lane_equals_js_lane(case):
    x = [NAN if v is None else float(v) for v in case["x"]]
    out = _wma(x, case["n"])
    assert len(out) == len(case["wma"])
    for i, (got, want) in enumerate(zip(out, case["wma"])):
        if want is None:
            assert not math.isfinite(got), "bar %d: JS is na, Python %r" % (i, got)
        else:
            assert math.isfinite(got), "bar %d: JS %r, Python na" % (i, want)
            assert abs(got - want) <= 1e-12 * max(1.0, abs(want)), "bar %d" % i
