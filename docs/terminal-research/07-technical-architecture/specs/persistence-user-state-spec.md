---
id: SPEC-S5-PERSISTENCE-USER-STATE
title: S5 Persistence & User State — the durable pattern this codebase already built, ratified
role: spec pass only. No code is authorized by this document. It names three persistence classes that already exist, ratifies one shape as the durable answer, and states what a second adopter would cost.
phase: 3
group: technical-architecture
category: spec
status: SPEC ONLY — nothing built, nothing authorized. Pairs with GATE-S5-PERSISTENCE-USER-STATE, whose approval block is empty.
date: 2026-09-12
measured_against: origin/master @ 5ff6fc04a
pairs_with: GATE-S5-PERSISTENCE-USER-STATE
confidence: >
  🟢 on every statement about what the code does today — each was read from source this pass and
  the file and line are named; every count in §9 was produced by a script whose method is stated
  beside it. 🟡 on the proposed shape in §6 and §7, which composes existing mechanisms and has
  not been built or reviewed. ⚠️ PROVENANCE, STATED: the application source was read from the
  working tree of the `s7-price-level` worktree during this pass. No git command was run — the
  task forbade it — so this document has NOT confirmed that tree is identical to
  `origin/master @ 5ff6fc04a`. The SHA in `measured_against` is the one the task supplied; treat
  it as a label on the intent, and re-derive any load-bearing count before acting on it.
sources: >
  application source read this pass — `app/src/pages/journal-2-0/lib/offline/**` (19 production
  modules), `api/routers/journal_two.py`, `api/services/journal_two/notes.py`,
  `app/src/hooks/usePreferences.js`, `api/routers/auth.py`, `api/services/auth_service.py`,
  `api/services/auth_db.py`, `app/src/pages/charts/ChartsWorkspace.jsx`,
  `app/src/pages/charts/grid/useMultiChartState.js`, `app/src/components/chart/useTracingsSync.js`
  · program artifacts — SPEC-S12-ROLLOUT, GATE-D2-CANONICAL-DATA-MODEL, C5-02
---

# S5 — Persistence & User State: spec pass

## 0. The one-sentence version

**This codebase already contains a complete, production-live, offline-first durable-state pattern
— the Notebook's Wave Q1 layer — and S5's job is to RATIFY it as the programme's shape, name the
two other persistence classes it must never be confused with, and state what the second adopter
would cost. S5 designs nothing new.**

---

## 1. ⭐ The finding that decides the shape of this document

> **The owner's instruction for D2 was "find the implicit canonical form; the spec ratifies it
> rather than inventing a second." The same instruction applies here, and the answer is stronger:
> the form is not implicit. It is 3,163 lines of production code with 5,040 lines of rails behind
> it, it is ON by default for every member, and it has already survived a rollback and a
> re-activation.**

Measured this pass (method in §9.1): `app/src/pages/journal-2-0/lib/offline/` holds **19
production modules / 3,163 lines**, with **21 test files / 5,040 lines** beside them.
`OFFLINE_DEFAULT_ON = true` at `app/src/pages/journal-2-0/lib/offline/offlineFlag.js:66`, so the
durable working copy, the outbox, the Web Locks leader election and the fork-never-clobber
conflict path are the DEFAULT path, not an opt-in. The only per-browser off is an explicit `'0'`
in `localStorage['uct.j2.offline.enabled']` (`offlineFlag.js:70-77`).

⛔ **THE CONSEQUENCE, STATED PLAINLY: a proposal that designed a persistence architecture from
first principles would be the wrong answer to a measured question.** It would also be the
second-authority defect this programme keeps paying for — and in this case the second authority
would be competing with a layer that has already been driven against seven real browser
environments including two physical iPhones (`offlineFlag.js:35-39`).

⛔⛔ **AND IT HAS EXACTLY ONE ADOPTER.** Measured with a controlled search (§9.6): every import of
anything under `lib/offline/**` from outside that directory — 22 import lines across 14 files —
lands inside `app/src/pages/journal-2-0/`. **Zero outside it.** The control is that the same
search *did* find those 22, so it can see a presence; the absence is real. The hard part is
built; the generalisation is not.

---

## 2. (a) The three persistence classes, and the rule for choosing

This app persists per-member state three structurally different ways. They are routinely spoken
of as one thing ("prefs", "state", "saved"), and that is the confusion this section exists to end.

