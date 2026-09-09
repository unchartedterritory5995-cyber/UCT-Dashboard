# UCT Intelligence — Glass Joystick Hub
## Master build plan, v1.2 (Wave 0 gate decisions applied)

Supersedes v1.1. Every change from v1.1 is a Wave 0 gate decision or a correction forced by
`docs/plans/joystick/10-wave0-discovery.md`. Where a decision and a discovered fact disagree, the
decision is applied as closely as the codebase allows and the gap is marked **⚠️ GAP**.

Companion files: `10-wave0-discovery.md` (evidence) · `prototype.html` (gesture feel only) ·
`deferred.md` (everything cut, with its smallest enabling change) · `requests.md` (outside-owner asks).

---

# Part A — What and why

## 1. What we are building

A persistent, mobile-only liquid-glass joystick in the bottom-right corner of every UCT Intelligence
page. It has two jobs:

1. **Navigate** — drag it and a quarter-circle fan of shortcuts opens; release on one to jump to that
   section or fire an action.
2. **Operate** — inside a section, the same knob becomes that section's controller. Tap and double-tap
   move that section's cursor. Drag opens that section's own tool fan.

Hold the knob for half a second to return to Home from anywhere.

**The hub is the corner.** It is not one floating control among several — on touch viewports it is the
only one. The voice orb and the feedback button fold into it (§2c).

The HTML prototype is the reference for gesture feel, animation timing, wedge selection and the glass
look. Its mode/action data is fiction and must be ignored; the real map is Part C.

## 2. Ground rules

- Read the repo's `CLAUDE.md` first. At the end of the build, append a "Joystick hub" section:
  registry location, how to add a mode, tuning constants, known gaps.
- Model routing: Phase 0 and Phase 1 design on Opus; Phases 2–4 may run on Sonnet.
- **Additive by default, with five named exceptions.** No existing route, component or API changes
  except: (a) mounting the hub in `Layout.jsx`; (b) each cursor-bearing section registering its list
  with `useHubCursor` and rendering one data attribute (§2d); (c) `--hub-*` tokens appended to
  `tokens.css`; (d) `forwardRef` + one `useImperativeHandle` exposing `scrollToIndex` on
  `VirtualResults.jsx` and `ResultCards.jsx` (§2d, Wave 0.5 — both are virtualized, including the
  phone card list); (e) `.goLivePill`'s `right` value in `StockChart.module.css` (§2c). Any change
  beyond these five stops and asks. Existing navigation keeps working with the hub disabled.
  *(v1.1 said "additive only". The shared-cursor decision makes that literally impossible — the hub
  cannot own an index into a list it cannot see. The exceptions are the minimum that decision costs.)*
- **Mobile only.** The hub mounts when `width < 1024px` **AND** `(pointer: coarse)`. Both required.
  It never mounts on desktop; there is no mouse-drag path and no keyboard-shortcut path to build or test.
- **Canonical breakpoints only: 640 and 1024.** No 900px anywhere. `app/src/styles/breakpoints.js`
  (`BP`, `MQ`) and `breakpoints.css` are the source; copy their strings, never restate them.
- **Gate visibility in CSS, not on a JS mount condition.** `hooks/useMediaQuery.js` seeds once at mount
  and only updates on a `change` event; in a fixed mobile context that event never fires, so a JS read
  can render the desktop variant on a phone. Use a real `@media` block.
- Users open the app in a regular mobile browser tab, not a PWA. Size with `100dvh`, position against
  `window.visualViewport`, re-run layout on `visualViewport.resize`. Test with Safari's bottom toolbar
  both collapsed and expanded and with Chrome's URL bar hidden and shown.
- **Minimum browsers: iOS Safari 16, Android Chrome 110.** Below that the hub simply does not mount —
  no fallback, no degraded variant. The mount test is
  `CSS.supports('backdrop-filter','blur(1px)') && typeof window.visualViewport !== 'undefined'`;
  if either is false, render nothing.
- **No order placement.** SnapTrade is sync/positions-only, and Wave 0 certified that no order path
  exists anywhere in the repo to cross. "Plan trade" writes to the new `hub_planned_trades` table (§5a)
  and nothing else. `hub.orders` stays off and, if ever on, still requires a confirm sheet.
- **Options Flow is partner-owned.** Read it, never edit it. Flow mode is navigate-only; Wave 0
  confirmed `OptionsFlow.jsx` exports only its default component, so its fan is `[Voice, Home]`.
  Anything Flow needs goes in `requests.md`.
- **UCT20 is never a write target.** It is engine-curated and read-only; its router has no `@router.post`.
- Respect `prefers-reduced-motion` — the global CSS reset (`tokens.css:541-548`) will not stop a rAF
  spring, so copy the JS check in `hooks/useAnimatedNumber.js:13-16` for any JS-driven animation.
- No new dependencies. Framer Motion only if already in `package.json`; otherwise CSS transitions.
- Everything the hub can do is declared in one registry file. Adding a section is a data change.

## 2a. Theme and brand fit

Values below are the app's own, read in Wave 0. Where the brand sheet and the app disagreed, the app wins.

- Canvas `--bg:#101012` (OLED `#000000`, light `#ffffff`) · `--bg-surface` · `--bg-elevated`.
- Brand green `--ut-green:#2d8c4e` (bright `#34d17c`) · brand red `--ut-red:#c0392b` (bright `#f24b42`)
  · `--ut-gold:#dcbb5e` = `--accent`. Green means up/long, red means down/short. No other use of either.
