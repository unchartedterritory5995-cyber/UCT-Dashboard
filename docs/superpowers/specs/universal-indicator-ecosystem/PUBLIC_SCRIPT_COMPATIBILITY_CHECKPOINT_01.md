# Public Script Compatibility Checkpoint 01

Final bounded closeout of the Public Script Compatibility Harness tranche (Phase Two, `public_script`
lane only — the `visual_fixture` Lane 2 six-level ladder is a separate, already-recorded body of
evidence and is out of scope for this checkpoint except where item 15 notes it for context). Produced
per explicit owner instruction after: (1) hardening the harness's own source-entry mechanism, (2)
retrying `29-zigzag-plus-plus.pine` under the hardened mechanism, and (3) adding exactly two new
public-script categories (one input-heavy, one visual-heavy) and running the same full classification
chain on both. **This checkpoint is discovery/validation only — no remediation was performed on any
finding below, per explicit instruction.**

Governing distinction, maintained throughout: **UCT TRANSLATOR SUPPORTED ≠ CURRENT TRADINGVIEW
COMPILES ≠ VENDOR VISUAL/SEMANTIC PARITY.** These are three separate claims about three separate
systems (UCT's static translator, TradingView's live compiler today, and rendering/semantic fidelity),
and this whole tranche exists to keep them from being conflated.

---

## 1. Complete sampled-script table

Nine distinct public Pine scripts have a Layer A (static UCT translator) result; six of the nine also
have a Layer C (live TradingView browser capture) result, one of which (`29-zigzag-plus-plus.pine`) was
attempted twice — once with simulated per-keystroke typing (HARNESS_DEFECT, superseded) and once with
the hardened clipboard-paste mechanism this closeout introduced (SUPPORTED).

| Script | Category | Layer A (UCT translator) | Layer C (live TradingView) | Final disposition |
|---|---|---|---|---|
| `07-hull-suite.pine` | moving_average_system | PARTIAL — OFFERED (hand-expanded half-window Hull; door offers `hma`) | not attempted | Layer A only |
| `02-wavetrend-oscillator-lazybear.pine` | oscillator | SUPPORTED | **VENDOR_AMBIGUOUS** — fails to compile under implied Pine v1 (`hlc3` unresolved) | Vendor-compile-decay finding (RISK-028), prior Layer C session |
| `05-chandelier-exit.pine` | trend_indicator | SUPPORTED | not attempted | Layer A only |
| `03-cm-williams-vix-fix.pine` | volatility_band_indicator | SUPPORTED | **SUPPORTED** — full E2E (compile, render as histogram pane, save/reopen via "Open my script") | Confirmed end-to-end, prior Layer C session |
| `19-cm-macd-ult-mtf.pine` | multi_plot_study | SUPPORTED | **VENDOR_AMBIGUOUS** — fails under implied v1 AND explicit `//@version=4` (real residual error either way) | Vendor-compile-decay finding (RISK-028), prior Layer C session |
| `29-zigzag-plus-plus.pine` | custom_state_logic | CORRECTLY_REFUSED (imports an external Pine library; UCT has no mechanism to resolve one) | Attempt 1: **HARNESS_DEFECT** (Monaco auto-indent corrupted nested if/else via simulated typing). Attempt 2 (this closeout, hardened clipboard paste): **SUPPORTED** — import resolves cleanly, full param resolution `(12, 5, 2, 2, 0, 0, 80, 3)` | Harness fixed; vendor import-resolution question now answered SUPPORTED; UCT's CORRECTLY_REFUSED unchanged (see §3) |
| `18-minervini-trend-template.pine` | input_heavy_script | SUPPORTED | not attempted | Layer A only |
| `14-earnings-gap-ups.pine` | input_heavy_script_enum_udt (**new this closeout**) | UNSUPPORTED — guard `pine:no-output` | **SUPPORTED** — compiles clean, enum values resolve live (`Solid, Solid, Solid`) | This closeout — see §4/§6 |
| `27-support-resistance-channels.pine` | visual_heavy_script (**retested this closeout**) | UNSUPPORTED — guard `pine:reassign` | **SUPPORTED** — compiles clean, full param resolution incl. string-type input `(10, High/Low, 5, 1, 6, 290, 50, SMA, 200, SMA)` | This closeout — see §4/§6 |

