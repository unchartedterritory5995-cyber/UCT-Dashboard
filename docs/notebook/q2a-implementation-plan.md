# Q2-A — offline READ — implementation plan

Worktree `C:\Users\Patrick\uct-worktrees\notebook-q2a`, branch
`feat/notebook-q2a-offline-read`. Written 2026-09-14. **No code has been written
for this track** — `grep` over `app/src`, `api`, `tools`, `tests` finds
`notebook_offline_read_on` only in the flag plumbing (`AuthContext.jsx:70`,
`notebookFlags.js:39`, `auth.py:133`, `tests/test_notebook_flags.py:23`) and in
docs. Everything below is a proposal.

---

## 0. Where Q2-A is defined, and what the sources actually say

Four documents, in the order they govern.

**`docs/notebook/PROGRAM-MANIFEST.md` is the contract.** §2's wave row is the
whole of what it says about scope:

> `| Q2–Q5 | Conflict UX · offline read cache · attachment pinning · mobile shell | not started |`
> — `PROGRAM-MANIFEST.md:107`

§12's track table is what says Q2-A may start:

> `| **Q2-A** | offline read cache | now | must not touch the save path or R's files |`
> — `PROGRAM-MANIFEST.md:1141`

and the constraint is repeated in prose:

> "K, R, S and Q2-A run concurrently on non-overlapping files; Q2-B/C/D wait
> for R to merge dark and pass its post-merge Q1 canary."
> — `PROGRAM-MANIFEST.md:489`

**`docs/notebook/wave-q2-PRD.md` §"Q2-A — Offline read" (`:55`–`:83`) is the
product statement.** Verbatim:

> "**What a member gets, in plain English:** *"The notes you've opened recently are
> there when your connection isn't."*" — `wave-q2-PRD.md:57-58`

> "- **working copy** — gains a *read cache* distinct from the *working copy*. ⛔ These
>   must not be one store: a working copy holds YOUR unsynced edits and may never be
>   evicted; a read cache holds the server's copy and must be evictable under quota
>   pressure. Merging them is how an eviction loses member work."
> — `wave-q2-PRD.md:64-67`

> "- **outbox** — unchanged. Reading queues nothing." — `wave-q2-PRD.md:68`

> "- **fork** — unchanged. A cached read that goes stale is replaced, never forked;
>   there is no member intent in a cache entry to preserve." — `wave-q2-PRD.md:72-73`

> "**Storage bound:** cache the **50 most recently opened notes**, hard cap
> **25 MB/account**, LRU eviction. ⛔ The origin quota is SHARED with `uct_bars_v1`,
> which already holds ~550 MB of chart data" — `wave-q2-PRD.md:75-77`

⛔ **The PRD carries a trap of its own, and §10 of the manifest says to expect
one.** Its rollback section and its "new default-reading sites" table were
written **before Wave K** and specify a compile-time constant
`READ_CACHE_DEFAULT_ON` with a `readCacheEnabled()` reader
(`wave-q2-PRD.md:156`, `:224`). K superseded that transport — see §4 below. The
PRD's own header already records the same class of error against itself:

> "⛔ **This PRD was written from `wave-q1-observation-window.md`'s passing mention of
> Q2, not from the contract.**" — `wave-q2-PRD.md:17-18`

**`docs/notebook/wave-q2-decisions.md`** carries the owner-facing decisions.
Rows this plan is built on: 2 (**A ONLY FIRST**), 4 (**50 / 25 MB**), 5 (cache
refresh **leader-only**), 6 (thesis/evidence/review **read-only offline,
unchanged**), 10 (**per-slice** 7-day window), 11 (extend the flag-default
sweep **before any Q2 code**), 12 (the Q1 canary **keeps running**). ⛔ The file's
own header says these are recommendations awaiting one pass —
`wave-q2-decisions.md:3-5`: *"Answer in one pass when the Q1 window closes;
nothing here needs answering before then."* **Nothing in this repo records that
pass having happened.** See §7 UNKNOWN.

**`docs/notebook/kill-switch-spec.md`** owns the flag. Its table:

> `| Q2-A offline read cache | `NOTEBOOK_OFFLINE_READ_ON` | `notebook_offline_read_on` | Q2-A, dark |`
> — `kill-switch-spec.md:163`

### ⚰️ One citation I was handed and could not verify — STRUCK

I was told the F5 freeze's arming condition "was amended to *every cell GREEN or
NAMED*". **That string does not exist.** `grep -rn "GREEN or NAMED"` over
`docs/`, `app/src`, `tools/`, `scripts/` returns nothing, case-insensitively too.
The arming condition on disk is:

> "⛔ **THIS RAIL EXPIRES BY CONSTRUCTION.** `F5_OPEN` flips to false the day the
>  seven-family × six-ordering table has zero INCONCLUSIVE rows"
> — `app/src/pages/journal-2-0/lib/offline/f5Freeze.test.js:36-37`

and the constant beside it reads `const F5_OPEN = true` (`f5Freeze.test.js:47`).
§6 below is written against **that** condition. If the amendment is real it lives
somewhere I did not look, and it changes §6's timing but not its content.

---

## ⛔⛔ INVARIANT I1 — a cache refresh never moves the write path's baseline

**Owner ruling, 2026-09-14.** This is a **stated invariant of the Q2-A spec**, settled
**before any code is written** — not a guideline, not a hazard to be careful around.

> ⛔⛔ **A cache refresh never writes `serverBase`, and never writes any other
> baseline, for a note that has a dirty record OR a queued outbox entry. Reads
> populate the read cache ONLY — never the write path's base.**

"Any other baseline" is meant literally and is not a flourish: `baseUpdatedAt`, and the
`STORE_NOTES` record itself, each stand in for the base in a case named below.

### The scenario this forecloses, traced against the source

1. The member has a dirty working copy of note X and a queued outbox entry.
2. Another device **body-rewrites** X. The server's revision advances.
3. Q2-A's read-cache refresh for X — a plain `GET` through `useJ2Note`
   (`useJ2Notes.js:149-154`), no member intent anywhere in it — writes the fetched
   copy into `serverBase`.
