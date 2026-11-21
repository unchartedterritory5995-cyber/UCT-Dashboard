"""Every tests/**/test_*.py file, mapped to ONE domain by its own imports, and the lane that runs it.

    python tools/domain_test_census.py --report             # per domain: files, already homed, left to run, status
    python tools/domain_test_census.py --list DOMAIN        # the domain's files no other lane runs
    python tools/domain_test_census.py --shard DOMAIN K/N   # one shard of them, space-separated (a pytest leg's args)
    python tools/domain_test_census.py --check              # exit 1: a file maps to no domain, or a stale exemption
    python tools/domain_test_census.py --root DIR ...       # census another checkout (CI: the ref under test)

WHY (2026-11-20). Measured on master: 3,450 test files under tests/, 709 named by a CI lane, 2,741 run by NONE (71 of
those red in the nightly record, and four more were found red for days to months by the Pine and inventory sweeps).
This is the map for closing that, one domain lane at a time, largest first; tests/test_domain_test_census.py is the rail
that every file lands in exactly one lane, in a domain still waiting for its lane (`LIVE` does not name it yet), or
on `EXEMPT` with its reason. A file no rule maps is red.

THE DOMAIN IS DERIVED FROM THE FILE'S OWN IMPORTS (static, over the AST; code, never prose). `DOMAINS` is read in
order and the FIRST whose pattern matches any dotted module the file imports wins; then `tools` (it imports tools.*
or scripts.*), then `api-other` (any other api.* / services.*), then `repo-hygiene` (it imports none of those: the
repo's own rails over git, files and config). The patterns name PACKAGES, never test files.

ALREADY HOMED: a file a lane outside this census runs keeps that home and is never run twice. Homes are read the way
CI runs them: a literal path or glob in any workflow's jobs (the report-only nightly and on-demand remote-tests are not
lanes), and what the list tools print: tools/bars_gate_rails.py, tools/pine_test_census.py (pine heavy's census legs)
and tools/ci_app_src_rails.py (the app/src lane).

SHARDS are balanced by recorded time (tools/pytest_shard_timings.json, `files_ms`; no record counts DEFAULT_MS),
longest first onto the lightest shard, ties by name: the same checkout gives the same plan on every runner.

Exit: 0 printed · 1 `--check` found a problem · 2 malformed request or an empty domain list ("nothing" is never a pass).
Standard library + PyYAML.
"""
from __future__ import annotations

import argparse
import ast
import glob
import importlib
import json
import pathlib
import re
import sys
import warnings

import yaml

#: (domain, pattern over a dotted module name). Read in order; the first that matches any import wins.
DOMAINS: tuple[tuple[str, str], ...] = (
    ("pine", r"^(api\.services\.(ast|pine)_\w+|api\.routers\.\w*pine\w*|services\.pine_runtime)(\.|$)"),
    ("notebook-journal", r"^api\.(services|routers)\.(journal_two|journal\w*|notebook\w*|note_\w+|notes?)(\.|$)"),
    ("screener-scan", r"^api\.(services|routers)\.(screener\w*|scan\w*)(\.|$)"),
    ("pattern-engine", r"^api\.(services|routers)\.(pattern_engine|pattern_vision|patterns?)(\.|$)"),
    ("bars", r"^api\.(services\.(bars\w*|bar_\w+|data_sync|local_bars|intraday\w*)|routers\.bars\w*|bars_\w+)(\.|$)"),
    ("auth-billing", r"^api\.(middleware|services\.(auth\w*|entitlements\w*|stripe\w*|billing\w*|subscriptions?)|"
                     r"routers\.(auth\w*|billing\w*|stripe\w*|admin\w*))(\.|$)"),
    ("calendar-catalysts", r"^api\.(services|routers)\.(catalyst\w*|earnings\w*|calendar\w*)(\.|$)"),
    ("breadth", r"^api\.(services|routers)\.breadth\w*(\.|$)"),
    ("alerts", r"^api\.(services|routers)\.(alert\w*|indicator_alert\w*)(\.|$)"),
    ("wisdom", r"^api\.services\.wisdom(\.|$)"),
    ("options-flow", r"^api\.(services\.(flow\w*|options\w*)|routers\.(flow\w*|options\w*)|flow_\w+|live_\w+|"
                     r"options\w*|oi_\w+|gex_\w+|massive\w*|schwab\w*|darkpool\w*)(\.|$)"),
    ("voice-compass", r"^api\.(services\.(voice\w*|brain\w*|compass\w*)|routers\.voice\w*)(\.|$)"),
    ("wire-discord", r"^api\.(services\.(discord\w*|wire\w*|morning\w*)|routers\.wire\w*)(\.|$)"),
    ("desk", r"^api\.(services|routers)\.(desk\w*|clips?\w*)(\.|$)"),
    ("agent", r"^api\.(services|routers)\.uct_agent(\.|$)"),
    ("app-wiring", r"^api\.main$"),
    ("tools", r"^(tools|scripts)(\.|$)"),
    ("api-other", r"^(api|services)(\.|$)"),
)
#: what a file that imports none of the above maps to
FALLBACK = "repo-hygiene"
ALL_DOMAINS = tuple(d for d, _ in DOMAINS) + (FALLBACK,)

