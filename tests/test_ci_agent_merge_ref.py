"""P2 rails for agent-ci.yml's merge-tree evidence runs (2026-11-17). They EVALUATE the workflow's expressions for each
event (a small evaluator for the GitHub expression subset agent-ci.yml uses; anything else is refused by name):

  * push runs are unchanged: every job still runs, every added step is skipped, every added value is '' on push,
    and the push concurrency group is the exact string it was (`agent-ci-<ref>`);
  * a same-repo agent/** PR into MASTER runs all 18 required jobs (12 browser shards) on its pull_request event, and a
    PR into agent/int still skips them (its evidence stays the push run);
  * the evidence-run concurrency group is per PR, shared by the PR's pull_request run and its re-arm dispatch;
  * every required job (each matrix leg) records and uploads `agent-ci-evidence-pr<N>-<key>`, and every checkout pins
    the dispatched merge commit;
  * the self-protection is intact: agent-ci.yml and the new tools are Agent paths, the payload never reaches a shell,
    and agent-ci-required still runs the default branch's copy.
  * P2d (2026-11-18, AUDIT): every job / leg that runs the capreg baseline pytest first prints ONE line naming the
    merge-base mode, from the real merge_base_mode() (python -c, same env), with no payload and no expression in it.
  * P2c (2026-11-18, AUDIT): the re-arm is `repository_dispatch` type agent-ci-evidence, the ONE re-arm path (the trigger
    set is pinned exactly); client_payload is attacker-controlled: every job validates it FIRST, in bash, through env:,
    and the job reads only that step's outputs; GITHUB_SHA (master's tip there) is never the commit under test; and a
    FAILING dispatch run on master's tip changes no promotion / gate decision.
  * MERGE QUEUE (2026-11-22; inert until a merge queue exists on master): agent-ci-queue.yml (on: merge_group) scopes the
    queued PR's own diff with master's code and CALLS agent-ci.yml for an Agent change; it can write nothing. The
    trusted follower agent-ci-queue-verdict.yml (on: workflow_run, so master's copy, in an environment only master may
    use) recomputes the verdict and posts agent-ci-required with a GitHub App's token (AUDIT F1 on #2501). The trigger
    set of agent-ci.yml gains `workflow_call` (one caller, pinned; `merge_group` itself is not a trigger here); the
    validate step skips on merge_group (no payload: GITHUB_SHA is the commit under test, and every checkout takes its
    default ref); all 18 jobs run, record and upload there; and each of the two workflows' own shape is held by a
    judge (queue_violations, follower_violations) with a mutant for each rule (test_MQ_* at the end of this file).
"""
from __future__ import annotations

import copy
import fnmatch
import os
import pathlib
import re
import shlex
import shutil
import subprocess
import sys

import pytest
import yaml

from tools import agent_ci_evidence as ev
from tools import agent_ci_rearm as rearm
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
    steps = {}
    if event == "repository_dispatch":
        gh.update(ref=ref or "refs/heads/master", sha="a" * 40)   # GITHUB_SHA is master's TIP on a dispatch, never MERGE
        payload = inputs if inputs is not None else {"pr": pr, "merge_sha": MERGE}
        gh["event"].update(action="agent-ci-evidence", client_payload=payload)
        ok = _payload_ok(payload.get("pr"), payload.get("merge_sha"))
        # the validate step's outputs: written only when it passed (a failed step fails the job; nothing reads them)
        steps["payload"] = {"outputs": {"pr": str(payload["pr"]), "merge_sha": payload["merge_sha"]} if ok else {},
                            "outcome": "success" if ok else "failure"}
    return {"github": gh, "matrix": matrix or {}, "needs": {}, "inputs": {}, "steps": steps}


def _payload_ok(pr, merge_sha) -> bool:
    """Python model of the validate step's two bash `[[ =~ ]]` tests (ERE, whole-string anchors, no REG_NEWLINE)."""
    return bool(re.fullmatch(r"[1-9][0-9]{0,6}", str(pr))) and type(pr) in (int, str) and \
        bool(re.fullmatch(r"[0-9a-f]{40}", str(merge_sha))) and isinstance(merge_sha, str)


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
                if isinstance(v, str) and ("steps.payload.outputs" in v or "github.event_name != 'push'" in v):
                    seen += 1
                    assert template(v, c) == "", f"{jid}: {k} = {template(v, c)!r} on push"
    # exactly 4 checkout refs + 2 PYTEST_ADDOPTS (EVIDENCE_VITEST_ARGS is gone 2026-11-17: an rth leg writes its json on
    # every event, because the join job's union rail reads it)
    assert seen == 6, f"{seen} P2 values found, want 6: the rail is not looking at them, or a P2 value was added unreviewed"


def test_the_one_run_line_p2_touched_has_the_push_argv_it_had():
    job = DOC["jobs"]["capability-regression-clock"]
    steps = [s for s in job["steps"] if "vitest run " in (s.get("run") or "")]
    assert len(steps) == 1, steps
    step = steps[0]
    # 2026-11-17 (rth legs): the step's only env is the leg name; nothing in it depends on the event
    assert step.get("env") == {"LEG": "${{ matrix.clock }}"}, step.get("env")
    assert not any("github.event" in str(v) or "steps.payload" in str(v) for v in step["env"].values())
    last = step["run"].strip().splitlines()[-1].strip()
    assert last == ('npx vitest run $(cat "../capreg-$LEG.files") --reporter=default --reporter=json '
                    '--outputFile="../capreg-$LEG.json"'), last


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


def test_a_same_repo_agent_pr_into_master_runs_all_18_jobs_and_12_shards():
    names = _running_jobs(ctx("pull_request", head="agent/pl/x", base="master"))
    assert len(names) == 18 and set(names) == set(acr.required_jobs(DOC))
    assert sum(1 for n in names if n.startswith("UCT Agent browser tests (shard ")) == 12
    assert [l["shard"] for l in _legs(DOC["jobs"]["browser"])] == list(range(1, 13)) and DOC["env"]["AGENT_SHARDS"] == "12"
    assert [l["clock"] for l in _legs(DOC["jobs"]["capability-regression-clock"])] == ["post", "rth-1", "rth-2"]


def test_a_rearm_dispatch_runs_all_18_jobs():
    names = _running_jobs(ctx("repository_dispatch"))
    assert len(names) == 18 and set(names) == set(acr.required_jobs(DOC))
    assert _running_jobs(ctx("workflow_dispatch")) == [] or "workflow_dispatch" not in ON   # not a trigger at all


def test_an_agent_pr_into_agent_int_still_skips_and_other_prs_are_unchanged():
    assert _running_jobs(ctx("pull_request", head="agent/pl/x", base="agent/int")) == []
    for c in (ctx("pull_request", head="charts/x", base="agent/int"), ctx("pull_request", head="charts/x", base="master"),
              ctx("pull_request", head="agent/pl/x", base="agent/int", fork=True)):
        names = _running_jobs(c)
        assert len(names) == 18 and set(names) == set(acr.required_jobs(DOC))


def test_evidence_concurrency_is_per_pr_and_shared_with_its_rearm():
    g = DOC["concurrency"]["group"]
    pr7, pr8 = template(g, ctx("pull_request", pr=7)), template(g, ctx("pull_request", pr=8))
    assert pr7 == "agent-ci-pr-7" and pr8 == "agent-ci-pr-8"
    assert template(g, ctx("repository_dispatch", pr=7)) == pr7        # a re-arm supersedes the same PR's run ...
    assert template(g, ctx("repository_dispatch", pr=8)) == pr8 != pr7
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
    assert set(want) == set(keys) and len(want) == 18
    for job_name, key in keys.items():
        jid, leg = want[job_name]
        job = DOC["jobs"][jid]
        # 2026-11-22: + the merge-queue call (agent-ci-queue.yml), whose PR number is the caller's validated input
        for event, c0 in (("pull_request", ctx("pull_request", pr=1700)), ("repository_dispatch", ctx("repository_dispatch", pr=1700)),
                          ("merge_group", _queue_ctx(pr=1700))):
            c = dict(c0, matrix=leg)
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
            assert ref == "${{ steps.payload.outputs.merge_sha }}", f"{jid}: a checkout ref not taken from the validated payload"
            assert template(ref, ctx("repository_dispatch")) == MERGE
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


def _all_steps():
    for jid, job in DOC["jobs"].items():
        for i, step in enumerate(job.get("steps") or []):
            yield jid, i, step


def test_the_payload_never_reaches_a_shell():
    """AUDIT #1: no `run:` names client_payload or inputs.* (the payload reaches bash only as $EVIDENCE_* env)."""
    n = 0
    for jid, i, step in _all_steps():
        run = step.get("run") or ""
        n += bool(run)
        assert "client_payload" not in run and "inputs." not in run, f"{jid} step {i}: the payload is interpolated into a shell"
        assert "github.event.inputs" not in repr(step), f"{jid} step {i}: a workflow_dispatch input survives"
    assert n >= 20, f"only {n} run: steps seen: the rail is not looking at them"


def test_client_payload_appears_only_in_the_validate_env_and_the_concurrency_group():
    """AUDIT #1: everything else reads the VALIDATED step outputs (steps.payload.outputs.*), never the raw payload."""
    hits = []
    for jid, i, step in _all_steps():
        for k, v in (step.get("env") or {}).items():
            if "client_payload" in str(v):
                hits.append((jid, i, k))
        rest = {k: v for k, v in step.items() if k != "env"}
        assert "client_payload" not in repr(rest), f"{jid} step {i}: the raw payload is read outside the validate step's env"
    for jid, job in DOC["jobs"].items():
        assert "client_payload" not in repr({k: v for k, v in job.items() if k != "steps"}), f"{jid}: the raw payload in a job key"
    assert sorted(hits) == sorted((jid, 0, k) for jid in DOC["jobs"] for k in ("EVIDENCE_PR", "EVIDENCE_MERGE_SHA")), hits
    lines = [ln for ln in WF.read_text(encoding="utf-8").splitlines() if "client_payload" in ln and not ln.lstrip().startswith("#")]
    assert len(lines) == 1 + 2 * len(DOC["jobs"]), lines   # the group + 2 env lines per job, and nothing else
    assert "client_payload" not in repr(DOC.get("env")) and "client_payload" in DOC["concurrency"]["group"]


VALIDATE_RUN = (
    '[[ "$EVIDENCE_PR" =~ ^[1-9][0-9]{0,6}$ ]] || { echo "::error::the re-arm pr is not a PR number"; exit 1; }\n'
    '[[ "$EVIDENCE_MERGE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "::error::the re-arm merge_sha is not a 40-hex commit"; exit 1; }\n'
    '{ echo "pr=$EVIDENCE_PR"; echo "merge_sha=$EVIDENCE_MERGE_SHA"; } >> "$GITHUB_OUTPUT"\n')
# 2026-11-22: + merge_group. A merge-queue call (agent-ci-queue.yml) carries no payload to validate: its GITHUB_SHA is
# the commit under test and the default checkout takes it. Every OTHER event, known or not, must still carry a valid one.
VALIDATE_IF = "github.event_name != 'push' && github.event_name != 'pull_request' && github.event_name != 'merge_group'"


