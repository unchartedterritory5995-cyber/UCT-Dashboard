// (2026-11-28, cloud sweeps 2/3: zoomed-out boards lost their flips to 'view-frame', and the same front code flipped on a
// later run) A VIEW REFUSAL LOGS WHAT IT COMPARED, in production, so the next sweep that sees one records why. Log only:
// the decision is unchanged, nothing leaves the page, and the log stays bounded.
//   V1 viewDetail reports both frames, locks, rows, plot widths, pins and the frame the front's lock gives the next symbol
//   V2 noteDecision keeps a refusal's `view` in doubleBufferStats().log; a decision without one adds no `view` key
//   V3 the log is bounded: 64 entries, whatever is logged
import { describe, it, expect } from 'vitest'
import { viewDetail, viewParity, noteDecision, doubleBufferStats } from './doubleBuffer'

const meta = (frame, extra = {}) => ({ frame: { locked: false, lock: null, ...frame }, activeRange: null, priceAuto: true, replay: { mode: false }, plotWidthPx: 402, rows: 6000, replayLock: null, ...extra })
const lock = { anchorFrac: 0.99, width: 4019, tf: '1' }
const locked = (fromRight, toRight, extra) => meta({ fromRight, toRight, locked: true, lock }, extra)

describe('view refusal detail (log only)', () => {
  it('V1 reports what the refusal compared', () => {
    const front = locked(3983.111, -35.89, { rows: 25553 })
    const shadow = locked(3100, -35.89, { rows: 19000 })
    expect(viewParity(front, shadow, { tf: '1' })).toBe('view-frame')
    const v = viewDetail(front, shadow, { tf: '1' })
    expect(v.front).toMatchObject({ fromRight: 3983.11, toRight: -35.89, locked: true, lock: { anchorFrac: 0.99, width: 4019, tf: '1' }, rows: 25553, plotWidthPx: 402 })
    expect(v.shadow).toMatchObject({ fromRight: 3100, rows: 19000 })
    expect(v.lockFrame).toEqual({ fromRight: 3978.81, toRight: -40.19, refuse: null })
    expect(v.tf).toBe('1')
    expect(viewDetail(null, null)).toEqual({ front: null, shadow: null, lockFrame: null, tf: null })
  })

  it("V2 the log keeps a refusal's view, and only a refusal's", () => {
    const view = viewDetail(locked(10, -2), locked(12, -2), { tf: 'D' })
    noteDecision({ flip: false, why: 'view-frame' }, 'AAA', { view })
    noteDecision({ flip: true, why: 'flip' }, 'BBB', {})
    const log = doubleBufferStats().log
    expect(log[log.length - 2]).toMatchObject({ sym: 'AAA', why: 'view-frame', view })
    expect('view' in log[log.length - 1]).toBe(false)
  })

  it('V3 the log stays at 64 entries', () => {
    const view = viewDetail(locked(10, -2), locked(12, -2), { tf: 'D' })
    for (let i = 0; i < 200; i++) noteDecision({ flip: false, why: 'view-frame' }, `S${i}`, { view })
    const log = doubleBufferStats().log
    expect(log.length).toBe(64)
    expect(log[63].sym).toBe('S199')
  })
})
