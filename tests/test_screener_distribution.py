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
import re

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
    universe clustered just above $1 and half just above $1000: an interpolating
    median prints ~$500, a price no symbol in the set trades at, under a label
    that says "typical". Nearest-rank can only ever return a value that is in
    the column.

    ⚠️ The fixture is bimodal with TEN levels rather than two on purpose — two
    would now be refused as `too_few_levels`, correctly (a two-valued column is
    a category), and this test would then pass for the wrong reason without
    exercising the arithmetic it exists for.
    """
    low = [1.0, 1.1, 1.2, 1.3, 1.4]
    high = [1000.0, 1000.1, 1000.2, 1000.3, 1000.4]
    values = [low[i % 5] for i in range(200)] + [high[i % 5] for i in range(200)]
    _db(tmp_path, monkeypatch, _rows(400, price=values))
    held = set(values)

    band = distribution.distributions()["columns"]["price"]
    assert band["p50"] in low, (
        f"p50 = {band['p50']} — the 200th of 400 sorted values is in the low "
        f"cluster; anything between the clusters is interpolation")
    assert band["p75"] in high
    assert not (low[-1] < band["p50"] < high[0]), (
        "the median landed in the gap between the two clusters, which no symbol "
        "occupies — that is an interpolated percentile wearing the word 'typical'")
    for pct in distribution.PERCENTILES:
        assert band[f"p{pct}"] in held, (
            f"p{pct} = {band[f'p{pct}']} is not a value any row holds")


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
    assert band["usable"] == 0, "a letter grade is not a value a band may use"
    assert band["non_null"] == 400, (
        "the column HOLDS 400 values — reporting 0 under a key named `non_null` "
        "would put a wrong coverage number in the one payload whose whole "
        "purpose is that the coverage never lies")
    assert not [k for k in band if k.startswith("p")]


def test_the_two_counts_are_two_facts_and_neither_stands_in_for_the_other(
        tmp_path, monkeypatch):
    """⭐ `non_null` = rows that carry a value. `usable` = rows carrying a value
    a percentile may be taken over. Equal on all 130 columns of this box's
    snapshot today — and `accdis` has already been the column where they
    diverge, so the day one is reported under the other's name is a day the
    coverage line lies about how much of the universe answered.

    The floors divide `usable`, because that is the population the percentiles
    would describe: 300 numbers among 400 answers is a 300-row distribution.
    """
    numbers = [float(i) for i in range(300)]
    _db(tmp_path, monkeypatch,
        _rows(400, pe_ttm=numbers + ["A"] * 100))

    band = distribution.distributions()["columns"]["pe_ttm"]
    assert band["non_null"] == 400
    assert band["usable"] == 300
    # 300/400 = 75% clears MIN_COVERAGE, so a band is emitted — and it describes
    # the 300, which is what `usable` says and `non_null` would not.
    assert "refused" not in band
    assert band["p50"] in numbers


def test_a_zero_one_flag_gets_no_band(tmp_path, monkeypatch):
    """⛔ DERIVED FROM THE VALUES, never from a typed list of flag columns —
    a list would be a second authority over which columns are flags and would
    go stale on the next one. p50 of a Yes/No is not a typical range."""
    _db(tmp_path, monkeypatch,
        _rows(400, consecutive_up=[i % 2 for i in range(400)]))

    band = distribution.distributions()["columns"]["consecutive_up"]
    assert band["refused"] == distribution.REFUSED_BINARY
    assert band["non_null"] == 400


# ───── the two the binary gate missed by one value, measured on the real
#       snapshot before they were written ────────────────────────────────────
#
# 🔴 BOTH OF THESE SHIPPED A "TYPICAL RANGE" ON THIS BOX. `distinct <= {0, 1}`
# was the only "nothing worth printing" gate, and it is one value short of an
# encoded category and blind to a saturated constant. They are in the pattern
# family — one of the few the benchmark ranks us FIRST in — so the two most
# visible bands in that view were the two wrong ones.

def test_an_ENCODED_CATEGORY_is_refused_even_though_it_is_stored_as_numbers(
        tmp_path, monkeypatch):
    """🔴 MEASURED, NOT IMAGINED: `pattern_engine_dir` on this box's 3,714-row
    snapshot holds exactly {-1, 0, +1} on 2,889 rows and emitted
    `p5=-1 p25=-1 p50=0 p75=1 p95=1`. `filters.py`'s own comment beside the
    control calls it "Reader-encoded direction (ruling D4)" — a LABEL set. A
    percentile over labels is a number over a category, which
    `test_only_RANGE_controls_carry_a_band` says in as many words must never
    happen; it passed only because the registry types the control `range`.

    ⭐ The floor is DERIVED (`MIN_DISTINCT = len(PERCENTILES)`), not typed: a
    column that cannot fill the five slots it prints is advertising a precision
    it does not have.
    """
    direction = [(-1, 0, 1)[i % 3] for i in range(400)]
    _db(tmp_path, monkeypatch, _rows(400, pattern_engine_dir=direction))

    band = distribution.distributions()["columns"]["pattern_engine_dir"]
    assert band["refused"] == distribution.REFUSED_FEW_LEVELS
    assert band["non_null"] == 400 and band["usable"] == 400, (
        "this fixture must clear both coverage floors or it proves nothing "
        "about the level floor")
    assert not [k for k in band if k.startswith("p")]


def test_a_genuine_small_integer_COUNT_keeps_its_band(tmp_path, monkeypatch):
    """⭐ THE CONTROL ON THE TEST ABOVE. `consecutive_down` holds 9 distinct
    values on the real snapshot and `inside_bar_run` 10 — small integers, but a
    COUNT with an ordering a member screens on, where "95% of names run 4 down
    days or fewer" is a real fact. A level floor that swallowed those would have
    bought the category fix by deleting six honest bands.
    """
    runs = [i % 9 for i in range(400)]
    _db(tmp_path, monkeypatch, _rows(400, consecutive_down=runs))

    band = distribution.distributions()["columns"]["consecutive_down"]
    assert "refused" not in band, band
    assert (band["p5"], band["p95"]) == (0, 8)


def test_a_SATURATED_column_is_refused_and_says_what_it_is_saturated_AT(
        tmp_path, monkeypatch):
    """🔴 ALSO MEASURED: `pattern_engine_conf` holds five distinct values on
    2,889 rows with ≥95% of them at 100.0, so all five points printed 100.0 and
    a member read a zero-width "typical range" — the word doing exactly the
    opposite of its job.

    ⭐ AND THE REFUSAL CARRIES THE FACT. A 0-100 confidence score pinned at 100
    is a data defect nobody had surfaced; the first pass of this feature over
    the real snapshot found it. `saturated_at` is how the surface can say so.
    It is deliberately not `p*`-named — the refused-XOR-percentiles invariant is
    what stops a refusal being read as an answer.
    """
    conf = [90.0, 96.8, 98.4, 99.2] + [100.0] * 396
    _db(tmp_path, monkeypatch, _rows(400, pattern_engine_conf=conf))

    band = distribution.distributions()["columns"]["pattern_engine_conf"]
    assert band["refused"] == distribution.REFUSED_NO_SPREAD
    assert band["saturated_at"] == 100.0
    assert len(set(conf)) >= distribution.MIN_DISTINCT, (
        "this fixture no longer isolates the zero-width gate — it now trips the "
        "level floor first and the test would pass for the wrong reason")
    assert not [k for k in band if k.startswith("p")]


def test_a_column_this_pod_has_not_been_MIGRATED_to_hold_says_so(
        tmp_path, monkeypatch):
    """⛔ SILENCE IS THE ONE THING THIS MODULE PROMISES NOT TO DO. Nine registry
    columns are absent from this box's `screener_rows` (five of them range
    controls), and they used to drop out of the payload entirely — making "not
    yet migrated" indistinguishable from "no band applies", which is the exact
    ambiguity `no_data` exists one layer down to remove. `init_db()` ALTERs them
    in at startup so production should never be in this state; a pod that IS
    now says so.
    """
    db = _db(tmp_path, monkeypatch, _rows(400, price=[float(i) for i in range(400)]))
    conn = db.connect()
    try:
        conn.execute("ALTER TABLE screener_rows DROP COLUMN rsi14")
        conn.commit()
    finally:
        conn.close()
    distribution.invalidate()

    cols = distribution.distributions()["columns"]
    assert cols["rsi14"]["refused"] == distribution.REFUSED_COLUMN_ABSENT
    assert cols["rsi14"]["universe"] == 400
    assert "price" in cols and "refused" not in cols["price"], (
        "the whole sweep collapsed — this test proves nothing about one column")

    # ...and a TEXT column that IS present is a different fact: excluded by the
    # declared-type gate, permanently and on purpose. It must NOT read as absent.
    assert "ipo_date" not in cols


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
        assert isinstance(band["usable"], int), name
        assert isinstance(band["universe"], int), name
        assert band["universe"] == 400, name
        assert 0 <= band["usable"] <= band["non_null"] <= band["universe"], name
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


#: A census sentence, in the shapes the two stale copies actually took. Numbers
#: elsewhere in these files are NOT the target — a percentile name, a floor, a
#: row count in a cost note are all fine. What must never come back is a
#: hand-typed tally of the module's own output sitting beside the code that
#: produces it.
_CENSUS = re.compile(
    r"\b\d[\d,]*\s+(?:"
    r"of\s+(?:those|\d[\d,]*)"           # "42 of 102" · "40 of those"
    r"|(?:are\s+)?refused"                # "55 are refused"
    r"|carrying"                          # "107 carrying an entry"
    r"|emitting"                          # "40 emitting numbers"
    r"|(?:numeric\s+)?range\s+columns?"     # "102 numeric range columns"
    r"|range\s+controls?"                   # "109 range controls"
    r")", re.I)


def _min_coverage_comment():
    """The `#:` block documenting `MIN_COVERAGE`, walked back from the
    ASSIGNMENT — never a line number, which is what drifted last time."""
    import inspect
    src = inspect.getsource(distribution).splitlines()
    i = next(n for n, line in enumerate(src) if line.startswith("MIN_COVERAGE"))
    block = []
    n = i - 1
    while n >= 0 and src[n].startswith("#:"):
        block.append(src[n])
        n -= 1
    assert block, "MIN_COVERAGE lost its comment block — the probe reads nothing"
    return "\n".join(reversed(block))


def test_the_coverage_census_is_MEASURED_not_typed(tmp_path, monkeypatch):
    """🔴 THE SIGNATURE DEFECT, IN A MODULE ABOUT MEASURED HONESTY.

    "42 of 102 numeric range columns clear it, 55 are refused" sat beside
    `MIN_COVERAGE`, and a SECOND count of the same quantity sat in
    `filters.meta`'s docstring. Both hand-typed; one went stale inside the very
    commit that moved the other. Correcting 55 to 62 would have re-armed it.

    So the number lives in NO prose, and this rail is in two halves:

    1. the recipe the comment now gives is EXECUTABLE and total — run it, and
       every entry in the payload lands in exactly one bucket;
    2. neither prose block carries a census literal any more, checked with a
       two-sided control so a green result cannot mean the probe matches
       nothing (or everything).
    """
    from collections import Counter

    from api.services.screener import filters

    _db(tmp_path, monkeypatch,
        _rows(400,
              # emits: 400 distinct values at full coverage
              price=[float(i + 1) for i in range(400)],
              # below_coverage_floor: 120 of 400 answer
              dp_notional_1d=[float(i) if i < 120 else None for i in range(400)],
              # binary: a yes/no flag
              consecutive_up=[i % 2 for i in range(400)],
              # below_min_non_null: too few values to BE a distribution
              peg=[1.5 + i if i < 40 else None for i in range(400)]))

    # ── 1 · the documented recipe, run verbatim ──
    cols = distribution.distributions()["columns"]
    census = Counter(b.get("refused", "emitted") for b in cols.values())

    assert sum(census.values()) == len(cols), (
        "the recipe is not total over the payload — an entry carried neither "
        "percentiles nor a refusal, and any census taken with it under-counts")
    assert census["emitted"] >= 1 and "price" in cols and "refused" not in cols["price"]
    for reason in (distribution.REFUSED_COVERAGE, distribution.REFUSED_BINARY,
                   distribution.REFUSED_MIN_NON_NULL, distribution.REFUSED_NO_DATA):
        assert census[reason] >= 1, (
            f"{reason} never occurred, so this fixture cannot show the census "
            f"distinguishing kinds: {dict(census)}")

    # ── 2 · and no prose restates it ──
    prose = {"distribution.MIN_COVERAGE comment": _min_coverage_comment(),
             "filters.meta docstring": filters.meta.__doc__ or ""}
    for where, text in prose.items():
        hit = _CENSUS.search(text)
        assert hit is None, (
            f"{where} carries a hand-typed census ({hit.group(0)!r}). It is a "
            f"measurement of tonight's snapshot and it goes stale the next time "
            f"a column lands — run the recipe beside MIN_COVERAGE instead")

    # CONTROL, both directions. Without the first pair a deleted regex passes
    # this test for every input; without the second it would fail the honest
    # prose the module is required to keep.
    for stale in ("42 of 102 numeric range columns clear it, 55 are refused",
                  "109 range controls, 107 carrying an entry, 40 of those emitting"):
        assert _CENSUS.search(stale), f"the probe cannot see {stale!r} — vacuous"
    for honest in ("the 5th, 25th, 50th, 75th and 95th percentile of the symbols",
                   "p5/p25/p50/p75/p95 for its column, WITH the coverage that "
                   "produced them, refused outright below a stated floor",
                   "Measured on a 3,714-row snapshot: the one-pass compute costs ~55 ms"):
        assert not _CENSUS.search(honest), (
            f"the probe flags honest prose {honest!r} — it would force the "
            f"module to delete the measurements it is right to publish")


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


def test_a_cold_herd_computes_ONCE_while_the_rest_wait(tmp_path, monkeypatch):
    """⭐ THE POST-DEPLOY SHAPE, and the repo already has the idiom for it.

    The cache is per-PROCESS, so every web deploy empties it. Without a valve,
    every concurrent first-loader ran the whole 483k-cell scan (measured 116 ms,
    GIL-bound, on the ONE shared anyio threadpool) instead of one running it
    while the others took the result — `live_prices`'s Semaphore-plus-re-check
    exists for exactly this and costs a few lines.

    The barrier sits in `_fingerprint`, which runs OUTSIDE the lock: it proves
    the threads genuinely arrived together (a sequential run would deadlock on
    the barrier and time out), so a green result here cannot mean "the harness
    never made them race".
    """
    import threading

    _db(tmp_path, monkeypatch, _rows(400, price=[float(i + 1) for i in range(400)]))

    n = 6
    at_the_gate = threading.Barrier(n, timeout=10)
    computes = []
    real_compute = distribution.compute
    real_fingerprint = distribution._fingerprint

    def counted(conn):
        computes.append(1)
        return real_compute(conn)

    def synced(conn, path):
        key = real_fingerprint(conn, path)
        at_the_gate.wait()          # raises BrokenBarrierError on timeout
        return key

    monkeypatch.setattr(distribution, "compute", counted)
    monkeypatch.setattr(distribution, "_fingerprint", synced)

    results, errors = [], []

    def go():
        try:
            results.append(distribution.distributions())
        except BaseException as exc:      # noqa: BLE001 — the harness's own faults
            errors.append(exc)

    threads = [threading.Thread(target=go) for _ in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)

    assert not errors, f"the harness itself failed: {errors}"
    assert len(results) == n, "not every thread returned — the valve deadlocked"
    assert len(computes) == 1, (
        f"{len(computes)} of {n} concurrent first-loaders each ran the full "
        f"scan; the post-acquire re-check is what makes it one")
    assert all(r == results[0] for r in results), (
        "the waiters got something other than the winner's answer")
    assert results[0]["columns"]["price"]["p50"] == 200.0


def test_every_refusal_reason_is_answered_in_words_by_the_filter_rail():
    """⛔ A REASON THE UI DROPS IS A BLANK BOX, WHICH IS THE WHOLE FINDING.

    This module's contract is that "we hold nothing here" is a fact a member is
    entitled to. That promise is only kept if the surface can say it — and the
    lane before this one shipped a correct, well-railed payload that NO surface
    read at all. So the reasons are derived off this module (never retyped) and
    checked against the renderer that has to answer them.

    ⭐ Derived, with a control: `_probe_reason_absent` proves the probe can see
    a reason the renderer does NOT carry, so a green result cannot mean the
    search matched everything.
    """
    import pathlib
    import re

    root = pathlib.Path(__file__).resolve().parents[1]
    renderer = root / "app/src/pages/screener/shell/FilterBand.jsx"
    assert renderer.exists(), f"the renderer moved: {renderer}"
    src = renderer.read_text(encoding="utf-8")

    reasons = {name: getattr(distribution, name) for name in dir(distribution)
               if name.startswith("REFUSED_")}
    assert len(reasons) >= 8, f"the probe found only {reasons} — derive is broken"

    def answered(value):
        # The map is keyed on the bare constant, e.g. `no_data: () => …`.
        return re.search(rf"^\s*{re.escape(value)}:", src, re.M) is not None

    missing = sorted(v for v in reasons.values() if not answered(v))
    assert not missing, (
        f"{missing} refuse a band with no sentence in FilterBand.jsx — a member "
        f"reading that control sees the blank box this whole lane exists to fix")

    assert not answered("_probe_reason_absent"), (
        "the probe matches a reason the renderer does not carry — it would pass "
        "for any input and proves nothing")


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
