# Wave Q1 — the activation canary went RED, and why that was the point

> **Q1 was activated at ~16:05 UTC on 2026-09-09 and rolled back at ~16:20 UTC.**
> `OFFLINE_DEFAULT_ON` is `false` again (`ee952041c`), and the browser used for
> the canary was opted out immediately with
> `localStorage['uct.j2.offline.enabled'] = '0'` so it could not drain while the
> rollback deployed.
>
> ⛔ **The rollback deleted nothing**, which is the §21 contract behaving as
> designed: with the flag off, the queued entry and the durable record were both
> still on disk, verified on the deployed artifact. They were removed afterwards
> as a separate, deliberate act — they were a KNOWN-BAD empty patch on my own
> throwaway canary note, their content is recorded verbatim below, and leaving a
> baseline-less write queued where a future re-enable could send it would have
> been the one genuinely reckless option.

---

## What the canary found

Step 9 of the §15 happy path is *reload / tab reopen*. After the reload, all
three local layers held **an empty note**:

```
IndexedDB  notes   { title: "", subtitle: "", bodyJson: {doc,[paragraph]},
                     dirty: 1, generation: 1, sessionId: <new>, baseUpdatedAt: null }
IndexedDB  outbox  { patch: { title: "", subtitle: "", bodyJson: {doc,[paragraph]} },
                     baseUpdatedAt: null, permanent: false }
localStorage draft { title: "", subtitle: "", bodyJson: {doc,[paragraph]} }
```

The work typed a minute earlier — a title, a subtitle and a body, all verified
present in all three layers before the reload — was gone from every local copy.

**And the queued entry carries `baseUpdatedAt: null`.** `sendNoteUpdate` omits
the field when it is falsy, so that entry would have been sent to the server as
a PUT **with no compare-and-set at all**. On a note with real prose in it, the
drain would have replaced the member's words with an empty document, and the
mechanism that exists to make exactly that impossible would not have been
present in the request.

⛔ That is the "never clobber" invariant defeated by a path nobody designed, and
it is worse than the 409 handler this wave was created to fix — that one at
least sent a baseline.

---

## Root cause — ⛔ NOT ESTABLISHED, AND I WILL NOT GUESS IT

I had a mechanism written here and then failed to reproduce it. It is removed
rather than left standing, because a root cause nobody can demonstrate is a
story, and this program does not ship stories.

**What is certain, from the artifact:**

- `generation: 1` — the empty snapshot was the FIRST scheduled write of that page
  session, so nothing overwrote real work; the real work was simply never written
  in that session.
- a brand-new `sessionId`, and `baseUpdatedAt: null` — at schedule time
  `lastSavedRef.current.updatedAt` was still null, i.e. **the note had not
  finished loading**.
- the body is exactly ProseMirror's normalisation of an empty document.

So a snapshot was scheduled while the editor was empty and the note unloaded.
For `scheduleAutosave` to run at all, TipTap's `onUpdate` must have fired.

**What did NOT reproduce it, both tried:**

- opening the same note again in production with the flag on, and waiting:
  **nothing at all is written** — no draft, no record, no outbox entry;
- a jsdom mount of `NoteEditorPage` with `useJ2Note` returning `note: null`
  first and the note afterwards: also nothing written.

The most likely remaining difference is timing — in the canary the pod was two
minutes old and the note fetch was slow enough that an editor was created with
`{ type: 'doc', content: [] }` before `note` arrived, and recreated afterwards
(`useEditor(..., [note?.id])`). That would explain every field. **It is a
hypothesis. It has not been demonstrated, and the next step is to demonstrate it
before fixing it** — a slow-fetch harness, not a faster read of the source.

### ⛔ What is certain regardless of the trigger

**An outbox entry can exist with `baseUpdatedAt: null`, and `sendNoteUpdate`
omits the field when it is falsy — so that entry would be PUT with no
compare-and-set at all.** One path that produces such an entry demonstrably
exists in production. Whatever the trigger turns out to be, a queued write that
cannot prove it is not clobbering must never be sent, and that is fixable on its
own merits.

## What was NOT hit

- **No member data is known to be lost.** The flag was on for roughly fifteen
  minutes, the trigger is *reopen a note that has unsynced work*, and the drain
  stopped the moment the flag went off, so no queued empty patch can be sent.
- The server copy of the canary note is intact at its original revision.
- Nothing was deleted from any local store, by design.

---

## The fix, as diagnosed — NOT implemented

⛔ Recorded, not built. §29 says a red activation stops for a decision.

0. **Reproduce it first.** A harness that makes the note fetch slow, so the
   empty-editor window is wide and observable. No fix lands before the trigger
   is a measurement.
1. **Nothing may be persisted before the note is hydrated.** A `hydratedRef`,
   set when the note-load effect has put the server content into the editor and
   the refs, would gate `scheduleAutosave` entirely — belt and braces even if
   the trigger turns out to be something else.
2. **The drain must refuse to send an entry with no baseline.** A queued write
   with `baseUpdatedAt: null` for a note that has a server revision cannot prove
   it is not clobbering, so it must not be sent — the same posture as a
   `permanent` entry: keep the work, stop trying, surface it. Defence in depth
   for whatever the next unforeseen path is.
3. **Rails, once the trigger is reproduced**: the reproduction itself becomes
   the rail, and `sendNoteUpdate` must never issue a note PUT without
   `baseUpdatedAt` when the note has a server revision.

⚠️ One asymmetry worth keeping in view while diagnosing: the server save is
debounced 800 ms and reads `title`/`bodyJson` FRESH at fire time, while the
durable write is debounced ~200 ms and persists a snapshot captured at SCHEDULE
time. Whatever fires early therefore reaches the durable layer and does not
reach the network layer. That is a difference in kind, not just in timing.

---

## What the canary is worth

It ran for eleven minutes and found a data-loss path that six days of rails, a
seven-environment browser matrix, two real iPhones and a full product
certification in Chrome had all missed — because every one of them tested a note
that was **already loaded**. The §15 script insisted on `open → edit → reload →
recover` in that order, against production, on a real note. That ordering is the
only reason this was found before a member's research paid for it.
