"""Pre-load trader state into the voice session at mint time.

Voice Compass was starting cold every tap — having to call 3+ tools just to
know the trader's open positions, today's focus, and active interventions
before it could answer anything personalized. This module assembles that
state once at session-token mint and injects it as a "=== YOUR TRADER STATE
===" block in the system instructions, so Compass opens hot.

Everything is wrapped in try/except: any sub-fetch failure just drops that
sub-section. Session mint must never fail because of context assembly.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

_log = logging.getLogger(__name__)

_UNIFIED_ACCOUNT_ID = "_all_"


def _fmt_positions(rows: list[dict[str, Any]]) -> str:
    """One bullet per open position. Truncated to 8."""
    if not rows:
        return ""
    lines = []
    for r in rows[:8]:
        sym = (r.get("symbol") or "?").upper()
        side = (r.get("side") or "LONG").upper()
        shares = r.get("shares") or 0
        entry = r.get("entry_price")
        stop = r.get("stop_price")
        held = r.get("days_held")
        entry_str = f"${entry:.2f}" if isinstance(entry, (int, float)) else "?"
        stop_str = f", stop ${stop:.2f}" if isinstance(stop, (int, float)) else ""
        held_str = f" (held {held}d)" if held is not None else ""
        acct = r.get("account_name")
        acct_str = f" [{acct}]" if acct and acct.lower() != "default" else ""
        lines.append(f"  - {sym} {side} {shares} @ {entry_str}{stop_str}{held_str}{acct_str}")
    if len(rows) > 8:
        lines.append(f"  ...and {len(rows) - 8} more")
    return "Open positions ({}):\n{}".format(len(rows), "\n".join(lines))


def _fmt_interventions(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return ""
    lines = []
    for r in rows[:5]:
        rule = r.get("rule") or "unknown"
        msg = (r.get("message") or "").strip().replace("\n", " ")
        if len(msg) > 160:
            msg = msg[:157] + "..."
        lines.append(f"  - {rule}: {msg}" if msg else f"  - {rule}")
    return "ACTIVE INTERVENTIONS (priority — surface to user):\n" + "\n".join(lines)


def _fmt_focus(text: str) -> str:
    text = (text or "").strip()
    if not text:
        return ""
    if len(text) > 280:
        text = text[:277] + "..."
    return f"This week's focus: {text}"


def _resolve_account_id(conn, user_id: str) -> str | None:
    """Return '_all_' if the user has the unified coach state enabled with
    any account, else the user's primary account id, else None."""
    try:
        rows = conn.execute(
            "SELECT id FROM j2_accounts WHERE user_id = ? AND compass_enabled = 1 LIMIT 2",
            (user_id,),
        ).fetchall()
        if len(rows) >= 2:
            return _UNIFIED_ACCOUNT_ID
        if len(rows) == 1:
            return rows[0]["id"]
        # No compass-enabled accounts — try the migration helper
        from api.services.journal_two.accounts import get_or_migrate_default_account
        acct = get_or_migrate_default_account(user_id, conn=conn)
        return acct.get("id") if acct else None
    except Exception as e:
        _log.warning("[session_context] account resolve failed: %s", e)
        return None


def _load_positions(conn, user_id: str, account_id: str) -> list[dict[str, Any]]:
    try:
        from api.services.journal_two import coach_data_assembler
        rows = coach_data_assembler._open_positions(conn, user_id, account_id)
        # Compute days_held if entry_date present
        today = datetime.now(timezone.utc).date()
        for r in rows:
            ed = r.get("entry_date")
            if isinstance(ed, str):
                try:
                    edt = datetime.fromisoformat(ed.replace("Z", "+00:00")).date()
                    r["days_held"] = max(0, (today - edt).days)
                except Exception:
                    r["days_held"] = None
        return rows
    except Exception as e:
        _log.warning("[session_context] open_positions failed: %s", e)
        return []


def _load_interventions(conn, user_id: str, account_id: str) -> list[dict[str, Any]]:
    try:
        from api.services.journal_two import interventions as iv
        return iv.evaluate_interventions(user_id=user_id, account_id=account_id, conn=conn) or []
    except Exception as e:
        _log.warning("[session_context] interventions failed: %s", e)
        return []


def _load_weekly_focus(conn, user_id: str, account_id: str) -> str:
    try:
        row = conn.execute(
            """SELECT metadata FROM j2_coach_outputs
               WHERE user_id = ? AND account_id = ? AND output_type = 'weekly_review'
               ORDER BY created_at DESC LIMIT 1""",
            (user_id, account_id),
        ).fetchone()
        if not row or not row["metadata"]:
            return ""
        meta = json.loads(row["metadata"])
        return str(meta.get("this_weeks_focus") or "")[:500]
    except Exception as e:
        _log.warning("[session_context] weekly_focus failed: %s", e)
        return ""


def build_session_context_block(user_id: str) -> str:
    """Return a "=== YOUR TRADER STATE ===" block ready to append to the
    voice session instructions. Returns "" if nothing meaningful to inject
    (new user with no positions / focus / interventions)."""
    try:
        from api.services.auth_db import get_connection
        conn = get_connection()
    except Exception as e:
        _log.warning("[session_context] no db: %s", e)
        return ""
    try:
        account_id = _resolve_account_id(conn, user_id)
        if not account_id:
            return ""
        positions = _load_positions(conn, user_id, account_id)
        interventions = _load_interventions(conn, user_id, account_id)
        focus = _load_weekly_focus(conn, user_id, account_id)
    finally:
        try: conn.close()
        except Exception: pass

    sections = []
    pos_str = _fmt_positions(positions)
    if pos_str:
        sections.append(pos_str)
    iv_str = _fmt_interventions(interventions)
    if iv_str:
        sections.append(iv_str)
    focus_str = _fmt_focus(focus)
    if focus_str:
        sections.append(focus_str)

    if not sections:
        return ""

    body = "\n".join(sections)
    guidance = (
        "You ALREADY have this state — do not re-fetch with "
        "get_open_positions / check_active_interventions unless the user "
        "asks for fresh prices or a re-check. Cite positions by symbol "
        "when giving advice. If interventions are active, surface them "
        "before any new-trade question."
    )
    return (
        "=== YOUR TRADER STATE (pre-loaded at session start) ===\n"
        + body
        + "\n\n"
        + guidance
        + "\n=== END TRADER STATE ==="
    )
