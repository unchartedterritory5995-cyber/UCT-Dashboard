"""⛔⛔ NO RESTORE BRINGS A DELETED ACCOUNT BACK — ruling R-9 (wave 10, lane 10C, clause 7b).

An account deletion purges the live database at once, but every backup taken before
it still holds the member. R-9: the deletion writes a TOMBSTONE (a row, plus an object
beside the backups) and EVERY restore replays the tombstones before it serves anything.

Pinned here, against a real auth.db schema, a LOCAL fake object store (never the real
bucket -- `DATA_SYNC_*` is set on the owner's machine, which is exactly why the off-site
write is gated on the backups being armed), and the real restore drill:

  * the live deletion (the same composition both admin endpoints run) records the
    tombstone row AND the off-site object, and the row survives the cascade;
  * with no store it is pending, and the backup job's flush pushes it;
  * the default store is NEVER the real bucket unless the backups are armed;
  * THE RESURRECTED-USER RAIL: a snapshot taken BEFORE the deletion, drilled and
    written out for a real restore, no longer holds the member -- and the unreplayed
    snapshot still does (non-vacuity: the hazard is real);
  * a real restore refuses without the off-site tombstones;
  * a restored attachment tree loses exactly the tombstoned directories;
  * the drill's attachment half samples the manifest and catches a changed byte.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import importlib
import io
import json
import os
import shutil
import sqlite3
import tarfile
import tempfile
from pathlib import Path

import pytest

from api.services import account_tombstones as at

NOW = dt.datetime(2026, 9, 26, 18, 0, 0, tzinfo=dt.timezone.utc)
SNAP_NAME = "20260926T120000Z.db.gz"   # 6 h before NOW
GONE, KEPT = "u-gone-1111", "u-kept-2222"


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
        notes_svc.create_note(uid, {"title": f"thesis of {uid}",
                                    "bodyJson": {"type": "doc", "content": [{"type": "paragraph", "content": [
                                        {"type": "text", "text": f"private words of {uid}"}]}]}}, conn=c)
    finally:
        c.close()


def _delete_live(auth_db, uid: str) -> dict:
    """What BOTH admin delete endpoints run (api/routers/auth.py): the Journal purge, then
    the users(id) cascade."""
    from api.routers.auth import _cascade_delete_user
    from api.services.journal_two import account_purge
    c = auth_db.get_connection()
    try:
        report = account_purge.purge_user_data(uid, c)
        _cascade_delete_user(c, uid)
        return report
    finally:
        c.close()


def _snapshot(auth_db, dest: Path) -> Path:
    """A consistent copy the way authdb_backup takes one (the online backup API), gzipped
    under a timestamped name the drill reads."""
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
    base = dict(file=None, list=False, report=None, keep=False)
    base.update(kw)
    return argparse.Namespace(**base)


# ── writing ──────────────────────────────────────────────────────────────────────

def test_the_live_deletion_records_the_row_and_the_offsite_object(authdb, tmp_path, monkeypatch):
    store_dir = tmp_path / "fake-bucket"
    monkeypatch.setenv(at.LOCAL_STORE_ENV, str(store_dir))
    _seed(authdb, GONE)
    report = _delete_live(authdb, GONE)
    assert report["tombstone"] == {"recorded": True, "offsite": True, "why": ""}
    assert report["ok"]
    obj = json.loads((store_dir / at.KEY_PREFIX / f"{GONE}.json").read_text())
    assert obj["user_id"] == GONE and obj["v"] == 1
    assert set(obj) == {"v", "user_id", "deleted_at"}, "a tombstone carries the id and the time, nothing else"
    c = authdb.get_connection()
    try:
        row = c.execute("SELECT user_id, offsite_at FROM account_tombstones").fetchone()
        assert row[0] == GONE and row[1], "the row survives the users(id) cascade, marked off-site"
        assert c.execute("SELECT 1 FROM users WHERE id = ?", (GONE,)).fetchone() is None
    finally:
        c.close()


def test_no_store_leaves_it_PENDING_and_the_backup_flush_pushes_it(authdb, tmp_path):
    _seed(authdb, GONE)
    report = _delete_live(authdb, GONE)
    assert report["tombstone"]["recorded"] and not report["tombstone"]["offsite"]
    assert report["ok"], "a pending off-site write must not fail the deletion"
    from api.services import authdb_backup
    fake = at.LocalObjectStore(tmp_path / "bucket")

    class _Client:  # the R2 client shape R2ObjectStore needs, backed by the local store
        def put_object(self, Bucket, Key, Body, ContentType):
            fake.put(Key, Body)

    assert authdb_backup._flush_pending_tombstones(authdb._DB_PATH, _Client(), "b") == 1
    assert at.offsite_tombstones(fake) and GONE in at.offsite_tombstones(fake)
    assert authdb_backup._flush_pending_tombstones(authdb._DB_PATH, _Client(), "b") == 0, "pushed once"


def test_the_default_store_is_NEVER_the_real_bucket_unless_the_backups_are_armed(monkeypatch):
    """⛔ DATA_SYNC_* is set on the owner's machine; credentials alone must not be enough."""
    from api.services import data_sync
    monkeypatch.delenv(at.LOCAL_STORE_ENV, raising=False)
    monkeypatch.setattr(data_sync, "_client", lambda: object())
    monkeypatch.setattr(data_sync, "_bucket", lambda: "real-bucket")
    monkeypatch.delenv("AUTHDB_BACKUP_ENABLED", raising=False)
    assert at.default_store() is None
    monkeypatch.setenv("AUTHDB_BACKUP_ENABLED", "1")
    assert isinstance(at.default_store(), at.R2ObjectStore)


