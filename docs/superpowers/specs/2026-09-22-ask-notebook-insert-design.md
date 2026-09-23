# Ask Notebook — insert an answer into a note (G-064)

**Date:** 2026-09-22 — **revision 2**
**Branch:** `feat/notebook-kill-switch`
**Status:** Revision 2. Final pre-build version, written on the owner's instruction
of 2026-09-22 ("do one final analysis … finalize the plan … then proceed with the
final build"). Revision 1 (`39bc8fa2c`) was checked line by line against the code
at `a0adf6a9f` by three independent read-only audits. It had the right intent and a
wrong mechanism in several places. §13 lists every change and the evidence behind it.
**Ledger:** `docs/notebook/competitive-gap-ledger.md`, G-064 ("AI-synthesis-inserted-into-a-note")
**Owner decisions this spec implements (2026-09-22, not re-opened here):** all four
Ask scopes · prose and citations preserved · a Callout-style bordered block ·
permanent marking with per-citation staleness · reuse the `[[` note search.

---

## 1. Objective

Ask Notebook (`AskPanel.jsx` + `api/services/journal_two/ask_*.py`) answers a
question over the member's own notes and shows a cited answer. Today the answer
cannot be kept: there is no insert affordance anywhere. The objective is that a
member can put an answer into a note from any of the four scopes, and that the
note stays honest about it afterwards.

Five promises. Every section below exists to keep one of them:

| # | promise |
|---|---|
| **P1** | An inserted answer always shows it came from Ask Notebook. Editing the prose never removes that. |
| **P2** | A citation whose backing text the member later edited says so, in words. |
| **P3** | Ask Notebook never cites an inserted answer back to the member as if they wrote it. |
| **P4** | Inserting can never fork a note, lose an edit, or bypass version history. It uses the one save path the Notebook already trusts. |
| **P5** | Export keeps the provenance; a public share link does not leak the member's other notes through a citation. |

---

## 2. What exists today (verified at `a0adf6a9f`)

### 2.1 AskPanel
- Props are exactly `scope, target, getEditorDoc, onNavigate, autoOpen, onClose`
  (`AskPanel.jsx:52-61`). There is no editor handle and no insert callback.
- Scopes are `'note' | 'document' | 'security' | 'notebook'`
  (`AskPanel.jsx:27-32`; server `ask_service.py:42-46`).
- Mount sites:

| host | scope | a note editor is mounted? |
|---|---|---|
| `NoteEditorPage.jsx:2003-2011` | `note` | **yes** (`editorRef`) |
| `DocumentPreviewSheet.jsx:61-67` inside `NoteEditorPage.jsx:1886` | `document` | **yes**, behind the sheet, not plumbed through |
| `DocumentPreviewSheet.jsx:61-67` inside `TickerResearchWorkspace.jsx:266` | `document` | no |
| `ResearchHome.jsx:131-134` | `notebook` | no |
| `TickerResearchWorkspace.jsx:145-146` | `security` | no |

### 2.2 The answer
- Plain text rendered with `white-space: pre-wrap` and no markdown parser
  (`AskPanel.module.css:141`). The `final` event replaces the streamed text
  (`AskPanel.jsx:152-153`). A completed answer sets `status = 'done'` and pushes
  `{q, a}` onto `historyRef` (`:161-163`).
- `splitAnswer(answer, sources)` (`askCitation.js:47-60`) turns `[n]` into a chip
  **only if** source `n` was actually sent; an invented `[9]` stays literal text.
  `citedSources` (`:66-76`) lists the sources cited, in first-cited order.
- A source object (`ask_service.py:98-118`) carries `n, type, label, citation,
  snippet, navigation, location, stance, payload, textOrigin, truncated`. **No
  source id crosses the wire except inside `navigation`.** `snippet` is the
  *source* passage, not the answer sentence.
- `navigation.kind` has five values (`ask_evidence.py`): `note {note_id}` ·
  `document {document_id, page_number, note_id?}` · `excerpt {excerpt_id,
  document_id, page_number}` (no note id) · `fact {fact_id, note_id}` ·
  `review {note_id, review_id}`.
- **Two different state vocabularies, which revision 1 confused.** The server's
  per-source `citation` field is `exact | page_only | note_only | record_only |
  unavailable` (`ask_evidence.py:174-180`; mirrored `AskPanel.jsx:351`). The
  client's re-resolution outcomes are `valid_exact | reresolved_exact |
  valid_note_only | degraded`, with `PRECISE_STATES = {valid_exact,
  reresolved_exact}` (`askCitation.js:29-34`). Adding a `stale` value to
  `PRECISE_STATES` would have made stale citations navigate as precise
  (`NoteEditorPage.jsx:1148`).
- Fixed in this wave: resolveNoteCitation now re-verifies a re-resolved range's
  text before claiming RERESOLVED_EXACT (an empty paragraph could misalign the
  walker and select the wrong passage). Full empty-block parity between the
  walkers and ProseMirror's textBetween remains open.

### 2.3 Ask retrieval reads every block of a note
- Notebook and security scopes select candidate notes by FTS over `body_plain`
  (`ask_retrieval.py:195-199`), then locate the passage by walking `body_json`
  through `note_citation_text.flatten` (`_best_note_passage`, `:219-238`). Note
  scope walks `body_json` directly (`_note_blocks`, `:1120-1152`).
- Every block becomes evidence labelled as the member's own note, shown to the
  model under "notes they wrote" (`ask_evidence.py:275-290`; `ask_prompt.py:84-86`).
  **So an inserted answer would be cited back as the member's writing — P3.**
- `flatten` treats any type not in `_LEAF_TYPES` as a container: two positions
  plus a block separator (`note_citation_text.py:73-76, 133-142`). An
  unregistered inline chip would shift every later server citation position by
  one per chip and degrade citations into that note.

### 2.4 How notes are written, and why a server-side insert is ruled out
- The open editor autosaves with `baseUpdatedAt` (`NoteEditorPage.jsx:1539`).
  A mismatch returns 409 (`notes.py:2350-2351`), and `classifyServerChange`
  (`serverChange.js:127-142`) merges **only** server-appended tails made of
  `widgetEmbed`, `financialFact` or `documentExcerpt` (`:56-60`). Anything else is
  a body rewrite, which **forks** the note into a "(conflicted copy)"
  (`NoteEditorPage.jsx:1493-1513`; offline drain `outboxDrain.js:708`).
- The three server appends (`notes.py:2468-2637`) take no baseline, capture no
  version, and run their read-modify-write outside a write transaction.
- The F5 freeze is armed: `serverChange.js` and `settleNoteWrite.js` may not
  change (`f5Freeze.test.js:10-12, 102-105`).
- **Consequence:** a server-side "append an askInsert" endpoint would fork any
  open or offline-queued copy of the target note, skip version history, and could
  only be made safe by editing frozen files. It is not built. Every insert in this
  design is an **editor transaction** that rides the normal autosave (§5).
- Precedent for inserting into the open editor: `CaptureInboxTray.place`
  (`NoteEditorPage.jsx:161-191`). `insertContent` replaces a selected node, so an
  explicit position is used (`:164-166`).

### 2.5 Node-type precedents
- `Callout` (`calloutNode.js:35-75`): `content: 'block+'`, `defining`, static
  `renderHTML`, no node view, so it cannot render a `UIcon`.
- `NoteLink` (`noteLinkNode.jsx:25-63`): inline atom, React node view
  (`NoteLinkView.jsx:40-53`), no `leafText`.
- `DocumentExcerpt` (`documentExcerptNode.jsx:19-54`): block atom, React node view.
- No journal-2-0 node uses `NodeViewContent` yet. `askInsert` is the first React
  node view with editable content.
- Every `buildExtensions()` consumer picks up new nodes automatically:
  `NoteEditorPage` :1293, `NoteVersionPreview` :26, `SharedNotePage` :73 (public),
  charts `NotebookWidget` :69, modelbook `UpbRichEditor` :205.

### 2.6 Flags (Wave K mechanism)
- `NOTEBOOK_FLAGS` (`api/routers/auth.py:132-137`), read per request, spread into
  `_access_payload`. Payload key = env name lower-cased (`:168-174`). Naming is
  `_ON`, not `_ENABLED`.
- Client: `notebookFlag(key)` returns `true | false | null` from a per-tab latch
  (`notebookFlags.js:92-128`); fallbacks in `FLAG_FALLBACKS` (`:36-42`).
- `tests/test_notebook_flags.py:20-25, 60` pins the exact roster of keys and must
  be edited for a fifth. `tests/test_feature_flag_ledger.py` fails by name on an
  undeclared off-by-default gate.

### 2.7 Export and share
- `notes_export._block` keeps an unknown node's children and drops its wrapper;
  a childless unknown node exports as `""` (`notes_export.py:555-559`). Revision
  1's block would have exported with no label — the opposite of P5.
- `note_shares.resolve_share` serves `bodyJson` verbatim to anonymous readers
  (`note_shares.py:139-149`). Share links are off (`J2_SHARE_LINKS_ENABLED`).

### 2.8 Two live defects found by the analysis (fixed in this wave, §10)
- **(a) Research-workspace citations are dead.** `TickerResearchWorkspace` passes
  `onOpenNote` to `AskPanel` (`:145-146`), which is not an AskPanel prop, so
  `onNavigate` is null and every citation click in "This research" does nothing
  (`AskPanel.jsx:182`).
- **(b) Callout and Toggle styling never applies.** `NoteEditorPage.module.css:363-426`
  styles `.uctCalloutIcon`, `.uctCalloutBody`, `.uctToggleChevron` and
  `.uctToggleDetails` as bare classes. A CSS module hashes them — the built
  stylesheet contains `._uctToggleChevron_1xnnk_773` and `._uctCalloutIcon_1xnnk_725`
  — while `calloutNode.js:71` and `toggleNode.js:109` write the raw names.
  Measured effect: the rules match nothing. Callout bodies lose their flex sizing,
  and the Toggle chevron renders as a default browser button with no 44px touch
  target on phones. The file's own comment at `:201-206` names this exact trap.

---

## 3. User flow

### 3.1 When Insert is offered
Only when all hold: the flag `notebook_ask_insert_on` is `true` for the tab, the
answer completed (`status === 'done'`), and it cites at least one real source
(`cited.length > 0`). Not while streaming, not on an error or rate limit, not for an
answer with no citations (an uncited answer is not grounded, and inserting it would
put an unsourced AI paragraph into the member's record).

After an insert, the button reads **"Inserted"** and is disabled for that answer, so
one answer cannot be inserted twice by a double click. A new answer re-enables it.

### 3.2 A note is open — one click
Hosts with a note editor: `NoteEditorPage`'s Ask ("This note"), and the document
Ask inside a document opened from a note. Button: **"Insert into this note"**. The
answer is appended at the end of the note by an editor transaction, and the page
scrolls it into view. No dialog.

### 3.3 No note is open — pick one
Hosts: Research Home ("My Notebook"), the ticker research workspace ("This
research"), and a document opened from that workspace. Button: **"Insert into a
note…"** opens a note picker:
- a search box using the same `GET /api/j2/notes?q=…&limit=8` search the `[[`
  menu uses (extracted into one exported function both call);
- results rendered with the existing `NoteLinkList` (`NoteLinkMenu.jsx:37-109`);
- a first row **"Create a new note"**, titled with what the member typed, else the
  question (first 80 characters).

The picker renders inline, inside the Ask panel. On touch the panel is already a
`Sheet`, so this does not stack a second modal.

Choosing a note **opens that note** through the host's own `onOpenNote` (the same
function its note list uses), and the answer is appended there when its
editor is ready (§5.2), then scrolled into view with a toast "Answer inserted at the
end of this note." Choosing "Create a new note" creates the note with the block as
its body in one request, then opens it.

The member leaves the research page to see the note. That is deliberate: it is the
only way the insert can use the note's own save path (§2.4, P4), and the member
sees exactly where the answer went. Browser Back returns to the research page.

### 3.4 Where it lands
Always at the end of the note. Not cursor-aware in v1 (§12).

### 3.5 What is inserted
Exactly what the panel showed: the answer split into paragraphs on line breaks
(empty lines dropped), each valid `[n]` as a citation chip, an invented `[n]` left
as literal text. No markdown interpretation — the panel does none either.

---

## 4. Data model

Both nodes are registered in `buildExtensions()` (`tiptap.js`) with the standard
warning: **never remove** — TipTap drops unknown node types at parse time, so
unregistering either would delete content from every note that has it. The flag
gates only the Insert button, never the nodes.

### 4.1 `askInsert` — the container block

```js
Node.create({
  name: 'askInsert',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,        // Backspace/Delete at its edges never merge the body out
  draggable: false,
  addAttributes: {
    insertedAt: { default: null },   // ISO 8601, set at insert
    scope:      { default: null },   // 'note'|'document'|'security'|'notebook'
    question:   { default: '' },     // the member's question, for context
  },
  parseHTML: [{ tag: 'div[data-type="ask-insert"]' }],
  renderHTML: ['div', { 'data-type': 'ask-insert', 'data-inserted-at', 'data-scope', 'data-question' }, 0],
  addNodeView: ReactNodeViewRenderer(AskInsertView),
})
```

- `AskInsertView`: `NodeViewWrapper[data-type="ask-insert"]` → a header with
  `contentEditable={false}` (sparkle `UIcon`, "From Ask Notebook", the insert date;
  the question in its `title` and accessible description) → `NodeViewContent` as
  the editable body.
- **P1 mechanics:** `isolating` stops Backspace at the start and Delete at the end
  from lifting the body out of the block. `content: 'block+'` means deleting every
  paragraph leaves the wrapper with one empty paragraph. Removing the block is an
  ordinary node delete: select it and delete. There is no unwrap command. A
  selection that crosses the block's edge cannot be deleted or typed over: a
  filterTransaction guard rejects any step whose deleted range has its two ends
  under different askInsert ancestors (this also blocks lifting a paragraph out).
  Deleting the WHOLE block, edits wholly inside it, and pure insertions are
  allowed.
- Not added to the slash menu. The `renderHTML` fallback (used by HTML copy/paste
  and static renders) is a plain div with a content hole, and it parses back to the
  same node.

### 4.2 `askCitation` — the inline chip

```js
Node.create({
  name: 'askCitation',
  group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes: {
    n:        { default: null },  // number: shown as "[n]", named "Source n"
    label:    { default: '' },    // source label at insertion (e.g. a note title)
    nav:      { default: null },  // the source's `navigation` object, verbatim
    citation: { default: null },  // server precision at insertion: exact|page_only|note_only|record_only|unavailable
    claim:    { default: '' },    // claimText of this chip's paragraph at insertion (§6)
  },
  parseHTML: [{ tag: 'span[data-type="ask-citation"]' }],   // attrs from data-*, nav as JSON
  renderHTML: ['span', { 'data-type': 'ask-citation', … }, `[${n}]`],
  addNodeView: ReactNodeViewRenderer(AskCitationView),
})
```

- No `leafText`, the same as `noteLink`, so ProseMirror's `textBetween` gives it
  zero characters. The server's `flatten` must agree (§7.1).
- **Deliberately not stored:** the source `snippet` and `location`. v1 does not
  re-verify sources (§6.5), and storing another note's passage inside this note
  would copy it into this note's export, share payload and search index.

---

## 5. Write path — one mechanism, the editor transaction

### 5.1 Building the node (one function)
`buildAskInsertNode({ answer, sources, question, scope, insertedAt })` in a new
`lib/askInsert.js` returns the `askInsert` JSON. It uses `splitAnswer` for chips and
`claimText` (§6) for each chip's `claim`. `question` is the question that produced
the answer on screen: the last `historyRef` entry's `q`, never the live input box,
which the member may already have changed. It is the only place insert content is
built, and it is pure, so it is tested without an editor.

### 5.2 Inserting
- **Open note (§3.2).** `NoteEditorPage` passes `onInsert(node)` to `AskPanel` and,
  through a new `onInsert` prop, to `DocumentPreviewSheet`'s `AskPanel`. It runs
  `editor.chain().insertContentAt(editor.state.doc.content.size, node).run()` — an
  explicit position, never the selection — then scrolls the new block into view.
  The normal autosave persists it: baseline check, version capture, offline outbox,
  all unchanged. No new endpoint, no `settleNoteWrite` call, no new door.
  `onInsert` is passed only while the editor is editable. A read-only note's Ask
  offers no Insert (NoteEditorPage passes no onOpenNote); the page never sets the
  editor read-only today, so this is unreachable. Inside the fullscreen document
  sheet the note is hidden, so the button changes to "Inserted" (§3.1); the page
  toast also fires, and may sit behind the sheet.
- **Other note (§3.3) — a pending insert.**
  1. The picker hands `{ noteId, node, createdAt }` to two carriers: a module
     variable and `sessionStorage` under `uct.j2.askInsert.pending`. This is the
     exact `writePendingShare`/`takePendingShare` pattern (`shareTarget.js:171-205`).
     Memory carries the in-app route change even where storage is refused;
     `sessionStorage` carries a full reload. Only one entry is held at a time.
     Then it calls the host's `onOpenNote(note)`: `ResearchHome.jsx:73`,
     `TickerResearchWorkspace.jsx:67`, which fall back to `navigate(notePath(id))`.
  2. `NoteEditorPage` consumes it once, when all hold: `hydratedRef.current` is
     true (the consume effect is declared **after** the arming effect at
     `NoteEditorPage.jsx:1438-1440`, because effects run in declaration order),
     the editor is editable, the recovered-draft decision is **finished FOR
     THIS NOTE** (`decide()` at `:714-741` is async; `recoveryDecidedFor` is set
     to the note's own id when it settles, either way, and is compared against
     the CURRENT `noteId`, `:1474` — a decision made for a note this reused
     component instance has since left, on an A->B switch, must never
     authorize an insert into the note it now shows), no draft is pending
     (`pendingDraft` null — a restore calls `setContent` and would erase the
     insert, `:813`; the insert therefore waits until the member restores or
     discards), no save is in flight (a Restore's PUT must settle first —
     `saveStatus !== 'saving'`; `restoreDraft()` sets `saveStatus:'saving'`
     synchronously before its own `await update(...)`, `:814,824`, closing the
     window where the insert's own autosave could fire mid-restore and carry
     a pre-restore `baseUpdatedAt`), and the entry's `noteId` matches and is
     under 15 minutes old.
  3. Consume = **remove the key first, then insert** through the same transaction
     as the open-note case, so a StrictMode double effect or a reload can never
     insert twice. Another note's entry is left for that note; an expired or
     malformed entry is removed without inserting.
  4. If the editor is not editable, the entry is removed and the note's toast says
     "This note can't take changes right now, so the answer wasn't inserted. Ask
     again to get it back." (The page never sets the editor read-only today, so this
     guards a future state rather than a known one.)
- **New note.** `createNoteViaApi({ title, bodyJson: { type: 'doc', content: [node] } })`
  (`noteCreation.js:21`), then navigate to it. A create is not a door
  (`doorFamilies.settle.test.jsx:146`).

### 5.3 What this deliberately does not touch
`serverChange.js`, `settleNoteWrite.js`, `outboxDrain.js`, every server append
function, and the door rails. The F5 freeze stays intact.

---

## 6. Staleness — what "per-citation staleness" means

### 6.1 Provenance is permanent (P1)
See §4.1. The block's identity never changes with editing.

### 6.2 The definition (P2)
A citation is **"edited since inserted"** when the text of the paragraph it sits in
is no longer the text that paragraph had when the answer was inserted.

```
claimText(textblock) = the block's direct text-node text, concatenated,
                       whitespace runs collapsed to one space, trimmed.
                       Chips and other inline atoms contribute nothing.
stale(chip)          = claimText(the chip's parent textblock now) !== chip.attrs.claim
```

Consequences, all intended: chips in one paragraph go stale together; chips in other
paragraphs are unaffected; moving a chip to another paragraph makes it stale; a typo
fix makes that paragraph's chips stale. That is true: the text they back changed.
The chip still names its source.

This is the member-edit reading of the owner's "per-citation staleness" choice.
Revision 1 tried to re-verify the source passage against the *host* note, which
would have marked nearly every chip stale on first save (§13).

### 6.3 Computed at render, never stored
A ProseMirror plugin inside the `askCitation` extension recomputes on every doc
change and emits a node decoration `{ askStale: true }` for each stale chip.
`AskCitationView` reads its decorations. Nothing is written to the document, so the
check can never trigger a save (the H14 save-loop class), and there is exactly one
authority. It needs no network and works identically in `SharedNotePage`,
`NoteVersionPreview` and every other `buildExtensions` host.

### 6.4 One function, two uses
`claimText` lives in `lib/askInsert.js` and is used both to build `claim` at insert
time and in the plugin, so the two cannot disagree.

### 6.5 Source drift is out of scope for v1
A chip does not detect that its source was later edited or deleted. Clicking it
opens the source as it is now, and the destination shows its own trashed or
unavailable state. The insert date is shown once, in the block's header ("From
Ask Notebook · <date>"); chips do not repeat it (ruled during the build: a chip
moved out of its block is stale anyway). Recorded in §12.

### 6.6 How a chip reads
- Normal: `[n]`, styled with AskPanel's own `.citationChip` class (imported from
  `AskPanel.module.css`, so there is one definition of how a citation looks).
- Stale: `[n · edited]` — **the degradation is visible as a word**, not colour
  alone, following AskPanel's rule at `AskPanel.jsx:300`.
- Accessible name: `Source {n}: {label}`, then the insert-time precision in words
  when it was not `exact` (`page only` · `note only` · `record` · `unavailable`,
  the same words as `AskPanel.jsx:303-305`), then `, text edited since inserted`
  when stale.
- Clickable (a `<button>`) only when `nav` carries a `note_id`: it opens
  `notePath(nav.note_id)`. Otherwise it is a non-interactive span. In
  `SharedNotePage` the chip is never clickable.

---

## 7. Server changes

### 7.1 Citation positions
Add `"askCitation"` to `_LEAF_TYPES` in `note_citation_text.py` with no
`_ATOM_TEXT` entry — exactly how `noteLink` is handled — so server positions stay
in step with ProseMirror. The existing parity rail is extended with a doc
containing a chip.

### 7.2 Ask never cites an inserted answer (P3)
`flatten` records which blocks sit inside an `askInsert`. `_note_blocks`
(`ask_retrieval.py:1120`) and `_best_note_passage` (`:219`) skip those blocks. Text is
**not** removed inside `flatten` itself, because `flatten` is pinned to ProseMirror's
`textBetween` (`note_citation_text.py:24-29`) and the client mirrors it. A note whose
only match is inside an inserted answer yields no passage, so it is not cited.
A note whose query terms occur only inside inserted answers (and not in its
title) is dropped from the candidates, and the FTS fetch over-fetches
(limit × 3) so answer-only notes cannot crowd real ones out of the result
limit.

`body_plain` and the mention scan still include inserted prose, so the member's own
Search finds their inserted answers. That is intended: Search shows the member their
notes, whereas Ask presents a note to a model as the member's own writing.

### 7.3 No other server walk changes
`extract_plain_text` and `_sync_note_sidecars` recurse through unknown types
(`notes.py:125-174, 203-350`), so prose is indexed and chips stay silent with no
change. **No new sidecar table.** Revision 1's was speculative: nothing in v1 reads
it, and a new table also needs account-purge wiring (`account_purge.py:31-107`).

### 7.4 Export (P5)
`notes_export.py` gains two branches:

```
> **From Ask Notebook** · 2026-09-22 · Q: What did I say about NVDA margins?
>
> <paragraph text, each chip written as [n]>
>
> Sources as of insertion: [1] <label> · [2] <label>
```

Sources are deduplicated by `n`, in first-appearance order. `askCitation` exports
as `[n]` wherever it appears.

### 7.5 Share (P5)
`note_shares.resolve_share` reduces every `askCitation`'s attrs to `{ n }` before
serving the body. `label`, `nav`, `citation` and `claim` carry the titles and text
of notes the member did not share. `askInsert.question` stays: it is the member's
own words inside the note they chose to share. Share links are off today; this
closes the gap before they turn on.

### 7.6 The flag
`NOTEBOOK_ASK_INSERT_ON` joins `NOTEBOOK_FLAGS` with default `False` (enablement
gate: unset means OFF). Payload key `notebook_ask_insert_on`. Client fallback
`false`. The client offers Insert only when `notebookFlag('notebook_ask_insert_on')
=== true`, so `null` (not yet latched) means off. It is declared `dark` in
`docs/feature_flags.json`, and `tests/test_notebook_flags.py` gets the fifth key.
Rollback is to unset it: the Insert button disappears on the member's next page
load, and blocks already inserted stay readable.

(Correction to revision 1: `AWARENESS_THESIS_REVIEW_ENABLED` is not an
auth-payload key — `awareness/engine.py:43` reads it server-side. The precedent
here is Wave K's `NOTEBOOK_*` keys.)

---

## 8. Visual design

- **Block.** The Callout box (`border-radius: var(--radius-md)`, `background:
  var(--bg-surface)`, `border: 1px solid var(--border)`), plus a header row: a 13px
  sparkle `UIcon`, "From Ask Notebook", " · Sep 22" in muted text. Styles live in
  `AskInsertView.module.css` and are applied through `className` from the React view,
  so hashing is correct by construction. There are no raw class names, which is the
  trap in §2.8(b).
- **Chip.** AskPanel's `.citationChip`, imported, not copied.
- **Touch.** The Insert button and picker rows are at least `--tap-min` (44px) at
  ≤1024px. The picker renders inside the Ask panel, which `PanelShell` already makes
  a `Sheet` on touch.
- **No new CSS custom properties.** Only existing tokens are used, so the theme-island
  rails are unaffected.

---

## 9. Errors

- **Storage refused** (private mode, storage full): the memory carrier still hands
  the answer over on the in-app navigation. Only a full page reload between the pick
  and the note opening loses it, and the entry was single-use anyway.
- **Create-new fails:** the picker shows "Couldn't create the note. Your answer is
  still here." and logs `console.error`. The answer stays in the panel. Per the
  raw-error rail, no raw error text is shown.
- **Target note not editable:** see §5.2 step 4.
- **Prompt-injection surface, corrected.** Revision 1 said everything AskPanel shows
  had passed a relevance allowlist. It has not: every source is sent as citable, and
  the allowlist only decides whether to answer (`ask_service.py:189-193`). The real
  new path is the one P3 names: stored model output re-entering Ask as trusted member
  writing. §7.2 closes it. Other readers of note bodies (Search, backlinks, the thesis
  changelog, which reads `body_plain`) do not send note text to a model as
  instructions. The awareness engine reads no note bodies (verified: no `body_plain`,
  `body_json` or `j2_notes` reference under `api/services/awareness`).

---

## 10. Same-wave fixes (found by the analysis, ungated bug fixes)

1. **Research-workspace citations** (§2.8a). `TickerResearchWorkspace` passes
   `onNavigate={(s) => { const id = s?.navigation?.note_id; if (id) openNote({ id }) }}`,
   using its own `openNote` (`:67`). `onOpenNote` becomes a real AskPanel prop
   (the picker's way to open a note), and the workspace passes its own `openNote`
   wrapper, never its raw `onOpenNote` prop, which is undefined when the workspace
   renders standalone.
2. **Callout and Toggle CSS** (§2.8b). Wrap the raw editor class names in `:global()`,
   and add a rail: every raw class name that an editor node writes into the DOM
   (string literals in `lib/*Node.js(x)` `renderHTML` and DOM node views) must appear
   in `NoteEditorPage.module.css` only inside `:global(…)`. The rail derives the list
   from source, never by hand, and carries a control that proves it can fail.
3. **Doc reconciliation.**
   - `RESUME-HERE-2026-09-20.md`:
     - G-002: the version-history UI exists (`NoteEditorPage.jsx:2030-2039`).
     - "Spec not pushed": it is on master.
     - G-053 is not "already honored" — no Compass tool reads `j2_notes`; this is an
       owner decision.
   - `competitive-gap-ledger.md`:
     - G-083's offline signal now exists (`NoteEditorPage.jsx:357-368`).
     - G-040's "Screener — no entry" (a `scanner` entry exists, `registry.js:328`).
     - G-064 → built, dark.

---

## 11. Testing and verification

**Backend** (named files only):
- `flatten` gives a chip one position, with parity against the client fixture.
- Ask excludes inserted blocks in note scope and notebook scope, and still cites the
  member's own paragraph beside an inserted block.
- Export section.
- Share reduction.
- Flag roster and the ledger declaration.

**Frontend:**
- Both nodes parse, render and round-trip through HTML and JSON.
- P1 mechanics: Backspace at the start and Delete at the end keep the wrapper;
  deleting all body text keeps the wrapper.
- `claimText` and the stale plugin:
  - editing the chip's paragraph shows `[n · edited]`;
  - editing another paragraph leaves it unchanged;
  - the check never dispatches a doc-changing transaction.
- `buildAskInsertNode`: paragraphs, chips, a literal `[n]` for an invented source,
  `claim` values.
- AskPanel gating:
  - flag off, streaming, error or no citations → no button;
  - with `onInsert` → "Insert into this note", then "Inserted";
  - without `onInsert` → the picker.
- Picker: search, keyboard, "Create a new note".
- Pending insert:
  - consume once;
  - mismatch and expiry;
  - StrictMode double effect;
  - deferred while `pendingDraft` is set;
  - not editable.
- `NoteEditorPage` integration with a real editor.
- `TickerResearchWorkspace` citation click opens the note.
- The CSS rail.

**Mutation proofs:**
- the stale predicate;
- the `_LEAF_TYPES` entry;
- the Ask exclusion;
- remove-before-insert in the consume.

**Live verification** (local sandbox, `scripts/hub_sandbox_boot.py`, real browser):
- In a note: ask → Insert → reload → the block and chips render → a chip opens its
  source → edit the paragraph → the chip reads `[n · edited]`.
- From Research Home: pick an existing note → it opens with the answer at the end.
- Create a new note from the picker.
- Export the note → the Markdown shows the section.
- Callout and Toggle render with their styling, and the chevron has its 44px floor at
  390px width.

**Gate:** the six-shard gate on the branch against `gate-baseline.json`. Any new
failure is re-run on `origin/master` before being called ours. Run these alone,
because the gate cannot see new failures in them:
- `components/screener/reachable.test.js` and `styles/tapFloor.test.js`, which are
  already red in the baseline;
- `tests/test_feature_flag_ledger.py`, which is not on the master gate.

---

## 12. Out of scope for v1 (a deliberate boundary)

- Cursor-position insertion — append-to-end only.
- An "unwrap" or "accept as my own words" action — deleting the block is the only way
  to remove the marking.
- Regenerating an insert.
- Detecting source drift (§6.5).
- A sources footer inside the block.
- A sidecar table of citations.
- Ask in the charts `NotebookWidget` or the modelbook editor: they render the nodes
  but have no Ask panel.
- **G-053** (Compass reading notes) — an owner decision. G-064 does not widen or
  narrow it.
- A cross-edge edit is silently refused (no toast in v1).

---

## 13. Changes from revision 1 (`39bc8fa2c`)

| # | revision 1 said | code says | now |
|---|---|---|---|
| 1 | staleness re-runs `resolveNoteCitation` against each chip's snippet on save | the snippet is the **source** passage (`ask_service.py:95-106`); run against the host note it fails for every non-self citation; `location` was not stored; documents and facts have no ProseMirror doc | §6: paragraph `claim`, computed at render |
| 2 | add `'stale'` to `PRECISE_STATES` | that set is `{valid_exact, reresolved_exact}`, and adding to it makes stale citations navigate as precise | no change to it; two vocabularies documented (§2.2) |
| 3 | `state` stored and "resolved live" | two authorities over one value | stored insert-time `citation` + render-time decoration (§6.3) |
| 4 | picker inserts into another note "there" | only possible as a server append, which forks, skips versions, and hits frozen files (§2.4) | open the note, insert via the editor (§5.2) |
| 5 | inserted prose is safe to index | Ask would cite it as the member's writing (§2.3) | excluded from Ask passages (§7.2) |
| 6 | (silent) | an unregistered inline chip shifts server citation positions | `_LEAF_TYPES` entry (§7.1) |
| 7 | new sidecar table | nothing reads it; needs purge wiring | dropped (§7.3) |
| 8 | export "mirrors documentExcerpt" | unknown nodes lose their wrapper today | explicit export branches (§7.4) |
| 9 | (silent) | share serves attrs verbatim to anonymous readers | chip attrs reduced to `{n}` (§7.5) |
| 10 | flag `NOTEBOOK_ASK_INSERT_ENABLED` | Wave K keys are `_ON`; the roster test pins four | `NOTEBOOK_ASK_INSERT_ON`, roster edited (§7.6) |
| 11 | `AWARENESS_THESIS_REVIEW_ENABLED` rides the auth payload | server-only (`awareness/engine.py:43`) | corrected (§7.6) |
| 12 | everything shown passed `relevance == query_match` | the allowlist only drives no-answer | corrected (§9) |
| 13 | `askInsert` "is structurally Callout" with a `UIcon` | Callout has no node view, so a `UIcon` can't render | React node view with `NodeViewContent` (§4.1) |
| 14 | `sourceKind` mirrors navigation kinds; `sourceId` | misses `review`; no id reaches the client | store `nav` verbatim (§4.2) |
| 15 | `NoteLinkList` + its async search, verbatim | the search is an unexported closure; no input, no create row | extract the search; new picker around `NoteLinkList` (§3.3) |
| 16 | "zero clicks" in Note scope | AskPanel has no editor handle | new `onInsert` prop (§5.2) |
| 17 | `documentExcerptNode.js` | `.jsx` | fixed |
| 18 | (silent) | Research-workspace citation clicks are dead; Callout/Toggle CSS never applies | same-wave fixes (§10) |
