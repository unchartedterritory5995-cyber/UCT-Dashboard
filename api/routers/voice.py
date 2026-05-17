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
from api.services.voice_openai import transcribe_audio, cleanup_transcript
from api.services.voice_intent import run_oneshot
from api.services.voice_tools import get_schema_for_context
from api.services.voice_usage import (
    record_mode_b_call, is_within_mode_b_cap, MODE_B_DEFAULT_CAP_CALLS,
    record_mode_c_seconds, is_within_mode_c_cap, MODE_C_DEFAULT_CAP_SECONDS,
    record_mode_d_seconds, is_within_mode_d_cap, MODE_D_DEFAULT_CAP_SECONDS,
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
    # P3-C unification: opt-in proactive speech for daemon-fired alerts
    proactive_speak: bool | None = None


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
            proactive_speak=body.proactive_speak,
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


@router.get("/agents")
def agents_get(user: dict = Depends(requires_voice_access)):
    """Return the list of specialist agents the user can start a session with."""
    from api.services.voice_agents import list_agents
    return {"agents": list_agents()}


@router.get("/insights")
def insights_list(user: dict = Depends(requires_voice_access)):
    """All proactive insights (delivered + pending + dismissed) for the user."""
    from api.services.voice_proactive_service import list_history
    return {"insights": list_history(user["id"], limit=100)}


@router.get("/insights/pending")
def insights_pending(user: dict = Depends(requires_voice_access)):
    """Only undelivered + undismissed insights."""
    from api.services.voice_proactive_service import list_pending_insights
    return {"insights": list_pending_insights(user["id"], limit=20)}


@router.get("/risk-dashboard")
def risk_dashboard_get(user: dict = Depends(requires_voice_access)):
    """Compose the Risk Dashboard payload for the user — total heat,
    by-symbol, by-sector, recent refusals, account settings."""
    from api.services.voice_position_sizing import get_risk_dashboard
    return get_risk_dashboard(user["id"])


@router.post("/insights/{insight_id}/dismiss")
@limiter.limit("60/minute")
def insights_dismiss(
    request: Request,
    insight_id: int,
    user: dict = Depends(requires_voice_access),
):
    from api.services.voice_proactive_service import dismiss
    ok = dismiss(insight_id, user["id"])
    return {"ok": ok}


# ── P4-A: end-to-end proactive voice ──────────────────────────────────────
# Surfaces ONE high-importance insight per poll so the frontend hook can
# speak it via TTS without opening a full voice session. Filters by the
# user's proactive_speak setting (off = always returns empty).

_PROACTIVE_SPEAK_MIN_IMPORTANCE = 7


@router.get("/insights/unspoken")
def insights_unspoken(user: dict = Depends(requires_voice_access)):
    """Return ONE high-severity insight to speak, or null. Respects the
    user's proactive_speak setting and minimum importance threshold."""
    from api.services.voice_proactive_service import list_pending_insights
    settings = get_voice_settings(user["id"])
    if not settings.get("proactive_speak"):
        return {"insight": None, "reason": "proactive_speak disabled"}
    pending = list_pending_insights(user["id"], limit=10)
    for ins in pending:
        if (ins.get("importance") or 0) >= _PROACTIVE_SPEAK_MIN_IMPORTANCE:
            # Compose speakable text: headline plus optional one-line body
            headline = (ins.get("headline") or "").strip()
            body = (ins.get("body") or "").strip()
            sym = (ins.get("symbol") or "").strip()
            spoken_text = headline
            if body and len(spoken_text) + len(body) < 400:
                spoken_text = f"{headline}. {body}"
            return {
                "insight": {
                    "id": ins["id"],
                    "kind": ins.get("kind"),
                    "symbol": sym,
                    "headline": headline,
                    "spoken_text": spoken_text,
                    "importance": ins.get("importance"),
                }
            }
    return {"insight": None}


@router.post("/insights/{insight_id}/mark-spoken")
@limiter.limit("60/minute")
def insights_mark_spoken(
    request: Request,
    insight_id: int,
    user: dict = Depends(requires_voice_access),
):
    """Mark a proactive insight as spoken (sets delivered_at). Scoped by
    user_id for defense-in-depth — won't mark another user's row."""
    from api.services.voice_proactive_service import (
        list_pending_insights, mark_delivered,
    )
    pending = list_pending_insights(user["id"], limit=50)
    if not any(p["id"] == insight_id for p in pending):
        # Either already delivered/dismissed, doesn't exist, or belongs to
        # another user. Idempotent — don't 404, just no-op.
        return {"ok": True, "marked": 0}
    n = mark_delivered([insight_id])
    return {"ok": True, "marked": n}


class VisionDescribeRequest(BaseModel):
    image_url: str | None = None
    image_b64: str | None = None
    symbol: str | None = None
    regime: str | None = None


@router.post("/vision/describe")
@limiter.limit("20/minute")
def vision_describe(
    request: Request,
    body: VisionDescribeRequest,
    user: dict = Depends(requires_voice_access),
):
    """GPT-4o vision pass on a chart image. Pass image_url OR image_b64."""
    from api.services.voice_chart_vision import describe_chart
    if not body.image_url and not body.image_b64:
        raise HTTPException(status_code=400, detail="image_url or image_b64 required")
    return describe_chart(
        image_url=body.image_url, image_b64=body.image_b64,
        symbol=body.symbol, regime=body.regime,
    )


@router.post("/vision/upload")
@limiter.limit("10/minute")
def vision_upload(
    request: Request,
    image: UploadFile = File(...),
    symbol: str = Form(""),
    user: dict = Depends(requires_voice_access),
):
    """Upload a chart screenshot for analysis (multipart). Returns same shape
    as /vision/describe."""
    import base64
    from api.services.voice_chart_vision import describe_chart
    raw = image.file.read() if image else b""
    if not raw:
        raise HTTPException(status_code=400, detail="empty image")
    # Cap at 5 MB to keep tokens reasonable
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="image too large (max 5MB)")
    b64 = base64.b64encode(raw).decode("ascii")
    regime = None
    try:
        from api.services.voice_regime_classifier import get_current_regime
        regime = (get_current_regime() or {}).get("regime")
    except Exception:
        pass
    return describe_chart(image_b64=b64, symbol=(symbol or None), regime=regime)


