# Public Script Compatibility Harness — Recovery + Taxonomy Synthesis

Executes the second, expanded "HMA + MACD BATCH REVIEW — ACCEPTED" authorization's
recovery and synthesis requirements over Checkpoint 02's already-completed real-import
findings (RISK-037), **without re-running any live-browser script import** — per the
explicit "do not restart completed work" instruction. This document (a) completes the
"recover current harness state first" step, (b) completes the "verify rather than
assume" TradingView-safety check, and (c) re-expresses Checkpoint 02's 8-script
findings under the expanded failure taxonomy with an explicit ENGINE/SCHEMA-vs-
BUILDER/IMPORT classification per finding, per the new Section 8 requirement. **No new
product code was touched. No new browser script-import testing was performed. Stop
condition unchanged: no remediation, no Stoch, no ADX-family after this report.**

---

## 0. Harness-state recovery (completed this pass)

**Git/doc recovery**, confirmed by direct reading, not assumed:
- Commit chain: Lane 2's 6-level visual-fixture ladder (`fdf4c979b`..`b995addc0`, plus
  the `4c492373a` aggregate-report commit) → Checkpoint 01 closeout (`60c2786e2`,
  RISK-030) → Vendor Parity Tranche 2 Lane A batches (RISK-031..036, culminating in
  HMA/MACD `61f41a6f7`) → Checkpoint 02, this program's real-import session
  (`2ebe9f547`, RISK-037). **Nothing in this chain is restarted here.**
- `tests/fixtures/compat_harness/results/visual_fixture/level{1..6}_*.json` all present
  on disk, confirmed via `ls`.

**Lane 2's actual evidentiary status, stated precisely (not overstated).** Lane 2 is
complete at the schema/Node-mutation-test level — it is **not** complete with live
pixel evidence, and this document does not claim otherwise. Directly quoting
`level4_bands_fill_multi_guides.json`:
- `chart_render.status: "ENVIRONMENT_BLOCKED"`, `reason: "RISK-027 still blocks a live
  pixel re-run in this session"`.
- `persistence_save.status` / `persistence_reload.status`: both `"PARTIAL"`, `note:
  "not exercised live"`.
- Its own `discovery` array states outright: *"plots[].fill:{with} is schema-valid on
  a user document ... whether it draws requires a live render, not answered here."*

So Lane 2's bands/fill/colorMode findings are real, but they are schema-validation +
mutation-control evidence, never a rendered pixel and never a real save/reload cycle.
This is the correct, precise framing carried through the rest of this document.

**RISK-027 (FontNotSettledError), preserved verbatim, not re-investigated.** A
reproducible, twice-confirmed `chart_parity.py` harness defect (31-of-239
canvas-text-before-font-ready count against a bare `vite` dev server). The obvious
"font route unserved" hypothesis was tested and **disproven** (`curl` returned `200
OK` on the exact font URL). Root cause **undiagnosed**; severity **unknown** — filed as
`HARNESS_DEFECT`, explicitly not a confirmed product regression. This is the reason
Lane 2's Level 4-6 fixtures never got live rendering. Nothing new investigated here.

**RISK-029 ("engine can, builder cannot"), preserved verbatim, not re-investigated as
a mandate.** Bands, `fill:{with}`, `colorMode:'sign'`/`'column:<key>'`, and composite
arithmetic all install cleanly on a raw user document at the schema/validation layer;
`BuilderSheet.jsx`'s own authoring UI has no control to produce bands/fill/colorMode.
**Owner instruction on record, quoted verbatim in the register: "Do not act on this
without a separate, explicit product decision."** This document extends the
classification (§12/§14 below) but does not propose or perform any UI work.

**TradingView safety — actually verified this pass, not assumed.**
1. `tabs_context_mcp` confirmed one tab, unchanged URL/title
   (`tradingview.com/chart/jHASRSzx/`, "ANF 149.67 ▲ +4.27% white").
2. A zoomed screenshot of the Object tree panel positively confirmed the exact 5-item
   baseline: `ANF · NYSE, 1D` → **Uncharted Clouds** (EMA/Close, 9/20) → **ATR Ext**
   (14, 50, 7, 10) shown **greyed/hidden** (the eye-slash icon) → **Uncharted
   Scanners** → **UT Vol** → **uct-oracle-ambiguity-v3**. Matches baseline exactly.
