import { describe, it, expect } from 'vitest'
import { htmlToSpeechText, rundownToSpeechText } from './htmlToSpeech'

describe('htmlToSpeechText', () => {
  it('separates block elements so words do not mash together', () => {
    const html = '<div>Market Phase</div><div>CONFIRMED UPTREND</div><div>Trend Score</div>'
    const out = htmlToSpeechText(html)
    expect(out).not.toContain('PhaseCONFIRMED')
    expect(out).not.toContain('UPTRENDTrend')
    expect(out.split('\n')).toEqual(['Market Phase', 'CONFIRMED UPTREND', 'Trend Score'])
  })

  it('keeps inline emphasis flowing inside a sentence', () => {
    const html = '<p>The catalyst belongs to <strong>NVDA</strong> and the AI complex.</p>'
    expect(htmlToSpeechText(html)).toBe('The catalyst belongs to NVDA and the AI complex.')
  })

  it('returns empty string for falsy input', () => {
    expect(htmlToSpeechText('')).toBe('')
    expect(htmlToSpeechText(null)).toBe('')
  })
})

describe('rundownToSpeechText', () => {
  const RUNDOWN = `
    <div class="rd-regime-banner"><div class="rd-lbl">Market Phase</div><div class="rd-phase">CONFIRMED UPTREND</div></div>
    <div class="rd-stockbee"><div class="rd-metric-name">VIX</div><div class="rd-metric-val">15.83</div></div>
    <div class="rd-exposure"><div class="rd-exp-pct">90%</div></div>
    <div class="rd-sections">
      <div class="rd-agenda"><span class="rd-agenda-label">TODAY'S FOCUS</span>
        <ul><li>NVDA — AI chip catalyst leading pre-market</li></ul>
      </div>
      <p>Last week closed on a strong note — May finished up over 5%.</p>
      <p>The headline catalyst belongs to <strong>NVDA</strong> and the AI complex.</p>
    </div>
  `

  it('reads the narrative briefing and skips the data widgets', () => {
    const out = rundownToSpeechText(RUNDOWN)
    // narrative present
    expect(out).toContain("TODAY'S FOCUS")
    expect(out).toContain('NVDA — AI chip catalyst leading pre-market')
    expect(out).toContain('Last week closed on a strong note')
    expect(out).toContain('belongs to NVDA and the AI complex')
    // data widgets excluded — these are the gibberish the user heard
    expect(out).not.toContain('15.83')
    expect(out).not.toContain('CONFIRMED UPTREND')
    expect(out).not.toContain('90%')
  })

  it('falls back to whole-fragment block text when .rd-sections is absent', () => {
    const out = rundownToSpeechText('<div>Some <strong>briefing</strong> text.</div>')
    expect(out).toBe('Some briefing text.')
  })
})
