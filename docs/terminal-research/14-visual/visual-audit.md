# UCT Terminal — visual audit (start of the visual redesign)

Branch `terminal/visual-audit`, measured at `c6befe49c` on 2026-10-06. Read-only audit: no
code was changed. Every count below is reproducible with the command printed beside it (the
shared scope definition and helper functions are in **Appendix A**). Line numbers are dated
claims: re-read the line before acting on one.

**What "the terminal" means here.** The shell (`app/src/pages/terminal/`) plus every component
a terminal panel can render. `app/src/pages/terminal/functions.js` has **68 codes**: 52 variants
open a panel or surface, 20 are doors that leave the terminal, and they reach **49 distinct
panel components** (`node -e` over `FUNCTIONS`, Appendix A.9). Those 49 resolve through
`panels.jsx` (`PANEL_IMPORTERS`) and `surfacePanels.js` (`SURFACE_IMPORTERS`, 7 whole pages).

Three measurement scopes are used throughout:

| scope | paths (under `app/src/`) | CSS files | JS/JSX files | CSS lines |
|---|---|---|---|---|
| **SHELL** | `pages/terminal` | 2 | 25 | 1,023 |
| **PANELS** | `pages/research/tabs`, `pages/research/depth`, `pages/research/ResearchPage.module.css`, `components/research`, `components/research-kit`, `pages/optionsAnalytics`, `pages/screener/options` | 47 | 115 | 3,432 |
| **SURFACES** | `pages/Calendar.jsx` + `pages/calendar`, MorningWire, UCT20, Breadth + `pages/breadth`, Screener, FlowScoreboard, CatalystsHistory, PortfolioHeat (each `.jsx` + `.module.css`) | 32 | 125 | 10,139 |

Test files, `__tests__/` and `testing/` are excluded from every count. `pages/screener/shell/`
(the stock scanner the SCR surface mounts) is **not** in SURFACES; its numbers are not here.

---

## 1. The visual language as it actually exists (one page)

**Tokens exist and are good; the panels mostly do not use them.** `styles/tokens.css` (965
lines, 196 distinct custom properties) defines a complete scale: an 8-step type ramp
(`--text-xs` 10px … `--text-3xl` 24px, bumped +1px on phones at `tokens.css:603-610`), a 7-step
space scale (4/8/12/16/24/32/48), 6 radii (4/6/8/12/16/pill), 5 shadows, 3 durations, 2 easings,
a 5-step score ramp, a 7-step heat ramp, and global text classes `.t-page-title`, `.t-label`,
`.t-caption`, `.t-num` (`tokens.css:862-915`). The shell uses that system; most embedded panels
and every whole-page surface hand-roll their own.

| dimension | what is in the code | command (Appendix A) |
|---|---|---|
| **Palette** | 3,042 `var(--…)` references in CSS against **94 distinct raw hex** values in CSS (293 occurrences, 182 of them as a `var(--x, #hex)` fallback) and **121 distinct hex** in JS (296 occurrences). 286 `rgb()/rgba()` literals in CSS + 48 in JS. 105 `rgba(255,255,255,a)` white-alpha literals in CSS. Brand gold is hard-coded **41 times as a bare hex** plus **96 times as `rgba(220,187,94…)`/`rgba(201,168,76…)`**. | A.2, A.3 |
| **Type sizes** | 813 `font-size` declarations in CSS: **627 literal**, 175 via `--text-*`. **29 distinct literal sizes** (6px … 46px, including 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5px). Top five: 12px ×142, 11px ×118, 13px ×99, 10px ×98, 9px ×37. Plus 63 inline `fontSize:` in JSX (values 7, 9, 10, 11, 12, 18, 20). SURFACES use **zero** `--text-*` tokens (540 literal). | A.1 |
| **Weights** | 700 ×181, 600 ×126, **800 ×65**, 500 ×23, 400 ×12, 900 ×1 (plus 6 with `!important`). Instrument Sans only (`--font-mono` deliberately = the sans, `tokens.css:218-225`). | A.4 |
| **Line height / tracking** | 21 distinct `line-height` values; **37 distinct `letter-spacing`** values (0.5px ×28, 0.6px ×26, 0.3px ×23, 1px ×20, 0.4px ×18, 2px ×17, 1.5px ×12; `var(--ls-label)` only ×11). | A.4 |
| **Spacing** | 584 `padding` declarations with **225 distinct values**; only 77 use `--space-*`. Of 1,633 px lengths in padding/margin/gap, **655 sit on the 4/8/12/16/24/32/48 scale and 978 are off it** (6px ×194, 10px ×190, 2px ×122, 14px ×97, 5px ×79, 3px ×49, 18px ×48, 7px ×42). 48 distinct `gap` values; `gap: 8px` ×62 and `gap: var(--space-sm)` ×46 are the same number written two ways. | A.5 |
| **Radius** | 326 `border-radius` declarations, **31 distinct values**, 170 via `--radius-*`. Off-scale literals: 6px ×25, 10px ×23, 3px ×13, 9px ×11, 20px ×11, 7px ×8, 5px ×7. | A.6 |
| **Shadow** | 59 `box-shadow` declarations, 36 distinct, **3** use a `--shadow-*` token. The most common is a gold pulse ring `0 0 0 0 rgba(220,187,94,…)` (×17 across its keyframe steps). Cards are flat (border, no shadow) almost everywhere. | A.6 |
| **Borders** | 1px `var(--border)` is the norm for cards, table rows and panel chrome. The shell separates panels with a 1px `gap` over a `var(--border)` background (`TerminalShell.module.css:340-349`) and a 1px accent outline on the focused panel (`:379-381`). | read |
| **Iconography** | `UIcon` (`components/ui/UIcon.jsx`, **103 glyphs**, not the "~65" CLAUDE.md says) is used **85 times in 32 files** in scope, **0 times in the shell**. 16 of the 85 pass `gold={false}`; the rest render the gold-gradient default. 44 `<UIcon>` carry an inline `style={{ verticalAlign… marginRight… }}` to align with text. Unicode glyphs act as icons in the shell and several panels (§2, item 4). No third-party icon library is imported anywhere in scope. | A.7 |
| **Motion** | 80 `transition` declarations, 29 `animation`, 17 `@keyframes`, 14 `prefers-reduced-motion` blocks. Durations are literal (0.15s ×31, 0.12s ×30, 0.1s ×24, 120ms ×6); `--duration-*` used 14 times, `--ease-*` 14 times. **The shell has no transitions at all.** `UIcon` states at `UIcon.jsx:639-641` that it has *no* shimmer (CLAUDE.md still says "slow shimmer"). | A.8 |
| **Inline styles** | **403 `style={{`** in scope: shell 6, research tabs 74, depth 6, options 7, Calendar 32, Breadth (+`breadth/`) **247**. | A.10 |
| **Breakpoints** | CSS: `max-width:640px` ×58, `max-width:1024px` ×45, `min-width:641px` ×12, `min-width:1025px` ×4 — and four non-canonical (520, 700, 768, 900; §2 item 10). `@container` ×9 in 3 files. | A.11 |
| **Charts** | Four engines on screen: ECharts (11 files import it; `research-kit/charts/echartsCore.js`), Lightweight Charts via `StockChart` (GP, TECH, Calendar modal), Chart.js (Breadth COT tab), and hand-drawn `<svg>` (27 occurrences in 22 files — IV spark, straddle history, Market Tide, payoff, every Breadth "view"). | A.7 |

