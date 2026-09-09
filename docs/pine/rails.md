# Rails — rules for guards in this codebase

Standing rules, each written after a guard failed in exactly this way.

---

## ⛔⛔ RULE 1 — every budget or limit guard needs a control that asks it to fire

**A guard must have a test that sets its limit to a trivially small value on a
NORMAL input and requires it to refuse.** Not a test that the limit is configured.
Not a test that a pathological input fails. A test that the guard *fires*.

**Where this came from.** `pine:timeout`'s step cap shipped gated behind the same
4096-step sampling mask as its wall clock:

```js
if (((this.budgetSteps += 1) & BUDGET_CHECK_MASK) !== 0) return   // ← returns 4095 times in 4096
if (this.maxSteps > 0 && this.budgetSteps > this.maxSteps) { …refuse… }
```

Every cap below 4096 was therefore **unreachable**. The code read correctly, the
constant was right, the message was right, and the guard could not fire at all.
What caught it was a control asking a perfectly ordinary script to stop at 1, 10,
100 and 500 steps and requiring each to refuse.

⚠️ **A pathological input is not a control.** The pathological input *did* trip the
cap once the number was large enough, which is exactly why the defect survived: the
one case anybody thought to test was the one case that still worked.

**The control has two halves, and both are required:**

1. the guard **fires** at a trivially small limit on a normal input, and
2. the same input is **clean** at the shipped limit.

Without (2) a guard that refuses everything always passes (1).

**This rule applies to, at least:**

| Guard | Limit | Control must ask it to fire at |
|---|---|---|
| `pine:timeout` wall clock | `PINE_TRANSLATE_BUDGET_MS` | 1ms |
| `pine:timeout` step cap | `PINE_TRANSLATE_MAX_STEPS` | 1, 10, 100 steps |
| **R2** `objectPool` | `max_lines_count` etc. | a capacity of 1 |
| **R2** `POLYLINE_MAX_POINTS` | 10,000 | 2 points |
| **R1.4** resource guards | whatever they cap | the smallest value the type allows |

## ⛔ RULE 2 — a guard's scope must be the thing it claims to bound

`pine:timeout`'s wall clock was **per Resolver**, and `translatePine` builds one
Resolver per output plus one for the object pass. A 45-output script like Uncharted
Clouds would have received **46 × 10s = seven and a half minutes** while every
individual guard reported itself satisfied.

⚠️ **Each guard was correct in isolation.** Nothing about reading the Resolver
shows you how many Resolvers a call makes. Scope defects are invisible at the site
of the guard and only visible at the site that *builds* the guarded thing — so the
test has to be written against the CALL, not against the component.

Measured effect of fixing it on the pathological script: **38.7s → 31s → 14.5s**,
as the output loop and then the object pass were brought under one deadline.

⚠️ And state what the bound can and cannot do: this one stops **new** work from
starting. A resolution already in flight still runs to its per-resolution step cap,
so the real bound is `budget + one step-cap burn`, not `budget`.

## ⛔ RULE 3 — a guard nobody has seen fire is not a guard

If the corpus cannot exercise a guard — and a healthy corpus *should not* be able to
exercise a timeout — then the corpus cannot prove it works. Prove it in its own
test, and record on the "unexercised by the corpus" roster that this is the correct
state rather than a gap.

## ⛔ RULE 4 — an unapplied mutation is indistinguishable from a missing rail

Three times in one session a mutation probe silently failed to apply — a `sed`
pattern that did not match, a Windows path Python could not open, a stale anchor —
and each time the suite reported a clean pass that read exactly like "the rail does
not fire". Every mutation harness must **assert the file actually changed** before
believing the result.