4. The drain runs. `ringVouchedPlan` asks for the base first:

   ```js
   function ringVouchedPlan(mine, noteRec) {
     const base = lastKnownServerCopy(noteRec)
   ```
   — `outboxDrain.js:171-172`, and for a dirty record that resolves to
   `return rec.serverBase || null` (`serverChange.js:209`) — the value step 3 just
   overwrote.
5. `fresh` and `base` are now **the same document**, so the classifier answers
   metadata-only:

   ```js
   if (json(fresh.bodyJson) === json(base.bodyJson)) return METADATA_ONLY
   ```
   — `serverChange.js:137`, which `ringVouchedPlan` turns into a rebase:
   `return { plan: 'rebase', base, shape }` (`outboxDrain.js:183`).
6. The drain rebases the member's queued body onto the other device's revision and
   **sends it over their words.**

**A READ PRODUCED A CLOBBER — no fork, no conflicted copy, no trace.** The mechanism is
the one `ringVouchedPlan`'s own header already records for a different cause:
*"'ours => rebase' ran before the diff was ever read, so when the server's change was an
APPEND … the member's queued body was re-sent over it and the captured block was gone"*
(`outboxDrain.js:156-159`).

⭐ **The trap is written into the source, in the sentence Q2-A would otherwise satisfy:**

> "⭐ A DIRTY RECORD CARRIES `serverBase`: what the server told us, captured at
>  the clean→dirty transition and moved forward every time the server tells us
>  something newer (an ack, a successful drain send) …"
> — `serverChange.js:185-187` (quote truncated mid-line 187; the sentence continues
>   *"It costs one extra body per UNSYNCED note"*)

A cache refresh **is** "the server telling us something newer", and it is the one such
event that carries no member intent at all. It must never count.

### ⛔ "OR a queued entry" is part of the condition, not a synonym for "dirty"

**A record can be CLEAN while an entry is still queued.** ⚠️ How production REACHES that
state is not derived — the Wave Q1 cheap-answer audit records it as UNKNOWN and its Q1 rail
seeds the state by hand (that rail is on the Wave K worktree, not this one, so it is named
rather than cited). What IS readable in this tree is that the layer handles the state, and
handles it by moving two baselines, **neither of which is `serverBase`** — so a condition
written as *"while dirty"* would let both through:

- **For a clean record the base IS the record.**
  `if (!rec.dirty) return snapshotOfServerCopy(rec, usableBaseline(rec.baseUpdatedAt))`
  — `serverChange.js:208`. A refresh that wrote the fetched copy into the `STORE_NOTES`
  record, leaving `serverBase` untouched, moves the classifier's base anyway.
- **A clean record's `baseUpdatedAt` can delete a queued entry on the clock alone.**
  `landedBaseline` admits only a clean record — `if (!record || record.dirty) return null`
  (`baseline.js:61`) — and the drain then discards on a pure timestamp comparison:
  `if (isSupersededBaseline(entry.baseUpdatedAt, landed)) {` (`outboxDrain.js:467`), whose
  whole test is `return ta < tb` (`baseline.js:87`). Advancing a clean record's
  `baseUpdatedAt` from a read would therefore **delete** queued member words, under a
  reported reason claiming *"a save this browser landed at …"* (`outboxDrain.js:474`) —
  which this browser did not.

⭐ **The state is not hypothetical: it is a PRECONDITION of a branch that is live today.**
`landedBaseline` returns `null` for a dirty record (`baseline.js:61`), so the drain's
supersede branch at `outboxDrain.js:467` is reachable **only** with a clean record beside a
surviving queued entry. Whatever produces that pairing, the product already has a discard
path written for it — and a read must not be allowed to feed it.

### The writers of a baseline stay the ones that already exist

Derived with `grep -n "serverBase" lib/offline/*.js` rather than typed:
`useDurableNote.js:274` (`settleLandedSave`) · `useDurableNote.js:385-387` (the
clean→dirty transition on the debounced persist) · `outboxDrain.js:64` (`settleSent`) ·
`:98` and `:113` (`settleForked`) · `:204` (`rebaseEntry`) · `:247` (`mergeAppends`).
Every one is an **ack, settle or fork of this browser's own write**. Q2-A adds none, and is
never a source for `lastKnownServerCopy`. ⚠️ The same grep also hits `recoverLocalState.js:65`
— a LOCAL `const serverBase = usableBaseline(server?.updatedAt)` consumed as a `baseUpdatedAt`
at `:72`, `:84` and `:96`. Same name, different thing; it writes no record field, and it is
not on the list above.

⚰️ This supersedes the sentence §3 previously carried — *"The only writers of `serverBase`
stay the two that exist today"* — which typed a count of **two** beside three names, over
a set that greps to more sites than either number. **Do not restore a count here; re-grep.**

### The rail is DAY ONE, and the traced scenario is its RED case

**Q2-R3 lands with the first Q2-A module that can open the read-cache database (T3) —
BEFORE a cache writer exists (T6), not beside it.** A rail written after the writer is a
rail written to pass; a rail written first is a rail the writer has to satisfy.

- **RED case:** the trace above, driven end to end — a dirty record with `serverBase` at
  revision A, another device's **body rewrite** at revision B, a cache refresh for that
  note, then `ringVouchedPlan`. Plus the clean-record variant named above: a clean record
  beside a surviving queued entry, a refresh, then the drain's supersede branch.
- ⛔ **The mutation that must redden it:** *make the cache refresh write the fetched server
  copy into the write path's base* — in the cache writer, `rec.serverBase = fetched` (and,
  for the clean-record variant, `putNoteWithIntent(db, { ...rec, ...fetched, baseUpdatedAt:
  fetched.updatedAt }, entry)`). With that line in, `classifyServerChange` answers
  `METADATA_ONLY`, `ringVouchedPlan` returns `plan: 'rebase'` where it returned `'fork'`,
  the queued body is resent over the other device's words, and **Q2-R3 goes red.** Restore
  from memory, verify byte-for-byte, re-run.
