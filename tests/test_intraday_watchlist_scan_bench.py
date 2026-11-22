"""RAIL: a watchlist scan never waits on the network for a row it has passed warm (W-L 2026-11-11).

Runs `tools/intraday_watchlist_scan_bench.py` -- the real /charts page + Watchlist widget,
97 ArrowDown presses through the S&P 100 at 250 ms, mock API with the production latency
shape -- in the two scenarios that exposed the lag on origin/master:

  * a list opened 20 minutes before the scan (its prewarm has aged past the paint rule),
    regular and extended hours;
  * an extended-hours view pre-market with a 2 h old cache.

On master these measured keypress->current p50 108-113 ms with 78-89 of 96 switches over
100 ms (every one of them network-bound, i.e. exposed to production's 0.5-1.5 s request
tail at the open). Fixed: p50 ~30 ms, 0 over 100 ms. A switch over 100 ms in this harness
means the chart waited on a request -- the regression this rail exists to catch.

⚠️ LOCAL-ONLY RAIL. CI has neither Playwright's chromium nor a built `app/dist`, so there
it SKIPS (loudly) — it is not a CI gate. Run it before merging anything that touches the
scan path: ``npm run build`` in app/, then ``pytest tests/test_intraday_watchlist_scan_bench.py``
(~4-6 min). The always-on CI rails for the same contract are the vitest invariants
`prefetchBars.paintContract.test.js` and `barsMerge.test.js`.
"""
from __future__ import annotations

import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "app", "dist")

pytest.importorskip("playwright.sync_api", reason="the scan rail drives a real browser")
if not os.path.isfile(os.path.join(DIST, "index.html")):
    pytest.skip("no built app/dist -- run `npm run build` in app/ to arm the scan rail",
                allow_module_level=True)

sys.path.insert(0, os.path.join(ROOT, "tools"))
import intraday_watchlist_scan_bench as bench  # noqa: E402

SCENARIOS = [
    ("CURRENT", "rth", "2026-11-11 10:12", 20),
    ("CURRENT", "eth", "2026-11-11 10:12", 20),
    ("BEHIND", "eth", "2026-11-11 09:00", 0),
    ("BEHIND", "rth", "2026-11-11 09:20", 18),
]


@pytest.mark.parametrize("arm,sess,clock,jump", SCENARIOS)
def test_scan_never_waits_on_the_network(arm, sess, clock, jump):
    out = bench.main([DIST, "rail", arm, "250", sess, clock, str(jump)])
    assert out["switches"] >= 90
    assert out["neverCurrent"] == 0
    # Every network-bound switch costs >= one modelled round trip (>= ~60 ms) on top of the
    # ~30 ms render; > 100 ms is a switch that waited on /api/bars. On master 78-89 of 96
    # switches did (p90 123-135 ms). A handful are tolerated: on a loaded PC the list-open
    # prewarm races the first presses of the scan in the pre-market arm.
    assert out["gt100"] <= 5, out
    assert out["p90"] <= 100, out
    assert out["gt300"] == 0, out
    # The first frame StockChart drew was current for the VIEW (RTH/ETH-filtered tail).
    assert out["firstPaintNotCurrent"] == 0, out
    # The selected row's other timeframes wait for a dwell; a scan does not queue them.
    assert out["req_other_tf"] <= 10, out
