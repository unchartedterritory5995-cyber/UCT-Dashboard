// W9-OQ-N2 (2026-11-07): a `strategy.*` STATE value reaching what a member sees, with the broker DARK.
// The W9-OQ-N1 review (`reviews/W9-OQ-N1.md`) left one case open: `plot(close, color =
// strategy.position_size > 0 ? ...)`. The host lane let that colour fall soft to `colorDynamic` and the
// member door drew the row in ONE default colour with no disclosure: a broker value nobody computes,
// served as "flat" on every bar. The STRAT-COLOR review then found the same silence through a positional
// fill colour, `var` / `:=` state, `switch`, arrays, tuples and drawing colours.
//
// The fix is TAINT (`ast/strategyTaint.js`), not a route-by-route patch: any value derived from a broker
// state read that reaches a member-visible sink (every argument of plot*, fill, bgcolor, barcolor, hline,
// alertcondition / alert, line / label / box / table / polyline / linefill) refuses `pine:strategy-call`
// by name. A row refuses itself, a paint is withheld by name, a drawing step is withheld by name in the
// object pass (owner ruling 2026-11-08: the drawing alone, never its untainted plots), and a band /
// alert / hline (no row, no object of its own) refuses the script. The runtime lane already refused or withheld each of these.
import { describe, it, expect } from 'vitest'
import { translatePine } from '../../ast/pine.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition.js'
import { strategyTaintSinks, isStrategyStateWord } from '../../ast/strategyTaint.js'

const head = (v) => `//@version=${v}\nstrategy("t", overlay = true)\n`
const host = (src) => translatePine(src, { strict: true })
const rt = (src, plotColours = false) => buildRuntimeIr(src, { bars: [], inputs: {}, plotColours })
const SC = 'strategy.position_size > 0 ? color.green : color.red'
const PLOTS = 'p1 = plot(close, "a")\np2 = plot(open, "b")\n'

/** every refusal the host translation carries, row or script */
const refusalsOf = (t) => [
  ...(t.refusals || []),
  ...(t.outputs || []).map((o) => o.refusal).filter(Boolean),
]
/** the host lane names the broker read: a refused row / script, a withheld paint, or a dropped band */
const namesRead = (t, word = 'strategy.position_size') =>
  refusalsOf(t).some((r) => r.guard === 'pine:strategy-call' && r.message.includes(`\`${word}\``))
  || ((t.presentation && t.presentation.paints) || []).some((p) => p.withheld
    && p.withheld.code === 'pine:strategy-call' && p.withheld.reason.includes(`\`${word}\``))
  || drawingWithheld(t, word)
/** a drawing step withheld by name in the object pass (owner ruling: the drawing alone, not the script) */
const drawingWithheld = (t, word = 'strategy.position_size') => {
  const d = t.objectDiagnostics || {}
  return Object.keys(d.dropReasons || {}).some((k) => k.startsWith('strategy:'))
    && (d.guardRefusals || []).some((e) => e.includes('pine:strategy-call'))
    && (d.guardRefusalWhy || []).some((e) => e.includes(`\`${word}\``))
}

