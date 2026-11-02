"""Plan C Task 1: the Obsidian attachment staging store (`obsidian_attachments.py`).

The plugin uploads a vault's attachments by content hash; the server stages them so the
provider's `fetch_media` can serve them during the next sync. These tests pin the store's
contract: round trip, hash/size/member bounds, per-member scoping, bounded GC of
unreferenced blobs, and purge on disconnect and on account deletion.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest

from api.services import auth_db
from api.services.journal_two import media_policy, notes as notes_svc
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import obsidian_attachments as oa
from api.services.journal_two.note_connectors import obsidian_link


def _add_device(conn, user, vault):
    conn.execute(
        "INSERT INTO j2_obsidian_devices (id, user_id, vault_id, token_enc, created_at)"
        " VALUES (?, ?, ?, 'enc', '2026-11-01T00:00:00Z')", (f"dev-{user}-{vault}", user, vault))


@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    monkeypatch.setenv("J2_OBSIDIAN_BLOB_ROOT", str(tmp_path / "blobs"))
    att = tmp_path / "att"
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", att)
    monkeypatch.setenv("J2_ATTACHMENT_ROOT", str(att))
    media_policy._USAGE_MEMO.clear()
    auth_db.init_db()
    conn = auth_db.get_connection()
    ensure_schema(conn)
    # A commit requires the (member, vault)'s device to still exist (fix round 1, item 4a).
    for user in ("u", "u2", "u3"):
        for vault in ("v", "v2"):
            _add_device(conn, user, vault)
    conn.commit()
    conn.close()
    oa._SWEEP_OFFSET.clear()
    yield tmp_path
    media_policy._USAGE_MEMO.clear()


async def _chunks(*parts):
    for p in parts:
        yield p


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


async def _stage(user="u", vault="v", data=b"hello", name="a.png", mime="image/png"):
    return await oa.stage_blob_stream(user_id=user, vault_id=vault, sha256=_sha(data),
                                      declared_mime=mime, name=name, chunks=_chunks(data),
                                      declared_length=len(data))


def _rows(user=None):
    conn = auth_db.get_connection()
    try:
        if user is None:
            return conn.execute("SELECT * FROM j2_obsidian_attachments").fetchall()
        return conn.execute("SELECT * FROM j2_obsidian_attachments WHERE user_id = ?", (user,)).fetchall()
    finally:
        conn.close()


def _files():
    return [p for p in oa.blob_root().rglob("*") if p.is_file()] if oa.blob_root().exists() else []


@pytest.mark.asyncio
async def test_stage_then_read_round_trips_bytes_and_mime(env):
    data = b"\x89PNG\r\n\x1a\n" + b"x" * 100
    sha = _sha(data)
    assert await oa.stage_blob_stream(user_id="u", vault_id="v", sha256=sha, declared_mime="image/png",
        name="chart one.png", chunks=_chunks(data[:10], data[10:]), declared_length=len(data)) is True
    assert oa.read_blob("u", "v", sha) == (data, "image/png")
    assert await oa.stage_blob_stream(user_id="u", vault_id="v", sha256=sha, declared_mime="image/png",
        name="chart one.png", chunks=_chunks(data), declared_length=len(data)) is False
    assert [p.name for p in _files()] == [sha]  # no tmp file left behind


@pytest.mark.asyncio
async def test_hash_mismatch_rejected_and_nothing_left_on_disk(env):
    with pytest.raises(oa.BlobRejected) as e:
        await oa.stage_blob_stream(user_id="u", vault_id="v", sha256="0" * 64, declared_mime=None,
            name="a.png", chunks=_chunks(b"abc"), declared_length=3)
    assert e.value.status == 400
    assert _files() == []
    assert oa.missing_hashes("u", "v", ["0" * 64]) == ["0" * 64]
    assert _rows() == []


@pytest.mark.asyncio
async def test_declared_length_mismatch_rejected(env):
    with pytest.raises(oa.BlobRejected) as e:
        await oa.stage_blob_stream(user_id="u", vault_id="v", sha256=_sha(b"abc"), declared_mime=None,
            name="a.png", chunks=_chunks(b"abc"), declared_length=4)
    assert e.value.status == 400
    assert _files() == [] and _rows() == []


@pytest.mark.asyncio
async def test_malformed_hash_or_unsafe_segment_is_400(env):
    for kw in ({"sha256": "A" * 64}, {"sha256": "abc"}, {"vault_id": "../x"}, {"user_id": "a/b"},
               {"vault_id": ""}):
        args = {"user_id": "u", "vault_id": "v", "sha256": _sha(b"x"), **kw}
        with pytest.raises(oa.BlobRejected) as e:
            await oa.stage_blob_stream(**args, declared_mime=None, name="a", chunks=_chunks(b"x"),
                                       declared_length=1)
        assert e.value.status == 400
    assert _files() == []


@pytest.mark.asyncio
async def test_over_max_bytes_aborts_mid_stream_with_413(env, monkeypatch):
    monkeypatch.setattr(oa, "MAX_BLOB_BYTES", 10)
    with pytest.raises(oa.BlobRejected) as e:
        await oa.stage_blob_stream(user_id="u", vault_id="v", sha256="a" * 64, declared_mime=None,
            name="a.bin", chunks=_chunks(b"123456", b"789012"), declared_length=None)
    assert e.value.status == 413
    assert _files() == [] and _rows() == []


@pytest.mark.asyncio
async def test_over_max_bytes_declared_refused_before_reading(env, monkeypatch):
    monkeypatch.setattr(oa, "MAX_BLOB_BYTES", 10)
    read = []

    async def spy():
        read.append(1)
        yield b"x"

    with pytest.raises(oa.BlobRejected) as e:
        await oa.stage_blob_stream(user_id="u", vault_id="v", sha256="a" * 64, declared_mime=None,
            name="a.bin", chunks=spy(), declared_length=11)
    assert e.value.status == 413 and read == []


@pytest.mark.asyncio
async def test_member_bound_refuses_with_413(env, monkeypatch):
    monkeypatch.setattr(oa, "MEMBER_IMPORT_MEDIA_CAP_BYTES", 5)
    assert oa.remaining_bytes("u") == 5
    with pytest.raises(oa.BlobRejected) as e:
        await oa.stage_blob_stream(user_id="u", vault_id="v", sha256=_sha(b"123456"),
            declared_mime=None, name="a.bin", chunks=_chunks(b"123456"), declared_length=6)
    assert e.value.status == 413 and "storage" in e.value.detail.lower()
    assert oa.remaining_bytes("u") == 5  # nothing was counted


@pytest.mark.asyncio
async def test_member_bound_mid_stream_without_declared_length(env, monkeypatch):
    monkeypatch.setattr(oa, "MEMBER_IMPORT_MEDIA_CAP_BYTES", 5)
    with pytest.raises(oa.BlobRejected) as e:
        await oa.stage_blob_stream(user_id="u", vault_id="v", sha256=_sha(b"123456"),
            declared_mime=None, name="a.bin", chunks=_chunks(b"123", b"456"), declared_length=None)
    assert e.value.status == 413 and "storage" in e.value.detail.lower()
    assert _files() == [] and _rows() == []


@pytest.mark.asyncio
async def test_remaining_bytes_is_the_min_of_staged_and_live_remainders(env, monkeypatch):
    """Ledger ruling: remaining = min(CAP - staged SUM, CAP - live member media bytes), so the
    one 2 GB cap is never counted twice (summed) and neither side can promise room the other
    refuses."""
    monkeypatch.setattr(oa, "MEMBER_IMPORT_MEDIA_CAP_BYTES", 100)
    assert oa.remaining_bytes("u") == 100
    # staged side dominates: 30 bytes staged, nothing stored
    await _stage(data=b"s" * 30)
    assert oa.remaining_bytes("u") == 70
    # live side dominates: 50 bytes of stored media under the member's attachment tree
    d = env / "att" / "u" / "notes" / "n1"
    d.mkdir(parents=True)
    (d / "img.png").write_bytes(b"m" * 50)
    media_policy._USAGE_MEMO.clear()
    assert oa.remaining_bytes("u") == 50  # min(70, 50) -- not 100-30-50=20, not 70
    # another member is untouched by either side
    assert oa.remaining_bytes("u2") == 100
    # and never negative
    (d / "big.png").write_bytes(b"m" * 200)
    media_policy._USAGE_MEMO.clear()
    assert oa.remaining_bytes("u") == 0


@pytest.mark.asyncio
async def test_storage_full_maps_to_503(env, monkeypatch):
    def boom(n):
        raise oa.NoteQuotaExceeded("full")
    monkeypatch.setattr(oa, "assert_import_headroom", boom)
    with pytest.raises(oa.BlobRejected) as e:
        await _stage()
    assert e.value.status == 503
    assert _files() == [] and _rows() == []


@pytest.mark.asyncio
async def test_missing_hashes_is_tenant_scoped(env):
    data = b"tenant"
    sha = _sha(data)
    other = "f" * 64
    await _stage(data=data)
    assert oa.missing_hashes("u", "v", [sha, other, sha]) == [other]
    assert oa.missing_hashes("u2", "v", [sha]) == [sha]
    assert oa.missing_hashes("u", "v2", [sha]) == [sha]
    # order-preserving and deduped
    assert oa.missing_hashes("u2", "v", [other, sha, other]) == [other, sha]


@pytest.mark.asyncio
async def test_read_blob_is_tenant_scoped(env):
    data = b"secret bytes"
    sha = _sha(data)
    await _stage(data=data)
    assert oa.read_blob("u", "v", sha) == (data, "image/png")
    assert oa.read_blob("u2", "v", sha) is None
    assert oa.read_blob("u", "v2", sha) is None
    assert oa.read_blob("u", "v", "../" + sha) is None


def _age_rows(user, vault, hours):
    ts = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    conn = auth_db.get_connection()
    conn.execute("UPDATE j2_obsidian_attachments SET received_at = ? WHERE user_id = ? AND vault_id = ?",
                 (ts, user, vault))
    conn.commit()
    conn.close()


def _staging_row(user, vault, path, refs):
    conn = auth_db.get_connection()
    conn.execute(
        "INSERT INTO j2_obsidian_staging (user_id, vault_id, vault_path, content_hash, body_md,"
        " updated_at, received_at, attachments_json) VALUES (?, ?, ?, 'h', 'b', 't', 't', ?)",
        (user, vault, path, json.dumps([{"sha256": s} for s in refs])),
    )
    conn.commit()
    conn.close()


@pytest.mark.asyncio
async def test_gc_removes_only_unreferenced_old_blobs(env):
    a, b, c = b"AAAA", b"BBBB", b"CCCC"
    await _stage(data=a)
    await _stage(data=b)
    await _stage(user="u2", data=b)  # another member's identical, old, unreferenced blob
    _staging_row("u", "v", "note.md", [_sha(a)])
    _age_rows("u", "v", 25)
    _age_rows("u2", "v", 25)
    await _stage(data=c)  # 1h-old (fresh) unreferenced
    assert oa.gc_unreferenced("u", "v") == 1
    assert oa.read_blob("u", "v", _sha(a)) == (a, "image/png")
    assert oa.read_blob("u", "v", _sha(b)) is None
    assert not (oa.blob_root() / "u" / "v" / _sha(b)).exists()
    assert oa.read_blob("u", "v", _sha(c)) == (c, "image/png")
    assert oa.read_blob("u2", "v", _sha(b)) == (b, "image/png")  # tenant-scoped


@pytest.mark.asyncio
async def test_gc_is_bounded_per_call(env, monkeypatch):
    monkeypatch.setattr(oa, "GC_BATCH", 2)
    for i in range(5):
        await _stage(data=b"blob%d" % i)
    _age_rows("u", "v", 25)
    assert oa.gc_unreferenced("u", "v") == 2
    assert oa.gc_unreferenced("u", "v") == 2
    assert oa.gc_unreferenced("u", "v") == 1
    assert oa.gc_unreferenced("u", "v") == 0


@pytest.mark.asyncio
async def test_gc_refuses_to_guess_when_a_reference_list_is_unreadable(env):
    await _stage(data=b"maybe referenced")
    _age_rows("u", "v", 25)
    conn = auth_db.get_connection()
    conn.execute(
        "INSERT INTO j2_obsidian_staging (user_id, vault_id, vault_path, content_hash, body_md,"
        " updated_at, received_at, attachments_json) VALUES ('u','v','x.md','h','b','t','t','{not json')")
    conn.commit()
    conn.close()
    assert oa.gc_unreferenced("u", "v") == 0
    assert len(_rows("u")) == 1


@pytest.mark.asyncio
async def test_revoke_devices_and_account_purge_remove_blobs(env):
    from api.services.journal_two import account_purge
    await _stage(user="u", data=b"one")
    await _stage(user="u2", data=b"two")
    await _stage(user="u3", data=b"three")
    obsidian_link.revoke_devices("u")
    assert _rows("u") == []
    assert not (oa.blob_root() / "u").exists()
    assert len(_rows("u2")) == 1 and (oa.blob_root() / "u2").exists()

    conn = auth_db.get_connection()
    try:
        account_purge.purge_user_data("u2", conn)
    finally:
        conn.close()
    assert _rows("u2") == []
    assert not (oa.blob_root() / "u2").exists()
    # the third member is untouched by both
    assert oa.read_blob("u3", "v", _sha(b"three")) == (b"three", "image/png")


@pytest.mark.asyncio
async def test_purge_user_is_scoped(env):
    await _stage(user="u", data=b"one")
    await _stage(user="u2", data=b"two")
    assert oa.purge_user("u") == 1
    assert _rows("u") == [] and len(_rows("u2")) == 1
    assert oa.read_blob("u2", "v", _sha(b"two")) == (b"two", "image/png")


def test_schema_has_new_columns_on_an_old_db(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    auth_db.init_db()
    conn = auth_db.get_connection()
    conn.executescript("""
        DROP TABLE IF EXISTS j2_obsidian_devices;
        DROP TABLE IF EXISTS j2_obsidian_staging;
        DROP TABLE IF EXISTS j2_obsidian_manifest;
        DROP TABLE IF EXISTS j2_obsidian_attachments;
        CREATE TABLE j2_obsidian_devices (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, vault_id TEXT NOT NULL,
            token_enc TEXT NOT NULL, label TEXT, last_seen_at TEXT, created_at TEXT NOT NULL,
            UNIQUE(user_id, vault_id));
        CREATE TABLE j2_obsidian_staging (
            user_id TEXT NOT NULL, vault_id TEXT NOT NULL, vault_path TEXT NOT NULL,
            content_hash TEXT NOT NULL, body_md TEXT NOT NULL, updated_at TEXT NOT NULL,
            received_at TEXT NOT NULL, PRIMARY KEY (user_id, vault_id, vault_path));
        CREATE TABLE j2_obsidian_manifest (
            user_id TEXT NOT NULL, vault_id TEXT NOT NULL, vault_path TEXT NOT NULL,
            recorded_at TEXT NOT NULL, PRIMARY KEY (user_id, vault_id, vault_path));
    """)
    conn.commit()
    ensure_schema(conn)
    ensure_schema(conn)  # idempotent
    cols = lambda t: {r[1] for r in conn.execute(f"PRAGMA table_info({t})")}
    assert "attachments_json" in cols("j2_obsidian_staging")
    assert "plugin_version" in cols("j2_obsidian_devices")
    assert {"user_id", "vault_id", "sha256", "size", "declared_mime", "name", "received_at"} <= cols(
        "j2_obsidian_attachments")
    conn.close()


def test_fresh_db_has_the_same_columns(env):
    conn = auth_db.get_connection()
    try:
        cols = lambda t: {r[1] for r in conn.execute(f"PRAGMA table_info({t})")}
        assert "attachments_json" in cols("j2_obsidian_staging")
        assert "plugin_version" in cols("j2_obsidian_devices")
    finally:
        conn.close()


def test_blob_root_is_outside_the_attachment_root(monkeypatch, tmp_path):
    monkeypatch.delenv("J2_OBSIDIAN_BLOB_ROOT", raising=False)
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    assert oa.blob_root() == tmp_path / "j2_obsidian_staging_blobs"
    assert oa.MAX_BLOB_BYTES == media_policy.MEDIA_SOURCE_MAX_BYTES


# ── fix round 1 ─────────────────────────────────────────────────────────────

def _orphan(user, vault, data):
    p = oa.blob_root() / user / vault / _sha(data)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    return p


def _tmp_file(user, vault, hours_old):
    import os
    import uuid
    p = oa.blob_root() / user / vault / f"{_sha(uuid.uuid4().bytes)}.tmp-{uuid.uuid4().hex}"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"partial")
    t = (datetime.now(timezone.utc) - timedelta(hours=hours_old)).timestamp()
    os.utime(p, (t, t))
    return p


@pytest.mark.asyncio
async def test_gc_sweeps_orphan_files_and_stale_tmp(env):
    """Item 1: a blob file with no row (crash between row delete and unlink) and a tmp file
    left by a killed upload are invisible to the row pass and to the room check; the
    bounded directory sweep removes them. A fresh tmp (an upload in flight), a staged blob
    and another member's orphan are left alone."""
    await _stage(data=b"kept")
    orphan = _orphan("u", "v", b"orphan")
    old_tmp = _tmp_file("u", "v", hours_old=25)
    fresh_tmp = _tmp_file("u", "v", hours_old=0)
    other = _orphan("u2", "v", b"other member orphan")
    assert oa.gc_unreferenced("u", "v") == 2
    assert not orphan.exists() and not old_tmp.exists()
    assert fresh_tmp.exists() and other.exists()
    assert oa.read_blob("u", "v", _sha(b"kept")) == (b"kept", "image/png")


