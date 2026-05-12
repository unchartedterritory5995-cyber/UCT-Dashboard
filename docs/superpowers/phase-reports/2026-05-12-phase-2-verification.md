# Phase 2 Verification Report

**Date:** 2026-05-12T10:42:35.917448
**Overall:** PASS

## Summary

| Check | Status | Result |
|---|---|---|
| Test Suite | ✅ PASS | 469/469 passing (2.90s) |
| Detector Inventory | ✅ PASS | 23 detector(s) registered (0.29s) |
| Schema Integrity | ✅ PASS | all 4 tables + 4 indexes present (0.01s) |
| Live API Smoke | ✅ PASS | 3/3 endpoints OK (0.47s) |
| Fixture Batteries | ✅ PASS | 348/348 fixtures pass across 23 detector(s) (0.15s) |
| False-Positive Sweep | ✅ PASS | sweep across 2000 synthetic bars; median rate 0.00/1k; 0 flagged (0.06s) |
| Performance Bench | ✅ PASS | p99 latency across [200, 500, 1000]: 8.19ms, 10.22ms, 21.86ms (0.74s) |
| Confidence Distribution | ✅ PASS | distribution across 7 stored detection(s), 2 pattern(s) (0.00s) |
| Cross-Detector Consistency | ✅ PASS | 23 detector(s) emit valid Detection schema, no duplicates (0.00s) |

## Details

### ✅ Test Suite — PASS

469/469 passing (2.90s)

```
    return asyncio.iscoroutinefunction(func)

..\AppData\Roaming\Python\Python314\site-packages\fastapi\routing.py:233: 735 warnings
  C:\Users\Patrick\AppData\Roaming\Python\Python314\site-packages\fastapi\routing.py:233: DeprecationWarning: 'asyncio.iscoroutinefunction' is deprecated and slated for removal in Python 3.16; use inspect.iscoroutinefunction() instead
    is_coroutine = asyncio.iscoroutinefunction(dependant.call)

..\AppData\Roaming\Python\Python314\site-packages\starlette\_utils.py:39: 743 warnings
tests/pattern_engine/test_router_patterns.py: 1 warning
  C:\Users\Patrick\AppData\Roaming\Python\Python314\site-packages\starlette\_utils.py:39: DeprecationWarning: 'asyncio.iscoroutinefunction' is deprecated and slated for removal in Python 3.16; use inspect.iscoroutinefunction() instead
    return asyncio.iscoroutinefunction(obj) or (callable(obj) and asyncio.iscoroutinefunction(obj.__call__))

..\AppData\Roaming\Python\Python314\site-packages\slowapi\extension.py:717: 26 warnings
  C:\Users\Patrick\AppData\Roaming\Python\Python314\site-packages\slowapi\extension.py:717: DeprecationWarning: 'asyncio.iscoroutinefunction' is deprecated and slated for removal in Python 3.16; use inspect.iscoroutinefunction() instead
    if asyncio.iscoroutinefunction(func):

tests/pattern_engine/detectors/test_bear_flag.py::test_bear_flag_fixture[ascending_flag]
  C:\Users\Patrick\AppData\Roaming\Python\Python314\site-packages\pytest_asyncio\plugin.py:1056: DeprecationWarning: 'asyncio.get_event_loop_policy' is deprecated and slated for removal in Python 3.16
    return asyncio.get_event_loop_policy()

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
469 passed, 9954 warnings in 2.23s
C:\Users\Patrick\AppData\Roaming\Python\Python314\site-packages\pytest_asyncio\plugin.py:208: PytestDeprecationWarning: The configuration option "asyncio_default_fixture_loop_scope" is unset.
The event loop scope for asynchronous fixtures will default to the fixture caching scope. Future versions of pytest-asyncio will default the loop scope for asynchronous fixtures to function scope. Set the default fixture loop scope explicitly in order to avoid unexpected behavior in the future. Valid fixture loop scopes are: "function", "class", "module", "package", "session"

  warnings.warn(PytestDeprecationWarning(_DEFAULT_FIXTURE_LOOP_SCOPE_UNSET))
```

### ✅ Detector Inventory — PASS

23 detector(s) registered (0.29s)

| pattern_id | category |
|---|---|
| `bear_flag` | classical |
| `bull_flag` | classical |
| `cup_handle` | classical |
| `cup_handle_uct` | uct |
| `double_bottom` | classical |
| `double_top` | classical |
| `episodic_pivot` | uct |
| `falling_wedge` | classical |
| `flat_base` | uct |
| `head_shoulders` | classical |
| `high_tight_flag` | uct |
| `inverse_cup_handle` | classical |
| `inverse_head_shoulders` | classical |
| `major_trendlines` | structure |
| `pennant` | classical |
| `power_earnings_gap` | uct |
| `remount` | uct |
| `rising_wedge` | classical |
| `stage_analysis` | structure |
| `support_resistance` | structure |
| `swing_pivots` | structure |
| `u_and_r` | uct |
| `vcp` | uct |

