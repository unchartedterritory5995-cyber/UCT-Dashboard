"""Compass personal-edge substrate — the trader's OWN per-setup expectancy.

Distinct from the firm-level brain_service.setup_winrate: this is what THIS
user is good/bad at, from their journal (coach_data_assembler setup_performance),
normalized onto the canonical setup taxonomy so "you're 4-11 on bull flags"
joins to the right playbook template. SOFT by design (see edge_for_setups):
never hard-mutes on a thin sample, never silent-hides, always honors
"show me anyway". Edge is expectancy (avg_r), NOT raw win-count."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

_log = logging.getLogger("personal_edge")

_MUTE_MIN_N = 25


def _resolve(name: str) -> str | None:
    """Engine alias resolver (journal display name -> canonical key)."""
    try:
        from api.services import brain_service
        uct = brain_service._engine()  # installed engine or None
        if uct is None:
            return None
        return uct.resolve_setup_name(name)
    except Exception:  # noqa: BLE001
        return None


def normalize_setup(name: str) -> str | None:
    if not name:
        return None
    try:
        return _resolve(name)
    except Exception:  # noqa: BLE001
        return None


#: Ceiling on the trades one edge read aggregates (the most recent N in scope). One uvicorn
#: process serves every member, so the read is bounded in SQL, never "all history".
CLOSED_TRADES_MAX = 5000
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def closed_trades(user_id, account_id=None, *, limit=None) -> list[dict]:
    """The member's most recent `limit` (default CLOSED_TRADES_MAX) closed trades in scope, oldest
    first. `account_id` None means the member's whole Compass scope (UNIFIED_ACCOUNT_ID: every
    account with compass_enabled = 1); any other value goes through resolve_account_scope as is.

    The rows are coach_data_assembler._trades_in_range's, so the per-setup aggregate is the one the
    coach uses; only the window differs: it starts at the exit of the limit-th most recent trade,
    so the read is bounded in SQL, then sliced to exactly the bound. Read-only: SELECTs on a
    connection this closes."""
    from api.services import auth_db
    from api.services.journal_two import coach_data_assembler
    from api.services.journal_two.coach_scope import resolve_account_scope
    from api.services.journal_two.unified_coach import UNIFIED_ACCOUNT_ID
    limit = CLOSED_TRADES_MAX if limit is None else int(limit)
    scope = UNIFIED_ACCOUNT_ID if account_id is None else account_id
    conn = auth_db.get_connection()
    try:
        ids = resolve_account_scope(conn, user_id, scope)
        if not ids or limit <= 0:
            return []
        marks = ",".join("?" * len(ids))
        row = conn.execute(
            f"SELECT exit_date FROM j2_trades WHERE user_id = ? AND account_id IN ({marks})"
            " AND (analytics_excluded IS NULL OR analytics_excluded = 0)"
            " ORDER BY exit_date DESC LIMIT 1 OFFSET ?",
            [user_id, *ids, limit - 1]).fetchone()
        start = _EPOCH
        if row and row[0]:
            try:
                start = datetime.fromisoformat(str(row[0]).replace("Z", "+00:00"))
            except ValueError:
                start = _EPOCH
            if start.tzinfo is None:
                start = start.replace(tzinfo=timezone.utc)
            start -= timedelta(days=1)       # inclusive of the boundary day; the slice below is exact
        end = datetime.now(timezone.utc) + timedelta(days=1)
        trades = coach_data_assembler._trades_in_range(conn, user_id, scope, start, end)
    finally:
        conn.close()
    return trades[-limit:]


def _default_setup_perf_fn(user_id, account_id):
    """Per-setup performance rows [{key, trade_count, win_rate, avg_r, total_r, ...}] over the
    member's bounded closed-trade history (closed_trades). account None = the whole Compass scope.
    Before 2026-10-23 this asked _exec_get_aggregates with no period (the last 7 days) and passed
    None through to resolve_account_scope (`account_id IN (NULL)`): {} for every member."""
    from api.services.journal_two import coach_chat_tools as cct
    return cct._breakdown_trades(closed_trades(user_id, account_id), "setup")


def edge_for_setups(user_id, account_id=None, *, setup_perf_fn=None, firm_fn=None) -> dict:
    """{canonical_setup: {n, avg_r, total_r, win_rate, verdict, muted, note}}.

    SOFT: muted ONLY when n >= _MUTE_MIN_N AND avg_r < 0; a thin sample
    (1 <= n < 25) is annotated with its uncertainty but NEVER muted/dropped;
    n == 0 falls back to the firm win-rate note. Never raises."""
    setup_perf_fn = setup_perf_fn or _default_setup_perf_fn
    try:
        rows = setup_perf_fn(user_id, account_id) or []
    except Exception:  # noqa: BLE001
        return {}
    edge: dict[str, dict] = {}
    for r in rows:
        raw = r.get("setup") or r.get("key") or ""  # 'key' = _breakdown_trades bucket
        key = normalize_setup(raw) or raw
        if not key or key == "(no setup)":
            continue
        try:
            n = int(r.get("trade_count") or 0)
            avg_r = r.get("avg_r")
            avg_r = float(avg_r) if avg_r is not None else None
        except (TypeError, ValueError):
            continue
        if n == 0 or avg_r is None:
            verdict, muted = "unknown", False
            note = "no personal history — using the firm's win-rate"
        elif n < _MUTE_MIN_N:
            verdict, muted = "thin", False
            note = f"small sample (n={n}, avg {avg_r:+.2f}R) — not conclusive"
        elif avg_r < 0:
            verdict, muted = "weak", True
            note = f"you're net-negative here (n={n}, avg {avg_r:+.2f}R)"
        else:
            verdict, muted = "edge", False
            note = f"you're net-positive here (n={n}, avg {avg_r:+.2f}R)"
        edge[key] = {"n": n, "avg_r": avg_r, "total_r": r.get("total_r"),
                     "win_rate": r.get("win_rate"), "verdict": verdict,
                     "muted": muted, "note": note}
    return edge
