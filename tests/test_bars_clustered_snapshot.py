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
import json
import os
import random
import re
import shutil
import sqlite3
import time
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
    from api.services import bars_sqlite, data_sync
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    importlib.reload(bars_sqlite)
    importlib.reload(data_sync)
    yield data_sync
    bars_sqlite._drop_local_conn()
    monkeypatch.undo()
    importlib.reload(bars_sqlite)
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


def test_snapshot_clustering_is_off_unless_enabled(data_sync_at, monkeypatch):
    monkeypatch.delenv("SNAPSHOT_CLUSTER", raising=False)
    importlib.reload(data_sync_at)
    assert data_sync_at.SNAPSHOT_CLUSTER is False, "an owner-approved rollout step"
    monkeypatch.setenv("SNAPSHOT_CLUSTER", "1")
    importlib.reload(data_sync_at)
    assert data_sync_at.SNAPSHOT_CLUSTER is True


def test_snapshot_ships_clustered_with_every_index(tmp_path, data_sync_at, monkeypatch):
    from api.services import bars_sqlite as bs
    monkeypatch.setattr(data_sync_at, "SNAPSHOT_CLUSTER", True)
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
    monkeypatch.setattr(ds, "in_quiet_window", lambda now=None: True)
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
    monkeypatch.setattr(ds, "SNAPSHOT_CLUSTER", True)
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


# ── adoption: quiet window, two-pass carry, locked budget, swap lock ────────────
def test_adoption_never_runs_outside_the_quiet_window(adoption, tmp_path, monkeypatch):
    ds, fake, local, snap = adoption
    monkeypatch.setattr(ds, "in_quiet_window", lambda now=None: False)
    before = _dump(local)
    assert ds.adopt_clustered_store(str(tmp_path)) == "not-quiet"
    assert fake.downloads == 0 and _dump(local) == before


def test_the_owner_override_adopts_outside_the_quiet_window(adoption, tmp_path, monkeypatch):
    ds, fake, local, snap = adoption
    monkeypatch.setattr(ds, "in_quiet_window", lambda now=None: False)
    monkeypatch.setenv("BARS_ADOPT_IGNORE_WINDOW", "1")
    assert ds.adopt_clustered_store(str(tmp_path)) == "adopted"


# ── BARS_REINSTALL_TOKEN: re-install over a clustered but partial store ─────────
def test_reinstall_token_replaces_a_partial_clustered_store_once(adoption, tmp_path,
                                                                 monkeypatch):
    ds, fake, local, snap = adoption
    from api.services import bars_cluster
    partial = tmp_path / "partial.db"                  # clustered, only a few rows
    c = sqlite3.connect(str(partial)); c.execute(ds_ohlcv_ddl()); c.execute(
        "INSERT INTO ohlcv VALUES ('ONLYHERE','D',20261113,1,2,0.5,1.5,9)"); c.commit(); c.close()
    os.replace(partial, local)
    (tmp_path / ".adopted_clustered").write_text("local")
    monkeypatch.delenv("BARS_ADOPT_CLUSTERED", raising=False)
    assert ds.adopt_clustered_store(str(tmp_path)) == "off"            # no token: untouched
    monkeypatch.setenv("BARS_REINSTALL_TOKEN", "r1")
    assert ds.adopt_clustered_store(str(tmp_path)) == "adopted"
    c = sqlite3.connect(str(local))
    n = c.execute("SELECT COUNT(*) FROM ohlcv").fetchone()[0]
    kept = c.execute("SELECT COUNT(*) FROM ohlcv WHERE ticker='ONLYHERE'").fetchone()[0]
    c.close()
    assert n > 100 and kept == 1                        # the base AND the local-only row
    assert ds.adopt_clustered_store(str(tmp_path)) == "off" and fake.downloads == 1  # token spent
    monkeypatch.setenv("BARS_REINSTALL_TOKEN", "r2")   # a new token runs again
    assert ds.adopt_clustered_store(str(tmp_path)) == "adopted" and fake.downloads == 2


def ds_ohlcv_ddl():
    from api.services import bars_sqlite
    return bars_sqlite.ohlcv_ddl()


