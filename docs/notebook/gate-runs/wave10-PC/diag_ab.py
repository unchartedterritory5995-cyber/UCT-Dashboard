"""Lane PC diagnosis, step 2: A/B of the two CANDIDATE product changes, on the benchmark's own
seed, before either is made in product code. EVIDENCE TOOLING.

  tasks   A = list_tasks as shipped (partial index idx_j2_notes_live_tasks:
              user_id, deleted_at, archived_at, updated_at DESC)
          B = the same list_tasks with that index replaced by one that also carries id and
              title (the read's other two columns), so a note with a task-index row is read
              from the index and the digest alone, never from its table row
  backlinks A = get_symbol_backlinks as shipped (a COUNT pass over the symbol's note set, then
              a page pass over the SAME set joined to a GROUP BY of every embed of the symbol)
            B = one pass: every live hit's (id, title, updated_at) with COUNT(*) OVER () as the
              total, ordered and limited to the page; the embed detail read for the <= 25 ids
              on the page only

Each tier: seed, then `rounds` interleaved (A, B) pairs per op on the benchmark's connection
shape (defaults) and on cache_size 64 MiB; p50 of 20 after 2 warm-ups per half (the
benchmark's _measure). B's answer is compared to A's (same count, same page) -- a faster wrong
answer is not a result. Usage: python diag_ab.py --json out.json [--tiers ...] [--rounds 3]"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import diag_curve as dc  # noqa: E402

bench, notes_svc, note_tasks = dc.bench, dc.notes_svc, dc.note_tasks

COVER_DDL = ("CREATE INDEX IF NOT EXISTS idx_j2_notes_live_tasks_cover"
             " ON j2_notes(user_id, deleted_at, archived_at, updated_at DESC, id, title)"
             " WHERE instr(body_json, 'taskItem') > 0")


def backlinks_one_pass(conn, user_id, symbol, limit=5):
    sym = (symbol or "").strip().upper()
    out = {"symbol": sym, "count": 0, "notes": []}
    ids_sql, ids_params = notes_svc._symbol_note_ids_sql(user_id, [sym])
    rows = conn.execute(
        "SELECT n.id, n.title, n.updated_at, COUNT(*) OVER () AS total"
        f" FROM ({ids_sql}) x CROSS JOIN j2_notes n ON n.id = x.note_id"
        " WHERE n.user_id = ? AND n.deleted_at IS NULL"
        " ORDER BY n.updated_at DESC LIMIT ?",
        (*ids_params, user_id, max(1, min(limit, 25)))).fetchall()
    if not rows:
        return out
    out["count"] = int(rows[0]["total"])
    ids = [r["id"] for r in rows]
    marks = ",".join("?" * len(ids))
    det = {r["note_id"]: r for r in conn.execute(
        "SELECT note_id, COUNT(*) AS refs, GROUP_CONCAT(DISTINCT widget_id) AS widgets"
        f" FROM j2_note_embeds WHERE user_id = ? AND symbol = ? AND note_id IN ({marks})"
        " GROUP BY note_id", (user_id, sym, *ids))}
    out["notes"] = [{"id": r["id"], "title": r["title"] or "Untitled", "updatedAt": r["updated_at"],
                     "refs": int(det[r["id"]]["refs"]) if r["id"] in det else 0,
                     "widgetIds": sorted((det[r["id"]]["widgets"] or "").split(","))
                     if r["id"] in det and det[r["id"]]["widgets"] else []} for r in rows]
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tiers", default="1000,5000,10000,25000,50000")
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--work-dir", default=None)
    ap.add_argument("--json", required=True)
    a = ap.parse_args()
    U = bench.USER_ID
    now_et = datetime(2026, 9, 25, 12, tzinfo=note_tasks.ET)
    out = {"meta": {"argv": sys.argv, "git_head": bench._git("rev-parse", "HEAD"),
                    "git_dirty": bench._git("status", "--porcelain"), "cover_ddl": COVER_DDL},
           "tiers": []}
    for n in [int(x) for x in a.tiers.split(",")]:
        path, truth = dc.build(n, a.work_dir)
        sym = truth["embed_symbol"]
        tier = {"n": n, "rounds": []}
        # the backlinks A/B needs no schema change; the tasks A/B toggles the index per half
        for setting in ("bench", "cache64"):
            conn = dc._open(path, dc.SETTINGS[setting])
            notes_svc.register_note_sql_functions(conn)
            with bench._ticker_meta_stubbed():
                a_bl = notes_svc.get_symbol_backlinks(U, sym, conn=conn)
                b_bl = backlinks_one_pass(conn, U, sym)
                same_bl = (a_bl["count"] == b_bl["count"]
                           and [x["id"] for x in a_bl["notes"]] == [x["id"] for x in b_bl["notes"]]
                           and [(x["refs"], x["widgetIds"]) for x in a_bl["notes"]]
                           == [(x["refs"], x["widgetIds"]) for x in b_bl["notes"]])
                a_tasks = note_tasks.list_tasks(U, status="open", now=now_et, conn=conn)
                for r in range(a.rounds):
                    row = {"setting": setting, "round": r}
                    conn.execute("DROP INDEX IF EXISTS idx_j2_notes_live_tasks_cover")
                    conn.execute("CREATE INDEX IF NOT EXISTS idx_j2_notes_live_tasks ON j2_notes"
                                 "(user_id, deleted_at, archived_at, updated_at DESC)"
                                 " WHERE instr(body_json, 'taskItem') > 0")
                    conn.commit()
                    st, _ = bench._measure(lambda: note_tasks.list_tasks(U, status="open", now=now_et, conn=conn), 2, 20)
                    row["tasks A"] = st["p50_ms"]
                    conn.execute("DROP INDEX IF EXISTS idx_j2_notes_live_tasks")
                    conn.execute(COVER_DDL)
                    conn.commit()
                    st, b_tasks = bench._measure(lambda: note_tasks.list_tasks(U, status="open", now=now_et, conn=conn), 2, 20)
                    row["tasks B"] = st["p50_ms"]
                    row["tasks B same answer"] = b_tasks == a_tasks
                    st, _ = bench._measure(lambda: notes_svc.get_symbol_backlinks(U, sym, conn=conn), 2, 20)
                    row["backlinks A"] = st["p50_ms"]
                    st, _ = bench._measure(lambda: backlinks_one_pass(conn, U, sym), 2, 20)
                    row["backlinks B"] = st["p50_ms"]
                    row["backlinks B same answer"] = same_bl
                    tier["rounds"].append(row)
                    print(n, row, flush=True)
                if setting == "bench":
                    live = note_tasks._live_clause(conn, "n")
                    q = ("SELECT n.id, n.title, n.updated_at, d.tasks_json,"
                         " CASE WHEN d.note_id IS NULL THEN n.body_json END AS body_json"
                         " FROM j2_notes n LEFT JOIN j2_note_task_digest d ON d.note_id = n.id"
                         " WHERE n.user_id = ?" + live +
                         " AND instr(n.body_json, 'taskItem') > 0 ORDER BY n.updated_at DESC")
                    tier["tasks B plan"] = [r[3] for r in conn.execute("EXPLAIN QUERY PLAN " + q, (U,))]
                    ids_sql, ids_params = notes_svc._symbol_note_ids_sql(U, [sym])
                    q2 = ("SELECT n.id, n.title, n.updated_at, COUNT(*) OVER () AS total"
                          f" FROM ({ids_sql}) x CROSS JOIN j2_notes n ON n.id = x.note_id"
                          " WHERE n.user_id = ? AND n.deleted_at IS NULL ORDER BY n.updated_at DESC LIMIT ?")
                    tier["backlinks B plan"] = [r[3] for r in conn.execute(
                        "EXPLAIN QUERY PLAN " + q2, (*ids_params, U, 5))]
            conn.close()
        out["tiers"].append(tier)
        for suf in ("", "-wal", "-shm"):
            try:
                os.remove(path + suf)
            except OSError:
                pass
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(out, f, indent=1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
