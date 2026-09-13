"""🔴 THE CHART-DATA SURFACE IS PAID, ON BOTH PUBLIC DOORS.

WHAT THIS FILE EXISTS TO MAKE IMPOSSIBLE
----------------------------------------
The 2026-09-13 audit measured `GET /api/bars/UCTA50` answering a caller with no
credential of any kind — UCT's own breadth output, enumerable first through an
equally open `/api/breadth-symbols` (44 symbols, names and all). Charts have been
paid since the 2026-07-19 free-tier decision; the data behind them was not.

⛔⛔ AND THERE WERE **TWO** PUBLIC DOORS. `api/bars_api_main.py` is a second
FastAPI app serving the same `serve_bars` core, and Railway publishes it at
`bars-api-production-1052.up.railway.app`. A gate on `api.main:app` alone would
have looked complete and closed one of two. Section 3 below drives the OTHER app
directly and is the rail that fails if someone later removes its gate while the
web pod stays green.

⚠️ WHY THE PATCH TARGET IS `api.bars_auth`, NOT `auth_service`.
`require_bars_access` calls `validate_session` by value — `from ... import` binds
at import time, so patching `api.services.auth_service.validate_session` reaches
nothing (`lesson_from_import_severs_a_module_from_its_guards`, the same trap
`test_exposed_routes_gated`'s flow measurement documents). The identity is
substituted one level down and THE GATE ITSELF STILL RUNS on every request.

⛔ AND THE GATE IS NEVER OVERRIDDEN. No `dependency_overrides` on
`require_bars_access` anywhere in this file: overriding a gate means the test no
longer runs it, and a handler that had quietly lost its `Depends` would look
identical to one that still carried it.
"""
from __future__ import annotations

import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import api.bars_auth as bars_auth  # noqa: E402
import api.routers.ticker_search as ticker_search  # noqa: E402

# ── the callers, exactly as the product's own membership rule sees them ──────
#
# ⭐ `comped` AND `trial` ARE HERE ON PURPOSE. The owner's policy for chart data
# names both as ALLOWED, and the two shipped paid families measurably DISAGREE
# about `comped` (`require_paid` refuses it 402; `require_plan`/`meets_plan_gate`
# admits it). `require_bars_access` takes the `meets_plan_gate` family for exactly
# that reason, so a comped account MUST get in here — and this row is what would
# notice if the gate were quietly swapped to the other family.
ANON = None
FREE = {"id": "free-1", "email": "f@x.test", "role": "member", "plan": "free"}
PAID = {"id": "paid-1", "email": "p@x.test", "role": "member", "plan": "pro"}
PREMIUM = {"id": "prem-1", "email": "pr@x.test", "role": "member", "plan": "premium"}
LIFETIME = {"id": "life-1", "email": "l@x.test", "role": "member", "plan": "lifetime"}
COMPED = {"id": "comp-1", "email": "c@x.test", "role": "member", "plan": "comped"}
ADMIN = {"id": "adm-1", "email": "a@x.test", "role": "admin", "plan": "free"}

ALLOWED = {"paid": PAID, "premium": PREMIUM, "lifetime": LIFETIME,
           "comped": COMPED, "admin": ADMIN}
REFUSED = {"free": FREE}

#: One of each class the audit inventoried — ordinary security, ETF, index,
#: proprietary breadth (TWO of them: one symbol is an example, two is a family),
#: and something nobody carries.
RESOURCES = ["AAPL", "QQQ", "%5EIXIC", "UCTA50", "UCTNH", "ZZZZNOTREAL9"]

#: Every chart-DATA path on the web app. Derived responsibilities, one list.
BARS_PATHS = [
    "/api/bars/AAPL?tf=D&bars=3",
    "/api/bars-history/AAPL?tf=D&bars=3",
    "/api/barspack/manifest",
    "/api/breadth-symbols",
]


@pytest.fixture(scope="module")
def app():
    """The app `main.py` hands uvicorn.

    ⚠️ NOT used as a context manager: `TestClient.__enter__` runs the lifespan,
    which starts the scheduler and the bars prewarm. Routing and dependencies
    need none of that.
    """
    from api.main import app as real_app
    return real_app


