"""The measured universe band — and the four ways it refuses to lie.

🔴 THE DEFECT THIS FILE GREW FOR. A 594-metric benchmark scored this screener
LAST in the honesty family, and the reason was not weak honesty machinery — it
was that ours is INTERNAL. 81 of 147 controls ship as a blank box on a rule that
is correct (`filters._open_range`: a threshold nobody at the firm publishes must
not ship wearing the firm's name), while Zacks ships the same bare box PLUS a
published, universe-cited range on all 136 of its criteria. A measured
percentile is not an editorial claim — it is a fact about our own rows — so the
honest reading of our own rule was always Zacks' measured range, not a blank.

⛔ AND IT MUST NOT BECOME A PRESET. The rails below are split accordingly: the
arithmetic must be right, the coverage must travel with it, the floors must
refuse BY NAME, and the payload must be structurally incapable of rendering as
a threshold. `presets_deferred` stays TRUE — that is asserted in
`test_screener_filters.py`, where the preset rails already live.
"""
import importlib

import pytest

from api.services.screener import distribution


@pytest.fixture(autouse=True)
def _clean_cache():
    """A cached vintage from a previous test must never answer for this one.
    The cache key carries the DB path precisely so it cannot, but a rail that
    depends on that is a rail measuring the wrong thing — clear it explicitly."""
    distribution.invalidate()
    yield
    distribution.invalidate()


def _rows(n, **columns):
    out = []
    for i in range(n):
        row = {"ticker": f"T{i:04d}", "snapshot_date": "2026-08-23",
               "built_at": 1}
        for col, values in columns.items():
            row[col] = values[i]
        out.append(row)
    return out


def _db(tmp_path, monkeypatch, rows, name="s.db"):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / name))
    from api.services.screener import snapshot_db
    importlib.reload(snapshot_db)
    snapshot_db.init_db()
    if rows:
        snapshot_db.upsert_rows(rows)
    distribution.invalidate()
    return snapshot_db


# ───────────────────────── the arithmetic ───────────────────────────────────

def test_the_five_percentiles_are_the_observed_values_at_the_nearest_rank(
        tmp_path, monkeypatch):
    """⭐ EXACT, ON A KNOWN FIXTURE. Prices 1…400, so every answer is checkable
    by hand under the nearest-rank definition `ceil(p/100 · n)`:
    p5→20, p25→100, p50→200, p75→300, p95→380.
    """
    _db(tmp_path, monkeypatch,
        _rows(400, price=[float(i + 1) for i in range(400)]))

    band = distribution.distributions()["columns"]["price"]
    assert band["non_null"] == 400
    assert band["universe"] == 400
    assert "refused" not in band
    assert (band["p5"], band["p25"], band["p50"], band["p75"], band["p95"]) == \
        (20.0, 100.0, 200.0, 300.0, 380.0)


def test_a_percentile_is_a_value_some_symbol_ACTUALLY_HAS(tmp_path, monkeypatch):
    """🔴 NO INTERPOLATION, and this fixture is the reason it matters. Half the
    universe at $1 and half at $1000: an interpolating percentile prints
    $500.50 for the median, a price no symbol in the set trades at, under a
    label that says "typical". Nearest-rank can only ever return a value that
    is in the column."""
    _db(tmp_path, monkeypatch,
        _rows(400, price=[1.0] * 200 + [1000.0] * 200))

    band = distribution.distributions()["columns"]["price"]
    assert band["p50"] == 1.0
    assert band["p75"] == 1000.0
    for pct in distribution.PERCENTILES:
        assert band[f"p{pct}"] in (1.0, 1000.0), (
            f"p{pct} = {band[f'p{pct}']} is not a value any row holds — that is "
            f"an interpolated percentile wearing the word 'typical'")


# ─────────────── the coverage floors, each refusing BY NAME ─────────────────

