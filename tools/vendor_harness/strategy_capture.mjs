// tools/vendor_harness/strategy_capture.mjs
//
// ─── W9-T3a: WHAT A STRATEGY CAPTURE MUST CARRY BEYOND AN INDICATOR'S ────────────
//
// docs/pine/W9-STRATEGY-DESIGN.md (r3, GO-WITH-NOTES) T3a and 5.1. A strategy's numbers depend on
// settings an indicator has none of, so a strategy capture without a settings read-back is not
// evidence of anything. This module is the ONE authority for:
//
//   * which Properties inputs a strategy capture must read back (PROPERTY_TABLE, keyed by the
//     input's own TradingView name, as `tests/fixtures/vendor/harness/r1-strategy-draws-rddt-1d-2026-10-02.json`
//     shows them) and the `strategy()` parameter each one is declared by;
//   * the shape of `capture.provenance` (strategySettings, gradeMethod, gradeRange, report);
//   * the settings AGREEMENT between what the source declared and what the Properties tab read
//     back (a disagreement is INCONCLUSIVE, never a verdict);
//   * the tester-report SLOTS and how a report tree is mapped onto them.
//
// ⛔ PURE ESM, NO ENGINE IMPORTS (read by schema.mjs, verify_capture.mjs and vitest).
// ⛔ GATED BY `tool.version`: a capture written by tv_capture.js v3 is held to all of this; a v2
// strategy capture (the 10 fixtures of 2026-10-02/03) is validated exactly as before.
// ⛔ NO VALUE HERE WAS READ OFF THE REPORT. The report's location in the chart model is W9-C0
// (the owner's depth-2 key walk, `__uctVH._strategyKeys()`); until the owner pins it in
// `strategy_report_slots.json` every slot refuses by name `strategy-report:unpinned`.

export const STRATEGY_ID_RX = /^StrategyScript\$/
export const STRATEGY_TOOL_VERSION = 3
export const GRADE_METHODS = ['a', 'b', 'none']
export const REPORT_STATUSES = ['ok', 'partial', 'refused', 'not-requested']

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x)

export function isStrategyCapture(c) {
  const st = c && c.study
  return !!st && [st.id, st.fullId].some((x) => typeof x === 'string' && STRATEGY_ID_RX.test(x))
}

/** The strategy tester's Properties inputs, by TradingView's own input name.
 *  `param` is the `strategy()` argument that declares it (null: only the dialog sets it);
 *  `kind` says how the source's literal is compared with the read-back value. */
export const PROPERTY_TABLE = Object.freeze([
  { key: 'initial_capital', name: 'Initial Capital', param: 'initial_capital', kind: 'num' },
  { key: 'pyramiding', name: 'pyramiding', param: 'pyramiding', kind: 'num' },
  { key: 'calc_on_order_fills', name: "Calculate Strategy on Order's Fill(s)", param: 'calc_on_order_fills', kind: 'bool' },
  { key: 'calc_on_every_tick', name: 'Calculate Strategy on every Tick(s)', param: 'calc_on_every_tick', kind: 'bool' },
  { key: 'backtest_fill_limits_assumption', name: 'Backtesting Limit Order(s) fill assumption', param: 'backtest_fill_limits_assumption', kind: 'num' },
  { key: 'default_qty_type', name: 'Default entry/order Qty Type', param: 'default_qty_type', kind: 'enum' },
  { key: 'default_qty_value', name: 'Default entry/order Qty Value', param: 'default_qty_value', kind: 'num' },
  { key: 'currency', name: 'Base Currency', param: 'currency', kind: 'enum' },
  { key: 'slippage', name: 'Backtesting slippage for market orders', param: 'slippage', kind: 'num' },
  { key: 'commission_type', name: 'Commission Type', param: 'commission_type', kind: 'enum' },
  { key: 'commission_value', name: 'Commission Value', param: 'commission_value', kind: 'num' },
  { key: 'process_orders_on_close', name: 'Process orders on bar Close', param: 'process_orders_on_close', kind: 'bool' },
  { key: 'close_entries_rule', name: 'Close entries rule', param: 'close_entries_rule', kind: 'enum' },
  { key: 'margin_long', name: 'Margin Long', param: 'margin_long', kind: 'num' },
  { key: 'margin_short', name: 'Margin Short', param: 'margin_short', kind: 'num' },
  { key: 'risk_free_rate', name: 'Risk free rate', param: 'risk_free_rate', kind: 'num' },
  { key: 'use_bar_magnifier', name: 'Use Bar Magnifier', param: 'use_bar_magnifier', kind: 'bool' },
  { key: 'fill_orders_on_standard_ohlc', name: 'Fill orders using standard OHLC', param: 'fill_orders_on_standard_ohlc', kind: 'bool' },
  { key: 'calc_on_every_history_tick', name: 'Calculate Strategy on every History Tick', param: null, kind: 'bool' },
])
export const REQUIRED_PROPERTY_KEYS = Object.freeze(PROPERTY_TABLE.map((p) => p.key))

