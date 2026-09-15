"""Is the Wisdom programme actually dark? Measure it; never assume it.

Owner ruling R6 (2026-09-14): the "production is dark" claim becomes a committed instrument.

⚰️ **WHAT IT REPLACES.** `docs/wisdom/SESSION-STATE.md` records, from 2026-09-14 05:00 CT:
*"PRODUCTION IS DARK, MEASURED NOT ASSUMED: six services, 430 variables, zero `WISDOM_*` set
anywhere; `flag_ledger_audit` reports 0 in every category; 27 of 27 real Wisdom GET routes return
401 to an anonymous caller and none returns JSON."* That was a real measurement typed into a
document by hand. A number in a document cannot be re-run, and this repo has paid repeatedly for
exactly that — a flag ledger that described an unreleased surface while members were using it, a
`DESK_PUBLIC_SHOWS` wildcard that contradicted its own documentation for 25 days.

⛔⛔ **THE TWO HALVES ARE DERIVED, NEVER TYPED.** The `WISDOM_*` name set comes from an AST walk
over `api/services/wisdom/**`; the route list comes from `registry.routers()`, the same registry
the app mounts. A hand-typed list is the defect this file exists to prevent: it goes stale the
day someone adds a flag, and a stale list reports "all clear" about a surface it cannot see.

⛔ **THREE EXIT CODES, because "we could not measure it" and "it is lit" are different facts.**
  0  PASS          — measured, and dark.
  1  LIT           — measured, and something is not dark. This is the one that pages.
  2  INCONCLUSIVE  — the instrument could not measure. NEVER reported as a pass.
Collapsing 1 and 2 is how an unmeasured deploy starts reading as a clean one.

⛔ **An absence is only evidence if the instrument could have seen a presence.** If the route
walk yields zero routes, or the flag walk yields zero names, that is INCONCLUSIVE — a broken
import produces exactly the same silence as a clean system. `--self-check` proves the checks can
fail, on planted inputs, touching nothing real.

Usage:
    python scripts/wisdom_dark_check.py                      # dry run: prints what it WOULD check
    python scripts/wisdom_dark_check.py --local              # measure this machine's environment
    python scripts/wisdom_dark_check.py --host https://…     # probe a host, unauthenticated GETs
    python scripts/wisdom_dark_check.py --self-check         # prove the checks can fail
"""
from __future__ import annotations

import argparse
import ast
import json
import os
import pathlib
import re
import sys

#: ⚰️ Windows consoles default to cp1252, and the first ⛔ in a print killed this script with a
#: UnicodeEncodeError — which exited 1 (LIT) for what was an encoding bug, i.e. the instrument
#: reporting a measured failure it had never measured. That is the precise confusion the three
#: exit codes exist to prevent, so the fix belongs here rather than in the prose.
#: Same class as flag_ledger_audit's cp1252 pipe bug (fixed 2026-09-10 with errors="replace").
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

REPO = pathlib.Path(__file__).resolve().parents[1]
WISDOM_SRC = REPO / "api" / "services" / "wisdom"
FLAG_NAME = re.compile(r"^WISDOM_[A-Z0-9_]+$")

PASS, LIT, INCONCLUSIVE = 0, 1, 2

#: ⛔ A switch is read as ENABLED-shaped. Configuration (a DB path, a budget cap, a model name)
#: is not a switch and says nothing about darkness.
SWITCH_SHAPED = re.compile(r"_ENABLED$")

#: Calls whose first literal argument names an environment variable.
ENV_READERS = {("os", "environ", "get"), ("os", "getenv"), ("environ", "get")}


def _pin_data_root() -> None:
    """⛔⛔ Apply the conftest census BEFORE importing api.**, or this reads the owner's live files.

    `C:\\data` exists on this box, so every product path resolving to `/data/...` resolves to
    production data. Setting `DATA_DIR` is NOT the remedy — 72 env vars resolve independently of
    it (that is root cause 1 of the 2026-09-08 sandbox incident). The pins are AST-derived, and
    they must be applied before the first `api.` import because the paths are captured at module
    import time.
    """
    sys.path.insert(0, str(REPO))
    import conftest  # noqa: E402  (repo-root conftest, not tests/conftest)

    sandbox = REPO / "data" / "wisdom" / "scratch" / "dark-check-sandbox"
    sandbox.mkdir(parents=True, exist_ok=True)
    _, pins, _ = conftest.shared_data_root_census()
    for env, literal in pins.items():
        os.environ[env] = literal.replace("/data", str(sandbox))


