// Go-live wave 1, the notes list's menus:
//   C1/C2  the New menu's Voice note and "Draft a review" rows (pass 2: the reviews are its second view) carry the walkthroughs' anchors; on a phone ⋯ carries both (the
//          "+ New" group is not drawn there), with their own anchors;
//   D2     "Ask your Notebook" in ⋯ is a TOUCH-tier row (the toolbar's "AI" is desktop-only);
//   D3     a failed saved-views read says so in the View menu's Saved views place;
//   D4     a review drafted from the New menu shows a busy line while it drafts and its rows cannot be pressed twice,
//          and it is drafted for the member's selected account.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const draft = vi.hoisted(() => ({ calls: [], opts: [], release: null, notice: null }))
vi.mock('../lib/reviewDraftRun', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    draftReview: vi.fn((period, opts) => {
      draft.calls.push({ period, accountId: opts.accountId })
      draft.opts.push(opts)
      return new Promise((resolve) => { draft.release = () => { if (draft.notice) opts.onNotice(draft.notice); resolve() } })
    }),
  }
})
vi.mock('../hooks/useJ2SelectedAccount', () => ({ default: () => ({ accountId: 'acct-9' }) }))

import { AUTH, installFetch, Providers } from '../a11y/fixtures'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import { parseRules, declarations } from '../a11y/cssAudit'
import NotebookTab from './NotebookTab'
import { expectSecondView } from '../lib/testing/menuSecondView.testkit'
import styles from './NotebookTab.module.css'

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
beforeEach(() => { draft.calls = []; draft.opts = []; draft.release = null; draft.notice = null })
afterEach(() => { cleanup(); __resetNotebookFlags() })

async function renderTab(routes = [], route = '/journal/notebook?view=all') {
  installFetch([[/mapping-offer$/, { offer: null }], ...routes])
  render(<Providers auth={AUTH} route={route}><NotebookTab /></Providers>)
  await settle()
}
const bar = () => screen.getByRole('toolbar', { name: 'Notes list tools' })
const openNew = () => { fireEvent.click(within(bar()).getByRole('button', { name: 'More ways to start a note' })); return screen.getByRole('menu', { name: 'Start a note' }) }
const openMore = () => { fireEvent.click(within(bar()).getByRole('button', { name: 'More notebook actions' })); return screen.getByRole('menu', { name: 'More notebook actions' }) }
// Simplify pass 2 (C2): the reviews are the second view of "Draft a review", in the same menu.
const openReviews = (menu) => { fireEvent.click(within(menu).getByRole('menuitem', { name: 'Draft a review' })); return menu }
const REVIEWS = ["Today's recap", "This week's review", "This month's review"]

