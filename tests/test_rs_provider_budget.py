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
#   Rev 5 (Deepvue round 2, 2026-11-08): 96,931 bytes, re-measured on the same
#   fixture: the RS Rating Reading's two columns (all-null outside that view,
#   ~3 kB each at 600 bars), `rating.m9` and the `ratingHistory` block.
BYTES_BUDGET_5000_V4 = 1_070_000
SIZE_600_PIN_V4 = 96_931


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


# ── Deepvue round 2 (2026-11-08, `compute.rev` 5): the RS Rating Reading ──────
#
# The Reading's one extra read is `rs_history.rating_series`: a walk of the
# `(ticker, session)` index for the chart's bars plus 20, from a real SQLite
# file (`EXPLAIN QUERY PLAN`: `SEARCH ... USING INDEX idx_rsh_ticker (ticker=?
# AND session<?)`, pinned in tests/test_rs_rating_view.py). Measured on the same
# box (study venv, 2026-11-08), 5,000 daily bars over a store of 1,300 stored
# sessions x 60 tickers (78,000 rows; five trading years, the deepest the
# backfill writes, plus the nightly's), median of 5 cold builds:
# * build: rating view 460 ms against 427 ms for the ratio view on the same run,
#   inside the 1,500 ms budget the other views carry;
# * the `rating` stage (the nightly row read, stubbed here, plus the series
#   read): median 9.3 ms; the series read alone 5.1 ms at limit 5,020 and 4.0 ms
#   at the default chart's 872. ⚠️ At this store size an unindexed scan is about
#   as fast (4.7 ms), so the time budget is NOT what proves the index: the query
#   plan rail is. The budget catches a read that grows with the store or a
#   second read per bar.
# * envelope: 5,000-bar rating view 782,083 bytes, inside the v4 byte budget.
RATING_STORE_SESSIONS = 1_300
RATING_STORE_TICKERS = 60
#: The `rating` stage under the RS Rating view, ms: measured median 9.3 ms;
#: ~3x, so a slow box does not flake while a per-bar read pattern still reds.
MS_BUDGET_RATING_READ = 30.0


def _dated(store: dict, n: int) -> dict:
    """`_long_daily`'s bars on weekday YYYYMMDD keys ending 2026-11-06 (the
    rating history is keyed by session date; the fixture's `t` is a counter)."""
    import datetime as _dt
    days, d = [], _dt.date(2026, 11, 6)
    while len(days) < n:
        if d.weekday() < 5:
            days.append(int(d.strftime("%Y%m%d")))
        d -= _dt.timedelta(days=1)
    days.sort()
    return {s: [dict(b, t=t) for b, t in zip(bars, days)] for s, bars in store.items()}, days


@pytest.fixture
def rating_store(tmp_path, monkeypatch):
    import sqlite3
    from api.services.screener import rs_history
    path = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    monkeypatch.setenv("RS_HISTORY_ENABLED", "1")
    store, days = _dated(_long_daily(n=5000), 5000)
    sessions = [f"{str(t)[:4]}-{str(t)[4:6]}-{str(t)[6:]}" for t in days[-RATING_STORE_SESSIONS:]]
    tickers = ["NVDA"] + [f"T{i:03d}" for i in range(RATING_STORE_TICKERS - 1)]
    conn = sqlite3.connect(path)
    rs_history.ensure_schema(conn)
    conn.executemany(
        f"INSERT INTO {rs_history.TABLE} (session, ticker, ibd, m1, m3, m6, m9, m12, score, bars) "
        "VALUES (?, ?, ?, 50, 50, 50, 50, 50, 1.0, 253)",
        [(s, t, 1 + (i * 7 + j) % 99) for i, s in enumerate(sessions) for j, t in enumerate(tickers)])
    conn.commit()
    conn.close()
    return store


@pytest.fixture
def lane_rating(monkeypatch, lane_v4, rating_store):
    monkeypatch.setitem(INPUTS, "view", "rating")
    return lambda: lane_v4(rating_store)