const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase()

/** The read-back Properties inputs, by canonical key: `{ key → {name, id, value, defval, type} }`.
 *  `missing` names every required key the capture does not hold; `unknownVisible` names a visible
 *  input this table does not know (kept raw, never dropped). */
export function propertiesByKey(strategySettings) {
  const props = isObj(strategySettings) && Array.isArray(strategySettings.properties) ? strategySettings.properties : []
  const byName = new Map(PROPERTY_TABLE.map((p) => [norm(p.name), p]))
  const found = {}
  const unknownVisible = []
  for (const p of props) {
    if (!isObj(p)) continue
    const row = byName.get(norm(p.name))
    if (row) found[row.key] = { id: p.id, name: p.name, type: p.type, value: p.value, defval: p.defval }
    else unknownVisible.push(String(p.name))
  }
  const missing = REQUIRED_PROPERTY_KEYS.filter((k) => !(k in found))
  return { found, missing, unknownVisible }
}

/** The session, time zone, dividend and back-adjustment settings. Session and zone are the
 *  capture's own `symbol` block (one authority); the two adjustments come from the raw reads the
 *  snippet recorded (`chartData.adjustments: [{path, value}]`). Never guessed: no matching path
 *  is `unread`. */
export function chartDataOf(c) {
  const adj = (((c || {}).provenance || {}).strategySettings || {}).chartData
  const reads = isObj(adj) && Array.isArray(adj.adjustments) ? adj.adjustments : []
  const pick = (rx) => {
    const hit = reads.find((r) => isObj(r) && rx.test(String(r.path)))
    return hit ? { read: true, path: hit.path, value: hit.value } : { read: false, path: null, value: null }
  }
  const sym = (c && c.symbol) || {}
  return {
    session: { read: typeof sym.session === 'string' && !!sym.session, value: sym.session || null },
    timezone: { read: typeof sym.timezone === 'string' && !!sym.timezone, value: sym.timezone || null },
    dividendAdjustment: pick(/dividend/i),
    backAdjustment: pick(/back.?adj/i),
  }
}

// ── the source's own declaration ────────────────────────────────────────────────

/** `name = value` arguments of the FIRST `strategy(...)` call in a Pine source, as raw text.
 *  Positional arguments are not read (they are the title and shorttitle only in practice). */
/** `source` with comment text and string contents replaced by spaces: same length, same newlines
 *  (the rule of `range_guard.py::blank`). A `strategy (` in a header comment or a string is not a declaration. */
export function blankSource(source) {
  const s = String(source || '')
  const out = s.split('')
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') { if (s[i] !== '\r') out[i] = ' '; i += 1 }
      continue
    }
    if (ch === '"' || ch === "'") {
      i += 1
      while (i < s.length && s[i] !== ch && s[i] !== '\n') {
        if (s[i] === '\\' && i + 1 < s.length) { out[i] = ' '; i += 1 }
        out[i] = ' '
        i += 1
      }
      i += 1
      continue
    }
    i += 1
  }
  return out.join('')
}

