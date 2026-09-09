# UCT Intelligence — Glass Joystick Hub
## Master build plan, v1.6 (adds the Phase 2 DEVICE-RUN-1 rulings: F-1 and F-2)

Supersedes v1.4. Every change is a gate decision or a correction forced by
`10-wave0-discovery.md` / `20-wave05-ux.md` / the Phase 1 build. Where a decision and a discovered
fact disagree, the decision is applied as closely as the codebase allows and the gap is marked **⚠️**.

## ⛔ THIS APP HAS NO TYPESCRIPT — every hub file is `.js` / `.jsx` with JSDoc typedefs

Measured at the Phase 1 build: no `tsconfig.json`, no `typescript` dependency, and **0 `.ts`/`.tsx`
files against 1,332 `.jsx`**. Adding TypeScript would be a new dependency, which §2 forbids.

**The consequence is bigger than the file extension: the JSDoc typedefs are checked by NOTHING at
build time. `validateRegistry()` is the only type enforcement that exists, and every one of its rules
is tested in both directions** — a fixture that fails it and a control that passes — because a
validator nobody has watched reject something is not a validator.

Wherever this document says `registry.ts`, `HubContext.tsx`, `useHubCursor.ts` or `useHubMode.ts`,
read `.js` / `.jsx`. The shipped paths are `app/src/hub/registry.js`, `HubContext.jsx`,
`useHubCursor.js`, `useHubMode.js`, `useHubSettings.js`, `hubRoutes.js`, `HubRoot.jsx`.

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
- **Additive by default, with NINE named exceptions — this list is the single authority.** No
  existing route, component or API changes except:
  - **(a)** mounting the hub in `Layout.jsx` (this covers the orb / feedback-FAB *mount conditions*
    at Layout level; their internals stay untouched);
  - **(b)** each cursor-bearing section registering its list with `useHubCursor` and rendering one
    data attribute (§2d);
  - **(c)** `--hub-*` tokens appended to `tokens.css`;
  - **(d)** `forwardRef` + one `useImperativeHandle` exposing `scrollToIndex` on
    `VirtualResults.jsx` and `ResultCards.jsx` (§2d — both are virtualized, including the phone
    card list);
  - **(e)** `.goLivePill`'s `right` value in `StockChart.module.css` (§2c);
  - **(f)** two glyph additions to `ICONS` in `app/src/components/ui/UIcon.jsx` (§2f);
  - **(g)** `Layout.pageTracking.test.jsx` and `Layout.routeSuspense.test.jsx` mocks completed to
    declare `parsePref`. A mock that misrepresents its module is a trap for the next reader, and
    working around it in production code is backwards.
  - **(h)** the mount condition around `<GlobalVoiceGate/>` in `App.jsx` — one `if (hubActive)`
    guard, nothing else. The orb mounts OUTSIDE the routed `<Layout/>` tree, so exception (a) could
    not reach it, and without this the hub does not own the corner: Wave 0 measured its 84px box
    overlapping the orb cluster's satellites by 36–42px. Both gates read the same
    `hub/useHubActive.js`, so they cannot drift.
  - **(i)** two entries added to `AWAITING_A_DECISION` in
    `app/src/components/screener/reachable.test.js` for `useHubMode.js` / `useHubCursor.js`, in the
    rail's own comment format, each naming its Phase 3 mount point as the removal condition.

  Any change beyond these nine stops and asks. Existing navigation keeps working with the hub disabled.
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
- ⛔ **CONCURRENT CHART WORK — a separate session is building custom indicators on another branch.**
  Do not modify `StockChart.jsx` or anything under the chart's indicator/study code. The only
  chart-adjacent edits permitted are exception (e) and *reading* refs the mobile shell already holds
  (`stepBar`, `setGroupSym`, the timeframe setter, the `comparisonSymbols` write).
  **Hard prerequisite before Phase 3 Chart-mode wiring:** rebase `feat/joystick-hub` onto master once
  the indicators branch merges, then re-run Wave 0's chart scout to confirm the ref surface is
  unchanged. If Phase 2 device testing shows a conflict with new indicator UI, log it in
  `requests.md` and continue — never resolve it by editing chart code.
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
  breadth `#5dcaa5` · notebook `#d6a4ff` · calendar `#e9e9e9`.
