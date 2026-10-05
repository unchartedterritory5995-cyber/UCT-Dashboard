// A6 — the doors back into a member's own Pine: "Edit script" from the
// indicator library and the chart legend (through the ONE builder sheet the
// toolbar owns), and "Duplicate" in My scripts. All behind the authoring gate.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { createRef, useState } from 'react'

import BuilderSheet from '../BuilderSheet'
import ChartToolbar from '../../ChartToolbar'
import IndicatorLibraryDialog from '../../IndicatorLibraryDialog'
import { chipMenuItems } from '../../legend/chipMenu'
import { mergeChartSettings } from '../../chartDefaults'
import { memberPaneDefinition } from '../memberPane/memberPaneDefinition'
import * as engineRegistry from '../../engine/nativeRegistry'
import { AuthContext } from '../../../../context/AuthContext'
import { __resetPineAuthoringPermission, __permitPineAuthoringForTests } from '../../engine/pineAuthoringGate'
import { PINE_SOURCE_FIELD } from './pineScripts'

const STORED = 'u_bbbbbbbbbbbb'
const COPY = 'u_eeeeeeeeeeee'
const BARE = 'u_cccccccccccc'
const SRC = '//@version=5\nindicator("Mine")\nlength = input.int(14, "Length", minval = 1)\nplot(ta.sma(close, length), "SMA")'

function storedDoc(id = STORED, withSource = true) {
  const base = memberPaneDefinition({ source: SRC, id }).definition
  return { ...base, id, meta: { ...base.meta, name: 'Saved one', ...(withSource ? { [PINE_SOURCE_FIELD]: SRC } : {}) } }
}

const H = vi.hoisted(() => ({ requests: [] }))
function stubFetch() {
  H.requests = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const method = init.method || 'GET'
    H.requests.push({ url: u, method, body: init.body ?? null })
    const ok = (body) => ({ ok: true, status: 200, json: async () => body })
    if (method === 'GET' && u.includes(`/api/user-definitions/${BARE}`)) {
      return ok({ def_id: BARE, version: 1, definition: storedDoc(BARE, false) })
    }
    if (method === 'GET' && /\/api\/user-definitions\/u_[0-9a-z]+(\?|$)/.test(u)) {
      return ok({ def_id: STORED, version: 2, definition: storedDoc() })
    }
    if (method === 'GET' && /\/api\/user-definitions(\?|$)/.test(u)) {
      const listed = storedDoc()
      return ok({
        definitions: [{
          def_id: STORED, version: 2, rev: 1, created_at: 200,
          pine_source: { bytes: SRC.length, licence: 'NONE-IN-SOURCE' },
          definition: { ...listed, meta: { ...listed.meta, [PINE_SOURCE_FIELD]: undefined } },
        }],
      })
    }
    if (method === 'GET') return ok({})
    if (method === 'POST') return ok({ def_id: COPY, version: 1, rev: 1, pine_source: { pine_source: 'stored' } })
    return ok({ def_id: COPY, version: 2, rev: 1, pine_source: { pine_source: 'stored' } })
  })
}
const writes = () => H.requests.filter((r) => r.method !== 'GET' && /user-definitions/.test(r.url))
const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}
const click = async (el) => { await act(async () => { fireEvent.click(el) }); await flush(); await flush() }

function Providers({ children }) {
  return (
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        {children}
      </SWRConfig>
    </AuthContext.Provider>
  )
}

function Sheet({ editScript }) {
  const [settings, setSettings] = useState({ indicatorInstances: [] })
  return (
    <Providers>
      <BuilderSheet open onClose={() => {}} onSaved={() => {}} settings={settings} onChange={setSettings}
        sym="SPY" tf="D" editScript={editScript} />
    </Providers>
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_AUTHORING_ENABLED', '1')
  stubFetch()
})
afterEach(() => {
  for (const id of [STORED, COPY, BARE]) engineRegistry.uninstallUserDefinition(id)
  __permitPineAuthoringForTests()
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs()
})

