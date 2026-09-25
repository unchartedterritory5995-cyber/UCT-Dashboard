# Ask Notebook Insert (G-064) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member can insert an Ask Notebook answer into a note from any of the four
Ask scopes. The note keeps permanent, honest provenance: labelled block, per-citation
"edited" marker, never re-cited as the member's own writing. The feature ships dark
behind `NOTEBOOK_ASK_INSERT_ON`. Two live defects the analysis found ship alongside it.

**Architecture:** Every insert is an **editor transaction** on the note's existing
autosave. A note that is not open is first opened, then the answer is appended on
arrival through a consume-once hand-off. Two new TipTap nodes, `askInsert` (block)
and `askCitation` (inline atom), carry the provenance. Staleness is a ProseMirror
decoration computed at render and never stored. The server gains a leaf entry,
an Ask-retrieval exclusion, export and share handling, and one flag. No new
endpoint. No change to any F5-frozen file.

**Tech Stack:** React 18 + TipTap v3 (`@tiptap/core`, `@tiptap/react`,
`@tiptap/pm`), Vitest + Testing Library (jsdom), FastAPI/Python 3.12 + pytest,
SQLite.

**Spec:** `docs/superpowers/specs/2026-09-22-ask-notebook-insert-design.md`
(revision 2, commits `befa83b3c` + `afb8beb62`). Read it before any task: §2 has
the verified file:line facts every task relies on, and §13 explains why revision
1 was wrong.

## Global Constraints

- **Worktree:** `C:\Users\Patrick\uct-worktrees\notebook-k`, branch
  `feat/notebook-kill-switch`. Never `cd` into another checkout. Use absolute paths.
- **F5 freeze:** never edit `app/src/pages/journal-2-0/lib/offline/serverChange.js`,
  `settleNoteWrite.js`, `outboxDrain.js`, or any `append_*` function in
  `api/services/journal_two/notes.py` (`f5Freeze.test.js:10-12, 102-105`).
- **Never remove** `AskInsert` or `AskCitation` from `buildExtensions()` once
  added. TipTap drops unknown node types at parse time.
- **The flag gates only the Insert button.** The nodes, the Ask exclusion, export,
  share and the two same-wave fixes are always on.
- **Icons:** `UIcon` only (`app/src/components/ui/UIcon.jsx`); never an emoji in UI chrome.
- **Touch tier is ≤1024px.** Every new control is ≥ `var(--tap-min, 44px)` inside
  `@media (max-width: 1024px)`. No new breakpoint literals.
- **No new CSS custom properties.** Use existing tokens only (`--radius-md`,
  `--bg-surface`, `--border`, `--text-muted`, `--tap-min`).
- **No raw class names for styling.** New node views style through CSS-module
  `className`. A class written raw into editor DOM must be styled via `:global()`.
- **Exact copy** (tests assert these strings):
  - `Insert into this note` · `Insert into a note…` · `Inserted`
  - `From Ask Notebook`
  - `Answer inserted at the end of this note.`
  - `This note can't take changes right now, so the answer wasn't inserted. Ask again to get it back.`
  - `Couldn't create the note. Your answer is still here.`
  - `Create a new note` · `Create a new note titled "<typed text>"`
  - `Find a note to insert into` (search label) · `Search your notes…` (placeholder)
  - chip `[n]`, stale chip `[n · edited]`
  - chip name `Source n: <label>`, then `, page only` / `, note only` / `, record` /
    `, unavailable` when not exact, then `, text edited since inserted` when stale
- **Tests are always scoped.** Frontend, from `app/`:
  `npx vitest run <files> --maxWorkers=2`. Backend, from the repo root:
  `python -m pytest <named files> -q`. Never `pytest tests/ -k`, and never a full
  vitest run.
- **A run without a totals line is not a run.** Never pipe a runner, and never end a
  verification command with `echo`. Use
  `<cmd> > /tmp/g064.log 2>&1; code=$?; tail -15 /tmp/g064.log; exit $code`, then read
  both the `Tests`/`passed` line **and** the exit code.
