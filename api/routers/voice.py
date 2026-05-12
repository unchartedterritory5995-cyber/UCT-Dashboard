"""
Voice router — TTS, settings, usage. Slice 1 (Mode A only).
Future slices add /oneshot, /session_token, /exec, /transcripts, /tools.
"""

import logging
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from api.limiter import limiter
from api.middleware.auth_middleware import requires_voice_access
from api.services.voice_settings_service import (
    get_voice_settings,
    update_voice_settings,
    ALLOWED_VOICES,
    MIN_SPEED,
    MAX_SPEED,
)
from api.services.voice_usage import (
    record_mode_a_seconds,
    get_monthly_usage,
    is_within_mode_a_cap,
    MODE_A_DEFAULT_CAP_SECONDS,
)
from api.services.voice_audio_cache import get_cached, put_cached
from api.services.voice_openai import synthesize_speech, synthesize_speech_stream, MAX_INPUT_CHARS
from fastapi import UploadFile, File, Form
from urllib.parse import quote as _urlquote
from api.services.voice_openai import transcribe_audio
from api.services.voice_intent import run_oneshot
from api.services.voice_tools import get_schema_for_context
from api.services.voice_usage import (
    record_mode_b_call, is_within_mode_b_cap, MODE_B_DEFAULT_CAP_CALLS,
    record_mode_c_seconds, is_within_mode_c_cap, MODE_C_DEFAULT_CAP_SECONDS,
)
from api.services.voice_openai import mint_realtime_session
from api.services.voice_session_service import (
    create_session as _create_voice_session, end_session as _end_voice_session,
    append_transcript, session_belongs_to_user,
)
from api.services.voice_dispatch import run_tool
from api.services.voice_memory_service import (
    build_memory_context, add_summary,
    add_fact as _mem_add_fact,
    list_facts as _mem_list_facts,
    delete_fact as _mem_delete_fact,
    list_summaries as _mem_list_summaries,
    ALLOWED_CATEGORIES as _MEM_CATEGORIES,
)
from api.services.voice_session_service import get_transcripts as _get_session_transcripts
from api.services.voice_summarizer import summarize_transcripts

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/voice", tags=["voice"])


# ── Schemas ─────────────────────────────────────────────────────────────────

class TtsRequest(BaseModel):
    text: str
    voice: str | None = None
    speed: float | None = Field(None, ge=MIN_SPEED, le=MAX_SPEED)


class SettingsUpdateRequest(BaseModel):
    enabled: bool | None = None
    voice: str | None = None
    speed: float | None = Field(None, ge=MIN_SPEED, le=MAX_SPEED)
    retention_days: int | None = Field(None, ge=1, le=3650)


# ── Helpers ─────────────────────────────────────────────────────────────────

def _estimate_seconds(text: str, speed: float) -> int:
    """
    Rough estimate used for usage tracking.
    English read-aloud ≈ 150 wpm at speed=1.0 ≈ 2.5 words/sec.
    Speed scales linearly. Always returns at least 1.
    """
    words = max(1, len(text.split()))
    base_seconds = words / 2.5
    seconds = int(round(base_seconds / max(speed, 0.1)))
    return max(1, seconds)


# ── Endpoints ───────────────────────────────────────────────────────────────

@router.post("/tts")
@limiter.limit("30/minute")
def tts(request: Request, body: TtsRequest, user: dict = Depends(requires_voice_access)):
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    if len(text) > MAX_INPUT_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"text exceeds max length ({MAX_INPUT_CHARS} chars)",
        )

    settings = get_voice_settings(user["id"])
    if not settings.get("enabled", True):
        raise HTTPException(status_code=400, detail="voice features disabled in settings")
    voice = body.voice or settings["voice"]
    speed = body.speed if body.speed is not None else settings["speed"]
    if voice not in ALLOWED_VOICES:
        raise HTTPException(status_code=400, detail=f"unknown voice: {voice}")

    is_admin = user.get("role") == "admin"
    if not is_within_mode_a_cap(user["id"], is_admin=is_admin):
        raise HTTPException(status_code=429, detail="monthly read-aloud cap reached")

    cached = get_cached(text, voice=voice, speed=speed)
    if cached is not None:
        return Response(content=cached, media_type="audio/mpeg")

    # Pre-check OpenAI client config so we can return 503 BEFORE starting the stream.
    try:
        from api.services.voice_openai import _get_client
        _get_client()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    accumulated = bytearray()
    user_id = user["id"]

    def streamer():
        try:
            for chunk in synthesize_speech_stream(text, voice=voice, speed=speed):
                accumulated.extend(chunk)
                yield chunk
        except Exception as e:
            _log.exception("voice synth streaming failed: %s", e)
            # Stream truncates; browser <audio> shows error. Nothing more we can do mid-stream.

    def on_complete():
        if accumulated:
            put_cached(text, voice, speed, bytes(accumulated))
            record_mode_a_seconds(user_id, _estimate_seconds(text, speed))

    return StreamingResponse(
        streamer(),
        media_type="audio/mpeg",
        background=BackgroundTask(on_complete),
    )


