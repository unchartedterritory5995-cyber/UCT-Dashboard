# W5-T19 Gate + runbook: evidence

Lane: W5-T19 (docs/pine/SERVER-RUNTIME-DESIGN.md section 7 "T19 Gate + runbook", section 8, 3.8), desktop machine.
Branch `feat/pine-w5-t19-gate`. No Railway, no flags, no GitHub settings, no workflow run: the workflow is edited on this branch only.

**Base (merge commit, recorded): `3ce311e502`** = origin/feat/pine-w5-t10-image `a1523b3897` (T1 -> T6 -> T7 -> T10) merged `--no-ff` with
origin/feat/pine-w5-t4-host-parity `09753c9426` (r1) and origin/feat/pine-w5-t11-client `86218da704`. Both merges clean. T9 was NOT merged
(its smoke is a post-deploy tool the runbook references by name; no gate step needs it). T2 was NOT merged (see "Needs T2 first").
Tested on master `5d95103c8a` (merge-base with origin/master). Engine bump: **NO** (workflow, tool CLI summary, docs and tests only;
SCRIPT_ENGINE_VERSION untouched).

## What is new
- `.github/workflows/master-deploy-gate.yml`: eight steps `Pine runtime - ...` after `UCT Agent browser tests`, before `Explain a failure`
  (section 8 steps 1-7 plus a Node-agreement step). No `if:`, no `continue-on-error`.
  0. runner Node major equals the image's `FROM node:` major, read from `services/pine_runtime/Dockerfile` (the pin is not retyped);
  1. `node scripts/build-pine-runtime.mjs` then import the bundle under bare Node (in `app/`);
  2. `node tools/pine_runtime_host_parity.mjs --host node --check` and `--mutation-control` (HP-1, HP-4, HP-5);
  3. `pytest tests/test_pine_runtime_engine_identity.py` (HP-6, HP-7), production dependency set;
  4. `node tools/pine_runtime_closure.mjs --check` (T2);
  5. `node --test services/pine_runtime/test/*.test.mjs`;
  6. pytest of the client, codec, stamps, telemetry, switch-on and this gate's own rail;
  7. `pytest tests/test_pine_runtime_dockerfile.py`.
  The Chromium half (HP-2/HP-3), the C18 count and the post-deploy smoke are not gate steps (design section 8); the rail asserts none is.
