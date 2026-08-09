"""Launch-hardening regression tests (3 critical blockers from the 2026-07-05 audit).

1. client IP is derived from trusted proxy headers, so rate-limits bucket per-user
   (not per Cloudflare/Railway edge IP → global lockout).
2. AdminGuardMiddleware fails CLOSED: /api/admin/* + /api/live/admin/* require an
   admin session, except the four intentionally-open read-only status endpoints.
3. The theme-performance router does not re-submit a ~1900-ticker warm on every poll.
"""
from types import SimpleNamespace


def _req(headers=None, client_host="10.0.0.1"):
    return SimpleNamespace(headers=headers or {}, client=SimpleNamespace(host=client_host))


# ── Fix 1: real client IP ─────────────────────────────────────────────────────
def test_client_ip_prefers_cf_connecting_ip():
    from api.services.request_ip import client_ip
    r = _req({"cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8"}, "10.0.0.1")
    assert client_ip(r) == "1.2.3.4"


def test_client_ip_falls_back_to_leftmost_xff():
    from api.services.request_ip import client_ip
    r = _req({"x-forwarded-for": "5.6.7.8, 9.9.9.9"}, "10.0.0.1")
    assert client_ip(r) == "5.6.7.8"


def test_client_ip_falls_back_to_peer_address():
    from api.services.request_ip import client_ip
    assert client_ip(_req({}, "10.0.0.1")) == "10.0.0.1"


def test_client_ip_never_raises_without_client():
    from api.services.request_ip import client_ip
    r = SimpleNamespace(headers={}, client=None)
    assert isinstance(client_ip(r), str)


def test_limiter_uses_client_ip_keyfunc():
    import api.limiter as lim
    from api.services.request_ip import client_ip
    # slowapi stores the key function; assert it is ours, not get_remote_address.
    assert getattr(lim.limiter, "_key_func", None) is client_ip


# ── Fix 3: admin guard fails closed ───────────────────────────────────────────
def _guard_app(monkeypatch, user):
    from fastapi import FastAPI
    import api.middleware.admin_guard as ag
    monkeypatch.setattr(ag, "validate_session", lambda tok: user)
    app = FastAPI()
    app.add_middleware(ag.AdminGuardMiddleware)

    @app.post("/api/admin/massive/apply-gap-fill")
    def mutate():
        return {"ok": True}

    @app.api_route("/api/live/admin/clear-before-date", methods=["GET", "POST"])
    def livewipe():
        return {"ok": True}

    @app.get("/api/admin/reconciliation-status")
    def status():
        return {"ok": True}

    @app.get("/api/admin/bars/audit/latest")
    def bars_audit():  # already Depends-gated elsewhere; NOT re-gated by the middleware
        return {"ok": True}

    @app.get("/api/live-prices")
    def prices():
        return {"ok": True}

    from fastapi.testclient import TestClient
    return TestClient(app, raise_server_exceptions=False)


def test_admin_guard_blocks_anonymous_on_destructive_admin(monkeypatch):
    c = _guard_app(monkeypatch, user=None)
    assert c.post("/api/admin/massive/apply-gap-fill").status_code == 403
    # GET-reachable liveflow destructive delete is gated too
    assert c.get("/api/live/admin/clear-before-date").status_code == 403


def test_admin_guard_blocks_non_admin_user(monkeypatch):
    c = _guard_app(monkeypatch, user={"id": 1, "role": "user"})
    assert c.post("/api/admin/massive/apply-gap-fill").status_code == 403


def test_admin_guard_allows_admin(monkeypatch):
    c = _guard_app(monkeypatch, user={"id": 1, "role": "admin"})
    assert c.post("/api/admin/massive/apply-gap-fill").status_code == 200
    assert c.get("/api/live/admin/clear-before-date").status_code == 200


def test_admin_guard_leaves_readonly_status_open(monkeypatch):
    c = _guard_app(monkeypatch, user=None)
    # intentional no-auth ops dashboard stays reachable
    assert c.get("/api/admin/reconciliation-status").status_code == 200


def test_admin_guard_does_not_double_gate_already_protected_bars(monkeypatch):
    # /api/admin/bars/* self-gates via Depends(require_admin); the middleware must NOT
    # re-gate it (that would break its dependency-override test mocking).
    c = _guard_app(monkeypatch, user=None)
    assert c.get("/api/admin/bars/audit/latest").status_code == 200


def test_admin_guard_ignores_non_admin_paths(monkeypatch):
    c = _guard_app(monkeypatch, user=None)
    assert c.get("/api/live-prices").status_code == 200


def test_admin_guard_prefixes_are_the_confirmed_ungated_families():
    from api.middleware.admin_guard import GUARDED_PREFIXES
    assert set(GUARDED_PREFIXES) == {
        "/api/admin/massive/",
        "/api/admin/oi/",
        "/api/admin/ticker-types/",
        "/api/admin/flow/",
        "/api/admin/alert-tester",
        "/api/live/admin/",
    }


# ── Fix 2: theme warm is throttled ────────────────────────────────────────────
def test_theme_warm_is_throttled_and_capped(monkeypatch):
    import importlib
    import api.routers.theme_performance as tp
    importlib.reload(tp)

    warm_calls = []
    monkeypatch.setattr("api.routers.bars.warm_bars_async",
                        lambda tickers, tf="D", bars=8000: warm_calls.append(list(tickers)))
    big = [{"ticker": "XLK", "holdings": [{"sym": f"T{i}"} for i in range(200)]}]
    monkeypatch.setattr(tp.svc, "get_theme_performance", lambda: big)
    monkeypatch.setattr(tp.svc, "looks_like_ticker", lambda s: True)
    monkeypatch.setattr(tp, "_COLD_TAIL_CAP", 30, raising=False)
    tp._last_theme_warm = 0.0  # force first call to warm

    tp.get_theme_performance()
    tp.get_theme_performance()  # immediate second poll must NOT re-warm

    assert len(warm_calls) == 1, "second immediate poll should be throttled"
    assert len(warm_calls[0]) <= 30, "warm list must be capped, not ~200+"


# ── 🔴 THE GAP EVERY TEST ABOVE HAD ──────────────────────────────────────────
#
# Every admin-guard test in this file runs against `_guard_app()` — a FastAPI
# app this file BUILDS and adds the middleware to itself. All 8 of them were
# green for months while `app.add_middleware(AdminGuardMiddleware)` appeared
# NOWHERE in `api/main.py`, so the ~30 destructive ops under
# `/api/admin/{massive,oi,ticker-types,flow}/*` and `/api/live/admin/*` answered
# anonymous callers on the internet. Both halves of a severed wire stay
# individually correct; a fixture app can never tell you production is wired.
#
# The full rail — end-to-end through the real ASGI stack, plus the boot audit —
# is `tests/test_admin_guard_registered.py`. This one assertion lives HERE
# because this file is where the next engineer reading about the admin guard
# will actually look.
def test_the_admin_guard_is_installed_on_the_REAL_app_not_just_the_fixture():
    from api.main import app
    import api.middleware.admin_guard as ag

    installed = [getattr(m.cls, "__name__", str(m.cls)) for m in app.user_middleware]
    assert "AdminGuardMiddleware" in installed, (
        "every test above passes and production has NO admin guard: "
        f"{', '.join(ag.GUARDED_PREFIXES)} are open. "
        "See tests/test_admin_guard_registered.py."
    )
