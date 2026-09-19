# Public Script Compatibility — Layer C, Real-Import Checkpoint 02

Closes the gap Checkpoint 01 explicitly left open: every prior Layer C session captured whether a
real public Pine script **compiles/renders on the real TradingView vendor** — never whether it
**actually imports through UCT's own real product path** (`Indicators → New formula → Import`,
against a live, isolated UCT backend+frontend, not a static Node/Python harness). This session runs
that real path, end to end, for 8 diverse real public scripts, then builds one first-party UCT-native
complex visual stress fixture through the same real UI. **Discovery/validation only — no remediation
performed**, per explicit owner instruction. **Stop after this report** — Stoch and the ADX-family
remain untouched, unrelated to this tranche.

Governing distinction, unchanged from every prior batch: **UCT TRANSLATOR SUPPORTED ≠ CURRENT
TRADINGVIEW COMPILES ≠ VENDOR VISUAL/SEMANTIC PARITY ≠ THE REAL UCT IMPORT PATH ACTUALLY WORKING.**
This session adds the fourth term to that chain and demonstrates, directly, that it is not implied by
the first three — see §6.

---

## 1. Environment

Isolated backend (`uvicorn`, imports the repo-root `conftest.py` before `api.main` so its
`SHARED_DATA_ENV_PINS` redirect — normally pytest-only — sandboxes every `/data/*` path, `AUTH_DB_PATH`
included, into a throwaway temp dir; the write tripwire was armed for the whole session and never fired
— confirmed by grepping the full session log for `SharedDataRootWrite`, zero hits) on port 8000 (free;
port 8077 was already held by an unrelated concurrent local session, left untouched per the standing
concurrency discipline). Isolated frontend: `vite` auto-selected port 5178 (5173-5177 all held by other
concurrent sessions). Fresh account `compatharness@local.dev`, auto-promoted admin via `ADMIN_EMAILS`.
Both processes stopped via direct PID kill after this session completed. TradingView (chart `jHASRSzx`)
was never touched this session — the 5-item object-tree baseline from the prior (vendor-parity) tranche
was left exactly as found; this tranche needed no TradingView access at all.

## 2. Exact public scripts tested and why each was selected

All 8 from the already-provenanced `tests/fixtures/pine_community/` corpus (real, license-checked,
URL/author/boost-count recorded in its own `SOURCES.md` — no new scraping needed). Selected to cover
every category the authorization named, deliberately mixing scripts already partially evidenced
(to complete their missing real-import step) with scripts never touched by any prior layer (to
maximize new information):

| # | Script | Category | Prior evidence | Why this one |
|---|---|---|---|---|
| 1 | `05-chandelier-exit.pine` | moving-average/trend system | Layer A SUPPORTED | Never Layer C tested at all; real member-facing script with heavy stateful ratchet logic |
| 2 | `06-qqe-mod.pine` | oscillator | None | Fully untested; tuple-returning user function invoked twice — stresses recurrence + composition |
| 3 | `03-cm-williams-vix-fix.pine` | volatility/band indicator | Layer A + Layer C(vendor-only) SUPPORTED | Completes the one missing step (real UCT import) for an already-otherwise-fully-evidenced script |
| 4 | `22-daily-weekly-monthly-highs-lows.pine` | multi-plot/multi-timeframe study | None | Real `request.security` multi-timeframe tuple destructuring + heavy array/line-object usage |
| 5 | `29-zigzag-plus-plus.pine` | custom state logic | Layer A CORRECTLY_REFUSED, Layer C(vendor) SUPPORTED | Confirms the real product UI's own refusal message text, not just the static guard string |
| 6 | `27-support-resistance-channels.pine` | visual-heavy | Layer A UNSUPPORTED (`pine:reassign`), Layer C(vendor) SUPPORTED | Completes the real-import step for the deepest array/control-flow stress case in the corpus |
| 7 | `18-minervini-trend-template.pine` | input-heavy | Layer A SUPPORTED | Never Layer C tested; many inputs + a `table.new` display panel |
| 8 | `17-pocket-pivot-breakout.pine` | moderately-complex composite | None | Generic-array (`array.new<float>`) syntax + nested loops + alertconditions |

