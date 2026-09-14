---
id: S4-REVIEW-RULE
title: The current symbol has one authority — a review rule
role: the ratification CP1 measured, written where a reviewer meets it
status: ⛔ UNSIGNED — this document is S4 CP2 and is not merged.
date: 2026-09-14
---

# S4 review rule — the current symbol has ONE authority

> ⛔ **UNSIGNED.** This is the docs half of **S4 CP2**
> (`gates/s4-context-bus-pre-implementation-gate.md` §4). It is built to
> signature-ready and merges only on a line naming CP2.

---

## 1 · The rule, in three sentences

1. **`app/src/hooks/useAppFocus.js` is the promoted authority for "which symbol is the
   member looking at".** Owner ruling, 2026-08-14, carried in the file itself
   (`useAppFocus.js:8-13`): *"charts **Group A IS the app focus** … There is exactly ONE
   value, so there is no second authority to drift."*
2. **A URL parameter is an INSTRUCTION, not a channel.** `chartDeepLink.js:13-17`:
   *"Deliberately NOT a new state channel: the workspace applies these through the
   authorities it already has … and then **STRIPS the params**, so the URL is a one-shot
   instruction rather than a second source of truth."*
3. **A new state channel for the symbol needs its own approval line.** Not a rider on a
   feature; §4 of the S4 packet is where such a line goes.

---

## 2 · ⛔ What CP1 actually found — an ADOPTION gap, not a capability gap

`lib/context/focusDivergence.js` records the measurement, and it is the reason this rule
is worth writing down rather than assuming:

| measured | value |
|---|---|
| files walked | **2,702** |
| distinct context mechanisms that exist | **9** |
| non-test files still holding or passing a symbol by prop or `useState` | **184** |
| files that joined the bus since August | **2** |

⭐ **The bus was built and almost nobody joined.** So the rule a reviewer needs is not
*"build a bus"* — it is *"do not add a tenth mechanism, and when you touch one of the
nine, derive it from the authority instead of restating it."*

---

## 3 · The derivation table — what reads what, today

| mechanism | what it holds | standing |
|---|---|---|
| `useAppFocus()` | charts Group A, read from `charts_workspace_groups` | ⭐ **THE AUTHORITY** |
| `hub/HubContext.jsx` `symbol` | its own copy | second authority — **CP3** derives it |
| `TickerHubContext.sym` + `charts_mobile_sym` | its own copy + a storage key | second authority — **CP4** derives it |
| `setVoicePageHint` (`TickerPopup.jsx:186`) | a sentence composed at the call site | **CP5** produces it from the authority |
| `chartDeepLink.js` params | a one-shot instruction, applied then stripped | ✅ **correct by construction** — the shape to copy |
| `focusDivergence.js` | **nothing** — it compares and holds no state | ✅ read-only, revertible by deletion |

⛔ **`focusDivergence.js` is one keystroke from becoming the tenth mechanism.** Its own
header says so: *"It is only safe because it holds nothing. The moment it caches,
defaults, or normalises differently from `useAppFocus`, it IS the tenth mechanism."*

---

## 4 · ⭐ The rail behind the rule, and why it is a GATE and not a report

`app/src/lib/context/symbolLinkChannels.test.js`.

It derives the parameter names from the authority's own exported `CHART_LINK_PARAMS` —
never a typed copy — and sweeps every non-test source file (comments stripped) for a
**hand-typed** query-param read of a symbol or timeframe spelling.

⛔⛔ **THE REPO IS ON THE WRONG SIDE OF RULE 2 RIGHT NOW.** Measured 2026-09-14: **five
such reads across three files**, and two of them spell the same fact a **third** way.

| file | spelling | standing |
|---|---|---|
| `pages/ChartRender.jsx` | `sym`, `tf` | a headless bot renderer — a different door by design |
| `pages/charts/grid/MultiChartGrid.jsx` | `tf` | the admin-only `?gridspike=` perf harness |
| **`pages/journal-2-0/tabs/NotebookTab.jsx`** | **`ticker`** ×2 | ⛔ **the real one — see F-S4-1** |

⭐ **That non-empty population is what makes this a gate rather than decoration.** A check
whose only dirty case is synthetic reads as coverage; this one has three live files behind
it and a baseline that a migration must shrink.

**Mutation-proved, both directions, restored by EDIT:**

| mutation | result |
|---|---|
| a new module hand-types `.get('symbol')` | ⛔ **RED**, naming `lib/context/__mutation_probe.js` |
| a baselined file that no longer hand-types | ⛔ **RED**, naming it and saying to remove it |
| restored | **8 passed** |

⚠️ **The first positive control was wrong and the rail said so.** It asserted the sweep
finds hand-typed reads *inside the authority*; it found none — because `chartDeepLink.js`
reads `p.get(CHART_LINK_PARAMS.sym)`, through the constant, which **is the behaviour being
ratified**. The control now asserts both halves: the matcher sees the real population, and
the authority routes through the constant. A control that fails on correct code is not a
control.

---

## 5 · What a reviewer should actually do

- Adding a surface that opens charts on a symbol → import `chartsLinkPath` /
  `readChartsLink`. Do not type `?sym=` or `.get('sym')`.
- Touching one of the nine mechanisms → derive from `useAppFocus()`, and delete the
  restated copy **in the same commit**.
- Needing a genuinely new channel → open an approval line at the S4 packet §4. The answer
  may be yes; it may not be a rider.
- Adding a file under `lib/context/` → it must hold nothing, or it is the tenth mechanism.

⛔ **Not in this rule's scope:** `crosshairBus`, `aiSearchBus`, `useChartsSym`'s resolution
order, the pane-focus UI, and the 184 prop/local-state files. Those are CP3+ or unscoped.

---

## 6 · OPEN QUESTION — where a reviewer actually meets this

CP2's line says *"where a reviewer meets it"*. The obvious home is a section in the code
worktree's `CLAUDE.md`, which is the first file a new engineer reads.

⛔ **Deliberately not done here.** `CLAUDE.md` is already being changed by **Packet C CP2**
(the service count) and **Packet D** (the Nav Tabs section), and this programme's
one-concern-per-diff rule means a third unsigned unit must not touch the same file. This
document is the content; **[KEYBOARD] the owner decides whether it is also inlined into
`CLAUDE.md` once C and D have merged**, at which point it is a one-section docs diff.
