"""
Live Alerts persistence layer — Phase 1.

Stores every Bullflow alert that survives table-filter + dedup into a SQLite
table on the Railway volume (/data/flow.db, shared with oi_snapshots). The
history endpoint in liveflow_router queries this table for historical date
ranges; the in-memory ring buffer in liveflow_worker continues to serve the
live polling endpoint unchanged.

Write pattern (called from liveflow_worker._ingest_alert and friends):
  - insert_alert(alert)        → INSERT a freshly-enriched alert (after dedup)
  - update_alert_state(id, **) → UPDATE fields (superseded flag, Discord state)

Read pattern (called from liveflow_router):
  - query_alerts(date_from, date_to, limit) → list of row dicts

The schema lives in /data/flow.db alongside oi_snapshots' tables. Schema is
idempotent — init_db() can be called on every worker boot.

Phase 2 (future): bullflow_mcp_probe.py Discord JSON backfill will INSERT
into the same table with a `source="discord_backfill"` column so the
provenance is queryable.
"""
from __future__ import annotations

import logging
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterable

log = logging.getLogger(__name__)

# Same DB as oi_snapshots — single Railway volume, single file.
DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")

# All columns in INSERT order. Keep this in sync with the CREATE TABLE statement
# below and the dict-keys used by insert_alert / update_alert_state.
_COLUMNS = [
    "id",                       # Bullflow alert id (PK)
    "ingested_at",              # UTC ISO timestamp, set by worker
    "date_iso",                 # date portion of ingested_at, indexed
    "alert_type",               # "algo" | "custom"
    "alert_name",               # human-readable name
    "ticker", "cp", "strike", "exp", "dte",
    "symbol",                   # raw OCC
    "premium",                  # alertPremium
    "avg_fill_price",
    "bullflow_timestamp",       # trade time (Unix float)
    "received_at",              # bullflow ingest time (Unix float)
    "latency",
    "delivery_latency",
    "trade_size",               # contracts (derived from premium/fill)
    "prior_oi",
    "vol_oi_ratio",
    "oi_exceeded",              # bool 0/1
    "oi_snapshot_date",         # date of OI snap used (string)
    "spot",
    "moneyness_pct",
    "moneyness_label",          # ITM/ATM/OTM
    "contract_repeat_count",
    "superseded",               # bool 0/1
    "grade",                    # A+/A/B+/B/C/D — set after conviction computed
    "gate_passed",              # bool 0/1 — was grade ≥ MIN_DISCORD_GRADE?
    "forwarded_to_discord",     # bool 0/1 — did the POST actually fire?
    "discord_message_id",       # nullable string
    "source",                   # "live" (Phase 1) | future "discord_backfill"
]

_CREATE_SQL = f"""
CREATE TABLE IF NOT EXISTS live_alerts (
    id TEXT NOT NULL,
    ingested_at TEXT NOT NULL,
    date_iso TEXT NOT NULL,
    alert_type TEXT,
    alert_name TEXT,
    ticker TEXT,
    cp TEXT,
    strike REAL,
    exp TEXT,
    dte INTEGER,
    symbol TEXT,
    premium REAL,
    avg_fill_price REAL,
    bullflow_timestamp REAL,
    received_at REAL,
    latency REAL,
    delivery_latency REAL,
    trade_size INTEGER,
    prior_oi INTEGER,
    vol_oi_ratio REAL,
    oi_exceeded INTEGER,
    oi_snapshot_date TEXT,
    spot REAL,
    moneyness_pct REAL,
    moneyness_label TEXT,
    contract_repeat_count INTEGER,
    superseded INTEGER DEFAULT 0,
    grade TEXT,
    gate_passed INTEGER,
    forwarded_to_discord INTEGER DEFAULT 0,
    discord_message_id TEXT,
    source TEXT DEFAULT 'live',
    PRIMARY KEY (id, date_iso)
);
"""

# Indexes — date_iso for range queries, ticker+date for per-symbol drilldowns.
_INDEX_SQL = [
    "CREATE INDEX IF NOT EXISTS idx_live_alerts_date ON live_alerts(date_iso);",
    "CREATE INDEX IF NOT EXISTS idx_live_alerts_ticker_date ON live_alerts(ticker, date_iso);",
    "CREATE INDEX IF NOT EXISTS idx_live_alerts_ingested ON live_alerts(ingested_at);",
]

_initialized = False


@contextmanager
def _conn():
    """Short-lived connection per call. SQLite handles concurrent readers
    natively; writers serialize. WAL mode keeps polling reads non-blocking."""
    c = sqlite3.connect(DB_PATH, timeout=10.0)
    c.row_factory = sqlite3.Row
    try:
        yield c
        c.commit()
    finally:
        c.close()


