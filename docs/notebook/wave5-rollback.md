# Rolling back Notebook wave 5: keep the schema guard

> ⛔⛔ **THREE commits are never reverted with the features: `8167f7aa0`,
> `fd87271fd` and `82c56dd63`.** A wave-5 rollback is the moment they matter
> most. Revert the feature merge, then re-apply all three commits in that order.
> Or revert everything except them.
>
> ⚠️ `82c56dd63` was added after the simulation below ran (it closes B1, a hole
> the whole-branch re-review found in the guard itself). Its role in a rollback
> is REASONED, not yet re-simulated — see "Why `82c56dd63` must ride along" —
> and its rail file names are not yet in the *Verify before pushing* commands
> further down. Whoever runs a real rollback should add
> `notebookSchema.rail.test.js`'s writtenSchema cases and
> `offline/writtenSchemaDrain.test.js` / `writtenSchemaCapture.test.js` /
> `NoteEditorPage.writtenSchema.test.jsx` to that list, and ideally re-run the
> simulation with all three commits before relying on this document alone.

## Why a rollback needs the guard

TipTap reads a stored note body whole or not at all. If a note contains even one
node or mark type the loading editor does not register, the note opens **empty**:
`createNodeFromContent` catches the `nodeFromJSON` error and returns an empty
document. That editor's next save then writes the empty document over the note.
The compare-and-set on `updated_at` cannot stop it, because the old tab holds the
current revision.

Wave 5 and G-064 add six such types: `inlineMath`, `blockMath`, `highlight`,
`textColor`, `askInsert` and `askCitation`. Once the features are reverted, the
rolled-back bundle can read none of them, and members have already written notes
that contain them.

Opening such a note is enough to cause the damage. On origin/master,
`UpbRichEditor.jsx` (lines 224-256) calls `setContent(docJson, false)`. TipTap
3.23.6 declares that command as
`setContent(content, { errorOnInvalidContent, emitUpdate = true, ... } = {})`. The
`false` is not an options object, so `emitUpdate` keeps its default of `true`.
That fires `onUpdate`, which schedules the autosave, and the autosave writes the
empty document. So opening a Model Book entry the editor cannot read saves a
blank body. This was read from the code, not measured on the wire.

## What the guard is

**`8167f7aa0`** adds the guard and the map.

- **One fact, stored in two files.** `NOTEBOOK_TYPE_SCHEMA` maps each type to the
  schema level that introduced it. It lives in
  `app/src/pages/journal-2-0/lib/notebookSchema.js` and in
  `api/services/journal_two/notebook_schema.py`.
  - Production's 28 nodes and 7 marks are level 0.
  - The six types above are level 1.
  - `tests/test_notebook_schema_guard.py` parses the JS table and asserts it
    equals the Python one.
- **The client declares what it can read.** Each body write sends
  `X-UCT-Notebook-Schema: <N>`. N is **derived** from the live editor schema: it
  is the largest N for which every table type at or below N is registered. N is
  never simply `max(table)`.
- **The server refuses stale writers.** `update_note` and `update_entry` refuse a
  body write when the maximum level over the **stored** body's types exceeds the
  declared N. The refusal is a 409 with the detail *"This note has content from a
  newer version of the app. Reload to edit it."*
  - A missing or unparseable header counts as 0.
  - A type the map does not know counts as 0.
  - Metadata-only writes are never checked.

**`fd87271fd`** adds two more doors that declare the schema, and makes the rail
rollback-safe.

- **Two more doors.** The importer's media rewrite (`lib/importer/commit.js`)
  and the enrichment undo (`revertChartEmbed`) both PUT a body. Both now send the
  header.
- **An enumerating rail.** The rail now finds every client body PUT through the
  AST, instead of naming the known ones.
- **A rollback-safe control.** The rail's non-vacuity control used to name wave-5
  types. It now names level-0 types, because the old version went red in the
  rolled-back state (see *Measured* below).

