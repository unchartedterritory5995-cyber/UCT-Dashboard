# Phase 3 Verification Report

**Date:** 2026-05-12T20:51:57.521579
**Overall:** PASS

## Summary

| Check | Status | Result |
|---|---|---|
| Test Suite | ✅ PASS | 760/760 passing (3.82s) |
| Detector Inventory | ✅ PASS | 37 detector(s) registered (0.31s) |
| Schema Integrity | ✅ PASS | all 4 tables + 4 indexes present (0.01s) |
| Live API Smoke | ✅ PASS | 3/3 endpoints OK (0.50s) |
| Fixture Batteries | ✅ PASS | 558/558 fixtures pass across 37 detector(s) (0.19s) |
| False-Positive Sweep | ✅ PASS | sweep across 2000 synthetic bars; median rate 0.00/1k; 0 flagged (0.06s) |
| Performance Bench | ✅ PASS | p99 latency across [200, 500, 1000]: 9.13ms, 11.15ms, 33.83ms (0.83s) |
| Confidence Distribution | ✅ PASS | distribution across 7 stored detection(s), 2 pattern(s) (0.01s) |
| Cross-Detector Consistency | ✅ PASS | 37 detector(s) emit valid Detection schema, no duplicates (0.00s) |

## Details

### ✅ Test Suite — PASS

760/760 passing (3.82s)

```
    return asyncio.iscoroutinefunction(func)

..\AppData\Roaming\Python\Python314\site-packages\fastapi\routing.py:233: 745 warnings
  C:\Users\Patrick\AppData\Roaming\Python\Python314\site-packages\fastapi\routing.py:233: DeprecationWarning: 'asyncio.iscoroutinefunction' is deprecated and slated for removal in Python 3.16; use inspect.iscoroutinefunction() instead
    is_coroutine = asyncio.iscoroutinefunction(dependant.call)

..\AppData\Roaming\Python\Python314\site-packages\starlette\_utils.py:39: 753 warnings
tests/pattern_engine/test_router_patterns.py: 1 warning
  C:\Users\Patrick\AppData\Roaming\Python\Python314\site-packages\starlette\_utils.py:39: DeprecationWarning: 'asyncio.iscoroutinefunction' is deprecated and slated for removal in Python 3.16; use inspect.iscoroutinefunction() instead
    return asyncio.iscoroutinefunction(obj) or (callable(obj) and asyncio.iscoroutinefunction(obj.__call__))

..\AppData\Roaming\Python\Python314\site-packages\slowapi\extension.py:717: 28 warnings
  C:\Users\Patrick\AppData\Roaming\Python\Python314\site-packages\slowapi\extension.py:717: DeprecationWarning: 'asyncio.iscoroutinefunction' is deprecated and slated for removal in Python 3.16; use inspect.iscoroutinefunction() instead
    if asyncio.iscoroutinefunction(func):

tests/pattern_engine/detectors/test_bear_flag.py::test_bear_flag_fixture[ascending_flag]
  C:\Users\Patrick\AppData\Roaming\Python\Python314\site-packages\pytest_asyncio\plugin.py:1056: DeprecationWarning: 'asyncio.get_event_loop_policy' is deprecated and slated for removal in Python 3.16
    return asyncio.get_event_loop_policy()

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
760 passed, 17084 warnings in 3.01s
C:\Users\Patrick\AppData\Roaming\Python\Python314\site-packages\pytest_asyncio\plugin.py:208: PytestDeprecationWarning: The configuration option "asyncio_default_fixture_loop_scope" is unset.
The event loop scope for asynchronous fixtures will default to the fixture caching scope. Future versions of pytest-asyncio will default the loop scope for asynchronous fixtures to function scope. Set the default fixture loop scope explicitly in order to avoid unexpected behavior in the future. Valid fixture loop scopes are: "function", "class", "module", "package", "session"

  warnings.warn(PytestDeprecationWarning(_DEFAULT_FIXTURE_LOOP_SCOPE_UNSET))
```

### ✅ Detector Inventory — PASS