def test_every_job_validates_the_payload_first():
    """AUDIT #1: the FIRST step of every job is the one validate step: bash, payload only through env:, fail closed on
    any event but push / pull_request / merge_group, and its outputs are the only payload values the job reads."""
    assert len(DOC["jobs"]) == 5
    for jid, job in DOC["jobs"].items():
        first = (job.get("steps") or [{}])[0]
        assert first.get("id") == "payload" and first.get("name") == "Validate the re-arm payload", jid
        assert first.get("if") == VALIDATE_IF and first.get("shell") == "bash", jid
        assert first.get("env") == {"EVIDENCE_PR": "${{ github.event.client_payload.pr }}",
                                    "EVIDENCE_MERGE_SHA": "${{ github.event.client_payload.merge_sha }}"}, jid
        assert first.get("run") == VALIDATE_RUN, jid
        assert set(first) == {"name", "id", "if", "shell", "env", "run"}, jid   # no continue-on-error, no uses:
        assert sum(1 for s in job["steps"] if s.get("id") == "payload") == 1, jid
        reads = [i for i, s in enumerate(job["steps"]) if "steps.payload.outputs" in repr(s)]
        assert reads and min(reads) > 0, jid
    # it is skipped on push / pull_request / merge_group (they carry no payload) and runs on every other event, known or not
    for event, runs in (("push", False), ("pull_request", False), ("merge_group", False), ("repository_dispatch", True),
                        ("workflow_dispatch", True), ("workflow_call", True), ("schedule", True), ("some_future_event", True)):
        assert _runs(VALIDATE_IF, ctx(event)) is runs, event


def _real_bash():
    """A POSIX bash to run the step with (Git's on Windows; never System32's WSL launcher), or None."""
    if sys.platform == "win32":
        git = shutil.which("git")
        cand = [d / "bin" / "bash.exe" for d in pathlib.Path(git).resolve().parents] if git else []
        return next((str(c) for c in cand if c.is_file()), None)
    return shutil.which("bash")


GOOD_PAYLOADS = [("1700", MERGE), ("1", "0" * 40), ("9999999", "0123456789abcdef0123456789abcdef01234567")]
BAD_PAYLOADS = [
    ("1700\n1", MERGE), ("1\n$(id)", MERGE), ("$(id)", MERGE), ("`id`", MERGE), ("1700;id", MERGE), ("1700 ", MERGE),
    (" 1700", MERGE), ("01700", MERGE), ("0", MERGE), ("-1", MERGE), ("1e3", MERGE), ("12345678", MERGE), ("", MERGE),
    ("１７００", MERGE), ("1700", MERGE.upper()), ("1700", MERGE[:39]), ("1700", MERGE + "d"), ("1700", MERGE + "\n"),
    ("1700", "\n" + MERGE), ("1700", MERGE[:20] + "\n" + MERGE[20:]), ("1700", "$(id)"), ("1700", ""),
    ("1700", "refs/heads/master"), ("1700", "g" * 40), ("1700", MERGE + "\nmerge_sha=" + "e" * 40),
]


@pytest.mark.parametrize("pr,sha", GOOD_PAYLOADS + BAD_PAYLOADS)
def test_the_validate_step_in_bash_fails_closed_on_hostile_payloads(pr, sha, tmp_path):
    """AUDIT #1: the step itself, executed by bash the way Actions runs `shell: bash` (--noprofile --norc -eo pipefail)."""
    ok = (pr, sha) in GOOD_PAYLOADS
    assert _payload_ok(pr, sha) is ok, "the python model the evaluator uses disagrees with the intent"
    bash = _real_bash()
    if not bash:
        pytest.skip("no POSIX bash here")
    script, out = tmp_path / "step.sh", tmp_path / "out.txt"
    script.write_bytes(VALIDATE_RUN.encode())
    env = dict(os.environ, EVIDENCE_PR=pr, EVIDENCE_MERGE_SHA=sha, GITHUB_OUTPUT=str(out))
    p = subprocess.run([bash, "--noprofile", "--norc", "-eo", "pipefail", str(script)], env=env, capture_output=True, text=True,
                       cwd=tmp_path, timeout=60)
    written = out.read_text(encoding="utf-8") if out.exists() else ""
    if ok:
        assert p.returncode == 0 and written == f"pr={pr}\nmerge_sha={sha}\n", (p.returncode, p.stdout, p.stderr, written)
    else:
        assert p.returncode != 0 and written == "" and "::error::" in p.stdout, (repr(pr), repr(sha), p.returncode, written)
    assert not (tmp_path / "x").exists()


def test_an_invalid_payload_is_never_checked_out_or_named():
    for pr, sha in BAD_PAYLOADS:
        c = ctx("repository_dispatch", inputs={"pr": pr, "merge_sha": sha})
        for jid, i, step in _all_steps():
            for v in list((step.get("with") or {}).values()):
                got = template(v, c)
                assert sha not in str(got) or not sha, (jid, i, got)
                if isinstance(v, str) and "steps.payload.outputs.pr" in v:
                    assert pr not in str(got).replace(ev.ARTIFACT_PREFIX, "") or not pr, (jid, i, got)


def test_P2c_the_trigger_set_is_exactly_push_pr_and_one_dispatch_type():
    """AUDIT #6: ONE re-arm path. workflow_dispatch is gone (trigger and verify), and repository_dispatch takes exactly
    one event_type, the one tools/agent_ci_rearm.py sends and tools/agent_ci_evidence.py records."""
    # 2026-11-22: + workflow_call, for ONE caller (agent-ci-queue.yml on merge_group; test_MQ_* below). It is not a
    # re-arm path and adds no event: a called run carries its caller's event, and `merge_group` is NOT a trigger here.
    assert set(ON) == {"push", "pull_request", "repository_dispatch", "workflow_call"}, sorted(ON)
    assert ON["repository_dispatch"] == {"types": ["agent-ci-evidence"]}
    assert rearm.EVENT_TYPE == ev.DISPATCH_TYPE == ON["repository_dispatch"]["types"][0] == "agent-ci-evidence"
    assert ev.DISPATCH_EVENT == "repository_dispatch" and ev.PR_EVENT == "pull_request"
    assert set(ON["push"]) == {"branches", "paths"} and set(ON["pull_request"]) == {"branches", "paths"}
    text = WF.read_text(encoding="utf-8")
    assert not [ln for ln in text.splitlines() if "workflow_dispatch" in ln and not ln.lstrip().startswith("#")]


def test_P2c_no_other_workflow_listens_for_repository_dispatch():
    """A repository_dispatch fires EVERY workflow that declares the trigger (type-filtered): the re-arm must start agent ci
    and nothing else, so no other workflow may declare it."""
    for f in sorted((ROOT / ".github" / "workflows").glob("*.y*ml")):
        doc = yaml.safe_load(f.read_text(encoding="utf-8"))
        on = doc.get("on", doc.get(True))
        names = set(on) if isinstance(on, (dict, list)) else {on}
        if f.name != "agent-ci.yml":
            assert "repository_dispatch" not in names, f"{f.name} would also fire on the re-arm"


def test_P2c_nothing_in_agent_ci_reads_github_sha():
    """AUDIT #2: on a repository_dispatch, GITHUB_SHA / github.sha is master's TIP, not the commit under test. No
    artifact name, cache key, env or step in agent-ci.yml may use it; the record takes `git rev-parse HEAD`."""
    for jid, i, step in _all_steps():
        s = repr(step)
        assert "github.sha" not in s and "GITHUB_SHA" not in s, (jid, i)
    assert "github.sha" not in repr(DOC.get("env")) and "github.sha" not in DOC["concurrency"]["group"]
    # the shard-timings cache key comes from the CHECKED-OUT commit's date (git log -1 after checkout), not GITHUB_SHA
    tweek = next(s for s in DOC["jobs"]["browser"]["steps"] if s.get("id") == "tweek")
    assert "git log -1" in tweek["run"]
    steps = DOC["jobs"]["browser"]["steps"]
    co = next(i for i, s in enumerate(steps) if str(s.get("uses", "")).startswith("actions/checkout@"))
    assert co < steps.index(tweek)


# ---------------------------------------------------------------------------------------------- AUDIT #3: promotion
TIP = "a" * 40


def _dispatch_run(conclusion="failure", status="completed"):
    return {"id": 991, "name": "agent ci", "path": ".github/workflows/agent-ci.yml", "head_sha": TIP, "head_branch": "master",
            "event": "repository_dispatch", "status": status, "conclusion": conclusion, "created_at": "2026-11-18T10:00:00Z"}


@pytest.mark.parametrize("bad", [_dispatch_run(), _dispatch_run("cancelled"), _dispatch_run(None, "in_progress"),
                                 _dispatch_run("timed_out")])
def test_P2c_a_failing_dispatch_run_on_masters_tip_changes_no_promotion_or_gate_decision(bad):
    """AUDIT #3: a repository_dispatch agent ci run sits on master's TIP sha (its check suite lands there). Every reader
    of runs / statuses for that sha must answer exactly as without it."""
    from tools import promote_decision as pd
    from tools import promotion_gate as pg
    gating_map, unclassified = pg.read_workflow_dir(str(ROOT))
    assert not unclassified and gating_map.get("agent ci") == "no"             # agent ci never gates promotion
    gating = sorted(n for n, v in gating_map.items() if v == "yes")
    works = [{"name": n, "state": "active"} for n in gating_map]
    gate_ok = {"id": 1, "name": pg.ALWAYS_RUNS, "head_sha": TIP, "head_branch": "master", "event": "push",
               "status": "completed", "conclusion": "success", "created_at": "2026-11-18T09:00:00Z"}
    for base in ([gate_ok], [dict(gate_ok, conclusion="failure")], [dict(gate_ok, status="in_progress", conclusion=None)]):
        assert pg.decide(gating=gating, runs=base + [bad], workflows=works) == pg.decide(gating=gating, runs=base, workflows=works)
    # even if agent ci WERE gating, a repository_dispatch run is not a counted master event
    assert "repository_dispatch" not in pg.COUNTED_EVENTS
    both = sorted({*gating, "agent ci"})
    assert pg.decide(gating=both, runs=[gate_ok, bad], workflows=works)[0] == pg.decide(gating=both, runs=[gate_ok], workflows=works)[0]
    # promote_decision.gate_ok: the master deploy gate's own push run for the sha, nothing else
    jobs = [{"run_id": 1, "conclusion": "success"}]
    bad_jobs = [{"run_id": 991, "conclusion": "failure"}]
    assert pd.gate_ok([gate_ok, bad], jobs + bad_jobs, 1, TIP) == pd.gate_ok([gate_ok], jobs, 1, TIP)
    assert pd.gate_ok([gate_ok, bad], jobs + bad_jobs, 1, TIP)[0] is True
    assert pd.gate_ok([dict(bad, name=pd.GATE_WORKFLOW_NAME, conclusion="success")], [{"run_id": 991, "conclusion": "success"}], 1, TIP)[0] is False


class _ReqApi:
    def __init__(self, runs):
        self.runs = runs

    def get(self, path):
        if "/runs?" in path:
            return {"workflow_runs": self.runs}
        if "/jobs?" in path:
            return {"jobs": [{"name": n, "conclusion": "success"} for n in acr.required_jobs(DOC)]}
        if path.startswith("commits/"):
            return []
        raise AssertionError(path)


def test_P2c_agent_ci_required_never_counts_a_dispatch_run():
    """agent-ci-required.yml re-evaluates the head_sha of EVERY completed agent ci run (workflow_run), so a dispatch run
    makes it post a status on master's tip. Its verdict reads only the PUSH (/ pull_request) run of that sha, so the
    dispatch run's own conclusion can never turn it green or red."""
    assert "repository_dispatch" not in acr.RUN_EVENTS
    with pytest.raises(ValueError):
        acr.run_for(_ReqApi([]), TIP, "repository_dispatch")
    for concl in ("success", "failure"):
        assert acr.run_for(_ReqApi([_dispatch_run(concl)]), TIP, "push") is None
        assert acr.evaluate(_ReqApi([_dispatch_run(concl)]), TIP, [], DOC) == acr.evaluate(_ReqApi([]), TIP, [], DOC)
    req = yaml.safe_load((ROOT / ".github" / "workflows" / "agent-ci-required.yml").read_text(encoding="utf-8"))
    assert req["jobs"]["status"]["steps"][0]["with"]["ref"] == "${{ github.event.repository.default_branch }}"


