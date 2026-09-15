# ⛔ TRACK A ITEM 3 — ROOT CAUSE MEASURED (HEAD b3eb61b0c). ARCHITECTURE DECISION NEEDED.

## ⚠️ FIRST, A CORRECTION OF A CORRECTION — I FLIP-FLOPPED, AND HERE IS WHY

I first said the derived-source branch overrides the explicit pane target
(unmeasured). I then "corrected" that to say it could not, because
`resolveDisplayTarget` honours an explicit target that differs from the declared
one. That correction rested on my reading a code comment — "DECLARED ON PRICE" —
which belongs to `movingAverage`, NOT to `dataSeries`.

**Measured at runtime: `dataSeries` declares `placement.target = "pane"`.**

So the ORIGINAL hypothesis was right and the correction was wrong. The lesson is
the same one this whole track keeps teaching: measure the instance, do not read
the neighbouring comment.

## THE MEASUREMENT — three controls, same door, same identity path

| control | source | stored placement | resolved | inPaneOwnKeys | pane |
|---|---|---|---|---|---|
| A (add only)      | `close`          | `{"target":"pane"}` | **price** | false | none |
| B (chose Own Pane)| `close`          | `{"target":"pane"}` | **price** | false | none |
| C (QQQ source)    | `sym:QQQ:close`  | `{"target":"pane"}` | **pane**  | true  | `@1` |

**A and B are byte-identical.** Choosing "Own Pane" changes NOTHING on disk,
because the value the member picked is the value creation already wrote.

## THE CHAIN, proven

1. `dataSeries` DECLARES `placement.target = 'pane'`.
2. `addInstance` writes `placement: { target: <declared> }` on every instance — so
   a brand-new one already carries `{"target":"pane"}`.
3. A member picking Own Pane makes `setInstanceDisplayTarget` compute its default
   from the BARE instance via `resolveDisplayTarget` → `'price'` (derived from the
   `close` source), sees `'pane' !== 'price'`, and writes `{"target":"pane"}` —
   identical bytes to step 2.
4. `resolveDisplayTarget` short-circuits on an explicit target ONLY when
   `explicit !== declared`. Here `'pane' === 'pane'`, so the short-circuit is
   SKIPPED.
5. Control falls to the derived-source branch: `close` → the primary → `'price'`;
   `sym:QQQ:close` → a foreign symbol → `'pane'`.

So the source decides, and the member's explicit choice is unexpressible.

## ⛔ THE ACTUAL DEFECT — and why it is a DECISION, not a patch

**The stored representation cannot distinguish a member's explicit override from
creation-time restatement of the declaration.** When the chosen target equals the
declared one, the two are the same bytes.

