// Custom Lightweight Charts v5 pane primitive: draws a faint TC2000-style
// stacked symbol watermark BEHIND the series (bottom z-order). Position is a
// normalized {x,y} fraction of the pane; styling/lines come from chart settings.

// Font size is a property of the line's ROLE, not its position. The ticker is the
// big hero line; company/sector/industry/theme are the smaller supporting lines —
// so deselecting the ticker must NOT promote the company name to the hero size.
const ROLE_SIZE = { ticker: 54, company: 20, sector: 14, industry: 13, theme: 13 }
const LINE_GAP = 6                   // px between lines @ scale 1.0
const FONT_FAMILY = "'Instrument Sans', sans-serif"
// Weight is user-configurable (chart settings → Watermark → Weight) so the mark
// can be as thin as TC2000's or as bold as before. Defaults to 700 (the old look).
const makeFont = (fp, weight = 700) => `${weight} ${fp}px ${FONT_FAMILY}`

// Returns [{ text, size }] — size = px @ sizeScale 1.0, fixed per role.
export function composeWatermarkLines(sym, meta, lines, intervalLabel = null) {
  const out = []
  if (lines.ticker && sym) {
    // "Interval" field (default ON) appends ", <timeframe>" to the ticker line
    // (e.g. "ARM, 1D"); off only when explicitly disabled.
    const showInterval = lines.interval !== false
    const t = (showInterval && intervalLabel) ? `${sym}, ${intervalLabel}` : String(sym)
    out.push({ text: t, size: ROLE_SIZE.ticker })
  }
  if (lines.company && meta?.name) out.push({ text: meta.name, size: ROLE_SIZE.company })
  if (lines.sector && meta?.sector) out.push({ text: meta.sector, size: ROLE_SIZE.sector })
  if (lines.industry && meta?.industry) out.push({ text: meta.industry, size: ROLE_SIZE.industry })
  if (lines.theme && meta?.theme) out.push({ text: meta.theme, size: ROLE_SIZE.theme })
  return out
}

export function watermarkFontPx(line, sizeScale) {
  const base = typeof line === 'object' ? (line?.size ?? 13) : ROLE_SIZE.company
  return Math.round(base * (sizeScale || 1))
}

// Keep a small gutter so a wide watermark (long company name) never sits flush
// against the pane's left/right edge — for blocks wider than the pane the left
// gutter wins, so the name reads from a consistent left inset.
const EDGE_PAD = 14

// padX = left/right gutter (default 14); padTop = top gutter (default 0, i.e.
// flush to the pane top). Callers can raise padTop to match padX for an even
// top-left corner inset (Setup Library).
//
// hardCenterXPx (px from the pane's left edge, nullable): when set, the block's
// horizontal CENTRE is pinned to this ABSOLUTE offset and is NOT edge-clamped.
// An absolute offset (not a fraction) keeps the watermark tucked the same fixed
// distance from the top-left corner no matter how wide the pane is — a fraction
// drifts toward the middle on a wide pane. It also keeps every ticker's centre
// in the identical spot regardless of the widest line's width (long company /
// industry names), so the mark doesn't appear to move as you scroll tickers.
// The edge-clamped `padX` path (default) instead keeps a fixed gutter and lets
// the centre move with width.
// NOTE: `align` does NOT affect placement — it only justifies the TEXT within the
// block (see the draw). The block position is the same regardless of alignment.
export function computeWatermarkRect(pos, mediaSize, block, padX = EDGE_PAD, padTop = 0, hardCenterXPx = null, custom = false) {
  const cy = pos.y * mediaSize.height
  let y = cy - block.h / 2
  y = Math.max(padTop, Math.min(y, mediaSize.height - block.h))
  let x
  if (custom) {
    // Free drag / saved per-chart position: pos.x is the block CENTRE fraction.
    const cx = pos.x * mediaSize.width
    x = cx - block.w / 2
    x = Math.max(padX, Math.min(x, mediaSize.width - block.w - padX))
  } else if (hardCenterXPx != null) {
    // Exact centre — no horizontal clamp, so the centre never shifts by width.
    x = hardCenterXPx - block.w / 2
  } else {
    const cx = pos.x * mediaSize.width
    x = cx - block.w / 2
    x = Math.max(padX, Math.min(x, mediaSize.width - block.w - padX))
  }
  return { x, y, w: block.w, h: block.h }
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#a8a290')
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [168, 162, 144]
}

