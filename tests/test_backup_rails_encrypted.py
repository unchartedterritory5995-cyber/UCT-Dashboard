"""Every backup that leaves web is ENCRYPTED, and a rail with no public key uploads NOTHING.

The four rails (auth.db, the store backups, the J2 attachments tree, flow.db) must each:
  * upload only ``.enc`` objects whose bytes start with the UCTBK1 magic and do not hold a
    plaintext marker seeded into the source -- and which DO hold it once decrypted with the
    private key (so the marker test is not vacuous);
  * upload NOTHING while enabled with BACKUP_PUBLIC_KEY unset (or invalid), log one ERROR
    naming the variable, and return the rail's normal nothing-done value without raising;
  * keep pruning / listing / staleness correct over a MIX of legacy plaintext and new
    ``.enc`` keys, ordered by timestamp.
"""
from __future__ import annotations

import datetime as dt
import gzip
import io
import logging
import sqlite3
import tarfile
from datetime import date, timedelta
from pathlib import Path

import pytest

from api.services import backup_crypto as bc
from tests import _backup_keys as K

MARKER = "PLAINTEXT-MARKER-zq81-alice@example.com"
MARKER_B = MARKER.encode()


class FakeR2:
    """In-memory object store with the boto3 calls the rails and the restore tools use."""

    def __init__(self, objects=None):
        self.objects: dict[str, bytes] = dict(objects or {})
        self.uploads: list[str] = []
        self.deleted: list[str] = []
        self.extra: dict[str, dict] = {}

    def upload_file(self, path, bucket, key, ExtraArgs=None):
        self.objects[key] = Path(path).read_bytes()
        self.uploads.append(key)
        self.extra[key] = ExtraArgs or {}

    def put_object(self, Bucket=None, Key=None, Body=b"", ContentType=None):
        self.objects[Key] = bytes(Body)

    def download_file(self, bucket, key, dest):
        if key not in self.objects:
            raise FileNotFoundError(key)
        Path(dest).write_bytes(self.objects[key])

    def list_objects_v2(self, Bucket=None, Prefix="", ContinuationToken=None, **_):
        keys = sorted(k for k in self.objects if k.startswith(Prefix or ""))
        return {"Contents": [{"Key": k, "Size": len(self.objects[k]),
                              "LastModified": dt.datetime.now(dt.timezone.utc)} for k in keys],
                "IsTruncated": False}

    def delete_object(self, Bucket=None, Key=None):
        self.deleted.append(Key)
        self.objects.pop(Key, None)


def _decrypt_bytes(blob: bytes, tmp_path: Path, which: str = "a") -> bytes:
    src, out = tmp_path / "dl.enc", tmp_path / "dl.plain"
    src.write_bytes(blob)
    bc.decrypt_file(src, out, K.keypair(which)[0])
    data = out.read_bytes()
    out.unlink()
    return data


def _assert_sealed(blob: bytes, tmp_path: Path) -> bytes:
    """Encrypted on the wire, marker inside once opened. Returns the plaintext."""
    assert blob.startswith(bc.MAGIC)
    assert MARKER_B not in blob
    plain = _decrypt_bytes(blob, tmp_path)
    return plain


def _seed_sqlite(path: Path) -> None:
    c = sqlite3.connect(str(path))
    c.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)")
    c.executemany("INSERT INTO users (email) VALUES (?)", [(f"{MARKER}-{i}",) for i in range(30)])
    c.commit()
    c.close()


def _fail_closed_env(monkeypatch, how: str):
    if how == "unset":
        monkeypatch.delenv(bc.PUBLIC_KEY_ENV, raising=False)
    else:
        monkeypatch.setenv(bc.PUBLIC_KEY_ENV, "this-is-not-a-key")


def _one_error_naming_the_variable(caplog):
    errs = [r for r in caplog.records if r.levelno >= logging.ERROR and bc.PUBLIC_KEY_ENV in r.getMessage()]
    assert len(errs) == 1, [r.getMessage() for r in caplog.records]


