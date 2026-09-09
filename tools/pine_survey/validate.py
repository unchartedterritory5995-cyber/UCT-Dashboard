"""
validate.py — an INDEPENDENT CONTROL on the regex inventory.

TradingView's own compiler publishes per-script call counts for five plot-family
primitives in `extra.stats` (from the search endpoint). Those numbers are not
mine and not derived from my parser, so comparing them to my regex counts is a
real external check on the whole demand table — not a self-consistency test.

⚠️ It can only check the five primitives TV counts. `extra.stats` omits hline,
fill, bgcolor, barcolor and EVERY drawing object, so agreement here bounds the
error on the plot family only. Say so wherever this result is quoted.

Writes validation.json and prints the verdict.
"""

import json
import os
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
KEYS = ["plot", "plotshape", "plotchar", "plotcandle", "plotarrow"]


def main():
    inv = json.load(open(os.path.join(HERE, "inventory.json"), encoding="utf-8"))
    rows = []
    for slug, r in inv.items():
        tv = r.get("tv_stats")
        if not isinstance(tv, dict):
            continue
        pres = r.get("presentation") or {}
        rec = {"slug": slug, "title": r.get("title"), "pine_version": r.get("pine_version")}
        any_key = False
        for k in KEYS:
            mine = (pres.get(k) or {}).get("count", 0)
            theirs = tv.get(k, 0)
            if mine or theirs:
                any_key = True
            rec[k] = {"mine": mine, "tv": theirs, "delta": mine - theirs}
        # alertcondition lives in features, not presentation
        mine_ac = (r.get("features") or {}).get("alertcondition", 0)
        tv_ac = tv.get("alertcondition", 0)
        if mine_ac or tv_ac:
            any_key = True
        rec["alertcondition"] = {"mine": mine_ac, "tv": tv_ac, "delta": mine_ac - tv_ac}
        if any_key:
            rows.append(rec)

    checked = KEYS + ["alertcondition"]
    summary = {}
    for k in checked:
        exact = over = under = 0
        deltas = []
        worst = []
        for rec in rows:
            d = rec[k]["delta"]
            if rec[k]["mine"] == 0 and rec[k]["tv"] == 0:
                continue
            deltas.append(d)
            if d == 0:
                exact += 1
            elif d > 0:
                over += 1
            else:
                under += 1
            if abs(d) >= 2:
                worst.append((abs(d), rec["slug"], rec[k]["mine"], rec[k]["tv"]))
        n = len(deltas)
        worst.sort(reverse=True)
        summary[k] = {
            "scripts_compared": n,
            "exact_match": exact,
            "exact_pct": round(100.0 * exact / n, 1) if n else None,
            "regex_over": over,
            "regex_under": under,
            "mean_signed_delta": round(sum(deltas) / n, 3) if n else None,
            "worst": [{"slug": s, "mine": m, "tv": t, "abs_delta": a} for a, s, m, t in worst[:10]],
        }

    json.dump({"n_rows": len(rows), "summary": summary},
              open(os.path.join(HERE, "validation.json"), "w", encoding="utf-8"), indent=1)

    print("=== REGEX INVENTORY vs TRADINGVIEW'S OWN COMPILER COUNTS ===")
    print("scripts with TV stats available: %d\n" % len(rows))
    print("  %-16s %8s %8s %8s %7s %7s %9s" %
          ("primitive", "compared", "exact", "exact%", "over", "under", "mean d"))
    for k in checked:
        s = summary[k]
        if not s["scripts_compared"]:
            continue
        print("  %-16s %8d %8d %7s%% %7d %7d %9s" %
              (k, s["scripts_compared"], s["exact_match"], s["exact_pct"],
               s["regex_over"], s["regex_under"], s["mean_signed_delta"]))
    print("\nWorst disagreements (plot):")
    for w in summary["plot"]["worst"][:6]:
        print("  %-58s mine=%d tv=%d" % (w["slug"][:58], w["mine"], w["tv"]))

    vmix = Counter(r.get("pine_version") for r in inv.values())
    print("\n(reference) pine version mix over %d scripts: %s" % (len(inv), dict(sorted(
        vmix.items(), key=lambda x: (x[0] is None, x[0])))))


if __name__ == "__main__":
    main()
