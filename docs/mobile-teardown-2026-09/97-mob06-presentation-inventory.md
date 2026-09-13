# MOB-06 — mobile chart control inventory and presentation policy

**INVENTORY ONLY. No visibility, placement, CSS or interaction behaviour was changed.**
Measured against current master + Wave-1 commits, not against research-era assumptions.

## How each row was measured, and the one limit you must hold in mind

| instrument | what it can prove |
|---|---|
| **Real iPhone 15 / iOS 17.5** (BrowserStack + Local → sandbox) | Everything, including the CSS pointer branch. Used for the three `(pointer: coarse)` hides. |
| **390×844 iframe, `matchMedia` patched coarse** | **JS branches only.** ⚠️ The patch fools `matchMedia()` calls; it does **not** change what the CSS engine evaluates. So this frame still renders the *fine-pointer* CSS. |
| **Source** (`git show origin/master:…`) | Reachability, alternative paths, absence. |

⛔ **The consequence, stated up front:** every "hidden by `(pointer: coarse)`" claim below rests on
**real-device** evidence. Every "0×0 / display:none / absent" claim rests on the emulated frame,
where those are *pointer-independent* layout facts. I have not mixed the two.

---

## The complete inventory

Categories: `AV`=ALWAYS_VISIBLE_MOBILE · `CTX`=CONTEXTUAL_MOBILE · `TS`=TOOLS_SHEET ·
`HDF`=HIDDEN_DESKTOP_FURNITURE · `GR`=GESTURE_REPLACED · `NA`=NOT_APPLICABLE

### 1 · Chart shell chrome — permanently visible on the phone

| control | desktop | phone | cat | alt path | tap Δ | evidence | TradingView | rec |
|---|---|---|---|---|---|---|---|---|
| App menu | sidebar | 44×44 in symbol strip | `AV` | — | 0 | real device | hub | `NO_CHANGE` |
| Symbol + search | header badge | 322×44 strip, opens sheet | `AV` | — | 0 | real device | symbol header, same | `NO_CHANGE` |
| Live quote | header | in the strip | `AV` | — | 0 | real device | header | `NO_CHANGE` |
| **Timeframe** | 8 inline buttons | 64×44 → sheet | `AV` | — | +1 vs desktop | real device | scrolling sheet | `NO_CHANGE` — ⭐ `CMP-015` UCT_AHEAD |
| Chart type | toolbar | 71×44 → sheet | `AV` | — | +1 | real device | hub → sheet | `NO_CHANGE` |
| Indicators | toolbar | 71×44 → sheet | `AV` | — | +1 | real device | hub → picker | `NO_CHANGE` |
| Watchlist | widget | 71×44 → page | `AV` | — | 0 | real device | tab (2 taps to chart) | `NO_CHANGE` — ⭐ `CMP-010` |
| More tools (⋯) | — | 71×44 → Tools sheet | `AV` | — | — | real device | ••• hub | `NO_CHANGE` |
| Voice orb | FAB | 64×64 FAB | `AV` | — | 0 | emulated | none | `NO_CHANGE` (see H) |
| Feedback ? | FAB | **40×40** FAB | `AV` | — | 0 | emulated | none | `REPOSITION` — under the 44px floor |

### 2 · Contextual — appear on state, correctly