- Text `--text:#f0efea` · borders `--border:#2a2c31` · radii 4/6/8/12/16/999 · `--tap-min:44px`.
- Z-scale: dropdown 100 → sticky 200 → nav 300 → **fab 350** → backdrop 399 → drawer 400 → modal 1000
  → toast 1100. The hub is a persistent floating affordance, so it belongs on the **fab rung (350)**,
  which it now occupies alone on touch.
- **There is no monospace face.** `--font-mono`, `--font-sans`, `--font-display` and `--font-heading`
  all resolve to `Instrument Sans` on purpose. Numbers in bubbles, chips and the confirm sheet use
  `font-variant-numeric: tabular-nums` for column stability — never a second font.
- **Hub tokens live in `app/src/styles/tokens.css`**, appended directly below the existing `--glass-*`
  block, prefixed `--hub-`: `--hub-glass-tint`, `--hub-rim`, `--hub-shadow`, and the per-mode accents.
  No colour literals in component CSS. Glass is white at 6–22% over the dark canvas,
  `backdrop-filter: blur(18px) saturate(160%)`, 1px rim, inset top highlight, soft drop shadow.
- **No light-theme hub set.** `tokens.css:432-436` omits `--glass-*` from the light theme deliberately;
  `--hub-*` follows it. *(⚠️ GAP: the app is not literally dark-only — a `[data-theme="light"]` set
  exists and roughly half the app's colours are still hardcoded hex. The decision stands, but the hub
  will render its dark glass on the light theme. Phase 4 should verify that is acceptable, not assume it.)*
- The pad carries a faint 8-tick compass ring as the brand signature. Nothing else decorative.
- Every bubble carries a `UIcon` glyph (87 available, `UICON_NAMES` exported). No emoji, ever.
- Mode accents: scan `#8fd3ff` · chart `#9d95ff` · flow `#f7c96b` · catalysts `#ffb36b` ·
  breadth `#5dcaa5` · journal `#67DB44` · notebook `#d6a4ff` · calendar `#e9e9e9` · wire `#67DB44` ·
  home `#67DB44`.
- Trader vocabulary in labels: RS, phase, sizing rule, bad break, breakeven, R-multiple, rally day.

## 2b. Platform integration notes (rewritten against the real stack)

**Charts are Lightweight Charts 5.2.0 via `app/src/components/StockChart.jsx`. Chart mode drives the
existing component props and handlers, never the chart instance directly.** There is no TradingView
charting library in this repo and no `widget.activeChart()`-shaped object; `setResolution`,
`setSymbol`, `executeActionById` and `createStudy` do not exist. The mobile chart shell is
`pages/charts/mobile/MobileChartsApp.jsx` (not `MobileWorkspace`, not `MobileChartFallback`).

- Timeframe: `chartWidget.opts.tf`, written through `onOptsChange` (`MobileChartsApp.jsx:144-147`).
  Canonical list `NATIVE_TFS = ['1','5','15','30','60','D','W','M']` (`chart/timeframes.js:12`).
- Symbol: `setGroupSym(color, sym)` from `WorkspaceContext` (`MobileChartsApp.jsx:149-158`). Symbols
  are per colour group (A–D), not app-wide.
- Readiness: `StockChart` has `onBarsReady` but neither `ChartPane` nor `MobileChartsApp` wires it.
  Until it is wired, a command before readiness is a **silent no-op**. Chart actions are disabled
  until `paneRef.current` is truthy; nothing is queued.
- Live numbers come from the pooled SSE store (`lib/priceStreamManager.js`, `hooks/useRealtimePrices.js`)
  or `hooks/useLiveBreadth.js`. Subscribing to an already-streaming symbol is free. **Never issue a REST
  call for something already streaming.**

**The Screener has no fixed scan catalogue.** There are two unrelated concepts: *My screens* (a saved
whole spec, whose identity is discarded on apply) and *My scans* (boolean AST formulas identified by an
opaque `ast_hash`). The eight firm "starters" (`starterScans.json`) are Classic Flag/Pullback, Kicker
Candle, Oops Reversal, Power Earnings Gap, HVC, Remount, VCP, Flat Base Breakout — but a starter is an
ordinary definition that exists only once **the member installs it**, so none is guaranteed present.
See §B11 for the unresolved default.

**There are no membership tiers. One product, one price** (owner ruling, Wave 0.5 gate). `isPaid` =
`role === 'admin'` ∨ `plan ∈ {pro, premium, lifetime}` ∨ active trial (`context/AuthContext.jsx:171-173`)
is a paid/not-paid boolean, not a ladder, and almost the whole app already sits behind it
(`FREE_PAGES = ['/morning-wire']`).

**Consequently `tier` is not part of the action model.** `HubAction` has no `tier` field, the registry
declares none, and there are no locked or upsell bubbles. A user who can see the hub can use every
action in it. The only reason an action is ever disabled is an unsatisfied `requires` — no symbol
selected, no position selected — which is a *context* condition, not an entitlement one, and it reads
to the user as "not yet", never as "not for you".

⚠️ Hub writes must still check `isPaid` themselves where they fire a raw `fetch()`, because some
endpoints (note CRUD) are only `get_current_user`-gated and bypass `AuthGuard`.

**Notebook.** `createNoteViaApi()` (`journal-2-0/lib/noteCreation.js:17-44`) creates a titled,
ticker-linked note in one `POST /api/j2/notes`. `bodyJson` must be built with `lib/tiptapDocBuilders.js`
— the editor has no table extension and table nodes are silently dropped. Eight templates ship on
master, deep-linkable as `/journal/notebook?new=<key>&ticker=SYM`. **Obsidian is a device *push*
connector with no "sync now"** — read `useNoteConnectors().providers.obsidian.connected`; when false,
deep-link `/settings?section=connections`.

