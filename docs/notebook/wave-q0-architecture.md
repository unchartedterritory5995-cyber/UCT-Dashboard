# Wave Q0 — offline architecture, state and conflict design

```
SCOPE          RESEARCH + DESIGN ONLY · nothing implemented, nothing shipped
AUTHORITY      SERVER-AUTHORITATIVE WITH A DURABLE OFFLINE WORKING COPY (decided)
OFFLINE V1     ordinary note bodies EDITABLE · thesis/evidence/review READ-ONLY
CONFLICT       never clobber · preserve both · fork — reusing what already ships
STATUS         awaiting architecture approval
```

⛔ **Every "today" statement below was traced through the code**
(frontend → request → API → service → database → response → consumer) or
measured in the real browser. Where the answer is "there is none", it says so.
Stale comments were not trusted; two of the findings below contradict what the
surrounding comments imply.

---

## 0 · The three findings that shape everything else

### ⚰️ 0.1 The note editor's conflict handler does NOT preserve both versions

The Wave Q packet said the product has a "never clobber, always fork" precedent.
That is true **of the connectors**. It is **not true of the note write path**,
and the note write path is the one Wave Q is about to put an offline queue in
front of.

`NoteEditorPage.reconcileConflict()`, in full behaviour:

```
409 (server advanced past our baseUpdatedAt)
  → GET the fresh note
  → collect widgetEmbed nodes present on the SERVER but missing locally
  → append ONLY those into the local editor
  → advance the local baseline to the server's updatedAt
  → retry the PUT with the LOCAL document
```

⛔ **So any newer server change that is not a `widgetEmbed` — i.e. the member's
prose, the title, the subtitle — is overwritten by the local copy on the retry.**
The code is honest about its origin (the comment calls it "the appends rail",
built for the *Send to Journal* server-side append), but the effect on a
human-vs-human edit is last-write-wins after one automatic reconcile.

⛔ **And it has no rail.** The only 409 test in the Notebook is on version
*restore* (`NoteHistoryPanel.test.jsx`), which correctly refuses and tells the
member. The editor's reconcile path is untested.

⭐ **This is a pre-existing latent data-loss path, and offline makes it likely
rather than rare.** Today the second writer is almost always the server itself.
Offline editing manufactures the human-vs-human case on purpose: a member edits
for an hour on a plane while a second device or a Send-to-Journal append moves
the server on. **Q1 cannot ship before this is replaced with the fork posture.**

### ⚰️ 0.2 `persist()` is already granted, and the origin is already 559 MB deep

Measured on the production origin, Chrome desktop, the owner's profile:

```
navigator.storage.estimate()   quota 10,799 MB · usage 558.81 MB
usageDetails                   indexedDB: 585,954,494 bytes  ← ALL of it
existing databases             uct_bars_v1@2      (the chart bars store)
navigator.storage.persisted()  true, BEFORE persist() was called
service worker registrations   none · caches: none
localStorage                   84 `uct.*` keys
```

⭐ Durable storage is already granted for this origin, so Wave Q does not have
to earn it here. ⛔ **But the origin quota is shared**, and the chart-bars store
is already using 559 MB of it. A "500 MB per account" attachment budget would
sit *beside* that, not in an empty origin — and on iOS the ceiling is far lower
and eviction far more aggressive.

⛔ **Not measured, and not assumed:** Safari/iOS, Firefox, a fresh profile, and
private/incognito. §13.4 below makes measuring them a Q1 entry gate rather than
a footnote.

### ⚰️ 0.3 The repo has already been bitten by an IndexedDB version bump

`app/src/utils/barsIDB.js`:

```
DB_NAME = 'uct_bars_v1'
DB_VERSION = 2      // "Stay at v2. The v3 bump caused a deadlock: existing v2
                    //  connections held by other tabs blocked the upgrade."
CACHE_LOGIC_VERSION = 7   // stored IN every record; on mismatch the record is
                          //  ignored — logic changes without a version bump
```

