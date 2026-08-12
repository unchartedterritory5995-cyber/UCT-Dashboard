# Pine corpus — every wall in every chain, and the real ceiling

> Measured 2026-08-11 over all 21 committed third-party scripts. Written because
> three consecutive correct fixes moved a refusal one line deeper without moving
> the score: `ta.cross`, then tuples, then a `var` reading its own past. Each was
> right; each was chosen by "which guard fires most", which is the ranking
> `lesson_a_refusal_count_is_not_a_progress_metric` says never to use.

**The method:** a script's OUTPUT walls are what each plot/alert hits first. Its
FOLD walls are what the binder hit while folding names — those are invisible in
the usual per-output count and they are the ones that show what is queued up
BEHIND the first refusal. Reading both together is how you see a chain instead
of a wall.

## 🔴 FINAL MEASURED STATE, 2026-08-11 — every remaining script, individually

11 of 21 read, 47 columns. **Not one of the remaining ten is a contained
translator fix.** Each needs either a product decision or a substantial engine
extension, and five of them SHOULD keep refusing. Measured per script, output
walls and fold walls both:

| Script | Wall | What it actually needs |
|---|---|---|
| 04-superguppy | `request.security` + `for` | multi-symbol data path |
| 05-mtf | `request.security` ×3, nothing else | multi-symbol data path |
| 09-obv | `cum`, nothing else | ⛔ inexpressible: a true cumulative changes with how many bars were fetched |
| 14-bollinger | displaced `plot(offset=)` ×3 | ⛔ that refusal IS the non-repainting guarantee |
| 19-strategy | `strategy()` | order simulation — a different engine |
| 10-supertrend | `pine:state` ×5, nothing else | **closed-table: a recurrence needs its OWN bind** |
| 21-volume-profile | state + `for` | loops |
| 02-ict | state + `for` + `while` + 7 unparsed | loops |
| 20-smc | `ta.pivothigh` + 3 user types + `for`/`while` | loops + UDTs + a drawing model |
| 15-avwap | `time` ×7 + `for` | session model + loops |

⭐ **THE ONE ENGINE CHANGE WITH REAL REACH IS DISTINCT RECURRENCE BINDS.** `accum`
binds a single name, `self`. Two recurrences in one expression therefore collapse
onto it — that is exactly what made the 10-supertrend fold emit `self` as both a
direction and a stop price. The interpreter refuses a NESTED `accum` for the same
reason, in its own words: *"which running value it names would depend on where a
reader started counting."* Give each recurrence its own bind and that objection
dissolves, 10 clears, and the whole trailing-stop family becomes expressible.

⚠️ It is a closed-table change: both lanes, a parity case, the budget walker and
the repaint linter. Not a translator patch. That is the honest next project.

⛔ **AND FIVE SHOULD NEVER MOVE.** `request.security` (a scan column reads one
symbol), `cum` (request-dependent by construction), a displaced plot (the repaint
guarantee itself), `strategy()` (a different engine). Counting them as "remaining
work" is how a roadmap starts lying.

## The ceiling

| | scripts | why |
|---|---|---|
| **Reading today** | **11** | 47 columns |
| ✅ Reachable, and DONE | **+1** | 06 cleared 2026-08-11 — 9 columns |
| Needs loops / UDTs (Phase 5) | 3 | 02, 20, 21 |
| Structurally out, correctly | 5 | 04, **05**, 09, 14, 19 |
| | **21** | |

⭐ **REVISED 2026-08-11 (later): the honest near-term target is 11 of 21, not 13** — 05 turned out to be `request.security` behind the offset guard, and 10 needs a closed-table answer about `self`. The original 13 is left below struck through in the per-script sections so the correction is legible — and the four in
the last row should never move, because refusing them is the correct answer.

## Rank order, by whole chain rather than by guard

### 🥇 10-supertrend — ONE wall, and I MIS-SIZED THE FIX (corrected same day)

