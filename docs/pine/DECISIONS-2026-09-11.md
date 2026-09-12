# Five decisions, measurement-first — 2026-09-11

Each block is: what was observed (with its fixture), the options, what each costs a
member in words a swing trader would use, whether the lanes differ, a recommendation
with one reason, and whether it can be changed later.

⛔ None of these was taken autonomously. Every one changes a number or a sentence a
member can see.

---

## 3.1 — Should `barstate.*` follow the vendor's THREE axes instead of our tri-state?

**Measurement.** Nine timeline rows on AMEX:SPY 1D, 2026-09-10 → 09-11 —
`tests/fixtures/vendor/barstate-daily-timeline.json`, sha256 `fc38853154b901f2…`.
The vendor has **two time axes that move hours apart on one bar**:

```
instant A   isconfirmed 0 -> 1    bracketed (19:22, 20:55) ET   hypothesis: 20:00, the extended close
instant B   isrealtime  1 -> 0    bracketed (20:55, 23:57) ET   NO hypothesis at all
```

Rows 4-6 were full page RELOADS and all read `isrealtime=1`, so the flip is the CLOCK
and not the fetch. Rows 7-9 share one `pageLoadEpoch` across 23:57 → 00:56 → 07:38 —
one session watching the cold state hold into the next pre-market.

⭐⭐ **A tri-state cannot express two flags that flip at different times.** This is a
different NUMBER OF AXES, not a calibration difference, and it is now measured rather
than argued.

**Options**

- **A — keep `calendar` (ours).** Three columns derived from one boolean: "is this
  bar's period over".
- **B — flip to `BARSTATE_MODE_VENDOR`.** Built and dark; needs a third input,
  `dataset_live`, which this engine may have no honest answer for.
- **C — refuse `barstate.*` in the HOST lane until realtime is measured**, keeping the
  screener's `isconfirmed` fold.

**What each costs a member**

- **A:** in the window after a daily bar confirms but before the next open, a member
  reading the same bar sees **ours 0/1/1 where TradingView shows 1/1/0** — two of
  three columns disagree, both engines confident. They will conclude one of us is
  broken.
- **B:** the columns match TradingView — *if* we can tell whether the feed is still
  delivering. We evaluate a STATIC FETCH, so `dataset_live` would be a guess, and a
  guessed axis is a column that is wrong at exactly the moment it matters.
- **C:** four columns a member can spell simply stop answering on the pane. Honest,
  and visibly less capable than the vendor.

**Lanes.** They differ. The SCREENER almost always means "is this bar's period over"
(there is no viewer), so A is right there. The HOST/pane is where a member can put our
column beside TradingView's and watch them disagree.

**Recommendation: A for the screener, C for the host, until instant A is measured.**
One reason: a screener has no viewer, so the vendor's position axis has no meaning in
it — but on a pane a member sees both engines at once, and a column that is
confidently different is worse than one that is absent.

**Can a tri-state ever spell it?** No. The representation that can is an **axis pair
with its own timestamp per axis** — `(confirmed_at, realtime_until)` — because the
whole finding is that the two move independently. ⛔ Anything cheaper re-encodes one
boolean and re-creates the disagreement.

**Reversibility.** A↔C is a flag, no migration. Flipping to B re-records every
barstate fixture and moves stored per-AST digests — that one is expensive.

---

## 3.2 — Should our `ta.barssince` declaration drop to ONE argument, as the vendor has it?

**Measurement.** `tests/fixtures/vendor/r11-barssince-spy-1d-2026-09-11.json`, sha256
`71650fece41b2c82…`: Pine takes **one** argument; the two-argument form is **rejected
outright** (`compiles: false`, a one-plot stub); never-true returns **`na`**, not 0.
**So this engine currently ACCEPTS a call TradingView REJECTS.**

⭐ **And the blast radius is zero, measured.** Committed corpus scripts writing a
genuine 2-arg `ta.barssince`: **none**. A regex sweep appeared to find two —
`market-profile-with-tpo__b2b119d8ab.pine` and
`smart-money-breakout-channels-algoalpha__8c2d234156.pine` — and reading the sites
shows both are a **nested call's comma**
(`ta.barssince(ta.crossover(lower,upper))` and
`ta.barssince(fn_is_session_start("1440", sess1))`), not a second argument. The 2-arg
spelling exists only in OUR table.

⛔ **Two different things share the name, and only one is on the table.** The
member-facing DECLARATION is what would change. The internal bounded node stays:
`contextBoundedPlan` rewrites `ta.barssince(c) < 5` → `barssince(c, 5) < 5` exactly,
because every count the cap destroys is one the comparison already answers the same way.

**Options**

- **A — drop the declaration to one argument.** We stop accepting what the vendor
  rejects; the bare call keeps refusing by name (the bound is the budget, and choosing
  it for a member charges them for a number they did not pick).
- **B — leave it.** Keep accepting a 2-arg form Pine does not have.
- **C — drop to one argument AND supply a default bound** so pasted scripts run.

**What each costs a member**

- **A:** a member who learned `barssince(x, 20)` from our own builder gets a refusal.
  Nobody who pasted real Pine is affected.
- **B:** a member writes `barssince(x, 20)`, it works here, they move the script to
  TradingView and it does not compile. We taught them a dialect.
- **C:** the script runs with a window **nobody chose**, and the count silently
  saturates at it — a different number wearing the same name.

**Lanes.** Identical in both; this is a table declaration.

**Recommendation: A.** One reason: accepting a call the vendor rejects is how an engine
quietly becomes a fork, and it costs no corpus script to stop.

**Reversibility.** Fully — a table edit, no fixture re-record. ⚠️ A stored definition
already using the 2-arg form would need a migration, so check `user_definitions` before
shipping.