⛔ Wave Q **guarantees** the multi-tab condition that caused that deadlock
(§12). The Notebook store must copy this shape — and with one difference that
matters: bars records are re-fetchable, **Notebook records may hold unsynced
member work**, so "ignore on logic mismatch" can never mean "discard" (§38).

---

## 1 · Current online note write state machine — traced, not guessed

```
                    ┌──────────────────────────────────────────────┐
   keystroke ──────►│ setSaveStatus('dirty')                        │
                    │ saveDraftLocally()   ← localStorage, SYNC,    │
                    │   uct.j2.notedraft.{id}  every keystroke      │
                    │ debounce 800ms (AUTOSAVE_MS)                  │
                    └───────────────┬──────────────────────────────┘
                                    ▼
                    ┌──────────────────────────────────────────────┐
                    │ commitSave()                                  │
                    │  diff vs lastSavedRef {title,subtitle,body}   │
                    │  no change → 'saved', return                  │
                    │  patch.baseUpdatedAt = lastSaved.updatedAt    │
                    │  status 'saving' (or 'reconnecting' on retry) │
                    └───────────────┬──────────────────────────────┘
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
   PUT succeeds              409 CONFLICT                 network / 5xx
   lastSaved ← saved         reconcileConflict()          retryable
   'saved'                   (once per edit)              RETRY_BACKOFFS_MS
   clearDraftLocally()       then retry in 50ms           'reconnecting'
   consumePlacedCaptures()   ⛔ local prose WINS          retry in-memory
                                                              │
                                                        4xx (not 409)
                                                              ▼
                                                    'error' + friendly msg
                                                    retries STOP
```

**Server side.** `PUT /api/j2/notes/{id}` pops `baseUpdatedAt` and passes it as
`update_note(expected_updated_at=…)`; a mismatch raises `NoteConflictError` →
**409**. Absent baseline = legacy last-writer-wins (the router says so).
`j2_note_versions` snapshots history; `restore_note_version` takes the same
compare-and-set.

**Unmount.** If a debounce timer is pending, it is cleared and `commitSave()`
runs immediately. ⛔ A *retry* timer is cleared and **not** run — so a tab closed
mid-backoff drops the queued attempt; only the localStorage draft survives.

**The local draft, exactly.** Written **synchronously on every keystroke**,
before the debounce. Cleared **only** on a successful PUT. On reopening the same
note it is offered **only if it differs** from the server's copy, as an explicit
Restore/Discard banner. It stores `{title, subtitle, bodyJson, savedAt}` — one
note, last write, no queue, no baseline.

**Save-status UI, as it actually renders.** Only two states are visible:
`'reconnecting'` → *"Reconnecting…"*, `'error'` → *"Save failed: …"*.
`saved`/`dirty`/`saving` render **nothing**.

⭐ Two consequences for §18: there is **no misleading green "Saved"** to remove —
absence of a badge means fine. But there is also **no vocabulary at all** for
"durable here, not yet on the server", and *"Reconnecting…"* currently means
"this tab is retrying in memory", which is a weaker claim than Wave Q needs.

---

## 2 · Proposed offline note state machine

Names extend the existing `saveStatus` rather than replacing it.

```
STATE              MEANING                                        DURABLE?
─────────────────  ─────────────────────────────────────────────  ────────
clean              matches the local base revision                 n/a
dirty              edited, not yet written to the local store      NO  ← today's only gap
local_saved        written to IndexedDB with a base revision       YES
queued             a mutation exists in the outbox                 YES
syncing            an attempt is in flight                         YES
synced             server accepted; base revision advanced         YES
conflict           CAS refused; BOTH versions preserved            YES
failed_retryable   network/5xx; backoff scheduled                  YES
failed_terminal    4xx that will not improve; member must act      YES
```

⛔ **`dirty` must be as short as possible and must never be the only state a
member's work is in.** Today it can last 800 ms plus a whole retry backoff.

**Transitions**

