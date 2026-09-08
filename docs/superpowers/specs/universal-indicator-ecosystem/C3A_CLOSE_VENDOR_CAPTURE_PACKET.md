# ✅ EXECUTED 2026-09-07 — THE OWNER DID NOT HAVE TO DO ANY OF THIS

**Superseded by the observation it asked for:**
`tests/fixtures/vendor/visual/marker-semantics-spy-1d-2026-09-07.json`, with
`app/src/components/chart/builder/vendorMarkerParity.test.js` as its rail.
Kept because the reasoning below is still the reasoning, and because two things
about it turned out to be wrong in ways worth recording.

**What changed:** the owner moved the boundary — *"do not ask the owner to
perform the technical capture manually … stop at the login boundary and request
only the authentication action."* The session was already authenticated, so the
login boundary was never reached, and browser automation did the script setup,
the symbol/timeframe setup, the data capture, the comparison and the cleanup.

⚰️ **THE HAND-CAPTURE THIS PACKET DESIGNED WOULD HAVE BEEN WEAKER THAN WHAT WAS
TAKEN.** It asks for nine typed rows read off the Data Window. What was actually
read is **fifty bars** straight out of TradingView's own chart model, including a
per-bar value for every marker plot — because a `plotshape` in TradingView
carries `1` on the bars it draws and `0` elsewhere. "Did the glyph land on the
right bar" was never a question about a picture; it is an array, and the vendor
will hand it to you. Nine hand-typed rows would also have carried transcription
risk that the model read does not.

⚰️ **AND STEP 1's SCRIPT HAD A BUG THAT WOULD HAVE WASTED THE CAPTURE.** This
line:

```
plotshape(up, title = "ABS", style = shape.circle, location = location.absolute, color = color.orange)
```

`location.absolute` plots the shape **at the series' own value**, and `up` is a
boolean — so the circle would have been drawn at y = 1 on a chart trading near
770, off-screen, and it would have wrecked the price scale on the way. Step 4
then asks *"is the orange circle at the MA/price value?"*, a question the script
as written makes unanswerable. The executed probe used
`plotshape(up ? ma : na, …)`, which is what the question was actually about.

⭐ The executed probe also added three things this packet did not think to ask
for, each of which earned its place: two `display.data_window` flag plots (so the
event bar is a NUMBER on both sides), and a `plotshape` whose colour is a
per-bar ternary — which is how discrimination C got a vendor answer at all.
TradingView compiles it into a separate `colorer` plot carrying one palette index
per bar, and that structural fact is the answer.

---

# C3A-CLOSE — Owner Vendor Capture Packet: EVENT-MARKER SEMANTICS

**Time: ~15 minutes.** One paste, one symbol, one timeframe, one table of
numbers.

**Why you and not me.** This repo's standing vendor boundary (`VENDOR_CAPTURE_
PLAN.md`, restated in every packet): *I do not request, enter, or store
TradingView credentials; I do not create an account; I do not touch
subscription/account settings; I do not purchase anything. When login is
required I stop and the owner performs it manually.* Putting an arbitrary Pine
script on a chart with a chosen symbol and timeframe requires a session, so the
capture is yours. Everything after it is mine.

---

## ⛔ WHY A SCREENSHOT OF THE SCRIPT'S PUBLIC PREVIEW WILL NOT DO

I checked. A public TradingView script page — e.g.
`tradingview.com/script/CwRbjtih-…` — does serve a rendered chart preview
(`s3.tradingview.com/c/CwRbjtih_mid.webp`). I did not use it, and the reason is
this directory's own rule:

> **"An observation carries the vendor's own bars. THIS IS NOT OPTIONAL."**
> — `tests/fixtures/vendor/README.md`
>
> *"If we compute against our bars and compare to their plotted number, a delta
> has two possible causes — our maths differs, or our data differs — and the
> harness cannot tell you which. That is an unattributable measurement."*

A marketing preview is rendered on an unknown symbol over an unknown window. It
cannot discriminate a **correct event bar from an off-by-one**, which is the
first thing C3A-CLOSE asks for. Eyeballing one would be exactly the
"screenshot-only similarity claim" the authorization rules out, and
`A PLAUSIBLE NUMBER IS WORSE THAN NO NUMBER` applies to pictures too.

So: real bars, or no claim.

---

## Step 1 — the script

New chart → **SPY**, **Daily**. Pine Editor → paste **exactly** this, save,
"Add to chart".

```
//@version=5
indicator("UCT marker parity probe", overlay = true)
ma = ta.sma(close, 20)
up = ta.crossover(close, ma)
dn = ta.crossunder(close, ma)
plot(ma, title = "MA20", color = color.blue)
plotshape(up, title = "UP",  style = shape.triangleup,   location = location.belowbar, color = color.green,  text = "U", size = size.small)
plotshape(dn, title = "DN",  style = shape.triangledown, location = location.abovebar, color = color.red,    text = "D", size = size.small)
plotshape(up, title = "ABS", style = shape.circle,       location = location.absolute, color = color.orange)
plotchar(up, title = "CH",   char = "★",                 location = location.abovebar, color = color.purple)
```

⚠️ **Paste it as one block.** A previous packet was defeated by the editor's
auto-indent turning continuation lines into a staircase Pine then rejected;
every line above is complete on its own, so that cannot happen here.

## Step 2 — pick the window

Zoom so roughly **the last 6 months of daily bars** are visible. Find the
**three most recent bars carrying a green "U" triangle**. Those are the rows I
need.

## Step 3 — the numbers (this is the whole capture)

For **each of those three bars**, and for **the bar immediately before and
immediately after each** (nine rows total), open the **Data Window** (not the
tooltip — it shows more decimals) and record:

| date | open | high | low | close | MA20 | U? | D? | orange circle? | ★? |
|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | |

**Record every digit TradingView shows. Do not round.**

⭐ **The neighbours are the point.** They are what makes this able to detect an
off-by-one: if our engine marks the bar before or after yours, the tables
disagree in a way no picture could show.

## Step 4 — four visual facts, in words

Looking at one "U" bar:

1. Is the green triangle **below** the bar and the red "D" triangle **above**?
2. Is the orange circle at the **MA/price value** rather than above or below?
3. Is the purple ★ **above** the bar?
4. Do the "U" and "D" glyphs carry their letters, and are they visibly
   **smaller** than default (that is `size.small`)?

## Step 5 — send it back

Paste the table and the four answers into the chat. A photo of the Data Window
is fine as a supplement but the **typed numbers are the observation**.

---

## What I do with it

1. Run our engine on **your** OHLCV rows — so any difference is a semantics
   difference, never a data difference.
2. Assert our markers land on the same dates, with the same above/below/at
   placement, colour, text and size.
3. Record it as a real observation under `tests/fixtures/vendor/`, with
   `provenance.who/when/platform` filled — the first vendor observation of
   **visual** semantics this repo will hold.
4. Close C3A-CLOSE gate item 2, or report the divergence if there is one.

**A delta here is a FINDING, not a failure.** If our marker sits one bar off
yours, that is the single most valuable output this capture can produce, and it
is precisely why the neighbours are in the table.
