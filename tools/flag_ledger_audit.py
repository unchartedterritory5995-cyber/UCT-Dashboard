"""Does docs/feature_flags.json still describe what Railway actually has set?

The ledger records INTENT and the test suite enforces that every off-by-default
gate carries one. Neither can see Railway, so the two can drift: an entry that
says `armed` while the variable was removed, or one still marked `pending` after
somebody quietly turned the feature on. Both are the ledger becoming fiction,
which is worse than no ledger — it reads as coverage.

This is the half that looks. It shells out to the Railway CLI rather than
importing anything, runs read-only (`railway variables --kv` does NOT redeploy;
`--set` does), and prints names, never counts.

⛔⛔ **WHAT `0 / 0 / 0 / 0` ACTUALLY COVERS — READ THIS BEFORE QUOTING IT.**
Recorded 2026-09-13 as **F-FLAG-1**, from an in-pod measurement; the behaviour
below is DELIBERATELY unchanged.

All four questions this tool asks are about **PRESENCE**, never about VALUE:

    is it ARMED here but set by NO service?          -> fiction
    is it OFF here but SET on some service?          -> undocumented decision
    is it off-by-default and UNDECLARED?             -> the suite should be red
    is it still awaiting a decision?                 -> pending

⛔ **NONE of them is "is it ON where the ledger says it is?"** For a flag whose
`where` lists two services, *"some service sets it"* is satisfied by the service
where it is ON, and the service where it is OFF is never examined.

⚰️ **MEASURED CONSEQUENCE:** this tool reports a clean **0/0/0/0** while FIVE
flags declared `armed` with `web` in `where` read `'0'` in the live web process —
`MASSIVE_WS_ENABLED`, `FLOW_BACKUP_ENABLED`, `FLOW_GAP_AUTOFILL_ENABLED` (all
three deliberately `0` on web under the P5 flow-worker cutover),
`DESK_SESSION_DISCORD_RECAP_ENABLED` and `J2_SHARE_LINKS_ENABLED` (unexplained).

⭐ **The point is not the three that are fine — it is that this tool cannot tell
them apart from the two that may not be.** A clean run here means *"the ledger
and Railway agree about which flags EXIST"*, and nothing at all about whether a
feature is on where a reader would believe it is.

⚠️ Widening it to per-service VALUES needs a ruling on what `where` means —
*"the variable exists here"* or *"the feature is ON here"*. Today it is read as
the second and implemented as the first. **That question belongs to the flow
workstream**, which owns the three cutover flags; it is not changed here.

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

#: ⚰️ THIS WAS A HARDCODED THREE — ("web", "worker", "flow-worker") — while the
#: project had FIVE services. `BARS_API_ENABLED=1` was live on `bars-api` the whole
#: time and this tool listed it under "still awaiting a decision": the exact fiction
#: the ledger exists to prevent, manufactured BY the thing that checks for it. The
#: other direction is worse — a flag armed only on an unlisted service reads as
#: `claims_armed_but_unset` ("the entry is fiction") about an entry that is true, so
#: acting on this tool could have UNSET a live gate.
#:
#: ⛔ SO THE ROSTER IS DERIVED, AND A FAILURE TO DERIVE IT REFUSES rather than
#: falling back to a shorter list. A partial roster is not a smaller audit; it is a
#: confidently wrong one, which is the same rule `_vars_for` already follows for an
#: empty read.
def _services() -> tuple[str, ...]:
    exe = shutil.which("railway")
    if not exe:
        raise RailwayUnavailable(
            "the `railway` CLI is not on PATH — cannot enumerate services")
    try:
        r = subprocess.run([exe, "status", "--json"],
                           capture_output=True, text=True, timeout=90, check=False,
                           # The Railway CLI emits UTF-8 (box-drawing, arrows).
                           # Python on Windows decodes a pipe as cp1252 by
                           # default and dies on the first such byte -- which
                           # made this auditor unusable on the only machine
                           # that runs it, and the failure surfaced as "could
                           # not enumerate the services", not as an encoding bug.
                           encoding="utf-8", errors="replace")
        edges = json.loads(r.stdout)["services"]["edges"]
        names = tuple(sorted(e["node"]["name"] for e in edges))
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError) as e:
        raise RailwayUnavailable(
            f"could not enumerate the project's services ({e}) — refusing to audit "
            f"against a partial roster, which is what made bars-api invisible") from e
    if not names:
        raise RailwayUnavailable("the project reported no services")
    return names


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
                           # The Railway CLI emits UTF-8 (box-drawing, arrows).
                           # Python on Windows decodes a pipe as cp1252 by
                           # default and dies on the first such byte -- which
                           # made this auditor unusable on the only machine
                           # that runs it, and the failure surfaced as "could
                           # not enumerate the services", not as an encoding bug.
                           encoding="utf-8", errors="replace",
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
    live: dict[str, set[str]] = {s: _vars_for(s) for s in _services()}
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


WILDCARDS = {"*", "all", "any", "everything"}


def _values_for(service: str, wanted: set[str]) -> dict[str, str]:
    """The live VALUES of the named flags only.

    ⛔ SCOPED ON PURPOSE. The rest of this tool reads names only, because values are
    secrets. The flags passed here are the ones the ledger declares
    `exposure: public` — show-name selectors like "sunday scans" — never a token, a
    webhook URL or a key. Nothing outside `wanted` is read, kept or printed, and the
    caller derives `wanted` from the ledger rather than from the live environment, so
    a new secret on Railway can never widen what this reads.
    """
    exe = shutil.which("railway")
    if not exe:
        raise RailwayUnavailable("the `railway` CLI is not on PATH")
    try:
        r = subprocess.run([exe, "variables", "--service", service, "--kv"],
                           capture_output=True, text=True, timeout=90, check=False,
                           encoding="utf-8", errors="replace")
    except (OSError, subprocess.SubprocessError) as e:
        raise RailwayUnavailable(f"reading {service}: {e}") from e
    out: dict[str, str] = {}
    seen = 0
    for line in r.stdout.splitlines():
        if "=" not in line:
            continue
        seen += 1
        k, v = line.split("=", 1)
        k = k.strip()
        if k in wanted:
            out[k] = v.strip()
    if not seen:
        raise RailwayUnavailable(
            f"{service} returned no variables — refusing to call a visibility flag clean "
            f"on an empty read. {r.stderr.strip()[:200]}")
    return out


def visibility_audit() -> dict:
    """Does any LIVE service set a public-exposure flag to a wildcard, or to a value the
    ledger does not allow?

    ⚰️ 2026-08-19 → 2026-09-13: `DESK_PUBLIC_SHOWS=*` on `web` turned every auto-recorded
    Zoom session — paid Live Trading Sessions and a paid workshop among them — into a
    public, searchable YouTube video. It ran 25 days. The offline rail cannot catch this
    because the wildcard was never in the repo; only the live service had it. This is the
    half that looks.
    """
    ledger = json.loads((REPO / "docs" / "feature_flags.json").read_text(encoding="utf-8"))["flags"]
    public = {k: v for k, v in ledger.items() if v.get("exposure") == "public"}
    if not public:
        raise RailwayUnavailable(
            "the ledger declares no exposure:public flags — refusing to report a clean "
            "visibility audit over an empty set (an empty result is a failed invocation)")
    findings: list[dict] = []
    checked: dict[str, dict[str, str]] = {}
    for service in _services():
        live = _values_for(service, set(public))
        checked[service] = live
        for name, value in live.items():
            allowed = [str(a).strip().lower() for a in public[name].get("values", [])]
            parts = [p.strip().lower() for p in value.split(",") if p.strip()]
            if any(p in WILDCARDS for p in parts):
                findings.append({"service": service, "flag": name, "value": value,
                                 "why": "WILDCARD on a public-exposure flag"})
            elif parts and allowed and not set(parts) <= set(allowed):
                findings.append({"service": service, "flag": name, "value": value,
                                 "why": f"value outside the declared values {allowed}"})
    return {"declared_public": sorted(public), "checked": checked, "findings": findings}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--visibility", action="store_true",
                    help="check LIVE values of exposure:public flags for wildcards")
    args = ap.parse_args()

    if args.visibility:
        try:
            v = visibility_audit()
        except RailwayUnavailable as e:
            print(f"CANNOT AUDIT: {e}", file=sys.stderr)
            return 2
        if args.json:
            print(json.dumps(v, indent=2))
        else:
            print("public-exposure flags declared:", ", ".join(v["declared_public"]))
            for svc, live in v["checked"].items():
                print(f"  {svc}: " + (", ".join(f"{k}={val!r}" for k, val in live.items()) or "(none set)"))
            print(f"\nFINDINGS: {len(v['findings'])}")
            for f in v["findings"]:
                print(f"  ⛔ {f['service']} {f['flag']}={f['value']!r} — {f['why']}")
        return 1 if v["findings"] else 0

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
