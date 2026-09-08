# Independent adversarial validation — and what I did about it

**Deliverable I.** An independent reviewer was given the corpus, read-only, with explicit
authority to downgrade or overturn any finding, and was told that *"a reviewer who finds
nothing has not reviewed."*

> ## VERDICT RETURNED: **MATERIALLY FLAWED**
>
> *"The census arithmetic is clean — I could not break a single stated count in
> `20-census-freeze-v1.md` against the JSONL. What breaks is everything downstream of it:
> the UCT half of the comparison."*

**I re-checked every load-bearing claim against `origin/master` myself, and the reviewer was
right on all of them.** The corrections are folded into `70-*`, `80-*`, `13-*` and
`ledger/PARITY_COMPARISONS_V2.jsonl`; this document is the adjudication record, including the
places where I do **not** accept the reviewer's framing in full.

---

## 1. ACCEPTED AND FIXED — findings I verified in source

### 1.1 `$ Vol` / `Avg 50D` were never on a phone
```css
/* StockChart.module.css:774-797 */
/* The $-Vol strip and the A/L/% scale chips are desktop furniture — on a
   393px canvas they cover candles to answer questions the settings sheet
   already answers. */
@media (pointer: coarse) and (max-width: 640px) { … .volLegend, … .scaleToggle { display:none } }
```
Verified. The device capture in `UCT-CHART-0008` contains neither string — the row asserted a
✅ its own evidence contradicts. **Withdrawn** from `CMP-020`, F05 and register row 7.
⭐ And the direction reverses: **UCT deliberately strips desktop furniture off the phone
canvas**, and this study logged that decision as a defect twice.

### 1.2 The 17×11px price-scale tap targets do not render on a phone
Same rule, same file. `CMP-084` went **BROKEN/HIGH → PARITY/NORMAL**; the register's
one-handed-controls caveat is withdrawn; the "9 controls below 44px" figure is wrong (the
chart shell has one, a 40×40 Help button). The watchlist sort headers remain real (`CMP-013`).

### 1.3 The crosshair legend is gated on a USER SETTING, not on a pointer branch — *and this
is a better finding than the one it corrects*
```js
// StockChart.jsx:14983 — no pointer clause anywhere
{crosshairData && !hideLegend && legendMode !== 'off' && (legendMode !== 'hold' || legendHeld) && …
```
`chart/legendMode.js` says its legacy fallback `header.showLegend` *"sits in every stored blob
in production"*. So the production account resolved the legend off and the fresh sandbox admin
resolved the `always` default. **The earlier pass and the device pass differed in four
variables — pointer type, host (prod → sandbox), build, and account — and I attributed the
difference to one.** New row `CMP-086`: **a real member's phone may show no OHLC readout at
all**, with the control buried in chart settings. Nobody had recorded that.

### 1.4 The drawing-bar counts were wrong in both halves
`MobileDrawBar.DRAW_TOOLS` holds **18** entries (verified by enumeration), plus a pinned
eraser. And `UCT-DRAW-0007`'s own capture — *"Done | Trend | Horizontal | H R | Eraser"* —
shows **three** scrollable tools, not five. "~5 of 20" → **"3 of 18"**. The top surviving UI
gap is *worse* than stated.

### 1.5 TradingView's bar-replay paper trading was never exercised
`TV-IOS-REPLAY-0008` is `steps:0`, `gesture:system`, and its own notes read *"NOT EXERCISED —
no buy or sell was pressed."* Downgraded to *"a Sell/qty/Buy/Flatten strip renders during
replay and changes enabled-state."*

### 1.6 TradingView's object→alert rows are presence-only, and the timing comparison mixed orientations
`TV-IOS-DRAW-0043` and `TV-IOS-ALERT-0024` are both `NATIVE-VERIFIED (presence)` with the
action *"observe the first item of the menu"* — the alert was never activated from a drawing
or an indicator. The one committed TV alert was a **landscape** measurement compared against a
UCT **portrait** measurement. `CMP-054`'s TV tier downgraded; `CMP-055`'s UCT tier annotated as
fine-pointer-only and never device-reproduced.

