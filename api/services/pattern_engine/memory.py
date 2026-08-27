"""Storage layer for pattern detections.

Responsibilities:
  - store_detection(d): UPSERT by stable hash of (sym, tf, pattern_id, start_t, end_t)
  - get_active_detections(sym, tf, pattern_ids=None): query for chart overlay
  - get_detection_by_id(id)
  - record_feedback(detection_id, user_id, rating, note=None)
  - track_outcomes(): walks forward bars to resolve open detections
  - recompute_stats(): aggregates outcomes into pattern_stats
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from typing import Optional

from api.services.pattern_engine.pattern_db import get_connection
from api.services.pattern_engine.types import Detection

logger = logging.getLogger(__name__)


_VALID_FEEDBACK_RATINGS = {"great", "good", "miss", "wrong"}

#: One authority for what "active" means, time-wise. Every reader of live
#: detections (chart overlay via the router, voice tools, screener pattern_join)
#: windows on detected_at over 7 days; before 2026-08-26 the per-symbol read had
#: NO window, so a July VCP still rendered on charts as active — statuses never
#: expire once a row is older than track_outcomes' 48h lookback.
ACTIVE_WINDOW_SECS = 7 * 24 * 60 * 60

#: Retention for pattern_detections. Nothing reads past ACTIVE_WINDOW_SECS
#: (scan/join/voice window 7d; track_outcomes looks back 48h; stats aggregate
#: from what remains), so rows past this only grow the file: measured 2026-08-26,
#: prod patterns.db hit 13.57 GB / 1.54M rows in 6 weeks with no prune. With this
#: retention, pattern_stats becomes a ROLLING-window aggregate rather than
#: since-forever — the honest read, and the n_resolved>0 gate downstream already
#: handles thin windows.
PRUNE_RETENTION_DAYS = 10


def _hash_key(sym: str, tf: str, pattern_id: str, start_t: int, end_t: int) -> str:
    """Stable hash for dedup. Identical pattern geometry on same symbol/TF/range
    collapses to one row regardless of how many times the engine fires."""
    raw = f"{sym}|{tf}|{pattern_id}|{start_t}|{end_t}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def store_detection(d: Detection) -> None:
    """UPSERT a detection. New shapes → INSERT. Recurrent same-shape → UPDATE
    last_seen_at + confidence + status (whichever the engine last computed)."""
    hk = _hash_key(d["sym"], d["tf"], d["pattern_id"], d["start_t"], d["end_t"])

    conn = get_connection()
    try:
        conn.execute("""
            INSERT INTO pattern_detections (
              id, sym, tf, pattern_id, category, direction,
              start_t, end_t, confidence,
              quality_json, geometry_json, levels_json, context_json, narrative_json,
              status, detected_at, last_seen_at, hash_key
            ) VALUES (
              ?, ?, ?, ?, ?, ?,
              ?, ?, ?,
              ?, ?, ?, ?, ?,
              ?, ?, ?, ?
            )
            ON CONFLICT(hash_key) DO UPDATE SET
              confidence    = excluded.confidence,
              quality_json  = excluded.quality_json,
              geometry_json = excluded.geometry_json,
              levels_json   = excluded.levels_json,
              context_json  = excluded.context_json,
              narrative_json = excluded.narrative_json,
              status        = excluded.status,
              last_seen_at  = excluded.last_seen_at
        """, (
            d["id"], d["sym"], d["tf"], d["pattern_id"], d["category"], d["direction"],
            d["start_t"], d["end_t"], d["confidence"],
            json.dumps(d["quality_components"]),
            json.dumps(d["geometry"]),
            json.dumps(d["levels"]),
            json.dumps(d["context"]),
            json.dumps(d["narrative"]),
            d["status"], d["detected_at"], d["last_seen_at"], hk,
        ))
        conn.commit()
    finally:
        conn.close()


def _row_to_detection(row) -> dict:
    """Reconstitute a Detection dict from a sqlite row."""
    return {
        "id": row["id"],
        "sym": row["sym"],
        "tf": row["tf"],
        "pattern_id": row["pattern_id"],
        "pattern_name": row["pattern_id"].replace("_", " ").title(),
        "category": row["category"],
        "direction": row["direction"],
        "start_t": row["start_t"],
        "end_t": row["end_t"],
        # pivot_ts not stored in Phase 0 schema; Phase 5 will rehydrate from
        # geometry.anchors if UI animation needs them.
        "pivot_ts": [],
        "geometry": json.loads(row["geometry_json"]),
        "levels": json.loads(row["levels_json"]),
        "context": json.loads(row["context_json"]),
        "confidence": row["confidence"],
        "quality_components": json.loads(row["quality_json"]),
        "narrative": json.loads(row["narrative_json"]),
        "status": row["status"],
        "outcome": None,
        "detected_at": row["detected_at"],
        "last_seen_at": row["last_seen_at"],
    }


def get_active_detections(
    sym: str,
    tf: str,
    pattern_ids: Optional[list[str]] = None,
    min_conf: float = 0.0,
) -> list[dict]:
    """Return recent detections for (sym, tf) with status not in
    ('completed', 'failed', 'expired'), sorted by detected_at desc.

    Windowed to ACTIVE_WINDOW_SECS — an active status alone is not enough,
    because statuses freeze once a row ages past track_outcomes' 48h lookback.
    """
    conn = get_connection()
    try:
        sql = """
            SELECT * FROM pattern_detections
            WHERE sym = ? AND tf = ?
              AND status NOT IN ('completed', 'failed', 'expired')
              AND confidence >= ?
              AND detected_at >= ?
        """
        params: list = [sym.upper(), tf, min_conf,
                        int(time.time()) - ACTIVE_WINDOW_SECS]
        if pattern_ids:
            placeholders = ",".join(["?"] * len(pattern_ids))
            sql += f" AND pattern_id IN ({placeholders})"
            params.extend(pattern_ids)
        sql += " ORDER BY detected_at DESC"

        rows = conn.execute(sql, params).fetchall()
        return [_row_to_detection(r) for r in rows]
    finally:
        conn.close()


def get_detection_by_id(detection_id: str) -> Optional[dict]:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM pattern_detections WHERE id = ?", (detection_id,)
        ).fetchone()
        return _row_to_detection(row) if row else None
    finally:
        conn.close()


def record_feedback(detection_id: str, user_id: str, rating: str, note: Optional[str] = None) -> int:
    """Insert a feedback row. Returns the inserted row's id."""
    if rating not in _VALID_FEEDBACK_RATINGS:
        raise ValueError(f"invalid rating: {rating}. Must be one of {_VALID_FEEDBACK_RATINGS}")

    conn = get_connection()
    try:
        cursor = conn.execute("""
            INSERT INTO pattern_feedback (detection_id, user_id, rating, note, created_at)
            VALUES (?, ?, ?, ?, ?)
        """, (detection_id, user_id, rating, note, int(time.time())))
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()


