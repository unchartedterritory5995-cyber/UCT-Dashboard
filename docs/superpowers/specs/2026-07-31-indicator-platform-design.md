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
| **B — Foundation** | Engine, binding layer, instance-list settings, two-flip migration of the 15 natives, auto-generated settings UI, library dialog | Post-launch freeze lift (Sep 19+); per-indicator parity gates |
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
- **`$<inputKey>` substitution grammar:** valid in plot fields `color`, `width`, `levels`. Resolution failure = definition invalid at registration. Never silent defaults.
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
  - **Flip A:** engine indicators render into the LEGACY stacked-margin bands via the placement adapter — zero geometry change, so per-indicator screenshot-parity gates are tight and honest. Order: LWC 5.1→5.2 bump + regression pass + baseline freeze → settings passthrough → BB + RSI pilots → **MACD third** (colorMode + multi-plot + histogram stress test) → remaining 12 (VWAP late; session semantics + `vwapOverride` special cases).
  - **Flip B:** after all 15 are engine-owned, ONE atomic, feature-flagged cutover from margin-bands to real LWC panes, with dedicated visual QA on all four theme surfaces and a rollback flag. `paneMargins`/`chartRegion` contracts stay unit-tested until Flip B completes.
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

## 12. Out of scope (v1, affirmed)

Marketplace/user publishing (nothing until the ledger can hold publishers accountable) · auto-trading/execution · custom bar types beyond HA · metered credits for core features · Pine-dialect language · mobile-specific builder UI.

## 13. Handoff to phase plans

Each phase opens with its own implementation plan (writing-plans) against this spec and closes with its gates green. Phase A plan is next. Open items deliberately deferred to phase plans: Signature indicator exact math + thresholds (owner input on trading logic), Phase B worktree strategy during launch window, alert push-delivery transport (existing Discord infra vs web push), ledger table schema.
