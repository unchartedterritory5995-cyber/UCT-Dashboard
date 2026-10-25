# A1 integration onto master — 2026-10-25

Branch `integrate/indicators-a1-on-master` (worktree `C:/w/ia1i`), based on master
`f0b4599b6f`. LOCAL ONLY: not pushed, no PR, nothing released. `feat/indicators-a1`
(`2928cfc55e`), PR #325 and `C:/w/ia1m` are untouched.

⚠ Open recovery risk: nobody has yet checked whether the other PC holds unpushed A1
commits newer than `2928cfc55e`. If it does, this branch must be re-based on them, never
pushed over them.

## 1. How it was built

`git cherry-pick -x` of the 15 commits `66cd9fe126..2928cfc55e`, in order.

| Original | Integrated | Piece | Patch |
|---|---|---|---|
| f5b332f77f | 05ce7891ba | readiness audit (docs) | identical |
| 859bdf538a | 80c704aa49 | Agent boundary reply (docs) | identical |
| 6124a78484 | 8d88d54a27 | A1.0 settingsRecord extraction | same +/- lines, context moved |
| eaf58133f0 | ed5c40656b | A1.1 off = hide | identical |
| fa8336a5c8 | cb54a94e47 | A1.2 exact Undo | same +/- lines; conflict resolved |
| abbd873a54 | fc9453f897 | stage report (docs) | identical |
| 5e11acec70 | 0005d320c4 | A1.2b Undo/Redo buttons | identical |
| 498579821b | 18b327fd40 | A1.2c census keys | identical |
| 1d1c97aa73 | b5f6c6ad3a | A1.3 defaults/presets/templates/share | same +/- lines; conflict resolved |
| 3cb77291e1 | dd988e095d | A1.3b layout Undo | identical |
| 415999e9a9 | 5157d70141 | A1.3b toast lands | identical |
| 6719a8883f | 723c1c2113 | A1.3b string ids | identical |
| 11d15ac982 | f129c8792a | A1.4 unavailable indicators | same +/- lines, context moved |
| 1311765c84 | 7b8eadc602 | A1.3b toast on layout move | identical |
| 2928cfc55e | 075d4f4d6c | ChartPane comment (docs) | identical |

The two conflicts were both master lines next to A1's edits. A1's added and removed lines
are byte-identical to the reviewed chain.

- **`MobileChartsApp.jsx` (A1.2):** master added `useContext` to the React import (for
  `ChartHostOverlayContext`), and A1 added three imports below it. Resolved by keeping both.
- **`StockChart.jsx` (A1.3):** A1 rewrites the share-URL effect (one-shot claim, asks
  first, deps `[prefsLoading]`). Master's study-mode work (`b32489bf08`) changed the next
  line to `useChartDrawings(_study ? null : sym)`. Resolved with A1's effect plus
  master's line. Master's `severInfoValuesForInstanceSwap` call in the old effect is
  carried by A1's `applyShareIndicators` (indicatorPreservation.js:31).

Not restored: the C4 grid persist filter. No C4 design decision was implemented.

## 2. Validation (Windows, Node 24.16, `npm ci` fresh)

| Check | Integration branch | Clean master `f0b4599b6f` |
|---|---|---|
| vitest full | 49,878 tests · 49,702 passed · **19 failed** | 49,776 tests · 49,602 passed · **20 failed** |
| A1's 27 test files | 732 passed · 2 failed (the two literals, see below) | n/a |
| Agent suites (Gate C indicators, setInputs, approval binding, M2, parity) | 90/90 | n/a |
| Agent A1 integration scratch tests (`C:/w/a1gc`, run unmodified) | 12/12 | n/a |
| `npm run build` | PASS | n/a |
| `persistence_census --check` | 20 problems, **identical to master** (Notebook drift); A1 keys declared | 20 problems |
| eslint on changed files | +30 errors, all in A1's own new tests/files (`no-undef` vitest globals ×28, `only-export-components` ×1, `no-unused-vars` ×1). The same errors are on `2928cfc55e`. Lint is not a CI gate. | n/a |
| `deploy_scope_gate f0b4599b6f HEAD` | Tier 2 (frontend only; no `api/`, no flow-worker strand) | n/a |

Failure comparison:
- **Only new failure:** `perInstanceDoor` "THE LITERAL (A1)".
- **Failing on both:** 18 tests, including the journal round-trip bridge files, whose
  sandbox paths differ between runs.
- **Failing on master only:** `StockChart.smoke` and `vendorTruth` (load flake).

### The literal rails (not A1, NOT regenerated)

| Rail | `2928cfc55e` (old base) | Master | Integration |
|---|---|---|---|
| `alertSets` "merged settings blob is BYTE-IDENTICAL" | pass | FAIL | FAIL |
| `perInstanceDoor` "THE LITERAL" | pass | FAIL | FAIL |
| `perInstanceDoor` "THE LITERAL (A1)" | pass | n/a | FAIL |

