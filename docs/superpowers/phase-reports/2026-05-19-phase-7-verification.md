# Phase 7 Verification Report

**Date:** 2026-05-19T21:48:21.996095
**Overall:** WARN

## Summary

| Check | Status | Result |
|---|---|---|
| Test Suite | ✅ PASS | 1907/1907 passing (7.38s) |
| Detector Inventory | ✅ PASS | 85 detector(s) registered (0.34s) |
| Schema Integrity | ✅ PASS | all 4 tables + 4 indexes present (0.04s) |
| Live API Smoke | ⚠️  WARN | skipped (--skip-api) (0.00s) |
| Fixture Batteries | ✅ PASS | 1290/1290 fixtures pass across 86 detector(s) (0.40s) |
| False-Positive Sweep | ⚠️  WARN | sweep across 2000 synthetic bars; median rate 0.00/1k; 1 flagged (0.12s) |
| Performance Bench | ✅ PASS | p99 latency across [200, 500, 1000]: 15.65ms, 19.03ms, 74.36ms (1.77s) |
| Confidence Distribution | ✅ PASS | distribution across 8 stored detection(s), 1 pattern(s) (0.00s) |
| Cross-Detector Consistency | ✅ PASS | 85 detector(s) emit valid Detection schema, no duplicates (0.00s) |
| Launch Readiness | ⚠️  WARN | PRE-LAUNCH (showPatterns default OFF) — 1 issue(s) (0.02s) |

## Details

### ✅ Test Suite — PASS

1907/1907 passing (7.38s)

```
..\AppData\Roaming\Python\Python314\site-packages\fastapi\routing.py:233: 766 warnings
  C:\Users\Patrick\AppData\Roaming\Python\Python314\site-packages\fastapi\routing.py:233: DeprecationWarning: 'asyncio.iscoroutinefunction' is deprecated and slated for removal in Python 3.16; use inspect.iscoroutinefunction() instead
    is_coroutine = asyncio.iscoroutinefunction(dependant.call)

..\AppData\Roaming\Python\Python314\site-packages\starlette\_utils.py:39: 776 warnings
tests/pattern_engine/test_admin_router.py: 3 warnings
tests/pattern_engine/test_router_patterns.py: 1 warning
tests/pattern_engine/test_scan_endpoint.py: 1 warning
  C:\Users\Patrick\AppData\Roaming\Python\Python314\site-packages\starlette\_utils.py:39: DeprecationWarning: 'asyncio.iscoroutinefunction' is deprecated and slated for removal in Python 3.16; use inspect.iscoroutinefunction() instead
    return asyncio.iscoroutinefunction(obj) or (callable(obj) and asyncio.iscoroutinefunction(obj.__call__))

..\AppData\Roaming\Python\Python314\site-packages\slowapi\extension.py:717: 29 warnings
  C:\Users\Patrick\AppData\Roaming\Python\Python314\site-packages\slowapi\extension.py:717: DeprecationWarning: 'asyncio.iscoroutinefunction' is deprecated and slated for removal in Python 3.16; use inspect.iscoroutinefunction() instead
    if asyncio.iscoroutinefunction(func):

tests/pattern_engine/detectors/test_52w_proximity.py::test_52w_proximity_fixture[at_exact_52w_high]
  C:\Users\Patrick\AppData\Roaming\Python\Python314\site-packages\pytest_asyncio\plugin.py:1056: DeprecationWarning: 'asyncio.get_event_loop_policy' is deprecated and slated for removal in Python 3.16
    return asyncio.get_event_loop_policy()

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
1907 passed, 9 xfailed, 53125 warnings in 6.24s
C:\Users\Patrick\AppData\Roaming\Python\Python314\site-packages\pytest_asyncio\plugin.py:208: PytestDeprecationWarning: The configuration option "asyncio_default_fixture_loop_scope" is unset.
The event loop scope for asynchronous fixtures will default to the fixture caching scope. Future versions of pytest-asyncio will default the loop scope for asynchronous fixtures to function scope. Set the default fixture loop scope explicitly in order to avoid unexpected behavior in the future. Valid fixture loop scopes are: "function", "class", "module", "package", "session"

  warnings.warn(PytestDeprecationWarning(_DEFAULT_FIXTURE_LOOP_SCOPE_UNSET))
```

