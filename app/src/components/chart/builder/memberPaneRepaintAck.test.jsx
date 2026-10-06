// app/src/components/chart/builder/memberPaneRepaintAck.test.jsx
//
// ─── P0 GATE (pineack) — DECISION D: THE PINE MEMBER-PANE DOOR'S REPAINT
// ACKNOWLEDGEMENT, AND THE HTF FOLD NOTE'S HUMAN HEADING ─────────────────────
//
// The server (`user_definitions._admit_new_maths`) refuses a NEW-MATHS save of
// a `preview-repaints` document without `repaint_acknowledged` (422
// `repaint-ack`) and refuses `repaints` outright (422 `repaint`). The fake
// store below applies EXACTLY those two rules to the request body, so these
// cases prove what the door SENDS; `tests/test_p0_truth_pineack.py` proves the
// real server's answer to the same three documents.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet from './BuilderSheet'
import { PINE_DEBOUNCE_MS } from './PineBox'
import { memberPaneDefinition } from './memberPane/memberPaneDefinition'
import { AuthContext } from '../../../context/AuthContext'
import { FOLD_LABELS } from '../engine/ast/parse'

const PINE = {
  // ASKED: a plain SMA. measured `non-repainting`.
  clean: '//@version=5\nindicator("t")\nplot(ta.sma(close, 5))\n',
  // ASKED: a weekly value with lookahead ON. measured `preview-repaints`.
  preview: '//@version=5\nindicator("t")\nplot(request.security(syminfo.tickerid, "W", close, lookahead=barmerge.lookahead_on))\n',
  // ASKED: a value only on the last bar. measured `repaints`.
  repaints: '//@version=5\nindicator("t")\nplot(bar_index == last_bar_index ? close : na)\n',
  // ASKED: a weekly value with lookahead OFF (the HTF step-back fold note).
  htfOff: '//@version=5\nindicator("t")\nplot(request.security(syminfo.tickerid, "W", close))\n',
}

const H = vi.hoisted(() => ({ requests: [] }))
function stubFetch() {
  H.requests = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    H.requests.push({ url: String(url), method, body: init.body ?? null })
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: [] }) }
    const body = JSON.parse(init.body)
    const mode = body.definition && body.definition.meta && body.definition.meta.repaint
    if (mode === 'repaints') {
      return { ok: false, status: 422, json: async () => ({ detail: "plot 'value' measures 'repaints': a formula whose past values can change after the fact is not saved", refusal: { gate: 'repaint' } }) }
    }
    if (mode === 'preview-repaints' && body.repaint_acknowledged !== true) {
      return { ok: false, status: 422, json: async () => ({ detail: "plot 'value' measures 'preview-repaints' and the author has not acknowledged that badge", refusal: { gate: 'repaint-ack' } }) }
    }
    return { ok: true, status: 200, json: async () => ({ def_id: 'u_aaaaaaaaaaaa', version: 1, rev: 1 }) }
  })
}
const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}
function mount() {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} onSaved={() => {}} settings={null} onChange={() => {}} sym="SPY" tf="D" />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}
async function paste(script) {
  fireEvent.click(screen.getByRole('tab', { name: /^import$/i }))
  fireEvent.change(screen.getByTestId('pine-box').querySelector('textarea'), { target: { value: script } })
  await act(async () => { vi.advanceTimersByTime(PINE_DEBOUNCE_MS + 1) })
  await flush()
}
const attachBox = () => screen.getByTestId('pine-member-pane-attach')
const attachButton = () => attachBox().querySelector('button')
const posts = () => H.requests.filter((r) => r.method !== 'GET')
const lastBody = () => JSON.parse(posts()[posts().length - 1].body)

beforeEach(() => {
  vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
  vi.useFakeTimers()
  stubFetch()
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('P0 gate D — the member-pane door acknowledges a preview repaint', () => {
  it('the three fixtures measure what the cases below assume', () => {
    const mode = (s) => memberPaneDefinition({ source: s, id: 'u_member-pane' }).definition.meta.repaint
    expect(mode(PINE.clean)).toBe('non-repainting')
    expect(mode(PINE.preview)).toBe('preview-repaints')
    expect(mode(PINE.repaints)).toBe('repaints')
  })

  it('VALUE — non-repainting Pine: no acknowledgement control, attaches, sends no ack', async () => {
    mount()
    await paste(PINE.clean)
    expect(screen.queryByTestId('pine-member-pane-repaint-ack')).toBeNull()
    expect(attachButton().disabled).toBe(false)
    fireEvent.click(attachButton())
    await flush(); await flush()
    expect(posts()).toHaveLength(1)
    expect('repaint_acknowledged' in lastBody()).toBe(false)
    expect(attachBox().textContent).not.toMatch(/refused|not acknowledged/)
  })

  it('REFUSAL — preview-repaints Pine without the tick: button disabled, nothing posted', async () => {
    mount()
    await paste(PINE.preview)
    expect(attachBox().textContent).toContain('This script can repaint recent signals.')
    const box = screen.getByTestId('pine-member-pane-repaint-ack')
    expect(box.checked).toBe(false)
    expect(box.closest('label').textContent).toContain('I understand this indicator may repaint')
    expect(attachButton().disabled).toBe(true)
    fireEvent.click(attachButton())
    await flush(); await flush()
    expect(posts()).toHaveLength(0)
  })

  it('VALUE — preview-repaints Pine WITH the tick: sends repaint_acknowledged and attaches', async () => {
    mount()
    await paste(PINE.preview)
    fireEvent.click(screen.getByTestId('pine-member-pane-repaint-ack'))
    expect(attachButton().disabled).toBe(false)
    fireEvent.click(attachButton())
    await flush(); await flush()
    expect(posts()).toHaveLength(1)
    const body = lastBody()
    expect(body.repaint_acknowledged).toBe(true)
    expect(attachBox().textContent).not.toMatch(/not acknowledged/)
  })

  it('REFUSAL — hard `repaints` Pine: no checkbox, no ack sent, the store refusal shown verbatim', async () => {
    mount()
    await paste(PINE.repaints)
    expect(screen.queryByTestId('pine-member-pane-repaint-ack')).toBeNull()
    fireEvent.click(attachButton())
    await flush(); await flush()
    expect(posts()).toHaveLength(1)
    expect('repaint_acknowledged' in lastBody()).toBe(false)
    expect(screen.getByRole('alert').textContent).toMatch(/measures 'repaints'/)
  })
})

describe('P0 gate — fold notes print a human heading, not the channel key', () => {
  it('DISCLOSED DIFFERENCE — HTF lookahead-off: heading is human copy, the raw key is not printed', async () => {
    mount()
    await paste(PINE.htfOff)
    const box = screen.getByTestId('pine-box')
    expect(box.textContent).toContain(FOLD_LABELS.htfLookaheadOffStepBacks)
    expect(FOLD_LABELS.htfLookaheadOffStepBacks).toBe('Higher-timeframe timing differs from TradingView')
    expect(box.textContent).not.toContain('htfLookaheadOffStepBacks')
  })
})
