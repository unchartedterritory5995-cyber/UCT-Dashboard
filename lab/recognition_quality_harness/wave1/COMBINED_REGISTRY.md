# UCT Recognition-Quality -- Combined Library Registry

Merges (A) the 3 deep-cycle families, (B) the original 10-detector Tier-1
pilot, (C) the 24 new Wave-1 detectors. 37 of ~85 registered pattern
detectors now have SOME evaluation-quality evidence (DEEP or TIER1); 48
remain NOT_EVALUATED. No composite score is calculated anywhere in this
table by design.

| Detector | Category | Member Value | Eval Depth | Identity Quality | Context Depth | Quality Depth | Freshness-Lifecycle | Geometry | Known Hard Defect | Eval Confidence | Recommended Product Tier | Recommended Action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| hammer | Candlestick | High (canonical) | DEEP | Verified (ADR-scaling fixed) | Present | Present | Fixed | Rich | None open (visual wick-ratio limitation only) | High | BROAD_RELIABLE_LIBRARY | KEEP_HEALTHY |
| bull_flag | Structural | High (canonical) | DEEP | Verified (stale-pole fixed) | Present | Present | 2 declined hard defects (need new primitive) | Rich | 2 residual (documented, undeclined by design) | High | FLAGSHIP_INTELLIGENCE_CANDIDATE | KEEP_HEALTHY (residuals documented) |
| pullback_to_21ema | MA/context | High (canonical, Minervini SEPA) | DEEP | Verified | Present | Present | 3 confirmed gaps ("search bound != freshness") | Minimal (single EMA anchor) | YES -- open, not fixed | High | BROAD_RELIABLE_LIBRARY | FIX_HARD_DEFECT |
| bullish_engulfing | Candlestick | Medium | TIER1 | Suspect | Present | Present | FAILS -- hard-confirmed (BTU) | Semantic | YES | Medium (n=6) | EXPERIMENTAL_SPECIALIZED | ENHANCE_PRODUCT_INTELLIGENCE |
| three_white_soldiers | Candlestick | Medium | TIER1 | Suspect | Present | Present | FAILS -- judge independently spotted it | Semantic | YES | Medium (n=6) | EXPERIMENTAL_SPECIALIZED | ENHANCE_PRODUCT_INTELLIGENCE |
| cup_handle | Classical structural | High | TIER1 | Likely healthy | Present | Present | PASSES (_pattern_already_broken) | Semantic (richest in pilot) | No | Medium (n=6) | BROAD_RELIABLE_LIBRARY | KEEP_HEALTHY |
| head_shoulders | Classical structural | High | TIER1 | Unclear (0/3 TPs) | Present | Present | PASSES architecturally | Semantic | Unresolved | Low (n=5, 0 confirmed TPs) | EXPERIMENTAL_SPECIALIZED | DEEP_EVALUATION |
| golden_cross | MA/context | Medium | TIER1 | Healthy | Present | Present | PASSES (re-checks current MA state) | Minimal-Useful | No | Medium (n=7) | BROAD_RELIABLE_LIBRARY | KEEP_HEALTHY |
| vcp | UCT flagship | High | TIER1 | Suspect | Present | Present | PASSES architecturally | Semantic | YES (empirical + pre-existing 3%-cross-engine finding) | Medium (n=6) | EXPERIMENTAL_SPECIALIZED (pending deep eval) | DEEP_EVALUATION (highest priority) |
| power_earnings_gap | Event/gap | Medium | TIER1 | Likely healthy | Present | Present | Not established (apparent FP was judge error) | Not deeply checked | No | Medium (n=6) | BROAD_RELIABLE_LIBRARY | KEEP_HEALTHY |
| episodic_pivot | Momentum/event | Medium | TIER1 | Healthy | Present | Present | Not established | Not deeply checked | No | Medium (n=7) | BROAD_RELIABLE_LIBRARY | KEEP_HEALTHY |
| remount | UCT high-value | Medium | TIER1 | Unclear | Present | Present | Possible edge-weakness (unverified) | Horizontal-line, not deeply checked | Unclear | Low (n=4, ambiguous) | EXPERIMENTAL_SPECIALIZED | DEFER |
| wyckoff_spring | UCT high-value | Medium | TIER1 | Not fully established | Present | Present | Not established | Not deeply checked | Unclear | Low (thin) | EXPERIMENTAL_SPECIALIZED | DEEP_EVALUATION |
| shooting_star | Candlestick | Medium | TIER1 | Suspect | Present | Present | FAILS (confirmed + materiality gap) | Semantic | YES | Low-Medium (n=3 fired examined) | EXPERIMENTAL_SPECIALIZED | ENHANCE_PRODUCT_INTELLIGENCE |
| morning_star | Candlestick | Medium | TIER1 | Suspect (source), clean (thin empirical) | Present | Present | Source FAILS, empirically untriggered | Semantic | Likely | Low (n=1 fired examined) | EXPERIMENTAL_SPECIALIZED | DEEP_EVALUATION |
| three_black_crows | Candlestick | Medium | TIER1 | Suspect (source), clean (thin empirical) | Present | Present | Source FAILS, empirically untriggered | Semantic | Likely | Low (n=1 fired examined) | EXPERIMENTAL_SPECIALIZED | DEEP_EVALUATION |
| marubozu | Candlestick | Low-Medium | TIER1 | Healthy | Minimal | Minimal | PASSES | Minimal | No | Low (n=0 fired examined; source only) | BROAD_RELIABLE_LIBRARY | KEEP_HEALTHY |
| bearish_engulfing | Candlestick | Medium | TIER1 | Suspect | Present | Present | FAILS (mixed empirical) | Semantic | YES (direct mirror of confirmed defect) | Medium (n=2 fired examined) | EXPERIMENTAL_SPECIALIZED | ENHANCE_PRODUCT_INTELLIGENCE |
| hanging_man | Candlestick | Medium | TIER1 | Suspect | Present | Present | FAILS (materiality gap) | Semantic | Likely | Low-Medium (n=1 fired examined) | EXPERIMENTAL_SPECIALIZED | ENHANCE_PRODUCT_INTELLIGENCE |
| nr7 | Candlestick/volatility | Low-Medium | TIER1 | Healthy | Minimal | Minimal | PASSES | Minimal | No | Medium (n=1 fired examined) | BROAD_RELIABLE_LIBRARY | KEEP_HEALTHY |
| vsa_no_supply | Volume | Medium | TIER1 | Likely healthy | Present | Present | PASSES | Minimal | No | Low-Medium (n=1 fired examined) | BROAD_RELIABLE_LIBRARY | KEEP_HEALTHY |
| accumulation_distribution | Volume | Unclear (always-on) | TIER1 | Unclear (category mismatch) | Present | Present | PASSES (always-on classifier) | Minimal | No | Low (can't assess quality visually) | EXPERIMENTAL_SPECIALIZED | DEFER |
| double_bottom | Classical structural | High | TIER1 | Likely healthy | Present | Present | PASSES | Semantic | Minor geometry looseness candidate | Medium (n=1 fired examined) | BROAD_RELIABLE_LIBRARY | KEEP_HEALTHY |
| ascending_triangle | Classical structural | High | TIER1 | Likely healthy | Present | Present | PASSES (freshest-by-construction) | Semantic | No (rendering caveat) | Low-Medium (legibility concern) | BROAD_RELIABLE_LIBRARY | GEOMETRY_WORK |
| flat_base | UCT structural | High | TIER1 | Suspect | Present | Present | PASSES architecturally | Useful | YES (quality, not freshness) | Medium (n=1 fired examined) | EXPERIMENTAL_SPECIALIZED | ENHANCE_PRODUCT_INTELLIGENCE |
| rounded_base | Classical structural | High | TIER1 | Healthy | Present | Present | PASSES | Semantic | No | Medium (n=1 fired examined) | BROAD_RELIABLE_LIBRARY | KEEP_HEALTHY |
| high_tight_flag | UCT structural | High (flagship-candidate) | TIER1 | Healthy | Present | Present | PASSES | Semantic | No | Medium-High (n=1 fired, very clean) | FLAGSHIP_INTELLIGENCE_CANDIDATE | KEEP_HEALTHY |
| u_and_r | UCT structural | Medium | TIER1 | Suspect (thin) | Present | Present | PASSES architecturally | Minimal | Thin quality concern | Low (n=1 fired examined) | EXPERIMENTAL_SPECIALIZED | DEEP_EVALUATION |
| wyckoff_upthrust | UCT structural | Medium | TIER1 | Suspect | Present | Present | Suspect + context-quality finding | Minimal | YES | Medium (n=1 fired, clear finding) | EXPERIMENTAL_SPECIALIZED | DEEP_EVALUATION |
| bollinger_squeeze | Structural/volatility | Medium | TIER1 | Likely healthy | Present | Present | PASSES | Useful | No (minor data artifact, unrelated) | Medium (n=1 fired examined) | BROAD_RELIABLE_LIBRARY | KEEP_HEALTHY |
| rsi_bullish_divergence | Momentum | Medium | TIER1 | Likely healthy | Present | Present | PASSES (price half only) | Semantic | No | Low-Medium (RSI half unverified) | BROAD_RELIABLE_LIBRARY | KEEP_HEALTHY |
| qullamaggie_setup | UCT flagship | High (flagship-candidate) | TIER1 | Healthy | Present | Present | PASSES (maximally fresh) | Useful | No | Medium-High (very clean, but n=1, extremely rare trigger) | FLAGSHIP_INTELLIGENCE_CANDIDATE | KEEP_HEALTHY |
| death_cross | MA/context | Medium | TIER1 | Healthy | Present | Present | PASSES (mirrors golden_cross) | Minimal | No | Medium (n=1 fired examined) | BROAD_RELIABLE_LIBRARY | KEEP_HEALTHY |
| pullback_to_50sma | MA/context (UCT) | High | TIER1 | Suspect | Present | Present | FAILS -- confirmed | Minimal | YES (same root cause as pullback_to_21ema) | High (empirically confirmed) | EXPERIMENTAL_SPECIALIZED | FIX_HARD_DEFECT |
| stage_analysis | MA/context | Medium (always-on) | TIER1 | Plausible | Present | Present | PASSES (always-on) | Semantic | No (category mismatch) | Medium | BROAD_RELIABLE_LIBRARY | KEEP_HEALTHY |
| opening_range_breakout | Breakout/event | Unclear | TIER1 | Unevaluable on this harness | N/A | N/A | Unevaluable (intraday-native, daily corpus) | Useful | Unknown | None (harness mismatch) | EXPERIMENTAL_SPECIALIZED | DEFER |
| avwap_reclaim | Event/UCT | High | TIER1 | Healthy | Present | Present | PASSES | Minimal | No | Medium-High (n=1, very clean) | BROAD_RELIABLE_LIBRARY | KEEP_HEALTHY |

**37 detectors evaluated (3 DEEP + 34 TIER1) of ~85 total registered. 48 NOT_EVALUATED.**
