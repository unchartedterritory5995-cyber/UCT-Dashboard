# W5-T5 cross-engine report (HP-8, H7, H8): data only, nothing gates

Lane: W5-T5 (docs/pine/SERVER-RUNTIME-DESIGN.md section 7), desktop machine. Branch `feat/pine-w5-t5-cross-engine`,
re-stacked (r1) on W5-T4 r2 code tip `da8da64717` (originally `eb922686fe`) (`origin/feat/pine-w5-t4-host-parity`). Measured 2026-11-04. Engine bump: NO (no engine
source touched; SCRIPT_ENGINE_VERSION unchanged). This is a report: no rail here is red or green by design (H8).

Hosts (all headless, Playwright's own builds from `%LOCALAPPDATA%/ms-playwright`; no branded Chrome, no profile):

| host | version | JS engine | how reached |
|---|---|---|---|
| Node | v24.13.1 | V8 13.6.233.17, ICU 78.2, tzdata 2025c | `node` |
| Chromium | 145.0.7632.6 | V8 14.5 | `p.chromium` |
| Firefox | 146.0.1 | SpiderMonkey | `p.firefox` (firefox-1543) |
| WebKit | 26.0 | JavaScriptCore | `p.webkit` (webkit-2359) |
| Node 20 | NOT INSTALLED | (V8 11.3) | no `node` other than 24.13.1; no nvm, fnm, volta or second install found; not downloaded |

Raw per-host answers (23 MB each) stay in `_resume-2026-11-01/runs/w5t5/`; the committed summaries are small JSON in this folder:
`hp8-summary.json`, `math-summary.json`, `tz-summary.json`, `hosts.json`.

## 1. HP-8: the T4 corpus (166 cases, 135 ok + 31 withheld) on the other engines

Same worker chunk (`runtimeWorker-DsQlJvrF.js`, a production vite build of this tree, deleted afterwards), same cases, same digest
(`recordOf`), compared with a fresh Node run over the server bundle and with the committed `expected-digests.json` (both agreed in every run).
Commands, each as its own heavy-lock job on `dsk/heavy-final2.lock`:
`python tools/pine_runtime_host_parity.py --dist app/dist --out <dir> --browser chromium|webkit|firefox` (new `--browser` flag; webkit and firefox exit 0 whatever the verdict).

| engine | equal | differ | inconclusive | differing cases |
|---|---|---|---|---|
| Chromium 145 (control, this session) | 164/166 | 2 | 0 | `transcendental@listing`, `transcendental@forming` |
| Firefox 146.0.1 | 164/166 | 2 | 0 | `transcendental@listing`, `transcendental@forming` |
| WebKit 26.0 | 159/166 | 7 | 0 | `transcendental@listing`, `transcendental@forming`, `rma_alma_hma@{calcbars,d5000,forming,listing,m5_32768}` |

All 31 withheld (refusal) cases agree on guard and bar in every engine (HP-5 holds on all four hosts). Every ok digest also matches the
Python codec (135/135 per engine). The Chromium numbers reproduce T4's first Chromium run.

Which column differs, on how many rows, by how many ulps (first example of each is in `hp8-summary.json`):

| case | column (Pine expression) | engine | rows differing | max ulp |
|---|---|---|---|---|
| transcendental@listing (1500 rows) | p3 `sin*cos+atan` | Chromium | 72 | 128 |
| | | Firefox | 64 | 64 |
| | | WebKit | 71 | 64 |
| | p4 `sqrt(volume)/log10(volume+10)` | Firefox | 13 | 2 |
| | | WebKit | 13 | 2 |
| | p0 `log(close/close[1])` | WebKit | 5 | 1 |
| | p1 `exp(lr*10)` | WebKit | 55 | 1 |
| transcendental@forming (2000 rows) | p3 | Chromium | 78 | 512 |
| | | Firefox | 54 | 64 |
| | | WebKit | 73 | 64 |
| | p4 | Firefox | 27 | 2 |
| | | WebKit | 27 | 2 |
| | p0 / p1 | WebKit | 3 / 46 | 1 / 1 |
| rma_alma_hma, 5 sets | p1 `ta.alma(close,9,0.85,6)` (exp inside) | WebKit | 277 of 3000 (calcbars) to 24,729 of 32,768 (m5_32768) | 1 to 2 |

Reading this: the large ulp counts on p3 are not large errors in sin or cos. The expression is a sum of terms that nearly cancel, so a
one-ulp difference in an input becomes tens or hundreds of ulps of the result. Every other case (pow, `ta.rma`, `ta.hma`, `ta.linreg` and the
rest of the corpus) is bit-identical on all three engines. Firefox has the same two red cases as Chromium (its p4 differences come from `log10`,
section 3). WebKit additionally moves `exp` (inside `ta.alma`, which differs by 1 to 2 ulp on every set) and `log`.

## 2. H7: tz/DST fixture, Node and each browser

Fixture: `tools/pine_cross_engine_probe.js`, run verbatim in every host over the runtime's OWN `clockFns.js` (`timestampMs`, `instantField`),
so what is measured is `Intl.DateTimeFormat('America/New_York')` as the runtime uses it. It covers:
- every UTC hour from 1990-01-01 to 2030-12-31 (359,400 hours), at :00 and :59:59, with year, month, day, dayofweek, hour, minute and second
  (5,031,600 values);
- the 8 New York wall times 00:00, 01:30, 02:30, 04:00, 09:30, 16:00, 20:00, 23:59 on every calendar day (14,975 days, 119,800 instants),
  turned into an instant by `timestampMs` and read back as hour, minute, dayofweek and dayofmonth;
- an independent truth for the offset changes: the US rule as arithmetic (first Sunday of April and last Sunday of October for 1990-2006, second
  Sunday of March and first Sunday of November from 2007), 82 transitions, compared with the transitions each host's Intl actually produces.

| host | transitions found | equal to the US rule (82) | sweep values differing from Node | session-edge instants / read-backs differing from Node |
|---|---|---|---|---|
| Node 24.13.1 (ICU 78.2, tz 2025c) | 82 | yes | (reference) | (reference) |
| Chromium 145 | 82 | yes | 0 | 0 / 0 |
| Firefox 146 | 82 | yes | 0 | 0 / 0 |
| WebKit 26 | 82 | yes | 0 | 0 / 0 |

Result: no difference anywhere. One property of the runtime itself, identical in all four hosts: the 02:30 wall time on the 41 spring-forward
days does not exist and reads back as another hour (the documented NEEDS CAPTURE rule in `clockFns.js`); in Node, the reference, every other edge
round-trips on every day, and the other hosts equal Node. The machine's own timezone was America/Chicago; the result does not depend on it.
Not covered: Node 20's ICU (not installed), so the design's "Node 20.18 vs Chrome tzdata" question is open for that one build.
Reproduce: `node tools/pine_cross_engine_probe.mjs --out <dir>/probe-node.json`, then for each engine
`python tools/pine_cross_engine_report.py collect --engine <e> --dir <dir>` (heavy-lock job), then
`python tools/pine_cross_engine_report.py summarize --dir <dir> --out docs/pine/evidence/w5-host-parity`.

## 3. Direct Math probe

30,000 fixed inputs (seeded mulberry32; 20,000 uniform in [-20,20], 5,000 in [-1,1], 2,000 of magnitude 1e3 to 1e9, 3,000 positive from 1e-6 to 1e6),
23 functions; `pow(|x|,y)`, `atan2(y,x)` and `hypot(x,y)` take a second seeded stream. The input array is bit-identical in all four hosts (sha `8dadb3a5eb79c2e6`,
checked by the summarizer; an earlier draft built the inputs with `Math.pow` and produced false 40 to 85 ulp "differences", fixed before this run). NaN equals NaN here.
Cell = inputs differing from Node 24 (of 30,000), and the largest gap in ulps. Node 20 is not installed, so there is no column for it.

| function | Chromium 145 (V8 14.5) | Firefox 146 | WebKit 26 |
|---|---|---|---|
| sin | 960 (3.20%), max 1 ulp | 738 (2.46%), max 1 ulp | 738 (2.46%), max 1 ulp |
| cos | 1016 (3.39%), max 1 ulp | 738 (2.46%), max 1 ulp | 738 (2.46%), max 1 ulp |
| tan | identical | 1212 (4.04%), max 1 ulp | 1212 (4.04%), max 1 ulp |
| asin | identical | identical | 194 (0.65%), max 1 ulp |
| acos | identical | identical | 49 (0.16%), max 1 ulp |
| atan | identical | identical | 90 (0.30%), max 1 ulp |
| exp | identical | identical | 2395 (7.98%), max 1 ulp |
| expm1 | identical | identical | 3945 (13.15%), max 2 ulp |
| log | identical | identical | 739 (2.46%), max 1 ulp |
| log1p | identical | identical | 1322 (4.41%), max 1 ulp |
| log2 | identical | identical | 69 (0.23%), max 1 ulp |
| log10 | identical | 1762 (5.87%), max 2 ulp | 1761 (5.87%), max 2 ulp |
| sqrt | identical | identical | identical |
| cbrt | identical | identical | 8468 (28.23%), max 2 ulp |
| sinh | identical | identical | 7424 (24.75%), max 2 ulp |
| cosh | identical | identical | 6146 (20.49%), max 1 ulp |
| tanh | identical | identical | 3258 (10.86%), max 2 ulp |
| asinh | identical | identical | 3993 (13.31%), max 1 ulp |
| acosh | identical | identical | 1337 (4.46%), max 1 ulp |
| atanh | identical | identical | 1583 (5.28%), max 2 ulp |
| pow | identical | 14 (0.05%), max 1 ulp | 14 (0.05%), max 1 ulp |
| atan2 | identical | identical | 4844 (16.15%), max 1 ulp |
| hypot | identical | 11523 (38.41%), max 2 ulp | 11885 (39.62%), max 2 ulp |

Findings (data, no recommendation):
1. Chromium 145 differs from Node 24 only in `sin` and `cos` (about 3%, 1 ulp). Every other function, including `exp`, `log`, `pow`, `tan` and `atan2`, is
   bit-identical across V8 13.6 and V8 14.5. This matches T4's 25,000-input probe (801 and 856 differences) on a different input set.
2. Firefox and WebKit give bit-identical `sin`, `cos`, `tan`, `sqrt` and `pow`, and those equal each other, not V8 (the fingerprint of the full `sin`
   output array is `b24ff435403d3537` on both). Firefox and Chromium differ on `sin` for 918 of 30,000 inputs and on `cos` for 970, so three different
   answers exist for trig: Node 24, Chromium 145, and Firefox/WebKit.
3. Firefox otherwise tracks V8 closely (identical on 17 of 23 functions); the exceptions are `sin`, `cos`, `tan`, `log10`, `pow` (14 inputs) and `hypot` (38%).
4. WebKit differs from V8 on 22 of 23 functions (only `sqrt`, which IEEE fixes exactly, is identical), by at most 2 ulp, and on a large share of inputs for
   `cbrt`, `sinh`, `cosh`, `atan2`, `hypot` and `expm1`.
5. Nothing exceeds 2 ulp on these inputs. The visible effect depends on cancellation downstream (section 1: 512 ulp on a sum of trig terms from a
   1-ulp operand difference), so ulps of an operand are not ulps of the plot.
6. The design's H8 premise ("V8 ships one fdlibm port, Chromium and Node agree bit for bit") is false for `sin` and `cos` across V8 versions (T4's finding) and
   holds for the other 21 functions across these two V8 builds. The Node 20 (V8 11.3) question that the master deploy gate raises cannot be answered here.

