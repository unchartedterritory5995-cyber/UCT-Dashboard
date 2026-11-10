"""tools/ci_paths_match.py: the required-check matcher fails SAFE (relevant=true) and the verdict fails CLOSED.

AUDIT conditions (2026-11-10, docs/agent/program/PR-required-checks.md):
  C1  every error path of `match` says relevant=true, and a mutant whose fail-safe says false turns this file red;
  C2  the glob converter agrees with an independent matcher on EVERY tracked file for every path list of the five
      aggregated workflows, and each list has a real matching and a real non-matching path (incl. `*` vs `**`
      across `/`, and dotfiles);
  C3  the verdict fails a relevant run on skipped, cancelled, neutral, failure and a MISSING needs entry;
  C4  every non-PR event is relevant.
Standard library + PyYAML + git (C2 skips without a git checkout).
"""
from __future__ import annotations

import fnmatch
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import sys
import types

import pytest
import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "ci_paths_match.py"
WF = ROOT / ".github" / "workflows"
AGGREGATED = ["vite-build-args.yml", "notebook-bytes.yml", "notebook-a11y.yml", "notebook-latency.yml", "agent-ci.yml"]
B, H = "a" * 40, "b" * 40


def _module(source: str | None = None, name: str = "ci_paths_match_under_test") -> types.ModuleType:
    if source is None:
        spec = importlib.util.spec_from_file_location(name, TOOL)
        mod = importlib.util.module_from_spec(spec)
        sys.modules[name] = mod
        spec.loader.exec_module(mod)
        return mod
    mod = types.ModuleType(name)
    mod.__file__ = str(TOOL)
    sys.modules[name] = mod
    exec(compile(source, str(TOOL), "exec"), mod.__dict__)   # noqa: S102 — our own file, mutated in-test
    return mod


M = _module()


class _Proc:
    def __init__(self, rc=0, out=b"", err=b""):
        self.returncode, self.stdout, self.stderr = rc, out, err


def _git(files=(), rc=0, raises=None):
    def run(cmd, **kw):
        if raises:
            raise raises
        return _Proc(rc, "\0".join(files).encode() + (b"\0" if files else b""), b"fatal: bad revision")
    return run


def _wf(tmp_path, text, name="w.yml"):
    p = tmp_path / name
    p.write_text(text, encoding="utf-8")
    return str(p)


GOOD = "name: x\non:\n  push:\n    branches: [master]\n    paths:\n      - 'app/src/**'\n  pull_request:\njobs: {}\n"


# ── C1: every error is relevant=true ─────────────────────────────────────────────────────────────────────────────────

