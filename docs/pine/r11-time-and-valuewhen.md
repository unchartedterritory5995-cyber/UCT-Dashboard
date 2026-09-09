# R1.1(e) — `time(<timeframe>)` and `ta.valuewhen`, measured before they are built

Static measurement over the 266 committed scripts, 2026-09-09. This is the shape of the
demand; the semantics still have to come off the vendor, and the questions are listed at the
bottom. **Nothing is implemented from this page.**

## What the corpus actually asks for

| name | sites | scripts | arities used |
|---|---:|---:|---|
| `ta.valuewhen` | 201 | 27 | **3-arg, always** |
| `valuewhen` (bare, v1-v3 spelling) | 180 | 12 | **3-arg, always** |
| `time` | 142 | 40 | 1-arg ×45 · 2-arg ×52 · 3-arg ×45 |
| `request.security` | 342 | 66 | 3-arg ×168 · 4-arg ×98 · 5-arg ×70 · 6-arg ×3 |

⚠️ **`ta.valuewhen` is 381 sites across ~39 scripts once both spellings are counted**, not the
46 the guard census reports. Those are different measurements and both are right: the census
counts **refusal sites** (where translation stopped), this counts **call sites in source**. A
script that refuses earlier never reaches its later `valuewhen` calls, so the census
undercounts demand by construction. **Size the work from the source count; size the unlock
from the refusal count.**

⭐ Every single `valuewhen` call in the corpus is 3-arg. There is no 2-arg form to support.

## `time()` — the first argument is the interesting one

| arity | first arg is a string literal | is `timeframe.period` | other |
|---:|---:|---:|---:|
| 1-arg | 25 | 1 | 19 |
| 2-arg | 9 | **41** | 2 |
| 3-arg | 13 | 29 | 3 |

The dominant 2-arg shape is `time(timeframe.period, sess)` — a session test on the chart's own
timeframe. The 1-arg shape is mostly `time(tf1)` where `tf1` is an input, and `time("D")`.

⛔ **`timeframe.period` as the first argument is 71 of 142 sites, and it is NOT a constant we
can fold** — it is the chart's timeframe, known at bind time but not at parse time. That is the
same seam as the bind-time fold, so `time()` should be built *after* the fold work, not beside
it.

## The questions for the vendor — none of these are guessable

**`time(<timeframe>)`**
1. On a bar where the higher timeframe has **no bar** (a 1D chart asking `time("W")` mid-week),
   does it return `na`, the open time of the *forming* higher-timeframe bar, or the last
   completed one? The three answers differ on every bar that is not a period boundary.
2. Same question **on the chart's own timeframe** (`time(timeframe.period)`) — is it exactly
   `time`, or can it differ at a session edge?
3. With a **session argument** (`time(timeframe.period, "0930-1600")`) — `na` outside the
   session, or the session's start time? This decides whether the 52 two-arg sites are a
   boolean test or an arithmetic one.
4. Do `time(tf)` **comparisons** fold? A `time("D") != time("D")[1]` is the classic "new day"
   idiom and would be a cheap win — but only if (1) is `na`-free.

**`ta.valuewhen(condition, source, occurrence)`**
1. `na` when the condition has **never** fired — or 0?
2. `occurrence = 0` — is that the most recent firing, or the one before?
3. `occurrence = 1` and `2` — counting back from the current bar or from the previous one?
4. **Condition true on the current bar** — does occurrence 0 mean *this* bar, or the last one
   before it? This is the single most likely place to be off by one, and 381 sites ride on it.

⭐ Every branch above needs its own fixture row: the call, the vendor's per-bar answer, and a
bar range where the wrong answer differs from the right one. An `occurrence` off-by-one
produces a plausible-looking series that is wrong everywhere, which is precisely the failure a
green suite cannot see.
