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

  it('the ?src=api dev config proxies ONLY /api/econ, to 127.0.0.1, with an env-supplied throwaway bearer', () => {
    const cfg = readFileSync(resolve(appDir, 'vite.econ-harness.config.mjs'), 'utf8')
    const proxied = [...cfg.matchAll(/^\s*'(\/api[^']*)'\s*:/gm)].map((m) => m[1])
    expect(proxied).toEqual(['/api/econ'])
    expect(cfg).toContain('http://127.0.0.1:')
    expect(cfg).toContain('process.env.ECON_HARNESS_PUSH_SECRET')
    expect(cfg).not.toMatch(/Bearer [A-Za-z0-9]{8,}/)           // no literal secret
    expect(cfg).not.toContain('uctintelligence.com')
    // and the production config never learns about it
    expect(readFileSync(resolve(appDir, 'vite.config.js'), 'utf8')).not.toContain('ECON_HARNESS')
  })

  it('the harness never names /api/bars or production', () => {
    const src = readFileSync(resolve(appDir, 'src/econHarness/econHarness.js'), 'utf8')
    expect(src).not.toMatch(/['"`]\/api\/bars/)
    expect(src).not.toContain('uctintelligence.com')
    const driver = readFileSync(resolve(appDir, 'src/econHarness/captureScenarios.mjs'), 'utf8')
    expect(driver).toContain("refusing non-local base")
  })
})
