"""BANK V2, STEP 2: choose a diverse, institutional, deep-history set from the atlas scan_history.py wrote.

Rules (the owner, 2026-11-06: "a variety of diverse and liquid and institutionally traded stocks and setups going back
deep in time"; his earlier rulings: liquid and sizable names only, one chart per stock per setup, examples that WORK,
no ETF as a Slingshot or Kicker):
  * INSTITUTIONAL: the instance's 50-day median dollar volume ranks in the top 1,000 of every stock that session
    (`liq_rank`), and the finder's own liquidity rule passed (scan_history.py records only those);
  * NOT ALREADY IN THE BANK: no stock and date the bank already holds for the setup, nor within 10 sessions of one;
  * CLEAN FOR HARD MODE: no other setup's engine rule fires on the same bar (`co_fires` empty); the rest go to an
    "ambiguous" list for his ruling ("both count", or not);
  * TEXTBOOK vs FAILED: the finder's must-work verdict (`works`) splits the set; the bank's examples are textbook (his
    rule), the failed ones are listed for analysis only (owner 2026-11-06: "I do not want to fire the failed events");
  * SPREAD: per setup, quotas across six eras (1995-99, 2000-04, 2005-09, 2010-14, 2015-19, 2020-26), at most
    `--per-era` from one era, at most two charts per stock (never two in one era), sectors spread by taking the
    least-used sector first among the best-scored candidates, market conditions kept in proportion by recording them.
Within those, the finder's own score orders the candidates (then liquidity). Read-only; prints a summary and writes
the chosen sets as JSON for the drafting step.

Usage:
  python scripts/study/bank_v2/choose.py --atlas <atlas.jsonl.gz> --out <picks.json> [--target 120] [--per-era 30]
"""
from __future__ import annotations

import argparse
import gzip
import json
import pathlib
from collections import Counter, defaultdict

REPO = pathlib.Path(__file__).resolve().parents[3]
BANK = REPO / "docs" / "study" / "bank"
ERAS = [(1995, 1999), (2000, 2004), (2005, 2009), (2010, 2014), (2015, 2019), (2020, 2026)]
NO_ETF_SETUPS = {"setup.family4.slingshot", "setup.family3.kicker"}


def era_of(t: int) -> str:
    y = int(str(t)[:4])
    for a, b in ERAS:
        if a <= y <= b:
            return f"{a}-{str(b)[2:]}"
    return "other"


def session_days(t: int) -> int:
    import datetime as dt
    s = str(t)
    return dt.date(int(s[:4]), int(s[4:6]), int(s[6:8])).toordinal()


def existing():
    """(skill, SYM) -> [day ordinals] already in the bank."""
    have = defaultdict(list)
    for p in BANK.glob("*.json"):
        d = json.loads(p.read_text(encoding="utf-8"))
        for it in (d if isinstance(d, list) else d.get("items") or []):
            sym = it.get("sym") or ((it.get("bars") or {}).get("sym") if isinstance(it.get("bars"), dict) else None)
            asof = it.get("asof") or ((it.get("bars") or {}).get("asof") if isinstance(it.get("bars"), dict) else None)
            if sym and asof and it.get("skill_id"):
                have[(it["skill_id"], str(sym).upper())].append(session_days(int(str(asof).replace("-", "")[:8])))
    return have


def pick(rows, target, per_era):
    rows = sorted(rows, key=lambda r: (-(r.get("score") or 0), r.get("liq_rank") or 10**9))
    chosen, by_sym, by_sym_era, by_era, by_sector = [], Counter(), Counter(), Counter(), Counter()
    pool = list(rows)
    while pool and len(chosen) < target:
        # among the best-scored dozen still eligible, take the one whose sector is least used so far
        window = []
        for r in pool:
            e = era_of(r["t"])
            if by_sym[r["sym"]] >= 2 or by_sym_era[(r["sym"], e)] >= 1 or by_era[e] >= per_era:
                continue
            window.append(r)
            if len(window) >= 12:
                break
        if not window:
            break
        r = min(window, key=lambda x: (by_sector[x.get("sector") or "?"], -(x.get("score") or 0)))
        pool.remove(r)
        e = era_of(r["t"])
        chosen.append(r); by_sym[r["sym"]] += 1; by_sym_era[(r["sym"], e)] += 1; by_era[e] += 1; by_sector[r.get("sector") or "?"] += 1
    return chosen


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--atlas", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--target", type=int, default=120)
    ap.add_argument("--failed", type=int, default=40)
    ap.add_argument("--per-era", type=int, default=30)
    ap.add_argument("--top", type=int, default=1000, help="the liquidity rank cutoff (institutional proxy)")
    a = ap.parse_args()
    rows = [json.loads(l) for l in gzip.open(a.atlas, "rt", encoding="utf-8")]
    have = existing()
    try:
        etfs = set(json.loads((REPO / "api/data/prebuilt_etfs.json").read_text(encoding="utf-8")))
    except Exception:
        etfs = set()
    out, lines = {}, ["# Bank v2 selection", ""]
    for skill in sorted({r["skill"] for r in rows}):
        mine = [r for r in rows if r["skill"] == skill and (r.get("liq_rank") or 10**9) <= a.top]
        if skill in NO_ETF_SETUPS:
            mine = [r for r in mine if r["sym"] not in etfs]
        fresh = [r for r in mine if all(abs(session_days(r["t"]) - d) > 14 for d in have.get((skill, r["sym"]), []))]
        clean = [r for r in fresh if not r["co_fires"]]
        ambiguous = [r for r in fresh if r["co_fires"]]
        long_ok = [r for r in clean if r.get("works") is not False]     # HVE and the bear gap carry no must-work verdict
        failed = [r for r in clean if r.get("works") is False]
        textbook = pick(long_ok, a.target, a.per_era)
        fails = pick(failed, a.failed, max(8, a.failed // 4))
        amb = pick(ambiguous, 40, 10)
        out[skill] = {"textbook": textbook, "failed": fails, "ambiguous": amb,
                      "pool": {"institutional": len(mine), "fresh": len(fresh), "clean": len(clean), "ambiguous": len(ambiguous),
                               "works": len(long_ok), "failed": len(failed)}}
        name = skill.split(".")[-1]
        lines += [f"## {name}",
                  f"- pool: {len(mine)} institutional instances, {len(fresh)} not already in the bank; {len(clean)} clean, "
                  f"{len(ambiguous)} where another setup also fires; of the clean, {len(long_ok)} worked and {len(failed)} failed",
                  f"- chosen: {len(textbook)} textbook, {len(fails)} failed, {len(amb)} ambiguous for his ruling",
                  f"- textbook by era: {dict(sorted(Counter(era_of(r['t']) for r in textbook).items()))}",
                  f"- textbook by market: {dict(Counter((r.get('ctx') or {}).get('market') for r in textbook))}",
                  f"- textbook by sector: {dict(Counter(r.get('sector') or '?' for r in textbook).most_common(12))}",
                  f"- distinct stocks: {len({r['sym'] for r in textbook})}", ""]
    pathlib.Path(a.out).write_text(json.dumps(out, default=str), encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