def init_db() -> None:
    """Create table + indexes if missing. Idempotent; safe to call repeatedly.

    Auto-migrates the old single-PK schema (id PRIMARY KEY) to the new
    composite-PK schema (id, date_iso PRIMARY KEY). Migration is necessary
    because Bullflow's alert IDs are per-day sequential numbers (1, 2, 3...)
    that collide across days under the old schema. Existing rows are
    preserved — each one has a unique (id, date_iso) combination since the
    old schema enforced id uniqueness."""
    global _initialized
    if _initialized:
        return
    try:
        with _conn() as c:
            # WAL mode = concurrent readers don't block the writer. Persists
            # across connections once set on the DB file.
            c.execute("PRAGMA journal_mode=WAL;")

            # Detect schema version. If a table exists but uses the old
            # single-PK shape (id is PRIMARY KEY by itself), migrate it.
            row = c.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='live_alerts'"
            ).fetchone()
            if row is not None:
                existing_schema = (row["sql"] or "")
                # The new schema declares "PRIMARY KEY (id, date_iso)" as a
                # table constraint. The old schema declared "id TEXT PRIMARY KEY"
                # inline on the column. Migrate if we don't see the composite form.
                needs_migration = "PRIMARY KEY (id, date_iso)" not in existing_schema
                if needs_migration:
                    log.warning(
                        "[live_alerts_db] migrating to composite PK — "
                        "fixes cross-day ID collisions (e.g. backfilling "
                        "multiple days, daily-resetting live IDs)"
                    )
                    c.execute("ALTER TABLE live_alerts RENAME TO live_alerts_v1_backup;")
                    c.execute(_CREATE_SQL)
                    cols = ", ".join(_COLUMNS)
                    # INSERT OR IGNORE for safety, though no collisions expected
                    # since the old PK enforced id uniqueness across the whole
                    # table (only one row per id).
                    c.execute(
                        f"INSERT OR IGNORE INTO live_alerts ({cols}) "
                        f"SELECT {cols} FROM live_alerts_v1_backup;"
                    )
                    migrated = c.execute(
                        "SELECT COUNT(*) AS n FROM live_alerts"
                    ).fetchone()["n"]
                    c.execute("DROP TABLE live_alerts_v1_backup;")
                    for sql in _INDEX_SQL:
                        c.execute(sql)
                    log.info(
                        "[live_alerts_db] migration complete — %d rows preserved",
                        migrated,
                    )
                    _initialized = True
                    return

            # Fresh init (no existing table) or already on new schema
            c.execute(_CREATE_SQL)
            for sql in _INDEX_SQL:
                c.execute(sql)
        _initialized = True
        log.info("[live_alerts_db] initialized at %s", DB_PATH)
    except Exception as e:
        # Don't crash worker boot if /data isn't mounted yet. We'll retry on
        # the next insert call.
        log.warning("[live_alerts_db] init_db failed (will retry): %s", e)


# ─── Alert → row mapping ─────────────────────────────────────────────────────
# The alert dict that liveflow_worker maintains uses camelCase keys. The DB
# uses snake_case. Map between them explicitly so renaming on either side
# fails loudly rather than silently dropping data.

def _alert_to_row(alert: dict) -> dict:
    """Translate a worker enriched-alert dict to a DB row dict. Missing
    fields → None. The alert is expected to be POST-enrichment (has OI and
    moneyness fields filled in or set to None)."""
    ingested = alert.get("ingestedAt") or datetime.now(timezone.utc).isoformat()
    # Pull just the date portion. ingestedAt is always YYYY-MM-DDTHH:MM:SS+00:00.
    date_iso = ingested[:10] if ingested and len(ingested) >= 10 else ""
    return {
        "id":                    alert.get("id"),
        "ingested_at":           ingested,
        "date_iso":              date_iso,
        "alert_type":            alert.get("alertType"),
        "alert_name":            alert.get("alertName"),
        "ticker":                alert.get("ticker"),
        "cp":                    alert.get("cp"),
        "strike":                alert.get("strike"),
        "exp":                   alert.get("exp"),
        "dte":                   alert.get("dte"),
        "symbol":                alert.get("symbol"),
        "premium":               alert.get("alertPremium"),
        "avg_fill_price":        alert.get("averageFillPrice"),
        "bullflow_timestamp":    alert.get("timestamp"),
        "received_at":           alert.get("receivedAt"),
        "latency":               alert.get("latency"),
        "delivery_latency":      alert.get("deliveryLatency"),
        "trade_size":            alert.get("tradeSize"),
        "prior_oi":              alert.get("priorOI"),
        "vol_oi_ratio":          alert.get("volumeOIRatio"),
        "oi_exceeded":           1 if alert.get("oiExceeded") else 0,
        "oi_snapshot_date":      alert.get("oiSnapshotDate"),
        "spot":                  alert.get("spot"),
        "moneyness_pct":         alert.get("moneynessPct"),
        "moneyness_label":       alert.get("moneynessLabel"),
        "contract_repeat_count": alert.get("contractRepeatCount"),
        "superseded":            1 if alert.get("_superseded") else 0,
        # Discord state — usually None at insert time; gets UPDATEd later
        # when _post_to_discord runs after the forward delay.
        "grade":                 alert.get("grade"),
        "gate_passed":           None if alert.get("gatePassed") is None else (1 if alert.get("gatePassed") else 0),
        "forwarded_to_discord":  1 if alert.get("forwardedToDiscord") else 0,
        "discord_message_id":    alert.get("discordMessageId"),
        "source":                "live",
    }