3. **A real discrepancy was found and fixed, not merely assumed away.** The prior
   session's "TradingView restored to baseline" claim was incomplete: the Pine Editor
   panel still held an **unsaved "Untitled script"** containing the
   `uct-hma-macd-parity-v1` test source (the HMA/MACD vendor-capture script) — never
   cleared after that batch. This was never part of the 5-item object tree/chart state
   and was never saved (confirmed via the compile log's own timestamped history, which
   shows only compile/add-to-chart events, never a Save), so it carried no persistence
   risk — but it was real leftover state, and "verify rather than assume" means it
   should not have been left unclosed. **Fixed this pass**: closed the Pine Editor
   panel without saving (dismissing a "Publish script" dialog triggered by an
   initial mis-click along the way, without publishing anything). Confirmed via a
   post-close screenshot: the chart now renders full-width, object tree unchanged,
   no Pine Editor panel remaining.
4. A supplementary check of the "Indicators → My scripts" library did not reach a
   conclusive read: the panel rendered a persistent loading-skeleton state in two
   separate attempts, and a full DOM text extraction showed no script-name rows at
   all (only the `SCRIPT NAME` column header). This is recorded as an inconclusive,
   minor tooling observation — not pursued further, per the standing "avoid
   rabbit holes" discipline, since (a) it does not contradict anything found in steps
   1-2 above, and (b) nothing in this program's evidence suggests anything was ever
   saved into that library this session or the prior one (Checkpoint 02's own
   environment was fully isolated from TradingView; the HMA/MACD batch's own captured
   script was, per its own closeout, never intended to be saved to "My scripts").

---

## 1-21. The requested return format

### 1. Exact scripts tested and why

