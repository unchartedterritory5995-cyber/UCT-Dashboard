import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

// P5 Task 6 (ruling P5-R-C9): an Apply that LANDED counts once as `style_applied`, 'switch' when the plan
// switched the note to another style and 'update' when it moved the note to its own style's latest version.
// `finish` fires at its TOP, before the dirty-editor branch returns: the write has landed in both branches.
let plan = { toVersion: 3, styleName: 'Weekend prep', switching: false }
vi.mock('./StyleUpdateSheet', () => ({
  default: ({ onApplied }) => (
    <button type="button" onClick={() => onApplied({ id: 'n1', title: 'My NVDA note' }, plan)}>apply now</button>
  ),
  StyleChooser: ({ onPick }) => <button type="button" onClick={() => onPick('s1')}>pick a style</button>,
}))

import StyleHost from './StyleHost'

const NOTE = { id: 'n1', title: 'My NVDA note', styleId: 's1', styleVersion: 1 }
const TELEMETRY = '/api/j2/telemetry'

function mount({ dirty = () => [] } = {}) {
  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) })
  const api = {
    last: { current: { updatedAt: 'x' } }, send: async () => true, adopt: vi.fn(), dirty, reread: { current: vi.fn() },
  }
  render(<StyleHost note={NOTE} ask={1} api={api} />)
  fireEvent.click(screen.getByRole('button', { name: 'pick a style' }))
  fireEvent.click(screen.getByRole('button', { name: 'apply now' }))
  return spy.mock.calls.filter(([url]) => url === TELEMETRY).map(([, init]) => JSON.parse(init.body))
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('StyleHost.finish and style_applied', () => {
  it("a switch to another style fires style_applied {via: 'switch'} once", () => {
    plan = { toVersion: 2, styleName: 'Weekend prep', switching: true }
    expect(mount()).toEqual([{ event: 'style_applied', props: { via: 'switch' } }])
  })

  it("an update to the style's latest version fires {via: 'update'} once", () => {
    plan = { toVersion: 3, styleName: 'Weekend prep', switching: false }
    expect(mount()).toEqual([{ event: 'style_applied', props: { via: 'update' } }])
  })

  it('a dirty editor still counts it: the write landed, only the re-read waits (P5-R-C9)', () => {
    plan = { toVersion: 3, styleName: 'Weekend prep', switching: true }
    expect(mount({ dirty: () => [1] })).toEqual([{ event: 'style_applied', props: { via: 'switch' } }])
  })

  it('no style name, note id or title rides along', () => {
    plan = { toVersion: 3, styleName: 'My NVDA style', switching: false }
    const sent = JSON.stringify(mount())
    expect(sent).not.toContain('NVDA')
    expect(sent).not.toContain('n1')
  })
})
