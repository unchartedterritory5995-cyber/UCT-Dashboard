# MOB-06′ — the mobile presentation contract

**A REGISTER, NOT A RUNTIME REGISTRY.** Nothing here executes. It is the document an
engineer reads before hiding, moving or restoring a chart control on the phone, and the
place a hide is recorded so the next person can tell a decision from an accident.

It supersedes §5 of `97-mob06-presentation-inventory.md`, which got the mechanism wrong.
That correction is the first section, because everything downstream of it changes.

---

## 0 · The correction: there was never a "zero-width layout collapse"

`97`'s §5 said eleven controls *"render at 0×0 with `display:flex` — collapsed to zero
width by the `ChartToolbar` layout, not hidden by any media query or product decision"*,
and its Summary G made that the study's headline finding: three hiding mechanisms with
three levels of intent, the middle one **undocumented and unintentional-looking**.

**Re-measured 2026-09-08** — 390×844 same-origin iframe on the local sandbox, phone shell
confirmed active (`html[data-mobile-chart-shell]="1"`, `max-width:640px` matching):

```
.toolbar          computed display: none      inline style="display: none;"
  .tools          computed display: flex      rect 0×0
  .actions        computed display: flex      rect 0×0
  .toggleBtn      computed display: flex      rect 0×0
```

The **whole strip** carries an inline `display:none`. Its children report `display:flex`
because `display` is not inherited — a child of a hidden element still computes its own
value and still measures 0×0. §5 read the children, saw `flex` beside a zero rect, and
inferred a layout accident.

The real chain, all three links in source:

| link | site |
|---|---|
| the shell asks | `pages/charts/mobile/MobileChartsApp.jsx:264` → `mobileDrawBar: true` |
| StockChart forwards | `components/StockChart.jsx:15610` → `hiddenHost={mobileDrawBar}` |
| the toolbar hides | `components/chart/ChartToolbar.jsx:1247` → `style={hiddenHost ? { display: 'none' } : …}` |

…and the intent is stated in-file at `ChartToolbar.jsx:934-936`:

> *Phone chart shell: MobileDrawBar presents the drawing tools instead, so this strip
> hides ENTIRELY (its dialogs still portal out, its imperative ref API still serves —
> only the desktop presentation goes).*

**So the eleven are one deliberate, documented, single-site decision — not eleven
accidents.** Summary G's "undocumented, unintentional-looking, never analysed" was wrong
about all three adjectives. What G was *right* about survives in a smaller form: the
**alternative-path analysis** had never been done for the controls inside that strip.
That is what §3 below does, control by control.

⚠️ **Why the mis-read is worth recording rather than quietly fixing.** A 0×0 box and a
hidden ancestor look identical in a DOM dump, and the difference is the whole verdict:
one is a bug to fix, the other is a policy to check. Any future audit of this shell must
read the computed style of the **container**, not the boxes of its children.

---

## 1 · The four presentation mechanisms, exactly

| # | mechanism | scope | controls | intent |
|---|---|---|---|---|
| **M1** | `@media (pointer: coarse)` + `html[data-mobile-chart-shell]` in `StockChart.module.css:778-797` | 3 hides + (new) 1 reveal | `.liveIndicator`, `.scaleToggle`, `.volLegend`; reveals `.volXtra` | deliberate, documented, **rationale partly wrong** — see §3.1 |
| **M2** | `hiddenHost` → inline `display:none` on the whole `ChartToolbar` | 1 site, ~15 controls | the desktop drawing strip in full | deliberate, documented (§0) |
| **M3** | `@media (max-width: 640px)` title-matched `display:none` in `ChartToolbar.module.css:552-558` | 5 controls | Share chart · Keyboard shortcuts · Replay · Compare symbols · Time until bar closes | deliberate, documented, rationale in-file |
| **M4** | not rendered at all on the phone branch | 2 | Compare symbols (also absent from the tree), Countdown | deliberate |

**M2 and M3 stack.** On the phone *chart shell* M2 already hides everything, so M3 is
inert there. M3 is the live mechanism on a **narrow non-shell surface** — a chart on the
dashboard, breadth, or a watchlist at <640px, where the toolbar is visible and those five
are not. Two contexts, and the register covers both.

---

## 2 · The acceptance rule this register applies

A control may be hidden on the phone **only** if one of these holds, and the register
must say which:

- **A · REACHABLE ELSEWHERE** — the user task has a real, *verified* phone path.
  ⛔ "There is probably a setting for it" is not a path. The path is walked or it does not exist.
