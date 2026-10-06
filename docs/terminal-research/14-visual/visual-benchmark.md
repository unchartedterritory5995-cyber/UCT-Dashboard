---
id: V-01
role: Visual benchmark of best-in-class trading terminals, and three candidate visual directions
  for the UCT Terminal redesign. The visual layer only; function and IA live in 03 and 06.
inputs: 03-competitive-research/{bloomberg,koyfin,tradingview,lseg-workspace,godel,unusual-whales,
  benzinga-pro,finchat,quartr}/ · 06-ux-and-information-architecture/*.md ·
  app/src/styles/tokens.css and app/src/pages/terminal/TerminalShell.module.css (current state) ·
  public vendor pages and design write-ups, cited inline and in §7
evidence_ceiling: No logged-in sessions, no browser automation, no screenshots taken. Visual claims
  come from vendor documentation, published design systems (LSEG Halo source, TradingView chart
  docs), vendor design write-ups (Linear), and the 03 dossiers. Where a claim is general industry
  knowledge rather than a cited source it is marked [I]. The owner should look at each product
  before choosing a direction; §5 lists what to look at.
status: DRAFT for owner review. Written 2026-10-06.
---

# UCT Terminal — visual benchmark and three directions

Evidence labels used below: **[V]** read in a cited source · **[R]** reported by a third party or a
03 dossier · **[I]** inference or general industry knowledge, not checked against a live product.

## 0. Headline

1. The best terminals look so different from each other (Bloomberg amber-on-black, LSEG's flat
   grey tiles, Linear's soft layered greys) that **no single "terminal look" exists to copy**.
   What they do share is a small set of habits: digits that line up, colour kept for meaning,
   one accent, a panel header that looks the same everywhere, and density with a clear hierarchy
   (§2).
2. **UCT is already part of the way there.** It has a gold accent (`--ut-gold #dcbb5e`), a
   layered dark scale (`#101012 → #17181b → #1d1f23 → #24262b`), and a `.t-num` tabular-figures
   class. Four problems need fixing whichever direction is chosen:
   - **Warning and brand are the same colour.** `--warn` is `#dcbb5e`, which is `--ut-gold`.
     So a stale-data warning looks the same as a selected tab.
   - **The down colour fails WCAG AA for small text.** `--loss #df4646` on `--bg-surface #17181b`
     measures **4.3:1**, below the 4.5:1 minimum (§4 table).
   - **Up and down are plain red and green**, with no colour-blind-safe alternative. Bloomberg
     ships two alternate schemes for this, and Unusual Whales ships one.
   - **Tabular figures are opt-in per element** (`.t-num`) rather than the default for every data
     surface. The inline note in `tokens.css` says that is how the jitter happens.
3. The three directions in §3 are **Amber Desk** (Bloomberg-dense), **Graphite** (calm modern
   fintech, the lowest-risk evolution of today's tokens) and **Ledger** (premium editorial). All
   three are dark-first, gold-accented and carry the compass mark.

> **Owner constraint found in code, which every direction respects.** `tokens.css` records that
> numbers, tickers and prices *intentionally* render in Instrument Sans and not a monospace face,
> after a sweep to JetBrains Mono "turned every price/table typewriter". Amber Desk and Graphite
> keep a proportional sans for numbers. Ledger proposes a mono data face, labels that as an
> explicit owner decision, and gives a sans fallback.

---

## 1. The references, one by one

Each entry covers the same ten things: colour, type, density, panel chrome, tables, charts,
freshness, command/keyboard, motion, then what it does best and what to avoid.

### 1.1 Bloomberg Terminal — colour as a type system

- **Colour.** Amber text on black is the hallmark. It began because 1980s monitors were mostly
  orange- or green-on-black, and it was kept on purpose as a brand marker [V: Merz,
  *Amber on Black*]. More important than the amber is that **colour carries meaning**: red =
  stop, green = action, yellow = sector key, amber = *the only editable fields on screen*, and a
  white outline = clickable [V: 03/bloomberg dossier C.5, J.1]. Price up and down use red and
  green, so Bloomberg ships **alternate schemes for deuteranopia and protanomaly**. It estimates
  about 20,000 users have a colour-vision deficiency [V: Bloomberg, *Designing the Terminal for
  Color Accessibility*, search abstract; the page itself returned 403].
- **Type.** A fixed-width, bitmap-feeling face in the classic text functions (TUIs), so every
  column aligns by construction [I]. Newer Launchpad surfaces mix in proportional sans [R:
  dossier J.3, "many functions are absolutely TUIs whereas Launchpad is more mouse-driven"].
- **Density.** The highest of any reference: up to 30 columns × 2,000 securities per monitor, and
  four panels per screen by default [V: dossier K]. The terminal is described as
  "guaranteed to own a lot of screen real estate" [R: dossier J.3].
- **Panel chrome.** Thin title strips that carry the loaded security and the function mnemonic.
  Tab labels *are* mnemonics [V: dossier J.1]. Chrome is minimal; the content is the interface.
- **Tables.** Numbered rows (`Number <GO>` gives each row a keyboard address), per-row colour
  coding, and a "News Heat" bar as a non-price density column [V: dossier C.5; 02-monitors §4].
- **Charts.** Black field, thin lines, many overlays. Charting is the most-criticised area
  ("seven-surface charting curriculum") [V: dossier J.2].
- **Freshness.** Implicit: the screen ticks. There is no general per-number freshness badge [I].
  Its strongest provenance device is **Data Transparency** colouring (green = composite, blue =
  source document) [V: dossier M7].
- **Command line.** One amber input box at the top of every panel. Typing is searching, and
  `<GO>` commits [V: dossier J.1].
- **Motion.** Almost none beyond value ticks. Stability is valued above freshness of design:
  UI bugs users were used to were *re-implemented* rather than fixed [V: dossier J.1].
- **Best at:** colour as a strict vocabulary, total keyboard reach, and density that is earned
  by a stable grammar.
- **Avoid:** the dated "melange of ancient Fortran tabbed forms" [R: dossier J.2], three display
  models side by side, and treating learning difficulty as a retention asset. Do not copy
  amber-*everything*: amber is a role in Bloomberg's system, not a theme.

### 1.2 Koyfin — the friendliest dense product

- **Colour.** Two themes only, Light and Dark. The current Dark Mode is the old "Midnight Blue",
  and the four older dark themes (Midnight Blue, Monochrome, Pitch Black, Deep Ocean) were merged
  into it [V: Koyfin help, *Theme Update*]. Blue-leaning navy greys, a blue interactive accent,
  and red/green only on change columns [I].
- **Type.** A proportional sans throughout, with right-aligned numbers [I]. Chart series
  labels let the user change font size and bold/italic [V: koyfin dossier §F].
- **Density.** **A setting, not a decision.** The right sidebar has a ticker-only compact mode,
  and v3.90 shipped a "Compact Table" [V: dossier J]. **Summary rows** (average, max, min,
  percentiles) sit at the foot of tables [V: dossier J].
- **Panel chrome.** Dashboard widgets with a light title bar. A rail of icons on the right
  dispatches to panels [V: dossier J].
- **Tables.** Percentile-rank columns shown as 0–100 with an inline bar are the signature visual
  primitive, reused in watchlists, screeners and scatter axes [V: dossier J].
- **Charts.** Clean multi-series line charts with a legend in the chart header, and a strong
  "compare" idiom [I].
- **Freshness.** Weak: "a combination of live data and 15-minute delayed data" with no per-name
  indicator [V: dossier J]. **The anti-pattern to avoid.**
- **Command line.** Ticker search box. A colon relative-ticker grammar works in some panes and
  not in others [V: dossier J].
- **Best at:** calm density and percentile bars.
- **Avoid:** blue-navy greys (they read as "generic SaaS" and would fight the gold), and staleness
  that is never shown.

### 1.3 TradingView — the chart standard everyone's eyes are trained on

- **Colour.** The theme API is built on **seven base colours × 19 shades each** (blue, grey, red,
  green, orange, purple, yellow) [V: TradingView Charting Library, *Custom themes API*]. That is
  a systematic ramp rather than hand-picked hexes, and a good model for UCT tokens. Dark-theme
  candles are a teal-green and a coral-red, not pure #0f0 and #f00 [R: third-party colour notes;
  `#089981` and `#F23645` are widely cited and unverified here].
- **Type.** The default chart font stack is `-apple-system, BlinkMacSystemFont, 'Trebuchet MS',
  Roboto, Ubuntu, sans-serif` at **12px** [V: lightweight-charts *LayoutOptions*]. That is a
  system sans with no special numeric face, and axis labels are short enough that this works.
- **Density.** Gated by the plan ladder: 1 chart/2 indicators up to 16 charts/50 indicators [V:
  tradingview dossier J].
- **Panel chrome.** Almost invisible: a 1px divider between multi-chart cells, and a legend
  floating top-left *inside* the chart rather than in a header bar [I].
- **Tables.** The watchlist on the right is narrow, with symbol, last price, change and change %,
  coloured text, and no row fills [I].
- **Charts.** The industry reference. Grid is faint or off, the last-price label is a filled pill
  on the price axis in the candle's colour, and the crosshair has axis-pinned labels [I]. Users of
  UCT will compare every chart to this.
- **Freshness.** A market-status dot plus "delayed" badges by symbol [I].
- **Command line.** Type-to-search on the focused chart: no click and no hotkey [V: dossier H].
- **Motion.** Smooth pan and zoom, with no decorative animation [I].
- **Best at:** the chart itself, and a systematic shade ramp.
- **Avoid:** copying its chrome wholesale. UCT should look like a terminal that *contains*
  TradingView-quality charts, not like a TradingView skin.

### 1.4 LSEG Workspace (Halo design system) — the published-token professional

LSEG publishes its design system as open-source web components (Element Framework, Halo theme),
so this is the one reference whose numbers can be read directly.

- **Colour.** The Halo dark theme uses a black global background, "cod grey" panels and grid
  headers, black grid rows, silver text, and a **blue primary**. Status colours are separate roles:
  confirm = dark green, warning = dark yellow, error = dark red, info = teal [V: refinitiv-ui
  `halo-theme/src/variants/dark/overrides.less`]. **Warning is its own token, separate from the
  accent.** Workspace also ships **four instrument-movement colour templates (American, European,
  Asian 1 and 2)** because up/down colour varies by region [V: lseg dossier §B].
- **Type.** Halo is tied to **Proxima Nova Fin**, a licensed financial cut of Proxima Nova, and
  the theme may only be used inside LSEG products because of that font licence [V: refinitiv-ui
  README via npm/GitHub]. Lesson: serious vendors pick a face with proper figures.
- **Density, as published numbers [V: overrides.less]:** global text 12px, control height 24px,
  icons 16px, tabs 36px, **grid header 28px, grid row 28px**, `@roundness: 0`, `@shadowing: 0`.
  Square corners, no shadows, and borders do all the work.
- **Panel chrome.** Tiles, a Tile Manager, colour-linked groups, and a light/dark switch [V: lseg
  dossier §B].
- **Freshness.** A published density *ceiling* (2,500 streaming RICs on desktop, 1,000 per browser
  tab) [V: lseg dossier §K].
- **Best at:** treating design as tokens, square flat chrome, a separate warning role, and regional
  up/down templates.
- **Avoid:** corporate blue-on-grey blandness. It is competent but has no point of view.

### 1.5 Gödel Terminal — the closest direct analogue

- **Colour.** Black background with Bloomberg-derived accents [R: godelguide.com screenshots;
  colours are not documented in text]. **Colour-linked windows**: a chain icon plus a named colour
  ties windows to one security [V: godel dossier §G].
- **Type and motion.** Its `PDF` settings mnemonic (borrowed from Bloomberg) lets the user choose
  **font sizes** and **table update animations: Fade, Flip Board, Left Slide, Lightning, Red
  Alert, None** [V: godel dossier §G; 02-verification]. That is the only reference that turns
  value-change motion into a user-controlled setting, which is the right instinct.
- **Panel chrome.** Many draggable windows, up to 30 chart windows per screen, and per-window
  settings persisted per account [V: dossier §G].
- **Command line.** A single dead key (backtick) focuses the command bar from anywhere [V: 06
  information-architecture §7].
- **Freshness.** A security missing the feed renders an **empty chart, not an error** [V: dossier
  §F]. **Exactly the anti-pattern to avoid.**
- **Best at:** keyboard focus key, colour-linked windows, user-chosen update motion.
- **Avoid:** silent empty states, and "Bloomberg cosplay" (copying the amber look without the
  colour discipline that makes Bloomberg's amber mean something).

### 1.6 Unusual Whales — dense feeds made legible by grouping

- **Colour.** Dark UI with saturated green/red for bullish/bearish flow and a yellow highlight
  for flagged rows [R: UW dossier]. **Colour schemes for visual impairment** shipped 2024-06-06,
  which is rare in this category [V: UW dossier J, changelog]. Users complain when a chart
  colour control is removed (the "yellow line" on Market Tide) [V: dossier J].
- **Type.** Proportional sans, small sizes, uppercase group headings [R].
- **Density.** About 60 filter controls in one scrolling rail, **legible because the grouping is
  semantic** (TIME RANGE, SIDE, CHAIN ACTIVITY, ...) [V: dossier J]. A dense flow table with
  struck-through rows for cancelled or modified trades, and a legend that explains every glyph
  [V: dossier J].
- **Command line.** `Ctrl-K` palette with a `/cmds` mode [V: dossier H].
- **Freshness.** Weak and reported by users ("periscope not updating") rather than signalled by
  the product [V: dossier J].
- **Best at:** in-product legends, strike-through as a data state, semantic group headings.
- **Avoid:** neon saturation everywhere. When every row is coloured, no row stands out.

### 1.7 Linear — "dense but calm" (non-trading reference)

- **Colour.** Themes are *generated*: three inputs (base colour, accent colour, contrast) produce
  100+ variables in **LCH**, a perceptually uniform colour space, and the same machinery produces
  high-contrast themes automatically [V: Linear, *How we redesigned the Linear UI (part II)*]. The
  2024 redesign deliberately reduced how much accent colour bleeds into the greys, and a later
  refresh moved from cool, bluish greys to **warmer greys** with less saturation [V: Linear,
  *A calmer interface for a product in motion*].
- **Type.** Inter for body text and Inter Display for headings [V: part II].
- **Density.** High information density, with navigation that recedes: a dimmed sidebar, a
  compact tab bar with smaller icons, and fewer icons overall [V: *calmer interface*].
- **Panel chrome.** Fewer separators and softer border contrast. In their words, structure
  "should be felt not seen" [V: *calmer interface*].
- **Motion.** Fast and functional (~100–150ms), with nothing decorative [I].
- **Best at:** **one accent, warm greys generated from a formula**, and chrome that recedes so the
  content leads. Linear's move to warm greys is directly relevant to a gold brand: gold sits badly
  on blue-greys and well on warm ones.
- **Avoid:** taking "calm" too far. A trading terminal still needs hard row separation on wide
  numeric tables, which Linear's issue lists do not.

### 1.8 Robinhood Legend — premium consumer-grade dark trading (chosen premium reference)

- **What is documented.** Browser-based desktop platform, up to 8 charts per window, preset and
  custom layouts, and **dynamic linking between widgets** [V: Robinhood newsroom, *The Legend
  Awakens*]. The brand system pairs a **serif for headlines with a warm geometric sans for product
  chrome** (Capsule Sans; serif display faces Nib and, in later system descriptions, Martina
  Plantijn) [V: Robinhood, *A visual identity that better reflects our vision*; R: third-party
  design-system notes].
- **Visual character [I, not checked against a live session].** Near-black canvas, one vivid
  brand accent used very sparingly, generous radius, large clear numerals for the headline
  position value, and small, quiet supporting data.
- **Best at:** making a trading tool feel *premium* rather than *technical*. The serif plus sans
  pairing shows that a financial UI can have editorial voice without losing legibility.
- **Avoid:** consumer-level density (too low for a research terminal), and a single neon accent
  doing double duty as "up" (Robinhood's green is both brand and gain colour, which is the same
  conflict as UCT's gold = warning).

### 1.9 Also seen in the 03 dossiers (one line each)

Benzinga Pro hard-caps a workspace at 4 tools, a density ceiling shown as a visual constraint.
Quartr and AlphaSense are document readers with deliberately low density, and the good reference
for UCT's *reading* surfaces (filings, transcripts), not its grids. FinChat/Fiscal.ai uses
card-and-chart layouts in light-first SaaS styling, which is not a terminal look.

---

## 2. Patterns the best ones share

1. **Tabular figures everywhere numbers live.** Bloomberg gets this from a fixed-width face, LSEG
   from Proxima Nova *Fin*, and the rest from `tnum`. Digits that change width make a live grid
   shimmer. Numbers are right-aligned, with decimals aligned within a column.
2. **Colour is reserved for meaning, and the meanings are few.** Bloomberg's five-role vocabulary
   (stop, action, sector, editable, clickable) is the strongest example. Neutral text carries most
   of the screen, and colour appears only where something is up, down, editable, selected or
   wrong.
3. **One accent.** Bloomberg amber, LSEG blue, Linear's single user-chosen accent, Robinhood's
   one brand colour. The accent marks focus, selection and the command line. **It never encodes
   data**, and it is never also the warning colour.
4. **Status roles are separate tokens:** confirm, warning, error and info (LSEG Halo), each with a
   glyph, so meaning survives without colour.
5. **Up and down are a locale and accessibility setting**, not a constant: LSEG's four regional
   templates, Bloomberg's two colour-blind schemes, Unusual Whales' visual-impairment schemes.
6. **One panel header everywhere.** Same height, same position for the loaded entity, the
   function name, the freshness indicator and the overflow menu. Bloomberg and Gödel put the
   loaded security in the strip, and LSEG fixes tab and header heights as tokens.
7. **Flat, square, border-driven chrome.** LSEG has `roundness 0` and `shadowing 0`, Bloomberg
   has none of either, and Linear has softer borders and fewer of them. Depth comes from 2–4
   background steps, not shadows.
8. **Density is a token and a control.** LSEG 28px rows, Koyfin Compact Table, Gödel font sizes.
   Rows per screen is a deliberate number.
9. **Charts have a quiet field.** Faint or no grid, last-price pill on the axis, the legend inside
   the chart, and series colours from a fixed ramp.
10. **Motion is a signal, not decoration.** Value-change flash is the one animation that earns its
    place. Gödel makes it a user setting. Everything else is instant or under 150ms.
11. **The worst ones hide staleness** (Koyfin's mixed delay, Gödel's empty chart, UW's silent
    stalls). The best show freshness *per panel* in the same place every time. This is a gap in
    the field that UCT can own visually.

---

## 3. Three candidate visual directions

All three keep the UCT brand: dark-first, gold accent, and the compass mark in the top-left of the
L0 strip. All three use the same **role names**, so the choice changes values, not code
structure: `bg-0` canvas, `bg-1` panel, `bg-2` header or raised surface, `bg-3` hover or
selection, `line`, `text-1/2/3`, `accent`, `up`, `down`, `warn`, `info`, and `up-cvd/down-cvd` for
the colour-blind mode. Contrast ratios in §4 were computed with the WCAG 2.x formula.

### 3.1 Direction A — "Amber Desk"

**Bloomberg-dense, gold-amber on near-black, built for keyboard speed.** A near-black canvas, warm
off-white data, and gold-amber used the way Bloomberg uses amber: as a *role*. It marks the command
line, editable fields, the focused panel and the compass, and nothing else. Panels butt together
with 1px hairlines, with no gaps and no radius. Headers are 20px strips carrying `CHANNEL ·
ENTITY · FUNCTION` in caps, and a freshness dot at the far right. Every list row is numbered so
`3 <Enter>` opens row 3. A condensed sans fits more columns without turning prices into a
typewriter. It should look like a professional instrument, not a theme.

| Role | Value | Notes |
|---|---|---|
| bg-0 / bg-1 / bg-2 / bg-3 | `#000000` / `#0b0a08` / `#16140f` / `#221f17` | warm blacks, 4 steps |
| line | `#2a261d` | 1px hairline, the only separator |
| text-1 / 2 / 3 | `#ece4cf` / `#b3aa93` / `#8a826e` | warm parchment ramp |
| accent (gold-amber) | `#f0b93a` | command line, editable, focus, compass |
| up / down | `#3fd18a` / `#ff6b5e` | always with `+`/`−` and ▲▼ |
| up-cvd / down-cvd | `#5aaeff` / `#ff9a3c` | blue/orange, the Bloomberg/Okabe-Ito approach |
| warn / info | `#ff8f3d` + ⚠ glyph / `#6cb6ff` | warn is never the accent |

- **Type.** Data and labels in **IBM Plex Sans Condensed** (Google Fonts, `tnum` supported) at
  11–12px. Command line in **JetBrains Mono** 13px (input only, not prices). Headers in Plex Sans
  Condensed 600, caps, +0.04em tracking.
- **Density.** Highest: 20px rows, 11px data, 2px/6px cell padding. About 40 rows per panel
  at 1080p in a 2×2 board.
- **Panel chrome.** 20px header on `bg-2`. The focused panel gets a 1px gold top border, not a
  glow. Tabs are mnemonic labels in the header strip.
- **Tables.** No zebra striping, 1px row lines at `line`, numbered first column, right-aligned
  numerics, change cells as coloured *text* (never filled), and a selected row shown as `bg-3`
  with a 2px gold left bar.
- **Charts.** Black field, no grid, 1px candles with hollow up and filled down (shape carries
  direction even in greyscale), last-price pill on the axis, and gold reserved for the user's
  drawn levels.
- **Motion.** Value-change flash at 300ms (text colour pulse), user-switchable (Gödel model).
  Nothing else animates.
- **Suits:** the desk power user and active swing trader running 4–9 panels, keyboard-first, who
  already knows Bloomberg or Gödel.
- **Risk:** intimidating for new members, and close to "Bloomberg cosplay" unless the
  colour-role discipline is enforced.

### 3.2 Direction B — "Graphite"

**Calm modern fintech: layered warm greys with one gold accent (Linear-style).** The evolution of
today's tokens. Four warm-grey layers give depth without borders everywhere. Gold appears only
for focus, the active tab underline, the selected-row bar and the compass, so when it shows up it
means "you are here". Panel headers are quiet, 28px with sentence case and a muted entity label.
Numbers are crisp Instrument Sans with tabular figures. Separators are soft except inside numeric
tables, where rows stay clearly divided. The palette is generated, Linear-style, from three inputs
(base, accent, contrast), which also gives UCT a free high-contrast mode.

| Role | Value | Notes |
|---|---|---|
| bg-0 / bg-1 / bg-2 / bg-3 | `#0e0f11` / `#15161a` / `#1c1e22` / `#24262b` | almost today's scale |
| line | `#2a2c31` (tables) / `#222428` (chrome) | two weights: hard in data, soft in chrome |
| text-1 / 2 / 3 | `#ecebe6` / `#aaa79f` / `#8c8981` | replaces today's `--text-muted #cfcac0`, which sits too close to text-1 to make a hierarchy |
| accent (gold) | `#dcbb5e` | today's `--ut-gold`, unchanged |
| up / down | `#3ccf8e` / `#f47067` | down raised from 4.3:1 to 6.3:1 |
| up-cvd / down-cvd | `#5aaeff` / `#ff9a3c` | |
| warn / info | `#f0883e` + ⚠ / `#79a8f7` | warn is split from gold |

- **Type.** **Instrument Sans** for everything (the owner's existing choice; `tnum` on by default
  on every data container, not opt-in). 12px data, 13px body, 11px caps labels at +0.06em. Command
  line in Instrument Sans 14px. (Inter + Inter Display is the alternative pairing if Instrument
  Sans' `tnum` coverage proves incomplete. That needs checking; see §5.)
- **Density.** Medium: 26px rows, 12px data, 4px/10px padding. About 28 rows per panel at 1080p.
  Compact (22px) and Comfortable (30px) as one board-level density token, per 06 IA §5.
- **Panel chrome.** 28px header on `bg-1` with no fill change. The title in text-1 and the entity
  in text-2, separated by a hairline. The freshness indicator is a small dot plus a relative age
  ("12s"). 6px radius on the panel and 2px gaps between panels on `bg-0`.
- **Tables.** Sticky header in 11px caps text-3, 1px row lines, hover `bg-2`, selected `bg-3` + gold
  left bar, change shown as coloured text with an optional 15%-alpha cell tint behind large moves
  only. Koyfin-style percentile bars for rank columns, with summary rows at the foot.
- **Charts.** `bg-1` field, grid at 4% white, TradingView-familiar teal-green and coral candles,
  volume at 35% opacity, last-price pill, gold for user levels and alerts only.
- **Motion.** 120ms ease-out on hover and panel focus, 250ms value flash (background tint, not
  text), and `prefers-reduced-motion` turns the flash into a static ▲▼.
- **Suits:** the broad member base: swing traders who live in charts and watchlists for an hour a
  day and want calm, legible density. **The safest choice**, because it is mostly a token edit.
- **Risk:** could feel generic SaaS. Gold discipline and the compass carry the brand, so they must
  not be diluted.

### 3.3 Direction C — "Ledger"

**Premium editorial: serif headings, ruled tables, mono-figured data.** UCT as a research
publication that happens to be live. A warm ink-black canvas, panel and page titles in a refined
serif, and tables drawn like a financial broadsheet: horizontal rules only, no boxes, a heavier
rule under the header, and gold used for rules on key rows and for the compass. Numbers sit in a
crisp figure face, so the data reads like a printed ledger. Lower density and more air, a clear
reading hierarchy, and well suited to UCT's research, write-up, earnings and Compass-mentor
surfaces.

| Role | Value | Notes |
|---|---|---|
| bg-0 / bg-1 / bg-2 / bg-3 | `#0b0a08` / `#100e0b` / `#18150f` / `#221e16` | ink, warm |
| line | `#2c271d` (rules), `#3a3326` (header rule, 1.5px) | horizontal only |
| text-1 / 2 / 3 | `#efe6d2` / `#b8ad96` / `#8f856f` | paper-toned |
| accent (gold) | `#d9b45f` | rules, compass, focus; small-caps section labels |
| up / down | `#5cc995` / `#ef7a6b` | muted, editorial saturation |
| up-cvd / down-cvd | `#5aaeff` / `#ff9a3c` | |
| warn / info | `#e8913f` + ⚠ / `#8fb3e0` | |

- **Type.** Headings in **Instrument Serif** (Google Fonts, same family as Instrument Sans) at
  18–22px. UI labels in **Instrument Sans**. **Data in IBM Plex Mono 12px.** **OWNER DECISION
  REQUIRED:** this reverses the recorded "no mono for prices" choice in `tokens.css`. The fallback
  that keeps the direction intact is Instrument Sans with `tnum` and `lnum` for data, with mono
  only for tickers and codes.
- **Density.** Lowest: 30–32px rows, 12–13px data, 6px/12px padding. About 22 rows per panel at
  1080p. Best with 1–4 panels.
- **Panel chrome.** No panel boxes on reading surfaces. A serif title, a small-caps meta line
  (entity · source · "as of 14:32:05 ET"), and a gold hairline under the title. Grid surfaces get
  1px `line` frames with 0 radius.
- **Tables.** Broadsheet style: rules only, a 1.5px header rule, text-3 small-caps column heads,
  numbers right-aligned in mono, total and summary rows above a double rule, and no row tints.
- **Charts.** Line-first (area under price at 8% opacity), candles optional, annotations in the
  serif italic, and a light dotted horizontal grid like a printed chart.
- **Motion.** The least: no value flash by default (a 1px underline pulse if enabled), and fades
  of about 150ms on panel content swap.
- **Suits:** the research-led swing trader and the Compass mentor experience: reading earnings,
  theses and post-mortems, a few names deeply. It is premium and distinctive, and the strongest
  brand statement of the three.
- **Risk:** the weakest at 9-panel live monitoring, and the mono decision touches the whole
  product.

### 3.4 Side by side

| | A — Amber Desk | B — Graphite | C — Ledger |
|---|---|---|---|
| Feel | instrument | calm tool | publication |
| Rows/panel (1080p, 2×2) | ~40 | ~28 | ~22 |
| Data face | Plex Sans Condensed | Instrument Sans tnum | Plex Mono (owner call) |
| Chrome | hairlines, 0 radius, 20px headers | soft layers, 6px radius, 28px headers | rules only, serif titles |
| Gold used for | command line, editable fields, focus | focus, selection, active tab | rules, titles, compass |
| Change from today | large | small (mostly token values) | large |
| Best user | desk / power user | broad member base | research / mentor surfaces |

A hybrid is credible: **B as the default shell, A as the "Compact" density preset, and C's
typography for reading surfaces** (filings, write-ups, Compass). All three share role names, so
this costs little.

---

## 4. Non-negotiables (any direction)

1. **Contrast, WCAG 2.x AA:** text below 18px ≥ **4.5:1** on its *actual* background (check
   on `bg-2` headers and `bg-3` selected rows, not only the canvas). Large text and essential
   glyphs ≥ 3:1. Non-text UI that carries meaning (focus ring, up/down glyphs, chart lines users
   must read) ≥ 3:1.
2. **Up and down never rely on hue alone.** Every change carries a sign (`+`/`−`) and, in grids,
   ▲▼. Candles differ by fill (hollow vs filled) as well as colour. A **colour-blind mode**
   (blue/orange) is a one-click setting, and regional up/down templates are a later option (LSEG).
3. **Tabular figures by default** on every data surface (`font-variant-numeric: tabular-nums
   lining-nums` on the panel root, not per cell). Numbers are right-aligned with decimals aligned,
   and the minus is a true minus sign `−`, not a hyphen.
4. **One accent, never data.** Gold is not an up colour, not a warning colour and not a series
   colour. Warning gets its own token and a ⚠ glyph.
5. **Freshness is visible on every panel, in the same place** (the header's right end): live,
   delayed by N min, stale since time, or error. No empty chart without an explanation.
6. **One panel header component** (height, entity slot, function, freshness, menu) across every
   panel type.
7. **Minimum sizes:** data no smaller than 11px, and touch targets keep the existing `--tap-min`
   floor at ≤1024px.
8. **Motion respects `prefers-reduced-motion`**, and value flash is user-switchable.
9. **Focus is always visible:** a 1px or 2px gold outline, never only a background shift.

Measured contrast (WCAG ratio, against the stated background):

| Palette | Background | text-1 | text-2 | text-3 | accent | up | down |
|---|---|---|---|---|---|---|---|
| **Today** | `#17181b` | 15.4 | 10.9 | — | 9.6 | 6.3 | **4.3 (fails)** |
| A Amber Desk | `#0b0a08` | 15.6 | 8.6 | 5.2 | 11.0 | 10.1 | 7.1 |
| A on header | `#16140f` | 14.5 | 8.0 | 4.8 | 10.3 | — | — |
| B Graphite | `#15161a` | 15.1 | 7.5 | 5.2 | 9.7 | 9.0 | 6.3 |
| B on raised | `#1c1e22` | 14.0 | 6.9 | 4.8 | 9.0 | 8.4 | 5.8 |
| C Ledger | `#100e0b` | 15.5 | 8.7 | 5.3 | 9.8 | 9.4 | 7.0 |
| C on surface | `#18150f` | 14.7 | 8.2 | 5.0 | 9.2 | 8.9 | 6.6 |

Colour-blind pair on A and B backgrounds: up-cvd `#5aaeff` 8.4 / 7.7, down-cvd `#ff9a3c` 9.4 / 8.6.
The text-3 tier sits at 4.8–5.3 by design: still AA, but the lowest tier, so it is used for
labels, not values. Recheck text-3 on `bg-3` (selected rows) during build.

---

## 5. What the owner should look at before choosing (unverified items)

- Open Bloomberg (any screenshot set), Gödel, Koyfin Dark, TradingView dark and LSEG Workspace dark
  side by side at 1080p, and count rows per panel. The density numbers in §3 are targets, not
  measurements.
- Confirm **Instrument Sans `tnum` coverage** (all digits, `−`, `%`, `.`) in the shipped font
  files. `index.html` notes an "Instrument Sans Tab" variant was baked in at one point, which
  suggests the stock font needed help. This decides whether B is viable as written.
- Build a one-page token swatch of A, B and C on a real UCT panel (watchlist, chart, news) before
  committing. A choice made from hex tables alone will be wrong.
- Run the up/down pairs through a deuteranopia and protanopia simulator, and check that green vs
  red differ in *lightness* as well as hue.

---

## 6. Recommendation (hypothesis, for the owner to accept or reject)

Ship **B — Graphite** as the default, because it fixes the four current defects (§0) with token
edits and keeps the owner's typography. Offer **A's density** as the Compact preset for the desk.
Prototype **C's serif-plus-rules treatment** on the Compass mentor and write-up surfaces, where its
editorial voice pays off and its low density costs nothing. Do not mix all three on one board.

---

## 7. Sources

- Ted Merz, *Amber on Black* (2021). https://ted-merz.com/2021/06/26/amber-on-black/
- Bloomberg, *Designing the Terminal for Color Accessibility* (search abstract only; page 403).
  https://www.bloomberg.com/company/stories/designing-the-terminal-for-color-accessibility/
- Bloomberg UX accessibility. https://www.bloomberg.com/ux/accessibility/
- Linear, *How we redesigned the Linear UI (part II)*. https://linear.app/now/how-we-redesigned-the-linear-ui
  Short quote used: "Structure should be felt not seen" from
  *A calmer interface for a product in motion*. https://linear.app/now/behind-the-latest-design-refresh
- LSEG / Refinitiv Element Framework (Halo design system). https://github.com/Refinitiv/refinitiv-ui
  Dark overrides: https://github.com/Refinitiv/refinitiv-ui/blob/v7/packages/halo-theme/src/variants/dark/overrides.less
  Halo theme package and font licence note: https://www.npmjs.com/package/@refinitiv-ui/halo-theme
- TradingView Charting Library, *Custom themes API*. https://www.tradingview.com/charting-library-docs/latest/customization/styles/custom-themes/
- TradingView lightweight-charts, *LayoutOptions*. https://tradingview.github.io/lightweight-charts/docs/api/interfaces/LayoutOptions
- Koyfin help, *Theme Update: Light and Dark Modes*. https://www.koyfin.com/help/theme-update-light-and-dark-modes-in-koyfin/
- Gödel Terminal beginner's guide (third party). https://godelguide.com/godel-terminal-complete-beginners-guide/
- Robinhood, *The Legend Awakens*. https://robinhood.com/newsroom/the-legend-awakens/
- Robinhood, *A visual identity that better reflects our vision*. https://robinhood.com/us/en/newsroom/a-visual-identity-that-better-reflects-our-vision/
- Unusual Whales features. https://unusualwhales.com/features
- In-repo: `docs/terminal-research/03-competitive-research/{bloomberg,koyfin,tradingview,
  lseg-workspace,godel,unusual-whales}/dossier.md`;
  `docs/terminal-research/06-ux-and-information-architecture/{information-architecture,
  personalization-patterns,command-grammars}.md`; `app/src/styles/tokens.css`.
