# Q1 — PROGRAMME CLOSED · 2026-09-19

**D1–D5 are all TRUE. The append door is open to members on production with
Q1 fix 6 as its protection, and the kill switch was never touched.**

---

## D1–D5

| | status | citation |
|---|---|---|
| **D1** door guard live on production | ✅ **TRUE** | `evidence/20260917T122035-…` · toast confirmed LATCHED on production 2026-09-19 |
| **D2** writer named; fix 6 shipped | ✅ **TRUE** | `persist` · landed `8568d13ad`, ancestor of `origin/production` |
| **D3** five append cells GREEN | ✅ **TRUE** | **5/5 GREEN, two consecutive windows** — `evidence/20260919T123028-…` and `…T123625-…` |
| **D4** Phase 3 complete | ✅ **TRUE** | ancestors of `origin/master` |
| **D5** docs current | ✅ **TRUE** | this report |

```
window 1  12:30:28Z   5 GREEN · 0 RED · 0 INCONCLUSIVE · 0 DEFERRED
window 2  12:36:25Z   5 GREEN · 0 RED · 0 INCONCLUSIVE · 0 DEFERRED
```

Both halves green in every cell: **the member's offline sentence reached the
server** AND **the door's own appended node landed**.

---

## The one product defect — real, and found by chasing a cell everyone had
## written off as an instrument problem

`persist` dropped words a member typed **on top of their own unsent work**.
`discardsUnsentWork` documented itself as directional and was implemented as
symmetric, so once a note was dirty every further keystroke read as "this write
discards unsent work" and `source = prev` was written instead. The editor kept
showing the words; a reload did not.

**Fixed by splitting the predicate by PROVENANCE** — the two callers are handed
different kinds of thing:

| caller | receives | predicate |
|---|---|---|
| `persist` | the EDITOR's own content | `editorStateDiscardsUnsentWork` |
| `settleLandedSave` | the SERVER's ack (a claim) | `discardsUnsentWork` |

⚰️ The obvious single fix was tried first and **reverted**: making the one
predicate directional fixed `persist` and broke `settleLandedSave` (a door
passing local state as `acked` also carries prev's words). `selfForkDoors` went
11 passed → 1 failed, and re-running against the parent commit proved the
regression was ours. Fix 6 merged the two callers for "one authority" — right
about the invariant, wrong about the question.

⭐ **Confirmed by the product itself:** the two cells that exposed the defect
passed **first try** once the fix reached production, after failing six times.

---

## Five instrument defects, each found by fixing the one before it

| # | defect | what it looked like |
|---|---|---|
| 1 | editor mount sampled, not waited | "the sentence was never typed" |
| 2 | second-context door sampled | "no folder `<select>` on the page" |
| 3 | setup keystroke read too early | "never got the sentence into a queued entry" |
| 4 | a **2200 ms** toast read at **5000 ms** | `DEFERRED` structurally unreachable |
| 5 | release-the-note gated to the controlled experiments | every append cell timed out |

⛔ Every one was a `wait_for_timeout` beside a point-in-time read, and every one
produced a sentence that was **true and pointed at the wrong subsystem**. CLAUDE.md
predicted the location of #2 verbatim: *"Grep for `wait_for_timeout(` beside a
`query_selector` and you will find the rest."*

---

## Corrections made to my own work, in order

1. ⚰️ **"The hot pod is why 2.8b fails"** — withdrawn; the next run sat on an
   8.5 GB pod with zero 500s.
2. ⚰️ **"The excerpt family's PDF makes its write slower"** — withdrawn; the same
   cell went GREEN at the old budget on the next attempt.
3. ⚠️ **Declined to credit the retry for `slow-put`** — its artifact shows the
   retry never fired.
4. ⚠️ **A vacuous rail** — the first deploy-identity rail asserted a token that
   also appears in the signature; gutting the guard left it green. Caught by its
   own mutation proof.
5. ⚰️ **"CR-doubling / a line-ending flip"** — both wrong; a `grep` pattern that
   did not survive quoting matched every line.
6. ⚰️ **"The append drain is stalling"** — withdrawn; it correctly SKIPS the note
   the editor has open.
7. ⚠️ **A NUL-byte corruption** the gate caught as `sourcesAreText`, which I
   dismissed as another workstream's noise because 24 of the 25 were.

⛔ Four of these are the same error: **a correlation seen once, promoted to a
cause, and written down before a second run could test it.**

---

## Not done, and not ours

- **The production ruleset** — HARD BLOCKED: no `gh` CLI installed and
  `GITHUB_PERSONAL_ACCESS_TOKEN` unset. That is also the root cause of the GitHub
  MCP failing all session (`${…}` never expands → "Authorization header is badly
  formatted"). Needs the owner.
- **24 master reds in `components/chart`**, including a failing non-vacuity
  control — surfaced for that workstream, deliberately not banked.
- **W2's banking run** — the deferral toast is now provably reachable (LATCHED on
  production), but the cell has not yet banked a clean DEFERRED reading.

## RESERVED

**`NOTEBOOK_OFFLINE` — untouched for the entire programme.**
`NOTEBOOK_DOOR_GUARD = unknown-only`, live, verified in-process, staying narrowed
per the two-consecutive-windows rule. Rollback is one verified command:
`python tools/q1_p3_drive.py --rollback`.
