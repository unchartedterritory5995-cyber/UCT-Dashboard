# Best-in-class mobile program — FINAL CERTIFICATION

2026-09-08, branch `fix/mobile-legend-legacy-state`. Supersedes the status half of
`99d` and `99e`; **does not rewrite either** — both stand as the record of what
was true when they were written.

> # BEST-IN-CLASS MOBILE IMPLEMENTATION CERTIFIED WITH EXPLICIT VERIFICATION RESIDUALS
>
> **Build backlog: EMPTY. Zero surviving build items.**
> Not FULL certification, and §6 says exactly why — four verification debts
> remain, each named, none of them a missing feature.

---

## 1 · Final state

| | |
|---|---|
| MOB-08 `presentation[deviceClass]` | **SHIPPED** `af7c5fa17` (`99h`) |
| DEVICE_SCOPED_PRESENTATION | **PASS** — iPhone 17 Pro / iOS 26.6 |
| DEVICE_WORKSPACE_ROUNDTRIP | **PASS** — read back ON the device |
| Surviving build items | **NONE** |
| 20-flow distribution | UCT_AHEAD 11 · PARITY 7 · TRADINGVIEW_AHEAD 0 · DIFFERENT_MODEL 1 · PARTIAL 1 |

### The schema this program ended on

```jsonc
{
  "mode": "grid",                    // legacy key, RETAINED as a desktop-only
                                     // compatibility mirror with ONE writer
  "presentation": {
    "desktop": { "mode": "grid" },
    "mobile":  { "mode": "workspace" }
  },
  "layout": "2x2", "cells": [ … ]    // the BOARD — shared, untouched
}
```

One additive key. One scoped field. Two device classes derived from the shell.
No second workspace record, and no bulk migration of anything already stored.

## 2 · F17 re-evaluated — and it stays **PARTIAL**, on one narrow leg

The canonical flow is **portrait → landscape → portrait**, with application state
preserved. What is now measured on hardware:

- the presentation contract holds in both orientations (real iPhone, earlier pass);
- landscape is a *designed mode* — the rail is out of flow, vertical, left-anchored,
  five doors — verified on iPhone 16 Plus, iPhone 14 and iPhone 13 Pro Max;
- **APP STATE ACROSS ROTATION: STATE HELD**, on **two** devices, carrying symbol
  *and* timeframe.

⛔ **What is still not measured: the RETURN leg's application state.** Every
rotation reading was portrait → landscape. Landscape → portrait was verified for
*presentation* and never for *state*.

⚠️ It is tempting to infer it — the shell deliberately uses ONE media query
precisely so a rotation cannot produce an intermediate render that remounts and
wipes state, and that mechanism is symmetric. **An inference is not a
measurement**, and this program has been wrong before about exactly this kind of
"obviously it also…". F17 therefore stays PARTIAL with the debt narrowed from
"app state across rotation is unmeasured" to "the return leg is unmeasured".

## 3 · Desktop-only decisions — reconfirmed, and none is a deficit

| capability | why desktop-only | viable mobile workflow without it? | verdict |
|---|---|---|---|
| **Multi-chart grid** | Drag/resize is mouse-only; the grid measures a pointer the phone does not have. MOB-08 now makes the boundary *structural* rather than a UI workaround | Yes — the phone's chart-first shell is the mobile answer to the same need, and Layouts carry named boards across devices | **intentional product boundary** |
| **Bar replay** | A study/practice surface, not an in-session decision tool; recorded in `98` §3.3 | Yes — nothing in the trading loop depends on it | **intentional** |
| **Symbol comparison** | Multi-series overlay with its own axis semantics; the phone has the RS/analytics surfaces instead | Yes | **intentional** |
| **Desktop `ChartToolbar`, A/L/% price-scale chips, Heikin Ashi checkbox** | Presentation only — hidden on the phone shell by a stated contract, with the *tasks* reachable by other doors (long-press scale menu, chart-type sheet) | Yes — every task has a phone door | **intentional; tasks NOT lost** |
| **Renko · Kagi · P&F · Line Break · Baseline · Step Line** | Each is a different *construction* of the series with its own transform and live-bar rules against the single-writer invariant | Yes | **deferred product choice, not a gap** |

⛔ **None of these is a functional deficit**, and none should be re-listed as one.
The distinction the program kept: a control being correctly hidden says nothing
about whether its TASK is reachable — and every task here is.

## 4 · Instrument rules — permanent for this product area

These were each paid for with a real defect. They are rules now, not advice.

1. ⛔⛔ **`settled` ≠ `ready`.** A value that stops changing can be a blank or
   transitional state. Readiness needs an explicit `until`/ready predicate;
   `settle` only proves motion stopped. **This slip recurred FOUR times in one
   day** — the crosshair rAF race, the portrait-toolbar reading, `ws-nosymloss`,
   and `rot-baseline`.
2. ⛔ **No fixed-sleep certification of async UI state.** Where UI is
   intentionally frame-delayed, wait on the semantic condition — and on a
   predicate ONLY the desired state can satisfy (`/O\s*1/` also matches the
   off-hover row, so it proves nothing).
3. ⛔ **No "zero tests ran" mutation pass.** Every mutation harness carries a
   non-vacuity control; a filter that matches nothing exits 0 and reads as a
   pass.
4. ⛔ **No single-frame orientation claims.** Orientation cannot be a step — a
   step runs once, at load, and a device session starts portrait. Use a panel
   that re-reads forever and prints a clock.
