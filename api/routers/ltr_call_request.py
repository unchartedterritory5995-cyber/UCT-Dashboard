"""Live trading room: "Not sure yet? Talk to the team first" call requests.

The public /live-trading-room page offers a short form beside its Join buttons.
A visitor leaves a name and phone number; this endpoint stores the request and
posts it to the owner's private Discord channel so the team can call them back.

Destination: ``LTR_LEADS_DISCORD_WEBHOOK`` -- the private #leads channel's
webhook URL (the same one Make holds as ``DISCORD_WEBHOOK_LEADS``). There is NO
fallback channel: a phone number must not land anywhere but #leads.

FAIL CLOSED: the visitor is told "sent" ONLY when the #leads post returned 2xx.
When the variable is unset, or Discord refuses or times out, the visitor gets an
honest "not sent" (503). The row is still written to auth.db first, as a record
(``discord_posted`` says whether #leads got it), but a saved row alone is never
reported as success: nobody watches that table, so it would be a fake "sent".

Abuse protection: a hidden honeypot field, server-side validation, and an
in-memory per-IP limit (5 accepted requests an hour). No name, phone or email
is ever written to a log line.

A plain HTML form post (no JavaScript) is answered with a 303 back to the page
at ``#call-sent`` (delivered), ``#call-error`` (bad input) or
``#call-unavailable`` (rate limited, or not delivered), which the page shows
with CSS ``:target``.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
import threading
import time
from collections import defaultdict, deque
from contextlib import closing
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, RedirectResponse

from api.services import auth_db
from api.services.request_ip import client_ip

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ltr", tags=["live-trading-room"])

LEADS_WEBHOOK_ENV = "LTR_LEADS_DISCORD_WEBHOOK"
PAGE_PATH = "/live-trading-room"

BEST_TIMES = ("Morning", "Afternoon", "Evening")
TRADES = ("Stocks", "Options", "Both", "Just starting")
NAME_MAX = 80
PHONE_MAX = 40
EMAIL_MAX = 254
PHONE_DIGITS_MIN = 7
PHONE_DIGITS_MAX = 20
HONEYPOT_FIELD = "website"

RATE_LIMIT = 5
RATE_WINDOW_S = 3600.0

_PHONE_CHARS = re.compile(r"^[0-9+()\-. ]+$")
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_WS = re.compile(r"\s+")

_rate_lock = threading.Lock()
_rate: dict[str, deque] = defaultdict(deque)


def _now() -> float:
    return time.monotonic()


def _reset_rate_limit_for_tests() -> None:
    with _rate_lock:
        _rate.clear()


def _rate_ok(key: str) -> bool:
    """True and counts the attempt when ``key`` has room in its window."""
    now = _now()
    with _rate_lock:
        q = _rate[key]
        while q and now - q[0] >= RATE_WINDOW_S:
            q.popleft()
        if len(q) >= RATE_LIMIT:
            return False
        q.append(now)
        return True


class _Invalid(Exception):
    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.field = field
        self.message = message


def _clean(value: Any) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        value = str(value)
    return _WS.sub(" ", value).strip()


def _validate(body: dict) -> dict:
    name = _clean(body.get("name"))
    if not name:
        raise _Invalid("name", "Please enter your name.")
    if len(name) > NAME_MAX:
        raise _Invalid("name", "That name is too long.")

    phone = _clean(body.get("phone"))
    if not phone:
        raise _Invalid("phone", "Please enter a phone number.")
    digits = sum(ch.isdigit() for ch in phone)
    if (len(phone) > PHONE_MAX or not _PHONE_CHARS.match(phone)
            or not PHONE_DIGITS_MIN <= digits <= PHONE_DIGITS_MAX):
        raise _Invalid("phone", "Please enter a valid phone number.")

    email = _clean(body.get("email"))
    if email and (len(email) > EMAIL_MAX or not _EMAIL.match(email)):
        raise _Invalid("email", "Please enter a valid email, or leave it blank.")

    best_time = _clean(body.get("best_time"))
    if best_time and best_time not in BEST_TIMES:
        raise _Invalid("best_time", "Please pick a time from the list.")

    trades = _clean(body.get("trades"))
    if trades and trades not in TRADES:
        raise _Invalid("trades", "Please pick an option from the list.")

    return {"name": name, "phone": phone, "email": email,
            "best_time": best_time, "trades": trades}


def _et_stamp() -> str:
    try:
        from zoneinfo import ZoneInfo
        now = datetime.now(ZoneInfo("America/New_York"))
    except Exception:  # pragma: no cover - tzdata missing
        now = datetime.now(timezone.utc)
    hour = int(now.strftime("%I"))
    return f"{now:%b} {now.day}, {now.year} {hour}:{now:%M %p} ET"


_MD = re.compile(r"([\\*_~`|\[\]<>#])")


def _md(text: str) -> str:
    """Escape Discord markdown so a visitor's text cannot format or mask-link
    in #leads (mentions are already disabled by allowed_mentions)."""
    return _MD.sub(lambda m: "\\" + m.group(1), text)


def format_message(req: dict) -> str:
    parts = [
        _md(req["name"]),
        req["phone"],
        _md(req["email"]) if req["email"] else "no email",
        f"best time {req['best_time'] or 'not given'}",
        f"trades {req['trades'] or 'not given'}",
        _et_stamp(),
    ]
    return "**Call request (website)** " + " · ".join(parts)


