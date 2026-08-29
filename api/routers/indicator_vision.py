"""SCREENSHOT -> CANDIDATE INDICATORS — the network edge of the picture door.

  POST /api/indicator-vision/candidates  → an image in, ranked candidates out

⛔ THE MOUNT IS UNCONDITIONAL AND THE HANDLER CHECKS THE FLAG. A flag that gates
`include_router` makes the route answer **405** — a path that exists in the
source, is absent from the served app, and reports a verb problem. This way the
route always exists and an off switch says so IN WORDS, with the variable that
turns it on named in the sentence.

⛔ A REFUSAL IS A 200 WITH `ok: False`, NOT A 4xx. `brain_service`'s shape, and
the same shape `/api/user-definitions/propose` already answers with: "I could not
read a formula out of that picture" is a legitimate reply, not a transport
failure. The 4xx codes here are reserved for things that are genuinely about the
REQUEST — no payment (402), too many of them (429), a malformed bars field (400).

⛔ `require_paid` IS THE ONE THE OTHER DEFINITION DOOR DECLARES, IMPORTED. It is
the same gate on the same product surface, and `tests/test_exposed_routes_gated`
reads gates BY OBJECT IDENTITY — sharing the object is what makes this route's
gate the very thing that file already measures, rather than a look-alike.

⚠️ THE HANDLER IS SYNCHRONOUS ON PURPOSE. The model call inside it BLOCKS, and a
blocking call in an `async def` pins the event loop for every other request in
the pod; a sync handler is run by FastAPI on the threadpool, where the call
occupies one worker for at most the client's bounded 60 s. That is the
2026-07-01 outage class, one layer up from the timeout itself.
"""

from __future__ import annotations

import json
import os
import threading
import time

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from api.routers.user_definitions import MAX_PROPOSE_BARS, require_paid
from api.services import indicator_from_image as svc

router = APIRouter(prefix="/api/indicator-vision", tags=["indicator-vision"])


# ── the INVOCATION bound ─────────────────────────────────────────────────────
#
# 🔴 WHY THIS ROUTE NEEDS ITS OWN. `require_paid` is a one-time yes/no; the model
# call behind this handler is billed per request and carries an IMAGE, so it is
# the priciest single call any member can fire on this surface. Without a bound, a
# paid session in a `while true` loop is an unmetered bill on the firm's key —
# the shape E-7's census found on `/api/scans/definition-results` and the reason
# `PROPOSE_MAX_PER_HOUR` exists next door.
#
# ⚠️ AND IT IS DELIBERATELY NOT THAT COUNTER. Sharing the concierge's window would
# make one door's refusal quote the other door's ceiling ("at most 40 indicator
# proposals per hour") to a member who has sent four pictures — a correct answer
# produced by the wrong mechanism, which is this branch's most expensive defect
# class. Different door, different name, different number, its own sentence.
#
# ⚠️ PER-PROCESS, AND THAT IS A REAL LIMIT — the same declared assumption as the
# concierge's counter. The web pod is one uvicorn process, so this is exact today
# and becomes per-instance the day web scales out.
VISION_MAX_PER_HOUR = int(os.environ.get("INDICATOR_VISION_MAX_PER_HOUR", "10"))
_WINDOW_SECONDS = 3600
_calls: dict[str, list[float]] = {}
_lock = threading.Lock()


def _charge(user_id: str, *, now: float | None = None) -> None:
    """Record one call for `user_id`, or raise 429 if the window is full.

    ⛔ THE CHARGE HAPPENS BEFORE THE MODEL RUNS. Billing on success would let a
    caller loop refusals for free, and a refused read costs the same tokens as an
    accepted one.
    """
    now = time.time() if now is None else now
    cutoff = now - _WINDOW_SECONDS
    with _lock:
        recent = [t for t in _calls.get(user_id, ()) if t > cutoff]
        if len(recent) >= VISION_MAX_PER_HOUR:
            retry_after = max(1, int(recent[0] + _WINDOW_SECONDS - now))
            _calls[user_id] = recent
            raise HTTPException(
                status_code=429,
                detail=f"At most {VISION_MAX_PER_HOUR} indicator screenshots per "
                       f"hour. Try again in {retry_after}s.",
                headers={"Retry-After": str(retry_after)},
            )
        recent.append(now)
        _calls[user_id] = recent
        # Bound the dict itself: a key per member is fine, a key per member
        # FOREVER is a leak.
        if len(_calls) > 5000:
            for key in [k for k, v in _calls.items() if not [t for t in v if t > cutoff]]:
                _calls.pop(key, None)


def _bars_from(raw: str) -> list:
    """The chart's bars, off a multipart field, BOUNDED.

    ⛔ THE CAP IS THE CONCIERGE ROUTE'S, IMPORTED. Both doors hand bars to the
    same compute stage; a second number here would be a second answer to "how big
    may one request be", and the day one moved the other would not.

    ⚠️ A MULTIPART FIELD CARRIES TEXT, so the bars arrive as a JSON string. A
    malformed one is the CALLER'S mistake and answers 400 — unlike a picture this
    door cannot read, which is a legitimate 200 refusal.
    """
    if not raw or not raw.strip():
        return []
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="bars: not valid JSON") from exc
    if not isinstance(parsed, list):
        raise HTTPException(status_code=400, detail="bars: expected a list")
    if len(parsed) > MAX_PROPOSE_BARS:
        raise HTTPException(
            status_code=400,
            detail=f"bars: at most {MAX_PROPOSE_BARS} bars, got {len(parsed)}")
    return parsed


@router.post("/candidates")
def candidates_from_screenshot(
    file: UploadFile = File(...),
    note: str = Form(""),
    bars: str = Form(""),
    user: dict = Depends(require_paid),
):
    """A picture of somebody else's indicator; this engine's own candidates back.

    ⛔ IT STORES NOTHING. A candidate is a suggestion the member has not confirmed
    — and unlike a typed formula, nobody has even claimed it is the right one.
    Persisting it would make a model's guess at a picture into a definition the
    alert lane could bind to. The member accepts one, and the ordinary
    `POST /api/user-definitions` door does the writing, through the same
    validation everything else goes through.

    ⭐ THE FLAG IS CHECKED HERE, IN THE HANDLER, and it is checked BEFORE the rate
    limiter charges anybody: a member who cannot use the feature should not be
    spending their hourly allowance discovering that.
    """
    if not svc.vision_enabled():
        return svc.disabled_refusal()

    parsed_bars = _bars_from(bars)
    _charge(str(user["id"]))

    # ⛔ A BOUNDED READ. One byte past the ceiling is enough to know it is over it;
    # reading the whole of an oversized upload into memory to then reject it is the
    # DoS the ceiling exists to prevent. The service owns the refusal sentence.
    data = file.file.read(svc.MAX_IMAGE_BYTES + 1)
    return svc.candidates_from_image(
        image_bytes=data,
        media_type=(file.content_type or "").split(";")[0].strip().lower(),
        user_id=user["id"],
        bars=parsed_bars,
        note=note,
    )