Unchanged from Checkpoint 02 (no new scripts tested this pass, per "do not restart
completed work"). All 8 from the provenanced `tests/fixtures/pine_community/` corpus:

| # | Script | Category | Why selected |
|---|---|---|---|
| 1 | `05-chandelier-exit.pine` | trend/ratchet system | Layer A SUPPORTED, never Layer C tested; heavy stateful ratchet |
| 2 | `06-qqe-mod.pine` | oscillator | Fully untested; tuple-returning function invoked twice — recurrence + composition stress |
| 3 | `03-cm-williams-vix-fix.pine` | volatility/band | Completes the one missing real-import step for an already-evidenced script |
| 4 | `22-daily-weekly-monthly-highs-lows.pine` | multi-plot/MTF | `request.security` tuple destructuring + array/line-object usage |
| 5 | `29-zigzag-plus-plus.pine` | custom state logic | Confirms the real product UI's own refusal text |
| 6 | `27-support-resistance-channels.pine` | visual-heavy | Completes the real-import step for the deepest array/control-flow case |
| 7 | `18-minervini-trend-template.pine` | input-heavy | Never Layer C tested; many inputs + a `table.new` panel |
| 8 | `17-pocket-pivot-breakout.pine` | composite | Generic-array syntax + nested loops + alertconditions |

### 2. Raw import result for every script, re-expressed under the expanded taxonomy

The new taxonomy's top-level buckets are `DATA_BLOCKED` / `EXECUTION_BLOCKED` /
`VISUAL_BLOCKED` / `VENDOR_AMBIGUOUS` / `HARNESS_DEFECT`, with `BUILDER_EXPOSURE_GAP`
as a detailed cause. **A clean, non-vacuous negative worth stating up front: none of
this session's 8 scripts produced a `DATA_BLOCKED`, `VISUAL_BLOCKED`,
`VENDOR_AMBIGUOUS`, or `HARNESS_DEFECT` result. Every failure clusters in
`EXECUTION_BLOCKED` — the translator/engine layer, not the vendor-ambiguity, data, or
visual layer.**

| # | Script | Top-level bucket | Detailed cause | Correct refusal? |
|---|---|---|---|---|
| 1 | Chandelier Exit | — (fully resolves) | n/a | n/a |
| 2 | QQE MOD | `EXECUTION_BLOCKED` (3 of 6 real outputs) | `accum()`-expressiveness-limit (dual-variable ratchet) | Yes — upstream, before offer |
| 3 | CM Williams Vix Fix | `EXECUTION_BLOCKED` (1 of 4 columns) | `translator_semantic_gap` (boolean-input-in-conditional) | Yes — per-column readback error |
| 4 | Daily/Weekly/Monthly H/L | `EXECUTION_BLOCKED` (total) | array/matrix/map architecturally absent | Yes — clean, total refusal |
| 5 | ZigZag++ | `EXECUTION_BLOCKED` (total) | external-library-import architecturally absent | Yes — clean, total refusal |
| 6 | Support Resistance Channels | `EXECUTION_BLOCKED` (2 of 2 columns) | `translator_semantic_gap` (boolean-input-in-conditional) | Yes — per-column readback error |
| 7 | Minervini Trend Template | `EXECUTION_BLOCKED` (2 of 2 columns) | `translator_semantic_gap` (boolean-input-in-conditional) | Yes — per-column readback error |
| 8 | Pocket Pivot Breakout | `EXECUTION_BLOCKED` (≥1 of 3 columns) | `translator_semantic_gap` (boolean-input-in-conditional) | Yes — per-column readback error |

### 3. Assisted result, separately

Not applicable — no failure this session invoked the assisted-edit/recovery workflow
(RISK-004, out of scope); every failure was either a clean total refusal or a
per-column inline readback error. Unchanged from Checkpoint 02.

### 4. Deepest workflow stage reached by each

Unchanged from Checkpoint 02 §5: 3 of 8 (Chandelier, QQE, VIX Fix) reached the full
chain through save → real chart render → backend-confirmed persistence. 2 of 8
(Daily/Weekly/Monthly H/L, ZigZag++) reached a clean, correctly-attributed total
refusal at translate. 3 of 8 (SRchannel, Minervini, Pocket Pivot) reached "columns
offered" but zero of their own offered columns resolve.

### 5. Compatibility status for each

Chandelier Exit — **FULLY SUPPORTED** (9/9). QQE MOD — **PARTIALLY SUPPORTED** (3/6
real outputs; 3 blocked upstream). CM Williams Vix Fix — **PARTIALLY SUPPORTED**
(3/4). Daily/Weekly/Monthly H/L — **CORRECTLY REFUSED**. ZigZag++ — **CORRECTLY
REFUSED**. Support Resistance Channels — **UNSUPPORTED** (0/2 usable). Minervini
Trend Template — **UNSUPPORTED** (0/2 usable). Pocket Pivot Breakout — **PARTIALLY
SUPPORTED** (≤1/3).

### 6. Failure-taxonomy counts

| Bucket | Detailed cause | Script-level count | Column-level count | Silent-wrong? |
|---|---|---|---|---|
| `EXECUTION_BLOCKED` | `translator_semantic_gap` (boolean-input-in-conditional) | 4 scripts (VIX Fix, SRchannel, Minervini, Pocket Pivot) | 5 columns (1+2+2+≥1) | No — loud, specific, per-column error every time |
| `EXECUTION_BLOCKED` | `accum()`-expressiveness-limit | 1 script (QQE MOD) | 3 outputs silently absent from the *offered* set (not a per-column error — see §7) | No new silent-wrong found; the 3 outputs never reach the offer stage at all |
| `EXECUTION_BLOCKED` | array/matrix/map unsupported | 1 script (Daily/Weekly/Monthly H/L) | total | No — clean total refusal |
| `EXECUTION_BLOCKED` | external-library-import unsupported | 1 script (ZigZag++) | total | No — clean total refusal |
| `DATA_BLOCKED` / `VISUAL_BLOCKED` / `VENDOR_AMBIGUOUS` / `HARNESS_DEFECT` | — | 0 | 0 | n/a |

### 7. Every SILENT_WRONG_RESULT finding

**None confirmed as currently observable by a real user in today's product.** Unchanged
from Checkpoint 02 §7. Two adjacent, lower-severity items disclosed rather than
promoted:
- **Silent no-op on Save** for a column whose readback still carries an unresolved
  error — no toast, no persisted row, no visible confirmation either way (confirmed:
  no new row via `GET /api/user-definitions`). A UX gap (missing negative feedback),
  not a wrong-value defect.
- A prospective, **not currently live** risk: a `0/0`-shaped placeholder readback
  happens to coincidentally match a script's own `false`-default branch today (both
  read as `na`) — this is not a live SILENT_WRONG_RESULT because inputs are fixed at
  their literal defaults today; it would become one only if boolean-input
  adjustability is ever added without first fixing the boolean-input-in-conditional
  gap. Flagged prospectively, not claimed as live.

