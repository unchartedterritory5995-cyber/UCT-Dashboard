// The Members tab of the Indicators window: the published library, where a member looks
// for an indicator.
//
// Two layers. The component alone, with its two doors injected. Then the member's real
// path: Chart Settings → Indicators → Add indicator → Members → Install → Put it on this
// chart, with the library's two client functions mocked and the registry real.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import * as registry from './engine/nativeRegistry'
import { mergeChartSettings } from './chartDefaults'
import { buildDefinition } from './builder/BuilderSheet'
import { evaluateFormula } from './builder/FormulaField'
import { BUILDER_INPUTS, BUILDER_INPUT_SCOPE } from './builder/builderInputs'

const H = vi.hoisted(() => ({ library: null, install: null }))
vi.mock('../../hooks/useUserDefinitions', async (orig) => ({
  ...(await orig()),
  fetchDefinitionLibrary: vi.fn((...a) => H.library(...a)),
  installSharedDefinition: vi.fn((...a) => H.install(...a)),
}))

import IndicatorMembersTab, { factsOf, entryMatches } from './IndicatorMembersTab'
import ChartSettingsModal from './ChartSettingsModal'

const styles = new Proxy({}, { get: (_t, k) => String(k) })
const ENTRIES = [
  { token: 'sh_one', name: 'Tight Weekly Closes', shortName: 'TWC', description: 'Three weekly closes within one percent',
    repaint: 'non-repainting', placement: 'overlay', inputs: 2, published_at: '2026-11-10', ast_hash: 'sha256:a' },
  { token: 'sh_two', name: 'Up Down Volume', shortName: null, description: '', repaint: 'preview-repaints',
    placement: 'pane', inputs: 1, published_at: '2026-11-11', ast_hash: 'sha256:b' },
]
const ok = (entries = ENTRIES, next = null) => async () => ({ ok: true, entries, next })
const flush = async () => { await act(async () => {}) }

afterEach(() => { cleanup(); registry.clearUserDefinitions(); H.library = null; H.install = null })

describe('the facts line and the filter (pure)', () => {
  it('says the repaint verdict, the placement and the settings count; an unknown verdict is shown raw', () => {
    expect(factsOf(ENTRIES[0])).toBe('never repaints, overlay, 2 settings')
    expect(factsOf(ENTRIES[1])).toBe('repaints while the bar forms, pane, 1 setting')
    expect(factsOf({ repaint: 'something-new' })).toBe('something-new')
    expect(factsOf({})).toBe('')
  })
  it('matches on name, short name and description, any case; an empty box matches all', () => {
    expect(entryMatches(ENTRIES[0], 'weekly')).toBe(true)
    expect(entryMatches(ENTRIES[0], 'twc')).toBe(true)
    expect(entryMatches(ENTRIES[0], 'ONE PERCENT')).toBe(true)
    expect(entryMatches(ENTRIES[1], 'weekly')).toBe(false)
    expect(entryMatches(ENTRIES[1], '  ')).toBe(true)
  })
})