5. ⛔ **No jsdom-only certification of layout-sensitive mobile behaviour.** jsdom
   lays nothing out and reports `pointer: fine`; a desktop frame cannot answer a
   `pointer: coarse` question at any width. Use emulated-coarse Playwright for
   the rule, hardware for the truth.
6. ⛔ **A failed prerequisite must BLOCK, never pass.** Enforced by the harness's
   state machine and proven by `--break-auth`.
7. ⛔ **Evidence that lives only in a transcript was never preserved.** Save
   device frames at capture time.

## 5 · Final regression state (actual runner exit codes)

| suite | exit | result |
|---|---|---|
| `pages/charts` + `testing/device` + `components/mobile` | **0** | **734 / 734** across 87 files |
| `components/chart` | **1** | **7,246 passing**, 4 skipped, **3 failed** |
| `pages/charts/presentation` (MOB-08) | 0 | 16/16, 5/5 mutations RED |

**The three failures are the known pre-existing ones, unchanged and distinct:**
`ImportBox.thinkscript` (CRLF line endings on Windows) · `manifestProse`
(`_session` key) · `pine.blindCorpus` (indicator-ecosystem workstream). **No new
failures. No aggregate timeouts in this run** — the two filesystem-scan timeouts
seen earlier did not recur, and would not have been hidden if they had.

## 6 · Verification debt — four items, all named

1. 🔴 **Five Tier-3 steps are LOCAL-ONLY.** `layouts-ui`, `objects-ui`,
   `tool-discovery`, `symbol-search` and `price-context` were added this session
   and pass **22/22 in 9.6 s** under emulated coarse pointer — but the hardware
   run did not happen: **the Chrome extension became unresponsive** (repeated
   script-injection timeouts across two tabs) after the tunnel was up. The
   harness is committed and staged; this is one device-minute of work.
2. **F14 bound-alert lifecycle.** Create → move the drawing → confirm the stored
   binding references the object rather than a copied snapshot → let the
   evaluator run outside the phone window → inspect the fired alert. Not
   attempted; **F14 remains PARITY** and is not upgraded on unit evidence.
3. **F17's return leg** — landscape → portrait application state (§2).
4. **Drawing placement by finger, and Hide → recover as a driven flow.** The
   object manager *opens* on device; placing a drawing with synthetic touch and
   recovering a hidden one is not scripted. Both are covered by behavioural
   tests and the earlier no-auth device pass, neither by the authenticated
   harness.

⭐ **Every one of these is a measurement that has not been taken — not a feature
that is missing.** That distinction is why this certifies with residuals rather
than failing to certify.

## 7 · The seven questions, answered plainly

**1 · Is UCT at least as capable as TradingView on the validated high-value
mobile charting workflows?** **Yes.** Across the 20 canonical flows, TradingView
is ahead on **none** (0 TRADINGVIEW_AHEAD, down from 2 at certification and 4 in
the original research). UCT leads 11 and matches 7.

**2 · Where is UCT objectively better?** Eleven flows, and the substantive ones:
`Set level…` exact numeric placement (TradingView has no equivalent) · a
crosshair readout carrying OHLC + V + **$ Vol + Avg 50D** + every indicator in
one hold · an indicator chip menu richer than the thing it was compared against ·
price-context actions on a bare chart · a **server-backed, named, cross-device
workspace with admin-published firm prebuilts**, which the phone writes to as a
first-class client · drawing-tool search that answers to *what a trader means*
(35 aliases, ranked, never a dead end) · symbol rows that disambiguate delisted /
ETF / breadth pseudo-tickers · and cross-device correctness — MOB-09's
highwatermark fix and MOB-08's scoping both close silent losses.

**3 · Where is TradingView still better?** **On the measured flows, nowhere.**
Two honest qualifications: its drawing-tool picker is still *native-fast* with
categories that help at a larger catalogue (F10 is PARITY, not a win), and it
offers a broader chart-type catalogue (Renko/Kagi/P&F) that UCT declines with a
stated reason. Neither is a defect; both are recorded rather than spun.

**4 · Is any high-value mobile task accidentally unavailable?** **No.** Every
orphan this program found is closed: `$ Vol`/`Avg 50D`, the Percent-scale writer,
Drawing Boards, Heikin Ashi, Clear-all, Repeat, the all-tools roster, the
Objects surface, the Layouts door. The presentation register in `98` shows **no
orphaned mobile tasks**, and MOB-08 removed the last accidental inheritance.

**5 · Does any serious charting task still require desktop because of a MISSING
implementation?** **No.** Three things remain desktop-only and **all three are
deliberate** (§3): multi-chart grid, bar replay, symbol comparison. Each has a
stated reason, and none blocks a trading workflow on a phone.

**6 · What verification debt remains?** The four items in §6 — five Tier-3 steps
awaiting one device-minute, the F14 lifecycle, F17's return leg, and driven
drawing/Hide-recover.

**7 · Are there any surviving build items?** **No. Zero.** The
SURVIVING_BUILD_ITEM category is empty for the first time since the program
began.

---

## 8 · What this program actually cost, recorded once

Twelve implementation commits after certification, one persistence-scope
migration, and — the part worth remembering — **five instrument defects found in
our own tooling**, four of them the same sample-instead-of-settle mistake in four
different costumes. The product defects were mostly *orphans*: real features with
no phone door. **The instrument defects were mostly *false confidence*: probes
that reported success while measuring nothing.** The second class was more
expensive, and §4 exists so it stops being rediscovered.
