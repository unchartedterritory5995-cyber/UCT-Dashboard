"""`ssetf_join` — the single-stock-ETF table read backwards, and the one rule
that makes its ZERO honest.

⛔⛔ This reader is the package's only deliberate exception to the honest-None
rule: it emits `ssetf_count = 0` for a name no single-stock ETF tracks, because
`etfs` is a CENSUS and its silence is a measurement. The exception is licensed
by freshness and nothing else, so the tests that matter most here are the ones
that watch the zero DISAPPEAR the moment the census can no longer support it:

* `test_an_uncovered_ticker_gets_a_measured_zero_from_a_current_census`
* `test_a_stale_census_stops_emitting_zeros_and_keeps_only_what_it_saw`
* `test_a_census_of_unknown_age_stops_emitting_zeros_too`

Every DB here is built in `tmp_path` and reached through `SSETF_DB_PATH`, the
override `single_stock_etfs._resolve_db_path` already honours — so these never
touch the shared `/data` root, and they exercise the same path-resolution seam
production uses instead of a second authority over where the store lives.
"""
import contextlib
import sqlite3
import time

import pytest

_NOW = int(time.time())
_DAY = 86400

# The columns this reader reads, in the shape the real store declares them
# (`single_stock_etfs._SCHEMA`). Written out here rather than imported so a
# schema change shows up as a test failure to read, not a silent adaptation.
_SCHEMA = """
CREATE TABLE etfs (
  etf_ticker TEXT PRIMARY KEY, underlying TEXT NOT NULL, direction TEXT NOT NULL,
  factor REAL NOT NULL, name TEXT NOT NULL, price REAL, avg_volume REAL,
  avg_dollar_vol REAL, vol_source TEXT, updated_at INTEGER NOT NULL
);
"""
# NOT NULL on `underlying`/`direction`/`factor`/`updated_at` is the real
# declaration; the malformed-row tests below need to violate it, so they build
# a permissive twin. That divergence is deliberate and stated: SQLite will
# happily hand a reader a NULL in a NOT NULL column after a schema change or a
# `PRAGMA writable_schema` repair, and "the declaration forbids it" is not a
# guarantee the reader gets to rely on.
_SCHEMA_PERMISSIVE = """
CREATE TABLE etfs (
  etf_ticker TEXT PRIMARY KEY, underlying TEXT, direction TEXT,
  factor REAL, name TEXT, price REAL, avg_volume REAL,
  avg_dollar_vol REAL, vol_source TEXT, updated_at INTEGER
);
"""


def _row(etf, und, direction="long", factor=2.0, adv=1_000_000.0, updated_at=_NOW):
    return (etf, und, direction, factor, f"{etf} name", 10.0, 1000.0, adv,
            "finviz", updated_at)


def _pad(n, updated_at=_NOW, start=0):
    """`n` filler families, so a fixture clears `_MIN_ROWS` without the test's
    own rows having to carry the floor."""
    return [_row(f"PAD{i:03d}", f"PADU{i:03d}", updated_at=updated_at)
            for i in range(start, start + n)]


def _store(tmp_path, monkeypatch, rows, schema=_SCHEMA, name="single_stock_etfs.db"):
    db = tmp_path / name
    with contextlib.closing(sqlite3.connect(str(db))) as c:
        c.execute("PRAGMA journal_mode=WAL")     # the real store runs WAL
        c.executescript(schema)
        c.executemany("INSERT INTO etfs VALUES (?,?,?,?,?,?,?,?,?,?)", rows)
        c.commit()
    monkeypatch.setenv("SSETF_DB_PATH", str(db))
    return db


@pytest.fixture()
def sj():
    from api.services.screener import ssetf_join
    return ssetf_join


# ── the happy path ───────────────────────────────────────────────────────

