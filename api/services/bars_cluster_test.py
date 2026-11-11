"""Rails for the clustered bar store (api/services/bars_cluster.py).

Invariants, each stated in general form:
  I1  A store created by init_db is CLUSTERED (WITHOUT ROWID) with the pinned pragmas, and
      the get_bars query is one primary-key range scan.
  I2  Converting a rowid store NEVER loses, duplicates or alters a row, under ANY
      interleaving of writes (insert / replace / ignore / update / key-moving update /
      upsert / delete, from any connection) with the conversion's chunks -- property
      checked over many random sequences, including stops and resumes.
  I3  A reader is never delayed by a writer: a write transaction held open for seconds,
      plus a continuous universe-style writer, leave get_bars latency bounded.
  I4  A failed verification leaves the original store untouched.
"""
from __future__ import annotations

import importlib
import os
import random
import sqlite3
import threading
import time
from datetime import datetime, timezone

import pytest

_LEGACY = ("CREATE TABLE ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, ts INTEGER NOT NULL, "
           "o REAL, h REAL, l REAL, c REAL, v INTEGER, PRIMARY KEY (ticker, tf, ts))")
_GET_BARS = ("SELECT ts,o,h,l,c,v FROM (SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf=? "
             "ORDER BY ts DESC LIMIT ?) ORDER BY ts ASC")


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from api.services import bars_sqlite
    importlib.reload(bars_sqlite)
    from api.services import bars_cluster
    yield bars_sqlite, bars_cluster, str(tmp_path / "bars.db")
    try:
        bars_sqlite._drop_local_conn()
    except Exception:
        pass
    monkeypatch.undo()
    importlib.reload(bars_sqlite)


def _legacy_store(path: str, rnd: random.Random, tickers, tfs=("1", "5", "D"), n=40) -> dict:
    """A rowid-layout store (as production holds today) + the reference model."""
    c = sqlite3.connect(path)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute(_LEGACY)
    c.execute("CREATE INDEX idx_ohlcv_lookup ON ohlcv(ticker, tf, ts DESC)")
    model = {}
    for tkr in tickers:
        for tf in tfs:
            for i in range(n):
                k = (tkr, tf, 1000 + i * 60)
                model[k] = _vals(rnd)
    c.executemany("INSERT INTO ohlcv VALUES (?,?,?,?,?,?,?,?)", [k + v for k, v in model.items()])
    c.commit()
    c.close()
    return model


def _vals(rnd):
    p = round(rnd.uniform(1, 500), 4)
    return (p, p + 1.0, p - 0.5, p + 0.25, rnd.randint(0, 10**6))


def _random_write(c: sqlite3.Connection, model: dict, rnd: random.Random, tickers, tfs) -> None:
    """One random write, applied to the store (autocommit) and to the model."""
    op = rnd.choice(("replace", "replace", "ignore", "update", "move", "upsert", "delete",
                     "delete_series", "insert_new"))
    tkr, tf = rnd.choice(tickers), rnd.choice(tfs)
    ts = 1000 + rnd.randrange(60) * 60
    k, v = (tkr, tf, ts), _vals(rnd)
    if op == "replace":
        c.execute("INSERT OR REPLACE INTO ohlcv VALUES (?,?,?,?,?,?,?,?)", k + v)
        model[k] = v
    elif op == "ignore":
        c.execute("INSERT OR IGNORE INTO ohlcv VALUES (?,?,?,?,?,?,?,?)", k + v)
        model.setdefault(k, v)
    elif op == "update":
        c.execute("UPDATE ohlcv SET c=?, v=? WHERE ticker=? AND tf=? AND ts=?", (v[3], v[4]) + k)
        if k in model:
            model[k] = model[k][:3] + (v[3], v[4])
    elif op == "move":          # key-moving update (e.g. a grid snap)
        nk = (tkr, tf, ts + 7)
        if k in model and nk not in model:
            c.execute("UPDATE ohlcv SET ts=? WHERE ticker=? AND tf=? AND ts=?", (nk[2],) + k)
            model[nk] = model.pop(k)
    elif op == "upsert":
        c.execute("INSERT INTO ohlcv VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(ticker,tf,ts) "
                  "DO UPDATE SET h=excluded.h", k + v)
        model[k] = (model[k][0], v[1]) + model[k][2:] if k in model else v
    elif op == "delete":
        c.execute("DELETE FROM ohlcv WHERE ticker=? AND tf=? AND ts=?", k)
        model.pop(k, None)
    elif op == "delete_series":
        c.execute("DELETE FROM ohlcv WHERE ticker=? AND tf=?", (tkr, tf))
        for kk in [kk for kk in model if kk[0] == tkr and kk[1] == tf]:
            del model[kk]
    else:                       # brand-new series / ticker
        nk = ("ZNEW" + str(rnd.randrange(5)), tf, ts)
        c.execute("INSERT OR REPLACE INTO ohlcv VALUES (?,?,?,?,?,?,?,?)", nk + v)
        model[nk] = v