@router.get("/settings")
def settings_get(user: dict = Depends(requires_voice_access)):
    return get_voice_settings(user["id"])


@router.put("/settings")
@limiter.limit("30/minute")
def settings_put(
    request: Request,
    body: SettingsUpdateRequest,
    user: dict = Depends(requires_voice_access),
):
    try:
        return update_voice_settings(
            user["id"],
            enabled=body.enabled,
            voice=body.voice,
            speed=body.speed,
            retention_days=body.retention_days,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/usage")
def usage_get(user: dict = Depends(requires_voice_access)):
    is_admin = user.get("role") == "admin"
    cap = float("inf") if is_admin else MODE_A_DEFAULT_CAP_SECONDS
    u = get_monthly_usage(user["id"])
    return {
        **u,
        "cap_seconds": cap if cap != float("inf") else None,
        "uncapped": is_admin,
    }


# ── Slice 2: One-Shot (Mode B) ──────────────────────────────────────────────

@router.get("/tools")
def tools_get(context: str = "global", user: dict = Depends(requires_voice_access)):
    """Return the tool catalog visible from the given page context."""
    return {"context": context, "tools": get_schema_for_context(context)}


@router.post("/oneshot")
@limiter.limit("60/minute")
def oneshot(
    request: Request,
    audio: UploadFile = File(...),
    context: str = Form("global"),
    user: dict = Depends(requires_voice_access),
):
    audio_bytes = audio.file.read() if audio else b""
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="audio is empty")

    settings = get_voice_settings(user["id"])
    if not settings.get("enabled", True):
        raise HTTPException(status_code=400, detail="voice features disabled in settings")

    is_admin = user.get("role") == "admin"
    if not is_within_mode_b_cap(user["id"], is_admin=is_admin):
        raise HTTPException(status_code=429, detail="monthly voice query cap reached")

    try:
        from api.services.voice_openai import _get_client
        _get_client()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    try:
        transcript = transcribe_audio(audio_bytes, filename=audio.filename or "audio.webm")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        _log.exception("Whisper failed")
        raise HTTPException(status_code=502, detail=f"Transcription failed: {e}")

    pipeline = run_oneshot(transcript=transcript, context=context, user=user)
    narration = pipeline["narration"]

    voice_name = settings["voice"]
    speed = settings["speed"]
    accumulated = bytearray()
    user_id = user["id"]

    def streamer():
        try:
            for chunk in synthesize_speech_stream(narration, voice=voice_name, speed=speed):
                accumulated.extend(chunk)
                yield chunk
        except Exception as e:
            _log.exception("oneshot synth streaming failed: %s", e)

    def on_complete():
        if accumulated:
            record_mode_b_call(user_id)

    headers = {
        "X-Voice-Transcript": _urlquote(transcript[:500]),
        "X-Voice-Narration": _urlquote(narration[:500]),
        "X-Voice-Tool": pipeline.get("tool") or "",
    }

    return StreamingResponse(
        streamer(),
        media_type="audio/mpeg",
        headers=headers,
        background=BackgroundTask(on_complete),
    )


# ── Slice 4: Realtime (Mode C) ─────────────────────────────────────────────

class SessionTokenRequest(BaseModel):
    context: str = "global"


class ExecRequest(BaseModel):
    session_id: int
    tool: str
    args: dict = {}


