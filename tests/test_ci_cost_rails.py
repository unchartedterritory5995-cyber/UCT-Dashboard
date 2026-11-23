"""CI cost rails: the trigger shapes that keep the GitHub Actions bill from creeping back.

Measured 2026-11-06 (owner): the repo went private, so every Actions minute is billed, and the account hit its
$300 Actions budget on 11-06, five days into the month. 6,819 runs on 11-01..11-06. The sampled split:

    agent ci            ~70%  789 runs x ~76 min (552 of them PUSHES to agent/** with no path filter)
    master deploy gate  ~10%  176 runs x ~48 min (deliberate: the full Agent suite on every master push)
    12 small rails      ~20%  ~700-970 runs each; every superseded PR push ran to completion

Each rail below names one of those leaks. A failure here is not "the CI is wrong"; it is "this change makes CI
cost more, so make it a deliberate, reviewed change": update the pinned set with a reason, in the same commit.

Standard library + PyYAML (in requirements.txt). YAML 1.1 parses the `on:` key as the boolean True.
"""
from __future__ import annotations

import ast
import fnmatch
import json
import pathlib
import re
import subprocess

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
MASTER = {"master", "main"}

#: Pushes to non-master branches with NO path filter. Each is cheap or single-branch; a new one is a deliberate change.
UNFILTERED_BRANCH_PUSH_OK = {
    "agent-ci-benchmark.yml": "one dedicated branch (ci/agent-shard-benchmark), pushed by hand",
    "wisdom-rails.yml": "stdlib-only rails, ~5 min, the wisdom program's own branches",
}
#: PR-triggered workflows with NO path filter: repo-wide rails whose subject is the whole tree.
UNFILTERED_PR_OK = {
    "term018-guards.yml": "every guard in api/ is its subject; ~3 min",
    "wisdom-rails.yml": "the ban rails scan the whole tree; ~5 min",
    "secret-scan.yml": "a key can land in ANY file of a public repo; scans only the PR's own commits, ~1 min",
    # (2026-11-22: agent-ci-required.yml left this list. It is still unfiltered on purpose, but its trigger is now
    # `pull_request_target` on master, because the status is posted with a GitHub App from an environment only master
    # may use; this rail reads `pull_request` triggers. Its shape is held by tests/test_ci_agent_merge_ref.py.)
    # 2026-11-20: the master deploy gate's static checks, before the merge (three gate reds in one day on checks only
    # the gate ran). PRs into master only, no push trigger; ~3 min, mostly the 80 s shadow sweep
    "gate-static-rails-pr.yml": "the hygiene check's subject is every tracked file and the shadow sweep's every module",
}


