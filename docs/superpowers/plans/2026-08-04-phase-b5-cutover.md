# UCT Phase B5 — The Atomic Real-Panes Cutover (Flip C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate and flip the ten definitions still on the legacy lane, resolve the `engineEnabled` settings migration by deleting the flag *and the rest of `cs.indicators`*, and then cut the nine stacked `scaleMargins` bands over to real Lightweight-Charts panes in one flip of one constant — so that Phase B ends with `paneMargins.js` gone, the enumeration ledger holding nothing but `C`, `keep` and the two `phase` rows it also deletes, and an indicator's pane being a *pane*.

**Architecture:** Three movements, in this order and no other. **(1) Finish the lane.** All ten remaining definitions go through the proven B3 shape — migrate and flip in the SAME commit, into the UNCHANGED bands — because a per-indicator transcription gate at **0 changed pixels** only exists while the geometry is still the old geometry; once Flip C lands there is no baseline that can produce a zero for a newly migrated indicator ever again. **(2) Empty the blob.** With no legacy render block left reading `cs.indicators.<id>`, a versioned read-time migration folds the fifteen keyed sections into `indicatorInstances`, `engineEnabled` is deleted rather than migrated, and `CHART_DEFAULTS.indicators` shrinks to the one permanently carved-out key. **(3) Flip C.** The cutover lands **dark** behind one constant (`PANE_MODE`), is gated at 0 changed pixels like everything before it, is then *measured* against its own dark build, priced per case, put to the owner as a number, and applied in its own commit.

**Tech Stack:** React 18 + Vite, lightweight-charts **5.2.0** (pinned; `rendererPin.test.js` catches a junctioned 5.1.0), vitest (`cd app && npx vitest run <paths>` — **never** `npm test -- run`), pytest, Playwright + Pillow via `tools/chart_parity.py`, `tools/spa_server.py`.

**Branch:** `feat/phase-b3-migration`, from `084eeded` (B4 complete). B5 commits onto the same branch. **Do not push** (the deploy-window hook and the Sep 5 ship gate both apply; B1–B5 ship together after the launch freeze lifts).

**Baseline at `084eeded`, to be re-measured and recorded in Task 1 before anything is changed:**

```bash
cd app && npx vitest run                       # 4,215 tests / 418 files, exit 0
cd .. && python -m pytest tests/test_indicator_compute.py tests/test_indicator_golden.py \
    tests/test_indicator_alert_evaluator.py tests/test_indicator_alert_service.py -q   # 78, exit 0
python -m pytest tests/test_chart_parity_harness.py tests/test_chart_markers.py \
    tests/test_chart_news.py tests/test_chart_health_alerts.py \
    tests/test_admin_chart_health.py tests/test_charts_layout_service.py -q            # 86, exit 0
```

Every later task compares against the numbers Task 1 *measures*, never against the three above — this branch has corrected a prose count four times (7→16→20→21→22→32; "84 chart pytest" matching no command at all).

---

## Global Constraints

Copied verbatim; every task's requirements implicitly include this section.

**Renderer and binding**

