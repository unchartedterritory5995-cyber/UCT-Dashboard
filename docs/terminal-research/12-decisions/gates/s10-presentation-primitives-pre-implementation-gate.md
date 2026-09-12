---
id: GATE-S10-PRESENTATION-PRIMITIVES
title: S10 — Presentation Primitives — pre-implementation gate
role: the approval packet for S10's first build. Nothing builds past the scope on the approval line.
status: ✅ APPROVED 2026-09-12 — primitives only, adopted by S8's four and nothing else. BUILT AND MERGED the same day.
date: 2026-09-12
measured_against: origin/master @ ee9c96fa1
---

# ✅ APPROVED — the five primitives, adopted by S8's four components and nothing else

## ⛔ APPROVAL

```
APPROVED BY:      Patrick (owner), via Claude Chat middleman
APPROVED ON:      2026-09-12
APPROVED AT SHA:  c8ddd1455   (git hash-object of this packet
                  as it stood at approval, with this field blank)
SCOPE APPROVED:   primitives only — number, percent, currency,
                  date/time-with-session, freshness — as pure
                  components/functions; adopted by S8's existing components
                  (Provenance, FreshnessBadge, Cited, CoverageLine) and nothing
                  else; no other consumer migrated; no member-visible layout
                  change; snapshot tests prove S8 renders byte-identical before
                  and after adoption.
```

**Delivered:** `3c539d011` on `origin/master`, 2026-09-12. ADDITIVE — nine changed files, all
under `app/**`, zero in flow-worker's 154-file import closure, confirmed with `reachable_paths()`
rather than assumed. No marker bump.

---

## 1. What S10 is, and why it could be built this weekend

`product-architecture.md`'s S10 block — *"one number/percent/date/time formatter… 118 files define
their own today"* (TD-08). It had no PRD and no spec, and was confirmed unbuilt by direct search
during S8 Step 2's dependency check on 2026-09-02.

⭐ **AND THE MIGRATION WAS ALREADY WRITTEN DOWN, IN THE CODE, BY THE ENGINEER WHO WROTE THE
INTERIM.** `app/src/components/provenance/presentationFormat.js`'s header, unchanged since
2026-09-02:

> *"⚠️ NOT S10. … When S10 ships, `<Provenance>`/`<FreshnessBadge>` swap onto it (SPEC-S8 §19 Step
> 2's own stated migration) and this file is deleted, not generalized."*

This packet's whole build is that swap. **It ratified a plan; it did not make one.**

---

## 2. ⛔ THE FINDING THE ADOPTION SURFACED — one formatter, two files, one field apart

Read from the four components before touching them:

| where | function | renders |
|---|---|---|
| `presentationFormat.js` | `formatEtTime` | `9:32:15 AM` — ET, **with seconds** |
| `FreshnessBadge.jsx` | `formatAsOf` | `9:32 AM` — ET, **without seconds** |
| `CoverageLine.jsx` | `n` | `3,742` — `toLocaleString('en-US')` |
| `Cited.jsx` | `epochToLocal` | `9/11/2025, 8:32:15 AM` — **the VIEWER's timezone** |

⭐ The first two are the SAME formatter differing by a single field, in two files, inside one
four-component directory. **That is the S10 case at the smallest scale it can occur**, and it was
invisible because each file's version looked correct on its own.

### 2.1 ⚠️⚠️ AND ONE OF THEM IS A REAL DEFECT THAT IS NOT FIXED HERE

`<Cited>` renders its `Validated:` timestamp in the **viewer's** timezone while `<Provenance>` and
`<FreshnessBadge>` pin **ET** a few pixels away — and **neither carries a zone label**, which is
the half that makes it invisible. A member outside ET reads one S8 surface in two timezones and is
told about neither.

⛔ **IT IS NOT FIXED BY THIS BUILD, DELIBERATELY.** The approval's own condition is *"no
member-visible layout change; snapshot tests prove S8 renders byte-identical before and after
adoption."* Changing that zone moves a rendered string for every member outside ET — precisely the
class of change the byte-identity condition exists to forbid.

**It is recorded in three places so it cannot be mistaken for an oversight:**
`presentationPrimitives.js`'s header, `Cited.jsx`'s own ⚰️ block, and a test that goes red if
somebody "tidies" the divergence away without a decision.

> **⛔ IT NEEDS ITS OWN APPROVAL LINE. It is the first thing S10's next line should consider.**

---

## 3. How byte-identity was proved — an ORACLE, not a snapshot file

The approval says "snapshot tests". **A committed snapshot file could not have proved this, and
saying so is part of the delivery rather than a deviation from it.**

Three of the four replaced formatters are timezone- and locale-sensitive and one renders in the
VIEWER's zone, so a stored expected-string is a fact about the machine that generated it. Run the
suite in another timezone and a green snapshot turns red for a reason that is not a regression —
`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail` wearing a fixture's clothes.

⭐ **So the oracle is the deleted code itself, frozen verbatim in the test files and run in the same
process.** The assertion is `newFn(x) === oldFn(x)` across a wide input matrix — ordinary values,
DST boundaries, the ambiguous fall-back hour, and every shape of "no value" the app produces — and
it is true in **every timezone at once**, which is the claim the approval actually makes.

Two proofs, because they fail for different reasons:

| file | proves |
|---|---|
| `presentationPrimitives.test.js` | the FUNCTIONS agree, input by input |
| `s10Adoption.test.jsx` | the COMPONENTS still put those strings on screen — a component can adopt the right primitive and still move a character by dropping a literal or losing a conditional guard |

⚠️ **`<FreshnessBadge>` did exactly that kind of surgery**: the words *"as of"* and the label *"ET"*
moved OUT of the JSX and INTO the primitive's return value. The render test is what makes the
resulting equality a measurement rather than an argument.

