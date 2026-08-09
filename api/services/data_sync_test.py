"""Tests for api.services.data_sync.

Tests the local tar/untar round-trip and SQLite backup integration without
any S3 — just file I/O. S3 calls are tested manually after deploy by
hitting /api/health/cache (web) and /internal/health (worker)."""
import datetime as _dt
import io
import os
import shutil
import sqlite3
import tarfile
import time
from zoneinfo import ZoneInfo as _ZoneInfo

import pytest


def _reload_data_sync():
    """Reimport data_sync so it picks up the current DATA_DIR env var."""
    import importlib
    from api.services import data_sync
    importlib.reload(data_sync)
    return data_sync


@pytest.fixture(autouse=True)
def _restore_data_sync_after_each_test():
    """`_reload_data_sync()` mutates the ONE shared module object.

    Every test here reloads it against its own tmp DATA_DIR (and the cadence
    tests against their own env-overridden constants), and nothing put it back —
    so `api.services.data_sync` was left pointing at a deleted tmp dir for every
    later test file in the session. Reload once more on the way out so the next
    file gets the module the real environment describes."""
    yield
    _reload_data_sync()


# ── snapshot DB fixtures ───────────────────────────────────────────────────
#
# `_assert_shippable_db` (665059ad) gates every snapshot BEFORE it is tarred:
# PRAGMA integrity_check must be "ok" AND the ohlcv table must hold at least
# SNAPSHOT_MIN_OHLCV_ROWS rows. That gate is the fix for the 2026-07-03 outage,
# where an emptied recovery DB shipped to R2, deleted every web pod's local copy
# and installed nothing — so these fixtures make the source realistic rather
# than making the gate lenient.

_OHLCV_DDL = (
    "CREATE TABLE ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, ts INTEGER NOT NULL, "
    "o REAL, h REAL, l REAL, c REAL, v INTEGER, PRIMARY KEY (ticker,tf,ts))"
)


def _write_bars_db(db_path, rows: int, wal: bool = False):
    """Create a bars.db holding exactly `rows` ohlcv bars.

    Returns the OPEN connection — the WAL test needs it left open so the rows
    stay in -wal rather than the main file. Callers that don't care may close it.
    """
    con = sqlite3.connect(str(db_path))
    if wal:
        con.execute("PRAGMA journal_mode=WAL")
    con.execute(_OHLCV_DDL)
    con.executemany(
        "INSERT INTO ohlcv (ticker,tf,ts,o,h,l,c,v) VALUES (?,?,?,?,?,?,?,?)",
        [("AAPL", "D", i, 1.0, 2.0, 0.5, float(i), 100 + i) for i in range(rows)],
    )
    con.commit()
    return con


def _shippable_row_count(data_sync) -> int:
    """The smallest row count the gate accepts, DERIVED from the constant.

    Typing 1000 here would make the fixture a second authority over the floor:
    raising SNAPSHOT_MIN_OHLCV_ROWS would leave this fixture quietly under it and
    every round-trip test would start failing for a reason unrelated to tarring.
    """
    return data_sync.SNAPSHOT_MIN_OHLCV_ROWS


def _extract(tar_path, extract_dir):
    """Extract a snapshot tarball, then remove the temp dir `_make_tarball`
    handed us — its docstring makes the CALLER responsible for that."""
    extract_dir.mkdir(exist_ok=True)
    try:
        assert os.path.getsize(tar_path) > 0
        with tarfile.open(tar_path, mode="r:gz") as tar:
            tar.extractall(extract_dir)
    finally:
        shutil.rmtree(os.path.dirname(tar_path), ignore_errors=True)


