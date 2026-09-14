# F5 — SECOND-CONTEXT APPEND · **GREEN** · 2026-09-14T05:02Z

> **Prediction registered before the run** (commit `fdcb29750`): *GREEN.*
> **Result: GREEN.** Recorded together so the prediction cannot be reread as
> hindsight.

## The discriminator

Same append door. Same family, same ordering, same queue, same route away, same
return, same release. **One difference: which context fires it.**

| cell | who fires `append_widget_embed` | verdict |
|---|---|---|
| `append_widget_embed × drain-first` | the FIRST context (the one holding the dirty queued edit) | 🔴 **RED** |
| **second-context append** | a SECOND signed-in context, same account | ✅ **GREEN** |

GREEN reading: *offline sentence in the server body: **True***, 5 requests
carried the sentence, baseline `2026-09-14T05:02:40.163380+00:00`.

⭐ **So the mechanism is not the append door, not the endpoint, and not the
server.** It is something the first context does **when it is the one that fires
the door**. Firing the identical door from another browser leaves the member's
words intact.

## What that plus the trace narrows it to

The code trace (`f5-append-response-trace.md`) established, with every link
quoted, that the append-response path performs **exactly one durable write**:

```
captureTargets.js:49   await settleNoteWrite(noteId, res)
  -> settleNoteWrite.js:51   destructures ONLY recordLandedRevision
    -> useDurableNote.js:232
       await putMeta(db, landedKeyFor(noteId), withLanded(await getMeta(...), landed))
```

No `putNoteWithIntent`. No `mutate`. No server-copy write. The response body is
read and everything except `updatedAt` is thrown away (`settleNoteWrite.js:87`).

⭐⭐ **And that single write is precisely what the second context cannot do to the
first.** The landed ring lives in the firing context's own meta store, and two
browser contexts share no storage (measured). So the GREEN cell differs from the
RED one by exactly this: **ctx1's landed ring never learns the revision.**

## ⛔ What is NOT yet established, and must not be written as if it were

The landed ring is **meta only**. It cannot itself change the record's body — and
the RED trail shows the record's body losing the sentence:

```
(1, True, '48', True)  ->  (1, True, '85', False)  ->  (0, False, None, False)
      still queued, still dirty, base moved, sentence GONE from the record
```

So the ring is the **enabler**, not the write. Something downstream, unlocked by a
vouched ring, overwrites the record. The trace censused all eight non-test
`putNoteWithIntent` callers and named the three that can produce that shape —
`useDurableNote.js:286` (`settleLandedSave`), `useDurableNote.js:402` (`persist`),
`outboxDrain.js:75` (`settleSent`) — and the drain's rebase/merge path writes the
record back at `outboxDrain.js:204` and `:247`, reached only via
`ringVouchedPlan`.

⭐ The `(1, True, newer-base, …)` shape — **still queued, base already moved** — is
what a post-rebase, pre-send state looks like, which points hardest at the drain's
rebase/merge path. **That is a hypothesis with a mechanism, not a finding**, and
the line has not been confirmed by instrumentation.

## Consequence: the fix does NOT ship tonight

The ruling ships the fix at head of queue **with the embed cell re-run as its
production proof**. That re-run was attempted immediately after this cell and
came back:

```
⇒ INCONCLUSIVE   could not create the probe note ({'err': 'HTTP 502'}) — nothing was measured
```

⛔ **Production was mid-deploy.** Railway's own list shows **198 of the last 200
web deployments in state REMOVED** — near-continuous stacked merges from other
sessions, which is the pattern the one-merge-at-a-time rule exists to stop. The
probe note could not be created, so nothing was measured and nothing is banked.

**Therefore:** mechanism confirmed to be first-context-only; the enabling write
identified; the record-overwriting write narrowed to a named short list and not
yet pinned; and **no fix ships until the embed cell can actually be measured.**
Re-staged.

## The supersede rail, reconsidered — carefully

`supersedeProvesContent.test.js` reproduces an entry being discarded because a
*landed revision* is newer, without checking that it contains the entry's words.
That is the same ring, one step later, and this result makes it look less like a
separate latent hazard than it did.

⛔ **Not merged into this finding, and not re-classified on a resemblance.** The
supersede rail clears the ENTRY; the RED trail also loses the sentence from the
RECORD, which supersede does not do. Until the record-overwriting write is pinned,
"related" is the strongest honest word, and the rail keeps its own queue entry.
