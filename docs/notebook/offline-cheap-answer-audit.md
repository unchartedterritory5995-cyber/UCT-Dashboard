# Wave Q1 — THE CHEAP-ANSWER AUDIT of `lib/offline/`

> **The pattern, in the owner's words:** *a cheap answer given priority over an
> available expensive one.*
>
> Concretely: every decision point in the offline layer where a **TIMESTAMP**, a
> **COUNT** or a **FLAG** answers a question that **THE CONTENT** could answer.
> The cheap proxy is consulted because it is at hand; the authoritative answer is
> available — usually already imported into the same file — and is not asked for.

## Scope and method

- Read: every non-test `.js` in
  `app/src/pages/journal-2-0/lib/offline/` — **21 files**
  (`baseline` · `blockedBaselineEvent` · `blockedNotes` · `configServedEvent` ·
  `currentAccount` · `durableWriter` · `inFlight` · `notebookDb` ·
  `notebookFlags` · `offlineFlag` · `offlineOptInEvent` · `outboxDrain` ·
  `outboxLeader` · `recoverLocalState` · `serverChange` · `settleNoteWrite` ·
  `telemetry` · `unsyncedCopy` · `useBlockedNotes` · `useDurableNote` ·
  `useOutboxDrain`). Tests in the same directory were read for intent only.
- Read outside the directory, to trace instance 4 to its call site:
  `components/notebook/NoteEditorPage.jsx`, and
  `lib/offline/supersedeProvesContent.test.js`.
- **Added 2026-09-14 — instance 5, which is not in this directory at all.** Read for it:
  `docs/notebook/q2a-implementation-plan.md` on the **Q2-A worktree**
  (`C:\Users\Patrick\uct-worktrees\notebook-q2a`), plus the same offline files above, to
  confirm the mechanism that plan describes is real in the code as it sits here.
  ⛔ **That plan is not in this tree** — its quoted invariant is attributed to the file and
  the worktree it lives in, never to a path a reader of this checkout can open.
- ⛔ **No test was run, no git command was issued.** Every LIVE/FIXED verdict
  below is read off the source as it sits on disk in this worktree
  (`outboxDrain.js` mtime 2026-09-13 08:42, `supersedeProvesContent.test.js`
  mtime 2026-09-13 17:30), plus what a file states about itself. A claim that
  needed a run to settle is marked UNKNOWN in the last section rather than
  guessed. ⛔ **PRE-EMPTED (instance 5) is the one verdict that is NOT read off a
  product state, and its row says so:** it is a claim about a plan, and it becomes a
  measurement only when Q2-A ships with its rail mutation-proved.
- ⛔ Every `file:line` below was quoted from the file at audit time. Nothing is
  cited that could not be quoted.

---

## SITE LIST

`CONFIRMED` = the pattern. `NEAR MISS` = a cheap answer is consulted and is
genuinely sufficient (reason given). `NOT AN INSTANCE` = a real decision point
that does not exhibit the pattern at all.

### CONFIRMED

