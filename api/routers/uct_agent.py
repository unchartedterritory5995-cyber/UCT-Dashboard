"""UCT Agent -- /api/agent/*  (ADMIN-ONLY while dark, 2026-10-07)

  POST /api/agent/turn                     one model turn -> structured envelope
  POST /api/agent/turn/stream              the same turn as text/event-stream (an answer streams when
                                           UCT_AGENT_STREAM is on; the final event is /turn's JSON)
  GET  /api/agent/config                   {stream}: does this server stream turns (UCT_AGENT_STREAM)
  POST /api/agent/record                   record what the BROWSER did (fast-path
                                           turns, receipts, refusals, undo) + telemetry
  GET  /api/agent/conversations            the member's chats, newest first
  GET  /api/agent/conversations/{id}       one chat's transcript
  PATCH  /api/agent/conversations/{id}     rename and/or pin (History)
  DELETE /api/agent/conversations/{id}     delete a chat and its transcript (History)
  GET  /api/agent/search?q=                find words across the member's own chats (History)
  POST /api/agent/session-stats            latest completed session close/volume/dollar volume (read-only)
  POST /api/agent/breadth                  a historical breadth lookup, answered LOCALLY (read-only, no model)
  POST /api/agent/breadth/history          a historical breadth SEARCH (MI breadth_events), answered LOCALLY
  GET  /api/agent/breadth/dates            today (ET) + latest finalized session per universe (dates only)

Nothing here mutates a workspace: the browser executes the deterministic
actions and reports the outcome back through /record. Paid (402) AND admin (403)
while UCT Agent is dark -- lifting dark is deleting `require_admin_dark` below,
the same lever /api/user-definitions/converse uses. Metered per member per ET
day (durable) and per population. Plain `def` routes: the model call blocks, so
FastAPI runs it in the threadpool, bounded by the client timeout, zero retries.
"""
from __future__ import annotations

import json
import logging
import os
import queue
import threading
import time
from datetime import datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from api.middleware import auth_middleware
from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()
log = logging.getLogger(__name__)

#: What a member sees when something unexpected breaks. TRUE by construction:
#: the server never mutates a workspace, and the browser only executes after a
#: valid envelope arrives — a failed request has changed nothing.
FAILED = "UCT Agent couldn't complete that request. No changes were made."

#: A model-provider failure, as ONE short sentence for the member (post-release 2026-10-13: an exhausted
#: model account reached chat as "UCT Agent is unavailable right now (BadRequestError)"). The exception's
#: class and message stay in the log (`provider_failure`), never in the conversation. Nothing is retried.
PROVIDER_DOWN = "UCT Agent can't reach its AI service right now, so nothing was changed. Please try again shortly."
PROVIDER_BUSY = "UCT Agent is busy right now, so nothing was changed. Please try again in a moment."
PROVIDER_FAILED = "UCT Agent couldn't answer that right now, so nothing was changed. Please try again shortly."


def provider_failure(e: BaseException) -> tuple[str, str]:
    """(kind, member sentence) for a failed model call. kind: account | busy | network | other."""
    name = type(e).__name__
    text = str(getattr(e, "message", "") or e).lower()
    if name in ("AuthenticationError", "PermissionDeniedError") or (
            name == "BadRequestError" and ("credit balance" in text or "billing" in text)):
        return "account", PROVIDER_DOWN
    if name in ("RateLimitError", "OverloadedError", "InternalServerError", "ServiceUnavailableError")             or getattr(e, "status_code", None) in (429, 500, 502, 503, 529):
        return "busy", PROVIDER_BUSY
    if name in ("APIConnectionError", "APITimeoutError", "TimeoutError", "ConnectionError"):
        return "network", PROVIDER_DOWN
    return "other", PROVIDER_FAILED

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


#: OPT-IN dollar ceiling for UCT Agent's model spend per ET day (all members, the ledger's
#: `uct_agent` surface). Unset = no dollar ceiling (the request-count cap above still applies) —
#: production behaviour is unchanged until someone sets it. Checked BEFORE each model call, so one
#: request (at most 3 calls + a naming call) can pass the ceiling by that request's cost, never more.
COST_CAP_ENV = "UCT_AGENT_COST_CAP_DAILY"


def over_cost_cap() -> bool:
    if not str(os.environ.get(COST_CAP_ENV) or "").strip():
        return False
    from api.services import narrative_cost_guard
    from api.services.uct_agent import turn as agent
    return narrative_cost_guard.over_budget(agent.COST_SURFACE, env_name=COST_CAP_ENV)