def test_make_tarball_round_trip(tmp_path, monkeypatch):
    """A real SQLite file written under DATA_DIR survives a tarball round-trip
    and is still a queryable SQLite DB after extraction.

    bars_cache/ is OPT-IN (`SNAPSHOT_INCLUDE_CACHE=1`) — the default sync path
    reads only bars.db out of the snapshot — so this turns it on to keep
    covering the path that ships it."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("SNAPSHOT_INCLUDE_CACHE", "1")
    data_sync = _reload_data_sync()

    rows = _shippable_row_count(data_sync)
    _write_bars_db(tmp_path / "bars.db", rows).close()
    cache = tmp_path / "bars_cache"
    cache.mkdir()
    (cache / "AAPL_D.json").write_text('{"bars":[]}')

    _extract(data_sync._make_tarball(), tmp_path / "extracted")

    extract_dir = tmp_path / "extracted"
    extracted = sqlite3.connect(str(extract_dir / "bars.db"))
    try:
        assert extracted.execute("SELECT COUNT(*) FROM ohlcv").fetchone()[0] == rows
        assert extracted.execute(
            "SELECT c, v FROM ohlcv WHERE ticker='AAPL' AND tf='D' AND ts=7"
        ).fetchone() == (7.0, 107)
    finally:
        extracted.close()
    assert (extract_dir / "bars_cache" / "AAPL_D.json").read_text() == '{"bars":[]}'


def test_make_tarball_excludes_bars_cache_by_default(tmp_path, monkeypatch):
    """bars_cache/ is dead weight on the default sync path, so it ships only
    under SNAPSHOT_INCLUDE_CACHE=1. Without this the round-trip test above
    would be the only reader of that flag and could not tell the two apart."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv("SNAPSHOT_INCLUDE_CACHE", raising=False)
    data_sync = _reload_data_sync()

    _write_bars_db(tmp_path / "bars.db", _shippable_row_count(data_sync)).close()
    cache = tmp_path / "bars_cache"
    cache.mkdir()
    (cache / "AAPL_D.json").write_text('{"bars":[]}')

    _extract(data_sync._make_tarball(), tmp_path / "extracted")
    assert (tmp_path / "extracted" / "bars.db").exists()
    assert not (tmp_path / "extracted" / "bars_cache").exists()


def test_make_tarball_empty_dir_raises(tmp_path, monkeypatch):
    """If neither bars.db nor bars_cache/ exists, refuse to make an empty snapshot."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    data_sync = _reload_data_sync()
    with pytest.raises(FileNotFoundError):
        data_sync._make_tarball()


def test_make_tarball_refuses_an_empty_ohlcv_snapshot(tmp_path, monkeypatch):
    """The 2026-07-03 poison shape: a bars.db that opens cleanly and passes
    integrity_check but holds NO bars — exactly what force_resync leaves behind
    when no R2 snapshot installs. Shipping it made 'latest' an empty schema and
    503'd every chart across the fleet until reboot.

    This is the only coverage of the thing 665059ad was written for: if the gate
    is ever weakened to make a fixture pass, this test is what fails."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    data_sync = _reload_data_sync()
    _write_bars_db(tmp_path / "bars.db", 0).close()

    with pytest.raises(data_sync.SnapshotIntegrityError) as exc:
        data_sync._make_tarball()
    assert "ohlcv row count 0" in str(exc.value)


def test_make_tarball_refuses_a_snapshot_below_the_row_floor(tmp_path, monkeypatch):
    """A truncated (not empty) DB is refused too — the floor is a floor, not an
    emptiness check. The row count is derived from the constant so the test
    cannot drift away from the gate it guards."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    data_sync = _reload_data_sync()
    _write_bars_db(tmp_path / "bars.db", _shippable_row_count(data_sync) - 1).close()

    with pytest.raises(data_sync.SnapshotIntegrityError):
        data_sync._make_tarball()


def test_upload_snapshot_puts_nothing_when_the_gate_refuses(tmp_path, monkeypatch):
    """The gate only protects R2 if the caller honours it: a refused snapshot
    must produce ZERO S3 calls, so `latest.txt` keeps pointing at the last good
    tarball instead of a fleet-wide empty one."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DATA_SYNC_ENDPOINT_URL", "https://example.test")
    monkeypatch.setenv("DATA_SYNC_ACCESS_KEY", "x")
    monkeypatch.setenv("DATA_SYNC_SECRET_KEY", "y")
    monkeypatch.setenv("DATA_SYNC_BUCKET", "test-bucket")
    data_sync = _reload_data_sync()
    _write_bars_db(tmp_path / "bars.db", 0).close()

    calls: list = []

    class _RecordingClient:
        def __getattr__(self, name):
            def _call(*a, **kw):
                calls.append(name)
            return _call

    monkeypatch.setattr(data_sync, "_client", lambda: _RecordingClient())

    assert data_sync.upload_snapshot() is None
    assert calls == [], f"a refused snapshot still touched S3: {calls}"


