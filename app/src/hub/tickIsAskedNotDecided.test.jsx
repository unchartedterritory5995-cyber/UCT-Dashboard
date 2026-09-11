/**
 * D-31 — there is a real tick table, it lives BESIDE THE PRICE FORMATTER, and the hub consumes it
 * like any other caller.
 *
 * ⛔ THE DEFECT THIS EXISTS FOR, in the row's own words (owner ruling, A2): "NEVER a hub-side
 * scaling hack ... a second opinion about what a price step means, living in a gesture handler, is
 * the second-authority defect this project keeps re-finding — and it would be invisible, because a
 * wrong step still produces a plausible number." There is no crash to catch here and no red
 * pixel: a $0.30 stock stepping by a cent renders a perfectly plausible stop. So this rail asks
 * the two questions a wrong step CAN be caught by — does a sub-dollar name actually move by less
 * than a cent end-to-end, and does the number the member READS carry that precision — plus the
 * structural one: is there exactly one table.
 *
 * ⛔ RENDERED TEXT, not state (CLAUDE.md). A stop the sheet rounds to 0.30 for display is the same
 * defect as a stop it rounds to 0.30 for storage, and only the DOM can tell them apart.
 */
import { describe, it as vitestIt, expect, afterAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import StopConfirmSheet from './StopConfirmSheet'
import {
  TICK_TABLE, DEFAULT_TICK, tickSizeFor, roundToTick, formatPrice,
} from '../components/chart/drawingLabels'
import {
  STOP_TICK, stopTickFor, clampStopToSide, candidateStopFor, stopPatchFor, sideFlipRefusal,
} from './sections/journalSection'

// House control: `vitest -t` is a REGEX and a filter matching nothing exits 0 as a PASS.
let definedCount = 0
let executedCount = 0
function it(name, fn) {
  definedCount += 1
  return vitestIt(name, (...args) => { executedCount += 1; return fn(...args) })
}
afterAll(() => {
  expect(executedCount).toBeGreaterThan(0)
  expect(executedCount).toBe(definedCount)
})

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..')

// A real sub-dollar position. 0.2975 is three ticks under 0.30 — a value that EXISTS at the
// table's step and does not exist at a cent, so every assertion below can tell the two apart.
const PENNY_STOCK = {
  symbol: 'SNDL',
  side: 'Long',
  entry: 0.3200,
  shares: 10000,
  currentStop: 0.3000,
  originalStop: 0.3000,
  stop: 0.2975,
}

describe('the table is a table, and it answers by price', () => {
  it('a $1+ name steps by a cent; a sub-dollar name steps by a hundredth of one', () => {
    expect(tickSizeFor(178.10)).toBe(0.01)
    expect(tickSizeFor(4000)).toBe(0.01)
    expect(tickSizeFor(0.30)).toBe(0.0001)
    // The boundary is Reg NMS's, not a rounded guess: AT $1.00 the cent applies.
    expect(tickSizeFor(1)).toBe(0.01)
    expect(tickSizeFor(0.9999)).toBe(0.0001)
  })

  it('reads the magnitude, so a negative quote is not silently sub-penny', () => {
    expect(tickSizeFor(-178.10)).toBe(tickSizeFor(178.10))
  })

  it('a missing price falls back to the table\'s own top row, never to a finer step', () => {
    for (const bad of [null, undefined, '', NaN, 'abc', {}]) expect(tickSizeFor(bad)).toBe(DEFAULT_TICK)
    expect(DEFAULT_TICK).toBe(TICK_TABLE[TICK_TABLE.length - 1].tick)
  })

  it('the formatter renders AT the tick, which is the whole reason they share a module', () => {
    expect(formatPrice(0.2975, { tick: tickSizeFor(0.2975) })).toBe('0.2975')
    expect(formatPrice(177.3, { tick: tickSizeFor(177.3) })).toBe('177.30')
  })

  it('roundToTick snaps to the tick and keeps the cent path byte-identical to the old round2', () => {
    expect(roundToTick(0.29751, 0.0001)).toBe(0.2975)
    expect(roundToTick(178.10000000000002, 0.01)).toBe(178.1)
    // The float artefact the callers' round2 existed to kill must not come back at a finer tick.
    expect(roundToTick(0.1 + 0.2, 0.0001)).toBe(0.3)
    expect(roundToTick('nope', 0.01)).toBeNull()
  })
})

describe('⛔ the hub ASKS for the step — it does not decide one', () => {
  it('the section\'s constant is DERIVED from the table, not restated', () => {
    expect(STOP_TICK).toBe(tickSizeFor(1))
    expect(stopTickFor(0.30)).toBe(tickSizeFor(0.30))
  })

  it('a scrub on a sub-dollar position moves by LESS than a cent', () => {
    // ⛔ THE LOAD-BEARING CASE. With a hub-side `0.01` this returns 0.30 and reads fine.
    const next = candidateStopFor({
      current: 0.2975, entry: 0.3200, side: 'Long', delta: -0.02, // one tick up (50 ticks/travel)
    })
    expect(next).toBe(0.2976)
    expect(Math.abs(next - 0.2975)).toBeLessThan(0.01)
  })

  it('the clamp does not snap a sub-penny stop back to the cent it was just given', () => {
    // The 2dp round that used to live here would return 0.30 — undoing the tick inside the
    // function that was handed it, which is the silent half of this defect.
    expect(clampStopToSide({ stop: 0.2975, entry: 0.3200, side: 'Long' })).toBe(0.2975)
    // ...and the $1+ path is unchanged, so nothing above a dollar moved.
    expect(clampStopToSide({ stop: 177.3, entry: 178.1, side: 'Long' })).toBe(177.3)
  })

  it('the value WRITTEN carries the tick, not a re-rounded cent', () => {
    expect(stopPatchFor(0.2975)).toEqual({ stopPrice: 0.2975 })
    expect(stopPatchFor(177.304)).toEqual({ stopPrice: 177.3 })
  })

  it('the refusal sentence does not print two different stops as the same number', () => {
    const msg = sideFlipRefusal({ stop: 0.3300, entry: 0.3200, side: 'Long' })
    expect(msg).toContain('0.3300')
    expect(msg).toContain('0.3200')
  })
})

describe('⛔ RENDERED TEXT — the member reads the number at the step they are moving it by', () => {
  const open = (props = {}) => render(
    <StopConfirmSheet onConfirm={() => {}} onClose={() => {}} {...PENNY_STOCK} {...props} />,
  )

  it('the sub-dollar stop renders at the table\'s precision, in the body AND the button', () => {
    open()
    expect(screen.getByTestId('hub-stop-new')).toHaveTextContent('New stop 0.2975')
    expect(screen.getByTestId('hub-stop-current')).toHaveTextContent('Current stop 0.3000')
    expect(screen.getByTestId('hub-stop-primary')).toHaveTextContent('Set stop 0.2975')
    // The defect, named: a cent-rounded display shows this member "0.30" and "0.30".
    expect(screen.getByTestId('hub-stop-new')).not.toHaveTextContent('New stop 0.30 ')
  })

  it('the WCAG equal path steps at the same tick the gesture does', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: /increase stop/i }))
    expect(screen.getByTestId('hub-stop-new')).toHaveTextContent('New stop 0.2976')
    expect(screen.getByTestId('hub-stop-input')).toHaveAttribute('step', '0.0001')
  })

  it('CONTROL: the same sheet on a $178 name still reads in cents', () => {
    // Proves the assertions above are about the TICK and not about a formatter that broke.
    open({
      symbol: 'AAPL', entry: 178.1, currentStop: 176, originalStop: 176, stop: 177.3,
    })
    expect(screen.getByTestId('hub-stop-new')).toHaveTextContent('New stop 177.30')
    expect(screen.getByTestId('hub-stop-input')).toHaveAttribute('step', '0.01')
  })
})