def _error_cases(tmp_path):
    """(label, kwargs for decide). Every one is an error, and every one must come out relevant=True."""
    good = _wf(tmp_path, GOOD)
    pr = dict(event="pull_request", base=B, head=H)
    nonmatching = _git(["docs/readme.md"])   # would be relevant=false if the error were ignored
    cases = [
        ("missing workflow file", dict(workflow=str(tmp_path / "nope.yml"), run=nonmatching, **pr)),
        ("unreadable YAML", dict(workflow=_wf(tmp_path, "on: [\n  : :\n", "bad.yml"), run=nonmatching, **pr)),
        ("YAML not a mapping", dict(workflow=_wf(tmp_path, "- a\n- b\n", "list.yml"), run=nonmatching, **pr)),
        ("no on.push", dict(workflow=_wf(tmp_path, "on:\n  pull_request:\n", "nopush.yml"), run=nonmatching, **pr)),
        ("on is a string", dict(workflow=_wf(tmp_path, "on: push\n", "str.yml"), run=nonmatching, **pr)),
        ("no push.paths", dict(workflow=_wf(tmp_path, "on:\n  push:\n    branches: [master]\n", "nopaths.yml"),
                               run=nonmatching, **pr)),
        ("empty push.paths", dict(workflow=_wf(tmp_path, "on:\n  push:\n    paths: []\n", "empty.yml"),
                                  run=nonmatching, **pr)),
        ("push.paths-ignore", dict(workflow=_wf(tmp_path, "on:\n  push:\n    paths-ignore: ['docs/**']\n    paths: ['app/**']\n",
                                                "ign.yml"), run=nonmatching, **pr)),
        ("a non-string pattern", dict(workflow=_wf(tmp_path, "on:\n  push:\n    paths: [1]\n", "int.yml"),
                                      run=nonmatching, **pr)),
        ("empty diff", dict(workflow=good, run=_git([]), **pr)),
        ("git exits non-zero", dict(workflow=good, run=_git(["docs/readme.md"], rc=128), **pr)),
        ("git not installed", dict(workflow=good, run=_git(raises=FileNotFoundError("git")), **pr)),
        ("git times out", dict(workflow=good, run=_git(raises=subprocess.TimeoutExpired("git", 120)), **pr)),
        ("an unexpected exception", dict(workflow=good, run=_git(raises=RuntimeError("boom")), **pr)),
        ("no base SHA", dict(workflow=good, run=nonmatching, event="pull_request", base="", head=H)),
        ("no head SHA", dict(workflow=good, run=nonmatching, event="pull_request", base=B, head="")),
        ("malformed SHA", dict(workflow=good, run=nonmatching, event="pull_request", base="HEAD~1; rm -rf /", head=H)),
        ("bases without repo info", dict(workflow=good, run=_git(["app/src/a.js"]), same_repo_pr_bases="master", **pr)),
    ]
    for ch in sorted(M.UNSUPPORTED):
        cases.append((f"unsupported glob {ch!r}",
                      dict(workflow=_wf(tmp_path, f"on:\n  push:\n    paths: ['app/src/**', 'docs/a{ch}b']\n",
                                        f"g{ord(ch)}.yml"), run=nonmatching, **pr)))
    cases.append(("a leading `!` negation",
                  dict(workflow=_wf(tmp_path, "on:\n  push:\n    paths: ['app/**', '!app/docs/**']\n", "neg.yml"),
                       run=_git(["app/docs/x.md"]), **pr)))
    return cases


def _not_fail_safe(mod, tmp_path) -> list[str]:
    out = []
    for label, kw in _error_cases(tmp_path):
        d = mod.decide(**kw)
        if d.relevant is not True or "fail-safe" not in d.reason:
            out.append(f"{label}: {d}")
    return out


def test_every_error_path_is_relevant(tmp_path):
    assert _not_fail_safe(M, tmp_path) == []
    assert len(_error_cases(tmp_path)) >= 25


def test_a_mutant_whose_fail_safe_says_false_turns_this_red(tmp_path):
    """C1 CONTROL: `_fail_safe() -> relevant=False`. Every error case must now be flagged."""
    src = TOOL.read_text(encoding="utf-8")
    needle = 'return Decision(True, "fail-safe: " + reason)'
    assert src.count(needle) == 1
    mutant = _module(src.replace(needle, 'return Decision(False, "fail-safe: " + reason)'), "ci_paths_match_mutant")
    flagged = _not_fail_safe(mutant, tmp_path)
    assert len(flagged) == len(_error_cases(tmp_path)), flagged


def test_a_mutant_that_swallows_errors_as_irrelevant_turns_this_red(tmp_path):
    """C1 CONTROL 2: an `except` that returns relevant=False instead of calling the fail-safe."""
    src = TOOL.read_text(encoding="utf-8")
    needle = 'return _fail_safe(f"{type(exc).__name__}: {exc}")'
    assert src.count(needle) == 1
    mutant = _module(src.replace(needle, 'return Decision(False, "ignored")'), "ci_paths_match_mutant2")
    assert len(_not_fail_safe(mutant, tmp_path)) >= 20


def test_the_cli_always_exits_0_and_ends_with_the_decision(tmp_path, capsys):
    assert M.main(["match", "--workflow", str(tmp_path / "nope.yml"), "--event", "pull_request",
                   "--base", B, "--head", H]) == 0
    assert capsys.readouterr().out.splitlines()[-1] == "relevant=true"


