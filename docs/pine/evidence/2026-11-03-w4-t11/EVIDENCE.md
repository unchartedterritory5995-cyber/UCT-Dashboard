# W4-T11 evidence: text builtins over runtime values

Branch `feat/pine-w4-t11-runtime-text`. Code tip `7c88e80844` (this file is a docs-only commit on top).
Tested on master `5d95103c8a` (merge-base; measure-pair base worktree `pine-dsk-mpbase` switched to it inside the hl job).
Engine bump: YES (new runtime answers; `SCRIPT_ENGINE_VERSION` NOT edited here).

## What changed
- `runtime/text.js`: `str.substring` (3 and 2 args), `str.replace` (3 and 4 args), `str.tonumber`, `str.pos`
  in `TEXT_FNS`; optional-argument spellings `str.substring/from`, `str.replace/first` and the NY-only
  `str.format_time/ny` in `WS_TEXT_FNS`; `compileTimeFormat` is the one pattern authority; `producesText` knows `str.format_time`.
- FE `ast/pineRuntimeFrontend.js` (text lowering arm only): `str.format_time` arm (exchange zone + literal pattern, else refused by name);
  optional trailing args pick `spec.variants[given.length]`.
- Not touched: `engine/pineTextFormat.js`, `ast/pine.js`, `ast/objectProgram.js`, `clockFns.js`. `str.tostring` formats stay refused (W4-X1).
- Index rules: 0-based, end exclusive; out-of-range/fractional positions and empty `str.replace` target raise a runtime error
  (`TextRuntimeError`), never clamp. `str.tonumber`/`str.pos` answer na (NaN) per reference. Open captures: see below.

## Rail
`app/src/components/chart/engine/runtime/__tests__/w4TextFns.test.js` (23 tests). Two older CONTROLs
(`strBuiltins.test.js`, `strings.test.js`) moved from `str.substring` (now served) to `str.match` (still refused).
Red on master (src files swapped to `origin/master` bytes, restored byte-exact): 17 failed / 4 passed of 21
(the 4 passers are the refusal-by-name controls, true on both). Green on tip: 23/23.

## Mutations (mutate.py, 20 total; all killed, 0 survivors)
| mutation | killed by |
|---|---|
| substring 1-based | three arguments keep [begin,end); two arguments; runtime position; text slot |
| substring end bound / begin<0 bound / end<begin bound removed (3) | a position outside the text stops the script |
| substring integer check removed | a fractional position stops the script (added after first run survived) |
| replace overlap (`from = at + 1`) | occurrences do not overlap |
| replace 1-based occurrence | default first / explicit occurrence from 0 / missing / overlap |
| replace empty target allowed | an empty target stops the script |
| replace occurrence check removed | a fractional or negative occurrence stops the script (added) |
| replace missing occurrence returns '' | a missing occurrence leaves the text unchanged |
| tonumber lenient (`Number(s)`) | tonumber answers na for anything else |
| pos not na | pos is 0-based and na when absent |
| format `yy` full year / zero pad removed | formats the exchange wall clock (+ offset-change test) |
| format unknown letter admitted | a pattern letter this lane does not print is refused by name |
| format producesText dropped | printed time concatenates; offset-change; explicit NY zone |
| FE variant dropped | two-argument substring, default replace |
| FE zone check dropped | another zone is refused by name |
| FE pattern check dropped | pattern letter refused by name |

## measure-pair (cmd `bash mp.sh`: base switched in-job to master `5d95103c8a`; `measure-pair.sh <out> tip:<wt> base:<mpbase> <rt> 1`)
Logs: `_resume-2026-11-01/runs/w4t11-mp0.log`, `w4t11-mp1.log` (out dirs `w4t11-mp0`, `w4t11-mp1`).
- `== side tip 7c88e80844` / `== side base 5d95103c8a`, runtime 0 and runtime 1.
- C18 corpus audit: 0 diffs both lanes (excluding `ms` timing). C18 constructed probes: 0 diffs both lanes.
- Vendor harness: rt0 `TOTAL 336 — MATCH 93 · DIVERGE 103 · INCONCLUSIVE 140` on both sides; rt1 `MATCH 111 · DIVERGE 107 · INCONCLUSIVE 118` on both sides; harness output files byte-identical.
- Census 967 rows. rt0: 3 differing rows. rt1: 12 differing rows. Classification, 0 unintended:
  - INTENDED (2 per lane): `example:functions:str.format_time#0`, `example:functions:str.replace#0`: runtime lane now reached
    (attached true); both still refuse at `no-output` in the production lane (example has no plot).
  - INTENDED, first wall moved, same final refusal and still unattached (rt1): `fibonacci-retracement-mtflog` (peel 2 to 1),
    `fibonacci-retracement-statistics-by-volprofex` (7 to 3, object-removal-lost), `session-tpo-profile` (3 to 2), `sessions-nephew-sam` (5 to 3).
  - NOISE (timing/peel jitter, same guard and outcome, attached/clean unchanged): `multi-timeframe-trend-indicator` (pine:timeout script;
    ms 39s/73s vs 204s, peelSteps varies), `multiple-mtf-moving-average-xdecow`, `gex-levels-breakout-structure-session-avwap-esspxspy`,
    `interactive-atr-stop-loss`, `mirage-liquidity-sweep-pro-willyalgotrader`, `session-liquidity` (nested step detail only).
  - No script changed attached/clean state; no new clean attach on the sample (the T11 builtins were not the last wall on any of them).

