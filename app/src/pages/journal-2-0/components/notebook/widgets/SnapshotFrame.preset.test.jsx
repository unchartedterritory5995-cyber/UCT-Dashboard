// Notebook widgets Task 17: "Save these settings as a preset" on a snapshot frame, by rendered text.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, renderHook } from '@testing-library/react'
import SnapshotFrame, { useSnapshotFrame } from './SnapshotFrame'
import { latchNotebookFlags, __resetNotebookFlags } from '../../../lib/offline/notebookFlags'
import { __resetSetsCache, CHART_SETS_PREF } from '../../../lib/notebookSets'

const realFetch = global.fetch
afterEach(() => { global.fetch = realFetch; __resetNotebookFlags(); __resetSetsCache() })

const ATTRS = { params: { asOf: '2026-10-20T14:00:00Z', source: 'market', listLabel: 'Flagged', rows: [{ sym: 'NVDA' }], share: true } }
const hook = (opts) => renderHook(() => useSnapshotFrame('myWatchlistToday', ATTRS, opts)).result.current

describe('Save these settings as a preset', () => {
  it('is offered only on an editable snapshot, and only while wave 5 is on', () => {
    expect(hook({ editable: true, onUpdateParams: vi.fn() }).onSavePreset).toBeUndefined()
    latchNotebookFlags({ notebook_widgets_w5_enabled: true })
    expect(hook({ editable: false, onUpdateParams: vi.fn() }).onSavePreset).toBeUndefined()
    expect(typeof hook({ editable: true, onUpdateParams: vi.fn() }).onSavePreset).toBe('function')
  })

  it('names the preset, saves the settings only, and says how to use it', async () => {
    latchNotebookFlags({ notebook_widgets_w1_enabled: true, notebook_widgets_w5_enabled: true })
    const posts = []
    global.fetch = vi.fn(async (url, init = {}) => {
      if (init.method === 'POST') { posts.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({}) } }
      return { ok: true, status: 200, json: async () => ({ [CHART_SETS_PREF]: JSON.stringify({ v: 1, sets: [], presets: [] }) }) }
    })
    const props = hook({ editable: true, onUpdateParams: vi.fn() })
    render(<SnapshotFrame {...props}><span>rows</span></SnapshotFrame>)
    fireEvent.click(screen.getByRole('button', { name: 'Save these settings as a preset' }))
    fireEvent.change(screen.getByLabelText('Preset name'), { target: { value: 'Flagged only' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save preset' }))
    expect(await screen.findByText('Saved as a preset. Type /preset to use it.')).toBeInTheDocument()
    const value = JSON.parse(posts[0].value)
    expect(value.presets).toEqual([expect.objectContaining({ name: 'Flagged only', kind: 'myWatchlistToday',
      params: { list: 'flagged', share: false } })])
  })

  it('a nameless preset is refused in words', async () => {
    latchNotebookFlags({ notebook_widgets_w5_enabled: true })
    global.fetch = vi.fn()
    const props = hook({ editable: true, onUpdateParams: vi.fn() })
    render(<SnapshotFrame {...props}><span>rows</span></SnapshotFrame>)
    fireEvent.click(screen.getByRole('button', { name: 'Save these settings as a preset' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save preset' }))
    expect(await screen.findByText('Give the preset a name.')).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
