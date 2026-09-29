"""Lane PC diagnosis: where list_tasks and get_symbol_backlinks spend their time, per tier.
EVIDENCE TOOLING. For each tier (the benchmark's own seed), on the benchmark's connection shape
(defaults) and on cache_size = 64 MiB, times separately (p50 of 20 after 2 warm-ups):
  list_tasks:  the SQL fetch alone; json.loads of every tasks_json; the whole call; the whole
               call with gc disabled (a Python GC cost that grows with the heap would show here)
  backlinks:   the COUNT query alone; the page query alone; the whole call
and counts the rows each reads (task notes, open tasks, backlink hits).
Usage: python diag_split.py --tiers 1000,...,50000 --json out.json [--work-dir DIR]"""
from __future__ import annotations

import argparse
import gc
import json
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import diag_curve as dc  # noqa: E402  (repo on sys.path, conftest imported, via the benchmark)

bench, notes_svc, note_tasks = dc.bench, dc.notes_svc, dc.note_tasks


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tiers", default="1000,5000,10000,25000,50000")
    ap.add_argument("--work-dir", default=None)
    ap.add_argument("--json", required=True)
    a = ap.parse_args()
    U = bench.USER_ID
    now_et = datetime(2026, 9, 25, 12, tzinfo=note_tasks.ET)
    out = {"meta": {"argv": sys.argv, "git_head": bench._git("rev-parse", "HEAD"),
                    "git_dirty": bench._git("status", "--porcelain")}, "tiers": []}
    for n in [int(x) for x in a.tiers.split(",")]:
        path, truth = dc.build(n, a.work_dir)
        tier = {"n": n, "settings": {}}
        for setting in ("bench", "cache64"):
            conn = dc._open(path, dc.SETTINGS[setting])
            live = note_tasks._live_clause(conn, "n")
            tasks_sql = ("SELECT n.id, n.title, n.updated_at, d.tasks_json,"
                         " CASE WHEN d.note_id IS NULL THEN n.body_json END AS body_json"
                         " FROM j2_notes n LEFT JOIN j2_note_task_digest d ON d.note_id = n.id"
                         " WHERE n.user_id = ?" + live +
                         " AND instr(n.body_json, 'taskItem') > 0 ORDER BY n.updated_at DESC")
            rows = conn.execute(tasks_sql, (U,)).fetchall()
            blobs = [r["tasks_json"] for r in rows if r["tasks_json"] is not None]
            ids_sql, ids_params = notes_svc._symbol_note_ids_sql(U, [truth["embed_symbol"]])
            count_sql = (f"SELECT COUNT(*) AS c FROM ({ids_sql}) x CROSS JOIN j2_notes n ON n.id = x.note_id"
                         " WHERE n.user_id = ? AND n.deleted_at IS NULL")
            page_sql = ("SELECT n.id, n.title, n.updated_at, COALESCE(e.refs, 0) AS refs, e.widgets AS widgets"
                        f" FROM ({ids_sql}) x CROSS JOIN j2_notes n ON n.id = x.note_id"
                        " LEFT JOIN (SELECT note_id, COUNT(*) AS refs, GROUP_CONCAT(DISTINCT widget_id) AS widgets"
                        "  FROM j2_note_embeds WHERE user_id = ? AND symbol = ? GROUP BY note_id) e ON e.note_id = n.id"
                        " WHERE n.user_id = ? AND n.deleted_at IS NULL ORDER BY n.updated_at DESC LIMIT 5")
            sym = truth["embed_symbol"]
            ids_sql_only = f"SELECT count(*) FROM ({ids_sql})"

            def nogc(fn):
                def run():
                    gc.disable()
                    try:
                        return fn()
                    finally:
                        gc.enable()
                return run
            full_tasks = lambda: note_tasks.list_tasks(U, status="open", now=now_et, conn=conn)  # noqa: E731
            parts = {
                "tasks: SQL fetch": lambda: conn.execute(tasks_sql, (U,)).fetchall(),
                "tasks: json.loads of every digest row": lambda: [json.loads(b) for b in blobs],
                "tasks: whole call": full_tasks,
                "tasks: whole call, gc disabled": nogc(full_tasks),
                "backlinks: id set alone": lambda: conn.execute(ids_sql_only, ids_params).fetchone(),
                "backlinks: COUNT query": lambda: conn.execute(count_sql, (*ids_params, U)).fetchone(),
                "backlinks: page query": lambda: conn.execute(page_sql, (*ids_params, U, sym, U)).fetchall(),
            }
            res = {}
            with bench._ticker_meta_stubbed():
                parts["backlinks: whole call"] = lambda: notes_svc.get_symbol_backlinks(U, sym, conn=conn)
                for label, fn in parts.items():
                    st, _ = bench._measure(fn, 2, 20)
                    res[label] = st["p50_ms"]
            res["rows: task notes"] = len(rows)
            res["rows: digest rows"] = len(blobs)
            res["rows: open tasks"] = truth["open_tasks"]
            res["rows: backlink hits"] = truth["backlink_notes"]
            conn.close()
            tier["settings"][setting] = res
            print(n, setting, res, flush=True)
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
