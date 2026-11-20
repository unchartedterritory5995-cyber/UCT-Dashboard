// The dev sample list (owner 2026-11-19): invented, stable, labelled — and never shipped.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { devSampleList, isLocalDevHost, DEV_SAMPLE_LABEL, DEV_SAMPLE_SYMBOLS } from './devSampleList'

const HERE = path.dirname(fileURLToPath(import.meta.url))

describe('devSampleList', () => {
  it('sizes to the cell, capped at 60, and is stable for one list', () => {
    expect(devSampleList({ seed: 'a', count: 23 }).items).toHaveLength(23)
    expect(devSampleList({ seed: 'a', count: 500 }).items).toHaveLength(60)
    expect(DEV_SAMPLE_SYMBOLS.length).toBeGreaterThanOrEqual(60)
    expect(devSampleList({ seed: 'a', count: 23 })).toEqual(devSampleList({ seed: 'a', count: 23 }))
    expect(devSampleList({ seed: 'b', count: 23 }).items[0].t).not.toBe(devSampleList({ seed: 'a', count: 23 }).items[0].t)
  })
  it('real symbols (so charts draw), invented moves / prices / volumes', () => {
    const { items, devSample } = devSampleList({ seed: 'x', count: 30, down: true })
    expect(devSample).toBe(true)
    for (const it of items) {
      expect(DEV_SAMPLE_SYMBOLS).toContain(it.t)   // real symbols that chart locally
      expect(it.pct).toBeLessThan(0)
      expect(it.c).toBeGreaterThan(0)
      expect(it.v).toBeGreaterThan(0)
      expect(typeof it.sector).toBe('string')
    }
    expect(new Set(items.map(i => i.t)).size).toBe(items.length)
    expect(DEV_SAMPLE_LABEL).toBe('dev sample list')
  })
  it('only a local development host counts', () => {
    expect(isLocalDevHost('127.0.0.1')).toBe(true)
    expect(isLocalDevHost('localhost')).toBe(true)
    expect(isLocalDevHost('app.uctintelligence.com')).toBe(false)
  })
  it('is reached only through an import.meta.env.DEV branch (dead in a build)', () => {
    const page = fs.readFileSync(path.resolve(HERE, '../../Breadth.jsx'), 'utf8')
    const at = page.indexOf("import('./breadth/drill/devSampleList')")
    expect(at).toBeGreaterThan(0)
    expect(page.lastIndexOf('if (import.meta.env.DEV', at)).toBeGreaterThan(at - 1200)
    expect(page).not.toMatch(/^import .*devSampleList/m)
    const modal = fs.readFileSync(path.resolve(HERE, 'BreadthDrillModal.jsx'), 'utf8')
    // owner 2026-11-19: no badge in the header at all (the list itself stays dev-only)
    expect(modal).not.toMatch(/'dev sample list'/)
  })
  // The production bundle holds none of it. Runs against `app/dist`; skips when there is no build.
  const DIST = path.resolve(HERE, '../../../../dist/assets')
  it.skipIf(!fs.existsSync(DIST))('the built bundle has no sample-list module or strings', () => {
    const js = fs.readdirSync(DIST).filter(f => f.endsWith('.js'))
    expect(js.some(f => /devSampleList/.test(f))).toBe(false)
    for (const f of js) {
      const src = fs.readFileSync(path.join(DIST, f), 'utf8')
      expect(src.includes('dev sample list'), f).toBe(false)
      expect(src.includes('invented tickers'), f).toBe(false)
      expect(src.includes('_devSample'), f).toBe(false)
      expect(src.includes('RKLB IONQ AFRM DKNG'), f).toBe(false)
    }
  })
})
