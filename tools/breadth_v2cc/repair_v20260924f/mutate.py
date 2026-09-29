import json, sqlite3, hashlib, os, shutil, time
R = "/data/_audit/v2cc/repair_v20260924f"; F = "/data/_audit/v2cc/final"
ART = F + "/breadth_v2c2div_FINAL_v20260924f.db"
CLOSURE = ["2016-08-24", "2016-08-25", "2016-08-26", "2016-08-29", "2016-08-30",
           "2016-08-31", "2016-09-01", "2016-09-02", "2016-09-06", "2016-09-07"]
def sha(p): return hashlib.sha256(open(p, "rb").read()).hexdigest()
assert sha(ART) == "30c8b8ae30e3c507a57d77de2a7b90a80f22ff8dd9bf8f003a969db62092d6cb"
import fcntl
lk = open(F + "/v2c2_final.lock", "r+"); fcntl.flock(lk, fcntl.LOCK_EX | fcntl.LOCK_NB)   # no grinder may be live
shutil.copyfile(F + "/LEDGER_v20260924f.json", R + "/04_LEDGER_v20260924f_as_of_first_leg.json")
c = sqlite3.connect(ART, isolation_level=None)
# the closure must equal the grouped-calendar dependency set exactly
from glob import glob
cal = sorted(os.path.basename(p)[:-7] for p in glob("/data/grouped_closes_v20260924f/*_1.json"))
i = cal.index("2016-08-24"); assert cal[i:i + 10] == CLOSURE, cal[i:i + 11]
before = [list(r) for r in c.execute("SELECT * FROM pass_checkpoint WHERE date IN (%s) ORDER BY date" % ",".join("?" * 10), CLOSURE)]
assert len(before) == 10 and before[0][1] == "failed" and all(r[1] == "done" for r in before[1:])
c.execute("BEGIN IMMEDIATE")
n = c.execute("DELETE FROM pass_checkpoint WHERE date IN (%s)" % ",".join("?" * 10), CLOSURE).rowcount
assert n == 10
c.execute("COMMIT")
after = dict(c.execute("SELECT status, COUNT(*) FROM pass_checkpoint GROUP BY 1"))
c.execute("PRAGMA wal_checkpoint(TRUNCATE)"); c.close()
rec = {"at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "deleted": before, "closure": CLOSURE,
       "calendar_neighbors": cal[i - 1:i + 11], "counts_after": after, "total_after": sum(after.values()),
       "artifact_sha256_after_mutation": sha(ART)}
json.dump(rec, open(R + "/05_checkpoint_mutation.json", "x"), indent=1); os.chmod(R + "/05_checkpoint_mutation.json", 0o444)
print(json.dumps(rec, indent=1))
