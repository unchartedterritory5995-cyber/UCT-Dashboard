# UCT Indicator Platform — Design Specification

**Date:** 2026-07-31 · **Status:** Approved roadmap; spec pending owner review
**Inputs:** 4 research reports (TradingView/Pine ecosystem, Lux Algo & premium vendors, competitor creation systems, technical feasibility) + 5-seat panel review (swing trader, UX, visual design, architecture, CEO/product). All panel findings adjudicated and folded in.

---

## 0. One-page summary

Build ONE indicator engine where every indicator is a versioned, declarative **definition** (meta + typed inputs + declared plots + named events + swappable compute slot). Two creation doors ride on it — a **curated UCT library** and, later, a **no-code builder** — plus an **AI concierge** (NL → definition → chart → honesty audit) that subsumes a scripting tier. A standalone user-facing scripting language is **killed** as a product; its sandbox survives as plumbing for AI-generated definitions.

**Positioning:** *"The chart TradingView can't be."* Not a TV replacement — the indispensable second screen: proprietary data fused into indicators (dark pool, options flow, GEX), signals that provably don't repaint, and an append-only signal ledger. **"The first indicator platform that shows its receipts."**

**Execution model:** all lanes running, merges gated. Every phase's spec/design work starts immediately; shipping order follows dependencies and verification gates, not calendar rest.

---

## 1. Strategy (research-derived, non-negotiable principles)