# ── adoption survives restarts (web, 2026-11-13: a deploy killed it twice) ──────
def test_a_dead_runs_working_folder_is_swept_before_the_disk_check(adoption, tmp_path,
                                                                   monkeypatch):
    """An interrupted adoption leaves ~20 GB behind; the next attempt must reclaim it,
    not fail its disk check forever."""
    ds, fake, local, snap = adoption
    stale = tmp_path / "adopt_0d5176vf"                 # mkdtemp-named leftover
    stale.mkdir()
    (stale / "bars.db").write_bytes(b"x" * 4096)
    old_ts = tmp_path / "adopt_1600000000"             # a different snapshot's leftover
    old_ts.mkdir()
    (old_ts / ".verified").write_text("1600000000")
    (old_ts / "bars.db").write_bytes(b"y" * 4096)
    seen = {}
    real_usage = ds.shutil.disk_usage

    def usage(path):
        seen["left"] = sorted(q.name for q in tmp_path.iterdir() if q.name.startswith("adopt_"))
        return real_usage(path)
    monkeypatch.setattr(ds.shutil, "disk_usage", usage)
    assert ds.adopt_clustered_store(str(tmp_path)) == "adopted"
    assert seen["left"] == []                           # swept BEFORE free space was read
    assert _no_tmp_left(tmp_path)


def test_a_restart_after_verification_resumes_without_downloading_again(adoption, tmp_path,
                                                                        monkeypatch):
    ds, fake, local, snap = adoption
    work = tmp_path / "adopt_1700000000"               # what a killed run leaves behind
    work.mkdir()
    shutil.copy(snap, work / "bars.db")
    (work / ".verified").write_text("1700000000")
    monkeypatch.setattr(ds, "_verify_snapshot_db",
                        lambda _p: pytest.fail("a verified download is not re-verified"))
    assert ds.adopt_clustered_store(str(tmp_path)) == "adopted"
    assert fake.downloads == 0
    assert _layout(local) == "clustered" and _no_tmp_left(tmp_path)
    c = sqlite3.connect(str(local))                     # the local-only rows still carried
    assert c.execute("SELECT COUNT(*) FROM ohlcv WHERE ticker='NEWT'").fetchone()[0] == 1
    c.close()


def test_a_partial_download_is_not_resumed(adoption, tmp_path):
    ds, fake, local, snap = adoption
    work = tmp_path / "adopt_1700000000"               # killed mid-extract: no .verified
    work.mkdir()
    (work / "bars.db").write_bytes(b"torn")
    assert ds.adopt_clustered_store(str(tmp_path)) == "adopted"
    assert fake.downloads == 1 and _layout(local) == "clustered"


def test_a_second_concurrent_call_never_touches_the_running_adoption(adoption, tmp_path):
    ds, fake, local, snap = adoption
    assert ds._ADOPT_RUN_LOCK.acquire(blocking=False)
    try:
        keep = tmp_path / "adopt_1700000000"
        keep.mkdir()
        assert ds.adopt_clustered_store(str(tmp_path)) == "busy"
        assert keep.exists() and fake.downloads == 0
    finally:
        ds._ADOPT_RUN_LOCK.release()


@pytest.mark.parametrize("utc,quiet", [
    ("2026-11-11T14:30", False), ("2026-11-11T09:00", False), ("2026-11-12T00:59", False),
    ("2026-11-12T01:30", True), ("2026-11-12T08:00", True), ("2026-11-12T08:50", False),
    ("2026-11-14T17:00", True), ("2026-11-16T07:00", True),
])
def test_quiet_window(utc, quiet):
    from datetime import datetime, timezone
    from api.services import data_sync
    assert data_sync.in_quiet_window(
        datetime.fromisoformat(utc).replace(tzinfo=timezone.utc)) is quiet


def _write_during_pass_one(ds, monkeypatch, row):
    """Wrap the merge so the pod writes `row` (through put_bars) while pass 1 runs, and
    record every merge call's `pairs`."""
    from api.services import bars_sqlite
    real = ds._merge_ohlcv_from
    calls = []

    def merge(src, local=None, **kw):
        calls.append(kw.get("pairs"))
        if len(calls) == 1:
            tkr, tf, ts = row
            bars_sqlite.put_bars(tkr, tf, [{"t": ts, "o": 5.0, "h": 6.0, "l": 4.0, "c": 5.5,
                                            "v": 9}])
        return real(src, local, **kw)

    monkeypatch.setattr(ds, "_merge_ohlcv_from", merge)
    return calls


