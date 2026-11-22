// The engine-free half of the RS teaching source (unit 4-06): it equals the committed export, it is the very
// object `teaching.js` re-exports (one source, not a copy), and it imports nothing, so the public glossary page
// that reads it never pulls in the chart engine.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as data from './teachingData.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXPORT_PATH = path.resolve(HERE, '..', '..', '..', '..', 'api', 'data', 'rs_teaching.json')

describe('rs teachingData', () => {
  it('equals the committed api/data/rs_teaching.json', () => {
    const exported = JSON.parse(readFileSync(EXPORT_PATH, 'utf8'))
    expect(data.GLOSSARY).toEqual(exported.glossary)
    expect(data.MISCONCEPTIONS).toEqual(exported.misconceptions)
    expect(data.TOUR).toEqual(exported.tour)
    expect(data.GLOSSARY).toHaveLength(22)   // 15 of 04 §c + the three RS indicators the split added (U9) + RS Exit Warnings and its three warnings (2026-11-12)
    expect(data.MISCONCEPTIONS).toHaveLength(8)
  })

  it('is the same object teaching.js exports, not a second copy', async () => {
    const teaching = await import('./teaching.js')
    expect(teaching.GLOSSARY).toBe(data.GLOSSARY)
    expect(teaching.MISCONCEPTIONS).toBe(data.MISCONCEPTIONS)
    expect(teaching.TOUR).toBe(data.TOUR)
    expect(teaching.TAGLINE).toBe(data.TAGLINE)
  })

  it('imports nothing (so it can never reach the chart engine)', () => {
    const src = readFileSync(path.join(HERE, 'teachingData.js'), 'utf8')
    expect(src).not.toMatch(/^\s*import\b/m)
    expect(src).not.toMatch(/\bimport\s*\(/)
    expect(src).not.toMatch(/\brequire\s*\(/)
    expect(src).not.toMatch(/^\s*export\s+(\*|\{[^}]*\})\s+from\b/m)
  })
})
