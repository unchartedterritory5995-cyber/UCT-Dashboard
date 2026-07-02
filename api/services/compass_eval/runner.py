"""Report-card runner: replay golden questions through Compass text chat,
apply mechanical checks + the AI judge, store scores.

v1 grades the CHAT surface (the true multi-tool loop, driven through the
real `coach_chat.handle_user_turn` generator). Voice single-shot grading
via `voice_intent.run_oneshot` is a planned v1.1.

Adaptations vs. the original task sketch (reality checked against the real
`coach_chat.py` + `test_coach_chat.py` before writing this):

  - Event field names (`token.text`, `tool_call.name`/`args`) matched the
    sketch as-is — `handle_user_turn` really does yield those keys.
  - `tool_call` events carry NO Anthropic tool_use id and NO `result` (the
    executor's return value is never echoed back on the event stream) —
    only `name` + `args` + a pre-summarized `summary` string. Tool results
    are read back from the persisted `role='tool'` rows in
    `j2_chat_messages`, whose result payload lives in the `tool_results`
    column (JSON list of `{tool_call_id, result}`) — NOT `content` (a
    sketch guess that doesn't exist for that role). Rows are scoped to
    this question's own turn via a `created_at >= turn_start` filter
    captured just before driving the generator (the row PK is a UUID, so
    `ORDER BY id` is NOT chronological — a bug in the original sketch).
    Because the generator's `tool_call` events don't carry an id, results
    are paired to fired calls *positionally* in creation order (both the
    event stream and the persisted rows are produced in the same relative
    order within one turn, so this is safe). If this enrichment ever comes
    up empty/misaligned it silently leaves `result: {}` on the affected
    call — the mechanical price-sourcing check then leans on tool *names*
    only, which is an accepted v1 limitation (see checks.py's
    `_tool_sourced`).
  - `j2_trades` INSERT column list mirrors `test_coach_chat.py`'s
    `_insert_trade` exactly. The real schema has several NOT NULL columns
    the original sketch's guessed column list omitted entirely
    (`position_id`, `side`, `shares`, `original_stop`, `pnl_dollar`,
    `pnl_percent`, `hold_days`, `result`, `context_at_entry`,
    `created_at`) plus a `side IN ('Long','Short')` / `result IN
    ('Win','Loss','BE')` CHECK constraint.
  - `accounts.get_or_migrate_default_account` returns a dict (confirmed
    against `api/services/journal_two/accounts.py`) — `acct["id"]` is used
    directly.
"""
from __future__ import annotations

import json
import os
import subprocess
import time
import uuid
from datetime import datetime, timezone


def _git_sha() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=5,
        ).stdout.strip()
    except Exception:
        return "unknown"


# 8 deterministic closed trades: 2 HTF wins, 1 HTF loss, 2 bull-flag losses,
# 1 EP win, 2 VCP wins. (symbol, setup, entry, exit, shares, entry_date,
# exit_date, result)
_EVAL_TRADES = [
    ("NVDA", "HTF", 100.0, 112.0, 50, "2026-05-04", "2026-05-11", "Win"),
    ("ANET", "HTF", 80.0, 92.0, 60, "2026-05-06", "2026-05-15", "Win"),
    ("DECK", "HTF", 150.0, 143.0, 30, "2026-05-18", "2026-05-20", "Loss"),
    ("AMD", "Bull Flag", 140.0, 133.0, 40, "2026-05-19", "2026-05-21", "Loss"),
    ("SMCI", "Bull Flag", 40.0, 37.5, 100, "2026-05-26", "2026-05-27", "Loss"),
    ("CRWD", "EP", 300.0, 345.0, 20, "2026-06-04", "2026-06-12", "Win"),
    ("LITE", "VCP", 60.0, 69.0, 80, "2026-06-08", "2026-06-18", "Win"),
    ("FIX", "VCP", 120.0, 131.0, 40, "2026-06-15", "2026-06-24", "Win"),
]