def test_locked_pass_carries_only_series_written_during_pass_one(adoption, tmp_path,
                                                                 monkeypatch):
    ds, fake, local, snap = adoption
    row = ("LATE", "D", 20210105)
    calls = _write_during_pass_one(ds, monkeypatch, row)
    assert ds.adopt_clustered_store(str(tmp_path)) == "adopted"
    assert calls[0] is None, "pass 1 is the full merge"
    assert calls[1] == [("LATE", "D")], "the locked pass re-merges only what changed"
    c = sqlite3.connect(str(local))
    try:
        assert c.execute("SELECT COUNT(*) FROM ohlcv WHERE ticker=? AND tf=? AND ts=?",
                         row).fetchone()[0] == 1, "a write during pass 1 was lost"
    finally:
        c.close()


def test_locked_pass_over_budget_aborts_and_keeps_the_old_store(adoption, tmp_path,
                                                               monkeypatch):
    ds, fake, local, snap = adoption
    _write_during_pass_one(ds, monkeypatch, ("LATE", "D", 20210105))
    monkeypatch.setattr(ds, "ADOPT_LOCKED_BUDGET_S", -1.0)
    before_layout = _layout(local)
    assert ds.adopt_clustered_store(str(tmp_path)) == "failed"
    assert before_layout == _layout(local) == "rowid"
    assert not (tmp_path / ".adopted_clustered").exists()
    from api.services import bars_sqlite
    assert bars_sqlite._tracked_writes is None, "tracking must never be left on"
    # The verified download is KEPT (worker, 2026-11-14: re-downloading 19.5 GB per try)
    assert (tmp_path / "adopt_1700000000" / ".verified").exists()
    monkeypatch.setattr(ds, "ADOPT_LOCKED_BUDGET_S", 10.0)
    assert ds.adopt_clustered_store(str(tmp_path)) == "adopted"
    assert fake.downloads == 1, "the retry resumed instead of downloading again"
    assert _no_tmp_left(tmp_path)


def test_catch_up_rounds_shrink_a_busy_pods_remainder_before_the_lock(adoption, tmp_path,
                                                                       monkeypatch):
    """A pod writing to many series during the full carry: the unlocked rounds re-carry
    them, so the locked pass only sees the final small remainder."""
    from api.services import bars_sqlite
    ds, fake, local, snap = adoption
    real = ds._merge_ohlcv_from
    calls = []
    bar = [{"t": 20210105, "o": 5.0, "h": 6.0, "l": 4.0, "c": 5.5, "v": 9}]

    def merge(src, local_db=None, **kw):
        calls.append(kw.get("pairs"))
        n = len(calls)
        if n == 1:          # the full carry: 40 series written meanwhile
            for k in range(40):
                bars_sqlite.put_bars(f"B{k:02d}", "D", bar)
        elif n == 2 and not bars_sqlite._WRITE_LOCK.locked():   # round 1: only 2 more
            bars_sqlite.put_bars("Z1", "D", bar)
            bars_sqlite.put_bars("Z2", "D", bar)
        return real(src, local_db, **kw)

    monkeypatch.setattr(ds, "_merge_ohlcv_from", merge)
    monkeypatch.setattr(ds, "ADOPT_LOCKED_PAIRS_TARGET", 5)
    assert ds.adopt_clustered_store(str(tmp_path)) == "adopted"
    assert calls[0] is None and len(calls[1]) == 40, "round 1 re-carries the 40"
    assert calls[2] == [("Z1", "D"), ("Z2", "D")], "the locked pass gets only the remainder"
    c = sqlite3.connect(str(local))
    assert c.execute("SELECT COUNT(*) FROM ohlcv WHERE ticker IN ('B07','Z2')").fetchone()[0] == 2
    c.close()


def _hold_read_txn(path, seconds):
    """Open a read transaction on `path` (pins the WAL) and keep it `seconds`."""
    import threading
    ready = threading.Event()

    def run():
        c = sqlite3.connect(str(path), check_same_thread=False)
        c.execute("BEGIN")
        c.execute("SELECT COUNT(*) FROM ohlcv").fetchone()
        ready.set()
        time.sleep(seconds)
        c.rollback(); c.close()
    th = threading.Thread(target=run, daemon=True)
    th.start()
    assert ready.wait(5)
    return th


def _wal_frames(path):
    c = sqlite3.connect(str(path))
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("INSERT OR REPLACE INTO ohlcv VALUES ('WALX','D',20210106,1,2,0.5,1.5,1)")
    c.commit(); c.close()


