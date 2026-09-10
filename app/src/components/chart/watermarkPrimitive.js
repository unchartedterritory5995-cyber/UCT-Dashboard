// Custom Lightweight Charts v5 pane primitive: draws a faint TC2000-style
// stacked symbol watermark BEHIND the series (bottom z-order). Position is a
// normalized {x,y} fraction of the pane; styling/lines come from chart settings.

// Font size is a property of the line's ROLE, not its position. The ticker is the
// big hero line; company/sector/industry/theme are the smaller supporting lines —
// so deselecting the ticker must NOT promote the company name to the hero size.
const ROLE_SIZE = { ticker: 54, company: 20, sector: 14, industry: 13, theme: 13 }
// Rows each enabled ROLE reserves in the layout box, whether or not the current
// ticker has that field. The company name gets two so a long one wraps instead of
// widening the mark. See reservedBlock().
const ROLE_ROWS = { ticker: 1, company: 2, sector: 1, industry: 1, theme: 1 }
const ROLE_ORDER = ['ticker', 'company', 'sector', 'industry', 'theme']
const LINE_GAP = 6                   // px between lines @ scale 1.0
const FONT_FAMILY = "'Instrument Sans', sans-serif"
// Weight is user-configurable (chart settings → Watermark → Weight) so the mark
// can be as thin as TC2000's or as bold as before. Defaults to 700 (the old look).
const makeFont = (fp, weight = 700) => `${weight} ${fp}px ${FONT_FAMILY}`

// ── The layout BOX ───────────────────────────────────────────────────────────
// The watermark occupies a fixed-size box whose size depends only on the enabled
// FIELDS + the size scale — never on how long this ticker's company name is or on
// how many fields it happens to have data for. That is what keeps the mark
// visually PUT when you switch symbols: place it once on DIA and MU lands in the
// identical spot, instead of every line's left edge sliding with the widest string
// and the top edge creeping up under the legend as the stack gets taller.
//
// Content is laid out from the box's TOP downward and justified per `align` inside
// it; long lines wrap into it. Nothing is drawn outside the box.
export const WM_BOX_WIDTHS = [[280, 'Narrow'], [380, 'Medium'], [480, 'Wide'], [600, 'Extra wide']]
// Not a CHART_DEFAULTS key on purpose: `align` lives the same way (read with a
// fallback), and adding a key to the defaults tree moves the merged-blob digests
// the engine guards. Settings → Watermark → Width writes `watermark.boxW`.
export const DEFAULT_BOX_W = 380     // px @ sizeScale 1.0

// Returns [{ text, size, role }] — size = px @ sizeScale 1.0, fixed per role.
export function composeWatermarkLines(sym, meta, lines, intervalLabel = null) {
  const out = []
  if (lines.ticker && sym) {
    // "Interval" field (default ON) appends ", <timeframe>" to the ticker line
    // (e.g. "ARM, 1D"); off only when explicitly disabled.
    const showInterval = lines.interval !== false
    const t = (showInterval && intervalLabel) ? `${sym}, ${intervalLabel}` : String(sym)
    out.push({ text: t, size: ROLE_SIZE.ticker, role: 'ticker' })
  }
  if (lines.company && meta?.name) out.push({ text: meta.name, size: ROLE_SIZE.company, role: 'company' })
  if (lines.sector && meta?.sector) out.push({ text: meta.sector, size: ROLE_SIZE.sector, role: 'sector' })
  if (lines.industry && meta?.industry) out.push({ text: meta.industry, size: ROLE_SIZE.industry, role: 'industry' })
  if (lines.theme && meta?.theme) out.push({ text: meta.theme, size: ROLE_SIZE.theme, role: 'theme' })
  return out
}

export function watermarkFontPx(line, sizeScale) {
  const base = typeof line === 'object' ? (line?.size ?? 13) : ROLE_SIZE.company
  return Math.round(base * (sizeScale || 1))
}

