// app/src/components/chart/builder/agentPreview.test.jsx — Agent M3 S3, gate G3
//
// ONE live authoring preview per browser tab, through the dock's own install step, on the
// REAL chart toolbar handle — replacement across two charts, target isolation, cleanup,
// reload, and zero persistence.
import { createRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { mergeChartSettings } from '../chartDefaults'
import { AuthContext } from '../../../context/AuthContext'
import * as registry from '../engine/nativeRegistry'
import { STUDIO_PREVIEW_DEF_ID } from './studio/chartPreview'
import { claimPreview, releasePreview, previewHolder, _resetPreviewChannel } from './studio/previewChannel'
import { _simulateReload, STORAGE_KEY } from './authoring/conversationSessions'
import { openDraft, draftTurn, draftUndo, saveDraft, discardDraft, showDraftPreview, clearDraftPreview, draftStatus, _resetDraftPreview } from './agentAuthoring'
import { storeConversation } from './conversationSave'
import STOCKCHART_SRC from '../../StockChart.jsx?raw'
import ChartToolbar from '../ChartToolbar'
import PANE_SRC from '../pane/ChartPane.jsx?raw'
import CHANNEL_SRC from './studio/previewChannel.js?raw'

const PATCH = 'uct.authoring.patch/1'
const close = { type: 'series', name: 'close' }
const rsi = (n) => ({ type: 'call', name: 'rsi', args: [close, { type: 'num', value: n }] })
const converse = async ({ message, state }) => {
  const env = (ops) => ({ ok: true, disposition: 'change', turn: 'patch', reply: '',
    envelope: { contract: PATCH, baseRevision: state.revision, ops, assumptions: [], disposition: 'change' } })
  if (/create rsi 28/i.test(message)) return env([{ op: 'create', name: 'RSI 28', placement: 'pane', outputs: [{ key: 'rsi', label: 'RSI 28', tree: rsi(28) }] }])
  return env([{ op: 'set_style', output: 'rsi', color: '#2962FF' }])
}
const ctx = (over = {}) => ({ canAuthor: true, definitionRows: [], sym: 'AMD', tf: 'D', converse, ...over })

function mountChart(chartId, { writable = true } = {}) {
  const ref = createRef()
  const onStudioPreview = vi.fn()
  const onUpdateSettings = vi.fn()
  const utils = render(
    <AuthContext.Provider value={{ isPaid: true, user: { id: 1, role: 'admin' }, loading: false }}>
      <ChartToolbar ref={ref} activeTool="cursor" setActiveTool={() => {}} chartId={chartId}
        chartSettings={mergeChartSettings(null)} onUpdateSettings={writable ? onUpdateSettings : undefined}
        onStudioPreview={onStudioPreview} />
    </AuthContext.Provider>,
  )
  return { ref, onStudioPreview, onUpdateSettings, unmount: utils.unmount }
}
const lastPreview = (spy) => (spy.mock.calls.length ? spy.mock.calls[spy.mock.calls.length - 1][0] : undefined)

beforeEach(() => {
  _resetPreviewChannel(); _resetDraftPreview(); _simulateReload()
  try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* */ }
  registry.uninstallUserDefinition(STUDIO_PREVIEW_DEF_ID)
})
afterEach(() => { cleanup(); registry.uninstallUserDefinition(STUDIO_PREVIEW_DEF_ID) })

describe('previewChannel — one holder per tab', () => {
  it('a new claim clears the previous holder first and reports where it moved from', () => {
    const cleared = []
    const a = {}; const b = {}
    expect(claimPreview(a, 'w-amd', () => cleared.push('amd'))).toEqual({ movedFrom: null })
    expect(claimPreview(b, 'w-nvda', () => cleared.push('nvda'))).toEqual({ movedFrom: 'w-amd' })
    expect(cleared).toEqual(['amd'])
    expect(previewHolder()).toEqual({ chartRef: 'w-nvda', kind: 'agent' })
    releasePreview(a)                                   // not the holder → no effect
    expect(previewHolder()).not.toBeNull()
    releasePreview(b)
    expect(previewHolder()).toBeNull()
  })
})