def test_truncate_checkpoint_waits_out_a_long_reader(tmp_path):
    """One 30 s wait was not enough on the worker; the swap now retries within a budget."""
    import api.services.data_sync as ds
    db = tmp_path / "x.db"
    c = sqlite3.connect(str(db)); c.execute(
        "CREATE TABLE ohlcv (ticker TEXT, tf TEXT, ts INTEGER, o REAL, h REAL, l REAL, "
        "c REAL, v INTEGER, PRIMARY KEY (ticker, tf, ts))"); c.commit(); c.close()
    _wal_frames(db)
    th = _hold_read_txn(db, 2.5)
    _wal_frames(db)                                     # frames the reader pins
    t0 = time.monotonic()
    assert ds._truncate_checkpoint(str(db), 20) is True
    assert time.monotonic() - t0 >= 1.5, "it must have waited for the reader"
    th.join(5)
    assert (not os.path.exists(str(db) + "-wal")) or os.path.getsize(str(db) + "-wal") == 0


def test_truncate_checkpoint_gives_up_at_its_budget(tmp_path):
    import api.services.data_sync as ds
    db = tmp_path / "x.db"
    c = sqlite3.connect(str(db)); c.execute(
        "CREATE TABLE ohlcv (ticker TEXT, tf TEXT, ts INTEGER, o REAL, h REAL, l REAL, "
        "c REAL, v INTEGER, PRIMARY KEY (ticker, tf, ts))"); c.commit(); c.close()
    _wal_frames(db)
    th = _hold_read_txn(db, 6)
    _wal_frames(db)
    t0 = time.monotonic()
    assert ds._truncate_checkpoint(str(db), 1.0) is False
    assert time.monotonic() - t0 < 5
    th.join(8)


def test_swap_write_tracking_has_no_gap(data_sync_at):
    from api.services import bars_sqlite
    bars_sqlite.init_db()
    bar = [{"t": 20210105, "o": 5.0, "h": 6.0, "l": 4.0, "c": 5.5, "v": 9}]
    bars_sqlite.start_write_tracking()
    bars_sqlite.put_bars("AAA", "D", bar)
    assert bars_sqlite.swap_write_tracking() == {("AAA", "D")}
    bars_sqlite.put_bars("BBB", "D", bar)
    assert bars_sqlite.stop_write_tracking() == {("BBB", "D")}
    assert bars_sqlite.swap_write_tracking() == set() and bars_sqlite._tracked_writes is None


def test_put_bars_records_pairs_only_while_tracking(data_sync_at):
    from api.services import bars_sqlite
    bars_sqlite.init_db()
    bar = [{"t": 20210105, "o": 5.0, "h": 6.0, "l": 4.0, "c": 5.5, "v": 9}]
    bars_sqlite.put_bars("AAA", "D", bar)
    bars_sqlite.start_write_tracking()
    bars_sqlite.put_bars("BBB", "D", bar)
    bars_sqlite.put_bars_many("D", {"CCC": bar, "DDD": bar})
    assert bars_sqlite.stop_write_tracking() == {("BBB", "D"), ("CCC", "D"), ("DDD", "D")}
    bars_sqlite.put_bars("EEE", "D", bar)
    assert bars_sqlite.stop_write_tracking() == set()


def test_checkpointer_waits_for_a_swap_and_reconnects_after_it(data_sync_at, tmp_path):
    import threading
    from api.services import bars_sqlite, bars_wal_checkpointer as ck
    bars_sqlite.init_db()
    state = {"conn": None, "epoch": None}
    ck._cycle(state)
    first = state["conn"]
    n0 = ck.last_status()["cycles"]
    bars_sqlite.DB_SWAP_LOCK.acquire()
    try:
        t = threading.Thread(target=ck._cycle, args=(state,))
        t.start()
        t.join(0.5)
        assert t.is_alive() and ck.last_status()["cycles"] == n0, \
            "the checkpointer ran while a swap held DB_SWAP_LOCK"
        bars_sqlite.bump_db_epoch()            # the swap replaced bars.db
    finally:
        bars_sqlite.DB_SWAP_LOCK.release()
    t.join(5)
    assert ck.last_status()["cycles"] == n0 + 1
    assert state["conn"] is not first, "a connection on the old inode checkpointed again"
    state["conn"].close()


