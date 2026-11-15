// ── UCT Agent PRODUCT GUIDE: finding the REAL control a step points at ──────────────────────────────────────
//
// A target is one of:
//   'chart.timeframe'                         a `data-guide` id the control carries
//   { within: 'chartSettings', aria: '…' }    a control's own accessible name inside a registered container (used
//                                             where the control belongs to another team's surface and needs no
//                                             attribute of ours — e.g. Indicators' search box)
//   { widgetType: 'watchlist' }               a board cell of that widget type (data-widget-type)
//   { widgetType: 'watchlist', guide: '…' }   a `data-guide` id inside a board cell of that type (for a control the
//                                             shared list view also renders for other widgets — a Scanner's back button)
//   { inWidget: 'watchlist.addSymbol' }       a `data-guide` id inside the cell the walkthrough pinned (a `pin` step), and
//                                             nowhere else: the same control on another widget proves nothing
//   ['a', 'b']                                any of these (for a `waitFor` that more than one route satisfies)
//
// ⭐ GUIDE SYSTEM. Inside a box (`within`, `widgetType` or `inWidget`) a target may also name:
//   { aria: '…' }                             the control's own accessible name
//   { guide: '…' }                            a `data-guide` id
//   { attr: 'data-x', value: '…' }            a stable data attribute the product already writes (never a CSS class)
//   { label: '…' }                            the on-screen label with exactly these words (a settings section, a row)
//   { cursor: 'row-resize' }                  the element the chart library itself marks with this cursor: a pane divider,
//                                             which it draws and which carries no attribute of ours
//   { named: '…' }                            …narrowed to the ones NAMED these words, from the first word ("RSI", not "Stoch RSI")
//   { text: '…' }                             …narrowed to the ones whose visible text holds these words, in any form
//                                             (a per-indicator row: "RSI"), for controls that only exist per instance
// and any target may add { on: true }: the control must be in its selected state (a tab selected, a toggle pressed, a
// menu expanded, a row current). That is how a step says what its RESULT looks like, so a result already true is skipped.
//
// `chart.*` and `widget.*` targets are looked for inside the chart being talked about (`[data-widget-id="<chart>"]`, the board cell
// the chart ref names), then anywhere (a menu the chart opened may be portalled). A target counts only when the
// member can SEE it — present is not visible (the Notebook tour's own `isOnScreen`, reused as-is: a box, on screen,
// not clipped away). Nothing here clicks, focuses or changes anything.

import { isOnScreen } from '../../pages/journal-2-0/components/notebook/onboarding/tourAnchorVisibility'

