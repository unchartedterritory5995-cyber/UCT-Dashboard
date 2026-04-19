/**
 * Journal 2.0 — JSDoc typedefs.
 * Spec: docs/plans/journal-2.0-spec.md §4.
 *
 * These typedefs are the contract shared across calculations, services,
 * components, and hooks. Any field change must start here and propagate
 * outward, never the other way around.
 *
 * All timestamps: ISO 8601 in UTC. Display in the browser's local timezone.
 * Share counts: up to 4 decimal places in storage; trailing zeros stripped
 * in display.
 */

/**
 * @typedef {'custom'} StopModeCustom
 * @typedef {Object} StopModeBarLowHigh
 * @property {'bar_low_high'} mode
 * @property {number} buffer
 * @property {'$'|'%'} bufferUnit
 *
 * @typedef {Object} StopModeFixedDollar
 * @property {'fixed_dollar_risk'} mode
 * @property {number} amount
 *
 * @typedef {Object} StopModeFixedPercent
 * @property {'fixed_percent_distance'} mode
 * @property {number} percent
 *
 * @typedef {{mode: StopModeCustom} | StopModeBarLowHigh | StopModeFixedDollar | StopModeFixedPercent} DefaultStop
 */

/**
 * @typedef {Object} BreakevenRange
 * @property {boolean} enabled    false iff value === 0
 * @property {'$'|'%'} unit
 * @property {number} value
 */

/**
 * Single row per user.
 * @typedef {Object} PortfolioSettings
 * @property {string} id
 * @property {string|null} userId
 * @property {number} accountSize
 * @property {DefaultStop} defaultStop
 * @property {'FIFO'|'LIFO'} positionClosing
 * @property {BreakevenRange} breakevenRange
 * @property {string[]} setups
 * @property {boolean} shareJournalData
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * Open (or archived) position row.
 *
 * `stopPrice` is the ORIGINAL stop — frozen for Trade R-multiples, never
 * modified by the raise-to-breakeven toggle.
 * `breakevenStop` is the live-risk override when raiseToBreakeven is true.
 * `closedAt` is set on the instant shares reach 0; the row is archived,
 * not hard-deleted.
 *
 * @typedef {Object} Position
 * @property {string} id
 * @property {string|null} userId
 * @property {string} symbol
 * @property {'Long'|'Short'} side
 * @property {string} entryDate              ISO 8601 UTC
 * @property {number} shares                 CURRENT remaining (fractional 4dp)
 * @property {number} originalShares         immutable after creation
 * @property {number} entryPrice             weighted-avg if scaled in
 * @property {number} stopPrice              ORIGINAL stop; frozen for R-math
 * @property {number|null} breakevenStop     live-risk override; null unless raiseToBreakeven
 * @property {boolean} raiseToBreakeven
 * @property {string|null} setup
 * @property {string|null} notes
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string|null} closedAt          set when shares reach 0 (archive, not delete)
 */

/**
 * Journal row. Written on every full OR partial close. Append-only
 * in normal operation; manual add + CSV import are the only non-close
 * write paths.
 *
 * @typedef {Object} Trade
 * @property {string} id
 * @property {string|null} userId
 * @property {string} positionId             source Position for traceability
 * @property {string} symbol
 * @property {'Long'|'Short'} side
 * @property {number} shares                 shares closed in THIS trade record
 * @property {number} entryPrice
 * @property {string} entryDate
 * @property {number} exitPrice
 * @property {string} exitDate
 * @property {number} originalStop           copied from Position.stopPrice (NEVER breakevenStop)
 * @property {string|null} setup
 * @property {string|null} notes
 * @property {number} pnlDollar              derived; persisted for query speed
 * @property {number} pnlPercent
 * @property {number|null} rMultiple         null when entry === originalStop
 * @property {number} holdDays
 * @property {'Win'|'Loss'|'BE'} result       using settings.breakevenRange at time of close
 * @property {string} createdAt
 */

// No runtime exports — this file exists purely for JSDoc type resolution
// across the Journal 2.0 codebase. Keep it in sync with §4 of the spec.
export {}
