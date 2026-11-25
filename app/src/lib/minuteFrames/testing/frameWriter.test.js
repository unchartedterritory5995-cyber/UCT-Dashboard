// @vitest-environment node
// The test-only frame writer (frameWriter.js) is held to the PRODUCT decoder: what it writes must decode, record for
// record, to what it was given. A rail that publishes frames with it is then reading real frames.
import { describe, it, expect } from 'vitest'
import { decodeFrame, frameRows, KIND_LATE, KIND_REPLACE, KIND_ONTIME, NO_SEQ, FrameError } from '../codec'
import { writeFrame, framePath } from './frameWriter'

const MIN = Date.UTC(2026, 10, 10, 15, 2) / 60000              // Tue 2026-11-10 10:02 ET

describe('frameWriter writes frames the product decoder reads', () => {
  it('header, blocks and records round-trip exactly', () => {
    const f = decodeFrame(writeFrame({
      minute: MIN, epoch: 9,
      blocks: [
        { rows: [{ sym: 'MSFT', o: 410.12, h: 410.5, l: 409.9, c: 410.3333, v: 1234 }, { sym: 'AAPL', o: 1, h: 2, l: 0.5, c: 1.5, v: 0 }, { sym: 'BRK-B', o: 5.565822, h: 5.6, l: 5.5, c: 5.55, v: 10.5 }] },
        { minute: MIN - 1, kind: KIND_LATE, rows: [{ sym: 'AAPL', o: 3, h: 4, l: 2, c: 3.5, v: 7 }] },
        { minute: MIN - 2, kind: KIND_REPLACE, rows: [{ sym: 'ZZZ', o: 9, h: 9, l: 9, c: 9, v: 1 }] },
      ],
    }))
    expect(f).toMatchObject({ day: 20261110, seq: 362, prevSeq: 361, epoch: 9, minute: MIN, complete: true, withAv: false, daily: null })
    expect(frameRows(f)).toEqual([
      { minute: MIN, kind: KIND_ONTIME, sym: 'AAPL', o: 1, h: 2, l: 0.5, c: 1.5, v: 0 },
      { minute: MIN, kind: KIND_ONTIME, sym: 'BRK-B', o: 5.565822, h: 5.6, l: 5.5, c: 5.55, v: 10.5 },
      { minute: MIN, kind: KIND_ONTIME, sym: 'MSFT', o: 410.12, h: 410.5, l: 409.9, c: 410.3333, v: 1234 },
      { minute: MIN - 1, kind: KIND_LATE, sym: 'AAPL', o: 3, h: 4, l: 2, c: 3.5, v: 7 },
      { minute: MIN - 2, kind: KIND_REPLACE, sym: 'ZZZ', o: 9, h: 9, l: 9, c: 9, v: 1 },
    ])
  })

  it('an empty frame, the INCOMPLETE flag, an explicit prev_seq and the first frame of the day', () => {
    expect(decodeFrame(writeFrame({ minute: MIN }))).toMatchObject({ n: 0, complete: true, seq: 362 })
    expect(decodeFrame(writeFrame({ minute: MIN, incomplete: true })).complete).toBe(false)
    expect(decodeFrame(writeFrame({ minute: MIN, prevSeq: 350 })).prevSeq).toBe(350)
    const first = decodeFrame(writeFrame({ minute: Date.UTC(2026, 10, 10, 9, 0) / 60000 }))     // 04:00 ET
    expect(first).toMatchObject({ seq: 0, prevSeq: NO_SEQ })
  })

  it('a damaged byte fails the CRC (the writer really writes one)', () => {
    const b = writeFrame({ minute: MIN, blocks: [{ rows: [{ sym: 'AAA', o: 1, h: 2, l: 1, c: 2, v: 3 }] }] })
    b[40] ^= 0xff
    expect(() => decodeFrame(b)).toThrow(FrameError)
  })

  it('framePath names the minute file the consumer asks for', () => {
    expect(framePath(MIN)).toBe('2026-11-10/1002.bin')
  })
})
