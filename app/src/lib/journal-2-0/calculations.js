/**
 * Journal 2.0 — pure calculation helpers.
 * Spec: docs/plans/journal-2.0-spec.md §14.
 *
 * Every function here is pure, exported, and unit-tested. No calc logic
 * lives in components — components consume this module only.
 *
 * Long and short math is implemented SEPARATELY (not sign-flipped) per
 * §14.3. The entry > stop assumption that holds for long is inverted
 * for short (stop > entry); mixing them up is a common footgun.
 */

/**
 * @typedef {import('./types.js').Position} Position
 * @typedef {import('./types.js').Trade} Trade
 * @typedef {import('./types.js').PortfolioSettings} PortfolioSettings
 */

export const EPSILON = 1e-9

// ───────────────────────────────────────────────────────────────────────────
// §14.1 Helpers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Division that returns null for (near-)zero denominators instead of
 * throwing or returning Infinity. Callers render `—` on null.
 * @param {number} a
 * @param {number} b
 * @returns {number|null}
 */
export const safeDivide = (a, b) => (Math.abs(b) < EPSILON ? null : a / b)

/** @param {number} x */
export const clampNonNegative = (x) => (x < 0 ? 0 : x)

/**
 * Share-count rounding. Fractional symbols round to 4 dp; otherwise
 * round to the nearest whole share.
 * @param {number} x
 * @param {boolean} allowFractional
 */
export const roundShares = (x, allowFractional) =>
  allowFractional ? Math.round(x * 10000) / 10000 : Math.round(x)

// ───────────────────────────────────────────────────────────────────────────
// Shared
// ───────────────────────────────────────────────────────────────────────────

/**
 * The stop price actually used for live risk/heat math.
 * Breakeven override when raiseToBreakeven is true AND breakevenStop is set.
 * @param {Position} p
 */
export const activeStop = (p) =>
  p.raiseToBreakeven && p.breakevenStop != null ? p.breakevenStop : p.stopPrice

/**
 * Broker imports have no stop; the NOT-NULL stop_price column is seeded with
 * entry_price as a placeholder. That placeholder means "no stop set" — it must
 * never feed risk/heat math or render as a real stop. ONE predicate, shared by
 * every surface (a copy per surface is how one of them drifts).
 * @param {Position} p
 */
export const isBrokerPlaceholderStop = (p) => {
  const active = activeStop(p)
  if (p?.source !== 'broker' || active == null || !Number.isFinite(p?.entryPrice)) return false
  // Tolerant, not strict ===: a sync that refreshes entry_price can leave the
  // seeded placeholder a rounding-hair away (ORCL: stop 126.005 vs entry
  // 126.0049), and a strict comparison silently un-blanks it. A real stop is
  // never within a tenth of a cent of the entry.
  return Math.abs(active - p.entryPrice) <= Math.max(0.001, Math.abs(p.entryPrice) * 1e-5)
}

/**
 * Did this position genuinely OPEN today? True only when the entry date is
 * today AND the entry is real. Broker holdings-as-truth seeds unknown entries
 * with a sync-time placeholder date + entryEstimated flag — a reconnect
 * stamped every carried-in position "opened today", so its ENTIRE unrealized
 * gain since the true entry booked as "Today" (the +$1,335.87-vs-−$881 bug).
 * @param {Position} p @param {string} [todayIso]
 */
export const openedTodayFill = (p, todayIso) =>
  Boolean(
    todayIso &&
      p?.entryDate &&
      String(p.entryDate).slice(0, 10) === todayIso &&
      p?.entryEstimated !== true,
  )

// ───────────────────────────────────────────────────────────────────────────
// §14.2 Long-side formulas
// ───────────────────────────────────────────────────────────────────────────

/** @param {Position} p @param {number} current */
export const longPnlDollar = (p, current) => (current - p.entryPrice) * p.shares

/** @param {Position} p @param {number} current */
export const longPnlPercent = (p, current) =>
  safeDivide(current - p.entryPrice, p.entryPrice)