export function declaredStrategyArgs(source) {
  const text = String(source || '')
  const m = /(?<![\w.])strategy\s*\(/.exec(blankSource(text))
  if (!m) return null
  let depth = 1
  let i = m.index + m[0].length
  const start = i
  let inStr = null
  for (; i < text.length && depth > 0; i++) {
    const ch = text[i]
    if (inStr) { if (ch === '\\') i++; else if (ch === inStr) inStr = null; continue }
    if (ch === '"' || ch === "'") { inStr = ch; continue }
    if (ch === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue }
    if (ch === '(') depth++
    else if (ch === ')') depth--
  }
  if (depth !== 0) return null
  const body = text.slice(start, i - 1)
  const args = {}
  let d = 0
  let cur = ''
  let q = null
  const flush = () => {
    const mm = /^\s*([A-Za-z_]\w*)\s*=(?!=)\s*([\s\S]*?)\s*$/.exec(cur)
    if (mm) args[mm[1]] = mm[2]
    cur = ''
  }
  for (let k = 0; k < body.length; k++) {
    const ch = body[k]
    if (q) { cur += ch; if (ch === '\\') { cur += body[++k] || '' } else if (ch === q) q = null; continue }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue }
    if (ch === '/' && body[k + 1] === '/') { while (k < body.length && body[k] !== '\n') k++; continue }
    if (ch === '(' || ch === '[') d++
    if (ch === ')' || ch === ']') d--
    if (ch === ',' && d === 0) { flush(); continue }
    cur += ch
  }
  flush()
  return args
}

/** A declared literal → a comparable scalar, or `undefined` when it is not a literal this reads
 *  (an expression, an input): such a declaration is never compared, never guessed. */
function literal(raw, kind) {
  const t = String(raw).trim()
  if (kind === 'bool') return t === 'true' ? true : t === 'false' ? false : undefined
  if (kind === 'num') return /^[-+]?\d+(\.\d+)?$/.test(t) ? Number(t) : undefined
  // enum: strategy.fixed, strategy.commission.percent, currency.USD, "FIFO"
  let m = /^(?:strategy\.(?:commission\.)?|currency\.)([A-Za-z_]+)$/.exec(t)
  if (m) return m[1]
  m = /^"([^"]*)"$/.exec(t) || /^'([^']*)'$/.exec(t)
  return m ? m[1] : undefined
}

function sameValue(kind, declared, read) {
  if (kind === 'num') return Number(read) === declared
  if (kind === 'bool') return read === declared
  return norm(read) === norm(declared)
}

/** Source declaration vs Properties read-back. Only a parameter the source declares as a LITERAL is
 *  compared. A disagreement is INCONCLUSIVE (a rig or a reading problem), never a grade.
 *  `unread` lists what could not be read back; it is not a disagreement. */
export function settingsAgreement(c) {
  const ss = ((c || {}).provenance || {}).strategySettings
  const { found, missing } = propertiesByKey(ss)
  const decl = declaredStrategyArgs(c && c.source && c.source.text)
  const declared = decl || {}
  const disagreements = []
  let compared = 0
  for (const p of PROPERTY_TABLE) {
    if (!p.param || !(p.param in declared) || !(p.key in found)) continue
    const lit = literal(declared[p.param], p.kind)
    if (lit === undefined) continue
    compared += 1
    if (!sameValue(p.kind, lit, found[p.key].value)) {
      disagreements.push({ key: p.key, declared: lit, readBack: found[p.key].value })
    }
  }
  const cd = chartDataOf(c)
  const unread = [...missing.map((k) => `property:${k}`),
    ...Object.entries(cd).filter(([, v]) => !v.read).map(([k]) => `chartData:${k}`)]
  // ⛔ NEVER AGREE ON NOTHING: a verdict needs at least one declared literal compared with its read-back.
  // No `strategy(` declaration, or one that declares no literal this reads, is a NAMED inconclusive.
  let reason = null
  if (decl === null) reason = 'strategy-settings:no-declaration (no strategy() call found in the source outside comments and strings)'
  else if (compared === 0) reason = 'strategy-settings:nothing-compared (the declaration holds no literal setting to compare with the read-back)'
  const verdict = disagreements.length || reason ? 'INCONCLUSIVE' : 'AGREE'
  return { verdict, reason, compared, disagreements, unread }
}

