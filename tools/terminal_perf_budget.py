"""UCT Terminal first-open bytes: an ADVISORY report in the style of the Notebook byte budget.

Lane w9-10 (terminal load performance), 2026-10-09. It prints what a browser fetches before the
terminal route can render -- the app entry plus the STATIC import closure of the terminal shell
chunk -- and flags two shapes that would make that number jump. Every chunk is DERIVED from
Vite's build manifest (`app/dist/.vite/manifest.json`) on every run, through the same graph walk
`tools/notebook_perf_budgets.py` uses; nothing is typed here, not even the shell's file name.

The shell root is found from the graph: the chunk `index.html` dynamically imports whose Vite
`name` is `TerminalShell` (App.jsx's `lazyPage('/terminal', ...)`). If no such chunk exists the
report is UNEVALUABLE (exit 3), never a pass.

Advisory flags (printed, exit 0 -- this is a report, not a gate):
  * LAZY DEFEATED: a chunk the shell imports DYNAMICALLY (a panel) is also in the shell's
    STATIC closure, so it loads on first open after all.
  * HEAVY VENDOR: a `vendor-charts` chunk (lightweight-charts) is in the closure.

There is no byte ceiling. A ceiling would be a hand-typed number; the Notebook keeps its own in a
hand-edited budget file for a reason recorded there. If the terminal ever wants one, it belongs in
a budget file of its own, edited by hand, with this report as the reading.

Usage:
    python tools/terminal_perf_budget.py --dist app/dist [--json out.json]

Exit codes: 0 = report printed (flags or not); 3 = the manifest could not answer.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    from tools.notebook_perf_budgets import ENTRY, Unevaluable, closure_bytes, load_manifest, static_closure
except ImportError:  # run as a script: tools/ is on sys.path, the package is not
    from notebook_perf_budgets import ENTRY, Unevaluable, closure_bytes, load_manifest, static_closure

SHELL_NAME = "TerminalShell"
HEAVY_VENDOR_PREFIXES = ("assets/vendor-charts",)


def shell_root(manifest: dict) -> str:
    """The manifest key of the terminal shell chunk, found through the entry's dynamic imports."""
    entry = manifest.get(ENTRY) or {}
    hits = [k for k in entry.get("dynamicImports", [])
            if manifest.get(k, {}).get("name") == SHELL_NAME and str(manifest[k].get("file", "")).endswith(".js")]
    if len(hits) != 1:
        raise Unevaluable(f"expected exactly one {SHELL_NAME} chunk among {ENTRY}'s dynamic imports, "
                          f"found {hits} -- renamed or no longer lazy?")
    return hits[0]


def report(dist: Path) -> dict:
    manifest = load_manifest(dist)
    root = shell_root(manifest)
    entry_keys = static_closure(manifest, [ENTRY])
    keys = static_closure(manifest, [ENTRY, root])
    entry_total, _ = closure_bytes(manifest, dist, entry_keys)
    total, rows = closure_bytes(manifest, dist, keys)
    beyond = [k for k in keys if k not in set(entry_keys)]
    beyond_total, beyond_rows = closure_bytes(manifest, dist, beyond)
    lazy = set(manifest[root].get("dynamicImports", []))
    defeated = sorted(lazy & set(keys))
    heavy = sorted(f for f, _ in rows if f.startswith(HEAVY_VENDOR_PREFIXES))
    return {
        "shell": root, "first_open_bytes": total, "chunks": len(rows),
        "entry_bytes": entry_total, "beyond_entry_bytes": beyond_total,
        "beyond_entry": beyond_rows, "lazy_panels": len(lazy),
        "flags": {"lazy_defeated": defeated, "heavy_vendor": heavy},
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dist", required=True, help="a built app/dist (with .vite/manifest.json)")
    ap.add_argument("--json", dest="json_path", default=None)
    args = ap.parse_args(argv)
    try:
        r = report(Path(args.dist))
    except (Unevaluable, OSError, ValueError, KeyError) as e:
        print(f"VERDICT: UNEVALUABLE -- {e}")
        return 3
    print(f"terminal_first_open: {r['first_open_bytes']:,} B across {r['chunks']} JS chunks "
          f"(entry {r['entry_bytes']:,} B + terminal {r['beyond_entry_bytes']:,} B); "
          f"{r['lazy_panels']} lazy imports off the shell")
    for f, b in r["beyond_entry"][:8]:
        print(f"  {b:>9,}  {f}")
    flags = r["flags"]
    for k in flags["lazy_defeated"]:
        print(f"  ADVISORY lazy defeated: {k} is a dynamic import of the shell AND in its static closure")
    for f in flags["heavy_vendor"]:
        print(f"  ADVISORY heavy vendor on first open: {f}")
    if args.json_path:
        Path(args.json_path).write_text(json.dumps(r, indent=2), encoding="utf-8")
    print("VERDICT: ADVISORY -- " + ("flags above" if any(flags.values()) else "no flags"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
