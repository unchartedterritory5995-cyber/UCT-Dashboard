"""THE SUPPORTED BREADTH RESTORE PATH (BL-030) — put a known snapshot back.

⭐⭐ WHY THIS EXISTS. Until now a breadth rollback had no mechanism. The R2 bridge
(`breadth_ohlc_sync`) is an ADDITIVE gap-fill merge: it can add rows a snapshot has and
the live DB lacks, and it can never remove a row or undo a bad write. So "restore the
database" was a sentence in a runbook with no code under it — and once the BL-028
compatibility index is dropped, replacing the content is the ONLY way to undo a bad
ingest.

⛔⛔ AND IT DOES NOT REPLACE THE FILE, WHICH IS THE DESIGN DECISION HERE.

`data_sync.download_snapshot()` installs bars.db with `shutil.move`, and its own comment
records the scar tissue: an earlier version ALSO removed the stale `-wal`/`-shm`
sidecars, and writers mid-transaction had their WAL deleted from under them — SQLite
reported "disk I/O error" on the next operation. So it now leaves the sidecars alone and
accepts the opposite risk (a stale WAL beside a fresh main file can read as
"disk image is malformed"), catching it with `integrity_ok()` at boot.

⚠️ THAT TRADE IS RIGHT FOR BARS AND WRONG FOR BREADTH, and the reason is measured rather
than inherited. Audited in `breadth_daily_ohlc` before writing a line of this:

    • `_conn()` opens a NEW connection per call and closes it — no pool, no
      thread-local, no epoch to bump. The deep-reader path says so in its own comment
      ("opened HERE and closed in the `finally` ... rf_conn_reused is therefore
      always 0 today").
    • the ONE long-lived handle in the module is `_PROBE`, used for nothing but
      `PRAGMA data_version`, and `_resident_rows()` checks its flag BEFORE opening it.
      `BREADTH_RESIDENT_RECON_ENABLED` is unset on every production service.
    • WAL journal mode, `busy_timeout=3000`.

⭐ So breadth has no stale-inode problem to solve, and therefore nothing to GAIN from
moving a file — while still paying the full sidecar hazard. This replaces the CONTENT
inside ONE transaction on the LIVE inode instead:

    BEGIN IMMEDIATE -> DELETE FROM each table -> INSERT..SELECT from the staged
    snapshot -> COMMIT

which is better on every axis that matters here:

    • the `-wal`/`-shm` are never touched, moved or deleted — the hazard is not
      mitigated, it is ABSENT;
    • WAL gives readers snapshot isolation, so a concurrent reader sees the OLD
      content or the NEW content and never a torn mixture. A file move cannot
      promise that;
    • a failure ANYWHERE rolls back and leaves the live database exactly as it was —
      fail-closed is the default rather than a cleanup path;
    • it is idempotent: restoring the same snapshot twice lands the same rows.

⛔ IT IS DELIBERATELY NOT A GENERIC DB-REPLACEMENT FRAMEWORK. It knows the two breadth
tables by name and validates their shape. A generic destructive installer is a far
larger blast radius than this problem needs.
"""
from __future__ import annotations

import hashlib
import logging
import os
import shutil
import sqlite3
import tarfile
import tempfile
from typing import Optional

_log = logging.getLogger("breadth_restore")

#: The tables this path knows how to restore.
OHLC_TABLE = "breadth_daily_ohlc"
RECON_TABLE = "breadth_reconstructed_daily"
KNOWN_TABLES = (OHLC_TABLE, RECON_TABLE)

#: ⚠️ A FLOOR, NOT A TARGET. A snapshot with almost no rows is far more likely to be a
#: truncated download or a half-built database than a real rollback target — and BL-025
#: is this programme's own account of what one truncation cost. Production carries
#: ~170k; anything under this is refused rather than installed.
MIN_OHLC_ROWS = 100_000


