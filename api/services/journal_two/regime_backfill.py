"""Historical backfill of j2_trades.regime from breadth-monitor history.

New MANUAL trades stamp `regime` at entry (trades.py create paths call
`regime_service.get_current_regime`). Broker + historical/CSV imports store
`regime = NULL` by design — stamping today's regime on a historical round-trip
would be wrong. This module fills those legacy NULLs by reclassifying each
historical day's UCT Exposure Rating (0-150) — carried in the breadth snapshot's
metrics as `uct_exposure` — through `regime.classify_regime`, then matching each
trade's day to that per-day regime series.

Runs ONLY via the admin endpoint — never at import or boot (auth.db also serves
logins). Batched commits keep writer locks short under WAL. Idempotent: a re-run
without `force` only touches rows whose regime is still NULL. Days with no
breadth snapshot stay NULL (counted as `skipped_no_day_match`).
"""
from __future__ import annotations

import json
import sqlite3

from api.services import breadth_monitor
from api.services.auth_db import get_connection
from api.services.journal_two import regime as regime_service

# Preferred first; fallbacks cover older/alternate metric shapes. `uct_exposure`
# is the canonical breadth-snapshot key for the 0-150 UCT Exposure Rating.
_SCORE_KEYS = ("uct_exposure", "uct_exposure_rating", "exposure_score")


def _extract_score(*containers) -> float | None:
    """First numeric exposure-score found across the given dict containers."""
    for c in containers:
        if not isinstance(c, dict):
            continue
        for k in _SCORE_KEYS:
            v = c.get(k)
            if v is None:
                continue
            try:
                return float(v)
            except (TypeError, ValueError):
                continue
    return None


def build_regime_by_day(days: int = 1200) -> dict[str, str]:
    """`{ 'YYYY-MM-DD': 'green'|'amber'|'orange'|'red' }` for each breadth day.

    Reads breadth history, extracts each day's exposure score, and reclassifies
    it via `regime.classify_regime`. Defensive about the metrics shape: a
    `get_history` row is normally flat (score at top level), but if a `metrics`
    key is present (dict or JSON string) it is dug into as well. Days with no
    valid score are skipped.
    """
    history = breadth_monitor.get_history(days) or []
    out: dict[str, str] = {}
    for row in history:
        if not isinstance(row, dict):
            continue
        metrics = row.get("metrics")
        if isinstance(metrics, str):
            try:
                metrics = json.loads(metrics)
            except (TypeError, ValueError):
                metrics = None
        metrics = metrics if isinstance(metrics, dict) else None

        day = row.get("date") or (metrics.get("date") if metrics else None)
        if not day:
            continue
        score = _extract_score(row, metrics)
        label = regime_service.classify_regime(score)
        if label is None:
            continue
        out[str(day)[:10]] = label
    return out


def backfill_regime(
    user_id: str | None = None,
    limit: int | None = None,
    force: bool = False,
    conn: sqlite3.Connection | None = None,
    *,
    batch_size: int = 500,
) -> dict:
    """Fill `j2_trades.regime` from the breadth-history regime-by-day map.

    - Builds the day→regime map ONCE.
    - Scans `j2_trades` rows where `regime IS NULL` (or ALL rows when `force`).
    - Each trade's day = `trading_day_et` if present, else `substr(exit_date,1,10)`.
    - A day found in the map → `UPDATE j2_trades SET regime=?`. A day NOT in the
      map is left unchanged (counted as `skipped_no_day_match`).
    - `user_id` scopes to one user; omit for all users. `limit` bounds the scan.
    - Idempotent: without `force`, a re-run only re-scans remaining NULLs.

    Returns `{scanned, updated, skipped_no_day_match}`.
    """
    by_day = build_regime_by_day()

    own = conn is None
    if own:
        conn = get_connection()
    try:
        where: list[str] = []
        params: list = []
        if not force:
            where.append("regime IS NULL")
        if user_id is not None:
            where.append("user_id = ?")
            params.append(user_id)
        where_sql = (" WHERE " + " AND ".join(where)) if where else ""
        limit_sql = ""
        if limit is not None:
            limit_sql = " LIMIT ?"
            params = params + [int(limit)]

        rows = conn.execute(
            f"SELECT id, trading_day_et, exit_date FROM j2_trades{where_sql}{limit_sql}",
            params,
        ).fetchall()

        scanned = len(rows)
        updates: list[tuple[str, str]] = []
        skipped = 0
        for r in rows:
            exit_date = r["exit_date"]
            day = r["trading_day_et"] or (exit_date[:10] if exit_date else None)
            label = by_day.get(day) if day else None
            if label is None:
                skipped += 1
                continue
            updates.append((label, r["id"]))

        updated = 0
        for start in range(0, len(updates), batch_size):
            chunk = updates[start:start + batch_size]
            conn.executemany(
                "UPDATE j2_trades SET regime = ? WHERE id = ?", chunk
            )
            updated += len(chunk)
            conn.commit()  # short writer locks — auth.db also serves logins

        return {
            "scanned": scanned,
            "updated": updated,
            "skipped_no_day_match": skipped,
        }
    finally:
        if own:
            conn.close()