### 1.7 `autoCapitalize="characters"` IS set — the census's "free win" is a phantom
`MobileSymbolSheet.jsx:108`. Verified. `TV-IOS-SYMBOL-0054`'s note is a **second** code-derived
UCT falsehood inside a `NATIVE_VERIFIED` census row; the existing ERRATUM caught only the first.
Recorded in `95-census-errata.md` — the frozen ledger is not edited, by design.

### 1.8 The `conf` field cannot distinguish the two UCT tiers
Every fine-pointer UCT row carries `conf: NATIVE_VERIFIED` — the same enum as real-iPhone rows.
The split lived only in prose. **This is the mechanism behind every tier-laundering item
above**, and it is a genuine schema defect in my own lanes. Fixed going forward: the comparison
ledger carries a separate `uct_tier` field, which is what `80-*` counts.

---

## 2. ACCEPTED WITH A NARROWER SCOPE

### 2.1 "Both overturns were fine-pointer artifacts" — the *mechanism* was wrong, the *label* is half right
The reviewer is right that neither behaviour has a `(pointer: coarse)` branch. But the bare-chart
long-press handler reads:
```js
// StockChart.jsx:13508
if (e.pointerType === 'mouse') return   // mouse uses native contextmenu
```
That is a property of the **input event**, and a desktop browser at 390px does deliver
`pointerType: 'mouse'`. So "the emulated pointer produced a false negative" is *accurate about
the input* and **wrong as stated** ("a degraded responsive branch"). The reviewer's decisive
point stands regardless: **`onContextMenu` opens the identical menu in the same frame, and I
never tried a right-click** — a five-second check that would have caught it without a device.

**The corrected lesson, which is stronger than the original:** *emulation differs from a device
in more ways than pointer type, and I attributed a four-variable difference to one.* The
crosshair half (1.3) has no pointer explanation at all.

### 2.2 The `ACCESS_BLOCKED` label is right; its stated reasoning was wrong
The reviewer accepts the label for the four downstream checks and demolishes the *prohibition
note* attached to it. Verified: placement is React `onPointerDown` on the overlay canvas reading
only `pointerType`, `pointerId`, `clientX/Y`, `button` — **no touch identifier, no pressure, no
`touchstart`/`touchend`**, so my speculated cause is ruled out by source. And my supporting
symmetry ("chart long-press works on the same canvas") is wrong: with no tool armed the overlay
canvas is `pointerEvents:'none'` and a different element handles the press. The reviewer even
supplies an untested candidate cause — the `activePointersRef` multi-pointer guard, drained only
by a `pointerup` that reaches the canvas.

`UCT-COARSE-0005` is rewritten to the honest record: **synthetic taps delivered by the harness
to a real iPhone did not place a drawing with a tool armed; the cause was NOT isolated between
harness synthesis and UCT's own pointer accounting.**

### 2.3 Stale P9 claims survive in `13-*`, `20-*`, `06-*`
Correct, and partly a sequencing artifact: `60-p9-workspace-architecture.md` and
`UCT-P9-DOCDRIFT` state the corrected position, and `30-*` received its supersession banner
while the review was running. `13-*`, `20-*` and `06-*` now carry forward pointers. ⚠️ The
reviewer's own summary of the corrected position is right and is worth repeating: **P9 demotes
from "the one large architectural item left" to "the model exists and is server-backed; only
the phone door is missing."**

### 2.4 The census's `NATIVE_VERIFIED` tier is thinner than the word implies
Verified by the reviewer's recount: 74 of 137 native rows have an action verb of
*Observe/Read/Note*; 31 are self-labelled `(presence)`; and the gesture mix is
`tap 88 · system 41 · typing 2 · long_press 2 · rotate 2 · drag 1 · swipe_v 1` — **6 of 137
native rows exercise a non-tap gesture.** That does not invalidate the census (a menu item
observed *is* evidence the menu item exists) but it does mean **"NATIVE_VERIFIED" often means
"seen", not "done"**, and the certification says so.

