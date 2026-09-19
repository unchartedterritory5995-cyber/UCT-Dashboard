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
| `pine:timeout` **depth bound** | `PINE_TRANSLATE_MAX_DEPTH` | 1, 2, 5, 7 levels |
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

## ⛔⛔ RULE 1b — THE OPTION MUST REACH THE GUARD

**A limit is not configurable because the constructor reads it. It is configurable when the
CALLER's value arrives there** — and the control from Rule 1 is what tells you which.

`PINE_TRANSLATE_MAX_DEPTH` shipped with a correct constant, a correct constructor read
(`opts.maxDepth`), a correct refusal, and a correct message. `translatePine` never passed it.
Every small bound in the control was therefore unreachable and the guard could not fire — the
identical failure to the step cap behind the sampling mask, one layer further out, four days
later. Two of `translatePine`'s Resolver construction sites had to learn the option.

⚠️ **The tell is that the control fails while the shipped default keeps working.** A guard
wired only to its default looks perfect in every test that does not try to move it, which is
every test anyone writes when they trust the option exists.

## ⛔⛔ RULE 5 — A SWALLOWED HOST ERROR MAKES THE ANSWER DEPEND ON THE HOST

`catch { return null }` around a resolution swallowed a `RangeError: Maximum call stack size
exceeded` **1,117,654 times in one translation** and retried a different expansion each time.
That was the SAR "hang".

⛔ **The time was the lesser half.** While the overflow was being swallowed, what the door
replied depended on the **host's stack size** — node version, `--stack-size`, how deep the
caller already was — rather than on the member's script. The same file could translate on one
machine and refuse on another, with nothing in either run to point at.

**So: a resource a guard does not name, the host still enforces — with an exception the code
was never written to expect.** Bound recursion depth, allocation and iteration IN THE ENGINE,
at a limit derived from what real inputs need, so the reply is a property of the input. A
`catch` with no discrimination between "this refusal is expected" and "the host just told us
we are out of stack" turns the second into the first.

⭐⭐ **THE EVIDENCE, AND IT IS THE KIND WORTH COLLECTING.** The same file, through the
SAME pre-fix translator, produced **three different refusals** across three execution
contexts today:

```
pine:timeout@40:nextsar | pine:timeout@63:change | pine:timeout@64:change
pine:timeout@40:nextsar | pine:timeout@null:null | pine:timeout@null:null
pine:timeout@40:nextsar | pine:timeout@63:change | pine:timeout@null:null
```

⚠️ **State it precisely: it is stable within one tight loop** (five consecutive runs agreed
each time) **and varies between contexts** — how much stack the caller had already spent,
what ran before it. That is exactly the signature of an answer derived from host state
rather than from the input, and it is why "I ran it twice and got the same thing" is not
evidence of determinism here. After the bound: one answer, five times, 20-61ms.

⚠️ Related and separate: never cache across an impurity. A subtree memo built during this fix
looked sound and dropped the `accum(...)` wrapper from four supertrend-family scripts — same
guards, `ok:true` both ways, and a formula that had quietly stopped being stateful. A cache
HIT skips side effects the caller depended on. It was caught only by comparing every corpus
script's output against the previous translator, byte for byte, which is the standing bar for
a change inside `resolve`.

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
