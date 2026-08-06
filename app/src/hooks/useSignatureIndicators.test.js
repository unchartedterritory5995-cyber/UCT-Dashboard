// Contract test for the Signature indicators' SWR gating.
//
// StockChart is never rendered in vitest (house convention), so this covers the
// one thing a live click-through can silently pass over: the toggle KEY NAMES.
// `chart_settings.signature.<key>` is persisted by chartDefaults and read by the
// hook — a rename on either side turns every toggle into a permanent no-op with
// no error anywhere. Comparing against `Object.keys(CHART_DEFAULTS.signature)`
// (not a hard-coded list) is what makes this a real gate.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { CHART_DEFAULTS } from '../components/chart/chartDefaults'
import { serverColumnsUrl } from '../components/chart/engine/serverCompute'
import {
  signatureUrls, SIGNATURE_TOGGLE, SIGNATURE_DEF_ID, useSignatureIndicators,
} from './useSignatureIndicators'

const ALL_NULL = { dpl: null, gxw: null, fcb: null }

describe('signature toggle key contract', () => {
  it('drives exactly one fetch per CHART_DEFAULTS.signature key', () => {
    const keys = Object.keys(CHART_DEFAULTS.signature)
    expect(keys.length).toBeGreaterThan(0)

    const seen = new Set()
    for (const key of keys) {
      // Only THIS toggle on. If the hook read a different key name, the whole
      // result would be all-null and this fails.
      const urls = signatureUrls('AAPL', { [key]: true }, true, 'D')
      const live = Object.entries(urls).filter(([, v]) => v !== null)
      expect(live, `chart_settings.signature.${key} drives no request`).toHaveLength(1)
      seen.add(live[0][0])
    }
    // …and no two keys drive the same request.
    expect(seen.size).toBe(keys.length)
  })

  it('exposes exactly the persisted toggle keys, no more and no less', () => {
    expect(Object.values(SIGNATURE_TOGGLE).sort())
      .toEqual(Object.keys(CHART_DEFAULTS.signature).sort())
  })

  it('defaults every toggle OFF, so a default chart fetches nothing', () => {
    expect(signatureUrls('AAPL', CHART_DEFAULTS.signature, true, 'D')).toEqual(ALL_NULL)
  })
})