def _ms(t0: float) -> int:
    return int((time.perf_counter() - t0) * 1000)


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
    return _turn(body, background, user)


#: STREAMING (2026-10-12, latency) — OFF unless set to 1/true/on/yes. Off, /api/agent/turn/stream sends
#: ONLY the final result (the same JSON /api/agent/turn returns), so the browser's behaviour is unchanged;
#: on, an answer's reply streams as it is written and a web search is announced (turn.ReplyStream's gate).
STREAM_ENV = "UCT_AGENT_STREAM"


def streaming_enabled() -> bool:
    return str(os.environ.get(STREAM_ENV) or "").strip().lower() in ("1", "true", "on", "yes")


@router.get("/api/agent/config")
def agent_config(user: dict = Depends(require_admin_dark)):
    """What the browser needs to know about this server's Agent: whether turns stream (flags only)."""
    return {"stream": streaming_enabled()}


@router.post("/api/agent/turn/stream")
def agent_turn_stream(body: TurnIn, background: BackgroundTasks, user: dict = Depends(require_admin_dark)):
    """The same turn as POST /api/agent/turn, as text/event-stream `data:` events:
      {"t": "delta", "text"}        part of an ANSWER's reply, as written (streaming on only)
      {"t": "retract"}              drop the streamed text: a web search follows (streaming on only)
      {"t": "status", "stage"}      "research": a web search started (streaming on only)
      {"t": "final", ...}           exactly /api/agent/turn's JSON — the authority, always last
      {"t": "error", "status", "detail"}   what /api/agent/turn would have raised
    The turn runs in a worker thread; this generator only relays its events. Nothing in an event is
    logged; a plan's words, research results and local-only values never ride one."""
    events: queue.Queue = queue.Queue()
    on_event = (lambda e: events.put(("event", e))) if streaming_enabled() else None

    def work() -> None:
        try:
            events.put(("final", _turn(body, background, user, on_event=on_event)))
        except HTTPException as e:
            events.put(("error", {"status": e.status_code, "detail": e.detail if isinstance(e.detail, str) else FAILED}))
        except Exception:  # noqa: BLE001 -- the member gets a sentence, never a broken stream
            log.exception("[uct-agent] streamed turn failed")
            events.put(("error", {"status": 500, "detail": FAILED}))
        finally:
            events.put(None)

    threading.Thread(target=work, name="uct-agent-turn", daemon=True).start()

    def gen():
        yield ": open\n\n"                       # flush the headers now (first visible byte)
        while True:
            item = events.get()
            if item is None:
                return
            kind, payload = item
            ev = payload if kind == "event" else {"t": kind, **payload}
            yield f"data: {json.dumps(ev, separators=(',', ':'))}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
                             background=background)