- ⭐ **Non-vacuity control, Q2-R3c:** the same fixture with the refresh doing nothing must
  stay GREEN and must assert a NAMED member (the plan for the note under test is `'fork'`),
  never only a count — so R3 cannot pass by never reaching the drain (rule 14).

⛔ **A rail that cannot fail is decoration.** Q2-R3 is not done when it is written; it is
done when that mutation has been watched to redden it and the restore verified.

### What this ruling changed, and what it did not

- **Changed:** the rule is now a **spec invariant placed before the task breakdown**,
  owner-ruled, rather than a rule argued inside §3's hazard discussion. §3 keeps the trace
  and defers the rule to here, so one place owns it.
- **Changed:** Q2-R3 moves from **T6 to day one (T3)** and gains the control Q2-R3c.
- **Changed:** the condition is stated as **dirty OR queued**, and it covers
  `baseUpdatedAt` and the `STORE_NOTES` record, not `serverBase` alone.
- **Foreclosed:** the weaker shape — *allow the refresh to write the baseline and protect
  it with a discipline rule enforced by a rail.* The owner ruled against it. The invariant
  is the design; the rail proves the design rather than standing in for it.
- ⚠️ **UNKNOWN — I could not determine this, and did not rewrite history to fit it.** I was
  told this plan's author had chosen that weaker shape and separately flagged it as probably
  wrong, preferring to skip the cache write while dirty. **No such passage exists in this
  file.** `grep -n "discipline\|weaker\|probably wrong\|while dirty\|choice"` over
  `q2a-implementation-plan.md` returned exactly one hit before this section was added —
  *"Everything else in this plan is unchanged by that choice"*, in §2, about the
  one-database-versus-two question. (No line number: a self-citation inside this file moves
  every time the file is edited, which is how a stale one is born.) And §3 as it stands
  already called the rule *"absolute"*. So nothing here was silently reversed; if
  that draft exists it is somewhere I did not look. The ruling stands either way, and what it
  changes is listed above.

---

## 1. What ships, precisely

### The member-visible change

Today, opening a note with no network shows this, and nothing else:

> `<p>Couldn't load this note.</p>` — `NoteEditorPage.jsx:1793`

Q2-A replaces that, **for a note this browser has opened before**, with the note
itself: title, subtitle and body, exactly as the server last served them, in a
**read-only** editor, under a banner that dates the copy — *"Offline. Showing the
copy saved on this device on <date, time>."* The moment a server copy lands the
banner goes and the editor becomes editable as usual.

Three doors reach it, and all three already exist:

1. `?note=<id>` in the URL (`NotebookTab.jsx:64`: `const noteId = searchParams.get('note')`) — a reload, a bookmark, a back button.
2. A tab already on that note when the network drops.
3. **New, and load-bearing:** an *Available offline* section in the notebook list, rendered **only when the list request fails**, listing exactly the notes in the cache (title + when it was cached). Without this the feature is reachable only by URL, which is the repo's own recurring defect — *built, tested, green and unreachable*.

### What explicitly does NOT ship

| | |
|---|---|
| **Editing a note opened from cache** | ⛔ read-only, deliberately. See §3 — a cache entry's `updatedAt` can be arbitrarily stale, so typing on it queues a write whose compare-and-set is near-certain to 409, and the surface that makes a fork legible to a member is **Q2-B, which is blocked on R** (`PROGRAM-MANIFEST.md:1142`). Q2-A must not manufacture the state Q2-B exists to explain. A note with an existing **dirty** working copy is a different case and stays editable — §3, case 1. |
| **Offline search** | NO. `/api/j2/notes?q=` is server-side; a client-side search over ≤50 cached bodies would answer a different question from the one the search box answers online, silently. |
| **Offline attachments, images, PDFs** | NO. `wave-q2-PRD.md:82-83`: *"Attachments are read-only offline in Q2-A (see Q2-C)."* Read-only here means **not present** — an `<img>` whose `src` is a `/api/j2/...` URL renders broken offline, and the cached render must say *"images aren't available offline"* rather than show broken frames. |
| **The note LIST, folders, tags, saved views, Home** | NO, beyond the *Available offline* section above. `useNotebookHome.js` and `useJ2Notes` are untouched. |
| **Creating, deleting, trashing or restoring a note offline** | NO. Reading queues nothing (`wave-q2-PRD.md:68`). |
| **Ask / citations, versions, backlinks, properties panels** | NO — every one is a separate server read; each renders its own empty/error state. |
| **Prefetching notes the member has not opened** | NO. The cache is a record of what was opened, never a crawl of the library. |
| **Thesis / evidence / review offline editing** | NO — unchanged from Q1, decision 6. |
| **A service worker or any shell cache** | ⛔ charter DO-NOT-BUILD; `wave-q2-decisions.md:26`: *"**Service worker**: a standing charter DO-NOT-BUILD. Q2-A is an IndexedDB read cache, not a shell cache."* |

---

## 2. The store question, argued

### What exists now

`app/src/pages/journal-2-0/lib/offline/notebookDb.js` is the only module that
names an object store — `grep` for `STORE_NOTES|STORE_OUTBOX|STORE_CONFLICTS|STORE_META`
across `app/src`, excluding that file and tests, returns nothing. It declares:

```
export const DB_VERSION = 1          // notebookDb.js:31
export const STORE_NOTES = 'notes'
export const STORE_OUTBOX = 'outbox'
export const STORE_CONFLICTS = 'conflicts'
export const STORE_META = 'meta'
```

and the account is the database **name**, not a column:

> "⛔⛔ ONE DATABASE PER ACCOUNT, BY NAME. `uct_notebook_{accountId}` rather than
>  one database with an `accountId` predicate on every read. A wrong database
>  name yields NO DATA; a forgotten `WHERE` yields another member's research."
> — `notebookDb.js:4-7`

### Recommendation: a SEPARATE DATABASE, not a fifth store

**`uct_notebook_read_{accountId}`, version 1, one object store `readCache`
(keyPath `noteId`, index `byLastRead`), plus one `cacheMeta` record.** A new
module `lib/offline/readCacheDb.js`; `notebookDb.js` is not edited.

