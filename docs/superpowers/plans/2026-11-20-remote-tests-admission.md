# Remote-tests admission control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop on-demand session test runs (`tools/remote_tests.py`) from pushing the master deploy gate's jobs to the back of GitHub's runner queue, without dropping, cancelling or slowing any test request while the pool has room.

**Architecture:** Before it pushes its ref, `tools/remote_tests.py` reads the account's load with at most 4 conditional REST requests and waits (60 s polls plus 0-15 s jitter, 30 min cap by default) while the deploy gate has a job waiting for a runner, or while 4+ remote runs are in flight and other runs are queued. A load it cannot read, and the end of the cap, both dispatch exactly as today. No workflow file changes.

**Tech Stack:** Python 3.12 stdlib, `gh api`, pytest (the existing `_FakeGh` / `_Clock` / `_api` / `_ok` harness in `tests/test_remote_tests_lane.py`).

**Spec:** this document's "Evidence" and "Design" sections (no separate spec). Owner: patrick-fd session, 2026-11-20. Branch `ops/remote-tests-admission`, worktree `D:/uct-worktrees/ci-admission`.

## Evidence (measured 2026-11-20, about 6:30-9:40 PM CT)

- Pool: GitHub Pro = **40 concurrent jobs** for standard runners (docs.github.com/en/actions/reference/limits: Free 20, Pro 40, Team 60, Enterprise 500; "GitHub Support can increase job concurrency limits"). 9:12 PM snapshot: 40 running, 9 waiting.
- Runner-minutes, last 500 runs (~4,600 min): pine heavy (PR) 33%, remote tests 29%, whole-app engine rails (PR) 12%, master deploy gate 6%, everything else 20%.
- **What it costs a deploy.** Gate run 44857170200: created 8:40 PM; jobs created 8:47 (the previous gate still held the `master-deploy` group, which never cancels); jobs started 8:51-9:09 (up to **21.6 min waiting for a runner**); verdict 9:24 = 44 min end to end. Its longest job is ~14 min, so with free runners it is ~16 min. At 9:03 PM (queue empty) gate jobs waited 0.1 min.
- **No waste found to remove.** Pine heavy ran 1-2 times per PR and already cancels on re-push. Remote dispatches are distinct requests (`train-e92-m1` .. `m8`, head/base pairs), not repeats, so per-branch cancelling would not help. The tool already cancels its own run when it gives up (`release_ref`). Tests are 64-91% of job time; checkout is 7-22%; setup is small.
- **GitHub has no job priority.** Every job waits in one queue. The only lever a client has is not to enqueue.
- **A listed `queued` job is waiting for a runner.** Jobs are created only when their `needs:` finish (run 44857170200: `Agent shards cover every Agent test file` created 03:23:05Z right after the last shard; `verdict` 03:24:08Z).
- **11 ghost runs.** All from the 2026-11-11 merge of PR #1120 (`d745a1a`) plus one scheduled promote: listed `queued`, 0 jobs, cancel and force-cancel answer HTTP 409. One is a `master deploy gate` run, which would hold rule A below shut forever without the 6 h freshness filter.

## Design

**Rule** (one decision per check):

- **WAIT** if
  - **A.** a `master deploy gate` run created within `FRESH_RUN_S` is `queued`, or is `in_progress` with at least one job `queued`; or
  - **B.** at least `MAX_REMOTE_IN_FLIGHT` `remote tests` runs created within `FRESH_RUN_S` are `queued` or `in_progress`, **and** at least one run of any workflow created within `FRESH_RUN_S` is `queued`.
- Otherwise **DISPATCH**.

