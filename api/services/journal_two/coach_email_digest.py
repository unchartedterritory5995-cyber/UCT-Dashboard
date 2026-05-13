"""
Compass weekly email digest — P5-O.

Sunday morning ET batch: for every j2_account with compass_enabled = 1,
generate (idempotent) the past week's Compass weekly review and email
the trader an HTML summary.

Email contents:
  - Greeting + week date range
  - Stat strip (trade count, win rate, avg R, # post-mortems, # interventions)
  - The weekly review prose (markdown lightly converted to HTML)
  - "This week's focus" pullout (extracted from review metadata)
  - CTA → /journal Compass tab

Idempotency: piggybacks on coach.generate_weekly_review which is itself
idempotent by (user, account, week_start). The email is also gated on a
weekly digest log row so we don't double-email if the job retries.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

_log = logging.getLogger(__name__)


_BASE_URL = "https://uctintelligence.com"


# ── Markdown → HTML (very light) ─────────────────────────────────────────────

def _md_to_html(md: str) -> str:
    """Convert Compass review markdown to simple email-safe HTML.

    Handles: paragraphs, **bold**, *italic*, `code`, bullet lists, headings.
    Anything fancier we drop to plain paragraphs.
    """
    if not md:
        return ""
    import re as _re
    # Escape any raw HTML first
    md = (md.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;"))
    # Bold + italic + code
    md = _re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", md)
    md = _re.sub(r"\*(.+?)\*", r"<em>\1</em>", md)
    md = _re.sub(r"`([^`]+)`", r"<code style='background:#1f1f1d;padding:1px 4px;border-radius:3px;'>\1</code>", md)

    out: list[str] = []
    in_list = False
    for raw in md.split("\n"):
        line = raw.rstrip()
        if not line.strip():
            if in_list:
                out.append("</ul>")
                in_list = False
            continue
        if line.startswith("- ") or line.startswith("* "):
            if not in_list:
                out.append('<ul style="margin:8px 0;padding-left:20px;color:#e8e0d0;font-size:13px;line-height:1.6;">')
                in_list = True
            out.append(f"<li style='margin:2px 0;'>{line[2:].strip()}</li>")
            continue
        if in_list:
            out.append("</ul>")
            in_list = False
        if line.startswith("### "):
            out.append(
                f"<h3 style='color:#c9a84c;font-size:13px;margin:18px 0 6px;text-transform:uppercase;letter-spacing:1px;'>{line[4:].strip()}</h3>"
            )
        elif line.startswith("## "):
            out.append(
                f"<h2 style='color:#e8e0d0;font-size:15px;margin:20px 0 8px;'>{line[3:].strip()}</h2>"
            )
        elif line.startswith("# "):
            out.append(
                f"<h2 style='color:#e8e0d0;font-size:16px;margin:20px 0 8px;'>{line[2:].strip()}</h2>"
            )
        else:
            out.append(
                f"<p style='color:#e8e0d0;font-size:13px;margin:8px 0;line-height:1.6;'>{line}</p>"
            )
    if in_list:
        out.append("</ul>")
    return "".join(out)


# ── Idempotency log ──────────────────────────────────────────────────────────

def _ensure_log_table(conn) -> None:
    conn.execute(
        """CREATE TABLE IF NOT EXISTS j2_weekly_email_log (
            user_id TEXT NOT NULL,
            account_id TEXT NOT NULL,
            week_start TEXT NOT NULL,
            sent_at TEXT NOT NULL,
            ok INTEGER NOT NULL,
            PRIMARY KEY (user_id, account_id, week_start)
        )"""
    )
    conn.commit()


def _already_sent(conn, *, user_id: str, account_id: str, week_start: str) -> bool:
    row = conn.execute(
        """SELECT 1 FROM j2_weekly_email_log
            WHERE user_id = ? AND account_id = ? AND week_start = ? AND ok = 1
            LIMIT 1""",
        (user_id, account_id, week_start),
    ).fetchone()
    return row is not None


def _record_send(conn, *, user_id: str, account_id: str, week_start: str, ok: bool) -> None:
    conn.execute(
        """INSERT OR REPLACE INTO j2_weekly_email_log
                (user_id, account_id, week_start, sent_at, ok)
            VALUES (?, ?, ?, ?, ?)""",
        (user_id, account_id, week_start, datetime.now(timezone.utc).isoformat(), 1 if ok else 0),
    )
    conn.commit()


# ── Week computation ─────────────────────────────────────────────────────────

def previous_week_monday_iso(today: date | None = None) -> str:
    """Monday (ISO) of the just-finished trading week, given today.

    Sunday's job emails the Monday-Friday week that just closed, so the
    Monday is `today - 6 days` when today is Sunday."""
    d = today or date.today()
    # Monday=0 ... Sunday=6
    days_since_monday = d.weekday()
    # If we're on Sunday (6), the just-finished week's Monday is 6 days back.
    # If we run on Monday morning we still want the week that just ended
    # (last Monday → 7 days back).
    if days_since_monday == 0:  # Monday — want last week
        monday = d - timedelta(days=7)
    else:
        monday = d - timedelta(days=days_since_monday)
    return monday.isoformat()


def _format_week_range(monday_iso: str) -> str:
    monday = date.fromisoformat(monday_iso)
    friday = monday + timedelta(days=4)
    if monday.month == friday.month:
        return f"{monday.strftime('%b')} {monday.day}–{friday.day}, {monday.year}"
    return f"{monday.strftime('%b %d')} – {friday.strftime('%b %d')}, {monday.year}"


# ── Stat strip ───────────────────────────────────────────────────────────────

def _fetch_week_stats(conn, *, user_id: str, account_id: str, week_start: str) -> dict[str, Any]:
    """Return: {trade_count, win_rate, avg_r, post_mortems, interventions}.

    Post-mortems = j2_trade_reviews created during the week.
    Interventions = j2_interventions raised during the week.
    Trade aggregates come from coach_data_assembler.assemble_week which is
    already cached / idempotent for the same week.
    """
    out: dict[str, Any] = {
        "trade_count": 0,
        "win_rate": None,
        "avg_r": None,
        "post_mortems": 0,
        "interventions": 0,
    }
    try:
        from api.services.journal_two import coach_data_assembler
        data = coach_data_assembler.assemble_week(
            user_id=user_id, account_id=account_id,
            week_start=week_start, conn=conn,
        )
        agg = data.get("aggregates") or {}
        out["trade_count"] = int(agg.get("trade_count") or 0)
        wr = agg.get("win_rate")
        out["win_rate"] = round(wr * 100, 1) if wr is not None else None
        avg_r = agg.get("avg_r")
        out["avg_r"] = round(avg_r, 2) if avg_r is not None else None
    except Exception as e:  # noqa: BLE001
        _log.warning("[compass_email_digest] aggregate fetch failed: %s", e)

    week_end = (date.fromisoformat(week_start) + timedelta(days=6)).isoformat()
    try:
        row = conn.execute(
            """SELECT COUNT(*) AS n FROM j2_trade_reviews
                WHERE user_id = ? AND account_id = ?
                  AND forgotten = 0
                  AND DATE(created_at) BETWEEN ? AND ?""",
            (user_id, account_id, week_start, week_end),
        ).fetchone()
        if row:
            out["post_mortems"] = int(row["n"] or 0)
    except Exception:
        pass

    try:
        row = conn.execute(
            """SELECT COUNT(*) AS n FROM j2_interventions
                WHERE user_id = ? AND account_id = ?
                  AND DATE(created_at) BETWEEN ? AND ?""",
            (user_id, account_id, week_start, week_end),
        ).fetchone()
        if row:
            out["interventions"] = int(row["n"] or 0)
    except Exception:
        pass

    return out


def _stat_cell(label: str, value: str, color: str) -> str:
    return (
        '<td align="center" style="padding:10px 6px;">'
        f'<div style="font-size:18px;font-weight:700;color:{color};">{value}</div>'
        f'<div style="font-size:10px;color:#6b6a60;letter-spacing:0.5px;text-transform:uppercase;margin-top:2px;">{label}</div>'
        '</td>'
    )


def _stat_strip_html(stats: dict[str, Any]) -> str:
    win = stats.get("win_rate")
    win_str = f"{win:g}%" if win is not None else "—"
    win_color = "#4ade80" if (win is not None and win >= 50) else "#f87171" if win is not None else "#6b6a60"

    avg_r = stats.get("avg_r")
    avg_r_str = f"{avg_r:+.2f}R" if avg_r is not None else "—"
    avg_r_color = "#4ade80" if (avg_r is not None and avg_r > 0) else "#f87171" if avg_r is not None else "#6b6a60"

    cells = [
        _stat_cell("Trades", str(stats.get("trade_count") or 0), "#e8e0d0"),
        _stat_cell("Win Rate", win_str, win_color),
        _stat_cell("Avg R", avg_r_str, avg_r_color),
        _stat_cell("Post-Mortems", str(stats.get("post_mortems") or 0), "#c9a84c"),
        _stat_cell("Interventions", str(stats.get("interventions") or 0), "#c9a84c"),
    ]
    return (
        '<table cellpadding="0" cellspacing="0" '
        'style="width:100%;background:#1a1b18;border:1px solid #2a2b28;border-radius:8px;margin:16px 0;">'
        f'<tr>{"".join(cells)}</tr>'
        '</table>'
    )


# ── Compose + send ───────────────────────────────────────────────────────────

def _focus_pullout_html(focus_text: str | None) -> str:
    if not focus_text:
        return ""
    return (
        '<div style="margin:18px 0;padding:14px 16px;background:rgba(201,168,76,0.08);'
        'border-left:3px solid #c9a84c;border-radius:4px;">'
        '<div style="font-size:10px;color:#c9a84c;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;margin-bottom:6px;">'
        "This Week's Focus"
        '</div>'
        f'<div style="font-size:13px;color:#e8e0d0;line-height:1.5;">{focus_text}</div>'
        '</div>'
    )


def compose_digest_html(
    *,
    display_name: str,
    account_name: str | None,
    week_start: str,
    review_body: str,
    this_weeks_focus: str | None,
    stats: dict[str, Any],
    base_url: str = _BASE_URL,
) -> str:
    """Build the full digest email body (already wrapped via _wrap_html)."""
    from api.services.email_service import _wrap_html, _button_html

    week_range = _format_week_range(week_start)
    acct_line = f" — {account_name}" if account_name else ""

    content = (
        f'<h1 style="font-size:20px;font-weight:600;color:#e8e0d0;text-align:center;margin:0 0 4px 0;">'
        f"Your Week with Compass"
        f'</h1>'
        f'<p style="font-size:12px;color:#6b6a60;text-align:center;margin:0 0 20px 0;letter-spacing:0.5px;">'
        f"{week_range}{acct_line}"
        f'</p>'
        f'<p style="font-size:13px;color:#a8a290;margin:0 0 4px;">Hi {display_name},</p>'
        f'<p style="font-size:13px;color:#a8a290;margin:0 0 8px;">Here\'s your weekly review.</p>'
        f"{_stat_strip_html(stats)}"
        f"{_focus_pullout_html(this_weeks_focus)}"
        '<div style="border-top:1px solid #2a2b28;margin:20px 0 12px;"></div>'
        f"{_md_to_html(review_body)}"
        f"{_button_html(base_url + '/journal', 'Open Compass')}"
        '<p style="font-size:11px;color:#6b6a60;text-align:center;margin:20px 0 0 0;">'
        "Navigate the market, effectively."
        '</p>'
    )
    return _wrap_html(content)


def send_digest_for_account(
    *,
    user_id: str,
    account_id: str,
    week_start: str | None = None,
    force: bool = False,
    conn=None,
) -> dict[str, Any]:
    """Generate (if needed) + email the weekly digest for one account.

    Returns: {sent: bool, reason: str, ...}
    Caller is responsible for conn lifecycle. If conn is None, opens its own.
    """
    from api.services.auth_db import get_connection
    from api.services.email_service import send_email
    from api.services.journal_two import coach

    own_conn = conn is None
    _conn = conn or get_connection()
    try:
        _ensure_log_table(_conn)
        ws = week_start or previous_week_monday_iso()

        if not force and _already_sent(_conn, user_id=user_id, account_id=account_id, week_start=ws):
            return {"sent": False, "reason": "already_sent", "week_start": ws}

        # Look up user
        user_row = _conn.execute(
            "SELECT id, email, display_name FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not user_row or not user_row["email"]:
            return {"sent": False, "reason": "no_user_email", "week_start": ws}

        # Look up account name (best-effort)
        acct_row = _conn.execute(
            "SELECT name FROM j2_accounts WHERE id = ? LIMIT 1",
            (account_id,),
        ).fetchone()
        account_name = acct_row["name"] if acct_row else None

        # Generate (idempotent) the weekly review
        try:
            review = coach.generate_weekly_review(
                user_id=user_id, account_id=account_id, week_start=ws, conn=_conn,
            )
        except Exception as e:  # noqa: BLE001
            _log.warning("[compass_email_digest] review generation failed for %s: %s", account_id, e)
            return {"sent": False, "reason": f"review_error: {e}", "week_start": ws}

        body = (review or {}).get("body") or ""
        metadata = (review or {}).get("metadata") or {}
        if isinstance(metadata, str):
            try:
                metadata = json.loads(metadata)
            except Exception:
                metadata = {}
        focus = metadata.get("this_weeks_focus") if isinstance(metadata, dict) else None

        stats = _fetch_week_stats(_conn, user_id=user_id, account_id=account_id, week_start=ws)

        # Skip dead weeks (no trades + no interventions + no post-mortems)
        if (stats["trade_count"] == 0 and stats["post_mortems"] == 0
                and stats["interventions"] == 0 and not body.strip()):
            return {"sent": False, "reason": "no_activity", "week_start": ws}

        display_name = (user_row["display_name"]
                        or (user_row["email"] or "").split("@")[0]
                        or "Trader")

        html = compose_digest_html(
            display_name=display_name,
            account_name=account_name,
            week_start=ws,
            review_body=body,
            this_weeks_focus=focus,
            stats=stats,
        )
        subject = f"Your Week with Compass — {_format_week_range(ws)}"
        ok = send_email(user_row["email"], subject, html)
        _record_send(_conn, user_id=user_id, account_id=account_id, week_start=ws, ok=ok)
        return {
            "sent": bool(ok), "reason": "ok" if ok else "send_failed",
            "week_start": ws, "to": user_row["email"], "trades": stats["trade_count"],
        }
    finally:
        if own_conn:
            _conn.close()


def run_for_all_enabled_accounts() -> dict[str, int]:
    """Scheduler entrypoint — send weekly digest for every compass-enabled
    account. Returns {sent, skipped, errors}."""
    from api.services.auth_db import get_connection
    sent, skipped, errors = 0, 0, 0
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT id, user_id FROM j2_accounts WHERE compass_enabled = 1",
        ).fetchall()
        for r in rows:
            try:
                result = send_digest_for_account(
                    user_id=r["user_id"], account_id=r["id"], conn=conn,
                )
                if result.get("sent"):
                    sent += 1
                else:
                    skipped += 1
            except Exception as e:  # noqa: BLE001
                _log.warning("[compass_email_digest] %s/%s failed: %s",
                             r["user_id"], r["id"], e)
                errors += 1
    finally:
        conn.close()
    _log.info("[compass_email_digest] sent=%d skipped=%d errors=%d", sent, skipped, errors)
    return {"sent": sent, "skipped": skipped, "errors": errors}