def _webhook_url() -> str:
    return (os.environ.get(LEADS_WEBHOOK_ENV) or "").strip()


def leads_configured() -> bool:
    return bool(_webhook_url())


def _post_discord(content: str) -> tuple[bool, str]:
    url = _webhook_url()
    via = "leads" if url else "none"
    if not url:
        logger.warning("[ltr-call] %s is not set; request NOT delivered", LEADS_WEBHOOK_ENV)
        return False, via
    try:
        resp = httpx.post(
            url,
            json={"content": content[:1900], "allowed_mentions": {"parse": []}},
            timeout=8.0,
        )
        ok = 200 <= resp.status_code < 300
        if not ok:
            logger.warning("[ltr-call] discord post refused via=%s status=%s", via, resp.status_code)
        return ok, via
    except Exception as exc:
        logger.warning("[ltr-call] discord post failed via=%s (%s)", via, type(exc).__name__)
        return False, via


def _connect() -> sqlite3.Connection:
    return auth_db.get_connection()


def _ip_prefix(ip: str | None) -> str | None:
    if not ip or ip == "unknown":
        return None
    if ":" in ip:
        return ":".join(ip.split(":")[:4])
    parts = ip.split(".")
    if len(parts) == 4:
        return ".".join(parts[:3] + ["0"])
    return None


def _store(req: dict, ip: str) -> int | None:
    try:
        with closing(_connect()) as conn:
            cur = conn.execute(
                "INSERT INTO ltr_call_requests "
                "(name, phone, email, best_time, trades, ip_prefix) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (req["name"], req["phone"], req["email"] or None,
                 req["best_time"] or None, req["trades"] or None, _ip_prefix(ip)),
            )
            conn.commit()
            return cur.lastrowid
    except Exception as exc:
        logger.warning("[ltr-call] store failed (%s)", type(exc).__name__)
        return None


def _mark_posted(row_id: int) -> None:
    try:
        with closing(_connect()) as conn:
            conn.execute("UPDATE ltr_call_requests SET discord_posted = 1 WHERE id = ?", (row_id,))
            conn.commit()
    except Exception as exc:
        logger.warning("[ltr-call] mark-posted failed id=%s (%s)", row_id, type(exc).__name__)


def _handle(req: dict, ip: str) -> bool:
    """Store (as a record) then post. True ONLY when #leads took the request."""
    row_id = _store(req, ip)
    posted, via = _post_discord(format_message(req))
    if posted and row_id is not None:
        _mark_posted(row_id)
    logger.info("[ltr-call] request id=%s stored=%s posted=%s via=%s",
                row_id, row_id is not None, posted, via)
    return posted


def _wants_redirect(request: Request) -> bool:
    ctype = (request.headers.get("content-type") or "").lower()
    return "application/json" not in ctype


async def _read_body(request: Request) -> dict | None:
    if not _wants_redirect(request):
        try:
            data = json.loads((await request.body()) or b"null")
        except ValueError:
            return None
        return data if isinstance(data, dict) else None
    try:
        form = await request.form()
    except Exception:
        return None
    return {k: v for k, v in form.items() if isinstance(v, str)}


def _reply(request: Request, status: int, payload: dict) -> Any:
    if _wants_redirect(request):
        if payload.get("ok"):
            anchor = "call-sent"
        elif status == 422:
            anchor = "call-error"
        else:
            anchor = "call-unavailable"
        return RedirectResponse(f"{PAGE_PATH}#{anchor}", status_code=303)
    return JSONResponse(payload, status_code=status)


@router.api_route("/call-request", methods=["GET", "HEAD"], include_in_schema=False)
def call_request_wrong_method() -> JSONResponse:
    """405 for a GET. Declared explicitly because the SPA catch-all in main.py
    answers ANY unmatched GET (``/api/*`` included) with index.html and a 200."""
    return JSONResponse({"ok": False, "error": "Method not allowed."},
                        status_code=405, headers={"Allow": "POST"})


@router.post("/call-request")
async def call_request(request: Request) -> Any:
    body = await _read_body(request)
    if body is None:
        return _reply(request, 422, {"ok": False, "field": None,
                                     "error": "Please fill in the form and try again."})

    try:
        req = _validate(body)
    except _Invalid as bad:
        return _reply(request, 422, {"ok": False, "field": bad.field, "error": bad.message})

    ip = client_ip(request)
    if not _rate_ok(ip):
        return _reply(request, 429, {"ok": False, "field": None,
                                     "error": "Too many requests. Please try again later."})

    # A bot filled the hidden field: look like success, keep nothing.
    if _clean(body.get(HONEYPOT_FIELD)):
        logger.info("[ltr-call] honeypot hit, dropped")
        return _reply(request, 200, {"ok": True})

    configured = leads_configured()
    ok = await run_in_threadpool(_handle, req, ip)
    if not ok:
        msg = ("We could not send that just now. Please try again in a minute."
               if configured else
               "Call requests are not available right now. Please try again later.")
        return _reply(request, 503, {"ok": False, "field": None, "error": msg})
    return _reply(request, 200, {"ok": True})