Three reasons, in order of weight:

1. **A fifth store means `DB_VERSION` 1 → 2 on the write path's database.** That
   upgrade runs for every member on their next Notebook load, including members
   for whom Q2-A is dark, and it can be blocked by another tab —
   `notebookDb.js:111-114` surfaces `UpgradeBlocked('another tab is holding an older
   connection')`. Paying a live upgrade on the durable write path to install a
   store that is switched off is the wrong trade. The header is not against
   bumps (`notebookDb.js:16-21` argues they are survivable *because* the
   `onversionchange` handler ships from v1) — it is just a cost with no benefit
   here.
2. **The PRD's R1 becomes structural instead of disciplinary.** *"a read-cache
   entry is NEVER written into the working-copy store"* (`wave-q2-PRD.md:202`) is
   enforced by a different database name, which is the same argument
   `notebookDb.js:4-8` already makes for account isolation: *"the safe failure is
   the one the architecture makes structural."*
3. **`deleteDatabase()` becomes legitimate again.** `notebookDb.js:27-28`:
   *"AND `deleteDatabase()` IS NOT A RECOVERY STRATEGY. Once this store can hold
   unsynced member work, clearing it is data loss wearing the word "repair"."*
   A read cache holds **no member intent** — the PRD says so at `:72-73` — so
   dropping the whole database is a real recovery lever for a quota emergency.
   Inside the working-copy database it would not be.

**The counter, stated:** it is a second database where the module header says one
per account, and `navigator.storage.estimate()` (`notebookDb.js:58-61`) reports
origin-wide, so two databases do not make accounting harder or easier. If the
owner prefers one database, the change is a `DB_VERSION` bump to 2 and two lines
in `createStores` — `createStores` is already additive and idempotent
(`if (!db.objectStoreNames.contains(...))`, `notebookDb.js:68`), so a v2 upgrade
only adds the store. Everything else in this plan is unchanged by that choice.

### What is cached, when

An entry is written **only** on a **successful server read of a single note** —
i.e. in `useJ2Note` (`useJ2Notes.js:149-154`) when `data.note` arrives. Not on
list responses (they are projections and carry no body), not on a schedule, not
on a crawl.

```
{ noteId, title, subtitle, bodyJson, updatedAt,   // exactly what the server served
  cachedAt, lastReadAt, bytes }
```

`updatedAt` is copied so the banner can say how old the copy is and so a future
slice can compare revisions. ⛔ It is **not** a baseline for a write — §3.

### The bound, and who enforces it

Three bounds. The first two are decision 4; the third is mine and is flagged in
§7.

| bound | value | enforced |
|---|---|---|
| count | **50 entries** | at every write: evict by `byLastRead` ascending until `count ≤ 50` |
| total size | **25 MB per account** | same loop, until `bytes ≤ 25_000_000` |
| **per-entry ceiling** | **2 MB** (proposed) | a note over it is **not cached**, and the refusal is recorded in `cacheMeta` |
| **age** | **30 days** (proposed) | an entry older than this is evicted on open, before it can be served |

`bytes` is measured at write time as `new TextEncoder().encode(JSON.stringify(entry)).length`
— a real byte count, not `String.length`, because a note full of em dashes and
emoji is three to four bytes a character. The running total lives in one
`cacheMeta` record and is **recomputed from a full cursor pass whenever it
disagrees with the entry count**, so a crashed write cannot leave the accounting
permanently wrong.

⛔ **The per-entry ceiling exists because one enormous note otherwise evicts the
other forty-nine.** The 25 MB cap alone is satisfied by a single 24 MB note, and
that is a cache that has stopped being a cache. The refusal is recorded rather
than silent — `wave-q2-PRD.md:77-78` is explicit that *"the bound must be
enforced by the cache itself rather than inherited from the browser"*, and a
refusal nobody can see is inherited behaviour by another name.

⛔ **Eviction never touches `STORE_NOTES`, `STORE_OUTBOX`, `STORE_CONFLICTS` or
`STORE_META`.** With a separate database it cannot.

---

## 3. The interaction with Q1's write path — the risky part

### The invariant Q2-A must not break

Q1's rule, in its own words:

> "⛔ A CLEAN RECORD IS NOT A RECOVERY CANDIDATE. `dirty: 0` means the server
>  already has this content; if the server's copy now differs, the server is
>  newer BY CONSTRUCTION (another device wrote it)."
> — `useDurableNote.js:21-23`

and its mirror, that server-derived state never overwrites dirty local state, is
implemented in `recoverLocalState.js::chooseLocalRecovery` (`:63`), which
*"Returns a DECISION; it never applies one"* (`useDurableNote.js:466-467`).

### The rule for which copy wins on open

Four cases, evaluated in this order. **Only case 3 is new.**

| # | condition | what renders | editable? |
|---|---|---|---|
| 1 | `notes[noteId]` exists **and `dirty === 1`** | the durable working copy, through today's `chooseLocalRecovery` path | **yes** — the baseline and the outbox entry already exist and are unchanged |
| 2 | the server answered | the server copy, exactly as today — **and this write refreshes the cache entry** | yes |
| 3 | **NEW** — no server answer, a cache entry exists | the cache entry, **read-only**, under a dated banner | **no** |
| 4 | no server answer, no cache entry | today's `NoteEditorPage.jsx:1790` branch, unchanged | n/a |

Case 1 is listed first on purpose. **A dirty working copy outranks a cache entry
always**, and the cache is not even consulted for content when one exists. That
is the same ordering Q1 already asserts and it is the half of the invariant that
matters: server-derived bytes never displace unsent member words.

A note in case 1 also fixes a hole Q1 left: today a member who edited a note
offline, closed the tab and reopened it offline gets *"Couldn't load this note."*
while their durable copy sits on disk, invisible. Case 1 makes that copy render.
⚠️ Whether that counts as Q2-A or as a Q1 defect is a real question — it is
listed as its own task (T5) so it can be split out.

### ⛔⛔ The conflict I am not going to smooth over: `serverBase`

A cache entry and `serverBase` are **two on-device copies of "what the server
holds for note X"**, and exactly one of them is allowed to move.

