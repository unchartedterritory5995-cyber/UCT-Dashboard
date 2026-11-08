"""Unit VA1 (2026-11-07): the RS provider's measured performance budget, plus
its per-call timing record.

Built on a deterministic fixture: the provider suite's own `_long_daily`
(seeded random walks for NVDA, SPY, RSP and XLK), fed whole by a fetcher that
ignores ``count`` the way the suite's `_fetcher` does. No network, no
`C:\\data`: the bar reader is injected, the cache is stubbed, the rating table
and the evidence artifact read "nothing" (`_hermetic_reads`), and the data
generation is a constant.

The point is to catch a 2x regression, not to be flaky on a slow PC. The
numbers below were MEASURED on Patrick's box (Windows 11, the study venv,
2026-11-07), median of 7 cold builds each (the fixture is built outside the
clock; the cache never hits, so every build is the full cold path):

* 5,000-bar daily series: envelope JSON 560,932 bytes; build median 465 ms
  (runs 359-518 ms across two sessions). Byte budget 840,000 (~1.5x); time
  budget 1,500 ms (~3x the median). Nearly all of it is ``compute``: the
  bar, rating and evidence reads are stubbed here and sum to under 1 ms.
* 600-bar daily series: envelope JSON 71,792 bytes (build median 55 ms),
  pinned within 2%
  (the band absorbs a last-digit libm difference between Windows and Linux in
  a rounded float; a field added or dropped is the key-path digest rail's job,
  `test_rs_visual_va1_server_copy.test_a_payload_field_change_comes_with_a_shape_bump`).

When a change moves a size on purpose, re-measure (the assertion message
prints the new number) and move the pin and this docstring together.
"""
from __future__ import annotations

import json
import statistics
import time

import pytest

from api.services import rs_benchmarks as rb
from api.services.signature import rs_provider as rsp
from tests.test_rs_columns_provider import (  # noqa: F401 - fixtures are used by name
    _hermetic_reads, _long_daily, v2_row,
)

#: Measured, see the module docstring.
SIZE_600_PIN = 71_792
BYTES_BUDGET_5000 = 840_000
MS_BUDGET_5000 = 1_500.0

INPUTS = {"benchmark": "SPY", "showRedDay": True, "showNewLow": True}


@pytest.fixture
def lane(monkeypatch, v2_row):
    """The provider with its I/O pinned: a store-backed fetcher that returns
    the whole series, a cache that never hits, a constant data generation and
    a Technology / Semiconductors symbol (so the sector leg and the theme
    answer too)."""
    from api.services.cache import cache
    monkeypatch.setattr(cache, "get", lambda k: None)
    monkeypatch.setattr(cache, "set", lambda k, v, ttl: None)
    monkeypatch.setattr(rsp, "_rs_data_generation", lambda now=None: "r-|e-")
    monkeypatch.setattr(rb, "_groups_for", lambda s: {"sector": "Technology", "industry": "Semiconductors"})

    def build(store: dict) -> dict:
        def fetch(sym, tf, count):
            return list(store.get(sym.upper(), []))
        return rsp.rs_line_envelope("NVDA", "D", dict(INPUTS), fetch_bars=fetch,
                                    cache_key=lambda kind, s: f"sig:{kind}:{s}")
    return build


