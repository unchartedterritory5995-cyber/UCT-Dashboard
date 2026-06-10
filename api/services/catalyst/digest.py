"""Morning catalyst digest — ONE consolidated A/B brief pushed to operators at
~8 AM ET via Discord + email + in-app AlertBell. The "the brief reaches you"
piece: instead of opening the tile, the morning's material catalysts come to
you in a single low-noise message.

Operator-scoped (admins only) so subscribers never get surprise pushes.
Gated OFF by default — enable with CATALYST_DIGEST_ENABLED=1. Grades via
CATALYST_DIGEST_GRADES (default 'A,B').
"""
from __future__ import annotations

import datetime as dt
import logging
import os
from zoneinfo import ZoneInfo

from api.services.catalyst import store

logger = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")


def _today() -> str:
    return dt.datetime.now(_ET).date().isoformat()


def _grades() -> set[str]:
    return {g.strip().upper()
            for g in os.environ.get("CATALYST_DIGEST_GRADES", "A,B").split(",")
            if g.strip()}


def _admin_recipients() -> list[tuple[str, str]]:
    """[(user_id, email)] for role='admin' — the operator(s)."""
    try:
        from api.services.auth_db import get_connection
    except Exception:
        return []
    try:
        with get_connection() as conn:
            rows = conn.cursor().execute(
                "SELECT id, email FROM users WHERE role = 'admin'").fetchall()
            out = []
            for r in rows:
                uid = r[0] if not isinstance(r, dict) else r["id"]
                em = r[1] if not isinstance(r, dict) else r["email"]
                if uid:
                    out.append((str(uid), em or ""))
            return out
    except Exception:
        logger.exception("[catalyst-digest] admin recipients query failed")
        return []


def build_digest(market_date: str) -> dict | None:
    """Today's A/B-grade catalysts as a structured digest, or None if empty."""
    grades = _grades()
    rows = [r for r in store.get_for_date(market_date, ranked_only=True)
            if (r.get("grade") or "").upper() in grades]
    if not rows:
        return None
    return {"date": market_date, "count": len(rows), "rows": rows}


def _row_bits(r: dict) -> tuple:
    sym = r.get("ticker") or "?"
    grade = (r.get("grade") or "?").upper()
    ctype = r.get("catalyst_type") or r.get("tag") or ""
    gap = r.get("gap_pct")
    gp = f"{gap:+.1f}%" if isinstance(gap, (int, float)) else ""
    thesis = (r.get("thesis_text") or "").replace("**", "").strip()
    return sym, grade, ctype, gp, thesis


def _discord_embed(digest: dict) -> dict:
    desc = "\n\n".join(
        f"**${sym}** `{grade}` {ctype} {gp}\n{thesis[:220]}"
        for sym, grade, ctype, gp, thesis in (_row_bits(r) for r in digest["rows"][:15])
    )
    return {
        "title": f"🎯 Morning Catalysts — {digest['date']} ({digest['count']} A/B)",
        "description": desc[:4000],
        "color": 0xC9A84C,
    }


def _email_html(digest: dict) -> str:
    items = "".join(
        (f"<tr><td style='padding:10px 8px;border-bottom:1px solid #222'>"
         f"<b style='color:#c9a84c'>${sym}</b> "
         f"<span style='color:#888;font-size:12px'>{grade} · {ctype} · {gp}</span><br>"
         f"<span style='color:#ccc;font-size:14px'>{thesis}</span></td></tr>")
        for sym, grade, ctype, gp, thesis in (_row_bits(r) for r in digest["rows"])
    )
    return (
        "<div style='background:#0a0a0c;color:#eee;font-family:Arial,sans-serif;padding:24px'>"
        f"<h2 style='color:#c9a84c;margin:0 0 4px'>Morning Catalysts — {digest['date']}</h2>"
        f"<p style='color:#888;margin:0 0 16px'>{digest['count']} A/B-grade catalysts to know before the open.</p>"
        f"<table style='width:100%;border-collapse:collapse'>{items}</table>"
        "<p style='color:#555;font-size:12px;margin-top:20px'>Informational only — not investment advice. "
        "Synthesized by UCT Intelligence.</p></div>"
    )


def send_digest(market_date: str | None = None) -> dict:
    """Build + push the morning digest to operators. Gated on
    CATALYST_DIGEST_ENABLED. Best-effort per channel — a failure in one never
    blocks the others. Returns a summary dict."""
    if os.environ.get("CATALYST_DIGEST_ENABLED", "0").lower() not in ("1", "true", "yes"):
        return {"sent": False, "reason": "disabled"}
    md = market_date or _today()
    digest = build_digest(md)
    if not digest:
        logger.info("[catalyst-digest] no A/B catalysts for %s — nothing to send", md)
        return {"sent": False, "reason": "empty", "market_date": md}

    recipients = _admin_recipients()
    out = {"sent": True, "market_date": md, "count": digest["count"],
           "discord": False, "email": 0, "alertbell": 0}

    try:
        from api.services import discord_notify
        discord_notify._send_webhook(_discord_embed(digest))
        out["discord"] = True
    except Exception:
        logger.exception("[catalyst-digest] discord send failed")

    try:
        from api.services.email_service import send_email
        html = _email_html(digest)
        subject = f"🎯 Morning Catalysts — {digest['count']} to know ({md})"
        for _uid, email in recipients:
            if email and send_email(email, subject, html):
                out["email"] += 1
    except Exception:
        logger.exception("[catalyst-digest] email send failed")

    try:
        from api.services.watchlist_alert_service import deliver_alert_payload
        top = ", ".join(f"${r.get('ticker')}" for r in digest["rows"][:5])
        for uid, _email in recipients:
            try:
                deliver_alert_payload(
                    user_id=uid,
                    sym=(digest["rows"][0].get("ticker") or "MARKET"),
                    title=f"🎯 {digest['count']} morning catalysts",
                    message=f"Top: {top}. Open Stock Catalysts for the full brief.",
                    source="catalyst_digest",
                    extra_data={"market_date": md, "count": digest["count"]},
                )
                out["alertbell"] += 1
            except Exception:
                logger.exception("[catalyst-digest] alertbell for %s failed", uid)
    except Exception:
        logger.exception("[catalyst-digest] alertbell send failed")

    logger.info("[catalyst-digest] sent: %s", out)
    return out
