NEXT STEP: WAITING FOR THE COORDINATOR'S GO for the heavy jobs: measure-pair (runtime 0 and 1, base = the tip's own master, shared lock heavy-mp2/mp3.lock), then final-tip (FULL scope) + ready-check. Light work (code, targeted rails, hand mutations) is done.

# W34-I4b: a v1/v2 self-reference's bar 0 from the listing is withheld, not guessed

Branch `fix/pine-v12-nz-seed-listing`, from origin/master `bde38b0d69` (engine 20).
Tested-on-master: `bde38b0d69`. Code tip: see the commit that adds this file (`git log -1`).
Engine bump: **yes, conservatively**: served output can change for member-authored v1/v2 (or
no-pragma) scripts on runs that start at the listing. No committed corpus script is affected.
SCRIPT_ENGINE_VERSION not edited.

Affected set (corrected after review, 2026-11-06): member-authored v1/v2 or no-pragma scripts on runs
that start at the listing, and **no corpus script**. `atr-god-strategy-by-tradesmart`, first
named as the affected script, carries `// @version=5`. The lexer reads that as v5, so this fix
does not touch it, and no committed corpus script is v1/v2.

## Problem (diagnosed on master)
A v1/v2 self-referencing series `x = cond ? nz(x[1], fill) : y` folds to `accum(fill, ...)`. On a run
that starts at the listing (`historyFromListing === true`) the listing pass reads a self read
before bar 0 as `na`, so bar 0 (and every bar that carries it) drew `fill`. That reading is
measured for v4+ only: the on-listing NYSE:RDDT 1D captures `pmax-explorer`,
`supertrend-kivancozbilgic`, `supertrend-strategy` (`//@version=4`),
`keltner-center-of-gravity-channel`, `vw-ratchet-stops` (`//@version=5`). For v1/v2 the Pine
reference does not say whether `x[1]` enters bar 0 as `na` or as `0`. Capture row
**W34-I4-S1** (branch `feat/pine-w34-i4-state`, `docs/pine/capture-queue-2026-11-06-w34-i4.md`,
probe R07) is owed; this lane does not depend on that branch and does not edit the queue.