#: domain -> the workflow whose job runs `--shard <domain> K/N` (a domain lands here in its own rollout PR).
#: `pine` is pine heavy's census legs (tools/pine_test_census.py), which home every one of its files already.
LIVE: dict[str, str] = {}

#: domain -> why it has no lane YET. The rollout queue, largest first (2026-11-20 census, files no other lane runs;
#: recorded test time from tools/pytest_shard_timings.json). A domain leaves this list in the PR that makes it LIVE.
#: ⛔ A domain on NEITHER list is red: every file must land in a lane, a recorded queue position, or EXEMPT.
_QUEUE = "rollout queue (largest first, one domain per PR, run on master remotely first): position "
PENDING: dict[str, str] = {
    "notebook-journal": _QUEUE + "1 (374 files, ~35 min recorded: a full run per PR is ~40 runner-minutes, so this "
                                 "lane needs import-aware selection before it can be LIVE)",
    "screener-scan": _QUEUE + "2 (271 files, ~7 min)",
    "pattern-engine": _QUEUE + "3 (240 files, ~8 min)",
    "bars": _QUEUE + "4 (155 files, ~7 min; a PR mirror of the master gate's bars rails)",
    "auth-billing": _QUEUE + "5 (265 files, ~12 min)",
    "api-other": _QUEUE + "6 (473 files across ~100 small packages, ~11 min): split by package before it is LIVE",
    "repo-hygiene": _QUEUE + "7 (174 files, ~8 min; its two reds were fixed first, #2294 and #2296)",
    "calendar-catalysts": _QUEUE + "8 (161 files, ~3 min)",
    "tools": _QUEUE + "9 (103 files, ~9 min)",
    "breadth": _QUEUE + "10 (104 files, ~3 min)",
    "options-flow": _QUEUE + "11 (98 files, ~1 min)",
    "wisdom": _QUEUE + "12 (88 files, ~2 min; wisdom-rails.yml runs two of its files today)",
    "wire-discord": _QUEUE + "13 (63 files, ~1 min)",
    "app-wiring": _QUEUE + "14 (59 files, ~2 min)",
    "alerts": _QUEUE + "15 (56 files, ~4 min)",
    "voice-compass": _QUEUE + "16 (34 files, ~1 min)",
    "desk": _QUEUE + "17 (24 files, ~1 min)",
    "agent": "every file is homed by agent ci (tests/test_uct_agent*.py); listed so a new non-agent-ci file is seen",
}

#: path -> why no lane runs it (vendor-only data, needs a secret, ...). A file on this list is not run on a PR.
EXEMPT: dict[str, str] = {}

