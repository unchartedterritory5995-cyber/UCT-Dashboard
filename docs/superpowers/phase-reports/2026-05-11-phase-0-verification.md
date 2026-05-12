# Phase 0 Verification Report

**Date:** 2026-05-11T20:11:56.074092
**Overall:** PASS

## Summary

| Check | Status | Result |
|---|---|---|
| Test Suite | ✅ PASS | 82/82 passing (2.16s) |
| Detector Inventory | ✅ PASS | 1 detector(s) registered (0.30s) |
| Schema Integrity | ✅ PASS | all 4 tables + 4 indexes present (0.01s) |
| Live API Smoke | ✅ PASS | 3/3 endpoints OK (0.55s) |
| Fixture Batteries | ✅ PASS | 15/15 fixtures pass across 1 detector(s) (0.00s) |
| False-Positive Sweep | ✅ PASS | sweep across 2000 synthetic bars; median rate 0.00/1k; 0 flagged (0.00s) |
| Performance Bench | ✅ PASS | p99 latency across [200, 500, 1000]: 0.17ms, 0.46ms, 0.95ms (0.03s) |
| Confidence Distribution | ✅ PASS | distribution across 7 stored detection(s), 2 pattern(s) (0.00s) |
| Cross-Detector Consistency | ✅ PASS | 1 detector(s) emit valid Detection schema, no duplicates (0.00s) |

## Details

### ✅ Test Suite — PASS

82/82 passing (2.16s)

```
    return asyncio.iscoroutinefunction(func)

..\AppData\Roaming\Python\Python314\site-packages\fastapi\routing.py:233: 643 warnings
  C:\Users\Patrick\AppData\Roaming\Python\Python314\site-packages\fastapi\routing.py:233: DeprecationWarning: 'asyncio.iscoroutinefunction' is deprecated and slated for removal in Python 3.16; use inspect.iscoroutinefunction() instead
    is_coroutine = asyncio.iscoroutinefunction(dependant.call)

..\AppData\Roaming\Python\Python314\site-packages\starlette\_utils.py:39: 651 warnings
tests/pattern_engine/test_router_patterns.py: 1 warning
  C:\Users\Patrick\AppData\Roaming\Python\Python314\site-packages\starlette\_utils.py:39: DeprecationWarning: 'asyncio.iscoroutinefunction' is deprecated and slated for removal in Python 3.16; use inspect.iscoroutinefunction() instead
    return asyncio.iscoroutinefunction(obj) or (callable(obj) and asyncio.iscoroutinefunction(obj.__call__))

..\AppData\Roaming\Python\Python314\site-packages\slowapi\extension.py:717: 15 warnings
  C:\Users\Patrick\AppData\Roaming\Python\Python314\site-packages\slowapi\extension.py:717: DeprecationWarning: 'asyncio.iscoroutinefunction' is deprecated and slated for removal in Python 3.16; use inspect.iscoroutinefunction() instead
    if asyncio.iscoroutinefunction(func):

tests/pattern_engine/detectors/test_bull_flag.py::test_bull_flag_fixture[ascending_flag_in_downtrend]
  C:\Users\Patrick\AppData\Roaming\Python\Python314\site-packages\pytest_asyncio\plugin.py:1056: DeprecationWarning: 'asyncio.get_event_loop_policy' is deprecated and slated for removal in Python 3.16
    return asyncio.get_event_loop_policy()

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
82 passed, 4252 warnings in 1.54s
C:\Users\Patrick\AppData\Roaming\Python\Python314\site-packages\pytest_asyncio\plugin.py:208: PytestDeprecationWarning: The configuration option "asyncio_default_fixture_loop_scope" is unset.
The event loop scope for asynchronous fixtures will default to the fixture caching scope. Future versions of pytest-asyncio will default the loop scope for asynchronous fixtures to function scope. Set the default fixture loop scope explicitly in order to avoid unexpected behavior in the future. Valid fixture loop scopes are: "function", "class", "module", "package", "session"

  warnings.warn(PytestDeprecationWarning(_DEFAULT_FIXTURE_LOOP_SCOPE_UNSET))
```

### ✅ Detector Inventory — PASS

1 detector(s) registered (0.30s)

| pattern_id | category |
|---|---|
| `bull_flag` | classical |

### ✅ Schema Integrity — PASS

all 4 tables + 4 indexes present (0.01s)

Tables: ['pattern_detections', 'pattern_feedback', 'pattern_outcomes', 'pattern_stats']
Indexes: ['idx_page_views_created', 'idx_page_views_page', 'idx_page_views_user', 'idx_password_resets_token', 'idx_pd_pattern', 'idx_pd_status', 'idx_pd_sym_tf', 'idx_pf_detection', 'idx_playbooks_user']
pattern_detections has hash_key column: True

### ✅ Live API Smoke — PASS

3/3 endpoints OK (0.55s)

| Endpoint | Status | Detail |
|---|---|---|
| GET /api/patterns/types | PASS | 1 types |
| GET /api/patterns/AAPL | PASS | 0 detections |
| POST feedback (bad rating) | PASS | rejected with 400 |

### ✅ Fixture Batteries — PASS

15/15 fixtures pass across 1 detector(s) (0.00s)

| pattern | fixtures | pass | fail |
|---|---|---|---|
| `bull_flag` | 15 | 15 | 0 |

### ✅ False-Positive Sweep — PASS

sweep across 2000 synthetic bars; median rate 0.00/1k; 0 flagged (0.00s)

| pattern | detections | rate (per 1000 bars) | flag |
|---|---|---|---|
| `bull_flag` | 0 | 0.0 |  |

### ✅ Performance Bench — PASS

p99 latency across [200, 500, 1000]: 0.17ms, 0.46ms, 0.95ms (0.03s)

| bar count | p50 (ms) | p95 (ms) | p99 (ms) | target | result |
|---|---|---|---|---|---|
| 200 | 0.16 | 0.17 | 0.17 | <100.0ms p99 | ✅ |
| 500 | 0.43 | 0.46 | 0.46 | <100.0ms p99 | ✅ |
| 1000 | 0.87 | 0.95 | 0.95 | <200.0ms p99 | ✅ |

### ✅ Confidence Distribution — PASS

distribution across 7 stored detection(s), 2 pattern(s) (0.00s)

| pattern | n | <50 | 50-60 | 60-70 | 70-80 | 80-90 | 90+ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `bull_flag` | 6 | 0 | 0 | 0 | 4 | 2 | 0 |
| `cup_handle` | 1 | 0 | 0 | 0 | 1 | 0 | 0 |

### ✅ Cross-Detector Consistency — PASS

1 detector(s) emit valid Detection schema, no duplicates (0.00s)

