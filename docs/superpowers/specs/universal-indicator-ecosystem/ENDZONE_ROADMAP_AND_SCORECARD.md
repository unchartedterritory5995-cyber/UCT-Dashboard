# ENDZONE ROADMAP + MARKETABILITY SCORECARD

Built from the OOS-2 baseline (`OOS_2_REPORT.md`, freeze `5df718c2`) and the code-verified gap
register (`ENDZONE_GAP_REGISTER.md`). Ordering is derived from measured evidence, not from a
preferred plan.

---

## PART 1 — THE MARKETABILITY SCORECARD

Ten dimensions. Each is graded against evidence, and **no dimension is graded from a green unit
test alone**. Grades: ✅ ready · 🟡 partial · 🔴 not ready · ⬜ unmeasured.

| # | Dimension | Grade | Evidence |
|---|---|---|---|
| A | **REAL-WORLD COMPATIBILITY** | 🔴 | 18/60 (30%) raw acceptance on a blind corpus; 23% at V5, which is 72% of real indicators |
| B | **CORRECTNESS** | 🟡 | 3/60 silent false successes (5%), all one failure mode; but every stateful construct in 21 accepted scripts was correctly refused, not folded |
| C | **COMPLEX VISUAL FIDELITY** | 🔴 | Presentation discarded at the door: `overlay` read 0 times in 8,457 lines; objects (43/60 scripts, 1,204 sites) absent; `fill` (17/60) schema-inert; dynamic colour (40/60) partial |
| D | **PARAMETER FIDELITY** | 🟡 | 17/18 accepted scripts carry discovered params — the strongest link; edit/save/reopen **unverified** |
| E | **SAVE / REOPEN** | ⬜ | Not measured this session. Also gap P-01: the original Pine source is not persisted at all |
| F | **SCREENER INTEGRATION** | 🔴 | 6/60 (10%) reach a screenable boolean; numeric screening is 0 by construction; `scan_hits.value` can only ever be 1.0 (S-03) |
| G | **USER-FACING IMPORT UX** | 🔴 | No FULL/PARTIAL fidelity verdict exists; disclosure exists but `pine:declaration` fires on ~every script so the signal carries no information (U-01) |
| H | **PERFORMANCE** | ⬜ | Not measured. Layer A runs 60 scripts in ~2s, which says nothing about production |
| I | **FAILURE TRANSPARENCY** | 🟡 | 34/38 refusals name the real cause; 4 misdescribe it as an impossible character; 1 declines silently |
| J | **REGRESSION SAFETY** | 🟡 | Strong existing net (115 files / 2,174 tests in the AST dir); OOS corpus now frozen and re-runnable; no ratchet on it yet, deliberately |

### The gate, stated as a decision

**The marketable claim "Bring your TradingView indicators into UCT" is NOT earned today.** Four
of the ten dimensions are 🔴, two are unmeasured, and the minimum bar the protocol sets —
*zero known silent-wrong-result defects in the supported marketable surface* — is not met (3 known).

### Claim tiers, matched to demonstrated capability

| Tier | Claim | Earned? |
|---|---|---|
| **1** | *"Paste a Pine formula and screen with it."* | ✅ **Earned today** for the narrow case — with the caveat that only 10% of real indicators reach the screener, so this must not be worded as "your indicators" |
| **2** | *"Import supported Pine indicators, and be told plainly what did and didn't come across."* | ✅ **EARNED (2026-09-07, after C0R + C1).** 13 of the 18 accepted OOS scripts complete the whole journey — import, apply, save, render, reopen byte-identical — and the 5 that do not are each blocked with a NAMED reason the member can read. Multi-output, per-plot styling, levels, placement, member inputs, conditional colour and bands all carry. |
| **3** | *"Import most common Pine indicators with their visuals."* | 🔴 **NOT earned.** Two-way conditional colour and plot↔plot bands draw; N-way colour (8 rows), colour-as-visibility (16 rows) and `plotcandle` payloads (12 rows) do not, and 16 of 18 accepted scripts remain VISUALLY PARTIAL. |
| **4** | *"Bring sophisticated TradingView indicators into UCT."* | 🔴 Needs the object model (Wave E); this is the tier the governing objective actually names |