def test_the_rating_view_5000_bar_payload_stays_under_the_v4_byte_budget(lane_rating):
    env = lane_rating()
    assert len(env["times"]) == 5000
    assert sum(1 for v in env["columns"]["ratingLine"] if v is not None) == RATING_STORE_SESSIONS
    size = _wire_bytes(env)
    assert size < BYTES_BUDGET_5000_V4, f"the 5,000-bar rating-view envelope is {size} bytes"


def test_the_rating_view_5000_bar_compute_and_its_read_stay_in_budget(lane_rating, lane_v4, rating_store,
                                                                     monkeypatch):
    lane_rating()                                           # warm the imports and the file cache
    runs, reads = [], []
    for _ in range(5):
        t = time.perf_counter()
        lane_rating()
        runs.append((time.perf_counter() - t) * 1000.0)
        reads.append(rsp.last_timing()["stages"]["rating"])
    med, read = statistics.median(runs), statistics.median(reads)
    monkeypatch.setitem(INPUTS, "view", "ratio")
    ratio = []
    for _ in range(5):
        t = time.perf_counter()
        lane_v4(rating_store)
        ratio.append((time.perf_counter() - t) * 1000.0)
    print(f"[measure] 5000 bars: rating view build median {med:.0f} ms (ratio view {statistics.median(ratio):.0f} ms), "
          f"rating stage median {read:.2f} ms, envelope {_wire_bytes(lane_rating())} bytes")
    assert med < MS_BUDGET_5000, f"5,000-bar rating-view build median {med:.0f} ms (runs {runs})"
    assert read < MS_BUDGET_RATING_READ, f"the rating stage median {read:.1f} ms (runs {reads})"


# ── RS split (unit U4, 2026-11-09): the three new envelopes' budgets ──────────
#
# Measured on the same box and fixture (study venv, 2026-11-09), median of 5
# cold builds, the shared core reset before every build so each one pays the
# bars read. Each envelope is a fraction of the RS line's: two or three columns
# and a payload of a few scalar blocks (no regime, sensitivity, checks or
# evidence; `test_none_of_the_three_reads_regime_sensitivity_or_evidence` in
# tests/test_rs_split_rows.py holds that).
# * 5,000-bar daily: rsRating 75,525 bytes with the history dark (93,859 over
#   the 1,300-session `rating_store`, the widest), build median 10 ms;
#   rsPhases 84,121 bytes, 171 ms (the 63-bar z-score window re-summed per
#   bar); rsVsEma 136,070 bytes, 45 ms.
# * 600-bar daily: rsRating 9,523, rsPhases 10,458, rsVsEma 16,569 bytes,
#   pinned within 2%.
# Byte budgets ~1.5x the widest measured; the time budget is the RS line's
# own 1,500 ms (~9x the slowest median).
BYTES_BUDGET_5000_SPLIT = {"rsRating": 140_000, "rsPhases": 130_000, "rsVsEma": 210_000}
#: 600-bar daily, pinned within 2% (the same band as the RS line's pins).
SIZE_600_PIN_SPLIT = {"rsRating": 9_523, "rsPhases": 10_458, "rsVsEma": 16_569}
MS_BUDGET_5000_SPLIT = 1_500.0

_SPLIT_FNS = {"rsRating": "rs_rating_envelope", "rsPhases": "rs_phases_envelope", "rsVsEma": "rs_vs_ema_envelope"}


@pytest.fixture
def lane_split(monkeypatch):
    """The three envelopes with their I/O pinned like `lane`: a store-backed
    fetcher, a cache that never hits, a constant data generation, and the
    shared core reset before every build so each one is a full cold path."""
    from api.services.cache import cache
    monkeypatch.setattr(cache, "get", lambda k: None)
    monkeypatch.setattr(cache, "set", lambda k, v, ttl: None)
    monkeypatch.setattr(rsp, "_rs_data_generation", lambda now=None: "r-|e-")
    monkeypatch.setattr(rb, "_groups_for", lambda s: {"sector": "Technology", "industry": "Semiconductors"})

    def build(def_id: str, store: dict, inputs: dict | None = None, *, reset: bool = True) -> dict:
        if reset:
            rsp.rs_core_reset()

        def fetch(sym, tf, count):
            return list(store.get(sym.upper(), []))
        fn = getattr(rsp, _SPLIT_FNS[def_id])
        return fn("NVDA", "D", dict(inputs or {"benchmark": "SPY"}), fetch_bars=fetch,
                  cache_key=lambda kind, s: f"sig:{kind}:{s}")
    yield build
    rsp.rs_core_reset()


