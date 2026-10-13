# PA-2: one compatibility verdict for every import door

**Date:** 2026-10-13 · **Code:** `audit/indicators-competitive-2026-10-13` at `aac74481b1`. The parent is `4a368e80ed` (production). `app/` and `api/` are identical to it.
**Scope:** investigation and design only. No runtime code, tests or configuration were changed. The scratch probes are in `app/src/__audit_scratch__/phaseA-2/` (not committed): `cum.audit.test.js`, `surface.audit.test.js`, `where.audit.test.js` and `dialects.audit.test.js`.
**Evidence:** the vendor-harness counts come from re-running both Pine doors over all **336** committed TradingView captures (`tests/fixtures/vendor/harness/`). The run used production flags: member pane on, objects-only on, runtime lane off. I joined the result to `migration-corpus/results/ws5-vendor-harness-prodflags-verdicts.json`. Only codes, verdicts and counts are recorded. No market value was read or printed.

---

## 0. Answer in brief

1. **The divergence is two deliberate surfaces, wired to the wrong label.**
   - The engine has a host (chart) lane and a screener (scan) lane on purpose. Ruling R14, 2026-09-15, says *"the refusal set is a property of the surface"*.
   - `ta.cum` is the clearest case. The scan lane refuses it, because a running total from the first loaded bar cannot be compared across symbols or runs. The chart lane draws it under owner ruling D (2026-09-09).
   - The defect: the Import box shows **only the scan lane's verdict**, as if it were the verdict for the chart. The button directly under it then attaches the chart lane's document.
   - The verdict function (`importOutcome`, 2026-10-05) was layered onto the box's existing scan-lane report. Nothing ever computed a verdict from the lane that draws.
2. **Correction to WS5 P0-1 / 03 P0-3.** `ta.cum` is **not** attached with zero disclosure.
   - The chart door stamps `meta.requirementTags: ['window_dependent']`. Both the builder pane (`MemberPane.jsx:191-195`) and the member's real chart (`AttachedPineDisclosures.jsx:154-170`, mounted at `ChartPane.jsx:1148`) render a badge: *"This script counts from the first bar that was loaded, so what it shows depends on how much history is on the chart — N bars here. Load more history and every value moves by the same amount."* Rails cover it (`attachedPineDisclosures.test.jsx:142,195,312`). I re-ran them green.
   - WS5 looked at `notes` and `meta.disclosures` and missed this third channel.
   - What *is* true:
     - (a) The box says "Not supported" and argues the value would be invented, directly above an attach button.
     - (b) The badge never says the value differs from TradingView, and names a bar count rather than a date.
     - (c) The tag walker misses `cum`/`isfirst` that sit only in colour columns or drawing trees. Those attach with **no** badge: `mcclellan-indicators` ×2, and 5 `isfirst` object scripts ×2.
     - (d) Attach needs no acknowledgement.
3. **Silent-acceptance classes exist across the board** (§3). There are six distinct ways, measured.
   - 218 of 336 captures carry a note code the verdict registry does not know.
   - In 77 of them, that alone produces "the values are the same". In 16 of those 77, the values or `na` diverge.
   - 162 attached captures carry host notes the pane drops.
   - 8 diverging captures read "Exact import". All 8 read a history-dependent construct.
4. **The design** (§4) extends what exists: `importOutcome.js`, `_requirement_tags`, the repaint-ack admission, `meta.*` ignore-and-preserve, `row.requirements` and the vendor harness. It adds no parallel infrastructure. It gives:
   - one typed verdict per lane;
   - a closed code registry that fails toward "values may differ";
   - "Exact" gated on recorded evidence;
   - one renderer;
   - a persisted history acknowledgement.
5. **`ta.cum`: recommend Option B** (attach with an acknowledged, persisted disclosure naming the first bar used). It takes C's listing fact as wording only. §5 gives the reasons.

---

## 1. How the paste box and the chart door diverged for `ta.cum`

### 1.1 The two paths, line by line (`plot(ta.cum(volume))`, probe `cum.audit.test.js`)

| step | Paste box (lenient / screener lane) | Chart door (strict / host lane) |
|---|---|---|
| entry | `PineBox.jsx:239-246` `inspectSource` → `routeAndInspect` → `inspectSourceUnguarded` | `MemberPane.jsx:141-145` `memberPaneDefinition({source})` on the **same** `pineText` (`BuilderSheet.jsx:3101-3113`) |
| translate | `PineBox.jsx:322` `memberInputTranslation(translatePine, source, {paramManifest:true})`: **no `strict`**, so `mode:'screener'` | `memberPaneDefinition.js:153-162` `memberInputTranslation(translatePine, source, {paramManifest:true, strict:true, colourInputs:true, guardInputs:true, objectRuntimeCheck})`, so `mode:'host'` |
| `cum` resolution | `pine.js:12678`: `hostServes = this.strict && key && hostOnly` is false; the refusal branch at `:12700`, so the `PINE_INEXPRESSIBLE.cum` sentence (`pine.js:2409-2415`) becomes the output's refusal, guard `pine:function` | Same lines: `hostAdmissible(table)` (`parse.js:135-144`, derived from `_requirement_tags.window_dependent.accepted_by:['pane']`) contains `cum`, so `hostServes` is true and the host's `cum` is kept (the comment at `pine.js:12679-12686` explains why) |
| verdict | `importOutcome.js:143-256`: no usable output, so **UNSUPPORTED**, with the `cum` sentence as reason | `paneGate.js:84` passes. No verdict object exists on this lane |
| notes | `report.ignored = t.notes` (`pine:declaration` only) | Pane `notes` are built from four channels only (`memberPaneDefinition.js:716-760`): object loss, alert/fold notes, withheld paints, displacement params. **`t.notes` is never read** |
| disclosure | refusal text in `import-outcome` (`PineBox.jsx:1124-1134`) + `Refusal` | `requirementTagsRaised(t)` (`memberPaneDefinition.js:1438-1458`) gives `['window_dependent']`, stored in `meta.requirementTags` (`:779,788`). The badge is rendered from it (`MemberPane.jsx:191-195`, `AttachedPineDisclosures.jsx:166-167`) via `parse.js:730-736` `requirementNote` |
| saved doc | via "Use this formula": none (nothing usable) | `compute.source = "cum(volume)"`, `meta.recurrenceOrigin:'pine'`, `meta.disclosures: []`, `meta.requirementTags:['window_dependent']`, `meta.repaint:'non-repainting'`. No `meta.importedFrom` (the pane door never stamps it; only "Apply" does, `BuilderSheet.jsx:451-466,3013`) |
| server | — | `user_definitions.save` stamps `requirements = requirement_tags(definition)` (`user_definitions.py:1784`), walking the **whole** document (`:1236-1300`). `consumer_refusal` then refuses screener/sweep/alert/share/listing by name (`:1312-1360, 2389, 2660`) |