_REALTIME_INSTRUCTIONS = (
    "You are UCT Intelligence, a voice trading assistant. Always respond — "
    "never go silent. Speak like a sharp colleague: concise, natural, no "
    "disclaimers. Round numbers reasonably. Never invent prices or data.\n\n"
    "AGENT LOOP: For non-trivial questions, prefer MULTIPLE tool calls per "
    "turn over single-shot. Fetch what you need, then synthesize. Examples: "
    "'should I trade NVDA' → call get_quote, get_theme_status, "
    "find_my_trades(symbol='NVDA') in sequence, then answer with the joined "
    "context. For deep recall use `recall_relevant(query)` — it does "
    "semantic search over every fact, summary, and journal entry, much "
    "better than the recency-only injection.\n\n"
    "SCRATCHPAD: When you've gathered info from several tools and want to "
    "reference it later in the same conversation, write it with "
    "`note_write(key, value)`. Read back with `note_read(key)` or "
    "`note_list`. This prevents re-fetching the same data and lets you "
    "build up structured reasoning across turns.\n\n"
    "TOOL RESULTS: When a tool returns a `narration` field, speak it almost "
    "verbatim. When a tool returns structured data, summarize it in one or two "
    "sentences. If a tool returns `{ok: false, error: ...}` or "
    "`{ok: false, narration: ...}`, look at the `recovery_hint` field too — it "
    "suggests a next tool to try or a clarifying question to ask. Do not just "
    "give up; either retry with a corrected argument, try the suggested tool, "
    "or ask one focused clarifying question.\n\n"
    "BRIEFINGS: For broad asks, prefer the agentic tools — `morning_briefing`, "
    "`closing_briefing`, `pre_trade_check(symbol)`, `post_trade_review(symbol)`, "
    "`plan_my_day`. Just speak the returned narration.\n\n"
    "NAVIGATION & PLAYBACK: When the user says 'open X', 'take me to X', or "
    "'go to X', call `open_page(name)`. When they say 'read me X' or 'play X', "
    "call `read_aloud(content)`. After the tool returns, briefly confirm "
    "('Opening journal' / 'Playing the morning wire') — the page change and "
    "audio playback happen automatically.\n\n"
    "MEMORY & TRAINING: When the user states a preference or fact about "
    "themselves, silently call `remember(fact, category)`. When they say "
    "'forget X', call `forget(query=X)`. When they ask what you remember, "
    "call `list_my_facts`. When they reference a past conversation, call "
    "`recall_session(query)`. When they correct you ('no, actually X is Y' / "
    "'remember that I prefer Z') call `correct_me(what_was_wrong, "
    "what_was_right)` — those corrections persist across all future sessions.\n\n"
    "WATCHLIST & TAGS: Single-step writes (no confirm step needed). "
    "`flag_ticker(symbol)`, `unflag_ticker`, `tag_ticker(symbol, color)`, "
    "`untag_ticker`, `add_to_watchlist(symbol, list_name)`, "
    "`remove_from_watchlist`, `set_price_alert(symbol, target_price, "
    "direction)`, `cancel_alert`. Colors: green, blue, orange, red, purple, "
    "gold, teal.\n\n"
    "JOURNAL WRITES — two-phase confirm pattern:\n"
    "  1. User asks to create/close/update a position, add a note, or log a "
    "     mistake → call the matching write tool (`create_position`, "
    "     `close_position`, `update_position`, `add_daily_note`, `log_mistake`).\n"
    "  2. The tool returns `{action_id, narration}`. Speak the narration "
    "     (it ends with 'Confirm?').\n"
    "  3. Wait for the user to say yes/confirm.\n"
    "  4. Call `confirm_action(action_id)`. If it returns `{ok: true}`, briefly "
    "     acknowledge ('Done — logged.'). If `{ok: false, error}`, say the error.\n"
    "If the user says 'no' or asks to change a value, do NOT call confirm — "
    "instead call the write tool again with the new values."
)


# Train Me mode — restricted to memory tools. Every user utterance is
# interpreted as something to save, not a question to answer.
_TRAIN_ME_INSTRUCTIONS = (
    "You are UCT Intelligence in TRAINING MODE. The user is teaching you "
    "preferences, facts, and corrections that should persist across all "
    "future conversations. Do NOT answer questions, give market data, or "
    "navigate — you only have memory tools available.\n\n"
    "BEHAVIOR:\n"
    "  - Every user utterance is either (a) a fact/preference to save, "
    "    (b) a correction of something you previously said wrong, or "
    "    (c) a request to list/forget what you remember.\n"
    "  - For statements of preference or fact ('I trade swing setups', 'My "
    "    main account is named Alpha', 'I prefer aggressive scaling') call "
    "    `remember(fact, category)` and confirm 'Got it — I'll remember that.'\n"
    "  - For corrections ('actually X means Y', 'when I say themes I mean Z') "
    "    call `correct_me(what_was_wrong, what_was_right)` and confirm.\n"
    "  - If they say 'forget X' call `forget(query)`.\n"
    "  - If they ask 'what do you remember' call `list_my_facts`.\n"
    "  - If they say 'exit', 'stop', 'done', 'thanks', or 'that's all', "
    "    acknowledge briefly. The user will close training mode from the UI.\n\n"
    "Keep replies under 12 words. Don't ramble. The point is rapid teaching, "
    "not conversation."
)


