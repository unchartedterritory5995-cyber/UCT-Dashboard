"""Content-hash snapshot of the shared data root, and the compare that gates a run.

⛔ "REPORTS CLEAN" IS NEVER EVIDENCE OF "WROTE NOWHERE."

The first joystick-hub sandbox boot printed a clean startup, served a healthy
`/api/health`, and had just written to the live `C:\\data\\auth.db`. Every
signal an operator would normally trust was green. The only thing that could
have caught it was looking at the files themselves — so that look is now
mechanical, and it runs before the health check, not after.

WHY SHA256 OF THE MAIN `.db` FILE ONLY
--------------------------------------
Mtime is the wrong instrument here, in both directions:

  * FALSE POSITIVE — opening a WAL database **read-only still rewrites its
    `-shm` index**, so a mode=ro probe changes `-shm`/`-wal` mtimes without
    touching a byte of data. An mtime-based check cries wolf on its own
    diagnostics, and a rail that cries wolf gets deleted.
  * FALSE NEGATIVE — a write that lands and is checkpointed back to the same
    size leaves a plausible-looking file. Only content settles it.

So: main `.db` files, hashed. `-wal` / `-shm` are deliberately EXCLUDED from
the comparison; they are transport, not truth.

USAGE
-----
    python scripts/data_root_snapshot.py --snapshot before.json
    python scripts/data_root_snapshot.py --compare before.json \\
        --label "post-suite" --log docs/plans/joystick/sandbox-runs/<ts>.md
"""

import argparse
import datetime
import glob
import hashlib
import io
import json
import os
import sys

DEFAULT_ROOT = r"C:\data"
#: Transport, not truth. See the module docstring.
EXCLUDED_SUFFIXES = ("-wal", "-shm", "-journal")


def _hash_file(path, chunk=8 * 1024 * 1024):
    h = hashlib.sha256()
    with io.open(path, "rb") as fh:
        while True:
            block = fh.read(chunk)
            if not block:
                break
            h.update(block)
    return h.hexdigest()


def snapshot(root=DEFAULT_ROOT):
    """`{relative name: {size, sha256}}` for every main `.db` under `root`."""
    out = {}
    for path in sorted(glob.glob(os.path.join(root, "**", "*.db"), recursive=True)):
        if not os.path.isfile(path):
            continue
        if any(path.endswith(suffix) for suffix in EXCLUDED_SUFFIXES):
            continue
        rel = os.path.relpath(path, root)
        out[rel] = {"size": os.path.getsize(path), "sha256": _hash_file(path)}
    return out


def compare(before, after):
    """`[(kind, name, detail), …]`. Empty means the root is byte-identical."""
    diffs = []
    for name in sorted(set(before) | set(after)):
        b, a = before.get(name), after.get(name)
        if b is None:
            diffs.append(("ADDED", name, f"{a['size']} bytes"))
        elif a is None:
            diffs.append(("REMOVED", name, f"was {b['size']} bytes"))
        elif b["sha256"] != a["sha256"]:
            diffs.append((
                "CHANGED", name,
                f"{b['size']} -> {a['size']} bytes; "
                f"sha256 {b['sha256'][:12]} -> {a['sha256'][:12]}",
            ))
    return diffs


def log_path_for(repo_root, stamp=None):
    stamp = stamp or datetime.datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
    d = os.path.join(repo_root, "docs", "plans", "joystick", "sandbox-runs")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, f"{stamp}.md")


def append_log(log_file, label, root, count, diffs, extra=None):
    """One line per checkpoint, plus a diff table only when something moved."""
    fresh = not os.path.exists(log_file)
    with io.open(log_file, "a", encoding="utf-8", newline="\n") as fh:
        if fresh:
            fh.write("# Sandbox run — shared-data-root integrity log\n\n")
            fh.write(
                "Every checkpoint below hashes the main `.db` files under the "
                "shared root.\n`-wal` / `-shm` are excluded: opening a WAL "
                "database read-only rewrites its\n`-shm` index, so mtime there "
                "is noise. See `scripts/data_root_snapshot.py`.\n\n"
            )
        now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        verdict = "CLEAN" if not diffs else f"**{len(diffs)} FILE(S) CHANGED**"
        fh.write(f"- `{now}`  **{label}** — {root}, {count} db files — {verdict}\n")
        if extra:
            fh.write(f"    - {extra}\n")
        if diffs:
            fh.write("\n| | file | detail |\n|---|---|---|\n")
            for kind, name, detail in diffs:
                fh.write(f"| {kind} | `{name}` | {detail} |\n")
            fh.write("\n")
    return log_file


def _print_diffs(label, diffs):
    print("")
    print("  " + "!" * 68)
    print(f"  SHARED DATA ROOT CHANGED at checkpoint: {label}")
    print("  " + "!" * 68)
    for kind, name, detail in diffs:
        print(f"    {kind:8s} {name}  ({detail})")
    print("")
    print("  This run touched live data. Do not trust any result from it.")
    print("")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", default=DEFAULT_ROOT)
    ap.add_argument("--snapshot", metavar="OUT.json",
                    help="write a snapshot and exit 0")
    ap.add_argument("--compare", metavar="BEFORE.json",
                    help="compare the root against a snapshot; exit 2 on any diff")
    ap.add_argument("--label", default="checkpoint")
    ap.add_argument("--log", help="append the result to this markdown file")
    args = ap.parse_args()

    if not os.path.isdir(args.root):
        print(f"  data root {args.root} does not exist — nothing to snapshot.")
        return 0

    if args.snapshot:
        snap = snapshot(args.root)
        with io.open(args.snapshot, "w", encoding="utf-8") as fh:
            json.dump(snap, fh, indent=1, sort_keys=True)
        print(f"  snapshot: {len(snap)} db files under {args.root} -> {args.snapshot}")
        if args.log:
            append_log(args.log, f"{args.label} (baseline)", args.root,
                       len(snap), [])
        return 0

    if args.compare:
        with io.open(args.compare, encoding="utf-8") as fh:
            before = json.load(fh)
        after = snapshot(args.root)
        diffs = compare(before, after)
        if args.log:
            append_log(args.log, args.label, args.root, len(after), diffs)
        if diffs:
            _print_diffs(args.label, diffs)
            return 2
        print(f"  [{args.label}] shared data root CLEAN "
              f"({len(after)} db files byte-identical).")
        return 0

    ap.error("pass --snapshot or --compare")


if __name__ == "__main__":
    sys.exit(main())