/** @param {Position} p */
export const longRiskDollar = (p) =>
  clampNonNegative((p.entryPrice - activeStop(p)) * p.shares)

/** @param {Position} p @param {number} current */
export const longHeatDollar = (p, current) =>
  clampNonNegative((current - activeStop(p)) * p.shares)

/** @param {Position} p @param {number} current */
export const longStopDistancePercent = (p, current) =>
  safeDivide(current - activeStop(p), current)

/**
 * Break-even sell count: shares to sell *now* at `current` so that if the
 * stop subsequently fires on the remainder, total P&L is zero.
 *
 * Returns null when stop ≥ current (BE sell is undefined — you'd need to
 * sell the whole position to break even, and even that doesn't guarantee
 * flat on a stop-out).
 *
 * Rounding uses round(), NOT ceil() — §7.2.
 *
 * @param {Position} p
 * @param {number} current
 * @param {boolean} allowFractional
 */
export const longBeSellShares = (p, current, allowFractional) => {
  const denom = current - activeStop(p)
  if (denom <= EPSILON) return null
  const raw = longRiskDollar(p) / denom
  return roundShares(raw, allowFractional)
}

// ───────────────────────────────────────────────────────────────────────────
// §14.3 Short-side formulas (explicit, not sign-flipped)
// Short: stop ABOVE entry. Profit when price falls.
// ───────────────────────────────────────────────────────────────────────────

/** @param {Position} p @param {number} current */
export const shortPnlDollar = (p, current) => (p.entryPrice - current) * p.shares

/** @param {Position} p @param {number} current */
export const shortPnlPercent = (p, current) =>
  safeDivide(p.entryPrice - current, p.entryPrice)

/** @param {Position} p */
export const shortRiskDollar = (p) =>
  clampNonNegative((activeStop(p) - p.entryPrice) * p.shares)

/** @param {Position} p @param {number} current */
export const shortHeatDollar = (p, current) =>
  clampNonNegative((activeStop(p) - current) * p.shares)

/** @param {Position} p @param {number} current */
export const shortStopDistancePercent = (p, current) =>
  safeDivide(activeStop(p) - current, current)

/** @param {Position} p @param {number} current @param {boolean} allowFractional */
export const shortBeSellShares = (p, current, allowFractional) => {
  const denom = activeStop(p) - current
  if (denom <= EPSILON) return null
  const raw = shortRiskDollar(p) / denom
  return roundShares(raw, allowFractional)
}

// ───────────────────────────────────────────────────────────────────────────
// Side-aware dispatch
// ───────────────────────────────────────────────────────────────────────────

/** @param {Position} p @param {number} current */
export const positionPnlDollar = (p, current) =>
  p.side === 'Long' ? longPnlDollar(p, current) : shortPnlDollar(p, current)

/** @param {Position} p @param {number} current */
export const positionPnlPercent = (p, current) =>
  p.side === 'Long' ? longPnlPercent(p, current) : shortPnlPercent(p, current)

/** @param {Position} p */
export const positionRiskDollar = (p) =>
  p.side === 'Long' ? longRiskDollar(p) : shortRiskDollar(p)

/** @param {Position} p @param {number} current */
export const positionHeatDollar = (p, current) =>
  p.side === 'Long' ? longHeatDollar(p, current) : shortHeatDollar(p, current)

/** @param {Position} p @param {number} current */
export const positionStopDistancePercent = (p, current) =>
  p.side === 'Long'
    ? longStopDistancePercent(p, current)
    : shortStopDistancePercent(p, current)

/** @param {Position} p @param {number} current @param {boolean} allowFractional */
export const positionBeSellShares = (p, current, allowFractional) =>
  p.side === 'Long'
    ? longBeSellShares(p, current, allowFractional)
    : shortBeSellShares(p, current, allowFractional)

