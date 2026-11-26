"""bars_auth.py — the ONE entitlement gate for the chart-data HTTP surface.

WHY THIS FILE EXISTS
--------------------
`/api/bars` grew into a data API. The 2026-09-13 audit measured it answering an
anonymous caller with AAPL, QQQ, ^IXIC and — the part that made it a release
blocker — `UCTA50`, UCT's own breadth output, enumerable first through an
equally open `/api/breadth-symbols`. Charts are paid functionality
(`AuthGuard.jsx`: "ONLY Morning Wire is accessible without a paid plan", owner
decision 2026-07-19), so the data behind them is paid too. Protect the resource,
not the page that happens to display it.

⛔⛔ AND THERE ARE **TWO** PUBLIC DOORS INTO THIS DATA, WHICH IS THE WHOLE REASON
THIS IS A MODULE AND NOT A `Depends` TYPED INTO ONE ROUTER.
`api/bars_api_main.py` is a SECOND FastAPI app — the dedicated bars-serving tier
— and Railway serves it at a PUBLIC domain
(`bars-api-production-1052.up.railway.app`) as well as on private networking. It
runs the same `serve_bars` core over the same bars.db. A gate on the web pod
alone would have been a gate on one of two doors.

THE TWO DOORS NEED TWO DIFFERENT ANSWERS, AND THAT IS NOT A COMPROMISE
---------------------------------------------------------------------
  * WEB POD — has `auth.db`, and its callers are browsers carrying `uct_session`.
    So it answers the MEMBER question: `require_bars_access`.
  * BARS TIER — has NO `auth.db` (it installs bars.db from R2 and nothing else),
    and **no browser ever calls it**: `app/src` contains no absolute bars host,
    every frontend read is same-origin, and the web pod reaches the tier
    server-to-server with `httpx`, forwarding query params only — no cookies. A
    cookie could not reach it anyway; the Railway domain is a different
    registrable domain than the app's, so no browser would send one.
    So it answers the SERVICE question: `require_bars_service`.

⭐ THIS SHAPE IS THE REPO'S OWN, NOT A NEW IDEA. `flow_admin_auth.py` solved the
identical problem for flow-worker ("auth.db lives ONLY on web"): a shared bearer
for service callers, and the pod that HAS the user table doing the user check.
The HMAC user-vouch half of that module is deliberately NOT copied here — the
tier needs to know *whether the caller is trusted*, never *which member is
asking*, because a bar series is not user-scoped. The smaller mechanism is the
correct one.

⚠️ FAILURE MODE, ON PURPOSE: if `PUSH_SECRET` is unset or wrong on the tier,
`require_bars_service` refuses EVERYTHING — and charts keep working anyway,
because `get_bars` falls back to the web pod's own local serve whenever the
proxy does not return a usable answer. Misconfiguring this gate costs a
performance tier, never a chart.
"""
from __future__ import annotations

from typing import Optional

from fastapi import Cookie, Header, HTTPException, Request

# ⛔ IMPORTED, NEVER RESTATED. `_push_secret_ok` is a constant-time compare with
# a deliberately non-constant-time "is a secret configured at all" guard, and its
# reasoning is written down where it lives. A second copy of a secret comparison
# is exactly the kind of thing that drifts into `==` during a refactor.
from api.flow_admin_auth import _push_secret_ok
from api.middleware.auth_middleware import PAID_PLANS, meets_plan_gate
from api.services.auth_service import get_user_plan, validate_session

#: What a logged-in member without entitlement is told. One sentence, this
#: surface's own, matching the per-router convention `analyst.py` documents.
UPGRADE_DETAIL = "Chart data requires a paid plan"

#: The header an internal/service caller presents. Named so the two prewarm
#: sweeps and the web→tier proxy cannot spell it three ways.
_BEARER_HEADER = "Authorization"


def bars_service_headers() -> dict:
    """The headers a TRUSTED SERVER-SIDE caller sends to a chart-data route.

    ⭐ FOR THE CALLERS THE AUDIT FOUND, and it found more than the first pass
    expected: `cot_prewarm` reaches `/api/bars` over LOOPBACK HTTP (not
    in-process, as had been assumed), and `history_prewarm` sweeps
    `/api/bars-history` through Cloudflare. Both are trusted server code with no
    member session to present, and both would simply have started 401-ing.

    ⚠️ EMPTY WHEN NO SECRET IS CONFIGURED, rather than sending `Bearer `. An
    empty bearer is a credential that cannot succeed, and sending one would make
    "not configured" look like "rejected" in every log it touches.
    """
    import os
    secret = (os.environ.get("PUSH_SECRET") or "").strip()
    return {_BEARER_HEADER: f"Bearer {secret}"} if secret else {}