def prune_old(retention_days: int = PRUNE_RETENTION_DAYS, batch: int = 50_000) -> dict:
    """Delete detections older than the retention window, plus their now-orphaned
    outcome rows. Batched so the WAL stays bounded and writers are never locked
    out for the whole sweep. Returns {"deleted": n, "orphan_outcomes": n}.
    """
    conn = get_connection()
    try:
        cutoff = int(time.time()) - retention_days * 86400
        deleted = 0
        while True:
            cur = conn.execute(
                """
                DELETE FROM pattern_detections WHERE rowid IN (
                    SELECT rowid FROM pattern_detections
                    WHERE detected_at < ? LIMIT ?
                )
                """,
                (cutoff, batch),
            )
            conn.commit()
            if cur.rowcount <= 0:
                break
            deleted += cur.rowcount
        orphans = conn.execute(
            """
            DELETE FROM pattern_outcomes WHERE detection_id NOT IN (
                SELECT id FROM pattern_detections
            )
            """
        )
        conn.commit()
        return {"deleted": deleted, "orphan_outcomes": orphans.rowcount}
    finally:
        conn.close()


def track_outcomes(lookback_hours: int = 48) -> int:
    """Walk forward bars to resolve open detections.

    For each detection with status in ("forming", "ready", "triggered") detected
    within the last lookback_hours:
      1. Fetch bars from bars_sqlite since the detection's end_t
      2. Walk chronologically — check if entry hit, stop hit, target hit
      3. Track MFE / MAE along the way
      4. Update pattern_outcomes
      5. Flip status to completed (target hit) | failed (stop hit) | expired (>30 days)

    Returns the number of detections processed.
    """
    conn = get_connection()
    try:
        cutoff = int(time.time()) - lookback_hours * 3600
        rows = conn.execute("""
            SELECT id, sym, tf, status, levels_json, detected_at, end_t
            FROM pattern_detections
            WHERE status IN ('forming', 'ready', 'triggered')
              AND detected_at >= ?
        """, (cutoff,)).fetchall()
    finally:
        conn.close()

    processed = 0
    for row in rows:
        try:
            outcome = _resolve_outcome(row)
            if outcome:
                _store_outcome(row["id"], outcome)
                _update_status(row["id"], outcome["new_status"])
                processed += 1
        except Exception as e:
            logger.warning("track_outcomes: failed to resolve %s: %s", row["id"], e)

    return processed


