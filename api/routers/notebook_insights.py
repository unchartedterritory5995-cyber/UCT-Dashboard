"""Notebook cross-note reads (wave 6, Phase 2): tasks across notes and
unlinked mentions. READ-ONLY by decision — see each service's docstring.

  GET /api/j2/notes/tasks?status=open|done|all&due=overdue|today|week|none
  GET /api/j2/notes/{note_id}/unlinked-mentions?limit=

⛔⛔ MOUNT ORDER IS LOAD-BEARING. `api/routers/journal_two.py` declares
`GET /api/j2/notes/{note_id}`, and FastAPI answers on first match, so if that
router is included first, `/api/j2/notes/tasks` is served as "the note whose id
is 'tasks'" — a 404 that looks like an empty task list. This router MUST be
included in api/main.py BEFORE `journal_two_router`.
`tests/test_notebook_insights_router.py` demonstrates both orders.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import get_current_user
from api.services.journal_two import note_mentions, note_tasks

router = APIRouter(prefix="/api/j2", tags=["journal-2-0", "notebook-insights"])


@router.get("/notes/tasks")
def notes_tasks(
    status: str = Query(default="open"),
    due: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    if status not in note_tasks.STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of {', '.join(note_tasks.STATUSES)}")
    if due is not None and due not in note_tasks.DUE_FILTERS:
        raise HTTPException(status_code=400, detail=f"due must be one of {', '.join(note_tasks.DUE_FILTERS)}")
    return note_tasks.list_tasks(user["id"], status=status, due=due)


@router.get("/notes/{note_id}/unlinked-mentions")
def note_unlinked_mentions(
    note_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Like the backlinks read, this does not 404 a note the member does not
    own or that does not exist — it answers with an empty list. The note page
    is what enforces existence; this is a read ABOUT the note."""
    return note_mentions.get_unlinked_mentions(user["id"], note_id, limit=limit)
