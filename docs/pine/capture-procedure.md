# Capture procedure — driving a live TradingView chart

The rules for taking a vendor capture. The mechanics live in
`tools/visual_conformance/README.md`; this page is the **procedure**, and it exists because
every rule below was learned by losing time to it.

---

## ⛔⛔ NEVER ADD A STUDY WHILE THE TAB IS HIDDEN

> ### ⭐⭐ THE ONE-LINE PRE-FLIGHT — run it before planning any visit that ADDS
>
> ```js
> ({ vis: document.visibilityState, w: window.innerWidth, h: window.innerHeight })
> ```
>
> **2026-09-11: this returned `{vis: 'hidden', w: 0, h: 0}`** — every dimension
> zero, `screen.width` included, because the Chrome window was MINIMISED. Reads all
> worked (V4, and the timeline row that turned out to be the one the barstate ruling
> was waiting for); the add route was simply unavailable, and no amount of retrying
> was going to change that.
>
> ⛔ **A minimised window cannot be un-minimised from page context**, and
> `takeScreenshot` fails with *"Cannot take screenshot with 0 width"* rather than
> anything that names the cause. Check this FIRST and plan the visit around the
> answer: a hidden tab is a READ-ONLY visit, and that is still a useful visit.

**If you did: `chartWidget._adjustSize()` rebuilds the pane widgets. Remove-and-re-add does
NOT.**

This is the single most expensive thing in this document.

A study added while `document.visibilityState === 'hidden'` gets a pane in the **model** and no
pane **widget**. It then renders nothing at all — not a plot, not even a legend — on the live
chart and in every screenshot, while every diagnostic you would think to run says it is
healthy:

| What you check | What it says |
|---|---|
| `study.isFailed()` | `false` |
| rows of data | 300 |
| price scale range | `[0, 206616901]` — real, computed |
| `properties().visible` | `true` |
| its pane's height | 240px |
| the live chart | **blank** |

## ⛔⛔ THE HIDDEN-TAB DIAGNOSTIC — run all three, IN THIS ORDER

⚰️ **THE PREVIOUS DIAGNOSTIC WAS `[data-name="legend-source-title"]`, AND IT IS RETIRED
BECAUSE IT LIED.** On 2026-09-10 it returned **0 on a fully rendered chart** — three panes
drawn, candles on screen, live legend text — and a confident "the tab is hidden" was reported
off it twice before a control caught it. TradingView moved its legends to hashed CSS-module
classes (`sourcesWrapper-quatTGAC`) and that `data-name` no longer exists anywhere in the DOM.
⛔ **A stale selector and a real defect are the same reading**, which is why the control below
is not optional.

**a · CANVAS SIZES — the primary signal, and the only structural one.** Every pane canvas
should be at its real height; a canvas sitting at the HTML default **300×150** means
TradingView never sized it and that pane is unrendered.

    [...document.querySelectorAll('canvas')].map(c => c.width + 'x' + c.height)
    // rendered:   1743x372, 1743x372, 1743x186, ... (matches pane heights)
    // unrendered: 300x150

⭐ This is vendor-independent: it depends on the canvas element's own geometry, not on a class
name or a `data-name` the vendor is free to rename. Cross-check the heights against
`model().panes().map(p => p.height())` and they must agree.

**b · LEGEND WRAPPERS — the corroborating signal.**

    document.querySelectorAll('[class*="sourcesWrapper"]').length   // == pane count

Each should carry live legend text (`Vol | 32.81 M | …`). ⚠️ The substring match is
deliberate: the suffix is a build hash and WILL change again.

**c · THE CONTROL — MANDATORY, AND IT IS R6 WRITTEN INTO THIS RUNBOOK.**

    document.querySelectorAll('[data-name]').length    // must be > 0

* control **0** → the DOM is dead or the page never loaded. Neither a; nor b; means anything.
* control **> 0** and **b == 0** → **report "instrument broken", NEVER "tab hidden".** The
  selector has gone stale, exactly as the retired one did. Fix the selector, then re-measure.
* control **> 0** and b == pane count and a; shows real sizes → **the chart is rendered.**

⛔ **A search returning zero is not evidence until a positive control proves it can match.**
That rail exists because of this page.

⛔ **Do not reach for the model.** `model.fullUpdate()`, `pane.setStretchFactor()` and
`chartModel.setPaneHeight()` all talk to the model, and the model was never wrong. They will
change the numbers you are looking at and change nothing on screen.

⛔ **Do not remove and re-add the study.** It is the natural thing to try, it *looks* like the
right move, and the fresh pane is equally widget-less. It cost an hour.

✅ `chartWidget._adjustSize()`. The panes then redistribute by stretch factor and everything
renders. The proof it worked: `TradingViewApi.takeClientScreenshot()` goes from composing an
873px-wide image to the real full-width one.

### ⛔⛔ …NOR A PANE WHOSE STUDY WAS *ADDED* HIDDEN (2026-09-11) — and the data is fine anyway

**Measured this visit, and it contradicts the ✅ above.** `UCTPROBE_R11_TIME_SESSION`
was added through the proven editor route on a tab with
`document.visibilityState === 'hidden'`. It computed perfectly — 400 bars, status 2,
6 plots, and the whole item-7 Q3 reading came out of it. Its PANE never got a widget:

    model().panes().map(p => p.height())
      before _adjustSize() : [122, 61 x10, 59, 0]      13 panes, the last is ours
      after  _adjustSize() : [113, 57 x10, 52, 0]      the other 12 redistributed
    [class*="sourcesWrapper"].length : 12  (== 13 panes - 1)

`_adjustSize()` returned without error and visibly *did something* — every other pane
shrank to make room — and still left ours at zero. So the ✅ above is narrower than it
reads: it recovers a pane whose widget EXISTS and is mis-sized. It does not conjure one
for a study added while the tab was hidden.

