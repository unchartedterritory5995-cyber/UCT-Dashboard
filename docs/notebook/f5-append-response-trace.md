# Q1-F5 — what the `append_widget_embed` response handling actually does

**Method.** Static trace of the client code at the worktree's working-tree state
(`C:\Users\Patrick\uct-worktrees\notebook-k`, 2026-09-13). No tests were run, no git
command was run, nothing outside this file was edited. Every citation below is quoted
from the file it names. Anything I could not quote is marked STRUCK or
COULD-NOT-DETERMINE rather than softened.

**Convention used throughout:** `READ` = the quoted line says it. `INFERRED` = I am
composing quoted lines into a conclusion the code does not state in one place.

---

## The answers, first

> **Does a write of server-derived note state into the durable record exist on the
> append-response path?**
>
> ## NO.

The append door's response handling reaches **exactly one durable write**, and it is a
`meta`-store write of a revision string. It never opens the `notes` store, never opens
the `outbox` store, never calls `putNoteWithIntent`, never calls `settleLandedSave`,
never calls `endInFlightSave`, and never touches SWR.

| Question asked | Answer |
|---|---|
| Server-copy write into the durable record on the append-response path? | **NO** — the only write is `useDurableNote.js:232`, a `meta` write |
| If YES, does it check `dirty` first? | N/A — there is no such write. (Separately: the one durable write on this path reads and writes only `meta[landed:<noteId>]` and never reads `dirty`.) |
| What moves `baseUpdatedAt` from '48' to '85' on that path? | **NOTHING ON THAT PATH.** No writer of `notes.baseUpdatedAt` is reachable from the append response. See §5 for the complete writer census and the three writers whose *shape* matches the measured middle state — none of them is on this path. |
| Is there a path where the queued entry is deleted (a null intent) as part of handling the append response? | **NO.** `putNoteWithIntent` is not reachable from the append response at all, so neither is its null-intent delete. |

**What the negative implies** — stated plainly, as instructed, and not softened:

> The mechanism that empties the durable record in the RED cell is **not the first
> context's handling of the append response**. The append response's entire durable
> footprint is one string appended to a five-element ring in the `meta` store. That
> ring is *read in exactly one place* — the drain (`outboxDrain.js:254`) — so the only
> way the append door can change any other outcome is **by changing which branch the
> drain takes**. The hypothesis named in the brief (capture helper returns the note →
> something calls `mutate` → a settle helper → a put of the server note) is
> **disproven at every link**: the helper discards the note, nothing calls `mutate`,
> no settle helper is imported, and no put occurs.
>
> Therefore the defect is either (a) **drain-side**, in a branch the landed ring
> selects, or (b) **shared-store / editor-side**, in a writer that runs when the member
> *returns to the note*, not when the door fires. Both controls are consistent with
> (a) or (b) and inconsistent with client append-response handling: control 1 (no door)
> and control 2 (a second context) **both leave this browser's landed ring without the
> server's new revision**, which is the single durable difference the door makes.

---

## 1. `captureTargets.js` — the `append_widget_embed` door

`app/src/pages/journal-2-0/lib/captureTargets.js`, function `appendToNote`, lines 36–51.
Every branch, quoted:

```js
36  async function appendToNote(noteId, attrs) {
37    const res = await fetch(`/api/j2/notes/${noteId}/embeds`, {
38      method: 'POST',
39      credentials: 'include',
40      headers: { 'Content-Type': 'application/json' },
41      body: JSON.stringify({ attrs }),
42    })
43    if (!res.ok) return false
...
49    await settleNoteWrite(noteId, res)
50    return true
51  }
```

**What it POSTs** (READ): `{ attrs }` — the built widgetEmbed attrs — to
`POST /api/j2/notes/{noteId}/embeds`, with cookies.

**What it does with the RESPONSE** (READ), branch by branch — there are only two:

- **`!res.ok`** → `captureTargets.js:43` `  if (!res.ok) return false`. The response
  object is dropped unread. The caller then falls through to the inbox
  (`captureTargets.js:88–91`, quoted: `      // 404 = the note was deleted since — fall through to the inbox.` /
  `      return await pushToInbox(widgetId, attrs)`).
- **`res.ok`** → `captureTargets.js:49` `  await settleNoteWrite(noteId, res)`, then
  `captureTargets.js:50` `  return true`.

