# UCT Phase B4 — Surfaces & UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the indicator library dialog and the auto-generated settings UI from spec §6, and retire the enumeration regions Phase B3 handed to B4 (the `B4` bucket of `enumerationSites.test.js` — that assertion is the count; this plan does not carry a second copy of it) — so that adding a sixteenth indicator costs one definition and zero list edits.

**Architecture:** Every list of indicator NAMES in the app becomes a projection of `engine/nativeRegistry.listDefinitions()` through one new derivation module, `chart/indicatorCatalog.js`. Every list of indicator CONTROLS becomes a projection of that definition's declared `inputs[]` through the already-proven `fieldsFromDefinition` (B3 Task 12). Every WRITE keeps routing through the one writer B3 established, `engine/instanceControls.js`, so the new surfaces are not new control doors. **B4 migrates no indicator and flips no indicator** — the four pilots stay the whole migrated set, `ENGINE_FLIPPED_DEF_IDS === ENGINE_MIGRATED_DEF_IDS` holds at every commit, and the open `ENGINE_ENABLED_MIGRATION` decision therefore stays harmless and stays open (§ "Adjudications", below).

**Tech Stack:** React 18 + Vite, lightweight-charts 5.2.0 (pinned; `rendererPin.test.js` catches a junctioned 5.1.0), vitest (`cd app && npx vitest run <paths>` — **never** `npm test -- run`), pytest, Playwright + Pillow via `tools/chart_parity.py`, `tools/spa_server.py`.

**Branch:** `feat/phase-b3-migration`, from `d2733adc`. B4 commits onto the same branch. **Do not push** (the deploy-window hook and the Sep 5 ship gate both apply; B1–B4 ship together after the launch freeze lifts).

**Baseline at `d2733adc`, to be re-measured and recorded in Task 1 before anything is changed:**

```bash
cd app && npx vitest run                       # 4,070 tests / 409 files, exit 0
cd .. && python -m pytest tests/test_indicator_compute.py tests/test_indicator_golden.py \
    tests/test_indicator_alert_evaluator.py tests/test_indicator_alert_service.py   # 67, exit 0
python -m pytest tests/test_chart_parity_harness.py tests/test_chart_markers.py \
    tests/test_chart_news.py tests/test_chart_health_alerts.py \
    tests/test_admin_chart_health.py tests/test_charts_layout_service.py            # the "chart pytest" set
```

⚠️ The branch reports the chart set as **84**; the six files above collect **86** at `d2733adc`. That is a two-test discrepancy between a prose number and a command, which is the exact drift this branch's ledger exists to end. **Task 1 records the command AND its measured count**, and every later task compares against that recorded number, not against the prose.

---

## Global Constraints

Copied verbatim; every task's requirements implicitly include this section.

**Renderer and binding**