@pytest.fixture
def as_caller(monkeypatch):
    """Present a given member (or nobody) to every module that resolves one.

    ⛔ PATCHED PER MODULE, AND THE SECOND ENTRY IS NOT REDUNDANT.
    `ticker_search` does `from ... import validate_session`, which binds the
    function into ITS OWN namespace at import — so a patch on `bars_auth` alone
    reaches nothing there. Measured: the anonymous half of the ticker-search case
    passed while the paid half failed, which is the shape of a test proving a gate
    that is not the gate the route runs
    (`lesson_from_import_severs_a_module_from_its_guards`).
    """
    def _set(user):
        for mod in (bars_auth, ticker_search):
            monkeypatch.setattr(mod, "validate_session",
                                lambda _tok, _u=user: (dict(_u) if _u else None))
            monkeypatch.setattr(mod, "get_user_plan",
                                lambda _uid, _u=user: (_u or {}).get("plan", "free"))
    return _set


def _get(app, path, cookie=True):
    c = TestClient(app)
    cookies = {"uct_session": "t"} if cookie else {}
    return c.get(path, cookies=cookies)


# ── 1. the matrix ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("sym", RESOURCES)
def test_ANONYMOUS_gets_nothing_from_the_bars_route(app, as_caller, sym):
    """⛔⛔ THE HEADLINE. No credential, no bars — for every class of symbol,
    including the two proprietary breadth measures the audit found open."""
    as_caller(ANON)
    r = _get(app, f"/api/bars/{sym}?tf=D&bars=3", cookie=False)
    assert r.status_code == 401, (
        f"/api/bars/{sym} answered an anonymous caller with {r.status_code} — "
        "this is the release blocker reopening")


@pytest.mark.parametrize("sym", RESOURCES)
def test_an_INVALID_session_is_not_a_session(app, as_caller, sym):
    """An expired or forged cookie must land exactly where no cookie lands."""
    as_caller(ANON)              # validate_session returns None for any token
    r = _get(app, f"/api/bars/{sym}?tf=D&bars=3")
    assert r.status_code == 401


@pytest.mark.parametrize("sym", RESOURCES)
def test_a_FREE_member_is_refused_and_TOLD_WHY(app, as_caller, sym):
    """⭐ 403, NOT 401 — the two are different facts and the chart reads both.
    A free member IS signed in; what they lack is the plan."""
    as_caller(FREE)
    r = _get(app, f"/api/bars/{sym}?tf=D&bars=3")
    assert r.status_code == 403, f"free member got {r.status_code} for {sym}"
    assert "paid plan" in r.json().get("detail", "").lower()


@pytest.mark.parametrize("who", sorted(ALLOWED))
@pytest.mark.parametrize("sym", ["AAPL", "QQQ", "UCTA50"])
def test_every_ENTITLED_class_reaches_the_data(app, as_caller, who, sym):
    """⛔ A GATE THAT BLOCKS EVERYONE IS NOT A FIX. Paid, premium, lifetime,
    comped, trial-equivalent and admin all get through — to ordinary securities
    AND to the proprietary breadth they pay for."""
    as_caller(ALLOWED[who])
    r = _get(app, f"/api/bars/{sym}?tf=D&bars=3")
    assert r.status_code not in (401, 403), (
        f"{who} was refused {r.status_code} for {sym} — the gate is refusing a "
        "member who is entitled")


def test_an_ACTIVE_TRIAL_is_admitted_through_the_product_rule(app, as_caller, monkeypatch):
    """⭐ TRIAL IS NOT A PLAN NAME, so it cannot be asserted with a fixture dict.
    `meets_plan_gate` admits it via `is_account_in_trial`, and patching THAT is
    what proves this surface inherits the rule rather than re-listing plans."""
    import api.middleware.auth_middleware as am
    as_caller(FREE)
    monkeypatch.setattr(am, "is_account_in_trial", lambda _u: True)
    r = _get(app, "/api/bars/UCTA50?tf=D&bars=3")
    assert r.status_code not in (401, 403), "a full-access trial was refused chart data"


