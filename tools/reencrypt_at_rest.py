"""Re-encrypt every at-rest crypto_box value of ONE key family to its active version.

Written for the 2026-10-21 Railway env-var leak (BROKER_ENCRYPTION_KEY and
NOTE_ENCRYPTION_KEY exposed). Runbook: docs/runbooks/at-rest-key-rotation.md.

    /opt/venv/bin/python tools/reencrypt_at_rest.py --family broker            # dry run
    /opt/venv/bin/python tools/reencrypt_at_rest.py --family broker --apply    # write

What it does
  * DRY RUN IS THE DEFAULT. Databases are opened read-only (`mode=ro`), so a
    dry run cannot write even by accident. It reports, per table/column: rows,
    rows already on the active version (and whether they decrypt), rows to
    convert (and whether they decrypt), and NULL rows.
  * --apply first runs the same full scan. It REFUSES, with zero writes, if:
      - the family's active version is still v1 (rotation not configured),
      - the active key is not set or the active-version env var is malformed,
      - the active key is the same key as any retired version present (a
        "rotation" to the leaked key),
      - ANY value fails to decrypt (reported by rowid, never by content),
      - the census finds a Fernet-looking column that is not in INVENTORY
        (pass --allow-unknown-columns to override after you have looked).
  * Then, per table, inside ONE `BEGIN IMMEDIATE` transaction: decrypt each
    non-active value, encrypt with the active key, check the new token carries
    the active prefix and decrypts back to the IDENTICAL plaintext, UPDATE
    guarded by `WHERE rowid=? AND col=<old value>`, re-read every rewritten
    row and verify it again, and only then COMMIT. Any surprise => ROLLBACK
    of that table and a non-zero exit. Tables already committed are fully
    converted and valid; a re-run continues from where it stopped.
  * Idempotent: a value already on the active version is never rewritten, so
    a second --apply reports 0 to convert and writes nothing.
  * Never prints plaintext, ciphertext or key material. Rowids only.

Exit codes: 0 ok · 2 configuration refusal · 3 undecryptable value / verify
failure (nothing written for that table) · 4 unknown ciphertext columns ·
5 database missing/unreadable.

Only stdlib + `cryptography` (already a pinned dependency). Light on memory:
rows stream from SQLite; only one table's rewritten plaintexts are held, in
process, until its commit.
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from dataclasses import dataclass, field

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from api.services import crypto_box  # noqa: E402
from api.services.crypto_box import CryptoBox  # noqa: E402

# CryptoBoxError is always looked up as `crypto_box.CryptoBoxError` at the moment
# of the `except`, never bound at import: an importlib.reload of crypto_box
# mints a new exception class, and a stale binding would let it escape.


# ── The ciphertext inventory ────────────────────────────────────────────────
# EVERY table/column that stores a crypto_box token, by family. A column
# missing here is a column whose rows stay on the leaked key and become
# unreadable the day <PREFIX>S_V1 is removed. tests/test_reencrypt_at_rest.py
# pins every encrypt call site in the codebase to an entry below, so a new
# call site fails CI until it is added here.

@dataclass(frozen=True)
class Column:
    family: str
    db: str          # key into default_db_paths()
    table: str
    column: str
    written_by: str  # file:line of the encrypt call that writes it


INVENTORY: tuple[Column, ...] = (
    # BROKER family -- BROKER_ENCRYPTION_KEY
    Column("broker", "auth", "j2_broker_users", "user_secret_enc",
           "api/services/journal_two/broker/connections.py:41 (save_broker_user)"),
    Column("broker", "auth", "user_totp", "secret_encrypted",
           "api/services/totp_service.py:150 (begin_setup)"),
    Column("broker", "alert_taxonomy", "alert_webhooks", "secret_enc",
           "api/services/alert_taxonomy/outbound_webhooks.py:231 (create)"),
    # NOTE family -- NOTE_ENCRYPTION_KEY
    Column("note", "auth", "j2_note_connectors", "token_enc",
           "api/services/journal_two/note_connectors/connections.py:60 (upsert_connector)"),
    Column("note", "auth", "j2_obsidian_devices", "token_enc",
           "api/services/journal_two/note_connectors/obsidian_link.py:317 (redeem_connect_code)"),
    # PRIVATE family -- WISDOM_PRIVATE_KEY (unset in prod 2026-10-22: no rows)
    Column("private", "wisdom_private", "wisdom_private_positions", "value_enc",
           "api/services/wisdom/core/private.py:109 (put_private)"),
)

FAMILIES: dict[str, CryptoBox] = {
    "broker": crypto_box.BrokerBox,
    "note": crypto_box.NoteBox,
    # The wisdom box is constructed in its own module; build an equivalent here
    # rather than importing the wisdom package (keeps the tool's import light).
    "private": CryptoBox("WISDOM_PRIVATE_KEY"),
}

# A Fernet token always begins with base64 of the 0x80 version byte: "gAAAAA".
_FERNET_GLOB = "v[0-9]*:gAAAAA*"


def default_db_paths() -> dict[str, str]:
    """Prod locations, resolved exactly the way the app resolves them."""
    data_dir = os.environ.get("DATA_DIR", "/data")
    return {
        "auth": os.environ.get("AUTH_DB_PATH", "/data/auth.db"),
        "alert_taxonomy": os.path.join(data_dir, "alert_taxonomy.db"),
        "wisdom_private": os.environ.get("WISDOM_PRIVATE_DB_PATH", "/data/wisdom_private.db"),
    }


# ── Scan ────────────────────────────────────────────────────────────────────

@dataclass
class ColumnReport:
    db_path: str
    table: str
    column: str
    present: bool = True
    rows: int = 0
    null: int = 0
    active_ok: int = 0
    active_fail: int = 0
    pending_ok: int = 0
    pending_fail: int = 0
    versions: dict[str, int] = field(default_factory=dict)
    failures: list[tuple[int, str]] = field(default_factory=list)   # (rowid, reason)


class Abort(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code


def _connect(path: str, *, write: bool) -> sqlite3.Connection:
    if not os.path.isfile(path):
        raise Abort(5, f"database not found: {path}")
    mode = "rw" if write else "ro"
    uri = "file:" + os.path.abspath(path).replace("\\", "/") + f"?mode={mode}"
    conn = sqlite3.connect(uri, uri=True, timeout=30, isolation_level=None)
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                        (table,)).fetchone() is not None


def _classify(box: CryptoBox, active: str, value) -> tuple[str, str | None, str | None]:
    """-> (bucket, version, failure_reason). Never returns the plaintext."""
    if value is None:
        return "null", None, None
    version = crypto_box.version_of(value)
    if version is None:
        return "pending_fail", None, "not a versioned crypto-box token"
    try:
        box.decrypt(value)
    except crypto_box.CryptoBoxError as e:
        reason = "decrypt failed" if "decrypt failed" in str(e) else f"no key configured for {version}"
        return ("active_fail" if version == active else "pending_fail"), version, reason
    return ("active_ok" if version == active else "pending_ok"), version, None


def scan(box: CryptoBox, active: str, columns: list[Column],
         db_paths: list[str]) -> list[ColumnReport]:
    reports: list[ColumnReport] = []
    for path in db_paths:
        conn = _connect(path, write=False)
        try:
            for col in columns:
                rep = ColumnReport(path, col.table, col.column)
                if not _table_exists(conn, col.table):
                    rep.present = False
                    reports.append(rep)
                    continue
                try:
                    cur = conn.execute(f'SELECT rowid, "{col.column}" FROM "{col.table}"')
                except sqlite3.OperationalError as e:
                    # A WITHOUT ROWID table or a renamed column: the tool must
                    # be updated, never guess.
                    raise Abort(2, f"{path} {col.table}.{col.column}: cannot read ({e})") from None
                for rowid, value in cur:
                    rep.rows += 1
                    bucket, version, reason = _classify(box, active, value)
                    if bucket == "null":
                        rep.null += 1
                        continue
                    rep.versions[version or "?"] = rep.versions.get(version or "?", 0) + 1
                    setattr(rep, bucket, getattr(rep, bucket) + 1)
                    if reason:
                        rep.failures.append((rowid, reason))
                reports.append(rep)
        finally:
            conn.close()
    return reports


def census(db_paths: list[str]) -> list[tuple[str, str, str, int]]:
    """Every column in the given DBs holding Fernet-looking crypto-box tokens
    that is NOT in INVENTORY (any family). Read-only."""
    known = {(c.table, c.column) for c in INVENTORY}
    hits: list[tuple[str, str, str, int]] = []
    for path in db_paths:
        conn = _connect(path, write=False)
        try:
            tables = [r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
            for t in tables:
                for info in conn.execute(f'PRAGMA table_info("{t}")').fetchall():
                    colname = info[1]
                    if (t, colname) in known:
                        continue
                    n = conn.execute(
                        f'SELECT COUNT(*) FROM "{t}" WHERE typeof("{colname}")=\'text\' '
                        f'AND "{colname}" GLOB ?', (_FERNET_GLOB,)).fetchone()[0]
                    if n:
                        hits.append((path, t, colname, n))
        finally:
            conn.close()
    return hits


# ── Apply ───────────────────────────────────────────────────────────────────

def _apply_table(conn: sqlite3.Connection, box: CryptoBox, active: str, col: Column) -> int:
    """Convert one table in one transaction. Returns rows rewritten."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        rows = conn.execute(
            f'SELECT rowid, "{col.column}" FROM "{col.table}" WHERE "{col.column}" IS NOT NULL'
        ).fetchall()
        expected: dict[int, str] = {}
        for rowid, old in rows:
            if crypto_box.version_of(old) == active:
                continue
            plaintext = box.decrypt(old)                 # raises -> rollback
            new = box.encrypt(plaintext)
            if crypto_box.version_of(new) != active or box.decrypt(new) != plaintext:
                raise Abort(3, f"{col.table}.{col.column} rowid {rowid}: re-encrypted value "
                               "did not verify")
            cur = conn.execute(
                f'UPDATE "{col.table}" SET "{col.column}" = ? WHERE rowid = ? AND "{col.column}" = ?',
                (new, rowid, old))
            if cur.rowcount != 1:
                raise Abort(3, f"{col.table}.{col.column} rowid {rowid}: row changed under us")
            expected[rowid] = plaintext
        # Read back every rewritten row from the database itself before commit.
        for rowid, plaintext in expected.items():
            stored = conn.execute(f'SELECT "{col.column}" FROM "{col.table}" WHERE rowid = ?',
                                  (rowid,)).fetchone()
            if (stored is None or crypto_box.version_of(stored[0]) != active
                    or box.decrypt(stored[0]) != plaintext):
                raise Abort(3, f"{col.table}.{col.column} rowid {rowid}: read-back verify failed")
        n = len(expected)
        expected.clear()
        conn.execute("COMMIT")
        return n
    except BaseException as e:
        conn.execute("ROLLBACK")
        if isinstance(e, crypto_box.CryptoBoxError):
            raise Abort(3, f"{col.table}.{col.column}: a value failed to decrypt during apply "
                           "(changed since the scan?) -- table rolled back") from None
        raise


