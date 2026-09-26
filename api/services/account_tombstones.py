"""Account-deletion TOMBSTONES — no restore can bring a deleted account back (ruling R-9).

Wave 10, lane 10C (standard 7, clause 7b "account deletion purges backups").

⛔⛔ THE HAZARD. An account deletion purges the live database at once
(`account_purge.purge_user_data` + `auth._cascade_delete_user`). The BACKUPS still
hold the member: `authdb_backup` keeps the newest `RETAIN` auth.db snapshots in R2
and `j2_attachments_backup` keeps up to 14 days of attachment tarballs. Restore any
snapshot taken before the deletion and the member is back — every note, trade and
image — with nothing to say they asked to be forgotten. Rewriting the snapshots
would mean downloading, editing and re-uploading gzipped databases on every
deletion (plan D15 ruled that out).

⭐ THE RULING (R-9): a TOMBSTONE per deleted account, kept OFF the volume, and a
restore that REPLAYS every tombstone before anything is served. 7b counts MET when
live purge is immediate, every restore replays, and snapshots expire by RETAIN.

What a tombstone is: the member's id and the time, nothing else — no email, no
name, no content. Two copies:
  * a row in `account_tombstones` in auth.db, so every snapshot taken AFTER the
    deletion carries it (and a restore of one replays it from the snapshot itself);
  * an object `authdb/tombstones/<user_id>.json` in the SAME bucket the backups use,
    written at deletion time, so a restore of a snapshot taken BEFORE the deletion —
    including after losing the whole volume — still learns of it.
A tombstone whose off-site write failed is left `offsite_at IS NULL` and pushed by
the next backup run (`flush_pending`). ⚠️ The residual window is stated, not hidden:
a volume lost between a deletion whose off-site write failed and the next
successful backup loses that tombstone with the volume.

Tombstones are never pruned: a member id is the least data that can honour an
erasure against a copy we still hold, and a snapshot can outlive any fixed window
(`_KEEP_MIN` keeps the newest three attachment tarballs whatever their age).

⛔ THE OBJECT STORE IS AN INTERFACE. Production uses R2 through `data_sync`'s own
client and bucket (the `DATA_SYNC_*` variables the backup job already reads on
`web`). A sandbox or a test points `ACCOUNT_TOMBSTONE_LOCAL_STORE` at a directory
and gets a LOCAL fake with the same three calls — never a network, never R2.
"""
from __future__ import annotations

import datetime as _dt
import json
import logging
import os
import shutil
import sqlite3
from pathlib import Path
from typing import Any, Iterable

log = logging.getLogger("account_tombstones")

TABLE = "account_tombstones"
KEY_PREFIX = "authdb/tombstones/"
# The sandbox / test fake store. ⛔ Read at call time, and a directory, never a /data default.
LOCAL_STORE_ENV = "ACCOUNT_TOMBSTONE_LOCAL_STORE"
_SHARED_ROOTS = (Path("C:/data"), Path("/data"))


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


def _refuse_shared_root(path: Path) -> None:
    resolved = Path(path).resolve()
    for root in _SHARED_ROOTS:
        try:
            resolved.relative_to(root.resolve())
        except (ValueError, OSError):
            continue
        raise ValueError(f"refused: {resolved} is under the shared data root {root}")


# ── the object store ─────────────────────────────────────────────────────────────

class LocalObjectStore:
    """A directory standing in for the bucket: `put`, `list_keys`, `get`. Sandbox/test only."""

    def __init__(self, root: str | os.PathLike):
        self.root = Path(root)
        _refuse_shared_root(self.root)

    def _path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        p.relative_to(self.root.resolve())  # a key never escapes the store
        return p

    def put(self, key: str, data: bytes) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(p.suffix + ".part")
        tmp.write_bytes(data)
        os.replace(tmp, p)

    def list_keys(self, prefix: str) -> list[str]:
        base = self.root
        if not base.is_dir():
            return []
        out = []
        for p in base.rglob("*"):
            if p.is_file() and not p.name.endswith(".part"):
                k = p.relative_to(base).as_posix()
                if k.startswith(prefix):
                    out.append(k)
        return sorted(out)

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()


