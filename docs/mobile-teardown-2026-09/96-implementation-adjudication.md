# Implementation-phase adjudication

**Companion to the certified research package on `research/mobile-tv-teardown-docs`.** The
research forbids silently editing its ledgers; every correction found while implementing lands
here, with the evidence that produced it. Backlog ids are from `85-implementation-backlog-and-waves.md`.

**Standing rule this phase inherits:** *responsive/fine-pointer absence is not evidence that a
mobile capability is absent*, and the same discipline applies in reverse — **the presence of a
DOM node in a fine-pointer frame is not evidence a control is usable on a phone.** Both
directions bit during this session and are recorded below.

---

## MOB-03 · P0 legend / member-state — **P0_NOT_REPRODUCED**

Gate run before writing any fix, per instruction. Full commit: `e433e98f6`.

| step | finding |
|---|---|
| resolution rule | `legendModeOf` treats **only** an explicit `showLegend === false` as "off". Unset, `true`, and unrecognised modes all take `DEFAULT_LEGEND_MODE = 'always'`. **The fallback resolves *towards* the legend.** |
| defaults | `chartDefaults.js:74` ships `showLegend: true`; the UCT default workspace blob carries `"showLegend":true`. Nothing *defaults* a member into the off branch. |
| **production state** | Read read-only from `/api/auth/preferences` on the live account: `chart_settings.header = { showLegend: true }`, **no `legendMode` key** → resolves `'always'`. Legend ON. |
| the off cohort | Only members who deliberately used the old show/hide checkbox — which has since been **removed** (`ChartSettingsModal.jsx:1096`), so no new blob can acquire it. Honouring their choice is correct. |
| recoverable on a phone? | **Yes.** Tools → Chart settings → `ChartPane.openSettings()` → `ChartSettingsModal`'s three-way "Chart Legend" control. Also `aria-label="OHLCV legend: Always on"` in the chart toolbar. |
| the stamping defect that *was* real | 2026-08-16/17 stamped `'always'` — the **permissive** value — and is already fixed and railed by `legendStamp.test.js`. |

### What the original observation actually was
The render gate is
`crosshairData && !hideLegend && legendMode !== 'off' && (legendMode !== 'hold' || legendHeld)`
— **crosshair-gated, with no pointer clause anywhere.** A synthetic pointer never produced a
crosshair that lightweight-charts accepted, and `.volLegend` is **not** crosshair-gated, so the
volume strip rendered beside an absent OHLC row and read as a missing feature. Same
false-negative mechanism the research already documented for this lane.

**Shipped instead of a fix:** `legendMode.legacyResolution.test.js` — 10 tests pinning the
resolution matrix (including the exact production header shape) plus three source-derived
assertions that the gate names no pointer/coarse/touch/viewport token. **Mutation-checked three
ways** (invert the fallback · flip the default to `'off'` · drop the `'click'` alias) — each goes
red. Bytes restored by snapshot + `os.replace`, never `git checkout`.

---

## MOB-02 · Phone watchlist row — **NARROWED, layout claims DISPROVEN**

Reproduced on current master (`9c6078503`) in a **390×844 same-origin iframe** against a local
sandbox on `:8092`, admin account, watchlist seeded with 9 real symbols.

**Rendered:**
```
‹ Lists   MobTest
Symbol   Price   Vol   % Chg
A AAPL    —       —      —
N NVDA    —       —      —
…                                   9 stocks
```

| research claim | current master | verdict |
|---|---|---|
| `UCT-WATCH-0002` / `CMP-011` — "the phone watchlist does not render Price/Vol/%Chg although the API returns them" | The columns **are rendered**: `Symbol · Price · Vol · % Chg` | ⛔ **DISPROVEN as stated** |
| `UCT-WATCH-0003` / `CMP-012` — "the phone watchlist overflows horizontally" | `body.scrollWidth === body.clientWidth` (388/388); the one table is 386/386; **zero overflowing containers** | ⛔ **DOES NOT REPRODUCE** |

**Why the values read `—`, and why that is *not* the research's claim:** `/api/live-prices`
returns **503 "Pricing service unavailable"** in the sandbox and `/api/watchlist-performance`
returns all-null. The dashes are an **absent vendor feed**, not a phone that drops data the API
returned.