@pytest.mark.parametrize("path", BARS_PATHS)
def test_the_WHOLE_chart_data_family_is_closed_not_just_the_headline_route(app, as_caller, path):
    """⛔ CLOSING ONE PATH WHILE AN ALTERNATE SERVES THE SAME HISTORY IS NOT A FIX.
    `/api/bars-history` carries deep sealed history, `/api/barspack/*` ships the
    universe as shards, `/api/breadth-symbols` is the enumeration step."""
    as_caller(ANON)
    r = _get(app, path, cookie=False)
    assert r.status_code == 401, f"{path} is still open to an anonymous caller"


# ── 2. refused BEFORE the expensive work ────────────────────────────────────

def test_a_REFUSED_caller_never_reaches_the_data_layer(app, as_caller, monkeypatch):
    """⭐⭐ AUTHORIZATION FIRST, THEN THE CACHE — never the other way round.

    ⛔ THE POINT IS NOT TIDINESS. `serve_bars` is the door to the memory cache,
    bars.db, the disk fallback, the provider and the background cold-fetch queue.
    A gate that runs AFTER it would leave an anonymous caller able to schedule
    provider work on a paid API key by asking for symbols they can never read —
    the amplification half of the audit's threat model, surviving the fix.
    """
    import api.routers.bars as bars_router
    called = []
    monkeypatch.setattr(bars_router, "serve_bars",
                        lambda *a, **k: called.append(a) or {"bars": []})

    for user, expected in ((ANON, 401), (FREE, 403)):
        as_caller(user)
        r = _get(app, "/api/bars/UCTA50?tf=D&bars=3", cookie=bool(user))
        assert r.status_code == expected
    assert called == [], (
        "a refused caller reached `serve_bars` — the gate is running after the "
        "data layer, not in front of it")


# ── 3. ⭐⭐ THE SECOND PUBLIC DOOR ───────────────────────────────────────────

@pytest.fixture(scope="module")
def tier_app():
    """The dedicated bars-api app, built the way its own `main()` builds it."""
    from api.bars_api_main import _build_app
    return _build_app()


@pytest.mark.parametrize("path", [
    "/api/bars/UCTA50?tf=D&bars=3",
    "/api/bars/AAPL?tf=D&bars=3",
    "/api/bars-history/UCTA50?tf=D&bars=3",
    "/api/coverage",
])
def test_the_PUBLIC_bars_tier_refuses_an_anonymous_caller(tier_app, path):
    """🔴 THE BYPASS THIS WHOLE PASS EXISTS TO CLOSE.

    Railway publishes this service at `bars-api-production-1052.up.railway.app`.
    If it answers, every gate on the web pod is decoration: an attacker simply
    asks the other host. This test fails if someone removes the tier's gate even
    while `api.main:app` stays perfectly protected.
    """
    r = TestClient(tier_app).get(path)
    assert r.status_code == 401, (
        f"the PUBLIC bars tier served {path} to an anonymous caller "
        f"({r.status_code}) — the web pod's gate is bypassable by hostname")


def test_the_tier_admits_the_SERVICE_TOKEN(tier_app, monkeypatch):
    """…and the web pod can still reach it, or charts lose their serving tier."""
    monkeypatch.setenv("PUSH_SECRET", "s3cret-for-test")
    r = TestClient(tier_app).get("/api/bars/AAPL?tf=D&bars=3",
                                 headers={"Authorization": "Bearer s3cret-for-test"})
    assert r.status_code != 401, "the tier refused its own trusted caller"


def test_the_tier_HEALTHCHECK_stays_open(tier_app):
    """⛔ DELIBERATELY UNGATED. Railway's healthcheck presents no credential;
    gating it fails the deploy instead of securing anything. These return
    liveness counters only — no symbols, no bars."""
    for p in ("/api/health", "/internal/health", "/api/ready"):
        assert TestClient(tier_app).get(p).status_code == 200, f"{p} is gated"


