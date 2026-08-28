"""Zoom webhook receiver for The Desk Daily Sessions.
Validates Zoom's HMAC signature + URL-validation challenge, and on
recording.completed enqueues a job. Thin: validate + enqueue + 200. The
heavy download/upload happens in a scheduled processor, never here."""
from __future__ import annotations
import hashlib, hmac, os
from fastapi import APIRouter, Request, Response
from api.services import desk_session_jobs

router = APIRouter(prefix="/api/desk", tags=["desk-daily-sessions"])

def _secret() -> str:
    return os.environ.get("ZOOM_WEBHOOK_SECRET_TOKEN", "")

def _validation_response(plain_token: str, secret: str) -> dict:
    enc = hmac.new(secret.encode(), plain_token.encode(), hashlib.sha256).hexdigest()
    return {"plainToken": plain_token, "encryptedToken": enc}

def _verify_signature(secret: str, timestamp: str, raw_body: str, signature: str) -> bool:
    if not (secret and timestamp and signature):
        return False
    msg = f"v0:{timestamp}:{raw_body}".encode()
    expected = "v0=" + hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)

def _first_mp4_url(obj: dict) -> str | None:
    # Largest MP4 wins: a stop/restart mid-webinar yields multiple MP4 segments,
    # and the tiny first clip must not shadow the real recording. Files without
    # a file_size rank lowest, so an all-sizeless payload keeps first-MP4 order.
    mp4s = [f for f in (obj.get("recording_files") or [])
            if (f.get("file_type") or "").upper() == "MP4" and f.get("download_url")]
    if not mp4s:
        return None
    return max(mp4s, key=lambda f: f.get("file_size") or 0)["download_url"]

@router.post("/zoom-webhook")
async def zoom_webhook(request: Request):
    raw = (await request.body()).decode("utf-8")
    secret = _secret()
    ts = request.headers.get("x-zm-request-timestamp", "")
    sig = request.headers.get("x-zm-signature", "")
    if not _verify_signature(secret, ts, raw, sig):
        return Response(status_code=401)
    import json as _json
    try:
        data = _json.loads(raw) if raw else {}
    except ValueError:
        return Response(status_code=400)
    event = data.get("event")
    if event == "endpoint.url_validation":
        plain = (data.get("payload") or {}).get("plainToken", "")
        return _validation_response(plain, secret)
    if event == "recording.completed":
        payload = data.get("payload") or {}
        obj = payload.get("object") or {}
        uuid = obj.get("uuid")
        url = _first_mp4_url(obj)
        # Zoom puts download_token at the TOP LEVEL of the event body (sibling of
        # `payload`), NOT inside payload. Read top-level first, fall back for safety.
        dtoken = data.get("download_token") or payload.get("download_token") or ""
        if uuid and url:
            try:
                desk_session_jobs.enqueue(
                    uuid, obj.get("topic", ""), obj.get("start_time", ""),
                    url, dtoken)
            except Exception:
                pass  # never fail the webhook; processor/safety-net recovers
        return {"ok": True}
    return {"ignored": event}

@router.get("/sessions-status")
async def sessions_status(request: Request):
    """Diagnostics: recent recording jobs (status/error/youtube_id). Gated by
    the PUSH_SECRET bearer so it can be curled without a browser session."""
    expected = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("authorization", "")
    if not expected or auth != f"Bearer {expected}":
        return Response(status_code=401)
    return {"jobs": desk_session_jobs.list_recent(20)}


@router.post("/creative-cover-backfill")
def creative_cover_backfill_start(request: Request, limit: int | None = None):
    """Fire the back-catalog creative-cover sweep as ONE background daemon
    (each cover = an LLM call + an image render — far past the request
    budget). Idempotent/resumable via the volume ledger; re-POST after a
    redeploy to resume. Gated by the PUSH_SECRET bearer like sessions-status."""
    expected = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("authorization", "")
    if not expected or auth != f"Bearer {expected}":
        return Response(status_code=401)
    from api.services import desk_cover_backfill
    started = desk_cover_backfill.start_background(limit=limit)
    return {"started": started, **desk_cover_backfill.status()}


@router.get("/creative-cover-backfill")
def creative_cover_backfill_status(request: Request):
    """Sweep progress: ledger counts + how many eligible videos remain.
    Gated by the PUSH_SECRET bearer like sessions-status."""
    expected = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("authorization", "")
    if not expected or auth != f"Bearer {expected}":
        return Response(status_code=401)
    from api.services import desk_cover_backfill
    return desk_cover_backfill.status()