The same split holds for the OBV shape `ta.cum(math.sign(ta.change(close))*volume)`, the v3/v4 bare `cum(...)`, `c - c[10]`, `c - ta.ema(c,20)` and `barstate.isfirst`. The box says Unsupported. The pane attaches with the tag. `ta.cum(1)` alone is refused by both doors ("declares nothing a chart can draw").

### 1.2 When and why each lane got its behaviour (git, read-only)

| date | commit | subject | what it decided |
|---|---|---|---|
| 2026-09-01 | `b0bb44b5c1` | "Segment D was half shipped: `cumFrom` exists and the refusal denied it" | Wrote today's box sentence. *"`cum` names no anchor; picking one would invent the single number the whole answer turns on."* It pointed members to `cumFrom(source, anchor, window)` |
| 2026-09-08 | `01f2390598` | "Strict mode: hosting an indicator is a different question from screening one" | Added `opts.strict` and `mode: 'host'\|'screener'`. *"The screener keeps the lenient contract deliberately — 'which columns can you serve' is a different and legitimate question from 'can you draw this'."* |
| 2026-09-08 | `1d2854b2ac` | "Close the containment gap ta.cum was refused over — on the definition, not the table" | Added `_requirement_tags.window_dependent`, stamped at save and refused by name at five consumers. *"NO MIGRATION AND NO CONSUMER WIRING YET — the schema is with the owner for review"* |
| 2026-09-09 | `0a96689ef0` | "ta.cum ships — on the pane only, and the containment is what made it possible" | **Owner ruling D.** Host mode serves `cum`; the screener still refuses it. Retired `_functions_excluded.cum` (`_cum_was_here`, `closedTable.json:3224`) |
| 2026-09-12 | `559daeb08b` | "T5 pixels — the pane gets a consumer, and four defects only a browser could find" | Mounted `MemberPane` in `BuilderSheet` beside the box, fed `pineText`. Declared the badge `memberNote`, because *"The `ta.cum` badge did not exist as a sentence anywhere"* |
| 2026-09-15 | `1d6c70c421`, `f25a1ed741` | "R14 measured: (C) — neither lane is wrong…"; "R14 ruled: the refusal set is a property of the surface" | On 13 scripts the screener refuses what the host accepts: *"ta.cum x9, window-dependent x2 … all FETCH-DEPTH or ANCHOR dependence"*. Ruled deliberate |
| 2026-09-18 | `e855f62cdb` | "Pine → chart engine: Wave 1 … (#145)" | Squash-merge that put all of the above, plus `memberPaneDefinition` (T3), on master |
| 2026-09-30 | `b9c0e60043` | "feat(pine-c29): serve the rules the 2026-09-30 captures settled (rules 2-7)" | Moved bar counters behind the listing curtain but *"ta.cum stays the host's cum (moving it would blank atr-trailing-stoploss off the listing)"*. Added the rail skip `vendorHarness.c29BarCounters.test.js:59-61` |
| 2026-10-05 | `a0e068ef6a` | "feat(import): P0 imp — imports tell the truth (outcome contract, severities, …)" | `importOutcome.js`: *"verdict shown in the import box"*. Computed from `inspectSource`, which is the screener report. Registered 4 note codes; an unlisted code is PRESENTATION |
| 2026-10-06 | `736e17221b` → `61c63035d8` | rollback, then "Reapply …" | No change to the logic |

### 1.3 Architectural root cause

1. **Two lanes is correct; two *unlabelled* verdicts is the bug.** R14 settled that a scan and a chart may admit different scripts. But the box predates the strict lane: its `inspectSource` was "the only production paste door" (`PineBox.jsx:400-410` comment). The chart door was added *beside* it nine days later. The verdict function then attached to the older report. The member sees one headline, scan-lane, and one button, chart-lane, and is never told which question each answers.
2. **Two verdict computations, and the drawing lane has none.** The box has `importOutcome` (the EXACT…ERROR class). The pane has `paneGate`'s ok/refusal plus four ad-hoc note channels. Nothing projects the host translation into the outcome contract.
3. **Notes produced, then dropped.** The host translation emits classified notes (`pine:strategy-chart`, `pine:strategy-order`, `pine:input-kind`, `pine:chart-only`, …). The pane's note list (`memberPaneDefinition.js:716-760`) never reads `t.notes`, so they reach neither the pane nor `meta.disclosures`.
4. **The classification registry is open.** `NOTE_SEVERITY` (`importOutcome.js:68-75`) lists 4 codes and `MISSING_PART_CODES` lists 2. Everything else defaults to PRESENTATION (`:124-128`). That is fail-closed against "Exact" but **fail-open toward "the values are the same"** (`:248`).
5. **Two tag walkers.** The client walks `translation.outputs[].ast` (`memberPaneDefinition.js:1438-1458`). The server walks the whole document (`user_definitions.py:1279-1300`). When `cum` or `isfirst` sits in a pane-built colour column or an object tree, the server tags it and the screens refuse it, but no badge is drawn.

