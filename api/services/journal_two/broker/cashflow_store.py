"""Read helpers over j2_broker_cash_flows for the performance engine + the
transactions list. Writes live in cashflow_reconstruct.reconcile_cash_flows."""

from __future__ import annotations

import sqlite3

from api.services.auth_db import get_connection


def _bounds(start: str | None, end: str | None) -> tuple[str, list]:
    sql, args = "", []
    if start:
        sql += " AND flow_date >= ?"
        args.append(start)
    if end:
        sql += " AND flow_date <= ?"
        args.append(end)
    return sql, args


def sum_flows(user_id, account_id, *, external_only=False, start=None, end=None,
              conn: sqlite3.Connection | None = None) -> float:
    """Sum signed amounts. external_only=True restricts to deposits/withdrawals/
    transfers (the return-adjusting flows)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        clause, args = _bounds(start, end)
        ext = " AND is_external = 1" if external_only else ""
        row = conn.execute(
            f"SELECT COALESCE(SUM(amount), 0) AS s FROM j2_broker_cash_flows "
            f"WHERE user_id = ? AND account_id = ?{ext}{clause}",
            (user_id, account_id, *args),
        ).fetchone()
        return round(float(row["s"]), 2)
    finally:
        if owned:
            conn.close()


def sum_by_type(user_id, account_id, *, start=None, end=None,
                conn: sqlite3.Connection | None = None) -> dict[str, float]:
    """{flow_type: summed amount} over the window — powers the dividends/
    interest/fees line items."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        clause, args = _bounds(start, end)
        rows = conn.execute(
            f"SELECT flow_type, COALESCE(SUM(amount), 0) AS s FROM j2_broker_cash_flows "
            f"WHERE user_id = ? AND account_id = ?{clause} GROUP BY flow_type",
            (user_id, account_id, *args),
        ).fetchall()
        return {r["flow_type"]: round(float(r["s"]), 2) for r in rows}
    finally:
        if owned:
            conn.close()


def list_flows(user_id, account_id, start=None, end=None,
               conn: sqlite3.Connection | None = None) -> list[dict]:
    owned = conn is None
    conn = conn or get_connection()
    try:
        clause, args = _bounds(start, end)
        rows = conn.execute(
            f"SELECT flow_date, flow_type, amount, is_external, currency "
            f"FROM j2_broker_cash_flows WHERE user_id = ? AND account_id = ?{clause} "
            f"ORDER BY flow_date ASC",
            (user_id, account_id, *args),
        ).fetchall()
        return [{"date": r["flow_date"], "type": r["flow_type"], "amount": r["amount"],
                 "isExternal": bool(r["is_external"]), "currency": r["currency"]}
                for r in rows]
    finally:
        if owned:
            conn.close()


def external_flow_series(user_id, account_id, start=None, end=None,
                         conn: sqlite3.Connection | None = None) -> list[tuple[str, float]]:
    """[(date, signed_amount), ...] of EXTERNAL flows only, date-ascending — the
    input the performance engine adjusts returns by. Same-day flows summed."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        clause, args = _bounds(start, end)
        rows = conn.execute(
            f"SELECT flow_date, SUM(amount) AS a FROM j2_broker_cash_flows "
            f"WHERE user_id = ? AND account_id = ? AND is_external = 1{clause} "
            f"GROUP BY flow_date ORDER BY flow_date ASC",
            (user_id, account_id, *args),
        ).fetchall()
        return [(r["flow_date"], round(float(r["a"]), 2)) for r in rows]
    finally:
        if owned:
            conn.close()
