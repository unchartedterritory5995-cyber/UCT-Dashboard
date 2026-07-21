# Chart Timeframe Shortcuts — Design

**Date:** 2026-07-21
**Status:** Approved, ready for implementation plan
**Scope:** Timeframe keyboard shortcuts only. Drawing tools, display toggles,
indicator toggles and replay controls are explicitly OUT of scope and keep their
current bindings.

## Problem

Two separate complaints, one root cause.

**1. Digits are eaten by ticker search.** On `/charts`, `ChartWidget` makes the
chart container focusable and turns any typed character into a symbol-search
query — that is the intended "just type a ticker" behavior. But
`TICKER_KEY_RE = /^[A-Za-z0-9.]$/` includes digits, and the handler calls
`e.stopPropagation()` (`ChartWidget.jsx:292`) specifically so a typed ticker can
never trigger a tool or timeframe. Net effect: pressing `1` puts "1" in the
search box and the timeframe shortcut never fires at all.

The user wants both behaviors at once — type letters to change ticker without
clicking into a search box, press digits to change timeframe — which is how
TC2000 behaves.

**2. The digit layout is arbitrary.** Today `1`=1m, `2`=15m, `3`=30m, `4`=1h,
`5`=5m. Not time-ordered, not memorable, and unrelated to any reference platform.

## Solution

Reserve a key *class* for chart commands so the two never compete. Tickers are
letters; timeframes become digits.

### Key map

| Key | Timeframe | | Key | Timeframe |
|---|---|---|---|---|
| `Shift+1` | 1 min | | `1` | Daily |
| `Shift+3` | 5 min | | `5` | Weekly |
| `Shift+4` | 15 min | | `9` | Monthly |
| `Shift+5` | 30 min | | | |
| `Shift+6` | 1 hour | | | |

Digit assignments mirror TC2000 exactly (`Ctrl+1/3/4/5/6` intraday, bare `1`/`5`
higher). Only the modifier differs: **`Ctrl+1`–`Ctrl+8` are browser-reserved for
tab switching** and cannot be intercepted by a web page, so `Shift` carries the
intraday set. `Shift` is safe on every browser and OS.

`Shift+2` is intentionally left unbound — TC2000 uses it for a 2-minute
timeframe, which this app does not have. Reserved for if it is ever added.

**`D` / `W` / `M` are retired.** The digits fully cover timeframes, and freeing
those letters is the entire point: `DELL`, `WMT` and `MU` become typeable.

**Matching is on physical key position** (`e.code` — `Digit1`, `Numpad1`), not
`e.key`. `Shift+1` produces `"!"` on a US layout and other symbols elsewhere;
keying off `code` makes the binding layout-independent and picks up numpad
digits for free. Bare digits still match `e.key` as they do today.

### Repeat-to-cycle

One ordered ladder, wrapping:

```
1m → 5m → 15m → 30m → 1h → Daily → Weekly → Monthly → (wraps to 1m)
```

- First press of a key goes to that key's **home** timeframe.
- Pressing the **same key again** advances one rung.
- Pressing a key while the chart is **already on that key's home** also advances,
  so no press is ever a silent no-op.
- Pressing a **different** timeframe key resets to that key's home.
- If the timeframe changed by any other means since the last keypress (the TF
  bar, a saved layout, a grid cell restore), the chain is broken and the next
  press goes home. This is detected by comparing the chart's current timeframe
  against the rung the last keypress landed on — no extra bookkeeping.
- The walk wraps at Monthly back to 1 min.

Rules are evaluated in the order listed, so they are total and deterministic: if
a different key's home happens to equal the current timeframe, the "already on
home" rule applies and it advances.

State is a per-chart-instance ref (`{command, index}`), not module-global — two
chart widgets keep independent cycle positions. No timers, so nothing can expire
mid-sequence.

Worked example, tapping `Shift+1` repeatedly: 1m → 5m → 15m → 30m → 1h → Daily →
Weekly → Monthly → 1m. Tapping `1` repeatedly: Daily → Weekly → Monthly → 1m.

### Chart ownership — already satisfied

A keypress must drive only the focused chart, not every mounted one. **This is
already implemented on master** and needs no new work: `StockChart` takes a
`hotkeysActive` prop (`StockChart.jsx:854`, boolean or callback, read through a
latest-ref so neither form re-subscribes the listener). `ChartWidget` passes
`hotkeysIsActive` and `GridChartCell` passes `isActive`, both derived from the
container's active-cell ref. It defaults to `true`, so single-chart surfaces
(Watchlists, Theme Tracker, TickerPopup, Breadth DrillModal, Journal) respond
unconditionally.