@router.post("/session_token")
@limiter.limit("10/minute")
def session_token(
    request: Request,
    body: SessionTokenRequest,
    user: dict = Depends(requires_voice_access),
):
    import time as _time
    uid = user["id"]
    _t0 = _time.time()
    _log.info("[session_token] start user=%s", uid)

    settings = get_voice_settings(uid)
    _log.info("[session_token] +%.0fms settings loaded", (_time.time() - _t0) * 1000)
    if not settings.get("enabled", True):
        raise HTTPException(status_code=400, detail="voice features disabled in settings")

    is_admin = user.get("role") == "admin"
    if not is_within_mode_c_cap(uid, is_admin=is_admin):
        raise HTTPException(status_code=429, detail="monthly conversation cap reached")
    _log.info("[session_token] +%.0fms cap check ok", (_time.time() - _t0) * 1000)

    ctx = body.context or "global"
    tools_schema = get_schema_for_context(ctx)
    _log.info("[session_token] +%.0fms %d tools loaded (ctx=%s)",
              (_time.time() - _t0) * 1000, len(tools_schema), ctx)

    memory_context = build_memory_context(uid)
    _log.info("[session_token] +%.0fms memory context %d chars",
              (_time.time() - _t0) * 1000, len(memory_context))

    base_instructions = _TRAIN_ME_INSTRUCTIONS if ctx == "train_me" else _REALTIME_INSTRUCTIONS

    # Inject current market regime (Batch 9b). Skipped for train_me since
    # that context shouldn't reason about market state.
    regime_line = ""
    if ctx != "train_me":
        try:
            from api.services.voice_regime_classifier import build_regime_prompt_line
            regime_line = build_regime_prompt_line()
        except Exception as e:
            _log.warning("[session_token] regime injection failed: %s", e)

    session_instructions = base_instructions
    if regime_line:
        session_instructions = session_instructions + "\n\n" + regime_line
    if memory_context:
        session_instructions = (
            session_instructions
            + "\n\n=== USER CONTEXT ===\n"
            + memory_context
            + "\n=== END USER CONTEXT ==="
        )

    # Run the OpenAI mint with a hard timeout so we fail fast instead of letting
    # Cloudflare wait 30s for nothing.
    import concurrent.futures as _cf
    _log.info("[session_token] +%.0fms calling OpenAI mint...", (_time.time() - _t0) * 1000)
    try:
        with _cf.ThreadPoolExecutor(max_workers=1) as ex:
            fut = ex.submit(
                mint_realtime_session,
                voice=settings["voice"],
                tools=tools_schema,
                instructions=session_instructions,
            )
            try:
                mint = fut.result(timeout=15)
            except _cf.TimeoutError:
                _log.warning("[session_token] +%.0fms OpenAI mint timed out",
                             (_time.time() - _t0) * 1000)
                raise HTTPException(
                    status_code=504,
                    detail="OpenAI Realtime session mint timed out after 15s",
                )
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        # Put the exception class + message right in the log line so we don't
        # have to scroll the traceback to diagnose.
        _log.error(
            "[session_token] +%.0fms mint failed: %s: %s",
            (_time.time() - _t0) * 1000, type(e).__name__, e,
        )
        _log.exception("[session_token] full traceback")
        raise HTTPException(
            status_code=502,
            detail=f"Realtime session mint failed: {type(e).__name__}: {e}",
        )

    _log.info("[session_token] +%.0fms mint succeeded: %s",
              (_time.time() - _t0) * 1000, mint.get("session_id"))

    sess_db_id = _create_voice_session(
        user_id=uid, mode="c", source="orb", page_context=body.context or "global",
    )
    _log.info("[session_token] +%.0fms returning sess_id=%s",
              (_time.time() - _t0) * 1000, sess_db_id)

    return {
        "session_id": sess_db_id,
        "openai_session_id": mint["session_id"],
        "client_secret": mint["client_secret"],
        "expires_at": mint["expires_at"],
        "model": mint["model"],
        "voice": settings["voice"],
        "tools": tools_schema,
    }


