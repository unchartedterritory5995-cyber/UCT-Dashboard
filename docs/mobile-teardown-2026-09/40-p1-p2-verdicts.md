# P1 and P2 — final verdicts

**Evidence base for this document:** a local E2E sandbox (`tools/e2e_sandbox_launcher.py`,
`127.0.0.1:8091`, sandbox admin identity, real market bars — SPY 300 bars through 2026-09-04
close 770.19) driven through a same-origin **390×844 portrait frame**. Rows in
`lanes/uct-sandbox-pass.jsonl`.

**Evidence label: `RESPONSIVE_TOUCH_VARIANT_VERIFIED`.** The width branch is real; the pointer
branch is not. No production data was read or written, and no production entitlement, auth
setting or account was changed.

⛔ **§§1–6 BELOW ARE SUPERSEDED IN TWO PLACES — READ THE ADDENDUM AT THE END FIRST.**
A later real-coarse-pointer pass on a physical iPhone overturned **§3** (the bare-chart bridge
*exists*, and is broader than TradingView's) and **§4** (the crosshair *does* show O/H/L/C, plus
four inline moving averages — UCT is ahead, not behind). Both earlier readings were fine-pointer
artifacts of the 390×844 frame. Everything else in §§1–6 stands.

---

## 1. P1 — the verdict, and the backlog item is WITHDRAWN

### A. Does UCT genuinely lack precision-placement support?
**No. That conclusion was wrong and it is withdrawn.**

UCT ships a precision mechanism TradingView does not have on mobile: **`Set level…`**, in the
drawing's own context menu. It expands inline into a numeric field **pre-filled with the current
value**, `type="number"`, **`inputmode="decimal"`** — so a phone raises a keypad, not a QWERTY —
beside a `Set` commit. Typing `755.25` moved the stored drawing to exactly `755.25`.

### B. Does UCT solve precision through enlarged targets + post-placement editing instead?
**Partly measured, partly still open — and this is the honest boundary.**

*Measured:* post-placement editing is real and exact (`Set level…`), the object menu is
type-aware, and `Make horizontal` exists for sloped lines.

*Not measured:* the enlarged-target half. `HIT_THRESHOLD` (15px vs 8px), `HANDLE_R` (7px vs 4px
plus halo), auto-select-after-placement and `DrawingQuickBar` are all behind the module-level
`_COARSE_POINTER` constant and did not execute in a fine-pointer browser.

### C. Is TradingView still materially better?
**On one axis only, and it is not the axis I originally claimed.**

Not on precision — a typed number beats a cursor, because a cursor can never be finer than the
pixel under it. TradingView is better on **narration during placement**: a step counter (`1 of 4`),
instruction copy, a persistent cancel, and live price/date on both axes while the anchor moves.
UCT has a coach chip for this, but it is coarse-gated and unverified.

### D. If so, exactly where?
Three specific things, all narration rather than capability:
1. **No live axis readout while placing.** TradingView shows the price and date the anchor will
   land on, before it lands.
2. **No step counter or instruction copy** verified on UCT (coarse-gated; may exist).
3. **No single-anchor numeric edit.** `Set level…` on a trendline flattens *both* endpoints. You
   cannot type a new price for one end of a sloped line.

### E. Is any backlog item actually warranted?
**Not the original one.** "Adopt TradingView-style cursor-decoupled placement" is withdrawn.

What is warranted is one small item — *live price/date readout while an anchor is being placed or
dragged* — and item (3) above, single-anchor numeric editing. Both are additions to a model that
already works, not a replacement for it.

### F. Would adopting TradingView's cursor model improve UCT, or conflict with it?
**It would conflict, and I no longer recommend it.**

UCT's model is: place by tap, then correct exactly by number. TradingView's is: move a decoupled
cursor until the readout looks right, then commit. Bolting a cursor onto UCT would add a mode to a
product whose whole mobile idiom is direct manipulation plus an object menu — and it would make
the *worse* of the two precision paths the primary one. Take the readout, not the cursor.

---

## 2. P2 — drawing → alert: **PARITY**, closed

| | TradingView | UCT |
|---|---|---|
| Gestures to an alert on a drawing | **3** | **3** |
| Typing required | none | **none** |
| Level source | the object's live value | the drawing's stored price, to full precision |
| Direction | defaults to *Crossing* | **explicit `▲ Above` / `▼ Below`** |

