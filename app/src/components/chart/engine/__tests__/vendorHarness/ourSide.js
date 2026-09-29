// app/src/components/chart/engine/__tests__/vendorHarness/ourSide.js
//
// ─── OUR SIDE: the member door, run on the VENDOR'S bars ──────────────────────
//
// ⛔⛔ THIS IS NOT AN EVALUATOR. It calls, in order, exactly what a member's
// paste reaches:
//
//   memberPaneDefinition({source, id})   — MemberPane.jsx's own call
//   installUserDefinitions([definition]) — the install door (it re-validates and
//                                          can refuse what the builder accepted)
//   computeFor(def, bars, inputs, ctx)   — what `binder.sync` calls per instance
//   createBinder(...).sync(...)          — the real binder over the repo's own
//                                          recording chart double, so a colour
//                                          is read off the POINTS the renderer
//                                          was handed, not re-derived here
//   objectReaderFor → evaluateObjects → toRenderState
//                                        — the object lane, counting what the
//                                          render state KEEPS
//
// A harness that evaluated differently from the product would measure itself.
// Nothing here computes a value; it only moves the vendor's bars into the shape
// the product's bars have and reads back what the product produced.
//
// ⚠️ It lives under `__tests__/` on purpose: it is test infrastructure (the
// reachability rail's TEST_INFRA rule), invoked by the harness tests and the
// vitest CLI entry, and must never be imported by a member surface.

import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import * as registry from '../../nativeRegistry'
import { createBinder, drawShiftOf } from '../../binder'
import { addInstance } from '../../instanceControls'
import { mergeChartSettings } from '../../../chartDefaults'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { toRenderState } from '../../objectRenderState'
import { maxLookback } from '../../ast/interpret'
import { createFakeChart } from '../fakeChart'
import { normalizeColor } from '../../../../../../../tools/vendor_harness/compare.mjs'

/** The id every harness run installs under. Satisfies `defSchema.ID_RE` (it is
 *  the member pane's own prefix) and is uninstalled after every run. */
export const HARNESS_DEF_ID = 'u_member-pane-vendorharness'

/** TradingView interval string → the chart's own timeframe code. An interval
 *  the chart has no code for is passed through unchanged, which folds nothing
 *  (`timeframeFlags` returns null for an unknown code rather than guessing). */
export function tfCodeOf(interval) {
  const s = String(interval || '').trim()
  if (/^\d+$/.test(s)) return s
  if (/^1?D$/i.test(s)) return 'D'
  if (/^1?W$/i.test(s)) return 'W'
  if (/^1?M$/.test(s)) return 'M'
  return s
}

const isDailyLike = (interval) => /^\d*[DWM]$/.test(String(interval || '').trim())

/** The ISO date a unix time falls on, in the exchange's timezone. */
export function isoDateIn(unixSeconds, timeZone) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'Etc/UTC', year: 'numeric', month: '2-digit', day: '2-digit',
  })
  return f.format(new Date(unixSeconds * 1000))
}

/**
 * The vendor's bars in the SHAPE the product's bars have: `/api/bars` returns an
 * ISO date for a daily/weekly/monthly bar and unix seconds for an intraday one
 * (`tests/fixtures/vendor/spy-1d-bars-3000-2026-09-13.json` is that payload).
 * The NUMBERS are the vendor's, untouched. A missing volume becomes 0 and the
 * verdict carries the adapter's note saying so.
 */
export function toProductBars(capture) {
  const tz = capture.symbol && capture.symbol.timezone
  const daily = isDailyLike(capture.timeframe)
  const iso = capture.bars.timeUnit === 'iso-date'
  const code = tfCodeOf(capture.timeframe)
  return capture.bars.rows.map(([t, o, h, l, c, v]) => ({
    t: iso ? t : (daily ? productPeriodKey(isoDateIn(t, tz), code) : t),
    o, h, l, c, v: v === null || v === undefined ? 0 : v,
  }))
}

/** ⭐ THE DAY THE PRODUCT KEYS A W / M BAR BY (2026-09-28), not the day the
 *  vendor stamps it: `/api/bars` dates a weekly bar by the FRIDAY of its ISO week
 *  (`bars_fetch._resample_weekly_iso`, holiday Fridays included — the startup
 *  fingerprint's `weekly_dating=friday-close`) and a monthly bar by the 1st of
 *  its month (`_resample_monthly_iso`). Until this rule the harness keyed both by
 *  the vendor's own first-session date, a shape the product never serves. The
 *  clock maps any day of the ISO week / month to the same opening instant
 *  (`barOpenInstant`), so the grade is unchanged by construction; what changed
 *  is that the harness now feeds the engine what a member's chart does. */