class R2ObjectStore:
    """The backups' own bucket, through `data_sync`'s client (the `DATA_SYNC_*` env)."""

    def __init__(self, client, bucket: str):
        self.client, self.bucket = client, bucket

    def put(self, key: str, data: bytes) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType="application/json")

    def list_keys(self, prefix: str) -> list[str]:
        out, token = [], None
        while True:
            kw = {"Bucket": self.bucket, "Prefix": prefix}
            if token:
                kw["ContinuationToken"] = token
            resp = self.client.list_objects_v2(**kw)
            out.extend(o["Key"] for o in resp.get("Contents", []) or [])
            if not resp.get("IsTruncated"):
                return sorted(out)
            token = resp.get("NextContinuationToken")

    def get(self, key: str) -> bytes:
        return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()


def default_store():
    """The local fake when `ACCOUNT_TOMBSTONE_LOCAL_STORE` names one; else R2 -- but ONLY
    while the auth.db backups are armed (`authdb_backup.is_enabled()`, i.e.
    `AUTHDB_BACKUP_ENABLED=1`, armed on `web`); else None (the tombstone stays pending).

    ⛔⛔ WHY THE BACKUP GATE AND NOT THE CREDENTIALS ALONE. `DATA_SYNC_*` is set on the
    owner's own machine (measured 2026-09-26), so "credentials present" would have let
    every unit test that deletes an account write a tombstone object into the REAL
    bucket. Tombstones exist to guard the backups, so they go beside the backups
    exactly when backups are being written -- one switch, already armed where it
    matters, off everywhere else. A tombstone recorded while it is off stays pending
    in the table, and the first backup run after it is armed pushes it."""
    local = os.environ.get(LOCAL_STORE_ENV, "").strip()
    if local:
        return LocalObjectStore(local)
    try:
        from api.services import authdb_backup, data_sync
        if not authdb_backup.is_enabled():
            return None
        client, bucket = data_sync._client(), data_sync._bucket()
    except Exception as e:  # noqa: BLE001 -- no boto3, bad env: pending, never a raise
        log.warning("[tombstones] no object store: %s", e)
        return None
    return R2ObjectStore(client, bucket) if (client and bucket) else None


def _key(user_id: str) -> str:
    return f"{KEY_PREFIX}{user_id}.json"


# ── writing ──────────────────────────────────────────────────────────────────────

def ensure_table(conn: sqlite3.Connection) -> None:
    """Self-ensured. ⛔ NO foreign key to users(id): `_cascade_delete_user` discovers
    what to wipe by `PRAGMA foreign_key_list`, and a tombstone must SURVIVE the very
    deletion it records."""
    conn.execute(
        f"CREATE TABLE IF NOT EXISTS {TABLE} ("
        " user_id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL, offsite_at TEXT)")


def record_tombstone(user_id: str, conn: sqlite3.Connection, *, store=None) -> dict[str, Any]:
    """Record that `user_id` was deleted: the row first (committed), then the off-site
    object. Never raises — a tombstone that could not be written must not fail the
    deletion, and says so in the answer."""
    if not user_id:
        return {"recorded": False, "offsite": False, "why": "no user id"}
    at = _now()
    try:
        ensure_table(conn)
        conn.execute(
            f"INSERT INTO {TABLE} (user_id, deleted_at, offsite_at) VALUES (?, ?, NULL)"
            f" ON CONFLICT(user_id) DO UPDATE SET deleted_at = excluded.deleted_at",
            (user_id, at))
        conn.commit()
    except sqlite3.Error as e:
        log.warning("[tombstones] could not record %s: %s", user_id, e)
        return {"recorded": False, "offsite": False, "why": f"{type(e).__name__}: {e}"}
    st = store if store is not None else default_store()
    if st is None:
        return {"recorded": True, "offsite": False,
                "why": "no object store configured -- pending; the next backup run pushes it"}
    try:
        st.put(_key(user_id), json.dumps({"v": 1, "user_id": user_id, "deleted_at": at}).encode("utf-8"))
        conn.execute(f"UPDATE {TABLE} SET offsite_at = ? WHERE user_id = ?", (_now(), user_id))
        conn.commit()
        return {"recorded": True, "offsite": True, "why": ""}
    except Exception as e:  # noqa: BLE001 -- the network, the bucket: pending, never a raise
        log.warning("[tombstones] off-site write for %s failed (pending): %s", user_id, e)
        return {"recorded": True, "offsite": False, "why": f"off-site write failed, pending: {type(e).__name__}"}


