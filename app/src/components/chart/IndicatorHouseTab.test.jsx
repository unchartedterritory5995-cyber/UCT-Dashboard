// The UCT tab: the house set, where a member looks for an indicator.
//
// The set itself (`house/houseIndicators.json`) is held three ways: every definition passes
// the registry's own validation (here); every value it computes equals an independent
// calculation (`tests/test_house_indicators_values.py`); and its words are a member's words.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import HOUSE from './house/houseIndicators.json'
import * as registry from './engine/nativeRegistry'
import IndicatorHouseTab, { mintDefId, houseMatches, ownCopyId } from './IndicatorHouseTab'

const styles = new Proxy({}, { get: (_t, k) => String(k) })
const ITEMS = HOUSE.indicators
const load = async () => ITEMS
const flush = async () => { await act(async () => {}) }

afterEach(() => { cleanup(); registry.clearUserDefinitions() })

describe('the set', () => {
  it('holds at least eleven indicators, each named once', () => {
    expect(ITEMS.length).toBeGreaterThanOrEqual(11)
    expect(new Set(ITEMS.map((i) => i.slug)).size).toBe(ITEMS.length)
    expect(new Set(ITEMS.map((i) => i.name)).size).toBe(ITEMS.length)
  })

  it.each(ITEMS.map((i) => [i.name, i]))('%s passes the registry\'s own validation and installs', (_n, item) => {
    const doc = { ...item.definition, id: mintDefId() }
    const { defs, errors } = registry.validateUserDefinitions([doc])
    expect(errors).toEqual([])
    expect(defs).toHaveLength(1)
    const out = registry.installUserDefinitions([doc])
    expect(out.errors).toEqual([])
    expect(registry.getDefinition(doc.id)).toBeTruthy()
  })

  it('each has a real name and a one-sentence summary, in a member\'s words', () => {
    for (const it2 of ITEMS) {
      expect(it2.definition.meta.name).toBe(it2.name)
      expect(it2.name.length).toBeLessThanOrEqual(40)
      expect(it2.name).not.toMatch(/[<>=*^[\]{}]|&&|\|\|/)                   // a name, never a formula
      expect(it2.summary.length).toBeGreaterThan(20)
      expect(it2.summary.length).toBeLessThanOrEqual(140)
      expect(it2.summary).not.toMatch(/\b(Valid|Verified|Converted|Supported)\b/)
      expect(it2.summary).not.toMatch(/sma\(|ema\(|close\[|&&/)                // not engine wording
    }
  })

  it('no house definition is stored under an id a member\'s copy could have', () => {
    for (const it2 of ITEMS) expect(it2.definition.id).not.toMatch(/^u_[0-9a-f]{12}$/)
  })
})

describe('the tab', () => {
  it('lists the set with its summaries, and the host\'s search filters it', async () => {
    const { rerender } = render(<IndicatorHouseTab styles={styles} load={load} save={async () => ({ ok: true })} />)
    expect(screen.getByTestId('house-loading')).toBeInTheDocument()
    await flush()
    expect(screen.getAllByTestId('house-entry')).toHaveLength(ITEMS.length)
    rerender(<IndicatorHouseTab styles={styles} query="distribution" load={load} save={async () => ({ ok: true })} />)
    expect(screen.getAllByTestId('house-entry').map((r) => r.dataset.slug)).toEqual(['distribution_day_count'])
    rerender(<IndicatorHouseTab styles={styles} query="zzzz" load={load} save={async () => ({ ok: true })} />)
    expect(screen.getByTestId('house-no-match').textContent).toMatch(/matches “zzzz”/)
  })

  it('ONE PRESS: Add to chart saves a COPY under a fresh id and puts it on the chart once the chart knows it', async () => {
    const saves = []
    const save = async (doc, defId) => { saves.push({ doc, defId }); return { ok: true, row: { def_id: doc.id, version: 1 } } }
    const put = vi.fn(() => true)
    const view = (offered) => <IndicatorHouseTab styles={styles} load={load} save={save} isOnOffer={() => offered} onPutOnChart={put} />
    const { rerender } = render(view(false))
    await flush()
    const row = () => screen.getAllByTestId('house-entry')[0]
    expect(within(row()).getByTestId('house-install').textContent).toBe('Add to chart')
    await act(async () => { fireEvent.click(within(row()).getByTestId('house-install')) })
    expect(saves).toHaveLength(1)
    expect(saves[0].defId).toBeNull()                                         // a create, not an edit
    expect(saves[0].doc.id).toMatch(/^u_[0-9a-f]{12}$/)
    expect(saves[0].doc.id).not.toBe(ITEMS[0].definition.id)
    expect(saves[0].doc.meta.name).toBe(ITEMS[0].name)
    // the chart does not know the copy yet: nothing is put, the button says so and cannot be pressed twice
    expect(put).not.toHaveBeenCalled()
    expect(within(row()).getByTestId('house-install').textContent).toBe('Adding…')
    expect(within(row()).getByTestId('house-install').disabled).toBe(true)
    // the chart learns of it: on the chart with no second press
    await act(async () => { rerender(view(true)) })
    expect(put).toHaveBeenCalledTimes(1)
    expect(put).toHaveBeenCalledWith(saves[0].doc.id)
    expect(within(row()).getByTestId('house-added-note').textContent).toMatch(/Added to this chart/)
  })

  it('a copy that does not reach the chart in time is still SAVED, and the row offers the button', async () => {
    const save = async (doc) => ({ ok: true, row: { def_id: doc.id, version: 1 } })
    const put = vi.fn(() => true)
    const view = (offered) => <IndicatorHouseTab styles={styles} load={load} save={save} isOnOffer={() => offered} onPutOnChart={put} addWaitMs={60} />
    const { rerender } = render(view(false))
    await flush()
    const row = () => screen.getAllByTestId('house-entry')[0]
    await act(async () => { fireEvent.click(within(row()).getByTestId('house-install')) })
    await act(async () => { await new Promise((r) => setTimeout(r, 140)) })
    expect(put).not.toHaveBeenCalled()
    expect(within(row()).getByTestId('house-installed-note').textContent).toMatch(/Your indicators/)
    expect(within(row()).getByTestId('house-put-on-chart').disabled).toBe(true)
    await act(async () => { rerender(view(true)) })
    expect(put).not.toHaveBeenCalled()                                        // late is not automatic: the member presses
    fireEvent.click(within(row()).getByTestId('house-put-on-chart'))
    expect(put).toHaveBeenCalledTimes(1)
  })

  it('a member who already holds an UNCHANGED copy gets that copy: nothing is saved again', async () => {
    const save = vi.fn(async () => ({ ok: true }))
    const put = vi.fn(() => true)
    // the copy as the store returns it: the house definition's own maths under the member's id
    const own = [{ id: 'u_aaaaaaaaaaaa', compute: { ...ITEMS[0].definition.compute } }]
    render(<IndicatorHouseTab styles={styles} load={load} save={save} listOwn={() => own} isOnOffer={() => true} onPutOnChart={put} />)
    await flush()
    const row = screen.getAllByTestId('house-entry')[0]
    expect(within(row).getByTestId('house-have-note').textContent).toMatch(/You have this one/)
    await act(async () => { fireEvent.click(within(row).getByTestId('house-install')) })
    expect(save).not.toHaveBeenCalled()
    expect(put).toHaveBeenCalledWith('u_aaaaaaaaaaaa')
    expect(within(row).getByTestId('house-added-note')).toBeInTheDocument()
    // control: another row, which the member does not hold, has no such note
    expect(within(screen.getAllByTestId('house-entry')[1]).queryByTestId('house-have-note')).toBeNull()
  })

  it('a copy the member has CHANGED is their own indicator: adding makes a fresh copy', async () => {
    const saves = []
    const save = async (doc) => { saves.push(doc.id); return { ok: true, row: { def_id: doc.id, version: 1 } } }
    const own = [{ id: 'u_bbbbbbbbbbbb', compute: { fn: 'sha256:something-else' } }]
    render(<IndicatorHouseTab styles={styles} load={load} save={save} listOwn={() => own} isOnOffer={() => true} onPutOnChart={() => true} />)
    await flush()
    const row = screen.getAllByTestId('house-entry')[0]
    expect(within(row).queryByTestId('house-have-note')).toBeNull()
    await act(async () => { fireEvent.click(within(row).getByTestId('house-install')) })
    expect(saves).toHaveLength(1)
    expect(saves[0]).not.toBe('u_bbbbbbbbbbbb')
  })

  it('two adds of an indicator the member does not hold are two different copies', async () => {
    const ids = []
    const save = async (doc) => { ids.push(doc.id); return { ok: false, error: 'x' } }
    render(<IndicatorHouseTab styles={styles} load={load} save={save} />)
    await flush()
    const row = () => screen.getAllByTestId('house-entry')[0]
    await act(async () => { fireEvent.click(within(row()).getByTestId('house-install')) })
    await act(async () => { fireEvent.click(within(row()).getByTestId('house-install')) })
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })

  it('a refused save says why and can be tried again; nothing is put on the chart', async () => {
    const save = async () => ({ ok: false, error: 'You have reached the number of indicators your plan stores.' })
    const put = vi.fn(() => true)
    render(<IndicatorHouseTab styles={styles} load={load} save={save} isOnOffer={() => true} onPutOnChart={put} />)
    await flush()
    const row = screen.getAllByTestId('house-entry')[0]
    await act(async () => { fireEvent.click(within(row).getByTestId('house-install')) })
    expect(within(row).getByTestId('house-install-error').textContent).toMatch(/reached the number of indicators/)
    expect(within(row).getByTestId('house-install').disabled).toBe(false)
    expect(put).not.toHaveBeenCalled()
  })

  it('a chart that will not take it leaves the copy saved and the button there', async () => {
    const save = async (doc) => ({ ok: true, row: { def_id: doc.id, version: 1 } })
    render(<IndicatorHouseTab styles={styles} load={load} save={save} isOnOffer={() => true} onPutOnChart={() => false} />)
    await flush()
    const row = screen.getAllByTestId('house-entry')[0]
    await act(async () => { fireEvent.click(within(row).getByTestId('house-install')) })
    await flush()
    expect(within(row).queryByTestId('house-added-note')).toBeNull()
    expect(within(row).getByTestId('house-installed-note')).toBeInTheDocument()
    expect(within(row).getByTestId('house-put-on-chart').disabled).toBe(false)
  })

  it('a set that cannot be loaded says so instead of showing an empty list', async () => {
    render(<IndicatorHouseTab styles={styles} load={async () => { throw new Error('chunk') }} />)
    await flush()
    expect(screen.getByTestId('house-error')).toBeInTheDocument()
    expect(screen.queryByTestId('house-tab')).toBeNull()
  })
})

describe('the pieces', () => {
  it('mintDefId is the store\'s shape and differs each time', () => {
    const a = mintDefId(); const b = mintDefId()
    expect(a).toMatch(/^u_[0-9a-f]{12}$/)
    expect(a).not.toBe(b)
  })
  it('ownCopyId finds the member\'s unchanged copy by its maths, and nothing else', () => {
    const { fn, treesHash } = ITEMS[0].definition.compute
    expect(treesHash).toBeTruthy()                                             // the premise: more than one line
    expect(ownCopyId(ITEMS[0], [{ id: 'u_1', compute: { fn, treesHash } }])).toBe('u_1')
    expect(ownCopyId(ITEMS[0], [{ id: 'u_2', compute: { fn: 'sha256:other', treesHash } }])).toBeNull()
    expect(ownCopyId(ITEMS[1], [{ id: 'u_1', compute: { fn, treesHash } }])).toBeNull()
    // the first line alone is not the indicator: another line changed, or missing, is another indicator
    expect(ownCopyId(ITEMS[0], [{ id: 'u_5', compute: { fn, treesHash: 'sha256:other' } }])).toBeNull()
    expect(ownCopyId(ITEMS[0], [{ id: 'u_6', compute: { fn } }])).toBeNull()
    // an indicator of ONE formula has no second fingerprint, and still matches on its formula
    const single = ITEMS.find((i) => !i.definition.compute.treesHash)
    expect(single).toBeTruthy()
    expect(ownCopyId(single, [{ id: 'u_7', compute: { fn: single.definition.compute.fn } }])).toBe('u_7')
    expect(ownCopyId(single, [{ id: 'u_8', compute: { fn: single.definition.compute.fn, treesHash: 'sha256:more-lines' } }])).toBeNull()
  })
  it('two house indicators that share a first line do not claim each other\'s copy', () => {
    // "Relative Strength vs SPY" and "RS New High vs SPY": one ratio, different marks. Measured
    // 2026-11-18: their `compute.fn` is the same hash, so a member holding one got it again
    // when adding the other.
    const byFn = new Map()
    for (const it2 of ITEMS) byFn.set(it2.definition.compute.fn, [...(byFn.get(it2.definition.compute.fn) || []), it2])
    const twins = [...byFn.values()].filter((g) => g.length > 1)
    expect(twins.length).toBeGreaterThanOrEqual(1)                             // the premise still holds in the set
    for (const group of twins) {
      for (const a of group) {
        const mine = [{ id: 'u_a', compute: { fn: a.definition.compute.fn, treesHash: a.definition.compute.treesHash } }]
        for (const b of group) expect(ownCopyId(b, mine), `${b.slug} against a copy of ${a.slug}`).toBe(b === a ? 'u_a' : null)
      }
    }
    // and every house indicator is told apart from every other by its whole maths
    const whole = ITEMS.map((i) => `${i.definition.compute.fn}|${i.definition.compute.treesHash || ''}`)
    expect(new Set(whole).size).toBe(ITEMS.length)
  })
  it('a copy of ANOTHER version of a house indicator is the member\'s own, not the house one', () => {
    // Volume with 50 Average: its first line is `volume`, so its `fn` is the same hash whatever
    // its colouring lines say. A copy whose later lines differ (an older or a newer version of
    // the house definition, or the member's own edit of one) must not be taken for the house one.
    const item = ITEMS.find((i) => i.slug === 'volume_with_50_average')
    const other = { fn: item.definition.compute.fn, treesHash: `sha256:${'a'.repeat(64)}` }
    expect(other.treesHash).not.toBe(item.definition.compute.treesHash)
    expect(ownCopyId(item, [{ id: 'u_old', compute: other }])).toBeNull()
    // and the same lines under the member's id ARE the house one
    expect(ownCopyId(item, [{ id: 'u_same', compute: { ...item.definition.compute } }])).toBe('u_same')
    for (const own of [null, undefined, [], [null], [{ id: 'u_3' }]]) expect(ownCopyId(ITEMS[0], own)).toBeNull()
    expect(ownCopyId({ definition: { compute: {} } }, [{ id: 'u_4', compute: {} }])).toBeNull()   // no fingerprint, no match
  })
  it('houseMatches reads the name and the summary, any case', () => {
    expect(houseMatches(ITEMS[0], 'DISTRIBUTION')).toBe(true)
    expect(houseMatches(ITEMS[0], 'higher volume')).toBe(true)
    expect(houseMatches(ITEMS[0], 'vwap')).toBe(false)
    expect(houseMatches(ITEMS[0], '  ')).toBe(true)
  })
})
