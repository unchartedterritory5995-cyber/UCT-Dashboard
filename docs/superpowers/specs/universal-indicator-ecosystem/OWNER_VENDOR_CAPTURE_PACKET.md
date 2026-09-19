# Owner Vendor Capture Packet — TradingView Tranche 1

**Read this alone — nothing else to open.** Total time: **~20-30 minutes**, one
login, one chart, two scripts, eight small reads. Do the steps in order; each
one builds on the chart/script the previous one opened, so following the order
is what keeps this short.

When you're done, send back: the raw numbers/screenshots listed in each step's
"send back" line. That's it — I do all the encoding and comparison afterward.

---

## Before you start

- **Platform:** TradingView, web, tradingview.com — no app needed.
- **Log in** with your own account, your own way. I never see or ask for your
  password.
- Go to any chart. Search the symbol box for **AAPL** and set the timeframe to
  **1D** (Daily) — the button row above the chart, or press `D` twice.

---

## Part 1 — open the Pine Editor, paste Script A, read 2 values

1. At the **bottom of the chart**, click **"Pine Editor"** (a tab in the bottom
   panel, next to "Stock Screener" etc.). If you don't see it, click the small
   `</>` icon in the bottom toolbar.
2. Click **"Open"** → **"New blank indicator"** (or just clear whatever's in
   the editor).
3. Paste this exactly, no edits:

```pine
//@version=5
indicator("uct-oracle-smoother-v1", overlay=false)
raw  = bar_index == 20 ? na : (10.0 + bar_index)
ema5 = ta.ema(raw, 5)
rma5 = ta.rma(raw, 5)
sma5 = ta.sma(raw, 5)
plot(raw,  "raw")
plot(ema5, "ema5")
plot(rma5, "rma5")
plot(sma5, "sma5")
```

4. Click **"Add to Chart"** (top-right of the Pine Editor). A new small pane
   appears below the price chart with 4 lines.
5. Open the **Data Window**: click the small icon that looks like a bar chart
   / table on the **right-hand toolbar** of the chart (hover the icons if
   unsure — tooltip says "Data Window"). A panel opens showing exact values
   for whatever bar your mouse/crosshair is over.
6. **Scroll the chart all the way to the left** (click on the chart, then
   press `Home`, or drag-scroll left) until you can see the very first bars of
   AAPL's history in this script's pane.
7. Move your mouse (crosshair) to the bar at position **5** (the 5th visible
   bar from the very first one — you can also just count "bar_index 4" if
   TradingView shows it, but simplest is: 5th bar from the start). Read the
   Data Window values for **raw, ema5, rma5, sma5**.
   - **Send back:** those 4 numbers, and ideally a screenshot of the Data
     Window panel at that bar.
8. Now move the crosshair one bar at a time across bars **20 through 25**
   (still near the start of the chart). For each of those 6 bars, read
   **ema5** and **rma5** from the Data Window — you're just checking whether
   they show a number or show blank/empty at each bar.
   - **Send back:** for bars 20, 21, 22, 23, 24, 25 — just say, for each one,
     whether ema5/rma5 showed a NUMBER or were BLANK. (A screenshot scrolling
     across those bars works too, if that's easier than 6 separate notes.)

**Time: ~10 minutes** (mostly getting used to the crosshair/Data Window).

---

## Part 2 — replace with Script B, read 8 more values

1. Go back to the **Pine Editor** tab (still open at the bottom).
2. **Select all the text and delete it**, then paste this exactly:

```pine
//@version=5
indicator("uct-oracle-realdata-v1", overlay=false)
atr14                        = ta.atr(14)
tr1                          = ta.tr(true)
rsi14                        = ta.rsi(close, 14)
stochK14                     = ta.stoch(close, high, low, 14)
[aroonUp14, aroonDown14]     = ta.aroon(14)
hma55                        = ta.hma(close, 55)
modSign                      = (close - open) % 3
plot(atr14, "atr14")
plot(tr1, "tr1")
plot(rsi14, "rsi14")
plot(stochK14, "stochK14")
plot(aroonUp14, "aroonUp14")
plot(aroonDown14, "aroonDown14")
plot(hma55, "hma55")
plot(modSign, "modSign")
```

3. Click **"Add to Chart"** again. (You can remove Script A from the chart
   first if the panes get crowded — click the "✕" next to its name in the
   top-left legend of its pane — but you don't have to.)

4. **Scroll to the very start of the chart's history again** (same `Home` /
   drag-left move as before). Find the **very first bar where `atr14` shows a
   number** (moving right bar-by-bar from the start, it'll be blank for a
   while, then suddenly show a value).
   - **Send back:** which bar (date) that is, and the `tr1` value on that
     SAME bar and on the bar immediately before it (2 numbers total).

5. **Scroll to the most recent ~30 bars** (the right edge of the chart, or
   anywhere comfortably in the middle of the loaded history — just not the
   very first few bars). Pick any ONE bar there and read, all from the Data
   Window at that single bar: **atr14, rsi14, stochK14, aroonUp14,
   aroonDown14, hma55**.
   - **Send back:** the date of the bar you picked, and those 6 numbers.

6. Look at the candles near that same area and find a **red day** (a bar
   where the candle body is red — close below open). Move the crosshair there
   and read **modSign**.
   - **Send back:** the date of that red bar, and the `modSign` value.

7. **Export the underlying price data** (this saves you re-reading dozens of
   individual bars by hand): look for a small **camera/download icon** or
   right-click the chart → **"Export chart data..."**. If that option exists
   and is not asking you to pay for anything, export the last ~100 daily bars
   as CSV and send that file. **If you don't see this option at all (some
   accounts don't have it), skip it** — say so, and I'll ask you to
   individually read back ~15-20 more OHLC values by hand instead. Try this
   step first; it saves a lot of typing either way.
   - **Send back:** the CSV file, OR "no export option available."

**Time: ~10-15 minutes.**

---

## What NOT to do

- Don't click "Publish Script" or "Save" to your public profile — just "Add
  to Chart" is enough, nothing needs to be saved anywhere permanent.
- Don't buy or upgrade anything, even if TradingView suggests a paid feature
  along the way (e.g. for the CSV export) — just skip that step if it's
  gated and tell me.
- Don't worry about getting a value "wrong" — send back exactly what the
  screen shows, decimals and all. A mis-read is easy to catch and re-ask; a
  rounded or "close enough" number is not.

## What you're sending back, all together

A single message/file with: Part 1's 4 numbers + the 6 blank/number notes,
Part 2's first-ATR-bar date + 2 numbers, the 6-value read + its date, the
modSign value + its date, and the CSV (or "not available"). Screenshots of
the Data Window at each read are welcome and often faster than typing numbers
by hand — send those instead of transcribing if that's easier for you.
