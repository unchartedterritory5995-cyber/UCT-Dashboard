# Pattern Recognition — Phase 6 (Verification + Calibration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the **learning loop** that was scaffolded in Phase 0 and run Gates 4-5 of the verification strategy before launch.

After Phase 6:
- **Outcome tracker** runs every 4 hours, resolves open detections (entry hit / stop hit / target hit / MFE / MAE)
- **Stats recompute job** runs nightly, aggregates outcomes into `pattern_stats` table (per pattern × regime × tf)
- **Live universe scanner** runs hourly via APScheduler — populates the admin dashboard
- **Calibration backtest** produces per-pattern confidence-vs-realized-hit-rate analysis
- **Admin calibration view** — visualizes Gate 4 results
- **Gate 5 operator runbook** — daily review procedure

**Architecture:**
- `memory.track_outcomes()` already stubbed in Phase 0 — Phase 6 activates the implementation
- `memory.recompute_stats()` already stubbed — Phase 6 activates
- New APScheduler jobs registered in main.py lifespan (alongside existing COT scheduler)
- Calibration analysis runs offline (`scripts/calibration_backtest.py`)
- Admin calibration view extends existing `/admin/patterns` page

**Critical:** Gate 5 (5-day operator review with ≥85% accept rate) is an OPERATIONAL gate that Patrick performs — Phase 6 builds the infrastructure that makes the gate executable. The gate itself happens AFTER Phase 6 ships.

**Spec reference:** `docs/superpowers/specs/2026-05-11-pattern-recognition-design.md` Section 9 (Gates 4-5).

---

## Task 1: Outcome tracker activation

**File:** `api/services/pattern_engine/memory.py` (replace stub)

The `track_outcomes(lookback_hours=48)` function is currently a stub returning 0. Activate it:

