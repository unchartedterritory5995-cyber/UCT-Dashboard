"""Gate 5: append-only hardening (store migration 3).

`INSERT OR REPLACE` deletes the conflicting row, and that delete only fires the
DELETE trigger when the connection has PRAGMA recursive_triggers=ON. store.connect
sets it; a raw sqlite3 / CLI connection does not. Migration 3 adds a BEFORE INSERT
trigger that refuses any insert over an existing (series_id, period_start,
release_id), so a raw connection cannot bypass append-only either.
"""
import sqlite3

import pytest

from api.services.econ import store as st

T0 = 1_780_000_000


def row(ps, pe, v, avail, flag="", pit="L", method="rule"):
    return (ps, pe, v, flag, avail, method, pit, None, None)


def _seed(path):
    s = st.connect(path)
    r1 = s.upsert_release("adv", "bea:gdp", "live", None, None)
    r2 = s.upsert_release("second", "bea:gdp", "live", None, None)
    s.write_observations("USGDP", r1, [row("2026-04-01", "2026-06-30", 2.4, T0)])
    s.write_observations("USGDP", r2, [row("2026-04-01", "2026-06-30", 2.6, T0 + 100)])
    s.close()
    return r1, r2


def _raw(path):
    c = sqlite3.connect(path, isolation_level=None)
    assert c.execute("PRAGMA recursive_triggers").fetchone()[0] == 0     # the bypass precondition
    return c


def _values(c):
    return [r[0] for r in c.execute(
        "SELECT value FROM observation WHERE series_id='USGDP' ORDER BY release_id")]


INS = ("INSERT {verb} INTO observation(series_id, period_start, release_id, period_end, value, flag,"
       " available_at, available_method, pit_class, ingested_at)"
       " VALUES ('USGDP','2026-04-01',?,'2026-06-30',99,'',1,'rule','L',1)")


@pytest.mark.parametrize("verb", ["OR REPLACE", "OR IGNORE", ""])
def test_raw_connection_cannot_insert_over_a_vintage(tmp_path, verb):
    p = str(tmp_path / "e.db")
    r1, _ = _seed(p)
    c = _raw(p)
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        c.execute(INS.format(verb=verb), (r1,))
    assert _values(c) == [2.4, 2.6]
    c.close()


def test_raw_connection_update_and_delete_refused(tmp_path):
    p = str(tmp_path / "e.db")
    _seed(p)
    c = _raw(p)
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        c.execute("UPDATE observation SET value=9")
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        c.execute("DELETE FROM observation")
    assert _values(c) == [2.4, 2.6]
    c.close()


def test_negative_control_without_migration3_replace_bypasses(tmp_path):
    """Proves the defect the migration closes: on a v2 schema, a raw connection's
    INSERT OR REPLACE silently rewrites a stored vintage."""
    p = str(tmp_path / "v2.db")
    c = sqlite3.connect(p, isolation_level=None)
    for i, m in enumerate(st.MIGRATIONS[:2]):
        c.executescript(f"BEGIN;\n{m}\nPRAGMA user_version = {i + 1};\nCOMMIT;")
    c.execute("INSERT INTO release(release_id, release_key, kind, created_at) VALUES (1,'adv','live',1)")
    c.execute(INS.format(verb="").replace("99", "2.4"), (1,))
    c.execute(INS.format(verb="OR REPLACE"), (1,))                  # no error: the bypass
    assert _values(c) == [99.0]
    c.close()


def test_normal_writes_and_idempotency_unchanged(tmp_path):
    s = st.connect(str(tmp_path / "e.db"))
    r1 = s.upsert_release("adv", "bea:gdp", "live", None, None)
    r2 = s.upsert_release("second", "bea:gdp", "live", None, None)
    assert s.write_observations("USGDP", r1, [row("2026-04-01", "2026-06-30", 2.4, T0)]) == st.WriteStats(1, 0, 0)
    assert s.write_observations("USGDP", r1, [row("2026-04-01", "2026-06-30", 2.4, T0)]) == st.WriteStats(0, 1, 0)
    assert s.write_observations("USGDP", r2, [row("2026-04-01", "2026-06-30", 2.6, T0 + 9)]) == st.WriteStats(0, 0, 1)
    # an older release replayed after a newer one: identical = no-op, different = StoreConflict (not the trigger)
    assert s.write_observations("USGDP", r1, [row("2026-04-01", "2026-06-30", 2.4, T0)]) == st.WriteStats(0, 1, 0)
    with pytest.raises(st.StoreConflict):
        s.write_observations("USGDP", r1, [row("2026-04-01", "2026-06-30", 7.0, T0)])
    # derive.py's raw append: identical PK row skipped, new row appended
    rows = [("2026-04-01", "2026-06-30", 2.4, "", T0, "derived:x@1", "L", None, None, r1),
            ("2026-07-01", "2026-09-30", 3.0, "", T0, "derived:x@1", "L", None, None, r1)]
    assert s.append_vintages("USGDP", rows) == 1
    assert s.append_vintages("USGDP", rows) == 0
    assert [v.value for v in s.versions("USGDP", "2026-04-01")] == [2.4, 2.6]
    s.close()


def test_migration3_upgrades_a_v2_db_in_place(tmp_path):
    p = str(tmp_path / "v2.db")
    c = sqlite3.connect(p, isolation_level=None)
    for i, m in enumerate(st.MIGRATIONS[:2]):
        c.executescript(f"BEGIN;\n{m}\nPRAGMA user_version = {i + 1};\nCOMMIT;")
    c.execute("INSERT INTO release(release_id, release_key, kind, created_at) VALUES (1,'adv','live',1)")
    c.execute(INS.format(verb="").replace("99", "2.4"), (1,))
    before = c.execute("SELECT * FROM observation").fetchall()
    c.close()
    # a read-only reader (web serving) accepts the v2 DB before the service migrates it
    st.connect(p, readonly=True).close()
    s = st.connect(p)                                                  # migrates 2 -> 3
    assert s.conn.execute("PRAGMA user_version").fetchone()[0] == st.SCHEMA_VERSION == 3
    assert s.conn.execute("SELECT * FROM observation").fetchall() == before     # no data change
    trig = {r[0] for r in s.conn.execute("SELECT name FROM sqlite_master WHERE type='trigger'")}
    assert {"observation_no_update", "observation_no_delete", "observation_no_replace"} <= trig
    s.close()
    c = _raw(p)
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        c.execute(INS.format(verb="OR REPLACE"), (1,))
    c.close()
    st.connect(p).close()                                              # re-open: no-op
    st.connect(p, readonly=True).close()
