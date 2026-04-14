"""
Watchlist digest — daily/weekly performance email summaries.
Uses existing email service + watchlist performance for data.
"""

import json
import logging
from api.services.auth_db import get_connection
from api.services.email_service import send_email, _wrap_html
from api.services.watchlist_performance import get_batch_returns
from api.services.watchlist_service import list_user_watchlists

_logger = logging.getLogger(__name__)


def _get_digest_subscribers(frequency: str) -> list[dict]:
    """Get users subscribed to a digest frequency."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT user_id, pref_value FROM user_preferences WHERE pref_key = 'watchlist_digest'"
        ).fetchall()
        subs = []
        for r in rows:
            try:
                settings = json.loads(r["pref_value"])
            except (json.JSONDecodeError, TypeError):
                _logger.warning("Malformed digest settings for user %s", r["user_id"])
                continue
            if settings.get("frequency") == frequency:
                user = conn.execute("SELECT id, email, display_name FROM users WHERE id = ?", (r["user_id"],)).fetchone()
                if user:
                    subs.append({"user_id": user["id"], "email": user["email"], "display_name": user["display_name"] or user["email"].split("@")[0], "settings": settings})
        return subs
    finally:
        conn.close()


def _build_digest_html(user_id: str, display_name: str, frequency: str) -> str | None:
    """Build the digest email HTML. Returns None if no watchlists."""
    lists = list_user_watchlists(user_id)
    if not lists:
        return None

    all_tickers = []
    for wl in lists:
        for item in wl.get("items", []):
            if item.get("sym"):
                all_tickers.append(item["sym"])

    if not all_tickers:
        return None

    returns = get_batch_returns(list(set(all_tickers)))
    period_key = "1d" if frequency == "daily" else "1w"
    period_label = "Today" if frequency == "daily" else "This Week"

    sections = []
    for wl in lists:
        items = wl.get("items", [])
        if not items:
            continue
        rows_html = ""
        for item in items[:20]:  # cap at 20 per list
            sym = item["sym"]
            r = returns.get(sym, {})
            val = r.get(period_key)
            if val is None:
                val_str = "—"
                color = "#6b6a60"
            elif val > 0:
                val_str = f"+{val:.1f}%"
                color = "#4ade80"
            else:
                val_str = f"{val:.1f}%"
                color = "#f87171"
            rows_html += f'<tr><td style="padding:4px 8px;color:#e8e0d0;font-size:13px;">{sym}</td><td style="padding:4px 8px;text-align:right;color:{color};font-size:13px;font-weight:600;">{val_str}</td></tr>'

        sections.append(f"""
            <div style="margin-bottom:20px;">
                <h3 style="color:#c9a84c;font-size:13px;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px;">{wl['name']}</h3>
                <table style="width:100%;border-collapse:collapse;">
                    {rows_html}
                </table>
            </div>
        """)

    content = f"""
        <h2 style="color:#e8e0d0;font-size:16px;margin:0 0 4px;">{'Daily' if frequency == 'daily' else 'Weekly'} Watchlist Digest</h2>
        <p style="color:#6b6a60;font-size:12px;margin:0 0 20px;">{period_label}'s performance for {display_name}</p>
        {''.join(sections)}
        <p style="color:#6b6a60;font-size:11px;margin:16px 0 0;">View your watchlists at uctintelligence.com/watchlists</p>
    """
    return _wrap_html(content)


def send_daily_digest(user_id: str, email: str, display_name: str) -> bool:
    html = _build_digest_html(user_id, display_name, "daily")
    if not html:
        return False
    return send_email(email, "UCT Daily Watchlist Digest", html)


def send_weekly_digest(user_id: str, email: str, display_name: str) -> bool:
    html = _build_digest_html(user_id, display_name, "weekly")
    if not html:
        return False
    return send_email(email, "UCT Weekly Watchlist Digest", html)


def run_daily_digests() -> int:
    subs = _get_digest_subscribers("daily")
    sent = 0
    for s in subs:
        try:
            if send_daily_digest(s["user_id"], s["email"], s["display_name"]):
                sent += 1
        except Exception as e:
            _logger.warning("Daily digest failed for %s: %s", s["email"], e)
    _logger.info("Sent %d daily digest(s)", sent)
    return sent


def run_weekly_digests() -> int:
    subs = _get_digest_subscribers("weekly")
    sent = 0
    for s in subs:
        try:
            if send_weekly_digest(s["user_id"], s["email"], s["display_name"]):
                sent += 1
        except Exception as e:
            _logger.warning("Weekly digest failed for %s: %s", s["email"], e)
    _logger.info("Sent %d weekly digest(s)", sent)
    return sent
