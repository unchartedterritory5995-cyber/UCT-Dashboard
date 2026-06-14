# Calendar Week-Strip Calm Trim — Design

**Date:** 2026-06-14
**Status:** Approved (pending spec review)
**Surface:** `/calendar` — the WeekSummary banner + per-day MacroBand above the feed.
**Follows:** the Direction-B calm restyle + header simplification shipped earlier today.

## Problem

Two strips above the feed still read busier than the calmed cards/header:
- **WeekSummary** (`.summary`) — a gold-gradient banner with up to **5** stat columns.
- **MacroBand** (`.macroband`) — a per-day boxed row of macro-event tags with a
  2px blue left accent.

They draw more attention than their information warrants.

## Goal

Make both strips read as quiet context, consistent with the calm feed — without
removing any information the user actually relies on.

## Non-goals

- No data/logic changes. `summary` stats are still computed in `Calendar.jsx`;
  we only change what WeekSummary renders + the CSS.
- No change to feed cards, header, or views.

## Decisions (locked with user)

- WeekSummary keeps **3** stats (Your reports · Total reporters · Biggest expected
  move); drop "Macro prints" (already conveyed by MacroBand) and "Next of yours".
- Lighten both strips' chrome (gradient → near-flat, hairline separators, smaller
  type, tighter padding).

## 1. WeekSummary (`WeekSummary.jsx` + `.summary` CSS)

- **Render only 3 columns:** `Your reports this week`, `Total reporters`,
  `Biggest expected move`. Remove the `Macro prints` column and the
  `stats.next && …` "Next of yours" column from `WeekSummary.jsx`. (The `stats`
  object in `Calendar.jsx` is unchanged; the dropped fields simply go unrendered.)
- **CSS `.summary`:** replace the gold gradient with a near-flat subtle tint (or
  none) and keep the bottom hairline; add a thin separator between stat columns
  (e.g. `.scol + .scol { border-left: 1px solid var(--cal-line); padding-left: 18px }`).
- **CSS `.summary b`:** reduce stat value size (`15px → 14px`) so it reads as a
  quiet line rather than a banner. Labels (`.scolLbl`) unchanged.

## 2. MacroBand (`.macroband` + `.mtag` CSS)

- **Lighten chrome:** thinner/subtler left accent, smaller tag text
  (`.mtag` `11px → 10px`), tighter padding on `.macroband` (`8px 10px → 6px 9px`),
  and a flatter background so it reads as a subtle strip. No markup change to
  `MacroBand.jsx`.

## Components / files touched

- `app/src/pages/calendar/WeekSummary.jsx` — drop 2 stat columns.
- `app/src/pages/calendar/Calendar.module.css` — `.summary`, `.scol`, MacroBand
  (`.macroband`, `.mtag`) calm styling.

## Testing

- WeekSummary has no dedicated test today. Add a small `WeekSummary.test.jsx`:
  renders the 3 kept labels; does **not** render "Macro prints" or "Next of yours".
- Existing calendar tests stay green; `cd app && npm run build` passes.

## Verification

On `/calendar`: the summary line reads quiet (3 stats, hairline separators, no
heavy gradient); MacroBand is a subtle context strip. All numbers still correct.