`serverChange.js` owns the second one:

> "⛔⛔ A CLEAN RECORD IS ITS OWN BASE. `dirty: 0` means the server already has
>  this content, so the record answers the question by itself and storing a
>  second copy would be a second authority over one value.
>
>  ⭐ A DIRTY RECORD CARRIES `serverBase`: what the server told us, captured at
>  the clean→dirty transition and **moved forward every time the server tells us
>  something newer** (an ack, a successful drain send)."
> — `serverChange.js:181-188` (emphasis mine)

That sentence is the trap. **A cache refresh is "the server telling us something
newer", and it must not be allowed to count.** Trace it:

1. Member has a dirty working copy of note X and a queued outbox entry.
2. Another device rewrites X's body. The server's revision advances.
3. Q2-A refreshes the cache for X — a plain `GET`, no member intent — and (in
   the wrong design) writes the fetched copy into `serverBase`.
4. The drain later runs. `ringVouchedPlan` (`outboxDrain.js:171-185`) calls
   `lastKnownServerCopy(noteRec)` (`serverChange.js:206-210`), which returns that
   `serverBase`, and hands it to `classifyServerChange`.
5. `fresh` and `base` are now **the same document**, so
   `classifyServerChange` returns `METADATA_ONLY` (`serverChange.js:137`), and
   `ringVouchedPlan` returns `{ plan: 'rebase' }`
   (`outboxDrain.js:183`).
6. The drain rebases the member's queued body onto the other device's revision
   and **sends it over their words**. No fork, no conflicted copy, no trace.