## final-tip
Command: `final-tip.sh pine-dsk-w4t11 w4t11-final tests/test_script_engine_version_gate.py` on tip `7c88e808449a04dbe765454709b73c251a004766`
(log `_resume-2026-11-01/runs/w4t11-final/`; the evidence commit on top is docs-only).
- gate pytest: `46 passed` (rc=0). Hygiene rc=0: `clean: 34665 tracked file(s)...`. `tests/test_script_engine_version_gate.py`: `6 passed`.
- full chart+hooks vitest: `Test Files  1 failed | 1334 passed | 27 skipped (1362)`. The one failure is
  `src/hooks/pollingSites.rail.test.js`, the known desktop-baseline failure (same single file as the coordinator's baseline).

## Open captures (add to capture queue)
- W4-T11-a: `str.substring` with out-of-range or reversed positions: runtime error vs na (this lane raises).
- W4-T11-b: `str.tonumber` of padded text ("  5 "), "+5", "5.", exponents; `str.replace` with empty target and overlapping targets.
- W4-T11-c: `str.format_time` letters beyond `yyyy yy MM M dd d HH H mm m ss s` (names, 12-hour, zone letters) and non-NY zones: refused by name.

---

# FIX ROUND r1 (review W4-T11, NO-GO @a944bd68c2)

Code tip `3bf1815f93` (r1 fix commit; later commits are docs only). Tested on master `5d95103c8a` (merge-base).
Engine bump: YES (unchanged). `SCRIPT_ENGINE_VERSION` not edited. Logs under `_resume-2026-11-01/runs/w4t11r1/`.

## B1 (MEDIUM): one runtime-error authority
- `runtime/text.js`: `TextRuntimeError` deleted; all five throw sites (substring whole-number, substring range, replace occurrence,
  replace empty target, format_time pattern) throw `PineRuntimeError` (`collections.js`, name `runtime.error`, guard `runtime:runtime.error`).
- Rail (`w4TextFns.test.js`, describe "a str.* runtime error stops the whole script through the pane pipeline", 4 tests): through the
  REAL `computeRuntimeColumns` with `compute.objects: true`, a label whose text is `str.substring(s, 0, 9)` over a 3-char runtime
  text stops the whole script (no columns returned, `err.name === 'runtime.error'`, guard `runtime:runtime.error`); same for an
  empty `str.replace` target and for fractional/negative positions; CONTROL: an in-range substring returns the plot.

## Red on base (redbase: base bytes of `text.js` and `pineRuntimeFrontend.js` copied in, run, tip bytes restored; sha256 prefixes
identical before/after; `git status` clean). Log `redbase.log`; base `5d95103c8a`, tip `3bf1815f93`.
`w4TextFns.test.js` + `objectDoorGate.test.js` on base: 36 failed | 36 passed (72). w4TextFns: 22 red, 5 pass (the refusal-by-name controls:
format_time unknown-symbol zone, another zone, unprinted letter, `str.match`, the in-range stop CONTROL). objectDoorGate: 14 red (the W4-T11 pane-builds and
refuses-BY-NAME rails; the "door draws nothing new" rails and the older rails pass on both, as intended for a gate).
The two tests added after the first red-on-master record are red on base: "a fractional position stops the script" and
"a fractional or negative occurrence stops the script" (also the new stop-rail fractional test).

## Object door gate (note N1 taken)
- `text.js`: the four new `TEXT_FNS` entries carry `afterDoor: true`; FE `pineRuntimeFrontend.js`: the `TEXT_FNS` arm calls
  `objectDoorRefuses` when `spec.afterDoor === true`, and the `str.format_time` arm calls it first. The door builds exactly what master built;
  at the door the pane build refuses BY NAME (`runtime:object-door`).
- Rails (`objectDoorGate.test.js`, describe "W4-T11 text builtins are gated at the object door", 22 tests): for substring (3 and 2 args),
  replace (3 and 4 args), tonumber, pos, format_time: (a) the end-to-end door (memberPaneDefinition -> objectReaderFor -> evaluateObjects)
  still answers `{ok:false, labels:null}` as master; (b) the runtime pane builds it; (c) the same build with `objectDoor:true` refuses
  `runtime:object-door` ("runtime pane only"); CONTROL: `str.length` over the same text still builds at the door.
- Door-level measure: C18 corpus audit and C18 constructed probes byte-identical tip vs base on both lanes (below): no member-visible change.

