"""Phase 8, Package 8G-B Performance Closure — repeatable local benchmark.

Not a correctness test (no assertions on timing thresholds here — wall-clock
numbers vary too much across machines/CI to be a reliable pass/fail gate).
This is the controlled, repeatable methodology companion to the live
production measurement in the Package-8G-B Performance Closure report: same
request shape (a small candidate set against a populated active-detections
table), run locally so the numbers can be reproduced without touching
production. Run manually with `-s` to see output:

    python -m pytest tests/test_pattern_join_canonical_shadow_benchmark.py -s
"""
import time

_NOW = int(time.time())


def _detection(**overrides):
    base = {
        "id": "det-1",
        "sym": "AAPL", "tf": "D",
        "pattern_id": "high_tight_flag", "category": "uct", "direction": "bullish",
        "start_t": 1700000000, "end_t": 1700100000,
        "geometry": {"shape": "trendline_pair", "anchors": [], "extras": {}},
        "levels": {"entry": 100.0, "entry_condition": "", "stop": 95.0,
                   "stop_basis": "", "target_primary": 110.0,
                   "target_secondary": None, "risk_reward": 2.0},
        "context": {"trend_stage": 2, "rs_trend": "up",
                    "ma_alignment": "stacked_bullish",
                    "volume_signature": "contracting", "regime": "unknown",
                    "nearest_resistance": 110.0, "nearest_support": 95.0,
                    "days_to_earnings": None, "sector_strength_rank": None},
        "confidence": 75.0,
        "quality_components": {"geometry_score": 80.0, "volume_score": 75.0,
                               "context_score": 70.0, "historical_score": 50.0},
        "narrative": {"headline": "test headline", "what_it_is": "", "why_it_matters": "",
                      "what_to_watch_for": "", "failure_signal": ""},
        "status": "ready",
        "detected_at": _NOW, "last_seen_at": _NOW,
    }
    base.update(overrides)
    return base


def test_benchmark_scoped_query_vs_table_size(monkeypatch, tmp_path):
    """Populates a table at a comparable order of magnitude to the real
    production active-detections set (production measured 56,239 rows;
    this uses 5,000 -- enough to make an unbounded full-table scan visibly
    slower than a scoped one on any machine, without a multi-minute test).
    Prints both timings; the load-bearing assertion is only that the scoped
    read stays well under the unbounded one, not an absolute number."""
    db = tmp_path / "patterns.db"
    monkeypatch.setenv("PATTERN_DB_PATH", str(db))
    from api.services.pattern_engine import memory
    from api.services.screener import pattern_join as pj

    for i in range(5000):
        memory.store_detection(_detection(id=f"d{i}", sym=f"SYM{i % 5000}"))

    # Warm the connection/OS cache once so both measurements are apples-to-apples.
    pj.read_pattern_fields_canonical_shadow(["SYM0"])

    t0 = time.perf_counter()
    pj.read_pattern_fields_canonical_shadow(["SYM0", "SYM1", "SYM2"])
    t1 = time.perf_counter()
    scoped_ms = (t1 - t0) * 1000

    # Simulate the PRE-FIX behavior directly for comparison: the same query
    # with no sym filter, fetching the whole table.
    import contextlib
    from api.services.pattern_engine import pattern_db as pdb
    cutoff = int(time.time()) - pj._WINDOW_SECS
    placeholders = ",".join("?" * len(pj._ACTIVE_STATUSES))
    cat_ph = ",".join("?" * len(pj._SCREENER_EXCLUDED_CATEGORIES))
    unscoped_sql = f"""
        SELECT sym, pattern_id, direction, confidence, levels_json, detected_at,
               status, geometry_json, quality_json, narrative_json, eligibility_json
        FROM pattern_detections
        WHERE tf = 'D' AND status IN ({placeholders}) AND detected_at >= ?
          AND (category IS NULL OR category NOT IN ({cat_ph}))
    """
    t2 = time.perf_counter()
    with contextlib.closing(pdb.get_connection()) as conn:
        conn.execute(unscoped_sql, (*pj._ACTIVE_STATUSES, cutoff, *pj._SCREENER_EXCLUDED_CATEGORIES)).fetchall()
    t3 = time.perf_counter()
    unscoped_ms = (t3 - t2) * 1000

    print(f"\n[benchmark] scoped (post-fix, 3 targets) = {scoped_ms:.2f}ms")
    print(f"[benchmark] unscoped (pre-fix shape, full 5000-row table) = {unscoped_ms:.2f}ms")
    print(f"[benchmark] speedup = {unscoped_ms / max(scoped_ms, 0.01):.1f}x")

    assert scoped_ms < unscoped_ms