# ── THE RESURRECTED-USER RAIL ────────────────────────────────────────────────────

def test_a_restore_of_a_snapshot_from_BEFORE_the_deletion_does_not_bring_the_member_back(
        authdb, tmp_path, monkeypatch, capsys):
    from tools import authdb_restore_drill as drill
    store = at.LocalObjectStore(tmp_path / "bucket")
    monkeypatch.setenv(at.LOCAL_STORE_ENV, str(tmp_path / "bucket"))
    _seed(authdb, GONE)
    _seed(authdb, KEPT)
    snap = _snapshot(authdb, tmp_path / SNAP_NAME)       # taken BEFORE the deletion
    _delete_live(authdb, GONE)                            # live purge + tombstone

    # Non-vacuity: the hazard is real -- the snapshot still holds the deleted member.
    raw = tmp_path / "raw.db"
    with gzip.open(snap, "rb") as f_in, open(raw, "wb") as f_out:
        shutil.copyfileobj(f_in, f_out)
    users, owners = _users_and_notes(raw)
    assert GONE in users and GONE in owners

    out = tmp_path / "restored.db"
    code = drill.run(_drill_args(file=str(snap), write_restored=str(out)), now=NOW, store=store)
    text = capsys.readouterr().out
    assert code == drill.PASS, text
    assert "deleted accounts present in the snapshot before replay: **1**" in text
    assert "still present after replay: **0**" in text
    users, owners = _users_and_notes(out)
    assert GONE not in users, "⛔ a restore brought a DELETED account back"
    assert GONE not in owners, "⛔ a restore brought a deleted member's notes back"
    assert KEPT in users and KEPT in owners, "the replay must delete ONLY the tombstoned member"
    c = sqlite3.connect(str(out))
    try:
        assert c.execute("SELECT 1 FROM account_tombstones WHERE user_id = ?", (GONE,)).fetchone(), \
            "the restored copy remembers the tombstone, so a later snapshot of it does too"
    finally:
        c.close()


def test_a_real_restore_REFUSES_without_the_offsite_tombstones(authdb, tmp_path, capsys):
    from tools import authdb_restore_drill as drill
    _seed(authdb, KEPT)
    snap = _snapshot(authdb, tmp_path / SNAP_NAME)
    out = tmp_path / "restored.db"
    code = drill.run(_drill_args(file=str(snap), write_restored=str(out)), now=NOW)  # no store
    assert code == drill.INCONCLUSIVE
    assert not out.exists(), "a restore without the tombstones must write nothing"
    assert "off-site tombstones were not read" in capsys.readouterr().out


