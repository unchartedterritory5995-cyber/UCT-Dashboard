"""The entity adapter — symbol resolution over the app's seven authorities (03 §3.8, 2.4a).

`symbols.resolve` already composes the authorities in one place and already fails OPEN: an authority
that cannot answer is not a "no". This adapter adds the two things the ack path did not have:

  * a **bound** — `min(0.6 s, the job's remaining time)`, instead of a budget the caller had to
    remember to apply (`commands.SYMBOL_BUDGET_S` is applied at exactly one of the call sites);
  * a **provider** in the Result: which of the seven answered, so a refusal can be explained
    ("not in the bars store" is a different conversation from "the search index was not ready").

⛔ FAILING OPEN IS PRESERVED AND IS NOT A BUG. `UNANSWERABLE` comes back as a SUCCESSFUL Result whose
data says "we could not tell" — because refusing a member's real ticker because our index was cold is
a worse outcome than rendering a chart for a symbol we could not pre-confirm. `/api/bars` is the
backstop and it answers honestly. An adapter that turned this into `ok=False` would invert the
policy, silently, on the one path where over-refusal is invisible
(`lesson_an_over_refusal_is_invisible`).
"""
from __future__ import annotations

from dataclasses import dataclass

from api.services.discord_render.adapters import _call
from api.services.discord_render.adapters.result import NOT_CARRIED, Result, fail, ok

NAME = "entity"
#: Matches `commands.SYMBOL_BUDGET_S` — this is the ack path, where the whole reply must be inside 3 s.
TIMEOUT_S = 0.6
ATTEMPTS = 1


@dataclass(frozen=True)
class EntityRequest:
    ticker: str
    corr_id: str | None = None
    remaining_s: float | None = None
    suggest: bool = True


def fetch(req: EntityRequest, *, resolve_fn=None) -> Result:
    """`Result.data` is a `symbols.Resolution`. Never raises.

    `ok=True` for KNOWN and for UNANSWERABLE (fail open, above). `ok=False` with `NOT_CARRIED` only
    for UNKNOWN — the one verdict that means every authority answered and none of them had it."""
    from api.services.discord_render import symbols
    if resolve_fn is None:
        resolve_fn = symbols.resolve

    outcome = _call.guarded(
        NAME, lambda _timeout_s: resolve_fn(req.ticker, suggest=req.suggest),
        dep_timeout_s=TIMEOUT_S, remaining_s=req.remaining_s, corr_id=req.corr_id,
        attempts=ATTEMPTS, provider=NAME)
    if _call.is_result(outcome):
        # ⛔ EVEN A FAILURE FAILS OPEN HERE. A timed-out or breakered symbol check must not refuse a
        # member's ticker — it must say "we could not tell", which is what UNANSWERABLE means.
        return ok(symbols.Resolution(req.ticker.strip().upper(), symbols.UNANSWERABLE),
                  provider=NAME, corr_id=req.corr_id, elapsed_ms=outcome.elapsed_ms,
                  why=outcome.reason())
    res, elapsed_ms = outcome

    if getattr(res, "status", None) == symbols.UNKNOWN:
        return fail(NOT_CARRIED, provider=NAME, corr_id=req.corr_id, elapsed_ms=elapsed_ms,
                    ticker=res.symbol, suggestions=",".join(res.suggestions) or None)
    return ok(res, provider=res.authority or NAME, corr_id=req.corr_id, elapsed_ms=elapsed_ms,
              status=res.status, authority=res.authority)
