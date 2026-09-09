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

⭐ **The one diagnostic that finds it** is the legend:
`document.querySelectorAll('[data-name="legend-source-title"]')` comes back **empty** for that
study while other panes have one. Nothing in the study's own state can tell you, because the
study is not what is broken.

⛔ **Do not reach for the model.** `model.fullUpdate()`, `pane.setStretchFactor()` and
`chartModel.setPaneHeight()` all talk to the model, and the model was never wrong. They will
change the numbers you are looking at and change nothing on screen.

⛔ **Do not remove and re-add the study.** It is the natural thing to try, it *looks* like the
right move, and the fresh pane is equally widget-less. It cost an hour.

✅ `chartWidget._adjustSize()`. The panes then redistribute by stretch factor and everything
renders. The proof it worked: `TradingViewApi.takeClientScreenshot()` goes from composing an
873px-wide image to the real full-width one.

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
