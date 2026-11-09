// app/src/components/chart/engine/runtime/strategyRecord.js
//
// ─── ⭐⭐ W9-T11 — THE RUN'S `strategy` RECORD, AND WHERE IT RIDES ────────────────
//
// One record per broker run (W9 design 3.2): the window it ran over, the declaration
// it ran with, and the trades, keyed by BAR TIME. It is the one source the markers
// (T12), the report (T13a/T13b) and the server (T14) read; none of them recomputes a
// fill (design rule 3).
//
// ⛔ THIS MODULE IMPORTS NOTHING (like `runtimeObjects.js`): the binder, the report
// and the server codec can read a record without pulling the runtime lane.
//
// ⛔ WHAT THE BROKER DOES NOT PRODUCE YET IS `null`, NAMED, NEVER EMPTY. A field 3.2
// lists that no rule serves (the order log, the equity column, a trade's money
// profit, commission, run-up, drawdown, and the declaration's unserved settings) is
// `null` in the record and named in `unserved` with the task that owns it. An empty
// list would read as "no orders"; `null` reads as "not known", and the one schema
// check (`strategyRecordShapeErrors`) refuses a value there.
//
// The record rides the column record as a NON-ENUMERABLE property (the shape
// `RUNTIME_OBJECTS_KEY` uses), so a walk over a column map's keys sees columns and
// nothing else, and the worker carries it beside the columns (`runtimeWorker.js`).

export const STRATEGY_RECORD_SCHEMA = 'uct.strategy-record/v1'
export const RUNTIME_STRATEGY_KEY = '__runtimeStrategy'

/** ⭐ The document stamp (`meta.runtimeHistory`) of a runtime document whose program holds
 *  a broker (`memberPaneDefinition.js::runtimeLaneDefinition`). Its run takes the most recent
 *  `ctx.historyWindowBars` bars (`runtimeColumns.js`), never R-W's warm-up curtain: a
 *  backtest is path-dependent, so no curtain can withhold "the bars that depend on the start". */
export const STRATEGY_WINDOW_HISTORY = 'strategy-window'

/** The fields 3.2 names that no served rule produces yet, and the W9 task that owns each.
 *  W9-T13a-F1 (coordinator ruling, 2026-11-08): T13a computes the report from the record and
 *  serves per-trade profit in the report; equity, run-up and drawdown need a per-bar close or
 *  equity column the record does not carry yet, which is that follow-up's work.
 *  W9-T7-F1 (coordinator ruling, 2026-11-08): T7 built the order kinds but not the order log or a
 *  trade's exit id (the broker keeps no per-order history to log), so both are that follow-up's. */
export const STRATEGY_RECORD_UNSERVED = Object.freeze({
  orders: 'W9-T7-F1 (order log, exitId)',
  equity: 'W9-T13a-F1',
  'trades.exitId': 'W9-T7-F1 (order log, exitId)',
  'trades.profit': 'W9-T13a-F1',
  'trades.commission': 'W9-T5',
  'trades.runUp': 'W9-T13a-F1',
  'trades.drawdown': 'W9-T13a-F1',
  'settings.commission': 'W9-T5',
  'settings.slippage': 'W9-T5',
  'settings.bar_detalization': 'W9-T9',
  'settings.currency': 'W9-D2 (deferred)',
})

/** ⭐⭐ RULING D2, ONE AUTHORITY (coordinator, 2026-11-08). The backtest's start date and the
 *  sentence a window that does not reach the listing always carries. The record holds both
 *  (`window.startDate`, `window.startSentence`), computed HERE from `window.startTime`, the run's
 *  truth; the report reads them and the route (`pine_strategy_backtest.py`) serves the record's,
 *  never its own bars' dates. No record carries the symbol's exchange timezone, so the date is
 *  the UTC date of the start, and the sentence SAYS UTC. */
export const START_TIMEZONE = 'UTC'
export function startDateOf(startTime) {
  return Number.isFinite(startTime) ? new Date(startTime * 1000).toISOString().slice(0, 10) : null
}
export function startSentenceOf(startTime) {
  const date = startDateOf(startTime)
  return date ? `this backtest starts on ${date} (${START_TIMEZONE}); TradingView may start elsewhere`
    : 'this backtest ran over no bars'
}

const timeAt = (barTimes, i) => (Array.isArray(barTimes) && Number.isInteger(i) && i >= 0 && i < barTimes.length
  && Number.isFinite(barTimes[i]) ? barTimes[i] : null)