**Character, in one paragraph.** The shell reads as a dense, flat, dark command console:
`--bg` canvas, `--bg-surface` bars, 1px borders, gold monospace-styled codes (`.code`,
`TerminalShell.module.css:230-235`), uppercase 10px rail/menu headings, 26-32px control height
on desktop, no icons, no motion. The research tabs read as a quieter "card" system
(`ResearchPage.module.css:61-62`: surface card, 10px radius, 10px uppercase muted card title).
The depth and options panels read as plain documents (bold 13-14px headings, prose notes,
12px tables). The whole-page surfaces each carry their own full design: a 22px 800-weight
uppercase page title (PortfolioHeat), a marketing hero (FlowScoreboard), a calendar with its
own alias palette, a 1,388-line Breadth page with 18 hand-drawn chart "views". Inside one 2×2
board a member can see all four registers at once.

---

## 2. Inconsistencies, ranked by how visible they are to a member

Ranking rule: (a) seen on every board, (b) seen whenever a common code is opened, (c) seen only
in a mode, theme or width a member must choose.

### (a) Seen on every board

**1. There is no shared panel inset — content sits flush against the panel edge in ~30 panels
and 16-24px in from it in the surfaces.** `.panelBody` has no padding
(`TerminalShell.module.css:645-651`). The research tabs wrap their content in `.finWrap`
(`ResearchPage.module.css:72`, no padding) because on `/research/:sym` the page's `.page` supplies
`18px 22px 26px` (`ResearchPage.module.css:1`) — and the terminal does not render `.page`. Depth
panels use `.panel { border-top; padding-top: 12px }` (`Depth.module.css:3`) with no side padding,
so their text starts at x=0. `MyResearchPanel.jsx:13` patches this for one panel with an inline
`padding: var(--space-md)` and a comment admitting the workspace "sat flush against the panel
border". Meanwhile surfaces bring their own page padding: UCT20/PortfolioHeat `20px 24px`,
Breadth `20px 24px`, FlowScoreboard `16px 20px 40px` + `max-width:1200px`, CatalystsHistory
`16px 20px` + `max-width:1400px`, OptionsScreener `12px 20px`, HelpPanel `var(--space-md)`.
Side by side, two panels' text starts at 0px and 24px.

**2. Every panel has two headers, and the second one varies per panel.** The shell header
(`TerminalShell.jsx:216-258`: group dot · gold code · muted label · freshness · "Full page" ·
⧉ ↗ ×) is followed by whatever the embedded component draws. Measured treatments of the
in-body title:

| style | where | definition |
|---|---|---|
| 10px uppercase muted "card title" | research tabs | `.ct`, `ResearchPage.module.css:62` (0.6px tracking) |
| 10px uppercase muted | FA/EE | `.title`, `FmpDepth.module.css:13-19` (0.06em) |
| 13px 700 `--text` | EEH, PPL, FEED | `.title`, `ResearchCov.module.css:4` |
| 14px 700 `--text` | EVTS, FSRC, ERX, FTD, ATTN, BRKE | `.panelTitle`, `Depth.module.css:4` |
| 14px 700 `--text` | FIL | `.h`, `FilingChangesTab.module.css:7` |
| 13px 700 `--text-heading` + provenance pill | VOL, POS, OHIS, TIDE, STRS | `.title`/`.badge`, `optionsAnalytics.module.css:4-5` |
| `<PageHeader icon title>` (gold UIcon + page title) | WIRE, U20, BRD | `components/PageHeader.jsx` |
| custom `<h1>` 22px 800 uppercase | RISK | `PortfolioHeat.module.css:2` |
| custom `<h1>` + inline-styled UIcon | CATH | `CatalystsHistory.jsx:93` |
| marketing hero `<h1>` "Every pick, tracked…" | FREC | `FlowScoreboard.jsx:96` |
| `<h1>` heading | SCR | `Screener.jsx:95` |
| calendar header titled **"UCT Terminal"** | CAL, ERN | `CalendarHeader.jsx:681` |
| uppercase 10px `.helpGroup` | HELP, MOVE | `TerminalShell.module.css:668-674` |
| none | GP, SEAS, OMON, OBT, IVH | — |

The surface pages render with no props (`surfacePanels.js` header; `functions.js` "rendered as-is"),
so `Screener` and `FlowScoreboard` — which already accept `embedded` and hide their `<h1>` on the
/charts board (`Screener.jsx:78-95`, `FlowScoreboard.jsx:79-89`) — show their full-page title
inside a terminal panel. The CAL panel says "UCT Terminal" inside the UCT Terminal.

**3. Five loading treatments, and most panels show two in sequence.** First the shell's
`<Suspense fallback>` "Loading CAL…" line (`TerminalShell.jsx:276`, `.panelEmpty` 16px padding,
muted text), then the panel's own:
- a 280px-tall centred box `.soon` (`ResearchPage.module.css:196-200`): CN, CATS, ANR, RTG, OWN, MB, DR;
- an inline muted line `.fnote`/`.note`: TECH, TRAN, CF, FLOW, DES, every depth panel, every options panel, OSCR, FA, EE;
- muted text **inside a bordered card**: HIS (`HistoryTab.jsx:86`);
- skeleton components: U20 (`SkeletonTable`), WIRE (`SkeletonTileContent`), CAL (`.skeletonWrap`, `Calendar.jsx:861`);
- nothing: GP (the chart draws its own).
There are **61 "Loading …" text strings** in scope against **13 skeleton usages** (A.12). No
spinner exists in the shell; 2 spinner classes exist in scope.