**`82c56dd63`** fixes the sender-vs-writer gap the whole-branch re-review found in
the guard above: `8167f7aa0`+`fd87271fd` judge the bundle that SENDS a body, never
the bundle that WROTE it, so a body captured offline by a stale bundle and sent
later by a fresh one could slip past the refusal. It stamps `writtenSchema` on
every capture that might be sent by a later page load and forwards it at
`min(stamp, sender's own level)`. See *"Why `82c56dd63` must ride along too"*
below for the full mechanism and why a rollback reopens the same hole without it.

## Why `82c56dd63` must ride along too

The original guard (`8167f7aa0`+`fd87271fd`) judges the **sending** bundle's
level. `82c56dd63` fixes a hole the whole-branch re-review found: a body queued
by one bundle can be **sent later by a different one**, and the guard must judge
the bundle that **wrote** the body, not whichever bundle's turn it is to send it
— tracked as a `writtenSchema` stamp on every capture (the durable record, the
outbox entry, the crash draft), forwarded at `min(stamp, sender's own level)`.

**A rollback is a bundle transition too, so the same hole reopens without it.**
There is no service worker (see *Open tabs* below), so a rollback deploy does
not close every tab at once — for a while, some tabs run the full wave-5 bundle
and others run the freshly rolled-back one, on the same account. Reasoned, not
yet measured on the wire:

- A tab already on the **rolled-back** bundle opens a level-1 note. It has no
  content-error guard (that reverted with the features) and blanks it. Its
  save is refused (409, level 0 vs. 1) and the blank queues in the durable
  offline layer — which is *not* part of wave 5 and does not revert.
- A **different, still-open wave-5** tab on the same account — one that has not
  reloaded since before the rollback — is the outbox's leader. Without
  `82c56dd63`'s stamp, its `sendNoteUpdate` would declare **its own** level (1,
  since its bundle is unaffected by what a *different* tab did) when it drains
  that queued entry. The server's guard has not changed across the rollback, so
  required = 1, declared = 1, and it would accept the blank: the exact B1
  overwrite, now triggered by the rollback's own transition window instead of
  wave 5's original deploy.
- With `82c56dd63` present, the queued entry carries `writtenSchema: 0` — or,
  if the rolled-back bundle also lacks `82c56dd63`'s capture-side code (see
  below), simply carries no stamp at all, which `writtenSchemaOf` already reads
  as 0. Either way the drain declares `min(0, 1) = 0`, the server refuses it
  again, and it forks instead of landing.

**The rolled-back bundle itself does not need `82c56dd63`'s code for this to
hold.** A missing stamp is read as 0 by design, so a rolled-back tab's own
capture — even without any of `82c56dd63`'s changes cherry-picked back — is
already safe by the same "absent ⇒ oldest writer" rule the original guard
established. What must be true is that **whichever bundle eventually sends the
entry** has `82c56dd63`, so it asks for the stamp rather than assuming its own
level. Any surviving wave-5 tab already does, since it is the current tip; a
freshly rolled-back tab does not need to.

### Why the derived declaration keeps a rollback safe

After the features are reverted, the six level-1 types are still in the table but
no longer registered, so the bundle derives **N = 0**. The server then refuses
this bundle's body writes to any note whose stored body contains a level-1 type.
Notes with only level-0 types save normally.

A declaration hard-coded as `max(table)` would say 1 and let the blank write
through. That is the whole reason the declaration is derived.

⚠️ If a rollback drops the `editorSchema()` export from `tiptap.js` by mistake,
`declaredNotebookSchema()` catches the TypeError and declares 0
(`notebookSchema.js`, the `.catch(() => ... 0)` branch). The product stays safe.
The vitest rail goes red, because it imports `editorSchema`.

## Procedure A: revert the merge, re-apply the guard (measured)

```sh
git revert -m 1 <wave-5 merge commit>
git cherry-pick 8167f7aa0          # expect ONE conflict: app/src/pages/journal-2-0/lib/tiptap.js
# resolve it as below, then:
git add app/src/pages/journal-2-0/lib/tiptap.js && git cherry-pick --continue
git cherry-pick fd87271fd          # applies cleanly (measured)
git cherry-pick 82c56dd63          # NOT YET MEASURED against a rolled-back tree —
                                    # see the warning at the top of this document.
                                    # It touches NoteEditorPage.jsx and several
                                    # offline/*.js files wave-5 also touches, so
                                    # expect at least one conflict and resolve by
                                    # keeping the rolled-back side's CONTENT while
                                    # preserving 82c56dd63's writtenSchema plumbing
                                    # (the stamp fields and the min()-forwarding
                                    # calls), the same principle as the tiptap.js
                                    # resolution above.
```

