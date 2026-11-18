// Production keeps its own source maps, privately (desktop speed plan 9.7, 2026-11-11):
// vite builds them HIDDEN (no sourceMappingURL comment, shipped JS unchanged) and
// scripts/stash-sourcemaps.mjs moves them out of the public /assets mount into dist/.maps/,
// read only by the admin endpoint GET /api/admin/client-errors/sourcemap/{chunk}.
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAPS_DIR, stashSourcemaps } from '../../scripts/stash-sourcemaps.mjs'

const APP = resolve(globalThis.process.cwd())

describe('hidden source maps never reach the public /assets mount', () => {
  it('the build makes HIDDEN maps (never a sourceMappingURL in shipped JS) and stashes them straight after vite', () => {
    const cfg = readFileSync(join(APP, 'vite.config.js'), 'utf8')
    expect(cfg).toMatch(/\n\s*sourcemap: 'hidden',\r?\n/)
    const build = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8')).scripts.build
    expect(build.startsWith('vite build && node scripts/stash-sourcemaps.mjs && ')).toBe(true)
  })

  it('moves every .map (nested too) into dist/.maps and leaves the chunks where they are', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'stash-maps-'))
    mkdirSync(join(dist, 'assets', 'sub'), { recursive: true })
    writeFileSync(join(dist, 'assets', 'index-A1.js'), 'x')
    writeFileSync(join(dist, 'assets', 'index-A1.js.map'), '{}')
    writeFileSync(join(dist, 'assets', 'sub', 'w-B2.js.map'), '{}')
    writeFileSync(join(dist, 'assets', 'style-C3.css'), 'y')
    expect(await stashSourcemaps(dist)).toBe(2)
    expect(readdirSync(join(dist, 'assets')).sort()).toEqual(['index-A1.js', 'style-C3.css', 'sub'])
    expect(readdirSync(join(dist, 'assets', 'sub'))).toEqual([])
    expect(readdirSync(join(dist, MAPS_DIR)).sort()).toEqual(['index-A1.js.map', 'w-B2.js.map'])
    expect(existsSync(join(dist, 'assets', 'index-A1.js.map'))).toBe(false)
  })
})