Cause, proven: master `96194c642c` (account-size Round B fix 1) changed
`CHART_DEFAULTS.positionCalc.accountSize` from `50000` to
`ACCOUNT_SIZE_DEFAULTS.unsetAccountSize`. Every merged blob changes, so every corpus
digest moves. With only that value put back temporarily, all 58 tests in both files
pass on the integration branch. The file was restored afterwards.

Per the rails' own rule, the digests must be re-measured deliberately by whoever owns
that change (master's two rails are already red), and never regenerated to go green.
A1's literal should move in the same commit.

## 3. Undo: A1 (member) × Agent

- **Member stack:** one per chart, key `chart:<widgetId>`, sessionStorage
  `uct.indicators.history.v1:*`, per user. It records ONLY member edits:
  - Chart Settings modal (`updateFromSettingsModal`);
  - the phone ƒx sheet;
  - the panel Undo/Redo buttons;
  - templates (`applySettingsRecorded`);
  - Restore Defaults / presets;
  - share-link "Use theirs".
- **Agent writes are never recorded on the member stack.** The Agent writes through
  `api.agent.commit → onOptsChange` (ChartWidget.jsx:345). `applySettings` stays
  unrecorded. This was verified unchanged on master.
- **One record engine:** both stacks use `engine/settingsRecord.js` (`changeRecord` /
  `holds` / never-partial revert).
  - An Undo applies only if every recorded path still holds its `after`.
  - Paths are keyed by `instanceId`, so edits to different instances never block each
    other.
  - On the same instance, the later writer wins and the older Undo is REFUSED (scratch
    tests: member Undo refused after an Agent show or setInputs; Redo refused after an
    Agent write; Agent Undo stays exact).
- **Layout Undo (A1.3b):**
  - an Agent open gives the Agent's receipt only, with no member toast;
  - member and Agent switches make each other's Undo stale;
  - a member open that never landed is never misattributed (scratch L1–L5).
- **Keys:** Ctrl+Z in the Agent message box never fires the indicator Undo.
- **Gate C approval binding (master `1dbda8eabe`):** a member A1 Undo changes material
  board/indicator state. A waiting Agent proposal is therefore not withdrawn at that
  moment, but on "do it" it re-reads the authoritative state and fails closed on binding
  drift. That is safe, but no test covers it yet (see §4).
- **NL-1:** "undo that" acts only on the Agent's own stack. Member A1 entries are not on
  it, so an Agent correction can never undo a member edit, and the reverse holds too.

## 4. Shared-interface note for the Agent Phase 2 session

**Contract unchanged:**
- `MUTATION_CONTRACT = 'uct.indicators.mutation/1'`.
- `MUTATION_OPS = add/remove/setVisible/setInputs`.
- `agentMutations.js` exports are identical. `changeRecord` is now re-exported from
  `engine/settingsRecord.js` (A1.0, approved by the Agent 10-13).
- Refusal shapes are railed by `settingsRecordParity.test.js`.
- No `app/src/agent/**` file and no `agentSeams.js` change.

**Behaviour the Agent should know:**
1. **A1.1:** turning a definition off now HIDES its instances (they are kept). It does not
   delete them. `removeDefinition` still tombstones every instance.
2. **A1.4:** unavailable indicators get a named strip (Remove / Keep / Repair / Open in
   Builder).
3. **A1.3:** a `?state=` share link is claimed by ONE chart, stripped, and asks first.

**Requested Agent integration tests** (Agent-owned; Indicators did not write them):
- **(a)** A waiting indicator-edit or layout proposal, then a member A1 Undo, then
  "do it": must fail closed on binding drift.
- **(b)** NL-1 "undo that" after a member A1 Undo: only the Agent's own entry.
- **(c)** Promote the 10-13 scratch tests (`C:/w/a1gc`) into real Agent suites. Their
  `/api/agent/turn` stub returns `{}`, and master's `useAgent.js:1345` then throws an
  unhandled `env.disposition` TypeError (stale stub). It is also a small robustness gap
  in `useAgent` when the envelope is missing; that is Agent-owned and not changed here.
- **(d)** Agent Phase 2 P2-F (new Indicators ops) should start from this branch once
  landed.

## 5. Remaining decisions and blockers

1. Confirm the other PC holds no newer A1 commits (recovery risk).
2. The literal digests (owner of `96194c642c`, plus Indicators for A1's literal):
   re-measure deliberately.
3. Owner questions still open: the C4 grid persist filter (removed, not restored), the
   C4 confirmations R8 / reset placement / modal mismatch. Q7 was answered and is built
   in A1.3b.
4. A1 test-file lint (`no-undef` vitest globals) is cosmetic and can be fixed in-branch
   on request.
5. Linux CI has not been run on this branch.
