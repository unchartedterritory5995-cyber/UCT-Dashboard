"""TERM-086 (item 14 WF-B06) -- the inbound alert receiver's routes.

  * ``POST /api/inbound-alerts/hook/{token}`` -- TradingView's door. NO session
    and NO bearer: the per-member secret in the path is the only credential
    (``inbound_alerts.verify``). The ``Depends``-shaped auth audit cannot see a
    credential in a path, so this route is recorded in
    ``auth_surface_check.ALLOWED_OPEN`` with its reason, under an audited
    prefix, and ``tests/test_term086_inbound_alerts.py`` asserts the handler
    still calls ``verify`` -- the pairing that dict demands of every entry.
  * ``GET|POST|DELETE /api/inbound-alerts/receiver`` and
    ``POST /api/inbound-alerts/receiver/rotate`` -- the member's own token
    lifecycle, signed in. Minting and rotating take a paid plan; reading and
    revoking do NOT, so a member whose plan lapsed can still see and kill a
    live URL.
  * ``GET /api/admin/inbound-alerts`` -- received / refused / deduped /
    delivered counts since this process started (admin).

⛔ DARK: with ``INBOUND_ALERTS_ENABLED`` unset, every route here returns
``Match.NONE`` from routing itself (``DarkUnlessEnabledRoute``), so the request
is answered by whatever would answer it if this router were never mounted -- a
bare 404 in a checkout, the SPA catch-all's answer in a built one. That is the
only way "answers exactly like a nonexistent route" stays true in BOTH shapes;
a handler raising 404 would imitate the first and contradict the second.

⛔ THE 3-SECOND BUDGET: the hook does verify -> rate -> read (capped) -> parse
-> claim, then answers. Delivery runs afterwards on ``_POOL`` (two threads,
bounded by the per-token rate limit upstream of it).
"""
from __future__ import annotations

import logging
import os
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from starlette.concurrency import run_in_threadpool
from starlette.routing import Match

from api.limiter import limiter
from api.middleware.auth_middleware import (
    get_current_user, get_current_user_with_plan, is_paid_user, require_admin,
)
from api.services import inbound_alerts as ia

logger = logging.getLogger(__name__)

HOOK_PREFIX = "/api/inbound-alerts/hook/"
HOOK_PATH = HOOK_PREFIX + "{token}"
RECEIVER_PATH = "/api/inbound-alerts/receiver"
ROTATE_PATH = RECEIVER_PATH + "/rotate"
STATUS_PATH = "/api/admin/inbound-alerts"

RATE_SCOPE = "inbound-alerts"

UNKNOWN_SENTENCE = ("Unknown receiver URL. Copy your receiver URL from UCT "
                    "Settings into the TradingView alert's webhook field.")
ROTATED_SENTENCE = ("This receiver URL was replaced by a newer one. Copy the new "
                    "URL from UCT Settings into the TradingView alert's webhook field.")
REVOKED_SENTENCE = ("This receiver URL was turned off. Create a new one in UCT "
                    "Settings to receive TradingView alerts again.")
RATE_SENTENCE = "Too many alerts on this receiver URL. Wait a minute and try again."
TOO_BIG_SENTENCE = (f"The alert message is larger than {ia.MAX_BODY_BYTES} bytes. "
                    "Shorten it.")
BUSY_SENTENCE = "The receiver is busy. TradingView will not retry; try again shortly."
ACTIVE_SENTENCE = ("You already have a receiver URL. Reset it to get a new one "
                   "(the old URL stops working at once).")

_REFUSALS = {
    ia.UNKNOWN: (401, UNKNOWN_SENTENCE, ia.REFUSED_UNKNOWN),
    ia.ROTATED: (403, ROTATED_SENTENCE, ia.REFUSED_ROTATED),
    ia.REVOKED: (403, REVOKED_SENTENCE, ia.REFUSED_REVOKED),
    ia.STORE_ERROR: (503, BUSY_SENTENCE, ia.STORE_FAILED),
}

#: A setup example the member pastes into TradingView's message box.
MESSAGE_EXAMPLE = ('{"ticker": "{{ticker}}", "price": {{close}}, '
                   '"time": "{{timenow}}", "message": "Crossed my level"}')


class DarkUnlessEnabledRoute(APIRoute):
    """A route that does not MATCH while ``INBOUND_ALERTS_ENABLED`` is off.

    The path is matched first and the flag read only on a hit, so the other
    ~1,400 routes of the app never pay an environment read for this feature.
    """

    def matches(self, scope):  # noqa: D401 -- Starlette's name
        match, child = super().matches(scope)
        if match is not Match.NONE and not ia.is_enabled():
            return Match.NONE, {}
        return match, child


