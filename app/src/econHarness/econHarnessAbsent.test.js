// ⛔ THE ECON HARNESS MUST NEVER SHIP. It answers /api/econ/* from fixtures and
// exposes a `window.__econ` control surface. `vite build` takes index.html as its
// single input, so the extra .html entry is dev-server-only by construction --
// railed here rather than trusted to a comment.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

describe('the econ harness is dev-only', () => {
  it('vite.config.js declares NO rollupOptions.input, so only index.html is built', () => {
    const cfg = readFileSync(resolve(appDir, 'vite.config.js'), 'utf8')
    expect(cfg).not.toMatch(/rollupOptions\s*:\s*\{[^}]*input/s)
  })

  it('the harness entry exists but nothing in the app references it', () => {
    expect(existsSync(resolve(appDir, 'econ-harness.html'))).toBe(true)
    const index = readFileSync(resolve(appDir, 'index.html'), 'utf8')
    expect(index).not.toContain('econ-harness')
    expect(index).not.toContain('econHarness')
    const appJsx = readFileSync(resolve(appDir, 'src/App.jsx'), 'utf8')
    expect(appJsx).not.toContain('econHarness')
  })

  it('the harness never names /api/bars or production', () => {
    const src = readFileSync(resolve(appDir, 'src/econHarness/econHarness.js'), 'utf8')
    expect(src).not.toMatch(/['"`]\/api\/bars/)
    expect(src).not.toContain('uctintelligence.com')
    const driver = readFileSync(resolve(appDir, 'src/econHarness/captureScenarios.mjs'), 'utf8')
    expect(driver).toContain("refusing non-local base")
  })
})
