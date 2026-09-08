# The 20 task flows — TradingView iOS vs UCT mobile

> ## ⚠️ REVISED 2026-09-08 AFTER INDEPENDENT ADVERSARIAL REVIEW
> **F05** (crosshair) and **F10** (drawing tools) below carry corrections; **F19** is unchanged
> but its TradingView side is now qualified. Summary of what moved:
> `$ Vol` / `Avg 50D` are `display:none` on the phone shell and are withdrawn as a UCT
> advantage · the 17×11px price-scale controls **do not render on a phone** and that defect is
> withdrawn · the drawing roster is **18 tools, of which 3 are visible**, not "~5 of 20" ·
> TradingView's bar-replay paper trading and its object→alert menu items were **observed, never
> activated**. Adjudication: `90-independent-validation.md`.

**Deliverable A.** Every flow cites the ledger rows it rests on: `CMP-*` →
`ledger/PARITY_COMPARISONS_V2.jsonl`, which in turn cites `TV-IOS-*` (the frozen census)
and `UCT-*` (the observation lanes).

**Reading the evidence column.** Four UCT tiers appear, and they are not interchangeable:

| tier | means |
|---|---|
| `REAL_COARSE` | observed on a physical iPhone 15 / iOS 17.5 touchscreen |
| `NATIVE` | measured directly against the running app or its persisted server record (pointer-independent) |
| `RESP_TOUCH` | observed in a 390px-wide **fine-pointer** frame — this tier produced **five false negatives** in this study and is flagged wherever it is load-bearing |
| `BLOCKED` / `NOT_MEASURED` | not established; never counted as a gap |

⛔ **The single most important methodological result of this study:** every claim that UCT
*lacked* something, which was later re-tested on real hardware **or read in source**, turned out
to be wrong. Five times. Three were caught by a device; the last two were caught by the
independent reviewer reading a CSS media query. Where a flow below rests on `RESP_TOUCH` alone
for a negative claim, it says so.

---

## F01 · Launch → useful chart
**TV:** app → (auth wall, no guest mode) → Watchlist tab → tap symbol → **Symbol screen** →
fullscreen control → advanced chart. **UCT:** app → `/charts` → chart is already there.

| | TradingView | UCT |
|---|---|---|
| interactions to a chart | 3–4 | **1** |
| menu depth | 2 | 0 |
| keyboard | none | none |
| chart interruption | n/a | n/a |
| state loss | none | none |
| one-handed | yes | yes |
| discoverability | the fullscreen control is not obvious | direct |
| error recovery | back | back |
| persistence | last layout restored | last workspace restored |
| evidence | NATIVE | RESP_TOUCH + NATIVE (server record) |

**Winner: UCT** — `CMP-001`, `CMP-002`. UCT lands on the chart; TV routes every entry
through the symbol screen. UCT pays for it in chrome: 101px header + 49px footer
(`CMP-002`), a centre watermark (`CMP-003`) and a price scale eating 19.5% of the width
(`CMP-004`). Class **PARITY** overall — the arrival is better, the canvas is worse.

---

## F02 · Change ticker
**TV:** symbol header → search (opens on recents, keyboard pre-shifted) → result row
(4-field disambiguation) → chart, **all chart state preserved**.
**UCT:** symbol strip → search sheet → predictive result → chart; the symbol is written to
`charts_workspace_groups`, so nothing else can be disturbed.

| | TradingView | UCT |
|---|---|---|
| interactions | 3 | 3 |
| menu depth | 1 | 1 |
| keyboard | yes, pre-shifted | yes |
| state loss | **none** (`TV-IOS-SYMBOL-0059`) | **none, structurally** (`UCT-P9-0002`) |
| discoverability | high | high |
| persistence | layout | server record, cross-device |
| evidence | NATIVE | NATIVE (server record) |

**Winner: PARITY** — `CMP-005`, `CMP-007`. TV is ahead only on result-row disambiguation
(exchange/type/country vs ticker+name) — `CMP-006`.

