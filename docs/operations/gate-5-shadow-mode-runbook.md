# Gate 5 — Production Shadow Mode Operator Runbook

## Overview

Gate 5 is the final verification before launching the pattern recognition UI to public users. The operator (Patrick) reviews live engine-generated detections daily for **5 consecutive trading days**. Target: **≥85% accept rate** sustained across that window.

This gate is OPERATIONAL — the infrastructure to support it is built (admin dashboard at `/admin/patterns`, hourly universe scanner, accept/reject/flag endpoints). The actual review is performed manually by Patrick.

## How the engine populates detections for review

Since Phase 6 ships:
- **Hourly universe scanner** runs against the top 500 cap_universe tickers on Daily timeframe. Every detection above confidence 50 lands in the `pattern_detections` table. Visible in admin dashboard.
- **Outcome tracker** runs every 4 hours, walks forward bars to resolve open detections, marks them completed/failed/expired.
- **Stats recompute** runs nightly at 6 AM UTC, aggregates outcomes into per-(pattern × regime × tf) hit-rate stats.

The admin dashboard at `https://uctintelligence.com/admin/patterns` pulls from this data automatically.

## Daily procedure (~30 minutes per day)

### 1. Open admin dashboard
```
https://uctintelligence.com/admin/patterns
```

### 2. Set filters
- **Window:** Last 24h (default — for daily review). Use Last 48h for weekend catch-up.
- **Show:** Unreviewed only
- **Category:** All (or rotate through categories if focusing on specific pattern families)

### 3. Review each detection
For each row in the feed:

**Read the narrative headline** + glance at the entry/stop/target/R:R strip.

**Mentally verify**:
- Does the geometric description match what you'd see on the chart?
- Is the entry/stop/target reasonable given the structure?
- Is the context (trend stage, MA stack, RS) accurate?

**Click**:
- ✅ **Accept** — detection is clean and accurate. The pattern is real, the levels make sense, the context is right. This counts toward the accept rate.
- ❌ **Reject** — detection is wrong. The pattern isn't really there, levels are wildly off, or context is misclassified.
- 🚩 **Flag** — borderline / uncertain. Add a NOTE explaining why. Flags are reviewed weekly to identify patterns where the detector needs tuning.

**Optional note** (textarea on each card) — useful for capturing nuance: "good pattern but volume signal was weak", "context misclassified — should be Stage 3 not Stage 2", etc.

### 4. Target throughput
- **≥100 detections reviewed per day**
- Spread across pattern categories (don't only review classical — UCT setups + structure + candlesticks all need verification)
- ~30 minutes of focused review per day

### 5. Monitor running accept rate
The header bar shows running accept rate over the selected window. Target:
- **≥85% sustained** over 5 trading days
- **green** = ≥85% (passing)
- **amber** = 70-85% (concerning, investigate)
- **red** = <70% (Gate 5 FAILED — pause launch, retune detectors)

## Pass criteria summary

✅ Gate 5 PASSES when ALL of these hold:
- **5 consecutive trading days** of operator review
- **≥500 total reviewed detections** across those 5 days
- **≥85% accept rate** (overall)
- **No single detector** accounts for >50% of rejects (else flag that detector for retuning before launch)

## When Gate 5 FAILS

If accept rate drops below 85%:

1. **Identify the failing detector(s)** — filter by pattern_id, observe per-detector accept rates
2. **Note the failure modes** in admin notes (recurring rejection reasons)
3. **Choose remediation**:
   - **Tune the detector** (adjust thresholds, add filters) — re-run calibration backtest after
   - **Tighten confidence floor** for that detector (e.g., raise from 50 → 65)
   - **Deactivate the detector** temporarily — flip its `register()` call to a no-op until retune
4. **Restart Gate 5 clock** — 5-day window resets after any detector change

## What happens after Gate 5 passes

**Phase 7 — Launch**:
1. Flip the chart toolbar default: `chartDefaults.js` → `showPatterns: true`
2. Public users now see pattern overlays on every StockChart
3. Confidence calibration is data-driven (outcome tracker has accumulated 30+ days)
4. `pattern_stats` table has real hit-rate data — feeds `historical_score` for new detections
5. User feedback via the side panel's 👍/👌/❌/⚠ buttons feeds into per-detector accuracy scores

## Calibration backtest (Gate 4 — companion gate)

While Gate 5 is the LIVE operator review, **Gate 4** is the historical calibration backtest. Run it periodically to baseline calibration quality:

```bash
# Initial baseline (fast — ~5 min)
python scripts/calibration_backtest.py --symbols 50 --tf D

# Production baseline (slower — ~30-60 min)
python scripts/calibration_backtest.py --symbols 500 --tf D --bars 1000

# Multi-timeframe sweep
python scripts/calibration_backtest.py --symbols 100 --tf D
python scripts/calibration_backtest.py --symbols 100 --tf W
```

Each run writes to `docs/superpowers/phase-reports/YYYY-MM-DD-calibration-backtest.md`. Compare:
- Per-pattern realized hit rate vs predicted confidence midpoint
- Δ < 5% = well-calibrated (✅)
- Δ 5-15% = moderate miscalibration (⚠️)
- Δ > 15% = significant miscalibration (❌) — retune before launching that detector

## Operational notes

- The admin dashboard auto-refreshes every 60 seconds — no need to manually refresh during a review session.
- Reviewed detections dim to 0.7 opacity so unreviewed rows stand out.
- Re-review is supported — clicking a different button on a previously-reviewed detection updates the rating.
- The `admin_operator` user_id is used for these reviews (distinguishes from end-user feedback in `pattern_feedback`).
- Empty days (weekends) — the scanner still runs but produces fewer detections; just skip reviews on weekends.

## Tracking progress

Patrick's recommended daily log:

```
Day 1 (YYYY-MM-DD): Reviewed N detections, accept rate X%
Day 2 (YYYY-MM-DD): ...
...
Day 5 (YYYY-MM-DD): Total N reviewed, X% accept rate — Gate 5 [PASS/FAIL]
```

After Gate 5 passes → proceed to Phase 7 (launch).