def test_a_family_reports_its_size_its_side_its_leverage_and_its_dollars(sj, tmp_path, monkeypatch):
    """TSLA's real shape, in miniature: several trackers, some inverse, the
    largest absolute leverage, and the summed dollar volume of the complex."""
    _store(tmp_path, monkeypatch, [
        _row("TSLL", "TSLA", "long", 2.0, adv=500_000_000.0),
        _row("TSLQ", "TSLA", "short", 1.0, adv=20_000_000.0),
        _row("TSLR", "TSLA", "long", 1.5, adv=5_000_000.0),
        _row("NVDL", "NVDA", "long", 2.0, adv=300_000_000.0),
    ] + _pad(60))

    out = sj.read_ssetf_fields(["TSLA", "NVDA"])

    assert out["TSLA"] == {"ssetf_count": 3, "ssetf_has_inverse": 1,
                           "ssetf_max_factor": 2.0,
                           "ssetf_adv_usd": 525_000_000.0}
    # Control: the sibling family differs on every axis, so a reader that
    # returned one constant shape for everybody could not pass both halves.
    assert out["NVDA"] == {"ssetf_count": 1, "ssetf_has_inverse": 0,
                           "ssetf_max_factor": 2.0,
                           "ssetf_adv_usd": 300_000_000.0}


def test_factor_is_a_magnitude_so_an_inverse_can_carry_the_maximum(sj, tmp_path, monkeypatch):
    """Store-verified: a -2x fund is `('short', 2.0)`, not `-2.0`. The side
    lives in `ssetf_has_inverse`; the factor is the absolute leverage from
    EITHER side. Reading only the long rows would answer 1.0 here."""
    _store(tmp_path, monkeypatch, [
        _row("XL", "X", "long", 1.0),
        _row("XS", "X", "short", 2.0),
    ] + _pad(60))

    row = sj.read_ssetf_fields(["X"])["X"]
    assert row["ssetf_max_factor"] == 2.0
    assert row["ssetf_has_inverse"] == 1


def test_targets_are_normalised_and_a_duplicate_cannot_double_anything(sj, tmp_path, monkeypatch):
    _store(tmp_path, monkeypatch, [_row("AAPB", "AAPL")] + _pad(60))

    out = sj.read_ssetf_fields(["aapl", "AAPL", " AAPL ", "", None])
    assert out["AAPL"]["ssetf_count"] == 1
    assert "" not in out and None not in out


# ── the zero, and the freshness that licenses it ─────────────────────────

def test_an_uncovered_ticker_gets_a_measured_zero_from_a_current_census(sj, tmp_path, monkeypatch):
    """⭐ The deliberate departure from honest-None. `NOETF` is in the build
    target list and absent from a FRESH census, which is the census answering
    "nothing tracks this name" — a fact ~94% of the universe shares and one a
    member must be able to filter on."""
    _store(tmp_path, monkeypatch, [_row("TSLL", "TSLA")] + _pad(60))

    out = sj.read_ssetf_fields(["TSLA", "NOETF"])

    assert out["NOETF"]["ssetf_count"] == 0
    assert out["NOETF"]["ssetf_has_inverse"] == 0
    # …a real 0, not a falsy None wearing a 0's clothes.
    assert out["NOETF"]["ssetf_count"] is not None
    # Control: the covered ticker in the SAME call is non-zero, so a reader
    # that zeroed everything could not pass this test.
    assert out["TSLA"]["ssetf_count"] == 1


def test_the_undefined_aggregates_are_omitted_even_on_the_zero_row(sj, tmp_path, monkeypatch):
    """The seam where the two rules meet. A COUNT of an empty set is 0; a
    MAXIMUM over an empty set is undefined, and a `0.0` factor would sort below
    every 1.0x fund and read as "tracked by an unleveraged ETF". Same for the
    dollar sum."""
    _store(tmp_path, monkeypatch, [_row("TSLL", "TSLA")] + _pad(60))

    row = sj.read_ssetf_fields(["NOETF"])["NOETF"]
    assert "ssetf_max_factor" not in row
    assert "ssetf_adv_usd" not in row


