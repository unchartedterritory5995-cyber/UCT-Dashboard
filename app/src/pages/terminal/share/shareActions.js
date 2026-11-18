// UCT Terminal: share a panel. THE ACTIONS: copy a picture, download a spreadsheet file, copy
// text. This is the module the Share menu loads.
//
// ⛔ LAZY, AND ONLY EVER LAZY. `PanelShare.jsx` takes it with `import('./shareActions')` the first
// time a member opens a Share menu. Nothing here, and nothing it imports, is on the Terminal's
// first load or in the app's entry chunk (shareChunk.rail.test.js walks the import graph).
//
// ⛔ NOTHING HERE READS THE SERVER. `sharePanel` reads the panel's own DOM at the moment of the
// click (shareRead.js) and that is all it shares.
//
// Reused, not rebuilt: the download and the clipboard write are the app's own
// (components/chart/chartScreenshot.js, which the chart and the Journal already use), the
// colours are the member's theme (lib/theme), and the mark is the one the chart and the Breadth
// Monitor put on their pictures.
import { copyBlobToClipboard, downloadBlob } from '../../../components/chart/chartScreenshot'
import compassSrc from '../../../components/intro/assets/compass-mark.webp'
import { CHROME_INK, SEMANTIC_INK, resolveThemeInks } from '../../../lib/theme'
import { readPanel } from './shareRead'
import { drawShare, imageScale, layoutShare, shareFonts } from './shareImage'
import { BRAND, SITE, shareFileName, shareLines, toCsv, toTsv } from './shareText'

const rowsWord = (n) => `${n} ${n === 1 ? 'row' : 'rows'}`

// ── the mark: loaded once, when a Share menu first opens, so a click can draw it at once ──
let logo = null
let logoAsked = false
/** Start loading what a picture needs. Called when the menu opens; never throws. */
export function warmShare() {
  if (logoAsked || typeof Image === 'undefined') return
  logoAsked = true
  // The picture's faces, asked for now so the click draws in them (a canvas draws in whatever
  // has loaded at that instant and never repaints).
  try { for (const font of Object.values(shareFonts())) document.fonts?.load?.(font)?.catch?.(() => {}) } catch { /* no FontFaceSet */ }
  try {
    const im = new Image()
    im.onload = () => { logo = im }
    im.onerror = () => { logo = null }
    im.src = compassSrc
  } catch { /* the wordmark stands alone */ }
}

const solid = (c) => !!c && c !== 'transparent' && !/^rgba\([^)]*,\s*0\)$/.test(c)

/**
 * The picture's colours, read from the page: the first solid background behind the panel body,
 * the body's own text colour, the header cells' grey and the rows' hairline. Whatever the page
 * does not say comes from the member's theme tokens (lib/theme), never from a colour typed here.
 */
export function readTheme(body, getStyle = (el) => getComputedStyle(el)) {
  const ink = resolveThemeInks({ ...CHROME_INK, gold: SEMANTIC_INK.gold })
  const css = (el) => { try { return el ? getStyle(el) : null } catch { return null } }
  let bg = ''
  for (let n = body; n && n.nodeType === 1 && !bg; n = n.parentElement) {
    const c = css(n)?.backgroundColor
    if (solid(c)) bg = c
  }
  const head = body?.querySelector?.('table thead th, table th')
  const cell = body?.querySelector?.('table tbody td, table td')
  const edge = css(cell)
  const hair = edge && parseFloat(edge.borderBottomWidth) > 0 && solid(edge.borderBottomColor) ? edge.borderBottomColor : ink.border
  return {
    bg: bg || ink.bg,
    text: css(body)?.color || ink.text,
    bright: ink.bright,
    muted: css(head)?.color || ink.muted,
    border: ink.border,
    hair,
    gold: ink.gold,
    family: css(body)?.fontFamily || '',
  }
}

/** A canvas and its 2D context, or null where the browser has none. */
function makeCanvas() {
  try {
    if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '')) return null
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext && canvas.getContext('2d')
    return ctx ? { canvas, ctx } : null
  } catch { return null }
}

