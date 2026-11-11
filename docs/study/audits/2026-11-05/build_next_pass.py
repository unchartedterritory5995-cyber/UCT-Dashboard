"""build_next_pass -- the next review pass of setup examples for the owner's sittings (2026-11-05):
Slingshot pass 3, Gap Support pass 3, Kicker pass 5 and High Volume Edge pass 4, from the firm's finders
run LOCALLY (DATA_DIR = the sandbox data dir, whose bars.db is the pod dump of 2026-11-04: 734 daily
tickers) instead of read-only on the pod. Backlog item "the bank must grow" (docs/study/RESUME-PROMPT.md).

Nothing here is a model's market fact: every candidate is a finder's pick (the detector as the gate, the
owner's rulings as the score), every number is measured from the bars, and the earnings flag is Yahoo's
reported earnings calendar through yfinance (the repo's own bars fallback library; the FMP key the bear-gap
finder used on the pod is not available locally). Selection rules, calibrated on his cut words and his
kept charts' measured facts (owner_verdicts.jsonl, setup_examples.json):
  * fresh: a symbol never used as an example of the same setup and never ruled on for it;
  * variety first (owner 2026-10-24: "You keep using the same charts as examples"): symbols never used
    for ANY setup before symbols used elsewhere; one chart per symbol; at most 4 per calendar year;
  * Kicker: the pass-4 finder's rows only (his trapped-sellers rules) and never within 3 days of an
    earnings date ("plainly just an earnings gapper"); Slingshot and Gap Support: the trigger / test day
    itself is not an earnings day; HVE: an earnings day stays only when the volume is truly massive
    (rvol >= 15), his "PEG / HVC, not a real HVE" cuts;
  * a symbol with no earnings history (an ETF) is never a Slingshot or a Kicker (his Slingshot is "the way
    into a power earnings gap"); for HVE and Gap Support it is kept and flagged;
  * Gap Support: uptrend only (above the 200-day), a real gap (>= 4%; EDU at 4.5% was kept good), one
    pick per date (he cut the four 2022-10-11 index-gap megacaps together), the first test preferred;
  * Slingshot: the gallery score's "pretty" picks, an earnings-style drive first ("meant to be used to
    enter PEGs mostly");
  * HVE: setup_score >= 8 and an up day of 5% or more (his kept HVEs run 8% to 177%; a record-volume day
    that barely moves is an index rebalance or a block, not an edge), lesser-known names first (average
    dollar volume under $800M, like every HVE he kept).
Dry run prints the shortlist; --write appends the examples to docs/study/setups/setup_examples.json with a
pass block each (generated, scanned, passing, why, script, bars, added), after which
scripts/study/fill_setup_facts.py and scripts/study/gen_setup_examples.py regenerate the bank. Idempotent:
a (setup, sym, asof) already in the file is never added twice. Earnings lookups are cached per symbol.

  python -X utf8 docs/study/audits/2026-11-05/build_next_pass.py --finders <dir> [--write]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib

REPO = pathlib.Path(__file__).resolve().parents[4]
EXAMPLES = REPO / "docs" / "study" / "setups" / "setup_examples.json"
VERDICTS = REPO / "docs" / "study" / "audits" / "2026-10-24" / "owner_verdicts.jsonl"
PER_YEAR = 4
EARNINGS_WINDOW_DAYS = 3
BARS_NOTE = "local sandbox copy of the pod bars (bars.db dump of 2026-11-04, 734 daily tickers)"
PASSES = {
    # setup: (finder file, picks key, pass block key, finder script, target count, why)
    "Slingshot": ("finder_slingshot.json", "picks", "slingshot_pass3", "scripts/study/find_slingshot_examples.py", 14,
                  "the pass-2 finder (gallery score v3 from his perfect / beautiful charts: earnings-style drive, orderly "
                  "pullback, decisive but technical trigger, no gap, no drama) on the local bars; fresh symbols only, an "
                  "earnings-style drive first, the trigger day never an earnings day, no ETF"),
    "Gap Support": ("finder_gap_support.json", "picks", "gap_support_pass3", "scripts/study/find_gap_support_examples.py", 16,
                    "the finder with his 2026-10-26/27 rulings (the level is the gap-up day's low; held > slight breach > "
                    "fill and reclaim; gaps up only, never in a downtrend) on the local bars; fresh symbols, one pick per "
                    "date, gaps of 4% or more, the test day never an earnings day"),
    "Kicker Candle": ("finder_pass4.json", "kicker", "kicker_pass5", "scripts/study/find_pass4_examples.py", 8,
                      "the pass-4 finder (his trapped-sellers rules: a real red day closing weak, an almost-failed breakdown, "
                      "then the gap that closes above the red day's high) on the local bars; fresh symbols, never within "
                      "3 days of an earnings date (an earnings-day gap is an earnings gapper, his 2026-10-24 ruling)"),
    "High Volume Edge": ("finder_hve.json", "picks", "hve_pass4", "scripts/study/find_hve_examples.py", 16,
                         "the pass-4 finder (his definition confirmed 2026-10-25: the record volume of the lookback, ten times "
                         "normal, up day, OPEX and month-end excluded) on the local bars; fresh and lesser-known names first, "
                         "an up day of 5% or more, an earnings day only when the volume is truly massive"),
}


def earnings_dates(sym: str, cache: dict) -> list[str] | None:
    """Every reported earnings date Yahoo lists for `sym` (ISO), cached per symbol.
    [] = Yahoo lists none (an ETF or a very new name); None = the lookup failed."""
    if sym in cache:
        return cache[sym]
    try:
        import yfinance as yf
        df = yf.Ticker(sym).get_earnings_dates(limit=100)
        dates = sorted({d.date().isoformat() for d in df.index}) if df is not None and len(df) else []
        cache[sym] = dates
    except Exception as e:  # noqa: BLE001
        if "No earnings dates found" in str(e):
            cache[sym] = []
        else:
            print(f"   earnings lookup failed for {sym}: {type(e).__name__}")
            return None
    return cache[sym]


def near_earnings(dates: list[str] | None, asof: str) -> list[str] | None:
    if dates is None:
        return None
    d0 = dt.date.fromisoformat(asof)
    return [d for d in dates if abs((dt.date.fromisoformat(d) - d0).days) <= EARNINGS_WINDOW_DAYS]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="the next setup-example review pass from local finder runs")
    ap.add_argument("--finders", required=True, help="directory holding finder_*.json")
    ap.add_argument("--cache", default=None, help="json cache of earnings lookups (default <finders>/earnings_dates_cache.json)")
    ap.add_argument("--write", action="store_true", help="append to setup_examples.json")
    args = ap.parse_args(argv)
    cache_path = pathlib.Path(args.cache) if args.cache else pathlib.Path(args.finders) / "earnings_dates_cache.json"
    cache = json.load(open(cache_path, encoding="utf-8")) if cache_path.exists() else {}

    data = json.load(open(EXAMPLES, encoding="utf-8"))
    examples = data["examples"]
    have = {(e["setup"], e["sym"], e["asof"]) for e in examples}
    used_any = {e["sym"] for e in examples}
    used_by: dict[str, set] = {}
    for e in examples:
        used_by.setdefault(e["setup"], set()).add(e["sym"])
    ruled_by: dict[str, set] = {}
    for line in open(VERDICTS, encoding="utf-8"):
        if line.strip():
            r = json.loads(line)
            if r.get("setup") and r.get("sym"):
                for s in str(r["sym"]).split(","):
                    ruled_by.setdefault(r["setup"], set()).add(s.strip())

    added_all: dict[str, list] = {}
    blocks: dict[str, dict] = {}
    for setup, (fname, pkey, bkey, script, target, why) in PASSES.items():
        fd = json.load(open(pathlib.Path(args.finders) / fname, encoding="utf-8"))
        rows = list(fd.get(pkey) or [])
        meta = {k: v for k, v in fd.items() if isinstance(v, (int, str)) and k in
                ("generated", "scanned", "detector_fires", "passing", "kicker_passing", "raw_detector_hits", "seconds")}
        fresh = [r for r in rows if r["sym"] not in used_by.get(setup, set()) and r["sym"] not in ruled_by.get(setup, set())]

        def rank(r: dict) -> float:
            f = r["facts"]
            q = float(r.get("q") or 0)
            if r["sym"] not in used_any:
                q += 2.0                                   # variety first
            if setup == "Slingshot" and f.get("earnings_like_gap"):
                q += 1.0
            if setup == "Gap Support" and f.get("first_test"):
                q += 0.5
            if setup == "High Volume Edge" and (f.get("avg_dollar_volume_m") or 1e9) <= 800:
                q += 1.0
            return q

        fresh.sort(key=lambda r: (-rank(r), r["asof"]))
        picked: list[dict] = []
        per_year: dict[int, int] = {}
        dates_taken: set = set()
        left: list[tuple[str, str]] = []
        for r in fresh:
            if len(picked) >= target:
                break
            f = r["facts"]
            who = f"{r['sym']} {r['asof']}"
            y = int(r.get("year") or r["asof"][:4])
            if per_year.get(y, 0) >= PER_YEAR:
                left.append((who, f"year {y} full")); continue
            if setup == "Gap Support":
                if not f.get("above_200"):
                    left.append((who, "under the 200-day")); continue
                if (f.get("gap_pct") or 0) < 4.0:
                    left.append((who, f"gap {f.get('gap_pct')}% under 4%")); continue
                if r["asof"] in dates_taken:
                    left.append((who, "same date as a pick (an index gap)")); continue
            if setup in ("Kicker Candle", "High Volume Edge") and (f.get("setup_score") or 0) < 8:
                left.append((who, "setup_score under 8")); continue
            if setup == "High Volume Edge" and (f.get("day_pct") or 0) < 5.0:
                left.append((who, f"up only {f.get('day_pct')}% on the record volume (a rebalance or a block)")); continue
            dates = earnings_dates(r["sym"], cache)
            near = near_earnings(dates, r["asof"])
            has_history = None if dates is None else bool(dates)
            if has_history is False and setup in ("Slingshot", "Kicker Candle"):
                left.append((who, "no earnings history (an ETF)")); continue
            ed = None if near is None else bool(near)
            if ed and setup in ("Kicker Candle", "Slingshot", "Gap Support"):
                left.append((who, f"earnings {near}")); continue
            if ed and setup == "High Volume Edge" and (f.get("rvol") or 0) < 15:
                left.append((who, f"earnings {near} on ordinary volume (rvol {f.get('rvol')})")); continue
            facts = dict(f)
            if near is not None:
                facts["earnings_dates_near"] = near
                facts["earnings_day"] = bool(near)
            if has_history is not None:
                facts["earnings_history"] = has_history
            if setup == "Slingshot" and facts.get("gap_pct") is not None and "trigger_gap_pct" not in facts:
                facts["trigger_gap_pct"] = facts["gap_pct"]          # the trigger day's gap, the key the lesson names
            if r.get("gap_asof") and "gap_asof" not in facts:
                facts["gap_asof"] = r["gap_asof"]
            ex = {"setup": setup, "sym": r["sym"], "asof": r["asof"], "year": y, "close": r["close"],
                  "facts": facts, "q": r.get("q")}
            picked.append(ex); per_year[y] = per_year.get(y, 0) + 1; dates_taken.add(r["asof"])
        added_all[setup] = picked
        blocks[bkey] = dict(meta, why=why, script=script, bars=BARS_NOTE,
                            earnings="yfinance reported earnings dates, within 3 days of the chart's last bar",
                            added=[{"setup": setup, "sym": p["sym"], "asof": p["asof"]} for p in picked])
        print(f"== {setup}: finder rows {len(rows)}, fresh {len(fresh)}, picked {len(picked)} (target {target})")
        for p in picked:
            f = p["facts"]
            tag = "" if p["sym"] not in used_any else " (used for another setup)"
            ear = f.get("earnings_day")
            print(f"   {p['sym']:6} {p['asof']} q={p.get('q')} score={f.get('setup_score')} day={f.get('day_pct')}% "
                  f"gap={f.get('gap_pct')}% rvol={f.get('rvol')} earnings={'?' if ear is None else ear}{tag}")
        for who, why_left in left[:14]:
            print(f"   left  {who}: {why_left}")

    json.dump(cache, open(cache_path, "w", encoding="utf-8"), indent=0, sort_keys=True)
    total = sum(len(v) for v in added_all.values())
    if not args.write:
        print(f"DRY RUN: {total} examples would be added; run with --write")
        return 0
    n = 0
    for setup, picks in added_all.items():
        for p in picks:
            k = (p["setup"], p["sym"], p["asof"])
            if k in have:
                continue
            examples.append(p); have.add(k); n += 1
    for bkey, block in blocks.items():
        data[bkey] = block
    with open(EXAMPLES, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(data, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    print(f"wrote {n} new examples to {EXAMPLES.relative_to(REPO)}; blocks {sorted(blocks)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