@pytest.mark.asyncio
async def test_gc_sweep_never_removes_a_live_upload_tmp_even_with_a_zero_cutoff(env):
    fresh_tmp = _tmp_file("u", "v", hours_old=0)
    assert oa.gc_unreferenced("u", "v", older_than=timedelta(0)) == 0
    assert fresh_tmp.exists()


@pytest.mark.asyncio
async def test_gc_sweep_is_bounded_and_resumes(env, monkeypatch):
    monkeypatch.setattr(oa, "GC_SWEEP_MAX", 2)
    kept = [b"k1", b"k2", b"k3"]
    for d in kept:
        await _stage(data=d)
    orphans = [_orphan("u", "v", b"o%d" % i) for i in range(3)]
    results = [oa.gc_unreferenced("u", "v") for _ in range(8)]
    assert all(r <= 2 for r in results)
    assert sum(results) == 3
    assert not any(p.exists() for p in orphans)
    for d in kept:
        assert oa.read_blob("u", "v", _sha(d)) == (d, "image/png")


@pytest.mark.asyncio
async def test_commit_time_room_recheck_refuses(env, monkeypatch):
    """Item 2: the pre-stream and in-stream checks pass (room looks ample), then the room is
    gone by the time the upload commits (another upload took it). Only the re-check inside
    `_commit`, under `_COMMIT_LOCK`, can refuse here."""
    calls = []
    real = oa.remaining_bytes

    def shrinking(user_id):
        calls.append(user_id)
        return 10 ** 9 if len(calls) == 1 else 0

    monkeypatch.setattr(oa, "remaining_bytes", shrinking)
    with pytest.raises(oa.BlobRejected) as e:
        await _stage(data=b"late")
    assert e.value.status == 413 and "storage" in e.value.detail.lower()
    assert len(calls) == 2  # the pre-stream read and the commit-time re-check
    monkeypatch.setattr(oa, "remaining_bytes", real)
    assert _rows() == [] and _files() == []


