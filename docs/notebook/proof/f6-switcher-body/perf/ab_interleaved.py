import sys, time, sqlite3, glob, statistics, json
sys.path.insert(0, r"C:\Users\Patrick\uct-worktrees\notebook-w10s2")
import conftest  # noqa
from api.services import auth_db; auth_db.init_db()
from api.services.journal_two import notes as new
from api.services.journal_two import _f6_base_tmp as old
db = sorted(glob.glob(r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\bench\j2_bench_50000_*\bench.db"))[0]
conn = sqlite3.connect(db); conn.row_factory = sqlite3.Row
U = "bench_user"
Q = {"word start": "nvda setup", "fuzzy, in order": "ntvds",
     "body fallback, common term": "regime check confirms constructive breadth",
     "body fallback, rare term": "zzqbenchmarkrareterm", "body fallback, 100% term": "pullback"}
ROUNDS, REPS = int(sys.argv[1]), int(sys.argv[2])
res = {(k, v): [] for k in Q for v in ("before", "after")}
fn = {"before": old.switcher_search, "after": new.switcher_search}
for k, q in Q.items():
    for v in fn: fn[v](U, q, conn=conn); fn[v](U, q, conn=conn)
for r in range(ROUNDS):
    for k, q in Q.items():
        for v in (("before", "after") if r % 2 == 0 else ("after", "before")):
            for _ in range(REPS):
                a = time.perf_counter(); fn[v](U, q, conn=conn); res[(k, v)].append((time.perf_counter() - a) * 1000)
out = {}
for k, q in Q.items():
    row = []
    for v in ("before", "after"):
        xs = sorted(res[(k, v)])
        p50 = statistics.median(xs); p95 = xs[int(0.95 * (len(xs) - 1))]
        out[f"{k}|{v}"] = (round(p50, 1), round(p95, 1))
        row.append(f"{v} p50 {p50:6.1f} p95 {p95:6.1f}")
    b = new.switcher_search(U, q, conn=conn); o = old.switcher_search(U, q, conn=conn)
    print(f"{k:28s} {q[:22]!r:25s} | " + " | ".join(row) + f" | rows before {len(o['notes'])} after {len(b['notes'])}")
json.dump(out, open(sys.argv[3], "w"), indent=1)
