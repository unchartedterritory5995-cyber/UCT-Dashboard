// Go-live wave 1, the notes list's menus:
//   C1/C2  the New menu's Voice note and Reviews rows carry the walkthroughs' anchors; on a phone ⋯ carries both (the
//          "+ New" group is not drawn there), with their own anchors;
//   D2     "Ask your Notebook" in ⋯ is a TOUCH-tier row (the toolbar's "AI" is desktop-only);
//   D3     a failed saved-views read says so in the View menu's Saved views place;
//   D4     a review drafted from the New menu shows a busy line while it drafts and its rows cannot be pressed twice,
//          and it is drafted for the member's selected account.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const draft = vi.hoisted(() => ({ calls: [], release: null, notice: null }))
vi.mock('../lib/reviewDraftRun', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    draftReview: vi.fn((period, opts) => {
      draft.calls.push({ period, accountId: opts.accountId })
      return new Promise((resolve) => { draft.release = () => { if (draft.notice) opts.onNotice(draft.notice); resolve() } })
    }),
  }
})
vi.mock('../hooks/useJ2SelectedAccount', () => ({ default: () => ({ accountId: 'acct-9' }) }))

import { AUTH, installFetch, Providers } from '../a11y/fixtures'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import { parseRules, declarations } from '../a11y/cssAudit'
import NotebookTab from './NotebookTab'
import styles from './NotebookTab.module.css'

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
beforeEach(() => { draft.calls = []; draft.release = null; draft.notice = null })
afterEach(() => { cleanup(); __resetNotebookFlags() })

async function renderTab(routes = []) {
  installFetch([[/mapping-offer$/, { offer: null }], ...routes])
  render(<Providers auth={AUTH} route="/journal/notebook?view=all"><NotebookTab /></Providers>)
  await settle()
}
const bar = () => screen.getByRole('toolbar', { name: 'Notes list tools' })
const openNew = () => { fireEvent.click(within(bar()).getByRole('button', { name: 'More ways to start a note' })); return screen.getByRole('menu', { name: 'Start a note' }) }
const openMore = () => { fireEvent.click(within(bar()).getByRole('button', { name: 'More notebook actions' })); return screen.getByRole('menu', { name: 'More notebook actions' }) }

describe('C1/C2: the walkthrough anchors on the New menu, and the phone rows in ⋯', () => {
  beforeEach(() => latchNotebookFlags({ notebook_voice_notes_enabled: true, notebook_review_drafts_enabled: true }))

  it('the New menu: Voice note and the three Reviews rows carry their anchors', async () => {
    await renderTab()
    const menu = openNew()
    expect(within(menu).getByRole('menuitem', { name: 'Voice note' })).toHaveAttribute('data-tour', 'new-note-voice')
    expect(within(menu).getByRole('menuitem', { name: "Today's recap" })).toHaveAttribute('data-tour', 'review-drafts-daily')
    expect(within(menu).getByRole('menuitem', { name: "This week's review" })).toHaveAttribute('data-tour', 'review-drafts-weekly')
    expect(within(menu).getByRole('menuitem', { name: "This month's review" })).toHaveAttribute('data-tour', 'review-drafts-monthly')
  })

  it('⋯: a phone-only Voice note row and a phone-only Reviews group, each with its own anchor, under Import', async () => {
    await renderTab()
    const menu = openMore()
    const voice = within(menu).getByRole('menuitem', { name: 'Voice note' })
    expect(voice).toHaveAttribute('data-tour', 'new-note-voice-phone')
    expect(voice.className).toContain(styles.phoneOnlyItem)
    const reviews = within(menu).getByRole('group', { name: 'Reviews' })
    expect(reviews).toHaveAttribute('data-tour', 'review-drafts-phone')
    expect(reviews.className).toContain(styles.phoneOnlyItem)
    // the group's rows carry no anchor (each anchor is written once, on the New menu's rows)
    for (const row of within(reviews).getAllByRole('menuitem')) expect(row).not.toHaveAttribute('data-tour')
    // high in the menu: right after Import
    const names = within(menu).getAllByRole('menuitem').map((el) => el.textContent.trim())
    expect(names.indexOf('Voice note')).toBe(names.indexOf('Import') + 1)
  })

  // Final fix (C5): the phone row says "Today's note", the words of the toolbar button and the first run.
  it('⋯: the phone-only Today row reads "Today\'s note", never a bare "Today"', async () => {
    await renderTab()
    const menu = openMore()
    const row = within(menu).getByRole('menuitem', { name: "Today's note" })
    expect(row.className).toContain(styles.phoneOnlyItem)
    expect(within(menu).queryByRole('menuitem', { name: 'Today' })).toBeNull()
  })

  it('switches off: no voice row and no Reviews group in either menu', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({})
    await renderTab()
    expect(within(openMore()).queryByRole('group', { name: 'Reviews' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Voice note' })).toBeNull()
  })
})

describe('D2: "Ask your Notebook" is the touch tier\'s door; the toolbar AI is desktop-only', () => {
  it('the ⋯ row is touch-only (not phone-only)', async () => {
    await renderTab()
    const ask = within(openMore()).getByRole('menuitem', { name: 'Ask your Notebook' })
    expect(ask.className).toContain(styles.touchOnlyItem)
    expect(ask.className).not.toContain(styles.phoneOnlyItem)
  })

  // Simplify pass 2 (A8): the phone "+" sheet's row is the same door: "Ask your Notebook" opens the Notebook's own Ask
  // (it was "Ask AI" and went to Compass, the voice coach page).
  it('the "+" sheet\'s "Ask your Notebook" opens the same notebook-wide Ask as the ⋯ row', async () => {
    await renderTab()
    expect(screen.queryByTestId('ask-scope')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add to your notebook' }))
    const sheet = await screen.findByRole('dialog', { name: 'Add' }, { timeout: 5000 })
    expect(within(sheet).queryByRole('button', { name: 'Ask AI' })).toBeNull()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Ask your Notebook' }))
    expect((await screen.findByTestId('ask-scope', {}, { timeout: 5000 })).textContent).toContain('My Notebook')
    expect(screen.getByRole('region', { name: 'Ask your Notebook' })).toBeTruthy()
  })

  it('the stylesheet: touch-only rows hidden by default and shown at <=1024px, where the toolbar AI hides', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'pages', 'journal-2-0', 'tabs', 'NotebookTab.module.css'), 'utf8')
    const base = parseRules(css).find((r) => r.selector === '.touchOnlyItem')
    expect(Object.fromEntries(declarations(base).map((d) => [d.prop, d.value])).display).toBe('none !important')
    const touch = css.split('@media (max-width: 1024px)').slice(1).map((b) => b.slice(0, b.indexOf('\n}'))).join('\n')
    expect(touch).toMatch(/\.touchOnlyItem \{ display: flex !important; \}/)
    expect(touch).toMatch(/\.newWrap \.aiBtn \{ display: none; \}/)
  })
})

