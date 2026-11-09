"""BANK V2: the base a stock broke out of, named by Chart IQ, on breakout days across the deep history.

Owner 2026-11-07 ("lets do it all"): the Patterns and bases track gets its first family, "What base did this stock just
break out of?". Chart IQ (api/services/chart_iq/engine/v3.py::markup) finds the base under the last bar
(v3_bases.find_base) and names it (v3_bases.classify, then the engine's own rim / VCP / stage-1-range adjustments): High
tight flag, PEG flag, Double bottom (undercut), Cup with handle, Cup without handle, Bull flag, Flat base, VCP,
Consolidation / range, Faulty / wide and loose. This runs that step, unchanged, on the breakout days the Chart IQ history
scan already found (scan_chartiq.py: Range breakout, Base n' break, Inside bar break, Double inside bar break, Gap up,
HVC, Pocket pivot; held over 20 sessions; top 1,000 stocks by dollar volume that day) and keeps a base when the engine
calls it a breakout TODAY (B['today'], not extended past 5% over the pivot) and the whole base fits the 120-bar chart a
member sees. Each kept base carries the engine's own note ("U-shaped cup, handle 7 bars"), its pivot, depth, length,
grade and the event's context and culmination. Resumable (<out>.part). Reads the bars database through the engine's own
loader (CHART_IQ_BARS_DB).

  CHART_IQ_BARS_DB=<bars.db> python -X utf8 scripts/study/bank_v2/scan_bases.py --events <events.jsonl.gz> --out <bases.jsonl.gz>
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import pathlib
import sys
import time
from collections import Counter

REPO = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO))

BREAKOUT = {"Range breakout", "Base n' break", "Inside bar break", "Double inside bar break", "Gap up", "HVC", "Pocket pivot"}
VIEW, CHART = 190, 120          # the engine's window; the member's chart


def iso(t) -> str:
    s = str(t)
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


def base_at(sym: str, asof: str):
    """The engine's base step at the chart's last bar (v3.markup, lines 47-90), or None."""
    from api.services.chart_iq.engine import markup as M, v2_setups as VS, v3_bases as B3, v3_levels as L3
    b = M.bars(sym, asof)
    if len(b) < 260 or iso(b[-1]["t"]) != asof:
        return None
    i = len(b) - 1
    v0 = max(0, i - VIEW + 1)
    _tg, I = VS.tags(b, i)
    close = I.c[i]
    B = B3.find_base(b, i, I, v0)
    if not B or B["pivot"] > close * 1.25 or not B.get("today"):
        return None
    G0 = L3.gaps(I, max(v0, i - 130), i)
    pt, note, extra = B3.classify(b, B, I, G0)
    if B.get("rim") and not pt.startswith(("Cup", "Double")):
        pt, note = ("Cup with handle", "cup from the rim") if B["R"] != B["L"] else ("Cup without handle", "U-shaped cup")
    vc = B3.is_vcp(I, B)
    if vc and pt in ("Flat base", "Consolidation / range", "Bull flag", "Square box / consolidation"):
        pt, note = "VCP", "contractions " + " > ".join("%d%%" % round(x * 100) for x in vc)
    if B.get("range") and not pt.startswith(("Cup", "Double", "Flat", "VCP")):
        pt, note = "Consolidation / range", "stage-1 range, no prior advance"
    if not pt or pt == "?":
        return None
    piv = B["pivot"]
    if not (close <= piv * 1.05 or B.get("jb") == i):
        return None                                   # the engine calls it extended, not a breakout
    if i - B["L"] > CHART - 10:
        return None                                   # the base must fit the member's 120-bar chart
    return {"type": pt, "note": note, "pivot": round(piv, 4), "low": round(B["low"], 4), "depth_pct": round(B["depth"] * 100, 1),
            "bars": int(B["n"]), "start": iso(b[B["L"]]["t"]), "end": iso(b[B["e"]]["t"]),
            "vcp": [round(x * 100) for x in vc] if vc else None}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--events", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--top", type=int, default=1000)
    a = ap.parse_args(argv)
    if not os.environ.get("CHART_IQ_BARS_DB"):
        raise SystemExit("set CHART_IQ_BARS_DB to the bars database")
    seen, cands = set(), []
    for line in gzip.open(a.events, "rt", encoding="utf-8"):
        r = json.loads(line)
        if r["base"] in BREAKOUT and r.get("held") and (r.get("liq_rank") or 10 ** 9) <= a.top and (r["sym"], r["t"]) not in seen:
            seen.add((r["sym"], r["t"]))
            cands.append(r)
    part = pathlib.Path(a.out + ".part")
    done = set()
    if part.exists():
        for line in part.read_text(encoding="utf-8").splitlines():
            x = json.loads(line)
            done.add((x["sym"], x["t"]))
    todo = [r for r in cands if (r["sym"], r["t"]) not in done]
    print(f"{len(cands)} breakout days, {len(todo)} to read ({len(done)} already in {part.name})", flush=True)
    t0 = time.time()
    with open(part, "a", encoding="utf-8") as fh:
        for n, r in enumerate(todo, 1):
            try:
                base = base_at(r["sym"], iso(r["t"]))
            except Exception:  # noqa: BLE001  one chart never stops the scan
                base = None
            fh.write(json.dumps({"sym": r["sym"], "t": r["t"], "event": r["name"], "base": base,
                                 "ctx": r.get("ctx"), "out": r.get("out"), "liq_rank": r.get("liq_rank"),
                                 "liq_universe": r.get("liq_universe")}, default=str) + "\n")
            if n % 500 == 0:
                fh.flush()
                print(f"  {n}/{len(todo)} read, {time.time() - t0:.0f}s", flush=True)
    rows = [json.loads(x) for x in part.read_text(encoding="utf-8").splitlines()]
    kept = [x for x in rows if x["base"]]
    with gzip.open(a.out, "wt", encoding="utf-8") as fh:
        for x in kept:
            fh.write(json.dumps(x, default=str) + "\n")
    part.unlink()
    print(f"{len(rows)} breakout days read; {len(kept)} named bases: {dict(Counter(x['base']['type'] for x in kept).most_common())}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
