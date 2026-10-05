"""Record the vendor replay that tests/test_options_backtest.py reads (no network, ever).

⛔ WHAT THIS IS, SAID PLAINLY: a SYNTHETIC vendor, not a capture of Massive. Every response is
built in the exact field shape the repo's existing Massive readers consume (results[].c/.t for
aggs, results[].strike_price/contract_type/ticker for contracts, results[].bid_price/ask_price/
sip_timestamp for quotes -- see api/services/implied_backfill.py), and the run then RECORDS every
request the backtester actually made. The tests replay that file STRICTLY: a request that is not
in it raises, so a change to the request shape turns the suite red instead of passing quietly.
A live run against our key before arming is still owed (feature_flags.json says so).

The synthetic market: SPY-like closes on a session calendar with real 2025/26 NYSE holidays,
option mids = Black-Scholes at sigma 0.20 (r 4%), bid/ask = mid -/+ 0.05. Planted faults:
  * 2025-11-21 expiry: the contracts endpoint returns NO ladder        -> excluded, counted
  * 2026-01-16 expiry: the entry quote is ONE-SIDED (bid 0)             -> excluded, counted
  * 2026-03-20 expiry: NO quote at all on the entry session             -> excluded, counted
  * 2026-06-19 is Juneteenth: June's monthly expires Thursday 2026-06-18.

Run:  python -m tests.fixtures.options_backtest.record
"""
from __future__ import annotations

import json
import math
import os
from datetime import date, datetime, timedelta
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

from api.services import options_backtest as ob

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "spy_replay.json")
TODAY = date(2026, 10, 2)
NY = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")
HOLIDAYS = {date(2025, 9, 1), date(2025, 11, 27), date(2025, 12, 25), date(2026, 1, 1),
            date(2026, 1, 19), date(2026, 2, 16), date(2026, 4, 3), date(2026, 5, 25),
            date(2026, 6, 19), date(2026, 7, 3), date(2026, 9, 7)}
SIGMA = 0.20

RUNS = [
    {"strategy": "long_call", "dte": 30, "offset": 0},
    {"strategy": "bull_call", "dte": 14, "offset": 0, "width": 2},
    {"strategy": "long_call", "dte": 7, "offset": 1, "take_profit_pct": 50, "stop_loss_pct": 50},
    {"strategy": "long_put", "dte": 45, "offset": -1},
]


def key(path: str, params: dict) -> str:
    return path + "?" + urlencode(sorted((k, str(v)) for k, v in params.items()))


def sessions():
    d, out = date(2025, 6, 1), []
    while d <= TODAY:
        if d.weekday() < 5 and d not in HOLIDAYS:
            out.append(d)
        d += timedelta(days=1)
    return out


SESS = sessions()
CLOSE = {d: round(560 + 25 * math.sin(i / 11.0) + 0.12 * i, 2) for i, d in enumerate(SESS)}


def _ms_midnight_et(d: date) -> int:
    return int(datetime(d.year, d.month, d.day, tzinfo=NY).astimezone(UTC).timestamp() * 1000)


def _occ(exp: date, kind: str, k: float) -> str:
    return f"O:SPY{exp.strftime('%y%m%d')}{'C' if kind == 'call' else 'P'}{int(round(k * 1000)):08d}"


def synth(path: str, params: dict) -> dict:
    if path.startswith("/v2/aggs/ticker/SPY/range/1/day/"):
        a, b = path.rsplit("/", 2)[-2:]
        lo, hi = date.fromisoformat(a), date.fromisoformat(b)
        return {"results": [{"t": _ms_midnight_et(d), "c": CLOSE[d], "o": CLOSE[d], "v": 1}
                            for d in SESS if lo <= d <= hi]}
    if path == "/v3/reference/options/contracts":
        exp = date.fromisoformat(params["expiration_date"])
        if exp == date(2025, 11, 21):
            return {"results": []}
        lo, hi = float(params["strike_price.gte"]), float(params["strike_price.lte"])
        kind = params["contract_type"]
        k = math.ceil(lo / 5) * 5
        out = []
        while k <= hi:
            out.append({"ticker": _occ(exp, kind, k), "strike_price": k, "contract_type": kind,
                        "expiration_date": exp.isoformat()})
            k += 5
        return {"results": out}
    if path.startswith("/v3/quotes/O:SPY"):
        tick = path.rsplit("/", 1)[-1]
        exp = datetime.strptime(tick[5:11], "%y%m%d").date()
        kind = "call" if tick[11] == "C" else "put"
        k = int(tick[12:]) / 1000
        day = datetime.strptime(params["timestamp.lte"], "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=UTC).astimezone(NY).date()
        s = CLOSE[day]
        t = (exp - day).days / 365.0
        mid = ob.bs_price(kind, s, k, t, SIGMA)
        bid, ask = round(mid - 0.05, 2), round(mid + 0.05, 2)
        entry_30 = SESS[SESS.index(exp) - 30] if exp in SESS else None
        if exp == date(2026, 3, 20) and day == entry_30:
            return {"results": []}
        if exp == date(2026, 1, 16) and day == entry_30:
            bid = 0.0
        if bid <= 0:
            bid = 0.0
        ts = datetime(day.year, day.month, day.day, 15, 59, 58, tzinfo=NY)
        return {"results": [{"bid_price": bid, "ask_price": max(ask, 0.05), "bid_size": 10,
                             "ask_size": 10, "sip_timestamp": int(ts.timestamp() * 1e9)}]}
    raise AssertionError(f"no synthetic answer for {path}")


def main() -> None:
    recorded: dict[str, dict] = {}

    def rec(path, params):
        out = synth(path, params)
        recorded[key(path, params)] = out
        return out

    for raw in RUNS:
        p = ob.normalize_params("SPY", raw)
        ob.run_backtest(p, ob.Vendor(rec), TODAY)
    payload = {"_readme": __doc__.strip().splitlines()[0] + " See record.py.",
               "today": TODAY.isoformat(), "runs": RUNS, "responses": recorded}
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(payload, fh, indent=0, sort_keys=True)
    os.replace(tmp, OUT)
    print(f"recorded {len(recorded)} responses -> {OUT}")


if __name__ == "__main__":
    main()
