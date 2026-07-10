"""Tests for api/j2_attachments_backup.py — nightly R2 backup of the Journal 2.0
image-attachments tree. Mirrors the shape of the proven api/flow_backup.py rail.

Strategy: a tmp J2_ATTACHMENT_ROOT + a stubbed R2 client (recorder). No network,
no boto3. Asserts: disabled-gate no-op, missing/empty root no-op, the tarball
carries the seeded files under relative arcnames, the marker is written, and the
retain/prune keep-newest-3 logic.
"""
import json
import tarfile
from datetime import date
from pathlib import Path


def _seed(root: Path) -> None:
    """Two users, two days, two image files — the real on-disk layout is
    <root>/<user_id>/<YYYY-MM-DD>/<filename>."""
    (root / "user1" / "2026-07-09").mkdir(parents=True, exist_ok=True)
    (root / "user1" / "2026-07-09" / "shot.png").write_bytes(b"\x89PNG\r\n\x1a\nfake")
    (root / "user2" / "2026-07-08").mkdir(parents=True, exist_ok=True)
    (root / "user2" / "2026-07-08" / "chart.webp").write_bytes(b"RIFFfakewebp")


class _RecorderClient:
    """Stand-in for the boto3 S3 client. Captures uploads (reading the tar's
    members while the temp file still exists — the real fn rmtrees it after)."""

    def __init__(self):
        self.uploads = []
        self.deleted = []

    def upload_file(self, filename, bucket, key, ExtraArgs=None):
        with tarfile.open(filename, "r:gz") as tar:
            members = sorted(
                m.name.replace("\\", "/") for m in tar.getmembers() if m.isfile()
            )
        self.uploads.append(
            {"filename": filename, "bucket": bucket, "key": key,
             "extra": ExtraArgs, "members": members}
        )

    def list_objects_v2(self, Bucket=None, Prefix=None):
        return {"Contents": []}

    def delete_object(self, Bucket=None, Key=None):
        self.deleted.append(Key)


def test_backup_disabled_by_default(monkeypatch):
    monkeypatch.delenv("J2_ATTACHMENT_BACKUP_ENABLED", raising=False)
    from api import j2_attachments_backup as mod
    assert mod.backup_j2_attachments_to_r2() == {"skipped": "disabled"}


def test_missing_root_skips_without_upload(monkeypatch, tmp_path):
    monkeypatch.setenv("J2_ATTACHMENT_BACKUP_ENABLED", "1")
    root = tmp_path / "attachments"  # never created
    monkeypatch.setenv("J2_ATTACHMENT_ROOT", str(root))
    from api import j2_attachments_backup as mod
    rec = _RecorderClient()
    monkeypatch.setattr(mod, "_r2_client", lambda: rec)
    monkeypatch.setattr(mod, "_bucket", lambda: "test-bucket")
    assert mod.backup_j2_attachments_to_r2() == {"skipped": "no attachments"}
    assert rec.uploads == []


def test_empty_root_skips_without_upload(monkeypatch, tmp_path):
    monkeypatch.setenv("J2_ATTACHMENT_BACKUP_ENABLED", "1")
    root = tmp_path / "attachments"
    root.mkdir()  # exists but no files
    monkeypatch.setenv("J2_ATTACHMENT_ROOT", str(root))
    from api import j2_attachments_backup as mod
    rec = _RecorderClient()
    monkeypatch.setattr(mod, "_r2_client", lambda: rec)
    monkeypatch.setattr(mod, "_bucket", lambda: "test-bucket")
    assert mod.backup_j2_attachments_to_r2() == {"skipped": "no attachments"}
    assert rec.uploads == []