⚠️ **The honest bound: the tab was hidden at the time of the `_adjustSize()` call too.**
This does not prove the remedy fails on a tab that has since become visible — only that
calling it from the same hidden state does not help. Do not record it as refuted.

⭐⭐ **AND THE PART THAT MATTERS MOST: THE DATA IS UNAFFECTED.** Every reading this
project takes comes from the MODEL — `dataLength()`, `status()`, `_study.data()` — and
all of it was correct off a zero-height pane. The hidden-tab hazard at the top of this
file is about what RENDERS; it costs a screenshot and the visual-conformance lane, not a
capture. A hidden tab is a read-only visit for the *Indicators dialog*, but it can still
ADD a study and READ it, which is what item 7's answer was taken from.

⛔ So the running order stands: do not add on an UNPAINTED tab (canvases at the 300x150
default), but a painted tab that is merely `hidden` will give you correct numbers and a
dead pane. Budget for the dead pane; do not re-add chasing it.

### ⛔⛔ …BUT `_adjustSize()` DOES NOT SAVE A CHART THAT *LOADED* HIDDEN (2026-09-09)

> ⚠️ **ANNOTATION 2026-09-10 — THIS ENTRY'S CAUSE IS UNVERIFIED, AND THE ENTRY IS LEFT
> STANDING DELIBERATELY.** Every "legend nodes 0" reading below came from
> `[data-name="legend-source-title"]`, the diagnostic retired above for false-positiving on a
> rendered chart. So "legends stay at 0" may have measured a stale selector rather than a
> missing pane widget, and the conclusion that `_adjustSize()` cannot repair a
> loaded-hidden chart **has not been reproduced with a working instrument**.
> ⛔ It is annotated rather than rewritten because the observations may still be sound — a
> blank screenshot is not a selector artifact — and deleting a record because one of its
> instruments is suspect would destroy the evidence needed to re-test it. Re-measure with the
> three-part diagnostic before relying on this entry, and record the result here.

The rule above covers a study added to an **already-rendered** chart. It does **not** cover
opening the chart itself in a hidden tab, and the difference is total:

| | study added while hidden | whole chart loaded while hidden |
|---|---|---|
| pane widgets | missing for that study | **missing for everything** |
| `_adjustSize()` | ✅ rebuilds them | ❌ **legends stay at 0** |
| screenshot | that pane blank | **every pane blank** |

Measured on 2026-09-09: `document.visibilityState === 'hidden'`, three panes in the model,
`_adjustSize()` called and returning cleanly, legend nodes **0 before and 0 after**, and a
screenshot showing three empty boxes. `document.hasFocus()` was `true` the whole time — a
window can be focused and still occluded or minimised, so **`hasFocus()` is not a substitute
for `visibilityState`**.

⭐⭐ **AND IT DID NOT MATTER, WHICH IS THE MORE USEFUL HALF.** The hidden-tab defect is a
**rendering** defect. The model was never affected: `UCTPROBE_NS` held **400 computed rows**
and `Uncharted Clouds` another 400, with **zero** legend nodes on screen. Every plotted value
was readable the whole time.

⛔ **So pick the instrument by what the question needs:**

- **A VALUE capture is immune.** Read `study._data._items` — it is populated whether or not a
  single pixel was ever drawn. Every barstate, fold and containment probe is a value capture.
- **An IMAGE capture is not.** It needs pane widgets, so it needs a visible tab.

⚠️ **What a hidden tab DOES cost you is adding a study.** `chartWidget.insertStudy(...)`
returned without throwing and inserted **nothing** — the study never appeared in
`model().dataSources()`. A creation call that reports success and changes nothing is the
false-positive this repo keeps paying for, so **verify an insert by re-reading the data
sources, never by the absence of an exception**.

⛔ **Therefore: read existing studies from a hidden tab freely; add a study only from a visible
one.** If a probe needs a study that is not already on the chart, the tab must be foregrounded
first — there is no in-page remedy.

## ⛔⛔ COLUMN ORDER — `_metaInfo.plots`, NEVER `Object.keys(_metaInfo.styles)`

A study's value array is `[time, v1, v2, …]` and **`v(i+1)` is `_metaInfo.plots[i]`**. The
titles live in `_metaInfo.styles`, keyed by plot id — and **the key order of that object is not
the value order.**

⚰️ **MEASURED 2026-09-10, ON AROON.** `Object.keys(styles)` returned `["AroonDown", "AroonUp"]`;
`plots` returned `["AroonUp", "AroonDown"]` — the exact opposite. A fixture keyed off the styles
object would have committed the two series **swapped**, silently, in the file whose entire job is
to be the oracle. Both orders look equally plausible in a dump; nothing downstream can tell them
apart, because both columns are the right *kind* of number.

    // ✅ correct
    const cols = (mi.plots || []).map(p => mi.styles[p.id].title)
    // ⛔ wrong, and it looks fine
    const cols = Object.keys(mi.styles).map(k => mi.styles[k].title)

⭐ **THIS IS ENFORCED, NOT REMEMBERED.** `write_capture.py` takes `--columns` and
`--plots-order` and **refuses to write** unless they agree — and refuses if only one is given,
since one without the other is an unchecked claim.

## ⭐ READING A STUDY'S SOURCE OUT OF THE CHART (the V1 recipe, 2026-09-10)

Worked, after two failures worth keeping:

1. ⛔ **A right-click on the legend opens the legend's DISPLAY-OPTIONS menu** (Symbol title /
   Chart values / …), **not** the study menu. Wrong target, and it looks like the right one.
2. ⛔ **A programmatic `element.click()` on the More button does nothing.** TradingView listens
   for real pointer events. **DOM to LOCATE, real pointer events to CLICK.**
