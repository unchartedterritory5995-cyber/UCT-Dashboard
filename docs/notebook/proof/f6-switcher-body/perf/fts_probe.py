import sys, time, sqlite3, glob, statistics
db = glob.glob(r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\bench\j2_bench_50000_*\bench.db")[0]
conn = sqlite3.connect(db)
U = "bench_user"
def t(label, f, reps=15):
    for _ in range(2): f()
    xs = []
    for _ in range(reps):
        a = time.perf_counter(); r = f(); xs.append((time.perf_counter() - a) * 1000)
    xs.sort()
    print(f"{label:55s} p50 {statistics.median(xs):7.1f}  p95 {xs[int(0.95*(len(xs)-1))]:7.1f}  rows {len(r)}")
A = ("SELECT m.note_rowid, bm25(j2_notes_fts) FROM j2_notes_fts JOIN j2_notes_fts_map m ON m.fts_rowid = j2_notes_fts.rowid"
     " WHERE j2_notes_fts MATCH ?1 AND +m.note_rowid IN (SELECT rowid FROM j2_notes WHERE user_id = ?2)")
B = ("SELECT n.rowid FROM j2_notes_fts JOIN j2_notes_fts_map m ON m.fts_rowid = j2_notes_fts.rowid"
     " JOIN j2_notes n ON n.rowid = m.note_rowid"
     " WHERE j2_notes_fts MATCH ?1 AND n.user_id = ?2 AND n.deleted_at IS NULL AND n.archived_at IS NULL"
     " ORDER BY bm25(j2_notes_fts), n.updated_at DESC, n.rowid LIMIT 10")
C = "SELECT rowid FROM j2_notes_fts WHERE j2_notes_fts MATCH ?1 ORDER BY rank LIMIT 10"
D = "SELECT rowid FROM j2_notes_fts WHERE j2_notes_fts MATCH ?1"
E = "SELECT rowid FROM j2_notes_fts WHERE j2_notes_fts MATCH ?1 LIMIT 10"
for q in ['"constructive" "breadth"*', '"pullback"*', '"zzqbenchmarkrareterm"*']:
    t(f"A ranked pass (search box) {q}", lambda: conn.execute(A, (q, U)).fetchall())
    t(f"B top-10 joined {q}", lambda: conn.execute(B, (q, U)).fetchall())
    t(f"C fts rank limit 10 {q}", lambda: conn.execute(C, (q,)).fetchall())
    t(f"D fts match only {q}", lambda: conn.execute(D, (q,)).fetchall())
    t(f"E fts match limit 10 {q}", lambda: conn.execute(E, (q,)).fetchall())