# ─── Write operations ────────────────────────────────────────────────────────

def insert_alert(alert: dict, source: str = "live") -> None:
    """Insert a freshly-enriched alert. INSERT OR IGNORE on duplicate id so
    a retry doesn't break the worker. Failures are logged but not raised —
    persistence loss is acceptable vs. blocking the live pipeline.

    `source` tags the row's provenance — 'live' for real-time SSE captures
    (default), 'bullflow_replay' for backfills via the MCP replay tool,
    'discord_backfill' for Discord JSON imports (Phase 2). The frontend can
    use this to flag historical samples that may be incomplete (e.g.
    Bullflow replay caps at ~100 alerts/day vs. ~500 actual)."""
    init_db()
    row = _alert_to_row(alert)
    row["source"] = source
    if not row.get("id"):
        log.warning("[live_alerts_db] skipping insert — alert has no id: %r",
                    {k: row.get(k) for k in ("ticker", "alert_name", "ingested_at")})
        return
    placeholders = ", ".join("?" for _ in _COLUMNS)
    sql = f"INSERT OR IGNORE INTO live_alerts ({', '.join(_COLUMNS)}) VALUES ({placeholders})"
    values = [row.get(col) for col in _COLUMNS]
    try:
        with _conn() as c:
            c.execute(sql, values)
    except Exception as e:
        log.warning("[live_alerts_db] insert failed for id=%s: %s", row.get("id"), e)


def update_alert_state(alert_id: str, **fields: Any) -> None:
    """Partial UPDATE on a single row. Accepts any column name as kwarg.
    Used for: marking superseded, recording Discord grade/gate/forward state,
    saving discord_message_id after POST.

    Example:
        update_alert_state("abc123", superseded=1)
        update_alert_state("abc123", grade="A", gate_passed=1,
                           forwarded_to_discord=1,
                           discord_message_id="123456789")
    """
    if not alert_id or not fields:
        return
    init_db()
    # Validate every key — guard against typos silently no-op'ing.
    bad_keys = [k for k in fields if k not in _COLUMNS]
    if bad_keys:
        log.warning("[live_alerts_db] update_alert_state ignoring unknown columns: %s", bad_keys)
        fields = {k: v for k, v in fields.items() if k not in bad_keys}
    if not fields:
        return
    # Normalize bool-ish values that callers might pass as Python bools.
    for k, v in list(fields.items()):
        if isinstance(v, bool):
            fields[k] = 1 if v else 0
    set_clause = ", ".join(f"{k} = ?" for k in fields.keys())
    values = list(fields.values()) + [alert_id]
    sql = f"UPDATE live_alerts SET {set_clause} WHERE id = ?"
    try:
        with _conn() as c:
            c.execute(sql, values)
    except Exception as e:
        log.warning("[live_alerts_db] update failed for id=%s: %s", alert_id, e)


# ─── Read operations ─────────────────────────────────────────────────────────

