"""The quote adapter — the extended-hours price chip (03 §3.8).

⚠️ **KNOWN LIMITATION, RECORDED RATHER THAN HIDDEN (OI-22).** Three layers below this one already
collapse "there is no extended-hours print" into "the lookup failed": `massive` returns `{}` on any
exception, `fetch_ext_quote` catches `Exception` and returns `None`, and the call site catches again.
So `EMPTY` here covers both, and a quote outage is invisible to the breaker — it looks like a quiet
overnight. Distinguishing them means changing `fetch_ext_quote` to raise, which is a behaviour change
on the pre-V2 path and therefore belongs to 2.8, not here.

⭐ The adapter is still worth having for this upstream: it is the one place a quote call is now
BOUNDED (§3.8: 1.5 s, and less when the job is nearly out of time). It had no timeout of any kind —
whatever the client's default is, on the path that has to answer Discord in three seconds.
"""
from __future__ import annotations

from dataclasses import dataclass

from api.services.discord_render.adapters import _call
from api.services.discord_render.adapters.result import BAD_SHAPE, EMPTY, Result, fail, ok

NAME = "quote"
TIMEOUT_S = 1.5          # §3.8
ATTEMPTS = 1             # a chip is decoration; a member waits for the chart, not for this


@dataclass(frozen=True)
class QuoteRequest:
    ticker: str
    corr_id: str | None = None
    remaining_s: float | None = None
    #: Override `ATTEMPTS`. ⛔ Every binding site states its own number; an attempt count
    #: that is right by INHERITANCE is right by luck, and C-10's overrun reached production
    #: unnoticed only because one site happened to pass 1 for an unrelated reason (OI-25/29).
    attempts: int | None = None


def fetch(req: QuoteRequest, *, quote_fn=None) -> Result:
    """`Result.data` is `(session_word, price)` — `('pre'|'post', float)`. Never raises.

    ⛔ NO ENVELOPE. The upstream returns no timestamp at all, so the vintage is genuinely unknown and
    `stale` stays `None`. It is NOT stamped with the wall clock: a chip that claims to be current
    because we asked for it just now is a lie with a number on it."""
    if quote_fn is None:
        from api.routers.discord_interactions import fetch_ext_quote as quote_fn  # noqa: N813

    outcome = _call.guarded(NAME, lambda _timeout_s: quote_fn(req.ticker),
                            dep_timeout_s=TIMEOUT_S, remaining_s=req.remaining_s,
                            corr_id=req.corr_id, provider="massive",
                            attempts=(ATTEMPTS if req.attempts is None
                                      else max(1, int(req.attempts))))
    if _call.is_result(outcome):
        return outcome
    quote, elapsed_ms = outcome

    if quote is None:
        return fail(EMPTY, provider="massive", corr_id=req.corr_id, elapsed_ms=elapsed_ms,
                    ticker=req.ticker, note="no ext print, or a swallowed failure (OI-22)")
    try:
        session, price = quote
        price = float(price)
    except (TypeError, ValueError):
        return fail(BAD_SHAPE, provider="massive", corr_id=req.corr_id, elapsed_ms=elapsed_ms,
                    got=type(quote).__name__)
    return ok((str(session), price), provider="massive", corr_id=req.corr_id,
              elapsed_ms=elapsed_ms, ticker=req.ticker, ext_session=str(session))
