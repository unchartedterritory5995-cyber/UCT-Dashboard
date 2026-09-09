/* The shape of a stored drawing — one read-path funnel, one defaults table.
 *
 * ─── WHAT A DRAWING IS ──────────────────────────────────────────────────────
 *
 *   { id, type, points[], color, lineWidth, lineStyle, locked?, hidden?, ...typeExtras }
 *
 *   point = { time,          DISPLAY epoch: 'YYYY-MM-DD' on D/W/M, ET-shifted
 *                            epoch seconds intraday. NOT true UTC.
 *             price,         candle price scale
 *             futureBars?,   whole bars past the last candle (cap 500)
 *             paneRelY? }    fraction of TOTAL canvas height, for points below
 *                            the price pane
 *
 * These objects are written to FOUR places, and until now none of them carried a
 * version: `localStorage['uct-chart-drawings']` (the active Tracings sheet), the
 * Tracings doc `archive` (every other sheet), the server preference
 * `tracings_doc`, and Model Book's per-example `drawings_json`. Every renderer
 * did its own inline `d.foo || fallback`, so "what is the default for X" had as
 * many answers as it had call sites.
 *
 * ─── THE THREE RULES THIS MODULE EXISTS TO ENFORCE ──────────────────────────
 *
 * ⛔ 1. NORMALISATION NEVER TOUCHES `points`.
 *    `useBoundDrawingAlerts` hashes each line's anchors into a
 *    `geometrySignature` and PATCHes the server the moment it changes. A
 *    normalisation that rewrote, rounded, or even re-ordered a point would fire
 *    one server write per bound alert per user on page load — a PATCH storm off
 *    a chart nobody touched. `drawingSchema.test.js` asserts the signature is
 *    byte-identical across normalisation for every alert-carrying type.
 *
 * ⛔ 2. NORMALISATION NEVER WRITES, AND NEVER BUMPS A CHANGE COUNTER.
 *    It runs at the store's READ boundary and produces in-memory objects. A
 *    drawing acquires `sv` on disk only when a real user edit causes the array
 *    to be persisted anyway. The tracings sync layer debounces a push on
 *    `_changeSeq`, so a normalisation that bumped it would make every user push
 *    their whole drawing library to the server on first load.
 *
 * ⛔ 3. PHASE 0 DEFAULTS REPRODUCE TODAY'S RENDER, EXACTLY.
 *    Every value in `DRAWING_DEFAULTS` is the constant the shipped code already
 *    used inline. Nothing new becomes visible; the table just gives the value a
 *    single home so Phase 1+ can change it in one place.
 *
 * ─── ⚠️ A DELIBERATE DEVIATION FROM THE APPROVED PLAN, AND WHY ──────────────
 *
 * The plan said `normalizeDrawing` would MATERIALISE every forward-looking
 * default onto the object (`showPriceLabel: false`, `fillColor: null`, …).
 * Building it that way turned out to defeat the very thing `sv` was introduced
 * for, so it does not:
 *
 *   • ABSENCE IS INFORMATION. `sv` exists so we can tell "this user never had
 *     the property" from "this user set it to false" — that distinction is the
 *     whole reason Horizontal Line labels can default OFF for existing drawings
 *     and ON for new ones. Materialising `showPriceLabel: false` onto a legacy
 *     drawing and persisting it on the next edit ERASES that distinction
 *     permanently, and there is no way to get it back.
 *   • IT PINS DEFAULTS WE HAVE NOT DESIGNED YET. Writing `fillOpacity: 0.08`
 *     onto every rectangle today means that if Phase 4 picks a different
 *     default, every already-touched rectangle is silently frozen at the old
 *     one and is indistinguishable from a deliberate user choice.
 *   • IT AMPLIFIES WRITES. ~15 keys × every drawing, rewritten on the next edit,
 *     and carried up to the server in the `tracings_doc` blob.
 *
 * So the defaults live in a TABLE that is resolved at read time
 * (`drawingProp` / `withDefaults`), which is the same "schema/default
 * structure" the plan asked for and is fully tested — while the stored object
 * stays sparse and absence keeps meaning what it means. `normalizeDrawing`
 * therefore only adds information that is genuinely NEW and not recoverable
 * later: the schema version itself.
 *
 * ⛔ AND `pane` IS NOT SET HERE, ON PURPOSE. Which pane a drawing belongs to
 * depends on the live pane boundary (`pricePaneBottomPx()`), which the store
 * cannot see — it has no chart. Deriving it from a stale guess would be worse
 * than the current per-frame inference. Phase 1 stamps `pane` where the chart
 * is, at creation, which is what the plan actually specified.
 */

/** Bumped when the STORED shape changes in a way a reader must know about.
 *  Absent (`undefined`) means v1 — everything written before 2026-09-09. */
export const SCHEMA_VERSION = 2

