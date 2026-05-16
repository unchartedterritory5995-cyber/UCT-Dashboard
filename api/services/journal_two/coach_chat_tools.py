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
from api.services.journal_two.coach_scope import is_unified


_UNIFIED_REJECT = {
    "ok": False,
    "error": (
        "This action targets one account's settings. "
        "Switch the account selector to a single account, then try again."
    ),
}


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
    if is_unified(account_id):
        from api.services.journal_two import unified_coach
        state = unified_coach.get_or_create(c, user_id)
        return {
            "profile_markdown": state["traderProfile"],
            "exists": bool(state["traderProfile"]),
        }
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


def _confidence_for(n: int) -> str:
    """Sample-size confidence: <5 = low, 5-19 = medium, 20+ = high."""
    if n < 5:
        return "low"
    if n < 20:
        return "medium"
    return "high"


def _exec_analyze_time_of_day(*, user_id, account_id, args, conn=None) -> dict:
    days = int(args.get("days", 180))
    start, end = _trades_range_to_iso(days)
    trades = coach_data_assembler._trades_in_range(conn or get_connection(), user_id, account_id, start, end)
    if args.get("setup"):
        trades = [t for t in trades if t.get("setup") == args["setup"]]
    if args.get("symbol"):
        sym = args["symbol"].upper()
        trades = [t for t in trades if (t.get("symbol") or "").upper() == sym]
    from zoneinfo import ZoneInfo
    et = ZoneInfo("America/New_York")
    buckets: dict[str, list[dict]] = {}
    for t in trades:
        try:
            d = datetime.fromisoformat(str(t.get("entry_date")).replace("Z", "+00:00"))
            key = f"{d.astimezone(et).hour:02d}:00"
        except Exception:
            continue
        buckets.setdefault(key, []).append(t)
    out_buckets = {k: coach_data_assembler._aggregate_trades(v) for k, v in buckets.items()}
    n = sum(len(v) for v in buckets.values())
    return {"buckets": out_buckets, "days": days, "confidence": _confidence_for(n)}


def _exec_analyze_day_of_week(*, user_id, account_id, args, conn=None) -> dict:
    days = int(args.get("days", 180))
    start, end = _trades_range_to_iso(days)
    trades = coach_data_assembler._trades_in_range(conn or get_connection(), user_id, account_id, start, end)
    if args.get("setup"):
        trades = [t for t in trades if t.get("setup") == args["setup"]]
    weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    buckets: dict[str, list[dict]] = {}
    for t in trades:
        try:
            d = datetime.fromisoformat(str(t.get("entry_date")).replace("Z", "+00:00"))
            key = weekdays[d.weekday()]
        except Exception:
            continue
        buckets.setdefault(key, []).append(t)
    out = {k: coach_data_assembler._aggregate_trades(v) for k, v in buckets.items()}
    n = sum(len(v) for v in buckets.values())
    return {"buckets": out, "days": days, "confidence": _confidence_for(n)}


