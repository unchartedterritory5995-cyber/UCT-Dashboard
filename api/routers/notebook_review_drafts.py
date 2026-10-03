"""Reviews-that-write-themselves routes (wave 13, lane 13F): the DATA behind a one-click
daily, weekly or monthly review draft.

  member  GET  /api/j2/review-drafts/daily?day=&accountId=      session  trades/P&L, discipline,
  member  GET  /api/j2/review-drafts/weekly?weekStart=&accountId=        setup changes, links,
  member  GET  /api/j2/review-drafts/monthly?month=&accountId=           best/worst trade, leaks

ONE AUTHORITY PER NUMBER. This router composes `review_drafts.py`; it never computes a stat
itself. No model is called anywhere on this path (no background drafts, no LLM narrative).

The rules (mirroring 13A/13B's routers):
  * THE GATE IS A ROUTER DEPENDENCY: `NOTEBOOK_REVIEW_DRAFTS_ENABLED` off answers the one 404 for
    every route before the session is read.
  * MEMBER-SCOPED: every read is keyed on the session member's id; `accountId` only narrows the
    member's OWN trades.
  * READ-ONLY: no route here writes a trade, a note or a table. The note itself is created by the
    client through the Notebook's one create door (daily: appended to the member's daily note;
    weekly/monthly: a new note), never here.
"""
from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import get_current_user
from api.services.auth_db import get_connection
from api.services.journal_two import review_drafts
from api.services.journal_two.unified_coach import UNIFIED_ACCOUNT_ID

FLAG = review_drafts.FLAG


def enabled() -> bool:
    """The gate, read per call through the one parser (unset = OFF)."""
    return review_drafts.enabled()


def _require_enabled() -> None:
    """Router-level: an off gate reads no session."""
    if not enabled():
        raise HTTPException(status_code=404, detail="Not Found")


router = APIRouter(
    prefix="/api/j2/review-drafts",
    tags=["journal-2-0", "notebook-review-drafts"],
    dependencies=[Depends(_require_enabled)],
)

_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")


def _account(account_id: str | None) -> str:
    return account_id or UNIFIED_ACCOUNT_ID


@router.get("/daily")
def get_daily_draft(
    day: str = Query(..., max_length=10),
    accountId: str | None = Query(None, max_length=128),  # noqa: N803 -- the client's name
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    if not _DAY_RE.match(day or ""):
        raise HTTPException(status_code=422, detail="day must be YYYY-MM-DD")
    conn = get_connection()
    try:
        return review_drafts.build_daily_draft(conn, user["id"], _account(accountId), day)
    finally:
        conn.close()


@router.get("/weekly")
def get_weekly_draft(
    weekStart: str = Query(..., max_length=10),  # noqa: N803
    accountId: str | None = Query(None, max_length=128),  # noqa: N803
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    if not _DAY_RE.match(weekStart or ""):
        raise HTTPException(status_code=422, detail="weekStart must be YYYY-MM-DD")
    conn = get_connection()
    try:
        return review_drafts.build_weekly_draft(conn, user["id"], _account(accountId), weekStart)
    finally:
        conn.close()


@router.get("/monthly")
def get_monthly_draft(
    month: str = Query(..., max_length=7),
    accountId: str | None = Query(None, max_length=128),  # noqa: N803
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    if not _MONTH_RE.match(month or ""):
        raise HTTPException(status_code=422, detail="month must be YYYY-MM")
    conn = get_connection()
    try:
        return review_drafts.build_monthly_draft(conn, user["id"], _account(accountId), month)
    finally:
        conn.close()
