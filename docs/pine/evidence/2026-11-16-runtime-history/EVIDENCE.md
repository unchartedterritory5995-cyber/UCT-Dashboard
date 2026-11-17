# Runtime history (coverage unit, NUMBER PENDING)

Branch `feat/pine-coverage-runtime-history`, cut from `origin/master` `1ffddeb654` (engine 60). The
engine number is not bumped here (`scriptEngineVersion.js` carries a `NUMBER PENDING` sentence); the
coordinator lands it in a numbered train.

## What the three codes really were (wall analysis, engine 60, runtime-on lane)

75 sample scripts carry at least one of the three codes (the brief's "87 touched" counts code
occurrences). By the refusal each script's runtime build actually raised:

| code | shape it was, measured | scripts |
|---|---|---:|
| `runtime:conditional-history` | the right of a v6 `and` / `or` | 7 |
| | a `?:` arm: v1 4, v4 7, v5 4, v6 4 | 19 |
| | a drawing build's block local or handle `[1]` (`line.delete(sup[1])` in a block) | 8 |
| | a call in a block / function branch (`ta.highest`, `ta.lowest`, `ta.wma`, `ta.atr`, a helper that keeps history, a call-owned `bar_index[k]`) | 14 |
| | a branch decided by a parameter the call does not fix | 3 |
| `runtime:history-dynamic-offset` | a window LENGTH that is not foldable (`len / 3`, a series length passed to a helper) | 16 |
| | `x[n]`, `n` a helper parameter or a loop counter | 7 |
| `runtime:history-expression` | a window over an EXPRESSION (`ta.hma(s, ln)` in a `switch` arm, `ta.sma(math.pow(..), n)`) | 13 |
| | `(expr)[k]` / a `ta.pivothigh` over an expression of an input | 5 |

## What this unit serves, and what witnesses it

### S1 — before Pine v4 a `?:` runs both arms; `iff` evaluates both arguments

`armHistoryGuard` no longer refuses history in an arm of a `?:` written in v1, v2, v3 or with no
`//@version` (`LEGACY_EAGER_ARMS`), nor in an argument of `iff` (`eagerIff`, set where
`runtimeRespelling` writes `iff` as a `?:`). `SELECT` already evaluates both, which is the rule.

- WITNESSED, `?:`: `vw-ternary-arm-legacy-{v1,v2,v3}-rddt-1d-2026-11-15` and their `-cum` twins
  (run s17, probe P2: `change`, `sma`, `ema`, `rma`, `barssince`, `cum` in the else arm). Through this
  lane, every row of all six captures equals TradingView on all 666 bars (RDDT 1D from the listing).
  The fixture can tell: the per-run reading of B_sma misses on more than 300 bars.
- WITNESSED, `iff`: `vw-cs2-v4-ternary-lazy` C00 (`iff(up, sma(close, 5), close)` is the every-bar
  `sma` on 666 / 666 bars, beside a lazy `?:` that is not); `pivot-high-low-points-rddt-1d-2026-11-14`
  (v4 `iff` over `highestbars`), both plots 666 / 666 through this lane (it refused before).
- v4 and later `?:` arms keep their rule (lazy: `vw-cs2-v4-ternary-lazy`, vw-arm-history).

### S2 — a window that keeps its own ring, over an expression

Where no statement list can take a hoisted binding (an `if` / `switch` arm, a function branch),
`ta.sma`, `ta.stdev`, `math.sum`, `ta.median` (`skip`), `ta.wma` (`ffill`), `ta.highest`, `ta.lowest`,
`ta.highestbars`, `ta.lowestbars` (`finite`) over an expression are handed the expression in place.
In `vm.js` `OP.WINDOW` these policies append the value they are handed to a ring of their own and
never read a committed ring (only `propagate`, `ta.dev`, does), so the in-place value is, bar for
bar, what a hoisted slot would hold. Rail: each function in a block that runs on every bar equals the
same call over a named root series on every RDDT bar. `ta.dev` and a loop keep their refusals.

### S3 — the host lane's engine-58 gate, as a run-time check on the runtime lane