3. Get the button's rect, then scale viewport → screenshot coordinates.
   ⛔⛔ **RECOMPUTE `S` AT THE MOMENT OF EVERY CLICK. IT IS NOT A CONSTANT.**

       const S = screenshotWidth / window.innerWidth   // read innerWidth NOW
       click(rect.x + rect.width/2) * S, (rect.y + rect.height/2) * S)

   ⚰️ **THIS PAGE CARRIED `0.8167` AS A FIXED NUMBER FOR ONE DAY AND IT WAS WRONG BY
   LUNCHTIME.** Opening the editor panel took width off the chart: `window.innerWidth` went
   **1920 → 1431**, so the true scale went 0.8167 → **1.0** while the recorded constant stayed
   0.8167. Clicks computed from the stale value landed on the wrong controls — one of them
   opened the editor panel instead of the Indicators dialog, and the mis-click was read as
   "the dialog does not open" rather than "the arithmetic is stale". **Any panel, sidebar or
   watchlist that opens or closes changes it.** A hard-coded scale is the same defect class as
   a hand-typed count beside the list it describes.

       const row  = nsWrap.closest('[class*="legend"]')
       const more = [...row.querySelectorAll('button')]
                      .find(b => (b.getAttribute('aria-label')) === 'More')

4. `More → "Source code…"` **opens a NEW TAB** at `/pine/?id=USER;<scriptId>`. Count it as a tab
   the visit opened.