@pytest.mark.asyncio
async def test_os_invalid_ids_are_400_not_500(env):
    for vault in ("a\x00b", "a:b", "a|b", "a\nb", "x" * 201, "trailing.", "trailing "):
        with pytest.raises(oa.BlobRejected) as e:
            await oa.stage_blob_stream(user_id="u", vault_id=vault, sha256=_sha(b"x"), declared_mime=None,
                                       name="a", chunks=_chunks(b"x"), declared_length=1)
        assert e.value.status == 400, vault
    assert _files() == [] and _rows() == []
    assert oa.read_blob("u", "a\x00b", _sha(b"x")) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("revoke", ["devices", "account"])
async def test_upload_finishing_after_revoke_or_account_purge_is_refused(env, revoke):
    """Item 4a: the stream started while the vault was connected; the member disconnects
    (or the account is deleted) mid-stream. The commit must not recreate a row or a file."""
    from api.services.journal_two import account_purge

    async def chunks_then_revoke():
        yield b"first half "
        if revoke == "devices":
            obsidian_link.revoke_devices("u")
        else:
            conn = auth_db.get_connection()
            try:
                account_purge.purge_user_data("u", conn)
            finally:
                conn.close()
        yield b"second half"

    data = b"first half second half"
    with pytest.raises(oa.BlobRejected) as e:
        await oa.stage_blob_stream(user_id="u", vault_id="v", sha256=_sha(data), declared_mime=None,
                                   name="a.png", chunks=chunks_then_revoke(), declared_length=len(data))
    assert e.value.status == 403
    assert _rows("u") == []
    assert [p for p in _files() if p.relative_to(oa.blob_root()).parts[0] == "u"] == []


@pytest.mark.asyncio
async def test_gc_unlink_keeps_a_file_whose_row_came_back(env, monkeypatch):
    """Item 4b: GC deletes the row, then an upload of the same sha commits (row + file)
    before GC's unlink runs. The unlink must re-check the row under the lock and keep
    the new file, or the member is left with a row pointing at nothing."""
    data = b"raced"
    await _stage(data=data)
    _age_rows("u", "v", 25)
    real = oa._remove_if_unreferenced

    def upload_commits_first(user_id, vault_id, sha256):
        conn = auth_db.get_connection()
        conn.execute(
            "INSERT OR IGNORE INTO j2_obsidian_attachments (user_id, vault_id, sha256, size,"
            " declared_mime, name, received_at) VALUES (?, ?, ?, ?, 'image/png', 'a.png', ?)",
            (user_id, vault_id, sha256, len(data), datetime.now(timezone.utc).isoformat()))
        conn.commit()
        conn.close()
        return real(user_id, vault_id, sha256)

    monkeypatch.setattr(oa, "_remove_if_unreferenced", upload_commits_first)
    oa.gc_unreferenced("u", "v")
    assert oa.read_blob("u", "v", _sha(data)) == (data, "image/png")
