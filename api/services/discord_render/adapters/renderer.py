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


def _with_vintage(options: dict, envelope: Envelope | None) -> dict:
    """The render options, plus the vintage the page needs to stamp instead of a wall clock (C-07).

    ⛔⛔ THIS IS C-07'S PRODUCER, AND WITHOUT IT THE WHOLE CHAIN IS BUILT AND WIRED TO NOTHING.
    `build_render_url` emits `?stale=` only when the options carry a vintage, and `badge.vintage_param`
    turns that into the one sentence the page draws — but *something* has to put the verdict in the
    options, and nothing did. That is this repo's most-repeated defect shape, and the lane that built
    the chain said so in its own report rather than letting it be discovered later.

    ⭐ THE V2 PATH IS THE ONLY PRODUCER, ON PURPOSE. The envelope exists only here: the bars adapter
    derives it and `bindings.house_fn` carries it onto the render request. The pre-V2 path has no
    envelope to pass, so it passes neither key and its URL stays byte-for-byte what it was — which
    is why the producer belongs in the adapter and not in `produce_chart`'s `house_opts`.

    ⛔ AND IT NEVER OVERWRITES A CALLER'S OWN KEYS. A direct caller that already decided the vintage
    keeps it; a second authority over one value is the defect this whole chain was built to remove.
    """
    if envelope is None:
        return dict(options or {})
    out = dict(options or {})
    # ⛔ `in`, NOT `.get(...) is None` — `stale` is TRI-STATE, so a caller's deliberate `None`
    # (we could not tell) is a real answer and must not be replaced by ours. `setdefault` happens
    # to behave identically here (measured: it does not overwrite an explicit `None`), and the
    # explicit membership test is kept only because it says out loud which question is being
    # asked. ⚰️ An earlier version of this comment claimed `setdefault` was WRONG here. It is not,
    # and a comment asserting a mechanism that does not exist is the defect this file's own
    # docstrings keep warning about — so it is corrected rather than quietly deleted.
    if "stale" not in out:
        out["stale"] = envelope.stale
    if "as_of" not in out and envelope.as_of_et:
        out["as_of"] = envelope.as_of_et
    return out


def fetch(req: RenderRequest, *, house_fn=None) -> Result:
    """`Result.data` is PNG bytes. Never raises.

    ⚠️ `render_house_chart` already collapses five distinct failures to `None` — non-2xx, a non-PNG
    body, too few drawn bars, a blank image, and any exception. This adapter cannot recover what the
    layer below discarded; it reports `EMPTY` and says so. Splitting those five is 2.3 renderer work
    (the `/health` keys exist for it), not something to fake here from a `None`."""
    if house_fn is None:
        from api.services.discord_chart_house import render_house_chart as house_fn  # noqa: N813

    options = _with_vintage(req.options, req.envelope)
    outcome = _call.guarded(
        NAME, lambda _timeout_s: house_fn(req.ticker, req.tf, req.stats, dict(options)),
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
