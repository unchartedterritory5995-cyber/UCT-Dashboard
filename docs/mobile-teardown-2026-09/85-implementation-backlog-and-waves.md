# Implementation backlog and wave plan

**Deliverables G and H.** Every item traces to a ledger row in
`ledger/PARITY_COMPARISONS_V2.jsonl` and, through it, to a device or source observation. Items
whose evidence was withdrawn are in the **TOMBSTONE** section at the end and must not be revived
without new evidence.

**Nothing here has been built.** Building any of it requires authorization.

**Counts:** 23 items — **P0 ×3 · P1 ×6 · P2 ×7 · P3 ×5 · P4 ×2**. Six are `MEASURE-*`: work that
produces evidence rather than product, because six of this study's 32 gap rows are unresolved or
unmeasured and shipping into them would be guessing.

Field key: `owner` = the architecture surface that owns the change · `FE`/`BE` = dependencies ·
`persist` = what must survive · `a11y` = accessibility requirement · `AC` = acceptance criteria ·
`tests` = automated · `manual` = what a human must check on a phone.

---

# P0 — the three that change a member's day

## MOB-01 · Put the layout lifecycle on the phone
`priority P0 · complexity M · risk LOW · evidence CMP-069, CMP-070, UCT-P9-0003`
- **User problem:** a member can compose a chart on their phone and has no way to name it, save
  it, or come back to it. The phone is a first-class *writer* to a durable object it cannot see.
- **TradingView:** a full CRUD layout manager on the phone — search, four sort orders,
  active-row inversion, always-visible per-row delete, six layout controls above every charting
  tool, autosave with the Save button as a dirty-state indicator.
- **UCT today:** the desktop has *New / Open ▸ / Save ▸ / Multi Chart ▸ / Pop Out*. The phone has
  none: `ChartsWorkspace.jsx:2054-2055` computes `wsGlobalLayouts`/`wsMyLayouts` two lines above
  the `isMobile` return and uses them only on the desktop path.
- **Root cause:** C2 — a working capability with no phone door.
- **Proposed:** a `⬚ Layouts` row in the phone Tools sheet opening a bottom sheet: current
  workspace name · Open (list: mine, then admin-published firm templates) · Save · Save as… ·
  Rename · Delete · a **"Saved ✓ just now"** dirty-state line.
