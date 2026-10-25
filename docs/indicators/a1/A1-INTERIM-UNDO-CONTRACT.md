# A1 interim contract: two Undo histories (Indicators × Agent)

**Status:** INTERIM, for the A1 release. Written by Indicators on 2026-10-25.

This release does **not** build a unified Undo. The Agent's proposal for one (P2-G
`docs/agent/PHASE2-SHARED-CONTRACT.md` §4: Agent indicator mutations recorded on A1.2's
history and undone through it) is **not ACKed in this release**. It stays open for an owner
decision after A1 merges. Until then, the rules below are the contract. Each rule is railed
by the tests named beside it.

## 1. Two histories, two owners

| | Member indicator history (A1.2) | Agent Undo stack |
|---|---|---|
| Owner | Indicators | Agent |
| Code | `components/chart/indicatorHistoryStore.js` (+ `engine/indicatorHistory.js`) | `agent/useAgent.js` (`undoRef`), `agent/runtime.js` |
| Scope | one per chart, `chart:<chartId>`, per member; sessionStorage `uct.indicators.history.v1:*` (depth 50, LRU-capped) | per Agent session (20 entries) |
| Records | member hide / show / add / remove of an indicator, plus named bulk writes: template, Restore Defaults / preset, share-link "Use theirs" | every Agent write it receipts (indicator mutations, chart settings, layouts, watchlists, alerts…) |
| Does NOT record | input edits (not an A1.2 kind); **any Agent write** | member writes |
| Undo surfaces | toast ("RSI hidden · Undo"), Chart Settings / ƒx Undo-Redo buttons, Ctrl+Z on the page | the receipt's Undo, "undo" / "undo that" |

## 2. Rules

1. **Agent writes are never on the member history.**
   - The Agent's door is `chartApiById → agent.commit` → the widget's `onOptsChange`.
   - The pane's `applySettings` is also unrecorded.
   - Only `applySettingsRecorded` (the member's template menu) records.
   - Rails: `ChartWidget.indicatorHistory.test.jsx`; `ChartPane.indicatorHistory.test.jsx` ("applySettings records NOTHING").
2. **Member writes are never on the Agent stack.**
   - NL-1's "undo that" undoes only the Agent's own newest entry. It never touches a member's
     manual edit, a member's Undo, or the member's Redo.
   - Validated by the Agent hand-off file (§4, case b).
3. **Exact or nothing (both stacks).**
   - Both use `engine/settingsRecord.js` (`changeRecord` / `holds` / never-partial revert).
   - An Undo or Redo applies only if every recorded path still holds the value it recorded.
     Otherwise it is **refused** (`changed-since` / `restore-conflict`) and writes nothing.
     It never restores outdated state.
   - Paths are keyed by `instanceId`, so changes to *different* indicators never block each other.
   - Rails:
     - `indicatorHistoryStore.test.js`;
     - `settingsRecordParity.test.js`;
     - `ChartPane.indicatorHistory.test.jsx` ("STALE … REFUSED");
     - hand-off file §2 (same instance: member Undo refused after an Agent show or setInputs;
       Redo refused after an Agent write; Agent Undo stays exact).
4. **Pending Agent proposals are bound to the state the card showed** (Gate C, master `1dbda8eabe`).
   - A member A1 Undo after the card is just another change to that state. If the target no
     longer matches the card, "do it" re-reads and **fails closed**. This was observed: a card
     on a member-hidden RSI, followed by a member Undo that shows it again, gives
     "can't run as you approved it".
   - If the Undo puts the target back *exactly* as the card showed, the approved change runs.
     That is correct, because what was approved is what runs.
   - Validated by the hand-off file §3.
5. **Keys.**
   - Ctrl+Z typed in the Agent's message box never reaches the indicator Undo.
   - On the page, Ctrl+Z does reach it.
   - Validated by the hand-off file §2.
6. **Layout switches (A1.3b).**
   - An Agent `layout.open` shows the Agent's receipt only, with no member toast.
   - A member Dock switch shows the member toast.
   - Each makes the other's Undo stale: the Agent never undoes a member's switch, and a stale
     member toast is removed when the board moves on.
   - A member open that never landed is never misattributed.
   - Rails:
     - `ChartsWorkspace.layoutUndoAgent.test.jsx` (L1–L5);
     - `ChartsWorkspace.previousLayout.test.jsx` (A1.3b cases);
     - `layoutUndo.test.js`.
7. **Templates, Restore Defaults and share links (A1.3)** are member writes:
   - recorded once under their own label;
   - Restore Defaults and presets keep indicators;
   - a `?state=` link is claimed once, by one chart, and asks first.
   - Rails: `ChartPane.indicatorHistory.test.jsx`, `ChartSettingsModal.restoreDefaults.test.jsx`,
     `indicatorPreservation.test.js`, `chartDeepLink.claimShare.test.js`, `flipB.test.jsx` (A1.3 cases).

## 3. Known, accepted limits of the interim

- A member's Ctrl+Z does not undo an Agent indicator change. Use the Agent's Undo.
- One change can have an Undo in only one place, but a chart can show both a member toast
  and an Agent receipt for *different* changes.
- Input edits made by a member are not on the member history (A1.2 scope).

## 4. Agent-owned tests (hand-off, not committed by Indicators)

`C:/w/a1-agent-handoff/a1AgentUndo.validation.test.jsx` drives Agent internals
(`planOps` / `commitPlan` / `undoEntry` / `AgentPanel`), which Agent Phase 2 is changing.
It therefore belongs in the Agent's suites, as that session's queued (a), (b) and (c). It is
11/11 green on this branch. It contains:

- §1–§2: the 10-13 scratch (`C:/w/a1gc`);
- §3: (a) a waiting proposal vs a member A1 Undo;
- §4: (b) "undo that" vs a member's manual edit and a stale Agent Undo.

Its test host needs `widgetInSync`. Without it, the Agent correctly fails every indicator
approval closed (`indicatorEdits.js:290`).

## 5. Changing this contract

Any change, including the P2-G §4 unified history, needs an Indicators ACK and an owner
ruling. The rails above move with it, in the same change.
