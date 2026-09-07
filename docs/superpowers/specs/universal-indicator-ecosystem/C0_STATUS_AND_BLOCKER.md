# C0 — WAVE B COMPLETION / END-TO-END VISUAL PATH CLOSURE

**Result: C0 FAILS ITS EXIT GATE, on one condition — "the renderer/harness can produce
reliable repeated evidence". Per the authorization, this is returned as a blocker rather
than worked around.** No render, persistence or performance result is claimed or inferred.

Everything that does not depend on the browser was completed and is reported below.

---

## C0.4 — THE RENDERER HANG: ROOT-CAUSED

**Classification: HARNESS / ENVIRONMENT DEFECT. Not a product render defect.**

The mechanism is proven, not inferred, by four measurements on the live page:

| Probe | Result | What it shows |
|---|---|---|
| Synchronous `Runtime.evaluate` (no `await`) | returns in **0 ms** | The renderer is *not* frozen. |
| The same call with one `await setTimeout(1000)` | **timed out at 45 s** (CDP budget) | Only timer-driven continuations stall. |
| `document.visibilityState` / `hasFocus()` | **`"hidden"` / `false`** — even as the ONLY tab in the group | The Chrome *window* does not hold OS focus. |
| `setTimeout(1000)` actually measured | **3438 ms** | Background throttling, ~3.4× clamp. |
| `document.querySelectorAll('canvas').length` | **0**, with `buttons: 1` | The workspace never mounted; the one button is the intro's SKIP. |

### Why a hidden tab stops this page specifically

`/charts` is not an ordinary page. `ChartsWorkspace` computes its grid `rowHeight` from a
**`ResizeObserver`**, and the charts paint through **rAF**. Chrome suspends rAF and
ResizeObserver delivery in a hidden tab and clamps timers — so the workspace mounts *zero*
widgets, and any long `await` chain inside one `Runtime.evaluate` blows the 45 s CDP budget.
The repo already knows this shape: `lesson_hidden_chrome_tab_defers_paint_and_throttles_timers`.

A second, independent factor: the **cinematic intro overlay** runs on every page load and
covers the workspace until skipped. `tools/mobile_audit.py` dismisses it deliberately; any
new harness must too.

### Why this could not be worked around from here

The Chrome instance is **shared with other Claude sessions on this machine**. Tab selection
was observed being taken away repeatedly (a sibling agent reported the same independently:
*"Other tabs were active in my browser tab group throughout … They repeatedly stole Chrome's
foreground"*). Creating a fresh tab, closing the competing tab, and re-creating the group each
returned the tab to `hidden` within one action, and `javascript_tool` then began failing with
`Couldn't determine which page this action targets`.

**Earlier in this same session the product rendered correctly** — SPY chart, the builder, and
the live overlay/pane + levels carriage were all verified — precisely when the window happened
to hold focus. So the product is not implicated by any evidence here.

### The narrow harness fix (recommended, not yet applied)

1. Drive `/charts` only in a **foregrounded** Chrome window, not shared with another session.
2. **Dismiss the intro overlay** before any measurement.
3. Keep each `Runtime.evaluate` **short** — no multi-second `await` chains inside one call;
   poll from the outside instead.
4. Wait on **identity, not readiness** — waiting for the Apply button to be *enabled* clicked
   it while the previous script's report was still live, and script A silently applied script
   B's presentation. Wait for the report to name the script under test. (This one is already
   fixed in the working harness.)
5. Prefer `tools/chart_parity.py`'s existing headless, hermetic path over a live browser where
   a pixel answer will do — it was built for exactly this and does not depend on foreground.

---

## WHAT WAS COMPLETED

### C0.1 — Multi-output handoff · IMPLEMENTED (not yet live-verified)

**Architecture.** The document model already supported this and nothing ever fed it:
`buildDefinition` has always written `compute.trees` / `treesHash` / `scanPlot` / `sources`
plus an N-row `plots[]`. The gap was the two doors in front of it.

```
translatePine  →  outputs[]  (each with formula, ast, title, presentation)
PineBox.use()  →  { source, inputs, paramManifest, presentation, outputs[] }   ← NEW: outputs[]
BuilderSheet   →  plot0 (= outputs[0])  +  plotRows (= outputs[1..n])
buildDefinition→  compute.trees / treesHash / scanPlot / sources  +  plots[]
binder         →  one series per plot, one document, one indicator identity
```

Decisions worth stating:

