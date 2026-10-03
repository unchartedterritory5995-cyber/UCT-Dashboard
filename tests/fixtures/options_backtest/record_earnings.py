"""Record the vendor replay for FT-011 (earnings anchor + more structures) -- no network, ever.

⛔ SYNTHETIC, like record.py (read its docstring): the same SPY-like market, the same Black-Scholes
quotes, the same field shapes. It adds the one request shape the earnings anchor makes (the
contracts list over a RANGE of expirations, `expiration_date.gte/.lte`, which lists every Friday
session in range) and a fixed list of past prints. tests/test_options_backtest_more.py replays
the recorded file STRICTLY: a request not in it raises.

The prints (newest first, as the engine's reader returns them):
  * 2026-07-22 "post-market"  -> AMC: enter 07-22 close, exit 07-23 close
  * 2026-04-23 "pre-market"   -> BMO: enter 04-22 close, exit 04-23 close
  * 2026-01-28 ""             -> timing not on file: EXCLUDED and counted
  * 2025-10-22 "amc"          -> AMC: enter 10-22 close, exit 10-23 close
  * 2026-10-20 "amc"          -> in the future on 2026-10-02: not read

Run:  python -m tests.fixtures.options_backtest.record_earnings
"""
from __future__ import annotations

import json
import math
import os
from datetime import date

from tests.fixtures.options_backtest import record as base

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "spy_earnings_replay.json")

PRINTS = [
    {"reportedDate": "2026-10-20", "reportTime": "amc"},
    {"reportedDate": "2026-07-22", "reportTime": "post-market"},
    {"reportedDate": "2026-04-23", "reportTime": "pre-market"},
    {"reportedDate": "2026-01-28", "reportTime": ""},
    {"reportedDate": "2025-10-22", "reportTime": "amc"},
]

RUNS = [
    {"strategy": "long_straddle", "anchor": "earnings"},
    {"strategy": "iron_condor", "anchor": "earnings", "width": 1},
    {"strategy": "bear_call", "dte": 30, "offset": 1, "width": 1},
    {"strategy": "short_strangle", "dte": 14, "width": 2, "take_profit_pct": 50},
    {"strategy": "call_butterfly", "dte": 30, "width": 1},
]


def synth(path: str, params: dict) -> dict:
    if path == "/v3/reference/options/contracts" and "expiration_date.gte" in params:
        lo_e = date.fromisoformat(params["expiration_date.gte"])
        hi_e = date.fromisoformat(params["expiration_date.lte"])
        lo, hi = float(params["strike_price.gte"]), float(params["strike_price.lte"])
        kind = params["contract_type"]
        out = []
        for d in base.SESS:
            if d.weekday() != 4 or not lo_e <= d <= hi_e:
                continue
            k = math.ceil(lo / 5) * 5
            while k <= hi:
                out.append({"ticker": base._occ(d, kind, k), "strike_price": k, "contract_type": kind,
                            "expiration_date": d.isoformat()})
                k += 5
        return {"results": out}
    return base.synth(path, params)


def main() -> None:
    os.environ["OPTIONS_BACKTEST_MORE_ENABLED"] = "1"
    from api.services import options_backtest as ob
    recorded: dict[str, dict] = {}

    def rec(path, params):
        out = synth(path, params)
        recorded[base.key(path, params)] = out
        return out

    for raw in RUNS:
        p = ob.normalize_params("SPY", raw)
        ob.run_backtest(p, ob.Vendor(rec), base.TODAY, prints=lambda _s: PRINTS)
    payload = {"_readme": __doc__.strip().splitlines()[0] + " See record_earnings.py.",
               "today": base.TODAY.isoformat(), "runs": RUNS, "prints": PRINTS, "responses": recorded}
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(payload, fh, indent=0, sort_keys=True)
    os.replace(tmp, OUT)
    print(f"recorded {len(recorded)} responses -> {OUT}")


if __name__ == "__main__":
    main()