// ── method (a) / (b) provenance ──────────────────────────────────────────────────

/** `time >= X and time < Y`, the guard `range_guard.py` writes and a method (b) probe carries
 *  (X and Y in epoch MILLISECONDS, what Pine's `time` is). The format's writer is range_guard.py;
 *  this is its reader. */
export const GUARD_RX = /\btime\s*>=\s*(\d+)\s+and\s+time\s*<\s*(\d+)/g
export function guardsIn(source) {
  const out = []
  const text = String(source || '')
  const rx = new RegExp(GUARD_RX.source, 'g')
  let m
  while ((m = rx.exec(text))) out.push({ x: Number(m[1]), y: Number(m[2]) })
  return out
}

// ── the validator, called by schema.mjs for a v3 strategy capture ───────────────

export function validateStrategyProvenance(c) {
  const errors = []
  const need = (cond, msg) => { if (!cond) errors.push(msg) }
  const prov = c.provenance
  need(isObj(prov), 'strategy-capture: provenance is required for a strategy capture (tool.version >= 3)')
  if (!isObj(prov)) return errors
  const ss = prov.strategySettings
  need(isObj(ss), 'strategy-capture: provenance.strategySettings is required: a strategy capture with no settings read-back is refused')
  if (isObj(ss)) {
    const { missing } = propertiesByKey(ss)
    if (missing.length) errors.push(`strategy-capture: the Properties read-back lacks ${missing.length} required input(s): ${missing.join(', ')}`)
    need(isObj(ss.chartData) && Array.isArray(ss.chartData.adjustments),
      'strategy-capture: provenance.strategySettings.chartData.adjustments must list the dividend / back-adjustment reads (an empty list is the honest "unread")')
    need(typeof (c.symbol || {}).session === 'string' && !!c.symbol.session, 'strategy-capture: symbol.session (RTH/ETH) is required')
    need(typeof (c.symbol || {}).timezone === 'string' && !!c.symbol.timezone, 'strategy-capture: symbol.timezone is required')
  }
  need(GRADE_METHODS.includes(prov.gradeMethod), `strategy-capture: provenance.gradeMethod must be one of ${GRADE_METHODS.join(' | ')}`)
  const barRows = (c.bars && Array.isArray(c.bars.rows)) ? c.bars.rows : []
  if (prov.gradeMethod === 'a') {
    need(c.history && c.history.startsAtBar0 === true, 'strategy-capture: method (a) needs history.startsAtBar0 === true (both sides start at the listing)')
    need(prov.gradeRange === undefined || prov.gradeRange === null, 'strategy-capture: method (a) carries no gradeRange')
  }
  if (prov.gradeMethod === 'b') {
    const g = prov.gradeRange
    need(isObj(g), 'strategy-capture: method (b) needs provenance.gradeRange {fromTime, toTime, warmupBars} (epoch seconds)')
    if (isObj(g)) {
      const okNum = (x) => Number.isFinite(x) && x > 0
      need(okNum(g.fromTime) && okNum(g.toTime) && g.toTime > g.fromTime, 'strategy-capture: gradeRange needs finite fromTime < toTime')
      need(Number.isInteger(g.warmupBars) && g.warmupBars >= 0, 'strategy-capture: gradeRange.warmupBars must be a non-negative integer')
      if (okNum(g.fromTime) && Number.isInteger(g.warmupBars) && c.bars && c.bars.timeUnit === 'unix-s') {
        // TradingView's first loaded bar must sit at least `warmupBars` bars before X.
        const before = barRows.filter((r) => Array.isArray(r) && r[0] < g.fromTime).length
        need(before >= g.warmupBars,
          `strategy-capture: gradeRange needs ${g.warmupBars} bars before fromTime and the capture holds ${before} (TradingView's first bar is not early enough)`)
      }
      if (okNum(g.fromTime) && okNum(g.toTime)) {
        const gs = guardsIn(c.source && c.source.text)
        need(gs.length > 0, 'strategy-capture: method (b): the source carries no `time >= X and time < Y` guard')
        const bad = gs.filter((q) => q.x !== g.fromTime * 1000 || q.y !== g.toTime * 1000)
        need(bad.length === 0, 'strategy-capture: method (b): a guard in the source names a window other than gradeRange')
      }
    }
  }
  const r = prov.report
  if (r !== undefined) {
    need(isObj(r) && REPORT_STATUSES.includes(r.status), `strategy-capture: provenance.report.status must be one of ${REPORT_STATUSES.join(' | ')}`)
    if (isObj(r) && r.status === 'ok') need(isObj(r.tree), 'strategy-capture: report status ok but no tree')
    if (isObj(r) && r.status === 'partial') need(typeof r.reason === 'string' && r.reason, 'strategy-capture: a partial report must say why')
  }
  return errors
}

