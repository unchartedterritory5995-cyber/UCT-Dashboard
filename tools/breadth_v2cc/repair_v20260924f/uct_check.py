"""Phase 13: canonical UCT in the final artifact vs the pinned PIT ledger. Read-only."""
import json, sqlite3, collections, glob, os, hashlib
ART = "/data/_audit/v2cc/final/breadth_v2c2div_FINAL_v20260924f.db"
IN = "/data/_audit/v2cc/inputs_v20260924f"
L = json.load(open(IN + "/pit_uct_ledger.json"))
c = sqlite3.connect("file:%s?mode=ro&immutable=1" % ART, uri=True)
q = lambda s, *a: c.execute(s, a).fetchall()
acc = sorted(L["dates"]); rej = sorted(L.get("rejected_not_pit", {})); bf = sorted(L.get("excluded_backfilled_dates", []))
art = sorted(d for (d,) in q("SELECT DISTINCT date FROM breadth_daily_ohlc WHERE universe='uct'"))
sizes = {d: json.loads(s).get("uct") for d, s in q("SELECT date, universe_sizes FROM pass_session_v2c2")}
cal = sorted(os.path.basename(p)[:-7] for p in glob.glob("/data/grouped_closes_v20260924f/*_1.json"))
ix = {d: i for i, d in enumerate(cal)}
rat = collections.defaultdict(set)
for d, m in q("SELECT date, metric FROM breadth_daily_ohlc WHERE universe='uct' AND metric LIKE 'ratio_%'"): rat[d].add(m)
exp_abs = {}
for d in art:
    i = ix[d]
    for key, n in (("ratio_5day", 5), ("ratio_10day", 10)):
        win = cal[i - n + 1:i + 1]
        if not all(x in L["dates"] for x in win): exp_abs.setdefault(d, set()).add(key)
bad_bridge = sorted((d, k) for d in art for k in rat[d] if k in exp_abs.get(d, set()))
missing = sorted((d, k) for d in art for k in ("ratio_5day", "ratio_10day") if k not in rat[d] and k not in exp_abs.get(d, set()))
R = {"ledger_sha256": hashlib.sha256(open(IN + "/pit_uct_ledger.json", "rb").read()).hexdigest(),
     "ledger_live_from": L["live_from"], "ledger_accepted": len(acc), "ledger_first": acc[0], "ledger_last": acc[-1],
     "ledger_rejected": rej, "artifact_uct_sessions": len(art), "artifact_first": art[0], "artifact_last": art[-1],
     "artifact_equals_ledger": art == acc, "only_in_artifact": sorted(set(art) - set(acc)), "only_in_ledger": sorted(set(acc) - set(art)),
     "rows_on_rejected": q("SELECT date, COUNT(*) FROM breadth_daily_ohlc WHERE universe='uct' AND date IN (%s) GROUP BY 1" % ",".join("?" * len(rej)), *rej),
     "rows_before_live_from": q("SELECT COUNT(*) FROM breadth_daily_ohlc WHERE universe='uct' AND date < ?", L["live_from"])[0][0],
     "rows_on_backfilled": q("SELECT COUNT(*) FROM breadth_daily_ohlc WHERE universe='uct' AND date IN (%s)" % ",".join("?" * len(bf)), *bf)[0][0] if bf else 0,
     "session_rows_with_uct_outside_ledger": sorted(d for d, s in sizes.items() if s and d not in L["dates"]),
     "rows_per_session": dict(collections.Counter(n for _, n in q("SELECT date, COUNT(*) FROM breadth_daily_ohlc WHERE universe='uct' GROUP BY 1"))),
     "size_vs_ledger_n": {"min_share": min(sizes[d] / int(L["dates"][d]["n"]) for d in art), "max_share": max(sizes[d] / int(L["dates"][d]["n"]) for d in art),
                          "exceeds_ledger": [d for d in art if sizes[d] > int(L["dates"][d]["n"])]},
     "universe_count_close_equals_session_size": sum(1 for d, cc in q("SELECT date, c FROM breadth_daily_ohlc WHERE universe='uct' AND metric='universe_count'") if cc == sizes[d]),
     "ratio_expected_absent_sessions": {k: sorted(d for d, v in exp_abs.items() if k in v) for k in ("ratio_5day", "ratio_10day")},
     "ratio_bridged": bad_bridge, "ratio_missing": missing,
     "research_universes_meta": dict(q("SELECT key, value FROM pass_meta WHERE key='research_universes'")),
     "uct_backtest_first": q("SELECT MIN(date) FROM breadth_daily_ohlc WHERE universe='uct_backtest'")[0][0],
     "universes": [u for (u,) in q("SELECT DISTINCT universe FROM breadth_daily_ohlc ORDER BY 1")]}
p = "/data/_audit/v2cc/repair_v20260924f/13_uct_check.json"
json.dump(R, open(p, "w"), indent=1, default=str)
print(json.dumps(R, indent=1, default=str))