Raw evidence: `tests/fixtures/compat_harness/results/public_script/*.json` (16 files — 9 Layer A + 7
Layer C, including the superseded original ZigZag++ attempt, kept rather than deleted, per this
program's standing "record failed-at-N findings, don't silently omit them" discipline).

---

## 2. Category represented

Nine categories across the full `public_script` corpus: `moving_average_system`, `oscillator`,
`trend_indicator`, `volatility_band_indicator`, `multi_plot_study`, `custom_state_logic`,
`visual_heavy_script`, `input_heavy_script`, and `input_heavy_script_enum_udt` (new this closeout).
The two categories added/retested this closeout were deliberately chosen to maximize new information,
not to maximize the odds of a passing result (explicit instruction): `14-earnings-gap-ups.pine` stresses
input KINDS no prior sample script exercised (a custom `enum` type, `input.enum()`, a user-defined
`type`, `method` definitions, `switch` expressions) rather than re-testing the already-known-good
`18-minervini-trend-template.pine` (plain numeric/bool inputs, already Layer A SUPPORTED); the retest of
`27-support-resistance-channels.pine` was chosen as the visual-heavy pick specifically because it was
**already** Layer A UNSUPPORTED, making its vendor-side compile/render result a genuinely new data point
rather than a foregone conclusion, and because its construct diversity (multi-plot MAs, dynamically
colored boxes, pivot shape markers, 3-level nested loops) is the deepest visual/control-flow stress in
the sample.

---

## 3. Current TradingView compile status

Of the six scripts with a Layer C attempt: **four compile cleanly in TradingView's real, current engine
with zero errors** (`03-cm-williams-vix-fix.pine`, `14-earnings-gap-ups.pine`,
`27-support-resistance-channels.pine`, and `29-zigzag-plus-plus.pine` on its hardened-paste retry).
**Two do not compile at all today** (`02-wavetrend-oscillator-lazybear.pine`,
`19-cm-macd-ult-mtf.pine`) — a fact about vendor platform decay over roughly 11 years for scripts
published without an explicit version pragma, not a UCT defect (RISK-028, unchanged by this closeout).
One earlier attempt (`29-zigzag-plus-plus.pine`, simulated typing) produced no valid compile signal
either way because the harness itself corrupted the source before it ever reached the compiler — that
attempt is **superseded**, not counted as a vendor-compile data point.

---

## 4. UCT translator/import status

Layer A (static, no browser) results for the full 9-script sample: 5 SUPPORTED, 1 PARTIAL (OFFERED an
assisted-edit fix), 2 UNSUPPORTED, 1 CORRECTLY_REFUSED. The two new/retested UNSUPPORTED results this
closeout carry genuinely different, previously-uncharacterized root causes, both confirmed from the
real recorded harness guard output rather than assumed:

- **`14-earnings-gap-ups.pine` → guard `pine:no-output`**: the script draws only lines/labels/boxes
  with no `plot()`/`alertcondition()` to filter on — the identical, correct reason
  `doorScorecard.test.js`'s pre-existing RULED entry already gives for this script. **This does NOT
  test the enum/UDT/method/switch syntax hypothesis** this script was originally selected to probe —
  the no-output gate fires first (or the translator tolerates those constructs structurally without
  erroring; `unsupported_constructs` is empty either way). That hypothesis remains genuinely open (§15).
- **`27-support-resistance-channels.pine` → guard `pine:reassign`**: "a name that is reassigned later
  cannot be folded into one expression — `resistancebroken`." **This corrects an earlier, less precise
  characterization of this script's failure** (informally assumed in this program's own prior
  discussion to be about missing array/box builtins) — the real, verified blocker is UCT's
  expression-folding translator's structural inability to handle a variable assigned once and later
  `:=`-reassigned across control flow (inside a `for` loop, in this script's case). This is a more
  fundamental limitation than "a missing builtin": it means the array/box builtins this script also
  uses heavily are **genuinely untested as the actual blocker**, since the reassign guard fires first
  and no evidence exists either way about whether array/box builtins would independently block
  translation on a script that didn't also reassign a variable.

---

## 5. Render status

All four cleanly-compiling Layer C scripts (`03`, `14`, `27`, `29`-retry) rendered live with **strong
evidence of genuine execution, not name-only placeholders**: TradingView's object-tree legend resolved
real, script-declared default parameter values in every case (`ZigZag++ [LD] (12, 5, 2, 2, 0, 0, 80,
3)`; `Earnings Gap Ups (Solid, Solid, Solid)` — confirming the custom `enum` type functions correctly,
not merely parses; `SRchannel (10, High/Low, 5, 1, 6, 290, 50, SMA, 200, SMA)` — confirming a
string-typed `input.string(...,options=[...])` resolves correctly, not only numeric/bool inputs). The
two vendor-compile-decay scripts (`02`, `19`) never reached render — the vendor refused to compile them
at all, so render is not applicable, not merely unobserved.

---

## 6. Persistence status

**Only `03-cm-williams-vix-fix.pine` has full save/reopen persistence evidence** (via the "Open my
script" library listing, in a prior Layer C session). The three scripts touched this closeout
(`29`-retry, `14`, `27`) were **not saved this pass** — each result file marks
`persistence_save`/`persistence_reload` as `PARTIAL`, explicitly disclosed as "not exercised this pass,"
not silently assumed. This was a deliberate scope choice: the priority for this closeout was the
compile/import-resolution/render question for each script, and account-state safety discipline (never
save unless explicitly testing persistence, delete immediately after) argued against adding three more
save/delete cycles beyond what the tranche's own questions required.

---

## 7. Screener status

None of the four cleanly-compiling, rendered Layer C scripts is screener-eligible today, and all four
fail for the **same, already-known reason**: each draws only lines/labels/boxes/bgcolor (drawing
objects), with no numeric or boolean `plot()` output and no `alertcondition()` to filter on. This
matches Layer A's own static reasoning for the same class of no-plot scripts exactly — the live vendor
render does not surface a new screener-eligibility fact, it confirms the static assessment was already
correct for the right reason.

---

## 8. Failure taxonomy

Public-script-lane tally across all 16 result files (9 Layer A + 7 Layer C):

| Taxonomy tag | Count | Scripts |
|---|---|---|
| `unsupported_builtin` | 3 | `07-hull-suite` (PARTIAL/OFFERED), `14-earnings-gap-ups` (Layer A), `27-support-resistance-channels` (Layer A) |
| `vendor_ambiguity` | 2 | `02-wavetrend-oscillator-lazybear`, `19-cm-macd-ult-mtf` (both Layer C) |
| `harness_defect` | 1 | `29-zigzag-plus-plus` original Layer C attempt (superseded) |
| `correctly_refused` | 1 | `29-zigzag-plus-plus` (Layer A) |
| (none — SUPPORTED) | 9 | the remaining 9 result rows |

⚠️ **A disclosed harness-taxonomy imprecision, found while compiling this table**: the Layer A
classifier's coarse taxonomy buckets any non-`canonicalise`-prefixed guard as `unsupported_builtin`
(`compatHarness.publicScript.test.js`'s `classifyOne`) — so `27-support-resistance-channels.pine`'s
real guard (`pine:reassign`, an expression-folding/reassignment limitation, not a missing builtin) is
mechanically labeled `unsupported_builtin` in the tally above despite §4's more precise finding. This is
a labeling coarseness in the harness's own summary tag, not a wrong underlying `guard`/`message` (those
remain correct in the result JSON) — flagged here rather than silently reported as if the tally were
semantically precise.

---

## 9. Silent-wrong-answer count

**Zero**, across all 16 public-script-lane results and both Layer C sessions. Every UNSUPPORTED/
CORRECTLY_REFUSED/VENDOR_AMBIGUOUS/HARNESS_DEFECT classification is backed by an honest, specific,
correctly-attributed reason (a named guard, a named vendor compile error, a named harness limitation) —
none of the 16 results represents UCT or the harness confidently asserting something false.

---

## 10. Correctly-refused count

**One** — `29-zigzag-plus-plus.pine` at Layer A, for importing an external Pine library
(`import DevLucem/ZigLib/1 as ZigZag`), which is code UCT's translator architecturally has no mechanism
to fetch or resolve. This closeout's Layer C retry confirms the *vendor* resolves this import cleanly —
**that finding does not contradict or weaken the CORRECTLY_REFUSED classification**, since the two are
claims about different systems (§3's governing distinction): UCT correctly refuses because it cannot
see the imported code, regardless of whether the vendor can.

---

## 11. Vendor-ambiguity count

**Two** — `02-wavetrend-oscillator-lazybear.pine` and `19-cm-macd-ult-mtf.pine`, both from the prior
Layer C session (RISK-028), unchanged by this closeout. Both are UCT Layer A SUPPORTED but fail to
compile in TradingView's current live engine — a fact about ~11 years of vendor platform decay on
scripts published without an explicit version pragma, not a UCT translator defect.

---

## 12. Harness-defect count

**One, superseded.** The original `29-zigzag-plus-plus.pine` Layer C attempt (simulated per-keystroke
typing corrupting nested if/else indentation via Monaco's auto-indent) is HARNESS_DEFECT and remains in
the record as a disclosed, superseded finding — not deleted, per this program's own "don't silently
overwrite a failed-at-N result" discipline. This closeout's own explicit purpose was fixing exactly this
limitation; the retry (hardened OS-clipboard paste + a multi-part non-vacuity check) reproduced no
corruption across three scripts of increasing nesting complexity (ZigZag++'s 2-level nesting, Earnings
Gap Ups' different 2-level structure, Support Resistance Channels' 3-level nesting) and is considered
**CONFIRMED RELIABLE** for future Layer C sessions.

---

## 13. Product gaps discovered (recorded, not remediated)

- **`pine:no-output`** (Earnings Gap Ups) is confirmed **correct, intended behavior** — a script with no
  plot/alertcondition genuinely cannot be screened on. Not a gap to close.
- **`pine:reassign`** (Support Resistance Channels) is a **genuine structural translator limitation**:
  UCT's expression-folding approach cannot handle a variable reassigned (`:=`) across control flow. This
  is narrower and more precise than "missing array/box builtins" — that hypothesis remains untested
  because the reassign guard fires before the translator would ever reach the array/box calls.
- **Enum/UDT/method/switch syntax support is genuinely untested** — no script in this sample's Layer A
  UNSUPPORTED results fails *because of* these constructs; whether UCT's translator would accept or
  reject them on their own terms remains an open question, disclosed as open rather than assumed either
  way.
- **RISK-029** (already filed, unchanged by this closeout, restated here for completeness per the
  checkpoint's required scope): the document/schema layer supports materially more visual capability
  (bands, `fill`, `colorMode`) than `BuilderSheet.jsx`'s authoring UI currently exposes.

None of the above was remediated this session, per explicit instruction — this tranche is discovery and
classification only.

---

## 14. BuilderSheet-vs-schema findings

No new BuilderSheet-vs-schema findings were produced by this closeout specifically (it was scoped to
public-script Layer C capture, not the Lane 2 visual-fixture ladder that originally surfaced RISK-029).
RISK-029 stands as previously recorded: `defSchema.js`/`nativeRegistry.js` validate bands, `fill`, and
`colorMode` on user documents cleanly, with no corresponding authoring control in `BuilderSheet.jsx`.
**Restated per the owner's explicit instruction on record in RISK-029 itself: this is not authorization
to build a band/fill/colorMode authoring UI** — it is a standing citation for a future, separate product
decision.

---

## 15. What is evidence-backed vs. still unknown

**Evidence-backed (this closeout):**
- The hardened clipboard-paste source-entry mechanism reliably preserves exact source across three
  scripts of increasing nesting complexity, verified via clipboard-vs-file exact match pre-paste and
  line-count + zoomed-indentation spot-check post-paste.
- ZigZag++'s cross-script import resolves cleanly in the real vendor (previously an open question).
- Earnings Gap Ups' and Support Resistance Channels' real vendor compile/render behavior, including
  correct resolution of a custom `enum` type and a `string`-typed `input` with `options=[...]`.
- The precise (corrected) UCT-side rejection reasons for both retested/new scripts.

**Still unknown (disclosed, not assumed):**
- Whether UCT's translator would accept or reject Pine `enum`/UDT/`method`/`switch` syntax on its own
  terms — no script in this sample's failure path actually tests this.
- Whether array/box builtins alone (without a reassignment) would translate — untested, since
  `pine:reassign` fires first on the only sample script using them.
- Save/reopen persistence for `29`-retry, `14`, and `27` — not exercised this pass (§6).
- Whether the `02`/`19` vendor-compile-decay pattern generalizes to other un-pragma'd legacy scripts in
  the broader `pine_community` corpus beyond these two.
- The `visual_fixture` Lane 2 six-level ladder (RISK-029's own origin) is separately evidence-backed but
  out of this checkpoint's scope — see `VALIDATION_COVERAGE_MAP.md`'s own row for that lane.

---

## 16. Recommended remediation priorities

**None urgent.** This tranche is discovery, not a bug backlog. If a future, separately-authorized
tranche does take up remediation, the evidence here would rank (highest information value first):
(1) determine whether `pine:reassign`-class expression-folding limitations block a materially large
share of real-world scripts (would require a broader corpus sweep, not assumed from N=1), (2) test
enum/UDT/method/switch support directly with a script that would otherwise translate cleanly (isolate
the variable this sample's N=1 failed to isolate), (3) RISK-029's BuilderSheet authoring gap, if product
decides visual authoring parity with the schema is a priority. None of these is recommended for
immediate action — they are ranked for if/when a remediation tranche is separately authorized.

---

## 17. Gaps that should explicitly remain parked

**All of the above**, per the standing "do not remediate merely because it was discovered" instruction
that governs this entire tranche: `pine:reassign`'s structural limitation, the untested enum/UDT/switch
hypothesis, the untested array/box-without-reassignment question, RISK-029's schema-vs-UI exposure gap,
and the unexercised persistence checks for the three scripts touched this closeout. None of these is
authorized for action by this checkpoint. Per the explicit Next Phase Boundary: no remediation, no
corpus expansion, no Track F v2, no RISK-004 work, and no Vendor Parity Lane A RSI/ATR work begins as a
result of this checkpoint — all require separate, explicit authorization, and this checkpoint's
acceptance by the owner/ChatGPT review gate does not itself constitute that authorization.

---

## Account/chart-state safety record

TradingView account/chart state (chart `jHASRSzx`, account TSDR_TRADING) was left exactly as found: each
of the three tested scripts this closeout was added to a fresh "Untitled script" tab (never touching the
pre-existing "Uncharted Scanners" indicator), removed from the chart's object tree via right-click →
Remove immediately after its result was captured, and never saved to the script library. A final "Open
my script" library check confirmed only "Uncharted Scanners" remains. One pre-existing, unrelated
object-tree artifact from an earlier session's capture work (`uct-oracle-ambiguity-v3`) was observed,
left untouched, and is disclosed here rather than silently removed, per this program's standing
"preserve pre-existing state" discipline.
