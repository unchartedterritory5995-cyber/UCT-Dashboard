"""The clustered (WITHOUT ROWID) bar layout: built OFFLINE in the snapshot pipeline,
adopted by serving pods through the wholesale install, never reverted in place.

Invariants (general form):
  C1  `cluster_copy` reproduces EVERY row of EVERY table exactly, carries every index /
      trigger / view, gives `ohlcv` every expected index (by-date included, the redundant
      lookup index excluded), and refuses -- removing its output -- whatever it cannot
      convert or verify.
  C2  `verify` fails on ANY per-(ticker, tf) difference and on a global count difference.
  C3  `_make_tarball` ships a clustered, integrity-clean bars.db; on any conversion failure
      or with SNAPSHOT_CLUSTER=0 it ships the copy unchanged (never fails the upload).
  C4  Adoption (one-shot, BARS_ADOPT_CLUSTERED): only a base TAGGED clustered is
      downloaded; the swap happens only after layout + integrity + row-count checks and
      carries every row only the pod held; any failure leaves the old store untouched;
      deltas newer than the base re-apply; init_db, merges and deltas never turn a
      clustered store back into rowid.
  C5  Every hot query that uses an index on a rowid store uses the PK or an index on a
      clustered one (no full scans introduced).
  C6  `bars_sqlite.ohlcv_ddl` is the only `ohlcv` table DDL in the product.
"""
from __future__ import annotations

import ast
import importlib
import os
import random
import re
import shutil
import sqlite3
import tarfile
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
_ROWID = ("CREATE TABLE ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, ts INTEGER NOT NULL, "
          "o REAL, h REAL, l REAL, c REAL, v INTEGER, PRIMARY KEY (ticker, tf, ts))")


def _rowid_store(path, seed=0, tickers=12, n=60) -> None:
    from api.services import bars_sqlite as bs
    rnd = random.Random(seed)
    c = sqlite3.connect(str(path))
    c.execute("PRAGMA journal_mode=WAL")
    c.execute(_ROWID)
    c.execute(bs.BARS_INDEX_DDL[bs.LOOKUP_INDEX])
    c.execute(bs.BARS_INDEX_DDL[bs.DAILY_BYDATE_INDEX])
    rows = []
    for i in range(tickers):
        for tf, base, step in (("D", 20200101, 1), ("5", 1_700_000_100, 300), ("1", 1_700_000_040, 60)):
            for k in range(n):
                p = rnd.choice([None, rnd.uniform(0.01, 9e3), 1e-300, -0.0, 97.8])
                rows.append((f"T{i:02d}", tf, base + k * step, p, rnd.uniform(1, 9e3),
                             rnd.uniform(1, 9e3), rnd.random() * 1e3,
                             rnd.choice([None, 0, rnd.randint(0, 2**40)])))
    rnd.shuffle(rows)                                   # interleaved, like the live store
    c.executemany("INSERT INTO ohlcv VALUES (?,?,?,?,?,?,?,?)", rows)
    c.execute("CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at INTEGER)")
    c.execute("INSERT INTO _migrations VALUES ('m1', 1), ('m2', 2)")
    c.execute("CREATE TABLE meta (k TEXT, v TEXT)")
    c.execute("CREATE INDEX idx_meta_k ON meta(k)")
    c.execute("INSERT INTO meta VALUES ('verified_through', 'x'), ('a', NULL)")
    c.execute("CREATE VIEW v_meta AS SELECT k FROM meta")
    c.commit()
    c.close()