def test_P2c_only_agent_ci_required_watches_agent_ci_and_promotion_watches_only_the_gate():
    watchers = {}
    for f in sorted((ROOT / ".github" / "workflows").glob("*.y*ml")):
        doc = yaml.safe_load(f.read_text(encoding="utf-8"))
        on = doc.get("on", doc.get(True))
        wr = (on or {}).get("workflow_run") if isinstance(on, dict) else None
        if wr:
            watchers[f.name] = wr.get("workflows")
    assert watchers.get("promote-production.yml") == ["master deploy gate"]
    assert [n for n, w in watchers.items() if "agent ci" in (w or [])] == ["agent-ci-required.yml"]


# ---------------------------------------------------------------------------------------------- self-protection (P2c)
def test_dispatch_inputs_never_reach_a_shell():
    for jid, job in DOC["jobs"].items():
        for step in job.get("steps") or []:
            assert "inputs." not in (step.get("run") or ""), f"{jid}: an input is interpolated into a shell: {step.get('name')}"
    assert "workflow_dispatch" not in ON


# ---------------------------------------------------------------------------------------------- P2d: the mode line
CAPREG_TEST = "tests/test_uct_agent_capreg_baseline.py"
MODE_LINE = re.compile(r"^merge_base_mode=(strict|lenient|skip-master) event=(\S*) head=([0-9a-f]{40}|) origin_master=([0-9a-f]{40}|)$")


def _runs_capreg_pytest(step) -> bool:
    run = step.get("run") or ""
    return "pytest" in run and any(fnmatch.fnmatchcase(CAPREG_TEST, w) for w in run.split() if w.startswith("tests/"))


def _is_mode_print(step) -> bool:
    return "merge_base_mode" in (step.get("run") or "") or step.get("name") == "Print the capreg merge-base mode"


def _mode_code(run: str):
    m = re.search(r"python -c '\n(.*?)\n'", run, re.S)
    return m.group(1) if m else None


def mode_print_violations(doc) -> list[str]:
    """Every leg of every job whose capreg-baseline pytest step runs (for any event) runs the mode print step BEFORE it,
    and that step calls the real merge_base_mode() through python -c with no payload and no `${{` in its shell."""
    bad, legs_seen = [], 0
    for jid, job in doc["jobs"].items():
        steps = job.get("steps") or []
        for leg in _legs(job):
            for event in ("push", "pull_request", "repository_dispatch", "merge_group"):
                c = ctx(event, matrix=leg)
                if not _job_runs(job, c):
                    continue
                live = [(i, s) for i, s in enumerate(steps) if _runs(s.get("if"), c)]
                for i, s in live:
                    if not _runs_capreg_pytest(s):
                        continue
                    legs_seen += 1
                    prints = [j for j, p in live if _is_mode_print(p)]
                    if not prints:
                        bad.append(f"{jid} {leg} {event}: no mode print step before the capreg pytest")
                    elif not any(j < i for j in prints):
                        bad.append(f"{jid} {leg} {event}: the mode print step comes after the capreg pytest")
    for jid, job in doc["jobs"].items():
        for s in job.get("steps") or []:
            if not _is_mode_print(s):
                continue
            run = s.get("run") or ""
            code = _mode_code(run)
            if code is None or not run.lstrip().startswith("python -c"):
                bad.append(f"{jid}: the mode print is not a python -c call")
                continue
            if "client_payload" in repr(s) or "${{" in run:
                bad.append(f"{jid}: the mode print reads the payload or an expression")
            if CAPREG_TEST not in code or "exec_module" not in code or not re.search(r"\bm\.merge_base_mode\(\)", code):
                bad.append(f"{jid}: the mode print does not call the real merge_base_mode()")
            if re.search(r"merge_base_mode=(strict|lenient|skip-master)", code):
                bad.append(f"{jid}: the mode print hard-codes a mode")
    if legs_seen < 2:
        bad.append(f"only {legs_seen} capreg pytest legs seen: the rail is not looking at them")
    return bad


def test_P2d_every_capreg_pytest_leg_prints_the_merge_base_mode_first():
    assert mode_print_violations(DOC) == []
    # the two places agent-ci runs the baseline rail: the server job's tests/test_uct_agent*.py and the capreg post leg
    jobs = {jid for jid, job in DOC["jobs"].items() if any(_runs_capreg_pytest(s) for s in job.get("steps") or [])}
    assert jobs == {"server", "capability-regression-clock"}, jobs


def _mutants():
    def drop(doc, jid):
        doc["jobs"][jid]["steps"] = [s for s in doc["jobs"][jid]["steps"] if not _is_mode_print(s)]

    def after(doc, jid):
        st = doc["jobs"][jid]["steps"]
        i = next(k for k, s in enumerate(st) if _is_mode_print(s))
        p = st.pop(i)
        j = next(k for k, s in enumerate(st) if _runs_capreg_pytest(s))
        st.insert(j + 1, p)

    def hard(doc, jid):
        s = next(s for s in doc["jobs"][jid]["steps"] if _is_mode_print(s))
        s["run"] = "python -c '\nprint(\"merge_base_mode=strict event=x head= origin_master=\")\n'\n"

    def payload(doc, jid):
        s = next(s for s in doc["jobs"][jid]["steps"] if _is_mode_print(s))
        s["run"] = s["run"].replace('os.environ.get("GITHUB_EVENT_NAME", "")', '"${{ github.event.client_payload.pr }}"')

    def wrong_leg(doc, jid):        # the print is skipped in a leg / event where the capreg pytest still runs
        s = next(s for s in doc["jobs"][jid]["steps"] if _is_mode_print(s))
        s["if"] = "matrix.clock == 'rth'" if jid == "capability-regression-clock" else "github.event_name == 'push'"
    return [drop, after, hard, payload, wrong_leg]


@pytest.mark.parametrize("jid", ["server", "capability-regression-clock"])
@pytest.mark.parametrize("mutate", _mutants(), ids=lambda f: f.__name__)
def test_P2d_the_mode_print_rail_catches_each_mutant(mutate, jid):
    doc = copy.deepcopy(DOC)
    mutate(doc, jid)
    assert mode_print_violations(doc), f"{mutate.__name__} on {jid} went unnoticed"


def test_P2d_the_mode_print_runs_and_names_the_real_mode():
    """Run the step's own python -c here, in this checkout, for a dispatch and a PR environment: it prints exactly one
    line, and the mode it prints is the one merge_base_mode() computes for that same environment."""
    from tests import test_uct_agent_capreg_baseline as cb
    step = next(s for s in DOC["jobs"]["capability-regression-clock"]["steps"] if _is_mode_print(s))
    code = _mode_code(step["run"])
    base = {k: v for k, v in os.environ.items() if not k.startswith("GITHUB_")}
    for event, ref in (("repository_dispatch", "refs/heads/master"), ("pull_request", "refs/pull/1700/merge")):
        env = dict(base, GITHUB_EVENT_NAME=event, GITHUB_REF=ref)
        out = subprocess.run([sys.executable, "-c", code], cwd=ROOT, env=env, capture_output=True, text=True, timeout=120)
        assert out.returncode == 0, out.stderr
        lines = out.stdout.splitlines()
        assert len(lines) == 1 and MODE_LINE.match(lines[0]), out.stdout
        m = MODE_LINE.match(lines[0])
        assert m.group(1) == cb.merge_base_mode({"GITHUB_EVENT_NAME": event, "GITHUB_REF": ref}), lines[0]
        assert m.group(2) == event and m.group(3) == (cb._git("rev-parse", "HEAD") or "").strip()


# ---------------------------------------------------------------------------------------------- merge queue (2026-11-22)
# INERT until a merge queue exists on master. agent-ci-queue.yml (on: merge_group) scopes the queued PR's own diff with
# master's code, CALLS agent-ci.yml for an Agent change, and posts agent-ci-required on the merge group's commit.
QWF = ROOT / ".github" / "workflows" / "agent-ci-queue.yml"
QDOC = yaml.safe_load(QWF.read_text(encoding="utf-8"))
QUEUE_BASE = "b" * 40


def _queue_ref(pr=1700) -> str:
    return f"refs/heads/gh-readonly-queue/master/pr-{pr}-" + "9" * 40


def _queue_ctx(pr=1700, matrix=None, needs=None):
    """agent-ci.yml as agent-ci-queue.yml calls it. `github` is the CALLER's context: the event is merge_group and the
    sha is the merge group's commit (the commit under test). `inputs.pr` is the scope job's validated number, and no
    payload step ran, so `steps.payload.outputs.*` is empty."""
    c = ctx("merge_group", ref=_queue_ref(pr), matrix=matrix)
    c["github"].update(sha=MERGE, run_id="55")
    c["github"]["event"]["merge_group"] = {"head_sha": MERGE, "base_sha": QUEUE_BASE, "head_ref": _queue_ref(pr)}
    c["inputs"] = {"pr": str(pr)}
    c["needs"] = needs or {}
    return c


def test_MQ_agent_ci_is_callable_by_one_workflow_and_never_listens_for_merge_group_itself():
    """A merge_group trigger takes no `paths:` filter, so agent-ci.yml listening itself would run all 18 jobs for every
    queued PR, and agent-ci-required.yml (it watches every completed "agent ci" run) would then post `pending` on the
    merge group's commit, over the queue's verdict. It is CALLED instead, by exactly one workflow, after its scope job."""
    assert "merge_group" not in ON
    assert ON["workflow_call"]["inputs"].keys() == {"pr"}
    pr = ON["workflow_call"]["inputs"]["pr"]
    assert (pr["type"], pr["required"], pr["default"]) == ("string", False, "") and pr["description"].strip()
    callers = []
    for f in sorted((ROOT / ".github" / "workflows").glob("*.y*ml")):
        doc = yaml.safe_load(f.read_text(encoding="utf-8"))
        for jid, job in (doc.get("jobs") or {}).items():
            if "uses" in job:
                callers.append((f.name, jid, job["uses"]))
    assert callers == [("agent-ci-queue.yml", acr.QUEUE_CALL_JOB, "./.github/workflows/agent-ci.yml")], callers
    assert acr.QUEUE_WORKFLOW.as_posix() == ".github/workflows/agent-ci-queue.yml" and (ROOT / acr.QUEUE_WORKFLOW).is_file()


def test_MQ_a_merge_group_call_runs_all_18_jobs_on_the_default_checkout_with_no_payload_step():
    names = _running_jobs(_queue_ctx())
    assert len(names) == 18 and set(names) == set(acr.required_jobs(DOC))
    # ... and each job NAMES the event, as it names repository_dispatch: it is not left to how GitHub compares the
    # pull_request a merge group does not have (`head.repo.full_name != github.repository`) to a string
    for jid, job in DOC["jobs"].items():
        assert "|| github.event_name == 'merge_group'" in str(job["if"]), jid
    checkouts = payload_steps = junit = 0
    for jid, job in DOC["jobs"].items():
        for leg in _legs(job):
            c = _queue_ctx(matrix=leg)
            for step in job["steps"]:
                if step.get("id") == "payload":
                    payload_steps += 1
                    assert not _runs(step.get("if"), c), f"{jid}: the re-arm payload step would run (and fail) in a merge group"
                if str(step.get("uses", "")).startswith("actions/checkout@") and _runs(step.get("if"), c):
                    checkouts += 1
                    assert template(step["with"]["ref"], c) == "", f"{jid}: a merge-group checkout that is not the default ref"
                for k, v in (step.get("env") or {}).items():
                    if k == "PYTEST_ADDOPTS":
                        junit += 1
                        assert template(v, c) == "--junitxml=evidence-pytest.xml", (jid, template(v, c))
    # 18 legs each skip the payload step; 12 + 3 + 1 + 1 + 1 checkouts; the server job and 3 capreg legs carry the junit flag
    assert (payload_steps, checkouts, junit) == (18, 18, 4), (payload_steps, checkouts, junit)
    # control: the same walk on a re-arm dispatch DOES run the payload step and pins the dispatched commit
    d = ctx("repository_dispatch")
    assert _runs(DOC["jobs"]["server"]["steps"][0].get("if"), d)
    assert template(DOC["jobs"]["server"]["steps"][1]["with"]["ref"], d) == MERGE