# ═══ auth.db ════════════════════════════════════════════════════════════════
@pytest.fixture()
def authdb_wired(tmp_path, monkeypatch):
    from api.services import authdb_backup as ab
    from api.services import data_sync
    src = tmp_path / "auth.db"
    _seed_sqlite(src)
    r2 = FakeR2()
    monkeypatch.setenv(ab.ENABLED_ENV, "1")
    monkeypatch.setattr(ab, "_auth_db_path", lambda: str(src))
    monkeypatch.setattr(data_sync, "_client", lambda: r2)
    monkeypatch.setattr(data_sync, "_bucket", lambda: "bucket")
    return ab, r2


def test_authdb_uploads_only_an_encrypted_object(authdb_wired, monkeypatch, tmp_path):
    ab, r2 = authdb_wired
    K.arm(monkeypatch)
    ts = ab.run_backup()
    assert ts is not None
    backups = [k for k in r2.uploads if k.startswith(ab.KEY_PREFIX)]
    assert backups == [f"{ab.KEY_PREFIX}{ts}.db.gz.enc"]
    assert r2.extra[backups[0]]["ContentType"] == bc.ENC_CONTENT_TYPE
    plain = _assert_sealed(r2.objects[backups[0]], tmp_path)
    assert MARKER_B in gzip.decompress(plain)            # non-vacuity: it IS the member data


@pytest.mark.parametrize("how", ["unset", "invalid"])
def test_authdb_fails_closed_without_the_public_key(authdb_wired, monkeypatch, caplog, how):
    ab, r2 = authdb_wired
    _fail_closed_env(monkeypatch, how)
    with caplog.at_level(logging.ERROR):
        assert ab.run_backup() is None
    assert r2.uploads == [] and r2.objects == {}
    _one_error_naming_the_variable(caplog)


def test_authdb_prune_counts_legacy_and_enc_together_by_timestamp():
    from api.services import authdb_backup as ab
    keys = []
    for d in range(1, 21):
        suffix = ".db.gz" if d <= 12 else ".db.gz.enc"   # the switch-over on day 13
        keys.append(f"{ab.KEY_PREFIX}202610{d:02d}T120000Z{suffix}")
    r2 = FakeR2({k: b"x" for k in keys})
    r2.objects[f"{ab.KEY_PREFIX}README.txt"] = b"not a backup"
    assert ab._prune(r2, "bucket", keep=14) == 6
    assert set(r2.deleted) == set(keys[:6])             # the six OLDEST, all legacy
    assert f"{ab.KEY_PREFIX}README.txt" in r2.objects   # a foreign object is never pruned


def test_authdb_prune_drops_an_old_enc_before_a_newer_legacy():
    from api.services import authdb_backup as ab
    old_enc = f"{ab.KEY_PREFIX}20261001T000000Z.db.gz.enc"
    new_legacy = f"{ab.KEY_PREFIX}20261002T000000Z.db.gz"
    r2 = FakeR2({old_enc: b"x", new_legacy: b"x"})
    assert ab._prune(r2, "bucket", keep=1) == 1
    assert r2.deleted == [old_enc]


# ═══ store backups ═════════════════════════════════════════════════════════
NOW = dt.datetime(2026, 10, 22, 7, 5, tzinfo=dt.timezone.utc)


def _store_src(tmp_path: Path) -> Path:
    p = tmp_path / "community.db"
    c = sqlite3.connect(str(p))
    c.execute("CREATE TABLE posts_zq81 (id INTEGER PRIMARY KEY, body TEXT)")
    c.executemany("INSERT INTO posts_zq81 (body) VALUES (?)", [(MARKER,) for _ in range(20)])
    c.commit()
    c.close()
    return p


@pytest.fixture()
def store_wired(tmp_path, monkeypatch):
    from api.services import store_backup as sb
    src = _store_src(tmp_path)
    monkeypatch.setenv(sb.ENABLED_ENV, "1")
    monkeypatch.setattr(sb, "resolve_path", lambda name: str(src))
    return sb, FakeR2()


def test_store_uploads_only_encrypted_db_and_manifest(store_wired, monkeypatch, tmp_path):
    sb, r2 = store_wired
    K.arm(monkeypatch)
    out = sb.run_backup(now=NOW, client=r2, bucket="bucket", stores=["community"])
    assert out["community"]["status"] == "ok", out
    key = "store_backups/community/20261022T070500Z.db.gz.enc"
    assert out["community"]["key"] == key
    assert sorted(r2.uploads) == sorted([key, "store_backups/community/20261022T070500Z.manifest.json.enc"])
    assert all(k.endswith(".enc") for k in r2.uploads)
    assert MARKER_B in gzip.decompress(_assert_sealed(r2.objects[key], tmp_path))
    man = r2.objects[sb.manifest_key(key)]
    assert man.startswith(bc.MAGIC) and b"posts_zq81" not in man   # table names are member-derived
    assert b"posts_zq81" in _decrypt_bytes(man, tmp_path)