def test_negation_is_never_silently_ignored(tmp_path):
    """C1 `!`: a list with a negation is fail-safe true even for a path the negation would exclude."""
    wf = _wf(tmp_path, "on:\n  push:\n    paths: ['app/**', '!app/docs/**']\n")
    for f in (["app/docs/x.md"], ["other/y"], ["app/src/z.js"]):
        d = M.decide(workflow=wf, event="pull_request", base=B, head=H, run=_git(f))
        assert d.relevant is True and "fail-safe" in d.reason, (f, d)


# ── C4: non-PR events are always relevant ────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("event", ["push", "workflow_dispatch", "schedule", "merge_group", ""])
def test_every_non_pr_event_is_relevant_even_with_no_workflow(event, tmp_path):
    d = M.decide(workflow=str(tmp_path / "nope.yml"), event=event, run=_git(raises=AssertionError("git must not run")))
    assert d.relevant is True, d


# ── decisions that are NOT errors ────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("wf", AGGREGATED)
def test_editing_the_workflow_or_the_matcher_is_always_relevant(wf, monkeypatch):
    """As CI calls it (relative WORKFLOW_FILE, cwd = the checkout): a PR touching the gating machinery runs the real
    jobs, even where push.paths does not list the workflow's own file (vite build args)."""
    monkeypatch.chdir(ROOT)
    rel = f".github/workflows/{wf}"
    for f in (rel, "tools/ci_paths_match.py"):
        d = M.decide(workflow=rel, event="pull_request", base=B, head=H, run=_git(["docs/x.md", f]),
                     repo_name="o/r", head_repo="o/r", base_ref="master",
                     same_repo_pr_bases="master" if wf == "agent-ci.yml" else "")
        assert d.relevant is True and "fail-safe" not in d.reason, (wf, f, d)
    d = M.decide(workflow=rel, event="pull_request", base=B, head=H, run=_git(["docs/x.md"]),
                 repo_name="o/r", head_repo="o/r", base_ref="master",
                 same_repo_pr_bases="master" if wf == "agent-ci.yml" else "")
    assert d.relevant is False, (wf, d)   # a docs-only PR: the real jobs are skipped

def test_relevant_and_irrelevant_prs(tmp_path):
    wf = _wf(tmp_path, GOOD)
    pr = dict(workflow=wf, event="pull_request", base=B, head=H)
    assert M.decide(run=_git(["app/src/pages/x.jsx"]), **pr).relevant is True
    assert M.decide(run=_git(["docs/a.md", "README.md"]), **pr).relevant is False
    assert M.decide(run=_git(["docs/a.md", "tools/ci_paths_match.py"]), **pr).relevant is True     # the matcher itself
    assert M.decide(run=_git(["docs/a.md", wf.replace("\\", "/")]), **pr).relevant is True        # its own workflow


def test_the_same_repo_pr_bases_policy(tmp_path):
    """agent ci: push || fork PR || same-repo PR into master runs; a same-repo PR into agent/int does not (today's
    behaviour). Path-irrelevant stays irrelevant whatever the base."""
    wf = _wf(tmp_path, GOOD)
    hit, miss = _git(["app/src/agent/a.js"]), _git(["docs/a.md"])
    kw = dict(workflow=wf, event="pull_request", base=B, head=H, repo_name="o/r", same_repo_pr_bases="master")
    assert M.decide(run=hit, head_repo="o/r", base_ref="master", **kw).relevant is True
    assert M.decide(run=hit, head_repo="o/r", base_ref="agent/int", **kw).relevant is False
    assert M.decide(run=hit, head_repo="fork/r", base_ref="agent/int", **kw).relevant is True
    assert M.decide(run=miss, head_repo="fork/r", base_ref="master", **kw).relevant is False
    # no policy given (the four notebook/vite workflows): the base never matters
    assert M.decide(run=hit, workflow=wf, event="pull_request", base=B, head=H, repo_name="o/r", head_repo="o/r",
                    base_ref="agent/int").relevant is True


def test_the_diff_is_three_dot_and_reports_both_sides_of_a_rename():
    seen = {}

    def run(cmd, **kw):
        seen["cmd"] = cmd
        return _Proc(0, b"a\0b\0")
    assert M.changed_files(B, H, run=run) == ["a", "b"]
    assert f"{B}...{H}" in seen["cmd"] and "--no-renames" in seen["cmd"] and "--name-only" in seen["cmd"]


