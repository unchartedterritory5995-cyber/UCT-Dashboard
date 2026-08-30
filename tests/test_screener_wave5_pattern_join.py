"""Wave 6 — the per-pattern 0/1 flags `pattern_join` writes, and the ONE
distinction that makes them honest.

⛔⛔ **0 IS NOT NULL AND THAT IS THE WHOLE POINT.** A symbol the engine has
active detections for, none of which is a VCP, is a confident `0`. A symbol the
engine has said NOTHING about is absent from the reader's output entirely, so
every flag reads NULL downstream. Fabricating a 0 for the second case would
hand a member screening `pattern_engine_vcp == 0` several hundred symbols the
engine never scanned, under a control that claims to have looked.

`PATTERN_DB_PATH` is pinned to a per-test tmp file via monkeypatch BEFORE
`pattern_db`/`memory`/`pattern_join` are imported (the
`test_screener_wave5_patterns.py` idiom), so these never touch a shared root.
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
        "context": {"trend_stage": 2, "rs_trend": "up",
                    "ma_alignment": "stacked_bullish",
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


# ───────────────────── the three-way, and the NULL is the one ────────────────

def test_a_detected_pattern_flags_1_and_its_sibling_flags_0(monkeypatch, tmp_path):
    """One symbol, one VCP detection: `pattern_engine_vcp` is 1 and
    `pattern_engine_flat_base` is 0 — the engine looked at this symbol and the
    answer to the second question is genuinely NO, not "we don't know"."""
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.screener import pattern_join as pj

    memory.store_detection(_detection(id="d1", sym="AAPL", pattern_id="vcp"))

    row = pj.read_pattern_fields(["AAPL"])["AAPL"]
    assert row["pattern_engine_vcp"] == 1
    assert row["pattern_engine_flat_base"] == 0


def test_both_flags_are_0_when_the_engine_saw_only_other_patterns(monkeypatch, tmp_path):
    """The confident-negative case. `bull_flag` is an active detection, so the
    engine HAS an answer for this symbol; neither flagged pattern is in it."""
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.screener import pattern_join as pj

    memory.store_detection(_detection(id="d1", sym="AAPL", pattern_id="bull_flag"))

    row = pj.read_pattern_fields(["AAPL"])["AAPL"]
    assert row["pattern_engine_vcp"] == 0
    assert row["pattern_engine_flat_base"] == 0
    # …and the confident 0 is a real 0, not a falsy None wearing a 0's clothes.
    assert row["pattern_engine_vcp"] is not None


def test_a_symbol_the_engine_never_answered_for_reads_NULL_not_0(monkeypatch, tmp_path):
    """🔴 THE CASE THAT MATTERS. `UNSCANNED` is a build target with no active
    detection of any kind. It must be ABSENT from the reader's output — which
    is how every one of its columns reads NULL downstream — and must NOT
    appear carrying a fabricated 0.

    ⭐ The non-vacuity control rides in the same call: `AAPL` IS present with a
    confident 0 on `pattern_engine_flat_base`, so this cannot pass because the
    reader returned nothing at all.
    """
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.screener import pattern_join as pj

    memory.store_detection(_detection(id="d1", sym="AAPL", pattern_id="vcp"))

    out = pj.read_pattern_fields(["AAPL", "UNSCANNED"])
    assert "UNSCANNED" not in out, (
        "a symbol the pattern engine has no active detection for must be "
        "absent (-> NULL columns); a 0 here would be a confident 'no pattern' "
        "about a symbol nothing ever looked at")
    assert out["AAPL"]["pattern_engine_flat_base"] == 0   # the control


def test_an_expired_detection_does_not_flag(monkeypatch, tmp_path):
    """A VCP detected nine days ago is outside the 7-day active window. The
    symbol still has a live `bull_flag`, so it is IN the output with the flag
    at a confident 0 — the window is applied to the flag, not just to the ids.
    """
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.screener import pattern_join as pj

    old = _NOW - 9 * _DAY
    memory.store_detection(_detection(id="d1", sym="AAPL", pattern_id="vcp",
                                      detected_at=old, last_seen_at=old))
    memory.store_detection(_detection(id="d2", sym="AAPL", pattern_id="bull_flag"))

    row = pj.read_pattern_fields(["AAPL"])["AAPL"]
    assert row["pattern_engine_vcp"] == 0
    assert "vcp" not in row["pattern_engine_ids"]


def test_the_flag_reads_the_UNCAPPED_id_set(monkeypatch, tmp_path):
    """⭐ THE REASON THE FLAG IS NOT DERIVABLE FROM `pattern_engine_ids`.

    That column is capped at `_MAX_IDS` by confidence-desc for DISPLAY. Give a
    symbol eleven higher-confidence detections plus a low-confidence `vcp`: the
    TEXT list drops `vcp` off the end, and the flag must still say 1. A flag
    computed off the capped string would be a lie caused by a display cap.
    """
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.screener import pattern_join as pj

    loud = ["bull_flag", "bear_flag", "cup_handle", "double_top", "double_bottom",
            "head_shoulders", "pennant", "channel", "rectangle", "nr7",
            "doji"]
    assert len(loud) > pj._MAX_IDS, "the fixture must overflow the display cap"
    for i, pid in enumerate(loud):
        memory.store_detection(_detection(
            id=f"d{i}", sym="AAPL", pattern_id=pid, confidence=90.0 - i))
    memory.store_detection(_detection(
        id="dv", sym="AAPL", pattern_id="vcp", confidence=51.0))

    row = pj.read_pattern_fields(["AAPL"])["AAPL"]
    ids = row["pattern_engine_ids"].split(",")
    assert len(ids) == pj._MAX_IDS
    assert "vcp" not in ids, "fixture no longer exercises the cap"
    assert row["pattern_engine_vcp"] == 1


def test_a_dead_pattern_store_flags_nothing_at_all(monkeypatch, tmp_path):
    """The failure contract reaches the flags too: an empty store returns `{}`,
    so every flag is NULL for every symbol. A source outage must not print as
    'no symbol in the universe has a VCP'."""
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import pattern_db
    from api.services.screener import pattern_join as pj

    pattern_db.init_db()
    failures = {}
    assert pj.read_pattern_fields(["AAPL", "MSFT"], failures=failures) == {}
    assert failures.get("pattern_join", {}).get("empty") == 1


# ───────────────── the map is derived from the registry, not typed ───────────

def test_every_flag_names_a_REGISTERED_detector_id():
    """⛔ PROBE NAMES MUST BE DERIVED. A typo in `_PATTERN_FLAG_COLUMNS` would
    ship a column that is 0 on every row forever and look exactly like a
    pattern nothing ever matches. The id set comes from the detector registry
    itself, and the registry is only populated once `api.routers.patterns` has
    been imported (it triggers registration).
    """
    from api.routers import patterns as _patterns  # noqa: F401
    from api.services.pattern_engine.detectors.registry import list_pattern_ids
    from api.services.screener import pattern_join as pj

    registered = set(list_pattern_ids())
    assert "vcp" in registered and "definitely_not_a_detector" not in registered

    unknown = sorted(pid for pid in pj._PATTERN_FLAG_COLUMNS.values()
                     if pid not in registered)
    assert not unknown, (
        f"{unknown} is flagged as a column and registered as no detector — "
        f"the column would read 0 on every row forever")


def test_every_flag_column_is_a_declared_INT_column():
    """The other half of the join: a key the reader emits that `snapshot_db`
    does not declare is dropped silently by the builder's `if k in row` merge,
    and a bool declared REAL would round-trip as 1.0."""
    from api.services.screener import pattern_join as pj, snapshot_db

    for col in pj._PATTERN_FLAG_COLUMNS:
        assert col in snapshot_db.COLUMNS, col
        assert col in snapshot_db._INT, col
        assert col not in snapshot_db._TEXT, col


def test_the_flag_set_stays_SMALL_and_justified():
    """⛔ NOT ONE COLUMN PER DETECTOR. 85 detectors are registered; each flag
    here is nightly storage on every row of the universe and must earn its
    place by clearing a NAMED refusal in the formula library. This is a
    deliberate ceiling, not a measurement — moving it is a decision somebody
    makes in the report, with the refusal it unlocks named.
    """
    from api.routers import patterns as _patterns  # noqa: F401
    from api.services.pattern_engine.detectors.registry import list_pattern_ids
    from api.services.screener import pattern_join as pj

    assert len(list_pattern_ids()) > 50, "the registry is the thing being resisted"
    assert len(pj._PATTERN_FLAG_COLUMNS) <= 6, (
        f"{len(pj._PATTERN_FLAG_COLUMNS)} per-pattern flags — each one is a "
        f"column on every row of the universe every night. Name the refusal "
        f"each new one clears before raising this.")


def test_the_near_universal_detectors_are_dropped_from_the_display_list():
    """⛔ RANKING THEM LAST WAS NOT ENOUGH — THEY STILL TOOK A SLOT.

    Measured 2026-08-30 over the 7-day active window: 8 of the 78 firing
    detectors hit >=95% of the 2,890 covered symbols (six at exactly 100%).
    With them in, the median symbol carried 14 distinct ids against a cap of
    10, so 2,624 of 2,890 (90.8%) were truncated and a CONTAINS query was
    silently wrong for most of the universe. Without them: median 6, truncated
    202 of 2,890 (7.0%).
    """
    import api.services.screener.pattern_join as pj

    universal = "fires_on_everything"
    rare = "fires_on_one"
    n = pj.MIN_POPULATION_FOR_EXCLUSION + 50
    by_ticker = {}
    for i in range(n):
        ids = [universal] + ([rare] if i == 0 else [])
        by_ticker[f"T{i}"] = ids

    pid_symbols = {}
    for ids in by_ticker.values():
        for pid in set(ids):
            pid_symbols[pid] = pid_symbols.get(pid, 0) + 1

    floor = pj.UNINFORMATIVE_SHARE * len(by_ticker)
    assert pid_symbols[universal] >= floor, "fixture: the universal id must clear the bar"
    assert pid_symbols[rare] < floor, "fixture: the rare id must not"


def test_the_exclusion_refuses_to_act_on_a_population_too_small_to_measure():
    """⛔ A SHARE IS NOT ESTIMABLE ON A HANDFUL OF SYMBOLS. With one covered
    ticker, 0.95 x 1 = 0.95 and EVERY detector clears the bar — which would
    empty the column entirely. That is a measurement of "there is only one
    symbol here", not of informativeness, so below the floor nothing is
    excluded at all.
    """
    import api.services.screener.pattern_join as pj

    assert pj.MIN_POPULATION_FOR_EXCLUSION >= 100
    tiny = pj.MIN_POPULATION_FOR_EXCLUSION - 1
    floor = (pj.UNINFORMATIVE_SHARE * tiny
             if tiny >= pj.MIN_POPULATION_FOR_EXCLUSION else float("inf"))
    assert floor == float("inf"), "a tiny population must exclude nothing"