// ── the tester-report reader (Node half) ─────────────────────────────────────────

/** The report SLOTS the design's W9-S1 / W9-S2 rows settle (summary formulas, Sharpe, Sortino).
 *  The list is the contract; where each lives in the tree is `strategy_report_slots.json`,
 *  null until W9-C0. */
export const REPORT_SLOTS = Object.freeze([
  'netProfit', 'grossProfit', 'grossLoss', 'maxDrawdown', 'maxRunup', 'buyAndHoldReturn',
  'totalClosedTrades', 'totalOpenTrades', 'numberWinningTrades', 'numberLosingTrades',
  'percentProfitable', 'profitFactor', 'avgTrade', 'avgWinningTrade', 'avgLosingTrade',
  'largestWinningTrade', 'largestLosingTrade', 'avgBarsInTrades', 'sharpeRatio', 'sortinoRatio',
  'commissionPaid',
])

const stepOf = (tree, path) => {
  let cur = tree
  for (const k of path) {
    if (cur === null || typeof cur !== 'object' || !(k in cur)) return { ok: false }
    cur = cur[k]
  }
  return { ok: true, value: cur }
}

/** Map a report tree onto the slots. `slotPaths` is `{ slot: [key, key, …] | null }`.
 *  A null path is `strategy-report:unpinned`; a path that does not resolve is `missing`; a value
 *  that is not a finite number is `not-numeric`. Nothing is defaulted, nothing is guessed. */
export function extractReportFields(tree, slotPaths) {
  const out = {}
  for (const slot of REPORT_SLOTS) {
    const path = slotPaths ? slotPaths[slot] : null
    if (!Array.isArray(path)) { out[slot] = { status: 'unpinned', reason: 'strategy-report:unpinned' }; continue }
    const got = stepOf(tree, path)
    if (!got.ok) { out[slot] = { status: 'missing', path }; continue }
    if (typeof got.value !== 'number' || !Number.isFinite(got.value)) { out[slot] = { status: 'not-numeric', path, value: got.value === undefined ? null : got.value }; continue }
    out[slot] = { status: 'ok', path, value: got.value }
  }
  return out
}

/** A capture's report fields, or the named reason there are none. */
export function readReport(c, slotPaths) {
  const r = c && c.provenance && c.provenance.report
  if (!isObj(r)) return { status: 'refused', reason: 'strategy-report:absent (the capture carries no provenance.report)' }
  if (r.status !== 'ok') return { status: 'refused', reason: `strategy-report:${r.status}${r.reason ? ` (${r.reason})` : ''}` }
  return { status: 'ok', fields: extractReportFields(r.tree, slotPaths) }
}