def test_make_tarball_captures_wal_writes(tmp_path, monkeypatch):
    """Critical regression test: bars.db is in WAL mode and the prewarmer
    writes continuously. Naive tar of bars.db would miss anything still in
    the WAL file. This test writes data via WAL mode and verifies the
    snapshot's bars.db (via backup API) contains those committed-but-not-
    checkpointed rows."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    data_sync = _reload_data_sync()

    rows = _shippable_row_count(data_sync)
    src = _write_bars_db(tmp_path / "bars.db", rows, wal=True)
    # Deliberately do NOT checkpoint — leave the data sitting in -wal.
    # Keep src open: a checkpoint won't run automatically, AND closing
    # would drain the WAL on some configs. We want a torn-state simulation.
    assert (tmp_path / "bars.db-wal").exists(), "fixture did not leave a WAL to capture"

    tar_path = data_sync._make_tarball()
    src.close()

    _extract(tar_path, tmp_path / "extracted")
    extracted = sqlite3.connect(str(tmp_path / "extracted" / "bars.db"))
    try:
        got = extracted.execute("SELECT COUNT(*) FROM ohlcv").fetchone()[0]
    finally:
        extracted.close()
    # If the backup API was used correctly, the WAL data is there.
    # If we'd naively tar'd the live bars.db, these rows would be missing.
    assert got == rows, (
        f"Snapshot is missing data that was committed but lived in -wal "
        f"({got} of {rows} rows). _backup_sqlite_db is not being used correctly."
    )


def test_marker_round_trip(tmp_path, monkeypatch):
    """Writing a marker then reading it back produces correct sync state."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    data_sync = _reload_data_sync()

    ts = str(int(time.time()) - 30)  # snapshot was made 30s ago
    data_sync._write_marker(data_sync._LAST_SYNC_MARKER, ts)

    state = data_sync.get_local_sync_state()
    assert state["snapshot_ts"] == ts
    assert state["synced_at"] is not None
    assert 0 <= state["seconds_since_sync"] < 5


def test_upload_and_sync_markers_are_independent(tmp_path, monkeypatch):
    """The worker's last_upload marker and the web's last_sync marker live
    in separate files so a worker can report uploads without the web ever
    having pulled, and vice versa."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    data_sync = _reload_data_sync()

    # Worker writes upload marker only
    upload_ts = str(int(time.time()))
    data_sync._write_marker(data_sync._LAST_UPLOAD_MARKER, upload_ts)

    upload = data_sync.get_local_upload_state()
    sync = data_sync.get_local_sync_state()

    assert upload["snapshot_ts"] == upload_ts
    assert sync["snapshot_ts"] is None  # web's sync marker not written

    # Web writes sync marker only (different ts)
    sync_ts = str(int(time.time()) + 1)
    data_sync._write_marker(data_sync._LAST_SYNC_MARKER, sync_ts)

    upload = data_sync.get_local_upload_state()
    sync = data_sync.get_local_sync_state()
    assert upload["snapshot_ts"] == upload_ts  # unchanged
    assert sync["snapshot_ts"] == sync_ts


def test_local_sync_state_when_no_marker(tmp_path, monkeypatch):
    """No marker file → all None."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    data_sync = _reload_data_sync()
    state = data_sync.get_local_sync_state()
    assert state == {"snapshot_ts": None, "synced_at": None, "seconds_since_sync": None}


def test_client_returns_none_without_credentials(monkeypatch):
    """No env vars → no client (don't crash; let caller handle gracefully)."""
    for var in ("DATA_SYNC_ENDPOINT_URL", "DATA_SYNC_ACCESS_KEY", "DATA_SYNC_SECRET_KEY"):
        monkeypatch.delenv(var, raising=False)
    data_sync = _reload_data_sync()
    assert data_sync._client() is None


# ── upload cadence ─────────────────────────────────────────────────────────
#
# This block replaces `test_snapshot_interval_is_five_minutes`, which asserted
# `SNAPSHOT_INTERVAL_SECONDS == 300` and had been red since the constant moved to
# 1200 — under a NAME that stated a fact about the product that stopped being
# true. Restating a typed constant in a test makes the test a second authority
# over one value: it can only ever agree (proving nothing) or disagree (a false
# alarm). So these assert the PROPERTIES the cadence exists to hold, and derive
# every number from the code rather than repeating it.

