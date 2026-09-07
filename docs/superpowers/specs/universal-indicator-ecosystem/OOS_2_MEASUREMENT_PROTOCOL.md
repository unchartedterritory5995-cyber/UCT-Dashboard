# OOS-2 MEASUREMENT PROTOCOL — PREDECLARED

**Status:** PREDECLARED. Written and committed **before any OOS-1 script has touched any
UCT surface** (translator, PineBox, BuilderSheet, screener, canonical AST, JS or Python
kernel, chart renderer). Nothing in this document may be revised after the first
measurement run except by an explicit, dated, reasoned amendment appended at the bottom —
never by editing a definition in place.

**Why predeclaration matters here.** Every threshold in this file could otherwise be
tuned, consciously or not, to flatter the result. The visual-complexity tiers in
particular are defined **purely in terms of Pine Script's own published primitives**, with
no reference to what UCT can or cannot render, so that the "how hard were these scripts
visually?" axis cannot be quietly re-cut once the "how many did UCT render?" axis is
known.

---

## 0. Scope and the governing question

OOS-2 answers one question against a corpus UCT has never been optimised toward:

> When a real TradingView user brings UCT a sophisticated custom Pine indicator we have
> never seen, what actually happens — across calculation, state, inputs, visuals, chart
> behaviour, screener outputs, persistence, editability, and refusal honesty?

It does **not** answer "what percentage of Pine compiles". A single headline compatibility
percentage is explicitly forbidden as the report's primary claim.

---

## 1. The corpus under measurement

OOS-1: 60 externally-authored real TradingView Community Scripts, frozen under
`OOS_1_FREEZE_MANIFEST.md` with a SHA-256 freeze ID. Selection was capability-blind:
performed by fresh subagents holding zero UCT-capability information, reduced to 60 only
by deterministic integrity operations (exact/normalised hash dedup, near-duplicate
removal at `difflib.SequenceMatcher ≥ 0.85`, leakage removal against the existing 48/30
corpora, author caps, and an ascending-SHA-256 trim within over-quota cells).

No product code may be changed between the freeze and the completion of the first
baseline run. The first baseline is preserved verbatim before any remediation.

---

## 2. PREDECLARED VISUAL COMPLEXITY TIERS (V0–V5) — SOURCE-ONLY

Assigned by reading **the Pine source alone**. UCT is not consulted, mentioned, or
considered. A script takes the **highest** tier for which it qualifies.

The classifier counts occurrences of Pine's own visual-emitting constructs. `alertcondition()`
is explicitly **not** a visual primitive.

### The primitive families

| Family | Pine calls |
|---|---|
| **P — plots** | `plot(` |
| **L — levels** | `hline(` |
| **F — fills** | `fill(` |
| **B — surface tint** | `bgcolor(`, `barcolor(` |
| **M — markers** | `plotshape(`, `plotchar(`, `plotarrow(` |
| **C — secondary price series** | `plotcandle(`, `plotbar(` |
| **O — persistent drawing objects** | `label.`, `line.`, `box.`, `table.`, `polyline.`, `linefill.` (any member: `.new`, `.set_*`, `.delete`, `.get_*`) |
| **D — dynamic colour** | any `color =` / `color=` argument whose value is not a colour literal or a plain named constant — i.e. a ternary, a function call, a variable, or a `color.new(...)` over a computed expression |
| **H — conditional visibility** | a plot/marker whose plotted series is conditionally `na` (e.g. `plot(cond ? v : na)`), or a `display =` argument |

### The tiers

- **V0 — VALUE / CONDITION ONLY.**
  Zero calls from P, L, F, B, M, C, O. The script computes something and, at most, raises
  an `alertcondition`. It has no visual surface to reproduce.

- **V1 — ONE BASIC VISUAL SERIES.**
  Exactly one call across P ∪ M, and nothing from L, F, B, C, O, D, H. One line (or one
  marker series), one static colour.

