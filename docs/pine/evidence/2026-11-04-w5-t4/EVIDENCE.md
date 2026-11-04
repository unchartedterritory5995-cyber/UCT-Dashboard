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