⚠️ Note CRUD is `get_current_user`-gated, **not** `require_paid`. A hub action firing a raw `fetch()`
bypasses `AuthGuard` entirely. Hub writes must check `isPaid` themselves.

## 2c. The corner — the hub replaces the FAB stack

On touch viewports the joystick hub is the single bottom-right control.

- **Voice orb** (`components/voice/FloatingOrb.jsx`) no longer renders independently on touch. Voice
  becomes a **"Voice" action on the inner ring of every mode**, calling the exact handler the orb calls
  today: `useRealtimeSession().connect(context)`. Do not reimplement voice capture, and do not edit the
  orb's internals — only the media query that governs where it mounts. **Desktop rendering is untouched.**
- **Feedback FAB** (`FeedbackWidget.jsx`) moves behind the **Peek overlay** (two-finger tap) as a
  "Feedback" button, calling the same handler. *(⚠️ GAP: on touch the feedback button is bottom-**left**
  today, so it never collided with the hub. This decision trades a one-tap affordance for a two-finger
  gesture. Recorded as a deliberate cost, not an accident.)*
- **The chart-page precedent is respected, not overridden.** On the portrait phone chart the hub still
  mounts, but: (1) the fan opens only toward the upper-left quadrant; (2) the scrim excludes the volume
  pane region; (3) the hub sits at the offset the orb used on the wider touch range.
- **Clearance is 68px, on every page**: `bottom: calc(env(safe-area-inset-bottom) + 68px)`, `right: 22px`.
  This replaces v1.1's 28px everywhere it appeared. It matches `FloatingOrb.module.css:204-207` and
  clears the chart toolbar, which owns the bottom edge.
- **The back-to-live chip must never be tap-blocked.** If the hub's hit area overlaps it, the chip
  moves left; the hub does not move.

**Volume-pane exclusion — RESOLVED (Wave 0.5), as an approximation stated honestly.** LWC v5 does expose
live pane geometry (`chart.panes()[i].getHeight()`, `series.getPane()`) and `StockChart.jsx` uses it
internally (`:13398-13401`, `:13559-13573`), but none of it reaches the host — `ChartPane`'s ref has no
`getPaneRects()` and `chartApiById` is desktop-only. Exposing it is a new imperative method on an
existing component, outside the named exceptions, so it stops and asks.

**The scrim therefore excludes `calc(22% + 32px)` of the bottom of `.chartArea`** — the app's own
constant, already used verbatim as the range bar's fallback "above the volume pane"
(`StockChart.module.css:17-20`), where 22% is `cs.volume.paneHeightPct`'s default.

⚠️ Write it in the build as an approximation of the *default* configuration, never as a measurement.
It is wrong in three known ways: volume is an overlay band inside the price pane by default
(`separatePane: false`), not a pane at all; the user can drag the divider anywhere in `[8%, 45%]` and
that latch is unreadable from outside; and volume can be off entirely, or have oscillator panes below it.

**Back-to-live chip — RESOLVED (Wave 0.5): it overlaps, and the chip moves.** Measured, the hub's
top-left corner clips the chip's bottom-right by **20px wide × 2–7px tall**, at every safe-area value
and growing with it. Thin on paper; a finger's contact patch is an order of magnitude larger.
**Fix: `.goLivePill`'s `right: 86px` → `118px`** (`StockChart.module.css:749`), landing it 12px clear of
the hub's left edge. No vertical change. This trades away the chip's original justification (clearing
the 76px price axis) — an accepted cost per the rule above, and it belongs in the comment.

**Landscape — the hub hides.** Under the chart shell's landscape-immersive query
(`pointer:coarse` + `orientation:landscape` + `max-height:500px`, scoped to
`html[data-mobile-chart-shell]`), the hub is `display:none`, following the orb's own precedent at
`FloatingOrb.module.css:282-283`.

