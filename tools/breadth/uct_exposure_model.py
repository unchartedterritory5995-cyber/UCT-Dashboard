"""Build the UCT Exp history: the Morning Wire's Exposure Rating formula, run on every session.

Served by `api/services/breadth_uct_exposure_model.py` (read its docstring first). This is a port of
morning_wire_engine's exposure machine as the wire runs it today (calibration v2, 2026-08-21):

  • `_count_dist`: distribution + stalling days in the last 25 sessions, on SPY and on QQQ (volume
    above its 50-day average; a day expires once the index is 5%+ above that day's close);
  • the phase machine, walked one session at a time: circuit breaker (QQQ 10%+ off its 65-day high
    and under 99% of its 50-day SMA), Confirmed / Under Pressure / Correction from the larger dist
    count, rally attempts off an undercut intraday low, the follow-through day (rally day 4+, QQQ or
    SPY up 1.25%+, QQQ volume up), S2 (close under the FTD's low), B4 power trend, restraint
    (under 1.25% above the FTD's close, before B4);
  • `calculate_exposure` v2: QQQ above its 50-day SMA -> 100, under it but above the 200-day -> 40,
    under both -> 15; Confirmed Uptrend +10, Market in Correction -10; restraint caps at 65, S2 at 40;
    B4 floors at 30, a follow-through day at 40.

The engine reads yfinance daily bars (auto-adjusted), so this does too; the walk starts in 2003 so
the phase state in 2008 is settled. Row D = the machine after D-1's close (the wire runs before the
open). The port is uct-intelligence `scripts/exposure_model_ab.py` + `regime_rules_ab.v2_exposure`.

    python tools/breadth/uct_exposure_model.py OUT.json [--check PUBLISHED.json]

`--check` takes {date: published rating} and prints only match counts (never values).
"""
from __future__ import annotations

import argparse
import json
import sys

VERSION = "uct-exp-model-v1"
FIRST = "2008-01-02"
CUTOVER = "2026-08-22"


def dist_count(c, v, h, l, i):
    """Non-expired distribution + stalling days in the 25 sessions before bar i (`_count_dist`)."""
    n = 0
    cur = c[i]
    for j in range(max(1, i - 25), i + 1):
        if (cur / c[j] - 1) * 100 >= 5.0:
            continue
        a0 = max(0, j - 50)
        avg50 = v[a0:j].mean() if j > a0 else 0.0
        above = avg50 > 0 and v[j] > avg50
        chg = (c[j] / c[j - 1] - 1) * 100
        if chg <= -0.2 and above:
            n += 1
        elif chg >= 0 and above:
            rng = h[j] - l[j]
            if rng > 0 and (c[j] - l[j]) / rng <= 0.25:
                n += 1
    return n


