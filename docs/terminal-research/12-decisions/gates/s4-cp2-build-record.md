---
id: S4-CP2-BUILD
title: S4 CP2 — build record, signature-ready
role: the evidence an approval line for S4 CP2 is signed against
status: SIGNED (S4-CP2-BUILD, fingerprint 21d6ad3e8)
date: 2026-09-14
---

# S4 CP2 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-17)
APPROVED ON:      2026-09-17
APPROVED AT SHA:  21d6ad3e8
SCOPE APPROVED:   CP2 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> ⛔⛔ **NOT AUTHORIZED.** The gate line is
> **`docs/terminal-research/12-decisions/gates/s4-context-bus-pre-implementation-gate.md`
> §4, id CP2** — whose own text reads *"⛔ CP2 THROUGH CP7 ARE NOT AUTHORIZED"*.
>
> ⛔ **The S4 packet itself is NOT modified by this unit.** Its approval block carries
> CP1's 2026-09-13 signature; a build record for CP2 is a separate file precisely so
> nothing re-signs or perturbs a block that already holds a signature.

⛔ **ZERO live consumers touched.** Docs + rail only, exactly as §4 sizes CP2.

---

## 1 · Why it was opened

| gate | reading |
|---|---|
| Phase 0 §0.7 queue (briefing:315) | `| **S4 CP2** | **READY** | roster at §4 |` |
| S4 packet §4, CP2 | *"Write the ratification down where a reviewer meets it: the promoted authority, the derivation table, the 'an instruction is not a channel' rule (`chartDeepLink.js:13-17`), as a review rule with the derived rail behind it. Docs + rail only."* |
| touches a live consumer? | **NO** |
| revert | **by deletion** |
| size forecast | **S** |

---

## 2 · ⛔ Scope enumeration BEFORE building (F-B-1)

CP2's sentence names four things. Each was resolved by command before a line was written.

| named | told | found | delta |
|---|---|---|---|
| the "instruction is not a channel" rule | `chartDeepLink.js:13-17` | `app/src/lib/chartDeepLink.js`, lines **13–17**, `⛔ Deliberately NOT a new state channel …` | **0** |
| the promoted authority | — | `app/src/hooks/useAppFocus.js` | 0 |
| the derivation table | CP1's measurement | `app/src/lib/context/focusDivergence.js` (117 lines) + its rail (258 lines) | 0 |
| CP1 "BUILT" | packet front-matter | both files present | 0 |

⭐ **And a wider check, because a citation that resolves is not the same as a document
whose citations resolve.** All 20 unique `path:line` citations in the S4 packet were
resolved: **RESOLVES 15 · OUT-OF-RANGE 0 · AMBIGUOUS 2 · FILE-MISSING 3**, where the 3
were a scope bug in the probe (bare `product-architecture.md` needs a recursive docs
search), not staleness. **OUT-OF-RANGE = 0** is the number that matters.

⚠️ **That measurement is why CP2's rail is NOT a citation checker.** A citation gate would
have found nothing to fire on. The new rule refuses a check that cannot fire, so the rail
was pointed at something the repo IS currently on the wrong side of (§4).

---

## 3 · What was built

| artifact | worktree | what it is |
|---|---|---|
| `docs/terminal-research/12-decisions/s4-context-bus-review-rule.md` | docs | the ratification a reviewer reads |
| `app/src/lib/context/symbolLinkChannels.test.js` | code | the derived rail behind it |

⛔ **No file that Packets C, B or F-S2-1 touched is touched here** (§7).

---

## 4 · ⭐ The rail is a GATE because the repo is on the wrong side of the rule

Derived from the authority's own `CHART_LINK_PARAMS` export — never a typed copy — and
swept over every non-test source file with comments stripped.

**Measured 2026-09-14: five hand-typed deep-link reads across three files.**

| file | spelling | standing |
|---|---|---|
| `pages/ChartRender.jsx:232,233` | `sym`, `tf` | headless bot renderer — separate door by design |
| `pages/charts/grid/MultiChartGrid.jsx:52` | `tf` | admin `?gridspike=` perf harness |
| **`pages/journal-2-0/tabs/NotebookTab.jsx:136,570`** | **`ticker`** | ⛔ **F-S4-1** |

### Mutation, both directions, restored by EDIT

| mutation | diff | result |
|---|---|---|
| **A** — a new module hand-types a param | `+ app/src/lib/context/__mutation_probe.js` (4 lines, `.get('symbol')`) | ⛔ **1 failed / 7 passed** — *"NEW hand-typed deep-link read(s): lib/context/__mutation_probe.js"* |
| **B** — a baseline entry that no longer applies | `HAND_TYPED_BASELINE += 'pages/Dashboard.jsx'` | ⛔ **1 failed / 7 passed** — *"pages/Dashboard.jsx no longer reads a deep-link param by hand — remove it … in the same commit that migrated it"* |
| restored by EDIT (probe deleted, baseline reverted) | `git status` → the new test file only | ✅ **8 passed** |

