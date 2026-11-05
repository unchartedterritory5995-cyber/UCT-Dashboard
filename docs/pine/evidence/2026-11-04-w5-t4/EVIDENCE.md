# W5-T4 host-parity rail: evidence

Lane: W5-T4 (docs/pine/SERVER-RUNTIME-DESIGN.md section 7, P0 T4; rails HP-1 to HP-7 of 2.3), desktop machine.
Branch `feat/pine-w5-t4-host-parity`. Code tip checked: `56279a879e`. Tested on master `5d95103c8a`
(merge-base with origin/master; 96582cd549 is NOT in this tree, so the desktop baseline is the one
file `pollingSites.rail`).

**Stack: T1 and T3 merge first, then T4.** The branch was created from W5-T1's tip `27e95ca34c`
(origin/feat/pine-w5-t1-server-bundle), then W5-T3's tip `409456ee36` was merged in with one local
merge commit, `e5f7ea0e0b` "merge W5-T3 codec into W5-T4 base". The merge was clean: no conflict.

Lanes used (desktop): heavy-lock `dsk/heavy-final3.lock` (vite build + Chromium half, the math probe,
the red-on-base proxy, final-tip) and `dsk/heavy-mut.lock` (mutations). Never two at once in this
worktree. Chromium is Playwright's bundled headless Chromium 145.0.7632.6 (`p.chromium.launch()`): no
branded Chrome, no profile, no sign-in; every browser is closed in a `finally`.

Engine bump: **NO**. No engine source is touched (tools, fixtures and tests only). SCRIPT_ENGINE_VERSION
unchanged (5).

## What is new
- `tools/pine_runtime_host_parity.mjs` (the Node half and all shared logic):
  - `--host node --check`: builds the server bundle fresh into a temp dir (T1's `buildPineRuntime`, no
    node_modules beside it), runs every case through `computeRuntimeColumns(def, rows, ctx,
    { incremental: false })` with a session and ledger reset per case (H6), digests with T3's
    `columnDigest.js`, and compares with `expected-digests.json`. A red names the case and says
    whether the engine identity moved ("a digest changed WITHOUT an engine bump") (HP-1, HP-5).
  - `--write` refuses to move any committed digest or bar set unless the engine identity moved (the
    coordinator's bump); it also refuses a corpus that cannot distinguish, a hostile case on the
    wrong stop, and any inconclusive case.
  - `--mutation-control` (HP-4): the bundle's VM `+` (`stack[sp - 1] = ADD(...)`; exactly one site,
    or it refuses) through `Math.fround`. The rail must go red by case name.
  - `--emit-jobs` / `--digest-raw` / `--compare` for the Chromium half; `--adapters` (HP-7).
- `tools/pine_runtime_host_parity.py` (the Chromium half, HP-2/HP-3): serves a production build's
  `assets/runtimeWorker-*.js` from a fake origin (the `runtime_pane_worker_probe.py` route machinery),
  starts it as a module Worker and posts each case as `runtimeAsync.messageOf` does. The page encodes
  columns with the Node half's own `encodeColumnsB64` source (one encoder). Raw answers are digested by
  the Node half's `recordOf` (one normalisation). Every ok digest is also recomputed by the PYTHON
  codec (`pine_runtime_codec.py`) from the same bytes.
- `app/src/components/chart/engine/runtime/__fixtures__/hostParity/`: `corpus.json`, `corpus/*.pine`
  (41 files), `expected-digests.json` (166 cases: 135 ok, 31 withheld; 145 distinct digests;
  `recordedOn` Node v24.13.1 / V8 13.6.233.17).
- Rails: `runtime/__tests__/hostParity.rail.test.js` (19 tests); `tests/test_pine_runtime_engine_identity.py`
  (5 tests: HP-6 x4, HP-7; design 8 step 3).