def _dump(path) -> dict:
    c = sqlite3.connect(str(path))
    try:
        tables = [r[0] for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        return {t: sorted(c.execute(f'SELECT * FROM "{t}"').fetchall(), key=repr) for t in tables}
    finally:
        c.close()


def _schema(path) -> dict:
    c = sqlite3.connect(str(path))
    try:
        return {r[0]: (r[1], r[2]) for r in c.execute(
            "SELECT name, type, tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")}
    finally:
        c.close()


def _layout(path) -> str:
    from api.services import bars_sqlite as bs
    c = sqlite3.connect(str(path))
    try:
        return bs.ohlcv_layout(c)
    finally:
        c.close()


# ── C1 ───────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("seed", range(4))
def test_cluster_copy_reproduces_every_row_and_object(tmp_path, seed):
    from api.services import bars_cluster, bars_sqlite as bs
    src, dst = tmp_path / "src.db", tmp_path / "dst.db"
    _rowid_store(src, seed=seed, tickers=random.Random(seed).randint(1, 15))
    before = _dump(src)
    stats = bars_cluster.cluster_copy(str(src), str(dst))
    assert _layout(dst) == "clustered" and _layout(src) == "rowid"   # source untouched
    assert _dump(dst) == before
    assert _dump(src) == before
    assert stats["rows"] == len(before["ohlcv"])
    sch = _schema(dst)
    assert sch[bs.DAILY_BYDATE_INDEX] == ("index", "ohlcv")
    assert bs.LOOKUP_INDEX not in sch, "a clustered PK already is the lookup b-tree"
    assert sch["idx_meta_k"] == ("index", "meta") and sch["v_meta"][0] == "view"
    c = sqlite3.connect(str(dst))
    try:
        assert c.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert c.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    finally:
        c.close()


def test_cluster_copy_refuses_non_integer_ts_and_cleans_up(tmp_path):
    from api.services import bars_cluster
    src, dst = tmp_path / "src.db", tmp_path / "dst.db"
    _rowid_store(src, tickers=2, n=5)
    c = sqlite3.connect(str(src))
    c.execute("INSERT INTO ohlcv VALUES ('BAD','5',1.5,1,1,1,1,1)")
    c.commit(); c.close()
    with pytest.raises(bars_cluster.ClusterError, match="non-integer ts"):
        bars_cluster.cluster_copy(str(src), str(dst))
    assert not dst.exists()


def test_cluster_copy_refuses_an_already_clustered_source(tmp_path):
    from api.services import bars_cluster, bars_sqlite as bs
    src = tmp_path / "src.db"
    c = sqlite3.connect(str(src)); c.execute(bs.ohlcv_ddl()); c.commit(); c.close()
    with pytest.raises(bars_cluster.ClusterError, match="nothing to convert"):
        bars_cluster.cluster_copy(str(src), str(tmp_path / "dst.db"))


# ── C2 ───────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("tamper", [
    "UPDATE main.ohlcv SET c = c + 1e-9 WHERE rowid IN (SELECT rowid FROM main.ohlcv LIMIT 1)",
    "DELETE FROM main.ohlcv WHERE ts = (SELECT MIN(ts) FROM main.ohlcv WHERE tf='D') AND tf='D' "
    "AND ticker='T00'",
    "UPDATE main.ohlcv SET v = NULL WHERE ticker='T01' AND tf='5' AND v IS NOT NULL",
    "UPDATE main.ohlcv SET ticker='T99' WHERE ticker='T02' AND tf='1'",
])
def test_verify_catches_any_difference(tmp_path, tamper):
    from api.services import bars_cluster
    src, dst = tmp_path / "src.db", tmp_path / "dst.db"
    _rowid_store(src, tickers=3, n=20)
    shutil.copy(src, dst)                         # same layout: verify is layout-agnostic
    c = sqlite3.connect(str(dst), isolation_level=None)
    c.execute("ATTACH DATABASE ? AS src", (str(src),))
    bars_cluster.verify(c)                        # control: identical copies verify
    c.execute(tamper)
    with pytest.raises(bars_cluster.ClusterError):
        bars_cluster.verify(c)
    c.close()


# ── C3 ───────────────────────────────────────────────────────────────────────
@pytest.fixture
def data_sync_at(tmp_path, monkeypatch):
    from api.services import data_sync
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    importlib.reload(data_sync)
    yield data_sync
    monkeypatch.undo()
    importlib.reload(data_sync)


def _shipped(data_sync, tmp_path) -> Path:
    tar_path = data_sync._make_tarball()
    out = tmp_path / "extracted"
    out.mkdir(exist_ok=True)
    try:
        with tarfile.open(tar_path, mode="r:gz") as tar:
            tar.extractall(out)
    finally:
        shutil.rmtree(os.path.dirname(tar_path), ignore_errors=True)
    return out / "bars.db"


def _big_enough(data_sync, path):
    need = data_sync.SNAPSHOT_MIN_OHLCV_ROWS
    c = sqlite3.connect(str(path))
    c.executemany("INSERT OR IGNORE INTO ohlcv VALUES (?,?,?,?,?,?,?,?)",
                  [("FILL", "D", 19000101 + i, 1.0, 2.0, 0.5, 1.5, 100) for i in range(need)])
    c.commit(); c.close()


def test_snapshot_ships_clustered_with_every_index(tmp_path, data_sync_at):
    from api.services import bars_sqlite as bs
    src = tmp_path / "bars.db"
    _rowid_store(src)
    _big_enough(data_sync_at, src)
    shipped = _shipped(data_sync_at, tmp_path)
    assert _layout(shipped) == "clustered"
    assert _dump(shipped) == _dump(src)
    assert bs.DAILY_BYDATE_INDEX in _schema(shipped)
    assert _layout(src) == "rowid", "the worker's live store is never converted"