- **Series are POOLED and REUSED, never destroyed and recreated** (lightweight-charts issue #2049, mass-`removeSeries`, is OPEN). A colour change or a period change RESTYLES the same series object.
- **`applyOptions` MERGES and `merge()` skips `undefined`** — the complete key set is the only reset mechanism, for scales AND for series. A partial option bag leaves the previous value standing.
- **An omitted SERIES option means "keep what's there"; an omitted `createPriceLine` option means "use LWC's DEFAULT."** (Measured: an omitted `lineStyle` on RSI's 50-line came out LWC-default Dashed against the shipped `largeDashed` — 379 changed pixels.)
- **`mergeChartSettings` is a hard allow-list (TWO of them)** — the per-key list in `chartDefaults.js:335-413` and `mergeSettingsOverride`'s `_OVERRIDE_SECTION_KEYS` — **and `mergeSettingsOverride` passes primitives through untouched.** A new flag therefore needs a strict read at the consumer too; it cannot rely on the merge to normalise it.
- **`paneMargins.js` is consumed, never modified.** `enumerationSites.test.js` asserts a price overlay gains no key there. The engine reaches it only through `engine/paneMarginsProjection.csForPaneMargins`.
- **`FLIPPED === MIGRATED` today, and `flipB.test.jsx` asserts it.** If a change migrates a definition without flipping it, that test goes red **by design**. See "What to do when `flipB.test.jsx` goes red", below — the alternative is a double-drawn indicator.
- **No rounding inside compute — ever.** Delivery wrappers round; `plots[].precision` and `plots[].legend.decimals` are display config. Fixtures compare at rel-tol 1e-9 and there is no surviving exception.
- **Every parity number names BOTH build identities**, and the harness byte-compares served-vs-disk on both bases before any capture (`--dist-a` / `--dist-b`, mandatory for a dist base, no `--skip`).

**Process**

- Frontend tests: `cd app && npx vitest run <paths>`. **NEVER `npm test -- run`.**
- `-t` filters are REGEX. `Ctrl+I` matches nothing useful (`+` quantifies the `l`). Choose test titles free of `+ ? ( ) [ ] * . | ^ $` and pick the filter by reading the suite, not a document.
- Restore a mutated file with `git checkout -- <path>`. **`git show HEAD:<path>` is NOT a byte-restore in this CRLF worktree** (`core.autocrlf=true`; the blob is LF).
- Python subprocess readers must be pinned to `encoding='utf-8', errors='replace'` — the default is cp1252 here and vitest prints box-drawing characters.
- pytest mutation runs need `PYTHONDONTWRITEBYTECODE=1` (a same-size mutation within one second imports the previous mutation's `.pyc`).
- Never create a git worktree for a build comparison. Stage side A **in place** with `git show <sha>:<path>`, build, then restore from a `cp -r` backup with a two-directional sha256 comparison. (`rm -rf` on a `node_modules` junction has recursed into the shared tree four times on this branch. Safe removal: PowerShell `(Get-Item $junction).Delete()`.)

**The mutation gauntlet — the protocol every task's gate step runs**

A mutation runner on this branch has scored perfectly while executing zero tests **twelve distinct ways**, most recently CONTROL A itself reporting `passed=None` because vitest colours its summary. Every gauntlet therefore runs, in this order:

1. **PREFLIGHT.** For every mutation, read the target file as BYTES, assert the search pattern matches **exactly once** (`count == 1`), and assert the post-substitution bytes differ from the original. Refuse the whole run otherwise. Patterns are read from the file, never passed as argv strings with `\n` escapes.
2. **CONTROL A.** Run the unmutated selection. Require exit 0 **and** a parsed non-zero `passed` count, from ANSI-stripped stdout (`re.sub(r'\x1b\[[0-9;]*m', '', out)`, then `(\d+) passed`). **Abort on zero.**
3. **CONTROL B, once per mutation.** Run the unmutated selection **with that mutation's `-t` filter**. Require exit 0 **and** a non-zero `passed` count. A non-matching `-t` exits 0 with "N skipped" — rc alone is not a control.
4. **Apply, run, restore.** Verdict is the **process EXIT CODE**, never a grep of the summary. Restore in a `finally`, and if the run is interrupted, re-check `git status` before trusting anything.
5. A survivor is REAL until proven equivalent by measurement, and an equivalence proof is itself a test.

**What to do when `flipB.test.jsx` goes red**

`flipB.test.jsx` asserts `ENGINE_FLIPPED_DEF_IDS` **equals** `ENGINE_MIGRATED_DEF_IDS`. No task in this plan migrates a definition, so it should never fire. If it does, exactly two responses are legal:

- **Flip it in the same change** (the runbook §5.1 step 2 rule, and this phase's standing rule). This is the default and the cheap one.
- **If the definition genuinely cannot be flipped in that change**, STOP and ship the versioned read-time `engineEnabled` migration FIRST, in its own commit, with its own gate driven from a JSON string, and re-run all 24 parity cases with both build identities — because `mergeChartSettings` is on every chart's path. Then restore StockChart's Flip-A `hidden` projection and its `legacyEnabled` helper, which Task 11 of B3 deleted as unreachable precisely because the two sets were equal (`flipState.js:98-102` names this).

⛔ **The third response — relaxing the assertion from "equals" to "is a subset" — is forbidden.** It converts the only rail standing between B4 and an indicator that renders for nobody back into a comment. `docs/decisions/2026-08-03-engine-enabled-settings-migration.md` §4.1 is what that red test exists to send the reader to.

---

## Adjudications this plan makes

### A1 — `ENGINE_ENABLED_MIGRATION`: **not a B4 task. B4 adopts "migrate and flip together" and ships no settings migration.**

The record's §8 recommendation is conditional: ship the versioned read-time migration *only if B4 needs a migrated-but-un-flipped definition.* **It does not.** The twenty regions are retired by DERIVING name lists and control lists from definitions that already exist for all fourteen series-expressible natives — derivation needs a *definition*, not a *migration*. The one region that looked like it forced four more migrations is the legend rewrite (Task 10), and it is resolved by giving the legacy lane the same chip-formatting pipeline the engine lane already has, keyed by `defId::plotKey`, rather than by moving four indicators onto the engine (§A3).

So: `FLIPPED === MIGRATED` holds at every B4 commit, §3 of the record ("what a real stored blob does on ship day — it works") stays true unchanged, the record stays **OPEN**, and the flag is deleted at B5 with the rest of `cs.indicators`. Task 1 writes that decision INTO the record as a dated B4 section and adds the rail that makes it failable: *you may not create a migrated-but-un-flipped definition while this record says OPEN.*

**How B4 avoids stranding users, precisely:** it never creates the category that strands them. `engineActive = engineOn || ENGINE_FLIPPED_DEF_IDS.size > 0` keeps all four pilots drawing for every existing blob; nothing in B4 adds a definition to `ENGINE_MIGRATED_DEF_IDS`; and the new rail fails the suite if anything tries. The new surfaces read through `isIndicatorEnabled(cs, id, ENGINE_FLIPPED_DEF_IDS)` and write through `instanceControls`, which mirrors to `cs.indicators.<id>` — so a definition that is NOT migrated is still switched by the legacy toggle its legacy block reads, exactly as today.

### A2 — Ledger site 15, `paneMargins.PANES`: **the dispute is upheld. Its fate becomes B5.**

B3's Task 13 recorded the dispute rather than correcting it, because "which phase does future work" is a planning call. This is that call, and it goes to B5 for two independent reasons:

1. **By the file's own fate legend.** `PANES` is a layout table — ten `{key, enabled, baseH}` rows handing each enabled oscillator a stacked band. It has nothing to do with the §6 dialog, the legend, the control doors or the voice bus. It retires when bands stop being bands, which is Flip C.
2. **B4 is forbidden from touching it.** "`paneMargins.js` is consumed, never modified" is a Global Constraint of this phase and an assertion in `enumerationSites.test.js`. A site the phase may not modify cannot have that phase's fate. The engine still *depends* on it: `csForPaneMargins` projects instance state into `cs` so `computePaneMargins` can read it.

Partition after this re-fate alone: `{B4: 19, B5: 8, keep: 2, phase: 2}`; after A4's it is `{B4: 18, B5: 8, C: 1, keep: 2, phase: 2}`. Task 1 lands both as two lines plus the assertion.

### A3 — the legend rewrite does NOT require four more migrations.

`legChips` renders nine chips; six of them (`stochK`, `stochD`, `atr`, `sar`, `ichimokuTenkan`, `ichimokuKijun`) belong to definitions still on the legacy lane. Rendering `engineChips()` directly, as `readout.js`'s header promises, would delete those six chips for every user.

The resolution is to notice what `engineChips` actually does: it turns *(a series, a definition, an instance's inputs)* into *(label, colour, decimals, text)*. Only the first of those three is engine-specific. So B4 extracts the formatting half and feeds it a **second** series source — a `Map<'<defId>::<plotKey>', {series, lastValue}>` that StockChart populates where each legacy series is already created. That is one argument added at existing `addSeries` call sites inside render blocks that are already on the ledger as B5, so it creates **no new enumeration region** (the discovery scan's ≥4-ids rule is satisfied: those ids are in StockChart, which is already on the ledger). `LEGACY_SLOTS`, the crosshair value fields and the hand-written chip array all go, together, and one formatting pipeline drives both lanes — which is also spec §6's "ONE formatting pipeline drives Style-tab precision, chip values, and crosshair readout".

### A4 — `indicator_alert_evaluator.INDICATOR_FUNCS`: **deferred to Phase C, re-fated `C`, with the reason recorded.**

It is a dict of eight Python closures. It cannot be derived from JS definitions, and spec §8 says the evaluator is **rebuilt in C** (closed-bar evaluation, `prev` derived from the computed series, `last_value` demoted to delivery-dedup). Deriving it in B4 would mean porting compute for six more indicators into a lane C is about to replace, against spec §9.5's explicit "no eager 15-indicator port".

What B4 *can* do, and does (Task 9): stop it being a **twin**. The frontend's `INDICATORS` and `CONDITIONS` are deleted and served from the module that owns the evaluation, so the dropdown can never offer an alert that cannot fire. `INDICATOR_FUNCS` becomes the single naming authority — which is what `keep`-fated sites like `RAW_DEFS` are — but it is genuinely scheduled work, not a permanent list, so it gets its own fate letter rather than being mislabelled `keep`. The ledger's fate legend gains one line.

Final partition after B4: **`{B5: 8, C: 1, keep: 2, phase: 2}`**, `SITE_COUNT = 13`.

### A5 — `colorMode: 'column:<key>'` stays validated-but-inert; `volumeProfile` stays permanently carved out.

Neither is touched. `volumeProfile` has a settings section and no definition, so every generated list in this plan is *definitions ∪ `CARVED_OUT_INDICATOR_KEYS`* rather than *definitions* — otherwise the generated toolbar and settings surfaces would silently drop its row, which is the user-facing regression B3 Task 11 refused. `enumerationSites.test.js`'s named-exemption rail already fails if a sixteenth section appears without a definition.

### A6 — spec §6 says the library opens on **Ctrl/Cmd+I**. That key is RSI's toggle. **The library opens on `Alt+Shift+A`.**

`keyboardShortcuts.SHORTCUTS` already declares `{ keys: 'Alt+Shift+A', command: 'addindicator', description: 'Add indicator (settings)' }`, and `StockChart.jsx:3410` already handles it — it currently opens the whole settings modal. B4 re-points it at the library dialog, which is what its description has always said it does. Rebinding `Ctrl+I` away from RSI would change a shipped shortcut that four control doors and the ledger's site 14/15 all describe, to gain nothing. Recorded as a deliberate deviation from spec §6's entry-point list; the other two entry points (a labelled "Indicators" toolbar button, right-click "Add indicator…") ship as specified.

### A7 — the label diff. There is no single existing convention, so B4 picks one and prints the diff.

Today six lists label the same indicator six ways. `IND_OPTS` says `Bollinger Bands` and `Stochastic`; `ChartToolbar.OSC` says `Stoch` and `W%R`; `OSC_OPTS` says `Stochastic` and `Williams %R`; `INDICATOR_LABELS` says `Stochastic` and `Williams %R`; the toolbar's fifteen rows say `Stoch` and `Williams %R`. **The convention B4 adopts: menus, region titles and compact strips use `meta.shortName`; the library dialog and the generated settings rows use `meta.name`.** The complete visible diff, which Task 2 pins as a test and Tasks 3–4 apply:

| id | surface | today | after B4 |
|---|---|---|---|
| `bb` | right-click **Indicators ▸** | Bollinger Bands | **BB** |
| `stoch` | right-click **Indicators ▸** | Stochastic | **Stoch** |
| `stoch` | right-click **Overlay on volume ▸** | Stochastic | **Stoch** |
| `stoch` | region title / **Hide `<label>`** | Stochastic | **Stoch** |
| `williamsR` | right-click **Overlay on volume ▸** | Williams %R | **%R** |
| `williamsR` | region title / **Hide `<label>`** | Williams %R | **%R** |
| `williamsR` | toolbar overlay strip | W%R | **%R** |
| — | right-click **Indicators ▸** | 8 entries | **15 entries** (every definition + `volumeProfile`) |

Nothing else in any of the six lists changes a character.

---

## File structure

**Created**

| File | Responsibility |
|---|---|
| `app/src/components/chart/indicatorCatalog.js` | The single derivation: definitions + carved-out keys → `{id, name, shortName, category, target, carvedOut}` rows, plus `labelFor` / `oscillatorIds` / `priceOverlayIds`. No React, no LWC. |
| `app/src/components/chart/indicatorCatalog.test.js` | Pins the derivation character-for-character against the six lists it replaces, including the A7 diff. |
| `app/src/components/chart/IndicatorLibraryDialog.jsx` | The spec §6 browse/add surface. `Sheet variant="auto"`, search-first, add-and-stay-open, checkmarks, category groups, About/repaint/tier badges. |
| `app/src/components/chart/IndicatorLibraryDialog.module.css` | Its styles. |
| `app/src/components/chart/IndicatorLibraryDialog.test.jsx` | Behavioural gate for the dialog. |
| `app/src/components/chart/engine/__tests__/generatedSettingsRows.test.jsx` | The generalised `fieldsFromDefinition` gate — every definition, every declared input, one control each. |
| `app/src/components/chart/engine/__tests__/legendFromDefinitions.test.jsx` | The legend rewrite's DOM gate, with a per-chip legacy control. |
| `app/src/components/chart/engine/__tests__/controlDoorCensus.test.js` | The eighth-door detector. |
| `api/routers/indicator_alerts_catalog.py` *(or an added route on the existing router — Task 9 decides by reading it)* | Serves the alert catalog derived from `INDICATOR_FUNCS`. |

**Modified**

| File | Change |
|---|---|
| `app/src/components/chart/engine/__tests__/enumerationSites.test.js` | Re-fate site 15 (A2) and site 18 (A4); drop each retired site and lower `SITE_COUNT`; replace `ENGINE_ROW_DEF_IDS`'s rail with its successor; add the no-migration-without-a-flip rail. |
| `app/src/components/chart/engine/nativeRegistry.js` | `meta.description` + `meta.tags` on all 14 definitions; `plots[].legend` on the six chip-bearing legacy plots. **No compute, no plot style, no colour, no bound changes.** |
| `app/src/components/chart/engine/readout.js` | `LEGACY_SLOTS` deleted; `chipsFor(seriesEntries, seriesData, registry, instancesOrSettings)` extracted; `engineChips` becomes a thin caller. |
| `app/src/components/chart/indicatorRegistry.js` | `ENGINE_ROW_DEF_IDS` deleted; `listEngineIndicators` iterates the registry; carved-out rows added. |
| `app/src/components/chart/ChartSettingsModal.jsx` | Renders the generated rows for every definition; hosts the library dialog's launcher. |
| `app/src/components/chart/ChartToolbar.jsx` | `OSC` derived; the fifteen rows replaced by "Manage indicators →"; `engineInert`/`inertTitle`/`shownInput` retire with them. |
| `app/src/components/chart/chartRegion.js` | `INDICATOR_LABELS` deleted; callers use `indicatorCatalog.labelFor`. |
| `app/src/components/chart/keyboardShortcuts.js` | `SHORTCUTS`' five indicator rows and `matchShortcut`'s Ctrl branch derived from one `INDICATOR_CHORDS` table. |
| `app/src/components/chart/IndicatorAlertPopover.jsx` | `INDICATORS` + `CONDITIONS` deleted; both come from the served catalog. |
| `app/src/components/StockChart.jsx` | `IND_OPTS`, `OSC_OPTS`, the `i-hide` label, `handleCopyShareUrl`, the `toggle:` switch, the Alt block, the crosshair value fields and `legChips` — all derived or deleted. |
| `app/src/utils/chartBus.js` | `ALLOWED_INDICATORS` derived. |
| `api/services/indicator_alert_evaluator.py` | Gains `ALERT_CONDITIONS` + `alert_catalog()` next to `INDICATOR_FUNCS`. |
| `docs/decisions/2026-08-03-engine-enabled-settings-migration.md` | A dated **B4 adjudication** section (status stays OPEN). |
| `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` | §5's B4 inheritance sentence and §11's `ENGINE_ENABLED_MIGRATION` row updated to what B4 decided. |
| `docs/runbooks/chart-parity-gate.md` | §5.3's "twenty ledger regions wait on it" updated; a new §6 for the B4 surfaces' non-pixel gates. |

---

## What the pixel gate can and cannot see in this phase

Stated once, because it applies to every task and the honest answer is uncomfortable.

`tools/chart_parity.py` drives the headless `/r/chart` route, which mounts `ChartRender`. **That route renders no toolbar, no settings modal, no context menu, no library dialog, and it has no cursor — so it draws no legend chips either.** Most of the regions B4 retires are therefore structurally invisible to it — every one that lives in a toolbar, a menu, a modal or the help sheet, and the twelfth (the legend) is invisible for the reason `readout.js`'s header already records: a headless capture has no crosshair, so no chip is drawn on either side and the diff is 0 whether the rewrite is right or wrong.

That does not make the gate optional. Every task in this plan touches at least one module on every chart's render path — `chartDefaults`, `nativeRegistry`, `StockChart`, `readout` — so the 24-case set at **0 changed pixels, 5/5 runs, both build identities named** is this phase's *regression* gate, and its own failability is proven each run by the two standing self-tests:

```bash
# fail-proof #1 — the whole settings -> instance -> eligibility chain
python tools/chart_parity.py --base-a $A --base-b $B --dist-a app/dist --dist-b app/dist \
    --cases flipb_vwap_only --perturb-b '{"indicators": {"vwap": {"opacity": 40}}}'
# expect: 2,601 changed pixels, exit 1

# fail-proof #2 — the candle path, on the intraday fixture
python tools/chart_parity.py --base-a $A --base-b $B --dist-a app/dist --dist-b app/dist \
    --cases intraday_bars_only --perturb-b '{"candles": {"upColor": "#1ae51a"}}'
# expect: 1,953 changed pixels, exit 1
```

⚠️ Both numbers were measured on the `f0c9af1d6b93 → 23d4be835cbe` pair. A B4 task's own pair will differ; what must hold is **non-zero and exit 1**, and the task records the number it saw next to the pair it saw it on. A perturbation that reports 0 is a vacuous self-test, not a pass.

⚠️ Six live cases still carry the latent bistable last-price line (one row, ~12 dash boundaries, both sides, no mechanism). If a task's run reports ~24 px on one row of one case, that is it — attribute it by measurement per the runbook's §"The 24-pixel artefact", do not add a `--tolerance`, and re-run.

---

### Task 1: The B4 ledger — adjudicate site 15, defer site 18, and make "no migration without a flip" a rail that can fail

**Files:**
- Modify: `app/src/components/chart/engine/__tests__/enumerationSites.test.js` (fate legend lines 68-74; site 15 lines 118-119; site 18 lines 146-147; the partition assertion lines 220-223)
- Modify: `docs/decisions/2026-08-03-engine-enabled-settings-migration.md` (append §10)
- Modify: `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` (§5's B4 inheritance sentence; §11's `ENGINE_ENABLED_MIGRATION` row)

**Interfaces:**
- Consumes: `ENGINE_MIGRATED_DEF_IDS`, `ENGINE_FLIPPED_DEF_IDS` from `engine/flipState.js`.
- Produces: the partition `{B4: 18, B5: 8, C: 1, keep: 2, phase: 2}` with `SITE_COUNT = 31`, which every later task decrements; and the rail `creates no migrated-but-un-flipped definition while the settings migration is open`.

- [ ] **Step 1: Record the baseline, by command, before touching anything**

```bash
cd /c/Users/Patrick/uct-worktrees/phase-b2-engine
cd app && npx vitest run 2>&1 | tail -8
cd ..
python -m pytest tests/test_indicator_compute.py tests/test_indicator_golden.py \
    tests/test_indicator_alert_evaluator.py tests/test_indicator_alert_service.py -q 2>&1 | tail -3
python -m pytest tests/test_chart_parity_harness.py tests/test_chart_markers.py \
    tests/test_chart_news.py tests/test_chart_health_alerts.py \
    tests/test_admin_chart_health.py tests/test_charts_layout_service.py -q 2>&1 | tail -3
```

Expected at `d2733adc`: **4,070 tests / 409 files**, **67**, **86**. Write all three commands and their exact counts into §10 of the decision record (Step 5) — `.superpowers/` is gitignored, so a scratch file does not survive into the repo, and this branch has already lost one corrected account that way. **If vitest is not 4,070/409, stop**: the tree is not the tree this plan was written against.

- [ ] **Step 2: Write the failing test — the two re-fates**

In `enumerationSites.test.js`, extend the fate legend (currently lines 68-74) with the new letter:

```js
//   'C'     the Phase-C alert-engine rebuild (spec §8): closed-bar evaluation,
//           `prev` derived from the computed series, `last_value` demoted to
//           delivery-dedup. A dict of Python closures cannot be derived from a
//           JS definition, and porting six more computes into a lane C is about
//           to replace is what spec §9.5 ("no eager 15-indicator port") forbids.
//           B4 collapsed its FRONTEND TWIN into it; retiring the list is C's.
```

Change site 15's fate and say why in place:

```js
  // ⭐ B4 ADJUDICATION (2026-08-03). Task 13 recorded a dispute and deliberately
  // left it: PANES is labelled B4, but by this file's own legend it is B5.
  // UPHELD, for two independent reasons. It is a LAYOUT table — ten
  // {key,enabled,baseH} rows handing each enabled oscillator a stacked band —
  // and it retires when bands stop being bands, which is Flip C. And B4 is
  // FORBIDDEN from modifying paneMargins.js at all: a site a phase may not touch
  // cannot carry that phase's fate. The engine still DEPENDS on it, through
  // `engine/paneMarginsProjection.csForPaneMargins`.
  { file: 'app/src/components/chart/paneMargins.js', region: 'PANES — the oscillator stacking list, 9 + volume',
    anchor: 'const PANES = [', fate: 'B5' },
```

Change site 18's fate:

```js
  { file: 'api/services/indicator_alert_evaluator.py', region: "INDICATOR_FUNCS — the evaluator, and after B4 the alert catalog's ONE authority",
    anchor: 'INDICATOR_FUNCS: dict[str,', fate: 'C' },
```

And the partition:

```js
  it('the retirement column adds up — 18 to B4, 8 to B5, 1 to C, 2 kept, 2 phase bookkeeping', () => {
    const counts = LEDGER.reduce((acc, s) => ({ ...acc, [s.fate]: (acc[s.fate] || 0) + 1 }), {})
    expect(counts).toEqual({ B4: 18, B5: 8, C: 1, keep: 2, phase: 2 })
  })
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/enumerationSites.test.js
```

Expected: FAIL on `the retirement column adds up`, received `{B4: 20, B5: 7, keep: 2, phase: 2}`. Everything else green.

- [ ] **Step 4: Apply the two fate strings and re-run to green**

Only the two `fate:` literals plus their comments. Re-run the command from Step 3: PASS.

- [ ] **Step 5: Add the rail that makes A1 failable**

Append to the `what B3 retired` describe block in the same file:

```js
  // ⛔⭐ THE RAIL THAT STOPS B4 STRANDING USERS.
  // `docs/decisions/2026-08-03-engine-enabled-settings-migration.md` §4.1: a
  // MIGRATED-but-UN-FLIPPED definition needs `cs.engineEnabled`, NO existing user
  // has it, and flipping the default cannot give it to them — so that definition
  // is engine-drawn for NOBODY. The category is empty today, and B4's
  // adjudication A1 is that it stays empty. `flipB.test.jsx` asserts the two sets
  // are EQUAL; this asserts WHY, reads the record's own Status line, and names
  // the file to open. CLOSING the record is what makes this negotiable — until
  // then it is not, and a "subset" relaxation turns the rail back into a comment.
  it('creates no migrated-but-un-flipped definition while the settings migration is open', () => {
    const record = read('docs/decisions/2026-08-03-engine-enabled-settings-migration.md')
    const stillOpen = /\*\*Status:\*\*[^\n]*\bOPEN\b/.test(record)
    const stranded = [...ENGINE_MIGRATED_DEF_IDS].filter(id => !ENGINE_FLIPPED_DEF_IDS.has(id))
    expect({ stillOpen, stranded },
      'A definition was migrated without being flipped while ENGINE_ENABLED_MIGRATION is OPEN. ' +
      'It is engine-drawn ONLY on a chart with cs.engineEnabled === true, and NO stored blob has ' +
      'that. Either flip it in this same change, or ship the versioned read-time migration FIRST ' +
      '(record §6 R1a, its own commit, gated from a JSON string) and re-run all 24 parity cases. ' +
      'Do NOT weaken this assertion to a subset check.',
    ).toEqual({ stillOpen: true, stranded: [] })
  })
```

⚠️ Anchor the Status regex on the record's actual bold `**Status:**` line, not on a bare `OPEN` — the file contains the word "OPEN" in prose several times, and a loose match would pass after the record is resolved.

- [ ] **Step 6: Write §10 of the decision record**

```markdown
## 10. B4's adjudication — 2026-08-03

**Status is UNCHANGED: OPEN.** B4 does not resolve this record. It removes the
condition under which resolving it would have been urgent.

§8's recommendation is conditional — ship the versioned read-time migration *if
B4 needs a migrated-but-un-flipped definition.* **B4 does not need one.** Its
nineteen ledger regions are retired by DERIVING name lists and control lists from
definitions that already exist for all fourteen series-expressible natives.
Derivation needs a *definition*; only rendering needs a *migration*. The one
region that appeared to force four more migrations — the legend rewrite, whose
six remaining chips belong to `stoch`, `atr`, `sar` and `ichimoku` — is resolved
instead by giving the LEGACY lane the same chip-formatting pipeline the engine
lane already has, keyed `<defId>::<plotKey>`, so both lanes read one definition.

Therefore `ENGINE_FLIPPED_DEF_IDS === ENGINE_MIGRATED_DEF_IDS` holds at every B4
commit, §3 ("what a real stored blob does on ship day — it works") stays true
unchanged, and §8.2's default recommendation stands: **require
migrate-and-flip-together; delete the flag at B5.**

**Made failable, not asserted.** `enumerationSites.test.js` → *"creates no
migrated-but-un-flipped definition while the settings migration is open"* reads
this file's Status line and both flip sets together. It goes red on the day
someone migrates without flipping AND this record still says OPEN — which is
exactly the pair of facts that produces an indicator rendering for nobody.

**B4's baseline, by command.** The branch's prose says "84 chart pytest"; the
command below collects 86 at `d2733adc`. Recorded here because a prose count is
the thing this branch keeps having to correct.

| command | count at `d2733adc` |
|---|---|
| `cd app && npx vitest run` | *(fill in)* |
| `pytest tests/test_indicator_compute.py tests/test_indicator_golden.py tests/test_indicator_alert_evaluator.py tests/test_indicator_alert_service.py` | *(fill in)* |
| `pytest tests/test_chart_parity_harness.py tests/test_chart_markers.py tests/test_chart_news.py tests/test_chart_health_alerts.py tests/test_admin_chart_health.py tests/test_charts_layout_service.py` | *(fill in)* |
```

- [ ] **Step 7: Update the spec's two places**

In §5, replace the sentence beginning *"**B4 inherits, precisely:**"* with the nineteen-region list — the same enumeration minus `paneMargins.PANES` — and add: *"`paneMargins.PANES` was re-adjudicated to **B5** by the B4 plan (a layout table B4 is forbidden from modifying), and `indicator_alert_evaluator.INDICATOR_FUNCS` to **C** (spec §8 rebuilds the evaluator; B4 collapses its frontend twin into it)."*

In §11's `ENGINE_ENABLED_MIGRATION` row, append to the Basis cell: *"**B4 (2026-08-03): adopted §8.2 — migrate-and-flip-together; no settings migration ships in B4; the record stays OPEN and the flag is deleted at B5.** Railed by `enumerationSites.test.js`'s no-stranding assertion, which reads this row's decision from the record's own Status line."*

- [ ] **Step 8: Gate**

**Pixels: none, and that claim is checkable.** This task changes tests and documents only. Assert it: `git diff --name-only d2733adc` must contain no path under `app/src` outside `__tests__/`. No bundled byte can move, so no parity run is warranted and running one would only spend an hour proving the harness still works.

**Non-pixel assertions:** the partition assertion in `enumerationSites.test.js` is green with `B4` DECREMENTED by the two re-fates and the other four buckets unchanged (⛔ **the expected value is not written here** — this line used to carry `{B4: 19, …}`, which sums to 32 and cannot hold with `SITE_COUNT = 31`; a gate that restates a test's literal is a control that rots, and this one rotted before the task it gates was finished); every anchor still appears exactly once; the discovery scan still finds ≥ 11 modules; the no-stranding rail passes; and both the spec row and the record still carry `ENGINE_ENABLED_MIGRATION` as a **delimited token** (`\bENGINE_ENABLED_MIGRATION\b` — `toContain` is satisfied by `ENGINE_ENABLED_MIGRATION_DRAFT`, which passed 1,626 tests on this branch).

**Mutation gauntlet.** Protocol as in Global Constraints. Selection:
`src/components/chart/engine/__tests__/enumerationSites.test.js src/components/chart/engine/__tests__/engineEnabledMigration.test.js`

| # | file mutated | mutation | `-t` filter | must exit 1 |
|---|---|---|---|---|
| M1 | `enumerationSites.test.js` | site 15 `fate: 'B5'` → `fate: 'B4'` | `retirement column adds up` | yes |
| M2 | `enumerationSites.test.js` | site 18 `fate: 'C'` → `fate: 'B4'` | `retirement column adds up` | yes |
| M3 | `engine/flipState.js` | `new Set(['rsi', 'bb', 'macd', 'vwap'])` → `new Set(['rsi', 'bb', 'macd', 'vwap', 'stoch'])` **on the MIGRATED line only** | `no migrated-but-un-flipped` | yes — this is the rail's whole purpose |
| M4 | the decision record | the `**Status:**` line's `OPEN` → `RESOLVED` | `no migrated-but-un-flipped` | yes (the assertion is the PAIR, so either half moving must fire) |
| M5 | `enumerationSites.test.js` | `const SITE_COUNT = 31` → `30` | `still where it says it is` | yes |

⚠️ M3's pattern appears twice in `flipState.js` (both sets are the same literal), so PREFLIGHT's exactly-once rule will REFUSE it as written. Anchor it on the surrounding text instead:
`export const ENGINE_MIGRATED_DEF_IDS = Object.freeze(new Set(['rsi', 'bb', 'macd', 'vwap']))` → the same line with `, 'stoch'` inserted. That is a unique match, and its uniqueness is exactly what the preflight is for.

⚠️ Run M3 twice: once with `flipB.test.jsx` OUT of the selection (proving THIS rail fires) and once with it IN (proving the older rail also fires). Two rails on one fact is the design; a single run cannot tell you which one caught it.

- [ ] **Step 9: Commit**

```bash
git add app/src/components/chart/engine/__tests__/enumerationSites.test.js \
        docs/decisions/2026-08-03-engine-enabled-settings-migration.md \
        docs/superpowers/specs/2026-07-31-indicator-platform-design.md
git commit -m "test(ledger): B4 adjudicates site 15 to B5 and site 18 to C, and rails the stranding case

paneMargins.PANES is a layout table B4 is forbidden from modifying, so it cannot
carry B4's fate; INDICATOR_FUNCS is a dict of Python closures that spec section 8
rebuilds in C. The partition is the assertion in enumerationSites.test.js; it is
not restated here, because every later B4 task decrements its B4 bucket.

The new rail reads the decision record's Status HEADER line (isolated and
counted) and asserts FLIPPED === MIGRATED in BOTH directions, plus that neither
set accepts a runtime write,
so migrating a definition without flipping it while ENGINE_ENABLED_MIGRATION is
OPEN is a red test rather than an indicator that renders for nobody.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `indicatorCatalog.js` — one derived list, pinned character-for-character against the six lists it replaces

Runbook §5.1 step 1 applied to a derivation instead of a migration: **write the transcription suite first and run it before changing any call site.** A failure here is a derivation-vs-shipped disagreement arriving early and for free, instead of as a copy change nobody reviewed.

**Files:**
- Create: `app/src/components/chart/indicatorCatalog.js`
- Create: `app/src/components/chart/indicatorCatalog.test.js`
- Modify: `app/src/components/chart/engine/nativeRegistry.js` — add `meta.description` and `meta.tags` to all 14 definitions (Task 7 needs them; they land here so exactly one commit touches the registry's meta)

**Interfaces:**
- Consumes: `engine/nativeRegistry.listDefinitions()`, `engine/nativeRegistry.CARVED_OUT_INDICATOR_KEYS`.
- Produces, for Tasks 3, 4, 5, 6, 7, 8, 9 and 11:
  - `catalogRows(registry?) → Array<{id, name, shortName, category, target, carvedOut, description, tags}>` in registry order, carved-out rows appended.
  - `labelFor(id, registry?) → string` — `meta.shortName`, falling back to the id.
  - `longLabelFor(id, registry?) → string` — `meta.name`, falling back to the id.
  - `oscillatorIds(registry?) → string[]` — `placement.target === 'pane'`, registry order.
  - `priceOverlayIds(registry?) → string[]` — `placement.target === 'price'`, registry order.
  - `CARVED_OUT_ROWS` — the frozen hand-written rows for keys with no definition (today: `volumeProfile`).

- [ ] **Step 1: Write the failing transcription test**

`app/src/components/chart/indicatorCatalog.test.js`. It pins the SHIPPED strings first, then the A7 diff, so the diff is a decision in the file rather than a silent drift.

```js
import { describe, it, expect } from 'vitest'
import {
  catalogRows, labelFor, longLabelFor, oscillatorIds, priceOverlayIds, CARVED_OUT_ROWS,
} from './indicatorCatalog'
import { CHART_DEFAULTS } from './chartDefaults'
import * as engineRegistry from './engine/nativeRegistry'

// ─── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
// Six shipped lists label the same indicator six ways. There is no convention to
// preserve, so B4 PICKS one — menus, region titles and compact strips take
// `meta.shortName`; the library dialog and the generated settings rows take
// `meta.name` — and this file is where the resulting visible diff is a DECISION
// somebody wrote down, not a string that changed under a refactor.

describe('the catalog covers every settings section, and nothing else', () => {
  it('has one row per definition plus one per carved-out key, in registry order', () => {
    const rows = catalogRows()
    const defIds = engineRegistry.listDefinitions().map(d => d.id)
    expect(rows.filter(r => !r.carvedOut).map(r => r.id)).toEqual(defIds)
    expect(rows.filter(r => r.carvedOut).map(r => r.id)).toEqual([...engineRegistry.CARVED_OUT_INDICATOR_KEYS])
    // …and together they are exactly the settings blob's sections. A sixteenth
    // section with neither a definition nor a carve-out row would silently lose
    // its control on every surface this catalog now feeds.
    expect([...rows.map(r => r.id)].sort()).toEqual(Object.keys(CHART_DEFAULTS.indicators).sort())
  })

  it('splits by placement target, not by a hand-written list', () => {
    expect(oscillatorIds()).toEqual(['rsi', 'macd', 'stoch', 'atr', 'mfi', 'cci', 'williamsR', 'adx', 'obv'])
    expect(priceOverlayIds()).toEqual(['bb', 'vwap', 'sar', 'ichimoku', 'donchian'])
    // Every definition is one or the other — `volume` is a target too, but no
    // NATIVE declares it (the migrator assigns it from cs.volumeOverlayIndicators).
    const both = [...oscillatorIds(), ...priceOverlayIds()].sort()
    expect(both).toEqual(engineRegistry.listDefinitions().map(d => d.id).sort())
  })
})

describe('the labels the six replaced lists showed — pinned, then diffed', () => {
  // Copied VERBATIM from the shipped source at d2733adc.
  const SHIPPED = {
    IND_OPTS: { rsi: 'RSI', macd: 'MACD', bb: 'Bollinger Bands', vwap: 'VWAP', stoch: 'Stochastic', atr: 'ATR', obv: 'OBV', adx: 'ADX' },
    OSC_OPTS: { rsi: 'RSI', macd: 'MACD', stoch: 'Stochastic', atr: 'ATR', mfi: 'MFI', cci: 'CCI', williamsR: 'Williams %R', adx: 'ADX', obv: 'OBV' },
    TOOLBAR_OSC: { rsi: 'RSI', macd: 'MACD', stoch: 'Stoch', atr: 'ATR', mfi: 'MFI', cci: 'CCI', williamsR: 'W%R', adx: 'ADX', obv: 'OBV' },
    INDICATOR_LABELS: { rsi: 'RSI', macd: 'MACD', stoch: 'Stochastic', atr: 'ATR', cci: 'CCI', williamsR: 'Williams %R', mfi: 'MFI', adx: 'ADX', obv: 'OBV' },
  }

  // ⭐ THE COMPLETE VISIBLE DIFF (plan adjudication A7). Eight cells, and the
  // eighth is a list GROWING. If a change adds a ninth, this table is where it
  // has to be argued for.
  const DIFF = [
    ['bb',        'IND_OPTS',         'Bollinger Bands', 'BB'],
    ['stoch',     'IND_OPTS',         'Stochastic',      'Stoch'],
    ['stoch',     'OSC_OPTS',         'Stochastic',      'Stoch'],
    ['stoch',     'INDICATOR_LABELS', 'Stochastic',      'Stoch'],
    ['williamsR', 'OSC_OPTS',         'Williams %R',     '%R'],
    ['williamsR', 'INDICATOR_LABELS', 'Williams %R',     '%R'],
    ['williamsR', 'TOOLBAR_OSC',      'W%R',             '%R'],
  ]

  it('reproduces every shipped label except the seven this plan changes', () => {
    const changed = new Set(DIFF.map(([id, list]) => `${list}::${id}`))
    const drift = []
    for (const [list, table] of Object.entries(SHIPPED)) {
      for (const [id, was] of Object.entries(table)) {
        if (changed.has(`${list}::${id}`)) continue
        if (labelFor(id) !== was) drift.push(`${list}.${id}: shipped ${was}, derived ${labelFor(id)}`)
      }
    }
    expect(drift, 'a label moved that adjudication A7 did not sign off').toEqual([])
  })

  it('changes exactly the seven cells A7 names, to exactly the values it names', () => {
    for (const [id, list, was, now] of DIFF) {
      expect(labelFor(id), `${list}.${id}`).toBe(now)
      expect(labelFor(id), `${list}.${id} did not actually change`).not.toBe(was)
    }
  })

  it('the long label is meta.name, and it is what the library and the settings rows show', () => {
    expect(longLabelFor('rsi')).toBe('Relative Strength Index')
    expect(longLabelFor('stoch')).toBe('Stochastic Oscillator')
    expect(longLabelFor('vwap')).toBe('Session VWAP')
    // …and it is NOT the short one, or the two accessors are one accessor.
    expect(longLabelFor('rsi')).not.toBe(labelFor('rsi'))
  })

  it('the carved-out row carries the label its shipped toolbar row showed', () => {
    expect(CARVED_OUT_ROWS.map(r => [r.id, r.shortName])).toEqual([['volumeProfile', 'Vol Profile']])
  })
})

describe('the library needs a sentence per indicator, and the schema already allows one', () => {
  it('every definition declares a non-empty description and at least one tag', () => {
    const missing = engineRegistry.listDefinitions()
      .filter(d => !(typeof d.meta.description === 'string' && d.meta.description.trim().length >= 20)
                || !(Array.isArray(d.meta.tags) && d.meta.tags.length))
      .map(d => d.id)
    expect(missing,
      'the library dialog shows a one-line "what it tells you" per row (spec §6 novice layer). ' +
      'A row with no sentence renders a blank line, which is worse than no row.',
    ).toEqual([])
  })

  it('and adding them did not break registration — every definition still validates', () => {
    expect(engineRegistry.listDefinitions().length).toBe(14)
    for (const d of engineRegistry.listDefinitions()) {
      expect(d.meta.tier).toBe('free')
      expect(d.meta.repaint).toBe('non-repainting')
    }
  })
})
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

```bash
cd app && npx vitest run src/components/chart/indicatorCatalog.test.js
```

Expected: FAIL with `Failed to resolve import "./indicatorCatalog"`. That is the only acceptable first failure — a failure inside `nativeRegistry` at this point means the registry moved, not the catalog.

- [ ] **Step 3: Write the module**

```js
// app/src/components/chart/indicatorCatalog.js
//
// ─── THE ONE LIST ───────────────────────────────────────────────────────────
//
// Every surface that used to hand-write indicator NAMES reads this instead:
// the right-click menus, the region titles, the volume-overlay strips, the
// keyboard chords, the share link, the settings rows, the library dialog, the
// alert dropdown and the voice bus. `indicatorRegistry.js` is the CONTROLS half
// of the same idea (`fieldsFromDefinition`); this is the IDENTITY half.
//
// ⚠️ IT IS NOT `listDefinitions()` WITH A WRAPPER. It is definitions ∪
// CARVED_OUT_INDICATOR_KEYS. `volumeProfile` is a settings section with no
// definition (spec §11, B3 A4: it draws to a sibling 2D canvas, not through
// `addSeries`) and it has a shipped toolbar row. A generated list built from
// definitions alone silently DROPS that row — the user-facing regression B3
// Task 11 refused when it was asked to delete VWAP's row.
//
// ⚠️ LABELS. Six shipped lists labelled the same indicator six ways. B4's
// convention: menus, region titles and compact strips take `shortName`; the
// library dialog and the generated settings rows take `name`. The seven cells
// that visibly change are pinned in `indicatorCatalog.test.js`.

import * as defaultRegistry from './engine/nativeRegistry'

/** A settings section with no engine definition. Hand-written BY NAME, so a
 *  sixteenth one has to be argued for here rather than joining a silent
 *  exemption — the same rule `CARVED_OUT_INDICATOR_KEYS` is written under. */
export const CARVED_OUT_ROWS = Object.freeze([
  Object.freeze({
    id: 'volumeProfile',
    name: 'Volume Profile',
    shortName: 'Vol Profile',
    category: 'Volume',
    target: 'canvas',
    carvedOut: true,
    description: 'Traded volume binned by price over the visible range, with the point of control marked.',
    tags: Object.freeze(['volume', 'profile']),
  }),
])

function defs(registry) {
  const r = registry || defaultRegistry
  return typeof r.listDefinitions === 'function' ? r.listDefinitions() : []
}

function rowFor(def) {
  const meta = def.meta || {}
  return {
    id: def.id,
    name: meta.name || def.id,
    shortName: meta.shortName || def.id,
    category: meta.category || 'Other',
    target: (def.placement && def.placement.target) || 'pane',
    carvedOut: false,
    description: meta.description || '',
    tags: Array.isArray(meta.tags) ? meta.tags : [],
  }
}

/** Every indicator the settings blob has a section for, in registry order, with
 *  the carved-out ones appended. */
export function catalogRows(registry) {
  return [...defs(registry).map(rowFor), ...CARVED_OUT_ROWS]
}

function find(id, registry) {
  return catalogRows(registry).find(r => r.id === id) || null
}

/** Menus, region titles, compact strips. */
export function labelFor(id, registry) {
  const row = find(id, registry)
  return row ? row.shortName : id
}

/** The library dialog and the generated settings rows. */
export function longLabelFor(id, registry) {
  const row = find(id, registry)
  return row ? row.name : id
}

/** The sub-pane oscillators — the ones that can be overlaid on the volume pane.
 *  DERIVED from `placement.target`, which is what `resolvePlacement` reads, so
 *  the menu and the renderer can never disagree about what "an oscillator" is. */
export function oscillatorIds(registry) {
  return defs(registry).filter(d => d.placement && d.placement.target === 'pane').map(d => d.id)
}

/** The overlays that share the candles' pane and scale. Registry order IS legacy
 *  render order and LWC z-stacks by insertion — see `flipState.js`. */
export function priceOverlayIds(registry) {
  return defs(registry).filter(d => d.placement && d.placement.target === 'price').map(d => d.id)
}
```

- [ ] **Step 4: Add `description` + `tags` to the fourteen definitions**

In `nativeRegistry.js`, extend each `nativeDef(...)`'s meta object. `defSchema.validateMeta` already accepts both (`description` at line 471, `tags` at line 481) and unknown meta keys are ignore-and-preserve, so **no schema change is needed**. Exact copy, one line each — these are the strings the library dialog shows:

```js
  rsi:       description: 'Momentum on a 0-100 scale: how much of recent movement has been up.',        tags: ['oscillator', 'momentum']
  macd:      description: 'The gap between two moving averages, and how fast that gap is changing.',    tags: ['oscillator', 'momentum', 'trend']
  bb:        description: 'A moving average with volatility bands, so you can see when range is unusual.', tags: ['overlay', 'volatility', 'bands']
  vwap:      description: 'The session\'s volume-weighted average price — where the day\'s money traded.', tags: ['overlay', 'volume', 'session']
  stoch:     description: 'Where price closed inside its recent high-low range, smoothed.',             tags: ['oscillator', 'momentum']
  atr:       description: 'Average size of a bar\'s true range — a volatility number in price units.',  tags: ['volatility']
  sar:       description: 'A trailing dot that flips side when the trend does.',                        tags: ['overlay', 'trend', 'stops']
  ichimoku:  description: 'A trend system in one picture: two averages, a projected cloud and a lagging line.', tags: ['overlay', 'trend']
  mfi:       description: 'RSI weighted by volume — momentum that only counts when size shows up.',     tags: ['oscillator', 'volume', 'momentum']
  cci:       description: 'How far price sits from its own average, in units of its typical deviation.', tags: ['oscillator', 'momentum']
  williamsR: description: 'Where price closed in its recent range, on a -100 to 0 scale.',              tags: ['oscillator', 'momentum']
  adx:       description: 'How strong the trend is, regardless of direction, with the two directional lines.', tags: ['trend', 'strength']
  obv:       description: 'A running volume total that adds on up bars and subtracts on down bars.',    tags: ['volume', 'accumulation']
  donchian:  description: 'The highest high and lowest low of the last N bars, as a channel.',          tags: ['overlay', 'breakout', 'channel']
```

⛔ **Change nothing else in this file.** No compute, no plot, no colour, no bound, no `legend` block (Task 10 owns those). `nativeRegistry.test.js`'s key-by-key `CHART_DEFAULTS` assertion and the four `*FlipAParity.test.js` transcription suites must all stay green untouched — if one moves, a meta edit reached something behavioural.

- [ ] **Step 5: Run to green**

```bash
cd app && npx vitest run src/components/chart/indicatorCatalog.test.js \
  src/components/chart/engine/nativeRegistry.test.js \
  src/components/chart/engine/__tests__/rsiFlipAParity.test.js \
  src/components/chart/engine/__tests__/bbFlipAParity.test.js \
  src/components/chart/engine/__tests__/macdFlipAParity.test.js \
  src/components/chart/engine/__tests__/vwapFlipAParity.test.js
```

Expected: all PASS. The four parity suites are the control — they read the whole option object with `toEqual`, so a meta edit that leaked into a plot fails them.

- [ ] **Step 6: Check the discovery scan did not just gain a site**

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/enumerationSites.test.js
```

`indicatorCatalog.js` names **zero** indicator ids in source (it derives them all), so the ≥ 4-ids discovery scan must NOT flag it. If it does, the module has a hardcoded list in it and the whole task is void — read the scan's message, which names the file.

- [ ] **Step 7: Gate**

**Pixels: 0 changed pixels, all 24 cases, 5/5 runs, both build identities named.** Run it: `meta` is on every definition and `registerDefinitions` walks it at import, so a validation regression here blanks every engine indicator on every chart. Build side A from `d2733adc` in place (`git show d2733adc:<path>`, no worktree), build side B at this task's HEAD, serve both on fresh ports, and let `--dist-a`/`--dist-b` byte-compare served-vs-disk before any capture.

```bash
cd app && npm run build && cd ..
python tools/spa_server.py app/dist 5701 &     # fresh port; nine stale servers
B=http://127.0.0.1:5701                        # were once listening at once
python tools/chart_parity.py --base-a $B --base-b $B --dist-a app/dist --dist-b app/dist \
    --same-build --repeat 5
```

Then the fail-proof (`flipb_vwap_only`, `--perturb-b '{"indicators": {"vwap": {"opacity": 40}}}'`): **non-zero, exit 1**. Record the number and the pair.

**Non-pixel assertions:** the seven-cell diff is exactly seven cells; every non-diffed shipped label round-trips; `oscillatorIds()`/`priceOverlayIds()` partition the fourteen; the catalog's id set equals `Object.keys(CHART_DEFAULTS.indicators)`; every definition has a ≥ 20-character description and ≥ 1 tag.

**Mutation gauntlet.** Selection: `src/components/chart/indicatorCatalog.test.js src/components/chart/engine/nativeRegistry.test.js`

| # | file | mutation | `-t` filter | must exit 1 |
|---|---|---|---|---|
| M1 | `indicatorCatalog.js` | `labelFor` returns `row.name` instead of `row.shortName` | `reproduces every shipped label` | yes |
| M2 | `indicatorCatalog.js` | `catalogRows` drops `...CARVED_OUT_ROWS` | `one row per definition plus one per carved-out` | yes — this is the volumeProfile regression |
| M3 | `indicatorCatalog.js` | `oscillatorIds` filters `target !== 'price'` instead of `=== 'pane'` | `splits by placement target` | yes |
| M4 | `nativeRegistry.js` | delete `stoch`'s `description` | `every definition declares a non-empty description` | yes |
| M5 | `indicatorCatalog.js` | `longLabelFor` returns `row.shortName` | `the long label is meta.name` | yes |
| M6 | `indicatorCatalog.test.js` | remove the `williamsR/TOOLBAR_OSC` row from `DIFF` | `reproduces every shipped label` | yes — proves the diff table is load-bearing and not decoration |

⚠️ M6 is the anti-theatre mutation. Without it, `DIFF` could be an empty array with a comment and both label tests would still pass by vacuity.

- [ ] **Step 8: Commit**

```bash
git add app/src/components/chart/indicatorCatalog.js \
        app/src/components/chart/indicatorCatalog.test.js \
        app/src/components/chart/engine/nativeRegistry.js
git commit -m "feat(chart): one derived indicator catalog, pinned against the six lists it replaces

Definitions union CARVED_OUT_INDICATOR_KEYS, so volumeProfile keeps its row.
labelFor is shortName (menus, titles, strips), longLabelFor is name (library,
settings rows). The seven visible label cells that change are a table in the
test, not a drift. Definitions gain meta.description and meta.tags, which
defSchema already validated, for the library dialog's one-line blurb.

No call site switched yet: the transcription suite runs first, exactly as the
runbook's per-indicator checklist does it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The two right-click doors, the region titles and the two `OSC` copies — five regions, one catalog

Retires ledger sites: `StockChart.IND_OPTS`, `StockChart.OSC_OPTS`, `StockChart` right-click **Hide `<label>`**, `chartRegion.INDICATOR_LABELS`, `ChartToolbar.OSC`. **B4 count 18 → 13.**

**Files:**
- Modify: `app/src/components/StockChart.jsx:2212` (`IND_OPTS`), `:2223` (`OSC_OPTS`), `:2252-2256` (region title + `i-hide`)
- Modify: `app/src/components/chart/chartRegion.js:67-78` (delete `INDICATOR_LABELS`)
- Modify: `app/src/components/chart/ChartToolbar.jsx:483` (`OSC`)
- Modify: `app/src/components/chart/engine/__tests__/enumerationSites.test.js` (drop 5 sites, `SITE_COUNT` 31 → 26, and decrement the partition's `B4` bucket by the 5 retired — ⛔ this line used to say `B4: 14`, contradicting Step 5 below; **Step 5 is the instruction**, and the test is the authority)
- Modify: `app/src/components/chart/engine/__tests__/stockChartWiring.test.jsx` (the menu cases)
- Modify: `app/src/components/chart/chartRegion.test.js` if it references `INDICATOR_LABELS`

**Interfaces:**
- Consumes: `catalogRows`, `labelFor`, `oscillatorIds` from Task 2.
- Produces: nothing new. `chartRegion.resolveChartRegion` still returns `{type:'indicator', key}`; its consumers now call `labelFor(key)` instead of reading a table that lived next to it.

- [ ] **Step 1: Write the failing tests**

Add to `stockChartWiring.test.jsx` (which already mounts the real component and drives its context menu):

```js
  it('the Indicators submenu offers every settings section, not a hand-picked eight', () => {
    const H = renderChart({ settings: mergeChartSettings(null) })
    const items = openContextMenu(H, { region: 'price' }).find(s => s.id === 'indicators').submenu
    // ⭐ FIFTEEN, not eight. sar / ichimoku / mfi / cci / williamsR / donchian /
    // volumeProfile had definitions and settings sections and no way into this
    // menu — the exact cost of a hand-written list, measured.
    expect(items.map(i => i.id)).toEqual(catalogRows().map(r => 'ind-' + r.id))
    expect(items.map(i => i.label)).toEqual(catalogRows().map(r => r.shortName))
    // …and the A7 diff, spelled out where a reviewer sees it:
    expect(items.find(i => i.id === 'ind-bb').label).toBe('BB')
    expect(items.find(i => i.id === 'ind-stoch').label).toBe('Stoch')
  })

  it('the volume-overlay submenu offers exactly the pane oscillators that are ON', () => {
    const cs = mergeChartSettings({ volume: { visible: true }, indicators: { rsi: { enabled: true }, bb: { enabled: true } } })
    const H = renderChart({ settings: cs })
    const sub = openContextMenu(H, { region: 'volume' }).find(s => s.id === 'voloverlay').submenu
    // bb is ON and is a PRICE overlay: it shares the candles' scale and cannot be
    // moved into the volume pane. Deriving from placement.target is what keeps
    // that true without a second list saying so.
    expect(sub.map(i => i.id)).toEqual(['vo-rsi'])
  })

  it('right-click Hide names the indicator the way every other menu does', () => {
    const H = renderChart({ settings: mergeChartSettings({ indicators: { williamsR: { enabled: true } } }) })
    const sec = openContextMenu(H, { region: 'indicator', key: 'williamsR' })
    // A7: 'Williams %R' -> '%R'. One label, four surfaces, one source.
    expect(sec.find(s => s.id === 'region').title).toBe('%R')
    expect(sec.find(s => s.id === 'region').items[0].label).toBe('Hide %R')
  })

  it('and Hide routes at the ONE writer, for a flipped id and an un-flipped one alike', () => {
    for (const id of ['rsi', 'stoch']) {
      const cs = mergeChartSettings({ indicators: { [id]: { enabled: true } } })
      const H = renderChart({ settings: cs })
      openContextMenu(H, { region: 'indicator', key: id }).find(s => s.id === 'region').items[0].onSelect()
      const next = H.lastSettings()
      expect(isIndicatorEnabled(next, id, ENGINE_FLIPPED_DEF_IDS), id).toBe(false)
      // The MIRROR is what an un-flipped id's legacy block reads. Both, always.
      expect(next.indicators[id].enabled, `${id} mirror`).toBe(false)
    }
  })
```

⚠️ `renderChart` / `openContextMenu` are this suite's existing helpers — read them before writing, do not invent a second harness. If `openContextMenu` does not take a region argument today, extend it rather than reaching into the component.

Add to `chartRegion.test.js`:

```js
  it('exports no label table — the region resolver returns a KEY and the catalog names it', () => {
    // The resolver is pure geometry. A label table living beside it was an
    // enumeration site in a file whose whole point is not knowing about
    // indicators.
    expect(Object.keys(chartRegion)).not.toContain('INDICATOR_LABELS')
  })
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/stockChartWiring.test.jsx \
  src/components/chart/chartRegion.test.js
```

Expected: the four new wiring cases fail on the eight-entry `IND_OPTS`, on `Williams %R`, and on `Stochastic`; the `chartRegion` case fails because the export exists.

- [ ] **Step 3: Replace the five regions**

`StockChart.jsx` — delete both literals and derive:

```jsx
    // Every settings section, labelled once, in registry order. Adding a
    // definition adds a menu entry; there is no second place to edit.
    const indicatorsItem = {
      id: 'indicators', label: <><UIcon name="breadth" size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />Indicators</>, kind: 'submenu',
      submenu: catalogRows().map((row) => ({
        id: 'ind-' + row.id, label: row.shortName, kind: 'toggle', checked: indEnabled(row.id),
        onSelect: () => setIndEnabled(row.id, !indEnabled(row.id)),
      })),
    }
```

```jsx
    // "Overlay on volume": a PANE oscillator that is currently ON. `placement.target`
    // is what `resolvePlacement` reads, so the menu and the renderer agree by
    // construction — a price overlay (bb/vwap/sar/ichimoku/donchian) shares the
    // candles' scale and can never be moved here.
    const enabledOsc = oscillatorIds().filter((key) => indEnabled(key))
```
…and the submenu maps `key => ({ id: 'vo-' + key, label: labelFor(key), … })`.

```jsx
    } else if (region.type === 'indicator') {
      const key = region.key
      const label = labelFor(key)
```

`chartRegion.js` — delete the `INDICATOR_LABELS` export and its comment. Leave `resolveChartRegion` untouched, including the `key === 'volume'` branch.

`ChartToolbar.jsx` — replace the `OSC` literal:

```jsx
          // …the same derivation the right-click menu uses, so the two strips
          // cannot drift. `isOn` stays the reader (a FLIPPED id's legacy toggle
          // is the mirror, not the switch).
          const enabled = oscillatorIds().filter((k) => isOn(k))
```
…and the checkbox row renders `labelFor(k)` with `title={`Render ${labelFor(k)} inside the volume pane`}`.

- [ ] **Step 4: Run to green, then audit the controls that just rotted**

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/stockChartWiring.test.jsx \
  src/components/chart/chartRegion.test.js src/components/chart/ChartToolbar.engineInert.test.jsx
```

⚠️ **Controls rot at every change of this kind, and the dangerous ones stay GREEN.** Before declaring this green, run the audit the runbook §5.2 prescribes, adapted from a flip to a derivation:

```bash
grep -rn "Bollinger Bands\|'Stochastic'\|Williams %R\|W%R\|INDICATOR_LABELS\|IND_OPTS\|OSC_OPTS" \
  app/src --include=*.jsx --include=*.js
```

Read every hit's stated REASON, not its assertion. Any case whose comment says *"the right-click menu lists eight"* or *"an indicator with no menu entry"* has had its premise deleted and is now vacuous — invert it to the direction it can now be wrong in (e.g. *"a definition with no menu entry is impossible"*), do not just update the number. Record how many rotted and how many of them stayed green.

- [ ] **Step 5: Drop the five sites from the ledger**

Delete the five entries, set `SITE_COUNT = 26`, and change the partition assertion's title and value to `{B4: 13, B5: 8, C: 1, keep: 2, phase: 2}`.

⚠️ The discovery scan will now look at `StockChart.jsx` and `ChartToolbar.jsx` and still find ≥ 4 ids in each (their other regions remain), so both stay on the ledger — that is correct, not a miss. But `chartRegion.js` should now name **zero**; if the scan still flags it, a label table came back.

- [ ] **Step 6: Gate**

**Pixels: 0 changed pixels, all 24 cases, 5/5, both build identities.** The parity route mounts no context menu and no toolbar, so **the gate cannot see this change at all** — its 0 here is a regression check on `StockChart.jsx`, which it renders in full. That distinction is the point: a 0 on this task is evidence the render path is unharmed, and evidence of **nothing** about the menus. Fail-proof as in the standing block; record the number and the pair.

**Non-pixel assertions (this is where the task actually lives):** the Indicators submenu has 15 entries with the catalog's ids and short labels; the overlay submenu excludes an enabled PRICE overlay; the region title and `Hide <label>` read `%R`; Hide routes through `setIndicatorEnabled` for a flipped AND an un-flipped id and moves the mirror in both; `chartRegion` exports no label table.

**Mutation gauntlet.** Selection: `src/components/chart/engine/__tests__/stockChartWiring.test.jsx src/components/chart/chartRegion.test.js`

| # | file | mutation | `-t` filter | must exit 1 |
|---|---|---|---|---|
| M1 | `StockChart.jsx` | Indicators submenu maps `oscillatorIds()` instead of `catalogRows()` | `offers every settings section` | yes — the five price overlays vanish from the menu |
| M2 | `StockChart.jsx` | overlay submenu filters `catalogRows()` instead of `oscillatorIds()` | `exactly the pane oscillators` | yes — BB becomes overlay-able onto a pane it cannot reach |
| M3 | `StockChart.jsx` | `Hide` label uses `longLabelFor` | `names the indicator the way every other menu does` | yes |
| M4 | `StockChart.jsx` | `Hide`'s `onSelect` writes `setCs('indicators.' + key + '.enabled', false)` directly | `routes at the ONE writer` | yes — this is the raw-write defect that bit Alt+U and the settings row |
| M5 | `indicatorCatalog.js` | `catalogRows` returns definitions only | `offers every settings section` | yes — volumeProfile loses its menu entry |
| M6 | `enumerationSites.test.js` | `SITE_COUNT = 26` → `31` | `still where it says it is` | yes |

⚠️ M4 must be checked against **both** ids in the loop. B3 measured that a predicate no row consults cannot be caught lying about that row; the same applies here — if the loop only ran `rsi`, the mirror assertion would pass for the wrong reason (a flipped id's writer mirrors anyway).

- [ ] **Step 7: Commit**

```bash
git add app/src/components/StockChart.jsx app/src/components/chart/chartRegion.js \
        app/src/components/chart/ChartToolbar.jsx \
        app/src/components/chart/engine/__tests__/stockChartWiring.test.jsx \
        app/src/components/chart/chartRegion.test.js \
        app/src/components/chart/engine/__tests__/enumerationSites.test.js
git commit -m "refactor(chart): five name lists become one catalog read

IND_OPTS, OSC_OPTS, the right-click Hide label, chartRegion.INDICATOR_LABELS and
ChartToolbar's OSC copy all read indicatorCatalog now. The Indicators submenu
grows 8 -> 15 because six definitions and one carved-out section had a settings
row and no way into that menu. Seven labels change, exactly the seven adjudication
A7 names. Ledger 31 -> 26 sites, B4 18 -> 13.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The keyboard — four regions, one chord table

Retires ledger sites: `keyboardShortcuts.SHORTCUTS`' indicator rows, `matchShortcut`'s Ctrl branch, `StockChart`'s `toggle:` switch, `StockChart`'s Alt block. **B4 count 13 → 9.**

The four indicator chords are `Ctrl+I` rsi, `Ctrl+O` macd, `Ctrl+B` bb, `Alt+U` vwap — across four regions in two files, which is the under-count B3 corrected three times (two → three → four). They stay exactly four keys; what changes is that one table declares them, `matchShortcut` matches from it, and one dispatch consumes them.

**Files:**
- Modify: `app/src/components/chart/keyboardShortcuts.js` (`SHORTCUTS` lines 99-101 + 93; `matchShortcut` lines 151-160)
- Modify: `app/src/components/StockChart.jsx:3383-3389` (Alt+U), `:3541-3565` (the `toggle:` switch), `:3408-3414` (Alt+Shift+A — re-pointed in Task 7, left alone here)
- Modify: `app/src/components/chart/keyboardShortcuts.test.js`
- Modify: `app/src/components/chart/engine/__tests__/enumerationSites.test.js`

**Interfaces:**
- Consumes: `labelFor`, `catalogRows` from Task 2.
- Produces: `INDICATOR_CHORDS` from `keyboardShortcuts.js` — `Object.freeze([{ defId, keys, code, modifier }])`, where `modifier` is `'ctrl'` or `'alt'`. Task 7 reads nothing from it; Task 12's door census does.

- [ ] **Step 1: Write the failing test**

```js
// app/src/components/chart/keyboardShortcuts.test.js
import { INDICATOR_CHORDS, SHORTCUTS, matchShortcut } from './keyboardShortcuts'
import { labelFor } from './indicatorCatalog'
import * as engineRegistry from './engine/nativeRegistry'

describe('the four indicator chords are declared once', () => {
  // ⚠️ FOUR, across two modifiers. The ledger said two, then three, then four —
  // each correction from someone reading the code. Alt+U is the one that keeps
  // getting missed, because `matchShortcut` REJECTS Alt and its live handler is
  // StockChart's own e.altKey block.
  it('names exactly the four, with their real modifiers', () => {
    expect(INDICATOR_CHORDS.map(c => [c.defId, c.keys, c.modifier])).toEqual([
      ['rsi',  'Ctrl+I', 'ctrl'],
      ['macd', 'Ctrl+O', 'ctrl'],
      ['bb',   'Ctrl+B', 'ctrl'],
      ['vwap', 'Alt+U',  'alt'],
    ])
  })

  it('every chord names a definition that exists', () => {
    const known = new Set(engineRegistry.listDefinitions().map(d => d.id))
    expect(INDICATOR_CHORDS.filter(c => !known.has(c.defId)).map(c => c.defId)).toEqual([])
  })

  it('the help sheet rows are GENERATED from it, description included', () => {
    for (const c of INDICATOR_CHORDS) {
      const row = SHORTCUTS.find(s => s.keys === c.keys)
      expect(row, c.keys).toBeTruthy()
      expect(row.command).toBe('toggle:' + c.defId)
      expect(row.description).toBe('Toggle ' + labelFor(c.defId))
    }
  })

  it('matchShortcut resolves the Ctrl chords from the table, and still rejects Alt', () => {
    expect(matchShortcut({ ctrlKey: true, key: 'i' })).toBe('toggle:rsi')
    expect(matchShortcut({ ctrlKey: true, key: 'o' })).toBe('toggle:macd')
    expect(matchShortcut({ ctrlKey: true, key: 'b' })).toBe('toggle:bb')
    // ⛔ Alt is still rejected here on purpose — browser Alt shortcuts keep
    // working, and StockChart's own block is the live handler. If this ever
    // returns a command, the Alt block and the switch will BOTH fire.
    expect(matchShortcut({ altKey: true, code: 'KeyU', key: 'u' })).toBe(null)
    // …and the non-indicator Ctrl chords are untouched.
    expect(matchShortcut({ ctrlKey: true, key: 'm' })).toBe('toggle:ma')
    expect(matchShortcut({ ctrlKey: true, key: 'v' })).toBe('toggle:volume')
  })
})
```

And in `stockChartWiring.test.jsx`:

```js
  it('one dispatch serves every indicator chord, Ctrl and Alt alike', () => {
    for (const c of INDICATOR_CHORDS) {
      const cs = mergeChartSettings({ indicators: { [c.defId]: { enabled: false } } })
      const H = renderChart({ settings: cs })
      pressChord(H, c)                       // ctrlKey or altKey per c.modifier
      const next = H.lastSettings()
      expect(isIndicatorEnabled(next, c.defId, ENGINE_FLIPPED_DEF_IDS), c.keys).toBe(true)
      expect(next.indicators[c.defId].enabled, `${c.keys} mirror`).toBe(true)
      // #2049: toggling must never leave the chart holding two copies.
      expect(H.seriesFor(c.defId).length, `${c.keys} series count`).toBe(H.expectedSeriesFor(c.defId))
    }
  })

  it('a chord for a definition with no legacy block still toggles the instance', () => {
    // vwap is FLIPPED — there is no `cs.indicators.vwap.enabled` block left to
    // read it. The write has to reach the INSTANCE or Alt+U does nothing, which
    // is the defect B3 Task 11 found in the shipped Alt block.
    const H = renderChart({ settings: mergeChartSettings(null), tf: '5' })
    pressChord(H, INDICATOR_CHORDS.find(c => c.defId === 'vwap'))
    expect(H.lastSettings().indicatorInstances.some(i => i.defId === 'vwap' && !i.deleted)).toBe(true)
  })
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd app && npx vitest run src/components/chart/keyboardShortcuts.test.js \
  src/components/chart/engine/__tests__/stockChartWiring.test.jsx
```

Expected: `Failed to resolve import` for `INDICATOR_CHORDS`. Nothing else.

- [ ] **Step 3: Write the table and derive the two `keyboardShortcuts` regions**

```js
// app/src/components/chart/keyboardShortcuts.js
import { labelFor } from './indicatorCatalog'

/**
 * ⭐ THE FOUR INDICATOR CHORDS, DECLARED ONCE.
 *
 * B3's ledger called this "two shortcuts, one file", then three, then FOUR
 * across FOUR regions in TWO files — the SHORTCUTS row, this matcher, the
 * `toggle:` switch and the Alt block. Two of those regions are where the command
 * is DECLARED and two are where it is CONSUMED, and Alt+U spent a whole phase
 * declared-but-dead because `matchShortcut` rejects Alt.
 *
 * ⛔ `modifier: 'alt'` is NOT matched here. Alt is rejected on the first line of
 * `matchShortcut` so browser Alt shortcuts keep working; `StockChart`'s own
 * `e.altKey` block is the live handler and reads this table for its code. If
 * this matcher ever answered for an Alt chord, both handlers would fire.
 */
export const INDICATOR_CHORDS = Object.freeze([
  Object.freeze({ defId: 'rsi',  keys: 'Ctrl+I', code: 'KeyI', modifier: 'ctrl' }),
  Object.freeze({ defId: 'macd', keys: 'Ctrl+O', code: 'KeyO', modifier: 'ctrl' }),
  Object.freeze({ defId: 'bb',   keys: 'Ctrl+B', code: 'KeyB', modifier: 'ctrl' }),
  Object.freeze({ defId: 'vwap', keys: 'Alt+U',  code: 'KeyU', modifier: 'alt'  }),
])

const CTRL_KEY_TO_COMMAND = Object.freeze({
  ...Object.fromEntries(INDICATOR_CHORDS
    .filter(c => c.modifier === 'ctrl')
    .map(c => [c.code.slice(3).toLowerCase(), 'toggle:' + c.defId])),
  m: 'toggle:ma',
  v: 'toggle:volume',
})
```

`SHORTCUTS`' five indicator rows become one spread, keeping the two non-indicator Ctrl rows literal (they toggle MA overlays and the volume pane, neither of which is a definition):

```js
  // Indicator toggles — GENERATED. Alt+U is in here because the help sheet is
  // where a user looks for it; it is matched by StockChart, not by matchShortcut.
  ...INDICATOR_CHORDS.map(c => ({ keys: c.keys, command: 'toggle:' + c.defId, description: 'Toggle ' + labelFor(c.defId) })),
  { keys: 'Ctrl+M', command: 'toggle:ma', description: 'Toggle moving averages' },
  { keys: 'Ctrl+V', command: 'toggle:volume', description: 'Toggle volume' },
```

⚠️ `Alt+U`'s row currently sits under "Display toggles" with the description *"Toggle session VWAP"*; after this it reads *"Toggle VWAP"* under "Indicator toggles". That is a visible help-sheet change — one line, and it is the fifth cell of the A7 diff family. Pin it in the test above (`'Toggle ' + labelFor('vwap')` is `'Toggle VWAP'`) so it is a decision.

`matchShortcut`'s Ctrl branch:

```js
  if (ctrl) {
    if (shift) return null;
    return CTRL_KEY_TO_COMMAND[key.toLowerCase()] || null;
  }
```

- [ ] **Step 4: Collapse the two StockChart regions into one dispatch**

Replace the `toggle:` switch's three per-indicator cases and the Alt block's `KeyU` branch with one helper declared above both:

```jsx
  // ⭐ ONE CONSUMER FOR ALL FOUR CHORDS. `setIndicatorEnabled` is the writer the
  // toolbar checkbox, both right-click doors and the settings row already share:
  // it creates or TOMBSTONES the instance AND mirrors `cs.indicators.<id>`, so a
  // FLIPPED id's chart follows and an UN-FLIPPED id's legacy block still reads
  // the flag it has always read. Writing the raw flag is the defect that made
  // Alt+U tick a box over a chart that disagreed.
  const toggleIndicatorById = useCallback((defId) => {
    const on = isIndicatorEnabled(cs, defId, ENGINE_FLIPPED_DEF_IDS)
    const next = setIndicatorEnabled(cs, defId, !on, engineRegistry)
    if (next !== cs) handleUpdateChartSettings(next)
  }, [cs, handleUpdateChartSettings])
```

In the Alt block, replace the hand-written `KeyU` branch with a table lookup:

```jsx
        const altChord = INDICATOR_CHORDS.find(c => c.modifier === 'alt' && c.code === e.code)
        if (!e.shiftKey && altChord) {
          e.preventDefault()
          toggleIndicatorById(altChord.defId)
          return
        }
```

In the `toggle:` switch, replace `case 'rsi'` / `case 'macd'` / `case 'bb'` with a pre-switch lookup, leaving `ma` and `volume` as cases (neither is a definition):

```jsx
        const chord = INDICATOR_CHORDS.find(c => c.defId === target)
        if (chord) { toggleIndicatorById(target); return }
        switch (target) {
          case 'log': …
          case 'ma': { … }
          case 'volume': …
        }
```

⚠️ `updateIndicator` — the switch's old local helper that wrote `cs.indicators[key].enabled` raw — becomes unreachable. **Delete it**, do not leave it guarded: `enumerationSites.test.js` asserts a flipped id keeps no Flip-A guard for exactly this reason, and an inert helper reads as live logic.

- [ ] **Step 5: Run to green + the control audit**

```bash
cd app && npx vitest run src/components/chart/keyboardShortcuts.test.js \
  src/components/chart/engine/__tests__/stockChartWiring.test.jsx \
  src/components/chart/engine/__tests__/flipB.test.jsx \
  src/components/chart/ChartToolbar.engineInert.test.jsx
```

Then audit: `grep -rn "toggle:rsi\|toggle:macd\|toggle:bb\|toggle:vwap\|Ctrl.I\|KeyU" app/src --include=*.js --include=*.jsx` and read every hit's REASON. Cases asserting *"Alt+U writes the raw flag"* or *"the switch has a case per indicator"* have lost their premise; invert them. Record rotted / green-while-false counts.

- [ ] **Step 6: Drop the four sites; `SITE_COUNT` 26 → 22, `B4: 9`**

- [ ] **Step 7: Gate**

**Pixels: 0 changed pixels, all 24 cases, 5/5, both identities.** The parity route has no keyboard listener, so again the gate cannot see this — it is a regression check on `StockChart.jsx`'s effect graph, and that matters here because the new `toggleIndicatorById` callback enters a `useCallback` dep array that a keydown effect depends on. Fail-proof, number, pair, recorded.

**Non-pixel assertions:** four chords, four modifiers, four real definitions; the help sheet rows are generated and carry `Toggle VWAP`; `matchShortcut` answers the three Ctrl chords and **still returns null for Alt**; one dispatch toggles all four, moving instance AND mirror; the flipped-only chord (`Alt+U`) creates an instance; series count unchanged across a toggle (#2049).

**Mutation gauntlet.** Selection: `src/components/chart/keyboardShortcuts.test.js src/components/chart/engine/__tests__/stockChartWiring.test.jsx`

| # | file | mutation | `-t` filter | must exit 1 |
|---|---|---|---|---|
| M1 | `keyboardShortcuts.js` | drop the `.filter(c => c.modifier === 'ctrl')` from `CTRL_KEY_TO_COMMAND` | `still rejects Alt` | yes — Alt+U would fire twice |
| M2 | `keyboardShortcuts.js` | remove the `vwap` row from `INDICATOR_CHORDS` | `names exactly the four` | yes |
| M3 | `StockChart.jsx` | `toggleIndicatorById` writes `{...cs, indicators: {...}}` raw instead of `setIndicatorEnabled` | `one dispatch serves every indicator chord` | yes — and specifically on `vwap`, whose instance would never move |
| M4 | `StockChart.jsx` | the Alt lookup drops `&& c.modifier === 'alt'` | `still rejects Alt` **and** `one dispatch serves` | yes — `Alt+I` (invert scale) would also toggle RSI |
| M5 | `keyboardShortcuts.js` | `description: 'Toggle ' + longLabelFor(c.defId)` | `help sheet rows are GENERATED` | yes |
| M6 | `StockChart.jsx` | delete the `if (chord) { … return }` line so the switch falls through | `one dispatch serves every indicator chord` | yes |

⚠️ M3's `-t` filter must select the loop, and the loop must contain `vwap`. B3 measured the failure mode exactly: a raw write is invisible on an un-flipped id because the mirror IS the switch there. Pick the filter by reading the suite; do not copy it from this document (a filter copied from a brief named a nonexistent test on this branch and read as a pass).

- [ ] **Step 8: Commit**

```bash
git add app/src/components/chart/keyboardShortcuts.js app/src/components/StockChart.jsx \
        app/src/components/chart/keyboardShortcuts.test.js \
        app/src/components/chart/engine/__tests__/stockChartWiring.test.jsx \
        app/src/components/chart/engine/__tests__/enumerationSites.test.js
git commit -m "refactor(chart): four indicator chords, one table, one dispatch

INDICATOR_CHORDS declares Ctrl+I/Ctrl+O/Ctrl+B/Alt+U once. The help sheet rows
and matchShortcut's Ctrl map are generated from it; the toggle: switch and the
Alt block collapse into one toggleIndicatorById that routes at setIndicatorEnabled,
so a flipped id's instance and an un-flipped id's mirror both move. matchShortcut
still returns null for Alt on purpose. Ledger 26 -> 22 sites, B4 13 -> 9.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The share link — every definition, not the four pilots

Retires ledger site: `StockChart.handleCopyShareUrl`. **B4 count 9 → 8.**

`handleCopyShareUrl` (`StockChart.jsx:2416-2439`) hand-lists exactly `rsi`, `macd`, `bb`, `vwap`. B3's Task 2 review found it and recorded the consequence: **"Copy chart link" SILENTLY DROPS every indicator that is not one of the four pilots.** A recipient of a shared link with Stochastic and ATR on gets a chart with neither, and nothing says so.

**Files:**
- Modify: `app/src/components/StockChart.jsx:2416-2439`
- Modify: `app/src/components/chart/engine/__tests__/stockChartWiring.test.jsx`
- Modify: `app/src/components/chart/engine/__tests__/enumerationSites.test.js`

**Interfaces:**
- Consumes: `catalogRows` (Task 2), `isIndicatorEnabled` + `ENGINE_FLIPPED_DEF_IDS` (shipped).
- Produces: nothing. `chartStateToUrl` / the decode at `StockChart.jsx:2464` are unchanged — this task only widens what is put IN.

- [ ] **Step 1: Write the failing test**

```js
  it('the share link carries every indicator that is on, not the four pilots', async () => {
    const cs = mergeChartSettings({
      indicators: { rsi: { enabled: true }, stoch: { enabled: true }, atr: { enabled: true } },
    })
    const H = renderChart({ settings: cs })
    const url = await H.copyShareUrl()
    const state = chartStateFromUrl(new URL(url).searchParams.get('state'))
    // ⭐ The defect this replaces: `stoch` and `atr` were simply absent, so a
    // recipient's chart drew neither and nothing said so.
    expect(Object.keys(state.indicators).sort()).toEqual(catalogRows().map(r => r.id).sort())
    expect(state.indicators.stoch.enabled).toBe(true)
    expect(state.indicators.atr.enabled).toBe(true)
    expect(state.indicators.macd.enabled).toBe(false)
  })

  it('and it answers through the ONE reader, so a tombstoned flipped id reads off', () => {
    // The legacy mirror still says `enabled: true` after a tombstone; only
    // `isIndicatorEnabled` knows the instance wins. Reading the raw flag here
    // would put a deleted RSI back on the recipient's chart.
    const cs = setIndicatorEnabled(
      mergeChartSettings({ indicators: { rsi: { enabled: true } } }), 'rsi', false, engineRegistry)
    expect(cs.indicators.rsi.enabled).toBe(false)   // control: the mirror moved too
    const H = renderChart({ settings: { ...cs, indicators: { ...cs.indicators, rsi: { enabled: true } } } })
    // …a hand-corrupted blob where the mirror disagrees with the tombstone. The
    // instance is the authority for a FLIPPED id.
    return H.copyShareUrl().then((url) => {
      const state = chartStateFromUrl(new URL(url).searchParams.get('state'))
      expect(state.indicators.rsi.enabled).toBe(false)
    })
  })

  it('carries the instances and the flag verbatim, so a shared engine chart stays one', () => {
    const cs = setIndicatorEnabled(mergeChartSettings(null), 'bb', true, engineRegistry)
    const H = renderChart({ settings: cs })
    return H.copyShareUrl().then((url) => {
      const state = chartStateFromUrl(new URL(url).searchParams.get('state'))
      expect(state.indicatorInstances).toEqual(cs.indicatorInstances)
      expect(state.engineEnabled).toBe(cs.engineEnabled === true)
    })
  })
```

⚠️ `H.copyShareUrl()` needs a `navigator.clipboard.writeText` spy — the shipped code swallows its failure in a bare `catch {}`, so without the spy the test would pass on a build that copies nothing. Assert the spy was called **once** as well as what it was called with.

- [ ] **Step 2: Run, watch it fail on the missing keys**

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/stockChartWiring.test.jsx -t "share link carries every indicator"
```

Expected: FAIL, received `['bb','macd','rsi','vwap']`.

- [ ] **Step 3: Replace the four hand-written lines**

```jsx
      // Every settings section, answered through the ONE reader. Hand-listing the
      // four pilots meant a link with Stochastic on arrived with Stochastic off,
      // silently — and `isIndicatorEnabled` rather than the raw flag is what keeps
      // a tombstoned flipped id from coming back on the recipient's chart.
      indicators: Object.fromEntries(catalogRows().map((row) => [
        row.id, { enabled: isIndicatorEnabled(cs, row.id, ENGINE_FLIPPED_DEF_IDS) },
      ])),
```

Leave `engineEnabled`, `indicatorInstances`, `comparisonSymbols` and `markers` exactly as they are.

- [ ] **Step 4: Run to green, and check the decode side did not need widening**

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/stockChartWiring.test.jsx \
  src/components/chart/chartState.test.js
```

⚠️ Read `StockChart.jsx:2464`'s decode before declaring this done. It applies `state.indicators` by merging into `cs.indicators`; a wider object is strictly more data and `mergeChartSettings`' per-key allow-list already carries all fifteen sections — but **verify it rather than assuming**, because the allow-list is one of the two hard allow-lists this phase must not trip over.

- [ ] **Step 5: Drop the site; `SITE_COUNT` 22 → 21, `B4: 8`**

- [ ] **Step 6: Gate**

**Pixels: 0 changed pixels, all 24 cases, 5/5, both identities.** The parity route never builds a share URL — the gate cannot see this. Its 0 is a regression check on the `useCallback` graph in `StockChart.jsx`. Fail-proof, number, pair, recorded.

**Non-pixel assertions:** the encoded state's `indicators` key set equals the catalog's id set; `stoch`/`atr` survive a round trip; a tombstoned flipped id encodes `false` even when its mirror says `true`; instances and the flag are carried verbatim; the clipboard spy was called exactly once.

**Mutation gauntlet.** Selection: `src/components/chart/engine/__tests__/stockChartWiring.test.jsx`

| # | file | mutation | `-t` filter | must exit 1 |
|---|---|---|---|---|
| M1 | `StockChart.jsx` | `catalogRows()` → `catalogRows().slice(0, 4)` | `carries every indicator that is on` | yes |
| M2 | `StockChart.jsx` | `isIndicatorEnabled(...)` → `cs.indicators?.[row.id]?.enabled === true` | `answers through the ONE reader` | yes |
| M3 | `StockChart.jsx` | drop `indicatorInstances` from the state object | `carries the instances and the flag verbatim` | yes |
| M4 | `stockChartWiring.test.jsx` | delete the clipboard-spy call-count assertion | *(run unfiltered)* | **must still exit 0** — this one is a NEGATIVE control proving the spy assertion is not the only thing holding the test up |

⚠️ M4 is deliberately a survivor. Record it as such, with its reason, the way B3 recorded MACD's proven-equivalent M4 — an unexplained survivor and a designed one look identical in a summary table.

- [ ] **Step 7: Commit**

```bash
git add app/src/components/StockChart.jsx \
        app/src/components/chart/engine/__tests__/stockChartWiring.test.jsx \
        app/src/components/chart/engine/__tests__/enumerationSites.test.js
git commit -m "fix(chart): the share link carries every indicator, not the four pilots

handleCopyShareUrl hand-listed rsi/macd/bb/vwap, so a link shared from a chart
with Stochastic or ATR on arrived with them off and nothing said so. Derived from
indicatorCatalog and answered through isIndicatorEnabled, so a tombstoned flipped
id encodes off even when its legacy mirror disagrees. Ledger 22 -> 21, B4 9 -> 8.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The auto-generated settings UI — a row for every definition; `ENGINE_ROW_DEF_IDS` deleted

Retires ledger site: `indicatorRegistry.ENGINE_ROW_DEF_IDS`. **B4 count 8 → 7.**

B3 Task 12 proved the mechanism on one definition: `VWAP_FIELDS` — four descriptors that were a verbatim second copy of the definition's four declared inputs — was deleted and the row derived by `fieldsFromDefinition`. This generalises it to all fifteen sections and deletes the hand-written list of which definitions get a generated row.

⚠️ **The rail at `enumerationSites.test.js:431-440` goes RED in this task, by design.** It asserts *"every id that keeps a generated row still has a control that exists NOWHERE ELSE"*, and it iterates `ENGINE_ROW_DEF_IDS`. Deleting the constant is what it was written to demand. **Replace it with its successor, do not delete it:** *"every declared input of every definition is reachable from the generated dialog."* A rail that retires without a successor is how this file grew the problem it is retiring.

**Files:**
- Modify: `app/src/components/chart/indicatorRegistry.js` (delete `ENGINE_ROW_DEF_IDS`; `listEngineIndicators` walks the registry; carved-out rows)
- Modify: `app/src/components/chart/ChartSettingsModal.jsx:333` (unchanged call, wider result) and its field renderer at `:678-710`
- Create: `app/src/components/chart/engine/__tests__/generatedSettingsRows.test.jsx`
- Modify: `app/src/components/chart/engine/__tests__/enumerationSites.test.js`

**Interfaces:**
- Consumes: `fieldsFromDefinition`, `applyRowPatch`, `readEnabled` (all shipped); `catalogRows`, `longLabelFor` (Task 2).
- Produces: `listEngineIndicators(settings, registry) → rows` now covering **all fourteen definitions**, each `{id, defId, engineOwned: true, label, group, fields, path, values, canToggle, enabled}`; plus `CARVED_OUT_FIELD_TABLES` for `volumeProfile`.

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/components/chart/engine/__tests__/generatedSettingsRows.test.jsx
describe('the Indicators tab is generated from the definitions, all of them', () => {
  it('renders one row per settings section, in registry order, carved-out last', () => {
    const rows = listAllIndicators(mergeChartSettings(null), engineRegistry)
    const indicatorRows = rows.filter(r => r.path.kind === 'indicator')
    expect(indicatorRows.map(r => r.id))
      .toEqual([...engineRegistry.listDefinitions().map(d => d.id), 'volumeProfile'])
    // The MA overlays and the volume pane are still hand-written and still first:
    // their identity is POSITIONAL and the volume pane is not an indicator.
    expect(rows.filter(r => r.path.kind !== 'indicator').map(r => r.id))
      .toEqual(['overlay-0', 'overlay-1', 'overlay-2', 'overlay-3', 'volume'])
  })

  it('every declared input becomes exactly one control, in declaration order', () => {
    for (const def of engineRegistry.listDefinitions()) {
      const row = listEngineIndicators(mergeChartSettings(null), engineRegistry).find(r => r.id === def.id)
      expect(row, def.id).toBeTruthy()
      expect(row.fields.map(f => f.key), def.id).toEqual(def.inputs.map(i => i.key))
    }
  })

  // ⭐ THE ICHIMOKU TRAP, MEASURED AT d2733adc AND RAILED HERE.
  // `ichimoku`'s definition declares tenkanPeriod / kijunPeriod / senkouBPeriod.
  // `CHART_DEFAULTS.indicators.ichimoku` declares NONE of them — it has `enabled`
  // and five colours. So a generated row would render three number boxes reading
  // `undefined`, writing keys the LEGACY ichimoku block does not read. It is
  // un-flipped, so the instance those writes reach is filtered out of the render
  // pass: three controls that appear and do nothing.
  it('a control whose key the legacy section does not carry is DISABLED with a reason, not live', () => {
    const row = listEngineIndicators(mergeChartSettings(null), engineRegistry).find(r => r.id === 'ichimoku')
    const byKey = Object.fromEntries(row.fields.map(f => [f.key, f]))
    for (const k of ['tenkanPeriod', 'kijunPeriod', 'senkouBPeriod']) {
      expect(byKey[k].disabled, k).toMatch(/not wired/i)
    }
    for (const k of ['tenkanColor', 'kijunColor']) expect(byKey[k].disabled, k).toBeUndefined()
  })

  it('…and the same control on a FLIPPED definition is live, which is what makes the rule real', () => {
    // vwap's opacity/lineStyle/lineWidth are all in its legacy section AND it is
    // flipped: nothing is greyed. If this ever greys, the predicate is over-wide.
    const row = listEngineIndicators(mergeChartSettings(null), engineRegistry).find(r => r.id === 'vwap')
    expect(row.fields.filter(f => f.disabled).map(f => f.key)).toEqual([])
  })

  it('writes through the ONE writer for every definition, flipped or not', () => {
    for (const def of engineRegistry.listDefinitions()) {
      const row = listEngineIndicators(mergeChartSettings(null), engineRegistry).find(r => r.id === def.id)
      const next = applyRowPatch(row, { enabled: true }, mergeChartSettings(null), engineRegistry)
      expect(isIndicatorEnabled(next, def.id, ENGINE_FLIPPED_DEF_IDS), def.id).toBe(true)
      expect(next.indicators[def.id].enabled, `${def.id} mirror`).toBe(true)
    }
  })

  it('a refused value returns the settings by IDENTITY, so nothing persists', () => {
    const base = mergeChartSettings(null)
    const row = listEngineIndicators(base, engineRegistry).find(r => r.id === 'rsi')
    expect(applyRowPatch(row, { period: 999 }, base, engineRegistry)).toBe(base)   // max is 100
    expect(applyRowPatch(row, { period: '7.5' }, base, engineRegistry)).toBe(base) // int, not float
  })

  it('the carved-out section keeps the row it has always had', () => {
    const row = listAllIndicators(mergeChartSettings(null), engineRegistry).find(r => r.id === 'volumeProfile')
    expect(row.label).toBe('Volume Profile')
    expect(row.fields.map(f => f.key)).toEqual(['bins', 'color', 'pocColor'])
    // ⛔ It has NO definition, so it must NOT route at instanceControls — there is
    // nothing to instantiate. It writes its settings slice, like the MA overlays.
    expect(row.engineOwned).toBe(false)
  })
})
```

- [ ] **Step 2: Run, watch it fail**

Expected: the first case fails with only `['vwap','volumeProfile']`-ish content; the ichimoku case fails because no `disabled` reason exists yet.

- [ ] **Step 3: Rewrite `listEngineIndicators` and add the carved-out table**

```js
/** Settings sections with NO engine definition. `volumeProfile` draws to a
 *  sibling 2D canvas, so there is nothing to instantiate and nothing to derive —
 *  its three fields are hand-written HERE, by name, next to the exemption they
 *  belong to, rather than joining a silent gap in a generated list. */
export const CARVED_OUT_FIELD_TABLES = Object.freeze({
  volumeProfile: Object.freeze([
    { key: 'bins',     label: 'Bins',  type: 'number', min: 4, max: 100, step: 1 },
    { key: 'color',    label: 'Color', type: 'color' },
    { key: 'pocColor', label: 'Point of control', type: 'color' },
  ]),
})

const NOT_IN_BLOB = 'Not wired yet — this indicator still draws from the legacy settings, which has no key for it'

/** Which of a definition's declared inputs the settings blob can actually carry.
 *  An un-flipped definition is drawn by its hand-written block, which reads
 *  `cs.indicators.<id>.<key>`; a key that section does not have is a control that
 *  writes somewhere nothing reads. `ichimoku` declares three periods the blob has
 *  never carried. Greyed with a reason is honest; live is a support ticket. */
function unwiredKeys(def, flippedIds) {
  if (flippedIds.has(def.id)) return new Set()
  const section = CHART_DEFAULTS.indicators[def.id] || {}
  return new Set((def.inputs || []).map(i => i.key).filter(k => !(k in section)))
}
```

`listEngineIndicators` iterates `registry.listDefinitions()` instead of `ENGINE_ROW_DEF_IDS`, marks unwired fields `disabled: NOT_IN_BLOB`, and keeps everything else — `sessionOnly` suffix, `group`, `drawnValues`, `isIndicatorEnabled` — exactly as B3 wrote it. `listAllIndicators` appends the carved-out row with `engineOwned: false` and `path: { kind: 'indicator', key: 'volumeProfile' }` so `patchFor` writes its slice.

Delete `ENGINE_ROW_DEF_IDS` and update the file header: the "which migrated definitions still need a row" paragraph becomes "every definition gets a row; the toolbar no longer duplicates any of them (Task 8)".

- [ ] **Step 4: Drop the site (`SITE_COUNT` 21 → 20, `B4: 7`) and replace the ledger rail with its successor**

In `enumerationSites.test.js`, delete the `ENGINE_ROW_DEF_IDS` site entry, set `SITE_COUNT = 20`, change the partition to `{B4: 7, B5: 8, C: 1, keep: 2, phase: 2}`, and replace the two `ENGINE_ROW_DEF_IDS`-iterating cases with:

```js
  // ⛔ THE SUCCESSOR RAIL. `ENGINE_ROW_DEF_IDS` existed only while SOME
  // definitions had a generated row and others did not. B4 gave every definition
  // one, so the question changed: not "which ids keep a row" but "is there a
  // declared input no surface can reach". `UNREACHABLE_FROM_THE_TOOLBAR` above is
  // now expected to be EVERYTHING — the toolbar's fifteen rows are gone (Task 8)
  // — and this is what makes that safe.
  it('every declared input of every definition is reachable from the generated dialog', () => {
    const rows = listEngineIndicators(mergeChartSettings(null), engineRegistry)
    const gaps = []
    for (const def of engineRegistry.listDefinitions()) {
      const row = rows.find(r => r.id === def.id)
      const reachable = new Set((row ? row.fields : []).map(f => f.key))
      for (const i of def.inputs) if (!reachable.has(i.key)) gaps.push(`${def.id}.${i.key}`)
    }
    expect(gaps,
      'a declared input has no control anywhere. That is the state MACD\'s macdColor / ' +
      'signalColor were in for the whole of B3 — measured, pinned, and B4\'s to close.',
    ).toEqual([])
  })
```

⭐ **This closes the MACD gap the ledger flagged.** `macdColor` and `signalColor` had no control anywhere — not the toolbar, not the settings tab. A generated MACD row carries both, because the definition declares both. Assert it by name so the closure is visible:

```js
  it('MACD\'s two colours have a control now — the gap B3 measured and could not close', () => {
    const row = listEngineIndicators(mergeChartSettings(null), engineRegistry).find(r => r.id === 'macd')
    const colors = row.fields.filter(f => f.type === 'color').map(f => f.key)
    expect(colors).toEqual(['macdColor', 'signalColor'])
    expect(row.fields.find(f => f.key === 'macdColor').disabled).toBeUndefined()
  })
```

- [ ] **Step 5: Run to green**

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/generatedSettingsRows.test.jsx \
  src/components/chart/engine/__tests__/enumerationSites.test.js \
  src/components/chart/ChartSettingsModal.test.jsx \
  src/components/chart/indicatorRegistry.vwap.test.js
```

⚠️ `indicatorRegistry.vwap.test.js` is B3's "all four are wired" suite. It was **green-but-FALSE** once already. Read its comments; if it asserts VWAP is the only generated row, invert it rather than deleting it.

- [ ] **Step 6: Gate**

**Pixels: 0 changed pixels, all 24 cases, 5/5, both identities.** The parity route mounts no settings modal. But `indicatorRegistry.js` is imported by `ChartSettingsModal`, which is in the main bundle, and `CHART_DEFAULTS` is now read by `unwiredKeys` at module scope — an import cycle here would break the bundle, which the gate *does* see. Fail-proof, number, pair.

**Non-pixel assertions:** fifteen indicator rows in registry order with `volumeProfile` last; every declared input is exactly one control in declaration order; ichimoku's three periods are greyed with a reason and its two wired colours are not; VWAP's four are all live (the control that stops the predicate being over-wide); every row writes through `instanceControls` and moves both instance and mirror; a refused value returns by identity; `volumeProfile` is `engineOwned: false`; MACD's two colours are live.

**Mutation gauntlet.** Selection: `src/components/chart/engine/__tests__/generatedSettingsRows.test.jsx src/components/chart/engine/__tests__/enumerationSites.test.js`

| # | file | mutation | `-t` filter | must exit 1 |
|---|---|---|---|---|
| M1 | `indicatorRegistry.js` | `listEngineIndicators` iterates `listDefinitions().slice(0, 4)` | `one row per settings section` | yes |
| M2 | `indicatorRegistry.js` | `unwiredKeys` returns an empty Set always | `DISABLED with a reason` | yes — ichimoku's three go live and write nowhere |
| M3 | `indicatorRegistry.js` | `unwiredKeys` drops the `flippedIds.has` short-circuit | `the same control on a FLIPPED definition is live` | yes — this is the over-wide direction |
| M4 | `indicatorRegistry.js` | `applyRowPatch` routes `enabled` to `patchFor` for engine rows | `writes through the ONE writer` | yes |
| M5 | `indicatorRegistry.js` | drop `CARVED_OUT_FIELD_TABLES` from `listAllIndicators` | `carved-out section keeps the row` | yes |
| M6 | `nativeRegistry.js` | delete `colorInput('signalColor', …)` from MACD | `MACD's two colours have a control now` | yes |
| M7 | `indicatorRegistry.js` | `fields` sorted alphabetically instead of declaration order | `in declaration order` | yes |

- [ ] **Step 7: Commit**

```bash
git add app/src/components/chart/indicatorRegistry.js \
        app/src/components/chart/ChartSettingsModal.jsx \
        app/src/components/chart/engine/__tests__/generatedSettingsRows.test.jsx \
        app/src/components/chart/engine/__tests__/enumerationSites.test.js
git commit -m "feat(chart): a generated settings row for every definition; ENGINE_ROW_DEF_IDS deleted

fieldsFromDefinition now drives all fourteen definitions plus a hand-written
carved-out table for volumeProfile. MACD's macdColor and signalColor get a control
for the first time -- B3 measured that they had none anywhere. Ichimoku's three
declared periods are greyed with a reason because CHART_DEFAULTS has no key for
them and its legacy block would never read them; VWAP's four stay live, which is
what proves the predicate is not over-wide.

The ledger rail that demanded this deletion is REPLACED, not removed: every
declared input of every definition must be reachable from the dialog.
Ledger 21 -> 20, B4 8 -> 7.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The indicator library dialog — the browse/add surface (spec §6)

Retires no ledger site on its own; it is the surface Task 8's launcher points at and the §6 deliverable the whole phase is named for.

**Files:**
- Create: `app/src/components/chart/IndicatorLibraryDialog.jsx`
- Create: `app/src/components/chart/IndicatorLibraryDialog.module.css`
- Create: `app/src/components/chart/IndicatorLibraryDialog.test.jsx`
- Modify: `app/src/components/StockChart.jsx` — mount it; add the right-click **Add indicator…** item; re-point `Alt+Shift+A` (`:3408-3414`) at it
- Modify: `app/src/components/chart/ChartToolbar.jsx` — the labelled **Indicators** button (spec §6: "not icon-only in v1")

**Interfaces:**
- Consumes: `catalogRows`, `longLabelFor` (Task 2); `isIndicatorEnabled`, `setIndicatorEnabled` (shipped `instanceControls`); `Sheet` from `components/mobile/Sheet.jsx`.
- Produces: `<IndicatorLibraryDialog open onClose settings onChange registry />`. `onChange(nextSettings)` is called with the result of `setIndicatorEnabled` and **only when it differs by identity**.

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/components/chart/IndicatorLibraryDialog.test.jsx
describe('the indicator library — search-first, add-and-stay-open, checkmarks', () => {
  const open = (settings = mergeChartSettings(null)) => {
    const onChange = vi.fn()
    render(<IndicatorLibraryDialog open onClose={() => {}} settings={settings}
                                   onChange={onChange} registry={engineRegistry} />)
    return { onChange }
  }

  it('lists every indicator, grouped by the definition\'s own category', () => {
    open()
    // Groups are DERIVED. Adding a definition in a new category brings its own
    // heading; there is no group array to forget to edit — the exact defect the
    // settings modal's hardcoded section list was (B3 Task 12 retired it).
    const headings = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)
    expect(headings).toEqual([...new Set(catalogRows().map(r => r.category))])
    expect(screen.getAllByRole('option')).toHaveLength(catalogRows().length)
  })

  it('shows the long name and the one-line blurb, not the chip abbreviation', () => {
    open()
    const row = screen.getByRole('option', { name: /Relative Strength Index/ })
    expect(within(row).getByText(/how much of recent movement has been up/i)).toBeTruthy()
  })

  it('search is focused on open and filters on name, short name, id and tag', () => {
    open()
    const box = screen.getByRole('searchbox')
    expect(document.activeElement).toBe(box)
    fireEvent.change(box, { target: { value: 'bollinger' } })
    expect(screen.getAllByRole('option').map(o => o.dataset.defId)).toEqual(['bb'])
    fireEvent.change(box, { target: { value: 'BB' } })
    expect(screen.getAllByRole('option').map(o => o.dataset.defId)).toEqual(['bb'])
    fireEvent.change(box, { target: { value: 'oscillator' } })   // a tag
    expect(screen.getAllByRole('option').map(o => o.dataset.defId))
      .toEqual(['rsi', 'macd', 'stoch', 'mfi', 'cci', 'williamsR'])
  })

  it('adding leaves the dialog OPEN and ticks the row (spec §6 add-and-stay-open)', () => {
    const { onChange } = open()
    fireEvent.click(screen.getByRole('option', { name: /Average True Range/ }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0]
    expect(isIndicatorEnabled(next, 'atr', ENGINE_FLIPPED_DEF_IDS)).toBe(true)
    expect(next.indicators.atr.enabled).toBe(true)     // the mirror an un-flipped block reads
    expect(screen.getByRole('searchbox')).toBeTruthy() // still open
  })

  it('a second click removes it, and the row un-ticks', () => {
    const on = setIndicatorEnabled(mergeChartSettings(null), 'rsi', true, engineRegistry)
    const { onChange } = open(on)
    expect(screen.getByRole('option', { name: /Relative Strength Index/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('option', { name: /Relative Strength Index/ }))
    expect(isIndicatorEnabled(onChange.mock.calls[0][0], 'rsi', ENGINE_FLIPPED_DEF_IDS)).toBe(false)
  })

  it('the carved-out section is addable too — it has a settings toggle and no definition', () => {
    const { onChange } = open()
    fireEvent.click(screen.getByRole('option', { name: /Volume Profile/ }))
    // ⛔ NOT through instanceControls: there is nothing to instantiate. Straight
    // to its settings slice, the way the MA overlays and the volume pane write.
    expect(onChange.mock.calls[0][0].indicators.volumeProfile.enabled).toBe(true)
    expect(onChange.mock.calls[0][0].indicatorInstances)
      .toEqual(mergeChartSettings(null).indicatorInstances)
  })

  it('shows the repaint and tier badges the definition declares — never self-disclosed prose', () => {
    open()
    const row = screen.getByRole('option', { name: /Session VWAP/ })
    expect(within(row).getByText('Non-repainting')).toBeTruthy()
    expect(within(row).queryByText(/premium/i)).toBeNull()   // every native is tier: free
  })

  it('a session indicator says so, derived from meta.timeframes', () => {
    open()
    expect(within(screen.getByRole('option', { name: /Session VWAP/ })).getByText('Intraday only')).toBeTruthy()
    expect(within(screen.getByRole('option', { name: /Average True Range/ })).queryByText('Intraday only')).toBeNull()
  })

  it('refuses to render a definition the registry does not know, rather than a blank row', () => {
    render(<IndicatorLibraryDialog open onClose={() => {}} settings={mergeChartSettings(null)}
                                   onChange={() => {}} registry={{ listDefinitions: () => [] }} />)
    // Carved-out rows still list; the point is it does not crash and does not
    // paint an empty row. defSchema's line: a control that refuses to appear is a
    // bug report, one that appears and writes nowhere is a support ticket.
    expect(screen.getAllByRole('option').map(o => o.dataset.defId)).toEqual(['volumeProfile'])
  })
})
```

- [ ] **Step 2: Run, watch the import fail**

```bash
cd app && npx vitest run src/components/chart/IndicatorLibraryDialog.test.jsx
```

- [ ] **Step 3: Write the dialog**

Structure (write the real JSX; the load-bearing parts are called out):

```jsx
// app/src/components/chart/IndicatorLibraryDialog.jsx
//
// ─── THE BROWSE / ADD SURFACE (spec §6) ─────────────────────────────────────
//
// TV's add-flow, copied exactly on purpose: search-first, add-and-stay-open,
// checkmarks on what is already on. Spec §1.5 — "don't innovate on chrome" —
// this is chrome, and users are TV-pre-trained.
//
// ⛔ IT IS NOT A CONTROL DOOR. Every write goes through `setIndicatorEnabled`,
// the writer the toolbar checkbox, both right-click doors, the four keyboard
// chords and the generated settings row already share. B3 found six doors one at
// a time, each because someone wrote `cs.indicators.<id>` raw; this surface adds
// a seventh USE of one writer, not a seventh writer.
//
// ⛔ ONE EXCEPTION, AND IT IS NAMED: `volumeProfile` has no definition, so there
// is nothing to instantiate. Its toggle writes its settings slice.
import Sheet from '../mobile/Sheet'
import { catalogRows } from './indicatorCatalog'
import { isIndicatorEnabled, setIndicatorEnabled } from './engine/instanceControls'
import { ENGINE_FLIPPED_DEF_IDS } from './engine/flipState'

const matches = (row, q) => {
  if (!q) return true
  const n = q.trim().toLowerCase()
  return row.name.toLowerCase().includes(n)
    || row.shortName.toLowerCase().includes(n)
    || row.id.toLowerCase().includes(n)
    || row.category.toLowerCase().includes(n)
    || row.tags.some(t => t.toLowerCase().includes(n))
}

export default function IndicatorLibraryDialog({ open, onClose, settings, onChange, registry }) {
  const [query, setQuery] = useState('')
  const searchRef = useRef(null)
  useEffect(() => { if (open) searchRef.current?.focus() }, [open])

  const rows = useMemo(() => catalogRows(registry).filter(r => matches(r, query)), [registry, query])
  const groups = useMemo(() => [...new Set(rows.map(r => r.category))], [rows])

  const toggle = (row) => {
    const on = row.carvedOut
      ? settings?.indicators?.[row.id]?.enabled === true
      : isIndicatorEnabled(settings, row.id, ENGINE_FLIPPED_DEF_IDS)
    const next = row.carvedOut
      ? { ...settings, indicators: { ...settings.indicators, [row.id]: { ...settings.indicators[row.id], enabled: !on } }, preset: 'custom' }
      : setIndicatorEnabled(settings, row.id, !on, registry)
    // Identity, not deep-equality: a refused write returns `settings` itself and
    // the caller must be able to skip persisting.
    if (next !== settings) onChange?.({ ...next, preset: 'custom' })
  }
  …
}
```

The row renders, in this order: name (`row.name`) · short-name chip · `Intraday only` pill when `def.meta.timeframes` excludes `'D'` · repaint badge (`Non-repainting`, **informational styling, never error-coloured** — spec §6 state 9) · tier badge only when `meta.tier !== 'free'` · the blurb. `role="option"`, `aria-selected` from the same reader `toggle` uses, `data-def-id={row.id}`, `min-height: var(--tap-min)`.

The `Sheet` wrapper: `variant="auto"` (modal on desktop, bottom sheet on touch), `title="Indicators"`, `maxWidth={640}`.

CSS: no new colour literals — `--gain` / `--loss` / `--info` / `--ut-gold` from `tokens.css` per spec §7, at most one gold element (the tier badge, which does not render today).

- [ ] **Step 4: Wire the three entry points**

`ChartToolbar.jsx` — a labelled button, not an icon, beside the gear:

```jsx
        <button type="button" className={styles.indicatorsBtn} onClick={onOpenIndicatorLibrary}>
          <UIcon name="breadth" size={14} /> Indicators
        </button>
```

`StockChart.jsx` — mount the dialog, add the pane-aware right-click item at the top of every region's section, and re-point `Alt+Shift+A`:

```jsx
        // Alt+Shift+A → the indicator library. `keyboardShortcuts.SHORTCUTS` has
        // declared this as "Add indicator" since before the library existed; it
        // opened the whole settings modal because there was nothing better to
        // open. Spec §6 asks for Ctrl/Cmd+I, which is RSI's shipped toggle and
        // one of the four chords Task 4 derived — rebinding it would move a
        // shortcut four control doors describe, to gain nothing.
        if (e.shiftKey && e.code === 'KeyA') {
          e.preventDefault()
          setLibraryOpen(true)
          return
        }
```

⚠️ The old branch was guarded by `typeof onOpenSettings === 'function'`, so on a mount site that passes no `onOpenSettings` the key did nothing. The new branch has no such guard — the dialog is StockChart's own. That is a behaviour change on every read-only mount site (spec §5 "mount-site scoping": full management UX on the Charts workspace and TickerPopup, read-only elsewhere). **Gate it on the same prop that gates the toolbar** so a read-only chart does not sprout an add-dialog; assert both directions.

- [ ] **Step 5: Run to green**

```bash
cd app && npx vitest run src/components/chart/IndicatorLibraryDialog.test.jsx \
  src/components/chart/engine/__tests__/stockChartWiring.test.jsx \
  src/components/chart/keyboardShortcuts.test.js
```

- [ ] **Step 6: Gate**

**Pixels: 0 changed pixels, all 24 cases, 5/5, both identities.** The parity route mounts no dialog and no toolbar — it cannot see this surface. The 0 matters anyway: `IndicatorLibraryDialog` imports `Sheet`, which imports `useIsTouch` → `useMediaQuery`, and pulling that into the chart bundle is exactly the kind of change that has moved a chart before. Fail-proof, number, pair.

**Non-pixel assertions:** every row listed, grouped by derived category; long name + blurb; search matches name/short/id/category/tag and is focused on open; add leaves the dialog open, ticks the row, moves instance AND mirror; a second click removes; the carved-out row writes its slice and adds **no** instance; badges derived from `meta.repaint` / `meta.tier` / `meta.timeframes`; an unknown definition renders nothing rather than a blank row; the read-only mount site gets no dialog.

**Mutation gauntlet.** Selection: `src/components/chart/IndicatorLibraryDialog.test.jsx src/components/chart/engine/__tests__/stockChartWiring.test.jsx`

| # | file | mutation | `-t` filter | must exit 1 |
|---|---|---|---|---|
| M1 | `IndicatorLibraryDialog.jsx` | `toggle` writes `{...settings, indicators: {...}}` for a non-carved row | `adding leaves the dialog OPEN` | yes — the eighth-door regression, caught at birth |
| M2 | `IndicatorLibraryDialog.jsx` | `onChange` called unconditionally, dropping the `next !== settings` guard | `refuses to render a definition the registry does not know` **and** a new case asserting a refused write does not persist | yes |
| M3 | `IndicatorLibraryDialog.jsx` | `matches` drops the `tags` clause | `filters on name, short name, id and tag` | yes |
| M4 | `IndicatorLibraryDialog.jsx` | `groups` hardcodes `['Momentum','Trend','Volatility','Volume']` | `grouped by the definition's own category` | yes — a fifth category would render its rows nowhere, the exact defect the modal's hardcoded section list was |
| M5 | `IndicatorLibraryDialog.jsx` | `toggle` routes the carved-out row through `setIndicatorEnabled` | `carved-out section is addable too` | yes |
| M6 | `IndicatorLibraryDialog.jsx` | close the dialog after a successful add | `adding leaves the dialog OPEN` | yes |
| M7 | `StockChart.jsx` | drop the read-only guard on `Alt+Shift+A` | the read-only mount-site case | yes |

- [ ] **Step 7: Commit**

```bash
git add app/src/components/chart/IndicatorLibraryDialog.jsx \
        app/src/components/chart/IndicatorLibraryDialog.module.css \
        app/src/components/chart/IndicatorLibraryDialog.test.jsx \
        app/src/components/StockChart.jsx app/src/components/chart/ChartToolbar.jsx
git commit -m "feat(chart): the indicator library dialog (spec section 6)

Search-first, add-and-stay-open, checkmarks, category groups derived from the
definitions, repaint/tier/intraday badges derived from meta. Three entry points:
a labelled Indicators button, right-click Add indicator, and Alt+Shift+A -- which
SHORTCUTS has described as Add indicator since before there was one. Spec asks
for Ctrl/Cmd+I; that is RSI's shipped chord and one of the four Task 4 derived,
so the deviation is recorded rather than taken.

Every write routes at setIndicatorEnabled. volumeProfile is the one named
exception and writes its settings slice, because there is nothing to instantiate.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: The toolbar's fifteen rows become "Manage indicators →"

Retires ledger site: `ChartToolbar`'s 15 hand-written indicator rows. **B4 count 7 → 6.**

Spec §6, verbatim: *"Gear-panel checkbox rows become a 'Manage indicators →' launcher at cutover."* Every control those rows carry now exists on the generated dialog (Task 6) with **more** coverage — `sar.maxStep`, six of `ichimoku`'s eight, `vwap`'s opacity/style/width and MACD's two colours are reachable there and were not reachable from the toolbar.

⚠️ **`engineInert`, `inertTitle` and `shownInput` retire with the rows.** They exist to tell the truth about a control the engine has taken over; with no controls left on this surface there is nothing to tell the truth about. `ChartToolbar.engineInert.test.jsx` has been retargeted **four times** and its subjects are exhausted — Task 12 decides its fate; this task must NOT quietly delete it.

**Files:**
- Modify: `app/src/components/chart/ChartToolbar.jsx` (`:505-…` the fifteen rows; `:150-210` the three helpers; `:212-267` `updateIndicator`)
- Modify: `app/src/components/chart/ChartToolbar.engineInert.test.jsx`
- Modify: `app/src/components/chart/engine/__tests__/enumerationSites.test.js`

- [ ] **Step 1: Write the failing test**

```jsx
  it('the Indicators group is one launcher, and it opens the library', () => {
    const onOpenIndicatorLibrary = vi.fn()
    renderToolbar({ onOpenIndicatorLibrary })
    expect(screen.queryAllByRole('checkbox', { name: /RSI|MACD|Stoch|Donchian/ })).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /Manage indicators/ }))
    expect(onOpenIndicatorLibrary).toHaveBeenCalledTimes(1)
  })

  it('the launcher says how many are on, through the ONE reader', () => {
    const cs = setIndicatorEnabled(
      setIndicatorEnabled(mergeChartSettings(null), 'rsi', true, engineRegistry),
      'stoch', true, engineRegistry)
    renderToolbar({ cs })
    // A count read off the raw mirror would say 2 for a tombstoned RSI as well.
    expect(screen.getByRole('button', { name: /Manage indicators/ }).textContent).toMatch(/\b2\b/)
  })

  it('no control on this surface writes an indicator any more', () => {
    // ⛔ SOURCE PROBE, deliberately. A behavioural test cannot prove the ABSENCE
    // of a writer, and `updateIndicator` writing `cs.indicators.<id>` raw is the
    // defect class that produced doors five and six.
    const src = readSource('app/src/components/chart/ChartToolbar.jsx')
    expect(/const\s+updateIndicator\s*=/.test(src)).toBe(false)
    expect(/indicators\s*:\s*\{[^}]*\[\s*key\s*\]/.test(src)).toBe(false)
  })

  it('the volume-overlay strip survives — it is not an indicator control', () => {
    // It moves an ENABLED oscillator between panes; it does not enable anything.
    renderToolbar({ cs: setIndicatorEnabled(mergeChartSettings(null), 'rsi', true, engineRegistry) })
    expect(screen.getByRole('checkbox', { name: 'RSI' })).toBeTruthy()   // the overlay strip's
  })
```

- [ ] **Step 2: Run, watch it fail** (fifteen checkboxes are found; no launcher exists).

- [ ] **Step 3: Replace the group**

```jsx
      {/* Indicators — spec §6: the gear panel's checkbox rows become a launcher.
          Every control they carried is on the generated dialog, and the dialog
          reaches inputs this surface never could (sar.maxStep, six of ichimoku's
          eight, MACD's two colours, VWAP's opacity / style / width). */}
      <div className={styles.sGroup}>
        <span className={styles.sLabel}>Indicators</span>
        <button type="button" className={styles.sLauncher} onClick={onOpenIndicatorLibrary}>
          Manage indicators <span className={styles.sLauncherCount}>{activeCount}</span> →
        </button>
      </div>
```

`activeCount` is `catalogRows().filter(r => isOn(r.id)).length` — through `isOn`, the reader every other control on this surface already uses.

Delete `updateIndicator`, `engineInert`, `inertTitle`, `shownInput`, `engineInputs`, `engineDrawn` and the `numFields` set. Keep `isOn` (the overlay strip needs it) and `update` (everything else on the panel uses it).

- [ ] **Step 4: Decide `ChartToolbar.engineInert.test.jsx` out loud**

Its subjects are gone. Do **not** delete the file silently. Convert it, in place, to the claim that is now true and can still fail:

```js
// ⭐ RETARGETED A FIFTH TIME, AND FOR THE LAST TIME. `engineInert` existed to say
// "this control is drawn by the engine and this field is not what sets it". B4
// deleted the controls, so the predicate has no subject and no reader. What
// remains failable is that no control came BACK: this surface must carry no
// per-indicator writer at all. When B5 deletes `cs.indicators`, delete this file.
it('the toolbar carries no per-indicator control, so nothing here can be inert', () => { … })
```

- [ ] **Step 5: Run to green + control audit**

```bash
cd app && npx vitest run src/components/chart/ChartToolbar.test.jsx \
  src/components/chart/ChartToolbar.engineInert.test.jsx \
  src/components/chart/ChartToolbar.flipB.test.jsx \
  src/components/chart/engine/__tests__/enumerationSites.test.js
```

⚠️ **`enumerationSites.test.js`'s `toolbarInputs()` helper greps `updateIndicator('<id>', '<key>'` out of `ChartToolbar.jsx` and will now match nothing** — so `UNREACHABLE_FROM_THE_TOOLBAR` becomes *every* declared input of *every* migrated definition. That is correct and it is why Task 6's successor rail had to land first. Update the pinned table to the measured new value and say in the comment that the toolbar no longer reaches anything **by design**; do not delete the helper, because "the toolbar grew a control back" is still a thing worth failing on.

Then the audit: `grep -rn "engineInert\|inertTitle\|shownInput\|updateIndicator" app/src --include=*.jsx --include=*.js`. Read each hit's REASON.

- [ ] **Step 6: Drop the site; `SITE_COUNT` 20 → 19, `B4: 6`**

- [ ] **Step 7: Gate**

**Pixels: 0 changed pixels, all 24 cases, 5/5, both identities.** The toolbar is not on the parity route. The 0 is the regression check on `ChartToolbar.jsx`'s imports, which are in the chart bundle.

**Non-pixel assertions:** zero indicator checkboxes on the panel; one launcher that calls the callback once; the count reads through `isOn` (so a tombstone lowers it); the source carries no `updateIndicator`; the volume-overlay strip still renders.

**Mutation gauntlet.** Selection: `src/components/chart/ChartToolbar.test.jsx src/components/chart/ChartToolbar.engineInert.test.jsx src/components/chart/engine/__tests__/enumerationSites.test.js`

| # | file | mutation | `-t` filter | must exit 1 |
|---|---|---|---|---|
| M1 | `ChartToolbar.jsx` | `activeCount` reads `cs.indicators[id]?.enabled` | `says how many are on` | yes |
| M2 | `ChartToolbar.jsx` | re-add a single `updateIndicator` helper and one RSI period box | `no control on this surface writes` | yes |
| M3 | `ChartToolbar.jsx` | the launcher renders but calls nothing | `opens the library` | yes |
| M4 | `ChartToolbar.jsx` | delete the volume-overlay strip | `volume-overlay strip survives` | yes |
| M5 | `enumerationSites.test.js` | shrink `UNREACHABLE_FROM_THE_TOOLBAR` to the old four-key table | `pins exactly which declared inputs` | yes |

⚠️ M2 is the one that matters and it is the one most likely to be written vacuously. B3 measured that `engineInert = (key) => key === 'stoch'` left 1,245 tests green because Stoch's row passed no `disabled` prop — **a predicate no row consults cannot be caught lying.** Here the equivalent trap is a source probe whose regex does not match the re-added code. Write M2 by literally pasting the deleted RSI row back and confirming the probe fires.

- [ ] **Step 8: Commit**

```bash
git add app/src/components/chart/ChartToolbar.jsx \
        app/src/components/chart/ChartToolbar.engineInert.test.jsx \
        app/src/components/chart/ChartToolbar.test.jsx \
        app/src/components/chart/engine/__tests__/enumerationSites.test.js
git commit -m "refactor(chart): the toolbar's fifteen indicator rows become one launcher

Spec section 6: the gear panel's checkbox rows become Manage indicators. Every
control they carried is on the generated dialog, which reaches inputs this surface
never could. updateIndicator, engineInert, inertTitle and shownInput retire with
them -- with no controls left there is nothing to tell the truth about. The
engineInert suite is retargeted a fifth time rather than deleted: what stays
failable is that no per-indicator writer comes back.

Ledger 20 -> 19, B4 7 -> 6.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Alerts — the dropdown stops enumerating; the evaluator becomes the one authority

Retires ledger sites: `IndicatorAlertPopover.INDICATORS`, `IndicatorAlertPopover.CONDITIONS`. **B4 count 6 → 4.** (`INDICATOR_FUNCS` was re-fated `C` in Task 1 — adjudication A4.)

The two frontend lists and the Python dict are a **twin**, and they already disagree: the dropdown offers eight indicators, the evaluator implements eight, and B3's audit found the shapes of the disagreement — a `vwap` alert can be *created* (the API's `indicator: str` is unvalidated at all three layers) and can *never fire*. Nothing reports it. B4 collapses the twin: the module that evaluates is the module that names, and the popover asks it.

**Files:**
- Modify: `api/services/indicator_alert_evaluator.py` — add `ALERT_CONDITIONS` + `alert_catalog()` beside `INDICATOR_FUNCS`
- Modify: `api/routers/indicator_alerts.py` — add `GET /api/indicator-alerts/catalog`
- Modify: `app/src/components/chart/IndicatorAlertPopover.jsx` — delete both literals, consume the catalog
- Modify: `app/src/hooks/useIndicatorAlerts.js` — add `useIndicatorAlertCatalog()`
- Modify: `tests/test_indicator_alert_evaluator.py`, `app/src/components/chart/IndicatorAlertPopover.test.jsx`
- Modify: `app/src/components/chart/engine/__tests__/enumerationSites.test.js`

**Interfaces:**
- Produces (Python): `alert_catalog() → list[{"indicator": str, "label": str, "conditions": [{"value","label","needs_threshold"}], "default_threshold": float|None}]`, built from `INDICATOR_FUNCS.keys()` so an entry cannot exist for something that cannot fire.
- Produces (JS): `useIndicatorAlertCatalog() → {catalog, isLoading, error}`.

- [ ] **Step 1: Write the failing Python test**

```python
# tests/test_indicator_alert_evaluator.py
def test_catalog_offers_exactly_what_can_be_evaluated():
    """The dropdown's list and the evaluator's dict were TWINS, and they were
    already out of step: a `vwap` alert can be created through the API (the
    router's `indicator: str` is unvalidated, the service inserts it verbatim,
    the DDL is TEXT NOT NULL with no CHECK) and can never fire, because
    INDICATOR_FUNCS has eight keys and `vwap` is not one of them. Deriving the
    catalog from the dict is what makes that unrepresentable."""
    from api.services.indicator_alert_evaluator import INDICATOR_FUNCS, alert_catalog
    assert {e["indicator"] for e in alert_catalog()} == set(INDICATOR_FUNCS)


def test_every_catalog_condition_is_one_the_evaluator_implements():
    from api.services.indicator_alert_evaluator import alert_catalog, _evaluate_one
    for entry in alert_catalog():
        for cond in entry["conditions"]:
            assert cond["value"] in _IMPLEMENTED_CONDITIONS, (
                f'{entry["indicator"]}/{cond["value"]} is offered and not implemented'
            )


def test_catalog_labels_are_not_ids():
    """A dropdown showing `williams_r` is a dropdown that leaked a key."""
    from api.services.indicator_alert_evaluator import alert_catalog
    for e in alert_catalog():
        assert e["label"] != e["indicator"]
        assert e["label"].strip()


def test_adding_a_value_function_without_a_condition_list_fails_loudly():
    """A ninth indicator with no conditions would render an empty second dropdown
    and an un-submittable form. It has to fail HERE, at import, not there."""
    import api.services.indicator_alert_evaluator as ev
    assert set(ev.INDICATOR_FUNCS) <= set(ev.ALERT_CONDITIONS)
    assert set(ev.ALERT_CONDITIONS) <= set(ev.INDICATOR_FUNCS)
```

- [ ] **Step 2: Run and watch it fail**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_indicator_alert_evaluator.py -q
```

Expected: `ImportError: cannot import name 'alert_catalog'`.

- [ ] **Step 3: Write the Python half**

Move the condition vocabulary out of the popover and put it next to the code that implements it:

```python
# api/services/indicator_alert_evaluator.py
#
# ─── THE CATALOG — ONE AUTHORITY FOR "WHAT CAN BE ALERTED ON" ────────────────
#
# `IndicatorAlertPopover.jsx` used to hand-write INDICATORS (8 entries) and
# CONDITIONS (a map). They were a TWIN of the dict below and already disagreed
# with reality: the create path validates nothing, so a `vwap` alert can be
# stored and can never fire, and no surface reports it. Deriving the dropdown
# from INDICATOR_FUNCS makes that unrepresentable.
#
# ⛔ SPEC §8 REBUILDS THIS EVALUATOR IN PHASE C (closed-bar evaluation, `prev`
# from the computed series, `last_value` demoted to delivery-dedup), and §9.5
# forbids an eager port of the remaining natives. So this dict stays HAND-WRITTEN
# through B4 and its retirement is fated 'C' in the enumeration ledger. What B4
# removes is its TWIN, not the list.

_OSCILLATOR_CONDITIONS = [
    {"value": "above",       "label": "Above threshold", "needs_threshold": True},
    {"value": "below",       "label": "Below threshold", "needs_threshold": True},
    {"value": "cross_above", "label": "Crosses above",   "needs_threshold": True},
    {"value": "cross_below", "label": "Crosses below",   "needs_threshold": True},
]

ALERT_CONDITIONS: dict[str, list[dict]] = {
    "rsi": _OSCILLATOR_CONDITIONS,
    "stoch": _OSCILLATOR_CONDITIONS,
    "williams_r": _OSCILLATOR_CONDITIONS,
    "cci": _OSCILLATOR_CONDITIONS,
    "mfi": _OSCILLATOR_CONDITIONS,
    "macd": [
        {"value": "cross_above", "label": "Crosses above signal", "needs_threshold": False},
        {"value": "cross_below", "label": "Crosses below signal", "needs_threshold": False},
        {"value": "cross_zero",  "label": "Crosses zero line",    "needs_threshold": False},
    ],
    "bb": [
        {"value": "touch_upper", "label": "Price touches upper band", "needs_threshold": False},
        {"value": "touch_lower", "label": "Price touches lower band", "needs_threshold": False},
    ],
    "price_vs_ma": [
        {"value": "above", "label": "Price above MA", "needs_threshold": True},
        {"value": "below", "label": "Price below MA", "needs_threshold": True},
    ],
}

ALERT_LABELS: dict[str, str] = {
    "rsi": "RSI", "macd": "MACD", "bb": "Bollinger Bands", "stoch": "Stochastic",
    "williams_r": "Williams %R", "cci": "CCI", "mfi": "MFI", "price_vs_ma": "Price vs MA",
}

_DEFAULT_THRESHOLDS = {"rsi": 70.0, "mfi": 70.0, "williams_r": -20.0, "cci": 100.0, "stoch": 80.0}


def alert_catalog() -> list[dict]:
    """What the alert dropdown may offer. Keyed off INDICATOR_FUNCS, so an entry
    cannot exist for something that cannot be evaluated."""
    return [
        {
            "indicator": key,
            "label": ALERT_LABELS.get(key, key),
            "conditions": ALERT_CONDITIONS[key],
            "default_threshold": _DEFAULT_THRESHOLDS.get(key),
        }
        for key in INDICATOR_FUNCS
    ]
```

⚠️ `ALERT_LABELS` is deliberately **not** derived from the JS catalog: `williams_r` / `price_vs_ma` are alert-lane ids (the compute-function names), not definition ids, and `price_vs_ma` has no definition at all. Pretending otherwise would be a mapping that lies. Say so in the docstring.

Add the route (read `api/routers/indicator_alerts.py` first and follow its auth pattern — the existing endpoints are `get_current_user`-gated and the catalog should be too, so it is not a public enumeration of internals):

```python
@router.get("/catalog")
def get_alert_catalog(user=Depends(get_current_user)):
    return {"catalog": indicator_alert_evaluator.alert_catalog()}
```

- [ ] **Step 4: Write the failing frontend test, then delete both literals**

```jsx
  it('offers exactly what the served catalog carries — no hardcoded list', () => {
    mockCatalog([{ indicator: 'rsi', label: 'RSI', conditions: [{ value: 'above', label: 'Above threshold', needs_threshold: true }], default_threshold: 70 }])
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)
    expect([...screen.getByLabelText('Indicator').options].map(o => o.value)).toEqual(['rsi'])
    expect([...screen.getByLabelText('Condition').options].map(o => o.value)).toEqual(['above'])
  })

  it('while the catalog is loading it offers NOTHING, rather than a stale eight', () => {
    mockCatalogLoading()
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)
    expect(screen.getByLabelText('Indicator')).toBeDisabled()
    expect(screen.getByRole('button', { name: /add alert/i })).toBeDisabled()
  })

  it('and if the catalog cannot be fetched it says so instead of offering an alert that cannot fire', () => {
    mockCatalogError()
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} />)
    expect(screen.getByText(/alert types are unavailable/i)).toBeTruthy()
  })

  it('the threshold field appears exactly when the served condition says it should', () => { … })
