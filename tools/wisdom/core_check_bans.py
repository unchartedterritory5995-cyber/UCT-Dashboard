"""Pre-merge gate: the four Wisdom ban rails (W1 §0.4, Part 10; CONTRACTS §6.2, §8).

    python tools/wisdom/core_check_bans.py            # every rail, real floors
    python tools/wisdom/core_check_bans.py --rail journal --rail private_store
    python tools/wisdom/core_check_bans.py --branch wisdom/w1-b-rails

Exit 0 = every rail that applies measured and passed. Exit 1 = a violation, named by
rail, path and line. Exit 2 = nothing failed but a rail could not measure (a scan below
its floor, git unavailable, no merge base): that is never reported as a pass.

Standard library only; core/bans.py is loaded by path, so nothing from api.* is imported.
"""
from __future__ import annotations

import argparse
import importlib.util
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
BANS_PATH = REPO / "api" / "services" / "wisdom" / "core" / "bans.py"


def load_bans():
    spec = importlib.util.spec_from_file_location("wisdom_core_bans_cli", BANS_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main(argv=None) -> int:
    reconfigure = getattr(sys.stdout, "reconfigure", None)
    if reconfigure is not None:  # a violation detail can hold characters cp1252 cannot print
        reconfigure(encoding="utf-8", errors="replace")
    bans = load_bans()
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--root", default=str(REPO), help="repository root to scan (default: this repo)")
    parser.add_argument("--rail", action="append", choices=bans.RAILS,
                        help="run only this rail (repeatable); default: all four")
    parser.add_argument("--branch", default=None,
                        help="branch identity for the off-limits rail (default: CI variables, then git)")
    parser.add_argument("--no-floor", action="store_true",
                        help="do not enforce the files-scanned floors (fixture trees only)")
    args = parser.parse_args(argv)
    root = pathlib.Path(args.root).resolve()
    rails = args.rail or list(bans.RAILS)
    results = []
    for rail in rails:
        if rail == "offlimits":
            results.append(bans.run_offlimits_rail(root, branch=args.branch))
        else:
            results.append(bans.run_source_rail(rail, root, enforce_floor=not args.no_floor))
    text, code = bans.format_report(results)
    verdict = {0: "PASS", 1: "FAIL", 2: "INCONCLUSIVE"}[code]
    print(f"wisdom ban rails @ {root}")
    print(text)
    print(f"verdict: {verdict} (exit {code})")
    return code


if __name__ == "__main__":
    sys.exit(main())
