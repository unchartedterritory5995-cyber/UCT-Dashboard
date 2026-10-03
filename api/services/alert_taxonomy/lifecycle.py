"""Per-alert lifecycle: expiry (FT-035, the thinkorswim "expire" control).

A member can give any S7 alert an expiry time. Past it, `expire_due` -- run by
the `alert_lifecycle_expire` scheduler job -- SUSPENDS the predicate: its row,
its params and every fire it ever produced stay exactly where they are, and the
member can reactivate it the way they reactivate any suspended alert.

⛔ NEVER A DELETE. Expiry is `suspended_at = now`, the same state a member's own
suspend writes, so there is one meaning of "this alert is not running".
DARK: `ALERT_LIFECYCLE_ENABLED` (default off). Off: the route 404s and the job
expires nothing; a stored expiry is kept and simply not acted on.

Not in this module, and why (FT-035's other two controls):
  * remind -- a re-notification of an unread fire needs a read-state the
    member can see on every channel; only in-app has one today.
  * reverse-crossover -- a per-trigger-type semantic (it means something for a
    price level, nothing for a filing) that belongs in each type's evaluator,
    and the price-level evaluator is still a dark comparison sweep.
"""
from __future__ import annotations

import os
import time
from typing import Optional

from api.services.alert_taxonomy import db as _db

FLAG = "ALERT_LIFECYCLE_ENABLED"
MAX_HORIZON_S = 366 * 86400


class LifecycleError(ValueError):
    pass


def is_enabled() -> bool:
    return os.environ.get(FLAG, "0").strip() == "1"


def _conn(db_path: str | None):
    c = _db.connect(db_path)
    _db.init_db(c)
    return c


def set_expiry(user_id: str, predicate_id: str, expires_at: Optional[float], *,
               now: float | None = None, db_path: str | None = None) -> Optional[dict]:
    """Set (or clear, with None) one of the member's own alerts' expiry.
    Returns None when the predicate is not theirs (a 404, never a 403)."""
    now = time.time() if now is None else now
    if expires_at is not None:
        if expires_at <= now:
            raise LifecycleError("An expiry must be in the future.")
        if expires_at - now > MAX_HORIZON_S:
            raise LifecycleError("An expiry can be at most a year out.")
    c = _conn(db_path)
    try:
        cur = c.execute("UPDATE alert_predicates SET expires_at = ?, updated_at = ?"
                        " WHERE id = ? AND user_id = ?",
                        (expires_at, now, predicate_id, str(user_id)))
        c.commit()
        if cur.rowcount == 0:
            return None
        r = c.execute("SELECT id, type_id, expires_at, suspended_at FROM alert_predicates WHERE id = ?",
                      (predicate_id,)).fetchone()
        return dict(r)
    finally:
        c.close()


def expire_due(*, now: float | None = None, db_path: str | None = None) -> int:
    """Suspend every active predicate whose expiry has passed. Returns how many."""
    if not is_enabled():
        return 0
    now = time.time() if now is None else now
    c = _conn(db_path)
    try:
        cur = c.execute("UPDATE alert_predicates SET suspended_at = ?, updated_at = ?"
                        " WHERE expires_at IS NOT NULL AND expires_at <= ? AND suspended_at IS NULL",
                        (now, now, now))
        c.commit()
        return cur.rowcount
    finally:
        c.close()
