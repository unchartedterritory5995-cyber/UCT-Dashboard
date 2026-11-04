# Desktop status (written ONLY by the desktop build machine)

## Header
updated: 2026-11-03 23:55 CT
desktop up since: 2026-11-03 (this session) · plan: DESKTOP-PROMPT v2.1 @ 7809e3399b
free RAM: 16229 MB · builder cap per coordinator ruling a48cbe455f: 6 (max 2 Opus) at >=8 GB, 4 below. Running 6 (0 Opus, 6 Sonnet: W5-T1, W4-T7, W4-T12, W4-T3 r1, E lows, W5-T3). A RAM/disk watch runs every 5 min and alerts below 8 GB free RAM or 20 GB free disk; no new lane starts while below 8 GB.
master at start: 5d95103c8a
baseline (dsk-baseline, final-tip on pine-dsk-smoke @ 5d95103c8a): DONE 15:42 CT, 34.5 min under the lock. gate pytest 46 passed (rc 0) · hygiene rc 0 · vitest chart+hooks: Test Files 1 failed | 1333 passed | 27 skipped (1361). Failed file: src/hooks/pollingSites.rail.test.js ("no NEW bare polling site..."), a known laptop baseline item. targetScriptReport.measure PASSES on the desktop, so the desktop baseline is 1 failed file, not 2. pine-dsk-smoke removed (junction rmdir'd first).
poll on ops/pine-coord: ARMED (15 min). Read 063fe2ba8e (KEEP BUILDING, pause cancelled for the desktop) at 23:55 CT: acknowledged; nothing was paused here. After the queue, the desktop picks further W4/W5 work whose dependencies are met, per that note.
>>> PAUSE BANNER SUPERSEDED FOR THE DESKTOP BY THE OWNER'S DIRECT INSTRUCTION <<<
After fd609214e4 was written, the owner told this desktop session directly: "pausing laptop work and saving it and resuming everything here".
The desktop therefore did NOT pause: all 6 lanes keep BUILDING and the re-homed lanes stay queued here. Only the LAPTOP is paused.
The next coordinator should replace the banner with RESUMED. CONFIRMED by the owner at 2026-11-03 22:47 CT: "no i want the desktop to keep going". The desktop keeps building.

### Setup verification (DESKTOP-PROMPT section 3)
- env-desktop.sh: OK. UCT_WORKTREES=/c/Users/Patrick/uct-worktrees, UCT_RESUME=.../_resume-2026-11-01, HEAVY_LOCK=C:/Users/Patrick/uct-clips/tools/heavy_lock.py, UCT_PY=python
- python: `import pytest, linkify_it` OK
- licence-held inputs present (not committed): pine-sample/ (builtin 142 files, reference 271 files, sample_manifest.json); runs/C/ref_rebuilt.json (124,087 bytes, 2026-11-02)
- heavy lock probe: OK
- shared install: pine-base app/node_modules present; app/package-lock.json identical to origin/master, so no npm ci needed

### Deviations from the plan (for the coordinator's awareness)
1. `pine-handoff` does not exist on the desktop. Used the documented fallback: `pine-handoff-dsk`, detached at origin/docs/pine-parity-programme (7809e3399b). $H points there.
2. BUILDER-RULES setup step 1 runs `git -C $UCT_WORKTREES/pine-handoff worktree add`. Desktop builders use `git -C $UCT_WORKTREES/pine-base worktree add` instead (same repo, same result).
3. pine-base is detached at 6272ed7fa3 (older than master). Left untouched: it only supplies node_modules, and the lockfile matches master. The measure-pair base is pine-dsk-mpbase, which builders switch to their own merge-base inside each hl job.
4. Owner's standing PC-load memory says 1 build agent at a time; the plan allows 4. The owner has since said to use more agents, so 6 builders are running. Heavy jobs remain serialised by the lock.
5. Plan correction: W3 edits app/src/components/chart/engine/pineTextFormat.js (engine/, not ast/pineTextFormat.js as DESKTOP-PROMPT section 4 says). The T11 builder was told; that file is off limits to every desktop lane until W3 merges. W3 also edits ast/pine.js 19357+ and ast/objectProgram.js.

### Desktop worktrees (created by this session; each has .uct-session-owner)
- pine-handoff-dsk (plan folder) · pine-dsk-mpbase (measure-pair base) · pine-dsk-smoke (baseline; REMOVED)
- lane worktrees: pine-dsk-w4t2, pine-dsk-w5t1, pine-dsk-w4t7, pine-dsk-w4t11, pine-dsk-w4t17, pine-dsk-w4t12, pine-dsk-w4t3, pine-dsk-elows, pine-dsk-w5t3 (created by builders)

### Queue (in order, as builder slots free; cap 6 at >=8 GB)
Re-homed lanes are started AFTER current lanes, per a915fc4858. Order chosen to unblock merges and engine numbering first, short lanes first:
1. W5-T6 (desktop's own; starts the moment W5-T1 is READY, branched from T1's tip)
2. W4-T3 fix round @ 572376edf6: STARTED 23:07 CT
3. E evidence-engine lows @ e58edcbeaf: STARTED 23:40 CT (slot freed by W4-T11 READY)
4. W5-T3 codec @ cd61d6741d: STARTED 23:50 CT (slot freed by W4-T2 READY)
5. W3 S1 round 2 @ 7eaca7777f (measure-pair both lanes + final-tip; engine 8)
6. W4-T0 census peel @ 75c4c400c2 (job.sh + coverage map docs)
7. W2 round 3 @ 1a8dddb408 (classify P11, edit packet; NEVER arm or touch flags)
8. W5-T2 (after W5-T1 MERGED)
READY lanes wait for the new coordinator's review. The desktop does not review, merge or bump.

## W4-T2
state: READY            round: r0            updated: 2026-11-03 23:50 CT
branch: feat/pine-w4-t2-simple-folding   tip: ac659bae66 (docs-only evidence over ce5c4bf34b, the final-tip tree)   tested on master: 5d95103c8a
engine bump needed: YES (refusals become served values on the runtime lane; SCRIPT_ENGINE_VERSION NOT edited)
evidence: docs/pine/evidence/2026-11-03-w4-t2/EVIDENCE.md (on the branch)
report: pineRuntimeFrontend.js T2 band only. New simpleValueOf used by invariantTest, constValueOf and foldConstNode: a root name is simple when its writes are one folding root declaration, root or if/else-if/else reassignments whose tests fold, or a var nothing reassigns; the value at a read is the ordered result of the writes before it. foldConstNode also folds + - * and math.* over constants (k + 2, math.max(len, 3)); / and % stay out (T17). The object door keeps master's answer. Rails: new w4SimpleFolding.test.js (26) plus 3 object-door shapes; 22 fail on master, all pass on tip. Intended existing-test updates: k + 2 gap test now asserts span 7; two volume-profile pins move past line 154 (vendorHarness c47/f6, constantLengthRefusal, finiteWindow). Mutations 25/25 killed (round-1 survivors were redundant guards, removed; rails added where they mattered). measure-pair rt0: 0 diffs in C18, census, harness. rt1: C18 and harness identical (incl. adx-and-di-for-v4); 6/967 census rows differ, all intended (RSI loses conditional-history walls at 42/43, next wall is T4's; 3 rows lose a dynamic-offset wall; 2 later peel-step walls fall away). final-tip on ce5c4bf34b: gate pytest 46 passed, version-gate 6 passed, hygiene clean, vitest 1 failed = pollingSites.rail (desktop baseline): 0 new failures. Open: numeric inputs still fold at the author's default (owner rule 2026-08-11), so "changes with the member's input" holds only for text inputs and timeframe tests; still refused: writes in loops/switch, simple values inside function bodies, text-valued simple names (T3); spec row range-filter-bs-signals is not in the desktop sample, unchecked.
desktop check of the definition of done: PASS (T2 band plus intended test updates, rail red on master / green on tip, 25/25 mutations, measure-pair both lanes, final-tip at baseline on ce5c4bf34b and ce5c4bf34b..ac659bae66 is EVIDENCE.md only, local == origin, worktree clean)