### Named tests

`NON-VACUITY: the sweep sees a real population of sources` ·
`the param names are DERIVED from the authority, not typed here` ·
`POSITIVE CONTROL: the matcher can see a real hand-typed read` ·
`POSITIVE CONTROL: the authority itself routes through the constant, not a literal` ·
`⛔ no NEW surface reads a symbol/timeframe param by hand` ·
`⭐ the baseline has not gone stale in the other direction` ·
`records WHICH spellings are in use, so the finding has a measurement` ·
`the ruling it cites is still where the packet says it is`

⚠️ **The first positive control was wrong, and failing was the correct answer.** It
asserted the sweep finds hand-typed reads inside the authority. It found none — because
`chartDeepLink.js` reads `p.get(CHART_LINK_PARAMS.sym)` **through the constant**, which is
the behaviour being ratified. **A control that fails on correct code is not a control**;
it was replaced by two that assert both halves.

⚠️ **One environment trap, recorded because it fails SILENTLY.** `fileURLToPath(new
URL('.', import.meta.url))` — the idiom `chordCollision.test.js` uses — throws at import
under this config, and vitest then reports **`0 test`**, which reads as *nothing to run*
rather than as a failure. `focusDivergence.test.jsx`'s `path.resolve(process.cwd(), 'src')`
is the idiom that works.

---

## 5 · F-S4-1 — one fact, three spellings

**Opened 2026-09-14. Non-colliding:** `F-S4-1` appears nowhere else in either worktree
(0 hits; positive control: the same search finds `F-S2-1` in 3 files).

`chartDeepLink.js` spells "which symbol" as **`sym`**. `NotebookTab.jsx:136` and `:570`
read **`searchParams.get('ticker')`** to do the same job — a third spelling of one fact, in
a live member surface, which is exactly the failure `chartDeepLink.js`'s own header names:
*"A hand-typed `?sym=` on one side and a hand-typed `p.get('symbol')` on the other agree
the day they are written and silently stop agreeing later."*

⛔ **NOT FIXED HERE.** CP2 is docs + rail only and touches no live consumer; changing what
`?ticker=` does is member-visible and wants its own line — the F-S2-1 precedent. It is
baselined by name so the rail neither cries wolf nor forgets.

---

## 6 · ⛔ Watch-coverage classification — MEASURED after commit

| field | value |
|---|---|
| base | `origin/master` |
| reachable | 156 modules in flow-worker's closure |
| changed ∩ closure | **none** — every file is `app/src/**` or docs |
| verdict | **OK**, stranded `[]` |

---

## 7 · Overlap check (S.3) — four unsigned units on one branch

| unit | files |
|---|---|
| **C** | `tools/audit_signature_regexes.py` (docs) · **`CLAUDE.md`** (code) |
| **B** | `tools/sql_resolves.py`, `tests/test_sql_resolves_multi_database.py`, `OWNER_INPUTS_REQUESTED.md`, packet-b doc (docs) |
| **F-S2-1** | `TickerPopup.jsx`, `ThemeTrackerPage.jsx`, `Watchlists.jsx`, `chordCollision.test.js`, 3 test files (code) |
| **S4 CP2** | `symbolLinkChannels.test.js` (code) · 2 new docs |

**S4 CP2 overlaps nothing.** ⛔ **But C and D do overlap:** both edit the code worktree's
`CLAUDE.md`. They are independently mergeable only because they touch **different
sections**; merged in either order the second needs no rebase, but they must not be
squashed into one diff, and **D's "no other line changes" proof is against a tree where C
has already landed or not at all** — not half-applied.

---

## 8 · Drafted ledger row — NOT written

```
| 73 | <CP2 commit> | 2026-09-14 | S4 / docs+rail | 3 | S4 CP2: the deep-link ratification written down, with a DERIVED rail baselining the 5 hand-typed param reads; F-S4-1 filed (NotebookTab spells `ticker` where the authority says `sym`)
```

## 9 · Drafted RESUME delta — NOT applied

Under **§5 What a session must NOT do**:

> ⛔ **Do not propose a check before asking whether the repo has ever been on the wrong
> side of it.** 2026-09-14: S4 CP2's first candidate rail was a `path:line` citation
> checker; measured against the S4 packet's own 20 citations it found **OUT-OF-RANGE = 0**,
> so it could never have fired. The rail that shipped instead baselines **5 real
> hand-typed deep-link reads**, one of which (**F-S4-1**) spells the same fact a third way.