**A read produced a clobber.** The mechanism is precisely the one
`ringVouchedPlan`'s own header describes for a different cause
(`outboxDrain.js:156-160`: *"'ours => rebase' ran before the diff was ever read
… the member's queued body was re-sent over it and the captured block was
gone"*).

**The rule, therefore — and since 2026-09-14 it is no longer this section's to state:**

> ⛔⛔ This is **INVARIANT I1**, above, and I1 is the single authority over it: *a cache
> refresh never writes `serverBase`, and never writes any other baseline, for a note that
> has a dirty record OR a queued outbox entry; reads populate the read cache ONLY, never
> the write path's base.* The read cache is a render source and nothing else, and is never
> a source for `lastKnownServerCopy`.

⚰️ **What changed here, marked rather than quietly rewritten.** This subsection used to
state the rule itself and closed it with *"The only writers of `serverBase` stay the two
that exist today"*, followed by three names. The owner's 2026-09-14 ruling promotes the
rule to a **spec invariant, stated before the task breakdown and before any code**, and I1
carries the writer list re-derived by grep instead of that count. Restating the rule here
as well would put a second authority on one value — the exact defect this subsection is
about. **The trace stays; the rule moved.**

Rail **Q2-R3** is written for exactly this. Under I1 it is a **day-one** rail — it lands at
T3, before the cache writer at T6 — and its RED case is steps 1–6 above, with the mutation
I1 names.

### Two smaller interactions, named

- **The drain's `excludeNoteId`.** `drainOutbox` takes `excludeNoteId`
  (`outboxDrain.js:267`) and reports `SKIPPED` — *"the open editor owns this
  note right now"* (`outboxDrain.js:31`). A note rendered read-only from cache
  has **no queued entry**, so it cannot be skipped and there is nothing to
  exclude. Q2-A changes nothing here. Stated because "the editor is open" and
  "the editor owns a write" stop being the same thing, and a future slice that
  makes the cached render editable must revisit this line.
- **A clean `notes` record is NOT a second render source.** For a note the
  member has edited and synced, a clean `STORE_NOTES` record exists and
  `lastKnownServerCopy` treats it as a server copy (`serverChange.js:208`). It is
  tempting to render it in case 3 when no cache entry exists. **No** — it carries
  no `cachedAt`, so the banner could not date it, and making it a render source
  puts two authorities on "what do we show offline". A note the member has opened
  since the flag went on has a cache entry; one that does not, does not render.

---

## 4. The flag, and how it ships dark

### It already exists on both sides. Nothing new is added.

Server, read **per request**, never at import:

```
"NOTEBOOK_OFFLINE_READ_ON": False,      # enablement   — unset means OFF
```
— `api/routers/auth.py:133`, inside `NOTEBOOK_FLAGS`, merged into every auth
response by `**_notebook_flags(),` (`auth.py:249`) inside `_access_payload`
(`auth.py:167`).

Client fallback, already `false`:

```
notebook_offline_read_on: false,
```
— `app/src/pages/journal-2-0/lib/offline/notebookFlags.js:39`, inside
`FLAG_FALLBACKS`, whose comment states the polarity:

> "⛔ Polarity per capability: the Q1 wave is a KILL switch over a shipped
>  feature (absent ⇒ ON), the Q2 keys are enablement gates over dark ones
>  (absent ⇒ OFF)." — `notebookFlags.js:34-36`

Ledger entry, already present and correct:

```
NOTEBOOK_OFFLINE_READ_ON  {'status': 'dark', 'where': []}
```
— `docs/feature_flags.json`, note: *"Wave K, 2026-09-12. Enablement gate for
Q2-A, the offline READ path, which is NOT BUILT. … Unset means OFF."*

### ⛔ No new compile-time constant — the PRD is superseded here

`wave-q2-PRD.md:156` and `:224` specify `READ_CACHE_DEFAULT_ON` and
`readCacheEnabled()`. **Do not build them.** K's `FLAG_FALLBACKS` **is** the
compile-time fallback, and a second constant over the same capability is the
`lesson_a_second_authority_over_one_value` shape the kill-switch spec closes by
construction (`kill-switch-spec.md:153`: *"⛔ **Derived, never typed twice.**"*).

The one predicate:

```js
// lib/offline/offlineReadFlag.js
export function offlineReadEnabled() {
  return notebookFlag('notebook_offline_read_on') === true
}
```

`notebookFlag` returns `null` when nothing has latched (`notebookFlags.js:87`),
and `null === true` is `false`. **Unreachable payload ⇒ OFF.** That is the
opposite direction from Q1's kill switch and it is the correct one for an
enablement gate — and it means **Q2-A has no dependency on K-1**.

⚠️ This diverges from `wave-q2-decisions.md:19` (decision 11: extend the sweep
"to all three constants"). The sweep still must be extended — but to the
**reader**, not to a constant that will not exist. See T2 and §7.

### The latch, honoured

> "⭐ SO: the FIRST payload that carries these keys wins, for this tab, for ever.
>  A later poll that disagrees is recorded and ignored." — `notebookFlags.js:24-26`

`offlineReadEnabled()` reads the latch and only the latch. A tab that latched OFF
never opens the cache database, even if the operator flips the variable
mid-session; the disagreement is counted in
`notebookFlagsDebug().ignoredDisagreements` (`notebookFlags.js:62`, `:96-100`).
No second gate is added — `NotebookFlagGate.jsx` already blocks the route until
the flags resolve or the timeout elapses, and `kill-switch-spec.md:131` is
explicit that the gate must not become a second authority.

### The reach statement, verbatim and unaltered

K-R8 greps for this sentence in five places; a Q2-A flip packet is a sixth and
must carry it **word for word**:

> a flip reaches a member on their next authenticated request or reload; it does
> not reach a tab mid-session (latched for §21). If the auth payload is
> unreachable, the wave stays ON — the switch kills a decision, not an outage,
> until K-1.
> — `kill-switch-spec.md:84-86`

⚠️ Its last clause is written for the **kill switch**. For `NOTEBOOK_OFFLINE_READ_ON`
the honest reading is that an unreachable payload leaves the capability **OFF**,
because the fallback is `false`. The packet must reproduce the sentence
unchanged **and** add that reading beneath it as a separate line — altering the
sentence is what K-R8 exists to prevent.

### Off means off, and it is not a delete

Mirroring §21: turning `NOTEBOOK_OFFLINE_READ_ON` off **stops processing** — no
database is opened, no entry is read, no entry is written, and case 3 disappears
so `NoteEditorPage.jsx:1790` renders as it does today. Existing entries stay on
disk untouched. **The one difference from Q1**, and it is worth stating: because
a cache entry holds no member intent (`wave-q2-PRD.md:72-73`), a deliberate purge
*is* available as a quota lever — `deleteDatabase('uct_notebook_read_{id}')`,
behind an explicit admin/operator action, never automatic and never on a flag
flip.

---

## 5. Rails — each with the mutation that reddens it

⛔ Every one is **mutation-proved before it is called done**: break the guard,
watch the rail redden, restore from memory, verify byte-for-byte. Entries go into
`tools/q1_mutation_gauntlet.py`, which already refuses to start unless the rails
are green first (`q1_mutation_gauntlet.py:22-24`).

| id | rail | the mutation that reddens it |
|---|---|---|
| **Q2-R1** | with the flag latched OFF, **no read-cache database is opened**, nothing is read, nothing is written — asserted against a spy `idbFactory` | delete the `offlineReadEnabled()` check in `openReadCache` |
| **Q2-R1c** | ⭐ **CONTROL for R1** — the SAME rail, flag latched ON, asserts the open **does** happen and the spy saw `uct_notebook_read_<id>` by name | invert the guard (`!offlineReadEnabled()`); R1c reds while R1 stays green, so R1 cannot pass by never reaching the code |
| **Q2-R2** | no Q2-A module imports `putNoteWithIntent`, `putConflict` or `putMeta`, and no write reaches `STORE_NOTES` — source rail (AST over the new modules) **plus** a behavioural rail with a spy on the Q1 db | make the cache writer call `putNoteWithIntent` |
| **Q2-R3** | ⛔⛔ **the clobber rail, and it is DAY ONE — it lands at T3, before any cache writer exists (INVARIANT I1).** Two fixtures. (a) DIRTY: a dirty record with `serverBase` = revision A; another device writes a **body rewrite** at revision B; a cache refresh for that note runs. Assert `serverBase` and `baseUpdatedAt` are byte-identical before and after, and `ringVouchedPlan` still returns `plan: 'fork'`. (b) CLEAN-BUT-QUEUED: a **clean** record beside a surviving queued entry; same refresh. Assert the record and its `baseUpdatedAt` are byte-identical after, and the drain does NOT take the supersede branch (`outboxDrain.js:467`) | ⛔ **make the cache refresh write the fetched server copy into the write path's base** — `rec.serverBase = fetched` for (a); `putNoteWithIntent(db, { ...rec, ...fetched, baseUpdatedAt: fetched.updatedAt }, entry)` for (b). (a) flips `fork` → `rebase` and the queued body is resent over the other device's words; (b) makes `isSupersededBaseline` true and the entry is deleted. Both red. Restore from memory, verify byte-for-byte, re-run |
| **Q2-R3c** | ⭐ **CONTROL for R3, and R3 is not called done without it.** The same two fixtures with the refresh doing **nothing**: (a) must still reach `ringVouchedPlan` and return `'fork'` for the NAMED note under test, (b) must still reach the drain and keep the entry. Never asserted as a count — rule 14, *"an empty result is a failed invocation until proven otherwise"* | make the fixture builder queue no entry at all; R3 stays green over an empty set while R3c reds |
| **Q2-R4** | the open order of §3, all four cases driven separately: dirty beats cache · server beats cache · cache beats the error page · no cache leaves `NoteEditorPage.jsx:1790` exactly as it is | swap branches 1 and 3 so the cache is consulted before the dirty record |
| **Q2-R5** | eviction is LRU and enforced at **both** bounds, with a boundary control on each: 49 → 50 → 51 entries, and 24.9 MB → 25.1 MB | delete the byte bound and keep the count bound — the 25.1 MB case reds while the count cases stay green |
| **Q2-R6** | a note over the per-entry ceiling is **not** cached and the refusal is recorded | remove the ceiling |
| **Q2-R7** | ⛔ **rendered TEXT, not state.** The cached render is read-only and the banner sentence is asserted as DOM text after the render settles, per the standing ruling (*"Assert user-facing feedback by RENDERED TEXT, never by state"*) | leave the editor editable — the read-only assertion reds; separately, pass the banner the wrong prop name so it renders `''` and the text assertion reds |
| **Q2-R8** | refresh is leader-only (decision 5): two simulated tabs, one Web Lock, exactly one refresh request | remove the leader check — the request count goes to 2 |
| **Q2-R9** | a stale cache entry is **REPLACED, never forked**: `STORE_CONFLICTS` count is 0 before and after a refresh whose content differs (`wave-q2-PRD.md:204`) | route the cache writer through `putConflict` |
| **Q2-R10** | every Q2-A telemetry event name in the client source is present in `_J2_TELEMETRY_EVENTS` (`api/routers/journal_two.py:71`), with the rail **reading the names out of the client source** rather than retyping them, as `telemetry.js:9-11` requires | add a client event name without the server allowlist entry |
| **Q2-R11** | each event fires **once per its own scope** — per-browser for the opt-in-shaped one, per-tab for the rate-shaped one — mirroring the split `configServedEvent.js:23-31` argues for | make the per-tab event persist its marker in `localStorage`, or the per-browser one reset with the tab |
| **Q2-R12** | ⭐ **the tool-side non-vacuity control** (Q2-R1c and Q2-R3c are the other two; deliberately not numbered — an ordinal beside a list is what drifts when a control is added). The eviction and telemetry fixtures assert a **named member** is present (`expect(keys).toContain(noteIdUnderTest)`), never only a count — per rule 14, *"an empty result is a failed invocation until proven otherwise"* | make the fixture builder return `[]`; every count-based assertion still passes, the named-member assertion reds |

### Telemetry — denominators before the code

`wave-q2-PRD.md:136-142` names the events. Adjusted for what actually exists:

| event | counts | denominator | exclusion |
|---|---|---|---|
| `notebook_read_cache_hit` | a note rendered from cache (case 3) | `notebook_offline_read_served` — one per tab that ran the layer at all | canary/rig times **DERIVED from stamped rows**, never a typed constant (`nb_gate.py:25-30`) |
| `notebook_read_cache_evicted` | one LRU eviction, with which bound fired | same | same |
| `notebook_offline_read_served` | ⭐ the denominator, per tab, one event | itself | same |

⛔ The PRD names `notebook_offline_opt_in` as Q2-A's denominator
(`wave-q2-PRD.md:138`). **That is Q1's event** — it counts browsers running the
Q1 offline layer (`journal_two.py:110`), which is a different population from
browsers with `notebook_offline_read_on` true. Reusing it would produce a rate
over the wrong denominator, which is the exact defect `wave-q2-PRD.md:126-131`
records. Hence a Q2-A-specific denominator event.

---

## 6. Task breakdown, in dependency order

### What the F5 freeze actually forbids

Frozen: the five append **call sites** listed in
`f5Freeze.test.js:61-72`, plus two whole files (`f5Freeze.test.js:75-78`):
`lib/offline/serverChange.js` and `lib/offline/settleNoteWrite.js`. The freeze
names Q2-A by name as **permitted**:

> "⭐ SO THE RULE IS NARROW AND MECHANICAL: until F5's table is green, a branch
>  may not change the client call sites of those three doors, nor the drain's
>  classification, nor the settle. Everything else in these files is open —
>  R-4a's paste/drop handlers and Q2-A's cached-read render both live in
>  `NoteEditorPage.jsx` alongside the excerpt door, and they are welcome there."
> — `f5Freeze.test.js:10-14`

⛔ And the rail runs everywhere: *"The `f5Freeze` rail runs in EVERY tree (owner
ruling): while Q1-F5 is open, the five append call sites, the classifier and the
settle are frozen, and a tree that could not see that freeze would be the one to
break it."* — `wave-q1-RESUME-HERE.md:757-759`.