---

## F03 · Rapidly cycle watchlist symbols  ⭐ *UCT's biggest structural win*
**TV:** Watchlist tab → tap symbol → **Symbol screen** → fullscreen → chart → back → next.
**UCT:** watchlist widget → tap symbol → the chart follows via the colour group.

| | TradingView | UCT |
|---|---|---|
| interactions per symbol | **2 to reach a chart** | **1** |
| chart interruption | full screen swap each time | full screen swap (same model) |
| row data | 5 elements + marker glyph | ⛔ Price/Vol/%Chg **not rendered** |
| horizontal fit | fits | ⛔ **overflows at 390px** |
| evidence | NATIVE | RESP_TOUCH |

**Winner: split, and both halves matter.** The *loop* is UCT's (`CMP-010`): TV's watchlist
tap does not open a chart, ever — charting is two taps per symbol, and this is the single
most-repeated action of a review session. The *row* is broken on UCT (`CMP-011`,
`CMP-012`): the API returns the data and the phone drops it, and the table overflows.
**Fixing the row makes UCT's rapid-review loop unambiguously best-in-class.**

---

## F04 · Change timeframe
**TV:** interval button → scrollable sectioned sheet (ticks/seconds/minutes/…/ranges) →
chip. **UCT:** eight interval buttons, always visible, one tap.

| | TradingView | UCT |
|---|---|---|
| interactions | 2–3 (+ scroll) | **1** |
| menu depth | 1 | **0** |
| catalogue | ticks→ranges + custom intervals | 8 fixed |
| one-handed | sheet is reachable | **row is in the thumb arc** |
| persistence | layout | `opts.tf` in the server record, **measured phone→desktop** |
| evidence | NATIVE | RESP_TOUCH + NATIVE (server record) |

**Winner: UCT on cost, TV on breadth** — `CMP-015`, `CMP-016`. ⛔ **Do not copy TV's
favourites mechanism** (`CMP-017`): TV needs it *because* its catalogue is huge and its
sheet scrolls. UCT's eight are all already visible; favourites would add a concept and
remove nothing.

---

## F05 · Inspect a candle precisely
**TV:** press-and-hold → value-tracking mode; legend expands to OHLC + change + volume.
**UCT:** press-and-hold → legend renders `date · O · H · L · C · V · change · change%` **plus
EMA 9 / EMA 20 / SMA 50 / SMA 200 live values** — *when the legend is enabled at all*.

| | TradingView | UCT |
|---|---|---|
| interactions | 1 | 1 |
| readout content | OHLC, change, volume | **OHLC, change, change%, volume + 4 live MA values** |
| is it on by default? | always | ⚠️ **a user setting** — a legacy stored blob resolves it OFF |
| dismissal | lift | lift |
| evidence | **OFFICIAL_DOC** (`TV-IOS-IND-0039`) | **REAL_COARSE** (`UCT-CHART-0008`) |

**Winner: UCT on content, with a real caveat on availability** — `CMP-019`, `CMP-020`,
`CMP-086`. ⚠️ **Tier asymmetry, stated:** UCT's readout was read off a physical iPhone; TV's is
from official documentation, not a native capture.

⛔ **Two corrections, both from the adversarial review, and the second is more important than
the finding it corrects.**
1. **`$ Vol` and `Avg 50D` are withdrawn.** `StockChart.module.css:778-797` sets `.volLegend`
   to `display:none` on the phone chart shell at coarse pointer, in *both* orientations, with a
   comment calling it "desktop furniture" that would "cover candles". They do not render on a
   phone. ⭐ UCT deliberately removed them — and this study recorded that decision as a defect
   twice before catching it.
