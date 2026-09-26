"""Restore drill for the auth.db backups in R2: prove the newest one can be restored.

    python tools/authdb_restore_drill.py                  # newest backup in R2 (DATA_SYNC_* env)
    python tools/authdb_restore_drill.py --list           # what is in R2, newest first
    python tools/authdb_restore_drill.py --file X.db.gz   # a backup downloaded by hand
    python tools/authdb_restore_drill.py --report out.md  # also write the report to a file

A backup nobody has restored is a hope, not a backup. This downloads a snapshot
into a fresh temp directory, gunzips it, opens it READ-ONLY and checks it:

  * ``PRAGMA integrity_check`` answers ``ok`` (the full check, not quick_check);
  * every table in REQUIRED_TABLES exists (the member data a restore must bring back);
  * the snapshot is fresh: taken within MAX_AGE_HOURS (backups run every 6h plus nightly).

It restores NOTHING anywhere. It never writes under the shared data root
(``C:\\data`` / ``/data``) and refuses a work directory there. The report holds
table names, row counts and timestamps only, never a row's contents.

⛔⛔ WAVE 10 (lane 10C) — TWO MORE HALVES, because a restore is more than a readable file:

  * TOMBSTONES (ruling R-9). An account deleted after this snapshot was taken is IN it.
    The drill reads every tombstone (``account_tombstones``: the objects beside the
    backups, and the snapshot's own table), REPLAYS them on its temporary copy, and
    FAILS if any deleted account would still come back. ``--write-restored PATH``
    writes that replayed copy for a real restore, and refuses unless the off-site
    tombstones were actually read -- a real restore never proceeds without them.
  * ATTACHMENTS (F-7). The newest attachments tarball is downloaded, its manifest
    (``j2_attachments_backup.MANIFEST_NAME``) read, ``--sample N`` files drawn and
    each one's sha256 checked against it, and its member count reconciled. A tarball
    older than the manifest is INCONCLUSIVE for this half, never a pass. The
    tombstoned members' directories in it are counted (a restore removes them with
    ``account_tombstones.replay_on_attachment_tree``). On by default from the command
    line; ``--no-attachments`` skips it.

The weekly schedule line for the owner's machine: ``--print-schedule``.

Exit codes: 0 PASS · 1 FAIL (the backup is not restorable, or too old, or a
deleted account would come back, or an attachment does not match its manifest) ·
2 INCONCLUSIVE (no credentials, nothing in R2, a download error). An unknown is
never a pass.

The key layout and the client come from the backup job itself
(``authdb_backup.KEY_PREFIX``, ``data_sync._client``), so this drill cannot drift
from what is actually being written.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from api.services import authdb_backup, data_sync  # noqa: E402  (stdlib-only at import)

PASS, FAIL, INCONCLUSIVE = 0, 1, 2
MAX_AGE_HOURS = 30
REQUIRED_TABLES = (
    "users", "sessions", "subscriptions", "user_preferences",
    "j2_accounts", "j2_trades", "j2_positions", "j2_day_notes",
    "j2_notes", "j2_note_folders", "watchlists", "watchlist_items",
)
_TS_RE = re.compile(r"(\d{8}T\d{6}Z)\.db\.gz$")
_SHARED_ROOTS = (Path("C:/data"), Path("/data"))


class Inconclusive(Exception):
    """Could not measure. Never reported as a pass."""


# The flags of the IDEMPOTENT search-text backfills, derived from their call sites.
# They live in DATA_DIR, not in the database, so restoring a backup taken before a
# backfill leaves the flag behind and the restored rows keep their old body_plain for
# good. Only calls to `rederive_body_plain` qualify: re-running one is a read-only pass
# over rows that already match. A one-shot migration flag (e.g. v1, which moves
# playbook entries into notes) is never listed; removing it would re-migrate.
_BACKFILL_SOURCES = ("api/services/journal_two/db.py", "api/services/user_playbook/db.py")


def rederive_backfill_flags() -> list[str]:
    import ast
    flags: list[str] = []
    for rel in _BACKFILL_SOURCES:
        tree = ast.parse((REPO / rel).read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            fn = node.func
            name = fn.attr if isinstance(fn, ast.Attribute) else getattr(fn, "id", "")
            if name != "rederive_body_plain":
                continue
            for kw in node.keywords:
                if kw.arg == "flag_name" and isinstance(kw.value, ast.Constant):
                    flags.append(kw.value.value)
    return sorted(set(flags))


def snapshot_time(key: str) -> dt.datetime | None:
    m = _TS_RE.search(key)
    if not m:
        return None
    return dt.datetime.strptime(m.group(1), "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc)


def refuse_shared_root(path: Path) -> None:
    resolved = path.resolve()
    for root in _SHARED_ROOTS:
        try:
            resolved.relative_to(root.resolve())
        except ValueError:
            continue
        raise SystemExit(f"REFUSED: {resolved} is under the shared data root {root}")


def list_backups(client, bucket: str) -> list[dict]:
    """Every backup object, newest first. Paginates; raises Inconclusive on error."""
    out, token = [], None
    try:
        while True:
            kw = {"Bucket": bucket, "Prefix": authdb_backup.KEY_PREFIX}
            if token:
                kw["ContinuationToken"] = token
            resp = client.list_objects_v2(**kw)
            out.extend(o for o in resp.get("Contents", []) if o["Key"].endswith(".db.gz"))
            if not resp.get("IsTruncated"):
                break
            token = resp.get("NextContinuationToken")
    except Exception as exc:  # the network, credentials, the bucket
        raise Inconclusive(f"could not list backups: {exc}") from exc
    return sorted(out, key=lambda o: o["Key"], reverse=True)


def fetch_newest(client, bucket: str, work: Path) -> tuple[Path, str]:
    backups = list_backups(client, bucket)
    if not backups:
        raise Inconclusive(f"no backups under {authdb_backup.KEY_PREFIX} in bucket {bucket}")
    key = backups[0]["Key"]
    dest = work / Path(key).name
    try:
        client.download_file(bucket, key, str(dest))
    except Exception as exc:
        raise Inconclusive(f"could not download {key}: {exc}") from exc
    return dest, key


def gunzip(src: Path, work: Path) -> Path:
    dst = work / "restored.db"
    with gzip.open(src, "rb") as f_in, open(dst, "wb") as f_out:
        shutil.copyfileobj(f_in, f_out)
    return dst


def examine(db_path: Path) -> dict:
    """Read-only checks. Returns a result dict; never raises on a bad database."""
    result = {"integrity": None, "missing": [], "counts": {}, "notes_updated_max": None, "error": None}
    try:
        conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    except sqlite3.Error as exc:
        result["error"] = f"cannot open: {exc}"
        return result
    try:
        rows = conn.execute("PRAGMA integrity_check").fetchall()
        result["integrity"] = "ok" if rows == [("ok",)] else "; ".join(r[0] for r in rows[:5])
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        result["missing"] = [t for t in REQUIRED_TABLES if t not in tables]
        for t in sorted(tables):
            result["counts"][t] = conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
        if "j2_notes" in tables:
            result["notes_updated_max"] = conn.execute("SELECT MAX(updated_at) FROM j2_notes").fetchone()[0]
    except sqlite3.Error as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        conn.close()
    return result


def verdict(result: dict, taken: dt.datetime | None, now: dt.datetime) -> tuple[int, list[str]]:
    reasons = []
    if result["error"]:
        reasons.append(f"database error: {result['error']}")
    if result["integrity"] != "ok":
        reasons.append(f"integrity_check: {result['integrity']}")
    if result["missing"]:
        reasons.append(f"missing tables: {', '.join(result['missing'])}")
    if taken is None:
        reasons.append("snapshot time unknown (key does not carry a timestamp)")
    elif now - taken > dt.timedelta(hours=MAX_AGE_HOURS):
        reasons.append(f"newest backup is {(now - taken).total_seconds() / 3600:.1f}h old (limit {MAX_AGE_HOURS}h)")
    return (FAIL if reasons else PASS), reasons


def resolve_store(client, bucket, store=None):
    """The tombstone store: an injected one, else the sandbox fake the env names, else
    the backups' own bucket through the same client, else None."""
    if store is not None:
        return store
    from api.services import account_tombstones as at
    if os.environ.get(at.LOCAL_STORE_ENV, "").strip():
        return at.LocalObjectStore(os.environ[at.LOCAL_STORE_ENV])
    return at.R2ObjectStore(client, bucket) if (client and bucket) else None