### 8. Visual-fidelity findings, cross-referenced against Lane 2's real evidentiary limit

Checkpoint 02's own visual findings (placement inference correctness, `display.none`
plot exclusion, live-rendered pixel confirmation for 3 real scripts + STRESS01) are
unchanged — see the original §8. **The cross-reference this synthesis adds**: none of
those 4 live-rendered fixtures (Chandelier, VIX Fix, QQE, STRESS01) exercised
bands, `fill`, or `colorMode` — because BuilderSheet's own Formula tab has no
authoring control for any of them (RISK-029). Lane 2's own Level 4 fixture is the
*only* place in this program's history bands/fill were even attempted, and per §0
above, that attempt never reached a live render (`RISK-027`-blocked). **Net position:
this program has zero live-rendered pixel evidence, from any source, of whether a
band or a fill actually draws on a real chart** — only schema-validation evidence
that the document is accepted, plus the pre-existing, separately-confirmed
VALIDATED-BUT-INERT finding for `fill` specifically (accepted, not drawn, at the time
that finding was made). This gap is not closed by this synthesis pass, consistent
with "do not restart completed work" — no new live-browser bands/fill test was run.

### 9. Input/parameter findings

Unchanged from Checkpoint 02 §9: CM Williams Vix Fix's `pd` parameter carried over as
a genuine adjustable input (a positive finding, contradicting the earlier blanket
"never carries over" assumption from RISK-013/Golden Journey #1). The Formula tab's
"+ Add an input" binding convention remains an open, unresolved usage gap — naive
name-substitution in a numeric-argument position fails with a technical, non-
actionable refusal; the real binding convention was not discovered.

### 10. Save/reopen findings

Unchanged from Checkpoint 02 §10: full round-trip confirmed via direct backend reads
for Chandelier, QQE, VIX Fix, and STRESS01 (including a genuine edit cycle — same
`def_id`, `version` 1→2). A full page reload re-rendered all four correctly from
live-recomputed values. A duplicate-persistence variant of RISK-012 was reproduced
(two Save clicks on Chandelier → two separate `def_id`s).

### 11. Screener findings

Unchanged from Checkpoint 02 §11: all 4 cleanly-saved numeric outputs correctly show
`scannable: false`; a freshly-authored boolean formula (`close > sma(close, 20)`)
correctly shows `scannable: true` — the numeric-vs-boolean gate re-confirmed on an
authored (not imported) formula.

### 12. ENGINE/SCHEMA gap vs BUILDER/IMPORT exposure gap — classified per finding

Per the new Section 8 requirement, every finding below is classified **A** (engine/
schema architecturally cannot represent the behavior) or **B** (engine/schema CAN
represent it; the import/builder/UI does not currently produce or expose it). Several
findings do not cleanly fit the A/B axis at all — those are marked **N/A (orthogonal)**
and explained.

| Finding | Classification | Basis |
|---|---|---|
| Boolean-input-in-conditional (4 scripts) | **A** | The readback itself cannot bind the input's own declared name inside a conditional — this is a translation/grammar failure, not a missing UI control. Even direct Formula-tab authoring of the equivalent construct was not shown to work; this was not isolated as builder-only. |
| QQE MOD's `accum()` dual-variable ratchet | **A** | `accum()` is architecturally single-variable; the engine has no primitive for a recurrence keyed on two mutually-referencing running values. |
| array/matrix/map (Daily/Weekly/Monthly H/L) | **A** | Confirmed, clean, non-confounded: the primitive does not exist in the engine's expression grammar. |
| External library import (ZigZag++) | **A** | Architectural: the engine has no mechanism to pull in another script's code. |
| **Bands** (`style:'band'`, `edges`) | **B** | Installs cleanly on a real user document (RISK-029, confirmed by construction). BuilderSheet's authoring UI has no control to produce one. |
| **`fill:{with}`** | **B for authoring; a separate rendering question remains genuinely open** | Schema-valid and persists on a user document, but is the pre-existing, separately-confirmed VALIDATED-BUT-INERT finding — accepted, not drawn, at the time that finding was made, and never subsequently live-render-tested (§8/§0). |
| **`colorMode:'sign'`** | **B** | Installs on user documents and is the one *rendered* colorMode variant; no UI control exists to set it. |
| **`colorMode:'column:<key>'`** | **B for authoring; VALIDATED-BUT-INERT for rendering** | Same shape as `fill`. |
| **Composite arithmetic / nested function composition** | **CORRECTION — NOT a builder-exposure gap.** Already fully exposed. | Checkpoint 02's own STRESS01 fixture independently, directly demonstrates the real Formula tab CAN author nested composite expressions today (`ema(macd(close,12,26),9)` reused twice, an independent second plot, a zero-line guide) — built live through the actual UI, not the API. The user's framing bundled this with bands/fill/colorMode as one set of "already discovered latent capabilities" needing classification; this synthesis corrects that bundling. Composite arithmetic is engine-capable AND builder-exposed. |
| Formula-tab "+ Add an input" binding convention | **N/A (orthogonal)** | Not an exposure gap (the control to add an input exists and works) nor a proven engine limitation (whether the engine CAN bind a named input into an argument position by some other convention was not determined) — genuinely unresolved, flagged for future investigation rather than forced onto the A/B axis. |
| Silent no-op on Save | **N/A (orthogonal)** | A missing-feedback UX gap, unrelated to what the engine can represent. |

### 13. Result of the first-party complex visual stress fixture

Unchanged from Checkpoint 02 §12 (STRESS01, "MACD Composite Histogram+Signal" —
nested calc reuse, independent second plot, zero-line guide, own-pane placement,
auto-generated styling; 3 real plot entries confirmed via backend read; full
save→reopen→re-tune→reload cycle confirmed). **This synthesis adds one explicit
scoping note**: STRESS01 deliberately used only capabilities the real Formula tab
already exposes — it did **not** exercise bands, fill, or colorMode, since no such
control exists to exercise. Per §12 above, this makes STRESS01 direct, live evidence
for the "composite arithmetic already builder-exposed" correction — not evidence
either way on bands/fill/colorMode's live-render behavior.

### 14. Latent UCT capabilities discovered to already exist

Restating RISK-029's bundle with the corrected per-item classification from §12:
**bands** (engine: yes: builder: no), **`fill`** (engine: yes, schema-level only,
render status still genuinely unknown; builder: no), **`colorMode:'sign'`** (engine:
yes, rendered; builder: no), **`colorMode:'column:<key>'`** (engine: yes, schema-level
only; builder: no), **composite arithmetic / nested composition** (engine: yes;
builder: **yes — already fully exposed**, re-confirmed live this program via
STRESS01). Plus one additional latent capability discovered in Checkpoint 02 itself:
**Pine `input()` adjustability sometimes correctly carries over into a saved,
member-adjustable UCT parameter** (CM Williams Vix Fix's `pd`) — contradicting the
earlier blanket "never carries over" assumption.

### 15. Highest-value remediation opportunities, evidence-ranked (still NOT authorized)

Unchanged ranking from Checkpoint 02 §13 — this pass found no new evidence to
reorder it:

1. **Boolean-input-in-conditional** — reproduced across 4 of 8 real scripts, 5
   columns, zeroing BOTH of two entire scripts' only offered outputs.
2. **Layer-A/real-import fidelity gap** — a standing methodology risk (Minervini is
   Layer-A `SUPPORTED` yet has zero working real-import outputs).
3. **QQE MOD's `accum()` dual-variable ratchet** — a distinct, real engine limit,
   plausibly affecting other Wilder-style dual-band indicators.
4. **Silent no-op on Save** — low severity, easy fix, directly member-facing.
5. **Formula-tab "+ Add an input" binding convention** — opaque to both a member and
   to this program's own testing.

**Explicit answer to Section 8's own question** ("which existing latent capabilities
actually matter for real scripts"): **on the evidence gathered so far — 8 real,
diverse public scripts — none of them needed bands, fill, or colorMode.** Zero
real-script demand has been observed for any of RISK-029's builder-exposure-gap
items. The five items actually costing real scripts working outputs (above) all sit
in the engine/translator layer (classification **A** in §12), not the
builder-exposure layer (**B**). This is a load-bearing finding for any future
prioritization conversation: the bands/fill/colorMode exposure gap is real and
interesting, but this program has not yet found a real script that needs it.

### 16. Correct-refusal findings

Unchanged from Checkpoint 02 §14: array/matrix/map (first clean, non-confounded
confirmation of this boundary — Checkpoint 01's own sample could never isolate it),
external-library-import (matches Checkpoint 01's Layer A finding, additionally
confirms the real UI surfaces the same clear refusal text), and every one of the 5
boolean-input-pattern column failures (correct refusals at the per-column level, even
though the underlying limitation itself is worth remediating).

### 17. Harness/environment defects

**RISK-027 (FontNotSettledError)** — preserved verbatim per §0 above; still
undiagnosed, still classified `HARNESS_DEFECT`, not touched this pass. **One new,
minor, self-resolved item from this pass's own recovery step**: the TradingView Pine
Editor panel held an uncleared, unsaved leftover script from the prior batch (§0
item 3) — found and closed, not risen to a RISK_REGISTER entry since it carried no
persistence risk and was fully corrected within this pass. **One inconclusive, minor
tooling observation**: the "My scripts" library panel would not resolve past a
loading-skeleton state during this pass's verification attempt (§0 item 4) — not
pursued further, does not block or contradict any finding in this document.

### 18. Evidence artifacts

- This document.
- `PUBLIC_SCRIPT_LAYER_C_REAL_IMPORT_CHECKPOINT_02.md` (the underlying real-import
  evidence — per-script tables, exact error text, backend-read confirmations).
- `RISK_REGISTER.md` rows RISK-027, RISK-029, RISK-030, RISK-037 (read directly this
  pass, quoted verbatim above where cited).
- `tests/fixtures/compat_harness/results/visual_fixture/level4_bands_fill_multi_guides.json`
  (read in full this pass; quoted verbatim in §0).
- This pass's own TradingView verification: `tabs_context_mcp` result, a zoomed
  object-tree screenshot, a full DOM text extraction, and the Pine-Editor-close action
  sequence — all against chart `jHASRSzx`, 2026-09-06.

### 19. Test/non-vacuity results

No new tests were run this pass (no new code, no new browser script-import testing).
The non-vacuity standards this document relies on, restated for traceability: every
Checkpoint 02 save/reopen/re-tune/screener claim was confirmed via a direct
`GET /api/user-definitions` backend read, never visual inspection alone; the
boolean-input pattern's own non-vacuity is its 4-script/5-column/4-variable-name
independent reproduction count, not a single script's quirk; nothing in either
Checkpoint 02 or this synthesis accepts "page loaded" or "no exception" as
compatibility evidence anywhere.

### 20. Commit hashes

`fdf4c979b`..`b995addc0` (Lane 2 visual-fixture ladder, Levels 1-6) → `4c492373a`
(Lane 2 aggregate report) → `60c2786e2` (Checkpoint 01 closeout, RISK-030) →
Vendor Parity Tranche 2 Lane A batches (RISK-031..036) → `61f41a6f7` (HMA/MACD,
RISK-036) → `2ebe9f547` (Checkpoint 02, RISK-037). This document's own commit hash is
recorded in the commit that adds it.

### 21. Recommended next engineering tranche

**None recommended for immediate start — this document is recovery/synthesis only,
per explicit instruction.** If/when a remediation tranche is separately authorized,
§15's ranking is the starting point, with item 1 (boolean-input-in-conditional) first
given its reproduction count and blast radius. **Stoch and the ADX-family remain
untouched and out of scope. No BuilderSheet UI work (bands/fill/colorMode exposure)
is recommended as a next step — §15's own evidence-based answer is that no real
script sampled so far has needed it.**

---

## Account/environment safety record (this pass)

No isolated backend/frontend was started this pass (no browser script-import testing
was performed). TradingView (chart `jHASRSzx`) was used only for the read-only
baseline-verification steps in §0, plus one corrective action (closing an unsaved,
never-persisted Pine Editor draft). No indicator was added to or removed from the
chart; the 5-item object-tree baseline is unchanged in substance, only cleaner (the
stray editor draft is gone). No product code was changed. No new files were created
under `tests/fixtures/`.