| # | file:line | the question being decided | the cheap answer actually consulted | the authoritative answer that was available | quoted line | state |
|---|---|---|---|---|---|---|
| C1 | `outboxDrain.js:467` | may this queued entry be **deleted** as already-landed? | a **TIMESTAMP** comparison of two baselines | `sameAuthoredContent(...)` — already imported in this file at line 21 — against the landed/server copy | `if (isSupersededBaseline(entry.baseUpdatedAt, landed)) {` | **LIVE** |
| C2 | `baseline.js:87` | the comparison C1 rests on | two parsed **TIMESTAMPS**, nothing else | the two documents themselves | `  return ta < tb` | **LIVE** |
| C3 | `useDurableNote.js:388`→`:402` | is anything still owed to the server for this note? | the record's own **FLAG** (`record.dirty`, set from `state?.synced` at `:381`) | the queued entry's `patch` vs what the server holds | `      const intent = record.dirty` … `      await putNoteWithIntent(db, record, intent)` | **LIVE** |
| C4 | `useDurableNote.js:259`→`:276`→`:286` | same question, on the mount-independent settle | the `caughtUp` **FLAG**, derived from `acked` vs `current` — a fact about the **editor**, used as a fact about the **queue** | the queued entry's `patch` vs what the server holds | `    const caughtUp = sameAuthoredContent(acked, current)` … `    const intent = caughtUp ? null : {` | **LIVE** |
| C5 | `useDurableNote.js:476` | is there local work to offer the member back on reopen? | the record's **FLAG** (`rec.dirty`) — the outbox is never read | the queued entry's content vs the server copy, one store away in the same database | `        idbRecord = rec && rec.dirty ? rec : null` | **LIVE** |
| C6 | `outboxDrain.js:412` | may this entry be **removed** after the pre-send ours-check? | historically `mine.ours` alone — a revision **ID** in the landed ring | `mine.identical`, i.e. `sameAuthoredContent(server, entry.patch)` (`useOutboxDrain.js:73`) | `        if (mine?.ours && mine.identical) {` | **FIXED** |
| C7 | `outboxDrain.js:516` | the same question on the 409 path | as C6 | as C6 | `          if (mine?.ours && mine.identical) {` | **FIXED** |
| C8 | `outboxDrain.js:440` | the ring vouched — rebase, merge or fork? (pre-send) | historically `mine.ours` — a revision **ID** — decided the plan before the diff was read | `classifyServerChange(fresh, base)` on the two documents (`serverChange.js:127`) | `          const ring = ringVouchedPlan(mine, noteRec)` | **FIXED** |
| C9 | `outboxDrain.js:532` | the same question on the 409 path | as C8 | as C8 | `          const ring = (mine?.ours && !retriedRebase)` | **FIXED** |

**9 CONFIRMED sites** (counted off the rows above) — C1+C2 (instance 1), C8+C9
(instance 2), C6+C7 (instance 3), C3+C4+C5 (instance 4). C1/C2 are also the
terminal discard of instance 4.

⛔ **Instance 5 below has no row in this table and cannot have one.** It was caught
in a PLAN, before the code existed to cite, so the site list — which is scoped to
`lib/offline/` as it sits on disk — has nothing to point at. **No total is typed
for the instances here on purpose:** diff the `### N —` headings in the next
section against this table rather than trusting a number beside either.

### NEAR MISS — a cheap answer is used, and it is sufficient

| # | file:line | the question | cheap answer | why it is sufficient | quoted line |
|---|---|---|---|---|---|
| N1 | `baseline.js:61` | is this record's baseline a **landed** save? | the `dirty` **FLAG** | Sufficient *for what it claims*: `dirty: 0` is the record's own durable statement that the server holds **this record's** content, written by the code that got the ack. ⛔ It is **not** sufficient for what C1 reads it as — "the server holds this **note's queued work**" — which is why the same flag appears on the confirmed side. The defect is at the use, not here. | `  if (!record || record.dirty) return null` |
| N2 | `outboxDrain.js:383` / `inFlight.js:216` | is a save on the wire for this note right now? | a **TIMESTAMP** + TTL | No content anywhere can answer "did we ask" — the fact lives in an in-flight promise (`inFlight.js:28-32`). The precise answer (the Web Locks holder set) *is* consulted where available, demote-only (`inFlight.js:217-222`), and expiry never discards: it routes to `askServerIfOurs` (`outboxDrain.js:408-411`). | `    if (isMarkerLive(marker, { holders, ttlMs })) {` |
| N3 | `useOutboxDrain.js:79` | did **we** write the revision that blocks us? | a revision **ID** in a 5-deep ring | Content cannot answer authorship: once the member keeps typing after a save lands, the bodies differ by construction. And since fix 3 this answer no longer decides removal (needs `identical`) or plan (needs the classifier) — it answers only "nobody else wrote this". | `  if (landed && landedRevisions instanceof Set && landedRevisions.has(landed)) {` |
| N4 | `outboxDrain.js:49` (the `!rec` half) | did the note catch up with what we just sent? | **ABSENCE** of a record | The send has just succeeded on the line above, so the server provably holds `entry.patch`; with no local record there is nothing newer to preserve. And absence here is real absence — `getNote` resolves `null` only on a missing key and **rejects** on a store error (`notebookDb.js:167-173`), so an unreadable layer cannot read as an empty one. | `  const caughtUp = !rec || sameAuthoredContent(rec, entry.patch)` |
| N5 | `recoverLocalState.js:110` / `:129` | which local copy is the member's newest work? | a **COUNT** (generation), then a **TIMESTAMP** | Two copies that differ cannot be ordered by their content at all. The exact answer (generation within one session) is preferred first; the timestamp branch returns `ambiguous: true`, and the surface offers rather than applies (`useDurableNote.js:466-470`). | `  const withTime = local.filter((c) => c.at != null)` |
| N6 | `outboxLeader.js:76` | is this tab the sync leader? | a **CLOCK** (2 s) | The lock callback is the real answer and is still awaited; the timer only decides the *unanswered* case, and it decides it as FOLLOWER — the direction that delays rather than races. | `    timer = setTimer(() => settle(FOLLOWER), decideAfterMs)` |
| N7 | `serverChange.js:57-59` | is this appended block one the document already holds? | an identity **KEY** over a named subset of `attrs` | The expensive answer is *measurably wrong here*: a live ProseMirror node carries schema defaults the stored JSON does not, so whole-`attrs` equality would call every embed "missing" and duplicate it (`serverChange.js:48-53`). | ``  widgetEmbed: (a) => `${a?.widgetId}\|${a?.capturedAt}\|${a?.searchText}`,`` |
| N8 | `durableWriter.js:83` | may this completion mark newer work durable? | a monotonic **COUNT** | Write ordering is not derivable from content; the count only ever moves forward, so a late callback can neither mark newer work durable nor resurrect older work. | `      committed = Math.max(committed, job.generation)` |
| N9 | `outboxDrain.js:95` | may the working copy be overwritten with the server's after a fork? | a null/shape test | It is a test **of** content, not a proxy for it, and it fails in the preserving direction — an honest stale body beats an empty one (`outboxDrain.js:82-94`). | `  const usable = serverNote && (serverNote.bodyJson != null \|\| serverNote.title != null)` |

