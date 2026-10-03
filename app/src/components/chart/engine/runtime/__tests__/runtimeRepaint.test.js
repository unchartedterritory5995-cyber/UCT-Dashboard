// app/src/components/chart/engine/runtime/__tests__/runtimeRepaint.test.js
//
// ─── RT2 — THE RUNTIME DOCUMENT'S REPAINT CLASS ───────────────────────────────
//
// Four things are proved here:
//   1. the rules, one case per read kind, each with its control;
//   2. ONE AUTHORITY: a clock leaf's reach is the host linter's (`astReach` over
//      `closedTable.json`) — moving the host's declaration moves this answer;
//   3. the Pine spellings the table binds to clock leaves are the ones `pine.js`
//      resolves (`BUILTIN_BARSTATE_SERIES`, `pineClockKeyOf`);
//   4. the committed per-script answer for the whole corpus
//      (`tests/fixtures/runtime_repaint/corpus.json`) is what this module says
//      today — and `tests/test_runtime_repaint.py` holds the Python mirror to
//      the SAME file, so the two languages cannot drift.
//        regenerate:  RT2_WRITE_REPAINT_FIXTURE=1 npx vitest run <this file>

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

import { runtimeRepaintOf, lexRepaint, clockLeafReach, RUNTIME_REPAINT_RULES } from '../runtimeRepaint'
import { REPAINT_MODES, modeFromReach, UNBOUNDED } from '../../ast/lint'
import { TABLE } from '../../ast/parse'
import { BUILTIN_BARSTATE_SERIES, pineClockKeyOf } from '../../ast/pine'

const src = (body) => `//@version=6\nindicator("t")\n${body}\n`
const of = (body) => runtimeRepaintOf(src(body))

describe('RT2 — the rules, each with its control', () => {
  it('a script that reads nothing past its own bar is non-repainting', () => {
    const r = of('x = ta.sma(close, 20)\nvar float acc = 0.0\nacc += close\nplot(x)\nplot(acc)')
    expect(r).toMatchObject({ ok: true, mode: 'non-repainting', forward: 0, reads: [] })
  })

  it('the vocabulary is the host linter\'s, and every class is reachable', () => {
    const seen = new Set([
      of('plot(close)').mode,
      of('plot(barstate.islast ? close : na)').mode,
      of('plot(bar_index > last_bar_index - 5 ? close : na)').mode,
    ])
    expect([...seen].sort()).toEqual([...REPAINT_MODES].sort())
  })

  it('`barstate.islast` reaches one bar ahead: preview-repaints', () => {
    const r = of('plot(barstate.islast ? close : na)')
    expect(r.mode).toBe('preview-repaints')
    expect(r.forward).toBe(1)
    expect(r.reads.map((x) => x.name)).toEqual(['barstate.islast'])
  })

  it('`last_bar_index`, `last_bar_time` and `timenow` are unbounded: repaints', () => {
    for (const name of ['last_bar_index', 'last_bar_time', 'timenow']) {
      const r = of(`plot(${name} > 0 ? close : na)`)
      expect(r.mode, name).toBe('repaints')
      expect(r.forward, name).toBe(UNBOUNDED)
    }
  })

  it('the clock leaves the host table declares, and that do not move, add nothing', () => {
    // ⭐ THE CONTROL for the two above: a barstate read is not by itself a repaint.
    for (const name of ['barstate.isconfirmed', 'barstate.isrealtime', 'barstate.ishistory',
      'barstate.isfirst', 'bar_index', 'time', 'dayofweek']) {
      expect(of(`plot(${name} ? close : na)`).mode, name).toBe('non-repainting')
    }
  })

  it('varip, barstate.isnew and the visible range repaint', () => {
    expect(of('varip int n = 0\nn += 1\nplot(n)').mode).toBe('repaints')
    expect(of('plot(barstate.isnew ? 1 : 0)').mode).toBe('repaints')
    expect(of('plot(time > chart.left_visible_bar_time ? 1 : 0)').mode).toBe('repaints')
  })

  it('a request of THIS chart at THIS period adds nothing; any other request repaints', () => {
    for (const call of [
      'request.security(syminfo.tickerid, timeframe.period, close)',
      'request.security(syminfo.tickerid, "", close)',
      'request.security(symbol = syminfo.tickerid, timeframe = timeframe.period, expression = close)',
      'security(syminfo.tickerid, timeframe.period, close)',
    ]) expect(of(`x = ${call}\nplot(x)`).mode, call).toBe('non-repainting')
    for (const call of [
      'request.security(syminfo.tickerid, "D", close)',
      'request.security("SPY", timeframe.period, close)',
      'request.security(syminfo.tickerid, tf, close)',
      'request.security_lower_tf(syminfo.tickerid, "5", close)',
      'security(tickerid, period, close)',
    ]) expect(of(`x = ${call}\nplot(x)`).mode, call).toBe('repaints')
  })

  it('look-ahead and calc_on_every_tick repaint unless written off', () => {
    expect(of('x = request.security(syminfo.tickerid, timeframe.period, close, lookahead = barmerge.lookahead_on)\nplot(x)').mode)
      .toBe('repaints')
    expect(of('x = request.security(syminfo.tickerid, timeframe.period, close, lookahead = barmerge.lookahead_off)\nplot(x)').mode)
      .toBe('non-repainting')
    expect(runtimeRepaintOf('//@version=5\nstrategy("s", calc_on_every_tick = true)\nplot(close)').mode).toBe('repaints')
    expect(runtimeRepaintOf('//@version=5\nstrategy("s", calc_on_every_tick = false)\nplot(close)').mode).toBe('non-repainting')
  })

  it('⛔ code, never prose: a name in a comment or a string reads nothing', () => {
    expect(of('// barstate.islast and request.security and varip\nplot(close)').mode).toBe('non-repainting')
    expect(of('t = "timenow last_bar_index request.security("\nplot(close)').mode).toBe('non-repainting')
  })

  it('a dotted name split by spaces is the same read (as pine.js lexes it)', () => {
    expect(of('plot(barstate . islast ? close : na)').mode).toBe('preview-repaints')
  })

  it('the worst read wins, and every read is named once', () => {
    const r = of('a = barstate.islast ? 1 : 0\nb = barstate.islast ? 2 : 0\nplot(timenow > 0 ? a + b : na)')
    expect(r.mode).toBe('repaints')
    expect(r.reads.map((x) => x.name)).toEqual(['barstate.islast', 'timenow'])
  })

  it('⛔ an unreadable source has no stated class', () => {
    const r = runtimeRepaintOf('//@version=5\nindicator("t")\nx = "never closed\nplot(close)')
    expect(r.ok).toBe(false)
    expect(r.why).toMatch(/unterminated string/)
  })

  it('the lexer keeps a string spanning lines as one token, and its escapes', () => {
    expect(lexRepaint('a = "x\\"y\nz"\nb').map((t) => t.k)).toEqual(['id', 'p', 'str', 'id'])
  })
})