def _exec_analyze_hold_duration(*, user_id, account_id, args, conn=None) -> dict:
    days = int(args.get("days", 180))
    start, end = _trades_range_to_iso(days)
    trades = coach_data_assembler._trades_in_range(conn or get_connection(), user_id, account_id, start, end)
    if args.get("setup"):
        trades = [t for t in trades if t.get("setup") == args["setup"]]
    winners = [t for t in trades if t.get("result") == "Win"]
    losers = [t for t in trades if t.get("result") == "Loss"]

    def _stats(group: list[dict]) -> dict:
        if not group:
            return {"count": 0, "avg_days": None, "median_days": None}
        holds = sorted(float(t.get("hold_days") or 0) for t in group)
        avg = sum(holds) / len(holds)
        median = holds[len(holds) // 2]
        return {"count": len(group), "avg_days": round(avg, 1), "median_days": round(median, 1)}

    w = _stats(winners)
    l = _stats(losers)
    hint = "balanced"
    if w["avg_days"] and l["avg_days"]:
        if l["avg_days"] < w["avg_days"] * 0.5:
            hint = "cutting_winners_short"
        elif l["avg_days"] > w["avg_days"] * 1.5:
            hint = "holding_losers"
    n = w["count"] + l["count"]
    return {"winners": w, "losers": l, "hint": hint, "days": days, "confidence": _confidence_for(n)}


def _exec_analyze_sequence(*, user_id, account_id, args, conn=None) -> dict:
    prior_outcome = args.get("prior_outcome", "Win")
    n = int(args.get("n", 3))
    days = int(args.get("days", 180))
    start, end = _trades_range_to_iso(days)
    trades = coach_data_assembler._trades_in_range(conn or get_connection(), user_id, account_id, start, end)
    trades.sort(key=lambda t: t.get("exit_date") or "")
    captured: list[dict] = []
    for i, t in enumerate(trades):
        if t.get("result") == prior_outcome:
            captured.extend(trades[i + 1:i + 1 + n])
    agg = coach_data_assembler._aggregate_trades(captured)
    trade_count = agg.get("trade_count", 0)
    return {"prior_outcome": prior_outcome, "n": n, **agg, "confidence": _confidence_for(trade_count)}


def _exec_analyze_sizing_curve(*, user_id, account_id, args, conn=None) -> dict:
    days = int(args.get("days", 180))
    start, end = _trades_range_to_iso(days)
    trades = coach_data_assembler._trades_in_range(conn or get_connection(), user_id, account_id, start, end)
    settings = accounts_service.get_account_settings(user_id, account_id, conn=conn) or {}
    account_size = float(settings.get("accountSize") or 0)
    if account_size <= 0:
        return {"buckets": [], "note": "account size not configured"}
    rows: list[dict] = []
    for t in trades:
        shares = float(t.get("shares") or 0)
        entry = float(t.get("entry_price") or 0)
        stop = float(t.get("original_stop") or 0)
        if shares <= 0 or entry <= 0 or stop <= 0:
            continue
        per_share = abs(entry - stop)
        risk_pct = (shares * per_share / account_size) * 100.0
        rows.append({"risk_pct": risk_pct, **t})
    buckets: dict[str, list[dict]] = {}
    for r in rows:
        band = int(r["risk_pct"] // 0.5) * 0.5
        key = f"{band:.1f}-{band + 0.5:.1f}%"
        buckets.setdefault(key, []).append(r)
    out = []
    for k, group in sorted(buckets.items()):
        agg = coach_data_assembler._aggregate_trades(group)
        out.append({"band": k, **agg})
    return {"buckets": out, "days": days, "account_size": account_size, "confidence": _confidence_for(len(rows))}


def _exec_analyze_correlation(*, user_id, account_id, args, conn=None) -> dict:
    positions = coach_data_assembler._open_positions(conn or get_connection(), user_id, account_id)
    open_count = len(positions)
    return {"open_positions_overlap": {"sector": None, "theme": None}, "open_count": open_count,
            "note": "Sector/theme enrichment not wired yet — v1 returns counts only.",
            "confidence": _confidence_for(open_count)}


def _exec_compare_setups(*, user_id, account_id, args, conn=None) -> dict:
    setup_a = args.get("setup_a")
    setup_b = args.get("setup_b")
    days = int(args.get("days", 180))
    start, end = _trades_range_to_iso(days)
    trades = coach_data_assembler._trades_in_range(conn or get_connection(), user_id, account_id, start, end)

    def _stats_for_setup(setup_name: str) -> dict:
        group = [t for t in trades if t.get("setup") == setup_name]
        agg = coach_data_assembler._aggregate_trades(group)
        return {"setup": setup_name, **agg}

    a = _stats_for_setup(setup_a)
    b = _stats_for_setup(setup_b)
    n = a.get("trade_count", 0) + b.get("trade_count", 0)
    return {"setup_a": a, "setup_b": b, "days": days, "confidence": _confidence_for(n)}


def _exec_get_trade_by_id(*, user_id, account_id, args, conn=None) -> dict:
    trade_id = args.get("trade_id")
    if not trade_id:
        return {"error": "trade_id required"}
    c = conn or get_connection()
    row = c.execute(
        """SELECT id, symbol, side, shares, entry_price, exit_price, entry_date, exit_date,
                  original_stop, setup, notes, pnl_dollar, pnl_percent, r_multiple,
                  hold_days, result, mistake_tags, emotion_tags, regime
           FROM j2_trades WHERE id = ? AND user_id = ?""",
        (trade_id, user_id),
    ).fetchone()
    if row is None:
        return {"error": f"trade {trade_id} not found"}
    out = dict(row)
    try:
        out["mistake_tags"] = json.loads(out.get("mistake_tags") or "[]")
        out["emotion_tags"] = json.loads(out.get("emotion_tags") or "[]")
    except (TypeError, json.JSONDecodeError):
        pass
    return {"trade": out}


def _record_trade_lesson_preview(*, user_id, account_id, args, conn=None) -> dict:
    trade_id = args.get("trade_id")
    lesson = (args.get("lesson") or "")[:1000]
    c = conn or get_connection()
    row = c.execute(
        "SELECT symbol, exit_date FROM j2_trades WHERE id = ? AND user_id = ?",
        (trade_id, user_id),
    ).fetchone()
    if row is None:
        return {"narration": f"Trade {trade_id} not found.", "contextual_warnings": [],
                "confirm_label": "Confirm", "elevated": False}
    return {
        "narration": f"Append lesson to your {row['symbol']} trade ({row['exit_date'][:10]}): \"{lesson[:120]}{'...' if len(lesson) > 120 else ''}\"",
        "contextual_warnings": [], "confirm_label": "Save lesson", "elevated": False,
    }


def _record_trade_lesson_execute(*, user_id, account_id, args, conn=None) -> dict:
    trade_id = args.get("trade_id")
    lesson = (args.get("lesson") or "").strip()
    if not trade_id or not lesson:
        return {"ok": False, "error": "trade_id and lesson required"}
    c = conn or get_connection()
    row = c.execute(
        "SELECT notes FROM j2_trades WHERE id = ? AND user_id = ?",
        (trade_id, user_id),
    ).fetchone()
    if row is None:
        return {"ok": False, "error": "trade not found"}
    prev = (row["notes"] or "").strip()
    stamp = datetime.now(timezone.utc).date().isoformat()
    appended = f"{prev}\n\n[Compass lesson {stamp}]: {lesson}".strip() if prev else f"[Compass lesson {stamp}]: {lesson}"
    c.execute(
        "UPDATE j2_trades SET notes = ? WHERE id = ? AND user_id = ?",
        (appended, trade_id, user_id),
    )
    c.commit()
    return {"ok": True, "summary": "Lesson saved to trade notes."}


def _exec_search_conversation(*, user_id, account_id, args, conn=None) -> dict:
    query = (args.get("query") or "").strip()
    limit = int(args.get("limit", 10))
    if not query:
        return {"matches": [], "count": 0}
    c = conn or get_connection()
    # Simple LIKE search on content; case-insensitive
    rows = c.execute(
        """SELECT id, role, content, created_at FROM j2_chat_messages
           WHERE user_id = ? AND account_id = ?
             AND role IN ('user', 'assistant', 'summary')
             AND forgotten = 0
             AND content IS NOT NULL
             AND lower(content) LIKE lower(?)
           ORDER BY created_at DESC LIMIT ?""",
        (user_id, account_id, f"%{query}%", limit),
    ).fetchall()
    out = []
    for r in rows:
        snippet = (r["content"] or "")[:300]
        out.append({"id": r["id"], "role": r["role"], "snippet": snippet, "created_at": r["created_at"]})
    return {"matches": out, "count": len(out), "query": query}


def _exec_check_profile_divergence(*, user_id, account_id, args, conn=None) -> dict:
    """Compare claimed risk-per-trade in profile vs actual recent trades.
    Surfaces drift Compass might want to flag."""
    c = conn or get_connection()
    days = int(args.get("days", 30))
    settings = accounts_service.get_account_settings(user_id, account_id, conn=c) or {}
    claimed_risk_pct = settings.get("maxRiskPerTradePct")
    account_size = float(settings.get("accountSize") or 0)
    divergences = []
    if claimed_risk_pct is not None and account_size > 0:
        start, end = _trades_range_to_iso(days)
        trades = coach_data_assembler._trades_in_range(c, user_id, account_id, start, end)
        actual_risk_pcts = []
        for t in trades:
            shares = float(t.get("shares") or 0)
            entry = float(t.get("entry_price") or 0)
            stop = float(t.get("original_stop") or 0)
            if shares <= 0 or entry <= 0 or stop <= 0:
                continue
            actual = (shares * abs(entry - stop) / account_size) * 100.0
            actual_risk_pcts.append(actual)
        if actual_risk_pcts:
            avg_actual = sum(actual_risk_pcts) / len(actual_risk_pcts)
            if avg_actual > float(claimed_risk_pct) * 1.3:
                divergences.append({
                    "field": "risk_per_trade",
                    "claimed": float(claimed_risk_pct),
                    "actual_avg": round(avg_actual, 2),
                    "n_trades": len(actual_risk_pcts),
                    "note": f"Profile says {claimed_risk_pct}% risk per trade; last {len(actual_risk_pcts)} trades averaged {avg_actual:.1f}%.",
                })
    return {"divergences": divergences, "checked_days": days}


# ── Action tools (preview + execute halves) ──────────────────────────────────


def _tag_trade_preview(*, user_id, account_id, args, conn=None) -> dict:
    trade_id = args.get("trade_id")
    mistake = args.get("mistake_tags") or []
    emotion = args.get("emotion_tags") or []
    row = (conn or get_connection()).execute(
        "SELECT symbol, exit_date FROM j2_trades WHERE id = ? AND user_id = ?",
        (trade_id, user_id),
    ).fetchone()
    if row is None:
        return {"narration": f"Trade {trade_id} not found.", "contextual_warnings": [],
                "confirm_label": "Confirm", "elevated": False, "error": "not_found"}
    pieces = []
    if mistake:
        pieces.append(f"mistake tags {mistake}")
    if emotion:
        pieces.append(f"emotion tags {emotion}")
    parts = " and ".join(pieces) or "tags"
    return {
        "narration": f"Add {parts} to your {row['symbol']} trade from {row['exit_date'][:10]}.",
        "contextual_warnings": [], "confirm_label": "Confirm", "elevated": False,
    }


def _tag_trade_execute(*, user_id, account_id, args, conn=None) -> dict:
    trade_id = args.get("trade_id")
    mistake = args.get("mistake_tags") or []
    emotion = args.get("emotion_tags") or []
    c = conn or get_connection()
    row = c.execute(
        "SELECT mistake_tags, emotion_tags FROM j2_trades WHERE id = ? AND user_id = ?",
        (trade_id, user_id),
    ).fetchone()
    if row is None:
        return {"ok": False, "error": "trade not found"}
    try:
        existing_m = json.loads(row["mistake_tags"] or "[]")
    except (TypeError, json.JSONDecodeError):
        existing_m = []
    try:
        existing_e = json.loads(row["emotion_tags"] or "[]")
    except (TypeError, json.JSONDecodeError):
        existing_e = []
    new_m = list(dict.fromkeys(existing_m + mistake))
    new_e = list(dict.fromkeys(existing_e + emotion))
    c.execute(
        "UPDATE j2_trades SET mistake_tags = ?, emotion_tags = ? WHERE id = ? AND user_id = ?",
        (json.dumps(new_m), json.dumps(new_e), trade_id, user_id),
    )
    c.commit()
    return {"ok": True, "summary": "Tags added."}


def _set_weekly_focus_preview(*, user_id, account_id, args, conn=None) -> dict:
    return {"narration": f"Set this week's focus to: \"{args.get('text', '')}\"",
            "contextual_warnings": [], "confirm_label": "Set focus", "elevated": False}


def _set_weekly_focus_execute(*, user_id, account_id, args, conn=None) -> dict:
    text = (args.get("text") or "")[:500]
    c = conn or get_connection()
    row = c.execute(
        """SELECT id, metadata FROM j2_coach_outputs
           WHERE user_id = ? AND account_id = ? AND output_type = 'weekly_review'
           ORDER BY created_at DESC LIMIT 1""",
        (user_id, account_id),
    ).fetchone()
    now_iso = datetime.now(timezone.utc).isoformat()
    if row is None:
        import uuid as _uuid
        review_id = str(_uuid.uuid4())
        meta = {"week_start": datetime.now(timezone.utc).date().isoformat(),
                "this_weeks_focus": text, "key_observations": []}
        c.execute(
            """INSERT INTO j2_coach_outputs
               (id, user_id, account_id, output_type, body, summary, metadata, forgotten, created_at)
               VALUES (?, ?, ?, 'weekly_review', '', '', ?, 0, ?)""",
            (review_id, user_id, account_id, json.dumps(meta), now_iso),
        )
    else:
        try:
            meta = json.loads(row["metadata"] or "{}")
        except (TypeError, json.JSONDecodeError):
            meta = {}
        meta["this_weeks_focus"] = text
        c.execute(
            "UPDATE j2_coach_outputs SET metadata = ? WHERE id = ?",
            (json.dumps(meta), row["id"]),
        )
    c.commit()
    return {"ok": True, "summary": "Focus set."}


def _mute_setup_preview(*, user_id, account_id, args, conn=None) -> dict:
    setup = args.get("setup_name")
    until = args.get("until_date") or (date.today() + timedelta(days=14)).isoformat()
    return {"narration": f"Mute {setup} until {until}. Pre-trade verdict will reject entries on this setup until then.",
            "contextual_warnings": [], "confirm_label": "Mute setup", "elevated": False,
            "resolved_args": {"setup_name": setup, "until_date": until}}


def _mute_setup_execute(*, user_id, account_id, args, conn=None) -> dict:
    if is_unified(account_id):
        return _UNIFIED_REJECT
    setup = args.get("setup_name")
    until = args.get("until_date") or (date.today() + timedelta(days=14)).isoformat()
    c = conn or get_connection()
    row = c.execute("SELECT muted_setups FROM j2_accounts WHERE id = ? AND user_id = ?",
                    (account_id, user_id)).fetchone()
    try:
        current = json.loads(row["muted_setups"]) if row else []
    except (TypeError, json.JSONDecodeError):
        current = []
    current = [m for m in current if m.get("setup_name") != setup]
    current.append({"setup_name": setup, "until_date": until})
    c.execute("UPDATE j2_accounts SET muted_setups = ? WHERE id = ? AND user_id = ?",
              (json.dumps(current), account_id, user_id))
    c.commit()
    return {"ok": True, "summary": f"Muted {setup} until {until}."}


def _unmute_setup_preview(*, user_id, account_id, args, conn=None) -> dict:
    return {"narration": f"Unmute {args.get('setup_name')}.",
            "contextual_warnings": [], "confirm_label": "Unmute", "elevated": False}


def _unmute_setup_execute(*, user_id, account_id, args, conn=None) -> dict:
    if is_unified(account_id):
        return _UNIFIED_REJECT
    setup = args.get("setup_name")
    c = conn or get_connection()
    row = c.execute("SELECT muted_setups FROM j2_accounts WHERE id = ? AND user_id = ?",
                    (account_id, user_id)).fetchone()
    try:
        current = json.loads(row["muted_setups"]) if row else []
    except (TypeError, json.JSONDecodeError):
        current = []
    current = [m for m in current if m.get("setup_name") != setup]
    c.execute("UPDATE j2_accounts SET muted_setups = ? WHERE id = ? AND user_id = ?",
              (json.dumps(current), account_id, user_id))
    c.commit()
    return {"ok": True, "summary": f"Unmuted {setup}."}


def _set_a_plus_setups_preview(*, user_id, account_id, args, conn=None) -> dict:
    add = args.get("add") or []
    remove = args.get("remove") or []
    return {"narration": f"Update A+ setups — add {add}, remove {remove}.",
            "contextual_warnings": [], "confirm_label": "Update A+ list", "elevated": False}


def _set_a_plus_setups_execute(*, user_id, account_id, args, conn=None) -> dict:
    if is_unified(account_id):
        return _UNIFIED_REJECT
    add = args.get("add") or []
    remove = args.get("remove") or []
    c = conn or get_connection()
    row = c.execute("SELECT a_plus_setups FROM j2_accounts WHERE id = ? AND user_id = ?",
                    (account_id, user_id)).fetchone()
    try:
        current = json.loads(row["a_plus_setups"]) if row else []
    except (TypeError, json.JSONDecodeError):
        current = []
    for s in add:
        if s not in current:
            current.append(s)
    current = [s for s in current if s not in remove]
    c.execute("UPDATE j2_accounts SET a_plus_setups = ? WHERE id = ? AND user_id = ?",
              (json.dumps(current), account_id, user_id))
    c.commit()
    return {"ok": True, "summary": "A+ list updated."}


# Mapping from camelCase API field → snake_case j2_accounts column
_DISCIPLINE_FIELD_MAP = {
    "maxRiskPerTradePct": "max_risk_per_trade_pct",
    "dailyLossLimitPct": "daily_loss_limit_pct",
    "coolingOffMinutesAfterLoss": "cooling_off_minutes_after_loss",
    "aPlusRiskMultiplier": "a_plus_risk_multiplier",
}


def _update_discipline_setting_preview(*, user_id, account_id, args, conn=None) -> dict:
    field = args.get("field")
    new_value = args.get("value")
    settings = accounts_service.get_account_settings(user_id, account_id, conn=conn) or {}
    current = settings.get(field)
    warnings: list[str] = []
    loosening = False
    if field in {"maxRiskPerTradePct", "dailyLossLimitPct"} and current is not None and new_value > current:
        loosening = True
    if field == "coolingOffMinutesAfterLoss" and current is not None and new_value < current:
        loosening = True
    if loosening:
        breach_count = _count_recent_breaches(conn or get_connection(), user_id, account_id, field, current, 30)
        if breach_count > 0:
            warnings.append(f"You've breached the current {field}={current} {breach_count} times in the last 30 days.")
        warnings.append(f"This change weakens the guardrail from {current} to {new_value}.")
    confirm_label = (
        "Yes, raise the cap" if (field == "maxRiskPerTradePct" and loosening) else
        "Yes, raise the loss limit" if (field == "dailyLossLimitPct" and loosening) else
        "Yes, change it" if loosening else
        f"Set {field}"
    )
    return {
        "narration": f"Change {field} from {current} to {new_value}.",
        "contextual_warnings": warnings,
        "confirm_label": confirm_label,
        "elevated": loosening,
    }


def _count_recent_breaches(conn, user_id, account_id, field, current_value, days) -> int:
    if current_value is None or field != "maxRiskPerTradePct":
        return 0
    start, end = _trades_range_to_iso(days)
    trades = coach_data_assembler._trades_in_range(conn, user_id, account_id, start, end)
    settings = accounts_service.get_account_settings(user_id, account_id, conn=conn) or {}
    account_size = float(settings.get("accountSize") or 0)
    if account_size <= 0:
        return 0
    count = 0
    for t in trades:
        shares = float(t.get("shares") or 0)
        entry = float(t.get("entry_price") or 0)
        stop = float(t.get("original_stop") or 0)
        if shares <= 0 or entry <= 0 or stop <= 0:
            continue
        risk_pct = (shares * abs(entry - stop) / account_size) * 100.0
        if risk_pct > float(current_value):
            count += 1
    return count


def _update_discipline_setting_execute(*, user_id, account_id, args, conn=None) -> dict:
    field = args.get("field")
    value = args.get("value")
    if is_unified(account_id):
        return _UNIFIED_REJECT
    if field not in _DISCIPLINE_FIELD_MAP:
        return {"ok": False, "error": f"field must be one of {sorted(_DISCIPLINE_FIELD_MAP.keys())}"}
    column = _DISCIPLINE_FIELD_MAP[field]
    c = conn or get_connection()
    c.execute(f"UPDATE j2_accounts SET {column} = ? WHERE id = ? AND user_id = ?",
              (value, account_id, user_id))
    c.commit()
    return {"ok": True, "summary": f"{field} set to {value}."}


def _schedule_paper_only_day_preview(*, user_id, account_id, args, conn=None) -> dict:
    return {"narration": f"Mark {args.get('date')} as paper-only.",
            "contextual_warnings": [], "confirm_label": "Schedule paper day", "elevated": False}


def _schedule_paper_only_day_execute(*, user_id, account_id, args, conn=None) -> dict:
    if is_unified(account_id):
        return _UNIFIED_REJECT
    d = args.get("date")
    c = conn or get_connection()
    row = c.execute("SELECT paper_only_days FROM j2_accounts WHERE id = ? AND user_id = ?",
                    (account_id, user_id)).fetchone()
    try:
        current = json.loads(row["paper_only_days"]) if row else []
    except (TypeError, json.JSONDecodeError):
        current = []
    current = [x for x in current if x.get("date") != d]
    current.append({"date": d, "reason": "compass_chat"})
    c.execute("UPDATE j2_accounts SET paper_only_days = ? WHERE id = ? AND user_id = ?",
              (json.dumps(current), account_id, user_id))
    c.commit()
    return {"ok": True, "summary": f"Marked {d} paper-only."}


# ── Pattern Engine bridge (text mode) ────────────────────────────────────────
# Read access to the 50-detector pattern engine. Same logic as the voice
# tools in voice_tool_impls.py (the bridge ones); duplicated here because
# the Compass Chat text path uses its own tool catalog. Detection runs on
# the background universe-scan job; these tools just query the fresh
# pattern_detections table.


def _pattern_pe_load() -> None:
    try:
        import api.routers.patterns  # noqa: F401
    except Exception:  # noqa: BLE001
        pass


def _pattern_name(pid: str) -> str:
    try:
        from api.routers.patterns import _PATTERN_METADATA
        return _PATTERN_METADATA.get(pid, {}).get(
            "name", pid.replace("_", " ").title())
    except Exception:
        return pid.replace("_", " ").title()


def _exec_find_patterns_on_ticker(*, user_id, account_id, args, conn=None) -> dict:
    _pattern_pe_load()
    sym = (args.get("symbol") or "").strip().upper()
    if not sym:
        return {"ok": False, "error": "symbol required"}
    tf = (args.get("tf") or "D").strip().upper()
    min_conf = float(args.get("min_conf") or 50)
    min_conf = max(0.0, min(100.0, min_conf))
    try:
        from api.services.pattern_engine import memory as _pe_memory
        rows = _pe_memory.get_active_detections(sym=sym, tf=tf, min_conf=min_conf)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}
    top = sorted(rows, key=lambda r: r.get("confidence") or 0, reverse=True)[:5]
    return {"ok": True, "symbol": sym, "tf": tf, "count": len(rows),
            "detections": [{
                "id": r.get("id"), "pattern_id": r.get("pattern_id"),
                "pattern_name": _pattern_name(r.get("pattern_id") or ""),
                "confidence": r.get("confidence"), "direction": r.get("direction"),
                "status": r.get("status"), "levels": r.get("levels") or {},
                "detected_at": r.get("detected_at"),
            } for r in top]}


def _exec_scan_active_patterns(*, user_id, account_id, args, conn=None) -> dict:
    _pattern_pe_load()
    import time as _t, json as _j
    pattern_ids = [t.strip() for t in (args.get("types") or "").split(",") if t.strip()] or None
    tf = (args.get("tf") or "D").strip().upper()
    min_conf = max(50.0, min(100.0, float(args.get("min_conf") or 70)))
    cat = (args.get("category") or "").strip().lower() or None
    cap = max(1, min(200, int(args.get("limit") or 20)))
    recent_cutoff = int(_t.time()) - 7 * 24 * 60 * 60

    c = conn or get_connection()
    sql = """SELECT id, sym, tf, pattern_id, category, direction, confidence,
                    status, levels_json, detected_at
               FROM pattern_detections
              WHERE tf = ? AND status IN ('forming','ready','triggered')
                AND confidence >= ? AND detected_at >= ?"""
    params: list = [tf, min_conf, recent_cutoff]
    if pattern_ids:
        sql += f" AND pattern_id IN ({','.join('?' * len(pattern_ids))})"
        params.extend(pattern_ids)
    if cat:
        sql += " AND category = ?"
        params.append(cat)
    sql += " ORDER BY detected_at DESC, confidence DESC LIMIT ?"
    params.append(cap)
    rows = c.execute(sql, params).fetchall()
    out = []
    for r in rows:
        try:
            lvls = _j.loads(r["levels_json"] or "{}")
        except Exception:
            lvls = {}
        out.append({
            "id": r["id"], "sym": r["sym"], "tf": r["tf"],
            "pattern_id": r["pattern_id"],
            "pattern_name": _pattern_name(r["pattern_id"]),
            "category": r["category"], "direction": r["direction"],
            "confidence": r["confidence"], "status": r["status"],
            "levels": {"entry": lvls.get("entry"), "stop": lvls.get("stop"),
                       "target": lvls.get("target_primary")},
            "detected_at": r["detected_at"],
        })
    return {"ok": True, "count": len(out), "detections": out,
            "filters": {"types": pattern_ids, "tf": tf, "min_conf": min_conf,
                        "category": cat, "limit": cap}}


def _exec_list_pattern_types(*, user_id, account_id, args, conn=None) -> dict:
    _pattern_pe_load()
    cat = (args.get("category") or "").strip().lower() or None
    try:
        from api.services.pattern_engine.detectors.registry import list_pattern_ids
        from api.routers.patterns import _PATTERN_METADATA
        ids = list_pattern_ids()
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}
    items = []
    for pid in ids:
        meta = _PATTERN_METADATA.get(pid, {})
        item_cat = (meta.get("category") or "uncategorized").lower()
        if cat and item_cat != cat:
            continue
        items.append({
            "id": pid,
            "name": meta.get("name", pid.replace("_", " ").title()),
            "category": item_cat,
            "direction": (meta.get("direction") or "neutral").lower(),
        })
    by_cat: dict[str, int] = {}
    for it in items:
        by_cat[it["category"]] = by_cat.get(it["category"], 0) + 1
    return {"ok": True, "count": len(items), "patterns": items,
            "by_category": by_cat}


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