def test_a_stale_census_stops_emitting_zeros_and_keeps_only_what_it_saw(sj, tmp_path, monkeypatch):
    """🔴 THE CASE THAT MATTERS, and the one this dev box was live evidence for
    (newest `updated_at` 19 days old while the table looked populated).

    A positive count is an OBSERVATION and survives staleness, degraded and
    counted. A zero is an INFERENCE FROM SILENCE and does not survive it: the
    uncovered ticker must vanish from the output so its columns read NULL.
    """
    old = _NOW - (sj._STALE_DAYS + 3) * _DAY
    _store(tmp_path, monkeypatch,
           [_row("TSLL", "TSLA", updated_at=old)] + _pad(60, updated_at=old))

    failures = {}
    out = sj.read_ssetf_fields(["TSLA", "NOETF"], failures=failures)

    assert "NOETF" not in out                      # NULL, not a stale zero
    assert out["TSLA"]["ssetf_count"] == 1         # the observation survives
    assert any(k.startswith("stale:") for k in failures["ssetf_join"]), failures


def test_a_fresh_census_at_the_boundary_still_speaks(sj, tmp_path, monkeypatch):
    """Non-vacuity control for the test above: at exactly `_STALE_DAYS` the
    zeros are still emitted, so that test is measuring the threshold rather
    than a reader that never zeroes."""
    edge = _NOW - sj._STALE_DAYS * _DAY
    _store(tmp_path, monkeypatch,
           [_row("TSLL", "TSLA", updated_at=edge)] + _pad(60, updated_at=edge))

    failures = {}
    out = sj.read_ssetf_fields(["NOETF"], failures=failures)
    assert out["NOETF"]["ssetf_count"] == 0
    assert not any(k.startswith("stale:") for k in failures.get("ssetf_join", {}))


@pytest.mark.parametrize("age_days,expect_zero", [
    # A normal weekend gap: the rebuild cron is WEEKDAYS 20:30 ET and the
    # snapshot build runs 03:00 ET, so Friday's write seen by Monday's build is
    # ~2 days old and MUST still be allowed to speak.
    (2, True),
    # Two weeks is beyond any healthy cadence — at least half a dozen
    # consecutive nightlies have failed and the census is not evidence of
    # absence any more.
    (14, False),
])
def test_the_freshness_band_is_pinned_in_absolute_days(sj, tmp_path, monkeypatch,
                                                       age_days, expect_zero):
    """⛔ Pinned in ABSOLUTE days, deliberately not against `_STALE_DAYS`.

    Every other freshness test here ages its fixture BY the constant, so all of
    them move with it and a threshold widened to 400 days sails through —
    measured, that mutation survived the whole suite. The band is the thing
    the contract promises; the constant is one implementation of it.
    """
    ts = _NOW - age_days * _DAY
    _store(tmp_path, monkeypatch,
           [_row("TSLL", "TSLA", updated_at=ts)] + _pad(60, updated_at=ts))

    out = sj.read_ssetf_fields(["TSLA", "NOETF"])
    assert ("NOETF" in out) is expect_zero
    # Control: whichever side of the band we are on, an observed family is
    # always served — so this parametrisation cannot pass by the reader simply
    # going silent.
    assert out["TSLA"]["ssetf_count"] == 1


def test_a_census_of_unknown_age_stops_emitting_zeros_too(sj, tmp_path, monkeypatch):
    """No readable timestamp anywhere means the age is unknowable, and an
    inference from silence needs a known age. Positive-only, and counted."""
    _store(tmp_path, monkeypatch,
           [_row("TSLL", "TSLA", updated_at=None)] +
           [_row(f"PAD{i:03d}", f"PADU{i:03d}", updated_at=None) for i in range(60)],
           schema=_SCHEMA_PERMISSIVE)

    failures = {}
    out = sj.read_ssetf_fields(["TSLA", "NOETF"], failures=failures)

    assert "NOETF" not in out
    assert out["TSLA"]["ssetf_count"] == 1
    assert "age_unknown" in failures["ssetf_join"], failures


