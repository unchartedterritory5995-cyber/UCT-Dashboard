"""P2 rails for agent-ci.yml's merge-tree evidence runs (2026-11-17). They EVALUATE the workflow's expressions for each
event (a small evaluator for the GitHub expression subset agent-ci.yml uses; anything else is refused by name):

  * push runs are unchanged: every job still runs, every added step is skipped, every added value is '' on push,
    and the push concurrency group is the exact string it was (`agent-ci-<ref>`);
  * a same-repo agent/** PR into MASTER runs all 13 required jobs (8 browser shards) on its pull_request event, and a
    PR into agent/int still skips them (its evidence stays the push run);
  * the evidence-run concurrency group is per PR, shared by the PR's pull_request run and its re-arm dispatch;
  * every required job (each matrix leg) records and uploads `agent-ci-evidence-pr<N>-<key>`, and every checkout pins
    the dispatched merge commit;
  * the self-protection is intact: agent-ci.yml and the new tools are Agent paths, inputs never reach a shell, and
    agent-ci-required still runs the default branch's copy.
"""
from __future__ import annotations

import pathlib
import re

import pytest
import yaml

from tools import agent_ci_evidence as ev
from tools import agent_ci_required as acr

ROOT = pathlib.Path(__file__).resolve().parents[1]
WF = ROOT / ".github" / "workflows" / "agent-ci.yml"
DOC = yaml.safe_load(WF.read_text(encoding="utf-8"))
ON = DOC.get("on", DOC.get(True))
REPO = "o/r"
MERGE = "d" * 40


# ---------------------------------------------------------------------------------------------- the evaluator
_TOK = re.compile(r"\s*(?:(?P<str>'(?:[^']|'')*')|(?P<num>\d+)|(?P<op>==|!=|&&|\|\||!|\(|\)|,)|(?P<id>[A-Za-z_][\w.\-]*))")


def _tokens(expr: str):
    pos, out = 0, []
    expr = expr.strip()
    while pos < len(expr):
        m = _TOK.match(expr, pos)
        assert m and m.end() > pos, f"an expression this rail cannot evaluate: {expr!r} at {pos}"
        pos = m.end()
        kind = m.lastgroup
        out.append((kind, m.group(kind)))
    return out


def _lookup(ctx: dict, dotted: str):
    cur = ctx
    for part in dotted.split("."):
        cur = cur.get(part) if isinstance(cur, dict) else None
    return cur


def evaluate(expr: str, ctx: dict):
    """GitHub semantics for this subset: `a && b` -> b if a is truthy else a; `a || b` -> a if truthy else b;
    `==`/`!=` compare strings case-insensitively; a missing context value is null."""
    toks, i = _tokens(expr), 0

    def peek():
        return toks[i] if i < len(toks) else (None, None)

    def take(val=None):
        nonlocal i
        t = toks[i]
        assert val is None or t[1] == val, (expr, t, val)
        i += 1
        return t

    def truthy(v):
        return v not in (None, False, "", 0)

    def eq(a, b):
        a = "" if a is None else a
        b = "" if b is None else b
        return str(a).lower() == str(b).lower()

    def primary():
        kind, val = peek()
        if val == "!":
            take()
            return not truthy(primary())
        if val == "(":
            take()
            v = orexpr()
            take(")")
            return v
        if kind == "str":
            take()
            return val[1:-1].replace("''", "'")
        if kind == "num":
            take()
            return int(val)
        if kind == "id":
            take()
            if peek()[1] == "(":
                take("(")
                args = []
                while peek()[1] != ")":
                    args.append(orexpr())
                    if peek()[1] == ",":
                        take(",")
                take(")")
                if val in ("always", "success"):
                    return True
                if val == "startsWith":
                    return str(args[0] or "").lower().startswith(str(args[1] or "").lower())
                if val == "format":
                    return re.sub(r"\{(\d+)\}", lambda m: "" if args[1 + int(m.group(1))] is None else str(args[1 + int(m.group(1))]), args[0])
                raise AssertionError(f"a function this rail cannot evaluate: {val}")
            if val in ("true", "false", "null"):
                return {"true": True, "false": False, "null": None}[val]
            return _lookup(ctx, val)
        raise AssertionError(f"an expression this rail cannot evaluate: {expr!r}")

    def cmp():
        v = primary()
        while peek()[1] in ("==", "!="):
            op = take()[1]
            r = primary()
            v = eq(v, r) if op == "==" else not eq(v, r)
        return v

    def andexpr():
        v = cmp()
        while peek()[1] == "&&":
            take()
            r = cmp()
            v = r if truthy(v) else v
        return v

    def orexpr():
        v = andexpr()
        while peek()[1] == "||":
            take()
            r = andexpr()
            v = v if truthy(v) else r
        return v

    out = orexpr()
    assert i == len(toks), f"trailing tokens in {expr!r}"
    return out