A block, or a `?:` arm, holding history this lane does not step per call site (every call outside
`servedCondCall`'s set) is lowered as on every bar and CHECKED as it runs: at the head of the region a
per-call-site record of the bar it last ran on (`CARRIED2.valuewhen`, occurrence 1, over the run's
`bar_index` column) is compared with this bar (`collections.js` `callSiteRuns`). The first run that
does not follow a run on the previous bar (or a first run after the first bar) stops the run BY
NAME: guard `runtime:conditional-history`, a sentence naming the call, its line, the bar skipped and
the bar it ran again. Nothing of the script is drawn.

- WHY IT IS EXACT: per call site, a call's history is the bars its region ran on (C48,
  `vw-call-site-history`). While the region has run on every bar, those are every bar, and the
  every-bar value is TradingView's whatever the call (an eager and a lazy arm agree there too). This
  is `engine/blockRuns.js`'s rule (engine 58), asked while the bars run instead of at the bind.
- WITNESSED where it stops: `vw-cond-window-extremes-rddt-1d` (`ta.lowest` per call site: no rule
  fits) and `vw-cs2-v4-ternary-lazy` (a v4 arm) both stop by name; their every-bar readings differ from
  TradingView on more than 100 and 50 bars.
- UNCHANGED: the per-call-site set (`ta.sma` / `ta.ema` / `ta.rma` in a root block, those plus
  one-argument `ta.change` in a v6 root arm) is served for any run pattern, as before (vw-arm-history
  I02 equals this lane on every bar).
- ⛔ NOT in a loop, not in the drawing build (`objectsInRun`), not at the object door, not inside a
  request's value; a binding made in another branch still refuses; a branch on a PARAMETER a call
  site can fix still specialises per call site (`condParam`).
- A SIDE FIX: `invariantTest` named the first frame name it met as the "parameter a call site could
  fix", body locals included, so a branch on a body local took the parameter route and was refused
  for a call site that can fix nothing. Only a parameter is named now.

## What a member sees when the stop fires on THEIR symbol (ruling 2, ii)

The pane draws nothing for the script and shows the sentence (the call, its line, the two bars).
Every output of the script is withheld, including outputs that read nothing from the region.
OPEN NOTE (partial withhold): withholding only the outputs that depend on the region is not done.
It would need a dependency walk from each emit back to the region's slots and to every helper it
calls, plus the guarantee that a region's skipped bars change no other output (a region may assign
a `var` other outputs read); that is provable but not cheap, and is listed as follow-up.

## The server lanes

The Python twins do not run the VM. A runtime document is run on the server by the Node service
(`services/pine_runtime`, the same `computeRuntimeColumns`, `runtime/serverEntry.js`): the stop is an
error carrying `guard`, which `runtimeColumns.js` rethrows as is, so an alert / scan over such a
document is withheld by that guard and sentence (`pine_runtime_client.py` `_withheld`), never computed.
The host and screener lanes are unchanged.

## Coverage on this tree (runtime-on predicate: no orders, and clean or attached on the runtime lane)

Measured over the 75 sample scripts that carry one of the three codes (engine 60 census, runtime-on),
plus 65 random controls (40 that transferred, 25 that did not): subset census on `3a1f3d8acf`'s
engine (S1-S3), then the member door + the census's own bound check (`boundBlockers`) on the final
tree (`2662f637f2`) over RDDT 1D (from the listing) and SPY 1D (off the listing).

