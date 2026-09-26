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

Exit codes: 0 PASS · 1 FAIL (the backup is not restorable, or too old) ·
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


def render(source: str, taken, size: int, result: dict, code: int, reasons: list[str], now) -> str:
    word = {PASS: "PASS", FAIL: "FAIL"}[code]
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


def run(args, client=None, bucket=None, now=None) -> int:
    now = now or dt.datetime.now(dt.timezone.utc)
    work = Path(tempfile.mkdtemp(prefix="uct-restore-drill-"))
    try:
        refuse_shared_root(work)
        if args.report:
            refuse_shared_root(Path(args.report))
        if args.file:
            src, source = Path(args.file), Path(args.file).name
            if not src.is_file():
                raise Inconclusive(f"no such file: {src}")
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
        try:
            db = gunzip(src, work)
        except (OSError, EOFError) as exc:
            result = {"integrity": None, "missing": list(REQUIRED_TABLES), "counts": {},
                      "notes_updated_max": None, "error": f"not a readable gzip: {exc}"}
        else:
            result = examine(db)
        taken = snapshot_time(source)
        code, reasons = verdict(result, taken, now)
        report = render(source, taken, src.stat().st_size, result, code, reasons, now)
        print(report)
        if args.report:
            Path(args.report).write_text(report, encoding="utf-8")
        print(f"VERDICT: {'PASS' if code == PASS else 'FAIL'}")
        return code
    except Inconclusive as exc:
        print(f"VERDICT: INCONCLUSIVE - {exc}")
        return INCONCLUSIVE
    finally:
        if not args.keep:
            shutil.rmtree(work, ignore_errors=True)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--file", help="drill a .db.gz already on disk instead of fetching from R2")
    ap.add_argument("--list", action="store_true", help="list the backups in R2 and exit")
    ap.add_argument("--report", help="also write the markdown report here")
    ap.add_argument("--keep", action="store_true", help="keep the temp work directory")
    return run(ap.parse_args(argv))


if __name__ == "__main__":
    sys.exit(main())
