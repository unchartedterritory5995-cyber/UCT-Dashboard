// S13 (audit 2026-11-05): the quick-capture box teaches the natural-language alert phrasing. The example must be a
// sentence the alert parser REALLY reads (lib/alertPhrase.js), so it is parsed here, not trusted.
import { afterEach, describe, expect, it } from 'vitest'
import { ALERT_EXAMPLE, thoughtPlaceholder } from './CaptureDialog'
import { parseAlertPhrase } from '../../lib/alertPhrase'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

afterEach(() => __resetNotebookFlags())

describe('the quick thought placeholder', () => {
  it('with the alert chip on, it reads "Try: alert me if NVDA closes below 190"', () => {
    latchNotebookFlags({ notebook_smart_chips_enabled: true })
    expect(thoughtPlaceholder()).toBe('Try: alert me if NVDA closes below 190')
  })

  it('the example is a sentence the parser reads: NVDA, a closing alert, below 190', () => {
    const got = parseAlertPhrase(ALERT_EXAMPLE)
    expect(got).toMatchObject({ symbol: 'NVDA', mode: 'close', direction: 'below', price: 190 })
  })

  it('with the chip off, it keeps the plain prompt (CONTROL: it never teaches a sentence nothing reads)', () => {
    latchNotebookFlags({ notebook_smart_chips_enabled: false })
    expect(thoughtPlaceholder()).toBe('What are you thinking?')
  })
})
