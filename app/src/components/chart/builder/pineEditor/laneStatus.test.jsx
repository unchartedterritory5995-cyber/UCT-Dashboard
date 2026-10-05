// A7 — the Pine Editor's lane line: which lane will draw the script, or why
// none will, read off the member door's own answer (never re-derived).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { useState } from 'react'

import { laneStatus } from './authoringDiagnostics'
import PineEditor from './PineEditor'
import { PINE_DEBOUNCE_MS } from '../PineBox'
import { memberPaneDefinition } from '../memberPane/memberPaneDefinition'

const HOST = '//@version=5\nindicator("x")\nplot(ta.sma(close, 14), "SMA")'
const REFUSED = '//@version=5\nindicator("x")\nplot(ta.foo(close, 14))'
// A loop the host lane's single expression cannot hold, so the per-bar lane is asked.
const LOOPED = '//@version=5\nindicator("x")\ns = 0.0\nfor i = 0 to 9\n    s := s + close[i]\nplot(s)'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs() })

describe('A7 — laneStatus reads the door\'s own answer', () => {
  it('⭐ host lane: an accepted document without a lane stamp', () => {
    const built = memberPaneDefinition({ source: HOST, id: 'u_member-pane_t' })
    expect(built.ok).toBe(true)
    expect(laneStatus(built)).toEqual({ lane: 'host', text: expect.stringMatching(/^Drawn by the host lane/) })
  })

  it('⭐ per-bar lane: the runtime document (`lane: \'runtime\'`), with what it withholds', () => {
    const s = laneStatus({ ok: true, lane: 'runtime', withheld: ['fill 1'] })
    expect(s.lane).toBe('runtime')
    expect(s.text).toMatch(/^Drawn by the per-bar lane/)
    expect(s.text).toContain('Not drawn from it: fill 1.')
  })

  it('⛔ refused: the door\'s reason, VERBATIM', () => {
    const built = memberPaneDefinition({ source: REFUSED, id: 'u_member-pane_t' })
    expect(built.ok).toBe(false)
    expect(laneStatus(built)).toEqual({ lane: 'none', text: `Not drawn: ${built.reason}.` })
  })

  it('⭐ a REAL per-bar document: the loop the host lane cannot hold, with the runtime pane on', () => {
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const built = memberPaneDefinition({ source: LOOPED, id: 'u_member-pane_t' })
    expect(built.ok).toBe(true)
    expect(built.lane).toBe('runtime')
    expect(laneStatus(built).lane).toBe('runtime')
  })

  it('⛔ …and with the runtime pane off the same script is the refusal of the host lane, verbatim', () => {
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
    const built = memberPaneDefinition({ source: LOOPED, id: 'u_member-pane_t' })
    expect(built.ok).toBe(false)
    expect(laneStatus(built)).toEqual({ lane: 'none', text: `Not drawn: ${built.reason}.` })
  })

  it('a synthetic decline the reason does not already quote is appended once', () => {
    const s = laneStatus({ ok: false, reason: 'host says no', runtimeDeclined: { code: 'runtime:x', why: 'lane says no' } })
    expect(s.text).toBe('Not drawn: host says no. The per-bar lane declined it too: lane says no')
    const once = laneStatus({ ok: false, reason: 'host says no — and the per-bar lane that could draw it declined: lane says no', runtimeDeclined: { code: 'runtime:x', why: 'lane says no' } })
    expect(once.text.split('lane says no')).toHaveLength(2)
  })

  it('nothing built, nothing said', () => {
    expect(laneStatus(null)).toBeNull()
  })
})

describe('A7 — the line on the mounted editor', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1') })
  function Host({ initial }) {
    const [v, setV] = useState(initial)
    return <PineEditor value={v} onChange={setV} />
  }
  it('⭐ settles, then names the lane; nothing is claimed while a settle is pending', async () => {
    render(<Host initial={HOST} />)
    await act(async () => { vi.advanceTimersByTime(PINE_DEBOUNCE_MS + 1) })
    const line = screen.getByTestId('pine-editor-lane')
    expect(line.dataset.lane).toBe('host')
    expect(line.textContent).toMatch(/^Drawn by the host lane/)
  })
  it('⛔ a refused script names no lane and says why', async () => {
    render(<Host initial={REFUSED} />)
    await act(async () => { vi.advanceTimersByTime(PINE_DEBOUNCE_MS + 1) })
    const line = screen.getByTestId('pine-editor-lane')
    expect(line.dataset.lane).toBe('none')
    expect(line.textContent).toMatch(/^Not drawn: /)
  })
})
