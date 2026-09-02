# Closing the Transfer Gap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "a member arrives and transfers their notes from Notion, Obsidian or Evernote" genuinely easy — attacking the friction that actually stops people, not the features that sound impressive.

**Architecture:** No new subsystems. This plan improves the *existing, working* file-import path, which already handles all three platforms, and adds the per-note selection the objective calls for. Sync connectors are a separate, largely-blocked track and are deliberately NOT in this plan.

**Tech Stack:** React + vitest (the import wizard), Python/FastAPI (preview payload only).

**Spec:** `docs/superpowers/specs/2026-09-01-notebook-migration-program-design.md` §1 (the goal) and §8.2

## The gap this plan closes, and what it deliberately does not

Measured against the running product, not assumed:

**Already works** — the empty state says "Bring your notes from Notion, Obsidian, Evernote, or anywhere else" with an emphasised Import button; the wizard auto-detects the source, previews create/update/unchanged, allows excluding folders, resolves media and links, and re-imports update by fingerprint rather than duplicating. Export exists for the round trip out.

**The real friction is upstream of us.** Before a member can use any of that, they must produce an export file — "Settings → Export → wait for an email → download a zip" in Notion, a notebook-by-notebook `.enex` in Evernote. Nothing in the product tells them how. That step is where people quit, and it is the cheapest thing on the board to fix.

**Not in this plan, and why:**
- Notion sync — code-complete and dark; it needs a *registration*, not engineering.
- Evernote sync — needs an account for the `tools/list` probe before a line is written.
- Obsidian plugin — its own repo, its own review queue; tracked as Wave 3b.

## Global Constraints

- **Touch targets >= 44px, and this product's touch tier is `<=1024px`, NOT `<=640px`.** A floor restored only at 640 leaves TABLET broken — a defect this repo has hit repeatedly.
- **No generic emoji as UI iconography** — use the `UIcon` component; match the surrounding file.
- **Assert on `fetch.mock.calls` OUTSIDE any mock callback.** An assertion inside a mock's `json()` body is swallowed by the caller's `.catch` and passes while the wire is cut. That has shipped here before.
- **A test must be able to FAIL.** For any control added, prove it: delete the control, watch the test go red, restore. A rail nobody has watched fail is not a rail.
- ⛔ **Do not regress the wizard's existing behaviour** — auto-detect ordering (evernote > notion > obsidian > generic), the live-`FileList` handling (both file-input onChange handlers read `.files` AFTER `value=''` empties it — this broke the wizard's front door once and jsdom cannot see it), or re-import-by-fingerprint.
- Frontend tests run from `app/`; read every summary line.

## File Structure

| File | Responsibility |
|---|---|
| `app/src/pages/journal-2-0/components/notebook/import/ExportGuide.jsx` | **new** — per-platform "how to get your export" instructions |
| `app/src/pages/journal-2-0/components/notebook/import/ImportWizard.jsx` | surface the guide on the drop step; per-note selection on the preview step |
| `app/src/pages/journal-2-0/lib/importer/` | selection plumbed through confirm |

---

## Task 1: Tell the member how to get their notes out

**Files:** Create `ExportGuide.jsx` + `.module.css` + test; modify `ImportWizard.jsx` (drop step only).

**Why this is first:** every other item on the board is blocked on a registration, an account, or a plugin review queue. This one is not, it helps all three platforms today, and it addresses the step where members actually give up. A perfect importer nobody can feed is not a transfer path.

- [ ] **Step 1: Write the failing test**

```jsx
// ExportGuide.test.jsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ExportGuide from './ExportGuide'

describe('ExportGuide', () => {
  it('gives a real click-path for each platform, not a vague pointer', () => {
    render(<ExportGuide />)
    fireEvent.click(screen.getByRole('button', { name: /notion/i }))
    // The value is the SPECIFIC path. A guide that says "export your notes"
    // helps nobody — the member is already trying to do that.
    expect(screen.getByText(/Settings/i)).toBeInTheDocument()
    expect(screen.getByText(/Markdown/i)).toBeInTheDocument()
  })

  it('warns where a platform will bite them', () => {
    render(<ExportGuide />)
    fireEvent.click(screen.getByRole('button', { name: /notion/i }))
    // Notion mails the export as a link and splits large workspaces into
    // multiple zips — a member who imports only the first silently loses
    // notes and blames us.
    expect(screen.getByText(/email|multiple|parts?/i)).toBeInTheDocument()
  })

  it('covers all three platforms we name on the empty state', () => {
    render(<ExportGuide />)
    for (const p of [/notion/i, /obsidian/i, /evernote/i]) {
      expect(screen.getByRole('button', { name: p })).toBeInTheDocument()
    }
  })
})
```

- [ ] **Step 2: Run it and confirm it fails** — `npx vitest run src/pages/journal-2-0/components/notebook/import/ExportGuide.test.jsx` from `app/`. Expected: module not found.