- **V2 — MULTIPLE STATIC VISUAL SERIES / LEVELS.**
  Two or more calls across P ∪ L (≥2 plots, or a plot plus one or more `hline`s), still
  with **nothing** from F, B, C, O, D, H. Everything is drawn, nothing changes appearance
  bar to bar.

- **V3 — COORDINATED VISUALS WITH CONDITIONAL APPEARANCE.**
  Qualifies for V2's multiplicity **or not**, and additionally uses **any** of: F (`fill`),
  B (`bgcolor`/`barcolor`), C (`plotcandle`/`plotbar`), D (dynamic colour), or M used
  alongside at least one P. This is the first tier at which appearance is a function of
  the data.

- **V4 — SOPHISTICATED CONDITIONAL VISUAL COMPOSITION.**
  Everything V3 requires, **plus at least one** of:
  - ≥ 5 distinct visual-emitting calls across P ∪ L ∪ F ∪ B ∪ M ∪ C; **or**
  - ≥ 2 distinct `fill(` regions; **or**
  - H present (per-bar conditional visibility, or an explicit `display =` control); **or**
  - ≥ 3 distinct dynamic-colour (D) sites.

- **V5 — OBJECT-HEAVY / STATEFUL GRAPHICAL INDICATOR.**
  **Any** use of family O — persistent graphical objects created, mutated, and/or deleted
  across bars (`label.new`, `line.set_xy2`, `box.delete`, `table.cell`, `polyline.new`,
  `linefill.new`, …). V5 dominates every other tier: an object-drawing script is V5 even
  if it has only one `plot`.

**Tie-breaks and edge cases, predeclared:**
- A script with zero visual calls but a `strategy()` declaration is still V0 on this axis
  (its declaration is handled by the source-validity axis in §4, not here).
- Commented-out calls do not count. The classifier strips `//` line comments and
  `/* */` blocks before matching.
- A call inside a user-defined function that is itself never called still counts —
  we are measuring **declared visual intent in the source**, and determining reachability
  would require semantic analysis, which is exactly the thing under test.
- Where the classifier is uncertain (e.g. a `color=` argument it cannot statically
  classify), it records `AMBIGUOUS` for that site and the script's tier is computed twice:
  once treating ambiguous sites as present, once as absent. If the two disagree, the
  script is flagged `TIER_AMBIGUOUS` and adjudicated by hand with the reasoning recorded.

---

## 3. THE TWENTY DIMENSIONS

Each script is tracked independently across all twenty. **No dimension may be collapsed
into another, and there is no single PASS/FAIL column.** A script may be
SEMANTICALLY SUPPORTED but VISUALLY PARTIAL; CHART SUPPORTED but NOT SCREENER-EXPRESSIBLE;
or CORRECTLY REFUSED.

