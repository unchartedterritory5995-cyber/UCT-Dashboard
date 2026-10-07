// P2 Track B Slice 1 — Create Indicator end to end in jsdom.
//
// The MODEL is scripted (`scriptedConverse`, answering from the compact view);
// everything else is real: Track A's engine, readback and save doors, the
// registry, `addInstance`. The two network functions of the save door are
// spied. ASKED / CLAIMED / DID per case.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import * as registry from '../../engine/nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { STUDIO_PREVIEW_DEF_ID } from './chartPreview'
import { scriptedConverse } from '../../../../testing/createIndicator/scriptedConverse'

const H = vi.hoisted(() => ({ saves: [] }))
vi.mock('../../../../hooks/useUserDefinitions', async (orig) => ({
  ...(await orig()),
  saveUserDefinition: vi.fn(async (doc, defId) => {
    H.saves.push({ doc, defId })
    return { ok: true, row: { def_id: 'u_aaaaaaaaaaaa', version: 1, rev: 1, semantics: 2 } }
  }),
}))

import CreateIndicatorPanel from './CreateIndicatorPanel'

const previewTree = () => JSON.stringify(registry.getDefinition(STUDIO_PREVIEW_DEF_ID) || null)

function mount(extra = {}) {
  const previews = []
  const writes = []
  const onClose = vi.fn()
  const settings = mergeChartSettings({})
  render(
    <CreateIndicatorPanel
      settings={settings}
      onChange={(next) => writes.push(next)}
      sym="AAPL" tf="D"
      onPreview={(inst) => previews.push(inst)}
      onClose={onClose}
      converse={scriptedConverse}
      {...extra}
    />,
  )
  return { previews, writes, onClose, settings }
}

async function say(text) {
  const input = screen.getByTestId('create-indicator-input')
  fireEvent.change(input, { target: { value: text } })
  await act(async () => { fireEvent.click(screen.getByTestId('create-indicator-send')) })
  await act(async () => {})
}

beforeEach(() => { H.saves.length = 0 })
afterEach(() => { cleanup(); registry.clearUserDefinitions() })

describe('Create Indicator — one conversation, one preview, one indicator', () => {
  it('opens simple: the prompt, examples and quiet doors; no form', () => {
    mount({ onOpenBuilder: () => {}, onOpenLibrary: () => {} })
    expect(screen.getByTestId('create-indicator-intro').textContent).toMatch(/Describe the indicator/)
    expect(screen.getByTestId('create-indicator-doors').textContent).toMatch(/Formula.*Import.*Library/)
    expect(screen.queryByTestId('create-indicator-readback')).toBeNull()
    expect(screen.getByTestId('create-indicator-save').disabled).toBe(true)
  })

  it('"Add a 20 EMA" → validated working definition, preview A, deterministic readback', async () => {
    const { previews, writes } = mount()
    await say('Add a 20 EMA')
    const inst = previews.filter(Boolean).at(-1)
    expect(inst.defId).toBe(STUDIO_PREVIEW_DEF_ID)
    expect(previewTree()).toContain('"value":20')
    const card = screen.getByTestId('create-indicator-readback')
    expect(card.textContent).toMatch(/EMA 20/)
    expect(card.textContent).toMatch(/On the price chart/)
    expect(card.querySelector('[data-output="value"]').textContent).toMatch(/^Line/)   // P1 type → member word
    expect(writes).toHaveLength(0)            // ⛔ preview is not a settings write
  })

  it('"Make it 50" PATCHES the same preview identity; Undo restores 20', async () => {
    const { previews } = mount()
    await say('Add a 20 EMA')
    const a = previews.filter(Boolean).at(-1)
    const lineage = screen.getByTestId('create-indicator').dataset.lineage
    await say('Make it 50')
    const b = previews.filter(Boolean).at(-1)
    expect(b.instanceId).toBe(a.instanceId)                        // same preview A
    expect(previewTree()).toContain('"value":50')
    expect(previewTree()).not.toContain('"value":20')
    expect(screen.getByTestId('create-indicator').dataset.lineage).toBe(lineage)
    expect(registry.listUserDefinitions().filter((d) => d.id === STUDIO_PREVIEW_DEF_ID)).toHaveLength(1)
    await act(async () => { fireEvent.click(screen.getByTestId('create-indicator-undo')) })
    expect(previewTree()).toContain('"value":20')
    expect(previews.filter(Boolean).at(-1).instanceId).toBe(a.instanceId)
  })

  it('an unsupported request (TABLE) is answered as a LIMIT in the conversation and changes nothing', async () => {
    mount()
    await say('Add a 20 EMA')
    const before = previewTree()
    await say('I want a 4x4 table of the last four quarters with EPS and revenue')
    const last = [...document.querySelectorAll('[data-role="uct"]')].at(-1)
    expect(last.dataset.kind).toBe('unsupported')      // SLICE 2: the assistant names the limit
    expect(last.dataset.updated).toBeUndefined()
    expect(last.textContent).toMatch(/can't draw a table/)
    expect(last.textContent).toMatch(/Nothing on the chart changed/)
    expect(previewTree()).toBe(before)
  })

  it('Cancel removes the preview from the registry and the chart, and writes nothing', async () => {
    const { previews, writes, onClose } = mount()
    await say('Add a 20 EMA')
    await act(async () => { fireEvent.click(screen.getByTestId('create-indicator-cancel')) })
    expect(previews.at(-1)).toBeNull()
    expect(registry.getDefinition(STUDIO_PREVIEW_DEF_ID)).toBeFalsy()
    expect(writes).toHaveLength(0)
    expect(H.saves).toHaveLength(0)
    expect(onClose).toHaveBeenCalled()
  })

  it('unmount (chart gone, panel closed any way) tears the preview down', async () => {
    const { previews } = mount()
    await say('Add a 20 EMA')
    cleanup()
    expect(previews.at(-1)).toBeNull()
    expect(registry.getDefinition(STUDIO_PREVIEW_DEF_ID)).toBeFalsy()
  })

  it('Add to Chart: ONE server save, ONE settings write with exactly ONE durable instance, no preview', async () => {
    const { previews, writes, onClose, settings } = mount()
    await say('Add a 20 EMA')
    await say('Make it 50')
    await act(async () => { fireEvent.click(screen.getByTestId('create-indicator-save')) })
    await act(async () => {})
    expect(H.saves).toHaveLength(1)
    expect(H.saves[0].defId).toBeNull()                                   // a create
    expect(JSON.stringify(H.saves[0].doc)).toContain('"value":50')
    expect(H.saves[0].doc.id).not.toBe(STUDIO_PREVIEW_DEF_ID)
    expect(writes).toHaveLength(1)
    const added = writes[0].indicatorInstances.filter((i) => !(settings.indicatorInstances || []).some((j) => j.instanceId === i.instanceId))
    expect(added).toHaveLength(1)
    expect(added[0].defId).toBe('u_aaaaaaaaaaaa')
    expect(JSON.stringify(writes[0])).not.toContain(STUDIO_PREVIEW_DEF_ID)
    expect(previews.at(-1)).toBeNull()
    expect(registry.getDefinition(STUDIO_PREVIEW_DEF_ID)).toBeFalsy()
    expect(onClose).toHaveBeenCalled()
  })
})
