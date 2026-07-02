"""Score persistence for report-card runs (trend line + deploy gate)."""
from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone


def _path() -> str:
    return os.environ.get(
        "COMPASS_EVAL_DB",
        os.path.join(os.environ.get("DATA_DIR", "data"), "compass_eval.db"),
    )


def connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(_path()) or ".", exist_ok=True)
    c = sqlite3.connect(_path())
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c


def init_db() -> None:
    c = connect()
    c.execute("""CREATE TABLE IF NOT EXISTS eval_runs (
        run_id TEXT PRIMARY KEY, started_at TEXT, git_sha TEXT,
        mode TEXT, model TEXT, notes TEXT)""")
    c.execute("""CREATE TABLE IF NOT EXISTS eval_scores (
        run_id TEXT, question_id TEXT, rung INTEGER,
        correctness INTEGER, grounding INTEGER, opinion INTEGER, safety INTEGER,
        auto_fails TEXT, tool_gate_pass INTEGER, passed INTEGER,
        answer TEXT, rationale TEXT, PRIMARY KEY (run_id, question_id))""")
    c.execute("""CREATE TABLE IF NOT EXISTS eval_cost (
        run_id TEXT, model TEXT, in_tok INTEGER, out_tok INTEGER, cost_usd REAL)""")
    c.commit()
    c.close()


def record_run(run_id: str, *, git_sha: str, mode: str, model: str, notes: str = "") -> None:
    c = connect()
    c.execute("INSERT OR REPLACE INTO eval_runs VALUES (?,?,?,?,?,?)",
              (run_id, datetime.now(timezone.utc).isoformat(), git_sha, mode, model, notes))
    c.commit()
    c.close()


def record_score(run_id, question_id, rung, axes, auto_fails, tool_gate_pass,
                 passed, answer, rationale) -> None:
    c = connect()
    c.execute("INSERT OR REPLACE INTO eval_scores VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
              (run_id, question_id, int(rung),
               int(axes.get("correctness", 0)), int(axes.get("grounding", 0)),
               int(axes.get("opinion", 0)), int(axes.get("safety", 0)),
               json.dumps(list(auto_fails)), int(bool(tool_gate_pass)),
               int(bool(passed)), answer[:4000], rationale[:1000]))
    c.commit()
    c.close()


def record_cost(run_id, model, in_tok, out_tok, cost_usd) -> None:
    c = connect()
    c.execute("INSERT INTO eval_cost VALUES (?,?,?,?,?)",
              (run_id, model, int(in_tok), int(out_tok), float(cost_usd)))
    c.commit()
    c.close()


def run_summary(run_id: str) -> dict:
    c = connect()
    rows = c.execute("SELECT rung, COUNT(*) AS q, SUM(passed) AS p,"
                     " SUM(CASE WHEN auto_fails != '[]' THEN 1 ELSE 0 END) AS breaks"
                     " FROM eval_scores WHERE run_id = ? GROUP BY rung", (run_id,)).fetchall()
    c.close()
    out: dict = {"safety_breaks": 0}
    for r in rows:
        out[int(r["rung"])] = {"questions": int(r["q"]), "passed": int(r["p"] or 0)}
        out["safety_breaks"] += int(r["breaks"] or 0)
    return out


def latest_runs(limit: int = 10) -> list[dict]:
    c = connect()
    rows = c.execute("SELECT * FROM eval_runs ORDER BY started_at DESC LIMIT ?",
                     (int(limit),)).fetchall()
    c.close()
    return [dict(r) for r in rows]