| | class | store | who is authoritative | survives | fails how |
|---|---|---|---|---|---|
| **P1** | **SERVER-AUTHORITATIVE** | `user_preferences` (`api/services/auth_db.py:230`) and the `j2_*` tables (`api/services/journal_two/db.py`) | the server row | device loss, browser reset, reinstall | a failed POST is reported by a return value and nothing retries (`usePreferences.js:146-151`) |
| **P2** | **CLIENT-DURABLE** | IndexedDB `uct_notebook_{accountId}` — four object stores `notes` / `outbox` / `conflicts` / `meta` (`notebookDb.js:31-41, 67-82`) | the member's device, until the outbox drains | a closed laptop, an offline flight, a dead server | a private window or an old browser reports `supported:false` and the product degrades truthfully (`useDurableNote.js:331-332`) |
| **P3** | **PER-VIEWER CONVENIENCE** | `localStorage` — **59 distinct string-literal keys across 130 call sites** in `app/src` (§9.4) | this browser profile only | a page reload | a cleared profile, a private window, a second device — silently, with no signal |

### 2.1 The rule for choosing, as three questions in order

⛔ **Ask them in this order. The first YES decides, and the later questions are not a vote.**

1. **If this were lost, would the member have lost WORK they authored?**
   Prose, a plan, a review, a note, a journal entry. **YES ⇒ P2 + P1 together** — a durable local
   copy with an outbox that reaches a server-authoritative row. Never P1 alone: a debounced POST
   is a promise the network can break, and the member typed the words.
2. **Does the member expect this to be the same on their phone?**
   A layout, a watchlist, a theme, a saved screen. **YES ⇒ P1.** P3 cannot answer it, and a P3
   key that a member believes syncs is the defect C5-02 §8 names as UCT's own unstated gap.
3. **Otherwise ⇒ P3.** A collapsed section, a remembered tab, a scroll position, a per-browser
   kill switch. These are conveniences, and the honest property of a convenience is that it may
   be gone tomorrow.

⛔ **A KEY MAY NOT LIVE IN TWO CLASSES.** The one legitimate exception in the codebase today is
`useTracingsSync`, and it is explicitly a P3 store with a P1 mirror and a documented
last-write-wins caveat (`useTracingsSync.js:14-17`) — which is exactly why it is this spec's
recommended second adopter (§7).

⚠️ **AND P3'S SIZE IS THE ARGUMENT.** 59 keys is not a handful. Nothing in the product tells a
member which of their settings travel and which do not, and this spec does not propose to fix
that — it proposes to stop the number growing for anything that answers YES to question 1 or 2.

---

## 3. (b) The ratified shape — the Notebook pattern, in five parts

This is a description, not a design. Every part below is running in production today.

### 3.1 A durable working copy, written with its sync intent in ONE transaction

`putNoteWithIntent(db, noteRecord, outboxEntry)` writes the note record and its outbox entry in a
single multi-store IndexedDB transaction (`notebookDb.js:148-165`). The reason is in the file:

> *"A crash between 'the note now says B' and 'the outbox still asks to send A' leaves the
> member's durable state and what we will tell the server about it disagreeing — the worst shape
> available to an offline system, because both halves look healthy on their own."*
> — `notebookDb.js:137-143`

Two supporting rulings ride with it and are part of the ratified shape:

- **One database per account, by NAME** — `uct_notebook_{accountId}`, never one database with an
  `accountId` predicate (`notebookDb.js:37-41`). A wrong database name yields no data; a
  forgotten `WHERE` yields another member's research. The safe failure is made structural.
- **`onversionchange` is installed on every connection, from version 1** (`notebookDb.js:117-123`),
  measured against a real upgrade deadlock rather than inherited from `barsIDB`'s frozen-version
  folklore (`notebookDb.js:10-21`).
- **`deleteDatabase()` is not a recovery strategy** (`notebookDb.js:27-28`).

### 3.2 A coalescing, order-safe writer between the keystroke and the disk

`createDurableWriter` (`durableWriter.js:49-135`) debounces at 200 ms and coalesces to the
member's LATEST state. Its justification is a measurement, not a preference — Chrome 152,
production origin, a 48 KB note, 40 writes: **IndexedDB p50 282.6 ms / p95 800.7 ms** against
**localStorage p50 1.0 ms** (`durableWriter.js:6-17`). Its p95 is as long as the entire server
autosave debounce, so a per-keystroke durable write would enqueue faster than it commits.