**Recommendation as of 2026-09-07 (after C0R, C1 and C2): Tier 2 may be claimed,
and Tier 3 may not.**

⛔ **C2 DID NOT MOVE THE TIER AND WAS NOT SUPPOSED TO.** Capacity work removes
blockers; it does not add visual fidelity. `master-line-lite` went from seven dead
columns to three drawn ones, and the corpus counts stayed 13/2/2/1. Promoting on
"capacity blockers disappeared" would be exactly the unearned claim the tier table
exists to prevent.

⛔ **AND THE TIER-2 WORDING MUST CARRY ITS OWN CAVEAT.** "Import supported Pine
indicators" is earned only because *"and be told plainly what did and didn't come
across"* is the other half of the sentence — that half is doing real work here, and
dropping it in a headline turns an earned claim into an unearned one.

⛔ **NEVER SAY "WITH THEIR VISUALS" (Tier 3) ON THE STRENGTH OF C1.** A script can
complete the full journey and still be VISUALLY PARTIAL; the two are different
measurements and the register (Part E) keeps them apart. `FULL_JOURNEY_PASS` is not
visual parity and no marketing sentence may treat it as such.

---

## PART 2 — THE DEVELOPMENT WAVES

Ordered by the protocol's stated priority: silent-wrong-result severity first, then scripts
affected, then visual-fidelity leverage, then journey completeness, then architectural leverage.

### WAVE A — CORRECTNESS AND HONESTY (small, highest severity)

Everything here is a defect, not a feature. All are S1/S2 and none is large.

| Item | What | Evidence |
|---|---|---|
| A1 | **Fix `readsBars`** — a `call` node must not assert bar-reading without inspecting its arguments | `pine.js:8175`; probe: `readsBars(max(8,42)) === true` |
| A2 | **Acceptance must require content** — `ok` should not rest on outputs that carry no information from the source (constants; bare-OHLC `plotcandle` passthrough) | 3/60 silent false successes, all this shape |
| A3 | **Fix the mischaracterised refusal** — `f(...).field` must refuse as an unsupported construct, not as an impossible character | 4/60 scripts; probe-isolated |
| A4 | **Never decline silently** — `ok:false` with `refusal:null` must be impossible | 1/60; `plot(0)` placeholder case |
| A5 | **Adjudicate S-03** — `scan_hits.value` can only ever be `1.0` while the UI presents it as a sortable magnitude | code-read, not yet confirmed at runtime |

**Exit:** zero known silent-wrong-result defects; every refusal names its real cause; OOS-2
re-run shows SILENT_FALSE_SUCCESS = 0. Ratchet the OOS corpus at that point, not before.

### WAVE B — CARRY THE PRESENTATION (highest leverage per unit of work)

The renderer already draws every target here. This is an importer and handback change.

| Item | What | Renderer ready? |
|---|---|---|
| B1 | Extract a per-output visual spec in the translator (`overlay`, `color`, `linewidth`, `style`, `title`, `transp`, `display`, `offset`) | — |
| B2 | Carry it through the handback into `buildDefinition` | — |
| B3 | Map `overlay=` → `placement.target` | ✅ |
| B4 | Map colour / width / style / title / opacity → `plots[i]` | ✅ |
| B5 | Map `hline()` → the schema's first-class `hlines` plot + `levels` | ✅ |
| B6 | **Multi-output handback** — hand back the whole indicator, not one plot at a time | ✅ (`compute.trees` exists) |
| B7 | **Import UX**: a FULL / PARTIAL fidelity verdict; disclosure that distinguishes "ignored your declaration line" from "dropped your fill"; say which outputs are screenable *before* saving | — |
| B8 | **Persist the original source** (one column) so an improved translator can re-translate | — |

**Why B is second and not first:** it is the largest fidelity gain available without new
rendering code, it directly removes the `plotcandle` half of the A2 defect, and B8 removes the
permanent penalty of importing under a translator that is about to improve.

**Exit:** an imported indicator arrives with its own pane placement, colours, widths, styles and
levels, as one document; the member is told plainly what did and did not come across. This is
where **Tier 2** becomes claimable.

