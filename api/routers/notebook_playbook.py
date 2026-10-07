"""My Playbook routes (wave 13, lane 13B): the member's own edge, measured honestly.

  member  GET  /api/j2/my-playbook?accountId=   session  per-setup stats with R3 ranges, the trades
                                                         behind every number, "From your notes",
                                                         and "what you wrote before losses vs wins"

ONE STATS AUTHORITY. Every per-setup number is `playbook_stats.get_playbook_stats` (the same
function the Insights cards read), with its uncertainty fields; this router composes, it never
computes a stat. The patterns are `playbook_patterns.py`: fixed word lists, counts, citations.
No model is called anywhere on this path.

The rules (13A's router, `notebook_plan_grades.py`):
  * THE GATE IS A ROUTER DEPENDENCY: `NOTEBOOK_PLAYBOOK_ENABLED` off answers the one 404 for every
    route before the session is read.
  * MEMBER-SCOPED: every read is keyed on the session member's id; `accountId` only narrows the
    member's OWN trades (another member's account id simply matches nothing).
  * READ-ONLY: no route here writes a trade, a note or a table. The frozen snapshot note is created
    by the client through the Notebook's one create door, never here.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.auth_db import get_connection
from api.services.journal_two import playbook_patterns, playbook_stats, sample_size
from api.services.notebook_flags import flag_on

FLAG = "NOTEBOOK_PLAYBOOK_ENABLED"


def enabled() -> bool:
    """The gate, read per call through the one parser (unset = OFF)."""
    return flag_on(FLAG, False)


def _require_enabled() -> None:
    """Router-level: an off gate reads no session."""
    if not enabled():
        raise HTTPException(status_code=404, detail="Not Found")


router = APIRouter(
    prefix="/api/j2/my-playbook",
    tags=["journal-2-0", "notebook-playbook"],
    dependencies=[Depends(_require_enabled)],
)


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, per router, with its own sentence (tests/test_user_definitions_auth.py
    reads the sentence as a literal in the HTTPException call).
    Owner ruling 2026-10-02: there is no free tier, so every Notebook member route takes
    a paid plan (security review I-7; railed by tests/test_paywall_gate_free_tier.py)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="My Playbook requires a paid plan")
    return user


def build_payload(conn, user_id: str, account_id: str | None) -> dict[str, Any]:
    """Everything My Playbook shows. Every number in it is the authority's own value."""
    setups = playbook_stats.get_playbook_stats(user_id, account_id, conn=conn, with_trades=True)
    return {
        "asOf": datetime.now(timezone.utc).isoformat(),
        "accountId": account_id,
        "setups": setups,
        "untagged": {"count": playbook_stats.untagged_count(user_id, account_id, conn=conn)},
        "notesBySetup": playbook_patterns.notes_by_setup(conn, user_id, setups),
        "patterns": playbook_patterns.behaviour_patterns(conn, user_id, account_id),
        "sample": sample_size.constants(),
    }


@router.get("")
def get_my_playbook(accountId: str | None = Query(None, max_length=128),  # noqa: N803 -- the client's name
                    user: dict = Depends(require_paid)) -> dict[str, Any]:
    conn = get_connection()
    try:
        return build_payload(conn, user["id"], accountId or None)
    finally:
        conn.close()