# The egress budget the slow cadence exists to buy. data_sync prices a 300s
# cadence at "~130 GB/day egress" across the active window and says 1200s "drops
# that ~4x"; expressed as uploads-per-active-window that is ~192 vs ~48. A
# ceiling of 60 is that statement turned into a bound the code must satisfy —
# the shipped default clears it, and a revert to 300s (or anything under ~960s)
# fails it loudly instead of quadrupling the R2 bill silently.
_MAX_UPLOADS_PER_ACTIVE_WINDOW = 60


def _active_window_seconds(data_sync) -> int:
    """Length of the weekday active window, PROBED from in_active_data_window().

    The window is the product's to define; typing "16 hours" here would be the
    same second-authority mistake this block replaces."""
    et_midnight = _dt.datetime(2026, 8, 5, 0, 0, tzinfo=_ZoneInfo("America/New_York"))
    return sum(
        3600
        for h in range(24)
        if data_sync.in_active_data_window(et_midnight.replace(hour=h))
    )


def test_snapshot_interval_is_env_overridable():
    """Both cadences are operator-tunable without a deploy — that override is
    the actual contract, and the one an operator reaches for when egress or
    freshness needs to move."""
    with pytest.MonkeyPatch.context() as mp:
        mp.setenv("SNAPSHOT_INTERVAL_SECONDS", "77")
        mp.setenv("SNAPSHOT_INTERVAL_IDLE_SECONDS", "888")
        data_sync = _reload_data_sync()
        assert data_sync.SNAPSHOT_INTERVAL_SECONDS == 77
        assert data_sync.SNAPSHOT_INTERVAL_IDLE_SECONDS == 888

        mp.setattr(data_sync, "in_active_data_window", lambda *a, **k: True)
        assert data_sync.snapshot_interval_seconds() == 77
        mp.setattr(data_sync, "in_active_data_window", lambda *a, **k: False)
        assert data_sync.snapshot_interval_seconds() == 888


def test_the_idle_cadence_is_slower_than_the_active_one():
    """Two constants only earn their keep if the idle one is strictly slower —
    bars are static overnight and on weekends, so uploading at the active rate
    there is pure egress for nothing."""
    from api.services import data_sync
    assert data_sync.SNAPSHOT_INTERVAL_SECONDS > 0
    assert data_sync.SNAPSHOT_INTERVAL_SECONDS < data_sync.SNAPSHOT_INTERVAL_IDLE_SECONDS


def test_the_active_upload_cadence_stays_inside_the_egress_budget():
    """The whole reason the interval is not 300s. The full tarball ships on
    essentially every active-window cycle (the prewarmer keeps writing, so
    skip-if-unchanged only helps overnight), so uploads-per-window IS the
    egress bill."""
    from api.services import data_sync
    window = _active_window_seconds(data_sync)
    assert window > 0, "in_active_data_window() is never true — probe is vacuous"

    uploads = window / data_sync.SNAPSHOT_INTERVAL_SECONDS
    assert uploads <= _MAX_UPLOADS_PER_ACTIVE_WINDOW, (
        f"SNAPSHOT_INTERVAL_SECONDS={data_sync.SNAPSHOT_INTERVAL_SECONDS} gives "
        f"{uploads:.0f} full-snapshot uploads per {window // 3600}h active window, "
        f"over the {_MAX_UPLOADS_PER_ACTIVE_WINDOW} the egress budget allows."
    )


