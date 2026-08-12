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

## The ceiling

| | scripts | why |
|---|---|---|
| **Reading today** | **10** | |
| Reachable with contained work | **+3** | 05, 10, 06 — see below |
| Needs loops / UDTs (Phase 5) | 3 | 02, 20, 21 |
| Structurally out, correctly | 4 | 04, 09, 14, 19 |
| | **21** | |

⭐ **So the honest near-term target is 13 of 21, not 21 of 21** — and the four in
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

🔴🔴 **ATTEMPTED AND REVERTED, 2026-08-11 — READ THIS BEFORE TRYING AGAIN.**

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

### 🥈 05-mtf-structure-bias — one guard, one function
`pine:offset-literal` ×3, all through `f_struct`. Fold shows only one more
offset-literal and `hline`. A non-literal offset is refused because the engine's
offset carries a literal ON the node by construction (that is what makes a
forward reference inexpressible). Needs either a constant-folder for the offset
argument, or a refusal that stays. **Measure whether `f_struct`'s offset is
constant-foldable before committing to this one.**

### 🥉 06-adx-advanced — two addressable walls
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