⚠️ The orb is **not** partner-owned — `components/voice/` is in-house (only Options Flow is Ravi's), so
no ownership request is needed for it. `requests.md` carries the one genuine outside-owner item Wave 0
found (the stale `of-tip` hook in `OptionsFlow.jsx`).

## 2d. One shared cursor

**No section builds its own cursor state.** Phase 1 builds exactly one hook:

```ts
useHubCursor(listId: string, items: unknown[], opts?: { key?: (item) => string })
  → { item, index, count, next(), prev(), scrubTo(delta) }
```

- Sections **register their list**; the hub owns the index.
- Selection highlight is **one CSS class applied via a data attribute** (`data-hub-cursor="active"`),
  defined once in a global stylesheet — **not** per-section markup, and **not** in a CSS module
  (modules hash bare selectors; a module class would not match the attribute the hook writes).
- The cursor **resets when the underlying list identity changes** and **persists across fan open/close**.

Sections in scope: **Screener results · Journal open positions · Catalysts rows · Notebook list ·
Calendar days · Morning Wire segments** (using the existing `rd-seg` keys as the item list).
Calendar is confirmed to exist: route `/calendar`, UI label "UCT Terminal".

**Virtualized cursor — RESOLVED (Wave 0.5): cheap.** `forwardRef` + one `useImperativeHandle` exposing
`scrollToIndex` on each of `VirtualResults.jsx` and `ResultCards.jsx` — **both** are virtualized,
including the phone card list. This is exception (d) in §2. Without it the cursor caps to loaded rows,
which means a hard stop or a fetch-stall every 100 rows (`PAGE_SIZE = 100`).

**One hook, two consumption modes.** Five sections attach `data-hub-cursor="active"` declaratively in
JSX. **Morning Wire cannot** — its "rows" are DOM nodes inside a `dangerouslySetInnerHTML` blob, so it
toggles the attribute imperatively inside a `useEffect`, mirroring its own existing `data-fb-vote`
injection (`MorningWire.jsx:169-273`). The hook's `items` array stays generic; only the painting differs.

⚠️ Three sections (Screener, Journal, Catalysts) render a **locally re-derived** array — filtered,
sorted, or merged — that differs from what was fetched. Register *that* array, not the raw one, or
"next" and "previous" will move to visually non-adjacent rows. **Catalysts must gate its registration on
`!compact`**, or the second `CatalystTable` instance in Morning Wire's rail double-registers the same
`listId`.

The selection rule lives in `tokens.css` as a global `[data-hub-cursor="active"]` rule. Precedent for
the exact shape exists: `:global([data-flash="true"])` in `TranscriptSearch.module.css:83`. No `memo()`
or prop-spread hazard was found in any of the six sections.

## 2e. Adaptability

- `src/hub/registry.ts` exports `modes` and `defineMode()`. A new section is one object.
- Actions declare `requires` (`'symbol'`, `'position'`, `'brokerage'`); the hub **disables** what the
  context cannot satisfy instead of hiding it.
- `useHubMode(modeConfig)` registers a page's tap/double-tap/fan for as long as it is mounted.
  Route-derived defaults still work for pages that never call it.
- User overrides are a JSON patch on top of the registry, never a copy, so new default actions reach
  existing users.
- Keyboard mapping is out of scope. The registry may still emit a shortcut map for tablet keyboards,
  but nothing in this build depends on it.

---

# Part B — Build phases

## 3. Phase 0 — Discovery — ✅ COMPLETE

Delivered as `docs/plans/joystick/10-wave0-discovery.md`: route table, shell location, the bottom-right
slot census, state map with file paths, platform inventory, the deferred list, and nine corrections to
`CLAUDE.md`. Approved at the Wave 0 gate.

## 3.5 Phase 0.5 — UX design (no code)

The UX lead and specialists finalize Part C against the scout reports: confirm every Primary / Reverse /
Scrub is backed by real state, produce the label sheet (every bubble ≤10 chars, sentence case, one
`UIcon` each), the accessibility plan, and the mobile-browser viewport plan. Must also settle the four
⚠️ GAPs above: the volume-pane exclusion, the virtualized-cursor cost, the Catalysts activation gesture
(prefer tap-to-activate over scroll-into-view, to avoid surprise mode changes), and the default scan.
**Approval gate.**

## 4. Phase 1 — Registry, context, cursor

Create:

- `src/hub/registry.ts` — typed modes and actions:

```ts
type HubAction = {
  id: string;
  label: string;          // ≤ 10 chars, sentence case
  icon: string;           // a UICON_NAMES value — required, never optional
  ring: 0 | 1;            // 0 = outer (push hard), 1 = inner (push soft)
  color: string;          // a --hub-* token
  kind: 'navigate' | 'run' | 'confirm' | 'home';
  to?: string;
  run?: (ctx: HubContext) => void | Promise<void>;
  confirmText?: (ctx: HubContext) => string;
  requires?: Array<'symbol' | 'position' | 'brokerage'>;
  enabled?: (ctx: HubContext) => boolean;
  flickable?: boolean;    // default true; false = deliberate selection only, never a <120ms flick
};
type HubMode = {
  id: string; label: string; color: string; route?: string;
  tapHint: string;
  cursor?: { listId: string };
  onTap?: (ctx: HubContext) => void;
  onDoubleTap?: (ctx: HubContext) => void;
  fan: HubAction[];       // max 5 on ring 0, max 4 on ring 1
};
```

- `src/hub/HubContext.tsx` — `mode`, `setMode`, and the shared cross-section values `symbol`,
  `timeframe`, `activeScan`, `selectedPosition`. Modes derive from the route by default.
- `src/hub/useHubCursor.ts` — §2d. **The only cursor in the build.**
- `src/hub/useHubMode.ts` — per-page registration.

Wire only `navigate` actions this phase; `run` and `confirm` call a placeholder toast. **Approval gate.**

## 5. Phase 2 — Gesture engine and glass UI

Build `src/hub/JoystickHub.tsx` and children.

- Pointer events only (`pointerdown/move/up/cancel`) with pointer capture; `touch-action: none` on the pad.
- Exported constants: knob travel 24px · open threshold 10px · hold 500ms · double-tap window 280ms ·
  flick window 120ms · outer/inner split at 80% travel · fan radii 150/96px · 90° quadrant opening
  toward the upper-left.
- Full vocabulary from C1: tap, double-tap, hold (home), hold+drag (scrub, live readout in the chip),
  soft/hard push fans, flick, two-finger tap (Peek — which also carries the Feedback button, §2c).
  Scrub emits a normalized `delta` and a `commit`.
- **The Actions button.** A small, always-visible `<button>` beside the knob, labelled "{Mode} actions",
  single-tap, opening the same Peek sheet the two-finger gesture opens. **Not optional and never gated
  on screen-reader detection** — see §C2 for why the two-finger gesture cannot be the only door.
- `flickable: false` actions are excluded from flick resolution entirely: a flick in their direction
  opens the fan instead of firing. Journal's **Close** is the first such action.
- **The open threshold and the ring split are fractions of `travelPx`, not fixed pixels** (10/24 and
  0.8). At a user-lowered `travelPx: 16`, a hardcoded 10px threshold would move "open the fan" from 42%
  of travel to 62% — a different gesture the settings page never described.
- `-webkit-touch-callout: none; -webkit-user-select: none; user-select: none` on the pad.
  `touch-action: none` does **not** suppress the iOS text loupe; these three do, and are already used
  for the chart's own long-press at `MobileCharts.module.css:722-729`.
- Pointer capture is load-bearing, not a nicety: travel is 24px but fan radii are 96–150px, so every
  real drag leaves the pad's hit-box immediately.
- Every rAF-driven visual (knob spring-back, fan reveal) checks reduced motion and **snaps to the final
  value in one frame**. Remove interpolation, never functionality — the fan still appears, instantly,
  every bubble at final position. Export `reduceMotion` from `hooks/useAnimatedNumber.js:13` rather than
  writing a sixth copy of the same `matchMedia` check.
- Selection by **wedge angle** — nearest action within ±30° of the pointer angle, in the ring chosen by
  push distance — never by hit-testing bubbles. Highlight the wedge and bubble; recolour the knob dot.
- Haptics via the **existing helper** `components/mobile/haptics.js`: `tap()` on selection change,
  `impact()` on open, `success()` on fire, `warn()`/triple pulse when a confirm sheet opens. Do not add
  a second `navigator.vibrate` call site.
- Dim + freeze: a scrim covers the page while the fan is open and the page beneath receives no pointer
  events. **On the portrait phone chart the scrim excludes the volume pane region** (§2c ⚠️ GAP).
- The mode chip left of the hub shows mode label and tap hint; hidden while the fan is open.
- **Position: `right: 22px; bottom: calc(env(safe-area-inset-bottom) + 68px)`, on every page.** Never lower.
- Mounts only under `width < 1024px AND (pointer: coarse)`, gated in CSS, and only when the browser
  minimums in §2 are met.

Acceptance: on a real phone, ten consecutive fan selections land on the intended target with no
misfires; the knob springs back; no scroll jank while dragging; the back-to-live chip stays tappable.
**Approval gate.**

## 5a. Phase 2a — `hub_planned_trades`

A new narrow table. **`j2_positions` gets no status column — it remains a broker mirror.**

```
hub_planned_trades(
  id, user_id, symbol, entry, stop, size, r_value,
  source_mode, created_at,
  status ENUM('planned','converted','discarded')
)
```

Alembic migration + a FastAPI router with create / list / discard, user-scoped identically to
`j2_positions`. Sheet defaults: **entry** = last price from the stream store; **stop** = computed by the
Journal 2.0 stop-placement mode in effect (`settings.defaultStop.mode` ∈ `custom | bar_low_high |
fixed_dollar_risk | fixed_percent_distance`, reusing the `prefillStop()` logic now private to
`AddPositionModal.jsx:59-95`); **size** = the user's sizing rule via `computeDefaultShares()`, else 0
with the field highlighted; **R** from the existing calc module (`lib/journal-2-0/calculations.js`) —
reuse, never reimplement. Buttons: **"Save plan"** (primary, brand green) and **"Cancel"**. No third button.

## 6. Phase 3 — Section controllers, ordered by discovered ease

**Morning Wire → Breadth → Screener → Chart → Journal → Catalysts → Notebook → Home → Flow.**

Wire is first because its segments are already addressable and need no new state. Breadth is second
because `pages/breadth/BreadthScrubber.jsx` already exists over an in-memory series. Flow is last and is
navigate-only.

Toast: reuse `journal-2-0/lib/useJournalToast.jsx`. ⚠️ It is a per-consumer chip, not a global stack —
the hub mounts its own. **Approval gate.**

## 7. Modes

Ten mode ids, seeded from Part C: `wire · breadth · scan · chart · journal · catalysts · notebook ·
calendar · home · flow`. Outer ring ≤5, inner ring ≤4, inner ring ends with Home (Home mode excepted —
see C3). Actions needing a symbol or position are disabled when none is selected.

## 8. Phase 4 — Settings and polish

- **Settings → Joystick**, persisted through `usePreferences()` (`app/src/hooks/usePreferences.js`)
  using `setPrefMerged(key, updater)` under a single pref key `joystick_hub`, exactly as
  `chart_settings` does — one row in `user_preferences(user_id, pref_key, pref_value TEXT)` via
  `GET/POST /api/auth/preferences`. Schema:

```ts
{ enabled, handedness, haptics, holdMs, travelPx, stickyFan, overrides }
```

  Defaults come from the registry; `overrides` is a JSON patch, never a copy.
- Auto-hide while a text input is focused.
- First-run coach mark: one glass tooltip, "Drag for shortcuts, tap to act, hold for home." Dismisses
  permanently.
- **No analytics.** There is no authenticated in-app event sink in this app. Leave exactly one
  `// TODO(hub-analytics): emit here` in the registry's `fire()` path and one line in `deferred.md`.
  Nothing else.

## 9. Things not to do

- Do not restyle or relocate existing navigation.
- Do not add a router library or a global state library.
- Do not add any order-placement path. `hub.orders` stays off.
- Do not modify Options Flow source.
- Do not add a status column to `j2_positions`.
- Do not lift `crosshairData` out of `StockChart`'s component state in this build.
- Do not write to UCT20.
- Do not build a second cursor, a second haptics helper, or a second toast.
- Do not put more than 5 actions on the outer ring or 4 on the inner ring.

## B10. Response protocol

At the end of each phase: files created or changed, what was verified on device or in the browser, gaps
discovered, and the exact questions needed. Then stop.

## B11. Open fill-ins

- **Default active scan: none — RESOLVED (Wave 0.5 gate).** Scan mode enters against whatever spec the
  Screener currently holds; the chip reads "Screener · n/N". No scan is preselected. This is a
  deliberate hold, not an oversight — the owner will name one later, at which point the eight firm
  starters are the candidate set: Classic Flag/Pullback · Kicker Candle · Oops Reversal ·
  Power Earnings Gap · HVC · Remount · VCP · Flat Base Breakout. Whoever fills it must remember a
  starter is an ordinary definition that exists only once the member installs it, so a named default
  needs a fallback for members who have not.
- **Handedness default: right.** Mirror option in settings.
- **Rollout: `hub.enabled`, default off for everyone — RESOLVED (Wave 0.5 gate).** There is no founder
  tier and no tier ladder at all: one product, one price. The flag is therefore **not** a tier gate. It
  is the per-user `joystick_hub.enabled` preference (§8), defaulting **off**, with `role === 'admin'`
  the one identity defaulted **on** — the only distinction this codebase draws between the firm and a
  member. Members opt in through the Settings toggle when the owner opens it; flipping the default for
  everyone is a one-line change to the registry default, not a migration.
- **Minimum browsers: iOS Safari 16, Android Chrome 110.** Applied in §2.

**No open fill-ins remain.**

---

# Part C — In-section interaction model

## C1. The gesture vocabulary

| Gesture | Name | Rule |
|---|---|---|
| Tap | Primary | The single most repeated action in that section |
| Double-tap | Reverse | The inverse of Primary |
| Hold 0.5s | Home | Always returns to Home. Never remapped |
| Hold + drag | Scrub | Continuous control; release commits |
| Drag (soft push) | Inner fan | Section tools, ≤4, ends with Home |
| Drag (hard push) | Outer fan | Section actions, ≤5 |
| Flick (<120ms) | Quick | Fires the outer action in that direction without opening the fan |
| Two-finger tap | Peek | Gesture map + tap-to-select for every action + the Feedback button |

Constraints:
- Primary and Reverse must be safe to fire accidentally — never destructive, never sends anything.
  Validated in Wave 0.5: every Primary and Reverse across all ten modes is a navigate-or-read action;
  none writes. This binds hardest on Catalysts, where the 👍/👎 and note controls steer future editorial
  picks, and on Journal, where a stop is the number that makes displayed risk honest.
- **Anything that writes goes through a sheet with an explicit button** — including Journal's
  **Close** and **Breakeven**, which v1.1 left unconfirmed. Every confirm sheet is primary + secondary
  ("Save stop" / "Cancel"), never a third button and never one button alone.
- Scrub always shows a live readout in the mode chip.
- **Every action is reachable without a drag** — via Peek, opened by the **Actions button** (single tap)
  or the two-finger gesture. The button is the door that actually satisfies WCAG 2.5.1; the gesture is
  the fast path for users who have no screen reader running.

## C2. Accessibility commitments

- **No `role="toolbar"`** (v1.1 mandated it; Wave 0.5 removed it). A toolbar role exists to redirect
  arrow keys and there is no keyboard in this build: VoiceOver flattens it to nothing, TalkBack charges
  Android users an extra swipe for it, and its contract — a fixed, always-visible command set —
  describes a state the fan is in essentially never. The knob is a single `role="button"` named for the
  current mode; the pad and compass ring are `aria-hidden`; the mode chip is `role="status"
  aria-live="polite"`; sheets and Peek reuse `components/mobile/Sheet.jsx` verbatim for dialog
  semantics, focus trap, Escape and focus restore.
- **⛔ The two-finger tap cannot be Peek's only door.** VoiceOver and TalkBack both reserve two-finger
  single-tap for pause/resume speech and consume it before the page sees a `pointerdown`, so the
  affordance that guarantees "no action is drag-only" is unreachable for exactly the users it protects.
  It also fails **WCAG 2.5.1** on its face — two fingers is two pointers, not a single-pointer
  alternative. The **Actions button** (§5) is the compliant door.
- Use `aria-disabled`, never the native `disabled` attribute — `disabled` can make a control
  unreachable by VoiceOver's touch sweep, which would hide the very actions whose reason we want read.
  Force `role="list"`/`role="listitem"` in Peek: iOS VoiceOver drops list semantics under
  `list-style: none`.
- Every action announced with mode context ("Scan mode, result 3 of 41"). The **wedge-selection string
  is the action label alone** — no verb, no ring, no mode — because it fires at drag speed and
  `aria-live` coalesces overlapping updates unpredictably. The confirm sheet gets **no** live
  announcement: its `aria-label` is the confirm text and `Sheet.jsx` focuses the panel, so adding one
  double-speaks the same sentence.
- Scrub is exposed as a native `<input type="range">` with `aria-valuetext` carrying a human-readable
  string (the `BreadthScrubber.jsx:95-102` precedent) — both screen readers give a focused range control
  a one-finger swipe-up/down adjust, which is a free no-drag path for Scrub specifically.
- Voice: the inner-ring "Voice" action opens the existing realtime session, which already understands
  `open_page`, `open_ticker`, `change_chart_timeframe`, `add_chart_indicator`, `change_chart_type`.
- Motor: `travelPx` 24 (range 16–48) matters most for **tremor** — more distance between "tap" and
  "drag", more angular room between wedges. `holdMs` 500 (range 300–1200) matters most for **limited
  reach**, where the cost is sustaining contact in an awkward posture, not precision. Double-tap window
  280 (range 200–600). Left/right mirroring moves the pad, the fan quadrant and the chip as a unit.
  `stickyFan` keeps the fan open for tap-to-select.
- A ≤10-char label in a 46px bubble cannot survive 200% text scaling. It does not have to: the bubble is
  icon-first and may truncate, **because every label also exists as a normal-flow button row inside
  Peek**, where it simply wraps. The fan is allowed to be shorthand precisely because Peek is the
  complete, zoom-safe list. The mode chip must wrap or grow leftward, never clip.
- Vision: high-contrast variant (opaque tint, 2px rim); labels scale with system font size; colour is
  never the only signal — every bubble has a `UIcon`.
- Haptics on every state change; disableable.

## C3. Per-section map

Fans below are the real ones. Anything the spec once promised that Wave 0 found unbacked is in
`deferred.md`, not here.

### wire — `/morning-wire`
- Primary: next segment. Reverse: previous. Scrub: read progress. Chip shows the segment label.
- Cursor list: the `section.rd-seg[data-seg]` keys — `tape, macro, earn, analyst, movers, setups, close`.
- Outer: Chart it · Flag · Note. Inner: Voice · Home.
- "Chart it" reads the current segment's symbol via the seven block classes (`.rd-pick-sym`,
  `.rd-lv-sym`, `.rd-rs-sym`, `.rd-order-sym`, `.rd-cal-tk`, `.rd-ti-sym`, `.rd-watch-sym`).
