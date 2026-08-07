# Runbook — the AST conformance gate and the reachability census

**Subject:** `tools/ast_conformance.py`, `tools/phase_d_gauntlet.py`,
`tests/fixtures/ast/corpus.json`, `tests/fixtures/ast/escapes.json`,
`tests/test_ast_conformance.py`.
**Phase:** D, Task 2. **Status of the instrument:** built; both lanes still absent.

Phase B's gate was pixels. Phase C's gate was a fire log and a repaint oracle.
**Phase D's output is a formula the user wrote, and neither instrument covers it.**
`tools/chart_parity.py` renders *committed* cases through `?fixedbars=`; a
user-authored definition exists in no committed base at all, so a total regression
of everything in Phase D would report **0 changed pixels on all 46 live cases**,
and would do so honestly. This file is what replaces that.

---

## 1. The commands

```bash
python tools/ast_conformance.py --escapes --unguarded   # the positive control
python tools/ast_conformance.py --escapes               # the census
python tools/ast_conformance.py --coverage              # the manifest totality rail
python tools/ast_conformance.py --record                # ONE-SHOT, Task 5 only
python tools/ast_conformance.py --check                 # the gate, Task 5 onward

PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_ast_conformance.py -q
python tools/phase_d_gauntlet.py                        # the mutation gauntlet
```

**Read every exit code bare.** An exit code is lost through a pipe: `| tail`
reported `EXIT=0` over a real failure on this branch, and `rc=$?` after a
pipeline read `sed`'s status. Redirect to a file, then read `$?`.

`PYTHONDONTWRITEBYTECODE=1` on **every** pytest run. A same-size mutation applied
within one second of the previous run imports the previous `.pyc` and the
mutation silently never executes.

---

## 2. The exit codes, and why there are four

| code | name | means |
|---|---|---|
| 0 | `EXIT_CLOSED` | zero escapes **and** the unguarded control read non-zero |
| 1 | `EXIT_ESCAPES` | a guard exists and something got past it |
| 2 | `EXIT_VACUOUS` | the corpus itself cannot report an escape |
| 3 | `EXIT_NO_GUARD` | there is no guarded interpreter yet — today's honest baseline |

**"There is no guard yet" and "the guard leaks" are opposite findings and must not
share an exit code.** One exit 1 for both would let Task 6 read its own starting
condition as a regression, and would let a real leak read as "not built yet".
`test_a_guarded_leak_and_an_absent_guard_have_DIFFERENT_exit_codes` pins it.

---

## 3. THE HEADLINE PAIR — record both, every time

> `--escapes --unguarded` **MUST be non-zero.**
> `--escapes` **MUST be zero** — and only means something after the line above.

### Measured on 2026-08-06, at Task 2, with no interpreter and no guard

```
corpus cases       : 16
parsed (offered)   : 16
parser_refused     : 0
refused by a table : 0
ESCAPED            : 16      <-- unguarded control
ESCAPED            : 16      <-- "guarded" run; guard state = absent
```

**Both read 16, and that is correct today.** Task 6 owes the first zero, and the
zero can only mean something because this reads non-zero now. A census that read
zero before anything had been built would be measuring nothing, would then read
zero forever, and would be cited as safety.

Of the 16:

* **6 reached a value** — `this_expr`, `array_literal`, `assignment`,
  `arity_wrong`, `lookback_too_deep`, `nested_lookback`.
* **10 died on an incidental language error** — 4 `TypeError` on property
  access, 5 `AttributeError` on an unresolvable name, 1 `RecursionError` on the
  4,000-node tree.

**An incidental error is NOT a refusal**, and the census counts it as an escape.
`TableRefusal` is the only thing that counts as a refusal, because an
`AttributeError` is the *language* declining for *this* input — a different
input reaches a value where that one did not.

### The lane-native control — what keeps "it errored" from reading as "it was safe"

The must-refuse corpus names **JS** reaches (`constructor`, `__proto__`,
`toString`, `globalThis`). A naive **Python** walker does not resolve those, so
ten of the sixteen fail on the wrong language rather than on a table. The census
therefore also probes the equivalent reaches in the lane it actually runs in:

```
ambient namespace : ['eval', 'exec', '__import__', 'compile']
property gadget   : close.__class__.__base__.__subclasses__
```

Both resolve, through exactly the lookup a naive walker performs.
`close.__class__.__base__.__subclasses__` is Python's `constructor.constructor`:
the property-access chain that ends at arbitrary code. **Note what is missing
from the ambient list: `open`.** It is *shadowed by the `open` series* — a real
property of the lookup order, and exactly the sort of thing a blocklist gets
wrong.

---

## 4. WHAT THIS GATE DOES NOT COVER