---

## 4. Mutation proof — four, each restored by EDIT

| # | mutation | result |
|---|---|---|
| 1 | `seconds` option ignored | **6 RED** across both test files |
| 2 | the `real_time` as-of suppression removed | **3 RED** |
| 3 | a raw `toLocaleString` put back into a component's CODE | **1 RED**, naming the file |
| 4 | the comment stripper neutered | **6 RED** — the rail reads its own prose |

⛔ Mutation 4 is the one worth keeping in mind: every file in that directory *discusses*
`toLocaleString` at length, including the retired implementations quoted verbatim in ⚰️ blocks. A
grep-based rail would be permanently red on its own documentation. **CODE, NEVER PROSE**, with a
control proving the stripper still sees real code.

---

## 5. ⚠️ TWO HONEST DEVIATIONS FROM THE OBVIOUS READING OF THE SCOPE

Both were judgement calls made inside the approval's boundary, and both are flagged rather than
buried.

### 5.1 `presentationFormat.js` was NOT deleted, correcting its own plan

Its header said *"used only by this component family"* and said it would be deleted. Measured
2026-09-12, `epochSecondsToIso` has **four importers outside S8's four components**:
`ProvenanceDemo.jsx`, and the research tabs `AnalystRatingsTab.jsx`, `NewsTab.jsx`,
`OwnershipTab.jsx`.

⛔ **Deleting it would have migrated four consumers under cover of a refactor**, which the approval
forbids in those words. So it survives, narrowed: `formatEtTime` is gone (its only caller moved),
`formatPrice` now delegates to S10's `formatCurrency` rather than holding a second copy of the same
three lines, and `epochSecondsToIso` is untouched. **No importer changed, no signature changed, no
rendered character changed.**

⚠️ One consequence, recorded: a comment in `pages/research/tabs/AskAiTab.jsx:48` still names
`formatEtTime`. Out of scope to edit; the function moved rather than died, and this line is so the
next reader knows which.

### 5.2 `formatPercent` ships DECLARED AND ADOPTED BY NOTHING

The approval names five primitives. **Four had an adopter inside the approved scope. The percent one
does not** — not one of `Provenance`, `FreshnessBadge`, `Cited` or `CoverageLine` renders a
percentage.

⛔ It was built anyway, because the approval asked for five, and the consequence is said out loud
rather than shipped quietly: `presentationSingleFormatter.test.js` carries
`⚠️ formatPercent is DECLARED AND ADOPTED BY NOTHING`, which goes **RED the moment somebody adopts
it**. The next reader is forced to come to that test, delete it, and record that the state changed —
instead of the fact quietly becoming false. ⭐ That is
`lesson_built_tested_green_and_unreachable` caught in the act and written down.

**The named first consumer, when a line authorizes it:**
`components/chart/drawingLabels.js::formatPercent`.

---

## 6. ⛔⛔ THE BIGGEST THING S10 FOUND, AND IT IS OUT OF SCOPE

**There is a SECOND `formatPrice` in this app with a different contract.**

| | `provenance/presentationFormat.js` | `chart/drawingLabels.js` |
|---|---|---|
| renders | `"$12.50"` | `"123.46"` |
| currency symbol | yes | no |
| decimals | fixed 2 | **tick-aware**, up to 6 |
| absent value | `—` (em dash) | `""` (empty string) |
| importers | 1 | **6** (`PlanTradeSheet`, `journalSection`, `StopConfirmSheet`, `drawingRenderers`, + tests) |

⭐ And `drawingLabels.js`'s own comment calls it *"already the one place in the app that knows how a
price is rendered"* — **a sentence that has been false for as long as the other one has existed.**
It is the `lesson_a_comment_claiming_agreement_is_not_agreement` shape exactly.

⛔ **RECONCILING THEM IS NOT IN THIS SCOPE AND MUST NOT BE SMUGGLED IN.** They disagree on the
currency symbol, the decimal rule AND the absent sentinel, so every one of those six call sites
would move visibly. **It is the first migration S10's next line should consider**, and it is a
member-visible change that needs its own approval.

---

## 7. What was delivered, measured

| | |
|---|---|
| new | `app/src/lib/presentation/presentationPrimitives.js` — five pure functions, **zero imports** |
| rails | `presentationPrimitives.test.js` (25) · `s10Adoption.test.jsx` (16) · `presentationSingleFormatter.test.js` (12) |
| adopted | `Provenance.jsx`, `FreshnessBadge.jsx`, `Cited.jsx`, `CoverageLine.jsx`, `presentationFormat.js` |
| suite | **335 passed / 20 files**, VITEST_EXIT=0, across `lib/presentation`, `components/provenance`, `components/screener` and `ProvenanceDemo` |
| classification | **ADDITIVE** — 9 files, all `app/**`, 0 in flow-worker's closure (confirmed, not assumed) |
| merge | `3c539d011` |

⚰️ One ⚰️ correction taken in passing: `provenance/CoverageLine.jsx`'s first line read
`app/src/components/screener/CoverageLine.jsx` — the path it had before S8 Step 1 moved it. That
path still exists as a thirteen-line re-export shim, so following the stale comment landed a reader
on the shim instead of the file.

---

## 8. What a future S10 line would need to name

1. **The `<Cited>` timezone divergence** (§2.1) — member-visible, and the clearest defect S10 found.
2. **The two `formatPrice`s** (§6) — six call sites, three disagreements.
3. **`formatPercent`'s first consumer** (§5.2).
4. **Everything beyond the S8 family.** TD-08's "118 files" is an inherited count this pass did not
   re-measure, and it should be re-measured before it sizes anything.
