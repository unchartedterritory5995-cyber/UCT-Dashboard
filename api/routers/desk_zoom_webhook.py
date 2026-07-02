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