| control | desktop | phone | cat | alt path | tap Δ | evidence | TradingView | rec |
|---|---|---|---|---|---|---|---|---|
| Crosshair OHLC legend | hover | press-and-hold | `CTX` | — | 0 | **real device** | same model | `NO_CHANGE` — ⭐ verified strength |
| `DrawingQuickBar` | right-click menu | Style/Duplicate/Lock/Delete, 44×44 | `CTX` | long-press menu | 0 | **emulated coarse** (MEASURE-01) | floating properties bar | `NO_CHANGE` |
| Go-to-realtime pill | button | appears when scrolled off | `CTX` | — | 0 | real device | same | `NO_CHANGE` |
| Long-press price sheet | right-click | price-anchored sheet | `CTX` | — | 0 | **real device** | ⊕ menu, narrower | `NO_CHANGE` — ⭐ `CMP-049` |
| Drawing object menu | right-click | long-press | `CTX` | — | 0 | fine-pointer | fixed list | `NO_CHANGE` — ⭐ type-aware |
| 18 drawing tools + Eraser | always-visible rail | horizontally scrollable bar | `CTX` | — | +2 (Tools→Draw) | **real device** + emulated | tabbed searchable picker | `NO_CHANGE` **but see F** |
| Undo / Redo | toolbar | **40×44, visible in draw bar** | `CTX` | — | +2 | emulated | toolbar overflows viewport | `NO_CHANGE` |
| Snap-to-price (magnet) | toolbar | 40×44 in draw bar | `CTX` | — | +2 | emulated | drawing-mode toggle | `NO_CHANGE` |

### 3 · Tools sheet — correctly relocated

| control | desktop | phone | cat | alt path | tap Δ | evidence | rec |
|---|---|---|---|---|---|---|---|
| Set price alert… | toolbar | Tools row | `TS` | long-press → "Alert when…" | +2 / 2 | real device | `NO_CHANGE` |
| Draw on chart | always-visible rail | Tools row | `TS` | — | +2 | real device | `NO_CHANGE` |
| Flag symbol | right-click | Tools row | `TS` | — | +2 | real device | `NO_CHANGE` |
| Share chart image | toolbar (`display:none` on phone) | Tools row | `TS` | — | +2 | real device | `NO_CHANGE` — alt verified |
| Chart settings | toolbar gear (**absent from phone DOM**) | Tools row → modal | `TS` | long-press has the 3 hot toggles | +2 / 0 | real device | `NO_CHANGE` — ⭐ `CMP-060` |
| **Layouts** | LAYOUTS ▾ | Tools row → sheet | `TS` | — | +2 | **real device** | full CRUD on phone | `NO_CHANGE` — shipped MOB-01 |
| Widgets / Add widget | WIDGETS ▾ | Tools bands | `TS` | — | +2 | real device | hub | `NO_CHANGE` |

### 4 · Hidden by `(pointer: coarse)` — the entire existing "rule", all three of it

| control | desktop | phone | cat | **alternative path — VERIFIED?** | tap Δ | evidence | rec |
|---|---|---|---|---|---|---|---|
| `.liveIndicator` ● LIVE | pill | **hidden** | `HDF` | ✅ **YES** — the strip's tick-flash signals liveness, and `.staleIndicator` is *not* hidden, so STALE/RECONNECTING still render | n/a | real device + source | `NO_CHANGE` |
| `.scaleToggle` **A / L / %** | 3 chips (17×11) | **hidden** | ⚠️ **PARTIAL** | **Log ✅** long-press → "Logarithmic scale" (2). **Auto ✅** price-axis long-press → "Auto-scale" (2). **Percent ❌ NO PATH — the chips are the only writer of `percentScale` in the entire app; `ChartSettingsModal` has no scale control** | 0→2 / 0→**∞** | real device (hidden) + source (paths) | **`RESTORE_VISIBILITY` (partial) — see C** |
| `.volLegend` **Vol · $ Vol · Avg ND** | volume-pane legend | **hidden** | ⚠️ **PARTIAL** | **Vol ✅** the main crosshair legend carries `Vol` (real-device capture showed `V 102.7M`). **$ Vol ❌** and **Avg ND ❌ — no other surface renders either** | 0→0 / 0→**∞** | real device (hidden + legend content) + source | **`MAKE_CONTEXTUAL` — see C** |

⭐ **The stated rationale in the CSS does not hold for two of its three targets.** The comment
reads: *"desktop furniture — on a 393px canvas they cover candles to answer questions the settings
sheet already answers."* Verified: the settings sheet answers **neither** Percentage scale **nor**
dollar/average volume. It is a correct instinct with an incorrect justification, applied to a
mixed bag.

