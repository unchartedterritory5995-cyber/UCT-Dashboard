"""Lane PC (wave 10, clause 14d) -- the curve diagnosis. EVIDENCE TOOLING, not product code.

For the ops the controller's curve named (count_notes, folder_note_counts, get_symbol_backlinks,
list_tasks, plus tag_counts), at each tier:
  1. seeds a library with the benchmark's OWN seed (tools/notebook_scale_benchmark._seed + the
     task-digest backfill), on the real schema;
  2. records every SQL statement each op runs (trace callback) and its EXPLAIN QUERY PLAN;
  3. times each op with the benchmark's own `_measure` (same warmup / reps) under several
     connection settings, ONE variable at a time:
       bench      -- the benchmark's connection: sqlite3.connect + WAL, defaults (cache 2,000 KiB)
       cache64    -- the same connection with PRAGMA cache_size = -65536 (64 MiB)
       cache256   -- PRAGMA cache_size = -262144 (256 MiB)
       mmap512    -- PRAGMA mmap_size = 512 MiB, default cache
       percall    -- production's shape: a FRESH connection per call (auth_db.get_connection
                     opens one per request: timeout=3, Row, WAL, foreign_keys=ON), defaults
  4. records the file's page_size / page_count and the j2_notes index names (this SQLite has
     no dbstat, so per-index page counts are not read).

Writes one JSON per invocation. Usage:
    python diag_curve.py --tiers 25000,50000 --json out.json [--work-dir DIR] [--settings bench,cache64]
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

_REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(_REPO))

from tools import notebook_scale_benchmark as bench  # noqa: E402  (imports conftest first)
from api.services.journal_two import db as j2db  # noqa: E402
from api.services.journal_two import note_tasks  # noqa: E402
from api.services.journal_two import notes as notes_svc  # noqa: E402

OPS = [
    "count_notes (whole library)",
    "folder_note_counts (whole library)",
    "get_symbol_backlinks",
    "list_tasks (open, ?view=tasks)",
    "tag_counts (whole library)",
]
SETTINGS = {
    "bench": [],
    "cache64": ["PRAGMA cache_size = -65536"],
    "cache256": ["PRAGMA cache_size = -262144"],
    "mmap512": ["PRAGMA mmap_size = 536870912"],
    "percall": None,   # fresh connection per call, production's shape
}


def _open(path: str, pragmas: list[str]) -> sqlite3.Connection:
    c = sqlite3.connect(path)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    for p in pragmas:
        c.execute(p)
    return c


def _ops_for(conn_get, U: str, sym: str, now_et):
    """Each op takes a connection from `conn_get()` (the same one, or a fresh one)."""
    def wrap(f):
        def run():
            c, close = conn_get()
            try:
                return f(c)
            finally:
                if close:
                    c.close()
        return run
    return {
        "count_notes (whole library)": wrap(lambda c: notes_svc.count_notes(U, conn=c)),
        "folder_note_counts (whole library)": wrap(lambda c: notes_svc.folder_note_counts(U, conn=c)),
        "get_symbol_backlinks": wrap(lambda c: notes_svc.get_symbol_backlinks(U, sym, conn=c)),
        "list_tasks (open, ?view=tasks)": wrap(lambda c: note_tasks.list_tasks(U, status="open", now=now_et, conn=c)),
        "tag_counts (whole library)": wrap(lambda c: notes_svc.tag_counts(U, conn=c)),
    }


def build(n: int, work_dir: str) -> tuple[str, dict]:
    d = tempfile.mkdtemp(prefix=f"pc_{n}_", dir=work_dir)
    path = os.path.join(d, "bench.db")
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    j2db.ensure_schema(conn)
    heavy = notes_svc.create_folder(bench.USER_ID, "Catch-All", conn=conn)
    others = [notes_svc.create_folder(bench.USER_ID, f"Folder {i}", conn=conn)["id"] for i in range(8)]
    truth = bench._seed(conn, n, heavy["id"], others, 5)
    j2db.backfill_note_task_digest(conn)
    conn.commit()
    conn.close()
    return path, truth


def plans(path: str, U: str, sym: str, now_et) -> dict:
    conn = _open(path, [])
    out: dict[str, list] = {}
    try:
        with bench._ticker_meta_stubbed():
            for label, fn in _ops_for(lambda: (conn, False), U, sym, now_et).items():
                stmts: list[str] = []
                conn.set_trace_callback(stmts.append)
                fn()
                conn.set_trace_callback(None)
                rows = []
                for s in stmts:
                    head = s.lstrip().split(None, 1)[0].upper() if s.strip() else ""
                    if head not in ("SELECT", "WITH"):
                        rows.append({"sql": s[:400], "plan": "(not a SELECT)"})
                        continue
                    try:
                        plan = [f"{r[0]}|{r[1]}|{r[3]}" for r in conn.execute("EXPLAIN QUERY PLAN " + s)]
                    except sqlite3.Error as e:
                        plan = [f"(EQP failed: {e})"]
                    rows.append({"sql": s[:600], "plan": plan})
                out[label] = rows
    finally:
        conn.close()
    return out


def sizes(path: str) -> dict:
    conn = sqlite3.connect(path)
    try:
        ps = conn.execute("PRAGMA page_size").fetchone()[0]
        pc = conn.execute("PRAGMA page_count").fetchone()[0]
        idx = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='j2_notes'")]
        return {"page_size": ps, "page_count": pc, "db_mb": round(ps * pc / 1e6, 1),
                "j2_notes_indexes": idx, "file_bytes": os.path.getsize(path)}
    finally:
        conn.close()


def time_ops(path: str, U: str, sym: str, now_et, setting: str, warmup: int, reps: int) -> dict:
    pragmas = SETTINGS[setting]
    shared = None
    if pragmas is None:
        from api.services import auth_db

        def get():
            prior = auth_db._DB_PATH
            auth_db._DB_PATH = path
            try:
                return auth_db.get_connection(), True
            finally:
                auth_db._DB_PATH = prior
    else:
        shared = _open(path, pragmas)

        def get():
            return shared, False
    res = {}
    try:
        with bench._ticker_meta_stubbed():
            for label, fn in _ops_for(get, U, sym, now_et).items():
                st, _ = bench._measure(fn, warmup, reps)
                res[label] = st
    finally:
        if shared is not None:
            shared.close()
    return res


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tiers", default="25000,50000")
    ap.add_argument("--settings", default="bench,cache64,cache256,mmap512,percall")
    ap.add_argument("--warmup", type=int, default=2)
    ap.add_argument("--reps", type=int, default=20)
    ap.add_argument("--rounds", type=int, default=1, help="repeat the whole settings sweep this many times")
    ap.add_argument("--work-dir", default=None)
    ap.add_argument("--json", required=True)
    ap.add_argument("--no-plans", action="store_true")
    a = ap.parse_args()
    U = bench.USER_ID
    now_et = datetime(2026, 9, 25, 12, tzinfo=note_tasks.ET)
    report = {"meta": {"argv": sys.argv, "started_at": datetime.now().isoformat(timespec="seconds"),
                       "git_head": bench._git("rev-parse", "HEAD"),
                       "git_dirty": bench._git("status", "--porcelain"),
                       "sqlite": sqlite3.sqlite_version}, "tiers": []}
    for n in [int(x) for x in a.tiers.split(",")]:
        t0 = time.perf_counter()
        path, truth = build(n, a.work_dir)
        tier = {"n": n, "build_s": round(time.perf_counter() - t0, 1), "sizes": sizes(path),
                "truth": {k: truth[k] for k in ("active", "open_tasks", "backlink_notes")}}
        sym = truth["embed_symbol"]
        if not a.no_plans:
            tier["plans"] = plans(path, U, sym, now_et)
        tier["timings"] = []
        for r in range(a.rounds):
            for s in a.settings.split(","):
                tier["timings"].append({"round": r, "setting": s,
                                        "ops": time_ops(path, U, sym, now_et, s, a.warmup, a.reps)})
                print(n, r, s, {k: v["p50_ms"] for k, v in tier["timings"][-1]["ops"].items()}, flush=True)
        report["tiers"].append(tier)
        for suf in ("", "-wal", "-shm"):
            try:
                os.remove(path + suf)
            except OSError:
                pass
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
