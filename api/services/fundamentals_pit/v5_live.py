"""V5 LIVE STATE: the frozen base (read-only), the one live store (single writer), snapshots, and the lease.

    base/v5_frozen.db     byte copy of the frozen artifact; verified sha; 0444; only ever opened mode=ro
    base/artifacts/...    the frozen publication-format files (manifest verified)
    live/live.db          the production V5 store: a byte copy of base, then append-only ingestion + re-derivation
    snapshots/<ver>.db    live.db as it was when version <ver> was published (last KEEP kept, + the base)

⛔ Nothing here ever opens the base read-write. `verify_base()` re-hashes it; call it at checkpoints.
"""
from __future__ import annotations

import json
import os
import shutil
import socket
import sqlite3
import stat
import tarfile
import time

from . import v5_prod as VP

KEEP_SNAPSHOTS = 3

PIPELINE_SCHEMA = """
CREATE TABLE IF NOT EXISTS v5_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS v5_queue (
    accn TEXT PRIMARY KEY, cik INTEGER NOT NULL, form TEXT, source TEXT NOT NULL,
    discovered_at INTEGER NOT NULL, filed TEXT, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT, batch_id TEXT, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS v5_queue_state ON v5_queue(state, cik);
CREATE TABLE IF NOT EXISTS v5_batch (
    batch_id TEXT PRIMARY KEY, kind TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER,
    state TEXT NOT NULL, parent_version TEXT, version TEXT, record TEXT);
CREATE TABLE IF NOT EXISTS v5_version (
    version_id TEXT PRIMARY KEY, parent TEXT, manifest_sha256 TEXT NOT NULL, published_at INTEGER NOT NULL,
    batch_id TEXT, snapshot TEXT, record TEXT);
CREATE TABLE IF NOT EXISTS v5_pending (
    cik INTEGER PRIMARY KEY, boundary INTEGER, split_changed INTEGER NOT NULL DEFAULT 0, since INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS v5_ledger_change (
    cik INTEGER PRIMARY KEY, gained INTEGER NOT NULL DEFAULT 0, lost INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS v5_quarantine (
    cik INTEGER PRIMARY KEY, since INTEGER NOT NULL, batch_id TEXT, reason TEXT NOT NULL);
"""


class LiveError(RuntimeError):
    pass


def _ro(path: str) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=60)


# ── base ────────────────────────────────────────────────────────────────────
def verify_base(p: dict | None = None) -> dict:
    p = p or VP.paths()
    if not os.path.exists(p["base_db"]):
        raise LiveError("base not installed")
    got = VP.sha256_file(p["base_db"])
    size = os.path.getsize(p["base_db"])
    ok = got == VP.FROZEN_SHA256 and size == VP.FROZEN_BYTES
    if not ok:
        raise LiveError(f"FROZEN BASE CHANGED: sha {got} bytes {size}")
    return {"sha256": got, "bytes": size, "ok": True}


