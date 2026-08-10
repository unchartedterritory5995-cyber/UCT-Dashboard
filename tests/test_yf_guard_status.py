"""The yfinance breaker's diagnostics existed and reached no door.

`yf_util.guard_status()` and `yfinance_pool.pool_status()` were both written,
both correct, and both unreachable: nothing in `api/routers/**` or `api/main.py`
referenced either. So the breaker — which, once open, returns every caller's
default "WITHOUT touching the network and WITHOUT logging" (its own words) —
could not be observed from outside the pod.

That cost real time on 2026-08-10. Expected-move read 0% across every upcoming
earnings date in production while `get_implied_move` returned correct live
marks on a dev box (AAPL 1.2%, CSCO 8.2%). "Breaker parked open" and "provider
genuinely has no data" produce byte-identical output, and the one number that
separates them — `suppressed_total` vs `calls_total` — was sitting in memory
with no way out.

This is the shape user memory calls "BUILT, TESTED, GREEN — CONNECTED TO
NOTHING": the unit tests below would all have passed while the feature was
unreachable, which is why `TestTheWireIsConnected` exists and asserts against
the mounted app rather than the function.

Read-only and deliberately unauthenticated, per `api/middleware/admin_guard.py`
and its siblings `/api/admin/reconciliation-status`,
`/api/admin/fundamentals-health`, `/api/admin/provider-coverage`.
"""
import time

from fastapi.testclient import TestClient

from api.services import yf_util


class TestGuardStatusContract:
    def setup_method(self):
        yf_util.reset_guard_state()

    def teardown_method(self):
        yf_util.reset_guard_state()

    def test_a_closed_breaker_reports_closed_with_no_cooldown(self):
        s = yf_util.guard_status()
        assert s["breaker_open"] is False
        assert s["cooldown_seconds_remaining"] == 0

    def test_an_open_breaker_reports_open_and_time_remaining(self):
        with yf_util._state_lock:
            yf_util._state["cooldown_until"] = time.monotonic() + 120
        s = yf_util.guard_status()
        assert s["breaker_open"] is True
        assert 100 <= s["cooldown_seconds_remaining"] <= 120

    def test_it_never_publishes_the_raw_monotonic_deadline(self):
        """`cooldown_until` is a `time.monotonic()` value — meaningless outside
        this process and NOT comparable to a wall clock. Publishing it invites
        a reader to subtract it from `time.time()` and get a number that looks
        like an answer. Only the derived remaining-seconds may escape."""
        with yf_util._state_lock:
            yf_util._state["cooldown_until"] = time.monotonic() + 120
        assert "cooldown_until" not in yf_util.guard_status()

    def test_it_carries_the_counter_that_distinguishes_the_two_failures(self):
        """`suppressed_total` (short-circuited, never hit the network) against
        `calls_total` (reached the pool) is the ENTIRE point: a rising
        suppressed count beside a flat calls count says the breaker ate them,
        which no amount of staring at an empty payload can tell you."""
        with yf_util._state_lock:
            yf_util._state.update(suppressed=41, calls=7, trips=3, rate_limited=5)
        s = yf_util.guard_status()
        assert s["suppressed_total"] == 41
        assert s["calls_total"] == 7
        assert s["trips_total"] == 3
        assert s["rate_limited_total"] == 5

    def test_lane_capacity_is_reported_from_the_declared_map(self):
        """Derived, not typed — `_LANE_WORKERS` is described in-file as what
        keeps 'how many yfinance threads can this process have' answerable by
        reading one dict. The status reads THAT dict rather than restating it."""
        assert yf_util.guard_status()["lanes"] == yf_util._LANE_WORKERS


class TestTheWireIsConnected:
    """Mocks NOTHING on the path under test — goes RED if the route is
    unmounted while `guard_status` itself stays perfectly correct. That is the
    exact failure this endpoint was missing for."""

    def test_the_endpoint_is_reachable_without_auth(self):
        from api.main import app
        r = TestClient(app).get("/api/admin/yfinance-guard")
        assert r.status_code == 200, f"route not mounted: {r.status_code}"

    def test_it_serves_the_fields_an_operator_needs_to_tell_the_two_apart(self):
        from api.main import app
        body = TestClient(app).get("/api/admin/yfinance-guard").json()
        for key in ("breaker_open", "cooldown_seconds_remaining",
                    "suppressed_total", "calls_total", "rate_limited_total",
                    "lanes", "default_timeout_seconds"):
            assert key in body, f"missing {key}: {sorted(body)}"

    def test_an_open_breaker_is_visible_THROUGH_the_endpoint(self):
        """Not just "the route 200s" — the live breaker state must actually
        reach the wire. A handler returning a hardcoded/stale dict would pass
        the two tests above."""
        from api.main import app
        try:
            with yf_util._state_lock:
                yf_util._state["cooldown_until"] = time.monotonic() + 300
                yf_util._state["suppressed"] = 999
            body = TestClient(app).get("/api/admin/yfinance-guard").json()
            assert body["breaker_open"] is True
            assert body["suppressed_total"] == 999
            assert body["cooldown_seconds_remaining"] > 250
        finally:
            yf_util.reset_guard_state()