| # | Dimension | What is measured | How |
|---|---|---|---|
| 1 | SOURCE ACCEPTANCE | Does the source enter the product at all? | translate call does not throw |
| 2 | PARSING | Does it lex + parse to a syntax tree? | pre-resolution refusal codes absent |
| 3 | SEMANTIC INTERPRETATION | Do the parsed constructs map to declared meanings? | resolution-stage refusal codes |
| 4 | NUMERIC PARITY | Do computed values match the vendor? | vendor capture (Layer C, sampled) |
| 5 | STATE / HISTORY SEMANTICS | Are `[n]`, `var`, self-reference, loop-carried state handled or correctly refused? | refusal guard family + targeted probes |
| 6 | DATA REQUIREMENTS | What bars/history/symbols does it need; can UCT supply them? | AST requirement extraction |
| 7 | TIMEFRAME / SESSION SEMANTICS | `request.security`, session windows, MTF | refusal guard family + probes |
| 8 | INPUT / PARAMETER FIDELITY | Are `input.*` discovered, typed, defaulted, editable, read back? | `inputParams` + param manifest |
| 9 | VISUAL MODEL SUPPORT | Can the internal representation *describe* the visuals? | schema-level check |
| 10 | VISUAL RENDERING | Does anything actually draw? | browser (Layer C) |
| 11 | VISUAL FIDELITY | Does what is drawn mean the same thing? | browser + vendor comparison |
| 12 | CHART PLACEMENT / PANE | overlay vs separate pane, correct scale | browser |
| 13 | SCREENER VALUE AVAILABILITY | Is a numeric series addressable by a scan? | screener projection path |
| 14 | SCREENER CONDITION AVAILABILITY | Is a boolean condition addressable? | `treeYieldsBool` + scan evaluator |
| 15 | SAVE / REOPEN PERSISTENCE | Does it survive close and reopen intact? | browser |
| 16 | EDITABILITY | Can the user change it after import? | browser |
| 17 | BUILDER / CREATION EXPOSURE | Could a user have *created* this in-product without Pine? | builder capability check |
| 18 | ASSISTED IMPORT | Does the assisted path recover it, and is the rewrite disclosed? | offer-splice loop |
| 19 | CORRECT REFUSAL | When it fails, does it say so truthfully and specifically? | refusal guard + message audit |
| 20 | SILENT-WRONG-RESULT SAFETY | Could it appear to succeed while meaning something else? | §5 audit |

Each dimension records one of:
`FULL` · `PARTIAL` · `NONE` · `CORRECTLY_REFUSED` · `NOT_APPLICABLE` · `UNKNOWN`
— never a bare boolean.

---

## 4. OUTCOME VOCABULARY (mutually exclusive, exhaustive)

Exactly one of these is assigned per script as its **primary outcome**:

- **RAW_ACCEPTED** — the unmodified source imports and yields at least one usable output.
- **ASSISTED_ACCEPTED** — fails raw; imports after the member accepts only offers the
  engine itself generated (`refusal.suggest` spliced over `refusal.span`, ≤12 iterations).
  No hand editing, no substitution of our own Pine.
- **CORRECTLY_REFUSED** — does not import, and the refusal is truthful and specific:
  it names a real construct the engine genuinely cannot faithfully reproduce, and does not
  mischaracterise it.
- **INVALID_SOURCE** — the script is out of the declared scope or is broken independently
  of UCT (declares `strategy()` or `library()`; references undefined names; the capture is
  incomplete). Not a compatibility failure.
- **SILENT_FALSE_SUCCESS** — imports and presents an output, but the output does not mean
  what the source means. **This is the most severe class in this program**, strictly worse
  than CORRECTLY_REFUSED. See §5.
- **UNKNOWN_NEEDS_ADJUDICATION** — measurement could not classify it; requires human or
  independent-agent adjudication. Never silently folded into any other bucket.

**TRUTHFUL OUTCOME RATE** = (RAW_ACCEPTED + ASSISTED_ACCEPTED + CORRECTLY_REFUSED + INVALID_SOURCE) / 60.
It is the fraction of scripts where **the product told the user the truth** about what it
did, whether or not it succeeded. SILENT_FALSE_SUCCESS and UNKNOWN both count against it.

**ASSISTED RECOVERY** = ASSISTED_ACCEPTED / (60 − RAW_ACCEPTED) — how much of the raw
shortfall the assisted path actually recovers.

Secondary fields recorded for every script regardless of outcome: PRIMARY BLOCKER,
SECONDARY BLOCKERS (ordered), SEMANTIC STATUS, EXECUTION STATUS, CHART STATUS, SCREENER
STATUS, VISUAL REQUIREMENTS (the V-tier and the primitive families present), VISUAL
FIDELITY, PERSISTENCE STATUS (where reachable).

---

## 5. SILENT FALSE-SUCCESS AUDIT — PREDECLARED PATTERNS