def test_the_coverage_floor_refuses_a_sparse_column_BY_NAME(tmp_path, monkeypatch):
    """🔴 THE LIE THIS EXISTS TO STOP. 120 of 400 symbols answered — the
    percentiles of those 120 describe *whoever answered*, presented under a
    label that says "the universe". Provider-gated columns are exactly this
    shape (dark-pool notional is non-null only for names that printed a block).

    ⭐ IT REFUSES BY NAME, and the name is the one that fired: `non_null` here
    clears `MIN_NON_NULL`, so a refusal reading `below_min_non_null` would be
    telling the member the wrong reason.
    """
    _db(tmp_path, monkeypatch,
        _rows(400, rsi14=[float(i) for i in range(120)] + [None] * 280))

    band = distribution.distributions()["columns"]["rsi14"]
    assert band["refused"] == distribution.REFUSED_COVERAGE
    assert band["non_null"] == 120 and band["universe"] == 400
    assert band["non_null"] >= distribution.MIN_NON_NULL, (
        "this fixture no longer isolates the coverage floor — it now trips the "
        "count floor too and the test would pass for the wrong reason")
    assert not [k for k in band if k.startswith("p")], (
        f"a refused column emitted percentiles anyway: {band}")


def test_a_column_with_no_data_yields_NO_BAND(tmp_path, monkeypatch):
    """A band over nothing is worse than no band: it looks like an answer."""
    _db(tmp_path, monkeypatch, _rows(400, peg=[None] * 400))

    band = distribution.distributions()["columns"]["peg"]
    assert band["refused"] == distribution.REFUSED_NO_DATA
    assert band["non_null"] == 0 and band["universe"] == 400
    assert not [k for k in band if k.startswith("p")]


def test_a_band_over_three_rows_is_refused_even_at_full_coverage(
        tmp_path, monkeypatch):
    """100% coverage of a three-row table is still three rows. The count floor
    is a SECOND floor for exactly this reason — a ratio alone calls it perfect.
    """
    _db(tmp_path, monkeypatch, _rows(3, price=[10.0, 20.0, 30.0]))

    band = distribution.distributions()["columns"]["price"]
    assert band["refused"] == distribution.REFUSED_MIN_NON_NULL
    assert band["non_null"] == 3 and band["universe"] == 3
    assert not [k for k in band if k.startswith("p")]


def test_letter_grades_in_a_numeric_column_are_NOT_a_percentile(
        tmp_path, monkeypatch):
    """⚠️ SQLite is dynamically typed and this repo has already been bitten:
    `accdis` held letter grades in a REAL-declared column since v1. Sorting a
    mixed str/float list raises in Python 3, so the failure mode without this
    guard is a 500 on `meta()` — and the failure mode with a naive guard is
    reporting a column full of grades as "no data", which is a different and
    also-false fact. It gets its own reason.
    """
    _db(tmp_path, monkeypatch, _rows(400, pe_ttm=["A"] * 400))

    band = distribution.distributions()["columns"]["pe_ttm"]
    assert band["refused"] == distribution.REFUSED_NOT_NUMERIC
    assert band["non_null"] == 0, "a letter grade is not a value a band may use"
    assert not [k for k in band if k.startswith("p")]


def test_a_zero_one_flag_gets_no_band(tmp_path, monkeypatch):
    """⛔ DERIVED FROM THE VALUES, never from a typed list of flag columns —
    a list would be a second authority over which columns are flags and would
    go stale on the next one. p50 of a Yes/No is not a typical range."""
    _db(tmp_path, monkeypatch,
        _rows(400, consecutive_up=[i % 2 for i in range(400)]))

    band = distribution.distributions()["columns"]["consecutive_up"]
    assert band["refused"] == distribution.REFUSED_BINARY
    assert band["non_null"] == 400


# ────────────────── coverage travels with EVERY entry ───────────────────────

def test_every_entry_carries_its_coverage_whether_it_emitted_a_band_or_not(
        tmp_path, monkeypatch):
    """A percentile without its coverage is a lie the shape of a fact, and a
    refusal without its coverage is an unexplained blank. Both carry it."""
    _db(tmp_path, monkeypatch,
        _rows(400,
              price=[float(i + 1) for i in range(400)],
              rsi14=[float(i) for i in range(120)] + [None] * 280,
              peg=[None] * 400))

    cols = distribution.distributions()["columns"]
    assert len(cols) > 50, f"only {len(cols)} numeric columns — sweep is thin"
    emitted = [c for c, b in cols.items() if "refused" not in b]
    assert emitted, "no band was emitted at all — every assertion below is vacuous"
    for name, band in cols.items():
        assert isinstance(band["non_null"], int), name
        assert isinstance(band["universe"], int), name
        assert band["universe"] == 400, name
        assert 0 <= band["non_null"] <= band["universe"], name
        assert ("refused" in band) != any(k.startswith("p") for k in band), (
            f"{name} is both refused and answered, or neither: {band}")


