# UCT Terminal — Visual Design System (proposal)

Status: **DRAFT for owner review** · Branch `terminal/visual-system` · 2026-10-06
Companion: [`prototype.html`](./prototype.html) — open it locally in any browser; the buttons in
its top bar switch the whole screen between the three directions in §5, and toggle the
colour-blind up/down pair.
Input: [`visual-benchmark.md`](./visual-benchmark.md) (branch `terminal/visual-benchmark`,
commit `665060eb`). Its three directions — **Amber Desk**, **Graphite**, **Ledger** — and their
palette roles, faces and densities are the three value sets in §5. Its four token fixes (§1.4)
are baked into every direction.

> Scope: the Terminal (`app/src/pages/terminal/`, route `/terminal`) and the panels it embeds.
> No shipped code is changed by this document. Everything below is a plan to be executed in
> the lanes of §6.

---

## 0. What exists today (read before arguing with anything below)

| Area | Where | What it already gives us |
|---|---|---|
| Base tokens | `app/src/styles/tokens.css` `:root` | `--bg`, `--bg-surface`, `--bg-elevated`, `--bg-hover`, `--border`, `--border-accent`, `--text`, `--text-muted`, `--text-bright`, `--text-heading`, `--accent` (= `--ut-gold`), `--gain/-bg/-border`, `--loss/-bg/-border`, `--warn/-bg/-border`, `--info/-bg/-border`, `--ind-warn*`, `--danger-ink`, `--success-ink`, `--field-edge`, `--space-xs..3xl` (4/8/12/16/24/32/48), `--text-xs..3xl` (10/11/12/13/14/16/20/24), `--lh-*`, `--ls-*`, `--radius-sm..2xl` + `--radius-pill`, `--shadow-*`, `--z-*`, `--tap-min: 44px`, `--focus-ring`, `--control-*` |
| Theme variants | same file | `[data-theme="oled"]`, `[data-theme="light"]`; catalog skins from `styles/appThemes.js` write inline `--bg/--bg-surface/…/--ut-gold` on `<html>` over an oled/light base. Gain/loss are deliberately constant across catalog themes. |
| Theme islands | `--theme-island: <name>` (today: `EarningsResearchModal.module.css`) | Rail `styles/themeIslands.test.js`: every token that has a `[data-theme=…]` variant in `tokens.css` must be pinned in every island. |
| Token rails | `styles/tokens.reachable.test.js`, `styles/tokens.test.js`, `styles/tapFloor.test.js` | No undefined `var(--x)`; the nine bridge aliases (`--text-primary`, `--text-secondary`, `--text-dim`, `--text-faint`, `--color-text`, `--color-danger`, `--color-warning`, `--color-success`, `--bg-base`) are a frozen bridge, not vocabulary; 44px floor on the whole touch tier. |
| Breakpoints | `styles/breakpoints.css` | 640 / 1024 only. PHONE `max-width:640px`, TABLET `641–1024`, TOUCH `max-width:1024px`, DESKTOP `min-width:1025px`. |
| Type utilities | `tokens.css` bottom | `.t-num` (tabular-nums, **opt-in**), `.t-mono`, `.t-label`, `.t-caption`. Instrument Sans is the only face (self-hosted; `--font-mono` is Instrument Sans on purpose — the chart canvas bakes whatever font resolves, and a sweep to JetBrains Mono for prices was reverted as "typewriter"). |
| Density | `.shell[data-density]` in `TerminalShell.module.css` | `comfortable` / `compact` / `dense` (`boardModel.js::DENSITIES`), desktop-only; separate `[data-control-density]` for controls. `data-density` is also used by provenance components with other values — **never style a bare global `[data-density]`**. |
| Shell | `TerminalShell.module.css` (902 lines), `L0Strip.module.css` | `.bar`, `.cmd*`, `.suggest*`, `.notice*`, `.rail*`, `.grid[data-count]`, `.panel`, `.panelHead`, `.groupDot`, `.panelAct`, `.panelLabel`, `.panelFreshness`, `.panelBody`, `.menu*`, `.help*`, `.phoneBar`, `.phoneSwitcher`. |
| Shared primitives | `components/research-kit/` | `EmptyState` (monochrome UIcon, `onRetry`), `StatTile` (score tones only), `VerdictChip` + `tones.js` (`VERDICT_GLYPHS` ▲▼◆—★, never colour-only), `EyebrowLabel`, `InfoTip`, `charts/*` (echarts). |
| Provenance | `components/provenance/` | `FreshnessBadge`, `Provenance`, `AbsenceReceipt`, `CoverageLine`, `availabilityContract.js` (`available / not_found / entitlement_denied / provider_error / unknown`), `freshnessContract.js` (`source_stale`, `session_stale`). |
| Formatting | `lib/presentation/presentationPrimitives.js` | `formatNumber`, `formatPercent({signed})`, `formatCurrency`, `formatCompact`, `formatPriceTick`, `formatTimeEt`, `formatFreshnessAsOf`, `ABSENT = '—'`. `lib/presentation/dataGrid/` has `useGridColumns`, `useGridSort`. |
| Overlays | `components/mobile/Sheet.jsx`, `ContextPopover.jsx`, `RowSpark.jsx` | Sheet = modal on desktop, bottom-sheet on touch, 44px close. |
| Icons | `components/ui/UIcon.jsx` | No emoji, ever. Gold-embossed by default; `gold={false}` for state blocks and dense chrome. |

