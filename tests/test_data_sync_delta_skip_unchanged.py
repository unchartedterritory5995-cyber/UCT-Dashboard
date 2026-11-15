"""A delta's unchanged pairs are not merged again; the merge rests between chunks (2026-11-15).

Measured on the web pod that day: every delta (a 7-45 day window of every pair the worker
holds, ~102 MB) merged all 77,612 pairs for 49-83 new rows, 24-34 s every 20-40 minutes,
and member chart reads that missed the page cache waited 1-5 s behind it. The merge also
took the write lock straight back after each chunk (`sleep(0)`), so a web writer timed out
mid-merge ("database is locked"). See `_DELTA_FP_TABLE` and `_MERGE_YIELD_MAX_S` in
`api/services/data_sync.py`.
"""
import io
import re
import sqlite3
import tarfile

import pytest

from api.services import data_sync


def _db(path, rows):
    """rows: (ticker, tf, ts, close, volume)."""
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE IF NOT EXISTS ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, "
              "ts INTEGER NOT NULL, o REAL, h REAL, l REAL, c REAL, v INTEGER, "
              "PRIMARY KEY (ticker, tf, ts))")
    c.executemany("INSERT OR REPLACE INTO ohlcv VALUES (?,?,?,?,?,?,?,?)",
                  [(t, tf, ts, cl, cl + 1, cl - 1, cl, v) for t, tf, ts, cl, v in rows])
    c.commit()
    c.close()


def _rows(path):
    c = sqlite3.connect(path)
    try:
        return set(c.execute("SELECT ticker, tf, ts FROM ohlcv"))
    finally:
        c.close()


def _fp(path):
    c = sqlite3.connect(path)
    try:
        if not c.execute("SELECT 1 FROM sqlite_master WHERE name = ?",
                         (data_sync._DELTA_FP_TABLE,)).fetchone():
            return None
        return {(t, tf): n for t, tf, n in c.execute(
            f"SELECT ticker, tf, n FROM {data_sync._DELTA_FP_TABLE}")}
    finally:
        c.close()


@pytest.fixture
def merged(monkeypatch):
    """Every pair `_merge_pair` is asked to merge, in order."""
    seen = []
    real = data_sync._merge_pair

    def spy(conn, ticker, tf):
        seen.append((ticker, tf))
        return real(conn, ticker, tf)

    monkeypatch.setattr(data_sync, "_merge_pair", spy)
    return seen


DELTA_1 = [("AAA", "D", 100, 10, 100), ("AAA", "D", 200, 11, 100),
           ("BBB", "D", 100, 20, 100), ("CCC", "D", 100, 30, 100)]


def _setup(tmp_path, delta_rows=DELTA_1, local_rows=(("AAA", "D", 100, 10, 100),)):
    local, snap = str(tmp_path / "bars.db"), str(tmp_path / "delta.db")
    _db(local, list(local_rows))
    _db(snap, list(delta_rows))
    return local, snap


def test_the_first_delta_merges_every_pair_and_records_their_fingerprints(tmp_path, merged):
    local, snap = _setup(tmp_path)
    assert _fp(local) is None
    assert data_sync._merge_ohlcv_from(snap, local_db=local, skip_unchanged=True) == 3
    assert merged == [("AAA", "D"), ("BBB", "D"), ("CCC", "D")]
    assert _fp(local) == {("AAA", "D"): 2, ("BBB", "D"): 1, ("CCC", "D"): 1}
    assert _rows(local) == {(t, tf, ts) for t, tf, ts, _, _ in DELTA_1}


def test_the_same_delta_again_merges_nothing(tmp_path, merged):
    local, snap = _setup(tmp_path)
    data_sync._merge_ohlcv_from(snap, local_db=local, skip_unchanged=True)
    merged.clear()
    assert data_sync._merge_ohlcv_from(snap, local_db=local, skip_unchanged=True) == 0
    assert merged == []