/**
 * Row-level "Invested" (% of account). Uses current price, not entry.
 * @param {Position} p @param {number} current @param {number} accountSize
 */
export const positionInvestedPercent = (p, current, accountSize) =>
  safeDivide(current * p.shares, accountSize)

/** @param {Position} p @param {number} accountSize */
export const positionRiskAccountPercent = (p, accountSize) =>
  safeDivide(positionRiskDollar(p), accountSize)

/** @param {Position} p @param {number} current @param {number} accountSize */
export const positionHeatAccountPercent = (p, current, accountSize) =>
  safeDivide(positionHeatDollar(p, current), accountSize)

// ───────────────────────────────────────────────────────────────────────────
// §14.4 Portfolio aggregates
// ───────────────────────────────────────────────────────────────────────────

/**
 * Sum component functions across all open positions.
 * `prices` is a map of symbol → current price. Positions without a price
 * are skipped (contribute 0) — callers may detect missing prices upstream
 * and render `—`.
 *
 * @param {Position[]} openPositions
 * @param {Record<string, number>} prices
 * @param {number} accountSize
 */
export const portfolioAggregates = (openPositions, prices, accountSize) => {
  let value = 0
  let unrealized = 0
  let risk = 0
  let heat = 0

  for (const p of openPositions) {
    const current = prices[p.symbol]
    if (current == null) continue
    value += current * p.shares
    unrealized += positionPnlDollar(p, current)
    // Broker imports carry entry_price as a NOT-NULL stop placeholder — that
    // is "no stop set", not a real stop at breakeven. Counting it made HEAT
    // equal the whole unrealized P&L for every broker position.
    if (!isBrokerPlaceholderStop(p)) {
      risk += positionRiskDollar(p)
      heat += positionHeatDollar(p, current)
    }
  }

  return {
    count: openPositions.length,
    value,
    invested: safeDivide(value, accountSize),
    risk,
    riskPercent: safeDivide(risk, accountSize),
    heat,
    heatPercent: safeDivide(heat, accountSize),
    unrealized,
  }
}

/**
 * Live mark-to-market for a BROKER account headline.
 *
 * Starts from the broker's authoritative net-liq (`account.brokerTotalEquity`)
 * and adds ONLY the price drift since the last sync. At sync time
 * (livePrice === brokerPrice) liveDelta is 0, so liveValue reconciles EXACTLY
 * to the broker's reported number; intraday it drifts with the market.
 *
 *   liveDelta = Σ over equity positions of (livePrice − brokerPrice) × signedShares
 *   signedShares: Short ⇒ −shares, else +shares
 *
 * A position contributes 0 when it is an option, or when its live price, broker
 * mark, or share count is missing/non-finite.
 *
 * @param {{brokerTotalEquity?: number|null}} account
 * @param {Array<{symbol:string, shares:number, side?:string, brokerPrice?:number, isOption?:boolean}>} positions
 * @param {Record<string, number>} prices  symbol → live price (number)
 * @returns {{liveValue: number|null, liveDelta: number}}
 */
export const brokerLiveEquity = (account, positions, prices) => {
  const base = account?.brokerTotalEquity
  if (base == null || !Number.isFinite(base)) return { liveValue: null, liveDelta: 0 }
  let liveDelta = 0
  for (const p of positions || []) {
    if (p?.isOption) continue
    const live = prices?.[p.symbol]
    const mark = p?.brokerPrice
    if (!Number.isFinite(live) || !Number.isFinite(mark) || !Number.isFinite(p?.shares)) continue
    const signed = p.side === 'Short' ? -p.shares : p.shares
    liveDelta += (live - mark) * signed
  }
  return { liveValue: base + liveDelta, liveDelta }
}

/**
 * Resolve the CURRENT price for a position: the live tick when present, else the
 * broker's last-synced mark (`brokerPrice`) so broker-imported equity rows show
 * a real price + P&L after hours / when the live feed is quiet (matching the
 * Dashboard snapshot tile). Manual positions (no `brokerPrice`) return
 * `undefined` so callers render "—".
 *
 * @param {{symbol: string, brokerPrice?: number}} position
 * @param {Record<string, {price?: number}>} prices  live snapshot map (sym → {price})
 * @returns {number|undefined}
 */