2. **The cause of the original "UCT has no O/H/L/C" observation was never the pointer.** The
   render gate is `crosshairData && !hideLegend && legendMode !== 'off' && (legendMode !== 'hold'
   || legendHeld)` — **no pointer clause anywhere**. `legendMode` is a user setting whose legacy
   fallback `header.showLegend` "sits in every stored blob in production". The earlier pass ran
   on a production account; the device pass ran on a fresh sandbox admin. **The difference was
   the account, not the finger.** ⛔ That means a real member's phone may show **no OHLC readout
   at all** — a finding this study did not have before the review (`CMP-086`).

---

## F06 · Return to live / current price
**TV:** a go-to-realtime control (`TV-IOS-CHART-0032`, **INFERRED — never natively exercised**).
**UCT:** a measured go-to-realtime affordance on the mobile chart (`UCT-CHART-0006`).

**Winner: PARITY against an unverified baseline** — `CMP-022`. ⚠️ Do not read this as "UCT
matched TV"; TV's side was never observed. Pinch/fling recovery is unclassified on both
(`CMP-023`).

---

## F07 · Add an indicator
**TV:** toolbar or Analysis hub → picker (PERSONAL: Favorites / My scripts / Invite-only;
BUILT-IN: Technicals + sub-tabs) → star to favourite → tap → **picker stays open for more**.
**UCT:** toolbar indicator control *or* Tools → Add indicator… *or* the long-press price
sheet's "＋ Add indicator…" → picker, **each row explains what the indicator does**.

| | TradingView | UCT |
|---|---|---|
| entry points | 2 | **3** (incl. from the long-press price sheet) |
| picker teaches | ❌ name list under tabs | ✅ **each row explains itself** |
| recents | ❌ **TV has none** (`TV-IOS-IND-0010`) | not measured |
| multi-add in one visit | ✅ | not measured |
| formula rows | "My scripts" by name | ⛔ **formula BODIES dumped inline** — ~3 fill a screen |
| evidence | NATIVE | RESP_TOUCH / REAL_COARSE (sheet) |

**Winner: UCT on comprehension, TV on picker mechanics** — `CMP-024`, `CMP-025`, `CMP-029`.
UCT's self-explaining picker is a real advantage for a members-first product. Its formula-row
rendering is a straight presentation defect.

---

## F08 · Modify an applied indicator
**TV:** tap the legend name → inline actions → overflow (alert / indicator-on-indicator /
visibility-on-intervals / move-to-pane / z-order / pin-to-scale).
**UCT:** ⛔ **NOT EXERCISED ON HARDWARE.**

**Winner: unresolved — `CMP-030`, `CMP-031`, `CMP-032`.** This is the study's largest
*coverage* hole, and it is reported as a hole, not as a UCT gap. TV's per-indicator surface is
deep and native-verified; UCT's phone legend-row affordances were never opened. **Do not
write a backlog item claiming UCT lacks these.**

---

## F09 · Remove / hide an indicator
**TV:** legend overflow offers non-destructive **Hide** beside destructive **Remove**,
consistently across objects.
**UCT:** not exercised on the phone.

**Winner: unresolved** — `CMP-033`. The *pattern* (hide ≠ remove) is worth adopting and is
recorded for drawings, where it IS measured (`CMP-045`).

---

## F10 · Add a drawing
**TV:** pencil → **searchable, category-tabbed picker** → tool → draggable offset cursor with a
**step counter and instruction copy** → magnet toggle available → trash cancels mid-draw.
**UCT:** Tools → Draw on chart → a horizontal bar showing **3 of 18 tools** (plus a pinned
eraser) with no scroll affordance → tap-per-anchor placement → magnet available.

| | TradingView | UCT |
|---|---|---|
| tools findable without scrolling | all, via tabs + search | **3 of 18** (+ pinned eraser) |
| placement | offset cursor, narrated | tap-per-anchor, silent |
| mid-draw cancel | ✅ trash | undo afterwards |
| magnet on touch | ✅ | ✅ (bar + price sheet) |
| evidence | NATIVE | **REAL_COARSE** (`UCT-DRAW-0007`) |

