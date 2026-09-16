"""THE RESTORE PATH — and every way it must REFUSE.

⭐⭐ THE CLAIM UNDER TEST: `breadth_restore` can put a known snapshot back, and cannot
be made to install one it could not validate. Until BL-030 there was no mechanism at
all — `breadth_ohlc_sync` is an ADDITIVE gap-fill merge that can never remove a row, so
"restore the database" was a runbook sentence with no code under it.

⛔ THE REFUSALS ARE THE POINT. A restore that installs a corrupt, truncated, wrong-shaped
or universe-destroying snapshot is worse than no restore, because it bakes the failure in
and destroys the thing you were trying to recover. Every refusal here is also checked to
have left the live database EXACTLY as it was.
"""
import os
import sqlite3

import pytest

from api.services import breadth_daily_ohlc as store
from api.services import breadth_restore as br

OLD_SCHEMA = """CREATE TABLE breadth_daily_ohlc (
    date TEXT NOT NULL, metric TEXT NOT NULL,
    o REAL, h REAL, l REAL, c REAL,
    source TEXT DEFAULT 'live', updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (date, metric))"""


def _fingerprint(path, uct_only=True):
    c = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
    cols = [r[1] for r in c.execute("PRAGMA table_info(breadth_daily_ohlc)")]
    where = "WHERE universe='uct' " if (uct_only and "universe" in cols) else ""
    import hashlib
    h, n = hashlib.sha256(), 0
    for row in c.execute("SELECT date, metric, o, h, l, c, source FROM "
                         "breadth_daily_ohlc %sORDER BY date, metric" % where):
        h.update(repr(row).encode()); n += 1
    c.close()
    return h.hexdigest(), n


def _rows(n, metric="pct_above_50sma", start=0):
    """`n` synthetic sessions — enough to clear MIN_OHLC_ROWS when asked."""
    out = []
    for i in range(start, start + n):
        out.append(("2008-01-02", "%s_%d" % (metric, i), 1.0, 2.0, 0.5, 1.5))
    return out


@pytest.fixture()
def live(tmp_path, monkeypatch):
    """A migrated live store holding a bit over the refusal floor, all UCT."""
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "live.db"))
    store._INIT_DONE = False
    store._ensure_init()
    store.write_bulk(_rows(br.MIN_OHLC_ROWS + 10), source="close_recon", universe="uct")
    yield str(tmp_path / "live.db")
    store._INIT_DONE = False


def _snapshot(path, *, migrated=True, n=None, universes=("uct",), table=True):
    n = br.MIN_OHLC_ROWS + 10 if n is None else n
    c = sqlite3.connect(path)
    if not table:
        c.execute("CREATE TABLE something_else(x)")
        c.commit(); c.close(); return path
    if migrated:
        c.execute("""CREATE TABLE breadth_daily_ohlc (
            universe TEXT NOT NULL DEFAULT 'uct', date TEXT NOT NULL,
            metric TEXT NOT NULL, o REAL, h REAL, l REAL, c REAL,
            source TEXT DEFAULT 'live', updated_at TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (universe, date, metric))""")
        for u in universes:
            c.executemany(
                "INSERT INTO breadth_daily_ohlc(universe,date,metric,o,h,l,c,source) "
                "VALUES(?,?,?,?,?,?,?,'close_recon')",
                [(u,) + r for r in _rows(n)])
    else:
        c.execute(OLD_SCHEMA)
        c.executemany(
            "INSERT INTO breadth_daily_ohlc(date,metric,o,h,l,c,source) "
            "VALUES(?,?,?,?,?,?,'close_recon')", _rows(n))
    c.commit(); c.close()
    return path


# ── PART A · it works ────────────────────────────────────────────────────────

def test_a_pre_migration_snapshot_restores_and_lands_as_uct(live, tmp_path):
    """⭐ THE ROLLBACK CASE, AND IT IS THE NORMAL ONE. The artifact we hold predates the
    universe column, so its rows are UCT by definition — and the restore must agree with
    `breadth_ohlc_sync._merge_from`, which already resolves a column-less snapshot to the
    literal 'uct', rather than inventing a second rule for the same fact."""
    snap = _snapshot(str(tmp_path / "old.db"), migrated=False, n=500 + br.MIN_OHLC_ROWS)
    res = br.restore_from_db(snap)
    assert res["installed"] is True
    assert res["snapshot"]["migrated"] is False
    assert res["live_after"] == {"uct": br.MIN_OHLC_ROWS + 500}
    with store._conn() as c:
        assert c.execute("SELECT COUNT(*) FROM breadth_daily_ohlc "
                         "WHERE universe<>'uct'").fetchone()[0] == 0


