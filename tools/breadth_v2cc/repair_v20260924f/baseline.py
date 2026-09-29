import json, os, sys, sqlite3, hashlib, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import semdig
R = "/data/_audit/v2cc/repair_v20260924f"
ART = "/data/_audit/v2cc/final/breadth_v2c2div_FINAL_v20260924f.db"
BASE = R + "/BASELINE_pre_repair_breadth_v2c2div_FINAL_v20260924f.db"
def sha(p):
    h = hashlib.sha256(); f = open(p, "rb")
    for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
    return h.hexdigest()
s0 = sha(ART)
assert s0 == "30c8b8ae30e3c507a57d77de2a7b90a80f22ff8dd9bf8f003a969db62092d6cb", s0
assert os.path.getsize(ART + "-wal") == 0
if not os.path.exists(BASE):
    shutil.copyfile(ART, BASE); os.chmod(BASE, 0o444)
assert sha(BASE) == s0
WIN = ("2016-08-24", "2016-09-07")
c = sqlite3.connect("file:%s?mode=ro&immutable=1" % BASE, uri=True)
q = lambda s, *a: [list(r) for r in c.execute(s, a)]
exp = {
 "artifact_sha256": s0, "baseline_copy": BASE,
 "window": WIN, "adjacent": ["2016-08-23", "2016-09-08"],
 "checkpoints_window_plus_adjacent": q("SELECT * FROM pass_checkpoint WHERE date BETWEEN '2016-08-23' AND '2016-09-08' ORDER BY date"),
 "rows_by_universe_date": q("SELECT universe,date,COUNT(*),SUM(metric LIKE 'ratio_%') FROM breadth_daily_ohlc WHERE date BETWEEN '2016-08-23' AND '2016-09-08' GROUP BY 1,2 ORDER BY 1,2"),
 "rows": q("SELECT universe,date,metric,o,h,l,c,source,updated_at FROM breadth_daily_ohlc WHERE date BETWEEN '2016-08-23' AND '2016-09-08' ORDER BY 1,2,3"),
 "pass_session": q("SELECT * FROM pass_session WHERE date BETWEEN '2016-08-23' AND '2016-09-08' ORDER BY date"),
 "pass_session_v2c2": q("SELECT * FROM pass_session_v2c2 WHERE date BETWEEN '2016-08-23' AND '2016-09-08' ORDER BY date"),
 "run_identity": dict(c.execute("SELECT key,value FROM pass_meta WHERE key LIKE 'launch_%' OR key LIKE 'leg%'")),
}
c.close()
json.dump(exp, open(R + "/02_baseline_window_export.json", "x"), indent=0, default=repr)
json.dump(semdig.digest(BASE), open(R + "/02_baseline_semantic_digest.json", "x"))
for p in ("02_baseline_window_export.json", "02_baseline_semantic_digest.json"): os.chmod(R + "/" + p, 0o444)
print(json.dumps({"artifact_sha256": s0, "baseline_copy_sha256": sha(BASE),
  "export_sha256": sha(R + "/02_baseline_window_export.json"), "digest_sha256": sha(R + "/02_baseline_semantic_digest.json"),
  "checkpoints": exp["checkpoints_window_plus_adjacent"]}, indent=1, default=repr))
