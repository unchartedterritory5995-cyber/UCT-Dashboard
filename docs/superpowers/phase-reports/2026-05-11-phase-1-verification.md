# Phase 1 Verification Report

**Date:** 2026-05-11T21:41:37.641843
**Overall:** PASS

## Summary

| Check | Status | Result |
|---|---|---|
| Test Suite | ✅ PASS | 245/245 passing (2.45s) |
| Detector Inventory | ✅ PASS | 11 detector(s) registered (0.27s) |
| Schema Integrity | ✅ PASS | all 4 tables + 4 indexes present (0.01s) |
| Live API Smoke | ✅ PASS | 3/3 endpoints OK (0.57s) |
| Fixture Batteries | ✅ PASS | 168/168 fixtures pass across 11 detector(s) (0.08s) |
| False-Positive Sweep | ✅ PASS | sweep across 2000 synthetic bars; median rate 0.00/1k; 0 flagged (0.02s) |
| Performance Bench | ✅ PASS | p99 latency across [200, 500, 1000]: 2.62ms, 6.54ms, 11.5ms (0.38s) |
| Confidence Distribution | ✅ PASS | distribution across 7 stored detection(s), 2 pattern(s) (0.00s) |
| Cross-Detector Consistency | ✅ PASS | 11 detector(s) emit valid Detection schema, no duplicates (0.00s) |

## Details

### ✅ Test Suite — PASS

245/245 passing (2.45s)

```
    return asyncio.iscoroutinefunction(func)

..\AppData\Roaming\Python\Python314\site-packages\fastapi\routing.py:233: 671 warnings
  C:\Users\Patrick\AppData\Roaming\Python\Python314\site-packages\fastapi\routing.py:233: DeprecationWarning: 'asyncio.iscoroutinefunction' is deprecated and slated for removal in Python 3.16; use inspect.iscoroutinefunction() instead
    is_coroutine = asyncio.iscoroutinefunction(dependant.call)

..\AppData\Roaming\Python\Python314\site-packages\starlette\_utils.py:39: 679 warnings
tests/pattern_engine/test_router_patterns.py: 1 warning
  C:\Users\Patrick\AppData\Roaming\Python\Python314\site-packages\starlette\_utils.py:39: DeprecationWarning: 'asyncio.iscoroutinefunction' is deprecated and slated for removal in Python 3.16; use inspect.iscoroutinefunction() instead
    return asyncio.iscoroutinefunction(obj) or (callable(obj) and asyncio.iscoroutinefunction(obj.__call__))

..\AppData\Roaming\Python\Python314\site-packages\slowapi\extension.py:717: 18 warnings
  C:\Users\Patrick\AppData\Roaming\Python\Python314\site-packages\slowapi\extension.py:717: DeprecationWarning: 'asyncio.iscoroutinefunction' is deprecated and slated for removal in Python 3.16; use inspect.iscoroutinefunction() instead
    if asyncio.iscoroutinefunction(func):

tests/pattern_engine/detectors/test_bear_flag.py::test_bear_flag_fixture[ascending_flag]
  C:\Users\Patrick\AppData\Roaming\Python\Python314\site-packages\pytest_asyncio\plugin.py:1056: DeprecationWarning: 'asyncio.get_event_loop_policy' is deprecated and slated for removal in Python 3.16
    return asyncio.get_event_loop_policy()

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
245 passed, 5946 warnings in 1.83s
C:\Users\Patrick\AppData\Roaming\Python\Python314\site-packages\pytest_asyncio\plugin.py:208: PytestDeprecationWarning: The configuration option "asyncio_default_fixture_loop_scope" is unset.
The event loop scope for asynchronous fixtures will default to the fixture caching scope. Future versions of pytest-asyncio will default the loop scope for asynchronous fixtures to function scope. Set the default fixture loop scope explicitly in order to avoid unexpected behavior in the future. Valid fixture loop scopes are: "function", "class", "module", "package", "session"

  warnings.warn(PytestDeprecationWarning(_DEFAULT_FIXTURE_LOOP_SCOPE_UNSET))
```

### ✅ Detector Inventory — PASS