---

## 3. NOT ACCEPTED IN FULL — two places I disagree

### 3.1 "434 = 432 TV rows + 2 UCT rows, so the per-area percentages are wrong"
**Accepted as an arithmetic point, rejected as a framing.** The reviewer is right that
`UCT-TYPE-0001` and `UCT-REPLAY-0001` carry the census stamp and sit in the TYPE and REPLAY
denominators, and the recomputed figures (TYPE 38.5% vs 35.7%, REPLAY 66.7% vs 63.2%) are
correct. But the freeze document's headline — *"434 rows in the frozen census"* — is a true
statement about the file, and the frozen file must not be edited; that is the entire point of
freezing it. The right remedy is an erratum, not a restatement, and the corrected per-area
figures are recorded in `95-census-errata.md`. ⚠️ The reviewer's *substantive* catch inside this
item **is** accepted: `UCT-REPLAY-0001`'s result — *"UCT HAS NO BAR REPLAY ON ANY PLATFORM"* —
is a universal negative resting on three greps, and it is **false** (`ChartToolbar.jsx` ships
replay). That is now `CMP-079`'s `DESKTOP_ONLY`.

### 3.2 "The study's UCT half was *mostly asserted*"
**Rejected as stated, accepted in part.** It is fair for the *census-embedded* UCT claims — those
were code reads wearing a native tier, and at least three of them were wrong. It is not fair for
the UCT lanes as a whole: `UCT-P9-0001` was established by changing state on a phone shell and
reading it back on a desktop board *and* in the server record; `UCT-CHART-0007`, `UCT-CHART-0008`,
`UCT-DRAW-0007` and `UCT-NAV-0005` were captured on a physical iPhone; `UCT-P9-0005`'s divergence
was observed live. **The correct statement is narrower and still damning: the UCT claims that
were wrong were, without exception, the ones derived from source or from an emulated pointer
and then written at a tier they had not earned.**

---

## 4. What the review changed, in one table

| | before review | after |
|---|---|---|
| comparable interactions | 85 | **86** (`CMP-086` added) |
| UCT_AHEAD (high-value) | 7 | 7 (`CMP-020` retained, scope narrowed) |
| BROKEN (high-value) | 3 | **2** (`CMP-084` withdrawn) |
| PARTIAL (high-value) | 2 | **3** (`CMP-086` added) |
| largest root cause C1 | 9 rows / 4 HIGH | **8 rows / 3 HIGH** |
| P9 cluster C3 | 5 rows / 1 HIGH | **6 rows / 2 HIGH** |
| false negatives attributed to the fine-pointer lane | 3 | **5** |
| drawing tools: visible / total | ~5 / 20 | **3 / 18** |
| new defects found *by the review* | — | **2** (`CMP-086`; the phantom `autoCapitalize` item) |

**No UCT gap was invented by this review, and two were deleted.** The net direction is the same
as every other correction in this study: **UCT is in better shape than the measurement said, and
the measurement was worse than it claimed.**

---

## 5. The reviewer's closing paragraph, and my answer

> *"The TradingView half was measured and the UCT half was mostly asserted, and the corpus has
> no mechanism that can tell the difference — because `conf` describes the row's TradingView
> observation while the `notes` field silently carries a UCT verdict at the same tier."*

**The mechanism criticism is correct and is the most valuable thing in the review.** One enum
field was made to carry two different products' evidence tiers, and the consequence was exactly
what the criticism predicts: UCT verdicts inherited TradingView's tier. The comparison ledger
built for deliverable B already separates `tv_tier` from `uct_tier`, which is why the corrected
distribution could be recomputed rather than re-argued — but that separation arrived at the end
of the study rather than the beginning.

**This is why the certification below is not FULL.**