def test_b_the_live_inode_is_the_SAME_FILE_afterwards(live, tmp_path):
    """⛔ THE DESIGN DECISION, PINNED. `data_sync` installs bars.db with `shutil.move`
    and its own comment records why the sidecars are then left alone: deleting them
    gave writers "disk I/O error". Breadth sidesteps the whole class by never moving the
    file — so if anyone ever 'simplifies' this into a move, this test says no."""
    before = os.stat(live)
    snap = _snapshot(str(tmp_path / "s.db"))
    br.restore_from_db(snap)
    after = os.stat(live)
    assert (before.st_ino, before.st_dev) == (after.st_ino, after.st_dev), (
        "the restore replaced the FILE; it must replace the CONTENT — a moved file "
        "orphans the -wal/-shm sidecars beside a fresh main database")


def test_c_restoring_the_same_snapshot_twice_is_idempotent(live, tmp_path):
    snap = _snapshot(str(tmp_path / "s.db"))
    br.restore_from_db(snap)
    one = _fingerprint(live)
    br.restore_from_db(snap)
    assert _fingerprint(live) == one


def test_d_the_reconstructed_table_is_restored_too(live, tmp_path):
    snap = _snapshot(str(tmp_path / "s.db"))
    c = sqlite3.connect(snap)
    c.execute("CREATE TABLE breadth_reconstructed_daily (date TEXT PRIMARY KEY, "
              "metrics TEXT, ohlc_watermark TEXT, sentiment_watermark TEXT, built_at TEXT)")
    c.execute("INSERT INTO breadth_reconstructed_daily(date, metrics) VALUES('2020-01-02','{}')")
    c.commit(); c.close()
    res = br.restore_from_db(snap)
    assert res["recon_rows"] == 1


# ── PART B · every refusal, and each one leaves the live DB untouched ────────

def _untouched(live_path, before, uct_only=True):
    assert _fingerprint(live_path, uct_only=uct_only) == before, (
        "a REFUSED restore modified the live database — refusals must be fail-closed")


