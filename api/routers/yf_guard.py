"""Read-only status endpoint for the shared yfinance guard + circuit breaker.

`yf_util.guard_status()` and `yfinance_pool.pool_status()` were both already
written and correct — and referenced by nothing in `api/routers/**` or
`api/main.py`, so the breaker's state could not be read from outside the pod.
This is the door.

Why it matters: the breaker, once open, returns every caller's default
"WITHOUT touching the network and WITHOUT logging" (`yf_util`'s own docstring).
That is right at runtime and blind for diagnosis — a parked-open breaker and a
provider that genuinely has no data look identical from the payload. On
2026-08-10 expected-move read 0% on every upcoming earnings date in production
while the same function returned correct live marks on a dev box, and the one
pair of numbers that settles it (`suppressed_total` vs `calls_total`) had no
way out of the process.

Mirrors `/api/admin/reconciliation-status`, `/api/admin/fundamentals-health`
and `/api/admin/provider-coverage` — intentionally NO auth, per the documented
convention for read-only ops dashboards (see `api/middleware/admin_guard.py`'s
module docstring, which names those endpoints as deliberately anonymous). It
publishes counters and capacity only: no keys, no symbols, no user data.
"""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/api/admin/yfinance-guard")
def yfinance_guard_status():
    """Shared yfinance pool + breaker state (no auth — read-only).

    `breaker_open` true means every yfinance call in this process is currently
    short-circuited to its default. The pair to read together is
    `suppressed_total` (short-circuited, never reached the network) against
    `calls_total` (reached the pool): a rising suppressed count beside a flat
    calls count is the breaker eating the work, NOT an empty provider.
    `cooldown_seconds_remaining` is derived — the underlying deadline is a
    `time.monotonic()` value and is deliberately never published, because it is
    meaningless outside this process and subtracting it from a wall clock
    produces a plausible wrong answer.
    """
    from api.services.yfinance_pool import pool_status
    return pool_status()