/**
 * Every property the drawing layer reads, and the value it resolves to when the
 * drawing does not carry one.
 *
 * ⛔ EACH VALUE IS THE SHIPPED CONSTANT, NOT A PREFERENCE. `fillOpacity: 0.08`
 * is the literal in `renderRect`; `arrowSize: 10` is the literal handed to
 * `drawArrowhead`; `showPriceLabel: false` is what the overlay hard-codes at the
 * `renderHRay` call site and what the price-axis clip does to `renderHorizontal`
 * in practice. Changing a number here changes the chart — that is the point of
 * having one place, and the reason `drawingSchema.test.js` pins them against the
 * renderer source.
 *
 * `null` means "follow the parent value" (border/fill follow `color`, `levels`
 * follows the module ladder, `fontFamily` follows Instrument Sans) rather than
 * "unset". That distinction matters: a user CAN choose a colour equal to the
 * parent, and that is not the same as never having chosen.
 */
export const DRAWING_DEFAULTS = Object.freeze({
  // ── shipped today, read inline by renderers ──
  lineWidth: 1,
  lineStyle: 'solid',
  fontSize: 13,
  locked: false,
  hidden: false,

  // ── pane ownership (Phase 1) ──
  // null = infer from the point's paneRelY every frame, which is today's behaviour.
  pane: null,

  // ── labels (Phase 4/5) ──
  // false = no price label, which is what ships: the ray's call site passes
  // `false`, and the horizontal's label is painted inside the clipped-away
  // price-axis strip so it has never been visible.
  showPriceLabel: false,
  showPercentChange: false,
  showDollar: false,
  showPercent: false,
  showBars: true,      // renderMeasure prints "N bars" whenever barCount is set
  showTime: false,     // no elapsed-time output exists yet
  labelPos: 'center',  // renderMeasure centres its chip

  // ── fills + borders (Phase 4) ──
  borderColor: null,   // follow `color`
  fillColor: null,     // follow `color`
  fillOpacity: 0.08,   // renderRect / renderCircle literal

  // ── arrow (Phase 4) ──
  arrowSize: 10,       // renderArrow's literal

  // ── fibonacci (Phase 7) ──
  levels: null,        // follow FIB_LEVELS / FIB_EXT_LEVELS + their colour arrays

  // ── text (Phase 6) ──
  fontFamily: null,    // follow '"Instrument Sans", sans-serif'
  bold: false,
  italic: false,
  bgEnabled: false,
  bgColor: null,
  borderEnabled: false,
})

/** Is this a drawing written before the schema version existed? */
export const isLegacyDrawing = (d) => !d || d.sv == null

/**
 * Resolve one property for a drawing: its own value if it carries one, else the
 * table default. `undefined` and a missing key resolve to the default; an
 * explicit `null` does NOT — `null` is a legitimate stored value meaning
 * "follow the parent", and flattening it to the default would make a user's
 * deliberate reset indistinguishable from never having touched it.
 */
export function drawingProp(drawing, key) {
  const own = drawing ? drawing[key] : undefined
  if (own !== undefined) return own
  return Object.prototype.hasOwnProperty.call(DRAWING_DEFAULTS, key)
    ? DRAWING_DEFAULTS[key]
    : undefined
}

/**
 * A read-only view of a drawing with every table default filled in.
 *
 * ⛔ FOR READERS ONLY — NEVER PERSIST THE RESULT. This materialises exactly the
 * defaults the module header explains we must not store. It exists so a renderer
 * can say `withDefaults(d).fillOpacity` instead of `d.fillOpacity ?? 0.08`, and
 * so a test can assert the whole resolved shape in one comparison.
 */
export function withDefaults(drawing) {
  return { ...DRAWING_DEFAULTS, ...drawing }
}

/**
 * The read-path funnel. In-memory, idempotent, and deliberately minimal.
 *
 * Returns the SAME OBJECT when there is nothing to add, so the store's snapshot
 * identity — which React compares to decide whether to re-render every chart on
 * the symbol — is preserved for already-normalised data. A funnel that cloned
 * unconditionally would re-render every mounted chart on every load.
 */
export function normalizeDrawing(drawing) {
  if (!drawing || typeof drawing !== 'object') return drawing
  const needsVersion = drawing.sv !== SCHEMA_VERSION
  const needsPoints = !Array.isArray(drawing.points)
  if (!needsVersion && !needsPoints) return drawing
  const next = { ...drawing, sv: SCHEMA_VERSION }
  // ⛔ THE ONLY THING THAT EVER TOUCHES `points`, and it only ever REPLACES a
  // value that is not an array at all (undefined on a News-widget callout before
  // it is auto-placed). An existing array is passed through BY REFERENCE — not
  // copied, not mapped, not rounded — so every anchor a bound alert hashes is
  // the identical object it was before normalisation.
  if (needsPoints) next.points = []
  return next
}

/**
 * Normalise a list, preserving array identity when nothing changed — same
 * reasoning as `normalizeDrawing`, one level up.
 */
export function normalizeDrawings(drawings) {
  if (!Array.isArray(drawings)) return drawings
  let changed = false
  const out = drawings.map((d) => {
    const n = normalizeDrawing(d)
    if (n !== d) changed = true
    return n
  })
  return changed ? out : drawings
}