```python
def track_outcomes(lookback_hours: int = 48) -> int:
    """Walk forward bars to resolve open detections.
    
    For each detection with status in ("forming", "ready", "triggered"):
      1. Fetch bars from bars_sqlite since detected_at
      2. Check chronologically: did entry trigger? did stop hit? did target hit?
      3. Update pattern_outcomes row
      4. Track MFE / MAE
      5. Flip status to: completed (target hit) | failed (stop hit) | expired (>30 days no resolution)
    
    Returns the number of detections processed.
    """
    conn = get_connection()
    try:
        # Find open detections within the lookback window
        cutoff = int(time.time()) - lookback_hours * 3600
        rows = conn.execute("""
            SELECT id, sym, tf, status, levels_json, detected_at, end_t
            FROM pattern_detections
            WHERE status IN ('forming', 'ready', 'triggered')
              AND detected_at >= ?
        """, (cutoff,)).fetchall()
    finally:
        conn.close()
    
    processed = 0
    for row in rows:
        try:
            outcome = _resolve_outcome(row)
            if outcome:
                _store_outcome(row["id"], outcome)
                _update_status(row["id"], outcome["new_status"])
                processed += 1
        except Exception as e:
            logger.warning("track_outcomes: failed to resolve %s: %s", row["id"], e)
    
    return processed


def _resolve_outcome(detection_row) -> Optional[dict]:
    """Given a detection row, fetch bars from bars_sqlite, walk forward, 
    determine entry_hit/stop_hit/target_hit/MFE/MAE.
    
    Returns None if pattern not yet resolved (still open or expired).
    Returns dict with outcome fields + 'new_status' for the update.
    """
    from api.services import bars_sqlite
    import json
    
    levels = json.loads(detection_row["levels_json"])
    entry = levels.get("entry")
    stop = levels.get("stop")
    target = levels.get("target_primary")
    
    if entry is None or stop is None or target is None:
        # Structure detector or incomplete — no levels to track
        return None
    
    # Fetch bars from after the detection
    bars = bars_sqlite.get_bars_since(detection_row["sym"], detection_row["tf"], detection_row["end_t"])
    if not bars:
        return None
    
    is_long = target > entry  # bullish trade
    
    entry_hit = False
    entry_hit_t = None
    stop_hit = False
    stop_hit_t = None
    target_hit = False
    target_hit_t = None
    
    mfe = 0.0  # max favorable excursion %
    mae = 0.0  # max adverse excursion %
    
    bars_processed = 0
    
    for bar in bars:
        bars_processed += 1
        t = bar[0]
        bar_high = bar[2]
        bar_low = bar[3]
        
        # Has entry triggered yet?
        if not entry_hit:
            if is_long and bar_high >= entry:
                entry_hit = True
                entry_hit_t = t
            elif not is_long and bar_low <= entry:
                entry_hit = True
                entry_hit_t = t
        
        # Once in trade, track stop / target / MFE / MAE
        if entry_hit:
            if is_long:
                fav = (bar_high - entry) / entry * 100
                adv = (entry - bar_low) / entry * 100
                if bar_low <= stop:
                    stop_hit = True
                    stop_hit_t = t
                    break
                if bar_high >= target:
                    target_hit = True
                    target_hit_t = t
                    break
            else:
                fav = (entry - bar_low) / entry * 100
                adv = (bar_high - entry) / entry * 100
                if bar_high >= stop:
                    stop_hit = True
                    stop_hit_t = t
                    break
                if bar_low <= target:
                    target_hit = True
                    target_hit_t = t
                    break
            mfe = max(mfe, fav)
            mae = max(mae, adv)
    
    # Determine new status
    if target_hit:
        new_status = "completed"
    elif stop_hit:
        new_status = "failed"
    elif bars_processed >= 30 * 7:  # ~30 trading days  
        new_status = "expired"
    else:
        return None  # Still open
    
    return {
        "entry_hit": int(entry_hit),
        "entry_hit_t": entry_hit_t,
        "stop_hit": int(stop_hit),
        "stop_hit_t": stop_hit_t,
        "target_hit": int(target_hit),
        "target_hit_t": target_hit_t,
        "mfe_pct": round(mfe, 4),
        "mae_pct": round(mae, 4),
        "bars_to_resolve": bars_processed,
        "resolved_at": int(time.time()),
        "new_status": new_status,
    }


def _store_outcome(detection_id, outcome):
    conn = get_connection()
    try:
        conn.execute("""
            INSERT INTO pattern_outcomes (
                detection_id, entry_hit, entry_hit_t, stop_hit, stop_hit_t,
                target_hit, target_hit_t, mfe_pct, mae_pct,
                bars_to_resolve, resolved_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(detection_id) DO UPDATE SET
                entry_hit = excluded.entry_hit,
                stop_hit = excluded.stop_hit,
                target_hit = excluded.target_hit,
                mfe_pct = excluded.mfe_pct,
                mae_pct = excluded.mae_pct,
                bars_to_resolve = excluded.bars_to_resolve,
                resolved_at = excluded.resolved_at
        """, (detection_id, outcome["entry_hit"], outcome["entry_hit_t"],
              outcome["stop_hit"], outcome["stop_hit_t"],
              outcome["target_hit"], outcome["target_hit_t"],
              outcome["mfe_pct"], outcome["mae_pct"],
              outcome["bars_to_resolve"], outcome["resolved_at"]))
        conn.commit()
    finally:
        conn.close()


def _update_status(detection_id, new_status):
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE pattern_detections SET status = ? WHERE id = ?",
            (new_status, detection_id)
        )
        conn.commit()
    finally:
        conn.close()
```

Add tests in `tests/pattern_engine/test_track_outcomes.py`:
- Test with bar data where target hits → outcome target_hit=1, status=completed
- Test with bar data where stop hits → status=failed
- Test with insufficient bars → returns None (still open)
- Test MFE/MAE tracking for a complete bull move

Commit.

---

## Task 2: Stats recompute activation

**File:** `api/services/pattern_engine/memory.py` (replace stub)

Activate `recompute_stats()`:

