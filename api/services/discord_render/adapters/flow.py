"""The flow adapter — options flow for `/flow`, with the fallback order in ONE place (03 §3.8).

The order, and it is the whole reason this module exists:

  1. **flow-worker over HTTP** (`WORKER_INTERNAL_URL`) — the service that owns the OPRA tape.
  2. **in-process** (`live_massive_router._compute_ticker_flow`) — web's own copy, correct but slow,
     used only when the remote leg is unavailable AND there is budget left to try.
  3. **neither** — a named class the caller turns into one honest sentence.

⛔⛔ "THE FLOW FEED IS RECONNECTING" IS RETIRED, AND THIS IS WHERE IT DIED (C-08). That sentence was
the reply for a timeout, a transport error, a 5xx, AND an `ok:false` body — four causes, three of
which are not a reconnect. The member could not act on it and neither could we, because nothing
counted which one it was. Every path out of `fetch` carries a class from the taxonomy.

⛔ THE IN-PROCESS LEG IS NOT FREE AND IS NOT AUTOMATIC. It runs the whole computation on a `web`
worker thread — the pod that also has to answer Discord in three seconds (C-02). It is attempted
only when the remote leg failed for a reason a retry cannot fix (no URL, transport, 5xx), never on a
timeout: a timeout means we are already out of time, and spending the rest of the budget on the
slower of the two is how a degraded answer becomes no answer.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

from api.services.discord_render.adapters import _call
from api.services.discord_render.adapters.result import (
    BAD_SHAPE, EMPTY, TIMEOUT, UPSTREAM_ERROR, Result, fail, ok,
)
from api.services.discord_render.freshness import envelope

NAME = "flow"
TIMEOUT_S = 10.0         # §3.8: flow-worker 10 s
CONNECT_TIMEOUT_S = 2.0  # §3.8: connect 2 s — a dead pod must not spend the whole budget connecting
ATTEMPTS = 1
#: The remote leg must leave at least this much budget for the in-process leg to be worth starting.
LOCAL_MIN_S = 3.0


@dataclass(frozen=True)
class FlowRequest:
    ticker: str
    days: str = "1"
    #: `stocks` | `etfs` — the partition `symbols.flow_source` chose (C-14).
    source: str = "stocks"
    top_n: int = 15
    corr_id: str | None = None
    remaining_s: float | None = None


def _remote(ticker: str, days: str, source: str, timeout_s: float):
    """flow-worker over HTTP. Raises on anything that is not a usable body — the spine names it."""
    import httpx
    base = (os.environ.get("WORKER_INTERNAL_URL") or "").rstrip("/")
    if not base:
        raise LookupError("WORKER_INTERNAL_URL is unset")
    r = httpx.get(f"{base}/api/live/massive/ticker-flow",
                  params={"symbol": ticker, "days": days, "source": source},
                  timeout=httpx.Timeout(timeout_s, connect=min(CONNECT_TIMEOUT_S, timeout_s)))
    r.raise_for_status()
    return r.json()


def _local(ticker: str, days: str, source: str, top_n: int):
    from api import live_massive_router as lmr
    return lmr._compute_ticker_flow(ticker, days, source, top_n)


def _stamp(data: dict, provider: str):
    """The vintage is `window.end` — the newest date any contract actually printed on.

    ⛔ NOT `query_date`, which the payload also carries. That is the wall clock of the request, so a
    card built from Friday's tape at Sunday noon would stamp itself Sunday and read as live. The
    distinction is the whole of §3.10."""
    end = ((data.get("window") or {}) if isinstance(data, dict) else {}).get("end")
    return envelope(end, tf="D", provider=provider) if end else None


def _client_timeouts() -> tuple:
    """The client's own timeout exceptions, so they are classed as `TIMEOUT` rather than as a
    transport failure. ⛔ This decides whether the in-process leg runs at all: unreachable is worth a
    second try, a timeout means the budget is already spent."""
    try:
        import httpx
        return (httpx.TimeoutException,)
    except Exception:  # noqa: BLE001 — httpx missing is not this function's problem to report
        return ()


def _unreachable() -> tuple:
    """Could-not-reach-it, as opposed to it-answered-with-an-error. `httpx.TransportError` covers
    connect, read, DNS and pool failures; `LookupError` is our own "no WORKER_INTERNAL_URL", which is
    the same fact — there is no service to talk to. ⛔ `HTTPStatusError` is deliberately NOT here: a
    5xx means flow-worker ANSWERED, and web's in-process copy would very likely answer the same."""
    try:
        import httpx
        return (httpx.TransportError, ConnectionError, LookupError)
    except Exception:  # noqa: BLE001
        return (ConnectionError, LookupError)


