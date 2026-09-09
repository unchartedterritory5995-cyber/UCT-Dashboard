# Pine Script v6 — every constant namespace, complete member lists

Generated from `pine_v6_reference.json` (the reference object extracted from TradingView's own
webpack chunks — see `pine_v6_reference_extraction.md`). **The reference is authoritative**; the
User Manual's prose tables are compared against it in §4 and lose where they disagree.

- Reference collections: `keywords` = 23, `operators` = 23, `variables` = 161, `constants` = 239, `types` = 20, `annotations` = 10, `functions` = 719, `methods` = 251
- Constant entries: **239** across **35** namespaces (**47** namespace/underscore-family groups).
- Manual pages indexed for the coverage columns: **49** (every page reachable from the docs navigation, fetched as raw HTML and tag-stripped).

Column meanings: **#** = member count in the reference. **Type** = the reference's own `type`
field (its qualified type — note several families are NOT `const string`). **Manual** = how many
members the single best-covering manual page names / how many the *entire* manual names anywhere.

## 1. By namespace (complete)

| Namespace | # | Type(s) | Manual (best page) | Manual-wide | Members |
|---|---:|---|---|---:|---|
| `currency` | 56 | `const string` | 4/56 (concepts_other-timeframes-and-data) | 6/56 | `currency.NONE` · `currency.USD` · `currency.EUR` · `currency.AUD` · `currency.GBP` · `currency.NZD` · `currency.CAD` · `currency.CHF` · `currency.HKD` · `currency.JPY` · `currency.NOK` · `currency.SEK` · `currency.SGD` · `currency.TRY` · `currency.ZAR` · `currency.RUB` · `currency.BTC` · `currency.ETH` · `currency.MYR` · `currency.KRW` · `currency.USDT` · `currency.INR` · `currency.PLN` · `currency.PKR` · `currency.EGP` · `currency.AED` · `currency.COP` · `currency.MXN` · `currency.CLP` · `currency.BRL` · `currency.ARS` · `currency.PEN` · `currency.IDR` · `currency.SAR` · `currency.BDT` · `currency.BHD` · `currency.CNY` · `currency.CZK` · `currency.DKK` · `currency.HUF` · `currency.ILS` · `currency.ISK` · `currency.KES` · `currency.KWD` · `currency.LKR` · `currency.MAD` · `currency.NGN` · `currency.PHP` · `currency.QAR` · `currency.RON` · `currency.RSD` · `currency.THB` · `currency.TND` · `currency.TWD` · `currency.VES` · `currency.VND` |
| `label` | 21 | `const string` | 20/21 (visuals_text-and-shapes) | 20/21 | `label.style_none` · `label.style_xcross` · `label.style_cross` · `label.style_triangleup` · `label.style_triangledown` · `label.style_flag` · `label.style_circle` · `label.style_arrowup` · `label.style_arrowdown` · `label.style_label_up` · `label.style_label_down` · `label.style_label_left` · `label.style_label_right` · `label.style_label_lower_left` · `label.style_label_lower_right` · `label.style_label_upper_left` · `label.style_label_upper_right` · `label.style_label_center` · `label.style_square` · `label.style_diamond` · `label.style_text_outline` |
| `color` | 17 | `const color` | 17/17 (visuals_colors) | 17/17 | `color.black` · `color.silver` · `color.gray` · `color.white` · `color.maroon` · `color.red` · `color.purple` · `color.fuchsia` · `color.green` · `color.lime` · `color.olive` · `color.yellow` · `color.navy` · `color.blue` · `color.teal` · `color.aqua` · `color.orange` |
| `plot` | 14 | `const plot_line_style`, `const plot_style` | 13/14 (visuals_plots) | 13/14 | `plot.style_line` · `plot.style_linebr` · `plot.style_stepline` · `plot.style_stepline_diamond` · `plot.style_histogram` · `plot.style_cross` · `plot.style_area` · `plot.style_areabr` · `plot.style_columns` · `plot.style_circles` · `plot.style_steplinebr` · `plot.linestyle_solid` · `plot.linestyle_dashed` · `plot.linestyle_dotted` |
| `shape` | 12 | `const string` | 12/12 (visuals_text-and-shapes) | 12/12 | `shape.xcross` · `shape.cross` · `shape.circle` · `shape.triangleup` · `shape.triangledown` · `shape.flag` · `shape.arrowup` · `shape.arrowdown` · `shape.labelup` · `shape.labeldown` · `shape.square` · `shape.diamond` |
| `text` | 10 | `const string`, `const text_format` | 10/10 (visuals_lines-and-boxes) | 10/10 | `text.format_none` · `text.format_bold` · `text.format_italic` · `text.align_center` · `text.align_left` · `text.align_right` · `text.align_top` · `text.align_bottom` · `text.wrap_auto` · `text.wrap_none` |
| `position` | 9 | `const string` | 9/9 (visuals_overview) | 9/9 | `position.top_left` · `position.top_center` · `position.top_right` · `position.middle_left` · `position.middle_center` · `position.middle_right` · `position.bottom_left` · `position.bottom_center` · `position.bottom_right` |
| `dayofweek` | 7 | `const int` | 7/7 (concepts_time) | 7/7 | `dayofweek.sunday` · `dayofweek.monday` · `dayofweek.tuesday` · `dayofweek.wednesday` · `dayofweek.thursday` · `dayofweek.friday` · `dayofweek.saturday` |
| `display` | 7 | `const plot_display`, `const plot_simple_display` | 5/7 (visuals_overview) | 5/7 | `display.none` · `display.pane` · `display.data_window` · `display.price_scale` · `display.status_line` · `display.pine_screener` · `display.all` |
| `line` | 6 | `const string` | 6/6 (visuals_lines-and-boxes) | 6/6 | `line.style_solid` · `line.style_dotted` · `line.style_dashed` · `line.style_arrow_left` · `line.style_arrow_right` · `line.style_arrow_both` |
| `size` | 6 | `const string` | 6/6 (concepts_other-timeframes-and-data) | 6/6 | `size.auto` · `size.tiny` · `size.small` · `size.normal` · `size.large` · `size.huge` |
| `format` | 5 | `const string` | 4/5 (language_declaration-statements) | 5/5 | `format.inherit` · `format.price` · `format.volume` · `format.percent` · `format.mintick` |
| `location` | 5 | `const string` | 4/5 (faq_techniques) | 5/5 | `location.abovebar` · `location.belowbar` · `location.top` · `location.bottom` · `location.absolute` |
| `strategy` | 5 | `const strategy_direction`, `const string` | 5/5 (language_declaration-statements) | 5/5 | `strategy.fixed` · `strategy.cash` · `strategy.percent_of_equity` · `strategy.long` · `strategy.short` |
| `barmerge` | 4 | `const barmerge_gaps`, `const barmerge_lookahead` | 4/4 (concepts_other-timeframes-and-data) | 4/4 | `barmerge.lookahead_off` · `barmerge.lookahead_on` · `barmerge.gaps_off` · `barmerge.gaps_on` |
| `extend` | 4 | `const string` | 4/4 (visuals_lines-and-boxes) | 4/4 | `extend.none` · `extend.left` · `extend.right` · `extend.both` |
| `math` | 4 | `const float` | 1/4 (visuals_fills) | 1/4 | `math.pi` · `math.phi` · `math.rphi` · `math.e` |
| `adjustment` | 3 | `const string` | 1/3 (concepts_other-timeframes-and-data) | 1/3 | `adjustment.none` · `adjustment.splits` · `adjustment.dividends` |
| `alert` | 3 | `const string` | 3/3 (concepts_alerts) | 3/3 | `alert.freq_all` · `alert.freq_once_per_bar` · `alert.freq_once_per_bar_close` |
| `backadjustment` | 3 | `const backadjustment` | 0/3 (concepts_alerts) | 0/3 | `backadjustment.inherit` · `backadjustment.on` · `backadjustment.off` |
| `earnings` | 3 | `const string` | 3/3 (concepts_other-timeframes-and-data) | 3/3 | `earnings.actual` · `earnings.estimate` · `earnings.standardized` |
| `hline` | 3 | `const hline_style` | 3/3 (visuals_levels) | 3/3 | `hline.style_solid` · `hline.style_dotted` · `hline.style_dashed` |
| `scale` | 3 | `const scale_type` | 3/3 (language_declaration-statements) | 3/3 | `scale.right` · `scale.left` · `scale.none` |
| `settlement_as_close` | 3 | `const settlement` | 0/3 (concepts_alerts) | 0/3 | `settlement_as_close.inherit` · `settlement_as_close.on` · `settlement_as_close.off` |
| `strategy.commission` | 3 | `const string` | 3/3 (language_declaration-statements) | 3/3 | `strategy.commission.percent` · `strategy.commission.cash_per_contract` · `strategy.commission.cash_per_order` |
| `strategy.direction` | 3 | `const string` | 1/3 (concepts_strategies) | 1/3 | `strategy.direction.all` · `strategy.direction.long` · `strategy.direction.short` |
| `strategy.oca` | 3 | `const string` | 3/3 (concepts_strategies) | 3/3 | `strategy.oca.none` · `strategy.oca.cancel` · `strategy.oca.reduce` |
| `yloc` | 3 | `const string` | 3/3 (concepts_time) | 3/3 | `yloc.price` · `yloc.abovebar` · `yloc.belowbar` |
| `(no namespace)` | 2 | `None` | 2/2 (concepts_alerts) | 2/2 | `true` · `false` |
| `dividends` | 2 | `const string` | 2/2 (concepts_other-timeframes-and-data) | 2/2 | `dividends.net` · `dividends.gross` |
| `font` | 2 | `const string` | 2/2 (visuals_lines-and-boxes) | 2/2 | `font.family_default` · `font.family_monospace` |
| `order` | 2 | `const sort_order` | 2/2 (language_arrays) | 2/2 | `order.ascending` · `order.descending` |
| `session` | 2 | `const string` | 2/2 (concepts_chart-information) | 2/2 | `session.regular` · `session.extended` |
| `splits` | 2 | `const string` | 2/2 (concepts_other-timeframes-and-data) | 2/2 | `splits.denominator` · `splits.numerator` |
| `xloc` | 2 | `const string` | 2/2 (faq_techniques) | 2/2 | `xloc.bar_index` · `xloc.bar_time` |