def _load(path: pathlib.Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _on(doc: dict) -> dict:
    on = doc.get("on", doc.get(True)) or {}
    if isinstance(on, str):
        return {on: {}}
    if isinstance(on, list):
        return {k: {} for k in on}
    return {k: (v or {}) for k, v in on.items()}


def _workflows():
    files = sorted(WORKFLOWS.glob("*.y*ml"))
    assert len(files) >= 10, f"only {len(files)} workflow files found under {WORKFLOWS}: wrong directory?"
    return [(f.name, _load(f)) for f in files]


def _filtered(trigger: dict) -> bool:
    return bool(trigger.get("paths") or trigger.get("paths-ignore"))


def test_agent_ci_push_and_pr_run_on_the_same_paths():
    """The 70% leak. The push trigger must carry the PR trigger's paths list, entry for entry."""
    on = _on(_load(WORKFLOWS / "agent-ci.yml"))
    push, pr = on["push"].get("paths"), on["pull_request"].get("paths")
    assert pr, "agent-ci.yml's pull_request trigger lost its paths list"
    assert push == pr, f"agent-ci.yml push.paths and pull_request.paths differ:\n push={push}\n pr={pr}"


def test_no_branch_push_trigger_runs_without_a_path_filter():
    """A push trigger on branches other than master fires on every commit an agent session pushes."""
    bad = []
    for name, doc in _workflows():
        push = _on(doc).get("push")
        if push is None:
            continue
        branches = set(push.get("branches") or ["**"])
        if branches <= MASTER or _filtered(push) or name in UNFILTERED_BRANCH_PUSH_OK:
            continue
        bad.append(f"{name}: push.branches={sorted(branches)}")
    assert not bad, "branch push triggers with no path filter (add `paths:` or pin with a reason):\n" + "\n".join(bad)


#: a branch the merge queue would create for pull request 1 into master
QUEUE_BRANCH = "gh-readonly-queue/master/pr-1-0123456789abcdef0123456789abcdef01234567"


def _branch_glob_matches(pattern: str, branch: str) -> bool:
    """GitHub's branch filter, the two wildcards these workflows use: `*` stops at a slash, `**` does not."""
    rx = "".join(".*" if tok == "**" else "[^/]*" if tok == "*" else re.escape(tok)
                 for tok in re.split(r"(\*\*|\*)", pattern))
    return re.fullmatch(rx, branch) is not None


def _fires_on_the_queue(push: dict) -> bool:
    """Would this push trigger run for the merge queue's temporary branch?"""
    branches = push.get("branches")
    if branches:
        return any(_branch_glob_matches(b, QUEUE_BRANCH) for b in branches if not b.startswith("!"))
    return not any(_branch_glob_matches(b, QUEUE_BRANCH) for b in push.get("branches-ignore") or [])


def test_no_push_trigger_runs_on_the_merge_queues_temporary_branches():
    """Rehearsed 2026-11-22 (northstar-quarry/mq-rehearsal, 5 queued pull requests): GitHub builds every queued pull
    request on a branch `gh-readonly-queue/<base>/pr-N-<sha>`, and a `push` trigger with no branch filter ran on
    each of them, once per queued pull request. At ~170 merges a day that is ~170 extra runs per such workflow.
    A push trigger names its branches, or ignores the queue's."""
    bad = [name for name, doc in _workflows()
           if _on(doc).get("push") is not None and _fires_on_the_queue(_on(doc)["push"])]
    assert not bad, ("push triggers that would run on the merge queue's temporary branches "
                     "(add `branches-ignore: ['gh-readonly-queue/**']`):\n" + "\n".join(bad))


def test_the_queue_branch_judge_can_tell_the_cases_apart():
    """Control: a judge that answered the same for every trigger would hold nothing."""
    assert _fires_on_the_queue({}) and _fires_on_the_queue({"paths": ["api/**"]})
    assert _fires_on_the_queue({"branches": ["**"]}) and _fires_on_the_queue({"branches": ["gh-readonly-queue/**"]})
    assert not _fires_on_the_queue({"branches": ["master", "main"]})
    assert not _fires_on_the_queue({"branches": ["agent/**", "wisdom/**", "*"]})      # `*` stops at a slash
    assert not _fires_on_the_queue({"paths": ["api/**"], "branches-ignore": ["gh-readonly-queue/**"]})
    assert _fires_on_the_queue({"branches-ignore": ["gh-readonly-queue/*"]})          # one level only: not enough


def test_unfiltered_pr_workflows_are_exactly_the_pinned_set():
    unfiltered = {name for name, doc in _workflows() if "pull_request" in _on(doc) and not _filtered(_on(doc)["pull_request"])}
    assert unfiltered == set(UNFILTERED_PR_OK), (
        f"PR workflows with no path filter: {sorted(unfiltered)}; pinned: {sorted(UNFILTERED_PR_OK)}. "
        "Add `paths:` or pin it in UNFILTERED_PR_OK with a reason.")


def test_every_pr_workflow_cancels_its_superseded_pr_runs():
    """An agent session that pushes three times to a PR must not pay for the first two runs to finish."""
    bad = []
    for name, doc in _workflows():
        if "pull_request" not in _on(doc):
            continue
        conc = doc.get("concurrency")
        cancel = conc.get("cancel-in-progress") if isinstance(conc, dict) else None
        if not (cancel is True or (isinstance(cancel, str) and "pull_request" in cancel)):
            bad.append(f"{name}: concurrency={conc!r}")
    assert not bad, "PR-triggered workflows that let superseded runs finish:\n" + "\n".join(bad)


def test_no_workflow_cancels_a_master_push_run():
    """The other direction, and the one that matters for deploys: promotion reads EVERY master run for a SHA, and
    the master deploy gate's `cancel-in-progress: false` is its whole mechanism. A literal `true` on a workflow
    that runs on master pushes would cancel a gating run."""
    bad = []
    for name, doc in _workflows():
        push = _on(doc).get("push")
        if push is None:
            continue
        branches = set(push.get("branches") or ["**"])
        if not (branches & MASTER or "**" in branches):
            continue
        conc = doc.get("concurrency")
        if isinstance(conc, dict) and conc.get("cancel-in-progress") is True:
            bad.append(name)
    assert not bad, f"workflows that would cancel a master push run: {bad}"


def test_the_capreg_post_leg_does_not_rerun_what_the_shards_run():
    """The vitest capreg suite at the post clock already runs inside agent-ci's browser shards; only the rth leg
    runs it again (that clock is covered nowhere else). Re-adding it to the post leg is ~15 min per run."""
    job = _load(WORKFLOWS / "agent-ci.yml")["jobs"]["capability-regression-clock"]
    vitest = [s for s in job["steps"] if "vitest run " in (s.get("run") or "")]
    assert len(vitest) == 1, vitest
    assert vitest[0].get("if") == "matrix.clock != 'post'", vitest[0]
    shards = " ".join(s.get("run") or "" for s in _load(WORKFLOWS / "agent-ci.yml")["jobs"]["browser"]["steps"])
    assert "$AGENT_VITEST_PATHS" in shards, "the shards no longer run the Agent paths, so the post leg is the only post-clock run"


# ── light pull-request checkouts (2026-11-17) ─────────────────────────────────────────────────────────────────
# Two rails run on every push to every PR, and more than half of each run was the checkout: 71 s for 1.35 GB of
# history and a 2.3 GB tree. Their PULL REQUEST runs now take less (probe run 44004258840: 71 s -> 12 s sparse,
# 71 s -> 37 s whole tree), and every other event keeps exactly the checkout it had, because promotion reads the
# master run. The rails below EVALUATE the workflow, they do not read its text: which checkout runs for each
# event, whether the history is whole, and whether a sparse list holds every path the check's own source names.

#: workflow -> the job whose PULL REQUEST run takes a lighter checkout than every other event's.
LIGHT_PR_CHECKOUT = {
    "term018-guards.yml": "static",
    "wisdom-rails.yml": "rails",
}
#: Checks that walk the whole tree. Measured under strace on a full checkout: the wisdom ban rails opened 7,365
#: files in 2,224 folders, docs/notebook/evidence and tests/fixtures/vendor among them. A folder that is not on
#: disk is a folder such a check silently does not scan, so these never take a sparse checkout, in any job.
WHOLE_TREE_CHECKS = {
    "wisdom-rails.yml": "the ban rails scan every folder",
    "secret-scan.yml": "a key can land in any file",
    "gate-static-rails-pr.yml": "the hygiene check skips a file that is not on disk; the shadow sweep parses every module",
}
#: What every event other than a pull request checks out: the shape these jobs had before 2026-11-17.
FULL_CHECKOUT = {"fetch-depth": 0}
EVENTS = ("pull_request", "push", "workflow_dispatch", "schedule", "merge_group", "workflow_run")


def _runs_on(condition, event: str) -> bool:
    """Does a step with this `if:` run for this event? Only the two shapes a light checkout may use are
    evaluated; anything else (no condition, `always()`, a compound) is refused by name, never guessed."""
    m = re.fullmatch(r"github\.event_name\s*(==|!=)\s*'([a-z_]+)'", str(condition or "").strip())
    assert m, f"a checkout condition this rail cannot evaluate: {condition!r}"
    return (event == m.group(2)) == (m.group(1) == "==")


def _checkouts(name: str, job: str | None = None) -> list[dict]:
    jobs = _load(WORKFLOWS / name)["jobs"]
    picked = [jobs[job]] if job else list(jobs.values())
    return [s for j in picked for s in j.get("steps") or [] if str(s.get("uses", "")).startswith("actions/checkout@")]


def _is_light(step: dict) -> bool:
    w = step.get("with") or {}
    return "filter" in w or "sparse-checkout" in w


def _tracked() -> list[str]:
    """Every path git tracks. Raises when git cannot answer: an empty list would pass every check below."""
    proc = subprocess.run(["git", "-C", str(ROOT), "ls-files", "-z"], capture_output=True, timeout=120)
    assert proc.returncode == 0, f"git ls-files failed: {proc.stderr[:300]!r}"
    files = [p for p in proc.stdout.decode("utf-8", "surrogateescape").split("\0") if p]
    assert len(files) > 5000, f"git lists only {len(files)} files: not this repository?"
    return files


def _sparse_decider(patterns: list[str]):
    """`included(path)` for a non-cone sparse list, as git decides it: the LAST pattern that matches the path
    itself wins; a path no pattern matches inherits its folder's answer; nothing matched is not checked out.
    Only root-anchored patterns with single-segment `*` are accepted. Anything else is refused by name."""
    rules = []
    for raw in patterns:
        include = not raw.startswith("!")
        body = raw if include else raw[1:]
        assert body.startswith("/") and "**" not in body and body.strip("/"), f"a sparse pattern this rail cannot evaluate: {raw!r}"
        rules.append((include, body.endswith("/"), body.strip("/").split("/")))

    def decide(segments: tuple, is_dir: bool) -> bool:
        for include, dir_only, pat in reversed(rules):
            if (dir_only and not is_dir) or len(pat) != len(segments):
                continue
            if all(fnmatch.fnmatchcase(s, p) for s, p in zip(segments, pat)):
                return include
        return decide(segments[:-1], True) if len(segments) > 1 else False

    return lambda path: decide(tuple(path.split("/")), False)


def _paths_a_check_names(test_files: list[str], tracked: list[str]) -> tuple[set, set]:
    """`(files, folders)` a check reads, derived from its own source and from the JSON records that source
    names: every `ROOT / "a" / "b"` chain and every string with a slash that is a tracked file; every chain
    prefix that is a tracked folder; and, inside each JSON record, every tracked file a string names and every
    tracked folder a string equals (a record's walk roots). Comments and docstrings are not source."""
    tracked_set = set(tracked)
    folders_all = {"/".join(p.split("/")[:i]) for p in tracked for i in range(1, p.count("/") + 1)}
    files, folders = set(), set()

    def note(text: str, as_folder: bool) -> None:
        t = text.strip().strip("/")
        if t in tracked_set:
            files.add(t)
        elif as_folder and t in folders_all:
            folders.add(t)

    def walk(value) -> None:
        if isinstance(value, dict):
            for k, v in value.items():
                walk(k)
                walk(v)
        elif isinstance(value, list):
            for v in value:
                walk(v)
        elif isinstance(value, str):
            note(value, as_folder=True)
            for token in re.split(r"[\s:`'\",;()]+", value):
                note(token, as_folder=False)

    for rel in test_files:
        tree = ast.parse((ROOT / rel).read_text(encoding="utf-8"))
        docstrings = {id(n.body[0].value) for n in ast.walk(tree)
                      if isinstance(n, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and n.body
                      and isinstance(n.body[0], ast.Expr) and isinstance(n.body[0].value, ast.Constant)}
        # `a / b / c` parses as `(a / b) / c`: only the outermost chain is a path, its left side is a prefix of it
        inner = {id(n.left) for n in ast.walk(tree) if isinstance(n, ast.BinOp) and isinstance(n.op, ast.Div)}
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstrings:
                if "/" in node.value and len(node.value) < 200:
                    note(node.value, as_folder=False)
            if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div) and id(node) not in inner:
                parts, cur = [], node
                while isinstance(cur, ast.BinOp) and isinstance(cur.op, ast.Div):
                    right = cur.right
                    parts.append(right.value if isinstance(right, ast.Constant) and isinstance(right.value, str) else None)
                    cur = cur.left
                static = []
                for part in reversed(parts):         # the leading run of literal parts is a real path prefix
                    if part is None:
                        break
                    static.append(part)
                if static and isinstance(cur, ast.Name) and cur.id.lower() == "root":
                    note("/".join(static), as_folder=True)
    for record in sorted(f for f in files if f.endswith(".json")):
        walk(json.loads((ROOT / record).read_text(encoding="utf-8")))
    return files, folders


def test_exactly_one_checkout_runs_for_every_event_and_only_a_pull_request_gets_the_light_one():
    """Promotion reads the master run, so the light checkout must be unreachable from a master push: for every
    event exactly one checkout step runs, it is the light one only on `pull_request`, and the other one is the
    full checkout these jobs always had."""
    for name, job in LIGHT_PR_CHECKOUT.items():
        steps = _checkouts(name, job)
        assert len(steps) == 2, f"{name}: {len(steps)} checkout steps, expected the light one and the full one"
        for event in EVENTS:
            running = [s for s in steps if _runs_on(s.get("if"), event)]
            assert len(running) == 1, f"{name}: {len(running)} checkouts run on {event}"
            assert _is_light(running[0]) == (event == "pull_request"), f"{name}: wrong checkout on {event}: {running[0]}"
            if event != "pull_request":
                assert (running[0].get("with") or {}) == FULL_CHECKOUT, f"{name}: {event} no longer gets the full checkout"


def test_the_event_evaluator_can_tell_the_two_conditions_apart_and_refuses_the_rest():
    """Control for the rail above: an evaluator that answered the same for `==` and `!=`, or accepted a
    condition it does not understand, would hold nothing."""
    assert _runs_on("github.event_name == 'pull_request'", "pull_request") is True
    assert _runs_on("github.event_name == 'pull_request'", "push") is False
    assert _runs_on("github.event_name != 'pull_request'", "pull_request") is False
    assert _runs_on("github.event_name != 'pull_request'", "push") is True
    for refused in (None, "", "always()", "github.event_name == 'pull_request' || true", "true"):
        try:
            _runs_on(refused, "push")
        except AssertionError as exc:
            assert "cannot evaluate" in str(exc)
        else:
            raise AssertionError(f"accepted a condition it cannot evaluate: {refused!r}")


def test_a_light_checkout_keeps_the_whole_commit_graph():
    """Both rails ask git about history (an ancestor test; a merge base). `fetch-depth: 0` with
    `filter: blob:none` holds every commit and leaves out old file contents; a depth would make the clone
    shallow, and any other filter could drop the trees a name-only diff reads."""
    for name, job in LIGHT_PR_CHECKOUT.items():
        for step in _checkouts(name, job):
            w = step.get("with") or {}
            assert w.get("fetch-depth") == 0, f"{name}: a checkout without the full history: {w}"
            if _is_light(step):
                assert w.get("filter") == "blob:none", f"{name}: light checkout filter is {w.get('filter')!r}"
                if "sparse-checkout" in w:
                    assert w.get("sparse-checkout-cone-mode") is False, f"{name}: the sparse list is written for non-cone mode"


def test_a_check_that_walks_the_whole_tree_never_takes_a_sparse_checkout():
    for name in WHOLE_TREE_CHECKS:
        sparse = [s for s in _checkouts(name) if "sparse-checkout" in (s.get("with") or {})]
        assert not sparse, f"{name} walks the whole tree; a sparse checkout silently narrows what it scans: {sparse}"
    # control: the rail can see a sparse checkout where there is one
    assert any("sparse-checkout" in (s.get("with") or {}) for s in _checkouts("term018-guards.yml"))


def test_a_sparse_pull_request_checkout_holds_every_path_the_check_names():
    """A file that is not on disk fails loudly; a FOLDER that is not on disk is walked as empty. So the sparse
    list must hold every file the check's source and records name, and every folder they name must be whole.
    The paths are derived (the tests the job runs -> their source -> the records it names), never listed."""
    tracked = _tracked()
    seen = 0
    for name, job in LIGHT_PR_CHECKOUT.items():
        light = [s for s in _checkouts(name, job) if "sparse-checkout" in (s.get("with") or {})]
        if not light:
            continue
        seen += 1
        included = _sparse_decider(light[0]["with"]["sparse-checkout"].split())
        runs = " ".join(s.get("run") or "" for s in _load(WORKFLOWS / name)["jobs"][job]["steps"])
        tests = sorted(set(re.findall(r"\btests/[\w./-]+\.py\b", runs)))
        assert tests, f"{name}: the job names no test file, so nothing can be derived"
        files, folders = _paths_a_check_names(tests, tracked)
        files |= set(tests) | {f".github/workflows/{name}"}
        assert len(files) >= 20 and folders, f"{name}: derived only {len(files)} files and {sorted(folders)} folders"
        missing = sorted(f for f in files if not included(f))
        assert not missing, f"{name}: files the check names that a pull request would not have on disk: {missing[:10]}"
        for folder in sorted(folders):
            partial = [p for p in tracked if p.startswith(folder + "/") and not included(p)]
            assert not partial, f"{name}: {folder}/ is read by the check but {len(partial)} of its files are left out, e.g. {partial[:3]}"
    assert seen, "no light checkout is sparse any more: delete this rail with the last one, not before"


def test_the_sparse_evaluator_decides_as_git_does():
    """Control for the rail above, on the three traps of a non-cone list: a later pattern wins; a file under a
    left-out folder comes back only when a pattern names the file itself; `*` never crosses a slash."""
    included = _sparse_decider(["/*", "!/*/", "/api/", "/tests/*", "!/tests/*/", "/tests/*/__init__.py", "/docs/keep/"])
    yes = ["README.md", "api/main.py", "api/services/deep/x.py", "tests/test_a.py", "tests/data.json",
           "tests/pkg/__init__.py", "docs/keep/a/b.md"]
    no = ["docs/other.md", "docs/notebook/evidence/x.png", "tests/pkg/test_b.py", "tests/pkg/sub/__init__.py",
          "tests/fixtures/vendor/a.json", "app/src/App.jsx"]
    assert [p for p in yes if not included(p)] == [] and [p for p in no if included(p)] == []
    for refused in (["api/"], ["/**/x"], ["/"]):
        try:
            _sparse_decider(refused)
        except AssertionError as exc:
            assert "cannot evaluate" in str(exc)
        else:
            raise AssertionError(f"accepted a pattern it cannot evaluate: {refused}")