| script (all four were sole-wall: no other wall) | e60 wall | now: builds (predicate) | runs to completion on RDDT 1D | on SPY 1D |
|---|---|---|---|---|
| `reference:cm-gann-swing-highlow-v2` (v1) | `conditional-history` (v1 arm) | yes | yes | yes |
| `reference:supertrend-cluster-zeiierman` (v6) | `history-expression` (`ta.hma` in a `switch` arm of a helper) | yes | yes | yes |
| `committed:kernel-channel-backquant` (v6) | `conditional-history` (a helper with loops in a `?:` arm) | yes | yes | yes on one run; `runtime:time-budget` on another (the pane's wall budget under box load, not a script stop) |
| `committed:momentum-based-zigzag` (v5) | `conditional-history` (v5 arm) | yes | NO: stops by name at bar 106 (`ta.crossunder`, line 89, in one arm of `?:`; skips bar 105) | NO: stops at bar 93 (skips 92), same call |

Freed by the predicate: **4**; freed AND run to completion on RDDT and SPY: **3** (kernel-channel with the
time-budget caveat). Controls: 0 lost, 0 gained. 26 of the 75 no longer carry any of the three codes
(their next wall is another unit's); 49 still do, each named in the queue doc.

## Capability admission (ON in production) for the four newly transferring scripts

`runtime_definitions.capability_admitted` on this tree, and the runtime-on grade of each committed capture of the
script (PR #1450's own pine-heavy run 43932459523, vendor harness runtime-on lane):

| script | admitted | missing | committed capture, runtime-on grade | action |
|---|---|---|---|---|
| `committed:kernel-channel-backquant` | yes | none | `kernel-channel-backquant-rddt-1d-2026-11-14`: INCONCLUSIVE -> **MATCH** (Kernel Midline, Upper, Lower: 666 / 666 bars) | none: a new runtime-on MATCH |
| `committed:momentum-based-zigzag` | yes | none | `momentum-based-zigzag-rddt-1d-2026-11-14`: INCONCLUSIVE -> **DIVERGE** (TradingView holds 25 drawing objects, our side none; the ZIGZAG plot INCONCLUSIVE, the run stops by name) | **killed by source hash** (`api/data/pine_runtime_killlist.json`, held to that DIVERGE row by `test_RT1_every_committed_kill_is_held_to_its_graded_evidence`) |
| `reference:cm-gann-swing-highlow-v2` | yes | none | none committed (reference-only source) | none |
| `reference:supertrend-cluster-zeiierman` | no | `collections:matrix` | none committed | none (not admitted) |

Other runtime-on verdict moves in that run: none from this unit (`supertrend-kivancozbilgic-rddt-1d-2026-10-02` left
the fixture set on master, #licence fix b39969b3ba). Production lane: no move from this unit.

## Rails and mutants

Rail: `runtime/__tests__/histRuntimeHistory.test.js` (34 cases). Rails that pinned a BUILD refusal for a
shape this unit now builds ask build AND run (`runtime/__tests__/condHistoryOutcome.js`): refused by name,
or drawn only while the region ran on every bar and stopped by the same guard at the first skip.
Mutants (copy aside, mutate, the rail, restore from the copy, `git hash-object` equal; control green, 34
passed), all KILLED: M1 legacy arms not eager; M2 `iff` not eager (survived the first pass: only the column
route was railed; a rail for `iff` off the column route was added and kills it); M3 S2 admits `ta.dev`;
M4 `callSiteRuns` always 1; M5 the check admits a loop; M6 a body local named as the culprit; M7 a binding
from another branch admitted; M8 `ta.stdev` served per call site again; M9 a checked arm's binding read in a
region; M10 a first run after bar 0 admitted. Trees: M1-M10 on `f77d0169ad`, M2 again on `2662f637f2`.

## Capture-session readings that bear on this unit (2026-11-16)

- `vw-wsc-h1-window-runs`: Pine v6 has NO `ta.sum` ("Could not find"); the window sum is `math.sum`. The
  capture split the `ta.sum` rows out (U02 / V02 read `na`). Nothing here serves a sum per call site:
  S2 is a window over an expression in a region checked to run on every bar, and its rail uses
  `math.sum`.
- `vw-arm-history-v3` does not compile as written (v3 has no `bar_index`; the probe header says to use
  `n`). No corrected probe is needed for this unit: v1-v3 arms are witnessed EAGER by
  `vw-ternary-arm-legacy-{v1,v2,v3}`, which S1 serves.

## Still refused by name

See `docs/pine/capture-queue-2026-11-16-runtime-history.md` (rows HIST-F1..F4, HIST-K1..K2 and the
table of shapes that are not capture questions).
