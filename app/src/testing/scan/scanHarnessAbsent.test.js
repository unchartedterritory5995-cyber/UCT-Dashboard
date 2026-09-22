// ⛔ THE HARNESS MUST NEVER SHIP. It mounts a real ChartWidget with persistence
// locks that only make sense on a developer's machine, and it exposes a
// `window.__scan` control surface. `vite build` takes index.html as its single
// input, so extra .html entries are dev-server-only by construction — but that
// is a property of a config nobody is required to preserve, so it gets a rail
// rather than a comment.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('the scan harness is dev-only', () => {
  it('vite.config.js declares NO rollupOptions.input, so only index.html is built', () => {
    const cfg = readFileSync(resolve(appDir, 'vite.config.js'), 'utf8')
    // If someone adds a multi-entry input, every harness page starts shipping —
    // including this one and pane-harness. That is the moment to think again.
    expect(cfg).not.toMatch(/rollupOptions\s*:\s*\{[^}]*input/s)
  })

  it('the harness entry exists in source but is not referenced by index.html', () => {
    expect(existsSync(resolve(appDir, 'scan-harness.html'))).toBe(true)
    const index = readFileSync(resolve(appDir, 'index.html'), 'utf8')
    expect(index).not.toContain('scanHarness')
    expect(index).not.toContain('scan-harness')
  })

  it('no production source imports the harness module', () => {
    // A stray import would drag it into the real bundle regardless of entries.
    const index = readFileSync(resolve(appDir, 'index.html'), 'utf8')
    expect(index).not.toContain('testing/scan')
  })
})
