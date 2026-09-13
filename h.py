import sqlite3, os
c = sqlite3.connect(os.getenv("DATA_DIR","/data")+"/auth.db"); c.row_factory=sqlite3.Row
print("== sync_log rows per day / status ==")
for r in c.execute("SELECT substr(started_at,1,10) d, status, count(*) n, min(substr(started_at,12,8)) t0, max(substr(started_at,12,8)) t1 FROM j2_broker_sync_log GROUP BY d, status ORDER BY d DESC LIMIT 40"):
    print(f"  {r['d']}  {r['status']:<6} n={r['n']:<4} {r['t0']}..{r['t1']} UTC")
print("\n== distinct error texts ==")
for r in c.execute("SELECT substr(error,1,80) e, count(*) n, min(started_at) f, max(started_at) l FROM j2_broker_sync_log WHERE error IS NOT NULL GROUP BY e ORDER BY n DESC LIMIT 15"):
    print(f"  n={r['n']:<4} {r['f'][:19]} -> {r['l'][:19]}  {r['e']}")
print("\n== all 06:2x-06:4x UTC runs (nightly reconcile window) ==")
for r in c.execute("SELECT substr(started_at,1,19) s, status, count(*) n FROM j2_broker_sync_log WHERE substr(started_at,12,2) IN ('06') GROUP BY substr(started_at,1,10), status ORDER BY s DESC LIMIT 30"):
    print(f"  {r['s']}  {r['status']:<6} n={r['n']}")