**4. Unicode glyphs stand in for icons, including generic emoji.** CLAUDE.md bans generic emoji
and names `UIcon` as the only icon source; the shell uses neither rule:
- panel actions are text glyphs `⧉` `↗` `×` (`TerminalShell.jsx:247,251,255`) and the notice close is `×` (`:1205`) — while `UIcon` has `copy`, `x`, `link`, `expand`;
- the favourite toggle is `★`/`☆` (`BoardsMenu.jsx:164`) — `UIcon` has `star`/`star-fill`;
- **real emoji** `👍` `👎` `✎` in the Morning Wire feedback controls (`MorningWire.jsx:214-216`, DOM-injected HTML, so `UIcon` would need a static SVG string) — `UIcon` has `thumbsUp`/`thumbsDown`/`edit`;
- `⚠` before a concentration warning (`PortfolioHeat.jsx:126`) — `UIcon` has `warning`;
- `❚❚`/`▶` as the Breadth scrubber play control (`BreadthScrubber.jsx:88`) — `UIcon` has `pause`;
- checklist marks: TECH writes `'✓'`/`'✗'` as text (`TechnicalTab.jsx:66`) while RTG, one tab away, renders `<UIcon name="check">`/`<UIcon name="x">` (`RatingsTab.jsx:124`).
Glyph census in rendered JSX (comments excluded, A.7): `·` ×257, `…` ×105, `→` ×38, `×` ×33,
`▲`/`▼` ×12 each, `★` ×9, `✓` ×7. The `★`/`◆` inside SVG `<text>` (RadarView, TreemapView,
TugView) are the documented exception.

### (b) Seen whenever a common code is opened

**5. Five different "card" treatments for sibling panels.**
`ResearchPage .card` = `--bg-surface`, 1px border, **10px** radius (no such token; tokens are
8/12), `11px 12px` padding (`:61`) · `FmpDepth .card` = `--bg-elevated`, **8px** radius,
`10px 12px` (`FmpDepth.module.css:4-10`) · `optionsAnalytics .panel` = `--bg-surface`, 8px radius,
`10px 12px`, **`margin-top: 14px`** (`:2`) · `ResearchCov .card` = no border, no background
(`:3`) · `Depth .panel` = top border only (`:3`). Calendar cards are 12px radius with a hover
lift (`Calendar.module.css:31-45`). So DES/CN (surface cards) sit beside FA/EE (elevated cards)
beside PPL (no card) beside ERX (rule only).

**6. Tables: at least 10 independent table rule-sets in 9 PANELS/SHELL files, none shared.** Cell padding is `4px 8px` in
seven rules, `3px 4px` in `ResearchPage .tbl` (`:64`), `3px 8px` in `optionsAnalytics .table`
(`:23`), `4px 10px` in Seasonality (`:8`), `2px …` in the Help table (`TerminalShell.module.css:97`),
plus `8px 6px`, `8px 10px`, `6px 10px`, `5px 10px !important` on the surfaces (A.13; single-line
rules only, so a lower bound). Headers are UPPERCASE 10px in `.tbl`/`.fgrid`/FmpDepth and
sentence-case 600 weight in Depth/ResearchCov/OptionsChain/OptionsScreener/Seasonality. Zebra
striping exists only in `.fgrid` and FmpDepth, as `rgba(255,255,255,0.02)` (`ResearchPage:78`,
`FmpDepth:52`). Sticky headers exist only in OMON and OSCR. First-column alignment: left in
most, **all left-aligned** in `ResearchCov .grid` (`:10`) so its numbers do not right-align.
`<table>` appears 56 times in 38 files in scope.

**7. Number and missing-value formatting is hand-rolled per file.** `.toFixed(` ×293 and
`toLocaleString(` ×43 in scope versus **12** calls into `lib/presentation/presentationPrimitives.js`.
74 local `fmt*` helpers with 45 names; `fmtPct` alone is defined 10 times and disagrees:
1 decimal and a `+` only when `>0` (ANR, EE, FA tabs), **no rounding at all** (`FlowTab.jsx:30`),
2 decimals unsigned (`OwnershipTab.jsx:69`), `+` on `>=0` so zero prints `+0.0%` (`UCT20.jsx:29-31`),
1 decimal and no `%` (`Breadth.jsx:316-318`). 50 hand-rolled `> 0 ? '+' : ''` sign prefixes.
Missing values print `'—'` (×250) in most panels but the word **"unavailable"** in EEH table
cells (`EstimateHistoryTab.jsx:17,48,50`) and `'–'` (en dash) in RTG's checkup (`RatingsTab.jsx:124`).

**8. Error and empty states: four visual languages.**
- research tabs: muted `.fnote` text + a small "Retry" `.basisBtn` (e.g. `NewsTab.jsx:95-98`);
- depth panels: the same sentence in **red** `--loss` (`Depth.module.css:8`, `.error`) — the colour that elsewhere means "price down";
- FA/EE: `research-kit` `<EmptyState>` with a gold icon and a Retry button (`FinancialsDeep.jsx:34`);
- options: `<OffNotice>` muted paragraph (`OffNotice.jsx:17-27`);
- shell: `PanelCrashed`, plain muted text, `role="alert"` (`TerminalShell.jsx:95-100`).
The app-level branded `components/EmptyState.jsx` has **zero importers** (it is on the
`reachable.test.js` orphan list as "a branded primitive kept on purpose").

**9. Score and grade colours bypass the tokens built for them.** `RatingsTab.jsx:20-35` still
carries the five-hex ladder `#3cb868 #7fb84e #c9a84c #e08a3c #e74c3c` that `tokens.css:331-336`
says was promoted to `--score-elite…--score-poor` "one ladder, one home". The score/grade tokens
have 4 references app-wide (A.14). `L0Strip.module.css:84` paints the "caution" regime in a bare
`#e67e22`, outside every token. Group dots and channel colours are eight Tailwind hues hard-coded
in `boardModel.js:51,53` (`#60a5fa #c084fc #f472b6 #fb923c …`).

**10. Freshness/provenance appears in two places with no rule.** Only `MovePanel` reports its
freshness up to the shell header via `usePanelFreshness` (A.15: 3 files touch the context, one
of them a panel). CN, ANR and OWN render `<FreshnessBadge>`+`<Provenance>` inline in their body
(`NewsTab.jsx`, `AnalystRatingsTab.jsx`, `OwnershipTab.jsx` — the `TrustStrip` pattern). The
options panels use a third idiom, a text pill "computed" / "our log" / "end of day"
(`optionsAnalytics.module.css:5`, e.g. `PositioningPanel.jsx:23`). FA/EE use a fourth,
`<SourceLine>`. Ten research files paste the same inline `style={{ fontSize: 11 }}` "entity
unresolved" note (A.16).

### (c) Seen in a chosen mode, theme or width

**11. The density control barely reaches panel content.** Compact/dense set `font-size` on
`.panelBody` (`TerminalShell.module.css:740-751`). Only text that *inherits* changes; 813 CSS
`font-size` declarations in scope set their own size (627 of them literal px), so tables, cards
and titles keep their size. Dense mode also removes the 1px grid gap (`:757-759`), which is the
only thing separating two panels' unpadded content (item 1).