/** A drawn canvas as a PNG blob, without waiting: the clipboard must be written inside the click. */
function pngOf(canvas) {
  const url = canvas.toDataURL('image/png')
  const b64 = url.slice(url.indexOf(',') + 1)
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: 'image/png' })
}

/**
 * Draw the panel's rows as a picture. Returns `{ blob, width, height, shown, total }` (bitmap
 * pixels), or null where no canvas can be had.
 */
export function renderShare(read, meta, theme, { now = new Date(), dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1, canvasOf = makeCanvas, toPng = pngOf } = {}) {
  const made = canvasOf()
  if (!made) return null
  const { canvas, ctx } = made
  const fonts = shareFonts(theme.family)
  const measure = (text, font) => { ctx.font = font; return ctx.measureText(String(text)).width }
  const layout = layoutShare(read, shareLines(meta, now), measure, { fonts, brand: BRAND, site: SITE })
  const scale = imageScale(layout.width, layout.height, dpr)
  canvas.width = Math.ceil(layout.width * scale)
  canvas.height = Math.ceil(layout.height * scale)
  drawShare(ctx, layout, theme, { scale, logo })
  return { blob: toPng(canvas), width: canvas.width, height: canvas.height, shown: layout.shown, total: layout.total }
}

const browser = () => ({
  download: downloadBlob,
  copyImage: copyBlobToClipboard,
  copyText: async (text) => {
    try {
      if (!navigator.clipboard?.writeText) return false
      await navigator.clipboard.writeText(text)
      return true
    } catch { return false }
  },
  render: renderShare,
  theme: readTheme,
  now: () => new Date(),
})

/**
 * Share what the panel shows, as `kind`: 'image', 'csv' or 'text'. `body` is the panel's body
 * element, `meta` is `{ code, command, label, sym, report }` from the frame. Resolves to the notice
 * the shell says (and announces): `{ kind: 'info' | 'error', text }`.
 *
 * The picture goes to the clipboard where the browser allows it and is downloaded where it does
 * not, and the notice says which happened.
 */
export async function sharePanel(kind, body, meta, env = {}) {
  const on = { ...browser(), ...env }
  const code = String(meta?.code || 'panel').toUpperCase()
  const now = on.now()
  const read = readPanel(body, env.getStyle ? { getStyle: env.getStyle } : undefined)
  if (!read.rowCount) return { kind: 'info', text: `${code} shows no list to share right now.` }
  const count = rowsWord(read.rowCount)

  if (kind === 'csv') {
    const name = shareFileName(code, 'csv', now, meta?.sym)
    on.download(new Blob([toCsv(read, meta, now)], { type: 'text/csv;charset=utf-8' }), name)
    return { kind: 'info', text: `Downloaded ${name}: ${count}, as shown.` }
  }

  if (kind === 'text') {
    const ok = await on.copyText(toTsv(read, meta, now))
    return ok ? { kind: 'info', text: `Copied ${code} as text: ${count}, as shown. Paste it into a message or a sheet.` }
      : { kind: 'error', text: 'Your browser did not allow the copy, so nothing was copied. Use Download spreadsheet instead.' }
  }

  if (kind === 'image') {
    let made = null
    try { made = on.render(read, meta, on.theme(body), { now }) } catch { made = null }
    if (!made?.blob) return { kind: 'error', text: 'The picture could not be drawn in this browser, so nothing was copied. Use Download spreadsheet instead.' }
    const held = made.total > made.shown ? `the first ${made.shown} of the ${rowsWord(made.total)} on screen` : `${rowsWord(made.shown)}, as shown`
    // No `await` before this call: Safari only lets a picture onto the clipboard inside the click.
    const copied = await on.copyImage(made.blob)
    if (copied) return { kind: 'info', text: `Copied ${code} as an image: ${held}. Paste it into Discord or a message.` }
    const name = shareFileName(code, 'png', now, meta?.sym)
    on.download(made.blob, name)
    return { kind: 'info', text: `Downloaded ${name}: ${held}. Your browser did not allow copying a picture.` }
  }

  return { kind: 'error', text: 'That way of sharing is not available.' }
}
