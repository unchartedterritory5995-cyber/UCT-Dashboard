# The five RED append cells — investigation handoff

**Opened 2026-09-14, after Q1 fix 4 shipped to production and did NOT close them.**
**Still open 2026-09-15: fix 5 did not close them either.**
**✅ WRITER NAMED 2026-09-17, at the unit level. Fix 6 designed, railed and
staged — NOT pushed (RESERVED).**
Written for a session with zero context.

> ### ⭐ THE WRITER
>
> **`persist` at `useDurableNote.js:480`, spy call 1** —
> `app/src/pages/journal-2-0/lib/offline/q1AppendWriterCensus.test.jsx`.
>
> ```
> n:1  writer  persist at useDurableNote.js:480
>      intent  NULL
>      dirty   1 -> 0
>      sentence-in-record  true -> false
>      queued  1 -> 0
> ```
>
> The function name is the spy's answer; the line is
> `tools/q1_clean_write_sweep.mjs`'s (an acorn parse), and `grep -n` agrees with
> both. It was **`useDurableNote.js:402` in the three-candidate census** — the
> census was right, and it stayed a census for two days because nothing had
> ever watched those three sites fire.
>
> ⛔ It is NOT `outboxDrain.js:75`. That site proves content and settles
> correctly; the reproduction's control case drives it and stays GREEN.

---

## ⛔ THE STAKES — read this before the trail

**This is a live member path, and the loss is silent.**

The door is **`Send to Journal → Current note`**, reachable from `/charts` widgets
(`AiSearchWidget.jsx`, `AlertsWidget.jsx`, `BreadthWidget.jsx`, `CalendarWidget.jsx`,
and `pages/breadth/drill/drillWorkspace.js`). Wave Q1 is **live for every member** —
`notebook_offline_default_on: True`, verified on production.

A member types into a note while offline, then sends a widget to it. **The embed
reaches the server. Their typed words do not.** The durable local record is then
reconciled clean, so nothing marks the note as pending and no recovery surface
offers the words back. **There is no error and no banner.**

Q1 fix 4 and Q1 fix 5 are both live and both are real fixes. **Neither closed
this.**

---

---

## 0. Fix 5 shipped and mutation-proved; **NOT the cause** — 00:03 run RED 5/5

> ⚰️ **This section was headed "✅ RESOLVED" for about three hours.** The
> production re-run it was waiting on came back RED on all five cells. The heading
> was falsified by this section's own stated precondition, which is recorded at the
> bottom of it. **Read §0.1 Corrections before anything below.**

Fix 5 is a **real defect, correctly fixed and mutation-proved**. It is **not** the
cause of these five cells.

**What fix 5 addressed: the supersede decision compared CLOCKS, not content.**
`outboxDrain.js:466` cleared a queued entry when
`isSupersededBaseline(entry.baseUpdatedAt, landedBaseline(noteRec))` — which is
`ta < tb` over two timestamps and nothing more — then reported *"a save this
browser landed is newer"*, which a reader takes to mean **the server already has
these words**. It never asked whether that landed save contained them.

```diff
-    if (isSupersededBaseline(entry.baseUpdatedAt, landed)) {
+    if (isSupersededBaseline(entry.baseUpdatedAt, landed)
+        && sameAuthoredContent(noteRec, entry.patch)) {
```

⭐ **Why fix 4 did not cover it.** `landedBaseline` refuses a DIRTY record, so
while the editor is mounted the invariant holds. Fix 4 keeps a record with unsent
work dirty — **but only where fix 4 decides.** The append door reconciles the
record clean by another path, so it arrived here with the protection already gone.
**Fix 4 was necessary and not sufficient.**

### Hypothesis status — REVISED after the 00:03 run

| # | hypothesis | status |
|---|---|---|
| 1 | the door never enqueues the typed words | ⛔ **KILLED** — stands. The trail shows `sentenceInQueuedEntry: True` at queue time, independent of fix 5 |
| 2 | the door settles the note from the server's post-embed copy | ⛔ **KILLED** — stands. Killed by *reading*, not by fix 5: `settleNoteWrite` only records the revision; it never touches body, dirty flag or intent |
| 3 | the three `→None` PUTs consume the entry | ⛔ **KILLED 2026-09-17, by the spy log.** The entry was still queued when the writer fired (`queuedBefore: 1`, spy call 1). One write consumes it, and it is not a PUT at all |
| 4 | the `+SENT` marker is trusted as delivery | ⛔ **KILLED 2026-09-17, by the spy log.** `persist` reads no marker. It reads `state.synced`, set by `markSynced` from `sameAuthoredContent(acked, current)` — the ack against the EDITOR'S OWN DOCUMENT. No marker is consulted on the path that empties the queue |
| 5 | ordering-independent, so not a race | ✅ **CONFIRMED 2026-09-17, with the right explanation at last.** It is ordering-independent because it is **not a race**: ONE transaction reconciles the record clean and takes `putNoteWithIntent`'s cursor-delete branch. Every ordering that ends with the editor settling loses the words, which is exactly what six identical orderings looked like |

⭐ **The pattern in that table is the lesson.** Every hypothesis killed by
*reading the code* survived. Every one killed by *reasoning from the fix* had to be
re-opened. The three re-openings share one root: I inferred what fix 5 would do
instead of measuring what it did.

---

## 0.1 Corrections, 2026-09-15 03:30

Three contradictions, recorded verbatim as raised.

**CONTRADICTION 1 — the causal claim is contradicted by the 00:03 run.**
The claim was that fix 5 *"was the root cause of five RED production cells on the
append route."* Measured: the 00:03 CT window ran unattended and completed
(`⇒ fix5-production-re-run: ok in 391.0s`, zero ANOMALY rows). The bundle carried
fix 5 — `1cf7b8c1d` is an ancestor of `origin/master`, the content-proof line is
present in master's copy of `outboxDrain.js`. The matrix reads
`| append_widget_embed | — n/a | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 |`. All five still RED.
Fix 5 is a real defect correctly fixed, but the root-cause claim is not supported.

