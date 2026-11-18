// app/src/components/chart/engine/runtime/__tests__/orderLogFixture.js
//
// ⭐ W9-T7-F1 — TEST FIXTURE ONLY: the order log a hand-made broker trade list implies, for the rails that
// build a record from hand-made trades (`strategyRecordOf({ summary: { record: { trades, ... } } })`)
// rather than from a run. A record now carries the broker's order log (`broker.js`, "THE ORDER LOG"), and its
// one shape check (`strategyRecordShapeErrors`) refuses a trade no order opened or closed, so a hand-made
// summary states the orders too.
//
// Each trade (`broker.js::tradeRecord` shape, `{ id, dir, qty, entry, exit? }`) gets the order that opened it
// (an `entry` of its id, filled at its entry) and, when closed, the order that closed it: by default a
// `strategy.close` of its id (`close`, the order T13a's fixtures name with exit rule B-CLOSE), or, with
// `exitIds[i]` a text, an exit command of that id. Trades that share an entry fill (the same id, time and
// price: one order split by partial exits) share one row, as the broker logs them; so do trades that share an
// exit fill of one id. ⛔ It states nothing a run would not: the rows' fields are the broker's own names, and
// the shape check is what holds them to the schema.

const row = (n, kind, id, from, side, time, price, qty, rule, comment) => ({
  n, kind, id, from, side, type: kind === 'exit' ? 'bracket' : 'market', qty: kind === 'exit' ? null : qty, qtyPercent: null,
  limit: null, stop: null, legs: kind === 'exit' ? { profit: null, loss: null, trailing: null } : null, oca: null,
  comment: comment || null, commentRecorded: true, legComments: kind === 'exit' ? {} : null,
  placedTime: time, modifiedTime: null, triggerTime: null, status: 'filled', why: null, endTime: null,
  fillTime: time, fillPrice: price, fillQty: qty, rule, leg: kind === 'exit' ? 'profit' : null, opened: [], closed: [],
})

/**
 * @param {Array} trades   broker trade records, closed first then open (the broker's own order)
 * @param {object} [o]
 * @param {Array<string|null>} [o.exitIds]  per trade: an exit command's id, or null / absent for a `strategy.close`
 * @param {Array<string|null>} [o.entryComments] per trade: the entry order's comment
 * @param {Array<string|null>} [o.exitComments]  per trade: the closing order's comment
 * @returns {Array} the log, `opened` / `closed` as indexes into `trades` (the broker summary's shape)
 */
export function orderLogFor(trades, { exitIds = [], entryComments = [], exitComments = [] } = {}) {
  const rows = []
  const shared = new Map()
  const take = (key, make) => {
    if (!shared.has(key)) { const r = make(rows.length + 1); rows.push(r); shared.set(key, r) }
    return shared.get(key)
  }
  // entry rows first, in entry order of time; exit rows after, so a row's `n` is its place in the log
  const events = []
  trades.forEach((t, i) => {
    events.push({ time: t.entry.time, k: 0, i, role: 'entry' })
    if (t.exit) events.push({ time: t.exit.time, k: 1, i, role: 'exit' })
  })
  events.sort((a, b) => (a.time - b.time) || (b.k - a.k) || (a.i - b.i))
  for (const ev of events) {
    const t = trades[ev.i]
    const side = (ev.role === 'entry') === (t.dir > 0) ? 'buy' : 'sell'
    if (ev.role === 'entry') {
      const r = take(`e|${t.id}|${t.entry.time}|${t.entry.price}`, (n) => row(n, 'entry', t.id, null, side, t.entry.time,
        t.entry.price, 0, t.entry.rule, entryComments[ev.i]))
      r.fillQty += t.qty; r.qty = r.fillQty
      r.opened.push(ev.i)
    } else {
      const xid = typeof exitIds[ev.i] === 'string' ? exitIds[ev.i] : null
      const r = take(`x|${xid === null ? `close:${t.id}` : xid}|${t.exit.time}|${t.exit.price}`, (n) => row(n,
        xid === null ? 'close' : 'exit', xid, xid === null ? t.id : t.id, side, t.exit.time, t.exit.price, 0, t.exit.rule,
        exitComments[ev.i]))
      r.fillQty += t.qty
      if (r.kind !== 'exit') r.qty = r.fillQty
      r.closed.push(ev.i)
    }
  }
  for (const r of rows) { r.opened.sort((a, b) => a - b); r.closed.sort((a, b) => a - b) }
  return rows
}