TOOLS.update({
    "analyze_time_of_day": {
        "name": "analyze_time_of_day",
        "description": "Bucket trades by hour-of-entry (ET) and return per-hour win rate and R.",
        "requires_confirm": False,
        "executor": _exec_analyze_time_of_day,
        "input_schema": {
            "type": "object",
            "properties": {
                "setup": {"type": "string"},
                "symbol": {"type": "string"},
                "days": {"type": "integer", "default": 180, "minimum": 7, "maximum": 730},
            },
        },
    },
    "analyze_day_of_week": {
        "name": "analyze_day_of_week",
        "description": "Bucket trades by weekday (Mon–Sun) and return per-day win rate and R.",
        "requires_confirm": False,
        "executor": _exec_analyze_day_of_week,
        "input_schema": {
            "type": "object",
            "properties": {
                "setup": {"type": "string"},
                "days": {"type": "integer", "default": 180, "minimum": 7, "maximum": 730},
            },
        },
    },
    "analyze_hold_duration": {
        "name": "analyze_hold_duration",
        "description": "Compare winners' vs losers' hold durations — surfaces cutting-winners-short or holding-losers patterns.",
        "requires_confirm": False,
        "executor": _exec_analyze_hold_duration,
        "input_schema": {
            "type": "object",
            "properties": {
                "setup": {"type": "string"},
                "days": {"type": "integer", "default": 180, "minimum": 7, "maximum": 730},
            },
        },
    },
    "analyze_sequence": {
        "name": "analyze_sequence",
        "description": "Aggregate the N trades that follow each Win (or Loss) — reveals revenge-trading or overconfidence patterns.",
        "requires_confirm": False,
        "executor": _exec_analyze_sequence,
        "input_schema": {
            "type": "object",
            "properties": {
                "prior_outcome": {"type": "string", "enum": ["Win", "Loss"]},
                "n": {"type": "integer", "default": 3, "minimum": 1, "maximum": 10},
                "days": {"type": "integer", "default": 180},
            },
            "required": ["prior_outcome"],
        },
    },
    "analyze_sizing_curve": {
        "name": "analyze_sizing_curve",
        "description": "Bucket trades by per-trade risk % and return P&L by bucket. Reveals optimal position-size band.",
        "requires_confirm": False,
        "executor": _exec_analyze_sizing_curve,
        "input_schema": {
            "type": "object",
            "properties": {"days": {"type": "integer", "default": 180}},
        },
    },
    "analyze_correlation": {
        "name": "analyze_correlation",
        "description": "Inspect open-position correlations (sector / theme overlap). v1 returns counts only.",
        "requires_confirm": False,
        "executor": _exec_analyze_correlation,
        "input_schema": {"type": "object", "properties": {}},
    },
    "compare_setups": {
        "name": "compare_setups",
        "description": "Side-by-side stats for two named setups.",
        "requires_confirm": False,
        "executor": _exec_compare_setups,
        "input_schema": {
            "type": "object",
            "properties": {
                "setup_a": {"type": "string"},
                "setup_b": {"type": "string"},
                "days": {"type": "integer", "default": 180},
            },
            "required": ["setup_a", "setup_b"],
        },
    },
})