- [ ] **Step 3: Research the actual export paths.** ⛔ Do NOT write these from memory — fetch each vendor's current help documentation and quote the real click-path. A confidently wrong instruction is worse than none, because the member follows it, fails, and concludes the import is broken. At minimum establish, per platform: the exact menu path, the format to choose, and the one thing that most commonly goes wrong.
  Known starting points to verify, not to trust: Notion exports as Markdown & CSV, mails a link, and splits large workspaces across multiple zips. Evernote exports `.enex` per notebook, so a member with many notebooks gets many files. An Obsidian vault is already a folder of markdown on disk — there is no export step at all, which is worth saying plainly because it removes a step the member expects to have.

- [ ] **Step 4: Build the component.** A compact per-platform selector on the wizard's drop step. Requirements: it must not push the dropzone below the fold on a phone; it must be collapsed by default so it never obstructs the member who already has their file; `UIcon` not emoji; >=44px targets under the `<=1024px` touch tier.

- [ ] **Step 5: Surface it in `ImportWizard.jsx`'s drop step**, without disturbing the file-input handlers. ⛔ Re-read the comment above those handlers before touching anything near them.

- [ ] **Step 6: Run the tests, plus the wizard's own suite** — `npx vitest run src/pages/journal-2-0/components/notebook/import`. All existing wizard tests must stay green.

- [ ] **Step 7: Commit**

```bash
git add app/src/pages/journal-2-0/components/notebook/import/
git commit -m "feat(notebook): tell members how to get their notes out of Notion, Obsidian and Evernote"
```

---

## Task 2: Let the member pick which notes transfer

**Files:** `ImportWizard.jsx` (preview step), `lib/importer/commit.js`, tests.

**Why:** the objective is "all their notes, or the ones they pick." Today the wizard supports excluding whole FOLDERS (`toggleExcludeFolder`) but not individual notes. A member migrating a decade of Evernote almost never wants all of it, and folder granularity does not match how people actually decide.

- [ ] **Step 1: Read the preview step first.** Understand how `excludedFolders` flows into confirm, and extend that shape rather than adding a parallel mechanism — two independent "what to skip" sets will drift. Report what you found before changing it.

- [ ] **Step 2: Write the failing tests**

```jsx
it('imports only the notes the member left checked', async () => {
  // Arrange a preview with three notes; uncheck one.
  // Assert the confirm payload carries exactly two — asserted on the
  // recorded call OUTSIDE any mock callback.
})

it('a folder excluded and a note excluded inside a kept folder both hold', async () => {
  // The two mechanisms must compose, not fight. This is the test that
  // catches a parallel implementation.
})

it('the summary counts match what was actually imported', async () => {
  // A member who unchecks 40 notes and is told "imported 100" stops
  // trusting the number, and the count is the only evidence they have.
})
```

- [ ] **Step 3: Run, confirm they fail. Step 4: Implement. Step 5: Re-run, plus the whole import suite.**

- [ ] **Step 6: Prove the control is real** — remove the per-note checkbox from the render, confirm the first test goes RED, restore. Verbatim output in the report.

- [ ] **Step 7: Commit**

---

## Task 3: Make the preview honest at migration scale

**Files:** `ImportWizard.jsx` preview step; possibly the preview payload.

**Why:** the preview lists notes so the member can decide. A 5,000-note Evernote export renders 5,000 rows into a dialog. This is the same scale-regime defect the notebook archive already had — measured there, browser-verified, and fixed with pagination. The importer has not been checked at that size.

- [ ] **Step 1: Measure before building.** Generate a large fixture (thousands of notes) and open the preview in a REAL browser. **The browser sees what no test can** — jsdom computes no layout, so a passing unit test proves nothing here. Record: does it render, how long, does the dialog scroll or the page, does selection stay responsive.
- [ ] **Step 2: If it holds, STOP and record the numbers.** Do not build for a problem that does not exist — say so in the report and close the task. If it does not hold, fix the specific thing that broke (virtualise the list, or paginate, or collapse by folder with counts) and re-measure.
- [ ] **Step 3: Record before/after numbers either way.** A performance claim without a measurement is a hypothesis.

---

## Self-Review

**Coverage of the stated objective** — "a user comes in and transfers all their notes, or the ones they pick, easily":
- *transfers* — already works (existing importer, all three platforms)
- *easily* — Task 1 (the export step is the real friction)
- *the ones they pick* — Task 2
- *at their real scale* — Task 3, measure-first

**Explicitly out of scope, with reasons:** Notion sync (needs a registration, not code) · Evernote sync (needs an account for the probe) · Obsidian plugin (own repo, own review queue — Wave 3b). Each removes the export step entirely for its platform and is the right next investment once unblocked.

**Ambiguity resolved:** Task 3 is deliberately allowed to conclude "no work needed." A task that must produce code will produce code whether or not it is warranted.
