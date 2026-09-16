# Wave 2 — the Pine grammar closes: nine items censused, four built, five retired on their numbers

This wave does not add a feature. It **finishes the grammar** the Wave 1 pane stands on,
and the honest headline is that **most of it was already correct** — five of the nine
items retired on measurement, and two of those retired because a census proved the
engine does the right thing today.

⛔ **The flag is still OFF.** No member-facing behaviour changes here except two
sentences, both of which say *more* than they did before.

---

## What this wave actually changed

| | |
|---|---|
| **Built** | (d1′) a chart-only call **inside a block** is noted · (d2) an alert **message rides beside the title** · (g) the reassign refusal **carries the reason it already recorded** · (h) three `syminfo.*` fields **retire by name** |
| **Retired on their numbers** | (b) time inputs · (e) short-circuit · (f) 44 of 50 nested-text-helper forms · (i) volume provenance · (c)'s IR half, blocked |
| **Frozen and still frozen** | `NODE_TYPES` **11** · `REFUSALS` **41** |

---

## The five findings worth the reviewer's time

### 1. The engine was right more often than the plan assumed, and measurement is what showed it

Three items were priced against premises that **measured false**:

- **(e)** — *"both sides always evaluate today."* True at **run** time, **false at plan
  time**: the engine already prunes the conditional operand in **1,836 of 13,906** uses,
  and across **20,954 conditional operands it is measurably wrong in zero.**
- **(g)** — *"`s := close` is a typing gap."* There is nothing to type. A binding holds a
  **node**, and for `s := close` that node *is* the series. **Only 13 of 266** scripts
  refuse `pine:reassign` at all.
- **(d1)** — *"`alert()` is dropped whole."* It was already noted at top level; the gap
  was **depth**.

Each correction was made **in place, at every site that stated it**, because a sentence
quoted in two places is two authorities.

### 2. A census found a defect in work shipped the same day

(f) measured that (d2)'s **two "expression messages" are not expressions** — they are
string literals whose `+` sits *inside the quotes* (`…Grade A+ - Highest confidence…`).
The corpus holds **489 of 555** carryable and **zero** expressions.

⭐ The carriage was never wrong; **only its sizing was.** What the correction changes is a
fact about the guard: **`pine:alert-message` has zero corpus firings**, and only a
synthetic specimen exercises it. That is recorded rather than left for someone to cite
later as though the corpus had proved it.

⚰️ It is the **same instrument defect twice in one item**, and the second survived the
first correction. Both are *"ask the kind before the literal."* **Fixing one violation of
a rule does not find the others.**

### 3. Two member-facing sentences now name the cause, not just the line

A member whose `varip` accumulator stopped the fold was told *"a name that is reassigned
later cannot be folded into one expression."* True about the line it names, silent about
the cause — which was thirty lines earlier. The closing pass had **computed that reason
and never read it.**

Visible in a committed artifact for a real public script:

> `— \`resistancebroken\`` → `— \`resistancebroken\` — and the fold stopped before it, at
> line 181: a Pine block spans several statements and this engine stores a single
> expression — \`for\``

And three `syminfo.*` fields that were refused **anonymously** through a namespace
fallthrough now refuse **by name**, from the roster whose own manifest says *"the roster
is the thinking."* That fix is **three data entries and no code.**

### 4. What is owed is owed by name, and none of it is hidden

Fourteen rows in one table (`WAVE2-A-PLAN.md`), each with its number and its owner —
including four that belong to **other workstreams** and were recorded with reproductions
rather than crossed into: **BF.B** share-class normalisation, four disagreeing renderings
of today's volume, two vendors filling one `v` column, and the screener's second snapshot
endpoint.

### 5. Wave 1's tolerance has a blind half, and (j) must not inherit it

Wave 1 measured against a frozen `/api/bars` payload whose **last bar is `2026-09-11`** —
**every bar sealed**, which is exactly the half where the pane and screener lanes agree
*by construction*. (i) measured **three live divergence points**, plus **four different
renderings of today's volume inside the pane path alone.** An acceptance that reuses that
procedure unchanged would not exercise the developing bar at all.

---

## Verification

| leg | result |
|---|---|
| full vitest | **EXIT 1** — 1,493 files / 21,497 tests, 11 failed in 8 files, **0 NEW** |
| Python lane, 51 files **by name** | **EXIT 0** — 1,589 passed, 13 skipped, 1 xfailed |
| vite build, alone | **EXIT 0** |

All 11 failures are attributed to the branch's **own recorded baseline**
(`SESSION-STATE:458-466`) and the counts match it exactly.

⚰️ The full run's wrapper reported **exit 0** because the command ended in a `grep`. The
verdict above is read **from the log file**. This repo has recorded that defect four
times; this is the fifth.

**Moved artifacts, by name:** `27-support-resistance-channels.json`.
**Unchanged:** `corpus_metric.json`, `lookback_agreement.json`.

---

## What is NOT in this PR

- **(j) Uncharted Clouds — j.1 IS IN, j.2–j.4 ARE NOT.** The `23 → 2` drop is **two
  independent drops**, and **j.1 closed the first**: all 23 outputs now reach the pane
  document with their **20 fills**, 21 carried `hidden: true`. ⛔ **The second drop is
  still in place** — `binder.js:824` orphans a hidden plot in pass one, before the fill
  wiring in pass two — **so the fills are declared and do not yet draw.** j.2 is the
  resume point.
- **A series-conditional fill colour (j.3)** — not started. Clouds' fills carry **no**
  colour today and that is correct: `isBullish ? bull : bear` is a conditional over two
  user functions the folder resolves neither way.
- **The vendor capture (j.4)** — owed. And when it runs, **H.8's live-bar line is
  REPORTED, not asserted**: Wave 1's fixture ends at a sealed bar, so it cannot cover the
  live divergence.
- **Alert sets (d3)** — deferred beyond Wave 2 under **H.7**.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_019qreemr6kQCvfBpHAsprZu