```

⚠️ **The loading and error states are the whole safety argument.** A fallback to the old hardcoded list would reintroduce the twin *and* be invisible, because the fallback only shows when the fetch fails. Assert both directions explicitly; a source probe (`expect(src).not.toMatch(/const\s+CONDITIONS\s*=/)`) backs them up, because absence is not behaviourally observable.

Delete `INDICATORS`, `OSCILLATOR_CONDITIONS`, `CONDITIONS`, `THRESHOLD_CONDITIONS` and `INDICATOR_LABELS` from the popover. `conditionLabel` reads the served entry.

- [ ] **Step 5: Run to green**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_indicator_alert_evaluator.py tests/test_indicator_alert_service.py -q
cd app && npx vitest run src/components/chart/IndicatorAlertPopover.test.jsx
```

- [ ] **Step 6: Drop the two sites; `SITE_COUNT` 19 → 17, `B4: 4`**

Update site 18's `region` text to name its new job, and re-check its anchor still matches exactly once (the file gained ~60 lines above it).

- [ ] **Step 7: Gate**

**Pixels: 0 changed pixels, all 24 cases, 5/5, both identities.** `IndicatorAlertPopover` is mounted by `StockChart`, so it is in the bundle; the popover itself never opens on the parity route. Fail-proof, number, pair.