Anchors for a hand check (sin, cos, tan, exp, log, atan, 2^x, atan2 at 0.5, 1, 2, 3, 10, 100, pi, e) are in `hosts.json` (`math_anchors`); all four hosts agree on
every anchor except WebKit's `log`.

## Tool changes (tools only, no runtime code)
- `tools/pine_runtime_host_parity.py`: `--browser chromium|webkit|firefox`; webkit and firefox exit 0 (HP-8 report-only); prints and writes a per-column ulp diff
  (`column-diff.json`). The Node half (`tools/pine_runtime_host_parity.mjs`) gained `--raw-out` so Node's own columns can be compared.
- New: `tools/pine_cross_engine_probe.js` (one source for all hosts), `tools/pine_cross_engine_probe.mjs` (Node half), `tools/pine_cross_engine_report.py`
  (collect and summarize). The tz fixture lives in the probe, not under `runtime/__fixtures__/hostParity/`: it holds no corpus and nothing gates on it.

## Open items
- Node 20 numbers (sin/cos and the tz sweep) need Node 20.18 on a machine that has it: `node tools/pine_cross_engine_probe.mjs --out f` is the whole run; add it to the summarizer.
- The probe is not scheduled; "weekly" in HP-8 is the coordinator's call.
- HP-3 (T4) still needs the coordinator's decision on sin/cos. This report adds that Firefox and WebKit agree with each other on trig and disagree with both V8 builds.