---

## 2. Verdict-surface map: every place an import verdict, note or disclosure is computed or shown

| # | door / surface | lane | computes (path:line) | renders (path:line) | member strings (examples) |
|---|---|---|---|---|---|
| S1 | Import tab paste box, any dialect (`ImportBox`, `PineBox.jsx:1545`) | Pine: screener (`:322`). thinkScript: `translateThinkScript` (only lane). PCF/formula: `evaluateFormula` (`:403-424`) | `inspectSource` → `importOutcome` (`PineBox.jsx:239-246`; `importOutcome.js:143`) | `import-outcome` (`PineBox.jsx:1124-1134`); semantic list (`:1135-1145`); collapsed presentation notes (`:1037`); `Refusal` (`:428-…`); vendor notes per output; "Inputs you can change later" / "Fixed at their defaults" | `OUTCOME_LABEL` (`importOutcome.js:56-62`); "differences in how it is drawn only; the values are the same" (`:248`); "N differences can change a value…" (`:247`); "not imported: …" (`:242`) |
| S2 | Pine-only box (`PineBox` default export, `inspectPine`) | screener (`PineBox.jsx:149-150`) | `importOutcome({...r, dialect:'pine'})` (`:128-131`) | same component | same |
| S3 | Builder chart door ("Add this script to my chart") | **host** (`memberPaneDefinition.js:153-162`) | `paneGate` (`paneGate.js:84`), `paneObjectsGate`, the notes at `:716-760`, `requirementTagsRaised` (`:779`), `meta.repaint` (`buildDefinition`). Runtime lane (dark): `runtimeLaneDefinition` notes (`:1316-1415`) | refusal `pine-member-pane-refusal` (`MemberPane.jsx:256-259`); notes + badges `pine-member-pane-notes` (`:191-195,285-289`); repaint ack (`:224, 296-309`) | `paneGate` reasons ("this script declares nothing a chart can draw"); `_alertconditions.memberNote`; `_folds[].memberNote`; `objectLossNote`; "`bgcolor` is not drawn: …"; the displacement sentence (`:749-758`); `window_dependent.memberNote`; "This script can repaint recent signals." |
| S4 | Member's real chart (after save) | reads the saved doc | `attachedDisclosures` (`AttachedPineDisclosures.jsx:154-170`) from `meta.disclosures` + `meta.requirementTags`; table-fit, runtime-error, chart-clock and lower-TF notices (`:200-260`) | `ChartPane.jsx:1148` | same sentences, verbatim |
| S5 | Bulk paste (≥2 `//@version` markers) | **raw `translatePine`, screener, no member-input pass** (`libraryIntake.js:71,120`); thinkScript via `translateThinkScript`; PCF/formula has **no translator** (`:114-116`) | `inspectScript` / `inspectLibrary` (`libraryIntake.js:81-203`): translates / computes / saves / screens. **No `importOutcome`, no notes** | `PineBox.jsx:1400-1440` | "N scripts in that paste"; the per-row refusal sentence; "this does not read as Pine, thinkScript or a TC2000 formula" (false for valid PCF) |
| S6 | Formula-tab save after "Use this formula" (Apply) | screener translation | `applyProvenanceFor` (`BuilderSheet.jsx:451-466`) → `meta.importedFrom {dialect, via, sourceLength, sourceFingerprint}` (Pine only); telemetry `import_submitted`/`compile_finished {success:true}` (`:3010-3015`) | none (the provenance is stored; no verdict) | — |
| S7 | Server save | — | `requirement_tags` (`user_definitions.py:1204-1300`) → `requirements` column; `lint_verdict` → `repaint`; `_admit_new_maths` repaint-ack 422; `is_pine_import` (`:1541-1549`). Runtime save path stamps `requirements = "[]"` unconditionally (`:2171`) | refusal sentences at consumers (`consumer_refusal`, `:1312`) | consumer refusal sentences |
| S8 | Agent: Import door | none (opens S1) | `openIndicatorDoor` (`agent/indicatorEntry.js:96-101`) | Agent receipt | "Opened Import on the chart." / "Import isn't available on that chart." |
| S9 | Agent: editing an imported definition | — | `conversationEditability` (`builder/authoring/memberWords.js:105-133`); `compactView` sends the model no `meta.disclosures`/`requirementTags` (`authoring/compactView.js:9-11,194`); `applyPatch` disclosures cover only the Agent's own changes (`authoring/applyPatch.js:1143-1162`) | Agent turn text | "This indicator was imported in a form UCT Intelligence cannot edit yet…"; `CARRIED_NOTE` (`memberWords.js:137`) |
| S10 | Agent: add/hide/remove an imported definition | — | `confirmIndicatorMutation` receipt (`builder/agentMutations.js:475-484`) carries op/ids/inputs only | Agent receipt | none about disclosures. The chart itself still shows S4 |
| S11 | Screenshot / plain-language doors (`ImageBox`, `ConciergeBox`) | own server lanes | no import verdict object | — | out of scope here; listed so nothing is missed |

**Cross-dialect contradiction (S1 vs S3).** `MemberPane` runs `translatePine` on whatever was pasted (`MemberPane.jsx:92,141-145`). A valid thinkScript (`plot avg = Average(close, 20);`) reads **"Exact import"** in the box and "Pine has no character like this one" in the pane, one above the other. A valid PCF (`C > AVGC50`) reads "Exact import" and "the pasted script offers no plot and no alert condition to filter on" (`dialects.audit.test.js`). This assumes the member-pane flag is on, as it is in production per the ledger. The two non-Pine examples above, and the WS6 F1/F2 defects (`STOC14.3 < 20`, thinkScript weekly `Average(close(period=WEEK),10)`), all read "Exact import" today.