**Non-pixel assertions:** the catalog's indicator set **equals** `INDICATOR_FUNCS`' key set (both directions — a condition list with no value function is as broken as the reverse); every offered condition is implemented; labels are not ids; the popover renders exactly the served entries; loading disables submit; an error says so and offers nothing; no `CONDITIONS`/`INDICATORS` literal remains in the popover source.

**Mutation gauntlet.** Two runners — vitest and pytest, each with its own CONTROL A and CONTROL B.

| # | file | mutation | filter | must exit 1 |
|---|---|---|---|---|
| M1 | `indicator_alert_evaluator.py` | `alert_catalog` iterates `ALERT_CONDITIONS` instead of `INDICATOR_FUNCS` | `-k catalog_offers_exactly` | yes |
| M2 | `indicator_alert_evaluator.py` | add `"vwap": _OSCILLATOR_CONDITIONS` to `ALERT_CONDITIONS` | `-k without_a_condition_list` | yes — the dead-`vwap`-alert class, made unrepresentable |
| M3 | `indicator_alert_evaluator.py` | drop `"macd"` from `INDICATOR_FUNCS` | `-k without_a_condition_list` | yes |
| M4 | `indicator_alert_evaluator.py` | `ALERT_LABELS.get(key, key)` → `key` | `-k labels_are_not_ids` | yes |
| M5 | `IndicatorAlertPopover.jsx` | fall back to a hardcoded eight when the fetch fails | `-t "cannot be fetched it says so"` | yes |
| M6 | `IndicatorAlertPopover.jsx` | render the submit button enabled while loading | `-t "offers NOTHING"` | yes |