## Mechanism chosen, and why
The listing pass's own candidate-set rule (C12w, `interpret.js::listingPass`): a bar-0 reading the
tree cannot settle is kept as a CANDIDATE trajectory, a bar is published only where every
candidate agrees, and a bar where they differ is withheld exactly as the bounded window
withholds its curtain (`NaN` / `prefixProbe` before `warmup`, the window's value from it). This
is how the code already treats every unpinned bar-0 reading (the mixed `var` seed, a guarded
read inside `nz`, a lag before bar 0). For v1/v2 the pass gets one more candidate: Pine entering
bar 0 with every pre-bar-0 self read as `0`. So:
- bars the rule decides are withheld (the "withhold like an off-listing run" option), by name of
  the rule in the code, never a guessed seed;
- bars both rules agree on (after the first reset, or where `fill` is 0) are still drawn, so no
  value that matches TradingView under either rule is lost (a whole-column refusal would drop them);
- the tree cannot tell the `nz(x[k], fill)` fold from the `na(x[1]) ? S : U` fold (both become
  `accum(S, U)`); the zero candidate is the right one for both, since both ask the same
  unpinned question.
A named refusal was rejected: it would blank the whole plot, including the bars that are exact
under both readings.

## Changes (file:line on the tip)
- `app/src/components/chart/engine/ast/interpret.js`: `LISTING_SEED_PINNED_FROM_VERSION = 3`,
  `listingSeedIsUnpinned(version)` (null = no pragma = v1) (the one authority);
  `listingPass(... zeroBeforeListing)` adds the zero candidate (its pre-history is 0);
  the accum call site passes it only when `opts.listingSeedUnpinned === true`.
- `app/src/components/chart/engine/nativeRegistry.js`: `listingOptsFor` spreads
  `listingSeedUnpinned` from `listingSeedUnpinnedFor(def)`, which reads the door's stamp
  (`meta.pineVersion`, only when `meta.doorVersion` is stamped; an unstamped document is left
  as it was, the convention of every listing fact there). It covers all 4 host call sites (2532/2561/2600/2611).
- `app/src/components/chart/engine/ast/pineRuntimeFrontend.js`: `columnInterpretOpts` adds the
  same key from the lexed `pineVersion` (`!atObjectDoor`, so C18 is untouched).
- `ast/pine.js` (W3's file): NOT edited.
- v4+: the key is never stated, `zeroStarts = []`, so the pass is byte-identical.
- Host object lane (`objectColumns.js`) is not given the key: v1/v2 have no drawing objects
  (`label`/`line` arrived in v4), so it never evaluates a v1/v2 tree.

## Rails: `app/src/components/chart/engine/__tests__/listingSeedV12.test.js` (14 tests, synthetic shapes)
Command: `node node_modules/vitest/vitest.mjs run src/components/chart/engine/__tests__/listingSeedV12.test.js --maxWorkers=1`
Totals on the tip: `Tests 14 passed (14)`. Red on master: the 6 section-2 v1/v2 rails (the
M1 mutation reproduces master's behaviour; on master the file also fails to import the new exports).
- 1 the authority: `unpinned for v1, v2 and no pragma; pinned from v3 on`, `a document states it only when stamped`
- 2 v1/v2/no-pragma on the listing, host lane x3 and runtime lane x3: withheld on bars 0-4, which the rules
  decide, and the Pine value elsewhere; plus the no-over-refusal case: fill 0, bar 0 drawn on both lanes
- 3 v4 on the listing: host byte-identical to the pass without the key, and bars 1-4 = fill; runtime bars 0-4 = fill
- 4 v1 off the listing: host = bounded window, no key; runtime same

Neighbour rails (unchanged files): `ast/listingSeed.test.js` + `ast/pine.selfref.test.js` 32/32;
`__tests__/listingSeedWire.test.js` + `ast/switchedCounter.test.js` 54/54.

## Hand mutations (byte-exact restore, sha256 checked; logs `runs/w34-i4b/mut-*.log`)
| mutation | result | killed by |
|---|---|---|
| M0 no-op control (comment line) | 14/14 green | (control) |
| M1 version gate removed (`listingSeedIsUnpinned` -> false) | 8 red / 6 green | section 2 host v1/v2/null + runtime v1/v2/null, section 1 x2; **v4 rails stay green** |
| M2 version check dropped (-> true) | 3 red | section 3 `host lane: the key is not stated...` (v4), section 1 x2 |
| M3 zero candidate dropped in `listingPass` | 6 red | section 2 host x3 + runtime x3 |
| M4 runtime-lane key dropped | 3 red | section 2 runtime x3 |
| M5 host-lane key dropped (`listingOptsFor`) | 3 red | section 2 host x3 |
Equivalent survivors: none. (M2 leaves the v4 runtime rail green because v4 runs that recurrence in
the VM, not as a column; the host v4 rail kills it.)

## Open / residual
- An OUTSIDE read `x[1]` of a v1/v2 recurrence column on bar 0 still reads `NaN` (the offset), not the
  zero candidate. That leaves a gap, never a drawn guess, unless a `na(x[1]) ? A : B` downstream and
  outside the recurrence picks an arm. No corpus script is v1/v2. This closes when W34-I4-S1 is captured.
- v3 `x := nz(x[1], fill)` is also unmeasured, but out of this lane's scope (v1/v2 only per brief).
- Unstamped documents (no `meta.doorVersion`) keep master's answer.

## Heavy steps (not yet run; awaiting go)
- measure-pair runtime 0 and 1 vs base at `merge-base HEAD origin/master`: expected **0 corpus diffs**
  (no corpus script is v1/v2) and 0 C18 diffs (`!atObjectDoor`).
- final-tip FULL + ready-check.

Logs: `C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/runs/w34-i4b/` (t1.log, handmut.log, mut-*.log, nb1.log, nb2.log).