def query_alerts(
    date_from: str,
    date_to: str,
    limit: int = 2000,
    tickers: Iterable[str] | None = None,
) -> list[dict]:
    """
    Returns alerts with date_iso in [date_from, date_to] (inclusive), newest
    first, capped at `limit`. Both dates are ISO strings YYYY-MM-DD.

    Optional `tickers` whitelist for per-symbol filtering. Empty list → all.
    """
    init_db()
    sql = "SELECT * FROM live_alerts WHERE date_iso BETWEEN ? AND ?"
    params: list[Any] = [date_from, date_to]
    if tickers:
        clean = [t.upper().strip() for t in tickers if t and t.strip()]
        if clean:
            placeholders = ", ".join("?" for _ in clean)
            sql += f" AND ticker IN ({placeholders})"
            params.extend(clean)
    sql += " ORDER BY ingested_at DESC LIMIT ?"
    params.append(int(limit))
    try:
        with _conn() as c:
            rows = c.execute(sql, params).fetchall()
            return [_row_to_alert_dict(r) for r in rows]
    except Exception as e:
        log.warning("[live_alerts_db] query failed [%s..%s]: %s", date_from, date_to, e)
        return []


def count_by_date(date_from: str, date_to: str) -> dict[str, int]:
    """Per-day alert counts for the picker UI to show which days have data.
    Returns {date_iso: count}."""
    init_db()
    sql = "SELECT date_iso, COUNT(*) AS n FROM live_alerts WHERE date_iso BETWEEN ? AND ? GROUP BY date_iso"
    try:
        with _conn() as c:
            rows = c.execute(sql, (date_from, date_to)).fetchall()
            return {r["date_iso"]: r["n"] for r in rows}
    except Exception as e:
        log.warning("[live_alerts_db] count_by_date failed: %s", e)
        return {}


def delete_alerts_before_date(cutoff_date_iso: str) -> int:
    """
    Delete all alerts whose date_iso is strictly less than cutoff_date_iso.

    Used to clear historical data before going live with new gate config —
    e.g. cutoff='2026-06-22' deletes everything from June 21 and earlier,
    leaving Monday's market open to populate fresh data.

    Returns the number of rows deleted. Idempotent: calling twice with the
    same cutoff returns 0 on the second call.

    cutoff_date_iso must be YYYY-MM-DD format. Caller is responsible for
    validation and authorization — this is a destructive operation.
    """
    init_db()
    sql = "DELETE FROM live_alerts WHERE date_iso < ?"
    with _conn() as c:
        cur = c.execute(sql, (cutoff_date_iso,))
        c.commit()
        deleted = cur.rowcount
        log.warning(
            "[live_alerts_db] delete_alerts_before_date cutoff=%s deleted=%d",
            cutoff_date_iso, deleted,
        )
        return deleted


def delete_all_alerts() -> int:
    """
    Nuclear option: delete every row in live_alerts. Returns rowcount.
    Caller responsible for confirmation. Mainly useful for a true fresh
    start when delete_alerts_before_date isn't enough (e.g., if alerts
    have already been ingested for today's date and you want to start
    over from zero).
    """
    init_db()
    with _conn() as c:
        cur = c.execute("DELETE FROM live_alerts")
        c.commit()
        deleted = cur.rowcount
        log.warning("[live_alerts_db] delete_all_alerts deleted=%d", deleted)
        return deleted


def _row_to_alert_dict(row: sqlite3.Row) -> dict:
    """DB row → frontend-compatible alert dict (camelCase keys matching the
    shape served by /api/live/alerts/recent so the same React rendering code
    works for live + historical views)."""
    return {
        "id":                  row["id"],
        "alertType":           row["alert_type"],
        "alertName":           row["alert_name"],
        "symbol":              row["symbol"],
        "ticker":              row["ticker"],
        "cp":                  row["cp"],
        "strike":              row["strike"],
        "exp":                 row["exp"],
        "dte":                 row["dte"],
        "alertPremium":        row["premium"],
        "averageFillPrice":    row["avg_fill_price"],
        "timestamp":           row["bullflow_timestamp"],
        "receivedAt":          row["received_at"],
        "latency":             row["latency"],
        "deliveryLatency":     row["delivery_latency"],
        "ingestedAt":          row["ingested_at"],
        "tradeSize":           row["trade_size"],
        "priorOI":             row["prior_oi"],
        "volumeOIRatio":       row["vol_oi_ratio"],
        "oiExceeded":          bool(row["oi_exceeded"]),
        "oiSnapshotDate":      row["oi_snapshot_date"],
        "spot":                row["spot"],
        "moneynessPct":        row["moneyness_pct"],
        "moneynessLabel":      row["moneyness_label"],
        "contractRepeatCount": row["contract_repeat_count"],
        "_superseded":         bool(row["superseded"]),
        "grade":               row["grade"],
        "gatePassed":          None if row["gate_passed"] is None else bool(row["gate_passed"]),
        "forwardedToDiscord":  bool(row["forwarded_to_discord"]),
        "discordMessageId":    row["discord_message_id"],
        "source":              row["source"],
    }