@pytest.mark.parametrize("def_id", sorted(_SPLIT_FNS))
def test_each_split_5000_bar_payload_stays_under_its_byte_budget(def_id, lane_split):
    env = lane_split(def_id, _long_daily(n=5000))
    assert len(env["times"]) == 5000
    size = _wire_bytes(env)
    assert size < BYTES_BUDGET_5000_SPLIT[def_id], (
        f"the 5,000-bar {def_id} envelope is {size} bytes, over its {BYTES_BUDGET_5000_SPLIT[def_id]} budget")


@pytest.mark.parametrize("def_id", sorted(_SPLIT_FNS))
def test_each_split_5000_bar_compute_stays_under_its_time_budget(def_id, lane_split):
    store = _long_daily(n=5000)
    lane_split(def_id, store)                          # warm the imports
    runs = []
    for _ in range(3):
        t = time.perf_counter()
        lane_split(def_id, store)
        runs.append((time.perf_counter() - t) * 1000.0)
    med = statistics.median(runs)
    assert med < MS_BUDGET_5000_SPLIT, f"5,000-bar {def_id} build median {med:.0f} ms (runs {runs})"


@pytest.mark.parametrize("def_id", sorted(_SPLIT_FNS))
def test_each_split_600_bar_payload_size_is_pinned(def_id, lane_split):
    env = lane_split(def_id, _long_daily(n=600))
    size = _wire_bytes(env)
    pin = SIZE_600_PIN_SPLIT[def_id]
    print(f"[measure] 600 bars: {def_id} envelope {size} bytes")
    assert abs(size - pin) <= pin * 0.02, (
        f"the 600-bar {def_id} envelope is {size} bytes; pinned at {pin} (2% band). "
        "Re-measure and move the pin if the change is intended.")


def test_the_three_on_one_chart_cost_one_bars_read_and_record_their_timing(lane_split, monkeypatch):
    """The shared core: after the first envelope on a cycle the other two read
    no bars (their ``bars`` stage is ~0), and each records a cold timing with
    ``bars`` and ``compute`` (``rating`` on the rating one), never ``evidence``."""
    store = _long_daily(n=600)
    reads = []
    real = dict(store)

    def counting_store():
        class S(dict):
            def get(self, k, d=None):
                reads.append(k)
                return real.get(k, d)
        return S()
    first = True
    for def_id in ("rsVsEma", "rsPhases", "rsRating"):
        rsp.timing_reset()
        lane_split(def_id, counting_store(), reset=first)
        first = False
        rec = rsp.last_timing()
        assert rec["tier"] == "cold" and "evidence" not in rec["stages"], (def_id, rec)
        assert list(rec["stages"]) == (["bars", "rating", "compute"] if def_id == "rsRating" else ["bars", "compute"])
    assert reads == ["NVDA", "SPY"], reads


def test_the_rating_envelope_over_a_real_history_stays_in_budget(lane_split, rating_store):
    """The daily rating envelope over the 1,300-session store: one bounded
    indexed read (`rs_history.rating_series`) and the 5,000-bar envelope
    inside its byte budget."""
    env = lane_split("rsRating", rating_store)
    assert len(env["times"]) == 5000
    assert sum(1 for v in env["columns"]["ratingLine"] if v is not None) == RATING_STORE_SESSIONS
    assert env["payload"]["ratingHistory"]["reason"] is None
    assert _wire_bytes(env) < BYTES_BUDGET_5000_SPLIT["rsRating"]
    reads = []
    for _ in range(5):
        lane_split("rsRating", rating_store)
        reads.append(rsp.last_timing()["stages"]["rating"])
    assert statistics.median(reads) < MS_BUDGET_RATING_READ, reads