# ── half 1: the flag names, derived by AST ───────────────────────────────────

def declared_gates() -> list:
    """The AUTHORITY: `flags.GATES` — (env name, reader, member_visible), which the admin status
    page and the ledger rail already read. One list, owned by the module that owns the flags.

    ⭐ It carries `member_visible`, which is the half §0.4c actually cares about: a lit
    owner-only gate and a lit member-facing one are not the same event.
    """
    from api.services.wisdom.core import flags

    return [(str(name), bool(member_visible)) for name, _reader, member_visible in flags.GATES]


def _dotted(node) -> tuple:
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
    return tuple(reversed(parts))


def env_names_read(root: pathlib.Path = WISDOM_SRC) -> set:
    """Every env var the Wisdom code actually READS, by AST over `os.environ.get` / `os.getenv`.

    ⛔⛔ **NOT a name-prefix scan, and that distinction is the whole point.** The first version of
    this matched `^WISDOM_[A-Z0-9_]+$` string literals — and therefore could not see
    **`ASKAI_WISDOM_RETRIEVAL_ENABLED`**, the Ask-AI kill switch, which is *member-facing* and
    does not start with `WISDOM_`. The instrument would have reported "0 switches set, dark"
    while a member-facing lane was lit. An absence is only evidence if the instrument could have
    seen a presence.

    ⛔ AST, never grep. A grep over the same tree also returned `WISDOM_CAP` (a Python constant
    `= 50`), `WISDOM_PKG_DIR` and `WISDOM_IMPORT_PREFIX` (module constants, not env vars at all)
    and `WISDOM_PRIVATE_KEYS_V1` (a name appearing only inside a docstring) — four switches that
    do not exist, from one regex over prose and identifiers.
    """
    names: set = set()
    for path in sorted(root.rglob("*.py")):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and _dotted(node.func) in ENV_READERS:
                if node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str):
                    names.add(node.args[0].value)
            elif (isinstance(node, ast.Subscript) and _dotted(node.value) in {("os", "environ"), ("environ",)}
                  and isinstance(node.slice, ast.Constant) and isinstance(node.slice.value, str)):
                names.add(node.slice.value)
    return names


def switches_read(root: pathlib.Path = WISDOM_SRC) -> set:
    return {n for n in env_names_read(root) if SWITCH_SHAPED.search(n)}


def off_registry_switches(root: pathlib.Path = WISDOM_SRC) -> set:
    """⛔ A switch read by Wisdom code but absent from `flags.GATES` is itself a finding.

    The registry is the authority for what SHOULD exist; this is the cross-check for what does.
    Without it, a gate added straight to `os.environ.get` would be invisible to the instrument
    and to the ledger rail at the same time — one omission, two blind systems.
    """
    return switches_read(root) - {name for name, _ in declared_gates()}


def flags_set_locally(names) -> dict:
    return {n: os.environ[n] for n in sorted(names) if os.environ.get(n) not in (None, "")}


# ── half 2: the routes, derived from the registry ────────────────────────────

def wisdom_get_routes() -> list:
    """Every GET path the Wisdom registry mounts, with the guards declared on it.

    ⛔ From `registry.routers()` — the same call `api/main.py` uses to mount them. Deriving the
    list any other way puts a second authority on "which routes exist", and session 3 already
    burned an hour on three invented paths that returned 200 from the SPA catch-all.
    """
    from api.services.wisdom import registry

    out = []
    for router in registry.routers():
        prefix = getattr(router, "prefix", "") or ""
        for route in getattr(router, "routes", []):
            methods = set(getattr(route, "methods", None) or ())
            if "GET" not in methods:
                continue
            path = prefix + getattr(route, "path", "")
            guards = sorted({
                getattr(d.call, "__name__", repr(d.call))
                for d in (getattr(route, "dependencies", None) or [])
                if getattr(d, "call", None) is not None
            })
            for dep in getattr(getattr(route, "dependant", None), "dependencies", None) or []:
                name = getattr(getattr(dep, "call", None), "__name__", None)
                if name:
                    guards.append(name)
            out.append({"path": path, "guards": sorted(set(guards))})
    return sorted(out, key=lambda r: r["path"])