RISK-043 proved a script can appear to translate while being semantically wrong (a
for-loop-mutated scalar silently read at its stale pre-loop value). Every script that
imports must therefore be audited against these patterns **before** it may be counted as a
true acceptance:

1. **State folded to a constant.** An unsupported stateful construct silently collapsed to
   `0`, `na`, or its initial value instead of refusing.
2. **Dropped block.** An `if` / `for` / `while` / `switch` body the engine could not fold
   was skipped, and downstream names kept pre-block values.
3. **Missing series → false.** An unavailable series silently became a constant that makes
   a condition trivially false (or trivially true) on every bar.
4. **Discarded visual expression.** A visual call was dropped without qualification, and
   the import is still presented as complete.
5. **Incomplete multi-output indicator presented as complete.** The source declares N
   plots; the import carries fewer, without saying so.
6. **Unsupported call folded to a plausible constant.** An unserved builtin replaced by a
   value that looks reasonable rather than refusing.
7. **A column that can never fire.** The selected output is constant on every bar
   (identically true or identically false) — the `27`/`28` failure mode already found in
   the community corpus.
8. **Approximation presented as identity.** A near-equivalent formula substituted for the
   real one without the difference being disclosed to the user.

Detection is mechanical where possible (7 is directly computable; 5 is a count comparison;
1/2/6 have guard-level fingerprints), and adjudicated by an **independent agent that is
given the Pine source and the resulting UCT representation but not the desired answer**
where it is not.

A script that trips any pattern is reclassified `SILENT_FALSE_SUCCESS` and removed from
the acceptance counts, no matter how it first measured.

---

## 6. HEADLINE METRICS — THE REQUIRED REPORT SHAPE

The OOS-2 report must publish **all** of the following, never a single number:

**Outcome metrics:** RAW ACCEPTANCE · ASSISTED ACCEPTANCE · ASSISTED RECOVERY ·
CORRECT REFUSAL · INVALID SOURCE · SILENT FALSE SUCCESS · UNKNOWN/NEEDS ADJUDICATION ·
TRUTHFUL OUTCOME RATE.

**Journey metrics:** CHART RENDERABLE · SCREENER USABLE (value) · SCREENER USABLE
(condition) · PERSISTENCE VERIFIED · EDITABILITY VERIFIED.

**Visual fidelity distribution:** VISUAL FULL · VISUAL MOSTLY COMPLETE · VISUAL PARTIAL ·
VISUAL MINIMAL · VISUAL NONE/BLOCKED.

**Every one of the above broken down by:** Pine version (v2/v3/v4/v5/v6/unversioned) ·
source complexity bucket (SHORT ≤40 / MEDIUM 41–90 / LONG >90 non-comment lines) ·
visual complexity tier (V0–V5) · engagement stratum (high / mid / long-tail).

### Visual fidelity grades — predeclared

- **FULL** — every visual primitive the source declares is reproduced with the same
  meaning: same series, same placement, same significant colours, same fills, same signal
  shapes, same visibility conditions, same objects where material. Renderer-specific
  differences are cosmetic only.
