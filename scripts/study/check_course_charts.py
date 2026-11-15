"""Study -- check every course chart against real daily bars, the way the server will draw it (2026-11-14).

WHY
---
A course question may carry `chart: {sym, asof, window, forward, trade?}`. The importer resolves it on the pod from the
server's own bars.db (api/routers/study.resolve_bars: `get_bars_before`, never a provider fetch), the drill shows the
bars up to `asof`, and after the answer it replays the bars after it, drawing the trade. On 2026-11-14 the checkers of
the chart rollout found stories the bars contradict (a dossier's "up 3.9R the day before the report" when the close was
2.5R; "gapped down" on a day that opened above the stop). This reads a COPY of the pod's bars.db (read only) and checks,
for every charted question:

  - the chart resolves: the symbol has daily bars, and the last visible bar IS `asof` (a trading day with data);
  - there is history to draw (at least half the window) and bars to replay (at least the reveal's first strip);
    the replay plays the chart's `forward` days, up to the server's 60 (the drill fetches past the reveal's 20);
  - a drawn trade traded on its day: the entry inside the asof bar's range (long or short), the stop beyond the day's
    extreme in the trade's favour (under the low for a long, over the high for a short), and the stop within 6% of the
    entry (the house allows up to 5%; past that the chart and the words disagree on the setup);
  - what the replay shows of the trade in the bars the member will see: the best R and whether the stop is hit, so a
    story's outcome can be compared with the chart (printed, not judged: the words are the writer's).

    python -m scripts.study.check_course_charts --bars C:/path/to/bars.db [--unit SET.08 ...] [--json out.json]

Exit 1 when any chart fails a check. Prints counts only, never prices beyond each question's own levels.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import sqlite3
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

#: the server's own numbers (api/routers/study.py): calendar days per forward bar, the strip the reveal carries, and
#: how far the server tops a chart's strip up (the drill fetches the rest past the reveal, up to the chart's `forward`)
FORWARD_HORIZON_DAYS_D = 2
REVEAL_FORWARD_BARS = 20
FORWARD_WANT = 60
MAX_STOP_PCT = 6.0


def _key(d: str) -> int:
    return int(d.replace("-", ""))


def _bars_before(c, sym: str, n: int, to_key: int) -> list[tuple]:
    # the same query as api/services/bars_sqlite.get_bars_before
    rows = c.execute("SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf='D' AND ts<=? ORDER BY ts DESC LIMIT ?",
                     (sym.upper(), int(to_key), int(n))).fetchall()
    return rows[::-1]


def resolve(c, chart: dict) -> dict:
    """As api/routers/study.resolve_bars does for a daily spec."""
    sym, window, fwd_n = str(chart["sym"]).upper(), int(chart.get("window", 120)), int(chart.get("forward", 20))
    asof = _key(chart["asof"])
    visible = _bars_before(c, sym, window, asof)
    d = dt.date(asof // 10000, (asof // 100) % 100, asof % 100)
    fwd_to = int((d + dt.timedelta(days=fwd_n * FORWARD_HORIZON_DAYS_D + 7)).strftime("%Y%m%d"))
    later = _bars_before(c, sym, window + fwd_n + 50, fwd_to) if fwd_n > 0 else []
    forward = [r for r in later if int(r[0]) > asof][:fwd_n]
    return {"visible": visible, "forward": forward}


def check_question(c, unit: str, q: dict) -> dict:
    ch = q["chart"]
    r = resolve(c, ch)
    vis, fwd = r["visible"], r["forward"]
    out = {"unit": unit, "key": q["key"], "sym": ch["sym"], "asof": ch["asof"], "problems": [], "notes": []}
    if not vis:
        out["problems"].append("no daily bars for the symbol up to asof (the importer will report a miss)")
        return out
    if int(vis[-1][0]) != _key(ch["asof"]):
        out["problems"].append(f"asof {ch['asof']} is not a bar: the last visible bar is {vis[-1][0]}")
    if len(vis) < int(ch.get("window", 120)) // 2:
        out["problems"].append(f"only {len(vis)} bars of history for a window of {ch.get('window', 120)}")
    want = int(ch.get("forward", 20))
    if want and len(fwd) < min(want, REVEAL_FORWARD_BARS):
        out["problems"].append(f"only {len(fwd)} bars after asof (the replay wants {min(want, REVEAL_FORWARD_BARS)})")
    shown = fwd[:min(want, FORWARD_WANT)]
    if want > FORWARD_WANT:
        out["notes"].append(f"forward {want}: the replay plays the first {FORWARD_WANT} (the server's top-up)")
    tr = ch.get("trade")
    if tr:
        e, s = float(tr["entry"]), float(tr["stop"])
        short = tr.get("direction") == "bearish"
        b = vis[-1]
        lo, hi = float(b[3]), float(b[2])
        if not (lo - 0.01 <= e <= hi + 0.01):
            out["problems"].append(f"entry {e} is outside the asof bar's range {lo}-{hi}: it did not trade that day")
        if (not short and s > lo + 0.005) or (short and s < hi - 0.005):
            out["problems"].append(f"stop {s} is not beyond the day's {'high' if short else 'low'} ({hi if short else lo})")
        risk = abs(e - s)
        if e and risk / e * 100 > MAX_STOP_PCT:
            out["problems"].append(f"stop is {risk / e * 100:.1f}% from the entry")
        if risk > 0:
            best, stopped, after = 0.0, None, None
            for k, row in enumerate(shown, start=1):
                h, l = float(row[2]), float(row[3])
                r_k = ((h - e) if not short else (e - l)) / risk
                if stopped:
                    after = max(after, r_k)
                    continue
                if (not short and l <= s) or (short and h >= s):
                    stopped, after = k, r_k
                    continue
                best = max(best, r_k)
            # what the replay shows AFTER the stop too: a story that says "it later reached 5R without us" must have a
            # replay long enough to show it (2026-11-14: an MU question said so over 10 replayed days that never got
            # back to the buy; 5R came on day 15)
            out["notes"].append(f"in the {len(shown)} replayed bars: best {best:.1f}R"
                                + (f", stopped on day {stopped}, after the stop it reaches {after:.1f}R" if stopped else ", stop not hit"))
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--bars", required=True, help="a copy of the pod's bars.db (opened read only)")
    ap.add_argument("--unit", nargs="*", default=None)
    ap.add_argument("--json", default="")
    ap.add_argument("--all", action="store_true", help="also check questions that are not live (verify status pass)")
    args = ap.parse_args(argv)
    c = sqlite3.connect(f"file:{pathlib.Path(args.bars).as_posix()}?mode=ro", uri=True)
    results = []
    for path in sorted((REPO / "docs/study/courses").glob("*/*.json")):
        d = json.loads(path.read_bytes().decode("utf-8"))
        if args.unit and d.get("unit") not in args.unit:
            continue
        live = {k for k, v in (d.get("verify") or {}).items() if (v or {}).get("status") == "pass"}
        for q in d.get("questions") or []:
            if q.get("chart") and (args.all or q["key"] in live):
                results.append(check_question(c, d["unit"], q))
    bad = [r for r in results if r["problems"]]
    for r in results:
        if r["problems"] or r["notes"]:
            print(f"{r['unit']} {r['key']} {r['sym']} {r['asof']}: " + "; ".join(r["problems"] + r["notes"]))
    print(json.dumps({"charts": len(results), "failing": len(bad)}))
    if args.json:
        pathlib.Path(args.json).write_text(json.dumps(results, indent=1), encoding="utf-8")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
