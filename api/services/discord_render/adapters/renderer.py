"""The renderer adapter — the chart-renderer service that screenshots `/r/*` (03 §3.7, §3.8).

⛔⛔ THIS IS THE ADAPTER THAT EXISTS FOR ONE MEASURED NUMBER. `discord_chart_house.RENDER_TIMEOUT_S`
is **60 seconds**, over **two** attempts, on a path whose job deadline is **15**. The watchdog fires
at 15 s, the member is told the render failed, and the call runs on for up to another 105 seconds
holding a worker thread — while the breaker that was built for exactly this dependency
(`breakers.DEFAULTS["renderer"]`) had, until now, **zero production callers**.

Here the ceiling is `min(20 s, the job's remaining time)` and the call is behind the breaker. A
renderer that is down stops making members wait for it after five failures, for fifteen seconds at a
time, with one probe let through — instead of every request paying the full timeout again.

⛔ THE RENDERER HAS NO VINTAGE OF ITS OWN, AND MUST NOT BE GIVEN A FRESH-LOOKING ONE. It returns PNG
bytes and nothing else. The envelope on the Result is the one the BARS came back with, passed
through — the picture is exactly as old as the data drawn in it (§3.10: same closed-market input,
same pixels). Stamping it "rendered just now" would make a week-old chart look current.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from api.services.discord_render.adapters import _call
from api.services.discord_render.adapters.result import BAD_SHAPE, EMPTY, Result, fail, ok
from api.services.discord_render.freshness import Envelope

NAME = "renderer"
#: §3.8: renderer 20 s. ⛔ NOT `discord_chart_house.RENDER_TIMEOUT_S` (60) — see the docstring.
TIMEOUT_S = 20.0
#: One attempt. The house path already has its own two-attempt settle/ready ladder inside a single
#: call, and a retry on top of that is the 105-second overrun in a different shape.
ATTEMPTS = 1
PNG_MAGIC = b"\x89PNG"


@dataclass(frozen=True)
class RenderRequest:
    ticker: str
    tf: str = "D"
    stats: dict | None = None
    options: dict = field(default_factory=dict)
    corr_id: str | None = None
    remaining_s: float | None = None
    #: The vintage of the DATA being drawn, carried through from the bars Result. None is honest
    #: (unknown), and `stale=None` is what the caller then sees — never a cheerful False.
    envelope: Envelope | None = None


def fetch(req: RenderRequest, *, house_fn=None) -> Result:
    """`Result.data` is PNG bytes. Never raises.

    ⚠️ `render_house_chart` already collapses five distinct failures to `None` — non-2xx, a non-PNG
    body, too few drawn bars, a blank image, and any exception. This adapter cannot recover what the
    layer below discarded; it reports `EMPTY` and says so. Splitting those five is 2.3 renderer work
    (the `/health` keys exist for it), not something to fake here from a `None`."""
    if house_fn is None:
        from api.services.discord_chart_house import render_house_chart as house_fn  # noqa: N813

    outcome = _call.guarded(
        NAME, lambda _timeout_s: house_fn(req.ticker, req.tf, req.stats, dict(req.options)),
        dep_timeout_s=TIMEOUT_S, remaining_s=req.remaining_s, corr_id=req.corr_id,
        attempts=ATTEMPTS, provider=NAME)
    if _call.is_result(outcome):
        return outcome
    png, elapsed_ms = outcome

    if png is None:
        return fail(EMPTY, provider=NAME, corr_id=req.corr_id, elapsed_ms=elapsed_ms,
                    ticker=req.ticker, tf=req.tf,
                    note="house render returned None: 5xx, non-PNG, blank, too few bars, or an error")
    if not isinstance(png, (bytes, bytearray)) or not bytes(png).startswith(PNG_MAGIC):
        return fail(BAD_SHAPE, provider=NAME, corr_id=req.corr_id, elapsed_ms=elapsed_ms,
                    got=type(png).__name__, size=len(png) if hasattr(png, "__len__") else None)
    return ok(bytes(png), provider=NAME, corr_id=req.corr_id, elapsed_ms=elapsed_ms,
              envelope=req.envelope, bytes_len=len(png), ticker=req.ticker, tf=req.tf)