def _content(path: str) -> dict:
    c = sqlite3.connect(path)
    try:
        return {r[:3]: tuple(r[3:]) for r in c.execute("SELECT * FROM ohlcv")}
    finally:
        c.close()


def _assert_converted(bc, path, model):
    c = sqlite3.connect(path)
    try:
        assert bc.layout(c) == "clustered"
        assert bc.phase(c) == "done"
        names = {r[0] for r in c.execute("SELECT name FROM sqlite_master")}
        assert not names & ({bc.CLUSTERED, bc.RETIRED, bc.STATE} | set(bc.TRIGGERS)), names
    finally:
        c.close()
    assert _content(path) == model


# ── I1 ───────────────────────────────────────────────────────────────────────
def test_new_store_is_clustered_with_pinned_pragmas_and_one_range_scan(store, monkeypatch):
    monkeypatch.setenv("BARS_API_ENABLED", "1")
    bs, bc, path = store
    bs.init_db()
    c = bs._conn()
    assert bc.layout(c) == "clustered"
    idx = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='index'")}
    assert bs.LOOKUP_INDEX not in idx, "a clustered PK already is the lookup b-tree"
    assert c.execute("PRAGMA journal_mode").fetchone()[0] == "wal"   # readers never block
    assert c.execute("PRAGMA synchronous").fetchone()[0] == 1        # NORMAL
    assert c.execute("PRAGMA busy_timeout").fetchone()[0] == 30000   # serving tier
    assert c.execute("PRAGMA mmap_size").fetchone()[0] == 268435456
    plan = " | ".join(r[-1] for r in c.execute("EXPLAIN QUERY PLAN " + _GET_BARS, ("A", "5", 600)))
    assert "PRIMARY KEY" in plan and "ticker=? AND tf=?" in plan, plan
    assert "SCAN ohlcv" not in plan.replace("SCAN ohlcv USING", "SEARCH"), plan
    # Every connection is per thread: a second thread gets its own (no shared handle).
    other = []
    t = threading.Thread(target=lambda: other.append(bs._conn()))
    t.start(); t.join()
    assert other[0] is not c


def test_expected_indexes_follow_the_layout(store, tmp_path):
    bs, bc, _path = store
    legacy = str(tmp_path / "legacy.db")
    c = sqlite3.connect(legacy); c.execute(_LEGACY); c.commit()
    assert bs.LOOKUP_INDEX in bs.expected_index_ddl(c)
    c.close()
    assert set(bs.ensure_indexes_at(legacy)) == set(bs.BARS_INDEX_DDL)
    clustered = str(tmp_path / "clustered.db")
    c = sqlite3.connect(clustered); c.execute(bs.ohlcv_ddl()); c.commit()
    assert bs.LOOKUP_INDEX not in bs.expected_index_ddl(c)
    c.close()
    assert bs.ensure_indexes_at(clustered) == [bs.DAILY_BYDATE_INDEX]


