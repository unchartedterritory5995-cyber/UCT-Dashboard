// ⛔ THE STUDY WORKBENCH MUST NEVER SHIP. `app/lab.html` (<script src="/src/lab/main.jsx">) is a dev-server-only
// entry the owner scores pieces on (docs/study/RESUME.md, rounds 1-15). `vite build` takes index.html as its single
// input, so the lab is never built -- railed here rather than trusted to a comment, the same shape as
// econHarnessAbsent.test.js. The product MAY import individual lab modules (the challenges reuse the workbench's
// start card, bits and stylesheet so members get what was scored); what it may never do is reference the lab ENTRY.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

describe('the Study workbench is dev-only', () => {
  it('vite.config.js declares NO rollupOptions.input, so only index.html is built', () => {
    const cfg = readFileSync(resolve(appDir, 'vite.config.js'), 'utf8')
    expect(cfg).not.toMatch(/rollupOptions\s*:\s*\{[^}]*input/s)
    expect(cfg).not.toContain('lab.html')
  })

  it('the lab entry exists and names its own main, and nothing in the product references the entry', () => {
    expect(existsSync(resolve(appDir, 'lab.html'))).toBe(true)
    expect(readFileSync(resolve(appDir, 'lab.html'), 'utf8')).toContain('/src/lab/main.jsx')
    const index = readFileSync(resolve(appDir, 'index.html'), 'utf8')
    expect(index).not.toContain('lab.html')
    expect(index).not.toContain('/src/lab/')
    const appJsx = readFileSync(resolve(appDir, 'src/App.jsx'), 'utf8')
    expect(appJsx).not.toMatch(/['"]\.\.?\/lab\//)
    expect(appJsx).not.toContain('lab/main')
  })

  it('the lab main never mounts into the product and never names production', () => {
    const main = readFileSync(resolve(appDir, 'src/lab/main.jsx'), 'utf8')
    expect(main).not.toContain('uctintelligence.com')
    expect(main).not.toContain("from '../App'")
  })
})