⚠️ pytest mutations need `PYTHONDONTWRITEBYTECODE=1` on every invocation including the controls — a same-size edit inside one second has imported the previous mutation's `.pyc` on this branch.

- [ ] **Step 8: Commit**

```bash
git add api/services/indicator_alert_evaluator.py api/routers/indicator_alerts.py \
        app/src/components/chart/IndicatorAlertPopover.jsx app/src/hooks/useIndicatorAlerts.js \
        tests/test_indicator_alert_evaluator.py \
        app/src/components/chart/IndicatorAlertPopover.test.jsx \
        app/src/components/chart/engine/__tests__/enumerationSites.test.js
git commit -m "refactor(alerts): the dropdown stops enumerating; the evaluator names what it can evaluate

INDICATORS and CONDITIONS were a twin of INDICATOR_FUNCS and already disagreed
with reality -- a vwap alert can be created and can never fire, and nothing
reports it. alert_catalog() is derived from INDICATOR_FUNCS, both directions
asserted, and the popover fetches it. Loading offers nothing and an error says
so, because a fallback to the old list would reintroduce the twin invisibly.

INDICATOR_FUNCS itself stays hand-written and is fated C: spec section 8 rebuilds
the evaluator there and section 9.5 forbids an eager port.
Ledger 19 -> 17, B4 6 -> 4.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: The legend rewrite — `legChips`, the crosshair reads and `LEGACY_SLOTS`, together

Retires ledger sites: `StockChart`'s crosshair value reads, `StockChart.legChips`, `readout.LEGACY_SLOTS`. **B4 count 4 → 1.**

This is the task the pixel gate genuinely cannot see. A headless capture has no cursor, so **no chip is drawn on either side and the diff is 0 whether this is right or wrong.** Its gate is DOM, and every assertion carries a legacy control.

**The design (adjudication A3).** `engineChips` already turns *(series, definition, instance inputs)* into *(label, colour, decimals, text)*. Only the series source is engine-specific. So:

1. `readout.js` extracts `chipsFrom(entries, seriesData, registry, inputsFor)` where an `entry` is `{defId, plotKey, series, lastValue}`.
2. `engineChips(bindings, …)` becomes a thin caller mapping bindings → entries.
3. StockChart keeps `legacyChipEntriesRef` — a `Map<'<defId>::<plotKey>', entry>` populated where each legacy series is already created, inside render blocks already fated B5.
4. The legend renders `[...chipsFrom(engineEntries), ...chipsFrom(legacyEntries)]` in one pass. `LEGACY_SLOTS`, the nine `crosshairData` numeric fields and the hand-written `legChips` array all go.

**Files:**
- Modify: `app/src/components/chart/engine/readout.js`
- Modify: `app/src/components/chart/engine/nativeRegistry.js` — `plots[].legend` on the six chip-bearing legacy plots
- Modify: `app/src/components/StockChart.jsx:8042-8112` (the value reads), `:9855-9871` (`legChips`), and the legacy `addSeries` sites for stoch/atr/sar/ichimoku
- Create: `app/src/components/chart/engine/__tests__/legendFromDefinitions.test.jsx`
- Modify: `app/src/components/chart/engine/readout.test.js`

- [ ] **Step 1: Declare the six chips, transcribed VERBATIM from `legChips`**

In `nativeRegistry.js`, on the existing plots — **no other field on any plot may change**:

| plot | today's `legChips` line | declaration |
|---|---|---|
| `stoch.k` | `` `%K ${v.toFixed(1)}` `` | `legend: { label: '%K', decimals: 1 }` |
| `stoch.d` | `` `%D ${v.toFixed(1)}` `` | `legend: { label: '%D', decimals: 1 }` |
| `atr.atr` | `` `ATR(${period}) ${v.toFixed(4)}` `` | `legend: { decimals: 4 }` **and** `meta.legendParams: ['period']` |
| `sar.sar` | `` `SAR ${v.toFixed(4)}` `` | `legend: { decimals: 4 }` |
| `ichimoku.tenkan` | `` `TK ${v.toFixed(2)}` `` | `legend: { label: 'TK', decimals: 2 }` |
| `ichimoku.kijun` | `` `KJ ${v.toFixed(2)}` `` | `legend: { label: 'KJ', decimals: 2 }` |

Every other plot of those four definitions gets **no `legend` block**, which `chipsFrom` reads as "no chip" — so `spanA`, `spanB`, `chikou` and every `hlines` guide stay chip-less, exactly as today.

⚠️ `atr` needs `meta.legendParams: ['period']` for `chipLabel` to print `ATR(14)`; `stoch` must NOT get one, because its shipped chips print `%K` / `%D` with no parentheses and `legend.label` short-circuits `legendParams` anyway. Assert both.

- [ ] **Step 2: Write the failing DOM test, with a control per chip**

```jsx
// app/src/components/chart/engine/__tests__/legendFromDefinitions.test.jsx
//
// ⛔ THE PIXEL GATE CANNOT SEE ANY OF THIS. A headless capture has no cursor, so
// no chip is drawn on either side and the diff is 0 whether the rewrite is right
// or wrong. B3 measured the sibling case: `engine_bb_vs_legacy` read 0 px under a
// z-order mutation that a purpose-built case read 281 px on. This file IS the
// gate, and every case below carries a legacy control.