- **Tests run in their own tool call before `git commit`,** never chained with it.
- **Commits:** stage named files only, never `git add -A`. Run
  `python tools/check_repo_hygiene.py --staged` before each commit. Commit with
  `git commit -F - <<'MSG' … MSG`, never `-m` with backticks. End every message with:

  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01HiiyhLP3J7WbX1wf3XLeQ6
  ```

- **Never push** before Task 13. Never push to `master`, never `--no-verify`, never
  force-push.
- **Do not create worktrees or delete any directory under `uct-worktrees\`.**
- **At most 3 concurrent agents** on this box. Check free memory before any gate.

---

## File map

| file | status | responsibility |
|---|---|---|
| `app/src/pages/journal-2-0/components/notebook/NoteEditorPage.module.css` | modify | `:global()` the raw Callout/Toggle classes (Task 1) |
| `app/src/pages/journal-2-0/components/notebook/editorRawClasses.test.js` | create | rail: raw editor classes are never styled bare (Task 1) |
| `app/src/pages/journal-2-0/components/notebook/TickerResearchWorkspace.jsx` | modify | citation `onNavigate` (T2), `onOpenNote` for insert (T10) |
| `api/routers/auth.py` | modify | `NOTEBOOK_ASK_INSERT_ON` in `NOTEBOOK_FLAGS` (T3) |
| `tests/test_notebook_flags.py` | modify | roster gets the fifth key (T3) |
| `docs/feature_flags.json` | modify | declare the gate `dark` (T3) |
| `app/src/pages/journal-2-0/lib/offline/notebookFlags.js` | modify | `FLAG_FALLBACKS.notebook_ask_insert_on = false` (T3) |
| `app/src/pages/journal-2-0/lib/offline/notebookFlags.askInsert.test.js` | create | flag polarity (T3) |
| `tools/gen_pm_citation_fixtures.cjs` | modify | two new ground-truth cases (T4) |
| `tests/fixtures_pm_citation_text.json` | regenerate | ground truth from real prosemirror-model (T4) |
| `app/src/pages/journal-2-0/lib/askCitation.parity.test.js` | modify | schema copy gains the two nodes (T4) |
| `api/services/journal_two/note_citation_text.py` | modify | leaf entry, `in_ask_insert` span flag, `member_text`, `in_ask_insert()` (T4) |
| `api/services/journal_two/ask_retrieval.py` | modify | `_best_note_passage`, `_notes`, `_note_blocks` skip inserted answers (T4) |
| `tests/test_ask_insert_exclusion.py` | create | P3 + leaf rails (T4) |
| `api/services/journal_two/notes_export.py` | modify | `askInsert`/`askCitation` export (T5) |
| `api/services/journal_two/note_shares.py` | modify | reduce chip attrs to `{n}` (T5) |
| `api/services/journal_two/test_notes_export.py` | modify | export rail (T5) |
| `api/services/journal_two/test_note_shares.py` | modify | share rail (T5) |
| `app/src/pages/journal-2-0/lib/askInsert.js` | create | claim, `buildAskInsertNode`, pending carrier (T6), `appendAskInsert` (T7) |
| `app/src/pages/journal-2-0/lib/askInsert.test.js` | create | (T6) |
| `app/src/pages/journal-2-0/lib/askInsertNode.jsx` | create | `AskInsert` node (T7) |
| `app/src/pages/journal-2-0/lib/askCitationNode.jsx` | create | `AskCitation` node + stale plugin (T7) |
| `app/src/pages/journal-2-0/lib/askInsertNodes.test.js` | create | nodes, P1, P2, append (T7) |
| `app/src/pages/journal-2-0/components/notebook/AskInsertView.jsx` + `.module.css` + `.test.jsx` | create | block view (T7) |
| `app/src/pages/journal-2-0/components/notebook/AskCitationView.jsx` + `.module.css` + `.test.jsx` | create | chip view (T7) |
| `app/src/pages/journal-2-0/lib/tiptap.js` | modify | register both nodes (T7) |
| `app/src/pages/journal-2-0/components/notebook/NoteLinkMenu.jsx` | modify | export `makeNoteSearch`; `ariaLabel` prop on `NoteLinkList` (T8) |
| `app/src/pages/journal-2-0/components/notebook/NoteLinkMenu.search.test.js` | create | (T8) |
| `app/src/pages/journal-2-0/components/notebook/AskInsertPicker.jsx` + `.module.css` + `.test.jsx` | create | inline note picker (T8) |
| `app/src/pages/journal-2-0/components/notebook/AskPanel.jsx` + `AskPanel.module.css` | modify | Insert button, gating, picker (T9) |
| `app/src/pages/journal-2-0/components/notebook/AskPanel.insert.test.jsx` | create | (T9) |
| `app/src/pages/journal-2-0/hooks/usePendingAskInsert.js` + `.test.jsx` | create | consume-once hook (T10) |
| `app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx` | modify | `recoveryDecided`, `insertAskAnswer`, hook, props (T10) |
| `app/src/pages/journal-2-0/components/notebook/NoteEditorPage.askInsert.test.jsx` | create | real-editor wiring (T10) |
| `app/src/pages/journal-2-0/components/notebook/DocumentPreviewSheet.jsx` | modify | pass `onInsert`/`onOpenNote` (T10) |
| `app/src/pages/journal-2-0/components/notebook/ResearchHome.jsx` | modify | `onOpenNote={openNote}` (T10) |
| `docs/notebook/RESUME-HERE-2026-09-20.md`, `docs/notebook/competitive-gap-ledger.md` | modify | reconciliation (T11) |

---

### Task 0: Baseline the rails that are already red on master

**Why:** `components/screener/reachable.test.js` and `styles/tapFloor.test.js` fail on
master today, so the six-shard gate compares them by test NAME and cannot see a new
offender inside them (the audit's §2b caveat). Record their current output now so
Task 12 can diff the module and element names they list.

**Files:** none in the repo. The output goes to the session scratchpad.

- [ ] **Step 1: Record the baseline**

```bash
mkdir -p /c/Users/Patrick/AppData/Local/Temp/claude/C--Users-Patrick/e5af7430-5c97-49c2-9846-4da28941d38c/scratchpad/g064
cd /c/Users/Patrick/uct-worktrees/notebook-k/app
npx vitest run src/components/screener/reachable.test.js src/styles/tapFloor.test.js --maxWorkers=1 > /c/Users/Patrick/AppData/Local/Temp/claude/C--Users-Patrick/e5af7430-5c97-49c2-9846-4da28941d38c/scratchpad/g064/baseline-rails.txt 2>&1; code=$?; tail -8 /c/Users/Patrick/AppData/Local/Temp/claude/C--Users-Patrick/e5af7430-5c97-49c2-9846-4da28941d38c/scratchpad/g064/baseline-rails.txt; exit $code
```

Expected: the file has a `Tests` totals line. A non-zero exit is expected here; this
is the baseline, not a verdict. Write down `git rev-parse --short HEAD` beside it.

---

### Task 1: Callout and Toggle styling actually applies (same-wave fix, spec §10.2)

**Files:**
- Create: `app/src/pages/journal-2-0/components/notebook/editorRawClasses.test.js`
- Modify: `app/src/pages/journal-2-0/components/notebook/NoteEditorPage.module.css:363-426`

**Interfaces:** none (a CSS fix and a rail).

- [ ] **Step 1: Write the failing rail**

Create `app/src/pages/journal-2-0/components/notebook/editorRawClasses.test.js`:

```js
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ⛔ A CSS MODULE HASHES EVERY BARE CLASS SELECTOR. Editor nodes write RAW class
// names into the DOM (a DOMOutputSpec's `class:` or a DOM node view's
// `.className =`), so a bare `.uctCalloutIcon` in NoteEditorPage.module.css
// compiles to `._uctCalloutIcon_<hash>` and matches nothing. Measured 2026-09-22
// in the built stylesheet: `._uctToggleChevron_1xnnk_773` and
// `._uctCalloutIcon_1xnnk_725`, while calloutNode.js:71 / toggleNode.js:109 wrote
// the raw names. Callout bodies lost their flex sizing and the Toggle chevron lost
// its 44px touch floor. The names are DERIVED from the node sources, never typed,
// so the next raw class is covered the day it lands.

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LIB = path.resolve(HERE, '../../lib')
const CSS = fs.readFileSync(path.resolve(HERE, 'NoteEditorPage.module.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

const RAW_CLASS_RE = /(?:\bclass\s*:\s*|\.className\s*=\s*)['"]([^'"]+)['"]/g

function rawEditorClasses() {
  const out = new Set()
  for (const f of fs.readdirSync(LIB)) {
    if (!/\.(js|jsx)$/.test(f) || /\.test\./.test(f)) continue
    const src = fs.readFileSync(path.join(LIB, f), 'utf8')
    for (const m of src.matchAll(RAW_CLASS_RE)) {
      for (const tok of m[1].split(/\s+/)) if (tok) out.add(tok)
    }
  }
  return out
}

function bareUses(css, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let bare = 0
  for (const m of css.matchAll(new RegExp(`(:global\\(\\s*)?\\.${esc}(?![\\w-])`, 'g'))) {
    if (!m[1]) bare += 1
  }
  return bare
}

describe('raw editor class names are styled through :global()', () => {
  it('reads real node sources (non-vacuity)', () => {
    const names = rawEditorClasses()
    expect(names).toContain('uctCalloutIcon')
    expect(names).toContain('uctToggleChevron')
  })

  it('the checker can see a bare use (control)', () => {
    expect(bareUses('.a .uctX { color: red }', 'uctX')).toBe(1)
    expect(bareUses('.a :global(.uctX) { color: red }', 'uctX')).toBe(0)
    expect(bareUses('.a .uctXY { color: red }', 'uctX')).toBe(0)
  })

  it('no raw editor class appears bare in NoteEditorPage.module.css', () => {
    const offenders = [...rawEditorClasses()].filter((n) => bareUses(CSS, n) > 0).sort()
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k/app
npx vitest run src/pages/journal-2-0/components/notebook/editorRawClasses.test.js --maxWorkers=2 > /tmp/g064.log 2>&1; code=$?; tail -25 /tmp/g064.log; exit $code
```

Expected: FAIL in the third test, with
`offenders` equal to `['uctCalloutBody', 'uctCalloutIcon', 'uctToggleChevron', 'uctToggleDetails']`
(checked at planning time: every other raw class the lib writes is either
unstyled here or already `:global()`). The first two tests PASS.

- [ ] **Step 3: Wrap the four class names in `:global()`**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k
sed -i -E 's/([^(])\.(uctCalloutIcon|uctCalloutBody|uctToggleChevron|uctToggleDetails)([^A-Za-z0-9_-])/\1:global(.\2)\3/g' app/src/pages/journal-2-0/components/notebook/NoteEditorPage.module.css
git diff --stat app/src/pages/journal-2-0/components/notebook/NoteEditorPage.module.css
git diff app/src/pages/journal-2-0/components/notebook/NoteEditorPage.module.css | grep '^[-+]' | grep -v '^[-+][-+]'
```

Expected: only selector lines change, each bare `.uctX` becoming `:global(.uctX)`.
For example, `.proseEditor [data-type="callout"] .uctCalloutIcon {` becomes
`.proseEditor [data-type="callout"] :global(.uctCalloutIcon) {`, and
`.proseEditor .uctToggleChevron:hover` becomes
`.proseEditor :global(.uctToggleChevron):hover`. If any comment line changed,
revert that hunk by hand with the Edit tool. Also re-run this until no bare
occurrence remains: `sed` does not match two occurrences that share a separator
character on one line.

```bash
grep -nE '[^(]\.(uctCalloutIcon|uctCalloutBody|uctToggleChevron|uctToggleDetails)[^A-Za-z0-9_-]' app/src/pages/journal-2-0/components/notebook/NoteEditorPage.module.css
```

Expected: no output.

- [ ] **Step 4: Run the rail and the node tests**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k/app
npx vitest run src/pages/journal-2-0/components/notebook/editorRawClasses.test.js src/pages/journal-2-0/lib/calloutNode.test.js --maxWorkers=2 > /tmp/g064.log 2>&1; code=$?; tail -12 /tmp/g064.log; exit $code
```

Expected: PASS, exit 0. If the rail still names an offender outside the four, that
class has the same defect. Wrap it the same way and name it in the commit message.

- [ ] **Step 5: Mutation proof (restore by writing bytes back, never `git checkout`)**

Copy the fixed CSS to the scratchpad. Undo ONE wrap by hand
(`:global(.uctToggleChevron):hover` → `.uctToggleChevron:hover`) and re-run Step 4.
Expected: FAIL naming `uctToggleChevron`. Copy the saved bytes back and re-run
Step 4. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k
git add app/src/pages/journal-2-0/components/notebook/NoteEditorPage.module.css app/src/pages/journal-2-0/components/notebook/editorRawClasses.test.js
python tools/check_repo_hygiene.py --staged
git commit -F - <<'MSG'
fix(notebook): Callout/Toggle styles never applied -- raw classes hashed away

NoteEditorPage.module.css styled .uctCalloutIcon/.uctCalloutBody/
.uctToggleChevron/.uctToggleDetails as bare selectors. A CSS module hashes
them (built CSS: ._uctToggleChevron_1xnnk_773) while calloutNode.js and
toggleNode.js write the raw names, so the rules matched nothing: callout
bodies lost their flex sizing and the toggle chevron rendered as a default
button with no 44px touch floor. Wrapped in :global(), plus a rail that
derives every raw class name from the node sources and fails on a bare use.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HiiyhLP3J7WbX1wf3XLeQ6
MSG
```

---

### Task 2: Research-workspace citations open the cited note (same-wave fix, spec §10.1)

**Files:**
- Modify: `app/src/pages/journal-2-0/components/notebook/TickerResearchWorkspace.jsx:145-146`
- Test: `app/src/pages/journal-2-0/components/notebook/TickerResearchWorkspace.test.jsx` (append)

**Interfaces:** Consumes `AskPanel`'s existing `onNavigate(source, resolved)` prop
(`AskPanel.jsx:58, 182`).

- [ ] **Step 1: Append the failing test**

At the top of `TickerResearchWorkspace.test.jsx`, change the testing-library import
to include `within`:

```js
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
```

Append at the end of the file:

```jsx
describe('TickerResearchWorkspace — Ask citations', () => {
  function sseBody(events) {
    const enc = new TextEncoder()
    return new ReadableStream({
      start(c) {
        for (const ev of events) c.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`))
        c.close()
      },
    })
  }
  const SOURCE = {
    n: 1, type: 'note', label: 'NVDA thesis', citation: 'exact', snippet: 'margins',
    navigation: { kind: 'note', note_id: 'n1' }, location: {}, payload: {},
    stance: null, truncated: false,
  }

  it('clicking a citation opens the cited note (it used to be a dead click)', async () => {
    const onOpenNote = vi.fn()
    renderWorkspace({ onOpenNote })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({}),
      body: sseBody([
        { type: 'sources', scope: 'security', scopeLabel: 'NVDA research', sources: [SOURCE], coverageNotice: null },
        { type: 'final', answer: 'Margins fell [1].' },
      ]),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask a question about this research' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'margins?' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ask' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Source 1: NVDA thesis' }))
    expect(onOpenNote).toHaveBeenCalledWith({ id: 'n1' })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k/app
npx vitest run src/pages/journal-2-0/components/notebook/TickerResearchWorkspace.test.jsx --maxWorkers=2 > /tmp/g064.log 2>&1; code=$?; tail -25 /tmp/g064.log; exit $code
```

Expected: FAIL. `onOpenNote` is never called, because AskPanel has no `onNavigate`
here. If the Ask toggle is not found, the empty summary hides the header. In that
case, set `hookResult.summary` to a copy of `EMPTY_SUMMARY` with
`notes: [{ id: 'n1', title: 'NVDA thesis' }]` inside this test, and re-run.

- [ ] **Step 3: Fix the wiring**

In `TickerResearchWorkspace.jsx`, replace:

```jsx
          <AskPanel scope="security" target={identity.symbol}
                    onOpenNote={onOpenNote} />
```

with:

```jsx
          {/* ⛔ `onOpenNote` was never an AskPanel prop, so every citation in
              "This research" was a dead click. Citations navigate through
              `onNavigate`, into this workspace's own `openNote` (which falls
              back to the router when no host handler was passed). */}
          <AskPanel scope="security" target={identity.symbol}
                    onNavigate={(s) => {
                      const id = s?.navigation?.note_id
                      if (id) openNote({ id })
                    }} />
```

- [ ] **Step 4: Run the file again**

Same command as Step 2. Expected: PASS, exit 0, with every pre-existing test in the
file still passing.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k
git add app/src/pages/journal-2-0/components/notebook/TickerResearchWorkspace.jsx app/src/pages/journal-2-0/components/notebook/TickerResearchWorkspace.test.jsx
python tools/check_repo_hygiene.py --staged
git commit -F - <<'MSG'
fix(notebook): research-workspace Ask citations were dead clicks

TickerResearchWorkspace passed onOpenNote to AskPanel, which is not an
AskPanel prop, so onNavigate was null and every citation in "This
research" did nothing. Citations now route through onNavigate into the
workspace's own openNote.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HiiyhLP3J7WbX1wf3XLeQ6
MSG
```

---

### Task 3: The `NOTEBOOK_ASK_INSERT_ON` enablement gate (spec §7.6)

**Files:**
- Modify: `api/routers/auth.py:132-137`
- Modify: `tests/test_notebook_flags.py:20-25`
- Modify: `docs/feature_flags.json` (after the `NOTEBOOK_ATTACHMENTS_ON` entry, ~:848-852)
- Modify: `app/src/pages/journal-2-0/lib/offline/notebookFlags.js:37-43`
- Create: `app/src/pages/journal-2-0/lib/offline/notebookFlags.askInsert.test.js`

**Interfaces:**
- Produces: server payload key `notebook_ask_insert_on` (bool, default `false`).
- Produces: client `notebookFlag('notebook_ask_insert_on')` returns
  `true | false | null`. Later tasks treat anything but `true` as OFF.

- [ ] **Step 1: Server roster test first**

In `tests/test_notebook_flags.py`, change `NOTEBOOK_KEYS` to:

```python
NOTEBOOK_KEYS = [
    "notebook_offline_default_on",
    "notebook_offline_read_on",
    "notebook_conflict_ux_on",
    "notebook_attachments_on",
    "notebook_ask_insert_on",
]
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k
python -m pytest tests/test_notebook_flags.py -q > /tmp/g064.log 2>&1; code=$?; tail -15 /tmp/g064.log; exit $code
```

Expected: FAIL. `notebook_ask_insert_on is a capability with no key` and the roster
assertion both fail.

- [ ] **Step 3: Add the flag**

In `api/routers/auth.py`, replace the `NOTEBOOK_FLAGS` dict with:

```python
NOTEBOOK_FLAGS = {
    "NOTEBOOK_OFFLINE_DEFAULT_ON": True,    # kill switch  — unset means ON
    "NOTEBOOK_OFFLINE_READ_ON": False,      # enablement   — unset means OFF
    "NOTEBOOK_CONFLICT_UX_ON": False,       # enablement   — unset means OFF
    "NOTEBOOK_ATTACHMENTS_ON": False,       # enablement   — unset means OFF
    "NOTEBOOK_ASK_INSERT_ON": False,        # enablement   — unset means OFF (G-064)
}
```

- [ ] **Step 4: Declare it in the ledger (edit as TEXT, never load/dump the JSON)**

Open `docs/feature_flags.json` and find the `"NOTEBOOK_ATTACHMENTS_ON": {` block.
Immediately after its closing `},`, insert the block below, copying the exact
indentation of the `NOTEBOOK_ATTACHMENTS_ON` block:

```json
"NOTEBOOK_ASK_INSERT_ON": {
  "status": "dark",
  "where": [],
  "note": "G-064, 2026-09-22. Enablement gate for inserting an Ask Notebook answer into a note (spec docs/superpowers/specs/2026-09-22-ask-notebook-insert-design.md). Unset means OFF and that is the decision: the Insert button is hidden. The askInsert/askCitation node types are registered regardless, so a note that already holds an inserted answer keeps rendering after a rollback. Rides the auth payload (_access_payload)."
},
```

Then check that the file still parses:

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k
python -c "import json; d=json.load(open('docs/feature_flags.json', encoding='utf-8')); print('ok')"
```

- [ ] **Step 5: Run the server flag rails**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k
python -m pytest tests/test_notebook_flags.py tests/test_feature_flag_ledger.py tests/test_notebook_flag_table_form.py tests/test_hub_preview_flag.py tests/test_k_reach_statement.py tests/test_notebook_door_guard_flag.py -q > /tmp/g064.log 2>&1; code=$?; tail -15 /tmp/g064.log; exit $code
```

Expected: PASS, exit 0. If `test_feature_flag_ledger.py` names
`NOTEBOOK_ASK_INSERT_ON`, the Step 4 entry is missing or malformed.

- [ ] **Step 6: Client test first**

Create `app/src/pages/journal-2-0/lib/offline/notebookFlags.askInsert.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest'
import { FLAG_FALLBACKS, __resetNotebookFlags, latchNotebookFlags, notebookFlag } from './notebookFlags'

// G-064 — an ENABLEMENT gate: absent means OFF, and a tab that never latched
// reports `null`, which every consumer treats as OFF.
beforeEach(() => __resetNotebookFlags())

describe('notebook_ask_insert_on', () => {
  it('falls back to false', () => {
    expect(FLAG_FALLBACKS.notebook_ask_insert_on).toBe(false)
  })

  it('is false when the payload predates it', () => {
    latchNotebookFlags({ notebook_offline_default_on: true })
    expect(notebookFlag('notebook_ask_insert_on')).toBe(false)
  })

  it('latches true when the server says so', () => {
    latchNotebookFlags({ notebook_ask_insert_on: true })
    expect(notebookFlag('notebook_ask_insert_on')).toBe(true)
  })

  it('is null before anything latched', () => {
    expect(notebookFlag('notebook_ask_insert_on')).toBeNull()
  })
})
```

- [ ] **Step 7: Run and watch it fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k/app
npx vitest run src/pages/journal-2-0/lib/offline/notebookFlags.askInsert.test.js --maxWorkers=2 > /tmp/g064.log 2>&1; code=$?; tail -15 /tmp/g064.log; exit $code
```

Expected: FAIL on the first three tests. `FLAG_FALLBACKS.notebook_ask_insert_on` is
`undefined`, and the latch never reads the key.

- [ ] **Step 8: Add the fallback**

In `notebookFlags.js`, add one line to `FLAG_FALLBACKS`:

```js
export const FLAG_FALLBACKS = Object.freeze({
  notebook_offline_default_on: null,   // ⇒ defer to OFFLINE_DEFAULT_ON, §6
  notebook_offline_read_on: false,
  notebook_conflict_ux_on: false,
  notebook_attachments_on: false,
  notebook_ask_insert_on: false,       // G-064 enablement gate — absent ⇒ OFF
  notebook_door_guard: 'full',         // ⛔ a MODE, not a boolean — see below
})
```

- [ ] **Step 9: Run the client flag rails**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k/app
npx vitest run src/pages/journal-2-0/lib/offline/notebookFlags.askInsert.test.js src/pages/journal-2-0/lib/offline/notebookFlags.test.jsx src/context/authFlagPaths.test.js --maxWorkers=2 > /tmp/g064.log 2>&1; code=$?; tail -15 /tmp/g064.log; exit $code
```

Expected: PASS, exit 0.

- [ ] **Step 10: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k
git add api/routers/auth.py tests/test_notebook_flags.py docs/feature_flags.json app/src/pages/journal-2-0/lib/offline/notebookFlags.js app/src/pages/journal-2-0/lib/offline/notebookFlags.askInsert.test.js
python tools/check_repo_hygiene.py --staged
git commit -F - <<'MSG'
feat(notebook): NOTEBOOK_ASK_INSERT_ON enablement gate (G-064, dark)

Fifth Wave K capability key on the auth payload, read per request.
Unset means OFF. Declared dark in docs/feature_flags.json; the client
fallback is false and a never-latched tab reads null (treated as OFF).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HiiyhLP3J7WbX1wf3XLeQ6
MSG
```

---

### Task 4: `askCitation` is a leaf, and Ask never cites an inserted answer (spec §7.1–7.2, P3)

**Files:**
- Modify: `tools/gen_pm_citation_fixtures.cjs`
- Regenerate: `tests/fixtures_pm_citation_text.json`
- Modify: `app/src/pages/journal-2-0/lib/askCitation.parity.test.js` (schema copy)
- Modify: `api/services/journal_two/note_citation_text.py`
- Modify: `api/services/journal_two/ask_retrieval.py:209-245, 1120-1152`
- Create: `tests/test_ask_insert_exclusion.py`

**Interfaces:**
- Produces:
  - `note_citation_text.ASK_INSERT_TYPE = "askInsert"`
  - every span from `flatten()` gains `"in_ask_insert": bool`
  - `member_text(flat, start=0, end=None) -> str`
  - `in_ask_insert(flat, flat_start, flat_end) -> bool`
- Changes: `ask_retrieval._best_note_passage(doc, expr)` returns
  `(None, None, None)` when the body's only text is inside inserted answers.

- [ ] **Step 1: Extend the ground-truth generator**

In `tools/gen_pm_citation_fixtures.cjs`, add two node specs to the schema's `nodes`,
after `documentExcerpt`:

```js
    askInsert: {group:'block', content:'block+', toDOM:()=>['div',0]},
    askCitation: {group:'inline', inline:true, atom:true, attrs:{n:{default:null}}, toDOM:()=>['span']},
```

Then add two entries to `CASES`, after `duplicatePhrase`:

```js
  askCitationChip: {type:'doc',content:[{type:'paragraph',content:[
    {type:'text',text:'Margins fell '},
    {type:'askCitation',attrs:{n:1}},
    {type:'text',text:' in Q3.'}]}]},
  askInsertBlock: {type:'doc',content:[
    {type:'paragraph',content:[{type:'text',text:'My own view.'}]},
    {type:'askInsert',content:[
      {type:'paragraph',content:[
        {type:'text',text:'Inserted answer '},
        {type:'askCitation',attrs:{n:1}},
        {type:'text',text:' here.'}]}]},
    {type:'paragraph',content:[{type:'text',text:'After.'}]}]},
```

- [ ] **Step 2: Regenerate the fixtures from the real library**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k/app
NODE_PATH="$PWD/node_modules" node ../tools/gen_pm_citation_fixtures.cjs > ../tests/fixtures_pm_citation_text.json
python -c "import json; d=json.load(open('../tests/fixtures_pm_citation_text.json', encoding='utf-8')); print(sorted(d)); print(repr(d['askCitationChip']['text'])); print(repr(d['askInsertBlock']['text']))"
```

Expected: 11 case names. `askCitationChip` text is `'Margins fell  in Q3.'` (two
spaces: the atom contributes nothing). `askInsertBlock` text is
`'My own view.\nInserted answer  here.\nAfter.'`.

- [ ] **Step 3: Update the client parity test's schema copy**

In `app/src/pages/journal-2-0/lib/askCitation.parity.test.js`, add the same two
node specs to its `schema` `nodes`, after `documentExcerpt`. The comment above the
schema says it must equal the generator's.

```js
    askInsert: { group: 'block', content: 'block+', toDOM: () => ['div', 0] },
    askCitation: { group: 'inline', inline: true, atom: true, attrs: { n: { default: null } }, toDOM: () => ['span'] },
```

- [ ] **Step 4: Write the failing Python rails**

Create `tests/test_ask_insert_exclusion.py`:

```python
"""G-064 — an `askCitation` chip is a one-position leaf (spec §7.1), and Ask
Notebook never cites an inserted answer back as the member's own writing
(spec §7.2, promise P3).
"""
from __future__ import annotations

import sqlite3

import pytest

from api.services.journal_two import ask_retrieval as ar
from api.services.journal_two import note_citation_text as nct
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.db import ensure_schema


def _t(text):
    return {"type": "text", "text": text}


def _p(*inline):
    return {"type": "paragraph", "content": list(inline)}


def _chip(n=1):
    return {"type": "askCitation", "attrs": {"n": n, "label": "src", "claim": ""}}


def _insert(*paras):
    return {"type": "askInsert",
            "attrs": {"insertedAt": "2026-09-22T12:00:00Z", "scope": "notebook", "question": "q"},
            "content": list(paras)}


MIXED = {"type": "doc", "content": [
    _p(_t("My own view: margins are fine.")),
    _insert(_p(_t("Inserted answer says margins compressed "), _chip(1), _t("."))),
    _p(_t("After.")),
]}
ONLY_INSERTED = {"type": "doc", "content": [
    _insert(_p(_t("Inserted answer says margins compressed "), _chip(1), _t("."))),
]}


class TestTheChipIsALeaf:
    def test_a_chip_takes_one_position_and_no_text(self):
        doc = {"type": "doc", "content": [_p(_t("ab"), _chip(), _t("cd"))]}
        flat = nct.flatten(doc)
        assert flat["text"] == "abcd"
        spans = [(s["pm_start"], s["pm_end"]) for s in flat["spans"] if not s["is_atom"]]
        # "ab" 1..3, chip at 3, "cd" 4..6 — ProseMirror's own numbering.
        assert spans == [(1, 3), (4, 6)]
        assert flat["content_size"] == 7


class TestFlattenMarksInsertedRuns:
    def test_runs_inside_an_insert_are_flagged_and_others_are_not(self):
        flat = nct.flatten(MIXED)
        flagged = {flat["text"][s["flat_start"]:s["flat_end"]]
                   for s in flat["spans"] if s["in_ask_insert"]}
        plain = {flat["text"][s["flat_start"]:s["flat_end"]]
                 for s in flat["spans"] if not s["in_ask_insert"]}
        assert "Inserted answer says margins compressed " in flagged
        assert {"My own view: margins are fine.", "After."} <= plain

    def test_the_canonical_text_is_unchanged(self):
        # ⛔ flatten is pinned to ProseMirror's textBetween; the flag is metadata,
        # never a change to the text.
        assert nct.flatten(MIXED)["text"] == (
            "My own view: margins are fine.\nInserted answer says margins compressed .\nAfter.")

    def test_member_text_cuts_inserted_runs_out(self):
        own = nct.member_text(nct.flatten(MIXED))
        assert "Inserted answer" not in own
        assert "My own view: margins are fine." in own and "After." in own

    def test_in_ask_insert_answers_for_a_range(self):
        flat = nct.flatten(MIXED)
        i = flat["text"].index("Inserted")
        j = flat["text"].index("My own")
        assert nct.in_ask_insert(flat, i, i + 8) is True
        assert nct.in_ask_insert(flat, j, j + 6) is False


class TestNoteScope:
    def test_inserted_blocks_are_never_evidence(self):
        texts = [b["text"] for b in ar._note_blocks(MIXED, "margins")]
        assert "My own view: margins are fine." in texts
        assert not any("Inserted answer" in t for t in texts)

    def test_a_note_that_is_only_an_inserted_answer_yields_no_blocks(self):
        assert ar._note_blocks(ONLY_INSERTED, "margins") == []


class TestNotebookScopePassage:
    def test_the_passage_is_the_members_own_text(self):
        snippet, location, _validity = ar._best_note_passage(MIXED, "margins")
        assert "My own view" in snippet
        assert "Inserted answer" not in snippet
        assert location is not None

    def test_a_match_only_inside_an_insert_is_not_cited_exactly(self):
        doc = {"type": "doc", "content": [
            _p(_t("Unrelated member text.")),
            _insert(_p(_t("compressed margins here")))]}
        snippet, location, _validity = ar._best_note_passage(doc, "compressed")
        assert location is None
        assert "compressed" not in snippet

    def test_a_body_that_is_only_inserted_answers_is_not_a_candidate(self):
        assert ar._best_note_passage(ONLY_INSERTED, "margins") == (None, None, None)

    def test_an_empty_body_keeps_its_old_behaviour(self):
        assert ar._best_note_passage({"type": "doc", "content": []}, "margins")[0] == ""


@pytest.fixture()
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    yield c
    c.close()


class TestTheCandidateLoop:
    def test_a_note_holding_only_an_inserted_answer_is_never_evidence(self, conn):
        mine = notes_svc.create_note("u1", {
            "title": "Mine",
            "bodyJson": {"type": "doc", "content": [_p(_t("margins compressed in my view"))]},
        }, conn=conn)
        pasted = notes_svc.create_note("u1", {"title": "Pasted", "bodyJson": ONLY_INSERTED}, conn=conn)
        ids = {e["source_id"] for e in ar._notes(conn, "u1", "margins", 10)}
        assert mine["id"] in ids
        assert pasted["id"] not in ids
```

- [ ] **Step 5: Run both parity suites and the new rails; watch them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k
python -m pytest tests/test_note_citation_text.py tests/test_ask_insert_exclusion.py -q > /tmp/g064.log 2>&1; code=$?; tail -25 /tmp/g064.log; exit $code
```

Expected: FAIL.
- The parity cases `askCitationChip` and `askInsertBlock` fail on text and positions,
  because the chip is treated as a container.
- `test_ask_insert_exclusion.py` fails with `KeyError: 'in_ask_insert'` or
  `AttributeError: member_text`.

- [ ] **Step 6: Implement in `note_citation_text.py`**

1. Add `"askCitation"` to `_LEAF_TYPES`:

```python
_LEAF_TYPES = frozenset({
    "attachmentChip", "documentExcerpt", "widgetEmbed", "videoTimestamp",
    "horizontalRule", "image", "hardBreak", "financialFact", "noteLink",
    # G-064: an Ask citation chip is an inline atom with no leafText, exactly
    # like noteLink -- one position, no text. Missing here, it was walked as a
    # container: two positions plus a block separator, shifting every later
    # citation position in the note (spec §7.1).
    "askCitation",
})

# G-064 (spec §7.2): a container whose text is an inserted Ask Notebook answer.
# Its runs are FLAGGED, never removed -- the text must stay ProseMirror's own.
ASK_INSERT_TYPE = "askInsert"
```

2. In `flatten`, track depth and flag spans. Replace the `state = {...}` line with:

```python
    state = {"flat": 0, "pending_sep": False, "ask_depth": 0}
```

In `emit`, add the flag to the appended span dict:

```python
        spans.append({
            "flat_start": start, "flat_end": state["flat"],
            "pm_start": pm_start, "pm_end": pm_end, "is_atom": is_atom,
            "in_ask_insert": state["ask_depth"] > 0,
        })
```

In `walk`, replace the container branch's child loop with:

```python
        # Container: 1 for the open token, content, 1 for the close token.
        inner = pos + 1
        children = node.get("content") or []
        is_ask = ntype == ASK_INSERT_TYPE
        if is_ask:
            state["ask_depth"] += 1
        if isinstance(children, list):
            for child in children:
                inner = walk(child, inner)
        if is_ask:
            state["ask_depth"] -= 1
        after = inner + 1
```

The two lines after it (`if _is_block(ntype): …` and `return after`) stay unchanged.

3. Add the two helpers directly after `_is_block`:

```python
def member_text(flat: dict[str, Any], start: int = 0, end: int | None = None) -> str:
    """The canonical text in [start, end) with every run that sits inside an
    inserted Ask Notebook answer cut out (G-064, spec §7.2).

    For SNIPPETS only: the result is not position-bearing. Locations still come
    from `pm_range` over the untouched canonical text.
    """
    text = flat.get("text") or ""
    end = len(text) if end is None else end
    out: list[str] = []
    cur = start
    for s in flat.get("spans") or []:
        if not s.get("in_ask_insert"):
            continue
        a, b = max(s["flat_start"], start), min(s["flat_end"], end)
        if a >= b:
            continue
        if a > cur:
            out.append(text[cur:a])
        cur = max(cur, b)
    if cur < end:
        out.append(text[cur:end])
    return "".join(out)


def in_ask_insert(flat: dict[str, Any], flat_start: int, flat_end: int) -> bool:
    """True when any run overlapping [flat_start, flat_end) sits inside an
    inserted Ask Notebook answer (G-064, spec §7.2)."""
    for s in flat.get("spans") or []:
        if s.get("in_ask_insert") and s["flat_start"] < flat_end and flat_start < s["flat_end"]:
            return True
    return False
```

- [ ] **Step 7: Implement in `ask_retrieval.py`**

1. In `_notes`, change the loop body to skip a note whose body holds only inserted
   answers:

```python
    for r in conn.execute(sql, params).fetchall():
        row = dict(r)
        doc = _json(row.get("body_json"))
        snippet, location, validity = _best_note_passage(doc, expr)
        if snippet is None:
            # G-064 (spec §7.2): the body is only inserted Ask answers.
            # Presenting it would hand the model its own earlier output as
            # "notes they wrote".
            continue
        out.append(ev.from_note(row, snippet=snippet, location=location,
                                citation_validity=validity, score=-row["score"]))
    return out
```

2. Replace `_best_note_passage` with:

```python
def _best_note_passage(doc, expr: str):
    """Pick a passage to cite and give it a real ProseMirror location.

    Falls back honestly: if no query term can be located in the canonical
    text, the citation opens the note WITHOUT claiming a passage (§21) rather
    than pointing at a guess.

    ⛔ G-064 (spec §7.2): text inside an inserted Ask Notebook answer is never a
    passage and never part of a snippet. A body whose ONLY text is inserted
    answers returns (None, None, None) and the caller drops the note.
    """
    flat = nct.flatten(doc)
    text = flat["text"]
    if not text:
        return "", None, ev.CITE_NOTE_ONLY
    own = nct.member_text(flat)
    if not own.strip():
        return None, None, None
    low = text.lower()
    terms = [t for t in _terms(expr) if len(t) > 2]
    for term in terms:
        needle = term.lower()
        idx = low.find(needle)
        while idx >= 0 and nct.in_ask_insert(flat, idx, idx + len(term)):
            idx = low.find(needle, idx + 1)
        if idx < 0:
            continue
        start = max(0, idx - 90)
        end = min(len(text), idx + len(term) + 150)
        snippet = nct.member_text(flat, start, end).strip()
        rng = nct.pm_range(idx, idx + len(term), flat["spans"])
        if rng:
            return snippet, {**rng, "fingerprint": nct.fingerprint(doc),
                             "snippet_start": idx, "snippet_end": idx + len(term)}, ev.CITE_EXACT
    return own[:200].strip(), None, ev.CITE_NOTE_ONLY
```

3. In `_note_blocks`, skip blocks inside an inserted answer. Directly after
   `rng = nct.pm_range(start, end, flat["spans"])` and its `if rng is None: continue`,
   add:

```python
        if nct.in_ask_insert(flat, start, end):
            # G-064 (spec §7.2): an inserted Ask answer is not the member's
            # writing, so it is never evidence in "This note" either.
            continue
```

- [ ] **Step 8: Run the backend rails**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k
python -m pytest tests/test_note_citation_text.py tests/test_ask_insert_exclusion.py tests/test_ask_note_scope.py tests/test_ask_retrieval.py -q > /tmp/g064.log 2>&1; code=$?; tail -15 /tmp/g064.log; exit $code
```

Expected: PASS, exit 0.

- [ ] **Step 9: Run the client parity test**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k/app
npx vitest run src/pages/journal-2-0/lib/askCitation.parity.test.js --maxWorkers=2 > /tmp/g064.log 2>&1; code=$?; tail -12 /tmp/g064.log; exit $code
```

Expected: PASS, including the new `askCitationChip` and `askInsertBlock` cases.

- [ ] **Step 10: Mutation proofs (save bytes, edit, re-run, restore bytes)**

1. Remove `"askCitation",` from `_LEAF_TYPES`. Expected: the Step 8 run FAILS on
   `TestTheChipIsALeaf` and the two parity cases.
2. Change `_note_blocks`'s new `continue` to `pass`. Expected: the Step 8 run FAILS
   on `test_inserted_blocks_are_never_evidence`.

Restore both from the saved bytes, then re-run Step 8. Expected: PASS.

- [ ] **Step 11: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k
git add tools/gen_pm_citation_fixtures.cjs tests/fixtures_pm_citation_text.json app/src/pages/journal-2-0/lib/askCitation.parity.test.js api/services/journal_two/note_citation_text.py api/services/journal_two/ask_retrieval.py tests/test_ask_insert_exclusion.py
python tools/check_repo_hygiene.py --staged
git commit -F - <<'MSG'
feat(notebook): Ask never cites an inserted answer; askCitation is a leaf

G-064 spec §7.1-7.2. askCitation joins _LEAF_TYPES (one position, no
text, like noteLink) -- missing, it would shift every later server
citation position. flatten flags runs inside askInsert (text unchanged,
pinned to textBetween); _note_blocks and _best_note_passage skip them,
snippets are cut to the member's own text, and a note whose body is only
inserted answers is dropped from the candidates. Two new ground-truth
cases generated by real prosemirror-model.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HiiyhLP3J7WbX1wf3XLeQ6
MSG
```

---

### Task 5: Export keeps provenance; share never leaks a citation (spec §7.4–7.5, P5)

**Files:**
- Modify: `api/services/journal_two/notes_export.py` (new helper above `_block`, two branches inside `_block`)
- Modify: `api/services/journal_two/note_shares.py` (`resolve_share`)
- Test: `api/services/journal_two/test_notes_export.py` (append)
- Test: `api/services/journal_two/test_note_shares.py` (append)

**Interfaces:**
- Produces: `note_shares._reduce_ask_citations(body: dict) -> dict`, which mutates
  in place and returns the body.

- [ ] **Step 1: Failing export test**

Append to `api/services/journal_two/test_notes_export.py`. If `tiptap_to_markdown`
is not already imported at the top, add
`from api.services.journal_two.notes_export import tiptap_to_markdown`.

```python
def _g064_doc(question="What about margins?", inserted_at="2026-09-22T14:03:00.000Z"):
    return {"type": "doc", "content": [
        {"type": "askInsert",
         "attrs": {"insertedAt": inserted_at, "scope": "note", "question": question},
         "content": [
             {"type": "paragraph", "content": [
                 {"type": "text", "text": "Margins fell "},
                 {"type": "askCitation", "attrs": {"n": 1, "label": "NVDA thesis"}},
                 {"type": "text", "text": " in Q3."}]},
             {"type": "paragraph", "content": [
                 {"type": "text", "text": "Guidance held "},
                 {"type": "askCitation", "attrs": {"n": 2, "label": "Call notes"}},
                 {"type": "askCitation", "attrs": {"n": 1, "label": "NVDA thesis"}},
                 {"type": "text", "text": "."}]}]}]}


def test_g064_an_inserted_answer_exports_as_a_labelled_quote():
    assert tiptap_to_markdown(_g064_doc()) == (
        "> **From Ask Notebook** · 2026-09-22 · Q: What about margins?\n"
        ">\n"
        "> Margins fell [1] in Q3.\n"
        ">\n"
        "> Guidance held [2][1].\n"
        ">\n"
        "> Sources as of insertion: [1] NVDA thesis · [2] Call notes"
    )


def test_g064_missing_date_and_question_still_label_the_block():
    out = tiptap_to_markdown(_g064_doc(question="", inserted_at=None))
    assert out.startswith("> **From Ask Notebook**\n>\n> Margins fell [1] in Q3.")


def test_g064_a_chip_outside_a_block_exports_as_its_number():
    doc = {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": "See "},
        {"type": "askCitation", "attrs": {"n": 3, "label": "x"}}]}]}
    assert tiptap_to_markdown(doc) == "See [3]"
```

- [ ] **Step 2: Failing share test**

Append to `api/services/journal_two/test_note_shares.py`. Add `import json` at the
top if it is not already imported.

```python
def test_g064_a_shared_note_never_leaks_citation_labels_or_links(conn):
    n = notes_svc.create_note("u1", {"title": "Shared with answer"}, conn=conn)
    body = {"type": "doc", "content": [{
        "type": "askInsert",
        "attrs": {"insertedAt": "2026-09-22T12:00:00Z", "scope": "notebook", "question": "my question"},
        "content": [{"type": "paragraph", "content": [
            {"type": "text", "text": "Answer "},
            {"type": "askCitation", "attrs": {
                "n": 1, "label": "Private other note",
                "nav": {"kind": "note", "note_id": "secret-note"},
                "citation": "exact", "claim": "Answer"}}]}]}]}
    notes_svc.update_note("u1", n["id"], {"bodyJson": body}, conn=conn)
    share = note_shares.create_share("u1", n["id"], conn=conn)
    pub = note_shares.resolve_share(share["token"], conn=conn)
    chip = pub["bodyJson"]["content"][0]["content"][0]["content"][1]
    assert chip == {"type": "askCitation", "attrs": {"n": 1}}
    dumped = json.dumps(pub)
    assert "Private other note" not in dumped
    assert "secret-note" not in dumped
    # The member's own question, inside the note they chose to share, stays.
    assert pub["bodyJson"]["content"][0]["attrs"]["question"] == "my question"
```

- [ ] **Step 3: Run and watch both fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k
python -m pytest api/services/journal_two/test_notes_export.py api/services/journal_two/test_note_shares.py -q > /tmp/g064.log 2>&1; code=$?; tail -20 /tmp/g064.log; exit $code
```

Expected: FAIL on the four `g064` tests.
- Export: the wrapper is dropped and chips export as `""`.
- Share: the label is present.

- [ ] **Step 4: Implement export**

In `notes_export.py`, add this function immediately **above** `def _block(`:

```python
def _ask_insert_markdown(attrs: dict[str, Any], kids, resolver=None) -> str:
    """G-064 (spec §7.4): an inserted Ask Notebook answer exports as a LABELLED
    quote, so a member's Markdown never loses which passage was AI-assisted, and
    lists its sources as they stood when it was inserted."""
    date = str(attrs.get("insertedAt") or "")[:10]
    question = str(attrs.get("question") or "").strip()
    head = "**From Ask Notebook**"
    if date:
        head += f" · {date}"
    if question:
        head += f" · Q: {question}"

    sources: dict[Any, str] = {}

    def collect(n):
        if not isinstance(n, dict):
            return
        if n.get("type") == "askCitation":
            a = n.get("attrs") or {}
            num = a.get("n")
            if num is not None and num not in sources:
                sources[num] = str(a.get("label") or "source")
        for c in n.get("content") or []:
            collect(c)

    for c in kids or []:
        collect(c)

    body = "\n\n".join(b for b in (_block(c, resolver) for c in (kids or [])) if b != "")
    lines = [f"> {head}", ">"]
    lines += [f"> {ln}" if ln else ">" for ln in body.split("\n")]
    if sources:
        lines.append(">")
        lines.append("> Sources as of insertion: "
                     + " · ".join(f"[{k}] {v}" for k, v in sources.items()))
    return "\n".join(lines)
```

Inside `_block`, add two branches directly before the `if ntype == "widgetEmbed":`
branch:

```python
    if ntype == "askInsert":
        return _ask_insert_markdown(attrs, kids, resolver)
    if ntype == "askCitation":
        n = attrs.get("n")
        return f"[{n}]" if n is not None else ""
```

- [ ] **Step 5: Implement the share reduction**

In `note_shares.py`, add this above `def resolve_share(`:

```python
def _reduce_ask_citations(node: Any) -> Any:
    """G-064 (spec §7.5): a chip's label, link, precision and claim describe notes
    the member did NOT share. The public copy keeps only the number. Mutates in
    place and returns the node."""
    if isinstance(node, dict):
        if node.get("type") == "askCitation":
            attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
            node["attrs"] = {"n": attrs.get("n")}
        for child in node.get("content") or []:
            _reduce_ask_citations(child)
    return node
```

In `resolve_share`'s returned dict, change the `"bodyJson"` line to:

```python
            "bodyJson": _reduce_ask_citations(json.loads(body_raw)),
```

If `note_shares.py` does not already import `Any`, add `from typing import Any`
beside its other imports.

- [ ] **Step 6: Run the rails**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k
python -m pytest api/services/journal_two/test_notes_export.py api/services/journal_two/test_notes_export_route.py api/services/journal_two/test_note_shares.py tests/test_journal_two_share_router.py -q > /tmp/g064.log 2>&1; code=$?; tail -15 /tmp/g064.log; exit $code
```

Expected: PASS, exit 0.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k
git add api/services/journal_two/notes_export.py api/services/journal_two/note_shares.py api/services/journal_two/test_notes_export.py api/services/journal_two/test_note_shares.py
python tools/check_repo_hygiene.py --staged
git commit -F - <<'MSG'
feat(notebook): inserted answers export labelled; shares never leak chips

G-064 spec §7.4-7.5. An askInsert exports as a labelled blockquote with
its question, date and sources-as-of-insertion (an unknown node used to
lose its wrapper). A shared note's askCitation attrs are reduced to {n}:
label, link, precision and claim describe notes the member did not share.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HiiyhLP3J7WbX1wf3XLeQ6
MSG
```

---

### Task 6: The pure insert library — claim, node builder, pending hand-off (spec §5.1, §5.2, §6.2, §6.4)

**Files:**
- Create: `app/src/pages/journal-2-0/lib/askInsert.js`
- Test: `app/src/pages/journal-2-0/lib/askInsert.test.js`

**Interfaces:**
- Consumes: `splitAnswer(answer, sources)` from `./askCitation`
  (`askCitation.js:47`).
- Produces:
  - `ASK_INSERT_TYPE = 'askInsert'`, `ASK_CITATION_TYPE = 'askCitation'`
  - `normalizeClaim(texts: string[]) -> string`
  - `claimFromJson(content: object[]) -> string`
  - `claimFromBlock(pmTextblock) -> string`
  - `buildAskInsertNode({ answer, sources, question, scope, insertedAt }) -> object | null`
  - `PENDING_ASK_INSERT_KEY = 'uct.j2.askInsert.pending'`,
    `PENDING_ASK_INSERT_TTL_MS = 900000`
  - `writePendingAskInsert(noteId, node, now?) -> boolean` (true if `sessionStorage`
    also held it)
  - `takePendingAskInsert(noteId, now?) -> { noteId, node, createdAt } | null`
  - `clearPendingAskInsert() -> void`

- [ ] **Step 1: Write the failing tests**

Create `app/src/pages/journal-2-0/lib/askInsert.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Schema } from 'prosemirror-model'
import {
  ASK_CITATION_TYPE, ASK_INSERT_TYPE, PENDING_ASK_INSERT_KEY, PENDING_ASK_INSERT_TTL_MS,
  buildAskInsertNode, claimFromBlock, claimFromJson, clearPendingAskInsert, normalizeClaim,
  takePendingAskInsert, writePendingAskInsert,
} from './askInsert'

const SRC1 = { n: 1, label: 'NVDA thesis', citation: 'exact', navigation: { kind: 'note', note_id: 'n1' } }
const SRC2 = { n: 2, label: 'Q3 call', citation: 'page_only', navigation: { kind: 'document', document_id: 'd1', page_number: 3 } }
const AT = '2026-09-22T12:00:00.000Z'

describe('the claim is ONE normalization, used at insert and at render', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeClaim(['  Margins  fell ', '\n in Q3. '])).toBe('Margins fell in Q3.')
  })

  it('a JSON paragraph and a ProseMirror paragraph with the same text agree', () => {
    const schema = new Schema({ nodes: {
      doc: { content: 'block+' },
      paragraph: { group: 'block', content: 'inline*' },
      text: { group: 'inline' },
      askCitation: { group: 'inline', inline: true, atom: true, attrs: { n: { default: null } } },
    } })
    const content = [
      { type: 'text', text: 'Margins fell ' },
      { type: 'askCitation', attrs: { n: 1 } },
      { type: 'text', text: ' in Q3.' },
    ]
    const pm = schema.nodeFromJSON({ type: 'paragraph', content })
    expect(claimFromJson(content)).toBe('Margins fell in Q3.')
    expect(claimFromBlock(pm)).toBe(claimFromJson(content))
  })
})