**Debts this proposal fixes as it goes** (all inside the terminal's own CSS): the shell uses
four bridge aliases (`--bg-base`, `--text-faint`, `--text-secondary`, `--color-success/-danger`);
literal fallbacks that disagree with the theme (`var(--warn, #f59e0b)`, `var(--danger, #f87171)`
— `--danger` is defined nowhere in `app/src` (`git grep` 0 hits; control `--loss:` 2 hits), so
the fallback always wins); `regime_caution` is a literal `#e67e22`; `--focus-ring` is a literal
gold rgba that does not follow catalog accents; 2px gaps and 30/26/24px control heights are
literals.

---

## 1. Token architecture

### 1.1 Principle: one scoped semantic layer, three value sets

The terminal gets a **semantic layer of `--term-*` custom properties** declared on the shell
root. Components inside the terminal read only `--term-*`. The three directions of §5 are three
value sets for **the same names**, selected by `data-term-direction` on the shell root;
components never branch on direction.

**File:** new `app/src/pages/terminal/terminalTokens.css` (plain CSS, imported once by
`TerminalShell.jsx`), selector `[data-terminal-root]` — an attribute the shell root carries — not
a CSS-module class, so panels' own module files can read the variables without composing.

**Where colour values come from.** The benchmark's palettes are specific hex values, so each
direction block carries literals — **only in `terminalTokens.css`**. Component CSS never holds a
hex value; it reads `--term-*`. Graphite's accent is `var(--accent)` (its value is today's
`--ut-gold`), so it keeps following catalog skins; Amber Desk and Ledger set their own gold.
Under `[data-theme="light"]` all three directions re-point their colour tokens to the canonical
light tokens (`var(--bg)`, `var(--text)` …) and keep their type and geometry — the benchmark
specifies dark palettes only, and a light palette per direction is not proposed here (§7 D-V5).

**Theme islands and the token rails stay intact:**

1. `themeIslands.test.js` derives its required set from properties carrying a `[data-theme=…]`
   block **in `tokens.css`**. `--term-*` lives in a terminal stylesheet and never appears in
   `tokens.css`, so it never joins the required set and no island needs editing.
2. `tokens.reachable.test.js` stays green: every `--term-*` is defined in `terminalTokens.css`.
3. **Alias freezing in nested scopes** (the documented `--text-primary` bug): a custom property
   resolves on the declaring element and inherits as a finished value. Any nested scope inside
   the terminal that re-points a canonical token must **re-declare the `--term-*` it reads** in
   the same selector. The new rail (§6, lane 0) fails by name otherwise.
4. **Embedded panels are shared components** (`panels.jsx`: "EXISTING COMPONENTS, EMBEDDED,
   NEVER FORKED"); `/research/:sym` renders the same `NewsTab` with no `--term-*` defined. Panel
   adoption therefore uses **fallback-guarded reads**:
   `color: var(--term-text-2, var(--text-muted))`. Outside the terminal the fallback is today's
   exact value (zero change on `/research`); inside it the direction applies.

### 1.2 The semantic map

Names follow the benchmark's role names (`bg-0..3`, `line`, `text-1..3`, `accent`, `up`, `down`,
`warn`, `info`, `up-cvd`, `down-cvd`) with a `--term-` prefix. "Today's token" is what Graphite
maps from, so a reader can see the size of the change.

**Surfaces**

| Token | Role | Today's token | Graphite value |
|---|---|---|---|
| `--term-bg-0` | canvas, panel gutters | `--bg #101012` | `#0e0f11` |
| `--term-bg-1` | panel body, panel header (Graphite) | `--bg-surface #17181b` | `#15161a` |
| `--term-bg-2` | raised: header strip (Amber), chips, inputs, hover | `--bg-elevated #1d1f23` | `#1c1e22` |
| `--term-bg-3` | selected row, active fill | `--bg-hover #24262b` | `#24262b` |
| `--term-overlay` | sheets, suggestion list, menus | `--menu-bg` | `--menu-bg` (theme-invariant, as every app menu) |

**Text**

| Token | Role | Today | Graphite |
|---|---|---|---|
| `--term-text-1` | values, tickers, titles | `--text-bright #f8f7f3` | `#ecebe6` |
| `--term-text-2` | body, labels that matter | `--text #f0efea` | `#aaa79f` |
| `--term-text-3` | units, column heads, captions, as-of | `--text-muted #cfcac0` | `#8c8981` |
| `--term-text-disabled` | disabled controls only | — (**new**) | `color-mix(in srgb, var(--term-text-3) 55%, var(--term-bg-1))` |

Today's `--text-muted #cfcac0` sits too close to `--text` to form a hierarchy (benchmark §3.2);
all three directions open a real gap between text-1/2/3. ⛔ Do not point `--term-text-*` at the
bridge aliases (`--text-primary`, `--text-secondary` …) — the names look alike; the bridge is
frozen.

**Lines**

