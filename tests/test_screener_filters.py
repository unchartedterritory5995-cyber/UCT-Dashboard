"""The filter registry — and the rail that a FILLED column is a SCREENABLE one.

🔴 THE DEFECT THIS FILE GREW FOR. `53b88b1d` filled eleven columns that had been
NULL on all 3,708 rows of the live snapshot, and `filters.py` had no registry
entry for a single one of them. The screener's classic door is built entirely
out of this registry: no entry, no control, and a member could sort by `P/E` and
never search on it. "The data exists" and "a member can use it" are two facts,
and only one of them had a test.
"""
import importlib
import re

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

    ⭐ A DEFINITION IS NOT AN OPINION, and the exemption is derived from the
    filter (`factual_presets`), never from a list of labels retyped here.
    `dividend_yield > 0` IS what "pays a dividend" means; there is no other
    number to choose, so shipping it asserts nothing on the firm's behalf. The
    line between the two is whether a reasonable trader could pick a different
    boundary — for "cheap P/E" there are a hundred, which is why `pe_ttm` is
    still bare below and this rail still fails if it stops being.
    """
    deferred = {k: f for k, f in filters.FILTERS.items()
                if f.get("presets_deferred")}
    # A floor, so a broken marker cannot make this pass over an empty set.
    assert len(deferred) >= 10, f"only {len(deferred)} preset-free controls found"
    for key, f in deferred.items():
        labels = [p["label"] for p in f["presets"]]
        allowed = ["Any", *f.get("factual_presets", ())]
        assert labels == allowed, (
            f"{key} ships preset thresholds {labels} — anything beyond {allowed} "
            f"is the firm's opinion and the firm has not published it (E-8). "
            f"Ship the control; leave the threshold to the owner.")
        assert f["allow_custom"] is True, (
            f"{key} has no presets AND no custom range — that is not a "
            f"control, it is a label")


#: ⭐ THE THREE FACTUAL PRESETS, AND WHY EACH ONE IS A DEFINITION RATHER THAN A
#: VERDICT. Named here so the exemption is reviewable prose and not a silent
#: `factual_presets` key that any future filter could quietly acquire.
FACTUAL_PRESETS = {
    "dividend_yield": ("Pays a dividend",
                       "a yield above zero IS paying one; 205 corroborated zeros"),
    "debt_to_equity": ("Debt-free", "zero debt IS debt-free; 238 corroborated"),
    "beta":           ("Less volatile than the market",
                       "the market is 1.0 by construction"),
}


def test_only_the_reviewed_definitions_are_exempt():
    """⛔ THE GUARD ON THE EXEMPTION. `factual_presets` makes a preset invisible
    to the rail above, so without this a fourth filter could be handed one and
    ship `pe_ttm < 15` wearing a "definition" label.

    ⭐ SELF-CLEANING IN BOTH DIRECTIONS: a new exemption fails until it is
    reviewed and named here, and deleting a preset from the registry fails until
    the entry is removed too.
    """
    exempt = {k: tuple(f["factual_presets"]) for k, f in filters.FILTERS.items()
              if f.get("factual_presets")}
    assert set(exempt) == set(FACTUAL_PRESETS), (
        f"the exempt set is {sorted(exempt)}, reviewed is "
        f"{sorted(FACTUAL_PRESETS)} — an unreviewed exemption is how an "
        f"editorial threshold ships disguised as a definition")
    for key, (label, _why) in FACTUAL_PRESETS.items():
        assert exempt[key] == (label,), f"{key} exempts {exempt[key]}, not {label!r}"


def test_a_factual_preset_uses_the_STRICT_operator_its_label_claims():
    """🔴 THE HALF THAT MAKES THE LABEL TRUE, and each is a real defect avoided.

    `dividend_yield >= 0` returns the 205 corroborated ZEROS under a control
    that says "pays a dividend". `debt_to_equity <= 0` returns NEGATIVE-equity
    companies — distressed names — under "debt-free". `beta <= 1` returns a beta
    of exactly 1.00 under "less volatile than the market". An inclusive operator
    here does not soften the claim; it makes it false.
    """
    want = {
        "dividend_yield": ("gt", "min", 0),
        "debt_to_equity": ("eq", "value", 0),
        "beta":           ("lt", "max", 1),
    }
    for key, (op, field, value) in want.items():
        f = filters.FILTERS[key]
        preset = next(p for p in f["presets"] if p["label"] != "Any")
        assert preset["op"] == op, (
            f"{key}'s {preset['label']!r} uses {preset['op']!r}; the inclusive "
            f"form makes the label state something untrue")
        assert preset[field] == value
        assert filters.is_valid_op(key, op), (
            f"{key} ships a {op!r} preset the query builder would reject — the "
            f"control renders and refuses to run")


def test_the_editorial_thresholds_are_still_NOT_shipped():
    """The other side of the line. This whole change is worthless if it becomes
    the precedent for shipping `pe_ttm < 15`."""
    for key in ("pe_ttm", "ps", "pb", "gross_margin", "net_margin", "roa",
                "current_ratio"):
        labels = [p["label"] for p in filters.FILTERS[key]["presets"]]
        assert labels == ["Any"], (
            f"{key} grew presets {labels}. A P/E, a margin or a current ratio "
            f"has no definitional boundary — those are the owner's call (E-8)")


def test_no_bulk_filled_column_gains_an_invented_threshold():
    """🔴 THE OTHER HALF, and the one that keeps the rail above from being
    narrowed into uselessness. Every control over a column `fundamentals_bulk`
    fills must be either preset-free OR a NAMED, DATED exemption — so a
    fifteenth column arriving with "Under 20" attached is red, and the three
    that predate the rule stay visible instead of quietly in scope-limbo.

    ⭐ SELF-CLEANING IN BOTH DIRECTIONS: the day the owner decides `roe`'s
    presets, striking them from the registry makes this fail until the
    allowance is deleted too.

    ⚠️ A FACTUAL preset does not count as a threshold here — `dividend_yield >
    0` is what "pays a dividend" MEANS, not a number this firm picked. The
    exemption is DERIVED from the filter's own `factual_presets`, and
    `test_only_the_reviewed_definitions_are_exempt` is the guard that stops a
    genuine opinion putting on that label.
    """
    from api.services.screener import fundamentals_bulk as fb
    offenders, stale = [], []
    for key, f in filters.FILTERS.items():
        if f["column"] not in fb.COLUMNS_WRITTEN or f["type"] != "range":
            continue
        editorial = [p["label"] for p in f["presets"]
                     if p["label"] != "Any"
                     and p["label"] not in f.get("factual_presets", ())]
        has_presets = bool(editorial)
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


def test_accdis_ships_as_the_enum_it_always_was(tmp_path, monkeypatch):
    """🔴 THE HONEST SURFACE, Wave 6 lane 2. The column has held letter grades
    A–E since v1 (`ratings._accdis_letter`), while the manifest declared it
    `yields:"num"` and `filters.py` deliberately shipped NO control (the
    containment comment this task removes). T1 excluded the lying scalar; the
    filter the Wave-1 plan drafted can now land: an enum whose options come off
    the artifact — the same dynamic mechanism as sector/exchange — so the
    control offers exactly the grades the rows hold, never a typed A–E list.
    """
    _snapshot(tmp_path, monkeypatch, [
        {"ticker": "ACCU", "accdis": "A",
         "snapshot_date": "2026-08-22", "built_at": 1},
        {"ticker": "DIST", "accdis": "E",
         "snapshot_date": "2026-08-22", "built_at": 1},
        {"ticker": "BARE", "accdis": None,
         "snapshot_date": "2026-08-22", "built_at": 1},
    ])
    f = filters.FILTERS["accdis"]
    assert f["type"] == "enum", "accdis is letter grades — an enum, never a range"
    assert f["column"] == "accdis"
    assert f["category"] == "fundamental"
    assert f["label"] == "Acc/Dis Grade"
    assert f["allow_custom"] is False

    # Options are READ OFF THE ROWS (options_column), never typed: only the
    # grades actually present appear, and NULL never becomes an option.
    got = {x["key"]: x["presets"] for x in filters.meta()["filters"]}
    assert [p["label"] for p in got["accdis"]] == ["Any", "A", "E"]
    assert got["accdis"][1] == {"label": "A", "op": "eq", "value": "A"}

    # ⭐ A registry entry is not a control until a scan runs through it.
    from api.services.screener import query
    importlib.reload(query)
    assert filters.is_valid_op("accdis", "eq")
    rows = query.run_scan(
        {"filters": [{"key": "accdis", "op": "eq", "value": "A"}]})["rows"]
    assert sorted(r["ticker"] for r in rows) == ["ACCU"]


# ───────── Wave 6 (T6) — finviz parity: transactions pair + option/short ────

def test_wave6_transactions_pair_ships_preset_free():
    """The two signed-% controls carry NO editorial threshold (E-8): nobody at
    this firm has published what a 'heavy' insider-selling percentage is, so
    the control ships bare and the member types the number."""
    for key in ("insider_trans_pct", "inst_trans_pct"):
        f = filters.FILTERS[key]
        assert f["type"] == "range", key
        assert f["category"] == "ownership", key
        assert f["unit"] == "%", key
        assert f.get("presets_deferred") is True, key
        assert [p["label"] for p in f["presets"]] == ["Any"], key
        assert f["allow_custom"] is True, key


def test_wave6_option_short_flags_are_bool_controls():
    """Optionable/Shortable are Yes/No facts about the instrument — a bool
    control (Any/Yes/No over the stored 1/0), never a range over a flag."""
    for key in ("optionable", "shortable"):
        f = filters.FILTERS[key]
        assert f["type"] == "bool", key
        assert f["category"] == "descriptive", key
        assert [p["label"] for p in f["presets"]] == ["Any", "Yes", "No"], key
        yes = next(p for p in f["presets"] if p["label"] == "Yes")
        no = next(p for p in f["presets"] if p["label"] == "No")
        assert (yes["op"], yes["value"]) == ("eq", 1), key
        assert (no["op"], no["value"]) == ("eq", 0), key
        assert filters.is_valid_op(key, "eq"), key


def test_wave6_controls_run_end_to_end_against_real_rows(tmp_path, monkeypatch):
    """Registry -> build_where -> SQL -> rows for all four Wave 6 controls.
    NULL is honest-absence throughout: an unknown flag is returned by NEITHER
    Yes nor No, and an unknown transactions % never matches a range."""
    _snapshot(tmp_path, monkeypatch, [
        {"ticker": "SELL", "insider_trans_pct": -7.5, "inst_trans_pct": 2.0,
         "optionable": 1, "shortable": 1,
         "snapshot_date": "2026-08-22", "built_at": 1},
        {"ticker": "BUYS", "insider_trans_pct": 4.2, "inst_trans_pct": -1.0,
         "optionable": 0, "shortable": 1,
         "snapshot_date": "2026-08-22", "built_at": 1},
        {"ticker": "DARK", "insider_trans_pct": None, "inst_trans_pct": None,
         "optionable": None, "shortable": None,
         "snapshot_date": "2026-08-22", "built_at": 1},
    ])
    from api.services.screener import query
    importlib.reload(query)

    def tickers(spec):
        return sorted(r["ticker"] for r in query.run_scan(spec)["rows"])

    assert tickers({"filters": [
        {"key": "insider_trans_pct", "op": "lte", "max": -5}]}) == ["SELL"]
    assert tickers({"filters": [
        {"key": "inst_trans_pct", "op": "gte", "min": 1}]}) == ["SELL"]
    assert tickers({"filters": [
        {"key": "optionable", "op": "eq", "value": 1}]}) == ["SELL"]
    # A NULL flag is neither Yes nor No — DARK appears in neither answer.
    assert tickers({"filters": [
        {"key": "optionable", "op": "eq", "value": 0}]}) == ["BUYS"]
    assert tickers({"filters": [
        {"key": "shortable", "op": "eq", "value": 1}]}) == ["BUYS", "SELL"]


# ───────── Wave 6 (parity2) — finviz parity: the growth trio ────────────────

def test_parity2_growth_trio_ships_preset_free():
    """The three signed-% growth controls carry NO editorial threshold (E-8):
    nobody at this firm has published what a 'strong' five-year growth rate
    is, so the control ships bare and the member types the number."""
    for key in ("eps_past_5y_growth", "eps_next_5y_growth",
                "sales_past_5y_growth"):
        f = filters.FILTERS[key]
        assert f["type"] == "range", key
        assert f["category"] == "fundamental", key
        assert f["unit"] == "%", key
        assert f.get("presets_deferred") is True, key
        assert [p["label"] for p in f["presets"]] == ["Any"], key
        assert f["allow_custom"] is True, key
    # The estimate column's label SAYS it is an estimate — the honesty is on
    # the control, not buried in a tooltip.
    assert "est" in filters.FILTERS["eps_next_5y_growth"]["label"].lower()


def test_parity2_qoq_facts_keep_their_one_existing_control_each():
    """⛔ EPS Q/Q and Sales Q/Q ship NO new controls: `eps_growth` and
    `rev_growth` are those facts already (latest quarter vs the year-ago
    quarter). A second key over either would be the second-authority defect.
    """
    assert "eps_qoq_growth" not in filters.FILTERS
    assert "sales_qoq_growth" not in filters.FILTERS
    assert "rev_qoq_growth" not in filters.FILTERS
    assert filters.FILTERS["eps_growth"]["column"] == "eps_growth"
    assert filters.FILTERS["rev_growth"]["column"] == "rev_growth"


def test_parity2_growth_controls_run_end_to_end_against_real_rows(
        tmp_path, monkeypatch):
    """Registry -> build_where -> SQL -> rows for the three growth controls.
    NULL is honest-absence throughout (an unfilled growth never matches a
    range), and a NEGATIVE bound selects the shrinkers — the signed lane the
    trio exists for."""
    _snapshot(tmp_path, monkeypatch, [
        {"ticker": "GROW", "eps_past_5y_growth": 34.0,
         "eps_next_5y_growth": 22.5, "sales_past_5y_growth": 18.0,
         "snapshot_date": "2026-08-22", "built_at": 1},
        {"ticker": "SHRK", "eps_past_5y_growth": -41.07,
         "eps_next_5y_growth": 4.0, "sales_past_5y_growth": -3.1,
         "snapshot_date": "2026-08-22", "built_at": 1},
        {"ticker": "DARK", "eps_past_5y_growth": None,
         "eps_next_5y_growth": None, "sales_past_5y_growth": None,
         "snapshot_date": "2026-08-22", "built_at": 1},
    ])
    from api.services.screener import query
    importlib.reload(query)

    def tickers(spec):
        return sorted(r["ticker"] for r in query.run_scan(spec)["rows"])

    assert tickers({"filters": [
        {"key": "eps_past_5y_growth", "op": "gte", "min": 25}]}) == ["GROW"]
    assert tickers({"filters": [
        {"key": "eps_past_5y_growth", "op": "lte", "max": -25}]}) == ["SHRK"]
    assert tickers({"filters": [
        {"key": "eps_next_5y_growth", "op": "gte", "min": 10}]}) == ["GROW"]
    assert tickers({"filters": [
        {"key": "sales_past_5y_growth", "op": "lte", "max": 0}]}) == ["SHRK"]
    # DARK matches nothing — an unanswered growth is absence, never a zero.
    assert tickers({"filters": [
        {"key": "sales_past_5y_growth", "op": "gte", "min": -100}]}) == [
        "GROW", "SHRK"]


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


# ───────── ONE COLUMN, TWO REGISTERS — and the rail that keeps them one ──────
#
# 🔴 THE DEFECT SHAPE. `close_position` is named, in words, in two member-facing
# places, and on 2026-08-09 nothing connected them:
#
#   * `filters.py` — label **"Close Position in Range"**, a control label in the
#     classic screener's Single Candle group.
#   * `closedTable.json::scalars.close_position.sentence` — **"the close's
#     position inside the bar's range"**, the read-back fragment that has to slot
#     into `<phrase> is greater than or equal to 0.66` in the builder.
#
# ⭐ THERE IS NO THIRD. A census on 2026-08-09 looked for the screener column
# header the audit suspected: `close_position` has no entry in
# `app/src/pages/screener/columnDefs.js` and appears in no `filters.VIEWS`
# column list, so `ResultsTable` never renders a header for it. The chips row
# derives its text from `def.label` (`chipLabel.js`), and the concept
# vocabulary's phrase is produced by calling `sentenceFor(...)` and is asserted
# equal in `conceptVocabulary.test.js`. Two phrasings, not three.
#
# ⭐ AND THEY ARE NOT COLLAPSIBLE, WHICH IS WHY THIS IS A RAIL AND NOT A REFACTOR.
# The two populations do different jobs and read differently on purpose: labels
# abbreviate ("ROE", "PEG", "P/E (TTM)"), sentences spell out ("the return on
# equity", "the trailing price/earnings ratio"). Deriving either from the other
# would force one string into two slots and make one of the two surfaces read
# badly — for 38 columns, not one. So the rail below checks the things that CAN
# be crossed: that both lanes still name the column, that they agree on what it
# yields, and that neither has been "de-duplicated" into the other's slot.
#
# ⛔ WHAT THIS CANNOT CHECK, STATED SO NOBODY MISTAKES IT FOR COVERAGE: it cannot
# tell you the two phrasings still MEAN the same thing. No mechanical rule spans
# "ROE" and "the return on equity" without a hand-written alias table, and a hand
# table is the third authority this whole exercise exists to avoid.

#: The one mapping between the two vocabularies, stated once. `enum` filters name
#: text columns (`sector`, `patterns`, `candle_type`, …) that the closed table
#: does not declare as scalars at all, so they pair with nothing and are excluded
#: BY THE ABSENCE OF A SCALAR, never by a list of keys.
_YIELDS_TO_CONTROL = {"num": "range", "bool": "bool"}


def _paired_columns():
    """`column -> (filter key, filter spec, scalar name, scalar spec)` for every
    snapshot column BOTH member-facing lanes name.

    ⛔ DERIVED FROM BOTH REGISTRIES, never listed. The day a scalar lands with a
    control — or a control lands over a declared scalar — it is in here without
    anybody remembering to add it, which is the only way this rail can catch the
    next `close_position` instead of only the one it was written for.
    """
    from api.services import ast_table

    scalars = {k: v for k, v in ast_table.TABLE["scalars"].items()
               if not k.startswith("_")}
    by_column = {}
    for name, spec in scalars.items():
        src = spec.get("source") or {}
        if src.get("store") != "screener_rows":
            continue
        by_column.setdefault(src.get("column"), []).append((name, spec))

    out = {}
    for key, f in filters.FILTERS.items():
        for name, spec in by_column.get(f["column"], ()):
            out.setdefault(f["column"], []).append((key, f, name, spec))
    return out


def test_the_two_lane_pairing_is_not_vacuous():
    """⛔ A rail that judges an empty set passes for the wrong reason forever."""
    pairs = _paired_columns()
    assert len(pairs) > 30, (
        f"only {len(pairs)} columns are named by both the filter registry and the "
        "closed table. Either a registry moved or the reader below is broken — "
        "every assertion in this section would then be measuring nothing.")


def test_a_column_named_by_both_lanes_is_named_ONCE_in_each():
    """Two controls over one column, or two scalars over one column, is the
    second-authority defect in its purest form: a member changes one and the
    other keeps answering the old way."""
    for column, entries in _paired_columns().items():
        assert len(entries) == 1, (
            f"{column} is named {len(entries)} times across the two lanes: "
            f"{[(e[0], e[2]) for e in entries]}")


def test_the_two_lanes_AGREE_ON_WHAT_A_COLUMN_YIELDS():
    """🔴 The mutation this catches is real: the `close_position` fix harness
    plants exactly it (`yields: num -> bool`). A column the builder reads as a
    number and the screener offers as a checkbox is one column with two
    contradictory contracts, and the member meets whichever surface they opened.
    """
    for column, ((fkey, f, sname, spec),) in _paired_columns().items():
        expected = _YIELDS_TO_CONTROL.get(spec.get("yields"))
        assert expected is not None, (
            f"the closed table says {sname} yields {spec.get('yields')!r}, which "
            "no control type corresponds to — add the correspondence deliberately "
            "or fix the declaration")
        assert f["type"] == expected, (
            f"{column}: the closed table says it yields {spec['yields']!r} but "
            f"filters.py ships a {f['type']!r} control ({fkey} / {sname})")


def test_the_control_LABEL_and_the_read_back_SENTENCE_stay_TWO_STRINGS():
    """⭐ THE WRONG FIX, ASSERTED AGAINST.

    Faced with two phrasings of one column, the tempting move is to make one
    string serve both jobs. It cannot: the label sits in a form control and the
    sentence sits mid-clause after `1 when …` and before `is greater than or
    equal to 0.66`. Copying either into the other's slot ships gibberish on one
    of the two surfaces — the CLAUSE-shaped sentence this rail's subject already
    shipped once (`closedTable.test.js` owns that half).

    ⛔ BOTH REGISTER RULES ARE READ OFF THE POPULATIONS, not typed as taste:
    every one of the filter registry's labels opens on a capital, and every one
    of the closed table's sentences opens in lower case. The evidence counts are
    asserted first so this cannot judge off a handful of entries.
    """
    from api.services import ast_table

    labels = [f["label"] for f in filters.FILTERS.values()]
    sentences = [s["sentence"] for k, s in ast_table.TABLE["scalars"].items()
                 if not k.startswith("_") and s.get("sentence")]
    assert len(labels) > 30 and len(sentences) > 30, (
        f"{len(labels)} labels / {len(sentences)} sentences — too few to read a "
        "register off, so the rules below would be one agent's taste")

    assert [l for l in labels if l[:1].islower()] == [], (
        "a filter label opens in lower case — that is the read-back register. A "
        "sentence pasted into a control label reads as a broken caption.")
    assert [s for s in sentences if s[:1].isupper()] == [], (
        "a closed-table sentence opens on a capital — that is the control-label "
        "register. It lands mid-clause in the builder's read-back.")
    assert set(labels) & set(sentences) == set(), (
        "a control label and a read-back sentence are now the same string. One "
        "string cannot do both jobs; keep the two phrasings and keep this rail.")


def test_accdis_control_is_unpaired_BY_EXCLUSION_not_by_accident():
    """⭐ WHY THE ENUM IS LEGAL under the yields↔control rail above. That rail
    pairs BY DECLARED SCALAR, so an enum over a column with no scalar pairs
    with nothing — which is exactly accdis's governed state after T1: the
    scalar that lied (`yields:"num"` over letter grades) is EXCLUDED with a
    written reason, not merely missing. This pins all three facts together so
    a future re-declaration of an accdis scalar goes red HERE, by name, the
    moment it would put the enum control and a scalar over one column
    (`test_the_two_lanes_AGREE…` would then fail on the type mismatch, but
    this failure says WHY).
    """
    from api.services import ast_table

    assert "accdis" in filters.FILTERS, (
        "the accdis enum control is gone — the column is back to sortable-"
        "but-unscreenable through the classic door")
    declared = {k for k in ast_table.TABLE["scalars"] if not k.startswith("_")}
    assert "accdis" not in declared, (
        "an accdis scalar is DECLARED again while the enum control ships — "
        "that re-creates the two-lane contradiction T1/T2 existed to end; "
        "one lane must go")
    reason = ast_table.TABLE["_scalars_excluded"].get("accdis", "")
    assert len(reason) >= 20, (
        f"accdis's exclusion carries no written reason ({reason!r}) — "
        "unpaired-by-exclusion is only honest while the manifest says why")
    assert "accdis" not in _paired_columns(), (
        "the pairing reader sees accdis in both lanes — the exclusion above "
        "is not doing what this test claims it does")


# ───────── Wave 5 — the flow category (K5 both halves) + honest wording ─────
#
# ⚠️ These cases deliberately consult ONLY this task's own artifacts
# (filters.py + columnDefs.js) — never the closed-table manifest, which Task B1
# edits concurrently. The two-lane rails above light up over the Wave-5 columns
# on their own the moment B1's declarations land; nothing here pre-empts them.

def test_every_filter_category_key_is_a_rendered_category():
    """⛔ THE HALF THAT FAILS SILENTLY. `FilterRail` groups controls under
    `meta()['categories']`; a filter whose category key has no CATEGORIES entry
    renders in NO group — a shipped control no member can reach. Derived over
    every filter, so the next category typo goes red without a new pin."""
    cat_keys = {c["key"] for c in filters.CATEGORIES}
    orphans = {k: f["category"] for k, f in filters.FILTERS.items()
               if f["category"] not in cat_keys}
    assert not orphans, (
        f"filters grouped under a category CATEGORIES never renders: {orphans}")
    # Non-vacuity: the set this rail sweeps includes the Wave-5 newcomer.
    assert "flow" in {f["category"] for f in filters.FILTERS.values()}


def test_the_flow_category_is_present_in_BOTH_halves():
    """K5 both halves, pinned explicitly: the category ENTRY exists (the
    rendered half) AND controls actually reference it (the populated half).
    Either alone is a silent nothing — an entry with no filters is hidden by
    `FilterRail`, and filters with no entry render in no group."""
    entries = [c for c in filters.CATEGORIES if c["key"] == "flow"]
    assert entries == [{"key": "flow", "label": "Positioning & Flow"}], (
        f"CATEGORIES half wrong or duplicated: {entries}")
    members = {k for k, f in filters.FILTERS.items() if f["category"] == "flow"}
    dp_opt = {k for k in filters.FILTERS if k.startswith(("dp_", "opt_"))}
    assert members and members == dp_opt, (
        f"the flow category holds {sorted(members)} but the dp_*/opt_* controls "
        f"are {sorted(dp_opt)} — one category owns ALL of them and nothing else")
    # ...and pattern_engine_* joined the EXISTING pattern category — never a
    # second pattern group (K5's other half of the same ruling).
    engine = {k for k in filters.FILTERS if k.startswith("pattern_engine")}
    assert engine, "no pattern_engine_* controls found — the sweep is vacuous"
    for key in engine:
        assert filters.FILTERS[key]["category"] == "pattern", (
            f"{key} sits in {filters.FILTERS[key]['category']!r}, not 'pattern'")
    # The served payload carries the new category too (what the panel reads).
    assert "flow" in {c["key"] for c in filters.meta()["categories"]}


def _column_def_block(name):
    """One entry's source text from columnDefs.js — the established
    `test_screener_wave1_columndefs.py` read-off-the-artifact idiom, extended
    to capture the (multi-line) entry body rather than just the key."""
    src = open("app/src/pages/screener/columnDefs.js", encoding="utf-8").read()
    m = re.search(rf"^  {re.escape(name)}: \{{(?P<body>.*?)(?=^  [a-z_]\w*: \{{|^\}})",
                  src, flags=re.M | re.S)
    assert m, f"columnDefs.js has no entry for {name}"
    return m.group("body")


def test_pattern_expectancy_r_tells_the_member_the_R_is_ASSUMED():
    """🔴 D3: `expectancy_R` is SYNTHETIC — the pattern's hit rate applied at a
    fixed 2R-win/1R-loss assumption, not measured realized R. A member sizing a
    trade off a column called "Expect R" that never says so is being handed an
    assumption dressed as a measurement. The word "assumed" in the member-facing
    description is the honesty this pin protects."""
    body = _column_def_block("pattern_expectancy_r")
    assert "assumed" in body, (
        "pattern_expectancy_r's columnDefs description no longer says the "
        "2R-win/1R-loss is ASSUMED (ruling D3) — synthetic expectancy must "
        "never read as measured R")
    # Non-vacuity control: the extractor sees ONE entry, not the whole file —
    # a neighbouring block does not carry the word.
    assert "assumed" not in _column_def_block("pattern_engine_conf")


def test_every_filter_FAMILY_is_VISIBLE_in_at_least_one_view():
    """⛔ A FILTER CATEGORY WITH NO VIEW BEHIND IT IS A HALF-SHIPPED FAMILY.

    Found on 2026-08-23 by OPENING THE SCREEN, not by a test: Waves 5-6 shipped
    the pattern engine, dark-pool/options positioning and the ownership/short
    block — each with its own filter category — and not one of their columns
    appeared in ANY view. A member could filter on dark-pool notional and then
    have no way to SEE it short of hand-picking the column out of the picker.
    Measuring the gap found three MORE families in the same state since Waves
    1-2 (`context`, `events`, `multi_candle`).

    ⭐ DERIVED BOTH SIDES — categories come from `FILTERS` and columns from
    `VIEWS`, so a family added tomorrow is covered the day it lands. `my_scans`
    is exempt BY NAME and for a reason: its filter selects membership in a
    saved scan, it is not a column family, and there is no column to show.
    """
    view_cols = {c for v in filters.VIEWS.values() for c in v["columns"]}
    by_cat: dict[str, list[str]] = {}
    for key, f in filters.FILTERS.items():
        by_cat.setdefault(f.get("category"), []).append(f.get("column") or key)

    invisible = {
        cat: cols for cat, cols in by_cat.items()
        if cat != "my_scans" and not (set(cols) & view_cols)
    }
    assert not invisible, (
        "these filter families are filterable but INVISIBLE — no view shows any "
        f"of their columns: { {k: sorted(v)[:4] for k, v in invisible.items()} }")


def test_every_view_is_LABELLED_and_leads_with_the_ticker():
    """The two things a view must get right to be usable at all."""
    for vkey, v in filters.VIEWS.items():
        assert v.get("label"), f"{vkey} has no label"
        assert v["columns"][0] == "ticker", (
            f"{vkey} must lead with ticker; leads with {v['columns'][0]}")
        assert len(v["columns"]) == len(set(v["columns"])), f"{vkey} repeats a column"
