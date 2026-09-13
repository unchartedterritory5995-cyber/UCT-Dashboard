# Wave 0.5 — UX design report (Joystick Hub)

Director consolidation of six read-only specialist reports: interaction design, accessibility,
mobile-browser, copy, visual tokens, and feasibility. Nothing was built. No file outside
`docs/plans/joystick/` was created or changed.

Spec of record: `00-master-spec-v1.2.md`. Evidence: `10-wave0-discovery.md`. Cuts: `deferred.md`.

---

## 0. The headline

**Three findings change the design. Two of them fix defects the spec itself introduced.**

1. **Peek's two-finger tap is a reserved screen-reader gesture.** VoiceOver and TalkBack both claim
   two-finger single-tap for pause/resume speech and consume it before the page sees a `pointerdown`.
   So the affordance that exists to guarantee "no action is reachable only by drag" (C1) is unreachable
   for exactly the users it protects. It also fails **WCAG 2.5.1 Pointer Gestures** on its face — two
   fingers is two pointers, not a single-pointer alternative. **Fix: an always-visible Actions button**
   beside the knob, single-tap, opening the same sheet. Never gated on screen-reader detection.
2. **Journal's "Close" and "Breakeven" are un-confirmed writes.** The spec routes Move stop through a
   confirm sheet and says nothing about these two. Close ends a position and writes a permanent
   `j2_trades` row. On a sub-120ms flick that is the highest-stakes target in the hub. **Fix: both
   become `kind:'confirm'`, and `HubAction` gains `flickable?: boolean` — Close is not flickable.**

   > ⚰️ **SUPERSEDED IN PART, 2026-09-09 (B3).** The text above is left byte-identical because it is
   > a decision record, not live spec. What survives: the `flickable?: boolean` addition, and
   > **Close is still `flickable: false`** — that guard is untouched and does not depend on `kind`
   > (`useJoystick.js:396` gates on `flickable !== false` with no `kind` check). What changed:
   > Move stop, Breakeven **and** Close are now `kind:'run'`, because each already opens a sheet of
   > its own and `confirm` stacked `HubConfirmSheet` in front of it — two sheets on one gesture.
   > The finding here was correct that these were un-confirmed writes; `confirm` was simply the
   > wrong instrument, since the sheets they open are stronger confirmation surfaces than a yes/no.
   > **Live spec:** `00-master-spec-v1.6.md` §"Outer: Chart it · Move stop · Breakeven · Close"
   > (the `kind: 'run'` bullet). **Validator:** `registry.js` `FLICK_GUARDABLE_KINDS`.
