"""TERMINAL-NEXT lane T3 -- the command grammar's server routes (api/services/terminal_grammar.py).

Every route carries BOTH gates, in this order of meaning (rollout_gate.require_cohort):
`_require_paid` answers "may you be here at all" (402), `require_terminal_next` answers
"has the shell been released to you" (404, byte-identical to an unknown route). The shell
these serve is itself paid and cohort-gated, so neither gate narrows a real member.

A THIRD gate sits in front of both: the dark flag `TERMINAL_GRAMMAR_ENABLED`
(docs/feature_flags.json). Unset, every route answers 404 before identity is read.

Routes are plain `def` (SQLite + sync service calls): they run on the threadpool, never on
the event loop (tests/test_async_routes_do_not_block.py).

Every read and write is OWNER-SCOPED by the session's user id; no route takes a user id.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import terminal_grammar as tg
from api.services.rollout_gate import require_terminal_next


def _require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, never imported from a sibling (this codebase's per-router 402 rule)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The UCT Terminal requires a paid plan")
    return user


def _require_enabled() -> None:
    """The dark flag: off means the route does not exist (404, the same as an unknown path)."""
    if not tg.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


router = APIRouter(dependencies=[Depends(_require_enabled), Depends(require_terminal_next),
                                 Depends(_require_paid)])


class CommandEvent(BaseModel):
    key: str = Field(..., min_length=1, max_length=16)


class AliasBody(BaseModel):
    expansion: str = Field(..., min_length=1, max_length=tg.MAX_EXPANSION_LEN)


@router.post("/api/terminal/commands/event")
def command_event(body: CommandEvent, user: dict = Depends(get_current_user_with_plan)):
    """Count one command for the caller. Counts only: `key` is a code, alias name or kind."""
    if not tg.record_event(str(user["id"]), body.key):
        raise HTTPException(status_code=400, detail="invalid command key")
    return {"ok": True}


@router.get("/api/terminal/commands/stats")
def command_stats(user: dict = Depends(get_current_user_with_plan)):
    return {"stats": tg.command_stats(str(user["id"]))}


@router.delete("/api/terminal/commands/stats")
def reset_command_stats(user: dict = Depends(get_current_user_with_plan)):
    """The ranking's Reset control: forgets the caller's counts (theirs only)."""
    return {"reset": tg.reset_stats(str(user["id"]))}


@router.get("/api/terminal/aliases")
def get_aliases(user: dict = Depends(get_current_user_with_plan)):
    return {"aliases": tg.list_aliases(str(user["id"]))}


@router.put("/api/terminal/aliases/{name}")
def put_alias(body: AliasBody, name: str = Path(..., min_length=2, max_length=12),
              user: dict = Depends(get_current_user_with_plan)):
    try:
        return tg.set_alias(str(user["id"]), name, body.expansion)
    except tg.AliasRefused as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/api/terminal/aliases/{name}")
def remove_alias(name: str = Path(..., min_length=1, max_length=12),
                 user: dict = Depends(get_current_user_with_plan)):
    if not tg.delete_alias(str(user["id"]), name):
        raise HTTPException(status_code=404, detail="No such alias")
    return {"ok": True}


@router.get("/api/terminal/move/{sym}")
def why_moving(sym: str = Path(..., min_length=1, max_length=8),
               change_pct: Optional[float] = Query(None, ge=-100, le=10000),
               user: dict = Depends(get_current_user_with_plan)):
    """MOVE / WIIM: the existing intelligence + catalyst services for one security, plus
    what is new since the caller's last MOVE visit to it."""
    try:
        return tg.why_moving(str(user["id"]), sym, include_catalysts=is_paid_user(user),
                             change_pct=change_pct)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/api/terminal/compare-target")
def compare_target(sym: str = Query(..., min_length=1, max_length=8),
                   mode: str = Query("sector", pattern="^sector$"),
                   user: dict = Depends(get_current_user_with_plan)):
    """V18: the comparator a mode resolves to (today: `sector` -> that sector's SPDR ETF)."""
    try:
        out = tg.compare_target(sym)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not out.get("comparator"):
        raise HTTPException(status_code=404, detail=f"No sector ETF is known for {out['sym']}")
    return out
