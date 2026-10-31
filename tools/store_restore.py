"""TERM-083 (FB-X1-02) — the restore procedure and the restore REHEARSAL for store_backup's objects.

    python tools/store_restore.py --list                    # newest object per store + the STALE ones, by name
    python tools/store_restore.py --rehearse                # every registered store, newest object, from R2
    python tools/store_restore.py --rehearse --store community --report out.md
    python tools/store_restore.py --file X.db.gz --manifest X.manifest.json   # an object downloaded by hand
    python tools/store_restore.py --round-trip COPY.db      # the whole mechanism on a copy you own, no R2
    python tools/store_restore.py --restore KEY_OR_FILE --to PATH [--replace] # the REAL restore (owner only)

A backup nobody has restored is not a backup, and a backup job's exit code is a proxy: the
artefact is the object. The rehearsal downloads each store's newest object into a fresh temp
directory, restores it there with the SAME procedure a real restore uses (``restore_file``), and
checks the restored copy against the manifest written at backup time:

  * ``PRAGMA integrity_check`` is ``ok`` (the full check, not quick_check);
  * the schema digest, the table set and EVERY table's row count equal the manifest's — the
    manifest was measured on the same read snapshot the backup copied, so a backup that dropped
    WAL-resident writes or a table fails here BY TABLE NAME;
  * the journal mode came back as the source had it (a WAL store restores as WAL);
  * the newest object is younger than ``store_backup.MAX_AGE_HOURS``.

Exit codes (the auth.db drill's, imported): 0 PASS · 1 FAIL · 2 INCONCLUSIVE (no credentials,
an empty bucket, no manifest, a download error). An unknown is never a pass. A registered store
with NO object, while others have one, is a FAIL by name.

The rehearsal restores nothing anywhere real: it refuses a work directory or report under the
shared data root (``C:\\data`` / ``/data``) and deletes its temp directory unless ``--keep``.

⛔⛔ THE REAL RESTORE (``--restore``) IS OWNER-ONLY, and it is the one mode that writes a store:

  1. It rehearses the chosen object first, in a temp directory, and refuses unless that PASSES.
  2. It refuses an existing target unless ``--replace``, and refuses a stray ``-wal``/``-shm``
     beside an absent target: a stale WAL left beside a restored main file is replayed onto it.
  3. With ``--replace`` it MOVES the existing file and its ``-wal``/``-shm`` aside to
     ``<name>.pre-restore-<UTC stamp>`` — never a delete — then renames the restored copy in.
  4. ⛔ A MEMBER STORE `account_tombstones.STORE_REPLAYS` names (today: ``user_definitions``)
     is put back only after every account-deletion tombstone is replayed on the restored copy
     (the off-site tombstones; ``--auth-db PATH`` adds the live table's pending ones). An
     unreadable tombstone list, a replay error, or a deleted member still present refuses the
     restore and leaves the target untouched. DISASTER OVERRIDES, documented in
     docs/runbooks/backup-encryption.md: ``--tombstones-file PATH`` / ``--auth-db PATH`` as the
     only source, or ``--allow-unreplayed`` with none; either way the off-site list was not
     read, so the unverified member ids are printed and a pending marker is written beside the
     store for ``api/services/tombstone_sweep.py`` to finish.
  5. ⛔ Every writer of that store must be stopped first. The web process holds these stores
     open; a restore under a live writer is not a restore.

The key layout, the client and the store list come from ``api/services/store_backup.py``, so
this cannot drift from what the backup job writes.

⛔⛔ ENCRYPTED BACKUPS (2026-10-22). New objects are ``<stamp>.db.gz.enc`` beside
``<stamp>.manifest.json.enc`` (UCTBK1, ``api/services/backup_crypto.py``). Every mode decrypts
them with ``--private-key PATH`` or ``BACKUP_PRIVATE_KEY_PATH`` (passphrase:
``BACKUP_PRIVATE_KEY_PASSPHRASE``); legacy plaintext objects need no key. An encrypted object
with no key is INCONCLUSIVE; one that will not decrypt is a FAIL.
Runbook: docs/runbooks/backup-encryption.md.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import os
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from api.services import backup_crypto as bc  # noqa: E402
from api.services import store_backup as sb  # noqa: E402
from tools.authdb_restore_drill import FAIL, INCONCLUSIVE, PASS, refuse_shared_root  # noqa: E402

_WORD = {PASS: "PASS", FAIL: "FAIL", INCONCLUSIVE: "INCONCLUSIVE"}
_CODE = {v: k for k, v in _WORD.items()}


class RestoreRefused(Exception):
    """The restore procedure would not write — the message says why."""


class _Unreadable(Exception):
    """An encrypted object that could not be opened: INCONCLUSIVE (no key) or FAIL (won't decrypt)."""

    def __init__(self, verdict: str, why: str):
        super().__init__(why)
        self.verdict, self.why = verdict, why


def _resolve_key(private_key: bytes | None) -> tuple[bytes | None, str | None]:
    """The key given, else BACKUP_PRIVATE_KEY_PATH's, else (None, why-not)."""
    if private_key:
        return private_key, None
    try:
        pem = bc.load_private_key(None)
    except bc.BackupKeyError as exc:
        return None, str(exc)
    return (pem, None) if pem else (None, f"no private key given (--private-key PATH or {bc.PRIVATE_KEY_PATH_ENV})")


def plaintext(path, work: Path, private_key: bytes | None):
    """A legacy plaintext object unchanged; an encrypted one decrypted into ``work``."""
    if path is None or not Path(path).is_file() or not bc.is_encrypted(path):
        return path
    pem, why = _resolve_key(private_key)
    if pem is None:
        raise _Unreadable("INCONCLUSIVE", f"{Path(path).name} is encrypted: {why}")
    try:
        return bc.decrypt_if_encrypted(path, work, pem)
    except bc.BackupDecryptError as exc:
        raise _Unreadable("FAIL", f"cannot decrypt {Path(path).name}: {exc}") from exc


# ── the restore procedure (used by the rehearsal AND the real restore) ──────
def restore_file(gz: Path, dest: Path, *, now: dt.datetime, replace: bool = False,
                 prepare=None) -> dict:
    """``prepare(path)`` runs on the decompressed, integrity-checked copy BEFORE anything is
    moved aside or renamed in (the account-deletion tombstone replay); a raise refuses the
    restore and leaves the target exactly as it was."""
    gz, dest = Path(gz), Path(dest)
    wal, shm = Path(f"{dest}-wal"), Path(f"{dest}-shm")
    if dest.exists() and not replace:
        raise RestoreRefused(f"{dest} exists; stop every writer, then pass --replace")
    if not dest.exists():
        for stray in (wal, shm):
            if stray.exists():
                raise RestoreRefused(f"{stray} exists beside an absent {dest.name}: a stale -wal is "
                                     "replayed onto whatever main file appears; move it aside first")
    tmp = dest.with_name(dest.name + ".restoring")
    try:
        with gzip.open(gz, "rb") as f_in, open(tmp, "wb") as f_out:
            shutil.copyfileobj(f_in, f_out, length=1024 * 1024)
    except (OSError, EOFError) as exc:
        tmp.unlink(missing_ok=True)
        raise RestoreRefused(f"not a readable gzip: {exc}") from exc
    if not sb._integrity_ok(str(tmp)):
        tmp.unlink(missing_ok=True)
        raise RestoreRefused("the restored copy fails integrity_check")
    prepared = None
    if prepare is not None:
        try:
            prepared = prepare(tmp)
        except Exception as exc:  # noqa: BLE001 -- any failure refuses; the target is untouched
            tmp.unlink(missing_ok=True)
            raise RestoreRefused(f"not restored: {exc}") from exc
    moved = []
    if dest.exists():
        aside = dest.with_name(f"{dest.name}.pre-restore-{now.astimezone(dt.timezone.utc).strftime(sb._TS_FMT)}")
        for suffix in ("", "-wal", "-shm"):
            src = Path(f"{dest}{suffix}")
            if src.exists():
                os.replace(src, Path(f"{aside}{suffix}"))
        moved.append(str(aside))
    os.replace(tmp, dest)
    return {"restored_to": str(dest), "moved_aside": moved, "prepared": prepared}


# ── account deletion: no restore brings a deleted member's rows back (ruling R-9) ──
def _ids_from_file(path: Path) -> dict[str, str]:
    """A LOCAL tombstone list: a directory holding a copy of the bucket's tombstone objects
    (``authdb/tombstones/<id>.json``, the layout `account_tombstones.LocalObjectStore` reads), or
    a JSON file -- ``{"<id>": "<deleted_at>", ...}``, ``["<id>", ...]`` or
    ``[{"user_id": "<id>", "deleted_at": ...}, ...]``. Raises on anything else."""
    from api.services import account_tombstones as at
    path = Path(path)
    if path.is_dir():
        return dict(at.offsite_tombstones(at.LocalObjectStore(path)))
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        return {str(k): str(v or "") for k, v in data.items() if k}
    if isinstance(data, list):
        out = {}
        for item in data:
            if isinstance(item, str) and item:
                out[item] = ""
            elif isinstance(item, dict) and item.get("user_id"):
                out[str(item["user_id"])] = str(item.get("deleted_at") or "")
            else:
                raise ValueError(f"not a tombstone entry: {item!r}")
        return out
    raise ValueError("a tombstone file is a JSON object or list")


def tombstone_sources(store, *, auth_db: Path | None = None, tombstones_file: Path | None = None) -> dict:
    """Every tombstone this restore can read, and from where. Read-only.

    ``offsite_read`` is True only when the off-site store (the backups' own bucket, or the
    ``ACCOUNT_TOMBSTONE_LOCAL_STORE`` fake) was listed and read in full: that is the one source
    that holds EVERY deletion, including those taken after any local copy. The other two are
    the documented disaster overrides -- ``tombstones_file`` (a local copy/export of the store)
    and ``auth_db`` (the live table, which also holds a tombstone whose off-site write is still
    pending) -- and a restore that relied on them alone writes the pending marker."""
    from api.services import account_tombstones as at
    out = {"ids": {}, "sources": [], "offsite_read": False, "offsite_error": None}
    if store is None:
        out["offsite_error"] = ("no tombstone store (AUTHDB_BACKUP_ENABLED + DATA_SYNC_*, or "
                                f"{at.LOCAL_STORE_ENV})")
    else:
        try:
            out["ids"].update(at.offsite_tombstones(store))
            out["sources"].append("off-site store")
            out["offsite_read"] = True
        except Exception as exc:  # noqa: BLE001 -- reported; the caller decides
            out["offsite_error"] = f"{type(exc).__name__}: {exc}"
    if tombstones_file is not None:
        out["ids"].update(_ids_from_file(Path(tombstones_file)))
        out["sources"].append(f"tombstones file {tombstones_file}")
    if auth_db is not None:
        if not Path(auth_db).is_file():
            raise FileNotFoundError(str(auth_db))
        conn = sqlite3.connect(f"file:{Path(auth_db).as_posix()}?mode=ro", uri=True)
        try:
            conn.execute("SELECT 1 FROM sqlite_master").fetchone()     # an unreadable file raises here
            out["ids"].update(at.tombstones_in(conn))
        finally:
            conn.close()
        out["sources"].append(f"auth.db {auth_db}")
    return out


def replay_preparer(name: str, ids: dict[str, str]):
    """The ``prepare`` hook for a store `account_tombstones.STORE_REPLAYS` names, else None.

    It replays every tombstone on the restored copy, records who owns rows in it afterwards,
    and then CHECKPOINTS: the restored copy is a WAL store, and `restore_file` renames only
    the MAIN file in -- a replay whose deletes were still in ``-wal`` would be renamed in
    without them. So the WAL is checkpointed with TRUNCATE before close, and a busy checkpoint
    or a ``-wal`` with content left beside the copy refuses. It RAISES on any replay error,
    any deleted member still present, or any copy still naming one as its author."""
    from api.services import account_tombstones as at
    replay = at.STORE_REPLAYS.get(name)
    if replay is None:
        return None
    members = at.STORE_MEMBERS.get(name)

    def prepare(path: Path) -> dict:
        conn = sqlite3.connect(str(path))
        try:
            rep = replay(conn, list(ids))
            rep["members"] = members(conn) if members else []
            busy = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
        finally:
            conn.close()
        if rep["errors"] or rep["still_present"] or rep.get("authors_remaining"):
            raise RestoreRefused(f"tombstone replay on {name}: errors={rep['errors']} "
                                 f"still_present={rep['still_present']} "
                                 f"authors_remaining={rep.get('authors_remaining')}")
        wal = Path(f"{path}-wal")
        if (busy and busy[0]) or (wal.exists() and wal.stat().st_size > 0):
            raise RestoreRefused(f"the replayed copy of {name} could not be checkpointed "
                                 f"(busy={busy}); its deletes would not travel with the main file")
        return rep
    return prepare


def _with_pending_marker(prepare, dest: Path, *, name: str, now: dt.datetime, sources: dict):
    """`prepare`, then the pending marker -- both before `restore_file` moves or renames."""
    def wrapped(path: Path) -> dict:
        rep = prepare(path)
        rep["marker"] = str(write_pending_marker(dest, name=name, now=now, sources=sources,
                                                 replayed=list(sources["ids"]),
                                                 unverified=rep.get("members") or []))
        return rep
    return wrapped


def write_pending_marker(dest: Path, *, name: str, now: dt.datetime, sources: dict,
                         replayed: list, unverified: list) -> Path:
    """The record a restore leaves when it could not verify against the off-site tombstones.
    `api/services/tombstone_sweep.py` replays the off-site list on the live store once it can
    be read, then retires this file."""
    from api.services import user_definitions_erasure as ude
    marker = Path(f"{dest}{ude.PENDING_MARKER_SUFFIX}")
    body = {"store": name, "restored_to": str(dest),
            "restored_at": now.astimezone(dt.timezone.utc).isoformat(timespec="seconds"),
            "sources": sources["sources"], "offsite_error": sources["offsite_error"],
            "replayed_ids": sorted(replayed), "unverified_user_ids": sorted(unverified)}
    tmp = marker.with_name(marker.name + ".part")
    tmp.write_text(json.dumps(body, indent=1, sort_keys=True), encoding="utf-8")
    os.replace(tmp, marker)
    return marker


# ── the rehearsal ────────────────────────────────────────────────────────────
def compare(manifest: dict, restored: dict) -> list[str]:
    """Every way the restored copy differs from what the backup recorded, by name."""
    reasons = []
    want, got = manifest.get("tables", {}), restored.get("tables", {})
    missing = sorted(set(want) - set(got))
    extra = sorted(set(got) - set(want))
    if missing:
        reasons.append(f"missing tables: {', '.join(missing)}")
    if extra:
        reasons.append(f"tables not in the manifest: {', '.join(extra)}")
    for t in sorted(set(want) & set(got)):
        if want[t] != got[t]:
            reasons.append(f"{t}: backup had {want[t]}, restore has {got[t]}")
    if manifest.get("schema_sha256") != restored.get("schema_sha256"):
        reasons.append("schema differs from the manifest")
    if manifest.get("journal_mode") != restored.get("journal_mode"):
        reasons.append(f"journal_mode: backup {manifest.get('journal_mode')}, restore {restored.get('journal_mode')}")
    return reasons


def rehearse_file(name: str, gz: Path, manifest_path: Path | None, work: Path, *,
                  now: dt.datetime, taken: dt.datetime | None,
                  private_key: bytes | None = None) -> dict:
    """Restore ``gz`` into ``work`` with restore_file and check it against the manifest.
    Encrypted objects (db and manifest) are decrypted first with ``private_key`` (default:
    BACKUP_PRIVATE_KEY_PATH)."""
    refuse_shared_root(work)
    work.mkdir(parents=True, exist_ok=True)
    out = {"verdict": "INCONCLUSIVE", "reasons": [], "restored": None, "manifest": None}
    try:
        gz = plaintext(gz, work, private_key)
        manifest_path = plaintext(manifest_path, work, private_key)
    except _Unreadable as exc:
        out["verdict"] = exc.verdict
        out["reasons"].append(exc.why)
        return out
    manifest = None
    if manifest_path is not None and Path(manifest_path).is_file():
        try:
            manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
        except ValueError as exc:
            out["reasons"].append(f"manifest is not JSON: {exc}")
    out["manifest"] = manifest
    dest = work / f"{name}.db"
    try:
        restore_file(gz, dest, now=now)
    except RestoreRefused as exc:
        out["verdict"] = "FAIL"
        out["reasons"].append(str(exc))
        return out
    conn = sqlite3.connect(str(dest))
    try:
        rows = conn.execute("PRAGMA integrity_check").fetchall()
        restored = sb.measure(conn)
        restored["integrity"] = "ok" if rows == [("ok",)] else "; ".join(r[0] for r in rows[:5])
    finally:
        conn.close()
    out["restored"] = restored
    if restored["integrity"] != "ok":
        out["reasons"].append(f"integrity_check: {restored['integrity']}")
    if manifest is not None:
        out["reasons"] += compare(manifest, restored)
    if taken is not None and now - taken > dt.timedelta(hours=sb.MAX_AGE_HOURS):
        out["reasons"].append(f"newest backup is {(now - taken).total_seconds() / 3600:.1f}h old "
                              f"(limit {sb.MAX_AGE_HOURS}h)")
    if out["reasons"]:
        out["verdict"] = "FAIL"
    elif manifest is None:
        out["reasons"].append("no manifest beside this object: nothing to compare the restore against")
    else:
        out["verdict"] = "PASS"
    return out


def _overall(results: dict) -> int:
    verdicts = {r["verdict"] for r in results.values()}
    if "FAIL" in verdicts:
        return FAIL
    if "INCONCLUSIVE" in verdicts or not verdicts:
        return INCONCLUSIVE
    return PASS


def rehearse_stores(client, bucket, *, now: dt.datetime, work: Path, stores=None,
                    private_key: bytes | None = None) -> dict:
    """The newest object of each store, from the bucket, rehearsed. {verdict: code, stores: {...}}."""
    refuse_shared_root(work)
    names = sb._names(stores)
    results: dict[str, dict] = {}

    def unknown(why):
        return {"verdict": "INCONCLUSIVE", "reasons": [why], "restored": None, "manifest": None}

    if not (client and bucket):
        results = {n: unknown("R2 credentials not set (DATA_SYNC_*)") for n in names}
        return {"verdict": _overall(results), "stores": results}
    try:
        found = sb.backups_by_store(client, bucket)
    except Exception as exc:  # noqa: BLE001 -- the network, credentials, the bucket
        results = {n: unknown(f"could not list {sb.KEY_PREFIX}: {exc}") for n in names}
        return {"verdict": _overall(results), "stores": results}
    if not found:
        results = {n: unknown(f"nothing under {sb.KEY_PREFIX} at all: the rail has never written "
                              f"(is {sb.ENABLED_ENV} set on web?)") for n in names}
        return {"verdict": _overall(results), "stores": results}
    for name in names:
        objs = found.get(name)
        if not objs:
            results[name] = {"verdict": "FAIL", "reasons": ["no backup object"], "restored": None, "manifest": None}
            continue
        taken, key = objs[0]
        sub = work / name
        sub.mkdir(parents=True, exist_ok=True)
        gz, man = sub / Path(key).name, sub / Path(sb.manifest_key(key)).name
        try:
            client.download_file(bucket, key, str(gz))
        except Exception as exc:  # noqa: BLE001
            results[name] = unknown(f"could not download {key}: {exc}")
            continue
        try:
            client.download_file(bucket, sb.manifest_key(key), str(man))
        except Exception:  # noqa: BLE001 -- a missing manifest is reported by rehearse_file
            man = None
        res = rehearse_file(name, gz, man, sub / "restore", now=now, taken=taken,
                            private_key=private_key)
        res["key"] = key
        results[name] = res
    return {"verdict": _overall(results), "stores": results}


def round_trip(src: Path, work: Path, *, now: dt.datetime) -> dict:
    """The whole mechanism, no object store: the backup rail's own snapshot + manifest, then the
    rehearsal's restore and compare. For a synthetic store or a copy you own."""
    refuse_shared_root(Path(src))
    refuse_shared_root(work)
    name = Path(src).stem
    (work / "backup").mkdir(parents=True, exist_ok=True)
    (work / "restore").mkdir(parents=True, exist_ok=True)
    art = sb.build_artifacts(name, str(src), str(work / "backup"), now)
    return rehearse_file(name, Path(art["gz"]), Path(art["manifest_path"]), work / "restore", now=now, taken=now)


# ── the report ───────────────────────────────────────────────────────────────
def render(results: dict, code: int, now: dt.datetime, stale=None) -> str:
    lines = [f"# store restore rehearsal - {_WORD[code]}", "", f"- run at: {now.isoformat(timespec='seconds')}", ""]
    for name, r in results.items():
        restored = r.get("restored") or {}
        tables = restored.get("tables") or {}
        lines.append(f"## {name}: {r['verdict']}")
        if r.get("key"):
            lines.append(f"- object: `{r['key']}`")
        if tables:
            lines.append(f"- restored: {len(tables)} tables, {sum(tables.values()):,} rows, "
                         f"journal_mode {restored.get('journal_mode')}, integrity {restored.get('integrity')}")
        lines += [f"- {why}" for why in r.get("reasons", [])]
        lines.append("")
    if stale is not None:
        lines.append("## Stores with no object newer than the limit")
        lines += [f"- {n}: {why}" for n, why in stale] or ["- none"]
    return "\n".join(lines) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--list", action="store_true", help="newest object per store, and the stale ones by name")
    ap.add_argument("--rehearse", action="store_true", help="rehearse each store's newest object from R2")
    ap.add_argument("--store", action="append", help="limit to this store (repeatable)")
    ap.add_argument("--file", help="rehearse a .db.gz or .db.gz.enc already on disk")
    ap.add_argument("--manifest", help="its .manifest.json[.enc] (with --file)")
    ap.add_argument("--round-trip", dest="round_trip", help="back up and restore a local copy you own")
    ap.add_argument("--restore", help="REAL restore: an object key under store_backups/ or a local .db.gz[.enc]")
    ap.add_argument("--to", help="the store path to restore into (with --restore)")
    ap.add_argument("--replace", action="store_true", help="move an existing target aside (never deletes)")
    ap.add_argument("--tombstones-file", dest="tombstones_file",
                    help="with --restore of a member store: a LOCAL tombstone list (a directory copy of "
                         "authdb/tombstones/, or a JSON file of ids) when the off-site store cannot be read")
    ap.add_argument("--allow-unreplayed", dest="allow_unreplayed", action="store_true",
                    help="DISASTER ONLY: restore a member store even when NO tombstone source can be "
                         "read; prints the unverified member ids and writes a pending marker the live "
                         "tombstone sweep clears")
    ap.add_argument("--auth-db", dest="auth_db",
                    help="with --restore of a member store: also read this auth.db's own tombstone "
                         "table (read-only), which holds any tombstone whose off-site write is pending")
    ap.add_argument("--report", help="also write the markdown report here")
    ap.add_argument("--keep", action="store_true", help="keep the temp work directory")
    ap.add_argument("--private-key", dest="private_key",
                    help=f"the OFFLINE private key PEM that decrypts .enc objects (default: "
                         f"${bc.PRIVATE_KEY_PATH_ENV}); legacy plaintext objects need none")
    args = ap.parse_args(argv)
    now = dt.datetime.now(dt.timezone.utc)
    try:
        private_key = bc.load_private_key(args.private_key)
    except bc.BackupKeyError as exc:
        print(f"VERDICT: INCONCLUSIVE - {exc}")
        return INCONCLUSIVE
    if args.store:
        unknown = sorted(set(args.store) - {s.name for s in sb.STORES})
        if unknown:
            ap.error(f"not a registered store: {', '.join(unknown)}")
    if not args.restore:
        # ⛔ As the auth.db drill does: arm the census pins and the shared-root tripwire first.
        import conftest  # noqa: F401
    if args.report:
        refuse_shared_root(Path(args.report))
    work = Path(tempfile.mkdtemp(prefix="uct-store-rehearsal-"))
    try:
        refuse_shared_root(work)
        client = bucket = None
        if args.list or args.rehearse or (args.restore or "").startswith(sb.KEY_PREFIX):
            client, bucket = sb._r2()
            if not (client and bucket):
                print("VERDICT: INCONCLUSIVE - R2 credentials not set (DATA_SYNC_*)")
                return INCONCLUSIVE
        if args.list:
            for name, objs in sorted(sb.backups_by_store(client, bucket).items()):
                print(f"{name:22} {len(objs):>3} objects  newest {objs[0][1]}")
            stale = sb.stale_stores(client, bucket, now=now, stores=args.store)
            for n, why in stale:
                print(f"STALE {n}: {why}")
            return FAIL if stale else PASS
        if args.restore:
            if not args.to:
                ap.error("--restore needs --to PATH")
            if args.restore.startswith(sb.KEY_PREFIX):
                gz = work / Path(args.restore).name
                man = work / Path(sb.manifest_key(args.restore)).name
                client.download_file(bucket, args.restore, str(gz))
                client.download_file(bucket, sb.manifest_key(args.restore), str(man))
            else:
                gz = Path(args.restore)
                man = Path(args.manifest) if args.manifest else Path(sb.manifest_key(str(gz)))
            # The REAL restore writes the PLAINTEXT gzip, so an encrypted object is opened here,
            # once, and the rehearsal below checks exactly the bytes that will be restored.
            try:
                gz = plaintext(gz, work, private_key)
                man = plaintext(man, work, private_key)
            except _Unreadable as exc:
                print(f"NOT RESTORED: {exc.why}")
                return _CODE[exc.verdict]
            parsed = sb.parse_key(args.restore) if args.restore.startswith(sb.KEY_PREFIX) else None
            name = parsed[0] if parsed else Path(args.to).stem
            check = rehearse_file(name, gz, man, work / "check", now=now, taken=None)
            print(render({name: check}, _CODE[check["verdict"]], now))
            if check["verdict"] != "PASS":
                print("NOT RESTORED: the object must rehearse PASS first")
                return _CODE[check["verdict"]]
            unverified_after = None
            try:
                prepare = None
                from api.services import account_tombstones as at
                if name in at.STORE_REPLAYS:
                    store_err = None
                    try:
                        store = at.default_store()
                    except Exception as exc:  # noqa: BLE001 -- an unreachable store is "not read"
                        store, store_err = None, f"{type(exc).__name__}: {exc}"
                    try:
                        src = tombstone_sources(
                            store, auth_db=Path(args.auth_db) if args.auth_db else None,
                            tombstones_file=Path(args.tombstones_file) if args.tombstones_file else None)
                    except Exception as exc:  # noqa: BLE001 -- a named source that cannot be read refuses
                        raise RestoreRefused(f"could not read a tombstone source: {type(exc).__name__}: {exc}") from exc
                    if store_err:
                        src["offsite_error"] = store_err
                    if not src["offsite_read"]:
                        if not src["sources"] and not args.allow_unreplayed:
                            raise RestoreRefused(
                                f"{src['offsite_error']}; a member store is never restored without "
                                "replaying the account deletions -- give --tombstones-file PATH or "
                                "--auth-db PATH, or (disaster only) --allow-unreplayed")
                        print("!" * 72)
                        print(f"!! OFF-SITE TOMBSTONES NOT READ: {src['offsite_error']}")
                        print(f"!! replaying from: {', '.join(src['sources']) or 'NOTHING (--allow-unreplayed)'}")
                        print("!! a pending marker is written beside the store; the live tombstone")
                        print("!! sweep replays the off-site list once it can be read")
                        print("!" * 72)
                        unverified_after = src
                    prepare = replay_preparer(name, src["ids"])
                    if unverified_after is not None:
                        # The marker is written INSIDE prepare -- before anything is moved aside
                        # or renamed in -- so a marker that cannot be written refuses the
                        # restore instead of leaving a restored store with nothing pending.
                        prepare = _with_pending_marker(prepare, Path(args.to), name=name, now=now,
                                                       sources=unverified_after)
                done = restore_file(gz, Path(args.to), now=now, replace=args.replace, prepare=prepare)
            except RestoreRefused as exc:
                print(f"NOT RESTORED: {exc}")
                return FAIL
            if done.get("prepared") is not None:
                rep = done["prepared"]
                print(f"tombstones replayed: {len(rep['replayed'])} ids, {rep['rows_deleted']} rows deleted, "
                      f"{rep['authors_scrubbed']} copies' author scrubbed")
            if unverified_after is not None:
                members = (done.get("prepared") or {}).get("members") or []
                print(f"UNVERIFIED against the off-site tombstones: {len(members)} member id(s): "
                      f"{', '.join(members) or '(none)'}")
                print(f"pending marker -> {(done.get('prepared') or {}).get('marker') or 'NOT WRITTEN'}")
            print(f"restored -> {done['restored_to']}; moved aside: {done['moved_aside'] or 'nothing'}")
            return PASS
        if args.round_trip:
            results = {Path(args.round_trip).stem: round_trip(Path(args.round_trip), work, now=now)}
            code, stale = _overall(results), None
        elif args.file:
            gz = Path(args.file)
            man = Path(args.manifest) if args.manifest else None
            parsed = sb.parse_key(f"{sb.KEY_PREFIX}x/{gz.name}")
            results = {"file": rehearse_file("file", gz, man, work / "file", now=now,
                                             taken=parsed[1] if parsed else None,
                                             private_key=private_key)}
            code, stale = _overall(results), None
        elif args.rehearse:
            report = rehearse_stores(client, bucket, now=now, work=work, stores=args.store,
                                     private_key=private_key)
            results, code = report["stores"], report["verdict"]
            stale = sb.stale_stores(client, bucket, now=now, stores=args.store)
        else:
            ap.print_help()
            return INCONCLUSIVE
        text = render(results, code, now, stale)
        print(text)
        if args.report:
            Path(args.report).parent.mkdir(parents=True, exist_ok=True)
            Path(args.report).write_text(text, encoding="utf-8")
        print(f"VERDICT: {_WORD[code]}")
        return code
    finally:
        if not args.keep:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