**CONTRADICTION 2 — this document contradicted itself.**
§0 was titled *"✅ RESOLVED — Q1 fix 5"* and marked four of five hypotheses KILLED
on reasoning that assumed fix 5 was causal, while the same section stated:
*"⛔ The production re-run of the five cells against fix 5 has not been reported
yet. Until it is, fix 5 is proven at unit level and on the wire-trace reasoning,
NOT on the rig."* That run has now happened and came back RED, so the heading was
falsified by its own stated precondition.

**CONTRADICTION 3 — "the entry was cleared before any send ran" is denied by the
trail.** The 00:03 trail ends `queued 1 entry(s)` — an entry **survived**, so it
was not cleared. The load-bearing lines are instead `record went CLEAN while
queued: True` and `sentence left the durable record: True`, which describe the
**durable record** being wiped, not an outbox entry being superseded.

### The 00:03 trail, verbatim — `slow PUT` (the discriminating cell)

```
offline sentence in the server body: False
appended node present: True
queued 1 entry(s), baseline 2026-09-15T05:07:06.634032+00:00
3 request(s) carried the sentence (last -> None)
record went CLEAN while queued: True
sentence left the durable record: True
store trail: [(1, True, '32+00:00', True), (0, False, 'None', False)]
wire: POST /→200
    · POST /4eb21da35ccc4f1d90f0571cb5b62684/opened→200
    · PUT  /4eb21da35ccc4f1d90f0571cb5b62684[87+00:00]→200
    · POST /4eb21da35ccc4f1d90f0571cb5b62684/opened→200
```

### Timing proof that fix 5 was live for this run

| | |
|---|---|
| fix 5 deployed | ~`2026-09-15T04:31Z` (`1ceb3c5c2`, deploy `b774aaa2`) |
| run baseline | `2026-09-15T05:07:06.634032Z` |
| next deploy after it | `2026-09-15T05:30:52Z` |

The run sits between them. ⛔ Stated as timestamps rather than "the fix was live",
because that is the difference between a measurement and an assumption.

### Q1–Q3 — ✅ ALL THREE ANSWERED, each from an artifact

**Q1. What reconciles the durable record clean, while an entry is queued, on the
append route?**

✅ **`persist` at `useDurableNote.js:480`** — `q1AppendWriterCensus.test.jsx`,
spy call 1: `intent NULL`, `dirty 1 -> 0`, `queued 1 -> 0`,
`sentence-in-record true -> false`.

Fix 4 covers `settleLandedSave`, and **`markSynced` does not go through
`settleLandedSave` at all** — it calls `writer.schedule({...current, synced:
caughtUp})`, which lands in `persist`. So fix 4's guard was never on this path.
`putNoteWithIntent`'s own class guard did not fire either: it reads the record
it is *handed* (`else if (noteRecord.dirty)`), and a writer that flips dirty
1 → 0 in the same write walks straight past it.

**Q2. If an entry survives queued, why does the sentence never reach the
server?**

✅ **Neither branch. The entry does not survive.** The two candidates were "the
entry's `patch` no longer contains it" and "the drain never sends it"; the spy
log shows a third thing nobody had listed — the entry is *deleted*, in the same
transaction that marks the record clean, by `putNoteWithIntent`'s cursor-delete
branch. `sentenceInIntent` at spy call 1 is `NULL` because there is no intent.

⭐ And the drain never gets a chance: with the editor open the note is the
editor's (`excludeNoteId`), so the drain answers `SKIPPED` — visible in the
reproduction's own output. **Asking which of two send-path branches failed was
the wrong question; the send path was never reached.**

**Q3. Is the rig probe honest here?**

✅ **PASSED 2026-09-17** —
`docs/notebook/evidence/20260917T120331-2.1b-probe-honesty/`. It drives the REAL
probe (`QUEUED_JS` imported from `q1_f5_matrix.py`, never restated) against a
planted loss and a planted success, both with the record already CLEAN. The
"probe unverified" label comes off every RED reading.

### 0.2 The 04:03 window — 2.8b failed to MEASURE, twice (2026-09-15)

2.8b is fix 4's own production proof. It has now failed to yield a verdict three
times. **It is INCONCLUSIVE — not a pass, not a fail.**

```
=== WINDOW OPEN 04:03:03 CT · 1 staged ===
  2.8b-second-writer-while-away  INCONCLUSIVE (attempt 1, requeued) in 541.4s
      "could not create the probe note ({'err': 'HTTP 502'}) — nothing was measured"
  2.8b-second-writer-while-away  exit 124 in 1802.1s   <- TIMED OUT, no verdict
  queue empty — nothing staged
```

⭐ **The instrument behaved correctly on attempt 1** — it refused rather than
inventing a verdict, and the runner requeued rather than banking it. **Zero ANOMALY
rows**: the window was spent, it simply did not yield.

⚠️ **UNCONFIRMED explanation for the 502.** Master was pushed repeatedly overnight;
web deploys land at `05:10:54Z`, `05:30:52Z`, `06:00:56Z`, `06:32:54Z`, `06:38:04Z`,
and each push marks the previous deploy REMOVED and serves 502 through the swap.
The 04:03 attempt sits in that churn. ⛔ **I did not confirm this against logs** —
it is a plausible cause, recorded as unconfirmed rather than asserted.

⛔ **Q4, OPEN: why did attempt 2 hang for 1802s instead of refusing cleanly?**
A clean refusal at 541s and a 30-minute hang with no verdict are **not the same
failure**. It may be the instrument, the rig, or production. It is not diagnosed,
and the probe should refuse within a bounded time on any unmet precondition.

⚰️ **And the hang left the rig ALIVE.** Checked 2026-09-15 08:23: `SingletonLock`
was absent — which reads as "browser down" — while **nine chrome processes carried
the rig marker** (created 04:12, 04:41, 05:07) and leveldb `LOCK` was
permission-denied. **The opt-out key was not on disk at all.** An opted-in rig
gives the sampler a non-zero outbox and the Sunday gate reads that as product
state. ⭐ `SingletonLock` alone is NOT a liveness test — count processes by marker
and try to read the leveldb `LOCK`. Torn down by marker (9 → 0, owner's 18 Chrome
untouched), opt-out re-set through `window_check.opt_out`, verified on disk with
the browser dead.