def test_snapshot_ships_unchanged_when_disabled_or_conversion_fails(tmp_path, data_sync_at, monkeypatch):
    from api.services import bars_cluster
    src = tmp_path / "bars.db"
    _rowid_store(src)
    _big_enough(data_sync_at, src)
    monkeypatch.setattr(data_sync_at, "SNAPSHOT_CLUSTER", False)
    assert _layout(_shipped(data_sync_at, tmp_path)) == "rowid"
    monkeypatch.setattr(data_sync_at, "SNAPSHOT_CLUSTER", True)

    def boom(*_a, **_k):
        raise bars_cluster.ClusterError("simulated verification failure")

    monkeypatch.setattr(bars_cluster, "cluster_copy", boom)
    shutil.rmtree(tmp_path / "extracted")
    shipped = _shipped(data_sync_at, tmp_path)
    assert _layout(shipped) == "rowid" and _dump(shipped) == _dump(src)


# ── C4 ───────────────────────────────────────────────────────────────────────
class _FakeR2:
    """head_object / get_object over one local tarball; counts downloads."""

    def __init__(self, tar_path, meta, fail_download=False):
        self.tar_path, self.meta, self.fail = tar_path, meta, fail_download
        self.downloads = 0
        self.uploaded = []

    def head_object(self, Bucket, Key):
        return {"Metadata": dict(self.meta)}

    def get_object(self, Bucket, Key):
        self.downloads += 1
        if self.fail:
            raise OSError("simulated network failure")
        return {"Body": open(self.tar_path, "rb")}

    def upload_file(self, path, bucket, key, ExtraArgs=None):
        self.uploaded.append((key, ExtraArgs))

    def put_object(self, **kw):
        pass

    def list_objects_v2(self, **kw):
        return {"Contents": []}


def _tar_of(db_path, out_tar):
    with tarfile.open(out_tar, "w:gz") as t:
        t.add(db_path, arcname="bars.db")


@pytest.fixture
def adoption(tmp_path, data_sync_at, monkeypatch):
    """A pod holding a ROWID store with local-only newer rows, and an R2 whose latest base
    is a CLUSTERED conversion of an older copy of that store."""
    from api.services import bars_cluster
    ds = data_sync_at
    base_src = tmp_path / "worker.db"
    _rowid_store(base_src, seed=7, tickers=6, n=40)
    snap = tmp_path / "snap.db"
    bars_cluster.cluster_copy(str(base_src), str(snap))
    tar = tmp_path / "snap.tar.gz"
    _tar_of(snap, tar)
    local = tmp_path / "bars.db"
    shutil.copy(base_src, local)
    c = sqlite3.connect(str(local))       # rows only this pod holds (live store, heals)
    c.executemany("INSERT INTO ohlcv VALUES (?,?,?,?,?,?,?,?)",
                  [("T00", "5", 1_700_000_100 + (40 + k) * 300, 10.0, 11.0, 9.0, 10.5, 7)
                   for k in range(5)] + [("NEWT", "D", 20210104, 5.0, 6.0, 4.0, 5.5, 9)])
    c.commit(); c.close()
    fake = _FakeR2(str(tar), {"bars-layout": "clustered",
                              "bars-db-bytes": str(os.path.getsize(snap))})
    monkeypatch.setattr(ds, "_client", lambda: fake)
    monkeypatch.setattr(ds, "_bucket", lambda: "b")
    monkeypatch.setattr(ds, "get_latest_snapshot_ts", lambda: "1700000000")
    monkeypatch.setenv("BARS_ADOPT_CLUSTERED", "1")
    return ds, fake, local, snap


def _no_tmp_left(tmp_path):
    return not [p for p in tmp_path.iterdir() if p.name.startswith("adopt_")]


def test_adoption_swaps_in_a_verified_clustered_store_carrying_local_rows(adoption, tmp_path):
    ds, fake, local, snap = adoption
    (tmp_path / ".last_delta_ts").write_text("1700009999" + chr(10) + "1" + chr(10))
    want = set(_dump(snap)["ohlcv"]) | set(_dump(local)["ohlcv"])
    assert ds.adopt_clustered_store(str(tmp_path)) == "adopted"
    assert _layout(local) == "clustered"
    assert set(_dump(local)["ohlcv"]) == want, "a row only this pod held was lost"
    assert (tmp_path / ".adopted_clustered").exists()
    assert ds._read_marker(ds._LAST_SYNC_MARKER)["snapshot_ts"] == "1700000000"
    assert not (tmp_path / ".last_delta_ts").exists(), "deltas after the base must re-apply"
    assert _no_tmp_left(tmp_path)
    # One-shot: the next boot neither downloads nor touches the store.
    assert ds.adopt_clustered_store(str(tmp_path)) == "done" and fake.downloads == 1