⛔ **Order is enforced, not assumed.** Every scheduled state carries a monotonic generation and a
completion may only ever advance the committed one — `Math.max`, not assignment
(`durableWriter.js:80-83`). A late callback for an older snapshot can neither mark newer work
durable nor resurrect it.

⛔ **A failed write does not drop the intent** (`durableWriter.js:92-99`), and nothing depends on
`beforeunload`/`pagehide` (`durableWriter.js:28-31`).

### 3.3 An outbox keyed by the thing, not by the edit

The outbox entry id is `note:<noteId>` (`useDurableNote.js:59`). That is load-bearing in a way
worth naming: a fresh durable write REPLACES the queued entry rather than appending a second one,
which is what makes "edit it again to sync" a true instruction for a blocked note
(`unsyncedCopy.js:36-48`).

### 3.4 Leader election — exactly one tab drains

`claimSyncLeadership` (`outboxLeader.js:46-94`) uses Web Locks, measured available and granted on
the production origin (`outboxLeader.js:10-14`). Three properties are the shape:

- **It resolves as soon as the ROLE is known**, not when a lock is acquired — a follower still
  edits, persists and queues, and must not be blocked behind the leader's lifetime
  (`outboxLeader.js:37-45`).
- **The fallback is not "everyone tries."** Without Web Locks a tab is `READ_ONLY_FOR_SYNC`: it
  edits, persists durably, queues — and never drains (`outboxLeader.js:16-20, 53-56`). *"A
  degraded mode that races would be worse than one that waits, because the race corrupts and the
  wait only delays."*
- **A bounded wait, not a microtask race** (`outboxLeader.js:70-76`). An earlier version settled
  FOLLOWER after two microtasks, which in a real browser would have beaten every genuine grant
  and left the account with **no leader at all — nothing drains, and every check stays green.**
- **BroadcastChannel is a HINT channel, never a data channel** (`outboxLeader.js:22-23, 114-133`).

### 3.5 Conflict FORKS; it never clobbers — and the fork is classified, not assumed

The drain's contract (`outboxDrain.js:6-16`): no merge, no last-write-wins, no clock comparison
anywhere in the file. A transient failure leaves the entry queued; a permanent 4xx retires it from
retrying but keeps it; a 409 preserves **both** versions.

The compare-and-set is real and it is the server's: the client sends `baseUpdatedAt`
(`outboxDrain.js:256`), `PUT /api/j2/notes/{note_id}` pops it (`api/routers/journal_two.py:2670`)
and passes it as `expected_updated_at`; `notes.update_note` raises `NoteConflictError` when the
row's `updated_at` no longer matches (`api/services/journal_two/notes.py:2080-2081`), which the
router turns into **409** (`journal_two.py:2676-2677`). Absent baseline = legacy
last-writer-wins, stated in the docstring (`notes.py:2065`).

⭐ **The fork is not the first answer to a 409 — it is the last one, and the ladder between is
the most valuable thing in this layer.** `serverChange.js:12-31` classifies the DIFF of the
returned note against the last known one — **never** which endpoint was called, because *"an
endpoint's shape can change in a later wave; a diff of two documents cannot lie about what is in
them"*:

| shape | what it means | what the drain does |
|---|---|---|
| `METADATA_ONLY` | body/title/subtitle byte-identical; only folder/ticker/tags/hero moved | **REBASE and send. Never fork.** |
| `APPEND_ONLY` | the server appended whole blocks it appends on its own behalf (`widgetEmbed`, `financialFact`, `documentExcerpt`) | **MERGE those blocks and send. No fork.** |
| `BODY_REWRITE` | anything else, **and anything it cannot prove** | **FORK-NEVER-CLOBBER. Preserve both copies.** |

And two guards sit before the ladder, both narrow on purpose (`outboxDrain.js:419-436`):

> *"A 409 IS NOT PROOF SOMEBODY ELSE WROTE."* For a member with one device the commonest cause is
> this browser's own save landing while the queue had not caught up. Forking on that manufactures
> a `(conflicted copy)` of a note nobody else touched. ⛔ *"Discarding on ANY 409 would silently
> drop a genuine second-writer conflict, which is the one case that MUST fork."*

⛔ **A fork must never empty the working copy** (`outboxDrain.js:82-92`) — every field falls back
to `''` or `null`, so a fork that returns a thin note cannot blank the local record.