- ⛔ The per-segment 👍/👎/note controls are never one gesture away — a note shifts the next brief.

### breadth — `/breadth`
- Primary: next session. Reverse: previous session. Scrub: walk the daily series; readout shows date
  and value. Reuse `pages/breadth/BreadthScrubber.jsx` and the Views tab's in-memory window.
- Outer: Sizing rule · Snapshot. Inner: Voice · Home.
- *Changed from v1.1:* Primary was "next metric group". Groups are a rendering detail with no state
  (`Breadth.jsx:882-888`) — deferred. Phase detail, Sectors, Scan-with-breadth-filter and Compare have
  no entry points — deferred.
- **Targets the Views tab** (`key: 'heatmap'`) — the only one wired to `BreadthScrubber`. Phones land on
  Daily, which has no day-stepping concept at all, only a metric picker. **The hub switches tabs rather
  than disabling the scrub**: it calls the page's own `setActiveTab('heatmap')` first when needed, and
  it is free — Views defaults to `viewsDays = 90`, the same SWR cache key Daily and Monitor already use.

### scan — `/screener`
- Primary: next result. Reverse: previous. Scrub: fast-scroll the result list.
- Cursor list: the rows in `ScannerShell`. Chip reads "Screener · 3/41" (see B11 on the name).
- Outer: Chart it · Flag · Alert · Plan trade. Inner: Scans · Why? · Voice · Home.
- Flick up = Chart it. Flick left = Flag.
- Result selection sets the shared `symbol`. Sort is deferred — the phone has no sort UI at all.