def test_MQ_the_input_names_only_the_evidence_artifacts_and_is_empty_on_every_other_event():
    hits = []
    for jid, i, step in _all_steps():
        for k, v in list((step.get("with") or {}).items()) + list((step.get("env") or {}).items()):
            if "inputs." in str(v):
                hits.append((jid, k))
                assert k == "name" and str(step.get("uses", "")).startswith("actions/upload-artifact@"), (jid, i, k)
                assert v.startswith(ev.ARTIFACT_PREFIX + "${{ github.event.pull_request.number || steps.payload.outputs.pr || inputs.pr }}-"), v
                # a pull_request and a re-arm name the artifact as before, whatever `inputs` held
                for event in ("pull_request", "repository_dispatch"):
                    c = dict(ctx(event, pr=1700), inputs={"pr": "4242"})
                    assert template(v, c).startswith(ev.ARTIFACT_PREFIX + "1700-"), (jid, event, template(v, c))
        assert "inputs." not in repr({k: v for k, v in step.items() if k not in ("with", "env")}), (jid, i)
    assert sorted(hits) == sorted((jid, "name") for jid in DOC["jobs"]), hits
    for jid, job in DOC["jobs"].items():
        assert "inputs." not in repr({k: v for k, v in job.items() if k != "steps"}), jid
    assert "inputs." not in DOC["concurrency"]["group"] and "inputs." not in repr(DOC.get("env"))


def test_MQ_a_merge_group_call_has_its_own_concurrency_group_and_the_caller_has_none():
    g = DOC["concurrency"]["group"]
    mine = template(g, _queue_ctx(pr=7))
    assert mine == "agent-ci-" + _queue_ref(7)
    assert mine != template(g, _queue_ctx(pr=8))
    assert mine not in {template(g, ctx("pull_request", pr=7)), template(g, ctx("repository_dispatch", pr=7)),
                        template(g, ctx("push", ref="refs/heads/master")), template(g, ctx("push"))}
    # a group shared by the caller and the called workflow deadlocks the call: the caller declares none at all
    assert "concurrency" not in QDOC and not [j for j, job in QDOC["jobs"].items() if "concurrency" in job]


# ---- the queue workflow's own shape: it runs the Agent jobs and can write NOTHING -------------------------------------
QUEUE_SCOPE_ENV = {
    "HEAD_SHA": "${{ github.event.merge_group.head_sha }}",
    "BASE_SHA": "${{ github.event.merge_group.base_sha }}",
    "HEAD_REF": "${{ github.event.merge_group.head_ref }}",
}
DEFAULT_BRANCH = "${{ github.event.repository.default_branch }}"
WF_DIR_ALL = ROOT / ".github" / "workflows"


def _tool_step(job: dict):
    steps = [s for s in job.get("steps") or [] if "tools/agent_ci_required.py" in (s.get("run") or "")]
    return steps[0] if len(steps) == 1 else None


def _writers(doc) -> list[str]:
    """Every place a workflow document grants its token more than read: 'workflow' and / or job ids."""
    out = ["workflow"] if any(v != "read" for v in (doc.get("permissions") or {}).values()) or doc.get("permissions") in ("write-all",) else []
    for jid, job in (doc.get("jobs") or {}).items():
        perms = job.get("permissions")
        if perms in ("write-all",) or (isinstance(perms, dict) and any(v != "read" for v in perms.values())):
            out.append(jid)
    return out


def queue_violations(doc) -> list[str]:
    """Every rule agent-ci-queue.yml must keep, as a list of what is broken (empty = it holds)."""
    bad = []
    on = doc.get("on", doc.get(True))
    if not isinstance(on, dict) or set(on) != {"merge_group"} or on["merge_group"]:
        bad.append("the only trigger is a bare merge_group")
    if doc.get("permissions") != {"contents": "read"}:
        bad.append("the workflow's default token is contents: read")
    jobs = doc.get("jobs") or {}
    if list(jobs) != ["scope", "agent"]:
        return bad + [f"the jobs are scope and agent, and nothing else (got {list(jobs)}): the verdict is the follower's"]
    scope, agent = jobs["scope"], jobs["agent"]
    if "concurrency" in doc or any("concurrency" in j for j in jobs.values()):
        bad.append("no concurrency group (one shared with the called workflow deadlocks the call)")
    # ---- NOTHING in here can write, and no token or secret is handed to a step (AUDIT F1)
    if _writers(doc):
        bad.append(f"no job of the merge-group workflow may write anything (writers: {_writers(doc)})")
    if any("permissions" in j for j in jobs.values()):
        bad.append("no job overrides the read-only default token")
    flat = repr(doc)
    if "secrets." in flat or "GITHUB_TOKEN" in flat or "statuses" in flat or "environment" in flat:
        bad.append("the merge-group workflow names no secret, no token, no status and no environment")
    # ---- scope: first, unconditional
    if {"needs", "if"} & set(scope):
        bad.append("scope runs first, unconditionally")
    if scope.get("outputs") != {k: "${{ steps.scope.outputs.%s }}" % k for k in ("code", "pr", "detail")}:
        bad.append("scope's outputs are code / pr / detail from its tool step")
    st = _tool_step(scope)
    if st is None or st.get("id") != "scope" or st.get("env") != QUEUE_SCOPE_ENV:
        bad.append("scope's tool step is `id: scope` and reads the event only through its three env values")
    t = scope.get("timeout-minutes")
    if not (isinstance(t, int) and 0 < t <= 10):
        bad.append(f"scope: timeout-minutes is {t!r}")
    steps = scope.get("steps") or []
    co = [s for s in steps if str(s.get("uses", "")).startswith("actions/checkout@")]
    if len(co) != 1 or steps[0] is not co[0] or (co[0].get("with") or {}).get("ref") != DEFAULT_BRANCH:
        bad.append("scope: its one checkout comes first and takes the default branch (never the merge group's tree)")
    for s in steps:
        if "${{" in (s.get("run") or ""):
            bad.append("scope: an expression inside a shell")
        if "if" in s or s.get("continue-on-error"):
            bad.append("scope: a conditional or optional step")
    if st is None or "--event merge_group --stage scope " not in st["run"] or "set -euo pipefail" not in st["run"]:
        bad.append("scope: runs tools/agent_ci_required.py --event merge_group --stage scope under set -euo pipefail")
    # ---- agent: the one call, only for an Agent change
    if agent.get("uses") != "./.github/workflows/agent-ci.yml":
        bad.append("agent calls ./.github/workflows/agent-ci.yml")
    if set(agent) != {"needs", "if", "uses", "with"}:
        bad.append("agent has only needs / if / uses / with (no name: QUEUE_CALL_JOB is its id; no secrets, no permissions)")
    if agent.get("needs") not in ("scope", ["scope"]) or agent.get("with") != {"pr": "${{ needs.scope.outputs.pr }}"}:
        bad.append("agent needs scope and passes scope's validated PR number")
    for code in (*acr.SCOPE_CODES, "", "bogus"):
        c = _queue_ctx(needs={"scope": {"result": "success", "outputs": {"code": code}}})
        try:
            runs = "if" in agent and _runs(agent.get("if"), c)
        except AssertionError:
            runs = None
        if runs is not (code == acr.SCOPE_AGENT):
            bad.append(f"agent runs only for scope code {acr.SCOPE_AGENT!r} (code {code!r}: {runs})")
    return bad


def test_MQ_the_queue_workflow_keeps_every_rule():
    from tools import promotion_gate as pg
    assert queue_violations(QDOC) == []
    assert pg.classify(QWF.read_text(encoding="utf-8")) == "no" and QDOC["name"] == "agent ci queue"   # never a deploy gate


def _queue_mutants():
    def tool(doc, jid):
        return _tool_step(doc["jobs"][jid])

    def also_on_pull_request(doc):
        doc[True if True in doc else "on"]["pull_request"] = {"branches": ["master"]}

    def write_token_for_everyone(doc):
        doc["permissions"] = {"contents": "read", "statuses": "write"}

    def scope_may_write(doc):
        doc["jobs"]["scope"]["permissions"] = {"statuses": "write"}

    def scope_overrides_its_token_with_reads(doc):
        doc["jobs"]["scope"]["permissions"] = {"contents": "read", "actions": "read"}

    def scope_checks_out_the_merge_group(doc):
        del doc["jobs"]["scope"]["steps"][0]["with"]["ref"]

    def scope_gets_a_token(doc):
        tool(doc, "scope")["env"]["GITHUB_TOKEN"] = "${{ secrets.GITHUB_TOKEN }}"

    def scope_uses_the_verdict_environment(doc):
        doc["jobs"]["scope"]["environment"] = "agent-ci-verdict"

    def the_event_is_interpolated_into_bash(doc):
        s = tool(doc, "scope")
        s["run"] = s["run"].replace('"$HEAD_REF"', '"${{ github.event.merge_group.head_ref }}"')

    def scope_step_may_fail_quietly(doc):
        tool(doc, "scope")["continue-on-error"] = True

    def scope_has_no_timeout(doc):
        del doc["jobs"]["scope"]["timeout-minutes"]

    def scope_runs_the_follow_stage(doc):
        s = tool(doc, "scope")
        s["run"] = s["run"].replace("--stage scope ", "--stage follow ")

    def agent_always_runs(doc):
        del doc["jobs"]["agent"]["if"]

    def agent_runs_unless_clear(doc):
        doc["jobs"]["agent"]["if"] = "needs.scope.outputs.code != 'no-agent-paths'"

    def agent_calls_another_workflow(doc):
        doc["jobs"]["agent"]["uses"] = "./.github/workflows/agent-ci-benchmark.yml"

    def agent_is_renamed(doc):
        doc["jobs"]["agent"]["name"] = "Agent jobs"

    def agent_takes_the_raw_branch(doc):
        doc["jobs"]["agent"]["with"]["pr"] = "${{ github.event.merge_group.head_ref }}"

    def agent_inherits_secrets(doc):
        doc["jobs"]["agent"]["secrets"] = "inherit"

    def the_in_group_verdict_job_comes_back(doc):
        doc["jobs"]["verdict"] = {"needs": ["scope", "agent"], "if": "always()", "runs-on": "ubuntu-latest", "timeout-minutes": 5,
                                  "permissions": {"statuses": "write"}, "steps": [{"run": "true"}]}

    def a_shared_concurrency_group(doc):
        doc["concurrency"] = {"group": "agent-ci-${{ github.ref }}", "cancel-in-progress": True}

    def a_third_job(doc):
        doc["jobs"]["extra"] = {"runs-on": "ubuntu-latest", "steps": [{"run": "true"}]}

    return [also_on_pull_request, write_token_for_everyone, scope_may_write, scope_overrides_its_token_with_reads,
            scope_checks_out_the_merge_group, scope_gets_a_token, scope_uses_the_verdict_environment,
            the_event_is_interpolated_into_bash, scope_step_may_fail_quietly, scope_has_no_timeout, scope_runs_the_follow_stage,
            agent_always_runs, agent_runs_unless_clear, agent_calls_another_workflow, agent_is_renamed,
            agent_takes_the_raw_branch, agent_inherits_secrets, the_in_group_verdict_job_comes_back,
            a_shared_concurrency_group, a_third_job]


