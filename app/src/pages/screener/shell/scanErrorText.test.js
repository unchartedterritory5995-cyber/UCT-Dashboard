import { describe, it, expect } from 'vitest'
import { scanErrorText } from './scanErrorText'

describe('scanErrorText', () => {
  it('words every failure from its status and never echoes the server detail', () => {
    const e = (status) => Object.assign(new Error("ValueError: unknown filter 'xyz'"), { status })
    expect(scanErrorText(e(400))).toBe("This scan couldn't run as set. One of the filters can't be applied. Remove the last chip you added, or Reset.")
    expect(scanErrorText(e(422))).toBe(scanErrorText(e(400)))
    expect(scanErrorText(e(402))).toBe('Running scans requires a paid plan.')
    expect(scanErrorText(e(429))).toBe('Too many scans at once. Wait a few seconds, then Retry.')
    expect(scanErrorText(e(503))).toBe("The screener couldn't run this scan right now.")
    expect(scanErrorText(new TypeError('Failed to fetch'))).toBe("The screener couldn't run this scan right now.")
  })
})