const dirOf = (d) => (d > 0 ? 'long' : d < 0 ? 'short' : null)
const QTY_TYPES = new Set(['fixed', 'cash', 'percent_of_equity'])
const defaultQtyOf = (cfg) => {
  if (QTY_TYPES.has(cfg.qtyType) && Number.isFinite(cfg.qtyValue)) return { type: cfg.qtyType, value: cfg.qtyValue }
  return Number.isFinite(cfg.defaultQty) ? { type: 'fixed', value: cfg.defaultQty } : null
}

/**
 * Build the record of one broker run.
 *
 * @param {object} p
 * @param {object} p.summary    the VM's `res.broker` (`broker.js::summary`): `record.trades`
 *                              keyed by bar time, `record.rulesUsed`
 * @param {object} p.decl       `program.broker`, the declaration the front end read
 * @param {number[]} p.barTimes the run's bar times, oldest first (the window, not the chart)
 * @param {number} p.historyWindowBars the window the run was handed (`ctx.historyWindowBars`)
 * @param {boolean} p.confirmed whether the run's newest bar is KNOWN closed
 */
export function strategyRecordOf({ summary, decl, barTimes, historyWindowBars, confirmed }) {
  const rec = (summary && summary.record) || {}
  const n = Array.isArray(barTimes) ? barTimes.length : 0
  const cfg = decl || {}
  const defaulted = cfg.defaulted || {}
  const trades = (rec.trades || []).map((t, i) => ({
    n: i + 1,
    entryId: t.id,
    dir: dirOf(t.dir),
    qty: t.qty,
    // W9-T13a: every fill of the trade is on the tick grid (the broker's own flag, never re-derived)
    exact: t.exact === true,
    entryTime: t.entry ? t.entry.time : null,
    entryPrice: t.entry ? t.entry.price : null,
    entryRule: t.entry ? t.entry.rule : null,
    open: !t.exit,
    exitTime: t.exit ? t.exit.time : null,
    exitPrice: t.exit ? t.exit.price : null,
    exitRule: t.exit ? t.exit.rule : null,
    exitId: null,
    profit: null,
    commission: null,
    runUp: null,
    drawdown: null,
  }))
  const startTime = timeAt(barTimes, 0)
  const fromListing = cfg.fromListing === true
  return {
    schema: STRATEGY_RECORD_SCHEMA,
    window: {
      startTime,
      startDate: startDateOf(startTime),
      // D2: always stated when the window does not reach the listing
      startSentence: fromListing ? null : startSentenceOf(startTime),
      fromListing,
      bars: n,
      historyWindowBars,
      // the newest CONFIRMED bar the record reflects: a forming bar is never run (`vm.js`, [B-EXEC])
      asOfBar: timeAt(barTimes, confirmed === true ? n - 1 : n - 2),
    },
    settings: {
      version: Number.isInteger(cfg.version) ? cfg.version : null,
      initial_capital: Number.isFinite(cfg.initialCapital) ? cfg.initialCapital : null,
      // W9-T4: the declared-or-defaulted `default_qty_*` (fixed, cash or percent_of_equity), stated ONLY
      // when the run actually sized an order by it (it asked B-QTY); otherwise null, so the record never
      // shows a sizing rule the run did not rest on (W9-T4 r1 review P2)
      default_qty: Array.isArray(rec.rulesUsed) && rec.rulesUsed.includes('B-QTY') ? defaultQtyOf(cfg) : null,
      pyramiding: Number.isInteger(cfg.pyramiding) ? cfg.pyramiding : null,
      margin_long: Number.isFinite(cfg.marginLong) ? cfg.marginLong : null,
      margin_short: Number.isFinite(cfg.marginShort) ? cfg.marginShort : null,
      calc_on_every_tick: cfg.calcOnEveryTick === true,
      // ⭐⭐ W9-T6 — fill timing, as the declaration set it (each asks its own rule when a run reaches it)
      process_orders_on_close: cfg.processOrdersOnClose === true,
      calc_on_order_fills: cfg.calcOnOrderFills === true,
      // which of the above are the version's defaults, not the script's own (B-DEFAULTS)
      defaulted: Object.keys(defaulted).filter((k) => defaulted[k] === true).sort(),
      commission: null,
      slippage: null,
      bar_detalization: null,
      currency: null,
    },
    // W9-T13a: the symbol's tick and point value as the run settled them (the broker's `#symbol`),
    // null when unknown. The report's currency values are price x size x pointvalue (B-VAL).
    symbol: {
      mintick: rec.symbol && Number.isFinite(rec.symbol.mintick) && rec.symbol.mintick > 0 ? rec.symbol.mintick : null,
      pointvalue: rec.symbol && Number.isFinite(rec.symbol.pointvalue) && rec.symbol.pointvalue > 0 ? rec.symbol.pointvalue : null,
    },
    orders: null,
    trades,
    equity: null,
    refusals: [],
    rulesUsed: Array.isArray(rec.rulesUsed) ? rec.rulesUsed.slice() : [],
    unserved: { ...STRATEGY_RECORD_UNSERVED },
  }
}

