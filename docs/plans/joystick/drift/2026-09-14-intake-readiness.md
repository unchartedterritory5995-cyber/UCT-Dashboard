# W2 · Owner-trace intake dry-run — is `hub_owner_intake.py` ready for a single-shot trace?

**Two defects found, both fixed, both railed. One of them would have blocked a correct run; the
other would have PASSED an invalid one.** Verdict at the bottom.

⛔ Nothing here touched production, signed in as anyone, or ran `smoke_reset.py` /
`smoke_login_link.py`. No full suite was run. The only pytest was scoped to one named file.

---

## 1 · The input contract, derived from the source

### The trace (positional arg 1, required)

A JSON file in the shape `gestureTracePayload()` emits. `hub_trace_analyze.load()` **refuses any
payload whose `trace` field is not `uct-joystick-g0`** — the guard that stops an excerpt or the
wrong file being analysed as a capture.

| field | use |
|---|---|
| `trace` | must be `"uct-joystick-g0"` or the run is UNUSABLE |
| `constants.FLICK_MS` | read from the **deployed build**, never restated by the tool |
| `window.dropped` | **non-zero = UNUSABLE**; a tool that averages over a partial capture invents a result |
| `rows[]` | pointer events; `type` (`pointerdown`/`pointerup`) is what `gestures()` splits on |
| `rows[].target.id` | an **object**, read via `.get("id")` — a string here is an AttributeError |
| `rows[].elapsed` | the per-gesture time; **no timed gesture = G0 unresolved** |

### The marked-up sheet (positional arg 2, optional)

Parsed by `ROW_RE = ^\|\s*(?P<id>[A-E]i?\d+[a-z]?)\s*\|(?P<body>.*)\|\s*$`. **Only the LAST cell
of the row is the result cell.**

| the cell contains | scored |
|---|---|
| a tick immediately **before** `PASS` or `DISTINGUISHABLE`, or `**PASS**` | PASS |
| a tick immediately **before** `FAIL` or `CONFUSABLE`, or `**FAIL**` | FAIL |
| `N/A`, `not applicable`, `skipped` | N/A |
| both a pass-tick and a fail-tick | **AMBIGUOUS** — blocks; preferring one would invent the owner's answer |
| none of the above | **UNMARKED** — blocks; never a pass |

⛔ **The tick binds to the word that FOLLOWS it.** In the shipped cell shape `☐ PASS ☑ FAIL`, a
pattern anchored on the preceding word matches the FAIL tick and reads a failed row as a PASS.
That was the first version's bug and the discriminator control is what caught it.

**A row whose id `ROW_RE` cannot match is invisible** — not counted, not reported, silently
absent from box 2. Verified against the real sheet: **33 of 33 rows parse, 0 missed**
(A1–A6, B1–B15, C1–C4, Ci1–Ci3, D1–D3, E1–E2).

### Control block and `--expect` positioning

`SECTION_A_EXPECT` is 10 entries with `:4` / `:1` multipliers; `hta.expectations()` expands it to
**25** gestures. `SECTION_A_CONTROL = 5` means **the last 5 of the expanded list** are the control
block — the A6 deliberate-press block. Gestures map to that list **positionally, by sequence**.

⛔ **There is no independent check that the owner performed them in that order.** Order is
asserted by the document, not verified by the data. See case 6.

### Box arithmetic

- **Box 1** = the trace. `g0Resolved` = any gesture carried an `elapsed`. `d4Holds` = row A1's
  `journal.close` fired **0** times (`GUARD` bucket is the pass). ⭐ G0's question is *does a real
  finger produce a down→up pair under `FLICK_MS` at all* — "no flick landed under the window" is a
  **FINDING**, not a failure.
- **Box 2** = every row whose id starts `B`, `C`, `D`, `E` (27 rows). Tickable only with zero
  FAIL, zero AMBIGUOUS, zero UNMARKED, and at least one row.
- **Exit codes are three different facts:** `0` both boxes tickable · `1` a ruling is needed ·
  `2` unusable input.

---

## 2 · Doc-vs-tool mismatch — ⛔ ONE RUN-VOIDING DEFECT

| # | row | the sheet says | the tool accepted | effect | status |
|---|---|---|---|---|---|
| **1** | **D1** | `☐ DISTINGUISHABLE ☐ CONFUSABLE` | only `PASS` / `FAIL` | a **correctly marked D1 read UNMARKED**, box 2 NOT TICKABLE, freeze does not lift | ✅ **FIXED** |
| — | all others | `☐ PASS ☐ FAIL` | matches | none | ✅ |

**Measured before the fix**, real sheet fully marked, real tool:

