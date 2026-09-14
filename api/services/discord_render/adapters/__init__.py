"""Provider adapters for the Discord render path — the only place an upstream is spoken to.

One module per upstream (bars · quote · flow · renderer · entity master). Each exposes a single
`fetch(request) -> Result`, and **timeouts, retries, breakers, fallback and the freshness stamp live
here and nowhere else**. A command handler asks an adapter for data; it never holds a client, a
timeout, or a retry loop of its own.

⛔ WHY THE BOUNDARY IS A RAIL AND NOT A CONVENTION. The failures this closes were all "the policy is
in the caller": a fixed 1.5 s bars retry that re-synchronised every caller that failed together; a
`/flow` handler whose single `except` turned four causes into one wrong sentence (C-08); and a
renderer call with no ceiling at all, which is how a 21-second page load became a member's spinner.
Each of those was correct in the one place somebody remembered to fix it and wrong in the next
caller. `tests/test_discord_render_adapter_boundary.py` fails by name when a handler imports an HTTP
client or a provider module directly.

⛔ AN ADAPTER RETURNS, IT DOES NOT RAISE. See `result.py`.
"""
from api.services.discord_render.adapters.result import (  # noqa: F401
    ALL_REASONS, BAD_SHAPE, BREAKER_OPEN, CACHED, DEADLINE, EMPTY, FATAL_REASONS, NOT_CARRIED,
    STALE, TIMEOUT, UPSTREAM_ERROR, Result, fail, ok,
)

__all__ = ["Result", "ok", "fail", "ALL_REASONS", "FATAL_REASONS", "TIMEOUT", "BREAKER_OPEN",
           "UPSTREAM_ERROR", "EMPTY", "BAD_SHAPE", "NOT_CARRIED", "STALE", "CACHED", "DEADLINE"]