def tombstone_check(db_path: Path, store) -> dict:
    """R-9: replay every tombstone on the TEMPORARY copy and say who would have come back.

    ⛔ `store_read` is False when the off-site tombstones could not be read (no store,
    or it failed): the snapshot's own table is still replayed, but a real restore
    (`--write-restored`) refuses on that, and the report says so."""
    from api.services import account_tombstones as at
    out = {"store_read": False, "store_error": None, "offsite": 0, "own": 0,
           "present_before": [], "replayed": [], "still_present": [], "errors": []}
    ids: dict[str, str] = {}
    if store is None:
        out["store_error"] = "no tombstone store (DATA_SYNC_* credentials or ACCOUNT_TOMBSTONE_LOCAL_STORE)"
    else:
        try:
            off = at.offsite_tombstones(store)
            ids.update(off)
            out["offsite"], out["store_read"] = len(off), True
        except Exception as exc:  # noqa: BLE001 -- reported, never a silent zero
            out["store_error"] = f"{type(exc).__name__}: {exc}"
    conn = sqlite3.connect(str(db_path))
    try:
        own = at.tombstones_in(conn)
        out["own"] = len(own)
        ids.update(own)
        out["present_before"] = at.present_in(conn, ids)
        rep = at.replay_on_db(conn, out["present_before"])
        out["replayed"], out["still_present"], out["errors"] = rep["replayed"], rep["still_present"], rep["errors"]
    finally:
        conn.close()
    out["tombstoned_ids"] = sorted(ids)
    return out