def test_download_snapshot_bumps_db_epoch(tmp_path, monkeypatch):
    """Integration regression test: download_snapshot MUST call
    bars_sqlite.bump_db_epoch() after replacing /data/bars.db. Without this,
    every existing thread-local SQLite connection keeps reading the deleted
    inode forever and the entire R2 sync is invisible to user requests.

    This test would have caught the original bug (and any future regression
    from someone "cleaning up" the bump call as dead code)."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DATA_SYNC_ENDPOINT_URL", "https://example.test")
    monkeypatch.setenv("DATA_SYNC_ACCESS_KEY", "x")
    monkeypatch.setenv("DATA_SYNC_SECRET_KEY", "y")
    monkeypatch.setenv("DATA_SYNC_BUCKET", "test-bucket")

    # Build a tiny tarball containing a real SQLite DB
    import io
    import sqlite3
    import tarfile
    src_db = tmp_path / "src_bars.db"
    s = sqlite3.connect(str(src_db))
    s.execute("CREATE TABLE t (k INT)")
    s.execute("INSERT INTO t VALUES (42)")
    s.commit()
    s.close()
    tar_buf = io.BytesIO()
    with tarfile.open(fileobj=tar_buf, mode="w:gz") as tf:
        tf.add(str(src_db), arcname="bars.db")
    tar_bytes = tar_buf.getvalue()

    # Mock boto3 client
    class _MockBody:
        def read(self):
            return tar_bytes

    class _MockClient:
        def get_object(self, Bucket, Key):
            return {"Body": _MockBody()}

    data_sync = _reload_data_sync()
    monkeypatch.setattr(data_sync, "_client", lambda: _MockClient())

    # Reload bars_sqlite so its _db_epoch starts at 0
    import importlib
    from api.services import bars_sqlite
    importlib.reload(bars_sqlite)
    epoch_before = bars_sqlite._db_epoch

    ok = data_sync.download_snapshot("1234567890")
    assert ok is True

    epoch_after = bars_sqlite._db_epoch
    assert epoch_after == epoch_before + 1, (
        f"download_snapshot did not bump _db_epoch "
        f"(before={epoch_before}, after={epoch_after}). "
        "Connection invalidation broken — pulled snapshots would be ignored "
        "by every thread holding a stale SQLite connection."
    )


def _make_tarball_bytes_with(db_bytes: bytes) -> bytes:
    """Build a tar.gz containing a single bars.db with the provided raw bytes.
    Used to fabricate both good and corrupt snapshots in tests."""
    import os as _os
    import tempfile as _tempfile
    fd, path = _tempfile.mkstemp()
    with _os.fdopen(fd, "wb") as f:
        f.write(db_bytes)
    try:
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            tar.add(path, arcname="bars.db")
        return buf.getvalue()
    finally:
        try:
            _os.remove(path)
        except OSError:
            pass


def test_download_snapshot_refuses_malformed_payload(tmp_path, monkeypatch):
    """A snapshot whose bars.db fails PRAGMA integrity_check must NOT be
    installed. This is the guardrail that prevents the corruption-recovery
    loop from pulling a bad R2 copy on top of a bad local copy and locking
    in the failure permanently."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DATA_SYNC_ENDPOINT_URL", "https://example.test")
    monkeypatch.setenv("DATA_SYNC_ACCESS_KEY", "x")
    monkeypatch.setenv("DATA_SYNC_SECRET_KEY", "y")
    monkeypatch.setenv("DATA_SYNC_BUCKET", "test-bucket")

    # Pre-existing local bars.db that we don't want clobbered
    local_db = tmp_path / "bars.db"
    local_src = sqlite3.connect(str(local_db))
    local_src.execute("CREATE TABLE preserve (id INT)")
    local_src.execute("INSERT INTO preserve VALUES (777)")
    local_src.commit()
    local_src.close()
    local_db_bytes = local_db.read_bytes()

    # Snapshot whose bars.db is garbage
    tar_bytes = _make_tarball_bytes_with(b"NOT A SQLITE DATABASE")

    class _Body:
        def read(self):
            return tar_bytes

    class _Client:
        def get_object(self, Bucket, Key):
            return {"Body": _Body()}

    data_sync = _reload_data_sync()
    monkeypatch.setattr(data_sync, "_client", lambda: _Client())

    ok = data_sync.download_snapshot("9999999999")
    assert ok is False, "download_snapshot must refuse a snapshot that fails integrity_check"
    # Local file must be untouched — we did not overwrite a possibly-good copy
    assert local_db.read_bytes() == local_db_bytes, (
        "download_snapshot left the local bars.db corrupted — it should "
        "have aborted before any move()"
    )