def classify(route) -> str:
    g = set(route["guards"])
    if {"require_push_secret"} & g:
        return "internal"
    if {"require_owner"} & g:
        return "owner"
    if {"require_admin"} & g:
        return "admin"
    if any(x.startswith("require_") or x in {"get_current_user"} for x in g):
        return "authed"
    return "UNGUARDED"


# ── probing ──────────────────────────────────────────────────────────────────

def probe(host: str, routes: list, timeout: float = 10.0) -> dict:
    """Unauthenticated GETs only. ⛔ No credentials, ever — the point is what an anonymous caller sees."""
    import urllib.error
    import urllib.request

    findings, checked = [], 0
    for route in routes:
        if "{" in route["path"]:
            findings.append({"path": route["path"], "status": None, "verdict": "SKIPPED_TEMPLATE"})
            continue
        url = host.rstrip("/") + route["path"]
        req = urllib.request.Request(url, method="GET", headers={"User-Agent": "Mozilla/5.0 (wisdom-dark-check)"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                status, body = resp.status, resp.read(2048)
        except urllib.error.HTTPError as exc:
            status, body = exc.code, exc.read(2048)
        except Exception as exc:
            findings.append({"path": route["path"], "status": None,
                             "verdict": "UNREACHABLE", "detail": type(exc).__name__})
            continue
        checked += 1
        looks_json = body.strip().startswith((b"{", b"["))
        # ⭐ 200-with-HTML is the SPA catch-all, i.e. the route is not mounted. That is not a leak,
        # and reporting it as one is how an invented path turns into a finding.
        if status in (401, 403):
            verdict = "DARK"
        elif status == 404:
            verdict = "NOT_MOUNTED"
        elif status == 200 and not looks_json:
            verdict = "SPA_CATCHALL"
        else:
            verdict = "LIT"
        findings.append({"path": route["path"], "status": status, "verdict": verdict, "json": looks_json})
    return {"checked": checked, "findings": findings}


# ── self-check ───────────────────────────────────────────────────────────────

def self_check() -> int:
    """Prove each check can FAIL, on planted inputs. Touches nothing real."""
    ok = True

    def say(name, passed):
        nonlocal ok
        ok = ok and passed
        print(f"  [{'ok  ' if passed else 'FAIL'}] {name}")

    os.environ["WISDOM_SELFCHECK_PROBE"] = "1"
    say("a SET switch is seen", flags_set_locally({"WISDOM_SELFCHECK_PROBE"}) == {"WISDOM_SELFCHECK_PROBE": "1"})
    os.environ.pop("WISDOM_SELFCHECK_PROBE", None)
    say("an UNSET switch is not seen", flags_set_locally({"WISDOM_SELFCHECK_PROBE"}) == {})

    say("an unguarded route is classified UNGUARDED", classify({"path": "/x", "guards": []}) == "UNGUARDED")
    say("an admin route is classified admin", classify({"path": "/x", "guards": ["require_admin"]}) == "admin")
    say("an internal route is classified internal",
        classify({"path": "/x", "guards": ["require_push_secret"]}) == "internal")

    read = env_names_read()
    say(f"the AST env walk finds reads at all (found {len(read)})", len(read) > 0)
    say("it finds a WISDOM_-prefixed switch", "WISDOM_CAPTURE_ENABLED" in read)
    # ⛔ the regression that matters: the switch whose name does NOT start with WISDOM_
    say("it finds ASKAI_WISDOM_RETRIEVAL_ENABLED (member-facing, no WISDOM_ prefix)",
        "ASKAI_WISDOM_RETRIEVAL_ENABLED" in read)
    say("it does NOT report a Python constant as an env var", "WISDOM_CAP" not in read)
    say("it does NOT report a docstring mention as an env var", "WISDOM_PRIVATE_KEYS_V1" not in read)
    say("it does NOT invent one", "WISDOM_DEFINITELY_NOT_A_REAL_FLAG" not in read)

    sw = switches_read()
    say("configuration is not counted as a switch", "WISDOM_DB_PATH" not in sw)
    say("a real switch is counted", "WISDOM_CAPTURE_ENABLED" in sw)

    print(f"\nself-check: {'PASS' if ok else 'FAIL'}")
    return PASS if ok else LIT


# ── main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="", help="probe this origin with unauthenticated GETs")
    ap.add_argument("--local", action="store_true", help="measure THIS machine's environment")
    ap.add_argument("--self-check", action="store_true", help="prove the checks can fail; measures nothing")
    ap.add_argument("--json-out", default="", help="write the full result as JSON")
    args = ap.parse_args()

    if args.self_check:
        return self_check()

    _pin_data_root()
    gates = declared_gates()
    sw = [n for n, _ in gates]
    member_visible = [n for n, mv in gates if mv]
    off_reg = sorted(off_registry_switches())
    routes = wisdom_get_routes()
    result = {"gates": len(gates), "member_visible_gates": len(member_visible),
              "off_registry_switches": off_reg, "get_routes": len(routes)}

    print(f"Gates declared in flags.GATES: {len(gates)}  ({len(member_visible)} member-visible, "
          f"{len(gates) - len(member_visible)} owner/internal)")
    if off_reg:
        print(f"⛔ switches read by Wisdom code but NOT in flags.GATES: {off_reg}")
    print(f"Wisdom GET routes mounted by registry.routers(): {len(routes)}")
    by_class: dict = {}
    for r in routes:
        by_class.setdefault(classify(r), []).append(r["path"])
    for k in sorted(by_class):
        print(f"  {k:<10} {len(by_class[k])}")
    result["by_class"] = {k: sorted(v) for k, v in by_class.items()}

    # ⛔ non-vacuity: silence from a broken import looks exactly like a clean system
    if not gates or not routes:
        print("\nINCONCLUSIVE: the walk produced nothing to check. An absence is only evidence if "
              "the instrument could have seen a presence.")
        return INCONCLUSIVE

    unguarded = by_class.get("UNGUARDED") or []
    if unguarded:
        print(f"\nLIT: {len(unguarded)} Wisdom GET route(s) declare no guard: {unguarded}")

    if not args.local and not args.host:
        print("\nDRY RUN — nothing was measured. This is what a real run WOULD check:")
        print(f"  · whether any of the {len(sw)} gates is set (expected: 0), and of those "
              f"whether any of the {len(member_visible)} member-visible ones is")
        print(f"  · whether each of the {len(routes)} GET routes refuses an anonymous caller")
        print("  Add --local to measure this machine, or --host <origin> to probe one.")
        print("  ⛔ --host sends UNAUTHENTICATED GETs only and never a credential.")
        return INCONCLUSIVE

    exit_code = LIT if unguarded else PASS

    if args.local:
        lit = flags_set_locally(sw)
        lit_member = sorted(set(lit) & set(member_visible))
        result["local_switches_set"] = sorted(lit)
        result["local_member_visible_set"] = lit_member
        print(f"\nLOCAL environment: {len(lit)} of {len(sw)} gates set"
              + (f" -> {sorted(lit)}" if lit else " (dark)"))
        if lit_member:
            print(f"  ⛔ {len(lit_member)} of these are MEMBER-VISIBLE: {lit_member}")
        if lit:
            exit_code = LIT
        print("⚠️  This measures THIS MACHINE, which says nothing about production. The production "
              "half needs the Railway CLI and is a separate, deliberate act.")

    if args.host:
        got = probe(args.host, routes)
        result["probe"] = got
        lit_routes = [f for f in got["findings"] if f["verdict"] == "LIT"]
        unreachable = [f for f in got["findings"] if f["verdict"] == "UNREACHABLE"]
        print(f"\nPROBE {args.host}: {got['checked']} checked, {len(lit_routes)} LIT, "
              f"{len(unreachable)} unreachable")
        for f in got["findings"]:
            if f["verdict"] not in ("DARK", "SKIPPED_TEMPLATE"):
                print(f"  {f['verdict']:<16} {f.get('status')} {f['path']}")
        if not got["checked"]:
            print("INCONCLUSIVE: nothing was reachable.")
            exit_code = INCONCLUSIVE
        elif lit_routes:
            exit_code = LIT

    result["exit_code"] = exit_code
    if args.json_out:
        pathlib.Path(args.json_out).write_text(json.dumps(result, indent=1, sort_keys=True) + "\n",
                                               encoding="utf-8", newline="\n")
    print(f"\nverdict: {['PASS (dark)', 'LIT', 'INCONCLUSIVE'][exit_code]}")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