3. **`role="toolbar"` is the wrong container and the spec mandates it.** A toolbar role exists to
   redirect arrow keys; there is no keyboard in this build. VoiceOver flattens it to nothing, TalkBack
   charges Android users an extra swipe for it, and its contract ("a fixed, always-visible set of
   commands") describes a state the fan is in essentially never. **Fix: drop it.**

**Two feasibility questions resolved in the build's favour.** Compare **ships** — the mobile shell's own
`handleStore` write reaches the render path, and the desktop `setComparison` turns out to be the
identical `{...cs, comparisonSymbols}` write, not a separate system. Pan **ships** — `stepBar(dir)`
takes an unconstrained numeric delta and is already exposed on the ref the mobile shell holds.

---

## 1. Validated Part C

Every gesture in every mode was re-checked against source rather than taken from the spec. Ring caps
hold everywhere: outer ≤5 (Home is exactly at 5), inner ≤4, inner ends with Home in all nine
non-Home modes. Every mode carries Voice on the inner ring. **Every Primary and Reverse across all ten
modes is a navigate-or-read action — none writes**, satisfying C1's accidental-fire rule by construction.

Corrections and confirmations, by mode:

| Mode | Finding |
|---|---|
| wire | All backed. The 7 segment classes for "Chart it" confirmed in `MorningWire.module.css:558,674,731,749,773,786,822` — an allowlist is required, there is no generic symbol marker. |
| breadth | **Targets the Views tab** (`key: 'heatmap'`), the only one wired to `BreadthScrubber`. Phones land on Daily, which has *no* day-stepping concept at all — only a metric picker. **The hub switches tabs rather than disabling the scrub**, and it is free: Views defaults to `viewsDays = 90`, the same SWR cache key the Daily/Monitor tabs already use. |
| scan | The only mode with explicit flick assignments (up = Chart it, left = Flag). Alert confirmed flick-safe — `MobileAlertSheet`'s above/below buttons *are* the confirm step. |
| chart | Compare and pan both ship (§0). **"Log trade" needs no deep-link** — `GlobalAddPositionProvider` already opens `AddPositionModal` from anywhere in the app. |
| journal | **Close and Breakeven get confirm sheets** (§0). `activeStop()` is the stop in force; breakeven writes `breakevenStop` and never `stopPrice`. |
| catalysts | **Activation = a tap on the tile's title span** (`CatalystTable.jsx:624-625`) — it has no existing click handler, unlike the ticker cell (opens `TickerHubSheet`) and the thesis cell (expands). ⚠️ **"Filter" needs a ruling** — see §6. |
| notebook | All backed. Template keys `daily-prep` / `trade-review` confirmed. |
| calendar | All backed. Earnings/Macro are filter chips, not view modes. |
| home | Primary is **inert on a first-ever visit** rather than guessing a destination — defaulting it to Wire would make Primary and Reverse fire the same target on a new account, which reads as a bug. |
| flow | Confirmed: `OptionsFlow.jsx` exports only its default component. Fan is `[Voice, Home]`. |

**"Last-used section" defined.** A section is one of the eight route-backed modes, matched **against the
registry route table, not raw pathname** — `/journal` has nine sibling sub-routes and only two are hub
modes, so visiting `/journal/insights` must not overwrite the stored value. `/dashboard` is excluded:
recording it would make Primary a no-op exactly when it is tapped. Mechanism copies
`usePageTracking()`'s shape (`Layout.jsx:17-39`) but writes `localStorage`.

**Flick geometry is a genuine spec gap, not answerable.** The fan is a single 90° quadrant with ±30°
wedge selection, so only its two extreme edges have unambiguous compass names; the spec assigns flick
semantics for Scan only. Rather than invent wedge angles for nine modes, the interaction designer
audited the safety half instead — which is what produced finding #2.

---

## 2. Accessibility plan

**Semantic tree.** No `role="toolbar"`. The pad and compass ring are `aria-hidden`. The knob is a single
`role="button"` named for the current mode. Fan bubbles are real `<button>`s but the open fan is
`aria-hidden`/`inert` for AT — because the fan effectively never exists for a screen-reader user, and
Peek is the canonical surface. The mode chip is `role="status" aria-live="polite"` reusing
`useJournalToast`'s text-toggling idiom. Confirm sheets and Peek both reuse
`components/mobile/Sheet.jsx` verbatim — it already supplies `role="dialog"`, `aria-modal`, focus trap,
Escape, and focus restore, and its own header records that four components hand-copied a trap before it
was centralized. Don't make a fifth.

**Two platform traps to build against:** iOS VoiceOver loses list semantics on a `list-style:none` list
(force `role="list"`/`role="listitem"`), and a native `disabled` attribute can make a control
unreachable by VoiceOver's touch sweep — **use `aria-disabled`, never `disabled`**, so a blocked action
can still be explored and still announce why.

**Announcements** are delivered through the one live region. The wedge-selection string is **the action
label alone** — no verb, no ring, no mode — because it fires at drag speed and `aria-live` coalesces
overlapping updates unpredictably. Mode entry uses the literal spec form: "Scan mode, result 3 of 41".
Cursor moves after that speak "4 of 41" alone. The confirm sheet gets **no** live announcement — its own
`aria-label` is the confirm text and `Sheet.jsx` focuses the panel, so an extra announcement
double-speaks the same sentence.

**Scrub gets a real slider.** `BreadthScrubber.jsx:95-102` is the precedent: a native
`<input type="range">` with `aria-valuetext` carrying a human-readable string, not a raw index. Both
VoiceOver and TalkBack give any focused range control a one-finger swipe-up/down adjust gesture — a
free, standards-backed, no-drag way to operate Scrub specifically.

**Motor settings.** `travelPx` 24 default, range 16–48 — matters most for **tremor** (more physical
distance between "tap" and "drag", more angular room between wedges). `holdMs` 500 default, range
300–1200 — matters most for **limited reach**, where the cost is sustaining contact in an awkward
posture, not precision. Double-tap window 280, range 200–600. **The open threshold (10px) and the
ring split (80%) must become fractions of `travelPx`, not fixed pixels** — at `travelPx: 16` a fixed
10px threshold turns "open the fan" into 62% of travel instead of 42%, a different gesture the settings
page never described.

**Vision.** Label scaling is resolved structurally rather than by shrinking type: the fan bubble is
icon-first and may truncate at 200%, **because every label also exists as a normal-flow button row
inside Peek**, where it simply wraps. The fan is allowed to be shorthand precisely because Peek is the
complete, zoom-safe list. The mode chip must wrap or grow leftward, never clip.

**Reduced motion.** The global CSS reset (`tokens.css:541-548`) does nothing to a rAF loop, and the
knob's spring-back is exactly that shape. Every rAF-driven visual must check reduced motion and **snap
to the final value in one frame** — remove interpolation, never functionality: the fan still appears,
instantly, every bubble at final position. `reduceMotion` is currently a private const in
`useAnimatedNumber.js:13` — **export it** rather than create a sixth copy of the same `matchMedia` check.

**A 26-row audit checklist** is included in the specialist's report for the Phase 3 auditor, each row
with an observable pass condition, runnable without reading the implementation.

---

## 3. Viewport plan

**The hub does not use `visualViewport` for position.** Two concerns were conflated in the spec.
*Position* is pure CSS — `position:fixed; right:22px; bottom:calc(env(safe-area-inset-bottom) + 68px)`,
mounted at `Layout.jsx:132-138` where no ancestor sets `transform`/`filter`/`contain` to break the
containing block. On Safari 16+/Chrome 110+ the browser's own compositor keeps the fixed viewport in
sync as chrome collapses, with no JS in the loop — so there is no event→React→paint pipeline to lag a
frame. Driving position from `visualViewport.resize` would make it strictly **worse**, adding a
guaranteed tick of lag to something the compositor already does correctly.

*Visibility* is what `visualViewport` is for. Reuse `useKeyboardVisible()` unmodified — one listener,
one boolean, already consumed by `MobileNav`.

**The 68px offset resolves against the layout viewport**, so the hub sits above the collapsed-or-expanded
toolbar in both states and tracks the collapse animation natively.

**The keyboard correction.** `interactive-widget=resizes-content` is already set, so the keyboard shrinks
the layout viewport and **the hub is never covered** — it rides up and floats directly above the
keyboard. The spec's "auto-hide while a text input is focused" is still right, but for a different
reason than being hidden: gesture crowding against the predictive-text row, and clutter above where the
user is typing. Implement with `MobileNav`'s existing transform/opacity idiom, not mount/unmount.

**Gesture conflicts.** Pull-to-refresh is a non-issue by DOM structure — the hub is a sibling of `.main`,
not a descendant of `PullToRefresh`'s container. Long-press callout needs
`-webkit-touch-callout:none; -webkit-user-select:none; user-select:none` on the pad — `touch-action:none`
does **not** suppress the iOS text loupe; the exact three declarations are already used for the chart's
own long-press at `MobileCharts.module.css:722-729`. Pointer capture is load-bearing, not optional: knob
travel is 24px but fan radii are 96–150px, so every real drag leaves the pad's hit-box immediately.

⚠️ **Android's back gesture is an unclosable risk.** Android 10+ recognizes edge swipes from **both**
edges, so the hub's *default* right-side position is the exposed one, and a regular browser tab has no
way to opt out (this is precisely the context a PWA could suppress and a tab cannot). Mitigation is
design margin only — inset the visual knob within its hit-box — plus device verification with
gesture-nav width set to "wide". See §6.

**Landscape:** the hub hides under the chart shell's landscape-immersive query, following the orb's own
precedent (`FloatingOrb.module.css:282-283`). New guidance, not in the spec.

---

## 4. The two ⚠️ GAPs, closed

**Volume-pane exclusion — the honest fallback, with the app's own number.** Lightweight Charts v5 *does*
expose live pane geometry (`chart.panes()[i].getHeight()`, `series.getPane()`), and `StockChart.jsx`
uses it internally at `:13398-13401` and `:13559-13573`. But none of it reaches the host: `ChartPane`'s
ref has no `getPaneRects()`, `getRect()` returns the whole container, and `chartApiById` is desktop-only.
Exposing it means a fourth imperative method on an existing component — outside the named exceptions,
so it stops and asks.

**The fallback: the scrim excludes `calc(22% + 32px)` of the bottom of `.chartArea`** — not a new number,
but the app's own. `StockChart.module.css:17-20` already uses exactly that value as the range bar's
fallback position "above the volume pane", and 22% is `cs.volume.paneHeightPct`'s default.

**State the error, three ways it is wrong:** volume is an overlay band inside the price pane by default
(`separatePane: false`), not a pane at all; the user can drag the divider anywhere in `[8%, 45%]` and
that latch is not readable from outside; and volume can be off entirely or have oscillator panes below
it. Write it in the build as an approximation of the default configuration, never as a measurement.

**Back-to-live chip — it overlaps, and the chip moves.** Chip is `right:86px; bottom:96px; 40×40;
z-index:30` (`StockChart.module.css:747-771`). Toolbar height is `44 + 5 + max(5, safe-area)` ≈ 54px
bare, ≈ 83px with a home indicator. Chip therefore spans **[150,190]** / **[179,219]** from the viewport
bottom; the hub spans **[68,152]** / **[102,186]**. Horizontally the hub is `[W−106, W−22]`, the chip
`[W−126, W−86]`.

**Overlap: 20px wide × 2–7px tall**, the hub's top-left corner clipping the chip's bottom-right, present
at every safe-area value and growing with it. Thin on paper, but a finger's contact patch is an order of
magnitude larger than a 2px gap.

**Fix, per the spec's own rule: `right: 86px → 118px`** on `.goLivePill` — a 32px shift landing the
chip 12px clear of the hub's left edge. No vertical change. This trades away the chip's original
justification (clearing the 76px price axis); accepted cost, and it should be written into the comment.

---

## 5. Label sheet, tokens, and the corrections applied to both

The full label sheet (63 rows: mode, action id, label, character count, `UIcon` name, chip text, success
toast, failure line, screen-reader announcement) and the full token proposal are in the specialists'
reports. Every icon name was checked against the 87-glyph registry. Three Director corrections:

- **"Voice needs Premium" is deleted.** It was written before the tier ruling. There are no tiers; Voice
  is available to anyone who can see the hub, and no action is ever tier-locked.
- **The Set stop sheet is "Save stop" + "Cancel"**, not "Save plan". Part C's older "one-button confirm
  sheet" wording is superseded — every confirm sheet is primary + secondary, no third button.
- **`Home` uses the `compass` glyph**, not `dashboard` — the registry has no house glyph, the hold-to-Home
  gesture is literally "find your bearing", and the pad already carries a compass motif. It also avoids
  conflating the Home *action* with the Home *mode's* nav icon.

**Tokens** are appended to `tokens.css` below the existing `--glass-*` block, every value a `color-mix()`
of a token the app already owns — `--text-heading` stands in for white, `--bg` for black, so OLED and
shadow depth derive for free. OLED raises tint alpha ~4–6 points and the rim 6, because `#000000` gives
the tint no ambient bounce. High contrast is `[data-hub-contrast="high"]`, a modifier that composes with
either theme rather than a fourth theme, keyed off `--bg-elevated`/`--bg-hover` so it needs no OLED copy.

**All ten mode accents clear 3:1** against both canvases and both glass tiers. Chart (`#9d95ff`) is the
thinnest at 3.7:1 against pressed glass — a pass, but the one to check on device.

**A persistent `backdrop-filter` is new territory for this app** — the token comment restricts it for
performance and nothing currently runs one always-on. The blurred region is only the hub's own ~84px
footprint. Fallback is a `@media (update: slow)` token swap to opaque, not a change to the mount
decision — capability and cost are different questions and must not collapse into one switch.

---

## 6. Six questions for the gate

1. **`#67DB44` is assigned to journal, wire and home.** They collide in exactly one place — **Home mode's
   own fan**, where Wire (outer) and Journal (inner) render identical green simultaneously. Every other
   appearance is solo. Icons and labels still distinguish them, so it degrades rather than breaks.
   Change wire and home to `color-mix()` siblings, or accept?
2. **Catalysts "Filter".** The spec says it cycles the four tags. The real state is a **multi-select
   `Set` defaulting to all four on** (`CatalystTable.jsx:18,591-598`). Hub-driven cycling would force it
   to a singleton — a genuine change to the tile's filter semantics, scoped to hub interaction. Confirm?
3. **`stickyFan` default.** Proposed off (conservative, matches the prototype), but it is arguably the
   highest-leverage motor accommodation of the five — it converts "hold a precise angle while trembling"
   into two easy discrete taps. On by default instead?
4. **Two missing glyphs.** "Move stop" and "Earnings" have no adequate icon in the 87-glyph registry
   (nearest are `ruler` and `dollar`, both generic). Add two glyphs, or ship the stand-ins?
5. **One-tap blank-note creation.** Wire's "Note" and Notebook's "New note" write immediately with no
   sheet. This mirrors the Notebook sidebar's own shipped button and creates only an empty, reversible,
   non-financial note — but it is technically an unconfirmed write inside a hub whose rule says writes
   go through sheets. Accept as-is?
6. **Android edge-gesture risk.** The hub's default right-side position sits inside Android's back-gesture
   hot zone, and a browser tab cannot opt out. Mitigation is design margin plus device testing. Accept
   the residual risk, or move the default position?

---

## 7. Phase 1 readiness

Feasibility verdicts, all favourable:

| Question | Verdict |
|---|---|
| Shared cursor over six lists | **Moderate.** One hook serves all six, but three sections (Screener, Journal, Catalysts) render a locally re-derived array that differs from the fetched data, so registration means registering *that* array. Catalysts must gate on `!compact` or its Morning-Wire-rail instance double-registers. |
| Wire's cursor | **One hook, two consumption modes.** Five sections attach `data-hub-cursor` declaratively in JSX; Wire has no JSX row and must toggle it imperatively in a `useEffect`, mirroring its existing `data-fb-vote` injection. |
| `scrollToIndex` on virtualized results | **Cheap** — `forwardRef` + one `useImperativeHandle` on each of `VirtualResults.jsx` and `ResultCards.jsx`. Note **both** are virtualized, including the phone card list. Fallback (cap to loaded rows) means a hard stop or fetch-stall every 100 rows. |
| Global selection class | **Cheap.** Exact precedent exists: `:global([data-flash="true"])` in `TranscriptSearch.module.css:83`. `tokens.css` is a safe home. No `memo()` or prop-spread hazard in any of the six sections. |
| Chart Compare on mobile | **Ships.** The write reaches the render path; desktop's `setComparison` is the identical `{...cs, comparisonSymbols}` write, and `hideCompare` only hides the legacy single-symbol UI, not the overlay. |
| Chart pan via scrub | **Ships.** `stepBar(dir)` takes an unconstrained numeric delta — `stepBar(0.3)` works — and is already exposed on `ChartPane`'s ref. Minor rough edge: it doesn't fetch more history at the window edge. |