### ✅ Detector Inventory — PASS

85 detector(s) registered (0.34s)

| pattern_id | category |
|---|---|
| `52w_proximity` | structure |
| `accumulation_distribution` | structure |
| `ascending_triangle` | classical |
| `avwap_reclaim` | uct |
| `bear_flag` | classical |
| `bearish_engulfing` | candlestick |
| `bearish_harami` | candlestick |
| `bollinger_squeeze` | classical |
| `bull_flag` | classical |
| `bullish_engulfing` | candlestick |
| `bullish_harami` | candlestick |
| `can_slim_composite` | uct |
| `channel` | classical |
| `cup_handle` | classical |
| `cup_handle_uct` | uct |
| `dark_cloud_cover` | candlestick |
| `death_cross` | classical |
| `descending_triangle` | classical |
| `doji` | candlestick |
| `donchian_breakout` | classical |
| `double_bottom` | classical |
| `double_top` | classical |
| `episodic_pivot` | uct |
| `evening_star` | candlestick |
| `falling_wedge` | classical |
| `flat_base` | uct |
| `golden_cross` | classical |
| `hammer` | candlestick |
| `hanging_man` | candlestick |
| `head_shoulders` | classical |
| `high_tight_flag` | uct |
| `higher_low_continuation` | classical |
| `holy_grail` | uct |
| `inside_bar_breakout` | classical |
| `inverse_cup_handle` | classical |
| `inverse_head_shoulders` | classical |
| `kell_cycle` | uct |
| `lance_opening_drive` | uct |
| `liquid_leader_filter` | uct |
| `macd_bearish_cross` | classical |
| `macd_bullish_cross` | classical |
| `major_trendlines` | structure |
| `marubozu` | candlestick |
| `morning_star` | candlestick |
| `nr7` | classical |
| `opening_range_breakdown` | uct |
| `opening_range_breakout` | uct |
| `outside_bar` | classical |
| `parabolic_short` | uct |
| `pennant` | classical |
| `piercing` | candlestick |
| `power_earnings_gap` | uct |
| `pullback_to_10ema` | uct |
| `pullback_to_200sma` | uct |
| `pullback_to_21ema` | uct |
| `pullback_to_50sma` | uct |
| `qullamaggie_setup` | uct |
| `range_detection` | structure |
| `rectangle` | classical |
| `remount` | uct |
| `rising_wedge` | classical |
| `rounded_base` | classical |
| `rounded_top` | classical |
| `rsi_bearish_divergence` | classical |
| `rsi_bullish_divergence` | classical |
| `shooting_star` | candlestick |
| `stage_analysis` | structure |
| `support_resistance` | structure |
| `swing_pivots` | structure |
| `symmetrical_triangle` | classical |
| `td_sequential_buy` | classical |
| `td_sequential_sell` | classical |
| `three_black_crows` | candlestick |
| `three_white_soldiers` | candlestick |
| `triple_bottom` | classical |
| `triple_top` | classical |
| `tweezer_bottom` | candlestick |
| `tweezer_top` | candlestick |
| `u_and_r` | uct |
| `vcp` | uct |
| `volume_profile_nodes` | structure |
| `vsa_no_demand` | classical |
| `vsa_no_supply` | classical |
| `wyckoff_spring` | uct |
| `wyckoff_upthrust` | uct |

### ✅ Schema Integrity — PASS

all 4 tables + 4 indexes present (0.04s)

Tables: ['pattern_detections', 'pattern_feedback', 'pattern_outcomes', 'pattern_stats']
Indexes: ['idx_page_views_created', 'idx_page_views_page', 'idx_page_views_user', 'idx_password_resets_token', 'idx_pd_pattern', 'idx_pd_status', 'idx_pd_sym_tf', 'idx_pf_detection', 'idx_playbooks_user']
pattern_detections has hash_key column: True

### ⚠️  Live API Smoke — WARN

skipped (--skip-api) (0.00s)

### ✅ Fixture Batteries — PASS