@router.post("/exec")
@limiter.limit("120/minute")
def exec_tool(
    request: Request,
    body: ExecRequest,
    user: dict = Depends(requires_voice_access),
):
    if not session_belongs_to_user(body.session_id, user["id"]):
        raise HTTPException(status_code=403, detail="session not owned by user")

    return run_tool(
        session_id=body.session_id,
        user_id=user["id"],
        tool_name=body.tool,
        args=body.args or {},
    )


class TranscriptRequest(BaseModel):
    session_id: int
    role: str
    text: str


class SessionEndRequest(BaseModel):
    session_id: int
    duration_seconds: int


@router.post("/transcript")
@limiter.limit("180/minute")
def transcript_post(
    request: Request,
    body: TranscriptRequest,
    user: dict = Depends(requires_voice_access),
):
    if not session_belongs_to_user(body.session_id, user["id"]):
        raise HTTPException(status_code=403, detail="session not owned by user")
    if body.role not in {"user", "assistant", "tool"}:
        raise HTTPException(status_code=400, detail="invalid role")
    append_transcript(body.session_id, role=body.role, text=body.text or "")
    return {"ok": True}


@router.post("/session/end")
@limiter.limit("60/minute")
def session_end_post(
    request: Request,
    body: SessionEndRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(requires_voice_access),
):
    if not session_belongs_to_user(body.session_id, user["id"]):
        raise HTTPException(status_code=403, detail="session not owned by user")
    duration = max(0, int(body.duration_seconds or 0))
    estimated_cost = duration * 0.005
    _end_voice_session(body.session_id, duration_seconds=duration,
                       estimated_cost_usd=estimated_cost)
    if duration > 0:
        record_mode_c_seconds(user["id"], duration)

    # Schedule background summarization (non-blocking)
    background_tasks.add_task(_summarize_session_background, body.session_id, user["id"])

    return {"ok": True, "duration_seconds": duration}


def _summarize_session_background(session_id: int, user_id: str) -> None:
    """Runs after /session/end returns. Best-effort; failures are logged but swallowed."""
    try:
        transcripts = _get_session_transcripts(session_id) or []
        roles = {t.get("role") for t in transcripts}
        if "user" not in roles or "assistant" not in roles:
            return
        result = summarize_transcripts(transcripts)
        summary = result.get("summary") or ""
        if not summary.strip():
            return
        add_summary(
            session_id=session_id, user_id=user_id,
            summary_text=summary,
            key_topics=result.get("key_topics") or [],
        )
    except Exception as e:  # noqa: BLE001
        _log.warning("session summarization failed for %s: %s", session_id, e)


# ── Memory endpoints ───────────────────────────────────────────────────────

class FactCreate(BaseModel):
    text: str
    category: str = "general"


@router.get("/memory/facts")
def memory_facts_get(user: dict = Depends(requires_voice_access)):
    return {"facts": _mem_list_facts(user["id"])}


@router.post("/memory/facts")
@limiter.limit("30/minute")
def memory_facts_post(
    request: Request,
    body: FactCreate,
    user: dict = Depends(requires_voice_access),
):
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    category = body.category if body.category in _MEM_CATEGORIES else "general"
    try:
        fid = _mem_add_fact(user["id"], text=text, category=category)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"id": fid, "text": text, "category": category}


@router.delete("/memory/facts/{fact_id}")
def memory_fact_delete(
    fact_id: int,
    user: dict = Depends(requires_voice_access),
):
    _mem_delete_fact(fact_id, user_id=user["id"])
    return {"ok": True}


@router.get("/memory/summaries")
def memory_summaries_get(user: dict = Depends(requires_voice_access)):
    return {"summaries": _mem_list_summaries(user["id"], limit=20)}


# ── Batch 5: feedback / training ────────────────────────────────────────────

class FeedbackCreate(BaseModel):
    rating: str  # 'up' | 'down'
    session_id: int | None = None
    turn_text: str | None = None
    correction_text: str | None = None


