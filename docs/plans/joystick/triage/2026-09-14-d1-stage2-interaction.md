# The D1 / stage-2 interaction — does a stage-1 answer survive the ring swap?

**Question.** `owner-run.md` row **D1** asks whether the **Wire** bubble is visually
distinguishable from the **Journal** bubble. Stage 2 empties `PREVIEW_MODES`, and for `home` that
is not a no-op: **Wire moves inner → OUTER, Journal moves OUTER → inner**. So an answer collected
on stage-1 glass describes a layout stage 2 changes.

⛔ **Nothing here ticks, alters or pre-judges box 2.** Three questions, answered with provenance.
Patrick rules.

---

## 0 · First, an identifier collision that has to be cleared before anything else

**There are two different "D1"s in this programme**, and conflating them produces a false finding:

| where | D1 is | |
|---|---|---|
| `owner-run.md:247` | `\| D1-eye \| G3-16(a) \| Dashboard, open Home's fan. **Cover the labels.** Can you tell the **Wire** bubble from the **Journal** bubble by sight alone?` | ← **this row** |
| `glass-acceptance-steps.md:192` | `\| D1-a11y \| **The no-drag door** \| With **VoiceOver** (iOS) / **TalkBack** (Android) running, reach the Actions button…` | a different check entirely |

The Wire-vs-Journal question's real name is **G3-16**, and its ledger row is **D-27**.
`glass-acceptance.md:172` — `| G3-16 | **Wire vs Journal in Home's fan** (D-27) | …`

⚠️ **Related misreference, found in passing.** `deferred.md:52` (D-27) says *"the switch is
`glass-acceptance.md` **G3-15**, not this row."* It is **G3-16**. `glass-acceptance.md:171` is
G3-15 = *"Chip vs Actions button — a PRE-EXISTING overlap in declared geometry"*. A reader
following D-27 lands on the chip row and finds no switch. One-character fix, **not made here** —
it is inside a struck row and belongs to whoever next edits that ledger.

---

## (a) Does box 2's acceptance criterion depend on D1? Does a stage-1 answer satisfy it?

### It depends on it — yes, and by name.

`closure.md` box 2, quoted:

> **Glass acceptance passed on ≥ 1 notched iOS device and ≥ 1 Android.**
> `glass-acceptance.md`, **every block**, including the surfaces Increments 3–7 added.

and, in its evidence paragraph:

> **`glass-acceptance-steps.md`, 96 rows, DERIVED** from the registry … every mode's
> Primary/Reverse/Scrub binding and every fan action, **plus D4 and D1 where an operator meets
> them** …

G3-16 is a block of `glass-acceptance.md`, and box 2's criterion is *every block*. The derived
sheet says so explicitly:

> **Judgement rows live in `glass-acceptance.md` and are not duplicated here** — G3-15 (the
> chip/Actions-button overlap) and **G3-16 (Wire vs Journal colour confusability)** ask a human a
> question no generator can phrase.

⭐ And operationally the dependency is stronger than the prose: `hub_owner_intake.py`'s
`box_two()` counts **every row whose id starts B, C, D or E** in `owner-run.md`. Row D1 is one of
27. **An unmarked or failing D1 alone makes box 2 NOT TICKABLE.**

### Does a stage-1 answer satisfy it? — Split, and the split is the point.

**On the colour axis: yes.** The two accents are **byte-identical on both sides**:

| token | master (stage 1) | branch (stage 2) |
|---|---|---|
| `--hub-mode-journal` | `#4FB833` (`tokens.css:426`) | `#4FB833` |
| `--hub-mode-wire` | `#9FE887` (`:427`) | `#9FE887` |
| `--hub-mode-wire` `[data-hub-contrast="high"]` | `#D4FEE4` (`:630`) | `#D4FEE4` |

Stage 2 changes **no colour**. The registry entries differ **only** in `ring`. So the thing
G3-16/D-27 exists to decide — whether to promote the high-contrast Wire token into `:root` — is
untouched by stage 2.

**On the spatial axis: not cleanly — and one part of it has never been looked at by anybody.**

The question is asked with the **labels covered**, so position is part of what the eye uses. Ring
membership, derived by importing the registry from both refs:

| ring | stage 1 (projected) | stage 2 (projected) |
|---|---|---|
| 0 — OUTER | scan · chart · flow · breadth · **journal** | scan · chart · **breadth** · **wire** · flow |
| 1 — inner | notebook · **wire** · calendar · voice | **journal** · notebook · calendar · voice |

⭐ **Wire and Journal are in *different* rings at both stages** — they trade places rather than
collide. So the Wire-vs-Journal judgement most likely survives on its own terms: whatever
separated them at stage 1 (colour, plus "different ring") still separates them at stage 2.

⛔ **But the neighbour D-27's own measurement worries about does not exist at stage 1.** D-27,
quoted (`deferred.md:52`):

> *"it also drops Wire's worst dE00 neighbour to 7.71 by moving onto **Breadth** (`#5dcaa5`),
> which **shares ring 0 with Wire**"*

