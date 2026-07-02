# Journal UX Polish — Skeletons · Live Micro-interactions · Mobile Cards

**Date:** 2026-07-02
**Context:** Follows the completed Robinhood Journal initiative (phases 1a–4, spec `2026-07-01-robinhood-journal-design.md`). User picked three items: skeleton loading, live-feel micro-interactions, and mobile card views for the two dense tables. After-hours hero row deferred (not picked).

## Goals
Perceived speed (no blank flashes / loading text), a live "it ticks" feel matching Robinhood, and phone-usable dense tables — without touching desktop table functionality.

## 1. Skeleton loading

**Primitive:** `app/src/components/Skeleton.jsx` + `.module.css` — a single shimmer block.
- Props: `width` (CSS size, default `100%`), `height` (default `14px`), `round` (bool → pill/circle radius), `className`.
- Visual: dark base (`--surface-2`) with a slow gold-tinted shimmer sweep (1.4s ease-in-out infinite, mirroring `ChartSkeleton`); `@media (prefers-reduced-motion: reduce)` → static block, no animation.
- Accessibility: purely decorative (`aria-hidden`); the composed layouts carry `role="status"` + sr-only label.

**Composed layouts (each `aria-busy`, sr-only "Loading …" label):**
- `HoldingsListSkeleton` (in `journal-2-0/components/`) — 5 rows: 28px circle · 2 stacked text bars · centered sparkline band · right pill bar. Replaces the `Loading positions…` text in `OpenPositionsTab` (list view) and stands in while `isLoading && mergedPositions.length === 0`.
- `BrokerAccountHero` skeleton state — when the hero has neither `liveSummary` nor perf base yet (first paint): big value bar (~180×34), two stat bars, full-width graph band (~120px). Rendered inside the hero card so layout doesn't jump.
- `PositionDetailPage` skeleton — while the snapshot AND position data are both cold: header (40px circle + two bars + right price bars) and chart band (420px); sections continue to appear progressively as their feeds land (no skeletons per section — absent sections simply mount when ready).

## 2. Live-feel micro-interactions

- **`useAnimatedNumber(value, { duration = 350 })`** (`app/src/hooks/useAnimatedNumber.js`): rAF tween from previous to next value; returns the in-flight number. First render = no tween (snap); `prefers-reduced-motion` = snap; non-finite values pass through untouched. Applied to: BrokerAccountHero account value + Today $ figure; detail-page header price.
- **Price-pill tick flash:** in `HoldingsList`, when a row's live `price` changes, apply a one-shot CSS class (`flashUp`/`flashDown` by direction of the price change) for ~600ms — brighter fill + slight glow, then settle. Implementation: keyed `useEffect` per row comparing previous price (ref map), toggling state; CSS keyframes; reduced-motion → no flash. Same treatment on the detail-page header price text (color pulse only).
- **Row press feedback:** `.rowLink:active { transform: scale(0.995); filter: brightness(1.06); }` (+ transition); gated by reduced-motion for the transform.

Constraints: no additional re-renders beyond existing price-tick renders; animations are CSS or a single rAF loop per animated number.

## 3. Mobile card views for the dense tables

Phone (≤640px, `useIsPhone()`) renders card lists INSTEAD of the `<table>`; desktop/tablet untouched. `ResponsiveTable` deliberately not used (these tables carry sortable headers, column picker, inline setup select, option rows, action buttons — retrofit cost exceeds bespoke cards).

- **`PositionsTable` phone cards** (Table view only — the List view already handles phones): card per row —
  headline: symbol + side chip + Current price · P&L $ (%) colored;
  meta line: shares @ entry · stop (or "est."/"—" per broker rules) · date;
  actions: compact Edit / Close / Delete buttons (44px targets); option rows: label + mark + P&L + Close/Delete.
  Current sort order applies (cards map over the same sorted rows).
- **`TradesTable` phone cards:** headline: symbol + side + P&L $ (colored, + R multiple when present);
  meta: shares @ entry → exit · entry–exit dates;
  setup chip (read-only on phone — the inline `<select>` stays desktop-only; option-strategy rows already read-only);
  🧭 reviewed indicator preserved.
- Both card layouts live inside the existing components (a `CardList` branch), reusing their row-model/sort/display helpers. Verified via `tools/mobile_audit.py --viewport phone --routes /journal` (0 horizontal overflow, no sub-44px targets).

## Testing
Vitest per piece: Skeleton primitive render/props; skeleton swap-in states (loading → content); useAnimatedNumber (snap on first render, tween completion with fake rAF, reduced-motion snap); pill flash class toggling; phone-card rendering (mock `useIsPhone` true) for both tables incl. actions present + setup select absent on phone. Full journal suite + build + mobile audit before ship.

## Out of scope
After-hours hero row · any desktop table changes · new endpoints (frontend-only) · Dashboard/app-wide sweeps.