// Height (px) of the box for the enabled `fields` at this size scale. Every
// enabled field reserves its rows even when THIS ticker has no value for it (DIA
// has no sector/industry), so line 1's top edge lands at the same y on every
// symbol. Returns 0 when fields are unknown — the caller then falls back to the
// measured content height (legacy behaviour).
export function reservedBlock(fields, sizeScale) {
  if (!fields) return 0
  const scale = sizeScale || 1
  let h = 0
  let rows = 0
  // `logo`/`interval` are modifiers on the ticker line, not rows of their own.
  ROLE_ORDER.forEach((role) => {
    if (!fields[role]) return
    const fp = Math.round(ROLE_SIZE[role] * scale)
    for (let i = 0; i < ROLE_ROWS[role]; i += 1) { h += fp; rows += 1 }
  })
  return rows ? h + (rows - 1) * LINE_GAP * scale : 0
}

// Keep a small gutter so a wide watermark never sits flush against the pane's
// left/right edge — for boxes wider than the pane the left gutter wins, so the
// mark reads from a consistent left inset.
const EDGE_PAD = 14

// padX = left/right gutter (default 14); padTop = top gutter (default 0, i.e.
// flush to the pane top). Callers can raise padTop to match padX for an even
// top-left corner inset (Setup Library).
//
// `pos` is the box's CENTRE as a pane fraction — and because the box is a fixed
// size per settings (not per ticker), that centre now pins all four of its edges.
//
// hardCenterXPx (px from the pane's left edge, nullable): when set, the box's
// horizontal CENTRE is pinned to this ABSOLUTE offset and is NOT edge-clamped.
// An absolute offset (not a fraction) keeps the watermark tucked the same fixed
// distance from the top-left corner no matter how wide the pane is — a fraction
// drifts toward the middle on a wide pane.
// The edge-clamped `padX` path (default) instead keeps a fixed gutter.
// NOTE: `align` does NOT affect placement — it only justifies the TEXT within the
// box (see the draw). The box position is the same regardless of alignment.
export function computeWatermarkRect(pos, mediaSize, block, padX = EDGE_PAD, padTop = 0, hardCenterXPx = null, custom = false) {
  let x
  let y = pos.y * mediaSize.height - block.h / 2
  if (custom) {
    // A HAND-PLACED mark is free on both axes: no edge clamp at all, so the box
    // can hang as far off any edge as it was dragged. (The auto-drift this used to
    // guard against is gone — the box is a fixed size now, so it only moves when
    // the owner moves it.) Settings → Watermark → Reset to center recovers one
    // dragged out of sight.
    x = pos.x * mediaSize.width - block.w / 2
  } else if (hardCenterXPx != null) {
    // Exact centre — no horizontal clamp, so the centre never shifts by width.
    x = hardCenterXPx - block.w / 2
    y = Math.max(padTop, Math.min(y, mediaSize.height - block.h))
  } else {
    // Default placement from the plain fraction — kept inside the pane.
    x = pos.x * mediaSize.width - block.w / 2
    x = Math.max(padX, Math.min(x, mediaSize.width - block.w - padX))
    y = Math.max(padTop, Math.min(y, mediaSize.height - block.h))
  }
  return { x, y, w: block.w, h: block.h }
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#a8a290')
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [168, 162, 144]
}

// Greedy word-wrap into at most `maxRows` rows of `maxW` px; the last row is
// ellipsized when the text still doesn't fit. `ctx.font` must already be set.
// A single word wider than the row is left intact — breaking mid-word reads worse
// than one over-wide line, and the box grows to contain it.
export function wrapToRows(ctx, text, maxW, maxRows) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const rows = []
  let cur = words[0]
  for (let i = 1; i < words.length; i += 1) {
    const test = `${cur} ${words[i]}`
    if (ctx.measureText(test).width <= maxW) cur = test
    else { rows.push(cur); cur = words[i] }
  }
  rows.push(cur)
  if (rows.length <= maxRows) return rows
  const kept = rows.slice(0, maxRows)
  let last = `${kept[maxRows - 1]}…`
  while (last.length > 1 && ctx.measureText(last).width > maxW) last = `${last.slice(0, -2)}…`
  kept[maxRows - 1] = last
  return kept
}