def test_tarball_roundtrip(monkeypatch, tmp_path):
    monkeypatch.setenv("J2_ATTACHMENT_BACKUP_ENABLED", "1")
    root = tmp_path / "attachments"
    root.mkdir()
    _seed(root)
    monkeypatch.setenv("J2_ATTACHMENT_ROOT", str(root))
    from api import j2_attachments_backup as mod
    rec = _RecorderClient()
    monkeypatch.setattr(mod, "_r2_client", lambda: rec)
    monkeypatch.setattr(mod, "_bucket", lambda: "test-bucket")

    result = mod.backup_j2_attachments_to_r2()
    assert result["status"] == "ok"
    assert result["files"] == 2
    assert result["bytes"] > 0

    # exactly one put, to the right bucket + key shape
    assert len(rec.uploads) == 1
    up = rec.uploads[0]
    assert up["bucket"] == "test-bucket"
    assert up["key"].startswith("j2_attachment_backups/j2-attachments-")
    assert up["key"].endswith(".tar.gz")
    assert (up["extra"] or {}).get("ContentType") == "application/gzip"

    # the tarball actually carries the seeded files under relative arcnames
    assert "user1/2026-07-09/shot.png" in up["members"]
    assert "user2/2026-07-08/chart.webp" in up["members"]
    assert len(up["members"]) == 2

    # marker persisted outside the tree, with the run record
    marker = Path(mod._marker_path())
    assert marker.exists()
    saved = json.loads(marker.read_text())
    assert saved["status"] == "ok"
    assert saved["files"] == 2
    assert saved["key"] == up["key"]


def test_marker_lives_outside_the_backed_up_tree(monkeypatch, tmp_path):
    """The marker must NOT sit inside _ATTACHMENT_ROOT, or the next run's
    tarball would sweep it in (rglob('*') matches dotfiles)."""
    monkeypatch.setenv("J2_ATTACHMENT_ROOT", str(tmp_path / "attachments"))
    from api import j2_attachments_backup as mod
    marker = Path(mod._marker_path())
    root = (tmp_path / "attachments").resolve()
    assert root not in marker.resolve().parents
    assert marker.parent.resolve() != root


def test_r2_not_configured_returns_error(monkeypatch, tmp_path):
    monkeypatch.setenv("J2_ATTACHMENT_BACKUP_ENABLED", "1")
    root = tmp_path / "attachments"
    root.mkdir()
    _seed(root)
    monkeypatch.setenv("J2_ATTACHMENT_ROOT", str(root))
    from api import j2_attachments_backup as mod
    monkeypatch.setattr(mod, "_r2_client", lambda: None)
    monkeypatch.setattr(mod, "_bucket", lambda: None)
    out = mod.backup_j2_attachments_to_r2()
    assert out["status"] == "error"
    assert "R2 not configured" in out["error"]


def test_prune_keeps_newest_three_and_deletes_old(monkeypatch):
    from api import j2_attachments_backup as mod

    class _PruneClient:
        def __init__(self, keys):
            self._keys = keys
            self.deleted = []

        def list_objects_v2(self, Bucket=None, Prefix=None):
            return {"Contents": [{"Key": k} for k in self._keys]}

        def delete_object(self, Bucket=None, Key=None):
            self.deleted.append(Key)

    keys = [
        f"j2_attachment_backups/j2-attachments-2026-06-{d:02d}.tar.gz"
        for d in (1, 2, 3, 4, 5, 6)
    ]
    client = _PruneClient(keys)
    out = mod._prune_old_backups(
        client, "b", retain_days=14, now_date=date(2026, 7, 9)
    )
    # newest 3 (06-06/05/04) kept; the rest are >14d past → deleted
    assert len(out["kept"]) == 3
    assert set(out["deleted"]) == {
        "j2_attachment_backups/j2-attachments-2026-06-01.tar.gz",
        "j2_attachment_backups/j2-attachments-2026-06-02.tar.gz",
        "j2_attachment_backups/j2-attachments-2026-06-03.tar.gz",
    }
    assert set(client.deleted) == set(out["deleted"])


def test_prune_recent_backups_all_kept(monkeypatch):
    from api import j2_attachments_backup as mod

    class _PruneClient:
        def __init__(self, keys):
            self._keys = keys
            self.deleted = []

        def list_objects_v2(self, Bucket=None, Prefix=None):
            return {"Contents": [{"Key": k} for k in self._keys]}

        def delete_object(self, Bucket=None, Key=None):
            self.deleted.append(Key)

    # all within the 14-day window → nothing pruned
    keys = [
        f"j2_attachment_backups/j2-attachments-2026-07-{d:02d}.tar.gz"
        for d in (2, 3, 4, 5, 6, 7, 8)
    ]
    client = _PruneClient(keys)
    out = mod._prune_old_backups(
        client, "b", retain_days=14, now_date=date(2026, 7, 9)
    )
    assert out["deleted"] == []
    assert len(out["kept"]) == 7
    assert client.deleted == []