describe('signature request suppression', () => {
  const allOn = { darkPoolLevels: true, gexWalls: true, flowSignals: true }

  it('suppresses every request for an unpaid user', () => {
    expect(signatureUrls('AAPL', allOn, false, 'D')).toEqual(ALL_NULL)
  })

  it('suppresses every request without a symbol', () => {
    expect(signatureUrls('', allOn, true, 'D')).toEqual(ALL_NULL)
    expect(signatureUrls(null, allOn, true, 'D')).toEqual(ALL_NULL)
    expect(signatureUrls('   ', allOn, true, 'D')).toEqual(ALL_NULL)
  })

  it('suppresses every request when settings are missing entirely', () => {
    expect(signatureUrls('AAPL', undefined, true, 'D')).toEqual(ALL_NULL)
  })

  it('addresses a DEFINITION on the ONE server lane, not three hardcoded paths', () => {
    // ⭐ PHASE C TASK 13 — the genericization, at the call site. The three paths
    // this asserted are still mounted (they are the shipped surface), but the
    // hook no longer names one: every overlay is `/api/signature/columns` with a
    // `defId`, exactly like the RS line. A fourth Signature indicator is a row in
    // `registry_defs.SERVER_DEFS` plus a row in `SIGNATURE_DEF_ID` — not a fourth
    // path, a fourth SWR key, a fourth build function and a fourth cache.
    expect(signatureUrls('BRK-B', allOn, true, 'D')).toEqual({
      dpl: '/api/signature/columns?defId=uct-darkpool-levels&sym=BRK-B&tf=D',
      gxw: '/api/signature/columns?defId=uct-gex-walls&sym=BRK-B&tf=D',
      fcb: '/api/signature/columns?defId=uct-flow-breakout&sym=BRK-B&tf=D',
    })
    // …and NO path is hardcoded here any more: every url comes out of
    // `serverColumnsUrl`, so the two cannot disagree about where the lane is.
    for (const key of ['dpl', 'gxw', 'fcb']) {
      expect(signatureUrls('BRK-B', allOn, true, 'D')[key])
        .toBe(serverColumnsUrl(SIGNATURE_DEF_ID[key], 'BRK-B', 'D', null))
    }
  })

  it('⛔ the three definition ids are the ones the SERVER declares', () => {
    // A rename on either side would leave the overlay silently absent — a 404
    // from the lane reads exactly like a quiet tape. The Python half of this
    // pairing is `test_the_three_signature_definition_ids_are_the_ones_the_hook_
    // addresses`, which reads THIS FILE and diffs it against
    // `registry_defs.SIGNATURE_DEF_IDS`.
    expect(Object.keys(SIGNATURE_DEF_ID).sort()).toEqual(Object.keys(SIGNATURE_TOGGLE).sort())
    expect(Object.values(SIGNATURE_DEF_ID)).toEqual(
      ['uct-darkpool-levels', 'uct-gex-walls', 'uct-flow-breakout'])
  })

  // StockChart passes `exactDateRange ? undefined : cs.signature` — an undefined
  // cfg is the OFF SWITCH for date-framed historical charts (Model Book years,
  // Setup Library / Bottoms examples), where filteredBars is truncated at the
  // framed year-end and lightweight-charts would SNAP a present-day FCB marker
  // onto the final candle of a decade-old teaching chart. StockChart is never
  // rendered in vitest, so this pins the contract the call site depends on at
  // the hook level: no fetches, and empty arrays for every consumer.
  describe('undefined cfg (the date-framed-chart off switch)', () => {
    const wrapper = ({ children }) => createElement(
      SWRConfig,
      { value: { provider: () => new Map(), dedupingInterval: 0 } },
      children,
    )
    let origFetch
    beforeEach(() => { origFetch = globalThis.fetch })
    afterEach(() => { globalThis.fetch = origFetch; vi.restoreAllMocks() })

    it('fires zero fetches and returns all-empty arrays', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
      const { result } = renderHook(
        () => useSignatureIndicators('AAPL', undefined, true, 'D'),
        { wrapper },
      )
      // Let SWR's mount effects run — a suppressed key must stay suppressed
      // across them, not merely on the first synchronous render.
      await new Promise((r) => setTimeout(r, 0))
      expect(globalThis.fetch).not.toHaveBeenCalled()
      expect(result.current).toEqual({
        dpLines: [], dpZones: [], gexLines: [], flowMarkers: [],
      })
    })

    it('…and the same harness DOES fetch when cfg is present', async () => {
      // Positive control: without this, the assertion above would also pass if
      // the hook never fetched at all.
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ levels: [] }) })
      renderHook(
        () => useSignatureIndicators('AAPL', { darkPoolLevels: true }, true, 'D'),
        { wrapper },
      )
      await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/signature/columns?defId=uct-darkpool-levels&sym=AAPL&tf=D',
        expect.objectContaining({ credentials: 'include' }),
      ))
    })
  })

  it('keeps price levels but drops flow signals on an intraday timeframe', () => {
    // FCB barTimes are daily calendar keys; lightweight-charts SNAPS an unknown
    // marker time to the nearest bar rather than dropping it, so an intraday
    // chart would show the arrow on an arbitrary candle.
    for (const tf of ['1', '5', '15', '30', '60']) {
      const urls = signatureUrls('AAPL', allOn, true, tf)
      expect(urls.fcb, `tf=${tf} still requests flow-breakout`).toBeNull()
      expect(urls.dpl).not.toBeNull()
      expect(urls.gxw).not.toBeNull()
    }
    for (const tf of ['D', 'W', 'M', undefined]) {
      expect(signatureUrls('AAPL', allOn, true, tf).fcb).not.toBeNull()
    }
  })
})