🔴 **This section first said "fold the conditional reassignment FIRST and offset
the final binding". That is wrong, and it would not have worked.** The final
binding is not a stale value to re-point at — it is CIRCULAR across bars:
`shortStop`'s final value depends on `shortStopPrev`, which is `shortStop`'s own
previous-bar final value. Offsetting the final binding recurses. `shortStop[1]`
is not a stale read; it IS `self`.

⭐ **THE DESTINATION IS PROVEN REACHABLE.** Hand-written as a `var`, the identical
logic translates today:

    var s = 0.0
    s := high < nz(s[1], close + 1) ? math.min(close + 1, nz(s[1], close + 1)) : close + 1
    →  accum(0, high < nz(self, close + 1) ? min(close + 1, nz(self, close + 1)) : close + 1, 250)

And the two halves it needs already work independently: conditional reassignment
folds (`s = close + 1; if s > 0; s := s * 2` → `close + 1 > 0 ? (close + 1) * 2 :
close + 1`), and a `var` reading its own past folds to `self` (shipped today).

**So the real change is:** a PLAIN name (no `var`) that is reassigned later AND
whose reassignment chain reads its own `[1]` is a RECURRENCE, and must fold like
one — `name[1]` becomes `selfref`, the first assignment becomes the accumulator's
SEED, and the folded reassignments become its UPDATE.

⚠️ **WHY I DID NOT JUST WRITE IT.** That changes how every mutated plain name
folds, and the corpus has 4,284 tests over this translator. Gross breakage would
show; a subtly wrong SEED or WARMUP would not — and a trailing stop translated
one bar off is precisely the "looks fine, is wrong" class this whole document is
organised against.

⛔ **The safety property to build it behind:** engage the recurrence path ONLY
where the offset would otherwise have REFUSED. That confines the change to
scripts that fail today, so no currently-working translation can move — and it
is the thing to verify first, before any of the folding is written.

### ⭐ THE CONVERGENCE TEST — the rule, derived. Implement this, then attempt five.

**A re-seeded accumulator is sound if and only if it FORGETS ITS SEED.** That is
the whole criterion, and it is why a trailing stop is safe under `accum` while a
running total is not:

| update shape | forgets the seed? | verdict |
|---|---|---|
| `min(x, self)` / `max(x, self)`, `x` self-free | yes, once `x` dominates | ✅ sound |
| `cond ? self : x` — a hold or a passthrough | yes | ✅ sound |
| `nz(self, x)` | passthrough | ✅ sound |
| bare `self` | trivially | ✅ sound |
| `self + x`, `self - x`, `self * x`, `self / x` | **never** | ⛔ refuse |
| `self` inside any other call | unknown | ⛔ refuse |

**The analysis:** walk the resolved update tree. `self` may reach the root ONLY
through `min`/`max`/`nz` and through ternary ARMS. Reaching it through an
arithmetic operator, or through any other function, refuses by name.

⛔ **CONSERVATIVE ON PURPOSE.** An unrecognised shape refuses rather than being
assumed convergent — this decides whether a member's saved indicator is the
indicator they wrote, and the failure it prevents (a hand-rolled OBV silently
becoming a 250-bar rolling sum) is invisible in the output.

⚠️ **The refusal message must name the reason, not the shape:** *"this value adds
to its own previous bar, so it never forgets where it started — and this engine's
accumulator re-seeds, which would make it a rolling sum rather than a running
total."* That sentence is also the honest answer to why `cum` refuses, so the two
finally agree.

**Then attempt five is mechanical:** the marker from attempt four (validated,
correct) plus this gate in front of the wrap. Nothing else changes.

🛑 **ATTEMPT FOUR — THE DESIGN WAS RIGHT AND THE FEATURE IS STILL WRONG.**

The resolution-time marker WORKS. `buildingRecurrence` tells the two positions
apart, and the simple trailing stop translates correctly:

    s = close + 1 ; p = nz(s[1], s) ; if s > 0 → s := high < p ? min(s, p) : s
    → accum(close + 1, close + 1 > 0 ? (high < nz(self, close+1) ? min(…) : …) : …, 250)