def test_a_band_carries_NONE_of_the_five_keys_a_PRESET_carries(
        tmp_path, monkeypatch):
    """⛔ THE STRUCTURAL HALF OF 'descriptive, never prescriptive'.

    A preset in this registry is `{label, op, min|max|value}`. A band that
    carried any of those could be dropped straight into a preset list by a
    panel, a refactor, or a reader in a hurry, and the firm would be shipping a
    threshold it never published. The payload is shaped so that cannot happen —
    which is a stronger guarantee than a comment asking nobody to do it.
    """
    _db(tmp_path, monkeypatch,
        _rows(400, price=[float(i + 1) for i in range(400)]))

    forbidden = {"label", "op", "min", "max", "value"}
    cols = distribution.distributions()["columns"]
    assert cols, "vacuous"
    for name, band in cols.items():
        assert forbidden & set(band) == set(), (
            f"{name}'s band carries preset-shaped keys "
            f"{sorted(forbidden & set(band))} — it can now be rendered as a "
            f"threshold this firm never published")


def test_the_basis_states_both_floors_and_says_it_recommends_NOTHING(
        tmp_path, monkeypatch):
    """The floors are published beside the numbers, not buried in a module. And
    the one member-facing sentence says what the band is NOT."""
    _db(tmp_path, monkeypatch,
        _rows(400, price=[float(i + 1) for i in range(400)]))

    basis = distribution.distributions()["basis"]
    assert basis["percentiles"] == [5, 25, 50, 75, 95]
    assert basis["min_non_null"] == distribution.MIN_NON_NULL
    assert basis["coverage_floor"] == distribution.MIN_COVERAGE
    assert basis["descriptive_only"] is True
    assert basis["universe"] == 400
    assert basis["snapshot_date"] == "2026-08-23"

    text = f"{basis['label']} {basis['note']}".lower()
    for word in ("recommend", "should", "ideal", "good", "reasonable",
                 "healthy", "cheap", "expensive", "target"):
        if word == "recommend":
            # The note is allowed to say it recommends NOTHING; what it may
            # never do is recommend something.
            assert "not a threshold this firm recommends" in text, basis["note"]
            continue
        assert word not in text, (
            f"the band's own caption says {word!r} — that is an editorial "
            f"claim, and this payload exists precisely because we do not make "
            f"one: {basis['label']!r} / {basis['note']!r}")


# ─────────────────────────── the cache ──────────────────────────────────────

def _tracing_connect(monkeypatch, snapshot_db, sink):
    real = snapshot_db.connect

    def traced():
        conn = real()
        conn.set_trace_callback(sink.append)
        return conn

    monkeypatch.setattr(snapshot_db, "connect", traced)


def test_the_second_call_runs_the_FINGERPRINT_and_not_the_SCAN(
        tmp_path, monkeypatch):
    """⭐ COUNTED OFF THE SQL, not off a hit counter. Measured on this box, the
    compute costs ~55 ms over 102 columns and the fingerprint ~2 ms; `meta()` is
    on the request path, so the first is not payable per call and the second is.

    `PRAGMA table_info` runs ONLY inside `compute`, which makes it an exact
    marker for "the expensive pass ran" — no proxy, no counter to drift.
    """
    db = _db(tmp_path, monkeypatch,
             _rows(400, price=[float(i + 1) for i in range(400)]))
    sink = []
    _tracing_connect(monkeypatch, db, sink)

    first_result = distribution.distributions()
    first = list(sink)
    sink.clear()
    second_result = distribution.distributions()
    second = list(sink)

    assert first, "the trace callback saw nothing — this test measures nothing"
    assert sum("PRAGMA table_info" in s for s in first) == 1, first
    assert sum("PRAGMA table_info" in s for s in second) == 0, (
        f"the wide scan ran again on a cache hit: {second}")
    assert second, (
        "the second call issued NO sql at all — the bands are then cached "
        "blind to a rebuild, which is the staleness this design refuses")
    assert len(second) < len(first)
    assert first_result == second_result