def _wire_bytes(env: dict) -> int:
    """The envelope as the route serialises it (Starlette's JSONResponse:
    compact separators, ``ensure_ascii=False``), minus ``asOf``, whose float
    repr changes length with the clock."""
    body = {k: v for k, v in env.items() if k != "asOf"}
    return len(json.dumps(body, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8"))


def test_the_5000_bar_payload_stays_under_its_byte_budget(lane):
    env = lane(_long_daily(n=5000))
    assert len(env["times"]) == 5000 and env["payload"]["state"] == "ok"
    size = _wire_bytes(env)
    assert size < BYTES_BUDGET_5000, (
        f"the 5,000-bar RS envelope is {size} bytes, over its {BYTES_BUDGET_5000} budget")


def test_the_5000_bar_compute_stays_under_its_time_budget(lane):
    store = _long_daily(n=5000)                        # built once, outside the clock
    lane(store)                                        # warm the imports
    runs = []
    for _ in range(3):
        t = time.perf_counter()
        lane(store)
        runs.append((time.perf_counter() - t) * 1000.0)
    med = statistics.median(runs)
    assert med < MS_BUDGET_5000, f"5,000-bar RS build median {med:.0f} ms (runs {runs}), budget {MS_BUDGET_5000} ms"


def test_the_600_bar_payload_size_is_pinned(lane):
    env = lane(_long_daily(n=600))
    size = _wire_bytes(env)
    assert abs(size - SIZE_600_PIN) <= SIZE_600_PIN * 0.02, (
        f"the 600-bar RS envelope is {size} bytes; pinned at {SIZE_600_PIN} (2% band). "
        "Re-measure and move the pin if the change is intended.")


# ── the timing record (Server-Timing) ─────────────────────────────────────────

def test_a_cold_build_records_its_total_and_every_stage(lane):
    rsp.timing_reset()
    assert rsp.last_timing() is None and rsp.server_timing() is None
    lane(_long_daily(n=600))
    rec = rsp.last_timing()
    assert rec["tier"] == "cold"
    assert list(rec["stages"]) == ["bars", "rating", "compute", "evidence"]
    assert all(v >= 0 for v in rec["stages"].values())
    assert sum(rec["stages"].values()) <= rec["total_ms"] + 1.0, rec
    st = rsp.server_timing()
    assert st.startswith('rs;desc="cold";dur=') and ", rs-bars;dur=" in st and ", rs-evidence;dur=" in st


def test_a_cache_hit_records_the_total_alone(monkeypatch, v2_row):
    from api.services.cache import cache
    sentinel = {"columns": {}, "times": [], "asOf": 0}
    monkeypatch.setattr(cache, "get", lambda k: sentinel)
    monkeypatch.setattr(rsp, "_rs_data_generation", lambda now=None: "r-|e-")
    out = rsp.rs_line_envelope("NVDA", "D", {}, fetch_bars=lambda *a: pytest.fail("no fetch on a hit"),
                               cache_key=lambda kind, s: f"sig:{kind}:{s}")
    assert out is sentinel
    rec = rsp.last_timing()
    assert rec["tier"] == "cache" and rec["stages"] == {}
    assert rsp.server_timing().startswith('rs;desc="cache";dur=')


def test_the_flag_off_build_records_bars_and_compute_only(monkeypatch):
    from api.services.cache import cache
    from api.services.signature import registry_defs as rd
    monkeypatch.setattr(rd, "RS_V2_ENABLED", False)
    monkeypatch.setattr(cache, "get", lambda k: None)
    monkeypatch.setattr(cache, "set", lambda k, v, ttl: None)
    store = _long_daily(n=300)
    rsp.rs_line_envelope("NVDA", "D", {"benchmark": "SPY"}, fetch_bars=lambda s, tf, c: store.get(s.upper(), []),
                         cache_key=lambda kind, s: f"sig:{kind}:{s}")
    assert list(rsp.last_timing()["stages"]) == ["bars", "compute"]


def test_the_columns_route_carries_the_rs_server_timing_header(monkeypatch, v2_row):
    """The route turns the record into a header; a body is unchanged by it."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.middleware.auth_middleware import get_current_user_with_plan
    from api.routers import signature as sig
    from api.services.cache import cache
    monkeypatch.setattr(cache, "get", lambda k: None)
    monkeypatch.setattr(cache, "set", lambda k, v, ttl: None)
    monkeypatch.setattr(rsp, "_rs_data_generation", lambda now=None: "r-|e-")
    store = _long_daily(n=300)
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", lambda s, tf, count=400: store.get(s.upper(), []))
    app = FastAPI()
    app.include_router(sig.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: {"id": 1, "plan": "pro", "role": "user"}
    monkeypatch.setattr(sig, "is_paid_user", lambda u: True)
    r = TestClient(app).get("/api/signature/columns", params={"defId": "rsLine", "sym": "NVDA", "tf": "D"})
    assert r.status_code == 200, r.text
    st = r.headers.get("server-timing", "")
    assert st.startswith('rs;desc="cold";dur=') and "rs-compute;dur=" in st, st
    assert "payload" in r.json()


# ── Phase 3 (unit 3-06): the v4 envelope's budget ─────────────────────────────
#
# Measured on the same box and fixture, 2026-11-07 (median of 20 cold builds):
# * 5,000-bar daily, v4: envelope JSON 711,861 bytes under the Ratio view (the
#   widest: the ratio family is six places), 677,964 Quality, 680,667 VARS;
#   build median 334 / 386 / 300 ms against v3's 299 ms on the same run. The
#   six Phase 3 columns add one family of values and five of nulls. Byte budget
#   1,070,000 (~1.5x the widest); time budget the v3 one (~3x the median).
#   Clenow's O(n·w) fit is computed on the tail the chart shows (`count` +
#   window) and only under the Quality view; the block reads one window.
# * 600-bar daily, v4: envelope JSON 90,720 bytes (v3: 71,851 on the same run), pinned within 2%.
BYTES_BUDGET_5000_V4 = 1_070_000
SIZE_600_PIN_V4 = 90_720


@pytest.fixture
def lane_v4(monkeypatch, lane):
    from api.services.signature import registry_defs as rd
    monkeypatch.setitem(rd._BY_ID, "rsLine", rd._rs_line_row(True, True))
    return lane


@pytest.mark.parametrize("view", ["ratio", "rotation", "quality", "vars"])
def test_the_v4_5000_bar_payload_stays_under_its_byte_budget(view, lane_v4, monkeypatch):
    monkeypatch.setitem(INPUTS, "view", view)
    env = lane_v4(_long_daily(n=5000))
    assert len(env["times"]) == 5000 and env["payload"]["inputs"]["view"] == view
    size = _wire_bytes(env)
    assert size < BYTES_BUDGET_5000_V4, (
        f"the 5,000-bar v4 RS envelope ({view}) is {size} bytes, over its {BYTES_BUDGET_5000_V4} budget")


@pytest.mark.parametrize("view", ["ratio", "quality"])
def test_the_v4_5000_bar_compute_stays_under_its_time_budget(view, lane_v4, monkeypatch):
    monkeypatch.setitem(INPUTS, "view", view)
    store = _long_daily(n=5000)
    lane_v4(store)
    runs = []
    for _ in range(3):
        t = time.perf_counter()
        lane_v4(store)
        runs.append((time.perf_counter() - t) * 1000.0)
    med = statistics.median(runs)
    assert med < MS_BUDGET_5000, f"5,000-bar v4 ({view}) build median {med:.0f} ms (runs {runs}), budget {MS_BUDGET_5000} ms"


def test_the_v4_600_bar_payload_size_is_pinned(lane_v4):
    env = lane_v4(_long_daily(n=600))
    size = _wire_bytes(env)
    assert abs(size - SIZE_600_PIN_V4) <= SIZE_600_PIN_V4 * 0.02, (
        f"the 600-bar v4 RS envelope is {size} bytes; pinned at {SIZE_600_PIN_V4} (2% band). "
        "Re-measure and move the pin if the change is intended.")


def test_the_v4_phase3_work_is_bounded_to_the_tail_the_chart_shows(lane_v4, monkeypatch):
    """Handed 5,000 bars, the Phase 3 columns are computed on `count` plus the
    reading's warm-up only (the pod's fetch already returns `count`): the bars
    before that are padding, never an O(n·w) fit."""
    from api.services import relative_strength as rsmod
    seen = []
    real = rsmod.clenow_columns
    monkeypatch.setattr(rsmod, "clenow_columns", lambda bars, *a, **k: seen.append(len(bars)) or real(bars, *a, **k))
    monkeypatch.setitem(INPUTS, "view", "quality")
    env = lane_v4(_long_daily(n=5000))
    count = rsp._rs_bars_count("D", env["payload"]["inputs"]["lookback"])
    assert seen and max(seen) <= count + env["payload"]["inputs"]["clenowWindow"], seen
    assert all(v is None for v in env["columns"]["clenowScore"][:5000 - count - 90])