**Resolving the `tiptap.js` conflict.** Keep the rolled-back side of the hunk.
Wave 5's `plainLeafText`, `PLAIN_TEXT_BLOCK_SEPARATOR` and the textBetween-based
`extractPlainText` belong to the features. Then add back the one export the guard
needs:

```js
import { getSchema } from '@tiptap/core'            // with the other imports

let editorSchemaCache = null
/**
 * The app's REAL editor schema, built once from `buildExtensions()`. It is
 * what notebookSchema.js::declaredNotebookSchema reads to declare which note
 * types this bundle can read (X-UCT-Notebook-Schema).
 */
export function editorSchema() {
  if (!editorSchemaCache) editorSchemaCache = getSchema(buildExtensions())
  return editorSchemaCache
}
```

**Verify before pushing.** Run each command in its own call, never through a
pipe:

```sh
python -m pytest tests/test_notebook_schema_guard.py -q
cd app && npx vitest run src/pages/journal-2-0/lib/notebookSchema.rail.test.js \
  src/hub/writePathsTransitive.test.js src/hub/writePaths.test.js src/pages/journal-2-0/lib/importer \
  src/pages/journal-2-0/lib/offline/writtenSchemaDrain.test.js \
  src/pages/journal-2-0/lib/offline/writtenSchemaCapture.test.js \
  src/pages/journal-2-0/components/notebook/NoteEditorPage.writtenSchema.test.jsx
```

⚠️ The last three files are `82c56dd63`'s own rails (the writtenSchema stamp,
capture, drain-forwarding and refusal-fork behaviour) and are NOT YET verified
against a rolled-back tree — see the warning at the top of this document.

⚠️ Step 1 also reverts this file. Read it beforehand, or read it from the feature
branch (`git show <merge>^2:docs/notebook/wave5-rollback.md`).

## Before a squash merge: tag the three commits

If `feat/notebook-10` lands as a squash commit (or the branch is otherwise
deleted after merging), `8167f7aa0`, `fd87271fd` and `82c56dd63` stop being
reachable from any ref and become eligible for garbage collection. Tag all
three before that happens:

```sh
git tag notebook-wave5-guard-8167f7aa0 8167f7aa0
git tag notebook-wave5-guard-fd87271fd fd87271fd
git tag notebook-wave5-guard-82c56dd63 82c56dd63
git push origin notebook-wave5-guard-8167f7aa0 notebook-wave5-guard-fd87271fd notebook-wave5-guard-82c56dd63
```

## Procedure B: revert everything except the guard (not simulated)

Revert the feature commits newest first, and skip `8167f7aa0` and `fd87271fd`.
Any conflicts will be between feature commits, and this path was **not**
simulated. Procedure A is the measured path. If wave 5 landed as a squash
commit, revert that squash commit, then run the same two cherry-picks. That
variant was not simulated either.

## Measured: the rollback simulation, 2026-09-24

I ran the simulation in a throwaway worktree, since removed:

1. Detached the worktree at origin/master `acd230c15`.
2. Merged `feat/notebook-10` at `18855753c` with `--no-ff`.
3. Ran `git revert -m 1` on that merge.
4. Cherry-picked `8167f7aa0`.

| Step | Result |
|---|---|
| Cherry-pick `8167f7aa0` | One conflict, `tiptap.js`, resolved as above |
| `tests/test_notebook_schema_guard.py` | 13 passed |
| `notebookSchema.rail.test.js` as `8167f7aa0` left it | **RED.** Its non-vacuity control asserted `inlineMath`. That control is fixed by `fd87271fd` |
| Cherry-pick `fd87271fd` | Clean |
| Rail, enumeration, hub write-path rails, importer suites | 16 files, 175 tests passed |
| Probe: types registered by the rolled-back editor | `[]`, none of the six |
| Probe: header the rolled-back bundle sends | `X-UCT-Notebook-Schema: 0` |

## What a member sees after a rollback