def _seed_eval_trades(conn, user_id: str, account_id: str) -> None:
    """Deterministic journal fixture so journal-grounded questions (P&L,
    setup win-rate, etc.) have stable ground truth. Column list mirrors
    test_coach_chat.py's `_insert_trade` exactly (see module docstring)."""
    now_iso = datetime.now(timezone.utc).isoformat()
    for sym, setup, entry, exit_, shares, opened, closed, result in _EVAL_TRADES:
        pnl_dollar = round((exit_ - entry) * shares, 2)
        pnl_percent = round((exit_ - entry) / entry * 100, 2)
        opened_dt = datetime.fromisoformat(opened)
        closed_dt = datetime.fromisoformat(closed)
        hold_days = max(1, (closed_dt - opened_dt).days)
        original_stop = round(entry * 0.93, 2)
        conn.execute(
            """INSERT INTO j2_trades (
                id, user_id, position_id, symbol, side, shares,
                entry_price, entry_date, exit_price, exit_date,
                original_stop, setup, notes, pnl_dollar, pnl_percent,
                r_multiple, hold_days, result, context_at_entry,
                created_at, account_id, mistake_tags, emotion_tags, fees, regime
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (str(uuid.uuid4()), user_id, str(uuid.uuid4()),
             sym, "Long", shares,
             entry, opened + "T14:30:00Z", exit_, closed + "T20:00:00Z",
             original_stop, setup, None,
             pnl_dollar, pnl_percent, None, hold_days, result, "{}",
             now_iso, account_id, "[]", "[]", 0, None),
        )
    conn.commit()


def _enrich_fired_results(conn, *, user_id: str, account_id: str,
                          turn_start: str, fired: list[dict]) -> None:
    """Best-effort: fill fired[i]['result'] from the persisted tool_results
    rows for this turn. See module docstring for the reliability caveat —
    any failure here just leaves results as {} and is swallowed."""
    if not fired:
        return
    try:
        rows = conn.execute(
            "SELECT tool_results FROM j2_chat_messages"
            " WHERE user_id = ? AND account_id = ? AND role = 'tool'"
            " AND created_at >= ? ORDER BY created_at ASC",
            (user_id, account_id, turn_start),
        ).fetchall()
        flattened: list = []
        for r in rows:
            raw = r[0]
            if not raw:
                continue
            try:
                entries = json.loads(raw)
            except (TypeError, ValueError):
                continue
            for e in entries:
                flattened.append(e.get("result") if isinstance(e, dict) else {})
        # Positional pairing: take the trailing len(fired) results (both
        # lists are produced in the same relative order within this turn).
        tail = flattened[-len(fired):] if len(flattened) >= len(fired) else flattened
        offset = len(fired) - len(tail)
        for i, res in enumerate(tail):
            fired[offset + i]["result"] = res if isinstance(res, dict) else {}
    except Exception:
        pass


def run_exam(
    *,
    chat_client_factory=None,
    judge_client=None,
    question_ids=None,
    rungs=None,
    conn=None,
    user_id: str = "__eval__",
    account_id: str | None = None,
    run_id: str | None = None,
    notes: str = "",
) -> dict:
    """Replay the golden set through the real Compass chat loop, grade with
    mechanical checks + the AI judge, persist scores.

    Returns {"run_id", "summary": store.run_summary(...), "failed": [qids],
    "safety_breaks": int}.
    """
    from api.services import auth_db
    from api.services.compass_eval import checks, golden_set, judge, store
    from api.services.journal_two import accounts, coach_chat

    store.init_db()
    run_id = run_id or f"rc-{int(time.time())}-{uuid.uuid4().hex[:6]}"
    own_conn = conn is None
    if own_conn:
        auth_db.init_db()
        conn = auth_db.get_connection()
    try:
        if account_id is None:
            acct = accounts.get_or_migrate_default_account(user_id, conn=conn)
            account_id = acct["id"]
            _seed_eval_trades(conn, user_id, account_id)

        questions = golden_set.load_golden_set()
        if question_ids:
            wanted_ids = set(question_ids)
            questions = [q for q in questions if q["id"] in wanted_ids]
        if rungs:
            wanted_rungs = set(rungs)
            questions = [q for q in questions if q["rung"] in wanted_rungs]

        if judge_client is None:
            import anthropic
            judge_client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        if chat_client_factory is None:
            real_client = coach_chat.AnthropicChatClient()
            chat_client_factory = lambda: real_client  # noqa: E731

        store.record_run(
            run_id, git_sha=_git_sha(), mode="chat",
            model=coach_chat.AnthropicChatClient.DEFAULT_MODEL, notes=notes,
        )

        failed: list[str] = []
        safety_breaks = 0
        for q in questions:
            turn_start = datetime.now(timezone.utc).isoformat()
            answer_parts: list[str] = []
            fired: list[dict] = []
            client = chat_client_factory()
            for ev in coach_chat.handle_user_turn(
                    user_id=user_id, account_id=account_id,
                    user_message=q["question"], client=client, conn=conn):
                etype = ev.get("type")
                if etype == "token":
                    answer_parts.append(ev.get("text", "") or "")
                elif etype == "tool_call":
                    fired.append({
                        "name": ev.get("name"),
                        "args": ev.get("args") or {},
                        "result": {},
                    })
                # tool_call_pending / complete / error are consumed silently.
                # Every golden-set tool name checked against coach_chat_tools.TOOLS
                # is requires_confirm=False (read-only), so tool_call_pending
                # shouldn't occur in practice; if a confirm-gated tool ever
                # fires, this v1 runner doesn't auto-confirm it, so that
                # question would land at 0 fired tools (tool-gate fail) —
                # acceptable for a read-only exam surface.
            answer = "".join(answer_parts)

            _enrich_fired_results(
                conn, user_id=user_id, account_id=account_id,
                turn_start=turn_start, fired=fired,
            )

            transcript = {"answer": answer, "fired_tools": fired, "question": q}
            mech = checks.run_mechanical_checks(transcript)
            axes = judge.judge_answer(transcript, client=judge_client)
            usage = axes.pop("_usage", {"in_tok": 0, "out_tok": 0})
            store.record_cost(
                run_id, judge.JUDGE_MODEL, usage["in_tok"], usage["out_tok"],
                usage["in_tok"] / 1e6 * 1.0 + usage["out_tok"] / 1e6 * 5.0,
            )
            passed = judge.question_passed(
                q["rung"], axes, mech["auto_fails"], mech["tool_gate_pass"],
            )
            if mech["auto_fails"]:
                safety_breaks += 1
            if not passed:
                failed.append(q["id"])
            store.record_score(
                run_id, q["id"], q["rung"], axes, mech["auto_fails"],
                mech["tool_gate_pass"], passed, answer, axes.get("rationale", ""),
            )

        return {
            "run_id": run_id,
            "summary": store.run_summary(run_id),
            "failed": failed,
            "safety_breaks": safety_breaks,
        }
    finally:
        if own_conn:
            conn.close()