⭐ **The raw `Response` is handed on, not a parsed note, and the door never parses it
itself.** `appendToNote` has no `res.json()` call anywhere. So the door itself cannot
apply the server's copy of the note to anything: it does not have it.

The only other durable-ish side effect in this file is on a **different** target —
`newNote`, not the append door — and it is `localStorage` only
(`captureTargets.js:117–119`, quoted: `          localStorage.setItem(LAST_NOTE_KEY, JSON.stringify({`).

The imports of this file are two, and neither is the durable store
(`captureTargets.js:19` `import { chartsLinkUrl } from '../../../lib/chartDeepLink'`;
`captureTargets.js:21` `import { settleNoteWrite } from './offline/settleNoteWrite'`).

---

## 2. Every caller of that door, and what each does after it returns

### 2a. The registry entry (`captureTargets.js:82–92`) → `sendToJournal.js`

`captureTargets.js:84` — `      if (last && await appendToNote(last.id, attrs)) {` — the
return value is used **only to pick a toast string** (`captureTargets.js:86`:
``        return last.title ? `${label} sent to “${last.title}”` : `${label} sent to your most recent note` ``).

Its one caller is `app/src/pages/journal-2-0/lib/sendToJournal.js:63`:

```js
63      const result = await t.run(attrs, { widgetId, label: name })
64      _logCaptureSaved(widgetId, target, !!tradeRef)
65      return result
```

`_logCaptureSaved` is a fire-and-forget telemetry POST
(`sendToJournal.js:22` `  fetch('/api/j2/telemetry', {`). **No SWR call, no note fetch,
no durable write.** READ: `sendToJournal.js` contains no `mutate` and no `swr` import.

Its own callers (11 widget doors + `TickerActions` + `CaptureMenu`, e.g.
`ChartWidget.jsx:426` `    setCtxToast(await sendCaptureToJournal('chart', buildJournalCapture()))`)
each only put the returned **string** into a toast state.

### 2b. `AddPositionModal.jsx` — `postTradeLink`, lines 243–261

```js
245        const res = await fetch(`/api/j2/notes/${noteId}/embeds`, {
...
251        if (!res.ok) return String(res.status)
...
256        await settleNoteWrite(noteId, res)
257        return null
```

After it returns (`AddPositionModal.jsx:364–375`): on error it sets
`setPendingLink(...)` / `setThesisLinkWarning(...)` and returns; on success it calls
`onClose?.()`. **No `mutate` keyed on the note.** (READ: the only SWR invalidations this
modal family performs are on positions/trades keys, e.g.
`GlobalAddPositionProvider.jsx:188` `    await mutate('/api/j2/positions')`.)

⚠️ **A fourth `settleNoteWrite` call site lives in this same file and is NOT an embeds
door** — `AddPositionModal.jsx:324`:

```js
324              .then(async (r) => (r.ok ? settleNoteWrite(thesisNoteId, r) : null))
```

That one settles a `PUT /api/j2/notes/{id}` that sets `builtin:research_type`. It is the
same helper, so it has the same (meta-only) footprint. Recorded because the F5 freeze
list does not name it and a reader enumerating "the append doors" will miss it.

### 2c. `importer/enrichment.js` — `addChartEmbed`, lines 43–67

```js
45    const res = await fetch(`/api/j2/notes/${noteId}/embeds`, {
...
61    const data = await res.json()
...
65    await settleNoteWrite(noteId, data.note)
66    return data.note?.bodyJson || null
```

⭐ **This is the one caller that DOES read the server's note out of the response**
(`enrichment.js:61`), and it is worth being precise about what it does with it: it
passes it to `settleNoteWrite` (which uses only `updatedAt` — see §3) and **returns
`data.note?.bodyJson` to the caller as an undo token**. It writes it nowhere.

Its caller (`ImportWizard.jsx:813`) stores it in React state only:

```js
813          const bodyAfter = await addChartEmbed(job.noteId, job.ticker)
814          records.push({ noteId: job.noteId, ticker: job.ticker, bodyAfter })
```

…and that `bodyAfter` is used later only by `handleUndoEnrichment`
(`ImportWizard.jsx:837` `        await revertChartEmbed(rec.noteId, rec.bodyAfter)`), which
is a deliberate `PUT` the member has to click. **No durable write, no SWR mutate.**

### 2d. Search completeness (an empty grep is a failed search until proven otherwise)