# ── Onboarding tools ────────────────────────────────────────────────────────


_ONBOARDING_CATEGORIES = (
    "identity", "account", "style", "setups", "sizing",
    "strengths", "weaknesses", "psychology", "process", "goals",
)


def _get_current_session_id(conn, user_id: str, account_id: str) -> str | None:
    row = conn.execute(
        "SELECT onboarding_session_id FROM j2_accounts WHERE id = ? AND user_id = ?",
        (account_id, user_id),
    ).fetchone()
    if row is None:
        return None
    return row["onboarding_session_id"]


def _exec_get_onboarding_progress(*, user_id, account_id, args, conn=None) -> dict:
    c = conn or get_connection()
    sid = _get_current_session_id(c, user_id, account_id)
    if sid is None:
        return {
            "session_id": None,
            "started_at": None,
            "questions_asked": 0,
            "categories_covered": [],
            "categories_remaining": list(_ONBOARDING_CATEGORIES),
        }
    rows = c.execute(
        """SELECT category, asked_at FROM j2_onboarding_responses
           WHERE user_id = ? AND account_id = ? AND session_id = ?
           ORDER BY asked_at ASC""",
        (user_id, account_id, sid),
    ).fetchall()
    covered: list[str] = []
    seen: set[str] = set()
    for r in rows:
        if r["category"] not in seen:
            seen.add(r["category"])
            covered.append(r["category"])
    remaining = [cat for cat in _ONBOARDING_CATEGORIES if cat not in seen]
    started_at = rows[0]["asked_at"] if rows else None
    return {
        "session_id": sid,
        "started_at": started_at,
        "questions_asked": len(rows),
        "categories_covered": covered,
        "categories_remaining": remaining,
    }