- **The three greens are now distinct siblings** (v1.2 gave one hex to journal, wire and home, which
  collided in Home's own fan). Home keeps brand green as the brand mode; journal derives darker, wire
  lighter. All three are `--hub-*` tokens; no literal appears in component CSS.

  | Mode | Token | Hex | vs canvas | vs resting glass | **vs strong glass (worst case)** |
  |---|---|---|---|---|---|
  | home | `--hub-mode-home` | `#67DB44` | 10.67 | 7.29 | **5.38** |
  | journal | `--hub-mode-journal` | `#4FB833` | 7.45 | 5.09 | **3.76** |
  | wire | `--hub-mode-wire` | `#9FE887` | 13.00 | 8.88 | **6.55** |

  All three clear the 3:1 non-text floor at every tier. Journal is the thinnest at 3.76 and is the one
  to confirm on device.

  ⚠️ **This mitigates the collision; it does not eliminate it.** The pair that actually co-occurs is
  Wire (outer ring) beside Journal (inner ring) in Home's fan, and their luminance separation from each
  other is only **1.74** — weak for a hue-blind viewer. They remain distinguishable by ring radius, by
  bubble size (46px vs 36px) and by icon, which is why C2's "colour is never the only signal" rule is
  load-bearing here rather than decorative.
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
- **Clearance is 68px, on every page**: `bottom: calc(env(safe-area-inset-bottom) + 68px)`, `right: 24px`.
  The 68px replaces v1.1's 28px everywhere it appeared; it matches `FloatingOrb.module.css:204-207` and
  clears the chart toolbar, which owns the bottom edge.

  ⚠️ **`right` is 24px, not 22px, and the arithmetic behind the gate note does not hold.** The "+14px
  existing chrome" was `FloatingOrb`'s own `right: 14px` — and the orb no longer renders on touch, so
  there is nothing to add. The real inset of the hub's **hit box** at `right: 22px` would be 22px,
  below the ≥24px bar. Moving to `right: 24px` meets the bar exactly and costs nothing. For the record,
  the **visual knob** is far clear either way: 38px knob centred in an 84px pad puts its edge at
  `24 + 23 = 47px` from the screen edge. Side effect: the back-to-live chip's clearance narrows from
  12px to 10px, still comfortably non-intersecting.

- **The Actions button.** A real `<button>`, **visible at rest** — not only while the fan is open —
  minimum 44×44, labelled "Actions", sitting on the **inner side of the knob** (left of it when
  right-handed, right of it when mirrored). It opens the same Peek sheet the two-finger gesture opens.
  It is the WCAG 2.5.1-compliant door to every action and is never gated on screen-reader detection.

- **Android back-edge mitigation.** The right-side default stays. On Android, a `pointerdown` beginning
  within **20px of the right edge** is treated as *possibly a system back gesture*: the knob does not
  move visually until the pointer has travelled 10px inward (leftward or upward). A straight leftward
  swipe that the browser then cancels therefore leaves the hub visually untouched, with no half-opened
  fan left behind. Left-handed mirroring remains the user-level escape hatch, and the coach mark
  mentions it **on Android only**.
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

## 2f. Two new `UIcon` glyphs

`app/src/components/ui/UIcon.jsx` is a hand-maintained registry — its own header says "Add new glyphs
to `ICONS` below rather than introducing a one-off emoji", and `UICON_NAMES = Object.keys(ICONS)` is
derived, so appending is the whole process. There is no codegen and no separate manifest.

House convention, read from the file: **24×24 viewBox, stroke-based on `currentColor`, round caps and
joins, ~1.7 stroke weight**, shapes composed of `<path>`/`<rect>`/`<circle>` inside a fragment.

Two glyphs are added. `ruler` and `dollar` are explicitly rejected as stand-ins — both are generic and
would not distinguish these actions from their fan neighbours.

| Name | For | Shape |
|---|---|---|
| `moveStop` | Journal → Move stop | A horizontal rule (the stop line) with an up/down chevron pair centred on it |
| `earnings` | Calendar → Earnings | The existing `calendar` frame with a single small candle body + wick inside |

⚠️ **Named `moveStop`, not `move-stop`.** The gate asked for the existing naming convention, and the
registry's multi-word convention is camelCase — `chevronDown`, `chevronUp`, `chevronRight`, `eyeOff`,
`skipBack`, `skipForward`, `thumbsUp`, `thumbsDown`, `volumeOff`. `star-fill` is the single kebab
outlier in 87 glyphs. Following the convention as instructed means camelCase.

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
**Plus, with `stickyFan` on and a jittered pointer at 3–5px amplitude (tremor simulation), 10 of 10
selections land.** **Approval gate.**

**Standing regression test:** the back-to-live chip's hit rect and the hub's hit rect do not intersect,
asserted at viewport widths **375px and 430px**. This is a permanent rail, not a one-off check — the
chip's `right` value and the hub's `right` value are two independent numbers that will drift apart.

## 5a. Phase 2a — `hub_planned_trades`

A new narrow table. **`j2_positions` gets no status column — it remains a broker mirror.**

```
hub_planned_trades(
  id, user_id, symbol, entry, stop, size, r_value,
  source_mode, created_at,
  status ENUM('planned','converted','discarded')
)
```

**Schema follows the house idiom, not a migration framework: `CREATE TABLE IF NOT EXISTS` in
`api/services/journal_two/db.py`, reached by the existing `ensure_schema(conn)` (`db.py:1724`), with
additive columns appended to the `ALTER TABLE … ADD COLUMN` list (`db.py:1440-1462`). ⛔ There is no
Alembic in this repository and none is to be introduced.** Plus a FastAPI router with create / list /
discard, user-scoped identically to `j2_positions`. Sheet defaults: **entry** = last price from the stream store; **stop** = computed by the
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
{
  enabled: false,        // hub.enabled — see the exact gate wording in §B11 (tightened at the Phase 1 gate)
  handedness: 'right',
  haptics: true,
  holdMs: 500,           // 300–1200
  travelPx: 24,          // 16–48; open threshold and ring split are FRACTIONS of this
  doubleTapMs: 280,      // 200–600
  stickyFan: true,       // ON by default (§C2)
  highContrast: false,   // toggles [data-hub-contrast="high"]
  overrides: {}          // JSON patch over the registry, never a copy
}
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
- Do not collapse any existing multi-select filter into a cycling enum — see Catalysts in C3.
- Do not reuse `ruler` or `dollar` for Move stop or Earnings; two new glyphs are being added (§2f).
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
- **Rollout: `hub.enabled` — RESOLVED (Wave 0.5 gate), wording TIGHTENED at the Phase 1 gate.** Exact
  gate semantics, verbatim, and the one authority for this rule (implemented in `hub/useHubSettings.js`,
  never re-derived by a caller):

  > Enabled if the user's stored `joystick_hub.enabled` is `true`; if unset, enabled only for
  > `role === 'admin'`; otherwise disabled. Phase 2.5 Step 2 flips the unset-default to `true`
  > for every authenticated user — a one-line change, not a new gate.

  ⛔ **THERE ARE TWO ROLES: `admin` AND `member`. THERE IS NO FOUNDER TIER AND NO TIER LADDER.**
  Owner correction, given twice. One product, one price. The wording above previously said
  "Founder rollout flips the unset-default per tier", which described a rollout model that does
  not exist and a field (`tier`) that `validateRegistry` actively REJECTS — the rollout is the
  two-step admin-then-member sequence in `45-phase2.5-plan.md`. `role === 'admin'` is the only
  identity this codebase distinguishes from a member. An
  explicit stored choice (on OR off) always wins over the admin default. Members opt in through the
  Settings toggle when the owner opens it; flipping the unset-default for everyone is a one-line change
  in `hub/useHubSettings.js` (`HUB_SETTINGS_DEFAULTS`/the admin check), not a migration.
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
| Drag past 56px | **Reach mode** | Ring follows the POINTER, not the knob — see below |
| Flick (<120ms) | Quick | Fires the outer action in that direction without opening the fan |
| Two-finger tap | Peek | Gesture map + tap-to-select for every action + the Feedback button |


### C1.1 Reach mode (v1.6) — the affordance wins

⛔ **ADDED BECAUSE A REAL PHONE CONTRADICTED THE MODEL.** Phase 2 device run 1, Google Pixel 8
(BrowserStack session `538bc4785e17d6bebd1580a9ad51c7debe8426e7`): dragging to the **Journal**
bubble fired **Screener**. Measured, not inferred —

| aimed at | ring | landed on | |
|---|---|---|---|
| `home.scan` | 0 | `/screener` | ✅ |
| `home.chart` | 0 | `/charts` | ✅ |
| `home.journal` | **1** | **`/screener`** | ❌ |

The cause was arithmetic, not a bug in the sense of a mistake:

```
ringSplitPx = TRAVEL_PX × RING_SPLIT = 24 × 0.8 = 19.2 px   <- where the ring changed
FAN_RADIUS_INNER = 96 px                                     <- where ring-1 bubbles are DRAWN
FAN_RADIUS_OUTER = 150 px                                    <- where ring-0 bubbles are DRAWN
```

Everything past 19.2px read as the outer ring, so an inner-ring action could only be selected
inside a **9.2px annulus** — five times closer than the bubble the user was aiming at. Journal,
Notebook and Calendar were effectively unreachable, and aiming at them silently fired a
neighbour. **The visual affordance and the control model disagreed, and the user follows the
affordance.**

**Ruling (owner): the affordance wins.** Selection follows the pointer, not the clamped knob.

| pointer radius `r` | ring decided by |
|---|---|
| `r < REACH_PX` (56) | **Legacy short push.** Knob travel, `RING_SPLIT` **0.5** (was 0.8), with hysteresis: enter outer at ≥0.5 × travel, fall back to inner only below **0.35** × travel |
| `r ≥ REACH_PX` | **Reach mode.** Whichever DRAWN radius `r` is nearer to. Midpoint `reachMidpointPx()` = **123px**; the boundary itself is OUTER (`>=`) |

- **The knob still clamps to `TRAVEL_PX`.** That is now purely a rendering decision. It is no
  longer a selection one.
- `REACH_PX = 56` = pad radius (42) + 14 — past a thumb resting on the pad, short of any
  deliberate reach.
- **Hysteresis is not decoration.** One threshold means the ring flips on every pixel of tremor
  across it, changing the selection under a thumb that never moved intentionally — precisely the
  population §C2's motor settings exist for.
- **Sticky fan** keeps tap-to-select; in that state bubbles get a **≥44px hit box** (WCAG 2.5.5)
  without changing their drawn size. During a drag the bubble's box is irrelevant — selection is
  by wedge angle over a whole sector.
- **The chip names the ring while selecting** ("Actions" / "Tools", `RING_NAMES`). Reach mode
  makes both rings reachable; without a label the inner ring stays folklore.
- ⛔ **TREMOR NOTE — DO NOT "FIX" THE LEGACY BAND LATER.** At `travelPx: 16` that band is
  8 → 5.6px, which looks alarming in isolation and is **irrelevant**: both drawn radii are past
  `REACH_PX`, so reach mode owns every real selection. Widening it would only make short pushes
  ambiguous.

**Why no unit test caught this.** `fanGeometry.test.js` probed with `TRAVEL_PX` and
`TRAVEL_PX × 0.5` — distances chosen to satisfy the model under test. It asked *"does a pointer
at 12px select the inner ring?"* and never *"is 12px where the inner ring is drawn?"*. **A
geometry suite that picks its own coordinates cannot discover that the coordinates are wrong.**
Those probes now use `FAN_RADIUS_INNER` / `FAN_RADIUS_OUTER`, and `reachMode.test.js` rails the
bands, the boundary and the hysteresis in both directions.

### C1.2 The iOS capability floor (v1.6)

⛔ **F-1, same run: the hub mounted on NO iPhone.** `useHubActive()` gated on
`CSS.supports('backdrop-filter', 'blur(1px)')`. On iPhone 15 Pro / iOS 17.3.1 that is **false**
while `-webkit-backdrop-filter` is **true** — Safari ships the property prefixed only. Every
other gate passed (`visualViewport`, 393×659, `pointer: coarse`); `hub-root` count was **0**, for
a control that is mobile-only by design.

The floor now passes on **either** spelling. `hub.module.css` already declared both on every
glass surface, so only the JS gate was wrong.

⭐ **It was invisible locally by construction:** jsdom implements neither property, so the check
fails there for a different reason and the suite reads that as "correctly treated as an old
browser". **A green unit test and a blank iPhone were the same observation.** The rail
(`useHubActive.prefixed.test.jsx`) therefore has to stub `CSS.supports` to answer like Safari,
and carries a control proving the floor can still reject.

**Version floor:** B11 sets iOS Safari **16+**. Run 1's iOS 15 device was a vacuous check — the
hub was absent there because of F-1, not the floor, and a test that cannot separate the two
proves neither. The floor is verified on an **iOS 16** device that MOUNTS and matches iPhone 15
Pro behaviour.

**Haptics — the mapping, ruled at the Phase 2 gate.** `app/src/components/mobile/haptics.js` exposes
`tap()` / `impact()` / `success()` / `warn()`, each with a fixed pattern and **no parameter**, so the
millisecond figures this spec once named were unusable and have been retired:

| Event | Call |
|---|---|
| Fan opens | `tap()` |
| Target changes | `tap()` |
| Action fires | `impact()` |
| Confirm sheet opens | `warn()` |

Open and target-change share `tap()` deliberately — both are "something moved under your thumb", and
the escalation is reserved for the two events that actually do something.
⛔ Never add a second `navigator.vibrate` call site.

**Wedge selection — the acceptance window is `max(30°, half-spacing)`, not a flat ±30°.**
Accepted at the Phase 2 gate. Sparse fans get wide wedges (2 actions → ±45°, so the whole arc is
live); dense fans keep the ±30° floor and their bands **overlap**, which is intended — nearest-wins
resolves it, and the overlap is what stops a thumb ever falling between two bubbles.

⛔ **Do not restore a flat ±30°.** It left a **dead zone**: two actions sit at 90° and 180°, so a
thumb at 135° — the middle of the fan — was 45° from both and selected nothing. Every 2-action ring
in the registry had that hole, Flow's entire fan included. Owner: `fanGeometry.selectWindowFor(n)`.
Rail: `fanGeometry.test.js`, "keeps the middle of a 2-action fan LIVE".

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
- **`stickyFan` defaults to ON.** Release with no target under the pointer → the fan **stays open**,
  with a visible dismiss (tap the knob, or tap the scrim). Release *on* a target → fires immediately,
  exactly as before. Flick is unaffected in either state. Power users can turn it off in Settings.
  This is the single highest-leverage motor accommodation in the set: it converts "hold a precise angle
  while trembling" into two easy discrete taps, and it costs a steady-handed user nothing, because
  releasing on a target still fires.
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
- **Filter does not cycle, and the hub does not change the tile's semantics.** The tile's real filter
  state is a **multi-select `Set` defaulting to all four on** (`CatalystTable.jsx:18,591-598`);
  collapsing it to a singleton would silently redefine what the tile means while the hub is driving it.
  The inner-ring "Filter" action **opens the tile's existing filter UI** (or a hub sheet carrying four
  toggles bound to that same `Set` — 0.5 leaves the surface open, the binding is fixed). The chip shows
  the active count: "Catalysts · 4/4", or the names when the set is small: "Catalysts · Earnings, Gapper".
