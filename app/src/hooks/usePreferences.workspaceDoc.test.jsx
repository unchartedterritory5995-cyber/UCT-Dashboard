// TERM-021 read-new — the preferences read is also how the client learns whether the
// versioned workspace document is ARMED. The server adds `X-Workspace-Doc` to an armed
// read and nothing to a dark one, so learning it costs a dark deployment nothing: no
// probe, no 404, and the body is read exactly as before.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import usePreferences, { refreshPreferences } from './usePreferences'
import { isWorkspaceDocArmed, workspaceDocStamp, __setWorkspaceDocStampForTests, WORKSPACE_DOC_HEADER } from '../lib/workspaceDoc'

const BODY = { charts_theme: 'tv', theme: 'oled' }

function respond(headers) {
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: (name) => (name.toLowerCase() in headers ? headers[name.toLowerCase()] : null) },
    json: async () => ({ ...BODY }),
  }))
}

async function mount() {
  const wrapper = ({ children }) => <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
  const r = renderHook(() => usePreferences(), { wrapper })
  await waitFor(() => expect(r.result.current.loading).toBe(false))
  return r
}

beforeEach(() => { __setWorkspaceDocStampForTests(null) })
afterEach(() => { delete global.fetch; __setWorkspaceDocStampForTests(null) })

describe('the preferences read records whether the workspace document is armed', () => {
  it('ARMED: the header is recorded, and the body is served exactly as it came', async () => {
    respond({ 'x-workspace-doc': 'document; v=12' })
    const { result } = await mount()
    expect(isWorkspaceDocArmed()).toBe(true)
    expect(workspaceDocStamp()).toBe('document; v=12')
    expect(result.current.prefs.charts_theme).toBe('tv')
  })

  it('an armed FALLBACK read still says armed (the document is on; this read came from the old store)', async () => {
    respond({ 'x-workspace-doc': 'fallback; reason=absent' })
    await mount()
    expect(isWorkspaceDocArmed()).toBe(true)
  })

  it('DARK: no header, not armed — and exactly one request, the preferences read itself', async () => {
    __setWorkspaceDocStampForTests('document; v=1')         // a stale belief from an earlier read
    respond({})
    const { result } = await mount()
    expect(isWorkspaceDocArmed()).toBe(false)
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(String(global.fetch.mock.calls[0][0])).toBe('/api/auth/preferences')
    expect(result.current.prefs.theme).toBe('oled')
  })

  it('a response with no headers object at all (a test double, an old client path) reads as dark, never throws', async () => {
    __setWorkspaceDocStampForTests('document; v=1')
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ...BODY }) }))
    await mount()
    expect(isWorkspaceDocArmed()).toBe(false)
  })

  it('refreshPreferences records it too, in both directions', async () => {
    respond({ 'x-workspace-doc': 'document; v=3' })
    expect(await refreshPreferences()).toMatchObject(BODY)
    expect(isWorkspaceDocArmed()).toBe(true)
    respond({})
    await refreshPreferences()
    expect(isWorkspaceDocArmed()).toBe(false)
  })

  it('the header name is the one the server sends', () => {
    expect(WORKSPACE_DOC_HEADER).toBe('X-Workspace-Doc')
  })
})