describe.each(['5', '6'])('W9-OQ-N2 v%s strategy() — a broker value reaching a member-visible sink refuses by name', (v) => {
  const H = head(v)

  // ── the routes, each one on the host lane ────────────────────────────────────────────
  const ROUTES = {
    'named plot colour': `plot(close, color = ${SC})\n`,
    'positional plot colour': `plot(close, "t", ${SC})\n`,
    'a variable': `c = ${SC}\nplot(close, color = c)\n`,
    'var + := state': `var color c = na\nc := ${SC}\nplot(close, color = c)\n`,
    'var bool state': 'var bool inpos = false\ninpos := strategy.position_size > 0\nplot(close, color = inpos ? color.green : color.red)\n',
    ':= inside a tainted if': 'var color c = color.red\nif strategy.position_size > 0\n    c := color.green\nplot(close, color = c)\n',
    'the else branch of a tainted if': 'var color c = color.red\nif strategy.position_size > 0\n    c := color.red\nelse\n    c := color.green\nplot(close, color = c)\n',
    'only the else branch assigns': 'var color c = color.red\nvar int n = 0\nif strategy.position_size > 0\n    n := 1\nelse\n    c := color.green\nplot(close, color = c)\n',
    'a statement switch arm assigns': 'var color c = color.red\nswitch\n    strategy.position_size > 0 => c := color.green\n    => c := color.red\nplot(close, color = c)\n',
    'switch arm':'c = switch\n    strategy.position_size > 0 => color.green\n    => color.red\nplot(close, color = c)\n',
    'if-expression': 'c = if strategy.position_size > 0\n    color.green\nelse\n    color.red\nplot(close, color = c)\n',
    'array': 'a = array.from(strategy.position_size)\nplot(close, color = array.get(a, 0) > 0 ? color.green : color.red)\n',
    'array push': 'a = array.new_float(0)\narray.push(a, strategy.position_size)\nplot(close, color = array.get(a, 0) > 0 ? color.green : color.red)\n',
    'method push': 'a = array.new_float(0)\na.push(strategy.position_size)\nplot(close, color = a.get(0) > 0 ? color.green : color.red)\n',
    'map put': 'm = map.new<string, float>()\nmap.put(m, "k", strategy.position_size)\nplot(close, color = map.get(m, "k") > 0 ? color.green : color.red)\n',
    'tuple': '[a, b] = [strategy.position_size, close]\nplot(close, color = a > 0 ? color.green : color.red)\n',
    'function body': `f() => ${SC}\nplot(close, color = f())\n`,
    'function argument': 'f(x) => x > 0 ? color.green : color.red\nplot(close, color = f(strategy.position_size))\n',
    'color.new transparency': 'plot(close, color = color.new(color.red, strategy.opentrades > 0 ? 0 : 90))\n',
    'color.from_gradient': 'plot(close, color = color.from_gradient(strategy.position_size, -1, 1, color.red, color.green))\n',
    'request.security': `x = request.security(syminfo.tickerid, "D", strategy.position_size)\nplot(close, color = x > 0 ? color.green : color.red)\n`,
    'plotchar colour': `plotchar(close > open, "c", "x", color = ${SC})\nplot(close)\n`,
    'plotcandle colour': `plotcandle(open, high, low, close, color = ${SC})\n`,
    'named fill colour': `${PLOTS}fill(p1, p2, color = ${SC})\n`,
    'positional fill colour': `${PLOTS}fill(p1, p2, ${SC})\n`,
    'gradient fill colour': `${PLOTS}fill(p1, p2, close, open, strategy.position_size > 0 ? color.green : color.red, color.blue)\n`,
    'bgcolor': `bgcolor(${SC})\nplot(close)\n`,
    'label colour': `label.new(bar_index, high, "x", color = ${SC})\nplot(close)\n`,
    'line colour': `line.new(bar_index, high, bar_index + 1, high, color = ${SC})\nplot(close)\n`,
    'box bgcolor': `box.new(bar_index, high, bar_index + 1, low, bgcolor = ${SC})\nplot(close)\n`,
    'label.set_color': `var lbl = label.new(bar_index, high, "x")\nlabel.set_color(lbl, ${SC})\nplot(close)\n`,
    'method set_color': `var lbl = label.new(bar_index, high, "x")\nlbl.set_color(${SC})\nplot(close)\n`,
    'table.cell bgcolor': `var t = table.new(position.top_right, 1, 1)\ntable.cell(t, 0, 0, "x", bgcolor = ${SC})\nplot(close)\n`,
    'drawing in a tainted if': 'if strategy.position_size > 0\n    label.new(bar_index, high, "in")\nplot(close)\n',
    'alert in a tainted if': 'if strategy.position_size > 0\n    alert("in")\nplot(close)\n',
    'alertcondition': 'alertcondition(strategy.position_size > 0, "in")\nplot(close)\n',
    'a drawing in a function fed a tainted argument': 'f(c) =>\n    label.new(bar_index, high, "x", color = c)\nf(strategy.position_size > 0 ? color.green : color.red)\nplot(close)\n',
  }
  for (const [route, body] of Object.entries(ROUTES)) {
    it(`host refuses by name: ${route}`, () => {
      const t = host(H + body)
      const word = /strategy\.opentrades/.test(body) ? 'strategy.opentrades' : 'strategy.position_size'
      expect(namesRead(t, word), JSON.stringify(refusalsOf(t).map((r) => r.guard))).toBe(true)
    })
  }

  it('host: a band a broker value reaches refuses the script; a static band is still drawn', () => {
    expect(host(`${H}${PLOTS}fill(p1, p2, ${SC})\n`).ok).toBe(false)
    const ctl = host(`${H}${PLOTS}fill(p1, p2, color.red)\n`)
    expect(ctl.ok).toBe(true)
    expect(ctl.presentation.fills.length).toBe(1)
  })

  it('host: a paint is withheld by name, not drawn', () => {
    const t = host(`${H}bgcolor(${SC})\nplot(close)\n`)
    expect(t.presentation.paints[0].withheld.code).toBe('pine:strategy-call')
    expect(t.presentation.paints[0].withheld.reason).toContain('`strategy.position_size`')
  })

  it('host (rsi-vwap shape): the untainted plot is served and ONLY the tainted label is withheld, by name', () => {
    const t = host(`${H}r = ta.rsi(close, 14)\nplot(r, "RSI")\n`
      + 'var label lbl = na\nlbl := label.new(bar_index, 50, "Position Size: " + str.tostring(strategy.position_size))\n'
      + 'label.delete(lbl[1])\n')
    expect(t.ok).toBe(true)
    expect(t.outputs[0].refusal).toBeNull()
    expect(t.outputs[0].kind).toBe('plot')
    expect(refusalsOf(t).some((r) => r.guard === 'pine:strategy-call')).toBe(false)
    expect(drawingWithheld(t)).toBe(true)
    // the delete of the withheld label is NOT itself withheld (a lost delete would hide every drawing)
    expect(t.objectDiagnostics.dropReasons['strategy:delete']).toBeUndefined()
    // …so the member door still draws the script's other drawings (rsi-vwap-indicator, owner ruling)
    const d = memberPaneDefinition({ source: `${H}r = ta.rsi(close, 14)\nplot(r, "RSI")\n`
      + 'var label lbl = na\nlbl := label.new(bar_index, 50, "Position Size: " + str.tostring(strategy.position_size))\n'
      + 'label.delete(lbl[1])\nif ta.crossover(r, 30)\n    label.new(bar_index, 30, "x", style = label.style_diamond)\n', id: 'x', name: 'x' })
    expect(d.ok).toBe(true)
    expect(JSON.stringify(d.definition.meta.disclosures)).not.toMatch(/drawings are not|can't be shown/)
  })

  // ⭐ W9 D8 ("show the refusal") — the member's drawing note names the REASON for a strategy-withheld
  // drawing, on the saved document's disclosures (the surface a member actually reads).
  it('member note: a drawing withheld for a strategy read says why, in plain words', () => {
    const notesOf = (src) => {
      const d = memberPaneDefinition({ source: src, id: 'x', name: 'x' })
      expect(d.ok).toBe(true)
      return d.definition.meta.disclosures.filter((n) => n.name === 'Drawings').map((n) => n.note)
    }
    const [n] = notesOf(`${H}plot(close)\nlabel.new(bar_index, high, "x", color = ${SC})\n`)
    const PURE1 = /^1 of 1 drawing elements in this script reads values from the strategy's backtest \(such as its position, trades, equity or settings\), which this chart doesn't run yet, so what it draws is incomplete\./
    expect(n).toMatch(PURE1)
    expect(n).not.toMatch(/supported yet|pine:|guard|results|compute/)
    // ⛔ STRAT-NOTE r1 (B1): reads that are NOT results — a declaration setting and a currency
    // conversion — must get words that are true of them too ("values from the backtest", "settings").
    for (const read of ['strategy.initial_capital', 'strategy.convert_to_account(close)']) {
      const [s] = notesOf(`${H}plot(close)\nlabel.new(bar_index, high, str.tostring(${read}))\n`)
      expect(s, read).toMatch(PURE1)
    }
    // a delete the broker decides: the drawings are withheld, and the note gives that reason too
    const [w] = notesOf(`${H}plot(close)\nvar label lbl = label.new(bar_index, high, "x")\nif strategy.position_size > 0\n    label.delete(lbl)\n`)
    expect(w).toMatch(/^This script's plots are shown, but its drawings are not\./)
    expect(w).toMatch(/ Some of what it removes is decided by values from the strategy's backtest, which this chart doesn't run yet\.$/)
    // control: the untainted label draws, and there is no drawing note at all
    expect(notesOf(`${H}plot(close)\nlabel.new(bar_index, high, "x", color = color.blue)\n`)).toEqual([])
  })

  it('the METHOD-form delete of a broker-labelled handle is not withheld either (`lbl.delete()`)', () => {
    const t = host(`${H}plot(close)\nvar label lbl = na\nlbl.delete()\n`
      + 'lbl := label.new(bar_index, 50, "Position Size: " + str.tostring(strategy.position_size))\n')
    expect(drawingWithheld(t)).toBe(true)
    expect(t.objectDiagnostics.dropReasons['strategy:create']).toBe(1)
    expect(t.objectDiagnostics.dropReasons['strategy:delete']).toBeUndefined()
  })

  it('a METHOD-form delete / clear RUN under a tainted condition is withheld by name too', () => {
    const t = host(`${H}plot(close)\nvar label lbl = label.new(bar_index, high, "x")\nif strategy.position_size > 0\n    lbl.delete()\n`)
    expect(t.objectDiagnostics.dropReasons['strategy:delete']).toBe(1)
    expect((t.objectDiagnostics.guardRefusalWhy || []).some((e) => e.includes('`strategy.position_size`'))).toBe(true)
    for (const fam of ['line.new(bar_index, high, bar_index + 1, high)', 'box.new(bar_index, high, bar_index + 1, low)']) {
      const u = host(`${H}plot(close)\nvar d = ${fam}\nif strategy.position_size > 0\n    d.delete()\n`)
      expect(u.objectDiagnostics.dropReasons['strategy:delete'], fam).toBe(1)
    }
  })

  it('control: an untainted method-form delete still runs', () => {
    const t = host(`${H}plot(close)\nvar label lbl = label.new(bar_index, high, "x")\nif close > open\n    lbl.delete()\n`)
    expect(Object.keys(t.objectDiagnostics.dropReasons).some((k) => k.startsWith('strategy:'))).toBe(false)
    expect(((t.objects && t.objects.ops) || []).some((o) => o.k === 'delete')).toBe(true)
  })

  it('a delete RUN under a tainted condition is withheld by name (the broker decides it)', () => {
    const t = host(`${H}plot(close)\nvar label lbl = label.new(bar_index, high, "x")\nif strategy.position_size > 0\n    label.delete(lbl)\n`)
    expect(t.objectDiagnostics.dropReasons['strategy:delete']).toBe(1)
  })

  it('control: a label NOT reached by a strategy value still draws beside a tainted one', () => {
    const t = host(`${H}plot(close)\nlabel.new(bar_index, high, "plain", color = color.blue)\n`
      + `label.new(bar_index, low, "x", color = ${SC})\n`)
    expect(t.ok).toBe(true)
    const creates = ((t.objects && t.objects.ops) || []).filter((o) => o.k === 'create' && o.family === 'label')
    expect(creates.length).toBe(1)
    expect(t.objectDiagnostics.dropReasons['strategy:create']).toBe(1)
    const clean = host(`${H}plot(close)\nlabel.new(bar_index, high, "plain", color = color.blue)\n`)
    expect(((clean.objects && clean.objects.ops) || []).filter((o) => o.k === 'create' && o.family === 'label').length).toBe(1)
    expect(Object.keys(clean.objectDiagnostics.dropReasons).some((k) => k.startsWith('strategy:'))).toBe(false)
  })

  it('host: only the reading row is refused; its sibling plot is translated', () => {
    const t = host(`${H}plot(close, "a", color = ${SC})\nplot(open, "b")\n`)
    expect(t.outputs[0].refusal.guard).toBe('pine:strategy-call')
    expect(t.outputs[1].refusal).toBeNull()
    expect(t.outputs[1].formula).toBe('open')
  })

  // ── what must NOT refuse ─────────────────────────────────────────────────────────────
  it('control: colours that read no broker value are still carried', () => {
    for (const body of [
      'plot(close, color = close > open ? color.green : color.red)\n',
      'strategyColor = close > open ? color.green : color.red\nplot(close, color = strategyColor)\n',
      '// strategy.position_size\nplot(close, color = close > open ? color.green : color.red, title = "strategy.position_size")\n',
    ]) {
      const t = host(H + body)
      expect(t.ok, body).toBe(true)
      expect(refusalsOf(t).some((r) => r.guard === 'pine:strategy-call'), body).toBe(false)
    }
  })

  it('control: an order in a tainted `if` reaches no sink and is skipped as before', () => {
    const t = host(`${H}if strategy.position_size == 0 and close > open\n    strategy.entry("L", strategy.long)\nplot(close)\n`)
    expect(t.ok).toBe(true)
  })

  it('already refused (pinned): a value read, a plotshape series, a label text', () => {
    expect(host(`${H}plot(strategy.equity)\n`).outputs[0].refusal.guard).toBe('pine:strategy-call')
    expect(host(`${H}plotshape(strategy.position_size > 0)\nplot(close)\n`).outputs[0].refusal.guard).toBe('pine:strategy-call')
    expect(namesRead(host(`${H}label.new(bar_index, high, str.tostring(strategy.opentrades))\nplot(close)\n`), 'strategy.opentrades')).toBe(true)
  })

  it('the screener lane is untouched: a strategy() script refuses there by its declaration', () => {
    const t = translatePine(`${H}label.new(bar_index, high, "x", color = ${SC})\nplot(close, color = ${SC})\n`)
    expect(t.ok).toBe(false)
    expect(refusalsOf(t).some((r) => r.guard === 'pine:declaration-strategy')).toBe(true)
    expect(refusalsOf(t).some((r) => r.guard === 'pine:strategy-call')).toBe(false)
    expect(Object.keys((t.objectDiagnostics && t.objectDiagnostics.dropReasons) || {}).some((k) => k.startsWith('strategy:'))).toBe(false)
  })

  // ── the lanes agree ──────────────────────────────────────────────────────────────────
  it('runtime: the plot colour is refused naming the read; value reads and paints refuse the build', () => {
    const built = rt(`${H}plot(close, color = ${SC})\n`, true)
    expect(built.ok).toBe(true)
    expect(built.ir.outputs[0].colour.refused).toContain('`strategy.position_size`')
    expect(rt(`${H}plot(strategy.equity)\n`).refusal.guard).toBe('pine:strategy-call')
    expect(rt(`${H}bgcolor(${SC})\nplot(close)\n`).refusal.guard).toBe('pine:strategy-call')
    for (const body of [ROUTES['var + := state'], ROUTES['switch arm'], ROUTES.array, ROUTES['positional fill colour']]) {
      const r = rt(H + body, true)
      const withheld = r.ok && r.ir.outputs.some((o) => o.colour && o.colour.refused)
      expect(r.ok === false || withheld, body).toBe(true)
    }
  })
})

describe('strategyTaint: the source words', () => {
  it('state reads are sources; constants and order calls are not', () => {
    for (const w of ['strategy.position_size', 'strategy.equity', 'strategy.netprofit', 'strategy.opentrades',
      'strategy.opentrades.entry_price', 'strategy.closedtrades.profit', 'strategy.position_avg_price']) {
      expect(isStrategyStateWord(w), w).toBe(true)
    }
    for (const w of ['strategy.long', 'strategy.short', 'strategy.fixed', 'strategy.cash', 'strategy.percent_of_equity',
      'strategy.direction.long', 'strategy.oca.cancel', 'strategy.commission.percent', 'strategy.entry', 'strategy.exit',
      'strategy.close_all', 'strategy.risk.max_drawdown', 'strategyColor', 'close']) {
      expect(isStrategyStateWord(w), w).toBe(false)
    }
  })

  it('a program with no broker read has no tainted sink (and costs no walk)', () => {
    expect(strategyTaintSinks([]).size).toBe(0)
  })
})