- **Series are POOLED and REUSED, never destroyed and recreated** (lightweight-charts issue #2049, mass-`removeSeries`, is OPEN — 2–4 s of main-thread block). A colour change, a period change **and a pane change** restyle or relocate the same series object. `binder.js:393` already calls `series.moveToPane(paneIndex)` for exactly this reason; Flip C is the first change that exercises it in production. **Only series TYPE is immutable** — `priceScaleId` and pane are both mutable, and B2 proved that escape hatch.
- **`applyOptions` MERGES and `merge()` skips `undefined`** — the complete key set is the only reset mechanism, for scales AND for series. A partial option bag leaves the previous value standing.
- **An omitted SERIES option means "keep what's there"; an omitted `createPriceLine` option means "use LWC's DEFAULT."** (Measured: an omitted `lineStyle` on RSI's 50-line came out LWC-default Dashed against the shipped `largeDashed` — 379 changed pixels.)
- **`mergeChartSettings` is a hard allow-list (TWO of them)** — the per-key list in `chartDefaults.js` and `mergeSettingsOverride`'s `_OVERRIDE_SECTION_KEYS` — **and `mergeSettingsOverride` passes primitives through untouched.** A new key therefore needs a strict read at the consumer too; it cannot rely on the merge to normalise it. ⚠️ `mergeSettingsOverride` skips `undefined` **at the top level only** — inside its `indicators` branch it spreads, so a nested `undefined` lands.
- **No rounding inside compute — ever.** Delivery wrappers round; `plots[].precision` and `plots[].legend.decimals` are display config. Fixtures compare at rel-tol 1e-9 and there is **no** surviving exception (§9.1's one exception, `MACD_HEAD_MASK`, is CLOSED).
- **Every parity number names BOTH build identities**, and the harness byte-compares served-vs-disk on both bases before any capture (`--dist-a` / `--dist-b`, mandatory for a dist base, no `--skip`).
- **`FLIPPED === MIGRATED` is asserted in BOTH directions**, and both flip sets are **sealed** against a runtime `.add()`/`.delete()`/`.clear()` (`flipState.js:43-56`; a plain `Object.freeze(new Set())` reports `isFrozen: true` and still accepts `.add()`). **Every migration in this plan flips in the same commit.** Task 13 is the only task permitted to delete either set, and only after the cutover has shipped.

**Process**

- Frontend tests: `cd app && npx vitest run <paths>`. **NEVER `npm test -- run`.**
- `-t` filters are REGEX. `Ctrl+I` matches nothing useful (`+` quantifies the `l`). Choose test titles free of `+ ? ( ) [ ] * . | ^ $` and pick the filter by reading the suite, not a document.
- Restore a mutated file with `git checkout -- <path>`. **`git show HEAD:<path>` is NOT a byte-restore in this CRLF worktree** (`core.autocrlf=true`; the blob is LF).
- Python subprocess readers must be pinned to `encoding='utf-8', errors='replace'` and `sys.stdout.reconfigure(encoding='utf-8')` — the default is cp1252 here, vitest prints box-drawing and `chart_parity.py --help` crashes without `PYTHONIOENCODING=utf-8`.
- pytest mutation runs need `PYTHONDONTWRITEBYTECODE=1` (a same-size mutation within one second imports the previous mutation's `.pyc`).
- Never create a git worktree for a build comparison. Stage side A **in place** with `git show <sha>:<path>`, build, then restore from a `cp -r` backup with a two-directional sha256 comparison. (`rm -rf` on a `node_modules` junction has recursed into the shared tree four times on this branch. Safe removal: PowerShell `(Get-Item $junction).Delete()`.)

**The mutation gauntlet — the protocol every task's gate step runs**

A mutation runner on this branch has scored perfectly while executing zero tests **sixteen distinct ways**: `--pool=threads` (`ERR_WORKER_INVALID_EXEC_ARGV`) · `--reporter=basic` (not a reporter in vitest 4.0.18 — it loads a MODULE and throws) · a grep of `Tests N failed` defeated by ANSI colour · `subprocess.run(text=True)` dying on cp1252 · argv `\n` anchors matching **zero** times in CRLF files (twice) · a `-t` filter naming an error message · a `-t` naming a test that does not exist · a `-t` landing on a different test than the kill · a non-matching `-t` exiting 0 with "N skipped" · CONTROL A itself reporting `passed=None` · a source probe defeated by a **comment** · a retirement guard defeated by **whitespace** · `throws by name on zero matches` being simply **false** (`matchAll` degrading to `{}`) · a shared predicate that **excluded the file under test** (`engineInert = key==='stoch'` left 1,245 tests green) · `JSON.stringify` dropping `undefined` in a `merge()` fixture · `toContain('X')` satisfied by `X_DRAFT`.

Every gauntlet therefore runs, in this order:

1. **PREFLIGHT.** For every mutation, read the target file as BYTES, assert the search pattern matches **exactly once** (`count == 1`), and assert the post-substitution bytes **differ** from the original. Refuse the whole run otherwise. Patterns are read from the file, never passed as argv strings with `\n` escapes.
2. **CONTROL A.** Run the unmutated selection. Require exit 0 **and** a parsed non-zero `passed` count from ANSI-stripped stdout (`re.sub(r'\x1b\[[0-9;]*m', '', out)`, then `(\d+) passed`). **Abort on zero.**
3. **CONTROL B, once per mutation.** Run the unmutated selection **with that mutation's `-t` filter**. Require exit 0 **and** a non-zero `passed` count.
4. **Apply, run, restore.** Verdict is the **process EXIT CODE**, never a grep. Restore in a `finally`; if the run is interrupted, re-check `git status` before trusting anything (a killed gauntlet leaves the mutation applied).
5. **A survivor is REAL until proven equivalent by measurement, and an equivalence proof is itself a test.** Six plan-supplied mutations on this branch have been non-lethal or equivalent **as written**; when a set comparison cannot see a change, make ORDER or BEHAVIOUR observable and mutate that instead.

**Controls rot at every flip, and the dangerous ones stay GREEN**

~20 controls rotted at B3's four flips, six at B4. The ones that go red are safe. The ones that keep passing while their stated premise dies are the hazard — B3 hit four green-while-false at Task 11 alone. **Every migrating or flipping task in this plan carries an explicit control-audit step**: `grep -rn "<id>" app/src --include=*.js --include=*.jsx | grep -i "test\|spec"`, then read each hit's stated REASON, not its assertion, and either invert it or delete it with the reason recorded. A control whose subject you just migrated is guilty until proven innocent.

---

## What replaces "0 changed pixels" — read this before Task 1

Every gate on this branch for three phases has been **0 changed pixels**. B5 cannot use it as its safety net, because **a real-panes cutover changes the picture by construction**: pane separators are drawn where none existed, each oscillator's drawable rectangle is re-derived from a pane rather than a margin band, and the price scale's own margins are re-expressed as fractions of pane 0's height instead of the whole canvas.

Saying "so we relax the gate" is how this branch would ship its worst regression. It does the opposite. **B5 keeps an absolute zero everywhere it can still be earned, and replaces it with something stricter than a tolerance exactly where it cannot.** Four parts, each independently failable.

### 1. Zero survives for twelve of the thirteen tasks

`PANE_MODE` defaults to `'bands'`. Tasks 1–11 — all ten migrations, the `engineEnabled` deletion, the whole blob migration, and the **entire real-pane implementation** — are measured at **0 changed pixels on all 24 live cases, 5/5 runs, both build identities named**. Nothing in this plan is allowed to move a pixel except **Task 12**, which is one commit changing one constant. If any earlier task reports a non-zero, that is a regression and not a cutover.

That is not a trick to postpone the problem. It is what makes the problem *attributable*: on cutover day exactly one commit is in the frame.

### 2. At the cutover, `0` becomes `expect` — an EXACT number, not a tolerance

Task 2 teaches `tools/chart_parity.py` a per-case `expect`, and it is an **equality**, not a budget:

```python
entry["pass"] = all(r["changed"] == entry["expect"] for r in runs)
```

`<=` would pass a regression that happened to be smaller than the allowance. `==` fails a picture that is off by one pixel in either direction, and it demands **zero variance across every run** rather than judging on the worst. This is the `MACD_HEAD_MASK` (88 px, 20/20, zero variance) and `VWAP_SESSION_ANCHOR` (2,590 px, 20/20, `{2590: 20}`) mechanism, generalised from two hand-run measurements into a case-file field. ⛔ **`--tolerance` is still forbidden**; a tolerance also hides the *next* change of the same size.

### 3. A real zero survives INSIDE the changed picture — declared regions, and a `rest` bucket nobody can declare

Task 2 also teaches the harness per-case `regions`: named rectangles, each with its own `expect`, plus a reserved **`rest`** bucket that is **computed, never declared** and whose expectation is always **0**.

Every cutover case declares at least two regions:

| region | what it covers | expectation |
|---|---|---|
| `price_plot` | pane 0's drawable rectangle — candles, the five MA overlays, BB, VWAP, SAR, Ichimoku, Donchian, the volume band, the right price axis | **0 px** — the cutover moves oscillators out of pane 0 and re-expresses pane 0's margins so that this rectangle lands on the same pixels (§A6 has the arithmetic and the fallback if the sub-pixel rounding does not cooperate) |
| `osc_strip` | everything below pane 0 — the new panes and their separators | the measured number, per case |
| `rest` | **computed**: every changed pixel outside every declared rectangle | **0 px**, always, not overridable |

So "the picture changed" is bounded to rectangles that were named *in advance*, and the majority of the canvas keeps a genuine, failable zero.

### 4. The geometry is asserted STRUCTURALLY, not inferred from pixels

Pixels tell you *that* something moved. They cannot tell you *what*. So Task 3 produces a **pane manifest** — a pure, JSON-serialisable description of the layout — and Task 2 teaches the harness to capture it from `window.__paneManifest` on both sides and put an A/B diff in `report.json`:

```jsonc
{
  "chartHeight": 594,
  "separatorPx": 1,
  "panes": [
    { "index": 0, "height": 505, "stretchFactor": 505,
      "series": [{ "type": "Candlestick", "scaleId": "right", "key": null },
                 { "type": "Histogram", "scaleId": "volume", "key": null }] },
    { "index": 1, "height": 88, "stretchFactor": 88,
      "series": [{ "type": "Line", "scaleId": "rsi", "key": "legacy:rsi::rsi" }] }
  ]
}
```

The manifest is asserted three ways: a **unit** gate on the pure function (jsdom, every stored blob, every oscillator subset), a **live** gate in `report.json` (the A/B diff is empty in bands mode and is exactly the declared reshape in panes mode), and a **committed expectation** so the intended geometry is an artifact a reviewer approved once and a test holds forever.

### How an intended change is distinguished from a regression

Three independent discriminators, and a change has to pass all three:

1. **The number is exact and has zero variance.** A regression changes it — in either direction — and `==` catches both.
2. **The change is inside a rectangle somebody named before measuring.** A pixel outside every declared region lands in `rest`, whose expectation is 0 and which cannot be declared away.
3. **The manifest says the same thing the pixels do.** Pane count, per-pane pixel height, per-series pane index and `priceScaleId` are compared as JSON against a committed expectation. A change that moves pixels but not the manifest, or the manifest but not the pixels, is a regression by definition — one of the two is lying.

### What the owner signs off against

`docs/decisions/2026-08-04-flip-c-pane-geometry.md` (id `FLIP_C_PANE_GEOMETRY`), written in Task 11 and answered before Task 12 runs. It carries, in the shape the owner already answered twice:

* one table, **per case**, `before → after` changed pixels with the per-region split and both build identities;
* the two PNGs and the manifest diff for the three representative cases (`rsi_only`, `bb_rsi_macd`, `flipb_all_four`);
* **three sub-choices priced separately**, because they are independent and the owner may want them separately: **(a) separator visibility** — LWC draws one at every pane boundary (`layout.panes.separatorColor`, default `#2B2B43`); the options are *theme it to the chart's border token*, or *make it transparent and keep only the drag affordance*. **(b) per-pane price axis** — today an oscillator band is an *overlay* scale with no labels; a real pane can give it `priceScaleId: 'right'` and a visible axis with its own numbers (TradingView's behaviour, spec §6's "pane grammar"). This is the largest of the three and the one that changes what a user *reads*, not just where it sits. **(c) pane heights** — reproduce today's band heights to the pixel (recommended; it is what keeps `price_plot` at 0), or adopt LWC's own stretch defaults.

Expect at least one of these to come back as a real decision. B3's precedent is the shape: the MACD head-mask (88 px) and the VWAP anchor (2,590 px) were each **measured, priced, and put to the owner as a number, in their own commits, never inside a migration**.

### What this gate still cannot see

The same thing it could not see in B4, and the runbook's §6 table is the register: `/r/chart` mounts no toolbar, no modal, no dialog, no keyboard listener; it has no cursor, so no legend chip is ever drawn; it builds no share URL. **Every deliverable in this plan therefore names its real DOM gate, per task**, and Task 13 extends runbook §6 with a B5 column. Two B5-specific blindnesses to state now:

* **the six legend chips** retiring in Tasks 5 and 6 are invisible to every pixel case (`ChartRender.jsx` CSS-hides the legend and no case hovers). Their gate is `legendFromDefinitions.test.jsx`'s nine chips, character-for-character.
* **the pane drag divider** (spec §6) is invisible: the route never dispatches a pointer event. Its gate is a DOM case in `stockChartWiring.test.jsx`.

---

## Adjudications this plan makes

### A1 — `ENGINE_ENABLED_MIGRATION`: **RESOLVED by deletion, and the flag is not the whole job.**

The record's §7/§8 default recommendation — *require migrate-and-flip-together, then delete the flag at B5 with the rest of `cs.indicators`* — is adopted **in full**, and "the rest of `cs.indicators`" is the part that is easy to read past.

* **B5 never creates a migrated-but-un-flipped definition.** All ten migrations in Tasks 5–8 add to `ENGINE_MIGRATED_DEF_IDS` and `ENGINE_FLIPPED_DEF_IDS` in the same commit. `enumerationSites.test.js`'s *"creates no migrated-but-un-flipped definition while the settings migration is open"* rail therefore never fires while the record is OPEN — and Task 9, the commit that resolves the record, is also the commit that re-reads the rail (the rail fires **both ways** by design; resolving the Status line without updating it is red).
* **Task 4 deletes the flag** — `CHART_DEFAULTS.engineEnabled`, `mergeChartSettings`' `engineEnabled: parsed.engineEnabled === true`, `engineActive = engineOn || FLIPPED.size > 0`, `engineDrawnInputs`' flag gate, `ChartRender.jsx:236`'s single write, and `ChartToolbar.engineInert` (whose predicate `engineDrawn.has(k) && !FLIPPED.has(k)` has been identically false since B3 Task 11 and can never be true again once FLIPPED covers every definition). It runs **before** the migrations so all ten land in the final world, and — decisively — **while a change to `mergeChartSettings` can still be measured at an absolute 0 px.** After Flip C no such measurement exists.
* **Task 9 deletes the mirror.** `settingsVersion` 1→2; a read-time migration folds `cs.indicators.<id>` into `cs.indicatorInstances` for every definition; `CHART_DEFAULTS.indicators` shrinks to its one permanently carved-out key (`volumeProfile`); the allow-list shrinks to one line. That is ledger rows 1, 2 and 14. It runs **after** the last legacy block dies, because until then ten render blocks read `ind.<id>?.enabled` directly.

⛔ **Do not flip `CHART_DEFAULTS.engineEnabled` on its own at any point.** The record's §1 is asserted in place: the read is of the blob, all four rows are unchanged by a default flip, and doing it moves the branch from "the flag decides nothing" to "the flag decides nothing *and* the tests say it does".

### A2 — **What a July blob does on cutover day, stated as the acceptance criterion.**

A blob written before the engine existed carries `indicators: {rsi:{enabled:true,period:14,color:…}, stoch:{…}, …}`, an `overlays` array, **no** `indicatorInstances`, **no** `engineEnabled`, and `settingsVersion: 1` or nothing. On the first load after B5 ships:

| | before | after |
|---|---|---|
| every indicator the user had on | on | **on**, same period, same colour, same opacity, same line style |
| `engineEnabled` | absent ⇒ merged `false` | **the key does not exist**; it decides nothing and is not read |
| `indicatorInstances` | `[]` | one `legacy:<id>` instance per enabled indicator, **written back** on the next settings save, in the shipped stack order |
| the indicator's *drawing* | ten by hand-written blocks, four by the engine | **all fourteen by the engine** |
| the indicator's *position* | a `scaleMargins` band inside pane 0 | **its own pane**, with a draggable divider |
| the price pane | 70 % of the canvas | the same rectangle, to the pixel (§A6) |
| Volume Profile | a legacy canvas overlay | **unchanged** — permanently carved out, no flip touches it |
| what the user has to do | — | **nothing.** No reset, no re-tick, no re-login |

That table is not prose: `flipBStoredBlobs.test.jsx` renders **25 real blob strings** through the real merge, and Tasks 4, 9 and 12 each extend it rather than replacing it. The July capture is one of the 25.

### A3 — **The ten are migrated in REGISTRY ORDER, and all ten before any geometry moves.**

`flipState.js:85-92` pins the reason: LWC z-stacks by insertion, the engine's `binder.sync()` runs at `StockChart.jsx:6238` — *before* every remaining legacy block — so migrating a later price overlay ahead of an earlier one inverts their z-order and moves pixels. Registry order is `rsi, macd, bb, vwap, stoch, atr, sar, ichimoku, mfi, cci, williamsR, adx, obv, donchian`; the first four are done. The remaining ten therefore go **5,6 → 7,8 → 9,10,11 → 12,13,14**, which falls out into four tasks that are each internally coherent:

| task | ids | why these are one task | chips retiring |
|---|---|---|---|
| **5** | `stoch`, `atr` | the two chip-bearing **oscillators**; both are volume-overlay-eligible (`ensureIndTarget`), both take a `fixedPane`/`autoPane` band | `stoch::k`, `stoch::d`, `atr::atr` |
| **6** | `sar`, `ichimoku` | the two chip-bearing **price overlays**; `sar` is the first `markers` plot the engine has ever bound, `ichimoku` is five plots and three inputs the blob does not carry | `sar::sar`, `ichimoku::tenkan`, `ichimoku::kijun` |
| **7** | `mfi`, `cci`, `williamsR` | three structurally identical single-line oscillators with `hlines` guides and **no** legend chips | — |
| **8** | `adx`, `obv`, `donchian` | the 3-line oscillator, the unbounded-scale oscillator (the one that actually exercises the autoscale seam), and the **last** price overlay | — |

**All six `registerLegacyChip` registrations retire in Tasks 5 and 6** (12 calls = 6 register + 6 clear), each in the same commit that gives its definition an engine binding producing the same chip from the `plots[].legend` block B4 already declared. **No user loses a chip at any commit**: `legendFromDefinitions.test.jsx`'s nine chips are asserted character-for-character at every one of the four tasks, and the assertion's *source* per chip flips from `legacyChipEntriesRef` to `binder.bindings()` as a named change.

### A4 — **Ichimoku GAINS a developing-bar fallback, deliberately, and it is a behaviour change.**

`StockChart.jsx:6445-6446` registers `ichimoku::tenkan` and `ichimoku::kijun` with a series and **no thunk** — B4 Task 10 transcribed that absence rather than "improving" it, correctly, because it was transcribing. The engine lane's `lastValue` is a NUMBER, not a thunk, so a migrated Ichimoku's chips print a value on the developing bar where today they print nothing. **That is the right behaviour** (every other chip has it; the legacy gap is the I-3 defect B3 fixed for RSI), it is invisible to every pixel case, and it is the one legend behaviour B5 changes. Task 6 asserts it as a named change with the old behaviour recorded in the failure message, not as an incidental.

### A5 — **`paneMargins.PANES` does not "get deleted". It retires into three places, and each has an owner.**

The nine `{key, enabled, baseH}` rows are three different kinds of fact wearing one coat:

1. **the heights** → `placement.pane.height` on each definition (new optional schema field, default `0.15`, validated in `defSchema.js`). A pane's default height is a per-definition property, which is exactly the shape that makes a sixteenth indicator cost one definition and zero list edits.
2. **the stack order** → the **order of the instance list**. `PANES`' bottom-to-top order (`obv, atr, adx, macd, cci, williamsR, mfi, stoch, rsi`) is not registry order and no definition can declare it, because in the world spec §6 describes it is *the order the user added them*, and panes are reorderable. Task 9's migrator seeds it from today's shipped order so **no existing user's stack visually reorders**, and from then on it is data in the user's blob.
3. **the volume band** → one constant in `paneLayout.js`. Volume is not an indicator, its band is not an enumeration of indicators, and `cs.volume.separatePane` keeps its meaning (see A6).

That is a real retirement of the enumeration, not a rename of it. Task 12 deletes `paneMargins.js`, `paneMarginsProjection.js` and `csForPaneMargins` together.

### A6 — **Flip C moves the NINE OSCILLATORS. Volume's band stays a band, and pane 0's rectangle is preserved by arithmetic.**

`volSeparatePane` already exists (`StockChart.jsx:5931`) and already puts volume in real pane 1. When it is false, volume is a band at the bottom of pane 0 — a genuinely different look (TradingView's "volume overlay" vs "volume pane"), and a setting the user chose. **Flip C does not collapse that distinction.** It moves the nine oscillators out of pane 0 and leaves the volume band where the user put it.

That is also what makes the `price_plot` region's **0 px** achievable rather than aspirational. With `H` the chart's plot height, `s` the oscillator stack fraction and `v` the volume band fraction:

* **today** pane 0 is the whole canvas; candles occupy `[0.30·H, (1 − s − v)·H]`.
* **after**, the oscillator panes take `s·H − Σsep` and pane 0 takes `H·(1 − s)`, so if pane 0's margins are re-expressed as fractions **of pane 0's own height** — `top = 0.30/(1 − s)`, `bottom = v/(1 − s)` — the candle rectangle lands on `[0.30·H, (1 − s − v)·H]` again. Identical.
* **the separator pixels come out of the OSCILLATORS, never out of pane 0**, because pane 0 is ~70 % of the canvas and a 1-pixel vertical compression there costs tens of thousands of changed pixels, where the same compression in an 88-pixel oscillator strip costs a few thousand. Each oscillator pane is therefore its band height minus its share of `Σsep`, distributed by the same deterministic integer shave `computePaneMargins` already uses.

⚠️ **Stated as an expectation, not a promise.** `scaleMargins` are floats and LWC rounds them to pixels; `0.30/(1 − s)` is not a round number. If Task 11's measurement comes back non-zero on `price_plot`, the remedy is named and not a TBD: compute pane 0's margins in **integer pixel space** from `chart.panes()[0].getHeight()` and convert with the same rounding LWC applies (`Math.round(margin * paneHeightPx)` — read the installed bundle and pin it, the way B3 Task 1 pinned the autoscale branch), then re-measure. If it is *still* non-zero, `price_plot` becomes a declared region with its own number and its own line in the decision record — measured, priced, and signed off like everything else. What is forbidden is letting it land in `rest`.

### A7 — **Pane heights are set with `setStretchFactor`, not `setHeight`, and the separator height is MEASURED.**

LWC distributes `available = chartHeight − Σsep` across panes proportionally to their stretch factors. Setting `f_i = targetPx_i` where `Σ target = available` yields `h_i = available · f_i/Σf = targetPx_i` **exactly**, with no dependence on `setHeight`'s redistribution semantics. `SEPARATOR_PX` is not assumed: Task 3 derives it from the real bundle (`H − h0 − h1` on a two-pane chart of known height) and pins it, so an LWC upgrade that changes it goes red rather than silently shifting every pane. After every layout pass the binder **asserts** `chart.panes()[i].getHeight() === expected` and throws by name on a mismatch — a silent LWC redistribution is precisely the class of thing this branch does not assume.

### A8 — **The ledger's partition becomes a per-site MAPPING. The histogram blind spot closes here.**

`enumerationSites.test.js:498` asserts `expect(counts).toEqual({ B5: 8, C: 2, keep: 3, phase: 2 })` — a histogram, and B4's own review recorded that **swapping two sites' fates preserves every count and passes**. B5 empties two buckets, which leaves `{C: 2, keep: 3}` — small enough that a permutation is *more* likely to slip through, not less. Task 1 therefore adds, beside the histogram and not instead of it, a `toEqual` over the **sorted `id → fate` pairs**, so a re-fate fails by name. The histogram stays because it is what catches a fate *typo* (a sixth bucket).

### A9 — **The two `phase` rows retire at B5, because B5 is when the migration is over.**

The ledger's own fate legend says `phase` = *"the migration's own bookkeeping; it is deleted when the migration is [complete]"*. Phase B's migration completes at Flip C. Leaving `ENGINE_MIGRATED_DEF_IDS` and `ENGINE_FLIPPED_DEF_IDS` on the ledger after that is a row whose fate describes a condition that has already arrived — a control that rots green. Task 13 deletes both: every consumer becomes a registry lookup (`registry.getDefinition(id) != null`), which is *more* correct than the sets, because it excludes `volumeProfile` structurally instead of by omission. Final ledger: `SITE_COUNT 5`, `{C: 2, keep: 3}` — **no `B5` key and no `phase` key at all**, `reduce` emitting nothing for an empty bucket, exactly as B4 left no `B4` key.

⚠️ The Global Constraint *"flip sets sealed against a runtime `.add()`"* is then satisfied **vacuously**, which is the wrong way to satisfy a constraint. Task 13 replaces the seal probe with the equivalent claim about what took the sets' place: `NATIVE_DEFS` is frozen and `listDefinitions()` returns a fresh array each call, both probed.

### A10 — **`volumeProfile` is untouched, again, and every generated list still carries it.**

`CARVED_OUT_INDICATOR_KEYS = {'volumeProfile'}` is a hand-written literal so a test can disagree with it. It has a settings section and no definition; it draws to a sibling canvas, not through `addSeries`; no flip in this plan touches it. Task 9's blob migration must therefore **keep** `CHART_DEFAULTS.indicators.volumeProfile` and its allow-list line while deleting the other fourteen, and `migrateLegacyToInstances` must keep skipping it (asserted, with `rsi` as the control proving the migrator ran).

---

## File structure

**Created**

| File | Responsibility |
|---|---|
| `app/src/components/chart/engine/paneLayout.js` | The pure geometry module. `SEPARATOR_PX`, `computePaneLayout(cs, instances, opts) → {panes[], pane0}`, `paneManifest(chart, bindings)`. No React, no settings writes, no LWC imports except types. |
| `app/src/components/chart/engine/paneLayout.test.js` | Its unit gate: heights, order, the pane-0 preservation identity, the integer shave, the manifest shape. |
| `app/src/components/chart/engine/__tests__/paneSeparatorPin.test.js` | Reads the installed `lightweight-charts` bundle on a real chart and pins `SEPARATOR_PX` and the stretch-factor distribution rule. |
| `app/src/components/chart/engine/__tests__/stochAtrFlipParity.test.js` | Transcription suites for Task 5 (verbatim `addSeries`/`applyIndScale`/`createPriceLine` option objects, `toEqual` over the FULL object). |
| `app/src/components/chart/engine/__tests__/sarIchimokuFlipParity.test.js` | Same, Task 6. |
| `app/src/components/chart/engine/__tests__/mfiCciWilliamsFlipParity.test.js` | Same, Task 7. |
| `app/src/components/chart/engine/__tests__/adxObvDonchianFlipParity.test.js` | Same, Task 8. |
| `app/src/components/chart/engine/__tests__/settingsBlobMigration.test.js` | Task 9's gate, driven from JSON STRINGS through the real `mergeChartSettings`. |
| `app/src/components/chart/engine/__tests__/flipCGeometry.test.jsx` | Task 10's DOM gate: real panes, real `moveToPane`, pooling across the flip, the divider. |
| `docs/decisions/2026-08-04-engine-enabled-deleted.md` | Task 4's record: what deletion means, what went red, what a July blob does. |
| `docs/decisions/2026-08-04-flip-c-pane-geometry.md` | Task 11's record: the numbers, the three priced sub-choices, the owner's answer. |

**Modified**

| File | Change |
|---|---|
| `tools/chart_parity.py` | `--expect` + per-case `expect`; per-case `regions` with a computed `rest`; `window.__paneManifest` capture and A/B diff into `report.json`. |
| `tests/test_chart_parity_harness.py` | Gates for all three, each refusal paired with a control. |
| `tools/chart_parity_cases.json` | The eleven `status: "placeholder"` cases filled in (Tasks 5–8); `engine_<id>_vs_legacy` added per migration; `regions` + `expect` added at Task 12. |
| `app/src/components/chart/chartDefaults.js` | Task 4: `engineEnabled` deleted from `CHART_DEFAULTS` and the merge. Task 9: `settingsVersion` 1→2, the read-time fold, `indicators` shrunk to `volumeProfile`, the allow-list to one line. |
| `app/src/components/chart/engine/flipState.js` | Tasks 5–8: ten ids into both sets. Task 4: the flag gates removed. Task 13: both sets deleted. |
| `app/src/components/chart/engine/nativeRegistry.js` | Task 1: the stale `MACD_HEAD_MASK` header. Task 3: `placement.pane.height` on the nine oscillators. **No compute, no plot style, no colour, no bound changes.** |
| `app/src/components/chart/engine/defSchema.js` | Task 3: `placement.pane.height` validated (finite, `0 < h < 1`). |
| `app/src/components/chart/engine/placement.js` | Task 10: the pane branch reads `PANE_MODE`; in `'panes'` mode it returns a real `paneIndex` and drops `scaleMargins`. |
| `app/src/components/chart/engine/binder.js` | Task 10: applies the layout's stretch factors and asserts the resulting heights. |
| `app/src/components/StockChart.jsx` | Tasks 5–8: the ten render blocks, their refs, their `indicatorData` branches, their hide-all entries and the six `registerLegacyChip` pairs — deleted. Task 4: `engineActive`, the dead `engineOwned`. Task 10/12: the four `computePaneMargins` call sites. |
| `app/src/components/chart/chartRegion.js` | Task 12: region resolution reads real pane rectangles instead of margin bands. |
| `app/src/components/chart/paneMargins.js` · `engine/paneMarginsProjection.js` | Task 12: **deleted**. |
| `app/src/pages/ChartRender.jsx` | Task 3: publishes `window.__paneManifest` under `?fixedbars=`. Task 4: stops writing `engineEnabled`. |
| `app/src/pages/charts/ChartsWorkspace.jsx` · `pages/Settings.jsx` · `chart/ChartSettingsModal.jsx` · `chart/ChartToolbar.jsx` | Task 4 + Task 9: door seven's three sites and the frozen 15-section capture follow the new blob shape. |
| `app/src/components/chart/engine/__tests__/enumerationSites.test.js` | Task 1 (per-site mapping) then one decrement per retiring task; Task 13 lands `{C: 2, keep: 3}`. |
| `docs/decisions/2026-08-03-engine-enabled-settings-migration.md` | Task 9: Status OPEN → **RESOLVED**, with the rail re-read in the same commit. |
| `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` | Task 13: §5's Flip B/C sentences and §11's `ENGINE_ENABLED_MIGRATION` row; a new `FLIP_C_PANE_GEOMETRY` row. |
| `docs/runbooks/chart-parity-gate.md` | Task 2 (§7, the declared-diff gate), Task 12 (§5 checklist is done), Task 13 (§6 gains a B5 column). |

---

## Parallelism — which tasks are file-disjoint, which must run solo

B4 ran roughly **3× faster** by partitioning agents on **file ownership** with explicit own / must-not-touch lists and a hand-back protocol for shared files. It also learned the failure mode: two waves wrote `enumerationSites.test.js` concurrently and one wave's edit would have vanished, so the controller had to declare a single owner mid-flight.

**The rule for B5, decided up front:** *the ledger test and `StockChart.jsx` each have exactly ONE writer at a time, and any task owning either is SOLO.*

| wave | tasks | ownership | may run in parallel? |
|---|---|---|---|
| **0** | **1** | `enumerationSites.test.js`, `nativeRegistry.js` (comment only), the decision-record skeletons | **solo** — it is the ledger |
| **1** | **2** · **3** | T2: `tools/chart_parity.py`, `tests/test_chart_parity_harness.py`, runbook §7 (**Python only — touches no JS**). T3: `engine/paneLayout.js`, `engine/paneLayout.test.js`, `engine/__tests__/paneSeparatorPin.test.js`, `defSchema.js`, `nativeRegistry.js` (the nine `placement.pane.height` fields), `ChartRender.jsx` (the manifest publish) | **YES — fully file-disjoint.** T2 must not touch `app/src`; T3 must not touch `tools/` or `tests/` |
| **2** | **4** | `chartDefaults.js`, `flipState.js`, `StockChart.jsx`, `ChartRender.jsx`, `ChartToolbar.jsx`, `Settings.jsx`, `ChartSettingsModal.jsx`, `ChartsWorkspace.jsx`, `engineEnabledMigration.test.js` | **solo** — owns `StockChart.jsx` |
| **3** | **5 → 6 → 7 → 8** | each owns `StockChart.jsx`, `flipState.js`, `chart_parity_cases.json`, `enumerationSites.test.js` | **solo AND ordered.** Registry order is load-bearing (A3); the four blocks are contiguous regions of one file whose line numbers shift under every deletion |
| **4** | **9** | `chartDefaults.js`, `instances.js`, `instanceControls.js`, `StockChart.jsx`, the four door-7 files, the decision record | **solo** |
| **5** | **10** | `placement.js`, `binder.js`, `paneLayout.js`, `StockChart.jsx`, `chartRegion.js` | **solo** |
| **6** | **11** | measurement + `docs/decisions/…flip-c-pane-geometry.md` + `chart_parity_cases.json` (`regions` only) | **solo** (it is holding the parity harness for hours; a concurrent build corrupts its numbers — B3 learned this the expensive way) |
| **7** | **12** · **13** | T12: the constant + the deletions. T13: the flip sets + the ledger + the docs | **solo, ordered** |

**Hand-back protocol for the ledger**, taken verbatim from B4's controller ruling: a task that is not the ledger's owner **reports its delta in its completion note and does not edit the file**. In this plan the ledger's owner is whichever task is running — because every ledger-touching task is solo — so the protocol only binds if a controller ever parallelises Tasks 5–8 against advice. It should not.

**A second axis that IS safe to parallelise:** within Tasks 5–8, the *transcription suite* for a later task is a new file that consumes only `nativeRegistry.js` and the shipped `StockChart.jsx` — it can be written and run green (against the un-migrated tree) by a parallel agent while an earlier migration is in flight, because a transcription suite passes **before** its migration by construction. Step 1 of each of those tasks says so.

---

### Task 1: The B5 ledger — the partition becomes a MAPPING, the baseline becomes a measurement, and the no-strand rail is re-read

The ledger's partition is a histogram (`{B5: 8, C: 2, keep: 3, phase: 2}`), and B4's own review recorded the hole: **swapping two sites' fates preserves every count and passes.** B5 empties two of the four buckets, so the surviving space is small enough that a permutation is *more* likely to slip through. This task closes it before anything moves, records the baseline by command, and fixes the one control that is already rotten at HEAD.

**Files:**
- Modify: `app/src/components/chart/engine/__tests__/enumerationSites.test.js` (the `LEDGER` array `:97-238`; the partition assertion `:498`)
- Modify: `app/src/components/chart/engine/nativeRegistry.js:606-608` (comment only)
- Create: `docs/decisions/2026-08-04-flip-c-pane-geometry.md` (skeleton, Status `OPEN — NOT YET MEASURED`)
- Modify: `docs/decisions/2026-08-03-engine-enabled-settings-migration.md` (append §11, B5's adjudication; **Status stays OPEN**)

**Interfaces:**
- Consumes: `LEDGER` (15 rows, `{file, region, anchor, fate}`), `SITE_COUNT = 15`.
- Produces: `LEDGER_FATES` — a frozen `[[siteKey, fate], …]` sorted array that every later task decrements. `siteKey` is `` `${file}::${region}` ``.

- [ ] **Step 1: Write the failing test**

Add beside the existing histogram assertion (do **not** replace it — the histogram is what catches a fate *typo*, which produces a sixth bucket a mapping would happily accept):

```js
  // ⭐ B5 A8. The assertion two lines up is a HISTOGRAM, and B4's review measured
  // its blind spot: SWAPPING two sites' fates preserves every count and passes.
  // B5 empties two of the four buckets, so the space a permutation can hide in
  // gets SMALLER and therefore easier to fall into, not harder. This is the same
  // claim as a MAPPING, which fails BY NAME.
  it('every site names its own fate, so a permutation cannot pass', () => {
    const pairs = LEDGER.map(s => [`${s.file}::${s.region}`, s.fate]).sort()
    expect(pairs).toEqual([
      ['api/services/indicator_alert_evaluator.py::INDICATOR_FUNCS — the evaluator, and after B4 the alert catalog\'s ONE authority', 'C'],
      ['api/services/voice_client_action_tools.py::_INDICATOR_ALIASES — the voice add_chart_indicator phrase map', 'C'],
      ['app/src/components/StockChart.jsx::the hand-written render blocks', 'B5'],
      ['app/src/components/StockChart.jsx::the hide-all ref array', 'B5'],
      ['app/src/components/StockChart.jsx::the indicatorData memo — compute calls + shape mapping', 'B5'],
      ['app/src/components/StockChart.jsx::the series useRef declarations', 'B5'],
      ['app/src/components/chart/chartDefaults.js::CHART_DEFAULTS.indicators — 15 keyed sections', 'B5'],
      ['app/src/components/chart/chartDefaults.js::mergeChartSettings\' per-key allow-list — 15 lines', 'B5'],
      ['app/src/components/chart/engine/flipState.js::ENGINE_FLIPPED_DEF_IDS', 'phase'],
      ['app/src/components/chart/engine/flipState.js::ENGINE_MIGRATED_DEF_IDS', 'phase'],
      ['app/src/components/chart/engine/nativeRegistry.js::RAW_DEFS — THE ONE THAT SHOULD SURVIVE', 'keep'],
      ['app/src/components/chart/keyboardShortcuts.js::INDICATOR_CHORDS — the four chord bindings, declared once', 'keep'],
      ['app/src/components/chart/paneMargins.js::PANES — the oscillator stacking list, 9 + volume', 'B5'],
      ['app/src/pages/charts/ChartsWorkspace.jsx::UCT_DEFAULT_CHART_SETTINGS_JSON — a frozen capture of all 15 sections', 'B5'],
      ['tools/chart_parity_cases.json::the parity case list', 'keep'],
    ])
  })
```

⚠️ **The literal above is derived, not typed.** Generate it once with the snippet below and paste the output, then verify by eye against the `LEDGER` array — a hand-copy is the exact defect this branch has shipped twice (B4 Task 2's `SHIPPED` block; the plan-supplied `CHIPS` table).

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/enumerationSites.test.js \
  -t "every site names its own fate" 2>&1 | head -40
```

- [ ] **Step 2: Run it and watch it fail**

Before pasting the generated literal, paste a deliberately wrong one (swap `RAW_DEFS`' `keep` for `phase`).

Run: `cd app && npx vitest run src/components/chart/engine/__tests__/enumerationSites.test.js -t "every site names its own fate"`
Expected: **FAIL**, naming `RAW_DEFS`. Then paste the real literal and watch it pass. This is the only way to know the assertion is not vacuous on an empty `LEDGER`; add `expect(pairs).toHaveLength(SITE_COUNT)` in the same test so an emptied array cannot pass either.

- [ ] **Step 3: Fix the control that is already rotten at HEAD**

`nativeRegistry.js:606-608` says the head-mask constant is read by *"the engine's `COLUMN_HOLDS`, and — because `macd` is not migrated — the legacy `indicatorData` memo in `StockChart.jsx`"*. `macd` **is** migrated and flipped; `StockChart.jsx:4144-4146` records that the legacy reader went with the block. Replace with:

```js
// ONE constant, ONE reader. `macd` was flipped at B3 Task 11 (`400005ee`), so
// the legacy `indicatorData` branch this comment used to name is gone — see
// StockChart.jsx:4144-4146. `COLUMN_HOLDS` below is the only consumer, and it is
// `{}` while MACD_HEAD_MASK is false. Kept, not deleted: reversal is one edit and
// it is priced at the same 88 px (docs/decisions/2026-08-02-macd-head-mask.md).
```

- [ ] **Step 4: Record the baseline BY COMMAND, in the repo**

`.superpowers/` is gitignored and this branch has already lost a corrected count that way. Append to `docs/decisions/2026-08-03-engine-enabled-settings-migration.md` as **§11 — B5's adjudication**, carrying: the three commands and the counts they actually produce at `084eeded`; **Status is UNCHANGED: OPEN** (Task 9 resolves it); and B5's adoption of §8.2 in full — *migrate and flip together for all ten, then delete the flag AND the rest of `cs.indicators`*.

⚠️ Write "Status is UNCHANGED: OPEN" in the BODY, never as a second `**Status:**` line. The rail matches the **header** line, isolated and counted (`statusLines: 1`); a second one is the exact defect R-I1 fixed.

- [ ] **Step 5: Create the Flip-C decision-record skeleton**

`docs/decisions/2026-08-04-flip-c-pane-geometry.md`, id `FLIP_C_PANE_GEOMETRY`, `**Status:** 🟡 OPEN — NOT YET MEASURED`. Sections: 1 What changes and why it cannot be zero · 2 The three sub-choices (separator visibility / per-pane axis / pane heights) · 3 The measurement (empty; Task 11 fills it) · 4 What goes red when it is applied · 5 The owner's answer (empty). It exists now so Task 11 has somewhere to write and so Task 13's spec §11 row has something to cite.

- [ ] **Step 6: Gate**

**Pixels: none, and assert it.** `git diff --name-only 084eeded | grep '^app/src/' | grep -v '__tests__/'` must be EMPTY (the `nativeRegistry.js` change is a comment, so the grep will show it — confirm by `git diff 084eeded -- app/src/components/chart/engine/nativeRegistry.js` showing only comment lines, and note that vite strips comments so the build id is unchanged). No parity run is warranted; **no parity number is produced, so no build identities to name.**

**Non-pixel assertions:** the per-site mapping equals the fifteen pairs; `pairs.length === SITE_COUNT`; the histogram still equals `{B5: 8, C: 2, keep: 3, phase: 2}`; every anchor still matches exactly once; the decision record still has exactly one `**Status:**` header line and it still says OPEN.

**Mutation gauntlet.** Selection: `src/components/chart/engine/__tests__/enumerationSites.test.js`

| # | file | mutation | `-t` filter | must exit 1 |
|---|---|---|---|---|
| M1 | `enumerationSites.test.js` | swap site 11 (`RAW_DEFS`, `keep`) and site 12 (`ENGINE_MIGRATED_DEF_IDS`, `phase`) fates — **total preserved** | `every site names its own fate` | yes |
| M2 | ″ | same swap, run under the histogram's filter | `every B4 region is retired` | **no — must exit 0.** This is the DEMONSTRATION that the histogram cannot see a permutation, and it is why the mapping exists. Record it as a designed survivor with its reason. |
| M3 | ″ | `LEDGER.map(...)` → `LEDGER.slice(0, 3).map(...)` | `every site names its own fate` | yes — proves the length assertion is load-bearing |
| M4 | `nativeRegistry.js` | `SITE_COUNT` is not here; instead flip `MACD_HEAD_MASK` to `true` | `flagged decision` (in `nativeRegistry.test.js`) | yes — proves Step 3's comment edit did not disturb the pin |
| M5 | `…engine-enabled-settings-migration.md` | header `**Status:**` line OPEN → RESOLVED | `no migrated-but-un-flipped` | yes — the rail still reads the header after §11 was appended |
| M6 | ″ | append a SECOND `**Status:** … OPEN` line at end of file, leave the header OPEN | `no migrated-but-un-flipped` | yes — `statusLines: 1` is counted, not just matched |

- [ ] **Step 7: Commit**

```bash
git add app/src/components/chart/engine/__tests__/enumerationSites.test.js \
        app/src/components/chart/engine/nativeRegistry.js \
        docs/decisions/2026-08-03-engine-enabled-settings-migration.md \
        docs/decisions/2026-08-04-flip-c-pane-geometry.md
git commit -m "test(engine): the ledger's partition names every site, not just the counts

The partition assertion is a histogram, and B4's review measured its blind spot:
swapping two sites' fates preserves every count and passes. B5 empties two of the
four buckets, so that space gets smaller and easier to fall into. Adds a per-site
id->fate mapping beside it (not instead of it -- the histogram is what catches a
fate typo, which makes a sixth bucket). Baseline recorded by command in the repo,
since .superpowers/ is gitignored and this branch has lost one that way.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The parity harness learns to measure an INTENDED change — `expect`, `regions`, and the pane manifest

*(Wave 1, parallel with Task 3. **Python only. This task must not touch `app/src`.**)*

Every gate on this branch has been `changed <= tolerance` with `tolerance == 0`. Task 12 needs a gate that can say *"this many pixels changed, in these rectangles, and nowhere else"* — and a `--tolerance` cannot say it, because a budget also hides the next change of the same size.

**Files:**
- Modify: `tools/chart_parity.py` (`diff()` `:642-689`; `collapse_case()` `:718-770`; `capture()`; the entry construction `:1148-1155`; argparse `:898-956`; `write_report`)
- Modify: `tests/test_chart_parity_harness.py`
- Modify: `docs/runbooks/chart-parity-gate.md` (new §7)

**Interfaces:**
- Consumes: the case schema in `tools/chart_parity_cases.json` (`defaults`, `presets`, `cases[]`).
- Produces, for Tasks 11–13: case keys `expect` (int) and `regions` (`[{name, box:[x0,y0,x1,y1], expect:int}]`); CLI `--expect N`; `report.json` per-run keys `regions` (dict incl. the computed `rest`) and `manifest_a` / `manifest_b` / `manifest_diff`.

- [ ] **Step 1: Write the failing tests**

```python
def test_region_counts_split_the_same_mask_the_headline_number_came_from(tmp_path):
    # Two 10x10 images differing in exactly one 2x2 block at (1,1).
    a = Image.new("RGB", (10, 10), (0, 0, 0))
    b = a.copy()
    for x in (1, 2):
        for y in (1, 2):
            b.putpixel((x, y), (255, 255, 255))
    pa, pb = tmp_path / "a.png", tmp_path / "b.png"
    a.save(pa); b.save(pb)
    out = chart_parity.diff(pa, pb, regions=[{"name": "corner", "box": [0, 0, 5, 5]}])
    assert out["changed"] == 4
    # The region count is derived from the SAME mask, so it CANNOT disagree.
    assert out["regions"] == {"corner": 4, "rest": 0}


def test_rest_is_computed_and_cannot_be_declared_away(tmp_path):
    a = Image.new("RGB", (10, 10), (0, 0, 0))
    b = a.copy()
    b.putpixel((8, 8), (255, 255, 255))          # OUTSIDE the declared region
    pa, pb = tmp_path / "a.png", tmp_path / "b.png"
    a.save(pa); b.save(pb)
    out = chart_parity.diff(pa, pb, regions=[
        {"name": "corner", "box": [0, 0, 5, 5]},
        # ⛔ a case may not declare `rest`; if it tries, the harness refuses.
    ])
    assert out["regions"]["rest"] == 1


def test_declaring_a_region_named_rest_is_refused():
    with pytest.raises(SystemExit):
        chart_parity.validate_regions([{"name": "rest", "box": [0, 0, 1, 1]}])


def test_overlapping_regions_do_not_double_count_into_rest(tmp_path):
    a = Image.new("RGB", (10, 10), (0, 0, 0))
    b = a.copy(); b.putpixel((2, 2), (255, 255, 255))
    pa, pb = tmp_path / "a.png", tmp_path / "b.png"
    a.save(pa); b.save(pb)
    out = chart_parity.diff(pa, pb, regions=[
        {"name": "left",  "box": [0, 0, 5, 10]},
        {"name": "upper", "box": [0, 0, 10, 5]},   # overlaps `left`
    ])
    # `rest` is a MASK subtraction, not `total - sum(regions)`; the naive
    # arithmetic would give 1 - (1 + 1) = -1 here.
    assert out["regions"] == {"left": 1, "upper": 1, "rest": 0}


def test_expect_is_an_EQUALITY_and_a_smaller_diff_fails_too():
    entry = {"name": "x", "tolerance": 0, "expect": 88, "runs": [
        {"changed": 88, "size_mismatch": False}, {"changed": 87, "size_mismatch": False}]}
    # 87 < 88. A tolerance would PASS this. It is a regression.
    assert chart_parity.collapse_case(entry)["pass"] is False


def test_expect_demands_zero_variance_across_every_run():
    entry = {"name": "x", "tolerance": 0, "expect": 88, "runs": [
        {"changed": 88, "size_mismatch": False}, {"changed": 88, "size_mismatch": False}]}
    assert chart_parity.collapse_case(entry)["pass"] is True
    entry["runs"][1]["changed"] = 89
    assert chart_parity.collapse_case(entry)["pass"] is False


def test_a_region_expectation_fails_the_case_even_when_the_total_matches():
    # THE POINT: the same total can be the WRONG picture. 88 px that moved from
    # the oscillator strip into the price pane is a regression with a green total.
    entry = {"name": "x", "tolerance": 0, "expect": 88,
             "expect_regions": {"price_plot": 0, "osc_strip": 88},
             "runs": [{"changed": 88, "size_mismatch": False,
                       "regions": {"price_plot": 88, "osc_strip": 0, "rest": 0}}]}
    assert chart_parity.collapse_case(entry)["pass"] is False


def test_manifest_diff_is_empty_when_both_sides_report_the_same_layout():
    m = {"chartHeight": 594, "separatorPx": 1, "panes": [{"index": 0, "height": 594, "series": []}]}
    assert chart_parity.manifest_diff(m, json.loads(json.dumps(m))) == []


def test_manifest_diff_names_the_pane_that_moved():
    a = {"chartHeight": 594, "separatorPx": 1, "panes": [{"index": 0, "height": 594, "series": []}]}
    b = {"chartHeight": 594, "separatorPx": 1,
         "panes": [{"index": 0, "height": 505, "series": []},
                   {"index": 1, "height": 88, "series": []}]}
    d = chart_parity.manifest_diff(a, b)
    assert any("panes" in line and "1" in line for line in d)
    assert d != []


def test_a_case_with_regions_but_no_manifest_still_reports_and_does_not_crash(tmp_path):
    # ChartRender only publishes __paneManifest under ?fixedbars=; a page that
    # does not is a MISSING manifest, not an error, and must read `null` rather
    # than throwing halfway through a 20-run measurement.
    assert chart_parity.read_manifest(_FakePageWithNoGlobal()) is None
```

- [ ] **Step 2: Run them and watch every one fail**

```bash
cd C:/Users/Patrick/uct-worktrees/phase-b2-engine && \
  PYTHONIOENCODING=utf-8 python -m pytest tests/test_chart_parity_harness.py -q -k "region or expect or manifest"
```
Expected: **FAIL** — `AttributeError: module 'chart_parity' has no attribute 'validate_regions'`, and `diff()` taking no `regions` kwarg.

- [ ] **Step 3: Implement — `regions`, in `diff()`**

Insert after the `mask` is built (`chart_parity.py:669`, immediately after `mask = delta.point(...)`), and add `regions: list | None = None` to the signature:

```python
    region_counts = None
    if regions is not None:
        validate_regions(regions)
        region_counts = {}
        # `covered` accumulates the union of every declared rectangle. It is a
        # MASK, not an arithmetic total: overlapping regions would make
        # `total - sum(regions)` negative, and two cases in this file's suite
        # exist because the naive version was written first.
        covered = Image.new("L", a.size, 0)
        for r in regions:
            x0, y0, x1, y1 = r["box"]
            crop = mask.crop((x0, y0, x1, y1))
            region_counts[r["name"]] = (x1 - x0) * (y1 - y0) - crop.histogram()[0]
            covered.paste(255, (x0, y0, x1, y1))
        # Everything the case did NOT name. `rest` is computed here and can never
        # be declared (validate_regions refuses the name), because a cutover that
        # moves a pixel nobody named must fail and the only way to keep that
        # failable is for this bucket not to be a case-file field.
        outside = ImageChops.subtract(mask, covered)
        region_counts["rest"] = total - outside.histogram()[0]
```

and add `"regions": region_counts` to `diff()`'s return dict.

```python
def validate_regions(regions) -> None:
    """Refuse a region list that could make the gate unfalsifiable.

    `rest` is reserved: it is the bucket for every changed pixel outside every
    declared rectangle, and a case that could declare it could declare its own
    blind spot. A zero-area box is refused for the same reason — it reports 0
    forever and reads like a passing region.
    """
    seen = set()
    for r in regions or []:
        name = r.get("name")
        if name == "rest":
            raise SystemExit("chart_parity: `rest` is computed, not declarable — "
                             "it is the bucket that catches a pixel nobody named.")
        if not name or name in seen:
            raise SystemExit(f"chart_parity: region names must be present and unique (got {name!r})")
        seen.add(name)
        x0, y0, x1, y1 = r["box"]
        if x1 <= x0 or y1 <= y0:
            raise SystemExit(f"chart_parity: region {name!r} has zero area — "
                             "a region that can only ever report 0 is not a gate.")
```

- [ ] **Step 4: Implement — `expect`, in `collapse_case()`**

Replace the single verdict line (`chart_parity.py:763`) with:

```python
        entry["changed_values"] = [r["changed"] for r in runs]
        if entry.get("expect") is not None:
            # ⛔ NOT `<=`. An `expect` is a DECLARED, MEASURED, SIGNED-OFF number
            # (the MACD head-mask's 88 px and the VWAP anchor's 2,590 px are the
            # precedent, both with zero variance over 20 runs). A tolerance would
            # pass a regression that happens to be SMALLER than the allowance, and
            # would also hide the next change of the same size. Equality on EVERY
            # run, not on the worst: variance is itself a failure here, because a
            # number that moves is a number nobody can sign off.
            entry["pass"] = all(v == entry["expect"] for v in entry["changed_values"])
        else:
            entry["pass"] = entry["changed"] <= entry["tolerance"]

        want_regions = entry.get("expect_regions") or {}
        if want_regions:
            # `rest` defaults to 0 and a case may not raise it (validate_regions).
            want = {"rest": 0, **want_regions}
            for r in runs:
                got = r.get("regions") or {}
                for name, n in want.items():
                    if got.get(name) != n:
                        entry["pass"] = False
                        entry.setdefault("region_failures", []).append(
                            f"run {r.get('run')}: {name} = {got.get(name)}, expected {n}")
```

⚠️ `clean_runs` (the line below) must count against the same rule, or `flake_bound_95` is computed from runs the verdict rejected. Change its predicate to `entry["pass"]`-consistent logic in the same edit and add a case asserting `flake_bound_95 is None` when any run's number differs from `expect`.

- [ ] **Step 5: Implement — the manifest capture**

In `capture()`, after `__chartReady` resolves and before the final screenshot:

```python
def read_manifest(page):
    """`window.__paneManifest`, or None.

    ChartRender only publishes it under `?fixedbars=`, and a page that does not
    is a MISSING manifest, not an error: raising here would abort a 20-run
    measurement halfway. A missing manifest reads `null` in report.json and the
    A/B diff is skipped with a stated reason, which is visible; an exception at
    run 13 of 20 is not.
    """
    try:
        return page.evaluate("() => window.__paneManifest ?? null")
    except Exception:                                     # noqa: BLE001
        return None


def manifest_diff(a, b):
    """A list of human-readable `path: a -> b` lines, empty when identical.

    Compared as normalised JSON, not as objects: the manifest crosses a browser
    boundary, so key order and float formatting are not ours to trust.
    """
    if a is None or b is None:
        return ["manifest missing on " + ("A" if a is None else "B")]
    out = []
    def walk(pa, x, y):
        if isinstance(x, dict) and isinstance(y, dict):
            for k in sorted(set(x) | set(y)):
                walk(f"{pa}.{k}" if pa else k, x.get(k), y.get(k))
        elif isinstance(x, list) and isinstance(y, list):
            for i in range(max(len(x), len(y))):
                walk(f"{pa}[{i}]", x[i] if i < len(x) else None, y[i] if i < len(y) else None)
        elif x != y:
            out.append(f"{pa}: {x!r} -> {y!r}")
    walk("", a, b)
    return out
```

Store `manifest_a` / `manifest_b` per run and `manifest_diff` on the entry; print the diff into `report.md` under each case that has one.

- [ ] **Step 6: Wire the CLI and the case schema**

```python
    ap.add_argument("--expect", type=int, default=None,
                    help="EXACT changed-pixel count every run must equal (not a budget). "
                         "Overrides a case's own `expect`. Use for a one-off measurement; "
                         "the durable form is the case file's `expect` + `regions`.")
```

and in the entry construction (`:1148`):

```python
            entries[case["name"]] = {
                "name": case["name"],
                "tolerance": case.get("tolerance", args.tolerance) or args.tolerance,
                "toleranceReason": case.get("toleranceReason"),
                "expect": args.expect if args.expect is not None else case.get("expect"),
                "expect_regions": {r["name"]: r["expect"] for r in (case.get("regions") or [])
                                   if "expect" in r} or None,
                "regions": case.get("regions"),
                "runs": [],
            }
```

⚠️ **`--expect` and `--tolerance > 0` are mutually exclusive** — refuse at argparse time with a message saying why (one is a declared measurement, the other is an escape; a run carrying both is a run whose verdict nobody can state). Add the refusal and a control case.

- [ ] **Step 7: Runbook §7**

New section, *"§7 — The declared-diff gate: what B5 uses instead of zero"*, carrying the four parts from this plan's own section verbatim, the `expect`-is-an-equality rationale, the `rest`-is-not-declarable rule, and this warning: **a case that gains a `regions` block loses nothing — the headline `changed` is still whole-canvas and still reported.** Regions add a second, finer verdict; they never replace the first.

- [ ] **Step 8: Gate**

**Pixels: none — this task touches no `app/src` file.** Assert it: `git diff --name-only 084eeded -- app/src` is EMPTY at this task's commit. ⚠️ Do **not** run a parity measurement here even though the harness changed: the four self-tests below exercise the new code paths without a browser, and a browser run at this point would be measuring Task 1's tree with a half-parallel Task 3 in flight.

**Non-pixel assertions:** all ten new pytest cases; the four existing refusals still refuse (`--perturb-b-instances` without `instancesB`; `--base-b` omitted without `--same-build`; same build id with nothing else distinguishing; an `instancesB` case on a base with no engine source); `--tolerance > 0` still requires `--tolerance-reason`.

**A real end-to-end proof, not just unit cases.** Run the shipped gate through the new code path with regions declared over the CURRENT geometry, where the answer must still be zero everywhere:

```bash
cd app && npm run build && cd ..
python tools/spa_server.py app/dist 5901 &
python tools/chart_parity.py --base-a http://127.0.0.1:5901 --same-build \
    --dist-a app/dist --dist-b app/dist --cases rsi_only bb_rsi_macd --repeat 3
# expect: 0 px both cases, regions all 0 incl. rest, exit 0
python tools/chart_parity.py --base-a http://127.0.0.1:5901 --same-build \
    --dist-a app/dist --dist-b app/dist --cases rsi_only \
    --perturb-b '{"indicators": {"rsi": {"color": "#7b68ef"}}}' --expect 999999
# expect: NON-ZERO changed, and exit 1 because it is not 999,999 —
# which proves `expect` fails on a number that is merely different.
```

Record both build identities (they are the same id; the run declares `--same-build`).

**Mutation gauntlet.** Selection: `tests/test_chart_parity_harness.py`. `PYTHONDONTWRITEBYTECODE=1`.

| # | file | mutation | `-t` filter | must exit 1 |
|---|---|---|---|---|
| M1 | `chart_parity.py` | `outside = ImageChops.subtract(mask, covered)` → `outside = mask` | `rest_is_computed` | yes |
| M2 | ″ | `region_counts["rest"] = total - outside.histogram()[0]` → `= total - sum(region_counts.values())` (the naive arithmetic) | `overlapping_regions` | yes |
| M3 | ″ | `all(v == entry["expect"] …)` → `entry["changed"] <= entry["expect"]` | `EQUALITY_and_a_smaller_diff` | yes |
| M4 | ″ | `all(v == …)` → `entry["changed"] == entry["expect"]` (worst-run only) | `zero_variance_across_every_run` | yes — a worst-run check cannot see variance |
| M5 | ″ | delete the `name == "rest"` refusal in `validate_regions` | `region_named_rest_is_refused` | yes |
| M6 | ″ | delete the zero-area refusal | *(unfiltered)* | yes |
| M7 | ″ | in `collapse_case`, drop the `expect_regions` loop entirely | `region_expectation_fails_the_case` | yes |
| M8 | ″ | `read_manifest`'s `except` → `raise` | `no_manifest_still_reports` | yes |
| M9 | ″ | `manifest_diff` returns `[]` unconditionally | `names_the_pane_that_moved` | yes |

- [ ] **Step 9: Commit**

```bash
git add tools/chart_parity.py tests/test_chart_parity_harness.py docs/runbooks/chart-parity-gate.md
git commit -m "feat(parity): the gate can measure an INTENDED change, not just refuse one

B5's cutover changes the picture by construction, so `changed <= 0` stops being
available. `expect` is an EQUALITY on every run (a tolerance would pass a
regression smaller than the allowance, and hide the next change of the same
size); `regions` bounds the change to rectangles named in advance; `rest` is
computed, never declarable, so a pixel nobody named still fails. The pane
manifest lands in report.json so geometry is asserted structurally rather than
inferred from pixels.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `paneLayout.js` — the geometry, as a pure function, consumed by nothing yet

*(Wave 1, parallel with Task 2. **This task must not touch `tools/` or `tests/`.**)*

B4's Task 2 established the shape: build the derivation and its full transcription suite **before** any call site moves, so the module can be proven against the shipped behaviour while the shipped behaviour is still running. `paneLayout.js` is that module for Flip C.

**Files:**
- Create: `app/src/components/chart/engine/paneLayout.js`
- Create: `app/src/components/chart/engine/paneLayout.test.js`
- Create: `app/src/components/chart/engine/__tests__/paneSeparatorPin.test.js`
- Modify: `app/src/components/chart/engine/defSchema.js` (validate `placement.pane.height`)
- Modify: `app/src/components/chart/engine/nativeRegistry.js` (nine `placement.pane.height` values)
- Modify: `app/src/pages/ChartRender.jsx` (publish `window.__paneManifest` under `?fixedbars=`)

**Interfaces:**
- Consumes: `computePaneMargins(cs, hasVolume, excludeKeys)` from `chart/paneMargins.js` (still shipped; this module is proven **against** it), `listDefinitions()` from `nativeRegistry`.
- Produces, for Tasks 10 and 12:
  - `SEPARATOR_PX: number`
  - `computePaneLayout(cs, instances, opts) → { panes: [{key, index, heightPx, stretchFactor}], pane0: {heightPx, mainMargins: {top, bottom}, volumeMargins: {top, bottom}|null} }` where `opts = {chartHeight, hasVolumeBand, excludeKeys, separatorPx}`
  - `paneManifest(chart, bindings) → {chartHeight, separatorPx, panes: [{index, height, stretchFactor, series: [{type, scaleId, key}]}]}`

- [ ] **Step 1: Pin the separator height against the REAL bundle**

`SEPARATOR_PX` is the one number in this module that is not ours. Do not assume it.

```js
// app/src/components/chart/engine/__tests__/paneSeparatorPin.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createChart, LineSeries } from 'lightweight-charts'
import { SEPARATOR_PX } from '../paneLayout'

// ⭐ WHY THIS EXISTS. `SEPARATOR_PX` is the pixel budget the whole pane-0
// preservation identity is built on (plan §A6): the separators are taken out of
// the OSCILLATOR panes so pane 0's rectangle lands on the same pixels. If
// lightweight-charts changes that height in a patch release, every pane in the
// app moves by a pixel and NOTHING else in the tree would say so.
describe('the pane separator height is measured from the installed renderer', () => {
  let el, chart
  beforeAll(() => {
    el = document.createElement('div')
    el.style.width = '600px'
    Object.defineProperty(el, 'clientWidth', { value: 600 })
    Object.defineProperty(el, 'clientHeight', { value: 400 })
    document.body.appendChild(el)
    chart = createChart(el, { width: 600, height: 400, timeScale: { visible: false } })
    chart.addSeries(LineSeries, {}, 0)
    chart.addSeries(LineSeries, {}, 1)   // forces a second pane
  })
  afterAll(() => { chart.remove(); el.remove() })

  it('two panes account for the chart height minus exactly one separator', () => {
    const panes = chart.panes()
    expect(panes).toHaveLength(2)
    const sum = panes.reduce((s, p) => s + p.getHeight(), 0)
    const measured = 400 - sum
    // ⛔ If this fails, do NOT change SEPARATOR_PX to the new number and move on.
    // Re-run the pane-0 preservation cases in paneLayout.test.js first: the
    // budget arithmetic is what keeps `price_plot` at 0 changed pixels.
    expect(measured).toBe(SEPARATOR_PX)
  })

  it('stretch factors distribute the AVAILABLE height, so factors set to target pixels land exactly', () => {
    const [p0, p1] = chart.panes()
    p0.setStretchFactor(300)
    p1.setStretchFactor(400 - SEPARATOR_PX - 300)
    expect(p0.getHeight()).toBe(300)
    expect(p1.getHeight()).toBe(400 - SEPARATOR_PX - 300)
  })
})
```

- [ ] **Step 2: Run it and record what it says**

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/paneSeparatorPin.test.js
```
Expected on the first run: **FAIL** (`paneLayout` does not exist). Create `paneLayout.js` with `export const SEPARATOR_PX = 1`, re-run, and **write the measured number into the plan's own record in the commit message** whatever it turns out to be. If the second assertion fails, `setStretchFactor` does not distribute the way §A7 assumes — STOP, and switch the module to `setHeight` with the same target values plus the post-pass height assertion; that is the named fallback and it is not a TBD.

- [ ] **Step 3: Write the failing transcription suite**

The whole value of this module is that it reproduces `computePaneMargins` exactly. Assert that, over the same space `paneMarginsProjection.test.js` already covers — **all 512 subsets of the nine stacked oscillators, on both volume settings**.

```js
// app/src/components/chart/engine/paneLayout.test.js
import { describe, it, expect } from 'vitest'
import { computePaneMargins } from '../paneMargins'
import { computePaneLayout, SEPARATOR_PX } from './paneLayout'
import { mergeChartSettings } from '../chartDefaults'

const OSC = ['obv', 'atr', 'adx', 'macd', 'cci', 'williamsR', 'mfi', 'stoch', 'rsi']
const H = 594                                   // the parity route's plot height

const blobFor = (mask) => mergeChartSettings({
  indicators: Object.fromEntries(OSC.map((k, i) => [k, { enabled: !!(mask & (1 << i)) }])),
})

describe('pane 0 keeps its rectangle, to the pixel', () => {
  it.each([0, 1, 3, 7, 0b101010101, 511])('subset %i', (mask) => {
    const cs = blobFor(mask)
    const bands = computePaneMargins(cs, true, new Set())
    const out = computePaneLayout(cs, [], { chartHeight: H, hasVolumeBand: true,
                                            excludeKeys: new Set(), separatorPx: SEPARATOR_PX })
    // The candle rectangle TODAY, in pixels, from the band function.
    const beforeTop = Math.round(bands.main.top * H)
    const beforeBot = Math.round((1 - bands.main.bottom) * H)
    // The candle rectangle AFTER, from pane 0's own height and its re-expressed margins.
    const p0 = out.pane0
    const afterTop = Math.round(p0.mainMargins.top * p0.heightPx)
    const afterBot = Math.round((1 - p0.mainMargins.bottom) * p0.heightPx)
    expect([afterTop, afterBot]).toEqual([beforeTop, beforeBot])
  })

  it('and every subset of all 512, not just the six above', () => {
    const bad = []
    for (let mask = 0; mask < 512; mask++) {
      const cs = blobFor(mask)
      const bands = computePaneMargins(cs, true, new Set())
      const out = computePaneLayout(cs, [], { chartHeight: H, hasVolumeBand: true,
                                              excludeKeys: new Set(), separatorPx: SEPARATOR_PX })
      const b = [Math.round(bands.main.top * H), Math.round((1 - bands.main.bottom) * H)]
      const a = [Math.round(out.pane0.mainMargins.top * out.pane0.heightPx),
                 Math.round((1 - out.pane0.mainMargins.bottom) * out.pane0.heightPx)]
      if (a[0] !== b[0] || a[1] !== b[1]) bad.push({ mask, before: b, after: a })
    }
    // Non-vacuity: 512 iterations really ran.
    expect(bad).toEqual([])
  })
})

describe('the separator budget comes out of the OSCILLATORS, never out of pane 0', () => {
  it('pane 0 is exactly (1 - stack) of the chart, and the panes absorb every separator', () => {
    const cs = blobFor(0b111)                                  // obv + atr + adx
    const out = computePaneLayout(cs, [], { chartHeight: H, hasVolumeBand: true,
                                            excludeKeys: new Set(), separatorPx: SEPARATOR_PX })
    const sep = out.panes.length * SEPARATOR_PX
    expect(out.pane0.heightPx + out.panes.reduce((s, p) => s + p.heightPx, 0) + sep).toBe(H)
    const bands = computePaneMargins(cs, true, new Set())
    // Each pane is its band height MINUS its share of the budget, and the shares
    // sum to the budget exactly (integer shave, deterministic ties).
    const bandPx = out.panes.map(p => Math.round(
      ((1 - bands[p.key].top) - bands[p.key].bottom) * H))
    const lost = bandPx.reduce((s, v) => s + v, 0) - out.panes.reduce((s, p) => s + p.heightPx, 0)
    expect(lost).toBe(sep)
  })
})

describe('stack order is DATA, and it comes from the instance list', () => {
  it('panes are ordered by the instance list, not by registry order', () => {
    const cs = blobFor(0b111)
    const insts = [{ instanceId: 'legacy:adx', defId: 'adx' },
                   { instanceId: 'legacy:obv', defId: 'obv' },
                   { instanceId: 'legacy:atr', defId: 'atr' }]
    const out = computePaneLayout(cs, insts, { chartHeight: H, hasVolumeBand: true,
                                               excludeKeys: new Set(), separatorPx: SEPARATOR_PX })
    expect(out.panes.map(p => p.key)).toEqual(['adx', 'obv', 'atr'])
  })

  it('and falls back to the SHIPPED band order when the instance list says nothing', () => {
    // The pre-migration population: no instances, so nobody's stack may move.
    const cs = blobFor(0b111)
    const out = computePaneLayout(cs, [], { chartHeight: H, hasVolumeBand: true,
                                            excludeKeys: new Set(), separatorPx: SEPARATOR_PX })
    // computePaneMargins stacks bottom-to-top; panes are indexed top-to-bottom.
    expect(out.panes.map(p => p.key)).toEqual(['adx', 'atr', 'obv'])
  })
})

describe('heights come from the DEFINITION, not from a table in this file', () => {
  it('a definition with no declared pane height gets the default', () => {
    expect(() => computePaneLayout(blobFor(1), [], {
      chartHeight: H, hasVolumeBand: false, excludeKeys: new Set(), separatorPx: SEPARATOR_PX,
    })).not.toThrow()
  })
  it('and grep finds no nine-row height table in this module', async () => {
    const src = await import('node:fs').then(fs =>
      fs.readFileSync(new URL('./paneLayout.js', import.meta.url), 'utf8'))
    // ⛔ The point of A5: PANES retires INTO the definitions. A second copy of
    // the nine baseH values here would be the twin this phase exists to end.
    for (const id of OSC) expect(src).not.toContain(`'${id}'`)
  })
})
```

- [ ] **Step 4: Run it and watch it fail**

```bash
cd app && npx vitest run src/components/chart/engine/paneLayout.test.js
```
Expected: FAIL, `computePaneLayout is not a function`.

- [ ] **Step 5: Add `placement.pane.height` to the schema and the nine definitions**

`defSchema.js` — beside the existing `placement` validation:

```js
  // A pane's DEFAULT height, as a fraction of the chart. Optional; `paneLayout`
  // supplies 0.15 when absent. It lives on the definition because a pane height
  // is a per-indicator property — which is what lets a sixteenth indicator cost
  // one definition and zero list edits (plan §A5). It is a DEFAULT, not a lock:
  // an instance may carry its own once panes are user-resizable (Phase C).
  if (p.pane !== undefined) {
    if (!p.pane || typeof p.pane !== 'object') errs.push('placement.pane must be an object')
    else if (p.pane.height !== undefined
             && !(Number.isFinite(p.pane.height) && p.pane.height > 0 && p.pane.height < 1)) {
      errs.push('placement.pane.height must be a finite fraction in (0, 1)')
    }
  }
```

`nativeRegistry.js` — the nine values, taken **verbatim** from `paneMargins.js`'s `PANES`:

| id | `placement.pane.height` |
|---|---|
| `rsi` | `0.15` |
| `macd` | `0.17` |
| `stoch` | `0.15` |
| `atr` | `0.13` |
| `mfi` | `0.15` |
| `cci` | `0.15` |
| `williamsR` | `0.15` |
| `adx` | `0.15` |
| `obv` | `0.13` |

⚠️ The five price overlays (`bb`, `vwap`, `sar`, `ichimoku`, `donchian`) get **no** `pane` key — `enumerationSites.test.js` already asserts a price overlay gains no key in `paneMargins.js`, and its successor claim is that a price overlay declares no pane height. Add that assertion in the same commit.

- [ ] **Step 6: Implement `computePaneLayout` and `paneManifest`**

```js
// app/src/components/chart/engine/paneLayout.js
//
// ─── THE GEOMETRY, AS A PURE FUNCTION ───────────────────────────────────────
// `paneMargins.computePaneMargins` answers "what slice of pane 0 does each
// oscillator get". This answers "which PANE does each oscillator get, and how
// tall is it" — the same question after Flip C, when the bands become panes.
//
// It reproduces the band arithmetic EXACTLY (the integer-hundredths squeeze and
// the deterministic shave), because that is what makes pane 0's rectangle land
// on the same pixels and the `price_plot` parity region read 0. See the plan's
// §A6 for the identity and §A7 for why heights are set as stretch factors.
//
// ⛔ NO nine-row table lives here. Heights come from each definition's
// `placement.pane.height`; the stack ORDER comes from the instance list. That is
// the whole point of retiring PANES rather than moving it (plan §A5).

export const SEPARATOR_PX = 1   // MEASURED against the installed bundle — see
                                // __tests__/paneSeparatorPin.test.js. Do not edit
                                // this without re-running the 512-subset identity.

const DEFAULT_PANE_HEIGHT = 0.15
const MAIN_TOP = 0.30           // transcribed from paneMargins.js:18
const STACK_TARGET = 0.72       // transcribed from paneMargins.js:54

export function computePaneLayout(cs, instances, opts) { /* … */ }

export function paneManifest(chart, bindings) {
  // A JSON-serialisable description of what the renderer ACTUALLY built, read
  // back from the renderer rather than predicted. The plan's discriminator #3:
  // a change that moves pixels but not this, or this but not the pixels, is a
  // regression by definition — one of the two is lying.
  const byPane = new Map()
  for (const b of bindings || []) {
    if (!b.series) continue
    byPane.set(b.series, { key: b.key ?? null, scaleId: b.scaleId ?? null })
  }
  return {
    chartHeight: chart.panes().reduce((s, p) => s + p.getHeight(), 0)
                 + (chart.panes().length - 1) * SEPARATOR_PX,
    separatorPx: SEPARATOR_PX,
    panes: chart.panes().map((p) => ({
      index: p.paneIndex(),
      height: p.getHeight(),
      stretchFactor: p.getStretchFactor(),
      series: p.getSeries().map((s) => {
        const meta = byPane.get(s) || {}
        return { type: s.seriesType(), scaleId: s.priceScale().priceScaleId?.() ?? meta.scaleId ?? null,
                 key: meta.key ?? null }
      }),
    })),
  }
}
```

Fill `computePaneLayout` so the Step-3 suite passes. The arithmetic, in order: collect enabled oscillator keys (from `cs.indicators` while it exists, else from `instances`); order them by the instance list with the shipped band order as the fallback; read each height from `registry.getDefinition(key)?.placement?.pane?.height ?? DEFAULT_PANE_HEIGHT`; apply the same `scale = totalBase > STACK_TARGET ? STACK_TARGET/totalBase : 1` squeeze and the same integer-hundredths quantisation and shave; convert to pixels; subtract the separator budget with the same deterministic tallest-first shave; then `pane0.heightPx = chartHeight - Σpanes - Σsep` and `mainMargins = {top: MAIN_TOP*chartHeight/pane0.heightPx, bottom: volumeBandFraction*chartHeight/pane0.heightPx}`.

- [ ] **Step 7: Publish the manifest from `ChartRender.jsx`, under `?fixedbars=` only**

```jsx
      // The parity harness reads this. Published ONLY in fixed-bars mode, for the
      // same reason the footer clock is frozen there: a always-on global inside
      // #chart-export is a thing the gate has to be told to ignore, and a thing
      // nobody remembers to tell it. `?fixedbars=` is already the "this render is
      // being measured" switch.
      if (fixedBars) window.__paneManifest = manifest
```

- [ ] **Step 8: Control audit**

`grep -rn "paneMargins\|computePaneMargins" app/src --include=*.js --include=*.jsx | grep -i "test"` and read each hit's stated reason. Nothing should rot here — this task **retires nothing** and the band function still ships. Audit anyway and record "none" with the files checked, per B4 Task 2's precedent. Two claims to re-verify by hand: `paneMarginsProjection.js:16-20`'s 512-subset proof obligation (still true), and `enumerationSites.test.js`'s *"a price overlay gains no key in paneMargins.js"* (still true, and now joined by its pane-height twin).

- [ ] **Step 9: Gate**

**Pixels: 0 changed, all 24 live cases, 5/5, both identities named.** `ChartRender.jsx` gained a `window` write and `nativeRegistry.js` gained nine `placement.pane.height` fields, both on the render path's import graph — that is exactly what this zero is evidence for. Fail-proof, both, on the same pair:

```bash
python tools/chart_parity.py --base-a $A --base-b $B --dist-a .parity-dist-a --dist-b .parity-dist-b \
    --cases flipb_vwap_only --perturb-b '{"indicators": {"vwap": {"opacity": 40}}}'   # expect non-zero, exit 1
python tools/chart_parity.py --base-a $A --base-b $B --dist-a .parity-dist-a --dist-b .parity-dist-b \
    --cases intraday_bars_only --perturb-b '{"candles": {"upColor": "#1ae51b"}}'      # expect non-zero, exit 1
```
⚠️ **`#1ae51a` IS the branch's default `upColor`** — B4 measured that the "second fail-proof" as written in two prior briefs is a no-op that reports 0 and exits 0. Use `#1ae51b`.

**Non-pixel assertions:** the separator pin (both cases); the 512-subset pane-0 identity; the separator budget lands on the oscillators; pane order follows the instance list and falls back to the shipped order; no nine-row table in `paneLayout.js`; every price overlay declares no `placement.pane`; `validateDefinition` rejects `placement.pane.height` of `0`, `1`, `-0.1` and `'0.15'`.

**Mutation gauntlet.** Selection: `src/components/chart/engine/paneLayout.test.js src/components/chart/engine/__tests__/paneSeparatorPin.test.js src/components/chart/engine/defSchema.test.js src/components/chart/engine/nativeRegistry.test.js`

| # | file | mutation | `-t` filter | must exit 1 |
|---|---|---|---|---|
| M1 | `paneLayout.js` | `pane0.heightPx = chartHeight - Σpanes - Σsep` → `- Σpanes` (separators come out of pane 0) | `keeps its rectangle` | yes — this is the mutation §A6 exists to catch |
| M2 | ″ | the integer shave → `Math.floor` per pane | `every subset of all 512` | yes |
| M3 | ″ | `STACK_TARGET` 0.72 → 0.70 | `every subset of all 512` | yes |
| M4 | ″ | pane order: use registry order instead of the instance list | `ordered by the instance list` | yes |
| M5 | ″ | the fallback order: reverse it | `SHIPPED band order` | yes |
| M6 | ″ | `SEPARATOR_PX` 1 → 2 | `account for the chart height minus exactly one separator` | yes |
| M7 | `nativeRegistry.js` | `atr`'s `placement.pane.height` 0.13 → 0.15 | `every subset of all 512` | yes — proves the heights are read from the definitions and not from a copy |
| M8 | `defSchema.js` | drop the `0 < h < 1` bound | *(unfiltered on defSchema.test.js)* | yes |
| M9 | `paneLayout.js` | `paneManifest` returns `panes: []` | *(a manifest-shape case in `paneLayout.test.js`)* | yes |
| M10 | ″ | reintroduce a nine-row `const PANES = [...]` literal with the same values (behaviour-identical) | `no nine-row height table` | yes — **the only gate that can see it**, because it changes no behaviour |

⚠️ M10 is the one to write carefully. A behaviourally identical reintroduction is invisible to every other assertion in the file — B4 measured exactly this (a full `IND_OPTS` literal pasted back with the spaces around `=` removed left the retirement guard green). Make the probe match the **ids**, not the identifier `PANES`, so a rename cannot dodge it.

- [ ] **Step 10: Commit**

```bash
git add app/src/components/chart/engine/paneLayout.js \
        app/src/components/chart/engine/paneLayout.test.js \
        app/src/components/chart/engine/__tests__/paneSeparatorPin.test.js \
        app/src/components/chart/engine/defSchema.js \
        app/src/components/chart/engine/nativeRegistry.js \
        app/src/pages/ChartRender.jsx
git commit -m "feat(engine): paneLayout -- the geometry as a pure function, consumed by nothing yet

Reproduces computePaneMargins exactly (same squeeze, same integer shave) so that
pane 0's rectangle lands on the same pixels after the cutover and `price_plot`
can still read 0 changed pixels. The separator budget comes out of the
OSCILLATORS, never out of pane 0: a 1px compression across ~70% of the canvas
costs tens of thousands of pixels, the same compression in an 88px strip costs a
few thousand. PANES' nine baseH values move onto the definitions; its stack order
becomes the instance list's order. SEPARATOR_PX is MEASURED against the installed
renderer, not assumed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `engineEnabled` is DELETED — the flag that decides nothing stops existing

*(Solo. Owns `StockChart.jsx`.)*

The record's §7 priced this and its §8.2 recommended it: the flag's only remaining job is to distinguish *migrated-but-un-flipped* from *flipped*, a state that exists only inside a migration and that no user has an opinion about. B5 never creates that state (A1), so the flag can go — and it must go **now**, before the migrations, for a reason the record does not give: **`mergeChartSettings` is on every chart's path, and this is the last moment at which a change to it can be measured at an absolute 0 changed pixels.** After Flip C, no such measurement exists again.

**Files:**
- Modify: `app/src/components/chart/chartDefaults.js` (`CHART_DEFAULTS.engineEnabled`; `mergeChartSettings`'s `engineEnabled: parsed.engineEnabled === true`)
- Modify: `app/src/components/chart/engine/flipState.js` (`engineDrawnDefIds` `:187`, `engineDrawnInputs` `:217`)
- Modify: `app/src/components/StockChart.jsx` (`engineActive`; the dead `engineOwned` at `:5918` and the five comments calling it "the arbiter" at `:5662`, `:5705`, `:5782`, `:5912-5914`, `:6295`)
- Modify: `app/src/pages/ChartRender.jsx:236` (the one place in shipped source that ever writes it)
- Modify: `app/src/components/chart/ChartToolbar.jsx` (`engineInert`, `inertTitle`)
- Modify: `app/src/pages/Settings.jsx`, `app/src/components/chart/ChartSettingsModal.jsx`, `app/src/pages/charts/ChartsWorkspace.jsx` (door seven's three sites + the frozen capture)
- Modify: `app/src/components/chart/engine/__tests__/engineEnabledMigration.test.js`
- Create: `docs/decisions/2026-08-04-engine-enabled-deleted.md`

**Interfaces:**
- Consumes: `ENGINE_FLIPPED_DEF_IDS` (still `{rsi, bb, macd, vwap}` at this point), `controlDoorCensus.test.js`'s three door-7 sites.
- Produces: `mergeChartSettings` no longer emits an `engineEnabled` key at all; `engineDrawnInputs(cs, registry)` is unconditional; `flipState.engineActive` is gone (its callers read `ENGINE_FLIPPED_DEF_IDS.size > 0`, which Task 13 turns into a registry lookup).

- [ ] **Step 1: Write the failing test**

Rewrite `engineEnabledMigration.test.js`'s two anchor cases **in place**, keeping the old rule as the thing that must no longer hold (the record's §9 names both):

```js
  it('a July blob merges with NO engineEnabled key at all — the flag does not exist', () => {
    // ⭐ The blob is a STRING, deliberately. A fixture built as an object skips
    // the exact step being migrated (record §6 R3).
    const july = JSON.parse('{"indicators":{"rsi":{"enabled":true,"period":14}},"overlays":[]}')
    const cs = mergeChartSettings(july)
    expect('engineEnabled' in cs).toBe(false)
    // …and the thing that used to be true is now impossible, not merely false.
    expect(Object.keys(CHART_DEFAULTS)).not.toContain('engineEnabled')
  })

  it('an explicitly stored engineEnabled:false is DROPPED, not honoured', () => {
    // The old read was `parsed.engineEnabled === true`, so this blob merged to
    // false and a default flip could not heal it. There is nothing left to heal:
    // the allow-list destroys unknown keys and this is now an unknown key.
    const cs = mergeChartSettings(JSON.parse('{"engineEnabled":false,"indicators":{"rsi":{"enabled":true}}}'))
    expect('engineEnabled' in cs).toBe(false)
    // The RSI the user had on is still on, and still engine-drawn.
    expect(isIndicatorEnabled(cs, 'rsi', ENGINE_FLIPPED_DEF_IDS)).toBe(true)
  })

  it('the toolbar shows the DRAWN inputs on every chart now, not the legacy mirror', () => {
    // Record §4.2: engineDrawnInputs returned EMPTY flag-off, so ChartToolbar fell
    // back to cs.indicators. Every existing user was on that path. It is gone.
    const cs = setIndicatorEnabled(mergeChartSettings(null), 'rsi', true, engineRegistry)
    const withPeriod = setIndicatorInput(cs, 'rsi', 'period', 7, engineRegistry)
    expect(engineDrawnInputs(withPeriod, engineRegistry).get('rsi').period).toBe(7)
  })

  it('the three door-seven writers no longer stamp a key that does not exist', () => {
    // Presets and resetToDefaults spread CHART_DEFAULTS; the census pins the
    // sites. This asserts the PAYLOAD, which is what a user's blob receives.
    for (const payload of doorSevenPayloads()) {
      expect('engineEnabled' in payload).toBe(false)
    }
    // Non-vacuity: the census really found three payload sources.
    expect(doorSevenPayloads()).toHaveLength(5)   // 4 presets + CHART_DEFAULTS
  })

  it('ChartRender no longer writes the flag, and nothing in app/src does', () => {
    const hits = scanAppSrc(/engineEnabled/)      // comment-stripped, per sourceScan.js
    expect(hits).toEqual([])
  })
```

⚠️ `scanAppSrc` must use `sourceScan.stripComments` — B4 measured a source probe defeated by a comment (`useChartIndicatorBus()` mentioned in a comment kept a mount rail green). Add a positive control: a synthetic string containing `engineEnabled` in CODE must be found, and the same string inside a `//` comment must not.

- [ ] **Step 2: Run and watch every one fail**

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/engineEnabledMigration.test.js
```
Expected: FAIL — `'engineEnabled' in cs` is `true`; `engineDrawnInputs` returns an empty Map; `scanAppSrc` finds `ChartRender.jsx:236`.

- [ ] **Step 3: Delete it**

`chartDefaults.js` — remove the `engineEnabled: false` default and the merge line. `flipState.js` — `engineDrawnDefIds` and `engineDrawnInputs` lose their `cs.engineEnabled !== true` guards; replace each guard with the comment that says why it is gone:

```js
  // ⭐ B5 Task 4. The flag is DELETED, not flipped (docs/decisions/2026-08-04-
  // engine-enabled-deleted.md). It was read from the STORED BLOB, so it was false
  // for every user alive and flipping the default could not have healed one; and
  // its only remaining job was to distinguish migrated-but-un-flipped from
  // flipped, a state B5 never creates because it flips in the same commit it
  // migrates. A guard on a key that no longer exists is a guard that reads as
  // live logic, which is why it is gone rather than left `?? true`.
```

`StockChart.jsx` — `engineActive` becomes `ENGINE_FLIPPED_DEF_IDS.size > 0`; **delete `const engineOwned = engineOwnedDefIds(...)` at `:5918`** (the agent-verified fact: it has had zero readers since Flip B — the only occurrences of the identifier are the import and the assignment) and correct the five comments that still call it the arbiter. `ChartToolbar.jsx` — delete `engineInert` and `inertTitle` (`engineDrawn.has(k) && !FLIPPED.has(k)` has been identically false since B3 Task 11 and can never be true again).

⚠️ **`engineInert` has been retargeted four times and has a documented history of being vacuous.** Do not "keep it for later". Delete it, and put its reason in `ChartToolbar.jsx` at the site so the next reader does not reinvent it.

- [ ] **Step 4: Run to green, then run the WHOLE suite**

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/engineEnabledMigration.test.js
cd app && npx vitest run          # the tripwire — expect failures, read every one
```
B3's Flip B produced 44 failures of which 21 were one real defect and 23 were control rot; B4 produced 25 that were all rot. **Attribute every failure before fixing any of it.**

- [ ] **Step 5: Control audit — the flag's readers**

```bash
grep -rn "engineEnabled\|engineOn\|engineActive\|engineInert" app/src --include=*.js --include=*.jsx
```
Read each hit's stated REASON. Known rot, from the record itself:

| control | file | what happens | what to do |
|---|---|---|---|
| *"flipping the default does not heal a stored blob"* | `engineEnabledMigration.test.js` | asserts the CURRENT read | rewritten in Step 1, with the old rule kept as the thing that must no longer hold |
| *"a flag-off chart holding a live instance shows the toolbar NOTHING"* | ″ | there is no flag-off chart | invert: the toolbar shows the DRAWN inputs on every chart |
| *"the decision record is still OPEN"* | ″ | **stays green** — Task 9 resolves the record, not this task | leave it; assert it deliberately so the reader knows it was considered |
| the flag-off `engineDrawnInputs` divergence, *"asserted AS IT SHIPS"* | `ChartToolbar.engineInert.test.jsx` | its subject is deleted | delete the file's inert cases; the divergence no longer exists |
| `flipBStoredBlobs.test.jsx` (25 blobs) | | every case takes a different branch through `engineInstances` | re-run all 25 and assert the RENDER is unchanged; a blob's outcome must not move |
| `flipState.js:98-102`'s note that the `hidden` projection was deleted "precisely because the two sets were equal" | | still true | leave, verify |

- [ ] **Step 6: The decision record**

`docs/decisions/2026-08-04-engine-enabled-deleted.md`, id `ENGINE_ENABLED_DELETED`, `**Status:** ✅ APPLIED`. It carries: what deletion means at each of the six sites; **the July-blob table from §A2 of this plan, re-measured rather than copied**; the parity numbers with both build identities; and the list from the open record's §9 of what went red, marked closed one by one. ⚠️ It does **not** resolve `ENGINE_ENABLED_MIGRATION` — that record's Status stays OPEN until Task 9, because the migration it names is the whole of `cs.indicators`, not the flag. Say so in both files.

- [ ] **Step 7: Gate**

**Pixels: 0 changed, all 24 live cases, 5/5 runs, both identities named.** This is the most load-bearing zero in the plan before the cutover: `mergeChartSettings` is on every chart's path on every surface. Run it as a **real two-build A/B** (side A staged in place from `git show 084eeded:<path>`, `git diff --name-only 084eeded -- app/src` asserted empty before building, restored by two-directional sha256 — **no worktree, no `git stash`**), plus `--instances-side none` (the settings a real user has) and `--instances-side both`. Both fail-proofs, both exit 1, on this pair.

**Non-pixel assertions:** the five cases in Step 1; all 25 stored blobs render unchanged; the three door-7 payloads carry no `engineEnabled`; `controlDoorCensus.test.js` still finds exactly three whole-blob writers and its site set is unchanged; `scanAppSrc(/engineEnabled/)` is empty with its comment-stripping positive control green.

**Mutation gauntlet.** Selection: `src/components/chart/engine/__tests__/engineEnabledMigration.test.js src/components/chart/engine/__tests__/flipBStoredBlobs.test.jsx src/components/chart/engine/__tests__/controlDoorCensus.test.js src/components/chart/chartDefaults.test.js`

| # | file | mutation | `-t` filter | must exit 1 |
|---|---|---|---|---|
| M1 | `chartDefaults.js` | re-add `engineEnabled: false` to `CHART_DEFAULTS` | `NO engineEnabled key at all` | yes |
| M2 | ″ | re-add the merge line `engineEnabled: parsed.engineEnabled === true` | `explicitly stored engineEnabled:false is DROPPED` | yes |
| M3 | `flipState.js` | restore `if (cs.engineEnabled !== true) return EMPTY_INPUTS` in `engineDrawnInputs` | `shows the DRAWN inputs on every chart` | yes |
| M4 | `ChartRender.jsx` | restore the `engineEnabled: true` write | `nothing in app/src does` | yes |
| M5 | `engineEnabledMigration.test.js` | change `scanAppSrc`'s stripper to identity, and put `engineEnabled` in a COMMENT in `ChartRender.jsx` | `nothing in app/src does` | yes — **the comment-blindness control**, and it must be run as a PAIR: identity stripper ⇒ rc 1, real stripper ⇒ rc 0 |
| M6 | `StockChart.jsx` | `engineActive = ENGINE_FLIPPED_DEF_IDS.size > 0` → `= false` | *(unfiltered on `flipBStoredBlobs`)* | yes |
| M7 | `Settings.jsx` | hand-write `engineEnabled: false` into one preset payload | `door-seven writers no longer stamp` | yes |
| M8 | `engineEnabledMigration.test.js` | delete the `toHaveLength(5)` non-vacuity line, then make `doorSevenPayloads()` return `[]` | `door-seven writers no longer stamp` | yes — proves the loop cannot pass over nothing |

- [ ] **Step 8: Commit**

```bash
git add app/src/components/chart/chartDefaults.js \
        app/src/components/chart/engine/flipState.js \
        app/src/components/StockChart.jsx app/src/pages/ChartRender.jsx \
        app/src/components/chart/ChartToolbar.jsx app/src/pages/Settings.jsx \
        app/src/components/chart/ChartSettingsModal.jsx app/src/pages/charts/ChartsWorkspace.jsx \
        app/src/components/chart/engine/__tests__/ \
        docs/decisions/2026-08-04-engine-enabled-deleted.md
git commit -m "refactor(chart): engineEnabled is deleted, not flipped

The read was of the STORED BLOB, so the key was false for every user alive and
flipping the default could not heal one. Its only remaining job was to tell
migrated-but-un-flipped from flipped -- a state B5 never creates, because every
migration in this phase flips in the same commit. Deleted at all six sites,
including ChartRender's single write and ChartToolbar's engineInert, whose
predicate has been identically false since B3 Task 11. StockChart's `engineOwned`
went with it: zero readers since Flip B, five comments still calling it the
arbiter.

Landed HERE, before the migrations, because mergeChartSettings is on every
chart's path and this is the last commit in the phase at which a change to it can
be measured at 0 changed pixels.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `stoch` + `atr` — the first two of the ten, and three of the six legend chips

*(Solo. Owns `StockChart.jsx`, `flipState.js`, `chart_parity_cases.json`, `enumerationSites.test.js`.)*

Registry order 5 and 6. Both are pane oscillators, both are volume-overlay-eligible through `ensureIndTarget`, and both carry legend chips that today come from `legacyChipEntriesRef`.

**Files:**
- Create: `app/src/components/chart/engine/__tests__/stochAtrFlipParity.test.js`
- Modify: `app/src/components/chart/engine/flipState.js:102`, `:168`
- Modify: `app/src/components/StockChart.jsx` — delete `:6297-6341` (stoch) and `:6356-6382` (atr); the `stochKRef`/`stochDRef`/`atrRef` declarations; the `indicatorData` branches at `:4148` and `:4151`; their hide-all entries; the four `registerLegacyChip` calls at `:6330`, `:6331`, `:6339`, `:6340` and the two at `:6375`, `:6381`
- Modify: `tools/chart_parity_cases.json` — fill `stoch_only` and `atr_only`; add `engine_stoch_vs_legacy`, `engine_atr_vs_legacy`
- Modify: `app/src/components/chart/engine/__tests__/legendFromDefinitions.test.jsx`, `enumerationSites.test.js`

**Interfaces:**
- Consumes: `nativeRegistry`'s `stoch` (4 plots: `k`, `d` dashed, `overbought` hlines `[80]`, `oversold` hlines `[20]`; `fixedPane(0,100)`; `legend` on `k` = `{label:'%K', decimals:1}` and on `d` = `{label:'%D', decimals:1}`; **no `meta.legendParams`**, deliberate) and `atr` (1 plot; `autoPane`; `legend {decimals:4}`; `meta.legendParams: ['period']`).
- Produces: `ENGINE_MIGRATED_DEF_IDS` and `ENGINE_FLIPPED_DEF_IDS` both gain `'stoch'` and `'atr'`. Ledger: no row retires yet (rows 3–6 retire only when the LAST block goes, at Task 8).

- [ ] **Step 1: Write the transcription suite FIRST, and run it against the UN-migrated tree**

This is the step that makes the migration's pixel diff arrive early and for free. It copies the shipped `addSeries` / `applyIndScale` / `createPriceLine` option objects **verbatim** and asserts the engine would produce them.

```js
// ⚠️ toEqual over the FULL option object, never toMatchObject. A toMatchObject
// transcription passes with an extra `lastValueVisible: true` that moves pixels.
describe('stoch transcription — what the shipped block hands the renderer', () => {
  const SHIPPED_K = {
    color: cs.indicators.stoch.kColor, lineWidth: 1, priceScaleId: 'stoch',
    lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
  }
  const SHIPPED_D = { ...SHIPPED_K, color: cs.indicators.stoch.dColor, lineStyle: 2 }

  it('%K: the engine builds the shipped option object, key for key', () => {
    const def = engineRegistry.getDefinition('stoch')
    const plot = def.plots.find(p => p.key === 'k')
    expect(seriesOptionsForPlot(resolvePlotForInstance(plot, inputs), {
      scaleId: 'stoch', theme,
    })).toEqual(SHIPPED_K)
  })
  it('%D: including lineStyle 2, which is the only thing that distinguishes it', () => { /* … */ })
  it('the two guides are createPriceLine(80) and createPriceLine(20), with EVERY key stated', () => {
    // ⛔ An omitted createPriceLine option means LWC's DEFAULT, not "keep".
    // RSI's 50-line cost 379 px on exactly this.
    expect(guidesFor(def, inputs)).toEqual([
      { price: 80, color: '#787b86', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' },
      { price: 20, color: '#787b86', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' },
    ])
  })
  it('the band is the one computePaneMargins gives stoch, with the 0-100 range pinned', () => {
    const ctx = { paneMargins: computePaneMargins(cs, true, new Set()), volOverlaySet: new Set(),
                  volSeparatePane: false, VOL_PANE_INDEX: 1 }
    expect(resolvePlacement({ defId: 'stoch' }, def, ctx)).toEqual({
      paneIndex: 0, scaleId: 'stoch', autoscale: 'default',
      scaleOptions: { borderVisible: false, scaleMargins: ctx.paneMargins.stoch,
                      autoScale: false, minimum: 0, maximum: 100 },
    })
  })
})

describe('atr transcription', () => {
  it('one line, autoScale true, on the atr band', () => { /* full toEqual */ })
  it('and the volume-overlay path puts it on pane 1 / left with the shipped scaleOptions', () => {
    const ctx = { paneMargins: {}, volOverlaySet: new Set(['atr']),
                  volSeparatePane: true, VOL_PANE_INDEX: 1 }
    expect(resolvePlacement({ defId: 'atr' }, engineRegistry.getDefinition('atr'), ctx)).toEqual({
      paneIndex: 1, scaleId: 'left', autoscale: 'default',
      scaleOptions: { borderVisible: false, visible: true, autoScale: true,
                      scaleMargins: { top: 0.12, bottom: 0.04 } },
    })
  })
})
```

⚠️ **B3 recorded that no pilot ever gated the volume-pane OVERLAY placement path.** `stoch` and `atr` are both eligible for it and this is the first migration that can close that gap. The second `atr` case above is that gate; do not drop it.

- [ ] **Step 2: Run it BEFORE touching `StockChart.jsx`**

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/stochAtrFlipParity.test.js
```
Expected: **PASS**. A failure here is a definition-vs-shipped-block disagreement — that is the migration's pixel diff, arriving before the migration. Fix the *definition* to match what ships, never the other way, and if the definition is right and the shipped block is wrong, that is a flagged decision in its own commit (the `MACD_HEAD_MASK` mechanism), not something to fold in.

- [ ] **Step 3: Migrate and flip, in ONE commit**

```js
export const ENGINE_MIGRATED_DEF_IDS = sealedSet(['rsi', 'bb', 'macd', 'vwap', 'stoch', 'atr'])
export const ENGINE_FLIPPED_DEF_IDS  = sealedSet(['rsi', 'bb', 'macd', 'vwap', 'stoch', 'atr'])
```

then delete both render blocks, both sets of refs, both `indicatorData` branches, both hide-all entries, and **all six `registerLegacyChip` calls for these two definitions** — the three registrations and the three matching `null` clears. The chips do not disappear: `binder.bindings()` now supplies `stoch::k`, `stoch::d` and `atr::atr` to the same `chipsFrom` pipeline, from the same `plots[].legend` blocks.

⛔ **Do not delete the `registerLegacyChip` helper or `legacyChipEntriesRef`** — `sar` and `ichimoku` still use them until Task 6.

- [ ] **Step 4: Prove no chip was lost, in the DOM**

Extend `legendFromDefinitions.test.jsx`:

```js
  it('all nine chips still render, character for character, after stoch and atr migrate', async () => {
    // The nine expectations are parsed from `git show d2733adc`'s OWN legChips
    // array and have not been re-typed. This case has run green at every commit
    // since B4 Task 10; the migration must not be the one that changes it.
    const chips = await settledLegend(H)
    expect(chips.map(c => c.textContent)).toEqual(SHIPPED_NINE)
  })

  it('and %K, %D and ATR now come from the ENGINE lane, not from legacyChipEntriesRef', async () => {
    // ⭐ The SOURCE flips even though the TEXT does not. Without this the
    // migration could have left the legacy registration in place and the chip
    // would be drawn twice with one on top of the other — invisible in text.
    expect(H.legacyChipKeys()).toEqual(['sar::sar', 'ichimoku::tenkan', 'ichimoku::kijun'])
    expect(H.engineChipKeys()).toEqual(expect.arrayContaining(['stoch::k', 'stoch::d', 'atr::atr']))
  })

  it('ATR still prints its period, because the DEFINITION declares legendParams', async () => {
    expect(chipTextFor('atr')).toMatch(/^ATR\(14\) -?\d+\.\d{4}$/)
  })

  it('and %K/%D still print NO period, because stoch declares none — deliberately', async () => {
    expect(chipTextFor('stoch::k')).toMatch(/^%K -?\d+\.\d$/)
  })
```

- [ ] **Step 5: Control audit**

```bash
grep -rn "'stoch'\|\"stoch\"\|'atr'\|\"atr\"" app/src --include=*.js --include=*.jsx | grep -i "test\|__tests__"
```
Known rot, from the code as it stands:

| control | what happens | what to do |
|---|---|---|
| `enumerationSites.test.js:606-608` — *"stoch, atr, sar, ichimoku are NOT migrated"* | goes **RED** | invert to *"stoch and atr ARE migrated; sar and ichimoku are not yet"*, and keep it failable both ways |
| `enumerationSites.test.js:599-603` — the declared-chip assertion over six legacy + three engine chips | goes **RED** | move three ids from the legacy side to the engine side |
| `readout.js:26-35` — the six legacy chips named in PROSE so the discovery scan does not flag the file | **stays green while false** | rewrite to the three that remain; re-run the discovery scan and confirm `readout.js` is still unflagged |
| `instances.test.js` — *"the nine oscillators"* | check | still nine; `stoch`/`atr` moved lane, not category |
| `binder.js:383-392` — the `moveToPane` z-order note naming the day it expires | check | not yet; it expires at Task 10 |
| `indicatorCatalog.unwiredKeys` totality (`ichimoku` is the ONLY one) | **stays green** | verify by hand — neither `stoch` nor `atr` has an unwired key, so this is genuinely unchanged, and say so |

- [ ] **Step 6: Fill the parity cases**

`stoch_only` and `atr_only` lose `status: "placeholder"` and gain real settings; add `engine_stoch_vs_legacy` and `engine_atr_vs_legacy` with `instancesB`. Each `why` states the regression class it alone can see (for `engine_atr_vs_legacy`: *"the only case that renders an `autoScale: true` oscillator band through the engine"*).

- [ ] **Step 7: Gate**

**Pixels: 0 changed, all cases (24 live + the 4 new = 28), 5/5, both identities named.** Run `--instances-side none`, then `--instances-side both`, then the two engine cases. Then the **period** perturbation, which is the one that distinguishes a live compute path from a dead one:

```bash
python tools/chart_parity.py --base-a $A --base-b $B --dist-a .parity-dist-a --dist-b .parity-dist-b \
    --cases engine_stoch_vs_legacy --perturb-b-instances '{"kPeriod": 21}'     # expect non-zero, exit 1
python tools/chart_parity.py --base-a $A --base-b $B --dist-a .parity-dist-a --dist-b .parity-dist-b \
    --cases engine_atr_vs_legacy --perturb-b-instances '{"period": 21}'        # expect non-zero, exit 1
```
⚠️ **A colour-only perturbation is not enough** — periods appear in NO option object, so a colour perturb cannot tell a live compute from a replay. BB (8,534 px on `period`) and MACD (7,588 px on `slowPeriod`) are the precedent. Record every number with both identities.

**Non-pixel assertions:** the transcription suite (full-object `toEqual`); the volume-overlay placement path; the nine chips character-for-character; the chip SOURCE flip; mid-session arrival AND departure for both ids (an instance appearing mid-session must not leave a dead legacy line — B3's M8 shape, which survived once on RSI and once on BB); `#2049` — a colour change and a period change RESTYLE the same series object and `H.removedSeries` stays empty.

**Mutation gauntlet.** Selection: `src/components/chart/engine/__tests__/stochAtrFlipParity.test.js src/components/chart/engine/__tests__/legendFromDefinitions.test.jsx src/components/chart/engine/__tests__/stockChartWiring.test.jsx src/components/chart/engine/__tests__/enumerationSites.test.js`

| # | file | mutation | `-t` filter | must exit 1 |
|---|---|---|---|---|
| M1 | `nativeRegistry.js` | `stoch.d`'s `lineStyle: 'dashed'` → `'solid'` | `lineStyle 2, which is the only thing` | yes |
| M2 | ″ | drop `stoch`'s `oversold` hlines plot | `createPriceLine\(80\) and createPriceLine\(20\)` | yes |
| M3 | ″ | `atr`'s `meta.legendParams: ['period']` → `[]` | `prints its period` | yes |
| M4 | ″ | ADD `meta.legendParams: ['kPeriod']` to `stoch` | `print NO period` | yes — the absence is deliberate and must be held from both sides |
| M5 | `flipState.js` | add `'stoch'` to MIGRATED only | *(unfiltered)* | yes — `flipB.test.jsx`'s both-ways equality and the no-strand rail |
| M6 | `StockChart.jsx` | restore the `registerLegacyChip('stoch','k',…)` registration alongside the engine binding | `come from the ENGINE lane` | yes — a chip drawn twice is invisible in text |
| M7 | ″ | hoist the removal guard so the `else` branch is unreachable (B3's M8 shape) | `mid-session` | yes |
| M8 | `placement.js` | volume-overlay branch: `scaleId: 'left'` → `'right'` | `volume-overlay path puts it on pane 1` | yes — the path B3 never gated |
| M9 | `enumerationSites.test.js` | revert the Step-5 inversion to *"stoch is NOT migrated"* | `no migrated-but-un-flipped` | **must exit 0** — a designed survivor: that rail is about the flip sets, not this assertion. Record it with its reason. |
| M10 | `readout.js` | put `stoch::k` back into the prose comment as `<defId>::<plotKey>` | *(the discovery scan, unfiltered)* | yes — proves the scan's comment-stripping is still what keeps the file unflagged |

- [ ] **Step 8: Commit**

```bash
git add app/src/components/chart/engine/flipState.js \
        app/src/components/chart/engine/__tests__/ \
        app/src/components/StockChart.jsx tools/chart_parity_cases.json
git commit -m "feat(chart): stoch and atr are engine-drawn -- migrated and flipped together

Registry order 5 and 6. Both blocks deleted with their refs, their indicatorData
branches, their hide-all entries and their six registerLegacyChip calls; the three
chips they carried now come from the same plots[].legend blocks through the same
chipsFrom pipeline, and the nine rendered chips are asserted character for
character before and after. Closes the volume-pane OVERLAY placement path, which
no B3 pilot ever gated. Migrated and flipped in one commit, per the runbook rule
and the open engineEnabled record.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `sar` + `ichimoku` — the first `markers` plot, five plots, and the last three chips

*(Solo. Owns `StockChart.jsx`, `flipState.js`, `chart_parity_cases.json`, `enumerationSites.test.js`.)*

Registry order 7 and 8, and they must land in that order relative to each other and to `bb`/`vwap` — LWC z-stacks by insertion and the engine's `binder.sync()` runs before every remaining legacy block. This is the highest-risk pair in the phase before the cutover: `sar` is the first `markers` plot the binder has ever created, and `ichimoku` is five plots, two chips, and three inputs the settings blob does not carry.

**Files:**
- Create: `app/src/components/chart/engine/__tests__/sarIchimokuFlipParity.test.js`
- Modify: `app/src/components/chart/engine/flipState.js`
- Modify: `app/src/components/StockChart.jsx` — delete `:6384-6411` (sar), `:6413-6453` (ichimoku), their refs, `indicatorData` branches at `:4154`/`:4157`, hide-all entries, and the six `registerLegacyChip` calls at `:6404`, `:6410`, `:6445`, `:6446`, `:6451`, `:6452` — **and then `registerLegacyChip` itself and `legacyChipEntriesRef`, which have no callers left**
- Modify: `app/src/components/chart/indicatorCatalog.js` (`unwiredKeys` / `NOT_IN_BLOB`)
- Modify: `tools/chart_parity_cases.json`, `legendFromDefinitions.test.jsx`, `enumerationSites.test.js`

**Interfaces:**
- Consumes: `sar` (1 `markers` plot, `width: 3` = dot radius; `onPrice`; `legend {decimals:4}`, no label — `meta.shortName` 'SAR' is the whole label) and `ichimoku` (5 line plots `tenkan`, `kijun`, `spanA`, `spanB`, `chikou` (dashed); `onPrice`; `legend` on `tenkan` = `{label:'TK', decimals:2}` and `kijun` = `{label:'KJ', decimals:2}`; **`spanA`/`spanB`/`chikou` declare NO legend block, explicitly**).
- Produces: both sets gain `'sar'` and `'ichimoku'`; `legacyChipEntriesRef` and `registerLegacyChip` are **gone**; `unwiredKeys` returns an empty map for every definition.

- [ ] **Step 1: Write the transcription suite, and run it before touching anything**

```js
describe('sar transcription — the first markers plot the engine has ever bound', () => {
  it('lineWidth 0 + point markers is what a "markers" plot MEANS here', () => {
    // The shipped block draws SAR as a LineSeries with lineWidth 0 and visible
    // point markers. `poolKey('markers') === 'line'`, so the pool re-purposes it
    // as a line — which is why the option set has to be COMPLETE: pool.js has a
    // MEASURED leak of `pointMarkersVisible` from `sar` into `rsi`.
    expect(seriesOptionsForPlot(plotFor('sar', 'sar'), { scaleId: 'right', theme })).toEqual({
      color: cs.indicators.sar.color, lineWidth: 0, priceScaleId: 'right',
      pointMarkersVisible: true, pointMarkersRadius: 3,
      lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
    })
  })
  it('and it is autoscale-EXCLUDED, like every price overlay', () => {
    expect(resolvePlacement({ defId: 'sar' }, def('sar'), ctx).autoscale).toBe('exclude')
  })
  it('a pooled series re-purposed FROM sar does not keep its point markers', () => {
    // The complete-key-set rule, on the exact pair pool.js measured.
    const opts = seriesOptionsForPlot(plotFor('rsi', 'rsi'), { scaleId: 'rsi', theme })
    expect(opts.pointMarkersVisible).toBe(false)
    expect(opts.lineWidth).toBe(cs.indicators.rsi.lineWidth ?? 1)
  })
})

describe('ichimoku transcription — five plots, two chips, one shifted series', () => {
  it.each(['tenkan', 'kijun', 'spanA', 'spanB', 'chikou'])('%s: full option object', (k) => { /* toEqual */ })
  it('chikou is the dashed one and NOTHING else differs', () => { /* … */ })
  it('all five are autoscale-EXCLUDED — the shipped block passes () => null on every one', () => {
    for (const k of ['tenkan', 'kijun', 'spanA', 'spanB', 'chikou']) {
      expect(seriesOptionsForPlot(plotFor('ichimoku', k), ctx).autoscaleInfoProvider).toBe(AUTOSCALE_EXCLUDE)
    }
  })
  it('the five series are created in DECLARATION order, which is the shipped order', () => {
    // LWC z-stacks by insertion. The cloud edges must not swap.
    expect(H.addSeriesOrder().filter(k => k.startsWith('ichimoku')))
      .toEqual(['ichimoku::tenkan', 'ichimoku::kijun', 'ichimoku::spanA', 'ichimoku::spanB', 'ichimoku::chikou'])
  })
})

describe('the price overlays keep their z-order across the migration', () => {
  it('bb, vwap, sar, ichimoku are inserted in registry order and donchian is still legacy-last', () => {
    // ⭐ The reason this task cannot be reordered with Task 8 (plan A3).
    expect(H.priceOverlayInsertionOrder()).toEqual(['bb', 'vwap', 'sar', 'ichimoku', 'donchian'])
  })
})
```

- [ ] **Step 2: Run it against the un-migrated tree**

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/sarIchimokuFlipParity.test.js
```
Expected: **PASS**, except the z-order case, which asserts the post-migration order and fails until Step 3. Split it into its own `describe` and mark it `.todo` → un-todo it in Step 3, or write it as two cases (before/after). Do not leave it green-because-unreached.

- [ ] **Step 3: Migrate, flip, and delete the legacy chip machinery**

Add `'sar'` then `'ichimoku'` to both sets (order in the literal does not matter; the *task* order does). Delete both blocks, refs, `indicatorData` branches, hide-all entries and all six `registerLegacyChip` calls — **and then delete `registerLegacyChip` (`StockChart.jsx:2070-2074`), `legacyChipEntriesRef` (`:2067-2068`), `csIndicatorsRef`'s legend role (`:2078`) and the dependency-array entry at `:7104`.** With zero callers they are dead code, and dead code that used to be a mechanism reads as a mechanism.

- [ ] **Step 4: Ichimoku gains a developing-bar fallback — assert it as a NAMED change**

```js
  it('TK and KJ now print a value on the developing bar, which they never did before', async () => {
    // ⭐ B5 A4, and it is a BEHAVIOUR CHANGE, not an incidental. StockChart
    // registered ichimoku::tenkan and ::kijun with a series and NO THUNK
    // (:6445-6446), so on the newest bar — the one the bars-push writer appends
    // before the indicator series has a point — the legacy chips printed nothing.
    // The engine lane's lastValue is a NUMBER, so they print. This is the same
    // gap B3 closed for RSI as review finding I-3; every other chip already has
    // it; and the pixel gate cannot see any of it, which is why this case exists.
    const H = await renderWithDevelopingBar(['ichimoku'])
    expect(chipTextFor('ichimoku::tenkan')).toMatch(/^TK -?\d+\.\d{2}$/)
    // The control that this is the DEVELOPING bar and not just "a bar":
    expect(H.seriesDataHas('ichimoku::tenkan', H.newestBarTime())).toBe(false)
  })

  it('and spanA, spanB and chikou still emit NO chip, because they declare no legend block', async () => {
    expect(H.chipKeys()).not.toContain('ichimoku::spanA')
    expect(H.chipKeys()).not.toContain('ichimoku::spanB')
    expect(H.chipKeys()).not.toContain('ichimoku::chikou')
    // Non-vacuity: the three series EXIST, they just do not chip.
    expect(H.seriesKeys()).toEqual(expect.arrayContaining(
      ['ichimoku::spanA', 'ichimoku::spanB', 'ichimoku::chikou']))
  })
```

- [ ] **Step 5: `unwiredKeys` becomes empty, and its totality assertion inverts**

B4's `unwiredKeys(def, flippedIds)` returns an empty Set for a **flipped** definition, and `ichimoku`'s three inputs (`tenkanPeriod`, `kijunPeriod`, `senkouBPeriod`) were the ONLY greyed ones in the whole app. Flipping `ichimoku` makes them live: the instance carries them from the definition's declared defaults, so they become editable and they reach compute.

⚠️ **`CHART_DEFAULTS.indicators.ichimoku` does not carry them**, and `computeIchimoku(filteredBars)` is called with **no arguments** in the legacy memo. So the legacy lane ignored them entirely. After the flip the engine passes the instance's inputs to `compute`. **Verify against `indicators.js` what `computeIchimoku` does with arguments** before assuming the three become functional — if the compute function ignores them, they must be marked `activeWhen: false` on the definition rather than shown as live controls that do nothing, and that is a one-line change plus a case.

```js
  it('nothing is greyed any more, and that is because everything is flipped', () => {
    expect(unwiredMapForEveryDefinition()).toEqual({})
    // The control: the predicate is not simply broken. With an EMPTY flipped set
    // it still finds ichimoku's three.
    expect([...unwiredKeys(def('ichimoku'), new Set())]).toEqual(
      ['tenkanPeriod', 'kijunPeriod', 'senkouBPeriod'])
  })
```

- [ ] **Step 6: Control audit**

| control | what happens | what to do |
|---|---|---|
| `enumerationSites.test.js:606-608` (as inverted by Task 5) | goes **RED** | invert again: all four are now migrated |
| the declared-chip assertion | goes **RED** | the legacy side is now EMPTY; assert that, and assert `legacyChipEntriesRef` no longer exists |
| `readout.js:26-35`'s prose comment about six legacy chips | **stays green while false** | rewrite: there are none; the legacy lane of `chipsFrom` now has no producer, and say whether the second-source parameter should go too (it should not — Phase C's server lane is its next user; say so, or delete it) |
| `indicatorCatalog`'s `unwiredKeys` totality (`toEqual` on the whole map, ichimoku the only one) | goes **RED** | inverted in Step 5 with the empty-set control |
| `generatedSettingsRows.test.jsx` — ichimoku's three greyed rows | goes **RED** | they are live rows now; assert they write through `instanceControls` and that the value reaches compute |
| `binder.js:383-392` z-order note naming `vwap/sar/ichimoku/donchian` | **stays green while false** for two of the four | narrow it to `donchian`, and to Task 10 |
| `stockChartWiring.test.jsx`'s *"NON-migrated indicator chip"* control (re-pointed at ATR by B3 Task 6) | already moved by Task 5 | verify its subject is still un-migrated; after Task 8 it has **no** valid subject and must move down a level to the flip-set filter, exactly as B3 Task 8 did for `engineInert` |

- [ ] **Step 7: Gate**

**Pixels: 0 changed, all cases (28 + 4 new = 32), 5/5, both identities.** Fill `sar_only` and `ichimoku_only`; add `engine_sar_vs_legacy` and `engine_ichimoku_vs_legacy`. Plus the case that only this task can add:

```jsonc
{ "name": "engine_price_overlay_zorder",
  "why": "the ONLY case where four engine price overlays and one LEGACY price overlay share pane 0's right scale — it is what sees an insertion-order inversion between bb/vwap/sar/ichimoku and donchian. engine_bb_over_overlays sees the call SITE; this sees the ORDER.",
  "settings": { "indicators": { "bb": {"enabled": true}, "vwap": {"enabled": true},
                                "sar": {"enabled": true}, "ichimoku": {"enabled": true},
                                "donchian": {"enabled": true} } },
  "tf": "5", "fixedbars": "intraday5m" }
```
Perturbations: `--perturb-b-instances '{"step": 0.04}'` on `engine_sar_vs_legacy` and `'{"conversionPeriod": 18}'` on `engine_ichimoku_vs_legacy` — **not** colour.

**Non-pixel assertions:** the full transcription suite; the pooled-`sar`-to-`rsi` complete-key-set case; the five-series declaration order; the developing-bar chip change with its non-vacuity control; the three no-chip plots with their series-exist control; `unwiredKeys` empty with its empty-set control; `registerLegacyChip` and `legacyChipEntriesRef` are gone (a source probe on the **identifiers**, comment-stripped).

**Mutation gauntlet.** Selection: `src/components/chart/engine/__tests__/sarIchimokuFlipParity.test.js src/components/chart/engine/__tests__/legendFromDefinitions.test.jsx src/components/chart/engine/pool.test.js src/components/chart/indicatorCatalog.test.js`

| # | file | mutation | `-t` filter | must exit 1 |
|---|---|---|---|---|
| M1 | `nativeRegistry.js` | `sar`'s plot `style: 'markers'` → `'line'` | `lineWidth 0 \+ point markers` | yes |
| M2 | `pool.js` | drop `pointMarkersVisible` from the line pool key's complete set | `does not keep its point markers` | yes |
| M3 | `nativeRegistry.js` | swap `spanA` and `spanB` in `ichimoku.plots` | `created in DECLARATION order` | yes |
| M4 | `flipState.js` | put `'ichimoku'` before `'sar'` **and** reorder `RAW_DEFS` so ichimoku precedes sar | `inserted in registry order` | yes |
| M5 | `nativeRegistry.js` | give `spanA` a `legend` block | `still emit NO chip` | yes |
| M6 | `readout.js` | make the engine lane's `lastValue` a thunk that returns `null` | `print a value on the developing bar` | yes |
| M7 | `indicatorCatalog.js` | `unwiredKeys` returns `new Set()` unconditionally | `nothing is greyed any more` | yes — kills the **control**, not the claim, which is the half that can rot |
| M8 | `StockChart.jsx` | re-add `registerLegacyChip` as a no-op function with no callers | `registerLegacyChip.*gone` | yes — the identifier probe, which is the only thing that can see a dead mechanism |
| M9 | `nativeRegistry.js` | `ichimoku.chikou`'s `lineStyle: 'dashed'` → `'solid'` | `chikou is the dashed one` | yes |

- [ ] **Step 8: Commit**

```bash
git add app/src/components/chart/engine/flipState.js app/src/components/chart/engine/__tests__/ \
        app/src/components/StockChart.jsx app/src/components/chart/indicatorCatalog.js \
        tools/chart_parity_cases.json
git commit -m "feat(chart): sar and ichimoku are engine-drawn; the legacy chip registry is gone

Registry order 7 and 8, and they must land in that order -- LWC z-stacks by
insertion and binder.sync() runs before every remaining legacy block. sar is the
first `markers` plot the binder has ever created, which is why the complete
option key set is asserted on the exact pool pair (sar -> rsi) that leaked
pointMarkersVisible. With these two, all six registerLegacyChip registrations are
retired and legacyChipEntriesRef has no callers, so both are deleted.

ONE NAMED BEHAVIOUR CHANGE: ichimoku's TK and KJ chips now print on the developing
bar. They never did -- the shipped registration passed no thunk -- and every other
chip already does. Invisible to every pixel case; asserted in the DOM with the
control that it really is the developing bar.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `mfi` + `cci` + `williamsR` — three single-line oscillators, three different guide shapes

*(Solo. Owns `StockChart.jsx`, `flipState.js`, `chart_parity_cases.json`, `enumerationSites.test.js`.)*

Registry order 9, 10 and 11. Structurally identical — one line plot plus `hlines` guides — which is why they are one task, and their differences are entirely in the guides and the scale, which is where a transcription error hides.

| id | scale | plots | guides |
|---|---|---|---|
| `mfi` | `fixedPane(0, 100)` | `mfi` (line) + `bands` | `[80, 20]` |
| `cci` | `autoPane` (`autoScale: true`) | `cci` (line) + `bands` + `zero` | `[100, -100]` and `[0]` with `largeDashed` |
| `williamsR` | `fixedPane(-100, 0)` | `williams_r` (line — **snake_case plot key**) + `bands` | `[-20, -80]` |

**Files:**
- Create: `app/src/components/chart/engine/__tests__/mfiCciWilliamsFlipParity.test.js`
- Modify: `app/src/components/chart/engine/flipState.js`
- Modify: `app/src/components/StockChart.jsx` — delete `:6455-6477` (mfi), `:6479-6502` (cci), `:6504-6526` (williamsR); their refs; `indicatorData` branches at `:4160`, `:4163`, `:4166`; their hide-all entries
- Modify: `tools/chart_parity_cases.json`, `enumerationSites.test.js`

**Interfaces:**
- Consumes: the three definitions as tabled above. **None of them declares a `legend` block**, so none produces a chip on either lane — that is the shipped behaviour and it is transcribed, not improved.
- Produces: both flip sets gain `'mfi'`, `'cci'`, `'williamsR'`.

- [ ] **Step 1: Write the transcription suite and run it against the un-migrated tree**

```js
const GUIDE = (price, extra = {}) => ({
  price, color: '#787b86', lineWidth: 1, lineStyle: 2,
  axisLabelVisible: false, title: '', ...extra,
})

describe('the three single-line oscillators, transcribed', () => {
  it('mfi: two guides at 80 and 20, on a 0-100 pinned scale', () => {
    expect(guidesFor('mfi')).toEqual([GUIDE(80), GUIDE(20)])
    expect(resolvePlacement({ defId: 'mfi' }, def('mfi'), ctx).scaleOptions).toEqual({
      borderVisible: false, scaleMargins: ctx.paneMargins.mfi,
      autoScale: false, minimum: 0, maximum: 100,
    })
  })

  it('cci: THREE guides, and the zero line is largeDashed while the bands are not', () => {
    // ⛔ An omitted createPriceLine option means LWC's DEFAULT, not "keep what's
    // there". RSI's 50-line cost 379 changed pixels on exactly this distinction,
    // and cci is the only definition in the registry with two guide STYLES.
    expect(guidesFor('cci')).toEqual([GUIDE(100), GUIDE(-100), GUIDE(0, { lineStyle: 3 })])
  })

  it('cci is autoScale TRUE — it is the only unbounded one of the three', () => {
    expect(resolvePlacement({ defId: 'cci' }, def('cci'), ctx).scaleOptions).toEqual({
      borderVisible: false, scaleMargins: ctx.paneMargins.cci, autoScale: true,
    })
  })

  it('williamsR: the scale is -100..0, NOT 0..100, and the plot key is snake_case', () => {
    // The registry key is `williams_r` while the settings key is `williamsR`.
    // A migration that quietly harmonises them binds nothing and reports 0 px,
    // because a definition with no matching column produces no data.
    expect(def('williamsR').plots.map(p => p.key)).toEqual(['williams_r', 'bands'])
    expect(resolvePlacement({ defId: 'williamsR' }, def('williamsR'), ctx).scaleOptions).toEqual({
      borderVisible: false, scaleMargins: ctx.paneMargins.williamsR,
      autoScale: false, minimum: -100, maximum: 0,
    })
    expect(guidesFor('williamsR')).toEqual([GUIDE(-20), GUIDE(-80)])
  })

  it('and none of the three declares a legend block, so none adds a chip', () => {
    for (const id of ['mfi', 'cci', 'williamsR']) {
      expect(def(id).plots.filter(p => p.legend)).toEqual([])
    }
    // The control that this assertion can fail: rsi DOES declare one.
    expect(def('rsi').plots.filter(p => p.legend)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run it**

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/mfiCciWilliamsFlipParity.test.js
```
Expected: **PASS** on the un-migrated tree. A failure is the migration's pixel diff arriving early.

- [ ] **Step 3: Migrate and flip all three, in one commit**

```js
export const ENGINE_MIGRATED_DEF_IDS = sealedSet(
  ['rsi', 'bb', 'macd', 'vwap', 'stoch', 'atr', 'sar', 'ichimoku', 'mfi', 'cci', 'williamsR'])
export const ENGINE_FLIPPED_DEF_IDS  = sealedSet(
  ['rsi', 'bb', 'macd', 'vwap', 'stoch', 'atr', 'sar', 'ichimoku', 'mfi', 'cci', 'williamsR'])
```

then delete the three blocks, the three ref declarations, the three `indicatorData` branches and the three hide-all entries.

- [ ] **Step 4: Run to green, then the whole suite as a tripwire**

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/mfiCciWilliamsFlipParity.test.js
cd app && npx vitest run
```
Attribute every failure before fixing any. Three migrations in one commit means three times the control rot; do not batch the fixes without reading each stated reason.

- [ ] **Step 5: Control audit**

```bash
grep -rn "mfi\|cci\|williamsR\|williams_r" app/src --include=*.js --include=*.jsx | grep -i "test\|__tests__"
```

| control | what happens | what to do |
|---|---|---|
| `enumerationSites.test.js`'s not-migrated list | goes **RED** | narrow to `adx`, `obv`, `donchian` |
| `pool.test.js`'s measured leak `stoch.d → mfi.mfi` (`lineStyle: 2`) | **stays green and its premise is now stronger, not weaker** | both ends are engine-bound now; re-run and assert the leak case still names two ENGINE definitions, so the case is not quietly testing a lane that no longer exists |
| `instances.test.js` — *"the nine oscillators"* | check | still nine |
| `stockChartWiring.test.jsx`'s *"NON-migrated indicator chip"* control | its subject (`atr`) migrated at Task 5 | it must already have moved; if it is still green on `atr`, it is **green-while-false** and the audit missed it at Task 5 — fix it here and record the miss |
| `indicatorCatalog.oscillatorIds` (`placement.target === 'pane'`) | check | unchanged; these three were always `pane` |

- [ ] **Step 6: Gate**

**Pixels: 0 changed, all cases (32 + 6 new = 38), 5/5, both identities.** Fill `mfi_only`, `cci_only`, `williams_r_only`; add `engine_mfi_vs_legacy`, `engine_cci_vs_legacy`, `engine_williams_r_vs_legacy`. Period perturbations on all three (`{"period": 21}`), each expected non-zero and exit 1.

Add one case this task alone can add:

```jsonc
{ "name": "engine_three_bands_stacked",
  "why": "mfi + cci + williamsR together are the only case with THREE adjacent oscillator bands whose scales differ (0..100 pinned, autoScale, -100..0 pinned). It is what sees a band mis-stacked by one slot or a scale range leaking between adjacent price scales.",
  "settings": { "indicators": { "mfi": {"enabled": true}, "cci": {"enabled": true},
                                "williamsR": {"enabled": true} } } }
```

**Non-pixel assertions:** the transcription suite (all five cases); mid-session arrival AND departure for each of the three; `#2049` (colour and period restyle the same series; `H.removedSeries` empty); the three declare no legend block and the nine rendered chips are still the nine.

**Mutation gauntlet.** Selection: `src/components/chart/engine/__tests__/mfiCciWilliamsFlipParity.test.js src/components/chart/engine/__tests__/stockChartWiring.test.jsx src/components/chart/engine/pool.test.js`

| # | file | mutation | `-t` filter | must exit 1 |
|---|---|---|---|---|
| M1 | `nativeRegistry.js` | `cci`'s `zero` plot `lineStyle: 'largeDashed'` → `'dashed'` | `zero line is largeDashed` | yes |
| M2 | ″ | delete `cci`'s `zero` plot entirely | `THREE guides` | yes |
| M3 | ″ | `williamsR`'s `placement.scale` `{min:-100,max:0}` → `{min:0,max:100}` | `scale is -100\.\.0` | yes |
| M4 | ″ | rename plot key `williams_r` → `williamsR` | `snake_case` | yes — **and note what it costs**: with the key harmonised the column lookup misses, the plot binds nothing, and the parity case would read **0 px** because neither side draws. The unit case is the only gate. |
| M5 | ″ | `mfi`'s guides `[80, 20]` → `[70, 30]` | `two guides at 80 and 20` | yes |
| M6 | `pool.js` | drop `lineStyle` from the line pool key's complete set | *(the `stoch.d → mfi` leak case in `pool.test.js`)* | yes |
| M7 | `flipState.js` | add all three to MIGRATED only | *(unfiltered)* | yes |
| M8 | `StockChart.jsx` | hoist the removal guard so the `else` is unreachable | `mid-session` | yes |
| M9 | `mfiCciWilliamsFlipParity.test.js` | make `guidesFor` return `[]` for an unknown id, and pass `'mfiX'` | `two guides at 80 and 20` | yes — proves the helper THROWS on a miss rather than looping over nothing (B4 measured a "throws by name on zero matches" guarantee that was simply false) |

- [ ] **Step 7: Commit**

```bash
git add app/src/components/chart/engine/flipState.js app/src/components/chart/engine/__tests__/ \
        app/src/components/StockChart.jsx tools/chart_parity_cases.json
git commit -m "feat(chart): mfi, cci and williamsR are engine-drawn

Registry order 9, 10 and 11 -- three single-line oscillators whose only real
differences are in their guides and their scales, which is exactly where a
transcription error hides: cci is the only definition with two guide STYLES
(largeDashed zero, dashed bands) and the only unbounded one of the three, and
williamsR's plot key is snake_case while its settings key is not. A migration
that harmonised that key would bind nothing and the parity case would report 0
changed pixels, because neither side would draw.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: `adx` + `obv` + `donchian` — the last three, and the four StockChart ledger rows retire

*(Solo. Owns `StockChart.jsx`, `flipState.js`, `chart_parity_cases.json`, `enumerationSites.test.js`.)*

Registry order 12, 13 and 14. `adx` is a three-line oscillator sharing one scale; `obv` is the one definition whose values run to the hundreds of millions, so it is the case that actually exercises the autoscale seam on a real scale; `donchian` is the **last** price overlay, which is why it lands last (A3) and why its `band` plot with `edges` is safe here and would not have been earlier.

When this task lands, **there is not one hand-written indicator render block left in `StockChart.jsx`** — which retires ledger rows 3, 4, 5 and 6 together, because they were one mechanism.

**Files:**
- Create: `app/src/components/chart/engine/__tests__/adxObvDonchianFlipParity.test.js`
- Modify: `app/src/components/chart/engine/flipState.js`
- Modify: `app/src/components/StockChart.jsx` — delete `:6528-6567` (adx), `:6569-6589` (obv), `:6591-6614` (donchian); **then the whole `indicatorData` memo `:4134-4216`, the whole series-`useRef` block, the whole hide-all ref array**, and the ten `compute*` imports that now have no callers
- Modify: `app/src/components/chart/engine/__tests__/enumerationSites.test.js` — **SITE_COUNT 15 → 11**, drop rows 3–6, add a `RETIRED_BY_B5_TASK8` proof block
- Modify: `tools/chart_parity_cases.json`

**Interfaces:**
- Consumes: `adx` (4 plots: `adx` line `width:2`, `plusDI`, `minusDI`, `trend` hlines `[25]`; `fixedPane(0,100)`), `obv` (1 line; `autoPane`), `donchian` (3 plots: `upper` line solid, `middle` **band with `edges: {upper, lower}`**, `lower` line solid; `onPrice`).
- Produces: both flip sets contain all fourteen series-expressible definitions. `ENGINE_FLIPPED_DEF_IDS.size === 14` and `listDefinitions().length === 14` are equal — asserted, because that equality is what Task 13 deletes the sets in favour of.

- [ ] **Step 1: Write the transcription suite and run it against the un-migrated tree**

```js
describe('adx — three lines, one scale, one guide', () => {
  it('all three lines share the adx price scale and only ADX is width 2', () => {
    expect(['adx', 'plusDI', 'minusDI'].map(k =>
      seriesOptionsForPlot(plotFor('adx', k), { scaleId: 'adx', theme }).lineWidth))
      .toEqual([2, 1, 1])
    expect(['adx', 'plusDI', 'minusDI'].map(k =>
      seriesOptionsForPlot(plotFor('adx', k), { scaleId: 'adx', theme }).priceScaleId))
      .toEqual(['adx', 'adx', 'adx'])
  })
  it('one guide at 25, and the scale is pinned 0..100', () => {
    expect(guidesFor('adx')).toEqual([GUIDE(25)])
    expect(resolvePlacement({ defId: 'adx' }, def('adx'), ctx).scaleOptions).toEqual({
      borderVisible: false, scaleMargins: ctx.paneMargins.adx,
      autoScale: false, minimum: 0, maximum: 100,
    })
  })
})

describe('obv — the autoscale seam, on values that are actually large', () => {
  it('autoScale true, and the provider is DEFAULT not EXCLUDE', () => {
    // ⭐ B3 Task 1 measured what `exclude` does to an autoscaled band: RSI's
    // column collapsed to -0.5..0.5 and priceToCoordinate(30) went from 371 to
    // -1640.78. obv's values are 1e8-scale, so an inverted provider here is the
    // most visible mistake available in this task.
    const p = resolvePlacement({ defId: 'obv' }, def('obv'), ctx)
    expect(p.autoscale).toBe('default')
    expect(p.scaleOptions).toEqual({ borderVisible: false, scaleMargins: ctx.paneMargins.obv, autoScale: true })
  })
})

describe('donchian — a band plot with edges, and the LAST price overlay', () => {
  it('upper and lower are solid lines; the middle is the band, and it names its edges', () => {
    const d = def('donchian')
    expect(d.plots.map(p => [p.key, p.style])).toEqual(
      [['upper', 'line'], ['middle', 'band'], ['lower', 'line']])
    expect(d.plots.find(p => p.key === 'middle').edges).toEqual({ upper: 'upper', lower: 'lower' })
  })
  it('it carries NO priceScaleId of its own — the shipped block omitted it and got the candles scale', () => {
    // ⚠️ The shipped block passes no priceScaleId at all, so LWC defaults it to
    // 'right'. placement.js resolves `price` -> MAIN_PRICE_SCALE_ID = 'right'
    // EXPLICITLY, which is the same answer for a different reason -- and the
    // explicit form is the one that stopped a pooled BB band stranding on the
    // rsi scale. Assert the ANSWER, and record the difference in reason.
    expect(resolvePlacement({ defId: 'donchian' }, def('donchian'), ctx))
      .toEqual({ paneIndex: 0, scaleId: 'right', scaleOptions: null, autoscale: 'exclude' })
  })
  it('and it is inserted LAST among the price overlays, as it is today', () => {
    expect(H.priceOverlayInsertionOrder()).toEqual(['bb', 'vwap', 'sar', 'ichimoku', 'donchian'])
  })
})

describe('the lane is finished', () => {
  it('every series-expressible definition is flipped, and the two counts agree', () => {
    expect(ENGINE_FLIPPED_DEF_IDS.size).toBe(engineRegistry.listDefinitions().length)
    expect([...ENGINE_FLIPPED_DEF_IDS].sort())
      .toEqual(engineRegistry.listDefinitions().map(d => d.id).sort())
    // …and volumeProfile is in NEITHER, structurally.
    expect(ENGINE_FLIPPED_DEF_IDS.has('volumeProfile')).toBe(false)
    expect(CARVED_OUT_INDICATOR_KEYS.has('volumeProfile')).toBe(true)
  })
})
```

- [ ] **Step 2: Run it**

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/adxObvDonchianFlipParity.test.js
```
Expected: PASS except *"the lane is finished"* and the insertion-order case, which describe the post-migration tree.

- [ ] **Step 3: Migrate, flip, and delete the last of the legacy lane**

Both sets gain `'adx'`, `'obv'`, `'donchian'`. Then delete the three blocks — and then the four things that were only ever there to serve them:

1. the series `useRef` declarations (ledger row 3, anchor `const stochKRef     = useRef(null)`),
2. the whole `indicatorData` memo (row 4, anchor `const indicatorData = useMemo(`), and the ten `compute*` imports it was the sole caller of,
3. the hand-written render block region (row 5, anchor `if (indicatorData.williamsR.length) {`),
4. the hide-all ref array (row 6, anchor `const set = (ref) =>`).

⚠️ **Check `indicatorData`'s other readers before deleting it.** `grep -n "indicatorData" app/src/components/StockChart.jsx` — the crosshair reads were retired at B4 Task 10 and the chip thunks went at Tasks 5–6, but the memo's dependency array (`[filteredBars, cs.indicators, resolvedTf, adjustTime, vwapOverride]`) tells you what else may be entangled. `vwapOverride` in particular has its own forced-instance path (`StockChart.jsx`, Model Book's `IntradayDayPopover`) that B3 Task 11 nearly broke for every user — verify it does not route through the memo before removing it.

- [ ] **Step 4: Retire four ledger rows and prove them retired**

`SITE_COUNT` **15 → 11**; partition **`{B5: 4, C: 2, keep: 3, phase: 2}`**; the per-site mapping loses four pairs. Add a `RETIRED_BY_B5_TASK8` block in the shape the file already uses seven times — re-run the SAME anchors and demand **zero** matches:

```js
const RETIRED_BY_B5_TASK8 = [
  { file: 'app/src/components/StockChart.jsx', pattern: /const\s+stochKRef\s+=\s+useRef\(/g },
  { file: 'app/src/components/StockChart.jsx', pattern: /const\s+indicatorData\s*=\s*useMemo\(/g },
  { file: 'app/src/components/StockChart.jsx', pattern: /if\s*\(indicatorData\.williamsR\.length\)/g },
  { file: 'app/src/components/StockChart.jsx', pattern: /const\s+set\s*=\s*\(ref\)\s*=>/g },
]
```

⚠️ **A format-exact "demand zero" is brittle and B4 measured it**: reintroducing a full eight-entry literal with only the spaces around `=` removed left the guard green *and* the discovery scan green — a second source of truth back beside the derivation with nothing red. Every pattern above therefore uses `\s+` rather than literal spaces, **and** the task adds one behavioural guard the format cannot dodge: `StockChart.jsx` imports **zero** `compute*` functions from `chart/indicators.js`.

```js
  it('StockChart imports no compute function at all — the lane is the ENGINE lane', () => {
    const src = stripComments(read('app/src/components/StockChart.jsx'))
    const imports = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/chart\/indicators'/g)]
    expect(imports).toEqual([])
    // Non-vacuity: the same regex against the pre-migration file finds ten names.
    expect(computeNamesAt('084eeded')).toHaveLength(10)
  })
```

- [ ] **Step 5: Control audit — the biggest one in the phase**

Every control that names *any* un-migrated indicator is now vacuous, because there are none.

| control | what happens | what to do |
|---|---|---|
| `enumerationSites.test.js`'s not-migrated list | goes **RED** | delete it; replace with *"every definition is flipped"* + `size === listDefinitions().length` |
| `stockChartWiring.test.jsx`'s *"NON-migrated indicator chip"* | **no valid subject exists** | move it down a level, exactly as B3 Task 8 did for `engineInert`: assert the FILTER's behaviour on a synthetic un-flipped id rather than on a real one, so the case survives having no real subject |
| `flipB.test.jsx`'s *"NOTHING is migrated-but-un-flipped"* | stays green | verify both directions still fire (B4's R-I2: one direction was the subset check its own message forbade) |
| `binder.js:383-392`'s note that the z-order rail *"reads addSeries order and is blind to moveToPane"* | **stays green while its expiry condition is now one task away** | narrow to Task 10 and say what replaces it (the manifest) |
| `paneMarginsProjection.js`'s short-circuit *"returns cs by identity when flippedIds is empty"* | now unreachable in production | keep the case, and add the note that it is a UNIT claim with no live path — an unreachable branch asserted as if it were live is how a comment rots |
| `chart/indicators.js`'s ten `compute*` exports | now called only by the engine's `nativeDef` adapters and the golden fixtures | **do not delete them** — `nativeRegistry`'s `compute.fn` points at them. Assert that: every definition's `compute.fn` is a function and `computeFor` returns finite columns for all fourteen |

- [ ] **Step 6: Gate**

**Pixels: 0 changed, all cases (38 + 6 new = 44), 5/5, both identities.** Fill `adx_only`, `obv_only`, `donchian_only`; add `engine_adx_vs_legacy`, `engine_obv_vs_legacy`, `engine_donchian_vs_legacy`. Then the run that matters most:

```bash
# every definition, both lanes, one build two render paths
python tools/chart_parity.py --base-a $B --base-b $B --dist-a app/dist --dist-b app/dist \
    --instances-side both --repeat 20
# and the settings a real user has
python tools/chart_parity.py --base-a $A --base-b $B --dist-a .parity-dist-a --dist-b .parity-dist-b \
    --instances-side none --repeat 5
```
Perturbations: `{"period": 21}` on adx and donchian, and on obv — obv takes no period, so perturb its **colour** and say in the report why the period rule does not apply to a definition with no period input (that exemption is the kind of thing that becomes a silent vacuous self-test if it is not written down).

**Non-pixel assertions:** the transcription suite; the lane-is-finished equality; the four retired anchors at zero matches with the behavioural import guard beside them; `SITE_COUNT === 11` and the partition `{B5: 4, C: 2, keep: 3, phase: 2}` and the per-site mapping.

**Mutation gauntlet.** Selection: `src/components/chart/engine/__tests__/adxObvDonchianFlipParity.test.js src/components/chart/engine/__tests__/enumerationSites.test.js src/components/chart/engine/__tests__/flipB.test.jsx`

| # | file | mutation | `-t` filter | must exit 1 |
|---|---|---|---|---|
| M1 | `nativeRegistry.js` | `adx`'s `plusDI` gets `priceScaleId`-forcing `placement` override | `share the adx price scale` | yes |
| M2 | ″ | `obv`'s placement `autoPane` → `fixedPane(0, 100)` | `autoScale true, and the provider is DEFAULT` | yes |
| M3 | `placement.js` | the pane branch's `autoscale: 'default'` → `'exclude'` | `provider is DEFAULT not EXCLUDE` | yes |
| M4 | `nativeRegistry.js` | `donchian.middle`'s `edges` → `{upper:'lower', lower:'upper'}` | `names its edges` | yes |
| M5 | ″ | move `donchian` before `sar` in `RAW_DEFS` | `inserted LAST among the price overlays` | yes |
| M6 | `enumerationSites.test.js` | `SITE_COUNT` 11 → 15 | `holds 11 live sites` | yes |
| M7 | ″ | re-fate one B5 row to `keep`, **total preserved** | `every site names its own fate` | yes |
| M8 | `StockChart.jsx` | re-add `const indicatorData = useMemo(() => ({}), [])` (behaviourally inert) | `RETIRED_BY_B5_TASK8` | yes |
| M9 | ″ | re-add `import { computeATR } from './chart/indicators'` with no caller | `imports no compute function` | yes — the format-exact guard cannot see this; the behavioural one can |
| M10 | `flipState.js` | drop `'donchian'` from FLIPPED only | *(unfiltered)* | yes |
| M11 | `adxObvDonchianFlipParity.test.js` | `computeNamesAt('084eeded')` → return `[]` | `imports no compute function` | yes — the non-vacuity control |

- [ ] **Step 7: Commit**

```bash
git add app/src/components/chart/engine/flipState.js app/src/components/chart/engine/__tests__/ \
        app/src/components/StockChart.jsx tools/chart_parity_cases.json
git commit -m "feat(chart): adx, obv and donchian -- the legacy indicator lane is gone

Registry order 12, 13 and 14. obv is the case that actually exercises the
autoscale seam on a real scale (1e8-scale values; B3 measured what `exclude` does
to an autoscaled band). donchian lands last because it is the last price overlay
and LWC z-stacks by insertion.

With these three there is not one hand-written indicator render block left in
StockChart.jsx, so four ledger rows retire together -- they were one mechanism:
the refs, the indicatorData memo, the blocks, the hide-all array. Ledger 15 -> 11.
The retirement guard is patterns-plus-BEHAVIOUR: StockChart now imports zero
compute functions, which a format-exact regex could not have caught.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: The settings blob stops enumerating indicators — `cs.indicators` folds into `indicatorInstances`

*(Solo. Owns `chartDefaults.js`, `StockChart.jsx`, the four door-7 files.)*

This is the migration the open record actually names. `engineEnabled` was the flag; **this is "the rest of `cs.indicators`"**. It can only happen now, because until Task 8 ten render blocks read `ind.<id>?.enabled` directly, and it must happen before the cutover, because Task 12's numbers must be measured against a blob shape that is not still moving.

**Files:**
- Modify: `app/src/components/chart/chartDefaults.js` — `settingsVersion` 1 → 2; the read-time fold; `CHART_DEFAULTS.indicators` shrinks to `{volumeProfile}`; the allow-list shrinks to one line
- Modify: `app/src/components/chart/engine/instances.js` (`migrateLegacyToInstances` becomes the fold's implementation, and gains the ORDER guarantee), `engine/instanceControls.js` (`isIndicatorEnabled`'s legacy-mirror rule)
- Modify: `app/src/components/StockChart.jsx` (`csIndicatorsRef` and any surviving `cs.indicators` read)
- Modify: `app/src/pages/charts/ChartsWorkspace.jsx` (the frozen capture — ledger row 14), `pages/Settings.jsx`, `chart/ChartSettingsModal.jsx`, `chart/ChartToolbar.jsx`
- Create: `app/src/components/chart/engine/__tests__/settingsBlobMigration.test.js`
- Modify: `docs/decisions/2026-08-03-engine-enabled-settings-migration.md` — **Status: OPEN → RESOLVED**
- Modify: `enumerationSites.test.js` — **SITE_COUNT 11 → 8**, rows 1, 2 and 14 retire

**Interfaces:**
- Consumes: `migrateLegacyToInstances(cs, registry)` (already pure, already skips `overlays` and `volumeProfile`), `normalizeInstances`, `instanceTombstone`.
- Produces: `mergeChartSettings` emits `settingsVersion: 2` and an `indicatorInstances` array seeded from a v1 blob's `indicators`; `CHART_DEFAULTS.indicators` has exactly one key; `isIndicatorEnabled(cs, defId)` drops its third argument and its legacy-mirror rule.

- [ ] **Step 1: Write the failing test — from JSON STRINGS, always**

The record's R3 is explicit: *a fixture built as an object skips the step that is being migrated.*

```js
const JULY = '{"chartType":"candles","indicators":{"rsi":{"enabled":true,"period":7,"color":"#7b68ee"},' +
             '"stoch":{"enabled":true,"kPeriod":14},"macd":{"enabled":false}},"overlays":[]}'

describe('a blob written before the engine existed', () => {
  it('folds every enabled indicator into an instance, with its stored inputs', () => {
    const cs = mergeChartSettings(JSON.parse(JULY))
    expect(cs.settingsVersion).toBe(2)
    expect(cs.indicatorInstances.map(i => i.defId)).toEqual(['stoch', 'rsi'])
    expect(cs.indicatorInstances.find(i => i.defId === 'rsi').inputs)
      .toMatchObject({ period: 7, color: '#7b68ee' })
    // macd was OFF and stays off: no instance, no tombstone, nothing.
    expect(cs.indicatorInstances.some(i => i.defId === 'macd')).toBe(false)
  })

  it('and the instance ORDER is the shipped stack order, so nobody s panes reorder', () => {
    // ⭐ Plan A5. PANES stacked bottom-to-top obv,atr,adx,macd,cci,williamsR,mfi,
    // stoch,rsi. Pane INDEX runs top-to-bottom, so the instance list is that list
    // reversed. This is the one guarantee that makes Flip C invisible to a user's
    // muscle memory, and it is seeded once, here, from a table that is about to
    // be deleted.
    const many = JSON.stringify({ indicators: Object.fromEntries(
      ['obv', 'rsi', 'stoch', 'atr'].map(k => [k, { enabled: true }])) })
    expect(mergeChartSettings(JSON.parse(many)).indicatorInstances.map(i => i.defId))
      .toEqual(['rsi', 'stoch', 'atr', 'obv'])
  })

  it('runs ONCE — a v2 blob is passed through untouched, by identity', () => {
    const once = mergeChartSettings(JSON.parse(JULY))
    const twice = mergeChartSettings(JSON.parse(JSON.stringify(once)))
    expect(twice.indicatorInstances).toEqual(once.indicatorInstances)
    // The R2 hazard: a preset writing settingsVersion 1 would make the migrator
    // re-run forever and re-seed instances the user has since deleted.
    expect(twice.settingsVersion).toBe(2)
  })

  it('a v2 blob whose instances were DELETED stays deleted', () => {
    // The failure this rules out is the one that makes a migration hated: the
    // user removes RSI, the migrator sees `indicators.rsi.enabled` still true in
    // some stale copy, and puts it back on every load.
    const cs = mergeChartSettings(JSON.parse(
      '{"settingsVersion":2,"indicatorInstances":[],"indicators":{"rsi":{"enabled":true}}}'))
    expect(cs.indicatorInstances).toEqual([])
  })

  it('volumeProfile survives, because it has no definition and never will', () => {
    const cs = mergeChartSettings(JSON.parse('{"indicators":{"volumeProfile":{"enabled":true,"bins":24}}}'))
    expect(cs.indicators.volumeProfile).toMatchObject({ enabled: true, bins: 24 })
    expect(Object.keys(cs.indicators)).toEqual(['volumeProfile'])
    expect(cs.indicatorInstances.some(i => i.defId === 'volumeProfile')).toBe(false)
    // The control that the migrator ran at all:
    expect(mergeChartSettings(JSON.parse('{"indicators":{"rsi":{"enabled":true}}}'))
      .indicatorInstances).toHaveLength(1)
  })

  it('and CHART_DEFAULTS.indicators is one key, not fifteen', () => {
    expect(Object.keys(CHART_DEFAULTS.indicators)).toEqual(['volumeProfile'])
  })
})
```

- [ ] **Step 2: Run and watch every one fail**

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/settingsBlobMigration.test.js
```
Expected: FAIL — `settingsVersion` is 1, `indicatorInstances` is `[]`, `CHART_DEFAULTS.indicators` has fifteen keys.

- [ ] **Step 3: Implement the read-time fold**

In `mergeChartSettings`, after the allow-list merge and before the return:

```js
  // ─── v1 → v2: the blob stops enumerating indicators ────────────────────────
  // A read-time, versioned migration (record §6 R1a). It heals on the next READ,
  // writes nothing by itself, and is a pure function, so it is testable against
  // real blob STRINGS — which is the shape a fixture built as an object skips.
  //
  // ⛔ It runs only BELOW the new version. A v2 blob is authoritative even when
  // it carries a stale `indicators` mirror: a user who removed RSI must not get
  // it back on every load, and R2's re-migration loop (a preset writing v1
  // forever) cannot exist if the rule is unconditional on version alone.
  if ((parsed.settingsVersion ?? 1) < 2) {
    out.indicatorInstances = normalizeInstances(
      migrateLegacyToInstances({ ...out, indicators: legacyIndicators }, engineRegistry), engineRegistry).kept
  }
  out.settingsVersion = 2
  // `volumeProfile` is permanently carved out (spec §11): it has no definition,
  // it draws to a sibling canvas, and no flip touches it. It is the ONLY key that
  // survives here, which is why this is a retirement of the enumeration and not a
  // rename of it.
  out.indicators = { volumeProfile: { ...CHART_DEFAULTS.indicators.volumeProfile,
                                      ...(parsed.indicators?.volumeProfile || {}) } }
```

`migrateLegacyToInstances` gains the order guarantee — it must emit instances in the **shipped stack order, top-to-bottom**, which is `PANES` reversed, then price overlays in registry order. Put the seed list in `instances.js` with a comment saying it is a **one-time seed of a table that is about to be deleted**, not a new enumeration; `enumerationSites.test.js`'s discovery scan will flag `instances.js` if it names four or more ids, so **derive the order from `paneMargins.PANES` while that file still exists** and add a Task-12 note to inline the resulting array at the moment `PANES` goes.

⚠️ That is a real, dated coupling between two tasks. Write it as a `// ⏭️ TASK 12:` comment at the site AND as a failing-by-date assertion: `expect(existsSync('app/src/components/chart/paneMargins.js')).toBe(true)` in this task's suite, so Task 12 gets a red test rather than a silent import of a deleted module.

- [ ] **Step 4: Follow the blob shape through door seven and the frozen capture**

`ChartsWorkspace.jsx`'s `UCT_DEFAULT_CHART_SETTINGS_JSON` is a frozen capture of all fifteen sections (ledger row 14) written verbatim by **"UCT Default"** and **"New Layout"**. It becomes `uctDefaultChartSettings()` stamping from `CHART_DEFAULTS` — which after Step 3 is one indicator section and an empty instance list. The three door-7 sites (`ChartToolbar.applyPreset`, `Settings.applyPreset`, `Settings.resetToDefaults`) and `ChartSettingsModal.jsx:197`'s reset already spread `CHART_DEFAULTS`, so they follow — **verify by asserting the PAYLOAD, not by reading the code**, the way `controlDoorCensus.test.js` already does.

⚠️ **Measured, and this migration must not make it worse:** applying any preset today clears `indicatorInstances` to `[]` *and* turns every `cs.indicators.*.enabled` off — i.e. "click OLED Black" is currently spelled "and remove my indicators". After this task there is no mirror to turn off, so the behaviour is unchanged in substance but is now expressed in one place. Assert it as it ships, with a case that says so, so that fixing it later is a deliberate red rather than a surprise.

- [ ] **Step 5: Resolve the record, and re-read the rail in the SAME commit**

`docs/decisions/2026-08-03-engine-enabled-settings-migration.md`: header `**Status:**` → `✅ **RESOLVED 2026-08-04 (B5 Tasks 4 and 9)**`, with a §12 recording *what was done instead of what was recommended*: the flag was **deleted** (Task 4), not migrated; the blob migration that arrived is the one §7 predicted ("delete the flag at B5 **with the rest of `cs.indicators`**"); and §4's three live consumers are each gone rather than satisfied.

⛔ **The rail fires on this.** `enumerationSites.test.js`'s *"creates no migrated-but-un-flipped definition while the settings migration is open"* reads the header line and asserts the pair `{stillOpen: true, stranded: []}` — **it goes red the other way too, deliberately, because a resolved record is the moment the rail's premise has to be re-read.** Re-read it: with the record RESOLVED and every definition flipped, the rail's job is now *"nothing is migrated-but-un-flipped, full stop"*, which is `flipB.test.jsx`'s claim. Rewrite the rail as *"the record is RESOLVED and the two sets are equal and complete"* — do **not** delete it; a rail deleted at the moment its premise changes is how this branch loses a guarantee.

- [ ] **Step 6: Retire ledger rows 1, 2 and 14**

`SITE_COUNT` **11 → 8**; partition **`{B5: 1, C: 2, keep: 3, phase: 2}`** (the one remaining B5 row is `paneMargins.PANES`); the per-site mapping loses three pairs. `RETIRED_BY_B5_TASK9` re-runs the three anchors and demands zero, **plus** a behavioural guard the format cannot dodge:

```js
  it('CHART_DEFAULTS.indicators has ONE key, so there is no fifteen-section list to edit', () => {
    expect(Object.keys(CHART_DEFAULTS.indicators)).toEqual(['volumeProfile'])
  })
  it('and the allow-list has one indicator line, proven by what it DESTROYS', () => {
    // A hard allow-list destroys unknown keys. That is the behaviour, so assert
    // the behaviour: a v2 blob carrying `indicators.rsi` loses it.
    const cs = mergeChartSettings(JSON.parse('{"settingsVersion":2,"indicators":{"rsi":{"enabled":true}}}'))
    expect(cs.indicators.rsi).toBeUndefined()
  })
```

- [ ] **Step 7: Gate**

**Pixels: 0 changed, all 44 cases, 5/5, both identities, run as a REAL two-build A/B and again at `--instances-side none`.** `mergeChartSettings` is on every chart's path on every surface; this and Task 4 are the two commits where that sentence has teeth. Both fail-proofs, both exit 1.

⚠️ **The parity cases are legacy-shaped on both sides** (`flipb_*` carry `indicators` and no instances) — that is exactly the population this migration heals, so a 0 here is meaningful and not incidental. State it in the report.

**Non-pixel assertions:** the six cases in Step 1; all 25 blobs in `flipBStoredBlobs.test.jsx` re-run and their RENDER unchanged (extend it with the July capture at v1→v2 and a v2 blob with deleted instances); the pane ORDER guarantee; the three door-7 payloads; the record's header says RESOLVED exactly once; the rail rewritten and both its directions proven.

**Mutation gauntlet.** Selection: `src/components/chart/engine/__tests__/settingsBlobMigration.test.js src/components/chart/engine/__tests__/flipBStoredBlobs.test.jsx src/components/chart/engine/__tests__/enumerationSites.test.js src/components/chart/chartDefaults.test.js`

| # | file | mutation | `-t` filter | must exit 1 |
|---|---|---|---|---|
| M1 | `chartDefaults.js` | drop the `< 2` version guard (migrate unconditionally) | `v2 blob whose instances were DELETED` | yes — the worst available regression: a deleted indicator returning on every load |
| M2 | ″ | `out.settingsVersion = 2` → `= parsed.settingsVersion ?? 1` | `runs ONCE` | yes |
| M3 | `instances.js` | emit instances in registry order instead of the seeded stack order | `instance ORDER is the shipped stack order` | yes |
| M4 | `chartDefaults.js` | keep all fifteen keys in `out.indicators` | `ONE key, so there is no fifteen-section list` | yes |
| M5 | ″ | drop `volumeProfile` from `out.indicators` | `volumeProfile survives` | yes |
| M6 | `settingsBlobMigration.test.js` | delete the `mergeChartSettings(rsi).indicatorInstances` control | `volumeProfile survives` | **must exit 0**, then re-apply M5 → still exits 1. Designed pair: it proves the control is a control and not the assertion. |
| M7 | `instances.js` | let `migrateLegacyToInstances` stop skipping `volumeProfile` | `volumeProfile survives` | yes |
| M8 | the decision record | header → back to OPEN | `record is RESOLVED` | yes |
| M9 | `enumerationSites.test.js` | `SITE_COUNT` 8 → 11 | `holds 8 live sites` | yes |
| M10 | `chartDefaults.js` | re-add `rsi: { ...CHART_DEFAULTS.indicators.rsi, … }` to the allow-list | `allow-list has one indicator line` | yes — the behavioural guard, which the anchor-based one cannot see once the anchor text differs by a space |

- [ ] **Step 8: Commit**

```bash
git add app/src/components/chart/chartDefaults.js \
        app/src/components/chart/engine/instances.js \
        app/src/components/chart/engine/instanceControls.js \
        app/src/components/StockChart.jsx app/src/pages/charts/ChartsWorkspace.jsx \
        app/src/pages/Settings.jsx app/src/components/chart/ChartSettingsModal.jsx \
        app/src/components/chart/ChartToolbar.jsx \
        app/src/components/chart/engine/__tests__/ \
        docs/decisions/2026-08-03-engine-enabled-settings-migration.md
git commit -m "feat(chart): the settings blob stops enumerating indicators

settingsVersion 1 -> 2 with a read-time fold: every enabled cs.indicators.<id>
becomes an indicatorInstance carrying its stored inputs, in the SHIPPED stack
order so nobody's panes reorder when Flip C makes them panes. Runs only BELOW the
new version, so a user who deleted an indicator does not get it back on every
load, and R2's re-migration loop cannot exist. CHART_DEFAULTS.indicators shrinks
to volumeProfile -- the one key with no definition and no flip -- and the hard
allow-list to one line, which is asserted by what it DESTROYS rather than by its
text.

Resolves ENGINE_ENABLED_MIGRATION, and re-reads the rail in the same commit
rather than deleting it: a rail dropped at the moment its premise changes is how
a guarantee is lost. Ledger 11 -> 8.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Flip C lands DARK — real panes, behind one constant, at zero changed pixels

*(Solo. Owns `placement.js`, `binder.js`, `paneLayout.js`, `StockChart.jsx`, `chartRegion.js`.)*

The whole cutover — pane creation, `moveToPane`, stretch factors, per-pane scales, the region resolver, the divider — ships here, **inert**. `PANE_MODE` defaults to `'bands'`, every code path the users are on is byte-for-byte the one they were on, and the gate is the same **0 changed pixels on all 44 cases** that has held for three phases. This is B3's Task 9 shape (*"Flip-B machinery, landed dark"*) applied to the biggest change in the phase, and it is what makes Task 12 a one-constant commit whose diff is entirely attributable.

**Files:**
- Modify: `app/src/components/chart/engine/paneLayout.js` (`export const PANE_MODE = 'bands'`)
- Modify: `app/src/components/chart/engine/placement.js` (`resolvePlacement`'s own-band branch `:339-366`)
- Modify: `app/src/components/chart/engine/binder.js` (apply stretch factors; assert the resulting heights)
- Modify: `app/src/components/StockChart.jsx` (build the layout beside the margins; publish the manifest)
- Modify: `app/src/components/chart/chartRegion.js` (resolve a region from real pane rectangles when `PANE_MODE === 'panes'`)
- Create: `app/src/components/chart/engine/__tests__/flipCGeometry.test.jsx`

**Interfaces:**
- Consumes: `computePaneLayout` / `paneManifest` / `SEPARATOR_PX` (Task 3), `resolvePlacement`'s existing `{paneIndex, scaleId, scaleOptions, autoscale}` contract, `binder.js:393`'s `series.moveToPane(paneIndex)`.
- Produces: `PANE_MODE: 'bands' | 'panes'` — the single constant Task 12 flips. `resolvePlacement(instance, def, ctx)` gains `ctx.paneLayout`; in `'bands'` mode it is ignored and the returned object is **deep-equal to today's**, asserted.

- [ ] **Step 1: Write the failing test — drive REAL panes on a REAL chart**

`autoscaleOnARealScale.test.js` is the precedent: it drives the real bundle through the real `resolvePlacement` + `seriesOptionsForPlot`. Do the same for geometry, because the one thing a jsdom double cannot tell you is whether LWC actually built the panes you asked for.

```js
describe('PANE_MODE bands — the DEFAULT path is byte-identical to today', () => {
  it('resolvePlacement returns exactly what it returned before, for every pane oscillator', () => {
    for (const id of oscillatorIds(engineRegistry)) {
      expect(resolvePlacement({ defId: id }, def(id), { ...ctx, paneLayout }))
        .toEqual(resolvePlacementBeforeFlipC({ defId: id }, def(id), ctx))
    }
    // Non-vacuity: nine oscillators really iterated.
    expect(oscillatorIds(engineRegistry)).toHaveLength(9)
  })
  it('and the chart really has ONE pane (plus volume s, if separate)', async () => {
    const H = await renderReal({ indicators: { rsi: true, macd: true, stoch: true } })
    expect(H.chart.panes()).toHaveLength(1)
  })
})

describe('PANE_MODE panes — the cutover, exercised', () => {
  it('each oscillator gets its OWN pane, in instance-list order', async () => {
    const H = await renderReal({ mode: 'panes', instances: ['rsi', 'macd', 'stoch'] })
    expect(H.chart.panes()).toHaveLength(4)                      // price + three
    expect(H.manifest().panes.map(p => p.series.map(s => s.key)))
      .toEqual([expect.arrayContaining([null]), ['legacy:rsi::rsi'],
                expect.arrayContaining(['legacy:macd::macd']), ['legacy:stoch::k', 'legacy:stoch::d']])
  })

  it('the pane heights are the LAYOUT s heights, to the pixel', async () => {
    const H = await renderReal({ mode: 'panes', instances: ['rsi', 'macd'] })
    const want = computePaneLayout(H.cs, H.instances, H.opts)
    expect(H.chart.panes().map(p => p.getHeight()))
      .toEqual([want.pane0.heightPx, ...want.panes.map(p => p.heightPx)])
  })

  it('and the binder THROWS BY NAME if the renderer redistributed them', async () => {
    // ⛔ A silent LWC redistribution is precisely the class of thing this branch
    // does not assume. Plan A7: stretch factors set to target pixels land exactly,
    // and if they ever stop doing so this must be loud, not a one-pixel drift
    // nobody attributes for a week.
    await expect(renderReal({ mode: 'panes', instances: ['rsi'], forceStretchDrift: true }))
      .rejects.toThrow(/paneLayout: pane 1 is \d+px, expected \d+px/)
  })

  it('#2049 — moving a series to a new pane REUSES it; nothing is removed', async () => {
    const H = await renderReal({ mode: 'bands', instances: ['rsi'] })
    const before = H.seriesObjectFor('legacy:rsi::rsi')
    await H.setMode('panes')
    expect(H.seriesObjectFor('legacy:rsi::rsi')).toBe(before)     // toBe, not toEqual
    expect(H.removedSeries).toEqual([])
    expect(H.addSeriesCalls).toHaveLength(0)
    // The control that the mode really changed:
    expect(H.chart.panes()).toHaveLength(2)
  })

  it('an oscillator turned OFF removes its pane; the others keep their heights', async () => {
    const H = await renderReal({ mode: 'panes', instances: ['rsi', 'macd'] })
    const macdH = H.chart.panes()[2].getHeight()
    await H.disable('rsi')
    expect(H.chart.panes()).toHaveLength(2)
    // The remaining pane is RE-SQUEEZED, deliberately -- the stack aims at 72%
    // whatever is in it, exactly as the bands did.
    expect(H.chart.panes()[1].getHeight()).not.toBe(macdH)
    expect(H.chart.panes()[1].getHeight())
      .toBe(computePaneLayout(H.cs, H.instances, H.opts).panes[0].heightPx)
  })

  it('the divider is draggable, because spec 6 requires it', async () => {
    const H = await renderReal({ mode: 'panes', instances: ['rsi'] })
    expect(H.chartOptions().layout.panes.enableResize).toBe(true)
  })

  it('the right-click region resolver reads REAL pane rectangles, not margin bands', async () => {
    // B4 Task 3 built this harness behaviourally: it scans y and reads the region
    // off the component's OWN payload rather than re-implementing the geometry --
    // which is why it survives the cutover instead of becoming the twin this
    // phase retires.
    const H = await renderReal({ mode: 'panes', instances: ['rsi'] })
    const regions = await H.scanRegionsDownTheCanvas()
    expect(regions).toEqual(['main', 'rsi'])
    expect(await H.regionAtY(H.chart.panes()[1].getHeight() / 2 + H.chart.panes()[0].getHeight()))
      .toBe('rsi')
  })
})
```

- [ ] **Step 2: Run it and watch the `panes` half fail**

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/flipCGeometry.test.jsx
```
Expected: the `bands` describe PASSES (that is the point — the default path is unchanged); every `panes` case FAILS.

- [ ] **Step 3: Implement — `resolvePlacement`'s own-band branch learns a second mode**

```js
  // ─── the own-band branch ───────────────────────────────────────────────────
  if (PANE_MODE === 'panes') {
    // Flip C. The band becomes a PANE: the scale keeps the definition's id (an
    // OVERLAY scale, so no axis labels appear -- see FLIP_C_PANE_GEOMETRY (b),
    // which is the owner's call, not this branch's), and the drawable rectangle
    // is the whole pane, so the margins are zero where they used to be a slice.
    const idx = (c.paneLayout && c.paneLayout.indexOf(def.id))
    if (idx == null || idx < 0) return null            // not enabled: bind nothing
    return {
      paneIndex: idx,
      scaleId: def.id,
      scaleOptions: { borderVisible: false, scaleMargins: { top: 0, bottom: 0 }, ...range },
      autoscale: 'default',
    }
  }
  // ⛔ 'exclude' here collapses RSI's band to -0.5..0.5 and moves price 30 from
  // y=371 to y=-1640.78 (MEASURED, B3 Task 1 fix round). 'default' is the answer
  // in BOTH modes and for the same reason.
  const band = (c.paneMargins && c.paneMargins[key]) || FALLBACK_BAND
  return { paneIndex: 0, scaleId: def.id,
           scaleOptions: { borderVisible: false, scaleMargins: band, ...range },
           autoscale: 'default' }
```

`binder.js` — after the plan is applied and before returning, set the stretch factors and **assert**:

```js
  // Plan A7: LWC distributes `available = chartHeight - sum(separators)` in
  // proportion to the stretch factors, so factors SET TO THE TARGET PIXEL HEIGHTS
  // land exactly. Measured against the installed bundle in paneSeparatorPin.test.js.
  if (PANE_MODE === 'panes' && layout) {
    const panes = chart.panes()
    panes[0].setStretchFactor(layout.pane0.heightPx)
    layout.panes.forEach((p, i) => panes[i + 1]?.setStretchFactor(p.heightPx))
    // A silent redistribution is a one-pixel drift nobody attributes for a week.
    panes.forEach((p, i) => {
      const want = i === 0 ? layout.pane0.heightPx : layout.panes[i - 1].heightPx
      if (p.getHeight() !== want) {
        throw new Error(`paneLayout: pane ${i} is ${p.getHeight()}px, expected ${want}px`)
      }
    })
  }
```

`StockChart.jsx` — build `paneLayout` beside `paneMargins` (both, in `'bands'` mode; only the layout in `'panes'` mode) and pass it into the binder ctx. `chartRegion.js` — a second resolver that reads `chart.panes()` rectangles, selected by `PANE_MODE`.

⚠️ **`applyOptions` MERGES and `merge()` skips `undefined`.** `scaleMargins: {top: 0, bottom: 0}` must be spelled out; omitting it leaves the previous band standing on a re-purposed scale, which is a pooled series carrying a stale slice.

- [ ] **Step 4: Run to green, both modes**

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/flipCGeometry.test.jsx \
  src/components/chart/engine/placement.test.js src/components/chart/engine/binder.test.js \
  src/components/chart/engine/paneLayout.test.js
cd app && npx vitest run          # tripwire
```

- [ ] **Step 5: Control audit**

| control | what happens | what to do |
|---|---|---|
| `binder.js:383-392` — *"a relocation is invisible to the z-order rails (they read `addSeries` order)"* | **stays green while its premise becomes live** — this is the task that makes `moveToPane` a production path | replace the rails' `addSeries`-order reading with the **manifest**, which reads the renderer's actual pane assignment. Keep the `addSeries`-order case for the price overlays (they never move panes) and say which claim each now holds. |
| `placement.test.js`'s own-band cases | still green in `bands` mode | add the `panes`-mode twin for each; a mode with no coverage is a mode that ships untested |
| `paneMarginsProjection.test.js`'s 512-subset proof | still green | it is about `bands` mode; annotate it as such and point at `paneLayout.test.js`'s 512-subset identity as its `panes`-mode counterpart |
| `stockChartWiring.test.jsx`'s context-menu harness | **survives** — it scans y and reads the region off the payload | verify, do not assume: run it in `panes` mode and confirm it still resolves a region without re-implementing geometry |
| `hiddenIsRemovedNotParked.test.js` — *"`visible:false` does not release the pane; `removeSeries` does"* | check | still true, and now more load-bearing: an empty pane is a pane |

- [ ] **Step 6: Gate**

**Pixels: 0 changed, all 44 cases, 5/5, both identities named.** `PANE_MODE` is `'bands'`, so this must be a zero — and it is the strongest evidence available that the cutover's code is inert. Run `--same-build` at HEAD **and** a real two-build A/B against Task 9's commit, plus `--instances-side none` and `both`. Both fail-proofs, exit 1.

⚠️ **The manifest is now published on both sides.** `report.json`'s `manifest_diff` must be **empty** for every case. A non-empty diff at `PANE_MODE = 'bands'` means the layout module is reaching the renderer when it should not — a zero-pixel result would not have told you.

**Non-pixel assertions:** `bands`-mode `resolvePlacement` deep-equals its pre-flip answer for all nine oscillators (with the nine-iteration non-vacuity); `panes` mode builds the panes, at the layout's heights, in instance-list order; the height assertion throws by name; **series are reused across a mode change (`toBe`, `removedSeries` empty, `addSeriesCalls` empty)**; disabling an oscillator removes its pane and re-squeezes the rest; `enableResize` is on; the region resolver reads real rectangles.

**Mutation gauntlet.** Selection: `src/components/chart/engine/__tests__/flipCGeometry.test.jsx src/components/chart/engine/placement.test.js src/components/chart/engine/binder.test.js`

| # | file | mutation | `-t` filter | must exit 1 |
|---|---|---|---|---|
| M1 | `paneLayout.js` | `PANE_MODE = 'bands'` → `'panes'` | *(unfiltered)* | yes — and this is also the rehearsal for Task 12; record what fails and how many |
| M2 | `placement.js` | panes branch: `scaleMargins: {top:0,bottom:0}` **omitted** | `pane heights are the LAYOUT s heights` | yes — the `merge()`-skips-`undefined` trap, on a pooled scale |
| M3 | ″ | panes branch: `autoscale: 'default'` → `'exclude'` | *(a `panes`-mode autoscale case in `autoscaleOnARealScale.test.js`)* | yes |
| M4 | `binder.js` | delete the post-pass height assertion | `THROWS BY NAME if the renderer redistributed` | yes |
| M5 | ″ | replace `moveToPane` with `removeSeries` + `addSeries` on the new pane | `REUSES it; nothing is removed` | yes — **#2049 is open; this is the mutation that must never survive** |
| M6 | `paneLayout.js` | `computePaneLayout` returns panes in registry order | `in instance-list order` | yes |
| M7 | `chartRegion.js` | keep using margin bands in `panes` mode | `reads REAL pane rectangles` | yes |
| M8 | `StockChart.jsx` | `layout.panes.enableResize` → `false` | `divider is draggable` | yes |
| M9 | `flipCGeometry.test.jsx` | drop the `toHaveLength(9)` non-vacuity line, then make `oscillatorIds` return `[]` | `returned exactly what it returned before` | yes |
| M10 | `paneLayout.js` | publish the manifest in `bands` mode with a fabricated second pane | *(the parity `manifest_diff` check — run it)* | yes — proves the manifest is read and not just written |

- [ ] **Step 7: Commit**

```bash
git add app/src/components/chart/engine/paneLayout.js \
        app/src/components/chart/engine/placement.js \
        app/src/components/chart/engine/binder.js \
        app/src/components/chart/chartRegion.js \
        app/src/components/StockChart.jsx \
        app/src/components/chart/engine/__tests__/
git commit -m "feat(chart): Flip C lands DARK -- real panes behind one constant, 0 changed pixels

PANE_MODE defaults to 'bands', so every path a user is on is byte-for-byte the one
they were on and the gate is the same 44-case zero that has held for three phases.
That is what makes the cutover a ONE-CONSTANT commit whose diff is entirely
attributable, instead of a change nobody can bisect.

Series are MOVED, never recreated: #2049 is open and a mass removeSeries is a 2-4s
main-thread block, so the mode change is asserted with toBe on the series object
and an empty removedSeries. Pane heights are set as stretch factors equal to the
target pixel heights -- which lands exactly, measured against the installed
renderer -- and the binder THROWS BY NAME if LWC redistributed them, because a
silent one-pixel drift is not something anyone attributes for a week.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Measure the cutover, price it, and put it to the owner

*(Solo. It holds the parity harness for hours; a concurrent build corrupts its numbers — B3 learned that at the cost of a clean, plausible, wrong `0 px, 20/20, exit 0`.)*

No shipped source changes here except the case file's `regions` blocks. This task produces **numbers** and a **decision record**, in the shape the owner has already answered twice.

**Files:**
- Modify: `tools/chart_parity_cases.json` (`regions` on every case; no `expect` yet)
- Modify: `docs/decisions/2026-08-04-flip-c-pane-geometry.md` (§3 the measurement, §5 awaiting the owner)

**Interfaces:**
- Consumes: `--expect`, per-case `regions`, `manifest_diff` (Task 2); `PANE_MODE` (Task 10).
- Produces: for Task 12 — a per-case `expect` and per-region `expect` for all 44 cases, and the owner's answer on the three sub-choices.

- [ ] **Step 1: Declare the regions, from the geometry and not by eye**

Every case gets a `regions` block. The rectangles are **derived from the layout**, not measured off a screenshot — a hand-drawn box is a hand-copy, which is the defect this branch has shipped twice.

```jsonc
{ "name": "rsi_only",
  "regions": [
    { "name": "price_plot", "box": [0, 0, 1200, 505] },
    { "name": "osc_strip",  "box": [0, 505, 1200, 594] }
  ] }
```

Generate them with a small script that imports `computePaneLayout` for each case's settings at the case's `w`/`h` and emits the boxes, then commit the script alongside so the boxes can be regenerated rather than re-typed. ⚠️ `rest` is **not** declared (the harness refuses the name) and picks up the time axis, the footer and the axis gutter.

- [ ] **Step 2: The measurement — `bands` vs `panes`, one constant apart**

```bash
cd app && npm run build && cp -r app/dist .parity-dist-a          # PANE_MODE = 'bands'
# flip the constant IN PLACE, rebuild, restore afterwards with a sha256 compare
sed -i "s/PANE_MODE = 'bands'/PANE_MODE = 'panes'/" app/src/components/chart/engine/paneLayout.js
cd app && npm run build && cp -r app/dist ../.parity-dist-b && cd ..
git checkout -- app/src/components/chart/engine/paneLayout.js

python tools/spa_server.py .parity-dist-a 5931 &
python tools/spa_server.py .parity-dist-b 5932 &
PYTHONIOENCODING=utf-8 python tools/chart_parity.py \
    --base-a http://127.0.0.1:5931 --base-b http://127.0.0.1:5932 \
    --dist-a .parity-dist-a --dist-b .parity-dist-b \
    --instances-side none --repeat 20
```

⚠️ **Fresh ports, every time.** Nine stale `spa_server` listeners were found in one B3 task and eight more in the next; a stale listener produced a `0 px, 20/20, exit 0` about a tree nobody was holding. `--dist-a`/`--dist-b` are mandatory and there is no `--skip`. **Diff the reported build identity against the dist you just produced** before believing any number — that check is what caught the one clean fictional zero this branch has recorded.

Record, per case: the total, the per-region split, the distribution across 20 runs, and both build identities. **A case whose distribution is not a single value is not measurable and must be diagnosed, not averaged** — the runbook's §"The 24-pixel artefact" is the procedure, and `?priceline=0` is the precedent for a legitimate suppression (six live cases still carry the latent bistable last-price line).

- [ ] **Step 3: Check the three claims the design rests on**

1. **`price_plot` is 0 on every case.** If not, §A6's named remedy applies: compute pane 0's margins in integer pixel space from `chart.panes()[0].getHeight()`, pin LWC's rounding by reading the installed bundle, re-measure. If it is *still* non-zero, `price_plot` becomes a declared region with its own number and its own line in the record — measured, priced, signed off. **What is forbidden is letting it land in `rest`.**
2. **`rest` is 0 on every case.** A non-zero `rest` is a pixel nobody named: find it, name it, and either declare a region for it with a reason or fix it.
3. **The manifest diff is exactly the declared reshape** — same series, same `scaleId`s, new pane indices, heights matching `computePaneLayout`. A manifest that moves more than the pixels, or less, is a regression by definition.

- [ ] **Step 4: Price the three sub-choices separately**

Three more measurement pairs, each one constant apart from the `panes` build:

| sub-choice | A | B | what the owner is choosing |
|---|---|---|---|
| **(a) separators** | `separatorColor: '#2B2B43'` (LWC default) | `separatorColor` = the chart's own border token | a visible rule between panes, in the app's palette or the library's |
| **(b) per-pane price axis** | `scaleId: def.id` (overlay scale, **no labels** — Task 10's default) | `scaleId: 'right'` (a visible axis with the oscillator's own numbers) | **the largest of the three, and the only one that changes what a user READS.** TradingView shows it; spec §6's "pane grammar" implies it |
| **(c) pane heights** | today's band heights to the pixel (Task 3's identity) | LWC's own stretch defaults (equal panes) | whether a returning user's layout is recognisable |

Each pair: `--repeat 20`, both identities, per-region split, and one screenshot pair. **(b) is the one to expect a real answer on**; recommend (a)=token, (b)=owner's call with the number in front of them, (c)=preserved, and say why for each.

- [ ] **Step 5: Write the record and STOP**

`docs/decisions/2026-08-04-flip-c-pane-geometry.md` §3 gets the tables; §5 stays empty. **Status: 🟡 OPEN — MEASURED, AWAITING THE OWNER.** Do not apply anything. B3's precedent is exact: `MACD_HEAD_MASK` was measured at Task 5 and applied in its own commit `a37722c2` after the owner answered; `VWAP_SESSION_ANCHOR` likewise. **The default stays `'bands'` and the phase continues regardless** — Task 13 is written so it can run before or after the owner replies.

- [ ] **Step 6: Gate**

**Pixels: this task IS the pixel measurement.** Its own gate is that the measurement is trustworthy, not that it is zero:

* every case's distribution is a single value across 20 runs (`{N: 20}`), with the 95 % flake bound printed (20 clean runs ⇒ ≤13.9 %);
* `served == disk` byte-verified on both bases, 7 files each;
* every capture `shots=2/2` and `__chartReadyReason: stable` — none at the 20 s ceiling;
* both fail-proofs run **on this pair** and exit 1;
* a `--same-build` run on the `panes` dist alone reports **0 px on every case**, proving each build is independently deterministic (this is what makes the A/B number a property of the builds and not a flake).

**Non-pixel assertion:** the record contains a number for every case and every region, both build identities, and no `TBD`. Add a test that reads it:

```js
  it('the Flip-C record names a number for every parity case, or says why not', () => {
    const rec = read('docs/decisions/2026-08-04-flip-c-pane-geometry.md')
    for (const c of liveCaseNames()) expect(rec).toMatch(new RegExp(`\\b${c}\\b`))
    expect(rec).not.toMatch(/\bTBD\b/)
    // Non-vacuity: liveCaseNames() really returned 44.
    expect(liveCaseNames()).toHaveLength(44)
  })
```

**Mutation gauntlet.** Selection: the record-reading case above plus `tests/test_chart_parity_harness.py`.

| # | file | mutation | `-t` filter | must exit 1 |
|---|---|---|---|---|
| M1 | the record | delete one case's row | `names a number for every parity case` | yes |
| M2 | ″ | write `TBD` in one cell | ″ | yes |
| M3 | the test | make `liveCaseNames()` return `[]` | ″ | yes |
| M4 | `chart_parity_cases.json` | give `rsi_only` a region named `rest` | *(pytest `region_named_rest_is_refused`)* | yes |
| M5 | ″ | give `rsi_only` a zero-height `price_plot` box | *(pytest, zero-area refusal)* | yes |

- [ ] **Step 7: Commit**

```bash
git add tools/chart_parity_cases.json tools/gen_parity_regions.py \
        docs/decisions/2026-08-04-flip-c-pane-geometry.md \
        app/src/components/chart/engine/__tests__/
git commit -m "docs(chart): Flip C measured and priced -- awaiting the owner

Two builds one constant apart, 20 runs, both identities, per-region split. The
regions are DERIVED from computePaneLayout by a committed script, not drawn by eye
off a screenshot -- a hand-drawn box is a hand-copy, which is the defect this
branch has shipped twice. The three sub-choices (separator colour, per-pane price
axis, pane heights) are priced separately because they are independent and the
owner may want them separately; (b) is the one that changes what a user READS.

Nothing is applied. PANE_MODE stays 'bands'. Status: OPEN, MEASURED.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Apply — `PANE_MODE = 'panes'`, in its own commit, and `paneMargins.js` is deleted

*(Solo. Runs only after the owner has answered Task 11.)*

One constant, the three sub-choices as the owner decided them, the measured numbers written into the case file as `expect`, and the band machinery deleted. Nothing else. **B3's rule, verbatim: the flagged change ships strictly on its own, never inside a migration.**

**Files:**
- Modify: `app/src/components/chart/engine/paneLayout.js` (`PANE_MODE = 'panes'`; the sub-choices)
- Modify: `tools/chart_parity_cases.json` (`expect` per case, `expect` per region)
- **Delete:** `app/src/components/chart/paneMargins.js`, `app/src/components/chart/paneMargins.test.js`, `app/src/components/chart/engine/paneMarginsProjection.js`, `app/src/components/chart/engine/paneMarginsProjection.test.js`
- Modify: `app/src/components/StockChart.jsx` (all four `computePaneMargins` call sites: `:763` `_mainMargins`, `:5940-5941` the render path, `:9073` the region resolver, `:9908` the price-scale-toggle inline style), `chartRegion.js`, `placement.js`, `binder.js` (drop the `bands` branches)
- Modify: `app/src/components/chart/engine/instances.js` (inline the seed order — the `⏭️ TASK 12` note left by Task 9)
- Modify: `enumerationSites.test.js` — **SITE_COUNT 8 → 7**, row 7 (`PANES`) retires, partition `{C: 2, keep: 3, phase: 2}` with **no `B5` key at all**
- Modify: `docs/decisions/2026-08-04-flip-c-pane-geometry.md` (§5 the owner's answer; Status → ACCEPTED)

**Interfaces:**
- Consumes: the owner's answer; Task 11's numbers.
- Produces: `computePaneMargins` and `csForPaneMargins` no longer exist. Anything that wants geometry calls `computePaneLayout`.

- [ ] **Step 1: Write the failing test — the numbers ARE the test now**

```js
  it('every parity case carries an expect, and every region carries one', () => {
    for (const c of liveCases()) {
      expect(typeof c.expect).toBe('number')
      for (const r of c.regions) expect(typeof r.expect).toBe('number')
      // `price_plot` is the claim the whole design rests on. If it is not 0 it
      // must be a NUMBER WITH A LINE IN THE RECORD, never an omission.
      const pp = c.regions.find(r => r.name === 'price_plot')
      if (pp.expect !== 0) expect(recordText()).toMatch(new RegExp(`${c.name}[^\\n]*price_plot`))
    }
    expect(liveCases()).toHaveLength(44)
  })

  it('paneMargins.js and paneMarginsProjection.js are gone, and nothing imports them', () => {
    expect(existsSync('app/src/components/chart/paneMargins.js')).toBe(false)
    expect(existsSync('app/src/components/chart/engine/paneMarginsProjection.js')).toBe(false)
    const hits = scanAppSrc(/computePaneMargins|csForPaneMargins|paneMargins/)   // comment-stripped
    expect(hits).toEqual([])
    // Non-vacuity: the same scan at Task 9's commit finds five call sites.
    expect(scanAt('<task-9-sha>', /computePaneMargins/)).toHaveLength(5)
  })

  it('the seed order is inlined, not imported from a deleted module', () => {
    // Task 9 left `⏭️ TASK 12` at the site and a red-by-existence assertion.
    // This is that assertion, inverted.
    const src = stripComments(read('app/src/components/chart/engine/instances.js'))
    expect(src).not.toContain('paneMargins')
    expect(seedOrder()).toEqual(['rsi', 'stoch', 'mfi', 'williamsR', 'cci', 'macd', 'adx', 'atr', 'obv'])
  })
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/flipCGeometry.test.jsx -t "expect"
```
Expected: FAIL — no case carries an `expect`, and `paneMargins.js` still exists.

- [ ] **Step 3: Flip the constant and apply the owner's three answers**

```js
// ⭐ FLIP C, APPLIED. docs/decisions/2026-08-04-flip-c-pane-geometry.md.
// This constant is the whole cutover, deliberately: it landed dark at Task 10
// with the 44-case gate at 0 changed pixels, so THIS commit's diff is the only
// thing in the frame for every number in that record. Reversal is one edit and
// is priced at the same numbers -- which is exactly why the constant is KEPT and
// not inlined away, following MACD_HEAD_MASK.
export const PANE_MODE = 'panes'
```

Then the sub-choices as answered, each with the record's number in the comment beside it.

- [ ] **Step 4: Delete the band machinery**

`paneMargins.js`, `paneMarginsProjection.js` and both test files. Then the four `computePaneMargins` call sites in `StockChart.jsx`:

* `:763` `_mainMargins` → `computePaneLayout(...).pane0.mainMargins`;
* `:5940-5941` → the layout, which the binder already receives;
* `:9073` the region resolver → real pane rectangles (Task 10 built this);
* `:9908` the price-scale-toggle inline style → `pane0.mainMargins.bottom`.

⚠️ **Three of the four call sites bypass `csForPaneMargins` today** — they read the raw `cs`, not the instance-projected one. That was harmless when `cs.indicators` was the authority; after Task 9 it is not, because `cs.indicators` has one key. Check each of the four for a stale read as you convert it; `:9908` in particular positions a visible DOM element and has no test.

- [ ] **Step 5: Retire the last B5 ledger row**

`SITE_COUNT` **8 → 7**; partition **`{C: 2, keep: 3, phase: 2}` — no `B5` key at all**, because `reduce` emits nothing for an empty bucket, exactly as B4 left no `B4` key. `RETIRED_BY_B5_TASK12` re-runs the `const PANES = [` anchor and demands zero, **plus** the file-existence and no-importer guards from Step 1, which a format-exact regex cannot dodge.

⚠️ Update `enumerationSites.test.js`'s **discovery-scan floor**, which B4 derived from the *B5-fated walkable files* precisely so it could not rot on an edit. Those files are now retired, so the derivation has no members and the floor collapses to zero — **a control that stops looking is a control that rots.** Re-derive it from the `keep`-fated walkable files and assert the new floor is non-zero, by name.

- [ ] **Step 6: Control audit — the largest single sweep in the phase**

```bash
grep -rn "paneMargins\|scaleMargins\|band" app/src --include=*.js --include=*.jsx | grep -i "test\|__tests__"
```

| control | what happens | what to do |
|---|---|---|
| `paneMargins.test.js` (the whole file) | subject deleted | delete; its 512-subset claim already lives in `paneLayout.test.js` — **verify that before deleting, do not assume it** |
| `paneMarginsProjection.test.js` (all 18) | subject deleted | delete; record which of its claims survived into `paneLayout.test.js` and which are genuinely gone (the identity short-circuit is genuinely gone) |
| `placement.test.js`'s `bands`-mode cases | premise deleted | delete the `bands` branch's cases with the mode; keep the `panes` twins Task 10 added |
| `binder.test.js`'s `bands` cases | ″ | ″ |
| `enumerationSites.test.js` — *"a price overlay gains no key in `paneMargins.js`"* | **file gone; the assertion may pass over nothing** | this is the classic: re-point it at `placement.pane.height` on the definitions (Task 3's twin) and prove the new form fails on a price overlay that declares one |
| `rsiFlipAParity` / `macdFlipAParity` — both import `computePaneMargins` | go **RED** | they are Flip-A transcriptions of a geometry that no longer exists. **Do not delete them**: re-point at `computePaneLayout` in `panes` mode and keep the option-object half, which is still exactly right |
| runbook §5.1 step 4 — *"give it a band if it is an oscillator; `paneMargins.js` `PANES` is the stacking list"* | **doc rot, and a doc that names a deleted file is worse than one that names a stale number** | rewrite to `placement.pane.height`; §5's whole checklist is now historical — say so at the top rather than editing ten steps into a lie |

- [ ] **Step 7: Gate — the cutover's own gate**

```bash
PYTHONIOENCODING=utf-8 python tools/chart_parity.py \
    --base-a http://127.0.0.1:5941 --base-b http://127.0.0.1:5942 \
    --dist-a .parity-dist-a --dist-b .parity-dist-b --instances-side none --repeat 20
```

**The verdict is `expect`, not zero.** It passes when, on **every one of 20 runs**:

1. each case's total **equals** its recorded `expect` — not `<=`, and not "the worst run";
2. `price_plot` equals its expectation (0 on every case, or the number the record priced);
3. `rest` is **0** on every case;
4. `manifest_diff` is exactly the declared reshape, and the committed manifest expectation matches.

Plus the standing proofs: `served == disk` on both bases; both fail-proofs exit 1 on this pair; a `--same-build` run on each dist alone reports 0 px on every case.

**Non-pixel assertions:** every case carries an `expect` and every region carries one; `paneMargins.js` and `paneMarginsProjection.js` do not exist and nothing imports them (comment-stripped, with the five-call-site non-vacuity control); the seed order is inlined; the discovery-scan floor is re-derived and non-zero; `SITE_COUNT === 7` and the partition has no `B5` key.

**Mutation gauntlet.** Selection: `src/components/chart/engine/__tests__/flipCGeometry.test.jsx src/components/chart/engine/__tests__/enumerationSites.test.js src/components/chart/engine/paneLayout.test.js` plus `tests/test_chart_parity_harness.py`

| # | file | mutation | `-t` filter | must exit 1 |
|---|---|---|---|---|
| M1 | `chart_parity_cases.json` | `rsi_only`'s `expect` N → N−1 | *(run the gate; it must FAIL)* | yes — the equality, from the low side |
| M2 | ″ | `rsi_only`'s `price_plot` expect 0 → 500 | *(run the gate)* | yes |
| M3 | `paneLayout.js` | separator budget out of pane 0 instead of the oscillators | *(run the gate; `price_plot` moves)* | yes — **the mutation §A6 exists to catch, now measured in pixels** |
| M4 | ″ | `PANE_MODE` back to `'bands'` | *(run the gate)* | yes — every case reads 0 and every `expect` is non-zero |
| M5 | `StockChart.jsx` | re-add a `computePaneMargins` import from a restored copy of the file | `nothing imports them` | yes |
| M6 | `flipCGeometry.test.jsx` | make `scanAt('<task-9-sha>')` return `[]` | `nothing imports them` | yes — the non-vacuity control |
| M7 | `enumerationSites.test.js` | `SITE_COUNT` 7 → 8 | `holds 7 live sites` | yes |
| M8 | ″ | restore the old discovery-scan floor derivation (now empty) | *(the floor's by-name assertion)* | yes — proves the floor did not silently collapse |
| M9 | `instances.js` | reverse the inlined seed order | `seed order is inlined` **and** the Task-9 order case | yes, both |
| M10 | `placement.js` | `scaleId: def.id` → `'right'` in panes mode (i.e. sub-choice (b) taken without the owner) | *(run the gate)* | yes — the axis labels appear and `osc_strip` moves off its number. **This is the mutation that proves an unpriced sub-choice cannot ship silently.** |

- [ ] **Step 8: Commit**

```bash
git add app/src/components/chart/engine/paneLayout.js tools/chart_parity_cases.json \
        app/src/components/StockChart.jsx app/src/components/chart/chartRegion.js \
        app/src/components/chart/engine/ docs/decisions/2026-08-04-flip-c-pane-geometry.md \
        docs/runbooks/chart-parity-gate.md
git rm app/src/components/chart/paneMargins.js app/src/components/chart/paneMargins.test.js \
       app/src/components/chart/engine/paneMarginsProjection.js \
       app/src/components/chart/engine/paneMarginsProjection.test.js
git commit -m "feat(chart): Flip C -- the bands are panes

One constant, the owner's three answers, and the numbers from
docs/decisions/2026-08-04-flip-c-pane-geometry.md written into the case file as
`expect`. The verdict is an EQUALITY on every run, not a budget: a tolerance would
pass a regression smaller than the allowance and hide the next change of the same
size. `price_plot` still reads 0 changed pixels -- pane 0's rectangle is preserved
by arithmetic and the separator budget comes out of the oscillators -- and `rest`,
the bucket no case can declare, is 0 everywhere.

paneMargins.js and paneMarginsProjection.js are deleted, which is the last B5
ledger row: SITE_COUNT 8 -> 7, and the partition now carries no B5 key at all.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: The whole-phase gate — the flip sets retire, the ledger stops, and Phase B is over

*(Solo. Owns everything it touches; runs last.)*

**Files:**
- Modify: `app/src/components/chart/engine/flipState.js` — **`ENGINE_MIGRATED_DEF_IDS` and `ENGINE_FLIPPED_DEF_IDS` deleted**
- Modify: every consumer (`instanceControls.js`, `instances.js`, `eligibility.js`, `StockChart.jsx`, `indicatorCatalog.js`, `flipB.test.jsx`, `enumerationSites.test.js`)
- Modify: `enumerationSites.test.js` — **SITE_COUNT 7 → 5**, partition `{C: 2, keep: 3}`
- Modify: `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` (§5, §11)
- Modify: `docs/runbooks/chart-parity-gate.md` (§5 historical, §6 gains a B5 column, §7 finalised)

**Interfaces:**
- Consumes: everything above.
- Produces: `isEngineDefinition(id, registry) → boolean` — the one predicate that replaces both sets, and it excludes `volumeProfile` **structurally** (it has no definition) rather than by omission from a hand-written list.

- [ ] **Step 1: Write the failing test**

```js
  it('the flip sets are gone; a definition IS the authority', () => {
    expect(flipState.ENGINE_MIGRATED_DEF_IDS).toBeUndefined()
    expect(flipState.ENGINE_FLIPPED_DEF_IDS).toBeUndefined()
    for (const d of engineRegistry.listDefinitions()) expect(isEngineDefinition(d.id, engineRegistry)).toBe(true)
    // volumeProfile is excluded STRUCTURALLY -- it has no definition -- rather
    // than by being absent from a list somebody has to remember to keep absent.
    expect(isEngineDefinition('volumeProfile', engineRegistry)).toBe(false)
    expect(CARVED_OUT_INDICATOR_KEYS.has('volumeProfile')).toBe(true)
  })

  it('and what took their place is immutable too — the seal claim did not just evaporate', () => {
    // ⚠️ The Global Constraint "flip sets sealed against a runtime .add()" is now
    // satisfied VACUOUSLY, which is the wrong way to satisfy a constraint. This
    // is the equivalent claim about the replacement.
    expect(Object.isFrozen(NATIVE_DEFS)).toBe(true)
    const a = engineRegistry.listDefinitions()
    a.push({ id: 'evil' })
    expect(engineRegistry.listDefinitions().map(d => d.id)).not.toContain('evil')
    // The control: Object.freeze on a Set reports frozen and still accepts .add().
    const s = Object.freeze(new Set(['x'])); s.add('y')
    expect(s.has('y')).toBe(true)
  })
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd app && npx vitest run src/components/chart/engine/__tests__/flipB.test.jsx`
Expected: FAIL — both sets still exported.

- [ ] **Step 3: Delete both sets**

Replace every `ENGINE_FLIPPED_DEF_IDS.has(id)` with `isEngineDefinition(id, registry)`; every `.size > 0` with a registry-length read; `isIndicatorEnabled(cs, defId, flippedIds)` drops its third argument (`ONE_FLIPPED = Object.freeze({has: () => true})` at `instanceControls.js:279` goes with it). `flipB.test.jsx` keeps its file and its name and becomes *"every definition is engine-drawn, and nothing else is"*.

⛔ **Do not delete `flipB.test.jsx`.** It has been the tripwire for two phases; retarget it. A rail deleted at the moment its subject changes is how this branch would lose the only thing standing between a future migration and an indicator that renders for nobody.

- [ ] **Step 4: Land the ledger at its floor**

`SITE_COUNT` **7 → 5**; partition **`{C: 2, keep: 3}`** — no `B5` key, no `phase` key. `RETIRED_BY_B5_TASK13` re-runs both `export const ENGINE_*_DEF_IDS` anchors and demands zero. **Dump all five rows and read them individually** — the mapping (A8) catches a permutation, but a reviewer still has to read the reasons, and B4's Task 12 did exactly this for fifteen.

- [ ] **Step 5: Docs — spec §5, §11, runbook §5/§6/§7**

* **spec §5** — strike the eight B5 regions; state that Flip B *and* Flip C are complete, that `paneMargins`/`chartRegion` contracts no longer need unit-testing "until Flip B completes" because it has, and that `volumeProfile` was never in the deletion. Point at `enumerationSites.test.js` for the live count and **carry no copy of the partition** — that literal has rotted green twice on this branch.
* **spec §11** — `ENGINE_ENABLED_MIGRATION` row → **RESOLVED**, naming both commits (Task 4 deleted the flag, Task 9 deleted the mirror) and correcting its own recommendation where reality differed. New **`FLIP_C_PANE_GEOMETRY`** row in the shape of the MACD and VWAP rows: the numbers, both build identities, the three sub-choices as answered, the record's path, and the tests that go red the day it moves.
* **runbook §5** — *"Migrating one more indicator"* is now historical. Say that at the top, in one line, rather than editing ten steps into a lie: there is no legacy lane to migrate off. Keep it as the record of how the fourteen were done.
* **runbook §6** — a **B5 column**: which deliverable, why `/r/chart` cannot see it, which suite is the real gate. The six chips (legend CSS-hidden, no hover) → `legendFromDefinitions.test.jsx`; the pane divider (no pointer events) → `flipCGeometry.test.jsx`; the settings migration (the route builds its own settings from `?indicators=`) → `settingsBlobMigration.test.js`; the region resolver (no `contextmenu`) → `stockChartWiring.test.jsx`.
* **runbook §7** — finalise the declared-diff gate with the real numbers Task 12 produced.

- [ ] **Step 6: The invariant sweep, each one MEASURED**

Write them as a throwaway suite, run it green, record every number, then delete it — **and only after confirming each claim is also held by a suite that stays**. B4's precedent, and its two honest notes (a `merge()` fixture that was vacuous because `JSON.stringify` drops `undefined`; `mergeSettingsOverride` skipping `undefined` at the top level only) are both re-checkable here.

| invariant | how to measure it |
|---|---|
| series pooled and reused, never destroyed | two `pool.test.js` cases under `-t`; plus `flipCGeometry`'s mode-change `toBe` |
| `applyOptions` merges; `merge()` skips `undefined` | drive the real bundle; **do not build the fixture with `JSON.stringify`** |
| an omitted `createPriceLine` option is LWC's DEFAULT | the RSI 50-line case, still 379 px if the style is dropped |
| `mergeChartSettings` is a hard allow-list at BOTH levels | assert by what it DESTROYS |
| `mergeSettingsOverride` passes primitives through untouched | and note the top-level-only `undefined` skip |
| no rounding inside compute | `compute_*_raw` fixtures at rel-tol 1e-9, all fourteen |
| every definition is engine-drawn; `volumeProfile` is not | Step 1 |
| the registry is immutable | Step 1's second case, with the `Object.freeze(new Set())` control |

- [ ] **Step 7: Gate — the whole phase**

**Run 1 — the gate at HEAD, one build two render paths.** All 44 cases, `--same-build`, `--repeat 5`. Every case at its `expect`; every region at its expectation; `rest` 0; `manifest_diff` empty (same build, same mode).

**Run 2 — the whole phase versus its branch point.** A = `084eeded` staged in place (`git show 084eeded:<path>` over every changed file, added-since files moved aside, `git diff --name-only 084eeded -- app/src` asserted EMPTY before building, restored by two-directional sha256 — **no worktree, no `git stash`**), B = HEAD, `--instances-side none` (the settings a real user has), `--repeat 5`. **This is the number the phase is judged on**: every case must equal the `expect` Task 12 recorded, and nothing else in thirteen tasks may have moved a pixel.

⚠️ **Name what is excluded rather than dropping it**, as B3 did: any case whose fixture or parameter did not exist at `084eeded` cannot be measured across the branch point. At `084eeded` all 24 live cases and both fixtures exist, so the exclusion list should be **empty** — verify that, and if it is not, say which and why.

**Run 3 — the clean-checkout reproduction.** `git clone --single-branch` → `npm ci` (**lightweight-charts 5.2.0 from the lockfile, not a junction** — `rendererPin.test.js` catches a junctioned 5.1.0) → `npm run build` → the CLONE's own `spa_server.py` and `chart_parity.py` drive the CLONE's dist. Expect byte-identical assets; if not, byte-compare both `app/src` trees before concluding anything — B4's first clean checkout differed on **52 files, CRLF-only, CONTENT 0**, and rewriting line endings alone (equivalence asserted per write) reproduced the build exactly.

**Non-pixel assertions:** the full suite green with its count recorded by command; both pytest selections; the ledger at `SITE_COUNT 5` / `{C: 2, keep: 3}` with all five rows read individually; the invariant sweep; the spec and runbook edits carrying **no copy** of any test's expected literal.

**Mutation gauntlet.** Selection: `src/components/chart/engine/__tests__/flipB.test.jsx src/components/chart/engine/__tests__/enumerationSites.test.js src/components/chart/engine/instanceControls.test.js`

| # | file | mutation | `-t` filter | must exit 1 |
|---|---|---|---|---|
| M1 | `flipState.js` | re-export `ENGINE_FLIPPED_DEF_IDS = new Set([...])` | `flip sets are gone` | yes |
| M2 | `instanceControls.js` | `isEngineDefinition` → `() => true` | `volumeProfile is excluded STRUCTURALLY` | yes |
| M3 | `nativeRegistry.js` | drop the `Object.freeze` on `NATIVE_DEFS` | `immutable too` | yes |
| M4 | ″ | make `listDefinitions()` return the internal array | `immutable too` | yes |
| M5 | `flipB.test.jsx` | delete the `Object.freeze(new Set())` control | `immutable too` | **must exit 0**, then re-apply M3 → exits 1. Designed pair: the control is a control, not the assertion. |
| M6 | `enumerationSites.test.js` | `SITE_COUNT` 5 → 7 | `holds 5 live sites` | yes |
| M7 | ″ | re-fate `RAW_DEFS` from `keep` to `C`, total preserved | `every site names its own fate` | yes |
| M8 | the spec | rename the §11 `FLIP_C_PANE_GEOMETRY` row's id | *(the spec-anchor probe)* | yes — **word-boundary token, not `toContain`**: `toContain('X')` is satisfied by `X_DRAFT`, which passed 1,626 tests once |
| M9 | the runbook | restore a partition literal into §5.3 | *(the no-literal probe)* | yes |
| M10 | `chart_parity_cases.json` | flip one case's `expect` to 0 | *(run the gate)* | yes |

- [ ] **Step 8: Commit**

```bash
git add app/src/components/chart/engine/ app/src/components/StockChart.jsx \
        app/src/components/chart/indicatorCatalog.js \
        docs/superpowers/specs/2026-07-31-indicator-platform-design.md \
        docs/runbooks/chart-parity-gate.md
git commit -m "refactor(engine): the flip sets retire -- Phase B's migration is over

Their ledger fate is `phase`: deleted when the migration is complete, and Flip C
is when it completes. Leaving them would be a row whose fate describes a condition
that has already arrived -- a control that rots green. Every consumer becomes a
registry lookup, which is MORE correct than the sets were: volumeProfile is
excluded structurally, because it has no definition, rather than by being absent
from a list somebody has to remember to keep absent.

The 'sealed against a runtime .add()' constraint is now satisfied vacuously, which
is the wrong way to satisfy a constraint, so it is replaced by the equivalent
claim about the replacement -- with the control that Object.freeze on a Set
reports frozen and still accepts .add().

Ledger SITE_COUNT 5, {C: 2, keep: 3} -- no B5 key, no phase key.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review against the spec

**Spec coverage.** §5's Flip C ("ONE atomic, feature-flagged cutover from margin-bands to real LWC panes, with dedicated visual QA on all four theme surfaces and a rollback flag") → Tasks 10–12; the flag is `PANE_MODE` and it is the rollback. §5's "`paneMargins`/`chartRegion` contracts stay unit-tested until Flip B completes" → Task 12's control audit retires both. §5's "remaining 11" migrations → Tasks 5–8 (ten; `volumeProfile` is §11-carved-out, A10). §5's settings-migration safeguards R4.1–R4.3 → Task 9 (passthrough already shipped at B2; the read-time migrator is golden-tested against real blobs; the write path merges by `instanceId`). §5's "pane HANDLES, never indices" → **partially deviated and stated**: `series.moveToPane(paneIndex)` takes a NUMBER in LWC 5.2.0 (`typings.d.ts:2606`), so the plan uses indices at the call and `getPane()` handles for reading; the manifest asserts the result. §6's "drag divider" → Task 10 (`enableResize`), "move-to submenu" and "auto-remove empty panes" → **out of scope, stated**: the first is Phase C's per-pane UX, the second is asserted (disabling an oscillator removes its pane). §9.3's "Flip B gets its own four-surface QA" → Task 11's screenshots are the *measurement*; the four theme surfaces are a manual owner check listed in the decision record's §5, because the parity preset is `classic_flat` by design and re-theming it would invalidate every baseline. §11's `volumeProfile`, `MACD_HEAD_MASK` and `VWAP_SESSION_ANCHOR` rows → untouched, and Task 1 fixes the one stale comment guarding the first.

**Two spec deviations, both deliberate and both recorded above:** the pane-handle wording, and the four-surface QA being an owner checklist rather than a gate.

**Placeholder scan.** No "TBD", no "similar to Task N", no "add appropriate error handling". Every code step carries code. The two places a number is genuinely unknown until it is measured — `SEPARATOR_PX` and the Flip-C pixel counts — say exactly which command produces them, what to do if the answer is surprising, and what is forbidden as a response.

**Type consistency.** `computePaneLayout(cs, instances, opts)` and `paneManifest(chart, bindings)` keep their signatures across Tasks 3, 10, 11 and 12. `PANE_MODE` lives in `paneLayout.js` throughout. `isEngineDefinition(id, registry)` is introduced in Task 13 and used nowhere earlier. `chipsFrom(entries, seriesData, registry, inputsFor)` and `engineChips(bindings, seriesData, registry, instances)` are unchanged by this plan. `resolvePlacement`'s return shape `{paneIndex, scaleId, scaleOptions, autoscale}` is unchanged; only `ctx` grows a `paneLayout` key.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-04-phase-b5-cutover.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration. Wave 1 (Tasks 2 and 3) is the only pair that may run concurrently; everything else is solo for the reasons in the parallelism table.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints for review.

**Which approach?**