### ⛔ Correction to §2 below

*"the door fires at call #7"* was **never a defect indicator** and should not have
been carried as one. Call #7 is the door's own `POST /embeds`; the rig counts it to
establish ordering, so *"sends carrying the sentence **before** the door: 0"* is
true **by construction**. The single real symptom was **zero successful sends
carrying the sentence at all**, which fix 5 explains completely: the entry was
cleared before any send ran (`clearOutboxEntry` then `continue`, skipping the
`send(entry)` block).

### Rails and mutation proof

`supersedeProvesContent.test.js` — written 2026-09-13, carried as the `expected_red`
reproduction, went **1 failed → 3 passed**.

⚠️ **Fix 5 shipped with no NEW rail**, because its reproduction already existed and
predated it. Mutation-proved afterwards rather than at commit time, which is the
weaker order and is recorded as such:

```
MUTATED  (content proof removed, clock-only restored)
  FAIL supersedeProvesContent.test.js > ⛔⛔ DOES NOT discard the member's words
       when the landed save lacks them
  Tests: 1 failed | 2 passed (3)      exit 1   <- the rail FIRES
RESTORED (captured bytes written back, byte-for-byte, never git checkout)
  Tests: 3 passed (3)                 exit 0   <- quiet
```

⭐ The first attempt at that proof **failed to mutate at all** — the match string
was LF-joined against a CRLF file — and printed `3 passed`, which would have read
as a passing mutated run. Two assertions caught it (`guard not found verbatim`,
then `nothing was mutated`). **A fixture that cannot create the failure is not a
test**, and that is the third instance of this shape in one session.

### Still outstanding

- ✅ **The production re-run HAS now been reported — and it came back RED 5/5.**
  See §0.1. Fix 5 is proven at unit level and mutation-proved; it is NOT the cause
  of these cells. R-1a's flip stays HELD.
- ⛔ **2.8b never ran** — the remount-with-server-moved-on scenario, fix 4's own
  production proof. Run it FIRST in the next window.

---

## 0.3 RETRACTION — the flip writer was never named (2026-09-15, owner rulings R-CITE / R-RAW / R-HON)

⛔⛔ **THREE REPORTS STATED THAT THE FLIP WRITER HAD BEEN NAMED. IT HAD NOT.**
The claim as carried was *"`persist` at `useDurableNote.js:444`, site 11 of 31,
named from the stack"*. Every part of that is wrong, and the correction is the
point of this section.

**What the evidence actually says** (agent census, this session's transcript,
quoted rather than paraphrased):

> "I censused all 8 non-test `putNoteWithIntent` callers; exactly three can
> produce the measured `(1, True, '85', False)` shape — `useDurableNote.js:286`
> (`settleLandedSave`, not-caught-up), `useDurableNote.js:402` (`persist`, fed by
> `NoteEditorPage.jsx:866` whose baseline is `:715`
> `lastSavedRef.current.updatedAt`), and `outboxDrain.js:75` (`settleSent`) — and
> every one needs the editor or the drain, not the door."
>
> "**Could not determine:** which of those three actually fired (needs
> instrumentation, not reading)."

So the true state is **a census of THREE candidates**, not a name:

| candidate | function | how it was reached |
|---|---|---|
| `useDurableNote.js:286` | `settleLandedSave` (not-caught-up) | census by reading |
| `useDurableNote.js:402` | `persist` | census by reading |
| `outboxDrain.js:75` | `settleSent` | census by reading |

⭐ **THE MECHANISM OF THE ERROR, because it is more useful than the error.** The
candidate set was produced by READING, correctly, and survived. What failed is
what happened to it **in transit between reports**: a three-way narrowing was
compressed to its most likely member, the qualifier was dropped, and a line
number from a *different* artifact (the AST call-site enumeration, where `:444`
is a real `putNoteWithIntent` site) was attached to it. Nobody measured anything
new; a hedge simply evaporated across a summary boundary. That is the inverse of
this programme's governing lesson — the reading survived, and an unmeasured
claim got welded onto it.

⛔ **2.1(b) PROBE HONESTY: NEVER RUN.** Zero mentions in the run log; the window
went straight to the instrumented cell. The probe has never been shown to report
a planted loss and a planted success correctly. **Every RED reading in the F5
matrix therefore carries the label "probe unverified" until it passes** — this
is not a caveat, it is an open gap underneath the evidence for all five cells.

⛔ **NO RAW RING EXISTS ON DISK.** There is no probe log, no matrix artifact and
no page dump holding a captured ring. The only `ring: N write` readings anywhere
are `ring: 2 write`, which is `--self-check`'s own planted pair.
**`sentence_lost_writes` has never been read from a real run.**

⭐ What IS measured about the sentence loss comes from the **store trail**, a
different instrument, recorded at `tools/q1_write_trace.py` (summarise()
docstring): `[(1, True, '47', True), (1, True, '39', False), (0, False, None,
False)]` — the words leave at t1→t2 while the record is STILL dirty and an entry
is STILL queued, and the dirty flip at t2→t3 carries `sentence_in_body` TRUE.
Two distinct events. That stands; the writer behind either does not.

### The three rules this produced (owner, 2026-09-15) — now standing rules

- **R-CITE** — any statement of a measured fact in a report or checkpoint cites
  its artifact: file path + line/key, or a commit hash. **No citation ⇒ the
  sentence is written as "not measured".** A census is reported as a census with
  its candidate count; **it never becomes a name in transit.**
- **R-RAW** — every rig run writes its raw ring and probe output to
  `docs/notebook/evidence/<run-id>/` **before any summary is computed**, and that
  directory is committed as evidence **before** interpretation. **A run with no
  raw artifact on disk is INCONCLUSIVE regardless of what the console showed.**
