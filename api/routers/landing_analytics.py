"""
Landing-page conversion analytics.

Anonymous event tracking — the client posts {event, props?, visitor_id, ...}
to /api/landing-analytics/event and we store one row per event in
auth.db.landing_events. The visitor_id is a localStorage-stable UUID
generated client-side; no auth is required.

Admin summary endpoint returns roll-up counts for the last N days,
gated by the existing require_admin middleware.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from api.middleware.auth_middleware import require_admin
from api.services.auth_db import get_connection


router = APIRouter(prefix="/api/landing-analytics", tags=["landing-analytics"])


# ── Allow-list ──────────────────────────────────────────────
# We only accept known event names so the table can't be filled
# with junk. Update this when adding new instrumentation.
ALLOWED_EVENTS = {
    "landing_view",
    "nav_cta_click",
    "hero_cta_pro_click",
    "hero_cta_free_click",
    "pricing_cta_pro_click",
    "free_tier_cta_click",
    "close_cta_pro_click",
    "close_cta_free_click",
    "sticky_cta_click",
    "footer_cta_click",
    "billing_toggle",
    "faq_open",
    # /compare marketing page
    "compare_view",
    "compare_cta_signup_click",
    "compare_cta_switch_click",
    # Pre-launch COMING SOON page
    "coming_soon_view",
    "waitlist_submit",          # pressed the button
    "waitlist_joined",          # server accepted it
    "founder_contact_click",    # props: {channel: x|email|phone}
    "substack_click",
    "coming_soon_login_click",
}


class TrackBody(BaseModel):
    event: str = Field(..., min_length=1, max_length=64)
    visitor_id: str = Field(..., min_length=1, max_length=64)
    props: dict[str, Any] | None = None
    referrer: str | None = Field(default=None, max_length=512)
    path: str | None = Field(default=None, max_length=256)


def _ip_prefix(ip: str | None) -> str | None:
    """Trim the IP to /24 (IPv4) or first 4 hextets (IPv6) so we
    don't store full visitor IPs."""
    if not ip:
        return None
    if ":" in ip:                              # IPv6
        return ":".join(ip.split(":")[:4])
    parts = ip.split(".")                      # IPv4
    if len(parts) == 4:
        return ".".join(parts[:3] + ["0"])
    return None


@router.post("/event")
async def track_event(body: TrackBody, request: Request) -> dict[str, Any]:
    if body.event not in ALLOWED_EVENTS:
        raise HTTPException(status_code=400, detail="unknown event")

    # Best-effort IP — respect proxy headers if present
    fwd = request.headers.get("x-forwarded-for")
    ip = fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else None)
    ua = (request.headers.get("user-agent") or "")[:512]

    props_json = json.dumps(body.props, separators=(",", ":")) if body.props else None

    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO landing_events"
            " (visitor_id, event, props, referrer, path, user_agent, ip_prefix)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                body.visitor_id[:64],
                body.event,
                props_json,
                (body.referrer or "")[:512] or None,
                (body.path or "")[:256] or None,
                ua,
                _ip_prefix(ip),
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@router.get("/summary")
async def summary(
    days: int = 7,
    _admin: Any = Depends(require_admin),
) -> dict[str, Any]:
    """Aggregate counts for the last `days` days. Admin-only."""
    days = max(1, min(days, 90))
    conn = get_connection()
    try:
        # Per-event totals
        events = conn.execute(
            f"SELECT event, COUNT(*) AS n"
            f" FROM landing_events"
            f" WHERE created_at >= datetime('now', '-{days} days')"
            f" GROUP BY event ORDER BY n DESC"
        ).fetchall()

        # Unique visitors per day
        daily = conn.execute(
            f"SELECT date(created_at) AS day,"
            f"  COUNT(DISTINCT visitor_id) AS visitors,"
            f"  COUNT(*) AS events"
            f" FROM landing_events"
            f" WHERE created_at >= datetime('now', '-{days} days')"
            f" GROUP BY day ORDER BY day DESC"
        ).fetchall()

        # Conversion funnel — view -> any cta click -> signup attempts
        cta_clicks = [
            "hero_cta_pro_click", "hero_cta_free_click",
            "pricing_cta_pro_click", "free_tier_cta_click",
            "close_cta_pro_click", "close_cta_free_click",
            "sticky_cta_click", "footer_cta_click", "nav_cta_click",
        ]
        placeholders = ",".join("?" * len(cta_clicks))
        funnel = conn.execute(
            f"SELECT"
            f"  COUNT(DISTINCT CASE WHEN event = 'landing_view' THEN visitor_id END) AS views,"
            f"  COUNT(DISTINCT CASE WHEN event IN ({placeholders}) THEN visitor_id END) AS cta_clickers"
            f" FROM landing_events"
            f" WHERE created_at >= datetime('now', '-{days} days')",
            cta_clicks,
        ).fetchone()

        # Pre-launch funnel. The hardcoded CTA list above belongs to the full
        # marketing landing page; while COMING_SOON is on, the only conversion
        # that exists is view -> joined the list, so it gets its own numbers
        # rather than being averaged into a funnel it isn't part of.
        cs = conn.execute(
            "SELECT"
            "  COUNT(DISTINCT CASE WHEN event = 'coming_soon_view' THEN visitor_id END) AS views,"
            "  COUNT(DISTINCT CASE WHEN event = 'waitlist_joined' THEN visitor_id END) AS joined,"
            "  COUNT(DISTINCT CASE WHEN event = 'founder_contact_click' THEN visitor_id END) AS founder_clickers,"
            "  COUNT(DISTINCT CASE WHEN event = 'substack_click' THEN visitor_id END) AS substack_clickers"
            f" FROM landing_events"
            f" WHERE created_at >= datetime('now', '-{days} days')"
        ).fetchone()
        cs_views = cs["views"] or 0

        # Which contact route people actually reach for — the thing that tells
        # you whether the phone number is earning its place on the page.
        by_channel = conn.execute(
            "SELECT json_extract(props, '$.channel') AS channel, COUNT(*) AS n"
            " FROM landing_events"
            " WHERE event = 'founder_contact_click'"
            f"  AND created_at >= datetime('now', '-{days} days')"
            " GROUP BY channel ORDER BY n DESC"
        ).fetchall()

        return {
            "days": days,
            "events": [dict(r) for r in events],
            "daily": [dict(r) for r in daily],
            "coming_soon": {
                "views": cs_views,
                "joined": cs["joined"] or 0,
                "join_rate": (
                    round((cs["joined"] or 0) / cs_views, 4) if cs_views else 0.0
                ),
                "founder_clickers": cs["founder_clickers"] or 0,
                "substack_clickers": cs["substack_clickers"] or 0,
                "founder_by_channel": [dict(r) for r in by_channel],
            },
            "funnel": {
                "views": funnel["views"] or 0,
                "cta_clickers": funnel["cta_clickers"] or 0,
                "click_through_rate": (
                    round((funnel["cta_clickers"] or 0) / funnel["views"], 4)
                    if funnel["views"] else 0.0
                ),
            },
        }
    finally:
        conn.close()
