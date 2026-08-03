"""Dark-Pool Reclaim Confluence (dpc-v1) — pure logic.

evaluate() composes dark-pool levels + daily bars + a flow join. These cover the
reclaim/breakdown gates and the three ways a candidate is rejected (wrong flow
side, no prior cross, price too far from the level)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.services.signature import confluence
from api.services.signature.flow_breakout import _bar_date_iso

LEVEL = {"price": 100.0, "lo": 99.0, "hi": 101.0, "notional": 50e6,
         "rank": 1, "printCount": 5, "lastDate": "2026-07-15"}


def _bars(closes):
    # t as YYYYMMDD ints ascending (July 1-N), the daily-bar encoding _bar_date_iso reads.
    return [{"t": 20260701 + i, "o": c, "h": c + 1, "l": c - 1, "c": float(c), "v": 1_000_000}
            for i, c in enumerate(closes)]


def _flow(bars, side, prem="2M", n=5):
    isos = {_bar_date_iso(b["t"]) for b in bars[-n:]}
    return {iso: [{"CreatedDate": "", "CallPut": side, "Premium": prem}] for iso in isos}


def test_bull_reclaim_with_calls():
    b = _bars([97, 98, 97, 98, 100, 101, 102])   # was below 99, reclaimed >101, holding
    sigs = confluence.evaluate([LEVEL], b, _flow(b, "CALL"))
    assert len(sigs) == 1 and sigs[0]["direction"] == "bull"
    assert sigs[0]["holdDays"] == 1 and sigs[0]["pctFromLevel"] == 2.0


def test_bull_reclaim_but_put_flow_no_signal():
    b = _bars([97, 98, 97, 98, 100, 101, 102])
    assert confluence.evaluate([LEVEL], b, _flow(b, "PUT")) == []


def test_always_above_is_not_a_reclaim():
    b = _bars([102, 103, 102, 103, 102, 103, 102])   # never below the zone
    assert confluence.evaluate([LEVEL], b, _flow(b, "CALL")) == []


def test_reclaimed_but_too_far_above_not_near():
    b = _bars([97, 98, 97, 98, 100, 101, 110])       # 110 is 10% above -> outside prox band
    assert confluence.evaluate([LEVEL], b, _flow(b, "CALL")) == []


def test_bear_breakdown_with_puts():
    b = _bars([103, 102, 103, 102, 100, 99, 98])     # was above 101, lost <99, holding
    sigs = confluence.evaluate([LEVEL], b, _flow(b, "PUT"))
    assert len(sigs) == 1 and sigs[0]["direction"] == "bear"


def test_no_levels_or_bars_is_empty():
    assert confluence.evaluate([], _bars([100]), {}) == []
    assert confluence.evaluate([LEVEL], [], {}) == []