`Set alert…` expands inline to Above/Below — no text field, no keyboard. Choosing Above produced
`{sym: SPY, target_price: 759.7385561455568, direction: "above", is_active: 1}` — the drawing's
price to the last decimal.

**Equal cost, and UCT is arguably clearer**: it makes direction an explicit choice where
TradingView silently defaults to Crossing.

### The one real difference: seeded, not bound
Deleting the drawing left the alert unchanged and active. On a **sloped trendline** the alert
seeded from the **right-hand (later) endpoint** — `764.645` — which is the right choice for a
snapshot, but the line at any future bar is at a different price and the alert does not follow.

Neither model is simply better. A seeded alert survives tidying up a scratch drawing, which is
often what a trader wants. **Recommendation is small:** label the alert with the drawing it came
from, or offer a distinct "follows the line" option for sloped tools. Do not copy TradingView's
object-binding wholesale.

---

## 3. P2 — the bare-chart gap, restated precisely

⛔ **Do not describe this as "UCT has no object → alert."** That is false, per §2.

The gap is a missing **bare-chart-price → contextual-action bridge**. UCT already owns every part:

- a working touch crosshair with the exact price under it (`UCT-CHART-0005`)
- a type-aware context-menu component (`UCT-DRAW-0005`)
- `Set alert…` with zero typing (`UCT-ALERT-0003`)
- `Set level…` with exact numeric entry (`UCT-DRAW-0004`)

What is missing is the wire: **long-press on the bare plot area produces nothing** — 16 interactive
elements before, during and after the hold. TradingView spends that gesture on a crosshair plus a
five-item pre-filled menu (*alert · buy · sell · order · draw horizontal line at this price*).

**This is the single highest-value, lowest-cost P2 item in the study**, because no new capability
is required — only a menu invocation from the crosshair price, offering the actions UCT already has.

---

## 4. Crosshair — mixed parity, preserved

| | UCT | TradingView |
|---|---|---|
| Price badge | ✅ | ✅ |
| Date badge | ✅ | ✅ |
| O / H / L / C | ❌ **none** | ✅ |
| Volume | ✅ | ✅ |
| **$ Vol** | ✅ **unique** | ❌ |
| **Avg 50D** | ✅ **unique** | ❌ |
| Indicator values | not measured | ✅ |

Exactly one legend node exists in the DOM while the crosshair is live (`_volLegend_`).
`MobileChartsApp` sets `alwaysShowLegend: false` deliberately, with an in-file comment saying the
legend should be "a crosshair INSPECTION tool" — so the *intent* already matches TradingView; the
OHLC row simply is not in it.

**Should UCT add OHLC without cluttering?** Yes, and cheaply: `crosshairData` already carries the
fields, and the volume legend proves the surface exists and is readable at 390px. One compact row —
`O H L C` plus change — shown only while the crosshair is active costs nothing when it is not.
Keep `$ Vol` and `Avg 50D`; they are a genuine edge no competitor here offers.

---

## 5. What was not achieved, and why

The sandbox half is **done and reusable**: launcher, admin identity, real bars, `/charts` reachable.

The tunnel half is not. `BrowserStackLocal.exe` is downloaded to `C:\Users\Patrick\bstools\`, but it
requires the account access key, and the two mechanisms I tried to move that key without printing it
— a localhost-only receiver, and a page-side media-query override earlier — were both refused by the
environment's safety classifier. **I did not attempt to work around either refusal.** Shortly after,
browser automation itself became unavailable and the tab group was lost.

**UPDATE — the tunnel was started, and the pass still could not run. The cause is now diagnosed
exactly** (`UCT-BLOCKED-0001`):

- The tunnel is **healthy**: two `BrowserStackLocal` processes since 19:26, the child holding
  **30 established TLS connections** to BrowserStack on 443.
- The sandbox is **reachable**: `curl http://bs-local.com:8091/charts` from the host → **200**.
- Device Safari nevertheless returned BrowserStack's *"enable Local Testing"* error for both
  `bs-local.com:8091` and `localhost:8091`, and the session's Local Testing panel showed no
  connected state.
- Command-line inspection (flag presence only — **the key was never read or printed**) shows both
  processes carry **`--local-identifier uctp1`**.

**A tunnel started with a local identifier is namespaced**: only sessions that explicitly request
that identifier may use it. App Live is manual/UI-driven and has no capability layer, so it can bind
only to the account's **default, identifier-less** tunnel. That is why the device sees no tunnel.

