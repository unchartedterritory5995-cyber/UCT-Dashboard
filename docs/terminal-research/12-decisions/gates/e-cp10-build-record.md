---
id: e-cp10-build-record
unit: E CP10
packet: packet-e-ci-gap-gate
merges-after: E CP9
status: UNSIGNED
---

# E CP10 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> **E CP10 — `replace()` is not a GitHub Actions expression function, and E CP7's use of it
> rejected the entire workflow.** Scope is `tools/collect_profile_dirs.py`,
> `tools/check_workflow_expressions.py` and `.github/workflows/full-suite-report.yml` **as
> enumerated by `git show --stat` of `9ef64fd69`.**

⛔ **Collision proof:** E's table declares CP1–CP3; build records and rows exist for
CP2, CP4–CP9. **CP10 free.**

---

## 1 · ⛔⛔ THE FIX WAS WORSE THAN THE DEFECT

E CP7 sanitised an artifact name with:

```yaml
name: collect-profile-${{ replace(matrix.dir, '/', '--') }}
```

**GitHub Actions has no `replace()`.** The set is `contains`, `startsWith`, `endsWith`,
`format`, `join`, `toJSON`, `fromJSON`, `hashFiles`, plus the status functions.

**Run #7: 0 jobs · `created_at == updated_at` · conclusion `failure`.** The workflow was
rejected before a single job started.

⛔ **CP7's defect failed four jobs. CP7 itself failed all twenty.**

## 2 · ⛔⛔ AND THE VALIDATOR I RAN COULD NOT SEE IT

`yaml.safe_load` **passed** — it is valid YAML. The error lives in the **expression** layer,
which a YAML parser does not evaluate. `actionlint` would have caught it; I recorded it
**UNREADABLE-TOOL** (not installed) **and pushed anyway.**

⭐⭐ **The lesson is not "install actionlint."** It is that **declaring a validator
unavailable is a reason to be more careful, not a box to tick** — most of all when the
unavailable validator is the *only* one that could see the class of change being made. I
wrote the words `UNREADABLE-TOOL` and then behaved as though the check had passed.

## 3 · Two fixes

**(1) No expression function is needed at all.** `collect_profile_dirs.py` now emits
`[{dir, id}]` and the matrix uses the **include form**, so the workflow reads
`${{ matrix.id }}` — sanitised in Python, where `replace()` exists. ⭐ **The cheapest fix
for a missing primitive is to not need it.**

**(2) `tools/check_workflow_expressions.py`** refuses any `${{ … }}` calling a function
outside the documented set — the cheap half of the validator that was unavailable, so the
gap now has a floor.

## 4 · Controls, and the mutation proof is against the real artifact

Eleven fixture controls, including five invented names (`toUpper`, `replaceAll`,
`substring`, `lower`, `split`) and a bare property reference that must **not** be flagged.

**Mutation-proved against the committed files, not a fixture:**

```
broken workflow (0b92750fa) -> exit 1, names `replace()`, quotes the line
fixed workflow              -> exit 0
16 expressions inspected in both
```

⛔ **Non-vacuity:** the expression count is printed, and a file with **no** expressions is
**UNREADABLE, not a pass** — *"0 problems" over 0 expressions* is the shape this whole
programme keeps refusing.

## 5 · Files

```
tools/collect_profile_dirs.py             ({dir,id} pairs for the include-form matrix)
tools/check_workflow_expressions.py       (new — the floor under the missing validator)
.github/workflows/full-suite-report.yml   (include-form matrix; ${{ matrix.id }})
```

⚠️ **Not disjoint from CP7/CP8/CP9/CP11** — all edit the workflow. Structural; the
`merges-after` chain carries the order.

## 6 · Drafted ledger row — NOT written

| 88 | `9ef64fd69` | 2026-09-15 | CI | 1 | E CP10: `replace()` is not an Actions expression function and E CP7's use of it rejected the whole workflow (run #7, 0 jobs). `yaml.safe_load` cannot see the expression layer; `actionlint` was UNREADABLE-TOOL and the change was pushed regardless. Matrix now carries a pre-sanitised id, and a local expression guard is the floor. |

## 7 · Drafted RESUME delta — NOT applied

- ⛔ **An unavailable validator is a reason for more care, not less.**
- Run #8 confirmed the parse fix: **19 of 20 jobs succeeded**, including **all four**
  previously-failing profile jobs.
