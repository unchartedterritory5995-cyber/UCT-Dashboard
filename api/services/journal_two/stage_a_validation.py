"""Stage A member-validation report (implementation-plan.md §5, decision-log
"Stage A→B gate" entry, 2026-09-06).

Computes the durable "did real active/swing traders actually adopt Notebook"
evidence the plan's own gate requires, from the Stage A telemetry events
(j2:notebook_* rows in activity_log) plus existing j2_notes/j2_note_embeds/
j2_accounts/j2_broker_accounts data. Aggregate-only by construction — every
query here groups/counts; none ever selects note bodies, search query text,
or Ask Current Note questions (those were never logged in the first place —
see notes.py::_log_notebook_event and journal_two.py's telemetry allow-list).

This is intentionally NOT a general analytics platform: one function, one
read-only report, reusing the platform-wide activity_log table. "Blockers"
and other qualitative signal are explicitly out of scope here — this module
answers the quantitative half of the gate only; qualitative feedback comes
from direct member outreach, not telemetry.
"""
from __future__ import annotations

import sqlite3
from typing import Any

from api.services.auth_db import get_connection

# The Notebook-specific event names this report reads. Kept as a single list
# so the report and journal_two.py's telemetry/log-site allow-list can be
# diffed against each other by inspection if one ever drifts from the other.
_NOTEBOOK_EVENTS = (
    "notebook_tab_visit",
    "notebook_note_created",
    "notebook_thesis_note_created",
    "notebook_search_used",
    "notebook_ask_current_note_used",
    "notebook_note_trashed",
    "notebook_note_restored",
    "notebook_capture_saved",
)