37 detector(s) registered (0.31s)

| pattern_id | category |
|---|---|
| `bear_flag` | classical |
| `bearish_engulfing` | candlestick |
| `bearish_harami` | candlestick |
| `bull_flag` | classical |
| `bullish_engulfing` | candlestick |
| `bullish_harami` | candlestick |
| `cup_handle` | classical |
| `cup_handle_uct` | uct |
| `dark_cloud_cover` | candlestick |
| `doji` | candlestick |
| `double_bottom` | classical |
| `double_top` | classical |
| `episodic_pivot` | uct |
| `evening_star` | candlestick |
| `falling_wedge` | classical |
| `flat_base` | uct |
| `hammer` | candlestick |
| `hanging_man` | candlestick |
| `head_shoulders` | classical |
| `high_tight_flag` | uct |
| `inverse_cup_handle` | classical |
| `inverse_head_shoulders` | classical |
| `major_trendlines` | structure |
| `morning_star` | candlestick |
| `pennant` | classical |
| `piercing` | candlestick |
| `power_earnings_gap` | uct |
| `remount` | uct |
| `rising_wedge` | classical |
| `shooting_star` | candlestick |
| `stage_analysis` | structure |
| `support_resistance` | structure |
| `swing_pivots` | structure |
| `three_black_crows` | candlestick |
| `three_white_soldiers` | candlestick |
| `u_and_r` | uct |
| `vcp` | uct |

### ✅ Schema Integrity — PASS

all 4 tables + 4 indexes present (0.01s)

Tables: ['pattern_detections', 'pattern_feedback', 'pattern_outcomes', 'pattern_stats']
Indexes: ['idx_page_views_created', 'idx_page_views_page', 'idx_page_views_user', 'idx_password_resets_token', 'idx_pd_pattern', 'idx_pd_status', 'idx_pd_sym_tf', 'idx_pf_detection', 'idx_playbooks_user']
pattern_detections has hash_key column: True

### ✅ Live API Smoke — PASS

3/3 endpoints OK (0.50s)

| Endpoint | Status | Detail |
|---|---|---|
| GET /api/patterns/types | PASS | 37 types |
| GET /api/patterns/AAPL | PASS | 0 detections |
| POST feedback (bad rating) | PASS | rejected with 400 |

### ✅ Fixture Batteries — PASS

558/558 fixtures pass across 37 detector(s) (0.19s)

| pattern | fixtures | pass | fail |
|---|---|---|---|
| `bear_flag` | 15 | 15 | 0 |
| `bearish_engulfing` | 15 | 15 | 0 |
| `bearish_harami` | 15 | 15 | 0 |
| `bull_flag` | 15 | 15 | 0 |
| `bullish_engulfing` | 15 | 15 | 0 |
| `bullish_harami` | 15 | 15 | 0 |
| `cup_handle` | 16 | 16 | 0 |
| `cup_handle_uct` | 15 | 15 | 0 |
| `dark_cloud_cover` | 15 | 15 | 0 |
| `doji` | 15 | 15 | 0 |
| `double_bottom` | 16 | 16 | 0 |
| `double_top` | 16 | 16 | 0 |
| `episodic_pivot` | 15 | 15 | 0 |
| `evening_star` | 15 | 15 | 0 |
| `falling_wedge` | 15 | 15 | 0 |
| `flat_base` | 15 | 15 | 0 |
| `hammer` | 15 | 15 | 0 |
| `hanging_man` | 15 | 15 | 0 |
| `head_shoulders` | 15 | 15 | 0 |
| `high_tight_flag` | 15 | 15 | 0 |
| `inverse_cup_handle` | 15 | 15 | 0 |
| `inverse_head_shoulders` | 15 | 15 | 0 |
| `major_trendlines` | 15 | 15 | 0 |
| `morning_star` | 15 | 15 | 0 |
| `pennant` | 15 | 15 | 0 |
| `piercing` | 15 | 15 | 0 |
| `power_earnings_gap` | 15 | 15 | 0 |
| `remount` | 15 | 15 | 0 |
| `rising_wedge` | 15 | 15 | 0 |
| `shooting_star` | 15 | 15 | 0 |
| `stage_analysis` | 15 | 15 | 0 |
| `support_resistance` | 15 | 15 | 0 |
| `swing_pivots` | 15 | 15 | 0 |
| `three_black_crows` | 15 | 15 | 0 |
| `three_white_soldiers` | 15 | 15 | 0 |
| `u_and_r` | 15 | 15 | 0 |
| `vcp` | 15 | 15 | 0 |

