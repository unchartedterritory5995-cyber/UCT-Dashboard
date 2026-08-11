// TICKER-POPUP-BURIES-THE-CHART-CHAIN — the stacking rail (companion to
// voice/FloatingOrb.zorder.test.js's ORB-EATS-THE-CHART-MENU rail; read that
// one first, this mirrors its pattern).
//
// Raising TickerPopup's overlay above the floating video host (8500, to fix
// the Desk-recording chart-under-video bug) nearly buried two things that are
// DESIGNED to render on top of it: ChartContextMenu (the global right-click
// menu GlobalAddPositionProvider mounts once at the app root, App.jsx:233 —
// reachable from every StockChart's `uct:chart-contextmenu` event, including
// the chart inside TickerPopup's own modal) and ModalShell's backdrop
// (AddPositionModal / PortfolioSettingsModal — both documented as "stacks
// above TickerPopup's overlay"). This rail pins the whole chain so raising
// TickerPopup again can't silently re-bury them.
//
// WHY THIS TEST READS FILES INSTEAD OF RENDERING: jsdom does no layout and CSS
// modules are not applied, so a render test cannot see a stacking order. The
// declarations ARE the artifact under test.
//
// DERIVED, NEVER RETYPED: every number below is parsed out of the real CSS.
// Retyping a literal here would make this file a second authority over the
// values it exists to guard — and it would keep passing after someone moved
// one of them.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '..') // app/src/components -> app/src

const read = (rel) => readFileSync(resolve(SRC, rel), 'utf8')

/** Strip `/* ... *\/` comments — several of the comments this rail's own fix
 * added quote a target literal like "z-index: 8500)" in prose, which would
 * otherwise out-match the real declaration below it. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** The `z-index` declaration of `selector` in `rel`, as written (first hit
 * OUTSIDE a comment). */
function rawZIndex(rel, selector) {
  const css = read(rel)
  const at = css.indexOf(selector)
  if (at < 0) return null
  const open = css.indexOf('{', at)
  const close = css.indexOf('}', open)
  if (open < 0 || close < 0) return null
  const block = stripComments(css.slice(open + 1, close))
  const m = block.match(/z-index\s*:\s*([^;]+);/)
  return m ? m[1].trim() : null
}

/** Resolve a literal z-index (this rail only deals in literals, not tokens). */
function resolveZ(raw) {
  if (raw == null) return null
  const lit = raw.match(/^-?[0-9]+$/)
  return lit ? Number(raw) : null
}

const VIDEO_HOST_RAW = rawZIndex('components/video/GlobalVideoLayer.module.css', '.host')
const POPUP_OVERLAY_RAW = rawZIndex('components/TickerPopup.module.css', '.overlay')
const CTX_MENU_RAW = rawZIndex('components/chart/ChartContextMenu.module.css', '.menu')
const MODAL_SHELL_RAW = rawZIndex('pages/journal-2-0/components/ModalShell.module.css', '.backdrop')
const PORTFOLIO_MODAL_RAW = rawZIndex('pages/journal-2-0/components/PortfolioSettingsModal.module.css', '.backdrop')

const videoHost = resolveZ(VIDEO_HOST_RAW)
const popupOverlay = resolveZ(POPUP_OVERLAY_RAW)
const ctxMenu = resolveZ(CTX_MENU_RAW)
const modalShell = resolveZ(MODAL_SHELL_RAW)
const portfolioModal = resolveZ(PORTFOLIO_MODAL_RAW)

describe('CONTROL — the probes actually resolved something', () => {
  // Without this, every ordering assertion below could pass on `null < null`
  // being false-y nonsense, or on a selector that stopped matching.
  test('every z-index declaration was found and resolved to a number', () => {
    expect(VIDEO_HOST_RAW, 'GlobalVideoLayer .host has no z-index').not.toBeNull()
    expect(POPUP_OVERLAY_RAW, 'TickerPopup .overlay has no z-index').not.toBeNull()
    expect(CTX_MENU_RAW, 'ChartContextMenu .menu has no z-index').not.toBeNull()
    expect(MODAL_SHELL_RAW, 'ModalShell .backdrop has no z-index').not.toBeNull()
    expect(PORTFOLIO_MODAL_RAW, 'PortfolioSettingsModal .backdrop has no z-index').not.toBeNull()
    expect(videoHost, `unresolvable: ${VIDEO_HOST_RAW}`).toEqual(expect.any(Number))
    expect(popupOverlay, `unresolvable: ${POPUP_OVERLAY_RAW}`).toEqual(expect.any(Number))
    expect(ctxMenu, `unresolvable: ${CTX_MENU_RAW}`).toEqual(expect.any(Number))
    expect(modalShell, `unresolvable: ${MODAL_SHELL_RAW}`).toEqual(expect.any(Number))
    expect(portfolioModal, `unresolvable: ${PORTFOLIO_MODAL_RAW}`).toEqual(expect.any(Number))
  })
})

describe('the from-popup chain stacks in the order a user opens it', () => {
  test('video host < TickerPopup overlay — a chart opened from a Desk recording renders over the still-playing video', () => {
    expect(videoHost).toBeLessThan(popupOverlay)
  })

  test('TickerPopup overlay < ChartContextMenu — right-click on the popup\'s own chart must not be buried under the popup\'s full-viewport click-catcher', () => {
    expect(popupOverlay).toBeLessThan(ctxMenu)
  })

  test('ChartContextMenu < ModalShell backdrop — "+ Add to Portfolio" opens a real, clickable modal above everything that led to it', () => {
    expect(ctxMenu).toBeLessThan(modalShell)
  })

  test('PortfolioSettingsModal matches ModalShell\'s rung (its comment documents the same contract)', () => {
    expect(portfolioModal).toBe(modalShell)
  })
})