def test_MQ_the_mutant_list_is_whole():
    assert len(_queue_mutants()) == 20 and len({f.__name__ for f in _queue_mutants()}) == 20


@pytest.mark.parametrize("mutate", _queue_mutants(), ids=lambda f: f.__name__)
def test_MQ_the_queue_rail_catches_each_mutant(mutate):
    doc = copy.deepcopy(QDOC)
    mutate(doc)
    assert doc != QDOC, f"{mutate.__name__} changed nothing"
    assert queue_violations(doc), f"{mutate.__name__} went unnoticed"


# ---- the trusted follower: agent-ci-queue-verdict.yml (AUDIT F1 on #2501) --------------------------------------------------
# INERT twice over: it follows a workflow that only a merge queue starts, and it needs a GitHub App and an environment
# the owner has not created. It has never run on GitHub; these rails read the file.
VWF = ROOT / acr.FOLLOWER_WORKFLOW
VDOC = yaml.safe_load(VWF.read_text(encoding="utf-8"))
VERDICT_ENVIRONMENT = "agent-ci-verdict"
APP_ID_VAR, APP_KEY_SECRET = "AGENT_CI_VERDICT_APP_ID", "AGENT_CI_VERDICT_APP_PRIVATE_KEY"
FOLLOW_ENV = {
    "GITHUB_TOKEN": "${{ secrets.GITHUB_TOKEN }}",
    "AGENT_CI_VERDICT_TOKEN": "${{ steps.app-token.outputs.token }}",
    "RUN_ID": "${{ github.event.workflow_run.id }}",
    "RUN_HEAD_SHA": "${{ github.event.workflow_run.head_sha }}",
    "RUN_HEAD_BRANCH": "${{ github.event.workflow_run.head_branch }}",
    "RUN_EVENT": "${{ github.event.workflow_run.event }}",
    "TARGET_URL": "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}",
}
#: @v1 is the major rehearsed with the real App (2026-11-22, `app-id` + `private-key`)
FOLLOW_USES = ["actions/checkout@v4", "actions/setup-python@v5", "actions/create-github-app-token@v1"]


def _follow_ctx(event="merge_group", pr=1700, sha=MERGE, run_id=991):
    """The follower's context: a `workflow_run` event on master whose payload describes the run that completed."""
    branch = _queue_ref(pr)[len("refs/heads/"):]
    return {"github": {"event_name": "workflow_run", "repository": REPO, "ref": "refs/heads/master", "sha": "a" * 40,
                       "server_url": "https://github.invalid", "run_id": "777",
                       "event": {"repository": {"default_branch": "master"},
                                 "workflow_run": {"id": run_id, "head_sha": sha, "head_branch": branch, "event": event}}},
            "matrix": {}, "needs": {}, "inputs": {}, "vars": {APP_ID_VAR: "12345"},
            "steps": {"app-token": {"outputs": {"token": "app-installation-token"}}}, "secrets": {"GITHUB_TOKEN": "read-only-token"}}


def follower_violations(doc) -> list[str]:
    """Every rule agent-ci-queue-verdict.yml must keep, as a list of what is broken (empty = it holds)."""
    bad = []
    on = doc.get("on", doc.get(True))
    if on != {"workflow_run": {"workflows": [QDOC["name"]], "types": ["completed"]}}:
        bad.append(f"the only trigger is workflow_run on {QDOC['name']!r} completed (it then runs master's copy of this file)")
    if doc.get("permissions") != {"contents": "read"}:
        bad.append("the workflow's default token is contents: read")
    conc = doc.get("concurrency") or {}
    if conc.get("cancel-in-progress") is not False or "github.event.workflow_run.head_sha" not in str(conc.get("group")):
        bad.append("one verdict per merge group commit, never cancelled")
    jobs = doc.get("jobs") or {}
    if list(jobs) != ["verdict"]:
        return bad + [f"one job, verdict (got {list(jobs)})"]
    job, steps = jobs["verdict"], jobs["verdict"].get("steps") or []
    if job.get("environment") != VERDICT_ENVIRONMENT:
        bad.append(f"the job runs in the environment {VERDICT_ENVIRONMENT!r} (master only): the App's key lives there")
    # GITHUB_TOKEN can only read: with no `statuses: write` it cannot post the status at all
    if job.get("permissions") != {"contents": "read", "actions": "read"}:
        bad.append("the job's own token reads contents and actions and writes nothing")
    for event, runs in (("merge_group", True), ("pull_request", False), ("push", False), ("workflow_dispatch", False), ("", False)):
        try:
            got = "if" in job and _runs(job.get("if"), _follow_ctx(event=event))
        except AssertionError:
            got = None
        if got is not runs:
            bad.append(f"the job runs only for a merge group's run (event {event!r}: {got})")
    if {"needs", "continue-on-error", "strategy", "container", "services"} & set(job):
        bad.append("the job has no needs / matrix / container / continue-on-error")
    t = job.get("timeout-minutes")
    if not (isinstance(t, int) and 0 < t <= 15):
        bad.append(f"timeout-minutes is {t!r}")
    # ---- the steps: master's checkout, python, the App's token, the tool; nothing else, nothing optional
    if [s.get("uses") for s in steps if "uses" in s] != FOLLOW_USES:
        bad.append(f"the actions used are exactly {FOLLOW_USES} (GitHub-owned, pinned to a major)")
    co = [s for s in steps if str(s.get("uses", "")).startswith("actions/checkout@")]
    if len(co) != 1 or steps[0] is not co[0] or (co[0].get("with") or {}).get("ref") != DEFAULT_BRANCH \
            or "sparse-checkout" not in (co[0].get("with") or {}):
        bad.append("its one checkout comes first, sparse, and takes the default branch: nothing of a merge group is checked out")
    for s in steps:
        run = s.get("run") or ""
        if "${{" in run:
            bad.append("an expression inside a shell")
        if "if" in s or s.get("continue-on-error"):
            bad.append("a conditional or optional step")
        if re.search(r"\bgit\s+(checkout|switch|worktree|reset|merge|pull)\b", run):
            bad.append("a step moves the checkout off master's tree")
    mint = [s for s in steps if str(s.get("uses", "")).startswith("actions/create-github-app-token@")]
    want_mint = {"app-id": "${{ vars.%s }}" % APP_ID_VAR, "private-key": "${{ secrets.%s }}" % APP_KEY_SECRET, "permission-statuses": "write"}
    if len(mint) != 1 or mint[0].get("id") != "app-token" or mint[0].get("with") != want_mint:
        bad.append("the App's token is minted once, for this repository only, with statuses: write and nothing else")
    tool = _tool_step(job)
    if tool is None or tool.get("env") != FOLLOW_ENV:
        bad.append("the tool step reads the run's id, head_sha, head_branch and event, a read-only token, and the App's token")
    elif mint and steps.index(mint[0]) > steps.index(tool):
        bad.append("the App's token is minted before the tool runs")
    if tool is None or "--event merge_group --stage follow " not in tool["run"] or "set -euo pipefail" not in tool["run"]:
        bad.append("runs tools/agent_ci_required.py --event merge_group --stage follow under set -euo pipefail")
    # ---- the App's token is the ONLY token that can POST, and the only secrets named are the key and the read token
    flat = repr(doc)
    if sorted(re.findall(r"secrets\.(\w+)", flat)) != sorted([APP_KEY_SECRET, "GITHUB_TOKEN"]):
        bad.append("the only secrets named are the App's key (once) and the read-only GITHUB_TOKEN (once)")
    if flat.count("steps.app-token.outputs.token") != 1 or (tool or {}).get("env", {}).get(acr.VERDICT_TOKEN_ENV) != "${{ steps.app-token.outputs.token }}":
        bad.append(f"the App's token reaches exactly one place: the tool's {acr.VERDICT_TOKEN_ENV}")
    if _writers(doc):
        bad.append(f"no workflow token here may write anything (writers: {_writers(doc)})")
    return bad


def test_MQ_the_follower_keeps_every_rule():
    from tools import promotion_gate as pg
    assert follower_violations(VDOC) == []
    assert pg.classify(VWF.read_text(encoding="utf-8")) == "no" and VDOC["name"] == "agent ci queue verdict"
    assert acr.VERDICT_TOKEN_ENV == "AGENT_CI_VERDICT_TOKEN" and acr.FOLLOWER_WORKFLOW.as_posix() == ".github/workflows/agent-ci-queue-verdict.yml"
    # the trigger names the queue workflow by its NAME: the two must move together
    assert (VDOC.get("on") or VDOC[True])["workflow_run"]["workflows"] == [QDOC["name"]] == ["agent ci queue"]