describe('A6 — BuilderSheet `editScript`: the library/legend door into the editor', () => {
  it('⭐ opens the stored script on the Pine Editor tab, as the edit target', async () => {
    render(<Sheet editScript={{ defId: STORED, at: 1 }} />)
    await flush(); await flush()
    expect(screen.getByRole('tab', { name: /^pine editor$/i }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByLabelText('Pine source').value).toBe(SRC)
    expect(H.requests.some((r) => r.method === 'GET' && r.url.includes(`/api/user-definitions/${STORED}`))).toBe(true)
  })

  it('⛔ a definition stored without its code says so, in the sheet\'s own sentence', async () => {
    render(<Sheet editScript={{ defId: BARE, at: 1 }} />)
    await flush(); await flush()
    expect(screen.getByTestId('pine-edit-script-error').textContent).toMatch(/saved without its Pine code/)
  })

  it('⛔ with authoring dark it does nothing — no tab, no read', async () => {
    vi.stubEnv('VITE_PINE_AUTHORING_ENABLED', '')
    render(<Sheet editScript={{ defId: STORED, at: 1 }} />)
    await flush(); await flush()
    expect(screen.queryByRole('tab', { name: /^pine editor$/i })).toBeNull()
    expect(H.requests.some((r) => r.url.includes(`/api/user-definitions/${STORED}`))).toBe(false)
  })
})

describe('A6 — Duplicate in My scripts', () => {
  it('⭐ stores a NEW definition carrying the same script, renamed, and opens the copy', async () => {
    render(<Sheet editScript={null} />)
    await flush()
    fireEvent.click(screen.getByRole('tab', { name: /^pine editor$/i }))
    await flush()
    await click(screen.getByTestId('pine-my-scripts-toggle'))
    await click(screen.getByTestId('pine-script-duplicate'))
    const posts = writes().filter((r) => r.method === 'POST')
    expect(posts).toHaveLength(1)
    const doc = JSON.parse(posts[0].body).definition
    expect(doc.meta[PINE_SOURCE_FIELD]).toBe(SRC)
    expect(doc.meta.name).toBe('Saved one copy')
    // ⛔ a create, never a PUT over the original
    expect(writes().some((r) => r.method === 'PUT')).toBe(false)
    expect(screen.getByLabelText('Pine source').value).toBe(SRC)
    // …and the editor now points at the COPY: the next Apply updates it, not the original
    expect(screen.getByTestId('pine-editor-name').value).toBe('Saved one copy')
  })
})

describe('A6 — the indicator library row', () => {
  function Library({ onEditScript, onChange = () => {} }) {
    return (
      <Providers>
        <IndicatorLibraryDialog open onClose={() => {}} settings={mergeChartSettings({})} onChange={onChange}
          registry={engineRegistry} onEditScript={onEditScript} />
      </Providers>
    )
  }
  beforeEach(() => {
    const { installed } = engineRegistry.installUserDefinitions([storedDoc()])
    expect(installed.map((d) => d.id)).toEqual([STORED])
  })

  it('⭐ "Edit script" on the member\'s own Pine row, and it does not toggle the row', async () => {
    const onEdit = vi.fn()
    const onChange = vi.fn()
    render(<Library onEditScript={onEdit} onChange={onChange} />)
    await flush(); await flush()
    const btn = screen.getByTestId('library-edit-script')
    expect(btn.closest('[data-def-id]').getAttribute('data-def-id')).toBe(STORED)
    fireEvent.click(btn)
    expect(onEdit).toHaveBeenCalledWith(STORED)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('⛔ no door, no row: without `onEditScript` the button does not exist', async () => {
    render(<Library onEditScript={undefined} />)
    await flush(); await flush()
    expect(screen.queryByTestId('library-edit-script')).toBeNull()
  })
})

describe('A6 — the legend chip menu row', () => {
  const chip = { instanceId: 'i1', defId: STORED, label: 'Saved one', hidden: false }
  const h = {
    onSettings() {}, onToggleHidden() {}, onMove() {}, onDuplicate() {}, onAlerts() {}, onAbout() {}, onRemove() {},
  }
  it('⭐ offered when the caller says the host can open it, and fires with the instance', () => {
    const onEditScript = vi.fn()
    const rows = chipMenuItems(chip, storedDoc(), { ...h, onEditScript }, { editScript: true })
    const row = rows.find((r) => r.key === 'editScript')
    expect(row && row.label).toBe('Edit script')
    row.onClick()
    expect(onEditScript).toHaveBeenCalledWith('i1')
  })
  it('⛔ absent otherwise — a native indicator\'s menu is unchanged', () => {
    expect(chipMenuItems(chip, storedDoc(), { ...h, onEditScript() {} }, {}).some((r) => r.key === 'editScript')).toBe(false)
    expect(chipMenuItems(chip, storedDoc(), h, { editScript: true }).some((r) => r.key === 'editScript')).toBe(false)
  })
})

describe('A6 — ChartToolbar owns the door (one builder sheet)', () => {
  function mountToolbar() {
    const ref = createRef()
    render(
      <Providers>
        <ChartToolbar ref={ref} activeTool="cursor" setActiveTool={() => {}}
          chartSettings={mergeChartSettings({})} onUpdateSettings={() => {}} />
      </Providers>,
    )
    return ref
  }
  it('⭐ authoring on: the legend may ask, and the door opens the builder', async () => {
    const ref = mountToolbar()
    expect(ref.current.canEditPineScripts()).toBe(true)
    let opened
    await act(async () => { opened = ref.current.openPineScript(STORED) })
    expect(opened).toBe(true)
  })
  it('⛔ authoring dark (stage not latched): the row is not offered and the door refuses', () => {
    __resetPineAuthoringPermission()
    const ref = mountToolbar()
    expect(ref.current.canEditPineScripts()).toBe(false)
    expect(ref.current.openPineScript(STORED)).toBe(false)
  })
})
