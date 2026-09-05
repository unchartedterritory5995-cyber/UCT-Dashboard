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


# ─── Phase 8 Package 8G-B Performance Closure — structural, not wall-clock ──
#
# Root cause (measured live, 2026-09-05): read_pattern_fields_canonical_shadow
# carried NO ticker filter in its SQL -- it fetched and Python-filtered the
# ENTIRE active-detections table on every call (56,239 rows measured live),
# regardless of target count (instrumented: 1-ticker call 754.90ms, 9-ticker
# call 727.79ms -- statistically identical, proving row-fetch volume, not
# candidate count, was the driver). These test the ARCHITECTURE stays bounded
# rather than re-asserting a brittle wall-clock number; live/end-to-end timing
# is a separate acceptance measurement (see the performance-closure report).

def test_query_is_scoped_by_sym_not_a_full_table_scan():
    """The SQL text itself must carry a sym-scoping clause -- the structural
    fact that makes this a bounded query instead of the full-table fetch
    that caused the live regression."""
    import inspect
    from api.services.screener import pattern_join as pj

    source = inspect.getsource(pj.read_pattern_fields_canonical_shadow)
    assert "sym IN" in source


def test_unrelated_tickers_data_is_never_fetched(monkeypatch, tmp_path):
    """Populate many tickers; request only one. The result must be exactly
    that one ticker's data -- proving the query didn't need to touch (and
    per the structural test above, did not fetch) the other tickers' rows
    to answer the request."""
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.screener import pattern_join as pj

    for i in range(30):
        memory.store_detection(_detection(id=f"unrelated-{i}", sym=f"UNREL{i}"))
    memory.store_detection(_detection(id="d-target", sym="CRM"))

    out = pj.read_pattern_fields_canonical_shadow(["CRM"])
    assert set(out.keys()) == {"CRM"}


def test_empty_targets_returns_empty_without_querying(monkeypatch, tmp_path):
    """An empty target list is a real caller shape (a legacy-matched
    candidate list can be empty) and must short-circuit before building a
    zero-placeholder `sym IN ()` -- which would be invalid SQL -- rather
    than reaching the database at all."""
    _fresh(monkeypatch, tmp_path)
    import api.services.screener.pattern_join as pj

    def _boom(*a, **k):
        raise AssertionError("must not open a connection for empty targets")

    monkeypatch.setattr("api.services.pattern_engine.pattern_db.get_connection", _boom)
    assert pj.read_pattern_fields_canonical_shadow([]) == {}


def test_duplicate_and_mixed_case_targets_still_resolve_correctly(monkeypatch, tmp_path):
    """The SQL-level scoping dedupes/uppercases into `target_syms` for the
    query, but the per-target output loop still iterates the CALLER's
    original `targets` list -- this must not change behavior for a caller
    passing duplicates or mixed case."""
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.screener import pattern_join as pj

    memory.store_detection(_detection(id="d-crm", sym="CRM"))

    out = pj.read_pattern_fields_canonical_shadow(["crm", "CRM", "Crm"])
    assert set(out.keys()) == {"CRM"}
    assert out["CRM"]["pattern_id"] == "high_tight_flag"


def test_query_param_count_scales_with_targets_not_table_size(monkeypatch, tmp_path):
    """Structural proxy for the fixed cost: the TOTAL bound-param count must
    grow by exactly one per additional DISTINCT target -- proving the extra
    params are the sym filter (scoped to what was asked for), never a
    function of the 50-row table this test populates. A regression back to
    an unfiltered fetch would keep the param count constant instead."""
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.screener import pattern_join as pj

    for i in range(50):
        memory.store_detection(_detection(id=f"d{i}", sym=f"SYM{i}"))

    captured = []
    import api.services.pattern_engine.pattern_db as pattern_db

    real_get_connection = pattern_db.get_connection

    class _SpyConn:
        """`sqlite3.Connection.execute` is a read-only C attribute and can't
        be monkeypatched on the instance -- wrap the connection instead."""
        def __init__(self, real_conn):
            self._real = real_conn

        def execute(self, sql, params=()):
            if "sym IN" in sql:
                captured.append(len(params))
            return self._real.execute(sql, params)

        def close(self):
            return self._real.close()

    def _spy():
        return _SpyConn(real_get_connection())

    monkeypatch.setattr("api.services.pattern_engine.pattern_db.get_connection", _spy)

    pj.read_pattern_fields_canonical_shadow(["SYM0"])
    pj.read_pattern_fields_canonical_shadow(["SYM0", "SYM1", "SYM2"])

    assert len(captured) == 2
    assert captured[1] - captured[0] == 2  # +2 targets -> +2 bound params, never +49


def test_shadow_query_forces_the_sym_tf_index_in_source():
    """The SQL text itself must force idx_pd_sym_tf -- the structural fact
    that prevents SQLite's planner from silently choosing a worse index
    (idx_pd_status) for this exact WHERE shape. Measured live on real
    production data (Phase 8 Package 8G-B Residual Performance Closure,
    2026-09-05): the unforced planner chose idx_pd_status and visited
    ~57,000 status-matching rows table-wide, 350x slower than forcing
    idx_pd_sym_tf for an identical 4-ticker result (~400ms vs ~1.2ms)."""
    import inspect
    from api.services.screener import pattern_join as pj

    source = inspect.getsource(pj.read_pattern_fields_canonical_shadow)
    assert "INDEXED BY idx_pd_sym_tf" in source


def test_shadow_query_plan_actually_uses_the_sym_tf_index(monkeypatch, tmp_path):
    """Not just the SQL text -- the REAL SQLite query planner, against a
    real populated table, must report idx_pd_sym_tf in EXPLAIN QUERY PLAN.
    Captures the ACTUAL SQL `read_pattern_fields_canonical_shadow` executes
    (via this file's own SpyConn idiom, never a hand-retyped copy) so a
    regression that renamed or dropped the hint goes red here even if it
    slipped past a looser source-text match."""
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.screener import pattern_join as pj
    import api.services.pattern_engine.pattern_db as pattern_db

    memory.store_detection(_detection(id="d1", sym="AAPL"))

    real_get_connection = pattern_db.get_connection
    captured = {}

    class _SpyConn:
        def __init__(self, real_conn):
            self._real = real_conn

        def execute(self, sql, params=()):
            if "sym IN" in sql:
                captured["sql"], captured["params"] = sql, params
            return self._real.execute(sql, params)

        def close(self):
            return self._real.close()

    monkeypatch.setattr(
        "api.services.pattern_engine.pattern_db.get_connection",
        lambda: _SpyConn(real_get_connection()))

    pj.read_pattern_fields_canonical_shadow(["AAPL"])
    assert "sql" in captured

    conn = real_get_connection()
    try:
        plan = [dict(r) for r in conn.execute(
            "EXPLAIN QUERY PLAN " + captured["sql"], captured["params"]).fetchall()]
    finally:
        conn.close()
    detail = " ".join(str(p.get("detail", "")) for p in plan)
    assert "idx_pd_sym_tf" in detail
    assert "idx_pd_status" not in detail
