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
import re
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
#: the history courses_lib loads ahead of a course chart's window so the averages are formed (the bank's bars.window)
from scripts.study.courses_lib import INTRADAY_TFS, INTRADAY_WARMUP, WARMUP_BARS, intraday_key  # noqa: E402
NAMES_200 = re.compile(r"\b200[- ]?(?:day|SMA|DMA)\b", re.I)
NEGATED = re.compile(r"\b(no|not|without|never)\b|n't\b", re.I)


def _key(d: str) -> int:
    return int(d.replace("-", ""))


def _bars_before(c, sym: str, n: int, to_key: int, tf: str = "D") -> list[tuple]:
    # the same query as api/services/bars_sqlite.get_bars_before
    rows = c.execute("SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf=? AND ts<=? ORDER BY ts DESC LIMIT ?",
                     (sym.upper(), tf, int(to_key), int(n))).fetchall()
    return rows[::-1]


def asof_key_of(chart: dict) -> int:
    """The last visible bar's key: YYYYMMDD for a daily chart, the bar's unix start for an intraday one."""
    if str(chart.get("tf") or "D") in INTRADAY_TFS:
        return intraday_key(str(chart["asof"]))
    return _key(str(chart["asof"]))


def resolve(c, chart: dict) -> dict:
    """As api/routers/study.resolve_bars does for a daily spec."""
    sym, window, fwd_n = str(chart["sym"]).upper(), int(chart.get("window", 120)), int(chart.get("forward", 20))
    tf = str(chart.get("tf") or "D")
    if tf in INTRADAY_TFS:
        # the bank's spec: the bar's unix start, and an end a week on, of which the first `forward` bars after asof
        # the regular session only, as the server resolves an `rth` spec and the pod's fill stores it (bars.db keeps
        # the extended session too)
        from api.routers.study import _regular_session
        key0 = intraday_key(str(chart["asof"]))
        want = window + INTRADAY_WARMUP
        visible = [r for r in _bars_before(c, sym, want * 4 + 400, key0, tf) if _regular_session(int(r[0]))][-want:]
        later = _bars_before(c, sym, (want + fwd_n) * 4 + 800, key0 + 7 * 86400, tf) if fwd_n > 0 else []
        return {"visible": visible, "forward": [r for r in later if int(r[0]) > key0 and _regular_session(int(r[0]))][:fwd_n]}
    window += WARMUP_BARS            # the bank asks for the window plus the averages' history (courses_lib)
    asof = _key(chart["asof"])
    visible = _bars_before(c, sym, window, asof)
    d = dt.date(asof // 10000, (asof // 100) % 100, asof % 100)
    fwd_to = int((d + dt.timedelta(days=fwd_n * FORWARD_HORIZON_DAYS_D + 7)).strftime("%Y%m%d"))
    later = _bars_before(c, sym, window + fwd_n + 50, fwd_to) if fwd_n > 0 else []
    forward = [r for r in later if int(r[0]) > asof][:fwd_n]
    return {"visible": visible, "forward": forward}


def check_bars(chart: dict, vis: list, fwd: list, words: str = "") -> tuple[list[str], list[str]]:
    """(problems, notes) for one chart's bars, as the member will see them: `vis` the visible rows (oldest first, the
    last one the decision bar), `fwd` the replay's rows; each row (ts, o, h, l, c, v). Shared with the pod's
    fill_course_intraday.py, which fetches an intraday chart's bars and stores only the charts this passes."""
    problems: list[str] = []
    notes: list[str] = []
    intraday = str(chart.get("tf") or "D") in INTRADAY_TFS
    unit = "bar" if intraday else "day"
    if not vis:
        return [f"no {'intraday' if intraday else 'daily'} bars for the symbol up to asof (the importer will report a miss)"], notes
    if int(vis[-1][0]) != asof_key_of(chart):
        problems.append(f"asof {chart['asof']} is not a bar: the last visible bar is {vis[-1][0]}")
    if len(vis) < int(chart.get("window", 120)) // 2:
        problems.append(f"only {len(vis)} bars of history for a window of {chart.get('window', 120)}")
    if not intraday:
        # a chart whose words name the 200-day must be able to draw it on the decision day (200 bars of history by asof);
        # a sentence saying the line is ABSENT ("a young stock has no 200-day yet") agrees with a chart that cannot draw it
        named = [x for x in re.split(r"(?<=[.!?])\s+", words) if NAMES_200.search(x) and not NEGATED.search(x)]
        if named and len(vis) < 200:
            problems.append(f"the words name the 200-day but only {len(vis)} bars exist by asof: the line cannot be drawn")
    want = int(chart.get("forward", 20))
    if want and len(fwd) < min(want, REVEAL_FORWARD_BARS):
        problems.append(f"only {len(fwd)} bars after asof (the replay wants {min(want, REVEAL_FORWARD_BARS)})")
    shown = fwd[:min(want, FORWARD_WANT)]
    if want > FORWARD_WANT:
        notes.append(f"forward {want}: the replay plays the first {FORWARD_WANT} (the server's top-up)")
    tr = chart.get("trade")
    if tr:
        e, s = float(tr["entry"]), float(tr["stop"])
        short = tr.get("direction") == "bearish"
        b = vis[-1]
        lo, hi = float(b[3]), float(b[2])
        if not (lo - 0.01 <= e <= hi + 0.01):
            problems.append(f"entry {e} is outside the asof bar's range {lo}-{hi}: it did not trade that {unit}")
        if (not short and s > lo + 0.005) or (short and s < hi - 0.005):
            problems.append(f"stop {s} is not beyond the {unit}'s {'high' if short else 'low'} ({hi if short else lo})")
        risk = abs(e - s)
        # the buy day itself can pass 3R / 5R after the fill (2026-11-14: WSM, KRMN, COIN and INOD said "the next
        # session" / "in two sessions" when the buy day had already run through both; the answer card says "hit on
        # the signal day"). Reported when the day opened on the buy's side, so the high came after the fill.
        if risk > 0 and ((not short and float(b[1]) <= e + 0.01) or (short and float(b[1]) >= e - 0.01)):
            day_r = ((hi - e) if not short else (e - lo)) / risk
            if day_r >= 3:
                notes.append(f"the buy {unit} itself reaches {day_r:.1f}R")
        if e and risk / e * 100 > MAX_STOP_PCT:
            problems.append(f"stop is {risk / e * 100:.1f}% from the entry")
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
            notes.append(f"in the {len(shown)} replayed bars: best {best:.1f}R"
                         + (f", stopped on {unit} {stopped}, after the stop it reaches {after:.1f}R" if stopped else ", stop not hit"))
    return problems, notes


def check_question(c, unit: str, q: dict) -> dict:
    ch = q["chart"]
    r = resolve(c, ch)
    out = {"unit": unit, "key": q["key"], "sym": ch["sym"], "asof": ch["asof"], "problems": [], "notes": []}
    want = int(ch.get("forward", 20))
    partial = (len(r["visible"]) < int(ch.get("window", 120)) // 2) or (want and len(r["forward"]) < min(want, REVEAL_FORWARD_BARS))
    if str(ch.get("tf") or "D") in INTRADAY_TFS and (not r["visible"] or partial):
        # (a copy holding only part of the day, such as the tail of a 2023 30-minute series, is not the provider's
        # record either: the pod checks the whole window against the provider)
        # the provider holds these; this copy usually does not. fill_course_intraday.py runs check_bars on the pod and
        # stores only a chart that passes, so an unchecked one here can never reach a member unchecked
        out["notes"].append("intraday: not in this copy of the bars; checked on the pod by fill_course_intraday")
        out["intraday_unchecked"] = True
        return out
    words = " ".join(str(q.get(k) or "") for k in ("story", "q", "why", "simple", "lesson_line"))
    p, n = check_bars(ch, r["visible"], r["forward"], words)
    out["problems"] += p
    out["notes"] += n
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
    print(json.dumps({"charts": len(results), "failing": len(bad),
                      "intraday_left_for_the_pod": sum(1 for r in results if r.get("intraday_unchecked"))}))
    if args.json:
        pathlib.Path(args.json).write_text(json.dumps(results, indent=1), encoding="utf-8")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