def test_a_REBUILT_snapshot_invalidates_the_cache_with_no_hook_to_forget(
        tmp_path, monkeypatch):
    """⭐ THE FRESHNESS MECHANISM, ASSERTED. The cache key IS the snapshot
    fingerprint, so the nightly rebuild retires last night's bands by
    construction. A TTL-only cache would need `snapshot_builder` to call an
    invalidator — a second authority on freshness, and one nobody remembers.
    """
    db = _db(tmp_path, monkeypatch,
             _rows(400, price=[float(i + 1) for i in range(400)]))
    before = distribution.distributions()
    assert before["columns"]["price"]["p50"] == 200.0

    # A rebuild: every price doubles and `built_at` moves, as the builder does.
    db.upsert_rows([{"ticker": f"T{i:04d}", "price": float((i + 1) * 2),
                     "snapshot_date": "2026-08-24", "built_at": 2}
                    for i in range(400)])

    sink = []
    _tracing_connect(monkeypatch, db, sink)
    after = distribution.distributions()
    assert sum("PRAGMA table_info" in s for s in sink) == 1, (
        "the rebuilt snapshot served last night's bands")
    assert after["columns"]["price"]["p50"] == 400.0
    assert after["basis"]["snapshot_date"] == "2026-08-24"


def test_two_snapshots_that_agree_on_shape_do_not_share_a_cached_band(
        tmp_path, monkeypatch):
    """The DB PATH is in the fingerprint on purpose: a sandbox and production
    can trivially agree on row count and timestamps, and a cache that confused
    them would hand one snapshot's bands to the other."""
    _db(tmp_path, monkeypatch,
        _rows(400, price=[float(i + 1) for i in range(400)]), name="a.db")
    a = distribution.distributions()["columns"]["price"]["p50"]

    # Same row count, same built_at, same snapshot_date — different file.
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "b.db"))
    from api.services.screener import snapshot_db
    importlib.reload(snapshot_db)
    snapshot_db.init_db()
    snapshot_db.upsert_rows(_rows(400, price=[float(i + 1) * 3
                                              for i in range(400)]))
    b = distribution.distributions()["columns"]["price"]["p50"]

    assert (a, b) == (200.0, 600.0), (
        "the second snapshot was served the first one's band — the cache key "
        "does not separate two files")


# ─────────────────── what is deliberately NOT measured ──────────────────────

def test_a_date_column_gets_no_band_even_though_it_is_a_range_control(
        tmp_path, monkeypatch):
    """`ipo_date` and `next_earnings_date` are range controls over TEXT
    columns. A "typical range" of an earnings date is not a thing, and they are
    excluded by the declared-type gate rather than by a list of names — so the
    next date column added is excluded the day it lands."""
    _db(tmp_path, monkeypatch,
        _rows(400,
              price=[float(i + 1) for i in range(400)],
              ipo_date=["2020-01-01"] * 400,
              next_earnings_date=["2026-09-01"] * 400))

    cols = distribution.distributions()["columns"]
    assert "ipo_date" not in cols
    assert "next_earnings_date" not in cols
    assert "price" in cols, "the gate excluded everything — vacuous"


def test_build_bookkeeping_is_not_offered_as_a_distribution(
        tmp_path, monkeypatch):
    """`built_at` is an epoch second describing the BUILD. It is numeric and it
    is not a distribution of anything a member screens on."""
    _db(tmp_path, monkeypatch,
        _rows(400, price=[float(i + 1) for i in range(400)]))
    assert "built_at" not in distribution.distributions()["columns"]


def test_an_unreadable_snapshot_costs_the_BANDS_and_nothing_else(
        tmp_path, monkeypatch):
    """Honest absence, the same contract `_distinct_options` and
    `_my_scans_entry` already hold: a broken snapshot must never take down the
    whole `meta()` payload."""
    monkeypatch.setenv("SCREENER_DB_PATH",
                       str(tmp_path / "no-such-dir" / "s.db"))
    from api.services.screener import snapshot_db, filters
    importlib.reload(snapshot_db)
    distribution.invalidate()

    out = distribution.distributions()
    assert out == {"basis": None, "columns": {}}

    meta = filters.meta()
    assert meta["distribution_basis"] is None
    assert meta["filters"], "meta() lost its filters over a missing snapshot"
    assert all("distribution" not in f for f in meta["filters"])