def _resolve_outcome(detection_row) -> Optional[dict]:
    """Walk forward bars; return outcome dict if pattern resolved, else None."""
    from api.services import bars_sqlite

    levels = json.loads(detection_row["levels_json"])
    entry = levels.get("entry")
    stop = levels.get("stop")
    target = levels.get("target_primary")

    if entry is None or stop is None or target is None:
        return None  # Structure detector or incomplete levels

    # Fetch bars after the detection's end_t
    # bars_sqlite.get_bars_since returns rows (ts, o, h, l, c, v)
    bars = bars_sqlite.get_bars_since(detection_row["sym"], detection_row["tf"], detection_row["end_t"])
    if not bars:
        return None

    is_long = target > entry

    entry_hit = False
    entry_hit_t = None
    stop_hit = False
    stop_hit_t = None
    target_hit = False
    target_hit_t = None
    mfe = 0.0
    mae = 0.0
    bars_processed = 0

    for bar in bars:
        bars_processed += 1
        t, o, h, l, c, v = bar

        # Has entry triggered yet?
        if not entry_hit:
            if is_long and h >= entry:
                entry_hit = True
                entry_hit_t = t
            elif not is_long and l <= entry:
                entry_hit = True
                entry_hit_t = t

        # Once in trade, track stop / target / MFE / MAE
        if entry_hit:
            if is_long:
                fav = (h - entry) / entry * 100
                adv = (entry - l) / entry * 100
                if l <= stop:
                    stop_hit = True
                    stop_hit_t = t
                    break
                if h >= target:
                    target_hit = True
                    target_hit_t = t
                    break
            else:
                fav = (entry - l) / entry * 100
                adv = (h - entry) / entry * 100
                if h >= stop:
                    stop_hit = True
                    stop_hit_t = t
                    break
                if l <= target:
                    target_hit = True
                    target_hit_t = t
                    break
            mfe = max(mfe, fav)
            mae = max(mae, adv)

    # Determine new status
    if target_hit:
        new_status = "completed"
    elif stop_hit:
        new_status = "failed"
    elif bars_processed >= 30 * 7:  # ~30 trading days
        new_status = "expired"
    else:
        return None  # Still open — re-check later

    return {
        "entry_hit": int(entry_hit),
        "entry_hit_t": entry_hit_t,
        "stop_hit": int(stop_hit),
        "stop_hit_t": stop_hit_t,
        "target_hit": int(target_hit),
        "target_hit_t": target_hit_t,
        "mfe_pct": round(mfe, 4),
        "mae_pct": round(mae, 4),
        "bars_to_resolve": bars_processed,
        "resolved_at": int(time.time()),
        "new_status": new_status,
    }


