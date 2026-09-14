"""Bootstrap for tools/wisdom/sources_*.py scripts that import api.*.

⛔ C:\\data IS REAL ON THIS BOX (CLAUDE.md). Importing the repo-root conftest
BEFORE any api.* import applies the AST-derived census pins (every /data path env
var is pointed at a per-run sandbox) and arms the tripwire that refuses a write
into the shared data root. Setting DATA_DIR alone is not a remedy — 72 path vars
resolve independently of it.
"""
from __future__ import annotations

import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 wisdom-sources-tool"


def bootstrap() -> str:
    if REPO not in sys.path:
        sys.path.insert(0, REPO)
    import conftest  # noqa: F401  (census pins + tripwire, at import)

    return REPO


def refuse_shared_root(path: str) -> str:
    """Scripts take explicit output paths and never write under /data or C:\\data."""
    norm = os.path.abspath(path).replace("\\", "/").lower()
    if norm == "c:/data" or norm.startswith("c:/data/") or norm == "/data" or norm.startswith("/data/"):
        raise SystemExit(f"refusing to write under the shared data root: {path}")
    return path
