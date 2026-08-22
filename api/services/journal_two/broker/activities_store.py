"""Raw broker-activity ledger.

Every SnapTrade activity is stored here exactly once (deduped by its
external id). This ledger is the source-of-record: reconstruction always
runs over the FULL ledger for an account (FIFO needs complete buy history
to match a sell), and idempotent trade fingerprints prevent duplicates.

Keeping the raw payload also lets us reprocess history later when option /
corporate-action handling improves, without re-fetching from the broker.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two.broker import snaptrade_adapter as adapter


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def store_activities(
    user_id: str,
    broker_account_id: str,
    raw_activities: list[dict],
    conn: sqlite3.Connection | None = None,
) -> dict[str, int]:
    """Insert new activities, skipping any whose external id we've already
    stored. Returns {"new": n, "dup": m, "invalid": k}."""
    owned = conn is None
    conn = conn or get_connection()
    new = dup = invalid = 0
    try:
        conn.execute("BEGIN")
        for act in raw_activities:
            if not isinstance(act, dict) or not act.get("id"):
                invalid += 1
                continue
            ext = str(act["id"])
            exists = conn.execute(
                "SELECT 1 FROM j2_broker_activities WHERE user_id = ? AND external_id = ?",
                (user_id, ext),
            ).fetchone()
            if exists:
                dup += 1
                continue
            conn.execute(
                """
                INSERT INTO j2_broker_activities
                    (id, user_id, broker_account_id, external_id, activity_type,
                     symbol, occurred_at, raw_json, processed, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
                """,
                (
                    str(uuid.uuid4()), user_id, broker_account_id, ext,
                    str(act.get("type") or ""),
                    adapter.extract_symbol(act),
                    adapter.normalize_date(act),
                    json.dumps(act),
                    _now_iso(),
                ),
            )
            new += 1
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        if owned:
            conn.close()
    return {"new": new, "dup": dup, "invalid": invalid}


def get_activities(
    user_id: str,
    broker_account_id: str,
    conn: sqlite3.Connection | None = None,
) -> list[dict]:
    """All stored raw activities for an account, oldest first (the order
    reconstruction expects). occurred_at NULLs sort last via created_at."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            """
            SELECT raw_json FROM j2_broker_activities
             WHERE user_id = ? AND broker_account_id = ?
             ORDER BY (occurred_at IS NULL), occurred_at ASC, external_id ASC
            """,
            (user_id, broker_account_id),
        ).fetchall()
        out = []
        for r in rows:
            try:
                out.append(json.loads(r["raw_json"]))
            except (TypeError, json.JSONDecodeError):
                continue
        return out
    finally:
        if owned:
            conn.close()


def latest_occurred_at(
    user_id: str,
    broker_account_id: str,
    conn: sqlite3.Connection | None = None,
) -> str | None:
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT MAX(occurred_at) AS m FROM j2_broker_activities "
            "WHERE user_id = ? AND broker_account_id = ?",
            (user_id, broker_account_id),
        ).fetchone()
        return row["m"] if row else None
    finally:
        if owned:
            conn.close()


def heal_window(
    user_id: str,
    broker_account_id: str,
    present_external_ids: set[str],
    *,
    since: str | None = None,
    min_keep_ratio: float = 0.5,
    conn: sqlite3.Connection | None = None,
) -> int:
    """Remove ledger rows the broker no longer returns within the re-fetched
    window (corrections / cancellations). `present_external_ids` is the set of
    activity ids the broker just returned; `since` bounds the comparison to the
    fetched window so we never delete history we didn't re-pull (NULL = full
    backfill, compare everything). Returns the count removed.

    SAFETY GUARD: a transient empty/partial broker fetch must NEVER be read as
    "everything was voided". We refuse to delete when:
      - present_external_ids is empty (failed/empty fetch), OR
      - the fetch covers fewer than `min_keep_ratio` of the rows we hold in the
        window (suspiciously thin — likely a partial/outage response).
    Real corrections void a few activities, not most of the window, so this
    errs toward keeping possibly-stale data over deleting good data.

    Activities with a NULL occurred_at are only healed during a full backfill
    (since IS NULL) — we can't place them in an incremental window."""
    if not present_external_ids:
        return 0
    owned = conn is None
    conn = conn or get_connection()
    try:
        # Provisional intraday fills (external_id 'intraday:…', injected from
        # the Recent Orders poll) are NEVER in the broker's transactions feed
        # until the next day — excluding them from the heal is what keeps
        # same-day trades alive until the real activity replaces them
        # (prune_provisional handles that replacement).
        if since is None:
            rows = conn.execute(
                "SELECT id, external_id FROM j2_broker_activities "
                "WHERE user_id = ? AND broker_account_id = ? "
                "AND external_id NOT LIKE 'intraday:%'",
                (user_id, broker_account_id),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, external_id FROM j2_broker_activities "
                "WHERE user_id = ? AND broker_account_id = ? "
                "AND external_id NOT LIKE 'intraday:%' "
                "AND occurred_at IS NOT NULL AND occurred_at >= ?",
                (user_id, broker_account_id, since),
            ).fetchall()
        if not rows:
            return 0
        present_in_window = sum(1 for r in rows if r["external_id"] in present_external_ids)
        if present_in_window < len(rows) * min_keep_ratio:
            # Fetch covers too little of the window — treat as untrustworthy,
            # skip the destructive heal this cycle.
            return 0
        to_delete = [r["id"] for r in rows if r["external_id"] not in present_external_ids]
        if to_delete:
            conn.execute("BEGIN")
            try:
                conn.executemany(
                    "DELETE FROM j2_broker_activities WHERE id = ?",
                    [(i,) for i in to_delete],
                )
                conn.commit()
            except Exception:
                conn.rollback()
                raise
        return len(to_delete)
    finally:
        if owned:
            conn.close()