### ⚠️ What is still open, stated honestly
I could not prove the columns **populate**, because this sandbox has no pricing vendor. I
deliberately did **not** exercise the production phone watchlist to close it: the charts
workspace autosaves, so navigating the owner's live workspace risks mutating their saved layout —
outside this task's authority. **To close MOB-02:** run the same 390px reproduction against a
sandbox configured with a vendor key, or observe it on the owner's own device.

**Backlog effect:** MOB-02 drops out of Wave 0 as written. Its surviving residue is the narrow
question "do the columns populate on a phone with a live feed", which is a **verification** item,
not a build item.

---

## Two false reads caught by measuring boxes instead of trusting the DOM

Both would have become findings if the node's presence had been taken at face value.

1. **Bar replay looked reachable on the phone** — `aria-label="Replay / Time Machine"` is in the
   phone shell's DOM. Measured: `display: none`, 0×0. **`CMP-079`'s `DESKTOP_ONLY` stands.**
2. **The legend-mode control looked like a visible phone affordance** — `aria-label="OHLCV
   legend: Always on"` is present and `display:flex`, but measures **0×0**: it lives inside the
   collapsed drawing toolbar. Reachable, not visible. (It does not change the P0 verdict, which
   rests on the resolution rule and the production state, not on this control.)

⭐ **And a third, in the other direction:** the A/L/% scale toggles **do** render in this
fine-pointer frame (measured, 3 buttons) while `StockChart.module.css:778-797` hides them at
`(pointer: coarse)`. The frame reports `matchMedia('(pointer: coarse)').matches === false`, which
is precisely the branch blindness that produced five false negatives in the research. **Any
negative claim taken from this harness needs a coarse-pointer confirmation before it ships.**

---

## Wave 0 status after the gate

| item | status |
|---|---|
| **MOB-03** legend/member-state | ✅ **closed — P0_NOT_REPRODUCED**, rail shipped `e433e98f6` |
| **MOB-02** watchlist row | ⛔ **layout claims disproven**; residue is a verification item needing a live feed |
| **MOB-01** phone Layouts door | ▶️ **next** — unaffected by the above, and independently confirmed: the phone Tools sheet has no layout row, while `applyTemplate` / `handleSaveLayout` / `handleSaveAsTemplate` / `deleteLayout` all already exist in `ChartsWorkspace.jsx` and are reusable as props |

**MOB-01 remains the largest validated gap and is now the whole of Wave 0.**

---

## MOB-01 · Phone layout door — **SHIPPED AND DEVICE-VERIFIED** (`7b0877781`)

**Reconciled first:** MOB-01 survives `90-independent-validation.md` and `95-census-errata.md`
untouched — neither mentions `CMP-069`/`CMP-070` or the layout surface. Not tombstoned, not
narrowed.

### What the defect actually was
Not a missing feature and not a bug in a component: **two `const` declarations on the wrong
side of a `return`.** `wsGlobalLayouts` / `wsMyLayouts` were computed two lines *below*
`ChartsWorkspace.jsx`'s `if (isMobile) { … return }`, so the phone branch could not reference
them. Everything else — the API, the table, the prebuilts, the five handlers — already existed.

### Reuse vs new code
| reused, untouched | new |
|---|---|
| `applyTemplate` · `applyUctDefault` · `handleSaveLayout` · `handleSaveAsTemplate` · `handleDeleteTemplate` · `useChartLayouts` · `GET/POST/DELETE /api/charts/layouts` · the `charts_layouts` table · `charts_active_template` | `MobileLayoutsSheet.jsx` (presentation only) · a `Layouts` row in `MobileMoreSheet` · CSS · **one optional `(nameArg, scopeArg)` on `handleSaveAsTemplate`** so the phone's own input reuses the desktop's save path instead of forking it |

**No second persistence layer.** A test asserts the sheet's *code* contains no
`/api/charts/layouts`, no `useChartLayouts`, no `usePreferences`, no `fetch(`, no
`localStorage` — comments stripped first, because the first draft of that probe matched the
component's own doc comment and failed a correct file.

