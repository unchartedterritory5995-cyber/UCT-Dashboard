"""READ-ONLY on the web pod: more Kicker and High Volume Edge examples from the stocks only the pod's bars hold.

Owner 2026-11-07: "I THINK ALL OF THAT DATA IS AVIALABLE ON THE WEBSITE THOUGH". The deep scan ran on a local copy of
2,789 stocks; the pod holds 13,307 tickers, about 5,000 of them with years of history the local copy lacks, and under the
owner's rules the local data held only 13 Kickers and 25 High Volume Edges. This runs the SAME finders (scripts/study/
bank_v2/scan_history.FINDERS: Kicker and HVE only) over the tickers the local copy does not have (the list is embedded),
with the same clean-window guard, co-fire sweep, context and outcome, and keeps a hit only when it passes the
institutional cut measured against the pod's WHOLE universe (the 50-day median dollar volume at the month's end, ranked
across every ticker: the top 1,000 and the top 40% for a Kicker; the top 1,000 for an HVE, the owner's 2026-11-07
exemption). Each hit carries the bars its chart needs (125 sessions back, 22 forward) so the bank can be built locally.

It runs at the lowest CPU priority (nice 19) so the web server always comes first, reads bars.db read-only, writes nothing,
and prints the hits in compressed batches (every 200 tickers) between BEGIN_HITS and END_HITS.

  ! powershell -File <scratchpad>/run_pod_py.ps1 -Script C:/Users/pgosz/uct-worktrees/study-hve-overlay/docs/study/bank_v2/pod_scan_more.py
"""
import base64
import json
import os
import sqlite3
import sys
import time
import zlib
from array import array

try:
    os.nice(19)
except Exception:
    pass

ROOT = next((r for r in (os.getcwd(), "/app") if os.path.exists(os.path.join(r, "scripts", "study", "bank_v2"))), None)
if ROOT is None:
    raise SystemExit("no scripts/study/bank_v2 here")
sys.path.insert(0, ROOT)
import numpy as np  # noqa: E402
from scripts.study.bank_v2 import scan_history as SH  # noqa: E402
from api.services import study_hard as H  # noqa: E402

LOCAL = set(json.loads(zlib.decompress(base64.b64decode("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")).decode()))
SKILLS = ("setup.family3.kicker", "setup.family3.hve")
BACK, FWD = 125, 22


def emit(batch, where):
    blob = base64.b64encode(zlib.compress(json.dumps(batch, separators=(",", ":"), default=str).encode(), 9)).decode()
    sys.stdout.write(f"BEGIN_HITS {where}\n" + blob + "\nEND_HITS\n")
    sys.stdout.flush()