## Mutations r1 (mutate.py over w4TextFns + objectDoorGate; `mut.sh`, lock heavy-mut; 10/10 killed, restores byte-exact, tree clean after)
| mutation | killed by |
|---|---|
| substring range throw -> plain `Error` | stop rail "str.substring reached only by a LABEL stops the script" |
| substring whole-number throw -> plain `Error` | stop rail "a fractional position and a fractional occurrence stop it the same way" |
| replace occurrence throw -> plain `Error` | same fractional/negative stop rail |
| replace empty target throw -> plain `Error` | stop rail "str.replace with an empty target" |
| TEXT_FNS door gate off (`if (false)`) | door rails "substring/substring2/replace/replace4/tonumber/pos ... refuses BY NAME" |
| format_time door refusal removed | "format_time: the same build at the object door refuses BY NAME" |
| `afterDoor` dropped on tonumber / pos / substring / replace (4) | each name's "refuses BY NAME" rail |
The 20 earlier mutations (text.js behaviour, FE variants) stand: behaviour code is unchanged except the error class and the gate.
(The format_time pattern throw at run time is not reachable through the FE, which refuses a bad pattern first; it carries the same class.)

## measure-pair r1 (`mp.sh`, lock heavy-mp2, mpbase2 switched in-job and detached to master `5d95103c8a`; HEAD asserted before/after each lane:
tip `3bf1815f932873d259199e37b74ec8f514077b34`, base `5d95103c8a426e9c5844f42acef2f2131a96101a`, no drift; samples in `head-samples-rt*.log`)
Logs `job-mp.log`, `mp0.log`, `mp1.log`.
- runtime 0: `== side tip 3bf1815f93` 23:47:28, `== side base 5d95103c8a` 00:06:16. runtime 1: `== side tip 3bf1815f93` 00:27:05, `== side base 5d95103c8a` 00:49:03.
- C18 corpus audit and C18 constructed probes: identical (ms excluded) on both lanes. Object-door changes: NONE.
- Harness: rt0 `TOTAL 336, MATCH 93 / DIVERGE 103 / INCONCLUSIVE 140` both sides; rt1 `MATCH 111 / DIVERGE 107 / INCONCLUSIVE 118` both sides; harness output files byte-identical.
- Census 967/967 rows both sides. rt0: 6 differing rows. rt1: 12. Classification (0 unintended):
  - INTENDED rt0+rt1 (2 each): `example:functions:str.format_time#0`, `example:functions:str.replace#0`: runtime lane now reached (rt1: attached false->true);
    both stay `clean:false`, refusal `pine:no-output` (the example has no plot).
  - INTENDED rt1, first runtime wall moved, same final refusal, still unattached: `fibonacci-retracement-mtflog` (peel 2 to 1), `fibonacci-retracement-statistics-by-volprofex`
    (7 to 3), `session-tpo-profile` (3 to 2), `sessions-nephew-sam` (5 to 3).
  - NOISE (translator `pine:timeout` budget jitter or nested step detail; attached/clean/final guard unchanged): rt0 `multi-timeframe-trend-indicator`,
    `volatility-coil-edge-bullbyte`, `halftrend-longshort-signal-engine-bigbeluga`, `market-structure-with-inducements-sweeps-luxalgo`; rt1 `multi-timeframe-trend-indicator`,
    `multiple-mtf-moving-average-xdecow`, `gex-levels-breakout-structure-session-avwap-esspxspy`, `interactive-atr-stop-loss`, `mirage-liquidity-sweep-pro-willyalgotrader`, `session-liquidity`
    (rtProbe/runtimeDeclined detail only; guard identical in every case).
  - No script changed attached/clean state except the two example rows above.

## Capture queue (N2/N3)
`docs/pine/capture-queue-2026-11-04-w4-t11.md`: rows W4-T11-a (bad substring positions), W4-T11-b (tonumber texts, replace overlap/missing/empty target),
W4-T11-c (format_time letters, zones, `na` time) with probe scripts.

## final-tip r1 (LAST, on the final tree; lock heavy-final2; `final-tip.sh pine-dsk-w4t11 dsk-w4t11r1-final tests/test_script_engine_version_gate.py`)
Tip `b8e7e4acd4b6a65e9daab54fa87a692c9c3ff0e3` (code `3bf1815f93` + docs-only evidence; this closing section is a further docs-only commit). Tested on master `5d95103c8a`.
Logs `_resume-2026-11-01/runs/dsk-w4t11r1-final/`, job log `runs/w4t11r1/job-final.log`.
- gate pytest: `46 passed` (rc=0). Hygiene rc=0: `clean: 34667 tracked file(s)...`. `tests/test_script_engine_version_gate.py`: `6 passed`.
- full chart+hooks vitest: `Test Files  1 failed | 1334 passed | 27 skipped (1362)`; the one failure is `src/hooks/pollingSites.rail.test.js`
  (known desktop baseline, same single file as r0).