```
clean --edit--> dirty --(write IDB)--> local_saved --(enqueue)--> queued
queued --(online)--> syncing --200--> synced --> clean(new base)
syncing --409--> conflict          (fork; never overwrite either side)
syncing --network/5xx--> failed_retryable --(backoff)--> syncing
syncing --4xx--> failed_terminal   (surface; no silent retry)
conflict --(member resolves)--> queued | clean
```

⛔ **Every edit has a knowable state.** No "probably synced".

---

## 3 · Authority diagram

```
           ┌──────────────────────── SERVER (canonical) ────────────────────────┐
           │ j2_notes (+ _fts) · j2_note_versions · documents/pages/excerpts    │
           │ evidence · reviews · attachment bytes on the volume                │
           │ authority: updated_at, enforced by expected_updated_at (CAS)       │
           └───────────▲──────────────────────────────────┬────────────────────┘
                       │ PUT {..., baseUpdatedAt}         │ GET (fresh)
                       │                                  ▼
           ┌───────────┴──────────────────────────────────────────────────────┐
           │ OUTBOX  (IndexedDB, per account)                                 │
           │  one entry per note-mutation: {mutationId, noteId, base, patch}  │
           │  ordered, idempotent, retryable, survives tab death              │
           └───────────▲──────────────────────────────────────────────────────┘
                       │ enqueue on local_saved
           ┌───────────┴──────────────────────────────────────────────────────┐
           │ LOCAL WORKING COPY  (IndexedDB, per account)                     │
           │  note record: {noteId, baseUpdatedAt, baseBody, workingBody, …}  │
           │  ⛔ NOT a source of truth — a working copy WITH its base revision │
           └───────────▲──────────────────────────────────────────────────────┘
                       │ every keystroke (debounced ~150ms, not 800ms)
                 ┌─────┴──────┐
                 │  EDITOR    │
                 └────────────┘

   CONFLICT FORK: server version stays canonical; the offline version is
   preserved as a sibling using the connectors' existing vocabulary.
```

⛔ **The local record always carries the base revision it was derived from.**
A working copy without its base cannot be reconciled — it can only be imposed.

---

## 4 · IndexedDB candidate schema

```
DB NAME      uct_notebook_{accountId}        ← §5, namespacing by DATABASE
DB_VERSION   1  and then FROZEN              ← §0.3, the bars deadlock
RECORD_LOGIC_VERSION  stored in every record, checked on read

store: notes            key noteId
  { noteId, accountId, baseUpdatedAt, baseBody, baseTitle, baseSubtitle,
    workingBody, workingTitle, workingSubtitle, dirty:bool,
    lastLocalSaveAt, logicVersion, tier }
  index: byDirty, byLastLocalSaveAt (LRU), byTier

store: outbox           key mutationId (client-generated, stable)
  { mutationId, accountId, noteId, baseUpdatedAt, patch, createdAt,
    attempts, nextAttemptAt, state, lastError }
  index: byNote, byState, byNextAttemptAt

store: conflicts        key conflictId
  { conflictId, noteId, localBody, serverBody, serverUpdatedAt,
    detectedAt, resolution }

store: attachments      key documentId
  { documentId, noteId, pinnedAt, bytesLength, contentType, sha256,
    state: 'pinned'|'evicted', blob }          ← bytes live here, §14

store: meta             key name
  { schemaVersion, accountId, lastFullSyncAt, quotaSnapshot }
```

⛔ **Never bump `DB_VERSION`.** Logic changes bump `RECORD_LOGIC_VERSION`, and a
record whose logic version is stale is **migrated or quarantined, never
discarded**, because it may hold unsynced work (§0.3, §38).

⛔ **`blob` lives in its own store** so a note read never drags a 25 MB PDF into
memory (§37).

---

## 5 · Account namespacing

⛔ **Namespacing by DATABASE NAME (`uct_notebook_{accountId}`), not by a column.**
A `WHERE accountId = ?` filter is one forgotten predicate away from cross-account
leakage, which the directive calls a release blocker. A wrong database name
yields *no data*, which is a safe failure.