def test_a_WRONG_service_token_is_refused(tier_app, monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "s3cret-for-test")
    r = TestClient(tier_app).get("/api/bars/AAPL?tf=D&bars=3",
                                 headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 401


def test_an_UNSET_secret_admits_NOBODY(tier_app, monkeypatch):
    """⚠️ FAILS CLOSED, and the cost of that is bounded: `get_bars` falls back to
    the web pod's own local serve whenever the tier does not answer usefully, so
    a misconfigured secret costs a performance tier and never a chart."""
    monkeypatch.delenv("PUSH_SECRET", raising=False)
    r = TestClient(tier_app).get("/api/bars/AAPL?tf=D&bars=3",
                                 headers={"Authorization": "Bearer "})
    assert r.status_code == 401


# ── 4. the interim edge posture, pinned so it stays a DECISION ──────────────

def test_the_LIVE_bars_route_is_never_shared_cacheable(app, as_caller):
    """⛔ THE ONE CACHE RULE THAT IS NOT NEGOTIABLE. `/api/bars` carries the recent
    and LIVE tail; a shared cache holding it would serve one member’s last price to
    the next caller and would be wrong even if everybody were entitled."""
    as_caller(PAID)
    cc = _get(app, "/api/bars/AAPL?tf=D&bars=3").headers.get("cache-control", "")
    assert "no-store" in cc and "public" not in cc, cc


def test_the_HISTORY_and_PACK_routes_stay_SHARED_CACHEABLE_on_purpose():
    """🔴 THIS TEST PINS AN ACCEPTED RISK, NOT A SAFE STATE. READ BEFORE CHANGING.

    `/api/bars-history`, `/api/barspack/*` and `/api/bars-today-pack` are still
    `public`, so Cloudflare still caches them at the edge and still serves a HIT
    **without consulting any origin** — including to an anonymous caller who knows
    the URL. The origin gates added in this branch do NOT close that.

    ⭐ IT IS DELIBERATE, AND THE REASON IS MEASURED. The edge is not a nicety here:
    the web pod does not hold the deep 20 GB history at all (it proxies to the
    worker), and production measured ~2 ms edge-served deep history against a
    300–500 ms round trip. An earlier pass set these to `private` as an interim
    safety measure and that would have cost the product its global chart speed —
    the owner’s ruling is to keep the performance layer and close the edge in the
    secure-entitlement phase instead.

    ⛔ SO THE HONEST CLASSIFICATION IS: **ORIGIN CLOSED / EDGE STILL AWAITING
    ENTITLEMENT.** This assertion exists so that flipping these headers — in either
    direction — is a deliberate act that has to come back and re-read this
    paragraph, rather than something that drifts.
    """
    from api.routers import barspack_router as bp
    for name, headers in (("manifest", bp._MANIFEST_HEADERS), ("shard", bp._SHARD_HEADERS)):
        cc = headers.get("Cache-Control", "")
        assert "public" in cc, (
            f"barspack {name} is no longer shared-cacheable ({cc!r}) — if that was "
            "intended, the global chart-speed layer just changed and this rail's "
            "docstring needs rewriting with the new decision")

    import inspect
    from api.routers import bars as bars_router
    src = inspect.getsource(bars_router.serve_bars_history)
    assert "public, max-age=31536000, immutable" in src and "public, max-age=3600" in src, (
        "bars-history stopped offering itself to the shared edge cache — deliberate "
        "or not, that is the product’s global speed layer changing")


# ── 5. discovery: the enumeration step ──────────────────────────────────────

def test_an_unentitled_caller_cannot_ENUMERATE_the_breadth_catalogue(app, as_caller):
    """⛔ TWO STEPS, ONE ATTACK. Reading 44 proprietary symbol names is only
    harmless if their history is too — and it is not."""
    for user, code in ((ANON, 401), (FREE, 403)):
        as_caller(user)
        r = _get(app, "/api/breadth-symbols", cookie=bool(user))
        assert r.status_code == code
        assert "UCTA50" not in r.text


def test_ticker_search_STILL_WORKS_for_everyone_but_hides_the_breadth_rows(app, as_caller):
    """⭐ THE SURGICAL HALF, AND THE ASYMMETRY IS THE FINDING.

    `/api/ticker-search` has fourteen frontend consumers — CommandPalette,
    TickerPopup, calendar, community ticker mentions, journal, ModelBook — plus
    an in-process Discord caller. Paywalling the endpoint would break ordinary
    symbol lookup on surfaces entitled to it. What leaks is the proprietary half.
    """
    as_caller(ANON)
    r = _get(app, "/api/ticker-search?q=AAPL&limit=5", cookie=False)
    assert r.status_code == 200, "ordinary ticker search broke for an anonymous caller"

    as_caller(ANON)
    anon_breadth = _get(app, "/api/ticker-search?q=UCT&limit=20", cookie=False)
    assert anon_breadth.status_code == 200
    assert "UCTA50" not in anon_breadth.text, (
        "an anonymous caller can still enumerate UCT's breadth measures through "
        "ticker search — the other half of the two-step")

    as_caller(PAID)
    paid_breadth = _get(app, "/api/ticker-search?q=UCT&limit=20")
    assert "UCTA50" in paid_breadth.text, (
        "a paid member lost the breadth symbols they are entitled to — the gate "
        "went too far")


# ── 6. the debug door ───────────────────────────────────────────────────────

def test_the_provider_introspection_route_is_ADMIN_ONLY(app, as_caller):
    """🔴 IT CALLED THREE PAID PROVIDERS PER REQUEST, ANONYMOUSLY, with an
    unbounded caller-controlled bar count, and named the provider stack in the
    reply. The sharpest amplifier on the surface, and it was not the route
    anybody was looking at."""
    r = TestClient(app).get("/api/bars/_debug_source/AAPL?tf=60")
    assert r.status_code in (401, 403), (
        f"_debug_source answered an anonymous caller with {r.status_code}")


# ── 7. today-pack: master-only, and the fourth door ─────────────────────────

def test_the_TODAY_PACK_origin_refuses_the_unentitled(app, as_caller):
    """🔴 THE FOURTH DOOR, AND IT EXISTS ONLY ON MASTER.

    `/api/bars-today-pack` ships today’s developing daily bar for the WHOLE market
    in one payload — member chart data, identical bytes for everyone — and it was
    anonymous. The earlier security programme could not have covered it: it landed
    on master after that branch diverged.
    """
    for user, code in ((ANON, 401), (FREE, 403)):
        as_caller(user)
        r = _get(app, "/api/bars-today-pack", cookie=bool(user))
        assert r.status_code == code, f"today-pack answered {r.status_code}"


@pytest.mark.parametrize("who", ["paid", "admin"])
def test_an_ENTITLED_member_still_gets_the_today_pack(app, as_caller, who):
    as_caller(ALLOWED[who])
    assert _get(app, "/api/bars-today-pack").status_code not in (401, 403)


def test_the_today_pack_CLIENT_still_sends_its_cookie(app):
    """⭐ WHY THE GATE NEEDS NO CLIENT CHANGE, ASSERTED RATHER THAN ASSUMED.

    `todayPackClient` carries a comment saying "⛔ NO `credentials` — DELIBERATE",
    but it calls bare `fetch('/api/bars-today-pack')`, and fetch’s default
    credentials mode is `same-origin` — which DOES send the cookie same-origin. The
    comment’s intent is not what the code does, and the accident is in the safe
    direction. If someone ever "corrects" the code to match the comment by adding
    `credentials: 'omit'`, every paid member silently loses the first-paint seed —
    so the absence of that option is pinned here.
    """
    import pathlib
    src = pathlib.Path("app/src/lib/todayPackClient.js").read_text(encoding="utf-8")
    assert "fetch('/api/bars-today-pack')" in src, "the today-pack fetch call moved"
    assert "credentials: 'omit'" not in src and 'credentials: "omit"' not in src, (
        "todayPackClient now omits credentials — the paid gate on "
        "/api/bars-today-pack can no longer be satisfied and the seed is dead")


def test_the_today_pack_KEEPS_its_edge_cache_policy():
    """⛔ ORIGIN CLOSED, EDGE DELIBERATELY UNCHANGED — see the section-4 rails.
    `no-store` here would put 200+ members’ polling straight onto the pod, which is
    the failure this route’s own docstring exists to prevent."""
    import inspect
    from api.routers import bars as bars_router
    src = inspect.getsource(bars_router.get_today_pack)
    assert "public, max-age=20" in src and "public, max-age=10" in src, (
        "today-pack’s CDN policy changed — deliberate or not, that is a product "
        "performance decision and not a side effect of a security gate")
