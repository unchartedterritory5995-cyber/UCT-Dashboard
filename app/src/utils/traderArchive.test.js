// The archive's formatting and its one door (archiveHref). Synthetic values only.
import { describe, it, expect } from 'vitest'

import { archiveHref, fmtDay, setupName } from './traderArchive'

describe('archiveHref — every door into the archive lands on The Desk tab', () => {
  it('builds the Desk URL, upper-casing a symbol', () => {
    expect(archiveHref()).toBe('/desk?section=archive')
    expect(archiveHref({ sym: 'zzta' })).toBe('/desk?section=archive&sym=ZZTA')
    expect(archiveHref({ view: 'playbooks', setup: 'kicker' })).toBe('/desk?section=archive&view=playbooks&setup=kicker')
  })
})

describe('setupName — a setup id as words', () => {
  it.each([
    ['pullback_ma', 'Pullback MA'],
    ['vcp', 'VCP'],
    ['rs_leader', 'RS leader'],
    ['flow_put_buy', 'Flow put buy'],
    ['', ''],
  ])('%s → %s', (id, label) => expect(setupName(id)).toBe(label))

  it('does not upper-case a word that merely contains an acronym', () => {
    expect(setupName('emacs_rsi')).toBe('Emacs rsi')                         // 'ema' and 'rs' are inside words
  })
})

describe('fmtDay', () => {
  it('reads a date as the calendar day it names, never shifted by time zone', () => {
    expect(fmtDay('2025-01-02')).toBe('Jan 2, 2025')
    expect(fmtDay('2025-01-02T23:30:00-05:00')).toBe('Jan 2, 2025')
    expect(fmtDay('not a date')).toBe('not a date')
  })
})