**12. Light theme and app themes: the panels are mostly theme-blind.** Only one
`[data-theme='light']` rule exists in scope, inside the always-dark theme island
`EarningsResearchModal.module.css`. 105 white-alpha `rgba(255,255,255,…)` hairlines/zebras and
25 black-alpha shadows are fixed values. The research-kit and `--glass-*`/`--hub-*` families have
no light values on purpose (`tokens.css:325-328, 375-395`). App themes recolour the accent by
overriding `--ut-gold` (`styles/appThemes.js:25-35`), so the 41 bare gold hex values and 96 gold
`rgba()` literals stay gold under a teal or slate theme; 16 `var(--ut-gold, #c9a84c)` fallbacks
also name the *old* gold while 43 name the current `#dcbb5e` (A.3). Twenty-eight `var()` references
name six tokens that do not exist — `--color-text-muted` ×9, `--color-border` ×9,
`--color-gold` ×4, `--gold` ×3, `--color-bg-elev` ×2, `--danger` ×1 — and therefore always render
their hard-coded fallback (`WireView.module.css:16-99`, `MorningWire.module.css:1481-1545`,
`EarningsHistorySection.module.css:98-100`, `TerminalShell.module.css:87`). 29 references use the
deprecated bridge aliases (`--color-text` ×11, `--text-primary` ×6, `--text-faint` ×4,
`--text-secondary` ×3, `--bg-base` ×2, three singles); **10 of the 29 are in the shell**
(`TerminalShell.module.css:39,81,110,222,226,571,664,714,722,726`), whose `.helpFlagOn/Off`
(`:722,726`) also fall back to Tailwind `#4ade80`/`#f87171` rather than `--gain`/`--loss` values.

**13. Phone-width breakpoints outside 640/1024.** `ProfileSection.module.css:43` (520px, inside
the ERN modal), `Breadth.module.css:823` (900px) and `:1208` (700px), `CatalystsHistory.module.css:172`
(768px). Two JS checks hard-code `'(max-width: 640px)'` instead of the `useBreakpoint` hooks
(`Breadth.jsx:606`, `BreadthDrillModal.jsx:148`). The shell itself is canonical throughout.

**14. Two calendar-only alias palettes.** `Calendar.module.css:11-26` declares 13 `--cal-*`
properties **on `:root` from inside a CSS module**, each a rename of a real token (`--cal-dim` =
`--text`, `--cal-txt` = `--text-bright`). They are referenced 368 times (A.17). They resolve
correctly but are a second vocabulary a redesign has to map.

**15. Native controls are unstyled by the shared kit.** 32 `<select>` and 37 `<input>` in scope;
the `components/ui` `Select`/`Input`/`Switch`/`Checkbox` (15/46/4/9 importers app-wide) are used
**0** times in scope. OBT alone has seven bare `<select>`s (`BacktestPanel.jsx:138-177`). `<kbd>`
in the shell's empty states (`TerminalShell.jsx:287,293`) has no style rule anywhere, so it
renders the browser default.

---

## 3. Per-panel notes (49 panel components behind 52 variants)

Format: **CODE** — component file — structure — what is visually off. "Flush" = item 1.

### Calendar section
- **CAL / ERN** — `pages/Calendar.jsx` (998 lines) + `pages/calendar/*` (3,279-line `Calendar.module.css`) — feed/week/month card grids with logos, filter chips, a day drawer; ERN opens `EarningsResearchModal` (a dark theme island). Off: in-body title reads "UCT Terminal" (`CalendarHeader.jsx:681`); 170 literal font sizes, 0 tokens; `--cal-*` alias palette; 32 inline styles (icon alignment); 12px card radius vs 10/8px elsewhere; `WireView` uses non-existent tokens.

### Security
- **DES** — `terminal/panels/OverviewPanel.jsx` → `research/tabs/OverviewTab.jsx` — chart card + 4-card `cardGrid` (Latest report `.tbl`, Key stats, Analyst view, …). Off: flush; `.tbl` 3px 4px padding is the tightest table in the app; Suspense fallback is an inline-styled div (`OverviewTab.jsx:114`).
- **GP** — `panels/ChartPanel.jsx` → `StockChart` — full-bleed chart, inline `minHeight: 320`. Off: none of its own; it is the one panel that should be flush.
- **CN** — `NewsTab.jsx` — one card, news list with 56px thumbnails (6px radius literal), source/time meta. Off: `.soon` 280px loader; inline TrustStrip styles.
- **CATS** — `CatalystsTab.jsx` — card list of dated catalyst rows + `AbsenceReceipt`. Off: rows laid out with inline flex styles (`:84-91`); tag colour comes from class map but falls back to `.muted`.
- **MOVE / WIIM** — `panels/MovePanel.jsx` — prose lists under uppercase Help headings, numbered "Next" rows. Off: borrows Help classes for content (`.helpRule` on `<ul>`); the only panel feeding the header freshness badge.
- **TECH** — `TechnicalTab.jsx` — setup cards (as `<button>`s) + "View on Chart" card. Off: text `✓/✗` marks (`:66`); local gold `#c9a84c` constant (`:21`); 8 inline styles.
- **FA** — `components/research/fmpDepth/FinancialsDeep.jsx` — statement tables in elevated cards, `SourceLine`. Off: different card (elevated, 8px) from its research siblings; EmptyState-with-icon error unlike any sibling.
- **EE** — `fmpDepth/ConsensusEstimates.jsx` — three tables + `SeriesChart`. Off: same as FA; 10px uppercase card titles match `.ct` only by coincidence (`0.06em` vs `0.6px`).
- **EEH** — `EstimateHistoryTab.jsx` — one bordered-less card per fiscal period with a table. Off: missing values print "unavailable" inside numeric cells; no card surface (`ResearchCov .card`).
- **ANR** — `AnalystRatingsTab.jsx` — consensus card with a hand-built stacked bar, price-target card, rating-change list. Off: big numbers via inline `fontSize: 18/20` (`:142,169`); stacked bar colours inline.
- **RTG** — `RatingsTab.jsx` — 46px/900 composite number (`.compNum`, `ResearchPage:174`), component meters, checkup list. Off: private 5-hex ladder (item 9); the heaviest type in the terminal.
- **OWN** — `OwnershipTab.jsx` — card grid: institutional (chart + `.fgrid`), short interest, 13F, insider. Off: 21 inline styles, the most of any research tab; "Source: Yahoo Finance" repeated as inline 11px lines.
- **PPL** — `PeopleTab.jsx` — three tables under 13px bold titles. Off: no card surface; left-aligned numeric columns (`ResearchCov:10`).
- **TRAN** — `CallsTab.jsx` — recap block (via `callRecap`) or `PendingGaveUp`. Off: inline `.fnote` loader; flush.
- **MB (ticker)** — `ModelBookTab.jsx` — card list of appearances + link. Off: inline flex row styles (`:48-49`).
- **DR** — `DecisionRecordTab.jsx` — up to five cards of prose and a reasons list. Off: long prose at 12px muted in `.fnote` (body text styled as a footnote).
- **HIS** — `HistoryTab.jsx` — muted paragraphs + a list of symbol/name rows. Off: loading/paywall text rendered inside a bordered card (`:86-92`).
- **SEAS** — `SeasonalityTab.jsx` — side-by-side month/quarter tables with captions. Off: tables have `min-width:260px` and 10px side padding — wider rhythm than every other table.
- **CF** — `FilingsTab.jsx` — one card, filing link list, accession numbers at inline `fontSize: 10`. Off: flush; 10px is below the token floor on desktop.
- **FEED** — `FilingsFeedTab.jsx` — one table under a section. Off: left-aligned grid, no card.
- **FIL** — `FilingChangesTab.jsx` — sections with 14px bold `<h3>`, blackline diffs. Off: heading style unique to this file.
- **RSCH** — `panels/MyResearchPanel.jsx` → `TickerResearchWorkspace` (Journal 2.0) — notebook list/editor. Off: the only padded research panel, via an inline style; Journal's own visual language.
- **ASK** — `AskAiTab.jsx` — one card: suggestions, textarea (`ui/Textarea`), answer with `<Provenance>`. Off: answer text is `.fnote` (muted footnote style) for primary content.