def _follower_mutants():
    def job(doc):
        return doc["jobs"]["verdict"]

    def tool(doc):
        return _tool_step(job(doc))

    def on(doc):
        return doc[True if True in doc else "on"]

    def also_on_merge_group(doc):
        on(doc)["merge_group"] = None

    def also_on_pull_request(doc):
        on(doc)["pull_request"] = {"branches": ["master"]}

    def follows_another_workflow(doc):
        on(doc)["workflow_run"]["workflows"] = ["agent ci"]

    def follows_two_workflows(doc):
        on(doc)["workflow_run"]["workflows"].append("master deploy gate")

    def fires_when_the_run_is_requested(doc):
        on(doc)["workflow_run"]["types"] = ["requested"]

    def only_for_one_branch_filter(doc):
        on(doc)["workflow_run"]["branches"] = ["master"]

    def no_environment(doc):
        del job(doc)["environment"]

    def another_environment(doc):
        job(doc)["environment"] = "production"

    def the_workflow_token_may_post(doc):
        job(doc)["permissions"]["statuses"] = "write"

    def the_workflow_token_may_write_contents(doc):
        doc["permissions"] = {"contents": "write"}

    def runs_for_every_event(doc):
        del job(doc)["if"]

    def runs_for_pull_requests_too(doc):
        job(doc)["if"] = "github.event.workflow_run.event != 'push'"

    def checks_out_the_merge_group(doc):
        job(doc)["steps"][0]["with"]["ref"] = "${{ github.event.workflow_run.head_sha }}"

    def checks_out_the_run_branch(doc):
        job(doc)["steps"][0]["with"]["ref"] = "${{ github.event.workflow_run.head_branch }}"

    def checks_out_with_no_ref(doc):
        del job(doc)["steps"][0]["with"]["ref"]

    def a_second_checkout(doc):
        job(doc)["steps"].insert(2, {"uses": "actions/checkout@v4", "with": {"ref": "${{ github.event.workflow_run.head_sha }}", "path": "pr"}})

    def a_git_checkout_in_a_step(doc):
        s = tool(doc)
        s["run"] = s["run"].replace("set -euo pipefail\n", "set -euo pipefail\ngit checkout \"$RUN_HEAD_SHA\"\n")

    def a_third_party_action(doc):
        job(doc)["steps"].insert(2, {"uses": "someone/some-action@v1"})

    def the_token_action_is_unpinned(doc):
        next(s for s in job(doc)["steps"] if "create-github-app-token" in str(s.get("uses")))["uses"] = "actions/create-github-app-token@main"

    def the_app_token_can_do_more(doc):
        next(s for s in job(doc)["steps"] if "create-github-app-token" in str(s.get("uses")))["with"]["permission-contents"] = "write"

    def the_app_token_inherits_every_permission(doc):
        del next(s for s in job(doc)["steps"] if "create-github-app-token" in str(s.get("uses")))["with"]["permission-statuses"]

    def the_app_token_covers_the_whole_owner(doc):
        next(s for s in job(doc)["steps"] if "create-github-app-token" in str(s.get("uses")))["with"]["owner"] = "${{ github.repository_owner }}"

    def the_key_is_a_repository_secret_by_another_name(doc):
        next(s for s in job(doc)["steps"] if "create-github-app-token" in str(s.get("uses")))["with"]["private-key"] = "${{ secrets.SOME_OTHER_KEY }}"

    def the_tool_posts_with_the_workflow_token(doc):
        tool(doc)["env"]["AGENT_CI_VERDICT_TOKEN"] = "${{ secrets.GITHUB_TOKEN }}"

    def the_app_token_reads_too(doc):
        tool(doc)["env"]["GITHUB_TOKEN"] = "${{ steps.app-token.outputs.token }}"

    def the_event_is_interpolated_into_bash(doc):
        s = tool(doc)
        s["run"] = s["run"].replace('"$RUN_HEAD_BRANCH"', '"${{ github.event.workflow_run.head_branch }}"')

    def the_tool_is_told_the_event(doc):
        tool(doc)["env"]["RUN_EVENT"] = "merge_group"

    def the_tool_reads_the_runs_conclusion(doc):
        tool(doc)["env"]["RUN_CONCLUSION"] = "${{ github.event.workflow_run.conclusion }}"

    def the_tool_step_may_fail_quietly(doc):
        tool(doc)["continue-on-error"] = True

    def the_tool_runs_the_scope_stage(doc):
        s = tool(doc)
        s["run"] = s["run"].replace("--stage follow ", "--stage scope ")

    def a_superseded_verdict_is_cancelled(doc):
        doc["concurrency"]["cancel-in-progress"] = True

    def no_timeout(doc):
        del job(doc)["timeout-minutes"]

    def a_second_job(doc):
        doc["jobs"]["extra"] = {"runs-on": "ubuntu-latest", "environment": "agent-ci-verdict", "steps": [{"run": "true"}]}

    return [also_on_merge_group, also_on_pull_request, follows_another_workflow, follows_two_workflows,
            fires_when_the_run_is_requested, only_for_one_branch_filter, no_environment, another_environment,
            the_workflow_token_may_post, the_workflow_token_may_write_contents, runs_for_every_event, runs_for_pull_requests_too,
            checks_out_the_merge_group, checks_out_the_run_branch, checks_out_with_no_ref, a_second_checkout,
            a_git_checkout_in_a_step, a_third_party_action, the_token_action_is_unpinned, the_app_token_can_do_more,
            the_app_token_inherits_every_permission, the_app_token_covers_the_whole_owner,
            the_key_is_a_repository_secret_by_another_name, the_tool_posts_with_the_workflow_token, the_app_token_reads_too,
            the_event_is_interpolated_into_bash, the_tool_is_told_the_event, the_tool_reads_the_runs_conclusion,
            the_tool_step_may_fail_quietly, the_tool_runs_the_scope_stage, a_superseded_verdict_is_cancelled, no_timeout, a_second_job]


def test_MQ_the_follower_mutant_list_is_whole():
    assert len(_follower_mutants()) == 33 and len({f.__name__ for f in _follower_mutants()}) == 33


@pytest.mark.parametrize("mutate", _follower_mutants(), ids=lambda f: f.__name__)
def test_MQ_the_follower_rail_catches_each_mutant(mutate):
    doc = copy.deepcopy(VDOC)
    mutate(doc)
    assert doc != VDOC, f"{mutate.__name__} changed nothing"
    assert follower_violations(doc), f"{mutate.__name__} went unnoticed"


def _all_workflow_docs():
    out = {f.name: (f.read_text(encoding="utf-8"), yaml.safe_load(f.read_text(encoding="utf-8"))) for f in sorted(WF_DIR_ALL.glob("*.y*ml"))}
    assert len(out) > 20, "found too few workflows: the rail is not reading .github/workflows"
    return out


#: the two workflows that post `agent-ci-required`: on a merge group's commit, and on a pull request's head
POSTERS = (acr.FOLLOWER_WORKFLOW.name, "agent-ci-required.yml")


def _dump(doc) -> str:
    """A parsed workflow back to YAML text, for the controls below (the predicate reads TEXT, as it does from git)."""
    return yaml.safe_dump(doc, sort_keys=False)


def environment_and_status_problems(docs: dict) -> list[str]:
    """Who can post the Agent's required status. `docs`: {file name: (text, parsed)}.
    ONE AUTHORITY (AUDIT review 2 of #2501, finding 1): who may reach the App is decided by
    tools/agent_ci_required.workflow_problems, the same function the follower applies to every merge group entry and the
    pull-request side to every head, from master's copy. This rail CALLS it over the tree it runs in; it restates none of
    its rules. What it adds are three facts that predicate does not judge:
      * every job of a poster that is handed the App's token runs in the environment;
      * NO workflow token is granted statuses: write (the posters' own tokens included);
      * only the follower follows the queue workflow.
    ⚠️ A job left on the repository's DEFAULT token is not provably unable to write a status: it is the ruleset's pin to
    the App that makes such a status worthless, and this rail that keeps one from being written by accident."""
    bad = list(acr.workflow_problems({f"{acr.WORKFLOW_DIR}/{name}": text for name, (text, doc) in docs.items()}))
    for name, (text, doc) in docs.items():
        jobs = (doc.get("jobs") or {}) if isinstance(doc, dict) else {}
        if name in POSTERS:
            for jid, job in jobs.items():
                if acr.VERDICT_TOKEN_ENV in repr(job) and job.get("environment") != acr.VERDICT_ENVIRONMENT:
                    bad.append(f"{name}: job {jid} is handed the App's token outside the environment {acr.VERDICT_ENVIRONMENT}")
        else:
            on = doc.get("on", doc.get(True)) if isinstance(doc, dict) else None
            wr = on.get("workflow_run") if isinstance(on, dict) else None
            if wr and QDOC["name"] in (wr.get("workflows") or []):
                bad.append(f"{name} also follows {QDOC['name']!r}")
        perms = [doc.get("permissions") if isinstance(doc, dict) else None, *(j.get("permissions") for j in jobs.values() if isinstance(j, dict))]
        if any(p == "write-all" or (isinstance(p, dict) and p.get("statuses") == "write") for p in perms):
            bad.append(f"{name} gives a workflow token statuses: write")
    return bad


def test_MQ_no_other_workflow_can_reach_the_app_or_write_a_status():
    docs = _all_workflow_docs()
    assert environment_and_status_problems(docs) == []
    assert acr.VERDICT_ENVIRONMENT == VERDICT_ENVIRONMENT and set(acr.POSTER_JOBS) == {f".github/workflows/{p}" for p in POSTERS}
    assert acr.POSTER_JOBS[acr.FOLLOWER_WORKFLOW.as_posix()] == list(VDOC["jobs"]) [0] == "verdict"
    assert acr.POSTER_JOBS[".github/workflows/agent-ci-required.yml"] == list(RDOC["jobs"])[0] == "status"
    # control: each kind of intruder is named, in a workflow that is clean as it stands
    text, doc = docs["web-start.yml"]
    assert acr.workflow_problems({".github/workflows/web-start.yml": text}) == []
    first = lambda d: next(iter(d["jobs"].values()))                                    # noqa: E731
    for label, mutate in (
        # AUDIT's three: the literal name, a name an expression computes, a name read from a variable
        ("environment", lambda d: first(d).update(environment=VERDICT_ENVIRONMENT)),
        ("environment-format", lambda d: first(d).update(environment="${{ format('agent-ci-{0}', 'verdict') }}")),
        ("environment-vars", lambda d: first(d).update(environment="${{ vars.ENV_NAME }}")),
        ("environment-object", lambda d: first(d).update(environment={"name": "${{ vars.ENV_NAME }}", "url": "x"})),
        ("environment-of-another-name", lambda d: first(d).update(environment="production")),
        ("variable", lambda d: first(d).update(env={"APP": "${{ vars.%s }}" % APP_ID_VAR})),
        ("secret", lambda d: first(d).update(env={"KEY": "${{ secrets.%s }}" % APP_KEY_SECRET})),
        ("token", lambda d: first(d)["steps"].append({"run": "echo $%s" % acr.VERDICT_TOKEN_ENV})),
        ("context", lambda d: first(d)["steps"].append({"run": "gh api repos/o/r/statuses/$SHA -f context=agent-ci-required -f state=success"})),
        ("context-in-a-name", lambda d: first(d)["steps"].append({"name": "post agent-ci-required", "run": "true"})),
        ("remote-reusable", lambda d: d["jobs"].update(call={"uses": "someone/repo/.github/workflows/x.yml@main"})),
        ("statuses", lambda d: first(d).update(permissions={"statuses": "write"})),
        ("write-all", lambda d: d.update(permissions="write-all")),
        ("follows", lambda d: d[True if True in d else "on"].update(workflow_run={"workflows": [QDOC["name"]], "types": ["completed"]})),
    ):
        d = copy.deepcopy(doc)
        mutate(d)
        assert environment_and_status_problems({**docs, "web-start.yml": (_dump(d), d)}), f"{label} went unnoticed"
    assert environment_and_status_problems({**docs, "web-start.yml": (_dump(doc), doc)}) == []      # control: the round trip itself is clean
    assert environment_and_status_problems({**docs, "new.yml": ("jobs: {a: [}\n", {})}) == ["new.yml: does not parse as YAML (ParserError)"]
    # the posters themselves: their own token may not write a status either, and the App's token stays in the environment
    for poster in POSTERS:
        ptext, pdoc = docs[poster]
        d = copy.deepcopy(pdoc)
        first(d)["permissions"]["statuses"] = "write"
        assert environment_and_status_problems({**docs, poster: (_dump(d), d)}), f"{poster}: its own token may post again"
        d = copy.deepcopy(pdoc)
        del first(d)["environment"]
        assert environment_and_status_problems({**docs, poster: (_dump(d), d)}), f"{poster}: the App's token outside the environment"
        d = copy.deepcopy(pdoc)
        d["jobs"]["second"] = {"runs-on": "ubuntu-latest", "environment": VERDICT_ENVIRONMENT, "steps": [{"run": "true"}]}
        assert environment_and_status_problems({**docs, poster: (_dump(d), d)}), f"{poster}: a second job in the environment"
    # a workflow FILE name is not the context, and neither is a YAML comment
    d = copy.deepcopy(doc)
    first(d)["steps"].append({"run": "true   # pinned, as agent-ci-required.yml pins it", "name": "see .github/workflows/agent-ci-required.yml"})
    assert environment_and_status_problems({**docs, "web-start.yml": (_dump(d) + "\n# agent-ci-required\n# AGENT_CI_VERDICT_TOKEN\n# environment: agent-ci-verdict\n", d)}) == []


def _sparse(job: dict) -> list[str]:
    return (job["steps"][0]["with"]["sparse-checkout"]).split()


def _held(path: str, sparse: list[str]) -> bool:
    """Is a repo path on disk under this non-cone sparse list? Only the two shapes these workflows use are read:
    a root-anchored file (`/a/b.py`) and a root-anchored folder (`/a/`); anything else is refused by name."""
    for p in sparse:
        assert p.startswith("/") and "*" not in p and "!" not in p, f"a sparse pattern this rail cannot evaluate: {p!r}"
        if path == p[1:] or (p.endswith("/") and path.startswith(p[1:])):
            return True
    return False


