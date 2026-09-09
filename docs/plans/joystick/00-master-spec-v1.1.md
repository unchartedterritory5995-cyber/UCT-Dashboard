# UCT Intelligence — Glass Joystick Hub
## Master build plan and Claude Code prompt, v1

Read this entire document before doing anything. It has four parts:

- **Part A — What and why** (scope, ground rules, platform notes, theme)
- **Part B — Build phases** with approval gates
- **Part C — In-section interaction model** (the gesture vocabulary and every section's map; this is the product)
- **Part D — Agent organization** (how the work is staffed and sequenced)

You act as the **Director** described in Part D. Begin with Wave 0 / Phase 0. Stop at every gate and wait for Patrick's approval. Follow the Response protocol (B10) on every reply.

Companion file: `glass-joystick-hub.html` — a working browser prototype. It is the reference for gesture feel, timing, wedge selection, and the glass look. Reproduce its behavior inside the React app; do not copy it verbatim.

---

# Part A — What and why


---

## 1. What we are building

A persistent, mobile-first control that sits in the bottom-right corner of every UCT Intelligence page: a small liquid-glass joystick. It has two jobs:

1. **Navigate** — drag it and a quarter-circle fan of shortcuts opens; release on one to jump to that section or fire an action.
2. **Operate** — once inside a section, the same knob becomes that section's controller. Tap and double-tap do section-specific things (step through scanner results, cycle chart timeframes, cycle Echo filters). Drag opens that section's own tool fan.

Hold the knob for half a second to return to Home from anywhere.

A working HTML/JS prototype accompanies this prompt (`glass-joystick-hub.html`). It is the reference for gesture feel, animation timing, wedge selection, and the glass look. Reproduce its behavior inside the React app; do not copy it verbatim.

## 2. Ground rules

- Read the repo's existing `CLAUDE.md` before anything else and follow it. At the end of the build, append a "Joystick hub" section to it: registry location, how to add a mode, tuning constants, known gaps.
- Model routing: run Phase 0 and Phase 1 design on Opus; Phases 2–4 can run on Sonnet.

- Additive only. No existing route, component, or API is modified except to register the hub and expose a small context. Existing navigation keeps working with the hub disabled.
- Mobile only. The hub renders only on touch devices at viewports ≤ 900px wide (`(pointer: coarse)` and width check, both required). It never mounts on desktop; there is no mouse-drag path to build or test.
- Users open the app in a regular mobile browser tab, not a PWA. Design for Safari's collapsing bottom toolbar and Chrome's URL bar: size with `100dvh`, position the hub relative to the visual viewport (`window.visualViewport`), keep it at least 28px above `env(safe-area-inset-bottom)`, and re-run layout on `visualViewport.resize`. Test with the toolbar both expanded and collapsed.
- No order placement in this build. SnapTrade is sync/positions only today, so there are no Buy or Sell actions anywhere in the hub. Instead, "Plan trade" opens a confirm-style sheet that logs a planned entry, stop, and size to Journal 2.0 (R-multiple computed with the existing calc module). Put a `hub.orders` feature flag in the registry so real orders can be added later; the flag defaults off and, when on, still requires a confirm sheet.
- Do not touch the Options Flow code owned by the collaborator. The Flow mode is navigate-only: the hub can jump to the Flow route and jump back to Home; it exposes no in-section actions unless Flow already exports a documented hook. If it does not, say so in Phase 0 and leave Flow's fan as `[Home]`.
- Respect `prefers-reduced-motion`.
- No new dependencies unless already present in `package.json`. Framer Motion is acceptable if already installed; otherwise CSS transitions.
- Everything the hub can do is declared in one registry file. Adding a section or action is a data change, not a code change.

## 2a. Theme and brand fit

Discovery notes (public surface only; confirm against the app in Phase 0):

- Brand: Uncharted Territory / UCT. Logo is a compass rose with a candlestick center. Brand green `#67DB44`, brand red `#DE3E24`. Near-black canvas `#0a0a0c` (the site's declared theme color). Tagline "The Trading Brain you need as a companion."
- Existing marketing typography pairs a condensed display face with IBM Plex Mono for numbers. Use the app's own font tokens if they exist; otherwise Inter for UI and IBM Plex Mono for prices, percentages, metric labels, and the mode chip.
- Product surfaces visible publicly or in prior builds: Breadth Monitor (S5FD, T2108, T2107, positioning), Morning Wire (market phase, rally-day count, distribution days), earnings/economic calendar, index/ETF review, scanner (Finviz Elite), Echo catalyst feed (Finnhub + FMP cross-confirmation, FinTwit tracking, Sonar "why is it moving"), Options Flow, Journal 2.0 / Portfolio, Notebook with Obsidian sync (Settings → Connections), UCT20 watchlist, SnapTrade brokerage, Deepvue integration for members.
- Trader vocabulary to keep in labels: RS, phase, sizing rule, bad break, breakeven, R-multiple, rally day. Green = up/long/confirm-buy, red = down/short/confirm-sell. No other semantic use of those two colors.

Theme rules for the hub:

- Read every color from CSS variables the app already defines (`--bg`, `--green`, `--red`, text tokens). Add hub-specific tokens in one place (`src/hub/hub-tokens.css`): `--hub-glass-tint`, `--hub-rim`, `--hub-shadow`, per-mode accent colors.
- Glass tint is white at 6–22% over the dark canvas. Provide a light-mode set (dark tint, darker rim) even if the app is dark-only today.
- The pad carries a faint compass-tick ring (8 ticks) as the brand signature; nothing else decorative.
- Numbers in bubbles or the confirm sheet use the mono face.
- Mode colors: scan `#8fd3ff`, chart `#9d95ff`, flow `#f7c96b`, echo `#ffb36b`, breadth `#5dcaa5`, journal `#67DB44`, notebook `#d6a4ff`, calendar `#e9e9e9`, home `#67DB44`.

## 2a-ii. Platform-specific integration notes

- Charts use the licensed TradingView charting library. Chart-mode actions must drive the widget through its API, not React state: timeframe via `widget.activeChart().setResolution()`, symbol via `setSymbol()`, drawing tools and indicators via `executeActionById()` / `createStudy()`. Keep a single `chartRef` in the hub context; if the widget is not ready, actions are disabled, not queued.
- Live numbers (position R, breadth values, last price) come from the existing Redis pub/sub → WebSocket stream. Hub surfaces subscribe to the same client stream store; never issue REST calls for something already streaming.
- Scanner has many distinct scans. Scan mode therefore has two levels: tap = next result within the active scan, double-tap = previous result; the inner ring gets a "Scans" action that opens the existing scan picker, and the mode chip shows the active scan's name. Selecting a result sets the shared `symbol` in hub context and, where the scanner already opens charts on click, also loads it into the chart without navigating.
- Membership tiers (founder / member / trial) gate some features (Notebook is paid). Phase 0 must find how tier is exposed on the client; actions declare `tier` and render locked with a one-line toast if unavailable.
- Notebook "Sync" triggers the existing Obsidian sync endpoint only if the user has a connection; otherwise the action deep-links to Settings → Connections.

## 2b. Adaptability requirements

- The registry is data: `src/hub/registry.ts` exports `modes` and a `defineMode()` helper. A new section is one object; no changes to the gesture engine.
- Actions declare `requires` (e.g. `'symbol'`, `'position'`, `'brokerage'`); the hub disables what the current context cannot satisfy instead of hiding it.
- Sections register themselves: a `useHubMode(modeConfig)` hook mounted in a page component registers that page's tap/double-tap handlers and fan for as long as the page is mounted. Route-derived defaults still work for pages that never call it.
- User overrides (reorder, remove, handedness, haptics) are stored as a JSON patch on top of the registry, never as a copy, so new default actions appear for existing users.
- Per-user "role" awareness: if the app has founder / member / trial tiers, actions can declare `tier`, and the hub shows locked bubbles for unavailable tiers with a short upsell toast instead of failing.
- Keyboard mapping is out of scope. The registry may still emit a shortcut map for external keyboards on tablets, but nothing in this build depends on it.


---

# Part B — Build phases
## 3. Phase 0 — Discovery (no code)

Audit the frontend and report before writing anything:

1. List every top-level route and its component. Confirm which of these exist and what they are actually called in code: Home/Dashboard, Scanner, Chart, Options Flow, News/catalyst feed (Echo, Radar, or whatever it is named), Breadth Monitor, Calendar (earnings/economic), Journal and Journal 2.0 / Portfolio, Notebook, Morning Wire, Watchlist (UCT20), Settings/Connections, and any membership-tier gating.
7. Extract the app's real design tokens (colors, fonts, radii, glass/blur usage) and report them next to the brand values in Section 2a; the app's values win where they differ.
2. Identify the app shell / layout component where a global fixed element belongs, and how theme (light/dark) and safe-area insets are currently handled.
3. Identify existing state that section controllers will need: the scanner's list of scans and the active scan's result set, how a result is opened today, the TradingView widget ref and readiness signal, Echo's filter state, Journal's selected position and stop-placement mode, the sizing-rule setting, and the client-side stream store.
4. Find any existing keyboard shortcut or command-palette system; the hub should share its action definitions if one exists.
5. Check for `navigator.vibrate` usage, haptics helpers, and any existing toast component.
6. List what is missing. For any state that is not exposed (e.g. scanner selection is local component state), propose the smallest change to lift it into a hook or context.

Deliver a short markdown report: routes table, shell location, state map with file paths, gaps, and a proposed file plan. **Approval gate.**

## 3.5 Phase 0.5 — UX design (no code)

Wave 0.5 from Part D. The UX lead and specialists take the nine section scout reports and finalize Part C: correct section names, confirm each Primary/Reverse/Scrub is backed by real state, produce the label sheet (every bubble ≤10 chars, sentence case), the accessibility plan, and the mobile-browser viewport plan. Any Part C entry that cannot be backed by existing state is marked "deferred" with the smallest change that would enable it. **Approval gate.**

## 4. Phase 1 — Registry and context

Create:

- `src/hub/registry.ts` — typed declaration of modes and actions:

```ts
type HubAction = {
  id: string;
  label: string;          // ≤ 10 chars, sentence case
  ring: 0 | 1;            // 0 = outer (push hard), 1 = inner (push soft)
  color: string;          // token or hex
  kind: 'navigate' | 'run' | 'confirm' | 'home';
  to?: string;            // route or mode id for navigate
  run?: (ctx: HubContext) => void | Promise<void>;
  confirmText?: (ctx: HubContext) => string;
  enabled?: (ctx: HubContext) => boolean;
};
type HubMode = {
  id: string; label: string; color: string; route?: string;
  tapHint: string;
  onTap?: (ctx: HubContext) => void;
  onDoubleTap?: (ctx: HubContext) => void;
  fan: HubAction[];       // max 5 on ring 0, max 4 on ring 1
};
```

- `src/hub/HubContext.tsx` — provides `mode`, `setMode`, and the section state discovered in Phase 0 (scanner selection, chart symbol/timeframe, echo filter, journal selection, order helpers). Modes are derived from the current route by default; entering a mode from the fan navigates and sets it.

Seed the registry with the modes in Section 7. Wire only `navigate` actions this phase; `run` and `confirm` can call a placeholder toast. **Approval gate.**

## 5. Phase 2 — Gesture engine and glass UI

Build `src/hub/JoystickHub.tsx` and children:

- Pointer events only (`pointerdown/move/up/cancel`) with pointer capture; `touch-action: none` on the pad.
- Constants, exported so they can be tuned: knob travel 24px, open threshold 10px, hold 500ms, double-tap window 280ms, flick window 120ms, outer/inner ring split at 80% travel, fan radii 150/96px, quadrant 90° opening toward the upper-left.
- Implement the full vocabulary from C1: tap, double-tap, hold (home), hold+drag (scrub, with live readout in the chip), soft/hard push fans, flick (fires the outer action in that direction without opening the fan), two-finger tap (peek overlay). Scrub emits a normalized `delta` and a `commit` event that sections subscribe to.
- Selection is by wedge angle (nearest action within ±30° of pointer angle, in the ring chosen by push distance), not by hit-testing bubbles. Highlight the wedge and bubble; recolor the knob dot to the target color.
- Haptics: 8ms on open, 4ms on selection change, 12ms on fire, short triple pulse when a confirm sheet opens. Use `navigator.vibrate` behind a helper that no-ops when unsupported.
- Visual: `backdrop-filter: blur(18px) saturate(160%)` glass, translucent white gradient, 1px rim, inset top highlight, soft drop shadow. Match the prototype. Provide a light-theme variant (darker rim and tint) and verify legibility on the light wallpaper.
- Dim + freeze: a scrim covers the page while the fan is open; the page under it should not receive pointer events.
- The mode chip left of the hub shows current mode label and tap hint; hidden while the fan is open.
- Position: `right: 22px; bottom: calc(env(safe-area-inset-bottom) + 28px)`. Never lower — it must clear the iOS home indicator and Android gesture bar.

Acceptance: on a real phone, ten consecutive fan selections land on the intended target with no misfires; the knob springs back; no scroll jank while dragging. **Approval gate.**

## 6. Phase 3 — Section controllers

Wire the `onTap`, `onDoubleTap`, and `run` handlers for each mode against the real state found in Phase 0. Priority order: Scanner, Chart, Echo, Journal, Home, Notebook, Flow (read-only).

Plan-trade sheet: a glass bottom sheet showing symbol, proposed entry (last price), stop (default from the Journal 2.0 stop-placement mode in effect), size from the user's sizing rule, and computed R. Confirm writes to Journal 2.0 as a planned trade. Nothing touches SnapTrade.

Toast: reuse the existing toast component if there is one.

**Approval gate.**

## 7. Modes (initial registry)

Phase 3 wires sections in this order: Scanner, Chart, Journal, Echo, Home, Breadth, Calendar, Notebook, Morning Wire, Flow (navigate-only).

The registry is seeded from Part C, section C3 (per-section map). Outer ring ≤5, inner ring ≤4, inner ring always ends with Home. Actions that need a symbol/position are disabled when none is selected.

## 8. Phase 4 — Settings and polish

- Settings → Joystick: enable/disable, left- or right-handed (mirrors the hub and fan), haptics on/off, and a per-mode editor to reorder or remove actions (persist to the user's settings table; keep the registry as the source of allowed actions).
- Auto-hide while a text input is focused and on the order ticket page.
- First-run coach mark: one glass tooltip, "Drag for shortcuts, tap to act, hold for home." Dismisses permanently.
- Analytics event per action fired (`hub_action`, with mode and action id) using whatever event logging exists.

## 9. Things not to do

- Do not restyle or relocate existing navigation.
- Do not add a router library or global state library.
- Do not add any order-placement path. `hub.orders` stays off.
- Do not modify Options Flow source.
- Do not put more than 5 actions on the outer ring or 4 on the inner ring.

## B10. Response protocol

At the end of each phase: list files created or changed, what was verified on device or in the browser, any gaps discovered, and the exact question(s) you need answered. Then stop and wait.

## B11. Fill-ins for Patrick

- Section names as they exist in code (Phase 0 will confirm; correct them here afterward).
- Which scan should be the default active scan when entering Scan mode from Home.
- Default handedness.
- Whether the hub ships to all users or behind a beta flag.
- Minimum iOS Safari and Android Chrome versions to support (affects `backdrop-filter` and `visualViewport`).

---

# Part C — In-section interaction model

## C1. The gesture vocabulary (same everywhere, different meaning per section)

| Gesture | Name | Rule |
|---|---|---|
| Tap | Primary | The single most repeated action in that section |
| Double-tap | Reverse | The inverse of Primary (previous, undo, back one) |
| Hold 0.5s | Home | Always returns to Home. Never remapped |
| Hold + drag | Scrub | Continuous control: scroll a list, scrub a timeline, adjust a stop. Released = commit |
| Drag (soft push) | Inner fan | Section tools, ≤4 |
| Drag (hard push) | Outer fan | Section actions, ≤5 |
| Flick (fast drag + release under 120ms) | Quick | Fires the outer-ring action in that direction without opening the fan; muscle memory for power users |
| Two-finger tap on pad | Peek | Overlay showing the current section's gesture map (accessibility + learnability) |

Constraints:
- Primary and Reverse must be safe to fire accidentally (never destructive, never sends anything).
- Anything that writes goes through a sheet with an explicit button.
- Scrub always shows a live readout in the mode chip while active.
- Every gesture has a non-gesture equivalent inside the Peek overlay (tap-to-select), so no action is reachable only by drag.

## C2. Accessibility commitments

- The hub is a `role="toolbar"` with a `role="button"` knob; every action is reachable with VoiceOver/TalkBack (swipe navigation and double-tap activation) and announced with mode context ("Scan mode, RS leaders, result 3 of 41").
- Voice: `aria-keyshortcuts` on each action; a "Say it" inner-ring action opens speech input mapped to the same registry (e.g. "chart NVDA", "next", "breakeven").
- Motor: knob travel, hold time, and double-tap window are user-adjustable; one-handed left/right mirroring; a "sticky fan" option that keeps the fan open after release for tap-to-select instead of drag-to-select.
- Vision: high-contrast glass variant (opaque tint, 2px rim), bubble labels scale with system font size, color is never the only signal (every bubble has an icon).
- Haptics on every state change; can be disabled.

## C3. Per-section map

### Home
- Primary: go to the last-used section. Reverse: go to Morning Wire.
- Scrub: cycle through today's summary cards (positions, breadth, Echo count) with the chip reading each.
- Outer: Scan, Chart, Flow, Echo, Breadth. Inner: Journal, Notebook, Calendar, Wire.

### Scanner
- Primary: next result in the active scan. Reverse: previous. Chip shows "RS leaders · 3/41".
- Scrub: fast-scroll the result list; release lands on the row under the readout.
- Outer: Chart it, Watch (UCT20), Alert, Plan trade. Inner: Scans (picker), Why? (Sonar), Sort, Home.
- Flick up = Chart it. Flick left = Watch.
- Result selection sets the shared symbol; every other section reads it.

### Chart (TradingView widget)
- Primary: next timeframe. Reverse: previous. Chip shows "NVDA · 4H".
- Scrub horizontally: pan the chart (`scrollPosition`); scrub vertically: cycle symbol through the current list (scan results or UCT20). Chip reads the symbol as it changes.
- Outer: Draw (trendline tool active), Indicator (quick set: EMA 9/21/50, VWAP, AVWAP from last pivot), Plan trade, Alert at crosshair price. Inner: Log trade, Note (Notebook entry pinned to this symbol), Compare (overlay QQQ), Home.
- Flick up = Plan trade sheet with entry = crosshair price.

### Echo (catalyst feed)
- Primary: next unread item. Reverse: previous. Chip shows filter and unread count.
- Scrub: move through the day's timeline; readout shows time-of-day.
- Outer: Chart, Watch, Why? (Sonar synthesis for this item), Mute ticker. Inner: Filter (all → confirmed → filings → analyst → FinTwit), Mark read, Pin to Notebook, Home.
- Flick right = Why?.

### Journal 2.0 / Portfolio
- Primary: next open position. Reverse: previous. Chip shows "NVDA · +1.4R · stop 176.40".
- Scrub: adjust the selected position's stop; readout shows new stop and resulting R; release opens a one-button confirm sheet ("Set stop 178.10 → 1.6R").
- Outer: Chart, Move stop (opens scrub explicitly), Breakeven, Close (log exit). Inner: Add trade, Stats (opens summary cards), Tag setup, Home.
- Accessibility note: scrub-to-adjust-stop is the single most valuable one-thumb feature in the app; it must also work as +/− stepper buttons and a numeric field in the sheet.

### Breadth monitor
- Primary: next metric group (thrust → MA % → positioning). Reverse: previous.
- Scrub: move back in time across the stored daily series; readout shows date and value.
- Outer: Phase detail, Sizing rule, Sectors, Scan (jump with breadth filter applied). Inner: Snapshot (PNG for Discord/Sunday Scans), Compare (overlay prior cycle), Home.

### Calendar
- Primary: next day. Reverse: previous day. Chip shows day and event count.
- Scrub: move across the week.
- Outer: Earnings, Econ, My names (positions with events this week), Alert. Inner: Add to Notebook, Home.

### Notebook
- Primary: new note (pre-filled with current symbol and section). Reverse: search.
- Scrub: scroll notes list.
- Outer: New note, Voice note, Link ticker, Sync (Obsidian). Inner: Templates (pre-market plan, post-trade review), Home.

### Options Flow
- Navigate-only until the Flow owner exports hooks. Fan = Home. Primary/Reverse unassigned.

### Morning Wire
- Primary: next section of the brief. Reverse: previous. Scrub: read progress.
- Outer: Chart (symbol mentioned in the current section), Watch, Note. Inner: Home.

## C4. Cross-section conventions
- Shared `symbol`, `timeframe`, `activeScan`, `selectedPosition` live in hub context; sections read and write them so "Chart it" from anywhere lands on the right symbol at the right timeframe.
- "Why?" always means Sonar research on the current symbol. "Watch" always means UCT20. "Note" always means Notebook pinned to the current symbol.
- Any action that opens a sheet returns focus to the knob on close.

---


---

# Part D — Agent organization for the build

A hundred agents working at once produce a hundred opinions. What produces quality is a hierarchy where a few agents own decisions, many agents do bounded work, and separate agents verify. The plan below uses roughly 30 persistent roles and spawns short-lived task agents in waves; across the project that adds up to well over 100 agent runs, but never more than ~12 active at once.

Implementation in Claude Code: define each role below as a subagent (`.claude/agents/<role>.md`) with its own system prompt, tool allow-list, and model. The Director runs on Opus; leads on Opus; workers and verifiers on Sonnet. Verify current subagent/agent-team syntax with `/help` before creating the files.

## D1. Org chart

```
Director (1) — owns scope, gates, and the registry as the single source of truth
├── Discovery lead (1)
│   ├── Codebase cartographer — routes, shell, state, tokens
│   ├── Chart widget analyst — TradingView API surface actually used
│   ├── Data-flow analyst — stream store, REST, caches
│   ├── Auth & tier analyst — how membership is exposed
│   └── Section scouts (one per section, 9) — what each page can do today
├── UX lead (1)
│   ├── Interaction designer — gesture vocabulary, per-section maps (Part C)
│   ├── Accessibility specialist — WCAG 2.1 AA, screen reader, motor, voice
│   ├── Mobile-browser specialist — iOS Safari / Android Chrome viewport, safe areas, gesture conflicts (this is the only target)
│   ├── Copywriter — labels ≤10 chars, chip text, toasts, coach mark
│   └── Visual designer — glass tokens, light/dark, high-contrast variant
├── Architecture lead (1)
│   ├── Registry engineer — types, defineMode, requires/tier, JSON-patch overrides
│   ├── Gesture-engine engineer — pointer math, wedges, flick, scrub, haptics
│   ├── Context engineer — hub context, useHubMode, stream subscriptions
│   └── Section integrators (one per section, 9) — wire Primary/Reverse/Scrub/fan
├── QA lead (1)
│   ├── Device tester — real iPhone and Android checklist, toolbar collapse, landscape; no desktop testing
│   ├── Accessibility auditor — independent of the specialist
│   ├── Gesture-accuracy tester — 10-target hit tests, false-fire rate
│   ├── Regression tester — existing navigation untouched
│   └── Security reviewer — no order paths, no Flow code edits, no secrets
└── Documentation lead (1)
    ├── CLAUDE.md maintainer
    └── Handoff writer — partner-facing summary for Discord
```

## D2. Rules of engagement
- Only the Director edits `registry.ts`. Everyone else proposes changes as diffs in their report.
- Leads review worker output before it reaches the Director. Workers never talk to other workers' files.
- Every worker report ends with: files touched, what was verified, open questions, confidence (high/medium/low).
- QA agents receive the spec, not the implementer's notes, so they test intent rather than what was built.
- Any agent that discovers Options Flow needs a change stops and files a request for the Flow owner instead of editing.
- Section scouts and section integrators are different agents; the scout's report is the integrator's brief.

## D3. Waves (map to the prompt's phases)

| Wave | Who runs | Active agents | Output |
|---|---|---|---|
| 0 Discovery | Discovery lead + 4 analysts + 9 scouts | ~10 | Route table, state map, token sheet, 9 section capability reports |
| 0.5 UX design | UX lead + 5 specialists | 6 | Final Part C with per-section gesture maps validated against scout reports; label sheet; accessibility plan |
| 1 Foundation | Architecture lead + registry, gesture, context engineers | 4 | Registry, context, gesture engine, no sections wired |
| 2 Sections | 9 integrators in 3 batches of 3 | 3–4 | Each section wired; each batch reviewed by Architecture lead |
| 3 QA | QA lead + 5 testers | 6 | Defect list with severity; nothing ships with a Sev-1 open |
| 4 Polish + docs | Visual designer, copywriter, doc lead + 2 | 5 | Settings, coach mark, CLAUDE.md, handoff |

Approval gate after every wave; the Director summarizes and stops.

## D4. Subagent template

```
---
name: section-scout-journal
model: sonnet
tools: Read, Grep, Glob
---
You are scouting the Journal 2.0 section of UCT Intelligence for the joystick hub.
Read only. Report: the component tree, every user action available on this page,
the state that backs each action (file and hook), what is streamed vs fetched,
what a one-thumb user would most want to repeat, and what must never be one gesture
away. End with open questions and a confidence rating. Do not propose code.
```

Copy this shape for every role; change the mission paragraph and tool list. Leads get Write access to their area; QA gets Read plus Bash for tests; only the Director gets Write on `registry.ts` and `CLAUDE.md`.


## D5. Handoff

Patrick's first message to you will be: "Read CLAUDE.md, then this document in full. Create the subagents in D1 using the D4 template. Run Wave 0 as Director and stop at the gate."

Wave 0 ends with a single consolidated discovery report, the corrected section names for Part C, the fill-in answers you still need from Section B11, and nothing built.