**Winner: TradingView, on discoverability only** — `CMP-034`. ⭐ **This is the top surviving
UI gap in the study**, and it is confirmed on real hardware rather than inferred.
⚠️ **Counts corrected on review, and the gap is WORSE than first stated:** `MobileDrawBar.jsx`
`DRAW_TOOLS` holds **18** entries (not 20) plus a pinned eraser, and the device capture in
`UCT-DRAW-0007` reads *"Done | Trend | Horizontal | H R | Eraser"* — **three** scrollable tools
visible, not five. Note the
symmetry recorded at `CMP-083`: **TV has the same disease** — its Analysis hub's default
detent hides 15 of its 18 entry points. Neither product has solved "a phone cannot show a
desktop's feature surface." That is a place to lead, not to copy.
⛔ The *placement primitive* difference (`CMP-036`) is a **PRODUCT_MODEL_DIFFERENCE** and the
recommendation to adopt TV's cursor is **withdrawn**.

---

## F11 · Precisely position / edit a drawing
**TV:** drag the offset cursor; selection echoes onto both axes; exact anchors via a
Coordinates tab (`TV-IOS-DRAW-0034`, **INFERRED**).
**UCT:** long-press the object → **`Set level…`** → a **pre-filled decimal keypad**.

| | TradingView | UCT |
|---|---|---|
| exact numeric entry | Coordinates tab, inside settings (**inferred**) | **one menu item, pre-filled** |
| menu depth to exact entry | 2–3 | **1** |
| live axis feedback while placing | ✅ both axes | ❌ |
| grab radius on touch | native-verified handles | ⛔ **BLOCKED** (source says 15px/7px) |
| auto-select after placement | ✅ floating toolbar | ⛔ **BLOCKED** |