---

## 3.3 — Should `pineRuntimeFrontend.js` be wired, given four columns would render blank?

**Measurement.** The module has **zero** non-test importers, held there by
`pineRuntimeFrontendGate.test.js` (3/3 green). Not one caller of `interpret()` in
`app/src` supplies `newestBarIsForming`; the pane's own path
(`binder.js` → `nativeRegistry.computeFor` → `interpret`) carries `{ sym, tf }` and
stops. Measured at `35ba654da` the lane was already blank; at `3a1d9d4a3` it was
confidently WRONG (a forming bar reported `isconfirmed = 1`).

**Your question — is shipping blanks even permitted under strict mode?** On this repo's
own doctrine, **no**. "Any output that cannot be rendered with fidelity must surface a
named refusal or a disclosure, never a blank" — and four empty columns beside populated
ones is that case exactly. A member cannot tell "this bar is not confirmed" from "this
engine does not know".

**Options**

- **A — build the producer first**, then wire, then delete the gate in that commit (the
  ending the gate itself describes).
- **B — wire it now and REFUSE the four `barstate.*` names in the JS lane** until the
  producer exists, so a member gets a sentence instead of an empty cell.
- **C — leave it unwired.**

**Cost to a member**

- **A:** nothing, until it ships correct. Costs us ~90 min plus the `/api/bars`
  response shape.
- **B:** a member who spells `barstate.isconfirmed` on a pane is told, by name, that
  this lane cannot answer it yet — and the other two columns still work.
- **C:** the renderer keeps not existing; nothing else moves either.

**Lanes.** The SERVED lane already has the producer (`521a52816`, `9dfe101e0`). This is
the JS lane's own path to it — so the two lanes would disagree about the same name
until it is built, which is itself an argument for building it.

**Recommendation: A, and if the pane must come first, B — never a blank.** One reason:
a blank is the only option a member cannot tell apart from a product bug.

**Reversibility.** Yes. ⛔ But the gate test is NOT to be edited to keep passing — when
it goes red, build the producer and delete it in the same commit.

---

## 3.4 — Kind-4 member wording ✅ ANSWERED, and it was already answered, in Python

This needed no new ruling. `definition_concierge._OPERAND_ONLY` already describes `str`
and `symtext`, and `ast_lint.py` / `ast_interpret.py` already carry all three names
(`ast_lint.py:418` dates it 2026-09-11). What was still red was one rail in the other
language, `criteria.nodeTypes.test.js`. **I mirrored the existing ruling rather than
writing a second one** — two authorities over one value is this week's repeated defect.
The ruling, as written into the JS exempt map:

- **`textop` — a missing picker ROW.** `text_contains` / `text_length` answer a NUMBER
  (1/0, a count), so it sits wherever a number sits and every walker already prices it
  as one. A picker row is a DESIGN task of the same class as `tf` / `sym`: what a text
  row compares, against which field vocabulary. The entry ends when the picker gets one.
- **`str` — structurally unpickable, a different claim with a different lifetime.**
  `closedTable.json` rules these may appear nowhere except directly under a `textop`,
  and `parse.js::astHash` THROWS otherwise: *"Text is not a value in this engine; a text
  question answers with a number and the text never leaves it."* A picker position for a
  `str` is not a row somebody has yet to design — it is a tree the engine refuses to
  hash. **This entry outlives `textop`'s**: giving `textop` a row gives `str` an operand
  slot, not a row.
- **`symtext` — the same containment, symbol-supplied.** Quoted from the Python ruling
  rather than paraphrased: *`syminfo.ticker` is not a screen condition,
  `contains(syminfo.ticker, "/")` is.*

⚠️ **What is still yours:** the member-facing concierge wording is marked *"drafted
autonomously 2026-09-11, product review pending"*. The ruling above decides which types
are offered; **what a member READS is still unapproved.**

---

## 3.5 — NEW: does a literal `'D'` mean the identity on a daily-base engine?

**Measurement (tonight).** With item 4 landed, `uncharted-volume.pine`'s host lane has
exactly one refusal left: `pine:request@259`, the tuple request asking for `'D'`.
`TF_RESAMPLABLE` is `['W','M']` **because the base bar IS a day**. Measured in both
lanes: `request.security(syminfo.tickerid, timeframe.period, f(), off)` → the identity
(`close`); the same call with `'D'` → refused.

**Options**

- **A — treat a literal `'D'` as the identity** on the chart's own symbol, exactly as
  `timeframe.period` already is.
- **B — keep refusing.** Volume does not translate in the host lane.
- **C — accept `'D'` only when the script proves it is on a daily base** (it cannot;
  the engine does not know the chart's timeframe).

**Cost to a member**

- **A:** Volume translates, and every imported script that fetches daily data from an
  intraday chart starts answering. ⚠️ The risk: our `tf` is `lookahead_off` **+ `[1]`**
  — the last CLOSED higher bar — and "identity" has no such shift. On a closed-bar daily
  engine they coincide; if this engine ever evaluates an intraday base they differ by
  one bar, and Volume then applies its OWN `volD[1]` on top of that.
- **B:** the commonest MTF idiom in the corpus keeps refusing, and Volume cannot reach a
  pane at all.
- **C:** refuses everything A would accept, with extra machinery to do it.

**Lanes.** Same answer in both; it is a resolution rule.

**Recommendation: A, with the shift written down as a disclosure row** in
`divergences.json` at MEASURED tier. One reason: `TF_RESAMPLABLE` already encodes "the
base bar is a day", so refusing `'D'` refuses the identity for a spelling reason rather
than a semantic one.

**Reversibility.** Yes — one list plus one recognition rule. ⛔ But it changes what
existing imported scripts compute, so it is member-visible and wants the disclosure row
in the same commit.
