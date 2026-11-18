# teach-ship-1: the guide teaches any named control (catalog + lexicon)

Base: `agent/pl/wrong-chart-fix-otherone` @ `05dba2dbe2`. Stack position: 1 of 5 (nothing below it). Local only; not pushed. Evidence: LOCAL, BROWSER-MOCK-MODEL / SIMULATED.

## Behaviour changes
- **Guide follow-ups.** A walkthrough takes its chart and instance from the request; chart words stop refusing; a one-chart board says when the words named another chart; a bare name counts only with a ticker's shape. These come from the earlier guide-followup work, which is not on master.
- **`guide/words.js`.** Requests are read as concepts: synonym stems plus the product's own words. A request that names an object a control doesn't act on rules that control out.
- **`guide/controls.js`.** A catalog of controls the product already names (anchor, accessible name or label). Steps are built from the place: a widget, the list picker, the layout library or bar, a drawing's menu (from the drawing schema), a Chart Settings tab, the chart toolbar.
  - Several equal fits get a question.
  - A place the words don't name is only asked about, and only when no other walkthrough took the words and every word is understood.
- **Families taught:**
  - Send to Journal on 9 widgets; the watchlist picker's delete (the list header is hidden in pick mode, an owner decision).
  - Layout library delete and put-on-bar; chart and widget tab rename and link colour.
  - Drawing magnet, repeat and customize; drawing boards; share; watermark and legend settings.
  - Calendar sorts; TE News; AI Search; notes; indexes; scan refresh; Market Map; Volume Surge.
  - Drawing-menu rows; list columns; the Scanner picker; nudging a drawing; Volume Surge logos; a headline on the chart; the Options Flow filters.
- **`guide.show`** offers the `control` walkthrough. A control that shows only later rings where it will appear and says why. A weak ask never takes words about something it doesn't know (the coach keeps "position sizing").
- **New target forms in `targets.js`:** `nameRe`, `lead`, `'@chart'`.
- **Attribute-only `data-guide` anchors** on the Options Flow filter strip (`widgets/OptionsFlowWidget.jsx`).

## Shared goldens
`manifest.golden.json` and `section_b_requests.json`: `guide.show` gains `"control"` in its enum and in its hints.

## Held-out (each set written before its entries)
- Round 1: first run 46/59.
- Round 3: 1/10 before the entries, 6/10 on the first run after.
- Options Flow: 0/8 before, 8/8 on the first run after.

## Touches deixis / useAgent / runtime / host
No.

## Dropped from this slice
The runner's `expected.json` hunk, which is in ship-5.

## Owed
pytest for the readers of the golden.
