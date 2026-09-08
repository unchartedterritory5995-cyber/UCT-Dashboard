# TV_IOS_CENSUS_V1_FROZEN_2026-09-07

> ## ⚠️ CORRECTED DOWNSTREAM — read these before acting on anything below
> - **P9 / workspace persistence:** statements in this file that UCT mobile has no named-layout
>   concept, or that the durable phone state is `localStorage['charts_mobile_sym']`, are
>   **FALSE**. The phone shell writes the symbol to the **server-backed**
>   `charts_workspace_groups` via `useWorkspace().setGroupSym`
>   (`MobileChartsApp.jsx:54,104,155`), named layouts already exist server-side
>   (`/api/charts/layouts`, carrying layout **and** symbols), and the only thing missing is a
>   **phone door**. Authoritative: **`60-p9-workspace-architecture.md`** and
>   `lanes/uct-p9-workspace.jsonl`.
> - **Crosshair / `$ Vol` / price-scale tap targets:** `.volLegend` and `.scaleToggle` are
>   `display:none` on the phone chart shell (`StockChart.module.css:778-797`). Any claim here
>   that UCT shows `$ Vol`/`Avg 50D` on a phone, or that three 17×11px scale controls are a
>   phone defect, is withdrawn. Authoritative: **`90-independent-validation.md`**.
> - **Object → alert, bare-chart price actions, drawing-tool counts:** superseded by the
>   addendum in `40-p1-p2-verdicts.md` and by `70-task-flow-comparisons.md`.


**Frozen artifact:** `ledger/TV_IOS_CENSUS_V1_FROZEN_2026-09-07.jsonl` (434 rows, every row stamped `census`).
**Frozen at:** 2026-09-07, immediately after the native iOS session on iPhone 15 / iOS 17.5 / TradingView v2.139 ended.
**Working ledger:** `ledger/interactions.dedup.jsonl` stays live for V2; the frozen file does not change.

Freezing does not mean "finished". It means **the numbers below are now quotable**, and any later
verification lands in V2 rather than silently moving V1's denominator. That distinction is the whole
point — a coverage percentage that keeps moving is not a measurement.

---

## 1. Headline numbers

| | rows | share |
|---|---:|---:|
| **Total distinct interactions catalogued** | **434** | 100% |
| NATIVE_VERIFIED — I performed it on a real iPhone | **137** | **31.6%** |
| OFFICIAL_DOC_VERIFIED | 129 | 29.7% |
| VIDEO_VERIFIED | 12 | 2.8% |
| INFERRED_NOT_VERIFIED | 156 | 35.9% |
| ACCESS_BLOCKED | 0 | 0% |

**CORE_MOBILE_NATIVE_VERIFIED = 133 / 373 = 35.7 %**

"Core" is the thirteen areas an active trader touches in a session: CHART, TF, SYMBOL, TYPE, DRAW,
IND, ALERT, WATCH, LAYOUT, NAV, UNDO, SET, REPLAY. It deliberately excludes NEWS, SHARE, SCREEN,
WIDGET and A11Y, which are real surfaces but not the charting loop.

**CORE_MOBILE_EVIDENCED = 246 / 373 = 66.0 %** — core rows carrying first- or second-hand evidence
of any tier. The remaining 34% is inference, and §3 says exactly which inference and how much it matters.

### Honest statement of what that 31.6% is

It is **one operator, one device, one account tier (Premium), one session, one app version, in portrait
for almost all of it**. It is not a QA pass. Every NATIVE_VERIFIED row carries the device, the app
version, the capture route and a device-clock timestamp, so any individual claim can be re-run and
falsified. Where a native observation contradicted an earlier doc-tier or video-tier row, the native
row won and the contradiction is written into the `notes` field rather than quietly overwritten —
there are 14 such reversals, and they are the most valuable rows in the file.

---

## 2. Per-area coverage at freeze