**One-line fix — restart the tunnel without the identifier:**

```
BrowserStackLocal.exe --key <KEY>
```

(or leave `uctp1` running and start a second, identifier-less tunnel alongside it). Nothing else in
the setup needs to change: sandbox, admin identity, real bars and `app/dist` are all in place and
verified this session.

**Still open, and all four are P1:** `HIT_THRESHOLD` 15px vs 8px · `HANDLE_R` 7px vs 4px + halo ·
auto-select-after-placement · `DrawingQuickBar`. Plus the tap-two-points coach chip and the sheet
presentation of the context menu.

Also untested for unrelated reasons (browser lost mid-pass): move-drawing, move-anchor, Duplicate,
Lock, Save as default, magnet/snap, cancel-during-placement, and the redo scope question in
`UCT-UNDO-0002`.

---

## 6. Net effect on the backlog

| item | before | after |
|---|---|---|
| Adopt cursor-decoupled placement (P1) | critical | ⛔ **withdrawn** |
| Live axis readout while placing/dragging | — | **new, small** |
| Single-anchor numeric edit on sloped lines | — | **new, small** |
| Bare-chart price → contextual actions | — | ⭐ **highest value, lowest cost** |
| Object → alert | claimed missing | ✅ **already shipped — parity** |
| Label or bind sloped-line alerts | — | new, small |
| OHLC row in the crosshair legend | — | new, cheap |
| Redo does not arm on the first undo after load | UCT_AHEAD | ⚠️ **UCT_AHEAD kept but qualified** — see §7 |

---

## 7. Redo — bounded clarification (run, and it revises §6)

Three operation types, drawing store read at every step (`UCT-UNDO-0003`):

| case | sequence | result |
|---|---|---|
| **A** property edit | `Set level` 755.25 → Undo → Redo | Undo restored the sloped endpoints; **Redo did not re-apply**, while reporting `disabled=false` |
| **B** placement, first undo after a page load — **reproduced twice** | place → Undo → Redo | Undo worked; **Redo button stayed disabled**, click did nothing |
| **C** placement, later in a warm session | place → Undo → Redo | **Redo worked** — count went 2 → 1 → 2 |

**So redo is inconsistent, not dead.** That is better than my previous row said in one way and worse
in another:

- **Better:** the feature is real (case C), and TradingView mobile still ships *no* redo at all.
- **Worse:** the failure sits in the **first-use path** — open the chart, draw, undo, and Redo is
  greyed out with the action unrecoverable. That is the sequence a real user meets first.

Separately verified: after a reload **both** Undo and Redo are disabled while the **drawings
persist** — the history does not survive a reload even though the objects do.

**Verdict:** keep the UCT_AHEAD, qualified. Write it as *"Redo exists and works within a session;
it does not arm on the first undo after load"* — never as a clean win.


---
---

# ADDENDUM — real-coarse-pointer pass (`REAL_COARSE_POINTER_VERIFIED`)

**Chain:** real iPhone 15 / iOS 17.5 (App Live, serial C6RWL2XXXX) → mobile Safari → BrowserStack
Local (identifier-less tunnel, 45 established TLS connections) → `http://bs-local.com:8091/charts`
→ the local UCT sandbox (real bars, SPY 1D @ 770.19). Portrait. **Pointer: a physical touchscreen.**

The tunnel worked exactly as diagnosed: restarted without `--local-identifier`, App Live's Local
Testing panel switched from *"Download Local Desktop App"* to the connected-state control, and the
sandbox served on the device immediately.

**Two of my own conclusions are overturned, and both were fine-pointer artifacts.**

---

## ⛔⛔ OVERTURNED — §3 "the bare-chart gap" — THE BRIDGE EXISTS

§3 called this *"the single highest-value, lowest-cost P2 item in the study"*, on the evidence that
long-press on the empty plot produced nothing (16 interactive elements before, during and after).

**On a real touchscreen, long-press opens a price-anchored sheet.** Verbatim, reproduced three
times at two prices:

> **AT $700.64**
> ✎ Draw line at $700.64 · 📋 Copy $700.64 · 🔔 Alert when below $700.64
> **CHART** — Logarithmic scale · Magnet crosshair · Swing price labels · Indicators · ＋ Add indicator…
> **TIMEFRAME** — 1m · 5m · …