🔴 **AND IT WOULD SILENTLY MISTRANSLATE A HAND-ROLLED CUMULATIVE.** An existing
rail caught it — `pine.variables.test.js`, which exists for exactly this:

    x = 0.0
    x := x[1] + volume          ← OBV by hand

That becomes `accum(0, self + volume, 250)`. **`accum` RE-SEEDS EVERY 250 BARS.**
It is a rolling sum, not a cumulative — which is precisely why `cum` is refused
in the first place: a true cumulative changes value with how many bars were
fetched. The plain-name recurrence path cannot tell a TRAILING STOP (bounded,
correct under a re-seeding accumulator) from a RUNNING TOTAL (unbounded, wrong
under one), because both are spelled `x := f(x[1])`.

⛔ **SO THIS IS NOT A TRANSLATOR PROBLEM EITHER.** It is the same wall as `cum`,
reached from the other side. Any general `x := f(x[1])` fold has to answer:
*is this update bounded?* An accumulator that re-seeds is only sound when the
update CONVERGES — a stop that clamps to a min/max does; a sum does not.

**What a fifth attempt would need, and it is a real piece of design:**
- a convergence test on the update tree — a min/max/clamp against a bounded
  input is safe; an unbounded `self + x` is not — and refusal by name when it
  cannot be shown;
- or an unbounded accumulator with an ABSOLUTE seed, which is the same thing
  `cum` needs and which the engine forbids by construction today.

⭐ Four attempts, and each one narrowed it: attempt 1 found the collision,
2 found the shared `self`, 3 found the neighbouring-binding escape, 4 found the
boundedness question. The engine half below is real and shipped. This half should
not ship until boundedness has an answer.

✅ **THE ENGINE HALF IS SHIPPED.** `self` now binds to the NEAREST ENCLOSING
recurrence, so two independent accumulators can sit in one expression — proved
across both lanes at 0.000e+00. The claim that this needed a closed-table change
was WRONG; it was one condition in `reads()` per lane.

🔴🔴 **THE TRANSLATOR HALF FAILED A THIRD TIME, AND NOW THE REASON IS EXACT.**
Not a vague "it collided" — here is the mechanism:

    shortStop     = src + atr
    shortStopPrev = nz(shortStop[1], shortStop)   ← a DIFFERENT name
    if …  shortStop := … shortStopPrev …

`shortStop[1]` is read while resolving **`shortStopPrev`**, which is its own
binding. My code emitted a bare `self` there and recorded the seed under
`shortStop`. But the wrap fires on the name whose final binding is being
resolved — and that name is `shortStopPrev`, which has no seed recorded. So the
`self` escapes its own accumulator and is captured by whatever encloses it,
which is `dir`'s. One accumulator, `self` meaning a direction in one place and a
stop price in another.

⭐ **AND THE CORRECT RULE IS NOW CLEAR, WHICH IS THE DELIVERABLE:**
`name[1]` means two different trees depending on WHERE it is read.
- **Inside that name's own update** → `self`.
- **Anywhere else** (the `shortStopPrev` case) → `accum_name(…)[1]`, the whole
  accumulator offset by one bar.

⚠️ That second form already works for a `var` state — measured: reading a state's
past from outside its update inlines the accumulator and offsets it. What the
plain-name path lacks is the ability to tell the two positions apart, because it
has no notion of "am I currently building THIS name's recurrence".

**So the next attempt needs a resolution-time marker for the recurrence under
construction** — not more folding. Reverted rather than shipped; the engine half
stands on its own and is already in use by the multi-lag work.

🔴🔴 **(history) ATTEMPTED AND REVERTED — READ THIS BEFORE TRYING AGAIN.**

The recurrence fold was written exactly as specified above: `name[1]` → selfref,
the binding in scope at the read → SEED, the folded reassignments → UPDATE,
engaged only where the offset would otherwise refuse. **On a simplified fixture
it produced precisely the right tree.** On the real script it produced this:

    accum(1, self == -1 && high > nz(self, (high+low)/2 + 3*atr(…)) ? 1 : …)

