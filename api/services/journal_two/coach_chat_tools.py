"""
Compass Chat tool catalog.

Each tool is a dict in TOOLS with:
  - name (str)
  - description (str, used in Anthropic tool definition)
  - input_schema (JSON Schema for args)
  - requires_confirm (bool)
  - executor (callable: user_id, account_id, args, conn -> dict)
  - preview (callable, action tools only)

The orchestrator (coach_chat.py) reads this catalog to assemble the
`tools=` parameter for Anthropic, and dispatches tool calls to the
executor / preview functions.
"""
from __future__ import annotations
import json
import sqlite3
from datetime import datetime, timezone, timedelta, date
from typing import Any, Callable

from api.services.auth_db import get_connection
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two import coach_data_assembler


def _date_from_for_period(period: str) -> str | None:
    period = (period or "").lower()
    today = date.today()
    if period == "today":
        return today.isoformat()
    if period == "week":
        return (today - timedelta(days=7)).isoformat()
    if period == "month":
        return (today - timedelta(days=30)).isoformat()
    if period == "ytd":
        return date(today.year, 1, 1).isoformat()
    return None  # 'all'


def _trades_range_to_iso(days: int) -> tuple[datetime, datetime]:
    # End is 48 hours ahead of now so trades logged with same-day or next-day
    # ISO timestamps (e.g. due to timezone offsets) are always captured.
    end = datetime.now(timezone.utc) + timedelta(days=2)
    start = end - timedelta(days=int(days) + 2)
    return start, end


def _exec_list_recent_trades(*, user_id, account_id, args, conn=None) -> dict:
    days = int(args.get("days", 30))
    start, end = _trades_range_to_iso(days)
    trades = coach_data_assembler._trades_in_range(
        conn or get_connection(), user_id, account_id, start, end,
    )
    if args.get("symbol"):
        sym = args["symbol"].upper()
        trades = [t for t in trades if (t.get("symbol") or "").upper() == sym]
    if args.get("setup"):
        trades = [t for t in trades if t.get("setup") == args["setup"]]
    if args.get("result"):
        trades = [t for t in trades if t.get("result") == args["result"]]
    if args.get("regime"):
        trades = [t for t in trades if t.get("regime") == args["regime"]]
    limit = int(args.get("limit", 100))
    trades = trades[-limit:] if len(trades) > limit else trades
    return {
        "count": len(trades),
        "range": f"{start.date().isoformat()} to {end.date().isoformat()}",
        "trades": trades,
    }


def _exec_get_aggregates(*, user_id, account_id, args, conn=None) -> dict:
    period = (args.get("period") or "week").lower()
    today = date.today()
    days_map = {
        "today": 1, "week": 7, "month": 30,
        "ytd": (today - date(today.year, 1, 1)).days or 1,
        "all": 3650,
    }
    days = days_map.get(period, 7)
    start, end = _trades_range_to_iso(days)
    trades = coach_data_assembler._trades_in_range(conn or get_connection(), user_id, account_id, start, end)
    agg = coach_data_assembler._aggregate_trades(trades)
    out = {"aggregates": agg, "period": period, "range": f"{start.date().isoformat()} to {end.date().isoformat()}"}
    breakdown_by = args.get("breakdown_by")
    if breakdown_by:
        out["breakdown"] = _breakdown_trades(trades, breakdown_by)
    return out


def _breakdown_trades(trades: list[dict], dimension: str) -> list[dict]:
    buckets: dict[str, list[dict]] = {}
    for t in trades:
        key = _bucket_key(t, dimension)
        if key is None:
            continue
        buckets.setdefault(key, []).append(t)
    out = []
    for k, group in buckets.items():
        agg = coach_data_assembler._aggregate_trades(group)
        out.append({"key": k, **agg})
    out.sort(key=lambda b: b.get("net_pnl_dollar") or 0, reverse=True)
    return out


def _bucket_key(t: dict, dimension: str) -> str | None:
    if dimension == "setup":
        return t.get("setup") or "(no setup)"
    if dimension == "symbol":
        return (t.get("symbol") or "").upper() or None
    if dimension == "regime":
        return t.get("regime") or "(no regime)"
    if dimension == "day_of_week":
        try:
            d = datetime.fromisoformat(str(t.get("exit_date")).replace("Z", "+00:00"))
            return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d.weekday()]
        except Exception:
            return None
    if dimension == "hour":
        try:
            d = datetime.fromisoformat(str(t.get("exit_date")).replace("Z", "+00:00"))
            return f"{d.hour:02d}:00"
        except Exception:
            return None
    if dimension == "mistake":
        tags = t.get("mistake_tags") or []
        return tags[0] if tags else None
    if dimension == "emotion":
        tags = t.get("emotion_tags") or []
        return tags[0] if tags else None
    return None


def _exec_get_open_positions(*, user_id, account_id, args, conn=None) -> dict:
    rows = coach_data_assembler._open_positions(conn or get_connection(), user_id, account_id)
    return {"count": len(rows), "positions": rows}


def _exec_get_trader_profile(*, user_id, account_id, args, conn=None) -> dict:
    c = conn or get_connection()
    row = c.execute(
        "SELECT trader_profile FROM j2_accounts WHERE id = ? AND user_id = ?",
        (account_id, user_id),
    ).fetchone()
    if row is None:
        return {"profile_markdown": "", "exists": False}
    return {"profile_markdown": row["trader_profile"] or "", "exists": True}