def _turn(body: TurnIn, background: BackgroundTasks, user: dict, on_event=None) -> dict:
    from api.services import ai_population_cap
    from api.services.uct_agent import store, turn as agent
    t0 = time.perf_counter()
    uid = user["id"]
    if not _take(uid):
        raise HTTPException(status_code=429, detail="You've reached today's UCT Agent limit.")
    if over_cost_cap():
        _give_back(uid)
        raise HTTPException(status_code=429, detail="UCT Agent's spending limit for today has been reached.")
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
    pre_ms = _ms(t0)
    try:
        out = agent.run_turn(message=body.message, context=body.context, history=history,
                             capabilities=body.capabilities,
                             pending=body.pending, recent_outcome=body.recentOutcome,
                             manifest_version=body.manifestVersion, routing=body.routing,
                             conversation_title=nameable, on_event=on_event)
    except agent.TurnError as e:
        _give_back(uid)
        store.add_turn(uid, cid, "outcome", f"Refused: {e}", {"kind": "error"})
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001 -- a provider failure is a sentence, not a 500
        _give_back(uid)
        store.add_turn(uid, cid, "outcome", "UCT Agent was unavailable for this message.", {"kind": "error"})
        kind, said = provider_failure(e)
        log.exception("[uct-agent] turn failed kind=%s class=%s", kind, type(e).__name__)
        raise HTTPException(status_code=503, detail=said)
    env, usage = out["envelope"], out["usage"]
    t_post = time.perf_counter()
    try:
        # A request for more action groups is plumbing, not a reply: nothing is stored for it.
        turn_id = None if env.get("need_groups") else store.add_turn(uid, cid, "agent", env.get("reply") or (env.get("question") or {}).get("text") or "",
                             {"envelope": env, "citations": usage.get("citations")})
    except Exception:  # noqa: BLE001 -- the answer stands; only its transcript row is lost
        log.exception("[uct-agent] could not store the agent turn")
        turn_id = None
    # ⭐ LATENCY: the chat's name and the telemetry row are written AFTER the reply is sent (background
    # tasks, in order); the transcript row above stays before it — the next turn's history needs it.
    title = out.get("title")
    if title and nameable and title != nameable and title != (info or {}).get("title"):
        background.add_task(_set_title, uid, cid, title)
    elif nameable == NO_TITLE_YET and not env.get("need_groups"):
        # Still unnamed and the turn gave no name: one small naming call after the reply is sent.
        background.add_task(_name_unnamed, uid, cid)
    background.add_task(store.record_telemetry, uid, cid, {
        # routing in the existing columns: path model | routed | reroute; disposition need_groups
        "path": "reroute" if body.reroute else ("routed" if body.routing else "model"),
        "disposition": "need_groups" if env.get("need_groups") else env["disposition"],
        "actions": [o.get("action") for o in env.get("ops") or []],
        "clarified": env["disposition"] == "clarify", "latency_ms": usage.get("latency_ms"),
        "model": usage.get("model"), "cost_usd": usage.get("cost_usd"),
        "research_calls": usage.get("research_calls"), "unsupported": env.get("unsupported_category"),
        "voice": body.voice,
    })
    # STAGE TIMINGS, ms only (the member's words, replies and values are never in them): pre = caps +
    # conversation store before the model; build/model/research from run_turn; post = stores after it.
    stages = {"pre": pre_ms, **(usage.get("stages") or {}), "post": _ms(t_post), "server": _ms(t0)}
    log.info("[uct-agent] turn timing %s calls=%s in=%s out=%s cache_read=%s",
             json.dumps(stages, separators=(",", ":")), usage.get("model_calls"), usage.get("input_tokens"),
             usage.get("output_tokens"), usage.get("cache_read_tokens"))
    return {"conversationId": cid, "turnId": turn_id, "envelope": env,
            "usage": {**{k: usage.get(k) for k in ("model", "input_tokens", "output_tokens", "cost_usd",
                                                   "latency_ms", "research_calls", "citations", "model_calls",
                                                   "cache_read_tokens", "cache_write_tokens")},
                      "stages": stages}}


def _set_title(uid: int, cid: str, title: str) -> None:
    from api.services.uct_agent import store
    try:
        store.set_auto_title(uid, cid, title)           # refuses by itself over a member's own name
    except Exception:  # noqa: BLE001 -- the reply stands; only the name update is lost
        log.exception("[uct-agent] could not store the conversation title")


def _name_unnamed(uid: int, cid: str) -> None:
    """Background: name a chat that is still on its first message. Never over the member's own
    name (the store refuses that) or over a name the Agent gave it meanwhile."""
    from api.services.uct_agent import store, turn as agent
    try:
        if over_cost_cap() or (store.title_info(uid, cid) or {}).get("source") is not None:
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


# ── Market Intelligence breadth slice 1 — LOCAL-RESULT BOUNDARY ────────────────────────────────────
# The model only PLANS `breadth.show` (validated args). The browser asks THIS route for the answer and
# shows it to the member; nothing here calls a model, and the values never go back to one (the
# conversation replays such a turn as a note — turn.outcome_for_model). Values are not logged.
BREADTH_MAX_BODY = 2000


