"""The filter registry — and the rail that a FILLED column is a SCREENABLE one.

🔴 THE DEFECT THIS FILE GREW FOR. `53b88b1d` filled eleven columns that had been
NULL on all 3,708 rows of the live snapshot, and `filters.py` had no registry
entry for a single one of them. The screener's classic door is built entirely
out of this registry: no entry, no control, and a member could sort by `P/E` and
never search on it. "The data exists" and "a member can use it" are two facts,
and only one of them had a test.
"""
import importlib

from api.services.screener import filters, snapshot_db


def test_every_filter_column_exists_in_schema():
    for key, f in filters.FILTERS.items():
        assert f["column"] in snapshot_db.COLUMNS, f"{key} -> {f['column']}"


def test_every_view_column_is_known():
    known = set(snapshot_db.COLUMNS)
    for vkey, v in filters.VIEWS.items():
        for c in v["columns"]:
            assert c in known, f"{vkey} -> {c}"


def test_meta_shape():
    m = filters.meta()
    assert {"filters", "views", "categories"} <= set(m)
    assert any(f["key"] == "sector" for f in m["filters"])
    assert any(v["key"] == "overview" for v in m["views"])


def test_op_validation():
    assert filters.is_valid_op("rsi14", "range") is False  # 'range' is a type, not an op
    assert filters.is_valid_op("rsi14", "between") is True
    assert filters.is_valid_op("rsi14", "in") is False
    assert filters.is_valid_op("sector", "eq") is True
    assert filters.is_valid_op("nope", "eq") is False


# ───────────────── a filled column is a screenable one ──────────────────────

def test_every_column_the_bulk_pass_fills_has_a_filter_control():
    """🔴 THE PRODUCT RAIL, and it is RED on the commit before this one.

    ⛔ THE LIST IS DERIVED FROM THE COLLECTOR, never typed here. A test that
    retyped the fourteen names would go quiet the day a fifteenth landed —
    which is exactly how eleven filled columns came to have no control:
    nothing tied "we now write this" to "a member can search on it".
    """
    from api.services.screener import fundamentals_bulk as fb
    by_column = {f["column"] for f in filters.FILTERS.values()}
    missing = sorted(fb.COLUMNS_WRITTEN - by_column)
    assert not missing, (
        f"`fundamentals_bulk` fills {missing} and the registry offers no "
        f"control for them — the column is populated and unscreenable through "
        f"the classic door. Add a `_open_range`/`_enum` entry.")


def test_no_filter_key_is_bound_to_a_column_twice():
    """Two keys over one column are two ways to say one thing, and the chip row
    would show both. Not a crash — a member confused about which one is real."""
    seen = {}
    for key, f in filters.FILTERS.items():
        seen.setdefault(f["column"], []).append(key)
    dupes = {c: k for c, k in seen.items() if len(k) > 1}
    assert not dupes, f"one column, two filter keys: {dupes}"


#: ⏳ FILTERS OVER A BULK-FILLED COLUMN THAT SHIP A THRESHOLD, with the date the
#: exemption was accepted. ⛔ NOT MINE, AND NOT NEW: all three predate the
#: grounding rule and are already in front of members, so deleting their presets
#: is itself a product change and belongs to the owner. They are recorded here
#: rather than swept under the rail's scope, because "the rule does not reach
#: this" and "nobody looked" are indistinguishable once a check is narrowed.
PRESETS_PREDATE_THE_RULE = {
    "peg":       "2026-08-09 'Under 1'/'Under 2' shipped before E-8; owner call",
    "op_margin": "2026-08-09 'Positive'/'Over 20%' shipped before E-8; owner call",
    "roe":       "2026-08-09 'Over 15%'/'Over 25%' shipped before E-8; owner call",
}


def test_a_preset_free_control_stays_preset_free():
    """⭐ E-8's GROUNDING RULE, asserted where it can actually fail.

    A preset is an editorial claim: *"P/E: Cheap (under 15)"* asserts that this
    firm considers 15 cheap. The controls `_open_range` builds carry `Any` and
    nothing else, and `allow_custom` is what keeps that a real control rather
    than a stub — the member types the number, so the number is theirs.

    ⛔ THE SET IS DERIVED FROM THE CONSTRUCTOR (`presets_deferred`), never
    retyped: the marker rides on the filter, so a threshold quietly added to one
    of them later fails here without anyone remembering to update a list.
    """
    deferred = {k: f for k, f in filters.FILTERS.items()
                if f.get("presets_deferred")}
    # A floor, so a broken marker cannot make this pass over an empty set.
    assert len(deferred) >= 10, f"only {len(deferred)} preset-free controls found"
    for key, f in deferred.items():
        labels = [p["label"] for p in f["presets"]]
        assert labels == ["Any"], (
            f"{key} ships preset thresholds {labels} — those are the firm's "
            f"opinion and the firm has not published them (E-8). Ship the "
            f"control; leave the threshold to the owner.")
        assert f["allow_custom"] is True, (
            f"{key} has no presets AND no custom range — that is not a "
            f"control, it is a label")