export function productPeriodKey(isoDate, code) {
  if (code !== 'W' && code !== 'M') return isoDate
  const [y, m, d] = isoDate.split('-').map(Number)
  const at = new Date(Date.UTC(y, m - 1, d))
  if (code === 'M') return `${isoDate.slice(0, 8)}01`
  at.setUTCDate(at.getUTCDate() + (4 - ((at.getUTCDay() + 6) % 7)))
  return at.toISOString().slice(0, 10)
}

/** `{ticker, exchange}` for the bind-time fold, from the capture's symbol. */
function symbolOf(capture) {
  const s = capture.symbol || {}
  const pro = String(s.pro_name || s.full_name || s.name || '')
  const ticker = pro.includes(':') ? pro.split(':').pop() : (s.name || pro)
  const exchange = s.exchange || (pro.includes(':') ? pro.split(':')[0] : null)
  return { ticker, exchange }
}

function lookbackOf(ast) {
  try {
    const n = maxLookback(ast)
    return Number.isInteger(n) ? n : null
  } catch {
    return null
  }
}

/** Colour a series point/option to `#rrggbbaa`, folding a plot opacity in. */
function withOpacity(hex, opacity) {
  const c = normalizeColor(hex)
  if (!c || !Number.isFinite(opacity)) return c
  const a = Math.max(0, Math.min(255, Math.round(opacity * 255))).toString(16).padStart(2, '0')
  return `${c.slice(0, 7)}${a}`
}

/** Drive the real binder over the recording double; per plot key, the colour
 *  the renderer was handed for every bar (point colour, else series colour). */
function drawnColours(def, bars, ctx) {
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const cs = addInstance(mergeChartSettings({}), def.id, registry)
  const instances = (cs.indicatorInstances || []).filter((i) => i.defId === def.id)
  const out = new Map()
  if (!instances.length) return { ok: false, reason: 'addInstance produced no instance', byKey: out }
  const res = binder.sync({
    enabled: true,
    cs,
    instances,
    registry,
    bars,
    tf: ctx.tf,
    symbol: ctx.symbol,
    newestBarIsForming: ctx.newestBarIsForming,
    adjustTime: (t) => t,
    applyData: (series, data) => series.setData(data),
    plan: { fresh: true },
    resolvePlacement: () => ({ paneIndex: 1, scaleId: def.id, scaleOptions: {} }),
  })
  const plotByKey = new Map((def.plots || []).map((p) => [p.key, p]))
  for (const b of binder.bindings()) {
    if (!b || !b.series) continue
    const sets = fake.calls.filter((c) => c.method === 'setData' && c.id === b.series.__id)
    const data = sets.length ? sets[sets.length - 1].args[0] : null
    if (!Array.isArray(data)) continue
    const plot = plotByKey.get(b.plotKey) || {}
    const seriesColor = b.series.__options && b.series.__options.color
    const byTime = new Map(data.map((p) => [String(p.time), p]))
    // ⭐⭐ A DISPLACED PLOT'S COLOUR IS READ WHERE THE RENDERER DREW IT.
    // `offset = -N` draws the value computed on bar i at bar i - N (the binder's
    // `displacedColumn`), and TradingView's study data keys that value — and its
    // colour — to the computing bar i (the VALUES agree bar for bar, which is how
    // this was established). Reading the point at the undisplaced bar i found
    // nothing there: measured 2026-09-28 on liquidity-pools (offset -4, 46 bars
    // "vendor #787b86ff vs ours none"), price-action-as-in-book (-5, 26 bars) and
    // the legacy trendlines capture (-15). A value that would sit left of bar 0
    // was never drawn by either platform, so its colour is not a reading
    // (`undefined`, which the comparator skips), not a "none".
    // ⛔ The shift is the binder's OWN `drawShiftOf`, never re-derived here.
    const shift = drawShiftOf(plot)
    const colors = bars.map((_bar, i) => {
      const at = i + shift
      if (at < 0) return undefined
      const p = at < bars.length ? byTime.get(String(bars[at].t)) : null
      if (!p || !Number.isFinite(p.value)) return null
      // ⭐⭐ WHAT THE RENDERER WAS HANDED IS FINAL. The pool already folded the
      // plot's opacity into a point colour and a series colour (`withAlpha`,
      // which MULTIPLIES through); re-applying `opacity` here REPLACED the
      // colour's alpha. ⚰️ Measured 2026-09-28 on Ultimate Pivot Points' Pivot:
      // the `na` branch is a palette entry `rgba(0, 0, 0, 0)`, the plot's
      // opacity is 0.9, the renderer drew it at alpha 0 — and this read it
      // `#000000e6`, a visible black line nobody drew. Only the definition's
      // own colour, when the renderer was handed none, still takes the opacity.
      const drawn = p.color || seriesColor
      return drawn ? normalizeColor(drawn) : withOpacity(plot.color, plot.opacity)
    })
    out.set(b.plotKey, colors)
  }
  binder.teardown()
  return { ok: true, reason: null, byKey: out, sync: res }
}

