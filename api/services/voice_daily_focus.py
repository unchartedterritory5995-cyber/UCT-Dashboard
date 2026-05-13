"""
Compass daily focus message — Phase 4-D of the Compass × Voice unification.

At 7:30 AM ET on weekdays, Compass composes a single-paragraph focus
message for each enabled user and posts it as a proactive insight. The
insight cascades through the three surfaces already wired:

  - Compass inbox: always logs (existing infrastructure)
  - Compass chat thread: posts via P4-C mirror in add_insight
  - Spoken aloud: if proactive_speak ON, P4-A speaks it (importance ≥ 7)

The focus composer pulls:
  - Current market regime (from voice_regime_classifier)
  - Pre-market gappers on the user's flagged list
  - Earnings on the user's watchlists today
  - Any active interventions (tilt rules currently firing)
  - Optional: user's current focus area from trader_profile

Idempotent: a (user, date) tuple is recorded so the same day's focus
isn't posted twice if the scheduler retries.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

_log = logging.getLogger(__name__)


_FOCUS_INSIGHT_KIND = "daily_focus"
_FOCUS_IMPORTANCE = 7  # eligible for proactive_speak (≥ 7) and prominent in inbox


def _today_iso_et() -> str:
    """Return today's date as YYYY-MM-DD in US/Eastern."""
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    except Exception:
        # Fallback: UTC date
        return datetime.now(timezone.utc).date().isoformat()


def _already_posted_today(user_id: str) -> bool:
    """Idempotency guard: check if today's focus has already been posted.

    Compares against created_at >= today-start-ET (translated to UTC for
    the SQLite comparison) so a scheduler retry within the same trading
    day doesn't double-post.

    SQLite stores created_at via CURRENT_TIMESTAMP in 'YYYY-MM-DD HH:MM:SS'
    format (UTC, no timezone suffix). We format the cutoff the same way
    so string comparison works.
    """
    try:
        from zoneinfo import ZoneInfo
        from api.services.auth_db import get_connection
        et = ZoneInfo("America/New_York")
        now_et = datetime.now(et)
        start_of_day_et = now_et.replace(hour=0, minute=0, second=0, microsecond=0)
        cutoff_utc = start_of_day_et.astimezone(timezone.utc)
        # Match SQLite CURRENT_TIMESTAMP format: 'YYYY-MM-DD HH:MM:SS'
        cutoff_str = cutoff_utc.strftime("%Y-%m-%d %H:%M:%S")
        conn = get_connection()
        try:
            row = conn.execute(
                """SELECT 1 FROM voice_proactive_insights
                    WHERE user_id = ? AND kind = ?
                      AND created_at >= ?
                    LIMIT 1""",
                (user_id, _FOCUS_INSIGHT_KIND, cutoff_str),
            ).fetchone()
            return row is not None
        finally:
            conn.close()
    except Exception as e:  # noqa: BLE001
        _log.warning("[daily_focus] idempotency check failed: %s", e)
        return False


def _regime_phrase() -> str:
    """One-line current regime description for the focus message."""
    try:
        from api.services.voice_regime_classifier import build_regime_prompt_line
        line = build_regime_prompt_line() or ""
        # The regime prompt line is shaped like "CURRENT MARKET REGIME: ..."
        if ":" in line:
            return line.split(":", 1)[1].strip().rstrip(".")
        return line.strip().rstrip(".")
    except Exception:
        return ""


def _flagged_symbols(user_id: str) -> list[str]:
    """Return the symbols on the user's flagged shadow watchlist."""
    try:
        from api.services.watchlist_service import get_or_create_flagged_list
        wl = get_or_create_flagged_list(user_id) or {}
        items = wl.get("items") or []
        return [
            (it.get("sym") or "").upper()
            for it in items
            if it.get("sym")
        ]
    except Exception:  # noqa: BLE001
        return []


def _flagged_gappers(user_id: str) -> list[dict[str, Any]]:
    """Pre-market gappers on the user's flagged list (top 3 by abs %)."""
    flagged = _flagged_symbols(user_id)
    if not flagged:
        return []
    try:
        from api.services.massive import get_movers
        movers = get_movers() or {}
        ripping = movers.get("ripping") or []
        drilling = movers.get("drilling") or []
        all_movers = ripping + drilling
        flagged_set = {s.upper() for s in flagged}
        hits = [m for m in all_movers
                if (m.get("sym") or "").upper() in flagged_set]
        # Sort by absolute pct
        def _abs_pct(m):
            pct = m.get("pct") or "0"
            if isinstance(pct, str):
                pct = pct.replace("%", "").replace("+", "").strip()
            try:
                return abs(float(pct))
            except (TypeError, ValueError):
                return 0.0
        hits.sort(key=_abs_pct, reverse=True)
        return hits[:3]
    except Exception as e:  # noqa: BLE001
        _log.warning("[daily_focus] gapper lookup failed: %s", e)
        return []