class DocumentIngestText(BaseModel):
    title: str
    text: str


@router.get("/documents")
def documents_list(user: dict = Depends(requires_voice_access)):
    from api.services.voice_document_service import list_user_documents
    return {"documents": list_user_documents(user["id"])}


@router.post("/documents/ingest-text")
@limiter.limit("10/minute")
def documents_ingest_text(
    request: Request,
    body: DocumentIngestText,
    user: dict = Depends(requires_voice_access),
):
    """Ingest a plain-text document for RAG. For PDFs, use /documents/upload."""
    from api.services.voice_document_service import ingest_text
    if not body.title.strip() or not body.text.strip():
        raise HTTPException(status_code=400, detail="title and text required")
    return ingest_text(user["id"], title=body.title, text=body.text,
                       source_type="text")


@router.post("/documents/upload")
@limiter.limit("5/minute")
def documents_upload(
    request: Request,
    file: UploadFile = File(...),
    title: str = Form(""),
    user: dict = Depends(requires_voice_access),
):
    """Upload a PDF (or text file) for RAG ingestion."""
    from api.services.voice_document_service import ingest_pdf_bytes, ingest_text
    raw = file.file.read() if file else b""
    if not raw:
        raise HTTPException(status_code=400, detail="empty file")
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="file too large (max 10MB)")
    filename = (file.filename or "untitled").rsplit(".", 1)[0]
    doc_title = (title or filename).strip() or "Untitled"
    if (file.filename or "").lower().endswith(".pdf"):
        return ingest_pdf_bytes(user["id"], title=doc_title, pdf_bytes=raw)
    try:
        text = raw.decode("utf-8", errors="ignore")
    except Exception:
        raise HTTPException(status_code=400, detail="could not decode file as utf-8")
    return ingest_text(user["id"], title=doc_title, text=text, source_type="text")