1. **One grammar, many surfaces.** The definition consumed by chart, alerts, screener, and builder is the same object. Never ship asymmetric capability across surfaces (TrendSpider's core failure).
2. **Data moat first.** Flagship indicators are views over proprietary data. TV vendors are tenants; UCT is a landlord.
3. **Receipts as brand.** Closed-bar evaluation by default; forming values visually ghosted; machine-or-audit-assigned repaint badges (never self-disclosed); append-only signal ledger recording from launch day (private-first; public per-toolkit only after it proves out).
4. **Sell toolkits, not indicators** (Phase E). Gate breadth (symbols, history), never mechanics.
5. **Don't innovate on chrome.** Users are TV-pre-trained: legend chips, three-tab settings, pane grammar copied exactly. Innovate on substance: error states, honesty features, data fusion.
6. **Traps to never step in** (vendor research): repainting scandals, backtest inflation, naked buy/sell-arrow marketing, unmeasured accuracy claims, billing dark patterns, countdown-timer pricing theater, metered credits for core features, auto-trading liability.

---

## 2. Roadmap — dependency pipeline

| Phase | Ships | Gate to ship |
|---|---|---|
| **A — Signature Launch** | 3 UCT Signature Indicators (server-computed, premium-gated) on the EXISTING chart path + signal ledger (write-only) + receipts landing section | Sep 5 launch; closed-bar semantics verified across live sessions |
| **B — Foundation** | Engine, binding layer, instance-list settings, two-flip migration of the 14 series-expressible natives (15 settings keys; `volumeProfile` is a canvas overlay and is carved out — see §11 and the B3 plan's adjudication A4), auto-generated settings UI, library dialog | Post-launch freeze lift (Sep 19+); per-indicator parity gates |
| **C — Alerts & depth** | Closed-bar alert engine, every-plot-alertable + events, version policy, price alerts + push + fired log, AVWAP/ATR bands/RS line, per-chart sets + templates, Signature indicators genericized into registry | B complete |
| **D — Builder + AI door** | jsep AST + closed-table interpreter, sentence read-back, machine repaint linter, NL→AST concierge | B complete (C parallelizable) |
| **E — Screener & toolkits** | Definitions across full universe server-side; named ™ toolkits; tiering | C + D; ledger has public-worthy history |

**Parallel-from-today lanes:** Phase A implementation · Phase B build in isolated worktree (ship gated) · C/D spec + schema freeze + design tokens (this document) · ledger accruing history.

**Hard sequencing reasons (recorded so they're not re-litigated):** C consumes B's definitions; D emits B's definitions; E runs them. Verification gates are real only if they can fail. Launch window = no surgery on the flagship premium surface with deploy-restricted hours.

---

## 3. Definition schema v1

```jsonc
{
  "schemaVersion": 1,
  "id": "uct-rsi",                 // stable handle; plots addressable as uct-rsi.rsi
  "version": 4,                    // PRESENTATION version: meta, input UI, styling. Pin-safe.
  "compute": {
    "kind": "native",              // native | server | ast (D) | script (reserved, AI plumbing)
    "fn": "rsi",
    "rev": 2,                      // MATH revision. Bumped ONLY on output-changing logic.
    "budget": null                 // reserved (op/lookback caps for ast/script kinds)
  },
  "meta": {
    "name": "RSI", "shortName": "RSI", "category": "Momentum",
    "description": "...", "tags": ["oscillator"],
    "author": "uct",
    "tier": "free",                // billing tier — ORTHOGONAL to compute.kind
    "repaint": "non-repainting"    // non-repainting | preview-repaints | repaints
                                   // Phase A/B: audited metadata (UCT-authored only).
                                   // Phase D: machine-assigned by AST linter.
  },
  "placement": {
    "target": "pane",              // price | pane | volume  (volume = shipped left-axis overlay feature)
    "scale": { "min": 0, "max": 100 }
  },
  "inputs": [
    { "key": "period", "type": "int", "label": "Length", "default": 14,
      "min": 2, "max": 200, "step": 1, "group": "Core", "tooltip": "..." },
    { "key": "lineColor", "type": "color", "default": "token:info" }
  ],
  "plots": [
    { "key": "rsi", "label": "RSI", "style": "line",
      "color": "$lineColor", "width": 1, "lineStyle": "solid",
      "opacity": "solid", "precision": 2, "role": "primary" },
    { "key": "levels", "style": "hlines", "levels": [70, 50, 30] }
  ],
  "events": [
    { "key": "overbought", "label": "Crossed above 70" }   // MUST match a returned column of {0,1,NaN}
  ]
}
```

### 3.1 Field rules (panel-adjudicated, field-level)

- **`version` vs `compute.rev`:** alerts/screens/ledger pin against `defId@version` freely (presentation pins are free). On a `compute.rev` bump there is NO eternal pinning: all bindings force-migrate with user notification, evaluator `last_value` reset, first post-migration cycle suppressed (prevents v_old-prev vs v_new-current false crossings). Contract: *"you will never be silently switched"* — not *"old math runs forever."*
- **Colors are tokens.** `color` fields accept `token:*` semantic references (see §7) resolved per-theme at render time; raw hex is the escape hatch. This MUST land before pilot indicator #1 — persisted user styleOverrides make day-1 defaults permanent.
- **`$<inputKey>` substitution grammar:** valid in plot fields `color`, `width`, `levels`, **`lineStyle`**. Resolution failure = definition invalid at registration. Never silent defaults. *(`lineStyle` was added in B3 Task 8 and a migration is why: VWAP is the first migrated native with a user-facing style picker — `indicators.vwap.lineStyle` → solid/dashed/dotted — and without the reference its definition could only carry an author's literal, so an engine-drawn VWAP rendered **solid** for every user who had chosen dashed. Measured at **2,966 changed pixels (0.398656%), 5/5 runs** on `engine_vwap_dashed_vs_legacy`, build `9c7b7e62e647` — on which `engine_vwap_vs_legacy` (lineStyle solid) was **0**, which is why no pre-existing case could see it. The grammar is unchanged; the resolved value is still checked against `PLOT_LINE_STYLES`, so an enum whose options wander outside the vocabulary still fails at registration.)*
- **Dynamic color channel:** `plots[].colorMode: "fixed" | "sign" | "column:<key>"`. Compute NEVER returns color strings; the data plane stays numeric. (`sign` covers MACD-histogram/volume up-down.)
- **Events are columns.** `events[].key` must match a returned column valued `{0, 1, NaN}`. Alerts, screener, and builder AST all consume this one shape.
- **Unknown-field policy (asymmetric):** document fields = ignore-and-preserve within a schemaVersion major. Behavioral fields = fail closed — unknown `inputs[].type` or `plots[].style` ⇒ instance refuses to render with error chip; never silent coercion. Catalog fetch filters by client `supportedKinds`.
- **Plot styles v1 (build):** `line, stepline, histogram, area, baseline, hlines, markers, band` (band = upper/lower + fill, covers BB/Donchian/cloud cases). **Schema-reserved, renderer later:** `zones` (typed `{from,to,state,label?}`, states per §7), `bgband`, `barcolor` (ownership crosses into live-tick candle path — Phase C+), `fill` (arbitrary pair).
- **Marker vocabulary (locked enum):** triangle-up/down = entry/exit · circle = info · diamond = named event · square = level interaction · cross = invalidation. Sizes `s|m|l` fixed px. Shape = event class, color = direction; neither free-form.
- **Input types v1 (build):** `int, float, bool, enum, string, color, source`. **Schema-reserved, deferred:** `timeframe` (MTF is a repaint minefield — reserved with confirmed-bars-only semantics so the schema never needs a v2 for it), `price`, `time`, `session`, `symbol`, `confirm`. Modifiers `group/inline/tooltip/activeWhen` ship v1.
- **Per-plot `role`:** `primary | secondary | context | signal` — drives legend order, default widths, and gives the visual-budget linter (§7) something to enforce.

---

## 4. Compute contract

```
compute({ bars, inputs, prevState?, barstate }) → { columns, state? }
```

- `bars`: columnar Float64Arrays `{t,o,h,l,c,v}` — **raw bars, never display-transformed** (no Heikin-Ashi input; JS and Python lanes identical on this).
- `columns`: one Float64Array per plot/event key, **aligned to bar count, NaN-padded** (server convention wins over the current trimmed-array client convention).
- **Wire format (server kind):** JSON arrays with `null` ⇄ NaN mapped at the client boundary. Binding layer converts NaN → LWC whitespace items; compute never emits point objects. (Base64 Float64 buffers are a later optimization, not v1.)
- **No rounding inside compute — ever.** JS `toFixed` (half-away) vs Python `round` (banker's) differ; precision is display config (`plots[].precision`). Fixtures compare at rel-tol 1e-9. Existing natives' internal rounding is removed at migration.
- **Streamability rule:** an indicator is streamable **iff** its last confirmed-bar compute returned `state`; then ticks call `compute({bars: tail, prevState, barstate})`. No `state` ⇒ throttled (rAF/250ms) full recompute — acceptable at ≤5000 bars. No hand-written per-indicator incremental paths.
- **Rollback discipline (Pine's model):** `prevState` snapshots at the last CONFIRMED bar only; forming-bar recomputes never advance it. Bar-close outputs must be reproducible from history alone; anything that can't be is labeled `repaints`.
- **Bars identity:** an epoch/generation token from the bars layer (history amendments: delta re-aggregation, reconciliation deletes) — engine never diffs tails to guess. Full `setData` only on epoch change; last-point `update()` otherwise.

---

## 5. Engine runtime & migration (Phase B)

- **Registry:** bundled natives + fetched catalog (server/premium entries listed for merchandising even when locked).
- **Instance model:** `[{instanceId, defId, defVersion, inputs, styleOverrides, placement, hidden, scope?}]`. `scope` (chartId) present from day one as data; **global default at cutover**, per-chart + templates flips on in Phase C.
- **Settings migration — ordered safeguards (architect R4):**
  1. FIRST commit: `mergeChartSettings` passes through `settingsVersion` + `indicatorInstances` (today's whitelist silently destroys unknown keys).
  2. Read-time migrator old→instance-list is a pure function golden-tested against REAL prod `chart_settings` blobs.
  3. Write path merges by `instanceId` (or CAS on `settingsVersion`) — multiple chart widgets are concurrent writers; last-writer-wins loses instance adds.
- **Binding layer:** generic `Map<instanceId, boundSeries[]>` owning ALL series/pane lifecycle; reuse-first; no create/remove during ticker flips or ticks; pane HANDLES (`series.getPane()`), never indices; lives OUTSIDE the monolithic settings effect (that isolation is the actual perf deliverable).
- **Two-flip migration (architect R1 — replaces naive strangler):**
  - **Flip A:** engine indicators render into the LEGACY stacked-margin bands via the placement adapter — zero geometry change, so per-indicator screenshot-parity gates are tight and honest. Order: LWC 5.1→5.2 bump + regression pass + baseline freeze → settings passthrough → BB + RSI pilots → **MACD third** (colorMode + multi-plot + histogram stress test) → remaining 11 (VWAP late; session semantics + `vwapOverride` special cases).
  - **Flip B:** after all 14 are engine-owned, ONE atomic, feature-flagged cutover from margin-bands to real LWC panes, with dedicated visual QA on all four theme surfaces and a rollback flag. `paneMargins`/`chartRegion` contracts stay unit-tested until Flip B completes. `volumeProfile`'s legacy canvas effect is NOT in that deletion — it is carved out (§11) and no flip touches it.
- **The enumeration ledger — the count is a TEST, not a comment.** "An indicator is enumerated in N places" is the problem this phase exists to end. `indicatorRegistry.js` said **seven** in July 2026. The B3 plan counted **sixteen**; walking it produced **twenty**, then **twenty-one**, then **twenty-two** (a frozen chart-settings capture in a PAGE component no chart-module walk had opened), and B3 Task 12's walk produced **thirty-two** — one entry per *(file, contiguous region)* a new or migrating indicator must be edited into, which is a stricter convention than the plan's and accounts for most of the delta. Five of the thirty-two were genuinely new finds: `readout.LEGACY_SLOTS` (`legChips`' twin), `ChartSettingsModal`'s hardcoded section list, the `toggle:` switch and the Alt-key block in `StockChart` (where the keyboard commands are *consumed* — the plan's site #13 named two shortcuts; there are **four**, across four regions in two files), and `indicator_alert_evaluator.INDICATOR_FUNCS`, the alert dropdown's backend twin. **B3 retired six regions per flipped indicator** (the refs, the compute branch, the render block, the crosshair read, the hide-all entry, the Flip-A guard), **one globally** via the pane-margin projection (`paneMargins.js` stays *consumed*, not owned), and **two outright** — the settings tab's hardcoded section list and `indicatorRegistry`'s `VWAP_FIELDS`. **Thirty-one remain**, and `app/src/components/chart/engine/__tests__/enumerationSites.test.js` holds them: every site is anchored (a marker that moves or duplicates fails BY NAME), the count is asserted, a discovery scan refuses a shipped module that hand-lists four or more indicators and is not on the ledger, and a settings section added without an engine definition fails. **B4 inherits, precisely:** `chartRegion.INDICATOR_LABELS` · `ChartToolbar`'s `OSC` + its 15 rows · `keyboardShortcuts`' two regions + `StockChart`'s two consumer regions · `IndicatorAlertPopover`'s `INDICATORS` + `CONDITIONS` + `INDICATOR_FUNCS` · `StockChart`'s `IND_OPTS`, `OSC_OPTS`, right-click Hide, `handleCopyShareUrl`, `legChips` + `readout.LEGACY_SLOTS`, the crosshair reads · `paneMargins.PANES` · `chartBus.ALLOWED_INDICATORS` · `indicatorRegistry.ENGINE_ROW_DEF_IDS`. That last one carries its own retirement rail: the test fails the day B4's generated dialog covers VWAP's opacity / line style / line width, because the row exists only while those controls live on that surface alone.
- **Perf budget:** ≤60 series AND ≤8 panes per chart; columnar→object mapping reused, never re-allocated per update; per-indicator compute time logged in dev with a >2× regression alarm.
- **Mount-site scoping:** full management UX on Charts workspace + TickerPopup; read-only rendering at the other mount sites (18 total; `hideLegend` surfaces get no chips → error states fall back to a console+telemetry path).

---

## 6. UX contract (Phase B addendum — REQUIRED before pilot implementation)

**Copy TV exactly:** legend chip anatomy, three-tab settings dialog (Inputs/Style/Visibility†), add-flow (search-first, add-and-stay-open, checkmarks), pane grammar (drag divider, move-to submenu, auto-remove empty panes). †Visibility tab deferred to C.

**Entry points:** labeled "Indicators" toolbar button (not icon-only in v1) · right-click/long-press → "Add indicator…" (pane-aware) · Ctrl/Cmd+I only — bare keys collide with type-to-search-symbol. Gear-panel checkbox rows become a "Manage indicators →" launcher at cutover, deleted at Flip B; both surfaces render the SAME instance list during migration.

**Touch mapping (uses shipped primitives):** tap chip → `ContextPopover` bottom sheet (name + values, then Settings/Hide/Move/Alerts/About/Remove as 44px rows) · settings in `Sheet variant="auto"` (fullscreen on phone) · long-press pane → context menu · chips collapse to dots below phone breakpoint · chip live values render only while crosshair active, rAF-throttled.

**Settings form spec:** one input per row, label left/control right, fixed control widths per type; `inline` packs ≤3 same-type; live-apply + Cancel-rollback (snapshot on open); 250ms debounced recompute; numeric commit on blur/Enter with visible clamping; `activeWhen` dims — never removes; dialog max-height 70vh with collapsible groups; full tab order, stepper arrows (Shift=×10), focus trap, aria from label+tooltip; ONE formatting pipeline drives Style-tab precision, chip values, and crosshair readout.

**Instance state inventory (10 states, strict color language — red broken / amber degraded / gray intentional):**
1 Loading (skeleton, never flash error) · 2 Refreshing (serve-stale: keep stale plot + subtle activity) · 3 **Warmup/insufficient history — gray "needs N more bars," NEVER error-styled** · 4 Compute error (red dot on chip, message in tooltip/click + Retry + copy-diagnostic; plots removed, chip stays) · 5 Server unavailable (amber, backoff retry, last-good ghosted with as-of; failed sole-occupant pane shows inline message, never blank) · 6 Premium locked (lock + preview) · 7 Hidden · 8 Hidden-on-this-TF (grayed + tooltip, not absent) · 9 Repaint badge (informational, never error-colored) · 10 Version-migrated notice (toast/inbox, never chip state).

**Deletion guard:** removing an instance that alerts reference prompts — "N alerts use this instance: keep evaluating / delete alerts." Never silent.

**Novice layer:** per-indicator About (plain language + what the badge means) · library rows show name, one-line "what it tells you," category, repaint badge, tier badge, star · sparkline thumbnails from canned SPY data · one-click Starter Set.

---

## 7. Visual design system (lock BEFORE pilot #1; keyed to existing tokens.css)

**Semantic tokens:** `ind.bull`→`--gain` · `ind.bear`→`--loss` · `ind.neutral` #8a8574 · `ind.warn` = NEW amber, distinct from gold · `ind.info`→`--info` · `ind.premium`→`--ut-gold` (rationed: ≤1 gold element/chart; gold ≠ warning).
**Opacity ramp (named steps, never raw alphas):** `fill-faint` 8% · `fill` 12% · `band` 16% · `emphasis` 24% · `glow` 35% · `solid` 100%. OLED theme resolves one step higher.
**Gradient standard:** two-stop `color@emphasis → color@0`, vertical from anchor. One shape everywhere.
**Multi-series ramp:** fixed-order 6-slot categorical, CVD-validated on all four theme surfaces.
**On-chart type:** Instrument Sans only, `tabular-nums`, never mono (owner-locked); values 11px/600, labels 10px/600, zone labels 10px/600 uppercase; text on chips/halo, never raw over candles; text never wears series color.
**Zone states:** forming = ghost `fill-faint` + dotted · active = `fill` + solid origin-edge border · mitigated = `fill-faint` + dashed + 40% desat · invalidated = border-only 50%.
**Institutional rules (machine-checkable, become the visual linter in D):** ≤2 hues + 1 neutral per indicator, ≤4 per chart · line colors in OKLCH L 0.55–0.70 band (pure #0f0/#f00 rejected with snap-to-token) · steady fills ≤16% · glow fires on state change and decays over N bars — never permanent · shape first, color second · no pulsing/blinking; transitions 150–250ms ease-out and settle.
**Legend chips:** one line 20px, `shortName + params`, max-width ~200px middle-truncate, controls on hover only, stack below OHLCV readout, >4 chips/pane collapses to "+N", error = 6px dot + border tint only.
**Branded screenshot export (Phase A/B feature, not afterthought):** opaque `--bg`, 1px gold hairline + bottom bar (compass mark, wordmark @60%, ticker·TF·date), **repaint badge composited into the frame**, 2× DPR render (never upscale), corner-anchored.

---

## 8. Alerts & signal ledger

- **Closed-bar rule: nothing enters the ledger unless it is closed-bar evaluated** (architect R2). The current evaluator fires on the forming bar with cycle-granularity crossings — publishing those fire-times would be an audit trail of our own repainting. Phase A satisfies this by construction (Signature signals are server-computed on confirmed bars only; the legacy evaluator keeps running but its fires do NOT enter the ledger). The evaluator itself is rebuilt in C: evaluate at the last CONFIRMED bar per TF boundary; derive `prev` from the computed series at the prior confirmed bar, not persisted cycle state; `last_value` demoted to delivery-dedup. One fixture feeds a forming bar and FAILS if a cross fires.
- **Ledger (Phase A, write-only):** append-only table recording every Signature signal from launch day (fire-time, defId@version+rev, symbol, TF, bar-close values). Alert-lane events join only after the closed-bar fix. Private-first surfaces (R-multiples, MFE/MAE per signal type) before any public scoreboard.
- **Phase C alert engine:** every plot auto-alertable (crossing/GT/LT/channel) + named events pinned to top with human labels; instance named in alert rows ("RSI(7) crossed 70" vs "RSI(14)"); threshold prefilled from current value; price alerts + push/Discord delivery + fired-alert history (same table family as ledger) + re-arm/snooze; per-TF worst-case latency stated in UI; orphaned bindings go to a visible needs-attention state — never silently dead.

---

## 9. Diagnostics & quality gates (standing, all phases)

1. **Shared golden fixtures** (bars→expected columns JSON) run by vitest AND pytest (later the AST interpreter); one written semantic spec (alignment, warmup, NaN, seeding); rel-tol 1e-9; mandatory session fixtures: extended-hours day crossing UTC midnight + a DST transition (the JS VWAP UTC-day bucketing bug class). `indicator_compute.py` stays plain loops (numpy changes summation order).
   ✅ **THERE IS NO EXCEPTION TO THE REL-TOL RULE. There was exactly one, and it is CLOSED.** `MACD_HEAD_MASK` (§11) held the engine's `macd` COLUMN and the array `StockChart` draws from at NaN on the first `signalPeriod - 1` bars of the MACD line where Python has values (8 bars at 12/26/9). The owner **dropped the mask on 2026-08-02** — measured at **88 changed pixels**, applied in its own commit — so both lanes and the render now agree at 1e-9 everywhere, with nothing carved out. Record: `docs/decisions/2026-08-02-macd-head-mask.md`. **A lane divergence found from here on is a bug and has no precedent to point at** — the one that existed was measured in pixels, signed off by the owner and then removed, which is the bar any future request for an exception is held to.
2. **Nightly end-to-end parity check:** server-computed vs client-path-computed for a hot symbol — catches input-path drift fixtures can't (house real-fetch rule applied to parity).
3. **Visual parity gate:** per-indicator screenshot diff during Flip A (tight, honest); Flip B gets its own four-surface QA. One renderer version under all baselines.
4. **Error isolation:** one indicator throwing never breaks the chart; server failure never blanks a pane.
5. **Lazy Python porting:** port natives to the server registry on demand (alert/premium need), each landing with its fixture. No eager 15-indicator port.
6. **Perf:** compute-time logging + >2× regression alarm; series/pane caps enforced.

---

## 10. Phase A — Signature Launch (immediate; own implementation plan)

**Ships by Sep 5, on the EXISTING chart path (no engine dependency):**
1. **Dark Pool Levels** — DP volume shelves as horizontal levels/zones on price.
2. **Flow-Confirmed Breakout** — breakout markers printing only on options-flow confirmation, closed-bar only.
3. **GEX Walls / Institutional Footprint** — dark pool + blocks + GEX fused at price.

Each: server-computed (hardcoded endpoints acceptable; genericize in C), wrapped serve-stale + single-flight, premium-gated by handler identity, wire format already spec-compliant (§4 null-for-NaN) so Phase B inherits them transport-ready. Hand-audited `non-repainting` badge + one-paragraph "how it's computed" honesty blurb + owner workshop video each. Signal ledger recording from day one. Landing section: receipts positioning aimed at burned-vendor customers. Stretch: branded screenshot export (extends existing `chartScreenshot.js`).

**Explicitly NOT before Sep 5:** LWC bump, engine/registry/binding/panes, settings migration, settings-dialog rework, generic alerts, migration of any existing indicator. The 15 natives ship untouched — untouched code is launch-stable code. (Phase B may BUILD in an isolated worktree during this window; it may not SHIP.)

**Prod note:** `serve_stale.py` (`174359fd`) is not yet deployed — Phase A endpoints depend on it landing first.

---

## 11. Adjudicated decisions log

| Question | Decision | Basis |
|---|---|---|
| Scripting tier (P3) | **Killed as product**; sandbox = AI plumbing only; revisit 2027 on demand | Trader + CEO; TV marketplace war settled; solo-owner security/support tax |
| Pilot pair | **BB + RSI**, MACD third, VWAP late | 4 of 5 seats; VWAP = session semantics + special-cased props |
| `events` in schema v1 | **Yes** (events-as-columns); consumption lands with alert rework | Unanimous |
| Server lane | Signature slice ships AT launch (hardcoded); generic lane in C; wire contract frozen now | CEO inversion + architect/UX P1.5 |
| Per-chart vs global | Global at cutover; `scope` key as data day one; per-chart + templates in C | Launch stability + R4 concurrency |
| LWC 5.2 | Before engine work, after Sep 5, never parallel | Unanimous; one renderer under all baselines |
| Repaint labeling | Audited metadata (A/B) → machine linter with AST (D) | No static analysis of hand-written JS; don't build throwaway introspection |
| Scoreboard | Ledger writes from day one; private surfaces first; public per-toolkit after proof | Trader ("loaded gun") + CEO (time-accrued value) |
| Pricing | No new SKU at launch; Signature strengthens existing premium; endpoints tier-gated from day one; toolkit names seeded in content early | CEO |
| Positioning | "The chart TradingView can't be" — alongside TV, not against it | Trader |
| `volumeProfile` (B3 A4, 2026-08-02) | **Permanently carved out** of the `plots[]` grammar. 15 indicator SETTINGS keys, **14 series-expressible** indicators. It stays a legacy canvas overlay and no B3 flip deletes it; it gets a `compute.kind: 'primitive'` lane when one exists (C/D, alongside `zones`/`bgband`) | It renders to a 2D canvas, not through `addSeries`: no compute function in `indicators.js`, absent from `indicatorData` and `paneMargins`, and no v1 plot style expresses horizontal volume bins. A definition for it could be neither computed nor bound. Written down + railed at `nativeRegistry.CARVED_OUT_INDICATOR_KEYS` |
| **`MACD_HEAD_MASK`** — the MACD head-mask (B3 A5, 2026-08-02) | ✅ **ACCEPTED 2026-08-02 — the owner DROPPED the mask; `MACD_HEAD_MASK = false` ships.** The chart no longer holds the MACD line's head back to the signal's first bar: bars 25-32 (8 at 12/26/9) draw at the values Python and the golden fixture publish. **Cost, measured before the decision and re-confirmed at the flip: 88 changed pixels (0.011828%)**, 20/20 runs, zero variance — one contiguous 44×4 px region at `x ∈ [136,179]`, `y ∈ [394,397]`. Builds `9f566cd22874`→`9045bb69fc56` (measurement) and `f141618f95e6`→`54443afee3e3` (at the flip), `--cases macd_headmask`. **§9.1's exception is CLOSED** — no lane divergence remains, at compute or at the render boundary | The maths was Python's and the fixtures'; the picture was what shipped, and moving it was visible at the start of every MACD chart — so it was priced first and applied second. Parked behind ONE constant that both lanes read (`nativeRegistry.MACD_HEAD_MASK`), which is why the flip was one edit in its own commit and why it measured 88 rather than 0: `macd` is not migrated, so a flip reaching only the engine would have moved nothing a user sees. The constant is KEPT (reversal is one edit, priced the same). Record + both measurements: `docs/decisions/2026-08-02-macd-head-mask.md`; pinned — in the new direction — by `nativeRegistry.test.js` and `engine/__tests__/macdHeadMaskRendered.test.jsx`, both of which go red the moment it moves again |
| **`VWAP_SESSION_ANCHOR`** — session VWAP bucketed by UTC DAY (B3 A7, 2026-08-02) | ✅ **ACCEPTED 2026-08-02 — the owner CORRECTED it; VWAP now anchors on the ET session and `compute.rev` is bumped to 2.** Before the fix, `computeVWAP` restarted its accumulator on a UTC calendar day, not an ET session. Regular hours never notice (09:30-16:00 ET is one UTC day), which is why nothing caught it; on EXTENDED hours — the only hours VWAP renders on — it wipes mid-session at 20:00 ET under EDT and **19:00 ET under EST**, and because Monday evening has already opened the next UTC day, **Tuesday's 04:00 ET open never resets at all**. **Correctness cost that was ELIMINATED: the chart used to open that session at 93.9178 where a session anchor reads 108.3633 — $14.45 wrong — and stayed >$0.50 wrong for 120 of its 193 bars; 207 of 579 bars differed by >$0.01.** **Pixel cost of the correction, measured before the decision and re-confirmed at the flip: 2,590 changed pixels (0.348118%)**, 20/20 runs, zero variance, `--cases vwap_only`. Measurement pair `d64c84c2ebf7` (UTC-day) → `8bbbb44e1110` (ET-session); **applied at `f5afd6db`, re-measured `89f73b36ae29` → `35ec82560ea5`, same 2,590**; independently re-confirmed a third time by review (same pair, 5/5). The SAME 2,590 with `--instances-side both`, because both lanes read one function. Each build independently deterministic (`--same-build --repeat 5`: 0 px). **Blast radius verified ZERO for alerts and backtests** — `vwap` is not in `INDICATOR_FUNCS` (8 keys) so a VWAP alert can be created but can never fire, no backtester rule reads it, and `avwap_reclaim` is pivot-anchored with no time bucketing. Two RENDER surfaces do move and are intended to: `IntradayDayPopover` (forces VWAP on at `tf="5"`, mounted by Model Book) and the headless `ChartRender` newsletter path | Unlike the head-mask this is the MATHS, so applying it is a **`compute.rev` bump** (not `version`) and force-migrates every binding pinned to `vwap@rev 1` — which is why it is a trading decision and not a migration's. Deliberately NOT bundled into the VWAP Flip A commit: both lanes read `computeVWAP`, so correcting it moves A and B together and `engine_vwap_vs_legacy` would still report 0 — the migration would look verified while the picture changed underneath it. Record: `docs/decisions/2026-08-02-vwap-utc-day-bucketing.md`; pinned — **in the new direction** — by `engine/__tests__/vwapUtcBucketing.test.js` and by `goldenFixtures.test.js`'s three session cases, which go red the moment the anchor moves again. The golden fixture already carried BOTH series, so not one fixture byte was reseeded and neither lane could re-baseline underneath the other |
| **`ENGINE_ENABLED_MIGRATION`** — `engineEnabled` is false in every stored blob (B3 A13, 2026-08-03) | 🟡 **OPEN — B3 ships with it unresolved, deliberately, because nothing is broken and the obvious fix is a no-op.** `mergeChartSettings` computes `engineEnabled: parsed.engineEnabled === true` (`chartDefaults.js:404`) — a read of the **stored blob**, never of `CHART_DEFAULTS`. An absent key and an explicit `false` are the same answer, so **flipping the default cannot heal one**, and nothing in shipped source ever writes it `true` (the single occurrence is `ChartRender.jsx:236`, the headless `/r/chart` route, gated on `?instances=`). **Nothing breaks on ship day:** a FLIPPED definition runs the engine regardless of the flag (`engineActive = engineOn \|\| ENGINE_FLIPPED_DEF_IDS.size > 0`) because it has no hand-written block left, and `FLIPPED === MIGRATED`, so all four pilots draw for every existing user — evidenced by `flipBStoredBlobs.test.jsx`'s 25 real blob strings and by the `flipb_*` parity cases (legacy-shaped settings both sides, no instances) reading **0 px**. **What is missing is a decision**, and three things still ride on the flag: a MIGRATED-but-UN-FLIPPED definition needs it (an empty category B4 creates the first time it migrates without flipping — that definition would render for nobody); `engineDrawnInputs` returns EMPTY flag-off, so the toolbar shows the legacy mirror; and `engineInert` is identically false. **⭐ A SEVENTH WRITER was found closing this:** `applyPreset` (in `ChartToolbar.jsx` AND `Settings.jsx`) and `resetToDefaults` write a whole blob spread from `CHART_DEFAULTS`, stamping both engine keys over the user's — the `uctDefaultChartSettings()` hazard class, not an enumeration site, invisible to the discovery scan | **"engineEnabled must be on by ship" is a SETTINGS MIGRATION, not a default flip, and no phase plan has one.** Recommendation, unimplemented on purpose: require *migrate and flip in the same change* (now the runbook's per-indicator checklist rule) so the broken category never exists, and **delete the flag at B5** with the rest of `cs.indicators` — its only remaining job is a phase-internal state no user has an opinion about. If B4 needs a migrated-but-un-flipped definition, ship a **versioned read-time migration first** (`settingsVersion` 1→2; answer from `CHART_DEFAULTS` for a below-version blob with no explicit key; an explicit stored `false` must still win), in its own commit, and re-run the 24-case parity set — `mergeChartSettings` is on every chart's path. ⛔ **Do not flip `CHART_DEFAULTS.engineEnabled` alone**: it changes nothing for any existing user and moves the branch from "the flag decides nothing" to "the flag decides nothing and the tests say it does". Record: `docs/decisions/2026-08-03-engine-enabled-settings-migration.md`; pinned by `engine/__tests__/engineEnabledMigration.test.js`, which asserts the record still says OPEN, asserts the default-flip is a no-op **against the real default flipped in place**, and holds the seventh writer down by object identity plus a bounded source probe |


## 12. Out of scope (v1, affirmed)

Marketplace/user publishing (nothing until the ledger can hold publishers accountable) · auto-trading/execution · custom bar types beyond HA · metered credits for core features · Pine-dialect language · mobile-specific builder UI.

## 13. Handoff to phase plans

Each phase opens with its own implementation plan (writing-plans) against this spec and closes with its gates green. Phase A plan is next. Open items deliberately deferred to phase plans: Signature indicator exact math + thresholds (owner input on trading logic), Phase B worktree strategy during launch window, alert push-delivery transport (existing Discord infra vs web push), ledger table schema.