```python
def recompute_stats() -> int:
    """Aggregate pattern_outcomes joined with pattern_detections into pattern_stats.
    
    Buckets by (pattern_id, tf, regime_bucket). regime_bucket is derived from
    detection.context_json.regime ("bull"/"bear"/"choppy"/"transition"; default "neutral").
    
    Returns number of (pattern_id, tf, regime_bucket) rows updated.
    """
    conn = get_connection()
    try:
        # First, clear existing stats
        conn.execute("DELETE FROM pattern_stats")
        
        # Aggregate
        rows = conn.execute("""
            SELECT pd.pattern_id, pd.tf,
                   COALESCE(json_extract(pd.context_json, '$.regime'), 'unknown') AS regime,
                   COUNT(*) AS n_total,
                   COUNT(po.detection_id) AS n_resolved,
                   SUM(COALESCE(po.entry_hit, 0)) AS n_entry,
                   SUM(COALESCE(po.target_hit, 0)) AS n_target,
                   SUM(COALESCE(po.stop_hit, 0)) AS n_stop,
                   AVG(po.mfe_pct) AS avg_mfe,
                   AVG(po.mae_pct) AS avg_mae,
                   AVG(po.bars_to_resolve) AS median_bars
            FROM pattern_detections pd
            LEFT JOIN pattern_outcomes po ON po.detection_id = pd.id
            GROUP BY pd.pattern_id, pd.tf, regime
        """).fetchall()
        
        now = int(time.time())
        for row in rows:
            n_resolved = row["n_resolved"] or 1
            hit_rate = (row["n_target"] / n_resolved) if n_resolved else 0.0
            # Simple expectancy: target_pct - stop_pct (assuming 1R risk)
            expectancy = (hit_rate * 2.0) - ((1.0 - hit_rate) * 1.0) if hit_rate else 0.0
            
            conn.execute("""
                INSERT INTO pattern_stats (
                    pattern_id, tf, regime_bucket,
                    n_total, n_resolved, n_entry_hit, n_target_hit, n_stop_hit,
                    avg_mfe_pct, avg_mae_pct, median_bars,
                    hit_rate, expectancy_R, last_updated
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                row["pattern_id"], row["tf"], row["regime"],
                row["n_total"], row["n_resolved"],
                row["n_entry"], row["n_target"], row["n_stop"],
                row["avg_mfe"], row["avg_mae"], row["median_bars"],
                round(hit_rate, 4), round(expectancy, 4), now
            ))
        
        conn.commit()
        return len(rows)
    finally:
        conn.close()
```

Add tests:
- Test that aggregation produces correct hit_rate
- Test that regime bucketing works
- Test idempotency (running twice produces same result)

Commit.

---

## Task 3: APScheduler jobs registered in lifespan

**File:** `api/main.py` (extend)

Add 3 scheduled jobs:

```python
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

# Pattern engine outcome tracker (every 4 hours)
def _run_track_outcomes():
    from api.services.pattern_engine.memory import track_outcomes
    try:
        n = track_outcomes(lookback_hours=72)
        print(f"[patterns] track_outcomes: resolved {n} detections")
    except Exception as e:
        print(f"[patterns] track_outcomes failed: {e}")


# Pattern engine stats recompute (nightly at 6 AM UTC)
def _run_recompute_stats():
    from api.services.pattern_engine.memory import recompute_stats
    try:
        n = recompute_stats()
        print(f"[patterns] recompute_stats: updated {n} stat rows")
    except Exception as e:
        print(f"[patterns] recompute_stats failed: {e}")


# Live universe scanner (every 1 hour during market hours, 9 AM - 4 PM ET on weekdays)
def _run_universe_scan():
    """Run the engine on top cap_universe symbols, store detections to populate admin dashboard."""
    try:
        from api.services import bars_sqlite
        from api.services.pattern_engine import detect_all, memory
        from api.services.pattern_engine.primitives.context import build_context
        # Importing patterns.py triggers detector registration:
        from api.routers import patterns as _patterns  # noqa: F401
        import json, os
        
        universe_path = os.path.join(os.path.dirname(__file__), "data", "cap_universe.json")
        with open(universe_path) as f:
            universe_data = json.load(f)
        if isinstance(universe_data, list):
            tickers = universe_data
        else:
            tickers = universe_data.get("tickers", [])
        
        # Scan top 500 (or whatever fits)
        scan_limit = 500
        timeframes = ["D"]  # start with daily; can add 1hr, W later
        scanned = 0
        stored = 0
        
        for sym in tickers[:scan_limit]:
            for tf in timeframes:
                bars = bars_sqlite.get_bars(sym, tf, 200)
                if not bars or len(bars) < 30:
                    continue
                bars_list = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in bars]
                ctx = build_context(bars_list, sym=sym)
                detections = detect_all(bars_list, ctx)
                for d in detections:
                    d["sym"] = sym
                    d["tf"] = tf
                    try:
                        memory.store_detection(d)
                        stored += 1
                    except Exception:
                        pass
                scanned += 1
        
        print(f"[patterns] universe_scan: scanned {scanned} symbol-TFs, stored {stored} detections")
    except Exception as e:
        print(f"[patterns] universe_scan failed: {e}")


# Inside the lifespan or startup hook (look for existing scheduler init):
scheduler.add_job(_run_track_outcomes, IntervalTrigger(hours=4), id="patterns_track_outcomes")
scheduler.add_job(_run_recompute_stats, CronTrigger(hour=6, minute=0, timezone="UTC"), id="patterns_recompute_stats")
scheduler.add_job(_run_universe_scan, IntervalTrigger(hours=1), id="patterns_universe_scan")
```

Wire near the existing COT scheduler setup. Find the existing `BackgroundScheduler` or `AsyncIOScheduler` instance in main.py and register the 3 jobs.