describe('buildAskInsertNode — exactly what the panel showed', () => {
  it('turns cited handles into chips, one paragraph per line', () => {
    const node = buildAskInsertNode({
      answer: 'Margins fell [1].\n\nGuidance held [2].',
      sources: [SRC1, SRC2], question: 'margins?', scope: 'notebook', insertedAt: AT,
    })
    expect(node.type).toBe(ASK_INSERT_TYPE)
    expect(node.attrs).toEqual({ insertedAt: AT, scope: 'notebook', question: 'margins?' })
    expect(node.content).toHaveLength(2)
    expect(node.content[0]).toEqual({ type: 'paragraph', content: [
      { type: 'text', text: 'Margins fell ' },
      { type: ASK_CITATION_TYPE, attrs: {
        n: 1, label: 'NVDA thesis', nav: { kind: 'note', note_id: 'n1' },
        citation: 'exact', claim: 'Margins fell .' } },
      { type: 'text', text: '.' },
    ] })
    expect(node.content[1].content[1].attrs.claim).toBe('Guidance held .')
    expect(node.content[1].content[1].attrs.citation).toBe('page_only')
  })

  it('an invented handle stays literal text, never a chip', () => {
    const node = buildAskInsertNode({ answer: 'Margins fell [9].', sources: [SRC1], insertedAt: AT })
    expect(node.content[0].content).toEqual([{ type: 'text', text: 'Margins fell [9].' }])
  })

  it('drops empty lines and never emits an empty text node', () => {
    const node = buildAskInsertNode({ answer: 'A [1]\n\n\nB', sources: [SRC1], insertedAt: AT })
    expect(node.content).toHaveLength(2)
    const texts = []
    node.content.forEach((p) => p.content.forEach((n) => { if (n.type === 'text') texts.push(n.text) }))
    expect(texts.every((t) => t.length > 0)).toBe(true)
  })

  it('returns null when nothing survives', () => {
    expect(buildAskInsertNode({ answer: '\n\n', sources: [], insertedAt: AT })).toBeNull()
  })

  it('copies the navigation object rather than sharing it', () => {
    const node = buildAskInsertNode({ answer: 'A [1]', sources: [SRC1], insertedAt: AT })
    const nav = node.content[0].content[1].attrs.nav
    expect(nav).toEqual(SRC1.navigation)
    expect(nav).not.toBe(SRC1.navigation)
  })
})