- **B · NOT APPLICABLE** — the task cannot exist on a touch device (hover, keyboard chords).
- **C · FURNITURE** — the control conveys information the phone already conveys another way.
- **D · RECORDED PRODUCT DECISION** — the task is deliberately dropped on the phone, and
  that decision is written down.

Anything else is an **ORPHANED MOBILE TASK**: a capability the product computes and the
phone cannot reach. Disappearance is *never* evidence of intent — every ❌ below was
searched for across `MobileDrawBar`, `DrawingQuickBar`, `DrawingContextMenu`,
`MobileChartsApp` and its seven sheets, `ChartSettingsModal`, and the four long-press
region menus before being called an orphan.

**Column key.** CAT = ALWAYS_VISIBLE_MOBILE / CONTEXTUAL_MOBILE / TOOLS_SHEET /
HIDDEN_DESKTOP_FURNITURE / GESTURE_REPLACED / NOT_APPLICABLE ·
TIER = REAL = real iPhone 15 / iOS 17.5 · EMU = 390px same-origin iframe (**layout facts
only — this frame renders the fine-pointer CSS**) · SRC = source · REC = recommendation.

---

## 3 · THE REGISTER

### 3.1 · M1 — hidden by `(pointer: coarse)` on the phone shell

| CONTROL (source name) | CAT | MECHANISM | USER TASK | VERIFIED ALTERNATIVE PATH | TIER | INTENTIONAL? | REC | TEST-RAIL OWNER |
|---|---|---|---|---|---|---|---|---|
| `.liveIndicator` **● LIVE** | HDF | M1 | know the feed is live | ✅ **A** — the price strip tick-flashes; `.staleIndicator` is *not* hidden, so STALE/RECONNECTING still render | REAL + SRC | ✅ **C** | `NO_CHANGE` | — |
| `.scaleToggle` **A / L / %** | HDF | M1 | choose arithmetic / log / percent | ✅ **A (repaired 2026-09-08)** — price-axis long-press → *Price scale* → all three modes. Was ⚠️ PARTIAL: Percent had **no** phone writer at all | REAL (hide) + behavioural (path) | ✅ **A** *after* the repair; **was an orphan** | `NO_CHANGE` — chips stay hidden | `chart/mobileScaleAndVolume.test.jsx` |
| `.volLegend` **Vol · $ Vol · Avg ND** | HDF | M1 | read volume, dollar volume, average volume on a bar | ✅ **A (repaired 2026-09-08)** — `Vol` was already in the crosshair legend; `$ Vol` and `Avg ND` now ride it too via `.volXtra` | REAL (hide) + behavioural (rows) | ✅ **A** *after* the repair; **was an orphan** | `NO_CHANGE` — the strip stays hidden | `chart/mobileScaleAndVolume.test.jsx` |
| `.volXtra` **$ Vol · Avg ND** *(new, phone-only)* | CTX | M1 (reveal) | as above | n/a — this *is* the path | EMU + behavioural | ✅ **A** | keep paired with `.volLegend` | `chart/mobileScaleAndVolume.test.jsx` |

⭐ **The CSS comment's stated rationale still does not cover its own targets.** It reads
*"desktop furniture — on a 393px canvas they cover candles to answer questions the
settings sheet already answers."* The settings sheet answers **neither** percentage scale
**nor** dollar/average volume. The instinct was right, the justification was not, and the
two repairs above are the consequence. The comment should be corrected the next time that
block is touched; it is not corrected here because MOB-06′ authorized behaviour changes,
not a CSS-comment rewrite.

### 3.2 · M2 — inside the hidden `ChartToolbar` (§0's eleven, named from source)

`97` listed eleven by shorthand. The exact `aria-label`s in `ChartToolbar.jsx`, and
**two the list omitted**:

