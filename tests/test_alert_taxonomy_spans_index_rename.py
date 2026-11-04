"""The old shared span index name is dropped once its replacements exist.

rating_change_compare and regime_change_compare both used to create ``idx_rc_spans_pred``
in alert_taxonomy.db; it was renamed to ``idx_ratc_spans_pred`` / ``idx_regc_spans_pred``.
A DB that predates the rename still holds the old index beside the new one -- a duplicate
every write maintains. Each module's schema init now drops the old name AFTER creating its
own index. These rails pin: the old name is gone after init (whichever table it sat on and
whichever module runs), the new ones are present, the predicate lookups still use an index,
and the init is safe on a fresh DB and idempotent.
"""
from __future__ import annotations

import sqlite3

import pytest

from api.services.alert_taxonomy import rating_change_compare as ratc
from api.services.alert_taxonomy import regime_change_compare as regc

OLD = "idx_rc_spans_pred"
NEW = {"rating_change_comparison_spans": "idx_ratc_spans_pred",
       "regime_change_comparison_spans": "idx_regc_spans_pred"}


def _indexes(path) -> dict[str, str]:
    c = sqlite3.connect(path)
    try:
        return {name: tbl for name, tbl in c.execute(
            "SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'")}
    finally:
        c.close()


def _plan(path, table: str) -> str:
    c = sqlite3.connect(path)
    try:
        return " | ".join(r[-1] for r in c.execute(
            f"EXPLAIN QUERY PLAN DELETE FROM {table} WHERE predicate_id = ?", ("shadow:X",)))
    finally:
        c.close()


def _pre_rename_db(path, old_on: str) -> None:
    """A DB as the pre-rename code left it: both span tables, the old shared index on the
    table whose module ran first, and nothing on the other (the second CREATE no-op'd)."""
    for mod in (ratc, regc):
        c = mod._conn(str(path))
        c.close()
    c = sqlite3.connect(path)
    for name in NEW.values():
        c.execute(f"DROP INDEX IF EXISTS {name}")
    c.execute(f"CREATE INDEX {OLD} ON {old_on}(predicate_id)")
    c.commit()
    c.close()
    assert _indexes(path) == {OLD: old_on}  # non-vacuity: the fixture really is the old shape


def _init_both(path) -> None:
    for mod in (ratc, regc):
        mod._conn(str(path)).close()


@pytest.mark.parametrize("old_on", sorted(NEW))
def test_after_init_the_old_index_is_gone_and_both_new_ones_exist(tmp_path, old_on):
    db = tmp_path / "alert_taxonomy.db"
    _pre_rename_db(db, old_on)
    _init_both(db)
    idx = _indexes(db)
    assert OLD not in idx
    assert {n: t for n, t in idx.items() if n in NEW.values()} == {n: t for t, n in NEW.items()}


@pytest.mark.parametrize("mod", [ratc, regc], ids=["rating", "regime"])
def test_either_module_alone_drops_the_old_name(tmp_path, mod):
    """Each schema init carries the drop, so it does not depend on which module runs."""
    db = tmp_path / "alert_taxonomy.db"
    _pre_rename_db(db, "rating_change_comparison_spans")
    mod._conn(str(db)).close()
    assert OLD not in _indexes(db)


@pytest.mark.parametrize("table", sorted(NEW))
def test_predicate_lookups_still_use_the_new_index(tmp_path, table):
    db = tmp_path / "alert_taxonomy.db"
    _pre_rename_db(db, table)
    _init_both(db)
    plan = _plan(db, table)
    assert NEW[table] in plan, plan


def test_fresh_db_and_repeat_init_are_safe(tmp_path):
    db = tmp_path / "alert_taxonomy.db"
    for _ in range(3):
        _init_both(db)
    idx = _indexes(db)
    assert OLD not in idx and set(NEW.values()) <= set(idx)