def test_deltas_newer_than_the_base_re_apply_after_adoption(adoption, tmp_path, monkeypatch):
    ds, fake, local, snap = adoption
    (tmp_path / ".last_delta_ts").write_text("1700009999" + chr(10) + "1" + chr(10))   # the OLD store's progress
    assert ds.adopt_clustered_store(str(tmp_path)) == "adopted"
    applied = []
    monkeypatch.setattr(ds, "_list_remote_deltas", lambda: ["1700000500", "1700009000"])
    monkeypatch.setattr(ds, "apply_delta", lambda ts: applied.append(ts) or True)
    monkeypatch.setattr(ds, "merge_snapshot", lambda ts: pytest.fail("base re-merged"))
    ds.sync_with_deltas()
    assert applied == ["1700000500", "1700009000"]


def test_no_adoption_when_the_latest_base_is_rowid(adoption, tmp_path):
    ds, fake, local, snap = adoption
    fake.meta = {"bars-layout": "rowid"}
    before = _dump(local)
    assert ds.adopt_clustered_store(str(tmp_path)) == "snapshot-rowid"
    assert fake.downloads == 0 and _layout(local) == "rowid" and _dump(local) == before
    assert not (tmp_path / ".adopted_clustered").exists()        # retried once a base is
    fake.meta = {}                                                # an untagged (old) base
    assert ds.adopt_clustered_store(str(tmp_path)) == "snapshot-rowid"


@pytest.mark.parametrize("break_it", ["download", "disk", "rows", "integrity"])
def test_any_failure_keeps_the_old_store_untouched(adoption, tmp_path, monkeypatch, break_it):
    ds, fake, local, snap = adoption
    before = _dump(local)
    if break_it == "download":
        fake.fail = True
    elif break_it == "disk":
        monkeypatch.setattr(ds.shutil, "disk_usage", lambda _p: type("u", (), {"free": 1})())
    elif break_it == "rows":
        monkeypatch.setattr(ds, "ADOPT_MIN_ROW_RATIO", 10.0)
    else:
        monkeypatch.setattr(ds, "_verify_snapshot_db", lambda _p: False)
    assert ds.adopt_clustered_store(str(tmp_path)) in ("failed", "no-disk")
    assert _layout(local) == "rowid" and _dump(local) == before
    assert not (tmp_path / ".adopted_clustered").exists() and _no_tmp_left(tmp_path)


def test_adoption_is_off_by_default_and_syncs_stand_aside_while_it_runs(adoption, tmp_path,
                                                                        monkeypatch):
    ds, fake, local, snap = adoption
    monkeypatch.delenv("BARS_ADOPT_CLUSTERED")
    assert ds.adopt_clustered_store(str(tmp_path)) == "off" and fake.downloads == 0
    ds._adoption_active.set()
    try:
        assert ds.sync_with_deltas() is None
        assert ds.sync_if_newer_merge() is None
        assert ds.sync_if_newer() is None
    finally:
        ds._adoption_active.clear()


def test_the_upload_tags_the_snapshot_layout(tmp_path, data_sync_at, monkeypatch):
    ds = data_sync_at
    src = tmp_path / "bars.db"
    _rowid_store(src)
    _big_enough(ds, src)
    fake = _FakeR2(None, {})
    monkeypatch.setattr(ds, "_client", lambda: fake)
    monkeypatch.setattr(ds, "_bucket", lambda: "b")
    assert ds.upload_snapshot(force=True)
    (_key, extra), = fake.uploaded
    assert extra["Metadata"]["bars-layout"] == "clustered"
    assert int(extra["Metadata"]["bars-db-bytes"]) > 0


def test_clustered_store_stays_clustered_through_init_merge_and_delta(tmp_path, monkeypatch):
    """After a wholesale install of a clustered snapshot, no write path turns `ohlcv`
    back into a rowid table: init_db, the newer-wins merge of a ROWID snapshot, and the
    delta export (which builds its own file from the one DDL)."""
    from api.services import bars_cluster
    rowid_snap = tmp_path / "snap_rowid.db"
    _rowid_store(rowid_snap, seed=1)
    live_dir = tmp_path / "live"
    live_dir.mkdir()
    bars_cluster.cluster_copy(str(rowid_snap), str(live_dir / "bars.db"))  # "installed"
    monkeypatch.setenv("DATA_DIR", str(live_dir))
    from api.services import bars_sqlite, data_sync
    importlib.reload(bars_sqlite)
    importlib.reload(data_sync)
    try:
        bars_sqlite.init_db()
        assert _layout(live_dir / "bars.db") == "clustered"
        other = tmp_path / "snap2.db"
        _rowid_store(other, seed=2, tickers=14)
        assert data_sync._merge_ohlcv_from(str(other)) >= 0
        assert _layout(live_dir / "bars.db") == "clustered"
        out = tmp_path / "delta.db"
        data_sync._export_delta_db(str(out), now=1_700_000_100 + 30 * 300)
        assert _layout(out) == "clustered"
    finally:
        bars_sqlite._drop_local_conn()
        monkeypatch.undo()
        importlib.reload(bars_sqlite)
        importlib.reload(data_sync)


