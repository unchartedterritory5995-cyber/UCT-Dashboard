// lib/thesisChips.js: the small chip on a row for a stock the member has written about. The
// chip's only arithmetic is the distance from the row's current price to the note's stop, so a
// wrong sign or a percent read as a fraction would tell a member their stop is safe when it is
// broken. Pinned against the chips the SERVER really sends (contract fixtures).
import { describe, it, expect, afterEach } from 'vitest'
import {
  THESIS_CHIPS_FLAG, THESIS_CHIPS_URL, STATUS_META, thesisChipsEnabled, formatLevel, stopDistanceText, chipLabel,
} from './thesisChips'
import { latchNotebookFlags, __resetNotebookFlags } from './offline/notebookFlags'
import { contract, contractBody } from '../__fixtures__/contract'

afterEach(() => __resetNotebookFlags())

const chips = () => contractBody('thesis-chips')

describe('the gate', () => {
  it('is off until the server says on', () => {
    expect(thesisChipsEnabled()).toBe(false)                       // nothing latched yet
    latchNotebookFlags({ notebook_offline_read_on: true })           // a payload without this key
    expect(thesisChipsEnabled()).toBe(false)
  })

  it('is on only for a real true', () => {
    latchNotebookFlags({ [THESIS_CHIPS_FLAG]: true })
    expect(thesisChipsEnabled()).toBe(true)
  })

  it.each([['the string "true"', 'true'], ['1', 1], ['null', null], ['false', false]])(
    'stays off for %s', (_label, value) => {
      latchNotebookFlags({ [THESIS_CHIPS_FLAG]: value, notebook_offline_read_on: true })
      expect(thesisChipsEnabled()).toBe(false)
    })

  it('asks the route the server really serves', () => {
    expect(contract('thesis-chips')._contract.endpoint).toBe(`POST ${THESIS_CHIPS_URL}`)
  })
})

describe('STATUS_META mirrors the server\'s thesis status options', () => {
  it('holds exactly the four values, labels and colors the server declares', () => {
    const { options } = contractBody('constants.thesis-status-options')
    expect(options.length).toBe(4)
    const fromServer = Object.fromEntries(options.map((o) => [o.id, { label: o.label, color: o.color }]))
    expect(STATUS_META).toEqual(fromServer)
  })

  it('has a label for every status a recorded chip carries', () => {
    const seen = new Set(Object.values(chips()).map((c) => c.thesisStatus).filter(Boolean))
    expect(seen.size).toBeGreaterThan(1)
    for (const s of seen) expect(STATUS_META[s]?.label, `no label for "${s}"`).toBeTruthy()
  })
})

describe('formatLevel', () => {
  it('prints the levels the server sends as dollars with two decimals', () => {
    const { TCNV } = chips()
    expect([formatLevel(TCNV.entry), formatLevel(TCNV.stop), formatLevel(TCNV.target)])
      .toEqual(['$100.00', '$90.00', '$120.00'])
  })

  it('shows a dash for a level the note does not have', () => {
    expect(chips().TCAM.stop).toBeNull()
    expect(formatLevel(chips().TCAM.stop)).toBe('—')
    expect(formatLevel(undefined)).toBe('—')
  })

  it('prints zero as a price, not as missing', () => {
    expect(formatLevel(0)).toBe('$0.00')
  })

  it.each([['a numeric string', '90'], ['NaN', NaN], ['Infinity', Infinity], ['an object', {}], ['true', true]])(
    'shows a dash for %s instead of coercing it', (_label, v) => {
      expect(formatLevel(v)).toBe('—')
    })

  it('rounds to the cent and does not use exponent form', () => {
    expect(formatLevel(96.005)).toBe('$96.00')
    expect(formatLevel(1234567.891)).toBe('$1234567.89')
  })
})

