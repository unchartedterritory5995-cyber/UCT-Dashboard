/**
 * Wave 13 lane 13H-1 — the chart plan: what a chart block in a note holds about the trade it
 * plans, and the arithmetic the plan panel shows. PURE: no fetch, no React, no clock.
 *
 * ── WHERE THE PLAN LIVES (two places, never three) ───────────────────────────────────────────
 *
 *  1. PLAN ROLES ride the DRAWINGS, inside the embed's existing `annotations` attr: a horizontal
 *     line in the price pane carrying `role: 'entry' | 'stop' | 'target'`. Nothing is duplicated
 *     — the line IS the level. `withPlanRole` / `setPlanRole` write that shape, which is the
 *     write interface 13A's `plan_extract.py` documents and reads (its `_chart_levels`).
 *     ⛔ THIS FILE NEVER READS A PLAN OUT OF A NOTE. `plan_extract.py` is the ONE reader of plan
 *     levels (precedence, contradictions, scale-out targets); the panel asks the server for its
 *     reading (`POST /api/j2/chart-plan/size`) and feeds the numbers into `sizePlan` below.
 *
 *  2. EVERYTHING ELSE rides the `ta` attr on the same `widgetEmbed` (schema level 4,
 *     NEVER-REVERT — `NOTEBOOK_ATTR_SCHEMA` in lib/notebookSchema.js):
 *
 *       ta = {
 *         v:           1,                      // TA_VERSION, bumped only if a field's meaning moves
 *         setupTag:    'High Tight Flag',      // ≤ 80 chars; 13I's chart_blocks reads it
 *         fingerprint: { … },                  // frozen once by 13I (`tech_fingerprint`), opaque here
 *         planBlock:   { shares: 200,          // planned shares (plan_extract reads planBlock.shares)
 *                        sizedBy: 'starter' }, // which engine sized them: SIZED_BY
 *       }
 *
 *     A key with nothing in it is left out, and a `ta` with nothing in it is `null` — the
 *     server's schema guard counts `ta` only when it carries a value, so an empty object would
 *     needlessly lock older tabs out of a note.
 *
 * ── SIZING (ruling P3) ────────────────────────────────────────────────────────────────────────
 *
 *  No new formula. Reward-to-risk, risk per share and position size are the trader STARTER
 *  FORMULAS (`lib/formula/computed.js` STARTER_FORMULAS), evaluated by the same formula engine
 *  the property editor runs — the expressions are read from that list, never retyped here.
 *  Shares come from Compass's `size_a_trade` when it answered (a long, with the brain pack
 *  installed; the server route asks it), else the `position_size` starter with
 *  Account risk = account size × max risk per trade %. Every answer names its engine
 *  (`sizedBy` + `label`), because the two disagree by design: Compass scales by regime and
 *  grade and caps account risk at 2%; the starter does exactly what its formula says.
 */
import { PRICE_ROLES, planBlock as planLevelsBlock } from './planLevels'
import { STARTER_FORMULAS } from './formula/computed'
import { FormulaEvalError, evaluate, parse } from './formula/formulaEngine'
import { PRICE as PRICE_PANE } from '../../../components/chart/drawingPanes'

// ── the `ta` attr ─────────────────────────────────────────────────────────────────────────────

export const TA_VERSION = 1
export const TA_KEYS = Object.freeze(['v', 'setupTag', 'fingerprint', 'planBlock'])
/** The setup tag's cap — the same 80 13I's projection keeps (`chart_blocks.extract_blocks`). */
export const SETUP_TAG_MAX = 80

/** The engines that may size a plan, and how each names itself on screen. */
export const SIZED_BY = Object.freeze({ COMPASS: 'compass', STARTER: 'starter' })
export const SIZED_BY_LABEL = Object.freeze({
  compass: 'Sized by Compass (size_a_trade: regime-scaled, 2% account-risk cap)',
  starter: 'Sized by the Position size formula (account risk ÷ risk per share)',
})

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v)

function cleanTag(tag) {
  if (typeof tag !== 'string') return null
  const t = tag.trim()
  return t ? t.slice(0, SETUP_TAG_MAX) : null
}

function cleanPlanBlock(block) {
  if (!isPlainObject(block)) return null
  const out = { ...planLevelsBlock({ shares: block.shares }) }   // 13A's builder: shares > 0 only
  if (out.shares != null && Object.values(SIZED_BY).includes(block.sizedBy)) out.sizedBy = block.sizedBy
  return Object.keys(out).length ? out : null
}

/**
 * The canonical `ta`: only the known keys, each cleaned, `v` stamped — or `null` when it holds
 * nothing. Unknown keys are dropped (a newer bundle's key is not ours to carry blind).
 */
export function normalizeTa(ta) {
  if (!isPlainObject(ta)) return null
  const out = {}
  const tag = cleanTag(ta.setupTag)
  if (tag) out.setupTag = tag
  if (isPlainObject(ta.fingerprint) && Object.keys(ta.fingerprint).length) out.fingerprint = ta.fingerprint
  const block = cleanPlanBlock(ta.planBlock)
  if (block) out.planBlock = block
  return Object.keys(out).length ? { v: TA_VERSION, ...out } : null
}

