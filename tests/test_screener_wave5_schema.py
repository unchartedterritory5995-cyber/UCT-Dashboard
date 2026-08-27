"""Wave 5 schema: the 13 new columns exist, type-set membership holds, and the
widen path still works (a pre-Wave-5 table gains exactly those 13 on init).

⛔⛔ X20(a) -- THIS FILE USED TO PIN `len(snapshot_db.COLUMNS) == 185` AS A
LITERAL IN TWO PLACES, ARGUING (right here) THAT A HAND-TYPED WIDTH WAS A
"tripwire" WORTH THE STALENESS. It was not: the width had already drifted
FOUR TIMES (158 -> 160 -> 185 -> 200 -> ...) because every legitimate wave
adds columns, and it keeps not stopping there -- the literal never once caught
a mistake, it only ever caught the next correct wave, and got bumped without a
second look. ⚠️ NOTE THE TRAILING "-> ...": a drift history is not exempt from
the rule it is illustrating. Ending it on "200" would make 200 read as the
current, stable fact -- the exact second-authority shape this fix removes from
the assert, reappearing one level up, in the prose. Its cost was not merely
cosmetic: in `test_init_db_creates_every_declared_column` it sat directly
AFTER `assert set(snapshot_db.COLUMNS) <= have` -- a genuine, non-vacuous rail
proving `init_db()` creates every declared column -- and dragged that REAL
rail red for this entire branch, waved through by every lane that hit it as a
"known red" (the same shape as X7: nobody triages a red they believe they
already understand).

⭐ DO NOT ADD A LITERAL WIDTH BACK. If the fix for a red here looks like
`assert len(snapshot_db.COLUMNS) == <today's count>`, that is drift #5, not a
repair. The invariants that survive every future wave without an edit are
about the MANIFEST'S SHAPE, never its size:
  * no column is declared TWICE (`test_wave5_columns_are_declared`) --
    checked against a FLOOR, never an exact count, so it never needs raising
    (mirrors `test_cross_module_imports_resolve.py`'s `seen_imports >= 500`:
    a non-vacuity control, not a tripwire);
  * a wave's own declared family is still PRESENT in `COLUMNS`
    (`missing = [c for c in WAVE5 if c not in snapshot_db.COLUMNS]` below, and
    the `<=` in `test_init_db_creates_every_declared_column`) -- unchanged by
    this fix, and it is the rot control: it fails the day WAVE5 silently
    disappears from `COLUMNS`, the same way `test_cross_module_imports_
    resolve.py`'s `KNOWN_DEAD` entries fail the day one quietly resolves.

Every OTHER number in this file was already derived rather than typed -- see
`test_init_db_widens_a_pre_wave5_shaped_table`, whose pre-Wave-5 width is
`len(real_columns) - len(WAVE5)`, never a second literal."""
import sqlite3


def _fresh(monkeypatch, tmp_path):
    db = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(db))
    return db


WAVE5 = ("pattern_engine_ids", "pattern_engine_conf", "pattern_engine_dir",
         "pattern_entry_dist_pct", "pattern_stop_dist_pct",
         "pattern_expectancy_r", "dp_notional_1d", "dp_prints_1d",
         "dp_notional_5d", "dp_level_dist_pct", "opt_net_premium_1d",
         "opt_bull_pct_1d", "opt_net_premium_5d")