describe('RT2 — ONE AUTHORITY: a clock leaf\'s reach is the host linter\'s', () => {
  it('every clock leaf the table binds exists in the shared closedTable.json clock', () => {
    for (const [pine, key] of Object.entries(RUNTIME_REPAINT_RULES.clockReads)) {
      if (pine.startsWith('_')) continue
      expect(Object.prototype.hasOwnProperty.call(TABLE.clock, key), `${pine} -> ${key}`).toBe(true)
    }
  })

  it('every Pine spelling the table binds is the leaf pine.js resolves it to', () => {
    for (const [pine, key] of Object.entries(RUNTIME_REPAINT_RULES.clockReads)) {
      if (pine.startsWith('_')) continue
      expect(pineClockKeyOf(pine), pine).toBe(key)
    }
  })

  it('every barstate spelling pine.js serves as a clock column is in the table', () => {
    for (const pine of Object.keys(BUILTIN_BARSTATE_SERIES)) {
      expect(RUNTIME_REPAINT_RULES.clockReads[pine], pine).toBe(BUILTIN_BARSTATE_SERIES[pine])
    }
  })

  it('⭐ MOVING the host declaration moves the runtime answer (no second copy)', () => {
    // A copy of the shared manifest in which the host declares a forward window
    // on `isconfirmed` — the runtime reach follows it, because it IS the host's.
    const moved = JSON.parse(JSON.stringify(TABLE))
    moved.clock.isconfirmed = { ...moved.clock.isconfirmed, forward: 3 }
    expect(modeFromReach(clockLeafReach('isconfirmed'))).toBe('non-repainting')
    expect(clockLeafReach('isconfirmed', moved)).toBe(3)
    expect(modeFromReach(clockLeafReach('isconfirmed', moved))).toBe('preview-repaints')
    // and the edge finding joins the host's answer, never replaces it
    moved.clock.islast = { ...moved.clock.islast, forward: 'unbounded' }
    expect(clockLeafReach('islast', moved)).toBe(UNBOUNDED)
    expect(clockLeafReach('islast')).toBe(1)
  })
})

/** Every committed corpus script: its class, and the reads that set it. */
function corpusAnswers() {
  const repo = path.resolve(process.cwd(), '..')
  const dir = path.join(repo, 'corpus', 'committed')
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.pine')).sort()
  return files.map((f) => {
    const bytes = fs.readFileSync(path.join(dir, f))
    const r = runtimeRepaintOf(bytes.toString('utf8'))
    return {
      file: `corpus/committed/${f}`,
      // ⛔ of the LF text: a checkout's line endings are the box's, not the script's
      sha256: createHash('sha256').update(bytes.toString('utf8').replace(/\r\n?/g, '\n')).digest('hex'),
      ...(r.ok
        ? { mode: r.mode, forward: r.forward, reads: r.reads.map((x) => [x.name, x.forward]) }
        : { mode: null, why: r.why }),
    }
  })
}

describe('RT2 — the corpus answer both languages are held to', () => {
  const fixture = path.resolve(process.cwd(), '..', 'tests', 'fixtures', 'runtime_repaint', 'corpus.json')
  it('the committed fixture is this module\'s answer for every corpus script', () => {
    const rows = corpusAnswers()
    expect(rows.length).toBeGreaterThan(200)
    if (process.env.RT2_WRITE_REPAINT_FIXTURE === '1') {
      fs.mkdirSync(path.dirname(fixture), { recursive: true })
      fs.writeFileSync(fixture, `${JSON.stringify({
        generatedBy: 'app/src/components/chart/engine/runtime/__tests__/runtimeRepaint.test.js',
        rows,
      }, null, 1)}\n`)
    }
    const committed = JSON.parse(fs.readFileSync(fixture, 'utf8'))
    expect(committed.rows).toEqual(rows)
    // non-vacuity: the corpus reaches all three classes and an unread source is rare
    const modes = new Set(rows.map((r) => r.mode))
    for (const m of REPAINT_MODES) expect(modes.has(m), m).toBe(true)
  })
})
