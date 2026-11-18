"""Step A: rebuild flow.db and swap it in. Runs ON the flow-worker pod (see
docs/runbooks/flow-worker-deploys-and-flow-db.md for how to send it). Read-only on the
damaged file; builds /data/flow.db.new from sqlite_master, seeds sqlite_sequence so new ids
continue above every old id, copies the small tables, quick_checks the new file, then two
os.rename calls swap it in. FlowDB opens a connection per call, so live writes resume
within seconds and no restart is needed. Used twice on 2026-11-12.
"""
import functools, os, sqlite3, sys, time
print = functools.partial(print, flush=True)
MODE = "dry"             # "dry" first, read the plan, then set "swap"
DB = "/data/flow.db"
NEW = "/data/flow.db.new"
TAG = "/data/flow.db.corruptN-YYYY-MM-DD"   # name the damaged copy (kept for forensics)
BIG = {"flow", "q_pool_events", "worker_metrics"}   # flow: Step B; the other two are damaged telemetry
SMALL_MAX = 300000

src = sqlite3.connect("file:" + DB + "?mode=ro", uri=True, timeout=30)
objs = src.execute("select type,name,tbl_name,sql from sqlite_master where sql is not null").fetchall()
tables = [(n, s) for t, n, tb, s in objs if t == "table" and n != "sqlite_sequence"]
others = [(t, n, s) for t, n, tb, s in objs if t != "table"]
try:
    seq = dict(src.execute("select name, seq from sqlite_sequence").fetchall())
except Exception as e:
    seq = {}
    print("sqlite_sequence unreadable:", e)
try:
    max_id = src.execute("select max(id) from flow").fetchone()[0]
except Exception as e:
    print("max(id) unreadable:", e)
    max_id = None
# the canary saw max_id 48188608 at 16:47 UTC; writes failed from ~16:52. Start new ids well
# above anything the damaged file can hold: a gap in AUTOINCREMENT ids is harmless.
FLOOR = 0   # set ABOVE the last id the canary logged (max_id) when max(id) is unreadable
max_id = max(max_id or 0, FLOOR)
print("tables", len(tables), "indexes/views/triggers", len(others), "flow max_id", max_id, "seq", seq)

plan = {}
for n, s in tables:
    if n in BIG:
        plan[n] = "defer"
        continue
    try:
        cnt = src.execute('select count(*) from "%s" not indexed' % n).fetchone()[0]
        plan[n] = cnt if cnt <= SMALL_MAX else "defer:%d" % cnt
    except Exception as e:
        plan[n] = "unreadable:%s" % e
print("plan", plan)
if MODE != "swap":
    sys.exit(0)

if os.path.exists(NEW):
    os.remove(NEW)
dst = sqlite3.connect(NEW, timeout=30)
dst.execute("pragma journal_mode=WAL")
for n, s in tables:
    dst.execute(s)
for t, n, s in others:
    dst.execute(s)
dst.commit()
# AUTOINCREMENT: new rows continue after every id the damaged file ever handed out,
# so Step B can put history back under its ORIGINAL ids without a collision.
for name, v in seq.items():
    dst.execute("insert into sqlite_sequence(name, seq) values (?, ?)", (name, v))
if (seq.get("flow") or 0) < (max_id or 0):
    dst.execute("delete from sqlite_sequence where name='flow'")
    dst.execute("insert into sqlite_sequence(name, seq) values ('flow', ?)", (max_id,))
dst.commit()
copied = {}
for n, s in tables:
    v = plan.get(n)
    if not isinstance(v, int):
        continue
    cols = [r[1] for r in src.execute('pragma table_info("%s")' % n)]
    ql = ",".join('"%s"' % c for c in cols)
    try:
        rows = src.execute('select %s from "%s" not indexed' % (ql, n)).fetchall()
    except Exception as e:
        print("skip unreadable table", n, e)
        continue
    dst.executemany('insert or ignore into "%s" (%s) values (%s)' % (n, ql, ",".join("?" * len(cols))), rows)
    copied[n] = len(rows)
dst.commit()
qc = dst.execute("pragma quick_check").fetchone()[0]
nseq = dst.execute("select seq from sqlite_sequence where name='flow'").fetchone()
print("new db quick_check", qc, "copied", copied, "flow seq", nseq)
dst.close()
src.close()
if qc != "ok":
    print("ABORT: new db not ok, nothing swapped")
    sys.exit(2)
t0 = time.perf_counter()
for suf in ("-wal", "-shm"):
    if os.path.exists(DB + suf):
        os.rename(DB + suf, TAG + suf)
os.rename(DB, TAG)
os.rename(NEW, DB)
print("SWAPPED in %.4f s; damaged file kept at %s" % (time.perf_counter() - t0, TAG))
