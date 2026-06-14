# Calendar Header Simplification — Design

**Date:** 2026-06-14
**Status:** Approved (pending spec review)
**Surface:** `/calendar` header (`CalendarHeader.jsx`); minor touches to EarningsModal + dead-CSS cleanup.
**Follows:** `2026-06-14-calendar-visual-sharpening-design.md` (logos + Direction B cards — already shipped).

## Problem

The calendar header has accumulated ~13 controls across two rows: title, view
toggle, date label, ⭐ Hub link, Export menu, a standalone `★ My Stocks ⚙` gear,
event-type chips, audience chips, cap select, sort select, and a metric Filters
popover. Two of these — the **audience chips** (★ My Stocks / Watchlist /
Positions / UCT20 / All) and the **★ My Stocks ⚙ gear** (which sources count as
"mine") — express the same "what's mine" idea in overlapping ways. The phone
already consolidates everything behind a single FiltersSheet; the desktop does not.

## Goals

- One tidy header row on desktop: only the controls you touch constantly stay
  visible; everything secondary moves behind a single **⚙ Filters** panel.
- Remove the duplicate personalization control; surface "what's mine" config in
  exactly one place.
- Converge desktop and phone onto the same consolidated filter set.
- No change to data, filter behavior, or persisted preferences.

## Non-goals

- **Cards are unchanged.** Direction B stays exactly as shipped.
- No view is removed (Feed / Week / Month all stay).
- No backend changes. All filter/view state already persists via `usePreferences`.

## Decisions (locked with user)

- Header: consolidate (approved visually).
- Cards: keep as-is (user: "keep the card how it is").
- Views: keep all three.
- Personalization: merge into one place (audience chips inline + source config
  inside ⚙ Filters and the Hub).

---

## 1. Always-visible header row

`CalendarHeader.jsx`, the `.hrow` block. Keep only:

- `📅 Calendar` title
- View toggle (Feed / Week / Month)
- Date label (`weekLabel`) — or the month nav when `view === 'month'` (unchanged)
- **Audience chips** (`AUDIENCE`: ★ My Stocks / Watchlist / Positions / UCT20 /
  All) — the primary filter, stays inline
- **⚙ Filters** button (pushed right with `margin-left: auto`)
- **⭐ Hub** link

Removed from this row (relocated into ⚙ Filters — see §2): the standalone
`★ My Stocks ⚙` gear button, the `Export ▾` button, and the entire secondary
`.fb` cluster (event-type chips, cap select, sort select, metric Filters popover).

## 2. The ⚙ Filters panel (desktop)

A single popover toggled by the ⚙ Filters button, reusing the control fragments
**already extracted** in `CalendarHeader.jsx` so there is no duplicate markup:

- `eventTypeChips` (Earnings / Macro locked-on, IPOs / Dividends toggle) — only
  when `view !== 'month'` (same condition as today)
- `capSelect` (Any / $2B / $10B / $50B)
- `sortSelect` (My stocks first / Time / Market cap / Expected move)
- `metricInputs` (min avg vol / price min / price max)
- `sourcesCheckboxes` ("Count toward My Stocks": Watchlists / Flagged /
  Positions / UCT20) — this is the old gear's content
- Export actions (Download .ics / Copy webcal) — the old `ExportMenu` body

Structure the panel with the same labeled sections the phone `FiltersSheet`
already uses (`.sheetSec` + `.sheetLbl`) so desktop and phone read identically.
The panel reuses the existing `.gearPop`/`.filterPop` popover styling (positioned,
bordered, shadowed, `z-index: 50`).

**Behavior:** clicking ⚙ Filters toggles the panel; opening it closes any other
open popover (same mutual-exclusion the current buttons already do). The old
`FiltersPopover` component and `ExportMenu` component bodies are folded into this
panel; the separate `gear` / `filterOpen` / `exportOpen` states collapse into a
single panel-open state.

## 3. Active-filter indicator

