"""Phase 8, Package 8C — scanner shadow-parity: the REAL, live-cron-feeding
`pattern_join.read_pattern_fields` compared against the SHADOW-ONLY
`pattern_join.read_pattern_fields_canonical_shadow`, over the same real
SQLite rows.

The shadow function is never called by snapshot_builder.py or any scheduled
job (pinned by `test_read_pattern_fields_source_is_unchanged_by_the_shadow_addition`
below) — this file is the proof that adding it changed nothing about the
live path while the canonical read genuinely adds evidence (eligibility,
event) without changing detector-level facts (identity, direction, the
"best detection" selection).

Same `PATTERN_DB_PATH`-per-test-tmp-file idiom as
test_screener_wave5_pattern_join.py.
"""
import inspect
import time

_NOW = int(time.time())


def _fresh(monkeypatch, tmp_path):
    db = tmp_path / "patterns.db"
    monkeypatch.setenv("PATTERN_DB_PATH", str(db))
    return db


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


def test_read_pattern_fields_source_is_unchanged_by_the_shadow_addition():
    """The live, cron-feeding function's own source is untouched -- pinned
    directly rather than trusted from a commit message."""
    from api.services.screener import pattern_join as pj
    source = inspect.getsource(pj.read_pattern_fields)
    assert "SELECT sym, pattern_id, direction, confidence, levels_json, detected_at" in source
    assert "eligibility" not in source


def test_shadow_reads_the_same_identity_and_direction_as_the_legacy_path(monkeypatch, tmp_path):
    """Same detector-level facts, both ways -- the canonical read must not
    change identity or direction, only add evidence."""
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.pattern_engine.canonical_adapter import adapt_high_tight_flag
    from api.services.screener import pattern_join as pj

    memory.store_detection(adapt_high_tight_flag(_detection(id="d1", sym="AAPL")))

    legacy = pj.read_pattern_fields(["AAPL"])["AAPL"]
    canonical = pj.read_pattern_fields_canonical_shadow(["AAPL"])["AAPL"]

    assert legacy["pattern_engine_dir"] == 1  # bullish
    assert canonical["direction"] == "bullish"
    assert canonical["pattern_id"] == "high_tight_flag"
    assert canonical["confidence"] == legacy["pattern_engine_conf"]


def test_shadow_adds_eligibility_the_legacy_path_never_carries(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.pattern_engine.canonical_adapter import adapt_high_tight_flag
    from api.services.screener import pattern_join as pj

    memory.store_detection(adapt_high_tight_flag(_detection(id="d1", sym="AAPL")))

    legacy = pj.read_pattern_fields(["AAPL"])["AAPL"]
    canonical = pj.read_pattern_fields_canonical_shadow(["AAPL"])["AAPL"]

    assert "scanner_eligible" not in legacy  # the field does not exist on this path at all
    assert canonical["scanner_eligible"] is True
    assert canonical["status"] == "ready"  # identity(status) != eligibility, both present, distinct


def test_shadow_surfaces_peg_event_note_from_the_transitional_mapping(monkeypatch, tmp_path):
    """PEG's event data has no column of its own -- the shadow function
    reconstructs it from geometry_json.extras, the same fields
    canonical_adapter.adapt_power_earnings_gap already uses. Proves the
    'transitional storage mapping' (not native canonical persistence, per
    the relay review) actually works against a real stored row."""
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.screener import pattern_join as pj

    peg = _detection(
        id="d-peg", sym="MSFT", pattern_id="power_earnings_gap",
        geometry={"shape": "candle_mark", "anchors": [], "extras": {
            "gap_pct": 12.0, "days_to_earnings": -1, "earnings_linkage_verified": True,
        }},
    )
    memory.store_detection(peg)  # NOT adapted -- proves reconstruction from raw stored extras

    canonical = pj.read_pattern_fields_canonical_shadow(["MSFT"])["MSFT"]
    assert canonical["event_note"] == "earnings linkage: verified"


def test_shadow_absent_when_no_detection_exists_for_the_symbol(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import pattern_join as pj
    assert pj.read_pattern_fields_canonical_shadow(["ZZZZ"]) == {}


# ─── Phase 8 Package 8F — compare_pattern_shadow (bounded, log-only) ──────

def test_compare_reports_eligibility_unpopulated_not_a_mismatch_for_an_unadapted_row(
    monkeypatch, tmp_path,
):
    """The scan's OWN today-real behavior — a stored, never-adapted row —
    must land in the informational `eligibility_unpopulated` bucket, never
    in any mismatch category."""
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.screener import pattern_join as pj

    memory.store_detection(_detection(id="d1", sym="AAPL"))  # NOT adapted

    result = pj.compare_pattern_shadow(["AAPL"])
    assert result["compared"] == 1
    assert result["eligibility_unpopulated"] == 1
    assert result["parity_clean"] == 0  # excluded from parity_clean, not a mismatch either
    for cat in pj._MISMATCH_CATEGORIES:
        assert result[cat] == 0


def test_compare_reports_parity_clean_for_an_adapted_row_with_agreeing_direction(
    monkeypatch, tmp_path,
):
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.pattern_engine.canonical_adapter import adapt_high_tight_flag
    from api.services.screener import pattern_join as pj

    memory.store_detection(adapt_high_tight_flag(_detection(id="d1", sym="AAPL")))

    result = pj.compare_pattern_shadow(["AAPL"])
    assert result["compared"] == 1
    assert result["eligibility_unpopulated"] == 0
    assert result["parity_clean"] == 1
    assert result["direction_mismatch"] == 0


def test_compare_never_raises_when_the_shadow_read_itself_fails(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import pattern_join as pj

    def _boom(targets):
        raise RuntimeError("simulated shadow-read failure")

    monkeypatch.setattr(pj, "read_pattern_fields_canonical_shadow", _boom)
    result = pj.compare_pattern_shadow(["AAPL"], legacy_map={"AAPL": {}})
    assert result["compared"] == 0
    assert result["comparison_error"] == 1


def test_compare_accepts_a_precomputed_legacy_map_without_requerying(monkeypatch, tmp_path):
    """snapshot_builder.py already computed `pattern_map` — the comparison
    must reuse it, never run a second identical query."""
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.pattern_engine.canonical_adapter import adapt_high_tight_flag
    from api.services.screener import pattern_join as pj

    memory.store_detection(adapt_high_tight_flag(_detection(id="d1", sym="AAPL")))

    calls = []
    real_read = pj.read_pattern_fields

    def _tracked(*a, **k):
        calls.append(1)
        return real_read(*a, **k)

    monkeypatch.setattr(pj, "read_pattern_fields", _tracked)
    precomputed = pj.read_pattern_fields(["AAPL"])
    calls.clear()

    pj.compare_pattern_shadow(["AAPL"], legacy_map=precomputed)
    assert calls == []  # no second call


def test_compare_output_is_bounded_never_an_unbounded_dump(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.screener import pattern_join as pj

    # Force a direction_mismatch on many tickers by hand-crafting a legacy
    # map that disagrees with a real, unadapted canonical read.
    for i in range(60):
        sym = f"SYM{i}"
        memory.store_detection(_detection(id=f"d{i}", sym=sym, direction="bullish"))
    fake_legacy = {
        f"SYM{i}": {"pattern_engine_dir": -1}  # disagrees with the real "bullish" row
        for i in range(60)
    }
    result = pj.compare_pattern_shadow([f"SYM{i}" for i in range(60)], legacy_map=fake_legacy)
    assert result["direction_mismatch"] == 60
    assert len(result["direction_mismatch_sample"]) == pj._SHADOW_LOG_CAP