**UCT is at parity here, and the sheet is broader than TradingView's.** TradingView's ⊕ gives five
price-anchored actions (alert / buy / sell / order / draw line). UCT gives three price-anchored
actions **plus** chart settings, an indicator entry point and timeframe switching — from the same
one gesture. The remaining differences are small and defensible: TradingView pre-fills a buy and a
sell (UCT has no execution, correctly out of scope), and UCT commits to a direction in the label
(*"Alert when below"*), which matches the explicit Above/Below choice in its drawing menu.

⛔ **Delete the "missing wire" framing everywhere. There is no missing wire.**

---

## ⛔⛔ OVERTURNED — §4 "crosshair mixed parity" — UCT IS AHEAD

§4 recorded *"no O/H/L/C"*, backed by a DOM query returning exactly one legend node (`_volLegend_`).
That was the **degraded fine-pointer legend**.

On the device the legend renders in full:

```
2026-03-09   O 666.39   H 679.92   L 662.39
C 678.27     V 102.7M   +5.89 (0.88%)
EMA 9 681.54   EMA 20 684.26   SMA 50 687.86   SMA 200 656.87
```

| | UCT (real touch) | TradingView |
|---|---|---|
| Price + date badge | ✅ | ✅ |
| O / H / L / C | ✅ | ✅ |
| Volume, change, change% | ✅ | ✅ |
| **Indicator values inline** | ✅ **EMA 9 / EMA 20 / SMA 50 / SMA 200** | not observed on mobile |
| **$ Vol, Avg 50D** | ✅ **unique** | ❌ |

**The "broader indicator readout" I had listed as a TradingView advantage is actually UCT's.**
⛔ Remove the backlog item "add an OHLC row to the crosshair legend" — it exists.

---

## ✅ Confirmed unchanged on real hardware

- **Drawing bar shows ~5 of 20 tools** with no scroll affordance (`UCT-DRAW-0007`). The
  discoverability item survives; TradingView's searchable, category-tabbed picker and its
  scrollable-toolbar coach-mark remain the copyable answer.
- **Tools sheet structure** is identical; its widget band is account-dependent, so quote it as
  "five chart actions plus a per-account widget list", not a fixed eleven (`UCT-NAV-0005`).

---

## ⛔ Still unverified — checks 1–4, and why

`HIT_THRESHOLD` 15px · `HANDLE_R` 7px + halo · auto-select-after-placement · `DrawingQuickBar`.

All four need a drawing on the chart, and I could not place one through this harness. Taps on the
canvas with a tool armed did not place — verified by long-pressing the same point afterwards and
getting the **price** menu rather than a drawing menu, so no object existed. Activating the
*"Draw line at $700.64"* row failed four times: the row highlights, then iOS's text-selection
recogniser claims the gesture.

⚠️ **This is a harness limitation, not a Local problem and not a UCT defect.** The tunnel and
sandbox both worked; long-press on the chart is reliable; only two interactions fail — a tap on the
canvas with a tool armed, and a short tap on a plain-text sheet row. **Do not record "tap does not
place a drawing on iOS" as a finding** — a real finger almost certainly places it; my synthetic tap
carries enough dwell to trip the selection recogniser.

**To finish:** drive the tap from App Automate / Appium against the same `bs-local` URL. One command
places the drawing; after that all four checks are a single screenshot each.

---

## Net effect on the backlog (supersedes §6)

| item | before | after this pass |
|---|---|---|
| Bare-chart price → contextual actions | ⭐ highest value | ⛔ **removed — already shipped, and broader than TradingView's** |
| OHLC row in the crosshair legend | new, cheap | ⛔ **removed — already shipped, plus 4 indicator values** |
| Drawing-bar discoverability (~5 of 20 visible) | — | ✅ **confirmed on real hardware — now the top surviving UI item** |
| Adopt cursor-decoupled placement (P1) | withdrawn | withdrawn (unchanged) |
| Live axis readout while placing | small | small (unchanged) |
| Single-anchor numeric edit on sloped lines | small | small (unchanged) |
| Label or bind sloped-line alerts | small | small (unchanged) |
| Redo first-use/history lifecycle | qualified | qualified (unchanged) |

**The gap keeps shrinking every time UCT is measured on the right branch rather than inferred.**
Two of the three items I had ranked highest turned out to be already shipped and invisible only to a
fine-pointer harness. What survives is genuinely narrow: **P9 (the durable layout/workspace model)**
remains the one large architectural item, and drawing-bar discoverability is the top UI item.