// Factory → { primitive, setOptions, setArmed, getRect }.
// opts: { lines:string[], color, opacity, sizeScale, x, y }
export function createWatermarkPrimitive(initial) {
  let opts = { lines: [], color: '#a8a290', opacity: 0.07, sizeScale: 1, weight: 700, x: 0.5, y: 0.5, padX: EDGE_PAD, padTop: 0, hardCenterXPx: null, align: 'center', custom: false, ...initial }
  let lastRect = null            // {x,y,w,h} in pane media px from last draw
  let lastMediaSize = null       // {width,height} of pane 0 in CSS px from last draw
  let armed = false              // hover/drag highlight
  let requestUpdate = null

  function measureBlock(ctx) {
    let w = 0
    let h = 0
    opts.lines.forEach((line, i) => {
      const fp = watermarkFontPx(line, opts.sizeScale)
      ctx.font = makeFont(fp, opts.weight)
      w = Math.max(w, ctx.measureText(line.text).width)
      h += fp + (i > 0 ? LINE_GAP * (opts.sizeScale || 1) : 0)
    })
    return { w, h }
  }

  const paneView = {
    zOrder: () => 'bottom',
    renderer: () => ({
      draw: (target) => {
        if (!opts.lines.length || opts.opacity <= 0) { lastRect = null; return }
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          const block = measureBlock(ctx)
          const align = opts.align || 'center'
          const rect = computeWatermarkRect({ x: opts.x, y: opts.y }, mediaSize, block, opts.padX, opts.padTop, opts.hardCenterXPx, opts.custom)
          lastRect = rect
          lastMediaSize = { width: mediaSize.width, height: mediaSize.height }
          const [r, g, b] = hexToRgb(opts.color)
          const alpha = armed ? Math.min(1, opts.opacity * 2.4) : opts.opacity
          // Text justifies to the aligned edge so a shorter line lines up with it.
          const tx = align === 'left' ? rect.x : align === 'right' ? rect.x + rect.w : rect.x + rect.w / 2
          ctx.save()
          ctx.textAlign = align
          ctx.textBaseline = 'top'
          ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`
          let cy = rect.y
          opts.lines.forEach((line, i) => {
            const fp = watermarkFontPx(line, opts.sizeScale)
            if (i > 0) cy += LINE_GAP * (opts.sizeScale || 1)
            ctx.font = makeFont(fp, opts.weight)
            ctx.fillText(line.text, tx, cy)
            cy += fp
          })
          if (armed) {
            ctx.strokeStyle = 'rgba(201,168,76,0.9)'
            ctx.setLineDash([4, 3])
            ctx.lineWidth = 1
            ctx.strokeRect(rect.x - 8, rect.y - 6, rect.w + 16, rect.h + 12)
          }
          ctx.restore()
        })
      },
    }),
  }

  const primitive = {
    paneViews: () => [paneView],
    updateAllViews: () => {},
    attached: (param) => { requestUpdate = param.requestUpdate },
    detached: () => { requestUpdate = null },
  }

  function redraw() { if (requestUpdate) requestUpdate() }

  return {
    primitive,
    setOptions(patch) { opts = { ...opts, ...patch }; redraw() },
    setArmed(v) { if (armed !== v) { armed = v; redraw() } },
    getRect() {
      if (!opts.lines.length || opts.opacity <= 0) return null
      return lastRect
    },
    // Pane 0's media size (CSS px) from the last draw — the coordinate space the
    // x/y fractions are resolved against. The drag MUST normalize to this (not the
    // container), else a smaller price pane scales the mark up-and-left off-cursor.
    getMediaSize() { return lastMediaSize },
  }
}
