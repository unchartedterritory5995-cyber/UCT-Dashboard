// V1 — History beside Undo in the Create Indicator dock.
//
// A member three changes in could only walk back one press at a time, reading the
// chart after each to see where they were. The History list names every earlier step
// by the read-back's own sentence and returns to any of them in one press.
//
// The MODEL is scripted; the engine, the read-back and the registry are real.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import * as registry from '../../engine/nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { STUDIO_PREVIEW_DEF_ID } from './chartPreview'
import { scriptedConverse } from '../../../../testing/createIndicator/scriptedConverse'
import { newAuthoringState, undo, undoTo } from '../authoring'
import { historySteps, goBackToTurn } from '../authoring/authoringSession'

const H = vi.hoisted(() => ({ saves: [], actions: [] }))
vi.mock('../../../../hooks/useUserDefinitions', async (orig) => ({
  ...(await orig()),
  saveUserDefinition: vi.fn(async (doc, defId) => {
    H.saves.push({ doc, defId })
    return { ok: true, row: { def_id: 'u_aaaaaaaaaaaa', version: 1, rev: 1, semantics: 2 } }
  }),
}))
vi.mock('../authoring/studioTelemetry', async (orig) => ({
  ...(await orig()),
  logStudioAction: vi.fn((_lineage, action) => { H.actions.push(action) }),
}))

import CreateIndicatorPanel from './CreateIndicatorPanel'

const previewTree = () => JSON.stringify(registry.getDefinition(STUDIO_PREVIEW_DEF_ID) || null)

function mount() {
  const writes = []
  render(
    <CreateIndicatorPanel
      settings={mergeChartSettings({})}
      onChange={(next) => writes.push(next)}
      sym="AAPL" tf="D"
      onPreview={() => {}}
      onClose={() => {}}
      converse={scriptedConverse}
    />,
  )
  return { writes }
}

async function say(text) {
  fireEvent.change(screen.getByTestId('create-indicator-input'), { target: { value: text } })
  await act(async () => { fireEvent.click(screen.getByTestId('create-indicator-send')) })
  await act(async () => {})
}
const click = async (el) => { await act(async () => { fireEvent.click(el) }) }
const rows = () => screen.queryAllByTestId('create-indicator-history-step')

beforeEach(() => { H.saves.length = 0; H.actions.length = 0 })
afterEach(() => { cleanup(); registry.clearUserDefinitions() })

describe('History in the dock', () => {
  it('is not offered until there is more than one step to go back to', async () => {
    mount()
    expect(screen.queryByTestId('create-indicator-history-toggle')).toBeNull()
    await say('Add a 20 EMA')
    // one step back is what Undo already does
    expect(screen.queryByTestId('create-indicator-history-toggle')).toBeNull()
    await say('Make it 50')
    expect(screen.getByTestId('create-indicator-history-toggle')).toBeInTheDocument()
    expect(rows()).toHaveLength(0)                       // closed until asked for
  })

  it('lists every earlier step, newest first, in the read-back\'s words', async () => {
    mount()
    await say('Add a 20 EMA')
    await say('Make it 50')
    await say('Make it 100')
    await click(screen.getByTestId('create-indicator-history-toggle'))
    const r = rows()
    expect(r.map((x) => x.dataset.step)).toEqual(['3', '2', '1'])
    expect(r[0].textContent).toMatch(/50/)               // before "make it 100"
    expect(r[1].textContent).toMatch(/20/)               // before "make it 50"
    expect(r[2].textContent).toMatch(/Before anything was built/)
    expect(r[0].textContent).not.toMatch(/100/)
  })

  it('one press returns to that step: the preview, the card and the list all follow', async () => {
    const { writes } = mount()
    await say('Add a 20 EMA')
    await say('Make it 50')
    await say('Make it 100')
    expect(previewTree()).toContain('"value":100')
    await click(screen.getByTestId('create-indicator-history-toggle'))
    const twenty = rows().find((x) => x.dataset.step === '2')
    await click(twenty.querySelector('[data-testid="create-indicator-history-go"]'))
    expect(previewTree()).toContain('"value":20')
    expect(previewTree()).not.toContain('"value":100')
    expect(screen.getByTestId('create-indicator-readback').textContent).toMatch(/EMA 20/)
    expect(rows()).toHaveLength(0)                       // the list closed on the pick
    // one step is left (the empty start), so the list is no longer offered; Undo is
    expect(screen.queryByTestId('create-indicator-history-toggle')).toBeNull()
    expect(screen.getByTestId('create-indicator-undo').disabled).toBe(false)
    const last = [...document.querySelectorAll('[data-role="uct"]')].at(-1)
    expect(last.textContent).toMatch(/Went back 2 changes/)
    expect(writes).toHaveLength(0)                       // ⛔ going back saves nothing
    expect(H.saves).toHaveLength(0)
    expect(H.actions.filter((a) => a === 'undone')).toHaveLength(1)
  })

  it('the conversation carries on from the step it went back to', async () => {
    mount()
    await say('Add a 20 EMA')
    await say('Make it 50')
    await say('Make it 100')
    await click(screen.getByTestId('create-indicator-history-toggle'))
    await click(rows().find((x) => x.dataset.step === '2').querySelector('button'))
    await say('Make it 30')
    expect(previewTree()).toContain('"value":30')
    await click(screen.getByTestId('create-indicator-history-toggle'))
    expect(rows().map((x) => x.dataset.step)).toEqual(['2', '1'])
    expect(rows()[0].textContent).toMatch(/20/)
  })

  it('Close and Escape shut the list without changing anything', async () => {
    mount()
    await say('Add a 20 EMA')
    await say('Make it 50')
    const before = previewTree()
    await click(screen.getByTestId('create-indicator-history-toggle'))
    await click(screen.getByTestId('create-indicator-history-close'))
    expect(rows()).toHaveLength(0)
    await click(screen.getByTestId('create-indicator-history-toggle'))
    await act(async () => { fireEvent.keyDown(screen.getByTestId('create-indicator-history'), { key: 'Escape' }) })
    expect(rows()).toHaveLength(0)
    expect(previewTree()).toBe(before)
  })
})