## final-tip (tool code was added)
`bash $S/final-tip.sh pine-dsk-w5t5 w5t5-final tests/test_pine_runtime_engine_identity.py tests/test_pine_runtime_codec.py` on `dsk/heavy-final2.lock`, code tip `9fe52d5cea`
(logs `_resume-2026-11-01/runs/w5t5-final/`): gate pytest 46 passed; hygiene clean (34733 files); rails pytest 216 passed; full chart+hooks vitest
Test Files 1 failed | 1336 passed | 27 skipped, Tests 1 failed | 22536 passed | 118 skipped. The one failure is `src/hooks/pollingSites.rail.test.js`, the desktop baseline.
`hostParity.rail.test.js` (which loads the changed `.mjs`) passed inside the full run.

## r1: re-stack on W5-T4 r2 (review B1, N1)
`git merge --no-ff` of `origin/feat/pine-w5-t4-host-parity` (code tip `da8da64717`; T4's later tip is evidence only) into this branch;
the only conflict was `tools/pine_runtime_host_parity.py` (both sides kept: T4's REPORTED print and `verdict.json.reported`; T5's `--browser`,
column diff and report-only exit 0). Merge commit `9c67b4f0e4`.
- Column diff now INCLUDES REPORTED cases: `differing` matches `RED `, `INCONCLUSIVE ` and `REPORTED ` lines. Re-run (Chromium 145, Firefox 146.0.1,
  WebKit 26.0, one vite build): chromium `column-diff.json` has 2 cases / 2 columns (`transcendental@forming` and `@listing`, column p3); firefox 2 cases / 4 columns.
  node vs chromium and vs firefox: `HP-3 GREEN: 164/166; 2 REPORTED`. WebKit: `HP-3 RED 159/166; 2 REPORTED` (the 5 `rma_alma_hma` RED and the
  two trig cases, as in the first report; report-only exit 0). Python codec 135/135 on each.
- One ulp rule: the JS tool (`ulpStats`) is the authority. The Python `ulp_gap` stays (it needs per-column first-example detail the JS summary does not
  print) but now follows the JS rule for infinities ("inf/nan", not a distance), and `tests/test_pine_ulp_gap_matches_js.py` fails if the two drift
  (it caught that difference).
- Node 20.18 (V8 11.3, portable zip, scratch dir): `node tools/pine_cross_engine_probe.mjs` ran (`probe-node20.json` under `runs/w5t5r1/`); not yet
  folded into the summaries (open item above stays).
- Not done: a rail that `--browser chromium` still returns the verdict (review N3).

final-tip: `bash $S/final-tip.sh pine-dsk-w5t5 dsk-w5t5r1-final tests/test_pine_runtime_engine_identity.py tests/test_pine_runtime_codec.py tests/test_pine_ulp_gap_matches_js.py`,
`dsk/heavy-final3.lock`, code tip `9c67b4f0e4`, run LAST: gate pytest 46 passed; hygiene clean (34738 files); rails pytest 217 passed; full chart+hooks
vitest Test Files 1 failed | 1337 passed | 27 skipped (1365), the one failure `pollingSites.rail.test.js` (desktop baseline). Logs `_resume-2026-11-01/runs/w5t5r1/`.