1290/1290 fixtures pass across 86 detector(s) (0.40s)

| pattern | fixtures | pass | fail |
|---|---|---|---|
| `52w_proximity` | 15 | 15 | 0 |
| `__pycache__` | — | — | (no detector registered) |
| `accumulation_distribution` | 15 | 15 | 0 |
| `ascending_triangle` | 15 | 15 | 0 |
| `avwap_reclaim` | 15 | 15 | 0 |
| `bear_flag` | 15 | 15 | 0 |
| `bearish_engulfing` | 15 | 15 | 0 |
| `bearish_harami` | 15 | 15 | 0 |
| `bollinger_squeeze` | 15 | 15 | 0 |
| `bull_flag` | 15 | 15 | 0 |
| `bullish_engulfing` | 15 | 15 | 0 |
| `bullish_harami` | 15 | 15 | 0 |
| `can_slim_composite` | 15 | 15 | 0 |
| `channel` | 15 | 15 | 0 |
| `cup_handle` | 16 | 16 | 0 |
| `cup_handle_uct` | 15 | 15 | 0 |
| `dark_cloud_cover` | 15 | 15 | 0 |
| `death_cross` | 16 | 16 | 0 |
| `descending_triangle` | 15 | 15 | 0 |
| `doji` | 15 | 15 | 0 |
| `donchian_breakout` | 15 | 15 | 0 |
| `double_bottom` | 16 | 16 | 0 |
| `double_top` | 16 | 16 | 0 |
| `episodic_pivot` | 15 | 15 | 0 |
| `evening_star` | 15 | 15 | 0 |
| `falling_wedge` | 15 | 15 | 0 |
| `flat_base` | 15 | 15 | 0 |
| `golden_cross` | 17 | 17 | 0 |
| `hammer` | 15 | 15 | 0 |
| `hanging_man` | 15 | 15 | 0 |
| `head_shoulders` | 15 | 15 | 0 |
| `high_tight_flag` | 15 | 15 | 0 |
| `higher_low_continuation` | 15 | 15 | 0 |
| `holy_grail` | 15 | 15 | 0 |
| `inside_bar_breakout` | 15 | 15 | 0 |
| `inverse_cup_handle` | 15 | 15 | 0 |
| `inverse_head_shoulders` | 15 | 15 | 0 |
| `kell_cycle` | 15 | 15 | 0 |
| `lance_opening_drive` | 16 | 16 | 0 |
| `liquid_leader_filter` | 15 | 15 | 0 |
| `macd_bearish_cross` | 15 | 15 | 0 |
| `macd_bullish_cross` | 15 | 15 | 0 |
| `major_trendlines` | 15 | 15 | 0 |
| `marubozu` | 17 | 17 | 0 |
| `morning_star` | 15 | 15 | 0 |
| `nr7` | 17 | 17 | 0 |
| `opening_range_breakdown` | 15 | 15 | 0 |
| `opening_range_breakout` | 15 | 15 | 0 |
| `outside_bar` | 15 | 15 | 0 |
| `parabolic_short` | 15 | 15 | 0 |
| `pennant` | 15 | 15 | 0 |
| `piercing` | 15 | 15 | 0 |
| `power_earnings_gap` | 15 | 15 | 0 |
| `pullback_to_10ema` | 15 | 15 | 0 |
| `pullback_to_200sma` | 15 | 15 | 0 |
| `pullback_to_21ema` | 15 | 15 | 0 |
| `pullback_to_50sma` | 15 | 15 | 0 |
| `qullamaggie_setup` | 15 | 15 | 0 |
| `range_detection` | 15 | 15 | 0 |
| `rectangle` | 15 | 15 | 0 |
| `remount` | 15 | 15 | 0 |
| `rising_wedge` | 15 | 15 | 0 |
| `rounded_base` | 15 | 15 | 0 |
| `rounded_top` | 15 | 15 | 0 |
| `rsi_bearish_divergence` | 15 | 15 | 0 |
| `rsi_bullish_divergence` | 15 | 15 | 0 |
| `shooting_star` | 15 | 15 | 0 |
| `stage_analysis` | 15 | 15 | 0 |
| `support_resistance` | 15 | 15 | 0 |
| `swing_pivots` | 15 | 15 | 0 |
| `symmetrical_triangle` | 15 | 15 | 0 |
| `td_sequential_buy` | 15 | 15 | 0 |
| `td_sequential_sell` | 15 | 15 | 0 |
| `three_black_crows` | 15 | 15 | 0 |
| `three_white_soldiers` | 15 | 15 | 0 |
| `triple_bottom` | 15 | 15 | 0 |
| `triple_top` | 15 | 15 | 0 |
| `tweezer_bottom` | 17 | 17 | 0 |
| `tweezer_top` | 17 | 17 | 0 |
| `u_and_r` | 15 | 15 | 0 |
| `vcp` | 15 | 15 | 0 |
| `volume_profile_nodes` | 15 | 15 | 0 |
| `vsa_no_demand` | 15 | 15 | 0 |
| `vsa_no_supply` | 15 | 15 | 0 |
| `wyckoff_spring` | 15 | 15 | 0 |
| `wyckoff_upthrust` | 15 | 15 | 0 |