| Token | Role | Graphite |
|---|---|---|
| `--term-line` | row rules in data tables, panel hairlines | `#2a2c31` (= today's `--border`) |
| `--term-line-soft` | chrome separators | `#222428` |
| `--term-line-strong` | header rule under a table head | `#2a2c31` (Ledger: 1.5px `#3a3326`) |
| `--term-field` | input edges (≥3:1) | `var(--field-edge)` |

**Accent and status** — every status is its own token; none equals the accent.

| Token | Role | Graphite |
|---|---|---|
| `--term-accent` | focus, active tab, selected-row bar, command prompt | `var(--accent)` (`#dcbb5e`) |
| `--term-accent-dim` | selected wash | `color-mix(in srgb, var(--term-accent) 12%, transparent)` |
| `--term-up` / `--term-down` | price direction | `#3ccf8e` / `#f47067` |
| `--term-up-cvd` / `--term-down-cvd` | colour-blind pair | `#5aaeff` / `#ff9a3c` |
| `--term-pos` / `--term-neg` | **what components read** = up/down, swapped to the cvd pair when `data-term-cvd="on"` | `var(--term-up)` / `var(--term-down)` |
| `--term-pos-bg` / `--term-neg-bg` | tint behind a large move, verdict chips | `color-mix(in srgb, var(--term-pos) 15%, transparent)` |
| `--term-warn` (+ `-bg`, `-line`) | stale, caution — always with a ⚠ glyph | `#f0883e` |
| `--term-info` (+ `-bg`, `-line`) | notices, pending | `#79a8f7` |
| `--term-stale` | stale value ink | `var(--term-text-3)` |
| `--term-focus` | focus outline | `var(--term-accent)` |

**Geometry and type** (values per direction in §5, density steps in §3.4):
`--term-head-h`, `--term-row-h`, `--term-cell-py`, `--term-cell-px`, `--term-pad`,
`--term-gutter`, `--term-radius`, `--term-radius-control`, `--term-fs-data`, `--term-fs-ui`,
`--term-fs-label`, `--term-fs-title`, `--term-fs-hero`, `--term-font-ui`, `--term-font-data`,
`--term-font-cmd`, `--term-font-title`, `--term-label-case`, `--term-label-tracking`,
`--term-rownum-display` (`table-cell` Amber Desk, `none` otherwise). No zebra token: none of the three
directions stripes rows.

**Presentation roles** (so direction-specific chrome is still a value, never a component branch):
`--term-head-bg` (Amber `bg-2`, others `bg-1`), `--term-head-rule-w` (Ledger 1.5px),
`--term-code-color` (Amber: accent), `--term-focus-outline` / `--term-focus-top` (Amber's
gold top border vs an outline), `--term-cmd-edge` (Amber: accent at rest — the command line is
"editable"), `--term-price-line` / `--term-price-fill`, `--term-grid-line` / `--term-grid-dash`,
`--term-title-rule` (Ledger's gold hairline), `--term-state-bg`. The prototype's token block is the
reference list: one base block declares every name, each direction block overrides a subset.

### 1.3 How it sits in the cascade

```
<html data-theme="graphite|oled|light" style="--bg:…; --ut-gold:…">   ← theme + catalog skin (unchanged)
  … Layout …
    <div data-terminal-root data-term-direction="graphite" data-term-cvd="off"
         data-density="compact" class=".shell">
         ↑ terminalTokens.css
           [data-terminal-root]                                    { Graphite values }
           [data-terminal-root][data-term-direction="amber-desk"]  { Amber Desk values }
           [data-terminal-root][data-term-direction="ledger"]      { Ledger values }
           [data-terminal-root][data-term-cvd="on"]                { --term-pos/neg → cvd pair }
           [data-terminal-root][data-density="compact"]            { geometry steps } (scoped, never bare)
           [data-theme="light"] [data-terminal-root]               { colours → canonical light tokens }
      .panelBody  → embedded component reads var(--term-x, var(--canonical))
```

Direction and colour-blind mode are **per-member preferences** stored beside board density
(`boardModel.js`), default chosen by the owner. Neither is a theme; neither appears in the theme
picker.

### 1.4 Four fixes to today's tokens, baked into every direction

| Defect today (benchmark §0, §4) | Fix in every direction |
|---|---|
| `--warn` **is** `#dcbb5e`, the brand gold, so a stale warning looks like a selected tab | `--term-warn` is an orange distinct from each direction's accent (`#ff8f3d` / `#f0883e` / `#e8913f`), always paired with ⚠ |
| `--loss #df4646` on `--bg-surface` measures **4.3:1**, below WCAG AA 4.5:1 for small text | `--term-down` is `#ff6b5e` / `#f47067` / `#ef7a6b` — 7.1 / 6.3 / 7.0:1 on the panel background, ≥5.8:1 on raised surfaces (benchmark §4) |
| Up/down are plain red/green with no colour-blind option | `--term-up-cvd #5aaeff` / `--term-down-cvd #ff9a3c` (Okabe-Ito blue/orange) behind a one-click `data-term-cvd="on"`; and direction is never colour-only (sign + ▲▼ always) |
| Tabular figures are opt-in (`.t-num`) | `font-variant-numeric: tabular-nums` is set on the **terminal root**, so every number inside it is tabular by default; prose surfaces opt out with `proportional-nums` |

These are fixed **inside the terminal layer** without changing `tokens.css`, so nothing else in
the app moves. Promoting the same fixes app-wide (`--warn`, `--loss`) is a separate decision
with island churn (§7 D-V4).

---

## 2. Type system

### 2.1 Faces per direction

| Token | Amber Desk | Graphite (default) | Ledger |
|---|---|---|---|
| `--term-font-ui` | IBM Plex Sans Condensed | Instrument Sans | Instrument Sans |
| `--term-font-data` | IBM Plex Sans Condensed (`tnum`) | Instrument Sans (`tnum`) | **IBM Plex Mono — owner decision**, fallback Instrument Sans `tnum lnum` |
| `--term-font-cmd` | JetBrains Mono (command input only, never prices) | Instrument Sans | Instrument Sans |
| `--term-font-title` | Plex Sans Condensed 600, caps | Instrument Sans 600 | **Instrument Serif** |

⛔ **Ledger's mono data face reverses a recorded owner choice** (tokens.css: prices
intentionally render in Instrument Sans after a JetBrains Mono sweep "turned every
price/table typewriter"). It ships only on an explicit owner yes (§7 D-V3); the fallback keeps
the direction intact. Amber Desk and Graphite keep a proportional sans for numbers.

Every non-Instrument face is **self-hosted** woff2 under `app/public/fonts/` with `@font-face`
inline in `index.html`, never `fonts.googleapis.com` in production (the tokens.css header
explains why). A face loads only when its direction is active. `--term-font-*` never reaches the
chart canvas — that is `components/chart/designTokens.js`, untouched.

### 2.2 Scale

Steps reuse the existing `--text-*` tokens so the phone comfort bump (≤640px lifts xs–md one
step) keeps working.

| Step | Token | px | Line-height | Weight | Use |
|---|---|---|---|---|---|
| Label | `--text-sm` | 11 | 1.2 | 600, caps (Amber, Graphite) / small-caps (Ledger) | column heads, KV keys, chip labels |
| Data | `--text-base` | 12 | 16px | 500 | table cells, KV values (Amber Desk: 11px) |
| UI | `--text-md` | 13 | 18px | 400 / 600 | panel titles, body |
| Body | `--text-lg` | 14 | 20px | 400 | notices, prose panels; Graphite command line |
| Sub-head | `--text-xl` | 16 | 22px | 600 | section heads in a panel |
| Figure | `--text-2xl` | 20 | 24px | 600 | stat tile value; Ledger serif titles 18–22 |
| Hero | `--text-3xl` | 24 | 28px | 700 | the one headline number per panel |

**Floor:** no number below 11px. 10px is allowed only for caps labels in Amber Desk.

### 2.3 Number rules (normative, every direction)

1. **Tabular by default** — set on the terminal root (§1.4). `.t-num` stays as a no-op inside.
2. **Numeric columns right-align**, header included; text left; a ticker column is text.
3. **Fixed decimals per column** (`formatNumber({decimals})`), never space padding.
4. **Units are text-3**: `182.46` text-1, `USD` / `B` / `%` / `x` text-3, same size.
5. **Signed changes** use `formatPercent({signed:true})` with a real minus (U+2212), coloured
   `--term-pos` / `--term-neg` as **text, never a filled cell** (Graphite may add a 15% tint
   behind large moves only), **and** a ▲▼ glyph or sign so colour is never the only channel.
   Zero is `0.00%` in text-3.
6. **Absent is `—`** (`ABSENT`) in text-3; never `0`, `N/A`, `null` or blank.
7. **Prices are never shortened**; volume, market cap and share counts always are
   (`formatCompact`).
8. **Times are ET** and say so once per panel (`as of 10:42:17 ET`), not per cell.

---

## 3. Space, shape, depth, density

### 3.1 Spacing — 4px grid

`--space-xs 4 · sm 8 · md 12 · lg 16 · xl 24 · 2xl 32`. Sanctioned off-grid values, each a
token: 2px cell padding-y (Amber Desk), 1px/2px hairline gaps between panels. Panel inner
padding is `--term-pad` (8 / 10 / 12 px by direction).

### 3.2 Radius

| Element | Amber Desk | Graphite | Ledger |
|---|---|---|---|
| Panel (`--term-radius`) | 0 | 6px | 0 |
| Controls, chips (`--term-radius-control`) | 0 | 4px | 2px |
| Sheets / popovers | `--radius-lg` 8px everywhere (they float; square floating sheets read as broken) | | |

### 3.3 Elevation

Flat: hierarchy comes from the bg-0..3 steps and 1px lines. Shadows only on things that float
above the grid — suggestion list and menus (`--shadow-popover`), Sheet (`--shadow-modal`),
toast. No shadows on panels, tiles, chips or data; no glass (`--glass-*`, `--hub-*`) in the
terminal. Panel separation: Amber Desk butts panels together with 1px hairlines and no gap;
Graphite uses a 2px `bg-0` gap and 6px radius; Ledger uses 1px rule frames.

### 3.4 Density

Each direction sets a base geometry (benchmark rows-per-panel targets at 1080p, 2×2 board). The
existing board density control (`comfortable / compact / dense` on `.shell[data-density]`,
desktop only) steps from it. **Touch tier (≤1024px) always uses the direction's base and the
44px floor on every control.**

| Token | Amber Desk | Graphite | Ledger |
|---|---|---|---|
| `--term-head-h` (panel header) | 20px | 28px | 34px (serif title + meta line) |
| `--term-row-h` | 20px | 26px | 31px |
| `--term-cell-py / -px` | 2 / 6px | 4 / 10px | 6 / 12px |
| `--term-fs-data` | 11px | 12px | 12–13px |
| rows per panel (target) | ~40 | ~28 | ~22 |
| `compact` step | — (already densest) | rows 22px | rows 26px |
| `comfortable` step | rows 22px | rows 30px | base |

The brief's "~24–28px compact rows" lands on Graphite (26 base / 22 compact / 30 comfortable).
`dense` remains the existing opt-in third step and maps to Amber Desk geometry.

---

## 4. Component specs

Common state vocabulary — every component below either implements a state or says "n/a":

| State | Visual rule |
|---|---|
| default | as specified |
| hover | `--term-bg-2` fill; text unchanged; desktop only (`@media (hover:hover)`) |
| focus | `outline: 2px solid var(--term-focus)`, inset 2px inside panels, outside elsewhere; `:focus-visible` only |
| active / selected | `--term-bg-3` fill + 2px `--term-accent` bar on the leading edge |
| disabled | `--term-text-disabled`, `cursor: not-allowed`, no hover; still 44px on touch |
| loading | skeleton bars in `--term-bg-2`, shape-true (rows for tables, blocks for KV); shimmer gated by `prefers-reduced-motion`; after 8s add "Still loading…" |
| empty | shared **state block** (§4.9), `kind="empty"` |
| error | state block `kind="error"` + Retry |
| stale | value in `--term-stale` + dashed `--term-warn` edge on the container + ⚠ + an explicit date ("as of Oct 3") — **never opacity alone** (today's `.regimeStale { opacity:.6 }` fails contrast); text "source data is stale" per `FreshnessBadge`'s never-bare-"stale" rule |
| pending | in-flight refresh of data already on screen: data stays visible, header freshness shows "updating", `--term-info` |
| paywalled | `availabilityContract` `entitlement_denied` → state block `kind="locked"`, one sentence + one CTA; the panel frame still renders so the board never collapses |

### 4.1 Panel frame + panel header

**One header component, same height and slot order in every panel** (benchmark pattern 6).
**Anatomy (left → right):** channel dot (`.groupDot`, link-group colour) · **function code**
(`DES`, data face 600) · **ticker** (data face 700, text-1) · **title** (text-2, ellipsizes
first; Ledger: serif) · flexible space · deep link (accent, "Research") · actions (duplicate ·
pop out · close: UIcon buttons, `gold={false}`, 24px desktop / 44px touch) · **freshness at the
far right end** (dot + relative age "12s", or `EOD`, or ⚠ `STALE · OCT 3`; `FreshnessBadge`
compact, never shrinks).

- Header height `--term-head-h`. Amber Desk: `bg-2` strip, caps, `CHANNEL · ENTITY · FUNCTION`.
  Graphite: `bg-1`, sentence case, no fill change. Ledger: serif title + small-caps meta line +
  gold hairline under the title.
- Focused panel: Amber Desk 1px gold **top** border (not a glow); Graphite and Ledger 1px
  accent outline inset. Unfocused panels never dim their data.
- **Do:** one hero number per panel at most; let the title ellipsize before ticker/code.
- **Don't:** put a TileCard (card-in-card) inside a panel; add icons to the title (the code *is*
  the icon); colour the header by data state.

### 4.2 Command line + suggestion list

**Anatomy:** prompt `>` (accent) · input (`--term-font-cmd`, 13px desktop / 16px touch) · echo
line above the input (`.echo`, the parse interpretation, 11px text-3; `ok` up-ink / `ask` info /
`warn` warn + ⚠ / `error` down-ink) · Go · suggestion list. In Amber Desk the command line is the
one place the accent fills an edge at rest (it is "editable" — the accent's role).

**Suggestion row:** `CODE · ticker? · label ……… kind` — code data face 700 text-1, label text-2,
kind (`function`, `board`, `alias`, `recent`) 10px caps text-3 at the right. Row 28px desktop /
44px touch. Selected row = active state. Matched characters text-1 700. Max 8 rows, then "N more
— keep typing".

States: focus (field edge `--term-accent`), empty input (placeholder "Type a ticker or function
— e.g. NVDA DES", text-3), no matches (one row "No function matches 'XYZ'. Try HELP."), error
(echo `error`), disabled (n/a). **Don't** put suggestion rows behind hover-only reveals.

### 4.3 L0 status strip

**Anatomy:** session dot + ET clock (`10:42:17 ET`, data face 700) · session label (11px caps:
open = up, extended = accent, closed = text-3) · exposure chip (label + value + tone glyph) ·
alert bell (`AlertBell`, as-is) · channel chip.

- Chips `--term-bg-2`, 1px `--term-line`, 22px tall desktop.
- Regime tones: bull → `--term-pos` ▲, neutral → text-2 (**not** gold), caution → `--term-warn`
  ⚠ (replaces literal `#e67e22`), bear → `--term-neg` ▼.
- Stale reading: dashed warn border + date ("61% · Oct 3"), value in `--term-stale` (replaces
  opacity).
- Phone: drop seconds and chip labels (already done), keep glyphs.

### 4.4 Data table

**Anatomy:** sticky header row (`position:sticky; top:0`, label step text-3, bottom rule
`--term-line-strong`) · body rows `--term-row-h` · optional row-number column (Amber Desk:
`3 <Enter>` opens row 3) · optional sticky first column (ticker) · footer (count + as-of; Ledger:
summary rows above a double rule).

- Separation: 1px `--term-line` row rules in every direction; **no zebra** (benchmark: no
  striping in any of the three).
- Numeric columns right-aligned (header too), units text-3, signed columns per §2.3, ticker 700
  text-1 left.
- Sort: click header cycles desc → asc → none (`useGridSort`); ▲/▼ in accent beside the label;
  `aria-sort`; sorted header text-1.
- Hover `--term-bg-2`; selected `--term-bg-3` + 2px accent leading bar; keyboard ↑/↓ move,
  Enter opens.
- Inline sparkline column (§4.10) 64×16.
- Loading: 8 skeleton rows; empty/error: compact state block in the body, header kept; stale:
  footer as-of in `--term-stale` + ⚠ "source data is stale".
- Touch: horizontal scroll inside the panel (`overflow-x:auto`) with the ticker column sticky;
  rows stay at base height unless tappable, then 44px.
- **Don't:** centre numbers; ellipsize numbers (ellipsize labels); fill cells with gain/loss
  colour; colour a whole row.

### 4.5 Key–value grid

Two columns (one ≤640px) of `key / value` pairs (DES style). Key: label step text-3, left.
Value: data step text-1, right-aligned within its pair. 1px `--term-line` under each pair
(Ledger: rules only, already the default). Range values (52-week) render as `low ─●── high` with
a 52px track in `--term-bg-3` and an accent dot. Missing → `—`.

### 4.6 Stat tile

Wrap research-kit `StatTile` (do not fork): eyebrow label · figure (`--text-2xl`) · sub-line
(signed change or context, 11px). Fill `--term-bg-2`, `--term-radius-control`, no shadow, no
icon. Score tone only via its `tone` prop (`--score-*`); a gain/loss delta goes in the sub-line
with a glyph — never colour the figure red (reads as error). States: loading (figure skeleton),
stale (sub-line becomes the dated as-of), absent (`—`).

### 4.7 Chip / badge

| Kind | Look | Use |
|---|---|---|
| Neutral chip | `bg-2`, `line` border, text-3 label + text-1 value | L0, filters |
| Verdict chip | research-kit `VerdictChip` (glyph + word, `-bg` fill) | positive / negative / caution |
| Freshness badge | 10px caps: `LIVE` (up ink), `EOD` (text-3), ⚠ `STALE · date` (warn, dashed) | panel header right end |
| Count badge | pill, accent-dim fill | menu counts |

20px tall desktop; on touch a chip that is a control gets a 44px hit area via padding, not by
growing the visual. **Don't** use the accent for warnings or up/down colours for non-price
meaning.

### 4.8 Tabs

Underline tabs inside a panel (Income / Balance / Cash). Label 12px 600 text-3; active = text-1
+ 2px accent underline; hover text-1; focus ring inset. Overflow scrolls horizontally; never
wraps. `role="tablist"`, arrow keys. Touch 44px. Amber Desk puts mnemonic tabs in the header
strip. Reuse research `SectionTabs` styling via tokens; no second tab component.

### 4.9 State block — empty / error / pending / locked / stale (one shared look)

One component, `TerminalState` (lane 2), wrapping research-kit `EmptyState` so the app keeps
**one** empty idiom. Anatomy: monochrome UIcon (`gold={false}`, 18px; 16px compact) · title (what
is missing, 13px 600 text-2) · hint (when it arrives / what to do, 12px text-3) · one action · a
2px leading bar in the kind's colour.

| kind | Icon | Title example | Action | Bar |
|---|---|---|---|---|
| `empty` | `document` | "No insider sales in the last 90 days" | "Widen to 1 year" | none |
| `error` | `warning` | "Couldn't load institutional holders" (+ cause from `describeFailure`) | Retry | `--term-neg` |
| `pending` | `clock` | "13F changes update after quarter-end filings" | — | `--term-info` |
| `locked` | `noEntry` | "Filing diffs are part of UCT Pro" | one CTA | `--term-accent` |
| `stale` | `warning` | "Showing Oct 3 — source data is stale" | Refresh | `--term-warn`, dashed |

Copy rule (research-kit §4.4): never "No data". Centred in the panel body, max 36ch. A `compact`
variant (one line) for table bodies and panels under 160px tall.

### 4.10 Sparkline / mini-chart

Sparkline: inline SVG 64×16 (table) or 120×32 (tile). One 1.4px line in text-3 (a shape, not a
series), a 2px end dot in `--term-pos`/`--term-neg` by the period's sign. No axes, no tooltip in
tables (the adjacent cell carries the period change); `aria-hidden`. Reuse
`components/mobile/RowSpark.jsx`; its stroke reads `var(--term-text-3, <today's value>)`.

Mini-chart (panel-sized): price line 2px (Amber Desk: text-1 on a black field, no grid;
Graphite: text-1, grid at 4% white; Ledger: line-first with 8% area fill, dotted horizontal
grid), right-hand axis in data face 10px text-3, volume bars below at 35–45% of
`--term-pos`/`--term-neg`, last-price pill on the axis, crosshair + readout on hover. Gold is
reserved for user-drawn levels and alerts. **The full chart panel (`ChartPanel`) keeps its engine
and `designTokens.js` colours untouched** — this covers DOM chrome and the small SVG/echarts
charts only. Candle direction must also differ by fill (hollow up / filled down), so it survives
greyscale and the cvd swap.

### 4.11 Sheet / popover

`Sheet` (desktop modal, touch bottom-sheet) and `ContextPopover` as-is. Inside the terminal: fill
`--term-overlay`, header 44px with title (13px 600) and close, rows 32px desktop / 44px touch,
footer actions right-aligned (primary = accent fill, dark ink). Popovers anchor with 4px offset,
`--shadow-popover`, 8px radius. Esc closes; focus returns to the trigger. **Don't** stack a sheet
on a sheet; **don't** use a popover for a form of more than two fields.

### 4.12 Toasts / notices

- **Notice** (today's `.notice`): full-width bar under the command line for a command's result —
  info (`--term-info-bg`), error (`--term-neg-bg`, down ink), with optional "Did you mean" chips
  and a 44px-touch close. One at a time; replaced by the next command.
- **Toast**: bottom-right (desktop) / above the safe area (touch), `--term-overlay`,
  `--shadow-popover`, 4s, pauses on hover, `role="status"`; for background events (board saved,
  alert fired). Max 2 visible. Never carries an error the member must act on — that is a notice.

### 4.13 Phone panel switcher

Below the command bar (`.phoneBar`): a horizontally scrolling `role="tablist"` of panel tabs, each
`CODE TICKER` (e.g. `DES NVDA`) with its channel dot, 44px tall, active = accent underline +
text-1. A trailing `+` tab opens the functions Sheet. Unfocused panels stay mounted (`hidden`), so
switching is instant and scroll position survives. No swipe-between-panels (conflicts with
horizontal table scroll).

---

## 5. Three directions — same names, different values

The benchmark's three directions, as complete value sets for the `--term-*` names. Nothing in §4
changes between them. Dark-theme values; under `[data-theme="light"]` colours map to the
canonical light tokens (§1.1).

### 5.1 Colour

| Token | A · Amber Desk | B · Graphite (recommended default) | C · Ledger |
|---|---|---|---|
| `--term-bg-0` | `#000000` | `#0e0f11` | `#0b0a08` |
| `--term-bg-1` | `#0b0a08` | `#15161a` | `#100e0b` |
| `--term-bg-2` | `#16140f` | `#1c1e22` | `#18150f` |
| `--term-bg-3` | `#221f17` | `#24262b` | `#221e16` |
| `--term-line` | `#2a261d` | `#2a2c31` | `#2c271d` |
| `--term-line-soft` | `#2a261d` | `#222428` | `#2c271d` |
| `--term-line-strong` | `#2a261d` | `#2a2c31` | `#3a3326` (1.5px) |
| `--term-text-1` | `#ece4cf` | `#ecebe6` | `#efe6d2` |
| `--term-text-2` | `#b3aa93` | `#aaa79f` | `#b8ad96` |
| `--term-text-3` | `#8a826e` | `#8c8981` | `#8f856f` |
| `--term-accent` | `#f0b93a` | `var(--accent)` = `#dcbb5e` | `#d9b45f` |
| accent is used for | command line, editable fields, focus, compass | focus, selection bar, active tab, compass | rules, titles, focus, compass |
| `--term-up` / `--term-down` | `#3fd18a` / `#ff6b5e` | `#3ccf8e` / `#f47067` | `#5cc995` / `#ef7a6b` |
| `--term-up-cvd` / `--term-down-cvd` | `#5aaeff` / `#ff9a3c` | `#5aaeff` / `#ff9a3c` | `#5aaeff` / `#ff9a3c` |
| `--term-warn` | `#ff8f3d` + ⚠ | `#f0883e` + ⚠ | `#e8913f` + ⚠ |
| `--term-info` | `#6cb6ff` | `#79a8f7` | `#8fb3e0` |

Contrast (benchmark §4, WCAG 2.x): text-1 ≥14:1 on every panel surface; text-3 4.8–5.3:1 (labels
only — recheck on `bg-3` selected rows during build); down 7.1 / 6.3 / 7.0:1 on the panel
background; cvd pair 7.7–9.4:1.

⚠️ **The cvd orange is close to the warn orange** (`#ff9a3c` vs `#f0883e`). In colour-blind mode a
down move and a stale warning differ by glyph (▼ vs ⚠) and placement only. Acceptable because
neither is ever colour-only, but call it out at build and check it with the dataviz palette
validator before shipping (§7 D-V6).

### 5.2 Type, geometry, chrome

| | A · Amber Desk | B · Graphite | C · Ledger |
|---|---|---|---|
| UI / data face | Plex Sans Condensed / same, `tnum` | Instrument Sans / same, `tnum` | Instrument Sans / Plex Mono (owner call) or Instrument Sans `tnum lnum` |
| Command line face | JetBrains Mono 13px | Instrument Sans 14px | Instrument Sans 14px |
| Titles | Plex Sans Cond 600 caps +0.04em | Instrument Sans 600, sentence case | Instrument Serif 18–22px + small-caps meta |
| Labels | 10–11px caps +0.04em | 11px caps +0.06em | 11–12px small-caps |
| Header / row / padding | 20 / 20 / 2·6px | 28 / 26 / 4·10px | 34 / 31 / 6·12px |
| Rows per 2×2 panel @1080p | ~40 | ~28 | ~22 |
| Panel separation | 1px hairline, no gap, 0 radius | 2px `bg-0` gap, 6px radius | 1px rule frames, 0 radius |
| Focused panel | 1px gold top border | 1px accent outline | 1px accent outline |
| Tables | numbered rows, row rules, no zebra | row rules, 15% tint behind big moves only, percentile bars | broadsheet: rules only, 1.5px head rule, small-caps heads, summary above a double rule |
| Chart field | black, no grid | `bg-1`, grid 4% white | dotted horizontal grid, 8% area |
| Motion | 300ms text-colour flash on change (switchable) | 120ms hover/focus, 250ms background flash | none by default, 150ms content fade |
| Best user | desk / power user, 4–9 panels | broad member base | research & Compass surfaces |
| Change from today | large | small — mostly token values | large |

### 5.3 Recommendation

**B · Graphite as the default** (owner decision D-V1): it is the smallest step from today, needs
no new font request, and the four fixes of §1.4 land with it. The benchmark's hybrid is cheap
because the names are shared: **Amber Desk as the "dense" preset** for members who live in the
terminal, and **Ledger's typography for reading surfaces** (filings, write-ups, Compass) if the
owner likes it in the prototype.

---

## 6. Migration plan — parallel lanes on disjoint files

### 6.0 Lane 0 — foundation (serial, must land first; small)

| Change | Files |
|---|---|
| `terminalTokens.css`: Graphite base + Amber Desk + Ledger blocks, cvd block, density steps, light-theme mapping, root `font-variant-numeric: tabular-nums`, all under `[data-terminal-root]` | **new** `app/src/pages/terminal/terminalTokens.css` |
| Shell root carries `data-terminal-root`, `data-term-direction`, `data-term-cvd`; import the CSS | `TerminalShell.jsx` (attributes + one import) |
| Store direction and cvd beside density | `boardModel.js` (`DIRECTIONS`, default `graphite`; `cvd` boolean) + `boardModel.test.js` |
| **Mechanical split** of `TerminalShell.module.css` into `Shell.module.css` (bar, cmd, echo, suggest, notice, rail, menu, help), `PanelFrame.module.css` (grid, panel, panelHead, groupDot, panelAct, panelTitle/Label/Freshness/Link/Body/Empty), `PhoneBar.module.css` (phoneBar, phoneSwitcher, the 640 block) — **no value changes**, so lanes 1/2/6 never share a file | `TerminalShell.module.css` → 3 files; `TerminalShell.jsx` imports |
| Self-host the faces Amber Desk / Ledger need (only if the owner keeps them): IBM Plex Sans Condensed, JetBrains Mono, Instrument Serif, IBM Plex Mono | `app/public/fonts/*.woff2`, `app/index.html` `@font-face` |
| New rail `terminalTokens.test.js`: (a) every direction block declares the same `--term-*` key set; (b) hex/rgb literals appear **only** in `terminalTokens.css` — any terminal or panel stylesheet with a colour literal fails by name; (c) no `--term-*` declared in `tokens.css`; (d) no bare global `[data-density]` selector in terminal CSS; (e) a terminal stylesheet that re-points a canonical token in a nested selector re-declares the `--term-*` it reads; (f) in every direction `--term-warn` ≠ `--term-accent` and `--term-down` clears 4.5:1 on `--term-bg-1` and `--term-bg-2` (computed with `styles/__tests__/contrastMath.js`) | **new** `app/src/pages/terminal/terminalTokens.test.js` |

Rails that must stay green: `TerminalShell*.test.jsx`, `phoneSwitcher.test.jsx`,
`styles/tokens.reachable.test.js`, `styles/themeIslands.test.js`, `styles/tapFloor.test.js`,
`styles/tokens.test.js`, `functions.rail.test.js`, `parityMatrix.test.js`.

### 6.1 Parallel lanes (after lane 0)

| Lane | Owns (and only these files) | Converts | Must keep green |
|---|---|---|---|
| **1 · Shell chrome** | `Shell.module.css`, `L0Strip.module.css`, `L0Strip.jsx` (tone glyphs only), `CommandLine.jsx` (markup hooks only), `BoardsMenu.jsx` | command line, echo, suggestion list (§4.2), notice (§4.12), L0 strip (§4.3: warn token, stale treatment), rail, menus; direction + cvd controls in the bar. Removes bridge aliases and wrong literal fallbacks from these files. | `L0Strip.test`, `CommandLine.test`, `BoardsMenu.test`, `TerminalShell*.test`, `tapFloor`, `tokens.reachable` |
| **2 · Panel frame + shared states** | `PanelFrame.module.css`, **new** `pages/terminal/kit/TerminalState.jsx` (+ css, test), **new** `kit/Toast.jsx`, `panelFreshness.js` (read only unless needed) | panel header anatomy with freshness at the right end (§4.1), focus treatment, state block (§4.9, wrapping research-kit `EmptyState`, not forking it), toast | `panelFreshness.test`, `TerminalShell*.test`, provenance `FreshnessBadge`/`AbsenceReceipt` tests, `panelAdoption.ratchet.test`, research-kit `EmptyState.test`, `tapFloor` |
| **3 · Tables & numbers** | **new** `kit/DataTable.module.css`, `kit/KeyValueGrid.jsx`, `kit/Num.jsx` (format + unit span + signed colour + glyph); `lib/presentation/dataGrid/*` only if a hook needs an option | data table (§4.4, incl. Amber's row numbers via `--term-rownum-display`), KV grid (§4.5), number rules (§2.3), the dense 10px→11px fix | `presentationSingleFormatter`, `handRolledFormatters.census`, `priceIsTwoPrimitives`, `compactAdoption`, `s10Adoption`, `dataGridSeed.rail`, `gridSort.test`, `presentationPrimitives.test` |
| **4 · Charts** | `components/mobile/RowSpark.*`, `components/research-kit/charts/*.module.css`, **new** `kit/MiniChart.jsx` | sparkline (§4.10) via fallback-guarded tokens; echarts chrome (axis ink, grid line) reading `--term-*` with fallbacks; hollow-up/filled-down candles in the mini chart. **Never** `components/chart/*` or `designTokens.js`. | `RowSpark.test`, `echartsCore.test`, each `charts/*.test`, `components/chart/designTokens.test.js` (must not change), `themeIslands` |
| **5a · Panels: terminal-owned** | `pages/terminal/panels/*` | Overview (DES: hero + KV + stat tiles), Move, Help, Depth, MyResearch, Chart wrapper | their `*.test.jsx`, `functions.rail.test` |
| **5b · Panels: research tabs** | `pages/research/tabs/*.module.css` (`*.jsx` only for class hooks) | News, Catalysts, Technical, Ratings, Ownership, People, Calls, Filings… via fallback-guarded reads — `/research` must render unchanged | each tab test, `EarningsResearchModal.themeIsland.test`, `panelAdoption.measure/ratchet` |
| **5c · Panels: depth + FMP** | `pages/research/depth/*`, `components/research/fmpDepth/*` | Events, FilingSearch, EarningsReaction, FTD, Financials, Estimates… | their tests, `panelAdoption.*` |
| **5d · Panels: options + calendar + surfaces** | `pages/optionsAnalytics/*`, `pages/screener/options/*`, `pages/Calendar*` (CSS only) | VolStats, Positioning, MarketTide, StrategyScreens, OptionsScreener, Calendar | their tests, `components/screener/reachable.test`, `tapFloor` |
| **6 · Phone** | `PhoneBar.module.css`, phone blocks of `Shell.module.css` **after lane 1 merges** (or lane 1 hands the 640 block over at lane 0) | phone switcher (§4.13), Sheet styling inside the terminal, touch-tier table scroll | `phoneSwitcher.test`, `Sheet*.test`, `ContextPopover.test`, `tapFloor`, mobile audit sweep (manual, phone + tablet viewports) |

**Ordering inside lane 5:** 5a first (proves the kit from lanes 2/3 on panels the terminal
owns); 5b/5c/5d in parallel after lanes 2 and 3 merge, since they consume `TerminalState` and
`Num`. Lane 4 can merge at any time. Per the repo's concurrency rule, at most three lanes run at
once.

**Per-lane definition of done:** the lane's files contain no bridge alias, no colour literal
outside `terminalTokens.css`, no new breakpoint literal, no emoji; the lane's rails pass; a
before/after screenshot set per direction × {Graphite theme, Light theme} × {cvd off, on} at
1440px and 390px is attached to the PR; a `/research/NVDA` screenshot is unchanged for any lane
touching shared components.

### 6.2 Risks

- **Fallback drift:** a fallback-guarded read whose fallback is not today's value silently
  restyles `/research`. Mitigation: the screenshot-unchanged check, and fallbacks copied from the
  current declaration in the same commit.
- **Literal palettes vs catalog skins:** Amber Desk and Ledger set their own canvas and accent,
  so a member on a catalog skin sees the terminal ignore it. Graphite follows the skin's accent.
  Decide whether a non-default direction overrides the skin (§7 D-V5).
- **Self-hosted fonts** (A and C) add bytes to every terminal load when active; lazy-load per
  direction, `font-display: swap`, `@font-face` still inline in `index.html`.
- **cvd orange vs warn orange** (§5.1).

---

## 7. Owner decisions requested

| ID | Question | Recommendation |
|---|---|---|
| D-V1 | Default direction | **B · Graphite**; Amber Desk as the dense preset |
| D-V2 | Keep A · Amber Desk and C · Ledger as member options at all | Decide from the prototype |
| D-V3 | Ledger's data face: IBM Plex Mono (reverses the recorded "no mono for prices" choice) or Instrument Sans `tnum lnum` | Instrument Sans fallback unless the mono reads clearly better in the prototype |
| D-V4 | Promote the warn/down/tnum fixes from the terminal layer to app-wide `tokens.css` (touches every theme island) | Later, after the terminal proves them |
| D-V5 | Light theme and catalog skins for Amber Desk / Ledger: own light palettes, or fall back to canonical tokens | Fall back (as specified) until a member asks |
| D-V6 | cvd down `#ff9a3c` vs warn `#f0883e` — accept with glyph separation, or shift warn toward yellow-orange in cvd mode | Validate with the palette checker, then decide |
