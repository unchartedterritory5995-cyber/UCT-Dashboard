"""
14-day full-access trial — the ONE server-side chokepoint.

Strategy (owner-approved): a brand-new account gets full paid-FEATURE access for
its first 14 days, no credit card. This module computes that window from
`users.created_at` and is consulted by the existing paid gates in
`api/middleware/auth_middleware.py`. Existing paid users are unaffected; a user
older than 14 days who never paid simply has no trial (they predate it — honest).

SAFETY (do not regress):
  * Every function is defensively defaulted. On ANY error (missing field,
    unparseable timestamp, disabled flag, bad input) it returns "not in
    trial" / "not paid". It can NEVER accidentally grant access on error.
  * Trial grants FEATURE access ONLY. It must never reach admin surfaces
    (those check `role == 'admin'`) or billing state (checkout/portal/webhooks
    read real subscription rows) — those are decided elsewhere.

Gate: env `J2_TRIAL_ENABLED` (default "1"). Set "0" to disable the trial
entirely (rollback with no code change / no rebuild).
"""

import os
import math
from datetime import datetime, timezone

TRIAL_DAYS = 14


def _trial_enabled() -> bool:
    """Trial is ON by default; only an explicit off-value disables it."""
    val = os.environ.get("J2_TRIAL_ENABLED", "1")
    return str(val).strip().lower() not in ("0", "false", "no", "off", "")


def _parse_created_at(value) -> datetime | None:
    """Parse `users.created_at` into an aware UTC datetime. None on any failure.

    `create_user` stores it as ``"%Y-%m-%d %H:%M:%S.%f"`` (UTC, no tz suffix); we
    also tolerate ISO-8601 (with 'T'/'Z') and second/day-only precision.
    """
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        s = str(value).strip()
        if not s:
            return None
        dt = None
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
                try:
                    dt = datetime.strptime(s, fmt)
                    break
                except ValueError:
                    dt = None
        if dt is None:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def trial_status(user, now: datetime | None = None) -> dict:
    """Pure account-age trial window: ``{"active": bool, "days_left": int}``.

    ``active`` is True iff the trial is enabled AND the account is younger than
    ``TRIAL_DAYS``. It does NOT consider paid status — the caller combines that
    (a paying user must not see a trial chip; see ``/api/auth/me``). Defensive:
    any error → inactive.
    """
    inactive = {"active": False, "days_left": 0}
    try:
        if not _trial_enabled() or not isinstance(user, dict):
            return inactive
        created = _parse_created_at(user.get("created_at"))
        if created is None:
            return inactive
        now = now or datetime.now(timezone.utc)
        age_days = (now - created).total_seconds() / 86400.0
        if age_days < 0:  # clock-skew guard — treat as day 0, never "negative age"
            age_days = 0.0
        if age_days >= TRIAL_DAYS:
            return inactive
        days_left = int(math.ceil(TRIAL_DAYS - age_days))
        days_left = max(1, min(TRIAL_DAYS, days_left))
        return {"active": True, "days_left": days_left}
    except Exception:
        return inactive


def is_account_in_trial(user, now: datetime | None = None) -> bool:
    """True iff the account is within its 14-day trial window (feature access)."""
    try:
        return bool(trial_status(user, now=now)["active"])
    except Exception:
        return False


def is_paid_or_trial(user, now: datetime | None = None) -> bool:
    """THE combined feature-access predicate: admin OR paid plan OR in-trial.

    Defensive: any error → False (never accidentally-paid). ``PAID_PLANS`` is
    imported lazily to avoid a circular import with the auth middleware.
    """
    try:
        if not isinstance(user, dict):
            return False
        if user.get("role") == "admin":
            return True
        from api.middleware.auth_middleware import PAID_PLANS
        if user.get("plan") in PAID_PLANS:
            return True
        return is_account_in_trial(user, now=now)
    except Exception:
        return False
