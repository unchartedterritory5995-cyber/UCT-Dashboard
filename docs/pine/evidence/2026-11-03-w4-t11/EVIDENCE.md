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