describe('⭐ the real chart handle — replacement, isolation, cleanup', () => {
  const draftWithRsi = async () => {
    const ref = openDraft({ create: true }, ctx()).draftRef
    await draftTurn(ref, 'Create RSI 28.', { expectedRevision: 0 }, ctx())
    return ref
  }
  it('the preview moves from chart A to chart B; A is cleared; B draws it; nothing is persisted', async () => {
    const A = mountChart('w-amd'); const B = mountChart('w-nvda')
    const ref = await draftWithRsi()
    let r
    act(() => { r = showDraftPreview(ref, { host: A.ref.current, chartRef: 'w-amd' }, ctx()) })
    expect(r).toEqual({ ok: true, chartRef: 'w-amd', movedFrom: null })
    expect(lastPreview(A.onStudioPreview)).toMatchObject({ defId: STUDIO_PREVIEW_DEF_ID })
    expect(registry.getDefinition(STUDIO_PREVIEW_DEF_ID)).toBeTruthy()
    act(() => { r = showDraftPreview(ref, { host: B.ref.current, chartRef: 'w-nvda' }, ctx()) })
    expect(r).toEqual({ ok: true, chartRef: 'w-nvda', movedFrom: 'w-amd' })
    expect(lastPreview(A.onStudioPreview)).toBeNull()                       // A lost it
    expect(lastPreview(B.onStudioPreview)).toMatchObject({ defId: STUDIO_PREVIEW_DEF_ID })
    // ⛔ never a settings write on either chart
    expect(A.onUpdateSettings).not.toHaveBeenCalled()
    expect(B.onUpdateSettings).not.toHaveBeenCalled()
  })
  it('an applied turn and an Undo refresh the preview; Undo to empty clears it', async () => {
    const A = mountChart('w-amd')
    const ref = await draftWithRsi()
    act(() => { showDraftPreview(ref, { host: A.ref.current, chartRef: 'w-amd' }, ctx()) })
    const before = A.onStudioPreview.mock.calls.length
    let t
    await act(async () => { t = await draftTurn(ref, 'Make the RSI line blue.', { expectedRevision: 1 }, ctx()) })
    expect(t.preview).toEqual({ refreshed: true, chartRef: 'w-amd' })
    expect(A.onStudioPreview.mock.calls.length).toBeGreaterThan(before)
    expect(JSON.stringify(registry.getDefinition(STUDIO_PREVIEW_DEF_ID))).toMatch(/2962FF/i)
    let u
    act(() => { u = draftUndo(ref, { expectedStepId: t.stepId }, ctx()) })
    expect(u.preview).toEqual({ refreshed: true, chartRef: 'w-amd' })
    expect(JSON.stringify(registry.getDefinition(STUDIO_PREVIEW_DEF_ID))).not.toMatch(/2962FF/i)
    act(() => { u = draftUndo(ref, { expectedStepId: draftStatus(ref, ctx()).undoStepId }, ctx()) })
    expect(u.preview).toEqual({ refreshed: false, cleared: true })
    expect(lastPreview(A.onStudioPreview)).toBeNull()
    expect(registry.getDefinition(STUDIO_PREVIEW_DEF_ID)).toBeFalsy()
  })
  it('cleared on Discard, on Save, on clearDraftPreview, and when the chart unmounts', async () => {
    const A = mountChart('w-amd')
    const r1 = await draftWithRsi()
    act(() => { showDraftPreview(r1, { host: A.ref.current, chartRef: 'w-amd' }, ctx()) })
    act(() => { discardDraft(r1, { expectedRevision: 1 }, ctx()) })
    expect(lastPreview(A.onStudioPreview)).toBeNull()
    expect(registry.getDefinition(STUDIO_PREVIEW_DEF_ID)).toBeFalsy()

    const r2 = await draftWithRsi()
    act(() => { showDraftPreview(r2, { host: A.ref.current, chartRef: 'w-amd' }, ctx()) })
    const save = async (doc) => ({ ok: true, row: { def_id: 'u_aaaaaaaaac01', version: 1, rev: 1 }, doc })
    const saveCtx = ctx({ store: (s, o) => storeConversation(s, { ...o, save }),
      readBack: async () => null })
    await act(async () => { await saveDraft(r2, { expectedRevision: 1 }, saveCtx) })
    expect(lastPreview(A.onStudioPreview)).toBeNull()

    const r3 = await draftWithRsi()
    act(() => { showDraftPreview(r3, { host: A.ref.current, chartRef: 'w-amd' }, ctx()) })
    expect(clearDraftPreview(r3)).toEqual({ ok: true, cleared: true })
    expect(clearDraftPreview(r3)).toEqual({ ok: true, cleared: false })

    act(() => { showDraftPreview(r3, { host: A.ref.current, chartRef: 'w-amd' }, ctx()) })
    expect(registry.getDefinition(STUDIO_PREVIEW_DEF_ID)).toBeTruthy()
    A.unmount()
    expect(registry.getDefinition(STUDIO_PREVIEW_DEF_ID)).toBeFalsy()
    expect(previewHolder()).toBeNull()
  })
  it('a read-only chart refuses; a dock holding the preview makes the Agent busy (the dock wins)', async () => {
    const RO = mountChart('w-ro', { writable: false })
    const A = mountChart('w-amd')
    const ref = await draftWithRsi()
    expect(showDraftPreview(ref, { host: RO.ref.current, chartRef: 'w-ro' }, ctx())).toMatchObject({ ok: false, reason: 'readonly' })
    claimPreview({ surface: 'dock' }, 'w-other', () => {}, 'dock')
    expect(showDraftPreview(ref, { host: A.ref.current, chartRef: 'w-amd' }, ctx())).toMatchObject({ ok: false, reason: 'busy' })
    expect(A.onStudioPreview).not.toHaveBeenCalled()
  })
  it('only on request: turns never show a preview by themselves; nothing to preview is refused', async () => {
    const A = mountChart('w-amd')
    const empty = openDraft({ create: true }, ctx()).draftRef
    expect(showDraftPreview(empty, { host: A.ref.current }, ctx())).toMatchObject({ ok: false, reason: 'nothing-to-preview' })
    const ref = await draftWithRsi()
    expect(A.onStudioPreview).not.toHaveBeenCalled()
    expect(registry.getDefinition(STUDIO_PREVIEW_DEF_ID)).toBeFalsy()
    expect(ref).toBeTruthy()
  })
  it('after a reload the preview is gone (StockChart state and the in-memory holder); the draft is not', async () => {
    const A = mountChart('w-amd')
    const ref = await draftWithRsi()
    act(() => { showDraftPreview(ref, { host: A.ref.current, chartRef: 'w-amd' }, ctx()) })
    A.unmount(); _simulateReload(); _resetPreviewChannel(); _resetDraftPreview()
    expect(previewHolder()).toBeNull()
    expect(draftStatus(ref, ctx())).toMatchObject({ recovered: true, revision: 1 })
  })
})