def test_only_the_pair_with_a_new_row_is_merged(tmp_path, merged):
    local, snap = _setup(tmp_path)
    data_sync._merge_ohlcv_from(snap, local_db=local, skip_unchanged=True)
    merged.clear()
    _db(snap, [("BBB", "D", 300, 21, 100)])          # the next delta: one new bar for BBB
    assert data_sync._merge_ohlcv_from(snap, local_db=local, skip_unchanged=True) == 1
    assert merged == [("BBB", "D")]
    assert ("BBB", "D", 300) in _rows(local)
    assert _fp(local)[("BBB", "D")] == 2


@pytest.mark.parametrize("field", ["c", "v", "o", "h", "l"])
def test_a_changed_value_under_the_same_timestamps_is_merged(tmp_path, merged, field):
    """Same row count and newest ts, one value revised: the pair is merged again (a
    correction must reach the merge's own rules, which decide whether to take it)."""
    local, snap = _setup(tmp_path)
    data_sync._merge_ohlcv_from(snap, local_db=local, skip_unchanged=True)
    merged.clear()
    c = sqlite3.connect(snap)
    c.execute(f"UPDATE ohlcv SET {field} = {field} + 0.5 WHERE ticker = 'CCC'")
    c.commit()
    c.close()
    data_sync._merge_ohlcv_from(snap, local_db=local, skip_unchanged=True)
    assert merged == [("CCC", "D")]


def test_a_merge_that_raises_records_no_fingerprint(tmp_path, monkeypatch):
    local, snap = _setup(tmp_path)

    def boom(conn, ticker, tf):
        raise RuntimeError("disk went away")

    monkeypatch.setattr(data_sync, "_merge_pair", boom)
    with pytest.raises(RuntimeError):
        data_sync._merge_ohlcv_from(snap, local_db=local, skip_unchanged=True)
    assert _fp(local) is None


def test_a_merge_that_raises_after_a_recorded_one_keeps_the_old_fingerprints(tmp_path, merged, monkeypatch):
    local, snap = _setup(tmp_path)
    data_sync._merge_ohlcv_from(snap, local_db=local, skip_unchanged=True)
    _db(snap, [("BBB", "D", 300, 21, 100)])
    monkeypatch.setattr(data_sync, "_merge_pair",
                        lambda conn, t, tf: (_ for _ in ()).throw(RuntimeError("x")))
    with pytest.raises(RuntimeError):
        data_sync._merge_ohlcv_from(snap, local_db=local, skip_unchanged=True)
    assert _fp(local)[("BBB", "D")] == 1            # not advanced: BBB is merged next time


def test_a_store_without_the_table_merges_every_pair(tmp_path, merged):
    """A store installed or swapped wholesale carries no fingerprints (the worker never
    applies deltas), so nothing it lacks can be skipped."""
    local, snap = _setup(tmp_path)
    data_sync._merge_ohlcv_from(snap, local_db=local, skip_unchanged=True)
    fresh = str(tmp_path / "fresh.db")
    _db(fresh, [("AAA", "D", 100, 10, 100)])
    merged.clear()
    data_sync._merge_ohlcv_from(snap, local_db=fresh, skip_unchanged=True)
    assert merged == [("AAA", "D"), ("BBB", "D"), ("CCC", "D")]
    assert _rows(fresh) == {(t, tf, ts) for t, tf, ts, _, _ in DELTA_1}


def test_the_skip_is_off_unless_asked_for(tmp_path, merged):
    """The base, a full snapshot and a store adoption never skip: the base is the daily
    backstop for anything a skipped pair could miss."""
    local, snap = _setup(tmp_path)
    data_sync._merge_ohlcv_from(snap, local_db=local, skip_unchanged=True)
    merged.clear()
    data_sync._merge_ohlcv_from(snap, local_db=local)
    assert merged == [("AAA", "D"), ("BBB", "D"), ("CCC", "D")]