def test_freshness_comes_from_the_rows_not_from_a_meta_sidecar(sj, tmp_path, monkeypatch):
    """The store also keeps `meta.last_success_at`. A health read that trusts
    the sidecar reports green through a total failure — on this box the sidecar
    and the rows agreed, but only because the rows are what stopped being
    written. Rows old + sidecar fresh must read STALE."""
    old = _NOW - (sj._STALE_DAYS + 10) * _DAY
    db = _store(tmp_path, monkeypatch,
                [_row("TSLL", "TSLA", updated_at=old)] + _pad(60, updated_at=old))
    with contextlib.closing(sqlite3.connect(str(db))) as c:
        c.execute("CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT)")
        c.execute("INSERT INTO meta VALUES ('last_success_at', ?)", (str(_NOW),))
        c.commit()

    failures = {}
    out = sj.read_ssetf_fields(["NOETF"], failures=failures)
    assert "NOETF" not in out
    assert any(k.startswith("stale:") for k in failures["ssetf_join"]), failures


# ── malformed rows: degrade, and COUNT ───────────────────────────────────

def test_a_row_with_no_underlying_belongs_to_nobody_and_is_counted(sj, tmp_path, monkeypatch):
    _store(tmp_path, monkeypatch, [
        _row("TSLL", "TSLA"),
        _row("ORPH", None),
        _row("BLNK", "   "),
    ] + _pad(60), schema=_SCHEMA_PERMISSIVE)

    failures = {}
    out = sj.read_ssetf_fields(["TSLA"], failures=failures)

    assert out["TSLA"]["ssetf_count"] == 1        # the orphans joined no family
    assert failures["ssetf_join"]["malformed_underlying:2"] == 1, failures


def test_an_unreadable_factor_never_becomes_a_number(sj, tmp_path, monkeypatch):
    """A junk factor is counted and skipped; the family's max comes from the
    rows that could be read. When NO row can be read, the key is absent — the
    fund count is still a fact, the leverage is not."""
    _store(tmp_path, monkeypatch, [
        _row("AL", "A", factor=None),
        _row("AS", "A", factor=2.0),
        _row("BL", "B", factor="junk"),
        _row("BS", "B", factor=-3.0),
    ] + _pad(60), schema=_SCHEMA_PERMISSIVE)

    failures = {}
    out = sj.read_ssetf_fields(["A", "B"], failures=failures)

    assert out["A"]["ssetf_max_factor"] == 2.0
    assert out["B"]["ssetf_count"] == 2
    assert "ssetf_max_factor" not in out["B"]
    assert failures["ssetf_join"]["malformed_factor:3"] == 1, failures


def test_an_unreadable_direction_counts_but_never_votes_for_an_inverse(sj, tmp_path, monkeypatch):
    _store(tmp_path, monkeypatch, [
        _row("AL", "A", direction=None),
        _row("AX", "A", direction="sideways"),
    ] + _pad(60), schema=_SCHEMA_PERMISSIVE)

    failures = {}
    out = sj.read_ssetf_fields(["A"], failures=failures)

    assert out["A"]["ssetf_count"] == 2
    assert out["A"]["ssetf_has_inverse"] == 0
    assert failures["ssetf_join"]["malformed_direction:2"] == 1, failures


def test_one_unusable_dollar_volume_drops_the_whole_family_sum(sj, tmp_path, monkeypatch):
    """A partial sum understates crowding SILENTLY, and understating is the
    direction that hides risk. The count and the leverage still ship."""
    _store(tmp_path, monkeypatch, [
        _row("AL", "A", adv=100.0),
        _row("AS", "A", adv=None),
        _row("BL", "B", adv=250.0),
    ] + _pad(60), schema=_SCHEMA_PERMISSIVE)

    failures = {}
    out = sj.read_ssetf_fields(["A", "B"], failures=failures)

    assert "ssetf_adv_usd" not in out["A"]
    assert out["A"]["ssetf_count"] == 2
    # Control: the clean sibling family in the same read keeps its sum, so the
    # drop is family-scoped and not a column that quietly stopped working.
    assert out["B"]["ssetf_adv_usd"] == 250.0
    assert failures["ssetf_join"]["adv_partial:1"] == 1, failures