- **One indicator identity, many outputs** — never several saved indicators.
- **Row zero is the member's chosen column** and stays the scan plot, so the screen this
  import can produce is unchanged and every existing caller reads the same `source` field.
- **A screen condition stays single-output.** `conditionFrom` wraps ONE column into a
  comparison; carrying siblings would silently add trees to a document the member asked to be
  a screen.
- **Keys are derived from the author's own titles** where that yields a legal key
  (`[a-z][A-Za-z0-9_]*`, unique, not the levels guide), numbered otherwise.
- **A stated ceiling of 12 carried outputs, disclosed not silent** — a few OOS scripts declare
  18+ columns and each row is a live `FormulaField`. When it bites, the member is told in
  `pickerNote`. "No silent omission" is the acceptance condition.
- `others` is derived from `report`, **not** from the `usable` memo declared below the
  callback and absent from its dependency array — that would have been a stale closure
  surfacing as "the second plot is missing, sometimes".

### C0.2 — Multi-plot fixtures · CREATED + TRANSLATE-VERIFIED (live render NOT verified)

Permanent first-party fixtures at `tests/fixtures/pine_multiplot/`:
two plots (pane) · three plots with three different styles · plots + two `hline`s ·
overlay band set · independently titled series.

`pineMultiOutput.test.jsx` (8 cases) pins: every fixture translates; **each offers more than
one usable column**; titles survive independently; styling is **per output** (`line/stepline/
histogram`, widths `2/3/1`, three distinct vendor hex colours); overlay differs per fixture;
levels ride *alongside* plots rather than replacing one; and **ordering is the script's order**.

### C0.7 — Presentation-retention audit · COMPLETE

For the 18 accepted OOS scripts, source-declared presentation vs what the pipeline carries:

**VISUALLY PARTIAL: 16/18. VISUALLY COMPLETE: 2/18** (`14-heikin-ashi-candle-overlay`,
`long_tail__13-volatility-of-returns`).

A script counts as PARTIAL if any of: object calls present · `fill`/`bgcolor`/`barcolor`
demanded · any output reporting `colorDynamic` or `styleUncarried` · more usable columns than
the carriage ceiling. Calculation succeeding does not upgrade it — which is the rule the
authorization asked for.

---

## WHAT IS NOT DONE, AND IS NOT ESTIMATED

| Item | State |
|---|---|
| C0.2 live multi-plot render | **NOT VERIFIED** |
| C0.3 CHART_RENDERABLE / PARTIAL / BLOCKED / ERROR counts | **NOT MEASURED** |
| C0.5 save → close → reopen | **NOT VERIFIED** |
| C0.6 parameter-driven visual change | **NOT VERIFIED** |
| C0.8 Complex Visual Parity Set re-run | **NOT DONE** |
| C0.9 performance baseline | **NOT MEASURED** |

All six depend on the same blocked capability.

---

## C0 EXIT GATE

| Condition | Met? |
|---|---|
| multi-output survives import/save/render | ❌ implemented; render unverified |
| CHART_RENDERABLE measured, not assumed | ❌ |
| save/reopen verified | ❌ |
| parameter-driven visual change verified | ❌ |
| renderer/harness produces reliable repeated evidence | ❌ **the blocker** |
| no known silent visual omission presented as FULL support | ✅ 16/18 classified VISUALLY PARTIAL; carriage ceiling discloses |
| performance baseline exists | ❌ |

**C0 FAILS. Stopping here rather than proceeding to C1**, per the authorization's own
instruction. C1 would add dynamic colour and fills — both of which are *defined* by their
bar-by-bar appearance and therefore cannot be honestly accepted without exactly the live
evidence that is blocked.

## What unblocks it

Any one of these is sufficient:

1. **A dedicated foreground Chrome window** for this session (not shared with other agents),
   with the intro overlay dismissed — the harness rules above then apply directly.
2. **Route the visual checks through `tools/chart_parity.py`** instead of a live browser: it
   is already headless, hermetic and deterministic, drives `/r/chart` with frozen bars, and
   ships its own `--same-build` determinism self-check and a `--perturb-b` non-vacuity
   control. It was built for precisely this problem and does not need foreground.
3. Owner runs the journey manually once and reports what renders — the least preferable, since
   the authorization is explicit that Claude should not hand technical validation back.

**Recommendation: option 2.** It removes the foreground dependency permanently, which
otherwise blocks C1, C2 and every future visual wave the same way.
