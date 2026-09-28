"""TERM-026 (FB-S9-01) -- the auth-surface census, as a command that can GATE.

    python tools/auth_surface_audit.py            # denominator + findings, exit code
    python tools/auth_surface_audit.py --json     # the full result as JSON
    python tools/auth_surface_audit.py --candidates
                                                  # baseline stubs for NEW findings

WHAT IT DOES
------------
Imports `api.main:app` -- the app the product serves -- walks `app.routes`, and
runs `api.auth_surface_check.audit_surface` over it. Nothing is typed: the
population, the per-method counts and the buckets are all read off the route
table. It sends no request and runs no handler.

It prints ONE denominator line first, because a count without its population
cannot tell "nothing wrong" from "nothing examined", then every finding BY NAME.

EXIT CODES
----------
  0  examined > 0 and no finding
  1  a finding: an unauthenticated read that is not in the baseline, an
     ungated mutating route under the audited prefixes, a STALE baseline entry
     (now gated, gone, or outside the aperture -- the last is how a blinded
     auditor shows up; otherwise remove it, the ratchet only moves down), or an
     `inline` entry whose gate no longer appears in its handler's code
  2  the run cannot be trusted: nothing was examined, or importing the app
     reached the shared data root

⛔ SANDBOXED BEFORE THE IMPORT. `/data` is real on the dev box (`C:\\data`), and
paths inside it are captured at MODULE IMPORT. So the repo-root `conftest.py` is
imported FIRST: its census pins every derived env var to a throwaway sandbox and
arms the shared-root tripwire, exactly as it does for the test suite. A write
that still reaches the shared root makes this exit 2, never a verdict.

⚠️ The route table is THIS PROCESS's. Production differs where routers mount
behind flags, and web serves the flow family through `flow_proxy`'s forwarder
(reported `delegated`). The boot log line `[startup] auth-surface-reads:` is the
same census taken on the pod itself.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_real_app():
    """Sandbox the shared data root, THEN import the served app."""
    if REPO not in sys.path:
        sys.path.insert(0, REPO)
    import conftest  # noqa: F401  -- pins + tripwire, at import, before api.*
    from api.main import app
    violations = list(getattr(conftest, "SHARED_ROOT_VIOLATIONS", []) or [])
    return app, violations


def _names(rows) -> list[str]:
    return [f"{m} {p}" for m, p in rows]


def main(argv=None, app=None, baseline=None) -> int:
    """`app`/`baseline` are late-bound seams for tests; None means the real
    served app and the committed baseline file."""
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--json", action="store_true", help="print the full result as JSON")
    ap.add_argument("--candidates", action="store_true",
                    help="print baseline stubs for unrecorded reads")
    args = ap.parse_args(argv)

    if REPO not in sys.path:
        sys.path.insert(0, REPO)
    from api import auth_surface_check as asc

    violations: list = []
    if app is None:
        app, violations = _load_real_app()

    res = asc.audit_surface(app, baseline=baseline)

    if args.json:
        print(json.dumps(res, indent=1, default=list))
    else:
        print("auth-surface: " + asc.format_denominator(res))

    if violations:
        print(f"INVALID: importing the app reached the shared data root "
              f"{len(violations)} time(s); this run is not a measurement.")
        return 2
    if res["reads"]["examined"] == 0 or res["routes_total"] == 0:
        print("INVALID: examined nothing -- a census over an empty route table "
              "is not a pass.")
        return 2

    findings = [
        ("UNRECORDED unauthenticated read (no gate, no baseline entry)",
         res["reads"]["ungated"]),
        ("UNGATED mutating route under an audited prefix",
         res["mutating"]["ungated"]),
        ("STALE baseline entry (now gated, gone, or no longer examined)",
         res["stale_baseline"]),
        ("INLINE baseline entry whose gate is no longer in the handler's code",
         res["inline_marker_missing"]),
    ]
    total = 0
    for label, rows in findings:
        if not rows:
            continue
        total += len(rows)
        print(f"\n{label}: {len(rows)}")
        for name in _names(rows):
            print(f"  {name}")

    if args.candidates and res["reads"]["ungated"]:
        stubs = [{"method": m, "path": p, "kind": "open",
                  "reason": "TODO: why is this read anonymous?"}
                 for m, p in res["reads"]["ungated"]]
        print("\n# baseline stubs (edit the reason before committing):")
        print(json.dumps(stubs, indent=1))

    if total:
        print(f"\nFAIL: {total} finding(s).")
        return 1
    print("\nOK: no finding.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