def _local_write(local, sql, key, **bump):
    """A local write the way every store writer makes one: the rows and the series rev
    bump in ONE transaction (bars_sqlite's ONE WRITER RULE)."""
    from api.services import bars_sqlite
    c = sqlite3.connect(local)
    c.execute(sql)
    bars_sqlite.bump_series_revs(c, [key], **bump)
    c.commit()
    c.close()


def test_a_local_write_since_the_last_merge_gets_the_pair_merged_again(tmp_path, merged):
    """The skip is exact: a pair whose local series was written after its last merge (here a
    delete, as a heal or a purge makes one) is merged again by an IDENTICAL delta, and the
    row comes back, exactly as before this change."""
    local, snap = _setup(tmp_path)
    data_sync._merge_ohlcv_from(snap, local_db=local, skip_unchanged=True)
    _local_write(local, "DELETE FROM ohlcv WHERE ticker = 'CCC'", ("CCC", "D"), deleted=True)
    merged.clear()
    data_sync._merge_ohlcv_from(snap, local_db=local, skip_unchanged=True)
    assert merged == [("CCC", "D")]
    assert ("CCC", "D", 100) in _rows(local)


def test_a_value_rewritten_after_the_merge_gets_the_pair_merged_again(tmp_path, merged):
    """e.g. bars-api re-storing its own lower-volume copy of a bar: a rev bump with no row
    added or removed still makes the next identical delta merge the pair."""
    local, snap = _setup(tmp_path)
    data_sync._merge_ohlcv_from(snap, local_db=local, skip_unchanged=True)
    _local_write(local, "UPDATE ohlcv SET v = 1 WHERE ticker = 'BBB'", ("BBB", "D"))
    merged.clear()
    data_sync._merge_ohlcv_from(snap, local_db=local, skip_unchanged=True)
    assert merged == [("BBB", "D")]


def test_a_wholesale_change_merges_every_pair(tmp_path, merged):
    """`bump_store_floor` (a snapshot install, a bulk delete across series) persists a newer
    `rev_floor_ms`: no per-pair rev can vouch for the rows any more."""
    local, snap = _setup(tmp_path)
    data_sync._merge_ohlcv_from(snap, local_db=local, skip_unchanged=True)
    c = sqlite3.connect(local)
    c.execute("CREATE TABLE IF NOT EXISTS store_meta (k TEXT PRIMARY KEY, v REAL)")
    c.execute("INSERT OR REPLACE INTO store_meta VALUES ('rev_floor_ms', 9e15)")
    c.commit()
    c.close()
    merged.clear()
    data_sync._merge_ohlcv_from(snap, local_db=local, skip_unchanged=True)
    assert merged == [("AAA", "D"), ("BBB", "D"), ("CCC", "D")]
    merged.clear()
    data_sync._merge_ohlcv_from(snap, local_db=local, skip_unchanged=True)
    assert merged == []                              # the new floor is recorded


def test_a_store_without_series_revs_never_skips(tmp_path, merged):
    local, snap = _setup(tmp_path)
    data_sync._merge_ohlcv_from(snap, local_db=local, skip_unchanged=True)
    c = sqlite3.connect(local)
    c.execute("DROP TABLE series_meta")
    c.commit()
    c.close()
    merged.clear()
    data_sync._merge_ohlcv_from(snap, local_db=local, skip_unchanged=True)
    assert merged == [("AAA", "D"), ("BBB", "D"), ("CCC", "D")]


# ── apply_delta is the door that asks for the skip ──────────────────────────────────────

class _Body:
    def __init__(self, data):
        self._b = io.BytesIO(data)

    def read(self, amt=None):
        return self._b.read(amt if amt and amt > 0 else 1 << 20)


class _FakeS3:
    def __init__(self, objs):
        self.objs = objs

    def get_object(self, Bucket, Key):
        return {"Body": _Body(self.objs[Key]), "ContentLength": len(self.objs[Key])}


