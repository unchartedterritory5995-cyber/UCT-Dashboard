// ── THE CONTRACT RAILS: the Agent can't silently drift from the product, or from the server ──
//
// 1. GOLDEN MANIFEST — `contract/manifest.golden.json` is the exact manifest the Charts surface
//    sends. Any capability change shows up as a reviewed diff (regenerate with
//    UPDATE_AGENT_GOLDEN=1), and tests/test_uct_agent_contract.py validates the same file with
//    the server's real validator, schema builder and prompt.
// 2. PRODUCT DRIFT — every enum the Agent offers equals the product list it stands for.
// 3. KNOWING ≠ DOING — only `eligible` chart settings are executable; every `specialized` row
//    names a registered capability; a kind that keeps no Undo never has a capability claiming one.
// 4. SCALING — past `routingThreshold` capabilities the flat manifest must give way to relevance
//    routing (docs/agent/CAPABILITY-CONTRACT.md §Scaling); this fails first.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { registerBuiltins } from './builtins'
import { manifestFor, getCapability, getTargetKind, allCapabilityNames, MANIFEST_CONTRACT } from './capabilities'
import { CHART_TYPE_OPTIONS } from '../components/chart/chartDefaults'
import { NATIVE_TFS } from '../components/chart/timeframes'
import { CHART_THEMES } from '../components/chart/chartThemes'
import { WORKSPACE_MENU_TYPES } from '../widgets/registry'
import { CHART_SETTING_DESCRIPTORS, ELIGIBLE_SETTINGS } from '../components/chart/chartSettingsDescriptors'
import { SETTINGS_SECTIONS } from './capabilities/app'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const GOLDEN = path.join(HERE, 'contract', 'manifest.golden.json')
const ROOT = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

registerBuiltins()
const manifest = manifestFor({ surface: 'charts' })
const enumOf = (cap, arg) => getCapability(cap).args.properties[arg].enum.filter(v => v !== null)

describe('golden manifest (the JS ⇄ Python contract)', () => {
  it('🔴 the manifest equals contract/manifest.golden.json (UPDATE_AGENT_GOLDEN=1 to accept a reviewed change)', () => {
    const now = JSON.stringify({ manifestVersion: MANIFEST_CONTRACT.manifestVersion, capabilities: manifest }, null, 1) + '\n'
    if (process.env.UPDATE_AGENT_GOLDEN === '1') fs.writeFileSync(GOLDEN, now)
    expect(JSON.parse(now)).toEqual(JSON.parse(fs.readFileSync(GOLDEN, 'utf8')))
  })
  it('every entry carries exactly the v1 keys', () => {
    for (const c of manifest) expect(Object.keys(c).sort(), c.name).toEqual([...MANIFEST_CONTRACT.entryKeys].sort())
  })
  it('fits the server limits from the shared contract (nothing is cut on the way to the model)', () => {
    const L = MANIFEST_CONTRACT.limits
    expect(manifest.length).toBeLessThanOrEqual(L.maxCapabilities)
    for (const c of manifest) {
      expect(JSON.stringify(c).length, c.name).toBeLessThanOrEqual(L.maxCapBytes)
      expect(String(c.summary).length, c.name).toBeLessThanOrEqual(L.maxSummary)
      expect(String(c.hints || '').length, c.name).toBeLessThanOrEqual(L.maxHints)
    }
  })
  it('🔴 SCALING: below the routing threshold — past it, activate relevance routing instead of raising the server cap', () => {
    expect(manifest.length, 'see docs/agent/CAPABILITY-CONTRACT.md §Scaling').toBeLessThanOrEqual(MANIFEST_CONTRACT.routingThreshold)
  })
})

describe('product drift — the Agent offers exactly what the product has', () => {
  it('chart types = chartDefaults.CHART_TYPE_OPTIONS (setType and addCharts)', () => {
    const ids = CHART_TYPE_OPTIONS.map(([id]) => id)
    expect(enumOf('chart.setType', 'type')).toEqual(ids)
    expect(enumOf('widget.addCharts', 'chart_type')).toEqual(ids)
  })
  it('timeframes = timeframes.NATIVE_TFS (setTimeframe and addCharts)', () => {
    expect(enumOf('chart.setTimeframe', 'timeframe')).toEqual(NATIVE_TFS)
    expect(enumOf('widget.addCharts', 'timeframe')).toEqual(NATIVE_TFS)
  })
  it('chart themes = chartThemes.CHART_THEMES; widget types = registry.WORKSPACE_MENU_TYPES', () => {
    expect(enumOf('chart.applyTheme', 'theme')).toEqual(CHART_THEMES.map(t => t.id))
    expect(enumOf('widget.add', 'type')).toEqual(WORKSPACE_MENU_TYPES)
  })
  it('Settings page lists the Agent mirrors (source rail on pages/Settings.jsx)', () => {
    const src = read('src/pages/Settings.jsx')
    const block = (name) => src.slice(src.indexOf(`const ${name} = [`), src.indexOf(']', src.indexOf(`const ${name} = [`)))
    const tf = [...block('TF_OPTIONS').matchAll(/value: '([^']+)'/g)].map(m => m[1])
    expect(enumOf('settings.setDefaultTimeframe', 'timeframe')).toEqual(tf)
    const sections = [...block('SECTIONS').matchAll(/id: '([^']+)'/g)].map(m => m[1])
    expect(SETTINGS_SECTIONS).toEqual(sections)
  })
})

describe('knowing ≠ doing', () => {
  it('chart.setSetting offers exactly the descriptor rows classified eligible — nothing else', () => {
    expect(enumOf('chart.setSetting', 'setting')).toEqual(ELIGIBLE_SETTINGS.map(d => d.id))
    for (const d of CHART_SETTING_DESCRIPTORS.filter(x => x.agent !== 'eligible')) {
      expect(enumOf('chart.setSetting', 'setting'), d.id).not.toContain(d.id)
    }
  })
  it('every `specialized:<capability>` descriptor names a REGISTERED capability', () => {
    const names = new Set(allCapabilityNames())
    for (const d of CHART_SETTING_DESCRIPTORS.filter(x => x.agent.startsWith('specialized:'))) {
      expect(names.has(d.agent.slice('specialized:'.length)), d.id).toBe(true)
    }
  })
  it('a target kind that keeps no Undo never carries a capability that claims one', () => {
    for (const c of manifest) {
      const kind = getTargetKind(c.target)
      if (kind?.undoable === false) expect(c.undo, c.name).toBe('none')
      if (c.undo === 'exact') expect(c.reversible, c.name).toBe(true)
    }
    expect(getCapability('app.open').undo).toBe('none')
    expect(getCapability('settings.setWatchlistDigest').undo).toBe('none')
  })
})
