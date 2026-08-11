# Indicator / formula builder — UX bug sweep, 2026-08-10

Driven through the **production** UI as a member (Charts → chart widget → Indicators),
not from source. Every item below was reproduced on screen. Ordered by how much it
costs a member.

⚠️ **Two things I initially called bugs and then disproved by checking** — recorded so
nobody re-files them:
- *"MY FORMULAS section is missing."* It exists, at the **bottom** of the Indicators
  list, below every built-in. It is a discoverability problem (B4), not a missing feature.
- *"A saved formula cannot be removed."* It can — clicking its row in the Indicators
  dialog toggles it off. The real defect is the missing on-chart affordance (B2).

---

## 🔴 B1 — Keystrokes leak THROUGH the open modal into the chart's type-to-search

**Repro:** open Indicators → New formula. Click anywhere in the dialog that is not a
text input. Type. The chart's SymbolSearch opens underneath the dialog and captures the
text — observed with `SMA(CLOSE,` sitting in the ticker box while the New-formula dialog
was still fully rendered on top of it.

**Why it matters:** the builder is a text-heavy surface. A stray click (a mis-hit on a
tab, a click on a label) silently re-points every subsequent keystroke at the chart. The
member is typing a formula into a ticker box and cannot see it happen.

**Where to look:** `StockChart.jsx` binds a window-level keydown for click-to-focus /
type-to-search. It ignores events bubbling from inputs, but the New-formula dialog is a
portal — its non-input regions are not inputs, so the handler still fires. The guard has
to be "is a modal open", not "did this come from an input".

## 🔴 B2 — A user formula on the chart has NO legend and NO pane controls

**Repro:** save any formula → it draws a pane. Compare with RSI.

Measured off the live DOM:

| | legend entry | Hide | Settings | Remove |
|---|---|---|---|---|
| RSI(14) | ✅ `RSI(14) 33.0` | ✅ | ✅ | ✅ |
| `26wk HV` (mine) | ❌ | ❌ | ❌ | ❌ |

The string `26wk HV` appears **nowhere** in the page text while its pane is on screen.
The member sees an unnamed pane with an unexplained line and no way to act on it from
the chart; the only way back is Indicators → scroll to the bottom → click the row.

**Extra sting:** a boolean scan plots 0/1. On TIP it is 0 on every bar, so the pane is a
flat line at zero with **no label** — indistinguishable from "broken". A legend naming it
is what tells "correctly 0" apart from "did not compute".

## 🔴 B3 — Escape discards the whole builder with no confirmation

**Repro:** open New formula, type a long formula, press Escape → dialog closes, all
input gone. No "discard?" prompt.

Escape is the reflex for dismissing an autocomplete or a stray dropdown. Here it costs
the member everything they typed. Worse in combination with B1: the stray dropdown that
makes you reach for Escape is the one B1 opened.

## 🟠 B4 — MY FORMULAS is last in the Indicators list

Your own saved formulas sit **below** MOMENTUM, VOLATILITY, VOLUME and TREND — roughly a
full dialog-height of scrolling. Searching surfaces them instantly, so the data is fine;
the ordering is the problem. A member's own work should be the first section, not the
last.

## 🟠 B5 — Save is disabled with no stated reason

A completely valid formula with an empty Name leaves Save greyed and says nothing.
Nothing marks Name as required and nothing points at it. The fix is one line of helper
text on the disabled state ("Name it to save").

## 🟠 B6 — The dialog's action row is clipped at the bottom edge

On a fresh New-formula dialog at 1568×726, Cancel/Save are already cut by the dialog
edge. After a save, the "✓ Saved — version 1, rev 1" line is inserted **above** the
buttons and pushes them further out. The dialog does not grow or scroll to keep its own
primary action reachable.

## 🟠 B7 — The dialog stays open after a successful save

Save reports "✓ Saved — version 1, rev 1" and stays put, with Save still enabled. There
is no signal that the job is done and nothing stops a second click writing rev 2.

## 🟡 B8 — Chart pane renders LIGHT on a dark app, and its toolbar is illegible

The chart canvas is a pale blue→cream gradient while the whole application is dark. On
that background the chart toolbar (share, alerts, ⓘ, **Indicators**) is pale-grey-on-pale
and effectively unreadable — I could not find the Indicators button by eye and had to
resolve it from the accessibility tree.

## 🟡 B9 — On-chart legend overlaps the candles

`EMA 9 / EMA 20 / SMA 50 / SMA 200 / RSI(14)` are drawn with no backing plate below the
OHLC block, so candles run straight through the values. Several readings are unreadable
wherever price crosses them.

## 🟡 B10 — Pine leaves a bare `&& 1` in the translated formula

`plot(sig and barstate.isconfirmed ? 1 : 0)` translates to
`rsi(close, 14) < 35 && close > sma(close, 200) && 1 ? 1 : 0`.

Correct — `barstate.isconfirmed` IS the constant 1 in a closed-bar engine (shipped
2026-08-10) — but the member sees an unexplained `&& 1`, and the English read-back says
"…and 1) is not zero". Constant-fold `x && 1` → `x` in the translation output.

## 🟡 B11 — The Conditions builder's default row can never be true

"+ Add condition" seeds `open > high`. Open can never exceed high, so the first thing a
member sees is a condition that matches nothing. Seed something ordinary — `close > open`.

## 🟡 B12 — A member's own formula is badged "Premium"

`26wk HV` carries a gold **Premium** badge beside "Your formula" in the Indicators list.
Whatever it means for entitlements, on the thing the member just wrote themselves it
reads as "you cannot use this".

---

## What works well (so the fixes do not break it)

- **TC2000 paste is excellent.** `v>=maxv130 and v>250000 and c/c1>0 and Capitalization > 200 and c>c1`
  is recognised — "Read as TC2000 PCF" — with a full English read-back, node/lookback/series
  counts, and a non-repainting verdict.
- **Pine import works**, names the columns it found, and discloses "Show 1 line a screen
  does not read" rather than hiding what it dropped.
- **The Conditions builder** live-generates the formula and its read-back as you edit.
- **Save/versioning** works and reports `version 1, rev 1`.
- **`Capitalization` shows its unit conversion** in the read-back — "(the market
  capitalisation divided by 1000000)" — which is exactly what stops a silent 1,000,000×
  threshold bug.