Phase C's Task 15 shipped a §6 table for exactly this reason, and the pixel
gate's own blindness is the cautionary example: `ChartRender.jsx:527` hides the
legend in the only route `tools/chart_parity.py` photographs, so a legend
regression is invisible to a gate whose entire job is to see the chart.

| what | not covered | what does cover it |
|---|---|---|
| **A wrong TABLE** | `run_js`/`run_py` **import the interpreters they compare**. Two lanes agreeing on a wrong `closedTable.json` agree perfectly, at 1e-9, forever. | the three golden fixtures Task 5 adds to `tests/fixtures/indicators/`, which derive from oracles older than the code |
| **A `parse(source) != ast` fork** | every `ast` in `corpus.json` and `escapes.json` is **hand-written, not parsed**. This file never runs a parser. | Task 3's round-trip rail (`canonicalise(parse(def.compute.source))` deep-equals `def.compute.ast`) |
| **Which cases jsep actually accepts** | `parses` is a **declaration**, not a measurement. `assignment` is declared `parses: true` although jsep core has no assignment operator, because over-counting an escape is the conservative direction. | Task 3 owes the first real measurement; a case that moves to PARSER_REFUSED makes the escape total go **down**, never up |
| **A refusal that raises the right type for the wrong reason** | the guarded census recognises a refusal by **type** (`TableRefusal`). | the per-case `refuse` fragment — **armed, not enforced**, because nothing refuses anything until a guard exists (Task 6) |
| **Manifest coverage** | the totality rail is **armed and skipped**: `closedTable.json` does not exist until Task 3. | proved non-vacuous *today* by two synthetic-manifest tests that always run — a planted `rugpull` aborts by name, and a covered synthetic manifest passes |
| **The JS lane's own escapes** | the census runs in **Python only**. `toString`, `hasOwnProperty` and `globalThis` are JS prototype/global reaches that no Python walker resolves. | Task 4 owes a JS-side run of the same corpus through `interpret.js` |
| **The repaint linter** | nothing here decides a repaint badge. | Task 7's `must_repaint.json` corpus |
| **Anything on a canvas** | this task mounts nothing, registers no definition and draws no pixel. | nothing — and that is the point: **a total regression of Phase D would report 0 changed pixels** |
| **Budget arithmetic** | `too_many_nodes` and `nested_lookback` are declared to exceed budgets that **do not exist yet**. | Task 6 makes budgets real; until then those two cases only prove nothing refuses them |

---

## 5. What each refusal means

| message | meaning | what to do |
|---|---|---|
| `THE UNGUARDED CONTROL READ ZERO` | the corpus cannot report a leak, so the guarded zero is worthless | fix the corpus or the walker — **never record the zero** |
| `the escape corpus is EMPTY` | a census over no cases | restore `escapes.json` |
| `the JS/Python lane has no interpreter` | Task 4/5 has not landed | expected until then; it **refuses** rather than returning `{}` |
| `compare_lanes was handed an empty lane` | zero differences over zero rows | a lane failed to produce columns; do not read it as agreement |
| `the lanes carry different case ids` | one lane dropped a case | a comparison over the intersection silently stops covering it |
| `different column lengths` | a pairwise comparison would agree on every element the shorter column has | find which lane truncated |
| `N table entries have NO corpus coverage` | the manifest grew and the corpus did not | add a hand-written case **with a reason**; never shrink the manifest to fit |
| `N corpus names are NOT in the table` | a case calls something undeclared | either the manifest is missing an entry or the case is testing a feature nobody declared |
| `--record IS ONE-SHOT` | the frozen log already exists | **do not re-record.** Re-running converts a real regression into a green build |
| `there is no second lane yet` | `--record` before Task 5 | expected |

---

## 6. The corpus, and why it lives where it does

`tests/fixtures/ast/` — **not** `tests/fixtures/indicators/`.

`test_every_fixture_file_is_covered_by_a_test` globs `tests/fixtures/indicators/`
and demands the stem set equal the explicit `CASES` lists, so a file added there
without a matching `CASES` entry fails immediately. That is a deliberate
structural property: it makes **per-user fixtures impossible**. Phase D adds
**exactly three** files to that directory, ever — the table's own conformance
cases (Task 5) — and a user's definition never gets one. The AST corpus is a
different kind of artifact (a committed corpus of *trees*, not of golden
*columns*) and putting it under `indicators/` would either break that glob test or
require weakening it.

**The corpus is hand-written.** A corpus generated from the thing it measures is
not an oracle. Every row carries the reason it exists, and
`test_the_corpus_is_hand_written_and_every_case_states_why` enforces that a row
without a reason cannot be added — because a row nobody can explain is a row
nobody can safely delete.