- `tests/test_pine_runtime_deploy_gate.py` (25 tests): parses the real workflow with PyYAML. Steps present, exactly once, contiguous, ordered,
  after the app `npm ci`, before the failure explainer; none conditional or optional; exact commands for steps 1, 2, 4, 5; every
  `tests/test_pine_runtime_*.py` on disk is named by some step (a future T12/T17 file that no step runs turns it red); production venv
  used; ONE `setup-node` whose major equals the image pin which equals `Dockerfile.web`'s; the Node step is EXECUTED under bash with a fake
  `node` (passes on the image's major, fails on 19 and 22, fails when the Dockerfile cannot be read); the image must COPY what T9's canary
  imports the day `canary.mjs` exists (self-arming); the runbook lists the service's `railway.json` watch patterns and the commands/vars the owner needs.
- `docs/runbooks/pine-runtime-service.md`: pre-merge checklist, gate table and how to read a red, the HP-1/Node 20 rule, the exact Railway
  steps for T20 (owner only), smoke exit codes, staged arming, rollback, deploy tier. Pre-merge checklist carries T10's open item (the image
  must ship `tools/pine_runtime_host_parity.mjs`, `runtime/columnDigest.js`, `runtime/__fixtures__/hostParity/**` once T9's canary lands) and says
  the image has never been built.
- `docs/runbooks/deploy-windows.md`: one paragraph (pine-runtime is Tier 1; an engine push restarts web and pine-runtime).
- `tools/pine_runtime_host_parity.mjs` (T4's file, minimal): `checkAgainst` reports the NAMED `reportOnly` cases when the running V8 differs
  from `recordedOn.v8`; new exported `hp1Summary`.
- `app/.../runtime/__tests__/hostParity.v8.rail.test.js` (9 tests).

## The HP-1 / Node 20 decision (proposal; coordinator to confirm or replace)
Fact (W5-T4 r1 evidence, reproduced here with the portable Node v20.18.0 / V8 11.3.244.8): HP-1 against digests recorded on Node 24 / V8 13.6 is
red on exactly `transcendental@forming` and `transcendental@listing`; 164 of 166 equal.

Implemented (smallest, reversible): **extend T4's named reportOnly list to HP-1, only when the running V8 differs from `recordedOn.v8`.**
Only the two named cases, only when their sole difference is the digest, only when the V8 moved. On the recording V8 all 166 are gated; any
other case or field is red; a missing `recordedOn`/V8 is "not moved" (gated). Output on Node 20:
`HP-1 GREEN: 164/166 cases equal the committed digests; 2 REPORTED, not gated (V8 differs from the recording V8)`.
Cost, stated: a real trig regression that changes only those two digests passes the Node 20 gate; the coordinator's pre-merge HP-1 on the
recording V8 (Node 24) and the Chromium half catch it. No pattern widens a pass.

Alternatives, not implemented:
1. **Per-V8 digests**: record a second `expected-digests.json` keyed by V8 (gate Node 20 gets its own). Keeps all 166 gated on both V8s, but
   doubles the file the coordinator regenerates at every engine bump, needs `--write` run on Node 20 too (a portable Node in the bump
   procedure), and records whatever Node 20's libm does as truth, with no independent check that it is right.
2. **Option (a), a JS sin/cos in the runtime**: removes the dependence on V8's libm, makes HP-1/HP-3 bit-identical on every V8 with no list.
   Engine-wide, output-changing (engine bump, measure-pair on both lanes, accuracy risk against TradingView). The report-only list is deleted when it lands.
3. **Run the gate on Node 24**: bit-equal to the recorded digests, but breaks "same Node as the image" (the image is 20.18.0, V8 11.3), and
   the gate would then not exercise the V8 production runs.

## Coordinator-facing statements (plain)
(a) **The HP-1 Node 20 choice is a PROPOSAL for the coordinator, not a ruling.** The implemented report-only-on-a-moved-V8 rule leaves one gap: a real
trig-only regression that changes only the two named digests passes the Node 20 gate; only the pre-merge HP-1 on the recording V8 (Node 24) and the
Chromium half catch it. Alternatives (per-V8 digests; JS sin/cos in the engine; gate on Node 24) are listed under "The HP-1 / Node 20 decision". Replace the choice if you prefer another.
(b) **The closure step (step 4) makes the gate RED on any master that lacks W5-T2.** Merge order T2 BEFORE T19 is mandatory.

## Results
Real Node v20.18.0 (portable zip unzipped in a scratch dir; no install, PATH only inside the job; the job aborts if `node -v` is not v20.18.0),
the gate's own commands, tip code at the time of the run, lock `heavy-final3.lock`, log `_resume-2026-11-01/runs/dsk-w5t19-n20b.out`:
| step | result |
|---|---|
| 1 build + import | rc 0, 1 s, `bundle imports` |
| 2 `--check` | rc 0, 10 s, 164/166 equal, 2 REPORTED (V8 11.3 vs recorded 13.6), HP-1 GREEN |
| 2 `--mutation-control` | rc 0, 11 s, `HP-4 GREEN: the perturbed bundle is red on 35 case(s)` |
| 5 `node --test services/pine_runtime/test/*.test.mjs` | rc 0, 9 s, 72 tests, 72 pass |
(A first run, `dsk-w5t19-n20.out`, used Node 24 because of a PATH form error in my script; it is not counted. The script now asserts the version.)
The added gate time is about 1 minute for these steps plus the pytest steps (a few seconds each); the 40-minute job timeout (23.5 min used
on 2026-11-02) is left unchanged.

Not run: actionlint is not installed and was not installed; the workflow parses as YAML (PyYAML) and the rail executes the one shell step
that holds logic. Docker is not installed: the image (T10) was not built, so "the gate builds the image" is not claimed; section 8 does not
ask for it, and the runbook's checklist item 4 tells the coordinator to build it once before the owner creates the service.
Steps 3, 6, 7 run under `/tmp/prodvenv` in CI; locally they were run with the desktop Python, not the production dependency set.

## Needs T2 first
Step 4 (`node tools/pine_runtime_closure.mjs --check`, CLI verified in W5-T2's `tools/pine_runtime_closure.mjs` header and its EVIDENCE: `--check`,
`--repo DIR`, exit 1 on any finding, 0 findings on its tip) is in the workflow. On this branch the tool is absent, so the rail proves the step's
name, exact command and position (between steps 3 and 5), not its run. T2 must reach master before (or with) this workflow, or the gate is
red by design (a step that skipped a missing tool would read green while checking nothing). T2 was not merged here.

## Rails red on base, green on tip
On the base (`3ce311e502`) `tests/test_pine_runtime_deploy_gate.py` and `hostParity.v8.rail.test.js` do not exist; the workflow has no Pine step, so
every test in them is red on the base by construction (parse finds none of the named steps; the V8 rail's `hp1Summary` and V8 branch are absent).
Green on tip: pytest 25 passed; vitest 9 passed.

## Mutation table
Commands: `python docs/pine/evidence/2026-11-04-w5-t19/mutate_pytest.py muts-py.json tests/test_pine_runtime_deploy_gate.py` (repo root) and,
from `app/`, `python $S/mutate.py ../docs/pine/evidence/2026-11-04-w5-t19/muts-vitest.json src/components/chart/engine/runtime/__tests__/hostParity.v8.rail.test.js`;
lock `dsk/heavy-mut.lock`, logs `runs/dsk-w5t19-mut.out` (vitest part) and `dsk-w5t19-mut3.out` (pytest part); restores byte-exact, asserted. Generator: `make_muts.py`.
**Pytest rail: 28 of 28 real mutations killed; control survived.** Workflow: drop `--check`, drop the HP-4 control, add the Chromium half,
drop the import, wrong working directory, `continue-on-error`, `if: always()`, `node --test` on a directory not the glob, `|| true`, wrong
python, drop the codec file, drop this rail from step 6, rename step 7, run the wrong pytest file, `node-version: '22'`, drop the Node comparison,
read the wrong Dockerfile for the Node pin, a pine step before the npm install, a second `setup-node`, step 7 before step 6, step 4 dropped /
without `--check` / renamed / moved. Self-arming: a temp `services/pine_runtime/canary.mjs` turns the image rail red. Docs: drop a watch path,
drop "never been built", drop the columnDigest line, drop the deploy-windows pointer.
**Vitest rail: 12 of 12 real mutations killed; control survived.** V8 always moved; V8 comparison dropped; missing V8 counted as moved;
unlisted case reported; any field reported; report lines not emitted / without the recorded V8 / without the reason; diffs not narrowed;
summary without the subtraction / without the suffix / code 2 as red.
(The first pytest run used a stale mutation file: one row was a BADMATCH, since fixed, and one referred to a deleted test; the table above is the re-run.)

## final-tip
Command: `bash $S/final-tip.sh pine-dsk-w5t19 dsk-w5t19-final tests/test_pine_runtime_deploy_gate.py tests/test_pine_runtime_dockerfile.py tests/test_pine_runtime_engine_identity.py tests/test_promotion_control.py tests/test_uct_agent_deploy_gate.py`,
lock `dsk/heavy-final3.lock` (held 39.6 min), code tip `ff5445c33a`, tested on master `5d95103c8a`. Log `_resume-2026-11-01/runs/dsk-w5t19-final.out`.
- gate pytest (4 files): 46 passed. Hygiene: clean (34,779 files).
- rails pytest (5 files): 63 passed, **1 failed**: `test_uct_agent_deploy_gate.py::...[UCT Agent browser tests]`. Cause, mine: that rail reads the text between
  one `- name:` and the next, and my explanatory comment (which sits before the first Pine step, so inside the Agent browser step's span) contained the
  literal words `if:` / `continue-on-error`. Fixed in the following commit by rewording the comment; re-run after the fix:
  `pytest tests/test_uct_agent_deploy_gate.py tests/test_pine_runtime_deploy_gate.py tests/test_promotion_control.py` = 47 passed. The full final-tip
  was NOT repeated on the comment-only fix (the changed file is a workflow comment, not read by vitest; queue time was 1.5 h).
- full chart+hooks vitest: Test Files 1 failed | 1337 passed | 27 skipped (1365); the only failure is the baseline `pollingSites.rail`.
  `hostParity.v8.rail.test.js` (9) and `hostParity.rail.test.js` passed in the run.


### final-tip, second run on the final tree (`d174e885fb`)
Command: same pytest files, label `dsk-w5t19-final2`, lock `dsk/heavy-final3.lock` (held 48.9 min), log `_resume-2026-11-01/runs/dsk-w5t19-final2.out`.
Gate pytest 46 passed; hygiene clean; rails pytest 64 passed, 0 failed; full chart+hooks vitest: Test Files 1 failed | 1337 passed | 27 skipped (1365); the only failure is baseline `pollingSites.rail`.
This supersedes the first run's rails failure above.

## Open items
- T2 must merge first (above). T9 merge needs the Dockerfile COPY lines (checklist item 3; the rail arms itself).
- Whether `tools/pine_runtime_service_smoke.py` is present inside the web image, for running the smoke from the private network, is unverified.
- The service's `ENV_ALLOWLIST` may not list every variable Railway injects; the first boot log is the proof (runbook step 7).
- The Python steps in CI use `/tmp/prodvenv`, which the earlier agent step installs pytest and httpx into; if that step is ever reordered after these, they break (the rail pins the order).

## Round r1 (independent review NO-GO @b6c5668922: B1, B2, B3)
**Merge order (hard): T1, T3, T6, T7, T10, T11, T17, T2, T4 r2, THEN T19.** T19's own diff is only the gate job, the runbook, the rail and these docs;
until those lanes are on master, this branch carries them in (it is stacked on them).
- **B1**: merged origin/master `ceee4597a0` (conflict in `master-deploy-gate.yml`, resolved by taking master's file whole and adding). The Pine steps
  are now their OWN job `pine-runtime` (own checkout, setup-python, setup-node '20', `npm ci` in `app/`, own `/tmp/prodvenv`), added to `verdict.needs`
  and to the verdict's success condition. The only master lines touched are those three `verdict` lines; `gate`, `agent-browser` and `agent-browser-union` are untouched
  (the rail asserts none mentions Pine). Rail rewritten to parse the job: steps contiguous and ordered after the job's own `npm ci`; the job has no `if`/`needs`/`continue-on-error`;
  `verdict.needs` holds it AND the others, `verdict.if == always()`, and the verdict tests `needs.pine-runtime.result`; exactly one `setup-node` in the job and every other job's
  Node pin equals the image's major. 27 tests.
- **B2**: merged W5-T4 r2 `da8da64717`. `tools/pine_runtime_host_parity.mjs` is now byte-for-byte T4's (no diff against `origin/feat/pine-w5-t4-host-parity`); my copy of the V8 rule is gone and the rule lives in
  T4's `classifyDiffs` (one authority). My `hostParity.v8.rail.test.js` (9 tests) is kept as an independent rail on T4's behaviour and passes against T4's tool. Its former mutation table is withdrawn (T4 r2 carries the mutations of that code).
- **B3**: step 6 names `tests/test_pine_runtime_composition.py` (design section 8); the rail asserts it. The file is W5-T17's: on this branch it does not exist, so step 6 is red until T17 is on master (merge order above).
- N2 done (runbook: no Shared Variables, `VITE_*` ARGs unset, W5-INT cross-reference). N1 (`corpus.json` reason text) is T4's file; not touched here.
- Mutation re-run (`runs/w5t19r1/mut2.out`, lock `heavy-mut`): **34 of 34 real mutations killed, control survived** (new rows: job conditional, job missing from `verdict.needs`, verdict not testing the result,
  composition dropped from step 6, non-production dependency set, a second setup-node, another job's Node pin moved, install step ordering).
- Node 20 and the earlier tested-on-master numbers above predate the restructure; the new-master final-tip is below.

### r1 final-tip (code tip `b32a212234`, includes master `ceee4597a0` and T4 r2 `da8da64717`)
Command: `bash $S/final-tip.sh pine-dsk-w5t19 dsk-w5t19r1-final tests/test_pine_runtime_deploy_gate.py tests/test_pine_runtime_dockerfile.py tests/test_pine_runtime_engine_identity.py tests/test_promotion_control.py tests/test_uct_agent_deploy_gate.py`,
lock `dsk/heavy-final3.lock`, log `_resume-2026-11-01/runs/w5t19r1/final.out`, tested on master `ceee4597a0`.
- gate pytest: 46 passed. Hygiene: clean (35,190 files). Rails pytest: 66 passed.
- full chart+hooks vitest: Test Files 2 failed | 1336 passed | 27 skipped; the two failures are the declared baselines `pollingSites.rail` and `settingsScope.rail`.
- Vitest under Node 20.18: the app's vitest toolchain cannot start on Node v20.18.0 (`require() of ES Module .../@exodus/bytes` from jsdom's dependency), so the vitest rails were not run under Node 20.
  What was run under Node 20.18 (V8 11.3) is the CLI the gate runs: see "Results" (earlier run) for steps 1, 2, 5; the rail's own end-to-end test runs `--check` on whatever Node runs vitest (Node 24 here).
  CI uses `setup-node '20'` (a current 20.x), where this does not arise; the gate job runs the CLI, not vitest.
- T4 r3 (stale vitest rail fix) was not pushed when this ran; if it lands, merge it and re-run (open item).

### r1b: T4 r3 merged
T4 r3 `86c2cf4e7c` merged `--no-ff`, clean (r3 changes T4's stale vitest rail and evidence only; the tool file is still byte-for-byte T4's).
Node v20.18.0 CLI re-run on the merged tree (`runs/w5t19r1/n20.out`): build+import rc 0; `--check` rc 0, `HP-1 GREEN: 164/166 ...; 2 REPORTED`; `--mutation-control` rc 0, red on 35 cases; `node --test` rc 0.
The r1 final-tip above predates this merge; the final-tip for the pushed tip is the next block (second r1 run).

### r1 FINAL final-tip (tested tree `569b07903f` = pushed tip's code; includes master `ceee4597a0`, T4 r3 `86c2cf4e7c`)
Command as before, label `dsk-w5t19r1-final2`, lock `heavy-final3.lock` (held 32.5 min), log `_resume-2026-11-01/runs/w5t19r1/final2.out`.
Gate pytest 46 passed; hygiene clean; rails pytest 66 passed, 0 failed; full chart+hooks vitest: Test Files 2 failed | 1336 passed | 27 skipped (the two baselines `pollingSites.rail` and `settingsScope.rail`).
Vitest rails under Node v20.20.2 (portable, scratch): `hostParity.v8.rail.test.js` + T4's `hostParity.rail.test.js` = 2 files, 34 tests passed (the V8 end-to-end test ran on V8 11.3 and saw the 2 REPORTED lines).
(An accidentally committed `app/dist-server` build output was untracked in `569b07903f` before this run.)