# ── C2: the converter against every real path list ──────────────────────────────────────────────────────────────────

def _oracle(pattern: str, path: str) -> bool:
    """Independent of the converter: segment by segment, `**` = zero or more whole segments, other segments by
    fnmatchcase (whose `*` cannot cross `/` because segments have none). Valid for whole-segment `**` only."""
    ps, fs = pattern.split("/"), path.split("/")

    def go(i, j):
        if i == len(ps):
            return j == len(fs)
        if ps[i] == "**":
            return any(go(i + 1, k) for k in range(j, len(fs) + 1))
        return j < len(fs) and fnmatch.fnmatchcase(fs[j], ps[i]) and go(i + 1, j + 1)
    return go(0, 0)


@pytest.fixture(scope="module")
def tracked():
    if not shutil.which("git"):
        pytest.skip("no git")
    p = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True)
    if p.returncode != 0:
        pytest.skip("not a git checkout")
    files = [f for f in p.stdout.decode("utf-8", "replace").split("\0") if f]
    assert len(files) > 1000, len(files)
    return files


@pytest.mark.parametrize("wf", AGGREGATED)
def test_the_converter_agrees_with_the_oracle_on_every_tracked_file(wf, tracked):
    patterns = M.push_paths(str(WF / wf))
    compiled = M.compile_patterns(patterns)
    for pat, rx in zip(patterns, compiled):
        assert all("**" not in seg or seg == "**" for seg in pat.split("/")), f"{pat}: the oracle needs whole-segment **"
        diff = [f for f in tracked if bool(rx.match(f)) != _oracle(pat, f)]
        assert not diff, (wf, pat, diff[:5])
    hits = [f for f in tracked if M.matches_any(f, compiled)]
    assert hits and len(hits) < len(tracked), (wf, len(hits))   # each list has a real match and a real non-match


#: Hand-picked REAL paths (each asserted to be tracked) per list: (path, expected). `**` crossing several `/`, `*`
#: never crossing one, dotfiles and dot-directories, near misses.
CASES = {
    "vite-build-args.yml": [("app/src/pages/charts/grid/GridChartCell.jsx", True), ("Dockerfile.web", True),
                            ("app/src/testing/fundamentals/.gitignore", True), ("docs/feature_flags.json", True),
                            ("app/package.json", False), ("nixpacks.toml", False), ("app/src/App.jsx", True), ("tools/ci_paths_match.py", True)],
    "notebook-bytes.yml": [("app/src/App.jsx", True), ("app/src/testing/marketcap/.gitignore", True),
                           ("app/vite.config.js", True), (".github/workflows/notebook-bytes.yml", True),
                           ("app/index.html", False), ("api/routers/journal_two.py", False)],
    "notebook-a11y.yml": [("app/src/pages/journal-2-0/GlobalAddPositionProvider.jsx", True),
                          ("app/src/styles/tokens.css", True), (".github/workflows/notebook-a11y.yml", True),
                          ("app/src/App.jsx", False), (".github/workflows/notebook-bytes.yml", False)],
    "notebook-latency.yml": [("api/services/journal_two/__init__.py", True),
                             ("api/services/journal_two/note_connectors/convert/obsidian_fixtures_in/bin/.gitattributes", True),
                             ("api/routers/journal_two.py", True), ("tests/test_notes_cas_is_atomic.py", True),
                             ("api/routers/address_space.py", False), ("app/src/App.jsx", False)],
    "agent-ci.yml": [("api/services/uct_agent/__init__.py", True), ("tools/agent_eval_run.py", True),
                     ("app/src/components/chart/builder/agentMutations.js", True),
                     ("app/src/components/chart/builder/studio/agentRoute.test.jsx", True),
                     ("app/src/pages/charts/grid/GridChartCell.test.jsx", True),
                     (".github/workflows/agent-ci.yml", True),
                     ("app/src/pages/charts/ChartsWorkspace.jsx", True),
                     ("tools/ci_paths_match.py", True), ("api/services/journal_two/__init__.py", False),
                     ("app/src/App.jsx", False)],
}