def test_no_bulk_filled_column_gains_an_invented_threshold():
    """🔴 THE OTHER HALF, and the one that keeps the rail above from being
    narrowed into uselessness. Every control over a column `fundamentals_bulk`
    fills must be either preset-free OR a NAMED, DATED exemption — so a
    fifteenth column arriving with "Under 20" attached is red, and the three
    that predate the rule stay visible instead of quietly in scope-limbo.

    ⭐ SELF-CLEANING IN BOTH DIRECTIONS: the day the owner decides `roe`'s
    presets, striking them from the registry makes this fail until the
    allowance is deleted too.
    """
    from api.services.screener import fundamentals_bulk as fb
    offenders, stale = [], []
    for key, f in filters.FILTERS.items():
        if f["column"] not in fb.COLUMNS_WRITTEN or f["type"] != "range":
            continue
        has_presets = [p["label"] for p in f["presets"]] != ["Any"]
        if has_presets and key not in PRESETS_PREDATE_THE_RULE:
            offenders.append(key)
        if not has_presets and key in PRESETS_PREDATE_THE_RULE:
            stale.append(key)
    assert not offenders, (
        f"{offenders} filter a bulk-filled column and ship a threshold nobody "
        f"at this firm published (E-8). Ship the control preset-free, or make "
        f"the exemption explicit and dated.")
    assert not stale, (
        f"{stale} no longer ship presets — delete their entries from "
        f"PRESETS_PREDATE_THE_RULE rather than leaving a dead exemption.")
    for key, reason in PRESETS_PREDATE_THE_RULE.items():
        assert key in filters.FILTERS, f"unknown filter key exempted: {key}"
        assert reason[:4].isdigit() and reason[4] == "-" and len(reason) > 20, \
            f"PRESETS_PREDATE_THE_RULE[{key}] needs a dated reason: {reason!r}"


# ───────────────── the enum options come off the artifact ───────────────────

def _snapshot(tmp_path, monkeypatch, rows):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    import api.services.screener.snapshot_db as db
    importlib.reload(db)
    db.init_db()
    db.upsert_rows(rows)
    importlib.reload(filters)
    return db


def test_exchange_options_are_read_from_the_rows_not_typed_in_the_registry(
        tmp_path, monkeypatch):
    """⛔ DERIVE, NEVER RESTATE. Typing NYSE/NASDAQ/AMEX/CBOE/PNK into the
    registry would be a second authority over a set the column already owns —
    wrong the first time FMP renames a venue or a sixth one appears."""
    _snapshot(tmp_path, monkeypatch, [
        {"ticker": "AAA", "exchange": "NASDAQ", "sector": "Tech",
         "snapshot_date": "2026-08-09", "built_at": 1},
        {"ticker": "BBB", "exchange": "NYSE", "sector": "Tech",
         "snapshot_date": "2026-08-09", "built_at": 1},
        {"ticker": "CCC", "exchange": None, "sector": "Energy",
         "snapshot_date": "2026-08-09", "built_at": 1},
    ])
    got = {f["key"]: f["presets"] for f in filters.meta()["filters"]}
    assert [p["label"] for p in got["exchange"]] == ["Any", "NASDAQ", "NYSE"]
    assert got["exchange"][1] == {"label": "NASDAQ", "op": "eq",
                                  "value": "NASDAQ"}
    # ...and the pre-existing dynamic enum still works through the same path.
    assert [p["label"] for p in got["sector"]] == ["Any", "Energy", "Tech"]


def test_a_dynamic_enum_with_no_rows_offers_any_rather_than_a_stale_guess(
        tmp_path, monkeypatch):
    """An empty artifact must not be papered over with a remembered list — that
    is `lesson_seeded_default_becomes_recorded_fact`. `Any` alone is honest."""
    _snapshot(tmp_path, monkeypatch, [
        {"ticker": "AAA", "snapshot_date": "2026-08-09", "built_at": 1}])
    got = {f["key"]: f["presets"] for f in filters.meta()["filters"]}
    assert [p["label"] for p in got["exchange"]] == ["Any"]