# ── CLI ─────────────────────────────────────────────────────────────────────

def _print_reports(reports: list[ColumnReport], active: str) -> None:
    print(f"{'database':<34} {'table.column':<38} {'rows':>6} {'null':>5} "
          f"{'active ok/fail':>15} {'to-convert ok/fail':>19}  versions")
    present = {(r.table, r.column) for r in reports if r.present}
    for r in reports:
        name = f"{r.table}.{r.column}"
        if not r.present:
            if (r.table, r.column) not in present:   # absent from EVERY scanned DB
                print(f"{r.db_path:<34} {name:<38}  (table absent)")
            continue
        vers = ",".join(f"{k}={v}" for k, v in sorted(r.versions.items())) or "-"
        print(f"{r.db_path:<34} {name:<38} {r.rows:>6} {r.null:>5} "
              f"{r.active_ok:>8}/{r.active_fail:<6} {r.pending_ok:>10}/{r.pending_fail:<8}  {vers}")
        for rowid, reason in r.failures[:50]:
            print(f"    FAIL rowid={rowid}: {reason}")
        if len(r.failures) > 50:
            print(f"    ... {len(r.failures) - 50} more failures")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--family", required=True, choices=sorted(FAMILIES))
    ap.add_argument("--db", action="append", metavar="PATH",
                    help="SQLite file to process (repeatable). Default: the family's prod DBs.")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", default=True,
                      help="report only, open read-only (the default)")
    mode.add_argument("--apply", action="store_true", help="write the re-encrypted values")
    ap.add_argument("--no-census", action="store_true",
                    help="skip the scan for un-inventoried ciphertext columns")
    ap.add_argument("--allow-unknown-columns", action="store_true",
                    help="apply even if the census found un-inventoried ciphertext columns")
    ap.add_argument("--allow-missing-tables", action="store_true",
                    help="apply even if an inventoried table exists in none of the DBs")
    args = ap.parse_args(argv)

    box = FAMILIES[args.family]
    columns = [c for c in INVENTORY if c.family == args.family]
    if args.db:
        db_paths = list(dict.fromkeys(args.db))
    else:
        paths = default_db_paths()
        db_paths = list(dict.fromkeys(paths[c.db] for c in columns))

    try:
        return _run(args, box, columns, db_paths)
    except Abort as a:
        print(f"ABORT ({a.code}): {a}")
        return a.code