// ─── one table, and it is beside the formatter ──────────────────────────────
function jsFilesUnder(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) jsFilesUnder(full, out)
    else if (/\.(jsx?|mjs)$/.test(entry) && !/\.test\./.test(entry)) out.push(full)
  }
  return out
}
const rel = (p) => path.relative(SRC, p).replace(/\\/g, '/')
const PROD_JS = jsFilesUnder(SRC)
const DECLARES_TABLE = PROD_JS.filter((f) => /export\s+const\s+TICK_TABLE\b/.test(readFileSync(f, 'utf8')))

describe('one table, and the row says where it lives', () => {
  it('CONTROL: the sweep read this repo', () => {
    // An empty walk satisfies every "exactly one" below by finding nothing to object to.
    const names = PROD_JS.map(rel)
    expect(names).toContain('components/chart/drawingLabels.js')
    expect(names).toContain('hub/sections/journalSection.js')
  })

  it('exactly ONE module declares the table, and it is the price formatter\'s', () => {
    expect(DECLARES_TABLE.map(rel)).toEqual(['components/chart/drawingLabels.js'])
  })

  it('the hub\'s stop path holds no price-step opinion of its own', () => {
    const offenders = []
    for (const f of ['hub/sections/journalSection.js', 'hub/StopConfirmSheet.jsx']) {
      const src = readFileSync(path.join(SRC, f), 'utf8')
      expect(src, `${f} did not load`).toContain('stopTickFor')
      // Comments are stripped first: this file's own prose names the literals it forbids, and so
      // does the code it guards (contractArity.test.js learned this the same way).
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      for (const [pattern, why] of [
        [/toFixed\(2\)/, 'a 2dp display rounds a finer tick away'],
        [/=\s*0\.01\b/, 'a restated cent is a second answer to what a step is'],
      ]) if (pattern.test(code)) offenders.push(`${f}: ${why}`)
    }
    expect(offenders).toEqual([])
  })
})