const CHIPS = [
  ['rsi',      'rsi',    'RSI(14) ',  1],
  ['macd',     'macd',   'MACD ',     4],
  ['macd',     'signal', 'SIG ',      4],
  ['stoch',    'k',      '%K ',       1],
  ['stoch',    'd',      '%D ',       1],
  ['atr',      'atr',    'ATR(14) ',  4],
  ['sar',      'sar',    'SAR ',      4],
  ['ichimoku', 'tenkan', 'TK ',       2],
  ['ichimoku', 'kijun',  'KJ ',       2],
]

it('renders exactly the nine chips the shipped legend rendered, character for character', () => {
  // Built by CAPTURING the shipped legend at d2733adc — a hand-copied expectation
  // is the defect `readout.test.js` shipped once already (a RENDERED_FIELDS Set
  // that never read StockChart.jsx, and deleting the ATR row left 956 tests green).
  const H = renderChartWithEverythingOn()
  hoverBar(H, 120)                       // a real timer, NOT `await requestAnimationFrame`
  expect(chipTexts(H)).toEqual(SHIPPED_CHIP_TEXTS)
})

it.each(CHIPS)('%s::%s formats from the definition, and matches the legacy control', (defId, plotKey, prefix, decimals) => { … })

it('a plot with no legend block emits no chip — spanA, spanB, chikou and every guide', () => { … })

