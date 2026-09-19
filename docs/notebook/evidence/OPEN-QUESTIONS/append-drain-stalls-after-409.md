# ⚰️ TITLE RETAINED, CLAIM WITHDRAWN — the append drain is not stalling, it is SKIPPING

**This file first said "the append drain stalls after its first 409". That was
wrong, and the correction is the finding.**

Evidence: `evidence/20260919T081701-p3-append-door-restored-guard-unknown-only/`

## What actually happens

`app/src/pages/journal-2-0/tabs/NotebookTab.jsx:77`

```js
const drain = useOutboxDrain({ accountId: auth?.user?.id, excludeNoteId: noteId })
```

`app/src/pages/journal-2-0/lib/offline/outboxDrain.js:288`

```js
if (excludeNoteId && entry.noteId === excludeNoteId) {
  results.push({ ..., outcome: SKIPPED })
  continue
}
```

**The sweep never touches the note the editor has open.** That is designed, it is
documented in three places, and its reason is in the parameter doc: *"the note the
editor currently owns — two writers on…"*. The editor is responsible for sending
its own open note.

The P3 wire shows `POST /<id>/opened` **after** the embed: the cell returns to the
note. From that moment the entry is `excludeNoteId`'s, and the drain correctly
skips it forever.

## ⛔ So the INCONCLUSIVE is an INSTRUMENT result, not a product stall

The cell's completion condition is *"wait until the outbox no longer holds this
note's entry"*. For a note the member still has open, **that condition can never
be satisfied by the drain**, by design. The rig was measuring for an event that
the product has deliberately arranged not to happen.

⭐ This is the same class the session already paid for twice — a cell reporting a
true sentence about the wrong subsystem. *"The drain had not finished"* is
accurate and reads as a product fault; the drain had not STARTED on that entry,
and would not.

## What I had wrong, and what refuted it

| I wrote | what the code says |
|---|---|
| "four retries should have fired inside the window" | they did fire; each one hit the `SKIPPED` branch before any network call, which is why the wire shows nothing after the 409 |
| "hypothesis 2 — `pendingRef.current` is 0 so the retry never fires" | **refuted**: `countPending()` runs after every drain (`useOutboxDrain.js:268`), so the count is refreshed |
| "hypothesis 1 — the pre-send server read returned nothing" | not reached; the entry never got that far |

## What would make the cell measurable

Either of these, and they answer different questions:

1. **Close/leave the note before waiting** — then the entry becomes the sweep's
   (`NoteEditorPage.jsx:807`: *"this is exactly when the note leaves
   `excludeNoteId` and becomes the sweep's"*) and the existing drain-wait is
   valid. This measures the SWEEP's handling of an append 409.
2. **Wait for the EDITOR to send it** instead of for the outbox to empty — a
   different completion condition, measuring the path a member on the open note
   actually takes.

⛔ **Not by raising the ceiling.** The entry will never drain while the note is
open; a longer wait buys a longer wait. That lever would have hidden this three
times today.

## Unchanged and still true

- **RED = 0.** The member's words are in the durable copy and in the queue
  throughout. Nothing was lost.
- **DEFERRED-BY-GUARD = 0.** The flip was genuinely live; the door was open.
- Neither fix 6 nor the provenance split is implicated — both sit upstream of the
  send.