def _tarball(db_path):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        tar.add(db_path, arcname="delta.db")
    return buf.getvalue()


def test_apply_delta_skips_the_pairs_an_identical_delta_already_merged(tmp_path, merged, monkeypatch):
    src = tmp_path / "src"
    src.mkdir()
    _db(str(src / "delta.db"), DELTA_1)
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    _db(str(data_dir / "bars.db"), [("AAA", "D", 100, 10, 100)])
    payload = _tarball(str(src / "delta.db"))
    fake = _FakeS3({"deltas/1700000300.tar.gz": payload, "deltas/1700000600.tar.gz": payload})
    monkeypatch.setattr(data_sync, "_DATA_DIR", str(data_dir))
    monkeypatch.setattr(data_sync, "_client", lambda: fake)
    monkeypatch.setattr(data_sync, "_bucket", lambda: "b")

    assert data_sync.apply_delta("1700000300") is True
    assert len(merged) == 3
    merged.clear()
    assert data_sync.apply_delta("1700000600") is True     # same content, next ts
    assert merged == []
    assert data_sync._read_marker(data_sync._LAST_DELTA_MARKER)["snapshot_ts"] == "1700000600"


# ── the rest between chunks ──────────────────────────────────────────────────────────────

@pytest.fixture
def naps(monkeypatch):
    got = []
    monkeypatch.setattr(data_sync.time, "sleep", lambda s: got.append(s))
    monkeypatch.setattr(data_sync, "_MERGE_CHUNK_PAIRS", 1)
    return got


def test_the_merge_rests_between_chunks_and_not_after_the_last(tmp_path, naps):
    local, snap = _setup(tmp_path)
    data_sync._merge_ohlcv_from(snap, local_db=local)
    assert len(naps) == 2                                   # 3 one-pair chunks, 2 gaps
    assert all(0 < s <= data_sync._MERGE_YIELD_MAX_S for s in naps), naps


def test_the_rest_is_capped(tmp_path, naps, monkeypatch):
    monkeypatch.setattr(data_sync, "_MERGE_YIELD_MAX_S", 1e-9)
    local, snap = _setup(tmp_path)
    data_sync._merge_ohlcv_from(snap, local_db=local)
    assert naps == [1e-9, 1e-9]


def test_a_locked_adoption_pass_does_not_rest(tmp_path, naps):
    """Its caller holds the write lock: a gap would only burn the pass's budget."""
    local, snap = _setup(tmp_path)
    data_sync._merge_ohlcv_from(snap, local_db=local, pairs=[("AAA", "D"), ("BBB", "D"), ("CCC", "D")],
                                deadline=data_sync.time.monotonic() + 60)
    assert naps == [0, 0]


# ── every statement on the local store is a primary-key seek ───────────────────────────

def test_the_fingerprint_statements_never_scan_the_local_store():
    from api.services import bars_sqlite
    c = sqlite3.connect(":memory:")
    c.execute("ATTACH ':memory:' AS snap")
    c.execute("CREATE TABLE snap.ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, ts INTEGER NOT NULL,"
              " o REAL, h REAL, l REAL, c REAL, v INTEGER, PRIMARY KEY (ticker, tf, ts))")
    for ddl in data_sync._DELTA_FP_TEMP_DDL + data_sync._DELTA_FP_DDL + bars_sqlite._META_DDL:
        c.execute(ddl)
    plan = [r[3] for r in c.execute("EXPLAIN QUERY PLAN " + data_sync._DELTA_FP_CHANGED_SQL)]
    local = [p for p in plan if re.search(r"\b[pm]\b", p)]
    assert len(local) == 2 and all(p.startswith("SEARCH") for p in local), plan
    plan = [r[3] for r in c.execute("EXPLAIN QUERY PLAN " + data_sync._DELTA_FP_NOTE_SQL, ("A", "D") * 2)]
    assert not any(re.match(r"SCAN\b", p) for p in plan), plan
