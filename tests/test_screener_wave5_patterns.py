"""Wave 5 Task A2: pattern_join.py — active 7-day detections, regime-blind
expectancy, direction as a number.

`PATTERN_DB_PATH` is pinned to a per-test tmp file via monkeypatch BEFORE
`pattern_db`/`memory`/`pattern_join` are imported inside each test (the
`test_screener_wave2_insider.py` idiom) so tests never touch a shared root
and never interfere with each other. Detections are seeded via
`memory.store_detection` (the store's own shape, per the task brief) rather
than reimplementing the INSERT; `pattern_stats` rows are seeded by direct
INSERT since `recompute_stats()` needs real outcome history to produce one.
"""
import time

_NOW = int(time.time())
_DAY = 86400


def _fresh(monkeypatch, tmp_path):
    db = tmp_path / "patterns.db"
    monkeypatch.setenv("PATTERN_DB_PATH", str(db))
    return db


def _detection(**overrides):
    """Minimal valid Detection dict (memory.store_detection's real shape)."""
    base = {
        "id": "det-1",
        "sym": "AAPL", "tf": "D",
        "pattern_id": "bull_flag", "category": "classical", "direction": "bullish",
        "start_t": 1700000000, "end_t": 1700100000,
        "geometry": {"shape": "trendline_pair", "anchors": [], "extras": {}},
        "levels": {"entry": 100.0, "entry_condition": "", "stop": 95.0,
                   "stop_basis": "", "target_primary": 110.0,
                   "target_secondary": None, "risk_reward": 2.0},
        "context": {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
                    "volume_signature": "contracting", "regime": "unknown",
                    "nearest_resistance": 110.0, "nearest_support": 95.0,
                    "days_to_earnings": None, "sector_strength_rank": None},
        "confidence": 75.0,
        "quality_components": {"geometry_score": 80.0, "volume_score": 75.0,
                                "context_score": 70.0, "historical_score": 50.0},
        "narrative": {"headline": "test", "what_it_is": "", "why_it_matters": "",
                      "what_to_watch_for": "", "failure_signal": ""},
        "status": "ready",
        "detected_at": _NOW, "last_seen_at": _NOW,
    }
    base.update(overrides)
    return base