### chart — `/charts`
- Primary: next timeframe. Reverse: previous. Chip reads "NVDA · 4H".
- Scrub vertical: cycle symbol via `setGroupSym`. **Scrub horizontal ships**: `stepBar(dir)`
  (`StockChart.jsx:14510-14517`) takes an unconstrained numeric delta — `stepBar(0.3)` works — and is
  already exposed unmodified on `ChartPane`'s ref, which the mobile shell holds. Convert per-frame pixel
  delta to a bar-logical delta and call it on each `pointermove`. Known rough edge: `stepBar` does not
  fetch more history at the window edge, so a long scrub can run into blank space.
- Outer: Plan trade · Alert · Flag · Compare. Inner: Log trade · Note · Voice · Home.
- **"Alert" is at last price**, not crosshair, via `useWatchlistAlerts().createAlert(sym, price, direction)`
  — that path exists on the client and is confirmed buildable.
- **Compare ships.** It writes `cs.comparisonSymbols` through the `handleStore` the mobile shell already
  owns — the same call shape the mobile chart-type sheet uses today. Verified in Wave 0.5: the write
  reaches `StockChart`'s render path, the desktop `chartApiById.setComparison` is the *identical*
  `{...cs, comparisonSymbols}` write rather than a separate system, and `hideCompare` only suppresses
  the legacy single-symbol UI, not the overlay. The only new work is a symbol-picker sheet.
