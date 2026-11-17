"""agent ci `affected` decision (AUDIT design A, 2026-11-17): does this PR's diff reach the Agent BROWSER tests?

agent-ci's PR filter takes `app/**`, so every frontend PR starts agent ci; this decides in seconds whether the heavy jobs
(server, 8 browser shards, capreg, union) must run. affected=true runs them; affected=false skips them, and
tools/agent_ci_required.py accepts that skip only from a SUCCESSFUL decision job that printed a reason.

RUNS FROM THE BASE SIDE. agent-ci.yml's decision step copies THIS file, tools/agent_ci_required.py and
tools/agent_vitest_deps.mjs out of the merge-base commit (`git show <merge-base>:<path>`) into a temp dir and runs that copy;
AGENT_VITEST_PATHS and the Agent path list come from the merge-base's agent-ci.yml. Only the import GRAPH is read from
the PR's tree (plus the merge-base tree), so a PR that adds an import into the closure is affected, and a PR cannot edit
the code that judges it.

affected=true (FAIL CLOSED) when any of:
  * the diff cannot be read, or is empty;
  * the merge-base has no agent-ci.yml / AGENT_VITEST_PATHS / decision code;
  * the PR touches a SELF_PROTECTED file (the walker, this script, agent_ci_required.py, agent-ci(-required).yml,
    app/vite.config.js, app/package(-lock).json);
  * the PR touches an Agent path other than the `app/**` catch-all (#1521's Python list, app/src/agent/**, ...);
  * a walk fails, times out, reports an unparseable file, or returns fewer than MIN_CLOSURE files;
  * a changed file is in the closure of the PR tree OR of the merge-base tree (a deleted / renamed dependency).
Any exception -> affected=true. Unknown is never "not affected".

    python agent_ci_affected.py --repo <PR checkout> --base <merge-base sha> --head <PR head sha>
                                --modules <dir with node_modules/acorn> [--out <file>]
Writes `affected=true|false` and `reason=<one line>` to --out (GITHUB_OUTPUT format) and prints them.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import subprocess
import sys
import tarfile
import tempfile
import io

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))                     # the BASE copy's tools/ package, never the PR's
from tools import agent_ci_required as acr               # noqa: E402

#: The smallest believable closure (AGENT_VITEST_PATHS seeds + every file they load). Measured 2026-11-17: 2,282
#: (455 seeds + 2,091 loaded, overlapping). Below this the walk is broken, not the suite small: fail closed. tests/test_ci_agent_affected.py
#: holds it between 60% and 100% of the live closure.
MIN_CLOSURE = 1500
WALK_TIMEOUT_S = 120


def _git(repo: pathlib.Path, *args: str, binary: bool = False):
    out = subprocess.run(["git", *args], cwd=repo, capture_output=True, timeout=60)
    if out.returncode != 0:
        raise RuntimeError(f"git {' '.join(args[:2])} failed: {out.stderr.decode(errors='replace')[-200:]}")
    return out.stdout if binary else out.stdout.decode("utf-8")


def changed_files(repo: pathlib.Path, base: str, head: str) -> list[str]:
    """Every path the PR adds, modifies or deletes (a rename = its old AND new path)."""
    return [p for p in _git(repo, "diff", "--name-only", "--no-renames", f"{base}...{head}").splitlines() if p]


def base_workflow(repo: pathlib.Path, base: str) -> tuple[list[str], list[str]]:
    """(agent-ci push paths, AGENT_VITEST_PATHS filters) from the merge-base's agent-ci.yml."""
    import yaml
    text = _git(repo, "show", f"{base}:{acr.AGENT_CI.as_posix()}")
    m = re.search(r"(?m)^  AGENT_VITEST_PATHS: (.+)$", text.split("\njobs:")[0])
    if not m:
        raise RuntimeError("the merge-base agent-ci.yml has no AGENT_VITEST_PATHS")
    return acr.agent_paths(yaml.safe_load(text)), m.group(1).split()