## 3. Raw-import result for each (real UCT product, not the static translator)

| # | Script | Columns offered | Columns that actually resolve clean | Deepest stage reached |
|---|---|---|---|---|
| 1 | Chandelier Exit | 9 (all `plot`/`plotshape`/`alertcondition` outputs; the hidden `ohlc4` helper plot correctly excluded, `display.none` recognized) | 9 of 9 — every offered column is a real, clean `accum()`-based formula | **Saved, rendered, persisted** (see §4/§9) |
| 2 | QQE MOD | 3 (of 6 candidates) | 3 of 3 offered — but 3 REAL outputs (the actual QQE trend lines) are silently absent from the offered set entirely, blocked upstream by a recurrence error (see §6) | **Saved, rendered, persisted** |
| 3 | CM Williams Vix Fix | 4 | 3 of 4 (the `hp`-gated "Range High Percentile" line hits the boolean-input pattern, §6) | **Saved, rendered, persisted** |
| 4 | Daily/Weekly/Monthly H/L | 0 | 0 | **Correctly, cleanly, totally refused** — "Line 132, column 6: an array, a matrix or a map is outside the expression grammar this engine runs — `array.get`" |
| 5 | ZigZag++ | 0 | 0 | **Correctly, cleanly, totally refused** — "Line 16, column 1: importing another script pulls in code this engine never sees" |
| 6 | Support Resistance Channels | 2 | **0 of 2** — both offered columns carry the boolean-input pattern (§6) | Offered but neither actually resolves; Save silently no-ops (§7) |
| 7 | Minervini Trend Template | 2 | **0 of 2** — both offered columns carry the boolean-input pattern (§6) | Offered but neither actually resolves; Save silently no-ops (§7) |
| 8 | Pocket Pivot Breakout | 3 | At most 1 of 3 confirmed clean; "Gap-Up Alert" independently confirmed to carry the boolean-input pattern (§6); the array-dependent "Pocket Pivot Breakout Alert" not separately re-confirmed against `array.get` but expected to fail on the same grounds as #4 | Not fully saved — deprioritized once the pattern was independently reconfirmed a 4th time |

## 4. Assisted result, separately

Not applicable this session — no script's raw import failed in a way the product's assisted-edit/
recovery workflow (RISK-004, out of scope) was invoked against. Every failure this session was either a
clean, correct, immediate refusal (§3 rows 4-5) or a per-column readback error surfaced inline in the
Import tab itself (§6) — never a case where an assisted-edit affordance appeared and was tested.

## 5. Deepest product stage reached by each

Recorded per-script in §3's last column. Three of eight (Chandelier, QQE, VIX Fix) reached the full
chain: paste → dialect-detect → translate → canonical readback → placement inference → live preview →
save → real chart render → (VIX Fix and Chandelier only) confirmed via direct backend read. Two of eight
(Daily/Weekly/Monthly H/L, ZigZag++) reached a clean, correctly-attributed total refusal at the
translate stage. Three of eight (SRchannel, Minervini, Pocket Pivot) reached the "columns offered"
stage but **zero of their own offered columns actually resolve** — a distinct, important middle
ground the coarse "N columns offered" summary does not itself surface (§6/§8).

## 6. THE HEADLINE FINDING — a reproducible, four-script translator defect

**A plain Pine boolean `input()` variable, referenced directly inside a conditional expression
(`boolInput ? x : na` or `boolInput and ...`), causes UCT's own readback to fail with "the read-back
cannot name a value the table does not declare," naming the input's own bound variable as if it were
an unrecognized series/scalar field — even though the SAME input, used only as a group-heading
condition rather than an inline boolean, would resolve fine.** Reproduced independently, with the
EXACT same error shape, across **four separate scripts, four separate boolean input names**:

| Script | Boolean input name | Expression | Result |
|---|---|---|---|
| CM Williams Vix Fix (#3) | `hp` | `hp and rangeHigh ? rangeHigh : na` | This one candidate column fails; the script's OTHER 3 columns (not gated on `hp`) resolve fine |
| Support Resistance Channels (#6) | `showthema1en`, `showthema2en` | `showthema1en ? sma(...) : 0/0`-shaped readback | **BOTH** of the script's only 2 offered columns fail — 0 of 2 usable |
| Minervini Trend Template (#7) | `show_52_week_high_low` | `show_52_week_high_low ? highest_price : na` | **BOTH** of the script's only 2 offered columns fail — 0 of 2 usable (see §6a) |
| Pocket Pivot Breakout (#8) | `gapcandle` | `... and gapcandle` (bare `and`, not even a ternary) | Confirmed on "Gap-Up Alert"; extends the pattern beyond ternaries to bare boolean conjunction |

This is a genuinely new, previously-undocumented finding — no prior Layer A/B/C session in this
program's history exercised the real Import-tab readback against a boolean-`input()`-gated
conditional, because Layer A's own static corpus check evidently does not surface it the same way
(see §6a). It is filed as `translator_semantic_gap` (a correctly-refused case per column — the error
IS loud, never silently wrong — but the underlying limitation is real and affects a common, idiomatic
Pine pattern: "only show/compute this if the user turned it on").

### 6a. The methodologically important half of this finding

**`18-minervini-trend-template.pine` is recorded as Layer A `SUPPORTED` in this program's own existing
static corpus benchmark** (`BENCHMARK_REPRODUCTION.md`'s 19/30-translating tally) — yet the REAL
product import path shows **zero** of its two actually-offered outputs resolve without an error. This
is not a contradiction to be waved away: it means the coarse static Layer A pass/fail label can
overclaim relative to what a member experiences through the actual import UI, for this specific
construct class. **This is exactly the category of gap this whole tranche was authorized to find** —
recorded here as a methodology finding about the program's own evaluation layers, not merely a product
bug.

## 7. Any SILENT_WRONG_RESULT findings

**None confirmed as currently observable by a real user in today's product** — every failure above
surfaces a loud, specific, correctly-worded error either as a refusal (§3 rows 4-5) or as a per-column
readback error box (§6). One adjacent, lower-severity finding, disclosed here rather than promoted to
SILENT_WRONG_RESULT because it does not currently diverge in observable behavior:

- **Clicking Save on a column whose own readback still carries an unresolved error silently no-ops** —
  no toast, no persisted definition, no visible confirmation either way (confirmed directly: attempting
  to save Support Resistance Channels' errored "MA 1" column produced no new row in
  `GET /api/user-definitions`, and the dialog simply returned to an editing view with no message). A
  member who does not separately check "Your Formulas" has no way to know nothing happened. Filed as a
  UX gap (missing negative feedback on Save), not as SILENT_WRONG_RESULT, since no wrong VALUE is ever
  produced or shown — the save simply, quietly, does not happen.
- A related, narrower, latent risk (NOT confirmed live): for a boolean input whose readback happens to
  resolve to a `0/0`-shaped placeholder rather than a hard error (observed transiently on Support
  Resistance Channels' MA columns before the persistent error state was reached), the placeholder's
  NaN-on-every-bar behavior happens to coincidentally match that script's own `false`-by-default branch
  (`na` in both cases) — but for the WRONG reason (translator confusion, not correct branch modeling).
  Today, with all inputs fixed at their literal defaults, this cannot currently diverge from correct
  behavior. It would become a real SILENT_WRONG_RESULT risk only if boolean-input adjustability is ever
  added without first fixing §6's underlying gap. Flagged prospectively, not claimed as live.

## 8. Visual-fidelity findings

- **Placement inference is correct when it can lean on the source's own `overlay=`/`study(...)`
  declaration for a genuinely oscillator-shaped output** (QQE MOD's histogram → correctly placed in its
  own pane, matching `overlay=false`) but **the Chandelier Exit case is genuinely ambiguous, not
  confirmed either way**: the saved definition's own persisted `placement.target` is `"pane"` (own
  pane), yet the live chart rendering visually tracks price closely enough (because `Long Stop`'s own
  numeric value is naturally in SPY's own price range) that a screenshot alone cannot distinguish "own
  pane, coincidentally overlapping price's Y-range" from "actually overlaid" without a symbol/output
  pair whose value range does NOT coincide with price — not resolved this session, disclosed as open.
- **Canonical readback correctly recognizes and excludes a `display.none`-hidden helper plot**
  (Chandelier's `ohlc4` midline plot) with a specific, correct, plain-English reason ("The script hides
  this plot, so it is not offered as a column") rather than either silently including it or refusing the
  whole script.
- **Live preview rendering was visually confirmed correct** for all three successfully-saved scripts —
  Chandelier's stop line tracking price, VIX Fix's histogram in its own pane, QQE's histogram in its
  own pane, STRESS01's composite (§9) — real chart pixels, not merely "the dialog closed without error."

## 9. Parameter/input findings

- **Input adjustability from a real imported Pine script IS sometimes automatic and correct** — CM
  Williams Vix Fix's `pd` (`LookBack Period Standard Deviation High`) carried over as a genuine
  adjustable parameter on the saved definition. This is a **positive, previously-uncharacterized
  finding**: RISK-013 (from the original Golden Journey #1) recorded input adjustability as "did not
  carry over — INPUTS YOU CAN CHANGE LATER: None yet," for a DIFFERENT script (`07-rsi.pine`). This
  session shows the behavior is not a blanket "never," it is real and script-dependent — the exact
  boundary of which `input()` shapes DO carry over was not isolated further this session (a natural
  next-tranche question, not answered here).
- **The Formula tab's own manual "+ Add an input" affordance does not work by naively typing the new
  input's name into a formula's numeric-argument position.** Constructed directly: added an input named
  `signalLength` (default 9) via "+ Add an input," then edited the formula text to reference
  `ema(macd(close,12,26), signalLength)` in place of the literal `9` — this raises a hard, correct-but-
  unexpected refusal: `a window must be a whole-number literal — ema argument must be a whole number of
  at least 1, got {"type":"series","name":"signalLength"}`. The input mechanism evidently expects a
  DIFFERENT binding convention than direct name substitution in the formula string; what that
  convention actually is was not discovered this session (reverted to a literal `9` and completed the
  fixture without a custom Formula-tab input — see §12). This is a real, disclosed capability/discovery
  gap in this session's own understanding, not a confirmed product defect — flagged for whoever next
  works this surface, since the "+ Add an input" UI offers no visible guidance on the correct usage.

## 10. Save/reopen findings

Full round-trip confirmed via direct backend reads (`GET /api/user-definitions`), not merely visual
inspection — mirroring the established `BuilderSheet.paramReopen` precedent:

- Chandelier Exit, QQE MOD, VIX Fix, and the STRESS01 fixture (§12) all persisted cleanly
  (`"Saved — version 1, rev 1"` UI confirmation + a real new row via direct DB read).
- **STRESS01 was carried through a genuine edit cycle**: reopened via the real "Edit formula" pencil
  icon in the "New formula" dialog's own "YOUR FORMULAS" list (not a shortcut), the persisted line-width
  value (`1`) was confirmed present in the reopened form, changed to `3`, saved via "Save changes," and
  confirmed via direct DB read: **same `def_id` (`u_c7baa2fe885e`), `version` incremented 1→2, the new
  `lineWidth` default (`3`) correctly persisted.**
- **A full browser page reload (not an SPA navigation) was performed after all four definitions were
  saved, and every one of them reappeared on the chart, correctly re-rendering with live-recomputed
  values** (not a cached image) — direct visual confirmation across four independently-saved, differently-
  shaped indicators simultaneously.
- **A real, if minor, duplicate-persistence variant of RISK-012 was reproduced**: two separate Save
  clicks on Chandelier Exit (one self-inflicted, mirroring the original RISK-012 finding) produced
  **two entirely separate persisted `def_id`s** (`u_aa926462a166` and `u_e32a01e83fe6`), not merely two
  chart instances pointing at one definition as the original Golden Journey #1 finding described — a
  slightly different failure shape worth noting alongside the original, not a new independent defect.

## 11. Screener findings

- All four cleanly-saved NUMERIC outputs (Chandelier's Long Stop, QQE's Secondary RSI Histogram, VIX
  Fix's Williams Vix Fix, STRESS01's MACD composite) correctly show `scannable: false` — matching the
  established numeric-vs-boolean gate.
- **A fresh boolean formula authored directly through the real Formula tab
  (`close > sma(close, 20)`, named "STRESS02 Boolean Screen Test") correctly shows `scannable: true`,
  `scan_refusal: null`** — a clean, independent re-confirmation of the exact numeric-vs-boolean gate
  Golden Journey #1 first established, this time on a freshly-authored formula rather than an imported
  script, closing that generalization gap.

## 12. Result of the first-party complex visual stress fixture

**"STRESS01 MACD Composite Histogram+Signal,"** built through the real Formula tab (not a hand-
constructed document), combining only already-shipped capabilities: nested calculation reuse (`macd(
close,12,26)` referenced inside `ema(macd(close,12,26),9)`, then reused a second time as an
independent second plot), a genuinely independent second plot added via "+ Add a plot" (`signal =
ema(macd(close,12,26),9)`), a zero-line guide level (`hlines` at `0`), own-pane placement, and
auto-generated per-plot adjustable color/width inputs. Confirmed via direct backend read: **3 real plot
entries** (`role: primary` = the histogram, `role: secondary` = the signal line, `role: context` =
the zero-line guide), each independently styleable. Carried through the full save → close → reopen
(via the real pencil-icon edit door) → re-tune → save (version 1→2, same `def_id`) → full page reload
→ still-correct-rendering cycle described in §10. This is now a genuine, real-browser-verified,
first-party complex-composite fixture — not a synthetic/Layer-B-only artifact — and is a reasonable
candidate for a permanent regression fixture if a future tranche wants to formalize it (not done this
session, per the discovery-only scope).

## 13. Which 3-5 discovered gaps appear highest-value to remediate, and why

Ranked by information value and blast radius, NOT recommended for immediate action (this tranche is
discovery, per explicit instruction):

1. **§6's boolean-input-in-a-conditional pattern** — reproduced independently across 4 of 8 real
   scripts, on 4 different variable names, in both ternary and bare-`and` positions. This is the
   single highest-value finding: it is common, idiomatic Pine (`showX ? ... : na` is one of the most
   ordinary ways to author an optional visual toggle), and it currently zeroes out BOTH of two entire
   scripts' (SRchannel, Minervini) only offered outputs.
2. **§6a's Layer-A/real-import fidelity gap** — not a single bug but a standing methodology risk: this
   program's own coarse static benchmark can currently certify a script "SUPPORTED" while the real
   import path delivers zero working outputs. Worth a future pass extending Layer A's own corpus check
   to catch this class, rather than relying on spot-checks like this session's.
2. **QQE MOD's dual-variable ratchet recurrence gap** (§3 row 2) — a real, separate limit on what
   `accum()` can represent (a condition referencing two different running values' own histories at
   once), distinct from the boolean-input pattern, and plausibly affecting other Wilder-style dual-band
   indicators beyond QQE specifically — untested beyond this one script.
3. **§7's silent no-op on Save** — low severity but easy to fix and directly member-facing: a clear
   "this can't be saved yet" message would close a real, if minor, feedback gap.
4. **§9's Formula-tab "+ Add an input" binding convention** — currently opaque to a member (and to this
   session): the UI invites you to add an input and reference it, but the naive way to reference it
   fails with a technical, non-actionable error. Understanding and then documenting (or fixing) the
   real convention is a small, high-clarity win.

## 14. Which failures were correct refusals

- **`22-daily-weekly-monthly-highs-lows.pine`** — total refusal, `array.get` outside the expression
  grammar. Correct: UCT genuinely has no array/matrix/map primitive. This is the first CLEAN,
  non-confounded confirmation of that boundary (Checkpoint 01's own `27-support-resistance-channels`
  finding could never isolate this, since its `pine:reassign` guard fires first).
- **`29-zigzag-plus-plus.pine`** — total refusal, external library import. Matches Checkpoint 01's
  already-recorded Layer A finding exactly; this session additionally confirms the real product UI
  surfaces the SAME clear, well-written refusal text a member would actually see.
- Every one of §6's four boolean-input failures is **also a correct refusal at the per-column level** —
  loud, specific, never silently wrong — even though the underlying limitation itself (§13 item 1) is
  worth remediating.

## 15. Evidence artifacts / commits

- This document.
- Live session evidence: direct `GET /api/user-definitions` reads (quoted inline above), a browser
  session against a throwaway isolated backend+frontend (both stopped and torn down; the sandboxed
  temp-directory database is not committed anywhere — it never held anything worth preserving beyond
  what is quoted in this document).
- No new files under `tests/fixtures/compat_harness/results/` this session — the existing Layer A/C
  result-file schema (Checkpoint 01) is built for TRANSLATOR/VENDOR-COMPILE evidence; this session's
  real-import evidence (readback text, save/reopen DB state) does not fit that schema cleanly and is
  recorded here in prose instead, per the discovery-only scope. Formalizing a Layer-C-real-import result
  schema (mirroring Section 3 of `PUBLIC_SCRIPT_VISUAL_COMPATIBILITY_HARNESS_READINESS_REPORT.md`) is a
  reasonable follow-up if this door is exercised again, not done this session.
- No product code was changed. `RISK_REGISTER.md` gets one new entry (RISK-037) recording this
  checkpoint; `PROGRESS.md` gets one new dated entry. Neither `VALIDATION_COVERAGE_MAP.md` nor
  `PHASE_TWO_PLAN.md` is touched — this tranche is a distinct, separately-authorized program (per the
  user's own framing, "the previously-authorized Public Script + Complex Visual Indicator Compatibility
  Harness"), not a Lane A vendor-parity batch.

## 16. Recommended next engineering tranche

**None recommended for immediate start — this checkpoint is discovery only, per the explicit
instruction not to begin remediation, Stoch, or the ADX-family after this report.** If/when a
remediation tranche is separately authorized, §13's ranking is the starting point, with item 1 (the
boolean-input-in-conditional pattern) as the highest-value first target given its reproduction count
and blast radius (two of eight real scripts sampled had ZERO working outputs because of it alone).

---

## Account/environment safety record

The isolated backend's write tripwire (armed for the entire session via the repo-root `conftest.py`,
identical mechanism to the pytest suite) never fired — grepped directly against the full session log,
zero `SharedDataRootWrite` occurrences. Both the isolated `uvicorn` (port 8000) and `vite` (port 5178)
processes were stopped by direct PID kill at the end of this session. The already-occupied port 8077
(a different, unrelated concurrent local session) was identified via `netstat` before choosing port
8000 and was never touched. TradingView (chart `jHASRSzx`) was not used this session; its state from
the immediately-prior (vendor-parity) tranche is unchanged.