- **R-HON** — 2.1(b) probe honesty runs **FIRST** in the next window and is not
  skippable. Until it passes, every RED reading carries "probe unverified" in
  both this document and the matrix.

⛔ **And a STOP condition:** a report that names a writer without an evidence
path is itself a STOP — write the correction and end the turn. The only
acceptable form from here is
*"`<function>` at `<file:line>`, from `evidence/<run-id>/ring.json` entry N"*, or
*"not named; the ring showed X"*.

## 0.4 RETRACTION + 2.8c — the door guard is VERIFIED ON PRODUCTION (2026-09-17)

⚰️ **RETRACTED: "the production UI has moved under the rig's selector."** I wrote that after
six INCONCLUSIVE cells and it is false. I read the cell's own diagnostic sentence — *"the
control took the click but produced no call to `/embeds` — a label is not a door"* — as a
measurement. **It is a hypothesis the instrument formed**, and the measurement was on the line
directly above it, which I did not read.

### What the artifact actually says

`docs/notebook/evidence/20260917T122035-2.2-ring-on-the-drivable-door/raw.txt`, every cell:

```
queued: {... 'queuedForThisNote': 1, 'dirty': True,
         'sentenceInQueuedEntry': True, 'sentenceInDurableCopy': True, 'onLine': False}
door:   {'ok': True, 'via': 'Send to Journal → Current note'}
⇒ INCONCLUSIVE  ... produced no call to /embeds
```

⭐ **`ok: True` is not "a click happened".** `WIDGET_EMBED_JS` returns it ONLY after it (1)
finds `[aria-label="Send to Journal — choose where"]`, (2) clicks it, (3) enumerates the
chooser's options, (4) finds one matching `/^current note/i`, and (5) **clicks that option**.
Every one of those succeeded. The selector is intact and the member's real door was driven to
completion.

### 2.8c — the guard's production proof

The door fired into `sendCaptureToJournal(..., target: 'note')` on a note with **`dirty: True`
AND a queued entry**, and **no `/embeds` call followed**. That is `noteHasUnsentWork` returning
`{unsent: true, why: 'both'}` and the guard returning `STILL_SYNCING_MESSAGE` instead of calling
`t.run` — its exact contract, observed on production, six times.

✅ **D1's production proof.** The guard closes the member exposure on the live path.

⛔ **AND IT MEANS THE RIG CAN NO LONGER REPRODUCE THE LOSS ON PRODUCTION, BY DESIGN.** Every
append cell now stops at the mitigation. `fix5-production-re-run` got a real RED on 2026-09-15
because it ran BEFORE the guard shipped. **The tracer was never the variable, and neither was
the selector — the mitigation is.** Naming the writer has to move off the rig.

⚠️ **STATED, NOT SMOOTHED: the toast copy is NOT in the artifact.** The cell never looks for
rendered text, so `"This note is still syncing — try again in a moment."` cannot be cited from
this run. What is cited is the behavioural signature — door driven to completion, unsent work
present, no `/embeds`. The copy-contract string is asserted by
`doorDefersWhileUnsent.test.js`, not by this evidence. **A cell that cannot see the toast
cannot distinguish "the guard deferred" from "the door silently did nothing"** — they are
distinguished here only because the guard is the sole thing on that path that suppresses the
call. That gap is why the cell needs a fourth outcome.

### The five append cells are re-labelled

Not RED (nothing was lost) and not INCONCLUSIVE (something definite happened):
**DEFERRED-BY-GUARD — mitigated; loss path closed; fix 6 pending to restore the door.**

## 1. The symptom, in one paragraph

A member drives an **append door** (`Send to Journal → Current note`, from a
`/charts` widget) while offline, having typed words into the note. The appended
node — the widget embed — reaches the server. **The member's typed words do not.**
The durable record then goes clean and un-queued, so the "edit it again to sync"
surface never flags it and nothing offers the words back. This is the *same
symptom* Q1 fix 4 was built for — unsent member work discarded without the server
ever holding it — reached by a **different route**. Fix 4 closed the settle-side
and store-side discard, which is why all 24 metadata-door cells are GREEN; the
append path loses the words somewhere else.

---

## 2. The trail, verbatim

Rig profile used (the ONE signed-in profile, never recreated):
`C:\Users\Patrick\uct-worktrees\notebook-primary-platform\.worktrees\canary-chrome-profile-persistent`

Run: `2026-09-15T03:23:34Z`, against production on the deployed bundle carrying
fix 4 (`85e68247c`, Railway deploy `f15cb9c5`, web SUCCESS 22:05:50 CT).

### Verdicts

| family · ordering | verdict |
|---|---|
| `append_widget_embed` · settle-first | **N/A** — the product cannot reach this state; an append door records a landed revision and never settles with local state (`f5Freeze.test.js` asserts it from the source) |
| `append_widget_embed` · drain-first | 🔴 **RED** |
| `append_widget_embed` · marker LIVE | ⚠️ **INCONCLUSIVE** — outbox still held the entry after 120.0s; the drain had not finished, so a server read would measure the clock, not the product. *Not "lost"; not yet delivered.* |
| `append_widget_embed` · marker EXPIRED | 🔴 **RED** |
| `append_widget_embed` · slow PUT (landed, ring populated) | 🔴 **RED** |
| `append_widget_embed` · reload mid-flight (marker from a dead tab) | 🔴 **RED** |

### One cell in full — `slow PUT`, note `fd9e52863ca6474cabf0a4218482800c`