@router.delete("/documents/{doc_id}")
def documents_delete(
    doc_id: int,
    user: dict = Depends(requires_voice_access),
):
    from api.services.voice_document_service import delete_document
    ok = delete_document(user["id"], doc_id)
    return {"ok": ok}


@router.get("/documents/search")
def documents_search(
    q: str = "",
    doc_id: int | None = None,
    k: int = 5,
    user: dict = Depends(requires_voice_access),
):
    from api.services.voice_document_service import search_doc
    return {"query": q, "doc_id": doc_id,
            "hits": search_doc(user["id"], q, doc_id=doc_id, k=max(1, min(20, int(k))))}


@router.post("/insights/scan")
@limiter.limit("3/minute")
def insights_scan(
    request: Request,
    user: dict = Depends(requires_voice_access),
):
    """Trigger an on-demand scan (debug/testing). The scheduler runs this
    every 30 min during market hours automatically."""
    from api.services.voice_proactive_service import (
        scan_for_opportunities, maybe_emit_regime_shift,
    )
    n = scan_for_opportunities(user["id"])
    n += maybe_emit_regime_shift(user["id"])
    return {"queued": n}


@router.get("/learning/gaps")
def learning_gaps(user: dict = Depends(requires_voice_access)):
    """Knowledge gaps — slots the assistant doesn't have info on yet."""
    from api.services.voice_active_learning import detect_knowledge_gaps
    return {"gaps": detect_knowledge_gaps(user["id"])}


@router.get("/learning/ticker-obsessions")
def learning_obsessions(user: dict = Depends(requires_voice_access)):
    """Tickers the user mentions frequently but hasn't told us about."""
    from api.services.voice_active_learning import detect_ticker_obsessions
    return {"obsessions": detect_ticker_obsessions(user["id"])}


@router.post("/learning/consolidate")
@limiter.limit("3/minute")
def learning_consolidate(
    request: Request,
    user: dict = Depends(requires_voice_access),
):
    """Run memory consolidation NOW (also runs nightly via scheduler)."""
    from api.services.voice_active_learning import consolidate_memory
    return consolidate_memory(user["id"])


@router.get("/hallucinations")
def hallucinations_list(
    limit: int = 50,
    user: dict = Depends(requires_voice_access),
):
    """Recent hallucination flags (numeric claims that didn't match tool sources)."""
    from api.services.voice_hallucination_audit import list_recent_flags
    return {"flags": list_recent_flags(user["id"], limit=max(1, min(200, int(limit))))}


@router.post("/hallucinations/audit/{session_id}")
@limiter.limit("10/minute")
def hallucinations_audit_one(
    request: Request,
    session_id: int,
    user: dict = Depends(requires_voice_access),
):
    """Run the audit on a specific session on demand."""
    from api.services.voice_hallucination_audit import audit_session
    from api.services.voice_session_service import session_belongs_to_user
    if not session_belongs_to_user(session_id, user["id"]):
        raise HTTPException(status_code=403, detail="session not owned by user")
    return audit_session(session_id, user["id"])


@router.get("/cost")
def cost_summary(user: dict = Depends(requires_voice_access)):
    """Estimated voice cost for the current calendar month + projection."""
    from api.services.voice_cost_service import get_monthly_cost_summary
    return get_monthly_cost_summary(user["id"])


@router.get("/reward/scoreboard")
def reward_scoreboard(
    days: int = 30,
    user: dict = Depends(requires_voice_access),
):
    """Per-prompt-variant feedback aggregates over the last N days for this user."""
    from api.services.voice_reward_model import variant_scoreboard
    return {"days": days, "rows": variant_scoreboard(user["id"], days=max(1, min(365, int(days))))}