---

## 3. Silent-acceptance classes, with counts (336 captures, production flags)

Box × pane over the 336 captures:

| box \ pane | attaches | refuses |
|---|---|---|
| Exact | 34 | 0 |
| Disclosed | 99 | 0 |
| Partial | 18 | 89 |
| Unsupported | 67 | 29 |

| class | mechanism | count | evidence |
|---|---|---|---|
| **C1** Lane mismatch: box refuses, chart attaches | Box verdict comes from the screener lane | **67** captures: objects/no-plot 45, strategy 12, constant-column 6, `cum` 2, session/time 2 | `surface.audit.test.js`; matches the WS5 crosstab |
| **C2** Lane mismatch: box promises a partial, chart refuses | Same | **89** captures. Pane guards: `pine:function` 19, `pine:input-kind` 18, `pine:builtin` 10, `pine:request` 10, `pine:state` 9, others 23 | same |
| **C3** Unregistered code defaults to PRESENTATION, so "the values are the same" | `importOutcome.js:64-75,124-128,248` | **218** captures carry ≥1 unregistered code (box: disclosed 95, unsupported 85, partial 38). **77** read "Disclosed — the values are the same", and in all 77 the only non-INFO notes are unregistered codes. Of those 77: 35 MATCH, **35 DIVERGE** (value 9, `na` 4, value+`na` 3, colour 2, object-only 17), 7 inconclusive | codes seen in the box: `pine:input-kind` 122, `pine:chart-only` 114, `pine:colour-value` 87, `pine:text-value` 78, `pine:drawing` 76, `pine:block` 70, `pine:statement` 64, `pine:vector` 51, `pine:builtin` 41, `pine:function` 25, `pine:request` 22, `pine:type` 17, `pine:function-def` 13, `pine:collection` 11, … (23 distinct; 2 registered) |
| **C4** Notes dropped by the pane | `memberPaneDefinition.js:716-760` never reads `t.notes` | **162** of 218 attached captures carry non-declaration host notes, none of which reach pane notes or `meta.disclosures`. 134 attached captures end with **zero** pane notes, 88 of them despite host notes. All **12** attached strategies carry `pine:strategy-chart`/`pine:strategy-order`; 8 of them have zero pane notes | `surface.audit.test.js`; `cum.audit.test.js` strategy row: `hostNoteCodes:['pine:strategy-chart']`, `paneNotes:0` |
| **C5** "Exact" with no vendor evidence | Exact = absence of notes (`importOutcome.js:251`); no evidence input exists | Of 34 "Exact": 15 MATCH, **11 INCONCLUSIVE**, **8 DIVERGE**. All 8 diverging read a history-dependent construct: `valuewhenOccurrence` (support-and-resistance, trendlines), a switched recurrence (twin-range-filter rddt, vw-ratchet-stops ×2) or `barindex` (vw-call-site-history, vw-other-symbol, vw-runtime-error). I did not attribute each divergence to its construct. For any script never captured (the general case), "Exact" has no evidence at all | `surface.audit.test.js` |
| **C6** History-dependence attached with no sentence | Tag walker gap + untagged classes | **129** of 218 attached captures read a history-dependent construct; only **9** carry a tag (badge). (a) value-shifting `cum`/`isfirst` outside `outputs[].ast`: `mcclellan-indicators` ×2 (`cum` in pane-built colour columns `compute.trees.out15/out16`; box "the values are the same"; harness DIVERGE `na`) and `isfirst` in object trees ×10 (adr-pivots, htf-candle-footprint, MTF supply-demand, volume-profile). (b) `occurrence_dependent` (`valuewhenOccurrence`, 34 attached): tagged server-side but deliberately has no `memberNote` (`closedTable.json` `_requirement_tags.occurrence_dependent.why_the_pane_may`), so no sentence, and 4 of them read "Exact". (c) Switched recurrences / `bar_index` off the listing (11 / 104): withheld as blank by `interpret.js` with **no** disclosure (no notice exists for it; `AttachedPineDisclosures.jsx` covers clock, runtime-error, table-fit and lower-TF only) | `where.audit.test.js`; `surface.audit.test.js` |
| **C7** Cross-dialect contradiction | `MemberPane` translates every paste as Pine | every thinkScript/PCF/formula paste while the flag is on | §2 |
| **C8** Bulk intake reports a third verdict | `libraryIntake.js` uses raw lenient `translatePine`: no `importOutcome`, no notes, no chart lane; PCF unsupported | every multi-script paste. Its "translate" count is a scan-lane count, and the box never says so | `libraryIntake.js:71-173`; `dialects.audit.test.js` (`pcf` → "does not read as … TC2000") |
| **C9** Latent | Runtime-definition save stamps `requirements="[]"` without walking (`user_definitions.py:2171`); the stale migration comment says `translatePine` refuses `ta.cum` "in BOTH modes today" (`:275-281`) | 0 today (runtime save is off) | — |

---

## 4. Design: one shared compatibility-verdict system

### 4.1 Principles

- **One function, one contract, one renderer.** Each lane computes its verdict through the same function, from the translation that lane actually uses.
- **The verdict a member reads before an action is the verdict of the lane that action uses.**
  - "Add this script to my chart" → the host lane.
  - "Use this formula" / scan / alert → the screener lane.
  - Library row → both, labelled.