```
queued: {'entryStatus': None, 'entryAttempts': None, 'entryError': '',
 'entryKeys': 'mutationId,noteId,kind,patch,baseUpdatedAt,generation,sessionId,queuedAt',
 'locksHeldPending': '1/0', 'lockClaimable': True, 'onLine': False, 'outboxTotal': 2,
 'queuedForThisNote': 1, 'sentenceInDurableCopy': True, 'sentenceInQueuedEntry': True,
 'sentenceOnScreen': True, 'baseUpdatedAt': '2026-09-15T03:30:30.457416+00:00', 'dirty': True}

arranged: {'ok': True, 'arranged': 'landed ring carries the revision + an expired marker',
 'baseUpdatedAt': '2026-09-15T03:30:30.457416+00:00',
 'marker': {'sessionId': 'gone', 'startedAt': 1789443040596,
            'baseUpdatedAt': '2026-09-15T03:30:30.457416+00:00'},
 'ring': ['2026-09-15T03:30:30.457416+00:00']}

offline nav: {'path': '/charts', 'search': '', 'editor': False, 'offline': True}
door: {'ok': True, 'via': 'Send to Journal → Current note'}

store trail (queued, dirty, base, sentence-in-record):
    [(1, True, '16+00:00', True), (0, False, 'None', False)]

drain: emptied after 12.5s
looking for: "F5-MATRIX append_widget_embed slow PUT 2026-09-15T03-23-34Z the member's offline words"
stem 'F5-MATRIX' present: True · 'offline words' present: False

wire: POST /→200
    · POST /fd9e52863ca6474cabf0a4218482800c/opened→200
    · PUT  /fd9e52863ca6474cabf0a4218482800c[35+00:00]→200
    · POST /fd9e52863ca6474cabf0a4218482800c/opened→200
    · PUT  /fd9e52863ca6474cabf0a4218482800c+SENT[16+00:00]→None
    · PUT  /fd9e52863ca6474cabf0a4218482800c+SENT[16+00:00]→None
    · PUT  /fd9e52863ca6474cabf0a4218482800c+SENT[16+00:00]→None
    · POST /fd9e52863ca6474cabf0a4218482800c/embeds→200
    · POST /fd9e52863ca6474cabf0a4218482800c/opened→200
    · POST /fd9e52863ca6474cabf0a4218482800c/images→200
    · PUT  /fd9e52863ca6474cabf0a4218482800c[02+00:00]→200

the door fired after call #7; successful sends carrying the sentence before it: 0
forks: 0 · outbox left: 1 · conflicts: 0 · left the note: True · 64s
⇒ RED  offline sentence in the server body: False · appended node present: True
```

### The other cell ids, same run

`6a0ec961b6e340f7a59daaae63f17c5e` (drain-first) ·
`de2d36140f4746e09884552dfc1f40ac` (marker LIVE, INCONCLUSIVE) ·
`c0e24eeb0a334ac99192de7eaf980fce` (marker EXPIRED) ·
`4a4b8522b68747d6b86233ceb248ac43` (reload mid-flight)

⭐ **The shape is identical in all four REDs**: three PUTs carrying the sentence
return `None` (offline), the door fires at call #7, **zero** successful sends
carried the sentence before it, and the record transitions
`(queued=1, dirty=True, sentence present) → (queued=0, dirty=False, sentence gone)`.

---

## 3. A1–A3, answered from evidence

### A1 — 2.8b did NOT run. The DEPLOY row is incomplete.

The remount-with-server-moved-on scenario was specified to run **first** in the
rig window, before the five cells. It did not run: the window was spent going
straight to `--family append_widget_embed`. Measured, not recalled — the run log
contains **0** occurrences of "remount".

⛔ **Fix 4's own production proof is therefore still outstanding.** The DEPLOY row
for `85e68247c` cites 2.8a (CLEAN) and explicitly marks 2.8b pending. The next
session should run it and append the evidence to that row.

### A2 — PRE-EXISTING, not a regression. No rollback lever is pulled.

These cells were already RED on this same route **before** fix 4 shipped.

- Commit `43fcb9152` — *"F5 table: append_widget_embed is RED on ALL FIVE
  applicable orderings"* — predates fix 4.
- The matrix as of `73595654b` (pre-re-run) reads
  `| append_widget_embed | — n/a | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 |` with baselines
  `2026-09-14T05:18:53` … `05:44:09`, all before fix 4 deployed
  (`2026-09-15T03:02Z`).
- The trail is **byte-for-byte the same shape** pre- and post-fix: same
  `store trail: [(1, True, …, True), (0, False, 'None', False)]`, same
  `sends before the door: 0`.

⭐ **Consequence:** 2.1's Lever 2 signals are not in play. Lever 2 exists for a
failure *inside the fix-4 diff*; this is not one. **No rollback is pulled, and
pulling one would reinstate a real data-loss bug for no benefit.**

⚠️ Two differences worth noting, neither a regression: `outbox left` went 6 → 0/1,
and `marker LIVE` moved RED → INCONCLUSIVE (the drain had not finished within
120s). The INCONCLUSIVE is a *measurement* difference, not a product one — do not
read it as an improvement.

### A3 — Blast radius: a REAL member surface, and the loss is silent.

The door is `Send to Journal → Current note`, reachable from `/charts` widgets —
`AiSearchWidget.jsx`, `AlertsWidget.jsx`, `BreadthWidget.jsx`, `CalendarWidget.jsx`
and others, plus `pages/breadth/drill/drillWorkspace.js`. Wave Q1 is **live for
every member** (`notebook_offline_default_on: True`, verified on production
2026-09-14).

**What the member sees:** the embed they sent appears in the note and reaches the
server. Any words they had typed while offline are **gone from the server**, and
because the local record goes clean and un-queued, nothing marks the note as
pending and no recovery surface offers the words back. There is no error and no
banner. **It is silent.**

**Does fix 4 make it better, worse, or unchanged?** **Unchanged** on this route —
the trail is identical before and after. Fix 4 is strictly an improvement
elsewhere (24 metadata cells GREEN) and neither helps nor harms here.

---

## 4. What fix 4 shipping RULES OUT — do not re-investigate these

- **The settle-side remount discard.** `settleLandedSave`'s `unsentWork` guard is
  live on master (6 references in `origin/master:useDurableNote.js`). A dirty
  record is no longer reconciled clean on remount.
- **The store-side null-intent delete.** `putNoteWithIntent`'s dirty guard is on
  master and now rails at its own layer
  (`remountNeverDiscardsUnsent.test.js`). ⚠️ It was decoration until the gauntlet's
  M29 caught it — removing it reddened nothing.