ATTACHMENT_SAMPLE = 25


def attachment_check(client, bucket, work: Path, *, file: str | None = None,
                     sample: int = ATTACHMENT_SAMPLE, tombstoned=()) -> dict:
    """F-7: prove the newest attachments tarball restores byte-identical, by sampling
    its manifest. Verdict PASS / FAIL / INCONCLUSIVE, with the reason."""
    import hashlib
    import random
    import tarfile
    from api import j2_attachments_backup as ab

    out = {"verdict": "INCONCLUSIVE", "why": "", "source": None, "files": 0, "sampled": 0,
           "mismatched": [], "missing": [], "tombstoned_dirs": []}
    if file:
        src, out["source"] = Path(file), Path(file).name
        if not src.is_file():
            out["why"] = f"no such file: {src}"
            return out
    else:
        if not (client and bucket):
            out["why"] = "R2 credentials not set"
            return out
        try:
            objs = client.list_objects_v2(Bucket=bucket, Prefix=ab._PREFIX).get("Contents", []) or []
        except Exception as exc:  # noqa: BLE001
            out["why"] = f"could not list attachment backups: {exc}"
            return out
        dated = sorted(((ab._date_from_key(o["Key"]), o["Key"]) for o in objs
                        if ab._date_from_key(o["Key"])), reverse=True)
        if not dated:
            out["why"] = f"no attachment backups under {ab._PREFIX}"
            return out
        key = dated[0][1]
        src, out["source"] = work / Path(key).name, key
        try:
            client.download_file(bucket, key, str(src))
        except Exception as exc:  # noqa: BLE001
            out["why"] = f"could not download {key}: {exc}"
            return out
    try:
        with tarfile.open(src, "r:gz") as tar:
            members = {m.name.replace("\\", "/"): m for m in tar.getmembers() if m.isfile()}
            if ab.MANIFEST_NAME not in members:
                out["why"] = ("this tarball predates the manifest (wave 10) -- its files cannot be "
                              "checked against anything; the next nightly backup carries one")
                out["files"] = len(members)
                return out
            manifest = json.loads(tar.extractfile(members[ab.MANIFEST_NAME]).read().decode("utf-8"))
            files = manifest.get("files") or []
            out["files"] = len(files)
            user_members = [n for n in members if n != ab.MANIFEST_NAME]
            if len(user_members) != len(files) or manifest.get("count") != len(files):
                out["verdict"] = "FAIL"
                out["why"] = (f"the tarball holds {len(user_members)} files, its manifest "
                              f"lists {len(files)} (count {manifest.get('count')})")
                return out
            rng = random.Random(out["source"])  # reproducible per tarball, stated in the report
            picks = rng.sample(files, min(sample, len(files))) if files else []
            for f in picks:
                m = members.get(f["path"])
                if m is None:
                    out["missing"].append(f["path"])
                    continue
                blob = tar.extractfile(m).read()
                if len(blob) != f["bytes"] or hashlib.sha256(blob).hexdigest() != f["sha256"]:
                    out["mismatched"].append(f["path"])
            out["sampled"] = len(picks)
            tomb = set(tombstoned)
            out["tombstoned_dirs"] = sorted({n.split("/", 1)[0] for n in user_members} & tomb)
    except (tarfile.TarError, OSError, EOFError, ValueError) as exc:
        out["verdict"], out["why"] = "FAIL", f"not a readable tarball: {exc}"
        return out
    if out["missing"] or out["mismatched"]:
        out["verdict"] = "FAIL"
        out["why"] = f"{len(out['mismatched'])} mismatched, {len(out['missing'])} missing of {out['sampled']} sampled"
    elif not files:
        out["why"] = "the manifest lists no files"
    else:
        out["verdict"], out["why"] = "PASS", f"{out['sampled']} of {out['files']} files sampled, every sha256 matches"
    return out