@router.get("/reward/variants")
def reward_variants(
    context: str = "global",
    user: dict = Depends(requires_voice_access),
):
    """List the prompt variants available for a context + their descriptions."""
    from api.services.voice_prompt_registry import list_variants
    return {"context": context, "variants": list_variants(context)}


@router.get("/sessions")
def sessions_list(
    limit: int = 50,
    user: dict = Depends(requires_voice_access),
):
    """Recent Mode C sessions for the user, newest-first, with summary stats."""
    from api.services.voice_trace_service import list_recent_sessions
    return {"sessions": list_recent_sessions(user["id"], limit=max(1, min(200, int(limit))))}


@router.get("/sessions/{session_id}/trace")
def session_trace(
    session_id: int,
    user: dict = Depends(requires_voice_access),
):
    """Full turn-by-turn trace for one session — metadata, variant,
    transcripts, tool calls, feedback, scratchpad."""
    from api.services.voice_trace_service import get_trace
    trace = get_trace(session_id, user["id"])
    if not trace:
        raise HTTPException(status_code=404, detail="session not found")
    return trace


class ExplainRequest(BaseModel):
    session_id: int
    turn_text: str | None = None


@router.post("/explain")
@limiter.limit("30/minute")
def explain(
    request: Request,
    body: ExplainRequest,
    user: dict = Depends(requires_voice_access),
):
    """Structured 'why did you say that' for a specific session/turn.
    Returns the variant in use, tools called before the response,
    user facts + corrections in play."""
    from api.services.voice_explainability import explain_turn
    return explain_turn(
        user_id=user["id"],
        session_id=int(body.session_id),
        turn_text=body.turn_text,
    )


@router.get("/agents/stats")
def agents_stats(
    days: int = 30,
    user: dict = Depends(requires_voice_access),
):
    """Per-agent session aggregates over the last N days. Includes
    trade_refusals on the risk_officer row."""
    from api.services.voice_session_service import get_agent_stats
    return {"days": days, "rows": get_agent_stats(user["id"], days=max(1, min(365, int(days))))}


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


# ── Mode D: pure dictation (Whisper STT, no intent, no TTS) ────────────────
# Used by VoiceInputButton across journal text fields. Returns just the
# transcribed text so the frontend can drop it into a textarea — the user
# remains in control of editing + submitting.

