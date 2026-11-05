"""UCT Agent -- /api/agent/*  (ADMIN-ONLY while dark, 2026-10-07)

  POST /api/agent/turn                     one model turn -> structured envelope
  POST /api/agent/turn/stream              the same turn as text/event-stream (an answer streams when
                                           UCT_AGENT_STREAM is on; the final event is /turn's JSON)
  GET  /api/agent/config                   {stream, nl1, news, data, scan, planner, coach}: does this server stream turns (UCT_AGENT_STREAM),
                                           does it serve NL-1 (UCT_AGENT_NL1), the MD-1 data gateway
                                           (UCT_AGENT_DATA) and its scan kinds (UCT_AGENT_SCAN); planner v1 | v2
  GET  /api/agent/coach/concepts           Wave 3 coach (UCT_AGENT_COACH, default off): the concept knowledge base
  POST /api/agent/turn/step                planner v2 (UCT_AGENT_PLANNER=v2) only: the browser's outcome of ONE step
  POST /api/agent/turn/resume              planner v2 only: continue a turn paused on an approval card (event stream)
  POST /api/agent/data                     one MD-1 market-data read -> DataEnvelope (read-only, no model;
                                           refused unless UCT_AGENT_DATA=1)
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
  GET  /api/agent/budget                   today's Agent AI spend vs its $ cap and the shared $15 cap (aggregates)

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
    # NL-1 (model-first interpretation): "nl1" asks for it; turn.run_turn honours it ONLY when the
    # server's UCT_AGENT_NL1 flag is on. Admin-only like every other field here (require_admin_dark).
    interpreter: Optional[str] = None
    # NL-1's ONE repair: UCT's planner refused the previous plan for this same message. Only as a reroute
    # (it continues the request, inside its 2-call ceiling — never a new, separately budgeted request).
    repair: Optional[dict] = None
    # NL-1: stable catalogs (indicator catalog, Screener fields) sent apart from the context so the server
    # can cache them; turn.reference_block accepts only its known keys, as DATA, under a size limit.
    reference: Optional[dict] = None
    # V2-G2 (review #782): the browser runs a v2 PLAN GROUP as one plan (steps.js runGroup). Absent/false = an older
    # browser: the server sends one step at a time, as before.
    stepGroups: bool = False
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


ROUTING_V2_ENV = "UCT_AGENT_ROUTING_V2"


def routing_v2_enabled() -> bool:
    """NLM-1 (owner policy 11-04: ON by default for admins; the Agent is admin-only). UCT_AGENT_ROUTING_V2=0 / false /
    off / no is the server KILL SWITCH (the browser has its own: localStorage uct.agent.routingV2 = '0'). Routing only
    changes which capabilities the model SEES; the server validates every op against the manifest it was sent, as before."""
    return str(os.environ.get(ROUTING_V2_ENV) or "").strip().lower() not in ("0", "false", "off", "no")


@router.get("/api/agent/config")
def agent_config(user: dict = Depends(require_admin_dark)):
    """What the browser needs to know about this server's Agent: whether turns stream, and whether it serves
    NL-1 (flags only). The browser takes NL-1's path only when this says so AND its own switch is on."""
    from api.services.uct_agent import news, turn, turn_v2
    from api.services.uct_agent.marketdata import gateway
    from api.services.uct_agent import coach
    return {"stream": streaming_enabled(), "nl1": turn.nl1_enabled(), "news": news.enabled(),
            "data": gateway.data_enabled(), "scan": gateway.scan_enabled(),
            "data_kinds": sorted(gateway.enabled_kinds()), "planner": turn_v2.planner(),
            # Wave 3 (W3-1): the coach, UCT_AGENT_COACH (default off) -- the browser registers coach.* only on true
            "coach": coach.enabled(),
            # NLM-1 D1: registry-derived routing v2, UCT_AGENT_ROUTING_V2 (default ON; 0 = kill switch) -- the browser has its own kill switch
            "routing_v2": routing_v2_enabled()}