## 2. By namespace/underscore family

The same 239 entries regrouped where a namespace splits into `<ns>.<prefix>_*` families — this is
the grouping most Pine documentation and tooling uses (`label.style_*`, `text.align_*`, …).

| Family | # | Type(s) | Members |
|---|---:|---|---|
| `(no namespace).*` | 2 | `None` | `true` · `false` |
| `adjustment.*` | 3 | `const string` | `adjustment.none` · `adjustment.splits` · `adjustment.dividends` |
| `alert.freq_*` | 3 | `const string` | `alert.freq_all` · `alert.freq_once_per_bar` · `alert.freq_once_per_bar_close` |
| `backadjustment.*` | 3 | `const backadjustment` | `backadjustment.inherit` · `backadjustment.on` · `backadjustment.off` |
| `barmerge.gaps_*` | 2 | `const barmerge_gaps` | `barmerge.gaps_off` · `barmerge.gaps_on` |
| `barmerge.lookahead_*` | 2 | `const barmerge_lookahead` | `barmerge.lookahead_off` · `barmerge.lookahead_on` |
| `color.*` | 17 | `const color` | `color.black` · `color.silver` · `color.gray` · `color.white` · `color.maroon` · `color.red` · `color.purple` · `color.fuchsia` · `color.green` · `color.lime` · `color.olive` · `color.yellow` · `color.navy` · `color.blue` · `color.teal` · `color.aqua` · `color.orange` |
| `currency.*` | 56 | `const string` | `currency.NONE` · `currency.USD` · `currency.EUR` · `currency.AUD` · `currency.GBP` · `currency.NZD` · `currency.CAD` · `currency.CHF` · `currency.HKD` · `currency.JPY` · `currency.NOK` · `currency.SEK` · `currency.SGD` · `currency.TRY` · `currency.ZAR` · `currency.RUB` · `currency.BTC` · `currency.ETH` · `currency.MYR` · `currency.KRW` · `currency.USDT` · `currency.INR` · `currency.PLN` · `currency.PKR` · `currency.EGP` · `currency.AED` · `currency.COP` · `currency.MXN` · `currency.CLP` · `currency.BRL` · `currency.ARS` · `currency.PEN` · `currency.IDR` · `currency.SAR` · `currency.BDT` · `currency.BHD` · `currency.CNY` · `currency.CZK` · `currency.DKK` · `currency.HUF` · `currency.ILS` · `currency.ISK` · `currency.KES` · `currency.KWD` · `currency.LKR` · `currency.MAD` · `currency.NGN` · `currency.PHP` · `currency.QAR` · `currency.RON` · `currency.RSD` · `currency.THB` · `currency.TND` · `currency.TWD` · `currency.VES` · `currency.VND` |
| `dayofweek.*` | 7 | `const int` | `dayofweek.sunday` · `dayofweek.monday` · `dayofweek.tuesday` · `dayofweek.wednesday` · `dayofweek.thursday` · `dayofweek.friday` · `dayofweek.saturday` |
| `display.*` | 3 | `const plot_display`, `const plot_simple_display` | `display.none` · `display.pane` · `display.all` |
| `display.data_*` | 1 | `const plot_display` | `display.data_window` |
| `display.pine_*` | 1 | `const plot_display` | `display.pine_screener` |
| `display.price_*` | 1 | `const plot_display` | `display.price_scale` |
| `display.status_*` | 1 | `const plot_display` | `display.status_line` |
| `dividends.*` | 2 | `const string` | `dividends.net` · `dividends.gross` |
| `earnings.*` | 3 | `const string` | `earnings.actual` · `earnings.estimate` · `earnings.standardized` |
| `extend.*` | 4 | `const string` | `extend.none` · `extend.left` · `extend.right` · `extend.both` |
| `font.family_*` | 2 | `const string` | `font.family_default` · `font.family_monospace` |
| `format.*` | 5 | `const string` | `format.inherit` · `format.price` · `format.volume` · `format.percent` · `format.mintick` |
| `hline.style_*` | 3 | `const hline_style` | `hline.style_solid` · `hline.style_dotted` · `hline.style_dashed` |
| `label.style_*` | 21 | `const string` | `label.style_none` · `label.style_xcross` · `label.style_cross` · `label.style_triangleup` · `label.style_triangledown` · `label.style_flag` · `label.style_circle` · `label.style_arrowup` · `label.style_arrowdown` · `label.style_label_up` · `label.style_label_down` · `label.style_label_left` · `label.style_label_right` · `label.style_label_lower_left` · `label.style_label_lower_right` · `label.style_label_upper_left` · `label.style_label_upper_right` · `label.style_label_center` · `label.style_square` · `label.style_diamond` · `label.style_text_outline` |
| `line.style_*` | 6 | `const string` | `line.style_solid` · `line.style_dotted` · `line.style_dashed` · `line.style_arrow_left` · `line.style_arrow_right` · `line.style_arrow_both` |
| `location.*` | 5 | `const string` | `location.abovebar` · `location.belowbar` · `location.top` · `location.bottom` · `location.absolute` |
| `math.*` | 4 | `const float` | `math.pi` · `math.phi` · `math.rphi` · `math.e` |
| `order.*` | 2 | `const sort_order` | `order.ascending` · `order.descending` |
| `plot.linestyle_*` | 3 | `const plot_line_style` | `plot.linestyle_solid` · `plot.linestyle_dashed` · `plot.linestyle_dotted` |
| `plot.style_*` | 11 | `const plot_style` | `plot.style_line` · `plot.style_linebr` · `plot.style_stepline` · `plot.style_stepline_diamond` · `plot.style_histogram` · `plot.style_cross` · `plot.style_area` · `plot.style_areabr` · `plot.style_columns` · `plot.style_circles` · `plot.style_steplinebr` |
| `position.bottom_*` | 3 | `const string` | `position.bottom_left` · `position.bottom_center` · `position.bottom_right` |
| `position.middle_*` | 3 | `const string` | `position.middle_left` · `position.middle_center` · `position.middle_right` |
| `position.top_*` | 3 | `const string` | `position.top_left` · `position.top_center` · `position.top_right` |
| `scale.*` | 3 | `const scale_type` | `scale.right` · `scale.left` · `scale.none` |
| `session.*` | 2 | `const string` | `session.regular` · `session.extended` |
| `settlement_as_close.*` | 3 | `const settlement` | `settlement_as_close.inherit` · `settlement_as_close.on` · `settlement_as_close.off` |
| `shape.*` | 12 | `const string` | `shape.xcross` · `shape.cross` · `shape.circle` · `shape.triangleup` · `shape.triangledown` · `shape.flag` · `shape.arrowup` · `shape.arrowdown` · `shape.labelup` · `shape.labeldown` · `shape.square` · `shape.diamond` |
| `size.*` | 6 | `const string` | `size.auto` · `size.tiny` · `size.small` · `size.normal` · `size.large` · `size.huge` |
| `splits.*` | 2 | `const string` | `splits.denominator` · `splits.numerator` |
| `strategy.*` | 4 | `const strategy_direction`, `const string` | `strategy.fixed` · `strategy.cash` · `strategy.long` · `strategy.short` |
| `strategy.commission.*` | 1 | `const string` | `strategy.commission.percent` |
| `strategy.commission.cash_*` | 2 | `const string` | `strategy.commission.cash_per_contract` · `strategy.commission.cash_per_order` |
| `strategy.direction.*` | 3 | `const string` | `strategy.direction.all` · `strategy.direction.long` · `strategy.direction.short` |
| `strategy.oca.*` | 3 | `const string` | `strategy.oca.none` · `strategy.oca.cancel` · `strategy.oca.reduce` |
| `strategy.percent_*` | 1 | `const string` | `strategy.percent_of_equity` |
| `text.align_*` | 5 | `const string` | `text.align_center` · `text.align_left` · `text.align_right` · `text.align_top` · `text.align_bottom` |
| `text.format_*` | 3 | `const text_format` | `text.format_none` · `text.format_bold` · `text.format_italic` |
| `text.wrap_*` | 2 | `const string` | `text.wrap_auto` · `text.wrap_none` |
| `xloc.bar_*` | 2 | `const string` | `xloc.bar_index` · `xloc.bar_time` |
| `yloc.*` | 3 | `const string` | `yloc.price` · `yloc.abovebar` · `yloc.belowbar` |