@pytest.mark.parametrize("how", ["unset", "invalid"])
def test_store_fails_closed_without_the_public_key(store_wired, monkeypatch, caplog, how):
    sb, r2 = store_wired
    _fail_closed_env(monkeypatch, how)
    with caplog.at_level(logging.ERROR):
        assert sb.run_backup(now=NOW, client=r2, bucket="bucket", stores=["community"]) is None
    assert r2.uploads == []
    _one_error_naming_the_variable(caplog)


def test_store_backup_store_called_directly_also_fails_closed(monkeypatch, tmp_path):
    from api.services import store_backup as sb
    monkeypatch.delenv(bc.PUBLIC_KEY_ENV, raising=False)
    r2 = FakeR2()
    res = sb.backup_store("community", str(_store_src(tmp_path)), r2, "bucket", now=NOW)
    assert res["status"] == "error" and bc.PUBLIC_KEY_ENV in res["error"]
    assert r2.uploads == []


def test_store_keys_parse_both_forms_and_pair_each_with_its_own_manifest():
    from api.services import store_backup as sb
    legacy = "store_backups/community/20261020T070500Z.db.gz"
    enc = "store_backups/community/20261021T070500Z.db.gz.enc"
    assert sb.parse_key(legacy)[0] == "community" and sb.parse_key(enc)[0] == "community"
    assert sb.manifest_key(legacy) == "store_backups/community/20261020T070500Z.manifest.json"
    assert sb.manifest_key(enc) == "store_backups/community/20261021T070500Z.manifest.json.enc"
    assert sb.parse_key("store_backups/community/20261021T070500Z.manifest.json.enc") is None


def test_store_prune_and_staleness_over_mixed_keys():
    from api.services import store_backup as sb
    objs = {}
    for d, suffix in ((18, ""), (19, ""), (20, ".enc"), (21, ".enc")):
        k = f"store_backups/community/202610{d}T070500Z.db.gz{suffix}"
        objs[k] = b"x"
        objs[sb.manifest_key(k)] = b"m"
    r2 = FakeR2(objs)
    found = sb.backups_by_store(r2, "bucket")["community"]
    assert [k for _t, k in found][0].endswith("20261021T070500Z.db.gz.enc")     # newest first
    assert sb.stale_stores(r2, "bucket", now=NOW, stores=["community"]) == []
    deleted = sb.prune(r2, "bucket", "community", keep=3)
    assert sorted(deleted) == ["store_backups/community/20261018T070500Z.db.gz",
                               "store_backups/community/20261018T070500Z.manifest.json"]


# ═══ J2 attachments ════════════════════════════════════════════════════════
@pytest.fixture()
def j2_wired(tmp_path, monkeypatch):
    from api import j2_attachments_backup as jb
    root = tmp_path / "attachments"
    (root / "user1" / "2026-10-21").mkdir(parents=True)
    (root / "user1" / "2026-10-21" / "shot.png").write_bytes(b"\x89PNG" + MARKER_B * 50)
    monkeypatch.setenv("J2_ATTACHMENT_BACKUP_ENABLED", "1")
    monkeypatch.setenv("J2_ATTACHMENT_ROOT", str(root))
    r2 = FakeR2()
    monkeypatch.setattr(jb, "_r2_client", lambda: r2)
    monkeypatch.setattr(jb, "_bucket", lambda: "bucket")
    return jb, r2


def test_j2_uploads_only_an_encrypted_tarball(j2_wired, monkeypatch, tmp_path):
    jb, r2 = j2_wired
    K.arm(monkeypatch)
    res = jb.backup_j2_attachments_to_r2()
    assert res["status"] == "ok", res
    assert r2.uploads == [res["key"]] and res["key"].endswith(".tar.gz.enc")
    assert r2.extra[res["key"]]["ContentType"] == bc.ENC_CONTENT_TYPE
    plain = _assert_sealed(r2.objects[res["key"]], tmp_path)
    with tarfile.open(fileobj=io.BytesIO(plain), mode="r:gz") as tar:
        blob = tar.extractfile("user1/2026-10-21/shot.png").read()
    assert MARKER_B in blob


