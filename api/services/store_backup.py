"""TERM-083 (FB-X1-02) — nightly R2 backup of the member-authored stores no other rail covers.

Ships **DARK**: gated by ``STORE_BACKUP_ENABLED`` (default off); the owner flips it on the web
service. ``tools/store_restore.py`` is the half that matters — *"a backup nobody has restored is
not a backup"* — and it reads everything this module writes.

WHAT WAS HERE BEFORE (measured 2026-09-27 at origin/master): three rails, each for one store —
``api/services/authdb_backup.py`` (auth.db, every 6h + nightly), ``api/flow_backup.py`` (flow.db,
nightly Mon-Sat) and ``api/j2_attachments_backup.py`` (the J2 image tree) — with a restore drill
for auth.db alone (``tools/authdb_restore_drill.py``). Every other store on the web volume had no
off-box copy, including the member posts in ``community.db``. This module is the generalised
schedule for the ones in ``STORES``; the two already covered are listed in ``COVERED_ELSEWHERE``
so they are never backed up twice. Since TERM-073 it also carries one RETAINED SERIES (the
analyst timeline in screener_analyst.db), a store worth keeping because the vendor cannot
re-serve its history.

Invariants (the same law the three sibling rails keep):
  * ⛔ NEVER a file copy of a hot WAL db. A raw copy of the main file misses every write still in
    ``-wal`` (on a young store, the whole schema). The copy is SQLite's online backup API.
  * The MANIFEST is measured on the SAME read snapshot the backup copies: the source connection
    opens a read transaction, counts every table, and the backup then runs on that connection,
    which reuses the open snapshot. So the manifest is what the backup saw, not a later reading.
  * ``PRAGMA integrity_check`` on the snapshot before it ships; a corrupt one is never uploaded.
  * An absent store is reported ``absent`` and never created (``sqlite3.connect`` would create it).
  * One store failing never stops the others, and nothing here raises into the scheduler.

R2 layout: ``store_backups/<store>/<YYYYMMDDTHHMMSSZ>.db.gz`` beside
``store_backups/<store>/<YYYYMMDDTHHMMSSZ>.manifest.json`` (uploaded after the db, so a manifest's
presence implies its db). The UTC stamp sorts lexicographically == chronologically.
"""
from __future__ import annotations

import datetime as _dt
import gzip
import hashlib
import importlib
import json
import logging
import os
import re
import shutil
import sqlite3
import tempfile
from dataclasses import dataclass
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

ENABLED_ENV = "STORE_BACKUP_ENABLED"
KEY_PREFIX = "store_backups/"
DB_SUFFIX = ".db.gz"
MANIFEST_SUFFIX = ".manifest.json"
#: Newest-N retention per store.
RETAIN = int(os.environ.get("STORE_BACKUP_KEEP", "14"))
#: A registered store whose newest object is older than this is named by stale_stores(). The job
#: is nightly, so this is two missed nights.
MAX_AGE_HOURS = 48
_TS_FMT = "%Y%m%dT%H%M%SZ"
_KEY_RE = re.compile(r"^store_backups/([a-z0-9_]+)/(\d{8}T\d{6}Z)\.db\.gz$")

CLASS_MEMBER = "member-authored"
CLASS_CURATED = "firm-curated"
#: A series that is retained BECAUSE it cannot be re-fetched: the vendor serves only the current
#: value, so a lost night is lost for good (TERM-073's analyst timeline).
CLASS_RETAINED = "retained-series"
CLASSES = (CLASS_MEMBER, CLASS_CURATED, CLASS_RETAINED)


@dataclass(frozen=True)
class Store:
    name: str
    klass: str
    module: str
    #: The owning module's own path authority: a module constant or a zero-arg function.
    attr: str