### Research depth
- **DPTH** — `panels/DepthPanel.jsx` → `research/depth/DepthTab.jsx` — vertical stack of every enabled depth panel separated by top rules, `gap: 22px`. Off: flush; 22px gap is off-scale.
- **EVTS** — `depth/EventsPanel.jsx` — 14px title, table. Off: failure line in red `--loss`; inline `whiteSpace/textAlign` on cells (`:64,68`).
- **FSRC** — `depth/FilingSearchPanel.jsx` — search form (`.input` 36px tall, 6px radius) + results. Off: input styled locally, not `ui/Input`; `min-height: 36px` and `Depth.module.css` has no `--tap-min` rule, so it stays 36px on touch (the tap-floor rail cannot see it: it only checks phone-vs-tablet parity).
- **ERX** — `depth/EarningsReactionPanel.jsx` — 8-quarter table. Off: red error; flush.
- **FTD** — `depth/FtdPanel.jsx` — table + mismatch warning. Off: red error line.
- **ATTN** — `depth/MentionSeriesPanel.jsx` — table. Off: red error.
- **BRKE** — `depth/BrokerEstimatesPanel.jsx` — two tables. Off: red error.

### Options
- **OMON / OVS** — `OptionsChainTab.jsx` (+ `VolSurfacePanel` for OVS) — expiration `<select>` + sticky-header chain table with ATM row tinted by `color-mix` of gold; OVS adds an ECharts surface. Off: native select; ATM tint is the only `color-mix` highlight pattern in the panels.
- **IVH** — `IvHistoryPanel.jsx` — hand-drawn SVG spark + notes. Off: reuses `OptionsChainTab.module.css`'s `.payoffChart` class for a different chart.
- **VOL** — `optionsAnalytics/VolPanels.jsx` (`VolStatsPanel`) — card with title + "computed" pill, facts lines, `<details>` explainers. Off: `margin-top:14px` on every card leaves a gap above the first one.
- **POS** — `optionsAnalytics/PositioningPanel.jsx` — cards with table. Off: same card margin; 14 `.muted` lines.
- **OHIS** — `optionsAnalytics/OptionsHistoryPanel.jsx` — three cards: SVG chart, move table, IV-crush table. Off: SVG chart max-width 760px leaves dead space in a wide panel.
- **OBT** — `research/tabs/BacktestPanel.jsx` — seven native `<select>` controls + trades table. Off: unstyled controls; the densest form in the terminal.
- **OSCR** — `screener/options/OptionsScreener.jsx` — tab pills, chip filters, form, three sticky tables. Off: its own pill/chip styles (`OptionsScreener.module.css:4-9`) unlike the shell's `.chip`.
- **FLOW (ticker)** — `research/tabs/FlowTab.jsx` — net-flow card + top-contracts `.fgrid`. Off: direction colours via `var(--ut-green, #4ade80)` / `var(--ut-red, #f87171)` (`:40-41`) — not `--gain`/`--loss`; `fmtPct` unrounded.
- **TIDE** — `optionsAnalytics/MarketTidePanel.jsx` — SVG tide chart with segmented scope buttons, sector table, minute drill. Off: "Reading the tape…" loader is the fifth wording of loading.
- **STRS** — `optionsAnalytics/StrategyScreensPanel.jsx` — three cards each with a table and a source pill. Off: 10 `.note` paragraphs; pills say "end of day" vs "today's tape" in the same style.

### Market (whole-page surfaces, rendered with no props)
- **WIRE** — `pages/MorningWire.jsx` — `PageHeader`, TileCards, injected rundown HTML. Off: double title; emoji feedback controls; 117 literal font sizes, 75 rgba literals; non-existent `--color-*` tokens.
- **BRD** — `pages/Breadth.jsx` + `pages/breadth/**` — PageHeader with 5-6 tabs (Monitor heat table, Views, Daily, COT Chart.js, Data Charts ECharts). Off: 292 raw hex, 247 inline styles, 150 rgba literals, 19 distinct font sizes; two non-canonical breakpoints; JS matchMedia literal.
- **SCR** — `pages/Screener.jsx` → `screener/shell/ScannerShell` (not measured here) — `<h1>` heading, how-to checklist, scanner. Off: renders its full-page heading because the panel does not pass `embedded`.
- **U20** — `pages/UCT20.jsx` — PageHeader, ranked TileCard list, performance TileCard, Sheet. Off: double title; `fmtPct` prints `+0.0%`; 13 distinct font sizes.
- **FREC** — `pages/FlowScoreboard.jsx` — marketing hero (eyebrow, 1-line pitch, sub-copy), stat blocks, tables. Off: a public-landing hero inside a work panel; own `.statValue`.
- **CATH** — `pages/CatalystsHistory.jsx` — `<h1>` with inline-styled UIcon, date picker, one table tile. Off: 768px breakpoint; `max-width:1400px` centring inside a panel.
- **RISK** — `pages/PortfolioHeat.jsx` — 22px/800 uppercase `<h1>`, stat row, positions and sector tables. Off: `⚠` glyph; heading style unique to this page.

