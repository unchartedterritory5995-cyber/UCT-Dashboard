"""The bars adapter — price bars, with a vintage the rest of the path can read (03 §3.8).

⛔ THE BARS PAYLOAD CARRIES NO `as_of` AND NO PROVIDER. Measured 2026-09-13: `/api/bars` answers
`{"ticker", "tf", "bars": [...]}` and nothing else; the serve layer exists only as an HTTP
`Server-Timing` header that the in-process wrapper discards. So the vintage is derived HERE, once,
from the newest bar's `t` — which `freshness._parse` already reads in both shapes the store uses
(`YYYY-MM-DD` for D/W/M, unix seconds for intraday) — and the provider is read from
`bars_fetch.get_serve_layer()`. Every caller then reads one envelope instead of re-deriving it, which
is the second-authority defect this repo has paid for three times in a week.

⚠️ THE 1.5-SECOND FIXED RETRY IS **NOT** GONE, AND SAYING SO WOULD BE THE FALSE-DOCSTRING DEFECT
THIS PROGRAMME KEEPS PAYING FOR. `discord_interactions.BARS_RETRY_DELAY_S = 1.5` still sits in
`produce_chart._fetch`, which loops twice around whatever `bars_fn` it was handed — the exact
re-synchronising delay `breakers.retry_delay` was written to replace, because every caller that
failed together retries together and the storm arrives in one spike.

What this adapter does about it TODAY is refuse to multiply with it: `bindings` passes `attempts=1`,
so a chart still makes two bars fetches and not four (OI-25). The jittered retry here is real and
proved, and it is what a DIRECT caller gets; the hot path cannot use it until the caller's loop is
deleted, and that is a pre-V2 file and therefore 2.8's, not P2.1's.
"""
from __future__ import annotations

from dataclasses import dataclass

from api.services.discord_render.adapters import _call
from api.services.discord_render.adapters.result import BAD_SHAPE, EMPTY, Result, ok
from api.services.discord_render.freshness import envelope

NAME = "bars"
#: §3.8: bars 8 s. The job's remaining budget can only make this smaller (`_call.budget`).
TIMEOUT_S = 8.0
#: One retry, jittered. Two attempts is the measured shape: the bars path's failures are transient
#: far more often than not, and a third attempt cannot fit inside a 15 s deadline beside a render.
ATTEMPTS = 2


@dataclass(frozen=True)
class BarsRequest:
    ticker: str
    tf: str = "D"
    n: int = 200
    corr_id: str | None = None
    #: The JOB's remaining seconds. None means "no deadline" — a warm or a probe, never a member.
    remaining_s: float | None = None
    #: Override `ATTEMPTS`. ⛔ `bindings` passes **1** on purpose (OI-25): `produce_chart._fetch`
    #: already loops twice around `bars_fn` with a fixed 1.5 s wait, so retrying here as well would
    #: make FOUR fetches and sleep ~2.9 s inside a 15 s deadline. Two layers, each individually
    #: correct; only the composition is wrong. Moving the loop into this adapter means deleting the
    #: caller's, which is a pre-V2 file and therefore a member-visible change — that is 2.8's.
    attempts: int | None = None


def _serve_layer() -> str:
    """Which layer answered — `memory` / `disk` / `sqlite` / `provider`. Never raises: provenance is
    useful, and losing it must not lose the bars."""
    try:
        from api.services.bars_fetch import get_serve_layer
        return str(get_serve_layer() or "bars") or "bars"
    except Exception:  # noqa: BLE001
        return "bars"


def fetch(req: BarsRequest, *, fetch_fn=None) -> Result:
    """`Result.data` is `list[dict]` of `{t,o,h,l,c,v}`, newest last. Never raises."""
    if fetch_fn is None:
        from api.routers.discord_interactions import fetch_bars as fetch_fn  # noqa: N813

    outcome = _call.guarded(
        NAME, lambda _timeout_s: fetch_fn(req.ticker, req.tf, req.n),
        dep_timeout_s=TIMEOUT_S, remaining_s=req.remaining_s, corr_id=req.corr_id,
        attempts=(ATTEMPTS if req.attempts is None else max(1, int(req.attempts))), provider=NAME)
    if _call.is_result(outcome):
        return outcome
    bars, elapsed_ms = outcome

    provider = _serve_layer()
    if bars is None or bars == []:
        # ⛔ EMPTY IS NOT AN ERROR AND NOT A SUCCESS. `/api/bars` answers 200 with an empty list for a
        # symbol it does not carry; the member needs "we have no data for that", not "it broke".
        from api.services.discord_render.adapters.result import fail
        return fail(EMPTY, provider=provider, corr_id=req.corr_id, elapsed_ms=elapsed_ms,
                    ticker=req.ticker, tf=req.tf)
    if not isinstance(bars, list) or not isinstance(bars[-1], dict) or "t" not in bars[-1]:
        from api.services.discord_render.adapters.result import fail
        return fail(BAD_SHAPE, provider=provider, corr_id=req.corr_id, elapsed_ms=elapsed_ms,
                    got=type(bars).__name__)

    return ok(bars, provider=provider, corr_id=req.corr_id, elapsed_ms=elapsed_ms,
              envelope=envelope(bars[-1]["t"], tf=req.tf, provider=provider),
              bar_count=len(bars), ticker=req.ticker, tf=req.tf)