def prune_provisional(
    user_id: str,
    broker_account_id: str,
    real_activities: list[dict],
    *,
    max_age_days: int = 3,
    conn: sqlite3.Connection | None = None,
) -> int:
    """Remove provisional intraday fills (from the Recent Orders poll) that
    are now covered by the broker's real transactions feed — matched on
    (symbol, type, |units|, trade day, option contract; the contract key is
    '' for equities and strike|expiry|C-or-P for options, so an equity fill
    can never satisfy an option provisional or vice versa) — plus any older
    than `max_age_days`
    (safety net: by then the real feed has covered that day). Runs during the
    scheduled sync, right after the real activities land."""
    from api.services.journal_two.broker import snaptrade_adapter as adapter

    def _day(v) -> str:
        return str(v or "")[:10]

    def _day_close(a: str, b: str, tolerance_days: int = 2) -> bool:
        """|a - b| <= tolerance in calendar days. Brokers disagree on whether
        trade_date is execution or settlement day — an exact-day match would
        miss and double-count the fill until the age cap (prod risk #1,
        2026-07-17 hardening)."""
        try:
            da = datetime.fromisoformat(a).date()
            db_ = datetime.fromisoformat(b).date()
            return abs((da - db_).days) <= tolerance_days
        except ValueError:
            return a == b

    def _contract_key(act: dict) -> str:
        osym = act.get("option_symbol")
        if not isinstance(osym, dict):
            return ""
        return "|".join([
            str(osym.get("strike_price") or osym.get("strike") or ""),
            str(osym.get("expiration_date") or osym.get("expiration") or "")[:10],
            str(osym.get("option_type") or osym.get("type") or "")[:1].upper(),
        ])

    covered: list[tuple[str, str, float, str, str]] = []
    for act in real_activities:
        if not isinstance(act, dict):
            continue
        try:
            units = abs(float(act.get("units") or 0))
        except (TypeError, ValueError):
            units = 0.0
        covered.append((
            (adapter.extract_symbol(act) or "").upper(),
            str(act.get("type") or "").upper(),
            round(units, 4),
            _day(adapter.normalize_date(act)),
            _contract_key(act),
        ))

    owned = conn is None
    conn = conn or get_connection()
    removed = 0
    try:
        rows = conn.execute(
            "SELECT id, external_id, raw_json, occurred_at, created_at "
            "FROM j2_broker_activities "
            "WHERE user_id = ? AND broker_account_id = ? "
            "AND external_id LIKE 'intraday:%'",
            (user_id, broker_account_id),
        ).fetchall()
        if not rows:
            return 0
        cutoff = (datetime.now(timezone.utc) - timedelta(days=max_age_days)).isoformat()
        to_delete = []
        for r in rows:
            try:
                act = json.loads(r["raw_json"])
            except (TypeError, json.JSONDecodeError):
                to_delete.append(r["id"])
                continue
            try:
                units = abs(float(act.get("units") or 0))
            except (TypeError, ValueError):
                units = 0.0
            sym = (adapter.extract_symbol(act) or "").upper()
            typ = str(act.get("type") or "").upper()
            u = round(units, 4)
            day = _day(r["occurred_at"])
            ckey = _contract_key(act)
            matched = any(
                c_sym == sym and c_typ == typ and c_units == u
                and _day_close(c_day, day) and c_key == ckey
                for c_sym, c_typ, c_units, c_day, c_key in covered
            )
            aged_out = (r["occurred_at"] or r["created_at"] or "") < cutoff
            if matched or aged_out:
                to_delete.append(r["id"])
        if to_delete:
            conn.execute("BEGIN")
            try:
                conn.executemany(
                    "DELETE FROM j2_broker_activities WHERE id = ?",
                    [(i,) for i in to_delete],
                )
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            removed = len(to_delete)
        return removed
    finally:
        if owned:
            conn.close()


def count(user_id: str, broker_account_id: str, conn: sqlite3.Connection | None = None) -> int:
    owned = conn is None
    conn = conn or get_connection()
    try:
        return conn.execute(
            "SELECT COUNT(*) AS n FROM j2_broker_activities "
            "WHERE user_id = ? AND broker_account_id = ?",
            (user_id, broker_account_id),
        ).fetchone()["n"]
    finally:
        if owned:
            conn.close()
