"""The restore tools read ENCRYPTED backups with the offline private key, and legacy plaintext
ones without any key. A restore that cannot decrypt is never a pass.

Covers tools/authdb_restore_drill.py (auth.db + the attachments half), tools/store_restore.py
and tools/gen_backup_keypair.py, end to end with a generated test keypair.
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import gzip
import io
import json
import shutil
import sqlite3
import tarfile
from pathlib import Path

import pytest

from api.services import backup_crypto as bc
from tests import _backup_keys as K
from tools import authdb_restore_drill as drill

NOW = dt.datetime(2026, 10, 22, 18, 0, 0, tzinfo=dt.timezone.utc)
ENC_KEY = "authdb/backup/20261022T120000Z.db.gz.enc"      # 6h before NOW
LEGACY_KEY = "authdb/backup/20261022T000000Z.db.gz"       # 18h before NOW


class FakeR2:
    def __init__(self, objects: dict[str, bytes] | None = None, modified: dt.datetime | None = None):
        self.objects = dict(objects or {})
        self.downloaded: list[str] = []
        self.modified = modified or NOW

    def upload_file(self, path, bucket, key, ExtraArgs=None):
        self.objects[key] = Path(path).read_bytes()

    def put_object(self, Bucket=None, Key=None, Body=b"", ContentType=None):
        self.objects[Key] = bytes(Body)

    def list_objects_v2(self, Bucket=None, Prefix="", ContinuationToken=None, **_):
        keys = sorted(k for k in self.objects if k.startswith(Prefix or ""))
        return {"Contents": [{"Key": k, "Size": len(self.objects[k]), "LastModified": self.modified}
                             for k in keys], "IsTruncated": False}

    def download_file(self, bucket, key, dest):
        if key not in self.objects:
            raise FileNotFoundError(key)
        self.downloaded.append(key)
        Path(dest).write_bytes(self.objects[key])

    def delete_object(self, Bucket=None, Key=None):
        self.objects.pop(Key, None)


def _auth_gz_bytes(tmp: Path, marker: str = "x") -> bytes:
    db = tmp / f"src-{marker}.db"
    conn = sqlite3.connect(db)
    for t in drill.REQUIRED_TABLES:
        if t == "j2_notes":
            conn.execute("CREATE TABLE j2_notes (id TEXT, updated_at TEXT)")
            conn.execute("INSERT INTO j2_notes VALUES (?, '2026-10-22T11:59:00Z')", (marker,))
        else:
            conn.execute(f'CREATE TABLE "{t}" (id TEXT)')
            conn.execute(f'INSERT INTO "{t}" VALUES (?)', (marker,))
    conn.commit()
    conn.close()
    data = gzip.compress(db.read_bytes())
    db.unlink()
    return data


def _encrypt_bytes(tmp: Path, data: bytes, which: str = "a") -> bytes:
    src, enc = tmp / "plain.tmp", tmp / "plain.tmp.enc"
    src.write_bytes(data)
    bc.encrypt_file(src, enc, K.keypair(which)[1])
    out = enc.read_bytes()
    src.unlink()
    enc.unlink()
    return out


def _args(**kw):
    base = dict(file=None, list=False, report=None, keep=False, private_key=None)
    base.update(kw)
    return argparse.Namespace(**base)


@pytest.fixture()
def store(tmp_path):
    from api.services import account_tombstones as at
    return at.LocalObjectStore(tmp_path / "tombstones")


@pytest.fixture(autouse=True)
def _no_ambient_private_key(monkeypatch):
    monkeypatch.delenv(bc.PRIVATE_KEY_PATH_ENV, raising=False)
    monkeypatch.delenv(bc.PRIVATE_KEY_PASSPHRASE_ENV, raising=False)


# ═══ auth.db drill ═════════════════════════════════════════════════════════
def test_drill_lists_and_dates_both_name_forms():
    assert drill.snapshot_time(ENC_KEY) == dt.datetime(2026, 10, 22, 12, 0, tzinfo=dt.timezone.utc)
    assert drill.snapshot_time(LEGACY_KEY) == dt.datetime(2026, 10, 22, 0, 0, tzinfo=dt.timezone.utc)
    r2 = FakeR2({ENC_KEY: b"e", LEGACY_KEY: b"l", "authdb/backup/notes.txt": b"n"})
    assert [o["Key"] for o in drill.list_backups(r2, "b")] == [ENC_KEY, LEGACY_KEY]


def test_drill_decrypts_the_newest_encrypted_backup_with_the_env_key(tmp_path, monkeypatch, store, capsys):
    r2 = FakeR2({LEGACY_KEY: _auth_gz_bytes(tmp_path, "old"),
                 ENC_KEY: _encrypt_bytes(tmp_path, _auth_gz_bytes(tmp_path, "new"))})
    monkeypatch.setenv(bc.PRIVATE_KEY_PATH_ENV, str(K.write_private(tmp_path)))
    assert drill.run(_args(), client=r2, bucket="b", now=NOW, store=store) == drill.PASS
    assert r2.downloaded == [ENC_KEY]
    out = capsys.readouterr().out
    assert "integrity_check: ok" in out and "| users | 1 |" in out


def test_drill_private_key_flag_beats_the_env(tmp_path, monkeypatch, store):
    r2 = FakeR2({ENC_KEY: _encrypt_bytes(tmp_path, _auth_gz_bytes(tmp_path))})
    monkeypatch.setenv(bc.PRIVATE_KEY_PATH_ENV, str(K.write_private(tmp_path, "b")))   # the wrong one
    args = _args(private_key=str(K.write_private(tmp_path, "a")))
    assert drill.run(args, client=r2, bucket="b", now=NOW, store=store) == drill.PASS


def test_drill_without_a_private_key_is_INCONCLUSIVE_never_a_pass(tmp_path, store, capsys):
    r2 = FakeR2({ENC_KEY: _encrypt_bytes(tmp_path, _auth_gz_bytes(tmp_path))})
    assert drill.run(_args(), client=r2, bucket="b", now=NOW, store=store) == drill.INCONCLUSIVE
    assert bc.PRIVATE_KEY_PATH_ENV in capsys.readouterr().out


def test_drill_with_the_WRONG_private_key_FAILS(tmp_path, store, capsys):
    r2 = FakeR2({ENC_KEY: _encrypt_bytes(tmp_path, _auth_gz_bytes(tmp_path))})
    args = _args(private_key=str(K.write_private(tmp_path, "b")))
    assert drill.run(args, client=r2, bucket="b", now=NOW, store=store) == drill.FAIL
    assert "decrypt" in capsys.readouterr().out


def test_drill_a_TAMPERED_encrypted_backup_FAILS(tmp_path, store):
    blob = bytearray(_encrypt_bytes(tmp_path, _auth_gz_bytes(tmp_path)))
    blob[len(blob) // 2] ^= 0xFF
    r2 = FakeR2({ENC_KEY: bytes(blob)})
    args = _args(private_key=str(K.write_private(tmp_path)))
    assert drill.run(args, client=r2, bucket="b", now=NOW, store=store) == drill.FAIL


def test_drill_a_legacy_plaintext_backup_still_restores_without_any_key(tmp_path, store):
    r2 = FakeR2({LEGACY_KEY: _auth_gz_bytes(tmp_path)})
    assert drill.run(_args(), client=r2, bucket="b", now=NOW, store=store) == drill.PASS


def test_drill_write_restored_writes_the_DECRYPTED_database(tmp_path, store):
    r2 = FakeR2({ENC_KEY: _encrypt_bytes(tmp_path, _auth_gz_bytes(tmp_path, "zq81"))})
    out = tmp_path / "restored.db"
    args = _args(private_key=str(K.write_private(tmp_path)), write_restored=str(out))
    assert drill.run(args, client=r2, bucket="b", now=NOW, store=store) == drill.PASS
    c = sqlite3.connect(out)
    try:
        assert c.execute("SELECT id FROM users").fetchone()[0] == "zq81"
    finally:
        c.close()


def _attachments_tarball() -> bytes:
    from api import j2_attachments_backup as ab
    import hashlib
    blob = b"\x89PNG fake image"
    manifest = json.dumps({"v": 1, "count": 1, "files": [
        {"path": "u1/2026-10-21/a.png", "bytes": len(blob), "sha256": hashlib.sha256(blob).hexdigest()}]}).encode()
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, data in (("u1/2026-10-21/a.png", blob), (ab.MANIFEST_NAME, manifest)):
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def test_drill_attachments_half_decrypts_an_encrypted_tarball(tmp_path):
    key = "j2_attachment_backups/j2-attachments-2026-10-22.tar.gz.enc"
    r2 = FakeR2({key: _encrypt_bytes(tmp_path, _attachments_tarball())}, modified=NOW - dt.timedelta(hours=3))
    work = tmp_path / "w"
    work.mkdir()
    priv = K.keypair()[0]
    res = drill.attachment_check(r2, "b", work, now=NOW, private_key=priv)
    assert res["verdict"] == "PASS", res
    assert res["source"] == key
    # Without the key the half is an unknown, never a pass.
    work2 = tmp_path / "w2"
    work2.mkdir()
    res = drill.attachment_check(r2, "b", work2, now=NOW, private_key=None)
    assert res["verdict"] == "INCONCLUSIVE" and bc.PRIVATE_KEY_PATH_ENV in res["why"]


def test_drill_attachments_prefers_the_newer_encrypted_tarball_over_legacy(tmp_path):
    new = "j2_attachment_backups/j2-attachments-2026-10-22.tar.gz.enc"
    old = "j2_attachment_backups/j2-attachments-2026-10-21.tar.gz"
    r2 = FakeR2({old: _attachments_tarball(), new: _encrypt_bytes(tmp_path, _attachments_tarball())},
                modified=NOW - dt.timedelta(hours=3))
    work = tmp_path / "w"
    work.mkdir()
    res = drill.attachment_check(r2, "b", work, now=NOW, private_key=K.keypair()[0])
    assert res["source"] == new and res["verdict"] == "PASS"


# ═══ store restore ═════════════════════════════════════════════════════════
SNOW = dt.datetime(2026, 10, 22, 7, 5, tzinfo=dt.timezone.utc)


def _store_db(tmp: Path) -> Path:
    p = tmp / "community.db"
    c = sqlite3.connect(str(p))
    c.execute("CREATE TABLE posts (id INTEGER PRIMARY KEY, body TEXT)")
    c.executemany("INSERT INTO posts (body) VALUES (?)", [(f"p{i}",) for i in range(12)])
    c.commit()
    c.close()
    return p


def _store_backup(tmp: Path, r2: FakeR2, now=SNOW, encrypted=True):
    from api.services import store_backup as sb
    sub = tmp / f"s-{now:%d%H}-{int(encrypted)}"
    (sub / "src").mkdir(parents=True)
    (sub / "art").mkdir()
    src = _store_db(sub / "src")
    if encrypted:
        return sb.backup_store("community", str(src), r2, "bucket", now=now, public_key=K.keypair()[1])
    # A LEGACY plaintext object pair, exactly as the pre-encryption rail wrote it.
    art = sb.build_artifacts("community", str(src), str(sub / "art"), now)
    key = sb.db_key("community", now, encrypted=False)
    r2.objects[key] = Path(art["gz"]).read_bytes()
    r2.objects[sb.manifest_key(key)] = Path(art["manifest_path"]).read_bytes()
    return {"status": "ok", "key": key}


def test_store_rehearsal_decrypts_an_encrypted_backup(tmp_path):
    from tools import store_restore as sr
    r2 = FakeR2()
    res = _store_backup(tmp_path, r2)
    assert res["key"].endswith(".db.gz.enc")
    work = tmp_path / "work"
    work.mkdir()
    rep = sr.rehearse_stores(r2, "bucket", now=SNOW, work=work, stores=["community"],
                             private_key=K.keypair()[0])
    one = rep["stores"]["community"]
    assert one["verdict"] == "PASS", one
    assert one["restored"]["tables"]["posts"] == 12


def test_store_rehearsal_without_a_key_is_INCONCLUSIVE(tmp_path):
    from tools import store_restore as sr
    r2 = FakeR2()
    _store_backup(tmp_path, r2)
    work = tmp_path / "work"
    work.mkdir()
    rep = sr.rehearse_stores(r2, "bucket", now=SNOW, work=work, stores=["community"])
    assert rep["stores"]["community"]["verdict"] == "INCONCLUSIVE"
    assert rep["verdict"] == sr.INCONCLUSIVE


def test_store_rehearsal_with_the_wrong_key_FAILS(tmp_path):
    from tools import store_restore as sr
    r2 = FakeR2()
    _store_backup(tmp_path, r2)
    work = tmp_path / "work"
    work.mkdir()
    rep = sr.rehearse_stores(r2, "bucket", now=SNOW, work=work, stores=["community"],
                             private_key=K.keypair("b")[0])
    assert rep["stores"]["community"]["verdict"] == "FAIL"


def test_store_rehearsal_legacy_plaintext_needs_no_key_and_newest_wins_over_mixed(tmp_path):
    from tools import store_restore as sr
    r2 = FakeR2()
    _store_backup(tmp_path, r2, now=SNOW - dt.timedelta(hours=24), encrypted=False)
    work = tmp_path / "work"
    work.mkdir()
    rep = sr.rehearse_stores(r2, "bucket", now=SNOW, work=work, stores=["community"])
    assert rep["stores"]["community"]["verdict"] == "PASS", rep
    # Now an encrypted one lands, newer: it is the one rehearsed.
    _store_backup(tmp_path, r2, now=SNOW)
    work2 = tmp_path / "work2"
    work2.mkdir()
    rep = sr.rehearse_stores(r2, "bucket", now=SNOW, work=work2, stores=["community"],
                             private_key=K.keypair()[0])
    assert rep["stores"]["community"]["key"].endswith(".db.gz.enc")
    assert rep["stores"]["community"]["verdict"] == "PASS"


def test_store_restore_cli_file_and_real_restore_with_private_key_flag(tmp_path, capsys):
    from api.services import store_backup as sb
    from tools import store_restore as sr
    r2 = FakeR2()
    # The CLI judges freshness against the real clock, so this object is stamped "now".
    res = _store_backup(tmp_path, r2, now=dt.datetime.now(dt.timezone.utc).replace(microsecond=0))
    dl = tmp_path / "dl"
    dl.mkdir()
    enc_db = dl / Path(res["key"]).name
    enc_db.write_bytes(r2.objects[res["key"]])
    (dl / Path(sb.manifest_key(res["key"])).name).write_bytes(r2.objects[sb.manifest_key(res["key"])])
    pk = K.write_private(tmp_path)
    assert sr.main(["--file", str(enc_db), "--manifest", str(dl / Path(sb.manifest_key(res["key"])).name),
                    "--private-key", str(pk)]) == sr.PASS
    target = tmp_path / "live" / "community.db"
    target.parent.mkdir()
    # --restore with a local .enc file: the manifest beside it is found by name.
    assert sr.main(["--restore", str(enc_db), "--to", str(target), "--private-key", str(pk)]) == sr.PASS
    c = sqlite3.connect(str(target))
    try:
        assert c.execute("SELECT COUNT(*) FROM posts").fetchone()[0] == 12
    finally:
        c.close()


# ═══ the keypair tool, and the whole loop with a key it generated ══════════
def test_gen_keypair_writes_private_prints_only_public(tmp_path, capsys):
    from tools import gen_backup_keypair as g
    out = tmp_path / "keys" / "uct-backup-private.pem"
    assert g.main(["--out", str(out)]) == 0
    printed = capsys.readouterr().out.strip()
    assert "\n" not in printed and "PRIVATE" not in printed
    pub = base64.b64decode(printed)
    assert pub.startswith(b"-----BEGIN PUBLIC KEY-----")
    priv = out.read_bytes()
    assert b"PRIVATE KEY" in priv and priv not in printed.encode()
    # The pair works: encrypt with the printed public key, decrypt with the written private one.
    src, enc, back = tmp_path / "s", tmp_path / "s.enc", tmp_path / "b"
    src.write_bytes(b"roundtrip")
    bc.encrypt_file(src, enc, pub)
    bc.decrypt_file(enc, back, priv)
    assert back.read_bytes() == b"roundtrip"


def test_gen_keypair_refuses_to_overwrite(tmp_path, capsys):
    from tools import gen_backup_keypair as g
    out = tmp_path / "k.pem"
    out.write_bytes(b"existing")
    assert g.main(["--out", str(out)]) != 0
    assert out.read_bytes() == b"existing"
    assert "PUBLIC" not in capsys.readouterr().out


def test_gen_keypair_refuses_a_path_inside_the_repo(capsys):
    from tools import gen_backup_keypair as g
    inside = g.REPO / "tmp-should-never-exist-private.pem"
    assert g.main(["--out", str(inside)]) != 0
    assert not inside.exists()


def test_full_loop_rail_to_r2_to_drill_with_a_generated_keypair(tmp_path, monkeypatch, capsys, store):
    from api.services import authdb_backup as ab
    from api.services import data_sync
    from tools import gen_backup_keypair as g
    priv_path = tmp_path / "offline" / "private.pem"
    assert g.main(["--out", str(priv_path)]) == 0
    monkeypatch.setenv(bc.PUBLIC_KEY_ENV, capsys.readouterr().out.strip())

    src = tmp_path / "auth.db"
    src.write_bytes(gzip.decompress(_auth_gz_bytes(tmp_path, "loop")))
    r2 = FakeR2()
    monkeypatch.setenv(ab.ENABLED_ENV, "1")
    monkeypatch.setattr(ab, "_auth_db_path", lambda: str(src))
    monkeypatch.setattr(data_sync, "_client", lambda: r2)
    monkeypatch.setattr(data_sync, "_bucket", lambda: "b")
    ts = ab.run_backup()
    assert ts and f"{ab.KEY_PREFIX}{ts}.db.gz.enc" in r2.objects

    now = dt.datetime.strptime(ts, "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc) + dt.timedelta(minutes=5)
    assert drill.run(_args(private_key=str(priv_path)), client=r2, bucket="b", now=now, store=store) == drill.PASS
    assert drill.run(_args(), client=r2, bucket="b", now=now, store=store) == drill.INCONCLUSIVE
