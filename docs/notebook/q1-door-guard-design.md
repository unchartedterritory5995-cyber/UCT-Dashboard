# Phase 1 — the door guard. Design, ready to implement.

⛔ **MITIGATION, NOT ROOT CAUSE.** This label goes in the predicate's docstring, in
every call site's comment, in the rail's name, and in the commit message. The
defect is still unnamed (Q1/Q2); this only stops the member reaching it.

## 1.1 The one shared predicate

`app/src/pages/journal-2-0/lib/offline/noteHasUnsentWork.js`

```js
/**
 * Does this note have work the server has not acknowledged?
 *
 * ⛔ ONE authority. The guard, the rail and the control all call THIS. A control
 * that re-implements the predicate agrees with itself and says nothing about the
 * product — R-05, and this programme has committed it twice in a week.
 *
 * ⛔ MITIGATION, NOT ROOT CAUSE. It exists because an append door can lose a
 * member's offline words on a route whose defect is not yet named (Q1/Q2 in
 * docs/notebook/q1-red-cells-investigation.md). Deleting it without naming that
 * defect re-opens a silent data-loss path on a live member surface.
 *
 * ⭐ TWO SOURCES, OR-ed, because either alone is incomplete:
 *   · the durable record's `dirty` flag — the editor has unsent edits
 *   · a queued outbox entry for this note — the drain has not delivered them
 * The five RED cells show a record reconciled CLEAN while an entry was still
 * queued, so `dirty` alone would answer "no unsent work" on exactly the shape
 * this guard exists for.
 *
 * ⛔ UNKNOWN IS NOT SAFE. If the store cannot be opened or read, return TRUE —
 * defer the door. The cost of a false defer is one "try again in a moment"; the
 * cost of a false pass is the member's words.
 */
export async function noteHasUnsentWork(noteId, { accountId, connect } = {}) { … }
```

Return shape: `{ unsent: boolean, why: 'dirty' | 'queued' | 'both' | 'unreadable' | null }`
— `why` so the rail can assert *which* source fired, and so a defer can be
diagnosed without a second instrument.

## 1.2 The doors to guard

Confirmed reachable member surfaces calling `POST /notes/{id}/embeds`:

| file | call |
|---|---|
| `lib/captureTargets.js:37` | the `Send to Journal` door the rig drives |
| `components/AddPositionModal.jsx:245` | |
| `lib/importer/enrichment.js:45` | |

Widgets reaching `captureTargets`: `AiSearchWidget.jsx`, `AlertsWidget.jsx`,
`BreadthWidget.jsx`, `CalendarWidget.jsx`, `pages/breadth/drill/drillWorkspace.js`.

**Guard behaviour, while `unsent`:**
- do **NOT** POST the embed
- do **NOT** touch the record
- show `"This note is still syncing — try again in a moment."`

⛔ **Sweep first (§10.35), AST-resolved (§10.36).** The enumeration is already
done and is in the checkpoint: 31 writer sites, 0 aliased, `putNoteWithIntent` 11
sites (9 inside `outboxDrain.js`). Any door that writes into a note and is *not*
guarded gets listed with a reason, not silently skipped.

## 1.3 Rail + control + mutation proof

`app/src/pages/journal-2-0/lib/offline/doorDefersWhileUnsent.test.js`

- **rail** — record dirty ⇒ door defers, no POST, record untouched
- **rail** — record clean but an entry queued ⇒ door defers (the five-cell shape)
- **control** — no unsent work ⇒ door proceeds and POSTs
- **control** — store unreadable ⇒ defers (unknown is not safe)
- **copy contract** — assert the RENDERED text, not state. Two toasts have shipped
  invisible in this repo: one passed `message` where the component reads `msg`,
  one was owned by the branch its own action unmounts.

**Mutation proof** via the parameterised `tools/_mutate_expected_red.sh` (Phase
3.0 — do that first): remove the guard ⇒ the two rails redden and the two controls
stay green ⇒ restore byte-for-byte ⇒ all green. Paste both runs.

## 1.4 Sequencing

1. Phase 3.0 (parameterise the harness) — the mutation proof needs it.
2. The predicate + its own unit rails.
3. The door call sites + the sweep result.
4. Mutation proof.
5. Commit. First in the next push batch.

⚠️ **Do not ship the guard as a substitute for naming the defect.** It narrows a
live member exposure; it does not close it. R-1a's flip stays HELD either way.