@router.post("/description-backfill")
def description_backfill_start(request: Request, limit: int | None = None):
    """Fire the back-catalog YouTube-description sweep as ONE background
    daemon. Idempotent/resumable via the volume ledger; re-POST after a
    redeploy to resume. Gated by the PUSH_SECRET bearer like sessions-status."""
    expected = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("authorization", "")
    if not expected or auth != f"Bearer {expected}":
        return Response(status_code=401)
    from api.services import desk_description_backfill
    started = desk_description_backfill.start_background(limit=limit)
    return {"started": started, **desk_description_backfill.status()}


@router.get("/description-backfill")
def description_backfill_status(request: Request):
    """Sweep progress: ledger counts + how many eligible videos remain.
    Gated by the PUSH_SECRET bearer like sessions-status."""
    expected = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("authorization", "")
    if not expected or auth != f"Bearer {expected}":
        return Response(status_code=401)
    from api.services import desk_description_backfill
    return desk_description_backfill.status()


@router.post("/creative-cover-retry")
async def creative_cover_retry_enqueue(request: Request):
    """Queue a published session for a creative-cover attempt (the publish
    path queues its own misses; this is the owner's hand on the lever).
    Body: {"youtube_id": "...", "drain": true} — drain kicks one background
    pass now instead of waiting for the 15-min job. Gated by the PUSH_SECRET
    bearer like sessions-status."""
    from fastapi.responses import JSONResponse
    expected = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("authorization", "")
    if not expected or auth != f"Bearer {expected}":
        return Response(status_code=401)
    import json as _json
    try:
        body = _json.loads((await request.body()).decode("utf-8") or "{}")
    except ValueError:
        return JSONResponse({"error": "invalid JSON body"}, status_code=400)
    from api.services import desk_cover_retry
    out = desk_cover_retry.enqueue_from_library(str(body.get("youtube_id") or ""))
    if out.get("error"):
        code = 404 if out["error"].startswith("no video") else 400
        return JSONResponse(out, status_code=code)
    if body.get("drain"):
        out["drain_started"] = desk_cover_retry.start_background_drain()
    return {**out, **desk_cover_retry.status()}


@router.get("/creative-cover-retry")
def creative_cover_retry_status(request: Request):
    """The retry queue: pending videos, attempts, next due. Gated by the
    PUSH_SECRET bearer like sessions-status."""
    expected = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("authorization", "")
    if not expected or auth != f"Bearer {expected}":
        return Response(status_code=401)
    from api.services import desk_cover_retry
    return desk_cover_retry.status()


@router.post("/session-requeue")
async def session_requeue(request: Request):
    """Recovery: put a terminal (skipped/error) recording job back in the queue,
    optionally correcting its topic. Exists because mark_skipped is terminal by
    design — a real session recorded in a webinar named "TEST" (the dry-run
    guard's pattern) has no other path back to publishing. Body:
    {"meeting_uuid": "...", "topic": "Evening Update"} — topic optional.
    Gated by the PUSH_SECRET bearer like sessions-status."""
    from fastapi.responses import JSONResponse
    expected = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("authorization", "")
    if not expected or auth != f"Bearer {expected}":
        return Response(status_code=401)
    import json as _json
    try:
        body = _json.loads((await request.body()).decode("utf-8") or "{}")
    except ValueError:
        return JSONResponse({"error": "invalid JSON body"}, status_code=400)
    uuid = (body.get("meeting_uuid") or "").strip()
    if not uuid:
        return JSONResponse({"error": "meeting_uuid required"}, status_code=400)
    topic = body.get("topic")
    current = desk_session_jobs.get_job(uuid)
    if current is None:
        return JSONResponse({"error": "no job with that meeting_uuid"}, status_code=404)
    # The skip decision belongs to desk_daily_session — consult it, never copy
    # its pattern here. Requeueing a topic the processor will immediately
    # re-skip is a silent no-op loop; refuse it with the reason instead.
    from api.services.desk_daily_session import _is_test_recording
    effective_topic = topic if topic is not None else current.get("topic")
    if _is_test_recording(effective_topic):
        return JSONResponse(
            {"error": f"topic {effective_topic!r} still matches the test-recording "
                      f"skip rule; pass a corrected topic"}, status_code=400)
    row = desk_session_jobs.requeue(uuid, topic)
    if row is None:
        return JSONResponse(
            {"error": f"job status is {current.get('status')!r} — only skipped/error "
                      f"jobs can be requeued"}, status_code=409)
    return {"requeued": True, "job": {k: row.get(k) for k in
                                      ("meeting_uuid", "topic", "start_time", "status")}}


