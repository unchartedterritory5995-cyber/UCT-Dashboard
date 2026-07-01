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
    risk += positionRiskDollar(p)
    heat += positionHeatDollar(p, current)
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
export const currentPriceFor = (position, prices) => {
  const live = prices?.[position?.symbol]?.price
  if (Number.isFinite(live)) return live
  return Number.isFinite(position?.brokerPrice) ? position.brokerPrice : undefined
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
 * @param {{brokerCash?: number}} account
 * @param {Array<{symbol,shares,side?,brokerPrice?,entryPrice?,entryDate?}>} positions
 * @param {Array<{brokerCurrentValue?: number}>} optionStrategies
 * @param {Record<string,{price?:number, prev_close?:number}>} prices
 * @param {string} [todayIso]  today's date as 'YYYY-MM-DD' (ET); enables same-day-entry handling
 * @returns {{netLiq: number|null, marketValue: number, today: number, todayPct: number|null}}
 */
export const brokerLiveSummary = (account, positions, optionStrategies, prices, todayIso) => {
  let marketValue = 0
  let today = 0
  for (const p of positions || []) {
    if (!Number.isFinite(p?.shares)) continue
    const live = prices?.[p.symbol]?.price
    const px = Number.isFinite(live) ? live : p?.brokerPrice
    if (!Number.isFinite(px)) continue
    const signed = p.side === 'Short' ? -p.shares : p.shares
    marketValue += px * signed
    if (Number.isFinite(live)) {
      const openedToday =
        todayIso && p.entryDate && String(p.entryDate).slice(0, 10) === todayIso
      // Reference price for Today: the entry (fill) if opened today, else the
      // previous close — the `prev_close` field when present, otherwise derived
      // from `change_pct` (price / (1 + pct/100)), since the live feed doesn't
      // always carry prev_close. Mirrors positionTodayDollar's proven approach.
      let ref
      if (openedToday) {
        ref = p.entryPrice
      } else {
        const snap = prices?.[p.symbol]
        if (Number.isFinite(snap?.prev_close)) ref = snap.prev_close
        else if (Number.isFinite(snap?.change_pct)) ref = live / (1 + snap.change_pct / 100)
      }
      if (Number.isFinite(ref)) today += signed * (live - ref)
    }
  }
  for (const s of optionStrategies || []) {
    const bcv = s?.brokerCurrentValue
    if (Number.isFinite(bcv)) marketValue += bcv
    // options contribute ~0 to Today (no live option quote — broker mark only)
  }
  const cash = account?.brokerCash
  const netLiq = Number.isFinite(cash) ? cash + marketValue : null
  const prevCloseEquity = netLiq != null ? netLiq - today : null
  const todayPct =
    prevCloseEquity != null && prevCloseEquity !== 0 ? today / prevCloseEquity : null
  return { netLiq, marketValue, today, todayPct }
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
 * Calendar days between entry and exit, floored.
 * Uses UTC ISO dates — no timezone drift per §14.5 edge case #10.
 * @param {string} entryDate
 * @param {string} exitDate
 */
export const holdDays = (entryDate, exitDate) => {
  const ms = new Date(exitDate).getTime() - new Date(entryDate).getTime()
  return Math.floor(ms / 86400000)
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
