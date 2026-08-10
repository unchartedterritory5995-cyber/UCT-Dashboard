"""The OAuth `state` parameter for the Schwab broker connection.

⭐⭐ WHY THIS IS ITS OWN MODULE. `api/schwab_router.py` is co-owned with a partner
(see `project_partner_collab_branch`), so the logic lives here and the router gains
two calls. A security fix that rewrites forty lines of somebody else's file is a
merge conflict waiting to overwrite one of us.

## What was wrong

`/api/schwab/callback` took **any** `code` from **anyone**, exchanged it, and wrote
the result over `TOKEN_FILE` — and there is exactly ONE token file for the whole
firm. So an unauthenticated stranger who completed a Schwab login against THEIR OWN
brokerage account could POST us their code and silently repoint every server-side
Schwab call at their account. Nothing in the flow was authenticated, and nothing tied
the callback to a login this server had started.

⛔ THAT IS THE CLASSIC OAUTH LOGIN-CSRF, and `state` is its named remedy: the server
mints an unguessable value at `/login`, hands it to the provider, and refuses any
callback that does not carry it back.

## Three properties, and each one is load-bearing

1. **UNFORGEABLE** — HMAC-SHA256 over the payload with the app's own secret. A caller
   cannot mint a state, so a callback that verifies is one we started.
2. **SINGLE USE** — a verified state is burned. Replaying a captured callback URL
   (it sits in browser history, in logs, in a referrer) does nothing the second time.
3. **SHORT LIVED** — `_TTL_SECONDS`. An OAuth round trip is a human clicking through
   a login page; ten minutes is generous and a stale state is not a valid one.

⚠️ IN-PROCESS STORAGE IS CORRECT HERE, NOT A SHORTCUT. The burn set lives in memory,
so a restart between `/login` and `/callback` invalidates the attempt and the admin
clicks again. The alternative — persisting it — would buy nothing: the token this
protects is itself a single server-side file, so there is no multi-node case where
one node issues and another consumes without sharing that file anyway. ⛔ What memory
must NOT be relied on for is the SIGNATURE, and it is not: expiry and authenticity
are inside the HMAC, so even a wiped burn set cannot admit a forged or stale state.
"""
from __future__ import annotations

import hmac
import base64
import hashlib
import logging
import os
import secrets
import time

log = logging.getLogger(__name__)

#: An OAuth round trip is a human clicking a login page. ⛔ NOT hours: the whole
#: point of the value is that it is fresh, and a long-lived state is a captured
#: URL that still works tomorrow.
_TTL_SECONDS = 600

#: States already redeemed, so a replay is refused. Bounded, because an unbounded
#: set fed by an anonymous endpoint is a memory leak with a caller who controls it.
_BURNED: dict[str, float] = {}
_MAX_BURNED = 4096


def _secret() -> bytes:
    """The signing key.

    ⭐ IT REUSES A SECRET THE DEPLOYMENT ALREADY HAS rather than adding a variable
    somebody must remember to set — an unset new secret is a fix that silently is
    not applied. ⛔ AND IT NEVER FALLS BACK TO A CONSTANT: with no secret at all
    the key is random per process, which makes every state issued by this process
    verifiable and every forged one fail. The failure mode of a missing secret is
    "the admin has to re-click after a restart", not "anyone can mint a state".
    """
    for name in ("SCHWAB_APP_SECRET", "PUSH_SECRET", "SECRET_KEY"):
        raw = os.environ.get(name)
        if raw:
            return raw.encode("utf-8")
    global _EPHEMERAL
    try:
        return _EPHEMERAL
    except NameError:
        _EPHEMERAL = secrets.token_bytes(32)
        log.warning("[schwab-oauth] no shared secret found; using a per-process key "
                    "— a restart between /login and /callback will require re-clicking")
        return _EPHEMERAL


def _sign(payload: str) -> str:
    return base64.urlsafe_b64encode(
        hmac.new(_secret(), payload.encode("utf-8"), hashlib.sha256).digest()
    ).decode("ascii").rstrip("=")


def issue() -> str:
    """Mint a state for `/login` to hand to Schwab."""
    nonce = secrets.token_urlsafe(16)
    payload = f"{nonce}.{int(time.time())}"
    return f"{payload}.{_sign(payload)}"


def verify_and_burn(state: str | None) -> tuple[bool, str]:
    """Is this a state WE issued, still fresh, and not already used?

    Returns `(ok, reason)`. ⭐ THE REASON IS FOR THE LOG, NEVER FOR THE RESPONSE —
    telling a caller whether their forged state failed on the signature or on the
    clock hands them an oracle for tuning the next attempt.
    """
    if not state or not isinstance(state, str):
        return False, "missing"
    parts = state.split(".")
    if len(parts) != 3:
        return False, "malformed"
    nonce, issued_at, sig = parts

    # ⛔ `compare_digest`, NEVER `==`. String equality returns on the first
    # differing byte, and that timing is a side channel a patient caller can walk.
    if not hmac.compare_digest(sig, _sign(f"{nonce}.{issued_at}")):
        return False, "bad-signature"

    try:
        age = time.time() - int(issued_at)
    except ValueError:
        return False, "malformed-timestamp"
    # ⚠️ A NEGATIVE AGE IS ALSO A REFUSAL. A signed future timestamp cannot come
    # from this server, so it means the clock moved — and admitting it would let a
    # state outlive its TTL by however far the clock jumped.
    if age < 0 or age > _TTL_SECONDS:
        return False, "expired"

    now = time.time()
    if nonce in _BURNED:
        return False, "replayed"

    # Evict what can no longer be replayed anyway — anything older than the TTL is
    # refused by the clock check above, so remembering it buys nothing.
    if len(_BURNED) >= _MAX_BURNED:
        for k, t in [(k, t) for k, t in _BURNED.items() if now - t > _TTL_SECONDS]:
            _BURNED.pop(k, None)
        if len(_BURNED) >= _MAX_BURNED:
            # Still full: drop the oldest. ⛔ Never skip the burn entirely — a
            # full table must not silently turn replay protection off.
            oldest = min(_BURNED, key=_BURNED.get)
            _BURNED.pop(oldest, None)
    _BURNED[nonce] = now
    return True, "ok"


def _reset_for_tests() -> None:
    _BURNED.clear()