describe('the pending hand-off is consumed exactly once, and only by its note', () => {
  const NODE = { type: ASK_INSERT_TYPE, attrs: {}, content: [] }
  beforeEach(() => { clearPendingAskInsert(); sessionStorage.clear() })

  it('hands the entry to the matching note once', () => {
    writePendingAskInsert('n1', NODE, 1000)
    expect(takePendingAskInsert('n1', 2000)?.node).toEqual(NODE)
    expect(takePendingAskInsert('n1', 2000)).toBeNull()
  })

  it("another note does not consume it", () => {
    writePendingAskInsert('n1', NODE, 1000)
    expect(takePendingAskInsert('n2', 2000)).toBeNull()
    expect(takePendingAskInsert('n1', 2000)?.noteId).toBe('n1')
  })

  it('an expired entry is discarded everywhere', () => {
    writePendingAskInsert('n1', NODE, 1000)
    expect(takePendingAskInsert('n1', 1000 + PENDING_ASK_INSERT_TTL_MS)).toBeNull()
    expect(sessionStorage.getItem(PENDING_ASK_INSERT_KEY)).toBeNull()
  })

  it('survives a full reload through sessionStorage', () => {
    writePendingAskInsert('n1', NODE, 1000)
    const raw = sessionStorage.getItem(PENDING_ASK_INSERT_KEY)
    clearPendingAskInsert()               // a reload clears the memory carrier…
    sessionStorage.setItem(PENDING_ASK_INSERT_KEY, raw)  // …and keeps storage
    expect(takePendingAskInsert('n1', 2000)?.noteId).toBe('n1')
  })

  it('still works when storage is refused (memory carrier)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(writePendingAskInsert('n1', NODE, 1000)).toBe(false)
    spy.mockRestore()
    expect(takePendingAskInsert('n1', 2000)?.noteId).toBe('n1')
  })

  it('a corrupt stored entry is ignored', () => {
    sessionStorage.setItem(PENDING_ASK_INSERT_KEY, '{not json')
    expect(takePendingAskInsert('n1', 2000)).toBeNull()
  })

  it('an entry that is not an askInsert is refused', () => {
    writePendingAskInsert('n1', { type: 'paragraph' }, 1000)
    expect(takePendingAskInsert('n1', 2000)).toBeNull()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k/app
npx vitest run src/pages/journal-2-0/lib/askInsert.test.js --maxWorkers=2 > /tmp/g064.log 2>&1; code=$?; tail -15 /tmp/g064.log; exit $code
```

Expected: FAIL. The module does not exist yet.

- [ ] **Step 3: Implement `lib/askInsert.js`**

```js
/**
 * G-064 — insert an Ask Notebook answer into a note.
 * Spec: docs/superpowers/specs/2026-09-22-ask-notebook-insert-design.md
 *
 * ⛔ EVERY INSERT IS AN EDITOR TRANSACTION (spec §5). A server-side append of a
 * new block type forks any open or offline-queued copy of the note
 * (serverChange.js merges only three types) and skips version history. So a note
 * that is not open is OPENED first, and the answer rides the hand-off below.
 */
import { splitAnswer } from './askCitation'

export const ASK_INSERT_TYPE = 'askInsert'
export const ASK_CITATION_TYPE = 'askCitation'

// ── The claim: ONE normalization, used at insert AND at render (spec §6.4) ──

/** Whitespace runs collapse to one space; the ends are trimmed. */
export function normalizeClaim(texts) {
  return (texts || []).join('').replace(/\s+/g, ' ').trim()
}

/** The claim of a JSON paragraph's content array (insert time). */
export function claimFromJson(content) {
  return normalizeClaim((content || [])
    .filter((n) => n && n.type === 'text' && typeof n.text === 'string')
    .map((n) => n.text))
}

/** The claim of a live ProseMirror textblock (render time). */
export function claimFromBlock(block) {
  const texts = []
  block.forEach((child) => { if (child.isText) texts.push(child.text) })
  return normalizeClaim(texts)
}

// ── Building the node: exactly what the panel showed (spec §3.5, §5.1) ──

/**
 * @returns the `askInsert` JSON node, or null when nothing survives.
 */
export function buildAskInsertNode({
  answer, sources, question = '', scope = null, insertedAt = new Date().toISOString(),
}) {
  const paragraphs = [[]]
  for (const part of splitAnswer(answer || '', sources || [])) {
    if (part.source) {
      const s = part.source
      const nav = s.navigation && typeof s.navigation === 'object' ? { ...s.navigation } : null
      paragraphs[paragraphs.length - 1].push({
        type: ASK_CITATION_TYPE,
        attrs: { n: s.n, label: s.label || '', nav, citation: s.citation || null, claim: '' },
      })
      continue
    }
    part.text.split(/\r?\n/).forEach((line, i) => {
      if (i > 0) paragraphs.push([])
      // ⛔ ProseMirror rejects an empty text node.
      if (line) paragraphs[paragraphs.length - 1].push({ type: 'text', text: line })
    })
  }
  const kept = paragraphs.filter((content) => content.some(
    (n) => n.type === ASK_CITATION_TYPE || (n.type === 'text' && n.text.trim())))
  if (!kept.length) return null
  for (const content of kept) {
    const claim = claimFromJson(content)
    for (const n of content) if (n.type === ASK_CITATION_TYPE) n.attrs.claim = claim
  }
  return {
    type: ASK_INSERT_TYPE,
    attrs: { insertedAt, scope, question: question || '' },
    content: kept.map((content) => ({ type: 'paragraph', content })),
  }
}

// ── The pending hand-off to a note that is not open (spec §5.2) ──
//
// ⭐ The writePendingShare/takePendingShare pattern (shareTarget.js): MEMORY
// carries the in-app route change even where storage is refused;
// sessionStorage carries a full reload. One entry at a time.

export const PENDING_ASK_INSERT_KEY = 'uct.j2.askInsert.pending'
export const PENDING_ASK_INSERT_TTL_MS = 15 * 60 * 1000

let _pending = null

export function writePendingAskInsert(noteId, node, now = Date.now()) {
  const entry = { noteId, node, createdAt: now }
  _pending = entry
  try {
    sessionStorage.setItem(PENDING_ASK_INSERT_KEY, JSON.stringify(entry))
    return true
  } catch {
    return false
  }
}

export function clearPendingAskInsert() {
  _pending = null
  try { sessionStorage.removeItem(PENDING_ASK_INSERT_KEY) } catch { /* refused */ }
}

/**
 * The entry for THIS note, removed before it is returned, or null.
 *
 * ⛔ REMOVED FIRST: the caller inserts after this returns, so a StrictMode
 * double effect or a reload can never insert the same answer twice. Another
 * note's entry is LEFT for that note; an expired or malformed one is dropped.
 */
export function takePendingAskInsert(noteId, now = Date.now()) {
  let entry = _pending
  if (!entry) {
    let raw = null
    try { raw = sessionStorage.getItem(PENDING_ASK_INSERT_KEY) } catch { raw = null }
    if (raw) {
      try { entry = JSON.parse(raw) } catch { entry = null }
    }
  }
  if (!entry || typeof entry !== 'object') { clearPendingAskInsert(); return null }
  const age = now - Number(entry.createdAt)
  if (!(age >= 0 && age < PENDING_ASK_INSERT_TTL_MS)) { clearPendingAskInsert(); return null }
  if (entry.noteId !== noteId) return null
  clearPendingAskInsert()
  if (!entry.node || entry.node.type !== ASK_INSERT_TYPE) return null
  return entry
}
```

- [ ] **Step 4: Run it again**

Same command as Step 2. Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k
git add app/src/pages/journal-2-0/lib/askInsert.js app/src/pages/journal-2-0/lib/askInsert.test.js
python tools/check_repo_hygiene.py --staged
git commit -F - <<'MSG'
feat(notebook): askInsert library -- claim, node builder, pending hand-off

G-064 spec §5.1-5.2, §6.2-6.4. One claim normalization used at insert and
at render; buildAskInsertNode turns exactly what the Ask panel showed
into an askInsert block with citation chips; a consume-once hand-off
(memory + sessionStorage, the shareTarget.js pattern) carries an answer
to a note that is not open.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HiiyhLP3J7WbX1wf3XLeQ6
MSG
```

---

### Task 7: The two nodes, their views, the stale decoration, and registration (spec §4, §6.3, §6.6, §8)

**Files:**
- Create: `app/src/pages/journal-2-0/lib/askInsertNode.jsx`
- Create: `app/src/pages/journal-2-0/lib/askCitationNode.jsx`
- Create: `app/src/pages/journal-2-0/components/notebook/AskInsertView.jsx` + `AskInsertView.module.css` + `AskInsertView.test.jsx`
- Create: `app/src/pages/journal-2-0/components/notebook/AskCitationView.jsx` + `AskCitationView.module.css` + `AskCitationView.test.jsx`
- Modify: `app/src/pages/journal-2-0/lib/askInsert.js` (add `appendAskInsert`)
- Modify: `app/src/pages/journal-2-0/lib/tiptap.js` (imports + `buildExtensions`)
- Test: `app/src/pages/journal-2-0/lib/askInsertNodes.test.js`

**Interfaces:**
- Consumes: `ASK_CITATION_TYPE`, `claimFromBlock` and `buildAskInsertNode` (Task 6);
  `notePath` (`app/src/hooks/useNoteBacklinks.js:36`).
- Produces:
  - `AskInsert` (TipTap Node, name `askInsert`)
  - `AskCitation` (TipTap Node, name `askCitation`)
  - `askCitationStaleKey` (PluginKey) and `staleCitationDecorations(doc) -> DecorationSet`
  - `appendAskInsert(editor, node) -> boolean`
  - `citationDescription({ n, label, citation }, stale) -> string`
  - `PRECISION_WORDS`

- [ ] **Step 1: Write the failing editor-level tests**

Create `app/src/pages/journal-2-0/lib/askInsertNodes.test.js`:

```js
import { describe, it, expect, afterEach } from 'vitest'
import { Editor, generateHTML, generateJSON } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { AskInsert } from './askInsertNode'
import { AskCitation, askCitationStaleKey } from './askCitationNode'
import { appendAskInsert, buildAskInsertNode } from './askInsert'
import { buildExtensions } from './tiptap'

// A bare Editor has no React content component, so ReactNodeViewRenderer
// returns {} and the nodes render through renderHTML. That is exactly what we
// want here: these rails are about the SCHEMA, the keymap and the plugin.
const EXT = [StarterKit, AskInsert, AskCitation]
let editor
afterEach(() => { editor?.destroy(); editor = null })

function mount(content) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: EXT, content })
  return editor
}

function findInsert(ed) {
  let found = null
  ed.state.doc.forEach((node, offset) => { if (!found && node.type.name === 'askInsert') found = { a: offset, node } })
  return found
}

const SRC = { n: 1, label: 'NVDA thesis', citation: 'exact', navigation: { kind: 'note', note_id: 'n1' } }
const INSERT = buildAskInsertNode({
  answer: 'Margins fell [1].', sources: [SRC], question: 'q', scope: 'note',
  insertedAt: '2026-09-22T12:00:00.000Z',
})
const MINE = { type: 'paragraph', content: [{ type: 'text', text: 'Mine.' }] }
const AFTER = { type: 'paragraph', content: [{ type: 'text', text: 'After.' }] }
const DOC = { type: 'doc', content: [MINE, INSERT, AFTER] }

describe('registration — never remove', () => {
  it('buildExtensions() carries both nodes', () => {
    const names = buildExtensions().map((e) => e.name)
    expect(names).toContain('askInsert')
    expect(names).toContain('askCitation')
  })
})

describe('HTML round trip (copy/paste stability)', () => {
  it('keeps every chip attribute', () => {
    const json = generateJSON(generateHTML(DOC, EXT), EXT)
    const chip = json.content[1].content[0].content[1]
    expect(chip.type).toBe('askCitation')
    expect(chip.attrs).toEqual({
      n: 1, label: 'NVDA thesis', nav: { kind: 'note', note_id: 'n1' },
      citation: 'exact', claim: 'Margins fell .',
    })
    expect(json.content[1].attrs).toEqual({
      insertedAt: '2026-09-22T12:00:00.000Z', scope: 'note', question: 'q',
    })
  })

  it('re-parses its own output unchanged', () => {
    const first = generateJSON(generateHTML(DOC, EXT), EXT)
    expect(generateJSON(generateHTML(first, EXT), EXT)).toEqual(first)
  })
})

describe('the provenance wrapper survives editing (P1)', () => {
  it('Backspace at the start of the body does not lift it out', () => {
    const ed = mount(DOC)
    const before = ed.getJSON()
    ed.commands.setTextSelection(findInsert(ed).a + 2)
    ed.commands.keyboardShortcut('Backspace')
    expect(ed.getJSON()).toEqual(before)
  })

  it('Delete at the end of the body does not pull the next paragraph in', () => {
    const ed = mount(DOC)
    const { a, node } = findInsert(ed)
    ed.commands.setTextSelection(a + node.nodeSize - 2)
    ed.commands.keyboardShortcut('Delete')
    expect(ed.state.doc.childCount).toBe(3)
    expect(ed.state.doc.child(2).textContent).toBe('After.')
    expect(ed.state.doc.child(1).type.name).toBe('askInsert')
  })

  it('deleting every character of the body keeps the wrapper', () => {
    const ed = mount(DOC)
    const { a, node } = findInsert(ed)
    ed.chain().setTextSelection({ from: a + 2, to: a + node.nodeSize - 2 }).deleteSelection().run()
    expect(ed.state.doc.child(1).type.name).toBe('askInsert')
    expect(ed.state.doc.child(1).textContent).toBe('')
  })
})

describe('a citation says so when its paragraph was edited (P2)', () => {
  const stale = (ed) => askCitationStaleKey.getState(ed.state).find().length

  it('a fresh insert has nothing stale', () => {
    expect(stale(mount(DOC))).toBe(0)
  })

  it("editing the chip's paragraph marks it stale", () => {
    const ed = mount(DOC)
    ed.chain().setTextSelection(findInsert(ed).a + 2).insertContent('Really, ').run()
    expect(stale(ed)).toBe(1)
  })

  it('editing a different paragraph changes nothing', () => {
    const ed = mount(DOC)
    ed.chain().setTextSelection(1).insertContent('Still ').run()
    expect(stale(ed)).toBe(0)
  })

  it('undoing the edit clears it again — computed, never stored', () => {
    const ed = mount(DOC)
    ed.chain().setTextSelection(findInsert(ed).a + 2).insertContent('X').run()
    expect(stale(ed)).toBe(1)
    ed.commands.undo()
    expect(stale(ed)).toBe(0)
  })

  it('the check never writes to the document', () => {
    const ed = mount(DOC)
    let updates = 0
    ed.on('update', () => { updates += 1 })
    ed.commands.setTextSelection(1)
    expect(updates).toBe(0)
    expect(JSON.stringify(ed.getJSON())).not.toContain('askStale')
  })
})

describe('appendAskInsert (spec §5.2)', () => {
  it('appends at the end, never replacing a selected node', () => {
    const ed = mount({ type: 'doc', content: [MINE] })
    ed.commands.setNodeSelection(0)
    expect(appendAskInsert(ed, INSERT)).toBe(true)
    expect(ed.state.doc.childCount).toBe(2)
    expect(ed.state.doc.child(0).textContent).toBe('Mine.')
    expect(ed.state.doc.child(1).type.name).toBe('askInsert')
  })

  it('refuses a missing, destroyed or read-only editor', () => {
    const ed = mount({ type: 'doc', content: [MINE] })
    ed.setEditable(false)
    expect(appendAskInsert(ed, INSERT)).toBe(false)
    expect(appendAskInsert(null, INSERT)).toBe(false)
    expect(ed.state.doc.childCount).toBe(1)
  })
})
```

- [ ] **Step 2: Write the failing view tests**

Create `app/src/pages/journal-2-0/components/notebook/AskCitationView.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const navSpy = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navSpy }))

import AskCitationView from './AskCitationView'

const node = (attrs = {}) => ({ attrs: {
  n: 1, label: 'NVDA thesis', nav: { kind: 'note', note_id: 'n1' }, citation: 'exact', claim: 'x', ...attrs,
} })

beforeEach(() => navSpy.mockClear())

describe('AskCitationView', () => {
  it('renders [n] and names its source', () => {
    render(<AskCitationView node={node()} decorations={[]} />)
    expect(screen.getByRole('button', { name: 'Source 1: NVDA thesis' })).toHaveTextContent('[1]')
  })

  it('opens the cited note', () => {
    render(<AskCitationView node={node()} decorations={[]} />)
    fireEvent.click(screen.getByRole('button'))
    expect(navSpy).toHaveBeenCalledWith('/journal/notebook?note=n1')
  })

  it('a stale chip says "edited" in visible text and in its name', () => {
    render(<AskCitationView node={node()} decorations={[{ spec: { askStale: true } }]} />)
    const b = screen.getByRole('button')
    expect(b).toHaveTextContent('[1 · edited]')
    expect(b).toHaveAccessibleName('Source 1: NVDA thesis, text edited since inserted')
  })

  it('insert-time precision is stated in words', () => {
    render(<AskCitationView node={node({ citation: 'page_only' })} decorations={[]} />)
    expect(screen.getByRole('button')).toHaveAccessibleName('Source 1: NVDA thesis, page only')
  })

  it('a source with no note is not clickable, and a shared copy (attrs reduced to n) still reads', () => {
    render(<AskCitationView node={{ attrs: { n: 2 } }} decorations={[]} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('[2]')).toBeInTheDocument()
    expect(screen.getByText('Source 2: source')).toBeInTheDocument()
  })
})
```

Create `app/src/pages/journal-2-0/components/notebook/AskInsertView.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import AskInsertView from './AskInsertView'

const node = { attrs: { insertedAt: '2026-09-22T12:00:00.000Z', scope: 'note', question: 'What about margins?' } }

describe('AskInsertView', () => {
  it('labels the block as coming from Ask Notebook, with its date', () => {
    render(<AskInsertView node={node} />)
    expect(screen.getByText('From Ask Notebook')).toBeInTheDocument()
    expect(screen.getByText(/Sep 22, 2026/)).toBeInTheDocument()
  })

  it('names the block with its question for assistive tech', () => {
    render(<AskInsertView node={node} />)
    expect(screen.getByRole('group', { name: 'Answer from Ask Notebook to: What about margins?' })).toBeInTheDocument()
  })

  it('the label row is not editable', () => {
    render(<AskInsertView node={node} />)
    expect(screen.getByText('From Ask Notebook').closest('[contenteditable="false"]')).not.toBeNull()
  })
})
```

- [ ] **Step 3: Run and watch them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k/app
npx vitest run src/pages/journal-2-0/lib/askInsertNodes.test.js src/pages/journal-2-0/components/notebook/AskCitationView.test.jsx src/pages/journal-2-0/components/notebook/AskInsertView.test.jsx --maxWorkers=2 > /tmp/g064.log 2>&1; code=$?; tail -15 /tmp/g064.log; exit $code
```

Expected: FAIL. The modules do not exist yet.

- [ ] **Step 4: Create the two views**

`app/src/pages/journal-2-0/components/notebook/AskCitationView.jsx`:

```jsx
import { NodeViewWrapper } from '@tiptap/react'
import { useNavigate } from 'react-router-dom'
import { notePath } from '../../../../hooks/useNoteBacklinks'
import askStyles from './AskPanel.module.css'
import styles from './AskCitationView.module.css'

/**
 * G-064 — the chip for an `askCitation` atom (spec §6.6).
 *
 * The chip class is AskPanel's own `.citationChip`, imported, not copied, so a
 * citation looks the same in the panel and in a note. Degradation is stated in
 * WORDS, never by colour alone (AskPanel.jsx:300): a stale chip reads
 * `[n · edited]`, and the insert-time precision uses AskPanel's own Sources-row
 * words (AskPanel.jsx:303-305).
 */
export const PRECISION_WORDS = Object.freeze({
  page_only: 'page only', note_only: 'note only', record_only: 'record', unavailable: 'unavailable',
})

export function citationDescription({ n, label, citation }, stale) {
  const parts = [`Source ${n}: ${label || 'source'}`]
  if (citation && citation !== 'exact') parts.push(PRECISION_WORDS[citation] || 'unavailable')
  if (stale) parts.push('text edited since inserted')
  return parts.join(', ')
}

export default function AskCitationView({ node, decorations }) {
  const { n, label, nav, citation } = node.attrs
  const navigate = useNavigate()
  const stale = Array.isArray(decorations) && decorations.some((d) => d?.spec?.askStale)
  const noteId = nav && typeof nav === 'object' && typeof nav.note_id === 'string' ? nav.note_id : null
  const text = stale ? `[${n} · edited]` : `[${n}]`
  const described = citationDescription({ n, label, citation }, stale)
  const cls = `${askStyles.citationChip} ${stale ? styles.stale : ''}`

  return (
    <NodeViewWrapper as="span" className={styles.wrap} data-ask-citation>
      {noteId ? (
        <button
          type="button"
          className={cls}
          contentEditable={false}
          aria-label={described}
          title={described}
          onClick={(e) => { e.preventDefault(); navigate(notePath(noteId)) }}
        >
          {text}
        </button>
      ) : (
        <span className={cls} contentEditable={false} title={described}>
          {text}
          <span className={askStyles.srOnly}>{described}</span>
        </span>
      )}
    </NodeViewWrapper>
  )
}
```

`app/src/pages/journal-2-0/components/notebook/AskCitationView.module.css`:

```css
/* G-064 — the chip itself is AskPanel.module.css's .citationChip. */
.wrap { display: inline; }
.stale { opacity: 0.75; }
```

`app/src/pages/journal-2-0/components/notebook/AskInsertView.jsx`:

```jsx
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import UIcon from '../../../../components/ui/UIcon'
import styles from './AskInsertView.module.css'

/**
 * G-064 — the block holding an inserted Ask Notebook answer (spec §4.1, §8).
 * The label row is chrome (contentEditable=false); the body is the member's to
 * edit. Styles come through CSS-module classNames, never raw class names
 * (the trap NoteEditorPage.module.css:201-206 records).
 */
export function insertedDateLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function AskInsertView({ node }) {
  const { insertedAt, question } = node.attrs
  const date = insertedDateLabel(insertedAt)
  return (
    <NodeViewWrapper
      className={styles.block}
      data-type="ask-insert"
      role="group"
      aria-label={question ? `Answer from Ask Notebook to: ${question}` : 'Answer from Ask Notebook'}
    >
      <div className={styles.header} contentEditable={false} title={question ? `Question: ${question}` : undefined}>
        <UIcon name="sparkle" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
        <span className={styles.label}>From Ask Notebook</span>
        {date && <span className={styles.date}>{` · ${date}`}</span>}
      </div>
      <NodeViewContent className={styles.body} />
    </NodeViewWrapper>
  )
}
```

`app/src/pages/journal-2-0/components/notebook/AskInsertView.module.css`:

```css
/* G-064 — the Callout box (NoteEditorPage.module.css [data-type="callout"]). */
.block {
  margin: 14px 0;
  padding: 10px 14px 12px;
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  border: 1px solid var(--border);
}
.header {
  display: flex;
  align-items: center;
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 6px;
  user-select: none;
}
.label { font-weight: 600; }
.date { white-space: pre; }
.body { min-width: 0; }
```

- [ ] **Step 5: Create the nodes**

`app/src/pages/journal-2-0/lib/askInsertNode.jsx`:

```jsx
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import AskInsertView from '../components/notebook/AskInsertView'

/**
 * G-064 — an inserted Ask Notebook answer (spec §4.1).
 *
 * `isolating` is P1's mechanism: Backspace at the start and Delete at the end
 * never merge the body out of the block, and `content: 'block+'` keeps the
 * wrapper when every paragraph is deleted. Removing the block is an ordinary
 * node delete; there is no unwrap command.
 *
 * ⚠️ Never remove this extension from buildExtensions(): TipTap drops unknown
 * node types at parse time, so unregistering it would delete every inserted
 * answer from every note the next time one opens.
 */
export const AskInsert = Node.create({
  name: 'askInsert',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,
  draggable: false,

  addAttributes() {
    return {
      insertedAt: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-inserted-at'),
        renderHTML: (a) => (a.insertedAt ? { 'data-inserted-at': a.insertedAt } : {}),
      },
      scope: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-scope'),
        renderHTML: (a) => (a.scope ? { 'data-scope': a.scope } : {}),
      },
      question: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-question') || '',
        renderHTML: (a) => (a.question ? { 'data-question': a.question } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="ask-insert"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'ask-insert' }), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(AskInsertView)
  },
})
```

`app/src/pages/journal-2-0/lib/askCitationNode.jsx`:

```jsx
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import AskCitationView from '../components/notebook/AskCitationView'
import { ASK_CITATION_TYPE, claimFromBlock } from './askInsert'

/**
 * G-064 — one citation inside an inserted answer (spec §4.2).
 *
 * No `leafText`, exactly like noteLink: ProseMirror's textBetween gives it zero
 * characters, and the server's note_citation_text treats it as a one-position
 * leaf (spec §7.1). The source's own passage is deliberately NOT stored.
 *
 * ⚠️ Never remove this extension from buildExtensions() — see askInsertNode.jsx.
 */
export const askCitationStaleKey = new PluginKey('askCitationStale')

/**
 * Stale = the chip's paragraph text is no longer the text it had at insertion
 * (spec §6.2). ⛔ COMPUTED AT RENDER, NEVER STORED (§6.3): a decoration, so the
 * check can never dispatch a transaction and never trigger a save.
 */
export function staleCitationDecorations(doc) {
  const decos = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let claim = null
    node.forEach((child, offset) => {
      if (child.type.name !== ASK_CITATION_TYPE) return
      if (claim === null) claim = claimFromBlock(node)
      if (claim !== (child.attrs.claim || '')) {
        const from = pos + 1 + offset
        decos.push(Decoration.node(from, from + child.nodeSize, {}, { askStale: true }))
      }
    })
    return false
  })
  return DecorationSet.create(doc, decos)
}