- **"Log trade" needs no deep link** — `GlobalAddPositionProvider` already opens `AddPositionModal`
  from anywhere in the app.
- Draw, Indicator and Alert-at-crosshair are deferred.

### journal — `/journal/trades`
- Primary: next open position. Reverse: previous. Chip shows "NVDA · +1.4R · stop 176.40".
- Scrub: adjust the selected position's stop; readout shows new stop and resulting R; release opens a
  one-button confirm sheet ("Set stop 178.10 → 1.6R").
- Outer: Chart it · Move stop · Breakeven · Close. Inner: Add trade · Note · Voice · Home.
- ⛔ **Move stop, Breakeven and Close are all `kind: 'confirm'`.** v1.1 gave only Move stop a sheet.
  Close ends a position and writes a permanent `j2_trades` row — on a sub-120ms flick it is the
  highest-stakes target in the hub. **Close is additionally `flickable: false`**: a flick in its
  direction opens the fan instead of firing.
- Stop writes go to `PUT /api/j2/positions/{id}`. **`activeStop(p)` is the stop in force**; "breakeven"
  sets `breakevenStop` and never mutates `stopPrice`, so R stays honest on close.
- Live open-position R needs one new pure function beside `tradeRMultiple` — additive, not a new system.
- Scrub-to-adjust-stop must also work as +/− steppers and a numeric field in the sheet.
- Stats and Tag setup are deferred — no per-position entry points exist.

