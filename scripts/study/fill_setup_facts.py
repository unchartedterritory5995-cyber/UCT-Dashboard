"""fill_setup_facts -- complete the facts of the setup examples from the bars
themselves (deterministic arithmetic over the chart's own daily bars; no model
writes a market fact), so the lesson line never prints a missing number.

WHY
---
The ten Gap Support and ten Go Signal examples of the first scan (pass 1,
2026-10-24) stored only a handful of facts, and the lesson template printed
"None%" for the rest: seen 2026-11-04 on three LIVE Gap Support items (EDU
2023-01-30, MU 2024-01-02, UAL 2024-02-06). The pass-2 scans stored more, but
nothing about the GAP-UP DAY'S LOW, the level the owner ruled the setup is
about (2026-10-26/27: it should hold, or be slightly breached with the close
back above it; a fill to the gap-fill spot that reclaims the low is a lesser
example; a breach that never reclaims is a failed gap). Every Gap Support
lesson therefore described the test against the gap top, the level he said
it is NOT about.

WHAT
----
For every Gap Support and Go Signal example in docs/study/setups/
setup_examples.json: read the example's own daily bars (the window the item
shows, ending on the asof bar, plus the forward strip the reveal shows),
re-derive the facts the lesson line cites, CHECK that every fact already
stored agrees with the bars (the gap day and its size, the close position,
the day's change), and write the completed facts back. A disagreement stops
the run: it means the bars are not the chart's bars. Idempotent: a second run
over the same bars changes nothing.

The facts describe the geometry (how far the test day's low sat from the
gap-up low, where it closed against that low and against the gap top, and
how many sessions until a close back above the low). They do NOT grade the
test: the finder's single-day held / breached / failed rule put "failed" on
charts the owner graded great (MU 2024-01-02, AFRM 2024-09-10: the close sat
under the gap-up low for a day or two, then reclaimed it), so no such label
is stored and none reaches a lesson. The owner's grade on the pod ranks the
example.

BARS
----
`--bars-db` is a bars_sqlite file (the `ohlcv` table, daily rows, ts =
YYYYMMDD): the pod's /data/bars.db read-only, or a sandbox copy loaded from
the pod dump. Nothing is fetched.

  python -X utf8 scripts/study/fill_setup_facts.py --bars-db <path> [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sqlite3
import sys
from datetime import date

REPO = pathlib.Path(__file__).resolve().parents[2]
SOURCE = REPO / "docs" / "study" / "setups" / "setup_examples.json"
WINDOW, FORWARD = 120, 20
SETUPS = ("Gap Support", "Go Signal")
#: how far a stored fact may sit from the re-derived one (each side rounded)
TOL = {"gap_pct": 0.02, "dcr": 0.006, "day_pct": 0.02, "close_vs_gap_top_pct": 0.06,
       "open_vs_prior_close_pct": 0.02, "gap_day_pct": 0.02, "gap_day_dcr": 0.006}


def pct(a: float, b: float) -> float:
    return (a / b - 1) * 100 if b else 0.0


def dcr(b: dict) -> float:
    r = b["h"] - b["l"]
    return (b["c"] - b["l"]) / r if r > 0 else 0.5


def key_to_iso(k: int) -> str:
    s = str(int(k))
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


def iso_to_key(s: str) -> int:
    return int(s.replace("-", ""))


def gap_support_facts(bars: list[dict], forward: list[dict], stored: dict) -> dict:
    """The lesson's facts for a Gap Support example whose last bar is the
    test day; `stored['bars_since_gap']` locates the gap day."""
    i = len(bars) - 1
    n = int(stored["bars_since_gap"])
    g = i - n
    if g < 1:
        raise ValueError(f"gap day {n} sessions back is outside the {len(bars)}-bar window")
    b, gb, pre = bars[i], bars[g], bars[g - 1]
    gap_top, gap_low = pre["h"], gb["l"]
    post_high = max(x["h"] for x in bars[g:i])
    f = {
        "gap_asof": key_to_iso(gb["t"]), "gap_pct": round(pct(gb["o"], pre["c"]), 2),
        "true_gap": gb["l"] > pre["h"], "gap_top": round(gap_top, 2), "gap_low": round(gap_low, 2),
        "test_low_vs_gap_low_pct": round(pct(b["l"], gap_low), 1),
        "close_vs_gap_low_pct": round(pct(b["c"], gap_low), 1),
        "close_vs_gap_top_pct": round(pct(b["c"], gap_top), 1),
        "gap_day_pct": round(pct(gb["c"], pre["c"]), 2), "gap_day_dcr": round(dcr(gb), 2),
        "post_gap_run_pct": round(pct(post_high, gb["c"]), 1),
        "pullback_from_high_pct": round(pct(b["l"], post_high), 1),
        "day_pct": round(pct(b["c"], bars[i - 1]["c"]), 2), "dcr": round(dcr(b), 2),
    }
    # the reclaim: sessions until a close back above the gap-up low, counting
    # the test day itself as 0; the reveal's forward strip is the horizon
    if b["c"] >= gap_low:
        f["reclaim_sessions"] = 0
    else:
        k = next((j + 1 for j, x in enumerate(forward) if x["c"] >= gap_low), None)
        if k is not None:
            f["reclaim_sessions"] = k
    f["reclaimed_in_forward"] = "reclaim_sessions" in f
    return f


def go_signal_facts(bars: list[dict], forward: list[dict], stored: dict) -> dict:
    """The lesson's facts for a Go Signal daily footprint: the last bar
    against the one before."""
    b, p = bars[-1], bars[-2]
    if stored.get("red_to_green") and not (b["o"] < p["c"] < b["c"]):
        raise ValueError("stored red_to_green but the bar did not open under and close over the prior close")
    return {
        "open_vs_prior_close_pct": round(pct(b["o"], p["c"]), 2),
        "low_vs_prior_low_pct": round(pct(b["l"], p["l"]), 2),
        "day_pct": round(pct(b["c"], p["c"]), 2), "dcr": round(dcr(b), 3),
    }


def merge(stored: dict, derived: dict) -> tuple[dict, list[str], list[str]]:
    """(facts, added keys, disagreements). A stored fact stays as stored when
    it agrees with the bars; a missing one is added."""
    out = dict(stored)
    added: list[str] = []
    bad: list[str] = []
    for k, v in derived.items():
        if k not in stored or stored[k] is None:
            out[k] = v
            added.append(k)
            continue
        s = stored[k]
        if isinstance(v, bool) or isinstance(s, bool):
            if bool(s) != bool(v):
                bad.append(f"{k}: stored {s!r}, bars say {v!r}")
        elif isinstance(v, (int, float)) and isinstance(s, (int, float)):
            if abs(float(s) - float(v)) > TOL.get(k, 0.02):
                bad.append(f"{k}: stored {s}, bars say {v}")
        elif s != v:
            bad.append(f"{k}: stored {s!r}, bars say {v!r}")
    return out, added, bad


def _rows(rows) -> list[dict]:
    return [{"t": int(r[0]), "o": float(r[1]), "h": float(r[2]), "l": float(r[3]), "c": float(r[4]),
             "v": float(r[5] or 0)} for r in rows]


def load_bars(db: sqlite3.Connection, sym: str, asof: str, window: int = WINDOW,
              forward: int = FORWARD) -> tuple[list[dict], list[dict]]:
    """(the chart's bars ending on the asof day, the forward strip)."""
    key = iso_to_key(asof)
    back = db.execute(
        "SELECT ts, o, h, l, c, v FROM ohlcv WHERE ticker=? AND tf='D' AND ts<=? ORDER BY ts DESC LIMIT ?",
        (sym.upper(), key, window)).fetchall()
    bars = _rows(reversed(back))
    if not bars or bars[-1]["t"] != key:
        raise ValueError(f"{sym} {asof}: no bar on the asof day in the bars db")
    if len(bars) < window:
        raise ValueError(f"{sym} {asof}: {len(bars)} bars, the chart shows {window}")
    fwd = _rows(db.execute(
        "SELECT ts, o, h, l, c, v FROM ohlcv WHERE ticker=? AND tf='D' AND ts>? ORDER BY ts LIMIT ?",
        (sym.upper(), key, forward)).fetchall())
    if len(fwd) < forward:
        raise ValueError(f"{sym} {asof}: {len(fwd)} forward bars, the reveal shows {forward}")
    return bars, fwd


def fill(data: dict, db: sqlite3.Connection) -> list[dict]:
    """Fill every Gap Support / Go Signal example in place. Returns the
    report rows (one per example that gained a fact)."""
    report: list[dict] = []
    for ex in data["examples"]:
        if ex.get("setup") not in SETUPS:
            continue
        bars, fwd = load_bars(db, ex["sym"], ex["asof"])
        stored = dict(ex.get("facts") or {})
        derive = gap_support_facts if ex["setup"] == "Gap Support" else go_signal_facts
        facts, added, bad = merge(stored, derive(bars, fwd, stored))
        if bad:
            raise ValueError(f"{ex['setup']} {ex['sym']} {ex['asof']}: the bars disagree with the stored facts: "
                             + "; ".join(bad))
        if added:
            ex["facts"] = facts
            report.append({"setup": ex["setup"], "sym": ex["sym"], "asof": ex["asof"], "added": added})
    return report


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Complete the setup examples' facts from their own bars.")
    ap.add_argument("--bars-db", required=True, help="a bars_sqlite file (ohlcv table, daily rows)")
    ap.add_argument("--source", default=str(SOURCE))
    ap.add_argument("--dry-run", action="store_true", help="report, write nothing")
    args = ap.parse_args(argv)
    with open(args.source, encoding="utf-8") as fh:
        data = json.load(fh)
    db = sqlite3.connect(f"file:{pathlib.Path(args.bars_db).as_posix()}?mode=ro", uri=True)
    report = fill(data, db)
    for r in report:
        print(f"[fill-facts] {r['setup']}: {r['sym']} {r['asof']} +{len(r['added'])}: {', '.join(r['added'])}")
    print(f"[fill-facts] {len(report)} example(s) completed" + (" (dry run, nothing written)" if args.dry_run else ""))
    if args.dry_run or not report:
        return 0
    data.setdefault("facts_filled", []).append({
        "generated": date.today().isoformat(), "script": "scripts/study/fill_setup_facts.py",
        "why": "the lesson line read facts the scan had not stored and printed None%; the test is now measured "
               "against the gap-up day's low, the level the owner ruled on 2026-10-26/27",
        "examples": report})
    with open(args.source, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(data, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    print(f"[fill-facts] wrote {args.source}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
