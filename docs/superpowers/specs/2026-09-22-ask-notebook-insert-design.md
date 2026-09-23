# Ask Notebook — insert an answer into a note (G-064)

**Date:** 2026-09-22
**Branch:** `feat/notebook-kill-switch`
**Status:** design, owner-approved in chat 2026-09-22 — awaiting review of this written spec
**Ledger:** `docs/notebook/competitive-gap-ledger.md`, G-064 ("AI-synthesis-inserted-into-a-note")

---

## 1. Objective

Ask Notebook (`app/src/pages/journal-2-0/components/notebook/AskPanel.jsx` +
`api/services/journal_two/ask_service.py`) already lets a member ask a question
over their own note corpus and read a citation-grounded answer, across four
scopes: **This note**, **This document**, **This research** (a ticker's
Research Workspace), **My Notebook**. What it cannot do today — confirmed by
grep, zero hits — is let the member take that answer and actually place it
into a note, so it becomes part of their permanent written record instead of
something they read once and lose.

**The objective:** a member can insert an Ask Notebook answer into a note, from
any of the four scopes, and the note permanently and honestly shows that the
passage came from Ask Notebook — never silently indistinguishable from the
member's own writing, and never carrying a citation that lies about how well
it still matches the (possibly since-edited) text around it.

This is new subsystem territory, not a modification of an existing flow:
`AskPanel.jsx` has no insert affordance, and the editor needs two new node
types to represent this content durably. Classified **Architectural** per
`superpowers:brainstorming`.

---

## 2. Current state (what this builds on)

### 2.1 Ask Notebook today
- `AskPanel.jsx` streams an answer via SSE (`POST /api/j2/ask/stream`),
  splitting it into `parts` (plain text spans + citation chips) via
  `lib/askCitation.js`'s `splitAnswer`/`citedSources`.
- Each citation carries `{n, label, citation (validity state), navigation,
  snippet, ...}`. Validity states (`PRECISE_STATES` in `askCitation.js`,
  mirroring `ask_evidence.PRECISE_CITATIONS` server-side) already model
  degradation: `exact`, `note_only`, `page_only`, `record_only`,
  `unavailable`.
- For Note scope specifically, `getEditorDoc` is passed in and
  `resolveNoteCitation(doc, location, snippet)` re-verifies a citation
  against the LIVE, possibly-edited ProseMirror doc before navigating —
  "positions do not survive an edit, and a confident jump to the wrong
  paragraph is worse than not jumping." **This is the exact mechanism G-064's
  own citation-degradation reuses**, not a new one.
- `ask_evidence.py`'s allowlist (`relevance == query_match`) and
  `ask_prompt.py`'s injection hardening (G-124/G-125, already DONE) mean
  everything `AskPanel` ever shows the member has already passed grounding —
  inserting it is copying already-vetted output into storage, not a new place
  untrusted content could act.

### 2.2 Precedent node types this design extends, not reinvents
- **`documentExcerpt`** (`app/src/pages/journal-2-0/lib/documentExcerptNode.js`)
  — a captured external passage, rendered in quotation marks with a citation
  chip back to its source page. Same "provenance survives independently of
  surrounding prose" idea this design needs.
- **`noteLink`** (`lib/noteLinkNode.jsx`) — an atomic inline node storing only
  an id, resolving its live display state at render time rather than freezing
  a label at insert time. `askCitation` (§4.2) follows the same shape.
- **`Callout`** (`lib/calloutNode.js`) — a `group: 'block', content: 'block+'`
  container: a bordered, tinted box (`background: var(--bg-surface); border:
  1px solid var(--border)`, `border-radius: var(--radius-md)`) with a leading
  icon rendered as a non-editable decoration and an editable body holding
  arbitrary rich content. **`askInsert` (§4.1) is structurally this node**,
  with its own icon/label and its own attrs instead of a member-editable
  emoji.