### 3.6 ⭐⭐ THE COORDINATION MACHINERY IS NOT OVERHEAD — RECORDED HERE BECAUSE IT WAS ONCE READ AS OVERHEAD

> **The leader election, the landed-revision ring, the in-flight markers and the server-change
> classifier are what make the MEMBER'S OWN path REBASE instead of FORK. Deleting them does not
> simplify the working path — it breaks it.**

This is not an aesthetic claim. It is the correction of a published finding, and the correction is
in the source. `settleNoteWrite.js:5-27` records what happened on 2026-09-12, live on production:

- Wave Q1's own record named *"the FOUR doors — every path that advances `updatedAt`"*. That list
  was derived from **what a canary happened to drive**, not from what the product does.
- Enumerating from the other side — every server-side `updated_at` writer and every client write
  to `/api/j2/notes/*` — found **six** client doors across **two** endpoint families
  (`POST|DELETE /notes/{id}/hero`, `POST /notes/{id}/embeds`).
- **Exactly one of them recorded its landing.** The other five advanced the server revision and
  told the drain nothing, so the "is this our own revision?" guard answered *"not ours"* about
  this browser's own write **and forked the note.**

⭐ The fix was **recording, not settling**: `settleNoteWrite` is now imported by 14 files inside
`pages/journal-2-0/` (§9.6) precisely so every door that advances a revision says so.

⛔ **The rule S5 ratifies from this: a second-writer fork is the CORRECT answer to a genuine
second writer, and a member changing a ticker in another tab is not one.** Any future proposal to
"simplify" by removing the leader lock, the landed ring, or the diff classifier must first say
which of those two cases it intends to break — because it will break one.

---

## 4. (c) What S5 owes Notebook — taken as given, not re-decided

⛔ **These are inputs to S5, not outputs of it. A future S5 document that re-opens any row below
is re-litigating a closed call against a live production system.**

| # | Taken as given | Where it is decided |
|---|---|---|
| N-1 | **A durable working copy and its sync intent move together, in one transaction.** | `notebookDb.js:137-165` |
| N-2 | **One IndexedDB database per account, by NAME.** Cross-account leakage is prevented structurally, not by a predicate. | `notebookDb.js:37-41` |
| N-3 | **`onversionchange` on every connection, from v1.** Not optional, and not re-derivable from `barsIDB`'s frozen-version history. | `notebookDb.js:10-21, 117-123` |
| N-4 | **Durable writes are debounced and coalesced (~200 ms), with monotonic generations.** The number is a Chrome measurement and is labelled as an initial operating point, not a universal fact. | `durableWriter.js:6-31, 80-83` |
| N-5 | **Exactly one tab drains per account; the no-Web-Locks fallback is READ_ONLY_FOR_SYNC, never a race.** | `outboxLeader.js:16-20, 46-94` |
| N-6 | **BroadcastChannel carries hints, never data.** | `outboxLeader.js:22-23` |
| N-7 | **The server owns the compare-and-set.** `baseUpdatedAt` → `expected_updated_at` → 409. No client-side clock comparison, anywhere. | `journal_two.py:2670-2677`, `notes.py:2060-2081`, `outboxDrain.js:6-8` |
| N-8 | **Conflict forks and preserves both copies; the default classification is BODY_REWRITE.** Anything the classifier cannot prove forks. | `serverChange.js:12-31`, `outboxDrain.js:550-559` |
| N-9 | **An entry is never discarded to make the queue drain.** A permanent 4xx retires it from retrying and KEEPS it. | `outboxDrain.js:10-16` |
| N-10 | **Correctness does not depend on `navigator.storage.persist()`**, and the member-facing noun narrows when the platform will not promise retention ("Saved on this device" vs "Saved in this browser"). | `notebookDb.js:23-25, 52-65`, `unsyncedCopy.js:17-29` |
| N-11 | **Every door that advances a revision RECORDS it.** Recording, not settling, is what stops the self-fork. | `settleNoteWrite.js:5-27` |
| N-12 | **Telemetry from this layer never carries note content** — ids, counters and enumerated descriptions only, with the key set pinned as a SET. | `telemetry.js:14-18` |

⚠️ **N-4 IS THE ONE ROW WITH A KNOWN CEILING.** The 200 ms debounce is a Chrome-measured operating
point; Safari/iOS and Firefox were not measured for write latency (`durableWriter.js:19-21`). A
second adopter with a different document size inherits the ceiling, not the number.