- **UX:** 44px rows; the active layout marked by a check, not by colour alone; Delete behind a
  confirm (TradingView's always-visible delete is a phone hazard, not a model).
- **owner** `pages/charts/mobile/` · **FE** `MobileMoreSheet`, `useChartLayouts`, `Sheet` ·
  **BE** none — `GET/POST/DELETE /api/charts/layouts` already returns `{global, mine}` and a row
  already carries both `layout` and `groups` · **persist** server, existing table ·
  **a11y** `aria-current` on the active row; every control ≥44px.
- **AC:** (1) a layout saved on the phone opens on the desktop with the same widgets, tf, chart
  type and colour-group symbols; (2) a legacy row with `groups: null` opens without throwing and
  restores arrangement only; (3) `layout.kind==='multichart'` rows stay filtered out of the Open
  list; (4) the dirty indicator flips within 1s of a change and clears on save.
- **tests:** a phone-viewport render test asserting the Layouts row exists and lists both scopes;
  a test that a `groups:null` row applies; a regression test that the `kind` filter survives.
- **manual:** save on a phone, open on a desktop, confirm the symbols came too.

## MOB-02 · Restore the phone watchlist row and stop the overflow
`priority P0 · complexity S · risk LOW · evidence CMP-011, CMP-012, CMP-010`
- **User problem:** the highest-frequency loop in the product — cycle a watchlist, chart each
  name — runs through a row that shows no price, no change and no volume, in a table that
  scrolls sideways on a 390px screen. **The data is already at the API; the phone drops it.**
- **TradingView:** five data elements per row plus a marker glyph, no horizontal scroll.
- **UCT today:** symbol only, and `.leftPanel`-class geometry that overflows.
- **Root cause:** C1 — a desktop table rendered narrow with no phone presentation.
- **Proposed:** three columns — `SYM · price · %chg` with volume as a right-aligned dim third
  line or a fourth column at ≥414px. No horizontal scroll at 390px, ever.
- **owner** `pages/Watchlists.jsx` + its module CSS · **FE** `ResponsiveTable` card mode is the
  existing primitive for this · **BE** none · **persist** none · **a11y** 44px rows.
- **AC:** at 390×844 the table's `scrollWidth === clientWidth`; price/%chg render for every row
  with live data; the one-tap row→chart loop is unchanged.
- **tests:** a 390px overflow assertion (the harness already flags horizontal overflow as its
  #1 defect class); a render test for the three columns.
- **manual:** scroll a 30-name list on a phone; confirm no sideways drift and no clipped column.

## MOB-03 · Migrate the retired `header.showLegend` key so the crosshair legend is on
`priority P0 · complexity S · risk MEDIUM · evidence CMP-086, legendMode.js`
- **User problem:** a member presses and holds a candle and gets **nothing** — no OHLC, no
  change, no MA values — because a boolean from a retired schema, which *"sits in every stored
  blob in production"*, outranks the current `always` default.
- **TradingView:** its value-tracking legend is not user-disableable in the same way.
- **UCT today:** `legendMode !== 'off' && (legendMode !== 'hold' || legendHeld)` gates the whole
  legend; `header.showLegend` is consulted as a read-only fallback when `legendMode` is absent.
- **Root cause:** C3 — state whose lifetime nobody chose.
- **Proposed:** a one-shot read-time migration — when `legendMode` is absent, resolve it from
  `header.showLegend` **once**, write `legendMode` explicitly, and stop consulting the legacy key.
  ⛔ **Do not add a settings toggle to compensate for a settings bug.**
- **risk note:** this WRITES to stored chart settings. It must be idempotent, must not clobber an
  explicit `legendMode`, and must be reversible by the user in one control.
- **owner** `components/chart/legendMode.js` · **FE** `StockChart`, `ChartPane`,
  `ChartSettingsModal` (all already route through `legendModeOf`) · **BE** none ·
  **persist** server chart settings · **a11y** none.
- **AC:** a blob with `showLegend:false` and no `legendMode` resolves to the migrated value once
  and never re-migrates; a blob with an explicit `legendMode` is untouched; the legend renders on
  press-and-hold for a member whose account previously showed none.
- **tests:** `legendStamp.test.js` is the existing rail — extend it with the migration matrix
  (absent / legacy-false / legacy-true / explicit).
- **manual:** on an account that currently shows no OHLC on a phone, confirm it appears.

---

# P1 — the systemic fixes and the evidence debts

## MOB-04 · An all-tools grid on the drawing bar
`priority P1 · complexity S · risk LOW · evidence CMP-034, UCT-DRAW-0007`
- **User problem:** 3 of 18 drawing tools are visible, with no scroll affordance and no
  coach-mark. Fifteen tools are functionally invisible on a phone. Confirmed on hardware.
- **TradingView:** a searchable, category-tabbed picker — ⚠️ and TV's own hub hides 15 of 18
  entries at its default detent (`CMP-083`), so tabs are not a proven answer.
- **Proposed:** a persistent `[⊞]` at the end of the bar opening a labelled 4-across grid with
  search and a RECENT row. Recency, not favourites (`CMP-017`).
- **owner** `components/chart/MobileDrawBar.jsx` · **FE** `Sheet` · **BE** none ·
  **persist** recents in localStorage (device-scoped, correctly) · **a11y** 44px tiles, labels
  not icons alone.
- **AC:** every one of the 18 tools is reachable in ≤2 interactions from the chart; the bar's
  existing scroll still works.
- **tests:** a test that asserts the grid contains exactly `DRAW_TOOLS.length` tiles, derived from
  the array — **never a typed count** (this study got that count wrong twice).
- **manual:** find "Pitchfork" on a phone without prior knowledge.

## MOB-05 · Bind a drawing's alert to the drawing
`priority P1 · complexity M · risk MEDIUM · evidence CMP-055, UCT-ALERT-0004, UCT-ALERT-0005`
- **User problem:** you draw a trendline, set an alert on it, then move the line — and the alert
  stays where the line used to be. A sloped line silently snapshots its *later endpoint*.
- **TradingView:** the alert is bound; moving the object moves the alert.
- **UCT today:** the alert is **seeded** — a price snapshot that then stands alone. The creation
  path is *cheaper* than TradingView's (three gestures, zero typing) and should not change.
- **Root cause:** C7 — the only cluster where TradingView's behaviour is simply better.
- **Proposed:** store the drawing id on the alert; recompute the trigger price from the drawing's
  current geometry on evaluation; show the binding on the alert row; fall back to the seeded
  price if the drawing is deleted (and say so).
- **owner** `watchlist_alert_service` + `ChartDrawingOverlay`'s alert action · **FE** object menu,
  alert list · **BE** alert row gains a nullable drawing reference; evaluation reads geometry ·
  **persist** the drawing lives in `tracings_doc` (server-synced) so the reference resolves
  cross-device · **a11y** none.
- **risk note:** drawings are **per symbol** and sync whole-document last-writer-wins
  (`CMP-047`, `CMP-075`); a bound alert must degrade gracefully when its drawing loses a sync
  race. **Ship MOB-09 first or together.**
- **AC:** moving a bound line changes the trigger price; deleting the line converts the alert to
  its last computed price and labels it; a sloped line's alert follows the line, not an endpoint.
- **tests:** unit tests over trigger-price recomputation for horizontal, ray and sloped;
  a deletion-degradation test.
- **manual:** set, move, confirm the alert moved.

## MOB-06 · "Renders on a phone" must mean "has a phone presentation"
`priority P1 · complexity M · risk LOW · evidence CMP-002, CMP-003, CMP-004, CMP-029, CMP-085`
- **User problem:** the study's largest root cause (C1, 8 of 32 gap rows). A component built wide
  is rendered narrow and nothing decides what to drop: the watchlist drops data it has, formula
  bodies fill the screen, the watermark covers the canvas, the voice orb is clipped.
- **UCT already knows the answer** and applies it to exactly two elements:
  `StockChart.module.css:778-797` deletes the `$-Vol` strip and the A/L/% chips from the phone
  canvas with a comment explaining why. ⭐ **Generalise that rule.**
- **Proposed:** a documented convention plus a lint/test rail — a component rendered under the
  phone shell declares its **drop list** (which columns, which controls, what truncation) or it
  does not render there. Apply first to: the chart watermark, the formula rows, the voice orb.
- **owner** `styles/breakpoints.css` + the mobile shell convention · **FE** per-component ·
  **BE** none · **persist** none · **a11y** this is where the 44px minimum gets enforced.
- **AC:** no horizontal overflow on any charting-surface route at 390px; the watermark does not
  overlap candles; the orb does not collide with chart chrome.
- **tests:** extend `tools/mobile_audit.py`'s overflow sweep to the charting routes and make it a
  gate rather than a report.
- **manual:** the audit's screenshots, read by a human.

## MOB-07 · `_COARSE_POINTER` becomes a hook — the testability fix
`priority P1 · complexity S · risk LOW · evidence CMP-041, CMP-042, CMP-048, UCT-P9-0008`
- **User problem (engineering):** every touch affordance in the drawing layer — grab radius 15px,
  handle radius 7px, auto-select-after-placement, the coach chip, `DrawingQuickBar`,
  sheet-vs-popover — hangs off a **module-load constant** over a *live* media query. A resized
  frame can never become a touch surface, which is why three high-value checks in this study are
  unresolved. On an iPad, attaching a trackpad keyboard flips the query and the constant cannot
  hear it (⚠️ device consequence **inferred**, not tested).
- **Proposed:** replace the constant with `useHasCoarsePointer()`, which already exists in
  `hooks/useBreakpoint.js`.
- **owner** `components/chart/ChartDrawingOverlay.jsx:83-90` and its six consumers ·
  **FE** `useBreakpoint` · **BE** none · **persist** none.
- **risk note:** ⚠️ `useMediaQuery` seeds at mount and updates only on a `change` event — the
  documented first-paint staleness. Verify the drawing layer tolerates a mid-session flip.
- **AC:** the touch branch is reachable in an emulated coarse-pointer context; the six behaviours
  respond to a live media-query change without a reload.
- **tests:** a coarse-pointer render test asserting `HIT_THRESHOLD`/`HANDLE_R` take their touch
  values — **the test this study could not write.**
- **manual:** an iPad with a Magic Keyboard attached and detached.

## MEASURE-01 · Close the four blocked drawing checks
`priority P1 · complexity S · risk NONE · evidence CMP-041, CMP-042, CMP-048, UCT-COARSE-0005`
- **What:** grab radius, handle radius + halo, auto-select-after-placement, `DrawingQuickBar` —
  all `ACCESS_BLOCKED`. `CMP-042` decides whether UCT's tap-to-place is a **draft** or a
  **commit**, which is the last open question in the placement model.
- **How:** BrowserStack **App Automate / Appium** against the same `bs-local` URL, where
  `driver.tap` injects a real OS-level touch instead of a synthesised DOM event. Needs the
  account access key in the environment. One tap places the drawing; all four checks are then one
  screenshot each.
- ⚠️ **The blocked cause is NOT isolated** — it may be harness synthesis or UCT's own pointer
  accounting (`activePointersRef`'s multi-pointer guard, drained only by a `pointerup` reaching
  the canvas). If Appium also fails, that is itself a finding and points at MOB-07's file.

## MEASURE-02 · Capture a landscape phone session
`priority P1 · complexity S · risk NONE · evidence CMP-063, CMP-064`
- **What:** Flow G was never measured. TradingView's landscape is a distinct mode with ~3× the
  time range; UCT has a landscape branch in CSS and zero observations.
- **How:** one BrowserStack App Live session, rotate, capture, rotate back. **Do not design
  landscape before this runs** — `prototype/00-*` Flow G is explicitly conditional.

---

# P2 — architecture and object vocabulary

## MOB-08 · `presentation[deviceClass]` — give durable state a scope
`priority P2 · complexity L · risk MEDIUM · evidence CMP-072, CMP-073, UCT-P9-0006, UCT-P9-0007`
- **Problem:** the pan/zoom view lock is device-local while the widget id keying it is
  server-backed, so a restored layout comes back framed on a different range; and multi-chart grid
  mode follows a user to a phone that has no way to enter it (the shipped remedy is an escape
  button whose own comment says the user would otherwise be *"TRAPPED"*).
- **Proposed:** move exactly two things — `viewLock` and board/grid mode — into
  `presentation[phone|tablet|desktop]` on the workspace record. Full design, migration table and
  the two things **not** to move: `60-p9-workspace-architecture.md` §R3, §8.
- **AC:** opening a workspace on a phone never inherits desktop grid mode; the view range is
  per-device-class; a legacy `uct.charts.viewLock.<chartId>` still restores for one release.
- **risk:** the `kind==='multichart'` filter is the one place a careless refactor produces a blank
  board.

## MOB-09 · Fix the tracings sync highwatermark
`priority P2 · complexity S · risk MEDIUM · evidence CMP-075, UCT-P9-0005`
- **Problem:** `flushPush` advances the local highwatermark **before** an unawaited `setPref`, and
  the adopt gate is a strict `server.updatedAt > hw` — so a device is pinned at exactly the
  version it *believes* it pushed. Observed live: server holds two SPY drawings, the device holds
  none, `hw === server.updatedAt`, and it will never adopt them. ⚠️ Mechanism source-verified,
  divergence live-verified, **real-user trigger inferred**.
- **Proposed:** advance the highwatermark only after a confirmed write, and reconcile the
  "server holds content we do not" case rather than leaving the device pinned.
- ⛔ **Ship the reconciliation WITH the ordering fix** — a device already wrongly advanced stays
  wrong otherwise. **Prerequisite for MOB-05.**

## MOB-10 · `Hide` in the drawing object menu · `P2 · S · LOW` · `CMP-045`
Non-destructive hide beside destructive delete, the way TradingView does it consistently. UCT has
Lock and Delete and nothing between them.

## MOB-11 · Placement narration · `P2 · S · LOW` · `CMP-039`
"Point 1 of 2" plus a live price echo on the axis while placing. The one part of TradingView's
placement model worth adopting; the cursor model itself is **withdrawn**.

## MOB-12 · An "on this chart" band in the indicator sheet · `P2 · M · LOW` · `CMP-030`–`CMP-033`
Applied indicators listed first with per-row hide / settings / overflow.
⚠️ **Gated on MEASURE-03** — UCT's current phone legend-row affordances were never opened, so
part of this may already exist.

## MOB-18 · Mid-draw cancel affordance · `P2 · S · LOW` · `CMP-037`
TradingView has a trash control in its drawing-mode top bar; UCT relies on undo after the fact.

## MEASURE-03 · Open the indicator legend row on a phone · `P2` · `CMP-030`–`CMP-033`
The study's largest coverage hole. Four comparisons are `TV_UNVERIFIED` because UCT's side was
never exercised. **Reported as a hole, never as a gap** — and MOB-12 must not ship before it.

---

# P3 / P4

| id | item | pri | evidence | note |
|---|---|---|---|---|
| MOB-13 | Truncate formula rows to their name | P3 | `CMP-029` | subsumed by MOB-06's rule; listed separately because it is one line |
| MOB-14 | Redo arms on the first undo after a load | P3 | `UCT-UNDO-0003`, `CMP-066` | today the first-use path is the broken one — the one a real user meets |
| MOB-15 | Object tree | P3 | `CMP-081` | genuinely absent (no such string anywhere under the chart surfaces), unlike replay/compare |
| MOB-16 | Watchlist sort controls to 44px, or into the sheet | P3 | `CMP-013` | the only surviving measured a11y defect after `CMP-084` was withdrawn |
| MOB-17 | Exchange / type / country in symbol-search results | P3 | `CMP-006` | TradingView's four-field two-line row |
| MOB-19 | Named drawing + settings templates | P4 | `CMP-046`, `CMP-062` | UCT's "Save as defaults" already covers the 80% case |
| MOB-20 | Phone doors for bar replay and symbol comparison — **or a register entry saying they are deliberately desktop-only** | P4 | `CMP-079`, `CMP-080` | ⭐ the register matters more than the doors: today a deliberate omission and an oversight look identical |

---

# H · Wave plan

Derived from dependency and evidence, not from the suggested ordering.

### Wave 0 — "a member notices this week"  ·  MOB-01, MOB-02, MOB-03
**Value:** the layout door (largest gap), the highest-frequency loop's broken row, and a legend a
member may be seeing nothing from. **Dependencies:** none — all three are additive over existing
APIs and existing components. **Risk:** LOW except MOB-03, which writes to stored settings.
**Scope:** ~1 sheet, ~1 table, ~1 migration. **Each ships independently.**

### Wave 1 — "stop the class, not the instance"  ·  MOB-06, MOB-07, MEASURE-01, MEASURE-02
**Value:** closes the largest root cause as a *rule*, and pays the evidence debt so later waves
are not designed blind. **Dependencies:** none. **Risk:** LOW.
⭐ **MOB-07 and MEASURE-01 are the same problem from two ends** — do them together; if Appium also
fails to place a drawing, the answer is in the file MOB-07 touches.

### Wave 2 — "the drawing surface"  ·  MOB-04, MOB-11, MOB-18, MOB-10, MOB-14
**Value:** makes 18 tools findable, narrates placement, and completes the object verbs.
**Dependencies:** MOB-04 is independent; the rest are cheap once the surface is open.
**Risk:** LOW. Ships as one release or five.

### Wave 3 — "alerts that mean something"  ·  MOB-09 → MOB-05
**Value:** the only cluster where TradingView is simply better. **Dependencies:** strict —
**MOB-09 first**, because a bound alert must survive a drawing sync race. **Risk:** MEDIUM;
both touch durable state.

### Wave 4 — "the workspace grows up"  ·  MOB-08
**Value:** retires two surface patches (the phone grid-mode escape hatch, the view-lock split) by
giving the record a scope model. **Dependencies:** MOB-01 should ship first so the workspace is a
named object before it gains a presentation layer. **Risk:** MEDIUM — read-fallbacks required on
both moved keys; the `kind==='multichart'` filter is the trap. **Scope:** the largest item here.

### Wave 5 — "close the coverage holes, then decide"  ·  MEASURE-03 → MOB-12, then MOB-13/15/16/17
**Value:** the indicator surface is the study's biggest unmeasured area; measure, then build only
what is actually missing.

### Wave 6 — "differentiation, not catch-up"  ·  MOB-19, MOB-20, plus the P9 register
**Value:** ⭐ the highest-leverage item in this wave is not a feature — it is **MOB-20's register**:
every desktop chart capability is either on the phone, listed as deliberately desktop-only, or a
bug. Today all three look identical, which is how "UCT has no bar replay on any platform" got
written into a frozen ledger.

---

# ⚰️ TOMBSTONE — withdrawn, disproven, or never real

**Do not revive any of these without NEW evidence. Each was in a backlog draft at some point in
this study.**

| withdrawn item | why it died | evidence |
|---|---|---|
| "Build a bare-chart price → contextual-action bridge" — *once ranked the study's #1 item* | It ships, and it is **broader** than TradingView's ⊕ menu | `UCT-CHART-0007`, `CMP-049` |
| "Add an OHLC row to the crosshair legend" | It exists, plus four live MA values | `UCT-CHART-0008`, `CMP-020` |
| "UCT has no object → alert" | It ships, in three gestures with zero typing | `UCT-DRAW-0003`, `CMP-054` |
| "Adopt TradingView's cursor-decoupled placement (P1)" | A legitimate product-model difference; UCT answers occlusion with exact numeric entry | `CMP-036` |
| "Fix the 17×11px price-scale tap targets" | `.scaleToggle` is `display:none` on the phone shell — **they do not render on a phone** | `90-independent-validation.md` §1.2 |
| "Surface `$ Vol` / `Avg 50D` as a UCT advantage" | `.volLegend` is `display:none` on the phone shell — UCT removed them **on purpose** | §1.1 |
| "Set `autoCapitalize=characters` on the phone symbol search — a free 1-line win" | Already set, at `MobileSymbolSheet.jsx:108` | `95-census-errata.md` E3 |
| "Add bar replay to UCT" | Replay ships in `ChartToolbar.jsx`; only the **phone door** is absent | `95-census-errata.md` E2, `CMP-079` |
| "Add favourites for intervals / chart types" | Solves a problem UCT does not have — its eight intervals are all already visible | `CMP-017` |
| "Adopt TradingView's transactional Ok/Cancel settings commit" | Right for a 40-field sheet, wrong for three inline toggles | `CMP-061` |
| "Add chart-native order entry" | UCT has no execution and correctly does not want it | `CMP-078` |
| "Add Siri shortcuts / home-screen widgets" | A web app on mobile Safari structurally cannot | `CMP-082` |
| "Record that tap does not place a drawing on iOS" | **Never record this.** No finger was ever tested; every tap was synthesised, and the cause is not isolated | `UCT-COARSE-0005` |
