# tests/test_theme_performance.py
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from api.main import app
from api.services.cache import cache as _real_cache
from tests.authclients import PAID_MEMBER, signed_in_as


# ── Task 1 tests ──────────────────────────────────────────────────────────────

def test_get_agg_bars_returns_results():
    """get_agg_bars returns a list of bar dicts on success."""
    mock_response = {
        "status": "OK",
        "results": [
            {"t": 1700000000000, "o": 10.0, "h": 11.0, "l": 9.5, "c": 10.5, "v": 100000},
            {"t": 1700086400000, "o": 10.5, "h": 12.0, "l": 10.0, "c": 11.0, "v": 120000},
        ]
    }
    with patch("api.services.massive._get_client") as mock_client_fn:
        mock_client = MagicMock()
        mock_client._get.return_value = mock_response
        mock_client_fn.return_value = mock_client

        from api.services.massive import get_agg_bars
        bars = get_agg_bars("RKLB", "2025-01-01", "2026-03-18")

    assert len(bars) == 2
    assert bars[0]["c"] == 10.5


def test_get_agg_bars_returns_empty_on_error():
    """get_agg_bars returns [] on any exception (graceful degradation)."""
    with patch("api.services.massive._get_client") as mock_client_fn:
        mock_client_fn.side_effect = RuntimeError("Massive unavailable")

        from api.services.massive import get_agg_bars
        bars = get_agg_bars("RKLB", "2025-01-01", "2026-03-18")

    assert bars == []


# ── Task 2 tests ──────────────────────────────────────────────────────────────

def test_compute_returns_all_periods():
    """_compute_returns returns correct values for all 6 periods."""
    from api.services.theme_performance import _compute_returns

    # Build fake bars: 300 daily bars, closing prices 1..300
    from datetime import datetime, timedelta

    base_ms = int(datetime(2025, 1, 2).timestamp() * 1000)
    day_ms = 86400 * 1000
    bars = [
        {"t": base_ms + i * day_ms, "c": float(i + 1)}
        for i in range(300)
    ]

    result = _compute_returns(bars)

    # Last close = 300, prev close = 299 → 1D ≈ +0.33%
    assert result["1d"] == pytest.approx((300 - 299) / 299 * 100, abs=0.01)
    # 5 sessions ago = bar[294] = close 295 → 1W ≈ +1.69%
    assert result["1w"] == pytest.approx((300 - 295) / 295 * 100, abs=0.01)
    # All periods are floats (not None)
    for key in ("1d", "1w", "1m", "3m", "1y", "ytd"):
        assert result[key] is not None


def test_compute_returns_handles_sparse_bars():
    """_compute_returns returns available periods when bars < full history."""
    from api.services.theme_performance import _compute_returns

    # Only 3 bars — can compute 1D, but not 1W/1M/etc (falls back to first bar)
    bars = [
        {"t": 1700000000000, "c": 100.0},
        {"t": 1700086400000, "c": 105.0},
        {"t": 1700172800000, "c": 110.0},
    ]
    result = _compute_returns(bars)
    assert result["1d"] == pytest.approx((110 - 105) / 105 * 100, abs=0.01)
    # When not enough bars, falls back to first bar close (100.0)
    assert result["1w"] == pytest.approx((110 - 100) / 100 * 100, abs=0.01)


def test_compute_returns_empty_bars():
    """_compute_returns returns all None for empty bar list."""
    from api.services.theme_performance import _compute_returns

    result = _compute_returns([])
    for key in ("1d", "1w", "1m", "3m", "1y", "ytd"):
        assert result[key] is None


def _run_computation_and_capture(MOCK_WIRE, FAKE_BARS):
    """Drive _run_computation synchronously, capture the dict it persists.

    get_theme_performance() is a non-blocking wrapper that defers to a
    background thread + disk cache. Tests target the inner builder.

    Test isolation: a prior test (e.g. one that hit get_theme_performance
    via TestClient) may have spawned a background compute thread still
    running real wire_data. We wait for it to finish before patching,
    then track call_args from our synchronous call only.
    """
    import time
    from api.services import theme_performance as tp

    # Wait for any inflight background computation from a prior test
    deadline = time.monotonic() + 5.0
    while tp._computing and time.monotonic() < deadline:
        time.sleep(0.05)

    with patch("api.services.theme_performance._load_wire_data", return_value=MOCK_WIRE), \
         patch("api.services.theme_performance.get_agg_bars", return_value=FAKE_BARS), \
         patch("api.services.theme_performance._save_to_disk"), \
         patch.object(tp.theme_db, "get_all_themes",
                      return_value={"themes": [], "sectors": []}), \
         patch.object(_real_cache, "set", wraps=_real_cache.set) as mock_set, \
         patch.object(_real_cache, "invalidate", wraps=_real_cache.invalidate):
        # Patching the METHOD on the real singleton (not replacing the whole
        # `cache` module-level name) so a call routed through
        # `cache_policy.set_by_completeness` (a DIFFERENT module's `cache`
        # reference to the same object) is captured too — `patch("...cache")`
        # only intercepts calls made via theme_performance's own name binding.
        # Task 4: _run_computation unions wire holdings with the merged
        # theme-DB membership — pin the taxonomy empty so a machine-local
        # seeded auth.db can't leak extra holdings into the shape asserts.
        # Snapshot the call count before our sync run so we ignore any
        # late-arriving writes from a different code path.
        before = len(mock_set.call_args_list)
        tp._run_computation()
        new_calls = mock_set.call_args_list[before:]
        result = None
        for call in new_calls:
            if call.args and call.args[0] == tp._CACHE_KEY:
                result = call.args[1]
                break
    return result


