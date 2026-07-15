// Custom Lightweight Charts v5 pane primitive: draws a faint TC2000-style
// stacked symbol watermark BEHIND the series (bottom z-order). Position is a
// normalized {x,y} fraction of the pane; styling/lines come from chart settings.

const FONT_RAMP = [54, 20, 14, 13]   // px @ sizeScale 1.0, per line index
const LINE_GAP = 6                   // px between lines @ scale 1.0
const FONT_FAMILY = "'Instrument Sans', sans-serif"
const makeFont = fp => `700 ${fp}px ${FONT_FAMILY}`

export function composeWatermarkLines(sym, meta, lines) {
  const out = []
  if (lines.ticker && sym) out.push(String(sym))
  if (lines.company && meta?.name) out.push(meta.name)
  if (lines.sector && meta?.sector) out.push(meta.sector)
  if (lines.industry && meta?.industry) out.push(meta.industry)
  if (lines.theme && meta?.theme) out.push(meta.theme)
  return out
}

export function watermarkFontPx(lineIndex, sizeScale) {
  const base = FONT_RAMP[Math.min(lineIndex, FONT_RAMP.length - 1)]
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
export function computeWatermarkRect(pos, mediaSize, block, padX = EDGE_PAD, padTop = 0, hardCenterXPx = null) {
  const cy = pos.y * mediaSize.height
  let y = cy - block.h / 2
  y = Math.max(padTop, Math.min(y, mediaSize.height - block.h))
  let x
  if (hardCenterXPx != null) {
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
  let opts = { lines: [], color: '#a8a290', opacity: 0.07, sizeScale: 1, x: 0.5, y: 0.5, padX: EDGE_PAD, padTop: 0, hardCenterXPx: null, ...initial }
  let lastRect = null            // {x,y,w,h} in pane media px from last draw
  let armed = false              // hover/drag highlight
  let requestUpdate = null

  function measureBlock(ctx) {
    let w = 0
    let h = 0
    opts.lines.forEach((text, i) => {
      const fp = watermarkFontPx(i, opts.sizeScale)
      ctx.font = makeFont(fp)
      w = Math.max(w, ctx.measureText(text).width)
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
          const rect = computeWatermarkRect({ x: opts.x, y: opts.y }, mediaSize, block, opts.padX, opts.padTop, opts.hardCenterXPx)
          lastRect = rect
          const [r, g, b] = hexToRgb(opts.color)
          const alpha = armed ? Math.min(1, opts.opacity * 2.4) : opts.opacity
          ctx.save()
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`
          let cy = rect.y
          opts.lines.forEach((text, i) => {
            const fp = watermarkFontPx(i, opts.sizeScale)
            if (i > 0) cy += LINE_GAP * (opts.sizeScale || 1)
            ctx.font = makeFont(fp)
            ctx.fillText(text, rect.x + rect.w / 2, cy)
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
  }
}
