// ⛔ THE AGENT HARNESS MUST NEVER SHIP: it stubs an admin session and a model.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) { if (n !== 'testing' && n !== 'node_modules') walk(p, out) }
    else if (/\.(jsx?|tsx?)$/.test(n) && !/\.test\./.test(n)) out.push(p)
  }
  return out
}

describe('the agent harness is dev-only', () => {
  it('vite builds index.html only', () => {
    expect(readFileSync(resolve(appDir, 'vite.config.js'), 'utf8')).not.toMatch(/rollupOptions\s*:\s*\{[^}]*input/s)
    expect(existsSync(resolve(appDir, 'agent-harness.html'))).toBe(true)
    expect(readFileSync(resolve(appDir, 'index.html'), 'utf8')).not.toContain('agent-harness')
  })
  it('no production source imports the harness or its scripted double', () => {
    for (const f of walk(resolve(appDir, 'src'))) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toMatch(/testing\/agent\/(agentHarness|scriptedAgent)/)
    }
  })
})