describe('rails', () => {
  it('the preview channel (imported EAGERLY by the toolbar) imports no save/edit-preview module — no load cycle', () => {
    const imports = CHANNEL_SRC.split(/\r?\n/).filter((l) => /^import /.test(l)).join('\n')
    expect(imports).not.toMatch(/editPreview|conversationSave|BuilderSheet|StockChart/)
  })
  it('StockChart strips the preview from every settings write, and forwards the two handles', () => {
    expect(STOCKCHART_SRC).toMatch(/stripPreview\(/)
    expect(STOCKCHART_SRC).toMatch(/showAuthoringPreview: \(definition, opts = \{\}\) => \{\s*try \{ return toolbarRef\.current\?\.showAuthoringPreview\?\.\(definition, opts\)/)
    expect(STOCKCHART_SRC).toMatch(/clearAuthoringPreview: \(\) => \{\s*try \{ return !!toolbarRef\.current\?\.clearAuthoringPreview\?\.\(\)/)
    expect(PANE_SRC).toMatch(/showAuthoringPreview: \(definition, opts = \{\}\) => \{ try \{ return paneToolbarApi\.current\?\.showAuthoringPreview\?\.\(definition, opts\)/)
    expect(PANE_SRC).toMatch(/clearAuthoringPreview: \(\) => \{ try \{ return !!paneToolbarApi\.current\?\.clearAuthoringPreview\?\.\(\)/)
  })
})
