// RUN AN INDICATOR OVER A LIST, FROM THE CHART (Studio plan lane R1; Screener request R13).
//
// `/screener?scan=<def_id>` opens the Screener's EXISTING "My scans" detail on one of the member's own
// indicators. A link and a one-time reader: no second run door, no new endpoint.
// ⛔ The id is a hint. Malformed, unknown or someone else's: nothing opens and nothing is said.

import { describe, it, expect, vi } from 'vitest'
import { scanLink, scanIdFromSearch, withoutScanParam, resolveScanHint, SCAN_PARAM } from './scanLink'
import { chipMenuItems } from '../../components/chart/legend/chipMenu'
import * as engineRegistry from '../../components/chart/engine/nativeRegistry'
import MANAGER_SRC from './ScreensManager.jsx?raw'
import STOCKCHART_SRC from '../../components/StockChart.jsx?raw'

const MINE = 'u_0123456789ab'
const OTHER = 'u_ffffffffffff'
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('the link', () => {
  it('is the Screener’s address with the indicator named, and nothing for a non-id', () => {
    expect(scanLink(MINE)).toBe(`/screener?${SCAN_PARAM}=${MINE}`)
    for (const bad of [null, undefined, '', 'rsi', 'u_short', 'u_0123456789ab&x=1', '../admin', 42]) expect(scanLink(bad)).toBeNull()
  })

  it('reads back only a well-formed id', () => {
    expect(scanIdFromSearch(`?scan=${MINE}`)).toBe(MINE)
    expect(scanIdFromSearch(`?tab=x&scan=${MINE}&y=1`)).toBe(MINE)
    for (const bad of ['', '?scan=', '?scan=rsi', '?scan=u_0123456789abZZ', '?scan=<script>', '?other=1', null, undefined, 7]) {
      expect(scanIdFromSearch(bad)).toBeNull()
    }
  })

  it('is removed from the address after it is read, leaving the rest', () => {
    expect(withoutScanParam(`?scan=${MINE}`)).toBe('')
    expect(withoutScanParam(`?tab=x&scan=${MINE}&y=1`)).toBe('?tab=x&y=1')
    expect(withoutScanParam('?tab=x')).toBe('?tab=x')
  })
})

describe('what the Screener does with the hint', () => {
  const scans = [{ def_id: MINE }]
  const unscannable = [{ def_id: 'u_aaaaaaaaaaaa' }]

  it('the member’s own scannable indicator: the menu opens on its detail', () => {
    expect(resolveScanHint(MINE, scans, unscannable)).toEqual({ open: true, detailId: MINE })
  })

  it('the member’s own indicator that cannot scan: the menu opens on the list that says why', () => {
    expect(resolveScanHint('u_aaaaaaaaaaaa', scans, unscannable)).toEqual({ open: true, detailId: null })
  })

  it('⛔ an unknown or someone else’s id opens NOTHING, with no error', () => {
    for (const id of [OTHER, 'u_bbbbbbbbbbbb']) expect(resolveScanHint(id, scans, unscannable)).toEqual({ open: false, detailId: null })
    expect(resolveScanHint(null, scans, unscannable)).toEqual({ open: false, detailId: null })
    expect(resolveScanHint(MINE, null, undefined)).toEqual({ open: false, detailId: null })     // lists not loaded
    expect(resolveScanHint(MINE, [], [])).toEqual({ open: false, detailId: null })
  })

  it('the manager reads the hint ONCE, through the resolver, and removes it (source rails; comments stripped)', () => {
    const m = code(MANAGER_SRC)
    expect(m).toMatch(/scanHintRef = useRef\(typeof window !== 'undefined' \? scanIdFromSearch\(window\.location\.search\) : null\)/)
    expect(m).toMatch(/scanHintRef\.current = null\s+const hint = resolveScanHint\(id, scans, unscannable\)/)
    expect(m).toMatch(/if \(hint\.open\) \{ setOpen\(true\); if \(hint\.detailId\) setDetailId\(hint\.detailId\) \}/)
    // under a router the hint leaves THROUGH the router; the bare replaceState is the no-router path only
    expect(m).toMatch(/setScanHintRead\(true\)\s+if \(inRouter\) return\s+try \{/)
    expect(m).toMatch(/\{inRouter && scanHintRead && <ScanHintOut \/>\}/)
    expect(m).toMatch(/replaceState\(window\.history\.state, '', `\$\{pathname\}\$\{withoutScanParam\(search\)\}\$\{hash\}`\)/)
    // no second run door: the reader starts no run and calls no endpoint
    const reader = m.slice(m.indexOf('scanHintRef = useRef'), m.indexOf('}, [defRows, scans, unscannable, inRouter])'))
    expect(reader.length).toBeGreaterThan(200)
    expect(reader).not.toMatch(/fetch\(|setRun\(|RunNow|\/api\//)
  })
})

describe('the door on the chart', () => {
  const handlers = () => ({
    onSettings: vi.fn(), onToggleHidden: vi.fn(), onMove: vi.fn(), onDuplicate: vi.fn(),
    onAlerts: vi.fn(), onAbout: vi.fn(), onRemove: vi.fn(), onRunOverList: vi.fn(),
  })
  const RSI = engineRegistry.getDefinition('rsi')
  const chip = { defId: MINE, plotKey: 'value', instanceId: 'inst:1', label: 'My indicator', hidden: false }

  it('a member’s own indicator gets "Run over a list", and pressing it calls the handler', () => {
    const h = handlers()
    const row = chipMenuItems(chip, RSI, h, { definitionKind: 'user' }).find((i) => i.key === 'run-list')
    expect(row).toBeTruthy()
    expect(row.label).toBe('Run over a list')
    row.onClick()
    expect(h.onRunOverList).toHaveBeenCalledWith('inst:1')
  })

  it('CONTROL: a shipped indicator does not, and neither does a chart that gives no handler', () => {
    expect(chipMenuItems(chip, RSI, handlers(), { definitionKind: 'native' }).some((i) => i.key === 'run-list')).toBe(false)
    const h = handlers(); delete h.onRunOverList
    expect(chipMenuItems(chip, RSI, h, { definitionKind: 'user' }).some((i) => i.key === 'run-list')).toBe(false)
  })

  it('the chart opens the Screener’s address for that indicator (source rail; comments stripped)', () => {
    expect(code(STOCKCHART_SRC)).toMatch(/onRunOverList: \(\) => \{ close\(\); const to = scanLink\(c\.defId\); if \(to\) \{ try \{ window\.open\(to, '_self'\) \}/)
  })
})