# ── COACH (Wave 3, UCT_AGENT_COACH, default off): the curated concept knowledge base the browser explains from ──
# docs/agent/coach/concepts/*.md, parsed by services/uct_agent/coach/concepts.py. Read-only, no model call, no
# member data. 404 while the flag is off (the route does not exist for a dark server), admin-dark like every route.
@router.get("/api/agent/coach/concepts")
def agent_coach_concepts(user: dict = Depends(require_admin_dark)):
    from api.services.uct_agent import coach
    from api.services.uct_agent.coach import concepts
    if not coach.enabled():
        raise HTTPException(status_code=404, detail="Not found")
    return {"concepts": concepts.public_rows(), "footer": coach_footer()}


def coach_footer() -> str:
    from api.services.uct_agent.coach import guard
    return guard.FOOTER


# ── PLANNER v2 (Wave 1 A-04, docs/agent/program/contracts/STEP-1.md): the step registry ───────────────────
# In-process (one uvicorn process, as production runs): a streaming v2 turn parks a queue under its token; the
# browser's POST /turn/step feeds it; a turn paused on an approval card parks its loop state until /turn/resume.
_V2_STEPS: dict[str, tuple[queue.Queue, str]] = {}
_V2_PAUSED: dict[str, dict] = {}
_V2_LOCK = threading.Lock()


def planner_v2() -> bool:
    from api.services.uct_agent import turn_v2
    return turn_v2.planner() == "v2"


class StepIn(BaseModel):
    turnId: str
    id: str
    status: str                                       # done | proposed | refused | failed | query
    receipt: Optional[str] = None
    refusal: Optional[str] = None
    result: Optional[Any] = None
    isolated: Optional[bool] = None
    added: Optional[list] = None                       # refs a DONE step created (a new chart): [{ref, kind, label}]


class ResumeIn(BaseModel):
    turnId: str
    id: str
    status: str                                       # done | refused | failed
    receipt: Optional[str] = None
    refusal: Optional[str] = None
    added: Optional[list] = None
    voice: bool = False


def _v2_waiter(q: "queue.Queue", uid):
    from api.services import call_deadline
    from api.services.uct_agent import limits, turn_v2

    def wait_step(step_id: str):
        limits.renew(uid)                             # a step may wait longer than the in-flight lease
        left = call_deadline.left()                   # and never past the turn's own deadline
        deadline = time.monotonic() + (turn_v2.STEP_TIMEOUT_S if left is None else min(turn_v2.STEP_TIMEOUT_S, left))
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                return None
            try:
                res = q.get(timeout=left)
            except queue.Empty:
                return None
            if res.get("id") == step_id:
                return res
    return wait_step


def _v2_register(uid) -> tuple[str, dict]:
    from api.services.uct_agent import turn_v2
    token, q = turn_v2.new_turn_token(), queue.Queue()
    with _V2_LOCK:
        _V2_STEPS[token] = (q, str(uid))
    return token, {"wait_step": _v2_waiter(q, uid), "turn_token": token}


def _v2_unregister(token: str) -> None:
    with _V2_LOCK:
        _V2_STEPS.pop(token, None)


def _v2_park(token: str, uid, cid: str, out: dict, voice: bool) -> dict:
    """A turn paused on an approval card: its state waits for /turn/resume (PAUSE_TTL_S); nothing is stored yet."""
    from api.services.uct_agent import turn_v2
    with _V2_LOCK:
        _V2_PAUSED[token] = {"state": out["state"], "uid": str(uid), "cid": cid, "voice": voice,
                             "expires": time.time() + turn_v2.PAUSE_TTL_S}
        for k in [k for k, v in _V2_PAUSED.items() if v["expires"] < time.time()]:
            _V2_PAUSED.pop(k, None)
    return {"conversationId": cid, "turnId": None, "envelope": out["envelope"],
            "usage": {k: out["usage"].get(k) for k in ("model", "input_tokens", "output_tokens", "cost_usd", "model_calls",
                                                       "cache_read_tokens", "cache_write_tokens", "rounds", "steps")}}


