# Target declarations + pre-execution validation (Charts mutations)

Status: DESIGN, for AUDIT review. No code. Branch `agent/pl/target-declaration-design` from master `d0bdb6d693`.
Scope approved in principle by the owner: narrow, layered onto the existing `execute` path, no orchestration rewrite.

## 1. Problem

Every Charts safety rail today **infers** what the member meant to change from their wording, after planning, and refuses
when the plan's effects look wrong:

| Rail | Where | Reads intent from |
|---|---|---|
| chart rail (#1210) | `app/src/agent/chartRail.js` — KEPT/ADDITIVE/MULTI/REMOVAL/COUNT, `chartRailRefusal` L207 | regexes `KEEP_LEAD` L109, `ADDITIVE` L137, `ADD_VERB` L140, `REPLACE` L164, `REMOVAL` L165 |
| target-ticker checks (#1213) | `deixis.js` `offBoardTicker` L687, `tickerAntecedent` L721, `targetTickerConflict` L840 | ticker tokens, clause splits `ANA_SPLIT`/`KEEP_CLAUSE` L740-742 |
| continuity (#1251) | `useAgent.js` `asCreatedSetWords` L238 (`NEW_MANY` L236), `createdRef` L772/L1757, `turnWords` L802 | determiner + "new" phrases |
| state rail (#1247, pending) | `stateRail.js` on `origin/agent/pl/additive-never-destroys`, `permits` L367, `stateRailRefusal` L462 | `DESTROY_SRC`/`MODIFY_SRC` L237-238, `VERBS` L318, `POINTS` L323 |
| new-charts rail (#1261, pending) | `newChartsRail.js` on `origin/agent/pl/newcharts-rail`, `NEW_REF` L47, `newChartsRefusal` L102 | structural phrase shapes A–D |

The **effect** half of each rail is sound: it reads the planner's own before/after per target kind (`chartRail.EFFECTS`
L37-78, `stateRail.READERS` L90, `newChartsRail.writtenCharts` L70). The **intent** half is a growing vocabulary, and
AUDIT's held-out probes keep finding shapes it does not recognise:

- **Probe 33 e1/e2** (chartRail L157, L176): lowercase tickers ("add aapl and msft") slipped `ADD_VERB`; fixed by
  `knownIn` and the structural MULTI rule. "put these up there" is still refused only because MULTI is structural (L180).
- **Probe 34** (deixis L750): "bump AMD up to weekly", "AMD: weekly", "take amd to weekly" — each was a new phrasing until the
  ruling made a ticker in change words structural.
- **Probe 38** (#1247 commit `57d2605c5c`): the state rail had to be *inverted* ("every destroy needs a COMMAND on a NAMED
  object") because an allow-list of additive words was bypassed by unlisted verbs.
- **#1261** commit `d97dd8bd97`: the created-set reader was rewritten to "structural" shapes for "generated phrasings and
  look-alikes"; `NEW_MANY` (useAgent L236) alone missed "those 2 fresh AAPL and MSFT panes".
- **Owner production 11-14** (fix in progress on `agent/pl/fix-grid-keep-no-duplicate`): "Add AAPL and MSFT to my charts, but
  keep SPY and NVDA" → choice "All four in a grid" produced **6 panels: SPY, NVDA, SPY, NVDA, AAPL, MSFT**. Every rail
  passed: KEPT saw no effect on SPY/NVDA (nothing re-symbolled or removed), ADDITIVE saw only creates, COUNT
  (chartRail L240-244) only checks *fewer* than the asked shape. No rail compares the **final board** the member described
  (4 charts: the two kept + two new) with the **final board** the plan builds. This is the motivating case for §4.3.

Root cause: each rail asks "do these words forbid this effect?" with its own reader. Nothing records, once per turn, **which
existing objects the member asked to change, and how**, so each rail re-derives it, and a phrase none recognises passes.

## 2. Scope

**In scope (Charts mutations, by target kind — never by action name):**
`chart` (symbol), `board` (remove / grid reuse), `multiChart` (layout shrink / group refill), `layouts` (switch) — the four
`chartRail.RAIL_KINDS` (L79); plus, once #1247 lands, the stateRail kinds (indicator, drawing, drawingBoard, watchlist,
widget, layout, layoutBar, template) as a later phase. Query capabilities are out.

**Paths** (all already call `railOf`, useAgent L804):
instant/fast (`execute(..., {path:'fast'})`, e.g. L2560), model (L3284, `mode:'propose'`), fan-out (`fanOutOf` L510; rail per
chart L1213), deferred (`landDeferred` L565; pre-check L1038), mixed split (L1275), approved card (`approve` L1966,
`mode:'approved'`), widget card (L3424-3432).

**Non-goals:** no orchestration/planner rewrite; no change to `planOps`, `approvalBinding`/`bindingDrift`
(executor.js L313/L328), `decideMode` (policy.js L35) or routing; no prompt redesign (a model-side field is optional, Phase 5,
and gated on a byte measurement); **no rail is removed or loosened** — the validator is one more gate in the same hook; Undo
is not re-validated.

## 3. The declaration

```
Declaration = {
  turn, source: 'resolver' | 'card',          // never 'model' alone (see 3.3)
  entries: [{ kind, ref | alias, effect }],   // effect ∈ create | overwrite | replace | remove | switch
  final?: { charts: [{ ref | 'new', symbol }], exact: boolean },   // the board the words describe, when they describe one
  open: [kind…]                               // kinds the resolver could not decide → validator defers to existing rails
}
```
`symbol` change on a chart is `overwrite`; `board` remove is `remove`; grid reuse with a new ticker is `replace`; a layout open is
`switch` on every on-screen chart; `virtual` plans (`p.virtual`) are `create` of an alias.

### 3.1 Deterministic resolver (the only authority)
Pure function `declareTargets({ words, host, memory, created, picked, pending })`, run once per turn **before** planning on
the instant path and before `execute` on the model path, from inputs that already exist:

- **words**: `railWordsRef.current` (message + carried question, L2247) — the same words every rail reads.
- **click**: `selectedChart(host)` (deixis L1219); **picked choices**: `pickedChoice` (L1022) / answered refs.
- **memory subject**: memory.js subjects (L16, L46) — `stateRail.subjectIdsOf` on #1247.
- **created set**: `createdRef.current.refs` (L772) — the set #1251/#1261 already maintain.
- **existing readers, composed not duplicated**: `keptCharts` (chartRail L115) → `keep` entries (effect: none allowed);
  `chartsNamedBy`/`chartsNamedBySymbol`/`ordinalChart`/`relativeChart`/`resolveDeictic` (deixis L1085/L1110/L1039/L464/L892)
  → named refs; `requestedPanels`, `CHART_COUNT`, `addsCharts` (chartRail L192/L181/L144) → `final.charts`;
  `refersToNewCharts` (#1261) → created refs; `stateRail.permits` (#1247) → per-object effect class.

The resolver adds **no new vocabulary**. Its gain is structural: one object of record per turn, and a *final-board* reading,
which no rail has. Anything it cannot decide goes to `open` (fail-safe = today's behaviour, never looser).

### 3.2 Card-sourced declarations
A proposal stores the declaration it was shown with (`pendingRef.current`, L1238/L1340/L1370, beside `binding` and `words`).
On approval the stored declaration is used, **not** re-resolved from "do it". The card renders the declared targets
("Changes: the SPY chart → AAPL; Keeps: NVDA"), so the approval is an approval of exactly those targets.

### 3.3 Model-supplied (optional, Phase 5)
A model plan *may* carry `targets` (ids it intends to change + effect). It is **never trusted**: used only (a) as a
self-consistency check — the model's own effects ⊄ its own `targets` → refuse; (b) to fill `open` kinds **only** where every
model target is also a resolver candidate (on the board, not kept, not outside a named set). The authorising set is always
`resolver ∩ model`, never `model` alone. Placeholders/aliases (`args.as`, `aliasNames` L553) are allowed only as `create`.

## 4. The validator

`validateDeclaration(plan, decl, { host, mode })` — pure, beside `railOf`, after `protectionRefusal`, before any write.

### 4.1 Effects ⊆ declaration, per kind
Effects come only from the existing readers: `chartEffects` (chartRail L82), `panelsAfter` (L93), and on #1247/#1261
`stateEffects` / `writtenCharts`. For each effect `e`: there must be an entry with the same `kind`-class and `ref` (or alias)
whose effect ⊒ `e.effect` in the lattice `create < overwrite < replace < remove`, `switch` separate. Linked followers
(`e.linked`, L45) inherit their leader's entry. Kinds in `decl.open` skip the check (existing rails still run).

### 4.2 Fail-closed rules
- A reader that throws, or an effect of type `unreadable` → mismatch (as stateRail's `catch`, and `TARGET_CHECK_FAILED`, deixis L885).
- An entry `keep` hit by any effect → refuse (same as KEPT; reported once, KEPT wording kept for continuity).
- Resolver throws → in enforce: ask (`TARGET_CHECK_FAILED`), nothing written; in shadow: log `resolver-error`.
- Mismatch → the whole plan is refused (refuse-if-applied, ask-if-ambiguous), like every rail: nothing written, no card.

### 4.3 Final-board check (motivated by the 11-14 6-panel case)
When `decl.final` exists, compare the multiset of `{ref|new, symbol}` the plan leaves on the board with it. For
"Add AAPL and MSFT … keep SPY and NVDA" → "All four in a grid": declared `[SPY@a, NVDA@b, AAPL@new, MSFT@new]`, exact;
planned `[SPY@a, NVDA@b, SPY@new, NVDA@new, AAPL@new, MSFT@new]` → two undeclared creates of an already-kept symbol → refuse.
`exact: false` (e.g. "add AAPL" with no count) checks only "no undeclared duplicate of a declared-kept symbol" and
"≥ declared count" (COUNT generalised). This complements, never replaces, the branch fix.

### 4.4 Approved-card semantics
`mode:'approved'` validates the plan against the **card's stored declaration**. `bindingDrift` already guarantees same
targets/state; the declaration adds that the *shown* targets are the authorised ones. Existing card permissions are kept
(chartRail allows a carded removal, L235; stateRail returns null on approved, #1247 L462+) — the validator does not tighten
an approved card beyond what the card showed.

### 4.5 Fan-out, deferred, split
- **Fan-out**: one declaration per turn; each per-chart plan (L1209) validated against it; additionally the union of the fan's
  targets must equal the declared set (no extra chart).
- **Deferred / created mid-plan**: alias entries (`create`) are rewritten with `landDeferred`'s own `real()` mapping (L566)
  when the step lands, then the step is validated; the pre-check (L1038) validates alias targets as `create` only.
- **Mixed split** (L1270-1280): each part validated against the same declaration; the grouped Undo is unchanged.

### 4.6 Undo
Undo is not validated (it restores recorded state; `undoProtectionRefusal`, protectedLayouts.js L105, still applies). The
declaration is attached to the receipt for telemetry only. A refused plan writes nothing, so it creates no Undo entry.

## 5. Rollout (feature-flagged)

Flag `agent.targetDecl`: `off` (default) → `shadow` → `enforce:<kind,…>`.

1. **Shadow**: resolver + validator run on every path; result only `mark('target-decl', 'match'|'mismatch'|'open')` and a
   telemetry field with kinds/effect counts (no member text, no market values). Behaviour byte-identical: assert the
   capreg `corpus.finalState.{0..3}` snapshots and `corpus.deterministic` are unchanged with shadow on.
2. **Measure** on the capreg corpus (`qa/capabilityRegression/baseline/corpus.json`: 204 intents, 44 refusals), the AUDIT
   held-out probes (33, 34, 38, #1261 generated set), and owner production cases (11-13 SPY→AAPL, 11-14 6-panel).
   Gates per kind: 0 new refusals on corpus intents that pass today; every known rail escape caught; `open` rate reported.
3. **Enforce per kind**, one PR each with AUDIT GO: final-board (§4.3) → `layouts` switch → `board` remove → `chart` symbol →
   `multiChart`; stateRail kinds only after #1247 merges.

## 6. Compatibility risks

1. **Implicit targeting in tests/corpora**: many tests rely on the click or "the only chart" (e.g. `agentChartRail.test.jsx`,
   `agentGridReuse.test.jsx`, `agentAddNeverReplaces.test.jsx`, `agentClarifyContinuity.test.jsx`). A resolver that does not
   reproduce `screenUnnamedTargets` (deixis L1141) and the one-chart default would refuse them. Mitigation: those defaults
   become resolver inputs; shadow must show 0 corpus mismatches before any enforce.
2. **Targets created mid-plan**: aliases resolved only at `landDeferred`; P2/B-07 cases (deferred step on a chart an earlier step
   grows, L1028-1031) must stay "check at its own turn". Risk: validating too early refuses valid multi-step requests.
3. **Fan-out**: per-chart plans see one target each; a per-plan subset check is too weak without the union check (§4.5).
4. **Layout switches**: `layouts` emits `switch` on *every* chart (chartRail L74-77); the resolver must declare all of them
   for "open my Swing layout" or every switch is refused. The chart rail's "kept" still refuses a switch away from a kept chart.
5. **Model plans with placeholders**: aliases and `pendingLists` must map to `create`, never be matched to existing refs.
6. **Approved cards created before the flag**: a pending card without a stored declaration → validator treats it as `open`
   (pre-flag behaviour), never as mismatch. TTL (`PROPOSAL_TTL_MS`) bounds this.
7. **Bytes/manifest**: Phases 1-4 add **0** manifest bytes (client-only). Phase 5 (`targets` on model plans) adds schema
   bytes to every round; must be measured against the flagship pin `bytes_per_round[0] < 29_950`
   (`tests/test_uct_agent_v2_cost_measure.py` L76) and #1224's measured bound, moved only in its own commit with its number.
   (I could not find #1224 on this base; AUDIT to confirm the current bound.)
8. **Latency**: pure, synchronous, reuses readers already run; `chartEffects` is today called up to 3× per plan
   (chartRail L210, L99, L101) — the validator should share one computation. Target < 2 ms; record in LATENCY.md, not prioritised (D5).
9. **Existing rails**: none becomes redundant and none is removed. Overlap: KEPT ≈ `keep` entries; COUNT ⊂ final-board;
   MULTI/ADDITIVE ≈ "undeclared overwrite"; new-charts rail ≈ created-set entries. Refusal precedence: existing rails first
   (their wording is tested), validator second, so no test's wording changes.
10. **First-call ratchet** (`qa/firstCallRatchet.test.js`, baseline json): Phases 1-4 touch no routing → baseline unchanged
    (assert). Phase 5 changes the model contract → ratchet must be re-run, no group may lose an action.
11. **Action cap**: the declaration is not an action and adds no capability. Master has `MAX_CAPABILITIES_V2 = 200`
    (`api/services/uct_agent/turn_v2.py` L38), v1 `MAX_CAPABILITIES = 60` (turn.py L122); #1191 (200→300) is not on this base —
    neither is affected.
12. **Pending branches**: #1247 and #1261 change `railOf` (on #1261: `useAgent` L805). The validator call must be added after
    both merge, in one place, to avoid a three-way conflict in the same hook.
13. **iOS 16 floor**: no regex lookbehind (#1247 commit `e2d3cabbda`); the resolver reuses existing regexes only.

## 7. Effort, tests, open questions

| Phase | Work | Est. |
|---|---|---|
| 0 | This doc + AUDIT review | — |
| 1 | `targetDecl.js`: resolver (Charts kinds) + validator §4.1-4.2, shadow wiring in `railOf`, flag | 2-3 d |
| 2 | Final-board check §4.3, fan-out union, deferred alias rewrite, card storage + rendering | 2 d |
| 3 | Shadow measurement report (corpus + probes) → AUDIT | 1 d |
| 4 | Enforce per kind (5 small PRs) | 1 d each |
| 5 | (optional) state kinds after #1247; model `targets` after byte measurement | 3-4 d |

**Tests**: per-kind unit tests (each effect type × declared/undeclared); the 11-14 6-panel case; fan-out union; alias rewrite;
card round-trip; shadow-no-behaviour-change on all capreg shards; `agentChartRail.census.test.js`-style census that every
`RAIL_KINDS` kind has a declaration mapping (a new kind without one fails).
**Mutants** (each must fail a test): drop one declaration entry; widen the lattice (`overwrite` permits `remove`); skip the
final-board check; validator returns null on throw (must fail closed); approve re-resolves from "do it" instead of the stored
declaration; fan-out without the union check; resolver trusts the model's `targets` alone.

**Open questions**
1. Owner: on enforce mismatch, refuse with reason (rail style) or ask "Did you mean to change X?" with choices?
2. AUDIT: is `resolver ∩ model` the right authority for Phase 5, or should model `targets` never authorise anything?
3. AUDIT: should the final-board check run on `exact:false` turns at all, or only when a count/shape/keep is stated?
4. Owner: should the card always show "Keeps: …" lines (more text on every card) or only when the words named a keep?
5. AUDIT: confirm the current #1224 measured bound and #1191 status for the Phase 5 byte gate.
6. Order vs #1247/#1261: wire after both merge (recommended) or land shadow now and rebase?