#: The stores this rail backs up. The PATH is read from the owning module at run time, never
#: restated here, so a store whose path moves takes its backup with it.
STORES: tuple[Store, ...] = (
    Store("community", CLASS_MEMBER, "api.services.community_store", "_db_path"),
    Store("charts_layouts", CLASS_MEMBER, "api.services.charts_layout_service", "_DB_PATH"),
    Store("user_definitions", CLASS_MEMBER, "api.services.user_definitions", "_DB_PATH"),
    Store("theme_sets", CLASS_MEMBER, "api.services.theme_sets", "_db_path"),
    Store("ai_search_member", CLASS_MEMBER, "api.services.ai_search_member", "_db_path"),
    Store("discord_chart_prefs", CLASS_MEMBER, "api.services.discord_chart_prefs", "_db_path"),
    Store("wire_feedback", CLASS_MEMBER, "api.services.wire_feedback_store", "_DB_PATH"),
    # TERM-021: the versioned workspace document. Registered the day it was built, so its
    # backup exists the night it is armed; until then the file is absent and reported so.
    Store("workspace_docs", CLASS_MEMBER, "api.services.workspace_doc_store", "_DB_PATH"),
    Store("modelbook", CLASS_CURATED, "api.services.modelbook_service", "_DB_PATH"),
    Store("education", CLASS_CURATED, "api.services.education_service", "_DB_PATH"),
    Store("desk", CLASS_CURATED, "api.services.desk_store", "_DB_PATH"),
    # TERM-073: the nightly analyst pass's `analyst_timeline` lives in this db. The whole file is
    # backed up (its `analyst_rows` / `analyst_runs` ride along); the timeline is why it is here.
    Store("screener_analyst", CLASS_RETAINED, "api.services.screener.analyst_pass", "get_db_path"),
)

#: Stores another rail already backs up. Never registered above.
COVERED_ELSEWHERE = {
    "auth": "api/services/authdb_backup.py -> authdb/backup/ (every 6h + nightly); drill: tools/authdb_restore_drill.py",
    "flow": "api/flow_backup.py -> flow_backups/ (nightly Mon-Sat)",
}


def is_enabled() -> bool:
    return os.environ.get(ENABLED_ENV, "0").strip().lower() in ("1", "true", "yes")


def _names(stores: Optional[Iterable[str]]) -> list[str]:
    return [s.name for s in STORES] if stores is None else list(stores)


def resolve_path(name: str) -> str:
    """The store's path, as its own module resolves it right now."""
    spec = next(s for s in STORES if s.name == name)
    val = getattr(importlib.import_module(spec.module), spec.attr)
    return str(val() if callable(val) else val)


def db_key(name: str, when: _dt.datetime) -> str:
    return f"{KEY_PREFIX}{name}/{when.astimezone(_dt.timezone.utc).strftime(_TS_FMT)}{DB_SUFFIX}"


def manifest_key(key: str) -> str:
    return key[: -len(DB_SUFFIX)] + MANIFEST_SUFFIX


def parse_key(key: str) -> Optional[tuple[str, _dt.datetime]]:
    """``store_backups/<name>/<stamp>.db.gz`` -> (name, taken UTC), else None."""
    m = _KEY_RE.match(key)
    if not m:
        return None
    return m.group(1), _dt.datetime.strptime(m.group(2), _TS_FMT).replace(tzinfo=_dt.timezone.utc)


# ── measuring a database ─────────────────────────────────────────────────────
def measure(conn: sqlite3.Connection) -> dict:
    """Schema digest, per-table row counts and journal mode, read through ``conn``.

    Counts come through SQL, so a WAL store's un-checkpointed rows are counted. The schema
    digest covers every sqlite_master row (tables, indexes, triggers, views)."""
    master = conn.execute(
        "SELECT type, name, tbl_name, COALESCE(sql, '') FROM sqlite_master ORDER BY type, name"
    ).fetchall()
    schema_sha = hashlib.sha256(json.dumps(master).encode("utf-8")).hexdigest()
    tables = {}
    for (name,) in conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
        tables[name] = conn.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
    mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
    return {"schema_sha256": schema_sha, "tables": tables, "journal_mode": str(mode).lower()}