export const currentPriceFor = (position, prices, preferBroker = false) => {
  const live = prices?.[position?.symbol]?.price
  const broker = position?.brokerPrice
  // `preferBroker` (see preferBrokerMarks) inverts the order once the session
  // is closed — the broker's own mark is what the member's broker app shows.
  // Either way this is a PREFERENCE, not a restriction: whichever side is
  // missing, the other still prices the row.
  if (preferBroker && Number.isFinite(broker)) return broker
  if (Number.isFinite(live)) return live
  return Number.isFinite(broker) ? broker : undefined
}

/**
 * True when equity rows should be valued at the BROKER's own marks instead of
 * our live feed. Mirror of `prefer_broker_marks` in the Python authority
 * (api/services/journal_two/broker/composition.py) — parity-fixtured.
 *
 * Intraday the live feed wins: the balance sync runs once, pre-dawn, so the
 * broker's marks are the PREVIOUS session's close and would hide today's move.
 * Once the session is fully closed that inverts — the book is static and
 * re-marking with a second vendor's closes only manufactures a difference
 * (measured 2026-08-29: a 1.5c gap on SNAP's close was $30 of a $19.96 hero
 * discrepancy on 2,000 shares).
 *
 * BOTH conditions are required. `sessionClosed` alone would, on a weekday
 * evening, mirror marks that predate that day's close and show a DAY-STALE
 * account — much worse than the gap this closes.
 *
 * @param {{brokerBalanceSyncedAt?: string}} account
 * @param {boolean} sessionClosed  market fully closed (not open/pre/extended)
 * @param {string} lastClosedSessionET  'YYYY-MM-DD' of the last CLOSED session
 */
