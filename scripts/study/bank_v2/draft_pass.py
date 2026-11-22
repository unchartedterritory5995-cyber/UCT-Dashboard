"""BANK V2, STEP 3: the chosen textbook examples, under the owner's drafting rules, into setup_examples.json.

Takes choose.py's picks and applies, unchanged, the rules the last pass applied (docs/study/audits/2026-11-05/
build_next_pass.py, calibrated on his cut words and his kept charts): an earnings day is never a Kicker, a Slingshot
trigger or a Gap Support test (Yahoo's reported earnings dates through yfinance, within 3 days of the chart's last
bar); a stock with no earnings history (an ETF) is never a Slingshot or a Kicker; Gap Support only above the 200-day,
a gap of 4% or more; one pick per date for every setup (the last pass did this for Gap Support only); a Kicker or an HVE needs setup_score 8 or more; an HVE needs an up day of 5% or
more, and an earnings-day HVE only when the volume is truly massive (rvol 15 or more). The Bear gap (his 2026-10-31
pause: the finder is to be rebuilt from his own example charts) and the Go Signal (definition pending) are left out.

New with this pass: the examples come from the deep, institutional atlas (scan_history.py: every session since 1995,
the top 1,000 stocks by dollar volume that day, clean of other setups firing on the same bar), at most --per-era from
one era, and each example carries its context and outcome fields (era, market condition, sector, liquidity rank,
distance from the 52-week high, strength against SPY, the culmination over 60 sessions) for the lessons and the
questions to come. With --bars-db, each pick's own window is checked close by close against Yahoo's history today (second_source.py:
the deep bars are Yahoo's, so this catches a later split or a revised series, not a second vendor's view) and a
disagreement is never drafted; the check's numbers ride on the example. With it too, a takeover pin is never drafted
(the 20 sessions after moved within 6%, daily moves under 0.8% apart: a cash bid ended the story that day). Dry run by
default; --write appends to docs/study/setups/setup_examples.json with a `deep_pass1`
block, after which scripts/study/fill_setup_facts.py and scripts/study/gen_setup_examples.py regenerate the bank
drafts. Idempotent: a (setup, sym, asof) already in the file is never added twice.

  python -X utf8 scripts/study/bank_v2/draft_pass.py --picks <picks.json> [--per-setup 25] [--write]
"""
from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
import pathlib
import sys
from collections import Counter

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3]))
from scripts.study.bank_v2 import second_source  # noqa: E402
from scripts.study.bank_v2.pod_coverage import PodCoverage  # noqa: E402
from scripts.study.find_candle_examples import ALL_CANDIDATES  # noqa: E402

#: the finders' own test for a well-known stock (find_pass4/find_hve/...: `sym in set(ALL_CANDIDATES)`)
KNOWN = set(ALL_CANDIDATES)

REPO = pathlib.Path(__file__).resolve().parents[3]
EXAMPLES = REPO / "docs" / "study" / "setups" / "setup_examples.json"
NAMES = {"setup.family3.kicker": "Kicker Candle", "setup.family4.oops": "Oops Reversal", "setup.family3.gap_support": "Gap Support",
         "setup.family3.hve": "High Volume Edge", "setup.family4.slingshot": "Slingshot", "setup.family1.launchpad": "Launchpad"}


def _last_pass():
    spec = importlib.util.spec_from_file_location("build_next_pass", REPO / "docs/study/audits/2026-11-05/build_next_pass.py")
    mod = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(REPO))
    spec.loader.exec_module(mod)
    return mod


def era_of(t: int) -> str:
    """choose.py's six eras."""
    y = int(str(t)[:4])
    for a, b in ((1995, 1999), (2000, 2004), (2005, 2009), (2010, 2014), (2015, 2019), (2020, 2026)):
        if a <= y <= b:
            return f"{a}-{str(b)[2:]}"
    return "other"


