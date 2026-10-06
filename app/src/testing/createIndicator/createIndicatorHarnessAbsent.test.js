import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

// Same rail as the scan / add-to-chart harnesses: the Create Indicator harness
// and its scripted model stand-in are dev-server only and never ship.
describe('the Create Indicator harness is dev-only', () => {
  it('its entry exists in source but index.html never references it', () => {
    expect(existsSync(resolve(appDir, 'create-indicator-harness.html'))).toBe(true)
    const index = readFileSync(resolve(appDir, 'index.html'), 'utf8')
    expect(index).not.toContain('create-indicator-harness')
    expect(index).not.toContain('testing/createIndicator')
  })

  it('vite.config.js declares NO rollupOptions.input, so only index.html is built', () => {
    const cfg = readFileSync(resolve(appDir, 'vite.config.js'), 'utf8')
    expect(cfg).not.toMatch(/rollupOptions\s*:\s*\{[^}]*input/s)
  })

  it('no non-test product module imports the scripted model', () => {
    const offenders = []
    const walk = (dir) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n)
        if (statSync(p).isDirectory()) { if (n !== 'testing' && n !== 'node_modules') walk(p); continue }
        if (!/\.(jsx?|tsx?)$/.test(n) || /\.test\./.test(n)) continue
        if (readFileSync(p, 'utf8').includes('scriptedConverse')) offenders.push(p)
      }
    }
    walk(resolve(appDir, 'src'))
    expect(offenders).toEqual([])
  })
})