- **A deploy-level fault.** 2.8a is CLEAN: 985 status-bearing lines in the first
  15 minutes post-boot, **all 2xx**, none ≥ 500, over an EXACT 2,780-line pull
  read by structured field.
- **The metadata doors entirely** — `folder`, `ticker`, `tags`, `hero`: 24/24 GREEN.

⛔ The remaining defect is in the **append** path specifically, between the door
firing and the drain, and it predates fix 4.

---

## 5. Reproducing ONE cell end to end

```sh
# the ONE signed-in profile — never create a new one, a fresh profile is SIGNED OUT
python tools/q1_f5_matrix.py \
  --family append_widget_embed \
  --ordering "slow PUT" \
  --profile "C:\Users\Patrick\uct-worktrees\notebook-primary-platform\.worktrees\canary-chrome-profile-persistent" \
  --out docs/notebook/wave-q1-f5-production-matrix.md
```

**Window constraints.** `UCT-WaveQ1-Observe` runs every 2 hours. The guard
(`q1_f5_matrix.rig_window_refusal`) refuses if a Q1 task is due within 60 min, is
Running, or STARTED within `JUST_RAN_COOLDOWN_SECONDS = 180`. Usable window is
roughly **60–90 minutes** between observer runs. Ask the guard, never the clock:

```python
import datetime as dt; m.rig_window_refusal(dt.datetime.now())   # None == CLEAR
```

⛔ **Rig hygiene, and the tool will warn you:** its opt-out restore can fail to
reach disk — a documented race where a `localStorage` write followed by an
immediate kill-by-marker is lost. If it says *"THE RIG IS NOT OPTED OUT"*, redo it
through `window_check.opt_out(page)` (its own function, never a second copy),
which forces a flush via a document running no app code, then verify **on disk with
the browser dead**. An opted-in rig gives the sampler a non-zero outbox and the
Sunday gate reads that as product state.

---

## 6. Hypotheses, ranked — NOT investigated

Each names the single observation that would confirm or kill it.

1. **The door's own write path never enqueues the typed words.** The embed POST
   (`/embeds`) and the note PUT are separate; the door may send the embed and
   settle the note from server-derived state without ever queueing the editor's
   buffer.
   *Confirm/kill:* does the outbox entry that exists at `queued:` time still exist,
   with the sentence, immediately **after** the door fires and before the drain runs?

2. **The door settles the note from the server's post-embed copy.** `/embeds`
   returns 200 and the server's revision moves; if the door then treats that
   revision as "landed" it can clear the record exactly as the pre-fix-4 settle did
   — the same mechanism one layer out, which fix 4 did not reach.
   *Confirm/kill:* is `settleNoteWrite` (not `settleLandedSave`) called on the
   `/embeds` response path, and does it pass server state as `acked`?

3. **The three `→None` PUTs consume the entry.** Three sends carrying the sentence
   all fail offline. If a failed send removes or blanks the entry rather than
   retrying it, the words are gone before connectivity returns.
   *Confirm/kill:* `entryAttempts` is `None` in the trail — does the drain
   increment attempts on a `None` response, or take a removal branch?

4. **The `+SENT` marker is being trusted as delivery.** The wire shows
   `PUT …+SENT[…]→None` — a marker raised before a send that never completed.
   *Confirm/kill:* does any path treat marker-raised as sent when the response is
   `None`?

5. **Ordering-independent by construction, so it is not a race.** All four REDs
   fail identically across four different arranged orderings.
   *Confirm/kill:* if a hypothesis above explains only one ordering, it is not the
   cause.

---

## 7. Standing rails the next session inherits

- **Read the manifest, not the exit code.** The task wrapper reported exit 0 for a
  gate that printed `1 NEW failure` *and* for one that printed
  `GATE INVALID: TREE DRIFT`. Uninformative in both directions.
- **Hand-read AND the fixed exit code on every manifest; they must agree.**
- **The gate judges the tree you push.** Never edit the repo mid-gate — that
  voided two runs in one session.
- **Both diff forms before a push.** Three-dot = what I changed; two-dot = has
  master moved. Fast-forward is answered from the two-dot.
- **Name tests by NODE ID, never `-k`.** A `-k` filter once selected a
  pre-existing unrelated test, missed one of three, and still totalled 3.
- **Regenerate, never `git checkout`**, and refuse when content matches neither
  captured nor mutated state.
- **Non-vacuity control on every rail** — a control that re-implements the
  predicate agrees with itself (R-05); share one predicate.
- **Clock guard:** master pushes refused 09:25–16:05 ET on a trading day.
  `UCT_DEPLOY_WINDOW_OVERRIDE` is logged and is not for convenience.
- **One gate at a time on this box.** Three concurrent gates once swept a
  worktree's `node_modules` to zero and destroyed its `.git`.
- **Classify a NEW failure by direction, and re-run a load-sensitive name alone**
  before treating it as a regression. Never bank a load-sensitive name.

---

## 8. Phase 3 backlog — DEFERRED, not dropped

Order: **1.B → four CRITICALs → HIGHs → 3.C → Task 5 → closing gate → 3.F.**
Push as **one batch**, tonight after fix 4 or after 16:05 ET.

