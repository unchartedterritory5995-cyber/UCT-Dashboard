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


# ── 4. the cache may not become the authorization layer ─────────────────────

@pytest.mark.parametrize("sym", ["AAPL", "UCTA50"])
def test_member_history_is_NEVER_offered_to_a_SHARED_cache(app, as_caller, sym):
    """🔴 MEASURED BEFORE THE FIX: `/api/bars-history/UCTA50` returned
    `public, max-age=3600, stale-while-revalidate=86400` to an anonymous caller,
    and `public, max-age=31536000, immutable` with a matching sealed date.

    `public` invites Cloudflare to store one member's answer and serve it to the
    next caller, entitled or not — which makes the CDN the authorization layer,
    and makes it one that always says yes. `private` keeps the browser cache (the
    whole speed win) and gives up only the shared copy.
    """
    as_caller(PAID)
    r = _get(app, f"/api/bars-history/{sym}?tf=D&bars=50")
    cc = r.headers.get("cache-control", "")
    assert "public" not in cc, f"{sym} history is shared-cacheable: {cc!r}"
    assert cc.startswith("private") or "no-store" in cc, (
        f"{sym} history carries no member-safe cache directive: {cc!r}")

def test_the_IMMUTABLE_arm_is_private_too(monkeypatch):
    """⛔⛔ THE DANGEROUS ARM, REACHED DETERMINISTICALLY.

    ⚰️ MEASURED TWICE. The first version of this rail drove the route over HTTP
    and asserted on whatever `Cache-Control` came back — and reverting the
    immutable branch to `public` left it GREEN, because a request without `d`
    takes the SHORT arm and never reaches the branch. The second version derived
    `d` from the response and guarded it with `if sealed:` — which was worse: on a
    store with no sealed history the whole assertion silently skipped while still
    reporting a pass. A conditional rail is a rail that reports on its own luck.

    So the policy is tested where it is decided. `serve_bars_history` is a plain
    function; feed it bars whose last sealed date is known, ask with exactly that
    `d`, and the immutable branch is the only one that can answer.
    """
    from api.routers import bars as bars_router
    from api.services import breadth_symbols as bsym

    dated = [{"t": f"2026-0{m}-01", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 0}
             for m in (1, 2, 3)]
    monkeypatch.setattr(bsym, "build_breadth_bars",
                        lambda *a, **k: {"ticker": "UCTA50", "tf": "D", "bars": dated})

    probe = bars_router.serve_bars_history("UCTA50", "D", 100, "", "")
    import json
    last_sealed = json.loads(bytes(probe.body).decode())["last_sealed"]
    assert last_sealed, "the fixture produced no sealed boundary — nothing is being measured"

    out = bars_router.serve_bars_history("UCTA50", "D", 100, "", last_sealed)
    cc = out.headers.get("cache-control", "")
    assert "immutable" in cc, (
        f"the sealed-date request did not reach the immutable arm ({cc!r}) — this "
        "assertion would be measuring nothing")
    assert "public" not in cc, (
        f"a member's sealed breadth history is shared-cacheable for a year: {cc!r}")
    assert cc.startswith("private")


def test_the_live_bars_route_stays_uncacheable(app, as_caller):
    as_caller(PAID)
    cc = _get(app, "/api/bars/AAPL?tf=D&bars=3").headers.get("cache-control", "")
    assert "no-store" in cc and "public" not in cc


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
def test_NO_chart_data_route_offers_itself_to_a_SHARED_cache(app, as_caller):
    """⭐⭐ THE POLICY, SWEPT — and asserted WHERE IT IS DECLARED.

    ⛔ A GATE IN FRONT OF A `public` RESPONSE IS NOT A GATE. Cloudflare keys on
    the URL, not the cookie: one entitled member's answer, stored at the edge, is
    then served to whoever asks next — the CDN acting as the authorization layer,
    and one that always says yes.

    ⚰️ MEASURED, AND THIS IS THE SECOND TIME THE SAME TRAP CAUGHT THIS FILE.
    Driving `/api/barspack/manifest` over HTTP and reading its header proved
    nothing: with no pack published locally the route 404s with `no-store`, so
    reverting the real manifest header to `public` left the sweep GREEN. A rail
    that only sees the error path is not a rail. The header CONSTANTS are the
    policy, so they are what gets asserted — no environment can hide them.
    """
    from api.routers import barspack_router as bp

    for name, headers in (("manifest", bp._MANIFEST_HEADERS), ("shard", bp._SHARD_HEADERS)):
        cc = headers.get("Cache-Control", "")
        assert cc, f"barspack {name} declares no Cache-Control — the edge decides by default"
        assert "public" not in cc, f"barspack {name} is shared-cacheable member data: {cc!r}"
        assert "s-maxage" not in cc, f"barspack {name} hands a shared cache a TTL: {cc!r}"
        assert cc.startswith("private"), f"barspack {name}: {cc!r}"

    # ⭐ AND THE LIVE ONE THAT DOES RETURN DATA HERE, so the constants above are
    # not the only thing this file has ever seen.
    as_caller(PAID)
    cc = _get(app, "/api/bars/AAPL?tf=D&bars=3").headers.get("cache-control", "")
    assert "no-store" in cc and "public" not in cc