function parseJsonAttr(raw) {
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}

export const AskCitation = Node.create({
  name: 'askCitation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      n: {
        default: null,
        parseHTML: (el) => {
          const v = Number(el.getAttribute('data-n'))
          return Number.isFinite(v) ? v : null
        },
        renderHTML: (a) => (a.n != null ? { 'data-n': String(a.n) } : {}),
      },
      label: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-label') || '',
        renderHTML: (a) => (a.label ? { 'data-label': a.label } : {}),
      },
      nav: {
        default: null,
        parseHTML: (el) => parseJsonAttr(el.getAttribute('data-nav')),
        renderHTML: (a) => (a.nav ? { 'data-nav': JSON.stringify(a.nav) } : {}),
      },
      citation: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-citation'),
        renderHTML: (a) => (a.citation ? { 'data-citation': a.citation } : {}),
      },
      claim: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-claim') || '',
        renderHTML: (a) => (a.claim ? { 'data-claim': a.claim } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="ask-citation"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'ask-citation' }), `[${node.attrs.n ?? '?'}]`]
  },

  addNodeView() {
    return ReactNodeViewRenderer(AskCitationView)
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      key: askCitationStaleKey,
      state: {
        init: (_config, state) => staleCitationDecorations(state.doc),
        apply: (tr, old) => (tr.docChanged ? staleCitationDecorations(tr.doc) : old),
      },
      props: {
        decorations(state) { return askCitationStaleKey.getState(state) },
      },
    })]
  },
})
```

- [ ] **Step 6: Add `appendAskInsert` to `lib/askInsert.js`**

Append to the end of `app/src/pages/journal-2-0/lib/askInsert.js`:

```js
// ── Inserting into an open editor (spec §5.2) ──

/**
 * Append an askInsert node at the END of the note.
 *
 * ⛔ An explicit position, never the selection: `insertContent` REPLACES a
 * selected node (NoteEditorPage.jsx:164-166 — the capture tray ate an embed
 * that way). The note's own autosave persists the change: baseline check,
 * version capture and offline outbox all unchanged.
 */
export function appendAskInsert(editor, node) {
  if (!editor || editor.isDestroyed || !editor.isEditable || !node) return false
  const at = editor.state.doc.content.size
  const ok = editor.chain().insertContentAt(at, node).run()
  if (!ok) return false
  try {
    const dom = editor.view.nodeDOM(at)
    if (dom && typeof dom.scrollIntoView === 'function') dom.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  } catch { /* scrolling is a courtesy */ }
  return true
}
```

- [ ] **Step 7: Register both nodes in `tiptap.js`**

Add the imports after `import { DocumentExcerpt } from './documentExcerptNode'`:

```js
import { AskInsert } from './askInsertNode'
import { AskCitation } from './askCitationNode'
```

In `buildExtensions`'s returned array, after `DocumentExcerpt,` add:

```js
    // G-064: an inserted Ask Notebook answer and its citation chips. Same
    // "never remove" rule as WidgetEmbed above -- TipTap drops unknown node
    // types at parse time, and the flag gates only the Insert button.
    AskInsert,
    AskCitation,
```

- [ ] **Step 8: Run all Task 7 tests plus the editor neighbours**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k/app
npx vitest run src/pages/journal-2-0/lib/askInsertNodes.test.js src/pages/journal-2-0/lib/askInsert.test.js src/pages/journal-2-0/components/notebook/AskCitationView.test.jsx src/pages/journal-2-0/components/notebook/AskInsertView.test.jsx src/pages/journal-2-0/lib/calloutNode.test.js src/pages/journal-2-0/lib/tiptap.test.js src/pages/journal-2-0/components/notebook/NoteEditorPage.noteLinks.test.jsx src/pages/journal-2-0/SharedNotePage.test.jsx --maxWorkers=2 > /tmp/g064.log 2>&1; code=$?; tail -15 /tmp/g064.log; exit $code
```

Expected: PASS, exit 0. If the `Delete at the end` test fails because
`keyboardShortcut('Delete')` is not dispatched in jsdom, replace that one call with
`ed.commands.joinForward()` and keep the assertions. The isolating boundary is what
refuses the join.

- [ ] **Step 9: Mutation proofs (save bytes, edit, re-run Step 8, restore bytes)**

1. Remove `isolating: true,` from `askInsertNode.jsx`. Expected: FAIL on
   `Backspace at the start of the body does not lift it out`.
2. In `staleCitationDecorations`, change `claim !== (child.attrs.claim || '')` to
   `false`. Expected: FAIL on `editing the chip's paragraph marks it stale`.

Restore both from the saved bytes, then re-run Step 8. Expected: PASS.

- [ ] **Step 10: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k
git add app/src/pages/journal-2-0/lib/askInsertNode.jsx app/src/pages/journal-2-0/lib/askCitationNode.jsx app/src/pages/journal-2-0/lib/askInsert.js app/src/pages/journal-2-0/lib/askInsertNodes.test.js app/src/pages/journal-2-0/lib/tiptap.js app/src/pages/journal-2-0/components/notebook/AskInsertView.jsx app/src/pages/journal-2-0/components/notebook/AskInsertView.module.css app/src/pages/journal-2-0/components/notebook/AskInsertView.test.jsx app/src/pages/journal-2-0/components/notebook/AskCitationView.jsx app/src/pages/journal-2-0/components/notebook/AskCitationView.module.css app/src/pages/journal-2-0/components/notebook/AskCitationView.test.jsx
python tools/check_repo_hygiene.py --staged
git commit -F - <<'MSG'
feat(notebook): askInsert + askCitation nodes, stale decoration, append