| # | item | spec |
|---|---|---|
| 1.B | `tests/test_nb_gate_trigger4_ownership.py` | delete `_buckets` (`:114-123`), drive `gate.main()`, assert on `verdict.md` at 140/165/203/213/244. Prove with the harness: mutate `tools/nb_gate.py:714` to `in ('foreign','unknown')` → file RED → restore → green. The harness is hardwired to `gate-baseline.json`; parameterise the target file as its own commit first, then re-run Acceptance 1 once. |
| 3.A | `docs/discord-render/instruments/pod_upload.sh` | `set -euo pipefail`; trap cleanup of the partial `.b64` **on the pod**; compare local vs remote sha and fail on mismatch; no `echo`/`tail` as the last status |
| 3.A | `tools/_mutate_partner_fixes.py` | restore in `finally`/trap (pattern: `tools/mutation_check.py:161-164`) |
| 3.A | `tools/flipc_variant_patch.py` | `--revert` regenerates from a captured per-file copy taken at apply time, reverts ONLY the applied variant's files, refuses any file matching neither captured nor variant content. **Negative test:** apply a one-file variant, dirty `StockChart.jsx` with an unrelated edit, `--revert`, assert the dirty edit survives |
| 3.A | `tools/_mutate_path_risks.sh` | trap; `ROOT` from `git rev-parse`, never hardcoded; fix the `:54` literal |
| 3.B | `tools/flow_worker_watch_coverage.py` | "nothing to judge" and "could not resolve a base" must not be the same sentence + exit 0 |
| 3.B | `tools/_mutate_coach_chat_timeouts.sh` | `trap 'restore' EXIT INT TERM` — `restore()` exists and is correct, nothing binds it |
| 3.B | `tools/activate_notion_connector.sh` | trap that unsets the first Railway var on non-clean exit |
| 3.B | `docs/discord-render/instruments/step3_real.sh` | `--deliver-channel` with no id yields a non-empty flag string; the banner collapses two facts |
| 3.C | `tools/hub_trace_analyze.py` | `self_check()` must import `report()`'s bucketing + `FLICK_MS` instead of re-implementing them |
| Task 5 | `scripts/gate_shards.py` | promote `unexplained()` out of the test file; the gate refuses to start on an unexplained `expected_red`, naming the entry; `tests/test_gate_shards.py:651` imports it; the control keeps both directions; mutation proof re-run |
| 3.E | — | one closing gate, read by hand AND by the fixed exit code; both must agree |
| 3.F | — | restore CI visibility: install `gh` or fix the GitHub MCP `Authorization` header (the unexpanded `${GITHUB_PERSONAL_ACCESS_TOKEN}` signature). Lowest priority |

⛔ **The W.2 / W.3 patch drafts were never written.** They were scoped to be
drafted in scratchpad while a gate ran; that time went to R1–R3 and the push
instead. The specifications above are complete enough to work from, but **there is
no draft code to copy**, and `docs/notebook/phase3-drafts/` is deliberately not
created rather than created empty. Stating this rather than leaving a reader to
discover it.


---

## ✅ FIX 6 — a clean write must prove the record had nothing left to say

**Designed, railed, mutation-proved and committed on `feat/notebook-kill-switch`
2026-09-17. ⛔ NOT PUSHED — the push is RESERVED to the owner.**

### The mechanism

`putNoteWithIntent` deletes every queued entry for a note when the record it is
handed is CLEAN and the intent is null — the cursor-delete branch. That is right
when the note really has nothing left to say, and it is the entire defect when
it does.

`persist` decided that from `state.synced` alone, and `state.synced` comes from
`markSynced`, where `caughtUp = sameAuthoredContent(acked, current)` — **the
server's ack compared against the editor's own in-memory document.** Words that
live in the durable record and the queue but not in the editor's document are
invisible to that comparison. That is exactly the state an offline session
leaves behind, which is why the append route and only the append route showed it.

### The fix is an EXTRACTION, not a second guard

`discardsUnsentWork(prev, incoming)` now lives in `recoverLocalState.js` beside
`sameAuthoredContent`, and **both `settleLandedSave` and `persist` ask it.**

⛔ The same invariant previously had one implementation and one hole, and the
hole was invisible *because* the other copy read as coverage for both. A second
copy in `persist` would have re-created that
(`lesson_a_guard_repeated_is_a_guard_unproved`).

When a write would discard unsent work, **the durable copy wins** — the same
resolution `settleLandedSave` already used: keep the member's body, keep
`dirty`, keep the record's own baseline, keep an intent carrying it. The entry
then 409s and the drain runs classify-then-rebase/merge/fork, which is the path
**2.8b measured GREEN on production** and the path the reproduction's control
case exercises.

### What the rail proves

| | |
|---|---|
| rail | `q1AppendWriterCensus.test.jsx` — the STEP 2 reproduction, now green |
| non-vacuity control | the sibling case in the same file drives the SWEEP and was **green before the fix and after it**. This fixture is not always-red |
| real modules | `openNotebookDb`, `putNoteWithIntent`, `drainOutbox`, `settleSent`, `rebaseEntry`, `settleNoteWrite`, `recordLandedRevision`, `sendNoteUpdate`, `serverCopyIsOursDefault`, `forkConflictedCopy`, `CAPTURE_TARGETS.note.run` — all unmocked |
| mutation M1 | fix 6's own line reverted → reproduction RED, control GREEN |
| mutation M2 | `discardsUnsentWork` always false → **3 RED**, two of them fix 4's rails (`remountNeverDiscardsUnsent`, `selfForkDoors`). One authority, one mutation, both fixes fall |
| restore | byte-for-byte, sha256 verified both files; 29 files / 384 tests green |

### §10.36 class sweep — `tools/q1_clean_write_sweep.mjs`

An acorn parse, never a grep. **8 call sites; 5 can empty a queue.** Judgement
per site, with the reason:

| site | verdict |
|---|---|
| `outboxDrain.js:75` `settleSent` | **PROVES** — `sameAuthoredContent(rec, entry.patch)`, and the send had just succeeded |
| `outboxDrain.js:98` `settleForked` | **SAFE** — reached only after `fork()` returned, so the words are in the conflicted sibling |
| `outboxDrain.js:101` `settleForked` | **SAFE** — same |
| `useDurableNote.js:335` `settleLandedSave` | **PROVES** — Q1 fix 4, now through the shared authority |
| `useDurableNote.js:480` `persist` | ⛔ **THE DEFECT** — proved nothing. Fixed |

⚰️ The sweep's first version reported `persist` as safe, because it analysed the
argument *expression* and both arguments there are locals. A kind-2 proxy inside
the tool written to find this class. It now resolves a local binding one hop,
treats anything it cannot resolve as **UNRESOLVED rather than safe**, and
`--self-check` plants that exact regression.