def _stat(pattern_id, expectancy_r, tf="D", regime_bucket="unknown",
          n_resolved=10):
    """Seed one `pattern_stats` row.

    ⚠️ `n_resolved` is a PARAMETER because the default (10) is not the common
    production shape. `recompute_stats()` writes the row the moment a pattern
    is first SEEN, carrying `n_resolved = 0` and a synthetic `expectancy_R` of
    `0.0` — measured 2026-08-23, that is 46 of 79 regime-blind rows. This
    fixture hardcoded 10, so every expectancy test ran against the rarer half
    of reality and the 0.0-for-never-measured defect stayed invisible.
    """
    from api.services.pattern_engine.pattern_db import get_connection
    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO pattern_stats
                 (pattern_id, tf, regime_bucket, n_total, n_resolved,
                  n_entry_hit, n_target_hit, n_stop_hit, avg_mfe_pct,
                  avg_mae_pct, median_bars, hit_rate, expectancy_R, last_updated)
               VALUES (?, ?, ?, 10, ?, 10, 6, 4, 5.0, 3.0, 8, 0.6, ?, ?)""",
            (pattern_id, tf, regime_bucket, n_resolved, expectancy_r, _NOW),
        )
        conn.commit()
    finally:
        conn.close()


def test_two_active_detections_ids_conf_dir_from_best(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.screener import pattern_join as pj

    memory.store_detection(_detection(
        id="d1", sym="AAPL", pattern_id="bull_flag", direction="bullish",
        confidence=60.0, start_t=1, end_t=2,
        levels={"entry": 100.0, "stop": 95.0, "target_primary": 110.0,
                "entry_condition": "", "stop_basis": "",
                "target_secondary": None, "risk_reward": 2.0},
        detected_at=_NOW, last_seen_at=_NOW,
    ))
    memory.store_detection(_detection(
        id="d2", sym="AAPL", pattern_id="cup_handle", direction="bearish",
        confidence=80.0, start_t=3, end_t=4,
        levels={"entry": 110.0, "stop": 105.0, "target_primary": 90.0,
                "entry_condition": "", "stop_basis": "",
                "target_secondary": None, "risk_reward": 2.0},
        detected_at=_NOW, last_seen_at=_NOW,
    ))

    out = pj.read_pattern_fields(["AAPL"])
    row = out["AAPL"]
    assert row["pattern_engine_ids"] == "cup_handle,bull_flag"
    assert row["pattern_engine_conf"] == 80.0
    # best = cup_handle (highest confidence, has both entry+stop) -> bearish
    assert row["pattern_engine_dir"] == -1
    assert row["pattern_entry_px"] == 110.0
    assert row["pattern_stop_px"] == 105.0


def test_missing_stop_skipped_for_best_but_counted_in_ids(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.screener import pattern_join as pj

    # Higher confidence, but no stop -> cannot be "best".
    memory.store_detection(_detection(
        id="d1", sym="MSFT", pattern_id="vcp", direction="bullish",
        confidence=90.0, start_t=1, end_t=2,
        levels={"entry": 300.0, "stop": None, "target_primary": 320.0,
                "entry_condition": "", "stop_basis": "",
                "target_secondary": None, "risk_reward": None},
        detected_at=_NOW, last_seen_at=_NOW,
    ))
    # Lower confidence, but has both levels -> becomes "best".
    memory.store_detection(_detection(
        id="d2", sym="MSFT", pattern_id="flat_base", direction="neutral",
        confidence=50.0, start_t=3, end_t=4,
        levels={"entry": 290.0, "stop": 280.0, "target_primary": 310.0,
                "entry_condition": "", "stop_basis": "",
                "target_secondary": None, "risk_reward": 2.0},
        detected_at=_NOW, last_seen_at=_NOW,
    ))

    out = pj.read_pattern_fields(["MSFT"])
    row = out["MSFT"]
    assert row["pattern_engine_ids"] == "vcp,flat_base"  # confidence-desc, both counted
    assert row["pattern_engine_conf"] == 90.0
    # best-with-levels is flat_base despite lower confidence
    assert row["pattern_engine_dir"] == 0
    assert row["pattern_entry_px"] == 290.0
    assert row["pattern_stop_px"] == 280.0


def test_expired_status_and_stale_detected_at_both_excluded(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.screener import pattern_join as pj

    memory.store_detection(_detection(
        id="d1", sym="NFLX", pattern_id="evening_star", status="expired",
        start_t=1, end_t=2, detected_at=_NOW, last_seen_at=_NOW,
    ))
    memory.store_detection(_detection(
        id="d2", sym="NFLX", pattern_id="morning_star", status="ready",
        start_t=3, end_t=4,
        detected_at=_NOW - 8 * _DAY, last_seen_at=_NOW - 8 * _DAY,
    ))

    out = pj.read_pattern_fields(["NFLX"])
    assert "NFLX" not in out


def test_tf_5_excluded(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.screener import pattern_join as pj

    memory.store_detection(_detection(
        id="d1", sym="TSLA", tf="5", pattern_id="opening_range_breakout",
        status="ready", start_t=1, end_t=2,
        detected_at=_NOW, last_seen_at=_NOW,
    ))

    out = pj.read_pattern_fields(["TSLA"])
    assert "TSLA" not in out


def test_direction_encoding_bullish_bearish_neutral(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.screener import pattern_join as pj

    memory.store_detection(_detection(
        id="d1", sym="BULL", pattern_id="bull_flag", direction="bullish",
        start_t=1, end_t=2, detected_at=_NOW, last_seen_at=_NOW,
    ))
    memory.store_detection(_detection(
        id="d2", sym="BEAR", pattern_id="bear_flag", direction="bearish",
        start_t=3, end_t=4, detected_at=_NOW, last_seen_at=_NOW,
    ))
    memory.store_detection(_detection(
        id="d3", sym="NEUT", pattern_id="doji", direction="neutral",
        start_t=5, end_t=6, detected_at=_NOW, last_seen_at=_NOW,
    ))

    out = pj.read_pattern_fields(["BULL", "BEAR", "NEUT"])
    assert out["BULL"]["pattern_engine_dir"] == 1
    assert out["BEAR"]["pattern_engine_dir"] == -1
    assert out["NEUT"]["pattern_engine_dir"] == 0


def test_expectancy_present_when_stats_row_exists_absent_otherwise(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.screener import pattern_join as pj

    memory.store_detection(_detection(
        id="d1", sym="HASSTAT", pattern_id="bull_flag",
        start_t=1, end_t=2, detected_at=_NOW, last_seen_at=_NOW,
    ))
    memory.store_detection(_detection(
        id="d2", sym="NOSTAT", pattern_id="cup_handle",
        start_t=3, end_t=4, detected_at=_NOW, last_seen_at=_NOW,
    ))
    _stat("bull_flag", 0.42)
    # deliberately no stats row for cup_handle

    out = pj.read_pattern_fields(["HASSTAT", "NOSTAT"])
    assert out["HASSTAT"]["pattern_expectancy_r"] == 0.42
    assert "pattern_expectancy_r" not in out["NOSTAT"]  # never a fabricated 0.0


def test_a_stats_row_with_NOTHING_RESOLVED_yields_no_expectancy(
        monkeypatch, tmp_path):
    """🔴 THE DEFECT THIS TEST EXISTS FOR — shipped, live, and green.

    `recompute_stats()` writes a `pattern_stats` row as soon as a pattern is
    first SEEN, carrying `n_resolved = 0` and a synthetic `expectancy_R` of
    `0.0`. The join guarded on `expectancy_R IS NOT NULL`, which that row
    passes — so **`0.0` shipped to members as a measurement** for every pattern
    that has never had one outcome resolve. A trader reads `0.0` as *"this
    setup breaks even"*; the truth was *"nobody has ever measured this"*.

    Measured on the real store 2026-08-23: **46 of 79** regime-blind rows are
    this shape, including `cup_handle`, `ascending_triangle`, `bear_flag` and
    `avwap_reclaim` — the structural setups a member is most likely to screen
    for. It is this repo's own honest-None rule running backwards.

    ⭐ The sibling assertion is the control: an identical row that HAS resolved
    outcomes still reports, so the fix withholds the unmeasured value rather
    than disabling the field.
    """
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.screener import pattern_join as pj

    memory.store_detection(_detection(
        id="d1", sym="UNRESOLVED", pattern_id="cup_handle",
        start_t=1, end_t=2, detected_at=_NOW, last_seen_at=_NOW,
    ))
    memory.store_detection(_detection(
        id="d2", sym="RESOLVED", pattern_id="bull_flag",
        start_t=3, end_t=4, detected_at=_NOW, last_seen_at=_NOW,
    ))
    # The production shape: the row EXISTS, expectancy_R is NOT NULL, and
    # nothing has ever resolved.
    _stat("cup_handle", 0.0, n_resolved=0)
    _stat("bull_flag", 0.42, n_resolved=10)

    out = pj.read_pattern_fields(["UNRESOLVED", "RESOLVED"])
    assert "pattern_expectancy_r" not in out["UNRESOLVED"], (
        "a pattern with n_resolved=0 published "
        f"{out['UNRESOLVED'].get('pattern_expectancy_r')!r} — 0.0 reads as "
        "'breaks even', not as 'never measured'"
    )
    assert out["RESOLVED"]["pattern_expectancy_r"] == 0.42, (
        "the control failed: the fix withheld a genuinely measured expectancy, "
        "which means it disabled the field rather than gating it"
    )


def test_a_measured_expectancy_of_exactly_zero_is_still_reported(
        monkeypatch, tmp_path):
    """⚠️ The gate is `n_resolved`, NOT the value. A pattern that resolved 40
    times and genuinely averaged 0.0R has *measured* breakeven — a real fact a
    member should see. Gating on `expectancy_R != 0` instead would silence it
    and would look identical in every other test.
    """
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.screener import pattern_join as pj

    memory.store_detection(_detection(
        id="d1", sym="FLAT", pattern_id="cup_handle",
        start_t=1, end_t=2, detected_at=_NOW, last_seen_at=_NOW,
    ))
    _stat("cup_handle", 0.0, n_resolved=40)

    out = pj.read_pattern_fields(["FLAT"])
    assert out["FLAT"]["pattern_expectancy_r"] == 0.0, (
        "a MEASURED breakeven was withheld — the gate keyed off the value "
        "instead of off whether anything resolved"
    )


def test_more_than_ten_active_ids_capped_at_ten(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.screener import pattern_join as pj

    pattern_ids = [f"pat_{i}" for i in range(12)]
    for i, pid in enumerate(pattern_ids):
        memory.store_detection(_detection(
            id=f"d{i}", sym="MANY", pattern_id=pid,
            confidence=float(100 - i),  # strictly descending confidence
            start_t=i * 10, end_t=i * 10 + 1,
            detected_at=_NOW, last_seen_at=_NOW,
        ))

    out = pj.read_pattern_fields(["MANY"])
    ids = out["MANY"]["pattern_engine_ids"].split(",")
    assert len(ids) == 10
    assert ids == pattern_ids[:10]  # highest-confidence 10, in order
    assert out["MANY"]["pattern_engine_conf"] == 100.0


def test_empty_db_returns_empty_and_records_failure_census(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import pattern_join as pj

    failures = {}
    out = pj.read_pattern_fields(["AAPL"], failures=failures)
    assert out == {}
    assert failures["pattern_join"]["empty"] == 1


def test_uncovered_target_ticker_absent_from_result(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.screener import pattern_join as pj

    memory.store_detection(_detection(
        id="d1", sym="SEEDED", pattern_id="bull_flag",
        start_t=1, end_t=2, detected_at=_NOW, last_seen_at=_NOW,
    ))

    out = pj.read_pattern_fields(["SEEDED", "UNSEEDED"])
    assert "SEEDED" in out
    assert "UNSEEDED" not in out


# ── the two review-round pins (A2 review, Important 1): both paths were
# verified correct by out-of-suite probes; these make a future regression
# fail HERE instead of shipping green. ─────────────────────────────────────

def test_confidence_tie_breaks_to_the_newer_detected_at(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.screener import pattern_join as pj

    memory.store_detection(_detection(
        id="old", sym="AAPL", pattern_id="bull_flag", direction="bullish",
        confidence=70.0, start_t=1, end_t=2,
        detected_at=_NOW - 3600, last_seen_at=_NOW - 3600,
    ))
    memory.store_detection(_detection(
        id="new", sym="AAPL", pattern_id="cup_handle", direction="bearish",
        confidence=70.0, start_t=3, end_t=4,
        levels={"entry": 200.0, "stop": 190.0, "target_primary": 220.0,
                "entry_condition": "", "stop_basis": "",
                "target_secondary": None, "risk_reward": 2.0},
        detected_at=_NOW, last_seen_at=_NOW,
    ))

    row = pj.read_pattern_fields(["AAPL"])["AAPL"]
    # Equal confidence: the NEWER detected_at wins best -- a swapped
    # tuple-comparison order would hand it to the older bull_flag.
    assert row["pattern_engine_dir"] == -1
    assert row["pattern_entry_px"] == 200.0


def test_malformed_levels_json_survives_and_stays_honest(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.pattern_engine.pattern_db import get_connection
    from api.services.screener import pattern_join as pj

    memory.store_detection(_detection(
        id="d1", sym="AAPL", pattern_id="bull_flag",
        start_t=1, end_t=2, detected_at=_NOW, last_seen_at=_NOW,
    ))
    conn = get_connection()
    try:
        conn.execute("UPDATE pattern_detections SET levels_json = ?",
                     ("not json{",))
        conn.commit()
    finally:
        conn.close()

    out = pj.read_pattern_fields(["AAPL"])
    row = out["AAPL"]
    # The read SURVIVES; ids/conf still populate; nothing level-derived is
    # fabricated off a row whose levels cannot be parsed.
    assert row["pattern_engine_ids"] == "bull_flag"
    assert row["pattern_engine_conf"] == 75.0
    assert "pattern_engine_dir" not in row
    assert "pattern_entry_px" not in row
    assert "pattern_stop_px" not in row