⛔ **`self` APPEARS THERE AS A DIRECTION AND AS A STOP PRICE, IN ONE ACCUMULATOR.**
`dir` is a `var` and `longStop` is a plain reassigned name, so folding the second
inside the first collapsed two recurrences onto the one `self` the manifest
declares. It parses, it budgets, it lints `non-repainting`, it saves — and it is
nonsense. The corpus counted it as 11 of 21 and 43 columns.

**What caught it was reading the FORMULA, not the score.** Every automated signal
said win.

A `recurrenceDepth` guard — refuse a plain-name recurrence while another
recurrence's update is being resolved — was written next and **did not work**:
script 10 still produced the collided tree, so the two recurrences are being
folded on a path that guard does not sit on. Reverted rather than shipped.

**For whoever picks this up:**
- The simple, NON-NESTED trailing stop is genuinely reachable and the fold is
  correct for it. The value is real; the containment is the hard part.
- ⛔ The blocker is that `self` is ONE name. Two recurrences in one expression
  need either distinct binds or a nested `accum` — and the interpreter refuses a
  nested one BY DESIGN (`interpret:recurrence`, "which running value it names
  would depend on where a reader started counting").
- So this is not a translator fix at all. It is a question about the closed
  table: can a recurrence name its own bind? Until that is answered, script 10
  should keep refusing, and `pine:state` is the honest verdict.
- ⚠️ Do not re-attempt from the description in this file alone. Re-run the
  simplified fixture FIRST — it passes — and only then the real script, and read
  the emitted formula both times.

**Original chain evidence, still accurate:**
`pine:state` ×5 on `shortStop[1]`. Every other note is `chart-only`
(`plotshape`, `fill`) which no screener column needs. **This is the only script
in the corpus whose entire chain is one guard.**
The shape: `x = src + atr` → `nz(x[1], x)` → `if cond` → `x := …`. The `[1]` is
read BEFORE a later conditional reassignment, and Pine's `x[1]` means the
previous bar's LAST assignment — so offsetting the binding in scope answers a
different question. Fixing it means folding the conditional reassignment FIRST
and offsetting the final binding. ⛔ Not "relax the guard": the guard is right,
the fold order is what has to change.

### ✅ CONSTANT-FOLDING AN OFFSET — SHIPPED. Owner answered: the tree is frozen.

**The answer resolved it toward folding, not away.** If the stored tree is
authoritative then a LENGTH is already frozen — `ta.sma(close, n)` has folded to
`sma(close, 10)` all along. Folding the offset makes a member's knob frozen for
both rather than for one and not the other, which is the consistent behaviour.

⛔ Still refused, and each was checked: a SERIES index, a series-NAME index,
`1 + 1`, `1.5`, `bar_index`, and `close[-1]`.

⚠️ **Two things the mutation harness corrected, both worth reading:**
1. The `folded.value < 0` check is **unreachable today** — `-1` resolves to a
   `u-` op, not a negative `num`, so it refuses one check earlier. Kept and
   documented as dead rather than deleted or left looking load-bearing.
2. `pine:offset-literal` no longer fires on ANY published script in the corpus,
   so it left the coverage list — the pinned guard COUNT (12 → 11) is what forced
   that to be acknowledged instead of the list going quietly stale.

### 🛑 (original) CONSTANT-FOLDING AN OFFSET — the reasoning before the answer

**The inconsistency is real and measured.** An input already folds when used as a
LENGTH — `n = input.int(10)`, `ta.sma(close, n)` → `sma(close, 10)`, because the
window arm RESOLVES its argument and then requires a `num`. The OFFSET arm
demanded a numeric TOKEN, so the very same folded 10 was a legal length and an
illegal offset.

**Folding it works.** Implemented, and script 05's shape translated:
`highest(high, 10) > highest(high, 10)[10] ? 1 : 0`.

🔴 **BUT IT OVERRIDES AN EXPLICIT RAIL** — `pine.offset.test.js`: *"a variable
index is refused — a window that moves cannot be bounded"* — and the parser's own
comment: *"a variable index would make the window depend on a KNOB and the repaint
linter could not bound it."*

⚠️ **THE TRADE, STATED PLAINLY:** folding bakes an input's DEFAULT into the saved
tree. A member who later turns that knob gets a length that moves and an offset
that does not. The window arm already makes that trade; folding the offset extends
it somewhere new. Whether that is right is a PRODUCT decision about what a saved
indicator means when its inputs change — not something to settle inside a parser.

**To decide it, answer one question:** when a member changes an input on a saved
definition, is the tree re-translated, or is the stored tree authoritative? If it
re-translates, folding is plainly right and the rail should move. If the tree is
frozen, folding an offset silently freezes part of the member's knob and the rail
is right. `inputsFolded` is recorded per output, so the system already tracks
which inputs were folded — that is where to look first.

⛔ Reverted rather than shipped. Nothing about the current behaviour changed.

### 🥈 05-mtf-structure-bias — and it is NOT what this file said

⚠️ With the offset folded, 05's refusal moved from `pine:offset-literal` to
`pine:request` ×3 — **`request.security`, on every output**. So 05 belongs in the
structurally-out group beside 04, not in the reachable group. This section had it
ranked second-easiest; that was wrong, and the fold is what proved it.

### 🥈 (original) 05-mtf-structure-bias — one guard, one function
`pine:offset-literal` ×3, all through `f_struct`. Fold shows only one more
offset-literal and `hline`. A non-literal offset is refused because the engine's
offset carries a literal ON the node by construction (that is what makes a
forward reference inexpressible). Needs either a constant-folder for the offset
argument, or a refusal that stays. **Measure whether `f_struct`'s offset is
constant-foldable before committing to this one.**

### ✅ 06-adx-advanced — CLEARED. 10/38 → 11/47, the largest single gain yet.

Both walls fell, and each needed the SAME move: defer the decision to resolve
time, where a name is a value.

1. **`switch` on a fixed subject reduces to one arm.** `smoothType` is
   `input.string("EMA", …)`, "EMA" matches no label, so it takes the default —
   `ema(x, len)`. A subject that moves bar to bar still refuses at `pine:block`.
2. **`ta.dmi`'s two periods are compared as VALUES, not spellings.** The first
   cut compared the argument NODES at fold time, which refused
   `ta.dmi(diLen, adxSmooth)` even though both inputs hold 14 — the exact call
   this script makes. A mismatch (14 vs 20) still refuses.

⭐ **The formulas were READ, not just counted** — the lesson from the recurrence
fold that produced plausible nonsense:

    adx(high, low, close, 14) - ema(adx(high, low, close, 14), 3)   ← adxHist
    plusDI(high, low, close, 14) · minusDI(high, low, close, 14)
    ema(adx(high, low, close, 14), 3)                               ← adxLine

🔴 **AND THE BUG THAT BLOCKED THIS FOR TWO ATTEMPTS WAS ONE LINE**, in neither of
the two places I predicted. `pine.js`'s function-call path did
`this.resolve(bound.value.node)` — but a function's value is a BINDING, and only
the plain `expr` kind carries a `.node`. A body ending in anything else resolved
`undefined`, and the TypeError surfaced as `pine:statement`: "the translator
cannot parse this line", about a line it parsed perfectly.

⚠️ The fix keeps `expr` on the direct path deliberately. Routing it through
`resolveBinding` tripped the cycle guard on `f(f(x))` — legal Pine, and covered.

**Guards closed by this, all three still live for what they actually guard:**
`pine:block` (still refuses `for`/`while`/a moving subject) joins
`pine:role-order` and `pine:offset-literal` as no longer reachable from any
published script here.

### 🥉 (history) 06 — the `switch` fold, before it landed

**The target is right and the default arm is reachable.** `smoothType` is
`input.string("EMA", …)` and `"EMA"` matches NO named arm, so it falls to
`f_smooth`'s default — `ta.ema(x, len)`, a declared function. Folding the switch
on a fixed subject yields exactly that.

**The design, which I still believe is correct:**
- In `foldStatements`, a `switch` becomes ONE binding carrying its subject, its
  arms and its default — the arm CANNOT be chosen there, because a name is not
  resolvable while the walk is still binding names. Same reason a tuple's parts
  are held rather than picked.
- In `resolveBinding`, a `switch` binding reduces: `stringValueOf(subject)` (the
  folder already used for `==` on two strings), match an arm label, else the
  default, else refuse by name. A subject that is not a fixed string keeps
  refusing at `pine:block` — the branch must not move bar to bar.

🔴 **IT DID NOT WORK AND I STOPPED.** A `TypeError` surfaced as `pine:statement`
and I did not isolate it. Two candidates, both unverified: `=>` may lex as two
tokens (`=` then `>`), which would make `findTop` for it return -1; and an arm's
sub-statements may not carry `.header` the way I assumed. **Check both before
writing anything** — a five-line probe printing the lexed tokens of one `switch`
arm settles it.

⚠️ **Reverted rather than left limping.** This was the third mechanical error in
a stretch — after a wrong-but-plausible recurrence fold and a guard I mis-described
— which is a signal about the session, not about the problem. The work is genuinely
close; it deserves a first attempt, not a fourth.

### 🥉 (context) 06 — `ta.dmi` SHIPPED, and the script still refuses (correctly)

✅ **`ta.dmi(n, n)` now maps to its three declared legs** — `plusDI`/`minusDI`/
`adx`, each through a role order declared in `PINE_CALL_SHAPES` rather than
filled by the mapper (doing that refused at `pine:role-order`, correctly: the
manifest states what KIND an argument is and never what ROLE it plays).

🔴 **06 STILL DOES NOT TRANSLATE, and the reason is right.** Its call is
`ta.dmi(diLen, adxSmooth)` — two DIFFERENT input names. Pine smooths the ADX over
the second while the DI legs use the first; this table's `adx` takes one period
for both. Proving the two inputs equal needs a constant folder, so the honest
answer is to refuse — the identical decision `ADX14.20` already makes on the
TC2000 side. A script written `ta.dmi(len, len)` works today.

⛔ So the remaining wall here is the SAME one as script 05: **constant folding of
an input to its default.** Two scripts now turn on it, which makes it the highest
-value next item — and it is a question about how far inputs fold, not about Pine.

⚠️ Also still present: `pine:block switch` in `f_smooth`. A `switch` over a folded
constant string picks one arm — again the same folding question.

### 🥉 (original) 06-adx-advanced — two addressable walls
`pine:tuple` on `adxRaw`/`diPlus`/`diMinus` (a UDF returning a tuple — the shape
just shipped, so re-measure: this may already be closer than it looks) plus
`pine:block switch` in `f_smooth`. `switch` over constant arms is expressible as
nested ternaries.

### Behind Phase 5 (loops, `while`, user types)
- **02-ict** — state, plus `for`, `while`, 7 unparseable statements, 10 fold-level tuples.
- **20-smc-toolkit** — `ta.pivothigh`, reassign, 3 user types, 5 `for`, 3 `while`.
- **21-volume-profile** — a `var` nothing updates, plus `for`.

### Structurally out — and each is the CORRECT answer
- **04-superguppy** — `request.security`. A scan column reads one symbol.
- **09-on-balance-volume** — `cum`. A true cumulative changes with how many bars
  were fetched; the engine forbids that by construction.
- **14-bollinger-fixed** — a DISPLACED plot writes bar *i*'s value at bar *i−n*.
  Refusing it is the repaint guarantee.
- **19-strategy-supertrend** — a `strategy()`. Order simulation is a different
  engine.

## What this changes about how to work

⛔ **Stop picking the guard with the highest count.** `pine:chart-only` appears in
every single script and blocks nothing — it is `plotshape`/`fill`/`hline`, which a
column does not need. `pine:statement` appears 21× in one script and is a symptom
of loops, not a target.

✅ **Pick a script whose whole chain you can clear.** Today that is 10-supertrend,
and it is one fix. Then re-measure with this same probe rather than assuming the
next one is 05.

⚠️ **`chart-only` and `statement` counts are noise in this table on purpose.**
They are recorded so the next reader can see they were considered and rejected,
not omitted.