- `accountId` is also stored **in every record** as a second, independent check;
  a record whose `accountId` disagrees with its database is treated as corrupt.
- On login: open only that account's database.
- On logout: **delete the database** (§9).
- On account switch: close the old handle before opening the new one; never hold
  two open.

---

## 6 · Queue and idempotency

**First question, and it must be answered from code before designing anything:
is the current endpoint already safe to retry?**

`PUT /api/j2/notes/{id}` with `baseUpdatedAt` is a **compare-and-set on the full
patch**. A duplicate delivery of the *same* mutation either (a) still matches the
baseline and re-applies an identical patch — idempotent in effect — or (b) no
longer matches and 409s. ⭐ **So the existing endpoint is already retry-safe for
note bodies, and Wave Q does not need a server-side idempotency key for Q1.**

**And the history table looks safe too — but this is a comment, not a
measurement.** `_versioned_content_of` compares title/subtitle/body_plain/
properties as raw strings and its docstring states *"a byte-identical resave
never spuriously versions"*, with `J2_VERSION_COALESCE_MINUTES = 30` coalescing
on top. ⛔ §46 says not to trust a comment: **Q1 carries a rail that re-PUTs an
identical patch and asserts `j2_note_versions` gains no row.** If that rail goes
red, the outbox needs a server-side idempotency key after all.

**Client-side mutation identity** is still required, for the outbox itself:

- `mutationId` = stable client id, generated once when the entry is created.
  ⛔ `crypto.randomUUID` is **secure-context only** — this repo has been bitten
  by that before; fall back deliberately.
- **Coalescing**: successive edits to one note collapse into ONE outbox entry
  (full-document PUT semantics make the newest patch a superset). Only the
  baseline of the *first* unsynced edit is kept.
- **Ordering**: per-note serial. Cross-note parallelism is allowed.
- An entry is removed only after a 2xx.

---

## 7 · Reconnect protocol

⛔ **`navigator.onLine` is a hint, never authority** — Wi-Fi with no path to UCT
is offline. ⭐ The codebase already models this correctly in `AuthContext`:
*"the backend did not ANSWER (≥500 or fetch threw)"* vs *"the backend answered
no (4xx)"*, with an `authTransient` flag. Wave Q reuses that distinction rather
than inventing a second one.

```
1  reachability = a real request to a cheap authenticated endpoint
2  on transition offline→online, and on tab focus:
      a. validate the session FIRST (§10) — never flush into a dead session
      b. drain the outbox, per note, oldest first
      c. for each entry: PUT with its stored baseUpdatedAt
           200 → advance base, drop entry, clear the note's local dirty flag
           409 → CONFLICT (§8). Do NOT retry. Do NOT auto-resolve.
           5xx / network → backoff, keep the entry
           4xx → failed_terminal, surface it
3  after the outbox is empty, refresh the working copies for cached notes
```

⛔ **The outbox is drained; it is never "replayed on top of" a fresh fetch.**

---

## 8 · Conflict protocol — the connectors' vocabulary, brought to the note path

The connector engine already ships the posture and the member-visible words:

> a sibling under `{key}#remote` titled **"{title} (synced copy)"**, with **both**
> the sibling and the untouched original tagged **`sync-conflict`**; the write is
> optimistic-locked so a concurrent user edit can never be clobbered.

**Proposed offline conflict, deliberately the same shape:**

```
CAS refused (409)
  1. do NOT overwrite the server
  2. do NOT discard the local copy
  3. fetch the server version (it stays canonical, untouched)
  4. write the offline version as a sibling — "{title} (offline copy)"
  5. tag BOTH `sync-conflict`
  6. record a `conflicts` entry so the UI can offer a side-by-side
  7. the outbox entry is resolved; the member decides what to keep
```

⛔ **No auto-merge in Q0/Q1.** A mechanically clean text merge can be
semantically wrong in exactly the places that matter — a changed number, a
deleted caveat, an inverted thesis sentence.