- **MOSTLY COMPLETE** — all *material* visuals reproduced; one or more purely decorative
  elements missing (e.g. a background tint, a label's font size).
- **PARTIAL** — the principal series render, but at least one meaning-bearing visual is
  missing (a fill that defines a zone, a colour that encodes state, a marker that is the
  signal).
- **MINIMAL** — a single series renders where the source declares a composition.
- **NONE / BLOCKED** — nothing renders, or the script never reached the chart.

"Exact replica" is **not** claimed at any grade. The standard is **semantic visual
fidelity**: same data series, same logical placement, same significant colours, same
fills/bands, same signal shapes, same visibility conditions, same labels/objects where
material, same pane/overlay intent, same parameter-driven behaviour, same bar-by-bar state
transitions. A materially simplified rendering is never described as an exact replica.

---

## 7. MEASUREMENT LAYERS

- **Layer A — static/offline.** Node harness over `translatePine()`: acceptance, refusal
  guards, output counts, `inputParams`, boolean-screen eligibility, assisted-offer splice
  loop. No browser. Deterministic, re-runnable, committed.
- **Layer B — dual-kernel + screener projection.** `tools/ast_conformance.py` lanes and the
  screener eligibility chokepoint, for scripts that reach a canonical AST.
- **Layer C — real browser.** The actual UCT chart: does the indicator appear, in the right
  pane, with the right number of outputs, with fills/colours/shapes, does changing an input
  update it, does save → close → reopen preserve visual and parameter. **TRANSLATES ≠
  RENDERS**; no rendering claim may rest on Layer A alone.
- **Layer D — vendor comparison.** TradingView itself, for the Complex Pine Visual Parity
  Set only (8–12 scripts, selected by the §2 tiers *before* UCT results are examined —
  explicitly **not** whichever scripts UCT happens to handle best).

---

## 8. RULES OF CONDUCT DURING THE BASELINE

1. **No product fixes during the initial measurement.** The baseline measures the product
   as it stands. Fixes come after the baseline is frozen and committed.
2. **The first baseline is preserved verbatim** before any remediation begins.
3. A corpus floor/ratchet assertion may only ever be lowered with an explicit,
   evidence-cited, in-code comment explaining it as a correctness correction.
4. All standing correctness rulings remain in force: RISK-043 loop/reassignment refusal
   safety; the `ta.valuewhen` execution boundary; cumulative-level rulings; arbitrary-source
   `ta.cci` classification; bounded-history safety; parameter trust; data-requirement truth;
   vendor-parity qualification; JS/Python conformance separation; truthful refusal behaviour.
5. Compatibility is never broadened by silently changing what a Pine script means.

---

## 9. AMENDMENTS

Append only. Each amendment must be dated, must state what changed, and must state why the
change is not a post-hoc adjustment made to improve a measured number.

### A-1 (2026-09-07) — REFUSAL ACCURACY becomes a reported metric

**What changed.** §4's `CORRECTLY_REFUSED` requires a refusal that "names a real construct the
engine genuinely cannot faithfully reproduce, **and does not mischaracterise it**." The first
baseline run produced refusals that satisfy the first half and fail the second, and the
vocabulary had no way to say so. Two shapes were found, both by reading the baseline output:

1. **Mischaracterised refusal.** Four scripts refuse with `pine:character` — *"Pine has no
   character like this one"* — on lines of entirely valid Pine v6 containing no non-ASCII
   character at all. Isolated by direct probe: a **member access on a call result**
   (`arr.get(0).v`, `a.slice(0,1).size()`) trips the lexer's character guard. The refusal is
   correct that it cannot proceed and wrong about why, and the sentence it shows would lead a
   member to believe their script is corrupt.
2. **Silent decline.** One script returns `ok:false` with `refusal: null` — no message at all.
   Its only `plot()` is the `plot(0)` placeholder that table-drawing indicators conventionally
   carry; the engine correctly detects it reads no bars and correctly declines to offer it as a
   column, then says nothing.

**The change.** REFUSAL ACCURACY is now reported alongside the outcome metrics: of all
refusals, how many name the real cause, how many mischaracterise it, and how many are silent.
Scripts in categories 1 and 2 continue to be counted as refusals for acceptance accounting —
nothing false is presented as true, and no wrong number reaches a user — but the truthful-outcome
rate must be reported **twice**: once for "did the product tell the truth about *whether* it
worked" and once, stricter, for "did it also tell the truth about *why*".

**Why this is not a post-hoc adjustment to improve a number.** It moves the headline the other
way. Under the loose reading the baseline's truthful-outcome rate is 98.3%; under the strict
reading it is 91.7%. The amendment exists because the vocabulary could not express a defect that
was found, and the honest response to that is a new metric that costs us, not a definition that
absorbs it.