## 3. Not constants: identifiers that *look* like constants but are `variables`

The reference splits built-in identifiers into `constants` and `variables`. Several namespaces that
scripts treat as constant-like live in `variables` and therefore do **not** appear above. A renderer
or type-checker that keys off the reference must read both collections.

| Variable namespace | # |
|---|---:|
| `syminfo` | 40 |
| `strategy` | 33 |
| `(no namespace)` | 27 |
| `chart` | 11 |
| `timeframe` | 11 |
| `ta` | 10 |
| `barstate` | 7 |
| `session` | 7 |
| `earnings` | 4 |
| `dividends` | 3 |
| `box` | 1 |
| `label` | 1 |
| `line` | 1 |
| `linefill` | 1 |
| `polyline` | 1 |
| `strategy.closedtrades` | 1 |
| `strategy.opentrades` | 1 |
| `table` | 1 |

Notable overlaps: `session.*` exists in **both** collections — `session.regular` / `session.extended`
are `const string` **constants**, while `session.ismarket`, `session.ispremarket`, … are runtime
**variables**. Likewise `label` / `line` / `linefill` / `box` / `polyline` / `table` each contribute
exactly one *variable* (`.all`) and their `style_*` members are constants.

## 4. Reference vs User Manual — disagreements (reference wins)

