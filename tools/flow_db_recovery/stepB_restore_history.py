"""Step B: copy history back from the damaged copy into the live flow.db, newest first, in
`id >= ? AND id < ?` windows of 5000 (INSERT OR IGNORE, original ids), bisecting unreadable
windows down to 25 ids and logging them. Pauses itself when the volume has < 10 GB free.
Run DETACHED on the pod: `setsid -f nohup /opt/venv/bin/python /data/flow_stepB.py >>
/data/flow_stepB.log 2>&1 < /dev/null` (plain nohup dies with the railway ssh session).
"""
import functools, json, os, shutil, sqlite3, time
print = functools.partial(print, flush=True)
SRC = "/data/flow.db.corruptN-YYYY-MM-DD"   # the damaged copy Step A kept
DST = "/data/flow.db"
STATE = "/data/flow_stepB.state.json"     # resumable: delete to start over
WIN = 5000          # ids per window: keeps each write transaction short beside the live writer
MIN_WIN = 25        # bisect a failing window down to this before giving up on it
PAUSE = 0.05        # let the live writer in between windows

src = sqlite3.connect("file:" + SRC + "?mode=ro", uri=True, timeout=30)
dst = sqlite3.connect(DST, timeout=60)
dst.execute("pragma journal_mode=WAL")
dst.execute("pragma synchronous=NORMAL")
# keep the WAL file small after each reset: SQLite never shrinks it otherwise (it sat at 6.9 GB)
dst.execute("pragma journal_size_limit=268435456")
FREE_FLOOR = 10e9   # stop, never fill the disk: a full disk is what corrupted this db
windows = 0
cols = [r[1] for r in src.execute("pragma table_info(flow)")]
ql = ",".join('"%s"' % c for c in cols)
ins = "insert or ignore into flow (%s) values (%s)" % (ql, ",".join("?" * len(cols)))
sel = "select %s from flow where id >= ? and id < ?" % ql
def _q(sql, dflt):
    try:
        v = src.execute(sql).fetchone()[0]
        return v if v is not None else dflt
    except Exception as e:
        print("unreadable:", sql, e)
        return dflt
lo_id = _q("select min(id) from flow", 44536488)
hi_id = _q("select max(id) from flow", 48200000)
state = {"next_hi": hi_id + 1, "copied": 0, "skipped": [], "started": time.time()}
if os.path.exists(STATE):
    state.update(json.load(open(STATE)))
print("stepB from", state["next_hi"], "down to", lo_id, "copied so far", state["copied"])


def save():
    tmp = STATE + ".tmp"
    json.dump(state, open(tmp, "w"))
    os.replace(tmp, STATE)


def read(a, b):
    """Rows with a <= id < b, bisecting around unreadable pages; returns (rows, skipped spans)."""
    try:
        return src.execute(sel, (a, b)).fetchall(), []
    except sqlite3.DatabaseError as e:
        if "malformed" not in str(e) and "not a database" not in str(e):
            raise
        if b - a <= MIN_WIN:
            return [], [[a, b]]
        m = (a + b) // 2
        r1, s1 = read(a, m)
        r2, s2 = read(m, b)
        return r1 + r2, s1 + s2


last_log = 0
while state["next_hi"] > lo_id:
    b = state["next_hi"]
    a = max(lo_id, b - WIN)
    rows, skipped = read(a, b)
    if rows:
        for attempt in range(20):
            try:
                dst.executemany(ins, rows)
                dst.commit()
                break
            except sqlite3.OperationalError as e:
                if "locked" not in str(e):
                    raise
                dst.rollback()
                time.sleep(0.5)
        else:
            raise RuntimeError("could not get the write lock for 20 tries")
    state["copied"] += len(rows)
    if skipped:
        state["skipped"].extend(skipped)
        print("SKIPPED unreadable id spans", skipped)
    state["next_hi"] = a
    save()
    if time.time() - last_log > 30:
        last_log = time.time()
        done = (hi_id + 1 - a) / max(1, hi_id + 1 - lo_id)
        print("progress id<%d copied=%d %.1f%% elapsed=%ds" % (a, state["copied"], 100 * done, time.time() - state["started"]))
    windows += 1
    if windows % 20 == 0:
        dst.execute("pragma wal_checkpoint(PASSIVE)")
        free = shutil.disk_usage("/data").free
        if free < FREE_FLOOR:
            print("PAUSED: free disk %.1f GB under the floor; resume later from state" % (free / 1e9))
            break
    time.sleep(PAUSE)
print("DONE copied=%d skipped_spans=%d elapsed=%ds" % (state["copied"], len(state["skipped"]), time.time() - state["started"]))