def test_MQ_each_checkout_holds_every_file_its_stage_reads():
    """A file that is not on disk makes the protected list unreadable, or the tool unimportable. Both stages (the
    in-group scope and the follower, which RECOMPUTES that scope) read: both tools, agent-ci.yml, every vite / vitest
    config and every file those configs import (derived by the same code the stages run, never listed here)."""
    tools = {"tools/agent_ci_required.py", "tools/agent_ci_evidence.py", "tools/__init__.py", ".github/workflows/agent-ci.yml"}
    configs = {p.relative_to(ROOT).as_posix() for pat in ("vite*.config.*", "vitest*.config.*") for p in (ROOT / "app").glob(pat)}
    imported = set(ev.config_imports(ROOT))
    assert len(configs) >= 2 and len(imported) >= 3, (configs, imported)
    scope, follower = _sparse(QDOC["jobs"]["scope"]), _sparse(VDOC["jobs"]["verdict"])
    assert scope == follower, "the follower recomputes the scope: it needs exactly the files the scope job has"
    for job in (QDOC["jobs"]["scope"], VDOC["jobs"]["verdict"]):
        assert job["steps"][0]["with"]["sparse-checkout-cone-mode"] is False
    assert sorted(f for f in tools | configs | imported if not _held(f, scope)) == []
    # control: the judge can say no, and refuses a pattern it cannot read
    assert not _held("api/main.py", scope) and not _held("tools/agent_ci_rearm.py", scope)
    assert not _held("tools/agent_ci_required.pyc", ["/tools/agent_ci_required.py"]) and _held("app/x/y.js", ["/app/"])
    with pytest.raises(AssertionError):
        _held("app/x.js", ["app/"])


# ---- the workflows' command lines reach the tool's real argument parser ------------------------------------------
def _tool_argv(step: dict, c: dict) -> list[str]:
    """The step's `python tools/agent_ci_required.py ...` line as argv, every "$VAR" filled from the step's own env as
    it evaluates for `c`. A variable the step does not define is a KeyError: the line names something bash would not have."""
    lines = [ln.strip() for ln in step["run"].splitlines() if "tools/agent_ci_required.py" in ln]
    assert len(lines) == 1, lines
    env = {k: str(template(v, c)) for k, v in step["env"].items()}
    argv = shlex.split(re.sub(r"\$(\w+)", lambda m: env[m.group(1)], lines[0]))
    assert argv[:2] == ["python", "tools/agent_ci_required.py"], argv
    return argv[2:]


def test_MQ_the_scope_command_line_hands_the_tool_the_merge_groups_three_values(monkeypatch, tmp_path):
    seen = {}

    def fake_scope(root, doc, head_sha, base_sha, head_ref, tested_sha):
        seen.update(head_sha=head_sha, base_sha=base_sha, head_ref=head_ref, tested_sha=tested_sha, paths=acr.agent_paths(doc))
        return {"code": acr.SCOPE_AGENT, "pr": 1700, "detail": "Agent paths changed"}

    out = tmp_path / "out.txt"
    monkeypatch.setattr(acr, "queue_scope", fake_scope)
    monkeypatch.chdir(ROOT)
    monkeypatch.setenv("GITHUB_SHA", MERGE)
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    for var in ("GITHUB_TOKEN", acr.VERDICT_TOKEN_ENV):
        monkeypatch.delenv(var, raising=False)               # the scope stage needs no token at all
    assert acr.main(_tool_argv(_tool_step(QDOC["jobs"]["scope"]), _queue_ctx())) == 0
    assert seen == {"head_sha": MERGE, "base_sha": QUEUE_BASE, "head_ref": _queue_ref(), "tested_sha": MERGE, "paths": acr.agent_paths(DOC)}
    # ... and what it writes is exactly what the workflow's `agent` job and its `with:` read
    assert out.read_text(encoding="utf-8") == "code=agent-paths\npr=1700\ndetail=Agent paths changed\n"


class _FollowApi:
    """Stands in for acr.Api in the follow stage: records which TOKEN made which call."""
    made: list = []

    def __init__(self, token, repo, base="https://api.github.com", attempts=1):
        assert repo == REPO and attempts == acr.RETRY_ATTEMPTS == 3
        self.token, self.calls = token, []
        type(self).made.append(self)

    def get(self, path):
        self.calls.append(("GET", path))
        raise AssertionError("follow() is faked in this test: nothing is read")

    def call(self, method, path, body=None):
        self.calls.append((method, path, body))


@pytest.mark.parametrize("verdict,rc,posts", [
    (("success", "no Agent paths changed"), 0, 1), (("failure", "fail closed: x"), 1, 1), (None, 2, 0),
])
def test_MQ_the_follower_command_line_hands_the_tool_four_values_and_posts_with_the_app_token(monkeypatch, verdict, rc, posts):
    seen = {}

    def fake_follow(read, a, now, **kw):
        seen.update(token=read.token, sha=a.sha, run_id=a.run_id, head_ref=a.head_ref, run_event=a.run_event, root=a.root, aware=now.tzinfo is not None)
        return verdict

    _FollowApi.made = []
    monkeypatch.setattr(acr, "Api", _FollowApi)
    monkeypatch.setattr(acr, "follow", fake_follow)
    monkeypatch.chdir(ROOT)
    c = _follow_ctx()
    step = _tool_step(VDOC["jobs"]["verdict"])
    for k, v in step["env"].items():                          # the step's env, as the job would have it
        monkeypatch.setenv(k, str(template(v, c)))
    monkeypatch.setenv("GITHUB_REPOSITORY", REPO)
    assert acr.main(_tool_argv(step, c)) == rc
    assert seen == {"token": "read-only-token", "sha": MERGE, "run_id": 991, "head_ref": _queue_ref()[len("refs/heads/"):],
                    "run_event": "merge_group", "root": ".", "aware": True}
    posted = [(api.token, call) for api in _FollowApi.made for call in api.calls]
    assert len(posted) == posts, posted
    if posts:
        token, (method, path, body) = posted[0]
        assert token == "app-installation-token", "the status must be posted with the App's token and no other"
        assert (method, path) == ("POST", f"statuses/{MERGE}") and body["context"] == "agent-ci-required" and body["state"] == verdict[0]
        assert body["description"] == verdict[1] and body["target_url"] == "https://github.invalid/o/r/actions/runs/777"


def test_MQ_the_follow_stage_needs_the_app_token_before_it_reads_anything(monkeypatch):
    _FollowApi.made = []
    monkeypatch.setattr(acr, "Api", _FollowApi)
    monkeypatch.setattr(acr, "follow", lambda *a, **k: pytest.fail("nothing is decided without the App's token"))
    monkeypatch.setenv("GITHUB_TOKEN", "read-only-token")
    monkeypatch.setenv("GITHUB_REPOSITORY", REPO)
    monkeypatch.delenv(acr.VERDICT_TOKEN_ENV, raising=False)
    with pytest.raises(KeyError):
        acr.main(["--event", "merge_group", "--stage", "follow", f"--sha={MERGE}", "--run-id=991", "--head-ref=x", "--run-event=merge_group"])
    assert _FollowApi.made == []


# ---- the merge group's commit IS the commit that lands: its runs stay on master's tip sha ------------------------------
def _queue_run(conclusion="failure", status="completed"):
    return {"id": 992, "name": "agent ci queue", "path": ".github/workflows/agent-ci-queue.yml", "head_sha": TIP,
            "head_branch": _queue_ref()[len("refs/heads/"):], "event": "merge_group", "status": status, "conclusion": conclusion,
            "created_at": "2026-11-22T10:00:00Z"}


def _follower_run(conclusion="failure", status="completed"):
    """A run of the trusted follower: a workflow_run event, so it sits on MASTER's tip sha and branch."""
    return {"id": 993, "name": "agent ci queue verdict", "path": ".github/workflows/agent-ci-queue-verdict.yml", "head_sha": TIP,
            "head_branch": "master", "event": "workflow_run", "status": status, "conclusion": conclusion, "created_at": "2026-11-22T10:01:00Z"}


@pytest.mark.parametrize("run", [_queue_run(), _queue_run("success"), _queue_run("cancelled"), _queue_run(None, "in_progress"),
                                 _follower_run(), _follower_run("success"), _follower_run("cancelled"), _follower_run(None, "in_progress")])
def test_MQ_a_merge_group_run_on_the_landed_commit_changes_no_promotion_or_gate_decision(run):
    """GitHub lands the commit it tested, so every merge_group run (this workflow's, red or green) sits on a sha that
    becomes master's tip; and every run of the follower (a workflow_run event) sits on master's tip and BRANCH. Every
    reader of that sha's runs must answer exactly as without it."""
    from tools import promote_decision as pd
    from tools import promotion_gate as pg
    gating_map, unclassified = pg.read_workflow_dir(str(ROOT))
    assert not unclassified and gating_map.get("agent ci queue") == "no" and gating_map.get("agent ci queue verdict") == "no"
    gating = sorted(n for n, v in gating_map.items() if v == "yes")
    works = [{"name": n, "state": "active"} for n in gating_map]
    gate_ok = {"id": 1, "name": pg.ALWAYS_RUNS, "head_sha": TIP, "head_branch": "master", "event": "push",
               "status": "completed", "conclusion": "success", "created_at": "2026-11-22T09:00:00Z"}
    for base in ([gate_ok], [dict(gate_ok, conclusion="failure")], [dict(gate_ok, status="in_progress", conclusion=None)]):
        assert pg.decide(gating=gating, runs=base + [run], workflows=works) == pg.decide(gating=gating, runs=base, workflows=works)
    # even if this workflow WERE gating, a merge_group run on the queue's branch is not a counted master event
    assert "merge_group" not in pg.COUNTED_EVENTS and "workflow_run" not in pg.COUNTED_EVENTS
    both = sorted({*gating, "agent ci queue", "agent ci queue verdict"})
    assert pg.decide(gating=both, runs=[gate_ok, run], workflows=works)[0] == pg.decide(gating=both, runs=[gate_ok], workflows=works)[0]
    jobs = [{"run_id": 1, "conclusion": "success"}]
    assert pd.gate_ok([gate_ok, run], jobs + [{"run_id": 992, "conclusion": "failure"}], 1, TIP) == pd.gate_ok([gate_ok], jobs, 1, TIP)
    # and the pull-request side of agent-ci-required never reads a merge_group run as evidence for a head
    assert "merge_group" not in acr.RUN_EVENTS
    with pytest.raises(ValueError):
        acr.run_for(_ReqApi([]), TIP, "merge_group")


# ---- the pull-request side: agent-ci-required.yml posts with the SAME App, from the same environment ----------------------
# Rehearsed 2026-11-22 (mq-rehearsal): with the required check pinned to the App, a pull request cannot enter the queue
# until the App has posted the context on its head, and a status any workflow token posts under that context afterwards
# blocks it again. So this workflow runs on master (pull_request_target for PRs into master, workflow_run) in the
# environment, and its own token can only read.
RWF = ROOT / ".github" / "workflows" / "agent-ci-required.yml"
RDOC = yaml.safe_load(RWF.read_text(encoding="utf-8"))
PR_STAGE_ENV = {
    "GITHUB_TOKEN": "${{ secrets.GITHUB_TOKEN }}",
    "AGENT_CI_VERDICT_TOKEN": "${{ steps.app-token.outputs.token }}",
    "EVENT": "${{ github.event_name }}",
    "PR_SHA": "${{ github.event.pull_request.head.sha }}",
    "PR_NUMBER": "${{ github.event.pull_request.number }}",
    "RUN_SHA": "${{ github.event.workflow_run.head_sha }}",
    "TARGET_URL": "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}",
}
PR_STAGE_RUN = (
    'set -euo pipefail\n'
    'python -m pip install --quiet pyyaml==6.0.2   # pinned: this job holds the App\'s token\n'
    'if [ "$EVENT" = "pull_request_target" ]; then\n'
    '  python tools/agent_ci_required.py --event pull_request --sha "$PR_SHA" --pr "$PR_NUMBER"\n'
    'else\n'
    '  python tools/agent_ci_required.py --event workflow_run --sha "$RUN_SHA"\n'
    'fi\n')


