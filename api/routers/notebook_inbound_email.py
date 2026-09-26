"""Wave 7 lane G (G3) — email-in, under `/api/j2/inbound-email`.

  * `POST /api/j2/inbound-email` — the Cloudflare Email Worker's door. NO
    session and NO bearer: the only credential is the HMAC signature
    (`inbound_email.verify_signature`). A bad or missing signature is a bare
    401 with no body at all. A good one is always answered 202
    `{"accepted": true}` — whether a note was made or the address named nobody
    (accept-and-drop), so the answer is never an oracle for which addresses
    exist.
  * `GET  /api/j2/inbound-email/address` — the member's address, or
    `{"address": null}` until they make one: it NEVER mints (whole-branch
    review M-10). `POST` the same path creates the address the first time and
    rotates it after that (the old one retires at once). Session + a paid plan.

⛔ DARK: `NOTEBOOK_INBOUND_EMAIL_ENABLED` unset means every route here answers
404 with FastAPI's own unknown-route body — before the signature is read, before
any address is minted. Read per request.
"""
from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.journal_two import inbound_email

logger = logging.getLogger(__name__)

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


async def _read_capped(request: Request) -> bytes | None:
    """The request body, or None once it passes `MAX_BODY_BYTES`.

    ⛔ THE CAP LIMITS WHAT IS BUFFERED, NOT ONLY WHAT IS PARSED (fix round 1,
    M-3). A declared `Content-Length` over the cap is refused before a byte is
    read; without one, the stream is read with a running total and abandoned
    the moment it passes the cap. ⚰️ It was `await request.body()` and then a
    length check -- the whole unauthenticated body in memory first. Cloudflare
    caps it at the edge; nothing did through the `*.railway.app` origin."""
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            if int(declared) > MAX_BODY_BYTES:
                return None
        except ValueError:
            return None
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_BODY_BYTES:
            return None
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("")
async def receive_email(request: Request) -> Response:
    raw = await _read_capped(request)
    if raw is None:
        return Response(status_code=413)
    timestamp = request.headers.get("x-uct-timestamp")
    signature = request.headers.get("x-uct-signature")
    # ONE clock read per request (backend re-review N2): the signature is
    # verified AND its delivery claimed at this instant, however long the body
    # below takes to parse -- a replay that verified is judged by the same
    # clock that verified it.
    now = time.time()
    ok = inbound_email.verify_signature(
        os.environ.get(inbound_email.SECRET_ENV), timestamp, signature, raw, now=now)
    if not ok:
        # ⛔ NO BODY. Not "bad signature", not "expired": a caller without the
        # secret learns nothing about which check it failed.
        return Response(status_code=401)
    # ⛔ The parse runs in the threadpool, never on the event loop (ruling
    # D-H12): a signed body may be up to MAX_BODY_BYTES (~34 MB), and the web
    # pod has one loop for every member. The clock was read ABOVE, before the
    # parse, so however long it takes the claim below is judged at `now` (N2).
    try:
        payload = await run_in_threadpool(json.loads, raw)
    except ValueError:
        return Response(status_code=400)
    if not isinstance(payload, dict):
        return Response(status_code=400)
    # ⛔ ONE DELIVERY PER SIGNATURE (whole-branch review M-6): a replay of a
    # captured request is answered exactly like a delivery and makes nothing --
    # no note, and no charge against the address's hourly allowance.
    if not await run_in_threadpool(inbound_email.claim_delivery, signature, timestamp, now=now):
        logger.warning("[inbound-email] a replayed signed request was dropped")
        return JSONResponse({"accepted": True}, status_code=202)
    # Whatever `ingest` decides -- a note, an unknown address, a lapsed plan, a
    # limit reached -- the worker is told the same thing.
    await run_in_threadpool(inbound_email.ingest, payload, size=len(raw))
    return JSONResponse({"accepted": True}, status_code=202)


@router.get("/address")
def get_address(user: dict = Depends(require_paid)) -> dict[str, Any]:
    """`{"address": null}` until the member makes one; ⛔ never mints (review
    M-10: the Settings card reads this on mount, so a minting GET handed every
    paid member who opened Settings a live address they never asked for)."""
    return inbound_email.get_address(user["id"]) or {"address": None}


@router.post("/address")
def create_or_rotate_address(user: dict = Depends(require_paid)) -> dict[str, Any]:
    """The member's own act: the first POST creates the address, every later
    one rotates it (the old one stops working at once). `{"address": ...}`."""
    return inbound_email.rotate(user["id"])