TIMINGS = pathlib.Path("tools") / "pytest_shard_timings.json"
DEFAULT_MS = 3000
NOT_LANES = {"full-suite-report.yml", "remote-tests.yml"}
_TOKEN = re.compile(r"tests/[A-Za-z0-9_*?\[\]/.-]+?\.py")
_RX = [(d, re.compile(p)) for d, p in DOMAINS]


def test_files(root: pathlib.Path) -> list[str]:
    return sorted(p.relative_to(root).as_posix() for p in (root / "tests").rglob("test_*.py")
                  if "__pycache__" not in p.parts and p.is_file())


def imports(path: pathlib.Path) -> set[str] | None:
    """Every dotted module `path` imports (absolute imports; a function-level import counts). None: it does not parse."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", SyntaxWarning)
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except (SyntaxError, UnicodeDecodeError):
        return None
    out: set[str] = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            out |= {a.name for a in n.names}
        elif isinstance(n, ast.ImportFrom) and n.module and not n.level:
            out.add(n.module)
            out |= {f"{n.module}.{a.name}" for a in n.names}
    return out


def domain_of(mods: set[str] | None) -> str | None:
    """The file's domain, or None when it cannot be read (an unparsable file maps nowhere, and the rail says so)."""
    if mods is None:
        return None
    for d, rx in _RX:
        if any(rx.match(m) for m in mods):
            return d
    return FALLBACK


