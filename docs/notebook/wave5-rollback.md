# Rolling back Notebook wave 5: keep the schema guard

> ⛔⛔ **THREE commits are never reverted with the features: `8167f7aa0`,
> `fd87271fd` and `82c56dd63`.** Revert the feature merge, then re-apply all
> three commits in that order. Or revert everything except them.
>
> What each one is FOR in a rollback differs, and the difference matters when
> resolving a conflict: `8167f7aa0` is the guard itself (the server refusal and
> the derived declaration — the part that makes a rolled-back bundle declare 0);
> `fd87271fd`'s **door headers do nothing once rolled back** (a bundle declaring
> 0 sends 0 from every door) — what matters from it in a rollback is its
> **rail fix**, without which the vitest rail is red on the rolled-back tree
> (see *Measured*); `82c56dd63` is load-bearing in **every bundle that declares
> level 1 or higher** (see *"Why `82c56dd63` rides along"*).
>
> ⚠️ `82c56dd63` was added after the simulation below ran (it closes B1, a hole
> the whole-branch re-review found in the guard itself). Its cherry-pick onto a
> rolled-back tree is REASONED, not yet re-simulated; its rail files ARE in the
> *Verify before pushing* list below. Whoever runs a real rollback should re-run
> the simulation with all three commits before relying on this document alone.

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
`min(stamp, sender's own level)`. It is load-bearing in every bundle that
declares level 1 or higher — see *"Why `82c56dd63` rides along"* below for the
rule and what it means for a full versus a partial rollback.

## Why `82c56dd63` rides along

The original guard (`8167f7aa0`+`fd87271fd`) judges the **sending** bundle's
level. `82c56dd63` fixes a hole the whole-branch re-review found: a body queued
by one bundle can be **sent later by a different one**, and the guard must judge
the bundle that **wrote** the body, not whichever bundle's turn it is to send it
— tracked as a `writtenSchema` stamp on every capture (the durable record, the
outbox entry, the crash draft), forwarded at `min(stamp, sender's own level)`.
An entry with no stamp reads as 0.

**The rule: every bundle that declares level 1 or higher must carry
`82c56dd63`.** The hole it closes needs exactly one thing to open — a sender
that declares a level the *writer* of a queued body could not read. A bundle
that declares ≥ 1 and lacks the stamp logic sends every queued entry, including
a stale tab's blank, at its own level, and the server accepts it. A bundle that
declares 0 cannot do that: it sends 0 from every door, stamp or no stamp, and a
level-1 note refuses it.

What that means for each kind of rollback:

- **A full rollback** (Procedure A: every level-1 type unregistered) derives
  **0**, so it is safe with or without `82c56dd63`. Keeping it costs nothing
  and keeps the never-revert set a single rule, which is why the banner says
  three commits and not "two, plus one when…".
- **A partial rollback** (Procedure B, or any revert that leaves the level-1
  types registered — reverting only G-064, say, which the *Coarse levels*
  note below covers) still derives **1**. There `82c56dd63` is load-bearing:
  without it the exact B1 overwrite is back.

⚰️ **What this section said before the fix round's re-review, and why it was
wrong.** It argued that a rollback deploy is a bundle-transition window (no
service worker, so tabs do not all reload at once) in which a still-open wave-5
tab, acting as outbox leader, could drain a freshly rolled-back tab's queued
blank at its own level 1. But every still-open wave-5 tab *already carries*
`82c56dd63` — it is the current tip — and every rolled-back tab declares 0. So
that story only proves wave 5 must never **ship** without the commit, which it
does not; it says nothing about re-applying the commit in a rollback. It also
claimed "the rolled-back bundle does not need `82c56dd63`'s code", which is
false for the partial case above. The rule is the one in bold, and it needs no
window story at all. Reasoned, not measured: the simulation in *Measured* ran
before `82c56dd63` existed.

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

## Procedure A: revert the merge, re-apply the guard (measured for `8167f7aa0` + `fd87271fd`; `82c56dd63` reasoned)

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

Revert the feature commits newest first, and skip **all three** guard commits:
`8167f7aa0`, `fd87271fd` and `82c56dd63`. Any conflicts will be between feature
commits, and this path was **not** simulated. Procedure A is the measured path.
If wave 5 landed as a squash commit, revert that squash commit, then run the
same **three** cherry-picks as Procedure A, in that order. That variant was not
simulated either.

⛔ This is the procedure where `82c56dd63` is most likely to be load-bearing:
if the revert leaves any level-1 type registered (see *Coarse levels* below),
the bundle still declares 1, and without `82c56dd63` the B1 overwrite is back.
Do not drop it to make a conflict go away. ⚰️ This section said "skip
`8167f7aa0` and `fd87271fd`" and "the same two cherry-picks" until the fix
round's re-review caught it — an operator following it would have reverted
`82c56dd63` against the three-commit rule in this file's own banner.

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
  fix (see *"Why `82c56dd63` rides along"* above) — skipping it on a new
  capture/forward door reopens the exact hole that commit closed.
- ⚠️ **The table expresses new NODE and MARK TYPES — not a new, non-optional
  ATTRIBUTE on an existing type.** An older bundle drops an attribute it does
  not know (TipTap discards unknown attrs at parse time; it is a missing TYPE
  that blanks the document), so an attribute addition needs no level bump and
  the table cannot express one. That is fine while every new attribute is
  optional or has a fallback: `widgetEmbed.embedId` degrades through its own
  fallback key today (see the comment beside the attr in
  `lib/widgetEmbedNode.jsx`). A future attribute that a NEW bundle requires and
  an OLD bundle would silently drop — one whose absence changes what the note
  MEANS — needs its own mechanism (a versioned attr with a reader that treats
  absence as the old meaning, or a new node type), and this document does not
  provide one. Decide that when the first such attribute is proposed, not after.

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