def flush_pending(conn: sqlite3.Connection, store) -> int:
    """Push every tombstone whose off-site write has not happened. Returns how many."""
    if store is None:
        return 0
    try:
        ensure_table(conn)
        rows = conn.execute(f"SELECT user_id, deleted_at FROM {TABLE} WHERE offsite_at IS NULL").fetchall()
    except sqlite3.Error:
        return 0
    pushed = 0
    for user_id, deleted_at in rows:
        try:
            store.put(_key(user_id), json.dumps({"v": 1, "user_id": user_id, "deleted_at": deleted_at}).encode("utf-8"))
            conn.execute(f"UPDATE {TABLE} SET offsite_at = ? WHERE user_id = ?", (_now(), user_id))
            conn.commit()
            pushed += 1
        except Exception as e:  # noqa: BLE001
            log.warning("[tombstones] flush of %s failed (still pending): %s", user_id, e)
    return pushed


# ── reading ──────────────────────────────────────────────────────────────────────

def offsite_tombstones(store) -> dict[str, str]:
    """{user_id: deleted_at} from the off-site store. Raises on a store error — a
    restore that could not READ the tombstones must stop, not proceed without them."""
    out: dict[str, str] = {}
    for key in store.list_keys(KEY_PREFIX):
        if not key.endswith(".json"):
            continue
        rec = json.loads(store.get(key).decode("utf-8"))
        if isinstance(rec, dict) and rec.get("user_id"):
            out[str(rec["user_id"])] = str(rec.get("deleted_at") or "")
    return out


def tombstones_in(conn: sqlite3.Connection) -> dict[str, str]:
    """{user_id: deleted_at} recorded in a database (a restored snapshot carries its own)."""
    try:
        return {r[0]: r[1] for r in conn.execute(f"SELECT user_id, deleted_at FROM {TABLE}")}
    except sqlite3.Error:
        return {}


def present_in(conn: sqlite3.Connection, user_ids: Iterable[str]) -> list[str]:
    """The tombstoned ids a database still holds a `users` row for."""
    out = []
    for uid in user_ids:
        try:
            if conn.execute("SELECT 1 FROM users WHERE id = ?", (uid,)).fetchone():
                out.append(uid)
        except sqlite3.Error:
            break
    return sorted(out)


# ── replay (every restore) ───────────────────────────────────────────────────────

def replay_on_db(conn: sqlite3.Connection, user_ids: Iterable[str]) -> dict[str, Any]:
    """Delete every tombstoned member from a RESTORED database, exactly as the live
    deletion did: the Journal/Notebook family (`account_purge.purge_user_rows`, rows
    only — NEVER the attachment directories, which on the machine running a drill are
    not the member's) and then every table that references `users(id)`
    (`auth._cascade_delete_user`, the one implementation of that walk).

    Idempotent. Records each replayed id in the restored database's own tombstone
    table, so a snapshot taken after the restore still knows."""
    ids = sorted({u for u in user_ids if u})
    replayed, errors = [], []
    if not ids:
        return {"replayed": [], "errors": [], "still_present": []}
    from api.services.journal_two import account_purge
    from api.routers.auth import _cascade_delete_user
    ensure_table(conn)
    for uid in ids:
        try:
            report = account_purge.purge_user_rows(uid, conn)
            errors.extend(f"{uid}: {e}" for e in report.get("errors", []))
            _cascade_delete_user(conn, uid)
            conn.execute(
                f"INSERT INTO {TABLE} (user_id, deleted_at, offsite_at) VALUES (?, ?, ?)"
                f" ON CONFLICT(user_id) DO NOTHING", (uid, _now(), _now()))
            conn.commit()
            replayed.append(uid)
        except Exception as e:  # noqa: BLE001 -- reported, and still_present says what it means
            errors.append(f"{uid}: {type(e).__name__}: {e}")
    return {"replayed": replayed, "errors": errors, "still_present": present_in(conn, ids)}


def replay_on_attachment_tree(root: str | os.PathLike, user_ids: Iterable[str]) -> list[str]:
    """Remove every tombstoned member's directory from a RESTORED attachment tree
    (`attachment_root()/<user_id>` is where every attachment of theirs lives — the
    same layout `purge_user_data` removes). Returns the ids whose directory was there.
    ⛔ Refuses the shared data root: this is for a tree restored somewhere, never the live one."""
    root = Path(root)
    _refuse_shared_root(root)
    removed = []
    for uid in sorted({u for u in user_ids if u}):
        d = root / uid
        if d.is_dir():
            shutil.rmtree(d)
            removed.append(uid)
    return removed