class Machine:
    def __init__(self, spy, qqq):
        q = qqq["c"]
        self.q_ema21 = q.ewm(span=21, adjust=False).mean().values
        self.q_sma50 = q.rolling(50).mean().values
        self.q_sma200 = q.rolling(200).mean().values
        self.sc, self.sv, self.sh, self.sl = (spy[k].values for k in ("c", "v", "h", "l"))
        self.qc, self.qv, self.qh, self.ql = (qqq[k].values for k in ("c", "v", "h", "l"))
        self.phase = "Rally Attempt"
        self.pivot = None
        self.rally_low_i = 0
        self.rally_qualified = True
        self.ftd = False
        self.ftd_low = None
        self.ftd_close = None

    def rally_day(self, i):
        return (i - self.rally_low_i) + (1 if self.rally_qualified else 0)

    def _reset_correction(self, i):
        self.phase = "Market in Correction"
        self.ftd = False
        self.ftd_low = self.ftd_close = None
        self.rally_low_i = i
        self.rally_qualified = True

    def step(self, i):
        qc, ql, qh = self.qc[i], self.ql[i], self.qh[i]
        max_d = max(dist_count(self.sc, self.sv, self.sh, self.sl, i),
                    dist_count(self.qc, self.qv, self.qh, self.ql, i))
        hi65 = self.qc[max(0, i - 64):i + 1].max()
        breaker = (qc / hi65 - 1) * 100 <= -10.0 and qc < self.q_sma50[i] * 0.99
        if breaker and self.phase not in ("Market in Correction", "Rally Attempt"):
            self._reset_correction(i)
            self.pivot = None
        elif max_d <= 3 and self.ftd:
            self.phase = "Confirmed Uptrend"
        elif 4 <= max_d <= 5:
            if self.phase == "Confirmed Uptrend":
                self.phase = "Uptrend Under Pressure"
        elif max_d >= 6:
            if self.phase not in ("Market in Correction", "Rally Attempt"):
                self._reset_correction(i)

        if self.pivot is None:
            self.pivot = ql
        if self.phase in ("Market in Correction", "Rally Attempt", "Uptrend Under Pressure"):
            if ql < self.pivot:
                rng = qh - ql
                self.phase = "Rally Attempt"
                self.ftd = False
                self.ftd_low = self.ftd_close = None
                self.pivot = ql
                self.rally_low_i = i
                self.rally_qualified = qc > self.qc[i - 1] and (rng <= 0 or (qc - ql) / rng >= 0.5)
        else:
            self.pivot = None

        ftd_today = False
        if (self.phase in ("Market in Correction", "Rally Attempt", "Uptrend Under Pressure")
                and self.rally_day(i) >= 4 and i >= 1):
            q_chg = (self.qc[i] / self.qc[i - 1] - 1) * 100
            s_chg = (self.sc[i] / self.sc[i - 1] - 1) * 100
            if (q_chg >= 1.25 or s_chg >= 1.25) and self.qv[i] > self.qv[i - 1]:
                self.ftd = True
                self.phase = "Confirmed Uptrend"
                ftd_today = True
                self.ftd_low = ql
                self.ftd_close = qc

        lod = 0
        for j in range(i, max(0, i - 60), -1):
            if self.ql[j] >= self.q_ema21[j]:
                lod += 1
            else:
                break
        e_gt_s = 0
        for j in range(i, max(0, i - 60), -1):
            if self.q_ema21[j] > self.q_sma50[j]:
                e_gt_s += 1
            else:
                break
        b4 = lod >= 10 and e_gt_s >= 5 and self.q_sma50[i] > self.q_sma50[i - 1]

        restraint = (self.ftd and not b4 and self.ftd_close is not None
                     and qc < self.ftd_close * 1.0125)
        s2 = self.ftd_low is not None and qc < self.ftd_low
        if s2 and self.phase in ("Confirmed Uptrend", "Uptrend Under Pressure"):
            self.phase = "Rally Attempt"
            self.ftd = False
            restraint = False
            self.ftd_low = self.ftd_close = None
        return {"phase": self.phase, "ftd_today": ftd_today, "restraint": restraint, "s2": s2, "b4": b4}

    def exposure(self, i, day):
        """`calculate_exposure`, calibration v2."""
        qc = self.qc[i]
        base = 100 if qc >= self.q_sma50[i] else (40 if qc >= self.q_sma200[i] else 15)
        adj = {"Confirmed Uptrend": 10, "Market in Correction": -10}.get(day["phase"], 0)
        ceiling, floor = 150, 0
        if day["ftd_today"]:
            floor = max(floor, 40)
        if day["restraint"]:
            ceiling = min(ceiling, 65)
        if day["s2"]:
            ceiling = min(ceiling, 40)
        if day["b4"]:
            floor = max(floor, 30)
        return max(floor, min(ceiling, base + adj))


def load_bars(start="2003-01-02"):
    import pandas as pd
    import yfinance as yf
    idx = yf.download(["SPY", "QQQ"], start=start, interval="1d", auto_adjust=True, progress=False)
    f = {t: pd.DataFrame({"c": idx["Close"][t], "h": idx["High"][t], "l": idx["Low"][t],
                          "v": idx["Volume"][t]}).dropna() for t in ("SPY", "QQQ")}
    common = f["SPY"].index.intersection(f["QQQ"].index)
    return f["SPY"].loc[common], f["QQQ"].loc[common]


def build(spy, qqq) -> dict:
    """{date D: the rating the wire would have published on the morning of D}."""
    m = Machine(spy, qqq)
    dates = [str(d.date()) for d in spy.index]
    out = {}
    for i in range(1, len(dates)):
        day = m.step(i)
        if i < 200 or i + 1 >= len(dates):
            continue
        d = dates[i + 1]                 # published the next morning
        if FIRST <= d < CUTOVER:
            out[d] = float(m.exposure(i, day))
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--check", help="{date: published rating} json; prints match counts only")
    a = ap.parse_args(argv)
    spy, qqq = load_bars()
    rows = build(spy, qqq)
    if a.check:
        # grade the same machine on the sessions the wire published (past CUTOVER)
        pub = json.load(open(a.check))
        m = Machine(spy, qqq)
        dates = [str(d.date()) for d in spy.index]
        graded = {}
        for i in range(1, len(dates) - 1):
            day = m.step(i)
            if dates[i + 1] in pub:
                graded[dates[i + 1]] = float(m.exposure(i, day)) == float(pub[dates[i + 1]])
        for lo, hi in ((CUTOVER, "2026-09-24"), ("2026-09-25", "9999")):
            sel = [ok for d, ok in graded.items() if lo <= d <= hi]
            print(f"published {lo}..{hi}: {sum(sel)} of {len(sel)} identical")
    doc = {"version": VERSION, "formula": "morning_wire_engine calculate_exposure, calibration v2",
           "first": min(rows), "last": max(rows), "rows": rows}
    with open(a.out, "w") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    print(f"wrote {len(rows)} sessions {doc['first']}..{doc['last']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