| area | native / total | % | note |
|---|---:|---:|---|
| REPLAY | 12 / 19 | 63.2% | opened from **0** this session |
| TF | 9 / 16 | 56.2% | |
| SYMBOL | 11 / 20 | 55.0% | opened from **0** this session — mandatory |
| DRAW | 21 / 44 | 47.7% | |
| NAV | 16 / 39 | 41.0% | |
| LAYOUT | 10 / 26 | 38.5% | opened from **1** this session — mandatory |
| TYPE | 5 / 14 | 35.7% | |
| ALERT | 14 / 41 | 34.1% | |
| WATCH | 4 / 12 | 33.3% | |
| IND | 16 / 50 | 32.0% | |
| CHART | 8 / 48 | 16.7% | biggest remaining gap; it is the gesture layer |
| SET | 5 / 31 | 16.1% | |
| UNDO | 2 / 13 | 15.4% | |
| NEWS | 2 / 18 | 11.1% | |
| SHARE | 1 / 9 | 11.1% | |
| WIDGET | 1 / 19 | 5.3% | needs a home-screen session |
| A11Y | 0 / 8 | 0% | **testable** — BrowserStack exposes Screen Reader + iOS Settings |
| SCREEN | 0 / 7 | 0% | |

All three surfaces the closure plan named mandatory (SYMBOL, LAYOUT) or zero (REPLAY) were closed
before the freeze. The three still at or near zero — A11Y, SCREEN, WIDGET — are the V2 queue.

---

## 3. Triage of the 156 inferred rows

| bucket | rows | meaning |
|---|---:|---|
| HIGH_VALUE_MUST_VERIFY | **39** | changes a parity verdict or a backlog item if wrong |
| MEDIUM_VALUE_VERIFY_IF_CHEAP | 53 | worth a tap if the surface is already open |
| LOW_VALUE_ACCEPT_INFERENCE | 44 | mechanical, or already answered by a neighbouring native row |
| ACCESS_LIMITED | 3 | home-screen widget internals |
| NOT_RELEVANT_TO_UCT | 17 | Pine marketplace, Minds, bonds, Handoff, Watch app |

**The 39-row must-verify queue, and why each cluster matters:**

- **CHART (7)** — `0002` fling, `0006` pinch axis coupling, `0008` time-scale drag, `0018` long-press,
  `0023` log scale, `0032` go-to-realtime, `0040` left-edge lock across an interval change.
  This is the **gesture layer**, and it is the single largest hole in the census. It is also the
  hardest to verify through a browser-rendered device screen, which is precisely why it is still open.
- **UNDO (5)** — the whole undo model, including `0011`, a **contested** row where one native
  observation did not show a removed drawing restored. Undo is data-loss-adjacent; a contested row here
  is worth more than five confirmations elsewhere.
- **DRAW (6)** — `0023` hitbox tolerance and `0020/0026/0027` handle dragging are the touch-precision
  question; `0034` Coordinates tab is TradingView's *answer* to it; `0018` keep-drawing mode maps
  one-to-one onto UCT's existing repeat toggle.
- **IND (6)** — `0020` Inputs and `0022` Style decide whether UCT's "no per-indicator editing on mobile"
  is a gap or a deliberate simplification; `0027/0029` pane resize and reorder are a known UCT hole.
- **A11Y (3)** — VoiceOver on the canvas, Dynamic Type, tap-target sizes. **These are testable** on the
  device we were using and were simply not reached.
- **ALERT (3)**, **NAV (3)**, **SCREEN (2)**, plus one each in LAYOUT / NEWS / TF / WATCH.

---

## 4. What the freeze deliberately does not claim

- **No claim about the free tier.** Everything was observed on Premium. Where a lock badge would tell a
  Basic user "no", we would not have seen it. Any row whose `gate` field is `unknown` is honest about this.
- **No claim about iPad.** iPhone only.
- **No claim about landscape parity** beyond the rows explicitly marked landscape-verified. The rotation
  work was real but partial.
