"""May THIS process open a live vendor WebSocket with the production key?

🔴 WRITTEN AFTER 2026-08-10, WHERE THE ANSWER SHOULD HAVE BEEN NO AND NOBODY ASKED.
Six stale `uvicorn api.main:app` dev servers were still running on the owner's PC
from the previous morning, two of them holding Finnhub connections **with the
production key**. Finnhub allows ONE connection per key, so production connected,
subscribed 33 tickers, was kicked ~1 s later, and cycled into a circuit breaker for
hours. Live charts were dead and every symptom pointed at the pod.

⭐ THE DEV BOX ALWAYS WINS, WHICH IS WHY THIS HAS TO BE STRUCTURAL. Production
redeploys and reconnects; a forgotten laptop process never does. Killing them one at
a time does nothing — the next one takes the slot the moment it frees. The only
durable fix is that a non-production process refuses to open the socket at all.

⚠️ THE SAME TRAP IS ALREADY DOCUMENTED FOR MASSIVE, one door down: CLAUDE.md warns
that `MASSIVE_WS_DRY_RUN=1` does NOT protect the connection slot, because "any local
run with the prod key kicks production off the feed (Massive allows ~1 conn/key)".
That warning has existed for weeks as *a thing you must remember*. Remembering is
what failed. This is the same rule, enforced.
"""
import logging
import os

_logger = logging.getLogger(__name__)

#: The deliberate escape hatch, for when you genuinely want a local process on the
#: live feed (debugging the stream itself). Opt-IN, and the failure direction is a
#: quiet local chart rather than a production outage.
_OPT_IN_VAR = "ALLOW_LOCAL_VENDOR_SOCKETS"


def on_production() -> bool:
    """True when this process is running on Railway.

    ⭐ `RAILWAY_ENVIRONMENT` IS REUSED ON PURPOSE, NOT INVENTED HERE. It is already
    load-bearing for `COOKIE_SECURE` in `api/routers/auth.py` — so if it ever
    stopped being set in production, we would learn it from insecure session
    cookies long before a missing price feed. A second, private "am I in prod?"
    signal is exactly the kind of duplicate authority that drifts silently and then
    disagrees with the first one at the worst moment.
    """
    return os.environ.get("RAILWAY_ENVIRONMENT") is not None


def may_open(vendor: str) -> tuple[bool, str]:
    """``(allowed, reason)`` for opening ``vendor``'s live socket.

    ``reason`` is empty when allowed, and is a full operator-facing sentence when
    not — it is logged verbatim, because a developer whose local charts went quiet
    needs to be told WHY and HOW in the same line, or they will spend the afternoon
    debugging the stream instead of setting one variable.
    """
    if on_production():
        return True, ""
    if os.environ.get(_OPT_IN_VAR, "") == "1":
        return True, ""
    return False, (
        f"[{vendor}] REFUSING to open the live {vendor} socket: this process is not "
        f"running on Railway, and the production API key allows roughly ONE "
        f"connection. A local run steals that slot from production and kicks the "
        f"live site off its own feed (this happened 2026-08-10 and cost a session "
        f"of live charts). Set {_OPT_IN_VAR}=1 if you really do want this process on "
        f"the live feed."
    )


def refuse_if_local(vendor: str) -> bool:
    """True if the caller must NOT open the socket. Logs the reason once, loudly."""
    allowed, reason = may_open(vendor)
    if allowed:
        return False
    _logger.warning(reason)
    return True