def test_build_theme_performance_shape():
    """_run_computation produces correct shape with mocked data."""
    MOCK_WIRE = {
        "themes": {
            "UFO": {
                "name": "Space",
                "etf_name": "Procure Space ETF",
                "holdings": [
                    {"sym": "RKLB", "name": "Rocket Lab", "pct": 8.5},
                    {"sym": "ASTS", "name": "AST SpaceMobile", "pct": 6.1},
                ],
                "intl_holdings": [],
                "1W": 5.2, "1M": 12.3, "3M": 30.1,
            }
        }
    }
    FAKE_BARS = [{"t": 1700000000000 + i * 86400000, "c": float(100 + i)} for i in range(300)]
    result = _run_computation_and_capture(MOCK_WIRE, FAKE_BARS)

    assert result is not None
    assert "themes" in result
    # UCT20 is auto-injected by the service whenever wire data exists,
    # so the result contains UFO + UCT20.
    themes_by_ticker = {t["ticker"]: t for t in result["themes"]}
    assert "UFO" in themes_by_ticker
    ufo = themes_by_ticker["UFO"]
    assert ufo["name"] == "Space"
    assert len(ufo["holdings"]) == 2
    holding = ufo["holdings"][0]
    assert holding["sym"] == "RKLB"
    assert "returns" in holding
    for period in ("1d", "1w", "1m", "3m", "1y", "ytd"):
        assert period in holding["returns"]


def test_build_theme_performance_no_wire_data():
    """_run_computation persists empty themes when wire_data unavailable."""
    result = _run_computation_and_capture(MOCK_WIRE=None, FAKE_BARS=[])
    assert result is not None
    assert result["themes"] == []


# ── data-dependability C13: universe-wide return-fetch failure must not ──────
# ── get "status": "ok" at the full TTL + a permanent disk persist ───────────

def _run_computation_full(MOCK_WIRE, FAKE_BARS):
    """Like _run_computation_and_capture but also returns the ttl passed to
    cache.set and the _save_to_disk mock, so the completeness gate (ttl +
    persist-or-not) can be asserted directly."""
    import time
    from api.services import theme_performance as tp

    deadline = time.monotonic() + 5.0
    while tp._computing and time.monotonic() < deadline:
        time.sleep(0.05)

    with patch("api.services.theme_performance._load_wire_data", return_value=MOCK_WIRE), \
         patch("api.services.theme_performance.get_agg_bars", return_value=FAKE_BARS), \
         patch("api.services.theme_performance._save_to_disk") as mock_save, \
         patch.object(tp.theme_db, "get_all_themes",
                      return_value={"themes": [], "sectors": []}), \
         patch.object(_real_cache, "set", wraps=_real_cache.set) as mock_set, \
         patch.object(_real_cache, "invalidate", wraps=_real_cache.invalidate):
        before = len(mock_set.call_args_list)
        tp._run_computation()
        new_calls = mock_set.call_args_list[before:]
        result, ttl = None, None
        for call in new_calls:
            if call.args and call.args[0] == tp._CACHE_KEY:
                result = call.args[1]
                ttl = call.kwargs.get("ttl", call.args[2] if len(call.args) > 2 else None)
                break
        save_call_count = mock_save.call_count
    return result, ttl, save_call_count


_MOCK_WIRE_ONE_THEME = {
    "themes": {
        "UFO": {
            "name": "Space", "etf_name": "Procure Space ETF",
            "holdings": [{"sym": "RKLB", "name": "Rocket Lab", "pct": 8.5}],
            "intl_holdings": [], "1W": 5.2, "1M": 12.3, "3M": 30.1,
        }
    }
}


