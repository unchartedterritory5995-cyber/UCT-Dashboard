"""Wave 7 lane G (G3) — email-in, under `/api/j2/inbound-email`.

  * `POST /api/j2/inbound-email` — the Cloudflare Email Worker's door. NO
    session and NO bearer: the only credential is the HMAC signature
    (`inbound_email.verify_signature`). A bad or missing signature is a bare
    401 with no body at all. A good one is always answered 202
    `{"accepted": true}` — whether a note was made or the address named nobody
    (accept-and-drop), so the answer is never an oracle for which addresses
    exist.
  * `GET  /api/j2/inbound-email/address` — the member's address (minted on first
    ask); `POST` the same path makes a new one and retires the old one at once.
    Session + a paid plan.

⛔ DARK: `NOTEBOOK_INBOUND_EMAIL_ENABLED` unset means every route here answers
404 with FastAPI's own unknown-route body — before the signature is read, before
any address is minted. Read per request.
"""
from __future__ import annotations

import json
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.journal_two import inbound_email

NOT_FOUND = "Not Found"   # byte-identical to FastAPI's unknown-route body
# Cloudflare Email Routing accepts messages up to 25 MiB; base64 inflates the
# attachments by 4/3 and the JSON adds a little. Past this the worker's body is
# refused before it is parsed.
MAX_BODY_BYTES = 36 * 1024 * 1024


def _require_enabled() -> None:
    if not inbound_email.inbound_email_enabled():
        raise HTTPException(status_code=404, detail=NOT_FOUND)


router = APIRouter(
    prefix="/api/j2/inbound-email",
    tags=["journal-2-0", "inbound-email"],
    dependencies=[Depends(_require_enabled)],
)


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, per router, with its own sentence (the house rule railed by
    tests/test_user_definitions_auth.py)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402,
                            detail="Email to Notebook requires a paid plan")
    return user


@router.post("")
async def receive_email(request: Request) -> Response:
    raw = await request.body()
    if len(raw) > MAX_BODY_BYTES:
        return Response(status_code=413)
    ok = inbound_email.verify_signature(
        os.environ.get(inbound_email.SECRET_ENV),
        request.headers.get("x-uct-timestamp"),
        request.headers.get("x-uct-signature"),
        raw,
    )
    if not ok:
        # ⛔ NO BODY. Not "bad signature", not "expired": a caller without the
        # secret learns nothing about which check it failed.
        return Response(status_code=401)
    try:
        payload = json.loads(raw)
    except ValueError:
        return Response(status_code=400)
    if not isinstance(payload, dict):
        return Response(status_code=400)
    await run_in_threadpool(inbound_email.ingest, payload)
    return JSONResponse({"accepted": True}, status_code=202)


@router.get("/address")
def get_address(user: dict = Depends(require_paid)) -> dict[str, Any]:
    return inbound_email.get_or_create_address(user["id"])


@router.post("/address")
def rotate_address(user: dict = Depends(require_paid)) -> dict[str, Any]:
    return inbound_email.rotate(user["id"])