- **Unknown fails toward doubt.** An unregistered code becomes "values may differ". Missing evidence means "not verified", never "Exact".
- **Every decision is persisted with the definition**, so the chart, the Agent and later readers repeat it rather than re-derive it.

### 4.2 The verdict function

- **Extend `engine/ast/importOutcome.js`.** Do not add a parallel module.
  - Add `compatibilityVerdict(input, { lane, evidence, registry })`.
  - `input` is either an `inspectSource` report (screener lane) or a `memberPaneDefinition` result (host lane: `{translation, definition, notes, requirementTags, rows}`).
  - `importOutcome(report)` stays as a thin adapter (`compatibilityVerdict(report, {lane:'scan'}).legacy`), so the ~40 rails that pin `OUTCOME_LABEL` keep meaning during the move.
- **Host-lane projection:**
  - outputs → `rows` the pane draws;
  - every `t.notes` code via the registry;
  - `paneObjectsGate.loss`;
  - withheld paints;
  - displacement;
  - `requirementTags`, computed by the **server-equivalent whole-document walk** (see §4.6);
  - `meta.repaint`;
  - the `declaration` (`strategy` → `behaviour.orders`).
- **Compute once, share.** `BuilderSheet` already holds `pineText`. Build the host result once (`useMemo`) and pass it to `MemberPane` and to the box. The `translation` seam already exists: `memberPaneDefinition({translation})` at `memberPaneDefinition.js:133`. This removes one of the two per-keystroke Pine translations instead of adding a third.
- **Dialect routing.** For a non-Pine paste the host lane is not Pine. thinkScript and PCF compute their chart verdict from their own translation and formula evaluation, through the same function with `lane:'chart'`. `MemberPane` must stop translating non-Pine text (C7). Gate it on `detectDialect(pineText) === 'pine'`, which is the same detector the box uses.

### 4.3 Typed outcome model (`uct.import-verdict/1`)

```js
{
  contract: 'uct.import-verdict/1', lane: 'chart' | 'scan', dialect,
  registryVersion, tableVersion,                 // what classified it
  headline: 'exact' | 'differs' | 'partial' | 'not-imported' | 'error',
  values: { status: 'exact' | 'differs' | 'not-imported',
            items: [{ output, status, code, text, evidence: 'vendor' | 'reference' | 'none' }] },
  visuals: { kept: [{ what }], changed: [{ what, from, to, code }], dropped: [{ what, code }] },
  inputs:  { editable: [{ name }], fixed: [{ name, value, code }] },
  behaviour: {
    alerts:  [{ name, where: 'alerts' | 'not-delivered' }],
    orders:  null | 'not-simulated',             // pine:strategy-*
    repaint: 'non-repainting' | 'preview-repaints' | 'repaints',
    history: [{ tag: 'window_dependent' | 'occurrence_dependent' | 'listing_dependent',
                construct, policy: 'disclosed' | 'acknowledged' | 'refused', firstBarRule }],
  },
  unknownCodes: [code…],                         // classified fail-closed, listed for telemetry
  evidence: { level: 'vendor' | 'reference' | 'none', missing: [constructKey…] },
}
```

- **Headline derivation:**
  - `not-imported` if nothing drawable.
  - `partial` if any output, part or behaviour (orders) is missing.
  - `differs` if any value item is `differs`, any history entry exists, any unknown code is present, or evidence is not complete.
  - `exact` only otherwise, and only with `evidence.level !== 'none'` for every construct.
- **Visual-only differences** (`visuals.changed/dropped`) never move the headline off "exact values". They are listed separately as "drawn differently", replacing today's single "the values are the same".
- **Persisted summary on save:** `meta.importVerdict = {contract, lane:'chart', headline, codes:[…], history:[…], evidence:level, registryVersion, tableVersion, at}`.
  - It is compact, with no sentences.
  - `meta.*` is ignore-and-preserve under `defSchema` (`memberPaneDefinition.js:770-776`), so no schema change is needed.
  - `meta.disclosures` keeps the rendered sentences for S4, as today.

### 4.4 Closed note-code registry

- **Where:** expand `NOTE_SEVERITY`/`MISSING_PART_CODES` in `importOutcome.js` into one exported, frozen `NOTE_CODES` map.
  - Each code gets: `{ class: 'info' | 'presentation' | 'value' | 'missing-part' | 'behaviour' | 'input', dialects, sentenceKey? }`.
  - Alternatively, place it as data in `closedTable.json` beside `_folds` and `_requirement_tags`. If it goes there, it must be added to the `manifestProse` keep-list, because `1d2854b2ac` records that the strip almost dropped `_requirement_tags`.
  - Recommendation: keep it in `importOutcome.js`. The Python side does not compute import verdicts.
- **Size:** about 96 code literals today: `pine.js` 50, `thinkscript.js` 34, `pcf.js` 12 (`grep -oE "'(pine|thinkscript|pcf):[a-z0-9-]+'"`).
- **Classification proposal for the 23 codes observed in the box:**
  - info: `pine:declaration`.
  - presentation: `pine:chart-only`, `pine:colour-value`, `pine:text-value`, `pine:drawing`.
  - input: `pine:input-kind`.
  - value: `pine:block`, `pine:statement`, `pine:vector`, `pine:builtin`, `pine:function`, `pine:request`, `pine:type`, `pine:function-def`, `pine:collection`, `pine:reassign`, `pine:offset-literal`, `pine:tuple`, `pine:arity`, `pine:state`, `pine:undefined`, `pine:timeout`.
  - missing-part: `pine:strategy-call`, `pine:strategy-chart`.
  - behaviour: `pine:strategy-order`.
  - A host-lane note means a line no drawn output reads. Any code that can skip *computation* is therefore classified `value` until a rail proves the skipped line cannot feed a drawn output. That is the honest direction.