def render(source: str, taken, size: int, result: dict, code: int, reasons: list[str], now,
           tomb: dict | None = None, att: dict | None = None) -> str:
    word = {PASS: "PASS", FAIL: "FAIL", INCONCLUSIVE: "INCONCLUSIVE"}[code]
    lines = [
        f"# auth.db restore drill - {word}", "",
        f"- run at: {now.isoformat(timespec='seconds')}",
        f"- source: `{source}` ({size:,} bytes compressed)",
        f"- snapshot taken: {taken.isoformat() if taken else 'unknown'}",
        f"- integrity_check: {result['integrity']}",
        f"- required tables missing: {', '.join(result['missing']) or 'none'}",
        f"- newest note edit in the backup: {result['notes_updated_max'] or 'n/a'}",
    ]
    if reasons:
        lines += ["", "## Why it failed"] + [f"- {r}" for r in reasons]
    if tomb is not None:
        lines += ["", "## Deleted accounts (R-9 tombstones, replayed on the restored copy)", "",
                  f"- off-site tombstones read: **{tomb['store_read']}**"
                  + (f" ({tomb['offsite']})" if tomb["store_read"] else f" -- {tomb['store_error']}"),
                  f"- tombstones in the snapshot's own table: {tomb['own']}",
                  f"- deleted accounts present in the snapshot before replay: **{len(tomb['present_before'])}**",
                  f"- replayed: {len(tomb['replayed'])} · still present after replay: "
                  f"**{len(tomb['still_present'])}**"]
        if tomb["errors"]:
            lines += [f"- replay error: {e}" for e in tomb["errors"][:10]]
        if not tomb["store_read"]:
            lines.append("- ⛔ a REAL restore must not proceed without the off-site tombstones "
                         "(`--write-restored` refuses)")
    if att is not None:
        lines += ["", f"## Attachments: {att['verdict']}", "",
                  f"- source: `{att['source']}`", f"- files in the manifest: {att['files']}",
                  f"- sampled: {att['sampled']} (seeded by the tarball name, so a re-run draws the same files)",
                  f"- mismatched: {len(att['mismatched'])} · missing: {len(att['missing'])}",
                  f"- deleted accounts with a directory in this tarball: {len(att['tombstoned_dirs'])} "
                  "(a restore removes them: `account_tombstones.replay_on_attachment_tree`)",
                  f"- {att['why']}"]
    lines += ["", "## Row counts", "", "| table | rows |", "|---|---|"]
    lines += [f"| {t} | {n:,} |" for t, n in result["counts"].items()]
    flags = rederive_backfill_flags()
    lines += [
        "", "## After a real restore",
        "",
        "Delete these files from DATA_DIR before the next boot, so the idempotent search-text "
        "backfills re-derive the restored rows (they otherwise keep the old text for good). "
        "Leave every other migration flag alone: those are one-shot and would re-run.",
        "",
    ]
    lines += [f"- `{f}` and `{f}.progress`" for f in flags]
    return "\n".join(lines) + "\n"


