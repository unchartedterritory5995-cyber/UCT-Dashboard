"""Pre-launch waitlist.

Public capture endpoint behind the COMING SOON page, plus an admin read so the
owner can see the list grow and export it on launch day.

Deliberately independent of `users`/`subscriptions` — a waitlist row is not an
account, and signup stays closed while COMING_SOON_MODE is on.
"""

import csv
import io
import logging
import os
import sqlite3
from contextlib import closing
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr, Field

from api.limiter import limiter
from api.middleware.auth_middleware import require_admin
from api.services.auth_db import get_connection
from api.services.discord_notify import notify_waitlist_signup
from api.services.email_service import send_waitlist_confirmation
from api.services.request_ip import client_ip

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/waitlist", tags=["waitlist"])


def coming_soon_mode() -> bool:
    """True while the public site is the COMING SOON holding page.

    Read at call time (not import time) so tests and a Railway variable change
    both take effect without a code change.
    """
    return os.environ.get("COMING_SOON_MODE", "").strip() in ("1", "true", "True")


class JoinBody(BaseModel):
    email: EmailStr
    referrer: str | None = Field(default=None, max_length=512)


def _ip_prefix(ip: str | None) -> str | None:
    """Trim to /24 (IPv4) or the first 4 hextets (IPv6) — same privacy
    treatment `landing_analytics` applies to its own rows."""
    if not ip:
        return None
    if ":" in ip:
        return ":".join(ip.split(":")[:4])
    parts = ip.split(".")
    if len(parts) == 4:
        return ".".join(parts[:3] + ["0"])
    return None


@router.post("")
@limiter.limit("5/minute")
def join(request: Request, body: JoinBody) -> dict[str, Any]:
    """Add an email to the launch list.

    Idempotent: a repeat submission reports success with `already=true` rather
    than leaking whether that address is already on the list.
    """
    email = body.email.strip().lower()
    total: int | None = None

    try:
        with closing(get_connection()) as conn:
            cur = conn.execute("SELECT 1 FROM waitlist WHERE email = ?", (email,))
            already = cur.fetchone() is not None
            if not already:
                conn.execute(
                    "INSERT INTO waitlist (email, referrer, ip_prefix) VALUES (?, ?, ?)",
                    (email, (body.referrer or None), _ip_prefix(client_ip(request))),
                )
                conn.commit()
                row = conn.execute("SELECT COUNT(*) AS c FROM waitlist").fetchone()
                total = row["c"] if row else None
    except sqlite3.IntegrityError:
        # Raced with a concurrent identical submit — still a success for the caller.
        already = True
    except Exception:
        logger.exception("[waitlist] failed to record %s", email)
        raise HTTPException(status_code=500, detail="Could not save that. Try again in a moment.")

    # Everything below is best-effort and only fires for a genuinely new entry.
    # The row is already committed, so neither a mail outage nor a Discord
    # outage can cost a signup — each is caught separately so one failing does
    # not skip the other.
    if not already:
        try:
            send_waitlist_confirmation(email)
        except Exception:
            logger.exception("[waitlist] confirmation email failed for %s", email)

        try:
            notify_waitlist_signup(email, total=total, referrer=(body.referrer or ""))
        except Exception:
            logger.exception("[waitlist] discord ping failed for %s", email)

    return {"ok": True, "already": already}


@router.get("/admin")
def list_waitlist(
    limit: int = 500,
    _admin: Any = Depends(require_admin),
) -> dict[str, Any]:
    """Count + most recent signups, for the owner."""
    limit = max(1, min(limit, 5000))
    with closing(get_connection()) as conn:
        total = conn.execute("SELECT COUNT(*) AS c FROM waitlist").fetchone()["c"]
        rows = conn.execute(
            "SELECT email, referrer, created_at, notified_at "
            "FROM waitlist ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return {"total": total, "entries": [dict(r) for r in rows]}


@router.get("/admin/export.csv")
def export_waitlist(_admin: Any = Depends(require_admin)) -> StreamingResponse:
    """Full list as CSV — what you'd paste into an email tool at launch."""
    with closing(get_connection()) as conn:
        rows = conn.execute(
            "SELECT email, referrer, created_at, notified_at "
            "FROM waitlist ORDER BY created_at ASC"
        ).fetchall()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["email", "referrer", "created_at", "notified_at"])
    for r in rows:
        writer.writerow([r["email"], r["referrer"] or "", r["created_at"], r["notified_at"] or ""])
    buf.seek(0)

    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="uct-waitlist.csv"'},
    )