def iso(t: int) -> str:
    s = str(t)
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--picks", required=True)
    ap.add_argument("--per-setup", type=int, default=25)
    ap.add_argument("--per-era", type=int, default=6)
    ap.add_argument("--cache", default=str(REPO / "docs/study/setups/earnings_dates_cache.json"))
    ap.add_argument("--bars-db", default=None, help="the bars database the scan read; with it every pick's window is "
                    "checked against Yahoo's closes today (second_source.py) and a disagreement is never drafted")
    ap.add_argument("--pod-span", action="store_true",
                    help="draft only charts the web pod's own bars cover in full (pod_coverage.py; needs --bars-db)")
    ap.add_argument("--only", nargs="*", default=None, help="setup names to draft (default: all six)")
    ap.add_argument("--per-setup-map", default=None, help='JSON of per-setup targets, e.g. {"Gap Support": 520}')
    ap.add_argument("--block", default="deep_pass1", help="the name of this pass's record in setup_examples.json")
    ap.add_argument("--why", default=None, help="the owner's words for this pass (stored on the block)")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args(argv)
    last = _last_pass()
    cache_path = pathlib.Path(a.cache)
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    picks = json.loads(pathlib.Path(a.picks).read_text(encoding="utf-8"))
    second = second_source.load_cache()
    pod = PodCoverage(a.bars_db) if a.pod_span and a.bars_db else None
    data = json.loads(EXAMPLES.read_text(encoding="utf-8"))
    examples = data["examples"]
    have = {(e["setup"], e["sym"], e["asof"]) for e in examples}
    added, left, lookups = {}, {}, 0
    targets = json.loads(a.per_setup_map) if a.per_setup_map else {}
    for skill, setup in NAMES.items():
        if a.only and setup not in a.only:
            continue
        rows = (picks.get(skill) or {}).get("textbook") or []
        per_setup = int(targets.get(setup, a.per_setup))
        chosen, per_era, dates_taken, why_left = [], Counter(), set(), []
        for r in rows:
            if len(chosen) >= per_setup:
                break
            f, asof = r["facts"], iso(r["t"])
            who = f"{r['sym']} {asof}"
            era = era_of(r["t"])
            if per_era[era] >= a.per_era:
                why_left.append((who, f"era {era} full")); continue
            if (setup, r["sym"], asof) in have:
                why_left.append((who, "already in the file")); continue
            from scripts.study.bank_v2.gen_chartiq import liquid
            # owner 2026-11-07: less liquid charts are fine when they are great visuals; his High Volume Edge is "often on
            # a lesser-known name", so it keeps the top-1,000 cut only (owner_verdicts.jsonl, chat-ruling 2026-11-07)
            if not (liquid(r) if setup != "High Volume Edge" else (r.get("liq_rank") or 10 ** 9) <= 1000):
                why_left.append((who, f"rank {r.get('liq_rank')} of {r.get('liq_universe')}: outside the institutional cut")); continue
            if (r.get("quote_type") or "").upper() == "ETF" or r.get("sector") == "ETF":
                # owner 2026-11-06: "institutionally traded stocks" (enrich_meta.py names the funds from Yahoo's profile)
                why_left.append((who, "an ETF, not a stock")); continue
            if asof in dates_taken:
                # one chart per date per setup: three Kickers on 2021-01-28 are one market-wide gap, not three lessons
                why_left.append((who, "same date as a pick (a market-wide day)")); continue
            if setup == "Gap Support":
                if not f.get("above_200"):
                    why_left.append((who, "under the 200-day")); continue
                if (f.get("gap_pct") or 0) < 4.0:
                    why_left.append((who, f"gap {f.get('gap_pct')}% under 4%")); continue
            if setup in ("Kicker Candle", "High Volume Edge") and (f.get("setup_score") or r.get("score") or 0) < 8:
                why_left.append((who, "setup_score under 8")); continue
            if setup == "High Volume Edge" and (f.get("day_pct") or 0) < 5.0:
                why_left.append((who, f"up only {f.get('day_pct')}% on the record volume")); continue
            lookups += 1
            if lookups % 40 == 0:
                # save the two caches as it goes: a long pass stopped midway (the low-memory guard, 2026-11-06) keeps them
                cache_path.write_text(json.dumps(cache, indent=0, sort_keys=True), encoding="utf-8")
                if a.bars_db:
                    second_source.save_cache(second)
            dates = last.earnings_dates(r["sym"], cache)
            near = last.near_earnings(dates, asof)
            has_history = None if dates is None else bool(dates)
            if has_history is False and setup in ("Slingshot", "Kicker Candle"):
                why_left.append((who, "no earnings history (an ETF)")); continue
            ed = None if near is None else bool(near)
            if ed and setup in ("Kicker Candle", "Slingshot", "Gap Support"):
                why_left.append((who, f"earnings {near}")); continue
            if ed and setup == "High Volume Edge" and (f.get("rvol") or 0) < 15:
                why_left.append((who, f"earnings {near} on ordinary volume")); continue
            if pod:
                ok, why = pod.covered(r["sym"], asof)
                if not ok:
                    why_left.append((who, f"not on the pod's bars: {why}")); continue
            check = after = None
            if a.bars_db:
                after = second_source.after_signal(a.bars_db, r["sym"], asof)
                if after and after["pinned"]:
                    why_left.append((who, f"pinned after the signal (the shape of a cash takeover): {after['range_pct']}% range over the next {after['sessions']} "
                                          f"sessions, daily moves {after['daily_sd_pct']}% apart")); continue
                check = second_source.check(r["sym"], asof, a.bars_db, second)
                if not check.get("ok"):
                    why_left.append((who, f"second source: {check.get('why')}")); continue
            facts = dict(f)
            facts.update({k: v for k, v in (r.get("fwd") or {}).items() if k not in facts})
            if after:
                facts["after_20"] = {k: v for k, v in after.items() if k != "pinned"}
            if check:
                facts["second_source"] = {"source": "Yahoo daily closes today (split-adjusted; the bars' own vendor)",
                                          **{k: v for k, v in check.items() if k != "ok"}}
            facts["avg_dollar_volume_m"] = round((r.get("dv") or 0) / 1e6, 1)
            facts["known_name"] = r["sym"] in KNOWN
            if near is not None:
                facts["earnings_dates_near"] = near
                facts["earnings_day"] = bool(near)
            if has_history is not None:
                facts["earnings_history"] = has_history
            if setup == "Slingshot" and facts.get("gap_pct") is not None and "trigger_gap_pct" not in facts:
                facts["trigger_gap_pct"] = facts["gap_pct"]
            # the names the lesson lines (gen_setup_examples.fact_line) read, where this finder measured the same
            # thing under another name: the Oops pullback from the 20-day high (find_oops stores it signed, pass 3 as a
            # positive depth) and the Launchpad correction's size
            if setup == "Oops Reversal" and facts.get("pullback_pct") is None and facts.get("pullback_from_20d_high_pct") is not None:
                facts["pullback_pct"] = round(-float(facts["pullback_from_20d_high_pct"]), 1)
            if setup == "Launchpad" and facts.get("correction_abs_pct") is None and facts.get("correction_pct") is not None:
                facts["correction_abs_pct"] = round(abs(float(facts["correction_pct"])), 1)
            facts["context"] = dict(r.get("ctx") or {}, era=era, sector=r.get("sector"), industry=r.get("industry"),
                                    liq_rank=r.get("liq_rank"), liq_universe=r.get("liq_universe"))
            # "culmination", not "outcome": facts.outcome is the Study word for a resolved trade (target_hit, stop_hit)
            facts["culmination"] = r.get("out") or {}
            ex = {"setup": setup, "sym": r["sym"], "asof": asof, "year": int(asof[:4]), "close": r["close"],
                  "facts": facts, "q": r.get("score")}
            chosen.append(ex)
            per_era[era] += 1; dates_taken.add(asof)
        added[setup], left[setup] = chosen, why_left
        print(f"== {setup}: {len(rows)} chosen by choose.py, {len(chosen)} drafted; by era {dict(sorted(per_era.items()))}")
        for p in chosen:
            c = p["facts"]["context"]
            print(f"   {p['sym']:6} {p['asof']} score={p['q']} {c.get('sector') or '?'} market={c.get('market')} "
                  f"rank={c.get('liq_rank')}/{c.get('liq_universe')} culm={p['facts']['culmination'].get('culm_pct')}%")
        for who, why in why_left[:8] + [w for w in why_left[8:] if w[1].startswith(("second source", "pinned after"))]:
            print(f"   left  {who}: {why}")
    cache_path.write_text(json.dumps(cache, indent=0, sort_keys=True), encoding="utf-8")
    if a.bars_db:
        second_source.save_cache(second)
    total = sum(len(v) for v in added.values())
    if not a.write:
        print(f"DRY RUN: {total} examples would be added; run with --write")
        return 0
    n = 0
    for setup, rows in added.items():
        for p in rows:
            k = (p["setup"], p["sym"], p["asof"])
            if k not in have:
                examples.append(p); have.add(k); n += 1
    data[a.block] = {
        "generated": dt.date.today().isoformat(), "script": "scripts/study/bank_v2/draft_pass.py",
        "why": a.why or ("owner 2026-11-06: 'a variety of diverse and liquid and institutionally traded stocks and setups going back deep "
                "in time'. Every session since 1995 (scan_history.py over the pod's bars dump), the top 1,000 stocks by dollar "
                "volume that day, his calibrated finders' rules, clean of other setups on the same bar, spread over six eras, "
                "sectors and market conditions (choose.py), then the last pass's drafting rules unchanged."),
        "added": [{"setup": p["setup"], "sym": p["sym"], "asof": p["asof"]} for rows in added.values() for p in rows]}
    EXAMPLES.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    where = EXAMPLES.relative_to(REPO) if EXAMPLES.is_relative_to(REPO) else EXAMPLES
    print(f"wrote {n} new examples to {where}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