⛔ **`reconcileConflict()`'s current prose-overwrite must be replaced by this
before offline editing ships** (§0.1). Its widget-append behaviour is still
wanted for the server-append case; that becomes one branch of the new handler,
not the whole of it, and it gets the rail it never had.

---

## 9 · Logout and unsynced work

**Decided: purge local research data on logout.** Notes, working copies, outbox,
attachment bytes, cached reads, metadata — for the account logging out.

⛔ **But logout must not silently destroy unsynced work.** Proposed flow:

```
logout requested
  → is the outbox empty AND no note dirty?
      yes → purge, log out. No prompt. (the common path stays silent)
      no  → BLOCK and tell the truth:
            "N changes are saved on this device but not yet synced to UCT."
            [ Reconnect and sync ]  [ Download a copy ]  [ Discard and log out ]
```

- **Reconnect and sync** — drain, then purge and log out.
- **Download a copy** — export the unsynced note bodies to a file the member
  keeps. ⛔ This is the escape hatch that makes "discard" honest.
- **Discard and log out** — explicit, typed-confirmation-worthy, and it says how
  many notes are being discarded.

⛔ A crash or a closed tab is not a logout: unsynced work simply stays until the
next login **as the same account**.

---

## 10 · Session expiry while offline

Traced: sessions are a cookie token validated **server-side** against
`auth.db`, `SESSION_TTL_DAYS = 30`, deleted on expiry. ⛔ **There is no offline
identity mechanism whatsoever** — the client cannot verify a session without the
network, and nothing local records when the session would expire.

Proposed model, and it deliberately separates *reading* from *syncing*:

```
offline, session believed valid   → read cached research · edit note bodies
                                    (the work is the member's own, on their device)
offline, beyond a LOCAL SOFT TTL  → keep the data, keep it readable, but show
                                    "Reconnect to continue syncing"
reconnect                         → RE-VALIDATE THE SESSION FIRST
    session valid                 → drain the outbox
    session invalid/expired       → do NOT drain. Require login. On successful
                                    login AS THE SAME ACCOUNT, the outbox is
                                    still there and drains normally.
                                    On login as a DIFFERENT account → §5/§9:
                                    the other account's database is never opened
                                    and never merged.
```

⛔ **Never flush an outbox into an unauthenticated or newly-authenticated
session.** ⛔ And do not silently lock a member out of their own writing because
a clock passed a threshold while they were on a plane.

**Open decision for the owner:** should a local soft TTL ever *hide* cached
research (a shared-device argument), or only stop syncing? Recommendation:
only stop syncing in v1, because hiding invites a member to believe the data is
gone when it is not.

---

## 11 · Account deletion / access revocation

⛔ **Be honest about the physical limit**: a disconnected device retains what it
has. UCT cannot reach it. No claim of instantaneous remote deletion.

```
next successful reachability + auth check
   account gone / access revoked / session rejected as invalid-user
   → purge that account's database immediately, before any UI renders it
   → and before any outbox drain is attempted
```

⛔ The purge must run on the **auth answer**, not on a UI route change, so it
cannot be skipped by a member who never navigates.

---

## 12 · Multi-tab

Traced: the repo uses **no `BroadcastChannel` and no Web Locks anywhere**. The
only cross-tab mechanism in use is the `storage` event, and only for feature
flags and UI preferences — never for data.

⛔ Wave Q's failure mode is precise: two tabs editing one note offline, both
writing IndexedDB, one reconnecting first. Browser tab ordering must not become
a silent last-write-wins.

Proposed, smallest thing that works:

```
LEADER          navigator.locks.request('uct.nb.sync.{accountId}') held for the
                session; ONLY the leader drains the outbox. Others enqueue.
NOTE EDIT LOCK  navigator.locks.request('uct.nb.note.{noteId}') around the
                read-modify-write of a note record, so two tabs cannot
                interleave a working-copy update.
NOTIFY          BroadcastChannel('uct.nb.{accountId}') for "note X changed",
                "outbox drained", "conflict created" — a hint to re-read, never
                a data channel.
FALLBACK        no Web Locks (older Safari) → single-writer election via a
                heartbeat record in `meta`, and if that fails, degrade to
                "this tab is read-only for sync" rather than racing.
```