def template(value, ctx: dict):
    """A `with:` / `env:` / name value: every `${{ e }}` replaced by its value (null -> '')."""
    if not isinstance(value, str):
        return value
    return re.sub(r"\$\{\{(.*?)\}\}", lambda m: "" if evaluate(m.group(1), ctx) is None else str(evaluate(m.group(1), ctx)), value)


def ctx(event: str, *, head="agent/pl/x", base="master", fork=False, pr=1700, ref=None, inputs=None, matrix=None):
    gh = {"event_name": event, "repository": REPO, "head_ref": "", "base_ref": "", "ref": ref or "refs/heads/agent/pl/x", "event": {}}
    if event == "pull_request":
        gh.update(head_ref=head, base_ref=base, ref=f"refs/pull/{pr}/merge")
        gh["event"]["pull_request"] = {"number": pr, "head": {"repo": {"full_name": "fork/r" if fork else REPO}}}
    if event == "workflow_dispatch":
        gh.update(ref=ref or "refs/heads/master")
        gh["event"]["inputs"] = inputs if inputs is not None else {"pr": str(pr), "merge_sha": MERGE}
    return {"github": gh, "matrix": matrix or {}, "needs": {}, "inputs": gh["event"].get("inputs", {})}


def _legs(job: dict):
    matrix = (job.get("strategy") or {}).get("matrix") or {}
    if not matrix:
        return [{}]
    (var, values), = matrix.items()
    return [{var: v} for v in values]


def _runs(cond, c) -> bool:
    if cond is None:
        return True
    if isinstance(cond, bool):
        return cond
    return evaluate(str(cond).replace("${{", "").replace("}}", ""), c) not in (None, False, "", 0)


def _event_only(cond) -> bool:
    """A step `if:` that depends on the event (P2 steps), as opposed to the matrix-leg conditions that predate P2."""
    return cond is not None and "github.event_name" in str(cond)


def _job_runs(job, c):
    return _runs(job.get("if"), c)


# ---------------------------------------------------------------------------------------------- evaluator control
def test_the_evaluator_tells_events_apart_and_refuses_what_it_cannot_read():
    assert evaluate("github.event_name == 'push'", ctx("push")) is True
    assert evaluate("github.event_name != 'push'", ctx("push")) is False
    assert evaluate("!startsWith(github.head_ref, 'agent/')", ctx("pull_request")) is False
    assert evaluate("!startsWith(github.head_ref, 'agent/')", ctx("pull_request", head="charts/x")) is True
    assert evaluate("github.event_name != 'push' && 'x' || ''", ctx("push")) == ""
    assert evaluate("github.event_name != 'push' && 'x' || ''", ctx("pull_request")) == "x"
    assert evaluate("format('a-{0}', github.event.pull_request.number)", ctx("pull_request", pr=5)) == "a-5"
    for bad in ("contains(github.ref, 'x')", "github.ref > 1", "fromJSON('[]')"):
        with pytest.raises(AssertionError):
            evaluate(bad, ctx("push"))


# ---------------------------------------------------------------------------------------------- push runs unchanged
def test_push_trigger_is_unchanged():
    assert ON["push"]["branches"] == ["agent/**"]
    assert ON["push"]["paths"] == ON["pull_request"]["paths"]
    assert ON["pull_request"]["branches"] == ["agent/int", "master"]
    assert "types" not in ON["pull_request"], "the default types (opened, synchronize, reopened) are the evidence events"