Search: `embeds` across `app/src` — 80 hits. The **non-test** hits that are an actual
call to the endpoint are exactly three: `captureTargets.js:37`,
`AddPositionModal.jsx:245`, `enrichment.js:45`.

**Non-vacuity control for that search:** the same pattern also returned known-present,
unrelated matches it *should* find — `hooks/useNoteBacklinks.js:3`
(` * Reads the j2_note_embeds sidecar through \`GET /api/j2/notes/backlinks\`.`) and
`widgets/registry.js:46` (`// ── Params layer (journal embeds) ───────────────────────────────────────────`).
So the pattern matches, and "three call sites" is a measurement, not an empty grep.

**Independent corroboration in-repo** (READ): `lib/offline/f5Freeze.test.js:88–99`
enumerates the frozen set and names the same three, verbatim:

```js
93    ['append_widget_embed', 'app/src/pages/journal-2-0/lib/captureTargets.js',
94      '`/api/j2/notes/${noteId}/embeds`'],
95    ['append_widget_embed', 'app/src/pages/journal-2-0/components/AddPositionModal.jsx',
96      '`/api/j2/notes/${noteId}/embeds`'],
97    ['append_widget_embed', 'app/src/pages/journal-2-0/lib/importer/enrichment.js',
98      '`/api/j2/notes/${noteId}/embeds`'],
```

---

## 3. `settleNoteWrite.js` — what the append response actually reaches

`app/src/pages/journal-2-0/lib/offline/settleNoteWrite.js` **exists** (7,405 bytes,
verified by directory listing). Its whole runtime body is lines 66–101, quoted in full
where it matters:

```js
49  async function landedRecorder() {
50    const mod = await import('./useDurableNote')
51    return mod.recordLandedRevision
52  }
...
66  export async function settleNoteWrite(
67    noteId, note, accountId = getCurrentAccountId(), { connect } = {},
68  ) {
...
81    const resolved = typeof note?.json === 'function'
82      ? await (async () => { try { return await note.json() } catch { return null } })()
83      : note
...
87    const updatedAt = usableBaseline(resolved?.updatedAt, resolved?.note?.updatedAt)
...
92    if (!noteId || !updatedAt || !accountId) return null
...
97    const recordLandedRevision = await landedRecorder()
98    return recordLandedRevision(connect
99      ? { accountId, noteId, updatedAt, connect }
100     : { accountId, noteId, updatedAt })
101  }
```

⭐ **The body is read (line 81–83) and then everything except `updatedAt` is thrown
away (line 87).** The parsed server note is a local `const` that goes out of scope at
line 101. The only value that escapes this function is a revision string.

**`settleLandedSave` is NOT reached from here.** (READ: the file's only import of
`useDurableNote` is the dynamic one at line 50, and it destructures exactly one export,
`recordLandedRevision`, at line 51.) The header states the design intent in the same
words — `settleNoteWrite.js:24`:

```
 * ⭐ THE FIX IS RECORDING, NOT SETTLING. `settleLandedSave` is an editor-only
```

**`endInFlightSave` is NOT reached from here** (READ: the string `endInFlightSave` does
not appear in `settleNoteWrite.js`).

`settleNoteWrites` (the plural batch form, `settleNoteWrite.js:128–139`) is **not** on
this path; its callers are the folder-delete and import-confirm endpoints named in its
own docstring (lines 111–113).

### 3a. `recordLandedRevision` — the terminus, quoted in full

`app/src/pages/journal-2-0/lib/offline/useDurableNote.js:223–235`:

```js
223  export async function recordLandedRevision({
224    accountId, noteId, updatedAt, connect = connectNotebookDb,
225  } = {}) {
226    if (!offlineEnabled()) return null
227    if (!offlineStorageAvailable()) return null
228    const landed = usableBaseline(updatedAt)
229    if (!accountId || !noteId || !landed) return null
230    try {
231      const db = await connect(accountId)
232      await putMeta(db, landedKeyFor(noteId), withLanded(await getMeta(db, landedKeyFor(noteId)), landed))
233      return landed
234    } catch { return null }
235  }
```

**Line 232 is the entire durable footprint of the append response.** It:

- opens **one** store — `putMeta` is `notebookDb.js:197–201`, quoted:
  `198    const tx = db.transaction(STORE_META, 'readwrite')` /
  `199    tx.objectStore(STORE_META).put({ name, value })`. **`STORE_META` only.** Not
  `STORE_NOTES`, not `STORE_OUTBOX`.