### catalysts — in-place on `/dashboard`
- **Not navigate-only.** An in-place mode activated by **tapping the tile's title span**
  (`CatalystTable.jsx:624-625`) — chosen because it is the one element in the tile with no existing
  handler: the ticker cell opens `TickerHubSheet` on touch and the thesis cell toggles expand. Hold-0.5s
  and the inner Home bubble both exit, flipping the hub back to `home` **without navigating** (there is
  no route to leave). On a market closure the tile renders `TheWeek` instead, so the target is simply
  absent — no special-casing needed.
- Primary: next row. Reverse: previous. Row highlight is the selection. **No scrub.**
- Outer: Chart it · Flag · Why?. Inner: Filter · Note · Voice · Home.
- **Filter cycles the real four: Catalyst → Earnings → Gapper → News.** Chip shows the active one.
- Removed from the spec: unread state, "next unread", timeline scrub, "Mark read" — none exist.
  Mute ticker is deferred (no mute path).
- "Why?" navigates to `/ai-search?q=…`. "Note" pins via `createNoteViaApi`.
- ⛔ The 👍/👎 and note controls are never one gesture away.

### notebook — `/journal/notebook`
- Primary: next note. Reverse: previous note. Scrub: scroll the notes list.
- Outer: New note · Link ticker · Templates. Inner: Daily plan · Post-mortem · Voice · Home.
- The two inner shortcuts deep-link the existing templates: `?new=daily-prep` and `?new=trade-review`,
  carrying `&ticker=` from the shared symbol.
- *Changed from v1.1:* Primary was "new note", Reverse was "search". Search cannot be opened
  programmatically (deferred), and putting the cursor on the notes list matches the shared-cursor
  decision. "New note" moved to the outer ring. Voice note is deferred.

### calendar — `/calendar` (UI label "UCT Terminal")
- Primary: next day. Reverse: previous day. Scrub: across the week. Chip shows day and event count.
- Outer: Earnings · Macro · My names. Inner: Voice · Home.
- "My names" opens `/calendar/mystocks`, which already exists over watchlists ∪ flagged ∪ positions ∪ UCT20.
- Event alerts and Add-to-Notebook are deferred — no per-event control, no wiring. There is no
  econ-only view (Earnings is effectively always on).

### home — `/dashboard`
- Primary: last-used section. Reverse: Morning Wire. Scrub: cycle today's summary cards (open
  positions, breadth, catalyst count) with the chip reading each.
- Outer: Scan · Chart · Breadth · Wire · Flow. Inner: Journal · Notebook · Calendar · Voice.
- **Home mode is the one exception to "inner ring ends with Home"** — you are already there.
- Catalysts is entered by tapping its tile, not from the fan.
- **"Last-used section" defined.** A section is one of the eight route-backed modes, matched **against
  the registry route table, not raw pathname** — `/journal` has nine sibling sub-routes and only two are
  hub modes, so visiting `/journal/insights` must leave the stored value untouched. `/dashboard` is
  excluded: recording it would make Primary a no-op exactly when it is tapped. New client state, a
  `localStorage` write on route change, copying `usePageTracking()`'s shape (`Layout.jsx:17-39`).
- **On a first-ever visit with nothing stored, Primary is inert** — disabled, no navigation. Defaulting
  it to Wire was rejected: Primary and Reverse would fire the same destination on a new account, which
  reads as a bug rather than a design.

### flow — `/options-flow`
- Navigate-only. Fan = Voice · Home. Primary/Reverse unassigned.
- Confirmed: `OptionsFlow.jsx` exports only its default component. Nothing to call.

## C4. Cross-section conventions
- Shared `symbol`, `timeframe`, `activeScan`, `selectedPosition` live in hub context.
- **"Flag" always means `useFlagged().toggle(symbol)`** — the app's existing universal watch, which
  writes localStorage synchronously and debounce-syncs. Toast: "Flagged NVDA" / "Unflagged NVDA".
  *(Renamed from "Watch" throughout. UCT20 is never a write target.)*
- **"Why?"** always means Sonar research on the current symbol, via `/ai-search?q=…`.
- **"Note"** always means a Notebook entry pinned to the current symbol via `createNoteViaApi`.
- **"Voice"** always calls `useRealtimeSession().connect(context)` — the orb's own handler.
- Any action that opens a sheet returns focus to the knob on close.

---

# Part D — Agent organization

Unchanged from v1.1 in structure; the 24 role definitions are written to `.claude/agents/`. Two
amendments from Wave 0:

- **Wave 0 ran on read-only agents**, whose tool list excludes Edit/Write, rather than on prompt-level
  read-only instructions. Verified afterwards with `git status`: nothing written. Keep this pattern —
  enforce read-only at the tool list, never only in the prompt.
- The **Mobile-browser specialist** owns the two viewport ⚠️ GAPs (volume-pane exclusion, visualViewport
  behaviour under a collapsing toolbar at the new 68px offset). The **Registry engineer** owns the
  virtualized-cursor question with the Architecture lead.
