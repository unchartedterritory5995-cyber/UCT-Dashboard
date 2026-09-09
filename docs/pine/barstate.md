# `barstate.*` — where a bar sits in time, and in the fetch

**Status:** shipped 2026-09-09 (owner ruling). Six names served, one refused.

A bar's state is decided by **two** things, and neither is the tape:

* the **fetch** says which bar is newest and which is oldest;
* the **clock** says whether the newest one's period has finished.

Nothing here reads a price, which is why these are clock columns rather than
functions, and why they cost no bars of lookback.

---

## What ships

| Pine name | Column | Meaning here | Contract |
|---|---|---|---|
| `barstate.islast` | `islast` | the newest bar the fetch delivered | host **and** screener |
| `barstate.isfirst` | `isfirst` | the oldest bar the fetch delivered | host only — carries `window_dependent` |
| `barstate.isrealtime` | `isrealtime` | the newest bar, while its scheduled close is still ahead of the evaluating instant | host (screener folds to 0) |
| `barstate.isconfirmed` | `isconfirmed` | the bar's period has ended | host (screener folds to 1) |
| `barstate.ishistory` | `ishistory` | same as `isconfirmed` — see the divergence below | host (screener folds to 1) |
| `barstate.islastconfirmedhistory` | `islastconfirmedhistory` | the newest bar whose period has ended | host **and** screener |

`barstate.isnew` is **refused by name** on both contracts. It is true on the
*first execution* of each bar — a fact about how many times the script ran, not
about the bar — and this engine executes a static fetch exactly once. Every bar
would be `isnew`, so the answer would be a restatement of the question.

> ⚠️ **This is a shipped-behaviour change.** `barstate.isnew` folded to `1` for
> the screener until 2026-09-09. A screen that spelled it translated before and
> refuses now.

### Why `islast` is not window-dependent and `isfirst` is

Widen the fetch and the **oldest** bar moves — every value keyed on it moves with
it, forever. The **newest** bar is the newest bar however much history was asked
for. So `isfirst` carries `_requirement_tags.window_dependent`, which the
screener, the sweep, the alert evaluator, a share link and a public listing all
refuse **by name**, and the pane accepts with a disclosure. `islast` carries no
tag at all.

This asymmetry is why the old `BUILTIN_REQUEST_DEPENDENT` refusal was withdrawn:
its sentence said each of the three names "would answer differently for the same
stock on the same day", which was true of one of them.

---

## The clock, and the two gaps in it

`isrealtime` needs to know when the newest bar's period **is scheduled to end**.

* **Intraday** (`1`, `5`, `15`, `30`, `60`) — exact, and needs no calendar. A
  5-minute bar ends 300 seconds after it starts whether the market is in its
  regular session, its pre-market or its post-market. That matters because our
  fetch **can** contain extended-hours bars: `bars_fetch` keeps those prints
  deliberately and the yfinance fallback asks for them with `prepost=True`. There
  is a test for this rather than a sentence.
* **Daily and above** — 16:00 New York, walked forward to the period's last
  trading day for weekly and monthly.

### Gap 1 — early closes are not known

**This engine knows NYSE full closures and does not know half-days.**
`bars_fetch._NYSE_HOLIDAYS_YYYYMMDD` is the one authority (five readers, plus
`GET /api/market-calendar`), and it says in its own words that 1pm ET early
closes are *"intentionally NOT"* included.

**Effect:** on an early-close session the newest daily bar reads `isrealtime` for
up to three hours after trading actually stopped, and `isconfirmed` is `0` for
that window.

**Not rounded away.** `barstate.test.js` asserts the defect on purpose, so the
day a half-day calendar lands the test goes red **by name** and the correct edit
is to invert it. A pipeline backlog item asks for the half-day set beside the
closure set.

### Gap 2 — the closure set has to be handed in

The weekly and monthly walk-back needs the closure set, and `computeClock` takes
it as a parameter rather than importing one: a second list of exchange dates is
exactly the defect `/api/market-calendar` was written to prevent. **Absent, a
holiday-shortened week reads `isrealtime` for a day longer than it should** — a
week ending on Good Friday actually ended on the Thursday.

---

## What a member is told

The manifest's `_barstate.vendorNote` reaches the paste box through the same walk
that surfaces `atr`'s note, and the pane's data notes carry the early-close gap.

> TradingView's `barstate.ishistory` tells you whether the CHART loaded that bar
> or watched it form, so two people opening the same symbol at different times
> get different answers about the same bar. This engine evaluates one static
> fetch, where every closed bar arrived the same way, so `ishistory` here means
> exactly `isconfirmed`: the bar's period has ended. A script that branches on
> the two will always take the historical arm.

Ledger row: `tests/fixtures/vendor/divergences.json::barstate-viewer-dependent-on-vendor`,
status **accepted**, confidence **reasoned** — the viewer-dependence is argued
from the vendor's documented behaviour and has **not** been captured on a live
chart. The row names the capture that would settle it.

---

## Stability, and the one column that legitimately moves

A member's saved definition is evaluated by a pane now and by a sweep in an hour,
and a **closed** bar must read identically in both. That is only true because the
evaluating instant is an **input**: `computeClock(bars, tf, now, holidays)` never
reads the wall clock, so it can be asked the same question twice.

> ⛔ **`islastconfirmedhistory` is the exception, and it is not a defect.** It
> does not name a property of a bar; it names the **right edge** of the confirmed
> region, and that edge moves the instant the newest bar closes — bar *n-2* stops
> being the newest confirmed bar and bar *n-1* becomes it, with neither bar having
> changed. Pine's column moves for the same reason. A consumer must not treat it
> as a stable per-bar fact.

## Scope

The flags are correct **at fetch time**. A refetch re-evaluates them; a bar that
closes while a pane sits open does not flip until the next fetch. Streaming
updates are a later phase, recorded here so the absence is not read as a defect.