def _earnings_on_watchlist(user_id: str) -> list[str]:
    """Tickers reporting today that are in the user's flagged list (max 5)."""
    flagged = _flagged_symbols(user_id)
    if not flagged:
        return []
    flagged_set = {s.upper() for s in flagged}
    try:
        from api.services.engine import get_earnings
        data = get_earnings() or {}
        out = []
        for bucket in ("bmo", "amc", "amc_tonight"):
            for entry in data.get(bucket, []) or []:
                sym = (entry.get("sym") or "").upper()
                if sym and sym in flagged_set and sym not in out:
                    out.append(sym)
                    if len(out) >= 5:
                        return out
        return out
    except Exception as e:  # noqa: BLE001
        _log.warning("[daily_focus] earnings lookup failed: %s", e)
        return []


def _active_interventions(user_id: str) -> list[str]:
    """Currently-firing tilt rules for the user (rapid_fire, cooling_off, etc.).
    Reads from journal_two interventions, scoped to the default account."""
    try:
        from api.services.trader_memory import get_default_account_id
        from api.services.journal_two.interventions import list_active
        account_id = get_default_account_id(user_id)
        if not account_id:
            return []
        out = list_active(user_id=user_id, account_id=account_id) or []
        names = []
        for i in out:
            rule = i.get("rule_name") or i.get("kind") or i.get("rule")
            if rule:
                names.append(rule)
        return names
    except Exception:  # noqa: BLE001
        return []


def compose_daily_focus(user_id: str) -> dict[str, Any] | None:
    """Build the focus message components for one user. Returns None if
    the user has no useful focus content (skips post)."""
    regime = _regime_phrase()
    gappers = _flagged_gappers(user_id)
    earnings = _earnings_on_watchlist(user_id)
    interventions = _active_interventions(user_id)

    pieces: list[str] = []
    headline = "Today's focus"

    # Active interventions are highest priority — surface first
    if interventions:
        rules = ", ".join(interventions[:3])
        pieces.append(
            f"Active intervention{'s' if len(interventions) != 1 else ''}: "
            f"{rules}. Address before any new trade."
        )

    if regime:
        pieces.append(f"Regime: {regime}.")

    if gappers:
        labels = ", ".join(
            f"{g.get('sym')} {g.get('pct')}" for g in gappers
        )
        pieces.append(f"On your flagged list pre-market: {labels}.")

    if earnings:
        pieces.append(
            f"Earnings on your watchlist today: {', '.join(earnings)}."
        )

    if not pieces:
        # No interventions, no gappers, no earnings, no regime data — skip
        return None

    body = " ".join(pieces)
    return {
        "headline": headline,
        "body": body,
        "regime": regime,
        "gappers": gappers,
        "earnings": earnings,
        "interventions": interventions,
    }


def post_daily_focus(user_id: str, *, force: bool = False) -> int | None:
    """Compose + post today's focus for one user. Returns the insight id,
    or None if skipped (already posted, empty content, or error)."""
    if not force and _already_posted_today(user_id):
        return None
    focus = compose_daily_focus(user_id)
    if not focus:
        return None
    try:
        from api.services.voice_proactive_service import add_insight
        return add_insight(
            user_id,
            kind=_FOCUS_INSIGHT_KIND,
            headline=focus["headline"],
            body=focus["body"],
            importance=_FOCUS_IMPORTANCE,
        )
    except Exception as e:  # noqa: BLE001
        _log.warning("[daily_focus] post failed for %s: %s", user_id, e)
        return None


def run_for_all_enabled_users() -> dict[str, int]:
    """Scheduler entrypoint — post the daily focus for every user with
    voice enabled. Returns {posted: N, skipped: M} for telemetry."""
    posted = 0
    skipped = 0
    try:
        from api.services.auth_db import get_connection
        conn = get_connection()
        try:
            rows = conn.execute(
                "SELECT DISTINCT user_id FROM voice_settings WHERE enabled = 1"
            ).fetchall()
        finally:
            conn.close()
        for r in rows:
            uid = r["user_id"]
            iid = post_daily_focus(uid)
            if iid:
                posted += 1
            else:
                skipped += 1
    except Exception as e:  # noqa: BLE001
        _log.warning("[daily_focus] run_for_all_enabled_users failed: %s", e)
    return {"posted": posted, "skipped": skipped}