Current state: `F5_OPEN = true` (`f5Freeze.test.js:47`); the table has one GREEN,
one RED (unpublished), one INCONCLUSIVE and 36 not-run cells
(`wave-q1-f5-production-matrix.md:19-27`), with the discriminator
`append_document_excerpt × drain-first` blocked on a named rig limitation
(`wave-all-RESUME-HERE.md:161-169`).

### FREE TO START NOW

| # | task | depends on | notes |
|---|---|---|---|
| **T1** | Extend `tools/q1_flag_default_sweep.py` to the `notebookFlag('notebook_offline_read_on')` reader and the "never latched ⇒ fallback `false`" default-site class; add its `--self-check` control. **Before any Q2-A code**, per decision 11 | — | the sweep already knows `notebookFlag`/`latchNotebookFlags` (`q1_flag_default_sweep.py:72-75`); this adds the second capability |
| **T2** | `lib/offline/offlineReadFlag.js` — the one predicate `offlineReadEnabled()`. Rails **Q2-R1 + Q2-R1c** | T1 | ~30 lines; no constant |
| **T3** | `lib/offline/readCacheDb.js` — open, get, put, delete, list-keys, `cacheMeta`. Rails **Q2-R2** and — ⛔ **DAY ONE, per INVARIANT I1** — **Q2-R3 + Q2-R3c**, written and mutation-proved HERE, before a cache writer exists | T2 | new file; `notebookDb.js` untouched. R3 drives the traced clobber against a stub refresh; the stub is what T6 must not break |
| **T4** | eviction + the three bounds. Rails **Q2-R5, Q2-R6, Q2-R12** | T3 | |
| **T5** | open-order case 1 (dirty working copy renders offline). Rail **Q2-R4** cases 1 and 4 | T2 | ⚠️ splittable — arguably a Q1 defect, see §3 |
| **T6** | cache write on a successful `useJ2Note` read. Rails **Q2-R9**, and it must land GREEN against **Q2-R3 + Q2-R3c** already in the tree from T3 | T3, T4 | ⛔ R3 is no longer written here — a rail authored beside the writer it guards is a rail authored to pass. This task satisfies I1; it does not get to define it |
| **T7** | case 3 — the read-only cached render + dated banner in `NoteEditorPage.jsx`. Rails **Q2-R4** case 3, **Q2-R7** | T6 | explicitly blessed by `f5Freeze.test.js:10-14`; must not touch the excerpt call site or any settle |
| **T8** | leader-only refresh. Rail **Q2-R8** | T6 | reuses `outboxLeader.js`'s Web Lock; adds no second election |
| **T9** | the *Available offline* list section in `NotebookTab.jsx`, rendered only on a failed list request | T3, T7 | without it the feature is URL-only |
| **T10** | telemetry — three events, client + `_J2_TELEMETRY_EVENTS`. Rails **Q2-R10, Q2-R11** | T6, T7 | |
| **T11** | gauntlet entries in `tools/q1_mutation_gauntlet.py` for R1–R12; run it | T2–T10 | |
| **T12** | flip packet + `docs/feature_flags.json` update + a real-door sandbox canary on the rig, then merge dark | T11 | ⛔ merges serialise, `PROGRAM-MANIFEST.md:1128` |