- **No performance numbers.** Frame rates, memory and cold-start were not instrumented; the device screen
  arrives as a video stream, so any timing measured through it would be measuring BrowserStack.
- **No multi-device comparison.** One device.

---

## 5. Reversals — where the native pass overturned a source

These are recorded in full in the `notes` field of the row that won. Summary of the most consequential:

1. **All 21 chart types ship to the phone** (TYPE-0077) — the source lanes predicted Volume footprint,
   TPO and Session volume profile would be missing. All three are present.
2. **Chart types *are* favouritable by long-press** (TYPE-0079) — reasoned as "probably not" from
   TradingView's own help article, which omits them. The app teaches the gesture with a coach-mark.
3. **The watchlist list-switcher is horizontal tabs, not a dropdown** (WATCH-0001) — switching lists is
   one tap, not two.
4. **Alert presets exist on mobile** (ALERT-0020) — flagged as "the single biggest potential tap-count
   saver, not verified". It exists.
5. **Bar replay exists on mobile** (REPLAY-0001, REPLAY-0008) — ⚠️ *the paper-trading half is WITHDRAWN: REPLAY-0008 is `steps:0`, `gesture:system`, and its own notes read "NOT EXERCISED - no buy or sell was pressed". What is established is that a Sell/qty/Buy/Flatten strip renders and changes enabled-state.* — the area was at zero
   and no source claimed it either way.
6. **Chart type lives in the Analysis hub in portrait, the toolbar in landscape** (TYPE-0072) — settling a
   three-way conflict between two third-party guides and one unresolved lane row.
7. **Scale-mode badges are progressively disclosed** (CHART-0026) — a row a lane had called "unresolved
   and important". The answer is a three-state setting defaulting to *Visible on tap*.

---

## 6. The two system-level findings the census exists to support

The row count is not the deliverable. Two structural facts are, and both are now native-verified:

- **P1 — cursor-based placement.** TradingView solves touch imprecision by making the *readout*
  continuous rather than the *target* larger: a draggable on-chart cursor with live values
  (REPLAY-0003 drags a replay cursor and the entire indicator legend stack recomputes under the finger).
- **P2 — universal object → alert.** Price series, indicators and drawings share one action vocabulary,
  alert-first, pre-filled with the live value, reachable in 2–3 taps from any of them
  (CHART-0044, ALERT-0040, LAYOUT-0024's Object tree). Confirmed identical on desktop, so it is
  architecture, not mobile polish.

A third has now earned its place beside them:

- **P9 — the layout is the durable object; the symbol is a variable inside it.** Chart state survives a
  symbol change completely (SYMBOL-0059), the layout auto-commits (LAYOUT-0023), and every client reads
  one account-level record (LAYOUT-0026, verified across phone and desktop web in the same minute).
  This is the mechanism behind "the workspace travels with the user", and it is the finding with the
  largest architectural implication for UCT.


---

## 7. ERRATUM against the frozen file — read before quoting TV-IOS-ALERT-0008

The frozen ledger is not edited after the freeze. This section is where a post-freeze correction lives.

**TV-IOS-ALERT-0008** (frozen text) says of TradingViews pre-filled alert value:
*"SAME PRINCIPLE AS UCT: UCTs MobileAlertSheet also seeds from the live price. GENUINE PARITY on
this specific behaviour - worth recording as a UCT strength."*

**That UCT half is wrong, and it was wrong because it was read from source rather than tested.**
Measured live on production the same day (row `UCT-ALERT-0001`), the mobile alert sheet opens with an
empty field whose placeholder is *Price*. Confirmed twice — once with the chart mounted and the price
scale rendering 363.13, once from the watchlist view — by reading `input.value` directly from the DOM.

The TradingView half of the row stands: its value **is** pre-filled from the live price.
The corrected verdict is **PARTIAL, trending BROKEN**, not parity.

This erratum is the reason the closure plan insisted the parity matrix be built by operating the
product. One code-derived parity claim survived four lane passes and a native TradingView session,
and died in the first thirty seconds of touching the running app.