it('the developing-bar fallback survives on BOTH lanes', () => {
  // The hovered bar not carrying a point is the NORMAL live case: the bars-push
  // writer appends the developing candle before the indicator has it. Legacy
  // printed the last computed value; an engine chip that printed NOTHING was a
  // readout regression no pixel gate could see (B3 I-3).
})

it('a hidden instance emits no chip, and re-showing brings the same one back', () => { … })

it('chips appear in binding order, engine lane first, then legacy — the shipped order', () => { … })

it('the comparison chip still renders and is NOT an indicator chip', () => { … })

it('every crosshair subscriber that needs the legend gets it', () => {
  // ⚠️ StockChart registers TWO crosshair subscribers (the legend and the
  // hovered-bar recorder). `H.crosshairHandlers.at(-1)` is the WRONG one and
  // reading it made EVERY legend assertion, including the legacy control, measure
  // a legend nobody asked to update (B3 Task 2, brief-wrong #1). Fan out to all
  // of them and assert the count is 2.
})
```

⚠️ Two harness rules this suite must obey, both measured on this branch: **use a real timer, not `await requestAnimationFrame`** inside `act` (the handler's rAF coalesce outlives it), and **poll to two identical reads** — the older RSI/BB/MACD legend helpers carry a latent race whose real cause was a per-second countdown in the CONTAINER, outside the legend. Read the legend ELEMENT.

- [ ] **Step 3: Extract `chipsFrom` in `readout.js`; delete `LEGACY_SLOTS`**

```js
/** One chip per (series, plot-with-a-legend-block). The ONE formatting pipeline
 *  spec §6 asks for: Style-tab precision, chip values and the crosshair readout
 *  all come out of `plots[].legend` and `meta.legendParams`.
 *
 *  @param entries  [{defId, plotKey, series, lastValue}] — the engine lane maps
 *                  its bindings in; StockChart's legacy blocks register theirs
 *                  as they create each series. A plot with no `legend` block
 *                  emits nothing, which is how the ten un-flipped definitions'
 *                  guides and Ichimoku's cloud stay chip-less.
 *  @param inputsFor (defId, instanceId) => inputs — the instance's own inputs for
 *                  the engine lane, `cs.indicators[defId]` for the legacy lane.
 *                  Reading `cs.indicators[id]` for BOTH would be wrong the moment
 *                  a second instance exists.
 */
export function chipsFrom(entries, seriesData, registry, inputsFor) { … }
```

`engineChips(bindings, seriesData, registry, instances)` keeps its exported signature and becomes a mapper. Delete `LEGACY_SLOTS`, `chipsBySlot` and the slot field on the returned chip.

- [ ] **Step 4: Register the legacy entries and rewrite the legend**

At each legacy `addSeries` for a chip-bearing plot (six sites, all inside blocks already fated B5):

```jsx
      stochKRef.current = chart.addSeries(LineSeries, { … })
      registerLegacyChip('stoch', 'k', stochKRef.current, () => indicatorData.stoch.k.at(-1)?.value)
```

Delete the nine numeric `crosshairData` fields and the whole `legChips` array; the legend maps `crosshairData.chips`.

⚠️ **`crosshairData.rsi` etc. may have readers outside the legend** — the multi-chart crosshair broadcast, the hovered-bar recorder, `ChartRender`. `grep -rn "crosshairData\." app/src` and read every hit BEFORE deleting a field. A reader outside the legend keeps its field or moves to `chips`; deciding that by assumption is how the ATR row went missing for 956 green tests.

- [ ] **Step 5: Run to green + control audit**

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/legendFromDefinitions.test.jsx \
  src/components/chart/engine/readout.test.js \
  src/components/chart/engine/__tests__/stockChartWiring.test.jsx \
  src/components/chart/engine/__tests__/enumerationSites.test.js
```

Audit `grep -rn "LEGACY_SLOTS\|chipsBySlot\|engineSlots\|crosshairData\." app/src` and read each REASON.

- [ ] **Step 6: Drop the three sites; `SITE_COUNT` 17 → 14, `B4: 1`**

- [ ] **Step 7: Gate**

**Pixels: 0 changed pixels, all 24 cases, 5/5, both identities — and that 0 is evidence about the SERIES, not about the legend.** `ChartRender.jsx:350` CSS-hides the legend and the export never composites it; no case hovers. State that in the report rather than letting a 0 read as a pass. `registerLegacyChip` runs inside the render blocks, so a mistake there **can** move pixels (a throw would blank a pane), which is exactly what the 0 rules out.

**Non-pixel assertions:** nine chips, character-for-character against the captured shipped strings; per-chip formatting matches its legacy control; a plot with no `legend` emits nothing; the developing-bar fallback works on both lanes; a hidden instance emits no chip and re-showing restores it; chip order matches the shipped order; the comparison chip survives; **two** crosshair subscribers, and the legend one is found by identity rather than by `at(-1)`.

**Mutation gauntlet.** Selection: the three legend/readout suites plus `stockChartWiring.test.jsx`.

| # | file | mutation | `-t` filter | must exit 1 |
|---|---|---|---|---|
| M1 | `readout.js` | `chipsFrom` emits a chip for a plot with no `legend` block | `emits no chip` | yes |
| M2 | `nativeRegistry.js` | `atr` loses `meta.legendParams` | the `atr::atr` row of the `it.each` | yes — the chip reads `ATR` not `ATR(14)` |
| M3 | `nativeRegistry.js` | `stoch.k`'s `legend.label` deleted | the `stoch::k` row | yes — falls back to `Stoch` |
| M4 | `nativeRegistry.js` | `ichimoku.tenkan.legend.decimals` 2 → 4 | the `ichimoku::tenkan` row | yes |
| M5 | `StockChart.jsx` | drop `registerLegacyChip` for `sar` | `renders exactly the nine chips` | yes |
| M6 | `readout.js` | `inputsFor` always reads `cs.indicators[defId]` | a two-instance case | yes — the "two numbers for one line" defect |
| M7 | `StockChart.jsx` | `lastValue` thunk returns `undefined` | `developing-bar fallback survives` | yes |
| M8 | `StockChart.jsx` | legend subscribes only the last crosshair handler | `every crosshair subscriber` | yes |
| M9 | `legendFromDefinitions.test.jsx` | replace one `SHIPPED_CHIP_TEXTS` entry with a hand-typed string | `character for character` | **must still exit 0**, and that is the finding: if it passes, the expectation is hand-copied and the case is the `RENDERED_FIELDS` defect again. **Fix it before proceeding.** |

