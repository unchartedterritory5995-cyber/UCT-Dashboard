// #1234 (AUDIT): a STRUCTURAL rail over the REAL chart-setting registry and the REAL Shift+T writers.
//
// The light/dark palette (Shift+T) has ONE descriptor — chartSettingsDescriptors `theme`, which owns its options and its
// words ('light palette', 'dark palette', 'shift+t'); the state rail (stateRail.js) builds its palette class from it. A
// second registration of the same id — #1059 re-merging its own E('theme') — or a second Shift+T writer would split that
// source in two (settingDescriptor() returns the first, the other is silently dead or silently wins elsewhere). This rail
// fails on either by itself, with no copy of the registry: it reads the exported descriptor list, the exported shortcut
// table, and the source files that register or write them.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHART_SETTING_DESCRIPTORS, ELIGIBLE_SETTINGS, settingDescriptor } from '../components/chart/chartSettingsDescriptors'
import { SHORTCUTS, matchShortcut } from '../components/chart/keyboardShortcuts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..')

// every non-test source file under app/src (the registry may be extended from anywhere)
function sourceFiles(dir = SRC, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) sourceFiles(p, out)
    else if (/\.(js|jsx|ts|tsx)$/.test(ent.name) && !/\.(test|spec)\.[jt]sx?$/.test(ent.name) && !/__tests__|__mocks__/.test(p)) out.push(p)
  }
  return out
}
const FILES = sourceFiles().map(p => ({ rel: path.relative(SRC, p).split(path.sep).join('/'), text: fs.readFileSync(p, 'utf8') }))
// strip // line comments so a comment that names a writer is not counted as one
const code = (t) => t.split(/\r?\n/).map(l => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n')
function hits(re) {
  const out = []
  for (const f of FILES) {
    const n = (code(f.text).match(re) || []).length
    for (let i = 0; i < n; i++) out.push(f.rel)
  }
  return out
}
const isShiftT = (s) => typeof s === 'string' && /\bshift\s*\+\s*t\b/i.test(s)

describe('#1234 rail — chart-setting descriptor ids are unique across the registry', () => {
  it('the registry is non-empty and carries the theme descriptor', () => {
    expect(CHART_SETTING_DESCRIPTORS.length).toBeGreaterThan(10)
    expect(settingDescriptor('theme')).toBeTruthy()
  })

  it('no descriptor id is registered twice (CHART_SETTING_DESCRIPTORS)', () => {
    const seen = new Map()
    for (const d of CHART_SETTING_DESCRIPTORS) seen.set(d.id, (seen.get(d.id) || 0) + 1)
    const dupes = [...seen].filter(([, n]) => n > 1).map(([id, n]) => `${id} ×${n}`)
    expect(dupes).toEqual([])
    expect(new Set(ELIGIBLE_SETTINGS.map(d => d.id)).size).toBe(ELIGIBLE_SETTINGS.length)
  })

  it("no source file registers E('theme') more than once in all of app/src", () => {
    expect(hits(/\bE\(\s*['"`]theme['"`]/g)).toEqual(['components/chart/chartSettingsDescriptors.js'])
  })
})

describe('#1234 rail — exactly ONE Shift+T (palette toggle) descriptor and writer', () => {
  it('exactly one descriptor claims Shift+T (ui / label / words) — the theme descriptor, which owns the palette words', () => {
    const claim = CHART_SETTING_DESCRIPTORS.filter(d => isShiftT(d.ui) || isShiftT(d.label) || (d.words || []).some(isShiftT))
    expect(claim.map(d => d.id)).toEqual(['theme'])
    expect(settingDescriptor('theme').words).toEqual(expect.arrayContaining(['light palette', 'dark palette', 'shift+t']))
    // no OTHER descriptor owns a palette word
    const others = CHART_SETTING_DESCRIPTORS.filter(d => d.id !== 'theme' && (d.words || []).some(w => /\b(light|dark) palette\b/i.test(w)))
    expect(others.map(d => d.id)).toEqual([])
  })

  it('the shortcut table binds Shift+T exactly once, to toggle:theme, and toggle:theme to nothing else', () => {
    expect(SHORTCUTS.filter(s => isShiftT(s.keys)).map(s => s.command)).toEqual(['toggle:theme'])
    expect(SHORTCUTS.filter(s => s.command === 'toggle:theme').map(s => s.keys)).toEqual(['Shift+T'])
    expect(matchShortcut({ key: 'T', shiftKey: true, ctrlKey: false, metaKey: false, altKey: false, target: null })).toBe('toggle:theme')
  })

  it("exactly one source writes the palette (updateField('theme', …)) and exactly one matcher returns toggle:theme", () => {
    expect(hits(/\bupdateField\(\s*['"`]theme['"`]/g)).toEqual(['components/StockChart.jsx'])
    expect(hits(/return\s+['"`]toggle:theme['"`]/g)).toEqual(['components/chart/keyboardShortcuts.js'])
  })

  it("no second source declares the palette's lower-case 'shift+t' word (the descriptor is its one source; key labels are 'Shift+T')", () => {
    expect(hits(/['"`]shift\+t['"`]/g)).toEqual(['components/chart/chartSettingsDescriptors.js'])
  })
})