@pytest.mark.parametrize("wf", AGGREGATED)
def test_hand_picked_real_paths(wf, tracked, tmp_path):
    seen_true = seen_false = False
    for path, want in CASES[wf]:
        assert path in tracked, f"{path} is not a tracked file: pick another real path"
        d = M.decide(workflow=str(WF / wf), event="pull_request", base=B, head=H, run=_git([path]),
                     repo_name="o/r", head_repo="o/r", base_ref="master",
                     same_repo_pr_bases="master" if wf == "agent-ci.yml" else "")
        assert d.relevant is want, (wf, path, d)
        seen_true |= want
        seen_false |= not want
    assert seen_true and seen_false


def test_star_does_not_cross_a_slash_and_double_star_does(tracked):
    """On real paths: `app/src/*` holds the top-level files only; `app/src/**` holds the deep ones too."""
    one, two = M.glob_to_regex("app/src/*"), M.glob_to_regex("app/src/**")
    top, deep = "app/src/App.jsx", "app/src/pages/charts/grid/GridChartCell.jsx"
    assert top in tracked and deep in tracked
    assert one.match(top) and not one.match(deep)
    assert two.match(top) and two.match(deep)
    assert M.glob_to_regex("tools/agent_*").match("tools/agent_eval_run.py")
    assert not M.glob_to_regex("tools/agent_*").match("tools/agent_x/sub.py")
    assert M.glob_to_regex("**/.gitignore").match(".gitignore") and M.glob_to_regex("**/.gitignore").match("a/b/.gitignore")
    assert M.glob_to_regex("app/*").match("app/.eslintrc") and not M.glob_to_regex("app/*").match("app")
    assert not M.glob_to_regex("app/src/App.jsx").match("app/src/App.jsx.bak")
    assert not M.glob_to_regex("app/vite.config.js").match("app/viteXconfig.js")   # `.` is literal


# ── C3: the verdict fails closed ─────────────────────────────────────────────────────────────────────────────────────

def _needs(relevant="true", changes="success", **jobs):
    d = {"changes": {"result": changes, "outputs": {"relevant": relevant} if relevant is not None else {}}}
    d.update({k.replace("_", "-"): {"result": v, "outputs": {}} for k, v in jobs.items()})
    return json.dumps(d)


EXPECT = ["changes", "a", "b"]
VERDICTS = [
    ("relevant, all success", _needs(a="success", b="success"), True),
    ("not relevant, all skipped", _needs("false", a="skipped", b="skipped"), True),
    ("not relevant, one ran and passed", _needs("false", a="success", b="skipped"), True),
    ("relevant, one skipped", _needs(a="success", b="skipped"), False),
    ("relevant, one cancelled", _needs(a="success", b="cancelled"), False),
    ("relevant, one neutral", _needs(a="success", b="neutral"), False),
    ("relevant, one failure", _needs(a="failure", b="success"), False),
    ("relevant, a result missing", json.dumps({"changes": {"result": "success", "outputs": {"relevant": "true"}},
                                               "a": {"result": "success"}, "b": {}}), False),
    ("a needs entry missing", _needs(a="success"), False),
    ("changes failed", _needs(changes="failure", a="skipped", b="skipped"), False),
    ("changes skipped", _needs(None, changes="skipped", a="skipped", b="skipped"), False),
    ("changes cancelled", _needs("false", changes="cancelled", a="skipped", b="skipped"), False),
    ("relevant empty, jobs skipped", _needs("", a="skipped", b="skipped"), False),
    ("relevant garbage, jobs skipped", _needs("False", a="skipped", b="skipped"), False),
    ("relevant missing, jobs skipped", _needs(None, a="skipped", b="skipped"), False),
    ("not relevant, yet a job failed", _needs("false", a="failure", b="skipped"), False),
    ("not relevant, yet a job cancelled", _needs("false", a="cancelled", b="skipped"), False),
    ("not JSON", "{not json", False),
    ("empty NEEDS", "", False),
    ("JSON but a list", "[]", False),
]