def fetch(req: FlowRequest, *, remote=_remote, local=_local) -> Result:
    """`Result.data` is the flow dict (`net`, `window`, `contracts`, …). Never raises."""
    outcome = _call.guarded(
        NAME, lambda timeout_s: remote(req.ticker, req.days, req.source, timeout_s),
        dep_timeout_s=TIMEOUT_S, remaining_s=req.remaining_s, corr_id=req.corr_id,
        attempts=ATTEMPTS, provider="flow_worker", timeout_on=_client_timeouts(),
        unreachable_on=_unreachable())
    if not _call.is_result(outcome):
        data, elapsed_ms = outcome
        return _finish(req, data, "flow_worker", elapsed_ms)

    remote_failure: Result = outcome
    if not _local_is_worth_trying(remote_failure, req):
        return remote_failure

    left = None if req.remaining_s is None else req.remaining_s - (remote_failure.elapsed_ms or 0) / 1000.0
    local_outcome = _call.guarded(
        "flow_local", lambda _timeout_s: local(req.ticker, req.days, req.source, req.top_n),
        dep_timeout_s=TIMEOUT_S, remaining_s=left, corr_id=req.corr_id, attempts=1,
        provider="in_process")
    if _call.is_result(local_outcome):
        # ⛔ BOTH LEGS FAILED — report the REMOTE class. It is the one an operator acts on; the local
        # leg failing afterwards is a consequence of the same outage, and reporting IT would point
        # the next person at `web` when the thing that is down is flow-worker.
        return remote_failure
    data, local_ms = local_outcome
    done = _finish(req, data, "in_process", (remote_failure.elapsed_ms or 0) + local_ms)
    # A served fallback is a DEGRADED delivery, not a clean one: it carries why the first leg failed.
    return done.with_reason(*remote_failure.degraded_reasons) if done.ok else done


def _local_is_worth_trying(remote_failure: Result, req: FlowRequest) -> bool:
    """⛔ THE FALLBACK IS CONDITIONAL, AND EVERY CONDITION IS A SEPARATE REASON.

    * A `TIMEOUT` or a `DEADLINE` means the budget is already gone. The in-process leg is the
      SLOWER of the two; starting it turns a degraded answer into no answer at all.
    * `EMPTY` and `BAD_SHAPE` never reach here — the remote leg answered, and asking a second
      source for a different answer to the same question is how two callers get two truths.
    * Below `LOCAL_MIN_S` there is not enough left to finish, and a computation abandoned halfway
      still costs `web` the whole thread (C-02)."""
    from api.services.discord_render.adapters.result import BREAKER_OPEN, DEADLINE, UNREACHABLE
    if remote_failure.reason() not in (UNREACHABLE, BREAKER_OPEN):
        return False
    if remote_failure.reason() in (TIMEOUT, DEADLINE):      # defensive: the set above already excludes them
        return False
    if req.remaining_s is None:
        return True
    left = req.remaining_s - (remote_failure.elapsed_ms or 0) / 1000.0
    return left >= LOCAL_MIN_S


def _finish(req: FlowRequest, data, provider: str, elapsed_ms: float) -> Result:
    if not isinstance(data, dict):
        return fail(BAD_SHAPE, provider=provider, corr_id=req.corr_id, elapsed_ms=elapsed_ms,
                    got=type(data).__name__)
    if not data.get("ok"):
        # ⛔ `ok: false` is the upstream ANSWERING with a refusal — a different fact from it being
        # unreachable, and the reply copy differs. C-08 merged them.
        return fail(UPSTREAM_ERROR, provider=provider, corr_id=req.corr_id, elapsed_ms=elapsed_ms,
                    upstream_error=str(data.get("error") or "ok:false")[:120])
    # ⛔ AN EMPTY TAPE IS AN ANSWER, NOT A FAILURE. A quiet session with no significant options flow
    # is a correct, useful reply, and the router already has the sentence for it ("no significant
    # options flow {window}"). Classing it as `EMPTY` here would turn a true answer into a failure
    # message, put it in the failure counters, and lose the window phrase the sentence needs — which
    # is the C-08 mistake pointed the other way: not four causes made one, but one non-cause made a
    # cause. `contract_count == 0` is how the caller tells.
    return ok(data, provider=provider, corr_id=req.corr_id, elapsed_ms=elapsed_ms,
              envelope=_stamp(data, provider), ticker=req.ticker, source=req.source,
              contract_count=len(data.get("contracts") or []))