def _strings(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for k, v in node.items():
            if isinstance(k, str):
                yield k
            yield from _strings(v)
    elif isinstance(node, list):
        for v in node:
            yield from _strings(v)


def homes(root: pathlib.Path) -> dict[str, set[str]]:
    """{test file: {lanes outside this census that run it}}."""
    out: dict[str, set[str]] = {}
    for wf in sorted((root / ".github" / "workflows").glob("*.yml")):
        if wf.name in NOT_LANES or wf.name in set(LIVE.values()):
            continue
        doc = yaml.safe_load(wf.read_text(encoding="utf-8")) or {}
        for s in _strings(doc.get("jobs") or {}):
            for tok in _TOKEN.findall(s):
                for p in glob.glob(str(root / tok), recursive=True):
                    out.setdefault(pathlib.Path(p).resolve().relative_to(root.resolve()).as_posix(), set()).add(wf.name)
    sys.path.insert(0, str(root / "tools"))
    try:
        for name, call in (("bars_gate_rails", lambda m: m.gated(root)),
                           ("pine_test_census", lambda m: m.census(root)),
                           ("ci_app_src_rails", lambda m: m.print_list(root))):
            try:
                mod = importlib.import_module(name)
            except ImportError:
                continue                                  # a ref cut before that tool: it homes nothing there
            for f in call(mod):
                out.setdefault(str(f).split("::")[0], set()).add(name)
    finally:
        sys.path.remove(str(root / "tools"))
    return out


def census(root: pathlib.Path, homed: dict[str, set[str]] | None = None) -> dict[str, dict]:
    """{file: {"domain": str | None, "homes": [...]}} for every test file."""
    homed = homes(root) if homed is None else homed
    return {f: {"domain": domain_of(imports(root / f)), "homes": sorted(homed.get(f, ()))} for f in test_files(root)}


def to_run(c: dict[str, dict], domain: str) -> list[str]:
    """The domain's files no other lane runs and no exemption covers: what its lane runs."""
    return sorted(f for f, r in c.items() if r["domain"] == domain and not r["homes"] and f not in EXEMPT)


def recorded_ms(root: pathlib.Path) -> dict[str, int]:
    try:
        return json.loads((root / TIMINGS).read_text(encoding="utf-8")).get("files_ms") or {}
    except (OSError, ValueError):
        return {}


def plan(files: list[str], n: int, ms: dict[str, int]) -> list[list[str]]:
    shards: list[list[str]] = [[] for _ in range(n)]
    load = [0] * n
    for f in sorted(files, key=lambda f: (-int(ms.get(f) or DEFAULT_MS), f)):
        i = min(range(n), key=lambda k: (load[k], k))
        shards[i].append(f)
        load[i] += int(ms.get(f) or DEFAULT_MS)
    return [sorted(s) for s in shards]


def problems(root: pathlib.Path, c: dict[str, dict]) -> list[str]:
    out = [f"maps to no domain (it does not parse): {f}" for f, r in c.items() if r["domain"] is None]
    out += [f"stale exemption (no such test file): {f}" for f in EXEMPT if f not in c]
    out += [f"an exemption without a reason: {f}" for f, why in EXEMPT.items() if not str(why).strip()]
    out += [f"LIVE names a domain this census does not have: {d}" for d in LIVE if d not in ALL_DOMAINS]
    out += [f"LIVE names a workflow that does not exist: {w}" for w in LIVE.values()
            if not (root / ".github" / "workflows" / w).is_file()]
    for d in ALL_DOMAINS:
        if d == "pine":
            continue                                       # pine heavy's census legs (tools/pine_test_census.py)
        if d in LIVE and d in PENDING:
            out.append(f"a domain is both LIVE and PENDING: {d}")
        elif d not in LIVE and not str(PENDING.get(d, "")).strip():
            out.append(f"a domain with no lane and no recorded reason (LIVE or PENDING): {d}")
    out += [f"PENDING names a domain this census does not have: {d}" for d in PENDING if d not in ALL_DOMAINS]
    if (root / "tools" / "pine_test_census.py").is_file():
        out += [f"imports the Pine engine but no pine heavy leg runs it: {f}" for f in to_run(c, "pine")]
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--root", default=".")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--report", action="store_true")
    g.add_argument("--check", action="store_true")
    g.add_argument("--list", metavar="DOMAIN")
    g.add_argument("--shard", nargs=2, metavar=("DOMAIN", "K/N"))
    a = ap.parse_args(argv)
    root = pathlib.Path(a.root).resolve()
    c = census(root)
    if a.check:
        found = problems(root, c)
        for p in found:
            print(p)
        return 1 if found else 0
    if a.report:
        ms = recorded_ms(root)
        print(f"{len(c)} test files; {sum(1 for r in c.values() if r['homes'])} already homed; "
              f"{sum(1 for f in c if f in EXEMPT)} exempt")
        for d in ALL_DOMAINS:
            mine = [f for f, r in c.items() if r["domain"] == d]
            run = to_run(c, d)
            secs = sum(int(ms.get(f) or DEFAULT_MS) for f in run) / 1000
            state = f"LIVE ({LIVE[d]})" if d in LIVE else ("pine heavy census legs" if d == "pine" else "PENDING")
            print(f"{d:20s} {len(mine):5d} files  {len(mine) - len(run):4d} homed  {len(run):4d} to run  "
                  f"~{secs / 60:5.1f} min recorded  {state}")
        return 0
    domain = a.list or a.shard[0]
    if domain not in ALL_DOMAINS:
        print(f"[lane-census] no such domain {domain!r}; one of {', '.join(ALL_DOMAINS)}", file=sys.stderr)
        return 2
    files = to_run(c, domain)
    if not files:
        print(f"[lane-census] domain {domain!r} has nothing to run: a lane over it would pass vacuously", file=sys.stderr)
        return 2
    if a.list:
        print("\n".join(files))
        return 0
    k, _, n = a.shard[1].partition("/")
    try:
        k_i, n_i = int(k), int(n)
        assert 1 <= k_i <= n_i
    except (ValueError, AssertionError):
        print(f"[lane-census] K/N wants 1 <= K <= N, got {a.shard[1]!r}", file=sys.stderr)
        return 2
    shard = plan(files, n_i, recorded_ms(root))[k_i - 1]
    if not shard:
        print(f"[lane-census] shard {a.shard[1]} of {domain!r} is empty", file=sys.stderr)
        return 2
    print(" ".join(shard))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