## W5-T1
state: BUILDING   round: r0   updated: 2026-11-03 21:11 CT
branch: feat/pine-w5-t1-server-bundle   worktree: pine-dsk-w5t1   model: Sonnet
engine bump needed: expected no (build script plus bare-Node run, no engine edit), confirmed at READY
next: builder implementing SERVER-RUNTIME-DESIGN 7/P0 T1; first bare-Node run over 5,000 daily bars

## W4-T7
state: BUILDING   round: r0   updated: 2026-11-03 21:11 CT
branch: feat/pine-w4-t7-fn-series   worktree: pine-dsk-w4t7   model: Sonnet
engine bump needed: expected yes (engine change), confirmed at READY
next: builder implementing W4-BREAKDOWN T7; T8 merges after this

## W4-T11
state: READY            round: r0            updated: 2026-11-03 23:40 CT
branch: feat/pine-w4-t11-runtime-text   tip: a944bd68c2 (docs-only evidence over code tip 7c88e80844)   tested on master: 5d95103c8a
engine bump needed: YES (new runtime answers; SCRIPT_ENGINE_VERSION NOT edited)
evidence: docs/pine/evidence/2026-11-03-w4-t11/EVIDENCE.md (on the branch)
report: runtime/text.js adds str.substring (2/3 args), str.replace (3/4 args, Nth occurrence from 0), str.tonumber, str.pos, and str.format_time for America/New_York only with literal patterns from yyyy yy MM M dd d HH H mm m ss s. FE (pineRuntimeFrontend.js) changes only the text lowering arm: a str.format_time arm plus optional trailing args via variants. Substring positions are 0-based with an exclusive end; a bad or fractional position, or an empty replace target, raises a runtime error rather than clamping (the spec said na; the builder chose a refusal so we never draw where TradingView stops; unproven, capture W4-T11-a). tonumber/pos return na on failure; other zones/letters and str.tostring formats stay refused by name. engine/pineTextFormat.js, ast/pine.js and ast/objectProgram.js untouched. The str.substring CONTROLs in strBuiltins/strings tests moved to str.match. Checks: rail w4TextFns.test.js 23 pass on tip; on master bytes 17 of 21 fail (the 4 passing are refusal-by-name controls). Mutations 20/20 killed (1 survivor in the first pass, killed after added tests). measure-pair rt0+rt1: C18 audit and probes 0 diffs, harness byte-identical; census diffs 3 rows rt0 / 12 rows rt1, all classified, 0 unintended (2 example rows newly reach the runtime lane, 4 scripts move their first wall and still refuse, 6 timing noise); no script's attached/clean state changed. final-tip: gate pytest 46 passed, hygiene clean, version-gate 6 passed, vitest 1 failed | 1334 passed | 27 skipped, the 1 failure is pollingSites.rail (desktop baseline): 0 new failures. Open captures W4-T11-a/b/c listed in EVIDENCE.md, not yet in a capture-queue doc.
desktop check of the definition of done: PASS (6 files in scope, rail red on master / green on tip, mutations, measure-pair both lanes, final-tip at baseline, EVIDENCE committed, local == origin a944bd68c2, worktree clean)