If there's no existing scheduler, add one (initialize in `lifespan`, shutdown on exit).

Commit.

---

## Task 4: Calibration backtest script

**File:** `scripts/calibration_backtest.py`

Standalone script to analyze the calibration of the engine. Walks historical bars across a sample universe, fires detectors, tracks outcomes, computes calibration plot data.

```python
"""Calibration backtest for the pattern recognition engine (Gate 4).

For each detection, simulate the trade by walking forward bars and tracking
whether entry / stop / target hit. Bin detections by confidence (50-60, 60-70,
70-80, 80-90, 90+) and compute the realized hit rate per bin per detector.

Output: a markdown report with per-detector calibration tables.
A well-calibrated detector has realized hit rates within ±5% of predicted
confidence midpoints (i.e., 75-confidence band should have ~75% hit rate).

Usage: python scripts/calibration_backtest.py [--symbols N] [--tf D]
"""
import argparse
import json
import os
from collections import defaultdict
from datetime import datetime

_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def run(symbol_limit: int = 200, tf: str = "D", lookback_bars: int = 500):
    from api.services import bars_sqlite
    from api.services.pattern_engine import detect_all
    from api.services.pattern_engine.primitives.context import build_context
    from api.routers import patterns as _patterns  # noqa: F401
    
    # Load universe
    universe_path = os.path.join(_REPO_ROOT, "api", "data", "cap_universe.json")
    with open(universe_path) as f:
        data = json.load(f)
    universe = data if isinstance(data, list) else data.get("tickers", [])
    
    print(f"Running calibration backtest on {min(symbol_limit, len(universe))} symbols, tf={tf}")
    
    # For each symbol, walk forward
    all_outcomes = []  # list of (pattern_id, confidence, hit_target, hit_stop, mfe, mae)
    
    for sym in universe[:symbol_limit]:
        bars = bars_sqlite.get_bars(sym, tf, lookback_bars)
        if not bars or len(bars) < 60:
            continue
        bars_list = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in bars]
        
        # For each anchor point in the middle of the series, run detection
        # then walk forward to track outcome
        for anchor_idx in range(50, len(bars_list) - 30, 5):  # step 5 bars
            past_bars = bars_list[:anchor_idx + 1]
            future_bars = bars_list[anchor_idx + 1:anchor_idx + 30]
            
            ctx = build_context(past_bars, sym=sym)
            detections = detect_all(past_bars, ctx)
            
            for d in detections:
                if not d.get("levels"): continue
                entry = d["levels"].get("entry")
                stop = d["levels"].get("stop")
                target = d["levels"].get("target_primary")
                if entry is None or stop is None or target is None:
                    continue
                
                is_long = target > entry
                
                hit_target = False
                hit_stop = False
                mfe = 0
                mae = 0
                
                for fb in future_bars:
                    if is_long:
                        if fb["h"] >= target:
                            hit_target = True; break
                        if fb["l"] <= stop:
                            hit_stop = True; break
                        mfe = max(mfe, (fb["h"] - entry) / entry * 100)
                        mae = max(mae, (entry - fb["l"]) / entry * 100)
                    else:
                        if fb["l"] <= target:
                            hit_target = True; break
                        if fb["h"] >= stop:
                            hit_stop = True; break
                        mfe = max(mfe, (entry - fb["l"]) / entry * 100)
                        mae = max(mae, (fb["h"] - entry) / entry * 100)
                
                if hit_target or hit_stop:  # resolved
                    all_outcomes.append({
                        "pattern_id": d["pattern_id"],
                        "confidence": d["confidence"],
                        "hit_target": hit_target,
                        "hit_stop": hit_stop,
                        "mfe": mfe,
                        "mae": mae,
                    })
    
    # Compute calibration per pattern
    binned = defaultdict(lambda: defaultdict(list))  # binned[pattern_id][bin] = list of (hit_target, ...)
    
    BINS = [(50, 60), (60, 70), (70, 80), (80, 90), (90, 101)]
    BIN_LABELS = ["50-60", "60-70", "70-80", "80-90", "90+"]
    
    for o in all_outcomes:
        c = o["confidence"]
        for i, (lo, hi) in enumerate(BINS):
            if lo <= c < hi:
                binned[o["pattern_id"]][BIN_LABELS[i]].append(o)
                break
    
    # Write report
    report_path = os.path.join(_REPO_ROOT, "docs", "superpowers", "phase-reports",
                               f"{datetime.now().strftime('%Y-%m-%d')}-calibration-backtest.md")
    
    lines = [
        f"# Pattern Recognition — Calibration Backtest (Gate 4)",
        f"",
        f"**Date:** {datetime.now().isoformat()}",
        f"**Universe:** {symbol_limit} symbols, tf={tf}",
        f"**Total resolved detections:** {len(all_outcomes)}",
        f"",
        f"## Calibration table per detector",
        f"",
        f"For each detector, the realized hit rate per confidence bin. A well-calibrated detector has hit rates near the bin midpoint (e.g., 70-80 band → ~75% hit rate).",
        f"",
        f"| Detector | Bin | N | Hit rate | Predicted midpoint | Δ |",
        f"|---|---|---|---|---|---|",
    ]
    
    midpoints = {"50-60": 55, "60-70": 65, "70-80": 75, "80-90": 85, "90+": 95}
    
    for pattern_id in sorted(binned.keys()):
        for bin_label in BIN_LABELS:
            outcomes = binned[pattern_id][bin_label]
            if not outcomes: continue
            n = len(outcomes)
            hit_rate = sum(1 for o in outcomes if o["hit_target"]) / n * 100
            mid = midpoints[bin_label]
            delta = hit_rate - mid
            lines.append(f"| `{pattern_id}` | {bin_label} | {n} | {hit_rate:.1f}% | {mid}% | {delta:+.1f}% |")
    
    lines.append("")
    lines.append("## Interpretation")
    lines.append("- |Δ| <5% → well-calibrated")
    lines.append("- |Δ| 5-15% → moderate miscalibration, consider tuning")
    lines.append("- |Δ| >15% → significant miscalibration, retune confidence weights before launch")
    
    with open(report_path, "w") as f:
        f.write("\n".join(lines))
    
    print(f"Report: {report_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbols", type=int, default=200)
    parser.add_argument("--tf", default="D")
    parser.add_argument("--bars", type=int, default=500)
    args = parser.parse_args()
    run(args.symbols, args.tf, args.bars)
```