A note or Model Book entry that contains a level-1 type opens **empty** in the
rolled-back editor, because the pre-wave-5 editor has no content check. Its save
is refused, and **the server copy is untouched.** What happens next depends on
the door. These paths were read from the origin/master code, not measured on the
wire:

- **Note editor.** One reconcile and one retry, then it shows the refusal
  sentence as the save error. No loop and no overwrite.
- **Offline outbox.** It rebases once, then forks a *conflicted copy* holding
  what that tab had, which may be empty. The original note is untouched. The
  copy is litter, not loss.
- **Model Book entry editor.** It treats a 4xx as non-retryable and stops. This
  is the path that save-on-open reaches.

⚠️ The sentence says *"Reload to edit it."* After a rollback, reloading loads the
same rolled-back bundle. The note stays safe but cannot be edited until the
features return.

**Open tabs.** There is no service worker. A tab opened before the rollback
deploy keeps the wave-5 bundle until it reloads. That bundle reads every type,
declares 1, and saves normally, which is correct. Nothing needs to be flushed.

**Coarse levels.** Rolling back only one of the two level-1 feature sets, such as
G-064 alone, still drops the declaration to 0 for every level-1 note, including
notes the bundle could read. That errs safe. It is also why the next wave that
adds a type should use **level 2**.

## Rules that outlive this wave

- ⛔ **Never remove a table entry**, in a rollback or ever. A type missing from
  the map counts as level 0, meaning "every client can read this". That is
  exactly how a note blanks.
- ⛔ **Never hand-set the header.** It is derived from the live editor schema. A
  constant is how a rolled-back bundle would claim to read what it cannot.
- **A new node or mark type** gets the next level, currently 2, in **both**
  files. The Python rail parses the JS table. The vitest rail fails on any
  registered name the table lacks.
- **A new client door that PUTs a note or entry body** must send
  `notebookSchemaHeaders()`. The enumerating rail in
  `notebookSchema.rail.test.js` finds every `fetch` or `upbFetch` PUT to
  `/api/j2/notes/${id}` or `/api/upb/entries/${id}`. It fails on any body PUT
  that does not declare.
- **A new door that CAPTURES a body for a later page load to send** (a durable
  record, an outbox entry, a crash draft, anything a different bundle might
  adopt and forward) must stamp `writtenSchema` at capture time from that
  bundle's OWN derived level, and any door that FORWARDS a body it did not just
  freshly read from the server must send `min(writtenSchemaOf(stamp), its own
  derived level)`, never its own level unconditionally. This is `82c56dd63`'s
  fix (see *"Why `82c56dd63` must ride along too"* above) — skipping it on a
  new capture/forward door reopens the exact hole that commit closed.

## The doors, and why each one is or is not guarded

**Guarded on the server:**

- `PUT /api/j2/notes/{id}`: `update_note`, body writes only.
- `PUT /api/upb/entries/{id}`: `update_entry`, body writes only.

**Clients that declare:**

- `useJ2Note.update`, when the patch carries a body.
- The outbox drain's `sendNoteUpdate`.
- `saveEntryBody`, the Model Book entry editor.
- The importer's media rewrite.
- `revertChartEmbed`.

**Server writers that are not guarded, because none of them serialises an editor
that failed to read the note:**

| Writer | Why it is safe |
|---|---|
| `POST /api/j2/notes` (create) | There is no stored body to lose |
| Version restore (`restore_note_version` → `update_note` with no declaration) | The body is the server's own stored version; the client sends only an id |
| `import_confirm` re-import UPDATE (`notes.py`, in `import_confirm`) | It replaces the note from a file the member chose to re-import; **the client parses it** (`generateJSON`) and sends `bodyJson`, but it loads no editor and blanks nothing — the member picked this exact file, and a parse failure fails the import, it does not silently save an empty note |
| `append_widget_embed`, `append_financial_fact`, `append_document_excerpt` | They load the stored JSON, append one node and save; unknown types pass through untouched |
| Connector sync `_apply_resolved_body` (`note_connectors/engine.py`) | It rewrites placeholders in a body the same sync just wrote, locked on `updated_at` |
| Notebook migration v1 insert (`db.py`) | It is a one-time creation |