### 5 · In the phone DOM but unreachable — ⛔ **THIS SECTION IS WRONG. See `98`.**

> 🔴 **CORRECTED 2026-09-08 — the mechanism below is a mis-read, and the correction is
> `98-mobile-presentation-contract.md` §0.** Re-measured on the live phone shell, the
> **whole `ChartToolbar` carries an inline `display:none`** (`MobileChartsApp.jsx` →
> `mobileDrawBar: true` → `hiddenHost` → `ChartToolbar.jsx:1247`), and the intent is
> stated in-file. The children below report `display:flex` at 0×0 only because `display`
> is not inherited — a child of a hidden element still computes its own value and still
> measures zero. So these are **one deliberate, documented decision, not eleven
> accidents**, and Summary G's "undocumented, unintentional-looking" verdict does not
> survive. What *was* right — that no alternative-path analysis had been done for them —
> is carried out control by control in `98` §3.2, which also names two controls this list
> omits (`Line style`, `Text size`) and resolves every ❌/⚠️ below.
>
> ⚠️ **Left standing rather than rewritten**, because how a DOM dump made a hidden
> ancestor look like a layout accident is the lesson.

Eleven controls render at **0×0 with `display:flex`** — collapsed to zero width by the
`ChartToolbar` layout, not hidden by any media query or product decision:

`Drawing color` · `Line width` · `Hide all drawings` · `Delete selected` · `Clear all drawings` ·
`Customize drawing tools` · `Drawing Boards` · `Repeat drawing` · `OHLCV legend mode` ·
`Magnet (toolbar copy)` · `Indicator alerts`

| control | alt path on phone | verified? | rec |
|---|---|---|---|
| Drawing color / Line width | quick bar → **Style** → the same sheet | ✅ | `NO_CHANGE` |
| Delete selected | quick bar → **Delete** | ✅ | `NO_CHANGE` |
| Hide all / Clear all drawings | **none found** | ❌ | `MOVE_TO_TOOLS` (candidate) |
| Repeat drawing | **none found** | ❌ | `MOVE_TO_TOOLS` (candidate) |
| **OHLCV legend mode** | Tools → Chart settings → "Chart Legend" 3-way | ✅ (3 taps) | `NO_CHANGE` — but see F |
| Drawing Boards (tracings) | **none found** | ❌ | owner call |
| Indicator alerts | Indicators sheet? **unverified** | ⚠️ | `MEASURE` before deciding |
| Customize drawing tools | **none found** | ❌ | low value on phone |

### 6 · Genuinely absent from the phone

| control | phone state | alt path | rec |
|---|---|---|---|
| **Replay / Time Machine** | `display:none` in both collapsed *and* toggled states | none | confirms `CMP-079` `DESKTOP_ONLY` |
| **Compare symbols** | **not in the phone DOM at all** | none | confirms `CMP-080` `DESKTOP_ONLY` |
| Keyboard shortcuts | absent | n/a | `NOT_APPLICABLE` |
| Countdown to bar close | absent | n/a | `NOT_APPLICABLE` |

---

## Summary A–H

**A · Remain exactly as-is.** Timeframe row, symbol strip, watchlist button, Tools sheet and all
seven of its rows, crosshair legend, long-press price sheet, drawing object menu, quick bar,
go-to-realtime, undo/redo, magnet, Layouts.

**B · Already correctly desktop furniture.** `.liveIndicator` — and it is the **only** one of the
three whose replacement path fully covers the task.

**C · Hidden today, should be reconsidered.**
1. **Percentage scale** — hiding `.scaleToggle` removes the *only* control that writes
   `percentScale`. Log and Auto survive via long-press; Percent does not exist on the phone.
   ⚠️ *Counter-argument to weigh:* Percent is chiefly useful with comparison symbols, which are
   themselves `DESKTOP_ONLY`, so its practical phone value may be low. **That is a product call,
   which is why this is a recommendation and not a change.**
