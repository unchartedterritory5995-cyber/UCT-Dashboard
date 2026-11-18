# UCT Signature — the house style for menus, settings and widgets

> **Say "UCT Signature style"** and this is what you get. Named by the owner 2026-11-15.
> It replaces the old UCT look (gold everywhere, darker brown-black, uppercase labels,
> spreadsheet borders) for every NEW menu, settings window, picker and widget chrome.
> `docs/brand-design-system.md` still describes the older tokens the rest of the site uses;
> where the two disagree for a menu / settings / widget surface, **this file wins**.

**In one line:** quiet graphite panels, soft rounded cards, near-white text in two greys,
**a touch of UCT gold only on what is current or chosen** ("the mix"), sentence-case plain
words, controls that show only when you need them. Without that touch of gold it does not look
like UCT; with more than a touch it looks like the old style.

---

## 1. The feel (what to aim for)

1. **Calm, not busy.** Few borders. Separation comes from a slightly lighter card on a darker
   panel and 1px hairlines between rows — never boxes inside boxes, never grid lines.
2. **Monochrome + a touch of gold.** Text, icons, switches, buttons and soft squares are
   white/grey. Colour appears only where it *means* something: an indicator's own line colour,
   green up / red down, a warning, and **UCT gold for "you are here"** (see §2b, "the mix").
3. **Plain words, sentence case.** "Labels on the price scale", not "MA LABELS". A short grey
   hint under a label says what it does ("each line's value on the right axis").
4. **Show controls on demand.** Row actions (settings, hide, remove) appear on hover/focus;
   a hidden thing keeps its crossed-eye showing so state is never invisible.
5. **One way to do each thing.** Choices are a dropdown, on/off is a soft square, lists you
   own are a reorderable list with a "+ Add" that opens a picker. No segmented controls, no
   tile grids, no native `<select>`.

## 2b. The gold mix (owner-approved 2026-11-15) — part of UCT Signature, always

Gold = **`var(--ut-gold)`** (`#dcbb5e` on the dark theme). Flat colour only: never UIcon's
metallic gradient/glow, never a gold fill, gold border, gold text block or gold button.

**Gold goes on exactly these, and nothing else:**
1. **The current item's underline:** the timeframe underline (`1D`), the open tab's line (widget
   tabs, picker tabs like All / In use / Presets, category tabs), a short 2px line under the
   framed day / year in a calendar.
2. **The open section's bar:** the 2px inset bar on the current item of a sidebar / rail
   (Chart Settings sections), and the current page's icon in the site's left nav (gold icon on
   a neutral outlined pill). EXCEPTION (owner 11-15, final): the site's LEFT NAV is the brand rail — every
   nav icon is flat UCT gold (no metallic gradient/glow), the current page full strength on its pill; every
   page has its own icon shape.
3. **The ✓ on the chosen option** in any menu or dropdown (ChoiceMenu, chart type, timeframe,
   right-click template list, column picker).
4. **A favourite's filled star** (timeframes, drawing tools). Empty stars stay grey.
5. **UCT Intelligence's mark** (the ✦ spark / the "Ask AI" icon): always gold, so the AI always
   reads as ours.
6. **In an ACTION menu or a sidebar/rail** (Add widget, Tools, Layouts, the Chart Settings sections), **the highlighted
   row's icon** turns gold while the pointer or keyboard is on it: "you are here" as you move.
7. **Things already in use get a small gold dot**, e.g. widgets already on the board in Add widget
   (with a grey count when there is more than one).

**Stays grey/white:** soft squares (even when ticked), counts, icons, primary buttons (white),
hover states, focus rings, headings. **Rule of thumb:** one or two gold marks per surface; if a
menu shows three, drop one. A long list never turns gold (that is why ticks stay grey).
Chart header (owner 11-16): with no saved colour the ticker title is white (`#ededed`) and the day change uses the chart's own candle up/down colours — never gold (`pane/headerDefaultColors.js`).
Approval board with the five recipes we compared: https://claude.ai/artifact/QfJN6erpTCMEzdubY5H42W

