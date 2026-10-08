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

import logging
import os
from datetime import datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api.middleware import auth_middleware
from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()
log = logging.getLogger(__name__)

#: What a member sees when something unexpected breaks. TRUE by construction:
#: the server never mutates a workspace, and the browser only executes after a
#: valid envelope arrives — a failed request has changed nothing.
FAILED = "UCT Agent couldn't complete that request. No changes were made."

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
    # The manifest wire contract version (app/src/agent/contract/manifest.contract.json).
    # Absent = a browser from before v1; it still works (the entries simply lack `undo`).
    manifestVersion: Optional[int] = None
    # Capability routing (app/src/agent/routing.js): {version, groups: [{id, title}], selected: [id]}.
    routing: Optional[dict] = None
    # The ONE bounded second call after the model asked for more action groups (need_groups):
    # the member's message is already stored, so it is not stored again.
    reroute: bool = False
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
    try:
        cid = store.ensure_conversation(uid, body.conversationId, body.message)
        history = store.get_turns(uid, cid) or []
        if body.reroute and history and history[-1].get("role") == "member" and history[-1].get("text") == body.message:
            history = history[:-1]        # the same message, asked again with more actions
        else:
            store.add_turn(uid, cid, "member", body.message, {"voice": bool(body.voice)})
    except Exception:  # noqa: BLE001 -- logged with its traceback; the member gets a sentence
        log.exception("[uct-agent] conversation store failed before the model call")
        _give_back(uid)
        raise HTTPException(status_code=500, detail=FAILED)
    try:
        out = agent.run_turn(message=body.message, context=body.context, history=history,
                             capabilities=body.capabilities,
                             pending=body.pending, recent_outcome=body.recentOutcome,
                             manifest_version=body.manifestVersion, routing=body.routing)
    except agent.TurnError as e:
        _give_back(uid)
        store.add_turn(uid, cid, "outcome", f"Refused: {e}", {"kind": "error"})
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001 -- a provider failure is a sentence, not a 500
        _give_back(uid)
        store.add_turn(uid, cid, "outcome", "UCT Agent was unavailable for this message.", {"kind": "error"})
        log.exception("[uct-agent] turn failed")
        raise HTTPException(status_code=503, detail=f"UCT Agent is unavailable right now ({type(e).__name__}). No changes were made.")
    env, usage = out["envelope"], out["usage"]
    try:
        # A request for more action groups is plumbing, not a reply: nothing is stored for it.
        turn_id = None if env.get("need_groups") else store.add_turn(uid, cid, "agent", env.get("reply") or (env.get("question") or {}).get("text") or "",
                             {"envelope": env, "citations": usage.get("citations")})
    except Exception:  # noqa: BLE001 -- the answer stands; only its transcript row is lost
        log.exception("[uct-agent] could not store the agent turn")
        turn_id = None
    store.record_telemetry(uid, cid, {
        # routing in the existing columns: path model | routed | reroute; disposition need_groups
        "path": "reroute" if body.reroute else ("routed" if body.routing else "model"),
        "disposition": "need_groups" if env.get("need_groups") else env["disposition"],
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
    try:
        cid = store.ensure_conversation(uid, body.conversationId, body.member or body.outcome or "")
        if body.member:
            store.add_turn(uid, cid, "member", body.member, {"local": True})
        if body.outcome:
            store.add_turn(uid, cid, "outcome", body.outcome, body.outcomeData or None)
    except Exception:  # noqa: BLE001
        log.exception("[uct-agent] could not record a turn")
        raise HTTPException(status_code=500, detail="Could not save this to the conversation.")
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
