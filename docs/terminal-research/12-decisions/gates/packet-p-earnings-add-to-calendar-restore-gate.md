---
id: PACKET-P
title: Restoring "Add to calendar" after the earnings-modal swap — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: PROPOSED, unsigned
date: 2026-09-22
---

# PACKET P — a real regression, not a never-shipped feature

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> ⛔⛔ **NOT AUTHORIZED. PROPOSED** — no existing checkpoint governs this connection.
> **Non-collision:** `PACKET-P` appears nowhere in either worktree (checked before writing this
> file — `PACKET-K` is taken by an unrelated 2026-09-14 packet).

⛔ **ZERO NEW BACKEND CODE.** The endpoint is untouched, correct, and already has 5 tests. This
packet restores one link in a modal that replaced the one which used to have it.

---

## 1 · The gap, checked directly against source, and how it actually happened

`GET /api/calendar/report.ics` (`api/routers/calendar.py:3929-3934`) already builds a
single-event downloadable calendar file for one earnings report — no auth, no token, by design
("it's a single public event the user already sees"). It has 5 backend tests
(`tests/test_calendar_ics.py`) covering bmo/amc/tbd/unknown-timing/bad-input.

**This is a proven regression, traced to its exact cause, not a feature that was never built:**
commit `7c63b89fd` (2026-07-10) added an "Add to calendar" link to the earnings modal that
existed at the time (`components/tiles/EarningsModal.jsx`), reading
`href="/api/calendar/report.ics?sym=...&date=...&timing=..."`. That modal was deleted in the
2026-08-09 dead-code sweep (`d26cee0c0`) and replaced by
`components/research/EarningsResearchModal.jsx` (created 2026-08-04, so it briefly coexisted with
the old modal before replacing it) — and the replacement never picked up the link. **Verified
directly: the new modal already receives everything the link needs as props** —
`EarningsResearchModal.jsx:140` destructures `reportDate` and `timing` directly, and `sym` is
already in scope for the existing `CompanyLogo` render. Grepped `app/src` exhaustively for
"addCal"/"Add to calendar"/"report.ics" — zero hits anywhere, in code or CSS. The sibling
full-calendar export (`export.ics`) is alive and wired (`CalendarHeader.jsx:362-363`); only this
single-event variant was lost in the modal swap.

**Checked the safe placement, to keep this narrow:** the modal's header is composed via
`components/research-kit/shell/IdentityBanner.jsx`, a SHARED shell component — but it currently
has exactly ONE real consumer (`EarningsResearchModal.jsx` itself; a second file only mentions it
in a comment, verified by grep). Modifying a single-consumer shell component is lower-risk than a
multi-consumer one, but this packet's MUST-BUILD deliberately does NOT touch `IdentityBanner.jsx`
at all — the link goes elsewhere in `EarningsResearchModal.jsx`'s own render tree, keeping the
change fully local to one file.

## 2 · Proposed checkpoint

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | Restore one "Add to calendar" link in `EarningsResearchModal.jsx` | none | **XS** |

### MUST-BUILD, exactly

1. **`EarningsResearchModal.jsx`**: add an "Add to calendar" link/button — same href shape as the
   deleted implementation, `/api/calendar/report.ics?sym=${sym}&date=${reportDate}&timing=${timing
   || 'tbd'}` — placed in the modal's own render tree WITHOUT modifying `IdentityBanner.jsx`.
   Render conditionally on `reportDate` being present (an earnings row with no known date has
   nothing to schedule). A calendar `UIcon`, matching the deleted version's icon choice.
2. **`EarningsResearchModal.test.jsx`** (or wherever this modal's existing tests live — check
   first, extend rather than duplicate): a test asserting the link renders with the correct href
   for a report with a known date, and does NOT render when `reportDate` is absent.

### Explicitly deferred, NOT authorized by this line

- Any change to `api/routers/calendar.py`, `export_single_report_ics`, or `_build_vevent`.
- Any change to `IdentityBanner.jsx` — this packet does not touch it, by design.
- Reviving anything else from the deleted `EarningsModal.jsx` (the lifecycle chip, the widened
  modal, etc. — all already exist in the current modal in their own form; only the calendar link
  was actually lost).

### Risk

**Very low.** No backend change, one additive link in one file, gated on data already present as
a prop. Worst case is a link that fails to render for a report with no known date — the current,
unchanged behavior.
