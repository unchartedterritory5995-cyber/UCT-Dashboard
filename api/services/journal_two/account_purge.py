"""Account-deletion purge for the Journal 2.0 / Notebook table family (j2_*).

Discovered 2026-09-05 (UCT Notebook Primary-Platform Phase One adversarial
research, independently re-verified by direct schema execution): none of the
60+ `j2_*` tables declare a foreign key to `users(id)`. `api/routers/auth.py`'s
`_cascade_delete_user` discovers what to wipe purely via
`PRAGMA foreign_key_list`, so it silently never touches any of them, despite
its own docstring claiming "journal/j2_*" coverage. A member whose account is
deleted keeps every note, trade, position, verdict, chat message, and
attachment indefinitely, orphaned under a `user_id` with no corresponding
`users` row.

This purges every row (direct or indirect ownership) across that whole table
family for one `user_id`, plus the on-disk attachment tree. Call BEFORE
`_cascade_delete_user` — same convention as, and in addition to, the existing
narrower broker-only purge in `journal_two/broker/service.py` (which covers
5 of the 14 `j2_broker_*` tables and the external SnapTrade revoke; this
function's own broker rows are redundant-safe overlap with that one, and it
additionally covers the 9 broker tables that purge does not).
"""

from __future__ import annotations

import logging
import shutil
import sqlite3
from typing import Any

log = logging.getLogger("journal_two.account_purge")

# Tables with a direct `user_id` column — one DELETE each.
_DIRECT_USER_TABLES = (
    # Core journal (accounts/positions/trades/day-notes)
    "j2_settings",
    "j2_positions",
    "j2_trades",
    "j2_day_notes",
    "j2_accounts",
    "j2_option_strategies",
    "j2_playbook_entries",
    # Compass coaching layer
    "j2_coach_outputs",
    "j2_chat_messages",
    "j2_onboarding_responses",
    "j2_verdicts",
    "j2_trade_reviews",
    "j2_interventions",
    "j2_profile_suggestions",
    "j2_journal_rules",
    "j2_unified_coach_state",
    "j2_weekly_email_log",
    # Notebook
    "j2_notes",
    "j2_note_folders",
    "j2_note_embeds",
    "j2_note_mentions",
    "j2_note_favorites",
    "j2_note_recents",
    "j2_note_versions",
    "j2_capture_inbox",
    "j2_public_profiles",
    "j2_note_shares",
    # Note connectors / Obsidian sync
    "j2_note_connectors",
    "j2_note_sources",
    "j2_note_sync_log",
    "j2_note_remote_index",
    "j2_obsidian_devices",
    "j2_obsidian_staging",
    "j2_obsidian_manifest",
    "j2_obsidian_connect_epoch",
    # Trade-ref-keyed extras (attachments/excursions/rule-adherence)
    "j2_trade_attachments",
    "j2_trade_excursions",
    "j2_trade_adherence",
    # Broker (SnapTrade) — superset of broker/service.py's narrower purge
    "j2_broker_users",
    "j2_broker_accounts",
    "j2_broker_equity_snapshots",
    "j2_broker_activities",
    "j2_broker_sync_log",
    "j2_broker_dup_flags",
    "j2_broker_cash_flows",
    "j2_broker_opt_holdings_memo",
    "j2_broker_mirror_checks",
    "j2_broker_drift_series",
    "j2_broker_precise_times",
    "j2_broker_live_checks",
)

# j2_broker_digest_dedup is deliberately excluded: it is a single global row
# (id='fleet_digest') for the OWNER's own fleet-check digest, not per-user
# member data — nothing to purge per account.


def purge_user_data(user_id: str, conn: sqlite3.Connection) -> dict[str, Any]:
    """Delete every row across the Journal 2.0 / Notebook table family for
    one `user_id`, plus their on-disk attachment tree.

    Best-effort per table — one bad table can never abort the rest. Returns
    a report so a caller can distinguish "purged clean" from "purged with
    errors" rather than a bare boolean.
    """
    errors: list[str] = []
    deleted: dict[str, int] = {}

    def _run(table: str, sql: str, params: tuple) -> int:
        try:
            cur = conn.execute(sql, params)
            return cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
        except sqlite3.OperationalError as e:
            if "no such table" in str(e).lower():
                return 0
            errors.append(f"{table}: {e}")
            log.warning("journal_two account purge failed on %s: %s", table, e)
            return 0

    # Indirect ownership — no user_id column, joined through the parent row
    # that IS user-owned. Run these first, while the parent rows they key off
    # of still exist.
    deleted["j2_option_legs"] = _run(
        "j2_option_legs",
        "DELETE FROM j2_option_legs WHERE strategy_id IN "
        "(SELECT id FROM j2_option_strategies WHERE user_id = ?)",
        (user_id,),
    )
    deleted["j2_broker_member_stale_notify"] = _run(
        "j2_broker_member_stale_notify",
        "DELETE FROM j2_broker_member_stale_notify WHERE broker_account_id IN "
        "(SELECT id FROM j2_broker_accounts WHERE user_id = ?)",
        (user_id,),
    )

    for table in _DIRECT_USER_TABLES:
        deleted[table] = _run(table, f"DELETE FROM {table} WHERE user_id = ?", (user_id,))

    conn.commit()

    # On-disk attachments: notebook inline/hero images AND trade screenshots
    # both nest under one per-user directory (attachment_root()/user_id) by
    # construction — see attachment_gc.py's own `root / user_id` walk and
    # trade_attachments.py's `_ATTACHMENT_ROOT / user_id / "trades"`. One
    # directory removal covers every attachment sub-type, present or future.
    freed_dirs = 0
    try:
        from api.services.journal_two.attachment_root import (
            LEGACY_ATTACHMENT_ROOT,
            attachment_root,
        )

        for root in (attachment_root(), LEGACY_ATTACHMENT_ROOT):
            udir = root / user_id
            if udir.is_dir():
                shutil.rmtree(udir, ignore_errors=True)
                freed_dirs += 1
    except Exception as e:  # noqa: BLE001 — disk cleanup must never mask the DB purge's result
        errors.append(f"attachments: {e}")
        log.warning("journal_two attachment purge failed for %s: %s", user_id, e)

    return {
        "ok": not errors,
        "user_id": user_id,
        "rows_deleted": deleted,
        "total_rows_deleted": sum(deleted.values()),
        "attachment_dirs_removed": freed_dirs,
        "errors": errors,
    }
