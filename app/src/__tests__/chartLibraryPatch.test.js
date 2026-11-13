// @vitest-environment node
//
// The build edits three functions inside lightweight-charts (scripts/chartLibraryPatch.mjs).
// This file proves the edits still FIT the installed library and that the build really applies
// them. What the edited library DOES is proven next door, in chartLibraryPatch.behaviour.test.js.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LWC_VERSION, LWC_TARGET, PATCHES, patchLightweightCharts, patchChartLibrary } from '../../scripts/chartLibraryPatch.mjs'

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const LIB_FILE = path.join(APP, 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.production.mjs')
const SHIPPED = readFileSync(LIB_FILE, 'utf8')
const LIB_ID = '/somewhere/app' + LWC_TARGET
const count = (code, needle) => code.split(needle).length - 1

describe('the edits fit the installed chart library', () => {
  it('the installed library is the version the edits were written for, and the app pins it exactly', () => {
    const installed = JSON.parse(readFileSync(path.join(APP, 'node_modules', 'lightweight-charts', 'package.json'), 'utf8'))
    expect(installed.version).toBe(LWC_VERSION)
    const app = JSON.parse(readFileSync(path.join(APP, 'package.json'), 'utf8'))
    // a range ("^5.2.0") would let an install pick a build the edits were never checked against
    expect(app.dependencies['lightweight-charts']).toBe(LWC_VERSION)
  })

  it('the package still resolves a bundler to the file the edits target', () => {
    const pkg = JSON.parse(readFileSync(path.join(APP, 'node_modules', 'lightweight-charts', 'package.json'), 'utf8'))
    const built = '/node_modules/lightweight-charts/' + pkg.exports['.'].production.import.replace(/^\.\//, '')
    expect(built).toBe(LWC_TARGET)
    expect('/node_modules/lightweight-charts/' + pkg.exports['.'].default.import.replace(/^\.\//, '')).toBe(LWC_TARGET)
  })

  it('every edit finds its target exactly once and leaves its replacement exactly once', () => {
    expect(PATCHES.length).toBe(3)
    const out = patchLightweightCharts(SHIPPED)
    for (const p of PATCHES) {
      expect(count(SHIPPED, p.find), p.name).toBe(1)
      expect(count(SHIPPED, p.replace), p.name).toBe(0)
      expect(count(out, p.find), p.name).toBe(0)
      expect(count(out, p.replace), p.name).toBe(1)
    }
    // nothing else moved: undoing the three replacements gives the shipped file back
    let back = out
    for (const p of PATCHES) back = back.replace(p.replace, () => p.find)
    expect(back).toBe(SHIPPED)
  })

  it('refuses, naming the edit, when a target is missing, repeated, or its new name is taken', () => {
    for (const p of PATCHES) {
      expect(() => patchLightweightCharts(SHIPPED.replace(p.find, () => '')), p.name).toThrow(p.name)
      expect(() => patchLightweightCharts(SHIPPED + p.find), p.name).toThrow(p.name)
    }
    expect(() => patchLightweightCharts(SHIPPED + ';var uctDayMemo')).toThrow('already used')
  })

  it('leaving an edit out leaves exactly that edit out (what the behaviour test relies on)', () => {
    for (const p of PATCHES) {
      const out = patchLightweightCharts(SHIPPED, [p.name])
      expect(count(out, p.find), p.name).toBe(1)
      for (const q of PATCHES) if (q !== p) expect(count(out, q.replace), q.name).toBe(1)
    }
  })
})

describe('the build applies the edits', () => {
  const failing = () => ({ getModuleIds: () => [LIB_ID, '/somewhere/app/src/main.jsx'], error: (m) => { throw new Error(m) } })

  it('the real vite config carries the plugin, for builds only, ahead of other transforms', async () => {
    const cfg = (await import('../../vite.config.js')).default
    const plugin = cfg.plugins.flat().find((p) => p && p.name === 'uct-chart-library-data-layer')
    expect(plugin, 'the chart library plugin is not in vite.config.js').toBeTruthy()
    expect(plugin.apply).toBe('build')
    expect(plugin.enforce).toBe('pre')
  })

  it('patches the library file as it is bundled, and nothing else', () => {
    const plugin = patchChartLibrary()
    const res = plugin.transform(SHIPPED, LIB_ID)
    expect(res.code).toBe(patchLightweightCharts(SHIPPED))
    // a Windows id with a query, as Vite can hand it over
    expect(patchChartLibrary().transform(SHIPPED, 'C:\\repo\\app' + LWC_TARGET.split('/').join('\\') + '?v=1').code).toBe(res.code)
    expect(plugin.transform('export const x = 1', '/somewhere/app/node_modules/react/index.js')).toBe(null)
    expect(plugin.transform('export const x = 1', '/somewhere/app/src/components/StockChart.jsx')).toBe(null)
  })

  it('refuses to build with any other build of the library', () => {
    const dev = '/somewhere/app/node_modules/lightweight-charts/dist/lightweight-charts.development.mjs'
    expect(() => patchChartLibrary().transform(SHIPPED, dev)).toThrow('not ' + LWC_TARGET)
  })

  it('refuses a build that bundled the library without patching it, and only that build', () => {
    // bundled under a path the transform does not recognise: never patched
    const unseen = patchChartLibrary()
    unseen.buildStart()
    const ctx = { getModuleIds: () => ['/elsewhere/lightweight-charts/esm/index.js'], error: (m) => { throw new Error(m) } }
    expect(() => unseen.buildEnd.call(ctx)).toThrow('without its data-layer edits')

    const seen = patchChartLibrary()
    seen.buildStart()
    seen.transform(SHIPPED, LIB_ID)
    expect(() => seen.buildEnd.call(failing())).not.toThrow()

    // a build that does not contain the library at all (and one already failing) is left alone
    const none = patchChartLibrary()
    none.buildStart()
    expect(() => none.buildEnd.call({ getModuleIds: () => ['/somewhere/app/src/main.jsx'], error: (m) => { throw new Error(m) } })).not.toThrow()
    expect(() => unseen.buildEnd.call(ctx, new Error('the build already failed'))).not.toThrow()
  })

  it('a second build in the same process starts unpatched again', () => {
    const plugin = patchChartLibrary()
    plugin.buildStart()
    plugin.transform(SHIPPED, LIB_ID)
    plugin.buildStart()
    expect(() => plugin.buildEnd.call(failing())).toThrow('without its data-layer edits')
  })
})
