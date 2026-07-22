// Lightweight Charts v5 SERIES primitive: a ROUNDED last-value tag drawn in the
// price-axis strip, replacing the native (always square-cornered) last-value label.
//
// Why a primitive: LWC v5 has no border-radius option for axis labels, and the
// volume series (an overlay) renders its native tag a different size + flush to the
// pane edge vs the price series' tag. Drawing our own via `priceAxisPaneViews()`
// lets us give BOTH the price and volume tags identical sizing (same fontPx +
// padding), a right-edge INSET so neither runs flush to the edge, and smooth
// rounded corners. Whichever series this is attached to MUST set
// `lastValueVisible:false` or you'll get two overlapping tags.
//
// The tag tracks the fed value live: StockChart calls setOptions({value,color})
// wherever it updates the series (data load + every tick), and requestUpdate()
// repaints the axis. Text is formatted with the series' own priceFormatter so it
// matches exactly ("749.19" for price, "1.58M" for volume).

const FONT_FAMILY = "'Instrument Sans', sans-serif"

// Contrast glyph color from a hex background (matches LWC's auto black/white pick).
// Non-hex (rgba/named) falls back to white, which reads on the up/down palette.
function contrastText(bg) {
  const m = /^#?([0-9a-f]{6})$/i.exec((bg || '').trim())
  if (!m) return '#ffffff'
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  // Rec. 601 luma; bright fills (e.g. #1ae51a) get a near-black glyph.
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#0c0c0e' : '#ffffff'
}

// opts: { enabled, value, color, textColor('auto'|hex), fontPx, padX, padY, inset, radius }
export function createLastValueLabelPrimitive(initial) {
  let opts = {
    enabled: true,
    value: null,          // number (price or volume); null = draw nothing
    color: '#1ae51a',     // pill fill — the series' current up/down color
    textColor: 'auto',    // 'auto' = contrast from `color`
    fontPx: 11,
    padX: 7,
    padY: 3,
    inset: 4,             // px gap from the pane's right edge
    radius: 4,
    ...initial,
  }
  let series = null
  let requestUpdate = null

  // Live value: prefer a fed value (opts.value), else read the series' last data
  // point so the tag tracks the developing bar every frame with no per-tick feeding.
  function currentValue() {
    if (opts.value != null) return opts.value
    try {
      const d = series.data()
      const p = d && d.length ? d[d.length - 1] : null
      if (!p) return null
      if (typeof p.close === 'number') return p.close
      if (typeof p.value === 'number') return p.value
    } catch { /* older LWC / disposed */ }
    return null
  }

  const paneView = {
    zOrder: () => 'top',
    renderer: () => ({
      draw: (target) => {
        if (!opts.enabled || !series) return
        const value = currentValue()
        if (value == null) return
        let y
        try { y = series.priceToCoordinate(value) } catch { return }
        if (y == null) return
        let text
        try { text = series.priceFormatter().format(value) } catch { text = String(value) }
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          ctx.save()
          ctx.font = `600 ${opts.fontPx}px ${FONT_FAMILY}`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          const w = Math.ceil(ctx.measureText(text).width + opts.padX * 2)
          const h = opts.fontPx + opts.padY * 2
          const r = Math.min(opts.radius, h / 2)
          const x = Math.max(1, mediaSize.width - opts.inset - w)  // right-aligned, inset
          const top = Math.max(1, Math.min(y - h / 2, mediaSize.height - h - 1))
          ctx.fillStyle = opts.color
          ctx.beginPath()
          if (typeof ctx.roundRect === 'function') ctx.roundRect(x, top, w, h, r)
          else ctx.rect(x, top, w, h)
          ctx.fill()
          ctx.fillStyle = opts.textColor === 'auto' ? contrastText(opts.color) : opts.textColor
          ctx.fillText(text, x + w / 2, top + h / 2 + 0.5)
          ctx.restore()
        })
      },
    }),
  }

  const primitive = {
    priceAxisPaneViews: () => [paneView],
    updateAllViews: () => {},
    attached: (p) => { series = p.series; requestUpdate = p.requestUpdate },
    detached: () => { series = null; requestUpdate = null },
  }

  return {
    primitive,
    setOptions(patch) {
      opts = { ...opts, ...patch }
      if (requestUpdate) requestUpdate()
    },
  }
}