### The scope model, read from code — and one correction to the research
| scope | what |
|---|---|
| `USER_OWNED` | `scope:'user'` rows — delete allowed |
| `FIRM_PUBLISHED / READ_ONLY` | `scope:'global'` — admin-only write/delete server-side, so a member sees a **"Firm"** badge and **no delete control** rather than one that 403s |
| `PER_WORKSPACE` | arrangement + per-widget `opts` + chart/widget settings + watchlist columns (captured into the template) |
| **NOT in a layout** | **the colour-group tickers.** `handleSaveAsTemplate` sends `groups: null` and `applyTemplate` deliberately leaves them alone — *"a template must not swap the stock you're looking at."* |
| `PER_DEVICE` | watchlist columns (localStorage) and the pan/zoom view lock — unchanged by this work |

⛔ **ERRATUM to the research package.** `CMP-068` / `UCT-P9-0003` / `85-*`'s MOB-01 acceptance
criterion (1) all state that a saved layout "carries the symbols". **It does not.** That was read
off the API schema (`LayoutIn.groups: Optional[dict]`) rather than off the caller, which passes
`null` by design. The sheet's copy says *arrangement*, and a test pins that it never promises
symbols. ⚠️ Same defect class as the rest of this study: **schema existence ≠ behaviour.**

### Real-device verification — iPhone 15 / iOS 17.5, portrait, `REAL_COARSE_POINTER_VERIFIED`
Physical device via BrowserStack App Live → mobile Safari → BrowserStack Local → the local
sandbox on `bs-local.com:8092`. Observed on the touchscreen:

- **Tools sheet:** `Set price alert… · Draw on chart · Flag SPY · Share chart image ·
  Chart settings · **Layouts — Phone board** ·` YOUR WIDGETS…
  The active layout's name rides the row, and it was the layout saved earlier from a *different*
  session — cross-session persistence proven on hardware.
- **Layouts sheet:** `CURRENT — PHONE BOARD` · `Save — updates this layout` · `Save as… ›` ·
  PREBUILT `UCT Default [FIRM]` · MY LAYOUTS `✓ Phone board 🗑`
- **Save-as sub-sheet:** auto-focused `Layout name` field, `Just me / Firm-wide` scope choice
  (admin), **`Save layout` disabled while the name is empty**, and the note stating that opening
  a layout never swaps the symbol.
- No horizontal overflow; bottom-sheet presentation and safe-area correct.

⭐ **Two research findings independently re-confirmed on the same screen:** the A/L/% scale
toggles and the `$-Vol` strip are **absent** on the real phone — the `(pointer: coarse)`
`display:none` rule the adversarial review found, seen working.

### Acceptance criteria
1–9 ✅ (behavioural tests + device) · 10, 12 ✅ (full reload → row reads "Layouts · Phone board",
header `CURRENT — PHONE BOARD`, `aria-current=true`) · 11 ✅ (desktop at 1400×900 lists
"Phone board" in Open Layout) · 13 ✅ (source probe) · 14 ✅ (34/34 existing ChartsWorkspace
desktop tests, 547 chart tests total).

**MEASURE-02 (landscape) is untouched and remains the pre-ship gate for orientation work.**

---

## Wave 0 — **COMPLETE**

| item | outcome |
|---|---|
| MOB-03 legend/member-state | **P0_NOT_REPRODUCED** — rail shipped `e433e98f6` |
| MOB-02 watchlist row | **layout claims disproven**; residue is a pre-ship verification item needing a live feed |
| MOB-01 phone layout door | **SHIPPED + device-verified** `7b0877781` |

**Next: Wave 1** — MOB-06 (the phone-presentation rule), MOB-07 (`_COARSE_POINTER` → hook),
MEASURE-01, MEASURE-02.

---

## MOB-07 · The coarse-pointer primitive — **SHIPPED** (`bcff456a8`)

**Semantic contract:** *"Is the primary pointer driving CHART INTERACTION a coarse one?"*
Not a device detector, not a viewport tier, not "does touch hardware exist".