2. **`$ Vol` and `Avg ND`** — no surface on the phone carries either. Relative-volume context is
   core to UCT's own methodology (the scanner scores `vol_acc_ratio`, `volume_n_week_low`).
   Suggested shape: fold both into the **existing** crosshair legend (already contextual, already
   proven on device) rather than restoring a second permanent strip.

**D · Visible today, should become contextual.** None. Nothing permanently visible on the phone
is unearned.

**E · Belong in Tools.** Candidates only, all currently unreachable: Hide-all / Clear-all
drawings, Repeat drawing. Low individual value; worth one row, not five.

**F · No presentation change, but discoverability work.**
- The **18-tool drawing bar**: all 18 are laid out in a horizontally scrollable bar; ~3–4 fit at
  390px and there is **no scroll affordance or coach-mark** (real-device confirmed). The gap is an
  affordance, not a picker (`CMP-034`, and `MOB-04` already owns it).
- The **OHLCV legend mode** is 3 taps deep with no phone-visible indication that the legend has
  modes at all.

**G · Inconsistencies that justify a shared mechanism.** 🔴 **SUPERSEDED — see `98` §0 and §5.**
Mechanism 2 below is a mis-read (the toolbar is deliberately `display:none` in full), so the
"three levels of intent" premise is gone and a shared mechanism was **not** warranted; `98`
records why, and is the register that closes the real gap. The phone
hides controls by **three unrelated mechanisms** with three different levels of intent:
1. `@media (pointer: coarse)` → 3 controls, deliberate, documented, rationale partly wrong;
2. **zero-width layout collapse** → 11 controls, **undocumented, unintentional-looking, never
   alternative-path-checked**;
3. `display:none` / omitted from the tree → 2 controls, deliberate.
An engineer cannot tell which of the three a given control is in, or whether its absence was ever
a decision. **That — not "hide more things" — is what a shared mechanism should fix.**

**H · Proposals that would remove a verified UCT advantage.** None proposed. Explicitly protected:
the long-press price sheet, the crosshair readout, `Set level…`, seeded drawing alerts, type-aware
object menus, the Layouts sheet, the one-tap watchlist→chart loop, and the depth-zero timeframe row.

---

## WHAT IS MOB-06 ACTUALLY?

### **5 · BACKLOG ASSUMPTION INVALID — REDEFINE MOB-06** (with a small **2** inside it)

The backlog framed MOB-06 as *"generalize the validated phone-presentation rule."* Both halves of
that premise fail on inspection:

- **It is not validated.** The rule is three CSS lines, and its own stated rationale — *"questions
  the settings sheet already answers"* — is false for two of its three targets. Percentage scale
  and dollar/average volume are answered nowhere on the phone.
- **It is not the mechanism that matters.** The rule hides 3 controls. **Zero-width layout
  collapse hides 11**, with no policy, no documentation and no alternative-path analysis. A
  generalisation of the small rule would formalise a flawed rationale while leaving the larger,
  accidental mechanism untouched.

**Proposed redefinition — MOB-06′:** *make the phone's control-visibility decisions legible and
alternative-path-checked, and fix the two places where hiding removed the only path to a task.*
Concretely, and in this order:

1. **Restore the two orphaned tasks** (Percent scale; `$ Vol` / `Avg ND` into the existing
   crosshair legend) — or record them as deliberate omissions. Either is fine; *unrecorded* is not.
2. **A one-line register** — each phone-hidden control names its category and its verified
   alternative path. This is the C2 "register" recommendation from the research applied to
   controls instead of features, and it is what makes the third mechanism auditable.
3. **Only then**, if the register shows genuine duplication, a shared class or custom property —
   likely a *small CSS normalization* (option 2), not a component registry.

⛔ **What MOB-06 should NOT become:** a pass that hides more controls at 390px. The inventory found
**zero** controls that are permanently visible and unearned.

---

## STOP GATE

Nothing was changed. No CSS, no visibility, no placement, no interaction behaviour.
Awaiting review of this policy before any implementation.
