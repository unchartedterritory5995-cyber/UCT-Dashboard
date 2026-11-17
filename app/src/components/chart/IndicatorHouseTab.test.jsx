// The UCT tab: the house set, where a member looks for an indicator.
//
// The set itself (`house/houseIndicators.json`) is held three ways: every definition passes
// the registry's own validation (here); every value it computes equals an independent
// calculation (`tests/test_house_indicators_values.py`); and its words are a member's words.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import HOUSE from './house/houseIndicators.json'
import * as registry from './engine/nativeRegistry'
import IndicatorHouseTab, { mintDefId, houseMatches } from './IndicatorHouseTab'

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

  it('install saves a COPY under a fresh id of the store\'s shape, never the house id', async () => {
    const saves = []
    const save = async (doc, defId) => { saves.push({ doc, defId }); return { ok: true, row: { def_id: doc.id, version: 1 } } }
    const put = vi.fn(() => true)
    let offered = false
    const view = (o) => <IndicatorHouseTab styles={styles} load={load} save={save} isOnOffer={() => o} onPutOnChart={put} />
    const { rerender } = render(view(offered))
    await flush()
    const row = () => screen.getAllByTestId('house-entry')[0]
    await act(async () => { fireEvent.click(within(row()).getByTestId('house-install')) })
    expect(saves).toHaveLength(1)
    expect(saves[0].defId).toBeNull()                                         // a create, not an edit
    expect(saves[0].doc.id).toMatch(/^u_[0-9a-f]{12}$/)
    expect(saves[0].doc.id).not.toBe(ITEMS[0].definition.id)
    expect(saves[0].doc.meta.name).toBe(ITEMS[0].name)
    expect(within(row()).getByTestId('house-installed-note').textContent).toMatch(/Your indicators/)
    // the chart button waits for the copy to reach the registry
    expect(within(row()).getByTestId('house-put-on-chart').disabled).toBe(true)
    offered = true
    rerender(view(offered))
    fireEvent.click(within(row()).getByTestId('house-put-on-chart'))
    expect(put).toHaveBeenCalledWith(saves[0].doc.id)
  })

  it('two installs of the same indicator are two different copies', async () => {
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

  it('a refused save says why and can be tried again', async () => {
    const save = async () => ({ ok: false, error: 'You have reached the number of indicators your plan stores.' })
    render(<IndicatorHouseTab styles={styles} load={load} save={save} />)
    await flush()
    const row = screen.getAllByTestId('house-entry')[0]
    await act(async () => { fireEvent.click(within(row).getByTestId('house-install')) })
    expect(within(row).getByTestId('house-install-error').textContent).toMatch(/reached the number of indicators/)
    expect(within(row).getByTestId('house-install').disabled).toBe(false)
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
  it('houseMatches reads the name and the summary, any case', () => {
    expect(houseMatches(ITEMS[0], 'DISTRIBUTION')).toBe(true)
    expect(houseMatches(ITEMS[0], 'higher volume')).toBe(true)
    expect(houseMatches(ITEMS[0], 'vwap')).toBe(false)
    expect(houseMatches(ITEMS[0], '  ')).toBe(true)
  })
})
