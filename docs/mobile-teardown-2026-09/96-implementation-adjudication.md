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