def main() -> None:
    t0 = time.time()
    db = os.environ.get("BARS_DB") or os.path.join(os.environ.get("DATA_DIR", "/data"), "bars.db")
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    etfs = set(json.loads(open(os.path.join(ROOT, "api/data/prebuilt_etfs.json"), encoding="utf-8").read()))
    syms = [r[0] for r in c.execute("SELECT ticker FROM ohlcv WHERE tf='D' GROUP BY ticker HAVING count(*) >= ?",
                                    (SH.MIN_HISTORY,))]
    syms = [s for s in syms if s not in etfs and s.isalpha()]
    spy = SH.spy_table(c)
    # pass 1: the 50-day median dollar volume at each month's end, for every ticker: the universe the cut ranks against
    month_vals, per_ticker = {}, {}
    for sym in syms:
        rows = c.execute("SELECT ts, c, v FROM ohlcv WHERE ticker=? AND tf='D' ORDER BY ts", (sym,)).fetchall()
        if len(rows) < 60:
            continue
        dv = np.array([(r[1] or 0) * (r[2] or 0) for r in rows], dtype=np.float64)
        med = np.median(np.lib.stride_tricks.sliding_window_view(dv, 50), axis=1)
        last = {}
        for k in range(49, len(rows)):
            last[int(rows[k][0]) // 100] = med[k - 49]
        for m, v in last.items():
            month_vals.setdefault(m, array("f")).append(float(v))
        if sym not in LOCAL:
            per_ticker[sym] = (array("i", list(last)), array("f", [float(v) for v in last.values()]))
    thr = {}
    for m, vals in month_vals.items():
        s = np.sort(np.frombuffer(vals, dtype=np.float32))[::-1]
        n = len(s)
        thr[m] = (float(s[min(1000, n) - 1]), float(s[max(1, int(min(1000, 0.4 * n))) - 1]), n, s)
    sys.stderr.write(f"pass 1: {len(syms)} tickers, {len(thr)} months, {time.time() - t0:.0f}s\n")
    # pass 2: the finders on the tickers the local copy lacks
    # only a ticker that reached the top 1,000 in some month can yield a hit: skip the rest (most of the small names)
    todo = [s for s in syms if s in per_ticker and any(v >= thr[m][0] for m, v in zip(*per_ticker[s]) if m in thr)]
    sys.stderr.write(f"pass 2: {len(todo)} of {len(per_ticker)} tickers the local copy lacks ever reached the top 1,000" + chr(10))
    hits, sent = [], 0
    for n_s, sym in enumerate(todo):
        rows = c.execute("SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf='D' ORDER BY ts", (sym,)).fetchall()
        bars = [{"t": int(r[0]), "o": float(r[1]), "h": float(r[2]), "l": float(r[3]), "c": float(r[4]), "v": float(r[5] or 0)}
                for r in rows if r[1] and r[4]]
        bars = [b for b in bars if b["c"] > 0 and b["h"] >= b["l"]]
        if len(bars) < SH.MIN_HISTORY:
            continue
        dvs = np.array([b["c"] * b["v"] for b in bars], dtype=np.float64)
        med = np.median(np.lib.stride_tricks.sliding_window_view(dvs, 50), axis=1)
        S = SH.U.series(bars) if hasattr(SH, "U") else None
        if S is None:
            from api.services.pattern_engine.detectors.uct import uct_setups_common as U
            S = U.series(bars)
        for skill in SKILLS:
            fn, min_gap, start = SH.FINDERS[skill]
            last_i = -10_000
            for i in range(max(start, SH.WINDOW), len(bars) - 21):
                if i - last_i < min_gap:
                    continue
                try:
                    res = fn(bars, S, i)
                except Exception:
                    res = None
                if not res:
                    continue
                lq, dv, sc, f, w, wf = res
                if not lq or not SH.clean_window(bars, i):
                    continue
                last_i = i
                m = bars[i]["t"] // 100
                if m not in thr:
                    continue
                top1000, cut, universe, sorted_vals = thr[m]
                mine = float(med[i - 49])
                if mine < (top1000 if skill.endswith("hve") else cut):
                    continue
                rank = int((sorted_vals > mine).sum()) + 1
                fired = set()
                for sk, rules in H.SETUP_RULES.items():
                    for r in rules:
                        try:
                            if r(bars, S, i):
                                fired.add(sk); break
                        except Exception:
                            pass
                win = bars[max(0, i - BACK):i + 1 + FWD]
                hits.append({"skill": skill, "sym": sym, "t": bars[i]["t"], "close": bars[i]["c"], "score": sc, "works": w,
                             "fwd": wf, "facts": f, "dv": dv, "co_fires": sorted(fired - {skill}),
                             "ctx": SH.context(bars, S, i, spy), "out": SH.outcome(bars, i, False),
                             "liq_rank": rank, "liq_universe": universe, "liq_basis": "month-end, the pod's whole universe",
                             "bars": [[b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]] for b in win]})
        if (n_s + 1) % 200 == 0 or n_s + 1 == len(todo):
            # a batch at a time: a web restart mid-run (another merge's deploy ended the first run, 2026-11-08)
            # keeps every batch already printed
            emit(hits[sent:], f"{n_s + 1}/{len(todo)}")
            sent = len(hits)
            sys.stderr.write(f"  {n_s + 1}/{len(todo)} tickers, {len(hits)} hits, {time.time() - t0:.0f}s\n")
    by = {}
    for h in hits:
        by[h["skill"]] = by.get(h["skill"], 0) + 1
    sys.stderr.write(f"scanned {len(todo)} tickers the local copy lacks in {time.time() - t0:.0f}s; hits {by}\n")


if __name__ == "__main__":
    main()