### WAVE C — UN-INERT THE DECLARED VISUALS

| Item | Demand | State |
|---|---|---|
| C1 | `colorMode:'column:<key>'` — general per-bar colour | **40/60 scripts** | validated, inert |
| C2 | `plots[].fill{with}` renderer | 17/60 scripts | validated, cross-checked, drawn by nothing |
| C3 | `plots[].edges` — real bands rather than three coincidental lines | — | validated, unread |

All three are already schema-legal and validated. **Six ISeriesPrimitive/IPanePrimitive
implementations already exist in this codebase** for non-indicator features — the machinery is
present, it is simply not reachable from a definition.

### WAVE D — THE MISSING VISUAL PRIMITIVES

`bgcolor`/`barcolor` (17/60) · `plotshape`/`plotchar`/`plotarrow` glyph + anchoring + direction
(19/60) · `plotcandle`/`plotbar` as actual candles (5/60) · per-plot placement (V-25).

### WAVE E — THE OBJECT MODEL (the wall)

`label` / `line` / `box` / `table` / `polyline` / `linefill` — **43/60 scripts, 1,204 call sites,
and the direct cause of the 7 `pine:no-output` refusals.** This is the single largest
compatibility item in the register and the one that stands between Tier 3 and Tier 4. It needs a
persistent-graphical-object model in the schema, an execution model for objects created/mutated/
deleted across bars, and a renderer. It should not start before Waves A–C have shipped, because
its cost is large and its prerequisites are all in those waves.

### WAVE F — LANGUAGE AND EXECUTION GAPS SURFACED BY OOS

Ordered by measured blocker counts: `pine:function` unserved builtins (8) · method-call/UDT
syntax `f(...).field` (4, shares a fix with A3) · tuple destructuring `[a,b] = f()` (3) ·
`pine:state` (3) · `pine:request` MTF (2, and 12/60 scripts demand it) · user-defined function
shapes (2).

### WAVE G — SCREENER PROJECTION

Numeric series addressable by a scan (S-01) · per-plot addressing, which the **alert** lane
already has and the screener does not (S-02) · thread `inputs` into `scan_evaluator` (S-04).

### WAVE H — BUILDER PARITY

Every row of the builder table reads *engine ✅ / import ❌ / builder ❌*. Once Wave B carries
presentation and Wave C renders it, expose the same fields in the builder so the capability is
user-facing rather than internal-only.

### WAVE I — VALIDATION AND REGRESSION

Layer C browser suite over the Complex Pine Visual Parity Set (chart render, pane, fills,
colours, input propagation, save/close/reopen) · vendor comparison against TradingView for that
set · production-like performance evidence · OOS ratchet once Wave A closes.

---

## PART 3 — FIRST RECOMMENDED IMPLEMENTATION WAVE

**Wave A, then Wave B, as one authorisation.**

Reasons, each traceable to measured evidence:

1. Wave A is entirely defect repair, is small, and closes the only three silent-wrong-result
   cases in the corpus. The protocol ranks silent wrong result above everything else.
2. A1 and A2 are *prerequisites for trusting any future number* — while `readsBars` asserts that
   `max(8,42)` reads bars, every acceptance rate this program reports is inflated by an unknown
   amount.
3. Wave B is the highest fidelity gain per unit of work anywhere in the register, because the
   renderer is already capable of every target. It also removes the `plotcandle` half of A2 at
   the root rather than patching the symptom.
4. B8 (persist the source) should land before, not after, the translator improves — otherwise
   every indicator imported between now and then is permanently frozen at today's fidelity.
5. Together they are what makes **Tier 2** claimable, which is the first honest marketing
   sentence this product can say about indicator import.

**Explicitly not first:** Wave E (the object model). It is the biggest compatibility item and it
is tempting precisely because it is 43/60 scripts — but starting there would build an object
renderer for a pipeline that still discards `overlay=` and still accepts indicators on the
strength of a passthrough of the price bars.

---

## PART 4 — WHAT COULD PREVENT REACHING THE OBJECTIVE

Stated plainly, because the objective is ambitious and two of these are structural.