@pytest.mark.parametrize("how", ["unset", "invalid"])
def test_j2_fails_closed_without_the_public_key(j2_wired, monkeypatch, caplog, how):
    jb, r2 = j2_wired
    _fail_closed_env(monkeypatch, how)
    with caplog.at_level(logging.ERROR):
        res = jb.backup_j2_attachments_to_r2()
    assert res["status"] == "error" and bc.PUBLIC_KEY_ENV in res["error"]
    assert r2.uploads == []
    assert jb._read_marker() is None or jb._read_marker().get("status") != "ok"
    _one_error_naming_the_variable(caplog)


def test_j2_date_and_prune_over_mixed_keys():
    from api import j2_attachments_backup as jb
    p = jb._PREFIX + "j2-attachments-"
    assert jb._date_from_key(p + "2026-10-20.tar.gz") == date(2026, 10, 20)
    assert jb._date_from_key(p + "2026-10-21.tar.gz.enc") == date(2026, 10, 21)
    today = date(2026, 10, 22)
    keys = {p + (today - timedelta(days=n)).isoformat() + (".tar.gz.enc" if n < 3 else ".tar.gz"): b"x"
            for n in range(0, 30, 5)}           # 0,5 (enc? only n<3 -> 0) ... 25 days old
    r2 = FakeR2(keys)
    res = jb._prune_old_backups(r2, "bucket", retain_days=14, keep_min=3, now_date=today)
    gone = sorted(res["deleted"])
    assert gone == sorted(p + (today - timedelta(days=n)).isoformat() + ".tar.gz" for n in (15, 20, 25))


# ═══ flow.db ═══════════════════════════════════════════════════════════════
@pytest.fixture()
def flow_wired(tmp_path, monkeypatch):
    from api import flow_backup as fb
    db = tmp_path / "flow.db"
    _seed_sqlite(db)
    r2 = FakeR2()
    monkeypatch.setattr(fb, "DB_PATH", str(db))
    monkeypatch.setattr(fb, "ENABLED", True)
    monkeypatch.setattr(fb, "_r2_client", lambda: r2)
    monkeypatch.setattr(fb, "_bucket", lambda: "bucket")
    return fb, r2


def test_flow_uploads_only_an_encrypted_object(flow_wired, monkeypatch, tmp_path):
    fb, r2 = flow_wired
    K.arm(monkeypatch)
    res = fb.backup_flow_db_to_r2()
    assert res["status"] == "ok", res
    assert r2.uploads == [res["key"]] and res["key"].endswith(".db.gz.enc")
    assert MARKER_B in gzip.decompress(_assert_sealed(r2.objects[res["key"]], tmp_path))


@pytest.mark.parametrize("how", ["unset", "invalid"])
def test_flow_fails_closed_without_the_public_key(flow_wired, monkeypatch, caplog, how):
    fb, r2 = flow_wired
    _fail_closed_env(monkeypatch, how)
    with caplog.at_level(logging.ERROR):
        res = fb.backup_flow_db_to_r2()
    assert res["status"] == "error" and bc.PUBLIC_KEY_ENV in res["error"]
    assert r2.uploads == []
    _one_error_naming_the_variable(caplog)


def test_flow_date_and_prune_over_mixed_keys():
    from api import flow_backup as fb
    assert fb._date_from_key("flow_backups/flow-2026-10-20.db.gz") == date(2026, 10, 20)
    assert fb._date_from_key("flow_backups/flow-2026-10-21.db.gz.enc") == date(2026, 10, 21)
    today = date(2026, 10, 22)
    keys = {f"flow_backups/flow-{(today - timedelta(days=n)).isoformat()}.db.gz" + (".enc" if n < 2 else ""): b"x"
            for n in (0, 1, 2, 3, 20, 40)}
    r2 = FakeR2(keys)
    res = fb._prune_old_backups(r2, "bucket", retain_days=14, keep_min=3, now_date=today)
    assert sorted(res["deleted"]) == sorted(f"flow_backups/flow-{(today - timedelta(days=n)).isoformat()}.db.gz"
                                            for n in (20, 40))