⛔ **The backlog's proposed fix was incomplete, and this is worth recording.** MOB-07 said
"replace the constant with `useHasCoarsePointer()`". That cannot work: `HIT_THRESHOLD` is read
by **~20 module-scope pure hit-test functions**, and a React hook cannot be called from those.
`coarsePointer.js` therefore publishes one fact through two doors that read the same store —
`isCoarsePointer()` for pure functions, `useCoarsePointer()` (`useSyncExternalStore`) for
component branches.

**Deliberately NOT migrated** (documented in-file so the boundary survives): the 26 CSS
`@media (pointer: coarse)` rules (presentation stays in CSS); `useIsPhone`/`useIsTouch`
(viewport tiers); and the `'ontouchstart' in window || maxTouchPoints > 0` checks in
`useMobileSWR` / `livePriceStore` / `PullToRefresh`, which ask whether touch **hardware exists**
as a proxy for a constrained client — a hybrid laptop answers yes and must still get
fine-pointer grab radii.

---

## MEASURE-01 · The four blocked drawing checks — **ALL FOUR NOW MEASURED**

⚠️ **TIER, STATED FIRST AND WITHOUT LAUNDERING: `EMULATED_COARSE_POINTER_VERIFIED`, not
`REAL_COARSE_POINTER_VERIFIED`.** These were measured in a 390×844 same-origin iframe with
`matchMedia('(pointer: coarse)')` patched to true — which **only became possible because MOB-07
made the branch live instead of frozen at import**. The coarse branch was demonstrably taken
(the coarse-only quick bar rendered). A physical finger was not the instrument.

| # | check | result | evidence |
|---|---|---|---|
| 1 | `HIT_THRESHOLD` 15px | ✅ **PASS** | Clean chart, exactly ONE horizontal line at y=409. Tap 12px away → **selects**; tap 25px away → **does not**. Brackets the radius in (12, 25], excluding the 8px fine value. |
| 2 | `HANDLE_R` 7px + halo | ✅ **PASS** | Canvas pixel profile from the handle centre: solid `rgba(201,168,76,255)` to 6px, edge at 7px → **dot radius 7**; faint `alpha 41/255 = 0.16` from 9–17px, nothing at 18px → **halo radius 17 = HIT_THRESHOLD + 2**, independently confirming 15. |
| 3 | auto-select-after-placement | ✅ **PASS** | The quick bar renders only for `selectedId`, and it appeared immediately after a placement with no separate selection tap — reproduced twice, including on a clean chart. **So tap-to-place is a DRAFT, not a commit** — the question `CMP-042` was blocked on. |
| 4 | `DrawingQuickBar` | ✅ **PASS** | Present, with exactly `Style · Duplicate · Lock · Delete`. |

### ⛔ The research's stated blocker is DISPROVEN
`UCT-COARSE-0005` recorded that synthetic taps "reach every DOM control but not the overlay's
placement path". **They reach it.** In the phone shell a synthetic pointer placed a drawing with
`pointerType: 'mouse'` (0 → 1) *and* with `pointerType: 'touch'` (1 → 2). The overlay's
placement path accepts both. The earlier conclusion was wrong about the mechanism — as the
corrected `UCT-COARSE-0005` already warned it might be, having ruled out its own first theory.

### What remains unresolved, honestly
On the **physical iPhone 15 / iOS 17.5**, one attempt to place a horizontal line with the tool
armed produced no visible line, while BrowserStack's console recorded a genuine
`Touch down → Move → Touch up` at 60ms with no movement. Given that the same placement path
demonstrably works under emulation with touch-type pointers, the most likely explanation is my
remote-control coordinate mapping rather than a product defect — **but the cause was not
isolated, and one attempt is not a finding.** Per instruction, no implementation work is created
from it.

**MEASURE-01 status: the four checks are CLOSED at `EMULATED_COARSE_POINTER_VERIFIED`.** Real-
device placement remains a measurement debt, not a blocker, and is cheap to retry whenever a
device session is already open.

### A methodological note worth keeping
My first attempt at check 1 used a **negative control that could not fail honestly**: three
lines were on the canvas, so a "25px away" tap could hit a different line — and did. The clean
re-run (one line, cleared local store *and* the synced `tracings_doc`) is what makes the bracket
mean anything. Same defect class as the rest of this program: *a probe that cannot distinguish
is not a probe.*