1. **The object model is a genuine architecture project**, not a feature. 43/60 scripts need it.
   Until it exists, "sophisticated TradingView indicators" is not reachable at any acceptance
   rate, no matter how much the language layer improves.
2. **The screener's boolean-only gate is a product decision, not a bug** — but it means a
   numeric indicator can never be screened as a value. Reaching the stated objective
   ("useful screener outputs intact") requires revisiting that gate deliberately.
3. **`closedTable.json` has no multi-output node.** Multi-plot exists only at document level.
   That is workable, but it means an indicator is always N documents' worth of trees rather than
   one object, and every downstream consumer must agree on that.
4. **The 48-script corpus cannot validate this work.** It is 100% V1. Any future claim about
   indicator fidelity must be measured on OOS-1 or a successor; the old corpus can only serve as
   a regression net.
5. **Vendor parity for visuals has no oracle yet.** Numeric parity has a captured-vendor
   methodology; "does this fill mean the same thing as TradingView's fill" does not, and the
   Complex Pine Visual Parity Set is the proposed instrument but has not yet been run against
   TradingView.

---

# POST-WAVES-A+B UPDATE (2026-09-07)

Measured on the same frozen corpus (`5df718c2`). Baseline preserved unchanged.

## Scorecard movement

| # | Dimension | Before | After | Why |
|---|---|---|---|---|
| A | REAL-WORLD COMPATIBILITY | 🔴 | 🔴 | 18/60 unchanged — Wave A removed 3 false acceptances rather than adding real ones. **This is the honest direction.** |
| B | CORRECTNESS | 🟡 | ✅ | 3 → **0** silent false successes; truthful outcome 93.3% → **100%** on all four corpora |
| C | COMPLEX VISUAL FIDELITY | 🔴 | 🟡 | `overlay` 0 → 49/60 · levels 0 → 10/60 · per-output styling 0 → 16/18 accepted. Objects/fills/shapes still absent |
| D | PARAMETER FIDELITY | 🟡 | 🟡 | unchanged (17/18); edit/save/reopen still unverified |
| E | SAVE / REOPEN | ⬜ | ⬜ | still unmeasured; P-01 (source not persisted) still open |
| F | SCREENER INTEGRATION | 🔴 | 🔴 | untouched by design (B18) |
| G | IMPORT UX | 🔴 | 🟡 | uncarried presentation is now *reported* (`colorDynamic`, `styleUncarried`); no FULL/PARTIAL verdict yet |
| H | PERFORMANCE | ⬜ | ⬜ | not measured |
| I | FAILURE TRANSPARENCY | 🟡 | ✅ | silent decline eliminated; two new guards name outcomes previously expressed as silence |
| J | REGRESSION SAFETY | 🟡 | ✅ | 27 new permanent cases incl. a mutation control; OOS corpus re-runnable |

**The marketable claim is still not earned.** A and F remain 🔴 and E/H unmeasured.
Tier 1 remains the honest ceiling, still without the word "indicators".

## Wave C requirements, as they now stand

1. **The object model** — `label`/`line`/`box`/`table`/`polyline`/`linefill`.
   43/60 scripts, 1,204 call sites, and the direct cause of 8 `pine:no-output`
   refusals. Unchanged by A+B and now the single largest item.
2. **Dynamic colour** — `colorMode:'column:<key>'` un-inerted. Wave B measured the
   demand exactly: **47 output rows across the accepted scripts** carry a
   conditional colour that is reported and not drawn.
3. **`fill` renderer** — 17/60 scripts; schema-validated and drawn by nothing.
4. **Shapes with glyph and anchoring** — 19/60; value-only today.
5. **`plotcandle` as a real candle series** — Wave A refuses the all-bare case
   truthfully; only a secondary OHLC series makes it an import.
6. **23 `styleUncarried` sites** — mostly `plot.style_cross`, awaiting a marker
   primitive LWC does not provide natively.

## Recommended next wave

**Wave C1 — dynamic colour + fill**, in that order. Both are schema-declared and
inert, both have measured demand (47 rows / 17 scripts), and both are renderer
work inside an existing, validated vocabulary — no new object lifecycle. That
keeps the object model (the genuine architecture project) behind the two cheapest
remaining fidelity wins.