def _run(args, box: CryptoBox, columns: list[Column], db_paths: list[str]) -> int:
    print(f"family={args.family} prefix={box.prefix} mode={'APPLY' if args.apply else 'dry-run'}")
    try:
        active = box.active_version
    except crypto_box.CryptoBoxError as e:
        raise Abort(2, str(e)) from None
    print(f"active version = {active}  ({box.active_version_env}"
          f"{'' if os.environ.get(box.active_version_env, '').strip() else ' unset -> default'})")
    if not box.is_configured():
        raise Abort(2, f"{box.prefix} (the active key) is not set")
    rotation_configured = active != crypto_box.DEFAULT_ACTIVE_VERSION
    if not rotation_configured:
        print(f"NOTE: {box.active_version_env} is v1 -- rotation is not configured; "
              "nothing would be converted.")

    reports = scan(box, active, columns, db_paths)
    _print_reports(reports, active)

    retired = sorted({v for r in reports for v in r.versions if v not in (active, "?")})
    for v in retired:
        if box.same_key(v, active):
            raise Abort(2, f"the active key ({active}) is the SAME key as {v} -- set {box.prefix} "
                           "to a NEW key; refusing")
    if rotation_configured and box.same_key("v1", active):
        raise Abort(2, f"the active key ({active}) is the SAME key as {box.prefix}S_V1; refusing")

    present = {(r.table, r.column) for r in reports if r.present}
    missing = [c for c in columns if (c.table, c.column) not in present]
    for c in missing:
        print(f"WARNING: {c.table}.{c.column} was not found in ANY scanned database "
              f"(expected in the '{c.db}' DB) -- wrong --db path, or the feature never ran")

    unknown = [] if args.no_census else census(db_paths)
    for path, t, c, n in unknown:
        print(f"CENSUS: {path} {t}.{c} holds {n} crypto-box-looking value(s) NOT in the inventory")

    pending = sum(r.pending_ok + r.pending_fail for r in reports)
    fails = sum(r.pending_fail + r.active_fail for r in reports)
    print(f"summary: to-convert={pending} failures={fails} unknown-columns={len(unknown)}")
    if fails:
        raise Abort(3, f"{fails} value(s) do not decrypt -- fix the env (is {box.prefix}S_V1 set "
                       "to the OLD key?) and re-run; nothing was written")
    if not args.apply:
        print("dry run: nothing written")
        return 0
    if not rotation_configured:
        raise Abort(2, f"set {box.active_version_env}=v2 (with {box.prefix}=<new key> and "
                       f"{box.prefix}S_V1=<old key>) and deploy before --apply")
    if missing and not args.allow_missing_tables:
        raise Abort(5, "inventoried table(s) not found (see WARNING above); check the --db "
                       "paths, or pass --allow-missing-tables if that table genuinely does "
                       "not exist on this pod -- nothing was written")
    if unknown and not args.allow_unknown_columns:
        raise Abort(4, "un-inventoried ciphertext columns found; add them to INVENTORY "
                       "(or pass --allow-unknown-columns after checking) -- nothing was written")
    if pending == 0:
        print("nothing to convert (already on the active version): no-op")
        return 0

    total = 0
    by_path = {r.db_path for r in reports if r.present}
    for path in db_paths:
        if path not in by_path:
            continue
        conn = _connect(path, write=True)
        try:
            for col in columns:
                if not _table_exists(conn, col.table):
                    continue
                n = _apply_table(conn, box, active, col)
                total += n
                print(f"applied: {path} {col.table}.{col.column} rewritten={n} (committed)")
        finally:
            conn.close()

    after = scan(box, active, columns, db_paths)
    left = sum(r.pending_ok + r.pending_fail for r in after)
    bad = sum(r.active_fail for r in after)
    print(f"post-apply: rewritten={total} still-to-convert={left} active-failures={bad}")
    return 0 if (left == 0 and bad == 0) else 3


if __name__ == "__main__":
    sys.exit(main())