def _exec_get_recent_recaps(*, user_id, account_id, args, conn=None) -> dict:
    kind = (args.get("kind") or "all").lower()
    limit = int(args.get("limit", 10))
    sql = """SELECT id, output_type, body, summary, metadata, created_at
             FROM j2_coach_outputs
             WHERE user_id = ? AND account_id = ? AND forgotten = 0"""
    params: list = [user_id, account_id]
    if kind == "eod":
        sql += " AND output_type = 'eod_recap'"
    elif kind == "weekly":
        sql += " AND output_type = 'weekly_review'"
    elif kind == "all":
        sql += " AND output_type IN ('eod_recap', 'weekly_review')"
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    rows = (conn or get_connection()).execute(sql, params).fetchall()
    out = []
    for r in rows:
        try:
            meta = json.loads(r["metadata"]) if r["metadata"] else {}
        except (TypeError, json.JSONDecodeError):
            meta = {}
        out.append({
            "id": r["id"],
            "kind": r["output_type"],
            "day_or_week": meta.get("day") or meta.get("week_start"),
            "summary": r["summary"] or "",
            "body": r["body"] or "",
        })
    return {"count": len(out), "recaps": out}


def _exec_get_account_settings(*, user_id, account_id, args, conn=None) -> dict:
    settings = accounts_service.get_account_settings(user_id, account_id, conn=conn) or {}
    return {"settings": settings}


def _exec_get_setup_stats(*, user_id, account_id, args, conn=None) -> dict:
    days = int(args.get("days", 180))
    start, end = _trades_range_to_iso(days)
    trades = coach_data_assembler._trades_in_range(conn or get_connection(), user_id, account_id, start, end)
    if args.get("setup"):
        trades = [t for t in trades if t.get("setup") == args["setup"]]
    breakdown = _breakdown_trades(trades, "setup")
    return {"setups": [{"setup": b["key"], **{k: v for k, v in b.items() if k != "key"}} for b in breakdown]}


def _exec_find_arcs(*, user_id, account_id, args, conn=None) -> dict:
    lookback = int(args.get("lookback_days", 10))
    start, end = _trades_range_to_iso(lookback)
    trades = coach_data_assembler._trades_in_range(conn or get_connection(), user_id, account_id, start, end)
    arcs = coach_data_assembler._detect_recent_arcs(trades, today_date=end.date())
    return {"arcs": arcs}


TOOLS: dict[str, dict[str, Any]] = {
    "list_recent_trades": {
        "name": "list_recent_trades",
        "description": "Fetch closed trades from the journal, optionally filtered by days, symbol, setup, result, or regime.",
        "requires_confirm": False,
        "executor": _exec_list_recent_trades,
        "input_schema": {
            "type": "object",
            "properties": {
                "days": {"type": "integer", "default": 30, "minimum": 1, "maximum": 365},
                "symbol": {"type": "string"},
                "setup": {"type": "string"},
                "result": {"type": "string", "enum": ["Win", "Loss", "BE"]},
                "regime": {"type": "string", "enum": ["GREEN", "AMBER", "ORANGE", "RED"]},
                "limit": {"type": "integer", "default": 100, "maximum": 500},
            },
        },
    },
    "get_aggregates": {
        "name": "get_aggregates",
        "description": "Compute aggregate stats for a period, optionally with a breakdown by dimension.",
        "requires_confirm": False,
        "executor": _exec_get_aggregates,
        "input_schema": {
            "type": "object",
            "properties": {
                "period": {"type": "string", "enum": ["today", "week", "month", "ytd", "all"], "default": "week"},
                "breakdown_by": {"type": "string", "enum": ["setup", "symbol", "regime", "day_of_week", "hour", "mistake", "emotion"]},
            },
        },
    },
    "get_open_positions": {
        "name": "get_open_positions",
        "description": "List currently open positions (overnight bets).",
        "requires_confirm": False,
        "executor": _exec_get_open_positions,
        "input_schema": {"type": "object", "properties": {}},
    },
    "get_trader_profile": {
        "name": "get_trader_profile",
        "description": "Read the markdown Trader Profile for the current account.",
        "requires_confirm": False,
        "executor": _exec_get_trader_profile,
        "input_schema": {"type": "object", "properties": {}},
    },
    "get_recent_recaps": {
        "name": "get_recent_recaps",
        "description": "Fetch recent Compass recaps (EOD daily and/or Weekly Review).",
        "requires_confirm": False,
        "executor": _exec_get_recent_recaps,
        "input_schema": {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": ["eod", "weekly", "all"], "default": "all"},
                "limit": {"type": "integer", "default": 10, "maximum": 50},
            },
        },
    },
    "get_account_settings": {
        "name": "get_account_settings",
        "description": "Fetch the account's discipline + sizing settings.",
        "requires_confirm": False,
        "executor": _exec_get_account_settings,
        "input_schema": {"type": "object", "properties": {}},
    },
    "get_setup_stats": {
        "name": "get_setup_stats",
        "description": "Per-setup performance breakdown over a lookback window.",
        "requires_confirm": False,
        "executor": _exec_get_setup_stats,
        "input_schema": {
            "type": "object",
            "properties": {
                "setup": {"type": "string"},
                "days": {"type": "integer", "default": 180, "minimum": 7, "maximum": 730},
            },
        },
    },
    "find_arcs": {
        "name": "find_arcs",
        "description": "Run multi-day arc detectors and return non-empty arcs.",
        "requires_confirm": False,
        "executor": _exec_find_arcs,
        "input_schema": {
            "type": "object",
            "properties": {"lookback_days": {"type": "integer", "default": 10, "minimum": 5, "maximum": 30}},
        },
    },
}