11 detector(s) registered (0.27s)

| pattern_id | category |
|---|---|
| `bear_flag` | classical |
| `bull_flag` | classical |
| `cup_handle` | classical |
| `double_bottom` | classical |
| `double_top` | classical |
| `falling_wedge` | classical |
| `head_shoulders` | classical |
| `inverse_cup_handle` | classical |
| `inverse_head_shoulders` | classical |
| `pennant` | classical |
| `rising_wedge` | classical |

### ✅ Schema Integrity — PASS

all 4 tables + 4 indexes present (0.01s)

Tables: ['pattern_detections', 'pattern_feedback', 'pattern_outcomes', 'pattern_stats']
Indexes: ['idx_page_views_created', 'idx_page_views_page', 'idx_page_views_user', 'idx_password_resets_token', 'idx_pd_pattern', 'idx_pd_status', 'idx_pd_sym_tf', 'idx_pf_detection', 'idx_playbooks_user']
pattern_detections has hash_key column: True

### ✅ Live API Smoke — PASS

3/3 endpoints OK (0.57s)

| Endpoint | Status | Detail |
|---|---|---|
| GET /api/patterns/types | PASS | 11 types |
| GET /api/patterns/AAPL | PASS | 0 detections |
| POST feedback (bad rating) | PASS | rejected with 400 |

### ✅ Fixture Batteries — PASS

168/168 fixtures pass across 11 detector(s) (0.08s)

| pattern | fixtures | pass | fail |
|---|---|---|---|
| `bear_flag` | 15 | 15 | 0 |
| `bull_flag` | 15 | 15 | 0 |
| `cup_handle` | 16 | 16 | 0 |
| `double_bottom` | 16 | 16 | 0 |
| `double_top` | 16 | 16 | 0 |
| `falling_wedge` | 15 | 15 | 0 |
| `head_shoulders` | 15 | 15 | 0 |
| `inverse_cup_handle` | 15 | 15 | 0 |
| `inverse_head_shoulders` | 15 | 15 | 0 |
| `pennant` | 15 | 15 | 0 |
| `rising_wedge` | 15 | 15 | 0 |

### ✅ False-Positive Sweep — PASS

sweep across 2000 synthetic bars; median rate 0.00/1k; 0 flagged (0.02s)

| pattern | detections | rate (per 1000 bars) | flag |
|---|---|---|---|
| `bear_flag` | 0 | 0.0 |  |
| `bull_flag` | 0 | 0.0 |  |
| `cup_handle` | 0 | 0.0 |  |
| `double_bottom` | 1 | 0.5 |  |
| `double_top` | 0 | 0.0 |  |
| `falling_wedge` | 0 | 0.0 |  |
| `head_shoulders` | 1 | 0.5 |  |
| `inverse_cup_handle` | 0 | 0.0 |  |
| `inverse_head_shoulders` | 1 | 0.5 |  |
| `pennant` | 0 | 0.0 |  |
| `rising_wedge` | 0 | 0.0 |  |

### ✅ Performance Bench — PASS

p99 latency across [200, 500, 1000]: 2.62ms, 6.54ms, 11.5ms (0.38s)

| bar count | p50 (ms) | p95 (ms) | p99 (ms) | target | result |
|---|---|---|---|---|---|
| 200 | 2.42 | 2.62 | 2.62 | <100.0ms p99 | ✅ |
| 500 | 5.42 | 6.54 | 6.54 | <100.0ms p99 | ✅ |
| 1000 | 10.71 | 11.5 | 11.5 | <200.0ms p99 | ✅ |

### ✅ Confidence Distribution — PASS

distribution across 7 stored detection(s), 2 pattern(s) (0.00s)

| pattern | n | <50 | 50-60 | 60-70 | 70-80 | 80-90 | 90+ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `bull_flag` | 6 | 0 | 0 | 0 | 4 | 2 | 0 |
| `cup_handle` | 1 | 0 | 0 | 0 | 1 | 0 | 0 |

### ✅ Cross-Detector Consistency — PASS

11 detector(s) emit valid Detection schema, no duplicates (0.00s)

