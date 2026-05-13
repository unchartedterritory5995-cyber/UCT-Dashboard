# Phase 7 — Pattern Recognition Launch Checklist

## Overview

Phase 7 is the public launch of the chart pattern overlay. It is gated by Gate 4 (calibration backtest) and Gate 5 (5-day operator review with ≥85% accept rate). Once both gates pass, the chart overlay flips to default-ON for all users.

**Phase 7 is a small code change (~1 line) wrapped in operational discipline.**

## Pre-launch checklist

Run through this before flipping the default. All items must be ✅.

### Engine + infrastructure (already shipped)
- [x] 50 detectors registered + live on Railway
- [x] All 9 verification checks PASS at Phase 6 (volume_profile_nodes WARN is expected)
- [x] APScheduler jobs running: outcome tracker (4h), stats recompute (nightly), universe scan (hourly)
- [x] Admin dashboard `/admin/patterns` populated by hourly scanner
- [x] Chart overlay system tested per-user (toolbar toggle works, side panel functional)
- [x] Scanner page `/patterns` live + filtering works
- [x] Pattern feedback endpoint accepts ratings (great/good/miss/wrong)

### Gate 4 (Calibration backtest)
- [ ] Run `python scripts/calibration_backtest.py --symbols 200 --tf D --bars 500`
- [ ] Review report at `docs/superpowers/phase-reports/YYYY-MM-DD-calibration-backtest.md`
- [ ] **PASS criteria:** for each detector with ≥30 outcomes per bin, Δ from predicted midpoint < 15%. Detectors with Δ >15% are either retuned OR shelved (confidence floor raised so they don't emit until retuned).
- [ ] Optional: re-run for Weekly TF: `python scripts/calibration_backtest.py --symbols 100 --tf W`
- [ ] Result: ______ (good/needs-tuning/retune-X-detector)

### Gate 5 (Production shadow mode)
- [ ] Day 1 review complete at `/admin/patterns` (≥100 detections reviewed)
- [ ] Day 2 review complete (≥100 reviewed; running 2-day accept rate logged)
- [ ] Day 3 review complete
- [ ] Day 4 review complete
- [ ] Day 5 review complete
- [ ] **PASS criteria:**
  - 5 consecutive trading days reviewed
  - ≥500 total reviewed detections
  - ≥85% accept rate sustained across the 5-day window
  - No single detector accounts for >50% of rejects
- [ ] Result: ______ (PASS/FAIL/retune-and-restart)

Runbook: `docs/operations/gate-5-shadow-mode-runbook.md`

### Final smoke
- [ ] All 1011+ pattern_engine tests still passing (`python -m pytest tests/pattern_engine -v`)
- [ ] Live API endpoints all responding 200:
  - `GET /api/patterns/types`
  - `GET /api/patterns/{sym}?tf=D`
  - `GET /api/patterns/scan?tf=D`
  - `GET /api/admin/patterns/health`
  - `GET /api/admin/patterns/recent?hours=24`
- [ ] Manual browser test:
  - `/patterns` loads, shows results, filters work
  - `/admin/patterns` shows recent detections feed
  - StockChart with toolbar toggle ON shows pattern shapes
  - Click pattern → side panel shows full narrative
  - Feedback button POSTs successfully

## The flip

When all pre-launch items are ✅, flip the default:

**File:** `app/src/components/chart/chartDefaults.js`

Change:
```javascript
showPatterns: false,
```

To:
```javascript
showPatterns: true,
```

Commit:
```bash
git add app/src/components/chart/chartDefaults.js
git commit -m "feat(patterns): LAUNCH — chart overlay default ON (Phase 7)"
git push
```

After Railway redeploy → all users see pattern overlays on their charts by default. Users can still toggle off via the toolbar.

## Post-launch monitoring (first 7 days)

Track these metrics daily after launch:

| Metric | Source | Target |
|---|---|---|
| User feedback ratings (great/good/miss/wrong) | `SELECT rating, COUNT(*) FROM pattern_feedback WHERE user_id != 'admin_operator' GROUP BY rating` | great + good ≥ 70% of feedback |
| Per-detector accept rate (admin) | `/admin/patterns` running stats | sustained ≥85% |
| API performance | Phase 6 verify_phase.py 6 report | p99 <100ms at 1000 bars |
| Detection volume | `SELECT pattern_id, COUNT(*) FROM pattern_detections WHERE detected_at > 1week ago GROUP BY pattern_id` | balanced (no single pattern >50% of all) |
| Outcome resolution lag | `SELECT AVG(NOW() - detected_at) FROM pattern_detections WHERE status = 'completed'` | <72 hours mean |

If any metric drops sharply:
- Investigate via `/admin/patterns` filtered by the failing detector
- Tune detector confidence floor or thresholds
- Consider feature-flagging the detector OFF until retune (set its confidence floor to 999 effectively)

## Rollback procedure

If accept rate drops below 70% in the first 3 days post-launch:

1. **Immediate:** flip `chartDefaults.showPatterns = false` and push
2. **Investigation:** Identify failing detector via admin dashboard
3. **Remediation:** Retune that detector OR temporarily deactivate (comment out the `register()` call in the offending detector file)
4. **Re-launch:** Re-run Gate 5 review for 3 days after fix → re-flip default ON

## Phase 7 deliverables checklist

The CODE deliverables for Phase 7 are:
- [x] Phase 7 launch checklist (THIS DOCUMENT)
- [ ] (Operational, Patrick) Gate 4 backtest run + review
- [ ] (Operational, Patrick) Gate 5 5-day operator review at /admin/patterns
- [ ] (Code) Flip `showPatterns: true` in chartDefaults.js
- [ ] (Code) Phase 7 verification report committed

The actual flip is the LAST step — only after Gate 4+5 both pass.

## After Phase 7 launch — follow-up initiatives

These are independent post-launch projects (each its own future spec):

### Brain layer integration
Morning wire mentions active patterns. Coaching layer cites detected patterns when reviewing trades.

### Pattern-triggered alerts
Pattern type + symbol + min confidence triggers in-app + email + Discord notification.

### Journal auto-tagging
Trades log auto-detects which pattern was active at entry and pre-populates the setup field.

### Pattern-specific backtester
Backtester gets a new strategy template family: "every X pattern detection, take the trade." Per-pattern realized expectancy.

### Catalog expansion (deferred from Phase 3-4)
- 17 additional UCT setups (Gap-and-Go, BGU, EMA Crossback, 20EMA Hold, Stage transitions, Powerplay, Box Theory, Base-on-Base, Late-stage climax, 7-Week Short Rule, Oops Reversal, Red-to-Green, Go Signal, HVC, ORB/ORD, 30min Pivot, Mean Reversion L/S)
- 8 less-common candlesticks (Inverted hammer, Tweezer top/bottom, Three inside up/down, Abandoned baby)

### ML-augmented confidence scoring
Once `pattern_outcomes` has ≥10,000 resolved samples per major pattern, train a model that takes (geometry features + context features) and predicts hit rate. Compare to current rules-based confidence; blend the two scores.
