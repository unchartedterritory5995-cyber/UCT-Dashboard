"""Stage A member-validation report (implementation-plan.md §5, decision-log
"Stage A→B gate" entry, 2026-09-06; refined by the "activate the real beta
cohort" checkpoint, also 2026-09-06).

Computes the durable "did real active/swing traders actually adopt Notebook"
evidence the plan's own gate requires, from the Stage A telemetry events
(j2:notebook_* rows in activity_log) plus existing j2_notes/j2_note_embeds/
j2_accounts/j2_broker_accounts/users data. Aggregate-only by construction —
every query here groups/counts; none ever selects note bodies, search query
text, or Ask Current Note questions (those were never logged in the first
place — see notes.py::_log_notebook_event and journal_two.py's telemetry
allow-list).

This is intentionally NOT a general analytics platform: one function, one
read-only report, reusing the platform-wide activity_log table. "Blockers"
and other qualitative signal are explicitly out of scope here — this module
answers the quantitative half of the gate only; qualitative feedback comes
from direct member outreach, not telemetry.

⛔ ADMIN/TEST-ACCOUNT EXCLUSION: every count in this report excludes
`users.role = 'admin'` (the same role convention the rest of the codebase
already uses for admin gating — see auth_db.py). Admin accounts are used for
QA/E2E/manual verification and must never be able to make the Early Signal
Gate look satisfied on their own. There is no separate "test account" flag
in this schema; admin exclusion is the available, real convention to reuse.

⛔ NO SINGLE MEMBER CAN SATISFY A CRITERION ALONE: every "did members do X"
criterion requires MULTI_USER_MIN distinct non-admin members, not one
enthusiastic user (2026-09-06 checkpoint item 11 — "do not let one power
user fake the gate").
"""
from __future__ import annotations

import sqlite3
from typing import Any

from api.services.auth_db import get_connection

# ── Tunable thresholds (named so a criterion's bar is a single, documented
#    number, not a magic literal buried in a comparison) ──────────────────
MULTI_USER_MIN = 3  # "multiple members," not one power user (checkpoint item 11)
SEARCH_MIN_TOTAL_EVENTS = 5
SEARCH_MIN_DISTINCT_USERS = MULTI_USER_MIN
RESEARCH_ACCUMULATION_NOTE_MIN = 3  # notes a user must hold to count as "accumulating"
RECENT_ACTIVITY_DAYS = 30  # window for the "recently active" cohort slice

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

_NOT_ADMIN_SUBQUERY = "SELECT id FROM users WHERE role = 'admin'"