## 2. Tokens (dark — the default; exact values)

| Token | Value | Use |
|---|---|---|
| Panel | `#111214` | menu / window background |
| Card | `#1a1b1f` | a group of rows; menu-row hover |
| Card hover / raised | `#222327` | hover on a card-like control |
| Selected | `#2c2e33` | chosen tile/segment, the ON soft square |
| Input well | `#0f1012` | search boxes, inputs, preview strips (`#0b0c0e`) |
| Border (outer) | `#383b41` | the 1px outline of a floating menu / window |
| Divider | `#26282c` (rows) · `#2a2c31` (menus) | hairlines between rows / groups |
| Text | `#ededed` | labels, menu rows |
| Text bright | `#f8f7f3` | headings, the selected/hovered row, ✓ |
| Text dim | `#a9a59b` | icons, secondary values |
| Resting nav | `#c9c6be` | clickable items at rest: sidebar/rail sections, sidebar-foot buttons, left-nav icons (one step brighter than dim so they read as clickable) |
| Text faint | `#93939a` | group labels, hints, counts |
| Soft fill | `rgba(248,247,243,.06)` → hover `.11` | pill buttons, dropdown buttons, icon-button hover `.07` |
| Up / down | `#3fbf9a` / `#e8665a` | signed numbers only |
| Gold | `var(--ut-gold)` = `#dcbb5e` | ONLY the §2b marks |
| Shadow | `0 14px 36px rgba(0,0,0,.55)` | floating menus (`0 24px 60px rgba(0,0,0,.6)` windows) |

**Radii:** window 12px · menu 10px · card 9px · button/dropdown/input 7px · menu row 6px ·
soft square 5px · colour swatch 6px. **Type:** the app sans (`--font-sans`); rows 13px/500,
selected 600; section labels 11.5px/600 `#c9c6be`; menu group labels 10.5–11px/600 faint;
headings 15px/700; hints 11–12px faint. No uppercase, no letter-spacing on labels.

## 3. The pieces

### Floating menu (right-click, "…" menus, dropdown lists)
`#111214` panel, 1px `#383b41`, radius 10, padding 5, shadow above. Rows 13px `#ededed`,
padding 6–7px 10px, radius 6; hover `#1a1b1f` + `#f8f7f3`. **No icons** in action menus
(M4): small grey **group labels** ("At this price · This chart · Settings · Add") replace
dividers. A submenu row ends in a quiet grey chevron. A checked row shows a white **✓** on the
right, bold label. Reference: `.chartCtxMenu` / `.chartCtxLabel` in
`app/src/pages/charts/ChartsWorkspace.module.css`.

### Dropdown control (replaces segmented controls, tiles and `<select>`)
A soft button: height 28, padding 0 10, radius 7, fill `.06` (hover `.11`), 12px/600 `#ededed`,
value + small grey chevron; optional leading icon (e.g. the chart-type glyph). Opens the floating
menu above with a ✓ on the current value. Reference: `app/src/components/chart/ChoiceMenu.jsx`.

### On/off — the soft square
18×18, radius 5, **left of the label**. Off: transparent with a 1.5px inset ring
`rgba(248,247,243,.22)` (hover `.5`). On: `#2c2e33` fill, 1px ring `.28`, white ✓ (11px).
**The whole row toggles.** Our own look — not TradingView's white box, not a pill switch.
Several related on/offs (watermark lines, bar-info fields, timeframes) sit in a 2–4 column grid
of soft squares. Reference: "Option A" block in `ChartSettingsModal.module.css`.

### Settings window
Window `#111214`, radius 12, fixed width (Chart Settings 700px) — **the window never resizes
between sections**. Left **rail** 168–172px: title, sections with grey line icons, the open one
`#ededed`/600 with a 2px light inset bar on its left; a foot (templates, themes, restore
defaults) under a hairline. Content: 15px/700 heading + a soft square close button top-right;
sections = small sentence-case label over a **card** of rows (min-height 40, padding 6 12,
hairline between rows, label left / control right).