/** Attach a record to a column record (non-enumerable). */
export function withStrategyRecord(out, record) {
  if (out && typeof out === 'object' && record) {
    Object.defineProperty(out, RUNTIME_STRATEGY_KEY, { value: record, enumerable: false, configurable: true })
  }
  return out
}

/** The run's record from a column record, or null. */
export function runtimeStrategyOf(cols) {
  const r = cols && typeof cols === 'object' ? cols[RUNTIME_STRATEGY_KEY] : null
  return r && typeof r === 'object' && r.schema === STRATEGY_RECORD_SCHEMA ? r : null
}

const isTime = (v) => Number.isFinite(v)
const isNullOr = (v, ok) => v === null || ok(v)

/** ⭐ THE SCHEMA, as one checker every reader shares (T12, T13a, T14's codec): the list of
 *  what is wrong with `rec`, empty when it is a v1 record. Every `unserved` field must be
 *  `null`; a value there is a field no rule served. */
export function strategyRecordShapeErrors(rec) {
  const errs = []
  const need = (ok, what) => { if (!ok) errs.push(what) }
  if (!rec || typeof rec !== 'object') return ['not an object']
  need(rec.schema === STRATEGY_RECORD_SCHEMA, 'schema')
  const w = rec.window || {}
  need(isNullOr(w.startTime, isTime), 'window.startTime')
  need(typeof w.fromListing === 'boolean', 'window.fromListing')
  need(w.startDate === startDateOf(w.startTime), 'window.startDate')
  need(w.startSentence === (w.fromListing === true ? null : startSentenceOf(w.startTime)), 'window.startSentence')
  need(Number.isInteger(w.bars) && w.bars >= 0, 'window.bars')
  need(Number.isInteger(w.historyWindowBars) && w.historyWindowBars > 0, 'window.historyWindowBars')
  need(Number.isInteger(w.bars) && Number.isInteger(w.historyWindowBars) && w.bars <= w.historyWindowBars,
    'window.bars <= window.historyWindowBars')
  need(isNullOr(w.asOfBar, isTime), 'window.asOfBar')
  need(!!rec.settings && typeof rec.settings === 'object', 'settings')
  const posOrNull = (v) => v === null || (Number.isFinite(v) && v > 0)
  need(!!rec.symbol && typeof rec.symbol === 'object', 'symbol')
  need(!!rec.symbol && posOrNull(rec.symbol.mintick), 'symbol.mintick')
  need(!!rec.symbol && posOrNull(rec.symbol.pointvalue), 'symbol.pointvalue')
  need(Array.isArray(rec.trades), 'trades')
  for (const [i, t] of (Array.isArray(rec.trades) ? rec.trades : []).entries()) {
    need(t.n === i + 1, `trades[${i}].n`)
    need(typeof t.entryId === 'string', `trades[${i}].entryId`)
    need(t.dir === 'long' || t.dir === 'short', `trades[${i}].dir`)
    need(Number.isFinite(t.qty) && t.qty > 0, `trades[${i}].qty`)
    need(isTime(t.entryTime), `trades[${i}].entryTime`)
    need(typeof t.entryRule === 'string', `trades[${i}].entryRule`)
    need(typeof t.open === 'boolean', `trades[${i}].open`)
    need(typeof t.exact === 'boolean', `trades[${i}].exact`)
    need(t.open ? t.exitTime === null : isTime(t.exitTime), `trades[${i}].exitTime`)
    need(t.open || typeof t.exitRule === 'string', `trades[${i}].exitRule`)
  }
  need(Array.isArray(rec.refusals), 'refusals')
  need(Array.isArray(rec.rulesUsed), 'rulesUsed')
  need(!!rec.unserved && typeof rec.unserved === 'object', 'unserved')
  for (const path of Object.keys(rec.unserved || {})) {
    const [head, field] = path.split('.')
    if (!field) { need(rec[head] === null, `${path} is unserved and must be null`); continue }
    if (head === 'trades') {
      for (const t of rec.trades || []) need(t[field] === null, `${path} is unserved and must be null`)
    } else need(!!rec[head] && rec[head][field] === null, `${path} is unserved and must be null`)
  }
  return errs
}