@router.post("/feedback")
@limiter.limit("60/minute")
def feedback_post(
    request: Request,
    body: FeedbackCreate,
    user: dict = Depends(requires_voice_access),
):
    from api.services.voice_feedback_service import record_feedback
    if body.rating not in ("up", "down"):
        raise HTTPException(status_code=400, detail="rating must be 'up' or 'down'")
    try:
        fb = record_feedback(
            user["id"],
            rating=body.rating,
            session_id=body.session_id,
            turn_text=(body.turn_text or None),
            correction_text=(body.correction_text or None),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return fb


@router.get("/feedback")
def feedback_list(user: dict = Depends(requires_voice_access)):
    from api.services.voice_feedback_service import list_feedback
    return {"feedback": list_feedback(user["id"], limit=200)}


@router.get("/feedback/corrections")
def corrections_list(user: dict = Depends(requires_voice_access)):
    from api.services.voice_feedback_service import list_corrections
    return {"corrections": list_corrections(user["id"], limit=50)}


@router.get("/tool-call-stats")
def tool_call_stats(user: dict = Depends(requires_voice_access)):
    """Per-tool success/failure counts and recent failures — debugging pane."""
    from api.services.voice_feedback_service import get_tool_call_stats
    return get_tool_call_stats(user["id"], limit=50)


@router.get("/failure-patterns")
def failure_patterns(user: dict = Depends(requires_voice_access)):
    """Tools with high recent failure rates — surfaces as a banner in the
    Telemetry pane and gets injected into the model's instructions."""
    from api.services.voice_feedback_service import detect_failure_patterns
    return {"patterns": detect_failure_patterns(user["id"])}


@router.post("/embeddings/reindex")
@limiter.limit("5/minute")
def embeddings_reindex(
    request: Request,
    user: dict = Depends(requires_voice_access),
):
    """Backfill embeddings for the user's facts + summaries. Idempotent."""
    from api.services.voice_embeddings_service import reindex_user
    counts = reindex_user(user["id"])
    return counts


@router.post("/kb/reindex")
@limiter.limit("3/minute")
def kb_reindex(
    request: Request,
    force: bool = False,
    user: dict = Depends(requires_voice_access),
):
    """Reseed the shared Trading Knowledge Base. force=true wipes and re-embeds."""
    from api.services.voice_kb_service import index_corpus
    counts = index_corpus(force=force)
    return counts


@router.get("/kb/search")
def kb_search(
    q: str = "",
    k: int = 3,
    user: dict = Depends(requires_voice_access),
):
    """Search the Trading KB directly (debug endpoint)."""
    from api.services.voice_kb_service import lookup
    return {"query": q, "hits": lookup(q, k=max(1, min(10, int(k))))}


@router.get("/embeddings/search")
def embeddings_search(
    q: str = "",
    kind: str = "",
    k: int = 5,
    user: dict = Depends(requires_voice_access),
):
    """Debug endpoint — semantic search over the user's embeddings."""
    from api.services.voice_embeddings_service import search
    target_kind = kind if kind in ("fact", "summary", "journal_entry",
                                   "transcript", "kb_chunk") else None
    hits = search(user["id"], q, k=max(1, min(50, int(k))), kind=target_kind)
    return {"query": q, "kind": target_kind, "hits": hits}


@router.get("/transcripts/export")
def transcripts_export(
    format: str = "txt",
    limit: int = 100,
    user: dict = Depends(requires_voice_access),
):
    """Download every voice session transcript as plain text or JSON."""
    from api.services.voice_session_service import list_sessions
    sessions = list_sessions(user["id"], limit=max(1, min(500, int(limit))))

    transcripts_by_session = []
    for s in sessions:
        turns = _get_session_transcripts(s["id"])
        transcripts_by_session.append({
            "session_id": s["id"],
            "mode": s.get("mode"),
            "started_at": s.get("started_at"),
            "ended_at": s.get("ended_at"),
            "duration_seconds": s.get("duration_seconds"),
            "turns": turns,
        })

    fmt = (format or "txt").lower()
    if fmt == "json":
        import json as _json
        body = _json.dumps({"sessions": transcripts_by_session}, indent=2)
        return Response(
            content=body,
            media_type="application/json",
            headers={"Content-Disposition": "attachment; filename=voice_transcripts.json"},
        )

    # Plain-text format
    lines = []
    for s in transcripts_by_session:
        started = s.get("started_at") or ""
        lines.append(f"━━━ Session {s['session_id']} — {s.get('mode')} — {started} ━━━")
        for t in s.get("turns") or []:
            role = t.get("role", "?").upper()
            ts = (t.get("timestamp") or "")[:19]
            text = t.get("text") or ""
            lines.append(f"[{ts}] {role}: {text}")
        lines.append("")
    body = "\n".join(lines) if lines else "No voice transcripts yet.\n"
    return Response(
        content=body,
        media_type="text/plain",
        headers={"Content-Disposition": "attachment; filename=voice_transcripts.txt"},
    )