def test_download_snapshot_does_not_clobber_active_sidecars(tmp_path, monkeypatch):
    """download_snapshot must NOT delete bars.db-wal / bars.db-shm during the
    swap. An earlier version did so (to prevent a theoretical "stale WAL on
    new main file → malformed image" path) but that deletion races with
    in-flight writers — SQLite then reports "disk I/O error" on the next
    operation in any thread that had the WAL open. The malformed-image
    risk is instead handled by integrity_ok() at boot + the put_bars
    malformed handler that triggers force_resync."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DATA_SYNC_ENDPOINT_URL", "https://example.test")
    monkeypatch.setenv("DATA_SYNC_ACCESS_KEY", "x")
    monkeypatch.setenv("DATA_SYNC_SECRET_KEY", "y")
    monkeypatch.setenv("DATA_SYNC_BUCKET", "test-bucket")

    # Pre-create sidecars that simulate an in-use WAL
    (tmp_path / "bars.db-wal").write_bytes(b"in-use-wal-bytes")
    (tmp_path / "bars.db-shm").write_bytes(b"in-use-shm-bytes")

    # Build a good snapshot
    src_db = tmp_path / "snap_src.db"
    s = sqlite3.connect(str(src_db))
    s.execute("CREATE TABLE t (k INT)")
    s.execute("INSERT INTO t VALUES (1)")
    s.commit()
    s.close()
    tar_bytes = _make_tarball_bytes_with(src_db.read_bytes())

    class _Body:
        def read(self):
            return tar_bytes

    class _Client:
        def get_object(self, Bucket, Key):
            return {"Body": _Body()}

    data_sync = _reload_data_sync()
    monkeypatch.setattr(data_sync, "_client", lambda: _Client())

    ok = data_sync.download_snapshot("123")
    assert ok is True
    # Sidecars must STILL be on disk — deleting them would race with
    # active SQLite writers and surface as disk I/O errors at runtime.
    assert (tmp_path / "bars.db-wal").exists(), (
        "download_snapshot deleted bars.db-wal — this races with in-flight "
        "writers and causes disk I/O errors. See data_sync.py comment."
    )
    assert (tmp_path / "bars.db-shm").exists(), (
        "download_snapshot deleted bars.db-shm — same race as above."
    )


def test_force_resync_clears_marker_and_local_db(tmp_path, monkeypatch):
    """force_resync is the recovery hammer: it must clear the local sync
    marker (so sync_if_newer no longer short-circuits on 'I'm up to date')
    AND delete the local bars.db plus -wal/-shm so a malformed file can't
    poison the next open. We verify the cleanup half here without going
    through R2 — when no remote credentials are configured, force_resync
    returns False but must still have done the local cleanup."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    # Deliberately do NOT set DATA_SYNC_* — get_latest_snapshot_ts returns None
    for var in ("DATA_SYNC_ENDPOINT_URL", "DATA_SYNC_ACCESS_KEY",
                "DATA_SYNC_SECRET_KEY", "DATA_SYNC_BUCKET"):
        monkeypatch.delenv(var, raising=False)

    # Pre-state: corrupt local bars.db, sidecars, and a sync marker
    (tmp_path / "bars.db").write_bytes(b"GARBAGE")
    (tmp_path / "bars.db-wal").write_bytes(b"stale-wal")
    (tmp_path / "bars.db-shm").write_bytes(b"stale-shm")

    data_sync = _reload_data_sync()
    data_sync._write_marker(data_sync._LAST_SYNC_MARKER, "9999")
    assert (tmp_path / data_sync._LAST_SYNC_MARKER).exists()

    ok = data_sync.force_resync()
    assert ok is False, "no remote credentials → cannot pull → returns False"

    # All four files must be gone after force_resync, even though the pull failed
    assert not (tmp_path / "bars.db").exists(), "force_resync did not remove corrupt bars.db"
    assert not (tmp_path / "bars.db-wal").exists(), "force_resync did not remove stale -wal"
    assert not (tmp_path / "bars.db-shm").exists(), "force_resync did not remove stale -shm"
    assert not (tmp_path / data_sync._LAST_SYNC_MARKER).exists(), (
        "force_resync did not clear the sync marker — sync_if_newer would "
        "still short-circuit on the stale 'I'm up to date' check"
    )


class TestMergeOhlcv:
    """Part 2 — the locked 'never regress' rule. _merge_ohlcv_from must
    add freshness / pre-populate cold tickers but NEVER overwrite or roll
    back a fresher local row (the 2026-05-07 replace-regression class)."""

    def _mkdb(self, path, rows):
        c = sqlite3.connect(str(path))
        c.execute(
            "CREATE TABLE ohlcv (ticker TEXT, tf TEXT, ts INTEGER, "
            "o REAL, h REAL, l REAL, c REAL, v INTEGER, "
            "PRIMARY KEY (ticker,tf,ts))"
        )
        c.executemany(
            "INSERT INTO ohlcv (ticker,tf,ts,o,h,l,c,v) VALUES (?,?,?,?,?,?,?,?)",
            rows,
        )
        c.commit()
        c.close()

    def _rows(self, path, ticker, tf):
        c = sqlite3.connect(str(path))
        try:
            return c.execute(
                "SELECT ts,c FROM ohlcv WHERE ticker=? AND tf=? ORDER BY ts",
                (ticker, tf),
            ).fetchall()
        finally:
            c.close()

    def test_adopts_newer_and_pre_populates_but_never_regresses(self, tmp_path):
        data_sync = _reload_data_sync()
        local = tmp_path / "local.db"
        snap = tmp_path / "snap.db"
        # local: AAPL frozen at ts=100 (c=10). NVDA absent entirely.
        # ⚠️ h carries the close, not 1 — `_merge_ohlcv_from` is now gated by the
        # possible-bar predicate (`0c2ecb38`), and the original fixtures wrote
        # `o=h=l=1, c=10`: a close TEN TIMES the high. Those rows are refused at
        # the door now, so the merge adopted 0 and the test read as a merge bug.
        # The c values are what every assertion below reads; only h/l moved.
        self._mkdb(local, [("AAPL", "15", 100, 1, 10, 1, 10, 5)])
        # snapshot: AAPL has the old 100 (different c — must NOT overwrite)
        # plus newer 200/300; NVDA fully present (cold-ticker pre-pop).
        self._mkdb(snap, [
            ("AAPL", "15", 100, 9, 99, 9, 99, 9),  # collides — must be IGNORED
            ("AAPL", "15", 200, 2, 20, 2, 20, 6),  # newer — adopt
            ("AAPL", "15", 300, 3, 30, 3, 30, 7),  # newer — adopt
            ("NVDA", "15", 50, 4, 40, 4, 40, 8),   # absent locally — adopt
        ])
        adopted = data_sync._merge_ohlcv_from(str(snap), local_db=str(local))
        assert adopted == 3
        aapl = self._rows(local, "AAPL", "15")
        assert aapl == [(100, 10.0), (200, 20.0), (300, 30.0)], (
            "existing local bar must NOT be overwritten; newer bars adopted"
        )
        assert self._rows(local, "NVDA", "15") == [(50, 40.0)]

    def test_stale_snapshot_is_a_noop(self, tmp_path):
        data_sync = _reload_data_sync()
        local = tmp_path / "local.db"
        snap = tmp_path / "snap.db"
        # local fresher (up to 300); snapshot only has older 100/200.
        self._mkdb(local, [
            ("AAPL", "15", 100, 1, 10, 1, 10, 5),
            ("AAPL", "15", 200, 2, 20, 2, 20, 6),
            ("AAPL", "15", 300, 3, 30, 3, 30, 7),
        ])
        self._mkdb(snap, [
            ("AAPL", "15", 100, 9, 99, 9, 99, 9),
            ("AAPL", "15", 200, 9, 99, 9, 99, 9),
        ])
        adopted = data_sync._merge_ohlcv_from(str(snap), local_db=str(local))
        assert adopted == 0, "stale snapshot must adopt nothing"
        assert self._rows(local, "AAPL", "15") == [
            (100, 10.0), (200, 20.0), (300, 30.0)
        ], "fresher local data must be completely preserved"

    def test_no_local_db_returns_sentinel(self, tmp_path):
        data_sync = _reload_data_sync()
        snap = tmp_path / "snap.db"
        self._mkdb(snap, [("AAPL", "15", 1, 1, 1, 1, 1, 1)])
        assert data_sync._merge_ohlcv_from(
            str(snap), local_db=str(tmp_path / "missing.db")
        ) == -1
