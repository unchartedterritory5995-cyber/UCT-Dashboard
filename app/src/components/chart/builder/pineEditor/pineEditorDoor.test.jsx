// A1 — the Pine Editor tab on the REAL builder sheet: dark by default, and when
// armed, Apply walks the attach doors (create + instance), then UPDATES the same
// stored definition in place (PUT, no second instance, no hand-back that would
// close the sheet mid-edit).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { useState } from 'react'

import BuilderSheet from '../BuilderSheet'
import { PINE_DEBOUNCE_MS } from '../PineBox'
import { memberPaneDefinition } from '../memberPane/memberPaneDefinition'
import * as engineRegistry from '../../engine/nativeRegistry'
import { AuthContext } from '../../../../context/AuthContext'

const STORED = 'u_aaaaaaaaaaaa'
const V1 = '//@version=5\nindicator("Mine")\nlen = input.int(14, "Len")\nplot(ta.rsi(close, len), "RSI")'
const V2 = '//@version=5\nindicator("Mine")\nlen = input.int(14, "Len")\nplot(ta.sma(close, len), "SMA")'

const H = vi.hoisted(() => ({ requests: [] }))
function stubFetch() {
  H.requests = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    H.requests.push({ url: String(url), method, body: init.body ?? null })
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: [] }) }
    const version = method === 'PUT' ? 2 : 1
    return { ok: true, status: 200, json: async () => ({ def_id: STORED, version, rev: version }) }
  })
}
const writes = () => H.requests.filter((r) => r.method !== 'GET' && /user-definitions/.test(r.url))
const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}
const settle = async () => { await act(async () => { vi.advanceTimersByTime(PINE_DEBOUNCE_MS + 1) }); await flush() }

const seen = { saved: 0, closed: 0, changes: [] }
function Host() {
  const [settings, setSettings] = useState({ indicatorInstances: [] })
  return (
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet
          open
          onClose={() => { seen.closed += 1 }}
          onSaved={() => { seen.saved += 1 }}
          settings={settings}
          onChange={(next) => { seen.changes.push(next); setSettings(next) }}
          sym="SPY"
          tf="D"
        />
      </SWRConfig>
    </AuthContext.Provider>
  )
}

beforeEach(() => {
  seen.saved = 0; seen.closed = 0; seen.changes = []
  vi.useFakeTimers()
  stubFetch()
})
afterEach(() => {
  engineRegistry.uninstallUserDefinition(STORED)
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs()
})

describe('A1 — the Pine Editor tab', () => {
  it('⛔ DARK BY DEFAULT: no tab without the flag; the same mount shows it with the flag', async () => {
    vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
    render(<Host />)
    await flush()
    // ⛔ NON-VACUITY: the tab strip itself rendered (its Import tab is there).
    expect(screen.getByRole('tab', { name: /^import$/i })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: /^pine editor$/i })).toBe(null)
    cleanup()

    vi.stubEnv('VITE_PINE_AUTHORING_ENABLED', '1')
    render(<Host />)
    await flush()
    expect(screen.getByRole('tab', { name: /^pine editor$/i })).toBeTruthy()
  })

  it('⛔ only the literal "1" arms it', async () => {
    for (const v of ['true', '0', 'yes', ' 1']) {
      vi.stubEnv('VITE_PINE_AUTHORING_ENABLED', v)
      render(<Host />)
      await flush()
      expect(screen.queryByRole('tab', { name: /^pine editor$/i })).toBe(null)
      cleanup()
    }
  })

  it('⭐⭐ Apply creates once, then UPDATES the same definition in place', async () => {
    vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_AUTHORING_ENABLED', '1')
    render(<Host />)
    await flush()
    fireEvent.click(screen.getByRole('tab', { name: /^pine editor$/i }))
    await flush()

    // the formula box steps aside in this tab; the pane preview has no second "Add"
    expect(screen.queryByTestId('formula-editor')).toBe(null)

    fireEvent.change(screen.getByLabelText('Pine source'), { target: { value: V1 } })
    await settle()
    expect(screen.queryByTestId('pine-member-pane-attach')).toBe(null)

    const apply = () => screen.getByTestId('pine-editor-apply')
    expect(apply().textContent).toBe('Add to chart')
    await act(async () => { fireEvent.click(apply()) })
    await flush(); await flush()

    // ── first apply: a CREATE, the door's own document, one instance ──
    expect(writes()).toHaveLength(1)
    expect(writes()[0].method).toBe('POST')
    const posted = JSON.parse(writes()[0].body).definition
    const want = memberPaneDefinition({ source: V1, id: 'u_member-pane' }).definition
    expect(posted.compute).toEqual(want.compute)
    expect(seen.changes).toHaveLength(1)
    expect(seen.changes[0].indicatorInstances.map((i) => i.defId)).toEqual([STORED])
    expect(screen.getByTestId('pine-editor-applied').textContent).toBe('Added to your chart.')

    // ── edit, apply again: a PUT to the SAME id, no second instance ──
    fireEvent.change(screen.getByLabelText('Pine source'), { target: { value: V2 } })
    await settle()
    expect(apply().textContent).toBe('Update on chart')
    await act(async () => { fireEvent.click(apply()) })
    await flush(); await flush()

    expect(writes()).toHaveLength(2)
    expect(writes()[1].method).toBe('PUT')
    expect(writes()[1].url).toMatch(new RegExp(`/${STORED}$`))
    const put = JSON.parse(writes()[1].body).definition
    expect(put.id).toBe(STORED)
    expect(put.compute).toEqual(memberPaneDefinition({ source: V2, id: STORED }).definition.compute)
    expect(seen.changes).toHaveLength(1)                       // no second instance
    expect(engineRegistry.listUserDefinitions().some((d) => d.id === STORED)).toBe(true)
    expect(screen.getByTestId('pine-editor-applied').textContent).toBe('Updated on your chart.')

    // ⛔ the editor is a loop: no hand-back, so the host does not close the sheet
    expect(seen.saved).toBe(0)
    expect(seen.closed).toBe(0)
  })
})