⛔ **Evaluate before implementing.** A tiny spike is justified here; a design
that assumes Web Locks everywhere is not.

---

## 13 · Storage, quota and eviction

**13.1 Two budgets, never one.**

```
NOTE TEXT / METADATA   cheap, automatic, bounded, LRU-evictable
PINNED ATTACHMENTS     expensive, explicit member intent, NOT silently evicted
```

**13.2 Measured, not assumed** (Chrome desktop, production origin, owner
profile): quota **10,799 MB**, usage **558.81 MB — entirely `uct_bars_v1`**,
`persisted() === true` already.

⛔ **The origin is shared with the chart-bars store.** Any Notebook budget is
carved out of a quota something else is already using, and a Notebook eviction
policy that ignores the bars store will fight it.

**13.3 The ~500 MB per-account attachment target is a PLANNING figure**, not a
guarantee, and must not be hard-coded before 13.4.

**13.4 Q1 entry gate — measure before designing the policy:**

```
Chrome desktop      quota, persist(), eviction under pressure          [measured]
Safari / iOS        quota, persist() grantability, 7-day eviction      [NOT measured]
Firefox             quota, persist() prompt behaviour                  [NOT measured]
fresh profile       is persist() granted without user gesture?         [NOT measured]
private / incognito quota, whether IDB persists at all                 [NOT measured]
```

**13.5 Policy sketch.**

- Notes: retain by tier (§17), LRU-evict non-pinned beyond the budget.
- Attachments: never auto-evicted while pinned. On quota exhaustion, **refuse
  the new pin and say so** rather than silently dropping an old one.
- On every open: `navigator.storage.estimate()` into `meta.quotaSnapshot`, so the
  UI can warn *before* the platform starts evicting.

---

## 14 · Attachment pinning

⛔ **No automatic caching of attachment bytes.** A 25 MB scan is the normal unit.

```
ONLINE ONLY        default. Server required.
METADATA AVAILABLE title, page count, OCR text if cached — bytes ABSENT
AVAILABLE OFFLINE  bytes verified present in the `attachments` store
```

⛔ **"Available offline" must be verified against the store, not inferred from a
flag.** A pinned attachment the browser evicted must stop claiming availability
the moment it is gone — check on render, and on a storage-pressure event.

Member action: **"Make available offline"** on the document, with its size shown
before the download. Unpinning deletes the bytes immediately.

⛔ Today nothing in app code even touches attachment bytes: the viewer hands the
authenticated URL to pdf.js (`loadPdfDocument(href)`). Pinning therefore
introduces the **first** client-side byte path — Q4, not earlier.

---

## 15 · Service worker / app-shell separation

⛔ **Wave Q does not start here, and Q1–Q4 do not touch the service worker.**

§0's history, reconstructed from the removed file (`edc7c4b4b`):

```
CACHE_VERSION = 'uct-shell-v1'     ← a hand-typed constant that NEVER changed,
                                     so activation's "delete keys ≠ VERSION"
                                     purged nothing on a new deploy
static assets  cache-first          ← safe in isolation: Vite emits CONTENT-HASHED
                                     filenames, so a stale hash is a different file
navigation     network-first, and it PUT the HTML into the same cache, falling
               back to caches.match(request) then '/index.html'
```

⭐ **The exact failure:** `index.html` — the entrypoint that *names which hashed
bundles to load* — was cached in the same bucket as immutable hashed assets, with
no build identity to tell them apart. A stale entrypoint names old hashes; those
are cache-first and still present; the browser then serves a coherent **old app**
indefinitely.

**Non-negotiables for any future app-shell slice (Q5):**