@router.post("/session-cancel")
async def session_cancel(request: Request):
    """Stop a recording that has NOT published yet — the owner re-recorded and
    only the later take should go out. Flips a pending/error job to terminal
    'skipped'. The mirror of /session-requeue, and the reason it must exist:
    publishing is ONE-WAY (our YouTube token has upload scope only, so
    videos.update/delete both 403), and every show now uploads PUBLIC, so a bad
    take that reaches the processor cannot be recalled by us at all. Body:
    {"meeting_uuid": "...", "reason": "..."} — reason optional.
    Gated by the PUSH_SECRET bearer like sessions-status."""
    from fastapi.responses import JSONResponse
    expected = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("authorization", "")
    if not expected or auth != f"Bearer {expected}":
        return Response(status_code=401)
    import json as _json
    try:
        body = _json.loads((await request.body()).decode("utf-8") or "{}")
    except ValueError:
        return JSONResponse({"error": "invalid JSON body"}, status_code=400)
    uuid = (body.get("meeting_uuid") or "").strip()
    if not uuid:
        return JSONResponse({"error": "meeting_uuid required"}, status_code=400)
    reason = (body.get("reason") or "cancelled by operator").strip()
    current = desk_session_jobs.get_job(uuid)
    if current is None:
        return JSONResponse({"error": "no job with that meeting_uuid"}, status_code=404)
    row = desk_session_jobs.cancel(uuid, reason)
    if row is None:
        status = current.get("status")
        # A 'done' job is already public and we cannot delete it — say so with the
        # id rather than a bare status, so the operator knows what to go fix by hand.
        extra = (f" — already published as youtube_id {current.get('youtube_id')!r}, "
                 f"which only YouTube Studio can remove") if status == "done" else ""
        return JSONResponse(
            {"error": f"job status is {status!r} — only pending/error jobs can be "
                      f"cancelled{extra}"}, status_code=409)
    return {"cancelled": True, "job": {k: row.get(k) for k in
                                       ("meeting_uuid", "topic", "start_time",
                                        "status", "error")}}


@router.get("/session-audit")
def session_audit(request: Request):
    """Did everything land? Re-reads the ARTIFACTS for every published session
    past its grace window — YouTube id, transcript, chapters, ticker moments and
    (for opted-in shows) the community announcement — and names whatever is
    missing. This is the read path behind the daily alert; curl it any time to
    answer "is the pipeline healthy" without checking five endpoints by hand.
    PUSH_SECRET bearer, mirroring /sessions-status."""
    expected = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("authorization", "")
    if not expected or auth != f"Bearer {expected}":
        return Response(status_code=401)
    from api.services import desk_session_audit
    return desk_session_audit.audit_sessions()


def _recent_session_video_summaries(limit: int = 8) -> list[dict]:
    """Last `limit` session videos (have a meeting_uuid), newest first, with
    just enough shape to eyeball insights health: id/title/insights_at/
    zoom_cleaned + chapter/ticker COUNTS (the JSON columns parsed
    defensively — a corrupt/legacy row must never break this diagnostic)."""
    from api.services import education_service
    import json as _json

    def _count(v: dict, field: str) -> int:
        try:
            arr = _json.loads(v.get(field) or "[]")
            return len(arr) if isinstance(arr, list) else 0
        except Exception:
            return 0

    try:
        videos = education_service.list_videos()
    except Exception:
        return []
    with_uuid = [v for v in videos if (v.get("meeting_uuid") or "").strip()]
    with_uuid.sort(key=lambda v: v.get("id") or 0, reverse=True)
    return [{
        "id": v.get("id"),
        "title": v.get("title"),
        "insights_at": v.get("insights_at"),
        "zoom_cleaned": bool(v.get("zoom_cleaned")),
        "chapters": _count(v, "chapters"),
        "tickers": _count(v, "ticker_moments"),
    } for v in with_uuid[:limit]]


@router.post("/repolish/{video_id}")
def repolish(video_id: int, request: Request):
    """Admin backfill: re-run the recap polish (headline + takeaways + poster)
    for an already-published session video from its STORED insights/transcript
    — for videos published before the polish pass existed, whose stored text
    is Zoom's generic prose hard-truncated mid-sentence. PUSH_SECRET bearer,
    mirroring /sessions-status. Sync `def` on purpose: the LLM call blocks,
    so FastAPI must run this in the threadpool, never on the event loop."""
    expected = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("authorization", "")
    if not expected or auth != f"Bearer {expected}":
        return Response(status_code=401)
    from api.services import desk_session_insights
    try:
        return desk_session_insights.repolish_video(int(video_id))
    except Exception as e:
        return {"ok": False, "error": str(e)[:400]}