---

## 5. (d) What a second adopter would need — the concrete list

The Notebook layer is not a library. It is a note-shaped implementation with note-shaped names
(`noteId`, `note:<id>`, `sameAuthoredContent`, `serverAppendedKeysIn`). A second adopter needs
each of the following, and **the honest headline is that most of the cost is not the durability —
it is the CONFLICT SEMANTICS**, which cannot be generalised without knowing what a conflict means
for that document.

| # | What the adopter must supply | Why it cannot be inherited | Rough size |
|---|---|---|---|
| A-1 | **A server-side compare-and-set on its write endpoint** — a baseline field the client sends and the server compares, returning 409 | The Notebook's lives in `notes.update_note`; every other write path in the app is last-writer-wins | **S** — ~10 lines + a rail, per endpoint |
| A-2 | **A revision the server RETURNS on every write** | Without it the client cannot record what landed, and N-11's self-fork returns immediately | **S**, but see A-6 |
| A-3 | **A stable per-document id and an outbox key derived from it** | `note:<id>` is what makes a re-edit REPLACE rather than queue a second entry | **XS** |
| A-4 | **An "authored content" equality function for its document** | `sameAuthoredContent` decides "is the server copy ours?" and is note-shaped | **S–M** |
| A-5 | **A server-change classifier, or an explicit decision to fork on every 409** | `serverChange.js`'s three shapes encode which server-side appends are benign. A different document has different benign appends — or none | **M**, or **XS** if the adopter accepts fork-on-every-409 |
| A-6 | **An enumeration of EVERY door that advances the document's revision, derived from source and not from a canary** | This is the mistake that shipped (§3.6). Six doors were found where four were recorded | **M** — the enumeration is the work, not the recording |
| A-7 | **A generalised store layer, or a second one** | `notebookDb.js` hard-codes `keyPath: 'noteId'` and four store names | **M** — either parameterise the adapter or accept a second copy |
| A-8 | **Its own share of the leader lock, or its own lock name** | `lockNameFor(accountId)` is `uct.nb.sync.${accountId}` — Notebook-scoped. Two subsystems on one lock would serialise unrelated drains | **XS** |
| A-9 | **A member-facing vocabulary that matches the Notebook's** | `unsyncedCopy.js` exists because a second surface is exactly where a vocabulary splits | **XS**, and skipping it is the failure |
| A-10 | **Rails at the same tier**, including the non-vacuity controls and mutation proofs the Notebook layer carries | 5,040 lines of tests against 3,163 of code is the ratio this pattern shipped at | **L** |

### 5.1 ⛔ Two things a second adopter does NOT need

- **A second flag.** `OFFLINE_DEFAULT_ON` is Notebook's; a second adopter gets its own, and both
  remain compiled constants — which means **rollback is a deploy, not a variable**
  (a frontend constant has no Railway variable behind it).
- **A percentage ramp.** The rollout question is S12's (`SPEC-S12-ROLLOUT` §3.4) and the answer
  there is a cohort, not a hash.

---

## 6. The named second adopter, and its size

> **RECOMMENDED SECOND ADOPTER: chart Tracings — `app/src/components/chart/useTracingsSync.js`
> (162 lines) over `app/src/components/chart/drawingsStore.js` (653 lines), mounted exactly once,
> at `app/src/pages/charts/ChartsWorkspace.jsx:665`.**

**Why this one, and not the workspace layout.** Four reasons, each measured:

1. **It is already 80% of the pattern, badly.** It has a synchronous local store (localStorage), a
   debounced push (1500 ms, `useTracingsSync.js:24`), a flush-on-unmount, a monotonic stamp, and a
   highwatermark of *"the last server `updatedAt` this browser has seen"*
   (`useTracingsSync.js:5-16, 22-23`). That is a working copy, an outbox and a baseline under
   different names — with **no durable store, no leader, and no conflict semantics.**
2. **It already knows it is wrong and says so in the file.** `useTracingsSync.js:14-17`:
   *"a device with unsynced local drawings adopts the cloud copy on its first sync, and two
   devices editing at once keep the later writer's whole document. This is add/replace-consistent,
   not a field-merge."* Marked *"documented, Phase-3 to refine"* — S5 is Phase 3.
