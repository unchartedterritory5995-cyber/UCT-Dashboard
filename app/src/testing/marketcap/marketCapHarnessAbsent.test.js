// ⛔ THE MARKET CAP HARNESS MUST NEVER SHIP: it answers every /api/* from local files and exposes `window.__mcap`.
// `vite build` takes index.html as its single input; railed here rather than trusted to a comment.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('the market cap harness is dev-only', () => {
  it('vite.config.js declares NO rollupOptions.input, so only index.html is built', () => {
    expect(readFileSync(resolve(appDir, 'vite.config.js'), 'utf8')).not.toMatch(/rollupOptions\s*:\s*\{[^}]*input/s)
  })
  it('the entry exists in source and index.html never references it', () => {
    expect(existsSync(resolve(appDir, 'marketcap-harness.html'))).toBe(true)
    const index = readFileSync(resolve(appDir, 'index.html'), 'utf8')
    expect(index).not.toContain('marketcap-harness')
    expect(index).not.toContain('testing/marketcap')
  })
})
