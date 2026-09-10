# Capture procedure — driving a live TradingView chart

The rules for taking a vendor capture. The mechanics live in
`tools/visual_conformance/README.md`; this page is the **procedure**, and it exists because
every rule below was learned by losing time to it.

---

## ⛔⛔ NEVER ADD A STUDY WHILE THE TAB IS HIDDEN

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
3. Get the button's rect, then scale viewport → screenshot coordinates:
   `S = screenshotWidth / window.innerWidth` (1568 / 1920 = **0.8167** here), click `(x*S, y*S)`.

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