### ✅ False-Positive Sweep — PASS

sweep across 2000 synthetic bars; median rate 0.00/1k; 0 flagged (0.06s)

| pattern | detections | rate (per 1000 bars) | flag |
|---|---|---|---|
| `bear_flag` | 0 | 0.0 |  |
| `bearish_engulfing` | 4 | 2.0 |  |
| `bearish_harami` | 0 | 0.0 |  |
| `bull_flag` | 0 | 0.0 |  |
| `bullish_engulfing` | 2 | 1.0 |  |
| `bullish_harami` | 0 | 0.0 |  |
| `cup_handle` | 0 | 0.0 |  |
| `cup_handle_uct` | 0 | 0.0 |  |
| `dark_cloud_cover` | 0 | 0.0 |  |
| `doji` | 0 | 0.0 |  |
| `double_bottom` | 1 | 0.5 |  |
| `double_top` | 0 | 0.0 |  |
| `episodic_pivot` | 0 | 0.0 |  |
| `evening_star` | 1 | 0.5 |  |
| `falling_wedge` | 0 | 0.0 |  |
| `flat_base` | 0 | 0.0 |  |
| `hammer` | 0 | 0.0 |  |
| `hanging_man` | 0 | 0.0 |  |
| `head_shoulders` | 1 | 0.5 |  |
| `high_tight_flag` | 0 | 0.0 |  |
| `inverse_cup_handle` | 0 | 0.0 |  |
| `inverse_head_shoulders` | 1 | 0.5 |  |
| `major_trendlines` | 2 | 1.0 |  |
| `morning_star` | 0 | 0.0 |  |
| `pennant` | 0 | 0.0 |  |
| `piercing` | 0 | 0.0 |  |
| `power_earnings_gap` | 0 | 0.0 |  |
| `remount` | 0 | 0.0 |  |
| `rising_wedge` | 0 | 0.0 |  |
| `shooting_star` | 0 | 0.0 |  |
| `stage_analysis` | 10 | 5.0 |  |
| `support_resistance` | 11 | 5.5 |  |
| `swing_pivots` | 5 | 2.5 |  |
| `three_black_crows` | 0 | 0.0 |  |
| `three_white_soldiers` | 0 | 0.0 |  |
| `u_and_r` | 1 | 0.5 |  |
| `vcp` | 0 | 0.0 |  |

### ✅ Performance Bench — PASS

p99 latency across [200, 500, 1000]: 9.13ms, 11.15ms, 33.83ms (0.83s)

| bar count | p50 (ms) | p95 (ms) | p99 (ms) | target | result |
|---|---|---|---|---|---|
| 200 | 7.54 | 9.13 | 9.13 | <100.0ms p99 | ✅ |
| 500 | 9.11 | 11.15 | 11.15 | <100.0ms p99 | ✅ |
| 1000 | 23.12 | 33.83 | 33.83 | <200.0ms p99 | ✅ |

### ✅ Confidence Distribution — PASS

distribution across 7 stored detection(s), 2 pattern(s) (0.01s)

| pattern | n | <50 | 50-60 | 60-70 | 70-80 | 80-90 | 90+ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `bull_flag` | 6 | 0 | 0 | 0 | 4 | 2 | 0 |
| `cup_handle` | 1 | 0 | 0 | 0 | 1 | 0 | 0 |

### ✅ Cross-Detector Consistency — PASS

37 detector(s) emit valid Detection schema, no duplicates (0.00s)