That adjacency is a property of the **declared** fan — i.e. **stage 2**. At stage 1
`home.wire` is in the **inner** ring, sharing it with notebook, calendar and voice, and
**never shares a ring with Breadth at all**. The colour instrument and the human eye have been
pointed at two different arrangements, and the one the eye has seen is the one that is going away.

### Recommendation — a caveat, not a re-run

> **Box 2 does not need a stage-2 re-collection of D1 to be satisfiable**, because the colours are
> byte-identical and Wire/Journal remain ring-separated. **It does need a recorded caveat**, in
> these terms:
>
> *"D1 / G3-16(a) was collected at stage 1. The accent tokens are byte-identical at stage 2, so
> the D-27 promotion decision transfers unchanged. What does NOT transfer is the arrangement: at
> stage 2 Wire moves to the outer ring beside **Breadth**, the neighbour D-27's own dE00
> measurement names as its worst case, and that pairing has never been judged on glass. If the
> stage-1 answer was **CONFUSABLE**, do not act on the decision table until it is re-collected
> after the swap."*

⛔ Whether that caveat is sufficient, or whether box 2 must carry a hard re-collect, is an owner
ruling. This document does not tick, alter or pre-judge box 2.

---

## (b) Do `stage-2-verification.md` steps 0–9 re-run D1 after the swap? — **No. That is a gap.**

Steps 0–9 contain **no check of the fan's geometry at all**. Step 5's rows, quoted in full:

| # | check |
|---|---|
| 5a | chip hint on a preview-less mode |
| 5b | coach mark |
| 5c | **Hide** from the Actions sheet → reload |
| 5d | Settings → Charts → JOYSTICK toggle |
| 5e | edge tab |

A grep of the whole document for `wire`, `journal`, `ring`, `bubble`, `fan`, `distinguish` or
`confus` returns **no check** — only the chip-hint correction and the admin-vs-member caveat.

**So a member-visible layout change ships with no post-swap visual check.** The draft step that
closes it is added to `stage-2-verification.md` as **§5A · DRAFT**, marked DRAFT, with existing
steps left unrenumbered.

---

## (c) Does this belong on the ledger? — Yes, and it is not covered by an existing row.

- **D-39** is *"The chip yields to page-level fixed furniture"*, scoped to `HubChip.jsx`. That is
  the **chip** against page furniture — not the **fan's** ring assignment.
- **D-27** (struck, SHIPPED-CONDITIONAL) is about the **colour token**. Stage 2 changes no colour.

Neither owns a geometry change. Draft row for `deferred.md`, **owner unassigned**, tagged
**needs owner ruling** — not filed:

| D-49 | **Home's fan swaps Wire and Journal between rings at stage 2, and the colour evidence was measured against the post-swap arrangement** | `app/src/hub/registry.js` (joystick) · `glass-acceptance.md` G3-16 | ⏳ **NEEDS OWNER RULING — do not act.** Stage 2 empties `PREVIEW_MODES`; for `home` that is not a no-op: `home.wire` moves **inner → OUTER**, `home.journal` **OUTER → inner**. Nine bubbles either way, none added or removed, Calendar surviving — a **layout** change, member-visible the moment stage 2 merges. ⛔ G3-16 / D-27's colour measurement names Wire's worst neighbour as **Breadth** (`#5dcaa5`), *"which shares ring 0 with Wire"* — true of the **declared** fan, i.e. stage 2. At stage 1 Wire sits in the **inner** ring and never shares a ring with Breadth, so the measurement and the owner's eye describe different arrangements. ⚠️ Wire and Journal are ring-separated at **both** stages, so that pairing's judgement probably survives; **Wire-vs-Breadth has never been judged on glass by anybody.** ⭐ No claim that the colours are wrong: tokens are byte-identical at both stages and `validateRegistry()` returns 0 problems on both. What is missing is a post-swap look — see `stage-2-verification.md` §5A DRAFT. **Owner questions:** (1) does a stage-1 G3-16(a) answer satisfy box 2, or does box 2 carry a *"collected at stage 1, re-collect at stage 2"* caveat? (2) should §5A become a real step 5f? (3) is Wire-vs-Breadth in scope for G3-16, or a new row? |

---

## Provenance index

| claim | evidence |
|---|---|
| owner-run D1 = G3-16(a) = Wire vs Journal | `owner-run.md:247` |
| a different D1 exists in the derived sheet | `glass-acceptance-steps.md:192` |
| G3-16 is D-27's switch and lives in `glass-acceptance.md` | `glass-acceptance.md:172`; `glass-acceptance-steps.md:27` |
| box 2 = "every block" of `glass-acceptance.md`, naming D4 and D1 | `closure.md:68,73–77` |
| box 2 tickability counts every B/C/D/E row of owner-run.md | `hub_owner_intake.py::box_two`, `BOX2_PREFIXES` |
| wire inner→outer, journal outer→inner, 9 both ways | `registry.js` imported from both refs; `fanFor(home)` enumerated |
| colours byte-identical | `tokens.css:426,427,630` — identical blobs on both refs |
| D-27 names Breadth as Wire's ring-0 neighbour | `deferred.md:52` |
| steps 0–9 have no fan-geometry check | `stage-2-verification.md` — 5a–5e enumerated above |
| D-39 is the chip, not the fan | `deferred.md:78` |