def run(args, client=None, bucket=None, now=None, store=None) -> int:
    now = now or dt.datetime.now(dt.timezone.utc)
    work = Path(tempfile.mkdtemp(prefix="uct-restore-drill-"))
    try:
        refuse_shared_root(work)
        if args.report:
            refuse_shared_root(Path(args.report))
        write_to = getattr(args, "write_restored", None)
        if write_to:
            refuse_shared_root(Path(write_to))
        if args.file:
            src, source = Path(args.file), Path(args.file).name
            if not src.is_file():
                raise Inconclusive(f"no such file: {src}")
            if client is None and bucket is None and getattr(args, "use_env_credentials", False):
                # A drilled FILE from the COMMAND LINE may still read the tombstones and
                # attachments beside the backups. ⛔ Only from the CLI (main() sets the
                # flag): a unit test on a machine that has DATA_SYNC_* set must never
                # reach the real bucket.
                client, bucket = data_sync._client(), data_sync._bucket()
        else:
            client = client if client is not None else data_sync._client()
            bucket = bucket if bucket is not None else data_sync._bucket()
            if not (client and bucket):
                raise Inconclusive("R2 credentials not set (DATA_SYNC_ENDPOINT_URL / _ACCESS_KEY / _SECRET_KEY / _BUCKET)")
            if args.list:
                for o in list_backups(client, bucket):
                    t = snapshot_time(o["Key"])
                    age = f"{(now - t).total_seconds() / 3600:.1f}h" if t else "?"
                    print(f"{o['Key']}  {o.get('Size', 0):>12,} bytes  age {age}")
                return PASS
            src, source = fetch_newest(client, bucket, work)
        tomb = None
        try:
            db = gunzip(src, work)
        except (OSError, EOFError) as exc:
            result = {"integrity": None, "missing": list(REQUIRED_TABLES), "counts": {},
                      "notes_updated_max": None, "error": f"not a readable gzip: {exc}"}
            db = None
        else:
            result = examine(db)
        taken = snapshot_time(source)
        code, reasons = verdict(result, taken, now)
        # ⛔⛔ R-9: every restore replays the tombstones. Only on a database that opened.
        if db is not None and not result["error"]:
            tomb = tombstone_check(db, resolve_store(client, bucket, store))
            if tomb["still_present"]:
                code = FAIL
                reasons.append(f"{len(tomb['still_present'])} deleted account(s) would come back on "
                               "restore -- the tombstone replay did not remove them")
        att = None
        if getattr(args, "attachments", False):
            att = attachment_check(client, bucket, work, file=getattr(args, "attachments_file", None),
                                   sample=getattr(args, "sample", ATTACHMENT_SAMPLE) or ATTACHMENT_SAMPLE,
                                   tombstoned=(tomb or {}).get("tombstoned_ids", ()))
            if att["verdict"] == "FAIL":
                code = FAIL
                reasons.append(f"attachments: {att['why']}")
            elif att["verdict"] == "INCONCLUSIVE" and code == PASS:
                code = INCONCLUSIVE
        report = render(source, taken, src.stat().st_size, result, code, reasons, now, tomb, att)
        print(report)
        if args.report:
            Path(args.report).write_text(report, encoding="utf-8")
        if write_to:
            # ⛔ A REAL restore gets a copy only when everything above passed AND the off-site
            # tombstones were read -- never one that could bring a deleted account back.
            if code != PASS:
                print("NOT WRITTEN: --write-restored needs a PASS")
            elif not (tomb and tomb["store_read"]):
                print("NOT WRITTEN: the off-site tombstones were not read -- a restore without them "
                      "can bring a deleted account back")
                code = INCONCLUSIVE
            else:
                shutil.copyfile(db, write_to)
                print(f"restored copy (tombstones replayed) -> {write_to}")
        print(f"VERDICT: {'PASS' if code == PASS else 'FAIL' if code == FAIL else 'INCONCLUSIVE'}")
        return code
    except Inconclusive as exc:
        print(f"VERDICT: INCONCLUSIVE - {exc}")
        return INCONCLUSIVE
    finally:
        if not args.keep:
            shutil.rmtree(work, ignore_errors=True)


SCHEDULE_TASK = "UCT Restore Drill"


def schedule_line(repo: Path = REPO) -> str:
    """The ONE weekly scheduled-task line for the owner's machine (S-1). The task runs
    with the owner's environment, so DATA_SYNC_* must be set there (setx), never in the
    line. Sunday 10:00 local, a report file the controller reads, a log beside it."""
    return (f'schtasks /Create /TN "{SCHEDULE_TASK}" /SC WEEKLY /D SUN /ST 10:00 /F /TR '
            f'"cmd /c cd /d {repo} && python tools\\authdb_restore_drill.py '
            f'--report docs\\notebook\\evidence\\restore-drill-latest.md '
            f'>> logs\\restore-drill.log 2>&1"')


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--file", help="drill a .db.gz already on disk instead of fetching from R2")
    ap.add_argument("--list", action="store_true", help="list the backups in R2 and exit")
    ap.add_argument("--report", help="also write the markdown report here")
    ap.add_argument("--keep", action="store_true", help="keep the temp work directory")
    ap.add_argument("--no-attachments", dest="attachments", action="store_false",
                    help="skip the attachments half (on by default)")
    ap.add_argument("--attachments-file", help="drill an attachments .tar.gz already on disk")
    ap.add_argument("--sample", type=int, default=ATTACHMENT_SAMPLE,
                    help=f"attachment files to sha-check (default {ATTACHMENT_SAMPLE})")
    ap.add_argument("--write-restored", help="write the tombstone-replayed database here, for a REAL "
                                             "restore (refuses the shared data root)")
    ap.add_argument("--print-schedule", action="store_true", help="print the weekly schedule line and exit")
    args = ap.parse_args(argv)
    if args.print_schedule:
        print(schedule_line())
        return PASS
    # ⛔ The replay imports app modules; arm the census pins and the shared-root tripwire
    # first, so nothing this process imports can reach the live data root.
    import conftest  # noqa: F401
    args.use_env_credentials = True
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