def test_push_runs_every_job_and_none_of_the_p2_steps():
    c = ctx("push")
    for jid, job in DOC["jobs"].items():
        assert _job_runs(job, c), f"{jid} no longer runs on push"
        for leg in _legs(job):
            lc = dict(c, matrix=leg)
            for step in job.get("steps") or []:
                text = repr(step)
                p2 = "agent_ci_evidence" in text or "agent-ci-evidence" in text or (
                    str(step.get("uses", "")).startswith("actions/checkout@") and jid == "capability-regression")
                if p2:
                    assert _event_only(step.get("if")) and not _runs(step.get("if"), lc), f"{jid}: P2 step runs on push: {step}"


def test_every_value_p2_added_is_empty_on_push():
    c = ctx("push")
    seen = 0
    for jid, job in DOC["jobs"].items():
        for step in job.get("steps") or []:
            if _event_only(step.get("if")) and not _runs(step.get("if"), c):
                continue                      # skipped on push (the rail above): its values never apply
            for k, v in list((step.get("env") or {}).items()) + list((step.get("with") or {}).items()):
                if isinstance(v, str) and ("github.event.inputs" in v or "github.event_name != 'push'" in v):
                    seen += 1
                    assert template(v, c) == "", f"{jid}: {k} = {template(v, c)!r} on push"
    assert seen >= 7, f"only {seen} P2 values found: the rail is not looking at them"   # 4 checkout refs + 2 PYTEST_ADDOPTS + 1 EVIDENCE_VITEST_ARGS


def test_the_one_run_line_p2_touched_has_the_push_argv_it_had():
    job = DOC["jobs"]["capability-regression-clock"]
    step = next(s for s in job["steps"] if "vitest run src/agent/qa/capabilityRegression" in (s.get("run") or ""))
    env = {k: template(v, ctx("push")) for k, v in (step.get("env") or {}).items()}
    argv = re.sub(r"\$(\w+)", lambda m: env.get(m.group(1), m.group(0)), step["run"]).split()
    assert argv == "npx vitest run src/agent/qa/capabilityRegression --reporter=default".split()


def test_push_concurrency_group_is_the_string_it_was():
    conc = DOC["concurrency"]
    assert conc["cancel-in-progress"] is True
    for ref in ("refs/heads/agent/pl/x", "refs/heads/agent/int"):
        assert template(conc["group"], ctx("push", ref=ref)) == f"agent-ci-{ref}"


# ---------------------------------------------------------------------------------------------- the PR evidence run
def _running_jobs(c) -> list[str]:
    names = []
    for jid, job in DOC["jobs"].items():
        if _job_runs(job, c):
            names += acr.required_jobs({"jobs": {jid: job}})
    return names


def test_a_same_repo_agent_pr_into_master_runs_all_13_jobs_and_8_shards():
    names = _running_jobs(ctx("pull_request", head="agent/pl/x", base="master"))
    assert len(names) == 13 and set(names) == set(acr.required_jobs(DOC))
    assert sum(1 for n in names if n.startswith("UCT Agent browser tests (shard ")) == 8
    assert [l["shard"] for l in _legs(DOC["jobs"]["browser"])] == list(range(1, 9)) and DOC["env"]["AGENT_SHARDS"] == "8"


def test_a_rearm_dispatch_runs_all_13_jobs():
    assert len(_running_jobs(ctx("workflow_dispatch"))) == 13


def test_an_agent_pr_into_agent_int_still_skips_and_other_prs_are_unchanged():
    assert _running_jobs(ctx("pull_request", head="agent/pl/x", base="agent/int")) == []
    for c in (ctx("pull_request", head="charts/x", base="agent/int"), ctx("pull_request", head="charts/x", base="master"),
              ctx("pull_request", head="agent/pl/x", base="agent/int", fork=True)):
        assert len(_running_jobs(c)) == 13


def test_evidence_concurrency_is_per_pr_and_shared_with_its_rearm():
    g = DOC["concurrency"]["group"]
    pr7, pr8 = template(g, ctx("pull_request", pr=7)), template(g, ctx("pull_request", pr=8))
    assert pr7 == "agent-ci-pr-7" and pr8 == "agent-ci-pr-8"
    assert template(g, ctx("workflow_dispatch", pr=7)) == pr7          # a re-arm supersedes the same PR's run ...
    assert template(g, ctx("pull_request", pr=7, base="agent/int")) == pr7
    pushes = {template(g, ctx("push", ref=r)) for r in ("refs/heads/agent/pl/x", "refs/heads/master")}
    assert pr7 not in pushes                                           # ... and no push run ever shares its group