@router.post("/transcribe")
@limiter.limit("60/minute")
def transcribe(
    request: Request,
    audio: UploadFile = File(...),
    cleanup: bool = Form(False),
    user: dict = Depends(requires_voice_access),
):
    audio_bytes = audio.file.read() if audio else b""
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="audio is empty")

    settings = get_voice_settings(user["id"])
    if not settings.get("enabled", True):
        raise HTTPException(status_code=400, detail="voice features disabled in settings")

    is_admin = user.get("role") == "admin"
    if not is_within_mode_d_cap(user["id"], is_admin=is_admin):
        raise HTTPException(status_code=429, detail="monthly dictation cap reached")

    try:
        from api.services.voice_openai import _get_client
        _get_client()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    try:
        text = transcribe_audio(audio_bytes, filename=audio.filename or "audio.webm")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        _log.exception("Whisper failed in /transcribe")
        raise HTTPException(status_code=502, detail=f"Transcription failed: {e}")

    # Optional gpt-4o-mini cleanup pass — strips fillers, fixes ticker
    # mishears, adds punctuation. Best-effort: cleanup_transcript returns the
    # original text on any error, so this can never lose the dictation.
    if cleanup:
        text = cleanup_transcript(text)

    # Estimate seconds from audio bytes as a rough usage signal. WebM Opus at
    # mono 16k ≈ 4 KB/s, so bytes/4096 ≈ seconds. Clamp to [1, 600].
    est_seconds = max(1, min(600, len(audio_bytes) // 4096))
    record_mode_d_seconds(user["id"], est_seconds)

    return {"text": text, "seconds_billed": est_seconds}


# ── Slice 4: Realtime (Mode C) ─────────────────────────────────────────────

class SessionTokenRequest(BaseModel):
    context: str = "global"
    # P4-B unification: what is the user looking at right now? Pathname or
    # a richer hint like "chart of NVDA, daily timeframe". Injected into
    # Compass's system prompt so it can answer in-page questions without
    # the user having to spell out context.
    page_hint: str | None = None


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

    # Phase 1 of Compass × Voice unification (2026-05-12): when no specialist
    # is explicitly named, default to the unified Compass agent. Specialist
    # IDs (analyst/risk_officer/coach/scout/orchestrator) and special
    # contexts (train_me) still pass through unchanged for the eval shadow.
    _SPECIALIST_CTXS = {"analyst", "risk_officer", "coach", "scout",
                        "orchestrator", "train_me", "compass"}
    if ctx not in _SPECIALIST_CTXS:
        ctx = "compass"

    tools_schema = get_schema_for_context(ctx)
    _log.info("[session_token] +%.0fms %d tools loaded (ctx=%s)",
              (_time.time() - _t0) * 1000, len(tools_schema), ctx)

    # Phase 2-A unification: pull the unified Compass × Voice memory view
    # (voice facts + Compass trader_profile markdown). Falls back to the
    # voice-only build_memory_context on any error so this is safe.
    try:
        from api.services.trader_memory import build_unified_memory_context
        unified = build_unified_memory_context(uid)
        memory_context = unified if unified else build_memory_context(uid)
    except Exception as e:
        _log.warning("[session_token] unified memory failed, falling back: %s", e)
        memory_context = build_memory_context(uid)
    _log.info("[session_token] +%.0fms memory context %d chars",
              (_time.time() - _t0) * 1000, len(memory_context))

    # Resolve agent if ctx names one of the specialists (Batch 10a) or
    # the unified Compass (Phase 1 of unification, 2026-05-12).
    agent_def = None
    try:
        from api.services.voice_agents import get_agent
        agent_def = get_agent(ctx)
    except Exception:
        agent_def = None

    if ctx == "train_me":
        base_instructions = _TRAIN_ME_INSTRUCTIONS
    elif agent_def:
        base_instructions = agent_def["system_prompt"]
    else:
        base_instructions = _REALTIME_INSTRUCTIONS

    # Batch 13b: choose a prompt variant via epsilon-greedy and append its
    # suffix. The variant_id flows into voice_prompt_variants below.
    chosen_variant = "v1"
    try:
        from api.services.voice_prompt_registry import (
            select_variant, get_prompt_suffix,
        )
        chosen_variant = select_variant(ctx, user_id=uid)
        suffix = get_prompt_suffix(ctx, chosen_variant)
        if suffix:
            base_instructions = base_instructions + suffix
    except Exception as e:
        _log.warning("[session_token] variant selection failed: %s", e)

    # Inject current market regime (Batch 9b). Skipped for train_me since
    # that context shouldn't reason about market state.
    regime_line = ""
    temporal_line = ""
    if ctx != "train_me":
        try:
            from api.services.voice_regime_classifier import build_regime_prompt_line
            regime_line = build_regime_prompt_line()
        except Exception as e:
            _log.warning("[session_token] regime injection failed: %s", e)
        try:
            from api.services.voice_temporal_awareness import build_temporal_prompt_line
            temporal_line = build_temporal_prompt_line(uid)
        except Exception as e:
            _log.warning("[session_token] temporal injection failed: %s", e)

    # Pull pending proactive insights (Batch 11a) — gets injected and marked
    # delivered so the assistant surfaces them at session start.
    insight_lines = []
    if ctx != "train_me":
        try:
            from api.services.voice_proactive_service import (
                list_pending_insights, mark_delivered,
            )
            insights = list_pending_insights(uid, limit=5)
            if insights:
                for i in insights:
                    sym = (i.get("symbol") or "").upper()
                    prefix = f"[{i.get('kind')}{(' ' + sym) if sym else ''}]"
                    insight_lines.append(
                        f"  - {prefix} {i.get('headline')}"
                        + (f" — {i.get('body')}" if i.get('body') else '')
                    )
                mark_delivered([i["id"] for i in insights])
        except Exception as e:
            _log.warning("[session_token] proactive insight inject failed: %s", e)

    # Batch 13f: confidence calibration block — rules + per-session caveats
    confidence_block = ""
    if ctx != "train_me":
        try:
            from api.services.voice_confidence_calibration import build_confidence_block
            confidence_block = build_confidence_block(uid)
        except Exception as e:
            _log.warning("[session_token] confidence block failed: %s", e)

    # P8: active learning — surface knowledge gaps so the model can
    # naturally ask about them when an opening appears
    gap_block = ""
    if ctx != "train_me":
        try:
            from api.services.voice_active_learning import build_gap_prompt_line
            gap_block = build_gap_prompt_line(uid)
        except Exception as e:
            _log.warning("[session_token] gap block failed: %s", e)

    # P4-B unification: page-aware context. Tell Compass exactly what the
    # user is looking at right now so it can answer in-page questions
    # without the user spelling out context.
    page_hint_block = ""
    raw_hint = (body.page_hint or "").strip()[:500]
    if raw_hint and ctx != "train_me":
        # Translate a raw pathname into a friendly description if it looks
        # like a URL path; otherwise treat the hint as already-friendly text.
        page_hint_block = _describe_page_hint(raw_hint)

    session_instructions = base_instructions
    if page_hint_block:
        session_instructions = session_instructions + "\n\n" + page_hint_block
    if temporal_line:
        session_instructions = session_instructions + "\n\n" + temporal_line
    if regime_line:
        session_instructions = session_instructions + "\n\n" + regime_line
    if confidence_block:
        session_instructions = session_instructions + "\n\n" + confidence_block
    if gap_block:
        session_instructions = session_instructions + "\n\n" + gap_block
    if insight_lines:
        session_instructions = session_instructions + (
            "\n\n=== PROACTIVE INSIGHTS FOR THIS SESSION ===\n"
            "Surface these briefly at the start of the conversation IF "
            "relevant. Don't force them if the user opens with a specific "
            "question.\n" + "\n".join(insight_lines)
            + "\n=== END INSIGHTS ==="
        )
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
                voice=(agent_def["voice"] if agent_def else settings["voice"]),
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
    # Batch 13a/13b: tag the session with the prompt variant in use.
    # chosen_variant was set above by the prompt registry.
    try:
        from api.services.voice_reward_model import record_variant
        record_variant(sess_db_id, uid, variant_id=chosen_variant, agent_ctx=ctx)
    except Exception as e:
        _log.warning("[session_token] variant record failed: %s", e)

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
    # Schedule hallucination audit (P7) — non-blocking
    background_tasks.add_task(_audit_session_background, body.session_id, user["id"])
    # Phase 2-B unification: bridge voice session into Compass chat thread
    # so the Compass tab sees what was said in voice. Non-blocking.
    background_tasks.add_task(_bridge_session_to_compass_thread,
                              body.session_id, user["id"])

    return {"ok": True, "duration_seconds": duration}


# ── P4-B helper: friendly page-hint descriptions ───────────────────────────

_PAGE_DESCRIPTIONS: dict[str, str] = {
    "/dashboard": "the main Dashboard (bento-box overview).",
    "/morning-wire": "the Morning Wire — today's pre-market briefing.",
    "/uct20": "the UCT 20 leadership list.",
    "/breadth": "the Breadth Monitor (market internals).",
    "/theme-tracker": "the Theme Tracker (sector + theme performance).",
    "/calendar": "the Calendar (earnings + macro events).",
    "/traders": "the Traders feed.",
    "/screener": "the Scanner Hub (pullback / remount / gappers).",
    "/options-flow": "Options Flow.",
    "/post-market": "the Post-Market movers page.",
    "/model-book": "the Model Book (graded chart examples + setup taxonomy).",
    "/journal": "the trader's Journal (Journal 2.0 / Compass coaching surface).",
    "/watchlists": "the Watchlists page.",
    "/settings": "the Settings page.",
    "/support": "the Support page.",
}


def _describe_page_hint(raw: str) -> str:
    """Translate a route hint into a friendly natural-language block for
    Compass's system prompt.

    Accepts either a raw pathname (e.g. "/journal", "/screener?type=remount")
    OR an already-friendly free-text hint (e.g. "chart of NVDA, daily").
    Returns a block formatted like:

        === CURRENT PAGE ===
        The user is on the trader's Journal right now.
        === END CURRENT PAGE ===

    Empty string if no useful hint can be derived.
    """
    hint = (raw or "").strip()
    if not hint:
        return ""

    # If it looks like a URL path, try to map it.
    desc = None
    if hint.startswith("/"):
        # Strip query string, then take the first 2 segments for sub-routes
        path = hint.split("?", 1)[0].split("#", 1)[0].rstrip("/") or "/"
        # Exact match
        if path in _PAGE_DESCRIPTIONS:
            desc = _PAGE_DESCRIPTIONS[path]
        else:
            # Two-segment fallback (e.g. /journal/foo → /journal)
            parts = [p for p in path.split("/") if p]
            if parts:
                root = "/" + parts[0]
                if root in _PAGE_DESCRIPTIONS:
                    desc = _PAGE_DESCRIPTIONS[root]
        if not desc:
            desc = f"a page at {path}."
    else:
        # Treat as already-friendly free text. Just use it verbatim.
        desc = hint if hint.endswith(".") else hint + "."

    return (
        "=== CURRENT PAGE ===\n"
        f"The user is on {desc} "
        "If their question is ambiguous, lean on this context — they "
        "probably mean something on this page.\n"
        "=== END CURRENT PAGE ==="
    )


def _audit_session_background(session_id: int, user_id: str) -> None:
    """Run hallucination audit after session end. Best-effort."""
    try:
        from api.services.voice_hallucination_audit import audit_session
        result = audit_session(session_id, user_id)
        if result["suspect_count"] > 0:
            _log.info("[hallucination_audit] session=%s flagged=%d",
                       session_id, result["suspect_count"])
    except Exception as e:  # noqa: BLE001
        _log.warning("hallucination audit failed for %s: %s", session_id, e)


def _bridge_session_to_compass_thread(session_id: int, user_id: str) -> None:
    """Phase 2-B unification: after a voice session ends, post a Compass-
    authored summary message into the user's Compass chat thread.

    This makes the Compass tab show voice conversations alongside text
    chat — both feed one continuous thread per the unification spec.
    Best-effort; never raises.
    """
    try:
        transcripts = _get_session_transcripts(session_id) or []
        # Only bridge real conversations (user spoke + Compass replied)
        roles = {t.get("role") for t in transcripts}
        if "user" not in roles or "assistant" not in roles:
            return

        # Build a compact summary: first user turn + last assistant turn.
        user_turns = [t for t in transcripts if t.get("role") == "user"]
        asst_turns = [t for t in transcripts if t.get("role") == "assistant"]
        if not user_turns or not asst_turns:
            return
        opener = (user_turns[0].get("text") or "")[:300]
        closer = (asst_turns[-1].get("text") or "")[:600]
        turn_count = len(user_turns) + len(asst_turns)

        body = (
            f"🎙️ Voice session — {turn_count} turn{'s' if turn_count != 1 else ''}.\n\n"
            f"**You opened:** {opener.strip()}\n\n"
            f"**Compass closed:** {closer.strip()}"
        )

        from api.services.trader_memory import get_default_account_id
        from api.services.journal_two.coach_chat import append_message
        account_id = get_default_account_id(user_id)
        if not account_id:
            return
        append_message(
            user_id=user_id,
            account_id=account_id,
            role="assistant",
            content=body,
            metadata={"source": "voice_session", "session_id": session_id,
                      "turn_count": turn_count, "bridge_version": 1},
        )
    except Exception as e:  # noqa: BLE001
        _log.warning("voice→compass thread bridge failed for %s: %s",
                     session_id, e)


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