### Lists the user owns (indicators, header stats, columns)
Rows 36px: drag grip `⋮⋮` (faint) · **vertical colour bar** 3×16 (matches the chart legend;
click it to recolour) · name · right-side icon buttons (settings / hide / remove) revealed on
hover. Grouped lists use a card per group with a header row (chevron, name, count, hover
actions). A primary **"+ Add …"** opens a picker; drag sets order. Undo/redo live in a quiet
footer, not the header.

### Picker (big "choose from many" menu)
Floating menu style, ~290px: tabs **All · In use (n)** (· Presets), a search well
("Find a …"), folding groups with a faint label and a `b/total` count, rows with a white ✓,
"Soon" chips for unbuilt items, a **description strip** at the bottom for the hovered item,
footer "Reset to UCT default" · "Done". The catalogue is shared — the chart header's stat
picker and the watchlist column menu offer the same list
(`app/src/pages/watchlist/watchlistColumnCatalog.js`).

### Buttons
- **Primary:** a soft button one step brighter than the secondary: fill `rgba(248,247,243,.08)`
  (hover `.13`), `#f8f7f3` label 12.5px/600, a leading "+". One per surface, e.g. "+ Add widget",
  "+ Add indicator". (Owner 11-15: the solid white pill "sticks out too much"; small confirm
  buttons inside a field, like the calendar's **Go** or a custom interval's **Add**, may stay white.)
- **Pill / secondary:** soft fill `.06` → `.11`, `#ededed`, 12px/600, radius 7.
- **Icon button:** 26×26, radius 6, transparent, `#a9a59b`; hover fill `.07` + `#ededed`;
  disabled 30% opacity.

### Inline "describe it" bar (UCT Intelligence)
A 36px well on the card colour with a ✦ spark, placeholder "Change it in plain words, e.g. …",
and a send arrow. Replaces "Modify with AI" buttons.

### On-chart marks of the member's own activity (Chart Settings → Markers → Your activity)
Quiet, read-only, default off, and never gold. **Price alerts:** a 1px dashed line in muted
steel-blue `#6ba3be`, axis label "Alert". **My trades** (owner 11-16): a small up-arrow under the
bar for a buy and a small down-arrow over it for a sell, in the chart's **own** up / down candle
colours at 60% strength (no fixed green/red, no permanent text on the chart); hovering one shows
"Bought 100 @ 12.34 · Mar 2, 2026, 10:31 AM", or "3 fills · net +200" for a bar with several fills.

## 4. Don'ts
- No gold beyond §2b: no gold fills, borders, buttons, text blocks, counts or decorative icons; no metallic gold icons.
- No uppercase / tracked-out labels, no "spreadsheet" borders, no boxed tables inside cards.
- No segmented controls or tile grids for a choice — use the dropdown.
- No windows that grow/shrink when you switch tabs; no rails that collapse.
- Don't show every action on every row all the time.
- Never invent placeholder data that looks like a real quote in previews — label it "sample".

