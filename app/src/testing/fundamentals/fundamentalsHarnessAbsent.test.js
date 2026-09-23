// ⛔ THE FUNDAMENTALS HARNESS MUST NEVER SHIP. It answers every /api/* from
// local files and exposes a `window.__fund` control surface. `vite build` takes
// index.html as its single input, so the extra .html entry is dev-server-only by
// construction -- railed here rather than trusted to a comment.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('the fundamentals harness is dev-only', () => {
  it('vite.config.js declares NO rollupOptions.input, so only index.html is built', () => {
    const cfg = readFileSync(resolve(appDir, 'vite.config.js'), 'utf8')
    expect(cfg).not.toMatch(/rollupOptions\s*:\s*\{[^}]*input/s)
  })

  it('the harness entry exists in source but is not referenced by index.html', () => {
    expect(existsSync(resolve(appDir, 'fundamentals-harness.html'))).toBe(true)
    const index = readFileSync(resolve(appDir, 'index.html'), 'utf8')
    expect(index).not.toContain('fundamentalsHarness')
    expect(index).not.toContain('fundamentals-harness')
    expect(index).not.toContain('testing/fundamentals')
  })

  it('the exported harness data is git-ignored', () => {
    const ignore = readFileSync(resolve(appDir, 'src/testing/fundamentals/.gitignore'), 'utf8')
    expect(ignore).toMatch(/^\.data\/?$/m)
  })
})
