"""The base library's columns survive a legacy table, a write and a read.

⛔ WHY THIS EXISTS. `bases.classify` was verified to return a populated
structure for 3,705 of 3,705 symbols, `snapshot_builder` was verified to call
it, `COLUMNS` was verified to declare the five columns, and `upsert_rows` was
verified to derive its column list from `COLUMNS`. Every link read correctly.
None of that is the same as the value arriving in a row a member reads, and
this repo's own history is full of features that were built, tested, green and
reaching nobody. The chain is exercised end to end here instead.

⚠️ AND THE FIRST HALF IS THE ONE THAT WOULD ACTUALLY BREAK IN PRODUCTION.
`CREATE TABLE IF NOT EXISTS` never widens an existing table, and production's
`screener.db` predates this library by months -- so the columns only appear if
`init_db()` ALTER-adds them at boot. A local database that was never migrated
showed exactly this: schema present in `COLUMNS`, absent from the table.
"""
import pytest


BASE_COLUMNS = ("base_shape", "base_shape_label", "base_matches",
                "base_relation_count", "base_render")


def _fresh(monkeypatch, tmp_path):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))


def test_a_legacy_table_is_WIDENED_with_the_base_columns_at_init(
        monkeypatch, tmp_path):
    """The production case: the table exists and predates the library."""
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import snapshot_db

    real = snapshot_db.COLUMNS
    legacy = [c for c in real if c not in BASE_COLUMNS]
    assert len(legacy) == len(real) - len(BASE_COLUMNS), (
        "fixture: every base column must be in COLUMNS, or this test is not "
        "exercising the migration it claims to")

    monkeypatch.setattr(snapshot_db, "COLUMNS", legacy)
    snapshot_db.init_db()
    with snapshot_db.connect() as c:
        before = {r[1] for r in c.execute("PRAGMA table_info(screener_rows)")}
    assert not (set(BASE_COLUMNS) & before), (
        "the base columns must not exist yet, or the widening is untested")

    monkeypatch.setattr(snapshot_db, "COLUMNS", real)
    snapshot_db.init_db()
    with snapshot_db.connect() as c:
        after = {r[1] for r in c.execute("PRAGMA table_info(screener_rows)")}
    missing = [c for c in BASE_COLUMNS if c not in after]
    assert not missing, (
        "init_db did not widen a legacy table with %s -- on production the "
        "screener would show an empty column with no error" % missing)


def test_a_classified_row_round_trips_through_the_snapshot(monkeypatch, tmp_path):
    """Write what `bases.classify` actually returns, read it back unchanged."""
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import snapshot_db

    snapshot_db.init_db()
    snapshot_db.upsert_rows([{
        "ticker": "T",
        "base_shape": "advancing-structure",
        "base_shape_label": "Advancing Structure",
        "base_matches": ",darvas-box,flat-base,",
        "base_relation_count": 2,
        "base_render": "Darvas Box (Flat Base) +1",
    }])
    row = snapshot_db.get_row("T")
    assert row["base_shape"] == "advancing-structure"
    assert row["base_shape_label"] == "Advancing Structure"
    assert row["base_matches"] == ",darvas-box,flat-base,"
    assert row["base_relation_count"] == 2
    assert row["base_render"] == "Darvas Box (Flat Base) +1"


def test_the_membership_list_survives_as_a_DELIMITER_WRAPPED_string(
        monkeypatch, tmp_path):
    """⛔ `base_matches` is wrapped in commas so the filter's `contains`
    compiles to `LIKE %,key,%`. Bare CSV over-matches: a search for
    `,vcp,` must not be satisfied by a row holding `advanced-vcp`.
    """
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import snapshot_db

    snapshot_db.init_db()
    snapshot_db.upsert_rows([
        {"ticker": "A", "base_matches": ",vcp,"},
        {"ticker": "B", "base_matches": ",advanced-vcp,"},
    ])
    with snapshot_db.connect() as c:
        hits = [r[0] for r in c.execute(
            "select ticker from screener_rows where base_matches like ?",
            ("%,vcp,%",))]
    assert hits == ["A"], (
        "the wrapping did not survive the round trip: %r" % hits)


def test_every_base_column_the_classifier_emits_is_declared(monkeypatch, tmp_path):
    """Derived, not typed: whatever `bases.classify` returns on a refusal is
    the full key set, and every one of those keys must be a real column.
    """
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import bases, snapshot_db

    emitted = set(bases.classify([]).keys())
    assert emitted, "classify returned nothing to check"
    undeclared = sorted(emitted - set(snapshot_db.COLUMNS))
    assert not undeclared, (
        "classify emits %s, which no snapshot column can hold -- the value "
        "would be computed and dropped" % undeclared)
