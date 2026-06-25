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
    for f in (obj.get("recording_files") or []):
        if (f.get("file_type") or "").upper() == "MP4" and f.get("download_url"):
            return f["download_url"]
    return None

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
        if uuid and url:
            try:
                desk_session_jobs.enqueue(
                    uuid, obj.get("topic", ""), obj.get("start_time", ""),
                    url, payload.get("download_token", ""))
            except Exception:
                pass  # never fail the webhook; processor/safety-net recovers
        return {"ok": True}
    return {"ignored": event}