Method: every one of the 239 constant names was searched, with word-boundary matching, across all 49
manual pages. A row is a **contradiction** when a manual passage that presents itself as an
enumeration ("These are the available style arguments:", "The available arguments are:") omits a
member; it is an **omission** when the manual simply never covers the family.

| # | Family | Reference | Manual | Verdict |
|---|---|---:|---|---|
| D1 | `label.style_*` | **21** | Text-and-shapes: "These are the available style arguments:" then a **20-row** table | **CONTRADICTION** — table omits `label.style_text_outline` (added Aug 2022 per release notes). Absent from all 49 pages. |
| D2 | `plot.style_*` | **11** | Plots page: "The available arguments are:" then names **9** | **CONTRADICTION** — the list omits `plot.style_stepline_diamond` (named elsewhere on the same page) **and** `plot.style_steplinebr`, which appears on **zero** manual pages. Reference: "'Step line with Breaks' style … for the `style` parameter in `plot()`". |
| D3 | `display.*` | **7** | 5 named anywhere | **OMISSION (renderer-relevant)** — `display.price_scale` and `display.pine_screener` appear on **no** manual page, yet the overview page discusses price-scale visibility in prose and the reference documents the `display.all - display.price_scale` idiom explicitly. |
| D4 | `math.*` | **4** | only `math.pi` | **OMISSION** — `math.phi`, `math.rphi` (0.6180339887498948), `math.e` appear nowhere in the manual. |
| D5 | `currency.*` | **56** | 6 named anywhere | **OMISSION** — the manual never enumerates currencies; 50 of 56 appear nowhere. |
| D6 | `adjustment.*` | **3** | only `adjustment.dividends` | **OMISSION** — `adjustment.none`, `adjustment.splits` appear nowhere. |
| D7 | `strategy.direction.*` | **3** | only `strategy.direction.long` | **OMISSION** — `.all` and `.short` appear nowhere in the manual (they are documented only in the reference). |
| D8 | `settlement_as_close.*` | **3** | 0 | **OMISSION** — entire family absent from the manual (`ticker.new()` / `ticker.modify()` parameter). |
| D9 | `backadjustment.*` | **3** | 0 | **OMISSION** — entire family absent from the manual (same functions). |
| D10 | `format.*` | **5** | `format.mintick` missing from the declaration-statements `format` list | **PARTIAL** — `format.mintick` is documented elsewhere (string formatting), so the gap is only in that page's enumeration. |
| D11 | `strategy.commission.*` | **3** | `strategy.commission.cash_per_order` absent from every page | **OMISSION**. |
| D12 | `max_labels_count` / `max_lines_count` semantics | `indicator()`: "The default is ~50 … **the limit is approximate**; the script might display more drawings than specified" vs `strategy()`: "**Possible values: 1-500.** Optional. **The default is 50.**" | Manual: "only show the last 50 … by default", and its own worked example says "Only the last **54** labels are displayed" under the default | **INTERNAL REFERENCE INCONSISTENCY** — the two declaration functions describe the same parameter differently. Treat as: default ~50, settable 1–500, enforcement approximate. The manual's "54" observation corroborates `indicator()`, not `strategy()`. |

