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
"""
from __future__ import annotations

import copy
import fnmatch
import os
import pathlib
import re
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
        for event in ("pull_request", "repository_dispatch"):
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
VALIDATE_IF = "github.event_name != 'push' && github.event_name != 'pull_request'"


def test_every_job_validates_the_payload_first():
    """AUDIT #1: the FIRST step of every job is the one validate step: bash, payload only through env:, fail closed on
    any event but push / pull_request, and its outputs are the only payload values the job reads."""
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
    # it is skipped on push / pull_request (they carry no payload) and runs on every other event, known or not
    for event, runs in (("push", False), ("pull_request", False), ("repository_dispatch", True), ("workflow_dispatch", True),
                        ("schedule", True), ("some_future_event", True)):
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
    assert set(ON) == {"push", "pull_request", "repository_dispatch"}, sorted(ON)
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
            for event in ("push", "pull_request", "repository_dispatch"):
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