1. A **build identity** (deploy commit) baked into the SW, so activation can tell
   old from new. Never a hand-typed constant.
2. **The entrypoint is never cache-first.** Immutable hashed assets may be;
   `index.html` may not.
3. **Update detection + activation** proven, including what an open tab does.
4. **Stale-bundle retirement** proven across a real deploy.
5. **Frontend/backend compatibility** — an old shell talking to a new API.
6. **Rollback** — how to get every browser off a bad SW without a manual clear.

⛔ *App shell offline ≠ research data offline ≠ editing offline ≠ sync
correctness.* Research offline is not complete because JS and CSS load.

---

## 16 · Q1–Q5 implementation plan

```
Q1  DURABLE NOTE WORKING COPY + OFFLINE EDITING + RECONNECT HAPPY PATH
    entry gate: 13.4 storage measurements on every target browser
    entry gate: §0.1 — replace reconcileConflict's prose-overwrite, with rails
    · IndexedDB store (notes + outbox + meta), per-account DB
    · editor writes the working copy (~150ms) instead of localStorage
    · outbox drain on reachability, CAS with the stored base
    · save-status vocabulary (§18)
    · localStorage draft: §19 decision below
    exit: the flagship journey with the network cut, tab closed, reopened

Q2  CONFLICT / FORK UX + RETRY + MULTI-TAB
    · the fork protocol (§8) end to end, with the connectors' words
    · side-by-side recovery of both versions
    · idempotency measured (does an identical re-PUT double-version?)
    · Web Locks leader election + BroadcastChannel notification, with fallback
    exit: two tabs, one note, network cut, both edit — no silent loss

Q3  OFFLINE READ CACHE
    · tiers (§17), navigation/recents/favourites offline
    · read-only thesis/evidence/review with disabled-with-reason controls
    · scoped local search ONLY if justified — and never labelled "My Notebook"
    exit: a member can navigate and read without a network

Q4  ATTACHMENT PINNING
    · the attachments store, the first client-side byte path
    · quota accounting beside the bars store, eviction, refusal-on-exhaustion
    · the three-state truth (§14), verified against the store
    exit: a pinned scan opens with the network off; an evicted one says so

Q5  MOBILE + COLD OFFLINE APP SHELL + LIFECYCLE/SECURITY + CLOSURE
    · the §15 non-negotiables, proven across a real deploy
    · mobile certification with P5's eleven-step discipline
    · logout/session/deletion/shared-device, performance at 100/1k/5k notes
    exit: production closure
```

⛔ **Q1 is not first because it is easiest.** It is first because every later
slice depends on the working-copy and base-revision contract being right.

---

## 17 · Read-offline content tiers (proposed, not implemented)

```
TIER 1  the notes a member actually returns to — recent, favourited, currently
        open — plus folder/navigation metadata and local drafts.  AUTOMATIC.
TIER 2  read-only thesis / evidence / review representations for cached notes.
TIER 3  explicitly pinned attachments and their OCR text.  MEMBER INTENT ONLY.
TIER 4  a bounded local search index over cached content — ONLY if Q3 shows it
        earns its size, and never presented as the whole Notebook.
```

---

## 18 · Product UX states

```
(nothing)             clean / synced — the common case stays silent
"Saved on this device" local_saved or queued while offline
"Waiting to sync"      queued, reachable-but-not-yet-drained
"Syncing…"             in flight (only if it lasts long enough to matter)
"Synced"               brief confirmation after a queued edit lands
"Conflict — review"    both versions preserved; a route to the comparison
"Save failed: …"       failed_terminal, unchanged from today
```

⛔ **PERMANENT RULE: SAVED ON THIS DEVICE ≠ SYNCED TO UCT.** The two must never
share a word or a colour.

⭐ Today's UI shows nothing for `saved` and *"Reconnecting…"* for retry, so there
is no false green to remove — but *"Reconnecting…"* currently means "this tab is
retrying in memory", and once the outbox is durable that must become
**"Waiting to sync"**, which is a claim about the member's data rather than about
this tab.