- **`_sync_note_sidecars`** (`api/services/journal_two/notes.py`) — the ONE
  tree-walk that projects every special node type's data into its own
  sidecar table (embeds, mentions, links, fact refs, excerpt refs). New node
  types are added as new branches in this SAME walk, never a parallel one.
- **`extract_plain_text`** (same file) — the search-index text extractor;
  every special node type gets a branch here too, degrading to a bracketed
  marker (`[widget]`, `[excerpt]`) or, for `noteLink`, deliberate silence.

---

## 3. User flow

### 3.1 Note scope — the common case, zero extra clicks
The member is inside a note, asks a question (any scope reachable from
there), gets an answer, clicks **Insert**. It lands directly in the note
they're already in, appended at the end (see §3.3 for why append-only, here
too). No picker, no extra dialog.

### 3.2 Document / Security-research / Notebook scope — no "current note" exists
Clicking **Insert** opens the SAME search-as-you-type note picker that
already powers `[[` note-link authoring
(`app/src/pages/journal-2-0/components/notebook/NoteLinkMenu.jsx`'s
`NoteLinkList` + its async search) — reused verbatim, not redesigned. Typing
searches the member's notes; selecting one inserts there; a "+ Create new
note titled…" option at the top handles the no-match / net-new case, using
the note-creation path the app already has (same as `+ New note` elsewhere).

### 3.3 Insertion point
Appended at the end of the target note's document — the simplest, least
surprising rule, and consistent with "insert" reading as "add this to my
research on the topic" rather than "splice into wherever my cursor happens to
be in a note I'm not even looking at" (true for every scope except 3.1, where
the member IS looking at the note but may not have a cursor position that
makes sense for a multi-paragraph insert). Not cursor-position-aware in v1 —
recorded as a possible future refinement, not built now (YAGNI: no signal yet
that "insert at cursor" is worth the extra complexity of merging into
existing content mid-document).

---

## 4. Data model

Two new TipTap node types, following the existing family's shape exactly.

### 4.1 `askInsert` — the container block

```js
{
  name: 'askInsert',
  group: 'block',
  content: 'block+',        // real rich content, same as Callout
  defining: true,
  attrs: {
    insertedAt: string,      // ISO timestamp
    scope: 'note'|'document'|'security'|'notebook',
    query: string,           // the member's original question, for context
  },
}
```

Rendered like `Callout`: a bordered/tinted box (same CSS class family,
`border-radius: var(--radius-md)`, `background: var(--bg-surface)`, `border:
1px solid var(--border)`), a leading `sparkle` `UIcon` (not an emoji — this
is UI chrome the member doesn't author, unlike Callout's emoji) instead of
`.uctCalloutIcon`, and a small "From Ask Notebook" label. The body holds real
paragraphs (so normal editing — bold, new paragraphs, deleting a sentence —
just works, same as inside a Callout).

**⚠️ Never remove from `buildExtensions()`** once notes containing it exist —
same rule as every other custom node type in `tiptap.js`: TipTap drops
unknown node types at parse time.

### 4.2 `askCitation` — the inline citation chip

```js
{
  name: 'askCitation',
  group: 'inline',
  inline: true,
  atom: true,
  attrs: {
    sourceKind: 'note'|'document'|'excerpt'|'fact',  // mirrors AskPanel's existing source.navigation.kind values
    sourceId: string,
    label: string,           // display text at insert time (e.g. the source note's title) -- NOT frozen forever, see below
    snippet: string,         // the text this citation was backing, for re-verification
    state: 'exact'|'note_only'|'page_only'|'record_only'|'unavailable'|'stale',
  },
}
```