# ── I2 ───────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("seed", range(12))
def test_conversion_preserves_every_row_under_interleaved_writes(store, seed):
    bs, bc, path = store
    rnd = random.Random(seed)
    tickers = [f"T{i}" for i in range(rnd.randint(1, 9))]
    tfs = ("1", "5", "D")
    model = _legacy_store(path, rnd, tickers, tfs, n=rnd.randint(0, 40))
    w = sqlite3.connect(path, isolation_level=None, timeout=10)
    stops = {rnd.randrange(1, 30) for _ in range(rnd.randint(0, 3))}
    calls = [0]

    def may_continue():
        # Called before every unit of work: a burst of writes lands between chunks,
        # and sometimes the "window closes" (a stop + later resume, as after a deploy).
        calls[0] += 1
        for _ in range(rnd.randint(0, 6)):
            _random_write(w, model, rnd, tickers, tfs)
        return calls[0] not in stops

    for _attempt in range(len(stops) + 2):
        if bc.run(path, may_continue=may_continue, chunk_rows=rnd.choice((1, 7, 50)),
                  pause_s=0) == "done":
            break
    _assert_converted(bc, path, model)
    # The live API reads the converted store exactly like the model.
    for tkr in tickers:
        for tf in tfs:
            want = sorted((k[2],) + v for k, v in model.items() if k[:2] == (tkr, tf))[-25:]
            assert [tuple(r) for r in bs.get_bars(tkr, tf, 25)] == want
    w.close()


def test_conversion_under_a_concurrent_writer_thread(store):
    """Same invariant with real concurrency: a writer thread on its own connection writes
    continuously while the conversion runs in another thread."""
    bs, bc, path = store
    rnd = random.Random(99)
    tickers = [f"T{i}" for i in range(6)]
    tfs = ("1", "5", "D")
    model = _legacy_store(path, rnd, tickers, tfs, n=300)
    stop = threading.Event()
    lock = threading.Lock()

    def writer():
        w = sqlite3.connect(path, isolation_level=None, timeout=30)
        wr = random.Random(5)
        while not stop.is_set():
            with lock:
                _random_write(w, model, wr, tickers, tfs)
        w.close()

    t = threading.Thread(target=writer)
    t.start()
    try:
        assert bc.run(path, chunk_rows=40, pause_s=0.001) == "done"
    finally:
        stop.set()
        t.join()
    with lock:
        _assert_converted(bc, path, model)


def test_crash_inside_a_chunk_rolls_back_and_resumes(store, monkeypatch):
    bs, bc, path = store
    rnd = random.Random(3)
    model = _legacy_store(path, rnd, ["A", "B", "C"], n=30)
    real = bc.copy_chunk
    n = [0]

    def flaky(conn, rows):
        n[0] += 1
        if n[0] == 3:
            raise sqlite3.OperationalError("disk I/O error (simulated)")
        return real(conn, rows)

    monkeypatch.setattr(bc, "copy_chunk", flaky)
    with pytest.raises(sqlite3.OperationalError):
        bc.run(path, chunk_rows=10, pause_s=0)
    c = sqlite3.connect(path)
    assert bc.phase(c) == "copy"
    c.close()
    monkeypatch.setattr(bc, "copy_chunk", real)
    assert bc.run(path, chunk_rows=10, pause_s=0) == "done"
    _assert_converted(bc, path, model)


# ── I4 ───────────────────────────────────────────────────────────────────────
def test_failed_verification_leaves_the_original_store_untouched(store, monkeypatch):
    bs, bc, path = store
    rnd = random.Random(4)
    model = _legacy_store(path, rnd, ["A", "B"], n=20)
    real_verify = bc.verify

    def tampered(conn, k=bc.VERIFY_SAMPLES):
        conn.execute(f"DELETE FROM {bc.CLUSTERED} WHERE ticker='A' AND tf='5' AND ts=1000")
        return real_verify(conn, k)

    monkeypatch.setattr(bc, "verify", tampered)
    assert bc.run(path, chunk_rows=5, pause_s=0) == "aborted"
    c = sqlite3.connect(path)
    try:
        assert bc.layout(c) == "rowid" and bc.phase(c) == "pending"
        names = {r[0] for r in c.execute("SELECT name FROM sqlite_master")}
        assert not names & ({bc.CLUSTERED, bc.STATE} | set(bc.TRIGGERS))
    finally:
        c.close()
    assert _content(path) == model


