import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

// Same rail as the scan harness: the Add to Chart harness is a dev-server page
// and must never reach the production bundle.
describe('the Add to Chart harness is dev-only', () => {
  it('its entry exists in source but index.html never references it', () => {
    expect(existsSync(resolve(appDir, 'add-to-chart-harness.html'))).toBe(true)
    const index = readFileSync(resolve(appDir, 'index.html'), 'utf8')
    expect(index).not.toContain('add-to-chart-harness')
    expect(index).not.toContain('testing/addToChart')
  })

  it('vite.config.js declares NO rollupOptions.input, so only index.html is built', () => {
    const cfg = readFileSync(resolve(appDir, 'vite.config.js'), 'utf8')
    expect(cfg).not.toMatch(/rollupOptions\s*:\s*\{[^}]*input/s)
  })
})