def test_universe_wide_return_failure_gets_short_ttl_and_is_not_persisted():
    """Every symbol's return fetch failing at once (e.g. Massive fully down)
    used to still stamp "status": "ok" and persist to disk at the full 15-min
    TTL -- `_load_from_disk` then serves that all-null snapshot for up to 26h.
    """
    result, ttl, save_calls = _run_computation_full(_MOCK_WIRE_ONE_THEME, FAKE_BARS=[])

    assert result is not None
    from api.services import theme_performance as tp
    assert ttl <= tp._CACHE_FAIL_TTL + 1
    assert ttl < tp._CACHE_TTL
    assert save_calls == 0, "an all-null pass must NOT reach the disk persist"


def test_healthy_returns_get_the_full_ttl_and_are_persisted():
    """Control: real bar data flowing through must still get the normal 15-
    min TTL and the disk persist (this predicate must not blanket-block it)."""
    FAKE_BARS = [{"t": 1700000000000 + i * 86400000, "c": float(100 + i)} for i in range(300)]
    result, ttl, save_calls = _run_computation_full(_MOCK_WIRE_ONE_THEME, FAKE_BARS)

    assert result is not None
    from api.services import theme_performance as tp
    assert ttl > tp._CACHE_FAIL_TTL
    assert ttl == tp._CACHE_TTL
    assert save_calls == 1


# ── Task 3 tests ──────────────────────────────────────────────────────────────

def test_theme_performance_endpoint_returns_200():
    """GET /api/theme-performance returns 200 with correct shape."""
    MOCK_RESULT = {
        "themes": [{"name": "Space", "ticker": "UFO", "etf_name": "Procure Space ETF", "holdings": []}],
        "generated_at": "2026-03-18T09:00:00",
    }

    # Patch at the service level (not the router alias) so the mock is reliable
    # even when api.main is already cached in sys.modules from prior test imports.
    # `/api/theme-performance` is `require_paid` since the 2026-08-09 auth
    # sweep; this is a shape test, so it gets the caller it always implied. The
    # gate is owned by tests/test_exposed_routes_gated.py, asserted once, there.
    with patch("api.services.theme_performance.get_theme_performance", return_value=MOCK_RESULT), \
            signed_in_as(PAID_MEMBER):
        client = TestClient(app)
        resp = client.get("/api/theme-performance")

    assert resp.status_code == 200
    data = resp.json()
    assert "themes" in data
    assert "generated_at" in data


# ── Task 4 tests ──────────────────────────────────────────────────────────────

def test_uct20_pulls_from_leadership():
    """UCT20 theme uses wire_data['leadership'] symbols, not a static list."""
    MOCK_WIRE = {
        "themes": {
            "UCT20": {
                "name": "UCT 20",
                "etf_name": "UCT Intelligence Leadership 20",
                "holdings": [],  # empty static list
            }
        },
        "leadership": [
            {"sym": "NVDA", "name": "Nvidia", "rank": 1},
            {"sym": "TSLA", "name": "Tesla", "rank": 2},
            {"sym": "MRVL", "name": "Marvell", "rank": 3},
        ]
    }
    FAKE_BARS = [{"t": 1700000000000 + i * 86400000, "c": float(100 + i)} for i in range(300)]
    result = _run_computation_and_capture(MOCK_WIRE, FAKE_BARS)

    assert result is not None
    themes = {t["ticker"]: t for t in result["themes"]}
    assert "UCT20" in themes
    syms = [h["sym"] for h in themes["UCT20"]["holdings"]]
    assert "NVDA" in syms
    assert "TSLA" in syms
    assert "MRVL" in syms


def test_excluded_themes_not_in_output():
    """URA, IBB, FXI, MSOS are filtered out even if present in wire_data."""
    MOCK_WIRE = {
        "themes": {
            "UFO": {
                "name": "Space",
                "etf_name": "Procure Space ETF",
                "holdings": [{"sym": "RKLB", "name": "Rocket Lab", "pct": 8.5}],
            },
            "URA": {
                "name": "Uranium",
                "etf_name": "Global X Uranium ETF",
                "holdings": [{"sym": "CCJ", "name": "Cameco", "pct": 20.0}],
            },
            "MSOS": {
                "name": "Cannabis",
                "etf_name": "AdvisorShares Cannabis ETF",
                "holdings": [{"sym": "CURA", "name": "Curaleaf", "pct": 10.0}],
            },
        }
    }
    FAKE_BARS = [{"t": 1700000000000 + i * 86400000, "c": float(100 + i)} for i in range(10)]
    result = _run_computation_and_capture(MOCK_WIRE, FAKE_BARS)

    assert result is not None
    tickers = [t["ticker"] for t in result["themes"]]
    assert "UFO" in tickers
    assert "URA" not in tickers
    assert "MSOS" not in tickers