def test_e_a_corrupt_snapshot_is_refused(live, tmp_path):
    """⛔ integrity_check first. Installing an unreadable snapshot over a readable
    database is the one outcome worse than not restoring at all."""
    before = _fingerprint(live)
    snap = _snapshot(str(tmp_path / "bad.db"))
    with open(snap, "r+b") as fh:          # scribble over the middle of the file
        fh.seek(os.path.getsize(snap) // 2)
        fh.write(b"\x00" * 8192)
    with pytest.raises(br.RestoreRefused) as e:
        br.restore_from_db(snap)
    assert "integrity" in str(e.value).lower() or "malformed" in str(e.value).lower()
    _untouched(live, before)


def test_f_a_snapshot_that_is_not_a_breadth_database_is_refused(live, tmp_path):
    before = _fingerprint(live)
    snap = _snapshot(str(tmp_path / "wrong.db"), table=False)
    with pytest.raises(br.RestoreRefused, match="not a breadth database"):
        br.restore_from_db(snap)
    _untouched(live, before)


def test_g_a_snapshot_missing_required_columns_is_refused(live, tmp_path):
    before = _fingerprint(live)
    p = str(tmp_path / "shape.db")
    c = sqlite3.connect(p)
    c.execute("CREATE TABLE breadth_daily_ohlc (date TEXT, metric TEXT, c REAL)")
    c.executemany("INSERT INTO breadth_daily_ohlc VALUES(?,?,?)",
                  [("2008-01-02", "m%d" % i, 1.0) for i in range(br.MIN_OHLC_ROWS + 1)])
    c.commit(); c.close()
    with pytest.raises(br.RestoreRefused, match="wrong schema"):
        br.restore_from_db(p)
    _untouched(live, before)


def test_h_a_truncated_snapshot_is_refused_by_the_row_floor(live, tmp_path):
    """⚰️ BL-025 IS WHY THIS FLOOR EXISTS. A helper that set BREADTH_OHLC_DB as a side
    effect pointed a truncation at the artifact and deleted five sessions. A snapshot
    with almost no rows is far likelier to be a half-finished download than a real
    rollback target, and 'small' is not a thing we can distinguish from 'broken'."""
    before = _fingerprint(live)
    snap = _snapshot(str(tmp_path / "tiny.db"), n=10)
    with pytest.raises(br.RestoreRefused, match="truncated"):
        br.restore_from_db(snap)
    _untouched(live, before)


def test_i_a_restore_that_would_LOSE_a_universe_is_refused_unless_named(live, tmp_path):
    """⛔⛔ THE ONE THAT MATTERS AFTER US LANDS. Restoring a pre-US snapshot over a
    database holding US rows DELETES them. That is exactly what a rollback is for and
    exactly what a careless restore must never do by accident, so the caller has to say
    so out loud."""
    store.drop_compat_index()      # US cannot coexist with the interlock — that is BL-028
    store.write_bulk([("2008-01-02", "pct_above_50sma", 1, 2, 3, 4)],
                     source="close_recon", universe="us")
    assert "us" in br.live_universes()
    before = _fingerprint(live, uct_only=False)
    snap = _snapshot(str(tmp_path / "preus.db"))          # uct only
    with pytest.raises(br.RestoreRefused, match="would REMOVE universe"):
        br.restore_from_db(snap)
    _untouched(live, before, uct_only=False)
    # ...and it proceeds once the loss is named
    res = br.restore_from_db(snap, allow_universe_loss=True)
    assert res["universes_removed"] == ["us"]
    assert "us" not in res["live_after"]


def test_j_dry_run_decides_without_installing(live, tmp_path):
    before = _fingerprint(live)
    snap = _snapshot(str(tmp_path / "s.db"))
    res = br.restore_from_db(snap, dry_run=True)
    assert res["installed"] is False and res["snapshot"]["rows"] > 0
    _untouched(live, before)


def test_k_a_mid_restore_failure_rolls_back_entirely(live, tmp_path, monkeypatch):
    """⭐ ONE TRANSACTION IS THE WHOLE SAFETY STORY. The DELETE has already run when this
    blows up; if the restore were not transactional the live database would be EMPTY."""
    before = _fingerprint(live)
    snap = _snapshot(str(tmp_path / "s.db"))
    real = br._columns
    calls = {"n": 0}

    def boom(c, table, schema="main"):
        calls["n"] += 1
        if calls["n"] > 2 and schema == "snap":
            raise RuntimeError("simulated failure after the DELETE")
        return real(c, table, schema)

    monkeypatch.setattr(br, "_columns", boom)
    with pytest.raises(RuntimeError, match="simulated failure"):
        br.restore_from_db(snap)
    _untouched(live, before)
    assert br.live_universes()["uct"] == br.MIN_OHLC_ROWS + 10


def test_l_a_sha256_that_does_not_match_refuses_before_anything_is_staged(monkeypatch):
    """⛔ IDENTITY BEFORE INSTALL. We hold a recorded hash for the rollback artifact
    precisely so 'the snapshot we meant' is a checkable claim rather than a filename."""
    import io as _io

    class _Body:
        def __init__(self): self.b = _io.BytesIO(b"not a tarball")
        def read(self, n): return self.b.read(n)

    class _Client:
        def get_object(self, **kw): return {"Body": _Body()}

    from api.services import breadth_ohlc_sync as sync
    monkeypatch.setattr(sync, "_client", lambda: _Client())
    monkeypatch.setattr(sync, "_bucket", lambda: "bucket")
    with pytest.raises(br.RestoreRefused, match="does not match the expected"):
        br.stage_from_r2("123", expect_sha256="deadbeef")


# ── PART C · the property the whole phase rests on ──────────────────────────

def test_m_a_restored_pre_migration_artifact_boots_migrated_with_the_interlock(
        tmp_path, monkeypatch):
    """⭐⭐ THE END-TO-END ROLLBACK SHAPE: a PRE-migration artifact goes back, and the
    CURRENT code's own init migrates it to universe='uct' AND recreates the BL-028
    compatibility index — because at that point UCT is the only universe again, which is
    exactly the condition the interlock is defined by."""
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "boot.db"))
    store._INIT_DONE = False
    store._ensure_init()
    store.write_bulk(_rows(br.MIN_OHLC_ROWS + 10), source="close_recon", universe="uct")
    store.drop_compat_index()
    store.write_bulk([("2008-01-02", "pct_above_50sma", 9, 9, 9, 9)],
                     source="close_recon", universe="us")
    assert store.compat_index_present() is False and "us" in br.live_universes()

    snap = _snapshot(str(tmp_path / "rollback.db"), migrated=False)
    br.restore_from_db(snap, allow_universe_loss=True)

    store._INIT_DONE = False
    store._ensure_init()                       # the pod restarting on current code
    assert br.live_universes() == {"uct": br.MIN_OHLC_ROWS + 10}
    assert store.compat_index_present() is True, (
        "after a rollback restores a UCT-only database, current code must put the "
        "interlock back — otherwise the next US write is unguarded")
    with pytest.raises(store.CompatIndexBlocksUniverse):
        store.write_bulk([("2008-01-02", "pct_above_50sma", 1, 1, 1, 1)],
                         source="close_recon", universe="us")
