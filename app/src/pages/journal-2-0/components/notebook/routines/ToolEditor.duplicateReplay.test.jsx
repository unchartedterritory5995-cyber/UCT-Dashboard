// Task 9.6c (9.6b m-3): the editor's Duplicate. A replayed copy (same key, W9-R48) is the copy as it reads NOW, and it may
// have been archived in another tab since: the editor then shows the archived copy's read-only state with Restore, the
// way it presents any archived tool, and says so in one sentence, never "Made a copy. You are editing …". A 409 for a
// reused key shows the server's sentence as it came, and the next press works under a fresh key. Every assertion reads
// what the member SEES or what the server is SENT.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import RoutineEditorSheet from './RoutineEditorSheet'
import { installServer, routine } from './__fixtures__/toolsServer'
import { CRUD_COPY } from '../../../lib/toolsCrud'

vi.mock('../../../../../hooks/useBreakpoint', () => ({
  useIsPhone: () => false, useIsTouch: () => false, useIsTablet: () => false, useIsDesktop: () => true,
  useHasCoarsePointer: () => false, useHasNoHover: () => false,
}))

const NOW = new Date('2026-10-26T14:00:00Z')
const S_KEY_REUSED = 'That Duplicate was already sent for a different routine or tracker. Press Duplicate again to copy this one.'
const live = () => screen.getByTestId('tool-editor-live')
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const dupKeys = (net) => net.sent('POST').filter((c) => c.path.endsWith('/duplicate')).map((c) => c.headers['Idempotency-Key'])

let net
let id = 0
beforeEach(() => {
  id += 1
  net = installServer({ tools: { [`r${id}`]: routine({ id: `r${id}` }) } })
})
afterEach(() => cleanup())

/** The server's duplicate answers `answer` (a response) instead, once; everything else is the fake server. */
function answerDuplicateOnce(answer) {
  const base = globalThis.fetch
  let used = false
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    if (!used && /\/duplicate$/.test(String(url))) {
      used = true
      net.calls.push({ method: init.method, path: String(url), headers: init.headers || {} })
      return answer
    }
    return base(url, init)
  })
}

async function mountOpen() {
  render(<RoutineEditorSheet routineId={`r${id}`} onClose={vi.fn()} onSaved={vi.fn()} zone="America/Chicago" now={NOW} />)
  await screen.findByRole('textbox', { name: 'Name' })
}

describe('the editor adopts a duplicate answer honestly', () => {
  it('a replayed copy that was archived meanwhile opens read-only with Restore, and says so', async () => {
    answerDuplicateOnce(res(200, {
      ...routine({ id: `r${id}-copy`, name: 'Pre-market routine copy', archived: true, etag: 2 }), replayed: true,
    }))
    await mountOpen()
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
    await waitFor(() => expect(live()).toHaveTextContent(CRUD_COPY.copyArchived))
    expect(live()).not.toHaveTextContent('You are editing')
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()        // not opened for editing
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    const restore = screen.getByRole('button', { name: 'Restore' })
    await waitFor(() => expect(document.activeElement).toBe(restore))
    // Restore is the copy's own: it restores the COPY, never the source.
    fireEvent.click(restore)
    await waitFor(() => expect(net.sent('POST', `/api/j2/routines/r${id}-copy/unarchive`)).toHaveLength(1))
    expect(net.sent('POST', `/api/j2/routines/r${id}/unarchive`)).toHaveLength(0)
  })

  it('a live copy (a replay or not) still opens for editing, as before', async () => {
    await mountOpen()
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
    await waitFor(() => expect(live()).toHaveTextContent('Made a copy. You are editing “Pre-market routine copy”.'))
    expect(screen.getByRole('textbox', { name: 'Name' }).value).toBe('Pre-market routine copy')
  })

  it('a 409 for a reused key shows the server\'s sentence verbatim; the next press goes under a fresh key and works', async () => {
    net.refuseNext('POST', `/api/j2/routines/r${id}/duplicate`, 409, { code: 'conflict', message: S_KEY_REUSED })
    await mountOpen()
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
    await waitFor(() => expect(live()).toHaveTextContent(S_KEY_REUSED))
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()      // a key refusal is not a stale edit
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
    await waitFor(() => expect(live()).toHaveTextContent('Made a copy. You are editing “Pre-market routine copy”.'))
    const [k1, k2] = dupKeys(net)
    expect(k1).toBeTruthy()
    expect(k2).toBeTruthy()
    expect(k2).not.toBe(k1)
  })
})
