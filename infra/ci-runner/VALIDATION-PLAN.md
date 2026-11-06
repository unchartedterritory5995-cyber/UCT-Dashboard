# Validation plan: the ten owner checks

"Done on the PC" means a real container on the owner's PC, at `7f6dd3714d`, image
`sha256:d413a1956ea8b85dcffdd30d7d207011bc2a3fd763484420b0ca58b2531c8134`, 4 CPUs and 10 GiB per container, 2 slots, with
**no runner registered**. Nothing ran through GitHub Actions. Every check must be repeated on the VPS through real Actions
runs before the draft workflow merges, because **only those runs count for a merge decision**: the PC is advisory only.

**Merge-candidate requirement (AUDIT).** `tools/ci_equivalence.py` must exit 0 against a hosted run at the same SHA for the
**first real VPS gate**, and for **every later move** of a job to another machine. Exit 1 or 2 stops the move. It is what
caught the split losing two tests while staying green.

Evidence for the PC results is in the distro at `/srv/uct/results/r1` to `r4`.

| # | Check | On the PC | Still needed on the VPS, through Actions |
|---|---|---|---|
| 1 | Suites execute | **Done** | Yes |
| 2 | Counts match | **Done** | Yes |
| 3 | A pass passes | **Done** | Yes |
| 4 | A deliberate failure fails | **Done** | Yes |
| 5 | Status checks report | Not possible | Yes |
| 6 | Cancelled cannot report success | Partly: promotion logic and a killed container | Yes |
| 7 | Isolation and cleanup | **Done** | Yes |
| 8 | Performance with workers active | Partly | Yes |
| 9 | Outage fails safe | Partly: logic only | Yes |
| 10 | Master gates intact | Rails only | Yes |

## Setup for repeating a check

Run in the distro, or on the VPS with paths adjusted. The suite lock is a Windows tool; on the PC, wrap the command:

```powershell
python tools/agent_suite_lock.py run --who runner-validate -- wsl.exe -d uct-ci -u root -- bash /srv/uct/kit/local_validate.sh <image> /srv/uct/results/<name> list browser:1 browser:2 browser:3 browser:4 server capreg-post capreg-rth fail-pytest fail-vitest pass-vitest
```

Code reaches `/srv/uct/src` as a fresh clone, and each container gets it as a tar on stdin. No API key is set, every key
name is blanked by the launcher, and every test scripts its model, so no paid call is possible.

**This is also the workers' PC advisory run**, now that `agent ci` no longer runs on a push. It reports locally and never
appears on GitHub. To test another commit, fetch it into a scratch clone, pipe that clone's `.git` into a new directory in
the distro, check out there, and set `SRC=<dir>`. The distro holds no credential, so it cannot fetch for itself.

Fetch the hosted side of a comparison, for a run on the same commit:

```sh
gh api "repos/<repo>/actions/runs/<id>/jobs?per_page=100" > hosted/jobs.json
gh run download <id> -D hosted/art
gh api repos/<repo>/actions/jobs/<job-id>/logs > hosted/job.log
```

## 1. Suites execute

- **Run**: `local_validate.sh` as above. On the VPS: a real gate and `agent ci` run.
- **Evidence**: `index.txt` holds one `rc=` per suite; each suite directory holds `summary-*.txt` and the report.
- **PC result**: all suites ran and exited 0: 4 browser shards, server, capreg post and rth.

## 2. Counts match

- **Run**: `python tools/ci_equivalence.py --a <hosted> --b <selfhosted> --sha-a <sha> --sha-b <sha> --require vitest_json`
- **Evidence**: the tool's output and exit code. 0 is EQUIVALENT, 1 DIFFERENT, 2 INCOMPARABLE, and only 0 passes.
- **PC result**, against hosted runs 42156582311 (gate) and 42157593448 (`agent ci`) at the same SHA:

| Suite | Hosted | Container | Verdict |
|---|---|---|---|
| Agent browser, 4 shards | 8722 tests, 8716 passed, 0 failed, 6 skipped, 269 files | Same | EQUIVALENT, per test |
| Agent server | 3654 passed | 3654 passed | EQUIVALENT, totals only |
| `agent-server`, the job's exact steps | 3654 passed | 3654 passed at full history; **3652 passed, 2 skipped at `fetch-depth: 2`** | Compared only at depth 2: DIFFERENT, which caught it |
| Capreg @ post | 13 passed | 13 passed | EQUIVALENT, totals only |
| Capreg @ rth | 3535 passed, 15 files | 3535 passed, 15 files | EQUIVALENT, totals only |

Hosted server and capreg results exist only as log totals, so those three compare totals, not per test.
`vitest list` also reported 269 files in the container.

## 3. A pass passes

- **Run**: `pass-vitest`, plus check 1. On the VPS: a clean PR run.
- **PC result**: exit 0 from a passing test. Equivalence against the failing twin below is what makes this meaningful.

## 4. A deliberate failure fails

- **Run**: `fail-pytest` and `fail-vitest` write a failing test inside the throwaway container, so nothing is committed.
  On the VPS: a throwaway branch with `expect(1).toBe(2)`, then confirm the job is red.
- **PC result**: both exit 1. `ci_equivalence` says DIFFERENT, exit 1, on the real pass/fail pair, and on real shard
  reports with shard 4 removed.
- **AUDIT's proof**: `fail-server` puts a failing test in the gate step's real glob: `1 failed, 3654 deselected`, exit 1. The
  verdict step, executed from the real YAML, is red on `agent-server=failure`, on `skipped` and `cancelled`, and on a missing
  job, for all six jobs (`test_ci_runner_routing.py`). **On the VPS**: repeat with a real failing test on a real gate run.

