"""D12 family: GEX / dealer gamma — a NAMED GAP on the web pod, by design.

What was tried (static analysis, no call made from capture). ⚠️ The first two
points were written when ``gex_service`` could read Schwab's chain. Schwab was
retired from the product on 2026-11-17 and the chain is Massive's now, so those
two no longer hold; the gap itself has NOT been re-decided and stays as it was.

* (no longer true) ``api/gex_service.get_gex_data`` reached the Schwab client's
  ``_CHAIN_SEMAPHORE`` / ``_TOKEN_REFRESH_LOCK``, module-level asyncio
  primitives that bind to the FIRST event loop that awaits them, so a scheduler
  thread calling it through ``asyncio.run`` got "attached to a different loop".
* (no longer true) web and flow-worker each refreshed their own Schwab token.
* ``adjusted=True`` reads dealer_positioning from web's FROZEN pre-cutover
  flow.db, so it would archive stale numbers.
* ``/api/dealer-positioning/*`` is reachable only through ``api/flow_proxy``,
  which needs a signed USER vouch (``flow_admin_auth.proxy_sign_user``) — a
  capture job has no user and must not forge one — and its ``/sample`` route
  caps at 100 contract rows, which is not a GEX.

The flow-worker alternative, costed: a flow-worker job at ~16:20 ET calling
``get_gex_data(ticker, adjusted=False)`` on flow-worker's own loop for SPY, QQQ,
IWM and the top ~20 actives = ~23 option-chain reads per session (costed against
Schwab's limits at the time; the chain is Massive's now), ~150-400 KB
gzipped a day, writing through core.r2 from that pod. It needs an edit to a
flow-worker-watched file, and a flow-worker deploy drops the Massive OPRA socket
(a PERMANENT tape gap until the T+1 flat file), so it ships after hours with the
flow owner's ack. That is W2 work, not W1.
"""
from __future__ import annotations

from api.services.wisdom.capture.families._base import safe_reader, session_of, to_date, unavailable

FAMILY = "gex"
SOURCE = "none on web (the gap was decided before the option chain moved to Massive and has not been re-decided)"
GAP_REASON = (
    "not captured on web: this gap was decided when gex_service.get_gex_data could read an option chain "
    "through loop-bound asyncio primitives (a scheduler-thread asyncio.run failed 'attached to a different loop'); that reader was retired on "
    "2026-11-17 (the chain is Massive's now) and the gap has not been re-decided; adjusted=True reads web's frozen "
    "flow.db; the dealer-positioning proxy needs a signed user vouch and /sample caps at 100 rows. "
    "Alternative: a flow-worker 16:20 ET job, ~23 option-chain reads/session, "
    "~150-400 KB gz/day, needs an after-hours flow-worker deploy (OPRA tape gap) with the flow owner's ack."
)
ALTERNATIVE = {
    "where": "flow-worker, its own event loop",
    "calls_per_session": 23,
    "tickers": "SPY, QQQ, IWM + top ~20 actives",
    "vendor_cost_usd": 0,
    "estimated_gz_bytes_per_day": [150_000, 400_000],
    "deploy_cost": "a flow-worker-watched file edit; the deploy drops the Massive OPRA socket (permanent tape gap)",
}


@safe_reader(FAMILY, SOURCE)
def read(*, as_of=None, now_et, state=None, **_) -> dict:
    session = to_date(as_of) or session_of(now_et)
    return unavailable(FAMILY, as_of=session, source=SOURCE, gap="gex_not_on_web", reason=GAP_REASON,
                       meta={"alternative": ALTERNATIVE})