### Shell
- **HELP** — `panels/HelpPanel.jsx` — padded document: syntax line, uppercase group heads, numbered function rows (3ch · 52px code · label · scope grid), key/address tables. Off: none beyond the glyph actions in its header; it is the reference for the shell's own register.
- **The shell chrome** (`TerminalShell.jsx`, `CommandLine.jsx`, `L0Strip.jsx`, `BoardsMenu.jsx`) — 196px rail of gold codes + labels under 10px uppercase heads; command bar with prompt, echo line, suggestion popover (`--shadow-popover`); L0 strip (session dot with glow, ET clock, EXPOSURE and CH chips); 32px panel headers. Off: text-glyph actions; `TerminalRoutes.jsx:30,37` fallbacks use inline `#888` and `#f5c451`; `.echo_error` uses undefined `--danger`; caution regime in bare `#e67e22`; no motion of its own (the `Sheet` primitive it opens has 4 transition/animation rules in `Sheet.module.css`).

---

## 4. Building blocks that already exist (candidate primitives)

Counts: "app" = non-test files that render `<Name` anywhere in `app/src`; "terminal" = within
the three scopes (A.18).

| primitive | file | app | terminal | notes for the design system |
|---|---|---|---|---|
| `UIcon` | `components/ui/UIcon.jsx` | 369 | 40 files / 85 uses | 103 glyphs; gold by default; the icon primitive already exists — the shell simply does not use it |
| `TileCard` | `components/TileCard.jsx` | 29 | 2 (WIRE, U20) | title + optional UIcon + badge + actions; the app's dashboard card. No panel uses it |
| `PageHeader` | `components/PageHeader.jsx` | 5 | 3 | page title + icon; must be suppressed inside panels |
| research-kit `EmptyState` | `components/research-kit/EmptyState.jsx` | 23 | 22 | icon + message + retry; used by FA/EE and the ERN sections, not by the tabs |
| app `EmptyState` | `components/EmptyState.jsx` | 0 | 0 | orphaned branded empty state (kept deliberately, `reachable.test.js`) |
| `ErrorState` | `components/ErrorState.jsx` | 6 | 0 | dashboard tiles only |
| `Skeleton*` | `components/Skeleton.jsx` | 3 / 8 / 7 (`Skeleton`/`SkeletonTable`/`SkeletonTileContent`) | 0 / 1 / 2 | the only real loading primitive; no research/options panel uses it |
| `StatTile` | `components/research-kit/StatTile.jsx` | 5 | 4 | KPI tile with tones; FlowScoreboard, PortfolioHeat, ANR, RTG each re-implement one |
| `EyebrowLabel` | `research-kit/EyebrowLabel.jsx` | 17 | 17 | the uppercase label; `.ct`, FmpDepth `.title`, `.railHead`, `.helpGroup` duplicate it |
| `VerdictChip`, `CoverageNote`, `InfoTip`, `ConsensusBar`, `CheckupRow`, `RatingChangeList` | `research-kit/` | 3 / 3 / 4 / 1 / 1 / 1 | 3 / 2 / 4 / – / – / 1 | chip, footnote, tooltip, bar, checklist row — ANR's hand-built bar and TECH's text checklist duplicate two of them |
| `GlassCard` | `research-kit/GlassCard.jsx` | 0 | 0 | built, unused |
| `SeriesChart` / `EChart` | `research-kit/charts/` | 8 / 6 | 5 / 6 | the shared ECharts wrapper; the SVG charts in options and Breadth do not use it |
| `FreshnessBadge` | `components/provenance/FreshnessBadge.jsx` | 9 | 7 | the freshness primitive; also the shell header's badge (`panelFreshness.js`) |
| `Provenance`, `Cited`, `CoverageLine`, `AbsenceReceipt` | `components/provenance/` | 18 / 6 / 7 / 2 | 9 / 2 / 3 / 1 | provenance family; adoption ratcheted by `panelAdoption.baseline.json` |
| `SourceLine` | `components/research/fmpDepth/SourceLine.jsx` | 2 | 2 | FA/EE source line; overlaps `Provenance` |
| `OffNotice` | `pages/optionsAnalytics/OffNotice.jsx` | 5 | 5 | "feature off / paywalled / loading" line for options |
| `PendingGaveUp` | `pages/research/depth/PendingGaveUp.jsx` | 6 | 6 | "still computing / gave up" state |
| `SectionLead` | `components/research/SectionLead.jsx` | 4 | 4 | section intro line |
| `Sheet` | `components/mobile/Sheet.jsx` | 63 | 4 | the modal/drawer primitive; the shell's Functions/Boards/Recents use it |
| `ContextPopover` | `components/mobile/ContextPopover.jsx` | 6 | 1 | the shell's channel picker |
| `ResponsiveTable` | `components/mobile/ResponsiveTable.jsx` | 1 | 0 | card-mode / frozen-column phone table; no terminal table uses it |
| `Select`/`Input`/`Switch`/`Checkbox`/`Textarea` | `components/ui/` | 15 / 46 / 4 / 9 / 16 | 0 / 0 / 0 / 0 / 1 | form kit; terminal uses 32 native selects and 37 native inputs instead |
| `CompanyLogo`, `TickerPopup`, `Sparkline` | `components/` | 33 / 31 / 8 | 10 / 7 / 1 | entity chrome |
| `ErrorBoundary` | `components/ErrorBoundary.jsx` | 8 | 4 | per-panel crash isolation |
| shell `.chip`, `.barBtn`, `.code`, `.railItem`, `.helpRow`, `.notice` | `pages/terminal/TerminalShell.module.css` | — | shell | the de-facto terminal control set; pinned by CSS-source tests (§5) |
| formatters | `lib/presentation/presentationPrimitives.js` (`formatNumber`, `formatPercent`, `formatCurrency`, `formatCompact`, `formatPriceDisclosure`, `formatPriceTick`, `formatTimeEt`, `formatDateTimeEt`, `formatFreshnessAsOf`, `ABSENT = '—'`) | 17 importers | 12 calls | the number-format primitive exists; 293 `.toFixed` calls do not use it |
| copy | `lib/presentation/memberCopy.js` | 12 importers | — | member-facing sentence helpers (`memberText`, `memberSentence`) |
| table sort | `lib/presentation/dataGrid/` | 4 importers | 0 | sort/columns hooks; no terminal table uses them |
| global text classes | `.t-page-title`, `.t-section-title`, `.t-label`, `.t-body`, `.t-caption`, `.t-num` (`tokens.css:862-915`) | `t-num` ×31 in scope | — | the type primitives exist as global classes |

---

## 5. Constraints a redesign must respect