## W4-T17
state: READY            round: r0            updated: 2026-11-03 23:07 CT
branch: docs/pine-w4-t17-t13-probes   tip: 950b4736ff   tested on master: 4ea661a8d8
engine bump needed: no (docs, probes and one test file only; no engine source touched, verified by git diff --name-only)
evidence: docs/pine/evidence/2026-11-03-w4-t17-t13/EVIDENCE.md (on the branch)
report: Tip 950b4736ff adds EVIDENCE.md over tested tree b8715ef592. Probes in tools/visual_conformance/probes/: vw-w4-int-div-window (+v5, v4) for D1; vw-w4-max-bars-back (M1) and -m2..-m5, one row per file. Test engine/__tests__/w4T17T13Probes.test.js, 19 tests. T17: v4/v5 already truncate a literal/const int quotient as a window length (9/2 -> 4) and fold a const offset (21/2+1 -> 11) with no capture behind either; the literal offset refuses in v4/v5; every input.int operand refuses; v6 refuses all division by name; M1/M4/M5 refuse runtime:directive; M2 builds and the VM stops on the read past the declared 20-bar buffer; M3 builds and serves the 250-bar offset. T13 spike: the renderer exists (candlestick and bar series) and the run can compute the four columns (an na open is NaN on that bar only), but plotcandle/plotbar refuse runtime:presentation and binder.js's only OHLC feed reads the symbol's own bars and refuses a computed row as NOT_PASSTHROUGH. T13 stays an M task: a second payload source in binder.js plus per-point colour/wick/border (candles all three, bars colour only). It touches binder.js beyond the breakdown's file list, so T12 must merge first. Checks: new test 19 passed; mutation pool.js candles->line killed (1 red); final-tip gate pytest 46 passed, version-gate 6 passed, hygiene clean (34685 files); chart+hooks vitest Test Files 1 failed | 1334 passed | 27 skipped, Tests 22379 passed | 1 failed (pollingSites.rail, the desktop baseline): 0 new failures. Open: D1, M1-M5 and W4-P1 captures (owner's rig); the D1 capture-queue row text is in EVIDENCE.md.
desktop check of the definition of done: PASS (files scoped, rail plus mutation shown, final-tip at baseline, EVIDENCE committed, worktree clean and pushed)
## W4-T12
state: BUILDING   round: r0   updated: 2026-11-03 22:02 CT
branch: feat/pine-w4-t12-paint   worktree: pine-dsk-w4t12   model: Sonnet
engine bump needed: decided at READY
overlap check (2026-11-03): origin/feat/pine-w3-drawings touches neither memberPaneDefinition.js nor RT/colours.js, so not BLOCKED. Builder re-checks before its first commit.
next: builder implementing W4-BREAKDOWN T12

## W4-T3 (re-homed fix round)
state: BUILDING   round: r1   updated: 2026-11-03 23:07 CT
branch: feat/pine-w4-t3-session-text   start tip: 572376edf6   worktree: pine-dsk-w4t3   model: Sonnet
engine bump needed: yes (engine 7 at merge, per ASSIGNMENTS)
next: run ONLY the final-tip named at the end of its EVIDENCE.md, record it, READY for delta review

## E evidence-engine lows (re-homed)
state: BUILDING   round: r0   updated: 2026-11-03 23:40 CT
branch: fix/pine-evidence-engine-lows   start tip: e58edcbeaf   worktree: pine-dsk-elows   model: Sonnet
engine bump needed: decided at READY
next: all 5 lows already coded; run deploy-gate pytest + hygiene + rails, write EVIDENCE.md, READY

## W5-T3 codec (re-homed)
state: BUILDING   round: r0   updated: 2026-11-03 23:50 CT
branch: per ASSIGNMENTS row (existing branch)   start tip: cd61d6741d   worktree: pine-dsk-w5t3   model: Sonnet
engine bump needed: no (per ASSIGNMENTS)
next: final-tip + EVIDENCE.md, READY
