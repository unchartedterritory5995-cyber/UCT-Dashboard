"""UCT Terminal `ALRT` -- the alert centre's ONE read (TERMINAL-NEXT gap 6).

A member's alerts live in four stores, each with its own router, and until this read no
surface showed them together:

  * PRICE      -- `watchlist_alerts` (auth.db) via `watchlist_alert_service`: price, line and
                  trendline alerts. Create + delete only (`/api/watchlist-alerts`); there is no
                  pause on this product, and a fired row is disarmed (`is_active = 0`).
  * INDICATOR  -- `indicator_alerts` via `indicator_alert_service`: toggle (pause/resume) and
                  delete (`/api/indicator-alerts/{id}/toggle`, `DELETE /api/indicator-alerts/{id}`).
  * SCREEN     -- `spec_alert_subs` via `screener.spec_alerts` (FT-027): suspend / resume,
                  NEVER deleted (`/api/screener/spec-alerts/{id}/suspend|resume`). Dark behind
                  its own `SCREENER_SPEC_ALERTS_ENABLED`; off, this section says so.
  * S7         -- `alert_predicates` via `alert_taxonomy.predicates`: every trigger type the
                  member owns. `document-arrival` is the member's FILING WATCH (pause =
                  `DELETE /api/alerts/taxonomy/document-arrival/{id}`, which SUSPENDS; resume =
                  the same POST that created it, which reactivates -- predicates.py A3).

and RECENT FIRES come from `alert_fires` -- the durable record (`receipts.list_fires_for_feed`,
ownership joined through the fire's own predicate). ⛔ NEVER `user_alerts`: that table is the
ephemeral-feed mirror, not the record of what fired.

⛔ READ ONLY. Every write the panel offers goes through the EXISTING endpoint named above; this
module never mutates a row, so it cannot become a second authority over any of them.
⛔ OWNER-SCOPED. Every read takes the session's user id; nothing here accepts one from a client.
⛔ A SECTION THAT COULD NOT BE READ SAYS SO (`status: "unavailable"`) -- an outage must never
read as "you have no alerts" (lesson_a_swallowed_error_becomes_a_confident_finding).

DARK: `ALERT_CENTRE_ENABLED` (default off), read per call. Off, the route 404s before identity
is read and the auth payload omits `alert_centre_enabled`, so the `ALRT` code is answered
"not enabled" and the panel makes no request.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Callable

log = logging.getLogger(__name__)

FLAG = "ALERT_CENTRE_ENABLED"
FIRES_LIMIT = 50
FILING_WATCH_TYPE = "document-arrival"


def is_enabled() -> bool:
    """The ONE reader of the flag: the route's gate and the auth payload both call this."""
    return os.environ.get(FLAG, "0").strip().lower() in ("1", "true", "yes", "on")


def _section(read: Callable[[], Any], what: str) -> dict:
    """Run one store's read. A failure is `unavailable`, never an empty list."""
    try:
        return {"status": "ok", "items": read()}
    except Exception as exc:  # noqa: BLE001 -- one store down must not blank the other three
        log.warning("alert centre: %s read failed: %s", what, exc)
        return {"status": "unavailable", "items": []}


def _price(uid: str) -> list[dict]:
    from api.services import watchlist_alert_service
    return watchlist_alert_service.list_user_alerts(uid, active_only=False)


def _indicator(uid: str) -> list[dict]:
    from api.services import indicator_alert_service
    return indicator_alert_service.list_for_user(uid)


def _s7(uid: str) -> list[dict]:
    from api.services.alert_taxonomy import predicates
    return predicates.list_predicates(user_id=uid, active_only=False)


def _fires(uid: str) -> list[dict]:
    from api.services.alert_taxonomy import receipts
    return receipts.list_fires_for_feed(uid, limit=FIRES_LIMIT)


def overview(user_id: str) -> dict:
    """Everything the caller has armed, plus their recent fires. Read-only, owner-scoped."""
    uid = str(user_id)
    from api.services.screener import spec_alerts
    if spec_alerts.is_enabled():
        screen = _section(lambda: spec_alerts.list_subs(uid), "screen")
    else:
        # The screen-alert routes 404 while their own flag is off, so the panel must not offer
        # a suspend/resume that would fail. Said in words, not hidden.
        screen = {"status": "not_enabled", "items": []}
    return {
        "price": _section(lambda: _price(uid), "price"),
        "indicator": _section(lambda: _indicator(uid), "indicator"),
        "screen": screen,
        "s7": _section(lambda: _s7(uid), "s7"),
        "fires": _section(lambda: _fires(uid), "fires"),
        "filing_watch_type": FILING_WATCH_TYPE,
    }