# ── dead / short / unreadable sources ────────────────────────────────────

def test_a_missing_store_returns_nothing_and_is_counted(sj, tmp_path, monkeypatch):
    """`mode=ro` refuses to conjure an empty database — which is exactly the
    behaviour this reader needs, because an empty table would otherwise read as
    "nothing is tracked" and become a universe of confident zeros."""
    monkeypatch.setenv("SSETF_DB_PATH", str(tmp_path / "does_not_exist.db"))

    failures = {}
    assert sj.read_ssetf_fields(["TSLA"], failures=failures) == {}
    assert failures["ssetf_join"], failures


def test_a_store_with_no_etfs_table_returns_nothing_and_is_counted(sj, tmp_path, monkeypatch):
    db = tmp_path / "single_stock_etfs.db"
    with contextlib.closing(sqlite3.connect(str(db))) as c:
        c.execute("CREATE TABLE something_else (x INTEGER)")
        c.commit()
    monkeypatch.setenv("SSETF_DB_PATH", str(db))

    failures = {}
    assert sj.read_ssetf_fields(["TSLA"], failures=failures) == {}
    assert failures["ssetf_join"], failures


def test_an_empty_table_returns_nothing_rather_than_a_universe_of_zeros(sj, tmp_path, monkeypatch):
    _store(tmp_path, monkeypatch, [])

    failures = {}
    assert sj.read_ssetf_fields(["TSLA", "NOETF"], failures=failures) == {}
    assert failures["ssetf_join"]["empty"] == 1, failures


def test_a_truncated_census_may_not_speak_for_the_names_it_lost(sj, tmp_path, monkeypatch):
    """Below `_MIN_ROWS` the write itself is suspect (a broken rebuild), so
    even the rows present are refused — unlike staleness, where the write was
    good and merely old."""
    _store(tmp_path, monkeypatch, _pad(sj._MIN_ROWS - 1))

    failures = {}
    assert sj.read_ssetf_fields(["PADU000", "NOETF"], failures=failures) == {}
    assert failures["ssetf_join"][f"below_floor:{sj._MIN_ROWS - 1}"] == 1, failures


def test_the_floor_is_a_threshold_not_a_blanket_refusal(sj, tmp_path, monkeypatch):
    """Non-vacuity control for the test above."""
    _store(tmp_path, monkeypatch, _pad(sj._MIN_ROWS))
    assert sj.read_ssetf_fields(["PADU000"])["PADU000"]["ssetf_count"] == 1


def test_a_broken_path_resolver_degrades_and_never_raises_into_the_build(sj, tmp_path, monkeypatch):
    """The reader reaches the store through `single_stock_etfs`' private path
    seam. If that seam is renamed the read must degrade to `{}` and be COUNTED,
    never take the nightly down."""
    def _boom():
        raise AttributeError("module has no attribute '_db_path'")
    monkeypatch.setattr(sj, "_db_path", _boom)

    failures = {}
    assert sj.read_ssetf_fields(["TSLA"], failures=failures) == {}
    assert failures["ssetf_join"]["AttributeError"] == 1, failures


def test_failures_is_optional_and_a_dead_source_still_returns_cleanly(sj, tmp_path, monkeypatch):
    monkeypatch.setenv("SSETF_DB_PATH", str(tmp_path / "nope.db"))
    assert sj.read_ssetf_fields(["TSLA"]) == {}


# ── the shape of the read itself ─────────────────────────────────────────