/** The object lane's LIVE set at the last bar, as counts and texts. */
function objectsOf(def, bars, ctx) {
  if (!def.objects || !(def.objects.ops || []).length) return { drawsObjects: false }
  try {
    const reader = objectReaderFor(def, bars, {
      inputs: undefined, tf: ctx.tf, symbol: ctx.symbol, newestBarIsForming: ctx.newestBarIsForming,
    })
    if (!reader) return { drawsObjects: true, ok: false, reason: 'objectReaderFor returned null' }
    const run = evaluateObjects(reader.program, {
      barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime,
    })
    const state = toRenderState(run.live, { bars, tf: ctx.tf })
    const cells = state.tables.flatMap((t) => t.cells || [])
    // ⭐⭐ LINES, LABELS AND BOXES ARE COUNTED AS THE SCRIPT HOLDS THEM — the
    // runtime's LIVE set at the last bar — because that is what the capture's
    // counts are. TradingView's `graphics()` collections keep an object whose
    // coordinate is `na`: measured 2026-09-27 on Zero-Lag MA Trend Levels
    // (NYSE:RDDT 1D), 18 box records, five of them with a null top or bottom
    // (`ta.atr(200)` is still warming when they are made). The render state
    // cannot draw those five and drops them, so counting IT compared 13 drawable
    // boxes against 18 held ones — a divergence between two different questions,
    // not between two engines. The render state's own drops are still reported
    // (`dropped`) so an undrawable object is named, never hidden.
    // ⚠️ Tables and cells keep the render state's count: no capture yet shows a
    // held-but-undrawn table or cell, so there is nothing to say they differ.
    const held = { line: 0, label: 0, box: 0 }
    const heldTexts = { label: [], box: [] }
    for (const o of run.live || []) {
      if (!o || !Object.prototype.hasOwnProperty.call(held, o.family)) continue
      held[o.family] += 1
      if (heldTexts[o.family]) {
        const t = o.props ? o.props.text : undefined
        heldTexts[o.family].push(t === undefined || t === null ? '' : String(t))
      }
    }
    return {
      drawsObjects: true,
      ok: true,
      counts: {
        lines: held.line,
        labels: held.label,
        boxes: held.box,
        tables: state.tables.length,
        tableCells: cells.length,
      },
      drawn: { lines: state.lines.length, labels: state.labels.length, boxes: state.boxes.length },
      // ⭐ `boxes` is reported, never graded by v1's comparator (it reads
      // labels and cells) — the zero-lag rail pins it against the records.
      texts: { labels: heldTexts.label, boxes: heldTexts.box, tableCells: cells.map((c) => c.text) },
      dropped: state.dropped || null,
    }
  } catch (err) {
    return { drawsObjects: true, ok: false, reason: `the object lane threw: ${String((err && err.message) || err)}` }
  }
}

/**
 * The two doors a member's paste passes through, and nothing else: the builder
 * (`memberPaneDefinition`, MemberPane.jsx's own call) and the install door
 * (`installUserDefinitions`, which re-validates and can refuse what the builder
 * accepted). `def` is the installed definition, or null with the door's own
 * sentence in `refusal`.
 *
 * ⛔ ONE AUTHORITY FOR "CAN THE MEMBER DOOR BUILD THIS". `runOurSide` below and
 * the vendor-batch manifest census (`memberDoorCensus.measure.test.js`) both
 * call this, so the batch never targets a script the grader would then refuse
 * for a reason the census did not see.
 *
 * ⚠️ On any path that reached the install door, the caller owns the uninstall
 * (`registry.uninstallUserDefinition(HARNESS_DEF_ID)`).
 */