**9 NEAR MISSes.**

### NOT AN INSTANCE

| file:line | why not | quoted line |
|---|---|---|
| `outboxDrain.js:292` / `blockedNotes.js:19` | the flag **is** the decision, recorded once by `settleBlocked` (`outboxDrain.js:130`); re-deriving it is explicitly forbidden. No content question, and nothing is discarded. | `    if (entry.permanent) {` · `  return entry?.permanent === true` |
| `outboxDrain.js:310` | a shape test of the compare-and-set value itself. Content cannot say whether a CAS exists, and the outcome keeps every word. | `    if (!isUsableBaseline(entry.baseUpdatedAt)) {` |
| `serverChange.js:137` (and `:104-117`) | this **is** the expensive answer the pattern says should be asked. | `  if (json(fresh.bodyJson) === json(base.bodyJson)) return METADATA_ONLY` |
| `useDurableNote.js:450` | content, and correct about the pair it compares; it appears on the confirmed side (C4) only for the third document it is used to decide. | `    const caughtUp = sameAuthoredContent(acked, current)` |
| `useOutboxDrain.js:288` | a count decides whether a pass **runs**, never an outcome. | `    const timer = setInterval(() => { if (pendingRef.current > 0) drainNow() }, intervalMs)` |
| `offlineFlag.js:72-89` / `notebookFlags.js` | flags answering "may this layer run"; there is no content that could answer it, and §21 makes OFF mean *stop processing*, never *discard*. | `export function offlineEnabled(storage = globalThis.localStorage) {` |
| `notebookDb.js:53` + `useDurableNote.js:335-338` | `persisted` is a wording input, explicitly never a gate. | `export async function storagePosture(nav = globalThis.navigator) {` |
| `configServedEvent.js:61`, `offlineOptInEvent.js:66`, `useBlockedNotes.js:94` | instrument dedupe and render economy, not product decisions. | `  if (reportedThisTab) return null` |

---

## THE INSTANCES, ONE BY ONE

### 1 — `isSupersededBaseline`: a clock deciding that words are already on the server — **LIVE**

The drain deletes a queued entry here:

```js
    const landed = landedBaseline(noteRec)
    if (isSupersededBaseline(entry.baseUpdatedAt, landed)) {
      await clearOutboxEntry(db, entry.mutationId)
```
— `outboxDrain.js:466-469`

and the whole test is two parsed timestamps:

```js
  return ta < tb
```
— `baseline.js:87`

The outcome is then reported in words that describe a **content** fact:

```js
        reason: `a save this browser landed at ${landed} is newer than this entry's baseline ${entry.baseUpdatedAt}`,
```
— `outboxDrain.js:474`

**What the cheap answer cannot see:** whether the save that landed at `T2`
contains the words queued at `T1`. A revision moving forward proves only that
*something* was written — a folder change, a ticker, a hero image, a widget the
server appended on its own behalf. Seven server-side functions advance
`updated_at` through nine routes (PROGRAM-MANIFEST §10.13); exactly one of those
shapes implies "your body is now on the server". `ta < tb` cannot distinguish
them, and the branch it guards is the only one in the file that **destroys**
member work rather than preserving it (`clearOutboxEntry`, no fork, no block, no
record kept).

The expensive answer is in the same file: `sameAuthoredContent` is imported at
`outboxDrain.js:21` and used four lines into `settleSent`; the last-known server
copy is available through `lastKnownServerCopy(noteRec)` (`serverChange.js:206`),
which the 409 path already uses.

### 2 — Q1 "fix 3": the landed ring answering before the diff was read — **FIXED**

The source states the defect in its own words:

```js
 * WHAT IT COST: "ours => rebase" ran before the diff was ever read, so when the
 * server's change was an APPEND (a widget sent to the journal, a saved price, a
 * PDF excerpt) the member's queued body was re-sent over it and the captured
 * block was gone. The append-only merge existed and was UNREACHABLE for any door
 * this browser fired, because a door we fired is always in the landed ring.
 * Measured across seven families x six orderings: 24/24 metadata green, 0/18
 * append.