**Bars are a reference, not a copy.** The corpus declares
`tests/fixtures/alerts/replay_bars.json#intraday5m` and `corpus_bars()` resolves
it through `alert_replay.load_fixture`, which re-checks the recorded sha256 of
`app/src/pages/parityBars/intraday5m.json`. So the compute oracle, the pixel
gate, the alert replay and the AST conformance log are provably **one** 579-bar
series — not four copies that agreed on the day somebody made them.

### The coverage floor is DERIVED, never hand-listed

```python
declared = (set(manifest["functions"])
            | set(manifest["operators"])
            | set(manifest["series"]))
```

DPC's four constants (`DPC_LOOKBACK`, `DPC_PROX_PCT`, `DPC_HOLD_MIN`,
`DPC_FLOW_WINDOW`) rode outside `test_all_constants_match_owner_spec` for the
rule's entire life because that rail was a **list of what somebody remembered**:
`DPC_LOOKBACK 10 -> 999` left the file `5 passed rc=0`.

`test_the_coverage_floor_is_derived_from_the_manifest_and_never_a_literal` reads
this module's **own AST** — finding the function **by name**, never by line
number, because `inspect.getsource` returned the wrong slice mid-run in Phase C
when a co-worker inserted ~180 lines above the target — and fails if the floor
contains any list/set/tuple of two or more string constants. **A planted
uncovered entry aborts the rail by name**, proved today against a synthetic
manifest containing `rugpull`.

**Armed and skipped:** the real manifest does not exist until Task 3, exactly as
Task 1 armed the ledger anchor. **Task 3 owes the first pass.** The corpus
currently uses **31 distinct names** (5 series, 15 operators, 11 functions),
which is the plan's drafted manifest exactly; if Task 3 ships a different
vocabulary, reconciling the corpus is Task 3's.

---

## 7. Disjointness: per GUARD, not per case

The brief asked for a disjoint refusal fragment **per case**. That is measurably
wrong for this corpus and the deviation is deliberate.

C Task 9's M1 was the nineteenth vacuous gate on this branch: two **different
gates** shared the phrase *"forming-bar fires are not ledger-grade"*, so
`pytest.raises(match=...)` **still matched with the mode lock deleted** — the
test would have passed on a tree with the safety removed. Two cases refused by
**one** gate for **one** reason legitimately share a message; demanding two
messages there would be demanding two gates where one is correct.

So each case names its `guard`, and the rail is **stricter** than per-case
disjointness:

* two cases share a fragment **iff** they share a guard, and
* no fragment may be a **substring** of another guard's fragment.

Ten guards over sixteen cases:
`canonicalise:member` (4) · `canonicalise:this` · `canonicalise:call-target` ·
`canonicalise:array` · `canonicalise:assignment` · `resolve:name` (3) ·
`resolve:function` · `resolve:arity` · `budget:nodes` · `budget:lookback` (2).

---

## 8. The contract Tasks 4 and 5 owe this file

| lane | must export | shape |
|---|---|---|
| `app/src/components/chart/engine/ast/interpret.js` | `interpret` (named or default) | `interpret(ast, bars) -> number[]`, pure — no registry import, no network, no clock |
| `api/services/ast_interpret.py` | `interpret`, `TableRefusal` | `interpret(ast, bars) -> list`, and **every refusal raises `TableRefusal`** |

**The census recognises a refusal by TYPE.** A Python lane that exists but
exports no `TableRefusal` makes `--escapes` refuse with
*"the census recognises a refusal by TYPE; without one it cannot tell a closed
table from a walker that happened to crash."*

`run_js` drives **one** node process for the whole corpus (seven cases would be
seven node boots for no reason), argv as a list, `shell=False`, payload on
**stdin** — never a `-e` string, because a `-t` containing a double quote split
under cmd.exe and selected ten tests on this branch. The driver is written to a
temp directory **outside `app/`** and imported by absolute `file://` URL, so it
cannot be picked up by another agent's vitest glob. **Task 5 owes the first real
run**, including whatever `closedTable.json` import assertion Node 24 requires.

---

## 9. The gauntlet

`python tools/phase_d_gauntlet.py` — seven mutations, each with a **unique**
`must_reach` killer. Two mutations sharing a killer means one of them is not
testing what it claims; four agents in one session found that and **fixed the
tests** rather than accepting it, so it is a hard failure here
(`assert_refusals_are_disjoint`).

| id | mutation | must go red because |
|---|---|---|
| **M1** | a `PARSER_REFUSED` case booked as `refused` | a parser change would silently empty the census with every number unmoved |
| **M2** | the `--unguarded` control deleted from the verdict | a zero with no positive control is the vacuity this file exists to refuse |
| **M3** | two **different guards** made to share a `refuse` fragment | C Task 9 measured `raises(match=…)` matching with the safety deleted |
| **M4** | `assert_corpus_covers_the_table` hand-lists `declared` | a rail built on a list is a list, and that is how DPC drifted |
| **M5** | `ast_digest` hashes `(ast_id, bar_index)` only | a changed number must not read as no change |
| **M6** | the escape census silently returns 0 escapes | the number Task 6 would inherit as already-green |
| **M7** | the cross-lane comparison passes when the lanes disagree | a user's alert firing on the server and not on their chart, forever, greenly |