**Finance-native controls offline** must be *disabled with the reason visible
before the click* — "Reconnect to update this thesis" — never enabled buttons
that fail after submit.

---

## 19 · The localStorage draft, once IndexedDB exists

⛔ **Two uncontrolled local sources of truth is the outcome to avoid.**

Measured today: written **synchronously on every keystroke** (before the 800 ms
debounce), cleared **only** on a successful PUT, offered on reopen **only if it
differs** from the server copy.

**Recommendation: option B — fold it into the durable subsystem, but not on day
one.** IndexedDB writes are asynchronous, so during Q1 the localStorage write
remains the only *synchronous* crash-window cover. Sequence:

```
Q1   IndexedDB becomes the durable working copy.
     localStorage stays ONLY as the synchronous last-keystroke buffer, and is
     read at open ONLY when no IDB working copy exists for that note.
     ⛔ IDB wins on any disagreement — one authority, explicitly.
Q2   measure whether the IDB write actually loses the crash window. If it does
     not, delete the localStorage path and its Restore/Discard banner.
```

⛔ Do not delete it in Q1 on the assumption that IDB is fast enough. Measure.

---

## 20 · Out of scope, stated so it stays out

- **Offline Ask / LLM** — Ask requires network; say so. ⛔ Never present a cached
  prior answer as a fresh model response.
- **Browser-side OCR** — Tesseract does not go to WASM for parity. Already-synced
  OCR text may be *read* offline; execution stays server-side.
- **Offline destructive actions** — trash, permanent delete, restore all require
  a connection until their reconciliation semantics are designed.
- **Offline thesis / evidence / review writes** — read-only in v1 (§3 of the
  directive). These are dated claims and reconciliation must not rewrite when a
  decision was made.
- **Full offline search** — not by default; and a partial local corpus is never
  labelled "My Notebook".

---

## 21 · Risks and stop gates

**Bring back to the owner rather than proceeding, if the design starts to
require:**

- replacing server authority · a CRDT · silent last-write-wins
- storing research without a credible logout/account boundary
- clearing the local database as ordinary conflict or migration recovery
- rebuilding a cache-first service worker before build-identity semantics exist
- offline writes to thesis / evidence / review
- destructive offline actions
- broad attachment caching without the 13.4 quota evidence

**Wave-Q-specific risks already visible:**

1. ⚰️ **§0.1 — the note path overwrites server prose on 409, and has no rail.**
   This is a *pre-existing* latent defect that offline converts into a likely
   one. **Q1 entry gate.**
2. **The origin quota is shared with a 559 MB bars store.** Budgets designed in
   isolation will collide.
3. **`DB_VERSION` bumps deadlock across tabs** — proven in this repo.
4. **A tab closed mid-backoff drops the in-memory retry today.** Members already
   rely on the localStorage draft without knowing it.
5. **Safari/iOS is entirely unmeasured** and is where offline matters most.
6. **`crypto.randomUUID` is secure-context only** — a known trap here.

---

## 22 · Decisions needed before Q1 starts

1. **§0.1** — confirm that replacing the note path's 409 prose-overwrite with
   the fork posture is in Q1's scope. **Recommended: yes, as an entry gate.**
2. **§10** — should a local soft TTL ever *hide* cached research, or only stop
   syncing? **Recommended: only stop syncing in v1.**
3. **§13.4** — which browsers must be measured before Q1 is allowed to start?
   **Recommended: Chrome desktop (done), Safari/iOS, and one fresh profile.**
4. **§9** — is "Download a copy" required in the logout-with-unsynced-work flow,
   or is reconnect-or-discard enough? **Recommended: required — it is what makes
   "discard" an honest option.**
5. **§19** — accept the two-step localStorage retirement, or delete it in Q1?
   **Recommended: two-step, and measure.**
6. **Scope of Q1's offline editing** — note *body/title/subtitle* only, or also
   properties, tags and folder moves? **Recommended: body/title/subtitle only.**