describe('the list never moves the footer (read from the stylesheet)', () => {
  // jsdom lays nothing out, so this cannot be shown by rendering. Measured on production
  // 2026-11-16: as a block in the column, the open list put Undo and Add to Chart below
  // the edge of a 444px dock.
  const css = fs.readFileSync(path.resolve(__dirname, './CreateIndicatorPanel.module.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const rule = (sel) => { const m = css.match(new RegExp(`(?:^|\\n)\\${sel} \\{([^}]*)\\}`)); return m ? m[1] : null }

  it('the list is taken out of the column and anchored above the footer row', () => {
    const r = rule('.history')
    expect(r, 'no .history rule').not.toBeNull()
    expect(r).toMatch(/position:\s*absolute/)
    expect(r).toMatch(/bottom:\s*58px/)
    expect(r).toMatch(/max-height:\s*calc\(100% - 130px\)/)
    expect(r).not.toMatch(/flex:\s*none/)
  })

  it('both panel variants are positioned, so there is something to anchor to', () => {
    expect(rule('.panel')).toMatch(/position:\s*fixed/)
    expect(rule('.panelDocked')).toMatch(/position:\s*relative/)
  })

  it('⛔ CONTROL: the reader tells a block rule from an anchored one', () => {
    expect('.history {\n  flex: none;\n}').not.toMatch(/position:\s*absolute/)
    expect(rule('.noSuchRule')).toBeNull()
  })
})

describe('the state functions under it', () => {
  const snap = (n) => ({ revision: n, working: { id: `d${n}` }, intent: null, requests: {}, assumptions: [], questions: [] })
  const st = (n) => Object.freeze({ ...newAuthoringState(), revision: n, working: { id: `d${n}` },
    history: Array.from({ length: n }, (_, i) => snap(i)) })

  it('undoTo(last) is undo, exactly', () => {
    const s = st(4)
    expect(undoTo(s, 3)).toEqual(undo(s))
  })

  it('undoTo restores that snapshot\'s own object, drops it and everything after, and moves the revision forward', () => {
    const s = st(4)
    const back = undoTo(s, 1)
    expect(back.working).toBe(s.history[1].working)
    expect(back.history).toEqual(s.history.slice(0, 1))
    expect(back.revision).toBe(5)
    expect(back.restoredFrom).toBe(1)
  })

  it('an index that names nothing returns the SAME state', () => {
    const s = st(2)
    for (const bad of [-1, 2, 1.5, '1', null, undefined]) expect(undoTo(s, bad)).toBe(s)
    expect(goBackToTurn(s, 9)).toBeNull()
  })

  it('historySteps says an empty start is empty and numbers from one', () => {
    const s = Object.freeze({ ...newAuthoringState(), revision: 1, working: { id: 'x' },
      history: [{ revision: 0, working: null, intent: null, requests: {}, assumptions: [], questions: [] }] })
    expect(historySteps(s)).toEqual([{ index: 0, step: 1, empty: true, name: null, lines: [] }])
    expect(historySteps(newAuthoringState())).toEqual([])
  })
})