G-064 spec §4, §6, §8. askInsert is an isolating block (provenance can't
be edited away) with a React view: sparkle UIcon, "From Ask Notebook",
date, question as its accessible name. askCitation is a leaf chip using
AskPanel's own .citationChip. It reads "[n · edited]" when its paragraph
no longer matches the text it had at insertion, computed by a decoration
plugin and never stored. appendAskInsert appends at the doc end on the
note's own autosave path. Both nodes are registered in buildExtensions
and must never be removed.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HiiyhLP3J7WbX1wf3XLeQ6
MSG
```

---

### Task 8: One note search, and the inline picker (spec §3.3)

**Files:**
- Modify: `app/src/pages/journal-2-0/components/notebook/NoteLinkMenu.jsx`: export
  `makeNoteSearch`, add an `ariaLabel` prop to `NoteLinkList`, and make the
  Suggestion `items` use `makeNoteSearch`.
- Create: `app/src/pages/journal-2-0/components/notebook/NoteLinkMenu.search.test.js`
- Create: `app/src/pages/journal-2-0/components/notebook/AskInsertPicker.jsx` + `AskInsertPicker.module.css` + `AskInsertPicker.test.jsx`

**Interfaces:**
- Consumes: `writePendingAskInsert` (Task 6); `createNoteViaApi({ title, bodyJson })`
  (`lib/noteCreation.js:21`).
- Produces:
  - `makeNoteSearch({ debounceMs?, limit? }) -> (query) => [] | Promise<note[]>`
  - `<AskInsertPicker node defaultTitle onOpenNote onCancel search? createNote? />`

- [ ] **Step 1: Failing search test**

Create `app/src/pages/journal-2-0/components/notebook/NoteLinkMenu.search.test.js`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest'
import { makeNoteSearch } from './NoteLinkMenu'

afterEach(() => { vi.useRealTimers() })

describe('makeNoteSearch — the ONE note search ([[ menu and Ask insert picker)', () => {
  it('a superseded query never fires its own request', async () => {
    vi.useFakeTimers()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ notes: [{ id: 'n1', title: 'NVDA' }] }) })
    const search = makeNoteSearch({ debounceMs: 150 })
    const first = search('NV')
    const second = search('NVD')
    await vi.advanceTimersByTimeAsync(200)
    await expect(second).resolves.toEqual([{ id: 'n1', title: 'NVDA' }])
    await first
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(global.fetch.mock.calls[0][0]).toBe('/api/j2/notes?q=NVD&limit=8')
  })

  it('an empty query returns an empty list without a request', () => {
    global.fetch = vi.fn()
    expect(makeNoteSearch()('   ')).toEqual([])
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k/app
npx vitest run src/pages/journal-2-0/components/notebook/NoteLinkMenu.search.test.js --maxWorkers=2 > /tmp/g064.log 2>&1; code=$?; tail -15 /tmp/g064.log; exit $code
```

Expected: FAIL. `makeNoteSearch` is not exported.

- [ ] **Step 3: Extract the search (same body, now named)**

In `NoteLinkMenu.jsx`, add this below the `SEARCH_LIMIT` constant:

```js
/**
 * The note search behind the `[[` menu, extracted so G-064's Ask insert picker
 * searches the SAME way (spec §3.3) instead of growing a second one. One search
 * sequence per returned function: a stale (superseded) query never fires its
 * own request and never regresses the list to an older result.
 */
export function makeNoteSearch({ debounceMs = SEARCH_DEBOUNCE_MS, limit = SEARCH_LIMIT } = {}) {
  let seq = 0
  let lastResults = []
  return (query) => {
    const q = (query || '').trim()
    const mySeq = ++seq
    if (!q) { lastResults = []; return [] }
    return new Promise((resolve) => {
      setTimeout(async () => {
        if (mySeq !== seq) { resolve(lastResults); return }
        try {
          const res = await fetch(
            `/api/j2/notes?q=${encodeURIComponent(q)}&limit=${limit}`,
            { credentials: 'include' },
          )
          const body = res.ok ? await res.json() : { notes: [] }
          if (mySeq === seq) lastResults = body.notes || []
        } catch {
          // keep lastResults -- a transient network error should not blank a
          // list the member was already looking at
        }
        resolve(lastResults)
      }, debounceMs)
    })
  }
}
```

Replace the whole `items: (() => { … })(),` value in the Suggestion config with:

```js
        items: (() => {
          // One search sequence per plugin instance (never shared between
          // open notes/editors) -- see makeNoteSearch.
          const search = makeNoteSearch()
          return ({ query }) => search(query)
        })(),
```

In `NoteLinkList`, read `const ariaLabel = props.ariaLabel || 'Link to a note'`
directly after the `menuId` line. Then replace every `aria-label="Link to a note"`
in that component (three places) with `aria-label={ariaLabel}`.

- [ ] **Step 4: Run search test and the existing menu suite**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k/app
npx vitest run src/pages/journal-2-0/components/notebook/NoteLinkMenu.search.test.js src/pages/journal-2-0/components/notebook/NoteLinkMenu.test.jsx src/pages/journal-2-0/components/notebook/NoteEditorPage.noteLinks.test.jsx --maxWorkers=2 > /tmp/g064.log 2>&1; code=$?; tail -15 /tmp/g064.log; exit $code
```

Expected: PASS, exit 0.

- [ ] **Step 5: Failing picker tests**

Create `app/src/pages/journal-2-0/components/notebook/AskInsertPicker.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AskInsertPicker from './AskInsertPicker'
import { clearPendingAskInsert, takePendingAskInsert } from '../../lib/askInsert'

const NODE = {
  type: 'askInsert', attrs: { insertedAt: '2026-09-22T12:00:00.000Z', scope: 'notebook', question: 'q' },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }],
}
const NOTES = [{ id: 'n1', title: 'NVDA thesis', ticker: 'NVDA' }, { id: 'n2', title: 'AMD notes' }]

beforeEach(() => { clearPendingAskInsert(); sessionStorage.clear() })

function setup(overrides = {}) {
  const props = {
    node: NODE,
    defaultTitle: 'What about margins?',
    onOpenNote: vi.fn(),
    onCancel: vi.fn(),
    search: vi.fn(async () => NOTES),
    createNote: vi.fn(async () => ({ id: 'new1', title: 'x' })),
    ...overrides,
  }
  render(<AskInsertPicker {...props} />)
  return props
}
const input = () => screen.getByRole('textbox', { name: 'Find a note to insert into' })

describe('AskInsertPicker', () => {
  it('picking a note hands the answer to it and opens it', async () => {
    const p = setup()
    fireEvent.change(input(), { target: { value: 'nv' } })
    fireEvent.mouseDown(await screen.findByRole('option', { name: /NVDA thesis/ }))
    expect(p.onOpenNote).toHaveBeenCalledWith(NOTES[0])
    expect(takePendingAskInsert('n1')?.node).toEqual(NODE)
  })

  it('Enter picks the highlighted note', async () => {
    const p = setup()
    fireEvent.change(input(), { target: { value: 'nv' } })
    await screen.findByRole('option', { name: /NVDA thesis/ })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(p.onOpenNote).toHaveBeenCalledWith(NOTES[0])
  })

  it('create new uses the typed title and the answer as the body — no hand-off needed', async () => {
    const p = setup()
    fireEvent.change(input(), { target: { value: 'Margins log' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create a new note titled "Margins log"' }))
    await waitFor(() => expect(p.onOpenNote).toHaveBeenCalledWith({ id: 'new1', title: 'x' }))
    expect(p.createNote).toHaveBeenCalledWith({ title: 'Margins log', bodyJson: { type: 'doc', content: [NODE] } })
    expect(takePendingAskInsert('new1')).toBeNull()
  })

  it('with nothing typed, the new note takes the question as its title', async () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Create a new note' }))
    await waitFor(() => expect(p.createNote).toHaveBeenCalled())
    expect(p.createNote.mock.calls[0][0].title).toBe('What about margins?')
  })

  it('a failed create says so in words and keeps the picker', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const p = setup({ createNote: vi.fn(async () => { throw new Error('500') }) })
    fireEvent.click(screen.getByRole('button', { name: 'Create a new note' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't create the note. Your answer is still here.")
    expect(p.onOpenNote).not.toHaveBeenCalled()
  })

  it('Cancel closes it', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(p.onCancel).toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: Run and watch it fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k/app
npx vitest run src/pages/journal-2-0/components/notebook/AskInsertPicker.test.jsx --maxWorkers=2 > /tmp/g064.log 2>&1; code=$?; tail -15 /tmp/g064.log; exit $code
```

Expected: FAIL. The module does not exist yet.

- [ ] **Step 7: Implement the picker**

`app/src/pages/journal-2-0/components/notebook/AskInsertPicker.jsx`:

```jsx
import { useEffect, useRef, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { createNoteViaApi } from '../../lib/noteCreation'
import { writePendingAskInsert } from '../../lib/askInsert'
import { NoteLinkList, makeNoteSearch } from './NoteLinkMenu'
import askStyles from './AskPanel.module.css'
import styles from './AskInsertPicker.module.css'

/**
 * G-064 — choose where an Ask answer goes when no note is open (spec §3.3).
 *
 * Renders INSIDE the Ask panel (already a Sheet on touch), never as a second
 * modal. Picking a note hands the answer over (lib/askInsert.js) and opens the
 * note through the HOST's own `onOpenNote`; the note's editor appends it on
 * arrival (spec §5.2). "Create a new note" writes the answer as the new note's
 * body in one request.
 */
export default function AskInsertPicker({
  node, defaultTitle = '', onOpenNote, onCancel, search, createNote = createNoteViaApi,
}) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const listRef = useRef(null)
  const searchRef = useRef(null)
  if (!searchRef.current) searchRef.current = search || makeNoteSearch()

  useEffect(() => {
    const query = q.trim()
    if (!query) { setItems([]); setLoading(false); return undefined }
    let live = true
    setLoading(true)
    Promise.resolve(searchRef.current(query))
      .then((notes) => { if (live) { setItems(notes || []); setLoading(false) } })
      .catch(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [q])

  const choose = (note) => {
    if (!note?.id || busy) return
    writePendingAskInsert(note.id, node)
    onOpenNote?.(note)
  }

  const createNew = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const title = (q.trim() || defaultTitle || 'Ask Notebook answer').slice(0, 80)
      const created = await createNote({ title, bodyJson: { type: 'doc', content: [node] } })
      onOpenNote?.(created)
    } catch (e) {
      console.error('[AskInsertPicker] create failed', e)
      setError("Couldn't create the note. Your answer is still here.")
      setBusy(false)
    }
  }

  const typed = q.trim()
  return (
    <div className={styles.picker} data-testid="ask-insert-picker">
      <label className={askStyles.srOnly} htmlFor="ask-insert-search">Find a note to insert into</label>
      <input
        id="ask-insert-search"
        className={styles.search}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { onCancel?.(); return }
          if (listRef.current?.onKeyDown({ event: e })) e.preventDefault()
        }}
        placeholder="Search your notes…"
        autoComplete="off"
      />
      <button type="button" className={styles.row} onClick={createNew} disabled={busy}>
        <UIcon name="plus" size={12} gold={false} style={{ verticalAlign: '-2px', marginRight: 5 }} />
        {typed ? `Create a new note titled "${typed}"` : 'Create a new note'}
      </button>
      {typed && (
        <NoteLinkList
          ref={listRef}
          items={items}
          loading={loading}
          command={choose}
          menuId="ask-insert-picker-list"
          ariaLabel="Insert into a note"
        />
      )}
      {error && <div className={styles.error} role="alert">{error}</div>}
      <button type="button" className={styles.row} onClick={onCancel}>Cancel</button>
    </div>
  )
}
```

`app/src/pages/journal-2-0/components/notebook/AskInsertPicker.module.css`:

```css
/* G-064 — the inline picker inside the Ask panel. */
.picker { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.search {
  width: 100%;
  padding: 6px 8px;
  font-size: 13px;
  color: inherit;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.row {
  text-align: left;
  padding: 6px 8px;
  font-size: 12px;
  color: inherit;
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
}
.row:hover { background: var(--bg-surface); }
.row:disabled { opacity: 0.6; cursor: default; }
.error { font-size: 12px; }
/* Touch tier is <=1024px (canonical breakpoint, breakpoints.css). 16px input
   stops iOS zooming the page on focus. */
@media (max-width: 1024px) {
  .search { font-size: 16px; min-height: var(--tap-min, 44px); }
  .row { min-height: var(--tap-min, 44px); }
}
```

- [ ] **Step 8: Run the picker tests**

Same command as Step 6. Expected: PASS, exit 0.

- [ ] **Step 9: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k
git add app/src/pages/journal-2-0/components/notebook/NoteLinkMenu.jsx app/src/pages/journal-2-0/components/notebook/NoteLinkMenu.search.test.js app/src/pages/journal-2-0/components/notebook/AskInsertPicker.jsx app/src/pages/journal-2-0/components/notebook/AskInsertPicker.module.css app/src/pages/journal-2-0/components/notebook/AskInsertPicker.test.jsx
python tools/check_repo_hygiene.py --staged
git commit -F - <<'MSG'
feat(notebook): one note search; inline Ask insert picker

G-064 spec §3.3. The [[ menu's search is extracted as makeNoteSearch
(same body, same supersede rule) so the picker cannot grow a second one.
AskInsertPicker renders inside the Ask panel: search, pick (hand-off +
the host's own onOpenNote), or create a new note with the answer as its
body. Failure is a sentence, never a raw error.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HiiyhLP3J7WbX1wf3XLeQ6
MSG
```

---

### Task 9: The Insert button in AskPanel (spec §3.1, §5.2)

**Files:**
- Modify: `app/src/pages/journal-2-0/components/notebook/AskPanel.jsx`
- Modify: `app/src/pages/journal-2-0/components/notebook/AskPanel.module.css` (append)
- Create: `app/src/pages/journal-2-0/components/notebook/AskPanel.insert.test.jsx`

**Interfaces:**
- Consumes:
  - `notebookFlag` (Task 3)
  - `buildAskInsertNode` (Task 6)
  - `AskInsertPicker` (Task 8)
- Produces two new AskPanel props:
  - `onInsert?: (node) => boolean`, meaning "insert into the open note"; returns
    `true` when inserted.
  - `onOpenNote?: (note) => void`, meaning "open this note". Its presence enables
    the picker.

- [ ] **Step 1: Failing tests**

Create `app/src/pages/journal-2-0/components/notebook/AskPanel.insert.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AskPanel from './AskPanel'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

function sse(events) {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ev of events) c.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`))
      c.close()
    },
  })
}
const SOURCE = {
  n: 1, type: 'note', label: 'NVDA thesis', citation: 'exact', snippet: 's',
  navigation: { kind: 'note', note_id: 'n1' }, location: {}, payload: {}, stance: null, truncated: false,
}
const head = (sources = [SOURCE]) => ({ type: 'sources', scope: 'note', scopeLabel: 'This note', sources, coverageNotice: null })

async function ask(props, events = [head(), { type: 'final', answer: 'Margins fell [1].' }]) {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), body: sse(events) })
  render(<AskPanel scope="note" target="n1" autoOpen {...props} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'margins?' } })
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
  await screen.findByTestId('ask-answer')
}

beforeEach(() => {
  vi.restoreAllMocks()
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_ask_insert_on: true })
})

describe('Insert is offered only when it is honest to', () => {
  it('flag off → no Insert', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_ask_insert_on: false })
    await ask({ onInsert: vi.fn() })
    expect(screen.queryByRole('button', { name: /Insert/ })).toBeNull()
  })

  it('flag never latched → no Insert', async () => {
    __resetNotebookFlags()
    await ask({ onInsert: vi.fn() })
    expect(screen.queryByRole('button', { name: /Insert/ })).toBeNull()
  })

  it('an answer with no citations → no Insert', async () => {
    await ask({ onInsert: vi.fn() }, [head(), { type: 'final', answer: 'I could not find that.' }])
    expect(screen.queryByRole('button', { name: /Insert/ })).toBeNull()
  })

  it('an error → no Insert', async () => {
    await ask({ onInsert: vi.fn() }, [head(), { type: 'delta', text: 'Margins [1]' }, { type: 'error', detail: 'boom' }])
    expect(screen.queryByRole('button', { name: /Insert/ })).toBeNull()
  })

  it('no host way to insert → no Insert', async () => {
    await ask({})
    expect(screen.queryByRole('button', { name: /Insert/ })).toBeNull()
  })
})

describe('inserting into the open note', () => {
  it('hands the host the block built from what was shown, then reads "Inserted"', async () => {
    const onInsert = vi.fn(() => true)
    await ask({ onInsert })
    fireEvent.click(screen.getByRole('button', { name: 'Insert into this note' }))
    const node = onInsert.mock.calls[0][0]
    expect(node.type).toBe('askInsert')
    expect(node.attrs.question).toBe('margins?')
    expect(node.attrs.scope).toBe('note')
    expect(node.content[0].content[1]).toMatchObject({ type: 'askCitation', attrs: { n: 1, label: 'NVDA thesis' } })
    expect(screen.getByRole('button', { name: 'Inserted' })).toBeDisabled()
  })

  it('a refused insert leaves the button as it was', async () => {
    await ask({ onInsert: vi.fn(() => false) })
    fireEvent.click(screen.getByRole('button', { name: 'Insert into this note' }))
    expect(screen.getByRole('button', { name: 'Insert into this note' })).toBeEnabled()
  })
})

