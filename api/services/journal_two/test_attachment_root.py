"""Rails for the attachment root (attachment_root.py).

⛔ THE BUG THIS EXISTS FOR: the root defaulted to `<repo>/data/j2_attachments`,
which on Railway is `/app/data/...` — CONTAINER storage. Every redeploy deleted
every note image, including the widget-embed archive PNGs that are the Journal
Widgets feature's #1 durability promise. Found on prod by fetching a shared
note's archived chart and getting 404 through the OWNER route.

The load-bearing assertion is that the default lands under DATA_DIR (the
mounted volume), never under the repo — plus that reads still find legacy
files, and that every writer/backup agrees on one root.
"""

from __future__ import annotations

import importlib
from pathlib import Path

import pytest


def _fresh(monkeypatch, **env):
    """Re-import the module with a specific environment (root is env-derived)."""
    for k in ("J2_ATTACHMENT_ROOT", "DATA_DIR"):
        monkeypatch.delenv(k, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    import api.services.journal_two.attachment_root as mod
    return importlib.reload(mod)


def test_default_is_the_volume_never_the_repo(monkeypatch, tmp_path):
    """With DATA_DIR set (Railway sets the volume; the sandbox sets a temp
    dir), the root lives under it — and NEVER inside the checkout, whose
    contents a redeploy replaces."""
    mod = _fresh(monkeypatch, DATA_DIR=str(tmp_path))
    root = mod.attachment_root()
    assert root == tmp_path / "j2_attachments"
    repo = Path(__file__).resolve().parents[3]
    assert repo not in root.parents, (
        "attachment root is inside the repo checkout — on Railway that is "
        "ephemeral container storage and every redeploy wipes every note image"
    )


def test_bare_default_is_the_data_volume(monkeypatch):
    """No DATA_DIR at all: the house convention's `/data` mount, matching
    bars_sqlite/auth_db — still never the repo."""
    mod = _fresh(monkeypatch)
    root = mod.attachment_root()
    assert root.as_posix().startswith("/data") or root.drive  # posix mount, or a drive-rooted equivalent on Windows
    repo = Path(__file__).resolve().parents[3]
    assert repo not in root.parents


def test_explicit_override_still_wins(monkeypatch, tmp_path):
    mod = _fresh(monkeypatch, J2_ATTACHMENT_ROOT=str(tmp_path / "custom"), DATA_DIR=str(tmp_path / "vol"))
    assert mod.attachment_root() == tmp_path / "custom"


def test_reads_fall_back_to_the_legacy_tree(monkeypatch, tmp_path):
    """Files written before the move must keep serving."""
    mod = _fresh(monkeypatch, DATA_DIR=str(tmp_path))
    cands = mod.read_candidates(Path("u1") / "notes" / "n1" / "inline")
    assert cands[0] == tmp_path / "j2_attachments" / "u1" / "notes" / "n1" / "inline"
    assert cands[-1] == mod.LEGACY_ATTACHMENT_ROOT / "u1" / "notes" / "n1" / "inline"


def test_every_writer_and_the_backup_share_one_root(monkeypatch, tmp_path):
    """notes.py, calendar.py and the nightly R2 backup must agree — a backup
    that tars a different directory than the writers use is worse than none."""
    monkeypatch.setenv("J2_ATTACHMENT_ROOT", str(tmp_path / "shared"))
    import api.services.journal_two.attachment_root as ar
    importlib.reload(ar)
    import api.j2_attachments_backup as backup
    importlib.reload(backup)
    assert backup._attachment_root() == ar.attachment_root()


def test_serve_finds_a_legacy_file_after_the_root_moved(monkeypatch, tmp_path):
    """End-to-end on the real serve function: a file sitting ONLY in the
    legacy tree still resolves once the primary root has moved away."""
    import api.services.journal_two.attachment_root as ar
    monkeypatch.delenv("J2_ATTACHMENT_ROOT", raising=False)
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "vol"))
    importlib.reload(ar)
    legacy = tmp_path / "legacy"
    monkeypatch.setattr(ar, "LEGACY_ATTACHMENT_ROOT", legacy)

    import api.services.journal_two.notes as notes
    monkeypatch.setattr(notes, "_ATTACHMENT_ROOT", ar.attachment_root())
    monkeypatch.setattr(notes, "_read_candidates", ar.read_candidates)

    d = legacy / "u1" / "notes" / "n1" / "inline"
    d.mkdir(parents=True)
    (d / "old.png").write_bytes(b"png")
    assert notes.serve_note_image_path("u1", "n1", "inline", "old.png") is not None
    # …and traversal is still refused on every candidate.
    assert notes.serve_note_image_path("u1", "n1", "inline", "../../x") is None


@pytest.fixture(autouse=True)
def _restore():
    """Leave the modules as the rest of the suite expects them."""
    yield
    import api.services.journal_two.attachment_root as ar
    importlib.reload(ar)
    import api.j2_attachments_backup as backup
    importlib.reload(backup)
