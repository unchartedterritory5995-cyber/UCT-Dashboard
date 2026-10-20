"""house_chart -- the firm's chart LOOK, resolved from the owner's own saved settings.

One owner, one answer: the first address in ADMIN_EMAILS (the same rule
desk_daily_session and compass_health use for "him"). The Discord /chart
renders, the Sunday Scans letter and the Study drills all read THIS blob, so a
Study chart is the same picture a member already knows from Discord. Fails
OPEN: an unset env, a missing user or a broken lookup returns None with a
reason, and every caller keeps the schema defaults rather than losing a chart.
"""
from __future__ import annotations

import json
import os

from api.services.auth_service import get_user_by_email, get_user_preferences


def owner_chart_settings() -> dict:
    """{"chart_settings": <parsed blob> | None, "reason": <str, only when None>}."""
    emails = [e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()]
    if not emails:
        return {"chart_settings": None, "reason": "ADMIN_EMAILS unset"}
    try:
        user = get_user_by_email(emails[0])
        if not user:
            return {"chart_settings": None, "reason": "owner not found"}
        raw = (get_user_preferences(user["id"]) or {}).get("chart_settings")
        if not raw:
            return {"chart_settings": None, "reason": "no saved chart_settings"}
        # Stored as a JSON STRING in pref_value; handed back parsed so a page can
        # spread it straight into a StockChart override.
        return {"chart_settings": json.loads(raw) if isinstance(raw, str) else raw}
    except Exception as e:  # noqa: BLE001 -- a broken lookup must not cost anyone the chart
        return {"chart_settings": None, "reason": f"{type(e).__name__}"}