The `explicit !== declared` guard exists ON PURPOSE — its comment records that the
migrator AND `addInstance` both write a restating placement, and that treating
those as overrides broke `MA(RSI)` (it "computed a perfect average of RSI and drew
it on the candles' scale"). So the guard cannot simply be dropped.

Candidate seams, NONE chosen:

  · stop writing a restating placement at CREATION, so a present key means an
    override — but legacy/migrated instances still carry restatements, so the
    guard must survive for them, and the two populations need telling apart;
  · record the override distinctly (an explicit flag or a distinct shape) — a
    schema addition, with a migration story;
  · make the reader compare against the same "bare resolved" default the WRITER
    used, instead of the declared literal — the asymmetry between those two
    notions of "default" is arguably the bug.

⚠️ AND NOTE: the owner's "unset source" ruling would make THIS CASE work by
accident (no source → no derived answer → declared `pane` stands). The brief
explicitly forbids using it to hide a realization bug, and the owner states a
member may legitimately want the PRIMARY Close in its own pane — which is exactly
the combination that is unexpressible today. So this defect must be fixed on its
own terms.

## Also observed, unrelated but recorded

Control C's realized pane reports height **0** (`physicalPanes: [691, 0]`).
A pane with no height is the collapsed-pane shape; worth a look when pane sizing
is next touched.

---

# ⚠️ TRACK A ITEM 3 — CORRECTION + TWO HARD CONSTRAINTS (HEAD 19653ec93)

## ⛔ A CLAIM I MADE WAS NOT MEASURED — TREAT IT AS UNPROVEN

I previously reported the remaining blank-Data-Series defect as:

    "source-derived placement overrides the explicit pane target"

**I did not measure that.** Reading the code contradicts it:

`instanceControls.setInstanceDisplayTarget` deletes the placement key ONLY when
`target === defaultTarget` (it computes `defaultTarget` from a `bare` copy), and
`displayTarget.resolveDisplayTarget` returns the explicit value whenever it
differs from the declared one:

    const explicit = instance.placement && instance.placement.target
    if (typeof explicit === 'string' && explicit && explicit !== declared) return explicit

For `dataSeries`, declared = `price`, so an explicit `pane` SHOULD survive and
SHOULD reach `paneOwnKeys`. The derived-source branch sits BELOW explicit.

So the real reason a blank pane-targeted Data Series produces no pane is still
UNKNOWN. Do not build on my earlier sentence. Re-measure with a diagnostic that
reports, for the blank instance: stored `placement`, `resolveDisplayTarget`,
`paneOwnKeys` membership, `paneCountRequired`, and `layout.panes`.

## ⛔ CONSTRAINT 1 — `source` CANNOT SIMPLY DEFAULT TO EMPTY

`engine/defSchema.js` validates `type: 'source'` defaults with
`isNonEmptyString(d)` and rejects otherwise:

    type "source" requires a non-empty string (a bar field or a "defId.plotKey" handle)

So the owner's ruling ("new Data Series source is UNSET") cannot be implemented by
changing the definition default to `''`. Options to weigh:

  · allow an omitted `default` for `type: 'source'` (schema change, affects every
    source-capable definition);
  · leave the DEFINITION default as `close` but have `addInstance` omit the input
    for this definition (instance-level, but needs a non-id-based rule);
  · represent unset at the instance seam some other way.

⭐ THE GOOD NEWS: `sourceRef.parseSource` already returns `null` for an absent or
empty value, so the RESOLUTION side already understands "unset". Only the
CREATION/validation side needs a representation.

## ⛔ CONSTRAINT 2 — `close` IS GENUINELY SHARED

`movingAverage` declares the same `{ key: 'source', type: 'source', default: 'close' }`.
The owner's ruling explicitly preserves MA's Close default, so any change must be
scoped to the generic Data Series without touching that literal's meaning — and
an EXISTING persisted `source: 'close'` on a saved Data Series must keep meaning
explicit primary Close, never be reinterpreted as unset.

---

# ⛔ TRACK A ITEM 3 — BLOCKED ON AN ARCHITECTURE DECISION (not a bug to patch)

**Measured 2026-09-15. HEAD 0c68badaf. Nothing changed for this item.**

## The symptom

Chart Data → Data → **+ Add** a blank Data Series, set *Display in = Own Pane*.
Canonical intent is stored correctly, but no pane is ever realised and the
unresolved Series plots the PRIMARY close on Price.

## First divergence — PROVEN, do not re-derive

TWO ADD PATHS MINT TWO DIFFERENT INSTANCE IDENTITIES, and one of them is
silently dropped by normalisation.

    catalogue / scenario add  → addInstance()          → `inst:dataSeries:1`
    Chart Data browse "+ Add" → toggledRow()
                              → setIndicatorEnabled()  → `legacy:dataSeries`

Measured side by side in the harness, same chart, same definition:

    inst:dataSeries:1   storedTarget=pane  resolved=pane  inOwn=true
       → layoutPaneKeys ["inst:dataSeries:1@1"]  paneCountRequired=2
       → paneHeights [586, 103]        ✅ its own pane

    legacy:dataSeries   storedTarget=pane  (shown in the instance panel)
       → engineInstances []            ❌ ABSENT from the normalised list
       → layoutPaneKeys []  paneCountRequired=1
       → paneHeights [690]             ❌ no pane

So the chain is: browse-Add mints a LEGACY-shaped id → normalisation drops it →
`paneOwnKeys` never sees it → no pane key → `paneCountRequired` stays 1.

## What is NOT the cause

⛔ `paneTargetIds()` is NOT the veto. `orderedPaneKeys` already reads
`if (!paneIds.has(id0) && !(include && include.has(id))) continue` — the
definition-level target gate IS overridable by `paneOwnKeys`. The precedence
rule the brief asks for already exists and works; the instance simply never
reaches it.

## Why this was not fixed here

The fix is a decision with blast radius across EVERY definition row in the
library, not a local patch:

  (a) make browse-Add use `addInstance` for instance-based definitions — changes
      the identity minted by the main library door for every technical row; or
  (b) make normalisation keep `legacy:<defId>` for definitions that have no
      legacy settings row — changes what a legacy id MEANS.

Both are product/architecture calls. Guessing one at the end of a long session
is how the earlier half-finished work happened.

## Also worth deciding at the same time

The unresolved Series plots the PRIMARY CLOSE (its `source` input defaults to
`'close'`). The owner's brief flags this as suspicious and asks whether
"no source → no data" is the intended semantic. That question belongs with (a)/(b)
because it is the same instance's lifecycle.

---

# NEXT UP — PANE HEIGHT PERSISTENCE (root-caused, NOT implemented)

**Owner-reported, 2026-09-15.** Drag the separator to make an own pane taller;
on release it SNAPS BACK to its computed default.

## Root cause — PROVEN, do not re-derive

`paneStretchPlan` (`engine/paneLayout.js`) seeds from `cur.slice()` then
UNCONDITIONALLY overwrites every pane the layout covers. Measured:

    current (post-drag):      [270, 330, 100]     ← member dragged QQQ to 270
    plan (what gets applied): [ 81, 463, 154]     ← QQQ 270 → 81

`binder.js` (~line 467) then applies it: `want[i] !== current[i]` →
`setStretchFactor`. The drag survives only until the next binder sync.

**Pane-height authority today: NONE.** The flow is one-way —
`computePaneLayout → paneStretchPlan → setStretchFactor → LWC`. The manual drag
ends inside lightweight-charts and never becomes canonical UCT state.

## Design already agreed

`setStretchFactor` is a RELATIVE WEIGHT, not pixels — so persisting post-drag
stretch factors keyed by PANE KEY (`price`, `volume`, instance host id) gives
widget-resize correctness for free, keeps size independent of `cs.paneOrder`,
and makes a size follow its pane across reorders. No pixel geometry.

⛔ Absent size → existing computed default, unchanged. Only an explicit resize
creates a preference. No migration.

## Two acceptance items attached by the owner

**1. QQQ price-axis labels (600 / 705 instead of decimals).** MEASURED: the
series formatter is CORRECT — `{type:'price', precision:2, minMove:0.01}`,
`format(704.69) → "704.69"`, `lastValueVisible: true`, scale `right`. So it is
NOT a formatting bug. Hypothesis: the pane is stuck ~90–100px, and LWC picks
coarse tick spacing for a short pane over a wide range. TEST AFTER the resize fix
— capture labels at small height, then at a large height. If height explains it,
add NO formatting fix. Distinguish SERIES VALUE FORMATTING from AXIS TICK
SELECTION; do not force precision/minMove/custom formatters.

**2. Secondary-symbol live ticking — ANSWERED: HISTORICAL ONLY.**
`engine/secondaryBars.js` is a fetch-once module cache keyed by URL
(`GET /api/bars/{ticker}`), exporting `ensureAll` / `cachedBars` / `subscribe`
(a cache-LANDING notifier, not a feed). There is NO `livePriceStore`, no polling,
no stream on this path. `useSecondarySources` re-runs on
`[instances, defOf, tf, barCount, fetcher, cs]` — settings changes, never price
ticks — and `ensure` skips anything already cached.

So a charted QQQ dataSeries: (1) gets historical bars through the canonical
shared path ✅; (2–5) does NOT subscribe, does NOT update its plotted value,
legend or last-value label ❌; (6) has no subscription to clean up;
(7) cannot double-subscribe — the cache is keyed by symbol/tf/bars, so
own-pane vs Price-guest changes do not touch the data path ✅.

⚠️ **A SEPARATE FOLLOW-UP, NOT PART OF THE PANE FIX.** The frontend live path
(`/api/live-prices` → `livePriceStore`) exists, but wiring it here means topping
the last bar of a CROSS-CHART SHARED cache for N symbols with cadence throttling.
That is not the trivial hookup the owner carved out.

---

# ⚠️ WORKSPACE UX ISSUE — "NEW LAYOUT" REPLACES THE UNSAVED WORKING STATE

**Recorded 2026-09-15. NOT a Track A defect and NOT to be fixed in Track A.**

`LAYOUTS → New Layout` does not open an isolated scratch workspace: it REPLACES
the current unsaved working layout. During Track A live verification this
discarded the owner's unsaved NVDA + QQQ arrangement. The four SAVED layout tabs
(1-Chart, Alienware, Calendar, Intraday Scan) were unaffected, and Main Trading
was never opened.

⛔ **DO NOT USE `New Layout` FOR VERIFICATION** unless the current working state
is explicitly disposable. Prefer, in order:

1. the isolated local harness (`app/pane-harness.html`) — preference writes are
   locked there, so no workspace state can be touched at all;
2. an existing, unquestionably disposable layout;
3. production only where the interaction cannot destroy a working state.

Worth considering later: an explicit scratch/disposable workspace, or a prompt
before `New Layout` discards unsaved work.

---

# TRACK A FOLLOW-UP — PANE-ORDER CHROME OWNERSHIP · FIXED LOCALLY · AWAITING DEPLOY COMMAND

> ⭐ **READ THIS BEFORE THE BLOCK BELOW.** Track A pane ordering is already on
> `origin/master` and in production. This block is the FOLLOW-UP FIX for two visual
> regressions the owner found by testing pane reordering on the live site. It is
> **committed locally and NOT pushed.**

**Written 2026-09-15. Local commit `84fbd7394` on `master`, ahead of `origin/master`.
NO RAILWAY ACTION. NO PUSH. NO DEPLOY.** The owner will say when.

## What was broken

Repro: UCTA50 as the chart, QQQ added as a second pane, QQQ then moved ABOVE Price.

| | |
|---|---|
| BUG 1 | the OHLC legend stayed at the TOP of the workspace, labelling QQQ with Price's readout |
| BUG 2 | the `3M 6M YTD 1Y 5Y Origin` lookback bar flew to the TOP of the workspace |

Both from one stale assumption in `StockChart`'s rAF sampler — `panes[0] === the price
pane` — which positioned THREE surfaces from that single number. Bug 2's formula was
`containerHeight - height(pane 0) + 8`: right while pane 0 was the tall Price pane,
nonsense when pane 0 is a 100px QQQ.

## ⛔⛔ THE ONE THING NOT TO UNDO

They are NOT the same bug, and fixing one by making both follow the same coordinate
system is the trap:

| kind | surfaces | anchored to |
|---|---|---|
| **PRICE-OWNED** | OHLC legend, drawing toolbar, comparison rows, responsive collapse | the pane the CANDLE SERIES is in, by identity |
| **WORKSPACE-OWNED** | the lookback bar | the GLOBAL TIME AXIS — bottom-left of the whole stack, above the date scale |

`lookbackBottomPx` takes **no pane argument at all**. That is deliberate: it makes "the
lookback bar does not move with Price" structural rather than a number that happens to
come out right today. Making it Price-owned would look correct in QQQ/PRICE and wrong in
QQQ/RSI/PRICE.

## Where it lives

| file | what |
|---|---|
| `app/src/components/chart/chromeGeometry.js` | NEW. The whole chrome decision as one pure `chromePlan`. The sampler measures and applies; it decides nothing. |
| `app/src/components/StockChart.jsx` | the sampler now applies the plan (~line 14720) |
| `app/src/components/StockChart.module.css` | `.legendFlat` / `.legendVertical` / `.compareRows` / `.compareRowsSide` now consume `--price-pane-top` |
| `app/src/testing/panes/paneHarness.jsx` | renders the lookback bar (`showRangeSelector` defaults OFF, so the surface under test was invisible there) |

**Why the legend and the toolbar behaved differently** — the thing that identified the
bug: `--price-pane-top` was working the whole time. The base `.legend` rule consumed it
correctly, but `.legendFlat`/`.legendVertical` re-declared `top` as a bare constant and
won on source order. The drawing toolbar lives in `ChartToolbar.module.css` and has no
such variant, so it followed Price correctly. The asymmetry in the owner's screenshot was
the clue.

## Rails (31 new, every one bite-checked)

- `chart/__tests__/chromeGeometry.test.js` — layouts PRICE/QQQ, QQQ/PRICE, RSI/PRICE/QQQ,
  QQQ/RSI/PRICE. Each asserts the pair TOGETHER: legend tracked Price **and** lookback did
  not. Plus resize, degenerate pane lists, and the pre-fix formula kept as a control.
- `chart/__tests__/priceOwnedChrome.css.test.js` — reads the stylesheets. Bug 1 was a CSS
  bug; no JS test can see it. Fails if a Price-owned surface ever drops the offset, and
  fails if `.rangeBar` ever gains it.

## Browser proof (isolated pane harness, `preference writes refused: 0`)

| layout | legend top | lookback, above container bottom |
|---|---|---|
| PRICE / QQQ | 28px | 36px |
| QQQ / PRICE | 132px | 36px |
| QQQ / PRICE / RSI | 131px | 36px |
| RSI / QQQ / PRICE | 235px | 36px |

Survived save/reconstruct. Under resize the Price offset tracked 206 → 136px while the
lookback bar held 36px. 8px clearance to the date scale. One legend, one range bar
(nothing stale). Zero console errors across load, two adds and two live reorders.

## Verification

- broad `src/components`: **10622 passed / 4 failed** — the same four known-red files
  (`ChartDrawingOverlay.surfaces`, `ast/manifestProse`, `ast/pine.blindCorpus`,
  `screener/reachable`). Zero new failures. The two modules `reachable` names
  (`lib/context/focusDivergence.js`, `surfaces/manifest.js`) are pre-existing and unrelated.
- focused chart + engine suites: 1379 passed / 0 failed.
- `StockChart.jsx` eslint 106 errors = baseline, `no-undef` 0. stylelint 0 errors.
- `npm run build` clean.

## ⚠️ KNOWN FLAKY RAIL — `stockChartWiring.test.jsx` "A HOVER REACHES THE RENDERER NOT AT ALL"

Seen ONCE in 4 broad `src/components` runs on the Track A follow-up tree (2026-09-15).
**Not a Track A regression.** Characterisation, so the next person does not re-derive it:

| tree | runs | result |
|---|---|---|
| clean `origin/master` | 3 | 4 failures every time — never reproduced |
| Track A follow-up | 4 | 3 × 4 failures, 1 × 5 failures |

**Why it is not ours.** The rail clears `H.applyOptionsCalls`, fires mouseEnter/mouseLeave
on the **RSI** chip, then asserts the array is empty. The calls it captured were
**candlestick** options (`upColor` / `downColor` / `wickUpColor` / `borderVisible`) — not
the RSI line series that was hovered. A hover-triggered restyle would restyle the HOVERED
series. This is the price-style effect (master's own, unchanged by Track A) flushing inside
`act`, inside an observation window that is racy for ANY pending async update.

**And the sampler cannot reach it.** `StockChart`'s rAF chrome sampler contains no
`applyOptions` at all; its only state effect is `setCompactLegend`, whose threshold AND
guard are arithmetically IDENTICAL to the pre-Track-A code on every unarranged pane shape
(verified across `[420,120]`, `[600]`, `[300,80,90]`, `[0,100]`, `[]`) — and that test
renders an unarranged chart. The only Track A delta is extra per-frame measurement work,
which can shift WHEN an unrelated pending update flushes, not WHETHER one exists.

⛔ **The rail was left exactly as it is.** It states a true product contract (a legend
hover must never restyle the plot) and must not be weakened to go green. If it becomes
noisy, the fix is deterministic lifecycle synchronisation in the test's observation window
— never relaxing the assertion.

## NEXT ACTION

**Wait for the owner's explicit deploy command.** Then push `84fbd7394` with the rest of
Track A. Observe the market-hours push rule (no push to master Mon–Fri 09:00–16:00 ET).

---

# TRACK A — PANE ORDERING · IMPLEMENTATION COMPLETE · DEPLOYMENT PAUSED BY OWNER

> ⭐ **SCOPE: TRACK A ONLY.** This block does not supersede the Discord/notebook header
> below it; the two tracks are independent. Read this one before touching pane ordering,
> chart panes, `ChartDrawingOverlay`, `drawingPanes`, or chart-settings pane state.

**Written 2026-09-15 ~03:35 ET. Owner paused deployment; next action is to WAIT for an
explicit owner command. Do not resume on your own.**

## ⛔⛔ READ THIS FIRST — THE CODE IS ALREADY ON origin/master

The owner's pause instruction arrived **after** the push had completed. Track A is not
sitting on a branch waiting to go out — it is **merged and pushed**:

| | |
|---|---|
| origin/master | `5e88b38c4193d705973838e17f72da8b9f4cf911` |
| local `master` | same — `5e88b38c4`, in sync, clean tree |
| branch `feat/pane-ordering` | `ebefae3f0` (merged into master by fast-forward; kept) |
| accepted implementation SHA | `7da1f4ed6` — an ancestor of origin/master |
| master reconciled through | `7ac0e0aee` (master's "Set level" drawing work) |
| pushed at | 2026-09-15 03:25Z |

**Nothing was reverted.** The pause is about DEPLOYMENT SEQUENCING, not about backing the
code out. Do not "undo" the push to honour the pause — that would be a far riskier act than
letting the deploy finish. If the owner wants it out of production, that is a revert
decision to take deliberately, with them, in daylight.

## DEPLOYMENT STATUS: PAUSED BY OWNER

- **Reason.** A Railway deployment had been building for an unusually long time and looked
  possibly stuck. The owner paused rather than risk interfering with a partner's deploy.
- **Track A response.** No Railway action of any kind was taken — nothing cancelled,
  restarted, superseded, redeployed or reconfigured. Read-only status polling only.
- **Track A itself is NOT blocked or broken.** Implementation is accepted. The only open
  item is deployment sequencing and Railway state.

State at pause:

| | |
|---|---|
| GitHub deployment | id `6451049321`, sha `5e88b38c4`, **`in_progress`** since 03:25Z |
| CI on `5e88b38c4` | ✅ all three green — deploy gate (1m42s), vite build args, wisdom rails |
| production health | `https://uctintelligence.com/api/health` → **200** |
| production assets | still the PREVIOUS build (`index-Bi9ElRZo.js`) — Track A markers (`paneOrder`, `--price-pane-top`) **absent**, i.e. the new bundle had not gone live at pause |

⚠️ So production is healthy and serving the pre-Track-A frontend. The deploy may well have
completed on its own overnight — **check, do not assume, in either direction.**

## WHAT IS ACCEPTED (do not redesign any of this)

durable `cs.paneOrder` authority · visual order separated from computation/instance order ·
Price movable above or below other panes · pane HOSTS move with their guest series ·
independent Volume semantics · safe realization index vs final visual index ·
cold reconstruction without pane merging · Price-owned chrome follows Price · drawing
geometry follows Price · `paneValueAt` pixel→value via `paneTop` · `paneYForValue`
value→pixel via `paneTop` · Track A's full-stack placement offset via `paneTop` ·
pane-owned `fromPaneFraction` path stays non-double-offset · geometry-triggered overlay
redraw · compact Chart Data UX · **default parity when `paneOrder` is absent**.

## EVIDENCE ALREADY BANKED (do not re-run to "be sure")

- **Focused:** 201 passed / 9 files — paneOrder, paneOrderLayout, paneRealization,
  drawingPanes, paneTransform, chartData, chartDataMap, alertSets, perInstanceDoor.
- **Broad:** 4 failed / 11568 passed. Clean-master baseline measured in a scratch worktree
  at `7ac0e0aee`: 4 failed / 11493 passed — **the identical four files. Zero new failures.**
- **Known baseline failures (NOT Track A):** `ChartDrawingOverlay.surfaces.test.jsx`
  (master ships it red), `engine/ast/manifestProse.test.js`,
  `engine/ast/pine.blindCorpus.test.js`, `screener/reachable.test.js`.
- **Build:** clean. **Lint:** every changed file at its established baseline; `no-undef` 0.
- **Browser (isolated `pane-harness.html`, never Main Trading):** Price TOP / MIDDLE /
  BOTTOM each verified — drawings inside Price at correct prices, no stale ink in the pane
  above, legend and toolbar follow Price (`--price-pane-top` 0 / 207 / 311, legend always
  28 + that), host+guests together, no console errors. Save→reconstruct of a non-default
  arrangement restored exact order and pane count with no merges.
- **Tripwires:** blob key-set delta vs current master is exactly `+ paneOrder`, nothing
  removed, 40 → 41. `alertSets` and `perInstanceDoor` re-pinned with dated notes.

## SAFETY STATE AT PAUSE

- **Main Trading: NOT opened.** Remains frozen; expected fingerprint
  `ea9ebaeee302b7e1f6c68530bc3b40ab824eb765b73e836cad66be2dc40e5922`. The safe read-only
  sqlite check is **unavailable in every local worktree** — reported honestly across
  sessions, never worked around.
- **Live `:8000` APScheduler backend: untouched and healthy** (200). Do not close that
  PowerShell window.
- Dev server on :5177 stopped; browser tabs closed; scratch baseline worktrees removed
  (`/c/uctb2`, `/c/uctb3`) — their `node_modules` junctions were deleted *before* the
  worktrees, so the real `node_modules` was never followed.

## TOMORROW — RESUME PROCEDURE (only on explicit owner command)

1. `git fetch origin master`; record the new SHA and what changed since `5e88b38c4`.
2. **Check the Railway/GitHub deployment for `5e88b38c4` first.**
   - completed **success** → Track A is LIVE. Verify production health + that the live
     bundle now carries `paneOrder` / `--price-pane-top`, then report it as live.
   - **failed** → determine whether the failure is Track A's or the partner's before
     anything else.
   - **still building** → STOP and report. Do not interfere with a partner deployment
     unless the owner explicitly authorises it.
3. Diff new master against Track A's sensitive surfaces: pane ordering, pane layout, pane
   realization, drawing coordinates, `ChartDrawingOverlay`, `drawingPanes`, chart-settings
   pane state.
   - unrelated → integrate mechanically; **no new architecture review**.
   - materially overlapping → reconcile deliberately before anything ships.
4. Focused suites + broad suite vs a *current* clean-master baseline + `npm run build`.
5. Verify production without opening Main Trading or `/charts`.

⛔ No timer, cron, scheduled task or autonomous deploy was created for this. Resumption is
owner-triggered, by hand.

---

# RESUME — restart checkpoint 2026-09-14 15:20 ET (Monday, pre-close)

> ⭐ **THIS IS THE CURRENT HEADER.** Everything below it is superseded where it disagrees.

## a00b. What the Discord admin pass changed, and the two flip blockers it uncovered

The owner opened a browser and handed the whole Discord list over. **A1, A2 and A3 are DONE and
verified by API read-back.** The `⛔⛔ ONE OWNER ACTION` block in §a00 below is **satisfied** —
`MANAGE_CHANNELS` is granted — and the rest of that section's blocked rows have moved.

| Was | Now |
|---|---|
| bot lacks `MANAGE_CHANNELS` | ✅ granted — `--whoami` says `CAN create channels` |
| `#render-alerts` Contributor-visible | ✅ **overwrite removed**; probe says `RENDER_ALERTS_ACL ACL_OK`. Precondition row is **MET** |
| no channel both bot-postable and not Contributor-visible | ✅ **`#render-smoke` = `1549129739048853544`** exists, private at creation, organic members exposed **0** |

⛔⛔ **NEXT SESSION, READ THIS FIRST — two flip blockers, both found by executing the brief:**

- **OI-34.** `/chart`, `/charts`, `/flow` were gated to **ONE** channel id. Repointing
  `CHART_FLOW_CHANNEL_ID` MOVES the commands, it does not add — every member of a 1,558-member
  guild loses all three. Fixed: it is now a comma-separated **allowlist**, first entry is the
  member-facing one that the nudge names. ⭐ This is also the real answer to Gap 3: the `/chart`
  shadow saw nothing because a member can only run `/chart` in one channel.
- **OI-35.** There was **no per-channel V2 flag**. `commands.enabled()` is one global boolean;
  `command_enabled()` splits by COMMAND. The flip packet said "per-channel per 2.1" and §4.0 said
  the canary is the admin channel — both disagreed with the code, and agreed with each other.
  Flipping as written = the member-channel flip. Fixed: `DISCORD_RENDER_V2_CHANNELS` narrows V2;
  **unset means every channel**, so its absence is "there is no canary", never "the canary is off".

⚠️ **OI-33:** `MANAGE_CHANNELS` is NOT enough to edit an existing channel's overwrites — that needs
`MANAGE_ROLES` (403 `50013`). `MANAGE_ROLES` was deliberately **not** granted; A2 went through the
browser instead. Do not "fix" this by granting it.

⚠️ **OI-36:** `/buzz` in `#render-smoke` → **"The application did not respond"** while the renderer
answered `200, 346 KB, ms=10738` against a 3 s ack deadline. **C-11 live, on the pre-V2 path.** The
shadow said `outcome=agree`, so V2 would do the same — not a defect the flip fixes.

### The queue as of 15:20 ET

**9 commits on `discord-render-hardening`, gated and waiting for the 16:00 window.** Full scoped
gate **798 passed / 9 skipped / 0 failed**; pre-V2 golden **0 drift**; mutations **3/3 + 4/4 RED**.
Master moved two commits under the gate, touching only `.github/workflows/master-deploy-gate.yml` —
**no overlap**, so the gate stands (08's no-overlap branch, not a stale green).

⛔ **The canary flip is BLOCKED tonight and here is exactly why**, so nobody re-derives it:

| Row | State | Can it clear tonight? |
|---|---|---|
| forensics **C-02** | 🟡 ack half closed; load half needs 3.1 `--real` | **yes — tonight's run** |
| forensics **C-09** | 🔴 open; needs 3.1 `--real` to show the warm cycle yields | **yes — tonight's run** |
| forensics **C-13** | 🟡 log hygiene shipped; **token rotation is OI-13, the owner's** | see below |
| soak ≥ 24 h | 57/90 clean ticks, 15 min apart | **~23:40 ET** — reachable, late |
| 3.5 smoke | 2 of 15 rows | partly |

⭐ **C-13's rotation is NOT a manual owner chore — it is automated and it has been silently
failing.** `UCT Render Token Retire` reported `lastRun=07:15, LastTaskResult=1` and had **never done
anything**: its `.cmd` redirected stdout into `render_token_retire.run.log`, *the same file the
Python script opens for append*, so the script died on its first `log()` call with `PermissionError`
— and its crash handler died on the same line. The wrapper now writes to
`render_token_retire.wrapper.log` (backup: `render_token_retire.cmd.bak-2026-09-14`). **The Morning
Wire HAS run today** (`last_run_date = 2026-09-14`), so its precondition is satisfied and it can run
after the close. The script itself is careful — it probes both tokens first and aborts if the
current one is not accepted.

### What the 16:00 sequence actually did — 2026-09-14, 16:45 ET

**Merged and deployed `56e9d3aec`** (OI-34, OI-35, B1, B4/B5, B2, all 316 anchors green).
`web` SUCCESS, **and `chart-renderer` SUCCESS too** — its watch path is `services/chart_renderer/**`
and B1 touches it, so B1's lever is IN PRODUCTION but **dark** (`RENDER_ADMIN_ENDPOINTS` unset).

⛔ **I pushed at 15:49, eight minutes BEFORE the close, having decided not to and having set a timer
to prevent it.** I acted on a mental estimate that had drifted ~25 minutes. Cost: a `web` +
`chart-renderer` restart in the last minutes of RTH; `/api/health` 200 after; no scheduler slot was
due. Full entry in `LEDGER.md`. **Standing correction: no scheduled action fires on a remembered
time — read the clock in the same tool call that takes the action.**

### The numbers, and the rate they belong to

| phase | S1 ack | S2 p50 / p95 / p99 | success | failures |
|---|---|---|---|---|
| 3.1a — **30 arrivals/s** | p95 63 ms, `over_3s` **0** | 14,855 / 18,117 / 18,836 ms | 35.7 % | **all `queue_full`** (81) |
| 3.1b — 100 burst | p95 1 ms, `over_3s` **0** | 13,727 / 16,472 / 16,953 ms | 50.0 % | **all `queue_full`** (31) |
| **3.1c — 1 arrival/s × 10 min** | p95 6 ms, `over_3s` **0** | **3.5 / 1,748 / 6,692 ms — ALL INSIDE S2** | 98.67 % | **all `queue_full`** (8) |

⭐ **S1 held in every phase. Every single failure everywhere was `queue_full`** — never a timeout,
never a render error, no breaker trip. 593 real charts delivered in 3.1c alone (97.6 MB).
⚠️ **OI-37:** the brief said "30 concurrent"; `--rate 30` is 30 **per second**, so 3.1a is ~15× the
specified load. Quote no S2 number without its arrival rate.

chaos `--real` **PASS** (7 ran, 7 passed, 6 refused by name) · determinism ×20 **PASS** (6/6
identical) · wire hop **PROVEN** (40 × HTTP 200).

### ⛔⛔ THE THING TO READ FIRST IF YOU READ NOTHING ELSE

**The flip gate's S2 row could not fail.** `check_s2_measured` was `MET if the --real files exist`
and never opened them. Tonight's runs all printed FAIL — and the row flipped from NOT MEASURABLE to
**MET** because five files now existed. **Producing failing evidence made the gate greener**, on the
row that decides whether delivery meets its SLO, in the tool `06` §0 calls "the authority".
Two sibling rows (chaos, 3.5) had the same shape. All three now read verdicts. **Re-read any flip
decision taken against the old tool.**

### Flip status: NOT MET, and it is not close

| row | state |
|---|---|
| forensics | 🔴 11/14 — **C-02**, **C-09**, **C-13** open |
| S2 | 🔴 9 named breaches at 30/s (MET at 1/s) |
| 3.5 smoke | 🔴 **2 of 15 rows** |
| soak | ⚪ 61/90 ticks (~23:40 ET) |
| mutations | ⚪ needs `--run-mutations` (anchors are 316/316) |
| cache · chaos · shadow · xfails · `#render-alerts` | ✅ MET |

**Organic members exposed to V2: 0.**

### Next session — in this order

1. **3.5 rows 2–4, 6–7, 10–15** in `#render-smoke` (rows 1 and 9 pass; 5 and 8 need re-running).
   ⛔ Save each screenshot to disk in the SAME action — ephemeral replies do not survive a reload.
2. **OI-38** — the cache reported `hits 0, misses 0` under `--real`: not a poor hit rate, *not even
   a miss*, across ~76 renders of 20 symbols. Gap 1's 80 % is a bench number, unreproduced.
3. **Arm B1** on chart-renderer (`RENDER_ADMIN_ENDPOINTS=1` + `RENDER_ADMIN_TOKEN`) and take the
   determinism-across-recycle row from NOT MEASURABLE to measured.
4. **C-13** — `render_token_retire.cmd` is fixed and the Wire has run; it can go any time.
5. Re-run `flip_preconditions.py`.

---

# RESUME — restart checkpoint 2026-09-14 13:50 ET (Monday, midday)

## a00. The midday state, and the four things that are blocked

**Master `db23f17e8` is live and verified in-process.** Two further commits (`abda0e0d0`,
`26a88d052`) are **gated, green and queued** — master's own pre-push guard refused them because
another session's deploy was in flight, and the override was deliberately not used.

| Ruling | State |
|---|---|
| Gap 1 — cache wired to the hot path | ✅ **merged**, 80 % hit rate on the bench, 8 mutations red |
| Gap 3 — `/chart` shadow | ✅ **settled**: the hook fires (mutation-proved); the absence was real traffic absence, confirmed by an EXACT pull **and** by the chart production log |
| OI-32 — never cache a stand-in | ✅ **merged**, refused at BOTH tiers |
| NOT-APPLIED ≠ 0 | ✅ **fails in the gate** (`tests/test_mutation_harness_anchors.py`), one second, plus per-retirement cross-references |
| Gap 2 — S2 in `--real` | 🟡 **built and self-checked, NOT RUN.** Needs a delivery channel |
| Gap 4 — 3.5 smoke | 🔴 **blocked**: no channel is both bot-postable and not Contributor-visible |
| Step 1.3 — `#render-alerts` | 🔴 **measured**: `Contributor` is the channel's ONLY view-allow overwrite |

⛔⛔ **THE ONE OWNER ACTION THAT UNBLOCKS THE MOST:** grant the bot's role
(`UCT Intelligence`, `1474903498700230668`) **`MANAGE_CHANNELS`** — then
`discord_channel_admin.py --create-smoke` makes `#render-smoke` with itself inside it, and 3.5 plus
the `--real` delivery hop both unblock. ⚠️ That grant does **not** fix `#render-alerts`: 50001 there
is *membership*, and the bot has no overwrite on that channel. Two gaps, two fixes.

**Flip gate: `NOT MET`** — `python docs/discord-render/instruments/flip_preconditions.py`.
Three rows NOT MET, five NOT MEASURABLE, **organic members exposed 0**.

**Shadow at 13:39 ET: 33 records, EXACT, all `/flow`, all agree, zero divergences, zero `/chart`.**
No member ran `/chart` today — confirmed twice over.

⚠️ **Live finding worth a look:** the warm cycle is still blowing its 20 s budget continuously
(`hot warm hit its 20s budget after 20.0–22.8s, N chart(s) deferred`, many times an hour through
RTH). That is **C-09**, still open, and it is happening now.

---

# RESUME — earlier checkpoint 2026-09-14 03:50 ET (Monday, pre-RTH)

> ⭐ **THIS HEADER IS THE CURRENT ONE. The sections below it were written at 2026-09-13 20:45 ET
> and are superseded where they disagree with §a0.** They are kept because §f (standing rules),
> §h (the rest of the machine) and §i (gotchas) have not moved and are still the fastest read.

## a0. Where it actually is, 2026-09-14 03:50 ET

**Master `e269f2b10`, deployed SUCCESS, verified in the RUNNING process** (not `--kv`):
`RENDER_V2_SHADOW='1'` · `DISCORD_RENDER_V2_ENABLED` **absent** · `delivery.edit_image`,
`bindings._fold_attachments`, `renderer._with_vintage`, `badge.render_footer(quality=…)` and
`JobRuntime.send_failure_result` all present · `l2_root` = `/data/discord_render_cache`.

**Every forensics class this programme owns now has a PASSING regression test.** C-04, C-06 and
C-07 were `xfail(strict=True)` at the last checkpoint; all three are closed **on the V2 path**, and
`01-failure-forensics.md` has a section explaining exactly what that qualifier costs. Zero xfails
remain in `tests/test_discord_render_forensics.py`.

| Ruling | Landed | Where |
|---|---|---|
| **OI-29** — the chart IMAGE through `delivery.edit_image`; C-04 closed by the attachment fold | `decd049c1` | `delivery.py`, `adapters/bindings.py`, `commands.py` |
| **C-06** — the stand-in label, derived in the V2 wrapper; `bindings` consumes `badge.py` at last | `b5a4e1a31` | `adapters/bindings.py` |
| **C-07** — `?stale=` end to end **and its producer** | Lane D + `b5a4e1a31` | `discord_chart_house`, `badge.py`, `ChartRender.jsx`, `adapters/renderer.py` |
| **OI-31** — the two-tier cache, L2 on the volume | Lane B | `artifact_cache.py`, `03` §3.6 |
| **OI-28** — the chart-renderer reds adopted and fixed | Lane C | the renderer test loaders |
| the per-attempt budget made structural, + a SECOND overrun in the retry backoff | Lane C | `adapters/_call.py` |
| **Step 3** — load, chaos, determinism | `a82a2493c` | `docs/discord-render/evidence/step3/` |

**Step 3 results:** load p99 **102 ms** against a 1,000 ms SLO with zero acks over 3 s · chaos
**13/13** (the harness had 5 scenarios and the brief named 12 — the other 7 were written) ·
determinism **20 runs, 6/6 identical** including an L1→L2 round trip.

⛔ **NOT DONE, and it is the one thing standing between here and a flip packet that can be acted
on: 3.5, the real-Discord smoke.** It needs a human to type commands in the private test channel;
no agent can do it. Everything else in Step 3 is evidence about a rig.

⛔ **Three scheduled jobs are running and their logs are the next thing to read.** All three were
fired by hand once and their output verified, so none of them is a job nobody has seen run:

| Task | Cadence | Log |
|---|---|---|
| `UCT Render Soak` | every 15 min | `C:\Users\Patrick\uct-render-soak\soak.log` — at 02:20 ET, 5 ticks, 262 samples, **no drift** |
| `UCT Render Alerts Access Probe` | hourly (the owner-hand item) | `render-alerts-access.log` — `STILL_BLOCKED HTTP 403 code 50001` |
| `UCT Render Monday Shadow Line` | once, **07:45 local = 08:45 ET** | `monday-shadow-line.log` — pulls the `drender` logs and runs `shadow_report.py`, then appends every soak totals line |

⭐ The third exists so the pre-09:30 line is produced **whether or not a session is alive to write
it**. Read that log; do not re-derive it by hand.

**The Monday line**, as of 05:40 UTC: **≥ 8 records, all `/flow`, all `agree`, p50/p95 0.1 ms, zero
divergences — and zero `/chart` records**, which the tool refuses to read as clean. The `≥` is not
decoration: `railway_env_logs.py` printed `STOPPED: no progress past …`, so the count is a FLOOR.

---

Written by **Lane F** of the Discord render hardening programme (`docs/discord-render/`).

⛔ **Every claim below names a SHA, a `file:line`, or the command it was measured with.** Anything
that could not be verified while writing this is marked **UNVERIFIED** and says what would settle it.
A resume file that asserts a state nobody can re-derive is how the last restart cost an hour.

One command re-runs the checklist in §g:
`powershell -ExecutionPolicy Bypass -File C:\Users\Patrick\uct-worktrees\discord-render\scripts\resume.ps1`
— ⚠️ but read §g first: two of its pins are stale.

⚠️⚠️ **EVERY SHA IN THIS FILE IS A STAMPED READING, NOT A STANDING FACT.** Five workstreams push to
this repository; `origin/master` moved twice and `web` deployed twice while this file was being
written (`e659454bb` → `cda883387`). Re-derive with §g before acting on any of them. The parts that
do not churn — the lane map, the open decisions, the standing rules — are the parts to trust on
sight.

---

## a. Where the programme is

**Phase 2, step 2.4b P2 — merged to master and live-DARK.** Master merge 5 (`5ca4d5db2`) shipped the
provider adapters, the member-facing stamp, the breaker and loop-stall alerts, the event-loop probe
and shadow mode; the merge-5 record (`954309f0f`) and the frozen cross-lane contracts
(`e659454bb`) followed. `docs/discord-render/05-progress.md` carries the measured deploy for each.

| Step | State | Evidence |
|---|---|---|
| Phase 0 (map, forensics, baseline) · Phase 1 (architecture) | closed | `docs/discord-render/00`–`03`, `LEDGER.md` Phase summaries |
| 2.1 runtime · durable jobs · deadline · failure contract | merged dark | `740b79ad5` (LEDGER row 4) |
| 2.2 observability · render-health · alerts | merged dark | `6d779dd47` (row 6) |
| 2.3 renderer hygiene · hard ceiling · warm pool | merged; chart-renderer deployed | `d32d14d60` (row 8) + deployment `6090d306` (row 9) |
| 2.4a symbol resolution · `/flow` ETF partition | merged dark | `d623baf1d` (row 11) |
| 2.4b part 1 market clock + freshness envelope + breakers | on the branch | `9087bc196`, `4984e6207` (Phase 2 summary) |
| **2.4b P2.1–P2.10 adapters, stamp, alerts, loopwatch, shadow** | **merged dark** | **`5ca4d5db2`** (row 14), gate 1,112 passed, 69/69 mutations red |
| Cross-lane contracts frozen | **merged** | **`e659454bb`** — `api/services/discord_render/contracts.py` + `tests/test_discord_render_contracts.py` |
| Shadow mode flipped ON + its record made interpretable | on the branch | `9a7043317` (`shadow.py`, `tests/test_discord_render_shadow.py`, `08-merge-queue.md`) |
| P2.10 bench + wall clock + two instrument failures | on the branch | `ef8bdca06` (`05-progress.md`, `instruments/adapter_overhead_bench.py`) |
| 2.5 cache · 2.6 delivery · 2.7 visual+goldens · 2.8 forensics regressions | **in flight, lanes B–E** | `docs/discord-render/07-execution-plan.md` §3 |
| Phase 3 (canary, bench, RTH) · Phase 4 (the flip) | not started | — |

**Shadow mode is ON in production** (`RENDER_V2_SHADOW='1'`, read in-process — §c; flipped and
ledgered by Lane A in `9a7043317`). That was 07 §6's "live and ON before Monday 09:30 ET" target, and
it is met.

**Nothing a member can see has changed.** `DISCORD_RENDER_V2_ENABLED` is absent from the running
process, and with it absent the interactions endpoint runs the pre-V2 path exactly
(`api/services/discord_render/commands.py:49`, railed).

---

## b. The very next actions, in order, with their commands

**1 — Re-establish state before touching anything** (30 seconds; run these first after any restart):

```sh
cd C:/Users/Patrick/uct-worktrees/discord-render
git fetch origin && git status --short && git rev-list --count HEAD..origin/master
railway deployment list --service web --json | head -40      # newest SUCCESS + its commitHash
python docs/discord-render/instruments/verify_merge.py <expected_sha_prefix>
```

**2 — Read the shadow divergence, which is the one number the flip decision rests on.** Shadow has
been recording since the flip of `RENDER_V2_SHADOW` earlier this session; it is worth the most
through Monday's RTH:

```sh
python tools/railway_env_logs.py --filter drender
# then count lines with "evt":"shadow" and "divergence":true
```

`divergence` = V2 would have refused a symbol the old path went on to draw
(`api/services/discord_render/shadow.py:94`). ⛔ Search the bare word `drender` — Railway's log
search silently matches nothing for a bracketed phrase (`api/services/discord_render/observe.py:9-11`).

**3 — Lane A integrates whatever lands first** through `docs/discord-render/08-merge-queue.md`. On
the programme branch at 20:45 ET that queue lists **all five lanes B–F in flight, every one gated
against `e659454bb`** — so re-read it on `discord-render-hardening`, not on master, where it may lag:
`git show discord-render-hardening:docs/discord-render/08-merge-queue.md`. One master merge at a
time; `web` SUCCESS and the running SHA confirmed in-process before the next push.

⛔ **A queue row is only "ready" if it names the SHA it was gated against**, and master moves under
this branch every few minutes. Re-gate only what master's movement actually invalidates, and record
which of the two happened (`08-merge-queue.md`'s own rules).

**4 — The RTH baseline is still missing.** `02-baseline.md` is a closed-market bench and says so
("RTH baseline pending (Monday)"). `tools/discord_render_bench.py` is the instrument.

**5 — The flip, when the owner decides:** `docs/discord-render/06-flip-packet.md` — written to be
read alone. Day-two operations: `docs/runbooks/discord-render-operations.md`.

---

## c. Live production state — measured 2026-09-13 20:44 ET / 2026-09-14 00:44 UTC

| Fact | Value | Command |
|---|---|---|
| `web` newest deployment | **SUCCESS**, commit `cda883387887…`, created `2026-09-14T00:41:31.783Z` | `railway deployment list --service web --json` |
| Running commit, **in-process** | `cda883387887` (= `origin/master` at the time of reading) | `railway ssh` probe (recipe in `06-flip-packet.md` §2.3) |
| `DISCORD_RENDER_V2_ENABLED` | **absent** | same probe |
| `RENDER_V2_SHADOW` | **`'1'`** | same probe |
| `DISCORD_RENDER_V2_ADAPTERS_ENABLED` · `DISCORD_RENDER_LOOPWATCH_ENABLED` | absent (= ON; dormant while the master is off) | same probe |
| `/data/discord_render_jobs.db` | **does not exist** — V2 has never run in production | same probe |
| `DISCORD_RENDER_ALERT_WEBHOOK` | configured on `web` (private `#render-alerts`) | `railway variables --service web --kv`, key only |
| `CHART_RENDER_TOKEN` + `CHART_RENDER_TOKEN_PREVIOUS` + both `VITE_` halves | all four present — **a rotation is in flight** | same |
| chart-renderer | `RENDER_POOL_ENABLED=1`, `RENDER_WARM_URL` set | `railway variables --service chart-renderer --kv` |

⭐ The **absent jobs database** is the proof that V2 has never run, and it is stronger than a zero job
count — a zero count is also what a wrong query returns (`LEDGER.md`, post-restart close-out B).

⚠️ **`--kv` is the service's CONFIG, not evidence the running process has it.** The five rows above
marked "in-process" were read from the process; the `--kv` rows are configuration only, and are
reported as such.

**UNVERIFIED (and cheap to settle):** whether the Monday one-shot Task Scheduler job
**`UCT Render Token Retire`** (2026-09-14 07:15 CT) is still registered and enabled. It clears only
the `_PREVIOUS` pair, gated on Morning Wire having run that day (`LEDGER.md` step 1.1b). Settle with
`schtasks /query /tn "UCT Render Token Retire"`.

---

## d. HEAD state, branches and the lanes

| Checkout | Branch | State at 20:45 ET |
|---|---|---|
| `C:\Users\Patrick\uct-worktrees\discord-render` (**Lane A**, the programme) | `discord-render-hardening` | **`ef8bdca06`** — 1 ahead of `origin/master` (`cda883387`), which it has already merged. Two programme commits not yet on master: `9a7043317`, `ef8bdca06` |
| `.claude/worktrees/agent-*` (**lanes B–F**) | `worktree-agent-<id>` | five branches, all created at `e659454bb` 2026-09-13 20:23 ET; **none had committed** when this was written. They are now 18 commits behind `origin/master` — re-measure with `git rev-list --count HEAD..origin/master` before gating anything |

Lane ownership, and it is the rule that keeps two lanes off one file
(`docs/discord-render/07-execution-plan.md` §3): **A** integration/merges/bench · **B** 2.5 artifact
cache · **C** 2.6 delivery · **D** 2.7 badge + visual spec + goldens · **E** 2.8 + Step-3 harnesses
(**no `api/**` change at all**) · **F** docs, runbook, flip packet, `docs/RESUME.md`.

⛔ **A lane that needs a change in another lane's file writes a contract-change request in its ledger
row and proceeds on its own side.** Never two lanes editing one file.

⛔ The five frozen contracts are `api/services/discord_render/contracts.py` (merged at `e659454bb`);
a change to any of them after the lanes are running is a **ledgered event with a reason**.

---

## e. Open decisions (OI) — the ones still open, with who owns them

Full text for every row is `docs/discord-render/LEDGER.md` ("Owner decisions") and `03` §6. Closed
since the last checkpoint: **OI-09** (`/renderhealth` registered, step 1.2b), **OI-12** +
**OI-17** (renderer connected to the repo with watch path `services/chart_renderer/**`, pool and warm
URL live, step 1.2), **OI-13** (token rotated, step 1.1b — see the Monday retire job),
**OI-19** (dual-token acceptance, step 1.1a), **OI-21** / **OI-23** (built in P2.1).

| OI | What is still open | Owner |
|---|---|---|
| OI-03 | web vs a dedicated worker service — revisit after 5 sessions of `resumed` data | programme, after the flip |
| OI-04 | fold the context line into the image PATCH (kills the last attachment re-declaration) | **Lane C** (2.6) |
| OI-06 | label the stand-in on the image **and** in the message | **Lane D** (2.7) |
| OI-07 | per-class `/flow` wording shipped (2.1a); the **≤10-minute cached flow card is not built** — `grep cached api/services/discord_render/adapters/flow.py` returns nothing | Lane A / B |
| OI-10 | D-02's 30 s RTH cache TTL vs today's 120 s — measure once 2.5 exists | **Lane B** (2.5) |
| OI-11 | per-window `/flow` targets are set (1 → 4.4 s · 7 → 4.9 s · 30 → 8.7 s · all → 10.4 s); the RTH measurement is outstanding | Lane A, Monday |
| OI-14 | ~77 `web` deploys/day is the root of C-01 for every feature on the pod | **recorded only — out of scope** |
| OI-15 | flow-worker `/ticker-flow` has no internal time budget (partner file) | **flow-worker owner** — raised, not built here |
| OI-18 | the renderer hard ceiling defaults to the request's declared budget; drop it to 20 s once web's attempts are re-budgeted inside the 15 s deadline and RTH p99 is measured | Lane A/C, after 2.6 |
| OI-20 | the hygiene gate as an opt-in pre-commit hook (installing one reaches ~57 worktrees) | deferred, documented |
| OI-22 | a quote failure is still indistinguishable from "no extended-hours print"; bounded now, the split needs `fetch_ext_quote` to raise (pre-V2 behaviour change) | **Lane E** (2.8) |
| OI-24 | `discord-chart-produce` is spawned without `ids.carry`, so chart-production events are unattributable (pre-V2 file) | **Lane E** (2.8) |
| OI-25 | the fixed 1.5 s bars retry lives in the caller; the binding passes `attempts=1` so they cannot multiply. Moving the loop is a pre-V2 change | **Lane E** (2.8) |
| OI-26 | ⛔ the pre-push **secret scan has never run** for any worktree but one, and this is a **public repo**: `tools/secret_scrub.py` exists only on `feat/breadth-charts`. The hook prints "the secret scan did NOT run. This is not a pass." and proceeds | **`feat/breadth-charts` owner** — land the tool on master and every worktree's hook starts working |
| OI-27 | `RENDER_V2_SHADOW` is **structurally undeclarable** in `docs/feature_flags.json` — the scanner only sees gates whose name contains `ENABLED`/`DISABLE`. Declared in `03` §3.8d + `LEDGER.md` instead | **flag-ledger programme** (widen `_GATE_MARKERS`) |

⛔ **Step 1.3 is NOT done and is blocked two ways:** `#render-alerts` inherits ADMIN CHAT's access,
which includes the **Contributor** role. The Claude browser extension is disconnected, and the bot
token gets `403 Missing Access (50001)` on that private channel — granting access needs the very
permission that is missing. ⚠️ Not a member-data exposure: the channel carries queue depths, latency
percentiles, failure classes and correlation ids. Posting is unaffected (a webhook does not need read
access), which is why the test alert landed. `LEDGER.md`, step 1.2b/1.3.

---

## f. Standing rules this programme runs under

1. **ONE master merge at a time, repo-wide.** `web` SUCCESS **and** the running SHA confirmed
   in-process before the next push. `python tools/pre_push_guard.py` enforces it and fails closed
   (refuses while the newest `web` deployment is not a SUCCESS at least 150 s old).
2. **Everything ships DARK behind a flag. The owner flips.**
3. **Deploy tier is decided by the FILES, not the clock** — `docs/runbooks/deploy-windows.md` is the
   single authority. Anything on flow-worker's watch list is weekend/after-hours only, because a
   flow-worker restart drops the OPRA socket and Massive does not replay. Check with
   `python tools/flow_worker_watch_coverage.py`; a red needs an ADDITIVE / BEHAVIOUR-CHANGING
   classification written in the ledger row before the push.
4. **Backend pytest is SCOPED — named files, ≤6 per lane, never `pytest tests/`, never `-k` over the
   tree.** `-k` filters what *executes*; everything is still *collected*, and collection is where the
   memory goes. The full gate runs in Lane A only, one at a time
   (`07-execution-plan.md` §1). **No `npm ci` / `npx vitest` in a lane at all.**
5. **A run with no totals line is not a run**, and the background-task exit code is not a verdict —
   it has been measured wrong in both directions.
6. **Write the line endings git already stores**, not what is on disk. `python tools/check_repo_hygiene.py`
   (it was `clean: 9226 tracked file(s)` when this was written). ⛔ `git checkout -- <file>` is not
   an undo; it discards everything uncommitted in that file.
7. **Never `git add -A`** in a shared worktree; stage by path.
8. ⛔⛔ **H15 — a failing post-deploy smoke is rolled back FIRST and diagnosed second**, and
   **INCONCLUSIVE is not FAILED**.
9. Partner-owned files (`OptionsFlow.jsx`, `live_massive_router.py`, `schwab_router.py`) are out of
   scope for every lane; a minimal isolated diff, acked first, if ever unavoidable.
10. **Machine constraint:** ~8.6 GB free of 31.8 GB with other sessions live. One gate at a time on
    this box.

---

## g. Verification checklist — how to re-derive everything above

| # | Check | Command |
|---|---|---|
| 1 | worktree clean; branch == `origin/discord-render-hardening` | `git status --short`, `git rev-parse HEAD origin/discord-render-hardening` |
| 2 | master drift | `git rev-list --count HEAD..origin/master` (was **0**) |
| 3 | `web` newest deployment SUCCESS + its commit | `railway deployment list --service web --json` |
| 4 | the **running** commit and the flags, in-process | `06-flip-packet.md` §2.3, or `docs/discord-render/instruments/pod_env_probe.py` |
| 5 | `/api/health` 200 + uptime · bad signature → 401 · render-health without the bearer → 401 | `docs/discord-render/instruments/verify_merge.py <sha>` |
| 6 | chart-renderer ready | `docs/discord-render/instruments/renderer_health_probe.py` |
| 7 | flow-worker untouched by this branch | `python tools/flow_worker_watch_coverage.py` |
| 8 | line endings + tracked-file hygiene | `python tools/check_repo_hygiene.py` |

⚠️⚠️ **`scripts/resume.ps1` HAS TWO STALE PINS AND THEY FAIL SOFT.** `scripts/resume.ps1:16-17` still
read `$CodeTip = '3f71d5364'` and `$LastOnMaster = 'd32d14d60'`, consumed at `:66-67` and `:95-96` as
*ancestor* checks. Both SHAs **are** ancestors of today's tip (measured), so both checks print green —
and would keep printing green with the pod running a commit four merges old. ⭐ An ancestor test
against a stale pin cannot detect the drift it exists to detect. Re-pin both to the current tip
before trusting checks 2 and 4 of that script. **Lane F does not own `scripts/resume.ps1`** — this is
recorded here and in Lane F's report as a change request for Lane A.

---

## h. Everything else on this machine

Each programme keeps its own checkpoint; this file is the Discord render programme's:

- Notebook Wave Q1 → `docs/notebook/wave-q1-RESUME-HERE.md` — **on master**
- Joystick hub → `docs/plans/joystick/RESUME.md` — **on master** (programme CLOSED; one owner device
  run outstanding)
- Wisdom loop → `docs/wisdom/SESSION-STATE.md` — **on master**
- Indicator ecosystem → `docs/runbooks/indicator-ecosystem-resume.md` — ⚠️ **NOT on master**; it
  lives on `worktree-indicator-ecosystem` (`git show worktree-indicator-ecosystem:docs/runbooks/indicator-ecosystem-resume.md`)
- Terminal-Next → `docs/terminal-research/00-program-control/LEDGER.md` — ⚠️ **NOT on master**; it
  lives on `terminal-research` (`git show terminal-research:docs/terminal-research/00-program-control/LEDGER.md`),
  and `docs/runbooks/deploy-windows.md:51-52` points at it by that path

**The 2026-09-13 15:30 ET restart capture — 19 dirty checkouts captured and pushed, with the branch
and SHA for each — is in the previous version of this file: `git show b4c9e9bcc:docs/RESUME.md`
(§i).** It is not reproduced here because it is a completed one-off, and a stale copy of it is worse
than a pointer to the real one.

**Processes to restart: none.** Nothing in this programme runs locally. The `UCT *` Task Scheduler
jobs resume on their own.

---

## i. Known gotchas that cost time last session

- `railway ssh` from Windows: **Git Bash + `MSYS_NO_PATHCONV=1`**, the pipe quoted as `"|"`, and
  `/opt/venv/bin/python` (bare `python3` in the pod is the Nix system python with no app deps).
  Never Python `subprocess`; never discard stderr.
- **Cloudflare 1010-blocks raw `curl`/`python` user agents** on `uctintelligence.com` — send a browser
  `User-Agent`.
- **A status code without a body check is not a measurement.** `GET /api/r/movers` returned 200 for a
  made-up token because there is no such route and the SPA catch-all answered with HTML.
- **`railway variables --set` has been measured both staging and auto-redeploying** on this project.
  Set it, watch for a NEW BOOT by startup-line timestamp, then read the value in the process.
- **`railway redeploy --service flow-worker` re-deploys the commit it is already on** and drops the
  OPRA socket for nothing. The only discharge mechanism is a marker bump
  (`docs/runbooks/deploy-windows.md`).
- The Claude Code permission classifier refuses reading local credential stores, Railway
  feature-flag writes and Railway service-config changes. Ask the owner; never route around.
