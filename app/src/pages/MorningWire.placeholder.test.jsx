// Live sweep 2026-10-05: WIRE showed "Market intelligence loading..." forever, because the
// engine shipped its own placeholder in a finished rundown. It is said plainly instead.
import { describe, it, expect } from 'vitest'
import { settleLoadingPlaceholders, WIRE_SECTION_MISSING } from './MorningWire'

describe('settleLoadingPlaceholders', () => {
  it('turns the engine placeholder into a plain statement', () => {
    const html = '<div class="rd-sections rd-monologue"><p class="rd-loading">Market intelligence loading...</p></div>'
    const out = settleLoadingPlaceholders(html)
    expect(out).not.toMatch(/loading\.\.\./i)
    expect(out).toContain(WIRE_SECTION_MISSING)
    expect(out).toContain('rd-monologue')
  })

  it('matches the single-quoted form the engine actually writes (live 2026-10-05)', () => {
    const html = "<div class=\"rd-sections rd-monologue\"><p class='rd-loading'>Market intelligence loading...</p><div class=\"rd-x\">kept</div></div>"
    const out = settleLoadingPlaceholders(html)
    expect(out).not.toMatch(/loading\.\.\./i)
    expect(out).toContain(WIRE_SECTION_MISSING)
    expect(out).toContain('<div class="rd-x">kept</div>')
  })

  it('leaves every other paragraph exactly as it was', () => {
    const html = '<p class="rd-pick">Loading dock stocks are leading.</p><p>Plain</p>'
    expect(settleLoadingPlaceholders(html)).toBe(html)
  })

  it('handles several placeholders and an empty rundown', () => {
    const two = '<p class="rd-loading">a</p><p class="rd-loading" id="x">b\nc</p>'
    expect(settleLoadingPlaceholders(two).match(/rd-missing/g)).toHaveLength(2)
    expect(settleLoadingPlaceholders('')).toBe('')
  })
})
