"""⛔⛔ WAVE 10 (lane AD) — clause 7b exception (d): an ARCHIVE restore replays R-9's
tombstones too, exactly like a regular restore, and fails closed identically.

`docs/account-deletion-manifest.md` §"Backups", exception (d): `authdb/archive/`
(`tools/archive_authdb_backup.py`) is never pruned -- kept by owner decision
(2026-09-27, KEEP) -- and until this lane had NO replaying restore path: the regular
drill's freshness rule (MAX_AGE_HOURS = 30h) fails EVERY archive object on sight,
since being old is the entire point of an archive. `--archive`
(`tools/authdb_restore_drill.py`) lifts ONLY that rule. Everything else -- integrity,
required tables, and above all R-9's tombstone replay -- is the SAME code both paths
share: `tombstone_check` -> `account_tombstones.replay_on_db` /
`.replay_on_attachment_tree`. Never a second copy.

Rails:
  * THE INDEPENDENT TRUTH: seed a user, take an archive snapshot, delete the account
    (tombstone written), `--archive --write-restored`, assert the member's rows are
    GONE from the restored copy;
  * THE CONTROL: the identical archive object, replayed with an EMPTY id set (no
    tombstones applied), still holds the member -- proving the rail above can fail;
  * the archive prefix is really what gets listed/fetched under `--archive`, never
    the regular weekly-backup one;
  * freshness is exempt for `--archive` and ONLY there -- the same file drilled as a
    regular backup still FAILS on age;
  * `--report` mode: read-only, writes only the named report, no restored copy
    unless `--write-restored` is also given;
  * fail-closed, MUTATION-PROVED two ways: (i) the replay call itself skipped (a
    monkeypatched no-op standing in for a future edit that drops the call) still
    leaves the member and FAILs, never a silent PASS, never a write; (ii) the
    off-site tombstone READ erroring is never swallowed into "zero, therefore
    nothing to replay" -- it stays INCONCLUSIVE, exactly as the regular path does.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import importlib
import shutil
import sqlite3
from pathlib import Path

import pytest

from api.services import account_tombstones as at
from tools import authdb_restore_drill as drill

NOW = dt.datetime(2026, 9, 29, 18, 0, 0, tzinfo=dt.timezone.utc)
# An archive object is old BY DESIGN -- well past MAX_AGE_HOURS (30h). This is exactly
# the property exception (d) names: correct for the archive lineage, wrong for the
# regular one.
ARCHIVE_AGE = dt.timedelta(days=120)
ARCHIVE_KEY_NAME = "pre_pattern_purge_20260601T000000Z.db.gz"  # archive_authdb_backup's own naming
GONE, KEPT = "u-arch-gone-1", "u-arch-kept-2"


@pytest.fixture
def authdb(monkeypatch, tmp_path):
    for v in ("AUTHDB_BACKUP_ENABLED", at.LOCAL_STORE_ENV):
        monkeypatch.delenv(v, raising=False)
    path = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(path))
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield auth_db
    importlib.reload(auth_db)


def _seed(auth_db, uid: str) -> None:
    from api.services.journal_two import notes as notes_svc
    c = auth_db.get_connection()
    try:
        c.execute("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", (uid, f"{uid}@local.test"))
        c.execute("INSERT INTO subscriptions (id, user_id, plan) VALUES (?, ?, 'pro')", (f"s-{uid}", uid))
        c.commit()
        notes_svc.create_note(uid, {"title": f"archived thesis of {uid}",
                                    "bodyJson": {"type": "doc", "content": [{"type": "paragraph", "content": [
                                        {"type": "text", "text": f"private words of {uid}"}]}]}}, conn=c)
    finally:
        c.close()


def _delete_live(auth_db, uid: str) -> dict:
    """What BOTH admin delete endpoints run (api/routers/auth.py): the Journal purge
    (which records the tombstone FIRST), then the users(id) cascade."""
    from api.routers.auth import _cascade_delete_user
    from api.services.journal_two import account_purge
    c = auth_db.get_connection()
    try:
        report = account_purge.purge_user_data(uid, c)
        _cascade_delete_user(c, uid)
        return report
    finally:
        c.close()


def _archive_snapshot(auth_db, dest: Path) -> Path:
    """A consistent copy in the SAME `.db.gz` shape the regular backup job writes --
    `archive_authdb_backup.py` does a server-side copy of an existing backup object
    into `authdb/archive/`, so the bytes are identical in format; only the key (and
    the prune policy) differ."""
    raw = dest.with_suffix("")
    src = sqlite3.connect(auth_db._DB_PATH)
    try:
        dst = sqlite3.connect(str(raw))
        src.backup(dst)
        dst.close()
    finally:
        src.close()
    with open(raw, "rb") as f_in, gzip.open(dest, "wb") as f_out:
        shutil.copyfileobj(f_in, f_out)
    raw.unlink()
    return dest


def _users_and_notes(db: Path) -> tuple[set, set]:
    c = sqlite3.connect(str(db))
    try:
        users = {r[0] for r in c.execute("SELECT id FROM users")}
        note_owners = {r[0] for r in c.execute("SELECT user_id FROM j2_notes")}
        return users, note_owners
    finally:
        c.close()


def _drill_args(**kw):
    base = dict(file=None, list=False, report=None, keep=False, archive=True)
    base.update(kw)
    return argparse.Namespace(**base)


def _minimal_backup(tmp: Path, name: str) -> Path:
    """A standalone `.db.gz` (no `authdb` fixture needed) for the prefix-routing tests."""
    db = tmp / f"{name}.src.db"
    conn = sqlite3.connect(db)
    for t in drill.REQUIRED_TABLES:
        if t == "j2_notes":
            conn.execute("CREATE TABLE j2_notes (id TEXT, updated_at TEXT)")
            conn.execute("INSERT INTO j2_notes VALUES ('n1', '2026-06-01T00:00:00Z')")
        else:
            conn.execute(f'CREATE TABLE "{t}" (id TEXT)')
            conn.execute(f'INSERT INTO "{t}" VALUES (\'x\')')
    conn.execute("CREATE TABLE account_tombstones (user_id TEXT PRIMARY KEY, deleted_at TEXT, offsite_at TEXT)")
    conn.commit()
    conn.close()
    gz = tmp / name
    with open(db, "rb") as f_in, gzip.open(gz, "wb") as f_out:
        shutil.copyfileobj(f_in, f_out)
    db.unlink()
    return gz


class _FakeR2:
    def __init__(self, objects: dict[str, Path]):
        self.objects = objects

    def list_objects_v2(self, **kw):
        keys = [k for k in self.objects if k.startswith(kw["Prefix"])]
        return {"Contents": [{"Key": k, "Size": self.objects[k].stat().st_size} for k in keys]}

    def download_file(self, bucket, key, dest):
        shutil.copyfile(self.objects[key], dest)


# ── the independent truth ────────────────────────────────────────────────────────

def test_an_archive_restore_replays_the_tombstone_the_same_as_a_regular_restore(
        authdb, tmp_path, monkeypatch, capsys):
    store = at.LocalObjectStore(tmp_path / "bucket")
    monkeypatch.setenv(at.LOCAL_STORE_ENV, str(tmp_path / "bucket"))
    _seed(authdb, GONE)
    _seed(authdb, KEPT)
    archive = _archive_snapshot(authdb, tmp_path / ARCHIVE_KEY_NAME)   # BEFORE the deletion
    _delete_live(authdb, GONE)                                        # live purge + tombstone

    # Non-vacuity: the hazard is real -- the archive snapshot still holds the deleted member.
    raw = tmp_path / "raw.db"
    with gzip.open(archive, "rb") as f_in, open(raw, "wb") as f_out:
        shutil.copyfileobj(f_in, f_out)
    users, owners = _users_and_notes(raw)
    assert GONE in users and GONE in owners

    out = tmp_path / "restored-from-archive.db"
    code = drill.run(_drill_args(file=str(archive), write_restored=str(out)), now=NOW, store=store)
    text = capsys.readouterr().out
    assert code == drill.PASS, text
    assert "lineage: ARCHIVE" in text
    assert "deleted accounts present in the snapshot before replay: **1**" in text
    assert "still present after replay: **0**" in text
    users, owners = _users_and_notes(out)
    assert GONE not in users, "an archive restore brought a DELETED account back"
    assert GONE not in owners, "an archive restore brought a deleted member's notes back"
    assert KEPT in users and KEPT in owners, "the replay must delete ONLY the tombstoned member"


def test_CONTROL_the_same_archive_replayed_with_NOTHING_tombstoned_still_holds_the_member(
        authdb, tmp_path):
    """Proves the rail above can fail: the identical archive object, replayed against
    an EMPTY id set, brings the member back -- so a PASS above is proof of the
    replay, not an artifact of the seed data or the file format."""
    _seed(authdb, GONE)
    archive = _archive_snapshot(authdb, tmp_path / ARCHIVE_KEY_NAME)
    raw = tmp_path / "raw.db"
    with gzip.open(archive, "rb") as f_in, open(raw, "wb") as f_out:
        shutil.copyfileobj(f_in, f_out)
    conn = sqlite3.connect(str(raw))
    try:
        result = at.replay_on_db(conn, [])          # the control: nothing tombstoned
    finally:
        conn.close()
    assert result == {"replayed": [], "errors": [], "still_present": []}
    users, _ = _users_and_notes(raw)
    assert GONE in users, "control: with nothing replayed the member is still there"


# ── the archive prefix really is what gets listed / fetched ─────────────────────────

def test_archive_mode_lists_and_fetches_from_the_archive_prefix_not_the_backup_one(tmp_path, capsys):
    backup_key = f"{drill.authdb_backup.KEY_PREFIX}20260601T000000Z.db.gz"
    archive_key = f"{drill.ARCHIVE_PREFIX}pre_pattern_purge_20260601T000000Z.db.gz"
    r2 = _FakeR2({
        backup_key: _minimal_backup(tmp_path, "backup.db.gz"),
        archive_key: _minimal_backup(tmp_path, "archive.db.gz"),
    })
    assert [o["Key"] for o in drill.list_backups(r2, "b", prefix=drill.ARCHIVE_PREFIX)] == [archive_key]

    code = drill.run(_drill_args(list=True), client=r2, bucket="b", now=NOW)
    out = capsys.readouterr().out
    assert code == drill.PASS
    assert archive_key in out and backup_key not in out

    code = drill.run(_drill_args(), client=r2, bucket="b", now=NOW,
                     store=at.LocalObjectStore(tmp_path / "store"))
    out = capsys.readouterr().out
    assert code == drill.PASS, out
    assert f"`{archive_key}`" in out and backup_key not in out


# ── freshness is exempt for --archive, and ONLY for --archive ───────────────────────

def test_an_archive_snapshot_far_past_MAX_AGE_HOURS_still_PASSES(authdb, tmp_path, monkeypatch, capsys):
    store = at.LocalObjectStore(tmp_path / "bucket")
    monkeypatch.setenv(at.LOCAL_STORE_ENV, str(tmp_path / "bucket"))
    _seed(authdb, KEPT)
    archive = _archive_snapshot(authdb, tmp_path / ARCHIVE_KEY_NAME)
    old_now = NOW + ARCHIVE_AGE
    code = drill.run(_drill_args(file=str(archive)), now=old_now, store=store)
    text = capsys.readouterr().out
    assert code == drill.PASS, text
    assert "h old (limit" not in text


def test_CONTROL_the_SAME_file_drilled_as_a_regular_backup_still_fails_on_age(
        authdb, tmp_path, monkeypatch, capsys):
    """The exemption is scoped to `--archive` -- the ordinary weekly path is unchanged."""
    store = at.LocalObjectStore(tmp_path / "bucket")
    monkeypatch.setenv(at.LOCAL_STORE_ENV, str(tmp_path / "bucket"))
    _seed(authdb, KEPT)
    archive = _archive_snapshot(authdb, tmp_path / ARCHIVE_KEY_NAME)
    old_now = NOW + ARCHIVE_AGE
    code = drill.run(_drill_args(file=str(archive), archive=False), now=old_now, store=store)
    text = capsys.readouterr().out
    assert code == drill.FAIL, text
    assert "h old (limit 30" in text


# ── --report mode: read-only, a temp dir, never a live restore unless asked ─────────

def test_archive_report_mode_names_the_lineage_and_writes_nothing_else(
        authdb, tmp_path, monkeypatch, capsys):
    store = at.LocalObjectStore(tmp_path / "bucket")
    monkeypatch.setenv(at.LOCAL_STORE_ENV, str(tmp_path / "bucket"))
    _seed(authdb, KEPT)
    archive = _archive_snapshot(authdb, tmp_path / ARCHIVE_KEY_NAME)
    before = set(tmp_path.iterdir())
    report = tmp_path / "archive-drill.md"
    code = drill.run(_drill_args(file=str(archive), report=str(report)), now=NOW, store=store)
    assert code == drill.PASS
    text = report.read_text(encoding="utf-8")
    assert "# auth.db restore drill - PASS" in text and "lineage: ARCHIVE" in text
    # report mode alone (no --write-restored) writes ONLY the report into this directory --
    # no restored copy, nothing under the shared data root (refuse_shared_root covers that).
    after = set(tmp_path.iterdir())
    assert after - before == {report}


# ── fail closed, mutation-proved ──────────────────────────────────────────────────

def test_an_archive_restore_REFUSES_without_the_offsite_tombstones(authdb, tmp_path, capsys):
    _seed(authdb, KEPT)
    archive = _archive_snapshot(authdb, tmp_path / ARCHIVE_KEY_NAME)
    out = tmp_path / "restored.db"
    code = drill.run(_drill_args(file=str(archive), write_restored=str(out)), now=NOW)  # no store
    assert code == drill.INCONCLUSIVE
    assert not out.exists(), "an archive restore without the tombstones must write nothing"
    assert "off-site tombstones were not read" in capsys.readouterr().out


class _StoreThatErrors:
    """A store whose read genuinely fails. (ii) proves the failure PROPAGATES -- it is
    never swallowed into 'answered, zero tombstones, therefore nothing to replay'."""
    def list_keys(self, prefix):
        raise ConnectionError("planted: the bucket did not answer")


def test_MUTATION_ii_a_tombstone_read_that_ERRORS_is_never_swallowed_to_a_silent_PASS(
        authdb, tmp_path, capsys):
    """(ii) A future edit that caught this exception and returned {} instead of
    propagating it would turn a genuine read failure into an indistinguishable
    'nobody has ever been deleted' -- and this archive snapshot predates the
    deletion, so its OWN table carries no tombstone either: a swallowed read is the
    ONLY way this specific hazard could go unnoticed. It must refuse, not PASS."""
    _seed(authdb, GONE)
    archive = _archive_snapshot(authdb, tmp_path / ARCHIVE_KEY_NAME)   # BEFORE deletion
    _delete_live(authdb, GONE)                                        # tombstone: off-site only
    out = tmp_path / "restored.db"
    code = drill.run(_drill_args(file=str(archive), write_restored=str(out)), now=NOW,
                     store=_StoreThatErrors())
    text = capsys.readouterr().out
    assert code == drill.INCONCLUSIVE, text
    assert "planted" in text
    assert not out.exists(), "NOT WRITTEN: an unread tombstone set must never reach a restored copy"


def test_MUTATION_i_the_replay_call_itself_SKIPPED_leaves_the_member_and_FAILS(
        authdb, tmp_path, monkeypatch, capsys):
    """(i) simulates a future edit that reused the tombstone SET (present_before) but
    dropped the call to `replay_on_db` -- a no-op standing in for that regression.
    `still_present` is what catches it: the member is never removed, so the drill
    FAILs and refuses to write, exactly as it would if the whole function vanished."""
    store = at.LocalObjectStore(tmp_path / "bucket")
    monkeypatch.setenv(at.LOCAL_STORE_ENV, str(tmp_path / "bucket"))
    _seed(authdb, GONE)
    archive = _archive_snapshot(authdb, tmp_path / ARCHIVE_KEY_NAME)
    _delete_live(authdb, GONE)

    def _noop_replay(conn, user_ids):
        ids = sorted({u for u in user_ids if u})
        return {"replayed": [], "errors": [], "still_present": at.present_in(conn, ids)}

    monkeypatch.setattr(at, "replay_on_db", _noop_replay)
    out = tmp_path / "restored.db"
    code = drill.run(_drill_args(file=str(archive), write_restored=str(out)), now=NOW, store=store)
    text = capsys.readouterr().out
    assert code == drill.FAIL, text
    assert "would come back on restore" in text
    assert not out.exists(), "NOT WRITTEN: a skipped replay must never reach a restored copy"
