# WAVE Q1 §B — ONE WRITER OR TWO? THE MEASUREMENT, AND THE DECISION

**2026-09-11.** The handoff's §B asks the design question to be *answered by
measurement, before a fix*, and compared against "fix round 3 in place" on three
axes. This is that comparison.

⛔ **STATUS: DECIDED AND LOGGED, NOT YET IMPLEMENTED.** §A's rule still binds —
the rail goes red before any product change. This file records the decision and
the evidence so the next session does not re-derive it; it does not authorise a
fix.

---

## 1. WHAT IS ACTUALLY TRUE TODAY — measured, not recalled

| measurement | value |
|---|---|
| coordination code, `lib/offline/inFlight.js` | 54 lines |
| coordination code, `lib/offline/outboxDrain.js` | 228 lines |
| coordination code, `lib/offline/useOutboxDrain.js` | 191 lines |
| coordination code, `lib/offline/outboxLeader.js` | 73 lines |
| **total race-management layer** | **546 lines** |
| settle/marker/landed call sites inside `NoteEditorPage.jsx` | **21** |
| gauntlet mutations total | 24 |
| **tests in `offline/` + `components/notebook/` that catch round 2's defect** | **1 of 798** |

⛔ **That last row is the finding that decides this.** Reintroducing
`const current = captureLocalState() || saved` — the line that provably deleted a
member's words in production — reddens **exactly one test out of 798**, and that
test is a **SOURCE-TEXT PIN** (`inFlightGuards.test.jsx` §THE WIRE), not a
behavioural rail. No test in this repo observes the CONSEQUENCE. The defence
against the defect class that has now escaped three deploys is a regex over one
line of one function.

The pin is well-written and honest about being a pin — it says so in its own
comment, and explains that the behavioural rails could not catch it because they
call `settleLandedSave` directly. That is an accurate diagnosis of the rails. It
is also an admission that the behaviour is unguarded.

## 2. THE GUARD MAY BE UNREACHABLE — which would explain round 3

Round 3's fix is `if (!current) return` in `settleMetadataRevision`: refuse to
settle when the editor cannot report local state.

`captureLocalState()` returns null only when `!noteId || !editorRef.current`
(`NoteEditorPage.jsx:706`). In the door path **neither can be false**:

- the door handler closes over the `noteId` of the render that created it, and a
  door only renders when a note is open, so `noteId` is always truthy there;
- `editorRef.current = editor` is assigned every render (`:1314`) and is **never
  nulled** — there is no `onDestroy`, no cleanup, no `editorRef.current = null`
  anywhere in the file.

And measured directly: **after unmount the TipTap editor reports
`isDestroyed: false` and `getJSON()` still answers**, returning the document as
it stood at unmount.

⇒ `captureLocalState()` does not return null in the path round 3's guard
protects. It returns a **stale** object. ⛔ **So the fix may be guarding a
condition that cannot occur, which would explain why the defect recurred against
a deploy that contained it.**

⚠️ Stated as the strong inference it is, not as proof: the rail has not gone red,
and §A says the rail decides. But it is the best-supported explanation on the
table and it is a measurement, not a story.

## 3. THE SAME SHAPE SURVIVES AT OTHER SITES

The pin covers `settleMetadataRevision` only. `captureLocalState() || <the acked
copy>` also lives at:

- `NoteEditorPage.jsx:789` — the draft-recovery save path
- `NoteEditorPage.jsx:1583` — **`commitSave`, the primary save path**

⭐ And site `:1583` contradicts its own adjacent comment, which says that if the
member typed during the PUT "the durable copy is ahead of this ack and its sync
intent must SURVIVE". The fallback is the thing that would end that intent.

(`:830` is NOT one of these. `markSynced({acked: server, current: server})` there
is the member explicitly *discarding* a recovered draft; asserting that the
device now matches the server is correct and deliberate.)

⛔ **A guard applied at one of three sites where the pattern occurs is not a
guard** — it is a fix to one spelling of a defect whose shape is repo-wide.

## 4. THE THREE AXES

| axis | fix round 3 in place | SINGLE WRITER |
|---|---|---|
| **orderings the rail must cover** | every interleaving of: editor PUT · 3 metadata door PUTs (no CAS) · drain PUT · marker up/down · landed ring · 409 self-supersede · mount/unmount · `excludeNoteId` in/out. The doors alone give 3 more writers that can move a revision with no body and no baseline. | one. The drain PUTs; nothing else does. There is no second writer to interleave with, so the orderings are not reduced — **they stop existing**. |
| **mutations needed** | grows with each guard. Round 3 added a guard whose mutation (M22) was *dull* until a source pin was written for it, because the behavioural rails cannot see the editor's argument. | the coalescing rule and queue order. A mutation on "one entry per note" or "latest body + latest metadata" reddens behaviourally, because the queue is observable state rather than a timing window. |
| **lines of coordination code** | **546 + 21 call sites**, and rising — three rounds have each added to it. | the marker, the landed ring, the two-pass drain and `settleMetadataRevision` all become unnecessary *for correctness*. Guard 2's 409 self-supersede is **kept** as defence in depth, per the handoff. |

## 5. DECISION

⭐ **SINGLE WRITER.** When `offlineEnabled()`, the editor's body autosave and all
three metadata doors ENQUEUE; the drain is the only thing that PUTs a note, in
queue order, coalescing per note to one entry (latest body + latest metadata, one
baseline). The drain runs a tick on enqueue while online so latency stays
immediate.

**The reasoning, in one sentence:** three rounds of guards have produced 546
lines of coordination, a defence that only one test in 798 can see, a guard that
appears unreachable, and the same defect shape left standing at two other sites —
and every one of those costs exists only because a note has two writers.

⛔ **What this decision does NOT license:**
- It is not permission to start. §A's rail must go red first.
- ⛔ **The latency cost must be MEASURED, not estimated** (the handoff is
  explicit). The PUT-latency baseline already exists and is the comparison
  point: n=30 real CAS PUTs, min 81.3 · p50 111.2 · p95 526.0 · max 997.6 ms.
- Guard 2's 409 self-supersede stays.
- ⛔ Nothing here touches `OFFLINE_DEFAULT_ON`. It is false and stays false.

## 6. THE HONEST RESIDUAL

jsdom could not reproduce round 3 across five orderings, N=1..5 in flight, three
doors, reload-mid-flight, slow-PUT, and the `excludeNoteId` transition — with the
real editor and the real drain mounted together for the first time in this repo's
history (`doorsThroughTheEditor.property.test.jsx`, committed RED-less and
labelled as not-a-gate).

⛔ **So the reproduction still owes a rig run.** The instrument that caught this
three times is the browser canary, not jsdom. Until the rail goes red — in jsdom
or on the rig — this decision stands as a decision and not as a fix.