1. **Theme islands.** `EarningsResearchModal.module.css` declares `--theme-island:
   earnings-research-modal` and re-pins every theme-variant token; `styles/themeIslands.test.js`
   derives the required set from `tokens.css` each run. Any new token with a `[data-theme]`
   variant must be added to every island in the same change. The ERN panel opens this island.
2. **Light, OLED and app themes.** `data-theme` is `oled` / `light` / unset, and the 'uct:*' app
   themes write inline overrides of `--bg*`, `--text*`, `--border*` and `--ut-gold` on `<html>`
   (`styles/appThemes.js`). Gain stays green and loss red in every theme. The research-kit,
   `--glass-*` and `--hub-*` families are dark-only by recorded decision
   (`tokens.css:325-328, 375-395`) — a redesign that moves panels onto them inherits that gap.
3. **`--hub-*` tokens** are joystick-hub chrome, unused in scope (0 references). Adding one
   triggers rule 1. The hub is mounted app-wide from `Layout.jsx` on coarse pointers ≤1023px and
   the hub registry has no terminal mode.
4. **Tap floor.** `styles/tapFloor.test.js` fails any stylesheet that declares a finger target at
   the phone width but not across the whole ≤1024px tier. `--tap-min` is 44px. The shell's
   `TerminalShell.test.jsx:565-600` additionally pins, by class name, that `.cmdGo .barBtn
   .suggestRow .chip .railItem .helpRow .panelLink .noticeClose` get `min-height: var(--tap-min)`
   at ≤1024px, `.groupDot` and `.cmdInput` are 44px, **no fixed width over 390px** exists in
   `TerminalShell.module.css`, `.grid .panel .panelBody .cmdWrap .body` keep `min-width: 0`, and
   `.cmdInput` is 16px on touch (iOS zoom). `TerminalShell.audit3.test.jsx:293-306` pins
   `.echoText { white-space: normal }` at phone width. Renaming those classes breaks the tests.
5. **Token reachability.** `styles/tokens.reachable.test.js` fails on a new `var(--x)` that is
   defined nowhere; the nine bridge aliases may not grow. `styles/tokens.test.js` pins the
   research-kit values and the heat ladder byte-equal to `Breadth.module.css`'s `.bgG3…bgR3`.
6. **Canonical breakpoints.** 640 / 1024 only (`styles/breakpoints.css`, `breakpoints.js`,
   `hooks/useBreakpoint.js`); snap legacy literals when a file is touched; never add a new one.
7. **No generic emoji; `UIcon` only.** A `UIcon` cannot nest in SVG `<text>`, so `★`/`◆` markers
   inside chart SVG stay. DOM-injected HTML (Morning Wire rundown) needs a static SVG string, not
   the React component.
8. **Embedded, never forked.** `panels.jsx` / `surfacePanels.js` render the same modules the
   full pages mount; `functions.rail.test.js` proves each panel resolves to the module `App.jsx`
   loads. A panel-only look must come from the shell (a wrapper, a context, an `embedded`-style
   prop the page already honours), not from a copy of the component.
9. **Partner-owned files are untouchable.** `pages/OptionsFlow.jsx` (~7k lines, inline styles;
   only additive `className` hooks + `OptionsFlow.mobile.css`), `api/massive_ws_worker.py`,
   `api/live_massive_router.py`. FLOW (market), GEX, LIVE are doors to partner pages and stay
   doors; the FLOW *ticker* panel (`FlowTab.jsx`) is not partner-owned.
10. **Rendered-text rails.** `lib/presentation/s10Adoption.test.jsx` and
    `compactAdoption.test.jsx` assert byte-identical rendered strings; `presentationSingleFormatter`
    and `priceIsTwoPrimitives` pin that `formatPriceDisclosure` (em dash) and `formatPriceTick`
    (empty string) stay different; `handRolledFormatters.baseline.json` is a shrink-only census;
    `panelAdoption.baseline.json` ratchets provenance adoption. Unifying number formats will
    move these deliberately, never by re-running an update mode.
11. **Test hooks.** 776 `data-testid` attributes in scope and 280 test files in the scoped
    directories; 102 tests app-wide read CSS source directly. Visual changes keep the testids.
12. **Fonts.** Instrument Sans is self-hosted and `--font-mono` is deliberately the same face
    (`tokens.css:1-10, 218-225`); a monospace numerals look must come from `.t-num` /
    `tabular-nums`, not a font swap. Do not reintroduce a third-party font host.
13. **Shell geometry contracts.** The phone layout keeps every panel mounted and hides the
    unfocused ones (`.panel[hidden]`, `TerminalShell.module.css:374-377`); density is desktop-only
    and must never undercut the touch floor (`:734-760`).

---

## Appendix A — commands

Run from `app/src`. The scope file:

```sh
SC=/path/to/scratch/scope.sh   # contents:
SHELL_S="pages/terminal"
PANELS_S="pages/research/tabs pages/research/depth pages/research/ResearchPage.module.css components/research components/research-kit pages/optionsAnalytics pages/screener/options"
SURF_S="pages/Calendar.jsx pages/calendar pages/MorningWire.jsx pages/MorningWire.module.css pages/UCT20.jsx pages/UCT20.module.css pages/Breadth.jsx pages/Breadth.module.css pages/breadth pages/Screener.jsx pages/Screener.module.css pages/FlowScoreboard.jsx pages/FlowScoreboard.module.css pages/CatalystsHistory.jsx pages/CatalystsHistory.module.css pages/PortfolioHeat.jsx pages/PortfolioHeat.module.css"
ALL="$SHELL_S $PANELS_S $SURF_S"
# --include MUST precede --exclude: GNU grep keeps unmatched files when the FIRST
# include/exclude option is an --exclude (a first draft counted CSS inside "JS" counts).
gcss(){ grep -rI --include='*.css' --exclude='*.test.*' --exclude-dir=__tests__ --exclude-dir=testing "$@"; }
gjs(){ grep -rI --include='*.jsx' --include='*.js' --exclude='*.test.*' --exclude-dir=__tests__ --exclude-dir=testing "$@"; }
```