**Result 2026-08-06: 7 / 7 KILLED, 0 survivors, 0 suspects, exit 0.**
CONTROL A `43 passed` (aborts on zero); CONTROL B non-zero and `selected > 0` on
every filter.

### Two hardening notes this gauntlet added, and one it found by running

* **`GUARDED` snapshots every artifact a mutation can reach**, not just the file
  it patches. Phase C's M2 reported *3/3 KILLED, exit 0* **and left a corrupted
  fire log**: with `--record --append`'s refusal deleted the test really
  re-recorded and really wrote, and the harness restored the file it *patched*
  and never looked at the file the mutation *wrote*. Restores are verified by
  sha256 in both directions inside the `finally`; collateral writes are named
  separately from the patched file so a real corruption is loud.

* **Counts come from the runner's SUMMARY LINE and nothing else — and this
  defect fired for real here.** A bare `re.search(r"(\d+) passed", out)` reads
  the *first* match in the whole capture, and pytest echoes a failing test's
  **docstring** into that capture.
  `test_the_coverage_floor_is_derived_from_the_manifest_and_never_a_literal`'s
  docstring contains the words ``left the file `5 passed rc=0` ``, so M4's real
  result — `1 failed, 1 passed, 41 deselected` — was first reported as
  `passed=5 failed=0`. Same class as the vitest trap (`Test Files N passed`
  prints **before** `Tests M passed`; a control reading the first under-read its
  own baseline 1-where-the-truth-was-35), except the wrong place here was **prose
  inside the subject**. A capture with no summary line now **refuses**;
  `test_the_gauntlet_reads_its_counts_from_the_summary_line_not_from_prose`
  replays the poisoned capture.

* **pytest exit 4 is a USAGE error that prints "no tests ran", which reads
  exactly like a pass.** Detected by code and aborted; never a verdict.

---

## 10. Environment traps that fired for real on this tree

* **cp1252 kills a harness's own stdout and leaves the mutation applied.** Both
  tools `sys.stdout.reconfigure(encoding="utf-8")` **before anything prints**,
  and both are written ASCII-only; the gauntlet additionally ASCII-sanitises every
  printed line. It killed a sibling harness's `--help` and a `json.load` while
  the plan was being written — hence `io.open(..., encoding="utf-8")`, always.
* **CRLF makes a multi-line `\n` anchor match ZERO.** `_once()` aborts loudly and
  names the file's line endings; a zero-match anchor is never reported as a
  survivor.
* **`write_text` truncated a JSON fixture to 0 bytes** via lone surrogates.
  Restore with `git show HEAD:<path>` → `write_bytes` + sha256, **not
  `git checkout --`**, which does not restore bytes under `core.autocrlf`.
* **Git-Bash `/tmp` ≠ Python `/tmp`.**
* **Verify structure with an AST, never a grep.** `git grep -c admit_alert_fire`
  says 3 on this tree and all three are prose.
* **Derive identifiers from the system, never type them.** Five typed-name
  mistakes in one Phase C session each failed in the shape of a catastrophic
  finding.

## 11. `offset` is a v2 SPEC question — recorded by Phase D Task 3

`app/src/components/chart/engine/ast/closedTable.json` v1 declares **no `ref`, no
`offset`, and no backward-index form**, and that absence is a decision rather
than an omission.

* A general `close[n]` turns the repaint linter from a **lookback sum** into a
  **dataflow analysis**, and it makes a *forward* reference expressible in the
  first place — the exact construction (`chikou[j] === close[j+26]`) the repaint
  record already names as the thing the linter has to be able to decide. The
  linter must be simple enough to be obviously right on the day it decides the
  brand's central claim.
* Every function in the table therefore declares its lookback as a **constant or
  a named argument**, so `maxLookback(ast)` is a tree sum. `parse.test.js`
  asserts that property directly rather than trusting this paragraph.

**Who it would have to be re-opened by:** the owner of the repaint claim (spec
§4 / the repaint-linter task) **and** the owner of this manifest, together. It
changes what the linter can decide *and* what both lane walkers must implement,
so it is not a feature request any later task may grant on its own.

`sentence` lives in the manifest for the mirror-image reason: the chip's
plain-English read-back and the interpreter's dispatch come from **one**
declaration. A read-back with its own phrase table is a second vocabulary, and
this repo has already measured what two vocabularies cost (`williams_r` vs
`williamsR`, which is why `_CASE_COLUMNS` exists).