def _v2_finish(uid, cid: str, out: dict, voice: bool, background: BackgroundTasks) -> dict:
    from api.services.uct_agent import store
    env, usage = out["envelope"], out["usage"]
    try:
        turn_id = store.add_turn(uid, cid, "agent", env.get("reply") or "", {"envelope": env, "citations": usage.get("citations"), "planner": "v2"})
    except Exception:  # noqa: BLE001
        log.exception("[uct-agent] could not store the v2 agent turn")
        turn_id = None
    background.add_task(store.record_telemetry, uid, cid, {
        "path": "model", "disposition": "answer", "actions": [s.get("action") for s in env.get("steps") or []],
        "clarified": False, "latency_ms": usage.get("latency_ms"), "model": usage.get("model"), "cost_usd": usage.get("cost_usd"),
        "research_calls": usage.get("research_calls"), "unsupported": None, "voice": voice, **_speed_fields(usage),
    })
    log.info("[uct-agent] v2 turn rounds=%s steps=%s calls=%s in=%s out=%s cache_read=%s stopped=%s", usage.get("rounds"),
             usage.get("steps"), usage.get("model_calls"), usage.get("input_tokens"), usage.get("output_tokens"),
             usage.get("cache_read_tokens"), usage.get("stopped"))
    return {"conversationId": cid, "turnId": turn_id, "envelope": env,
            "usage": {**{k: usage.get(k) for k in ("model", "input_tokens", "output_tokens", "cost_usd", "latency_ms", "research_calls",
                                                   "citations", "model_calls", "cache_read_tokens", "cache_write_tokens", "rounds", "steps")},
                      "stages": usage.get("stages")}}


@router.post("/api/agent/turn/step")
def agent_turn_step(body: StepIn, user: dict = Depends(require_admin_dark)):
    """The browser's outcome of ONE step of a running v2 turn (its own turn only). Isolated values never pass (L6)."""
    from api.services.uct_agent import turn as agent
    with _V2_LOCK:
        entry = _V2_STEPS.get(body.turnId)
    if not entry or entry[1] != str(user["id"]):
        raise HTTPException(status_code=404, detail="No step is waiting for that turn.")
    res = body.model_dump()
    res["result"], dropped = agent._strip_isolated(res.get("result"))
    if res["result"] is agent._DROPPED:
        res["result"] = None
    if dropped or body.isolated:
        res["isolated"] = True
    entry[0].put(res)
    return {"ok": True}