def test_a_dynamic_enum_needs_no_edit_to_meta_to_get_its_options(
        tmp_path, monkeypatch):
    """⚰️ `meta()` used to choose the dynamic path with `if key == "sector"`.
    That put the fact in the wrong place — `exchange`, an enum over an artifact
    column needing exactly the same treatment, would have rendered a bare `Any`
    and looked like a shipped control that matches nothing.

    ⛔ ASSERTED BEHAVIOURALLY, not by reading `meta()`'s source. A source check
    would pass vacuously the moment the hardcoded key moved into a helper —
    this repo has measured that exact failure. Here a filter `meta()` has never
    heard of gets its options anyway, which only a derived path can do.
    """
    _snapshot(tmp_path, monkeypatch, [
        {"ticker": "AAA", "ma_stack": "full-bull",
         "snapshot_date": "2026-08-09", "built_at": 1},
        {"ticker": "BBB", "ma_stack": "bear",
         "snapshot_date": "2026-08-09", "built_at": 1},
    ])
    key, spec = filters._enum("brand_new", "Brand New", "technical", "ma_stack",
                              [{"label": "Any"}], options_column="ma_stack")
    monkeypatch.setitem(filters.FILTERS, key, spec)
    got = {f["key"]: f["presets"] for f in filters.meta()["filters"]}
    assert [p["label"] for p in got["brand_new"]] == ["Any", "bear", "full-bull"]

    # ...and the same filter WITHOUT the marker keeps its static presets, so the
    # marker is proven to be what does the work.
    key2, static = filters._enum("brand_new_static", "Static", "technical",
                                 "ma_stack", [{"label": "Any"}])
    monkeypatch.setitem(filters.FILTERS, key2, static)
    got = {f["key"]: f["presets"] for f in filters.meta()["filters"]}
    assert [p["label"] for p in got["brand_new_static"]] == ["Any"]


# ───────────────── the controls actually select ─────────────────────────────

def test_the_new_controls_run_end_to_end_against_real_rows(tmp_path, monkeypatch):
    """⭐ A REGISTRY ENTRY IS NOT A CONTROL UNTIL A SCAN RUNS THROUGH IT. This
    goes registry -> `build_where` -> SQL -> rows, on the two shapes the panel
    emits (a custom range, and a dynamic enum pick)."""
    _snapshot(tmp_path, monkeypatch, [
        {"ticker": "BANK", "pe_ttm": 9.0, "current_ratio": None, "beta": 0.8,
         "exchange": "NYSE", "roe": 11.0, "op_margin": 30.0, "peg": 0.9,
         "snapshot_date": "2026-08-09", "built_at": 1},
        {"ticker": "GROW", "pe_ttm": 60.0, "current_ratio": 2.4, "beta": 1.9,
         "exchange": "NASDAQ", "roe": 45.0, "op_margin": 25.0, "peg": 2.6,
         "snapshot_date": "2026-08-09", "built_at": 1},
    ])
    from api.services.screener import query
    importlib.reload(query)

    def tickers(spec):
        return sorted(r["ticker"] for r in query.run_scan(spec)["rows"])

    assert tickers({"filters": [
        {"key": "pe_ttm", "op": "lte", "max": 20}]}) == ["BANK"]
    assert tickers({"filters": [
        {"key": "beta", "op": "between", "min": 1.5, "max": 2.5}]}) == ["GROW"]
    assert tickers({"filters": [
        {"key": "exchange", "op": "eq", "value": "NASDAQ"}]}) == ["GROW"]
    # The three that changed provider are reachable under the SAME keys they
    # always had — the member-facing contract did not move.
    assert tickers({"filters": [
        {"key": "roe", "op": "gte", "min": 40}]}) == ["GROW"]
    assert tickers({"filters": [
        {"key": "peg", "op": "lte", "max": 1}]}) == ["BANK"]
    assert tickers({"filters": [
        {"key": "op_margin", "op": "gte", "min": 28}]}) == ["BANK"]
    # 🔴 A REFUSED ZERO IS NULL, AND NULL IS NOT `< 1`. The bank has no current
    # ratio and must not be returned by a liquidity screen — the whole point of
    # refusing FMP's undefined 0.
    assert tickers({"filters": [
        {"key": "current_ratio", "op": "lte", "max": 1}]}) == []
    assert tickers({"filters": [
        {"key": "current_ratio", "op": "gte", "min": 2}]}) == ["GROW"]


def test_every_new_control_accepts_the_ops_the_panel_can_emit():
    """`FilterPanel`'s custom row emits `gte`, `lte` or `between`; the enum
    select emits `eq`. A control that rejects its own panel's op is a 400 the
    member cannot get around."""
    from api.services.screener import fundamentals_bulk as fb
    for key, f in filters.FILTERS.items():
        if f["column"] not in fb.COLUMNS_WRITTEN:
            continue
        ops = ("gte", "lte", "between") if f["type"] == "range" else ("eq",)
        for op in ops:
            assert filters.is_valid_op(key, op), f"{key} rejects {op}"