3. **It already learned N-11's lesson the hard way, on the OTHER half.** The highwatermark used to
   advance before an unawaited write — *"a claim about what the SERVER has seen … advanced on the
   strength of a request nobody checked"* (`useTracingsSync.js:70-75`). It is the only consumer in
   the app that reads `setPref`'s return value (`usePreferences.js:164-168`).
4. **The blast radius is one mount point.** One call site, one pref key (`tracings_doc`), one
   localStorage highwatermark (`uct-tracings-sync-hw`).

**Sizing it against §5's list:**

| item | for Tracings |
|---|---|
| A-1 CAS on the write endpoint | ⛔ **the hard one.** Tracings persists through `POST /api/auth/preferences`, which has **no compare-and-set at any layer** — `set_user_preference` is a bare upsert (`auth_service.py:1524-1532`). Either the endpoint grows an optional `expectedValue`, or Tracings moves off `user_preferences` to a table of its own. **M**, and it is a ruling, not a task |
| A-2 a returned revision | the document already carries its own `updatedAt`; the endpoint returns `{"ok": True}` (`auth.py:2062`) and would need to return the stored stamp. **S** |
| A-3 stable id + outbox key | one document per member ⇒ `tracings:<userId>`. **XS** |
| A-4 authored-content equality | `hasTracingContent` already exists and is shape-tolerant (`useTracingsSync.js:33-48`); an equality function is a sibling. **S** |
| A-5 server-change classifier | **not needed.** There is no server-side appender for tracings, so fork-on-every-409 is honest. **XS** |
| A-6 door enumeration | every write goes through `flushPush`; the enumeration is one function. **S** |
| A-7 store layer | needs the IndexedDB adapter parameterised past `noteId`. **M** |
| A-8 lock name | `uct.tracings.sync.${accountId}`. **XS** |
| A-9 vocabulary | reuse `unsyncedCopy.js` verbatim. **XS** |
| A-10 rails at tier | **L** — the largest single line item, as it was for Notebook |

> **Overall size: M for the mechanism, L for the rails, and ONE ruling (A-1) that is not
> S5's to make** — whether `POST /api/auth/preferences` grows a compare-and-set, or whether a
> document that needs one stops being a preference.

⚠️ **The runner-up, and why it is not first.** `charts_workspace_layout` +
`multichart_state` (`ChartsWorkspace.jsx:968-988`, `useMultiChartState.js:71-90`) already carry
the hydration gate, the 500 ms debounce and the flush-on-unmount — and they are **arrangement,
not authored words.** Question 1 of §2.1 answers NO for a board layout and YES for a drawing a
member placed on a chart. Losing a layout is an annoyance; losing an anchored VWAP somebody drew
on a thesis is losing work.

---

## 7. (e) The read-modify-write trap on `POST /api/auth/preferences`

> ### ⛔⛔ RULE: EVERY WRITER OF A STRUCTURED PREFERENCE MUST READ-MODIFY-WRITE. A `POST` OF A PARTIAL OBJECT SILENTLY DELETES EVERY SIBLING KEY IT DID NOT NAME.

**The mechanism, verified in source this pass.** The endpoint is `{key: str, value: str}`
(`api/routers/auth.py:1856-1858`). It calls `set_user_preference(user["id"], req.key, req.value)`
(`auth.py:2061`), which is:

```sql
INSERT INTO user_preferences (id, user_id, pref_key, pref_value)
VALUES (?, ?, ?, ?)
ON CONFLICT(user_id, pref_key) DO UPDATE SET pref_value = excluded.pref_value
```
— `api/services/auth_service.py:1524-1532`, against a table whose value is **one TEXT column**
(`api/services/auth_db.py:230-236`).

**There is no merge at any layer of the server.** `pref_value` is replaced wholesale.

**The failure it causes.** A member's `joystick_hub` blob holds `enabled`, `handedness`,
`haptics`, `holdMs`, `travelPx`, `doubleTapMs`, `coachMarkSeen` and an `overrides` patch. A caller
that posts `{"key": "joystick_hub", "value": "{\"enabled\": true}"}` — believing it is patching one
field — **deletes the member's handedness, their coach-mark dismissal and every registry
override.** The member's next visit is a hub on the wrong side of the screen with the onboarding
card back.

**This is not hypothetical; it is documented in the repo as a shipped defect.** A recovery snippet
in the joystick programme's own docs posted `{joystick_hub: {...}}`, *"called itself 'a JSON-patch
merge', and was neither."*