- **Fail-closed rule:** `classifyNote` returns `value` for an unknown code (not `presentation`) and records it in `unknownCodes`.
- **Rails:**
  - **R-reg-static:** scan the translator sources for code literals; every one must be in `NOTE_CODES`. This follows the `hostAdmissible` "derived, never typed" pattern.
  - **R-reg-emitted:** run the committed corpus (266), the captures (336) and the 185-construct probe through both lanes; every emitted code must be registered. CI fails on any new code.

### 4.5 Evidence levels

- **Build the registry from the vendor harness, not by hand.** Add `tools/vendor_harness/evidence.mjs`. It runs `__tests__/vendorHarness/ourSide.js::enterMemberDoor` over `tests/fixtures/vendor/harness/` and joins with the `compare.mjs` per-plot verdicts. It emits `engine/ast/constructEvidence.json`.
  - Format: `{ constructKey: { vendor: [{capture, plot, verdict, tfClass}], reference: [testFile…] } }`.
- **Construct keys:**
  - the table call names in the drawn trees;
  - the fold channels (`htfLookaheadOffStepBacks`, `baseTimeframeFolds`, …);
  - the carried presentation attributes.
- **Reference tests** (`*.vendor.test.js`, `engine/__truth__/*.truth.test.js`, independent-maths rails) register themselves with a one-line `evidence('ta.rsi', __filename)` call, or through a static index the rail checks.
- **Rule:**
  - `exact` requires every construct key of every drawn output to have ≥1 vendor MATCH in the same timeframe class (daily vs intraday), or a reference test.
  - A key with any **unattributed** DIVERGE is downgraded to `differs` with the recorded cause.
  - The member reads "Exact — checked against TradingView" or "Exact — checked against reference maths". Without evidence the line reads "Imported — not yet checked against TradingView".
- **Rail R-evidence:** the generated file must be fresh (regenerate in CI and diff). Every key named `vendor` must reference a capture that exists.

### 4.6 History-dependent (unsafe) construct policy

- **One taxonomy, in `_requirement_tags`** (extend it; do not add a new mechanism):
  - `window_dependent` (exists: `cum`, `isfirst`);
  - `occurrence_dependent` (exists: `valuewhenOccurrence`; add a `memberNote`);
  - **new** `listing_dependent`: switched `accum` recurrences (`readsSwitchedState`, `listingDeepen.definitionWithholdsOffListing`) and the `barIndexMask` class. Its `memberNote` says what is withheld and why. It is accepted by `pane`, refused by nothing new (these are holes, not shifted values), and **disclosed**.
  - `barssince` (unbounded) stays refused on the host lane, as today (`cum.audit.test.js`: `pine:function` on both doors).
- **One walker:**
  - Replace `requirementTagsRaised(translation)` with a whole-definition walk that is the twin of `user_definitions.requirement_tags`: same rosters, same period-anchor exemption.
  - Add parity rail **R-tags:** client tags == server tags for every corpus and capture document. The precedent is `lookbackAgreement`.
  - This closes C6a (mcclellan, isfirst-in-objects).
- **Acknowledgement:**
  - A document whose tags include `window_dependent` gets an attach control modelled on the repaint ack (`MemberPane.jsx:216-226,296-309`). Suggested checkbox wording: "I understand this total starts at the first bar on my chart."
  - The server gets an `_admit_new_maths` twin: `history_acknowledged` is required for a NEW-maths save carrying `window_dependent`, else 422 `history-ack`, mirroring `repaint-ack`.
  - The ack persists as `meta.historyAck = {tags, at}`. A copy-install (share) carries it.
  - `occurrence_dependent` and `listing_dependent` are disclosed but need no ack: they draw holes, never shifted numbers.
- **Disclosure text** is finished with the first bar's **date** as well as the count. `onDrawnBarCount` (`MemberPane.jsx:104-107`; `ChartPane.jsx:278-…`) gains the first bar's `t`. The producer still owns the words (`parse.js::requirementNote`).

### 4.7 One renderer

- **New `builder/ImportVerdict.jsx`.** It is a pure presentational component taking a `uct.import-verdict/1` object, in `full` and `compact` variants, plus a pure `verdictText(verdict)` in `importOutcome.js` for non-React consumers.
- **Consumers:**
  - PineBox replaces `PineBox.jsx:1124-1145` and the collapsed-note toggle. It shows the **chart** verdict first, then "As a scan column: …" when that path is offered.
  - MemberPane replaces `:285-289`; the badges become `behaviour.history` entries.
  - AttachedPineDisclosures uses compact mode from `meta.importVerdict`, plus the live badge.
  - The bulk-intake row (S5) shows each script's chart and scan headlines.
  - Agent receipts (S8–S10) call `verdictText`.
- **Agent:**
  - `compactView` adds `importVerdict` (headline plus history tags; codes only, no sentences, keeping its `{untrusted_text}` rule).
  - `confirmIndicatorMutation` receipts for `add`/`setVisible` of a definition whose `meta.importVerdict.headline !== 'exact'` append the one-line text.
- **Rail R-render:** the same verdict yields identical sentences in all five surfaces (snapshot of `verdictText` vs DOM text). This follows `AttachedPineDisclosures`' existing "two surfaces produce the identical list" rail.

### 4.8 Migration of existing saved definitions

- **What is stored today:**
  - Pane-door docs: `meta.recurrenceOrigin:'pine'`, `meta.disclosures`, `meta.requirementTags` (both since ~2026-09-13), `naConditionFalse`, `otherSymbols`, …
  - Apply-door docs: `meta.importedFrom {dialect:'pine', via:'apply', sourceLength, sourceFingerprint}`.
  - The server row stores `requirements` and `repaint`. Rows already deliver `requirements` to the client (`user_definitions.py:1459`), which ignores it.
  - **Nothing records the verdict that was shown.** Telemetry logs only `{success:true}` (`BuilderSheet.jsx:3015`).
  - The Pine source is not stored (G11), so a stored import **cannot be re-translated**.