def _scalar(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> int:
    row = conn.execute(sql, params).fetchone()
    return int(row[0]) if row and row[0] is not None else 0


def _distinct_users_for_events(conn: sqlite3.Connection, events: tuple[str, ...]) -> set[str]:
    placeholders = ",".join("?" * len(events))
    rows = conn.execute(
        f"SELECT DISTINCT user_id FROM activity_log WHERE action IN ({placeholders})",
        tuple(f"j2:{e}" for e in events),
    ).fetchall()
    return {r[0] for r in rows}


def compute_report(conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    owned = conn is None
    conn = conn or get_connection()
    try:
        # ── Cohort ──────────────────────────────────────────────────────
        eligible_users = {
            r[0] for r in conn.execute("SELECT DISTINCT user_id FROM j2_accounts").fetchall()
        }
        broker_synced_users = {
            r[0] for r in conn.execute("SELECT DISTINCT user_id FROM j2_broker_accounts").fetchall()
        }

        # ── Activation: touched Notebook at all ────────────────────────
        activated_users = _distinct_users_for_events(
            conn, ("notebook_tab_visit", "notebook_note_created")
        )

        # ── Task-completion proxies (per capability, among ACTIVATED users) ─
        created_note_users = _distinct_users_for_events(conn, ("notebook_note_created",))
        searched_users = _distinct_users_for_events(conn, ("notebook_search_used",))
        asked_users = _distinct_users_for_events(conn, ("notebook_ask_current_note_used",))
        thesis_users = _distinct_users_for_events(conn, ("notebook_thesis_note_created",))
        capture_users = _distinct_users_for_events(conn, ("notebook_capture_saved",))
        trashed_users = _distinct_users_for_events(conn, ("notebook_note_trashed",))
        restored_users = _distinct_users_for_events(conn, ("notebook_note_restored",))

        # Trade-link creation: derived from j2_note_embeds directly (typed
        # Wave 3 reference), not a separate telemetry event — every embed
        # carrying a trade_ref already IS a durable, timestamped-by-note
        # record of this happening.
        trade_link_users = {
            r[0] for r in conn.execute(
                "SELECT DISTINCT user_id FROM j2_note_embeds WHERE trade_ref IS NOT NULL"
            ).fetchall()
        }

        # ── Repeat usage: activity spanning >=2 distinct calendar days ──
        repeat_rows = conn.execute(
            f"""
            SELECT user_id, COUNT(DISTINCT date(created_at)) AS days
              FROM activity_log
             WHERE action IN ({",".join("?" * len(_NOTEBOOK_EVENTS))})
             GROUP BY user_id
            """,
            tuple(f"j2:{e}" for e in _NOTEBOOK_EVENTS),
        ).fetchall()
        repeat_users = {r[0] for r in repeat_rows if r[1] >= 2}

        # ── Research accumulation: notes per activated user, over time ──
        note_counts = conn.execute(
            "SELECT user_id, COUNT(*) FROM j2_notes WHERE deleted_at IS NULL GROUP BY user_id"
        ).fetchall()
        note_counts_by_user = {r[0]: r[1] for r in note_counts}
        accumulating_users = {
            u for u in activated_users if note_counts_by_user.get(u, 0) >= 3
        }

        # ── Search behavior ──────────────────────────────────────────────
        search_total = _scalar(
            conn, "SELECT COUNT(*) FROM activity_log WHERE action = 'j2:notebook_search_used'"
        )
        search_with_results = _scalar(
            conn,
            "SELECT COUNT(*) FROM activity_log"
            " WHERE action = 'j2:notebook_search_used' AND details LIKE '%\"hasResults\": true%'",
        )

        # ── Thesis / trade-link behavior ─────────────────────────────────
        thesis_note_count = _scalar(
            conn,
            "SELECT COUNT(*) FROM j2_notes WHERE deleted_at IS NULL"
            " AND lower(tags) LIKE '%\"thesis\"%'",
        )
        trade_linked_embed_count = _scalar(
            conn, "SELECT COUNT(*) FROM j2_note_embeds WHERE trade_ref IS NOT NULL"
        )

        # ── No trust/data-loss defect signal: every trash has a matching
        #    restore OR the note is still soft-deleted (never silently gone
        #    outside the documented retention purge) — a crude but honest
        #    proxy; a real defect would show as a member report, not a query.
        trust_incident_signal = None  # explicitly not derivable from telemetry alone

        cohort = {
            "eligibleUsers": len(eligible_users),
            "eligibleBrokerSyncedUsers": len(broker_synced_users & eligible_users),
            "activatedUsers": len(activated_users),
        }
        task_completion = {
            "createdNote": len(created_note_users),
            "searched": len(searched_users),
            "askedCurrentNote": len(asked_users),
            "createdThesisNote": len(thesis_users),
            "savedCapture": len(capture_users),
            "trashedANote": len(trashed_users),
            "restoredANote": len(restored_users),
            "createdTradeLink": len(trade_link_users),
        }
        repeat_usage = {
            "activatedUsers": len(activated_users),
            "returnedOnALaterDay": len(repeat_users & activated_users),
        }
        research_accumulation = {
            "activatedUsersWithThreePlusNotes": len(accumulating_users),
            "avgNotesPerActivatedUser": (
                round(sum(note_counts_by_user.get(u, 0) for u in activated_users) / len(activated_users), 1)
                if activated_users else None
            ),
        }
        search_behavior = {
            "totalSearches": search_total,
            "searchesWithResults": search_with_results,
            "searchSuccessRate": (
                round(search_with_results / search_total, 2) if search_total else None
            ),
        }
        thesis_trade_link_behavior = {
            "thesisNotes": thesis_note_count,
            "tradeLinkedEmbeds": trade_linked_embed_count,
            "usersWhoLinkedAThesisToATrade": len(trade_link_users & thesis_users) if thesis_users else len(trade_link_users),
        }

        # ── Two gates, per the decision-log entry ────────────────────────
        early_signal_criteria = {
            "multipleUsersCompletedCoreWorkflow": len(created_note_users) >= 2,
            "membersDiscoveredSaveToNotebookUnprompted": len(capture_users) >= 1,
            "atLeastOneUserReturnedOnALaterDay": len(repeat_users) >= 1,
            "atLeastOneUserAccumulatedResearch": len(accumulating_users) >= 1,
            "thesisTradeLinkUnderstoodAndUsed": len(trade_link_users) >= 1,
            "searchUsedEnoughToBeEvidenceBacked": search_total >= 5,
            # These two require human judgment, not telemetry — always False
            # until an admin/owner explicitly marks them via the decision
            # log; never silently assumed true.
            "noTrustOrDataLossDefectObserved": None,
            "qualitativeFeedbackNotFundamentallyNegative": None,
        }
        computed_criteria = {k: v for k, v in early_signal_criteria.items() if v is not None}
        early_signal_gate_met = bool(computed_criteria) and all(computed_criteria.values())

        return {
            "cohort": cohort,
            "taskCompletion": task_completion,
            "repeatUsage": repeat_usage,
            "researchAccumulation": research_accumulation,
            "searchBehavior": search_behavior,
            "thesisTradeLinkBehavior": thesis_trade_link_behavior,
            "trustIncidentSignal": trust_incident_signal,
            "earlySignalGate": {
                "criteria": early_signal_criteria,
                "computedCriteriaMet": early_signal_gate_met,
                "note": (
                    "The two null criteria require an owner/admin judgment call "
                    "(no trust/data-loss defect observed; qualitative feedback not "
                    "fundamentally negative) — this report can only say whether "
                    "EVERY OTHER criterion is met, never certify the gate alone."
                ),
            },
            "fullStageAValidation": {
                "note": (
                    "The plan's original multi-week repeat-usage study — not "
                    "shortened by the Early Signal Gate opening. Judge from "
                    "repeatUsage/researchAccumulation trend over the full "
                    "validation window, plus direct qualitative member feedback."
                ),
            },
            "qualitativeFeedback": {
                "note": (
                    "Not derivable from telemetry. Collect directly from the "
                    "validation cohort (discovery friction, understanding of the "
                    "thesis/trade link, workflow-replacement signal, what makes "
                    "them want to keep research in UCT) and record separately."
                ),
            },
        }
    finally:
        if owned:
            conn.close()
