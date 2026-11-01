// SAVED-SCRIPT AUTO-UPGRADE — the ONE quiet row a legacy script document offers in
// its legend menu. The caller decides (`caps.scriptUpgrade`, from
// `savedScriptUpgrade.needsScriptForUpgrade`); this file only places it.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chipMenuItems } from './chipMenu'
import { UPGRADE_NOTICE_LABEL } from '../builder/memberPane/savedScriptUpgrade'

const chip = { instanceId: 'i1', defId: 'u_abc', label: 'X', hidden: false }
const h = () => ({
  onSettings: vi.fn(), onToggleHidden: vi.fn(), onMove: vi.fn(), onDuplicate: vi.fn(),
  onAlerts: vi.fn(), onAbout: vi.fn(), onRemove: vi.fn(), onEditFormula: vi.fn(), onScriptUpgrade: vi.fn(),
})
const def = { meta: { name: 'Mine', recurrenceOrigin: 'pine' } }
const has = (rows) => rows.some((r) => r.key === 'script-upgrade')

describe('the "Updated accuracy available" row', () => {
  it('is absent unless the caller says so, and never on a definition the member does not own', () => {
    expect(has(chipMenuItems(chip, def, h(), { definitionKind: 'user' }))).toBe(false)
    expect(has(chipMenuItems(chip, def, h(), { definitionKind: 'builtin', scriptUpgrade: true }))).toBe(false)
  })

  it('is present when the caller says so, reads the notice, opens the builder for THIS instance', () => {
    const handlers = h()
    const rows = chipMenuItems(chip, def, handlers,
      { definitionKind: 'user', scriptUpgrade: true, scriptUpgradeLabel: UPGRADE_NOTICE_LABEL })
    const row = rows.find((r) => r.key === 'script-upgrade')
    expect(row.label).toBe('Updated accuracy available — open in Builder and save to apply')
    expect(row.danger).toBeUndefined()
    row.onClick()
    expect(handlers.onScriptUpgrade).toHaveBeenCalledWith('i1')
    // one row, beside the definition's own verbs, never after the destructive rule
    expect(rows.filter((r) => r.key === 'script-upgrade')).toHaveLength(1)
    expect(rows.findIndex((r) => r.key === 'script-upgrade')).toBeGreaterThan(rows.findIndex((r) => r.key === 'edit-formula'))
    expect(rows.findIndex((r) => r.key === 'script-upgrade')).toBeLessThan(rows.findIndex((r) => r.key === 'remove'))
  })
})

// ⛔ THE CALL SITES, READ FROM THE FILES A MEMBER'S CHART RUNS. A row this file can
// place is a row nobody sees unless StockChart asks the upgrade module and wires the
// handler to the toolbar door that opens the builder in upgrade mode.
describe('the row is wired on the chart', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const read = (rel) => fs.readFileSync(path.join(here, rel), 'utf8')
  it('StockChart passes the caller’s verdict and routes the click to `openScriptUpgrade`', () => {
    const sc = read('../../StockChart.jsx')
    expect(sc).toContain('scriptUpgrade: needsScriptForUpgrade(c.defId)')
    expect(sc).toContain("onScriptUpgrade: () => { close(); try { toolbarRef.current?.openScriptUpgrade?.({ defId: c.defId }) }")
  })
  it('the toolbar door opens the builder on the row with `upgradeScript: true`', () => {
    const tb = read('../ChartToolbar.jsx')
    expect(tb).toMatch(/openScriptUpgrade: \(opts = null\) => \{[\s\S]{0,300}setBuilderEditRow\(\{ \.\.\.row, upgradeScript: true \}\)/)
  })
})