### 3.4 — the guard release condition

> **The door guard STAYS, and narrows only after fix 6 is proven on production.
> It does not come out when fix 6 ships.**

The reasoning, and the two halves are different:

- **Until fix 6 ships**, the guard is the only thing standing between a member
  and a silent loss. Not a question.
- **After fix 6 is proven on production**, the guard should **narrow to
  UNKNOWN-only** — defer when the store cannot be opened or read — and stop
  deferring on `dirty` / `queued`. Reason: with fix 6 live, a dirty record with
  a queued entry is *safe to capture into*, because the clean write can no
  longer discard it; continuing to defer there costs the member a real capture
  ("try again in a moment") for a hazard that no longer exists. `UNKNOWN` is
  different — an unreadable store means the answer is genuinely not known, and
  the cost of a wrong pass is still the member's words.
- ⛔ **"Proven on production" is not "shipped".** It means the five append cells
  read GREEN on the rig with fix 6 live *and the guard already narrowed* — the
  guard cannot be released on evidence gathered while it was still deferring,
  because that evidence is about a route nobody reached.

⚠️ Belt-and-braces is NOT the recommendation here, and that is deliberate: a
guard kept "just in case" past its cause is how a false defer becomes permanent
furniture nobody can justify removing later.

### 3.5 — the push plan (the push itself is RESERVED)

| | |
|---|---|
| commits | `0e22baf06` (reproduction) · `acd757574` (fix 6) · `1524c39a6` (W1) · `d76556078` (W2 staged) |
| product files | **two** — `useDurableNote.js`, `recoverLocalState.js`; 86 insertions, 6 deletions |
| carry-over | C0–C5 per `tools/gate_carry_over.py`. ⛔ **C4-python is MANDATORY** — this branch touches `tools/` and `docs/`, and a C0 hit never short-circuits the Python half |
| guard slot | announce before pushing; recency ≥600 s settled and burst <3 distinct web deploys in 60 min. ⛔ The guard has a ~3.5 min blind window by construction — do not calibrate a wait on it |
| verification | own deploy record STATUS (`SUCCESS`, not someone else's pod), then `production` ancestry by `git merge-base --is-ancestor`. **Never an uptime you did not tie to a named deploy** |
| after | the rig re-run of the five append cells with the guard narrowed — that, not the push, is what closes D3 |

⛔ **Is the guard sufficient until fix 6 ships?** Yes, and it is proven six times
on production (2.8c, `evidence/20260917T122035-2.2-ring-on-the-drivable-door/`):
door driven to completion, unsent work present, no `/embeds` call. That is why
fix 6 is not urgent enough to justify pushing it outside the owner's word.


---

## ✅ THE CHAIN — fix 4 → fix 5 → the guard → fix 6, and what each one actually closed

**Four changes, and only the last one is the root cause. The first three are worth
reading precisely because each looked sufficient at the time.**

| # | what it changed | what it ACTUALLY closed | why it was not enough |
|---|---|---|---|
| **fix 4** `85e68247c` | `settleLandedSave` keeps a DIRTY record dirty and never overwrites it from a server-derived copy | the editor's own ack path, where the door's landed revision meets unsent work | ⛔ **It guards where IT decides.** `markSynced` does not route through `settleLandedSave` at all — it goes to `persist`, which had no such guard. Fix 4's protection was real and its REACH was one function wide |
| **fix 5** `1ceb3c5c2` | the drain refuses to supersede an entry unless the landed save PROVABLY contains its content | the `isSupersededBaseline` clear, which had been reading *"a save this browser landed is newer"* as *"the server already has these words"* | ⛔ Necessary, not sufficient. `landedBaseline` refuses a DIRTY record, so fix 5 only ever fires where the record is clean — and the append door reconciled the record clean **by another path** before the drain ever looked |
| **the door guard** `noteHasUnsentWork` | `sendCaptureToJournal` DEFERS while a note has unsent work | the member's ability to REACH the loss at all — thirteen capture doors, one chokepoint | ⭐ A **mitigation, not a fix**. It closed the door without naming what was behind it, and it is why the rig stopped being able to reproduce the defect at all (D1). That was the right trade and it also became the obstacle: the instrument could no longer see the thing it was hunting |
| **fix 6** `8568d13ad` | `discardsUnsentWork` — ONE authority, asked by BOTH `settleLandedSave` and `persist` | ⭐⭐ **the writer.** `persist` at `useDurableNote.js:480` wrote `dirty 1 → 0` with a NULL intent, taking the queue with it in the same transaction | — |

### ⭐ The pattern across all four, which is the transferable part

Fix 4 and fix 5 were **both correct** and **both insufficient**, for the *same*
reason in two costumes: each fixed the instance it could see, at the layer it was
already standing in. Fix 4 guarded one function; fix 5 guarded one branch of the
drain. Neither asked *"what is the CLASS, and where else does it live?"*

Fix 6 is the first one that asked. The §10.36 sweep found **8 call sites, 5 able
to empty a queue**, and judged each with a reason — which is how `persist` stopped
being one of three census candidates and became a name.

⛔ **And the guard that was supposed to catch all of them could not.**
`putNoteWithIntent` carries an explicit class guard — *"a null intent is not
permission to delete unsent work"* — written `else if (noteRecord.dirty)`. It reads
the record it is **handed**, so a writer that flips `dirty 1 → 0` in the same
write satisfies the `else` and takes the delete branch. Correct, documented,
mutation-proved at its own layer, and structurally unable to see the case it was
written for.

### What made the difference, stated plainly

Three sessions read this code and produced a census of three candidates. What
named the writer was **one instrument**: a pass-through spy on the real
`putNoteWithIntent`, driving the REAL modules, with the loss reproduced. The
census was right the whole time and stayed a census because nothing had ever
watched those three sites fire.

> **A hypothesis dies by reading or by measurement. This one needed measurement,
> and two days were spent proving that by trying everything else.**