# ── I3 ───────────────────────────────────────────────────────────────────────
def test_reader_latency_is_bounded_under_writer_load(store):
    """A writer holding a write transaction open (an R2 merge chunk, a checkpoint-sized
    commit) and a universe writer flushing every bucket must never delay get_bars."""
    bs, bc, path = store
    bs.init_db()
    tickers = [f"S{i:03d}" for i in range(200)]
    bs.put_bars_many("D", {t: [{"t": 20200101 + i, "o": 10, "h": 11, "l": 9, "c": 10.5, "v": 5}
                               for i in range(700)] for t in tickers})
    stop = threading.Event()
    errors: list = []

    def universe_writer():
        d = 20300101
        while not stop.is_set():
            try:
                bs.put_bars_many("D", {t: [{"t": d, "o": 10, "h": 11, "l": 9, "c": 10.5, "v": 5}]
                                       for t in tickers})
            except Exception as e:  # noqa: BLE001
                errors.append(e)
            d += 1
            time.sleep(0.01)

    def held_transaction():
        w = sqlite3.connect(path, isolation_level=None, timeout=30)
        while not stop.is_set():
            w.execute("BEGIN IMMEDIATE")
            w.execute("INSERT OR REPLACE INTO ohlcv VALUES ('HOLD','D',1,1,1,1,1,1)")
            time.sleep(0.6)                     # a long write txn, held
            w.execute("COMMIT")
            time.sleep(0.05)
        w.close()

    lat: list = []

    def reader(seed):
        rnd = random.Random(seed)
        while not stop.is_set():
            t0 = time.perf_counter()
            rows = bs.get_bars(rnd.choice(tickers), "D", 600)
            lat.append(time.perf_counter() - t0)
            if len(rows) != 600:
                errors.append(AssertionError(len(rows)))

    threads = [threading.Thread(target=universe_writer), threading.Thread(target=held_transaction)]
    threads += [threading.Thread(target=reader, args=(i,)) for i in range(4)]
    for t in threads:
        t.start()
    time.sleep(3.0)
    stop.set()
    for t in threads:
        t.join()
    assert not errors, errors[:3]
    lat.sort()
    p99 = lat[int(0.99 * (len(lat) - 1))]
    assert len(lat) > 100
    # The held transaction is 600 ms; a reader that waited on it even once would exceed
    # this. Generous for a loaded CI box -- a read is ~1-3 ms here.
    assert p99 < 0.25, f"get_bars p99 {p99 * 1000:.0f} ms under writer load"


# ── gates ────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("utc,quiet", [
    ("2026-11-11T14:30", False),   # Wed 09:30 ET
    ("2026-11-11T09:00", False),   # Wed 04:00 ET pre-market
    ("2026-11-12T00:59", False),   # Wed 19:59 ET post-market
    ("2026-11-12T01:30", True),    # Wed 20:30 ET
    ("2026-11-12T08:00", True),    # Thu 03:00 ET
    ("2026-11-12T08:50", False),   # Thu 03:50 ET
    ("2026-11-14T17:00", True),    # Saturday
    ("2026-11-16T07:00", True),    # Mon 02:00 ET
])
def test_quiet_window(utc, quiet):
    from api.services import bars_cluster as bc
    now = datetime.fromisoformat(utc).replace(tzinfo=timezone.utc)
    assert bc.in_quiet_window(now) is quiet


def test_disk_gate(tmp_path, monkeypatch):
    from api.services import bars_cluster as bc
    p = tmp_path / "bars.db"
    p.write_bytes(b"\0" * 4096)
    ok, info = bc.disk_ok(str(p))
    assert info["need_bytes"] >= int(4096 * bc.DISK_HEADROOM)
    monkeypatch.setattr(bc.shutil, "disk_usage", lambda _p: type("u", (), {"free": 10})())
    assert bc.disk_ok(str(p))[0] is False
