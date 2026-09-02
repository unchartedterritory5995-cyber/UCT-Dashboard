---
id: SPEC-S8
title: Provenance & Freshness (S8) — Technical Specification
role: Phase 3 deliverable — technical specification for a LOCKED system (ARCHITECTURAL_DECISION_REGISTER D6), building directly on PRD-S8
phase: 3
group: technical-architecture
category: spec
scope: Specifies HOW to build S8 against the real UCT codebase — exact files to reuse, files that need modification, new files required, data contracts, integration points, and migration sequencing. Does not re-argue D6 (LOCKED) or restate PRD-S8's product rationale; cites it by section instead of re-deriving. Not implementation — no application source file was touched to produce this document; Phase 4 builds it.
status: draft — Phase 3 deliverable, awaiting review
date: 2026-09-02
sources: PRD-S8 (provenance-freshness-prd.md, all sections) · product-architecture.md (S8 §5, I1 §7 incl. the corrected boundary, §8 boundary matrix, §10 reversibility ledger, §11 "kept" list) · information-architecture.md (§2 property 3, §3.1 panel-contract `freshness` field via §5, §4.2 crossings, §7.4 collision policy, §12 workflow chains) · data-architecture.md (§11 Provenance, §12 Freshness Metadata, §13 Confidence/Data-Quality, §14 Licensing/Entitlement Metadata, §23 AI data access, §24 Frontend access patterns) · capability-infrastructure-matrix.md (S8 row §3, D2 row §4) · capability-ledger.md (rows G2, H5, K2, D12, A10 — read verbatim) · tech-debt-register.md (TD-02, TD-08, TD-18, TD-19, TD-20 — read verbatim) · ARCHITECTURAL_DECISION_REGISTER.md (D6) · GOVERNING_PRINCIPLES.md (§9, §13, read in full) · READINESS_REVIEW_DAY1.md (§4, §7 D6) · DAY_1_EXECUTIVE_SYNTHESIS.md (§1.12, §1.14, §4.3, §12.3) · PHASE_2_INTEGRATION_SYNTHESIS.md (fix 5) · direct codebase reads (cited inline by exact path throughout, listed in §2)
confidence: 🟡 overall — 🟢 wherever this file cites a real file it read directly (path + what was found); 🟡 wherever it composes a build plan across multiple cited files; 🔴 on nothing owner-bound — S8 remains LOCKED and this spec introduces no new escalation
---

# Provenance & Freshness (S8) — Technical Specification

## 0. What this document is, and what it is not

This is the buildable technical specification for S8, following PRD-S8. It answers a narrower question than the PRD: not *what* S8 must do and *why*, but *which exact files in today's codebase this is built from*, what changes, what is new, and in what order. Every reuse/modify/new determination below was made by reading the cited file, not by inference from the architecture documents alone — §2 lists every file read to produce this spec.

**What this is not.** Not a redesign of D6 (LOCKED) or a re-argument of S8's boundary (PRD §3, restated from product-architecture.md — this document inherits it verbatim). Not a component library — no `.jsx`/`.py` file was written; every code fragment below is either quoted from an existing file (to justify a reuse claim) or a prop/shape sketch (to specify a contract), never a finished implementation. Not a sprint plan — §19 sequences dependencies, not story points.

---

## 1. Traceability (pointer, not re-derivation)

S8's full traceability chain — north-star capability, target workflow, existing UCT mechanism, gap, proposed system — is PRD-S8 §1 and is not re-derived here. The one fact this spec adds to that chain, found by reading the code directly (§2, §3.6 below): the gap PRD-S8 §1 describes (`CoverageLine`/COT-gate/AI-Search-chips, "real mechanisms exist scattered... no shared component," `READINESS_REVIEW_DAY1.md` §4) is **larger today than the cited evidence states** — `CoverageLine`'s own idiom has already been independently reinvented a further two times since the ledger was written (`pages/calendar/WireView.jsx`'s own local `CoverageLine` function, `pages/journal-2-0/components/analytics/TaxCenterSection.jsx`'s inline receipt paragraph — both cited in full in §3.6). This does not change S8's contract; it sharpens the cost of delay already implicit in the PRD.

---

## 2. Grounding discipline — files read to produce this document

Per this task's contract, every reuse/modify/new claim below is grounded in a file actually read, not assumed from the architecture documents. Files read in full or by targeted section, with what each established:

- `app/src/components/screener/CoverageLine.jsx` (159 lines, read in full) — the four-count receipt component itself: its refusal-to-render-a-broken-receipt logic, its `withheld`-beside-not-inside rendering, its causes-tally, its `role="alert"`/`data-testid` observability idiom.
- `app/src/components/screener/CoverageLine.test.jsx` (partial) — the test-fixture convention (derive the fixture's `evaluated` from the other three counts, never restate all four as literals).
- `api/services/screener/scan_evaluator.py` (targeted: `_apply_limits`, `_history_withheld`, `_assert_coverage_closes`, `_assert_sweep_closes`, `run_sweep`'s coverage-record shape, ~lines 990–1300 and 1690–1720) — the coverage-closing assertion pattern and the exact wire shape (`evaluated, answered, dropped, not_computable, withheld, withheld_reason, dropped_symbols, dropped_listed, truncated, recorded, record_refused, mode, persisted`) `<CoverageLine>` is designed against today.
- `api/services/bar_provenance.py` (70 lines, read in full) — the actual narrow provenance shape in production: `(ticker, tf, bar_time) → source, validated_at, verified_at`. Flat `source` string, no Entity/Activity split, no tie-break record.
- `api/services/entitlements.py` (targeted grep: `ToolkitWithheld`, `WITHHELD_REASONS`, `toolkit_for`, `limits_for`) — the server-side `withheld` mechanism S8 renders but never decides.
- `app/src/utils/jsonFetcher.js` (39 lines, read in full) — the one throwing fetcher (14 consumers per TD-18) that S8's honest-blank states build downstream of.
- `app/src/pages/charts/widgets/AiSearchWidget.jsx` (targeted: `GROUNDING_LABELS`, `groundingChips()`, the `Exchange` render function) — the existing "grounded on" chip renderer S8 replaces.
- `app/src/components/admin/AiSearchInsightsPanel.jsx` (targeted: the fetcher at line 14) — confirmed the literal `.catch(() => null)` TD-18 cites.
- `app/src/components/research-kit/CoverageNote.jsx` (70 lines, read in full) — a fourth honest-partial-receipt idiom (the research composite's re-weighted-basis disclosure), confirming TD-08's five-implementation count and `current-ui-architecture.md`'s "FreshnessBadge: absent (five partial)" row.
- `app/src/pages/journal-2-0/components/SyncFreshnessChip.jsx` (77 lines, read in full) — the broker-sync freshness pill, one of TD-08's five.
- `app/src/pages/charts/widgets/ChartMarketClock.jsx` (98 lines, read in full) — the chart-panel session clock, one of TD-08's five; confirmed it already shares `sessionModel.js` with the Dashboard's `MarketClock.jsx` ("reuses `useMarketOpen` + `sessionModel`/`nextOpenHint` so the status can never disagree").
- `app/src/components/dashboard/sessionModel.js` (22 lines, read in full) — the existing session-state seed (`sessionModel()`, `nextOpenHint()`), and confirmed its actual scope: `isOpen`/`isPremarket`/`isExtended` booleans only, no holiday or half-day table.
- `app/src/pages/calendar/WireView.jsx` (targeted: lines ~46–115) — a locally-defined `CoverageLine` function, independent of the screener's component, confirming the drift PRD-S8 §1 names is still active.
- `app/src/pages/journal-2-0/components/analytics/TaxCenterSection.jsx` (targeted: ~lines 100–110) — an inline coverage paragraph, explicitly commented `// CoverageLine idiom`, with no shared component at all.
- `app/src/widgets/registry.js` (header comment, ~70 lines) — the panel-manifest convention S8's components' consumers (application panels) already follow.
- `api/services/serve_stale.py` and `api/services/cache_policy.py` (module docstrings) — D4's existing serve-stale/never-cache-a-partial-as-complete idioms, confirming D4 is "extend," not "new," and that a freshness stamp is already a first-class concept in D4's own design language.
- `api/services/provider_coverage_monitor.py` (module docstring) — D12's per-field fill-rate detect→self-heal→alert-on-change pattern, the shape the confidence/evidence-class field (data-architecture.md §13.3) generalizes.
- Grep sweeps confirming absence: no `Data Delayed` / `Del-15` / Financial Status Indicator string anywhere in `app/` or `api/` (§6.4 below); no `staleWindowLabel.jsx`/`.js` source file exists despite the ledger naming it (only a `.test.jsx` survives, testing a stale-pairing behavior inside `BreadthViews`, not a standalone component).

---

## 3. Reuse / Modify / New — top-line inventory

| # | Item | Disposition | Existing file (if any) | What changes |
|---|---|---|---|---|
| 3.1 | `<CoverageLine>` | **REUSE the logic, RELOCATE the file, EXTEND the props** | `app/src/components/screener/CoverageLine.jsx` | See §3.1 below |
| 3.2 | `<FreshnessBadge>` | **NEW**, consolidating 5+ scattered instances | none (5 partial precedents, §3.2) | New component; existing instances migrate onto it as a follow-on, not part of S8's own build |
| 3.3 | `<Provenance value=…>` | **NEW** | none found anywhere in the estate | New component |
| 3.4 | `<Cited row=…>` | **NEW, narrow-form only until D2** | none (bar_provenance.py is the narrow data source, not a renderer) | New component, degraded/narrow by design until D2 |
| 3.5 | Session-state seed | **REUSE as-is** | `app/src/components/dashboard/sessionModel.js` | No code change; S8 consumes it directly as S11's interim form |
| 3.6 | Throwing fetcher | **REUSE as-is** | `app/src/utils/jsonFetcher.js` | No code change; the platform's one data-access hook (data-architecture.md §24.1) wraps it, S8 renders what it resolves to |
| 3.7 | Coverage-closing guard | **REUSE the pattern, port to a shared helper** | `api/services/screener/scan_evaluator.py::_assert_coverage_closes` | New shared Python + JS helper with the same assertion shape; every application evaluator calls it before its payload reaches `<CoverageLine>` |
| 3.8 | Grounding-gate shape | **REUSE the pattern, no code shared** | `api/services/cot_narrative.py`, `app/src/pages/cot/cotFacts.js` | Stays in COT's own JS/Python (product-architecture.md §11 "kept" list: "do NOT replace Chart.js here" extends to not porting the analytics); every future I1 narrative lane copies the shape, S8 renders the result |
| 3.9 | AI Search grounding chips | **MODIFY (consumer migration, not S8's own build)** | `app/src/pages/charts/widgets/AiSearchWidget.jsx` (`GROUNDING_LABELS`, `groundingChips()`) | Replaced by `<Cited row=…>` once S8 ships; tracked against A8/I1, not S8 |
| 3.10 | Confidence/evidence-class mechanism | **REUSE the shape, not the code** | `api/services/provider_coverage_monitor.py` | Same detect→self-heal→alert skeleton, applied to a per-value field instead of a per-field fill-rate |
| 3.11 | `withheld` server-side signal | **REUSE as-is** | `api/services/entitlements.py` (`ToolkitWithheld`, `WITHHELD_REASONS`) | No code change; S8 renders the resulting state |
| 3.12 | Provenance data shape | **REUSE the narrow shape as today's input; document the gap to D2's target shape** | `api/services/bar_provenance.py` | No code change to this file; S8's `<Provenance>`/`<Cited>` build an adapter over its actual columns (§5.1) |
| 3.13 | Independently-reinvented receipt instances | **MIGRATE onto the shared component (Phase 4 follow-on)** | `app/src/pages/calendar/WireView.jsx` (local `CoverageLine`), `app/src/pages/journal-2-0/components/analytics/TaxCenterSection.jsx` (inline paragraph) | Not S8's own build; named here so Phase 4 tracks them as consumers, not left to re-drift |

---

## 4. Component architecture — the four primitives, specified against real files

### 4.1 File layout

New shared directory `app/src/components/provenance/`, mirroring the existing convention for a cross-application primitive family (`app/src/components/research-kit/`, `app/src/components/mobile/` — both are directories of shared, non-domain-specific components consumed by many pages, exactly S8's shape).

- `app/src/components/provenance/Provenance.jsx` — **NEW**
- `app/src/components/provenance/FreshnessBadge.jsx` — **NEW**
- `app/src/components/provenance/CoverageLine.jsx` — **MOVED** from `components/screener/CoverageLine.jsx` (`git mv`, preserving history), extended per §4.4
- `app/src/components/provenance/Cited.jsx` — **NEW**
- `app/src/components/provenance/honestStates.js` — **NEW**, pure helper mapping raw fetch/provenance/entitlement signals to the 7-state taxonomy (PRD §6/§9) as typed props, so no consuming component re-derives the state machine itself
- `app/src/components/screener/CoverageLine.jsx` — **kept as a re-export shim** (`export { default } from '../provenance/CoverageLine'`) through the migration window in §19, so the 7 confirmed current importers (`ScanResults.jsx`, `RunNowButton.jsx`, `EvidenceTab.jsx`, `ScreensManager.jsx`, `ScannerShell.jsx`, plus `WireView.jsx`/`TaxCenterSection.jsx` once migrated in per §3.13) never need a same-day rewiring

### 4.2 `<Provenance value=…>`

No existing precedent anywhere in the estate — confirmed by `current-ui-architecture.md`'s own inventory row ("FreshnessBadge: absent (five partial)") naming only freshness chips, none of which carry a source-attribution popover. This is genuinely new.

**Props (sketch, not final):**
```
<Provenance
  value={renderedNumberOrText}
  provenance={ {sourceActivity, sourceEntity, timestamp, tieBreak?} | null }
  calcVersion={string?}
  density={'inline' | 'ondemand'}      // default 'ondemand' — PRD §6 rule
  citedRow={address?}                  // populated only once D2 registers the metric
/>
```

**States.** Renders `value` plainly with the source/as-of/calc-version popover on hover/click when `provenance` is present; when `provenance` is `null` it renders `value` with an explicit "provenance unavailable" affordance (PRD §9.8) — the one state where `<Provenance>` shows a value with **no** receipt, by contract, never fabricated.

**Formatting.** Delegates the actual number/percent/date rendering to S10's shared formatter once it exists (TD-08's other half); until then, per §19 Step 1, it may format via the existing narrow helpers already in use at a call site rather than inventing a third formatter inside S8 — S8 must not become `fmt*` implementation #119.

### 4.3 `<FreshnessBadge>`

Consolidates the five scattered instances TD-08 names and this spec confirmed by reading each: `app/src/components/screener/CoverageLine.jsx` (freshness is implicit in its own receipt, not a standalone badge), `app/src/components/research-kit/CoverageNote.jsx` (a coverage-basis note, not time-based), `app/src/pages/journal-2-0/components/SyncFreshnessChip.jsx` ("Synced 12m ago · Sync now," broker-scoped, `timeAgo()`-based), `app/src/pages/charts/widgets/ChartMarketClock.jsx` (session-tone dot + live ET clock + next-boundary popup), and the untested-as-a-component stale-window pairing logic in `BreadthViews` (`pages/breadth/staleWindowLabel.test.jsx` exercises a behavior, not an importable module — confirmed no `.jsx`/`.js` source file of that name exists).

**Props:**
```
<FreshnessBadge
  freshnessClass={'real-time' | 'delayed-15' | 'end-of-day' | 'historical'}
  asOf={ISOString}
  sessionState={ {isOpen, isPremarket, isExtended} }  // sessionModel.js shape, §4.5
  fields={ [{label, freshnessClass, asOf}] }           // composite support, §9.5 — one row, per-field freshness
  disclosureRequired={boolean}
  disclosureText={string?}
/>
```

**Vocabulary.** `LIVE / delayed N min / as-of HH:MM ET / stale`, matching the panel contract's `freshness` field vocabulary already named in `information-architecture.md` §5's contract table. `stale` is computed against `sessionState`, not a flat timeout — reusing `sessionModel()`'s existing `tone`/`label` derivation as the seed (§4.5).

**Composite freshness (§9.5).** `fields[]` is new — nothing audited today renders two different freshness classes on one row (`SyncFreshnessChip` and `ChartMarketClock` are both single-value). This is the concrete gap PRD §9.5's "delayed price, live volume" shape requires and no existing component provides.

**Delayed-disclosure strings (§9.4).** Confirmed by grep: no string resembling `Data Delayed`, `Del-15`, or a Financial Status Indicator label exists anywhere in `app/` or `api/` today. `disclosureRequired`/`disclosureText` are therefore a **new build**, exactly as PRD §9.4/§10.3 states, not a toggle on an existing string.

### 4.4 `<CoverageLine>` — extend, don't replace

The existing `app/src/components/screener/CoverageLine.jsx` already implements most of what PRD §9.1/§9.2 requires, verbatim, and correctly:

- The closing-arithmetic refusal state (`closes = ... && answered + dropped + notComputable === evaluated`, lines 97–98) — renders `role="alert"` with the literal arithmetic when it does not close (lines 102–109). This already satisfies PRD acceptance criterion 3 for the screener; the extension is making the same guard available to every other application's evaluator (§3.7/§6 below).
- The "gap, not a quiet market" state (lines 111–117) — already the exact PRD §4 W4 example, verbatim: "No symbol could be answered... that is a gap in what we hold, not a quiet market."
- `withheld` rendered beside, never inside, the four (lines 140–146) — already correct.
- A causes tally beyond what the PRD's four-count spec strictly requires (lines 70–91) — a real enhancement already shipped, not a regression to design around.
- The component's own header (lines 37–42) already states the anti-pattern this spec's §3.6 (WireView/TaxCenterSection) violates: *"THE CAUSE IS `detail \|\| reason`, IN THE RECEIPT'S OWN WORDS... a second vocabulary for one fact is how the two spellings start disagreeing."* The fix for both drifted instances is exactly what the file already argues for — normalize their field names (`reported`/`eligible`/`notComputable` in TaxCenterSection; whatever `WireView`'s local version reads) at the call site into the canonical `evaluated/answered/dropped/not_computable/withheld` shape, never teach `<CoverageLine>` a second vocabulary.

**Extension needed (not a rewrite):**
1. Relocate per §4.1.
2. Accept a `density` prop threading through to the L1-fixed-page-vs-dense-grid distinction (PRD §6) — today the component has one fixed rendering; every current consumer already renders it the same way (below a result set), so this is additive, not a behavior change for existing call sites.
3. No change to the closing-arithmetic or withheld logic — it is already correct against PRD §9.1/§9.2's acceptance criteria and must not regress.

### 4.5 `<Cited row=…>`

No existing precedent — confirmed. `information-architecture.md` §3.2 names the target address form (`uct://breadth/pct_above_50sma@<as-of>`) and `DAY_1_EXECUTIVE_SYNTHESIS.md` §12.3 names the wire shape (`search_result` blocks with `kb://`- or `uct://`-style sources) — neither exists in code today; D2, which would emit them, is not yet built (PRD §12.1, capability-infrastructure-matrix.md D2 row: "Absent... explicitly on the critical path").

**Narrow interim form**, buildable now against `bar_provenance.py`'s actual return shape:
```
<Cited
  row={ {ticker, tf, bar_time, source, validated_at, verified_at} | {uctUri: string} }
/>
```
When given the first shape (today's only real data source), the click-through popover shows source/as-of/verified-status one level deep — no recursive inputs graph, because `bar_provenance.py` records none. When D2 registers a metric and emits a `uctUri`, the same component can walk the inputs graph recursively (PRD §6's "click a number, see the row" gesture, full form) — this is a **prop-shape superset**, not a breaking change, so `<Cited>` can ship against bars today and gain depth incrementally as D2 registers each metric class (PRD §12.1's own sequencing argument, restated here at the component level).

The click target reuses `app/src/components/mobile/Sheet.jsx` / `ContextPopover.jsx` for the popover chrome — the estate's one modal/overlay primitive with a real focus trap (TD-09) — rather than a sixth bespoke `role="dialog"` div.

---

## 5. Data contracts

### 5.1 The provenance record — target shape vs. today's actual shape

| Field (PRD §7.1 / data-architecture.md §11.3 target) | `bar_provenance.py`'s actual column (read in full) | Gap |
|---|---|---|
| source-activity reference (which adapter/job/run) | `source` — a flat string, no job/run id | D2's generalization splits this; S8's adapter treats the flat string as the activity label until then |
| source-entity reference (which vendor payload) | *absent* | Not tracked today at the bar level |
| timestamp (fetched/computed, distinct from the value's own as-of) | `validated_at` (write time) + `verified_at` (reconciliation confirmation, nullable) | Two timestamps exist; neither is quite "the value's own as-of" — bar_time is the as-of, validated_at is the fetch time. `<Provenance>`'s popover must render this three-timestamp reality (bar_time / validated_at / verified_at) rather than collapsing it |
| tie-break record (which vendor won and why) | *absent* | Not tracked at the bar level; FMP's `_earn_row_preferred` (cited in PRD §7.1 and data-architecture.md §11.3) is the closest real analog in the codebase and was not itself read for this spec (out of scope — a different data class) |

**Implication for §4.2/§4.5.** `<Provenance>`/`<Cited>` must accept this narrower real shape as a first-class input, not merely "the degraded state until D2 ships" — bars are a real, high-volume TERMINAL-NEXT data class (A2 Charts) that will use exactly this shape for a long time. The component's props (§4.2, §4.5) are written to accept `sourceEntity` and `tieBreak` as optional, precisely so a bar-shaped provenance record (which has neither) renders correctly today without waiting on D2.

### 5.2 Freshness class

Enum, per data-architecture.md §12.1 (R-A4-2): `real-time | delayed-15 | end-of-day | historical`. No enforcement mechanism exists in code today (confirmed: no freshness-class field appears in `bar_provenance.py`'s schema) — this is D4's field to attach at serve time (product-architecture.md D4 block: "the freshness stamp S8 renders"), not S8's to originate.

### 5.3 Coverage receipt — the reference wire shape

`scan_evaluator.py`'s `run_sweep` already returns (confirmed by reading the docstring at ~lines 1284–1295):

```
{def_hash, rev, tf, as_of, freshness,
 hits, hit_rows: [{symbol, value, bar_time, ...live_cols?}],
 cadence, tick,
 evaluated, answered, dropped, not_computable,
 withheld, withheld_reason,
 dropped_symbols: [{ticker, reason, detail?}], dropped_listed, truncated,
 recorded, record_refused,
 mode, persisted}
```

This is the **reference shape** every other application evaluator's coverage payload should converge toward when it builds its own `<CoverageLine>` receipt (a fundamentals sweep, a calendar week, an options-chain-across-a-universe query — PRD §7.4). `<CoverageLine>`'s own props already consume the subset it needs (`evaluated, answered, dropped, not_computable, withheld, withheld_reason, dropped_symbols`); an application evaluator need not replicate the whole shape, only the subset, in the same field names — never a renamed synonym (§4.4's normalize-at-the-call-site rule).

### 5.4 Honest-state taxonomy → concrete props

| # | State (PRD §6/§9) | `honestStates.js` resolves to | Existing precedent |
|---|---|---|---|
| 1 | Present, fresh | `{kind: 'fresh', provenance, freshnessClass}` | default `<Provenance>` state |
| 2 | Present, stale | `{kind: 'stale', ...}` | `<FreshnessBadge>`'s `stale` label, session-aware per §4.3 |
| 3 | Empty, genuinely nothing | `{kind: 'empty'}` | **no existing distinct render path** — TD-18's six named files collapse this into a blank render or a swallowed catch |
| 4 | Empty, not entitled | `{kind: 'withheld', reason}` | `entitlements.ToolkitWithheld` + `WITHHELD_REASONS`, already correctly distinct server-side (§3.11); `<CoverageLine>`'s `withheld` field already renders this at the *receipt* level; §14 below notes the gap at the *single-value* level |
| 5 | Empty, feed down | `{kind: 'down', status}` | `jsonFetcher.js`'s thrown `err.status` (5xx/network) is the signal; no consumer today renders it as a distinct state (TD-18) |
| 6 | Scheduled, TBD | `{kind: 'tbd'}` | reused verbatim from A5's existing calendar convention (product-architecture.md §4.2) — S8 recognizes it, never restyles it |
| 7 | Computed, honest negative | `{kind: 'negative-result', asOf}` | **no precedent found** — the catalyst engine's "why is it moving" honest-negative is a named future capability (A8/I1), not yet built against any citation component |

---

## 6. API boundary

S8 makes zero network calls of its own — confirmed against the design (no fetch/`useSWR` call appears in any proposed component's contract) and against PRD §11.1/§11.4 and the boundary matrix (product-architecture.md §8: S8 may call only S10, S11, D2, D4; never D1, D3, any Application). **No new API route is required for S8 itself.**

What each **consuming application** needs before it can hand S8 a receipt: its own coverage-closing guard (§3.7), shaped like `scan_evaluator._assert_coverage_closes`. Today only A9 (screening) has one. A3 (fundamentals sweep), A5 (calendar week), A10 (options-chain-across-a-universe) do not yet and must add their own before shipping a `<CoverageLine>` — this is each application's build item, not S8's.

---

## 7. Provider adapters

None. Restated verbatim from capability-infrastructure-matrix.md's S8 row (read in full, §2 above): *"No provider gap. Pure consolidation, explicitly flagged as 'cheap to decide now.'"* Confirmed independently: no vendor name, API key, or HTTP call appears anywhere in this spec's component contracts.

---

## 8. Entity/security identifiers

S8 does not resolve identifiers. `<Cited row=…>`'s eventual `uctUri` address is D2/S3's to mint (keyed on S3's permanent entity id, per product-architecture.md S3 block), not S8's. Until S3 exists, the narrow bar-shaped citation (§4.5) keys on `(ticker, tf, bar_time)` exactly as `bar_provenance.py` does today — ticker as a live symbol string, not a permanent alias. This is a known, accepted narrowness: a renamed/reused ticker (Model Book's SQ/WTW watermark-override problem, cited in product-architecture.md's D3 block as the concrete symptom already in the estate) can misattribute an old citation once a symbol is reused — S8's render contract does not change when S3 closes this gap; only the address's underlying key does (PRD §12.1's sequencing property, restated one layer down).

---

## 9. State management

S8 is stateless and props-driven; it owns no store, no context provider, no Redux slice. The one exception: `<FreshnessBadge>`'s "how long ago" ticking display, which is local component state exactly like `ChartMarketClock.jsx`'s existing pattern —
```
useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id) }, [])
```
(quoted from `ChartMarketClock.jsx` lines 58–61) — reuse this idiom verbatim rather than inventing a second ticking-clock pattern.

---

## 10. Persistence

None. S8 writes nothing, ever (contrast with D2, which persists the provenance record S8 only reads via props). No new SQLite table, no new preference key.

---

## 11. Caching

None owned by S8 (PRD §11.1/§11.4). Freshness data rides whatever cadence D3/D4 already serve the underlying value at (`serve_stale.py`'s bounded-staleness / single-flight design, confirmed by reading its module docstring — already the correct shape for D4 to extend into, per its own "extend" build condition). `<FreshnessBadge>` re-renders when its parent re-renders; its own `setInterval` (§9) recomputes a display string from already-passed props, never triggers a fetch.

---

## 12. Realtime/polling behavior

None owned by S8. Session-aware staleness (PRD §9.6) resolves today via `sessionModel.js` + `useMarketOpen()` — the same mechanism `ChartMarketClock.jsx` and `MarketClock.jsx` already share, confirmed by reading both files' imports, which is precisely why the two never disagree today. This is a **real, working precedent**, not a gap, though it is narrower than S11's eventual full build: `sessionModel.js` (read in full, 22 lines) computes only `isOpen`/`isPremarket`/`isExtended` booleans — no half-day table, no per-pack as-of, no versioned holiday calendar (S11's full scope per product-architecture.md S11 block). `<FreshnessBadge>` accepts `sessionState` in exactly the shape `sessionModel()` already returns (`{label, tone}`), so the upgrade to S11's fuller model in §19 Step 3 is additive, not a breaking prop change.

---

## 13. Background jobs

None. Confirmed against the boundary matrix (product-architecture.md §8): S8 may never call D1, D3, or any Application, and has no scheduler entry, no cron trigger, no daemon thread of its own — a structural consequence of being a leaf renderer by contract (PRD §3, "S8 is a leaf in the dependency graph by design").

---

## 14. AI / orchestration boundary

I1 routes every answer through S8 (PRD §8; product-architecture.md I1 block, post-Phase-2-correction). Concretely, against real code:

- **`grade_ticker` today has no citation renderer.** `api/services/grade_ticker.py`'s typed return already includes a `sources` field (per CLAUDE.md's description of the K4 capability) — the data exists — but nothing wraps its cited numbers (`entry`, `stop`, `size_pct`, `grade`) in a citation component today. This is the concrete gap I1's future `<VerdictCard>`/`<Answer provenance=…>` build closes by *importing* S8's primitives, exactly as PRD §8 specifies; S8 itself does nothing new here beyond existing.
- **The grounding-gate shape stays in its own runtime.** COT's `cotFacts.js`/`cot_narrative.py` (confirmed by reading `cot_narrative.py`'s module-level prompt constant: *"Use only the facts you are given; if a number is not in the facts, do not say it"*) is the proven pattern — product-architecture.md §11's "kept" list ("do NOT replace Chart.js here — one implementation, two runtimes") extends by the same logic to not porting COT's analytics into a new S8-owned gate. Every future I1 narrative lane copies the *shape*; S8 is only where the resulting citation renders once that lane's own gate has passed.
- **AI Search's `groundingChips()` is the concrete migration target, not S8's own file.** `AiSearchWidget.jsx`'s `GROUNDING_LABELS` (read in full: 12 hand-typed source-key→label pairs — `quote: 'Live quote', regime: 'Regime', catalyst: 'Catalyst', ...`) is exactly the kind of hand-typed enumeration `CLAUDE.md`'s own history repeatedly names as this codebase's most common defect shape (the writer-index count, the COT router's route count, the setup-catalog count — all cited in TD-39/TD-20). Once `<Cited row=…>` exists, this map is replaced by whatever label the provenance record's `sourceActivity` field carries — tracked against A8/I1's build, not S8's own acceptance criteria.
- **Prompt eligibility is a separate gate S8 does not own.** Data-architecture.md §23.1's rule (a value's provenance record gates both display eligibility *and* prompt eligibility from the same field) means I1's prompt assembler consults the same provenance record S8 renders from, independently — S8 exposes no eligibility check of its own (PRD §10.1: S8 never makes an entitlement/eligibility decision).

---

## 15. Observability

- **`role="alert"`/`role="status"` + `data-testid` is the idiom to keep**, not reinvent. `CoverageLine.jsx` (lines 103, 112, 119, 133, 140, 149) already does this correctly; every new S8 component follows the same pattern so a broken receipt is both screen-reader-announced and machine-queryable by test id.
- **AST rails are the estate's proven enforcement mechanism** for exactly the acceptance criteria PRD §14 lists, and this spec ties each to a real precedent file confirmed to exist:
  - "No bare number renders" (PRD criterion 1) — model on the `test_yf_guard_census.py`-shaped AST census (cited as the D1 build-condition precedent in product-architecture.md).
  - Boundary-matrix compliance (criterion 10) — model on the screener's `reachable.test.js`, which walks the real import graph from `App.jsx` with an AST, "never a grep" (confirmed cited pattern, capability-ledger G-section context).
  - "I1 owns no competing renderer" (criterion 11) — model on `tests/test_no_shadowed_definitions.py`'s whole-repo AST sweep for a top-level name bound twice (the exact mechanism `CLAUDE.md`'s "FOR RAVI" section names as having caught the `_parse_mdy` double-definition in `live_massive_router.py` — confirmed live in `CLAUDE.md`, cited as evidence a working precedent of this shape already exists in the repo, not merely proposed).
  - Coverage-closes rail (§3.7) — port `_assert_coverage_closes`'s assertion into a shared JS helper alongside the existing Python one, each covered by a mutation-style test proving the guard actually fires (not merely exists), per the estate's own standing discipline against a guard nobody has seen fire.
- **A mount-level rail**, mirroring `Screener.scanmount.test.jsx`'s "mock nothing on the path under test" pattern, for at least one S8-consuming surface — so a severed wire between an evaluator's coverage payload and `<CoverageLine>` goes red the same way a severed screener wire already does today, rather than passing on a component test that never exercised the real wire.

---

## 16. Error handling

The 7-state taxonomy (§5.4) is the error-handling contract. Concretely:

- States 1–2 (fresh/stale): straightforward render paths, already correctly shaped by `CoverageLine.jsx`'s and `ChartMarketClock.jsx`'s existing code.
- State 3 (empty, genuinely nothing) and state 5 (down/degraded): **new, distinct render paths that do not exist today.** TD-18's six named files — confirmed by reading one directly, `AiSearchInsightsPanel.jsx` line 14: `.catch(() => null)` — collapse both into the same silent `null`/`undefined`, which any consuming component then renders as either a blank panel or nothing at all. S8's `honestStates.js` resolver is the fix's shape: it must receive enough signal from the platform's one data-access hook (`jsonFetcher.js`'s thrown `err.status`, plus the application's own "did I find zero rows for a real reason" determination) to produce `{kind: 'empty'}` and `{kind: 'down'}` as genuinely different objects, never the same `null`.
- State 4 (withheld): server-side mechanism already correct and live (`entitlements.py`, §3.11). The **new** part is per-value withheld rendering — today `withheld` exists only at the receipt (result-set) level inside `<CoverageLine>`'s existing fields; PRD §6 state 4 also requires it at the level of a single rendered value (e.g., one restricted field on an otherwise-visible panel), which has no precedent in the audited code and is `<Provenance>`'s job to add.
- State 6 (TBD): reused verbatim, not reimplemented — S8 must recognize the calendar's existing "TBD is a data value, not an error" convention (A5's coexistence rule) as one of its own seven states rather than styling it as an error.
- State 7 (honest negative): genuinely new; no precedent exists (confirmed: the catalyst engine's synthesis code enforces "no clear catalyst" as a valid JSON output per CLAUDE.md's Stock Catalysts section, but nothing renders that output through any citation component today — the citation renderer for the honest negative is entirely S8's to build once A8/I1 produce one).

---

## 17. Permission / entitlement handling

S8 renders `withheld`; it never decides it (PRD §10.1). The server-side source of truth, confirmed live: `api/services/entitlements.py`'s `toolkit_for`/`limits_for`/`ToolkitWithheld` mechanism (capability-ledger row G12, "active (mechanism) · exists-limited") — with the caveat, confirmed by reading the code, that it "reads a `user['toolkit']` key the schema lacks ⇒ always `'all'`" today. This means S8's `withheld` render path is fully buildable and testable **today**, against a mechanism that always resolves to the unrestricted toolkit — exactly the reversibility property PRD §10.4 argues for (S8's contract is unchanged whichever way D5/OI-03 resolves), now grounded in the specific code path that makes it true.

---

## 18. Testing strategy

1. **Unit tests**, extending `CoverageLine.test.jsx`'s existing convention (derive fixture counts from the closing identity, never restate all four as independent literals) for the relocated `<CoverageLine>` and each new component (`<Provenance>`'s degraded state; `<FreshnessBadge>`'s composite/per-field freshness and session-aware `stale` threshold at both an RTH and an overnight/weekend fixture, per PRD acceptance criterion 6; `<Cited>`'s narrow bar-shaped click-through).
2. **AST/static rails**, per §15, one per PRD §14 acceptance criterion, each modeled on a real precedent file confirmed to exist in this codebase (not a hypothetical pattern).
3. **A wire-severed mount rail**, per §15, modeled on `Screener.scanmount.test.jsx`.
4. **A mutation-checked guard test** for the ported coverage-closing assertion (§3.7/§15), following the estate's own standing discipline (a guard that has never been observed to fire under mutation is not a guard).
5. **Manual verification**, not automated: PRD acceptance criterion 4 (the three "no data" states are *visually and textually* distinguishable) has an automatable half (three different rendered outputs exist, covered by the mount rail) and a human-judgment half (they read as distinguishable to a member) that no rail replaces.

---

## 19. Migration implications — build sequencing

Extends PRD §12's dependency graph with concrete steps, each gated only on what it actually needs:

- **Step 1 — buildable now, no platform dependency.** Relocate `CoverageLine.jsx` with the re-export shim (§4.1); build `<FreshnessBadge>` on `sessionModel.js` (§4.3/§12); build `<Provenance>`'s degraded state (§4.2) — it needs zero provenance records to render correctly, since "provenance unavailable" is a valid state by design.
- **Step 2 — needs S10's shared formatter.** Swap `<Provenance>`/`<CoverageLine>`'s number formatting onto S10's `format` module once it exists (TD-08's other half), rather than S8 inventing a third formatter meanwhile.
- **Step 3 — needs S11's fuller build.** Upgrade `<FreshnessBadge>`'s staleness threshold from `sessionModel.js`'s boolean seed to S11's full session/holiday model. Additive: the prop shape (`sessionState`) does not change, only what supplies it.
- **Step 4 — needs D2.** Light up `<Cited row=…>`'s full recursive click-through-to-inputs and the `uct://` address form (§4.5). Until then it renders the narrower `bar_provenance.py`-shaped citation only — a real, shippable, non-degraded state for bars specifically, not a placeholder.
- **Step 5 — consumer migrations, not part of S8's own acceptance criteria.** I1's `<VerdictCard>`/`<Answer>` (§14), AI Search's `groundingChips()` (§14), `WireView.jsx`'s local `CoverageLine` and `TaxCenterSection.jsx`'s inline receipt (§3.13, §4.4) each migrate onto S8's primitives as their own owners' follow-on tickets.

**Legacy-file disposition.** `components/screener/CoverageLine.jsx` keeps working unmodified through the shim period — this is the same "consolidate incrementally, never a big-bang cutover" reversibility property PRD §12.1 argues for D2, applied one layer down at the component level.

---

## 20. Performance considerations

Restates PRD §11 against the concrete component contracts above:

- **Zero new network round-trips** — confirmed: no fetch/`useSWR` call appears in any of §4's four component contracts. `<Provenance>`'s degraded state renders a value with no provenance record rather than fetching one to fill the gap (PRD §9.8/§11.1).
- **`<CoverageLine>` is already O(1)** relative to evaluated-count, confirmed by reading the file: its only loop is over `dropped_symbols`, a list the evaluator's own contract already bounds ("`_DPC_WARM_MAX_QUEUE`'s shape: a bounded list beside a true count," quoted from `scan_evaluator.py`'s own header comment) — never the full evaluated set. The relocation/extension in §4.4 must not regress this.
- **Density changes never trigger a re-fetch** (PRD §11.3) — verified by the same AST/mount-rail pattern as §15's wire-severed check, adapted to assert no network call fires on a pure density-prop change.
- **`<FreshnessBadge>`'s one owned timer** (§9) is capped at 1 Hz, matching `ChartMarketClock.jsx`'s existing precedent, and drives only its own re-render, never a data refetch.

---

## GAPS

- **Not read in full**: `data-architecture.md` §1–10, §15–22, §26–29 (read directly: §11–14, §23–25, plus headers); `information-architecture.md` §0–1, §6, §8–11, §13–22 (read directly: §2 partial, §3.1–3.3, §4.2–4.5, §5, §7.4, §12). Both were read for the sections this contract named and the sections their own cross-references pointed to; a future revision touching S8's boundary against S1/S2/S6/S9/S12 in more depth should re-read the corresponding sections directly rather than trusting this spec's secondhand citations of them.
- **`READINESS_REVIEW_DAY1.md` and `DAY_1_EXECUTIVE_SYNTHESIS.md`**: read by targeted section (§4, §7 D6 in the former; §1.12, §1.13, §1.14, §4.3, §12.3 in the latter — every section either file cited by number), not cover-to-cover; both are ~500+ line synthesis documents whose other sections concern systems outside S8's boundary.
- **FMP's `_earn_row_preferred`** (cited by the PRD and by data-architecture.md §11.3 as the concrete tie-break example) was not itself read for this spec — a different data class (earnings) outside S8's own files; cited secondhand from the PRD.
- **No frontend test run, no component built** — this is a specification; nothing in §4–§20 was executed against a real build or test runner. The file paths, line numbers, and quoted code are accurate as read on 2026-09-02 and may drift if the codebase changes before Phase 4 begins.
- **`WireView.jsx`'s local `CoverageLine` and `TaxCenterSection.jsx`'s inline receipt** (§3.13) were read only at the specific lines implicated (function definition, call sites); their surrounding files were not read in full, so a fuller audit of exactly how many other places independently reinvent this idiom was not attempted — the two found are offered as confirmed evidence of ongoing drift, not an exhaustive count.

---

## SOURCES

See frontmatter `sources` field for the complete list of program artifacts cited by section. Every application-source-code citation in this document names an exact file path, and where a line range or exact string is quoted, that quote was read directly from the file on 2026-09-02 as part of producing this document (§2).
