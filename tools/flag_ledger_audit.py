"""Does docs/feature_flags.json still describe what Railway actually has set?

The ledger records INTENT and the test suite enforces that every off-by-default
gate carries one. Neither can see Railway, so the two can drift: an entry that
says `armed` while the variable was removed, or one still marked `pending` after
somebody quietly turned the feature on. Both are the ledger becoming fiction,
which is worse than no ledger — it reads as coverage.

This is the half that looks. It shells out to the Railway CLI rather than
importing anything, runs read-only (`railway variables --kv` does NOT redeploy;
`--set` does), and prints names, never counts.

    py tools/flag_ledger_audit.py                 # all three services
    py tools/flag_ledger_audit.py --json          # machine-readable

Exit code is 1 when the ledger and reality disagree, so this can gate a release
check later if that is ever wanted. It is NOT in the test suite on purpose:
tests must stay offline and deterministic.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from api.services import feature_flag_index as ffi  # noqa: E402

SERVICES = ("web", "worker", "flow-worker")


class RailwayUnavailable(RuntimeError):
    """The CLI could not be reached — say so, never infer from an empty read."""


def _vars_for(service: str) -> set[str]:
    """Names only — values are secrets and this never needs them.

    ⛔ Raises rather than returning an empty set. An unreachable CLI read as
    "nothing is set" made an early run report all 86 armed entries as fiction:
    a wrong answer delivered with total confidence. Same rule the broker sync
    learned the hard way — a failed fetch is None, never an empty list.
    """
    exe = shutil.which("railway")   # a .cmd shim on Windows; bare name will not resolve
    if not exe:
        raise RailwayUnavailable(
            "the `railway` CLI is not on PATH — cannot compare the ledger to reality")
    try:
        r = subprocess.run(
            [exe, "variables", "--service", service, "--kv"],
            capture_output=True, text=True, timeout=90, check=False,
        )
    except (OSError, subprocess.SubprocessError) as e:
        raise RailwayUnavailable(f"reading {service}: {e}") from e
    names = {ln.split("=", 1)[0].strip() for ln in r.stdout.splitlines() if "=" in ln}
    if not names:
        raise RailwayUnavailable(
            f"{service} returned no variables — refusing to call every armed flag "
            f"fiction on the strength of an empty read. "
            f"(is the project linked in this directory?) {r.stderr.strip()[:200]}")
    return names


def audit() -> dict:
    ledger = json.loads((REPO / "docs" / "feature_flags.json").read_text(encoding="utf-8"))["flags"]
    live: dict[str, set[str]] = {s: _vars_for(s) for s in SERVICES}
    anywhere = set().union(*live.values()) if live else set()

    claims_armed_but_unset = sorted(
        k for k, e in ledger.items() if e.get("status") == "armed" and k not in anywhere)
    claims_off_but_set = sorted(
        k for k, e in ledger.items()
        if e.get("status") in ("pending", "dark") and k in anywhere)

    # A gate the code reads, off by default, present in neither ledger nor env.
    gates = ffi.gates(ffi.repo_roots(REPO), REPO)
    needed = {k for k, v in gates.items() if ffi.needs_declaration(k, v["default"])}
    undeclared = sorted(needed - set(ledger))

    return {
        "services": {s: len(v) for s, v in live.items()},
        "claims_armed_but_unset": claims_armed_but_unset,
        "claims_off_but_set": claims_off_but_set,
        "undeclared": undeclared,
        "still_pending": sorted(
            k for k, e in ledger.items() if e.get("status") == "pending"),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    args = ap.parse_args()

    try:
        r = audit()
    except RailwayUnavailable as e:
        print(f"CANNOT AUDIT: {e}", file=sys.stderr)
        return 2   # distinct from 1 (drift found) — "did not look" is not "looks clean"
    if args.json:
        print(json.dumps(r, indent=2))
    else:
        print("Railway variable counts:", ", ".join(f"{s}={n}" for s, n in r["services"].items()))
        for key, headline in (
            ("claims_armed_but_unset",
             "LEDGER SAYS ARMED, NOTHING SETS IT — the entry is fiction"),
            ("claims_off_but_set",
             "LEDGER SAYS OFF, BUT IT IS SET — someone decided and did not write it down"),
            ("undeclared",
             "OFF BY DEFAULT AND UNDECLARED — the test suite should already be red"),
        ):
            names = r[key]
            print(f"\n{headline}: {len(names)}")
            for n in names:
                print(f"  {n}")
        print(f"\nStill awaiting a decision: {len(r['still_pending'])}")
        for n in r["still_pending"]:
            print(f"  {n}")

    drifted = r["claims_armed_but_unset"] or r["claims_off_but_set"] or r["undeclared"]
    return 1 if drifted else 0


if __name__ == "__main__":
    raise SystemExit(main())