/** `ta` with its setup tag set (a blank tag clears it). */
export function withSetupTag(ta, tag) {
  return normalizeTa({ ...(isPlainObject(ta) ? ta : {}), setupTag: tag })
}

/** `ta` with a frozen fingerprint (13I's freeze). A fingerprint already present is KEPT —
 *  frozen means frozen; pass `{ replace: true }` only for an explicit re-freeze. */
export function withFingerprint(ta, fingerprint, { replace = false } = {}) {
  const base = isPlainObject(ta) ? ta : {}
  if (!replace && isPlainObject(base.fingerprint) && Object.keys(base.fingerprint).length) return normalizeTa(base)
  return normalizeTa({ ...base, fingerprint })
}

/** `ta` with the planned shares and the engine that sized them (no shares clears the block). */
export function withPlanShares(ta, shares, sizedBy) {
  return normalizeTa({ ...(isPlainObject(ta) ? ta : {}), planBlock: { shares, sizedBy } })
}

// ── plan roles on drawings ────────────────────────────────────────────────────────────────────

/** Drawing types that can carry a plan role: a level, drawn flat. A trendline's price moves
 *  with time, so it is not a level a plan can name (it can still carry an alert). */
export const PLAN_ROLE_DRAWING_TYPES = Object.freeze(['horizontal', 'hray'])
/** A plan has one entry and one stop; targets may be several (scale-outs, which plan_extract
 *  resolves to the nearest). Setting a unique role on one line clears it from the others. */
export const UNIQUE_PLAN_ROLES = Object.freeze(['entry', 'stop'])

const finitePositive = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)

/** The price a level drawing sits at: its own `price` field first, else its anchor
 *  (`points[0].price`) -- the SAME precedence `plan_extract.py`'s `_annotation_price` reads
 *  (CLAUDE.md "a second authority over one value"; this is the one reader's sibling, not a
 *  second one). `withPlanRole` strips `price` the moment a drawing has an anchor, so the two
 *  fields are never both live on one drawing -- a dragged line's `points` stays the only
 *  authority for it, and a role set with no drawing to anchor to (`planLevels.planAnnotation
 *  (role, price)`, 13H's own documented write shape for a level with no canvas geometry) is
 *  still readable here instead of silently reading as "no levels drawn". Found by the wave-13
 *  integration walk (13X): a role-bearing annotation seeded in exactly this shape -- the same
 *  shape 13A's and 13J's own fixtures use -- rendered zero rows in this panel. */
export function drawingLevelPrice(drawing) {
  return finitePositive(drawing?.price) ?? finitePositive(drawing?.points?.[0]?.price)
}

/** Can this drawing carry a plan role? A flat level, in the PRICE pane, at a real price. A line
 *  in an RSI or volume pane is drawn in that pane's units and would read as a price of 30. */
export function canCarryPlanRole(drawing) {
  if (!isPlainObject(drawing) || !PLAN_ROLE_DRAWING_TYPES.includes(drawing.type)) return false
  if ((drawing.pane ?? PRICE_PANE) !== PRICE_PANE) return false
  return drawingLevelPrice(drawing) != null
}

/**
 * The drawing with `role` set (or removed, for `null`).
 *
 * ⛔ No `price` field is written: the line's own anchor (`points[0].price`) is the level, and it
 * follows the line when the member drags it. plan_extract reads `price` FIRST when present, so a
 * stale copy would freeze the plan at wherever the line was when the role was set — any `price`
 * left on a drawing that has an anchor is removed here for the same reason.
 */
export function withPlanRole(drawing, role) {
  if (!isPlainObject(drawing)) throw new Error('a plan role needs a drawing')
  const rest = { ...drawing }
  delete rest.role
  if (drawingLevelPrice(drawing) != null) delete rest.price
  if (role == null) return rest
  if (!PRICE_ROLES.includes(role)) throw new Error(`not a plan role: ${role}`)
  if (!canCarryPlanRole(drawing)) throw new Error('only a flat level in the price pane can carry a plan role')
  rest.role = role
  return rest
}

/**
 * `annotations` with drawing `drawingId` given `role` (null clears it). A unique role (entry,
 * stop) moves: any other drawing holding it loses it, so the block never names two entries.
 * Returns a NEW array; the input is not touched. An unknown id returns the input unchanged.
 */
export function setPlanRole(annotations, drawingId, role) {
  const list = Array.isArray(annotations) ? annotations : []
  // ⛔ No id, no change. `undefined === undefined` matched EVERY drawing that carries no id (the
  // sample plan note's levels), so one press re-marked all of them.
  if (drawingId == null || drawingId === '') return list
  if (!list.some((d) => d?.id === drawingId)) return list
  return list.map((d) => {
    if (d?.id === drawingId) return withPlanRole(d, role)
    if (role && UNIQUE_PLAN_ROLES.includes(role) && d?.role === role) return withPlanRole(d, null)
    return d
  })
}

// ── sizing: the starter formulas, evaluated, never restated ───────────────────────────────────

const STARTER = Object.fromEntries(STARTER_FORMULAS.map((f) => [f.id, f]))