describe('the tab alone', () => {
  it('lists what was published, each with the facts a member chooses by', async () => {
    render(<IndicatorMembersTab styles={styles} fetchLibrary={ok()} install={async () => ({ ok: true })} />)
    expect(screen.getByTestId('members-loading')).toBeInTheDocument()
    await flush()
    const rows = screen.getAllByTestId('members-entry')
    expect(rows.map((r) => r.dataset.token)).toEqual(['sh_one', 'sh_two'])
    expect(rows[0].textContent).toMatch(/Tight Weekly Closes/)
    expect(within(rows[0]).getByTestId('members-entry-facts').textContent).toBe('never repaints, overlay, 2 settings')
  })

  it('nothing published is said plainly, and never asks the member to publish', async () => {
    render(<IndicatorMembersTab styles={styles} fetchLibrary={ok([])} install={async () => ({ ok: true })} />)
    await flush()
    const empty = screen.getByTestId('members-empty')
    expect(empty.textContent).toBe('No member has published an indicator yet.')
    expect(empty.textContent).not.toMatch(/publish yours|be the first|you can publish/i)
  })

  it('a failed load is not "nothing published": it says so and offers another try that works', async () => {
    let n = 0
    const lib = async () => { n += 1; return n === 1 ? { ok: false, error: 'Could not reach the server.', entries: [] } : { ok: true, entries: ENTRIES, next: null } }
    render(<IndicatorMembersTab styles={styles} fetchLibrary={lib} install={async () => ({ ok: true })} />)
    await flush()
    expect(screen.queryByTestId('members-empty')).toBeNull()
    expect(screen.getByTestId('members-error').textContent).toMatch(/could not be loaded.*Could not reach the server/i)
    await act(async () => { fireEvent.click(screen.getByTestId('members-retry')) })
    expect(screen.getAllByTestId('members-entry')).toHaveLength(2)
  })

  it('the window\'s search box filters it, and a miss says what was typed', async () => {
    const { rerender } = render(<IndicatorMembersTab styles={styles} query="volume" fetchLibrary={ok()} install={async () => ({ ok: true })} />)
    await flush()
    expect(screen.getAllByTestId('members-entry').map((r) => r.dataset.token)).toEqual(['sh_two'])
    rerender(<IndicatorMembersTab styles={styles} query="zzzz" fetchLibrary={ok()} install={async () => ({ ok: true })} />)
    expect(screen.getByTestId('members-no-match').textContent).toMatch(/matches “zzzz”/)
  })

  it('"Show more" appends the next page and keeps what was already listed', async () => {
    const seen = []
    const lib = async (arg = {}) => { seen.push(arg.after ?? null); return arg.after ? { ok: true, entries: [ENTRIES[1]], next: null } : { ok: true, entries: [ENTRIES[0]], next: 41 } }
    render(<IndicatorMembersTab styles={styles} fetchLibrary={lib} install={async () => ({ ok: true })} />)
    await flush()
    await act(async () => { fireEvent.click(screen.getByTestId('members-more')) })
    expect(seen).toEqual([null, 41])
    expect(screen.getAllByTestId('members-entry').map((r) => r.dataset.token)).toEqual(['sh_one', 'sh_two'])
    expect(screen.queryByTestId('members-more')).toBeNull()
  })

  it('install: says where the copy went; "Put it on this chart" waits until the copy is on offer', async () => {
    const put = vi.fn(() => true)
    let offered = false
    const view = (
      <IndicatorMembersTab styles={styles} fetchLibrary={ok()} isOnOffer={() => offered} onPutOnChart={put}
        install={async (t) => ({ ok: true, row: { def_id: `u_${t}`, version: 1 } })} />)
    const { rerender } = render(view)
    await flush()
    const row = () => screen.getAllByTestId('members-entry')[0]
    await act(async () => { fireEvent.click(within(row()).getByTestId('members-install')) })
    expect(within(row()).getByTestId('members-installed-note').textContent).toMatch(/Installed.*Your indicators/)
    expect(within(row()).queryByTestId('members-install')).toBeNull()
    const btn = () => within(row()).getByTestId('members-put-on-chart')
    expect(btn().disabled).toBe(true)
    fireEvent.click(btn())
    expect(put).not.toHaveBeenCalled()
    offered = true
    rerender(<IndicatorMembersTab styles={styles} fetchLibrary={ok()} isOnOffer={() => offered} onPutOnChart={put}
      install={async (t) => ({ ok: true, row: { def_id: `u_${t}`, version: 1 } })} />)
    expect(btn().disabled).toBe(false)
    fireEvent.click(btn())
    expect(put).toHaveBeenCalledWith('u_sh_one')
    // the other row is untouched
    expect(within(screen.getAllByTestId('members-entry')[1]).getByTestId('members-install')).toBeInTheDocument()
  })

  it('a refused install carries the server\'s reason and the shipped advice for it, and can be tried again', async () => {
    const install = async () => ({ ok: false, reason: 'revoked', error: 'The owner turned this link off.' })
    render(<IndicatorMembersTab styles={styles} fetchLibrary={ok()} install={install} />)
    await flush()
    const row = screen.getAllByTestId('members-entry')[0]
    await act(async () => { fireEvent.click(within(row).getByTestId('members-install')) })
    expect(within(row).getByTestId('members-install-error').textContent).toBe('The owner turned this link off. Ask them for a new link.')
    expect(within(row).getByTestId('members-install').disabled).toBe(false)
    expect(within(row).queryByTestId('members-put-on-chart')).toBeNull()
  })
})

describe('through the member\'s door: Chart Settings → Indicators → Add indicator → Members', () => {
  function draft(defId, source) {
    const r = evaluateFormula(source, BUILDER_INPUT_SCOPE)
    return buildDefinition({ defId, name: 'Tight Weekly Closes', source: r.source, ast: r.ast,
      mode: r.verdict.mode, readback: r.readback, inputs: BUILDER_INPUTS })
  }
  function Host({ onWrite }) {
    const [cs, setCs] = useState(() => mergeChartSettings(JSON.stringify({})))
    return <ChartSettingsModal open settings={cs} onChange={(n) => { onWrite(n); setCs(n) }} onClose={() => {}} />
  }
  const tabKeys = () => [...document.body.querySelectorAll('[role="tab"][data-tab]')].map((b) => b.dataset.tab)

  it('the tab is last on the strip, lists the library, and an installed copy lands on the chart in one press', async () => {
    H.library = ok()
    const def = draft('u_installedcopy1', 'sma(close, 20)')
    expect(def).toBeTruthy()
    H.install = async () => {
      // what the app does after an install: the store's list revalidates and the copy is installed
      const { errors } = registry.installUserDefinitions([def])
      expect(errors).toEqual([])
      return { ok: true, row: { def_id: def.id, version: 1 } }
    }
    const writes = []
    render(<Host onWrite={(n) => writes.push(n)} />)
    fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
    fireEvent.click(screen.getByTestId('add-enter'))
    await waitFor(() => expect(tabKeys()).toContain('members'))
    expect(tabKeys().at(-1)).toBe('members')
    expect(tabKeys()[0]).not.toBe('members')                  // the landing tab is unchanged
    expect(screen.queryByTestId('members-tab')).toBeNull()    // not fetched or shown until asked for
    fireEvent.click(document.body.querySelector('[role="tab"][data-tab="members"]'))
    await waitFor(() => expect(screen.getAllByTestId('members-entry')).toHaveLength(2))
    // the catalogue's own empty sentence does not appear beside it
    expect(document.body.textContent).not.toMatch(/Search to find members to add/i)
    const row = screen.getAllByTestId('members-entry')[0]
    await act(async () => { fireEvent.click(within(row).getByTestId('members-install')) })
    expect(writes).toHaveLength(0)                            // ⛔ installing writes nothing to the chart
    await waitFor(() => expect(within(screen.getAllByTestId('members-entry')[0]).getByTestId('members-put-on-chart').disabled).toBe(false))
    await act(async () => { fireEvent.click(within(screen.getAllByTestId('members-entry')[0]).getByTestId('members-put-on-chart')) })
    expect(writes).toHaveLength(1)
    const inst = (writes[0].indicatorInstances || []).filter((i) => i.defId === def.id)
    expect(inst).toHaveLength(1)
    expect(writes[0].preset).toBe('custom')
  })
})