- Removed from the spec: unread state, "next unread", timeline scrub, "Mark read" — none exist.
  Mute ticker is deferred (no mute path).
- "Why?" navigates to `/ai-search?q=…`. "Note" pins via `createNoteViaApi`.
- ⛔ The 👍/👎 and note controls are never one gesture away.

### notebook — `/journal/notebook`
- Primary: next note. Reverse: previous note. Scrub: scroll the notes list.
- Outer: New note · Link ticker · Templates. Inner: Daily plan · Post-mortem · Voice · Home.
- **"New note" (and Wire's "Note") stay one-tap, unconfirmed, with two guards.** The write mirrors the
  Notebook sidebar's own shipped button and is reversible, so a sheet would be friction without safety.
  The guards: **(a)** the note is pre-titled `{SYMBOL} · {Section} · {HH:mm}` so it is never an untitled
  orphan; **(b)** the toast carries an **Undo** that soft-deletes it within 5s via the existing
  `DELETE /api/j2/notes/{id}`. Verified in Wave 0.5: that delete is a **soft delete to trash**, with
  `POST /notes/{id}/restore` behind it — so even a failed Undo leaves the note recoverable from Trash
  rather than destroyed. No downgrade to `kind:'confirm'` is needed.
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

## D0. File ownership lock (standing, from the Phase 2 gate)

- **Every brief carries an OWNS list, and a file appears in exactly one agent's OWNS list per wave.**
- An agent needing a change in a file it does not own **writes the requested diff into
  `requests.md` and stops**. The owner — or the Director — applies it.
- **Two agents editing the same file in one wave is a WAVE FAILURE** and is reported as such at the
  gate even when the result happened to be fine. Phase 1 hit this: two agents raced on the two
  Layout test mocks, one reverting the other's edit mid-turn.
- **Report complete exactly once, then stop.** Anything found afterwards goes into `requests.md`,
  never into more work. Phase 1's tokens agent kept running after reporting — 2.2M tokens and 141
  tool calls past its own gate. That is a budget defect regardless of what it produced.
- **Real-device testing runs on BrowserStack Live** (paid, browser-accessed; **no MCP or SDK is
  configured and none is to be installed**). Scripts live in `docs/plans/joystick/*-device.md` and
  results are recorded in the same file. **Never claim a device result from jsdom or an emulator.**

Unchanged from v1.1 in structure; the 24 role definitions are written to `.claude/agents/`. Two
amendments from Wave 0:

- **Wave 0 ran on read-only agents**, whose tool list excludes Edit/Write, rather than on prompt-level
  read-only instructions. Verified afterwards with `git status`: nothing written. Keep this pattern —
  enforce read-only at the tool list, never only in the prompt.
- The **Mobile-browser specialist** owns the two viewport ⚠️ GAPs (volume-pane exclusion, visualViewport
  behaviour under a collapsing toolbar at the new 68px offset). The **Registry engineer** owns the
  virtualized-cursor question with the Architecture lead.

---

## C1.3 The preview kill switch (v1.6, Phase 2.5)

### Joystick hub preview — `HUB_PREVIEW_ENABLED` (Deploy)

> **`HUB_PREVIEW_ENABLED` unset or `true` → hub eligible; `false` → hub hidden for everyone on
> next authenticated request. Production sets it `true` deliberately so "on on purpose" is
> distinguishable from "unset".**

It is a **kill switch**, so the default is ON. The opposite default would make a variable
someone forgot to set indistinguishable from a deliberate shutdown — the ambiguity
`project_feature_flag_ledger` exists to prevent.

- Read **at request time** in `api/routers/auth.py::_access_payload`, which signup, login and
  `/api/auth/me` all share. There is **no feature-flag endpoint in this app** — the flag rides
  that payload by design, so it needs no new route and is present the moment a session exists.
- Accepted off values: `0`, `false`, `no`, `off` (case- and whitespace-insensitive). Everything
  else, including unset, is ON.
- **Rollback:** set `HUB_PREVIEW_ENABLED=false` in Railway → takes effect on each user's next
  authenticated request, **no redeploy**. ⚠️ An already-open page keeps its hub until its next
  `/api/auth/me` — in practice a reload or route change, not a background poll.
  ⚠️ `railway variables --set` **stages and redeploys**; confirm with
  `railway variables --service web --kv`.
- Rails: `tests/test_hub_preview_flag.py` — `test_the_flag_is_read_per_request` (the
  load-bearing one: a module-level capture passes every other test and makes the no-redeploy
  rollback a fiction) and `test_the_default_in_source_is_ON_and_cannot_be_flipped_unnoticed`
  (pins the literal, not just the behaviour, so the default cannot be changed and the test
  "fixed" to match).

---

## C1.4 Phase 2a — planned trades (v1.6)

`hub_planned_trades` (created by `journal_two/db.py::ensure_schema`, ALTER-list idiom,
idempotent). Deliberately **not** a `j2_` table: a planned trade is a hub artifact that MAY
become a `j2_positions` row in Phase 3, and folding it into the Journal's schema would make
"did the member journal this?" ambiguous.

- **`r_value` is derived through `calculations.trade_pnl_dollar`**, with the stop as the
  modelled exit. ⭐ The reasoning is the second-authority rule, not the arithmetic:
  `abs(entry - stop) * size` is correct and would still be wrong to write here, because it
  puts a second copy of "how this app computes trade money" in the tree. A planned trade has
  no exit, so the stop is the exit being modelled — P&L there is exactly −1R.
- **Side is derived from the stop, never stored.** Storing both would let them disagree,
  leaving a row that says Long with a stop above its entry and no field to trust.
- **`stop == entry` is a hard 422.** The side is undefined, the risk is zero and `r_value`
  is null — a plan that cannot say what it risks is not a plan.
- **Cross-user access returns 404, never 403**; the scoping is in the WHERE clause. A 403
  would confirm the id is real.
- **Discarding is a state, not a delete** — discarded rows stay listed.
