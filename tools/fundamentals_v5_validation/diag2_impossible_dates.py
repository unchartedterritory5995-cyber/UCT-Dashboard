"""Read-only: points whose period_end is AFTER the day they became effective, V5 vs V4 (same key set?)."""
import datetime as dt, json, sqlite3, collections
VAL = "/data/fundamentals_pit_v5/validation"
ro = lambda p: sqlite3.connect(f"file:{p}?mode=ro", uri=True, timeout=60)


def after(c, v):
    s = set()
    for cik, m, t, p, me in c.execute("SELECT cik, metric, t_eff, period_end, method FROM series_point WHERE derivation_version=?", (v,)):
        d = dt.datetime.utcfromtimestamp(t).date()
        if dt.date(p // 10000, p // 100 % 100, p % 100) > d:
            s.add((cik, m, t, p, me))
    return s


a5, a4 = after(ro("/data/fundamentals_pit_v5/run/v5.db"), 5), after(ro("/data/fundamentals_pit.db"), 4)
k5, k4 = {x[:3] for x in a5}, {x[:3] for x in a4}
out = {"v5": len(a5), "v4": len(a4), "same_keys": len(k5 & k4), "only_v5": sorted(k5 - k4)[:40], "only_v4": sorted(k4 - k5)[:40],
       "v5_companies": len({x[0] for x in a5}), "days_ahead_pctl": None, "v5_gap_points": sum(1 for x in a5 if x[4] == "gap")}
ahead = sorted((dt.date(p // 10000, p // 100 % 100, p % 100) - dt.datetime.utcfromtimestamp(t).date()).days for _, _, t, p, _ in a5)
out["days_ahead_pctl"] = {q: ahead[min(len(ahead) - 1, int(len(ahead) * q / 100))] for q in (10, 50, 90, 99, 100)}
json.dump(out, open(VAL + "/diag2.json", "w"), indent=1, default=str)
print(json.dumps(out, default=str))
