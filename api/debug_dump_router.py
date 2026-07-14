"""
Thread stack-dump diagnostic endpoint (2026-07-14 incident follow-up).

During the 7/14 tape freeze we could see WHICH thread was hot (railway ssh +
top -H) but not WHERE in Python it was spinning — py-spy can't be installed
into the prod venv on demand. This endpoint answers "what is every thread
doing right now" in one authenticated request, from inside the process.

GET /api/admin/threads-dump   (Authorization: Bearer <PUSH_SECRET>)
Returns plain text: one section per thread — name, daemon flag, and full
Python stack. Costs one brief GIL pause; safe to call on a live service.
"""

import os
import sys
import threading
import time
import traceback

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import PlainTextResponse

router = APIRouter(prefix="/api/admin", tags=["diagnostics"])

_BOOT_TS = time.time()


def _require_push_secret(authorization: str):
    secret = (os.environ.get("PUSH_SECRET") or "").strip()
    if not secret or authorization != f"Bearer {secret}":
        raise HTTPException(status_code=403, detail="forbidden")


@router.get("/threads-dump", response_class=PlainTextResponse)
def threads_dump(authorization: str = Header(default="")):
    _require_push_secret(authorization)

    frames = sys._current_frames()
    threads_by_ident = {t.ident: t for t in threading.enumerate()}

    lines = [
        f"process uptime: {time.time() - _BOOT_TS:.0f}s",
        f"threads: {len(frames)}",
        "=" * 72,
    ]
    for ident, frame in frames.items():
        t = threads_by_ident.get(ident)
        name = t.name if t else f"<unknown ident={ident}>"
        daemon = t.daemon if t else "?"
        lines.append(f"--- {name} (ident={ident}, daemon={daemon}) ---")
        lines.append("".join(traceback.format_stack(frame)).rstrip())
        lines.append("")
    return "\n".join(lines)