Agreements worth recording (checked, no disagreement): `line.style_*` 6/6, `hline.style_*` 3/3,
`extend.*` 4/4, `xloc.*` 2/2, `yloc.*` 3/3, `shape.*` 12/12, `size.*` 6/6 **including the int-equivalent
table** (0 / ~7 / ~10 / 12 / 18 / 24 for labels; 0 / 8 / 10 / 14 / 20 / 36 for tables and boxes),
`position.*` 9/9, `text.align_*` 5/5, `text.format_*` 3/3, `text.wrap_*` 2/2, `font.family_*` 2/2,
`color.*` 17/17, `dayofweek.*` 7/7, `barmerge.*` 4/4, `alert.freq_*` 3/3, `scale.*` 3/3,
`location.*` 5/5, `session.*` 2/2, `earnings.*` 3/3, `dividends.*` 2/2, `splits.*` 2/2,
`strategy.oca.*` 3/3, `order.*` 2/2.

## 5. Qualified-type findings a renderer / type-checker must respect

The reference's `type` field shows that visually similar families are **not** interchangeable — several
are distinct nominal types, not `string`:

| Observation | Consequence |
|---|---|
| `line.style_*` is `const string`, but `hline.style_*` is `const hline_style` | `hline(style = line.style_dashed)` is a type error even though both families name "solid/dotted/dashed". `hline` has **only 3** styles — no arrow styles. |
| `plot.style_*` is `const plot_style`; `plot.linestyle_*` is `const plot_line_style` | Two separate style axes on `plot()`: the *plot* style (11 values) and, for line-drawing styles, the *line* style (3 values). |
| `text.align_*` / `text.wrap_*` are `const string`, but `text.format_*` is `const text_format` | Only `text_format` supports `+` arithmetic (`text.format_bold + text.format_italic`). |
| `display.none` and `display.all` are `const plot_simple_display`; the other five are `const plot_display` | `hline()`, `fill()`, `bgcolor()`, `barcolor()` accept only the two "simple" values — hence the manual's "only two possible `display` states". Location-specific values are `plot*()`-only. |
| `barmerge.gaps_*` is `const barmerge_gaps`; `barmerge.lookahead_*` is `const barmerge_lookahead` | The two `request.security()` arguments cannot be swapped. |
| `scale.*` = `const scale_type`, `order.*` = `const sort_order`, `settlement_as_close.*` = `const settlement`, `backadjustment.*` = `const backadjustment` | Each is a closed nominal enum. |
| `dayofweek.*` is `const int` (not string) | Directly comparable with the `dayofweek` variable and `dayofweek()`'s return value. The reference states the role but **not the numeric values** — the integer each day maps to is UNVERIFIED from the reference alone. |
| `color.*` is `const color`; `math.*` is `const float` | `color.orange` is documented as `#FF9800`. |
| `label.style_*`, `line.style_*`, `xloc.*`, `yloc.*`, `extend.*`, `size.*`, `position.*`, `shape.*`, `location.*`, `font.family_*`, `format.*`, `currency.*`, `session.*`, `adjustment.*`, `earnings.*`, `dividends.*`, `splits.*`, `alert.freq_*`, `strategy.*` (except `strategy.long/short`) are `const string` | These are plain strings at the type level — a renderer can accept the literal string values, but **must** still reject cross-family values semantically. |
| `strategy.long` / `strategy.short` are `const strategy_direction`, while `strategy.direction.long/short/all` are `const string` | Two different "direction" vocabularies in one namespace — `strategy.entry(direction = strategy.long)` vs `strategy.risk.allow_entry_in(strategy.direction.long)`. |
| `true` / `false` carry `type: null` in the reference | They are literals, not typed constants; `na` is not in the constants collection at all (it is a *variable*). |