- **A.1 type sizes** — `gcss -hoE 'font-size:\s*[^;}]+' $ALL | wc -l`; literal: `gcss -hoE 'font-size:\s*[0-9.]+(px|rem|em)' $ALL | sed -E 's/font-size:\s*//' | sort | uniq -c | sort -rn`; token: `gcss -hoE 'font-size:\s*var\(--text-' $ALL | wc -l`; inline: `gjs -hoE 'fontSize:\s*[0-9.]+' $ALL | sort -u`.
- **A.2 colour** — hex CSS: `gcss -hoiE '#[0-9a-f]{3,8}\b' $ALL | tr A-F a-f | sort -u | wc -l`; as fallback: `gcss -hoiE 'var\(--[a-z0-9-]+,\s*#[0-9a-f]{3,8}' $ALL | wc -l`; hex JS: `gjs -hoiE "['\"\`]#[0-9a-f]{3,8}\b" $ALL`; rgb: `gcss -hoE '(rgba?|hsla?)\([0-9][^)]*\)' $ALL | wc -l`; var refs: `gcss -hoE 'var\(--[a-zA-Z0-9-]+' $ALL | wc -l`; white-alpha: `gcss -oE 'rgba\(\s*255,\s*255,\s*255' $ALL | wc -l`.
- **A.3 gold** — `gcss -hoiE '#(dcbb5e|c9a84c|e9cd77)[0-9a-f]{0,2}\b' $ALL | wc -l` minus `gcss -hoiE 'var\(--[a-z-]+,\s*#(dcbb5e|c9a84c|e9cd77)' $ALL | wc -l`, same for `gjs`; rgba: `{ gcss …; gjs …; } -hoE 'rgba?\(\s*(220|201),\s*(187|168),\s*(94|76)'`; fallback values: `gcss -hoiE 'var\(--(ut-gold|accent|gold|color-gold),\s*#[0-9a-f]+' $ALL | sort | uniq -c`. Undefined tokens: every `var(--x)` name not declared in `styles/tokens.css` (`grep -oE '^\s*--[a-zA-Z0-9-]+:' styles/tokens.css`), filtered to names with no other definition.
- **A.4 weight/leading/tracking** — `gcss -hoE 'font-weight:\s*[^;}]+' $ALL | sort | uniq -c`; same for `line-height`, `letter-spacing`.
- **A.5 spacing** — `gcss -hoE '(^|[^-])padding:\s*[^;}]+' $ALL | sed -E 's/.*padding:\s*//' | sort -u | wc -l`; scale adherence: `gcss -hoE '(^|[^-])(padding|margin|gap|row-gap|column-gap)(-[a-z]+)?:\s*[^;}]+' $ALL | sed -E 's/^[^:]*:\s*//' | grep -oE '(^|[ (])-?[0-9.]+px' | grep -oE '[0-9.]+'` then `grep -cxE '0|4|8|12|16|24|32|48'`.
- **A.6 radius/shadow** — `gcss -hoE 'border-radius:\s*[^;}]+' $ALL | sort | uniq -c | sort -rn`; `gcss -hoE 'box-shadow:\s*[^;}]+' $ALL | sort | uniq -c | sort -rn`.
- **A.7 icons/glyphs/charts** — `gjs -o '<UIcon\b' $ALL | wc -l`; `gjs -oE '<UIcon[^>]*gold=\{false\}' $ALL | wc -l`; `gjs -oE '<UIcon[^>]*style=\{\{' $ALL | wc -l`; glyph census: a Python pass over scope JS/JSX skipping comment lines, counting U+2190-21FF, U+25A0-25FF, U+2600-27BF, U+1F300-1FAFF, `·`, `…`, `×`; chart engines: `gjs -lE "from '[^']*echarts[^']*'" $ALL | wc -l`, `gjs -c '<svg' $ALL`. Glyph registry: `grep -oE "^  [a-zA-Z'-]+:" components/ui/UIcon.jsx | wc -l`.
- **A.8 motion** — `gcss -hoE '(^|[^-])transition:' $ALL | wc -l`; `gcss -hoE '(^|[^-])animation:' $ALL | wc -l`; `gcss -hoE '@keyframes [a-zA-Z-]+' $ALL | wc -l`; `gcss -hoE 'prefers-reduced-motion' $ALL | wc -l`; durations: `gcss -hoE 'transition:[^;}]+' $ALL | grep -oE '[0-9.]+m?s\b' | sort | uniq -c`.
- **A.9 registry** — `node -e "import('./src/pages/terminal/functions.js').then(m=>…)"` from `app/`, counting `panel|surface` vs `door` variants and distinct targets.
- **A.10 inline styles** — `gjs -o 'style={{' <paths> | wc -l` per area.
- **A.11 breakpoints** — `gcss -hoE '@media[^{]*' $ALL | grep -oE '(max|min)-width:\s*[0-9.]+px' | sort | uniq -c`; non-canonical: `gcss -nE '@media[^{]*(520|700|768|900)px' $ALL`; JS: `gjs -nE "(matchMedia|useMediaQuery)\(['\"][^'\"]*" $ALL`; container: `gcss -o '@container' $ALL | wc -l`.
- **A.12 loading** — `gjs -oE 'Loading[^<\x27\"\`]*…' $ALL | wc -l`; `gjs -oE '<Skeleton[A-Za-z]*' $ALL | wc -l`.
- **A.13 tables** — `gcss -hoE '\b(th|td)\b[^{]*\{[^}]*padding:\s*[^;}]+' $ALL | grep -oE 'padding:\s*[^;}]+' | sort | uniq -c` (single-line rules only); `gjs -o '<table\b' $ALL | wc -l`.
- **A.14 score tokens** — `grep -rn "score-elite\|grade-a\|heat-g3" --include=*.jsx --include=*.js --include=*.css . | grep -v styles/tokens | grep -v test | wc -l`.
- **A.15 panel freshness** — `grep -rln "usePanelFreshness\|PanelFreshnessContext" --include=*.jsx --include=*.js . | grep -v test`.
- **A.16 duplicated note** — `gjs -l 'entity-unresolved-note' $ALL | wc -l`.
- **A.17 `--cal-*`** — `{ gcss -hoE 'var\(--cal-[a-z0-9-]+' $ALL; gjs -hoE 'var\(--cal-[a-z0-9-]+' $ALL; } | wc -l`.
- **A.18 primitive usage** — for each name: app `grep -rlE --include=*.jsx --exclude='*.test.*' "<Name\b" . | wc -l`, terminal `gjs -lE "<Name\b" $ALL | wc -l`; importer counts for non-JSX modules from a relative-import resolver over `app/src` (`presentationPrimitives` 17, `memberCopy` 12, `dataGrid` 4).
- **Formatters** — `gjs -o '\.toFixed(' $ALL | wc -l`; `gjs -oE '\bformat(Number|NumberMax|Percent|Currency|Compact|PriceDisclosure|PriceTick|TimeEt|DateTimeEt|FreshnessAsOf)\(' $ALL | wc -l`; `gjs -hoE '(function|const) fmt[A-Z][A-Za-z]*' $ALL | awk '{print $2}' | sort | uniq -c | sort -rn`; missing-value glyphs `gjs -oF "'—'" $ALL | wc -l`, `"'unavailable'"`.
- **Utility-class re-declaration** — `gcss -lE "^\s*\.note\b[^{]*\{" $ALL | wc -l` (16 files), `.muted` 9, `.title` 11, `.card` 7, `.empty` 6.
