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

  // ⛔ THESE FOUR ARE RESOLVED BY `drawingMeasure.fieldsFor`, NOT FROM HERE.
  // "Does this drawing show a dollar change?" has a different right answer per
  // TYPE — a legacy Measure shows dollar + percent + bars, a legacy Price Move
  // shows percent alone, the half-landed dateRange showed bars alone — and a
  // flat default cannot say four things at once. `LEGACY_FIELDS` is that table.
  // The entries stay here so `withDefaults` still yields a defined value for
  // code that reads the shape generically, but nothing on the render path uses
  // them; `drawingMeasure.test.js` pins the per-type answers instead.
  showDollar: false,
  showPercent: false,
  showBars: true,
  showTime: false,
  labelPos: 'center',  // renderMeasure centred its chip; now one of top/center/bottom

  // ── fills + borders (Phase 4) ──
  borderColor: null,   // follow `color`
  fillColor: null,     // follow `color`
  fillOpacity: 0.08,   // renderRect / renderCircle literal

  // ── arrow (Phase 4) ──
  arrowSize: 10,       // renderArrow's literal

  // ── Price Move (Phase 5) ──
  // Where the user dragged the label to. `null` = nowhere yet, so the label is
  // derived from the run's high/low exactly as it always has been. THE ANCHORS
  // ARE NOT THIS: moving the label must never restate the measurement.
  labelPoint: null,

  // ── fibonacci (Phase 7) ──
  //
  // ⛔ `null` MEANS "FOLLOW THE CANONICAL TABLE", and it must keep meaning that.
  // Materialising the level list onto a drawing would freeze a copy of the
  // palette, turn adding a canonical level into a migration, and triple the size
  // of every saved Fib to record its defaults. A drawing stores ONLY the levels
  // it overrides — see `drawingFib.js`.
  levels: null,        // sparse: { '0.618': { visible, color } }
  fills: null,         // sparse: { '0.5>0.618': { enabled, color } }

  // ── text (Phase 6) ──
  // `null` = the drawing layer's own face, which is what every note drawn
  // before Phase 6 uses. An empty string is the picker's "Default" entry and
  // means the same thing.
  fontFamily: null,
  bold: false,
  italic: false,
  // ⛔ TEXT-ONLY IS THE CLEAN DEFAULT, for legacy notes AND new ones. A
  // background is a readability aid for a note over busy candles, not the
  // normal way a note looks — turning it on by default would restyle nothing
  // (legacy notes resolve `false` here) but would make every NEW note a plate.
  bgEnabled: false,
  bgColor: null,
  // ⭐ THE BORDER COLOUR IS THE SAME PROPERTY THE RECTANGLE USES. "The colour of
  // this thing's outline" is one idea, and a `borderColorText` would be two
  // names for it that a future reader would have to tell apart.
  borderEnabled: false,

  // ⭐ WHICH LAYOUT RULE THIS NOTE WAS DRAWN UNDER. `'box'` = the anchor is the
  // box's top-left, which is what it always meant and what the painter now
  // honours. Absent = the shipped placement, kept so that no existing note
  // moves. See `drawingText.js`.
  textOrigin: null,
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