def walk(tree: pathlib.Path, modules: pathlib.Path, filters: list[str]) -> set[str]:
    """The closure of `tree` by the BASE walker (next to this file): seeds + every file they load. Raises on any doubt."""
    out = subprocess.run(["node", str(HERE / "agent_vitest_deps.mjs"), "--repo", str(tree), "--modules", str(modules),
                          "--filters", ",".join(filters)], capture_output=True, timeout=WALK_TIMEOUT_S)
    if out.returncode != 0:
        raise RuntimeError(f"walker exit {out.returncode}: {out.stderr.decode(errors='replace')[-200:]}")
    data = json.loads(out.stdout.decode("utf-8"))
    if data.get("unparsed"):
        raise RuntimeError(f"walker could not parse {len(data['unparsed'])} file(s): {data['unparsed'][0]}")
    files = set(data.get("seeds") or []) | set(data.get("deps") or {})
    if len(files) < MIN_CLOSURE:
        raise RuntimeError(f"closure of {len(files)} files is below the floor {MIN_CLOSURE}")
    return files


def base_tree(repo: pathlib.Path, base: str, dest: pathlib.Path) -> pathlib.Path:
    """The merge-base's app/ (tracked files only) extracted under dest, for the base-side closure."""
    data = _git(repo, "archive", "--format=tar", base, "app", binary=True)
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        tar.extractall(dest, filter="data")
    return dest


def decide(changed: list[str] | None, patterns: list[str], closures) -> tuple[bool, str]:
    """closures: a callable returning the union closure (it may raise). Pure apart from calling it."""
    if not changed:
        return True, "fail closed: the PR diff is unknown or empty"
    forced = [c for c in changed if acr.matches(c, list(acr.SELF_PROTECTED))]
    if forced:
        return True, f"self-protected file changed: {forced[0]}"
    agent = [c for c in changed if acr.matches(c, [p for p in patterns if p != acr.AFFECTED_CATCH_ALL])]
    if agent:
        return True, f"Agent path changed: {agent[0]}"
    try:
        closure = closures()
    except Exception as e:                                # walker error / timeout / parse failure / below floor
        return True, f"fail closed: {type(e).__name__}: {e}"
    hit = sorted(c for c in changed if c in closure)
    if hit:
        return True, f"{len(hit)} changed file(s) in the {len(closure)}-file Agent browser closure: {hit[0]}"
    app = [c for c in changed if c.startswith("app/")]
    return False, f"{len(app)} app/ file(s) changed, none in the {len(closure)}-file Agent browser closure"


def run(repo: pathlib.Path, base: str, head: str, modules: pathlib.Path) -> tuple[bool, str]:
    try:
        changed = changed_files(repo, base, head)
        patterns, filters = base_workflow(repo, base)
    except Exception as e:
        return True, f"fail closed: {type(e).__name__}: {e}"

    def closures() -> set[str]:
        with tempfile.TemporaryDirectory() as tmp:
            return walk(repo, modules, filters) | walk(base_tree(repo, base, pathlib.Path(tmp)), modules, filters)

    return decide(changed, patterns, closures)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=".")
    ap.add_argument("--base", required=True)
    ap.add_argument("--head", required=True)
    ap.add_argument("--modules", required=True)
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    try:
        affected, reason = run(pathlib.Path(a.repo).resolve(), a.base, a.head, pathlib.Path(a.modules).resolve())
    except Exception as e:                                # belt and braces: nothing escapes as "not affected"
        affected, reason = True, f"fail closed: {type(e).__name__}: {e}"
    reason = " ".join(str(reason).split())[:200] or "no reason"
    lines = f"affected={'true' if affected else 'false'}\nreason={reason}\n"
    print(lines, end="")
    if a.out:
        with open(a.out, "a", encoding="utf-8") as f:
            f.write(lines)
    return 0


if __name__ == "__main__":
    sys.exit(main())
