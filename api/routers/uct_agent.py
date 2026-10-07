"""UCT Agent -- /api/agent/*  (ADMIN-ONLY while dark, 2026-10-07)

  POST /api/agent/turn                     one model turn -> structured envelope
  POST /api/agent/record                   record what the BROWSER did (fast-path
                                           turns, receipts, refusals, undo) + telemetry
  GET  /api/agent/conversations            the member's chats, newest first
  GET  /api/agent/conversations/{id}       one chat's transcript

Nothing here mutates a workspace: the browser executes the deterministic
actions and reports the outcome back through /record. Paid (402) AND admin (403)
while UCT Agent is dark -- lifting dark is deleting `require_admin_dark` below,
the same lever /api/user-definitions/converse uses. Metered per member per ET
day (durable) and per population. Plain `def` routes: the model call blocks, so
FastAPI runs it in the threadpool, bounded by the client timeout, zero retries.
"""
from __future__ import annotations

import os
from datetime import datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api.middleware import auth_middleware
from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()

SCOPE = "uct_agent_turn"
_ET = ZoneInfo("America/New_York")


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="UCT Agent requires a paid plan")
    return user


def require_admin_dark(user: dict = Depends(require_paid)) -> dict:
    """DARK ROLLOUT: admins only. Delete this dependency to open to paid members."""
    return auth_middleware.require_admin(user)


def daily_cap() -> int:
    try:
        return max(1, int(os.environ.get("UCT_AGENT_DAILY_CAP", "300")))
    except ValueError:
        return 300


def _et_day() -> str:
    return datetime.now(_ET).strftime("%Y-%m-%d")


def _take(uid) -> bool:
    from api.services import daily_counters
    return daily_counters.take(_et_day(), [daily_counters.Charge(SCOPE, str(uid), 1, daily_cap())]) is None


def _give_back(uid) -> None:
    from api.services import daily_counters
    daily_counters.give_back(_et_day(), [daily_counters.Charge(SCOPE, str(uid), 1, None)])


class TurnIn(BaseModel):
    conversationId: Optional[str] = None
    message: str
    context: dict = Field(default_factory=dict)
    # The manifest of capabilities AVAILABLE to this member on this surface,
    # from the browser registry; turn.validate_manifest decides what the model sees.
    capabilities: list = Field(default_factory=list)
    pending: Optional[dict] = None
    recentOutcome: Optional[str] = None
    voice: bool = False


class RecordIn(BaseModel):
    conversationId: Optional[str] = None
    member: Optional[str] = None           # what the member typed/said (fast path / local turns)
    outcome: Optional[str] = None          # the deterministic receipt / refusal / undo text
    outcomeData: Optional[dict] = None     # structured: {kind, lines, actions, ...}
    telemetry: Optional[dict] = None


@router.post("/api/agent/turn")
def agent_turn(body: TurnIn, user: dict = Depends(require_admin_dark)):
    from api.services import ai_population_cap
    from api.services.uct_agent import store, turn as agent
    uid = user["id"]
    if not _take(uid):
        raise HTTPException(status_code=429, detail="You've reached today's UCT Agent limit.")
    refusal = ai_population_cap.admit("uct_agent")
    if refusal:
        _give_back(uid)
        raise HTTPException(status_code=429, detail=refusal)
    cid = store.ensure_conversation(uid, body.conversationId, body.message)
    history = store.get_turns(uid, cid) or []
    store.add_turn(uid, cid, "member", body.message, {"voice": bool(body.voice)})
    try:
        out = agent.run_turn(message=body.message, context=body.context, history=history,
                             capabilities=body.capabilities,
                             pending=body.pending, recent_outcome=body.recentOutcome)
    except agent.TurnError as e:
        _give_back(uid)
        store.add_turn(uid, cid, "outcome", f"Refused: {e}", {"kind": "error"})
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001 -- a provider failure is a sentence, not a 500
        _give_back(uid)
        store.add_turn(uid, cid, "outcome", "UCT Agent was unavailable for this message.", {"kind": "error"})
        raise HTTPException(status_code=503, detail=f"UCT Agent is unavailable right now ({type(e).__name__}).")
    env, usage = out["envelope"], out["usage"]
    turn_id = store.add_turn(uid, cid, "agent", env.get("reply") or (env.get("question") or {}).get("text") or "",
                             {"envelope": env, "citations": usage.get("citations")})
    store.record_telemetry(uid, cid, {
        "path": "model", "disposition": env["disposition"],
        "actions": [o.get("action") for o in env.get("ops") or []],
        "clarified": env["disposition"] == "clarify", "latency_ms": usage.get("latency_ms"),
        "model": usage.get("model"), "cost_usd": usage.get("cost_usd"),
        "research_calls": usage.get("research_calls"), "unsupported": env.get("unsupported_category"),
        "voice": body.voice,
    })
    return {"conversationId": cid, "turnId": turn_id, "envelope": env,
            "usage": {k: usage.get(k) for k in ("model", "input_tokens", "output_tokens", "cost_usd",
                                                "latency_ms", "research_calls", "citations")}}


@router.post("/api/agent/record")
def agent_record(body: RecordIn, user: dict = Depends(require_admin_dark)):
    from api.services.uct_agent import store
    uid = user["id"]
    if not (body.member or body.outcome):
        raise HTTPException(status_code=400, detail="Nothing to record.")
    cid = store.ensure_conversation(uid, body.conversationId, body.member or body.outcome or "")
    if body.member:
        store.add_turn(uid, cid, "member", body.member, {"local": True})
    if body.outcome:
        store.add_turn(uid, cid, "outcome", body.outcome, body.outcomeData or None)
    if body.telemetry:
        t: dict[str, Any] = dict(body.telemetry)
        t.setdefault("path", "local")
        store.record_telemetry(uid, cid, t)
    return {"conversationId": cid}


@router.get("/api/agent/conversations")
def agent_conversations(user: dict = Depends(require_admin_dark)):
    from api.services.uct_agent import store
    return {"conversations": store.list_conversations(user["id"])}


@router.get("/api/agent/conversations/{conversation_id}")
def agent_conversation(conversation_id: str, user: dict = Depends(require_admin_dark)):
    from api.services.uct_agent import store
    conv = store.get_conversation(user["id"], conversation_id)
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv
