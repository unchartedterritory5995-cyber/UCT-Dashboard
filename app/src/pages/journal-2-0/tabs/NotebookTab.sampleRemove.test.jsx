// Go-live wave 1 (A7): "Remove the sample notebook" is a row of the notes list's ⋯ menu, at every width, shown only
// while the sample is active. It runs Research home's flow: the bulk trash's pre-check, a confirmed "Remove anyway"
// when the device could not be asked, then the DELETE, then a status line. The sample's status is read the first time
// ⋯ opens, never on a plain open of the Notebook.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const precheck = vi.hoisted(() => ({ fn: null }))
vi.mock('../lib/noteBatch', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, precheckNoteBatch: (...a) => precheck.fn(...a) }
})

import { AUTH, installFetch, Providers } from '../a11y/fixtures'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import { SAMPLE_COPY } from '../components/notebook/onboarding/sampleNotebook'
import NotebookTab from './NotebookTab'

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
const SAMPLE = { v: 1, ids: ['s1', 's2'], at: '2026-11-01T00:00:00Z' }
const S = { active: ['s1', 's2'], deletes: 0, statusReads: 0, prefs: { notebook_sample: JSON.stringify(SAMPLE) }, holdStatus: null, holdAfterDelete: false, releaseStatus: null }

beforeEach(() => {
  S.active = ['s1', 's2']
  S.deletes = 0
  S.statusReads = 0
  S.prefs = { notebook_sample: JSON.stringify(SAMPLE) }
  S.holdStatus = null
  S.holdAfterDelete = false
  S.releaseStatus = null
  precheck.fn = vi.fn(async ({ ids }) => ({ blocked: [], unsent: [], unchecked: [], send: ids }))
  latchNotebookFlags({ notebook_onboarding_enabled: true })
})
afterEach(() => { cleanup(); __resetNotebookFlags() })

async function renderTab() {
  const spy = installFetch([
    [/mapping-offer$/, { offer: null }],
    [/^\/api\/auth\/preferences$/, () => S.prefs],
    [/^\/api\/j2\/onboarding\/sample-notebook$/, () => { S.statusReads += 1; return { activeIds: S.active } }],
  ])
  // The DELETE is told apart from the status read by its method.
  const base = global.fetch
  global.fetch = vi.fn((input, opts = {}) => {
    const url = typeof input === 'string' ? input : input?.url || ''
    if (url.startsWith('/api/j2/onboarding/sample-notebook') && opts.method === 'DELETE') {
      S.deletes += 1
      S.active = []
      // every status read after the DELETE waits until the test lets it answer (a slow server)
      if (S.holdAfterDelete) S.holdStatus = new Promise((r) => { S.releaseStatus = r })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ trashed: ['s1', 's2'] }) })
    }
    // a status read the test holds back (the server answering slowly)
    if (url.startsWith('/api/j2/onboarding/sample-notebook') && S.holdStatus) return S.holdStatus.then(() => base(input, opts))
    return base(input, opts)
  })
  render(<Providers auth={AUTH} route="/journal/notebook?view=all"><NotebookTab /></Providers>)
  await settle()
  return spy
}
const bar = () => screen.getByRole('toolbar', { name: 'Notes list tools' })
const openMore = async () => {
  fireEvent.click(within(bar()).getByRole('button', { name: 'More notebook actions' }))
  await settle()
  return screen.getByRole('menu')
}

describe('Remove the sample notebook, from the notes list', () => {
  it('the status is not read on a plain open; it is read the first time ⋯ opens, and the row shows', async () => {
    await renderTab()
    expect(S.statusReads).toBe(0)
    await openMore()
    await waitFor(() => expect(S.statusReads).toBe(1))
    expect(await screen.findByRole('menuitem', { name: SAMPLE_COPY.removeRow })).toBeInTheDocument()
  })

  // Final fix (C3): on a phone the menu is a dozen rows; the removal row sits above "Journal tools", not last.
  it('the removal row comes before "Journal tools" in the menu', async () => {
    await renderTab()
    const menu = await openMore()
    await screen.findByRole('menuitem', { name: SAMPLE_COPY.removeRow })
    const names = within(menu).getAllByRole('menuitem').map((el) => el.textContent.trim())
    const remove = names.indexOf(SAMPLE_COPY.removeRow)
    const tools = names.indexOf('Journal tools')
    expect(tools, 'non-vacuity: the Journal tools row is in the menu').toBeGreaterThan(-1)
    expect(remove).toBeGreaterThan(-1)
    expect(remove).toBeLessThan(tools)
  })

  it('the row is not offered once the sample is gone (no active ids)', async () => {
    S.active = []
    await renderTab()
    await openMore()
    await waitFor(() => expect(S.statusReads).toBe(1))
    await settle()
    expect(screen.queryByRole('menuitem', { name: SAMPLE_COPY.removeRow })).toBeNull()
  })

  it('a member with no sample recorded never asks for the status', async () => {
    S.prefs = {}
    await renderTab()
    await openMore()
    await settle()
    expect(S.statusReads).toBe(0)
    expect(screen.queryByRole('menuitem', { name: SAMPLE_COPY.removeRow })).toBeNull()
  })

  it('pressing it runs the trash pre-check over the active ids, then the DELETE, and says what happened', async () => {
    await renderTab()
    await openMore()
    fireEvent.click(await screen.findByRole('menuitem', { name: SAMPLE_COPY.removeRow }))
    await waitFor(() => expect(S.deletes).toBe(1))
    expect(precheck.fn).toHaveBeenCalledWith(expect.objectContaining({ ids: ['s1', 's2'], op: 'trash' }))
    expect(await screen.findByText(/^Sample notebook moved to Trash\./)).toBeInTheDocument()
  })

  it('a note with unsent words holds the whole removal back and is named; nothing is deleted', async () => {
    precheck.fn = vi.fn(async () => ({ blocked: [], unsent: ['s1'], unchecked: [], send: ['s2'] }))
    await renderTab()
    await openMore()
    fireEvent.click(await screen.findByRole('menuitem', { name: SAMPLE_COPY.removeRow }))
    expect(await screen.findByRole('alert')).toHaveTextContent(SAMPLE_COPY.notRemoved)
    expect(S.deletes).toBe(0)
  })

  // Final fix (C1): the held note is named even when it is not in the list on screen (its title is read), and the
  // sentence says what works instead of "try again in a moment".
  it('a held note not in the list on screen is still named, with what to do', async () => {
    precheck.fn = vi.fn(async () => ({ blocked: [], unsent: ['s1'], unchecked: [], send: ['s2'] }))
    await renderTab()
    const base = global.fetch
    global.fetch = vi.fn((input, opts = {}) => {
      const url = typeof input === 'string' ? input : input?.url || ''
      if (url === '/api/j2/notes/s1') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ note: { id: 's1', title: 'Trade plan: example -- AAPL pullback' } }) })
      return base(input, opts)
    })
    await openMore()
    fireEvent.click(await screen.findByRole('menuitem', { name: SAMPLE_COPY.removeRow }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The sample was not removed: "Trade plan: example -- AAPL pullback" has changes that have not finished saving. Open it so it can finish saving, then remove the sample again.')
    expect(S.deletes).toBe(0)
  })

  it('a device that could not be asked is offered a confirmed Remove anyway, which re-runs with acceptUnchecked', async () => {
    precheck.fn = vi.fn(async ({ acceptUnchecked }) => (acceptUnchecked
      ? { blocked: [], unsent: [], unchecked: [], send: ['s1', 's2'] }
      : { blocked: [], unsent: [], unchecked: ['s1'], send: ['s2'] }))
    await renderTab()
    await openMore()
    fireEvent.click(await screen.findByRole('menuitem', { name: SAMPLE_COPY.removeRow }))
    fireEvent.click(await screen.findByRole('button', { name: SAMPLE_COPY.removeAnyway }))
    expect(screen.getByText(SAMPLE_COPY.removeAnywayConfirm)).toBeInTheDocument()
    expect(S.deletes).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: SAMPLE_COPY.removeAnywayYes }))
    await waitFor(() => expect(S.deletes).toBe(1))
    expect(precheck.fn).toHaveBeenLastCalledWith(expect.objectContaining({ acceptUnchecked: true }))
  })

  // Fix round 1 (review 4d): the pre-check runs over the sample notes out of Trash at the PRESS, not as they were when
  // the menu first opened -- a sample note restored from Trash since then is one the DELETE trashes too.
  it('the press re-reads the status and pre-checks the ids out of Trash now', async () => {
    S.active = ['s1']
    await renderTab()
    await openMore()
    await screen.findByRole('menuitem', { name: SAMPLE_COPY.removeRow })
    S.active = ['s1', 's2']   // s2 restored from Trash since the menu first read the status
    fireEvent.click(screen.getByRole('menuitem', { name: SAMPLE_COPY.removeRow }))
    await waitFor(() => expect(S.deletes).toBe(1))
    expect(precheck.fn).toHaveBeenCalledWith(expect.objectContaining({ ids: ['s1', 's2'] }))
    expect(S.statusReads).toBeGreaterThanOrEqual(2)
  })

  // Review 4d: between a successful DELETE and the status re-read the row must already be gone, so it cannot be
  // pressed a second time. The re-read is held back here; only the cache written at once can take the row away.
  it('after the DELETE the row leaves at once, before any re-read answers', async () => {
    S.holdAfterDelete = true
    await renderTab()
    await openMore()
    fireEvent.click(await screen.findByRole('menuitem', { name: SAMPLE_COPY.removeRow }))
    await waitFor(() => expect(S.deletes).toBe(1))
    expect(await screen.findByText(/^Sample notebook moved to Trash\./)).toBeInTheDocument()
    await openMore()
    expect(screen.queryByRole('menuitem', { name: SAMPLE_COPY.removeRow })).toBeNull()
    expect(S.deletes).toBe(1)
    S.releaseStatus?.()
  })
})