### ⚠️  False-Positive Sweep — WARN

sweep across 2000 synthetic bars; median rate 0.00/1k; 1 flagged (0.12s)

| pattern | detections | rate (per 1000 bars) | flag |
|---|---|---|---|
| `52w_proximity` | 10 | 5.0 |  |
| `accumulation_distribution` | 10 | 5.0 |  |
| `ascending_triangle` | 0 | 0.0 |  |
| `avwap_reclaim` | 0 | 0.0 |  |
| `bear_flag` | 0 | 0.0 |  |
| `bearish_engulfing` | 1 | 0.5 |  |
| `bearish_harami` | 0 | 0.0 |  |
| `bollinger_squeeze` | 0 | 0.0 |  |
| `bull_flag` | 0 | 0.0 |  |
| `bullish_engulfing` | 1 | 0.5 |  |
| `bullish_harami` | 0 | 0.0 |  |
| `can_slim_composite` | 10 | 5.0 |  |
| `channel` | 0 | 0.0 |  |
| `cup_handle` | 0 | 0.0 |  |
| `cup_handle_uct` | 0 | 0.0 |  |
| `dark_cloud_cover` | 0 | 0.0 |  |
| `death_cross` | 0 | 0.0 |  |
| `descending_triangle` | 1 | 0.5 |  |
| `doji` | 0 | 0.0 |  |
| `donchian_breakout` | 4 | 2.0 |  |
| `double_bottom` | 2 | 1.0 |  |
| `double_top` | 0 | 0.0 |  |
| `episodic_pivot` | 0 | 0.0 |  |
| `evening_star` | 1 | 0.5 |  |
| `falling_wedge` | 0 | 0.0 |  |
| `flat_base` | 0 | 0.0 |  |
| `golden_cross` | 0 | 0.0 |  |
| `hammer` | 0 | 0.0 |  |
| `hanging_man` | 0 | 0.0 |  |
| `head_shoulders` | 1 | 0.5 |  |
| `high_tight_flag` | 0 | 0.0 |  |
| `higher_low_continuation` | 0 | 0.0 |  |
| `holy_grail` | 0 | 0.0 |  |
| `inside_bar_breakout` | 0 | 0.0 |  |
| `inverse_cup_handle` | 0 | 0.0 |  |
| `inverse_head_shoulders` | 3 | 1.5 |  |
| `kell_cycle` | 10 | 5.0 |  |
| `lance_opening_drive` | 0 | 0.0 |  |
| `liquid_leader_filter` | 0 | 0.0 |  |
| `macd_bearish_cross` | 0 | 0.0 |  |
| `macd_bullish_cross` | 1 | 0.5 |  |
| `major_trendlines` | 2 | 1.0 |  |
| `marubozu` | 0 | 0.0 |  |
| `morning_star` | 0 | 0.0 |  |
| `nr7` | 0 | 0.0 |  |
| `opening_range_breakdown` | 0 | 0.0 |  |
| `opening_range_breakout` | 0 | 0.0 |  |
| `outside_bar` | 0 | 0.0 |  |
| `parabolic_short` | 0 | 0.0 |  |
| `pennant` | 0 | 0.0 |  |
| `piercing` | 0 | 0.0 |  |
| `power_earnings_gap` | 0 | 0.0 |  |
| `pullback_to_10ema` | 2 | 1.0 |  |
| `pullback_to_200sma` | 0 | 0.0 |  |
| `pullback_to_21ema` | 0 | 0.0 |  |
| `pullback_to_50sma` | 0 | 0.0 |  |
| `qullamaggie_setup` | 0 | 0.0 |  |
| `range_detection` | 9 | 4.5 |  |
| `rectangle` | 0 | 0.0 |  |
| `remount` | 0 | 0.0 |  |
| `rising_wedge` | 0 | 0.0 |  |
| `rounded_base` | 0 | 0.0 |  |
| `rounded_top` | 0 | 0.0 |  |
| `rsi_bearish_divergence` | 0 | 0.0 |  |
| `rsi_bullish_divergence` | 0 | 0.0 |  |
| `shooting_star` | 0 | 0.0 |  |
| `stage_analysis` | 10 | 5.0 |  |
| `support_resistance` | 11 | 5.5 |  |
| `swing_pivots` | 5 | 2.5 |  |
| `symmetrical_triangle` | 0 | 0.0 |  |
| `td_sequential_buy` | 6 | 3.0 |  |
| `td_sequential_sell` | 2 | 1.0 |  |
| `three_black_crows` | 0 | 0.0 |  |
| `three_white_soldiers` | 0 | 0.0 |  |
| `triple_bottom` | 0 | 0.0 |  |
| `triple_top` | 0 | 0.0 |  |
| `tweezer_bottom` | 5 | 2.5 |  |
| `tweezer_top` | 4 | 2.0 |  |
| `u_and_r` | 1 | 0.5 |  |
| `vcp` | 0 | 0.0 |  |
| `volume_profile_nodes` | 21 | 10.5 | ⚠ high |
| `vsa_no_demand` | 0 | 0.0 |  |
| `vsa_no_supply` | 0 | 0.0 |  |
| `wyckoff_spring` | 0 | 0.0 |  |
| `wyckoff_upthrust` | 0 | 0.0 |  |