- **Plan:**
  - **Derive on read, never rewrite.** This follows the `materialize` read-side precedent (`user_definitions.py:1440-1450`). A missing `meta.importVerdict` yields `{headline:'differs', derived:'migrated', history: tags from row.requirements ∪ meta.requirementTags ∪ tree walk}`.
  - Migrated docs are **never** shown "Exact". The text says "Imported before import checks were recorded."
  - Persist the real verdict on the next save.
  - S4 reads `row.requirements` as well as `meta.requirementTags`. This immediately fixes the missing badge on already-saved mcclellan-shape docs with no data migration.

### 4.9 Files that would change (for the build phase; none were touched here)

| part | files |
|---|---|
| verdict + registry | `engine/ast/importOutcome.js` (+ `.test.js`), `builder/PineBox.jsx`, `builder/memberPane/memberPaneDefinition.js`, `builder/memberPane/MemberPane.jsx`, `builder/BuilderSheet.jsx` (shared host build, pass-through) |
| tags / history | `engine/ast/closedTable.json` (`_requirement_tags`: `occurrence_dependent.memberNote`, new `listing_dependent`), `engine/ast/parse.js` (`requirementNotesOf`, `requirementNote` with date), `memberPaneDefinition.js` (whole-doc walker), `api/services/user_definitions.py` (`_admit_new_maths` history ack; runtime path `:2171` walks too; stale comment `:275-281`), `hooks/useUserDefinitions.js` (send `history_acknowledged`) |
| evidence | `tools/vendor_harness/evidence.mjs` (new script in the existing tool dir), `engine/ast/constructEvidence.json` (generated), vendor tests register keys |
| renderer | `builder/ImportVerdict.jsx` (+ css), `pane/AttachedPineDisclosures.jsx`, `pane/ChartPane.jsx` (first-bar time) |
| bulk / Agent | `builder/libraryIntake.js` (route through `compatibilityVerdict`, both lanes, PCF routed), `agent/indicatorEntry.js` (receipt unchanged; door only), `builder/authoring/compactView.js`, `builder/agentMutations.js` (receipt line) |
| rails | `vendorHarness.c29BarCounters.test.js:59-61` (assert C05 drawn and tagged), `vendorHarness.corpus.test.js` / `memberDoorCensus.measure.test.js` (contradiction rail), `pineBoxImportOutcome.test.jsx`, `__truth__/p0.imp.truth.test.js`, `ImportBox.*.test.jsx`, `bothLanesAgreeOnFacts.test.js`, `pineCumHostMode.test.js`, `tests/test_requirement_tags.py` |

**Risks.**
- Many rails pin today's box wording (`p0.imp.truth` has 38 cases; the ImportBox/PineBox suites). Use the adapter to move them deliberately, not by bulk regeneration.
- Making the chart verdict primary changes what members read for 156 of 336 captures (C1 and C2).
- Classifying 17 codes as `value` turns many "Disclosed — drawn only" into "values may differ". This is honest, but it is a visible downgrade: 77 captures. The owner should see the before/after table.
- The history ack adds a click for OBV/AD imports.
- The whole-doc walker will newly tag existing saved docs on their next save. That is correct, and the server already tags them, so screens do not change.
- Sharing the host build must not reintroduce the `inspectSourceUnguarded` "named fields only" projection trap (`PineBox.jsx:386-410`).

---

## 5. `ta.cum` specifically

**What UCT knows about history depth per symbol:**
- `/api/ticker-ipo/{sym}` gives `list_date` / `first_trade_date`.
- `listingSeed.historyFromListingOf` (`listingSeed.js:48-60`) answers `true` **only** for a daily series whose first bar equals the listing date exactly (`listingReferenceDate`, `:79-84`). It answers `false` for weekly and for every intraday chart.
- The provider's daily archive starts 2003-09-10. Older history exists only where the yfinance deep graft ran. Megacaps were truncated at 2003 by the warm-skip defect (memory `deep-history-2003-truncation`), and `_DEEP_TARGET` caps others at ~1976.
- Grid cells first-paint 600 bars. `listingDeepen.js` deepens them only for switched recurrences, not for `cum`.
- So `historyFromListing` is often false even on daily charts.

| option | what the member gets | for | against |
|---|---|---|---|
| A: refuse on both doors | Nothing for OBV/A-D/cumulative-delta scripts (`ta.cum` 2.7% + v4 `cum` 2.1%) | Simplest; no history question | Reverses owner ruling D (`0a96689ef0`). `atr-trailing-stoploss` rddt-1d is a vendor **MATCH** today and would refuse. It also throws away the containment that already makes screens safe |
| **B: attach with an acknowledged, persisted disclosure naming the first bar** | The line draws. Verdict "Values differ from TradingView: a running total from <first bar date> (N bars)". Ack checkbox; `meta.historyAck`; the badge names the date | Keeps reach. Uses existing tag, consumers, ack and badge; mostly a wording, walker and ack change. Truthful on every timeframe | One click more; the level is still not TradingView's off the listing |
| C: anchor at the listing when full history is held | Exact values only where `historyFromListing` is true | Exact where it applies | Daily-only. On intraday, TradingView's own `ta.cum` starts at **its** plan-limited first bar, so no anchor reproduces it (captures `vw-bar-counters-spy-{1,30}` row C05 differ on every bar). Off the listing, C must refuse or withhold. That blanks many megacaps whose stored history does not reach the listing |

