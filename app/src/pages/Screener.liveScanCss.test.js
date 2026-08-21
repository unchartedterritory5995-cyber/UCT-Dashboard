import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const read = rel => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8').replace(/\r\n/g, '\n')

describe('Screener.module.css hygiene', () => {
  const css = () => read('pages/Screener.module.css')

  it('defines @keyframes pulse exactly once (CSS modules: a duplicate silently wins)', () => {
    expect([...css().matchAll(/@keyframes\s+pulse\b/g)].length).toBe(1)
    expect(css()).toMatch(/@keyframes\s+streamPulse\b/)
    expect(css()).toMatch(/animation:\s*streamPulse/)
  })

  it('the Live Scan block carries no raw palette hex', () => {
    // A missing marker would make the slice below start at 0 (or, worse, the
    // hex assertions would pass vacuously against a near-empty string) — so
    // this must fail loudly if the heading text ever moves, not silently pass.
    const markerAt = css().indexOf('Live Scan Tab')
    expect(markerAt).toBeGreaterThan(-1)
    const block = css().slice(markerAt)
    for (const hex of ['#4ade80', '#f87171', '#555', '#e2e0d8', '#c9a84c']) {
      expect(block, `${hex} should be a token in the Live Scan block`).not.toContain(hex)
    }
  })

  it('Live Scan has phone rules: the body stacks', () => {
    expect(css().indexOf('@media (max-width: 640px)')).toBeGreaterThan(-1)
    const phone = css().split('@media (max-width: 640px)').slice(1).join('\n')
    expect(phone).toMatch(/\.liveScanBody[^}]*flex-direction:\s*column/)
  })

  it('PatternFeedbackChip stays admin-only (spec §6.3 — already true, pinned here)', () => {
    const chip = read('components/PatternFeedbackChip.jsx')
    expect(chip).toMatch(/role\s*!==\s*'admin'/)
  })
})