describe('D3: a failed saved-views read is said in the View menu', () => {
  it('"Saved views could not be loaded." in the Saved views place', async () => {
    await renderTab([[/^\/api\/j2\/saved-views$/, [500, { detail: 'boom' }]]])
    fireEvent.click(within(bar()).getByRole('button', { name: /^View:/ }))
    const group = await screen.findByRole('group', { name: 'Saved views' })
    expect(group).toHaveTextContent('Saved views could not be loaded.')
  })

  it('CONTROL: a read that answers draws no such line', async () => {
    await renderTab([[/^\/api\/j2\/saved-views$/, { views: [] }]])
    fireEvent.click(within(bar()).getByRole('button', { name: /^View:/ }))
    await settle()
    expect(screen.queryByText('Saved views could not be loaded.')).toBeNull()
  })
})

describe('D4: drafting a review from the New menu', () => {
  beforeEach(() => latchNotebookFlags({ notebook_review_drafts_enabled: true }))
  afterEach(() => { vi.useRealTimers() })

  it("shows 'Drafting today's recap…' while it runs, disables the rows, drafts for the selected account, then clears", async () => {
    // Fix round 1 (review 4a): fake timers from the start, so the 8 s auto-dismiss is really reached below.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await renderTab()
    fireEvent.click(within(openNew()).getByRole('menuitem', { name: "Today's recap" }))
    expect(await screen.findByText("Drafting today's recap…")).toBeInTheDocument()
    await waitFor(() => expect(draft.calls).toEqual([{ period: 'daily', accountId: 'acct-9' }]))
    // pressed again meanwhile: every Reviews row is disabled, and nothing new starts
    const menu = openNew()
    for (const name of ["Today's recap", "This week's review", "This month's review"]) {
      expect(within(menu).getByRole('menuitem', { name })).toBeDisabled()
    }
    fireEvent.click(within(menu).getByRole('menuitem', { name: "This week's review" }))
    expect(draft.calls).toHaveLength(1)
    // Fix round 1 (review 4b): the disabled rows are not stops. Down from Import (the last enabled row) wraps to the
    // first row instead of sticking on a disabled one, and End lands on Import.
    const importRow = within(menu).getByRole('menuitem', { name: 'Import' })
    importRow.focus()
    fireEvent.keyDown(importRow, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(within(menu).getAllByRole('menuitem')[0])
    fireEvent.keyDown(document.activeElement, { key: 'End' })
    expect(document.activeElement).toBe(importRow)
    fireEvent.keyDown(menu, { key: 'Escape' })
    // the busy line does not time out on its own while the draft runs: well past the 8 s other notices get
    await act(async () => { await vi.advanceTimersByTimeAsync(9000) })
    expect(screen.getByText("Drafting today's recap…")).toBeInTheDocument()
    await act(async () => { draft.release() })
    await waitFor(() => expect(screen.queryByText("Drafting today's recap…")).toBeNull())
    expect(within(openNew()).getByRole('menuitem', { name: "Today's recap" })).not.toBeDisabled()
  })

  it('CONTROL: the sentence a landed draft says (not busy) does leave after 8 s, so the advance above is real', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    draft.notice = 'Saved in your Daily folder.'
    await renderTab()
    fireEvent.click(within(openNew()).getByRole('menuitem', { name: "Today's recap" }))
    await screen.findByText("Drafting today's recap…")
    await waitFor(() => expect(draft.release).toBeTypeOf('function'))
    await act(async () => { draft.release() })
    expect(await screen.findByText('Saved in your Daily folder.')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(9000) })
    expect(screen.queryByText('Saved in your Daily folder.')).toBeNull()
  })
})