@router.post("/recap/{video_id}")
def post_discord_recap(video_id: int, request: Request):
    """Admin: generate + post the team Discord recap for a published session
    video from its STORED transcript/insights. Works with the scheduler flag
    off so the feature can be verified before enabling; re-invoking re-posts.
    PUSH_SECRET bearer, mirroring /repolish. Sync `def` on purpose: the LLM
    call blocks, so FastAPI must run this in the threadpool."""
    expected = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("authorization", "")
    if not expected or auth != f"Bearer {expected}":
        return Response(status_code=401)
    from api.services import desk_session_recap
    try:
        return desk_session_recap.post_recap_for_video(int(video_id))
    except Exception as e:
        return {"ok": False, "error": str(e)[:400]}


@router.post("/announce/{video_id}")
def post_community_announce(video_id: int, request: Request):
    """Admin: post (or re-post) the TSDR community announcement for a published
    video, and fold in the brief recap if insights already exist. Works with the
    scheduler flag off so the feature can be proven end-to-end before arming it,
    and is the manual fallback when a publish lands outside a deploy window.

    `?force=1` bypasses BOTH the show allowlist and the already-posted guard —
    it is the only way to announce a non-allowlisted show, deliberately manual.
    PUSH_SECRET bearer, mirroring /recap. Sync `def` on purpose: the render +
    upload block, so FastAPI must run this in the threadpool."""
    expected = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("authorization", "")
    if not expected or auth != f"Bearer {expected}":
        return Response(status_code=401)
    from api.services import desk_session_announce
    force = request.query_params.get("force", "") in ("1", "true", "yes")
    try:
        out = desk_session_announce.announce_video(int(video_id), force=force)
        if out.get("ok") and not out.get("already"):
            try:
                out["recap"] = desk_session_announce.attach_recap(int(video_id))
            except Exception as re_:
                out["recap"] = {"ok": False, "error": str(re_)[:200]}
        return out
    except Exception as e:
        return {"ok": False, "error": str(e)[:400]}


@router.get("/recap-pending")
def recap_pending(request: Request):
    """Read-only source list for the terminal/subscription daily-recap job:
    recent Live Trading Sessions carrying a transcript. NO LLM — pure DB read.
    PUSH_SECRET bearer. `days`/`category` query-overridable."""
    expected = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("authorization", "")
    if not expected or auth != f"Bearer {expected}":
        return Response(status_code=401)
    from api.services import education_service
    days = int(request.query_params.get("days", "4") or 4)
    category = request.query_params.get(
        "category",
        os.environ.get("DESK_DAILY_SESSION_CATEGORY", "Live Trading Sessions"),
    )
    try:
        return {"sessions": education_service.list_recent_recap_candidates(category, days)}
    except Exception as e:
        return {"ok": False, "error": str(e)[:400]}


@router.get("/recap-source/{video_id}")
def recap_source(video_id: int, request: Request):
    """Everything the terminal recap job needs to WRITE a recap for one session:
    title, youtube_id, category, transcript, and pre-computed insights. NO LLM —
    pure DB read. PUSH_SECRET bearer."""
    expected = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("authorization", "")
    if not expected or auth != f"Bearer {expected}":
        return Response(status_code=401)
    from api.services import education_service
    v = education_service.get_video(int(video_id))
    if not v:
        return Response(status_code=404)
    ins = education_service.get_insights(int(video_id))
    return {
        "id": v.get("id"),
        "youtube_id": v.get("youtube_id") or "",
        "title": v.get("title") or "",
        "category": v.get("category") or "",
        "transcript": v.get("transcript") or "",
        "headline": ins.get("headline") or "",
        "summary": ins.get("summary") or [],
        "chapters": ins.get("chapters") or [],
        "setups": ins.get("setups") or [],
    }


@router.get("/insights-status")
async def insights_status(request: Request):
    """Diagnostics for the session-insights backfill pass: pending queue +
    recent pass results/errors + per-video fail streaks (all from
    `desk_session_insights.get_insights_status()`) plus the last 8 session
    videos' insight state. Gated by the PUSH_SECRET bearer, mirroring
    /sessions-status exactly."""
    expected = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("authorization", "")
    if not expected or auth != f"Bearer {expected}":
        return Response(status_code=401)
    from api.services import desk_session_insights
    data = desk_session_insights.get_insights_status()
    data["recent_videos"] = _recent_session_video_summaries()
    return data