- writes a key that is a bare prefix + noteId — `inFlight.js:173`
  `export const landedKeyFor = (noteId) => \`${LANDED_KEY_PREFIX}${noteId}\`` with
  `inFlight.js:172` `export const LANDED_KEY_PREFIX = 'landed:'`.
- writes a value that is a **capped ring of revision strings and nothing else** —
  `inFlight.js:177–182`:
  ```js
  177  export function withLanded(ring, revision) {
  178    const rev = usableBaseline(revision)
  179    if (!rev) return Array.isArray(ring) ? ring : []
  180    const prev = Array.isArray(ring) ? ring.filter((r) => r !== rev) : []
  181    return [rev, ...prev].slice(0, LANDED_RING)
  182  }
  ```

**It never reads `dirty`.** (READ: the string `dirty` does not appear anywhere in
`recordLandedRevision`, lines 223–235, nor in `putMeta`, nor in `withLanded`.) There is
no `dirty` check to quote because there is nothing on this path that would need one — it
writes no note state.

⚠️ **One real side effect that is easy to miss and is worth naming**: line 50's
`await import('./useDurableNote')` evaluates that module, and that module does two things
at module scope — `useDurableNote.js:49` `export const SESSION_ID = newSessionId()` and
`useDurableNote.js:54` `holdSessionLock(SESSION_ID)`. `settleNoteWrite.js:33–47`
documents exactly this as the reason the import is dynamic. INFERRED: a Web Lock and a
uuid are taken; neither is an IndexedDB write, so this does not change the answer above.

Account resolution on this path is `getCurrentAccountId()` (`settleNoteWrite.js:67`),
which is module state written by one caller — `currentAccount.js:30`
`export function setCurrentAccountId(id) {`, whose docstring at `currentAccount.js:29`
reads `/** ⛔ ONE CALLER ONLY: \`AuthContext\`. */`. INFERRED: if that id is null the
settle returns at line 92 and the door writes **nothing at all** — which is a real,
silent way for the RED and GREEN cells to differ, and is worth ruling out on the rig.

---

## 4. `putNoteWithIntent` — every caller, and reachability from an append response

`app/src/pages/journal-2-0/lib/offline/notebookDb.js:148–165`. The null-intent delete is
lines 153–162:

```js
153    if (outboxEntry) {
154      outbox.put(outboxEntry)
155    } else {
156      const idx = outbox.index('byNote')
157      const cursorReq = idx.openCursor(IDBKeyRange.only(noteRecord.noteId))
158      cursorReq.onsuccess = () => {
159        const cur = cursorReq.result
160        if (cur) { cur.delete(); cur.continue() }
161      }
162    }
```

Search: `putNoteWithIntent` across `app/src` — 52 hits, of which **8 are non-test call
sites**. (Non-vacuity control: the same search returned the definition at
`notebookDb.js:148` and 44 test-file call sites, so the pattern matches.) Complete census:

| # | Call site | Enclosing function | Intent passed | Reachable from an append response? |
|---|---|---|---|---|
| 1 | `useDurableNote.js:286` `    await putNoteWithIntent(db, record, intent)` | `settleLandedSave` | `caughtUp ? null : {…, baseUpdatedAt: landed, …}` (`:276–285`) | **NO** — `settleNoteWrite` imports only `recordLandedRevision` (`settleNoteWrite.js:51`) |
| 2 | `useDurableNote.js:402` `      await putNoteWithIntent(db, record, intent)` | `persist`, the durable writer's sink, driven by `schedule`/`markSynced` | `record.dirty ? {…, baseUpdatedAt: record.baseUpdatedAt, …} : null` (`:388–399`) | **NO** — requires a mounted editor (`writerRef.current`, `:434–436`); the door does not touch it |
| 3 | `outboxDrain.js:75` `  await putNoteWithIntent(db, next, intent)` | `settleSent` | `caughtUp ? null : {...entry, …}` (`:69–74`) | **NO** — drain only |
| 4 | `outboxDrain.js:98` `    if (rec) await putNoteWithIntent(db, { ...rec, dirty: 0, serverBase: null }, null)` | `settleForked`, unusable-server-note branch | **`null` — deletes every queued entry for the note** | **NO** — drain only |
| 5 | `outboxDrain.js:101` `  await putNoteWithIntent(db, {` | `settleForked`, usable branch (writes the SERVER's title/body, `:103–105`) | **`null`** (`:114`) | **NO** — drain only |
| 6 | `outboxDrain.js:119` `  await putNoteWithIntent(db, rec || {` | `settleBlocked` | `{...entry, permanent: true, …}` (`:126–134`) | **NO** — drain only |
| 7 | `outboxDrain.js:205` `  if (rec2) await putNoteWithIntent(db, rec2, next)` | `rebaseEntry` | `{ ...entry, baseUpdatedAt, queuedAt: Date.now() }` (`:200`) | **NO** — drain only |
| 8 | `outboxDrain.js:247` `    await putNoteWithIntent(db, recBody ? { ...rec, bodyJson: recBody, serverBase } : { ...rec, serverBase }, next)` | `mergeAppends` | `{ ...entry, patch: {…}, baseUpdatedAt, … }` (`:237–242`) | **NO** — drain only |

**Two call sites pass a null intent** — #4 and #5, both inside `settleForked`. Both are
in `outboxDrain.js`, both are reached only from `drainOutbox`'s fork branch, and neither
is reachable from handling an append response. A third, #1, passes `null` **when
`caughtUp`** (`useDurableNote.js:276` `    const intent = caughtUp ? null : {`) — that is
the path whose null-intent delete is documented as having already cost a member their
sentence once (`NoteEditorPage.jsx:1698–1704`, quoted:
`     * \`current: captureLocalState() || saved\`. When the editor could not report` …
`     * \`putNoteWithIntent\` DELETED every queued entry for the note. The offline`). It is
**not** on the append path either.

---

## 5. What *can* produce the measured middle state, and why none of it is the door

The middle state is `(queued=1, dirty=True, baseUpdatedAt='85', sentence=False)`. That
requires a single write that (i) sets the note record's `baseUpdatedAt` to the server's
post-append revision, (ii) leaves `dirty: 1`, (iii) leaves an outbox entry in place, and
(iv) replaces the record's body with one lacking the sentence.

I walked all eight `putNoteWithIntent` callers against those four properties. **Exactly
three can produce that shape**, and I am naming them so the next session instruments the
right lines rather than re-deriving this:

1. **`useDurableNote.js:261–286` (`settleLandedSave`, not-caught-up branch).**
   `:265` `      baseUpdatedAt: landed,` · `:270` `      dirty: caughtUp ? 0 : 1,` ·
   `:260` `    const state = caughtUp ? (acked || current) : current` ·
   `:264` `      bodyJson: state?.bodyJson ?? null,` — so the record's body becomes
   `current`. If `current` does not carry the sentence, the sentence leaves while the
   entry is re-queued at `:276–285`. **Shape matches perfectly.** Its non-editor
   entry point is `NoteEditorPage.jsx:1714` `    await settleLandedSave({` inside
   `settleMetadataRevision` — the **folder/ticker/tags** doors, not the append door.
2. **`useDurableNote.js:369–402` (`persist`).** `:374`
   `        baseUpdatedAt: usableBaseline(state?.baseUpdatedAt),` · `:381`
   `        dirty: state?.synced ? 0 : 1,` · body from `state`. Driven by
   `NoteEditorPage.jsx:866` `    if (snapshot) durableRef.current.schedule(snapshot)`,
   whose `snapshot` is `captureLocalState()` — and `captureLocalState`'s baseline is
   `NoteEditorPage.jsx:715` `      baseUpdatedAt: lastSavedRef.current.updatedAt || null,`,
   i.e. **whatever the server last told this editor**. **Shape matches perfectly**, and
   this one runs on a plain keystroke after the member returns to the note.
3. **`outboxDrain.js:47–76` (`settleSent`).** `:60` `    baseUpdatedAt,` · `:61`
   `    dirty: caughtUp ? 0 : 1,`. Shape matches, *except* that the body is protected by
   the spread order at `:59` `    ...(rec || {}),` — the record's own words win over the
   patch's. INFERRED: it can only drop the sentence if the record had already lost it.

⛔ **None of the three is on the append-response path.** #1 and #2 need the editor or a
metadata door; #3 needs the drain.

### 5a. The one thing the door does change, and it is a branch selector

`useDurableNote.js:232` writes the landed ring. That ring is **read in exactly one
place** in non-test code: `outboxDrain.js:252–256`.

```js
252  async function askServerIfOurs(db, entry, serverCopyIsOurs) {
253    if (!serverCopyIsOurs) return null
254    const landedRevisions = new Set(await getMeta(db, landedKeyFor(entry.noteId)) || [])
255    return serverCopyIsOurs(entry, { landedRevisions })
256  }
```

(Non-vacuity control for that claim: the grep for `landedKeyFor|withLanded|serverCopyIsOurs`
over `journal-2-0`, excluding tests, returned 11 hits — the definitions in `inFlight.js`,
the two writes in `useDurableNote.js`, the default in `useOutboxDrain.js`, and the
drain's uses. So the pattern matches; `outboxDrain.js:254` is the only *read* of the ring
value.)

With the revision in the ring, `serverCopyIsOursDefault` takes its **second** return —
`useOutboxDrain.js:79–86`:

```js
79    if (landed && landedRevisions instanceof Set && landedRevisions.has(landed)) {
80      // ⭐ Ours, but the server does NOT have these words — this is the door case.
...
83        ours: true, identical: false, serverUpdatedAt: landed, serverNote: server,
```

…which unlocks two branches that **neither control cell can reach**:
`outboxDrain.js:440` `          const ring = ringVouchedPlan(mine, noteRec)` (pre-send) and
`outboxDrain.js:532–534` (on 409). And `ringVouchedPlan` has a no-evidence escape at
`outboxDrain.js:179`:

```js
179    if (!mine?.serverNote || !base) return { plan: 'rebase', base: null, shape: null }
```

where `base` is `outboxDrain.js:172` `  const base = lastKnownServerCopy(noteRec)` →
`serverChange.js:206–210`, whose dirty-record branch is
`serverChange.js:209` `  return rec.serverBase || null`. **INFERRED, and flagged as
unverified:** a dirty record with no `serverBase` makes the append merge unreachable and
selects `'rebase'`. That is the file's own recorded defect class — `outboxDrain.js:158`:
`* WHAT IT COST: "ours => rebase" ran before the diff was ever read, so when the server's` —
measured there as `0/18 append`. I did **not** verify whether that produces the observed
loss of the *member's* sentence (the recorded defect loses the *widget*), and I am not
claiming it does.

⭐ **Why both controls are green is now mechanical, not a coincidence:** control 1 fires
no door, so nothing calls `useDurableNote.js:232`; control 2's door fires in a *different
browser context*, whose IndexedDB is a different store (`notebookDb.js:38–41`,
`  return \`uct_notebook_${accountId}\``, is per-account, not per-context — but two
contexts do not share an origin's storage partition). Either way, **this browser's ring
does not contain the server's new revision**, `serverCopyIsOursDefault` falls through to
its third return (`useOutboxDrain.js:91–94`, `      ours: false, …`), and the wire shows
what control 2 showed: 409 → rebase → 200. READ: that is the same `409 -> rebase -> 200`
the brief reports.

---

## 6. SWR / cache writes keyed on the note (question 5 of the brief)

**On the append-response path: none.** READ — `captureTargets.js` and `sendToJournal.js`
contain no `swr` import and no `mutate`; `enrichment.js` contains neither;
`AddPositionModal.jsx`'s post-link work is `setPendingLink` / `onClose`.

For completeness, the note-keyed cache writes that **do** exist elsewhere:

- `NotebookTab.jsx:330–332` —
  `    globalMutate((key) => typeof key === 'string' && key.startsWith('/api/j2/notes'))`
  — a **prefix** predicate, so it also matches `/api/j2/notes/<id>`, the editor's own
  key. Its caller is `refreshSidebarCounts`, invoked on delete/restore/folder moves.
  **Not on the append path.**
- `NoteEditorPage.jsx:1669` `    await refresh()` — the hero-image change handler.

**Automatic revalidation is off**, which rules out "the editor silently re-rendered from
the server copy when the member reconnected":

```js
// App.jsx:262–268
262  const SWR_CONFIG = {
263    revalidateOnFocus: false,
264    revalidateOnReconnect: false,
265    dedupingInterval: 8000,
```

and the note hook does not re-enable either — `useJ2Notes.js:149–154`:

```js
149  export function useJ2Note(noteId) {
150    const url = noteId ? `/api/j2/notes/${noteId}` : null
151    const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
152      revalidateOnFocus: false,
153      shouldRetryOnError: false,
154    })
```

INFERRED: a *remount* still refetches (a new SWR key mount with no cached entry, or a
stale-while-revalidate on an existing one), so "the member returns to the note" is still
a fetch — but it is a **mount**, not a reconnect event, and it is not caused by the door.

One genuine server-copy write into the durable record does exist in the editor, and it is
worth naming so nobody rediscovers it as the culprit: `NoteEditorPage.jsx:835–840`,
`discardDraft`:

```js
835      const server = {
836        title: note?.title || '',
837        subtitle: note?.subtitle || '',
838        bodyJson: note?.bodyJson ?? null,
839      }
840      durableRef.current.markSynced({ acked: server, current: server, updatedAt: note?.updatedAt || null })
```

⛔ **It requires the member to click "Discard" on the recovery banner.** `acked === current`
⇒ `caughtUp` ⇒ `dirty: 0` and a **null** intent (`useDurableNote.js:270`, `:276`) ⇒ it
would produce `(0, False, '85', False)`, **not** the measured `(1, True, '85', False)`.
So it does not explain the middle state either, and it is not on the door's path.

---

## 7. What I could not determine

State them as gaps, not as hedged findings.

1. **Which write produces the measured middle state.** I traced all eight writers of the
   `notes` store and none is reachable from the append response. Three have the right
   shape (§5) and all three need either the editor or the drain. Deciding between them
   needs instrumentation at `useDurableNote.js:286`, `useDurableNote.js:402` and
   `outboxDrain.js:75` with a stack tag — a static read cannot separate them.
2. **Whether the sampled `baseUpdatedAt` is the note record's or the outbox entry's.**
   The brief's trail does not say. It matters: `outboxDrain.js:205` (`rebaseEntry`) and
   `outboxDrain.js:247` (`mergeAppends`) move the **entry's** baseline while leaving the
   **record's** untouched, so the two readings select different suspects.
3. **Whether `getCurrentAccountId()` was non-null in the RED cell.** If it were null,
   `settleNoteWrite.js:92` returns and the door writes nothing — which would make the
   door's difference something other than the ring. Cheap to settle on the rig; not
   answerable by reading.
4. **Whether `noteRec.serverBase` was present when the drain ran.** `outboxDrain.js:179`
   branches on it and I cannot observe it statically. This decides `merge` vs `rebase`.
5. **Server-side behaviour of `POST /api/j2/notes/{id}/embeds`.** Out of scope for this
   trace — I read no Python. If the mechanism is not client-side (and §5 says the
   append-response handling is not it), `api/services/journal_two/notes_service.py::append_widget_embed`
   is the next thing to read, and I did **not** read it.

## 8. Struck citations

None. Every file:line in this document was opened and quoted. No claim rests on a path
that does not exist:

- `app/src/pages/journal-2-0/lib/captureTargets.js` — exists (6,995 bytes).
- `app/src/pages/journal-2-0/lib/offline/settleNoteWrite.js` — **exists** (7,405 bytes);
  the brief's "(if it exists)" is answered YES.
- `app/src/pages/journal-2-0/lib/offline/useDurableNote.js` — exists (23,386 bytes);
  `settleLandedSave`, `recordLandedRevision` and `endInFlightSave` are all exported from
  it (lines 237, 223, 152).
- `app/src/pages/journal-2-0/lib/offline/notebookDb.js` — exists (8,437 bytes);
  `putNoteWithIntent` at line 148.
- `app/src/pages/journal-2-0/components/AddPositionModal.jsx`,
  `app/src/pages/journal-2-0/lib/importer/enrichment.js`,
  `app/src/pages/journal-2-0/components/notebook/import/ImportWizard.jsx`,
  `app/src/pages/journal-2-0/lib/sendToJournal.js`,
  `app/src/pages/journal-2-0/lib/offline/outboxDrain.js`,
  `app/src/pages/journal-2-0/lib/offline/useOutboxDrain.js`,
  `app/src/pages/journal-2-0/lib/offline/inFlight.js`,
  `app/src/pages/journal-2-0/lib/offline/baseline.js`,
  `app/src/pages/journal-2-0/lib/offline/serverChange.js`,
  `app/src/pages/journal-2-0/lib/offline/currentAccount.js`,
  `app/src/pages/journal-2-0/hooks/useJ2Notes.js`,
  `app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx`,
  `app/src/pages/journal-2-0/tabs/NotebookTab.jsx`,
  `app/src/App.jsx` — all exist and were read.