def require_bars_access(uct_session: Optional[str] = Cookie(None),
                        authorization: str = Header(default="")) -> dict:
    """THE gate for chart-data routes on the WEB pod: a paid member, or a
    trusted service caller.

    ⭐ ENTITLEMENT IS `meets_plan_gate`, NOT A SECOND PLAN PREDICATE. That
    function is the repo's stated membership rule — admin, an allowed plan,
    `comped`, or an active trial — and its docstring is explicit that any caller
    resolving its own user "must call THIS function directly rather than
    re-deriving the rule". Which matters here beyond tidiness: the two shipped
    paid families genuinely DISAGREE about `comped`
    (`test_the_two_paid_gate_families_DISAGREE_about_comped` pins it), and the
    owner's policy for chart data names comped and trial as ALLOWED. So this
    surface takes the `require_plan`/`meets_plan_gate` family deliberately, and
    answers 403 the way that family does — rather than `require_paid`'s 402,
    which would refuse a comped account.

    ⛔ 401 AND 403 ARE DIFFERENT ANSWERS AND THE FRONTEND READS BOTH. 401 is
    "you are not signed in"; 403 is "you are, and this plan does not include
    chart data". Collapsing them would leave a member with an expired session and
    a free member looking identical to the one surface that has to tell them
    apart.
    """
    if _push_secret_ok(authorization):
        return {"via": "push_secret"}
    user = validate_session(uct_session)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    # `meets_plan_gate` reads `user["plan"]`; `validate_session` does not set it.
    user["plan"] = get_user_plan(user["id"])
    if not meets_plan_gate(user, list(PAID_PLANS)):
        raise HTTPException(status_code=403, detail=UPGRADE_DETAIL)
    return user


# ⭐ (2026-11-25) THE SAME GATE, RUN ON A ROUTE'S OWN THREAD LIMITER, AND HOW THE AUDITORS STILL SEE IT.
# `require_bars_access` is sync, so FastAPI runs it on anyio's DEFAULT thread pool, the one every sync route
# shares; a route that must never queue there (`/api/bars-history`, #2741) runs the gate in a thread on its own
# limiter instead. The gate is then CALLED, not `Depends`-ed, so it is absent from the route's dependency tree,
# which is what both auth auditors read (`api/auth_surface_check.py`, `tests/test_exposed_routes_gated.py`):
# master went red on them with #2741. So the wrapper is built HERE, by one factory that records what it built,
# and the auditors count a product by IDENTITY (`is_bars_access_on_limiter`), never by a name: a function merely
# called `require_bars_access_*` stays an open route in their eyes.
# ⛔ THE FACTORY CALLS THE GATE ITSELF (review of #2757, H1). A caller gives a LIMITER, never a function that
# runs the gate, so a product cannot skip the gate or swallow its 401/403: identity means "calls the gate" on
# every app, measured or not. `test_exposed_routes_gated` still awaits every product the served app carries
# with free, paid and admin callers. The products live in a frozenset only the factory rebuilds, so nothing can
# append itself to the whitelist.
_PRODUCTS: frozenset = frozenset()


def _takes_parameters(fn) -> bool:
    import inspect
    try:
        return bool(inspect.signature(fn).parameters)
    except (TypeError, ValueError):
        return True


def require_bars_access_on(limiter, name: str, on_wait=None):
    """`require_bars_access` as an async dependency named `name` that calls the gate in a thread on
    `limiter(request)` (an anyio CapacityLimiter: the route's own, one per event loop). `on_wait(request, ms)`,
    if given, is told how long the gate waited for a thread. A gate answer of None (it never returns one) is
    refused 401.

    An app's `dependency_overrides[require_bars_access]` (tests) still applies: it is the same gate, so the
    override is honoured here. It is called BARE, as FastAPI never would, so an override with parameters is
    refused with a 500 rather than handed its `Cookie()`/`Header()` default objects."""
    async def gate(request: Request, uct_session: Optional[str] = Cookie(None),
                   authorization: str = Header(default="")) -> dict:
        over = getattr(getattr(request, "app", None), "dependency_overrides", {}).get(require_bars_access)
        if over is not None:
            if _takes_parameters(over):
                raise HTTPException(status_code=500,
                                    detail="a require_bars_access override used here must take no parameters")
            out = over()
            return await out if hasattr(out, "__await__") else out
        import time
        import anyio
        t0 = time.perf_counter()
        waited = [0.0]

        def ask():
            waited[0] = (time.perf_counter() - t0) * 1000.0
            return require_bars_access(uct_session, authorization)
        user = await anyio.to_thread.run_sync(ask, limiter=limiter(request))
        if on_wait is not None:
            try:
                on_wait(request, waited[0])
            except Exception:                  # noqa: BLE001 - a timing note never decides access
                pass
        if user is None:
            raise HTTPException(status_code=401, detail="Not authenticated")
        return user

    global _PRODUCTS
    gate.__name__ = gate.__qualname__ = name
    _PRODUCTS = _PRODUCTS | {gate}
    return gate


def is_bars_access_on_limiter(call) -> bool:
    """True only for a dependency `require_bars_access_on` built (identity, never a name)."""
    return any(call is g for g in _PRODUCTS)


def require_bars_service(authorization: str = Header(default="")) -> dict:
    """THE gate for the dedicated bars-api app: a trusted service caller ONLY.

    ⛔⛔ NO MEMBER PATH HERE, AND THAT IS THE SECURITY PROPERTY RATHER THAN A
    LIMITATION. The tier has no `auth.db`, so `validate_session` on that pod
    would query a database that does not exist and fail open or crash depending
    on the day. It also has no legitimate browser caller — so "accept a cookie"
    would only ever admit somebody who went looking for the Railway domain.

    The public domain therefore answers exactly one caller: the web pod, which
    has already decided the member question.
    """
    if _push_secret_ok(authorization):
        return {"via": "push_secret"}
    raise HTTPException(status_code=401, detail="Not authenticated")