# ── C5 ───────────────────────────────────────────────────────────────────────
def _plans(db_dir, monkeypatch) -> dict:
    """{sql: [plan detail lines]} for every statement the hot bars_sqlite reads issue."""
    monkeypatch.setenv("DATA_DIR", str(db_dir))
    from api.services import bars_sqlite as bs
    importlib.reload(bs)
    seen = []
    conn = bs._conn()
    conn.set_trace_callback(seen.append)
    try:
        bs.get_bars("T01", "5", 600)
        bs.get_bars_before("T01", "5", 600, 1_700_009_999)
        bs.get_bars_since("T01", "5", 1_700_000_000)
        bs.get_last_ts("T01", "D")
        bs.get_first_ts("T01", "D")
        bs.get_count("T01", "1")
        list(bs.iter_ts_close("T01", "1", batch=10))
        bs.closes_asof(["T01", "T02"], 20200120, 20200101)
        bs.closes_near_date(20200120, 20200101)
        bs.max_daily_volume_in_range(20200101, 20200120)
        bs.nth_recent_trading_date(3, 20200130)
    finally:
        conn.set_trace_callback(None)
    out = {}
    for sql in seen:
        if not sql.lstrip().upper().startswith(("SELECT", "WITH")):
            continue
        q = re.sub(r"\b\d+\b|'[^']*'", "?", sql)
        try:
            out[q] = [r[-1] for r in conn.execute("EXPLAIN QUERY PLAN " + sql)]
        except sqlite3.Error:
            continue
    bs._drop_local_conn()
    return out


def _full_scans(lines) -> list:
    return [l for l in lines if re.match(r"SCAN (ohlcv|o\b|b\b)", l) and "USING" not in l]


def test_hot_queries_never_full_scan_a_clustered_store(tmp_path, monkeypatch):
    from api.services import bars_cluster
    r_dir, c_dir = tmp_path / "r", tmp_path / "c"
    r_dir.mkdir(); c_dir.mkdir()
    _rowid_store(r_dir / "bars.db", tickers=5)
    bars_cluster.cluster_copy(str(r_dir / "bars.db"), str(c_dir / "bars.db"))
    rowid_plans = _plans(r_dir, monkeypatch)
    clustered_plans = _plans(c_dir, monkeypatch)
    assert len(clustered_plans) >= 8, clustered_plans.keys()          # the probe ran
    regressions = {q: p for q, p in clustered_plans.items()
                   if _full_scans(p) and not _full_scans(rowid_plans.get(q, ["SCAN ohlcv"]))}
    assert not regressions, regressions
    get_bars = [p for q, p in clustered_plans.items()
                if "ORDER BY ts DESC LIMIT" in q and re.search(r"ticker\s*=\s*\?", q)]
    assert get_bars and all(any("PRIMARY KEY" in l for l in p) for p in get_bars), get_bars
    monkeypatch.undo()
    from api.services import bars_sqlite
    importlib.reload(bars_sqlite)


# ── C6 ───────────────────────────────────────────────────────────────────────
_OHLCV_DDL = re.compile(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:\w+\.)?ohlcv\b", re.I)


def test_ohlcv_ddl_is_the_only_bar_table_ddl():
    """A second `CREATE TABLE ohlcv` could write a rowid table into a serving store (or a
    snapshot) and silently undo the clustered layout."""
    offenders = []
    for path in (REPO / "api").rglob("*.py"):
        if path.name.endswith("_test.py") or path.name.startswith("test_"):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if "ohlcv" not in text:
            continue
        for node in ast.walk(ast.parse(text)):
            if isinstance(node, ast.Constant) and isinstance(node.value, str) \
                    and _OHLCV_DDL.search(node.value):
                offenders.append(f"{path.relative_to(REPO)}:{node.lineno}")
    assert offenders == [], f"ohlcv DDL outside bars_sqlite.ohlcv_ddl: {offenders}"