/** Evaluate one starter formula by id against `{Name: number}` values. -> {value, reason}. */
export function evaluateStarter(id, values) {
  const f = STARTER[id]
  if (!f) throw new Error(`no starter formula: ${id}`)
  const byName = new Map(Object.entries(values || {}).map(([k, v]) => [k.toLowerCase(), v]))
  const lookup = (kind, key) => {
    const v = byName.get(String(key).toLowerCase())
    if (v == null) throw new FormulaEvalError('missing', `${key} is empty`)
    return v
  }
  try {
    return { value: evaluate(parse(f.expression), lookup), reason: null }
  } catch (e) {
    if (e instanceof FormulaEvalError) return { value: null, reason: e.message }
    throw e
  }
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** 'long' when the stop is under the entry, 'short' when above, null when either is missing or
 *  they are equal (zero risk: no side can be read from it). */
export function planSide({ entry, stop } = {}) {
  const e = num(entry); const s = num(stop)
  if (e == null || s == null || e === s) return null
  return s < e ? 'long' : 'short'
}

/** Dollars at risk per share — the `risk_per_share` starter. */
export function riskPerShare({ entry, stop } = {}) {
  return evaluateStarter('risk_per_share', { Entry: num(entry), Stop: num(stop) })
}

/** Reward-to-risk: the `r_multiple` starter with the TARGET as the exit — the R the plan expects
 *  at its target. Long or short (a stop above the entry reads as a short; the signs cancel). A
 *  target on the wrong side of the entry reads NEGATIVE, which is the truth about that plan. */
export function rewardToRisk({ entry, stop, target } = {}) {
  return evaluateStarter('r_multiple', { Entry: num(entry), Stop: num(stop), Exit: num(target) })
}

/** Account risk in dollars: account size × max risk per trade % (`maxRiskPerTradePct`,
 *  accounts.py). Either missing, or not positive -> null with a reason. */
export function accountRiskDollars({ accountSize, riskPct } = {}) {
  const a = num(accountSize); const p = num(riskPct)
  if (a == null || a <= 0) return { value: null, reason: 'No account size is set' }
  if (p == null || p <= 0) return { value: null, reason: 'No max risk per trade is set' }
  return { value: (a * p) / 100, reason: null }
}

/** Shares from the `position_size` starter: round(account risk ÷ |entry − stop|). */
export function starterPositionSize({ entry, stop, accountRisk } = {}) {
  return evaluateStarter('position_size', { 'Account risk': num(accountRisk), Entry: num(entry), Stop: num(stop) })
}

/** Did Compass answer with shares this panel can use? (`size_a_trade` says ok and gives a count;
 *  0 is an answer — the regime × grade table's "do not size" — not a failure.) */
function compassShares(compass) {
  if (!isPlainObject(compass) || compass.ok !== true) return null
  const s = compass.shares
  return typeof s === 'number' && Number.isFinite(s) && s >= 0 ? Math.floor(s) : null
}

/**
 * The plan panel's numbers, from levels already READ by plan_extract (via the server).
 *
 * @param {object} p
 * @param {number} p.entry      @param {number} p.stop      @param {number} [p.target]
 * @param {number} [p.accountSize]  @param {number} [p.riskPct]  max risk per trade, in %
 * @param {object} [p.compass]  the server's `size_a_trade` answer, or null when it was not asked
 * @returns {{side, riskPerShare, rewardToRisk, accountRisk, shares, sizedBy, label, reason}}
 *   Every number is a number or null, never NaN; `reason` says why `shares` is null.
 */
export function sizePlan({ entry, stop, target, accountSize, riskPct, compass } = {}) {
  const side = planSide({ entry, stop })
  const rps = riskPerShare({ entry, stop })
  const rr = num(target) == null ? { value: null, reason: 'No target is drawn' } : rewardToRisk({ entry, stop, target })
  const risk = accountRiskDollars({ accountSize, riskPct })
  const base = {
    side,
    riskPerShare: rps.value,
    rewardToRisk: rr.value,
    rewardToRiskReason: rr.reason,
    accountRisk: risk.value,
  }
  if (side == null) {
    const reason = num(entry) == null || num(stop) == null
      ? 'Draw an entry and a stop to size this trade'
      : 'The entry and the stop are the same price: there is no risk to size against'
    return { ...base, shares: null, sizedBy: null, label: null, reason }
  }
  const viaCompass = side === 'long' ? compassShares(compass) : null
  if (viaCompass != null) {
    return { ...base, shares: viaCompass, sizedBy: SIZED_BY.COMPASS, label: SIZED_BY_LABEL.compass, reason: null }
  }
  if (risk.value == null) {
    return { ...base, shares: null, sizedBy: null, label: null, reason: risk.reason }
  }
  const sized = starterPositionSize({ entry, stop, accountRisk: risk.value })
  if (sized.value == null) {
    return { ...base, shares: null, sizedBy: null, label: null, reason: sized.reason }
  }
  return { ...base, shares: sized.value, sizedBy: SIZED_BY.STARTER, label: SIZED_BY_LABEL.starter, reason: null }
}