**What the codebase already does right, and where the gap is.**

- ✅ `setPrefMerged(key, updater)` exists and is the correct primitive: the updater runs INSIDE the
  SWR cache update, so `current` is whatever the cache holds at that instant, and a per-key write
  chain makes arrival order equal merge order (`usePreferences.js:30-55, 201-242`).
- ✅ `useHubSettings` uses it (`app/src/hub/useHubSettings.js:198`), and `chart_settings` gets a
  merge rule of its own (`usePreferences.js:81-89`).
- ⚠️ **`setPref` — the blind-write form — is still the majority path.** Measured (§9.3): **70
  `setPref`/`setPrefMerged` call sites** in non-test `app/src`. `usePreferences.js:194-196` says
  so itself: *"Existing `setPref` callers are deliberately untouched: migrating them all is a
  change to every settings surface in the app and belongs in its own step."*

**The rule S5 states, in a form a reviewer can apply:**

1. **A preference whose value is a JSON OBJECT is written with `setPrefMerged`, never `setPref`.**
   A preference whose value is a scalar (`theme`, `default_chart_tf`) may use either.
2. **A patch expressed by OMISSION is not a patch.** If a writer needs to remove a member of a
   structured value, the value's own shape must carry a removal marker — the `chart_settings`
   tombstone is the worked example (`usePreferences.js:70-76`), and its reasoning generalises:
   *"a patch that simply lacks an instance is indistinguishable from one written by a cell that
   never heard of it."*
3. **Merging atomically is only half the fix** — two POSTs in flight can be delivered in either
   order and the server keeps whichever ARRIVES last (`usePreferences.js:37-42`). The per-key
   write chain is the other half, and it is a property of `setPrefMerged` only.
4. ⛔ **`setPrefMerged` still resolves scalar collisions last-write-wins** and says so
   (`usePreferences.js:78-79`). It is add-and-delete protection, not a CRDT. A value that needs
   real concurrent-edit semantics has answered YES to §2.1 question 1 and belongs in P2.

### 7.1 ⚠️ ONE CORRECTION TO THE STANDING DESCRIPTION OF THIS ENDPOINT

The endpoint is frequently described — in this repo's own comments, at
`app/src/hub/useHubSettings.js:174` and `app/src/pages/settings/JoystickSettingsCard.jsx:52` — as
accepting *"any `{key, value}` from any authenticated caller."* **That is no longer true at the
tree read this pass.** `_validate_preference` allow-lists the key and refuses an unknown one with
a 400 (`auth.py:2041-2050`), against a list of **43 keys** (`auth.py:1900-1948`, counted in §9.2),
and `joystick_hub` carries a real field schema (`auth.py:1970-2039`).

⛔ **The allow-list changes the KEY SPACE, not the VALUE SEMANTICS.** The whole-value replacement
is untouched and the trap above is unchanged. Two comments in the client still assert the older
behaviour; correcting them is not this spec's to do, and it is recorded here so a reader does not
take the comment for the code.

---

## 8. What this spec does NOT propose

- **No change to the Notebook layer.** S5 ratifies it. Not one line.
- **No new persistence library, no "state framework", no shared abstraction extracted
  speculatively.** §5 prices a second adopter precisely so the abstraction is extracted with two
  known consumers rather than one imagined one.
- **No CRDT, no operational transform, no field-level merge.** N-8's fork is the answer.
- **No migration of the 59 localStorage keys.** §2.1 governs what is ADDED.
- **No compare-and-set on `POST /api/auth/preferences`.** §6 names it as the one open ruling.
- **No change to `_PREFERENCE_KEYS`.** The allow-list is derived and railed by
  `tests/test_preference_key_validation.py`, which re-derives the client's key set from
  `app/src/**` on every run.

---

## 9. Measurement appendix — how each number in this document was obtained

⛔ **Every count below was produced this pass by a script over the source tree. None was copied
from a comment, a prior document, or another artifact in this programme.** Where a first attempt
was wrong, the wrong answer is recorded beside the right one.

### 9.1 The offline layer's size
`os.listdir` over `app/src/pages/journal-2-0/lib/offline/`, splitting on `.test.` in the basename,
line-counted. **19 production modules / 3,163 lines; 21 test files / 5,040 lines.**