The ⚙ Filters button shows a dot or count when any secondary filter is active, so
hiding the controls doesn't hide that they're engaged. Reuse the existing
`mobileActiveCount` logic, extended to also count a non-default event-type set and
a non-default sort:

```
activeCount =
  (minAvgVol ? 1 : 0) + (priceMin ? 1 : 0) + (priceMax ? 1 : 0) +
  (minMcap > 0 ? 1 : 0) +
  (eventTypes beyond {earnings, macro} ? 1 : 0) +
  (sort !== 'mine' ? 1 : 0)
```

Render as `⚙ Filters · N` (or a dot) when `activeCount > 0`, styled with the
existing `.filterBtnActive` class.

## 4. Personalization merge

No change to what `★ My Stocks` computes — it remains the union of the enabled
`calendar_mystocks_sources`. The only change is *where* sources are configured:
the standalone header gear is removed; source checkboxes now live in the ⚙ Filters
panel (§2) and continue to exist on the `/calendar/mystocks` Hub. The audience
chip `★ My Stocks` continues to select that union as the active audience.

## 5. Phone

The phone already routes everything through `FiltersSheet` via the single
`⚙ Filters` button — **no phone change needed**. After this refactor desktop and
phone share the same conceptual panel (desktop = popover, phone = bottom sheet).
Verify the phone path still renders the same sections (it uses the same fragments).

## 6. Cleanup + small spread

- **Dead CSS removal** in `Calendar.module.css` (confirmed unused after the
  Direction-B card ship): `.bmo`, `.amc`, `.sessionLbl`, `.hist`, `.hist i`,
  `.histPos`, `.histNeg`, `.histLbl`. **Keep** `.tpill` (EventCard IPO status
  pill), `.bmoHd`, `.amcHd` (FeedView timing headers).
- **EarningsModal logo (small polish):** EarningsModal currently shows no company
  logo. Add a crisp `CompanyLogo` (size ~38) to its header next to the ticker for
  consistency with the feed. Low-risk, additive; if it complicates the modal
  header layout, it may be dropped without affecting the rest of the design.

## Components / files touched

- `app/src/pages/calendar/CalendarHeader.jsx` — header row trim + unified
  ⚙ Filters panel (fold in `FiltersPopover` + `ExportMenu` + gear sources),
  single panel-open state, extended active-count.
- `app/src/pages/calendar/Calendar.module.css` — ⚙ Filters panel styling (reuse
  existing popover/sheet classes) + dead-CSS removal.
- `app/src/components/tiles/EarningsModal.jsx` — optional crisp header logo.

## Testing

- `CalendarHeader` has no dedicated test today. Add a focused
  `CalendarHeader.test.jsx`:
  - renders the view toggle + audience chips inline;
  - the ⚙ Filters panel is closed initially, opens on click, and contains the
    event-type chips, cap/sort selects, metric inputs, source checkboxes, and
    export actions;
  - the standalone `★ My Stocks ⚙` gear and inline `Export ▾` button are no longer
    in the always-visible row;
  - active-count badge appears when a metric filter / non-default sort is set.
- Existing calendar tests (`filterLogic`, `eventCard`, `EarningsCard`, etc.) must
  stay green — filter *logic* is unchanged, only the controls' location moves.
- `cd app && npm run build` must pass.

## Risks / mitigations

- **Hidden controls feel "lost":** mitigated by the active-count indicator (§3)
  and keeping the primary audience filter inline.
- **Regressing filter behavior during the move:** mitigated by reusing the
  already-extracted control fragments verbatim (no logic rewrite) and keeping all
  `usePreferences` keys identical.
- **Phone regression:** none expected (phone already uses the sheet); covered by a
  build + the existing phone path.

## Rollout / verification

1. Ship as a frontend-only change to `master` (project workflow).
2. Verify on `/calendar` desktop: one-row header, ⚙ Filters opens the full panel,
   audience chips work, active-count shows, Export still downloads/copies, source
   config still changes "My Stocks".
3. Verify phone view unchanged.
