"""The ONE reader of which `VITE_*` build-time flags the frontend actually reads.

⚰️ WHY THIS EXISTS. `docs/feature_flags.json` is held to a gate list DERIVED BY AST
from `api/**` (`api/services/feature_flag_index.py`). Build-time frontend flags are
read in `app/src/**` as `import.meta.env.VITE_*`, in JavaScript — so the ledger had a
STRUCTURAL blind spot for them, and on 2026-09-12 that blind spot was measured: nine
`VITE_*` were set on the web service, eight to the literal `1`, and all nine had been
undefined in the shipped bundle for four days. Nothing in the repo could see it,
because nothing in the repo was looking at that half of the app.

This module is the counterpart index for that half. `tests/test_vite_flag_ledger.py`
holds the ledger's `build_flags` section to it, and
`tests/test_dockerfile_vite_build_args.py` holds `Dockerfile.web`'s ARG list to it —
two rails, ONE source of names, so they cannot disagree about what exists.

⛔ IT LIVES IN `tools/`, NOT `api/`, ON PURPOSE. `worker` AND `bars-api` both watch
`api/**`, so a module added there restarts two services that have no interest in
frontend flags. Nothing watches `tools/`.

⚠️ Comments are NOT stripped. A `VITE_*` named only in a comment over-declares a flag,
and an extra ledger row or an extra ARG is inert — that is the safe direction. The
direction that costs members, a real read that nothing declares, cannot be
manufactured by prose. (Contrast the repo's "CODE, NEVER PROSE" rule, which governs
checks whose FAILURE direction is the harmful one.)
"""
from __future__ import annotations

import os
import re

# `import.meta.env.VITE_ANYTHING`, the only way a Vite build-time flag is read.
_READ_RE = re.compile(r"import\.meta\.env\.(VITE_[A-Z0-9_]+)")

_SOURCE_EXT = (".js", ".jsx", ".ts", ".tsx")


def repo_root(start: str | None = None) -> str:
    here = start or os.path.dirname(os.path.abspath(__file__))
    return os.path.dirname(here)


def frontend_root(root: str | None = None) -> str:
    return os.path.join(root or repo_root(), "app", "src")


def source_files(root: str | None = None):
    """Every SHIPPED frontend source file.

    Tests are excluded: a flag exercised only by a test needs no build arg and no
    ledger row, and including them would make the declared set depend on test
    scaffolding rather than on what members run.
    """
    base = frontend_root(root)
    for dirpath, _dirs, files in os.walk(base):
        for f in files:
            if not f.endswith(_SOURCE_EXT):
                continue
            if ".test." in f or f.endswith(".d.ts"):
                continue
            yield os.path.join(dirpath, f)


def names_read(root: str | None = None) -> set[str]:
    """The set of VITE_* names the shipped frontend reads."""
    out: set[str] = set()
    for path in source_files(root):
        with open(path, encoding="utf-8", errors="replace") as fh:
            out |= set(_READ_RE.findall(fh.read()))
    return out


def read_sites(root: str | None = None) -> dict[str, list[str]]:
    """name -> the repo-relative files that read it. For a human, and for an error
    message that can name where to look rather than only what is missing."""
    base = repo_root(root)
    out: dict[str, list[str]] = {}
    for path in source_files(root):
        with open(path, encoding="utf-8", errors="replace") as fh:
            for n in set(_READ_RE.findall(fh.read())):
                rel = os.path.relpath(path, base).replace(os.sep, "/")
                out.setdefault(n, []).append(rel)
    return {k: sorted(v) for k, v in out.items()}


if __name__ == "__main__":
    sites = read_sites()
    for n in sorted(sites):
        print("%-30s %s" % (n, ", ".join(sites[n][:3])))
    print("--- %d VITE_* names read by app/src (non-test)" % len(sites))
