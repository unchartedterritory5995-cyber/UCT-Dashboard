# S7 — the arming and disagreement state of all seven types, 2026-09-25 ~21:5xZ

Produced by `tools/s7_arming_inventory.py` (committed `a0a7e363f`) against **production**,
admin read as the synthetic smoke account. Re-runnable:

```sh
python tools/s7_arming_inventory.py            # the table below
python tools/s7_arming_inventory.py --self-check   # 12 cases, no network, proves the verdicts can fail
```

| alert type | preds | ready | agreed | new_only | legacy_only | not_cmp | arming |
|---|---|---|---|---|---|---|---|
| catalyst-match | 58 | **58** | 80 | 0 | 0 | 0 | — |
| event-proximity | 38 | 0 | 59 | 0 | 0 | **59** | — |
| indicator-condition | **0** | 0 | 0 | 0 | 0 | 0 | — |
| position-risk | 8 | 8 | **0** | 0 | 0 | 4 | — |
| price-level | 18 | 12 | 1 | 0 | **2344** | 0 | — |
| regime-change | 58 | 0 | 0 | 0 | 0 | 0 | — |
| scan-membership-change | 1 | 0 | 4 | 0 | 0 | 0 | subs 4 · members 2 · silent 2 |

**7 types · 181 predicates · agreed 144 · new_only 0 · legacy_only 2344 · not_comparable 63**

---

## ⛔ THE PLAN'S OWN STATUS TABLE IS STALE, AND THIS IS WHY IT MATTERS

`s7-alerts-completion-plan.md` §1 was written 2026-09-11. It marks `price-level` and
`event-proximity` as merged and lists the other five as work to do, sized S through L. The
code disagrees: **all seven types have both a `*_compare.py` and a `*_projection.py`**, and
six of the seven are observing real spans on production today. Anyone planning the next S7
increment off that table would be sizing work that is substantially built.

⭐ The table is not wrong so much as *old* — the "when was this last true?" question. It is
left in place and this inventory is the derived answer beside it, because a hand-typed
status table next to the system it describes is the drift this program pays for repeatedly.

## ⭐ `catalyst-match` IS THE CLEANEST EVIDENCE IN THE TAXONOMY

58 predicates, **58 verdict-ready**, 80 agreed, **zero `new_only`, zero `legacy_only`, zero
`not_comparable`**. On the evidence axis that is what a flip-ready absorption looks like:
every predicate has its five sessions, both rules agreed everywhere they both fired, and
nothing was unobservable.

⛔ **That is NOT the same as "may flip."** This inventory measures the comparison receipts
only. A flip also needs §2's filing-watch parity precondition and §2a's mandatory
checklist (schema shapes pinned, a named call site with a rail asserting it, a liveness
stamp), none of which a counter can see. **Recorded as: the evidence bar looks met; the
process bars are unmeasured here.** It is the strongest candidate for the next S7 decision
and the owner's to take.

## ⛔ ONE DISAGREEMENT IN THE ENTIRE SYSTEM, AND IT IS THE ONE ALREADY FLAGGED

Across 181 predicates and seven types there is exactly **one** cluster of either
disagreement kind:

```
price-level: legacy:08d68edb-d4b   legacy_only=2344  new_only=0  agreed=0  sessions=5
```

`new_only` is **0 across the whole taxonomy** — no type would send an EXTRA member alert on
flip. Every unit of risk in the system sits on that single predicate, which makes
identifying it (the owner-run pod probe named in `RESUME-HERE.md` §5 CARD 1) the highest-
leverage single action available on S7 right now.

## Two other readings worth naming, neither a defect on this evidence

* **`event-proximity`: 38 predicates, 59 agreed, 59 `not_comparable`, 0 ready.** Half its
  observations had no honest comparison. `not_comparable` is deliberately never folded into
  `agreed` (that is the `CoverageLine` idiom), so this is visible rather than flattering —
  but a type whose comparable and non-comparable halves are equal is not near a verdict, and
  `0 ready` says so independently.
* **`position-risk`: 8 predicates, 8 ready, `agreed` 0, `not_comparable` 4.** Verdict-ready
  with zero agreement means no tick ever had both sides fire. That is consistent with a type
  whose legacy twin (the Awareness Engine's R1/R2 stop-watch) simply has not fired in the
  window, and `new_only 0` says the dark side did not fire alone either. Not evidence of a
  defect; not evidence of agreement either. Worth a look before anyone reads "8/8 ready" as
  a pass.
* **`indicator-condition`: 0 predicates — CORRECT.** §2b sequences it behind D2 CP1 *plus
  the first non-screener store*. The tool reports the zero and explicitly refuses to grade
  it, because which silent type is legitimately silent is a question for the plan and not
  for a counter.

## What the instrument had to survive to be trusted

Its own `--self-check` failed twice before first real use, and both were the instrument
rather than the subject:

1. It **crashed printing its own `⛔` marker** under this box's cp1252 console —
   `UnicodeEncodeError` mid-report, which reads like a failure of the thing being reported.
   Same family as `flag_ledger_audit.py`'s cp1252 pipe-decode bug that was misread as an
   auth problem. Fixed by reconfiguring stdout to utf-8 with `errors="replace"` and line
   buffering, so a codepage can degrade a glyph but never end a run.
2. Two cases **indexed the type list by position** and expected `[1]` to be `lost` when
   alphabetical sorting makes it `empty`. Fixed to assert by name.