### ✅ Schema Integrity — PASS

all 4 tables + 4 indexes present (0.01s)

Tables: ['pattern_detections', 'pattern_feedback', 'pattern_outcomes', 'pattern_stats']
Indexes: ['idx_page_views_created', 'idx_page_views_page', 'idx_page_views_user', 'idx_password_resets_token', 'idx_pd_pattern', 'idx_pd_status', 'idx_pd_sym_tf', 'idx_pf_detection', 'idx_playbooks_user']
pattern_detections has hash_key column: True

### ✅ Live API Smoke — PASS

3/3 endpoints OK (0.47s)

| Endpoint | Status | Detail |
|---|---|---|
| GET /api/patterns/types | PASS | 23 types |
| GET /api/patterns/AAPL | PASS | 0 detections |
| POST feedback (bad rating) | PASS | rejected with 400 |

### ✅ Fixture Batteries — PASS

348/348 fixtures pass across 23 detector(s) (0.15s)

| pattern | fixtures | pass | fail |
|---|---|---|---|
| `bear_flag` | 15 | 15 | 0 |
| `bull_flag` | 15 | 15 | 0 |
| `cup_handle` | 16 | 16 | 0 |
| `cup_handle_uct` | 15 | 15 | 0 |
| `double_bottom` | 16 | 16 | 0 |
| `double_top` | 16 | 16 | 0 |
| `episodic_pivot` | 15 | 15 | 0 |
| `falling_wedge` | 15 | 15 | 0 |
| `flat_base` | 15 | 15 | 0 |
| `head_shoulders` | 15 | 15 | 0 |
| `high_tight_flag` | 15 | 15 | 0 |
| `inverse_cup_handle` | 15 | 15 | 0 |
| `inverse_head_shoulders` | 15 | 15 | 0 |
| `major_trendlines` | 15 | 15 | 0 |
| `pennant` | 15 | 15 | 0 |
| `power_earnings_gap` | 15 | 15 | 0 |
| `remount` | 15 | 15 | 0 |
| `rising_wedge` | 15 | 15 | 0 |
| `stage_analysis` | 15 | 15 | 0 |
| `support_resistance` | 15 | 15 | 0 |
| `swing_pivots` | 15 | 15 | 0 |
| `u_and_r` | 15 | 15 | 0 |
| `vcp` | 15 | 15 | 0 |

### ✅ False-Positive Sweep — PASS

sweep across 2000 synthetic bars; median rate 0.00/1k; 0 flagged (0.06s)

| pattern | detections | rate (per 1000 bars) | flag |
|---|---|---|---|
| `bear_flag` | 0 | 0.0 |  |
| `bull_flag` | 0 | 0.0 |  |
| `cup_handle` | 0 | 0.0 |  |
| `cup_handle_uct` | 0 | 0.0 |  |
| `double_bottom` | 1 | 0.5 |  |
| `double_top` | 0 | 0.0 |  |
| `episodic_pivot` | 0 | 0.0 |  |
| `falling_wedge` | 0 | 0.0 |  |
| `flat_base` | 0 | 0.0 |  |
| `head_shoulders` | 1 | 0.5 |  |
| `high_tight_flag` | 0 | 0.0 |  |
| `inverse_cup_handle` | 0 | 0.0 |  |
| `inverse_head_shoulders` | 1 | 0.5 |  |
| `major_trendlines` | 2 | 1.0 |  |
| `pennant` | 0 | 0.0 |  |
| `power_earnings_gap` | 0 | 0.0 |  |
| `remount` | 0 | 0.0 |  |
| `rising_wedge` | 0 | 0.0 |  |
| `stage_analysis` | 10 | 5.0 |  |
| `support_resistance` | 11 | 5.5 |  |
| `swing_pivots` | 5 | 2.5 |  |
| `u_and_r` | 1 | 0.5 |  |
| `vcp` | 0 | 0.0 |  |

### ✅ Performance Bench — PASS

p99 latency across [200, 500, 1000]: 8.19ms, 10.22ms, 21.86ms (0.74s)

| bar count | p50 (ms) | p95 (ms) | p99 (ms) | target | result |
|---|---|---|---|---|---|
| 200 | 7.0 | 8.19 | 8.19 | <100.0ms p99 | ✅ |
| 500 | 8.62 | 10.22 | 10.22 | <100.0ms p99 | ✅ |
| 1000 | 21.27 | 21.86 | 21.86 | <200.0ms p99 | ✅ |

### ✅ Confidence Distribution — PASS

distribution across 7 stored detection(s), 2 pattern(s) (0.00s)

| pattern | n | <50 | 50-60 | 60-70 | 70-80 | 80-90 | 90+ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `bull_flag` | 6 | 0 | 0 | 0 | 4 | 2 | 0 |
| `cup_handle` | 1 | 0 | 0 | 0 | 1 | 0 | 0 |

### ✅ Cross-Detector Consistency — PASS

23 detector(s) emit valid Detection schema, no duplicates (0.00s)