export const preferBrokerMarks = (account, sessionClosed, lastClosedSessionET) => {
  if (!sessionClosed || !lastClosedSessionET) return false
  const raw = account?.brokerBalanceSyncedAt
  if (!raw) return false
  // A naive stamp means UTC (the Python spine's rule) — never local time.
  const s = String(raw)
  const iso = /(Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s}Z`
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return false
  const et = new Date(new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York' }))
  if (Number.isNaN(et.getTime())) return false
  const p = (n) => String(n).padStart(2, '0')
  const day = `${et.getFullYear()}-${p(et.getMonth() + 1)}-${p(et.getDate())}`
  if (day > lastClosedSessionET) return true
  // Same ET date ⇒ the sync must land at or after the 16:00 close.
  return day === lastClosedSessionET && et.getHours() >= 16
}

/**
 * The broker cash to pair with LIVE position values. `brokerCash` is only as
 * fresh as the last balance sync (daily pre-market for most accounts), while
 * the fills rail moves the served book within minutes — the backend derives
 * `brokerCashLive` (stored cash carried forward over post-sync fills) so
 * net-liq never mixes a stale cash with live positions. Falls back to the
 * stored figure when the derivation is absent.
 */
export const effectiveBrokerCash = (account) => {
  const live = account?.brokerCashLive
  return Number.isFinite(live) ? live : account?.brokerCash
}

/**
 * The reference price "Today" is measured FROM, for one equity row.
 *
 * Precedence: the fill price when the position genuinely opened today
 * (Robinhood measures a same-day entry from your fill, starting ~$0), else the
 * BROKER's prior-session mark when we are valuing at broker marks, else the
 * feed's previous close (`prev_close` when > 0 — the feed emits 0.0 for
 * "missing"), else derived from `change_pct`.
 *
 * The broker rung is why this exists. On a closed session the row is valued at
 * the broker's mark; pairing that with our vendor's prev_close measures the
 * move PLUS the two vendors' disagreement at both ends. Measured 2026-08-29:
 * −$43.40 against Robinhood's −$23.29, where mark-to-mark reproduced −$26.49.
 * `brokerPricePrev` is null until a second session has synced, and the row then
 * falls back to the feed — honest, and exactly today's behaviour.
 *
 * ⛔ ONE grammar, three consumers (brokerLiveSummary, buildEquityRows,
 * yourPositionModel). They held three hand-written copies of this rule; a
 * fourth would drift.
 */
export const todayReferenceFor = (position, snap, todayIso, preferBroker = false) => {
  if (openedTodayFill(position, todayIso)) {
    return Number.isFinite(position?.entryPrice) ? position.entryPrice : undefined
  }
  if (preferBroker && Number.isFinite(position?.brokerPricePrev)) {
    return position.brokerPricePrev
  }
  if (Number.isFinite(snap?.prev_close) && snap.prev_close > 0) return snap.prev_close
  if (Number.isFinite(snap?.price) && Number.isFinite(snap?.change_pct)) {
    const pc = snap.price / (1 + snap.change_pct / 100)
    return Number.isFinite(pc) ? pc : undefined
  }
  return undefined
}

/**
 * Live broker net-liquidation summary, computed the way Robinhood does — cash
 * plus the live market value of holdings — so it matches the broker's actual
 * number and reflects today's intraday move. This SUPERSEDES anchoring on the
 * broker-reported `brokerTotalEquity` (which SnapTrade serves stale / near
 * previous close for some brokers, hiding today's move).
 *
 *   marketValue = Σ_equity (currentPrice × signedShares) + Σ_option (brokerCurrentValue)
 *   netLiq      = brokerCash + marketValue
 *
 * "Today" per equity position is measured vs its reference price: the entry
 * (fill) price when the position was OPENED TODAY (Robinhood measures same-day
 * entries from your fill, starting ~$0 — not the overnight gap), otherwise the
 * previous close (`prev_close` from the live snapshot). Options contribute ~0 to
 * Today (no live option quote — broker mark only). Today % uses the
 * previous-close equity as the denominator (`today / (netLiq − today)`).
 *
 * Prices missing for a position fall back to its `brokerPrice` for market value
 * (stable off-session), but only a real live tick contributes to Today.
 *
 * `preferBroker` (from preferBrokerMarks) inverts the equity mark preference
 * once the session is CLOSED and the broker's sync covers that close: the
 * broker's own marks then win, because they are what the member's broker app
 * is showing and our vendor's closes can only disagree with them. Options are
 * deliberately untouched — the live option mark already beats the sync-time
 * `brokerCurrentValue` (that is what option_marks.py exists for), and this
 * change does not revisit that ruling.
 *
 * @param {{brokerCash?: number, brokerBalanceSyncedAt?: string}} account
 * @param {Array<{symbol,shares,side?,brokerPrice?,entryPrice?,entryDate?}>} positions
 * @param {Array<{brokerCurrentValue?: number}>} optionStrategies
 * @param {Record<string,{price?:number, prev_close?:number}>} prices
 * @param {string} [todayIso]  today's date as 'YYYY-MM-DD' (ET); enables same-day-entry handling
 * @param {Record<string,{currentValue?:number, prevCloseValue?:number}>} [optionMarks]
 * @param {boolean} [preferBroker]  value equities at the broker's own marks
 * @returns {{netLiq: number|null, marketValue: number, today: number, todayPct: number|null}}
 */
export const brokerLiveSummary = (account, positions, optionStrategies, prices, todayIso, optionMarks, preferBroker = false) => {
  let marketValue = 0
  let today = 0
  // MIRROR PURITY: a broker-linked account's hero mirrors THE BROKER — only
  // broker-sourced rows participate. A manual row added into a broker account
  // must not move a number labeled as the broker's (its cash knows nothing of
  // it — the exact vintage-mix class of 2026-08-26). The Python authority for
  // this composition is api/services/journal_two/broker/composition.py;
  // parity-fixtures.json holds the two lanes together.
  const brokerOnly = account?.balanceSource === 'broker'
  for (const p of positions || []) {
    if (brokerOnly && p?.source !== 'broker') continue
    if (!Number.isFinite(p?.shares)) continue
    const live = prices?.[p.symbol]?.price
    const px = currentPriceFor(p, prices, preferBroker)
    if (!Number.isFinite(px)) continue
    const signed = p.side === 'Short' ? -p.shares : p.shares
    marketValue += px * signed
    // Today is measured on the SAME price the row was valued at — pairing a
    // broker-marked value with a live-marked move would make (netLiq − today)
    // a previous-close equity from neither vintage. Without a live tick and
    // without the broker preference there is no honest current side, so the
    // row contributes 0 to Today (a stale fallback must not book a move).
    if (Number.isFinite(live) || preferBroker) {
      // Reference price for Today: the entry (fill) if genuinely opened today
      // (placeholder-dated broker imports excluded — openedTodayFill), else the
      // previous close — the `prev_close` field when present AND > 0 (the feed
      // emits 0.0 for "missing", never a real close), otherwise derived from
      // `change_pct` (price / (1 + pct/100)). Mirrors positionTodayDollar.
      const ref = todayReferenceFor(p, prices?.[p.symbol], todayIso, preferBroker)
      if (Number.isFinite(ref)) today += signed * (px - ref)
    }
  }
  for (const s of optionStrategies || []) {
    if (brokerOnly && s?.source !== 'broker') continue
    // Live mark (Massive option aggs, useJ2OptionMarks) preferred; the
    // sync-time brokerCurrentValue is the fallback; a BROKER strategy with
    // neither (just filled — no mark stamped yet) values at its netEntry
    // (cost): its cash already left, so vanishing from net-liq would
    // understate the account by the whole premium. Values are SIGNED totals.
    const live = optionMarks?.[s?.id]
    const liveCur = live?.currentValue
    const bcv = s?.brokerCurrentValue
    let cur = Number.isFinite(liveCur) ? liveCur : bcv
    if (!Number.isFinite(cur) && s?.source === 'broker') cur = s?.netEntry
    if (Number.isFinite(cur)) marketValue += cur
    if (Number.isFinite(liveCur) && Number.isFinite(live?.prevCloseValue)) {
      // Today for options mirrors the equity rule: measured from the prior
      // session close, or from the entry (netEntry) for a strategy genuinely
      // opened today. entryEstimated (carried-in placeholder dates) comes
      // from the marks payload, which derives it from the external id.
      const opened = openedTodayFill(
        { entryDate: s?.entryDate, entryEstimated: live.entryEstimated === true },
        todayIso,
      )
      const base = opened && Number.isFinite(s?.netEntry) ? s.netEntry : live.prevCloseValue
      today += liveCur - base
    }
    // Without a live mark, options contribute 0 to Today (sync mark only).
  }
  const cash = effectiveBrokerCash(account)
  const netLiq = Number.isFinite(cash) ? cash + marketValue : null
  const prevCloseEquity = netLiq != null ? netLiq - today : null
  const todayPct =
    prevCloseEquity != null && prevCloseEquity !== 0 ? today / prevCloseEquity : null
  return { netLiq, marketValue, today, todayPct }
}

/**
 * Robinhood-style extended-hours split for the account hero.
 *
 * Regular session / market closed (no `ext_session` in the feed) → null.
 * Pre-market → `{ session: 'pre_market' }` only: the whole move since the
 *   previous close IS the overnight move, so the caller just relabels its
 *   single change line "Overnight".
 * Post-market → the full split:
 *   regularDollar = Σ signed × (day_close − ref)   [Today, FROZEN at the 4pm close;
 *                    ref = fill if opened today, else prev_close / derived]
 *   extDollar     = Σ signed × (extPrice − day_close)   [After-Hours]
 *   Percents are vs net-liq at the close (cash + Σ signed×day_close + option marks).
 * Positions whose snapshot lacks day_close contribute to neither leg (they
 * still show in the blended live total elsewhere — this split only reports
 * what it can attribute honestly).
 *
 * @param {Array<{symbol,shares,side?,entryPrice?,entryDate?}>} positions
 * @param {Record<string,{price?,prev_close?,change_pct?,day_close?,ext_price?,ext_session?}>} prices
 * @param {{cash?: number, optionMarketValue?: number, todayIso?: string}} [opts]
 * @returns {{session:string, regularDollar?:number, regularPct?:number|null,
 *            extDollar?:number, extPct?:number|null}|null}
 */
export const extendedSessionSplit = (positions, prices, opts = {}) => {
  const { cash = 0, optionMarketValue = 0, todayIso } = opts
  let session = null
  for (const p of positions || []) {
    const s = prices?.[p?.symbol]?.ext_session
    if (s === 'pre_market' || s === 'post_market') { session = s; break }
  }
  if (!session) return null
  if (session === 'pre_market') return { session }

  let regularDollar = 0
  let extDollar = 0
  let closeValue = 0
  for (const p of positions || []) {
    if (!Number.isFinite(p?.shares)) continue
    const snap = prices?.[p.symbol]
    const dayClose = snap?.day_close
    if (!Number.isFinite(dayClose)) continue
    const signed = p.side === 'Short' ? -p.shares : p.shares
    closeValue += signed * dayClose
    // Same grammar as everywhere else. `preferBroker` is FALSE by construction
    // here: BrokerAccountHero refuses this split entirely when it is composing
    // from broker marks (the legs come from day_close/ext_price, our vendor's),
    // so this path only ever runs in the live-vendor regime.
    const ref = todayReferenceFor(p, snap, todayIso, false)
    if (Number.isFinite(ref)) regularDollar += signed * (dayClose - ref)
    const ext = Number.isFinite(snap?.ext_price) ? snap.ext_price : snap?.price
    if (Number.isFinite(ext)) extDollar += signed * (ext - dayClose)
  }
  const netLiqAtClose = cash + closeValue + optionMarketValue
  const prevCloseEquity = netLiqAtClose - regularDollar
  return {
    session,
    regularDollar,
    regularPct: prevCloseEquity ? regularDollar / prevCloseEquity : null,
    extDollar,
    extPct: netLiqAtClose ? extDollar / netLiqAtClose : null,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// §14.5 Trade-level
// ───────────────────────────────────────────────────────────────────────────

/** @param {Trade} t */
export const tradePnlDollar = (t) =>
  t.side === 'Long'
    ? (t.exitPrice - t.entryPrice) * t.shares
    : (t.entryPrice - t.exitPrice) * t.shares

/** @param {Trade} t */
export const tradePnlPercent = (t) =>
  t.side === 'Long'
    ? safeDivide(t.exitPrice - t.entryPrice, t.entryPrice)
    : safeDivide(t.entryPrice - t.exitPrice, t.entryPrice)

/**
 * R-multiple = reward / risk, using the ORIGINAL stop.
 * Returns null when entry === originalStop (risk is zero; R undefined).
 * @param {Trade} t
 */
export const tradeRMultiple = (t) =>
  t.side === 'Long'
    ? safeDivide(t.exitPrice - t.entryPrice, t.entryPrice - t.originalStop)
    : safeDivide(t.entryPrice - t.exitPrice, t.originalStop - t.entryPrice)

/**
 * Calendar days between entry and exit, floored, clamped to ≥ 0.
 * Uses UTC ISO dates — no timezone drift per §14.5 edge case #10.
 * Python (api/services/journal_two/calculations.py:hold_days) is the
 * authority and clamps a negative span (exit before entry) to 0; the
 * clamp here keeps the JS mirror in exact parity (see parity.test.js).
 * @param {string} entryDate
 * @param {string} exitDate
 */
export const holdDays = (entryDate, exitDate) => {
  const ms = new Date(exitDate).getTime() - new Date(entryDate).getTime()
  return Math.max(0, Math.floor(ms / 86400000))
}

/**
 * Classify a trade as Win / Loss / BE using the live BE range.
 * BE at P&L exactly 0 counts as BE (inclusive of zero) — §14.5 edge #12.
 *
 * @param {Trade} t
 * @param {PortfolioSettings} settings
 */
export const tradeResult = (t, settings) => {
  const pnl = tradePnlDollar(t)
  if (!settings.breakevenRange.enabled) {
    if (pnl > 0) return 'Win'
    if (pnl < 0) return 'Loss'
    return 'BE'
  }
  const threshold =
    settings.breakevenRange.unit === '$'
      ? settings.breakevenRange.value
      : Math.abs((t.entryPrice * t.shares * settings.breakevenRange.value) / 100)
  if (Math.abs(pnl) <= threshold) return 'BE'
  return pnl > 0 ? 'Win' : 'Loss'
}

// ───────────────────────────────────────────────────────────────────────────
// §14.6 Journal summary stats
// ───────────────────────────────────────────────────────────────────────────

/**
 * Walk trades in chronological order and return the summary stat block.
 * `trades` MUST be pre-sorted by entryDate (or exitDate — pick one, be
 * consistent). BE excluded from winRate, avgWin, avgLoss. Max consecutive
 * Win/Loss streaks skip BE trades (they don't reset the run).
 *
 * @param {Trade[]} trades
 */
export const summaryStats = (trades) => {
  const wins = trades.filter((t) => t.result === 'Win')
  const losses = trades.filter((t) => t.result === 'Loss')
  const bes = trades.filter((t) => t.result === 'BE')

  const totalPnl = trades.reduce((s, t) => s + t.pnlDollar, 0)
  const mean = (arr, sel) =>
    arr.length === 0 ? null : arr.reduce((s, x) => s + sel(x), 0) / arr.length

  const winSum = wins.reduce((s, t) => s + t.pnlDollar, 0)
  const lossSum = losses.reduce((s, t) => s + t.pnlDollar, 0)

  // Profit factor: 0 losses with wins > 0 → ∞; no wins → 0
  let profitFactor
  if (Math.abs(lossSum) < EPSILON) {
    profitFactor = wins.length > 0 ? Infinity : 0
  } else {
    profitFactor = Math.abs(winSum) / Math.abs(lossSum)
  }

  // Max consecutive win/loss — BE trades are skipped (do not break a run).
  // §14.6: "BE trades DO NOT break a Win/Loss streak — they're skipped
  // when scanning for consecutive runs."
  let maxConsecWins = 0
  let maxConsecLosses = 0
  let runWins = 0
  let runLosses = 0
  for (const t of trades) {
    if (t.result === 'Win') {
      runWins += 1
      runLosses = 0
      if (runWins > maxConsecWins) maxConsecWins = runWins
    } else if (t.result === 'Loss') {
      runLosses += 1
      runWins = 0
      if (runLosses > maxConsecLosses) maxConsecLosses = runLosses
    }
    // BE: leave both runs untouched — neither extends nor resets.
  }

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    bes: bes.length,
    winRate: safeDivide(wins.length * 100, wins.length + losses.length),
    avgWinPercent: mean(wins, (t) => t.pnlPercent),
    avgLossPercent: mean(losses, (t) => t.pnlPercent),
    avgPnlPerTrade: mean(trades, (t) => t.pnlDollar),
    profitFactor,
    totalPnl,
    largestWin: trades.length === 0 ? 0 : Math.max(...trades.map((t) => t.pnlDollar)),
    largestLoss: trades.length === 0 ? 0 : Math.min(...trades.map((t) => t.pnlDollar)),
    avgHold: mean(trades, (t) => t.holdDays),
    maxConsecWins,
    maxConsecLosses,
  }
}