def test_replay_is_idempotent(authdb, tmp_path):
    _seed(authdb, GONE)
    raw = tmp_path / "copy.db"
    src = sqlite3.connect(authdb._DB_PATH)
    dst = sqlite3.connect(str(raw))
    src.backup(dst)
    src.close()
    first = at.replay_on_db(dst, [GONE])
    second = at.replay_on_db(dst, [GONE])
    dst.close()
    assert first["replayed"] == [GONE] and first["still_present"] == []
    assert second["still_present"] == []


# ── attachments ──────────────────────────────────────────────────────────────────

def test_a_restored_attachment_tree_loses_exactly_the_tombstoned_directories(tmp_path):
    root = tmp_path / "restored-attachments"
    for uid in (GONE, KEPT):
        (root / uid / "2026-09-26").mkdir(parents=True)
        (root / uid / "2026-09-26" / "shot.png").write_bytes(b"png")
    assert at.replay_on_attachment_tree(root, [GONE, "u-never-had-files"]) == [GONE]
    assert not (root / GONE).exists() and (root / KEPT / "2026-09-26" / "shot.png").exists()


def test_the_attachment_replay_refuses_the_shared_data_root():
    with pytest.raises(ValueError, match="shared data root"):
        at.replay_on_attachment_tree(Path("C:/data/j2_attachments"), [GONE])


def _attachments_tarball(tmp_path: Path, *, corrupt: bool = False, manifest: bool = True) -> Path:
    from api import j2_attachments_backup as ab
    root = tmp_path / "tree"
    for uid in (GONE, KEPT):
        (root / uid / "d").mkdir(parents=True)
        (root / uid / "d" / "a.png").write_bytes(f"image of {uid}".encode())
    gz = tmp_path / "j2-attachments-2026-09-26.tar.gz"
    if manifest:
        ab._make_tarball(root, gz)
    else:
        with tarfile.open(gz, "w:gz") as tar:
            for p in sorted(root.rglob("*")):
                if p.is_file():
                    tar.add(p, arcname=str(p.relative_to(root)))
    if corrupt:  # rewrite one member's bytes, keep the original manifest
        src = tarfile.open(gz, "r:gz")
        members = [(m, src.extractfile(m).read()) for m in src.getmembers() if m.isfile()]
        src.close()
        with tarfile.open(gz, "w:gz") as tar:
            for m, data in members:
                if m.name.replace("\\", "/").endswith(f"{KEPT}/d/a.png"):
                    data = b"CHANGED"
                m.size = len(data)
                tar.addfile(m, io.BytesIO(data))
    return gz


def test_the_drill_samples_the_manifest_and_passes_an_intact_tarball(tmp_path):
    from tools import authdb_restore_drill as drill
    att = drill.attachment_check(None, None, tmp_path, file=str(_attachments_tarball(tmp_path)),
                                 tombstoned=[GONE])
    assert att["verdict"] == "PASS", att
    assert att["sampled"] == 2 and att["tombstoned_dirs"] == [GONE]


def test_the_drill_catches_a_changed_byte(tmp_path):
    from tools import authdb_restore_drill as drill
    att = drill.attachment_check(None, None, tmp_path, file=str(_attachments_tarball(tmp_path, corrupt=True)))
    assert att["verdict"] == "FAIL" and att["mismatched"], att


def test_a_tarball_older_than_the_manifest_is_INCONCLUSIVE_never_a_pass(tmp_path):
    from tools import authdb_restore_drill as drill
    att = drill.attachment_check(None, None, tmp_path, file=str(_attachments_tarball(tmp_path, manifest=False)))
    assert att["verdict"] == "INCONCLUSIVE" and "predates the manifest" in att["why"]


def test_the_weekly_schedule_line_is_one_schtasks_command_with_no_credentials():
    from tools import authdb_restore_drill as drill
    line = drill.schedule_line()
    assert line.startswith('schtasks /Create /TN "UCT Restore Drill" /SC WEEKLY')
    assert "authdb_restore_drill.py" in line and "--report" in line
    assert "DATA_SYNC" not in line and "SECRET" not in line.upper()