### BLOCKED BY THE F5 FREEZE

| what | why |
|---|---|
| **Making a cached-read note editable** | it needs the classifier and the settle to learn that the baseline came from a cache entry rather than a live read — `serverChange.js` and `settleNoteWrite.js` are both in `FROZEN_FILES` (`f5Freeze.test.js:75-78`). This is a **second, independent reason** to ship read-only, on top of the Q2-B one in §1 |
| **Letting the read cache feed `lastKnownServerCopy`** | an edit to `serverChange.js`. Frozen — **and forbidden anyway** by §3 |
| **Any change to how an append is classified when a cached copy exists** | the drain's classification is frozen |
| **Dating a cache entry by comparing revisions inside `classifyServerChange`** | frozen file |

⭐ **Nothing on the FREE list touches a frozen file or a frozen call site.**
T7 edits `NoteEditorPage.jsx`, which the freeze permits by name, and the
`f5Freeze` rail's own assertions (`f5Freeze.test.js:129-132`) pin
`settleMetadataRevision(await update({folderId|tags|ticker` — T7 must not add a
fourth.

⛔ Also standing, and it is not F5: **`PROGRAM-MANIFEST.md:1141` — "must not
touch the save path or R's files."** T5 is the closest call on this branch, since
it renders a durable record; it renders one and writes nothing.

---

## 7. NON-GOALS

1. Offline **search** over cached notes.
2. Offline **attachments, images, PDFs, OCR** — Q2-C.
3. Offline **note list, folders, tags, saved views, Home** beyond the failed-list *Available offline* section.
4. Offline **create / delete / trash / restore**.
5. Offline **Ask, citations, versions, backlinks, properties, linked notes**.
6. **Prefetching** notes the member has not opened; any crawl of the library.
7. **Editing** from a cached copy — see §1 and §6.
8. **Conflict UX** — Q2-B, blocked on R (`PROGRAM-MANIFEST.md:1142`).
9. A **service worker**, a shell cache, or anything that survives a bundle revert — charter DO-NOT-BUILD (`wave-q2-decisions.md:26`).
10. **Local-first** framing in any copy, ever (`wave-q2-decisions.md:27`).
11. Any change to `notebookDb.js`, `outboxDrain.js`, `useDurableNote.js`, `serverChange.js` or `settleNoteWrite.js`.
12. Raising `DB_VERSION`.
13. Q2-D **mobile shell** — `wave-q2-PRD.md:49-51` records its scope as OWNER-BOUND and unspecified until R lands.

## UNKNOWN — I could not determine these

1. **Whether `wave-q2-decisions.md` has been answered.** Its header says the
   twelve rows are recommendations for one owner pass "when the Q1 window
   closes"; I found no artifact recording that pass. This plan follows the
   recommendations and marks every one it leans on. **If the pass has not
   happened, T5 onward are owner-bound.**
2. **Whether Q1's 7-day observation window has closed, and with what verdict.**
   `PROGRAM-MANIFEST.md:1109` cites `wave-q1-gate-verdict.md` for criterion C-8;
   that file is **not on disk in this worktree** (`docs/notebook/` listing).
   `tools/nb_gate.py:23` writes it. `wave-q2-PRD.md:3-4` says *"Q2 does not begin
   until the Q1 7-day observation window closes (2026-09-19 00:45 ET) AND the
   owner says start"*, while `PROGRAM-MANIFEST.md:1141` says Q2-A starts "now".
   **Those two disagree and I did not resolve it.** The manifest is the
   contract and is later, so this plan assumes "now" — but say so before merging.
3. **The F5 amendment I was handed** — "every cell GREEN or NAMED" — see §0. Not
   in the repo. §6 is written against `zero INCONCLUSIVE rows`.
4. **The age bound (30 days) and the per-entry ceiling (2 MB) are mine.** Decision
   4 answered count and size only. Neither number is measured; both are argued.
5. **What a cached body actually costs in bytes.** The 50 / 25 MB pair implies a
   500 KB average, which nobody has measured against real member notes. The
   Wave 0 note about a ~210 KB note destroying an import batch
   (`project_notebook_migration_wave0_2026_09_01`) suggests the tail is long.
   **T4 should print a real distribution from a sandbox account before the flip
   packet claims the bound is comfortable.**
6. **Whether case 1 (T5) is Q2-A or a Q1 defect.** It changes behaviour for
   members with the Q1 wave on and Q2-A dark, unless it is gated on
   `offlineReadEnabled()` too — which would mean a Q1 hole stays open behind a Q2
   flag. I have gated it on the Q2-A flag for dark-means-dark; that may be the
   wrong call.
7. **Whether the origin quota can actually absorb 25 MB.** `wave-q2-PRD.md:76-77`
   says `uct_bars_v1` already holds ~550 MB. `storagePosture()`
   (`notebookDb.js:53-65`) can read `quota`/`usage`, but nothing in this repo has
   recorded a real reading on a member browser. Unmeasured.
8. **Whether `NotebookTab.jsx` is inside anyone else's freeze.** T9 edits it; the
   F5 freeze does not name it, and `rule12Paths.test.js` scopes OUT
   `notebook`-family branches. Not verified against R's or S's working set.