describe('inserting when no note is open', () => {
  it('opens the picker', async () => {
    await ask({ onOpenNote: vi.fn() })
    fireEvent.click(screen.getByRole('button', { name: 'Insert into a note…' }))
    expect(screen.getByTestId('ask-insert-picker')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k/app
npx vitest run src/pages/journal-2-0/components/notebook/AskPanel.insert.test.jsx --maxWorkers=2 > /tmp/g064.log 2>&1; code=$?; tail -20 /tmp/g064.log; exit $code
```

Expected: FAIL on the "hands the host…", "refused" and "opens the picker" tests
(no button). The "no Insert" tests pass vacuously for now. Step 7's mutation proof
is what shows they can fail.

- [ ] **Step 3: Wire AskPanel**

In `AskPanel.jsx`:

1. Add imports after the existing `askCitation` import block:

```js
import { buildAskInsertNode } from '../../lib/askInsert'
import { notebookFlag } from '../../lib/offline/notebookFlags'
import AskInsertPicker from './AskInsertPicker'
```

2. Extend the props:

```js
export default function AskPanel({
  scope = 'notebook',
  target = null,
  // Note scope only: the LIVE ProseMirror doc, so a citation is verified
  // against what the member can actually see, unsaved edits included.
  getEditorDoc = null,
  onNavigate = null,
  autoOpen = false,
  onClose = null,
  // G-064 (spec §5.2). `onInsert(node) -> boolean` inserts into the note that
  // is OPEN; `onOpenNote(note)` opens a note, which enables the picker when
  // none is. A host passes whichever it can honour.
  onInsert = null,
  onOpenNote = null,
}) {
```

3. Add state after `const [errorMsg, setErrorMsg] = useState('')`:

```js
  // G-064: which answer text was already inserted (so one answer cannot be
  // inserted twice), and the block the picker is placing.
  const [insertedAnswer, setInsertedAnswer] = useState(null)
  const [pickNode, setPickNode] = useState(null)
```

4. In the scope-reset effect, add
   `setInsertedAnswer(null); setPickNode(null)` to the reset line. In `ask()`, add
   `setInsertedAnswer(null); setPickNode(null)` next to `setCoverageNotice(null); setErrorMsg('')`.

5. After the `cited` memo, add:

```js
  // G-064 (spec §3.1): offered only for a finished, CITED answer, with the flag
  // latched on and a host that can actually place it. `null` (never latched)
  // is OFF.
  const insertAllowed = notebookFlag('notebook_ask_insert_on') === true
    && status === 'done' && cited.length > 0 && Boolean(onInsert || onOpenNote)

  const buildNode = () => buildAskInsertNode({
    answer, sources, scope,
    // The question that produced THIS answer, never the live input box.
    question: historyRef.current[historyRef.current.length - 1]?.q || '',
  })

  const handleInsert = () => {
    const node = buildNode()
    if (!node) return
    if (onInsert) {
      if (onInsert(node) === true) setInsertedAnswer(answer)
      return
    }
    setPickNode(node)
  }
```

6. In the JSX, directly after the `{cited.length > 0 && ( … )}` Sources block and
   before `</PanelShell>`, add:

```jsx
          {insertAllowed && !pickNode && (
            <div className={styles.insertRow}>
              <button
                type="button"
                className={styles.insertBtn}
                onClick={handleInsert}
                disabled={insertedAnswer === answer}
              >
                <UIcon name="plus" size={12} gold={false} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                {insertedAnswer === answer ? 'Inserted' : onInsert ? 'Insert into this note' : 'Insert into a note…'}
              </button>
            </div>
          )}
          {insertAllowed && pickNode && (
            <AskInsertPicker
              node={pickNode}
              defaultTitle={(pickNode.attrs.question || '').slice(0, 80)}
              onOpenNote={onOpenNote}
              onCancel={() => setPickNode(null)}
            />
          )}
```

7. Append to `AskPanel.module.css`:

```css
/* G-064 — Insert an answer into a note. */
.insertRow { display: flex; margin-top: 10px; }
.insertBtn {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  font-size: 12px;
  color: inherit;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
}
.insertBtn:disabled { opacity: 0.6; cursor: default; }
@media (max-width: 1024px) {
  .insertBtn { min-height: var(--tap-min, 44px); }
}
```

- [ ] **Step 4: Run the new tests and every existing AskPanel suite**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k/app
npx vitest run src/pages/journal-2-0/components/notebook/AskPanel.insert.test.jsx src/pages/journal-2-0/components/notebook/AskPanel.test.jsx src/pages/journal-2-0/components/notebook/AskCitationContract.closed.test.jsx --maxWorkers=2 > /tmp/g064.log 2>&1; code=$?; tail -15 /tmp/g064.log; exit $code
```

Expected: PASS, exit 0.

- [ ] **Step 5: Mutation proof for the gating**

Save the bytes. Change `=== true` in `insertAllowed` to `!== false`, then re-run
Step 4. Expected: FAIL on `flag never latched → no Insert`. Change it back and
re-run. Expected: PASS.

Then change `cited.length > 0` to `true`. Expected: FAIL on
`an answer with no citations → no Insert`. Restore the saved bytes and re-run.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k
git add app/src/pages/journal-2-0/components/notebook/AskPanel.jsx app/src/pages/journal-2-0/components/notebook/AskPanel.module.css app/src/pages/journal-2-0/components/notebook/AskPanel.insert.test.jsx
python tools/check_repo_hygiene.py --staged
git commit -F - <<'MSG'
feat(notebook): Ask panel Insert -- into this note, or pick one

G-064 spec §3.1, §5.2. Offered only for a finished answer that cites a
real source, with notebook_ask_insert_on latched true and a host that can
place it. onInsert inserts into the open note (then "Inserted"); without
it, onOpenNote opens the inline picker. The block is built from exactly
what the panel showed, with the question that produced it.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HiiyhLP3J7WbX1wf3XLeQ6
MSG
```

---

### Task 10: Wire the hosts (spec §3.2, §3.3, §5.2)

**Files:**
- Create: `app/src/pages/journal-2-0/hooks/usePendingAskInsert.js` + `usePendingAskInsert.test.jsx`
- Modify: `app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx`
- Create: `app/src/pages/journal-2-0/components/notebook/NoteEditorPage.askInsert.test.jsx`
- Modify: `app/src/pages/journal-2-0/components/notebook/DocumentPreviewSheet.jsx`
- Modify: `app/src/pages/journal-2-0/components/notebook/ResearchHome.jsx`
- Modify: `app/src/pages/journal-2-0/components/notebook/TickerResearchWorkspace.jsx`
- Test (append): `ResearchHome.test.jsx`, `TickerResearchWorkspace.test.jsx`, `DocumentPreviewSheet.test.jsx`

**Interfaces:**
- Consumes: `appendAskInsert`, `takePendingAskInsert` (Tasks 6–7); AskPanel's
  `onInsert` and `onOpenNote` (Task 9).
- Produces: `usePendingAskInsert({ noteId, editor, ready, onResult })`.

- [ ] **Step 1: Failing hook tests**

Create `app/src/pages/journal-2-0/hooks/usePendingAskInsert.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StrictMode } from 'react'
import { renderHook } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { AskInsert } from '../lib/askInsertNode'
import { AskCitation } from '../lib/askCitationNode'
import { clearPendingAskInsert, takePendingAskInsert, writePendingAskInsert } from '../lib/askInsert'
import usePendingAskInsert from './usePendingAskInsert'

const NODE = {
  type: 'askInsert', attrs: { insertedAt: '2026-09-22T12:00:00.000Z', scope: 'notebook', question: 'q' },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Answer.' }] }],
}
let editor
function mk() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({
    element: el,
    extensions: [StarterKit, AskInsert, AskCitation],
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Mine.' }] }] },
  })
  return editor
}
const inserts = (ed) => { let n = 0; ed.state.doc.forEach((c) => { if (c.type.name === 'askInsert') n += 1 }); return n }

beforeEach(() => { clearPendingAskInsert(); sessionStorage.clear() })
afterEach(() => { editor?.destroy(); editor = null })

describe('usePendingAskInsert', () => {
  it('waits for ready, then inserts once', () => {
    const ed = mk()
    writePendingAskInsert('n1', NODE)
    const onResult = vi.fn()
    const { rerender } = renderHook((p) => usePendingAskInsert(p), {
      initialProps: { noteId: 'n1', editor: ed, ready: false, onResult },
    })
    expect(inserts(ed)).toBe(0)
    rerender({ noteId: 'n1', editor: ed, ready: true, onResult })
    expect(inserts(ed)).toBe(1)
    expect(onResult).toHaveBeenCalledWith(true)
  })

  it('StrictMode double effects insert exactly once', () => {
    const ed = mk()
    writePendingAskInsert('n1', NODE)
    renderHook(() => usePendingAskInsert({ noteId: 'n1', editor: ed, ready: true }), { wrapper: StrictMode })
    expect(inserts(ed)).toBe(1)
  })

  it("another note's answer is left for that note", () => {
    const ed = mk()
    writePendingAskInsert('n2', NODE)
    renderHook(() => usePendingAskInsert({ noteId: 'n1', editor: ed, ready: true }))
    expect(inserts(ed)).toBe(0)
    expect(takePendingAskInsert('n2')?.noteId).toBe('n2')
  })

  it('a read-only editor reports failure and the entry is spent', () => {
    const ed = mk()
    ed.setEditable(false)
    writePendingAskInsert('n1', NODE)
    const onResult = vi.fn()
    renderHook(() => usePendingAskInsert({ noteId: 'n1', editor: ed, ready: true, onResult }))
    expect(onResult).toHaveBeenCalledWith(false)
    expect(takePendingAskInsert('n1')).toBeNull()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k/app
npx vitest run src/pages/journal-2-0/hooks/usePendingAskInsert.test.jsx --maxWorkers=2 > /tmp/g064.log 2>&1; code=$?; tail -15 /tmp/g064.log; exit $code
```

Expected: FAIL. The module does not exist yet.

- [ ] **Step 3: Implement the hook**

`app/src/pages/journal-2-0/hooks/usePendingAskInsert.js`:

```js
import { useEffect } from 'react'
import { appendAskInsert, takePendingAskInsert } from '../lib/askInsert'

/**
 * G-064 — consume an Ask Notebook answer that was picked for THIS note on
 * another page (spec §5.2), once the note is ready to take it.
 *
 * `ready` is the caller's whole gate: the note is hydrated in the editor, the
 * async draft-recovery decision has settled, and no recovered draft is pending
 * (a restore calls setContent and would erase the insert).
 *
 * ⛔ TAKE — and so REMOVE — BEFORE inserting: a StrictMode double effect or a
 * reload must never insert the same answer twice.
 */
export default function usePendingAskInsert({ noteId, editor, ready, onResult }) {
  useEffect(() => {
    if (!ready || !noteId || !editor || editor.isDestroyed) return
    const entry = takePendingAskInsert(noteId)
    if (!entry) return
    onResult?.(appendAskInsert(editor, entry.node))
  }, [noteId, editor, ready]) // eslint-disable-line react-hooks/exhaustive-deps
}
```

Run Step 2's command again. Expected: PASS.

- [ ] **Step 4: Mutation proof for remove-before-insert**

Save the bytes. Change the hook body to peek, insert, then clear. Replace the
`takePendingAskInsert` line and the following `if (!entry) return` with:

```js
    const peek = JSON.parse(sessionStorage.getItem('uct.j2.askInsert.pending') || 'null')
    if (!peek || peek.noteId !== noteId) return
    const entry = peek
    appendAskInsert(editor, entry.node)
    takePendingAskInsert(noteId)
    return
```

Re-run Step 2. Expected: FAIL on `StrictMode double effects insert exactly once`
(2 inserts). Restore the saved bytes and re-run. Expected: PASS.

- [ ] **Step 5: Failing NoteEditorPage wiring test**

Create `app/src/pages/journal-2-0/components/notebook/NoteEditorPage.askInsert.test.jsx`:

```jsx
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { clearPendingAskInsert, takePendingAskInsert, writePendingAskInsert } from '../../lib/askInsert'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

// G-064 — the real editor mount, same convention as NoteEditorPage.noteLinks.test.jsx.
// A component test that mocks the editor could not see a severed wire.

const NOTE = {
  id: 'n1', title: 'Original Title', subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z',
  isFavorite: false,
  bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'My own view.' }] }] },
}
const NODE = {
  type: 'askInsert', attrs: { insertedAt: '2026-09-22T12:00:00.000Z', scope: 'notebook', question: 'q' },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Inserted answer text.' }] }],
}

vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: vi.fn(async () => NOTE), refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

function sse(events) {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ev of events) c.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`))
      c.close()
    },
  })
}

beforeEach(() => {
  clearPendingAskInsert()
  sessionStorage.clear()
  __resetNotebookFlags()
  global.fetch = vi.fn((url) => {
    if (typeof url === 'string' && url.includes('/api/j2/ask/stream')) {
      return Promise.resolve({
        ok: true, status: 200, json: async () => ({}),
        body: sse([
          { type: 'sources', scope: 'note', scopeLabel: 'This note', coverageNotice: null, sources: [{
            n: 1, type: 'note', label: 'Other note', citation: 'exact', snippet: 's',
            navigation: { kind: 'note', note_id: 'n9' }, location: {}, payload: {}, stance: null, truncated: false,
          }] },
          { type: 'final', answer: 'Margins fell [1].' },
        ]),
      })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
})
afterEach(() => vi.clearAllMocks())

async function renderEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
}

describe('NoteEditorPage — G-064 Ask insert', () => {
  it('an answer picked for this note elsewhere lands at the end of it', async () => {
    writePendingAskInsert('n1', NODE)
    await renderEditor()
    await waitFor(() => expect(screen.getByText('Inserted answer text.')).toBeInTheDocument())
    expect(screen.getByText('From Ask Notebook')).toBeInTheDocument()
    expect(await screen.findByText('Answer inserted at the end of this note.')).toBeInTheDocument()
    expect(takePendingAskInsert('n1')).toBeNull()
  })

  it("another note's pending answer is not inserted here", async () => {
    writePendingAskInsert('n2', NODE)
    await renderEditor()
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText('Inserted answer text.')).toBeNull()
    expect(takePendingAskInsert('n2')?.noteId).toBe('n2')
  })

  it('"Insert into this note" appends the answer from the note\'s own Ask panel', async () => {
    latchNotebookFlags({ notebook_ask_insert_on: true })
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Ask a question about this note' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ask This note' })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'margins?' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ask' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Insert into this note' }))
    await waitFor(() => expect(screen.getByText('From Ask Notebook')).toBeInTheDocument())
    expect(within(dialog).getByRole('button', { name: 'Inserted' })).toBeDisabled()
  })
})
```

- [ ] **Step 6: Run and watch it fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k/app
npx vitest run src/pages/journal-2-0/components/notebook/NoteEditorPage.askInsert.test.jsx --maxWorkers=2 > /tmp/g064.log 2>&1; code=$?; tail -25 /tmp/g064.log; exit $code
```

Expected: FAIL on the first test (nothing consumes the entry) and the third (no
`onInsert`, so no Insert button). The second passes vacuously; Step 4's mutation
proof covers that rule.

- [ ] **Step 7: Wire NoteEditorPage**

In `NoteEditorPage.jsx`:

1. Imports, next to the other `../../lib/` imports:

```js
import { appendAskInsert } from '../../lib/askInsert'
import usePendingAskInsert from '../../hooks/usePendingAskInsert'
```

2. State, directly after `const [recovery, setRecovery] = useState(null)` (~:640):

```js
  // G-064: the draft-recovery decision below is ASYNC. A pending Ask insert
  // must wait for it: a restore's setContent would erase the inserted answer.
  const [recoveryDecided, setRecoveryDecided] = useState(false)
```

3. In the recovery effect (the one starting `if (!note) return undefined` at
   ~:672): add `setRecoveryDecided(false)` as the first line after that guard.
   Inside `decide()`, add `setRecoveryDecided(true)` in two places:
   - in the `if (decision && decision.unsynced) {` branch, directly before its
     `return`;
   - as the last line of `decide()`, after `setRecovery(null)`.

   Both go after the existing `if (cancelled) return`, so a cancelled decision
   never sets it.

4. Directly **after** the `hydratedRef` arming effect (the
   `useEffect(() => { hydratedRef.current = … }, [note?.id, editor, note])` at
   ~:1418-1420), add:

```js
  // G-064 — insert an Ask Notebook answer into THIS note: an editor transaction
  // on the normal autosave path (spec §5.2). No endpoint, no settle, no door.
  const insertAskAnswer = useCallback((node) => {
    const ok = appendAskInsert(editorRef.current, node)
    if (ok) setUploadToast({ message: 'Answer inserted at the end of this note.', tone: 'success' })
    return ok
  }, [])

  // G-064 — an answer picked for this note on another page (spec §5.2).
  // ⛔ DECLARED AFTER the hydratedRef arming effect above: effects run in
  // declaration order, and inserting before hydration is the "document changed
  // without a person" class that effect exists to refuse.
  usePendingAskInsert({
    noteId,
    editor,
    ready: recoveryDecided && !pendingDraft && hydratedRef.current,
    onResult: (ok) => setUploadToast(ok
      ? { message: 'Answer inserted at the end of this note.', tone: 'success' }
      : { message: "This note can't take changes right now, so the answer wasn't inserted. Ask again to get it back.", tone: 'error' }),
  })
```

5. On the header `<AskPanel scope="note" …>` (~:2003), add this prop after
   `onNavigate={jumpToCitation}`:

```jsx
            onInsert={editor && editor.isEditable ? insertAskAnswer : null}
```

6. On `<DocumentPreviewSheet … />` (~:1886), add this prop after
   `documentId={previewDoc?.documentId}`:

```jsx
        onInsert={editor && editor.isEditable ? insertAskAnswer : null}
```

- [ ] **Step 8: Wire the other three hosts**

`DocumentPreviewSheet.jsx`: extend the props, and pass both to its `AskPanel`:

```jsx
export default function DocumentPreviewSheet({
  open, href, name, page, onClose,
  excerpts = [], onSaveExcerpt, emphasizeExcerptId,
  documentId = null,
  // G-064: inside a note, `onInsert` puts an answer into that note; in the
  // research workspace, `onOpenNote` enables the picker (spec §3.2-3.3).
  onInsert = null,
  onOpenNote = null,
}) {
```

```jsx
            <AskPanel
              scope="document"
              target={documentId}
              onNavigate={(source) => {
                const p = source?.navigation?.page_number
                if (p) viewerRef.current?.scrollToPage?.(p)
              }}
              onInsert={onInsert}
              onOpenNote={onOpenNote}
            />
```

`ResearchHome.jsx`: add the prop to its AskPanel:

```jsx
        <AskPanel scope="notebook" onOpenNote={openNote} onNavigate={(s) => {
          const id = s?.navigation?.note_id
          if (id) openNote({ id })
        }} />
```

`TickerResearchWorkspace.jsx`: on the AskPanel from Task 2, add
`onOpenNote={openNote}`. On its `<DocumentPreviewSheet … />` (~:266), add
`onOpenNote={openNote}`. Use the workspace's own `openNote` wrapper (:67), never the
raw `onOpenNote` prop, which is undefined when the workspace renders standalone.

- [ ] **Step 9: Host wiring tests**

Append to `ResearchHome.test.jsx`, adding `waitFor` and `within` to its
testing-library import if missing:

```jsx
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

describe('ResearchHome — G-064 insert from "My Notebook"', () => {
  it('offers "Insert into a note…" and opens the picker', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_ask_insert_on: true })
    const enc = new TextEncoder()
    const body = new ReadableStream({ start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'sources', scope: 'notebook', scopeLabel: 'My Notebook', coverageNotice: null, sources: [{ n: 1, type: 'note', label: 'NVDA thesis', citation: 'exact', snippet: 's', navigation: { kind: 'note', note_id: 'n1' }, location: {}, payload: {}, stance: null, truncated: false }] })}\n\n`))
      c.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'final', answer: 'Margins fell [1].' })}\n\n`))
      c.close()
    } })
    renderHome()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), body })
    fireEvent.click(screen.getByRole('button', { name: 'Ask a question about my notebook' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'margins?' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ask' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Insert into a note…' }))
    expect(within(dialog).getByTestId('ask-insert-picker')).toBeInTheDocument()
    __resetNotebookFlags()
  })
})
```

Append a twin to `TickerResearchWorkspace.test.jsx`, inside the
`describe('TickerResearchWorkspace — Ask citations', …)` block from Task 2 and
reusing its `sseBody` and `SOURCE`:

```jsx
  it('G-064: offers "Insert into a note…" in "This research"', async () => {
    const { __resetNotebookFlags, latchNotebookFlags } = await import('../../lib/offline/notebookFlags')
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_ask_insert_on: true })
    renderWorkspace()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({}),
      body: sseBody([
        { type: 'sources', scope: 'security', scopeLabel: 'NVDA research', sources: [SOURCE], coverageNotice: null },
        { type: 'final', answer: 'Margins fell [1].' },
      ]),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask a question about this research' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'margins?' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ask' }))
    expect(await within(dialog).findByRole('button', { name: 'Insert into a note…' })).toBeInTheDocument()
    __resetNotebookFlags()
  })