def snapshot_with_manifest(src_path: str, dst_path: str) -> dict:
    """Online-backup ``src_path`` into ``dst_path`` and measure the source on the SAME snapshot.

    The read transaction is opened by the first SELECT in measure(); ``Connection.backup`` then
    runs on that connection, and SQLite's backup reuses a read transaction the source already
    holds, so the counts and the copied pages are one point in time."""
    src = sqlite3.connect(src_path, timeout=30)
    try:
        src.execute("BEGIN")
        measured = measure(src)
        dst = sqlite3.connect(dst_path)
        try:
            src.backup(dst)
        finally:
            dst.close()
        src.rollback()
        return measured
    finally:
        src.close()


def _integrity_ok(db_path: str) -> bool:
    """The full check, not quick_check. On our own temporary copy, so a plain open is safe."""
    if not os.path.exists(db_path):
        return False
    try:
        c = sqlite3.connect(db_path)
        try:
            return c.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
        finally:
            c.close()
    except sqlite3.DatabaseError:
        return False


def build_artifacts(name: str, src_path: str, workdir: str, now: _dt.datetime) -> dict:
    """Snapshot + integrity gate + gzip + manifest file. Returns paths and the manifest, or
    raises ValueError when the snapshot fails its integrity check (never shipped)."""
    snap = os.path.join(workdir, f"{name}.db")
    measured = snapshot_with_manifest(src_path, snap)
    if not _integrity_ok(snap):
        raise ValueError("snapshot failed integrity_check; not shipped")
    gz = snap + ".gz"
    with open(snap, "rb") as f_in, gzip.open(gz, "wb", compresslevel=6) as f_out:
        shutil.copyfileobj(f_in, f_out, length=1024 * 1024)
    manifest = {
        "store": name,
        "taken_at": now.astimezone(_dt.timezone.utc).isoformat(timespec="seconds"),
        "sqlite_version": sqlite3.sqlite_version,
        "db_bytes": os.path.getsize(snap),
        **measured,
    }
    man = os.path.join(workdir, f"{name}{MANIFEST_SUFFIX}")
    with open(man, "w", encoding="utf-8") as f:
        json.dump(manifest, f, sort_keys=True, indent=1)
    return {"gz": gz, "manifest_path": man, "manifest": manifest}


# ── the object store ─────────────────────────────────────────────────────────
def list_keys(client, bucket: str, prefix: str = KEY_PREFIX) -> list[str]:
    """Every key under ``prefix`` (paginated). Raises on a listing error — callers decide."""
    keys, token = [], None
    while True:
        kw = {"Bucket": bucket, "Prefix": prefix}
        if token:
            kw["ContinuationToken"] = token
        resp = client.list_objects_v2(**kw)
        keys.extend(o["Key"] for o in resp.get("Contents", []) or [])
        if not resp.get("IsTruncated"):
            return keys
        token = resp.get("NextContinuationToken")


def backups_by_store(client, bucket: str) -> dict[str, list[tuple[_dt.datetime, str]]]:
    """{store: [(taken, db key), ...] newest first} from the bucket listing."""
    out: dict[str, list[tuple[_dt.datetime, str]]] = {}
    for key in list_keys(client, bucket):
        parsed = parse_key(key)
        if parsed:
            out.setdefault(parsed[0], []).append((parsed[1], key))
    for v in out.values():
        v.sort(reverse=True)
    return out


def prune(client, bucket: str, name: str, keep: int = RETAIN) -> list[str]:
    """Delete all but the newest ``keep`` backups of ``name``, each with its manifest. Never raises."""
    deleted = []
    try:
        for _taken, key in backups_by_store(client, bucket).get(name, [])[keep:]:
            for k in (key, manifest_key(key)):
                try:
                    client.delete_object(Bucket=bucket, Key=k)
                    deleted.append(k)
                except Exception as e:  # noqa: BLE001
                    logger.warning("[store_backup] delete %s failed (non-fatal): %s", k, e)
    except Exception as e:  # noqa: BLE001
        logger.warning("[store_backup] prune %s failed (non-fatal): %s", name, e)
    return deleted


