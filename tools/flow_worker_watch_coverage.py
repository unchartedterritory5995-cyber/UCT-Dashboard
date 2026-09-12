"""Does this diff actually reach flow-worker?

⚰️ THE TRAP THIS EXISTS TO CLOSE. flow-worker deploys on a NARROW watch list of
specific `api/*.py` files. A change confined to anything else — `api/services/**`,
`api/routers/**`, or a top-level `api/*.py` that is not on the list — builds
nothing, deploys nothing, and leaves flow-worker serving the OLD code while every
test in the repo stays green. It has bitten this codebase at least three times:
the `app/**`-built facts bundle, `api/services/flow_aggregate.py` twice.

Measured 2026-09-11 over the last 14 master pushes: flow-worker was SKIPPED on
14 of 14, including both pushes that touched `api/` — because neither file was on
its list. The AST closure from `api/flow_worker_main.py` reaches **162** api
modules; only ~21 are watched.

⭐ THE POINT IS NOT TO WIDEN THE LIST. A wider list means more flow-worker
restarts, and every flow-worker restart gaps the OPRA tape PERMANENTLY until the
T+1 flat file. The point is to make "this push deploys nothing to flow-worker" a
VISIBLE FACT at review time instead of a discovery weeks later.

⛔ THE DASHBOARD IS THE AUTHORITY on watch patterns; `railway.json` is shared by
all services and never carries them. The only in-repo mirror is the header of
`api/flow_worker_main.py`, so that is what this parses — deliberately ONE mirror.
A second checked-in copy would be a second authority over one value, which is the
defect this repo names more than any other. If the dashboard and that header ever
disagree, the header is what drifted; fix it there.
"""
from __future__ import annotations

import ast
import os
import re
import subprocess
import shutil

# `api/{a,b,c}.py` in the header, possibly spanning several lines.
_WATCH_RE = re.compile(r"api/\{([^}]*)\}\.py", re.S)

# Watched alongside the module list, per the same header.
_EXTRA_WATCHED = ("railway.json", "requirements.txt")

ENTRY = "api/flow_worker_main.py"


def repo_root(start: str | None = None) -> str:
    """The repo root, asked of git rather than guessed from __file__.

    ⛔ `git -C <root>` everywhere below: git resolves pathspecs relative to the
    CWD and `--porcelain`/`--name-only` paths relative to the repo, and the two
    disagreeing is invisible (rule 14).
    """
    git = shutil.which("git")          # ⛔ never shell=True; a .cmd shim needs this
    if not git:
        raise RuntimeError("git not found on PATH")
    out = subprocess.run([git, "rev-parse", "--show-toplevel"],
                         cwd=start or os.path.dirname(os.path.abspath(__file__)),
                         capture_output=True, text=True, timeout=30)
    if out.returncode != 0:
        raise RuntimeError("not a git repo: " + (out.stderr or "").strip())
    return out.stdout.strip()


def watched_modules(root: str) -> set[str]:
    """The module NAMES flow-worker watches, from its own header."""
    src = open(os.path.join(root, ENTRY), encoding="utf-8").read()
    m = _WATCH_RE.search(src)
    if not m:
        raise RuntimeError(
            "could not find the `api/{...}.py` watch list in %s — the header "
            "format changed, and a silently empty list would make this rail "
            "pass for everything" % ENTRY)
    return {p.strip() for p in m.group(1).split(",") if p.strip()}


def watched_paths(root: str) -> set[str]:
    """Repo-relative paths a change to which DOES redeploy flow-worker."""
    return {"api/%s.py" % n for n in watched_modules(root)} | set(_EXTRA_WATCHED)


def _mod_path(root: str, module: str) -> str | None:
    rel = os.path.join(*module.split(".")) + ".py"
    return rel if os.path.exists(os.path.join(root, rel)) else None


def _api_imports(root: str, rel: str) -> set[str]:
    try:
        tree = ast.parse(open(os.path.join(root, rel), encoding="utf-8").read())
    except Exception:
        return set()
    out: set[str] = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            out |= {a.name for a in n.names if a.name.startswith("api.")}
        elif isinstance(n, ast.ImportFrom) and n.module and n.module.startswith("api"):
            out.add(n.module)
            # `from api.services import flow_aggregate` — the MODULE is the leaf.
            for a in n.names:
                cand = n.module + "." + a.name
                if _mod_path(root, cand):
                    out.add(cand)
    return out


