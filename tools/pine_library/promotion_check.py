"""promotion_check.py - hold a library store to the promotion allowlist, and install from it.

    python tools/pine_library/promotion_check.py paths
    python tools/pine_library/promotion_check.py check   [--store <dir>] [--exact]
    python tools/pine_library/promotion_check.py install --from <staging dir> [--into <store dir>] [--apply]

`--store` / `--into` default to the store this server serves (`pine_library_store.store_root()`:
`$PINE_LIBRARY_DIR`, else `$DATA_DIR/pine_libraries`), so on the web pod the bare command reads
the production store.

The promotion allowlist (`tools/pine_library/promotion_allowlist.json`) names the ONLY library
versions that may be copied into the production store, each pinned by the sha256 of the source
that was graded. This tool is the owner's check that a store holds exactly that code:

  paths     the `promote` paths on one line (the arguments `fetch_library.py` takes)
  check     every `promote` row is in the store, valid by the store's own rule
            (`pine_library_store.stored_status`: sha, licence, deny list) and under the allowlist's
            sha256; every library a promoted library imports is promoted too. Every other entry
            the store holds is listed by name and by the status THIS SERVER serves it with
            (`entry_status`, which reads the committed allowlist: since 2026-11-17 a version that
            is not promoted is `held` or `unpromoted`, refused by name, never `ok`). `--exact`: a
            valid entry that is not promoted is a failure (use it on a staging folder).
  install   copy the `promote` rows from a staging store into a store, through the store's own
            `write_entry` (validated, atomic). Without `--apply` it prints the plan and writes
            nothing. It refuses, writing nothing, when the staging store fails `check --exact`,
            or when the target already holds a promoted version under ANOTHER sha256.

It prints library paths, sha256s and statuses only. It never fetches (that is
`fetch_library.py`) and never deletes anything. Exit 0 = PASS, 1 = FAIL, 2 = usage.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, REPO)

from api.services import pine_library_store as store  # noqa: E402

ALLOWLIST = os.path.join(HERE, "promotion_allowlist.json")
#: a top-level `import Author/Library/Version` line (the rule `fetch_library.imports_in` reads)
_IMPORT = re.compile(r"^import[ \t]+([A-Za-z0-9_]+)[ \t]*/[ \t]*([A-Za-z0-9_]+)[ \t]*/[ \t]*([0-9]+)", re.M)


def load_allowlist(path: str = ALLOWLIST) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def imports_of(source: str) -> list[str]:
    return sorted({"%s/%s/%s" % m.groups() for m in _IMPORT.finditer(source or "")})


def stored_paths(root: str) -> list[str]:
    """Every `<Author>/<Library>/<N>.json` file under `root`, as an import path (servable or not)."""
    out = []
    if not os.path.isdir(root):
        return out
    for author in sorted(os.listdir(root)):
        adir = os.path.join(root, author)
        if not os.path.isdir(adir):
            continue
        for name in sorted(os.listdir(adir)):
            ndir = os.path.join(adir, name)
            if not os.path.isdir(ndir):
                continue
            for fn in sorted(os.listdir(ndir)):
                m = re.match(r"^([1-9][0-9]{0,5})\.json$", fn)
                if m:
                    out.append("%s/%s/%s" % (author, name, m.group(1)))
    return out


def check(root: str, doc: dict, exact: bool = False) -> tuple[list[str], list[str]]:
    """``(problems, lines)``: why `root` does not hold the promoted versions ([] = it does), and
    one line per entry for the operator to read."""
    problems, lines = [], []
    promote = {r["path"]: r for r in doc.get("promote") or []}
    held = {r["path"]: r for r in doc.get("heldOut") or []}
    never = set((doc.get("neverPromoted") or {}).get("paths") or [])
    if not promote:
        problems.append("the allowlist promotes nothing: there is nothing to check")
    for path, row in sorted(promote.items()):
        status, got = store.stored_status(path, root=root)
        if status != "ok":
            problems.append("%s: %s%s" % (path, status, (" (%s)" % "; ".join(got)) if got else ""))
            lines.append("MISSING   %s  %s" % (path, status))
            continue
        if got["sha256"] != row["sha256"]:
            problems.append("%s: the store holds sha256 %s, the allowlist pins %s" % (path, got["sha256"], row["sha256"]))
            lines.append("WRONG-SHA %s  %s" % (path, got["sha256"]))
            continue
        for dep in imports_of(got["source"]):
            if dep not in promote:
                problems.append("%s imports %s, which is not promoted (the import line would be refused)" % (path, dep))
        lines.append("PROMOTED  %s  %s" % (path, got["sha256"]))
    for path in stored_paths(root):
        if path in promote:
            continue
        served, _got = store.entry_status(path, root=root)
        label = ("held out" if path in held else "never promoted" if path in never else "not on the allowlist")
        lines.append("OTHER     %s  %s, store status %s" % (path, label, served))
        if exact and store.stored_status(path, root=root)[0] == "ok":
            problems.append("%s is a valid entry in this store and is not promoted (%s)" % (path, label))
    return problems, lines


def install(staging: str, target: str, doc: dict, apply: bool) -> tuple[list[str], list[str]]:
    """``(problems, plan)``. Writes only when `apply` and there is no problem."""
    problems, _lines = check(staging, doc, exact=True)
    if problems:
        return ["the staging store fails `check --exact`: " + p for p in problems], []
    plan, copy = [], []
    for row in sorted(doc["promote"], key=lambda r: r["path"]):
        path = row["path"]
        status, got = store.stored_status(path, root=target)
        if status == "ok" and got["sha256"] == row["sha256"]:
            plan.append("KEEP      %s  already held under the pinned sha256" % path)
        elif status == "missing":
            plan.append("COPY      %s  %s" % (path, row["sha256"]))
            copy.append(path)
        else:
            problems.append("%s: the target holds it as %s%s; refusing to overwrite it" % (
                path, status, (" under sha256 %s" % got["sha256"]) if status == "ok" else ""))
    if problems or not apply:
        return problems, plan
    for path in copy:
        entry = store.stored_entry(path, root=staging)
        fp = store.write_entry(entry, root=target)
        plan.append("WROTE     %s  -> %s" % (path, fp))
    after, _ = check(target, doc)
    return ["after the install: " + p for p in after], plan


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("action", choices=("paths", "check", "install"))
    ap.add_argument("--store", help="check: the store directory (default: this server's store)")
    ap.add_argument("--exact", action="store_true", help="check: a served entry that is not promoted fails")
    ap.add_argument("--from", dest="staging", help="install: the staging store fetched from TradingView")
    ap.add_argument("--into", help="install: the store to copy into (default: this server's store)")
    ap.add_argument("--apply", action="store_true", help="install: write (without it, print the plan only)")
    ap.add_argument("--allowlist", default=ALLOWLIST)
    a = ap.parse_args(argv)
    doc = load_allowlist(a.allowlist)
    if a.action == "paths":
        print(" ".join(sorted(r["path"] for r in doc.get("promote") or [])))
        return 0
    if a.action == "check":
        root = a.store or store.store_root()
        problems, lines = check(root, doc, exact=a.exact)
        print("store: %s%s" % (root, "" if os.path.isdir(root) else " (does not exist)"))
        print("\n".join(lines))
    else:
        if not a.staging:
            ap.error("install needs --from")
        into = a.into or store.store_root()
        if os.path.abspath(into) == os.path.abspath(a.staging):
            ap.error("--from and --into are the same directory")
        problems, lines = install(a.staging, into, doc, a.apply)
        print("install %s -> %s (%s)" % (a.staging, into, "APPLY" if a.apply else "plan only, nothing written"))
        print("\n".join(lines))
    for p in problems:
        print("PROBLEM   " + p)
    print("PROMOTION %s: %s" % (a.action.upper(), "FAIL" if problems else "PASS"))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