def backup_store(name: str, src_path: str, client, bucket: str, *, now: _dt.datetime) -> dict:
    """One store -> one object + its manifest. {status: ok|absent|error, ...}. Never raises."""
    if not os.path.exists(src_path):
        return {"status": "absent", "path": src_path}
    tmpdir = tempfile.mkdtemp(prefix=f"store_backup_{name}_")
    try:
        art = build_artifacts(name, src_path, tmpdir, now)
        key = db_key(name, now)
        client.upload_file(art["gz"], bucket, key, ExtraArgs={"ContentType": "application/gzip"})
        client.upload_file(art["manifest_path"], bucket, manifest_key(key),
                           ExtraArgs={"ContentType": "application/json"})
        return {"status": "ok", "key": key, "bytes": os.path.getsize(art["gz"]),
                "tables": len(art["manifest"]["tables"])}
    except Exception as e:  # noqa: BLE001 -- one store's failure is reported, never raised
        logger.error("[store_backup] %s failed: %s", name, e)
        return {"status": "error", "error": f"{type(e).__name__}: {e}"[:300]}
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def _r2():
    """The DATA_SYNC_* client with the R2 checksum knobs (api/flow_backup.py's, reused)."""
    from api import flow_backup
    return flow_backup._r2_client(), flow_backup._bucket()


def run_backup(*, now: Optional[_dt.datetime] = None, client=None, bucket=None,
               stores: Optional[Iterable[str]] = None) -> Optional[dict]:
    """Back up every registered store. None when dark or R2 is not configured; else
    {store: result}. Wholly exception-contained — safe to hand to the scheduler."""
    if not is_enabled():
        return None
    try:
        now = now or _dt.datetime.now(_dt.timezone.utc)
        if client is None:
            client, bucket = _r2()
        if not (client and bucket):
            logger.warning("[store_backup] R2 creds/bucket missing; skipping")
            return None
        out = {}
        for name in _names(stores):
            try:
                path = resolve_path(name)
            except Exception as e:  # noqa: BLE001
                out[name] = {"status": "error", "error": f"cannot resolve path: {e}"[:300]}
                continue
            out[name] = backup_store(name, path, client, bucket, now=now)
            if out[name]["status"] == "ok":
                prune(client, bucket, name)
        logger.info("[store_backup] %s", {k: v["status"] for k, v in out.items()})
        return out
    except Exception as e:  # noqa: BLE001
        logger.exception("[store_backup] run failed (non-fatal): %s", e)
        return None


def stale_stores(client, bucket: str, *, now: _dt.datetime, max_age_hours: float = MAX_AGE_HOURS,
                 stores: Optional[Iterable[str]] = None) -> list[tuple[str, str]]:
    """ARTEFACT-FIRST: [(store, why)] for every registered store with no object newer than the
    limit, by NAME. Reads the bucket, never a job's exit code. Raises on a listing error."""
    found = backups_by_store(client, bucket)
    out = []
    for name in _names(stores):
        objs = found.get(name)
        if not objs:
            out.append((name, "no backup object"))
            continue
        age = (now - objs[0][0]).total_seconds() / 3600
        if age > max_age_hours:
            out.append((name, f"newest backup is {age:.1f}h old (limit {max_age_hours:g}h): {objs[0][1]}"))
    return out


def register_jobs(scheduler) -> bool:
    """Nightly 03:05 ET (after auth.db's 02:55). Registers nothing while dark."""
    if not is_enabled():
        logger.info("[store_backup] disabled (%s unset)", ENABLED_ENV)
        return False
    from apscheduler.triggers.cron import CronTrigger
    from zoneinfo import ZoneInfo
    scheduler.add_job(run_backup, trigger=CronTrigger(hour=3, minute=5, timezone=ZoneInfo("America/New_York")),
                      id="store_backup_nightly", max_instances=1, replace_existing=True)
    return True