def reachable_paths(root: str, entry: str = ENTRY) -> set[str]:
    """Repo-relative paths of every api module transitively imported by `entry`.

    Static and therefore an OVER-approximation in one direction and an under-
    approximation in another: a module imported inside a function is still found
    (ast.walk descends), but one reached only via importlib/getattr is not. That
    is the honest bound, and it is stated rather than hidden.
    """
    start = "api." + os.path.basename(entry)[:-3]
    seen: set[str] = set()
    queue = [start]
    out: set[str] = set()
    while queue:
        mod = queue.pop()
        if mod in seen:
            continue
        seen.add(mod)
        rel = _mod_path(root, mod)
        if not rel:
            continue
        out.add(rel.replace(os.sep, "/"))
        for dep in _api_imports(root, rel):
            if dep not in seen:
                queue.append(dep)
    return out


def offenders(changed: set[str], reachable: set[str], watched: set[str]) -> set[str]:
    """Changed files that flow-worker RUNS but that do not trigger its deploy.

    Pure and order-independent on purpose: the git plumbing above can fail in
    ways that produce an empty `changed`, and a decision function that is unit
    tested on synthetic input cannot be fooled by that.
    """
    return {c for c in changed if c in reachable and c not in watched}


def verdict(changed: set[str], reachable: set[str], watched: set[str]) -> tuple[bool, set[str]]:
    """(ok, offenders). OK when nothing is stranded, or when the same diff also
    touches a watched file — in which case flow-worker redeploys and picks the
    whole tree up anyway."""
    bad = offenders(changed, reachable, watched)
    if not bad:
        return True, set()
    if changed & watched:
        return True, bad          # a deploy IS triggered; nothing is stranded
    return False, bad


def _resolves(root: str, ref: str) -> bool:
    git = shutil.which("git")
    return subprocess.run([git, "-C", root, "rev-parse", "--verify", "--quiet", ref],
                          capture_output=True, text=True, timeout=30).returncode == 0


def base_ref(root: str) -> str | None:
    """The ref to diff against, first of these that actually resolves.

    ⛔ CI PASSES ITS OWN BASE. On a pull_request the checkout is a merge commit and
    `origin/master` may not be fetched at all, so a hard-coded base silently yields
    an empty diff — the vacuous pass this rail exists to avoid. `FLOW_WATCH_BASE`
    lets the workflow hand over `github.event.pull_request.base.sha` exactly.
    ⛔ And it is VERIFIED, not trusted: `github.event.before` is all-zeros on a new
    branch, which resolves to nothing and would fall through as "no changes".
    """
    for cand in (os.environ.get("FLOW_WATCH_BASE"), "origin/master", "HEAD~1"):
        if cand and _resolves(root, cand):
            return cand
    return None


def changed_files(root: str, base: str | None = None) -> list[str]:
    git = shutil.which("git")
    base = base or base_ref(root)
    if not base:
        return []
    mb = subprocess.run([git, "-C", root, "merge-base", base, "HEAD"],
                        capture_output=True, text=True, timeout=30)
    if mb.returncode != 0:
        return []
    out = subprocess.run([git, "-C", root, "diff", "--name-only",
                          mb.stdout.strip() + "..HEAD"],
                         capture_output=True, text=True, timeout=60)
    return [l.strip().replace(os.sep, "/") for l in out.stdout.splitlines() if l.strip()]


def main() -> int:
    root = repo_root()
    reach, watch = reachable_paths(root), watched_paths(root)
    base = base_ref(root)
    changed = set(changed_files(root, base))
    print("[watch-coverage] base=%s reachable=%d watched=%d changed=%d"
          % (base or "<none>", len(reach), len(watch), len(changed)))
    ok, bad = verdict(changed, reach, watch)
    if not changed:
        print("[watch-coverage] no diff against origin/master — nothing to judge")
        return 0
    if ok and bad:
        print("[watch-coverage] OK — %d stranded file(s) ride along with a watched "
              "file: %s" % (len(bad), sorted(bad)))
        return 0
    if ok:
        print("[watch-coverage] OK")
        return 0
    print("[watch-coverage] FAIL — flow-worker RUNS these files but will NOT "
          "redeploy for them:")
    for f in sorted(bad):
        print("    " + f)
    print("\n  This push would leave flow-worker on the OLD code with every test "
          "green.\n  Fix by EITHER touching a watched file in the same commit "
          "(the\n  `api/flow_worker_main.py` header edit is the conventional "
          "trigger),\n  OR adding these paths to flow-worker's watch list in the "
          "Railway\n  dashboard — remembering that a wider list means more tape "
          "gaps.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