## 5. Reference implementations (look at these first)
- Chart right-click menu (M4): `app/src/pages/charts/widgets/ChartWidget.jsx` + `ChartsWorkspace.module.css` (`.chartCtx*`).
- Chart Settings (rail, cards, soft squares, dropdowns): `app/src/components/chart/ChartSettingsModal.jsx` + `.module.css` ("board-menu look", "S2 sidebar", "Option A").
- Dropdown: `app/src/components/chart/ChoiceMenu.jsx` + `.module.css`.
- Timeframe menu (first "remake it in UCT Signature" test, 2026-11-15): `app/src/pages/charts/widgets/TimeframeMenu.jsx` + `.module.css` — grouped list, white ✓ on the current item, favourite stars on the right (filled always shown, empty on hover), a ChoiceMenu inside a popover (its portalled list is `[data-choice-menu]`, so the host's outside-click must ignore it).
- Chart-type header button + shared glyph: `app/src/components/chart/pane/ChartTypeMenu.jsx`, `ChartTypeGlyph.jsx`.
- Command Center widgets / widget settings menus (Theme Tracker "…" menu, design B).
- A whole PAGE in the style (2026-11-16): the Screener's Focus layout, `app/src/pages/screener/focus/`
  (`FocusScreener.module.css`, `FocusMenus.module.css`, `RsScreens.module.css`). One top bar (tabs with
  the gold underline for Stocks | Options and for the view), one context line (a screen's quick
  controls as soft chips, the chosen one in the Selected tone), one notices line, a list whose
  selected row is the raised tone with the 2px gold bar, and a screen picker with a group rail.
  Its values are the `--scr-*` names in `FocusMenus.module.css`, which map to the app's own light
  tokens under the light theme. Rail: `focus/__tests__/signatureLayout.test.jsx` (every use of gold
  in those sheets must be one of the section 2b marks).
- Design labs (owner-approved mockups, 2026-11-15): Chart Settings Lab — Indicators list + editor,
  Header & legend with the stat picker — https://claude.ai/artifact/57juSevqLBPhRxK3eUo5DG

## 5b. Where it is used (inventory, 2026-11-15)
**Live:** /charts chart-widget integrated header (PR #1117) · the Command Center widget restyle
(PR #1302): every widget's frame + header row, Watchlist (library rail, RTH·EXT, column library
menu), Theme Tracker, News, Notebook, Calendar, the widget settings menus (design B grouped cards,
always beside the widget), the widget-tab right-click menu · PR #1311 (watchlist library rail).
**Localhost (feat/widget-uct-style, not shipped):** chart right-click menu M4 · chart-type header
button + menu · Chart Settings (S2 rail, cards, soft squares, ChoiceMenu dropdowns) · timeframe
menu · date calendar + "Go to a date" · drawing-tools ★ menu · the /charts top row (layout name = Layouts button + save state, + Add widget picker, Tools, Merge toggle) · left nav (grey icons, gold current page).
**Screener (PR of 2026-11-16):** the Focus layout's List, Charts and Map views, its top bar, context
and notices lines, the screen picker, Save / More / Help / Sort menus, the Filters drawer (and the
filter rail inside it, `FilterRail skin="signature"`), the name dialog, the toast, the phone sheets.
**Screener scan board (2026-11-17, dark behind `SCREENER_SCAN_BOARD_ENABLED`):** the Screener as a customizable widget board
(`app/src/pages/screener/focus/board/`, `Board.module.css`): widget cards on the well colour, the open tab and the open details tab
underlined in gold, the selected row and the open screen with the 2px bar, the Layout menu's chosen options ticked. Customize's grip
and corner handles are grey (tools, not a selection). Its own gold rail: `board/__tests__/boardUi.test.jsx`.

**Community layouts (2026-11-17, dark behind `SCREENER_LAYOUT_GALLERY_ENABLED`):** a Signature window (`board/CommunityLayouts.jsx`) of layout cards on the scan board's Layout menu. Each card is a small picture of the layout (grey boxes on the board's own grid), its name, who shared it and how often it was used, with one soft primary button ("Use layout") and a quiet text action ("Report"). No gold anywhere in the window: nothing in it is the member's current choice until they use one, and then the tick appears on the Layout menu as for any layout.

**Screener, not yet converted:** Table view (the older ScannerShell page) and the Options tab's own page.
**Designed, not built (lab):** Chart Settings Indicators section + indicator editor, Header &
legend with the stat picker. **Not yet converted:** Breadth widget (parked), Chart Settings light
theme, pages outside /charts.

## 6. Light theme
Not designed yet (the gold mix uses `var(--ut-gold)`, which already has a light-theme value). Until it is, UCT Signature surfaces are dark-only and the light theme keeps
its existing styles; when it is designed, add its token column to §2 here.