router = APIRouter(route_class=DarkUnlessEnabledRoute, tags=["inbound-alerts"])


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Defined HERE, per router, with its own sentence (the house rule railed by
    tests/test_user_definitions_auth.py)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402,
                            detail="The TradingView alert receiver requires a paid plan")
    return user


# ── delivery after the answer ────────────────────────────────────────────────

_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="inbound-alert")


def _dispatch(fn, *args) -> None:
    """The seam tests replace with a synchronous call."""
    _POOL.submit(fn, *args)


# ── the hook ─────────────────────────────────────────────────────────────────

def _refuse(status: int, sentence: str, **headers: str) -> JSONResponse:
    return JSONResponse({"detail": sentence}, status_code=status, headers=headers or None)


def _rate_ok(token_hash: str) -> bool:
    if not limiter.enabled:
        return True
    from limits import parse
    return bool(limiter.limiter.hit(parse(ia.rate()), RATE_SCOPE,
                                    f"{RATE_SCOPE}:tok:{token_hash}"))


async def _read_capped(request: Request) -> bytes | None:
    """The body, or None once it passes ``MAX_BODY_BYTES`` -- a declared length
    over the cap is refused unread, an undeclared one is abandoned mid-stream."""
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            if int(declared) > ia.MAX_BODY_BYTES:
                return None
        except ValueError:
            return None
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > ia.MAX_BODY_BYTES:
            return None
        chunks.append(chunk)
    return b"".join(chunks)


@router.post(HOOK_PATH)
async def receive_alert(token: str, request: Request) -> JSONResponse:
    ia.count(ia.RECEIVED)
    verdict, user_id, token_hash = await run_in_threadpool(ia.verify, token)
    if verdict != ia.VALID:
        status, sentence, outcome = _REFUSALS[verdict]
        ia.count(outcome)
        return _refuse(status, sentence)
    if not _rate_ok(token_hash):
        ia.count(ia.RATE_LIMITED)
        return _refuse(429, RATE_SENTENCE, **{"Retry-After": "60"})
    raw = await _read_capped(request)
    if raw is None:
        ia.count(ia.REFUSED_OVERSIZE)
        return _refuse(413, TOO_BIG_SENTENCE)
    try:
        payload = ia.parse_payload(raw)
    except ia.PayloadError as e:
        ia.count(ia.REFUSED_MALFORMED)
        return _refuse(e.status, str(e))
    try:
        receipt_id = await run_in_threadpool(ia.claim_receipt, user_id, payload, token_hash)
    except Exception as e:  # noqa: BLE001 -- a busy store is a 503, never a 500 page
        logger.warning("[inbound-alerts] receipt not recorded user=%s: %s",
                       user_id, type(e).__name__)
        ia.count(ia.STORE_FAILED)
        return _refuse(503, BUSY_SENTENCE, **{"Retry-After": "5"})
    if receipt_id is None:
        ia.count(ia.DEDUPED)
        return JSONResponse({"accepted": True, "duplicate": True}, status_code=200)
    _dispatch(ia.deliver, receipt_id, user_id, payload)
    ia.count(ia.ACCEPTED)
    return JSONResponse({"accepted": True}, status_code=202)


# ── the member's token lifecycle ─────────────────────────────────────────────

def _base_url() -> str:
    return os.environ.get("DASHBOARD_URL", "https://uctintelligence.com").rstrip("/")


def _issued(token: str) -> dict[str, Any]:
    """The ONE response that carries the token. It is not stored, so it can
    never be shown again -- the member copies it now or resets it later."""
    return {
        "url": f"{_base_url()}{HOOK_PREFIX}{token}",
        "hint": token[:len(ia.TOKEN_PREFIX) + 4],
        "shown_once": True,
        "message_example": MESSAGE_EXAMPLE,
    }


@router.get(RECEIVER_PATH)
def receiver_status(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    return ia.status(user["id"])


@router.post(RECEIVER_PATH)
def receiver_create(user: dict = Depends(require_paid)) -> JSONResponse:
    token = ia.mint(user["id"])
    if token is None:
        return JSONResponse({"detail": ACTIVE_SENTENCE}, status_code=409)
    return JSONResponse(_issued(token), status_code=201)


@router.post(ROTATE_PATH)
def receiver_rotate(user: dict = Depends(require_paid)) -> dict[str, Any]:
    return _issued(ia.rotate(user["id"]))


@router.delete(RECEIVER_PATH)
def receiver_revoke(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    return {"revoked": ia.revoke(user["id"])}


@router.get(STATUS_PATH)
def inbound_alerts_status(_admin: dict = Depends(require_admin)) -> dict[str, Any]:
    return ia.status_snapshot()