// Factory → { primitive, setOptions, setArmed, getRect }.
// opts: { lines:[{text,size,role}], fields, boxW, color, opacity, sizeScale, x, y }
export function createWatermarkPrimitive(initial) {
  let opts = { lines: [], fields: null, boxW: DEFAULT_BOX_W, color: '#a8a290', opacity: 0.07, sizeScale: 1, weight: 700, x: 0.5, y: 0.5, padX: EDGE_PAD, padTop: 0, hardCenterXPx: null, align: 'center', custom: false, logoEnabled: false, logoImg: null, logoScale: 1, ...initial }
  let lastRect = null            // {x,y,w,h} in pane media px from last draw
  let lastMediaSize = null       // {width,height} of pane 0 in CSS px from last draw
  let armed = false              // hover/drag highlight
  let requestUpdate = null

  // Badge geometry for the first line, sized + vertically centred on the CAP
  // LETTERS (not the full line box, which reserves descender space for the comma).
  // `ctx.font` must already be the first line's font. Falls back for canvas stubs
  // (jsdom) that don't return glyph-bounding metrics.
  function logoMetrics(ctx, fp) {
    const prevBaseline = ctx.textBaseline
    // Reference cap 'M' (no descender). With textBaseline='top' (how the text is
    // drawn), its bounding-box descent is exactly cy → baseline; with 'alphabetic'
    // its ascent is the cap height. jsdom returns no glyph metrics → fallbacks.
    ctx.textBaseline = 'top'
    const baselineFromTop = ctx.measureText('M').actualBoundingBoxDescent || fp * 0.78
    ctx.textBaseline = 'alphabetic'
    const capH = ctx.measureText('M').actualBoundingBoxAscent || fp * 0.72
    ctx.textBaseline = prevBaseline
    // cy → the vertical MIDDLE of the uppercase letters.
    const capCenterOffset = baselineFromTop - capH / 2
    const dia = capH * 1.12                                 // badge ≈ the cap height
    const advance = dia + fp * 0.22                         // badge width + gap before the text
    return { capCenterOffset, dia, advance }
  }

  // → { w, h, rows:[{ text, fp, w, logo }] }. w/h are the BOX (fixed per settings,
  // grown only when an unwrappable line overflows it); `rows` is the text actually
  // painted, top-aligned inside that box.
  function layout(ctx, mediaSize) {
    const scale = opts.sizeScale || 1
    const pad = opts.padX ?? EDGE_PAD
    const paneW = mediaSize?.width || 0
    // The box never exceeds the pane — a narrow widget wraps harder instead of
    // spilling the mark off both edges. A hand-placed mark is exempt: its whole
    // point may be to hang off an edge, and a pane-derived width would also make
    // the box (hence its fixed edges) resize with the widget.
    let boxW = (opts.boxW || DEFAULT_BOX_W) * scale
    if (paneW > 0 && !opts.custom) boxW = Math.max(80, Math.min(boxW, paneW - pad * 2))
    const rows = []
    let contentW = 0
    let contentH = 0
    opts.lines.forEach((line, i) => {
      const fp = watermarkFontPx(line, scale)
      ctx.font = makeFont(fp, opts.weight)
      // A logo badge prefixes the FIRST line and eats into that row's text width.
      const advance = (i === 0 && opts.logoEnabled) ? logoMetrics(ctx, fp).advance : 0
      const role = line.role || (i === 0 ? 'ticker' : 'company')
      // The ticker is the hero line — never wrapped, never truncated; the box grows
      // for it instead. Everything else wraps into the box.
      const texts = role === 'ticker'
        ? [line.text]
        : wrapToRows(ctx, line.text, Math.max(20, boxW - advance), ROLE_ROWS[role] ?? 1)
      texts.forEach((text, k) => {
        const w = ctx.measureText(text).width + (k === 0 ? advance : 0)
        if (rows.length) contentH += LINE_GAP * scale
        rows.push({ text, fp, w, logo: i === 0 && k === 0 && opts.logoEnabled })
        contentH += fp
        contentW = Math.max(contentW, w)
      })
    })
    return {
      w: Math.max(boxW, contentW),
      h: Math.max(reservedBlock(opts.fields, scale), contentH),
      rows,
    }
  }

  const paneView = {
    zOrder: () => 'bottom',
    renderer: () => ({
      draw: (target) => {
        if (!opts.lines.length || opts.opacity <= 0) { lastRect = null; return }
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          const block = layout(ctx, mediaSize)
          const align = opts.align || 'center'
          const rect = computeWatermarkRect({ x: opts.x, y: opts.y }, mediaSize, block, opts.padX, opts.padTop, opts.hardCenterXPx, opts.custom)
          lastRect = rect
          lastMediaSize = { width: mediaSize.width, height: mediaSize.height }
          const [r, g, b] = hexToRgb(opts.color)
          const alpha = armed ? Math.min(1, opts.opacity * 2.4) : opts.opacity
          ctx.save()
          // Each row's left x is computed explicitly (textAlign left) so a logo can
          // prefix the first line and every row still justifies per `align`.
          ctx.textAlign = 'left'
          ctx.textBaseline = 'top'
          ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`
          // Content hangs from the box's TOP — the reserve below it is empty space,
          // so line 1 sits at the same y whether or not this ticker has a sector.
          let cy = rect.y
          block.rows.forEach((row, i) => {
            const fp = row.fp
            if (i > 0) cy += LINE_GAP * (opts.sizeScale || 1)
            ctx.font = makeFont(fp, opts.weight)
            const lineLeft = align === 'left' ? rect.x
              : align === 'right' ? rect.x + rect.w - row.w
                : rect.x + (rect.w - row.w) / 2
            if (row.logo) {
              // A circular badge (like the header logo), sized + centred on the CAP
              // LETTERS so it aligns with the ticker text rather than the taller line
              // box. The circle always shows — even for a ticker with no logo image.
              const lm = logoMetrics(ctx, fp)
              const rad = lm.dia / 2
              const ccx = lineLeft + rad
              const ccy = cy + lm.capCenterOffset        // middle of the caps
              ctx.beginPath()
              ctx.arc(ccx, ccy, rad, 0, Math.PI * 2)
              ctx.fill()                    // fillStyle is already the watermark colour+alpha
              if (opts.logoImg) {
                // Draw the (square) logo at the FULL circle size, clipped to the
                // circle — the brand background fills the badge so it reads as a
                // round logo (not a small square on a grey disc). The circle is
                // inscribed in the square, so an opaque logo covers the grey entirely.
                ctx.save()
                ctx.beginPath(); ctx.arc(ccx, ccy, rad, 0, Math.PI * 2); ctx.clip()
                ctx.globalAlpha = alpha     // the image honours the watermark opacity
                // logoScale > 1 fills the circle for a mark with transparent margins
                // (the UCT compass); it's clipped to the circle either way.
                const isz = lm.dia * (opts.logoScale || 1)
                try { ctx.drawImage(opts.logoImg, ccx - isz / 2, ccy - isz / 2, isz, isz) } catch { /* broken/tainted */ }
                ctx.restore()               // restores globalAlpha + clip
              }
              ctx.fillText(row.text, lineLeft + lm.advance, cy)
            } else {
              ctx.fillText(row.text, lineLeft, cy)
            }
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
