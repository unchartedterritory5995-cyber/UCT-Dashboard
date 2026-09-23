"""Build the Chrome Web Store upload for UCT Browser Capture.

    python tools/package_extension.py            # -> .extension-build/uct-browser-capture-<version>.zip
    python tools/package_extension.py --out DIR

The zip holds exactly the TRACKED files under ``extension/`` (``git ls-files``),
so an untracked scratch file in that directory can never ride into a published
build. Entries are sorted and carry a fixed timestamp, so the same tree always
produces the same bytes and a reviewer can compare two builds by hash.

It refuses to build (exit 2, reason printed) when the package would not be the
one we mean to ship:
  * the manifest is not Manifest V3, or has no version;
  * ``host_permissions`` is anything but the production origin;
  * ``lib/config.js`` points ``API_BASE`` anywhere but production;
  * a file the manifest names (icons, popup, service worker) is not tracked.

What the extension may DO is railed separately, by AST, in
``app/src/pages/journal-2-0/lib/extensionBoundary.test.js``. This tool only
decides what goes into the upload.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
EXT_DIR = "extension"
PROD_ORIGIN = "https://uctintelligence.com"
FIXED_TIME = (2026, 1, 1, 0, 0, 0)
DEFAULT_OUT = REPO / ".extension-build"


class PackageRefused(Exception):
    """The tree is not the package we mean to ship."""


def tracked_files(repo: Path = REPO) -> list[str]:
    """Paths relative to extension/, from git. Raises if git returns nothing:
    an empty list would build an empty zip that looks like a successful run."""
    out = subprocess.run(
        ["git", "-C", str(repo), "ls-files", "-z", "--", EXT_DIR],
        capture_output=True, check=True,
    ).stdout.decode("utf-8")
    files = sorted(p[len(EXT_DIR) + 1:] for p in out.split("\0") if p)
    if not files:
        raise PackageRefused(f"git ls-files returned nothing under {EXT_DIR}/")
    return files


def _manifest_paths(manifest: dict) -> set[str]:
    named = set()
    for icons in (manifest.get("icons") or {}, (manifest.get("action") or {}).get("default_icon") or {}):
        named.update(icons.values())
    popup = (manifest.get("action") or {}).get("default_popup")
    if popup:
        named.add(popup)
    worker = (manifest.get("background") or {}).get("service_worker")
    if worker:
        named.add(worker)
    return named


def check(ext_root: Path, files: list[str]) -> dict:
    """Validate the tree; return the parsed manifest. Raises PackageRefused."""
    manifest = json.loads((ext_root / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("manifest_version") != 3:
        raise PackageRefused("manifest_version must be 3")
    if not re.fullmatch(r"\d+(\.\d+){0,3}", str(manifest.get("version", ""))):
        raise PackageRefused(f"manifest version is not a Chrome version string: {manifest.get('version')!r}")
    hosts = manifest.get("host_permissions") or []
    if hosts != [f"{PROD_ORIGIN}/*"]:
        raise PackageRefused(f"host_permissions must be exactly [{PROD_ORIGIN}/*], got {hosts}")
    config = (ext_root / "lib" / "config.js").read_text(encoding="utf-8")
    m = re.search(r"export const API_BASE = '([^']*)'", config)
    if not m or m.group(1) != PROD_ORIGIN:
        raise PackageRefused(f"lib/config.js API_BASE must be {PROD_ORIGIN}, got {m.group(1) if m else 'nothing'}")
    missing = sorted(_manifest_paths(manifest) - set(files))
    if missing:
        raise PackageRefused(f"manifest names files that are not tracked: {missing}")
    return manifest


def build(out_dir: Path = DEFAULT_OUT, repo: Path = REPO) -> Path:
    files = tracked_files(repo)
    ext_root = repo / EXT_DIR
    manifest = check(ext_root, files)
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"uct-browser-capture-{manifest['version']}.zip"
    tmp = target.with_suffix(".zip.tmp")
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for rel in files:
            info = zipfile.ZipInfo(rel, date_time=FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            zf.writestr(info, (ext_root / rel).read_bytes())
    tmp.replace(target)
    return target


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args(argv)
    try:
        path = build(args.out)
    except PackageRefused as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    with zipfile.ZipFile(path) as zf:
        count = len(zf.namelist())
    print(f"built {path} ({count} files, sha256 {digest[:16]})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