Modeled on `noteLink`: stores only what's needed to resolve itself, never a
frozen display label treated as ground truth. `label` is a *last-known*
display value (so the chip isn't blank before the first re-render), but
click-through and the `state` badge resolve live, same as `noteLink`
resolving a target's current title.

**New `state: 'stale'`** — added to the existing `PRECISE_STATES` set — for
"this citation's snippet no longer matches the text around it" (see §6).

---

## 5. Backend integration

Each extends an EXISTING single-owner mechanism; none of these are new
subsystems.

- **`_sync_note_sidecars`** (`notes.py`): a new branch for `askCitation`
  nodes, projecting `{sourceKind, sourceId}` into a sidecar table the same
  shape as the existing five (`note_id` leading the composite primary key,
  same as every other sidecar — see `db.py`'s schema). This is what makes
  "what does this note cite" / backlinks-style queries reachable later
  without a second tree-walk.
- **`extract_plain_text`**: `askInsert`'s prose contributes to `body_plain`
  normally (it's real text content, walked like any paragraph). `askCitation`
  degrades to silence in the extracted text, matching `noteLink`'s own
  "citation chips are chrome, not searchable text" precedent — the PROSE is
  searchable, the citation markers are not.
- **Export (`notes_export.py`)**: an `askInsert` block exports as a labeled
  section (mirroring `documentExcerpt`'s "attribution survives export"
  idiom) — the prose, followed by its citations as a reference list, so a
  member's exported Markdown doesn't silently lose which parts were
  AI-assisted.
- **Import**: `askInsert`/`askCitation` are never produced by any importer
  (Notion/Obsidian/Evernote/generic) — they only exist via the insert action
  itself. No importer changes needed.

---

## 6. Edit behavior — the permanent-marking / per-citation-staleness split

- **The `askInsert` block's "this came from Ask Notebook" identity is
  permanent.** No amount of editing the prose inside it removes the block
  wrapper or its label. Provenance should never silently vanish — that's the
  entire reason this feature exists. (A member CAN explicitly delete the
  whole block, same as deleting any other content — that's a normal delete,
  not a special "unwrap" action, and not built as one in v1.)
- **Individual `askCitation` chips degrade independently.** On note save, the
  same re-verification `resolveNoteCitation` already does for Ask Current
  Note (§2.1) runs against each citation's stored `snippet`: if the
  surrounding text still matches, `state` stays as it was; if it doesn't,
  `state` becomes `'stale'` and the chip renders with the same honest,
  non-alarming degradation treatment `AskPanel.jsx` already uses for
  `page_only`/`note_only` (`.sourceApprox`, "quiet, not a warning banner" —
  same words, same file, so the two surfaces can't drift per that file's own
  documented rule).

---

## 7. Visual design

- `askInsert`: CSS class family parallel to `.uctCallout*`
  (`.uctAskInsert`, `.uctAskInsertIcon`, `.uctAskInsertBody`,
  `.uctAskInsertLabel`) — same box treatment, `sparkle` icon, a small label
  row above the prose reading "From Ask Notebook" (+ the original query on
  hover/tap, for context, not as the primary label — keeps it uncluttered).
- `askCitation`: same chip styling `AskPanel.jsx`'s own citation chips
  already use (`.citationChip` family), so a citation looks identical whether
  you're reading it in the Ask panel or inside a note — one visual language,
  not two.
- Accessibility: chip `aria-label` carries the same `` `Source ${n}: ${label}` ``
  pattern AskPanel's own citation chips use (`AskPanel.jsx:263`); a `stale`
  citation's degradation is stated in words in the accessible name, not color
  alone — the same rule `AskPanel.jsx` itself states in-line above its own
  degradation span: *"Degradation is stated in WORDS, never by colour alone"*
  (`AskPanel.jsx:300`).

---

## 8. Error handling

- **Insert fails to save** (network error, note changed underneath in
  another tab): the answer stays visible and intact in the Ask panel; the
  member can retry the insert or copy the text manually. Never a silent
  failure, never a lost answer.
- **"Create new note" abandoned partway** (picker closed before a title is
  chosen): no note is created, nothing is inserted. No orphaned state.
- **A cited source is deleted/trashed after insertion**: the `askCitation`
  resolves its `sourceKind`/`sourceId` at click-time; a missing target
  degrades to `state: 'unavailable'` (already an existing state in
  `PRECISE_STATES`) with honest copy, not a broken navigation or a silent
  disappearance.
- **Prompt-injection surface**: explicitly, this introduces none. Everything
  `AskPanel` ever renders has already passed `ask_evidence.py`'s allowlist
  and `ask_prompt.py`'s injection hardening (G-124/G-125) before the member
  sees it; inserting copies already-vetted, already-displayed content into
  storage. No new untrusted-content boundary is crossed.

---

## 9. Rollout

Ships dark behind a new Notebook capability flag, riding the **same
mechanism Wave K already established for this subsystem** — a key on the
auth payload (`_access_payload` in `api/routers/auth.py`), read PER REQUEST,
so a flip reaches a member on their next authenticated request or reload
with **no rebuild**.

This is deliberately **not** a `VITE_*` build flag. A build flag is compiled
into the bundle — flipping it needs a full rebuild-and-deploy, and
`docs/feature_flags.json`'s own `build_flags` section records a real
incident where that wiring silently broke: nine `VITE_*` flags were set on
the web service, mostly to `1`, and all nine were undefined in the shipped
bundle for four days because `Dockerfile.web` declared no matching build
ARGs — invisible to the repo because nothing was watching that half of the
app. The auth-payload pattern has no such gap and is the one this session
has used for every other capability today (G-074's
`AWARENESS_THESIS_REVIEW_ENABLED`; Wave K's four `NOTEBOOK_*` keys) — it is
the cheapest lever that can actually reach production, per this repo's own
flag-first-rollback rule.

Working name: **`NOTEBOOK_ASK_INSERT_ENABLED`**, an enablement gate (unset =
OFF — a new, unreleased capability defaults off, the same polarity Wave K
gave its own three enablement gates; only a kill-switch like
`NOTEBOOK_OFFLINE_DEFAULT_ON` defaults on). Declared in
`docs/feature_flags.json`'s AST-derived `flags` section on arrival, the same
way `AWARENESS_THESIS_REVIEW_ENABLED` was declared earlier today —
`tests/test_feature_flag_ledger.py` fails by name on an undeclared
off-by-default gate, so this is not optional bookkeeping. Tested and live in
the code, invisible to members until explicitly turned on; single-lever
rollback (unset the key) once it is.

---

## 10. Testing strategy

- **Backend**: node-handling tests for `_sync_note_sidecars`'s new branch
  (save → sidecar row exists, matching `test_wave_d_links.py`'s fixture
  style), `extract_plain_text` tests (prose searchable, citation chrome
  silent), export round-trip tests, and the staleness re-verification logic
  (edit text under a citation's snippet → `state` flips to `stale`; edit
  unrelated text → `state` unchanged) — TDD, with a mutation proof on the
  staleness check specifically (the highest-value correctness property here).
- **Frontend**: RTL tests for both new node views (renders correctly, chip
  click-through, `stale` state renders the honest degradation copy), and an
  insert-flow test from `AskPanel.jsx` (Note scope: lands in current note,
  zero clicks; other scopes: picker opens, search/select/create-new all
  reachable).
- **Live verification**: this touches real editor content and a new save
  path, so — same discipline as the backlink-context-preview and combobox
  work earlier this session — a real live-browser pass before calling it
  done: ask a real question, insert a real answer, reload, confirm the block
  and citations render correctly and are still clickable.

---

## 11. Explicitly out of scope (not silently missed — a deliberate v1 boundary)

- **Cursor-position-aware insertion** (§3.3) — append-to-end only in v1.
- **An explicit "unwrap"/"accept as my own words" action** (§6) — deleting
  the block is the only way to remove the marking; no special conversion
  action.
- **Regenerating an insert** (re-running the original query and replacing the
  block's content) — not built; a member who wants an updated answer asks
  again and inserts a new block.
- **Extending "Insert" to Ask Current Note's OWN note being the source of its
  own citations** — already naturally covered by the general design (Note
  scope citations can point back into the same note), no special handling
  needed, but not separately tested as its own scenario beyond what §10
  already covers.