| CONTROL (exact source name) | CAT | MECHANISM | USER TASK | VERIFIED ALTERNATIVE PATH | TIER | INTENTIONAL? | REC | TEST-RAIL OWNER |
|---|---|---|---|---|---|---|---|---|
| `Drawing color` (title `Color`) | GR | M2 | colour a drawing | ✅ **A** — select drawing → quick bar **Style** → `DrawingContextMenu.onSetColor`. Default for *new* drawings via the same sheet's **Save as default** | SRC + REAL | ✅ | `NO_CHANGE` | `ChartDrawingOverlay` suites |
| `Line width: {n}px` | GR | M2 | set stroke width | ✅ **A** — same sheet, `onSetWidth` | SRC + REAL | ✅ | `NO_CHANGE` | ↑ |
| **`Line style`** *(omitted from the eleven)* | GR | M2 | solid / dashed / dotted | ✅ **A** — same sheet, `onSetStyle` | SRC | ✅ | `NO_CHANGE` | ↑ |
| **`Text size: {n}px`** *(omitted from the eleven)* | GR | M2 | size a text annotation | ✅ **A** — same sheet, `onSetFontSize` | SRC | ✅ | `NO_CHANGE` | ↑ |
| `Delete selected` | GR | M2 | remove one drawing | ✅ **A** — quick bar **Delete**; plus the `eraser` tool in `MobileDrawBar` (tap-to-delete) | SRC + REAL | ✅ | `NO_CHANGE` | `MobileDrawBar.roster.test.js` |
| `Hide all drawings` / `Show drawings` | GR | M2 | clear the canvas without losing work | ✅ **A** — chart long-press → *View* → **Hide drawings** (`StockChart.jsx:4370`, id `hide-draw`). ⚠️ `97` said "none found" | SRC | ✅ | `NO_CHANGE` | `engine/__tests__/stockChartWiring.test.jsx` |
| `Magnet: on` / `Magnet: off` | GR | M2 | snap to O/H/L/C | ✅ **A** — `MobileDrawBar` → **Snap to price** (`setMagnet` is passed to it) | SRC + REAL | ✅ | `NO_CHANGE` | `MobileDrawBar.roster.test.js` |
| `OHLCV legend: {state}` | GR | M2 | always / on-hold / off legend | ✅ **A**, two doors — long-press → *View* → **legend-mode** submenu (2 taps), and Tools → Chart settings → **Chart Legend** (3 taps) | SRC + behavioural | ✅ | `NO_CHANGE`; discoverability is `MOB-04`'s | `engine/__tests__/legendModes.test.jsx` |
| `Indicator alerts` | GR | M2 | set an alert on an indicator | ✅ **A** — tap the indicator's legend chip → **Alerts**, and long-press an indicator pane → **Add alert on ‹label›…** (`i-alert`). Both call `toolbarRef.openAlerts`, which serves from the hidden host by design. Live because `showDrawingTools` defaults **true** and the phone shell does not override it. ⚠️ `97` had this UNVERIFIED | SRC (chain) | ✅ | `NO_CHANGE` — **confirm on device**, the popover's host is `display:none` | `IndicatorAlertPopover.scope.test.jsx` |
| `Clear all drawings ({n})` | — | M2 | wipe every drawing at once | ❌ **NONE.** `onClearAll` reaches only `ChartToolbar` and the two annotation toolbars. The eraser is one-at-a-time | SRC (exhaustive) | ❌ **ORPHANED MOBILE TASK** | `MOVE_TO_TOOLS` — one row, next wave | *(none yet)* |
| `Repeat drawing: on` / `off` | — | M2 | keep a tool armed across placements | ❌ **NONE.** `repeatMode`/`setRepeatMode` are passed to `ChartToolbar` and `ChartDrawingOverlay`, **never** to `MobileDrawBar` | SRC (exhaustive) | ❌ **ORPHANED — but benign**: the default is OFF, which is the correct phone default, and `MobileDrawBar.arm()` re-arms in one tap | `MOVE_TO_TOOLS` (low priority) | *(none yet)* |
| `Drawing Boards` (`BoardsToolButton`) | — | M2 | save / switch named drawing sets | ❌ **NONE.** Rendered only inside the hidden strip (`showTracings`) | SRC (exhaustive) | ❌ **ORPHANED MOBILE TASK** — highest-value of the three | **owner call** — a phone door is real work, not a row | *(none yet)* |
| `Customize drawing tools` | NA | M2 | show/hide & favourite tools on the desktop rail | ❌ none — **and correctly so**: it customises a rail the phone does not have. `MobileDrawBar` ships its own fixed 18-tool roster | SRC | ✅ **B** | `NO_CHANGE` | `MobileDrawBar.roster.test.js` |
| `Undo` · `Redo` | GR | M2 | step history | ✅ **A** — `MobileDrawBar` carries both | SRC + REAL | ✅ | `NO_CHANGE` | `MobileDrawBar.roster.test.js` |

### 3.3 · M3 — hidden by title at `max-width: 640px` (live on non-shell phone surfaces)

