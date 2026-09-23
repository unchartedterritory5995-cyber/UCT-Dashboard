"""Rails for tools/package_extension.py — the Chrome Web Store upload."""
from __future__ import annotations

import hashlib
import json
import shutil
import zipfile
from pathlib import Path

import pytest

from tools import package_extension as pe


def test_the_zip_holds_exactly_the_tracked_extension_files(tmp_path):
    files = pe.tracked_files()
    # Non-vacuity: an empty git answer would make every comparison below pass.
    assert "manifest.json" in files and "popup.js" in files
    path = pe.build(tmp_path)
    with zipfile.ZipFile(path) as zf:
        assert sorted(zf.namelist()) == files
        assert json.loads(zf.read("manifest.json"))["manifest_version"] == 3


def test_two_builds_of_one_tree_are_byte_identical(tmp_path):
    a = pe.build(tmp_path / "a")
    b = pe.build(tmp_path / "b")
    assert hashlib.sha256(a.read_bytes()).digest() == hashlib.sha256(b.read_bytes()).digest()


def _copy_ext(tmp_path: Path) -> tuple[Path, list[str]]:
    root = tmp_path / "extension"
    shutil.copytree(pe.REPO / pe.EXT_DIR, root)
    return root, pe.tracked_files()


def test_the_real_tree_passes_the_checks(tmp_path):
    root, files = _copy_ext(tmp_path)
    assert pe.check(root, files)["name"] == "UCT Browser Capture"


def test_refuses_a_host_permission_beyond_production(tmp_path):
    root, files = _copy_ext(tmp_path)
    m = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    m["host_permissions"].append("<all_urls>")
    (root / "manifest.json").write_text(json.dumps(m), encoding="utf-8")
    with pytest.raises(pe.PackageRefused, match="host_permissions"):
        pe.check(root, files)


def test_refuses_a_build_pointed_away_from_production(tmp_path):
    root, files = _copy_ext(tmp_path)
    cfg = root / "lib" / "config.js"
    cfg.write_text(cfg.read_text(encoding="utf-8").replace(
        "export const API_BASE = 'https://uctintelligence.com'",
        "export const API_BASE = 'http://localhost:8093'"), encoding="utf-8")
    with pytest.raises(pe.PackageRefused, match="API_BASE"):
        pe.check(root, files)


def test_refuses_when_the_manifest_names_an_untracked_file(tmp_path):
    root, files = _copy_ext(tmp_path)
    with pytest.raises(pe.PackageRefused, match="not tracked"):
        pe.check(root, [f for f in files if f != "icons/icon128.png"])


def test_refuses_a_manifest_v2(tmp_path):
    root, files = _copy_ext(tmp_path)
    m = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    m["manifest_version"] = 2
    (root / "manifest.json").write_text(json.dumps(m), encoding="utf-8")
    with pytest.raises(pe.PackageRefused, match="manifest_version"):
        pe.check(root, files)