@pytest.mark.parametrize("label, needs, ok", VERDICTS, ids=[v[0] for v in VERDICTS])
def test_the_verdict(label, needs, ok):
    assert M.verdict(needs, EXPECT)[0] is ok, M.verdict(needs, EXPECT)


def test_the_verdict_refuses_an_expect_list_without_changes():
    assert M.verdict(_needs(a="success", b="success"), ["a", "b"])[0] is False


def test_the_verdict_refuses_a_relevant_run_with_no_real_job():
    assert M.verdict(_needs(), ["changes"])[0] is False


def test_the_verdict_cli_exit_codes(monkeypatch, capsys):
    monkeypatch.setenv("NEEDS", _needs(a="success", b="success"))
    assert M.main(["verdict", "--expect", "changes,a,b"]) == 0
    monkeypatch.setenv("NEEDS", _needs(a="success", b="skipped"))
    assert M.main(["verdict", "--expect", "changes,a,b"]) == 1
    assert "::error::FAIL" in capsys.readouterr().out
    monkeypatch.delenv("NEEDS")
    assert M.main(["verdict", "--expect", "changes,a,b"]) == 1


def test_a_verdict_mutant_that_accepts_skipped_turns_this_red():
    """C3 CONTROL: `!= "success"` weakened to also accept skipped."""
    src = TOOL.read_text(encoding="utf-8")
    needle = 'bad = {j: r for j, r in real.items() if r != "success"}'
    assert src.count(needle) == 1
    mutant = _module(src.replace(needle, 'bad = {j: r for j, r in real.items() if r not in ("success", "skipped")}'),
                     "ci_paths_match_mutant3")
    wrong = [label for label, needs, ok in VERDICTS if mutant.verdict(needs, EXPECT)[0] is not ok]
    assert "relevant, one skipped" in wrong, wrong


# ── the shell template around the matcher (the copy CI runs, held identical by test_ci_cost_rails) ──────────────────

def _bash():
    for cand in (r"C:\Program Files\Git\bin\bash.exe", shutil.which("bash")):
        if cand and os.path.exists(cand) and "system32" not in cand.lower():   # never WSL's bash
            return cand
    return None


STUBS = {
    "clean false": ("print('no match')\nprint('relevant=false')\n", "false"),
    "clean true": ("print('relevant=true')\n", "true"),
    "false but exit 1": ("import sys\nprint('relevant=false')\nsys.exit(1)\n", "true"),
    "crash": ("raise SystemExit('boom')\n", "true"),
    "import error": ("import no_such_module_xyz\n", "true"),
    "garbage": ("print('relevant=nope')\n", "true"),
    "false with trailing space": ("print('relevant=false ')\n", "true"),
    "no output": ("pass\n", "true"),
    "tool missing": (None, "true"),
}


@pytest.mark.parametrize("label", list(STUBS))
def test_the_changes_shell_turns_anything_but_a_clean_false_into_true(label, tmp_path):
    bash = _bash()
    if not bash:
        pytest.skip("no bash")
    doc = yaml.safe_load((WF / "vite-build-args.yml").read_text(encoding="utf-8"))
    run = [s for s in doc["jobs"]["changes"]["steps"] if s.get("id") == "match"][0]["run"]
    body, want = STUBS[label]
    if body is not None:
        (tmp_path / "tools").mkdir()
        (tmp_path / "tools" / "ci_paths_match.py").write_text(body, encoding="utf-8")
    (tmp_path / "step.sh").write_text(run, encoding="utf-8", newline="\n")
    out = tmp_path / "gh_output"
    env = dict(os.environ, GITHUB_OUTPUT=str(out), WORKFLOW_FILE="w.yml", EVENT="pull_request", BASE_SHA=B,
               HEAD_SHA=H, REPO="o/r", HEAD_REPO="o/r", BASE_REF="master", SAME_REPO_PR_BASES="",
               PATH=os.path.dirname(sys.executable) + os.pathsep + os.environ.get("PATH", ""))
    p = subprocess.run([bash, "-e", "step.sh"], cwd=tmp_path, env=env, capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stderr
    assert out.read_text(encoding="utf-8").strip() == f"relevant={want}", (label, p.stdout, p.stderr)