```

Append to `DocumentPreviewSheet.test.jsx`, adding `within` to its import:

```jsx
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

describe('DocumentPreviewSheet — G-064 insert into the note behind the sheet', () => {
  it('passes onInsert through to its Ask panel', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_ask_insert_on: true })
    const enc = new TextEncoder()
    const body = new ReadableStream({ start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'sources', scope: 'document', scopeLabel: 'This document', coverageNotice: null, sources: [{ n: 1, type: 'document_page', label: 'report.pdf p.3', citation: 'page_only', snippet: 's', navigation: { kind: 'document', document_id: 'd1', page_number: 3 }, location: {}, payload: {}, stance: null, truncated: false }] })}\n\n`))
      c.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'final', answer: 'Revenue grew [1].' })}\n\n`))
      c.close()
    } })
    const onInsert = vi.fn(() => true)
    render(<DocumentPreviewSheet open href={HREF} name="report.pdf" onClose={vi.fn()} documentId="d1" onInsert={onInsert} />)
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), body })
    fireEvent.click(screen.getByRole('button', { name: 'Ask a question about this document' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ask This document' })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'revenue?' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ask' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Insert into this note' }))
    expect(onInsert).toHaveBeenCalledTimes(1)
    expect(onInsert.mock.calls[0][0].type).toBe('askInsert')
    __resetNotebookFlags()
  })
})
```

- [ ] **Step 10: Run all host suites**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k/app
npx vitest run src/pages/journal-2-0/hooks/usePendingAskInsert.test.jsx src/pages/journal-2-0/components/notebook/NoteEditorPage.askInsert.test.jsx src/pages/journal-2-0/components/notebook/ResearchHome.test.jsx src/pages/journal-2-0/components/notebook/TickerResearchWorkspace.test.jsx src/pages/journal-2-0/components/notebook/DocumentPreviewSheet.test.jsx --maxWorkers=2 > /tmp/g064.log 2>&1; code=$?; tail -20 /tmp/g064.log; exit $code
```

Expected: PASS, exit 0. If the first NoteEditorPage test times out waiting for the
insert, check that `recoveryDecided` flips in this harness. `decide()` must settle
even with no IndexedDB, because `recover` throws and `decision = null`. Add a
temporary `console.log` in `decide()` to check. Never raise a timeout to paper over
the wait.

- [ ] **Step 11: Run the NoteEditorPage regression suites**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k/app
npx vitest run src/pages/journal-2-0/components/notebook/NoteEditorPage.draft.test.jsx src/pages/journal-2-0/components/notebook/NoteEditorPage.durable.test.jsx src/pages/journal-2-0/components/notebook/NoteEditorPage.slowload.test.jsx src/pages/journal-2-0/components/notebook/NoteEditorPage.conflict.test.jsx src/pages/journal-2-0/components/notebook/NoteEditorPage.excerpts.test.jsx src/pages/journal-2-0/components/notebook/NoteEditorPage.rails.test.jsx --maxWorkers=2 > /tmp/g064.log 2>&1; code=$?; tail -20 /tmp/g064.log; exit $code
```

Expected: PASS, exit 0.

- [ ] **Step 12: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k
git add app/src/pages/journal-2-0/hooks/usePendingAskInsert.js app/src/pages/journal-2-0/hooks/usePendingAskInsert.test.jsx app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx app/src/pages/journal-2-0/components/notebook/NoteEditorPage.askInsert.test.jsx app/src/pages/journal-2-0/components/notebook/DocumentPreviewSheet.jsx app/src/pages/journal-2-0/components/notebook/DocumentPreviewSheet.test.jsx app/src/pages/journal-2-0/components/notebook/ResearchHome.jsx app/src/pages/journal-2-0/components/notebook/ResearchHome.test.jsx app/src/pages/journal-2-0/components/notebook/TickerResearchWorkspace.jsx app/src/pages/journal-2-0/components/notebook/TickerResearchWorkspace.test.jsx
python tools/check_repo_hygiene.py --staged
git commit -F - <<'MSG'
feat(notebook): wire Ask insert into every host (G-064, dark)

G-064 spec §3.2-3.3, §5.2.
- NoteEditorPage passes onInsert to its own Ask and to the document sheet
  behind it.
- It consumes a pending answer through usePendingAskInsert, gated on
  hydration, the async draft-recovery decision (new recoveryDecided
  state) and no pending draft.
- Research Home and the ticker research workspace pass their own
  openNote, which enables the picker.
- Real-editor mount test proves the wire end to end.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HiiyhLP3J7WbX1wf3XLeQ6
MSG
```

---

### Task 11: Reconcile the docs (spec §10.3)

**Files:**
- Modify: `docs/notebook/RESUME-HERE-2026-09-20.md`
- Modify: `docs/notebook/competitive-gap-ledger.md` (rows G-040 :96, G-064 :120, G-083 :141)

**R-CITE rule for this task:** before each correction, read the cited code lines
yourself. If the code does not say what the correction claims, **do not make that
edit**. Record `not verified` in the commit message instead.

- [ ] **Step 1: Verify the three facts**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k
sed -n '2028,2040p' app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx
sed -n '355,370p' app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx
grep -n "scanner" app/src/widgets/registry.js | head -5
```

Expected:
- a History button in the first range;
- an offline banner or `OFFLINE_VIEWING_BANNER` in the second (line numbers shift
  after Task 10; search for `OFFLINE_VIEWING_BANNER` if needed);
- a `scanner` entry with `journal: false` in the widget registry.

- [ ] **Step 2: RESUME-HERE corrections**

In `docs/notebook/RESUME-HERE-2026-09-20.md`, directly under the heading
`## 🎯 2026-09-22 SESSION (later) — ledger status pass, 5 owner decisions, G-064 design`,
insert:

```markdown
> ⚰️ **Corrected 2026-09-22 (G-064 build session), three sentences below were wrong:**
> - **G-053 is not "already honored".** No Compass chat tool reads `j2_notes`
>   (`coach_chat_tools.py` touches only `j2_trades.notes`), and Ask Notebook is its
>   own panel. It is an **owner decision**, not a closed constraint.
> - **The G-064 spec commit `39bc8fa2c` IS pushed.** It is on `origin/master`. The
>   spec is now at revision 2; see the plan
>   `docs/superpowers/plans/2026-09-22-ask-notebook-insert.md`.
> - **G-002's version-history UI exists.** There is a History button in
>   `NoteEditorPage.jsx` and routes in `journal_two.py`. "The member-facing UI
>   doesn't" was false.
```

- [ ] **Step 3: Ledger corrections**

In `docs/notebook/competitive-gap-ledger.md`:
- **G-083 row:** append to the end of its long status cell, before the next `|`:
  ` ⚰️ **Corrected 2026-09-22:** an offline signal now renders (`OFFLINE_VIEWING_BANNER`, `NoteEditorPage.jsx`); the "no you're-offline signal" sentence above is stale.`
- **G-040 row:** after `Screener — no entry`, insert:
  ` (⚰️ corrected 2026-09-22: a `scanner` registry entry exists with `journal: false` — the door is explicitly closed, not absent)`
- **G-064 row:** replace its STATUS cell `**PARTIAL — 1 of 2 done**` with:
  `**BUILT, DARK — 2 of 2** (AI-synthesis insert: spec r2 + plan 2026-09-22; flag NOTEBOOK_ASK_INSERT_ON, unset = OFF; activation is an owner call)`

Edit as text with the Edit tool. These are long pipe-table rows, so change only the
named cells.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k
git add docs/notebook/RESUME-HERE-2026-09-20.md docs/notebook/competitive-gap-ledger.md
python tools/check_repo_hygiene.py --staged
git commit -F - <<'MSG'
docs(notebook): reconcile resume doc + ledger with the code (G-064 wave)

G-053 is an owner decision, not "already honored"; the G-064 spec commit
is on master; G-002's version-history UI exists; G-083's offline signal
now renders; G-040's Screener has an explicitly-closed registry entry;
G-064 is built and dark behind NOTEBOOK_ASK_INSERT_ON.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HiiyhLP3J7WbX1wf3XLeQ6
MSG
```

---

### Task 12: Verify — rails, gate, live browser (spec §11)

**Files:** none changed, unless a step finds a defect. A defect goes back to its
task. Gate manifests are written to `docs/notebook/gate-runs/g064/` by the gate
tool.

- [ ] **Step 1: The repo-wide rails, alone**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k/app
npx vitest run src/components/screener/reachable.test.js src/styles/tapFloor.test.js src/styles/tokens.reachable.test.js src/styles/themeIslands.test.js src/__tests__/sourcesAreText.test.js src/pages/journal-2-0/rawErrorSurface.test.js src/pages/journal-2-0/lib/offline/f5Freeze.test.js src/pages/journal-2-0/lib/offline/doorEnumeration.test.js --maxWorkers=1 > /c/Users/Patrick/AppData/Local/Temp/claude/C--Users-Patrick/e5af7430-5c97-49c2-9846-4da28941d38c/scratchpad/g064/after-rails.txt 2>&1; code=$?; tail -12 /c/Users/Patrick/AppData/Local/Temp/claude/C--Users-Patrick/e5af7430-5c97-49c2-9846-4da28941d38c/scratchpad/g064/after-rails.txt; exit $code
```

Compare `reachable.test.js` and `tapFloor.test.js` failures against Task 0's
`baseline-rails.txt`. **Pass condition:**
- no module or element name appears in `after-rails.txt` that was absent from the
  baseline;
- every other listed file passes;
- `f5Freeze` and `doorEnumeration` pass unchanged. This proves no frozen door was
  touched.

A new unreachable module means a file was created but never imported; fix the
import.

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k
python -m pytest tests/test_no_shadowed_definitions.py tests/test_feature_flag_ledger.py tests/test_visibility_flag_ledger.py -q > /tmp/g064.log 2>&1; code=$?; tail -8 /tmp/g064.log; exit $code
```

Expected: PASS, exit 0.

- [ ] **Step 2: Every G-064 backend file together**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k
python -m pytest tests/test_note_citation_text.py tests/test_ask_insert_exclusion.py tests/test_ask_note_scope.py tests/test_ask_retrieval.py tests/test_notebook_flags.py tests/test_feature_flag_ledger.py tests/test_notebook_flag_table_form.py tests/test_hub_preview_flag.py api/services/journal_two/test_notes_export.py api/services/journal_two/test_note_shares.py api/services/journal_two/test_notes.py tests/test_journal_two_share_router.py -q > /tmp/g064.log 2>&1; code=$?; tail -8 /tmp/g064.log; exit $code
```

Expected: PASS, exit 0.

- [ ] **Step 3: Bring master in, then run the six-shard gate**

Master had moved one commit, `ecdfef01e` (Screener), at planning time. Merge; do
not rebase:

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k
git fetch origin master
git merge --no-edit origin/master
git status --porcelain | head
```

Expected: a clean merge and a clean tree. If there is any conflict, stop and
report it. Do not resolve a conflict in a file this plan did not touch.

Check the box before gating. At least 8 GB must be available and no other gate may
be running:

```powershell
(Get-Counter '\Memory\Available MBytes').CounterSamples[0].CookedValue
Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -match 'gate_shards' } | Select-Object ProcessId, CommandLine
```

Run the gate in the background:

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k
python scripts/gate_shards.py --shards 6 --max-workers 2 --out docs/notebook/gate-runs/g064
```

Read the manifest it writes, including its totals, its file-count reconciliation and
its own `GATE EXIT:` line. The background task's exit status is uninformative in
both directions.
- **Exit 0:** no new failures against `gate-baseline.json`.
- **Exit 1:** for each new failure, re-run that test file alone on a detached
  checkout of `origin/master`:
  `git worktree add --detach ../notebook-k-mastercheck origin/master`, run it, then
  `git worktree remove ../notebook-k-mastercheck`. This session created that
  worktree, so removing it is allowed. A failure that also fails on master is not
  ours: record it. A failure that passes on master is ours: fix it in its task.
- **Exit 2/3/5:** the run is INVALID or unreconciled. Read the manifest; never merge
  on one.

- [ ] **Step 4: Live browser verification (local sandbox, never production)**

Build and boot on a private data dir and port. Port 8077 belongs to the hub sandbox.

```powershell
cd C:\Users\Patrick\uct-worktrees\notebook-k\app; npm run build
cd C:\Users\Patrick\uct-worktrees\notebook-k
$env:NOTEBOOK_ASK_INSERT_ON = '1'
python scripts/hub_sandbox_boot.py --data-dir 'C:\data-g064' --port 8093 --test-email 'g064@local.dev'
```

The launcher prints a snapshot-compare result first. It must read CLEAN. Sign in
as `g064@local.dev` (sign up first via `POST /api/auth/signup` if needed; the
launcher's `ADMIN_EMAILS` makes it admin). Use the claude-in-chrome tools in a new
tab, and record a GIF named `g064_ask_insert.gif`. Walk:

1. Create a note, "Margins", with two paragraphs of text mentioning margins.
2. In the note, open Ask → ask "what did I say about margins?"
   → **Insert into this note**. The block with "From Ask Notebook" appears at the
   end, and the button reads "Inserted".
3. Reload. The block and the `[n]` chips are still there. Click a chip: the cited
   note opens.
4. Edit the inserted paragraph's text. That paragraph's chips read `[n · edited]`.
5. Research Home → Ask → **Insert into a note…** → search "Margins" → pick it. The
   note opens with a second block at the end, and the toast reads "Answer inserted
   at the end of this note."
6. Research Home → Ask → Insert → **Create a new note**. A new note opens holding
   the block.
7. Export the note as Markdown. The file contains
   `> **From Ask Notebook** · … · Q: …` and a `Sources as of insertion:` line.
8. Import or paste a Notion callout and a toggle (`<aside>tip</aside>` pasted into a
   note works). The callout body lays out beside its icon, and at 390px width the
   toggle chevron is 44×44 (`getBoundingClientRect` from the console).

If the sandbox's Ask stream cannot reach a model, record step 2 as
`INCONCLUSIVE (no model in sandbox)`. Then verify steps 3–4 and 7 on a note whose
body is `PUT` with an `askInsert` JSON block
(`PUT /api/j2/notes/{id}` with `{"bodyJson": …}`). The click path is covered by
`NoteEditorPage.askInsert.test.jsx`. Stop the server, then confirm the launcher's
final snapshot-compare line reads CLEAN.

- [ ] **Step 5: Record the verification**

Append a short `## G-064 build verification — <date>` section to the top of
`docs/notebook/RESUME-HERE-2026-09-20.md` (above the Task 11 note). It lists:
- the gate manifest path and its `GATE EXIT`;
- the rails result against the baseline;
- each live step as PASS, FAIL or INCONCLUSIVE, with the GIF name;
- the branch head SHA.

Commit it with the same heredoc form.

---

### Task 13: Hand-off — push the branch and open the PR (no deploy)

**Why this stops short of production:** master is production. Merging needs the
owner's explicit "deploy" plus a member-impact paragraph, and the owner merges.

- [ ] **Step 1: Push the branch (never master)**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k
git push origin feat/notebook-kill-switch
git log --oneline origin/feat/notebook-kill-switch -1
```

- [ ] **Step 2: Open the PR**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k
gh pr create --base master --head feat/notebook-kill-switch --title "Notebook: insert an Ask answer into a note (G-064, dark) + two live fixes" --body-file - <<'MSG'
## What ships

- **G-064: insert an Ask Notebook answer into a note, dark.** Behind
  `NOTEBOOK_ASK_INSERT_ON`, which is unset, so the button stays hidden. The block
  (`askInsert`) is permanently labelled "From Ask Notebook". Its citation chips
  (`askCitation`) read `[n · edited]` when the member edits the paragraph they
  back. Ask never cites an inserted answer back as the member's own writing.
  Export keeps the label. A share link never exposes citation labels.
  - Spec: `docs/superpowers/specs/2026-09-22-ask-notebook-insert-design.md` (r2).
  - Plan: `docs/superpowers/plans/2026-09-22-ask-notebook-insert.md`.
- **Live fix: research-workspace citations.** Clicking a citation in "This
  research" did nothing. It now opens the note.
- **Live fix: Callout and Toggle styling.** Imported Notion callouts lost their
  layout, and the toggle chevron had no 44px touch target, because the CSS module
  hashed the class names the editor writes.

## Member impact

Members see two fixes immediately: research citations open their note, and
imported callouts and toggles render as designed. Nothing else changes for
members. The insert feature is invisible until `NOTEBOOK_ASK_INSERT_ON` is set
on `web`, which is a separate owner call. Rollback is to unset it. Blocks
already inserted keep rendering, because the node types stay registered.

## Verification

Gate manifest: `docs/notebook/gate-runs/g064/`. Live walk and rails:
`docs/notebook/RESUME-HERE-2026-09-20.md`, top section.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01HiiyhLP3J7WbX1wf3XLeQ6
MSG
```

- [ ] **Step 3: Stop and report**

Report the PR URL, the gate verdict and the live-walk results to the owner. **Do
not merge.** Master is production and needs the owner's explicit "deploy".
Activating `NOTEBOOK_ASK_INSERT_ON` is a separate owner decision after that.