def install_base(p: dict | None = None, *, fetch_bundle=None) -> dict:
    """Download the private frozen archive, verify it end to end, and lay out base/. Idempotent: a verified base
    is left alone. `fetch_bundle(dest_path)` defaults to the R2 archive."""
    p = p or VP.paths()
    if os.path.exists(p["base_db"]):
        return {"installed": False, "already": verify_base(p)}
    os.makedirs(p["work"], exist_ok=True)
    bundle = os.path.join(p["work"], "v5_frozen_bundle.tar.gz")
    if fetch_bundle is None:
        from api.services import data_sync
        cl, bucket = data_sync._client(), data_sync._bucket()
        cl.download_file(bucket, VP.ARCHIVE_PREFIX + "v5_frozen_bundle.tar.gz", bundle)
    else:
        fetch_bundle(bundle)
    if VP.sha256_file(bundle) != VP.ARCHIVE_BUNDLE_SHA256:
        raise LiveError("archive bundle sha mismatch")
    stage = p["base_dir"] + ".staging"
    shutil.rmtree(stage, ignore_errors=True)
    os.makedirs(stage)
    want = {"fundamentals_pit_v5/run/v5.db": "v5_frozen.db", "fundamentals_pit_v5/freeze.json": "freeze.json",
            "fundamentals_pit_v5/artifacts/manifest.json": "artifacts/manifest.json"}
    n_art = 0
    with tarfile.open(bundle, "r:gz") as tf:
        for m in tf:
            if not m.isfile() or ".." in m.name.split("/"):
                continue
            if m.name in want:
                rel = want[m.name]
            elif m.name.startswith("fundamentals_pit_v5/artifacts/fundamentals_pit/v5/cik/") and m.name.endswith(".json"):
                rel = "artifacts/" + m.name.rsplit("/", 1)[1]
                n_art += 1
            else:
                continue
            dst = os.path.join(stage, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with tf.extractfile(m) as src, open(dst, "wb") as out:
                shutil.copyfileobj(src, out, 1 << 20)
    db = os.path.join(stage, "v5_frozen.db")
    if VP.sha256_file(db) != VP.FROZEN_SHA256 or os.path.getsize(db) != VP.FROZEN_BYTES:
        raise LiveError("frozen db in bundle does not match the frozen sha")
    if VP.sha256_file(os.path.join(stage, "freeze.json")) != VP.FREEZE_JSON_SHA256:
        raise LiveError("freeze.json mismatch")
    man_p = os.path.join(stage, "artifacts", "manifest.json")
    if VP.sha256_file(man_p) != VP.FROZEN_ARTIFACT_MANIFEST_SHA256:
        raise LiveError("artifact manifest mismatch")
    man = json.load(open(man_p))
    bad = [c for c, e in man["artifacts"].items()
           if VP.sha256_file(os.path.join(stage, "artifacts", f"{c}.json")) != e["sha256"]]
    if bad or n_art != len(man["artifacts"]):
        raise LiveError(f"artifact verification failed: {len(bad)} bad, {n_art} vs {len(man['artifacts'])}")
    for dp, _, fs in os.walk(stage):
        for f in fs:
            os.chmod(os.path.join(dp, f), stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
    os.replace(stage, p["base_dir"])
    os.remove(bundle)
    return {"installed": True, "artifacts": n_art, "base": verify_base(p)}


def base_artifact_bodies(p: dict | None = None) -> dict[int, bytes]:
    """The frozen publication-format files, byte for byte (the v5-base version publishes exactly these)."""
    p = p or VP.paths()
    man = json.load(open(os.path.join(p["base_artifacts"], "manifest.json")))
    out = {}
    for c, e in man["artifacts"].items():
        b = open(os.path.join(p["base_artifacts"], f"{c}.json"), "rb").read()
        if VP.sha256_file(os.path.join(p["base_artifacts"], f"{c}.json")) != e["sha256"]:
            raise LiveError(f"base artifact {c} changed")
        out[int(c)] = b
    return out


# ── live ────────────────────────────────────────────────────────────────────
def init_live(p: dict | None = None) -> dict:
    """live.db = byte copy of the verified base, then the pipeline tables. Refuses if live exists."""
    p = p or VP.paths()
    if os.path.exists(p["live_db"]):
        raise LiveError("live.db already exists; refusing to re-initialise")
    verify_base(p)
    os.makedirs(p["live_dir"], exist_ok=True)
    tmp = p["live_db"] + ".init"
    shutil.copyfile(p["base_db"], tmp)
    os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IROTH)
    if VP.sha256_file(tmp) != VP.FROZEN_SHA256:
        raise LiveError("copy of base does not match")
    os.replace(tmp, p["live_db"])
    conn = connect_live(p)
    try:
        lineage = {"base_run_id": VP.RUN_ID, "base_sha256": VP.FROZEN_SHA256, "base_version": VP.BASE_VERSION_ID,
                   "methodology_commit": VP.METHODOLOGY_COMMIT, "initialised_at": int(time.time())}
        with conn:
            conn.execute("INSERT OR REPLACE INTO v5_meta VALUES ('lineage', ?)", (json.dumps(lineage),))
    finally:
        conn.close()
    verify_base(p)
    return lineage


def connect_live(p: dict | None = None) -> sqlite3.Connection:
    from . import store as S
    p = p or VP.paths()
    if not os.path.exists(p["live_db"]):
        raise LiveError("live.db not initialised")
    conn = S.connect(p["live_db"])
    conn.executescript(PIPELINE_SCHEMA)
    return conn


def meta_get(conn, k: str, default=None):
    r = conn.execute("SELECT v FROM v5_meta WHERE k=?", (k,)).fetchone()
    return json.loads(r[0]) if r else default


def meta_set(conn, k: str, v) -> None:
    with conn:
        conn.execute("INSERT OR REPLACE INTO v5_meta VALUES (?, ?)", (k, json.dumps(v, default=str)))


def snapshot(conn, version_id: str, p: dict | None = None) -> str:
    p = p or VP.paths()
    os.makedirs(p["snapshots"], exist_ok=True)
    dst = os.path.join(p["snapshots"], f"{version_id}.db")
    tmp = dst + ".tmp"
    out = sqlite3.connect(tmp)
    try:
        conn.backup(out)
    finally:
        out.close()
    os.replace(tmp, dst)
    snaps = sorted((f for f in os.listdir(p["snapshots"]) if f.endswith(".db")),
                   key=lambda f: os.path.getmtime(os.path.join(p["snapshots"], f)))
    for f in snaps[:-KEEP_SNAPSHOTS]:
        os.remove(os.path.join(p["snapshots"], f))
    return dst


# ── ownership ───────────────────────────────────────────────────────────────
class Lease:
    """The ONE writer: an exclusive flock on the volume for the life of the holder, plus a durable record."""

    def __init__(self, p: dict | None = None):
        self.p = p or VP.paths()
        self.fd = None

    def acquire(self) -> bool:
        os.makedirs(self.p["root"], exist_ok=True)
        fd = open(self.p["lock"], "a+")
        try:
            try:
                import fcntl
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except ImportError:                          # Windows dev: byte-range lock
                import msvcrt
                fd.seek(0)
                msvcrt.locking(fd.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            fd.close()
            return False
        fd.seek(0); fd.truncate()
        fd.write(json.dumps({"pid": os.getpid(), "host": socket.gethostname(), "at": int(time.time())}))
        fd.flush()
        self.fd = fd
        return True

    def release(self) -> None:
        if self.fd is not None:
            try:
                try:
                    import fcntl
                    fcntl.flock(self.fd, fcntl.LOCK_UN)
                except ImportError:
                    pass
            finally:
                self.fd.close()
                self.fd = None


def held(p: dict | None = None) -> bool:
    return os.path.exists((p or VP.paths())["hold"])
