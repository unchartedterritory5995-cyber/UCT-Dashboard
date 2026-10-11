"""UCT Agent -- /api/agent/*  (ADMIN-ONLY while dark, 2026-10-07)

  POST /api/agent/turn                     one model turn -> structured envelope
  POST /api/agent/record                   record what the BROWSER did (fast-path
                                           turns, receipts, refusals, undo) + telemetry
  GET  /api/agent/conversations            the member's chats, newest first
  GET  /api/agent/conversations/{id}       one chat's transcript
  PATCH  /api/agent/conversations/{id}     rename and/or pin (History)
  DELETE /api/agent/conversations/{id}     delete a chat and its transcript (History)
  GET  /api/agent/search?q=                find words across the member's own chats (History)
  POST /api/agent/session-stats            latest completed session close/volume/dollar volume (read-only)

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

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
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


NO_TITLE_YET = "(no name yet)"


@router.post("/api/agent/turn")
def agent_turn(body: TurnIn, background: BackgroundTasks, user: dict = Depends(require_admin_dark)):
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
    # Auto-naming: the Agent may name this chat until the member renames it ('user' = hands off).
    try:
        info = store.title_info(uid, cid)
    except Exception:  # noqa: BLE001 -- naming is a nicety; the turn goes ahead without it
        info = None
    # The first-message placeholder is not a name: the model is told there is none yet (and the
    # member's words are never sent twice).
    nameable = None if not info or info.get("source") == "user" else (info["title"] if info.get("source") == "auto" else NO_TITLE_YET)
    try:
        out = agent.run_turn(message=body.message, context=body.context, history=history,
                             capabilities=body.capabilities,
                             pending=body.pending, recent_outcome=body.recentOutcome,
                             manifest_version=body.manifestVersion, routing=body.routing,
                             conversation_title=nameable)
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
    title = out.get("title")
    if title and nameable and title != nameable and title != (info or {}).get("title"):
        try:
            store.set_auto_title(uid, cid, title)       # refuses by itself over a member's own name
        except Exception:  # noqa: BLE001 -- the reply stands; only the name update is lost
            log.exception("[uct-agent] could not store the conversation title")
    elif nameable == NO_TITLE_YET and not env.get("need_groups"):
        # Still unnamed and the turn gave no name: one small naming call after the reply is sent.
        background.add_task(_name_unnamed, uid, cid)
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


def _name_unnamed(uid: int, cid: str) -> None:
    """Background: name a chat that is still on its first message. Never over the member's own
    name (the store refuses that) or over a name the Agent gave it meanwhile."""
    from api.services.uct_agent import store, turn as agent
    try:
        if (store.title_info(uid, cid) or {}).get("source") is not None:
            return
        title = agent.name_conversation(store.get_turns(uid, cid) or [])
        if title and (store.title_info(uid, cid) or {}).get("source") is None:
            store.set_auto_title(uid, cid, title)
    except Exception:  # noqa: BLE001 -- naming is a nicety; the chat keeps its first-message name
        log.exception("[uct-agent] background naming failed")


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


class ConversationPatch(BaseModel):
    title: Optional[str] = None
    pinned: Optional[bool] = None


@router.patch("/api/agent/conversations/{conversation_id}")
def agent_conversation_patch(conversation_id: str, body: ConversationPatch, user: dict = Depends(require_admin_dark)):
    from api.services.uct_agent import store
    uid = user["id"]
    if body.title is None and body.pinned is None:
        raise HTTPException(status_code=400, detail="Nothing to change.")
    if not store.owns(uid, conversation_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    if body.title is not None:
        try:
            store.rename_conversation(uid, conversation_id, body.title)
        except ValueError:
            raise HTTPException(status_code=400, detail="A chat needs a name.")
    if body.pinned is not None:
        store.set_pinned(uid, conversation_id, body.pinned)
    conv = next((c for c in store.list_conversations(uid, limit=1000) if c["id"] == conversation_id), None)
    return {"conversation": conv}


@router.delete("/api/agent/conversations/{conversation_id}")
def agent_conversation_delete(conversation_id: str, user: dict = Depends(require_admin_dark)):
    from api.services.uct_agent import store
    if not store.delete_conversation(user["id"], conversation_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"deleted": conversation_id}


@router.get("/api/agent/search")
def agent_search(q: str = "", user: dict = Depends(require_admin_dark)):
    from api.services.uct_agent import store
    return {"results": store.search_turns(user["id"], q[:200])}


class SessionStatsIn(BaseModel):
    symbols: list = Field(default_factory=list)


@router.post("/api/agent/session-stats")
def agent_session_stats(body: SessionStatsIn, user: dict = Depends(require_admin_dark)):
    """The latest completed session's close / volume / dollar volume for these tickers
    (services/uct_agent/session_stats.py). Read-only; no model call."""
    from api.services.uct_agent import session_stats
    if len(body.symbols) > session_stats.MAX_SYMBOLS:
        raise HTTPException(status_code=400, detail=f"at most {session_stats.MAX_SYMBOLS} symbols at once")
    return session_stats.latest_session(body.symbols)