**Recommendation: B, with C's fact used for wording only.**
- When `historyFromListing` is true, the badge says the total runs "from the listing, YYYY-MM-DD — the same start TradingView uses on a daily chart with full history". The verdict may then cite the rddt-1d MATCH as evidence for the daily-from-listing class.
- Otherwise it names the first bar's date and says the level differs by a constant.
- The scan lane keeps its refusal, shown as the secondary "As a scan column" line, because the screens' reason is still true.
- Fix the walker (C6a). Replace the `c29BarCounters` skip with assertions that C05 is drawn, tagged, and that its harness DIVERGE is attributed to `window_dependent`.
- **Later refinement (owner call):** `_functions_cumulative` already gives the test for when a `cum` expression is exact anywhere: invariance under `C → C + k` (`C − C[n]`, `C − ema(C,n)`, crossings of `C` with its own average). A static invariance check could promote those uses to "exact" without any anchor.

---

## 6. Saved definitions that contain host `cum` from Pine imports

**Detection.** No production access was used; these are queries for the owner to run.
- Server, authoritative: the newest version per `(user_id, def_id)` with `deleted_at IS NULL`, `requirements LIKE '%"window_dependent"%'`, and
  `json_extract(definition,'$.meta.recurrenceOrigin') = 'pine' OR json_extract(definition,'$.meta.importedFrom.dialect') = 'pine'`.
  - Pine-origin plus `window_dependent` means a Pine `cum`/`isfirst` import.
  - Without Pine origin it is a member-typed `cum` formula, which is not an import.
- Tree signature, a defensive cross-check for the runtime-path `"[]"` stamp (`:2171`): any node `{"type":"call","name":"cum"}` or `{"type":"series","name":"isfirst"}` anywhere in `definition`.
- **Badge-missing subset:** server `requirements` has the tag but `meta.requirementTags` lacks it. These are the mcclellan / `isfirst`-in-objects shapes. On the member's chart they currently draw with **no** history sentence.
- Era marker: `meta.disclosures` absent means saved before T5b (~2026-09-13).

**What should happen to them:**
1. **Keep drawing.** Never remove or blank a member's saved indicator silently.
2. **Immediately, read-side:** S4 unions `row.requirements` into the badge, which fixes the badge-missing subset. Show a migrated verdict ("Imported before import checks were recorded — values depend on loaded history").
3. On the next open or edit in the builder, show the history ack. The save then persists `meta.importVerdict` and `meta.historyAck`. No forced re-save.
4. The screens, alerts, shares and listings already refuse these by name (`consumer_refusal`). No change.

---

## 7. Test and acceptance plan

| rail | asserts | runs |
|---|---|---|
| R-reg-static | every translator code literal is in `NOTE_CODES`; an unknown code classifies `value` | PR (fast) |
| R-reg-emitted | every code emitted on 266 committed + 336 captures + 185 probes, through both lanes, is registered | PR (≈1 min translate-only; the census run here took seconds per hundred) |
| **R-contradiction (vendor harness)** | per capture, chart verdict vs drawing lane: (a) `not-imported` ⇔ `paneGate` refuses; (b) every drawn row is a `values.items` entry; (c) every non-INFO host code appears in the verdict; (d) `exact` ⇒ harness not DIVERGE unless the divergence is attributed, and evidence is complete; (e) client tags == server tags; (f) strategy ⇒ `behaviour.orders`. **Zero contradictions** | nightly (full harness, ~142 s) + PR subset |
| R-tags | `requirementTagsRaised` twin == `user_definitions.requirement_tags` on every document (JS↔Python fixture) | PR |
| R-evidence | `constructEvidence.json` regenerates identically; referenced captures exist | PR |
| R-render | `verdictText` == PineBox == MemberPane == AttachedPineDisclosures == library row == Agent receipt text, for a fixture set | PR |
| R-history | `cum`, `isfirst`, OBV, `c − c[10]`, `valuewhen` occurrence, `var` counter, `barssince`: verdict + tag + ack required + server 422 without the ack + `meta.historyAck` persisted + the badge names the date; `historyFromListing` wording | PR (+ `tests/test_requirement_tags.py` extension) |
| R-migrate | fixtures from each era (pre-T5b, pane doc, apply doc, mcclellan shape, runtime `"[]"` row) → derived verdict, never `exact`; badge from `row.requirements` | PR |
| R-dialect | a thinkScript/PCF paste never reaches `translatePine` in `MemberPane`; its chart verdict comes from its own lane | PR |
| c29 update | C05 drawn, tagged, attributed (replaces the skip at `:59-61`) | PR |

**Acceptance:**
- R-contradiction is green with zero contradictions over 336 captures.
- No "Exact" without evidence.
- No attached history-dependent document without a sentence.
- The owner reviews a before/after table of headline changes per capture before release.

---

## 8. Owner decisions

1. **Lane contract for the box (G2).** Show the chart verdict as primary and the scan verdict as a labelled second line? This keeps ruling R14: the surfaces differ, and each is now named.
2. **`ta.cum`:** Option B (recommended), A or C.
3. **Acknowledgement strength:** a checkbox plus a server 422 (the repaint model), or disclosure only.
4. **Bar for "Exact":** vendor capture only, or a reference test too; and whether daily evidence covers intraday.
5. **Re-classifying 17 skip codes as `value`** turns 77 "drawn only" headlines into "values may differ". Accept the visible downgrade?
6. **Migration:** read-side derivation (recommended), or a one-time backfill of `meta.importVerdict`.
7. **Store the Pine source (G11)?** It would let verdicts be recomputed after engine upgrades. The trade-offs are licence and size (64 KiB cap).
8. **Agent:** should receipts for adding or editing an imported indicator carry its one-line verdict? Should `compactView` expose it to the model?
9. **`listing_dependent` as a new tag with a member sentence.** This covers the 11 switched-recurrence and `bar_index` blanks that are unexplained today.