def test_wave5_columns_are_declared(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import snapshot_db
    # ⭐ THE ROT CONTROL: fails the day WAVE5 silently disappears from
    # COLUMNS (a rename, a merge conflict, a copy-paste that dropped a line).
    missing = [c for c in WAVE5 if c not in snapshot_db.COLUMNS]
    assert not missing, missing
    assert len(WAVE5) == 13  # WAVE5's OWN count, pinned beside the literal
                             # tuple three lines up -- CLOSED history (Wave 5
                             # is done), never widened by a later wave the way
                             # snapshot_db.COLUMNS is. Not the drifting number.
    # ⛔ NO WIDTH HERE (X20(a) -- see the module docstring). What replaces the
    # old `== 185` is the manifest's own shape, not its size:
    #   * no duplicate entries -- a column declared twice would double an
    #     ALTER attempt in init_db() and desync upsert_rows()'s `?`
    #     placeholder count from its column list.
    assert len(snapshot_db.COLUMNS) == len(set(snapshot_db.COLUMNS)), \
        "a column name is declared more than once in COLUMNS"
    # ⭐ THE NON-VACUITY CONTROL: a FLOOR, never an exact pin, so it never
    # needs raising on a legitimate wave -- it only fires if COLUMNS is
    # accidentally emptied or truncated.
    assert len(snapshot_db.COLUMNS) > 100, \
        "COLUMNS looks truncated -- this floor should not need raising"


def test_wave5_type_set_membership(monkeypatch, tmp_path):
    """`pattern_engine_ids` is TEXT (comma-joined list); `pattern_engine_dir`
    (reader-encoded +1/-1/0, ruling D4) and `dp_prints_1d` (a count) are INT;
    everything else Wave-5 is the REAL default."""
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import snapshot_db
    assert "pattern_engine_ids" in snapshot_db._TEXT
    assert "pattern_engine_dir" in snapshot_db._INT
    assert "dp_prints_1d" in snapshot_db._INT
    rest = [c for c in WAVE5 if c not in ("pattern_engine_ids", "pattern_engine_dir",
                                           "dp_prints_1d")]
    for c in rest:
        assert c not in snapshot_db._TEXT, c
        assert c not in snapshot_db._INT, c
    assert not (snapshot_db._TEXT & snapshot_db._INT)


def test_init_db_creates_every_declared_column(monkeypatch, tmp_path):
    """⚠️ Named `test_init_db_creates_all_151` through three schema waves that
    each bumped the assert below and left the NAME saying 151 -- a count in a
    test name is a second authority over a width nothing checks it against.

    ⛔⛔ X20(a): the assert it pointed to drifted too (158 -> 160 -> 185 ->
    200 -> ...) -- "the width lives in the assert, once" moved the drift, it
    did not remove it. It sat directly after the genuine, non-vacuous rail below and
    dragged that rail red for a cosmetic reason for this entire branch. There
    is no width here now, and see the module docstring before adding one
    back."""
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import snapshot_db
    snapshot_db.init_db()
    with snapshot_db.connect() as c:
        have = {r[1] for r in c.execute("PRAGMA table_info(screener_rows)")}
    # ⭐ THE ROT CONTROL, for THIS pod's actual table: fails the day init_db()
    # stops creating a column it still declares.
    #
    # ⛔ THE MANIFEST'S SHAPE (no duplicate entries) is NOT re-checked here.
    # `test_wave5_columns_are_declared` already asserts it, over the identical
    # `snapshot_db.COLUMNS` list, and the check does not depend on `init_db()`
    # having run -- a second copy of the same boolean would be exactly the
    # kind of restated fact this fix spent its whole effort removing, one
    # level up (`test_scan_store.py::test_the_screener_COLUMN_SET_still_
    # partitions_into_E1s_frozen_manifest` already carries a THIRD, for an
    # unrelated invariant -- three is enough).
    assert set(snapshot_db.COLUMNS) <= have


def test_init_db_widens_a_pre_wave5_shaped_table(monkeypatch, tmp_path):
    """A prod DB that stopped short of Wave 5 gains the 13 on init -- the
    PRAGMA-diff ALTER path (`init_db`'s `have`/`COLUMNS` diff), no migration
    script (map 4 §8 tail).

    `COLUMNS` itself is monkeypatched to the pre-Wave-5 set for the FIRST
    `init_db()` call (so the table is created the way `init_db` would have
    shaped it before this task), then restored to the real one so the SECOND
    call exercises the exact ALTER-diff path a live pod hits on redeploy.

    ⭐ The pre-Wave-5 width is DERIVED, not typed. It used to be a literal and
    it went stale on every wave that widened the schema; the subtraction below
    still fails loudly on the thing the literal was there to catch -- a WAVE5
    name that is missing from `COLUMNS`, or listed in it twice.
    """
    _fresh(monkeypatch, tmp_path)
    from api.services.screener import snapshot_db
    real_columns = snapshot_db.COLUMNS
    pre_wave5_cols = [c for c in real_columns if c not in WAVE5]
    assert len(pre_wave5_cols) == len(real_columns) - len(WAVE5)

    monkeypatch.setattr(snapshot_db, "COLUMNS", pre_wave5_cols)
    snapshot_db.init_db()
    with snapshot_db.connect() as c:
        have_before = {r[1] for r in c.execute("PRAGMA table_info(screener_rows)")}
    assert set(pre_wave5_cols) <= have_before
    assert not (set(WAVE5) & have_before), "the 13 must not exist yet"

    monkeypatch.setattr(snapshot_db, "COLUMNS", real_columns)
    snapshot_db.init_db()
    with snapshot_db.connect() as c:
        have_after = {r[1] for r in c.execute("PRAGMA table_info(screener_rows)")}
    assert set(real_columns) <= have_after
    missing_after = [c for c in WAVE5 if c not in have_after]
    assert not missing_after, missing_after

    snapshot_db.upsert_rows([{"ticker": "T", "pattern_engine_ids": "wedge,flag",
                              "pattern_engine_dir": 1, "dp_prints_1d": 4}])
    row = snapshot_db.get_row("T")
    assert row["pattern_engine_ids"] == "wedge,flag"
    assert row["pattern_engine_dir"] == 1
    assert row["dp_prints_1d"] == 4