## 5. Status checks report

- **Run**: on the VPS, read the job through `gh api repos/<repo>/actions/runs/<id>/jobs`. Expect the unchanged check name, the
  conclusion, the exact `head_sha`, a `uct-vps` label, and a `runner_name`. It must be the job's own conclusion on a run
  AUDIT can open, never a commit status.
- **PC result**: not testable without registering a runner. **UNTESTED**.

## 6. Cancelled cannot report success

- **Run**: on the VPS, cancel a job mid-run, then in a separate run `docker kill` the container and stop the runner service
  mid-job. Each must end `cancelled` or `failure`, with the verdict red and promotion refusing.
- **PC result**:
  - Done: `decide` refuses every conclusion except `success`, through the real code. `verdict` requires exact `success`.
  - Done: a real killed container exits 137 and is gone (`launcher_real_docker_check.py`).
  - **UNTESTED**: what GitHub actually reports for a lost runner. This is the part that matters, and it needs a real runner.

## 7. Isolation and cleanup

- **Run**: `uct-ci-isolation-probe`, then `launcher_real_docker_check.py <image>`, as in ISOLATION.md.
- **Evidence**: PASS and FAIL lines, exit code, `events.jsonl`.
- **PC result**: probe 0 failures, control 9 failures. Firewall, sibling, limits, secret placement and no state between
  containers all proved. The launcher passes every check against real Docker, including the disk-fill test and a sweep that
  leaves the other lane alone. 0 containers left after every batch. Details in ISOLATION.md.
- On the VPS, repeat this as a **job**, so the probe runs under a real runner. Set `PROBE_MAX_REPOS=1`.

## 8. Performance with workers active

- **Run**: `local_validate.sh` with workers running, and read `wall=`. On the VPS: real job durations from the API.
- **PC result**, 2 slots, with other sessions active at the start of the batch:

| Job | Hosted | Container | Hosted limit |
|---|---|---|---|
| Browser shards | 12-18 min each | 2.4-4.5 min each | 30 (gate), 25 (`agent ci`) |
| Capreg @ rth | 15.2 min | 3.5 min | 20 |
| Agent server, tests only | 2.0-3.3 min | **6.1 min alone, 9.1 min under load** | 20 |

These numbers are for an i7-13700KF and do not predict a VPS. See 'Sizing'.

## 9. Outage fails safe

- **Run**: on the VPS, stop the runner service, push a harmless master commit in a quiet window, and watch. Expect `ci queue
  watch` to print `RUNNER LOOKS OFFLINE`, cancel the run 45-75 minutes in and go red, the verdict red, and promotion
  refusing. Then restart it, `gh run rerun --failed`, and promote by hand. AUDIT owns this push.
- **Also on the VPS**: fill every `uct-vps` slot with dispatch runs, push to master, and confirm the gate starts at once on
  `uct-vps-gate` and is not cancelled however long the queue. This is AUDIT's B3.
- **PC result**: only the logic. The watch, promotion and verdict are unit-tested. **UNTESTED** against GitHub.

## 10. Master gates intact

- **Run**: `python -m pytest tests/test_ci_cost_rails.py tests/test_ci_runner_routing.py tests/test_uct_agent_deploy_gate.py tests/test_pine_runtime_deploy_gate.py -q`,
  `python tools/check_workflow_expressions.py .github/workflows/*.yml`, `python tools/promotion_gate.py --self-check`.
- **PC result**: all pass. No rail needed changing, and `promote-production.yml` and `promotion_gate.py` are unchanged.
- **UNTESTED**: none of the edited workflows has ever run, because GitHub only runs a workflow once it is pushed.

## Shadow: ten gates before the switch

AUDIT's condition for moving eight workflows on master: `wisdom rails`, `term018 guards`, `Options Flow guard`, `notebook
bytes`, `Notebook accessibility`, `notebook budgets`, `preference allow-list`, `flow-worker deploy coverage`.

- `ci vps shadow` runs them on the VPS on every master push, beside the deciding hosted runs. Promotion never reads it.
- For each of ten real gates, save both sides' job data, then run
  `python tools/ci_equivalence.py --a hosted/<sha> --b shadow/<sha> --require jobs`. All ten must be EQUIVALENT. Use only SHAs
  where the hosted workflow ran, because hosted runs are path-filtered and the shadow is not.
- `notebook budgets` is timing, so its milliseconds will differ even when its outcome matches. Take the re-baseline for
  `docs/notebook/perf-budgets.json` from the shadow's readings before the switch.
- Only then does the switch commit go to AUDIT.

## Sizing

Measured on the PC, per full `agent ci` run: about 30 slot-minutes at 4 CPUs, against about 105 hosted job-minutes.

- Each slot needs 4 CPUs and 10 GiB. Memory peaked at the 10 GiB cap including page cache, with no OOM kill. 8 GiB is untested.
- The VPS runs two lanes. A starting point is 3 `gate-vps` slots and 1 `shared-vps` slot: 16 vCPU and 40 GiB. 2 and 1 is 12 and 30.
- A gate is about 29 slot-minutes at the PC's speed and about 76 at hosted speed, so 3 gate slots is about 25 minutes at worst.
- 1 shared slot serves about 2 `agent ci` runs an hour at the PC's speed. Dispatching once per merge candidate makes that
  plausible. Hosted's old volume of 50 an hour does not fit, and is not meant to.
- Disk: the image is 2.9 GB. Keep 30 GB free.
- A VPS vCPU is usually a hyperthread on a busier, slower host. Measure there before relying on the speed-up above.