class RestoreRefused(RuntimeError):
    """The restore did NOT happen, and the live database was not touched."""


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _columns(c: sqlite3.Connection, table: str, schema: str = "main") -> list:
    return [r[1] for r in c.execute("PRAGMA %s.table_info(%s)" % (schema, table))]


def inspect_snapshot(path: str) -> dict:
    """Everything we need in order to DECIDE, read from the staged file. Read-only.

    ⛔ Every check here is a REFUSAL, not a warning. A restore that installs something
    it could not validate is the one outcome worse than not restoring at all.
    """
    c = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
    try:
        # ⛔ INTEGRITY FIRST — every other question is meaningless on a corrupt file.
        verdict = c.execute("PRAGMA integrity_check").fetchone()[0]
        if verdict != "ok":
            raise RestoreRefused("staged snapshot failed integrity_check: %r" % verdict)
        names = {r[0] for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        if OHLC_TABLE not in names:
            raise RestoreRefused(
                "staged snapshot has no %s table (tables: %s) — this is not a breadth "
                "database" % (OHLC_TABLE, sorted(names)))
        cols = _columns(c, OHLC_TABLE)
        required = {"date", "metric", "o", "h", "l", "c", "source"}
        missing = required - set(cols)
        if missing:
            raise RestoreRefused(
                "%s is missing column(s) %s — wrong schema" % (OHLC_TABLE, sorted(missing)))
        migrated = "universe" in cols
        rows = c.execute("SELECT COUNT(*) FROM %s" % OHLC_TABLE).fetchone()[0]
        if rows < MIN_OHLC_ROWS:
            raise RestoreRefused(
                "%s holds %d rows, under the %d floor — refusing a snapshot that looks "
                "truncated rather than small" % (OHLC_TABLE, rows, MIN_OHLC_ROWS))
        if migrated:
            unis = dict(c.execute("SELECT universe, COUNT(*) FROM %s GROUP BY universe"
                                  % OHLC_TABLE))
        else:
            unis = {"uct": rows}      # pre-migration: every row IS uct, by definition
        span = c.execute("SELECT MIN(date), MAX(date) FROM %s" % OHLC_TABLE).fetchone()
        return {"path": path, "migrated": migrated, "rows": rows, "universes": unis,
                "span": list(span), "integrity": verdict,
                "tables": sorted(names & set(KNOWN_TABLES)),
                "other_tables": sorted(names - set(KNOWN_TABLES) - {"sqlite_sequence"})}
    finally:
        c.close()


def live_universes() -> dict:
    """{universe: rows} in the LIVE database, or {} if it cannot be read."""
    from api.services import breadth_daily_ohlc as store
    try:
        with store._conn() as c:
            if "universe" not in _columns(c, OHLC_TABLE):
                n = c.execute("SELECT COUNT(*) FROM %s" % OHLC_TABLE).fetchone()[0]
                return {"uct": n}
            return dict(c.execute("SELECT universe, COUNT(*) FROM %s GROUP BY universe"
                                  % OHLC_TABLE))
    except Exception:
        return {}


def restore_from_db(staged_db: str, *, allow_universe_loss: bool = False,
                    dry_run: bool = False) -> dict:
    """Install `staged_db` as the breadth database's CONTENT, in ONE transaction.

    ⛔ `allow_universe_loss` is not a convenience flag. Restoring a PRE-US snapshot over
    a database holding US rows DELETES them — which is exactly what a rollback is for,
    and exactly what a careless restore must never do by accident. The caller has to
    name the loss out loud.
    """
    from api.services import breadth_daily_ohlc as store

    info = inspect_snapshot(staged_db)
    before = live_universes()
    losing = sorted(set(before) - set(info["universes"]))
    if losing and not allow_universe_loss:
        raise RestoreRefused(
            "this snapshot would REMOVE universe(s) %s that the live database holds "
            "(live=%s, snapshot=%s). If that is the intent, pass "
            "allow_universe_loss=True." % (losing, before, info["universes"]))

    out = {"snapshot": info, "live_before": before, "universes_removed": losing,
           "dry_run": dry_run, "installed": False}
    if dry_run:
        return out

    store._ensure_init()
    recon = 0
    with store._WRITE_LOCK:
        c = store._conn()
        try:
            c.execute("PRAGMA busy_timeout=30000")
            c.execute("ATTACH DATABASE ? AS snap", (staged_db,))
            # ⭐ ONE TRANSACTION, AND `IMMEDIATE` SO THE WRITE LOCK IS TAKEN NOW rather
            # than on the first write. A restore that discovers it cannot get the lock
            # halfway through a DELETE is the worst possible place to find out.
            c.execute("BEGIN IMMEDIATE")
            live_cols = _columns(c, OHLC_TABLE)
            snap_cols = _columns(c, OHLC_TABLE, "snap")
            c.execute("DELETE FROM main.%s" % OHLC_TABLE)
            if "universe" in live_cols and "universe" not in snap_cols:
                # ⚠️ THE PRE-MIGRATION CASE, AND IT IS THE NORMAL ONE FOR A ROLLBACK.
                # The rollback artifact predates the universe column, so its rows are
                # UCT by definition. `breadth_ohlc_sync._merge_from` already resolves a
                # column-less snapshot to the literal 'uct'; this AGREES with it rather
                # than inventing a second rule for the same fact.
                c.execute(
                    "INSERT INTO main.%s"
                    "(universe, date, metric, o, h, l, c, source, updated_at) "
                    "SELECT 'uct', date, metric, o, h, l, c, source, updated_at "
                    "FROM snap.%s" % (OHLC_TABLE, OHLC_TABLE))
            else:
                shared = [x for x in live_cols if x in snap_cols]
                cols = ", ".join(shared)
                c.execute("INSERT INTO main.%s(%s) SELECT %s FROM snap.%s"
                          % (OHLC_TABLE, cols, cols, OHLC_TABLE))
            has_recon = c.execute(
                "SELECT COUNT(*) FROM snap.sqlite_master WHERE type='table' AND name=?",
                (RECON_TABLE,)).fetchone()[0]
            if has_recon:
                rl, rs = _columns(c, RECON_TABLE), _columns(c, RECON_TABLE, "snap")
                shared = [x for x in rl if x in rs]
                if shared:
                    cols = ", ".join(shared)
                    c.execute("DELETE FROM main.%s" % RECON_TABLE)
                    c.execute("INSERT INTO main.%s(%s) SELECT %s FROM snap.%s"
                              % (RECON_TABLE, cols, cols, RECON_TABLE))
                    recon = c.execute("SELECT COUNT(*) FROM main.%s"
                                      % RECON_TABLE).fetchone()[0]
            c.execute("COMMIT")
        except Exception:
            try:
                c.execute("ROLLBACK")
            except Exception:
                pass
            raise
        finally:
            try:
                c.execute("DETACH DATABASE snap")
            except Exception:
                pass
            c.close()

    out["installed"] = True
    out["live_after"] = live_universes()
    out["recon_rows"] = recon
    # ⭐⭐ AND THE INTERLOCK COMES BACK WITH IT. A rollback that leaves the database
    # UCT-only but the BL-028 index absent lands somewhere strictly WORSE than where it
    # started: pre-migration code still cannot write (no matching index), and the next
    # stray non-UCT write is no longer blocked either. `reinstate_compat_index()` is the
    # deliberate counterpart to `drop_compat_index()` — the act that made the store
    # UCT-only again is the act that restores the guard, rather than teaching init to
    # infer it and thereby undo a deliberate drop on the next pod restart.
    out["compat_index_reinstated"] = False
    if not any(u != "uct" for u in out["live_after"]):
        try:
            out["compat_index_reinstated"] = store.reinstate_compat_index()
        except Exception as e:              # noqa: BLE001 — never fail an installed restore
            _log.warning("[breadth_restore] could not reinstate the interlock: %s", e)
    out["compat_index_present"] = store.compat_index_present()
    _log.warning("[breadth_restore] RESTORED from %s: %s -> %s (universes removed: %s)",
                 os.path.basename(staged_db), before, out["live_after"],
                 losing or "none")
    return out


#: ⚠️ WHERE A ROLLBACK ARTIFACT ACTUALLY LIVES, AND WHY IT IS NOT `snap/`.
#: `breadth_ohlc_sync` prunes its snapshot prefix to the newest `_KEEP` (5) tarballs, and
#: the worker uploads on every wick-sweep completion — i.e. on every boot. So the
#: pre-migration artifact this whole phase depends on had a life expectancy of about two
#: uploads. A rollback target that expires on a timer nobody set is not a rollback target,
#: so the artifact is COPIED to a prefix the pruner does not scan, and `stage_from_r2`
#: takes an explicit `key` so the supported path can reach it.
ROLLBACK_PREFIX = "breadth_ohlc/rollback/"


def stage_from_r2(ts: str, *, expect_sha256: Optional[str] = None,
                  workdir: Optional[str] = None, key: Optional[str] = None) -> dict:
    """Download + verify a snapshot, returning the staged .db path. Installs nothing.

    `ts` names a tarball under the snapshot prefix; pass `key` to read an object stored
    anywhere else in the bucket — which is how a PRESERVED rollback artifact is reached
    after retention has pruned it out of `snap/`.
    """
    from api.services import breadth_ohlc_sync as sync
    client, bucket = sync._client(), sync._bucket()
    if not (client and bucket):
        raise RestoreRefused("R2 is not configured in this environment")
    key = key or "%s%s.tar.gz" % (sync._SNAP_PREFIX, ts)
    tmp = workdir or tempfile.mkdtemp(prefix="breadth_restore_")
    tar_path = os.path.join(tmp, "snapshot.tar.gz")
    # ⚠️ STREAMED TO DISK, never read() whole into memory — the same reason `data_sync`
    # streams, and doubly so on a pod with a recorded OOM history (BL-029).
    body = client.get_object(Bucket=bucket, Key=key)["Body"]
    with open(tar_path, "wb") as fh:
        while True:
            chunk = body.read(8 * 1024 * 1024)
            if not chunk:
                break
            fh.write(chunk)
    got = _sha256(tar_path)
    want = (expect_sha256 or "").rstrip("….  ")
    if want and not got.startswith(want):
        raise RestoreRefused(
            "snapshot %s sha256 %s… does not match the expected %s — refusing to stage "
            "an artifact we cannot identify" % (ts, got[:16], expect_sha256))
    with tarfile.open(tar_path) as tf:
        tf.extractall(tmp)
    dbs = [os.path.join(r, f) for r, _d, fs in os.walk(tmp)
           for f in fs if f.endswith(".db")]
    if len(dbs) != 1:
        raise RestoreRefused(
            "expected exactly one .db inside snapshot %s, found %s" % (ts, dbs))
    info = inspect_snapshot(dbs[0])
    info.update({"sha256": got, "key": key, "workdir": tmp})
    return info


def restore_from_r2(ts: str, *, expect_sha256: Optional[str] = None,
                    allow_universe_loss: bool = False, dry_run: bool = False,
                    key: Optional[str] = None) -> dict:
    """The operational entry point: an R2 snapshot -> the live breadth database."""
    staged = stage_from_r2(ts, expect_sha256=expect_sha256, key=key)
    try:
        out = restore_from_db(staged["path"], allow_universe_loss=allow_universe_loss,
                              dry_run=dry_run)
        out["staged"] = {k: staged[k] for k in
                         ("key", "sha256", "rows", "span", "migrated", "universes")}
        return out
    finally:
        shutil.rmtree(staged.get("workdir", ""), ignore_errors=True)
