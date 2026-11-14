"""The one reader of the frontend build manifest (`<dist>/.vite/manifest.json`).

Two answers come out of that file and both are sent to browsers:

* the build's identity: the entry chunk's path, `assets/index-<hash>.js`, which the
  page compares with its own entry `<script>` to notice a newer frontend;
* the `Link` preload header for the app shell (Cloudflare turns it into Early Hints).

They live here, away from `api/main.py`, so that a process which serves the built
frontend without running the API can send exactly the same answers. Keep this module
free of every import except `json` and `os`: importing the API costs seconds and starts
schedulers. `tests/test_build_manifest.py` pins that.

Nothing here raises. A missing, unreadable or malformed manifest is an empty answer,
because both callers sit on paths that must not fail (a health check, a page load).
"""
from __future__ import annotations

import json
import os


def _manifest(dist: str):
    """The parsed manifest, or None when it cannot be read."""
    try:
        with open(os.path.join(dist, ".vite", "manifest.json"), encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _entry_row(manifest):
    """The `index.html` row when it is the build's entry with a usable file, else None."""
    if not isinstance(manifest, dict):
        return None
    row = manifest.get("index.html")
    if isinstance(row, dict) and row.get("isEntry") and isinstance(row.get("file"), str):
        return row
    return None


def entry_build_id(dist: str) -> str:
    """The entry chunk's path with no leading slash (`assets/index-abc123.js`), or ""."""
    try:
        row = _entry_row(_manifest(dist))
        return row["file"].lstrip("/") if row else ""
    except Exception:
        return ""


def early_hint_link(dist: str) -> str:
    """The `Link` header for the app shell: entry script, its static imports, then its CSS.

    Every hint carries `crossorigin` because index.html loads each of these files with
    `crossorigin`; a hint whose mode differs is fetched twice. Returns "" on any failure.
    """
    try:
        manifest = _manifest(dist)
        entry = _entry_row(manifest)
        if not entry:
            return ""
        scripts = [entry["file"]] + [
            manifest[k]["file"] for k in entry.get("imports", [])
            if isinstance(manifest.get(k), dict) and isinstance(manifest[k].get("file"), str)
        ]
        styles = [c for c in entry.get("css", []) if isinstance(c, str)]
        parts = [f"</{f.lstrip('/')}>; rel=preload; as=script; crossorigin" for f in scripts]
        parts += [f"</{c.lstrip('/')}>; rel=preload; as=style; crossorigin" for c in styles]
        return ", ".join(parts)
    except Exception:
        return ""


def build_info(dist: str, commit: str | None) -> dict:
    """The body of `/build.json`: `{"build_id": ..., "commit": ...}`, both always strings."""
    return {
        "build_id": entry_build_id(dist),
        "commit": commit if isinstance(commit, str) else "",
    }