**Winner: UCT on exact placement, TV on live feedback** — `CMP-040`, `CMP-039`, `CMP-041`,
`CMP-042`. ⛔ Two of the five sub-checks are **ACCESS_BLOCKED**: no drawing could be placed
through the automation harness (a synthetic tap reaches every DOM control but not the
overlay's placement path). `CMP-042` — whether a placed drawing is auto-selected — is the
highest-value unresolved item in the study, because it decides whether UCT's tap-to-place is
a **draft** or a **commit**.

---

## F12 · Modify drawing properties
**TV object menu:** Add alert · Template ▸ · Visual order ▸ · Visibility on intervals ▸ ·
Object tree… · Clone · Lock · **Hide** · Remove · Sync mode.
**UCT object menu (type-aware):** Color / Width / Style / Font size · **Set level…** ·
**Make horizontal** · **Alert above / below** · Duplicate · Lock/Unlock · Bring to front /
Send to back · Delete · **Save as defaults** · saved-colour palette.

**Winner: PARITY, different sets** — `CMP-043`, `CMP-044`. UCT's menu **adapts to the drawing
type** rather than being a fixed list. TV holds: **Hide** (`CMP-045`, MISSING on UCT — small,
real, cheap), named **Templates** (`CMP-046`, UCT has "Save as defaults" = the 80% case), and
per-object **sync mode** (`CMP-047`, a genuine product-model difference — UCT's drawings
belong to the *symbol*). UCT's touch quick-bar is **BLOCKED** (`CMP-048`).

---

## F13 · Create an alert from a price
**TV:** long-press / ⊕ on the price scale → dialog: scope (title) · condition · operator
(default *Crossing*) · **value pre-filled from the live price** · Create → drawn on the chart.
**UCT:** long-press the bare plot → sheet headed **`AT $700.64`** → **`🔔 Alert when below
$700.64`** — beside `✎ Draw line at…`, `📋 Copy…`, chart settings, indicators and timeframe.

| | TradingView | UCT |
|---|---|---|
| interactions | 3–5 (form) | **2** |
| typing | none if the pre-fill is accepted | **none** |
| operator decision | user picks | **pre-decided in the label** |
| what else the same gesture offers | alert / order / buy / sell / draw / copy | alert / draw / copy **+ chart settings + indicators + timeframe** |
| evidence | NATIVE | **REAL_COARSE** (`UCT-CHART-0007`) |

**Winner: UCT** — `CMP-049`, `CMP-050`, `CMP-051`.
⛔⛔ **This flow previously read "UCT has no bare-chart price → action bridge," and it was
called the single highest-value item in the study. It is WITHDRAWN.** The bridge exists on a
real touchscreen and is *broader* than TradingView's. The earlier finding was a
fine-pointer artifact.

---

## F14 · Create an alert from a drawing or indicator
**TV:** object menu → *"Add alert on trendline…"* at the top; the alert is **BOUND** to the
object and tracks it. Same for indicators, with the current value pre-bound.
**UCT:** object menu → **Alert above / Alert below** — three gestures, zero typing — but the
alert is **SEEDED**: it snapshots a price at creation and then stands alone. A sloped line
snapshots its **later endpoint**.

**Winner: UCT on cost, TradingView on semantics** — `CMP-054`, `CMP-055`.
⚠️ **Both sides downgraded on review.** TradingView's object→alert rows
(`TV-IOS-DRAW-0043`, `TV-IOS-ALERT-0024`) are *presence* observations — "observe the first item
of the menu" — the alert was never activated from a drawing or an indicator; and its one
committed alert was measured in **landscape** against UCT's **portrait**. UCT's side was
measured only in the fine-pointer frame and never reproduced on a device, because no drawing
could be placed there at all.
⛔ **The withdrawn claim was "UCT has no object → alert."** It has one, and it is cheaper than
TV's. **The surviving gap is BINDING, not existence** — move the line and TV's alert moves;
UCT's does not. Alerts from *indicator* values are **not measured** on UCT (`CMP-056`).

---

## F15 · Change chart type
**TV:** hub (portrait) or landscape toolbar → sheet of **21 types**, favouritable, selection by fill.
**UCT:** toolbar → sheet of **5 types**, selection by fill; persists to the server record
(measured: `settings.chartType='bars'` set on the phone, read back on the desktop).

**Winner: PARITY on the interaction, TradingView on catalogue** — `CMP-057`, `CMP-058`,
`CMP-059`. The missing 16 are Renko/Kagi/PnF/line-break variants: a different audience, not a
mobile defect.

---

## F16 · Modify chart settings
**TV:** hub → Settings → **seven sections** → change → **explicit Ok / Cancel** (transactional);
templates and defaults live in a footer overflow.
**UCT:** Tools → Chart settings — **and** the three most-flipped toggles (Logarithmic scale,
Magnet crosshair, Swing price labels) are **inline in the long-press price sheet**, at depth zero.

**Winner: UCT on reach, TradingView on safety** — `CMP-060`, `CMP-061`, `CMP-062`.
⛔ **Do not blanket-copy TV's transactional commit.** It is right for a 40-field sheet and
wrong for three inline toggles. Adopt it only if UCT's full settings sheet grows.

---

## F17 · Portrait → landscape → portrait
**TV:** landscape is a **distinct mode** — the symbol header returns, ~3× the time range is
visible, the control layout swaps, and the app tab bar stays.
**UCT:** ⛔ **NOT MEASURED ON HARDWARE.**

**Winner: unresolved — `CMP-063`, `CMP-064`.** UCT *has* a landscape phone branch in CSS
(`(pointer: coarse) and (orientation: landscape) and (max-height: 500px)`), and its
server-backed record predicts that tf/type/symbol survive a rotation while the device-local
view lock survives on the same device. **A prediction from source is not a measurement and is
not counted.** This is the second real coverage hole.

---

## F18 · Leave the chart and come back without losing work
**TV:** layout autosaves; app-backgrounding behaviour is **explicitly undocumented**
(`TV-IOS-NAV-0015`).
**UCT:** widgets, arrangement, timeframe, chart settings, symbol and drawings all survive —
**measured in the server record**, not assumed. What is lost: the **undo/redo history** (the
drawings persist; the transaction log does not), and Redo does not arm on the first undo after
a load.

**Winner: UCT, against an unverified TV baseline** — `CMP-065`, `CMP-066`, `CMP-067`.
⚠️ Read as "UCT is *proven* good here", not "UCT beat TV". On redo specifically, UCT ships
both arrows where TV's toolbar **overflows the viewport in both orientations** — ahead, but
never a clean win.

---

## F19 · Save and restore a workspace  ⭐ *the largest surviving gap*
**TV:** hub → six layout controls above every charting tool → **full CRUD layout manager on
the phone**: search, four sort orders, active-row inversion, always-visible per-row delete,
autosave with the Save button as a **dirty-state indicator**, autosave exposed as an account
setting ON by default.
**UCT:** the layout object exists, is server-backed, carries the symbols, and supports
admin-published firm-wide prebuilts (which TV does not offer at all) — **and the phone has no
door to any of it.** The desktop has *New Layout · Open Layout ▸ · Save Layout ▸ · ▦ Multi
Chart ▸ · ⧉ Pop Out Layout*; the phone Tools sheet has five rows and none of them is a layout.

| | TradingView | UCT |
|---|---|---|
| named workspaces exist | ✅ | ✅ **and they store the symbols** |
| reachable from the phone | ✅ full CRUD | ❌ **none** |
| autosave | ✅ + dirty-state indicator + account setting | ✅ silent, no indicator, no named target |
| cross-device | documented | **measured phone→desktop** |
| view range travels | documented | ❌ device-local |
| evidence | NATIVE | NATIVE (both surfaces + server record) |

**Winner: TradingView, decisively, on the door** — `CMP-068`…`CMP-073`.
⛔ **Do NOT write "UCT has no saved layouts."** The correct statement: *the phone is a
first-class WRITER to a durable object it cannot name, snapshot or restore.* The fix is a
sheet over an existing API — see `60-p9-workspace-architecture.md` §R2. Drawings, separately,
**do** follow the user across devices (`CMP-074`), with a real LWW defect (`CMP-075`).

---

## F20 · Reach contextual intelligence without destroying chart context
**TV:** hub → Symbol details → four context tabs (incl. Minds, its social layer); plus
chart-native order entry and a searchable broker directory two taps from the chart.
**UCT:** Tools → a widget page — Fundamentals, Theme Tracker, AI Search, Watchlist — which
**returns to the chart automatically when the chart's symbol moves**.

**Winner: PARITY on mechanics, PRODUCT_MODEL_DIFFERENCE on substance** — `CMP-076`,
`CMP-077`, `CMP-078`. Both replace the chart with a peer surface and come back. ⭐ UCT's
auto-return-on-symbol-change is a genuinely elegant touch TV does not have. And UCT's
chart-adjacent context *is the reason its members are there* — it should not be traded for a
TradingView-shaped news tab. UCT has no execution and correctly does not want it.

---

## What the 20 flows say in one paragraph

UCT wins the **repeated** actions — arrival, symbol cycling, timeframe, candle inspection,
price→alert, settings reach, leave-and-return. TradingView wins the **occasional but
structural** ones — the layout door, tool discoverability, alert binding, catalogue breadth,
and per-object hide/template/interval-visibility. The three flows UCT actually loses badly
(**F19** layout door, **F10** tool discoverability, **F03**'s broken watchlist row) are all
*surface* problems over working machinery, not missing capability. Two flows (**F08**, **F17**)
were never measured and are reported as holes rather than guessed.

⚠️ **And one flow changed character entirely on review.** F05 looked like a clean UCT win until
the reviewer read the CSS: two of the things credited to UCT do not render on a phone, and the
crosshair legend a member sees depends on a *stored settings key from a retired schema*. The
corrected F05 is still a UCT win on content and now carries a real, previously-unrecorded
defect. **That is the fifth time in this study that reading the source produced a better
finding than the observation it corrected.**