```
— `outboxDrain.js:156-163`

The fix is one authority asked at both sites, and it classifies first:

```js
function ringVouchedPlan(mine, noteRec) {
  const base = lastKnownServerCopy(noteRec)
```
— `outboxDrain.js:171-172`, called at `:440` (pre-send) and `:532` (409).

**What the cheap answer could not see:** *what changed*. The ring knows **who**
wrote the revision; only the diff knows **what** they wrote. PROGRAM-MANIFEST
§10.11 generalises it exactly as the owner's pattern does — *"a guard that
ANSWERS EARLY is a guard that decides on less evidence than the system has …
Ordering the cheap answer first meant the expensive one was never asked."* The
fix was not to weaken the ring but to stop it deciding.

### 3 — "ours ⇒ remove": a revision id deciding that the server holds the words — **FIXED**

The third instance is recorded in the source, not invented here:

```js
  // ⚰️ "Ours ⇒ remove" is what discarded a member's offline sentence on
  // 2026-09-10: a folder change we made moved the revision, the ring said the
  // server copy was ours, and the entry was deleted even though the server body
  // did not contain the queued words.
```
— `useOutboxDrain.js:65-68`

The cheap answer was `mine.ours` — a revision **ID** present in the landed ring.
The expensive answer is the body comparison that now produces `identical`:

```js
  if (sameAuthoredContent(server, entry.patch)) {
```
— `useOutboxDrain.js:73`

and removal is now gated on it at both call sites:

```js
        if (mine?.ours && mine.identical) {
```
— `outboxDrain.js:412` (pre-send) and `:516` (409), each commented *"REMOVED
ONLY BECAUSE THE SERVER BODY IS PROVEN TO CONTAIN THESE WORDS"* (`:413-414`).
"Ours but not identical" now **rebases** (`outboxDrain.js:425-456`).

**What the cheap answer could not see:** that "we made this revision" and "this
revision carries these words" are different claims. Every door fired by this
browser makes the first true and leaves the second untouched.

### 4 — **"remount when the server has moved discards local state without proving the server holds it"** — **LIVE, under measurement**

The owner's sentence, verbatim, is the defect. The chain, as far as the source
supports it:

1. The editor remounts and rebuilds from the server copy —
   `lastSavedRef.current` is set from `note` (`NoteEditorPage.jsx:655-660`), the
   server's revision, which does **not** contain whatever is still queued.
2. A save from that state acks, and `acked` and `current` are both that server
   state, so the caught-up test is true:
   ```js
       const caughtUp = sameAuthoredContent(acked, current)
   ```
   — `useDurableNote.js:259` (`settleLandedSave`), and the same comparison at
   `:450` (`markSynced`).
3. The record is rewritten **CLEAN at the newer baseline**, and the intent is
   nulled:
   ```js
         dirty: caughtUp ? 0 : 1,
   ```
   ```js
       const intent = caughtUp ? null : {
   ```
   — `useDurableNote.js:270` and `:276`; the debounced editor path reaches the
   same shape through `dirty: state?.synced ? 0 : 1` (`:381`) and
   `const intent = record.dirty` (`:388`).
4. A null intent is a **deletion of every queued entry for that note**, in the
   same transaction:
   ```js
     if (outboxEntry) {
       outbox.put(outboxEntry)
     } else {
       const idx = outbox.index('byNote')
       const cursorReq = idx.openCursor(IDBKeyRange.only(noteRecord.noteId))
   ```
   — `notebookDb.js:153-157`. And because the key is deterministic —
   ``export const outboxIdFor = (noteId) => `note:${noteId}` `` (`useDurableNote.js:59`)
   — a **non-null** intent is not gentler: it *replaces* the queued entry's words
   with whatever the editor now holds, at the same primary key.
5. Whatever survives to the drain meets instance 1: the record is now clean at a
   newer baseline, `landedBaseline` therefore vouches for it
   (`baseline.js:61` returns the baseline only for a clean record), and
   `isSupersededBaseline` deletes the entry on the clock alone
   (`outboxDrain.js:467`).

The rail that drives this is already in the tree and says so:

```js
 * ⭐ WHAT NORMALLY PROTECTS IT: `landedBaseline` refuses a DIRTY record, so
 * while the editor is mounted and the queued entry is its own pending state the
 * invariant holds. The protection disappears the moment the record is
 * reconciled CLEAN at a newer revision
```
— `supersedeProvesContent.test.js:15-19`, whose header also states
*"MODE: these cases DRIVE the defect. The first one is expected to FAIL against
today's drain — that failure is the finding, not a broken test."* (`:27-29`).

**What the cheap answer cannot see:**

- **`dirty: 0` is a statement about the RECORD, and it is being read as a
  statement about the NOTE.** Three documents exist at that moment — the server
  copy, the record, and the queued entry — and the reconciliation compares the
  first two. The third is discarded on the strength of a comparison it was never
  part of.
- **A newer baseline is not a superset.** The record's baseline advanced because
  the *server* moved, not because the queued words reached it.
- **The member is not offered the words either** (see C5, below): the recovery
  banner is gated on `rec.dirty`, which the same reconciliation has just set to
  0, and no recovery path reads the outbox. The discard is therefore silent on
  both surfaces.

The only content proof that would close it is the one the layer already knows how
to compute: `sameAuthoredContent(entry.patch, <what the server holds>)` — the
exact test the 409 path calls `identical`, applied one guard earlier, with the
control that a genuinely-contained entry must still be cleared
(`supersedeProvesContent.test.js:99-115` already carries that control).

### 5 — **a cache refresh moving the baseline because "the server told us something newer"** — **PRE-EMPTED: caught at plan stage, no code was ever written**

⭐ **This one is different in kind from the four above, and the difference is the finding.**
Instances 1–4 were read out of SHIPPED code — the pattern was already running, and two of
them are recorded IN THE SOURCE as having destroyed a member's words before anyone named the
class (`outboxDrain.js:156-159` for instance 2, `useOutboxDrain.js:65-68` for instance 3:
*"what discarded a member's offline sentence on 2026-09-10"*). This one was found in a **plan**:
Wave Q2-A's offline READ cache, at spec stage, with nothing built. It is ruled out of the
design by owner ruling 2026-09-14 rather than fixed after the fact.

⛔ **It therefore has no row in the SITE LIST above, and that absence is the point** — there
is no site, because there is no code. It is recorded here because the pattern is identical
and because a plan is the cheapest place this family has ever been caught.

**The cheap answer it would have given.** Q2-A caches the server's copy of a note so the
member can read it offline. A refresh is a plain `GET` — no member intent anywhere in it.
The proposed design let that refresh move the write path's baseline, on the reasoning that
**the server told us something newer**: a REVISION moved, so the on-device idea of "what
the server holds" should move with it. That is a **TIMESTAMP/REVISION fact about the
transport**, used as a fact about **which words the server is holding**.

**The authoritative answer that was available.** The same one instances 2 and 3 ended on:
the documents. `classifyServerChange(fresh, base)` is already in the file the refresh would
have written through, and the drain already calls it. Had the base stayed the last thing the
server told us *before the member started typing*, the classifier would have read a body
rewrite and forked.

**The trap is written into the source, one sentence above the function it governs:**

> "⭐ A DIRTY RECORD CARRIES `serverBase`: what the server told us, captured at
>  the clean→dirty transition and moved forward every time the server tells us
>  something newer (an ack, a successful drain send) …"
> — `serverChange.js:185-187` (quote truncated mid-line 187; the sentence continues
>   *"It costs one extra body per UNSYNCED note"*)

Every event in that parenthesis is an **ack of a write this browser made**, and so is every
writer that exists: `grep -n "serverBase" lib/offline/*.js` finds them only in
`settleLandedSave` (`useDurableNote.js:274`), the debounced clean→dirty persist (`:385-387`),
`settleSent` (`outboxDrain.js:64`), `settleForked` (`:98`, `:113`), `rebaseEntry` (`:204`)
and `mergeAppends` (`:247`). (⚠️ The same grep also hits `recoverLocalState.js:65` — a LOCAL
`const serverBase = usableBaseline(server?.updatedAt)` consumed as a `baseUpdatedAt` at `:72`,
`:84` and `:96`. Same name, different thing; it writes no record field.) A cache refresh would have been **the only writer of that value
carrying no member intent at all** — which is exactly why the sentence above reads as
permission for it.

**The chain, as far as the source supports it.** A member has a dirty working copy of note
X and a queued entry; another device body-rewrites X; the refresh writes the fetched copy
into `serverBase`.

1. The drain asks for the base before anything else:
   ```js
     const base = lastKnownServerCopy(noteRec)
   ```
   — `outboxDrain.js:172`, inside `ringVouchedPlan`, and for a dirty record that resolves to
   ```js
     return rec.serverBase || null
   ```
   — `serverChange.js:209`: the value the refresh just overwrote.
2. `fresh` and `base` are now the same document, so the expensive answer — asked, and
   answered over a base that had been moved underneath it — returns metadata-only:
   ```js
     if (json(fresh.bodyJson) === json(base.bodyJson)) return METADATA_ONLY
   ```
   — `serverChange.js:137`.
3. Which `ringVouchedPlan` turns into a rebase:
   ```js
     return { plan: 'rebase', base, shape }
   ```
   — `outboxDrain.js:183`.
4. The drain rebases the member's queued body onto the other device's revision and re-sends
   it over their words. **No fork, no conflicted copy, no trace.**

⛔ **And the clean-record variant needs naming, because `serverBase` is not involved in it
at all.** A record can be CLEAN while an entry is still queued — the state instance 4's
chain ends in, and the state `supersedeProvesContent.test.js:57-61` seeds by hand (*"⭐ CLEAN
— the remount reconciled it"*, `:60`). ⚠️ **How production reaches it is the UNKNOWN recorded
below**, and that is not settled here. In that state the base is the record itself:

```js
  if (!rec.dirty) return snapshotOfServerCopy(rec, usableBaseline(rec.baseUpdatedAt))
```
— `serverChange.js:208`

…and `landedBaseline` reads the same record's `baseUpdatedAt`:

```js
  if (!record || record.dirty) return null
```
— `baseline.js:61`

…after which instance 1's branch discards on the clock alone —
`    if (isSupersededBaseline(entry.baseUpdatedAt, landed)) {` (`outboxDrain.js:467`), whose
whole test is `  return ta < tb` (`baseline.js:87`). **A refresh that advanced a clean
record's `baseUpdatedAt` would delete a queued entry outright**, under a reason claiming
*"a save this browser landed at …"* (`outboxDrain.js:474`) that this browser never made.
**That is instance 1, fed by a READ** — which is why the invariant below had to say "or any
baseline" rather than name `serverBase`.

**What the cheap answer could not have seen:**

- **A revision moving forward proves only that *something* was written.** Exactly the blind
  spot instance 1 is built on, and instance 2's fix was written to close: *"The ring knows
  **who** wrote the revision; only the diff knows **what** they wrote."* A refresh knows even
  less than the ring — it does not know who wrote it either.
- **"The server told us something newer" and "the server has these words" are different
  claims,** and the second is the one a baseline is read as making. This is instance 3's
  sentence with the subject changed from a revision id to a fetch.
- **A read has no member intent to preserve, so nothing downstream forks on its behalf.**
  Instances 1 and 4 at least leave a queued entry standing for a moment. Here the corruption
  is to the *evidence* the later guards reason over, so every one of them answers correctly
  over a base that is quietly wrong — which is why it would have left no trace.

**How it was pre-empted.** The owner ruled it into the Q2-A spec as an invariant before any
code, in `docs/notebook/q2a-implementation-plan.md` (the Q2-A worktree,
`uct-worktrees/notebook-q2a`; the file is not in this tree):

> ⛔⛔ **A cache refresh never writes `serverBase`, and never writes any other
> baseline, for a note that has a dirty record OR a queued outbox entry. Reads
> populate the read cache ONLY — never the write path's base.**

⭐ **"OR a queued entry" is load-bearing, not belt-and-braces** — the clean-record variant
above is exactly a note whose record is `dirty: 0` with work still queued, and a rule written
as *"while dirty"* would have permitted it. That state is the one instance 4's chain ends
in, and this audit's own UNKNOWN section records that how production reaches it is not yet
derived — so "it cannot happen" is exactly the assumption the invariant declines to make.

⭐ **And it carries a DAY-ONE rail with the chain above as its RED case** (Q2-R3, plus a
non-vacuity control Q2-R3c), landing before the cache writer exists rather than beside it.
The mutation that must redden it is the design that was rejected: *make the cache refresh
write the fetched server copy into the write path's base*. ⛔ Nothing here is verified by a
run — no test was run for this audit and none exists yet to run, because the code does not
exist. **Pre-empted is a claim about a plan, not a measurement of a product**, and it stays
that way until Q2-A ships with that rail mutation-proved.

---

## FIXED vs LIVE vs PRE-EMPTED — and how each was determined

**From the source only; no test was run and no git command was issued.**

| instance | state | how determined from the source |
|---|---|---|
| 1 — `isSupersededBaseline` | **LIVE** | `outboxDrain.js:466-476` reaches `clearOutboxEntry` with no content test on the path; the only inputs are `entry.baseUpdatedAt` and `landedBaseline(noteRec)`, and `baseline.js:80-88` compares parsed timestamps and nothing else. Corroborated by the in-tree rail `supersedeProvesContent.test.js`, which declares its first case *expected to FAIL against today's drain*. |
| 2 — ring before the diff (fix 3) | **FIXED** | `ringVouchedPlan` exists (`outboxDrain.js:171-184`), calls `classifyServerChange` at `:180`, and is the only thing consulted at both vouch sites (`:440`, `:532`). The pre-fix behaviour survives only in the header comment at `:156-165`. PROGRAM-MANIFEST §10.11 records it fixed at `9a213bd45` with M25/M26 permanent; `ringVouchAuthority.test.js` is the census rail against a third site. |
| 3 — "ours ⇒ remove" | **FIXED** | Both removal branches require `mine.identical` (`outboxDrain.js:412`, `:516`), and `identical` is produced only by `sameAuthoredContent(server, entry.patch)` (`useOutboxDrain.js:73-78`). The "ours, not identical" branch rebases (`outboxDrain.js:425-456`) instead of removing. |
| 4 — remount discard | **LIVE** | No content comparison anywhere between the **queued entry** and the server copy on the clean-write path (`useDurableNote.js:259-286`, `:381-402`) or on the supersede path (`outboxDrain.js:466-476`). The deletion is unconditional given a null intent (`notebookDb.js:153-161`). |
| 5 — a refresh moving the baseline | **PRE-EMPTED** | ⭐ **Not determined from the source, because there is no source** — this one is a plan, not code. `grep -rn "readCacheDb\|notebook_offline_read_on" app/src --include=*.js --include=*.jsx` returns **zero** hits for `readCacheDb`, and for the flag only its plumbing — `AuthContext.jsx:70`, `notebookFlags.js:39`, plus two tests. No read-cache module exists in `lib/offline/`. What IS read off the source is that the mechanism would work as described: `lastKnownServerCopy` returns `rec.serverBase` for a dirty record (`serverChange.js:209`) and the record itself for a clean one (`:208`), and both feed `classifyServerChange` (`:137`) → `ringVouchedPlan` (`outboxDrain.js:183`). The state is a claim about a SPEC and is not a measurement; it becomes one only when Q2-A ships with rail Q2-R3 mutation-proved. |
| C5 — recovery blind spot | **LIVE** | `useDurableNote.js:476` gates the recovery candidate on `rec.dirty`; a whole-tree grep for `listOutbox` / `listBlockedNoteIds` outside tests returns only `outboxDrain.js:278` (the drain), `useOutboxDrain.js:224` (the pending count) and `blockedNotes.js:28` (the blocked badge). No recovery surface reads the outbox. |

---

## SITES I COULD NOT CLASSIFY, AND WHY

- **How the production state in instance 4 is *reached* — UNKNOWN.** Every write
  that marks a record clean also clears the queue in the same transaction
  (`settleSent` `outboxDrain.js:61-75`, `settleForked` `:98`, `settleLandedSave`
  `useDurableNote.js:270-286`, `persist` `:381-402`, and `discardDraft`
  `NoteEditorPage.jsx:840`). So from the source alone I cannot derive the
  ordering that leaves a **clean record beside a surviving entry** — the state
  the rail seeds by hand at `supersedeProvesContent.test.js:57-61`. Hydration
  does not do it on its own: every `setContent` on the mount path passes
  `EMIT_NOTHING` (`NoteEditorPage.jsx:117`, used at `:455`, `:771`, `:1380`,
  `:1480`), so a remount raises no `onUpdate` and no autosave, and `commitSave`
  returns early when nothing changed (`:1501-1505`). Two candidate producers I
  can quote but **cannot confirm** without a run: a **second tab** writing an
  intent after this tab's clean write, and the drain's own
  `rebaseEntry`/`mergeAppends`, which write the record back **with whatever
  `dirty` it had** beside a fresh entry —
  `const rec2 = rec && serverBase !== undefined ? { ...rec, serverBase } : rec`
  (`outboxDrain.js:204`). That preserves the combination rather than creating it,
  so the creator is still unidentified. The programme has a production RED dated
  2026-09-13 and a rig; that, not this audit, is what can settle it.
- **`outboxDrain.js:622`** — `if (!retriedRebase && mine?.serverNote && isUsableBaseline(mine.serverUpdatedAt)) {`.
  A boolean gates whether the classifier runs at all. It reads as the pattern
  until you read `:618-621` (*"After a rebase the fetched copy is a revision
  behind, and classifying against a stale document is how you merge into a note
  that has moved again"*), at which point it is a correctness guard about the
  **freshness of the evidence**, not a proxy for it. I am recording it here
  rather than scoring it, because "one rebase per drain pass" is a budget
  decision I cannot evaluate from the source: whether a *second* pass ever
  re-fetches and re-classifies is a runtime question.

---

## ONE SITE THAT MAY NOT BE ON THE PROGRAMME'S MAP

**`useDurableNote.js:476` — the recovery banner is gated on the same flag the
discard has just cleared, and no recovery surface reads the outbox.**

```js
        idbRecord = rec && rec.dirty ? rec : null
```

`recover()` (`useDurableNote.js:469-482`) considers exactly two candidates — the
IDB **record** and the localStorage draft — and admits the record only when
`dirty` is truthy. `chooseLocalRecovery` is then a content comparison
(`recoverLocalState.js:91`), so the expensive answer is asked about the *wrong
population*: the queued entry is not one of the candidates, and the only readers
of `listOutbox` in the whole app are the drain, the pending counter and the
blocked-notes badge.

Consequence, stated narrowly: in the exact state instance 4 produces — record
reconciled clean at the server's newer revision, member's words alive only in the
queued entry — the member is offered **nothing**, and the surface that exists to
catch a lost local copy cannot see the one copy that is about to be deleted. It
is the same cheap answer (`dirty`) failing in a second place, on the read side
rather than the write side, which is why it would not show up in a drain-focused
map.

⛔ I am not proposing a fix for it; it is outside the fourth instance's scope and
the programme decides fixes. It is recorded because it changes the *blast radius*
of instance 4 from "the drain deletes it" to "the drain deletes it and the
banner could never have offered it back".