The cycle-position ref lives inside `StockChart`, so it is naturally per-instance
and inherits this gating.

### Type-to-search arbitration

New rule: **a bound shortcut always beats ticker search.**

`ChartWidget.handleChartKeyDown` consults `matchShortcut(e)` first and returns
early if the key is spoken for, letting the event continue to the chart's own
handler. Only unclaimed keys reach `TICKER_KEY_RE` and open the search box.
`TICKER_KEY_RE` additionally narrows to `/^[A-Za-z.]$/` — no US ticker begins
with a digit, so digits should never open the box regardless of whether they are
currently bound.

Once the search input has focus, every character types into it (digits included)
until `Esc` or `Enter` — unchanged, and guaranteed by the existing early-return
on `INPUT`/`TEXTAREA`/`contentEditable` targets.

This also fixes a latent bug: `Shift+H` currently opens the search box with "H"
*and* is meant to toggle Heikin Ashi. Under the new rule the toggle wins and the
search box stays closed. The same protection applies automatically to whatever
drawing-tool bindings are chosen in the follow-up work.

`Shift+F` (flag current ticker) keeps its existing dedicated branch ahead of both
checks — it is deliberately handled before the shortcut table and stops
propagation so it cannot also fire the theme widget's `Shift+F`.

## Code changes

**`app/src/components/chart/keyboardShortcuts.js`**
- Export `TF_ORDER` — the eight-rung ladder, the single source of truth for both
  cycling and the `ChartWidget` timeframe bar.
- Export `resolveTfCycle({command, currentTf, lastCommand, lastIndex})` → a pure
  function returning `{tf, index}`. All ladder logic lives here.
- `matchShortcut()`: add `Shift`+`e.code` digit handling for the intraday set;
  map bare `1`/`5`/`9` to Daily/Weekly/Monthly; delete the `d`/`w`/`m` letter
  cases and the old `1`–`5` intraday map.
- Update the `SHORTCUTS` table (which drives the help overlay) to match.

**`app/src/components/StockChart.jsx`**
- Add a `tfCycleRef` (`{command, index}`); the `tf:` branch of the keydown
  handler delegates to `resolveTfCycle()` and calls `onTfChange()` with the
  result.
- No change to `hotkeysActive` gating or listener registration.

**`app/src/pages/charts/widgets/ChartWidget.jsx`**
- `handleChartKeyDown`: add the `matchShortcut(e)` early-return after the
  existing `Shift+F` branch and before `TICKER_KEY_RE`.
- Narrow `TICKER_KEY_RE` to `/^[A-Za-z.]$/`.
- Derive the local `TFS` bar from `TF_ORDER` instead of redeclaring the ladder.

**`app/src/components/chart/KeyboardHelpOverlay.jsx`**
- Regenerates from the updated `SHORTCUTS` table automatically. Add one line to
  the timeframe group explaining repeat-to-cycle.

## Testing

- **`resolveTfCycle` unit tests** (pure, no DOM): every key's home; repeat
  advances; repeat from home advances; wrap at Monthly; a different key resets to
  its own home; an externally-changed timeframe resets the chain.
- **`matchShortcut` tests**: `Shift`+each intraday `code` (including `Numpad`
  variants); bare `1`/`5`/`9`; `d`/`w`/`m` now return `null`; existing toggle,
  replay and help assertions unchanged.
- **`ChartWidget` test**: a digit keydown does not call `openWith`; a letter
  keydown still does; a bound shortcut key does not call `openWith`.
- **Manual smoke test in the real app** (jsdom cannot express focus ownership,
  and does not run the real bundle): the full key map, a nine-press walk around
  the ladder, ticker typing for `DELL`/`WMT`, and a two-widget workspace
  confirming a keypress retimes only the focused chart and each chart keeps its
  own cycle position. Automated browser coverage is not warranted here because
  the ownership gate (`hotkeysActive`) is pre-existing code this work does not
  touch; the new logic is entirely in the pure `resolveTfCycle` unit tests.

## Out of scope

Drawing tools, display toggles, indicator toggles and replay controls keep their
current bindings and will be revisited separately. A UCT Intelligence platform
walkthrough in Settings (which would surface a shortcut legend among other
things) is deferred to its own targeted project.
