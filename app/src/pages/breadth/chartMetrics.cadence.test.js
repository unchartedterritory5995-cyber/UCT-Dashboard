// app/src/pages/breadth/chartMetrics.cadence.test.js
import { describe, it, expect } from 'vitest'
import { LABEL_MAP, WEEKLY_METRICS, staleAllowance } from './chartMetrics'

describe('reporting cadence (A-10)', () => {
  it('lets a weekly survey trail by a week and a daily series by one session', () => {
    expect(staleAllowance('aaii_bulls')).toBe(7)
    expect(staleAllowance('naaim')).toBe(7)
    expect(staleAllowance('cboe_putcall')).toBe(1)
    expect(staleAllowance('breadth_score')).toBe(1)
  })

  it('only names metrics the catalog offers', () => {
    expect([...WEEKLY_METRICS].filter(k => !(k in LABEL_MAP))).toEqual([])
  })
})

describe('labels keep the qualifier the Monitor documents (A-34)', () => {
  it('names Stage 2 and Stage 4 as MA-stack counts, as Breadth.jsx and heatmapMetrics.js do', () => {
    expect(LABEL_MAP.stage2_count).toBe('Stage 2 (MA Stack)')
    expect(LABEL_MAP.stage4_count).toBe('Stage 4 (MA Stack)')
  })
})