def _store_outcome(detection_id: str, outcome: dict) -> None:
    conn = get_connection()
    try:
        conn.execute("""
            INSERT INTO pattern_outcomes (
                detection_id, entry_hit, entry_hit_t, stop_hit, stop_hit_t,
                target_hit, target_hit_t, mfe_pct, mae_pct,
                bars_to_resolve, resolved_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(detection_id) DO UPDATE SET
                entry_hit = excluded.entry_hit,
                entry_hit_t = excluded.entry_hit_t,
                stop_hit = excluded.stop_hit,
                stop_hit_t = excluded.stop_hit_t,
                target_hit = excluded.target_hit,
                target_hit_t = excluded.target_hit_t,
                mfe_pct = excluded.mfe_pct,
                mae_pct = excluded.mae_pct,
                bars_to_resolve = excluded.bars_to_resolve,
                resolved_at = excluded.resolved_at
        """, (
            detection_id,
            outcome["entry_hit"], outcome["entry_hit_t"],
            outcome["stop_hit"], outcome["stop_hit_t"],
            outcome["target_hit"], outcome["target_hit_t"],
            outcome["mfe_pct"], outcome["mae_pct"],
            outcome["bars_to_resolve"], outcome["resolved_at"]
        ))
        conn.commit()
    finally:
        conn.close()


def _update_status(detection_id: str, new_status: str) -> None:
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE pattern_detections SET status = ? WHERE id = ?",
            (new_status, detection_id)
        )
        conn.commit()
    finally:
        conn.close()


def recompute_stats() -> int:
    """Aggregate outcomes into pattern_stats by (pattern_id, tf, regime_bucket).

    Returns the number of (pattern, tf, regime) rows written.
    """
    conn = get_connection()
    try:
        # Clear existing stats (full rebuild)
        conn.execute("DELETE FROM pattern_stats")

        rows = conn.execute("""
            SELECT pd.pattern_id, pd.tf,
                   COALESCE(json_extract(pd.context_json, '$.regime'), 'unknown') AS regime,
                   COUNT(*) AS n_total,
                   COUNT(po.detection_id) AS n_resolved,
                   SUM(COALESCE(po.entry_hit, 0)) AS n_entry,
                   SUM(COALESCE(po.target_hit, 0)) AS n_target,
                   SUM(COALESCE(po.stop_hit, 0)) AS n_stop,
                   AVG(po.mfe_pct) AS avg_mfe,
                   AVG(po.mae_pct) AS avg_mae,
                   AVG(po.bars_to_resolve) AS median_bars
            FROM pattern_detections pd
            LEFT JOIN pattern_outcomes po ON po.detection_id = pd.id
            GROUP BY pd.pattern_id, pd.tf, regime
        """).fetchall()

        now = int(time.time())
        written = 0
        for row in rows:
            n_resolved = row["n_resolved"] or 0
            if n_resolved == 0:
                hit_rate = 0.0
                expectancy = 0.0
            else:
                hit_rate = (row["n_target"] or 0) / n_resolved
                # Assume 1R risk per trade; expectancy = (hit_rate * avg_win) - (loss_rate * avg_loss)
                # Approximate as hit_rate*2 - (1-hit_rate)*1 for 2R reward, 1R risk
                expectancy = hit_rate * 2.0 - (1.0 - hit_rate) * 1.0

            conn.execute("""
                INSERT INTO pattern_stats (
                    pattern_id, tf, regime_bucket,
                    n_total, n_resolved, n_entry_hit, n_target_hit, n_stop_hit,
                    avg_mfe_pct, avg_mae_pct, median_bars,
                    hit_rate, expectancy_R, last_updated
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                row["pattern_id"], row["tf"], row["regime"],
                row["n_total"], row["n_resolved"],
                row["n_entry"] or 0, row["n_target"] or 0, row["n_stop"] or 0,
                row["avg_mfe"], row["avg_mae"], int(row["median_bars"] or 0),
                round(hit_rate, 4), round(expectancy, 4), now
            ))
            written += 1

        conn.commit()
        return written
    finally:
        conn.close()