| CONTROL | CAT | MECHANISM | USER TASK | VERIFIED ALTERNATIVE PATH | TIER | INTENTIONAL? | REC | TEST-RAIL OWNER |
|---|---|---|---|---|---|---|---|---|
| `Share chart` | TS | M3 | export / link the chart | ✅ **A** — Tools sheet → **Share chart image** | SRC + REAL | ✅ | `NO_CHANGE` | `ChartToolbar.phonewrap.test.js` |
| `Show keyboard shortcuts` | NA | M3 | learn key chords | n/a — no keyboard | SRC | ✅ **B** | `NO_CHANGE` | ↑ |
| `Replay / Time Machine` | — | M3 + M4 | scrub bar-by-bar | ❌ none | SRC | ✅ **D** — confirms `CMP-079` `DESKTOP_ONLY` | `NO_CHANGE` | ↑ |
| `Compare symbols` | — | M3 + M4 | overlay a second symbol | ❌ none — **not in the phone DOM at all** | SRC | ✅ **D** — confirms `CMP-080` `DESKTOP_ONLY` | `NO_CHANGE` | ↑ |
| `Time until bar closes` | NA | M3 | countdown to close | ❌ none | SRC | ✅ **D** — niche toggle | `NO_CHANGE` | ↑ |

⛔ **The Indicator bell is deliberately NOT in M3's title list**, and the CSS says why:
*"The Indicator bell STAYS — it is the only door to indicator alerts."* On a narrow
non-shell surface that is literally true. Do not add it.

---

## 4 · Orphaned mobile tasks after MOB-06′

Two were repaired under this wave. Three remain, and they are **recorded, not hidden**:

| orphan | severity | why it is not being fixed here |
|---|---|---|
| `Clear all drawings` | low | one row in the Tools sheet; MOB-06′ authorized two specific repairs, not a third |
| `Repeat drawing` | very low | the phone is locked to the *correct* default and re-arming costs one tap |
| `Drawing Boards` | **medium** | a real feature with no phone surface at all. Building one is a wave, not a row — **owner call** |

**Repaired:** percentage scale (had no phone writer in the entire app) and
`$ Vol` / `Avg ND` (rendered on no phone surface).

---

## 5 · Was a shared mechanism warranted? **No.**

`97`'s Summary G proposed one, on the strength of "three unrelated mechanisms with three
levels of intent". §0 removes the middle one: M2 is a single documented decision at a
single call site, not eleven accidents. What is left is three mechanisms that are each
**the right tool for a different question**, and collapsing them would re-create the
`isMobile` conflation this programme exists to prevent:

- **M1 asks about the POINTER** (`pointer: coarse` + the shell attribute) — it must stay
  in CSS, because it is presentation and because a JS `matchMedia` read is stale at first
  paint on a fixed mobile viewport.
- **M2 asks about the SHELL** ("does this surface present drawing tools some other way?")
  — a product question, correctly a prop from the shell that knows the answer.
- **M3 asks about WIDTH** — a layout question, correctly a width media query.

A single abstraction over the three would have to take pointer, shell and width as
arguments and would still branch on all three. **That is not a mechanism, it is a
rename.** The framework rule applies: no framework architecture without demonstrated
duplication, and there is none — each mechanism has exactly one implementation.

**What the finding actually needed was this document.** The gap was never mechanical; it
was that an engineer could not tell whether a control's absence had ever been a decision.
That is a documentation defect, and a register fixes it at a fraction of the risk.

---

## 6 · Rules that hold from here

1. ⛔ **DO NOT HIDE MORE CONTROLS.** Crowding at 390px is not a reason on its own. A new
   hide needs a row in §3 naming its mechanism, its user task, and a *walked* alternative path.
2. ⛔ **An alternative path must be walked, not assumed.** Every ✅ above names the file and
   the door. Three ❌s survived that search — the search is what makes the ✅s mean anything.
3. ⛔ **Never collapse the four concepts** — viewport policy · pointer policy · touch-hardware
   capability · product presentation policy. Different questions, different owners.
4. ⛔ **Read the container's computed style, not the children's boxes** (§0).
5. **When a hide is removed, the rule that hid it and the rule that replaces it move in the
   same commit.** `.volXtra` ⇄ `.volLegend` is the worked example, and it has a rail.

---

## 7 · How this was measured

| instrument | what it proved here |
|---|---|
| 390×844 **same-origin iframe** on the local sandbox (`127.0.0.1:8092`), phone shell active | the M2 mechanism (§0). ⚠️ Pointer-independent layout facts **only** — this frame renders the fine-pointer CSS, so it can say nothing about M1 |
| **Real iPhone 15 / iOS 17.5** (BrowserStack + Local → sandbox) | every M1 hide, and the drawing quick bar / eraser / magnet paths |
| **Source**, read exhaustively across the phone surfaces | every alternative path, and every ❌ |
| **Behavioural tests** (`chart/mobileScaleAndVolume.test.jsx`, 29 cases, 10 mutations each proven red) | the two repairs |

⛔ The tiers are not mixed. No M1 claim rests on the iframe; no M2 claim rests on the device.