# ---------------------------------------------------------------------------------------------- the evidence steps
def test_every_required_job_records_and_uploads_its_evidence():
    keys = ev.required_keys(DOC)
    want = {}
    for jid, job in DOC["jobs"].items():
        for leg in _legs(job):
            name = acr.required_jobs({"jobs": {jid: dict(job, strategy={"matrix": {k: [v] for k, v in leg.items()}})}})
            want[name[0]] = (jid, leg)
    assert set(want) == set(keys) and len(want) == 13
    for job_name, key in keys.items():
        jid, leg = want[job_name]
        job = DOC["jobs"][jid]
        for event in ("pull_request", "workflow_dispatch"):
            c = dict(ctx(event, pr=1700), matrix=leg)
            steps = [s for s in job["steps"] if _runs(s.get("if"), c)]
            rec = [s for s in steps if "tools/agent_ci_evidence.py record" in (s.get("run") or "")]
            up = [s for s in steps if str(s.get("uses", "")).startswith("actions/upload-artifact@")
                  and template((s.get("with") or {}).get("name"), c).startswith(ev.ARTIFACT_PREFIX)]
            assert len(rec) == 1 and len(up) == 1, (job_name, event, len(rec), len(up))
            assert steps.index(rec[0]) < steps.index(up[0]), f"{job_name}: uploads before it records"
            env = {k: template(v, c) for k, v in (rec[0].get("env") or {}).items()}
            env.update({k: template(v, c) for k, v in (job.get("env") or {}).items()})
            run = re.sub(r"\$(\w+)", lambda m: env.get(m.group(1), m.group(0)), rec[0]["run"])
            assert re.search(r'--job-key "?%s"?(\s|$)' % re.escape(key), run), (job_name, run)
            w = up[0]["with"]
            assert template(w["name"], c) == f"{ev.ARTIFACT_PREFIX}1700-{key}", (job_name, template(w["name"], c))
            assert w["path"] == "evidence/evidence.json" and w["if-no-files-found"] == "error"
            for s in (rec[0], up[0]):
                assert "always()" in str(s["if"]), f"{job_name}: a red job must still leave its evidence"


def test_every_checkout_pins_the_dispatched_merge_commit():
    n = 0
    for jid, job in DOC["jobs"].items():
        for step in job.get("steps") or []:
            if not str(step.get("uses", "")).startswith("actions/checkout@"):
                continue
            n += 1
            ref = (step.get("with") or {}).get("ref")
            assert ref is not None, f"{jid}: a checkout that a re-arm would not pin"
            assert template(ref, ctx("workflow_dispatch")) == MERGE
            assert template(ref, ctx("pull_request")) == "" and template(ref, ctx("push")) == ""
    assert n == 5


# ---------------------------------------------------------------------------------------------- self-protection
def test_self_protection_is_intact():
    paths = acr.agent_paths(DOC)
    for f in (".github/workflows/agent-ci.yml", "tools/agent_ci_evidence.py", "tools/agent_ci_rearm.py", "tools/agent_ci_required.py"):
        assert acr.matches(f, paths), f"{f} must run Agent CI when edited"
    req = yaml.safe_load((ROOT / ".github" / "workflows" / "agent-ci-required.yml").read_text(encoding="utf-8"))
    co = req["jobs"]["status"]["steps"][0]
    assert co["with"]["ref"] == "${{ github.event.repository.default_branch }}"   # a PR never edits its own verdict


def test_dispatch_inputs_never_reach_a_shell():
    for jid, job in DOC["jobs"].items():
        for step in job.get("steps") or []:
            assert "inputs." not in (step.get("run") or ""), f"{jid}: an input is interpolated into a shell: {step.get('name')}"
    inputs = ON["workflow_dispatch"]["inputs"]
    assert set(inputs) == {"pr", "merge_sha"} and all(v["required"] for v in inputs.values())