const esc = (s) => String(s).replace(/["\\]/g, '\\$&')
const cellOf = (chartRef) => {
  if (!chartRef || typeof document === 'undefined') return null
  const id = String(chartRef).split('~')[0]
  return document.querySelector(`[data-widget-id="${esc(id)}"]`)
}
let anyBox = false   // presentTarget: "is it in the document at all", for a control a narrow row has clipped
const visible = (els) => (anyBox ? [...els][0] || null : [...els].find(el => { try { return isOnScreen(el) } catch { return false } }) || null)

const STATE_ATTRS = ['aria-selected', 'aria-pressed', 'aria-current', 'aria-expanded', 'aria-checked', 'data-guide-on']
/** The control is in its selected state. */
export const isOn = (el) => STATE_ATTRS.some(k => el?.getAttribute?.(k) === 'true')
/** The control is there but greyed out. */
export const isDisabled = (el) => !!el && (el.disabled === true || el.getAttribute?.('aria-disabled') === 'true')

// the words on their own: "EMA 20" is not "EMA 200", "DEMA 20" or "TEMA 20". A chip's text runs its value into its name
// ("EMA 2099.54"), so its accessible name is read as well
function holds(text, words) {
  const t = String(text || '').toLowerCase()
  const w = String(words).toLowerCase()
  for (let i = t.indexOf(w); i >= 0; i = t.indexOf(w, i + 1)) {
    const before = i === 0 ? '' : t[i - 1]
    if (/[a-z0-9]/.test(before)) continue
    if (!/\d$/.test(w) || !/\d/.test(t[i + w.length] || '')) return true
  }
  return false
}
const hasWords = (el, words) => holds(el.getAttribute?.('aria-label'), words) || holds(el.textContent, words)
// the control is NAMED these words, from its first word: "RSI" is not the "Stochastic RSI" row, nor "ATR" the "ATR Bands" chip
function isNamed(el, words) {
  const name = String(el.getAttribute?.('aria-label') || el.textContent || '').replace(/ options$/, '').trim().toLowerCase()
  const w = String(words).toLowerCase()
  if (!name.startsWith(w)) return false
  const next = name.slice(w.length)
  if (/\d$/.test(w) && /^\d/.test(next)) return false
  return next === '' || /^[^a-z0-9]*$/.test(next) || /^\s*\(?\d/.test(next)
}
// the divider along the top of the pane whose legend names these words: the last one above that legend
function dividerAbove(lines, box, words) {
  const cell = box.closest?.('[data-widget-id]') || box
  for (const chip of cell.querySelectorAll('[data-guide="chart.chip"]')) {
    if (!isNamed(chip, words)) continue
    const y = chip.getBoundingClientRect().top
    const above = lines.filter(l => l.getBoundingClientRect().top <= y).sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)
    if (above.length) return above.slice(0, 1)
  }
  return []
}
// what a target's own narrowing leaves inside one box
function inside(box, t) {
  // ⭐ NAMED CONTROLS (guide/controls.js): the control's own accessible name or tooltip, by a pattern, for a name the product
  // builds per instance ("Delete Swing permanently", "Magnet: on") — never a CSS class
  if (t.nameRe) {
    const re = new RegExp(t.nameRe, 'i')
    return [...box.querySelectorAll('[aria-label], [title]')].filter(el => re.test(el.getAttribute('aria-label') || '') || re.test(el.getAttribute('title') || ''))
  }
  const sel = t.aria ? `[aria-label="${esc(t.aria)}"]`
    : t.guide ? `[data-guide="${esc(t.guide)}"]`
    : t.attr ? (t.value == null ? `[${t.attr}]` : `[${t.attr}="${esc(t.value)}"]`)
    : null
  if (t.label || t.lead) {
    const want = String(t.label || t.lead).toLowerCase()
    // the element whose OWN words these are: a row with an icon beside its text has children, and the text is still its own
    const own = (el) => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim().toLowerCase()
    // `lead`: the label STARTS with these words ("Remove starred (3)" carries its count)
    return [...box.querySelectorAll('span, div, label, h2, h3, h4, button')].filter(el => (t.lead ? own(el).startsWith(want) : own(el) === want))
  }
  if (t.cursor) {
    const lines = [...box.querySelectorAll('div')].filter(el => { try { return getComputedStyle(el).cursor === t.cursor } catch { return false } })
    return t.above ? dividerAbove(lines, box, t.above) : lines
  }
  const els = sel ? [...box.querySelectorAll(sel)] : [box]
  if (t.named) return els.filter(el => isNamed(el, t.named))
  return t.text ? els.filter(el => hasWords(el, t.text)) : els
}
const pick = (els, t) => visible(t.on ? els.filter(isOn) : els)

/** The element a target means right now, visible to the member — or null. */
export function findTarget(target, { chartRef = null, widgetRef = null } = {}) {
  if (typeof document === 'undefined' || !target) return null
  if (Array.isArray(target)) {
    for (const t of target) { const hit = findTarget(t, { chartRef, widgetRef }); if (hit) return hit }
    return null
  }
  // the control's state, whether or not a narrow chart is showing it (a tool armed from the keyboard)
  if (typeof target === 'object' && target.present) {
    const { present: _p, ...rest } = target
    anyBox = true
    try { return findTarget(rest, { chartRef, widgetRef }) } finally { anyBox = false }
  }
  // the state has gone: what a step waits for when its result is something ending (an armed tool, placed)
  if (typeof target === 'object' && target.not) return findTarget(target.not, { chartRef, widgetRef }) ? null : document.body
  if (typeof target === 'object' && target.inWidget) {
    const cell = cellOf(widgetRef)
    return cell ? pick([...cell.querySelectorAll(`[data-guide="${esc(target.inWidget)}"]`)], target) : null
  }
  if (typeof target === 'object' && target.widgetType) {
    const cells = document.querySelectorAll(`[data-widget-type="${esc(target.widgetType)}"]`)
    const hit = pick([...cells].flatMap(c => inside(c, target)), target)
    // ⭐ `portaled`: a control in a menu the widget renders onto the page (createPortal to body), outside its cell. Looked for in
    // the cell first, then only where no board cell is (the portal), never inside ANOTHER widget's cell
    if (hit || !target.portaled || !cells.length) return hit
    return pick(inside(document.body, target).filter(el => !el.closest?.('[data-widget-id]')), target)
  }
  // ⭐ '@chart': the chart being talked about is the box itself (a toolbar toggle, a panel it opened); a panel portalled
  // out of the cell is looked for on the page
  if (typeof target === 'object' && target.within === '@chart') {
    const cell = cellOf(chartRef)
    // ⭐ the chart talked about is GONE (closed): nothing on another chart stands in for it (the walkthrough pauses and says so)
    if (!cell) return chartRef ? pick(inside(document.body, target).filter(el => !el.closest?.('[data-widget-id]')), target) : pick(inside(document.body, target), target)
    // …never the same control on ANOTHER chart: outside this cell, only what sits in no board cell at all (a portal)
    return pick(inside(cell, target), target) || pick(inside(document.body, target).filter(el => !el.closest?.('[data-widget-id]')), target)
  }
  if (typeof target === 'object' && target.within) {
    // a box on a chart: the chart being talked about, when it has one (a menu it opened may be portalled)
    const onChart = /^chart\.(?!.*Menu$)/.test(String(target.within))
    const cell = onChart ? cellOf(chartRef) : null
    // ⭐ a box on a chart that is GONE: never the same box on another chart
    if (onChart && chartRef && !cell) return null
    const boxes = (cell || document).querySelectorAll(`[data-guide="${esc(target.within)}"]`)
    for (const box of boxes) {
      const hit = pick(inside(box, target), target)
      if (hit) return hit
    }
    return null
  }
  const id = String(typeof target === 'object' ? target.id : target)
  const on = typeof target === 'object' && target.on
  const words = typeof target === 'object' ? target.text : null
  const exactly = typeof target === 'object' ? target.named : null
  const said = (els) => (exactly ? els.filter(el => isNamed(el, exactly)) : words ? els.filter(el => hasWords(el, words)) : els)
  const sel = `[data-guide="${esc(id)}"]`
  // ⭐ PHASE 3: a widget header's own controls (`widget.*` — the link dot) are scoped to the chart talked about, too
  if (id.startsWith('chart.') || id.startsWith('widget.')) {
    const cell = cellOf(chartRef)
    const inChart = cell ? pick(said([...cell.querySelectorAll(sel)]), { on }) : null
    if (inChart) return inChart
    // with a chart named, a control on ANOTHER chart is not this one — except what that chart opened (a menu)
    // ⭐ and when that chart is GONE (closed), nothing on another chart stands in for it: the walkthrough pauses and says so
    if ((cell || chartRef) && !/Menu$/.test(id)) return null
  }
  return pick(said([...document.querySelectorAll(sel)]), { on })
}

// ── a control a narrow row has clipped ──
// With the Agent panel open a chart gets narrow, and its header row (overflow: hidden, no scrollbar) cuts off what is at
// its right end: the settings gear, among others. The member can neither see nor reach it, so the guide slides that row
// sideways while the step needs it, and puts it back afterwards. It is a view of the same controls: nothing is stored.
let slid = []
// a window is scrolled for a control once: this runs on every tick, and must not fight the member's own scrolling
let scrolledTo = new WeakSet()
const clips = (node) => { let o = ''; try { o = getComputedStyle(node).overflowX } catch { o = '' } return /hidden|clip|auto|scroll/.test(o) && node.scrollWidth > node.clientWidth }
// a row squeezed to nothing: with two charts and the Agent open the drawing strip has no width at all, because the fixed
// buttons beside it take the whole line. There is nothing to slide, so its neighbours step aside for the step
const SQUEEZED_PX = 8
const squeezed = (node) => node.getClientRects?.().length > 0 && node.getBoundingClientRect().width < SQUEEZED_PX
// ⛔ only a toolbar row we know, because this hides what stands beside it: a collapsed dock or panel is never one
const ROOM_ROWS = '[data-guide="chart.drawingTools"]'
function makeRoom(el) {
  for (let p = el; p && p !== document.body; p = p.parentElement) {
    // a row of controls, not one tool the member hid under Customize (a button collapsed to width 0)
    if (!p.matches?.(ROOM_ROWS) || !squeezed(p) || p.childElementCount < 2 || !p.parentElement) continue
    for (const sib of p.parentElement.children) {
      if (sib === p) continue
      slid.push({ node: sib, display: sib.style.display })
      sib.style.display = 'none'
    }
    return
  }
}
/** The control is in the page with a box, whether or not a narrow row is showing it now. */
export function exists(target, ctx) {
  anyBox = true
  try { return !!findTarget(target, ctx) } finally { anyBox = false }
}
/** Slide the clipping row so this target shows → it is now on screen. */
export function unclip(target, ctx) {
  if (typeof document === 'undefined' || findTarget(target, ctx)) return false
  anyBox = true
  let el = null
  try { el = findTarget(target, ctx) } finally { anyBox = false }
  if (!el?.getBoundingClientRect || el.getClientRects?.().length === 0) return false
  makeRoom(el)
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    if (!clips(p)) continue
    const box = p.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const by = r.right > box.right ? r.right - box.right + 6 : r.left < box.left ? r.left - box.left - 6 : 0
    if (by) { slid.push({ node: p, left: p.scrollLeft }); p.scrollLeft += by }
  }
  // below the fold of a long window (the formula box in the builder): bring it up
  if (!findTarget(target, ctx) && !scrolledTo.has(el)) { scrolledTo.add(el); reveal(el) }
  return !!findTarget(target, ctx)
}
/** Put back every row `unclip` slid. */
export function restoreClipped() {
  scrolledTo = new WeakSet()
  for (const { node, left, display } of slid.reverse()) {
    try { if (display != null) node.style.display = display; else node.scrollLeft = left } catch { /* gone */ }
  }
  slid = []
}

/** The open window that sits on top of this control, or null: it is on screen, but the member cannot reach it. */
export function coveredBy(el) {
  if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function' || !el?.getBoundingClientRect) return null
  const r = el.getBoundingClientRect()
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  if (!top || top === el || el.contains(top) || top.contains(el)) return null
  const layer = top.closest?.('[role="dialog"],[aria-modal="true"],[data-guide="chartSettings"]')
  if (!layer || layer.contains(el) || layer.matches?.('[data-testid="guide-card"]')) return null
  return layer
}

/** Is this target found on the chart the walkthrough is about (rather than anywhere on the page)? */
export const chartScoped = (x) => (Array.isArray(x) ? x.some(chartScoped) : typeof x === 'string' ? /^(chart|widget)\./.test(x) : !!x && (x.within === '@chart' || /^chart\./.test(String(x.within || '')) || chartScoped(x.id || '') || (x.not ? chartScoped(x.not) : false)))
/** ⭐ A step on a chart whose result is a window the page cannot tie to a chart (Chart Settings is portalled to the page):
 *  only a press on THIS step's own control counts as done — another chart's gear opening it is not this chart's step (pl-auto) */
export const needsOwnPress = (step) => !!step?.waitFor && chartScoped(step.target) && !chartScoped(step.waitFor)

/** ⭐ STATE AWARENESS. Where a walkthrough starts: the furthest step whose predecessor's RESULT is already true on
 *  screen and whose own control is visible — never "open the gear" with the settings already open. */
export function startIndex(steps, ctx) {
  for (let i = steps.length - 1; i > 0; i--) {
    const prev = steps[i - 1]
    // a result that is something ENDING ({ not: … }) proves nothing before it has begun
    if (prev.waitFor && !prev.waitFor.not && findTarget(prev.waitFor, ctx) && findTarget(steps[i].target, ctx)) return i
  }
  return 0
}

/** The next step from `index` a member can actually be taken to (its control is on screen), or null. */
export function reachableAfter(steps, index, ctx) {
  for (let i = index + 1; i < steps.length; i++) if (findTarget(steps[i].target, ctx) || unclip(steps[i].target, ctx)) return i
  return null
}

/** The nearest step before `index` whose control is on screen, or null. */
export function earlierOnScreen(steps, index, ctx) {
  for (let i = index - 1; i >= 0; i--) if (findTarget(steps[i].target, ctx) || unclip(steps[i].target, ctx)) return i
  return null
}

// the nearest ancestor that clips what overflows it (a toolbar row with overflow: hidden) — the highlight never reaches past
// what the member can see of the control
// ⭐ a position:fixed box (the desktop chart right-click menu) is not clipped by the ancestors above it that only overflow:
// it shows past them, so its ring does too. An ancestor that HOLDS a fixed box (a transform, filter, perspective, contain or
// will-change of those) is its containing block, and from there up the clip applies again.
const holdsFixed = (cs) => (cs.transform && cs.transform !== 'none') || (cs.filter && cs.filter !== 'none') || (cs.perspective && cs.perspective !== 'none')
  || /paint|layout|strict|content/.test(cs.contain || '') || /transform|perspective|filter/.test(cs.willChange || '')
function clipOf(el) {
  let fixed = false
  try { fixed = getComputedStyle(el).position === 'fixed' } catch { fixed = false }
  for (let p = el?.parentElement; p && p !== document.body; p = p.parentElement) {
    let cs = null
    try { cs = getComputedStyle(p) } catch { cs = null }
    if (!cs) continue
    if (fixed && holdsFixed(cs)) fixed = false
    if (!fixed && /hidden|clip/.test(`${cs.overflowX} ${cs.overflow}`)) return p.getBoundingClientRect()
    if (cs.position === 'fixed') fixed = true
  }
  return null
}
/** The rectangle to highlight, in viewport coordinates (with a little room around the control), clipped to what shows. */
export function rectOf(el, pad = 4) {
  if (!el?.getBoundingClientRect) return null
  const r = el.getBoundingClientRect()
  const c = typeof document === 'undefined' ? null : clipOf(el)
  const left = c && c.width > 0 ? Math.max(r.left, c.left) : r.left
  const right = c && c.width > 0 ? Math.min(r.right ?? r.left + r.width, c.right) : (r.right ?? r.left + r.width)
  return { top: r.top - pad, left: left - pad, width: Math.max(0, right - left) + pad * 2, height: r.height + pad * 2 }
}

/** Bring a target that is below the fold into view (never sideways, never a smooth jump that hides it). */
export function reveal(el) {
  try { el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }) } catch { /* not scrollable */ }
}
