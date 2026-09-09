# Visual conformance — capturing what TradingView actually draws

Part 2 of the indicator build order. The renderer is measured against **TradingView's own
numbers and pixels**, not against our recomputation of them, so every reference here is
captured from a live chart and nothing in it is derived by us.

Contents:

| File | What it is |
|---|---|
| `capture_page.js` | The browser-side instrument: reads the chart model, emits CSV + metadata, stages it for copy |
| `verify_clipboard.py` | The shell-side half: reads the clipboard, checks length + hash, writes the fixture |
| `sets.json` | The four reference sets (A–D) and what each one is for |

Captures land in `tests/fixtures/vendor/reference/<set>/`.

---

## 1. ⭐⭐ The chart answers in NUMBERS, not pixels

The whole capture rests on one thing: a live TradingView chart exposes its full model on
`window`, and a study's per-bar plot values can be read straight out of it.

```js
const cw     = window._exposed_chartWidgetCollection.activeChartWidget.value()
const src    = cw.model().model()
const series = src.mainSeries()
series.bars()._items      // [{index, value: [time, o, h, l, c, volume]}]
src.allStudies()          // each with ._data._items → [{index, value: [time, ...plots]}]
```

This matters more than it looks. The previous protocol in this repo exported values through
the chart's **Table view → Download data** UI. That path gives you the visible columns; the
model gives you **every plot the study computes**, including ones the chart is not drawing —
and §4 below is a measured case where that distinction changed the answer.

⚠️ `series.data()` does **not** exist; it is `series.bars()`. `cw.resolution()` does not
exist either; it is `series.interval()`. Rows with `index <= -1000000` are padding sentinels
and must be filtered out before anything is counted.

## 2. ⛔ Getting the data OUT — three routes, two of them dead

Recorded because each dead end cost real time and none of them fails loudly.

| Route | Verdict |
|---|---|
| **`fetch` to a localhost sink** | ⛔ **DEAD.** tradingview.com's CSP `connect-src` blocks it. `fetch` rejects with an opaque `TypeError: Failed to fetch`, the preflight never leaves the browser, and a listening local server logs *nothing* — so the sink looks broken when it is fine. `sendBeacon` returns `true` and also never arrives. Adding CORS and `Access-Control-Allow-Private-Network` does not help; the request is stopped before it is made. A receiver was written, tested, and deleted rather than shipped, because a tool that cannot work against the target page reads as a capability. |
| **Blob download** (`URL.createObjectURL` + `a.click()`) | ⛔ **DEAD here.** A programmatic click is not a user activation, so the download is dropped silently — no file, no error, no download bar. Wiring it to a real injected button and clicking that with the `computer` tool *does* fire, and still produced no file on this machine (Chrome's profile is not at the standard `AppData\Local\Google\Chrome\User Data` path, so its download directory was not determinable). |
| **Clipboard, hash-verified** | ✅ **WORKS.** This is the repo's established transport, and §3 closes the one hazard it had. |

## 3. The clipboard hazard, and how it is closed

The prior vendor-capture report documents the failure honestly: **the OS clipboard is a single
machine-wide resource**, this box routinely runs more than one agent session, and a concurrent
session overwrote the clipboard mid-capture — producing a paste that silently landed as a
no-op. A silent no-op is the worst possible failure for a capture, because the file still gets
written and every later number is quietly about the wrong thing.

**So the payload carries its own receipt.** Before copying, the page reports the exact
character count and an FNV-1a hash of the staged text. After reading, the shell recomputes
both. A stomped or truncated clipboard cannot match, and nothing is written unless it does.

```
browser:  { chars: 18622, fnv1a: 1313922158 }     ← staged and selected
shell:    chars=18622 fnv1a=1313922158  MATCH     ← written
```

⚠️ Normalise `\r\n` → `\n` before hashing — Windows hands back CRLF and the browser hashed LF.
A 250-row capture differs by exactly 250 characters, which is a useful sanity check in itself.

## 4. ⭐ What the first capture already proved — and corrected

Set A (SPY, 1D, 250 bars, `Volume@tv-basicstudies`) settled four things by measurement:

1. **`vol` is the series volume, exactly** — 250/250 identical. The capture is coherent.
2. **`vol_ma` is `SMA(volume, 20)` exactly** — 231 checked, **max absolute delta 0.0**,
   matching the study's own `inputs.length = 20`.
3. **⛔ `vol_color` is a PALETTE INDEX, not a boolean, and it is inverted from the obvious
   reading.** `0` = up bar (close ≥ open), `1` = down bar. The naive reading (1 = up) matched
   **0 of 250 bars** — a perfect anti-correlation, which is the tell. Had the capture only
   been eyeballed, "the colours look right" would have hidden it, and every volume bar would
   have rendered in the wrong colour. `inputs.col_prev_close = false` is the vendor state that
   explains it; the close-vs-previous-close hypothesis scores 19.3%, i.e. noise.
4. **A hidden plot still carries values.** `styles.vol_ma.visible` is `false` on this chart,
   yet all 250 rows carry a `vol_ma` number. This is the same rule the Pine spec states for
   `display = display.none` — hidden is an author's *display* choice, not an absence of data —
   and it is exactly what the Table-view export would not have shown.

## 5. Running a capture

1. Open the chart, set the symbol and timeframe for the set (see `sets.json`).
2. Paste `capture_page.js` into the tab (or run it through the browser tool).
3. `__uctStage(__uctCsv('Volume@', 250).csv)` — note the reported `chars` and `fnv1a`.
4. Click the staged textarea, `Ctrl+A`, `Ctrl+C` **as a real gesture** (a synthetic
   `document.execCommand('copy')` is not reliable here).
5. `python tools/visual_conformance/verify_clipboard.py --set A --name volume-spy-1d-250 \
      --chars 18622 --fnv1a 1313922158`

⛔ **Clean up after yourself.** `__uctCleanup()` removes the injected textarea and button and
every `__uct*` global. The chart, its layout, its studies and the Pine editor buffer are never
modified by any of this — the instrument only reads. That matters on a shared machine: this
browser may be driven by another session, and a capture must not be the thing that disturbs it.