A gate run that is `pending` (waiting on the previous gate's concurrency group) is not waiting for a runner and does not trigger A.

**Signals.** Every one is a conditional GET through `GitHubApi.request(..., conditional=True, wait_out_limits=False)`:
1. `repos/{owner}/{repo}/actions/workflows/master-deploy-gate.yml/runs?per_page=10`
2. `repos/{owner}/{repo}/actions/runs/{id}/jobs?per_page=100` for each fresh `in_progress` gate run (normally 0 or 1)
3. `repos/{owner}/{repo}/actions/workflows/remote-tests.yml/runs?per_page=50`
4. `repos/{owner}/{repo}/actions/runs?status=queued&per_page=100`

**Defaults:**
- `MAX_REMOTE_IN_FLIGHT = 4`: each run holds at most 4 vitest runners plus pytest, so at most 20 of the 40 slots.
- `FRESH_RUN_S = 6 * 3600`
- `ROOM_POLL_S = 60`, `ROOM_JITTER_S = 15`
- `--max-wait-min 30`

**Safety properties:**
- **S1.** It waits BEFORE `git push` of the ref, so a wait that is interrupted leaves no ref and no run behind.
- **S2.** It never cancels, deletes or changes another session's run or ref.
- **S3.** It fails open. Any non-200 answer, malformed body or exception while reading the load means dispatch now, with the reason printed.
- **S4.** The wait is bounded. After `--max-wait-min` it dispatches anyway with a note, so no request is ever dropped. `--max-wait-min 0` skips the check with no request (production incidents only).
- **S5.** The wait does not count against `--timeout-min`, whose clock still starts at dispatch.
- **S6.** Runs older than `FRESH_RUN_S` are ignored, so ghost runs cannot hold it shut.
- **S7.** It is cheap. Each check sends at most 4 requests (304 answers are free), and the jitter spreads waiters out.
- **S8.** No workflow file, deploy gate, PR check or promotion logic changes.

**What sessions will notice.** While the pool has room, nothing changes. While it is full, a request waits on the PC and prints why, and the deploy gate and PR checks get the freed runners first. Total throughput is the same either way, because the pool is full. Under load, remote results may come back somewhat later and deploys sooner.

**Accepted limit.** When several sessions are waiting and room opens, they may all dispatch at once, overshooting the cap by at most the number of waiters (~6). The jitter spreads them out. A queue or lock would be heavier than the harm.

**Adoption is gradual.** The client script runs from each session's own checkout. A branch cut before the merge keeps today's behaviour, which is harmless, until it merges master. The interim note below covers that gap.

## Global Constraints

- Only `tools/remote_tests.py`, `tests/test_remote_tests_lane.py` and `CLAUDE.md` change. `.github/workflows/*` does not.
- No new dependencies: stdlib plus `gh` and `git`, as today.
- Every REST request goes through `GitHubApi.request` (counted, conditional, rate-limit aware). The admission reads pass `wait_out_limits=False`.
- New console text is ASCII.
- Local test runs are focused only: `python -m pytest tests/test_remote_tests_lane.py -q` (feedback_pc_load_limits; never a broad suite).
- Never delete a `refs/remote-tests/*` ref you did not create (CLAUDE.md).
- Ship through a PR to master. `git add` only named files, never `-A`, and never force-push.

## Review Focus

1. A ghost `queued` gate run from 11/11 plus an empty pool must DISPATCH, not wait 30 min. Test in Task 2: `test_admission_a_stale_queued_gate_run_is_ignored`.
2. A `pending` gate run (waiting on the previous gate) must DISPATCH. Test in Task 2: `test_admission_a_pending_gate_run_does_not_wait`.
3. A rate limit, 5xx or network error while reading must dispatch now, with no sleep (not the hour-long rate-limit sleep). Test in Task 3: `test_read_load_returns_none_on_any_error_and_never_sleeps`.
4. A session killed mid-wait must leave no pushed ref. Test in Task 4: `test_main_waits_before_it_pushes_the_ref`.
5. Waiters must not poll in lockstep: every sleep must fall in [60, 75] s. Test in Task 4: `test_wait_for_room_polls_with_jitter_until_room`.

---

### Task 1: Delete the 11 ghost runs (ops, no code)

**Files:** none.

- [ ] **Step 1: Re-check each run is still a ghost.** For each id in `43097842088 43096652085 43096652206 43096652064 43096652073 43096652274 43096652281 43096652068 43096652114 43096651999 43096651992`:
  `gh api repos/unchartedterritory5995-cyber/UCT-Dashboard/actions/runs/<id> -q '"\(.status) \(.created_at)"'` should print `queued 2026-11-11...`, and `gh api .../runs/<id>/jobs -q .total_count` should print `0`. Skip any id that differs and report it.
- [ ] **Step 2: Delete each one that passed.** Run `gh api -X DELETE repos/unchartedterritory5995-cyber/UCT-Dashboard/actions/runs/<id>`. Expected: exit 0 (HTTP 204).
- [ ] **Step 3: Verify.** Run `gh run list -R unchartedterritory5995-cyber/UCT-Dashboard --status queued --created "<2026-11-20" --json databaseId -q length`. Expected: `0`.

### Task 2: The decision, `room_to_dispatch`

**Files:**
- Modify: `tools/remote_tests.py`. Add a new section `# ---- admission: wait for room before enqueueing (2026-11-20) ----` after `quota_line`.
- Test: `tests/test_remote_tests_lane.py`. Add a new section at the end.

**Interfaces:**
- Produces:
  - `MAX_REMOTE_IN_FLIGHT = 4`, `FRESH_RUN_S = 21600`
  - `_epoch(iso: str | None) -> float | None`: GitHub `...Z` timestamp to epoch seconds; `None` for missing or unparseable.
  - `room_to_dispatch(gate_runs: list[dict], gate_jobs: dict[str, list[dict]], remote_runs: list[dict], queued_runs: list[dict], now: float) -> tuple[bool, str]`. Runs and jobs are REST objects (`id`, `status`, `created_at`). `gate_jobs` is keyed by `str(run["id"])`. A run whose `created_at` is missing, unparseable or older than `FRESH_RUN_S` is ignored. The reason string names the rule (`"deploy gate run <id> has <n> job(s) waiting for a runner"`, `"deploy gate run <id> is queued"`, `"<n> remote runs in flight and <m> run(s) queued"`, or `"room"`).

- [ ] **Step 1: Write the failing tests.** Use `NOW = rt._epoch("2026-11-21T03:10:00Z")` and the helper `def _run(i, status, at="2026-11-21T03:00:00Z"): return {"id": i, "status": status, "created_at": at}`.

```python
def test_admission_empty_pool_dispatches():
    assert rt.room_to_dispatch([], {}, [], [], NOW) == (True, "room")

def test_admission_gate_job_waiting_for_a_runner_waits():
    ok, why = rt.room_to_dispatch([_run(9, "in_progress")], {"9": [{"status": "in_progress"}, {"status": "queued"}]}, [], [], NOW)
    assert not ok and "deploy gate run 9" in why and "1 job(s) waiting" in why

def test_admission_gate_running_with_no_job_queued_dispatches():
    assert rt.room_to_dispatch([_run(9, "in_progress")], {"9": [{"status": "in_progress"}]}, [], [], NOW)[0]

def test_admission_a_queued_gate_run_waits():
    ok, why = rt.room_to_dispatch([_run(9, "queued")], {}, [], [], NOW)
    assert not ok and "is queued" in why

def test_admission_a_pending_gate_run_does_not_wait():
    assert rt.room_to_dispatch([_run(9, "pending")], {}, [], [], NOW)[0]

def test_admission_a_stale_queued_gate_run_is_ignored():
    assert rt.room_to_dispatch([_run(43096652068, "queued", "2026-11-11T20:32:25Z")], {}, [], [], NOW)[0]

def test_admission_four_remote_runs_and_a_queued_run_waits():
    remote = [_run(i, "in_progress") for i in range(4)]
    ok, why = rt.room_to_dispatch([], {}, remote, [_run(50, "queued")], NOW)
    assert not ok and "4 remote runs in flight" in why

def test_admission_four_remote_runs_and_nothing_queued_dispatches():
    assert rt.room_to_dispatch([], {}, [_run(i, "in_progress") for i in range(4)], [], NOW)[0]

def test_admission_three_remote_runs_and_queued_runs_dispatches():
    assert rt.room_to_dispatch([], {}, [_run(i, "queued") for i in range(3)], [_run(50, "queued")], NOW)[0]

def test_admission_stale_remote_and_queued_runs_are_ignored():
    old = "2026-11-11T20:32:25Z"
    assert rt.room_to_dispatch([], {}, [_run(i, "queued", old) for i in range(6)], [_run(50, "queued", old)], NOW)[0]
```

- [ ] **Step 2: Run them and confirm they fail.** `python -m pytest tests/test_remote_tests_lane.py -q -k admission`. Expected: FAIL with `AttributeError: module 'tools.remote_tests' has no attribute '_epoch'`.
- [ ] **Step 3: Implement** `_epoch` and `room_to_dispatch` with the constants above, in the new section. Rule A is checked before rule B. Use `datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()` inside a `try` that returns `None` on failure.
- [ ] **Step 4: Run them and confirm they pass.** Same command. Expected: 10 passed.
- [ ] **Step 5: Commit.** `git add tools/remote_tests.py tests/test_remote_tests_lane.py`, then `git commit -m "feat(remote-tests): room_to_dispatch decides when the pool can take another run"`.

### Task 3: Reading the load, `read_load`

**Files:** the same two files and section as Task 2.

**Interfaces:**
- Consumes: `GitHubApi.request`, `_REPO`, `_epoch`, `FRESH_RUN_S` (Task 2).
- Produces:
  - `@dataclass class Load: gate_runs: list[dict]; gate_jobs: dict[str, list[dict]]; remote_runs: list[dict]; queued_runs: list[dict]`
  - `read_load(api: GitHubApi) -> Load | None`. It sends the 4 signal requests in the Design's order. Request 2 is sent only for gate runs that are `in_progress` and fresh. Every request is `conditional=True, wait_out_limits=False`. It returns `None` on any status other than 200, on a body missing `workflow_runs` or `jobs`, or on `RuntimeError` or `OSError`.

- [ ] **Step 1: Write the failing tests.** They use the existing `_api`, `_ok` and `_Clock`. A fresh run is created at the clock's `now()` (`time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(clock.t))`).
  - `test_read_load_sends_the_four_reads_in_order`: one fresh `in_progress` gate run (id 9). Assert `[c[1] for c in fake.calls]` equals the 4 paths in Design order with `{id}` set to 9, every method is `GET`, and `len(fake.calls) == 4`.
  - `test_read_load_skips_jobs_when_no_gate_is_running`: gate runs `[]`. Assert 3 calls, none containing `/jobs`.
  - `test_read_load_returns_none_on_any_error_and_never_sleeps`: parametrize the first answer over `(403, {"x-ratelimit-remaining": "0", "x-ratelimit-reset": "1000900"}, "rate limit")`, `(500, {}, "")`, `(0, {}, "")` and `_ok({"unexpected": 1})`. Assert the result is `None`, `clock.sleeps == []`, and `len(fake.calls) == 1`.
  - `test_read_load_repeat_check_is_conditional`: call it twice with an ETag on the first answers. Assert the second round's first call carries `If-None-Match`.
- [ ] **Step 2: Run them and confirm they fail.** `python -m pytest tests/test_remote_tests_lane.py -q -k read_load`. Expected: FAIL, `no attribute 'read_load'`.
- [ ] **Step 3: Implement** `Load` and `read_load` (`from dataclasses import dataclass`).
- [ ] **Step 4: Run them and confirm they pass.** Same command. Expected: all pass.
- [ ] **Step 5: Commit.** `git commit -m "feat(remote-tests): read_load reads gate, remote and queued runs in <=4 conditional requests"`

### Task 4: Waiting, `wait_for_room`, wired into `main()` before the push

**Files:** the same two files. `main()` sits at `tools/remote_tests.py:560-636` on master `1fe40a6f2c`.

**Interfaces:**
- Consumes: `read_load`, `room_to_dispatch` (Tasks 2 and 3).
- Produces:
  - `ROOM_POLL_S = 60`, `ROOM_JITTER_S = 15`
  - `wait_for_room(api: GitHubApi, max_wait_s: float, log=print, rand=random.random) -> str`. It returns one of:
    - `"skipped"`: `max_wait_s <= 0`, and no request was sent;
    - `"room"`;
    - `"unreadable"`: `read_load` returned `None`;
    - `"waited-out"`: elapsed time reached `max_wait_s`.
  - Between checks it sleeps `ROOM_POLL_S + rand() * ROOM_JITTER_S` using `api.sleep`, and measures time with `api.now`. It logs the reason once whenever it changes, with minutes waited. For `"waited-out"` it logs `"remote tests: waited <n> min for room; dispatching anyway"`.
  - New CLI flag `--max-wait-min` (int, default 30, help: `"wait up to N min for CI room before dispatching (0 = do not wait; production incidents only)"`).
  - In `main()`, `wait_for_room(api, a.max_wait_min * 60)` runs after the quota line and before the `pushing ... to ...` print and the `git push`. Its result is printed as `remote tests: admission <result>`.

- [ ] **Step 1: Write the failing tests.**
  - `test_wait_for_room_returns_at_once_when_there_is_room`: monkeypatch `rt.read_load` to return an empty `Load`. Assert the result is `"room"` and `clock.sleeps == []`.
  - `test_wait_for_room_polls_with_jitter_until_room`: `read_load` returns a crowded `Load` twice, then an empty one. Use a `rand` that returns 0.0 then 1.0. Assert the result is `"room"` and `clock.sleeps == [60.0, 75.0]`.
  - `test_wait_for_room_gives_up_after_max_wait_and_dispatches`: always crowded, `max_wait_s=300`, `rand` returns 0.0. Assert the result is `"waited-out"` and `sum(clock.sleeps) >= 300`.
  - `test_wait_for_room_unreadable_load_dispatches_now`: `read_load` returns `None`. Assert `"unreadable"` and no sleeps.
  - `test_wait_for_room_zero_skips_the_check_without_a_request`: `max_wait_s=0`. Assert `"skipped"` and `fake.calls == []`.
  - `test_main_waits_before_it_pushes_the_ref`: monkeypatch:
    - `rt._run` to record each cmd and answer `git rev-parse HEAD` with a 40-hex sha and `git status` with `""`;
    - `rt.shutil.which` to return a path;
    - `rt.GitHubApi.quota` to return `None`;
    - `rt.wait_for_room` to append `"WAIT"` to the same record;
    - `rt.dispatch` to return `("1", "u")`;
    - `rt.wait_for_run` to record its `timeout_s` and return `None`;
    - `rt._delete_ref` to record its ref. ⛔ This one is required: `release_ref` calls `_delete_ref`, which runs a REAL `git push origin :<ref>` through `subprocess.run`, not `_run`, so the `_run` patch does not cover it.

    Then run `rt.main(["--pytest", "tests/test_a.py"])`. Assert `"WAIT"` comes before the first recorded cmd starting `["git", "push", "--quiet", "origin"]` whose last element contains `":refs/remote-tests/"` with a sha prefix, and the recorded `timeout_s == 3600`. In a second case, `wait_for_room` raises `KeyboardInterrupt`. Assert `pytest.raises(KeyboardInterrupt)`, and no recorded cmd is a push of `<sha>:refs/remote-tests/...`.
- [ ] **Step 2: Run them and confirm they fail.** `python -m pytest tests/test_remote_tests_lane.py -q -k "wait_for_room or main_waits"`. Expected: FAIL.
- [ ] **Step 3: Implement** `wait_for_room`, the flag and the call in `main()` (`import random`).
- [ ] **Step 4: Run the whole lane file.** `python -m pytest tests/test_remote_tests_lane.py -q`. Expected: all pass, including every test that existed before.
- [ ] **Step 5: Commit.** `git commit -m "feat(remote-tests): wait for CI room before pushing the ref (fails open, 30 min cap)"`

### Task 5: Tell every session

**Files:**
- Modify: `CLAUDE.md`, section "Heavy tests run on GitHub" (on master `1fe40a6f2c` it is lines ~88-106). Add one paragraph after the "Exit 0 green..." paragraph.
- Modify: `tools/remote_tests.py`. In the module docstring, add step "0. waits for CI room (see the admission section)". In the comment above `MAX_SHARDS`, replace "(14 jobs)" with "(read the gate's own job list; this comment does not restate its size)", because it is 16 today.
- Test: `tests/test_remote_tests_lane.py`.

- [ ] **Step 1: Write the failing test.**

```python
def test_claude_md_documents_the_admission_wait():
    text = (ROOT / "CLAUDE.md").read_text(encoding="utf-8")
    assert "--max-wait-min 0" in text and "waits for room" in text
```

- [ ] **Step 2: Run it and confirm it fails.** `python -m pytest tests/test_remote_tests_lane.py -q -k claude_md`. Expected: FAIL.
- [ ] **Step 3: Write the CLAUDE.md paragraph.** It must say each of these:
  - the tool now **waits for room** before it enqueues, while the deploy gate has a job waiting for a runner or 4+ remote runs are in flight with runs queued, and prints why;
  - the wait is capped at 30 min and then it dispatches anyway, and a wait that is stopped leaves nothing behind;
  - `--max-wait-min 0` is for a production incident only;
  - send one request per finished change (not one per step of a train), request only the shards you need, and do not re-dispatch while one of yours is still queued or running.
- [ ] **Step 4: Run it and confirm it passes.** `python -m pytest tests/test_remote_tests_lane.py -q`. Expected: all pass.
- [ ] **Step 5: Commit.** `git add CLAUDE.md tools/remote_tests.py tests/test_remote_tests_lane.py`, then `git commit -m "docs(remote-tests): CLAUDE.md documents the admission wait and batching"`

### Task 6: Ship and verify it live

- [ ] **Step 1: Push and open the PR.** `git push -u origin ops/remote-tests-admission`, then open a PR to master. The body cites the Evidence section and the safety properties S1-S8.
- [ ] **Step 2: Wait for the PR checks.** Expected: green. A red check gets a fix-forward commit; nothing is skipped.
- [ ] **Step 3: Merge** under the standing deploy GO, then report the impact.
- [ ] **Step 4: Smoke test from this worktree after merging master.** Run `python tools/remote_tests.py --pytest tests/test_remote_tests_lane.py --label admission-smoke`. Expected: a `remote tests: admission room` line (or `waiting` lines while busy), then GREEN.
- [ ] **Step 5: Measure in the next busy period** (30 or more jobs running). For each `master deploy gate` run, compute the largest `started_at - created_at` over its jobs:
  `gh api "repos/unchartedterritory5995-cyber/UCT-Dashboard/actions/runs/<gate id>/jobs?per_page=100" -q '[.jobs[] | select(.started_at) | ((.started_at|fromdate) - (.created_at|fromdate))] | max / 60'`
  Target: under 5 min (it was 21.6 min on 2026-11-20). Record the numbers in the PR thread. If it is over target while remote runs are waiting, rule A is not firing: debug before changing any constant.

---

## Interim note sent to the other sessions (2026-11-20)

```
From patrick-fd (CI backlog, 11/20): GitHub Actions hit its 40-job limit tonight and
deploy gate jobs waited up to 22 min for a runner (a 16 min gate took 44). Remote tests
were 29% of runner time. patrick-fd is building a throttle in tools/remote_tests.py
(plan: D:/uct-worktrees/ci-admission/docs/superpowers/plans/2026-11-20-remote-tests-admission.md);
please do not edit that file or its test meanwhile. Until it merges and your branch has master:
- one remote-tests request per finished change, not one per step of a train
- request only the tests and shards you need
- do not dispatch again while one of yours is still queued or running
Nothing else about your work changes, and nothing of yours will be cancelled. No reply needed.
```

## Owner actions (not code)

1. **Ask GitHub Support for a higher concurrency limit** (free, about 10 min; github.com/contact/support, topic Actions). Draft:
   > My account runs a public repository (UCT-Dashboard) on GitHub Pro. During working hours we regularly saturate the 40-job concurrency limit for standard Linux runners, and our deploy pipeline waits up to 20 minutes for a runner. Could you raise the concurrent job limit for this account (to 60 or more)? Happy to share run ids.
   >
   > Separately, 11 workflow runs from 2026-11-11 are stuck as "queued" with 0 jobs. Cancel and force-cancel return HTTP 409 ("has not been queued yet" / "is completed"), and DELETE returns HTTP 403 "Could not delete the workflow run", with an admin token that has the repo and workflow scopes. Could you clear them? Run ids: 43097842088, 43096652085, 43096652206, 43096652064, 43096652073, 43096652274, 43096652281, 43096652068, 43096652114, 43096651999, 43096651992.

   (Task 1 tried on 2026-11-20 and GitHub refused every DELETE with HTTP 403. The admission rule's 6 h freshness filter (S6) is what keeps these from holding the throttle shut.)
2. **If the limit stays at 40 and deploys still wait,** consider moving the repo into a GitHub organization on Team (60 jobs). That needs its own plan: Railway's GitHub connection, repo secrets, tokens and branch protection all move.

## Measured options NOT in this plan (decide later)

- **Pine heavy has no `max-parallel`.** Each PR starts ~16 jobs at once, and three Pine PRs fill the pool. A cap would protect deploys further, but it would lengthen every pine heavy run, even when idle, by a few minutes. That is the Pine sessions' file and the owner's call.
- **Checkout is 22% of remote-tests job time** (43 s/job, full history) **and 20% of whole-app engine rails** (58 s/job). A history-light checkout would save roughly 3% of all runner minutes, but tests that read old commits throw by name without history. Measure separately; the workflow comes from master, so test with a branch dispatch first.