def test_the_whole_universe_costs_exactly_one_query(sj, tmp_path, monkeypatch):
    """ONE bulk read per build. A per-ticker query here is an N+1 across ~3,700
    symbols against a table of a few hundred rows."""
    _store(tmp_path, monkeypatch, [_row("TSLL", "TSLA")] + _pad(60))

    calls = []
    real = sj._connect_ro

    class _Counting:
        def __init__(self, conn):
            self._conn = conn

        def execute(self, sql, *a):
            calls.append(sql)
            return self._conn.execute(sql, *a)

        def close(self):
            self._conn.close()

    monkeypatch.setattr(sj, "_connect_ro", lambda p: _Counting(real(p)))

    targets = ["TSLA"] + [f"SYM{i:04d}" for i in range(3700)]
    out = sj.read_ssetf_fields(targets)

    assert len(calls) == 1, calls
    # Control: the one query really did answer for the whole list.
    assert len(out) == len(targets)
    assert out["TSLA"]["ssetf_count"] == 1
    assert out["SYM0000"]["ssetf_count"] == 0


def test_the_connection_is_genuinely_read_only(sj, tmp_path, monkeypatch):
    """`mode=ro` is a property of the connection, not a comment. This reader
    runs inside the nightly build against a store another job owns."""
    db = _store(tmp_path, monkeypatch, [_row("TSLL", "TSLA")] + _pad(60))

    with contextlib.closing(sj._connect_ro(str(db))) as conn:
        assert conn.execute("SELECT COUNT(*) FROM etfs").fetchone()[0] == 61
        with pytest.raises(sqlite3.OperationalError) as exc:
            conn.execute("DELETE FROM etfs")
    assert "readonly" in str(exc.value).lower(), str(exc.value)


def test_the_read_works_while_a_wal_writer_holds_the_store(sj, tmp_path, monkeypatch):
    """The real store runs in WAL and its rebuild writes at 20:30 ET. A
    read-only open against a live `-wal`/`-shm` pair must still work, or this
    reader is a nightly that fails on exactly the nights the store was busy."""
    db = _store(tmp_path, monkeypatch, [_row("TSLL", "TSLA")] + _pad(60))

    writer = sqlite3.connect(str(db))
    try:
        writer.execute("PRAGMA journal_mode=WAL")
        writer.execute("INSERT INTO etfs VALUES (?,?,?,?,?,?,?,?,?,?)",
                       _row("TSLQ", "TSLA", "short"))
        writer.commit()                     # committed, -wal still on disk
        out = sj.read_ssetf_fields(["TSLA"])
    finally:
        writer.close()

    assert out["TSLA"]["ssetf_count"] == 2
    assert out["TSLA"]["ssetf_has_inverse"] == 1


# ── disjointness from the reader that already opens this store ───────────

def test_its_columns_never_collide_with_the_other_reader_of_this_store(sj, tmp_path, monkeypatch):
    """`context_joins.read_etf_flags` reads the SAME table for a different
    question. Both key sets are obtained by RUNNING the two readers over one
    store — never retyped — because a retyped set is the second authority this
    check exists to forbid."""
    from api.services.screener import context_joins

    _store(tmp_path, monkeypatch, [_row("TSLL", "TSLA")] + _pad(60))

    mine = set().union(*(r.keys() for r in
                         sj.read_ssetf_fields(["TSLA", "NOETF"]).values()))
    theirs = set().union(*(r.keys() for r in
                           context_joins.read_etf_flags(["TSLA", "TSLL"]).values()))

    assert mine, "the derivation is broken — this reader emitted no columns"
    assert theirs, "the derivation is broken — read_etf_flags emitted no columns"
    assert mine & theirs == set(), mine & theirs


def test_the_emitted_column_set_is_pinned(sj, tmp_path, monkeypatch):
    """A pin, mirroring the manifest-count idiom: a column added or renamed
    here changes the integration contract a later wave wires from, so it must
    be a deliberate edit in the same commit."""
    _store(tmp_path, monkeypatch, [_row("TSLL", "TSLA")] + _pad(60))

    emitted = set().union(*(r.keys() for r in
                            sj.read_ssetf_fields(["TSLA", "NOETF"]).values()))
    assert emitted == {"ssetf_count", "ssetf_has_inverse", "ssetf_max_factor",
                       "ssetf_adv_usd"}, emitted