def _scalar(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> int:
    row = conn.execute(sql, params).fetchone()
    return int(row[0]) if row and row[0] is not None else 0


def _admin_user_ids(conn: sqlite3.Connection) -> set[str]:
    return {r[0] for r in conn.execute("SELECT id FROM users WHERE role = 'admin'").fetchall()}


def _distinct_users_for_events(
    conn: sqlite3.Connection, events: tuple[str, ...], admin_ids: set[str]
) -> set[str]:
    placeholders = ",".join("?" * len(events))
    rows = conn.execute(
        f"SELECT DISTINCT user_id FROM activity_log WHERE action IN ({placeholders})",
        tuple(f"j2:{e}" for e in events),
    ).fetchall()
    return {r[0] for r in rows} - admin_ids


def compute_report(conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    owned = conn is None
    conn = conn or get_connection()
    try:
        admin_ids = _admin_user_ids(conn)

        # ── Cohort ──────────────────────────────────────────────────────
        total_registered_users = _scalar(conn, "SELECT COUNT(*) FROM users")
        eligible_users = {
            r[0] for r in conn.execute("SELECT DISTINCT user_id FROM j2_accounts").fetchall()
        } - admin_ids
        broker_synced_users = {
            r[0] for r in conn.execute("SELECT DISTINCT user_id FROM j2_broker_accounts").fetchall()
        } - admin_ids
        recently_active_users = {
            r[0] for r in conn.execute(
                "SELECT id FROM users WHERE last_login_at IS NOT NULL"
                " AND last_login_at >= datetime('now', ?)",
                (f"-{RECENT_ACTIVITY_DAYS} days",),
            ).fetchall()
        } - admin_ids
        # Preferred beachhead: recently active AND Journal 2.0 user AND
        # broker-synced (checkpoint item 4) — narrower and higher-signal
        # than "ever created a j2_accounts row," reported alongside it so
        # neither number alone is mistaken for the whole picture.
        recommended_beachhead = recently_active_users & eligible_users & broker_synced_users

        # ── Activation: touched Notebook at all ────────────────────────
        activated_users = _distinct_users_for_events(
            conn, ("notebook_tab_visit", "notebook_note_created"), admin_ids
        )

        # ── Task-completion proxies (per capability, among ACTIVATED users) ─
        created_note_users = _distinct_users_for_events(conn, ("notebook_note_created",), admin_ids)
        searched_users = _distinct_users_for_events(conn, ("notebook_search_used",), admin_ids)
        asked_users = _distinct_users_for_events(conn, ("notebook_ask_current_note_used",), admin_ids)
        thesis_users = _distinct_users_for_events(conn, ("notebook_thesis_note_created",), admin_ids)
        capture_users = _distinct_users_for_events(conn, ("notebook_capture_saved",), admin_ids)
        trashed_users = _distinct_users_for_events(conn, ("notebook_note_trashed",), admin_ids)
        restored_users = _distinct_users_for_events(conn, ("notebook_note_restored",), admin_ids)

        # Trade-link creation: derived from j2_note_embeds directly (typed
        # Wave 3 reference), not a separate telemetry event — every embed
        # carrying a trade_ref already IS a durable, timestamped-by-note
        # record of this happening.
        trade_link_users = {
            r[0] for r in conn.execute(
                "SELECT DISTINCT user_id FROM j2_note_embeds WHERE trade_ref IS NOT NULL"
            ).fetchall()
        } - admin_ids

        # ── Repeat usage: activity spanning >=2 distinct calendar days ──
        # (Calendar-day distinct-count is refresh-safe by construction: a
        # member reloading the tab 50 times in one day still contributes
        # exactly one day to this count, so it can't be inflated by a
        # single noisy session — see checkpoint item 9.)
        repeat_rows = conn.execute(
            f"""
            SELECT user_id, COUNT(DISTINCT date(created_at)) AS days
              FROM activity_log
             WHERE action IN ({",".join("?" * len(_NOTEBOOK_EVENTS))})
             GROUP BY user_id
            """,
            tuple(f"j2:{e}" for e in _NOTEBOOK_EVENTS),
        ).fetchall()
        repeat_users = {r[0] for r in repeat_rows if r[1] >= 2} - admin_ids

        # ── Research accumulation: notes per activated user, over time ──
        note_counts = conn.execute(
            "SELECT user_id, COUNT(*) FROM j2_notes WHERE deleted_at IS NULL GROUP BY user_id"
        ).fetchall()
        note_counts_by_user = {r[0]: r[1] for r in note_counts}
        accumulating_users = {
            u for u in activated_users if note_counts_by_user.get(u, 0) >= RESEARCH_ACCUMULATION_NOTE_MIN
        }

        # ── Search behavior (admin-excluded) ─────────────────────────────
        search_total = _scalar(
            conn,
            f"SELECT COUNT(*) FROM activity_log WHERE action = 'j2:notebook_search_used'"
            f" AND user_id NOT IN ({_NOT_ADMIN_SUBQUERY})",
        )
        search_with_results = _scalar(
            conn,
            "SELECT COUNT(*) FROM activity_log"
            " WHERE action = 'j2:notebook_search_used' AND details LIKE '%\"hasResults\": true%'"
            f" AND user_id NOT IN ({_NOT_ADMIN_SUBQUERY})",
        )

        # ── Thesis / trade-link behavior (admin-excluded) ────────────────
        thesis_note_count = _scalar(
            conn,
            "SELECT COUNT(*) FROM j2_notes WHERE deleted_at IS NULL"
            " AND lower(tags) LIKE '%\"thesis\"%'"
            f" AND user_id NOT IN ({_NOT_ADMIN_SUBQUERY})",
        )
        trade_linked_embed_count = _scalar(
            conn,
            "SELECT COUNT(*) FROM j2_note_embeds WHERE trade_ref IS NOT NULL"
            f" AND user_id NOT IN ({_NOT_ADMIN_SUBQUERY})",
        )

        # ── No trust/data-loss defect signal: not derivable from telemetry
        #    alone — a real defect surfaces as a member report, not a query.
        trust_incident_signal = None

        cohort = {
            "totalRegisteredUsers": total_registered_users,
            "eligibleUsers": len(eligible_users),
            "eligibleBrokerSyncedUsers": len(broker_synced_users & eligible_users),
            "recentlyActiveUsers": len(recently_active_users),
            "recentlyActiveUsersWindowDays": RECENT_ACTIVITY_DAYS,
            "recommendedBeachheadCohort": len(recommended_beachhead),
            "recommendedBeachheadDefinition": (
                "recently active (login within the window) AND Journal 2.0 user "
                "AND broker-synced -- narrower and higher-signal than 'ever created "
                "a j2_accounts row'; both numbers are reported so neither is "
                "mistaken for the whole eligible population."
            ),
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
            "distinctUsersWhoSearched": len(searched_users),
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

        # ── The Early Signal Gate's exact eight criteria, each explicit:
        #    name / why it matters / metric / threshold / current value /
        #    status. Six are computable from telemetry; two require an
        #    owner judgment call and are NEVER silently assumed true.
        def _status(passed: bool | None) -> str:
            if passed is None:
                return "REQUIRES_OWNER_JUDGMENT"
            return "PASS" if passed else "FAIL"

        multi_workflow_current = len(created_note_users)
        discovery_current = len(capture_users)
        repeat_current = len(repeat_users & activated_users)
        accumulation_current = len(accumulating_users)
        trade_link_current = len(trade_link_users)
        search_users_current = len(searched_users)

        criteria = [
            {
                "key": "multipleMembersCompletedCoreWorkflow",
                "name": "Multiple members completed the core workflow",
                "why": (
                    "Proves task completion (capture -> write -> organize) is a "
                    "real capability, not one person's fluke."
                ),
                "metric": "distinct non-admin members with a notebook_note_created event",
                "threshold": f">= {MULTI_USER_MIN} members",
                "currentValue": multi_workflow_current,
                "passed": multi_workflow_current >= MULTI_USER_MIN,
            },
            {
                "key": "multipleMembersDiscoveredSaveToNotebookUnprompted",
                "name": "Multiple members discovered Save to Notebook unprompted",
                "why": "Organic feature discovery, not staff instruction, is the real discoverability signal.",
                "metric": "distinct non-admin members with a notebook_capture_saved event",
                "threshold": f">= {MULTI_USER_MIN} members",
                "currentValue": discovery_current,
                "passed": discovery_current >= MULTI_USER_MIN,
            },
            {
                "key": "multipleMembersReturnedOnALaterDay",
                "name": "Multiple members returned on a later day",
                "why": (
                    "Repeat usage is the strongest Stage A signal: the member put "
                    "something in Notebook and came back because they needed it."
                ),
                "metric": "distinct non-admin activated members with Notebook activity on >= 2 distinct calendar days",
                "threshold": f">= {MULTI_USER_MIN} members",
                "currentValue": repeat_current,
                "passed": repeat_current >= MULTI_USER_MIN,
            },
            {
                "key": "multipleMembersAccumulatedResearch",
                "name": "Multiple members accumulated research (not one-time trial)",
                "why": "Notebook must become cumulative, not disposable, to replace an existing workflow.",
                "metric": f"distinct non-admin activated members with >= {RESEARCH_ACCUMULATION_NOTE_MIN} non-deleted notes",
                "threshold": f">= {MULTI_USER_MIN} members",
                "currentValue": accumulation_current,
                "passed": accumulation_current >= MULTI_USER_MIN,
            },
            {
                "key": "thesisTradeLinkUnderstoodAndUsedByMultipleMembers",
                "name": "The thesis-trade link is understood and used by multiple members",
                "why": "Proves the Wave 3 thesis<->trade contract is a real, adopted workflow, not unused surface area.",
                "metric": "distinct non-admin members with >= 1 trade-linked note embed",
                "threshold": f">= {MULTI_USER_MIN} members",
                "currentValue": trade_link_current,
                "passed": trade_link_current >= MULTI_USER_MIN,
            },
            {
                "key": "searchUsedEnoughToBeEvidenceBacked",
                "name": "Search is used enough to justify Wave 4's retrieval investment",
                "why": "Wave 4 IS the search wave -- shipping it on unused search would be building on an unmeasured assumption.",
                "metric": f"total non-admin notebook_search_used events AND distinct searching members",
                "threshold": f">= {SEARCH_MIN_TOTAL_EVENTS} events AND >= {SEARCH_MIN_DISTINCT_USERS} distinct members",
                "currentValue": {"totalSearches": search_total, "distinctUsers": search_users_current},
                "passed": search_total >= SEARCH_MIN_TOTAL_EVENTS and search_users_current >= SEARCH_MIN_DISTINCT_USERS,
            },
            {
                "key": "noTrustOrDataLossDefectObserved",
                "name": "No trust or data-loss defect observed",
                "why": "Per the plan's own Wave 0 exit criteria, a failed trash/delete/recover is independently disqualifying regardless of every other metric.",
                "metric": "owner/admin judgment call -- not derivable from telemetry",
                "threshold": "owner confirms no such defect was observed or reported",
                "currentValue": None,
                "passed": None,
            },
            {
                "key": "qualitativeFeedbackNotFundamentallyNegative",
                "name": "Qualitative feedback does not indicate the Stage A model is fundamentally misunderstood",
                "why": "A statistically-satisfied gate is meaningless if the members who did use it found it confusing or pointless.",
                "metric": "owner/admin judgment call from direct member outreach -- not derivable from telemetry",
                "threshold": "owner confirms feedback collected is not fundamentally negative",
                "currentValue": None,
                "passed": None,
            },
        ]
        for c in criteria:
            c["status"] = _status(c["passed"])

        computable = [c for c in criteria if c["passed"] is not None]
        early_signal_gate_met = bool(computable) and all(c["passed"] for c in computable)

        return {
            "cohort": cohort,
            "taskCompletion": task_completion,
            "repeatUsage": repeat_usage,
            "researchAccumulation": research_accumulation,
            "searchBehavior": search_behavior,
            "thesisTradeLinkBehavior": thesis_trade_link_behavior,
            "trustIncidentSignal": trust_incident_signal,
            "earlySignalGate": {
                "criteria": criteria,
                "computedCriteriaMet": early_signal_gate_met,
                "note": (
                    "computedCriteriaMet reflects ONLY the six telemetry-derivable "
                    "criteria. The two REQUIRES_OWNER_JUDGMENT criteria are never "
                    "silently assumed true, and even when every criterion here "
                    "passes, this report does not itself authorize Wave 4 -- the "
                    "owner makes the final gate decision (decision-log, "
                    "2026-09-06 checkpoint item 20)."
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