5. Read the text from Monaco's rendered lines — **sorted by CSS `top`**, because DOM order is not
   line order:

       [...document.querySelectorAll('.view-line')]
         .map(e => ({top: parseFloat(e.style.top), text: e.innerText.replace(/ /g,' ')}))
         .sort((a,b) => a.top - b.top).map(l => l.text).join('
')

⚠️ Stage a receipt (char count + FNV-1a) in the page and recompute it in the shell before
committing — and cross-check the plot count against `_metaInfo.plots`, which is a **separate
object**, so the transport is not grading its own homework.

⛔⛔ **NEVER OPEN AN ACCOUNT-SCOPED USER SCRIPT FOR WRITING.** `Script$USER;<id>` belongs to the
ACCOUNT, not the layout — copying a layout copies the *reference*. Editing it changes every
layout that uses it, including the owner's. To extend one, commit its bytes and build a **new**
study from them (see `barstate-full.pine`); never append in place.

## Screenshots

- `takeClientScreenshot()` renders **explicitly**, so it works even when the tab is hidden and
  the normal paint loop is not running. An extension screenshot of a hidden tab is blank
  because TradingView never sized its canvases — they sit at the HTML default 300×150.
- ⚠️ It **re-lays-out at its own width**. Bar spacing must therefore come from
  `timeScale().width()`, never a constant: a hard-coded 799 against a 1743px plot silently
  renders two years of history where 250 bars were asked for. The image looks perfect and is of
  the wrong thing.

## ⭐⭐ PUTTING SOURCE IN THE EDITOR WITHOUT A PASTE — the Monaco handle (2026-09-10)

The paste wall below is real, and it is **routed around**: the buffer can be written directly
through Monaco's own API, reached via the bundler registry.

    // 1. capture __webpack_require__ by pushing a sentinel chunk
    const ck = Object.keys(window).find(k => /^webpackChunk/.test(k))
    let req; window[ck].push([[Symbol('probe')], {}, r => { req = r }])

    // 2. R6 CONTROL FIRST — count visible module factories. If this is 0 the
    //    search cannot match and a miss would be meaningless. (Measured: 20,353.)
    let seen = 0; for (const c of window[ck]) if (c && c[1]) seen += Object.keys(c[1]).length

    // 3. scan factory sources, then require the candidates (11,036 modules, ~39 ms)
    //    module 423129 is the Monaco API namespace: editor, languages, KeyCode, Range, Uri
    const M = req('423129')
    M.editor.getEditors()[0].getModel().setValue(src)

⛔ **VERIFY THE BUFFER AGAINST THE COMMITTED BYTES BEFORE ANY ADD** — chars, FNV-1a, sha256.
This is what makes the mechanism trustworthy rather than merely convenient.

⚠️ The module id `423129` is a build artifact and **will change**. Re-derive it by the scan;
never hard-code it. (Same defect class as the scale constant above.)

## ⛔⛔ THE PRE-WRITE GATE — THREE READINGS, IMMEDIATELY BEFORE EACH WRITE

**Owner rule, 2026-09-12. Before `setValue`, and again before the Add click, in the
same evaluation as the write where possible:**

```
document.visibilityState === 'visible'        ⛔ hidden = STOP, never click
exactly one visible+enabled own-text "Add to chart", zero "Update on chart"
study count === 19                            (20 immediately after the add, 19 at the end)
```

⭐ **BOTH CHECKS, NOT ONE.** Visibility can change between the buffer write and the
click — another window comes forward, the operator alt-tabs — and an add on a hidden
tab reports success and inserts nothing. The gate is cheap; run it twice.

⭐ **PUT THE GATE AND THE WRITE IN ONE `javascript_exec`.** Then nothing can move
between them, and the call returns `{STOP: true, …}` instead of writing. That is what
the T1 capture did, and the returned object is the receipt that the gate was true at
the moment of the write rather than a moment earlier.

⚠️ **AND THE GATE NEEDS `height > 0`, MEASURED.** TradingView renders the button's
label TWICE — once visibly and once as a zero-height measuring copy — so a gate testing
only `width > 0 && offsetParent !== null` finds TWO "Add to chart" nodes and reports
FALSE for a perfectly good state. The button's own text also reads `"Add to chartAdd to
c…"` for the same reason. Require width, height and `offsetParent`.

## ⚰️ `placement=dialog` IS NOT "UNDOCKED" ON THIS BUILD — CORRECTED SAME DAY

The rule written this morning said *"`placement=dialog` in the Monaco model URI means
undocked = stop"*. It was derived from a detached OS window and it is **wrong for the
build the rig runs**, where the Pine editor's normal in-tab home is a right-side panel
whose models are stamped `placement%3Ddialog`. Measured 2026-09-12:

| placement | what it is | the add control |
|---|---|---|
| `dialog` | the right-hand panel **inside the chart tab** (`pine-dialog-button` in the right rail opens it) | a real **`Add to chart` TEXT button** in the editor's own toolbar |
| `bottom` | the classic bottom dock, reached by the script menu's *Move script to bottom* | **no toolbar at all** — the action lives as a text item in the tab's ⋯ context menu, and reads `Update on chart` (disabled) while the buffer matches a study already on the chart |

⛔ **So the discriminator is not the placement label. It is: can this session READ the
editor's DOM in this tab, and is there a visible, enabled own-text `Add to chart`?** A
detached OS window fails the first half — its DOM is unreachable from the chart tab even
though its Monaco models are visible — and that is the state the original rule was
reaching for.

## ⭐ CREATE NEW → INDICATOR, WHERE THE MENUS ACTUALLY ARE

- The **script-title chevron** (`∿ Untitled script ⌄`) opens the menu with **Create new ▸**.
  In the bottom placement the same chevron opens a DIFFERENT menu (Save · Rename ·
  Version history · Move script to right · Update on chart · Close tab) with no Create
  new — so unbinding is a right-panel action.
- The submenu (Indicator · Strategy · Library · Built-in…) **populated on a synthetic
  hover** on 2026-09-12, first try. The 2026-09-11 note that it "does not render under a
  synthetic hover" was measuring the coordinate-space bug, not the menu.
- A fresh Indicator gives a new `file:///<uuid>.pine` model, the 183-byte default
  template, and flips the toolbar control from the icon-with-tooltip to a text
  `Add to chart`.

## ⛔⛔ BAR 0 IS NOT REACHABLE ON A LONG-HISTORY SYMBOL — CHANGE THE SYMBOL

**A study's output buffer never starts at `bar_index == 0` on SPY**, whatever the range
button says. Measured three ways on 2026-09-12: 1,829 output rows starting 2019 with
`is_first_bar` 0 on every one; the same probe without `max_bars_back` giving 415 rows
starting 2025, still 0; and the `All` range switching the chart to **1M** (405 bars) and
producing no study output at all. TradingView computes from further back than it
returns, so the first computed bar is never in the readable window.

⭐ **THE INSTRUMENT IS THE SYMBOL.** Pick one whose ENTIRE history fits inside the
window — `NASDAQ:CRWV` listed 2025-03-28, 366 daily bars — and the study's first output
row IS bar 0, with the discriminator firing on it. Same move `r11-nvi` made when it read
SPY's 1993 seed on a monthly chart. Restore the symbol afterwards and say so in the
fixture.

⚠️ **AND A `max_bars_back` DECLARATION IS SPENT AS WARM-UP.** `max_bars_back = 500` on a
405-bar series produced NOTHING; on a long series it pushed the first output row past
the bar the probe existed to read. Declare it only when the script genuinely needs the
history, and never in a probe whose subject is bar 0.

## ⚠️ THE `All` RANGE BUTTON CHANGES THE RESOLUTION

`All` is "all data in 1 month intervals" — it switched the chart from `1D` to `1M`. The
range buttons are range+interval pairs, not zoom. Restore with `setResolution('1D')` and
assert the read-back, per the J2 discipline above.

---

## ⛔⛔ THE BINDING GATE, CORRECTED — OWN TEXT ONLY, TOOLTIPS EXCLUDED

**Rule (owner-adopted, 2026-09-12): the gate is TRUE when exactly one VISIBLE, ENABLED
element has OWN TEXT exactly `Add to chart`, and no element has own text `Update on
chart`. Zero matches means the editor is not docked. Any own-text `Update on chart`
means it is bound. Both are stop states for the Add click.**

```js
const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3)
  .map((n) => n.textContent.trim()).join(' ').trim()
```

⚰️ **WHY THE OLD ONE WAS WRONG, MEASURED.** The runbook's query mapped
`title || textContent` over every button. In the detached editor that matched a
**34×34 icon with no text at all**, `title="Update on chart"`, `disabled: true` — so the
gate reported BOUND for a control nobody could click, and it would have reported bound
just as confidently on an editor that was perfectly safe. A tooltip is not a state.

⛔ **AND `placement=dialog` IN THE MONACO MODEL URI MEANS UNDOCKED — STOP.**

```
file:///1b62e8e0-…-1213efe0a372.pine?placement%3Ddialog     ← detached, do not add
```

Read it from the model, never from the layout: the detached editor renders as its own OS
window whose DOM this session cannot reach, while its Monaco model is still visible from
the chart tab. That asymmetry is what made "the editor is open" and "the editor is here"
look identical.

## ⭐ PHASE 1 — THE DOCKING LADDER, in order

1. Screenshot the tab. Read: bottom panel present? Pine Editor tab selected? Monaco
   `placement`? study count?
2. **Panel collapsed** (chart runs to the bottom toolbar): the Pine Editor launcher is
   `[data-name="pine-dialog-button"]` in the bottom bar — locate it by SCREENSHOT and
   click, then screenshot again.
3. **Panel visible, wrong tab**: click the Pine Editor tab.
4. **Panel says the editor is in another window**: click its dock control.
5. **Still `placement=dialog`**: reload the layout URL ONCE, wait for all studies,
   re-assert the count, and start again from 1.
6. **Unbind**: script-name chevron → hover *Create new* → *Indicator*. Verify all three:
   the buffer is the ~5-line default template, the name reads *Untitled script*, and the
   corrected gate is TRUE.

## ⛔⛔ AN OCCLUDED WINDOW READS `hidden` WITH PERFECTLY HEALTHY DIMENSIONS

**Measured 2026-09-12, and it is a DIFFERENT failure from the minimised one this page
already records.**

```
visibilityState  "hidden"          ⛔ the gate that matters
document.hidden  true
hasFocus()       true              ← after a synthetic click, so focus proves nothing
innerWidth/H     1920 x 855        ← healthy
screen           1920 x 1080       ← healthy
studies          19, fully painted in the screenshot
```

⚰️ The 2026-09-11 incident was a MINIMISED window: every dimension zero, including
`screen.width`. This is a window fully covered by another application. The published
pre-flight (`{vis, w, h}`) cannot tell them apart — the dimensions are fine here — so
**`visibilityState` is the gate and the dimensions are only the diagnosis.**

⛔ **THREE MECHANICAL ATTEMPTS CLEARED IT; NONE WORKED**, and they are recorded so the
next session does not spend them again: a synthetic click into the page (focus flipped to
`true`, visibility unchanged), `resize_window` (reported success, `innerWidth` unchanged,
visibility unchanged), and creating a second tab in the same window (the chart tab simply
became a background tab as well). Occlusion is an OS-level fact about which window is on
top; nothing inside the page can change it.

⭐ **THE DURABLE FIX IS A RIG SETTING, NOT A SESSION ACTION.** Chrome's occlusion
tracking is what marks a covered window hidden:

- `chrome://flags/#calculate-window-occlusion` → **Disabled**, or launch with
  `--disable-backgrounding-occluded-windows`, and the capture window keeps reporting
  `visible` while the operator works in another app.
- Otherwise the window must be genuinely unobscured — a second monitor, or a terminal
  that does not cover it. **Partial visibility is enough**; it does not need focus.

⛔ Until one of those holds, an ADD must not be attempted: `insertStudy` reports success
on a hidden tab and inserts nothing, and a pane added hidden is not rescued by
`_adjustSize()`. Reads are unaffected and stay allowed — study count, Monaco model, DOM
state and screenshots were all correct throughout.

---

## ⛔⛔ THE BINDING HAZARD — "Update on chart" IS NOT "Add to chart"

**Opening a study's source via legend → More → "Source code…" BINDS the editor to that
study's script.** The action button then reads **"Update on chart"**, and clicking it
**edits the bound study in place** instead of adding a new one.

⚰️ **MEASURED, TWICE, ON 2026-09-10.** With the editor bound to `Script$USER;787899e2…`:
- First Update **replaced `UCTPROBE_NS` with `UCTPROBE_FOLD`** — the data-source count stayed
  at 12 and NS vanished from the roster. The new study carried **NS's own script id**.
- Second Update did not apply the buffer at all; the slot **reverted to the script's SAVED
  content** ("UCT marker parity probe", 1 plot, 0 data items).

⭐ **THE REVERT IS THE REASSURING PART**: it proves the *saved* script was never modified.
"Save script" was never clicked. Only the chart's in-memory instance ever changed.

⚰️⚰️ **AND `787899e2…` IS NOT A SAVED SCRIPT AT ALL — CORRECTED 2026-09-10.** The block above
treats it as an account-scoped script whose saved content is "UCT marker parity probe". It is
not. `pine-facade` `GET .../USER;787899e2…/last` returns **404**, while the same call returns
200 with real names and source for two known-good ids (the positive control that makes the 404
mean something), and the account's saved list does not contain it either. **It is TradingView's
shared UNSAVED-BUFFER slot**: every unsaved script added to a chart is stamped with that same
id, with a slot revision that ticks (`0.30` → `0.31` observed across two unrelated buffers in
one session). "UCT marker parity probe" is itself a failed one-plot stub sitting on that slot.

⭐ **SO THE REVERT WAS THE SLOT SHOWING A STUB, NOT A SAVED SCRIPT'S CONTENT — and the
conclusion still holds, harder.** Nothing of the owner's was written, because at that id there
was no saved script to write to. ⛔ What this changes is the ASSERTION: `id != 787899e2…` means
**"genuinely saved"**, not "not the owner's". Two different probes riding the unsaved slot are
indistinguishable from each other by id, so that check cannot tell you whose script you are
about to edit — only that you are not on the shared slot.

✅ **ASSERT THE BUTTON TEXT BEFORE EVERY CLICK.** `Add to chart` = safe, adds a study.
`Update on chart` = **do not click** — it writes to whatever script the editor is bound to,
and if that is an account-scoped `Script$USER;…` it is the owner's, in every layout.

⛔⛔ **AND SWAPPING THE MONACO MODEL DOES NOT UNBIND IT.** `editor.createModel(src,'pine_v6')`
+ `editor.setModel(m)` swaps the buffer (uri goes `file:///…` → `inmemory://model/4`) and the
button **still reads "Update on chart"**. TradingView holds the binding in its own state, not
in the Monaco model. Measured 2026-09-10.

⭐⭐ **THE UNBIND IS A UI ACTION AND IT IS NOT A HUMAN ONE — CORRECTED 2026-09-10.** This read
*"there is no API route to it that this programme has found. So a NEW study from a NEW script
still needs one human action."* The first sentence is still true; the conclusion was not.
**script-title dropdown → Create new → Indicator is three ordinary pointer clicks and was
driven end to end by an agent**, four times in one session. It yields a fresh Monaco model (a
new `file:///<uuid>.pine` uri) whose action button reads **"Add to chart"**, never *"Update on
chart"*. ⛔ Needing the UI is not the same as needing a person, and writing it down as the
latter parked a whole capture programme behind a wall that was not there.

## ⚰️ THE PASTE WALL — four mechanisms that do NOT work, and why they are still worth knowing

⛔⛔ **THIS SECTION WAS TITLED "A CUSTOM SCRIPT REACHES A CHART ONLY BY A HUMAN PASTE" AND OPENED
"Nothing an agent can drive puts Pine source into the editor." BOTH ARE FALSE**, and the section
immediately above this one — the Monaco handle — already contradicted them on the same day. A
document that states a wall and its own route around it, in that order, teaches whichever half
the reader stops at. `model.setValue()` put committed source into the editor four times on
2026-09-10, byte-verified by sha256 each time.

⭐ **KEPT, BECAUSE THE NEGATIVE RESULTS ARE THE VALUABLE PART.** Each mechanism below fails for
its own reason, and knowing which ones are dead stops the next agent re-deriving them. Measured
2026-09-10 by exhausting every mechanism available, with Monaco focus asserted before each
attempt (`document.activeElement` inside `.monaco-editor`):

- **Synthetic `ClipboardEvent('paste')` with a `DataTransfer`** — Monaco ignores it; buffer
  unchanged across three dispatches.
- **`textarea.inputarea.value = src` + synthetic `InputEvent`** — ignored; Monaco does not read
  the input area on a synthesised event.
- **Real keystrokes via the computer tool** — they do not reach the editor. They land on the
  CHART, whose type-to-search opened symbol search and set the symbol to
  `PLOT(TIMEFRAME.ISWEEKLY ? 1 : 0`. ⛔ Assert Monaco focus before *any* keystroke.
- **Clipboard write + synthesised `ctrl+v`** — the clipboard held the bytes and the paste still
  did not land. **CDP-synthesised key events do not trigger a native clipboard paste.**

⛔⛔ **AND THE OBVIOUS GATE DOES NOT WORK.** A `navigator.clipboard` `writeText` → `readText`
round-trip **passes** while the paste fails — it measures *clipboard API access*, nothing more.
(It does fail for its own reason when `document.hasFocus()` is false: `writeText` hangs, and an
unguarded call froze the renderer for 45 s. Guard it with `Promise.race`. But passing it proves
nothing about pasting.) ⚠️ A gate that cannot fail for the reason you care about is worse than
no gate: it converts "blocked" into "ready".

⚰️ **THIS CONCLUDED "SO THE ONLY ROUTE IS A HUMAN PASTE, ONCE, PER SCRIPT." IT IS NOT.** The
Monaco handle is the route, and the four probes of 2026-09-10 were saved and added with no paste
and no person. What survives is the second half, which was always the useful part: reading values,
rosters and source back out needs nothing but the chart model.

⚰️⚰️ **AND THE OTHER HALF -- "a script saved under a known name is addable by id with
`createStudy`" -- IS MEASURED FALSE (2026-09-10 evening).** It was written as a forecast on the
day the editor route worked, never as a measurement, and the NEXT VISIT'S WHOLE PLAN RESTS ON IT
("every future visit is `createStudy`-by-id with no editor at all"). It does not work. Seven
variants, each with the roster checked after:

| tried | answer |
|---|---|
| `createStudy('Script$USER;<id>@tv-scripting', false, false)` | rejects: `unexpected study id:script$user;<id>@tv-scripting` (it lowercases and validates against built-ins) |
| same, after `studyMetaIntoRepository(meta)` | same rejection; that method's arity is 0 and it changed nothing |
| `createStudy(<translate metaInfo>.id, …, {text, pineId, pineVersion})` | same rejection on the `@tv-scripting-101` form |
| `insertStudyWithoutCheck(id, false, false, inputs)` | `Cannot read properties of undefined (reading 'indexOf')` -- different argument shape |
| `chartWidget.insertStudy(meta, inputs)` | returns a promise that neither resolves a study nor rejects; roster unchanged |
| `model.createStudyInserter({metaInfo, inputs})` | rejects `cannot_get_metainfo` -- it resolves metaInfo itself, it does not accept yours |
| `model.createStudyInserter({type:'pine', pineId, pineVersion})` + `insert()` | gets PAST metaInfo, then dies in `_canApplyStudyToParent` reading `.length` of undefined; with `setParentSources([mainSeries])` it answers `cannot_be_child` |

⭐⭐ **THE HUNT ALSO PRODUCED A MECHANISM THAT DOES WORK, AND IT IS BETTER THAN WHAT IT
REPLACES FOR ONE JOB.** `GET pine-facade/translate/<id>/last` returns
`{IL, ilTemplate, metaInfo}` for a saved script, and **`metaInfo.plots.length` is the vendor's
own plot roster -- so a saved probe's roster can be verified against the committed source
WITHOUT ADDING THE STUDY TO ANY CHART.** Confirmed on UCTPROBE_GB_HILO: 11, equal to the
balanced-paren scan of the committed file. `GET pine-facade/get/<id>/last` likewise returns
`scriptName` + `source` for the byte check. ⚠️ Compare `source` by CHARACTERS, not file bytes --
these probes are full of multi-byte marks, so `groupb-hilo-default.pine` is 3810 bytes on disk
and 3557 characters stored.

### ✅ THE ROUTE THAT WORKS, PROVEN ON THREE PROBES (2026-09-11)

**S1-S5, by pointer click, on a tab that was never visible.** In order:

1. **Assert the action button FIRST, before touching the buffer.** Exactly one
   `"Add to chart"` and zero `"Update on chart"`. ⛔ This is not ceremony — it fired
   for real: after `UCTPROBE_GB_HILO` was added, the button read *"Update on chart"*,
   and a `setValue` + click there would have edited that SAVED script in place.
2. **`setValue` through the Monaco handle**, re-derived by webpack scan each visit
   (module `423129` today; the id is a build artifact). Pass the source as base64 and
   decode in the page — a gzip round-trip corrupted one attempt, plain base64 has not.
3. **Verify the buffer receipt**: sha256 of `model.getValue()` == sha256 of the
   committed file. Byte-exact, before the click, every time.
4. **Click "Add to chart"**, then gate the study on `isFailed() === false` AND a plot
   count equal to the balanced-paren scan of the committed source.
5. ⛔⛔ **EVERY ADD BINDS THE EDITOR — INCLUDING TO AN UNSAVED "Untitled script".**
   Measured directly: before an add the button reads *"Add to chart"*; after it reads
   *"Update on chart"*. So each subsequent probe needs an unbind first:
   **script-title dropdown → hover *Create new* → *Indicator*.** The submenu populates
   on HOVER, not on click — a click alone leaves a zero-height menu container and
   looks like a broken route.

⚠️ **A HIDDEN TAB CAN DO ALL OF THAT, AND CANNOT DO THE INDICATORS DIALOG.** The
editor's own menus render fine with `document.visibilityState === 'hidden'`. The
**Indicators → PERSONAL → My scripts** route does not: the sidebar click REGISTERS
(the item gains its `active-` class), and the script list never renders — its content
container sat at one child and zero text for 12 seconds. That route is not refuted,
it is **untested**, and it needs a visible tab to test. Do not record it as broken.

⭐ **AND THERE IS A PRE-ADD COMPILE GATE FOR A SAVED SCRIPT.**
`GET pine-facade/translate/<id>/last` answers `success: false` for a script that will
not compile, and its `metaInfo.plots` is the roster — so for a SAVED probe you can
know both BEFORE spending an add. ⛔ It does not help an unsaved buffer, which is
exactly where the cost lands: `groupb-round-max-vwap.pine` compiled locally in nobody's
head, failed at the vendor with `CE10041`, and landed as a one-plot stub named after
the shared unsaved slot rather than after the script.

⛔ **WHAT DOES NOT FOLLOW: that the roster check replaces the capture.** A roster is the
script's shape; the READINGS still need the study on a chart, because the values are what the
probe exists for. The editor route (S1-S5, Monaco handle, "Add to chart") remains the only
proven way to put one there, and it carries THE BINDING HAZARD -- assert the action button's
`title` before every click.

⚠️ Verify a pasted buffer against the committed bytes BEFORE "Add to chart" — chars + FNV-1a,
then sha256. A partial paste is real: one attempt left `fold-pass` concatenated with a stray NS
fragment (1614 chars against a committed 628), and only the receipt caught it.

## ⛔⛔ THE DOM AND THE `computer` TOOL ARE DIFFERENT COORDINATE SPACES — locate by SCREENSHOT

**Rule, 2026-09-11/12 (T1): whenever a click goes through the `computer` tool, find the
target in a SCREENSHOT. Never compute it from `getBoundingClientRect()`.**

Measured on the TradingView chart page, same element, same moment:

```
getBoundingClientRect()  ->  (1146, 291)        "Create new" in the script-title menu
visible in the 1568x698 click frame at  (850, 238)
```

~26% apart on x. ⛔ **And a click computed from the DOM lands in empty space and returns
`"Clicked at …"` exactly as if it had worked** — a silent miss with a success message,
which is the worst shape a browser step can have. Two of the three failed interactions in
that visit were this, not the menu.

⭐ The DOM is still right for READING state — `si.dataLength()`, `si.status()`,
`metaInfo().plots`, the button label, the editor title. It is the CLICK frame that
disagrees. So: read with `javascript_tool`, aim with a screenshot, and after any click
that is supposed to change state, **re-read the state** rather than trusting the return
string.

⚠️ A corollary that cost a cycle: a submenu that needs a hover (script title → *Create
new* ▸ → *Indicator*) does not render under a synthetic hover even with the pointer
confirmed on the row. Two attempts, both clean misses. That route needs a real pointer.

---

## ⛔⛔ FOUR THINGS THAT LOOK LIKE SUCCESS AND ARE NOT (2026-09-10)

Each of these was hit in one session. Every one of them is silent.

**1. A FAILED STUDY KEEPS A ONE-PLOT STUB, AND ITS ROSTER READS FINE.** A study whose script
fails to COMPILE still lands on the chart and still answers `metaInfo()` — with a single plot
titled `"Plot"`, the shared placeholder digest `0366beecad3fa344b185adf5e6ac9b35f5419485`, and
an **empty `_data._items`**. Read a roster off that and you record a study that never evaluated
as though it had answered. ✅ **Gate every capture on `isFailed() === false` AND a plot count
equal to the committed source's.** The compile error itself is readable at
`status().errorDescription.editorError` — code, message, line and column.

**2. WHAT THE VENDOR STORES IS NOT BYTE-EQUAL TO THE COMMITTED FILE.** TradingView stores Pine
source with **CRLF** line endings; the repo's files are LF. A naive
`sha256(committed) == sha256(stored)` comparison therefore **fails on every script** and means
nothing. ✅ Normalise first, and allow the trailing newline to be absent:

    stored == committed.replace('\n', '\r\n')
    stored == committed.rstrip('\n').replace('\n', '\r\n')

Anything else is real content drift and the capture must be refused. (The deltas look like an
injected header — +13, +125, +31, +139 chars, not a constant — because they are
`(number of line breaks) − (1 if the trailing newline was dropped)`.)

**3. DERIVE A PLOT ROSTER WITH A BALANCED-PAREN SCAN, NEVER A REGEX.**
`plot(str.contains(a, b) ? 1 : 0, "name")` carries commas inside its first argument, so the
obvious `plot\(...,\s*"([^"]+)"` pattern silently drops it. On `exchange-spelling.pine` that
returned **11 names for a 12-plot file** — short by one, and plausible. ⛔ This is the THIRD
regex under-count in two days (the others: a `_metaInfo` roster read from style-key order, and a
grep that returned 0 for a string present 5,664 times). **Write that down and stop reaching for
a regex over source.**

**4. THE ACTION BUTTON IS ICON-ONLY IN SOME STATES, AND ITS x MOVES.** In a narrow editor pane
the control has no text at all, so a scan over leaf nodes for `"Add to chart"` finds **nothing**
— which reads exactly like *"no action button is present"* and is how one attempt was lost. Its
`title` attribute is still `"Add to chart"`. ✅ **Assert it by attribute, and re-measure its
position every single time**: it was at x = 962, 998, 1038 and 1089 within one session on an
unchanged viewport, because the script name beside it changes width. A coordinate cached from
the previous probe lands on a different control. (Same defect class as the scale constant.)

⚠️ **AND A CLICK THAT RETURNS CLEANLY IS NOT A SAVE.** Two clicks on the toolbar's Save icon, at
its correctly-measured position, left the vendor's stored source and `updated` stamp untouched;
the same action from the script-title dropdown saved within 500 ms. The cause was not isolated.
✅ **Confirm a save by re-reading the stored source and its `updated` timestamp from
`pine-facade`** — never by the click succeeding, and never by the status line. Both clicks
looked exactly like success.

## ⛔⛔ THE RENDERER FREEZE — what wedges it, and the discipline that avoids it

**2026-09-11.** The previous visit ended with a dead renderer: two consecutive
`Runtime.evaluate` calls timed out at 45 s, 45 seconds apart, during the
`setResolution('5')` a sixth capture needed, and the page reloaded under the visit
(tab `603418943` → `603419102`). This visit found the same tab still wedged — a
`Runtime.evaluate` timed out again, and `takeScreenshot` failed with *"Chrome
blocked the extension from accessing this page"*. **One navigate to the same
layout URL brought it back**, tab id unchanged, everything intact.

### ⭐⭐ THE LIKELY CAUSE, AND IT IS A THING WE WERE DOING

**A long-running `await` loop inside a single `Runtime.evaluate` is a 45-second
bomb.** Reproduced deliberately this visit: a poll written as
`while (Date.now() - t0 < 40000) { await sleep(1500); ... }` — a perfectly
ordinary "wait for the studies to load" — came back as
`CDP sendCommand "Runtime.evaluate" timed out after 45000ms`, because the call's
own budget is 45 s and the loop was built to spend 40 of them before returning.

⛔ **POLL FROM OUTSIDE, IN CHEAP CALLS.** One tiny evaluate that reads the
current state and returns immediately, repeated, is safe. One evaluate that waits
is not — and when it times out you cannot tell "the page is busy" from "the page
is dead", which is exactly the ambiguity the last visit ended on.

⚠️ An `async` IIFE is a second way to lose: `(async () => {...})()` returns a
**Promise**, and the tool renders it as `{}` — a silent empty answer rather than an
error. Use a top-level `await`.

### ⭐ THE ORDER, WHEN CHANGING RESOLUTION (the J2 discipline)

1. **Assert first, touch nothing.** Read `symbol()`, `resolution()`, the study
   roster and the `__uct*` globals BEFORE any mutation — a chart mid-switch has no
   trustworthy state to restore to, which is why the last visit could not say
   whether it left the chart on 1D or 5m.
2. **Set, then assert the set took**, rather than assuming the call that returned
   did what it said.
3. **Then wait for data** — from outside, per the rule above — before touching
   anything else. A study with no rows yet is not a study that failed.

⚰️ **CORRECTED 2026-09-12 — THIS SAID THE RESOLUTION SURVIVED AND IT DID NOT.**
The next visit found the chart on **`5`**, so the interrupted `setResolution('5')` of
2026-09-11 DID persist. The reasoning below is still right — the two outcomes are
indistinguishable without reading, which is why recording it beat assuming — but the
ANSWER it recorded was wrong, and a ✅ on a wrong answer is worse than no note.
The superseded text:

✅ **And the resolution DID survive**: found `1D`, which is what the visit before
last left. A `setResolution` interrupted by a reload does not persist, so the
worry the last visit recorded turned out to be unfounded — but it was right to
record it rather than assume, because the two outcomes are indistinguishable
without reading.

### ⛔⛔ THE ACCESSOR THAT REPORTS ZERO WHEN IT CANNOT READ

The study wrapper `getStudyById()` returns is **not** the object with `_data`.
Reading `si._data._items.length` inside a `try` yields **0 for every study** — not
an error, a zero — so thirteen healthy studies read as "nothing loaded". The
instrument reported its own blindness as a measurement
(`lesson_a_saturated_instrument_reports_zero`).

⭐ **The handles that actually answer:**

    si.dataLength()          // rows; 400 on a loaded daily probe
    si.status()              // {type: 2} computing//ok, {type: 3} + errorDescription on a compile failure
    si._study.metaInfo().plots   // plot ids, IN ORDER — plot_0 .. plot_N
    si._study.data().last()      // {index, value: [time, plot_0, plot_1, ...]}

⚠️ `value[0]` is the BAR TIME; the plots start at `value[1]`. So plot *k* is
`value[1 + k]`, and the NAME of plot *k* comes from the committed source's
balanced-paren roster, never from `Object.keys(styles)`.

✅ **A compile failure is visible and specific**: `status().type === 3` carries
`errorDescription.error` (e.g. *Undeclared identifier "{identifier}"*) and
`.title` *"Compilation error"* — a better gate than `isFailed()`, which was not
present on this wrapper at all.

### ⚠️ A HIDDEN TAB STILL ANSWERS READS

`document.visibilityState` was `'hidden'` throughout this visit and every read
above worked. The hidden-tab rule at the top of this file is about **adding a
study**, not about reading one — do not let a hidden tab stop you collecting a
timeline row.

## Moving data out

`fetch` to a localhost sink is **dead** — tradingview.com's CSP `connect-src` stops the request
before it is made, `sendBeacon` returns `true` and never arrives, and a listening local server
logs nothing, so the sink looks broken when it is fine. Blob downloads are **dead** — a
programmatic click is not a user activation and is dropped silently.

The transport is the clipboard, and **the payload carries a receipt**: the page reports its
exact character count and an FNV-1a hash, the shell recomputes both, and nothing is written
unless they match. The clipboard is a machine-wide resource and this box runs concurrent
sessions.

⚠️ The hash is not decoration. It caught a payload that came back the **right length with the
wrong content**: PowerShell encodes console output as cp1252, so an em dash in a note field
arrived as a replacement character. A length check cannot see that.

## Leaving the chart as you found it

Record `getSymbol()`, `getResolution()`, every pane's `stretchFactor()` and every study's
`visible` **before** touching anything, and put them all back afterwards. Delete every injected
DOM node and every `__uct*` global.

⚠️ The browser is shared. Another session's unsaved Pine editor buffer is not yours to touch,
and a chart left on the wrong symbol is a bug report from someone who did not know you were
there.