export function enterMemberDoor(source) {
  const built = memberPaneDefinition({ source, id: HARNESS_DEF_ID, name: 'vendor harness' })
  if (!built.ok) {
    return { built, def: null, stage: 'builder', refusal: `member door refused${built.guard ? ` (${built.guard})` : ''}: ${built.reason}` }
  }
  const { installed, errors } = registry.installUserDefinitions([built.definition])
  if (!installed.length) {
    return { built, def: null, stage: 'install', refusal: `install door refused: ${errors.join(' | ')}` }
  }
  return { built, def: installed[0], stage: null, refusal: null }
}

/**
 * Run the member door on the capture's bars.
 *
 * @returns {{ok: boolean, refusal: string|null, plots: object[], objects: object,
 *            ctx: object, notes: string[]}}
 */
export function runOurSide(capture) {
  const notes = []
  const source = capture && capture.source && capture.source.text
  const door = enterMemberDoor(source)
  const built = door.built
  if (!built.ok) {
    return { ok: false, refusal: door.refusal, plots: [], notes }
  }
  try {
    if (!door.def) {
      return { ok: false, refusal: door.refusal, plots: [], notes }
    }
    const def = door.def
    const bars = toProductBars(capture)
    const tf = tfCodeOf(capture.timeframe)
    if (tf === capture.timeframe && !/^\d+$/.test(tf) && !['D', 'W', 'M'].includes(tf)) {
      notes.push(`timeframe ${JSON.stringify(capture.timeframe)} has no chart code — the bind-time fold folds nothing`)
    }
    const ctx = {
      tf,
      symbol: symbolOf(capture),
      newestBarIsForming: capture.newestBarIsForming ?? null,
    }
    const cols = registry.computeFor(def, bars, undefined, ctx)

    let colours
    try {
      colours = drawnColours(def, bars, ctx)
    } catch (err) {
      colours = { ok: false, reason: `binder threw: ${String((err && err.message) || err)}`, byKey: new Map() }
    }
    if (!colours.ok) notes.push(`colours unresolvable: ${colours.reason}`)

    const rowByAst = new Map((built.rows || []).map((r) => [r.ast, r]))
    // ⭐ A RUNTIME-LANE document (`memberPaneDefinition`'s route for a script the
    // columnar lane refuses) has no tree per output — each row names the host
    // output it draws instead, and is matched by that.
    const rowByOutput = new Map((built.rows || [])
      .filter((r) => Number.isInteger(r.output)).map((r) => [r.output, r]))
    const plots = []
    for (const [index, o] of (built.translation.outputs || []).entries()) {
      if (o && o.kind === 'alertcondition') continue
      const row = built.lane === 'runtime'
        ? (rowByOutput.get(index) || null)
        : (o && o.ast ? rowByAst.get(o.ast) : null)
      const col = row ? cols[row.key] : undefined
      let missingReason = null
      if (!row) {
        missingReason = o && o.refusal
          ? `the translator refused this plot (${(o.refusal && (o.refusal.guard || o.refusal.message)) || 'refusal'})`
          : 'the member pane did not carry this output (hidden helper or beyond its row ceiling)'
      } else if (!col) {
        missingReason = `computeFor returned no column for ${row.key}`
      }
      plots.push({
        title: o ? o.title : null,
        formula: o ? o.formula : null,
        key: row ? row.key : null,
        hidden: !!(o && o.hidden),
        column: col || null,
        missingReason,
        lookback: o && o.ast ? lookbackOf(o.ast) : null,
        colors: row && colours.byKey.has(row.key) ? colours.byKey.get(row.key) : null,
        // A positive `offset = N` the translator wrote INTO the tree as `x[N]`
        // (its `_treeShift` hand-off) — see compare.mjs `leadBy`.
        treeShift: o && Number.isInteger(o._treeShift) && o._treeShift > 0 ? o._treeShift : 0,
        // Why there are no colours, when there are none — so the verdict names the
        // cause instead of "could not be resolved".
        colorsReason: row && !colours.byKey.has(row.key)
          ? (o && o.hidden
            ? `our pane draws no series for this row — hidden (${o.hiddenReason || 'unstated'})`
            : (colours.ok ? 'the binder bound no series for this row' : colours.reason))
          : null,
      })
    }
    const objects = objectsOf(def, bars, ctx)
    if (objects && objects.ok && objects.drawn) {
      for (const f of ['lines', 'labels', 'boxes']) {
        const gap = objects.counts[f] - objects.drawn[f]
        if (gap > 0) notes.push(`${gap} of ${objects.counts[f]} held ${f} cannot be drawn (a coordinate is na) — counted as held, the way the capture counts them`)
      }
    }
    return {
      ok: true,
      refusal: null,
      plots,
      objects,
      ctx,
      notes,
      bars,
    }
  } finally {
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
  }
}