### ✅ Performance Bench — PASS

p99 latency across [200, 500, 1000]: 15.65ms, 19.03ms, 74.36ms (1.77s)

| bar count | p50 (ms) | p95 (ms) | p99 (ms) | target | result |
|---|---|---|---|---|---|
| 200 | 13.39 | 15.65 | 15.65 | <100.0ms p99 | ✅ |
| 500 | 17.99 | 19.03 | 19.03 | <100.0ms p99 | ✅ |
| 1000 | 55.79 | 74.36 | 74.36 | <200.0ms p99 | ✅ |

### ✅ Confidence Distribution — PASS

distribution across 8 stored detection(s), 1 pattern(s) (0.00s)

| pattern | n | <50 | 50-60 | 60-70 | 70-80 | 80-90 | 90+ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `bull_flag` | 8 | 0 | 0 | 0 | 2 | 6 | 0 |

### ✅ Cross-Detector Consistency — PASS

85 detector(s) emit valid Detection schema, no duplicates (0.00s)

### ⚠️  Launch Readiness — WARN

PRE-LAUNCH (showPatterns default OFF) — 1 issue(s) (0.02s)

- chartDefaults.showPatterns: **false** — overlay default OFF (pre-launch)
- Gate 4 evidence: ⚠️ no calibration backtest report found in `C:\Users\Patrick\uct-dashboard\docs\superpowers\phase-reports`
- Gate 5 evidence: no admin reviews yet — start at https://uctintelligence.com/admin/patterns
- Detector count: **85** ✅ (catalog complete)
- Launch checklist: ✅ `docs/operations/phase-7-launch-checklist.md`
- Gate 5 runbook: ✅ `docs/operations/gate-5-shadow-mode-runbook.md`
- Pattern recognition spec: ✅ `docs/superpowers/specs/2026-05-11-pattern-recognition-design.md`

**Open issues:**
- No Gate 4 calibration backtest report — run `python scripts/calibration_backtest.py` before launch

