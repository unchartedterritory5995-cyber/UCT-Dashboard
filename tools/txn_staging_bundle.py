"""Assemble the exact upload for a Trade Exchange News STAGING deploy (Checkpoint D2).

    python tools/txn_staging_bundle.py receiver <out_dir>
    python tools/txn_staging_bundle.py web <out_dir>

``railway up <out_dir> --path-as-root`` then uploads only these files: no repo,
no secrets, no GitHub link (so a push to master can never redeploy staging).

* receiver -- the git-tracked files of services/trade_exchange_news_receiver.
* web      -- the REAL News router + services, the empty package inits, and
              staging_auth.py placed AS api/middleware/auth_middleware.py.

The out_dir must be empty or absent, and outside the repository.
"""
from __future__ import annotations

import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
RECEIVER = "services/trade_exchange_news_receiver"
STAGING = "services/trade_exchange_news_staging_web"
WEB_FILES = {
    "api/__init__.py": "api/__init__.py",
    "api/routers/__init__.py": "api/routers/__init__.py",
    "api/routers/trade_exchange_news.py": "api/routers/trade_exchange_news.py",
    "api/middleware/__init__.py": "api/middleware/__init__.py",
    "api/middleware/auth_middleware.py": f"{STAGING}/staging_auth.py",
    "api/services/__init__.py": "api/services/__init__.py",
    "staging_web.py": f"{STAGING}/staging_web.py",
    "Dockerfile": f"{STAGING}/Dockerfile",
    "requirements.txt": f"{STAGING}/requirements.txt",
    "railway.json": f"{STAGING}/railway.json",
}


def _tracked(prefix: str) -> list[str]:
    out = subprocess.run(["git", "ls-files", prefix], cwd=ROOT, check=True,
                         capture_output=True, text=True).stdout
    return [p for p in out.splitlines() if p]


def plan(kind: str) -> dict[str, str]:
    """published path -> repo path."""
    if kind == "receiver":
        return {p[len(RECEIVER) + 1:]: p for p in _tracked(RECEIVER)}
    if kind == "web":
        files = dict(WEB_FILES)
        for p in _tracked("api/services/trade_exchange_news"):
            if p.endswith(".py"):
                files[p] = p
        return files
    raise SystemExit("kind must be 'receiver' or 'web'")


def build(kind: str, out: pathlib.Path) -> list[str]:
    out = out.resolve()
    if out == ROOT or ROOT in out.parents:
        raise SystemExit("out_dir must be outside the repository")
    if out.exists() and any(out.iterdir()):
        raise SystemExit("out_dir must be empty")
    files = plan(kind)
    for dest, src in sorted(files.items()):
        target = out / dest
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / src, target)
    return sorted(files)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    for name in build(sys.argv[1], pathlib.Path(sys.argv[2])):
        print(name)
