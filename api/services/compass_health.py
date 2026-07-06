"""Compass Health — weekly operator email (mentor-vision §7).

A once-a-week snapshot of how the live Compass mentor is doing, emailed to the
owner: chat volume, unique active users, the tool-failure rate (the #1 "is the
mentor lying / broken" signal), and the worst-offending tools. Read-only over
auth.db (both j2_chat_messages and voice_tool_calls live there). Never raises on
the request/scheduler path — a bad metric can't break the pod.

Flag-gated: only the scheduler send is gated (COMPASS_HEALTH_EMAIL_ENABLED); the
status endpoint + compute are always safe to call.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone

_log = logging.getLogger(__name__)

# SQLite CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" (space). Comparing against a
# Python .isoformat() ("...T...") string-compares wrong (space 0x20 < T 0x54) —
# the exact bug that silently disabled the awareness cooldown. Use space format.
_TS_FMT = "%Y-%m-%d %H:%M:%S"


def _cutoff(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).strftime(_TS_FMT)


def compute_health(conn, days: int = 7) -> dict:
    """Aggregate the week's Compass usage + tool health from auth.db.

    Returns {period_days, chat_turns, active_users, tool_calls, tool_failures,
    tool_failure_rate, avg_latency_ms, top_failing_tools:[{tool,failures}]}.
    """
    cutoff = _cutoff(days)
    out = {
        "period_days": days, "chat_turns": 0, "active_users": 0,
        "tool_calls": 0, "tool_failures": 0, "tool_failure_rate": 0.0,
        "avg_latency_ms": None, "top_failing_tools": [],
    }

    try:
        row = conn.execute(
            "SELECT COUNT(*) AS turns, COUNT(DISTINCT user_id) AS users "
            "FROM j2_chat_messages WHERE role = 'user' AND created_at >= ?",
            (cutoff,),
        ).fetchone()
        if row is not None:
            out["chat_turns"] = row["turns"] or 0
            out["active_users"] = row["users"] or 0
    except Exception as e:  # noqa: BLE001
        _log.warning("compass_health chat query failed: %s", e)

    try:
        row = conn.execute(
            "SELECT COUNT(*) AS calls, "
            "SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS fails, "
            "AVG(latency_ms) AS lat "
            "FROM voice_tool_calls WHERE created_at >= ?",
            (cutoff,),
        ).fetchone()
        if row is not None:
            calls = row["calls"] or 0
            fails = row["fails"] or 0
            out["tool_calls"] = calls
            out["tool_failures"] = fails
            out["tool_failure_rate"] = round(fails / calls, 4) if calls else 0.0
            out["avg_latency_ms"] = round(row["lat"], 1) if row["lat"] is not None else None
    except Exception as e:  # noqa: BLE001
        _log.warning("compass_health tool query failed: %s", e)

    try:
        rows = conn.execute(
            "SELECT tool_name, COUNT(*) AS fails FROM voice_tool_calls "
            "WHERE ok = 0 AND created_at >= ? "
            "GROUP BY tool_name ORDER BY fails DESC LIMIT 5",
            (cutoff,),
        ).fetchall()
        out["top_failing_tools"] = [
            {"tool": r["tool_name"], "failures": r["fails"]} for r in (rows or [])
        ]
    except Exception as e:  # noqa: BLE001
        _log.warning("compass_health top-fails query failed: %s", e)

    return out


def render_health_email(metrics: dict) -> tuple[str, str]:
    """(subject, html) for the weekly owner email. Pure, testable."""
    rate_pct = round((metrics.get("tool_failure_rate") or 0.0) * 100, 1)
    turns = metrics.get("chat_turns", 0)
    users = metrics.get("active_users", 0)
    calls = metrics.get("tool_calls", 0)
    fails = metrics.get("tool_failures", 0)
    lat = metrics.get("avg_latency_ms")
    days = metrics.get("period_days", 7)

    # a failing-tools list draws the eye only when something is actually failing
    fail_rows = "".join(
        f"<tr><td style='padding:2px 10px 2px 0'>{t['tool']}</td>"
        f"<td style='padding:2px 0;color:#b91c1c'>{t['failures']}</td></tr>"
        for t in metrics.get("top_failing_tools", [])
    )
    fail_block = (
        f"<h3 style='margin:16px 0 4px;font-size:13px;color:#b91c1c'>Top failing tools</h3>"
        f"<table style='font-size:13px'>{fail_rows}</table>"
        if fail_rows else
        "<p style='font-size:13px;color:#15803d;margin:12px 0'>No tool failures this period. ✓</p>"
    )
    rate_color = "#b91c1c" if rate_pct >= 5 else ("#b45309" if rate_pct >= 1 else "#15803d")
    lat_line = f"{lat} ms" if lat is not None else "—"

    subject = f"Compass Health — {turns} turns, {rate_pct}% tool-fail (last {days}d)"
    html = f"""
    <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#1a1a1a;max-width:520px">
      <h2 style="font-size:16px;margin:0 0 4px">🧭 Compass Health</h2>
      <p style="font-size:12px;color:#666;margin:0 0 14px">Last {days} days</p>
      <table style="font-size:14px;line-height:1.9">
        <tr><td style="color:#666;padding-right:16px">Chat turns</td><td><b>{turns}</b></td></tr>
        <tr><td style="color:#666;padding-right:16px">Active users</td><td><b>{users}</b></td></tr>
        <tr><td style="color:#666;padding-right:16px">Tool calls</td><td><b>{calls}</b></td></tr>
        <tr><td style="color:#666;padding-right:16px">Tool failures</td><td><b>{fails}</b></td></tr>
        <tr><td style="color:#666;padding-right:16px">Tool-failure rate</td>
            <td><b style="color:{rate_color}">{rate_pct}%</b></td></tr>
        <tr><td style="color:#666;padding-right:16px">Avg tool latency</td><td><b>{lat_line}</b></td></tr>
      </table>
      {fail_block}
      <p style="font-size:11px;color:#999;margin-top:18px">
        Automated weekly digest · UCT Intelligence · reply-to owner inbox</p>
    </div>
    """
    return subject, html


def _recipients() -> list[str]:
    raw = os.environ.get("COMPASS_HEALTH_EMAIL_TO") or os.environ.get("ADMIN_EMAILS") or ""
    return [e.strip() for e in raw.split(",") if e.strip()]


def send_weekly_health_email(days: int = 7) -> dict:
    """Compute + render + send. Best-effort; never raises. Gated by
    COMPASS_HEALTH_EMAIL_ENABLED at the scheduler; callable directly for a test."""
    result = {"sent": 0, "recipients": 0, "error": None}
    try:
        from api.services.auth_db import get_connection
        conn = get_connection()
        try:
            metrics = compute_health(conn, days=days)
        finally:
            conn.close()
        subject, html = render_health_email(metrics)
        recips = _recipients()
        result["recipients"] = len(recips)
        if not recips:
            result["error"] = "no recipients (set COMPASS_HEALTH_EMAIL_TO or ADMIN_EMAILS)"
            return result
        from api.services import email_service
        for to in recips:
            try:
                if email_service.send_email(to, subject, html):
                    result["sent"] += 1
            except Exception as e:  # noqa: BLE001
                _log.warning("compass_health send to %s failed: %s", to, e)
    except Exception as e:  # noqa: BLE001
        _log.warning("compass_health weekly email failed: %s", e)
        result["error"] = str(e)
    return result