@router.post("/api/agent/breadth")
def agent_breadth(body: Any = Body(...), user: dict = Depends(require_admin_dark)):
    """`{status, text, table}` for one breadth request (market_intel.breadth_reads / breadth_answer).
    Read-only; never a model call. A refusal is an answer (status refused/unavailable), not an error."""
    import json as _json
    from api.services.market_intel import breadth_answer, breadth_reads
    if len(_json.dumps(body, default=str)) > BREADTH_MAX_BODY:
        raise HTTPException(status_code=400, detail="that breadth request is too large")
    from api.services.uct_agent import breadth_present
    # a GENERAL breadth request ("how's breadth today?") names no measure: it gets UCT's documented
    # overview (breadth_present.OVERVIEW_METRICS — four measures, inside MI's four-measure limit)
    if isinstance(body, dict) and body.get("metrics") == []:
        body = {**body, "metrics": list(breadth_present.OVERVIEW_METRICS)}
    # "% BELOW a moving average": the same measure's complement (breadth_present.complement) — MI reads the
    # measure as stored; `side` never reaches it
    below = isinstance(body, dict) and body.get("side") == "below"
    if isinstance(body, dict) and "side" in body:
        body = {k: v for k, v in body.items() if k != "side"}
    if below and not breadth_present.below_ok(body):
        why = breadth_present.BELOW_REFUSAL
        return {"status": "refused", "text": why, "table": None, "present": {"kind": "error", "text": why}}
    res = breadth_reads.read(body)
    if below:
        res = breadth_present.complement(res)
    out = breadth_answer.answer(res)
    log.info("[uct-agent] breadth lookup status=%s", out.get("status"))          # never a value
    # `present`: the concise VIEW for the member (present.js) — MI's values, MI's formatting; the
    # full text and table stay available as details. Member channel only (never replayed to a model).
    try:
        present = breadth_present.view_of(res, out)
    except Exception:  # noqa: BLE001 -- presentation never costs the member the answer itself
        log.exception("[uct-agent] breadth view failed; the browser derives one")
        present = None
    text = out.get("text")
    # PRESENT TENSE (owner 2026-10-12): "what's breadth now?" → the Breadth team's current reading per
    # measure (breadth_current contract), labelled with its own time/status; the finalized read above
    # stays as dated context. Dates, closes, comparisons and ranges stay finalized (D5).
    from api.services.uct_agent import breadth_now
    if breadth_now.enabled() and breadth_now.wants_current(body) and out.get("status") in ("ok", "partial"):
        try:
            text, present, _kinds = breadth_now.overlay(
                res, out, present, reading=breadth_present.complement_reading(breadth_now._reader()) if below else None)
        except Exception:  # noqa: BLE001 -- the finalized answer stands
            log.exception("[uct-agent] present-tense breadth failed; finalized answer shown")
    # OPEN CHART: one measure answered → its published chart series (never for "below" or an overview)
    mets = body.get("metrics") if isinstance(body, dict) else None
    chart = (breadth_present.chart_target(body.get("universe"), mets[0], "below" if below else None)
             if out.get("status") in ("ok", "partial") and isinstance(mets, list) and len(mets) == 1 else None)
    return {"status": out.get("status"), "text": text, "table": out.get("table"), "present": present,
            **({"chart": chart} if chart else {})}


@router.post("/api/agent/breadth/history")
def agent_breadth_history(body: Any = Body(...), user: dict = Depends(require_admin_dark)):
    """A historical breadth SEARCH (breadth.history), answered LOCALLY — read-only, never a model call.
    Market Intelligence's `breadth_events` runs the condition over the finalized daily series the
    breadth charts draw (`breadth_reads.sealed_series`); this route only adds the member's view.
    ⛔ Member channel only: the result is a local row the server replays as a value-free note."""
    import json as _json
    if len(_json.dumps(body, default=str)) > BREADTH_MAX_BODY:
        raise HTTPException(status_code=400, detail="that breadth request is too large")
    try:
        from api.services.market_intel import breadth_events
    except Exception:  # noqa: BLE001 -- the MI module not deployed: an honest refusal, never a guess
        return {"status": "unavailable", "table": None, "present": None,
                "text": "UCT's historical breadth search isn't available yet, so nothing was searched."}
    from api.services.uct_agent import breadth_history_present
    result = breadth_events.run(body)
    out = breadth_events.answer(result)
    log.info("[uct-agent] breadth history status=%s", out.get("status"))          # never a value
    try:
        present = breadth_history_present.view_of(result, out)
    except Exception:  # noqa: BLE001 -- presentation never costs the member the answer itself
        log.exception("[uct-agent] breadth history view failed; the browser derives one")
        present = None
    from api.services.uct_agent.breadth_present import chart_target
    chart = chart_target(body.get("universe"), body.get("metric")) \
        if out.get("status") in ("ok", "partial") and isinstance(body, dict) else None
    return {"status": out.get("status"), "text": out.get("text"), "table": out.get("table"), "present": present,
            **({"chart": chart} if chart else {})}


@router.get("/api/agent/breadth/dates")
def agent_breadth_dates(user: dict = Depends(require_admin_dark)):
    """Dates only — today (ET) and each universe's latest FINALIZED session — so the model can turn
    "a month ago" into a real date. No breadth value is ever in this payload."""
    from api.services.market_intel import breadth_reads
    return breadth_reads.date_context()