- [ ] **Step 8: Commit**

```bash
git add app/src/components/chart/engine/readout.js app/src/components/chart/engine/nativeRegistry.js \
        app/src/components/StockChart.jsx \
        app/src/components/chart/engine/__tests__/legendFromDefinitions.test.jsx \
        app/src/components/chart/engine/readout.test.js \
        app/src/components/chart/engine/__tests__/enumerationSites.test.js
git commit -m "refactor(chart): the legend renders from the definitions, both lanes

chipsFrom() is the one formatting pipeline; engineChips is a thin caller and the
legacy blocks register their chip-bearing series the same way. LEGACY_SLOTS, the
nine crosshairData numeric fields and the hand-written legChips array all go
together, which is the only way they could go. Six plots gain a legend block
transcribed verbatim from the legChips line they replace.

The pixel gate cannot see any of this -- a headless capture has no cursor -- so
the gate is DOM, with a legacy control on every chip.
Ledger 17 -> 14, B4 4 -> 1.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: The dead voice bus

Retires ledger site: `chartBus.ALLOWED_INDICATORS`. **B4 count 1 → 0.**

**Measured at `d2733adc`: the bus is dead.** `addIndicator()` is imported by `useRealtimeSession.js` and emits `uct:chart:add-indicator`; `subscribeAll` has an `onIndicator` branch; and **`subscribeAll` has no call sites in `app/src` at all.** So the voice tool reports success and nothing happens — and the allow-list it validates against carries `avwap`, `ma9`, `ema20` and six others that are not definitions.

**Files:**
- Modify: `app/src/utils/chartBus.js`
- Modify: `app/src/components/StockChart.jsx` — one subscriber
- Modify/Create: `app/src/utils/chartBus.test.js`
- Modify: `app/src/components/chart/engine/__tests__/enumerationSites.test.js`

- [ ] **Step 1: Write the failing test — prove the deadness first, then fix it**

```js
  it('the allow-list is the catalog plus the MA aliases, and nothing invented', () => {
    // `avwap` is a DRAWING TOOL, not an indicator; ma9/ema20/... are overlay
    // slots whose identity is POSITIONAL. Both are legitimately not definitions,
    // so they are named here rather than silently tolerated.
    const { indicators, aliases } = allowedIndicatorNames()
    expect(indicators).toEqual(catalogRows().map(r => r.id.toLowerCase()))
    expect(aliases).toEqual(['avwap', 'ma9', 'ma20', 'ma50', 'ma200', 'ema9', 'ema20', 'ema50'])
  })

  it('addIndicator accepts every definition — sar, ichimoku, donchian included', () => {
    for (const row of catalogRows()) expect(addIndicator(row.name)).toBe(row.id.toLowerCase())
  })

  it('and a chart LISTENS, which is the half that has never existed', () => {
    const H = renderChart({ settings: mergeChartSettings(null) })
    addIndicator('ATR')
    expect(isIndicatorEnabled(H.lastSettings(), 'atr', ENGINE_FLIPPED_DEF_IDS)).toBe(true)
    expect(H.lastSettings().indicators.atr.enabled).toBe(true)
  })

  it('an alias the chart cannot honour is REFUSED at the emitter, not swallowed at the listener', () => {
    expect(addIndicator('avwap')).toBe('avwap')      // valid name, drawing tool
    const H = renderChart({ settings: mergeChartSettings(null) })
    addIndicator('avwap')
    expect(H.lastSettings()).toBe(H.initialSettings) // by identity: nothing persisted
  })
```

- [ ] **Step 2: Run, watch the listener case fail** (nothing subscribes today).

- [ ] **Step 3: Derive the list and add the one subscriber**

```js
// app/src/utils/chartBus.js
import { catalogRows } from '../components/chart/indicatorCatalog'

/** Overlay slots and the anchored-VWAP DRAWING TOOL. Neither is a definition —
 *  an MA overlay's identity is POSITIONAL (slot 0 IS "the 9 EMA" to every blob
 *  ever written) and AVWAP is a drawing. Named, not tolerated. */
const NON_DEFINITION_ALIASES = Object.freeze([
  'avwap', 'ma9', 'ma20', 'ma50', 'ma200', 'ema9', 'ema20', 'ema50',
])

const ALLOWED_INDICATORS = new Set([
  ...catalogRows().map(r => r.id.toLowerCase()),
  ...NON_DEFINITION_ALIASES,
])
```

⚠️ `normalized` lower-cases, so `williamsR` arrives as `williamsr` and `volumeProfile` as `volumeprofile`. The subscriber must map back through a lower-cased index of `catalogRows()`, not by string equality on the id. Assert `williamsR` and `volumeProfile` by name in the round-trip test — they are the two that would silently fail.

In `StockChart.jsx`, one effect, gated on the same prop that gates the library dialog:

```jsx
  // ⭐ THE OTHER HALF. `addIndicator` has emitted this event since the voice tool
  // shipped and NOTHING has ever listened — `subscribeAll` has no call site in
  // app/src. The voice assistant reported success and the chart did not move.
  useEffect(() => {
    if (!interactive) return
    return subscribeAll({ onIndicator: ({ indicator }) => {
      const row = catalogRows().find(r => r.id.toLowerCase() === indicator)
      if (!row || row.carvedOut) return          // an alias this surface cannot honour
      const next = setIndicatorEnabled(csRef.current, row.id, true, engineRegistry)
      if (next !== csRef.current) handleUpdateChartSettings(next)
    } })
  }, [interactive, handleUpdateChartSettings])
```

- [ ] **Step 4: Drop the site; `SITE_COUNT` 14 → 13; the partition becomes `{B5: 8, C: 1, keep: 2, phase: 2}` with **no `B4` key at all**

⚠️ `reduce` emits no key for a fate with no members, so the expected object must not carry `B4: 0`. Change the test's title to *"every B4 region is retired — 8 to B5, 1 to C, 2 kept, 2 phase bookkeeping"*.

- [ ] **Step 5: Gate**

**Pixels: 0 changed pixels, all 24 cases, 5/5, both identities.** The new effect subscribes a `window` listener in `StockChart`; no parity case dispatches the event, so nothing draws — but the effect is on the mount path and a throw there blanks the chart, which the gate does see.

**Non-pixel assertions:** the allow-list equals the catalog ∪ eight named aliases; every definition round-trips by name including `williamsR` and `volumeProfile`; a chart listens and the write moves instance AND mirror; an alias the chart cannot honour changes settings by identity (nothing persisted); a read-only mount site does not subscribe.

**Mutation gauntlet.** Selection: `src/utils/chartBus.test.js src/components/chart/engine/__tests__/stockChartWiring.test.jsx`

| # | file | mutation | `-t` filter | must exit 1 |
|---|---|---|---|---|
| M1 | `chartBus.js` | drop `NON_DEFINITION_ALIASES` from the Set | `allow-list is the catalog plus the MA aliases` | yes — "add a 9 EMA" stops working |
| M2 | `chartBus.js` | `catalogRows().map(r => r.id)` without `.toLowerCase()` | `accepts every definition` | yes — `williamsR` and `volumeProfile` refuse |
| M3 | `StockChart.jsx` | subscriber matches `r.id === indicator` | `a chart LISTENS` with `williamsR` in the loop | yes |
| M4 | `StockChart.jsx` | subscriber drops the `row.carvedOut` guard | `an alias the chart cannot honour` | yes |
| M5 | `StockChart.jsx` | subscriber writes `cs.indicators[id].enabled` raw | `a chart LISTENS` | yes |
| M6 | `StockChart.jsx` | delete the `return` from the effect (no unsubscribe) | a new leak case asserting `removeEventListener` on unmount | yes — a listener per remount is the class `lesson_teardown_must_undo_what_setup_created` names |

- [ ] **Step 6: Commit**

```bash
git add app/src/utils/chartBus.js app/src/components/StockChart.jsx \
        app/src/utils/chartBus.test.js \
        app/src/components/chart/engine/__tests__/stockChartWiring.test.jsx \
        app/src/components/chart/engine/__tests__/enumerationSites.test.js
git commit -m "fix(chart): the voice add-indicator bus was dead; derive its list and give it a listener

subscribeAll had no call site in app/src, so addIndicator emitted an event nobody
heard and the voice assistant reported success while the chart did not move. The
allow-list is now the catalog plus eight NAMED non-definition aliases (the four
MA slots, which are positional, and avwap, which is a drawing tool). One
subscriber routes at setIndicatorEnabled.

Ledger 14 -> 13. Every B4 region is retired: {B5:8, C:1, keep:2, phase:2}.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: The whole-phase gate — the door census, the eighth door, and the ledger at zero

**Files:**
- Create: `app/src/components/chart/engine/__tests__/controlDoorCensus.test.js`
- Modify: `docs/runbooks/chart-parity-gate.md` — §5.3's "twenty ledger regions wait on it" and a new §6
- Modify: `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` §5's enumeration paragraph
- **No shipped source file is modified by this task.** (B3's Task 13 held that line; holding it here is what makes the gate a measurement rather than a change.)

- [ ] **Step 1: Write the door census — the eighth-door detector**

B3 found six per-indicator doors one at a time and a seventh of a different kind (`applyPreset` ×2 + `resetToDefaults`, invisible to the discovery scan because a preset names no indicator). **B4 added four write paths** — the library dialog, the generated settings rows, the unified chord dispatch and the voice-bus subscriber. All four route at `instanceControls`, so they are uses of one writer rather than new doors, and this test is what keeps that true.

```js
// app/src/components/chart/engine/__tests__/controlDoorCensus.test.js
//
// ⭐ THE EIGHTH DOOR IS THE ONE THAT IS NOT WRITTEN YET.
//
// Doors 1-6 were per-indicator and each was found by a bug. Door 7 was a
// different KIND — a whole-blob writer that names no indicator, which is why the
// discovery scan (≥ 4 ids) cannot see it and why `engineEnabledMigration.test.js`
// holds it by OBJECT IDENTITY plus a bounded source probe. B4 added four write
// paths; this file is the census that makes a fifth one a red test.

const CALL_SITES = [
  ['app/src/components/chart/ChartToolbar.jsx',            'the Manage-indicators launcher counts, it does not write'],
  ['app/src/components/StockChart.jsx',                    'right-click Indicators / Hide, the four chords, the voice bus'],
  ['app/src/components/chart/indicatorRegistry.js',        'applyRowPatch — the generated settings rows'],
  ['app/src/components/chart/IndicatorLibraryDialog.jsx',  'the library dialog'],
]

it('every setIndicatorEnabled / setIndicatorInput call site is a known door', () => { … })

it('no shipped module outside instanceControls writes cs.indicators.<id>.enabled', () => {
  // ⚠️ CODE SHAPE, not a bare name: comments explaining that a raw write was
  // removed would satisfy `includes`. B3 hit this trap from both directions.
  // ⚠️ NAMED EXCEPTIONS, with reasons, so a ninth joins the list by argument:
  //   · chartDefaults.js          — it IS the blob
  //   · ChartsWorkspace.jsx       — the frozen UCT-Default capture (B5)
  //   · IndicatorLibraryDialog.jsx — volumeProfile ONLY, which has no definition
  //   · the ten un-flipped legacy render blocks READ it; they never write it
})

it('the seventh writer is still spread from CHART_DEFAULTS, by object identity', () => {
  // Carried forward from engineEnabledMigration.test.js and widened to the
  // surfaces B4 added: a preset click must not hand-write an engine key.
  for (const k of Object.keys(PRESETS)) {
    expect(PRESETS[k].settings.indicatorInstances).toBe(CHART_DEFAULTS.indicatorInstances)
  }
})

it('the four B4 surfaces all move the MIRROR as well as the instance', () => {
  // The mirror is what an UN-FLIPPED definition's legacy block reads, and ten of
  // the fourteen are still un-flipped. A door that wrote only the instance would
  // work perfectly on all four pilots and do nothing on the other ten.
})
```

- [ ] **Step 2: Run the whole suite, twice — HEAD, then a pristine detached checkout**

```bash
cd app && npx vitest run                       # record N/M and exit code
cd .. && PYTHONDONTWRITEBYTECODE=1 python -m pytest \
    tests/test_indicator_compute.py tests/test_indicator_golden.py \
    tests/test_indicator_alert_evaluator.py tests/test_indicator_alert_service.py -q
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_chart_parity_harness.py \
    tests/test_chart_markers.py tests/test_chart_news.py tests/test_chart_health_alerts.py \
    tests/test_admin_chart_health.py tests/test_charts_layout_service.py -q
```

Then `git clone --single-branch` this branch to a temp dir, `npm ci` (**not** a junction — the shared tree has lightweight-charts 5.1.0 and this branch pins 5.2.0; `rendererPin.test.js` catches it), `npm run build`, and confirm the build is **byte-identical** to the worktree's. B3's Task 13 did this and it is the only thing that proves the committed `spa_server.py` and `chart_parity.py` reproduce the numbers.

- [ ] **Step 3: RUN 1 — the 24-case gate at HEAD, one build, two render paths**

```bash
cd app && npm run build && cd ..
python tools/spa_server.py app/dist 5721 &
B=http://127.0.0.1:5721
python tools/chart_parity.py --base-a $B --base-b $B --dist-a app/dist --dist-b app/dist \
    --same-build --repeat 5
```

Expected: **all 24 cases 0 px, 5/5, `{0:5}` each, `shots=2/2` and `__chartReadyReason: stable` on every capture, exit 0.** Record both build identities and the served-vs-disk verification for both bases.

- [ ] **Step 4: RUN 2 — B4 against B3's tip**

Stage side A **in place** from `d2733adc` (`git show d2733adc:<path>` over every changed file, with files added since moved aside; assert `git diff --name-only d2733adc -- app/src` is empty before building; restore from a `cp -r` backup with a two-directional sha256 comparison). **No worktree, no `git stash`.**

```bash
python tools/chart_parity.py --base-a $A --base-b $B --dist-a distA --dist-b app/dist \
    --instances-side none --repeat 5
```

`--instances-side none` is **the settings a real user has**. Expected: **0 changed pixels on every case that runs.** B4 changes no compute, no plot, no colour, no bound and no placement — every number it moves is DOM. **A non-zero here is a finding, not a tolerance.** If one appears, attribute it by measurement (bbox, per-row, `--repeat 20`, same-build determinism on both sides) before touching anything, and name it in the report.

- [ ] **Step 5: Fail-proofs, on THIS pair**

```bash
python tools/chart_parity.py --base-a $A --base-b $B --dist-a distA --dist-b app/dist \
    --cases flipb_vwap_only --perturb-b '{"indicators": {"vwap": {"opacity": 40}}}'
python tools/chart_parity.py --base-a $A --base-b $B --dist-a distA --dist-b app/dist \
    --cases intraday_bars_only --perturb-b '{"candles": {"upColor": "#1ae51a"}}'
```

Both **non-zero, exit 1**. Record the numbers next to the pair; the B3 values (2,601 and 1,953) were measured on a different pair and are a sanity range, not an expectation.

- [ ] **Step 6: The ledger at zero, and the documents that point at it**

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/enumerationSites.test.js
```

`SITE_COUNT = 13`; the partition is `{B5: 8, C: 1, keep: 2, phase: 2}`; every anchor appears exactly once; the discovery scan finds ≥ 4 known modules and no unknown one.

Then update, in the same commit:
- runbook §5.3 — *"the settings-dialog rework … **B4**"* becomes a record of what B4 retired and what is left, carrying **no copy of the partition** (name the test instead), and gains **§6, "The B4 surfaces and why the pixel gate cannot see them"**: the parity route mounts no toolbar, no modal, no menu, no dialog and has no cursor, so every region that lives in one of those surfaces is structurally invisible, and the legend is invisible by the same mechanism as `readout.js`'s header records. Name the DOM suites that ARE the gate.
- spec §5's enumeration paragraph — the count, what B4 retired, and the two re-fates with their reasons.

- [ ] **Step 7: Mutation gauntlet on the census, and a whole-suite control**

| # | file | mutation | `-t` filter | must exit 1 |
|---|---|---|---|---|
| M1 | `IndicatorLibraryDialog.jsx` | add a raw `cs.indicators[id].enabled` write | `no shipped module outside instanceControls writes` | yes |
| M2 | `ChartToolbar.jsx` | hand-write `indicatorInstances: []` into one preset | `still spread from CHART_DEFAULTS` | yes |
| M3 | `instanceControls.js` | `setIndicatorEnabled` stops writing the mirror | `move the MIRROR as well as the instance` | yes |
| M4 | `enumerationSites.test.js` | `SITE_COUNT = 13` → `14` | `still where it says it is` | yes |
| M5 | a new module | drop a file naming five ids into `app/src/utils/` | the discovery scan case | yes |
| M6 | `controlDoorCensus.test.js` | empty `CALL_SITES` | *(unfiltered)* | yes — the census must not pass vacuously |

- [ ] **Step 8: Write the phase report and commit**

The report states, in this order: the three suite counts with their commands; RUN 1's 24 zeros with both identities and the served-vs-disk verification; RUN 2's numbers with both identities; both fail-proofs; the clean-checkout reproduction; the ledger's final partition; how many controls rotted per task and how many stayed **green while their premise died**; every mutation and its verdict, with survivors named and either proven equivalent or fixed; and — separately, so it cannot be read as a pass — **the list of B4 deliverables the pixel gate is structurally unable to see, and which DOM suite gates each.**

```bash
git add app/src/components/chart/engine/__tests__/controlDoorCensus.test.js \
        docs/runbooks/chart-parity-gate.md \
        docs/superpowers/specs/2026-07-31-indicator-platform-design.md
git commit -m "test(engine): the B4 whole-phase gate — door census, eighth-door detector, ledger at zero

No shipped source modified. The census pins every setIndicatorEnabled /
setIndicatorInput call site to a named door and refuses a raw cs.indicators write
outside instanceControls, with four named exceptions and their reasons. The
seventh writer is still held by object identity. All four B4 surfaces are asserted
to move the MIRROR as well as the instance, because ten of the fourteen
definitions are still drawn by a legacy block that reads it.

Ledger {B5:8, C:1, keep:2, phase:2}, SITE_COUNT 13, no B4 key.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review against the spec

**Spec coverage.** §6's surfaces: library dialog (Task 7 — search-first, add-and-stay-open, checkmarks, three entry points, `Sheet` touch mapping, About/blurb, category groups); settings form spec (Task 6 — one input per row, label left/control right, `disabled` renders greyed with a reason, numeric bounds from the definition); the "Manage indicators →" launcher (Task 8, spec's own words). §7 tokens: no new colour literals; the repaint badge is informational-styled, never error-coloured; ≤ 1 gold element. §5's enumeration ledger: every region B3 handed over is accounted for — retired, re-fated (A2) or deferred with reasons (A4); the arithmetic is the partition assertion's, not this paragraph's (the sentence that used to sit here said "nineteen" and itemised to twenty). §3.1's `$ref` grammar, §4's compute contract and §9's rel-tol rule are **untouched by construction** — no task changes a compute, a plot style, a colour, a bound or a placement.

**Deliberately deferred, with reasons:** spec §6's instance-state inventory items 1/2/4/5/6/10 (loading, refreshing, compute error, server unavailable, premium locked, version-migrated) — every native is `tier: free`, synchronous and local, so five of the six states are unreachable today and building them would be untested scaffolding; they land with the server lane in Phase C. §6's deletion guard ("N alerts use this instance") needs the Phase-C alert engine to know what an instance-bound alert is. §6's sparkline thumbnails and one-click Starter Set — additive, no enumeration retired, no dependency created. Multi-instance ("RSI(7) and RSI(14) at once") — `instanceControls` is per-definition at v1 by design and spec §5 puts per-chart sets in C.

**Placeholder scan:** every code step carries real code or a named file + line range; no "TBD", no "similar to Task N", no "add appropriate error handling". The three places this plan says "read it before writing" (`stockChartWiring`'s helpers, `api/routers/indicator_alerts.py`'s auth pattern, the `crosshairData.` readers) are instructions to *measure*, not gaps — each names what to look for and what to do with the answer.

**Type consistency:** `catalogRows` / `labelFor` / `longLabelFor` / `oscillatorIds` / `priceOverlayIds` / `CARVED_OUT_ROWS` (Task 2) are spelled identically in Tasks 3, 5, 7 and 11. `INDICATOR_CHORDS` (Task 4) has one shape. `listEngineIndicators(settings, registry)` keeps B3's signature. `chipsFrom(entries, seriesData, registry, inputsFor)` (Task 10) is the only new readout export and `engineChips` keeps its exported signature. `alert_catalog()`'s wire shape is fixed once in Task 9 and consumed once.

**One gap this plan knowingly leaves:** `IndicatorAlertPopover` gains a network dependency for its dropdown. Task 9 gates the loading and error states explicitly and refuses a hardcoded fallback, because a fallback would reintroduce the twin invisibly — but a user on a flaky connection now sees "alert types are unavailable" where they previously saw a list. That is the honest trade and it is stated in the task rather than discovered.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-03-phase-b4-surfaces.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

**Which approach?**