### Decisions a reviewer should check
1. **The digest's `bundle_sha256` is artifact-neutral (64 zeros).** Two artifacts (the server bundle
   and the vite worker chunk) cannot share a real sha, and a real sha would move every committed
   digest on any refactor. The other four identity fields are live (read from the bundle's exports),
   so an engine bump moves every digest. The artifact's own sha stays with HP-6 and the canary.
2. **The corpus is first-party only.** 34 original scripts (each `indicator("hp ...")`, which a rail
   checks) plus the hostile corpus. Left out under the licence rule: the census's 216
   runtime-attaching scripts and the allowlist scripts (TradingView sample scripts). Sources were not
   extracted from `runtime/__tests__/*` (see open items). Three scripts are build or run refusals on
   one set (`arrays_basic` runtime:failed, `arrays_sort` runtime:array, `dmi_adx` pine:function), for
   refusal parity.
3. **Bars are generated, not committed**: mulberry32 seeds per set, whole cents, 09:30 New York opens
   with US DST. Each set's sha256 is pinned in `expected-digests.json`. The sets (design 2.3):
   - `d5000`: 5,000 D bars, off-listing (the warm-up curtain path);
   - `m5_32768`: 32,768 five-minute bars;
   - `listing`: `historyFromListing: true`;
   - `forming`: `newestBarIsForming: true`;
   - `calcbars`: `calc_bars_count=400` added to the header.
4. **`runtime:time-budget` is INCONCLUSIVE, never a digest** (H5). The worker passes the 1,000 ms pane
   budget; the Node half passes none. `supertrend` runs only on the three short sets, because it costs
   more than 1 s under the warm-up curtain on 5,000+ bars.
5. **HP-7 exemptions**, each named in the tool: `now` (design), `incremental` (H6), `budgetMs` (H5).
   `services/pine_runtime/job.mjs` is W5-T7's; it is compared automatically once it exists.
6. **The hostile corpus** (design 4). Every case ends in its named stop on both hosts:
   - `runtime:limit`: infinite `while`, `for` to 1e12, string doubling (MEMORY), array growth
     (ARRAY_ELEMENTS), and a 512 KiB + 1 source (PROGRAM_SIZE);
   - `runtime:statement`: UDF recursion, and a 120,001-term chain (the parser's stack);
   - `runtime:request`: `request.security` on another symbol;
   - `runtime:varip`: `varip` in a calc_bars window;
   - `budget:nodes`: the "200k-node expression" stops at the front end's node budget, before any IR
     exists.

## Results
| rail | command | result |
|---|---|---|
| HP-1 + HP-5 | `node tools/pine_runtime_host_parity.mjs --host node --check` | GREEN 166/166 (Node v24.13.1, V8 13.6) |
| HP-4 | `... --mutation-control` | the perturbed bundle is red on 35 cases, by name |
| HP-4 in place | built `app/dist-server/pine-runtime.mjs` (sha a27a389e3b78), perturbed it, `--check --bundle` | rc 1, "HP-1 RED", 35 `RED <case>` lines; restored byte-exact (sha equal), then rc 0 GREEN 166/166. Log `runs/w5t4-hp4/hp4.log` |
| HP-6 | `pytest tests/test_pine_runtime_engine_identity.py` | 5 passed |
| HP-7 | `... --adapters` | GREEN (worker `{budgetMs}`, node `{incremental}`; job.mjs absent) |
| HP-2/HP-3 | `python tools/pine_runtime_host_parity.py --dist app/dist --out <dir>` (real chunk `runtimeWorker-DsQlJvrF.js`) | **RED on 2 cases, by name**: `transcendental@listing`, `transcendental@forming`. Every other case is equal (one is inconclusive in run 2). The Python codec matches the JS codec on 134/134 ok digests |

Chromium runs (each with its own vite build inside the job):
- `runs/w5t4-chromium/`, tip b51cf03308: 164/166 equal, 2 RED;
- `runs/w5t4-chromium2/`, final tip 56279a879e: 163/166 equal, 2 RED, 1 INCONCLUSIVE.
  `slope_loop@m5_32768` took 1,031 ms in the worker and hit the pane budget; it takes 531 ms in Node.

### The HP-3 finding (the rail did its job)
The two red cases differ only in column `p3`, `math.sin(...) * math.cos(...) + math.atan(...)`, and
only by one ulp: 72 of 1,500 rows and 78 of 2,000 rows. Example, bar 6: Node 1.4558151025898136,
Chromium 1.4558151025898134.

A direct probe isolates it to V8 itself (`runs/w5t4-chromium/mathprobe.log`, 25,000 inputs per
function, under the lock):
- `Math.sin` differs on 801 of 25,000 inputs and `Math.cos` on 856, by one ulp, between Node 24.13.1
  (V8 13.6) and Chromium 145 (V8 14.5);
- tan, atan, atan2, exp, log10, pow, sqrt, sinh, tanh and cbrt are bit-identical;
- log, asin and acos differ only in the NaN payload, which the codec canonicalises.

**This falsifies the premise of design H8 and ruling Q6: "V8 ships one fdlibm port, so Chromium and
Node agree bit for bit".** They agree only within one V8 build line. Consequences:
- HP-3 cannot be green across a Node build and a Chrome build of different V8 versions for any script
  that uses sin or cos.
- The committed digests were recorded on Node 24.13.1. The master deploy gate runs
  `node-version: '20'` (V8 11.3), and production web is `node:20.18.0`. If V8 11.3's sin/cos differ
  from 13.6's, HP-1 is red in the gate on `transcendental@*`. `expected-digests.json` now records
  `recordedOn` (node, v8), and a red prints the V8 of both sides.
- This needs a coordinator or owner decision (reopen Q6):
  - (a) a JS-implemented sin/cos inside the runtime (engine-wide, output-changing, with its own
    accuracy risk);
  - (b) scope HP-3 to "bit-identical except last-ulp trig", with trig cases reported rather than gated;
  - (c) pin the service's Node to the members' Chrome V8. This cannot hold, because Chrome
    auto-updates.

  The corpus keeps the case; nothing was relaxed.

## Rails red on base, green on tip
On base none of the T4 files exist. The proxy ran in the final job (the tool moved aside, restored
byte-exact; `runs/w5t4-redbase.log`):
- vitest `hostParity.rail.test.js` cannot load (Test Files 1 failed, rc 1);
- pytest `test_pine_runtime_engine_identity.py`: 1 failed (HP-7), 4 passed. The HP-6 tests need only
  the bundle and the fixture, and the fixture is also absent on base.

Green on tip: 19/19 and 5/5.

## Mutation table
Command (from `app/`, lock `dsk/heavy-mut.lock`):
`python $S/mutate.py ../docs/pine/evidence/2026-11-04-w5-t4/muts.json src/components/chart/engine/runtime/__tests__/hostParity.rail.test.js`.
- Round 1 (`runs/w5t4-mut/mut.log`, tip 31c2faaee7): 30 mutations. The control survived, 26 were
  killed and 3 survived.
- Rails for the 3 survivors were added in `56279a879e`. Round 2 (`muts-r2.json`,
  `runs/w5t4-mut/mut2.log`): all 3 killed; the control survived.

**29 of 29 real mutations killed. No equivalent survivors.**

| mutation | killed by |
|---|---|
| control:noop-comment | SURVIVED (control) |
| enc:undefined-not-na, enc:coerce-non-number, rec:non-numeric-ok | "null, undefined and holes are na; ..." |
| rec:time-budget-is-a-verdict, rec:bar-dropped, rec:unnamed-guard-null | "a refusal is digested by guard and bar; a wall-clock stop is inconclusive" |
| cmp:guards-ignored, cmp:warmup-ignored, cmp:missing-ignored | "HP-5: a guard-only or a warm-up-only difference is a difference" |
| dist:one-digest-ok (r2), dist:collision-ok | "a corpus that cannot distinguish is rejected" |
| check:distinguish-unchecked (r2), check:bump-message-swapped | "the committed file passes its own check; a moved digest is red, named, ..." |
| hostile:any-guard, check:bars-unchecked, check:inconclusive-green, check:hostile-unchecked | "moved bars, a hostile case that stops on the wrong guard, and an inconclusive case are each caught" |
| write:moved-without-bump, write:bars-without-bump | "--write refuses to move a committed digest without an engine bump" |
| perturb:many-sites | "the perturbation applies at exactly one site, or refuses" |
| perturb:noop | "HP-4: one VM operator through Math.fround turns the rail red" |
| hp7:exempt-extra, hp7:many-calls-ok, hp7:options-unchecked | "HP-7 is red on an adapter that adds an option, or calls twice" |
| node:session-on (r2) | "HP-7: the worker and the Node half build the same call" (output-equal but contract-different: HP-1 alone cannot see it) |
| node:neutral-sha-real, corpus:calcbars-ignored, bars:dst-ignored | "HP-1: the bundle computes exactly the committed digests" |
| corpus:unlisted-ok | "a corpus file that corpus.json does not list is refused" |

Not mutation-proved: the Python Chromium half's own control flow, because each mutation would need a
Chromium run. Its decisions are delegated to the mutated .mjs (`recordOf`, `--compare`). Its
worker-load check returns INCONCLUSIVE (exit 2) when the chunk does not answer.

## final-tip
Command: `bash $S/final-tip.sh pine-dsk-w5t4 w5t4-final tests/test_pine_runtime_engine_identity.py tests/test_script_engine_version_gate.py tests/test_pine_runtime_codec.py`.
Lock `dsk/heavy-final3.lock`, tip `56279a879e`, tested on master `5d95103c8a`. Logs:
`_resume-2026-11-01/runs/w5t4-final/`.
- gate pytest (4 files): 46 passed. Hygiene: clean (34724 tracked files).
- rails pytest (engine identity, engine version gate, codec): 222 passed.
- full chart+hooks vitest: Test Files 1 failed | 1336 passed | 27 skipped (1364); Tests 1 failed |
  22536 passed | 118 skipped (22655). The only failure is `src/hooks/pollingSites.rail.test.js`, the
  desktop baseline. `hostParity.rail.test.js` passed inside the full run.

## Open items
- **HP-3 is RED on V8 sin/cos (above). It needs a decision before HP-3 can gate.** Also verify HP-1
  under the gate's Node 20 before wiring it into `master-deploy-gate.yml` (T19).
- `slope_loop@m5_32768` sits at the 1,000 ms pane budget in headless Chromium: INCONCLUSIVE once,
  passed once. It is never a red, but a coordinator may move it off the 32,768-bar set.
- Corpus breadth: the runtime `__tests__/*` fixture sources were not extracted. That needs a licence
  filter, because `fvgVendorParity`, `groupBVendorReadings` and other vendor-named tests may quote
  vendor text. The census and allowlist scripts stay out (licence-held). Drawings and objects are not
  compared, because no server lane consumes them in v1.
- HP-8 / T5: run the same `pine_runtime_host_parity.py` with `p.webkit` / `p.firefox` as a report.
  The math probe above is a ready-made start. The V8-version finding widens T5's scope from "other
  engines" to "other V8 builds".
- HP-7 compares `job.mjs` automatically once W5-T7 adds it.
- `app/dist` (the vite build) and `app/dist-server` were created only for these runs and deleted after.

## Round r1: trig cases are REPORTED by HP-3, not gated (option b)

Decision (owner delegated, desktop chose the reversible option b). Code tip is the commit after
`eb922686fe` that carries this section; lock `dsk/heavy-final3.lock` (HP runs), `dsk/heavy-mut.lock`
(mutations). Engine bump: NO (tools, fixture and tests only).

What changed:
- `corpus.json` gains a NAMED list, `reportOnly: { reason, cases: [...] }`: exactly
  `transcendental@forming` and `transcendental@listing`, with the V8 sin/cos 1-ulp reason. No pattern.
  `reportOnlyOf` refuses a name that is not a corpus case.
- HP-3 (`--compare`, used by the Chromium half) classifies each differing case. A listed case whose
  ONLY difference is the digest is `REPORTED` (row count, max ulp distance, reason) and does not fail.
  A listed case that also differs in status, guards or warm-up is still RED. Every unlisted case is
  gated exactly as before. The final line reads `HP-3 GREEN: 164/166 cases equal ...; 2 REPORTED, not
  gated`. Node records now carry their encoded columns (`cols`) so the ulp figures can be measured;
  `expected-digests.json` is unchanged (`--write` still picks only status/digest/guards/warmup).
- HP-1 (Node vs the committed digests) is NOT changed; see the Node 20 result below.
- `tools/pine_runtime_host_parity.py` prints the REPORTED lines and stores them in `verdict.json`.

Real Chromium run (vite build, Playwright Chromium 145.0.7632.6, Node v24.13.1):
`runs/w5t4r1/hp.log`: python codec 135/135; node vs chromium and committed vs chromium both
`HP-3 GREEN: 164/166 ...; 2 REPORTED`; `HP-2/HP-3 GREEN`.
- `transcendental@forming`: 78/10000 values differ, max 512 ulp.
- `transcendental@listing`: 72/7500 values differ, max 128 ulp.
The input functions differ by 1 ulp (above); the output distance is larger because plot p3 sums sin*cos
with atan, so a cancellation amplifies the 1-ulp input difference. Still the V8 sin/cos finding, not
a new one. (Committed-vs-Chromium has no columns on the committed side, so it prints "ulp not
measurable".) No browser process was left (tasklist check), `app/dist` and `app/dist-server` removed.

Node 20 (V8 11.3, the gate's `node-version: '20'` line), portable `node-v20.18.0-win-x64.zip` unzipped
into a scratch dir, no install, no PATH change: `node tools/pine_runtime_host_parity.mjs --host node
--check` gives **HP-1 RED on exactly the same two cases**, `transcendental@forming` and
`transcendental@listing`; the other 164 cases equal the digests recorded on Node 24. So V8 11.3 also
differs from V8 13.6 on sin/cos. **Open: wiring HP-1 into `master-deploy-gate.yml` (T19) on Node 20
would be red on those two cases.** Options for the owner: treat the listed cases as reported in HP-1
too when the V8 differs from `recordedOn` (small, same list), or record per-V8 digests, or do (a).

Rails (in `hostParity.rail.test.js`, 25 tests, was 19):
1. an unlisted case that differs is RED and fails HP-3 (also end to end via `--compare`, exit 1);
2. a listed case that differs is REPORTED with row count and max ulp and does not fail (exit 0);
3. the list is pinned to the two trig names and each must be a real case (a widened list fails);
plus: a listed case still RED when status/guards/warm-up differ; ulp distance across zero and NaN.

Mutations (`muts-r3.json`, `muts-r3b.json`; logs `runs/w5t4r1/mut.log`, `mut2.log`):
| mutation | killed by |
|---|---|
| control:noop-comment | SURVIVED (control) |
| rep:all-report-only (every case report-only) | rail 1, and the end-to-end exit-1 test |
| rep:any-field-ok (listed case reported on any field) | "a listed case is still RED when anything but its digest differs" |
| rep:drop-ulp-print | rail 2 and the end-to-end test |
| rep:ulp-max-inverted, rep:rows-miscounted | rail 2, the ulp test, the end-to-end test |
| rep:reported-fails-exit (REPORTED counted as red) | the end-to-end exit-0 test |
| rep:unknown-name-ok | the pinned-list test |
| rep:list-widened (corpus.json gains a third name) | the pinned-list test and the end-to-end test |
| rep:list-lost-reason | SURVIVED in round 1; an end-to-end assertion on the reason text was added; killed in round 2 |

9 of 9 real mutations killed (the one survivor of round 1 was a real gap, closed). No equivalent survivors.

### Open candidate: option (a)
A JS-implemented `sin`/`cos` inside the runtime (an engine change, output-changing, so an engine bump
and a measure-pair on both lanes, with its own accuracy risk against TradingView). It would make HP-1
and HP-3 bit-identical across every V8 build with no report-only list, and would end the dependence on
V8's libm. Not taken: engine-wide and irreversible compared with b. Recorded here as an open
candidate; the report-only list is the reversible stopgap and is deleted when (a) lands.

### r1 final-tip
Command: `bash $S/final-tip.sh pine-dsk-w5t4 dsk-w5t4r1-final tests/test_pine_runtime_engine_identity.py tests/test_script_engine_version_gate.py tests/test_pine_runtime_codec.py`,
lock `dsk/heavy-final3.lock`, code tip `5397a30c6a`, tested on master `5d95103c8a`. Logs `_resume-2026-11-01/runs/w5t4r1/final.log`.
- gate pytest (4 files): 46 passed. Hygiene: clean (34727 tracked files). Rails pytest: 222 passed.
- full chart+hooks vitest: Test Files 1 failed | 1336 passed | 27 skipped (1364); the only failure is
  `src/hooks/pollingSites.rail.test.js`, the desktop baseline. `hostParity.rail.test.js` (25 tests) passed in the run.

## Round r2: HP-1 reports the named trig cases only when the V8 moved (review B1)
Review B1: the HP-1 vitest rail runs `--check` under the local Node; under Node 20 (production and CI)
it was red on the two trig cases. Fix: W5-T19's change (`b6c5668922`), but with ONE rule: `checkAgainst`
REUSES `classifyDiffs` (the HP-3 function; it gained an optional `describe` argument to word the line)
instead of copying its rule, and T19 can drop its own copy. `checkAgainst` reports a `reportOnly`-listed case ONLY when
`got.recordedOn.v8 != expected.recordedOn.v8` (both present) AND its sole difference is the digest;
on the recording V8 it is gated like every other case. `hp1Summary` counts REPORTED apart. New rail
file `hostParity.v8.rail.test.js` (T19's, identical; 9 tests): same-V8 listed diff is RED, other-V8 is
REPORTED, unlisted is RED either way, status/guards/warm-up diffs are RED, a missing V8 is not
"moved", the bump rule and corpus guards still hold, and `--check` end to end.

Node 20.18.0 (V8 11.3, portable zip in a scratch dir), `--host node --check`:
`HP-1 GREEN: 164/166 cases equal the committed digests; 2 REPORTED, not gated (V8 differs from the recording V8)`,
rc 0. Node 24.13.1: `HP-1 GREEN: 166/166`. Log `runs/w5t4r2/n20.log` (re-run after the classifyDiffs refactor).

Mutations (`muts-r4.json`, `runs/w5t4r2/mut.log`, lock `dsk/heavy-mut.lock`): 9 of 9 killed, control survived (re-run on the refactored code, `mut2.log`):
always-moved, never-moved, missing-v8-moves, list-ignores-moved, any-field-reported, any-case-reported,
summary-uncounted, reported-not-printed, describe-ignored (each by the named test in hostParity.v8.rail.test.js).

**Process (review N1): every SCRIPT_ENGINE_VERSION bump must run
`node tools/pine_runtime_host_parity.mjs --host node --write` in the same merge**, or HP-1 and
`test_hp6_the_committed_digests_were_recorded_under_todays_engine` go red. Canonical V8 for `--write`
is the recording V8 (13.6, Node 24.13.x): `--write` on another V8 would re-record the two trig digests.
Review N2 (not done): report-only is not bounded to column p3.

### r2 final-tip
`bash $S/final-tip.sh pine-dsk-w5t4 dsk-w5t4r2-final tests/test_pine_runtime_engine_identity.py tests/test_script_engine_version_gate.py tests/test_pine_runtime_codec.py`,
lock `dsk/heavy-final3.lock`, code tip `da8da64717`, run LAST on the final tree, after the Node 20 check in the same job
(`runs/w5t4r2/n20.log`, `final.log`). Gate pytest 46 passed; hygiene clean (34729 tracked files); rails pytest 222 passed;
full chart+hooks vitest: Test Files 1 failed | 1337 passed | 27 skipped (1365); the only failure is
`src/hooks/pollingSites.rail.test.js`, the desktop baseline. `hostParity.rail.test.js` and `hostParity.v8.rail.test.js` passed inside the run.

## Round r3: the HP-1 vitest rail under Node 20 (delta review)
`hostParity.rail.test.js` HP-1 test asserted `(\d+)\/\1` (equal counts), red under Node 20 (164 equal + 2 REPORTED). It now asserts the
`hp1Summary` contract `HP-1 GREEN: N/M cases equal the committed digests` (the V8 rail owns the REPORTED split). Code tip `12a25effad`.
The vitest rail files were run under Node 20 itself (portable v20.20.2, V8 11.3.244.8; Node 20.18.0 cannot start vitest 4: ERR_REQUIRE_ESM):
`hostParity.rail.test.js` + `hostParity.v8.rail.test.js`: Test Files 2 passed, Tests 34 passed (`runs/w5t4r3/n20vitest.log`).
final-tip (LAST, `dsk/heavy-final3.lock`): gate pytest 46 passed, hygiene clean (34729), rails pytest 222 passed, vitest Test Files 1 failed | 1337 passed |
27 skipped, the one failure `pollingSites.rail.test.js` (baseline).