@router.post("/api/agent/turn/resume")
def agent_turn_resume(body: ResumeIn, background: BackgroundTasks, user: dict = Depends(require_admin_dark)):
    """Continue a v2 turn paused on an approval card, as the same event stream as /turn/stream."""
    events: queue.Queue = queue.Queue()

    def work() -> None:
        try:
            events.put(("final", _resume(body, background, user, on_event=lambda e: events.put(("event", e)),
                                         on_expired=_ends_stream(events))))
        except HTTPException as e:
            events.put(("error", {"status": e.status_code, "detail": e.detail if isinstance(e.detail, str) else FAILED}))
        except Exception:  # noqa: BLE001
            log.exception("[uct-agent] v2 resume failed")
            events.put(("error", {"status": 500, "detail": FAILED}))
        finally:
            events.put(None)

    threading.Thread(target=work, name="uct-agent-resume", daemon=True).start()
    return StreamingResponse(_relay(events), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"}, background=background)


def _ends_stream(events: "queue.Queue"):
    """A worker stuck past the turn's deadline cannot end its own stream, so the deadline's cleanup does."""
    from api.services.uct_agent import budget

    def end() -> None:
        events.put(("error", {"status": 400, "detail": budget.TURN_DEADLINE}))
        events.put(None)
    return end


def _relay(events: "queue.Queue"):
    yield ": open\n\n"
    while True:
        item = events.get()
        if item is None:
            return
        kind, payload = item
        ev = payload if kind == "event" else {"t": kind, **payload}
        yield f"data: {json.dumps(ev, separators=(',', ':'))}\n\n"


def _resume(body: ResumeIn, background: BackgroundTasks, user: dict, on_event, on_expired=None) -> dict:
    from api.services.uct_agent import budget, limits, turn as agent
    uid = user["id"]
    if not planner_v2():
        raise HTTPException(status_code=404, detail="No step is waiting for that turn.")
    with _V2_LOCK:
        p = _V2_PAUSED.pop(body.turnId, None)
    if not p or p["uid"] != str(uid) or p["expires"] < time.time():
        raise HTTPException(status_code=410, detail="That proposal's turn has expired (a proposal is good for 10 minutes). Ask again.")
    try:
        slot = limits.admit(uid, new_request=False)
    except limits.Refused as e:
        raise HTTPException(status_code=503 if e.reason in limits.SERVICE_REASONS else 429, detail=e.sentence,
                            headers={"Retry-After": str(e.retry_after)})
    token, q = body.turnId, queue.Queue()
    clock = budget.TurnClock(used_s=p["state"].get("active_s") or 0.0)
    clock.on_expire(lambda: _v2_unregister(token))
    if on_expired is not None:
        clock.on_stuck(on_expired)
    with _V2_LOCK:
        _V2_STEPS[token] = (q, str(uid))
    with limits.guard(uid, slot, clock):
        try:
            out = agent.run_turn(message="(resume)", context={}, history=[], on_event=on_event,
                                 meter=budget.Meter(user_id=uid, request_id=None, heartbeat=lambda: limits.renew(uid), clock=clock,
                                                    turn_request_id=p["state"].get("turn_request_id")),
                                 v2={"wait_step": _v2_waiter(q, uid), "turn_token": token, "resume": p["state"],
                                     "resume_result": {"id": body.id, "status": body.status, "receipt": body.receipt, "refusal": body.refusal,
                                                       "added": body.added}})
        except budget.BudgetRefused as e:
            raise HTTPException(status_code=503 if e.reason == "unavailable" else (400 if e.reason == "turn_deadline" else 429),
                                detail=e.sentence)
        except agent.TurnError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:  # noqa: BLE001
            kind, said = provider_failure(e)
            log.exception("[uct-agent] v2 resume failed kind=%s class=%s", kind, type(e).__name__)
            raise HTTPException(status_code=503, detail=said)
        finally:
            _v2_unregister(token)
    if out.get("paused"):
        return _v2_park(token, uid, p["cid"], out, p["voice"])
    return _v2_finish(uid, p["cid"], out, p["voice"], background)


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
    # planner v2 streams its step events whatever UCT_AGENT_STREAM says (its reply never streams early)
    on_event = (lambda e: events.put(("event", e))) if (streaming_enabled() or planner_v2()) else None

    def work() -> None:
        try:
            events.put(("final", _turn(body, background, user, on_event=on_event, on_expired=_ends_stream(events))))
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


def _turn(body: TurnIn, background: BackgroundTasks, user: dict, on_event=None, on_expired=None) -> dict:
    """⭐ PHASE 0B ADMISSION, in order: the member's in-flight slot and the request-rate windows
    (limits.py — a reroute continues its request and takes no new window place), then the existing
    daily count, the opt-in dollar env cap and the population cap, then the member REQUEST that every
    paid call of this turn counts against (budget.py: at most 2 calls, and the $ caps per call)."""
    from api.services.uct_agent import budget, limits
    uid = user["id"]
    if body.repair is not None and not body.reroute:
        raise HTTPException(status_code=400, detail="A repair continues a request; it can't start one.")
    body, headline = _news_turn(body)
    try:
        slot = limits.admit(uid, new_request=not body.reroute)
    except limits.Refused as e:
        raise HTTPException(status_code=503 if e.reason in limits.SERVICE_REASONS else 429, detail=e.sentence,
                            headers={"Retry-After": str(e.retry_after)})
    clock = budget.TurnClock()
    if on_expired is not None:
        clock.on_stuck(on_expired)
    with limits.guard(uid, slot, clock):
        return _admitted_turn(body, background, user, on_event, headline, clock)


def _news_turn(body: TurnIn) -> tuple[TurnIn, dict | None]:
    """⭐ NEWS -> AGENT (dark, UCT_AGENT_NEWS): a turn whose context is `{news: {id}}` is the News Ask box. The
    headline is read HERE by that id (news.headline_for), before anything is charged; nothing else the browser
    sent reaches the model -- no workspace context, no actions, no routing, no catalogs. Answer-only."""
    from api.services.uct_agent import news
    if not news.is_news_turn(body.context):
        return body, None
    if body.reroute or body.repair is not None:
        raise HTTPException(status_code=400, detail="That follow-up has expired. Ask again.")
    if len((body.message or "").strip()) > news.MAX_MESSAGE:
        raise HTTPException(status_code=400, detail=f"Keep it under {news.MAX_MESSAGE} characters.")
    try:
        headline = news.headline_for(news.requested_id(body.context))
    except news.Refused as e:
        raise HTTPException(status_code=e.status, detail=e.sentence)
    except Exception:  # noqa: BLE001 -- a News store fault is a sentence, and nothing was charged
        log.exception("[uct-agent] could not read the headline for a news turn")
        raise HTTPException(status_code=503, detail="UCT News isn't available right now. Try again shortly.")
    clean = body.model_copy(update={"context": {}, "capabilities": [], "routing": None, "interpreter": None,
                                    "reference": None, "pending": None, "repair": None, "recentOutcome": None})
    return clean, headline


def _news_conversation(uid, body: TurnIn, headline: dict | None) -> tuple[str, list[dict], dict | None, bool]:
    """(conversation id, its turns, the headline the model sees, answer_only). An Ask continues ONLY its own
    headline's conversation -- any other id (another headline's, an ordinary chat, a foreign one) starts a new
    chat named after the headline. An ordinary turn in a chat started from a headline (Continue in UCT Agent)
    keeps that headline, read again by the id the chat was started with."""
    from api.services.uct_agent import news, store
    if headline is not None:
        turns = store.get_turns(uid, body.conversationId) if body.conversationId else None
        if turns is not None and news.conversation_headline(turns) == headline["id"]:
            return body.conversationId, turns, headline, True
        cid = store.create_conversation(uid, body.message)
        store.set_auto_title(uid, cid, news.title_for(headline["headline"]))
        return cid, [], headline, True
    cid = store.ensure_conversation(uid, body.conversationId, body.message)
    turns = store.get_turns(uid, cid) or []
    started = news.conversation_headline(turns)
    if started and news.enabled():
        try:
            return cid, turns, news.headline_for(started), False
        except Exception:  # noqa: BLE001 -- the headline is gone or unreadable: the chat goes on without it
            log.info("[uct-agent] a headline chat continued without its headline")
    return cid, turns, None, False


def _admitted_turn(body: TurnIn, background: BackgroundTasks, user: dict, on_event=None, headline: dict | None = None,
                   clock=None) -> dict:
    from api.services import ai_population_cap
    from api.services.uct_agent import budget, limits, news, store, turn as agent
    t0 = time.perf_counter()
    uid = user["id"]

    def window_back():
        if not body.reroute:
            limits.give_back(uid)

    if not _take(uid):
        window_back()
        raise HTTPException(status_code=429, detail="You've reached today's UCT Agent limit.")
    if over_cost_cap():
        _give_back(uid)
        window_back()
        raise HTTPException(status_code=429, detail="UCT Agent's spending limit for today has been reached.")
    refusal = ai_population_cap.admit("uct_agent")
    if refusal:
        _give_back(uid)
        window_back()
        raise HTTPException(status_code=429, detail=refusal)
    try:
        request_id = budget.open_request(uid, body.conversationId, body.message, reroute=body.reroute)
    except Exception:  # noqa: BLE001 -- no request ledger, no paid call (fails closed)
        log.exception("[uct-agent] request ledger unavailable before the model call")
        _give_back(uid)
        raise HTTPException(status_code=503, detail=budget.UNAVAILABLE)
    if request_id is None:
        # a reroute with no request to continue: never a fresh, unmetered call
        _give_back(uid)
        raise HTTPException(status_code=400, detail="That follow-up has expired. Ask again.")
    try:
        cid, history, headline, answer_only = _news_conversation(uid, body, headline)
        if cid != body.conversationId:
            budget.attach_conversation(request_id, cid)
        if body.reroute and history and history[-1].get("role") == "member" and history[-1].get("text") == body.message:
            history = history[:-1]        # the same message, asked again with more actions
        elif body.repair is not None and body.reroute and any(
                t.get("role") == "member" and t.get("text") == body.message for t in history[-2:]):
            pass                          # the browser's repair of a message already stored: the member typed it once
        else:
            store.add_turn(uid, cid, "member", body.message,
                           {"voice": bool(body.voice), **({"news": headline["id"]} if answer_only else {})})
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
    if headline is not None or (history and news.conversation_headline(history)):
        nameable = None                   # a headline's chat keeps its "News: …" name (the member may rename it)
    pre_ms = _ms(t0)
    # PLANNER v2 (UCT_AGENT_PLANNER=v2): only a STREAMED, ordinary turn (no headline, no reroute) takes the step loop;
    # its rounds are metered per call with the request's dollars (turn_request_id; the 2-call ceiling is v1's), never by routing
    v2 = None
    # (a COACH turn stays on v1: its prompt block and server guard live there -- W3 review C1)
    from api.services.uct_agent import coach as agent_coach
    turn_context = body.context
    if agent_coach.is_coach_turn(turn_context):
        # W3 review: the journal review rides to the model only with the consent the SERVER stored for this chat
        turn_context = agent_coach.with_stored_consent(turn_context, agent_coach.stored_consent(uid, cid))
    if on_event is not None and planner_v2() and headline is None and not body.reroute and not agent_coach.is_coach_turn(body.context):
        token, v2 = _v2_register(uid)
        v2["step_groups"] = body.stepGroups is True
        clock.on_expire(lambda: _v2_unregister(token))
    # The browser's NL-1 repair (useAgent.js) IGNORES a failed repair and goes on with its first plan: the member never
    # sees that failure, so it is never written to the transcript (the chat on reload and the next turn's history must
    # match what the member saw). Every other failure is shown to the member and stored.
    shown = body.repair is None
    try:
        out = agent.run_turn(message=body.message, context=turn_context, history=history,
                             capabilities=body.capabilities,
                             pending=body.pending, recent_outcome=body.recentOutcome,
                             manifest_version=body.manifestVersion, routing=body.routing,
                             conversation_title=nameable, on_event=on_event,
                             meter=budget.Meter(user_id=uid, request_id=None if v2 else request_id,
                                                turn_request_id=request_id, heartbeat=lambda: limits.renew(uid), clock=clock),
                             reroute=body.reroute,
                             interpreter=body.interpreter, repair=body.repair, reference=body.reference,
                             headline=headline, answer_only=answer_only, v2=v2)
    except budget.BudgetRefused as e:
        # refused BEFORE a paid call: nothing was sent, nothing changed; the day's count is given back
        _give_back(uid)
        log.info("[uct-agent] paid call refused reason=%s", e.reason)
        if shown:
            store.add_turn(uid, cid, "outcome", e.sentence, {"kind": "error"})
        # call_limit / turn_cap: this request's own limits (not today's), so a 400 with UCT's fixed sentence
        raise HTTPException(status_code=503 if e.reason == "unavailable" else (400 if e.reason in ("call_limit", "turn_cap", "turn_deadline") else 429),
                            detail=e.sentence)
    except agent.TurnError as e:
        _give_back(uid)
        if shown:
            store.add_turn(uid, cid, "outcome", f"Refused: {e}", {"kind": "error"})
        # the accuracy side of the speed comparison: a plan that could not be read (a reason code, never words)
        reason = str(getattr(e, "reason", None) or "")
        if reason.startswith("unreadable"):
            store.record_telemetry(uid, cid, {"path": "failed", "disposition": "error", "unsupported": reason, "voice": body.voice,
                                              "schema_mode": "constant" if agent.constant_schema() else "routed"})
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001 -- a provider failure is a sentence, not a 500
        _give_back(uid)
        if shown:
            store.add_turn(uid, cid, "outcome", "UCT Agent was unavailable for this message.", {"kind": "error"})
        kind, said = provider_failure(e)
        log.exception("[uct-agent] turn failed kind=%s class=%s", kind, type(e).__name__)
        raise HTTPException(status_code=503, detail=said)
    finally:
        if v2:
            _v2_unregister(token)
    if v2:
        if out.get("paused"):
            return _v2_park(token, uid, cid, out, bool(body.voice))
        return _v2_finish(uid, cid, out, bool(body.voice), background)
    env, usage = out["envelope"], out["usage"]
    t_post = time.perf_counter()
    try:
        # A request for more action groups is plumbing, not a reply: nothing is stored for it.
        turn_id = None if env.get("need_groups") else store.add_turn(uid, cid, "agent", env.get("reply") or (env.get("question") or {}).get("text") or "",
                             {"envelope": env, "citations": usage.get("citations"),
                              # Wave 3: a COACH turn's reply (it read the coach's concept / Brain text) is marked, so the
                              # chat-naming request leaves it out (turn.name_conversation)
                              **({"coach": True} if "coach_guard" in usage else {})})
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
        background.add_task(_name_unnamed, uid, cid, request_id, clock)
    background.add_task(store.record_telemetry, uid, cid, {
        # routing in the existing columns: path model | routed | reroute; disposition need_groups
        "path": "reroute" if body.reroute else ("routed" if body.routing else "model"),
        "disposition": "need_groups" if env.get("need_groups") else env["disposition"],
        "actions": [o.get("action") for o in env.get("ops") or []],
        "clarified": env["disposition"] == "clarify", "latency_ms": usage.get("latency_ms"),
        "model": usage.get("model"), "cost_usd": usage.get("cost_usd"),
        "research_calls": usage.get("research_calls"), "unsupported": env.get("unsupported_category"),
        "voice": body.voice, **_speed_fields(usage),
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


def _speed_fields(usage: dict) -> dict:
    """What the speed report reads off one turn: counts and the schema mode, never content."""
    return {k: usage.get(k) for k in ("model_calls", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "schema_mode")}


def _set_title(uid: int, cid: str, title: str) -> None:
    from api.services.uct_agent import store
    try:
        store.set_auto_title(uid, cid, title)           # refuses by itself over a member's own name
    except Exception:  # noqa: BLE001 -- the reply stands; only the name update is lost
        log.exception("[uct-agent] could not store the conversation title")


NAMING_MIN_LEFT_S = 10.0


def _name_unnamed(uid: int, cid: str, request_id: int | None = None, clock=None) -> None:
    """Background: name a chat that is still on its first message. Never over the member's own
    name (the store refuses that) or over a name the Agent gave it meanwhile. The naming call is
    one of its request's calls (budget.py): a request that used both is not named this turn."""
    from api.services.uct_agent import budget, store, turn as agent
    try:
        if clock is not None and clock.left() < NAMING_MIN_LEFT_S:
            return                                      # a call capped to seconds would time out and cost its worst case
        if over_cost_cap() or (store.title_info(uid, cid) or {}).get("source") is not None:
            return
        try:
            title = agent.name_conversation(store.get_turns(uid, cid) or [],
                                            meter=budget.Meter(user_id=uid, request_id=request_id, clock=clock))
        except budget.BudgetRefused as e:
            log.info("[uct-agent] naming skipped reason=%s", e.reason)
            return
        if title and (store.title_info(uid, cid) or {}).get("source") is None:
            store.set_auto_title(uid, cid, title)
    except Exception:  # noqa: BLE001 -- naming is a nicety; the chat keeps its first-message name
        log.exception("[uct-agent] background naming failed")


@router.get("/api/agent/budget")
def agent_budget(user: dict = Depends(require_admin_dark)):
    """Today's Agent AI spend against its cap and the shared $15 cap (not site-wide): aggregates only."""
    from api.services.uct_agent import budget
    return budget.state()


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


# ── per-conversation state (W1-C C-01, builder-c): the last screen, so a follow-up composes after a reload ──
# GET/PUT /api/agent/conversations/{id}/state/{key}. Keys are store.STATE_KEYS (`lastScreen`; W3-3 `coachConsent`);
# the value is validated per key before it is stored: `lastScreen` by services/uct_agent/scan/refine.py (the
# screener's catalog, F-16 hidden keys, ≤ 50 result ids), `coachConsent` by services/uct_agent/coach.validate_consent
# ({granted: bool}; the server stamps `at`), and that key exists only while UCT_AGENT_COACH is on (404 otherwise).
# Owner-scoped: a conversation that is not the member's is 404, like every route above.
class StateIn(BaseModel):
    value: Any


def _state_key_served(key: str) -> bool:
    if key == "coachConsent":
        from api.services.uct_agent import coach
        return coach.enabled()
    return True


def _validate_state(key: str, value: Any) -> Any:
    if key == "coachConsent":
        from api.services.uct_agent import coach
        return coach.validate_consent(value)
    from api.services.uct_agent.scan import refine
    return refine.validate_last_screen(value)


@router.get("/api/agent/conversations/{conversation_id}/state/{key}")
def agent_conversation_state(conversation_id: str, key: str, user: dict = Depends(require_admin_dark)):
    from api.services.uct_agent import store
    if key not in store.STATE_KEYS or not _state_key_served(key) or not store.owns(user["id"], conversation_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    got = store.get_state(user["id"], conversation_id, key)
    return {"key": key, "value": got["value"] if got else None, "updated_at": got["updated_at"] if got else None}


@router.put("/api/agent/conversations/{conversation_id}/state/{key}")
def agent_conversation_state_put(conversation_id: str, key: str, body: StateIn, user: dict = Depends(require_admin_dark)):
    from api.services.uct_agent import store
    if key not in store.STATE_KEYS or not _state_key_served(key) or not store.owns(user["id"], conversation_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    try:
        value = _validate_state(key, body.value)
        store.set_state(user["id"], conversation_id, key, value)
    except ValueError as e:                      # RefineError is a ValueError, with the member-facing sentence
        raise HTTPException(status_code=400, detail=str(e)[:400])
    return {"key": key, "value": value}


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


class DataReadIn(BaseModel):
    kind: str = Field(..., max_length=64)
    params: dict = Field(default_factory=dict)
    purpose: str = Field("answer", max_length=16)
    turn_id: str = Field(..., max_length=80)


@router.post("/api/agent/data")
def agent_data(body: DataReadIn, user: dict = Depends(require_admin_dark)):
    """One MD-1 market-data read (services/uct_agent/marketdata/gateway.py) -> a DataEnvelope. Read-only, no
    model call; research.company may run one metered web lookup. Dark twice: admin-dark like every route here, and
    refused unless UCT_AGENT_DATA=1."""
    from api.services.uct_agent.marketdata import gateway
    return gateway.read(body.kind, body.params, user_id=user.get("id"), turn_id=body.turn_id, purpose=body.purpose)


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
    # ONE selection policy (uct_agent.breadth_select, owner 2026-10-13, D5 amended): "the last N sessions"
    # is answered there (finalized rows + completed provisional sessions, each with its status)
    from api.services.uct_agent import breadth_select
    if isinstance(body, dict) and body.get("mode") == "rows":
        got = breadth_select.rows(body, below=below)
        log.info("[uct-agent] breadth rows status=%s", got.get("status"))                # never a value
        mets = body.get("metrics")
        chart = (breadth_present.chart_target(body.get("universe"), mets[0], "below" if below else None)
                 if got.get("status") == "ok" and isinstance(mets, list) and len(mets) == 1 else None)
        return {**got, **({"chart": chart} if chart else {})}
    if isinstance(body, dict) and "sessions" in body:
        body = {k: v for k, v in body.items() if k != "sessions"}           # the rows mode's own field
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
    status = out.get("status")
    # LATEST CLOSE / A DATED SESSION (D5 amended): the newest completed session, or that exact session,
    # as a clearly labelled provisional close when it is not finalized yet — never another date
    if breadth_select.when_of(body) in ("latest_close", "session"):
        try:
            status, text, present, _kinds = breadth_select.close_overlay(body, res, out, present, below=below)
        except Exception:  # noqa: BLE001 -- the finalized answer (or its refusal) stands
            log.exception("[uct-agent] completed-session selection failed; finalized answer shown")
    # OPEN CHART: one measure answered → its published chart series (never for "below" or an overview)
    mets = body.get("metrics") if isinstance(body, dict) else None
    chart = (breadth_present.chart_target(body.get("universe"), mets[0], "below" if below else None)
             if status in ("ok", "partial") and isinstance(mets, list) and len(mets) == 1 else None)
    return {"status": status, "text": text, "table": out.get("table"), "present": present,
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
    from api.services.uct_agent import breadth_history_present, breadth_select
    # (2026-10-13 audit) an always-true condition is not a search ("history above 0%" was invented for
    # "show me the last 30 days"): said, with the way to see the readings themselves
    why = breadth_select.trivial_condition(body)
    if why:
        log.info("[uct-agent] breadth history status=refused reason=trivial_condition")
        return {"status": "refused", "text": why, "table": None, "present": {"kind": "error", "text": why}}
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
