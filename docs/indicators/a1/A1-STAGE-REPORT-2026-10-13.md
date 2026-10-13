# Indicators A1.0–A1.2: stage report

- **Branch:** `prep/indicators-a1` (worktree `C:/w/ia1`), from master `fdba4c997d`. Local only: nothing pushed, merged or deployed.
- **Authorised:** A1.0, A1.1 and A1.2. **A1.3, A1.3b and A1.4 are not implemented.**

| Commit | Content | Separately revertable |
|---|---|---|
| `a0a9b9a5aa` | **A1.0**: change-record helpers moved to `engine/settingsRecord.js`, no behaviour change | yes |
| `dfd84fc71d` | **A1.1**: turning an indicator off hides it; it never deletes | yes (verified standalone) |
| `1f033c02ba` | **A1.2**: exact, never-stale Undo ("RSI hidden · Undo") | yes |

## A1.0

**Parity.** `builder/settingsRecordParity.test.js` checks the moved code against a frozen copy of the pre-move helpers, using the Agent M2 fixture chart. It must give byte-identical records, holds and reverts across:
- 9 writers;
- 81 writer pairs;
- stale-Undo refusals;
- `removeInstanceWithRecord` / `restoreRemoved`;
- 400 seeded edits.

The test was checked for teeth: disabling the holds-check, or the canonical key sort, makes it fail.

**Agent review:** approved by the Agent session 2026-10-13. It checked the moved code character by character, the refusal shape and eslint.

**The Agent's condition for building on A1.0** is met in A1.2:
- element mode is opt-in through `record.granularity`;
- an Agent record never carries that field;
- a record without it reverts through the unchanged leaf code (5 added tests).

## A1.1

### Behaviour

- **`setIndicatorEnabled` OFF hides; it never deletes.**
  - Every visible instance becomes `hidden:true, hiddenVia:'definition'`.
  - Nothing is tombstoned or severed, and the mirror is not written.
  - With no live instance, OFF is unchanged.
  - A marker left over from an earlier definition hide, on a copy the member kept hidden, is dropped, so off→on is exact.
- **ON shows exactly what was hidden**, byte for byte.
- **New writers:**
  - `removeDefinition` is the old OFF, verbatim.
  - `ensureLegacyInstance` is the old ON. `setIndicatorInput` now calls it, so **an input or colour edit never un-hides** (R1).
- **The doors read `definitionVisibility`** (absent / shown / hidden), and each was updated:
  - Library row: ○ plus a "Hidden" pill;
  - right-click Indicators ▸ X: a hidden study stays listed as "X (hidden)";
  - Ctrl+I / O / B and Alt+U;
  - the phone Studies switch (" · hidden");
  - the generated Chart Settings row, whose `enabled` now means "shown"; a new `exists` field keeps the row listed (the helper found this one stuck);
  - Chart Settings search results show a "Hidden" pill (D8);
  - right-click MA hides all visible averages and shows exactly those back (the Q1 default, through the same writer).
- **Pane "Hide \<label\>"** hides only that pane's host instance (C2).
- **Phone "Remove from chart"** removes only the edited instance (D6).
- **R2:** the Chart Settings switch for a row with no instance is unchanged. With 0 live instances it still tombstones `legacy:<id>`; it is covered by tests.

### Tests

- Every pre-A1 delete assertion is kept, now driven through `removeDefinition`, with hide assertions beside it.
- **Rails changed:** 12 files. One literal was re-derived rather than regenerated: `perInstanceDoor` checks every element, and the old literal is pinned against `removeDefinition`.
- **New property test:** 1,000 seeded sequences, 5 invariants after every persisted step. The pre-A1 door fails invariant 1 on more than 150 of 200 seeds.
- **The commit stands alone:** at `dfd84fc71d` there are no new failures; two load timeouts pass when run alone.

### Not in A1.1, needs a decision

**The grid persist filter (C4)** was built, then removed. It would silently drop edits on charts hosted under an override: grid cells, list, drill, ETF and period-sort charts. Today those edits reach global settings, and the merge displays them. A1.1 makes grid chords *safer* than today (hidden copies instead of tombstones), but the override-leak itself is still present.

## A1.2

- **`settingsRecord` element mode:**
  - whole-instance paths;
  - add/remove handled by splice;
  - `invertRecord` for Redo;
  - **order drift never refuses**, because an override surface orders its view differently from the blob it wrote. Elements are always exact.
- **`indicatorHistory`:**
  - records in the persisted-read space;
  - Undo/Redo refuse `changed-since` and write **nothing** if anything they touched moved: another tab, the Agent, or an edit to the same instance;
  - an edit to a *different* instance never blocks them.
- **`indicatorHistoryStore`:**
  - per member and per chart surface;
  - depth 50, with Redo;
  - `sessionStorage` under exact keys, tracked in its own index, never scanned;
  - 256 KB per surface and 2 MB in total;
  - falls back to memory.
  - It records hide, show, add and remove only. **Input edits and Agent writes are never recorded.**
- **Toast:**
  - shows for 8 s and pauses on hover or focus;
  - after Undo it offers Redo; a refusal gets its own sentence.
  - **Keys:** Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y are declared in the keyboard registry (`indicators.undo` / `redo` / `redoY`; the TERM-063 ratchet requires it).
    - bound only while a toast shows, in the capture phase;
    - never in a text field or modal;
    - one toast owns the keys at a time.
- **Wiring:**
  - `StockChart` records at its write funnel;
  - `ChartPane` records **only** the Chart Settings modal's `onChange`, never `applySettings` (the Agent's);
  - the phone ƒx sheet records onto the same `chart:<id>` stack.
- **Tests:**
  - store: 15;
  - toast: 7, including capture-phase pre-emption and a mutation-checked no-re-toast regression;
  - parity and element mode: 10;
  - end-to-end on the real chart: chord → toast → Undo (the original instance, byte-identical) → Redo.
- **Regression:** 252 files and 4,387 tests green on the focused set. The broad run shows only failures that predate A1, verified against master: `targetScriptReport`, `keyListenerCensus` NON-VACUITY, three journal tests and one terminal test, plus load timeouts.

**Not built in A1.2:**
- the Undo/Redo buttons in the Chart Settings and phone panel headers. While the modal is open its toast sits behind it, and Ctrl+Z is ignored inside modals. That is the next A1.2 follow-up.
- the grid door-guard notice (tied to C4).

## The Agent's in-place editing (Gate C)

The Agent drafted `setInputs` (`3afa0f67ba`, on its own branch) for Indicators review. I reviewed it and approved it from the Indicators side:
- writer routing matches `applyRowPatch`;
- leaf Undo with a fingerprint check, and no `granularity` field;
- census count 5, with its reason.

I replayed it with no edits on A1.2: it auto-merges cleanly and 108/108 tests pass. The owner should confirm the Agent's Gate C authority; I could not verify it.