```
═══ BOX 2 — glass acceptance (§B / §C / §C-iOS / §D / §E) ═══
  rows seen: 27  ·  PASS or N/A: 26
  ⛔ UNMARKED: D1
  ⛔ NOT TICKABLE — every row above needs a mark or a ruling.
⛔ NOT YET. Boxes 1 and 2 are not both ticked on evidence, so the stage-2 PR stays unopened.
```

26 of 27 rows answered, the 27th answered in the sheet's own words, and the freeze stays down —
naming a row Patrick had in fact marked.

⭐ **The sheet is the authority on its own vocabulary, so the READER learned the word.** D1
(G3-16(a)) asks *"can you tell the **Wire** bubble from the **Journal** bubble by sight alone?"* —
DISTINGUISHABLE/CONFUSABLE is a better pair than PASS/FAIL for that question. Rewriting the sheet
to suit the tool would also have been wrong **mid-run**, when the owner may be holding a printed
or older copy.

⚠️ **Severity note, stated honestly: this failed LOUDLY.** It named D1 rather than silently
scoring it. That is the good failure mode — it would have cost a confused round-trip, not a wrong
verdict.

### ⚠️ And D1 carries a second significance nobody had flagged

D1 asks whether **Wire** can be told from **Journal** by sight — and stage 2 **moves exactly those
two bubbles** (Wire inner→outer, Journal outer→inner). A D1 answer collected at stage 1 describes
a fan layout stage 2 changes. **Not a defect in the tool; a question for Patrick** — see the
questions list.

---

## 3 · The synthetic cases, with output quoted verbatim

Fixtures in `tests/fixtures/hub_owner_intake/`, built by **reusing the tool's own
`_synthetic_trace()` / `_synthetic_md()`** rather than re-inventing the payload shape — inventing
it is what cost three fixture iterations on 2026-09-13 (`phase` for `type`; `target` as a string;
a missing envelope marker).

| # | case | exit | tool said | verdict |
|---|---|---|---|---|
| 1 | nominal + real sheet fully marked | **0** | `27 PASS or N/A · ✅ TICKABLE · freeze is lifted` | ✅ correct (post-fix) |
| 2 | capture overflowed (`dropped: 37`) | **2** | `⛔ UNUSABLE — the capture OVERFLOWED and lost 37 rows` | ✅ loud |
| 3 | clipboard cut mid-JSON | **2** | `⛔ UNUSABLE — could not read the trace: Invalid control character at: line 419 column 12` | ✅ loud |
| 4 | wrong envelope | **2** | `⛔ UNUSABLE — not a joystick G0 trace (trace='something-else') — paste the whole JSON` | ✅ loud |
| 5 | **control block absent** | **1** (was **0**) | `declared controls : 0 (expected 5)` | ⛔ **DEFECT — fixed** |
| 6 | gestures out of order vs `--expect` | **1** | `⛔ D4 FAILS — journal.close fired; a fast tap reached a destructive action` | ⚠️ **false alarm, see below** |
| 7 | hold/scrub marked `INCONCLUSIVE-TRANSPORT` | **1** | `⛔ UNMARKED: B10, B11` | ⚠️ safe, but conflated |
| 8 | A1 fires (real D4 violation) | **1** | `⛔ D4 FAILS` | ✅ correct |
| 9 | **CONTROL — nominal + synthetic sheet** | **0** | `✅ TICKABLE · freeze is lifted` | ✅ proves it can say yes |

⭐ **Case 9 is the control the whole table rests on.** Without a case that reaches exit 0, every
"it blocked correctly" above would be consistent with a tool that blocks everything.

### ⛔ DEFECT 2 — a missing control block PASSED. This is the severe one.

Before the fix, case 5 printed the warning and then **returned 0 and lifted the freeze**:

```
  declared controls : 0 (expected 5)
  ⚠️ the control count does not match the protocol — ... every label after the drift is suspect.
  ✅ TICKABLE.
✅ **Boxes 1 and 2 are ticked on evidence** ... The §4 freeze is lifted
```

The tool's own docstring says the control block is printed *"FIRST, because it decides whether
anything else means anything."* It decided nothing. A trace that never demonstrated the instrument
could tell a deliberate press from a flick would have ticked both launch boxes.

This is `lesson_gate_that_cannot_fail` in the one place it mattered most, and unlike defect 1 it
fails in the **dangerous** direction. After the fix:

```
  declared controls : 0 (expected 5)
  ⛔ THIS ALONE WITHHOLDS BOTH BOXES. The control block is what shows the instrument can tell a
     deliberate press from a flick; without it, every A-row label is unverified...
⛔ NOT YET. Boxes 1 and 2 are not both ticked on evidence, so the stage-2 PR stays unopened.
```

…with the pass path intact (case 9 still exits 0). The fix only ever makes the tool **more
conservative** — it withholds a verdict rather than inventing one — and that is why it was made
here rather than referred: it does not decide anything, it refuses to.

