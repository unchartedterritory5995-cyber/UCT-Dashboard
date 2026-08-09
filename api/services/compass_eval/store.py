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
        answer TEXT, rationale TEXT, judge_error TEXT,
        PRIMARY KEY (run_id, question_id))""")
    c.execute("""CREATE TABLE IF NOT EXISTS eval_cost (
        run_id TEXT, model TEXT, in_tok INTEGER, out_tok INTEGER, cost_usd REAL)""")
    # Trend stores predate `judge_error`; without this the first run against an
    # existing db would raise and the operator would read it as a Compass fault.
    cols = {r[1] for r in c.execute("PRAGMA table_info(eval_scores)")}
    if "judge_error" not in cols:
        c.execute("ALTER TABLE eval_scores ADD COLUMN judge_error TEXT")
    c.commit()
    c.close()


def record_run(run_id: str, *, git_sha: str, mode: str, model: str, notes: str = "") -> None:
    c = connect()
    c.execute("INSERT OR REPLACE INTO eval_runs VALUES (?,?,?,?,?,?)",
              (run_id, datetime.now(timezone.utc).isoformat(), git_sha, mode, model, notes))
    c.commit()
    c.close()


def record_score(run_id, question_id, rung, axes, auto_fails, tool_gate_pass,
                 passed, answer, rationale, judge_error=None) -> None:
    """One graded (or UNGRADED) question.

    ⛔ An axis the judge did not state is written NULL, never 0 — see
    `judge.judged`. Columns are named explicitly rather than positional so the
    schema can grow without a silent column-order shear.
    """
    def _axis(k):
        v = axes.get(k)
        return None if v is None else int(v)

    c = connect()
    c.execute(
        "INSERT OR REPLACE INTO eval_scores (run_id, question_id, rung,"
        " correctness, grounding, opinion, safety, auto_fails, tool_gate_pass,"
        " passed, answer, rationale, judge_error)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (run_id, question_id, int(rung),
         _axis("correctness"), _axis("grounding"), _axis("opinion"), _axis("safety"),
         json.dumps(list(auto_fails)), int(bool(tool_gate_pass)),
         int(bool(passed)), (answer or "")[:4000], (rationale or "")[:1000],
         judge_error))
    c.commit()
    c.close()


def record_cost(run_id, model, in_tok, out_tok, cost_usd) -> None:
    c = connect()
    c.execute("INSERT INTO eval_cost VALUES (?,?,?,?,?)",
              (run_id, model, int(in_tok), int(out_tok), float(cost_usd)))
    c.commit()
    c.close()


def run_summary(run_id: str) -> dict:
    """Per-rung {questions, passed, ungraded} + run-level safety_breaks/ungraded.

    ⛔ `questions` counts only the questions the judge actually GRADED. An
    ungraded one is reported separately and left out of the denominator, so the
    rung bar scales down (`golden_set.required_passes`) exactly as it does for a
    partial `--rungs` run. Counting an unread paper as a question the model
    failed is the D-22 defect; counting it as one it passed would be worse.

    `safety_breaks` is counted over EVERY row, graded or not — the mechanical
    checks are regex-based and never depend on the judge.
    """
    c = connect()
    rows = c.execute(
        "SELECT rung,"
        " SUM(CASE WHEN judge_error IS NULL THEN 1 ELSE 0 END) AS graded,"
        " SUM(CASE WHEN judge_error IS NOT NULL THEN 1 ELSE 0 END) AS ungraded,"
        " SUM(CASE WHEN judge_error IS NULL THEN passed ELSE 0 END) AS p,"
        " SUM(CASE WHEN auto_fails != '[]' THEN 1 ELSE 0 END) AS breaks"
        " FROM eval_scores WHERE run_id = ? GROUP BY rung", (run_id,)).fetchall()
    c.close()
    out: dict = {"safety_breaks": 0, "ungraded": 0}
    for r in rows:
        out[int(r["rung"])] = {"questions": int(r["graded"] or 0),
                               "passed": int(r["p"] or 0),
                               "ungraded": int(r["ungraded"] or 0)}
        out["safety_breaks"] += int(r["breaks"] or 0)
        out["ungraded"] += int(r["ungraded"] or 0)
    return out


def latest_runs(limit: int = 10) -> list[dict]:
    c = connect()
    rows = c.execute("SELECT * FROM eval_runs ORDER BY started_at DESC LIMIT ?",
                     (int(limit),)).fetchall()
    c.close()
    return [dict(r) for r in rows]