describe('C1/C2: the walkthrough anchors on the New menu, and the phone rows in ⋯', () => {
  beforeEach(() => latchNotebookFlags({ notebook_voice_notes_enabled: true, notebook_review_drafts_enabled: true }))

  it('the New menu: Voice note, then "Draft a review" (its own anchor) whose second view holds the reviews', async () => {
    await renderTab()
    const menu = openNew()
    expect(within(menu).getByRole('menuitem', { name: 'Voice note' })).toHaveAttribute('data-tour', 'new-note-voice')
    // one row for the three, last in the menu; no "Reviews" heading any more
    const names = within(menu).getAllByRole('menuitem').map((el) => el.textContent.trim())
    expect(names.at(-1)).toBe('Draft a review')
    expect(within(menu).queryByRole('group', { name: 'Reviews' })).toBeNull()
    for (const name of REVIEWS) expect(within(menu).queryByRole('menuitem', { name })).toBeNull()
    expect(within(menu).getByRole('menuitem', { name: 'Draft a review' })).toHaveAttribute('data-tour', 'review-drafts-open')
    openReviews(menu)
    expect(within(menu).getByRole('menuitem', { name: "Today's recap" })).toHaveAttribute('data-tour', 'review-drafts-daily')
    expect(within(menu).getByRole('menuitem', { name: "This week's review" })).toHaveAttribute('data-tour', 'review-drafts-weekly')
    expect(within(menu).getByRole('menuitem', { name: "This month's review" })).not.toHaveAttribute('data-tour')
  })

  it('the New menu\'s "Draft a review" meets the shared second-view contract (Review focus 5)', async () => {
    await renderTab()
    await expectSecondView({
      openMenu: openNew, parentRowName: 'Draft a review', childRowNames: REVIEWS,
      trigger: () => within(bar()).getByRole('button', { name: 'More ways to start a note' }),
    })
  })

  it('⋯: a phone-only Voice note row and a phone-only "Draft a review" row, each with its own anchor, under Import', async () => {
    await renderTab()
    const menu = openMore()
    const voice = within(menu).getByRole('menuitem', { name: 'Voice note' })
    expect(voice).toHaveAttribute('data-tour', 'new-note-voice-phone')
    expect(voice.className).toContain(styles.phoneOnlyItem)
    expect(within(menu).queryByRole('group', { name: 'Reviews' })).toBeNull()
    const reviews = within(menu).getByRole('menuitem', { name: 'Draft a review' })
    expect(reviews).toHaveAttribute('data-tour', 'review-drafts-phone')
    expect(reviews.className).toContain(styles.phoneOnlyItem)
    // high in the menu: right after Import, then Draft a review
    const names = within(menu).getAllByRole('menuitem').map((el) => el.textContent.trim())
    expect(names.indexOf('Voice note')).toBe(names.indexOf('Import') + 1)
    expect(names.indexOf('Draft a review')).toBe(names.indexOf('Voice note') + 1)
    // its second view carries the same reviews (and their anchors, written once: the two menus are never open together)
    openReviews(menu)
    expect(within(menu).getByRole('menuitem', { name: "Today's recap" })).toHaveAttribute('data-tour', 'review-drafts-daily')
    expect(document.querySelectorAll('[data-tour="review-drafts-daily"]')).toHaveLength(1)
  })

  // Final fix M11: `data-tour` uniqueness at RUNTIME (tourAnchors.test.js reads the source; the two review anchors are
  // written once and drawn by whichever menu is open). At each width, open "Draft a review" in the menu that width
  // has, and each anchor is on the page exactly once -- also after a real press moves from one menu to the other.
  describe('M11: each review anchor is on the page once, at 1280 and at 390', () => {
    const realMatch = window.matchMedia
    const realWidth = window.innerWidth
    const atWidth = (w) => {
      window.innerWidth = w
      window.matchMedia = (q) => {
        const max = /max-width:\s*(\d+)px/.exec(q)
        const min = /min-width:\s*(\d+)px/.exec(q)
        const matches = (!max || w <= Number(max[1])) && (!min || w >= Number(min[1]))
        return { matches, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
      }
    }
    afterEach(() => { window.matchMedia = realMatch; window.innerWidth = realWidth })
    const anchors = () => ['review-drafts-daily', 'review-drafts-weekly']
      .map((a) => document.querySelectorAll(`[data-tour="${a}"]`).length)
    const press = (el) => { fireEvent.pointerDown(el); fireEvent.click(el) }

    it('1280: the New menu draws them once; a press on ⋯ closes it, and ⋯ draws them once', async () => {
      atWidth(1280)
      await renderTab()
      expect(anchors()).toEqual([0, 0])
      openReviews(openNew())
      expect(anchors()).toEqual([1, 1])
      press(within(bar()).getByRole('button', { name: 'More notebook actions' }))
      expect(screen.queryByRole('menu', { name: 'Start a note' })).toBeNull()
      openReviews(screen.getByRole('menu', { name: 'More notebook actions' }))
      expect(anchors()).toEqual([1, 1])
    })

    it('390: ⋯ (the phone’s menu) draws them once', async () => {
      atWidth(390)
      await renderTab()
      expect(anchors()).toEqual([0, 0])
      openReviews(openMore())
      expect(anchors()).toEqual([1, 1])
    })
  })

  it('⋯\'s "Draft a review" meets the shared second-view contract (Review focus 5)', async () => {
    await renderTab()
    await expectSecondView({
      openMenu: openMore, parentRowName: 'Draft a review', childRowNames: REVIEWS,
      trigger: () => within(bar()).getByRole('button', { name: 'More notebook actions' }),
    })
  })

  // Final fix (C5): the phone row says "Today's note", the words of the toolbar button and the first run.
  it('⋯: the phone-only Today row reads "Today\'s note", never a bare "Today"', async () => {
    await renderTab()
    const menu = openMore()
    const row = within(menu).getByRole('menuitem', { name: "Today's note" })
    expect(row.className).toContain(styles.phoneOnlyItem)
    expect(within(menu).queryByRole('menuitem', { name: 'Today' })).toBeNull()
  })

  it('switches off: no voice row and no "Draft a review" row in either menu', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({})
    await renderTab()
    expect(within(openMore()).queryByRole('menuitem', { name: 'Draft a review' })).toBeNull()
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
  // Task 1 fix round 1 (item 1): the "+" is drawn on every Notebook view on a phone, but the Ask section only with the
  // notes list. From a note or the Daily brief the row goes to the list first (the panel's "All notes" action) and
  // opens Ask there, in ONE press, with focus in the question field; it never opens a section nobody can see.
  const plusSheet = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Add to your notebook' }))
    return screen.findByRole('dialog', { name: 'Add' }, { timeout: 5000 })
  }
  const askRegion = () => screen.getByRole('region', { name: 'Ask your Notebook' })
  it.each([
    ['the notes list', '/journal/notebook?view=all'],
    ['an open note', '/journal/notebook?note=n1'],
    ['the Daily brief', '/journal/notebook?view=today'],
  ])('the "+" sheet\'s "Ask your Notebook" from %s: one press shows the list with Ask open and focused', async (_, route) => {
    await renderTab([], route)
    expect(screen.queryByTestId('ask-scope')).toBeNull()
    const sheet = await plusSheet()
    // the rows, exactly: no "Ask AI" (the Compass row this replaced) can come back unseen
    expect(within(sheet).getAllByRole('button').map((b) => b.textContent.trim()))
      .toEqual(expect.arrayContaining(['Quick note', 'Ask your Notebook', 'Help & feedback']))
    expect(within(sheet).queryByText(/Ask AI/)).toBeNull()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Ask your Notebook' }))
    expect((await screen.findByTestId('ask-scope', {}, { timeout: 5000 })).textContent).toContain('My Notebook')
    expect(bar()).toBeTruthy()                                   // the notes list is what is shown
    expect(document.querySelector('[data-today-home]')).toBeNull()
    expect(askRegion()).toBeTruthy()
    await waitFor(() => {
      expect(askRegion().contains(document.activeElement)).toBe(true)
      expect(document.activeElement.tagName).toMatch(/^(INPUT|TEXTAREA)$/)
    }, { timeout: 5000 })
  })

  // Task 1 fix round 1 (item 2): the sheet's row is gone when Ask closes, so focus goes back to the "+" itself.
  it('opened from the "+", closing Ask puts focus back on "Add to your notebook"', async () => {
    await renderTab()
    fireEvent.click(within(await plusSheet()).getByRole('button', { name: 'Ask your Notebook' }))
    await screen.findByTestId('ask-scope', {}, { timeout: 5000 })
    await waitFor(() => expect(askRegion().contains(document.activeElement)).toBe(true), { timeout: 5000 })
    fireEvent.click(screen.getByRole('button', { name: 'Close Ask' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Ask your Notebook' })).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add to your notebook' })))
  })

  it('opened from the ⋯ row, closing Ask puts focus back on the ⋯ button', async () => {
    await renderTab()
    const more = within(bar()).getByRole('button', { name: 'More notebook actions' })
    fireEvent.click(more)
    const row = within(screen.getByRole('menu', { name: 'More notebook actions' })).getByRole('menuitem', { name: 'Ask your Notebook' })
    fireEvent.click(row)
    await screen.findByTestId('ask-scope', {}, { timeout: 5000 })
    await waitFor(() => expect(askRegion().contains(document.activeElement)).toBe(true), { timeout: 5000 })
    fireEvent.click(screen.getByRole('button', { name: 'Close Ask' }))
    await waitFor(() => expect(document.activeElement).toBe(more))
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

  // Final fix I1: "Today's recap" can make today's note, so the door is handed the member's daily template (the recap
  // door then sends it with the plan seed: lib/reviewDraftRun.test.js).
  it("I1: Today's recap hands the draft door the member's daily template", async () => {
    await renderTab([[/^\/api\/auth\/preferences$/, { notebook_daily_template: 'tpl-d' }]])
    await waitFor(() => expect(global.fetch.mock.calls.some(([u]) => String(u) === '/api/auth/preferences')).toBe(true))
    await settle()
    fireEvent.click(within(openReviews(openNew())).getByRole('menuitem', { name: "Today's recap" }))
    await waitFor(() => expect(draft.calls).toHaveLength(1))
    expect(draft.opts[0].dailyTemplateId).toBe('tpl-d')
    await act(async () => { draft.release() })
  })

  it("shows 'Drafting today's recap…' while it runs, disables the rows, drafts for the selected account, then clears", async () => {
    // Fix round 1 (review 4a): fake timers from the start, so the 8 s auto-dismiss is really reached below.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await renderTab()
    fireEvent.click(within(openReviews(openNew())).getByRole('menuitem', { name: "Today's recap" }))
    expect(await screen.findByText("Drafting today's recap…")).toBeInTheDocument()
    await waitFor(() => expect(draft.calls).toEqual([{ period: 'daily', accountId: 'acct-9' }]))
    // pressed again meanwhile: every review row is disabled, and nothing new starts
    const menu = openReviews(openNew())
    for (const name of REVIEWS) {
      expect(within(menu).getByRole('menuitem', { name })).toBeDisabled()
    }
    fireEvent.click(within(menu).getByRole('menuitem', { name: "This week's review" }))
    expect(draft.calls).toHaveLength(1)
    // Fix round 1 (review 4b): the disabled rows are not stops. With every review disabled, focus waits on Back (pass 2:
    // the reviews are a second view), and Down and End stay there instead of sticking on a disabled row.
    const backRow = within(menu).getByRole('menuitem', { name: 'Back to Start a note' })
    await waitFor(() => expect(document.activeElement).toBe(backRow))
    fireEvent.keyDown(backRow, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(backRow)
    fireEvent.keyDown(document.activeElement, { key: 'End' })
    expect(document.activeElement).toBe(backRow)
    fireEvent.keyDown(menu, { key: 'Escape' })
    fireEvent.keyDown(menu, { key: 'Escape' })
    // the busy line does not time out on its own while the draft runs: well past the 8 s other notices get
    await act(async () => { await vi.advanceTimersByTimeAsync(9000) })
    expect(screen.getByText("Drafting today's recap…")).toBeInTheDocument()
    await act(async () => { draft.release() })
    await waitFor(() => expect(screen.queryByText("Drafting today's recap…")).toBeNull())
    expect(within(openReviews(openNew())).getByRole('menuitem', { name: "Today's recap" })).not.toBeDisabled()
  })

  it('CONTROL: the sentence a landed draft says (not busy) does leave after 8 s, so the advance above is real', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    draft.notice = 'Saved in your Daily folder.'
    await renderTab()
    fireEvent.click(within(openReviews(openNew())).getByRole('menuitem', { name: "Today's recap" }))
    await screen.findByText("Drafting today's recap…")
    await waitFor(() => expect(draft.release).toBeTypeOf('function'))
    await act(async () => { draft.release() })
    expect(await screen.findByText('Saved in your Daily folder.')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(9000) })
    expect(screen.queryByText('Saved in your Daily folder.')).toBeNull()
  })
})