def test_adoption_voids_every_proof_and_moves_every_rev(adoption, tmp_path):
    """Bar contract (#1098): the swapped-in store is a NEW store — its series_meta came
    from the snapshot producer — so the adoption bumps the store floor: every proof /
    seal taken before it is void and every served rev passes what a client holds."""
    import time as _t
    from api.services import bars_sqlite
    ds, fake, local, snap = adoption
    before_s, before_ms = _t.time(), int(_t.time() * 1000)
    assert ds.adopt_clustered_store(str(tmp_path)) == "adopted"
    assert bars_sqlite._mem_floors[bars_sqlite.PROOF_FLOOR_KEY] >= before_s
    assert bars_sqlite.series_meta("T00", "5")["rev"] >= before_ms
    bars_sqlite.record_verified("T00", "5", before_s - 1)       # a proof from before
    assert bars_sqlite.series_meta("T00", "5")["verified_through"] is None


# ── a busy old store: the swap is deferred to the next boot ─────────────────────
class _Exited(BaseException):
    """Stands in for os._exit in tests (BaseException: nothing in the code catches it)."""


def _busy_old_store(ds, monkeypatch, local):
    real = ds._truncate_checkpoint

    def ckpt(path, budget):
        if os.path.abspath(path) == os.path.abspath(str(local)):
            return False                     # a reader that never lets go
        return real(path, budget)
    monkeypatch.setattr(ds, "_truncate_checkpoint", ckpt)
    return real


def test_a_busy_swap_is_deferred_and_finished_at_boot(adoption, tmp_path, monkeypatch):
    ds, fake, local, snap = adoption
    row = ("LATE", "D", 20210105)
    _write_during_pass_one(ds, monkeypatch, row)
    real = _busy_old_store(ds, monkeypatch, local)

    def exit_now():
        raise _Exited()
    with pytest.raises(_Exited):
        ds.adopt_clustered_store(str(tmp_path), defer_swap=exit_now)
    work = tmp_path / "adopt_1700000000"
    assert _layout(local) == "rowid", "the old store is still the live one"
    assert (work / ".swap_at_boot").exists() and (work / ".pending_pairs.json").exists()
    assert ["LATE", "D"] in json.loads((work / ".pending_pairs.json").read_text())
    from api.services import bars_sqlite
    assert bars_sqlite._tracked_writes is None

    # the next boot: a fresh process, nothing has opened bars.db yet
    bars_sqlite._drop_local_conn()
    monkeypatch.setattr(ds, "_truncate_checkpoint", real)
    assert ds.complete_deferred_swap(str(tmp_path)) == "adopted"
    assert _layout(local) == "clustered" and _no_tmp_left(tmp_path)
    assert (tmp_path / ".adopted_clustered").exists()
    c = sqlite3.connect(str(local))
    assert c.execute("SELECT COUNT(*) FROM ohlcv WHERE ticker=? AND tf=? AND ts=?",
                     row).fetchone()[0] == 1, "a write during pass 1 was lost"
    assert c.execute("SELECT COUNT(*) FROM ohlcv WHERE ticker='NEWT'").fetchone()[0] == 1
    c.close()
    assert ds.adopt_clustered_store(str(tmp_path)) == "done"
    assert ds.complete_deferred_swap(str(tmp_path)) == "none"


def test_a_deferral_whose_process_lives_on_is_withdrawn(adoption, tmp_path, monkeypatch):
    """If the exit callback returns, writers resume untracked; a boot swap would then lose
    their rows, so the deferral must not survive."""
    ds, fake, local, snap = adoption
    _busy_old_store(ds, monkeypatch, local)
    assert ds.adopt_clustered_store(str(tmp_path), defer_swap=lambda: None) == "failed"
    work = tmp_path / "adopt_1700000000"
    assert not (work / ".swap_at_boot").exists()
    assert (work / ".verified").exists(), "the verified copy is kept for a resume"
    assert ds.complete_deferred_swap(str(tmp_path)) == "none"
    assert _layout(local) == "rowid"


def test_busy_without_a_defer_callback_fails_as_before(adoption, tmp_path, monkeypatch):
    ds, fake, local, snap = adoption
    _busy_old_store(ds, monkeypatch, local)
    assert ds.adopt_clustered_store(str(tmp_path)) == "failed"
    assert not (tmp_path / "adopt_1700000000" / ".swap_at_boot").exists()
    assert _layout(local) == "rowid"


def test_boot_swap_with_nothing_pending_does_nothing(tmp_path):
    import api.services.data_sync as ds
    (tmp_path / "adopt_1700000000").mkdir()             # a kept copy, no deferral
    assert ds.complete_deferred_swap(str(tmp_path)) == "none"
    assert (tmp_path / "adopt_1700000000").exists()