### ⚠️ Case 6 — out-of-order produces a FALSE D4 FAILURE, and nothing detects the order

Swapping two gesture blocks made the tool report **"D4 FAILS — journal.close fired; a fast tap
reached a destructive action."** That is an artefact of positional mapping, not a product defect —
but it is the single most alarming sentence the tool can emit, and it would be believed.

**Not fixed, because it cannot be fixed inside this tool:** the trace carries no independent
record of which row the owner intended. Detecting it needs either an in-trace marker per section
or the owner confirming order at intake. **Mitigation today is procedural** — `HARNESS-NOTES.md`
already states order is load-bearing. ⛔ **If the intake reports D4 FAILS, the first question is
"was the order right?", not "is the product broken?"**

### ⚠️ Case 7 — `INCONCLUSIVE` is read as `UNMARKED`

Both block, so this is **safe** and satisfies the requirement that INCONCLUSIVE must not produce
FAILED and must not trigger a rollback path (this tool has no rollback path at all). But
*"he did not answer"* and *"he answered: this could not be measured"* are different facts, and the
report collapses them. **Deliberately not fixed** — whether an INCONCLUSIVE row can ever be
tickable is an owner ruling, not a mechanical change.

---

## 4 · The diffs

Two changes to `tools/hub_owner_intake.py`, no refactor, no gesture constant restated.

**(a) D1's vocabulary** — the reader learns the sheet's words:

```python
-PASS_RE = re.compile(r"(☑|☒|\[x\])\s*PASS|\*\*PASS\*\*", re.I)
-FAIL_RE = re.compile(r"(☑|☒|\[x\])\s*FAIL|\*\*FAIL\*\*", re.I)
+_PASS_WORDS = r"PASS|DISTINGUISHABLE"
+_FAIL_WORDS = r"FAIL|CONFUSABLE"
+PASS_RE = re.compile(rf"(☑|☒|\[x\])\s*({_PASS_WORDS})|\*\*({_PASS_WORDS})\*\*", re.I)
+FAIL_RE = re.compile(rf"(☑|☒|\[x\])\s*({_FAIL_WORDS})|\*\*({_FAIL_WORDS})\*\*", re.I)
```

**Mutation proof, run without mutating the file** — the old readers against D1's real cell
`☑ DISTINGUISHABLE ☐ CONFUSABLE`:

```
OLD reader -> PASS=False FAIL=False  => UNMARKED  <- the defect
NEW reader -> PASS=True              => PASS
```

**(b) The control block withholds** — `control_ok` threaded into `stage_note()` and the return:

```python
-    return 0 if (b1["g0Resolved"] and b1["d4Holds"] and b2["tickable"]) else 1
+    return 0 if (control_ok and b1["g0Resolved"] and b1["d4Holds"] and b2["tickable"]) else 1
```

Three new `--self-check` cases (D1 in all four states; a drifted control block must not lift the
freeze; **and its control** — a control-ok case must still be able to). `--self-check` exits 0.

---

## 5 · Rails

`tests/test_hub_owner_intake_readiness.py` — **18 passed**, scoped run,
`python -m pytest tests/test_hub_owner_intake_readiness.py -q`. Every check is paired with a
control:

| rail | its control |
|---|---|
| every step row in the real sheet parses | no candidate row is missed by the parser |
| D1 reads PASS / FAIL / UNMARKED / AMBIGUOUS | the tick still binds to the following word |
| an unmarked row blocks and is named | a fully marked sheet IS tickable |
| a missing control block withholds both boxes | a complete run still lifts the freeze |
| unusable input exits 2 and says why | a real failure exits **1**, not 2 |
| a silent A1 scores as the guard holding | a firing A1 is a failure |

---

## 6 · Verdict

> ### **READY** — after the two fixes in this commit, and not before them.
>
> As the tool stood this morning: a correctly completed run would have been **blocked** by D1, and
> a run with a **missing control block** would have been **accepted**. Both are now railed, each
> with a control, and the tool's own `--self-check` covers them.

**Residual risk that no fix inside this tool can remove**, carried forward rather than closed:

1. **Gesture order is asserted, not verified.** Out-of-order data produces a confident, false
   "a fast tap reached a destructive action". Procedural mitigation only.
2. **`INCONCLUSIVE` and `UNMARKED` are reported as the same thing.** Safe, but lossy — needs an
   owner ruling before it can be anything else.
3. **Console encoding.** Without `PYTHONIOENCODING=utf-8` on this box the tool's output mangles
   its own symbols (`⛔` → `?`). It does **not** crash and exit codes are unaffected — but run it
   with the variable set, or the report is hard to read at exactly the moment it matters.