Commit. Run with smaller universe for initial baseline (--symbols 50). Iterate the heavier full run after Phase 6 ships.

---

## Task 5: Gate 5 operator runbook + Phase 6 verification

**File:** `docs/operations/gate-5-shadow-mode-runbook.md`

```markdown
# Gate 5 — Production Shadow Mode Operator Runbook

## Overview
Gate 5 is the final verification before launching the pattern recognition UI to users. The operator (Patrick) reviews live detections daily for 5 consecutive trading days. Target: **≥85% accept rate** sustained.

## Daily procedure

### 1. Open admin dashboard
Visit https://uctintelligence.com/admin/patterns

### 2. Review unreviewed detections
- Filter to "Unreviewed only"
- For each detection:
  - Read the narrative + look at the chart
  - Click **✅ Accept** if the detection is clean and accurate
  - Click **❌ Reject** if the detection is wrong (no real pattern, or pattern doesn't match)
  - Click **🚩 Flag** if borderline/uncertain (add a note explaining)
- Target: review **at least 100** detections per day

### 3. Monitor accept rate
The header bar shows running accept rate. Target ≥85% sustained over 5 days.

### 4. If accept rate drops below 85%
- Identify which detectors are responsible (filter by category/type)
- Note flagged failure modes in admin notes
- Schedule a retuning pass before launching UI

## Pass criteria
- 5 consecutive trading days
- ≥500 total reviewed detections
- ≥85% accept rate
- No single detector accounting for >50% of rejects

## After Gate 5 passes
- Phase 7 (launch): flip the `showPatterns` default to true on the chart toolbar
- Public users see pattern overlays on every chart
```

**Phase 6 verification:**

```bash
python scripts/verify_phase.py 6
```

After all jobs scheduled + scripts in place. Commit + push the verification report.

---

## Phase 6 Done — what shipped

- Outcome tracker (`memory.track_outcomes`) activated — resolves open detections every 4 hours
- Stats recompute (`memory.recompute_stats`) activated — nightly aggregation
- Live universe scanner scheduled hourly — populates admin dashboard
- Calibration backtest script + initial report
- Gate 5 runbook for operator review

## Self-review

- 5 tasks, infrastructure-focused (no new detectors).
- Activates Phase 0's deferred stubs.
- APScheduler jobs sit alongside existing COT scheduler — same lifecycle.
- Calibration backtest is a standalone script — operator can re-run as data accumulates.
- Gate 5 runbook is documentation for Patrick to follow.
- After Phase 6, Gate 5 is an OPERATIONAL phase (5 days of operator review) that happens before Phase 7 (launch).