### 9.2 The preference allow-list
`_PREFERENCE_KEYS` extracted from `api/routers/auth.py` by regex, **Python `#` comment lines
stripped before matching key literals**, then `"key":` pairs counted. **43 keys.** (Stripping
matters: the block contains three explanatory comments, one of which names `shared_tag_colors` in
prose.)

### 9.3 Preference write sites
All `.js`/`.jsx` under `app/src`, test files excluded, **JavaScript comments stripped by a
string-aware state machine before matching** (line, block, and template/quote literals respected).
Matching `setPref(` / `setPrefMerged(` with a STRING-LITERAL first argument: **26 distinct keys
across 70 call sites.**

⚠️ **26 IS A FLOOR, NOT THE COUNT, AND THE CONTROL IS WHAT SHOWS IT.** 43 keys are allow-listed
server-side; the literal scan found 26. Rather than report a gap of 17, I looked for the
mechanism: **many writers pass a module constant, not a literal** — `setPrefMerged(JOYSTICK_HUB_PREF_KEY, …)`
(`useHubSettings.js:198`), `setPref(PREF_KEY, …)` (`useTracingsSync.js:68`), `setPref(DOCK_PREF, …)`
(`LayoutDock.jsx:50`), and 20 more. The authoritative derivation already exists and resolves those
constants: `tests/test_preference_key_validation.py`, whose docstring states it re-derives the set
*"from `app/src/**` — every key literal handed to `setPref`/`setPrefMerged`, with local and
imported `const` names resolved."* **Use that rail, not this scan, for a key census.**

### 9.4 localStorage keys
Same corpus and same comment-stripping. `localStorage.getItem|setItem|removeItem` with a
string-literal key: **59 distinct keys across 130 call sites.** This is also a floor for the same
reason (a computed key would be missed); it is used here only to establish an order of magnitude.

### 9.5 Per-member tables in `auth.db`
`api/services/auth_db.py`, every `CREATE TABLE IF NOT EXISTS`, body extracted by
**paren-balancing** and SQL `--` comments stripped: **47 tables, 38 of which carry a `user_id`
column.**

⚠️ **THE FIRST ATTEMPT SAID 28, AND IT WAS WRONG.** A naive `(...)\n);` regex parsed only the 37
tables in the column-0 `_SCHEMA` string and silently skipped 10 declared inside indented migration
blocks — including `ticker_tags` and `watchlist_alerts`, two of the most personalization-relevant
tables in the file. The tell was that the regex reported 37 bodies for 47 names. **A parser that
returns fewer rows than it found names has failed, not filtered.**

### 9.6 Adopters of the offline layer
`grep` for `lib/offline` imports across `app/src`, excluding files inside `lib/offline/` itself and
excluding tests: **22 import lines across 14 files, all under `app/src/pages/journal-2-0/`.**
⭐ **The control:** the same search returned 22 presences, so it is capable of finding an importer;
the claim "no adopter outside the Notebook" is therefore an absence the instrument could have
disproved.

### 9.7 j2 tables
`api/services/journal_two/db.py`, `CREATE TABLE IF NOT EXISTS <name>`: **67 names beginning
`j2_`.** ⚠️ The raw regex also matched four non-tables — `above`, `here`, `statements` and
`hub_planned_trades` — the first three being prose inside docstrings that happens to contain the
DDL phrase. Filtering to the `j2_` prefix is what makes the count real; **an unfiltered 71 would
have been three sentences and a different subsystem.**

---

## 10. ⚠️ What could not be measured this pass

- **Any production distribution.** No `auth.db` was read. How many members have a
  `charts_workspace_layout`, how large those blobs are, how many localStorage keys a real browser
  actually holds, how often a 409 fires in the wild — **not measured**, and this document asserts
  no number about any of them. This is the same gap OI-21 names.
- **Write latency outside Chrome.** N-4's 200 ms is a Chrome 152 measurement
  (`durableWriter.js:6-21`). Safari/iOS and Firefox durable-write latency: **not measured**, by
  the source's own admission.
- **Whether the tree read matches `5ff6fc04a`.** No git command was run (see the frontmatter
  `confidence` note). **Not measured.**
- **The true count of preference keys the client writes.** §9.3's 26 is a floor; the resolving
  derivation lives in a test that was not executed this pass. **Read from the rail, not from here.**
- **Whether any member has ever lost a preference to the read-modify-write trap.** The mechanism
  is proved from source; the incidence is a production question. **Not measured.**