describe('stopDistanceText: how far the price is from the stop', () => {
  const chip = () => chips().TCNV                                   // stop 90

  it('is positive and "above stop" while the price is above it', () => {
    expect(stopDistanceText(chip(), 100)).toBe('+10.0% above stop')
  })

  it('is negative and "below stop" once the price is through it', () => {
    expect(stopDistanceText(chip(), 80)).toBe('-12.5% below stop')
  })

  it('measures against the CURRENT price, not the stop', () => {
    // (100 - 90) / 100 = 10%. Dividing by the stop instead would read 11.1%.
    expect(stopDistanceText({ stop: 90 }, 100)).toBe('+10.0% above stop')
    expect(stopDistanceText({ stop: 50 }, 200)).toBe('+75.0% above stop')
  })

  it('is a percent, not a fraction', () => {
    expect(stopDistanceText({ stop: 99 }, 100)).toBe('+1.0% above stop')
  })

  it('reads a price sitting exactly on the stop as zero above, never as below', () => {
    expect(stopDistanceText({ stop: 90 }, 90)).toBe('+0.0% above stop')
  })

  it('never pairs a plus sign with "below"', () => {
    for (const price of [89.99, 89.999, 90.001, 45, 9000]) {
      const text = stopDistanceText({ stop: 90 }, price)
      expect(text).toMatch(price >= 90 ? /^\+\d.*above stop$/ : /^-\d.*below stop$/)
    }
  })

  it('is null without a stop, so the chip falls back to the status', () => {
    expect(stopDistanceText(chips().TCAM, 100)).toBeNull()
    expect(stopDistanceText({}, 100)).toBeNull()
    expect(stopDistanceText(null, 100)).toBeNull()
    expect(stopDistanceText(undefined, 100)).toBeNull()
    expect(stopDistanceText({ stop: '90' }, 100)).toBeNull()
    expect(stopDistanceText({ stop: NaN }, 100)).toBeNull()
  })

  it('is null without a usable price, never a division by zero', () => {
    for (const price of [null, undefined, 0, NaN, Infinity, '100']) {
      expect(stopDistanceText({ stop: 90 }, price)).toBeNull()
    }
  })

  it('handles a stop of zero as a real level', () => {
    expect(stopDistanceText({ stop: 0 }, 50)).toBe('+100.0% above stop')
  })

  it('stays readable for a very large gap', () => {
    expect(stopDistanceText({ stop: 1 }, 1_000_000)).toBe('+100.0% above stop')
    expect(stopDistanceText({ stop: 1_000_000 }, 1)).toBe('-99999900.0% below stop')
  })
})

describe('chipLabel: what the chip itself says', () => {
  it('shows the distance when the note has a stop and the row has a price', () => {
    expect(chipLabel(chips().TCNV, 100)).toBe('+10.0% above stop')
  })

  it('shows the status when there is no stop', () => {
    expect(chipLabel(chips().TCAM, 100)).toBe('Watching')
  })

  it('shows the status when the row has no price yet', () => {
    expect(chipLabel(chips().TCNV, null)).toBe('Active')
    expect(chipLabel(chips().TCIN, undefined)).toBe('Invalidated')
  })

  it('is never blank: a neutral word for a status it does not know, or none at all', () => {
    expect(chipLabel({ thesisStatus: 'paused' }, null)).toBe('Thesis')
    expect(chipLabel({ thesisStatus: null }, null)).toBe('Thesis')
    expect(chipLabel({}, null)).toBe('Thesis')
    expect(chipLabel(null, 100)).toBe('Thesis')
    expect(chipLabel(undefined, undefined)).toBe('Thesis')
  })

  // D3 (docs/notebook/fin-tests.md), fixed: the status is looked up as an OWN key, so a status
  // named after something on Object.prototype is unknown like any other, never an empty chip.
  it('D3: does not read an inherited object key as a status', () => {
    expect(chipLabel({ thesisStatus: 'constructor' }, null)).toBe('Thesis')
    expect(chipLabel({ thesisStatus: 'toString' }, null)).toBe('Thesis')
    expect(chipLabel({ thesisStatus: '__proto__' }, null)).toBe('Thesis')
    expect(chipLabel({ thesisStatus: 'hasOwnProperty' }, null)).toBe('Thesis')
    expect(chipLabel({ thesisStatus: 7 }, null)).toBe('Thesis')
  })
})