def _exec_record_onboarding_answer(*, user_id, account_id, args, conn=None) -> dict:
    import uuid as _uuid
    category = args.get("category")
    question = (args.get("question") or "").strip()
    answer = (args.get("answer") or "").strip()
    if category not in _ONBOARDING_CATEGORIES:
        return {"ok": False, "error": f"unknown category: {category}"}
    if not question or not answer:
        return {"ok": False, "error": "question and answer required"}
    c = conn or get_connection()
    sid = _get_current_session_id(c, user_id, account_id)
    if sid is None:
        return {"ok": False, "error": "no active onboarding session"}
    c.execute(
        """INSERT INTO j2_onboarding_responses
           (id, user_id, account_id, session_id, category, question, answer, asked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (str(_uuid.uuid4()), user_id, account_id, sid, category,
         question, answer, datetime.now(timezone.utc).isoformat()),
    )
    c.commit()
    return {"ok": True, "summary": f"Logged {category} answer."}


TOOLS.update({
    "get_onboarding_progress": {
        "name": "get_onboarding_progress",
        "description": "Returns which onboarding categories have been answered in the current session and how many questions have been asked.",
        "requires_confirm": False,
        "executor": _exec_get_onboarding_progress,
        "input_schema": {"type": "object", "properties": {}},
    },
    "record_onboarding_answer": {
        "name": "record_onboarding_answer",
        "description": "Record a question + the trader's answer to the onboarding archive. Silent write — does NOT require user confirmation. Call this after each substantive answer.",
        "requires_confirm": False,
        "executor": _exec_record_onboarding_answer,
        "input_schema": {
            "type": "object",
            "properties": {
                "category": {"type": "string", "enum": list(_ONBOARDING_CATEGORIES)},
                "question": {"type": "string"},
                "answer": {"type": "string"},
            },
            "required": ["category", "question", "answer"],
        },
    },
})

TOOLS.update({
    "tag_trade": {
        "name": "tag_trade",
        "description": "Append mistake and/or emotion tags to a closed trade. Requires the trade id.",
        "requires_confirm": True,
        "executor": _tag_trade_execute, "preview": _tag_trade_preview,
        "input_schema": {
            "type": "object",
            "properties": {
                "trade_id": {"type": "string"},
                "mistake_tags": {"type": "array", "items": {"type": "string"}},
                "emotion_tags": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["trade_id"],
        },
    },
    "set_weekly_focus": {
        "name": "set_weekly_focus",
        "description": "Set this week's focus — a short directive the next Weekly Review reads back.",
        "requires_confirm": True,
        "executor": _set_weekly_focus_execute, "preview": _set_weekly_focus_preview,
        "input_schema": {
            "type": "object",
            "properties": {"text": {"type": "string", "maxLength": 500}},
            "required": ["text"],
        },
    },
    "mute_setup": {
        "name": "mute_setup",
        "description": "Mute a setup for a period — Pre-Trade Verdict will reject entries.",
        "requires_confirm": True,
        "executor": _mute_setup_execute, "preview": _mute_setup_preview,
        "input_schema": {
            "type": "object",
            "properties": {
                "setup_name": {"type": "string"},
                "until_date": {"type": "string", "format": "date"},
            },
            "required": ["setup_name"],
        },
    },
    "unmute_setup": {
        "name": "unmute_setup",
        "description": "Remove a setup from the muted list.",
        "requires_confirm": True,
        "executor": _unmute_setup_execute, "preview": _unmute_setup_preview,
        "input_schema": {
            "type": "object",
            "properties": {"setup_name": {"type": "string"}},
            "required": ["setup_name"],
        },
    },
    "set_a_plus_setups": {
        "name": "set_a_plus_setups",
        "description": "Add or remove setups from the A+ whitelist.",
        "requires_confirm": True,
        "executor": _set_a_plus_setups_execute, "preview": _set_a_plus_setups_preview,
        "input_schema": {
            "type": "object",
            "properties": {
                "add": {"type": "array", "items": {"type": "string"}},
                "remove": {"type": "array", "items": {"type": "string"}},
            },
        },
    },
    "update_discipline_setting": {
        "name": "update_discipline_setting",
        "description": "Update one of: maxRiskPerTradePct, dailyLossLimitPct, coolingOffMinutesAfterLoss, aPlusRiskMultiplier. Loosening triggers elevated warning with breach data.",
        "requires_confirm": True,
        "executor": _update_discipline_setting_execute, "preview": _update_discipline_setting_preview,
        "input_schema": {
            "type": "object",
            "properties": {
                "field": {"type": "string", "enum": ["maxRiskPerTradePct", "dailyLossLimitPct", "coolingOffMinutesAfterLoss", "aPlusRiskMultiplier"]},
                "value": {"type": "number"},
            },
            "required": ["field", "value"],
        },
    },
    "schedule_paper_only_day": {
        "name": "schedule_paper_only_day",
        "description": "Mark a date as paper-only. Pre-Trade Verdict will reject live entries on that day.",
        "requires_confirm": True,
        "executor": _schedule_paper_only_day_execute, "preview": _schedule_paper_only_day_preview,
        "input_schema": {
            "type": "object",
            "properties": {"date": {"type": "string", "format": "date"}},
            "required": ["date"],
        },
    },
})


def _propose_account_settings_preview(*, user_id, account_id, args, conn=None) -> dict:
    pieces = []
    if "maxRiskPerTradePct" in args and args["maxRiskPerTradePct"] is not None:
        pieces.append(f"max risk per trade {args['maxRiskPerTradePct']}%")
    if "dailyLossLimitPct" in args and args["dailyLossLimitPct"] is not None:
        pieces.append(f"daily loss limit {args['dailyLossLimitPct']}%")
    if "coolingOffMinutesAfterLoss" in args and args["coolingOffMinutesAfterLoss"] is not None:
        pieces.append(f"cooling-off {args['coolingOffMinutesAfterLoss']} min after each loss")
    if args.get("aPlusSetups"):
        pieces.append("A+ setups: " + ", ".join(args["aPlusSetups"]))
    if not pieces:
        return {"narration": "No settings to update.", "contextual_warnings": [],
                "confirm_label": "Confirm", "elevated": False}
    return {
        "narration": "Set " + "; ".join(pieces) + ".",
        "contextual_warnings": [], "confirm_label": "Apply settings", "elevated": False,
    }


def _propose_account_settings_execute(*, user_id, account_id, args, conn=None) -> dict:
    if is_unified(account_id):
        return _UNIFIED_REJECT
    c = conn or get_connection()
    field_map = {
        "maxRiskPerTradePct": "max_risk_per_trade_pct",
        "dailyLossLimitPct": "daily_loss_limit_pct",
        "coolingOffMinutesAfterLoss": "cooling_off_minutes_after_loss",
    }
    updates = []
    values: list = []
    for camel, snake in field_map.items():
        if camel in args and args[camel] is not None:
            updates.append(f"{snake} = ?")
            values.append(args[camel])
    if args.get("aPlusSetups"):
        updates.append("a_plus_setups = ?")
        values.append(json.dumps(args["aPlusSetups"]))
    if not updates:
        return {"ok": False, "error": "no fields supplied"}
    values.extend([account_id, user_id])
    c.execute(
        f"UPDATE j2_accounts SET {', '.join(updates)} WHERE id = ? AND user_id = ?",
        values,
    )
    c.commit()
    return {"ok": True, "summary": f"Updated {len(updates)} setting(s)."}


def _complete_onboarding_preview(*, user_id, account_id, args, conn=None) -> dict:
    profile = args.get("trader_profile") or ""
    focus = args.get("this_weeks_focus") or ""
    excerpt = profile[:200] + ("..." if len(profile) > 200 else "")
    bits = [f"Save your trader profile ({len(profile)} chars)."]
    if focus:
        bits.append(f"Set this week's focus to: \"{focus}\"")
    return {
        "narration": " ".join(bits),
        "contextual_warnings": [],
        "confirm_label": "Save profile",
        "elevated": False,
        "profile_excerpt": excerpt,
    }


def _complete_onboarding_execute(*, user_id, account_id, args, conn=None) -> dict:
    profile = args.get("trader_profile") or ""
    focus = (args.get("this_weeks_focus") or "").strip()
    if not profile.strip():
        return {"ok": False, "error": "trader_profile is required"}
    c = conn or get_connection()
    if is_unified(account_id):
        from api.services.journal_two import unified_coach
        unified_coach.update_state(
            c, user_id,
            trader_profile=profile, onboarded=True, onboarding_mode=False,
        )
    else:
        c.execute(
            """UPDATE j2_accounts
               SET trader_profile = ?, onboarded = 1, onboarding_mode = 0
               WHERE id = ? AND user_id = ?""",
            (profile, account_id, user_id),
        )
    if focus:
        # Reuse the existing set_weekly_focus executor for consistency.
        _set_weekly_focus_execute(user_id=user_id, account_id=account_id,
                                  args={"text": focus}, conn=c)
    c.commit()
    return {"ok": True, "summary": "Onboarding complete. Profile saved."}


TOOLS.update({
    "get_trade_by_id": {
        "name": "get_trade_by_id",
        "description": "Fetch one specific trade by its id. Use this when the user references a specific trade or you want full details after listing.",
        "requires_confirm": False,
        "executor": _exec_get_trade_by_id,
        "input_schema": {
            "type": "object",
            "properties": {"trade_id": {"type": "string"}},
            "required": ["trade_id"],
        },
    },
    "record_trade_lesson": {
        "name": "record_trade_lesson",
        "description": "Append a coaching lesson to a specific trade's notes field. Use this when the user wants to capture an insight about a specific trade for future review.",
        "requires_confirm": True,
        "executor": _record_trade_lesson_execute,
        "preview": _record_trade_lesson_preview,
        "input_schema": {
            "type": "object",
            "properties": {
                "trade_id": {"type": "string"},
                "lesson": {"type": "string", "maxLength": 1000},
            },
            "required": ["trade_id", "lesson"],
        },
    },
    "search_conversation": {
        "name": "search_conversation",
        "description": "Search your past chat messages for keywords. Useful when the user asks 'what did we discuss about X last week' or you need to recall an earlier commitment.",
        "requires_confirm": False,
        "executor": _exec_search_conversation,
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "limit": {"type": "integer", "default": 10, "maximum": 50},
            },
            "required": ["query"],
        },
    },
    "check_profile_divergence": {
        "name": "check_profile_divergence",
        "description": "Compare what the trader's profile claims about their style/rules vs what their actual recent trades show. Surfaces drift Compass should flag to the trader.",
        "requires_confirm": False,
        "executor": _exec_check_profile_divergence,
        "input_schema": {
            "type": "object",
            "properties": {"days": {"type": "integer", "default": 30, "minimum": 7, "maximum": 180}},
        },
    },
})

def _exec_list_pending_profile_suggestions(*, user_id, account_id, args, conn=None) -> dict:
    from api.services.journal_two import profile_suggestions as ps
    return ps.list_pending(user_id=user_id, account_id=account_id, conn=conn)


def _update_trader_profile_preview(*, user_id, account_id, args, conn=None) -> dict:
    new_profile = (args.get("trader_profile") or "")[:8000]
    return {
        "narration": f"Update your Trader Profile with a refinement ({len(new_profile)} chars).",
        "contextual_warnings": [], "confirm_label": "Save refinement", "elevated": False,
        "profile_excerpt": new_profile[:300] + ("…" if len(new_profile) > 300 else ""),
    }


def _update_trader_profile_execute(*, user_id, account_id, args, conn=None) -> dict:
    new_profile = (args.get("trader_profile") or "").strip()
    if not new_profile:
        return {"ok": False, "error": "trader_profile required"}
    c = conn or get_connection()
    if is_unified(account_id):
        from api.services.journal_two import unified_coach
        unified_coach.update_state(c, user_id, trader_profile=new_profile)
        return {"ok": True, "summary": "Unified trader profile updated."}
    c.execute(
        "UPDATE j2_accounts SET trader_profile = ? WHERE id = ? AND user_id = ?",
        (new_profile, account_id, user_id),
    )
    c.commit()
    return {"ok": True, "summary": "Trader profile updated."}


def _resolve_profile_suggestion_preview(*, user_id, account_id, args, conn=None) -> dict:
    return {
        "narration": "Mark this profile suggestion as resolved (no further action needed).",
        "contextual_warnings": [], "confirm_label": "Mark resolved", "elevated": False,
    }


def _resolve_profile_suggestion_execute(*, user_id, account_id, args, conn=None) -> dict:
    sid = args.get("suggestion_id")
    if not sid:
        return {"ok": False, "error": "suggestion_id required"}
    from api.services.journal_two import profile_suggestions as ps
    n = ps.resolve_suggestion(sid, user_id=user_id, conn=conn)
    if n == 0:
        return {"ok": False, "error": "suggestion not found"}
    return {"ok": True, "summary": "Suggestion resolved."}


TOOLS.update({
    "list_pending_profile_suggestions": {
        "name": "list_pending_profile_suggestions",
        "description": "List pending profile-refinement suggestions auto-created when the trader marked a recap unhelpful. Use this at the start of a chat turn to see if there's accumulated feedback to address.",
        "requires_confirm": False,
        "executor": _exec_list_pending_profile_suggestions,
        "input_schema": {"type": "object", "properties": {}},
    },
    "update_trader_profile": {
        "name": "update_trader_profile",
        "description": "Save a refined Trader Profile. Use this AFTER the trader has confirmed the new profile content in chat. The user gets a Confirm card to review the change.",
        "requires_confirm": True,
        "executor": _update_trader_profile_execute,
        "preview": _update_trader_profile_preview,
        "input_schema": {
            "type": "object",
            "properties": {"trader_profile": {"type": "string"}},
            "required": ["trader_profile"],
        },
    },
    "resolve_profile_suggestion": {
        "name": "resolve_profile_suggestion",
        "description": "Mark a profile suggestion as resolved (used after Compass has discussed it with the trader and applied any update_trader_profile changes).",
        "requires_confirm": True,
        "executor": _resolve_profile_suggestion_execute,
        "preview": _resolve_profile_suggestion_preview,
        "input_schema": {
            "type": "object",
            "properties": {"suggestion_id": {"type": "string"}},
            "required": ["suggestion_id"],
        },
    },
})


def _exec_pre_trade_verdict(*, user_id, account_id, args, conn=None) -> dict:
    from api.services.journal_two import pre_trade_verdict as ptv
    return ptv.generate_verdict(
        user_id=user_id, account_id=account_id, params=args, conn=conn,
    )


TOOLS.update({
    "pre_trade_verdict": {
        "name": "pre_trade_verdict",
        "description": "Run a pre-trade verdict on a proposed trade. Returns GO/HOLD/SKIP + paragraph + factors. Use this when the trader asks 'can I take this trade?' or similar.",
        "requires_confirm": False,
        "executor": _exec_pre_trade_verdict,
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string"},
                "side": {"type": "string", "enum": ["Long", "Short"]},
                "shares": {"type": "number"},
                "entry_price": {"type": "number"},
                "stop_price": {"type": "number"},
                "target_price": {"type": "number"},
                "setup": {"type": "string"},
            },
            "required": ["symbol", "side", "shares", "entry_price", "stop_price"],
        },
    },
})

def _exec_check_active_interventions(*, user_id, account_id, args, conn=None) -> dict:
    from api.services.journal_two import interventions as iv
    return {"interventions": iv.evaluate_interventions(
        user_id=user_id, account_id=account_id, conn=conn,
    )}


TOOLS.update({
    "check_active_interventions": {
        "name": "check_active_interventions",
        "description": "Check which Compass intervention rules are currently active (e.g., rapid_fire_trading, daily_loss_approach, loss_streak, cooling_off_active). Use this at the start of a turn when the trader seems to be making decisions under pressure or asks 'should I take this?'.",
        "requires_confirm": False,
        "executor": _exec_check_active_interventions,
        "input_schema": {"type": "object", "properties": {}},
    },
})

TOOLS.update({
    "propose_account_settings": {
        "name": "propose_account_settings",
        "description": "Propose initial discipline settings (max risk, daily loss limit, cooling-off, A+ setups) inferred from interview answers. Trader sees a preview card; one Confirm applies all supplied fields atomically.",
        "requires_confirm": True,
        "executor": _propose_account_settings_execute,
        "preview": _propose_account_settings_preview,
        "input_schema": {
            "type": "object",
            "properties": {
                "maxRiskPerTradePct": {"type": "number"},
                "dailyLossLimitPct": {"type": "number"},
                "coolingOffMinutesAfterLoss": {"type": "integer"},
                "aPlusSetups": {"type": "array", "items": {"type": "string"}},
            },
        },
    },
    "complete_onboarding": {
        "name": "complete_onboarding",
        "description": "Finalize the onboarding interview. Writes the trader_profile markdown, sets onboarded=1, exits onboarding_mode, optionally seeds this_weeks_focus.",
        "requires_confirm": True,
        "executor": _complete_onboarding_execute,
        "preview": _complete_onboarding_preview,
        "input_schema": {
            "type": "object",
            "properties": {
                "trader_profile": {"type": "string"},
                "this_weeks_focus": {"type": "string"},
            },
            "required": ["trader_profile"],
        },
    },
    "find_patterns_on_ticker": {
        "name": "find_patterns_on_ticker",
        "description": "Active chart patterns currently detected on a single ticker (Bull Flag, VCP, High Tight Flag, Cup & Handle, candlestick reversals, etc.) with confidence, direction, status, and entry/stop/target levels. Use when the trader asks 'is NVDA in a bull flag?', 'what patterns on TSLA?', 'show me setups on AAPL'.",
        "requires_confirm": False,
        "executor": _exec_find_patterns_on_ticker,
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string", "description": "Ticker, e.g. NVDA."},
                "tf": {"type": "string", "description": "Timeframe: D, W, 60, 30, 15, 5. Default D."},
                "min_conf": {"type": "number", "description": "Minimum confidence 0-100. Default 50."},
            },
            "required": ["symbol"],
        },
    },
    "scan_active_patterns": {
        "name": "scan_active_patterns",
        "description": "Universe scan — what chart patterns have fired across the market in the last 7 days. Filter by pattern types, timeframe, confidence floor, or category (classical/candlestick/uct/structure). Use when the trader asks 'what flags fired today?', 'show me VCPs', 'any breakouts setting up?'.",
        "requires_confirm": False,
        "executor": _exec_scan_active_patterns,
        "input_schema": {
            "type": "object",
            "properties": {
                "types": {"type": "string", "description": "Comma-separated pattern_ids (e.g. 'bull_flag,vcp')."},
                "tf": {"type": "string", "description": "Timeframe. Default D."},
                "min_conf": {"type": "number", "description": "Minimum confidence 50-100. Default 70."},
                "category": {"type": "string", "enum": ["classical", "candlestick", "uct", "structure"]},
                "limit": {"type": "integer", "default": 20, "maximum": 200},
            },
        },
    },
    "list_pattern_types": {
        "name": "list_pattern_types",
        "description": "List the chart patterns the engine can detect (50 across classical, candlestick, UCT-specific, and structure categories). Use when the trader asks 'what patterns can you detect?', 'what does the engine know?'.",
        "requires_confirm": False,
        "executor": _exec_list_pattern_types,
        "input_schema": {
            "type": "object",
            "properties": {
                "category": {"type": "string", "enum": ["classical", "candlestick", "uct", "structure"]},
            },
        },
    },
})
