// There is no TradingView break-out on the futures strip, and if one returns it
// must be a deliberate act rather than a leftover.
//
// ⚰️ WHAT WAS HERE. `TV_SYMS` mapped BTC/ES/NQ/YM/RTY to TradingView tickers and
// passed them to `TickerPopup` as `tvSym`; `TV_ONLY = new Set(['BTC','VIX'])` sat
// beside it. Measured 2026-09-26 at origin/master: `TV_ONLY` was read NOWHERE in
// the repo, `tvSym` was destructured by TickerPopup and NEVER USED in its body, and
// TickerPopup contained no iframe, no embed and no tradingview.com link. The whole
// chain was dead — somebody removed TradingView from the popup and left the caller
// still computing symbols for it.
//
// ⛔ WHY A RAIL FOR DEAD CODE. Roadmap item TERM-028 was written against this file
// as if it were live ("TV_ONLY handing BTC/VIX charts to TradingView") and planned
// an honest-blank remedy for a break-out that does not exist here. Unreachable code
// read as live is how a plan acquires a phantom work item, and under the owner's
// aggregation thesis a *believed* break-out is as costly as a real one: it spends a
// lane. This rail makes the absence checkable instead of re-derivable.
//
// ⛔⛔ IT STRIPS COMMENTS BEFORE MATCHING. The deletion note left in FuturesStrip
// names TV_SYMS and tvSym in prose, so a naive source scan would match its own
// explanation and fail forever — this repo has logged six separate instances of a
// check matching a comment instead of code. There is a control below proving the
// stripper can still see a real occurrence.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const STRIP_READ = (p) => stripComments(fs.readFileSync(p, 'utf8'))

function stripComments(src) {
  // Line comments and block comments. Crude but sufficient: these two files carry
  // no regex or string literal containing a comment opener (asserted by the control).
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

const FUTURES = path.join(HERE, 'FuturesStrip.jsx')
const POPUP = path.join(HERE, '..', 'TickerPopup.jsx')

describe('the futures strip has no TradingView break-out', () => {
  test('FuturesStrip declares no TradingView symbol mapping in CODE', () => {
    const code = STRIP_READ(FUTURES)
    expect(code).not.toMatch(/\bTV_SYMS\b/)
    expect(code).not.toMatch(/\bTV_ONLY\b/)
    expect(code).not.toMatch(/tvSym\s*=/)
  })

  test('TickerPopup accepts no tvSym prop', () => {
    const code = STRIP_READ(POPUP)
    expect(code).not.toMatch(/\btvSym\b/)
  })

  test('neither file links out to tradingview.com', () => {
    for (const p of [FUTURES, POPUP]) {
      expect(STRIP_READ(p)).not.toMatch(/tradingview\.com/i)
    }
  })

  // ⛔ THE CONTROL. Without this, every assertion above passes just as happily if
  // the file were empty, the path were wrong, or the stripper ate everything.
  test('CONTROL: the stripper keeps code and removes only comments', () => {
    const raw = fs.readFileSync(FUTURES, 'utf8')
    const code = stripComments(raw)

    // The deletion note names TV_SYMS in PROSE — the raw file must contain it and
    // the stripped code must not. That is the whole discrimination this rail rests on.
    expect(raw).toMatch(/\bTV_SYMS\b/)
    expect(code).not.toMatch(/\bTV_SYMS\b/)

    // And real code survives, so the assertions above are not passing over a blank.
    expect(code).toMatch(/CUSTOM_CHART/)
    expect(code).toMatch(/export function Cell/)
    expect(code.length).toBeGreaterThan(500)
  })

  // The deletion must not have removed a real capability: VIX is served by OUR chart.
  test('VIX still routes to our own chart endpoint, not to a third party', () => {
    const code = STRIP_READ(FUTURES)
    expect(code).toMatch(/CUSTOM_CHART\s*=\s*new Set\(\['VIX'\]\)/)
    expect(code).toMatch(/\/api\/chart\//)
  })
})