def pr_stage_violations(doc) -> list[str]:
    """Every rule agent-ci-required.yml must keep now that it is a `pull_request_target` job with a secret in reach."""
    bad = []
    on = doc.get("on", doc.get(True))
    want_on = {"pull_request_target": {"branches": ["master"], "types": ["opened", "synchronize", "reopened"]},
               "workflow_run": {"workflows": [DOC["name"]], "types": ["completed"]}}
    if on != want_on:
        bad.append("the triggers are pull_request_target into master and workflow_run on agent ci: both run THIS file from master, on master")
    if doc.get("permissions") != {"contents": "read"}:
        bad.append("the workflow's default token is contents: read")
    conc = doc.get("concurrency") or {}
    if conc.get("cancel-in-progress") is not True or "github.event.pull_request.head.sha || github.event.workflow_run.head_sha" not in str(conc.get("group")):
        bad.append("a newer push to the same head supersedes the older evaluation")
    jobs = doc.get("jobs") or {}
    if list(jobs) != ["status"]:
        return bad + [f"one job, status (got {list(jobs)})"]
    job, steps = jobs["status"], jobs["status"].get("steps") or []
    if job.get("environment") != VERDICT_ENVIRONMENT:
        bad.append(f"the job runs in the environment {VERDICT_ENVIRONMENT!r} (master only): the App's key lives there")
    if job.get("permissions") != {"actions": "read", "contents": "read", "pull-requests": "read"}:
        bad.append("the job's own token reads and writes nothing (it cannot post a status)")
    if {"if", "needs", "continue-on-error", "strategy", "container", "services"} & set(job):
        bad.append("the job is unconditional, with no needs / matrix / container")
    t = job.get("timeout-minutes")
    if not (isinstance(t, int) and 0 < t <= 10):
        bad.append(f"timeout-minutes is {t!r}")
    # ---- pull_request_target safety 1: nothing of the pull request is checked out or executed
    if [s.get("uses") for s in steps if "uses" in s] != ["actions/checkout@v4", "actions/setup-python@v5", "actions/create-github-app-token@v1"]:
        bad.append("the actions used are exactly checkout, setup-python and create-github-app-token (GitHub-owned, pinned to a major)")
    co = [s for s in steps if str(s.get("uses", "")).startswith("actions/checkout@")]
    with_ = (co[0].get("with") or {}) if co else {}
    if len(co) != 1 or steps[0] is not co[0] or with_.get("ref") != DEFAULT_BRANCH \
            or with_.get("sparse-checkout", "").split() != ["tools/agent_ci_required.py", ".github/workflows/agent-ci.yml"]:
        bad.append("its one checkout comes first and takes two files of the DEFAULT branch: nothing of the pull request is on disk")
    flat = repr(doc)
    for taken in ("pull_request.head.ref", "pull_request.head.repo", "github.head_ref", "pull_request.title", "pull_request.body", "pull_request.user"):
        if taken in flat:
            bad.append(f"the job reads {taken} from the event: only the head SHA and the PR number are taken")
    # ---- safety 2: the event reaches the shell only as environment variables
    runs = [s for s in steps if "run" in s]
    if len(runs) != 1 or runs[0].get("run") != PR_STAGE_RUN:
        bad.append("the one run: step is the pinned script (no expression in it, the event only through $EVENT / $PR_SHA / $PR_NUMBER / $RUN_SHA)")
    if not runs or runs[0].get("env") != PR_STAGE_ENV:
        bad.append("the tool step's env is the head SHA, the PR number, the run's head SHA, a read-only token and the App's token")
    for s in steps:
        if "${{" in (s.get("run") or ""):
            bad.append("an expression inside a shell")
        if "if" in s or s.get("continue-on-error"):
            bad.append("a conditional or optional step")
    # ---- safety 4: the App's token is the only one that can post
    mint = [s for s in steps if str(s.get("uses", "")).startswith("actions/create-github-app-token@")]
    want_mint = {"app-id": "${{ vars.%s }}" % APP_ID_VAR, "private-key": "${{ secrets.%s }}" % APP_KEY_SECRET, "permission-statuses": "write"}
    if len(mint) != 1 or mint[0].get("id") != "app-token" or mint[0].get("with") != want_mint:
        bad.append("the App's token is minted once, for this repository only, with statuses: write and nothing else")
    if sorted(re.findall(r"secrets\.(\w+)", flat)) != sorted([APP_KEY_SECRET, "GITHUB_TOKEN"]) or flat.count("steps.app-token.outputs.token") != 1:
        bad.append("the only secrets named are the App's key and the read-only GITHUB_TOKEN, and the App's token reaches one place")
    if _writers(doc):
        bad.append(f"no workflow token here may write anything (writers: {_writers(doc)})")
    return bad


def test_MQ_the_pull_request_side_keeps_every_rule():
    from tools import promotion_gate as pg
    assert pr_stage_violations(RDOC) == []
    assert pg.classify(RWF.read_text(encoding="utf-8")) == "no" and RDOC["name"] == "agent ci required"
    # the script's two branches hand the tool the event's values, and nothing else
    env = {"EVENT": "x", "PR_SHA": MERGE, "PR_NUMBER": "1700", "RUN_SHA": "e" * 40}
    for branch, want in ((PR_STAGE_RUN.split("then\n")[1].split("else\n")[0], ["--event", "pull_request", "--sha", MERGE, "--pr", "1700"]),
                         (PR_STAGE_RUN.split("else\n")[1].split("fi\n")[0], ["--event", "workflow_run", "--sha", "e" * 40])):
        argv = shlex.split(re.sub(r"\$(\w+)", lambda m: env[m.group(1)], branch.strip()))
        assert argv[:2] == ["python", "tools/agent_ci_required.py"] and argv[2:] == want, argv


def _pr_stage_mutants():
    def job(doc):
        return doc["jobs"]["status"]

    def on(doc):
        return doc[True if True in doc else "on"]

    def run_step(doc):
        return next(s for s in job(doc)["steps"] if "run" in s)

    def mint(doc):
        return next(s for s in job(doc)["steps"] if "create-github-app-token" in str(s.get("uses")))

    def back_to_pull_request(doc):
        on(doc)["pull_request"] = on(doc).pop("pull_request_target")

    def also_into_agent_int(doc):
        on(doc)["pull_request_target"]["branches"] = ["agent/int", "master"]

    def into_every_branch(doc):
        del on(doc)["pull_request_target"]["branches"]

    def also_on_merge_group(doc):
        on(doc)["merge_group"] = None

    def watches_another_workflow(doc):
        on(doc)["workflow_run"]["workflows"] = ["agent ci queue"]

    def no_environment(doc):
        del job(doc)["environment"]

    def the_workflow_token_posts_again(doc):
        job(doc)["permissions"]["statuses"] = "write"

    def the_old_top_level_write(doc):
        doc["permissions"] = {"statuses": "write", "actions": "read", "contents": "read", "pull-requests": "read"}

    def checks_out_the_pull_request_head(doc):
        job(doc)["steps"][0]["with"]["ref"] = "${{ github.event.pull_request.head.sha }}"

    def checks_out_the_pull_request_branch(doc):
        job(doc)["steps"][0]["with"]["ref"] = "${{ github.head_ref }}"

    def checks_out_the_default_ref_of_the_event(doc):
        del job(doc)["steps"][0]["with"]["ref"]

    def checks_out_the_whole_tree(doc):
        del job(doc)["steps"][0]["with"]["sparse-checkout"]

    def checks_out_one_more_file(doc):
        job(doc)["steps"][0]["with"]["sparse-checkout"] += "conftest.py\n"

    def a_second_checkout_of_the_pull_request(doc):
        job(doc)["steps"].insert(1, {"uses": "actions/checkout@v4", "with": {"ref": "${{ github.event.pull_request.head.sha }}", "path": "pr"}})

    def runs_a_script_from_the_event(doc):
        run_step(doc)["run"] = run_step(doc)["run"].replace('"$PR_SHA"', '"${{ github.event.pull_request.head.sha }}"')

    def the_title_reaches_the_env(doc):
        run_step(doc)["env"]["TITLE"] = "${{ github.event.pull_request.title }}"

    def the_branch_name_reaches_the_env(doc):
        run_step(doc)["env"]["HEAD_REF"] = "${{ github.head_ref }}"

    def an_extra_run_step(doc):
        job(doc)["steps"].append({"run": "echo done"})

    def installs_unpinned(doc):
        run_step(doc)["run"] = run_step(doc)["run"].replace("pyyaml==6.0.2", "pyyaml")

    def a_third_party_action(doc):
        job(doc)["steps"].insert(2, {"uses": "someone/some-action@v1"})

    def the_app_token_can_do_more(doc):
        mint(doc)["with"]["permission-contents"] = "write"

    def the_app_token_covers_the_whole_owner(doc):
        mint(doc)["with"]["owner"] = "${{ github.repository_owner }}"

    def posts_with_the_workflow_token(doc):
        run_step(doc)["env"]["AGENT_CI_VERDICT_TOKEN"] = "${{ secrets.GITHUB_TOKEN }}"

    def the_tool_step_may_fail_quietly(doc):
        run_step(doc)["continue-on-error"] = True

    def only_for_same_repo_heads_by_a_job_condition(doc):
        job(doc)["if"] = "github.event.pull_request.head.repo.full_name == github.repository"

    def superseded_runs_finish(doc):
        doc["concurrency"]["cancel-in-progress"] = False

    def a_second_job(doc):
        doc["jobs"]["extra"] = {"runs-on": "ubuntu-latest", "steps": [{"run": "true"}]}

    return [back_to_pull_request, also_into_agent_int, into_every_branch, also_on_merge_group, watches_another_workflow,
            no_environment, the_workflow_token_posts_again, the_old_top_level_write, checks_out_the_pull_request_head,
            checks_out_the_pull_request_branch, checks_out_the_default_ref_of_the_event, checks_out_the_whole_tree,
            checks_out_one_more_file, a_second_checkout_of_the_pull_request, runs_a_script_from_the_event,
            the_title_reaches_the_env, the_branch_name_reaches_the_env, an_extra_run_step, installs_unpinned,
            a_third_party_action, the_app_token_can_do_more, the_app_token_covers_the_whole_owner, posts_with_the_workflow_token,
            the_tool_step_may_fail_quietly, only_for_same_repo_heads_by_a_job_condition, superseded_runs_finish, a_second_job]


def test_MQ_the_pull_request_side_mutant_list_is_whole():
    assert len(_pr_stage_mutants()) == 27 and len({f.__name__ for f in _pr_stage_mutants()}) == 27


@pytest.mark.parametrize("mutate", _pr_stage_mutants(), ids=lambda f: f.__name__)
def test_MQ_the_pull_request_side_rail_catches_each_mutant(mutate):
    doc = copy.deepcopy(RDOC)
    mutate(doc)
    assert doc != RDOC, f"{mutate.__name__} changed nothing"
    assert pr_stage_violations(doc), f"{mutate.__name__} went unnoticed"


def test_MQ_no_pull_request_target_job_anywhere_else():
    """`pull_request_target` hands a pull request's event to a job that can reach secrets. ONE workflow may use it, and
    its rules are the rail above."""
    users = []
    for name, (text, doc) in _all_workflow_docs().items():
        on = doc.get("on", doc.get(True))
        if "pull_request_target" in (on if isinstance(on, (dict, list)) else [on]):
            users.append(name)
    assert users == ["agent-ci-required.yml"], users
