import sys, time, sqlite3, glob, statistics, json
sys.path.insert(0, r"C:\Users\Patrick\uct-worktrees\notebook-w10s2")
import conftest  # noqa
from api.services import auth_db; auth_db.init_db()
from api.services.journal_two import notes as n
n._log_notebook_event = lambda *a, **k: None
db = sorted(glob.glob(r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\bench\j2_bench_50000_*\bench.db"))[0]
conn = sqlite3.connect(db); conn.row_factory = sqlite3.Row
U = "bench_user"
LIVE = ("SELECT rowid, updated_at FROM j2_notes WHERE rowid IN (SELECT value FROM json_each(?))"
        " AND user_id = ? AND deleted_at IS NULL AND archived_at IS NULL")
def topk(q, k):
    n.register_note_sql_functions(conn)
    tag_index = n._tag_index_ready(conn); fts_map = n._fts_map_ready(conn)
    expr = n.fts_match_expr(q)
    parts = n._q_match_parts(U, q, tag_index=tag_index, fts_map=fts_map)
    ranked_sql = n._RELEVANCE_RANKED_SQL if fts_map else n._RELEVANCE_RANKED_SQL_BY_ID
    scores = {}
    for rid, s in n._tuples(conn, ranked_sql, [expr, U]):
        if rid is not None: scores[rid] = s
    other = set()
    for key in ("tag", "ticker"):
        if parts[key]:
            other.update(r[0] for r in conn.execute(parts[key][0], parts[key][1]))
    other -= scores.keys()
    got = []
    if other:
        got += list(n._tuples(conn, LIVE, [json.dumps(sorted(other)), U]))
    if len(got) < k:
        order = sorted(scores.items(), key=lambda x: x[1])
        i, step = 0, max(4 * k, 64)
        live_text = []
        while i < len(order):
            chunk = order[i:i + step]; i += step
            live_text += list(n._tuples(conn, LIVE, [json.dumps([r for r, _ in chunk]), U]))
            if len(live_text) + len(got) >= k:
                # every row tied with the last fetched score must be read too
                last = chunk[-1][1]
                while i < len(order) and order[i][1] == last:
                    j = i
                    while j < len(order) and order[j][1] == last: j += 1
                    live_text += list(n._tuples(conn, LIVE, [json.dumps([r for r, _ in order[i:j]]), U])); i = j
                break
        got += live_text
    got.sort(key=lambda r: (r[1] or "", -r[0]), reverse=True)
    got.sort(key=lambda r: -1e9 if scores.get(r[0]) is None else scores[r[0]])
    return [r[0] for r in got[:k]]
def ref(q, k):
    rows = n.list_notes(U, q=q, sort="relevance", limit=k, conn=conn, _quiet=True)
    ids = [r["id"] for r in rows]
    m = {r[0]: r[1] for r in conn.execute("SELECT id, rowid FROM j2_notes WHERE user_id=?", (U,))} if ids else {}
    return [m[i] for i in ids]
def t(label, f, reps=15):
    for _ in range(2): f()
    xs = []
    for _ in range(reps):
        a = time.perf_counter(); f(); xs.append((time.perf_counter() - a) * 1000)
    xs.sort(); return f"{label} p50 {statistics.median(xs):6.1f} p95 {xs[int(0.95*(len(xs)-1))]:6.1f}"
for q in ["regime check confirms constructive breadth", "pullback", "zzqbenchmarkrareterm", "setup", "nvda", "above average volume"]:
    a, b = topk(q, 9), ref(q, 9)
    print(q[:24], "EQUAL" if a == b else f"DIFF {a} {b}", t("topk", lambda: topk(q, 9)), "|", t("list_notes", lambda: n.list_notes(U, q=q, sort="relevance", limit=9, conn=conn, _quiet=True)))
