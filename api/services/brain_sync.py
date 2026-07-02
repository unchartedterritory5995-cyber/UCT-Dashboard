"""Brain Pack consumer: pull the nightly uct-intelligence code+KB tarball
from R2 and install it atomically at <DATA_DIR>/brain.

Mirrors data_sync.py conventions (same env names, integrity check before
install). The installed layout is:
    <brain_dir>/uct_intelligence/*.py
    <brain_dir>/data/uct_intelligence.db
    <brain_dir>/PACK_MANIFEST.json
so the engine's hardcoded <package-parent>/data/... DB resolution works
untouched, and UCT_INTEL_PATH=<brain_dir> lights up api/routers/intelligence.py.

New engine *code* only takes effect on process restart (imports are cached);
the *DB* is re-read per connection so data refreshes apply immediately.
"""
from __future__ import annotations

import logging
import os
import shutil
import sqlite3
import tarfile
import tempfile
import time
from typing import Callable

log = logging.getLogger("brain_sync")

_INSTALL_CALLBACKS: list[Callable[[], None]] = []


def _data_dir() -> str:
    return os.environ.get("DATA_DIR", "/data")


def brain_dir() -> str:
    return os.environ.get("BRAIN_DIR", os.path.join(_data_dir(), "brain"))


def _marker_path() -> str:
    return os.path.join(_data_dir(), ".brain_last_ts")


def installed_ts() -> int:
    try:
        with open(_marker_path(), "r", encoding="utf-8") as fh:
            return int(fh.read().strip())
    except (OSError, ValueError):
        return 0


def on_install(fn: Callable[[], None]) -> None:
    """Register a callback fired after a successful pack install."""
    _INSTALL_CALLBACKS.append(fn)


def _s3_client():
    import boto3
    return boto3.client(
        "s3",
        endpoint_url=os.environ["DATA_SYNC_ENDPOINT_URL"],
        aws_access_key_id=os.environ["DATA_SYNC_ACCESS_KEY"],
        aws_secret_access_key=os.environ["DATA_SYNC_SECRET_KEY"],
        region_name=os.environ.get("DATA_SYNC_REGION", "auto"),
    )


def _safe_members(tf: tarfile.TarFile) -> list[tarfile.TarInfo]:
    out = []
    for m in tf.getmembers():
        name = m.name.replace("\\", "/")
        if name.startswith("/") or ".." in name.split("/"):
            raise ValueError(f"unsafe member path: {m.name}")
        if not m.isfile():
            continue
        out.append(m)
    return out


def sync_brain_pack(*, s3=None, force: bool = False) -> bool:
    """Check R2 for a newer Brain Pack; verify + atomically install it.

    Returns True when a new pack was installed. Never raises on the
    periodic path — logs and returns False.
    """
    try:
        bucket = os.environ["DATA_SYNC_BUCKET"]
        s3 = s3 or _s3_client()
        latest = int(s3.get_object(Bucket=bucket, Key="brain/latest.txt")["Body"].read().decode().strip())
        if not force and latest <= installed_ts():
            return False
        blob = s3.get_object(Bucket=bucket, Key=f"brain/{latest}.tar.gz")["Body"].read()

        staging = tempfile.mkdtemp(prefix=".brain-stage-", dir=_data_dir())
        try:
            with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as fh:
                fh.write(blob)
                tar_path = fh.name
            try:
                with tarfile.open(tar_path, "r:gz") as tf:
                    members = _safe_members(tf)
                    tf.extractall(staging, members=members)
            finally:
                os.unlink(tar_path)

            db_path = os.path.join(staging, "data", "uct_intelligence.db")
            pkg_init = os.path.join(staging, "uct_intelligence", "__init__.py")
            if not (os.path.isfile(db_path) and os.path.isfile(pkg_init)):
                raise ValueError("pack missing required members")
            conn = sqlite3.connect(db_path)
            try:
                if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise ValueError("pack DB failed integrity_check")
            finally:
                conn.close()

            target = brain_dir()
            if os.path.isdir(target):
                old = f"{target}.old-{int(time.time())}"
                shutil.move(target, old)
                shutil.move(staging, target)
                shutil.rmtree(old, ignore_errors=True)
            else:
                shutil.move(staging, target)
            staging = None
        finally:
            if staging and os.path.isdir(staging):
                shutil.rmtree(staging, ignore_errors=True)

        with open(_marker_path(), "w", encoding="utf-8") as fh:
            fh.write(str(latest))
        log.info("brain pack installed ts=%s at %s", latest, brain_dir())
        for fn in list(_INSTALL_CALLBACKS):
            try:
                fn()
            except Exception:
                log.exception("brain pack on_install callback failed")
        return True
    except Exception:
        log.exception("brain pack sync failed")
        return False


def start_background_sync(interval_seconds: int = 21600):
    """Boot pull + periodic refresh loop in a daemon thread (web pod)."""
    import threading

    def _loop():
        sync_brain_pack()
        while True:
            time.sleep(interval_seconds)
            sync_brain_pack()

    t = threading.Thread(target=_loop, name="brain_pack_sync", daemon=True)
    t.start()
    return t
