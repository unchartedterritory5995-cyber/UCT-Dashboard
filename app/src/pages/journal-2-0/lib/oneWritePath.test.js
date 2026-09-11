/**
 * ⛔⛔ ONE WRITE PATH — no capture door may hand-roll a note write.
 *
 * Every "Send to Journal" door freezes a capture and hands it to
 * `sendCaptureToJournal`, which is the single place a capture becomes a
 * persisted thing. A door that builds its own `fetch` would be a second writer
 * to the member's notes — and this wave has just spent three deploys proving how
 * expensive a second writer is to reason about, even when the second writer was
 * only an instrument.
 *
 * ⭐ The door set is DERIVED, never typed: any file that calls
 * `sendCaptureToJournal` is a door, so a door added tomorrow is covered the day
 * it lands. (`lesson_a_gate_list_drifts_like_any_other_artifact` — a hand-typed
 * roster is the thing that goes stale.)
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.join(process.cwd(), 'src')

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== '__fixtures__') walk(p, out)
    } else if (/\.(jsx?|tsx?)$/.test(e.name) && !/\.test\.[jt]sx?$/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

const files = walk(SRC)
const read = (f) => fs.readFileSync(f, 'utf8')

/** ⛔ CODE, NEVER PROSE. This repo has caught itself matching its own comments
 *  nine times; a door that merely *mentions* a PUT in a comment is not a door
 *  that performs one. */
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

const doors = files.filter((f) => /\bsendCaptureToJournal\s*\(/.test(stripComments(read(f))))

describe('⛔⛔ every capture door writes through ONE path', () => {
  it('⭐ NON-VACUITY: the sweep actually found the doors', () => {
    // The nine original doors plus Wave R's additions. If this ever reads 0 the
    // assertions below are vacuous and would pass over an empty set.
    expect(doors.length).toBeGreaterThanOrEqual(8)
    const names = doors.map((f) => path.basename(f))
    expect(names).toContain('ChartWidget.jsx')
    expect(names).toContain('TickerActions.jsx')        // Wave R, R-2e
    expect(names).toContain('ScannerResults.jsx')       // Wave R, R-1a
  })

  it('⛔ no door hand-rolls a note write', () => {
    const offenders = []
    for (const f of doors) {
      const code = stripComments(read(f))
      // a write to the notes API from inside a door
      if (/fetch\(\s*[`'"][^`'"]*\/api\/j2\/notes/.test(code)
        && /method:\s*['"](PUT|PATCH|POST)['"]/.test(code)) {
        offenders.push(path.relative(SRC, f))
      }
    }
    expect(offenders, 'these doors write to the notes API directly').toEqual([])
  })

  it('⛔ no door imports the durable/offline layer — that layer has its own writer', () => {
    const offenders = doors
      .filter((f) => /from\s+['"][^'"]*lib\/offline\//.test(stripComments(read(f))))
      .map((f) => path.relative(SRC, f))
    expect(offenders, 'a door reaching into the offline layer is a second writer').toEqual([])
  })

  it('⭐ CONTROL — the matcher CAN see a hand-rolled write when one is present', () => {
    const planted = stripComments(`
      const x = 1
      await fetch('/api/j2/notes/' + id, { method: 'PUT', body: '{}' })
    `)
    expect(
      /fetch\(\s*[`'"][^`'"]*\/api\/j2\/notes/.test(planted)
      && /method:\s*['"](PUT|PATCH|POST)['"]/.test(planted),
    ).toBe(true)
  })

  it('⭐ CONTROL — and it does NOT fire on a comment that merely describes one', () => {
    const commented = stripComments(`
      // we deliberately do not fetch('/api/j2/notes/'+id, { method: 'PUT' }) here
      sendCaptureToJournal('chart', cap, {})
    `)
    expect(/fetch\(\s*[`'"][^`'"]*\/api\/j2\/notes/.test(commented)).toBe(false)
  })
})
