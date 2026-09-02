"""⭐⭐ THE CHART AND THE SCREEN MUST BE ONE NUMBER, on every script a member
would write to screen with.

`app/src/components/chart/engine/ast/pine.screenerCorpus.test.js` proves the
36 fixtures in ``tests/fixtures/pine_screener`` translate and yield BOOLEAN
columns. It cannot prove the Python lane computes the same values, because
translation is JS-only — and that is the reliability claim a member actually
depends on: the column they chart and the column the screen filters on have to
be the same column.

⛔⛔ THE CONFORMANCE CORPUS DOES NOT COVER THIS. Its 144 cases are curated, one
per construct, chosen to isolate a disagreement. These are whole member-shaped
screens — `ta.bb` destructures, `ta.macd` histograms, 252-bar highs, nested
and/or — composed the way somebody actually writes them, and run over 400 REAL
SPY daily bars rather than a synthetic ramp.

⚠️ THE FIXTURE IS GENERATED, NOT WRITTEN, and its generator re-derives it every
run (`screenerColumns.test.js`), so this file cannot end up asserting agreement
about formulas the doors stopped producing.
"""

import json
import math
import pathlib

import pytest

from tools import ast_conformance as ac

ROOT = pathlib.Path(__file__).resolve().parents[1]
COLUMNS = ROOT / "tests" / "fixtures" / "ast" / "screener_columns.json"
REPLAY = ROOT / "tests" / "fixtures" / "alerts" / "replay_bars.json"


def _load():
    doc = json.loads(COLUMNS.read_text(encoding="utf-8"))
    ptr = doc["bars"]
    rel, key = ptr.split("#", 1)
    bars = json.loads((ROOT / rel).read_text(encoding="utf-8"))["fixtures"][key]["bars"]
    return doc["cases"], bars


def _is_nan(v):
    return v is None or (isinstance(v, float) and math.isnan(v))


def test_the_two_lanes_agree_on_every_screener_column():
    """⭐ 34 scripts × 400 real bars, compared value by value.

    ⛔ A NaN ON ONE SIDE ONLY IS A DISAGREEMENT, not a bar to skip. Two columns
    with different warmups would otherwise "agree" on their overlap while the
    screen and the chart disagreed about which symbols even qualify.
    """
    cases, bars = _load()
    assert len(cases) >= 34, "the generated fixture emptied; the claim would be vacuous"
    assert len(bars) >= 300, "too few bars to reach the 252-bar windows these scripts use"

    js = ac.run_js(cases, bars)
    py = ac.run_py(cases, bars)

    worst = 0.0
    worst_at = None
    disagreements = []
    finite = 0
    for case in cases:
        a, b = js[case["id"]], py[case["id"]]
        if len(a) != len(b):
            disagreements.append(f"{case['id']}: {len(a)} values vs {len(b)}")
            continue
        for i, (x, y) in enumerate(zip(a, b)):
            if _is_nan(x) != _is_nan(y):
                disagreements.append(f"{case['id']} bar {i}: {x!r} vs {y!r}")
                break
            if _is_nan(x):
                continue
            finite += 1
            d = abs(float(x) - float(y))
            if d > worst:
                worst, worst_at = d, f"{case['id']}@{i}"

    assert not disagreements, "lanes disagree: " + "; ".join(disagreements[:6])
    # ⭐ THE DENOMINATOR IS ASSERTED TOO. Without it a fixture whose every column
    # was all-NaN would pass this test having compared nothing.
    assert finite > 10000, f"only {finite} finite values compared — the corpus is not exercising the bars"
    assert worst < 1e-9, f"max |JS - PY| = {worst:.3e} at {worst_at}"


def test_the_comparison_can_actually_fail():
    """⛔ THE CONTROL. Every number above is 0.000e+00, which is exactly what a
    broken comparison also reports. This feeds the SAME machinery a case whose
    two lanes are known to differ — by handing one lane a different tree — and
    asserts the harness notices.
    """
    cases, bars = _load()
    one = dict(cases[0])
    mutated = dict(one)
    # `x + 1` against `x` — same shape, same length, different values.
    mutated = {
        "id": one["id"],
        "source": one["source"],
        "ast": {"type": "op", "name": "+",
                "args": [one["ast"], {"type": "num", "value": 1}]},
    }
    js = ac.run_js([one], bars)
    py = ac.run_py([mutated], bars)
    a, b = js[one["id"]], py[one["id"]]
    gap = max(
        abs(float(x) - float(y))
        for x, y in zip(a, b)
        if not _is_nan(x) and not _is_nan(y)
    )
    assert gap >= 1.0, "the harness cannot tell two different columns apart"
